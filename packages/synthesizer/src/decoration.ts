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
  // Bottom-wave (treatment 5) overlaps the footer band — avoid it for footer-bearing
  // archetypes; otherwise rotate treatments + colours so consecutive slides differ.
  const pool = ["stat", "content", "agenda"].includes(archetype) ? [0, 2, 4, 6] : [0, 1, 3, 4, 6];
  const t = TREATMENTS[pool[index % pool.length]!]!;
  const c = cols[index % cols.length]!;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${w}" height="${h}" fill="${spec.colors.bg}"/>${t(w, h, c)}</svg>`;
}
