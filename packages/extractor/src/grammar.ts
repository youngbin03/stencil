import type {
  AlignmentGrid,
  DesignGrammar,
  Hierarchy,
  HierarchyRank,
  ManifestSlot,
  MediaKind,
  PlacedSlot,
  Role,
  SlotGroup,
  SpacingRhythm,
  TextAlign,
  TypeScale,
} from "@stencil/ir";

/** Per-slot label from the vision classifier (extra fields merged into slots). */
export interface SlotLabelLite {
  role: Role;
  mediaKind?: MediaKind;
  replaceable?: boolean;
  note?: string;
}

/**
 * Design grammar extraction (DEVDOC assetize ②, the "extraction" half of RCE).
 * Grammar is THEME-level: alignment grid, spacing rhythm, hierarchy and
 * grouping conventions are measured across ALL slides of the theme so the
 * design system captures what is common, not per-slide noise. Deterministic.
 */

const COL_TOL = 24; // px: slots within this x distance share a column
const ALIGN_TOL = 8; // px: 1D clustering tolerance for guides
const GROUP_GAP = 64; // px: max vertical gap to still count as one group
const DEFAULT_BASE_UNIT = 8;

export function textSlots(slots: ManifestSlot[]): ManifestSlot[] {
  return slots.filter((s) => s.type === "text");
}

/**
 * 1D clustering with a frequency floor: sorted values within `tol` collapse to
 * their rounded mean, and only clusters with at least `minCount` members are
 * kept. This turns a theme's many slot coordinates into the few *common*
 * guidelines that actually define the grid (not a coordinate dump).
 */
function clusterGuides(values: number[], tol: number, minCount: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const guides: number[] = [];
  let bucket: number[] = [];
  const flush = (): void => {
    if (bucket.length >= minCount) {
      guides.push(Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length));
    }
    bucket = [];
  };
  for (const v of sorted) {
    if (bucket.length === 0 || v - bucket[bucket.length - 1]! <= tol) bucket.push(v);
    else {
      flush();
      bucket.push(v);
    }
  }
  flush();
  return guides;
}

function extractAlignmentGrid(slots: ManifestSlot[], minCount: number): AlignmentGrid {
  const xGuides = clusterGuides(slots.map((s) => s.bbox.x), ALIGN_TOL, minCount);
  const yGuides = clusterGuides(slots.map((s) => s.bbox.y), ALIGN_TOL, minCount);
  return { xGuides, yGuides, margin: xGuides[0] ?? 0 };
}

/** Vertical gaps between adjacent slots within each column, per slide. */
function verticalGaps(slidesSlots: ManifestSlot[][], xGuides: number[]): number[] {
  const gaps: number[] = [];
  for (const slots of slidesSlots) {
    const columns = new Map<number, ManifestSlot[]>();
    for (const s of slots) {
      const guide = xGuides.reduce(
        (best, g) => (Math.abs(g - s.bbox.x) < Math.abs(best - s.bbox.x) ? g : best),
        xGuides[0] ?? s.bbox.x,
      );
      (columns.get(guide) ?? columns.set(guide, []).get(guide)!).push(s);
    }
    for (const col of columns.values()) {
      const sorted = [...col].sort((a, b) => a.bbox.y - b.bbox.y);
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = Math.round(sorted[i + 1]!.bbox.y - (sorted[i]!.bbox.y + sorted[i]!.bbox.h));
        if (gap >= 0) gaps.push(gap);
      }
    }
  }
  return gaps;
}

