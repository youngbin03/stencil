import type {
  Canvas,
  Layout,
  PlacedSlot,
  RenderElement,
  RenderImageElement,
  RenderSlide,
  RenderTextElement,
  TextAlign,
  Tokens,
  TypeToken,
} from "@stencil/ir";
import type { PlacementPlan } from "@stencil/ir";
import { fitText } from "./fit.js";
import { detectRepeatGroup, reflowCards } from "./reflow.js";

export { estimateWidth, wrapLine, fitText } from "./fit.js";
export { detectRepeatGroup, reflowCards } from "./reflow.js";
export type { RepeatGroup } from "./reflow.js";

/**
 * Assemble stage — solver (DEVDOC ④, re-composition).
 *
 * Takes a layout (decoration ref + measured slots) + content + theme tokens and
 * produces a deterministic render tree. Coordinates come from the asset's
 * measured slot bboxes; the original SVG is never read. Phase 3 keeps fitting
 * minimal (explicit \n only); word wrap / autofit land in Phase 4 (DEVDOC 7.4).
 */

/** Content keyed by slot id. Text → string; image → asset url. */
export type SlotContent = Record<string, string>;

const DEFAULT_LINE_HEIGHT = 1.2;

function typeFor(role: string, tokens: Tokens): TypeToken | undefined {
  return tokens.type[role];
}

function textElement(slot: PlacedSlot, content: string, tokens: Tokens, canvas: Canvas): RenderTextElement {
  const t = typeFor(slot.role, tokens);
  const baseFont = slot.fontSize ?? t?.size ?? 16;
  const lineHeight = t?.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const family = slot.fontFamily ?? t?.family ?? tokens.fontFamily;
  // Fit within the slot using accurate font metrics so a line never overflows.
  // Width is hard-respected; a small height cushion lets a 1-line original take
  // ~2 lines. Neighbor reflow on growth is handled by the card reflow path.
  const availW = slot.bbox.w > 0 ? slot.bbox.w : canvas.w * 0.5;
  const availH = Math.max(slot.bbox.h, baseFont * lineHeight);
  const fit = fitText(content, { w: availW, h: availH }, baseFont, lineHeight, family);
  const el: RenderTextElement = {
    kind: "text",
    id: slot.id,
    role: slot.role,
    bbox: slot.bbox,
    lines: fit.lines,
    fontSize: fit.fontSize,
    fontFamily: family,
    fontWeight: slot.fontWeight ?? t?.weight ?? 400,
    color: slot.color ?? tokens.colors.text,
    align: (slot.align ?? "left") satisfies TextAlign,
    lineHeight,
  };
  if (slot.letterSpacing) el.letterSpacing = slot.letterSpacing;
  if (fit.overflow) el.overflow = true;
  return el;
}

function imageElement(slot: PlacedSlot, url: string): RenderImageElement {
  const el: RenderImageElement = {
    kind: "image",
    id: slot.id,
    role: slot.role,
    bbox: slot.bbox,
    assetUrl: url,
  };
  if (slot.ratio) el.ratio = slot.ratio;
  return el;
}

/** Solve one slide by re-composition. Only slots with content are emitted. */
export function solveSlide(layout: Layout, content: SlotContent, tokens: Tokens, canvas: Canvas): RenderSlide {
  const warnings: string[] = [];
  const elements: RenderElement[] = [];

  for (const slot of layout.slots) {
    const value = content[slot.id];
    if (value === undefined || value === "") continue;
    if (slot.role === "decoration" || slot.role === "divider") {
      warnings.push(`content for non-content slot "${slot.id}" (${slot.role}) ignored`);
      continue;
    }
    elements.push(slot.type === "image" ? imageElement(slot, value) : textElement(slot, value, tokens, canvas));
  }

  for (const id of Object.keys(content)) {
    if (!layout.slots.some((s) => s.id === id)) warnings.push(`content key "${id}" has no slot in layout`);
  }

  const slide: RenderSlide = {
    layoutId: layout.id,
    canvas,
    decorationUrl: layout.decorationRef,
    elements,
    warnings,
  };
  if (layout.background) slide.background = layout.background;
  return slide;
}

/**
 * Solve a slide from a PlacementPlan (Phase 4.7-a): fixed singles + a variable
 * number of repeatable cards reflowed evenly across the row region. Coordinates
 * come from the relation graph (detectRepeatGroup) — content count may differ
 * from the original slot count without breaking alignment/spacing.
 */
export function solveDeckSlide(layout: Layout, plan: PlacementPlan, tokens: Tokens, canvas: Canvas): RenderSlide {
  const warnings: string[] = [];
  const elements: RenderElement[] = [];

  // Image slots first (under text). 4.7-b — placement (bind+crop), not generation.
  for (const [id, url] of Object.entries(plan.images ?? {})) {
    const slot = layout.slots.find((s) => s.id === id);
    if (slot && url) elements.push(imageElement(slot, url));
  }

  // Fixed singles (text).
  for (const [id, text] of Object.entries(plan.singles)) {
    const slot = layout.slots.find((s) => s.id === id);
    if (!slot || !text) continue;
    if (slot.role === "decoration" || slot.role === "divider") continue;
    if (slot.type === "image") continue; // images handled above
    elements.push(textElement(slot, text, tokens, canvas));
  }

  // Repeatable cards.
  let suppress: string[] = [];
  if (plan.cards.length > 0) {
    const group = detectRepeatGroup(layout);
    if (group) {
      const { texts, rects } = reflowCards(group, plan.cards);
      // Cloned card decorations first (under text), then text.
      rects.forEach((r, i) => elements.push({ kind: "rect", id: `card_rect_${i}`, bbox: r.bbox, fill: r.fill }));
      for (const { slot, text } of texts) elements.push(textElement(slot, text, tokens, canvas));
      suppress = group.decorationIds;
    } else {
      warnings.push(`cards provided but no repeat group in layout "${layout.id}"`);
    }
  }

  const slide: RenderSlide = {
    layoutId: layout.id,
    canvas,
    decorationUrl: layout.decorationRef,
    elements,
    warnings,
  };
  if (layout.background) slide.background = layout.background;
  if (suppress.length) slide.suppressDecorationIds = suppress;
  return slide;
}
