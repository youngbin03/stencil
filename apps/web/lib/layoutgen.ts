import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { buildLayoutBank, selectLayout, availableKinds, type LayoutSig, type BlockKind, type PlanBlock } from "@stencil/synthesizer";
import { solveDeckSlide } from "@stencil/solver";
import { renderComposite } from "@stencil/renderer";
import type { DesignSystemIR, Layout, BBox } from "@stencil/ir";
import type { Theme } from "./generate";
import { resolveTheme } from "./themes";
import type { SynthDeck, SynthSlide } from "./synth";

/**
 * Phase 6 — layout-bank generation. The planner picks content BLOCK KINDS; for each we
 * select one of the template's REAL layouts (deduped for variety), the chosen layout
 * dictates the item count, the LLM writes content to that layout's own roles, and we
 * render it faithfully (its measured geometry + decoration graphics). One renderer, the
 * design system's own variety.
 */

const CHROME = new Set(["pagenum", "footer", "eyebrow"]);

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

function isDark(hex: string): boolean {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return false;
  return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255 < 0.62;
}

/** text slots that are NOT inside the card row (= the layout's single fields) */
function singleSlots(L: Layout): { id: string; role: string }[] {
  const row = (L as { cardSpec?: { rowBBox?: BBox } }).cardSpec?.rowBBox;
  const inRow = (b?: BBox): boolean => !!row && !!b && b.y >= row.y - 6 && b.y <= row.y + row.h + 6;
  return L.slots.filter((s) => s.type === "text" && !inRow(s.bbox)).map((s) => ({ id: s.id, role: s.role }));
}

async function writeForLayout(client: Anthropic, model: string, title: string, prompt: string, purpose: string, sig: LayoutSig): Promise<{ singles: Record<string, string>; cards: Record<string, string>[] }> {
  const singles = singleSlots(sig.layout);
  const askSingles = [...new Set(singles.map((s) => s.role))].filter((r) => r !== "pagenum");
  const cardRoles = sig.cardRoles;
  const N = sig.cardCount;
  const singleProps: Record<string, object> = {};
  for (const r of askSingles) singleProps[r] = { type: "string" };
  const cardItem = { type: "object", properties: Object.fromEntries(cardRoles.map((r) => [r, { type: "string" }])), required: cardRoles, additionalProperties: false };
  const schema = {
    type: "object",
    properties: { singles: { type: "object", properties: singleProps, required: askSingles, additionalProperties: false }, ...(N > 0 ? { cards: { type: "array", minItems: N, maxItems: N, items: cardItem } } : {}) },
    required: ["singles", ...(N > 0 ? ["cards"] : [])], additionalProperties: false,
  };
  const cardLine = N > 0 ? `\nWrite EXACTLY ${N} cards, each with: ${cardRoles.join(", ")} (kpi = a short metric like +38%, 120K).` : "";
  const out = await callTool<{ singles: Record<string, string>; cards?: Record<string, string>[] }>(
    client, model,
    "You write slide copy as structured data. Concise and concrete; punchy titles; one-sentence bodies; real plausible metrics where a number is asked.",
    `Deck: ${title}\nTopic: ${prompt}\nThis slide: ${purpose}\nWrite singles for: ${askSingles.join(", ")}.${cardLine}`,
    schema);
  return { singles: out.singles ?? {}, cards: Array.isArray(out.cards) ? out.cards : [] };
}

/** singles keyed by slot.id (solver maps by id); cards stay role-keyed (solver reflows). */
function toPlacement(sig: LayoutSig, content: { singles: Record<string, string>; cards: Record<string, string>[] }): { layoutId: string; singles: Record<string, string>; cards: Record<string, string>[] } {
  const roleToId = new Map<string, string>();
  for (const s of singleSlots(sig.layout)) if (!roleToId.has(s.role)) roleToId.set(s.role, s.id);
  const singles: Record<string, string> = {};
  for (const [role, val] of Object.entries(content.singles)) { const id = roleToId.get(role); if (id && val) singles[id] = String(val); }
  return { layoutId: sig.id, singles, cards: content.cards };
}

