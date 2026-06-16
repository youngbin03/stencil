import type {
  BBox, CardSpec, CardTemplateSlot, DesignSystemIR, Layout, PlacedSlot, PlacementPlan, Region, Role, TextAlign,
} from "@stencil/ir";

/**
 * Layout synthesis (DEVDOC Phase 6, PoC). Composes a NEW page from design-system
 * primitives — composition archetype + blocks + grammar — that equals no original
 * frame. Output is a synthetic Layout + PlacementPlan; the existing solver
 * (solveDeckSlide) and renderer assemble it. Coordinate-free above this line: the
 * archetype + grammar generate all geometry deterministically.
 */

export interface SynthPlan {
  /** Composition archetype (PoC: "metric-row"). */
  archetype: string;
  /** Fixed single texts by role (eyebrow, title, …). */
  singles: Partial<Record<Role, string>>;
  /** The repeated block id + its per-card content (role → text). */
  block?: { id: string; cards: Record<string, string>[] };
}

export interface SynthResult {
  layout: Layout;
  placement: PlacementPlan;
}

function sizeFor(system: DesignSystemIR, role: Role, fallback: number): number {
  const rank = system.grammar.hierarchy.ranks.find((r) => r.role === role);
  return rank?.size ?? system.tokens.type[role]?.size ?? fallback;
}
function weightFor(system: DesignSystemIR, role: Role, fallback: number): number {
  const rank = system.grammar.hierarchy.ranks.find((r) => r.role === role);
  return rank?.weight ?? system.tokens.type[role]?.weight ?? fallback;
}
/** Snap a coordinate to the theme's measured alignment guides (its real grid). */
function snap(guides: number[], v: number, tol = 60): number {
  let best = v, bestD = tol;
  for (const g of guides) { const d = Math.abs(g - v); if (d < bestD) { best = g; bestD = d; } }
  return best;
}
/** A measured card spec from the system that contains `role` — reuse its real
 * internal geometry (offsets/sizes/coupled spacing) instead of inventing it. */
function exemplarCardSpec(system: DesignSystemIR, role: Role): CardSpec | undefined {
  return system.layouts.map((l) => l.cardSpec).find((cs): cs is CardSpec => !!cs && cs.roles.includes(role));
}

/**
 * metric-row: eyebrow + title in the top band, a row of KPI cards in the band the
 * THEME actually uses for metrics. All geometry comes from the design system —
 * left edge + columns from alignmentGrid.xGuides, vertical bands snapped to
 * yGuides, gaps from spacingRhythm, and the card internals reused verbatim from a
 * measured kpi cardSpec (the theme's real kpi↕caption coupling). No magic numbers.
 */
