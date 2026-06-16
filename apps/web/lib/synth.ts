import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { buildGrammarSpec, synthesizeFromGrammar, evaluateSlide, archetypeSchema, chooseDecoration, type ContentPlan } from "@stencil/synthesizer";
import { solveDeckSlide } from "@stencil/solver";
import { renderComposite } from "@stencil/renderer";
import type { DesignSystemIR } from "@stencil/ir";
import type { Theme } from "./generate";

/**
 * Synthesis path (DEVDOC Phase 6): Claude plans an archetype sequence + writes
 * content; the synthesizer builds NEW layouts from the grammar (no frame copy);
 * the evaluator gates each slide. Returns composite SVGs + quality scores.
 */

const ROOT = process.env.STENCIL_ROOT ?? process.cwd();

export interface SynthSlide {
  archetype: string;
  purpose: string;
  svg: string;
  gate: "PASS" | "REVISE" | "REJECT";
  novelty: number;
  overall: number;
}
export interface SynthDeck { title: string; theme: Theme; slides: SynthSlide[]; }

async function callTool<T>(client: Anthropic, model: string, system: string, user: string, schema: object): Promise<T> {
  const res = await client.messages.create({
    model, max_tokens: 2048, system,
    tools: [{ name: "out", description: "structured output", input_schema: schema as Anthropic.Tool["input_schema"] }],
    tool_choice: { type: "tool", name: "out" }, messages: [{ role: "user", content: user }],
  });
  const t = res.content.find((c) => c.type === "tool_use");
  if (!t || t.type !== "tool_use") throw new Error("no tool_use");
  return t.input as T;
}

const mapLimit = async <T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> => {
  const list = Array.isArray(items) ? items : [];
  const out: R[] = [];
  for (let i = 0; i < list.length; i += n) out.push(...(await Promise.all(list.slice(i, i + n).map(fn))));
  return out;
};

export async function generateSynthDeck(theme: Theme, prompt: string, slideCount: number): Promise<SynthDeck> {
  const system = JSON.parse(await readFile(resolve(ROOT, `fixtures/assets/${theme}/system.json`), "utf8")) as DesignSystemIR;
  const spec = buildGrammarSpec(system);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  const archetypes = spec.archetypes.filter((a) => a.zones.some((z) => z.id !== "footer")).map((a) => a.archetype);
  const catalog = archetypes.map((a) => { const s = archetypeSchema(spec, a); return `- ${a}: singles[${s.singles.join(",")}]${s.cardRoles.length ? ` cards[${s.cardRoles.join("/")}]` : ""}`; }).join("\n");

  const outline = await callTool<{ title: string; slides: { archetype: string; purpose: string }[] }>(
    client, model,
    "You plan a presentation as a sequence of composition ARCHETYPES (not fixed templates). Cover first, closing/section last.",
    `Topic: ${prompt}\n\nAvailable archetypes:\n${catalog}\n\nPlan about ${slideCount} slides.`,
    { type: "object", properties: { title: { type: "string" }, slides: { type: "array", items: { type: "object", properties: { archetype: { type: "string" }, purpose: { type: "string" } }, required: ["archetype", "purpose"], additionalProperties: false } } }, required: ["title", "slides"], additionalProperties: false });
  if (!Array.isArray(outline.slides) || outline.slides.length === 0) throw new Error("planner returned no slides");
  const knownArch = new Set(spec.archetypes.map((a) => a.archetype));
  outline.slides = outline.slides.filter((s) => s && knownArch.has(s.archetype));

  const writeContent = async (archetype: string, purpose: string, shorter: boolean): Promise<ContentPlan> => {
    const s = archetypeSchema(spec, archetype);
    const cardLine = s.cardRoles.length ? `\nAlso write 3 cards, each with: ${s.cardRoles.join(", ")} (kpi = a short metric e.g. +38%, 120K).` : "";
    const brief = shorter ? " Keep every value SHORT (title <= 5 words, body <= 12 words)." : "";
    const input = await callTool<{ singles: { role: string; text: string }[]; cards?: { slots: { role: string; text: string }[] }[] }>(
      client, model,
      `You write slide copy. Concise text per role. Title/headline punchy; body one short sentence; caption/label a few words; quote one sentence.${brief}`,
      `Deck: ${outline.title}\nTopic: ${prompt}\nThis slide (${archetype}): ${purpose}\nWrite singles for roles: ${s.singles.join(", ")}.${cardLine}`,
      { type: "object", properties: {
          singles: { type: "array", items: { type: "object", properties: { role: { type: "string" }, text: { type: "string" } }, required: ["role", "text"], additionalProperties: false } },
          cards: { type: "array", items: { type: "object", properties: { slots: { type: "array", items: { type: "object", properties: { role: { type: "string" }, text: { type: "string" } }, required: ["role", "text"], additionalProperties: false } } }, required: ["slots"], additionalProperties: false } },
        }, required: ["singles"], additionalProperties: false });
    const singles: ContentPlan["singles"] = {};
    for (const x of (Array.isArray(input.singles) ? input.singles : [])) (singles as Record<string, string>)[x.role] = x.text;
    const cards = (Array.isArray(input.cards) ? input.cards : []).map((c) => { const r: Record<string, string> = {}; for (const x of (Array.isArray(c.slots) ? c.slots : [])) r[x.role] = x.text; return r; });
    return { archetype, singles, ...(cards.length ? { cards } : {}) };
  };

  const indexed = outline.slides.map((o, i) => ({ o, i }));
  const slides = await mapLimit(indexed, 3, async ({ o, i }): Promise<SynthSlide> => {
    let content = await writeContent(o.archetype, o.purpose, false);
    let r = synthesizeFromGrammar(spec, content);
    let slide = solveDeckSlide(r.layout, r.placement, system.tokens, system.canvas);
    let v = evaluateSlide(system, spec, r.layout, slide);
    if (!v.pass && !v.reject) {
      content = await writeContent(o.archetype, o.purpose, true);
      r = synthesizeFromGrammar(spec, content);
      slide = solveDeckSlide(r.layout, r.placement, system.tokens, system.canvas);
      v = evaluateSlide(system, spec, r.layout, slide);
    }
    return {
      archetype: o.archetype, purpose: o.purpose,
      svg: renderComposite(slide, chooseDecoration(spec, slide, i).svg),
      gate: v.reject ? "REJECT" : v.pass ? "PASS" : "REVISE",
      novelty: v.scores.layoutNovelty, overall: v.scores.overall,
    };
  });

  return { title: outline.title, theme, slides };
}
