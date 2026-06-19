import type { LayoutSig } from "./layout-bank.js";

/**
 * Phase 1 — content BLOCKS. The planner describes a deck as ordered content blocks
 * (semantics only). Each kind has an LLM output schema and a predicate that says which
 * real layout signatures can express it. Selection (Phase 2) scores the candidates.
 */
export type BlockKind = "title" | "statement" | "metricRow" | "list" | "quote" | "comparison" | "gallery" | "feature";

const txt = { type: "string" } as const;
const arr = (items: object, min: number, max: number) => ({ type: "array", minItems: min, maxItems: max, items });

export const BLOCK_SCHEMA: Record<BlockKind, { schema: object; hint: string }> = {
  title: { hint: "An opener/closer: eyebrow (1-2 words), a punchy title (<=6 words), one supporting sentence.",
    schema: { type: "object", properties: { eyebrow: txt, title: txt, body: txt }, required: ["eyebrow", "title", "body"], additionalProperties: false } },
  statement: { hint: "A bold statement: eyebrow, lines = a 1-2 line headline, one supporting sentence (body).",
    schema: { type: "object", properties: { eyebrow: txt, lines: arr(txt, 1, 2), body: txt }, required: ["eyebrow", "lines", "body"], additionalProperties: false } },
  metricRow: { hint: "A metrics slide: a title, then 2-4 metrics. Each metric = a big value (e.g. +38%, 120K) and a short caption.",
    schema: { type: "object", properties: { title: txt, metrics: arr({ type: "object", properties: { value: txt, caption: txt }, required: ["value", "caption"], additionalProperties: false }, 2, 4) }, required: ["title", "metrics"], additionalProperties: false } },
  list: { hint: "A 3-5 item list: a header, then items each with a short label (2-4 words) and a one-sentence description.",
    schema: { type: "object", properties: { header: txt, items: arr({ type: "object", properties: { label: txt, desc: txt }, required: ["label", "desc"], additionalProperties: false }, 3, 5) }, required: ["header", "items"], additionalProperties: false } },
  quote: { hint: "A quote: the quote split into 1-2 short lines, and an attribution.",
    schema: { type: "object", properties: { q: arr(txt, 1, 2), cap: txt }, required: ["q", "cap"], additionalProperties: false } },
  comparison: { hint: "Two side-by-side columns (e.g. before/after): a title, and two columns each with a label and 1-3 short points.",
    schema: { type: "object", properties: { title: txt, left: { type: "object", properties: { label: txt, points: arr(txt, 1, 3) }, required: ["label", "points"], additionalProperties: false }, right: { type: "object", properties: { label: txt, points: arr(txt, 1, 3) }, required: ["label", "points"], additionalProperties: false } }, required: ["title", "left", "right"], additionalProperties: false } },
  gallery: { hint: "A visual grid: a title and 2-6 short captions (one per image).",
    schema: { type: "object", properties: { title: txt, captions: arr(txt, 2, 6) }, required: ["title", "captions"], additionalProperties: false } },
  feature: { hint: "A single feature with one product/photo: eyebrow, title (<=6 words), one supporting sentence.",
    schema: { type: "object", properties: { eyebrow: txt, title: txt, body: txt }, required: ["eyebrow", "title", "body"], additionalProperties: false } },
};

/** How many repeatable items the block carries (for reflow fit); 0 = non-repeating. */
export function blockCount(kind: BlockKind, data: Record<string, unknown>): number {
  if (kind === "metricRow") return (data.metrics as unknown[] | undefined)?.length ?? 0;
  if (kind === "list") return (data.items as unknown[] | undefined)?.length ?? 0;
  if (kind === "gallery") return (data.captions as unknown[] | undefined)?.length ?? 0;
  return 0;
}

/** Can a real layout signature express this block kind? (measured predicate, no labels) */
export function blockMatches(kind: BlockKind, s: LayoutSig): boolean {
  switch (kind) {
    case "metricRow": return s.hasBigNumber && s.imageCount === 0;
    case "list": return s.cardUsable && s.imageCount === 0 && !s.hasBigNumber;
    case "gallery": return s.imageCount >= 2;
    case "feature": return s.imageCount === 1;
    case "quote": return s.hasQuote && s.imageCount === 0;
    case "comparison": return (s.cardCount === 2 || s.imageCount === 2 || s.archetype === "comparison") && s.imageCount <= 2;
    case "title": return s.cardCount === 0 && s.imageCount === 0 && ["cover", "section", "closing", "team"].includes(s.archetype);
    // statement = a plain text body slide; exclude opener/closer and quote layouts so it
    // doesn't borrow a cover's oversized title styling.
    case "statement": return s.cardCount === 0 && s.imageCount === 0 && !s.hasQuote && !["cover", "closing"].includes(s.archetype);
    default: return false;
  }
}
