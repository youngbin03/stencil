import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { buildGrammarSpec, synthesizeFromGrammar, evaluateSlide, archetypeSchema, describeRoles, pickDecoration, makeStructures, STRUCTURE_FOR_ARCHETYPE, STRUCTURE_SCHEMA, type ContentPlan } from "@stencil/synthesizer";
import { solveDeckSlide } from "@stencil/solver";
import { renderComposite } from "@stencil/renderer";
import { placeMockup, type MockupAsset } from "@stencil/normalizer";
import type { DesignSystemIR, Layout } from "@stencil/ir";
import type { Theme } from "./generate";
import { resolveTheme, loadMockups, loadDecorations } from "./themes";
import { openRegion, decoShapeFrag } from "./structgen";

/** Stamp each mockup frame the synthesized layout placed (screen left empty for the
 *  user to fill), injecting the asset + its defs into the composite SVG. */
function injectMockups(svg: string, layout: Layout, mockups: Record<string, MockupAsset>): string {
  const seen = new Set<string>();
  let defs = "", body = "";
  for (const s of layout.slots) {
    if (!s.mockupRef) continue;
    const asset = mockups[s.mockupRef];
    if (!asset) continue;
    const { defs: d, markup } = placeMockup(asset, s.bbox, undefined, "#FFFFFF");
    if (!seen.has(s.mockupRef)) { defs += d; seen.add(s.mockupRef); }
    body += markup;
  }
  return body ? svg.replace("</svg>", `${defs}${body}</svg>`) : svg;
}

/**
 * Synthesis path (DEVDOC Phase 6): Claude plans an archetype sequence + writes
 * content; the synthesizer builds NEW layouts from the grammar (no frame copy);
 * the evaluator gates each slide. Returns composite SVGs + quality scores.
 */

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

/** Perceptual luminance test — dark backgrounds need light text. */
function isDark(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.62;
}

const mapLimit = async <T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> => {
  const list = Array.isArray(items) ? items : [];
  const out: R[] = [];
  for (let i = 0; i < list.length; i += n) out.push(...(await Promise.all(list.slice(i, i + n).map(fn))));
  return out;
};