async function loadFrameDeco(theme: string, id: string, bg: string, canvas: { w: number; h: number }): Promise<string> {
  const t = resolveTheme(theme)!;
  try { return await readFile(resolve(t.decoDir, `${id}.svg`), "utf8"); }
  catch { return `<svg width="${canvas.w}" height="${canvas.h}" viewBox="0 0 ${canvas.w} ${canvas.h}" xmlns="http://www.w3.org/2000/svg"><rect width="${canvas.w}" height="${canvas.h}" fill="${bg}"/></svg>`; }
}

/** fill image slots with a soft placeholder (we place, never generate, imagery) */
function imagePlaceholders(L: Layout, dark: boolean): string {
  const fill = dark ? "#2A2A2A" : "#E7EAEE";
  return L.slots.filter((s) => s.type === "image" && s.bbox).map((s) => `<rect x="${Math.round(s.bbox!.x)}" y="${Math.round(s.bbox!.y)}" width="${Math.round(s.bbox!.w)}" height="${Math.round(s.bbox!.h)}" rx="8" fill="${fill}"/>`).join("");
}

const mapLimit = async <T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
};

export async function generateLayoutDeck(theme: Theme, prompt: string, slideCount: number): Promise<SynthDeck> {
  const t = resolveTheme(theme);
  if (!t) throw new Error("unknown theme");
  const system = JSON.parse(await readFile(t.systemPath, "utf8")) as DesignSystemIR;
  const bank = buildLayoutBank(system);
  const canvas = system.canvas;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  const kinds = availableKinds(bank);
  const outline = await callTool<{ title: string; slides: { kind: BlockKind; purpose: string }[] }>(
    client, model,
    `You plan a deck as a sequence of content BLOCK KINDS. Open with 'title', close with 'title'. MAXIMIZE variety — use a different kind for nearly every slide (mix metricRow, list, comparison, gallery, quote, statement). Only use these kinds: ${kinds.join(", ")}.`,
    `Topic: ${prompt}\nPlan about ${slideCount} slides as block kinds.`,
    { type: "object", properties: { title: { type: "string" }, slides: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: kinds }, purpose: { type: "string" } }, required: ["kind", "purpose"], additionalProperties: false } } }, required: ["title", "slides"], additionalProperties: false });

  const plan = (Array.isArray(outline.slides) ? outline.slides : []).filter((s) => kinds.includes(s.kind));
  const used = new Set<string>();
  // selection is sequential (dedup depends on order); content writing is parallel
  const picks = plan.map((o) => ({ o, sig: selectLayout({ kind: o.kind, data: {} } as PlanBlock, bank, used, canvas) })).filter((p) => p.sig) as { o: { kind: BlockKind; purpose: string }; sig: LayoutSig }[];

  const slides = await mapLimit(picks, 3, async ({ o, sig }): Promise<SynthSlide> => {
    const content = await writeForLayout(client, model, outline.title, prompt, o.purpose, sig);
    const placement = toPlacement(sig, content);
    const slide = solveDeckSlide(sig.layout, placement, system.tokens, canvas);
    const dark = isDark(sig.background);
    const deco = await loadFrameDeco(theme, sig.id, sig.background, canvas);
    const base = deco.replace("</svg>", imagePlaceholders(sig.layout, dark) + "</svg>");
    const svg = renderComposite(slide, base);
    // The layouts are human-designed (quality by construction); novelty-based rejection is
    // wrong here. Gate on COMPLETENESS — did the content actually get placed?
    const expected = Object.keys(placement.singles).length + placement.cards.length;
    const placed = (svg.match(/<text/g) ?? []).length;
    const gate: SynthSlide["gate"] = placed >= Math.max(1, Math.ceil(expected * 0.6)) ? "PASS" : "REVISE";
    return { archetype: `${o.kind}:${sig.id.replace(theme + "_", "")}`, purpose: o.purpose, svg, gate, novelty: 1, overall: placed };
  });

  return { title: outline.title, theme, slides };
}
