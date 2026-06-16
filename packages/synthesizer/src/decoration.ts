import type { BBox, RenderSlide } from "@stencil/ir";
import type { GrammarSpec } from "./grammar.js";

/**
 * Decoration treatments (DEVDOC Phase 6). The synthesized text sits in a left/center
 * column, so treatments are anchored to the right / corners / bottom edge — bold,
 * palette-driven, and VARIED per slide so a deck never repeats the same background.
 * On-brand by construction (theme palette); never collides with the content column.
 */

function vivid(spec: GrammarSpec): string[] {
  const skip = new Set([spec.colors.bg.toLowerCase(), "#ffffff", "#fff", "white", spec.colors.text.toLowerCase(), "black", "#000000"]);
  const cols = (spec.palette ?? []).filter((c) => /^#/.test(c) && !skip.has(c.toLowerCase()));
  return cols.length ? cols : ["#5FA0FB"];
}

type Treatment = (w: number, h: number, c: string) => string;

const TREATMENTS: Treatment[] = [
  // big corner blob, top-right
  (w, h, c) => `<circle cx="${w}" cy="0" r="${Math.round(h * 0.46)}" fill="${c}"/>`,
  // big corner blob, bottom-right
  (w, h, c) => `<circle cx="${w}" cy="${h}" r="${Math.round(h * 0.5)}" fill="${c}"/>`,
  // bold right color field (two-tone)
  (w, h, c) => `<rect x="${Math.round(w * 0.68)}" y="0" width="${Math.round(w * 0.32)}" height="${h}" fill="${c}"/>`,
  // sweeping arc from the bottom-right
  (w, h, c) => `<path d="M ${w} ${h} L ${Math.round(w * 0.45)} ${h} Q ${w} ${h} ${w} ${Math.round(h * 0.25)} Z" fill="${c}"/>`,
  // two stacked blobs, top-right (uses a second palette colour)
  (w, h, c) => `<circle cx="${Math.round(w * 0.86)}" cy="${Math.round(-h * 0.06)}" r="${Math.round(h * 0.34)}" fill="${c}"/><circle cx="${w}" cy="${Math.round(h * 0.5)}" r="${Math.round(h * 0.16)}" fill="${c}" fill-opacity="0.55"/>`,
  // full-bleed wave across the bottom
  (w, h, c) => `<path d="M 0 ${h} L 0 ${Math.round(h * 0.86)} Q ${Math.round(w * 0.3)} ${Math.round(h * 0.74)} ${Math.round(w * 0.6)} ${Math.round(h * 0.84)} T ${w} ${Math.round(h * 0.8)} L ${w} ${h} Z" fill="${c}"/>`,
  // diagonal wedge, right edge
  (w, h, c) => `<path d="M ${w} 0 L ${w} ${h} L ${Math.round(w * 0.62)} ${h} Z" fill="${c}"/>`,
];

/** A varied, on-brand decoration SVG for slide `index` of archetype `archetype`. */
export function synthDecoration(spec: GrammarSpec, archetype: string, index: number): string {
  const { w, h } = spec.canvas;
  const cols = vivid(spec);
  const pool = ["stat", "content", "agenda"].includes(archetype) ? [0, 2, 4, 6] : [0, 1, 3, 4, 6];
  const t = TREATMENTS[pool[index % pool.length]!]!;
  const c = cols[index % cols.length]!;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${w}" height="${h}" fill="${spec.colors.bg}"/>${t(w, h, c)}</svg>`;
}

/** Distance from a point to a box (0 inside). */
function distToBox(px: number, py: number, b: BBox): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * Principled, EXPLAINABLE decoration: a corner blob placed in the corner with the
 * largest clearance from the slide's content, sized to that clearance (so it never
 * overlaps text/cards/images) and filled from the theme palette. Returns the SVG
 * plus a human reason for why this asset landed here.
 */
export function chooseDecoration(spec: GrammarSpec, slide: RenderSlide, archetype: string, index: number): { svg: string; reason: string } {
  const { w, h } = spec.canvas;
  const bgSvg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${spec.colors.bg}"/>`;

  // Amount of decoration is the THEME'S habit, not forced. Reproduce this
  // archetype's measured coverage; if its examples are barely decorated, add none.
  const profile = spec.archetypes.find((a) => a.archetype === archetype)?.decoration ?? { coverage: 0, count: 0 };
  if (profile.coverage < 0.02) {
    return { svg: bgSvg + "</svg>", reason: `theme keeps '${archetype}' slides undecorated (measured coverage ${(profile.coverage * 100).toFixed(0)}%) — none added` };
  }

  const cols = vivid(spec);
  const c = cols[index % cols.length]!;
  const content = slide.elements.map((e) => e.bbox).filter((b) => b.w > 0 && b.h > 0);
  const corners: { name: string; x: number; y: number }[] = [
    { name: "top-right", x: w, y: 0 }, { name: "bottom-right", x: w, y: h },
    { name: "bottom-left", x: 0, y: h }, { name: "top-left", x: 0, y: 0 },
  ];
  let best = corners[0]!, bestR = 0;
  for (const k of corners) {
    const r = content.length ? Math.min(...content.map((b) => distToBox(k.x, k.y, b))) : h * 0.5;
    if (r > bestR) { bestR = r; best = k; }
  }
  // Target radius from the theme's coverage (area of a quarter-disc ≈ πr²/4),
  // capped by the clearance so it never overlaps content.
  const target = Math.sqrt((profile.coverage * w * h * 4) / Math.PI);
  // Don't let decoration overwhelm sparse content: tie the cap to how much of the
  // canvas the content actually fills, so a near-empty slide gets a modest accent,
  // not a giant shape (e.g. a one-line stat shouldn't sit under a half-canvas disc).
  const contentCover = content.reduce((s, b) => s + Math.min(b.w * b.h, w * h), 0) / (w * h);
  const contentCap = h * (contentCover < 0.06 ? 0.30 : contentCover < 0.14 ? 0.45 : 0.7);
  const r = Math.round(Math.min(bestR * 0.95, target, contentCap));
  const shape = r > 50 ? `<circle cx="${best.x}" cy="${best.y}" r="${r}" fill="${c}"/>` : "";
  const reason = r > 50
    ? `theme decorates '${archetype}' ~${(profile.coverage * 100).toFixed(0)}% → ${best.name} blob r=${r}px (clear), fill ${c}`
    : `theme decoration for '${archetype}' is light and the layout is dense — none added`;
  return { svg: bgSvg + shape + "</svg>", reason };
}
