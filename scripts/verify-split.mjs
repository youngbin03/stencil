// Verify C: side-by-side (split) disposition fires where the theme uses it, and
// stacked/card archetypes are unchanged. node scripts/verify-split.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildGrammarSpec, synthesizeFromGrammar, chooseDecoration } from "../packages/synthesizer/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/index.js";

const cases = [
  { theme: "green", name: "closing", plan: { archetype: "closing", singles: { title: "Let's build together", body: "Start your first deck today and ship something in minutes, not hours." } } },
  { theme: "green", name: "gallery", plan: { archetype: "gallery", singles: { header: "GALLERY", title: "Our recent work", body: "A selection of decks teams shipped with Terra this quarter." } } },
  { theme: "colorful", name: "content", plan: { archetype: "content", singles: { eyebrow: "WHY AERO", title: "Built for designers" },
      cards: [{ headline: "Ship faster", label: "speed", body: "Instant layouts from a prompt." },
              { headline: "Stay on brand", label: "system", body: "Every slide obeys your tokens." },
              { headline: "Scale", label: "growth", body: "From one deck to a hundred." }] } },
  { theme: "colorful", name: "stat", plan: { archetype: "stat", singles: { eyebrow: "TRACTION", title: "Momentum that compounds" },
      cards: [{ kpi: "120K+", caption: "active users" }, { kpi: "+38%", caption: "QoQ growth" }, { kpi: "99.99%", caption: "uptime" }] } },
];

mkdirSync(resolve("fixtures/out/verifysplit"), { recursive: true });
const specs = {};
const out = [];
for (const { theme, name, plan } of cases) {
  const spec = specs[theme] ?? (specs[theme] = buildGrammarSpec(JSON.parse(readFileSync(resolve(`fixtures/assets/${theme}/system.json`), "utf8"))));
  const system = JSON.parse(readFileSync(resolve(`fixtures/assets/${theme}/system.json`), "utf8"));
  const { layout, placement } = synthesizeFromGrammar(spec, plan);
  const slide = solveDeckSlide(layout, placement, system.tokens, system.canvas);
  const { svg } = chooseDecoration(spec, slide, plan.archetype, 0);
  const composite = renderComposite(slide, svg);
  const file = `${theme}_${name}.png`;
  writeFileSync(resolve("fixtures/out/verifysplit", file), rasterize(composite, 960));
  // detect side-by-side: title and body slots overlapping vertically but x-separated
  const t = slide.elements.find((e) => e.kind === "text" && layout.slots.find((s) => s.id === "title")?.bbox.y === e.bbox.y) ;
  const ts = layout.slots.find((s) => s.id === "title");
  const bs = layout.slots.find((s) => s.id === "body");
  let disp = "stack";
  if (ts && bs) {
    const vOverlap = Math.min(ts.bbox.y + ts.bbox.h, bs.bbox.y + bs.bbox.h) - Math.max(ts.bbox.y, bs.bbox.y);
    const xSep = bs.bbox.x - (ts.bbox.x + ts.bbox.w);
    if (vOverlap > 0 && xSep > -50) disp = `SPLIT (title.x=${ts.bbox.x} body.x=${bs.bbox.x})`;
  }
  console.log(`${theme}/${name}`.padEnd(20), disp);
  out.push({ file, name: `${theme}/${name} — ${disp}` });
}
writeFileSync(resolve("fixtures/out/verifysplit.html"),
  `<!doctype html><meta charset=utf-8><style>body{font:13px sans-serif;margin:24px;background:#fafafa}figcaption{color:#555;margin-bottom:4px}img{width:100%;max-width:900px;border:1px solid #ddd;border-radius:6px;display:block;margin-bottom:20px}</style>` +
  out.map((o) => `<figure><figcaption>${o.name}</figcaption><img src="verifysplit/${o.file}"></figure>`).join("\n"));
console.log("viewer: fixtures/out/verifysplit.html");
