import type {
  Block, BlockSlot, BBox, Canvas, CardSpec, CardTemplateSlot, DecorationModel, DesignGrammar,
  FlowDirection, ManifestSlot, Region, RelationGraph, SlotType, TextAlign,
} from "@stencil/ir";

/**
 * Block + region + card-spec extraction (the "lost half" of re-composition).
 * One robust card detector feeds blocks, regions, and the assembler's cardSpec —
 * no second implementation in the solver. Robustness rules:
 *  - a card is a COMPOSITE column (≥2 slots) repeated ≥2 times; a single-role
 *    row (e.g. footers) is NOT a card.
 *  - the card's cloned decoration must be size-compatible with the card column
 *    (rejects giant background curves that would cover the slide).
 */

const COL_TOL = 80;
const DECO_RATIO_MIN = 0.25;
const DECO_RATIO_MAX = 4;

function union(boxes: BBox[]): BBox {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function area(b: BBox): number { return b.w * b.h; }
function xOverlaps(a: BBox, b: BBox): boolean { return a.x < b.x + b.w && b.x < a.x + a.w; }
function overlapArea(a: BBox, b: BBox): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

interface Card {
  columns: ManifestSlot[][];
  roles: { role: string; type: SlotType }[];
  memberIds: string[];
  colX0: number;
  colY0: number;
}

/** The repeatable composite card, or null. Single-role rows are rejected. */
function detectCard(slots: ManifestSlot[], graph: RelationGraph | undefined): Card | null {
  if (!graph) return null;
  const byId = new Map(slots.map((s) => [s.id, s]));
  const rows = graph.edges.filter((e) => e.type === "row" && e.nodes && e.nodes.length >= 2);
  if (!rows.length) return null;
  const maxCount = Math.max(...rows.map((r) => r.nodes!.length));
  const cardRows = rows.filter((r) => r.nodes!.length === maxCount);
  const memberIds = [...new Set(cardRows.flatMap((r) => r.nodes!))].filter((id) => byId.has(id));
  if (memberIds.length < maxCount) return null;

  const members = memberIds.map((id) => byId.get(id)!);
  const byX = [...members].sort((a, b) => a.bbox.x - b.bbox.x);
  const columns: ManifestSlot[][] = [];
  for (const s of byX) {
    const c = columns.find((col) => Math.abs(col[0]!.bbox.x - s.bbox.x) <= COL_TOL);
    if (c) c.push(s); else columns.push([s]);
  }
  if (columns.length < 2) return null;
  // Composite requirement: each column must carry ≥2 slots (else it's a plain
  // single-role row like footers, not a card).
  if (columns.some((c) => c.length < 2)) return null;

  const first = columns[0]!;
  const colX0 = Math.min(...first.map((s) => s.bbox.x));
  const colY0 = Math.min(...members.map((s) => s.bbox.y));
  return { columns, roles: first.map((s) => ({ role: s.role, type: s.type })), memberIds, colX0, colY0 };
}

export function extractBlocks(slots: ManifestSlot[], graph: RelationGraph | undefined): Block[] {
  const card = detectCard(slots, graph);
  if (!card) return [];
  const blockSlots: BlockSlot[] = card.roles.map((r) => ({ role: r.role as BlockSlot["role"], type: r.type }));
  return [{
    id: `card_${card.roles.map((r) => r.role).join("_")}`,
    bbox: union(card.columns[0]!.map((s) => s.bbox)),
    repeatable: true,
    slots: blockSlots,
  }];
}

/** Full card spec for the assembler (template + decoration), size-filtered. */
export function extractCardSpec(
  slots: ManifestSlot[], graph: RelationGraph | undefined, decoration: DecorationModel | undefined,
): CardSpec | undefined {
  const card = detectCard(slots, graph);
  if (!card) return undefined;
  const { columns, colX0, colY0, memberIds } = card;
  const first = columns[0]!;
  const cardW = Math.max(...first.map((s) => s.bbox.x + s.bbox.w)) - colX0;
  const rowBBox = union(columns.flat().map((s) => s.bbox));

  const template: CardTemplateSlot[] = first.map((s) => {
    const t: CardTemplateSlot = {
      role: s.role, type: s.type, dx: s.bbox.x - colX0, dy: s.bbox.y - colY0,
      w: s.bbox.w, h: s.bbox.h, align: (s.align ?? "left") satisfies TextAlign,
    };
    if (s.fontSize !== undefined) t.fontSize = s.fontSize;
    if (s.fontFamily) t.fontFamily = s.fontFamily;
    if (s.fontWeight !== undefined) t.fontWeight = s.fontWeight;
    if (s.color) t.color = s.color;
    if (s.letterSpacing) t.letterSpacing = s.letterSpacing;
    return t;
  });

  // Card decoration: per-column emphasis/accent/image_holder with a SIZE FILTER
  // (reject giant background curves). All columns must match for cloning.
  const deco = (decoration?.elements ?? []).filter((d) => d.kind === "emphasis" || d.kind === "accent" || d.kind === "image_holder");
  const matchFor = (col: ManifestSlot[]): { id: string; bbox: BBox; color: string } | undefined => {
    const cb = union(col.map((s) => s.bbox));
    let best: typeof deco[number] | undefined;
    let bestA = 0;
    for (const d of deco) {
      const ov = overlapArea(cb, d.bbox);
      const ratio = area(d.bbox) / Math.max(1, area(cb));
      if (ov > bestA && ratio >= DECO_RATIO_MIN && ratio <= DECO_RATIO_MAX) { bestA = ov; best = d; }
    }
    return bestA > 0 && best ? { id: best.id, bbox: best.bbox, color: best.color ?? "#000000" } : undefined;
  };
  const matched = columns.map(matchFor);
  const spec: CardSpec = {
    template, rowBBox, cardW, colY0, baseCount: columns.length,
    roles: template.map((t) => t.role), memberIds, decorationIds: [],
  };
  if (matched.every(Boolean) && matched[0]) {
    spec.decorationIds = matched.map((m) => m!.id);
    const d0 = matched[0]!;
    spec.cardDecoration = { dx: d0.bbox.x - colX0, dy: d0.bbox.y - colY0, w: d0.bbox.w, h: d0.bbox.h, fill: d0.color };
  }
  return spec;
}

function flowOf(slots: ManifestSlot[]): FlowDirection {
  if (slots.length < 2) return "column";
  const xs = slots.map((s) => s.bbox.x).sort((a, b) => a - b);
  return xs[xs.length - 1]! - xs[0]! > 200 ? "row" : "column";
}

/** Semantic zones: header / title / cards / body / footer. */
export function extractRegions(
  slots: ManifestSlot[], graph: RelationGraph | undefined, grammar: DesignGrammar, canvas: Canvas,
): Region[] {
  const content = slots.filter((s) => s.type === "text" || s.type === "image");
  const gap = grammar.spacingRhythm.gaps.normal;
  const card = detectCard(slots, graph);
  const cardSet = new Set(card?.memberIds ?? []);

  const header = content.filter((s) => s.bbox.y < canvas.h * 0.15 && !cardSet.has(s.id));
  const footer = content.filter((s) => s.bbox.y > canvas.h * 0.85 && !cardSet.has(s.id));
  const stripIds = new Set([...header, ...footer].map((s) => s.id));
  const mid = content.filter((s) => !stripIds.has(s.id) && !cardSet.has(s.id));

  const titleSlot = [...mid].filter((s) => s.type === "text").sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0))[0];
  const title = titleSlot ? [titleSlot] : [];
  const titleIds = new Set(title.map((s) => s.id));
  const body = mid.filter((s) => !titleIds.has(s.id));

  const regions: Region[] = [];
  const add = (id: string, list: ManifestSlot[], flow: FlowDirection, blockId?: string): void => {
    if (!list.length) return;
    const region: Region = {
      id, bbox: union(list.map((s) => s.bbox)), flow, gap, allowedBlocks: blockId ? [blockId] : [],
      slotIds: list.map((s) => s.id),
    };
    if (blockId) region.blockId = blockId;
    regions.push(region);
  };

  add("header", header, "row");
  add("title", title, "column");
  if (card) {
    const blockId = `card_${card.roles.map((r) => r.role).join("_")}`;
    add("cards", slots.filter((s) => cardSet.has(s.id)), "row", blockId);
  }
  add("body", body, flowOf(body));
  add("footer", footer, "row");

  // Growth limits: each region may reflow down until it meets an obstacle —
  // the canvas safe margin, the next region below, or an image slot (text must
  // never flow onto an image). Decoration is left out of v1 (text often sits
  // over it by design). x-span follows the region's own column.
  const margin = grammar.alignmentGrid.margin;
  const imageBoxes = slots.filter((s) => s.type === "image").map((s) => s.bbox);
  for (const r of regions) {
    const below = r.bbox.y + r.bbox.h;
    let bottom = canvas.h - margin;
    for (const o of regions) {
      if (o.id === r.id || o.bbox.y < below || !xOverlaps(r.bbox, o.bbox)) continue;
      bottom = Math.min(bottom, o.bbox.y - gap);
    }
    for (const ib of imageBoxes) {
      if (ib.y < below || !xOverlaps(r.bbox, ib)) continue;
      bottom = Math.min(bottom, ib.y - gap);
    }
    bottom = Math.max(below, bottom); // never above the region's own bottom
    r.safeArea = { x: r.bbox.x, y: r.bbox.y, w: r.bbox.w, h: bottom - r.bbox.y };
  }
  return regions;
}
