// Phase 6: synthesize NEW slides from the structured grammar only (no frame copy),
// score each with the quality rubric, gate (revise <7 / reject novelty <6), render.
//   node scripts/phase6-synth.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildGrammarSpec, synthesizeFromGrammar, evaluateSlide } from "../packages/synthesizer/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/index.js";

const theme = "colorful";
const system = JSON.parse(readFileSync(resolve(`fixtures/assets/${theme}/system.json`), "utf8"));
const spec = buildGrammarSpec(system);

function decoration() {
  const { w, h } = spec.canvas;
  const accent = spec.palette.find((c) => /^#/.test(c) && !/f3f3f3|ffffff/i.test(c)) ?? "#5FA0FB";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${spec.colors.bg}"/><circle cx="${w}" cy="0" r="${Math.round(h * 0.4)}" fill="${accent}" fill-opacity="0.9"/></svg>`;
}

const plans = [
  { name: "cover", plan: { archetype: "cover", singles: { eyebrow: "AI DESIGN", title: "Meet Aero" } } },
  { name: "stat", plan: { archetype: "stat", singles: { eyebrow: "TRACTION", title: "Momentum that compounds" },
      cards: [{ kpi: "120K+", caption: "active users" }, { kpi: "+38%", caption: "QoQ growth" }, { kpi: "99.99%", caption: "uptime" }] } },
  { name: "content", plan: { archetype: "content", singles: { eyebrow: "WHY AERO", title: "Built for designers" },
      cards: [{ headline: "Ship faster", label: "speed", body: "Instant layouts from a prompt." },
              { headline: "Stay on brand", label: "system", body: "Every slide obeys your tokens." },
              { headline: "Scale", label: "growth", body: "From one deck to a hundred." }] } },
  { name: "quote", plan: { archetype: "quote", singles: { quote: "Aero turned hours of slide work into minutes.", caption: "Sara Lin — Head of Design" } } },
  { name: "section", plan: { archetype: "section", singles: { eyebrow: "SECTION", title: "Built for designers", body: "How Aero turns ideas into polished decks." } } },
];

mkdirSync(resolve("fixtures/out/phase6synth"), { recursive: true });
const out = [];
const fmt = (s) => Object.entries(s).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(" ");

for (const { name, plan } of plans) {
  const { layout, placement } = synthesizeFromGrammar(spec, plan);
  const slide = solveDeckSlide(layout, placement, system.tokens, system.canvas);
  const verdict = evaluateSlide(system, spec, layout, slide);
  const svg = renderComposite(slide, decoration());
  const file = `${name}.png`;
  writeFileSync(resolve("fixtures/out/phase6synth", file), rasterize(svg, 960));
  const gate = verdict.reject ? "REJECT(novelty)" : verdict.pass ? "PASS" : "REVISE";
  console.log(`${name.padEnd(9)} ${gate.padEnd(15)} ${fmt(verdict.scores)}`);
  if (verdict.notes.length) console.log(`          notes: ${verdict.notes.slice(0, 4).join("; ")}`);
  out.push({ file, name });
}

const cards = out.map((o) => `<figure><figcaption>${o.name}</figcaption><img src="phase6synth/${o.file}"></figure>`).join("\n");
writeFileSync(resolve("fixtures/out/phase6synth.html"), `<!doctype html><meta charset=utf-8><title>phase6 synth</title><link rel=stylesheet href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bricolage+Grotesque:wght@400;600;700;800&display=swap"><style>body{font:13px -apple-system,sans-serif;margin:24px;background:#fafafa}figure{margin:0 0 20px}figcaption{font-size:12px;color:#555;margin-bottom:4px}img{width:100%;max-width:900px;border:1px solid #ddd;border-radius:6px;display:block}</style><h1>Phase 6 — synthesized from grammar (no frame copy)</h1>${cards}`);
console.log("\nviewer: fixtures/out/phase6synth.html");
