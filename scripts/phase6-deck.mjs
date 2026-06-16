// Phase 6 end-to-end: prompt → synthesized deck (no frame copy) → viewer.
// Claude plans the archetype sequence + writes content; the synthesizer builds new
// layouts from the grammar; the evaluator gates each slide (revise<7 / reject<6).
//   node scripts/phase6-deck.mjs "<prompt>"   (needs ANTHROPIC_API_KEY)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { buildGrammarSpec, synthesizeFromGrammar, evaluateSlide, archetypeSchema, synthDecoration } from "../packages/synthesizer/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/index.js";

const theme = "colorful";
const prompt = process.argv[2] || "Aero — an AI design assistant: vision, key features, traction, pricing, and a closing call to action";
const sys = JSON.parse(readFileSync(resolve(`fixtures/assets/${theme}/system.json`), "utf8"));
const spec = buildGrammarSpec(sys);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const archetypes = spec.archetypes.filter((a) => a.zones.some((z) => z.id !== "footer")).map((a) => a.archetype);
const catalog = archetypes.map((a) => { const s = archetypeSchema(spec, a); return `- ${a}: singles[${s.singles.join(",")}]${s.cardRoles.length ? ` cards[${s.cardRoles.join("/")}]` : ""}`; }).join("\n");

async function tool(system, user, schema) {
  const res = await anthropic.messages.create({ model, max_tokens: 2048, system,
    tools: [{ name: "out", description: "structured output", input_schema: schema }],
    tool_choice: { type: "tool", name: "out" }, messages: [{ role: "user", content: user }] });
  const t = res.content.find((c) => c.type === "tool_use");
  return t.input;
}

const outline = await tool(
  "You plan a presentation as a sequence of composition ARCHETYPES (not fixed templates). Pick archetypes that fit the narrative; cover first, closing/section last.",
  `Topic: ${prompt}\n\nAvailable archetypes (with the content each shows):\n${catalog}\n\nPlan 5-6 slides.`,
  { type: "object", properties: { title: { type: "string" }, slides: { type: "array", items: { type: "object", properties: { archetype: { type: "string" }, purpose: { type: "string" } }, required: ["archetype", "purpose"], additionalProperties: false } } }, required: ["title", "slides"], additionalProperties: false });

console.log(`title: ${outline.title}\n`);

async function writeContent(archetype, purpose, shorter) {
  const s = archetypeSchema(spec, archetype);
  const cardLine = s.cardRoles.length ? `\nAlso write 3 cards, each with: ${s.cardRoles.join(", ")} (kpi = a short metric like +38%, 120K).` : "";
  const brief = shorter ? " Keep every value SHORT (title ≤ 5 words, body ≤ 12 words)." : "";
  const input = await tool(
    `You write slide copy. Provide concise text for each requested role. Title/headline = punchy; body = one short sentence; caption/label = a few words; quote = one sentence.${brief}`,
    `Deck: ${outline.title}\nTopic: ${prompt}\nThis slide (${archetype}): ${purpose}\nWrite singles for roles: ${s.singles.join(", ")}.${cardLine}`,
    { type: "object", properties: {
        singles: { type: "array", items: { type: "object", properties: { role: { type: "string" }, text: { type: "string" } }, required: ["role", "text"], additionalProperties: false } },
        cards: { type: "array", items: { type: "object", properties: { slots: { type: "array", items: { type: "object", properties: { role: { type: "string" }, text: { type: "string" } }, required: ["role", "text"], additionalProperties: false } } }, required: ["slots"], additionalProperties: false } },
      }, required: ["singles"], additionalProperties: false });
  const singles = {}; for (const x of input.singles) singles[x.role] = x.text;
  const cards = (input.cards ?? []).map((c) => { const r = {}; for (const x of c.slots) r[x.role] = x.text; return r; });
  return { archetype, singles, ...(cards.length ? { cards } : {}) };
}

const mapLimit = async (items, n, fn) => { const out = []; for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn))); return out; };

const results = await mapLimit(outline.slides, 3, async (o) => {
  let content = await writeContent(o.archetype, o.purpose, false);
  let { layout, placement } = synthesizeFromGrammar(spec, content);
  let slide = solveDeckSlide(layout, placement, sys.tokens, sys.canvas);
  let v = evaluateSlide(sys, spec, layout, slide);
  if (!v.pass && !v.reject) { // one revise pass with shorter copy
    content = await writeContent(o.archetype, o.purpose, true);
    ({ layout, placement } = synthesizeFromGrammar(spec, content));
    slide = solveDeckSlide(layout, placement, sys.tokens, sys.canvas);
    v = evaluateSlide(sys, spec, layout, slide);
  }
  return { o, slide, v };
});

mkdirSync(resolve("fixtures/out/phase6deck"), { recursive: true });
const cards = [];
results.forEach((r, i) => {
  const file = `${String(i + 1).padStart(2, "0")}_${r.o.archetype}.png`;
  writeFileSync(resolve("fixtures/out/phase6deck", file), rasterize(renderComposite(r.slide, synthDecoration(spec, r.o.archetype, i)), 960));
  const g = r.v.reject ? "REJECT" : r.v.pass ? "PASS" : "REVISE";
  console.log(`${String(i + 1).padStart(2, "0")} ${r.o.archetype.padEnd(10)} ${g.padEnd(7)} nov=${r.v.scores.layoutNovelty.toFixed(0)} overall=${r.v.scores.overall.toFixed(1)}  ${r.o.purpose}`);
  cards.push(`<figure><figcaption>${i + 1}. ${r.o.archetype} — ${g} (overall ${r.v.scores.overall.toFixed(1)}, novelty ${r.v.scores.layoutNovelty.toFixed(0)})<br>${r.o.purpose}</figcaption><img src="phase6deck/${file}"></figure>`);
});
writeFileSync(resolve("fixtures/out/phase6deck.html"), `<!doctype html><meta charset=utf-8><title>${outline.title}</title><link rel=stylesheet href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Bricolage+Grotesque:wght@400;600;700;800&display=swap"><style>body{font:14px -apple-system,sans-serif;margin:24px;background:#f7f8fa;color:#191f28}h1{font-size:20px}figure{margin:0 0 22px}figcaption{font-size:12px;color:#6b7684;margin-bottom:6px}img{width:100%;max-width:960px;border:1px solid #e8eaed;border-radius:8px;display:block}</style><h1>${outline.title} — synthesized (${theme})</h1>${cards.join("\n")}`);
console.log("\nviewer: fixtures/out/phase6deck.html");
