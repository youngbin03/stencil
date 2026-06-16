import type { BBox, Layout, PlacedSlot, TextAlign } from "@stencil/ir";

/**
 * Repeatable card detection + reflow (DEVDOC Phase 4.7-a).
 *
 * From a layout's relation graph, find the repeated "card" (e.g. a stat column
 * = headline+body+label+kpi appearing N times in `row` relations), build a
 * card template, and re-distribute M cards evenly across the row region. This
 * is what lets content-count differ from the original slot count without
 * breaking alignment/even spacing.
 */

export interface RepeatTemplateSlot {
  role: string;
  dx: number;
  dy: number;
  w: number;
  h: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  color?: string;
  align: TextAlign;
  letterSpacing?: string;
}

export interface CardDecoration {
  dx: number;
  dy: number;
  w: number;
  h: number;
  fill: string;
}

export interface RepeatGroup {
  template: RepeatTemplateSlot[];
  rowBBox: BBox;
  cardW: number;
  colY0: number;
  colX0: number;
  baseCount: number;
  roles: string[];
  /** Slot ids that belong to the repeatable cards (vs fixed singles). */
  memberIds: string[];
  /** Per-card emphasis decoration to clone (the card's background shape). */
  cardDecoration?: CardDecoration;
  /** Original decoration ids to suppress when reflowing (they get cloned). */
  decorationIds: string[];
}

