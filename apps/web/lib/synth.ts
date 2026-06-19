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
    // empty screen reads as an INTENTIONAL placeholder (soft top-down gradient) rather
    // than a flat white void — we still place, never generate, imagery.
    const { defs: d, markup } = placeMockup(asset, s.bbox, undefined, "url(#mockScreen)");
    if (!seen.has(s.mockupRef)) { defs += d; seen.add(s.mockupRef); }
    body += markup;
  }
  if (!body) return svg;
  const grad = `<linearGradient id="mockScreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E7EAEE"/></linearGradient>`;
  return svg.replace("</svg>", `<defs>${grad}</defs>${defs}${body}</svg>`);
}

/** Slightly fade the native decoration so dark content text stays readable where it
 *  overlaps it (review: colorful gallery captions sat on a vivid blob). */
function softenDeco(svg: string): string {
  return svg.replace(/id="Decorative/g, 'opacity="0.82" id="Decorative');
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

  // Per-ARCHETYPE background colour is part of the design grammar (green: cover/closing =
  // dark green, agenda/gallery = lime, team = black …). The single tokens.bg ("white")
  // throws that away, so mine the dominant background each archetype actually uses and
  // render on it, flipping text/accent for contrast.
  const norm = (c?: string): string => (c === "white" ? "#FFFFFF" : c === "black" ? "#000000" : (c ?? "#FFFFFF"));
  const lum = (hex: string): number => { const x = norm(hex).replace("#", ""); if (x.length !== 6) return 0.6; return (0.299 * parseInt(x.slice(0, 2), 16) + 0.587 * parseInt(x.slice(2, 4), 16) + 0.114 * parseInt(x.slice(4, 6), 16)) / 255; };
  const bgTally: Record<string, Record<string, number>> = {};
  for (const L of system.layouts) { const a = (L as { archetype?: string }).archetype, b = (L as { background?: string }).background; if (!a || !b) continue; (bgTally[a] ??= {})[b] = (bgTally[a][b] ?? 0) + 1; }
  const bgForArch: Record<string, string> = {};
  for (const a in bgTally) bgForArch[a] = norm(Object.entries(bgTally[a]).sort((x, y) => y[1] - x[1])[0]![0]);
  const slideColors = (arch: string): { bg: string; text: string; acc: string } => {
    const bg = bgForArch[arch] ?? norm(themeBg);
    const text = lum(bg) < 0.6 ? "#FFFFFF" : norm(themeText);
    const a = norm(accentCol);
    // accent stays the brand colour unless it is nearly the same tone as the bg (then a
    // box/line would vanish) — a low threshold keeps lime boxes on white (green's device).
    return { bg, text, acc: Math.abs(lum(a) - lum(bg)) < 0.12 ? text : a };
  };

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
    "You plan a presentation as a sequence of composition ARCHETYPES (not fixed templates). Cover first, closing/section last. Prefer an archetype whose media fits the slide — e.g. one with a device mockup for product/feature/demo slides. MAXIMIZE variety: use a DIFFERENT archetype for almost every slide and deliberately mix layout kinds (a metrics/stat slide, a comparison, a gallery, a quote, a content/feature slide) instead of repeating the same text archetype — a deck of near-identical layouts is a failure.",
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
    // DENSE structure path — text archetypes. Photo zones are NEVER filled in generation
    // (we place, never generate, imagery), so a photo-only archetype renders far better as
    // a dense structure than as a synth-engine layout with an empty photo hole. Only true
    // device MOCKUPS (a meaningful product frame) stay on the synth-engine path.
    if (structName && structures[structName] && sch.mockups === 0) {
      const data = await writeStructure(structName, o.archetype, o.purpose);
      const struct = structures[structName];
      const deco = pickDecoration(spec, { elements: [] } as never, o.archetype, i, decoLib, []);
      const region = openRegion(decoShapeFrag(deco.svg), W, H, SAFE);
      const decorated = !!region && struct.fits(region);
      // Undecorated (minimal themes): size the band to the content's own height so the
      // structure fills it instead of floating dead-centre in a tall empty canvas.
      let r2: { x: number; y: number; w: number; h: number };
      if (decorated && region) r2 = region;
      else {
        const foot = struct.foot({ x: SAFE, y: 0, w: W - 2 * SAFE, h: H });
        const bandH = Math.min(Math.round(H * 0.6), Math.max(Math.round(foot * 1.2), Math.round(H * 0.34)));
        r2 = { x: SAFE, y: Math.round((H - bandH) / 2), w: W - 2 * SAFE, h: bandH };
      }
      const useDeco = decorated && /<path/.test(deco.svg);
      const sc = slideColors(o.archetype);
      const fill = useDeco ? ((deco.bg && isDark(deco.bg)) ? "#FFFFFF" : themeText) : sc.text;
      const acc = useDeco ? accentCol : sc.acc;
      const base = useDeco
        ? softenDeco(deco.svg)
        : `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${sc.bg}"/></svg>`;
      const svg = base.replace("</svg>", struct.render(r2, fill, acc, { ...data, __boxed: !useDeco }) + "</svg>");
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
    // Decorated theme (colorful) → keep its native decoration; minimal theme → paint the
    // archetype's own background colour (green gallery = lime, team = black …).
    const hasDeco = /<path/.test(deco.svg);
    const sc = slideColors(o.archetype);
    const base = hasDeco ? softenDeco(deco.svg) : `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${sc.bg}"/></svg>`;
    const darkBg = hasDeco ? !!(deco.bg && isDark(deco.bg)) : isDark(sc.bg);
    const rendered = darkBg
      ? { ...slide, elements: slide.elements.map((e) => (e.kind === "text" ? { ...e, color: "#FFFFFF" } : e)) }
      : slide;
    return {
      archetype: o.archetype, purpose: o.purpose,
      svg: injectMockups(renderComposite(rendered, base), r.layout, mockups),
      gate: v.reject ? "REJECT" : v.pass ? "PASS" : "REVISE",
      novelty: v.scores.layoutNovelty, overall: v.scores.overall,
    };
  });

  return { title: outline.title, theme, slides };
}
