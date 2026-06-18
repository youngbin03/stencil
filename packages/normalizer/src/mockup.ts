import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import type { BBox } from "@stencil/ir";
import { accumulatedTransform, applyBBox } from "./transform.js";
import { pathBBox } from "./normalize.js";

/**
 * Device-mockup extraction. A mockup (e.g. an iPhone) in a Figma SVG is a frame
 * graphic (chassis/bezel) plus a separate "screen" shape ("Insert Designs here")
 * filled with a checker placeholder. We extract it as a self-contained, reusable
 * asset so synthesis can stamp the frame into NEW layouts and let a user drop an
 * image into the screen (clipped to its exact shape — rounded corners + notch).
 *
 * We DO NOT generate or insert the image; we only expose the empty screen slot.
 */

export interface MockupAsset {
  /** <defs> with exactly the patterns/images the device group references. */
  defs: string;
  /** The device group markup (chassis + checker screen), in original canvas coords. */
  body: string;
  /** Frame (chassis) bbox in canvas coords — the placement target box. */
  frameBBox: BBox;
  /** Screen fill shape as an SVG path `d` (canvas coords). */
  screenClip: string;
  /** Screen bbox in canvas coords. */
  screenBBox: BBox;
}

const SCREEN_ID = /screen|insert\s*design/i;
const DEVICE_ID = /iphone|ipad|mac\s?book|imac|apple\s*watch|android|pixel|galaxy|tablet|laptop|device|mockup/i;

/** Nearest ancestor <g> whose id names a device (the device group). */
function nearestDeviceGroup(el: Element): Element | null {
  let n: Element | null = el.parentNode as Element | null;
  while (n && n.nodeType === 1) {
    if (DEVICE_ID.test(n.getAttribute?.("id") ?? "")) return n;
    n = n.parentNode as Element | null;
  }
  return null;
}

function bboxOf(el: Element): BBox | null {
  const d = el.getAttribute("d");
  if (d) {
    const b = pathBBox(d);
    return b ? applyBBox(b, accumulatedTransform(el)) : null;
  }
  const x = Number(el.getAttribute("x") ?? "0"), y = Number(el.getAttribute("y") ?? "0");
  const w = Number(el.getAttribute("width") ?? "0"), h = Number(el.getAttribute("height") ?? "0");
  if (w <= 0 || h <= 0) return null;
  return applyBBox({ x, y, w, h }, accumulatedTransform(el));
}

/** Collect <defs> entries (transitively) referenced by an element's markup. */
function collectDefs(doc: Document, markup: string): string {
  const wanted = new Set<string>();
  const scan = (s: string): void => {
    for (const m of s.matchAll(/(?:url\(#|href="#|xlink:href="#)([A-Za-z0-9_.:-]+)/g)) wanted.add(m[1]!);
  };
  scan(markup);
  const byId = new Map<string, Element>();
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const id = all[i]!.getAttribute?.("id");
    if (id) byId.set(id, all[i]!);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...wanted];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const el = byId.get(id);
    if (!el) continue;
    const xml = el.toString();
    out.push(xml);
    for (const m of xml.matchAll(/(?:url\(#|href="#|xlink:href="#)([A-Za-z0-9_.:-]+)/g)) {
      if (!seen.has(m[1]!)) queue.push(m[1]!);
    }
  }
  return `<defs>${out.join("")}</defs>`;
}

/** Extract the first device mockup from an SVG, or null if none. */
export function extractMockupAsset(svg: string): MockupAsset | null {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  // Find the screen: a pattern-filled <path> whose id reads like an insert target.
  // The screen is a pattern-filled <path> (the notched rounded-rect). Figma may
  // name it ("Screen"/"Insert Designs") or leave it id-less inside an "Image" group
  // — so we accept any pattern path that sits inside a device group (id names a
  // device), falling back to the id heuristic. This handles both export styles.
  const paths = doc.getElementsByTagName("path");
  let screen: Element | null = null;
  let group: Element | null = null;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]!;
    if (!(p.getAttribute("fill") ?? "").startsWith("url(#pattern")) continue;
    const dg = nearestDeviceGroup(p);
    if (dg || SCREEN_ID.test(p.getAttribute("id") ?? "")) {
      screen = p;
      group = dg ?? (p.parentNode as Element | null);
      break;
    }
  }
  if (!screen) return null;
  const screenClip = screen.getAttribute("d");
  const screenBBox = bboxOf(screen);
  if (!screenClip || !screenBBox) return null;

  // The chassis (frame) bbox is the union of the device group's pattern-filled rects.
  const dev: Element = group ?? (screen.parentNode as Element | null) ?? screen;
  let frameBBox: BBox | null = null;
  const rects = dev.getElementsByTagName?.("rect");
  for (let i = 0; rects && i < rects.length; i++) {
    if ((rects[i]!.getAttribute("fill") ?? "").startsWith("url(#pattern")) {
      const b = bboxOf(rects[i]!);
      if (b) frameBBox = b;
    }
  }
  frameBBox = frameBBox ?? screenBBox;

  const body = dev.toString();
  const defs = collectDefs(doc, body);
  return { defs, body, frameBBox, screenClip, screenBBox };
}

/**
 * Render a placed mockup: stamp the frame scaled/translated into `target` (aspect
 * preserved), and — if a user image is given — overlay it clipped to the screen
 * shape. Returns the markup to inject (caller emits the `defs` once). When `image`
 * is omitted the screen stays empty (checker placeholder) for the user to fill.
 */
export function placeMockup(asset: MockupAsset, target: BBox, image?: string, screenFill?: string): { defs: string; markup: string } {
  const f = asset.frameBBox;
  const s = Math.min(target.w / f.w, target.h / f.h);
  // center within target
  const tx = target.x + (target.w - f.w * s) / 2;
  const ty = target.y + (target.h - f.h * s) / 2;
  const transform = `translate(${tx} ${ty}) scale(${s}) translate(${-f.x} ${-f.y})`;
  const sb = asset.screenBBox;
  const clipId = `mock_${Math.random().toString(36).slice(2, 8)}`;
  // With a real image: clip it to the screen shape. With no image: the asset's baked
  // "Insert Designs here" CHECKER placeholder would show through (reads as broken) — so
  // when a screenFill is given, paint the screen shape a clean solid to cover it.
  const overlay = image
    ? `<clipPath id="${clipId}"><path d="${asset.screenClip}"/></clipPath>` +
      `<image href="${image}" x="${sb.x}" y="${sb.y}" width="${sb.w}" height="${sb.h}" ` +
      `preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
    : screenFill
      ? `<path d="${asset.screenClip}" fill="${screenFill}"/>`
      : "";
  return { defs: asset.defs, markup: `<g transform="${transform}">${asset.body}${overlay}</g>` };
}