function union(boxes: BBox[]): BBox {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Identify the dominant repeatable card from the layout's relation graph. */
export function detectRepeatGroup(layout: Layout): RepeatGroup | null {
  const rg = layout.relationGraph;
  if (!rg) return null;
  const slotById = new Map(layout.slots.map((s) => [s.id, s]));

  // Rows of uniform role with the same (max) cardinality define the card set.
  const rows = rg.edges.filter((e) => e.type === "row" && e.nodes && e.nodes.length >= 2);
  if (rows.length === 0) return null;
  const maxCount = Math.max(...rows.map((r) => r.nodes!.length));
  const cardRows = rows.filter((r) => r.nodes!.length === maxCount);
  if (cardRows.length === 0) return null;

  const memberIds = new Set<string>();
  for (const r of cardRows) for (const id of r.nodes!) memberIds.add(id);
  const members = [...memberIds].map((id) => slotById.get(id)).filter((s): s is PlacedSlot => Boolean(s));
  if (members.length < maxCount) return null;

  // Cluster members into columns by x.
  const colTol = 80;
  const byX = [...members].sort((a, b) => a.bbox.x - b.bbox.x);
  const columns: PlacedSlot[][] = [];
  for (const s of byX) {
    const col = columns.find((c) => Math.abs(c[0]!.bbox.x - s.bbox.x) <= colTol);
    if (col) col.push(s);
    else columns.push([s]);
  }
  if (columns.length < 2) return null;

  const all = members.map((s) => s.bbox);
  const colY0 = Math.min(...all.map((b) => b.y));
  const rowBBox = union(all);

  const first = columns[0]!;
  const colX0 = Math.min(...first.map((s) => s.bbox.x));
  const cardW = Math.max(...first.map((s) => s.bbox.x + s.bbox.w)) - colX0;

  // Per-card emphasis decoration: the deco element each column's slots sit over.
  const deco = (layout.decorationModel?.elements ?? []).filter((d) => d.kind === "emphasis" || d.kind === "accent");
  const overlapArea = (a: BBox, b: BBox): number => {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return w * h;
  };
  const decoForColumn = (col: PlacedSlot[]): { id: string; bbox: BBox; color: string } | undefined => {
    const cb = union(col.map((s) => s.bbox));
    let best: typeof deco[number] | undefined;
    let bestA = 0;
    for (const d of deco) {
      const a = overlapArea(cb, d.bbox);
      if (a > bestA) { bestA = a; best = d; }
    }
    return bestA > 0 && best ? { id: best.id, bbox: best.bbox, color: best.color ?? "#000000" } : undefined;
  };
  const matched = columns.map(decoForColumn);
  let cardDecoration: CardDecoration | undefined;
  const decorationIds: string[] = [];
  if (matched.every(Boolean) && matched[0]) {
    for (const m of matched) decorationIds.push(m!.id);
    const d0 = matched[0]!;
    cardDecoration = { dx: d0.bbox.x - colX0, dy: d0.bbox.y - colY0, w: d0.bbox.w, h: d0.bbox.h, fill: d0.color };
  }

  // Conservative gate: only treat this as a repeatable card when each column
  // has an associated decoration shape. This avoids mistaking a top text row
  // (eyebrows/metrics) for cards (DEVDOC 4.7-a known risk).
  if (!cardDecoration) return null;

  const template: RepeatTemplateSlot[] = first.map((s) => {
    const t: RepeatTemplateSlot = {
      role: s.role,
      dx: s.bbox.x - colX0,
      dy: s.bbox.y - colY0,
      w: s.bbox.w,
      h: s.bbox.h,
      align: (s.align ?? "left") satisfies TextAlign,
    };
    if (s.fontSize !== undefined) t.fontSize = s.fontSize;
    if (s.fontFamily) t.fontFamily = s.fontFamily;
    if (s.fontWeight !== undefined) t.fontWeight = s.fontWeight;
    if (s.color) t.color = s.color;
    if (s.letterSpacing) t.letterSpacing = s.letterSpacing;
    return t;
  });

  return {
    template, rowBBox, cardW, colY0, colX0,
    baseCount: columns.length,
    roles: [...new Set(template.map((t) => t.role))],
    memberIds: [...memberIds],
    decorationIds,
    ...(cardDecoration ? { cardDecoration } : {}),
  };
}

export interface ReflowResult {
  texts: { slot: PlacedSlot; text: string }[];
  rects: { bbox: BBox; fill: string }[];
}

/** Build M card placements (text + cloned decoration) evenly across the row. */
export function reflowCards(group: RepeatGroup, cards: Record<string, string>[]): ReflowResult {
  const m = cards.length;
  if (m === 0) return { texts: [], rects: [] };
  const { rowBBox, cardW: baseW, colY0, template, cardDecoration } = group;

  // Fit M cards across the row; shrink card width (and relative x) if needed.
  let cardW = baseW;
  let scale = 1;
  const fitW = rowBBox.w / m;
  if (cardW > fitW * 0.98) {
    cardW = fitW * 0.9;
    scale = cardW / baseW;
  }
  const gap = m > 1 ? (rowBBox.w - m * cardW) / (m - 1) : 0;
  const startX = m === 1 ? rowBBox.x + (rowBBox.w - cardW) / 2 : rowBBox.x;

  const texts: ReflowResult["texts"] = [];
  const rects: ReflowResult["rects"] = [];
  for (let i = 0; i < m; i++) {
    const cardX = startX + i * (cardW + gap);
    if (cardDecoration) {
      rects.push({
        bbox: { x: cardX + cardDecoration.dx * scale, y: colY0 + cardDecoration.dy, w: cardDecoration.w * scale, h: cardDecoration.h },
        fill: cardDecoration.fill,
      });
    }
    for (const t of template) {
      const text = cards[i]![t.role];
      if (!text) continue;
      const slot: PlacedSlot = {
        id: `${t.role}_c${i}`,
        role: t.role as PlacedSlot["role"],
        type: "text",
        // Use the card's full width (slots are left-aligned within the card) so
        // large text (e.g. kpi) fits the card rather than the original tight bbox.
        bbox: { x: cardX + t.dx * scale, y: colY0 + t.dy, w: cardW - t.dx * scale, h: t.h },
        align: t.align,
      };
      if (t.fontSize !== undefined) slot.fontSize = t.fontSize;
      if (t.fontFamily) slot.fontFamily = t.fontFamily;
      if (t.fontWeight !== undefined) slot.fontWeight = t.fontWeight;
      if (t.color) slot.color = t.color;
      if (t.letterSpacing) slot.letterSpacing = t.letterSpacing;
      texts.push({ slot, text });
    }
  }
  return { texts, rects };
}
