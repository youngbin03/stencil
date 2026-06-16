// Phase 6 image support: place USER-PROVIDED images (we never generate) into
// synthesized layouts — split (1 image + text) and gallery (image row).
//   node scripts/phase6-img.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildGrammarSpec, synthesizeFromGrammar, evaluateSlide } from "../packages/synthesizer/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/index.js";

const sys = JSON.parse(readFileSync(resolve("fixtures/assets/colorful/system.json"), "utf8"));
const spec = buildGrammarSpec(sys);

const uri = (p) => "data:image/jpeg;base64," + readFileSync(p).toString("base64");
const pool = ["fixtures/sample/photo1.jpg", "fixtures/sample/p2.jpg", "fixtures/sample/p3.jpg"]
  .filter((p) => existsSync(resolve(p))).map((p, i) => ({ id: "u" + i, url: uri(resolve(p)) }));
if (pool.length === 0) { console.error("no sample images under fixtures/sample"); process.exit(1); }

const deco = () => { const { w, h } = spec.canvas; return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${spec.colors.bg}"/></svg>`; };

const plans = [
  { name: "content-split", plan: { archetype: "content", singles: { eyebrow: "PRODUCT", title: "Designed for flow", body: "Aero keeps every screen on-brand while you move fast." }, images: [pool[0]] } },
  { name: "gallery", plan: { archetype: "gallery", singles: { eyebrow: "SHOWCASE", title: "In the wild" }, images: pool } },
];

mkdirSync(resolve("fixtures/out/phase6img"), { recursive: true });
for (const { name, plan } of plans) {
  const { layout, placement } = synthesizeFromGrammar(spec, plan);
  const slide = solveDeckSlide(layout, placement, sys.tokens, sys.canvas);
  const v = evaluateSlide(sys, spec, layout, slide);
  writeFileSync(resolve("fixtures/out/phase6img", `${name}.png`), rasterize(renderComposite(slide, deco()), 960));
  const imgN = slide.elements.filter((e) => e.kind === "image").length;
  console.log(`${name}: images=${imgN} novelty=${v.scores.layoutNovelty.toFixed(0)} overall=${v.scores.overall.toFixed(1)} ${v.reject ? "REJECT" : v.pass ? "PASS" : "REVISE"}`);
}
console.log("pngs: fixtures/out/phase6img/");