function metricRow(system: DesignSystemIR, plan: SynthPlan): SynthResult {
  const { canvas, grammar, tokens } = system;
  const W = canvas.w, H = canvas.h, lh = 1.15;
  const xG = grammar.alignmentGrid.xGuides, yG = grammar.alignmentGrid.yGuides;
  const { tight, loose } = grammar.spacingRhythm.gaps;
  const M = snap(xG, grammar.alignmentGrid.margin, 80); // structural left edge

  const block = plan.block ?? { id: "card_kpi_caption", cards: [] };
  const ex = exemplarCardSpec(system, "kpi"); // theme's measured kpi card
  const cardRoles: Role[] = ex?.roles ?? (system.blocks.find((b) => b.id === block.id)?.slots.map((s) => s.role) ?? ["kpi", "caption"]);

  // --- card internals: reuse the theme's MEASURED kpi card (offsets/sizes/coupling) ---
  const n = Math.max(1, block.cards.length || ex?.baseCount || 3);
  const cardW = ex?.cardW ?? Math.round(W * 0.28);
  const rowH = ex ? ex.rowBBox.h : Math.round(H * 0.22);
  const template: CardTemplateSlot[] = ex
    ? ex.template.map((t) => ({ ...t }))
    : cardRoles.map((role, i) => ({
        role, type: "text" as const, dx: 0, dy: i * (sizeFor(system, role, 60) * lh + tight),
        w: cardW, h: Math.ceil(sizeFor(system, role, 60) * lh * (role === "kpi" ? 1 : 1.6)),
        fontSize: sizeFor(system, role, 60), fontWeight: weightFor(system, role, role === "kpi" ? 700 : 400),
        color: tokens.colors.text, align: "left" as TextAlign,
      }));

  // --- vertical rhythm: lay the zones relative to 0, then center the whole group
  // in the canvas so the page is balanced (no top-heavy gap). Horizontals stay on
  // the grid; gaps come from spacingRhythm; card internals stay measured. ---
  const eyFs = sizeFor(system, "eyebrow", 28), eyH = Math.ceil(eyFs * lh);
  const tFs = sizeFor(system, "headline", 80), tH = Math.ceil(tFs * lh * 2);
  let rel = 0;
  const eyRel = plan.singles.eyebrow ? rel : -1;
  if (plan.singles.eyebrow) rel += eyH + tight;
  const tRel = plan.singles.title ? rel : -1;
  if (plan.singles.title) rel += tH + loose;
  const rowRel = rel;
  rel += rowH;
  const top = snap(yG, Math.max(grammar.alignmentGrid.margin, Math.round((H - rel) / 2)), 40);

  const slots: PlacedSlot[] = [];
  const regions: Region[] = [];
  const singles: Record<string, string> = {};
  const defaultSlots: string[] = [];

  if (eyRel >= 0) {
    const bbox: BBox = { x: M, y: top + eyRel, w: Math.round(W * 0.5), h: eyH };
    slots.push({ id: "eyebrow", role: "eyebrow", type: "text", bbox, align: "left", fontSize: eyFs, fontWeight: weightFor(system, "eyebrow", 600), color: tokens.colors.text });
    regions.push({ id: "header", bbox, flow: "row", gap: tight, allowedBlocks: [], slotIds: ["eyebrow"] });
    singles.eyebrow = plan.singles.eyebrow!;
    defaultSlots.push("eyebrow");
  }
  if (tRel >= 0) {
    const bbox: BBox = { x: M, y: top + tRel, w: Math.round(W * 0.62), h: tH };
    slots.push({ id: "title", role: "title", type: "text", bbox, align: "left", fontSize: tFs, fontWeight: weightFor(system, "title", 700), color: tokens.colors.text });
    regions.push({ id: "title", bbox, flow: "column", gap: loose, allowedBlocks: [], slotIds: ["title"] });
    singles.title = plan.singles.title!;
    defaultSlots.push("title");
  }

  const rowY = top + rowRel;
  const rowBBox: BBox = { x: M, y: rowY, w: W - 2 * M, h: rowH };
  const cardSpec: CardSpec = { template, rowBBox, cardW, colY0: rowY, baseCount: n, roles: cardRoles, memberIds: [], decorationIds: [] };
  regions.push({ id: "cards", bbox: rowBBox, flow: "row", gap: grammar.spacingRhythm.gaps.normal, allowedBlocks: [block.id], slotIds: [], blockId: block.id });

  const layout: Layout = {
    id: `synth_${plan.archetype}_${system.theme}`,
    decorationRef: "", background: tokens.colors.bg,
    slots, cardSpec, regions, defaultSlots,
  };
  return { layout, placement: { layoutId: layout.id, cards: block.cards, singles } };
}

export function synthesize(system: DesignSystemIR, plan: SynthPlan): SynthResult {
  switch (plan.archetype) {
    case "metric-row":
      return metricRow(system, plan);
    default:
      throw new Error(`unknown archetype "${plan.archetype}"`);
  }
}

/**
 * Anchor-compatible decoration pick (R2 mitigation, v1 whole-reuse): choose the
 * theme decoration whose non-background elements least overlap the synthesized
 * content regions, so a borrowed treatment does not collide with the new layout.
 */
export function pickDecorationFrame(system: DesignSystemIR, contentRegions: BBox[]): string | undefined {
  function overlap(a: BBox, b: BBox): number {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return w * h;
  }
  let best: string | undefined;
  let bestScore = Infinity;
  for (const L of system.layouts) {
    const els = (L.decorationModel?.elements ?? []).filter((d) => d.kind !== "background");
    if (els.length === 0) continue;
    let score = 0;
    for (const d of els) for (const r of contentRegions) score += overlap(d.bbox, r);
    if (score < bestScore) { bestScore = score; best = L.id; }
  }
  return best;
}
