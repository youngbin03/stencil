// Phase 4.7-a E2E: prompt -> outline (composer) -> per-slide placement (director)
// -> relation-based solve (reflow) -> render. Cards adapt to content count.
// Usage: node scripts/phase47.mjs <theme> "<prompt>"   (needs ANTHROPIC_API_KEY)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { outlineDeck } from "../packages/composer/dist/index.js";
import { planSlide } from "../packages/director/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";

const theme = process.argv[2] || "green";
const prompt = process.argv[3] || "2026 Q1 business review: five objectives across energy, market, recycling, safety, cost; key metrics; next steps";

const system = JSON.parse(readFileSync(resolve(`fixtures/assets/${theme}/system.json`), "utf8"));
const byId = new Map(system.layouts.map((l) => [l.id, l]));

console.log(`outlining "${prompt}"  (theme ${theme})`);
const outline = await outlineDeck(system, prompt, { slides: 6 });
console.log(`deck: "${outline.title}" — ${outline.slides.length} slides`);

const outDir = resolve("fixtures/out/deck47");
mkdirSync(outDir, { recursive: true });
const cards = [];

let i = 0;
for (const s of outline.slides) {
  const layout = byId.get(s.layoutId);
  if (!layout) continue;
  i++;
  const plan = await planSlide(layout, s.purpose, outline.title, prompt);
  const slide = solveDeckSlide(layout, plan, system.tokens, system.canvas);
  const deco = readFileSync(resolve(`fixtures/assets/${theme}/decorations/${s.layoutId}.svg`), "utf8");
  const svg = renderComposite(slide, deco);
  const file = `${String(i).padStart(2, "0")}_${s.layoutId}.svg`;
  writeFileSync(resolve(outDir, file), svg, "utf8");
  console.log(`  ${i}. ${s.layoutId} [${layout.archetype}] cards=${plan.cards.length} singles=${Object.keys(plan.singles).length}${slide.suppressDecorationIds ? " (reflowed)" : ""}`);
  cards.push(`<figure><figcaption>${i}. ${s.layoutId} [${layout.archetype}] — cards ${plan.cards.length}</figcaption><img src="deck47/${file}"></figure>`);
}

const html = `<!doctype html><meta charset="utf-8"><title>${outline.title}</title>
<style>body{font:14px -apple-system,system-ui,sans-serif;margin:24px;background:#fafafa}
figure{margin:0 0 24px}figcaption{font-size:12px;color:#555;margin-bottom:6px}
img{width:100%;max-width:960px;border:1px solid #ddd;border-radius:6px;display:block}</style>
<h1>${outline.title} — ${theme} (4.7-a)</h1>${cards.join("\n")}`;
writeFileSync(resolve("fixtures/out/deck47.html"), html, "utf8");
console.log("viewer: fixtures/out/deck47.html");
