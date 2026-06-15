import type {
  ManifestSlot,
  RenderElement,
  RenderSlide,
  RenderTextElement,
  SlotManifest,
  TextAlign,
} from "@stencil/ir";

/**
 * M4 solver — fixed-slot mode (DEVDOC 6/M4, v1 default).
 *
 * Each manifest slot keeps its measured geometry; content is placed into that
 * slot. Phase 1 keeps fitting minimal (explicit \n line breaks only); word
 * wrapping / autofit / ellipsis are added in Phase 4 (DEVDOC 8.4).
 *
 * Determinism: same manifest + same content → same RenderSlide.
 */

/** Content keyed by slot id (the Figma layer id preserved by M0). */
export type ContentBySlotId = Record<string, string>;

const DEFAULT_LINE_HEIGHT = 1.2;

function toLines(content: string): string[] {
  return content.split("\n");
}

function textElement(slot: ManifestSlot, content: string): RenderTextElement {
  const el: RenderTextElement = {
    kind: "text",
    id: slot.id,
    role: slot.role,
    bbox: slot.bbox,
    lines: toLines(content),
    fontSize: slot.fontSize ?? 16,
    fontFamily: slot.fontFamily ?? "sans-serif",
    fontWeight: slot.fontWeight ?? 400,
    color: slot.color ?? "#000000",
    align: (slot.align ?? "left") satisfies TextAlign,
    lineHeight: DEFAULT_LINE_HEIGHT,
  };
  if (slot.letterSpacing) el.letterSpacing = slot.letterSpacing;
  return el;
}

export interface SolveResult {
  slide: RenderSlide;
}

/**
 * Solve a single slide in fixed-slot mode. Only text slots that have content in
 * `content` are emitted; decoration/divider and content-less slots are left to
 * the base template untouched.
 */
export function solveFixedSlots(
  manifest: SlotManifest,
  content: ContentBySlotId,
): RenderSlide {
  const warnings: string[] = [];
  const elements: RenderElement[] = [];

  for (const slot of manifest.slots) {
    if (slot.type !== "text") continue;
    const value = content[slot.id];
    if (value === undefined) continue;
    if (slot.role === "decoration" || slot.role === "divider") {
      warnings.push(`content provided for non-content slot "${slot.id}" (${slot.role})`);
      continue;
    }
    elements.push(textElement(slot, value));
  }

  for (const id of Object.keys(content)) {
    if (!manifest.slots.some((s) => s.id === id)) {
      warnings.push(`content key "${id}" has no matching slot`);
    }
  }

  return {
    layoutId: manifest.layoutId,
    canvas: manifest.canvas,
    baseTemplateUrl: manifest.baseTemplate,
    elements,
    warnings,
  };
}
