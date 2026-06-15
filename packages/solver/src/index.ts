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

function textElement(slot: PlacedSlot, content: string, tokens: Tokens): RenderTextElement {
  const t = typeFor(slot.role, tokens);
  const el: RenderTextElement = {
    kind: "text",
    id: slot.id,
    role: slot.role,
    bbox: slot.bbox,
    lines: content.split("\n"),
    fontSize: slot.fontSize ?? t?.size ?? 16,
    fontFamily: slot.fontFamily ?? t?.family ?? tokens.fontFamily,
    fontWeight: slot.fontWeight ?? t?.weight ?? 400,
    color: slot.color ?? tokens.colors.text,
    align: (slot.align ?? "left") satisfies TextAlign,
    lineHeight: t?.lineHeight ?? DEFAULT_LINE_HEIGHT,
  };
  if (slot.letterSpacing) el.letterSpacing = slot.letterSpacing;
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
    elements.push(slot.type === "image" ? imageElement(slot, value) : textElement(slot, value, tokens));
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
