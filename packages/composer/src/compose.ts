import Anthropic from "@anthropic-ai/sdk";
import type { DesignSystemIR, Layout } from "@stencil/ir";

/**
 * Compose stage (DEVDOC ③, Phase 3). Translates a user prompt into a deck plan
 * over a fixed design system using Claude tool use. Two passes:
 *   A) outline  — pick existing layouts (by archetype/slots) for the topic+flow
 *   B) fill     — write text content per slot, respecting role + length
 * The model never emits coordinates/colors/fonts — only layout choices + text.
 */

export interface DeckSlide {
  layoutId: string;
  purpose: string;
  /** Content keyed by slot id (text slots only). */
  content: Record<string, string>;
}
export interface DeckPlan {
  title: string;
  slides: DeckSlide[];
}

export interface ComposeOptions {
  apiKey?: string;
  model?: string;
  /** Target slide count hint. */
  slides?: number;
  concurrency?: number;
}

function client(opts: ComposeOptions): { anthropic: Anthropic; model: string } {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  return { anthropic: new Anthropic({ apiKey }), model: opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8" };
}

async function callTool<T>(
  anthropic: Anthropic,
  model: string,
  system: string,
  userText: string,
  tool: { name: string; description: string; input_schema: Record<string, unknown> },
): Promise<T> {
  const res = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system,
    tools: [tool as never],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
  });
  const t = res.content.find((c) => c.type === "tool_use");
  if (!t || t.type !== "tool_use") throw new Error("no tool_use in response");
  return t.input as T;
}

/** Compact catalog of layouts for outline selection. */
function layoutCatalog(system: DesignSystemIR): string {
  return system.layouts
    .map((l) => {
      const roles = l.slots.map((s) => (s.type === "image" ? `${s.role}(${s.mediaKind ?? "image"})` : s.role));
      const counts = roles.reduce<Record<string, number>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {});
      const summary = Object.entries(counts).map(([r, n]) => (n > 1 ? `${r}×${n}` : r)).join(", ");
      return `- ${l.id} [${l.archetype ?? "other"}] : ${summary}`;
    })
    .join("\n");
}

/** Rough character budget for a slot (keeps generated text within its box). */
function maxChars(slot: { bbox: { w: number }; fontSize?: number }): number {
  const fs = slot.fontSize ?? 24;
  const perLine = Math.max(3, Math.floor(slot.bbox.w / (fs * 0.7)));
  return Math.max(6, perLine * 2); // allow up to ~2 lines
}

function textSlotsOf(layout: Layout): { id: string; role: string; max: number }[] {
  return layout.slots.filter((s) => s.type === "text" && s.role !== "decoration" && s.role !== "divider")
    .map((s) => ({ id: s.id, role: s.role, max: maxChars(s) }));
}

async function planOutline(
  anthropic: Anthropic, model: string, system: DesignSystemIR, prompt: string, opts: ComposeOptions,
): Promise<{ title: string; slides: { layoutId: string; purpose: string }[] }> {
  const want = opts.slides ? `Aim for about ${opts.slides} slides.` : "Choose an appropriate number of slides.";
  const out = await callTool<{ title: string; slides: { layoutId: string; purpose: string }[] }>(
    anthropic, model,
    `You compose a presentation deck by selecting layouts from a FIXED design system.
Pick layoutIds that exist in the catalog and fit the topic and a sensible narrative flow
(usually a cover first, a closing last). Match slide intent to the layout's [archetype].
Do not invent layoutIds. ${want}`,
    `Topic / request:\n${prompt}\n\nLayout catalog (id [archetype] : slot roles):\n${layoutCatalog(system)}`,
    {
      name: "plan_deck",
      description: "Pick an ordered list of slides referencing existing layoutIds.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: { layoutId: { type: "string" }, purpose: { type: "string", description: "one line" } },
              required: ["layoutId", "purpose"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "slides"],
        additionalProperties: false,
      },
    },
  );
  // keep only existing layouts
  const valid = new Set(system.layouts.map((l) => l.id));
  out.slides = out.slides.filter((s) => valid.has(s.layoutId));
  return out;
}

async function fillSlide(
  anthropic: Anthropic, model: string, layout: Layout, purpose: string, deckTitle: string, prompt: string, opts: ComposeOptions,
): Promise<Record<string, string>> {
  const slots = textSlotsOf(layout);
  if (slots.length === 0) return {};
  const list = slots.map((s) => `- ${s.id} (${s.role}, ≤${s.max} chars)`).join("\n");
  const filled = await callTool<{ slots: { id: string; text: string }[] }>(
    anthropic, model,
    `Write the text content for one slide of a deck. Provide text for EVERY listed slot id
(do not skip any). Respect each slot's role and its character budget:
title/headline = short and punchy; subtitle/eyebrow = brief; body = 1-2 sentences;
caption/label = a few words; kpi = a short metric (e.g. +38%, $2.4B, 12%); quote = a sentence.
Stay within each slot's ≤chars budget so text fits its box. Use only the listed slot ids.
Use \\n only for intentional line breaks.`,
    `Deck: ${deckTitle}\nTopic: ${prompt}\nThis slide's purpose: ${purpose}\nLayout archetype: ${layout.archetype ?? "other"}\n\nText slots (fill all):\n${list}`,
    {
      name: "fill_slide",
      description: "Provide text for each slot id.",
      input_schema: {
        type: "object",
        properties: {
          slots: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, text: { type: "string" } },
              required: ["id", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["slots"],
        additionalProperties: false,
      },
    },
  );
  const valid = new Set(slots.map((s) => s.id));
  const content: Record<string, string> = {};
  for (const e of filled.slots) if (valid.has(e.id)) content[e.id] = e.text;
  return content;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map((x, j) => fn(x, i + j)))));
  }
  return out;
}

/** Outline only: pick layouts for the topic (Phase 4.7 director fills them). */
export async function outlineDeck(
  system: DesignSystemIR, prompt: string, opts: ComposeOptions = {},
): Promise<{ title: string; slides: { layoutId: string; purpose: string }[] }> {
  const { anthropic, model } = client(opts);
  return planOutline(anthropic, model, system, prompt, opts);
}

export async function compose(system: DesignSystemIR, prompt: string, opts: ComposeOptions = {}): Promise<DeckPlan> {
  const { anthropic, model } = client(opts);
  const outline = await planOutline(anthropic, model, system, prompt, opts);
  const byId = new Map(system.layouts.map((l) => [l.id, l]));

  const slides = await mapLimit(outline.slides, opts.concurrency ?? 3, async (s) => {
    const layout = byId.get(s.layoutId)!;
    const content = await fillSlide(anthropic, model, layout, s.purpose, outline.title, prompt, opts);
    return { layoutId: s.layoutId, purpose: s.purpose, content } satisfies DeckSlide;
  });

  return { title: outline.title, slides };
}
