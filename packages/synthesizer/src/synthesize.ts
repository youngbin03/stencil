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

/** metric-row: eyebrow + title (upper-left), then a row of KPI cards (lower band). */
function metricRow(system: DesignSystemIR, plan: SynthPlan): SynthResult {
  const { canvas, grammar, tokens } = system;
  const W = canvas.w, H = canvas.h;
  const lh = 1.15;
  const M = Math.max(grammar.alignmentGrid.margin, Math.round(W * 0.05));
  const tight = grammar.spacingRhythm.gaps.tight;
  const normal = grammar.spacingRhythm.gaps.normal;

  const block = plan.block ?? { id: "card_kpi_caption", cards: [] };
  const cardRoles = (system.blocks.find((b) => b.id === block.id)?.slots ?? [
    { role: "kpi" as Role }, { role: "caption" as Role },
  ]).map((s) => s.role);

  // --- upper-left text band (singles) ---
  const slots: PlacedSlot[] = [];
  const regions: Region[] = [];
  const singles: Record<string, string> = {};
  const defaultSlots: string[] = [];

  let y = Math.round(H * 0.13);
  if (plan.singles.eyebrow) {
    const fs = sizeFor(system, "eyebrow", 28);
    const h = Math.ceil(fs * lh);
    slots.push({ id: "eyebrow", role: "eyebrow", type: "text", bbox: { x: M, y, w: Math.round(W * 0.5), h }, align: "left", fontSize: fs, fontWeight: weightFor(system, "eyebrow", 600), color: tokens.colors.text });
    regions.push({ id: "header", bbox: { x: M, y, w: Math.round(W * 0.5), h }, flow: "row", gap: tight, allowedBlocks: [], slotIds: ["eyebrow"] });
    singles.eyebrow = plan.singles.eyebrow;
    defaultSlots.push("eyebrow");
    y += h + tight;
  }
  if (plan.singles.title) {
    const fs = sizeFor(system, "headline", 80);
    const h = Math.ceil(fs * lh * 2); // allow two lines
    slots.push({ id: "title", role: "title", type: "text", bbox: { x: M, y, w: Math.round(W * 0.62), h }, align: "left", fontSize: fs, fontWeight: weightFor(system, "title", 700), color: tokens.colors.text });
    regions.push({ id: "title", bbox: { x: M, y, w: Math.round(W * 0.62), h }, flow: "column", gap: normal, allowedBlocks: [], slotIds: ["title"] });
    singles.title = plan.singles.title;
    defaultSlots.push("title");
  }

  // --- lower KPI card row (block) ---
  const rowY = Math.round(H * 0.52);
  const rowBBox: BBox = { x: M, y: rowY, w: W - 2 * M, h: Math.round(H * 0.26) };
  const n = Math.max(1, block.cards.length || 3);
  const cardW = Math.min(Math.round((rowBBox.w - (n - 1) * normal) / n), Math.round(W * 0.28));

  const kpiSize = Math.min(sizeFor(system, "kpi", 96), Math.round(rowBBox.h * 0.42));
  const capSize = sizeFor(system, "caption", 28);
  const template: CardTemplateSlot[] = [];
  let dy = 0;
  for (const role of cardRoles) {
    const isKpi = role === "kpi";
    const fs = isKpi ? kpiSize : capSize;
    const h = Math.ceil(fs * lh * (isKpi ? 1 : 1.6));
    template.push({
      role, type: "text", dx: 0, dy, w: cardW, h,
      fontSize: fs, fontWeight: weightFor(system, role, isKpi ? 700 : 400),
      color: tokens.colors.text, align: "left",
    });
    dy += h + (isKpi ? tight : 0);
  }

  const cardSpec: CardSpec = {
    template, rowBBox, cardW, colY0: rowY, baseCount: n,
    roles: cardRoles, memberIds: [], decorationIds: [],
  };
  regions.push({ id: "cards", bbox: rowBBox, flow: "row", gap: normal, allowedBlocks: [block.id], slotIds: [], blockId: block.id });

  const layout: Layout = {
    id: `synth_${plan.archetype}_${system.theme}`,
    decorationRef: "",
    background: tokens.colors.bg,
    slots,
    cardSpec,
    regions,
    defaultSlots,
  };

  const placement: PlacementPlan = { layoutId: layout.id, cards: block.cards, singles };
  return { layout, placement };
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