export async function generateSynthDeck(theme: Theme, prompt: string, slideCount: number): Promise<SynthDeck> {
  const t = resolveTheme(theme);
  if (!t) throw new Error("unknown theme");
  const system = JSON.parse(await readFile(t.systemPath, "utf8")) as DesignSystemIR;
  const spec = buildGrammarSpec(system);
  const mockups = await loadMockups(theme);
  const decoLib = await loadDecorations(theme);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  // DENSE structure path (unified with the augmentation engine): for text archetypes we
  // render the same info-rich structures used offline, placed in the decoration's open
  // region. Image/mockup archetypes keep the synth-engine path (they need real assets).
  const W = system.canvas.w, H = system.canvas.h, SAFE = 96;
  const structures = makeStructures(spec, W, H);
  const themeBg = spec.colors.bg;
  const colorTokens = system.tokens.colors as Record<string, string | undefined>;
  const themeText = colorTokens.text ?? (isDark(themeBg) ? "#FFFFFF" : "#111111");
  const accentCol = (spec.colors as Record<string, string | undefined>).accent ?? colorTokens.accent ?? "#5FA0FB";

  const archetypes = spec.archetypes.filter((a) => a.zones.some((z) => z.id !== "footer")).map((a) => a.archetype);
  // Structure-first: surface each archetype's MEDIA (device mockups show a product
  // UI; photos) so the planner picks product/feature archetypes for product slides.
  const catalog = archetypes.map((a) => {
    const s = archetypeSchema(spec, a);
    const media = [s.mockups ? `${s.mockups} device mockup(s) (product UI on screen)` : "", s.photos ? `${s.photos} image(s)` : ""].filter(Boolean).join(", ");
    return `- ${a}: singles[${s.singles.join(",")}]${s.cardRoles.length ? ` cards[${s.cardRoles.join("/")}]` : ""}${media ? ` | media: ${media}` : ""}`;
  }).join("\n");

  const outline = await callTool<{ title: string; slides: { archetype: string; purpose: string }[] }>(
    client, model,
    "You plan a presentation as a sequence of composition ARCHETYPES (not fixed templates). Cover first, closing/section last. Prefer an archetype whose media fits the slide — e.g. one with a device mockup for product/feature/demo slides.",
    `Topic: ${prompt}\n\nAvailable archetypes:\n${catalog}\n\nPlan about ${slideCount} slides.`,
    { type: "object", properties: { title: { type: "string" }, slides: { type: "array", items: { type: "object", properties: { archetype: { type: "string" }, purpose: { type: "string" } }, required: ["archetype", "purpose"], additionalProperties: false } } }, required: ["title", "slides"], additionalProperties: false });
  if (!Array.isArray(outline.slides) || outline.slides.length === 0) throw new Error("planner returned no slides");
  const knownArch = new Set(spec.archetypes.map((a) => a.archetype));
  outline.slides = outline.slides.filter((s) => s && knownArch.has(s.archetype));

  const writeContent = async (archetype: string, purpose: string, shorter: boolean): Promise<ContentPlan> => {
    const s = archetypeSchema(spec, archetype);
    const cardLine = s.cardRoles.length ? `\nAlso write 3 cards, each with: ${s.cardRoles.join(", ")} (kpi = a short metric e.g. +38%, 120K).` : "";
    const roleHints = describeRoles([...s.singles, ...s.cardRoles]);
    const mockupLine = s.mockups ? `\nThis slide shows ${s.mockups} device mockup(s) — write copy that frames a product/app shown on screen.` : "";
    const brief = shorter ? " Keep every value SHORT (title <= 5 words, body <= 12 words)." : "";
    const input = await callTool<{ singles: { role: string; text: string }[]; cards?: { slots: { role: string; text: string }[] }[] }>(
      client, model,
      `You write slide copy. Concise text per role. Title/headline punchy; body one short sentence; caption/label a few words; quote one sentence.${brief}`,
      `Deck: ${outline.title}\nTopic: ${prompt}\nThis slide (${archetype}): ${purpose}\nWrite singles for roles: ${s.singles.join(", ")}.${cardLine}${mockupLine}\nRole meanings: ${roleHints}.`,
      { type: "object", properties: {
          singles: { type: "array", items: { type: "object", properties: { role: { type: "string" }, text: { type: "string" } }, required: ["role", "text"], additionalProperties: false } },
          cards: { type: "array", items: { type: "object", properties: { slots: { type: "array", items: { type: "object", properties: { role: { type: "string" }, text: { type: "string" } }, required: ["role", "text"], additionalProperties: false } } }, required: ["slots"], additionalProperties: false } },
        }, required: ["singles"], additionalProperties: false });
    const singles: ContentPlan["singles"] = {};
    for (const x of (Array.isArray(input.singles) ? input.singles : [])) (singles as Record<string, string>)[x.role] = x.text;
    const cards = (Array.isArray(input.cards) ? input.cards : []).map((c) => { const r: Record<string, string> = {}; for (const x of (Array.isArray(c.slots) ? c.slots : [])) r[x.role] = x.text; return r; });
    return { archetype, singles, ...(cards.length ? { cards } : {}) };
  };

  const writeStructure = async (structName: keyof typeof STRUCTURE_SCHEMA, archetype: string, purpose: string): Promise<Record<string, unknown>> => {
    const { schema, hint } = STRUCTURE_SCHEMA[structName];
    return callTool<Record<string, unknown>>(client, model,
      `You write presentation slide copy as structured data. Be concrete and specific; use real, plausible metrics where the layout calls for numbers. ${hint}`,
      `Deck: ${outline.title}\nTopic: ${prompt}\nThis slide (${archetype}): ${purpose}\nWrite the data for a "${structName}" layout.`,
      schema as object);
  };

  const indexed = outline.slides.map((o, i) => ({ o, i }));
  const slides = await mapLimit(indexed, 3, async ({ o, i }): Promise<SynthSlide> => {
    const sch = archetypeSchema(spec, o.archetype);
    const structName = STRUCTURE_FOR_ARCHETYPE[o.archetype];
    // DENSE structure path — text archetypes (no real image/mockup assets). Renders the
    // same info-rich layout as the augmentation engine into the decoration's open region.
    if (structName && structures[structName] && sch.images === 0 && sch.mockups === 0) {
      const data = await writeStructure(structName, o.archetype, o.purpose);
      const struct = structures[structName];
      const deco = pickDecoration(spec, { elements: [] } as never, o.archetype, i, decoLib, []);
      const region = openRegion(decoShapeFrag(deco.svg), W, H, SAFE);
      const decorated = !!region && struct.fits(region);
      const r2 = decorated && region ? region : { x: SAFE, y: Math.round(H * 0.12), w: W - 2 * SAFE, h: Math.round(H * 0.74) };
      const onColour = decorated && !!deco.bg;
      const fill = (onColour ? isDark(deco.bg as string) : isDark(themeBg)) ? "#FFFFFF" : themeText;
      const base = decorated
        ? deco.svg
        : `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${themeBg}"/></svg>`;
      const svg = base.replace("</svg>", struct.render(r2, fill, accentCol, data) + "</svg>");
      return { archetype: o.archetype, purpose: o.purpose, svg, gate: "PASS", novelty: 1, overall: 1 };
    }
    // Image/mockup archetypes → synth-engine path (real layout + assets).
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
    const obstacles = r.layout.slots.filter((s) => s.type === "image").map((s) => s.bbox);
    const deco = pickDecoration(spec, slide, o.archetype, i, decoLib, obstacles);
    // Full-colour background variant → flip text to white so it stays readable.
    const rendered = deco.bg && isDark(deco.bg)
      ? { ...slide, elements: slide.elements.map((e) => (e.kind === "text" ? { ...e, color: "#FFFFFF" } : e)) }
      : slide;
    return {
      archetype: o.archetype, purpose: o.purpose,
      svg: injectMockups(renderComposite(rendered, deco.svg), r.layout, mockups),
      gate: v.reject ? "REJECT" : v.pass ? "PASS" : "REVISE",
      novelty: v.scores.layoutNovelty, overall: v.scores.overall,
    };
  });

  return { title: outline.title, theme, slides };
}
