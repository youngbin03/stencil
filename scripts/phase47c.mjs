// Phase 4.7-c E2E: render -> vision critique -> revise (evaluator-optimizer, N<=2).
// Demonstrates the loop on one slide. Usage: node scripts/phase47c.mjs <theme> <frame>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { planSlide } from "../packages/director/dist/index.js";
import { critiqueSlide } from "../packages/critic/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/index.js";

const theme = process.argv[2] || "green";
const frame = process.argv[3] || "Frame-3";
const layoutId = `${theme}_${frame}`;
const topic = "2026 Q1 review: objectives across energy, market, recycling, safety, cost with key metrics";

const system = JSON.parse(readFileSync(resolve(`fixtures/assets/${theme}/system.json`), "utf8"));
const layout = system.layouts.find((l) => l.id === layoutId);
if (!layout) { console.error("no layout", layoutId); process.exit(1); }
const deco = readFileSync(resolve(`fixtures/assets/${theme}/decorations/${layoutId}.svg`), "utf8");
const ctx = { archetype: layout.archetype, palette: system.tokens.palette, grammarNote: "follow the template's spacing, alignment and emphasis" };

mkdirSync(resolve("fixtures/out/loop"), { recursive: true });
const MAX = 2;
let feedback;
for (let iter = 1; iter <= MAX; iter++) {
  const plan = await planSlide(layout, "Key objectives and metrics", "Q1 Review", topic,
    feedback ? { feedback } : {});
  const slide = solveDeckSlide(layout, plan, system.tokens, system.canvas);
  const svg = renderComposite(slide, deco);
  const png = rasterize(svg, 960);
  writeFileSync(resolve(`fixtures/out/loop/iter${iter}.svg`), svg);
  writeFileSync(resolve(`fixtures/out/loop/iter${iter}.png`), png);

  const patch = await critiqueSlide(png, ctx);
  console.log(`iter ${iter}: cards=${plan.cards.length} verdict=${patch.verdict} issues=${patch.issues.length}`);
  for (const is of patch.issues) console.log(`   [${is.severity}] ${is.target}: ${is.problem} -> ${is.fix}`);

  if (patch.verdict === "accept" || iter === MAX) break;
  feedback = patch.issues.map((i) => `- ${i.target}: ${i.problem}. Fix: ${i.fix}`).join("\n");
}
console.log("done. fixtures/out/loop/");