function extractSpacingRhythm(slidesSlots: ManifestSlot[][], xGuides: number[]): SpacingRhythm {
  const gaps = verticalGaps(slidesSlots, xGuides);
  if (gaps.length === 0) {
    return { baseUnit: DEFAULT_BASE_UNIT, gaps: { tight: 16, normal: 32, loose: 64, section: 120 } };
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const q = (f: number): number => sorted[Math.min(sorted.length - 1, Math.round(f * (sorted.length - 1)))]!;
  // section uses a high quantile (not max) to avoid cover/empty-space outliers.
  return { baseUnit: DEFAULT_BASE_UNIT, gaps: { tight: q(0), normal: q(0.4), loose: q(0.7), section: q(0.92) } };
}

function extractHierarchy(type: TypeScale): Hierarchy {
  const ranks: HierarchyRank[] = Object.entries(type)
    .map(([role, t]) => ({ role: role as Role, size: t.size, weight: t.weight }))
    .sort((a, b) => b.size - a.size);
  const titleSize = type.title?.size ?? ranks[0]?.size ?? 1;
  const bodySize = type.body?.size ?? 1;
  return { ranks, titleToBodyRatio: Math.round((titleSize / bodySize) * 100) / 100 };
}

/** Group column-adjacent slots with small gaps within a single slide. */
export function extractGroups(slots: ManifestSlot[]): SlotGroup[] {
  const sorted = [...slots].sort((a, b) => a.bbox.y - b.bbox.y);
  const groups: SlotGroup[] = [];
  let current: ManifestSlot[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    groups.push({
      id: `g${groups.length + 1}`,
      roles: current.map((s) => s.role),
      slotIds: current.map((s) => s.id),
    });
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
    if (sameCol && gap >= 0 && gap <= GROUP_GAP) current.push(slot);
    else {
      flush();
      current.push(slot);
    }
  }
  flush();
  return groups;
}

/** Distinct role-sequences observed in groups across the theme, freq-sorted. */
export function groupingConventions(perSlideGroups: SlotGroup[][]): SlotGroup[] {
  const count = new Map<string, number>();
  const roleOf = new Map<string, Role[]>();
  for (const groups of perSlideGroups) {
    for (const g of groups) {
      if (g.roles.length < 2) continue; // a single slot isn't a convention
      const key = g.roles.join("+");
      count.set(key, (count.get(key) ?? 0) + 1);
      roleOf.set(key, g.roles);
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key], i) => ({ id: `c${i + 1}`, roles: roleOf.get(key)!, slotIds: [] }));
}

/** Theme-level grammar from all slides' slots + shared type scale. */
export function extractThemeGrammar(
  slidesSlots: ManifestSlot[][],
  type: TypeScale,
  perSlideGroups: SlotGroup[][],
): DesignGrammar {
  const all = slidesSlots.flat();
  // A guideline must recur across the theme, not appear on a single slide.
  const minCount = Math.max(3, Math.round(slidesSlots.length * 0.1));
  const grid = extractAlignmentGrid(all, minCount);
  return {
    alignmentGrid: grid,
    spacingRhythm: extractSpacingRhythm(slidesSlots, grid.xGuides),
    hierarchy: extractHierarchy(type),
    groups: groupingConventions(perSlideGroups),
  };
}

/** Promote manifest slots to placed slots with style, tagging group membership. */
export function placeSlots(
  slots: ManifestSlot[],
  groups: SlotGroup[],
  labels?: Map<string, SlotLabelLite>,
): PlacedSlot[] {
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const id of g.slotIds) groupOf.set(id, g.id);

  return slots.map((s) => {
    const label = labels?.get(s.id);
    const slot: PlacedSlot = {
      id: s.id,
      role: label?.role ?? s.role,
      type: s.type,
      bbox: s.bbox,
      align: (s.align ?? "left") satisfies TextAlign,
    };
    const gid = groupOf.get(s.id);
    if (gid) slot.groupId = gid;
    if (s.color) slot.color = s.color;
    if (s.fontFamily) slot.fontFamily = s.fontFamily;
    if (s.fontSize !== undefined) slot.fontSize = s.fontSize;
    if (s.fontWeight !== undefined) slot.fontWeight = s.fontWeight;
    if (s.letterSpacing) slot.letterSpacing = s.letterSpacing;
    if (s.ratio) slot.ratio = s.ratio;
    if (s.clip) slot.clip = s.clip;
    if (label?.mediaKind) slot.mediaKind = label.mediaKind;
    if (label?.replaceable !== undefined) slot.replaceable = label.replaceable;
    if (label?.note) slot.note = label.note;
    return slot;
  });
}
