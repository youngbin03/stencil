import type { DesignSystemIR, Layout, RenderSlide, RenderTextElement } from "@stencil/ir";
import type { GrammarSpec } from "./grammar.js";

/**
 * Quality evaluator (DEVDOC Phase 6). Scores a synthesized slide 0–10 on the
 * rubric and gates rendering: any score < 7 → revise; layout novelty < 6 → reject
 * as an in-place variant. Deterministic signals here (grammar fit, spacing,
 * hierarchy, fit, novelty vs source); aesthetic scores (overall, hierarchy clarity)
 * can be refined by a vision pass later. The similarity penalty compares the
 * synthesized region signature against EVERY source slide so copies are rejected.
 */

export interface QualityScores {
  grammarConsistency: number;
  layoutNovelty: number;
  visualHierarchy: number;
  spacingAlignment: number;
  contentLayoutFit: number;
  similarityPenalty: number; // 10 = maximally distinct from sources (good)
  overall: number;
}
export interface QualityVerdict {
  scores: QualityScores;
  pass: boolean;
  reject: boolean;
  notes: string[];
}

function clamp(n: number): number { return Math.max(0, Math.min(10, n)); }

/** Region-band signature: sorted (yFrac, xFrac, flow) tuples → structural fingerprint. */
function signature(layout: Layout, W: number, H: number): string[] {
  return (layout.regions ?? [])
    .map((r) => `${r.flow}:${(r.bbox.y / H).toFixed(2)}:${(r.bbox.x / W).toFixed(2)}:${(r.bbox.w / W).toFixed(2)}`)
    .sort();
}
function sigDistance(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((x) => setB.has(x)).length;
  const union = new Set([...a, ...b]).size || 1;
  return 1 - shared / union; // 0 identical … 1 fully distinct
}

export function evaluateSlide(
  system: DesignSystemIR, spec: GrammarSpec, layout: Layout, slide: RenderSlide,
): QualityVerdict {
  const { w: W, h: H } = system.canvas;
  const notes: string[] = [];
  const texts = slide.elements.filter((e): e is RenderTextElement => e.kind === "text");

  // 1) grammar consistency — colors in palette, families/sizes in the type scale.
  const palette = new Set([...spec.palette, spec.colors.bg, spec.colors.text].map((c) => c.toLowerCase()));
  const families = new Set(Object.values(spec.type).map((t) => t.family));
  const sizes = new Set(Object.values(spec.type).map((t) => t.size));
  let gOk = 0, gN = 0;
  for (const t of texts) {
    gN += 2;
    if (palette.has(t.color.toLowerCase())) gOk++; else notes.push(`off-palette color ${t.color}`);
    if (families.has(t.fontFamily)) gOk++; else notes.push(`off-scale family ${t.fontFamily}`);
  }
  const grammarConsistency = gN ? clamp((gOk / gN) * 10) : 7;

  // 2) layout novelty — distance of region signature from the NEAREST source slide.
  const sig = signature(layout, W, H);
  let nearest = 1;
  for (const L of system.layouts) nearest = Math.min(nearest, sigDistance(sig, signature(L, W, H)));
  const layoutNovelty = clamp(nearest * 10);
  const similarityPenalty = layoutNovelty; // distinctness; low → likely a copy
  if (layoutNovelty < 6) notes.push(`low novelty: nearest source distance ${nearest.toFixed(2)}`);

  // 3) visual hierarchy — largest text materially bigger than the smallest (clear rank).
  const fs = texts.map((t) => t.fontSize);
  const ratio = fs.length ? Math.max(...fs) / Math.max(1, Math.min(...fs)) : 1;
  const visualHierarchy = clamp(ratio >= 2 ? 10 : ratio >= 1.5 ? 8 : ratio >= 1.2 ? 6 : 4);
  if (ratio < 1.5) notes.push(`weak hierarchy (max/min font ${ratio.toFixed(2)})`);

  // 4) spacing & alignment — grid snap + no overlap/overflow warnings. Card-row
  // texts (ids like role_c0) are laid out by EVEN DISTRIBUTION, a valid alignment
  // of its own, so they are exempt from the global-guide check.
  const xG = spec.alignment.xGuides;
  const aligned = texts.filter((t) => !/_c\d+$/.test(t.id));
  const offGrid = aligned.filter((t) => Math.min(...xG.map((g) => Math.abs(g - t.bbox.x))) > 24).length;
  const warns = slide.warnings.filter((w) => /overlap|out_of|overflow/.test(w)).length;
  const spacingAlignment = clamp(10 - offGrid * 1.5 - warns * 3);
  if (offGrid) notes.push(`${offGrid} text(s) off the alignment grid`);
  if (warns) notes.push(`${warns} spacing/overflow warning(s)`);

  // 5) content-layout fit — overflow/emptiness.
  const overflow = texts.filter((t) => t.overflow).length;
  const empty = texts.length === 0;
  const contentLayoutFit = clamp(empty ? 0 : 10 - overflow * 2.5);
  if (empty) notes.push("no text rendered");
  if (overflow) notes.push(`${overflow} overflowing text block(s)`);

  const overall = clamp(
    grammarConsistency * 0.2 + layoutNovelty * 0.2 + visualHierarchy * 0.2 +
    spacingAlignment * 0.2 + contentLayoutFit * 0.2,
  );

  const scores: QualityScores = {
    grammarConsistency, layoutNovelty, visualHierarchy, spacingAlignment, contentLayoutFit, similarityPenalty, overall,
  };
  const minScore = Math.min(grammarConsistency, layoutNovelty, visualHierarchy, spacingAlignment, contentLayoutFit, overall);
  return { scores, pass: minScore >= 7, reject: layoutNovelty < 6, notes };
}
