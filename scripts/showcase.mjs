// Showcase: 2 distinct slides per theme (different archetypes), full pipeline.
// node scripts/showcase.mjs   (needs ANTHROPIC_API_KEY)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { planSlide } from "../packages/director/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/index.js";

const THEMES = {
  colorful: "New product launch: an AI design assistant — key features, early traction, simple pricing",
  black: "2026 engineering review: reliability, performance gains, and the next roadmap",
  green: "Sustainability report 2026: emissions cut, clean energy share, and targets",
};

const uri = (p) => "data:image/jpeg;base64," + readFileSync(p).toString("base64");
const pool = ["fixtures/sample/photo1.jpg", "fixtures/sample/p2.jpg", "fixtures/sample/p3.jpg"]
  .filter(existsSync)
  .map((p, i) => ({ id: `img${i + 1}`, url: uri(p), desc: ["abstract/architecture", "team/people", "landscape"][i] }));

mkdirSync(resolve("fixtures/out/showcase"), { recursive: true });
const cards = [];

function pickTwo(system) {
  const byArch = new Map();
  for (const L of system.layouts) {
    const a = L.archetype ?? "other";
    if (!byArch.has(a)) byArch.set(a, L);
  }
  const order = ["stat", "content", "team", "cover", "quote", "agenda", "gallery", "comparison", "section", "closing", "other"];
  const picked = [];
  for (const a of order) { if (byArch.has(a)) picked.push(byArch.get(a)); if (picked.length === 2) break; }
  while (picked.length < 2 && system.layouts.length > picked.length) picked.push(system.layouts[picked.length]);
  return picked;
}

for (const [theme, topic] of Object.entries(THEMES)) {
  const system = JSON.parse(readFileSync(resolve(`fixtures/assets/${theme}/system.json`), "utf8"));
  const layouts = pickTwo(system);
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i];
    const plan = await planSlide(layout, `${layout.archetype} slide for the topic`, topic, topic, { assetPool: pool });
    const slide = solveDeckSlide(layout, plan, system.tokens, system.canvas);
    const deco = readFileSync(resolve(`fixtures/assets/${theme}/decorations/${layout.id}.svg`), "utf8");
    const png = rasterize(renderComposite(slide, deco), 960);
    const file = `${theme}_${i + 1}_${layout.archetype}.png`;
    writeFileSync(resolve("fixtures/out/showcase", file), png);
    console.log(`${theme} #${i + 1} ${layout.id} [${layout.archetype}] cards=${plan.cards.length} singles=${Object.keys(plan.singles).length} images=${Object.keys(plan.images ?? {}).length}`);
    cards.push(file);
  }
}
console.log("\nfiles:", cards.join(", "));
