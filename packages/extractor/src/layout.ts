import type {
  Block, BlockSlot, BBox, Canvas, DesignGrammar, FlowDirection,
  ManifestSlot, Region, RelationGraph, SlotType,
} from "@stencil/ir";

/**
 * Block + region extraction (the "lost half" of re-composition). Turns measured
 * slots + the relation graph into:
 *  - blocks: reusable repeatable components (e.g. a stat card)
 *  - regions: semantic zones (header / title / cards / body / footer) with flow
 * so the assembler composes by zone+flow+block instead of pinning raw slot bboxes.
 */

const COL_TOL = 80;

function union(boxes: BBox[]): BBox {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The repeatable card (uniform-role row of max cardinality) + its members. */
function detectCard(slots: ManifestSlot[], graph: RelationGraph | undefined): { roles: { role: string; type: SlotType }[]; memberIds: string[]; bbox: BBox } | null {
  if (!graph) return null;
  const byId = new Map(slots.map((s) => [s.id, s]));
  const rows = graph.edges.filter((e) => e.type === "row" && e.nodes && e.nodes.length >= 2);
  if (!rows.length) return null;
  const maxCount = Math.max(...rows.map((r) => r.nodes!.length));
  const cardRows = rows.filter((r) => r.nodes!.length === maxCount);
  const memberIds = [...new Set(cardRows.flatMap((r) => r.nodes!))].filter((id) => byId.has(id));
  if (memberIds.length < maxCount) return null;

  const members = memberIds.map((id) => byId.get(id)!);
  // first column (smallest x cluster) defines the card's slot set
  const byX = [...members].sort((a, b) => a.bbox.x - b.bbox.x);
  const cols: ManifestSlot[][] = [];
  for (const s of byX) {
    const c = cols.find((col) => Math.abs(col[0]!.bbox.x - s.bbox.x) <= COL_TOL);
    if (c) c.push(s); else cols.push([s]);
  }
  if (cols.length < 2) return null;
  const first = cols[0]!;
  const roles = first.map((s) => ({ role: s.role, type: s.type }));
  return { roles, memberIds, bbox: union(members.map((m) => m.bbox)) };
}

export function extractBlocks(slots: ManifestSlot[], graph: RelationGraph | undefined): Block[] {
  const card = detectCard(slots, graph);
  if (!card) return [];
  const blockSlots: BlockSlot[] = card.roles.map((r) => ({ role: r.role as BlockSlot["role"], type: r.type }));
  return [{ id: `card_${card.roles.map((r) => r.role).join("_")}`, bbox: union([card.bbox]), repeatable: true, slots: blockSlots }];
}

function flowOf(slots: ManifestSlot[]): FlowDirection {
  if (slots.length < 2) return "column";
  const xs = slots.map((s) => s.bbox.x).sort((a, b) => a - b);
  const spread = xs[xs.length - 1]! - xs[0]!;
  return spread > 200 ? "row" : "column";
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

  // title = the largest-font text slot in the mid zone
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
    const members = slots.filter((s) => cardSet.has(s.id));
    add("cards", members, "row", blockId);
  }
  add("body", body, flowOf(body));
  add("footer", footer, "row");
  return regions;
}
