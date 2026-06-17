import { DOMParser, type Element } from "@xmldom/xmldom";
import type {
  BBox,
  Canvas,
  ManifestSlot,
  SlotManifest,
  TextAlign,
  Theme,
  UnmappedLayer,
} from "@stencil/ir";
import { mapRole } from "./roleMap.js";
import { accumulatedTransform, applyBBox } from "./transform.js";

/**
 * M0 normalizer (DEVDOC 6/8.0). Reads a Figma SVG with real <text> nodes and
 * produces a SlotManifest. The original SVG is preserved as the render base;
 * nothing is stripped here.
 *
 * Width/height of text are approximated with a heuristic for the Phase 0 PoC;
 * precise getBBox/metric measurement is deferred to Phase 2 (DEVDOC 9, 12.4).
 */

/** Average glyph advance as a fraction of font-size (rough, font-agnostic). */
const CHAR_WIDTH_FACTOR = 0.55;
/** Baseline-to-top (ascent) as a fraction of font-size. */
const ASCENT_FACTOR = 0.8;

/** Ids that are SVG plumbing (defs), not semantic layers. */
const PLUMBING_ID = /^(clip|paint|filter|pattern|image\d)/i;

export interface NormalizeOptions {
  layoutId: string;
  theme: Theme;
  /** Reference stored in the manifest pointing at the original SVG. */
  baseTemplate: string;
}

interface TspanLine {
  x: number;
  y: number;
  text: string;
}

