import type { BBox, CardSpec, PlacedSlot } from "@stencil/ir";

/**
 * Card reflow (DEVDOC Phase 4.7-a). Consumes the assetize-computed CardSpec
 * (single source of truth — no runtime re-detection) and distributes M cards
 * evenly across the row region, cloning the card decoration and using the full
 * card width so content count can differ from the original.
 */

export interface ReflowResult {
  texts: { slot: PlacedSlot; text: string }[];
  rects: { bbox: BBox; fill: string }[];
}

export function reflowCards(spec: CardSpec, cards: Record<string, string>[]): ReflowResult {
  const m = cards.length;
  if (m === 0) return { texts: [], rects: [] };
  const { rowBBox, cardW: baseW, colY0, template, cardDecoration } = spec;

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
        role: t.role,
        type: "text",
        // full card width so large text (kpi) fits the card, not the tight bbox
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
