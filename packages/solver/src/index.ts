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
import { reflowCards } from "./reflow.js";
import { selfCheck } from "./selfcheck.js";

export { estimateWidth, wrapLine, fitText } from "./fit.js";
export { reflowCards } from "./reflow.js";
export { selfCheck } from "./selfcheck.js";
export type { SelfCheckIssue } from "./selfcheck.js";

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
  const slotById = new Map(layout.slots.map((s) => [s.id, s]));
  const handled = new Set<string>();
  let suppress: string[] = [];

  // Image slots (under text). Placement = bind + cover-crop, not generation.
  for (const [id, url] of Object.entries(plan.images ?? {})) {
    const slot = slotById.get(id);
    if (slot && url) {
      elements.push(imageElement(slot, url));
      handled.add(id);
    }
  }

  // Compose by region (zone + flow + block), not by pinning raw slot bboxes.
  const regions = layout.regions ?? [];
  let cardsPlaced = false;
  for (const region of regions) {
    // Repeatable card row → reflow the cards across the row (using cardSpec).
    if (region.blockId && plan.cards.length > 0 && layout.cardSpec) {
      const { texts, rects } = reflowCards(layout.cardSpec, plan.cards);
      rects.forEach((r, i) => elements.push({ kind: "rect", id: `card_rect_${i}`, bbox: r.bbox, fill: r.fill }));
      for (const { slot, text } of texts) elements.push(textElement(slot, text, tokens, canvas));
      suppress = layout.cardSpec.decorationIds;
      cardsPlaced = true;
      for (const id of region.slotIds ?? []) handled.add(id);
      continue;
    }

    // Text region → place filled slots by flow (fidelity if all filled; reflow if partial).
    const regionSlots = (region.slotIds ?? [])
      .map((id) => slotById.get(id))
      .filter((s): s is PlacedSlot => Boolean(s) && s!.type === "text" && s!.role !== "decoration" && s!.role !== "divider");
    const filled = regionSlots.filter((s) => plan.singles[s.id]);
    for (const s of regionSlots) handled.add(s.id);
    if (filled.length === 0) continue;

    const allFilled = filled.length === regionSlots.length;
    if (allFilled || region.flow !== "column" || filled.length === 1) {
      // Keep authored positions (1:1 fidelity) — or row handled below for partial.
      if (allFilled || filled.length === 1) {
        for (const s of filled) elements.push(textElement(s, plan.singles[s.id]!, tokens, canvas));
        continue;
      }
    }
    if (region.flow === "row") {
      // Distribute the filled slots evenly across the region width.
      const n = filled.length;
      const ordered = [...filled].sort((a, b) => a.bbox.x - b.bbox.x);
      const w = region.bbox.w / n;
      ordered.forEach((s, i) => {
        const placed: PlacedSlot = { ...s, bbox: { x: region.bbox.x + i * w, y: s.bbox.y, w, h: s.bbox.h } };
        elements.push(textElement(placed, plan.singles[s.id]!, tokens, canvas));
      });
    } else {
      // Column: stack filled slots from the region top with rhythm gap (no holes).
      const ordered = [...filled].sort((a, b) => a.bbox.y - b.bbox.y);
      let y = region.bbox.y;
      for (const s of ordered) {
        const placed: PlacedSlot = { ...s, bbox: { x: s.bbox.x, y, w: s.bbox.w, h: s.bbox.h } };
        const el = textElement(placed, plan.singles[s.id]!, tokens, canvas);
        elements.push(el);
        y += el.lines.length * el.fontSize * el.lineHeight + region.gap;
      }
    }
  }

  // Singles not covered by any region → keep authored position (fallback).
  for (const [id, text] of Object.entries(plan.singles)) {
    if (handled.has(id) || !text) continue;
    const slot = slotById.get(id);
    if (!slot || slot.type !== "text" || slot.role === "decoration" || slot.role === "divider") continue;
    elements.push(textElement(slot, text, tokens, canvas));
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

  // Unmet content: cards were provided but the layout had no repeatable region.
  if (plan.cards.length > 0 && !cardsPlaced) {
    warnings.push(`unmet/high: ${plan.cards.length} cards had no repeatable region in "${layout.id}"`);
  }

  // Self-check gate: auto-fix contrast, report the rest.
  for (const issue of selfCheck(slide, layout, tokens)) {
    warnings.push(`${issue.kind}/${issue.severity}: ${issue.target}${issue.detail ? ` (${issue.detail})` : ""}`);
  }
  return slide;
}
