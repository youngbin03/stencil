// Phase 3 E2E: prompt -> compose (Claude) -> assemble (solver+renderer) -> deck SVG.
// Generation reads the design system asset + decoration fragments only (never originals).
// Usage: node scripts/phase3.mjs <theme> "<prompt>"   (needs ANTHROPIC_API_KEY)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { compose } from "../packages/composer/dist/index.js";
import { solveSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";

const theme = process.argv[2] || "colorful";
const prompt = process.argv[3] || "2026년 1분기 성과 보고: 매출 성장, 사용자 증가, 핵심 지표, 다음 분기 계획";

const sysPath = resolve(`fixtures/assets/${theme}/system.json`);
if (!existsSync(sysPath)) {
  console.error(`no design system for theme "${theme}" — run the extractor first`);
  process.exit(1);
}
const system = JSON.parse(readFileSync(sysPath, "utf8"));
const byId = new Map(system.layouts.map((l) => [l.id, l]));

const planCache = resolve(`fixtures/out/plan_${theme}.json`);
let plan;
if (process.argv.includes("--cached") && existsSync(planCache)) {
  plan = JSON.parse(readFileSync(planCache, "utf8"));
  console.log(`using cached plan (${planCache})`);
} else {
  console.log(`composing "${prompt}"\n  theme: ${theme} (${system.layouts.length} layouts)`);
  plan = await compose(system, prompt, { slides: 6 });
  mkdirSync(resolve("fixtures/out"), { recursive: true });
  writeFileSync(planCache, JSON.stringify(plan, null, 2));
}
console.log(`deck: "${plan.title}" — ${plan.slides.length} slides`);

const outDir = resolve("fixtures/out/deck");
mkdirSync(outDir, { recursive: true });
const cards = [];

plan.slides.forEach((s, i) => {
  const layout = byId.get(s.layoutId);
  if (!layout) return;
  const decoPath = resolve(`fixtures/assets/${theme}/decorations/${s.layoutId}.svg`);
  const decoration = readFileSync(decoPath, "utf8");
  const slide = solveSlide(layout, s.content, system.tokens, system.canvas);
  const svg = renderComposite(slide, decoration);
  const file = `${String(i + 1).padStart(2, "0")}_${s.layoutId}.svg`;
  writeFileSync(resolve(outDir, file), svg, "utf8");
  console.log(`  ${i + 1}. ${s.layoutId} [${layout.archetype}] — ${s.purpose}  (${slide.elements.length} elems${slide.warnings.length ? `, ${slide.warnings.length} warn` : ""})`);
  cards.push(`<figure><figcaption>${i + 1}. ${s.layoutId} [${layout.archetype}]<br><small>${s.purpose}</small></figcaption><img src="deck/${file}"></figure>`);
});

const html = `<!doctype html><meta charset="utf-8"><title>${plan.title}</title>
<style>body{font:14px -apple-system,system-ui,sans-serif;margin:24px;background:#fafafa}
h1{font-size:18px} figure{margin:0 0 24px} figcaption{font-size:12px;color:#555;margin-bottom:6px}
img{width:100%;max-width:960px;border:1px solid #ddd;border-radius:6px;display:block}</style>
<h1>${plan.title} — ${theme}</h1>${cards.join("\n")}`;
writeFileSync(resolve("fixtures/out/deck.html"), html, "utf8");
console.log("\nviewer: fixtures/out/deck.html");