function num(el: Element, attr: string): number | undefined {
  const v = el.getAttribute(attr);
  if (v === null || v === "") return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

function anchorToAlign(el: Element): TextAlign {
  switch (el.getAttribute("text-anchor")) {
    case "middle":
      return "center";
    case "end":
      return "right";
    default:
      return "left";
  }
}

function readLines(textEl: Element): TspanLine[] {
  const tspans = textEl.getElementsByTagName("tspan");
  const lines: TspanLine[] = [];
  for (let i = 0; i < tspans.length; i++) {
    const t = tspans[i]!;
    lines.push({
      x: num(t, "x") ?? num(textEl, "x") ?? 0,
      y: num(t, "y") ?? num(textEl, "y") ?? 0,
      text: t.textContent ?? "",
    });
  }
  if (lines.length === 0) {
    lines.push({
      x: num(textEl, "x") ?? 0,
      y: num(textEl, "y") ?? 0,
      text: textEl.textContent ?? "",
    });
  }
  return lines;
}

function textBBox(lines: TspanLine[], fontSize: number): BBox {
  const x = Math.min(...lines.map((l) => l.x));
  const firstY = lines[0]!.y;
  const lastY = lines[lines.length - 1]!.y;
  const longest = Math.max(...lines.map((l) => l.text.trim().length));
  return {
    x,
    y: firstY - fontSize * ASCENT_FACTOR,
    w: Math.round(longest * fontSize * CHAR_WIDTH_FACTOR),
    h: Math.round(lastY - firstY + fontSize),
  };
}

function buildTextSlot(el: Element): ManifestSlot {
  const id = el.getAttribute("id") ?? "";
  const { role, uncertain } = mapRole(id);
  const fontSize = num(el, "font-size") ?? 16;
  const lines = readLines(el);

  const slot: ManifestSlot = {
    id,
    role,
    type: "text",
    bbox: textBBox(lines, fontSize),
    fontSize,
    align: anchorToAlign(el),
  };
  const fill = el.getAttribute("fill");
  if (fill) slot.color = fill;
  const family = el.getAttribute("font-family");
  if (family) slot.fontFamily = family;
  const weight = num(el, "font-weight");
  if (weight !== undefined) slot.fontWeight = weight;
  const ls = el.getAttribute("letter-spacing");
  if (ls) slot.letterSpacing = ls;
  if (uncertain) slot.uncertain = true;
  return slot;
}

function isInDefs(el: Element): boolean {
  let p: Element | null = el.parentNode as Element | null;
  while (p) {
    if (p.nodeName?.toLowerCase() === "defs") return true;
    p = p.parentNode as Element | null;
  }
  return false;
}

/** Image slot from an element (pattern-fill rect or <image>), transform-applied. */
function buildImageSlot(el: Element, index: number): ManifestSlot {
  const local: BBox = {
    x: num(el, "x") ?? 0,
    y: num(el, "y") ?? 0,
    w: num(el, "width") ?? 0,
    h: num(el, "height") ?? 0,
  };
  const bbox = applyBBox(local, accumulatedTransform(el));
  return { id: el.getAttribute("id") || `image_${index}`, role: "image", type: "image", bbox };
}

/** Axis-aligned bbox of an SVG path `d` (endpoints + control points). Handles the
 *  Figma command set (M/L/H/V/C/S/Q/T/A/Z, absolute + relative). */
function pathBBox(d: string): BBox | null {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!toks) return null;
  let i = 0, cx = 0, cy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x: number, y: number): void => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  const nx = (): number => Number(toks[i++]);
  let cmd = "";
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i]!)) { cmd = toks[i]!; i++; }
    const rel = cmd === cmd.toLowerCase();
    const base = (x: number, y: number): [number, number] => (rel ? [cx + x, cy + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case "M": case "L": case "T": { const [x, y] = base(nx(), nx()); cx = x; cy = y; ext(x, y); if (cmd === "m") cmd = "l"; else if (cmd === "M") cmd = "L"; break; }
      case "H": { const x = rel ? cx + nx() : nx(); cx = x; ext(x, cy); break; }
      case "V": { const y = rel ? cy + nx() : nx(); cy = y; ext(cx, y); break; }
      case "C": { const [x1, y1] = base(nx(), nx()); const [x2, y2] = base(nx(), nx()); const [x, y] = base(nx(), nx()); ext(x1, y1); ext(x2, y2); ext(x, y); cx = x; cy = y; break; }
      case "S": case "Q": { const [x1, y1] = base(nx(), nx()); const [x, y] = base(nx(), nx()); ext(x1, y1); ext(x, y); cx = x; cy = y; break; }
      case "A": { nx(); nx(); nx(); nx(); nx(); const [x, y] = base(nx(), nx()); ext(x, y); cx = x; cy = y; break; }
      case "Z": break;
      default: i++; // unknown token, skip defensively
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function isIdentity(m: { a: number; b: number; c: number; d: number; e: number; f: number }): boolean {
  return Math.abs(m.a - 1) < 1e-6 && Math.abs(m.d - 1) < 1e-6 && Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6 && Math.abs(m.e) < 1e-3 && Math.abs(m.f) < 1e-3;
}

/** Image slot from a pattern-filled non-rect shape (e.g. a mockup screen path).
 *  Captures the exact shape as `clip` so a user image fills it precisely. */
function buildShapeImageSlot(el: Element, index: number): ManifestSlot | null {
  const d = el.getAttribute("d");
  if (!d) return null;
  const local = pathBBox(d);
  if (!local || local.w <= 0 || local.h <= 0) return null;
  const m = accumulatedTransform(el);
  const slot: ManifestSlot = {
    id: el.getAttribute("id") || `image_${index}`, role: "image", type: "image",
    bbox: applyBBox(local, m),
  };
  // Only carry the clip shape when it is already in canvas space (no surprising
  // transform) so the stored `d` matches the bbox the renderer will use.
  if (isIdentity(m)) slot.clip = d;
  return slot;
}

export function normalizeSvg(svg: string, opts: NormalizeOptions): SlotManifest {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");

  const root = doc.getElementsByTagName("svg")[0];
  const viewBox = root?.getAttribute("viewBox")?.split(/\s+/).map(Number);
  const canvas: Canvas = {
    w: viewBox?.[2] ?? num(root!, "width") ?? 0,
    h: viewBox?.[3] ?? num(root!, "height") ?? 0,
  };

  const slots: ManifestSlot[] = [];
  const unmapped: UnmappedLayer[] = [];

  const texts = doc.getElementsByTagName("text");
  for (let i = 0; i < texts.length; i++) slots.push(buildTextSlot(texts[i]!));

  // Image slots: pattern-fill rects (placeholders) + standalone <image> outside
  // <defs>. The Checker.png inside <defs>/<pattern> is the texture, not a slot.
  let imgIdx = 0;
  const rects = doc.getElementsByTagName("rect");
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    const fill = r.getAttribute("fill") ?? "";
    if (fill.startsWith("url(#pattern") && !isInDefs(r)) slots.push(buildImageSlot(r, imgIdx++));
  }
  const images = doc.getElementsByTagName("image");
  for (let i = 0; i < images.length; i++) {
    if (!isInDefs(images[i]!)) slots.push(buildImageSlot(images[i]!, imgIdx++));
  }
  // Pattern-filled non-rect shapes — e.g. a device-mockup screen ("Insert Designs
  // here") drawn as a <path> with a notch/rounded clip. These were previously
  // missed (only <rect> was scanned), so the real fill target was lost.
  const paths = doc.getElementsByTagName("path");
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]!;
    const fill = p.getAttribute("fill") ?? "";
    if (!fill.startsWith("url(#pattern") || isInDefs(p)) continue;
    const slot = buildShapeImageSlot(p, imgIdx++);
    if (slot) slots.push(slot);
  }

  // Non-text/image layers with a semantic id → unmapped (kept in base template).
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    const tag = el.nodeName.toLowerCase();
    if (tag === "text" || tag === "image" || tag === "tspan") continue;
    const id = el.getAttribute("id");
    if (!id || PLUMBING_ID.test(id)) continue;
    const { role } = mapRole(id);
    if (role === "decoration" || role === "divider") {
      unmapped.push({ id, reason: role });
    }
  }

  return {
    layoutId: opts.layoutId,
    theme: opts.theme,
    canvas,
    baseTemplate: opts.baseTemplate,
    slots,
    unmapped,
  };
}
