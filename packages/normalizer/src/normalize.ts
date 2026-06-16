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
