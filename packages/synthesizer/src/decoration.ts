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

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * A VARIED corner composition (not always a plain circle) anchored at corner
 * (cx,cy), drawn within radius `r` so it stays clear of content. `sx,sy` point
 * into the slide. Uses two palette colours for richer, on-brand decoration that
 * differs slide-to-slide and archetype-to-archetype.
 */
function cornerArt(v: number, cx: number, cy: number, r: number, sx: number, sy: number, c: string, c2: string, bg: string): string {
  const ix = (f: number): number => Math.round(cx + sx * r * f);
  const iy = (f: number): number => Math.round(cy + sy * r * f);
  const sw = Math.max(8, Math.round(r * 0.07));
  switch (((v % 6) + 6) % 6) {
    case 1: // blob + small accent dot
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/><circle cx="${ix(0.52)}" cy="${iy(0.52)}" r="${Math.round(r * 0.26)}" fill="${c2}"/>`;
    case 2: // blob + concentric outline ring
      return `<circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.95)}" fill="${c}"/><circle cx="${ix(0.4)}" cy="${iy(0.4)}" r="${Math.round(r * 0.44)}" fill="none" stroke="${c2}" stroke-width="${sw}"/>`;
    case 3: // organic ellipse
      return `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${Math.round(r * 0.78)}" fill="${c}"/>`;
    case 4: // twin overlapping blobs, two colours
      return `<circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.9)}" fill="${c}"/><circle cx="${ix(0.55)}" cy="${iy(0.3)}" r="${Math.round(r * 0.36)}" fill="${c2}" fill-opacity="0.9"/>`;
    case 5: // crescent (carved with a bg-coloured cutout)
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/><circle cx="${ix(0.58)}" cy="${iy(0.58)}" r="${Math.round(r * 0.6)}" fill="${bg}"/>`;
    default: // single blob
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
  }
}

/** A real decoration shape mined from a theme slide — the organic `<g Decorative>`
 *  path(s), with their ink bbox and palette colours. Reused (recoloured, placed
 *  clear of content) so synthesized backgrounds use the theme's ACTUAL free-form
 *  shapes, not generated circles. */
export interface DecoFrag { id: string; frag: string; bbox: BBox; colors: string[]; archetype?: string; bg?: string }

function recolor(frag: string, c: string): string {
  return frag.replace(/fill="#[0-9a-fA-F]{3,6}"/g, `fill="${c}"`);
}

/**
 * Reuse a REAL theme decoration shape: pick an organic fragment whose ink avoids
 * the slide's content, recolour it to a palette hue (variety), and place it as the
 * background. Falls back to the synthesized composition when no fragment fits or no
 * library is available — so output is never worse than before.
 */
export function pickDecoration(spec: GrammarSpec, slide: RenderSlide, archetype: string, index: number, lib: DecoFrag[], obstacles: BBox[] = []): { svg: string; reason: string; bg?: string } {
  const { w, h } = spec.canvas;
  const profile = spec.archetypes.find((a) => a.archetype === archetype)?.decoration ?? { coverage: 0, count: 0, treatments: [] };
  if (profile.coverage < 0.02 || !lib?.length) {
    return profile.coverage < 0.02
      ? { svg: `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${spec.colors.bg}"/></svg>`, reason: `theme keeps '${archetype}' undecorated` }
      : chooseDecoration(spec, slide, archetype, index);
  }
  // Obstacles include device-mockup/image zones (injected after solve, so absent from
  // slide.elements) — without them the decoration would land on a device.
  const content = [...slide.elements.map((e) => e.bbox), ...obstacles].filter((b) => b.w > 0 && b.h > 0);
  const cu = content.length
    ? { x: Math.min(...content.map((b) => b.x)), y: Math.min(...content.map((b) => b.y)), x1: Math.max(...content.map((b) => b.x + b.w)), y1: Math.max(...content.map((b) => b.y + b.h)) }
    : null;
  // Fraction of a (translated) shape's ON-CANVAS area that sits over the content mass.
  const overlap = (b: BBox): number => {
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(w, b.x + b.w), y1 = Math.min(h, b.y + b.h);
    const a = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    if (!cu || a <= 0) return 0;
    const ix = Math.max(0, Math.min(x1, cu.x1) - Math.max(x0, cu.x));
    const iy = Math.max(0, Math.min(y1, cu.y1) - Math.max(y0, cu.y));
    return (ix * iy) / a;
  };
  const big = lib.filter((f) => f.bbox.w > 120 && f.bbox.h > 120);
  if (!big.length) return chooseDecoration(spec, slide, archetype, index);
  const t = profile.treatments?.[0];
  const tIds = new Set(t?.shapeIds ?? []);
  const ranked = [...big].sort((a, b) => (a.id < b.id ? -1 : 1));
  // A theme decoration is designed to bleed off the edges at its NATIVE position +
  // size — that IS the grammar, so we keep both (no rescale, no reposition). We only
  // SELECT a shape that lands clear of this slide's content. The archetype's own
  // shapes are tried first (their decoration was authored to clear that archetype's
  // content, so it clears the synthesized content too) → on-brand AND varied.
  const tMatched = ranked.filter((f) => tIds.has(f.id));
  const tryPick = (arr: DecoFrag[]): DecoFrag | undefined => {
    // Full-colour-bg shapes are WHITE = same colour as the (flipped) text, so they
    // must NOT sit under any text → near-zero overlap. Normal shapes allow a little.
    for (let k = 0; k < arr.length; k++) { const f = arr[(index + k) % arr.length]!; if (overlap(f.bbox) < (f.bg ? 0.03 : 0.18)) return f; }
    return undefined;
  };
  const chosen = tryPick(tMatched) ?? tryPick(ranked);
  if (!chosen) {
    return { svg: `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${spec.colors.bg}"/></svg>`, reason: `dense '${archetype}' layout — no clear room for decoration` };
  }
  // Full-colour-background variant: the source slide painted the whole canvas a
  // palette colour with WHITE decoration. Reproduce it (bg = the colour, shape =
  // white); the caller flips text to a contrasting colour. Otherwise: light bg +
  // recoloured shape.
  const variant = chosen.bg;
  const bgFill = variant ?? spec.colors.bg;
  const c = variant ? "#FFFFFF" : vivid(spec)[index % vivid(spec).length]!;
  const why = t ? `${t.kind}@${t.anchor}` : "pool";
  const out: { svg: string; reason: string; bg?: string } = {
    svg: `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${bgFill}"/><g>${recolor(chosen.frag, c)}</g></svg>`,
    reason: `'${archetype}' deco [${why}] → shape '${chosen.id}' native${variant ? `, FULL-COLOUR bg ${variant} + white` : `, ${c}`}`,
  };
  if (variant) out.bg = variant;
  return out;
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
  const c2 = (cols.length > 1 ? cols[(index + 2) % cols.length] : undefined) ?? c;
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
  const sx = best.x === 0 ? 1 : -1, sy = best.y === 0 ? 1 : -1;
  const variant = index + hashStr(archetype);
  const shape = r > 50 ? cornerArt(variant, best.x, best.y, r, sx, sy, c, c2, spec.colors.bg) : "";
  const reason = r > 50
    ? `theme decorates '${archetype}' ~${(profile.coverage * 100).toFixed(0)}% → ${best.name} composition r=${r}px (clear), fill ${c}${c2 !== c ? ` + ${c2}` : ""}`
    : `theme decoration for '${archetype}' is light and the layout is dense — none added`;
  return { svg: bgSvg + shape + "</svg>", reason };
}
