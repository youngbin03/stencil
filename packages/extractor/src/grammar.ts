import type {
  AlignmentGrid,
  DesignGrammar,
  Hierarchy,
  HierarchyRank,
  ManifestSlot,
  PlacedSlot,
  Role,
  SlotGroup,
  SpacingRhythm,
  TextAlign,
  TypeScale,
} from "@stencil/ir";

/**
 * Design grammar extraction (DEVDOC assetize ②, the "extraction" half of RCE).
 * Measures relational/placement rules from a template: alignment grid, spacing
 * rhythm, hierarchy, slot grouping. Pure + deterministic.
 */

const COL_TOL = 24; // px: slots within this x distance share a column
const ALIGN_TOL = 8; // px: 1D clustering tolerance for guides
const GROUP_GAP = 64; // px: max vertical gap to still count as one group
const DEFAULT_BASE_UNIT = 8;

function textSlots(slots: ManifestSlot[]): ManifestSlot[] {
  return slots.filter((s) => s.type === "text");
}

/** 1D clustering: sorted values within `tol` collapse to their rounded mean. */
function cluster1D(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const guides: number[] = [];
  let bucket: number[] = [];
  for (const v of sorted) {
    if (bucket.length === 0 || v - bucket[bucket.length - 1]! <= tol) {
      bucket.push(v);
    } else {
      guides.push(Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length));
      bucket = [v];
    }
  }
  if (bucket.length) guides.push(Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length));
  return guides;
}

function extractAlignmentGrid(slots: ManifestSlot[]): AlignmentGrid {
  const xs = slots.map((s) => s.bbox.x);
  const ys = slots.map((s) => s.bbox.y);
  const xGuides = cluster1D(xs, ALIGN_TOL);
  const yGuides = cluster1D(ys, ALIGN_TOL);
  return { xGuides, yGuides, margin: xGuides[0] ?? 0 };
}

/** Vertical gaps between adjacent slots within each column (grouped by x guide). */
function verticalGaps(slots: ManifestSlot[], xGuides: number[]): number[] {
  const columns = new Map<number, ManifestSlot[]>();
  for (const s of slots) {
    const guide = xGuides.reduce(
      (best, g) => (Math.abs(g - s.bbox.x) < Math.abs(best - s.bbox.x) ? g : best),
      xGuides[0] ?? s.bbox.x,
    );
    (columns.get(guide) ?? columns.set(guide, []).get(guide)!).push(s);
  }

  const gaps: number[] = [];
  for (const col of columns.values()) {
    const sorted = [...col].sort((a, b) => a.bbox.y - b.bbox.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i]!;
      const next = sorted[i + 1]!;
      const gap = Math.round(next.bbox.y - (cur.bbox.y + cur.bbox.h));
      if (gap >= 0) gaps.push(gap);
    }
  }
  return gaps;
}

function extractSpacingRhythm(slots: ManifestSlot[], xGuides: number[]): SpacingRhythm {
  const gaps = verticalGaps(slots, xGuides);
  if (gaps.length === 0) {
    return { baseUnit: DEFAULT_BASE_UNIT, gaps: { tight: 16, normal: 32, loose: 64, section: 120 } };
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const q = (f: number): number => sorted[Math.min(sorted.length - 1, Math.round(f * (sorted.length - 1)))]!;
  return {
    baseUnit: DEFAULT_BASE_UNIT,
    gaps: { tight: q(0), normal: q(0.33), loose: q(0.66), section: q(1) },
  };
}

function extractHierarchy(type: TypeScale): Hierarchy {
  const ranks: HierarchyRank[] = Object.entries(type)
    .map(([role, t]) => ({ role: role as Role, size: t.size, weight: t.weight }))
    .sort((a, b) => b.size - a.size);
  const titleSize = type.title?.size ?? ranks[0]?.size ?? 1;
  const bodySize = type.body?.size ?? 1;
  return { ranks, titleToBodyRatio: Math.round((titleSize / bodySize) * 100) / 100 };
}

/** Group column-adjacent slots whose gap is small (proximity + alignment). */
function extractGroups(slots: ManifestSlot[]): SlotGroup[] {
  const sorted = [...slots].sort((a, b) => a.bbox.y - b.bbox.y);
  const groups: SlotGroup[] = [];
  let current: ManifestSlot[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const g: SlotGroup = {
      id: `g${groups.length + 1}`,
      roles: current.map((s) => s.role),
      slotIds: current.map((s) => s.id),
    };
    groups.push(g);
    current = [];
  };

  for (const slot of sorted) {
    if (current.length === 0) {
      current.push(slot);
      continue;
    }
    const prev = current[current.length - 1]!;
    const sameCol = Math.abs(prev.bbox.x - slot.bbox.x) <= COL_TOL;
    const gap = slot.bbox.y - (prev.bbox.y + prev.bbox.h);
    if (sameCol && gap >= 0 && gap <= GROUP_GAP) {
      current.push(slot);
    } else {
      flush();
      current.push(slot);
    }
  }
  flush();
  return groups;
}

export function extractGrammar(manifest: { slots: ManifestSlot[] }, type: TypeScale): DesignGrammar {
  const text = textSlots(manifest.slots);
  const alignmentGrid = extractAlignmentGrid(text);
  return {
    alignmentGrid,
    spacingRhythm: extractSpacingRhythm(text, alignmentGrid.xGuides),
    hierarchy: extractHierarchy(type),
    groups: extractGroups(text),
  };
}

/** Promote manifest slots to placed slots, tagging each with its group id. */
export function placeSlots(manifest: { slots: ManifestSlot[] }, groups: SlotGroup[]): PlacedSlot[] {
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const id of g.slotIds) groupOf.set(id, g.id);

  return manifest.slots.map((s) => {
    const slot: PlacedSlot = {
      id: s.id,
      role: s.role,
      type: s.type,
      bbox: s.bbox,
      align: (s.align ?? "left") satisfies TextAlign,
    };
    const gid = groupOf.get(s.id);
    if (gid) slot.groupId = gid;
    return slot;
  });
}
