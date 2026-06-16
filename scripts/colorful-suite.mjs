// Generate diverse colorful slides (one per archetype) for quality review.
// node scripts/colorful-suite.mjs   (needs ANTHROPIC_API_KEY)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { planSlide } from "../packages/director/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/index.js";

const topic = "Aero — an AI design assistant: features, traction, pricing, team, and roadmap";
const system = JSON.parse(readFileSync(resolve("fixtures/assets/colorful/system.json"), "utf8"));

const uri = (p) => "data:image/jpeg;base64," + readFileSync(p).toString("base64");
const pool = ["fixtures/sample/photo1.jpg", "fixtures/sample/p2.jpg", "fixtures/sample/p3.jpg"]
  .filter(existsSync).map((p, i) => ({ id: `img${i + 1}`, url: uri(p), desc: ["abstract", "people", "landscape"][i] }));

// one layout per archetype (first seen)
const seen = new Map();
for (const L of system.layouts) { const a = L.archetype ?? "other"; if (!seen.has(a)) seen.set(a, L); }

mkdirSync(resolve("fixtures/out/colorful"), { recursive: true });
const out = [];
for (const [arch, layout] of seen) {
  const plan = await planSlide(layout, `${arch} slide`, "Aero", topic, { assetPool: pool });
  const slide = solveDeckSlide(layout, plan, system.tokens, system.canvas);
  const deco = readFileSync(resolve(`fixtures/assets/colorful/decorations/${layout.id}.svg`), "utf8");
  const file = `${arch}_${layout.id}.png`;
  writeFileSync(resolve("fixtures/out/colorful", file), rasterize(renderComposite(slide, deco), 960));
  const warn = slide.warnings.filter((w) => /high|overlap|out_of/.test(w));
  console.log(`${arch.padEnd(11)} ${layout.id} cards=${plan.cards.length} singles=${Object.keys(plan.singles).length} img=${Object.keys(plan.images ?? {}).length}${warn.length ? "  ⚠ " + warn.join("; ") : ""}`);
  out.push(file);
}

const cards = out.map((f) => `<figure><figcaption>${f.replace(".png", "")}</figcaption><img src="colorful/${f}"></figure>`).join("\n");
writeFileSync(resolve("fixtures/out/colorful.html"), `<!doctype html><meta charset=utf-8><title>colorful</title><style>body{font:13px -apple-system,sans-serif;margin:24px;background:#fafafa}figure{margin:0 0 20px}figcaption{font-size:12px;color:#555;margin-bottom:4px}img{width:100%;max-width:900px;border:1px solid #ddd;border-radius:6px;display:block}</style><h1>Colorful suite</h1>${cards}`);
console.log("\nviewer: fixtures/out/colorful.html");
