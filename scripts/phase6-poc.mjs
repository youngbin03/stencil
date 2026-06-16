// Phase 6.0 PoC: synthesize a NEW page (metric-row) from blocks + grammar that
// equals no original frame, then assemble with the existing solver + renderer.
//   node scripts/phase6-poc.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { synthesize, pickDecorationFrame } from "../packages/synthesizer/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/index.js";

const theme = "colorful";
const system = JSON.parse(readFileSync(resolve(`fixtures/assets/${theme}/system.json`), "utf8"));

// Hardcoded content (no director yet) — the point is the composition, not the copy.
const plans = [
  {
    name: "metric-row-3",
    plan: {
      archetype: "metric-row",
      singles: { eyebrow: "TRACTION", title: "Momentum that compounds every quarter" },
      block: {
        id: "card_kpi_caption",
        cards: [
          { kpi: "120K+", caption: "active users" },
          { kpi: "+38%", caption: "QoQ revenue growth" },
          { kpi: "99.99%", caption: "platform uptime" },
        ],
      },
    },
  },
  {
    name: "metric-row-4",
    plan: {
      archetype: "metric-row",
      singles: { eyebrow: "BY THE NUMBERS", title: "Built for scale" },
      block: {
        id: "card_kpi_caption",
        cards: [
          { kpi: "4ms", caption: "p99 latency" },
          { kpi: "1.2M", caption: "writes / sec" },
          { kpi: "60+", caption: "regions" },
          { kpi: "5.2pp", caption: "churn reduction" },
        ],
      },
    },
  },
];

// Generated decoration treatment (taste of v1.5): a single soft corner blob from
// the palette, anchored top-right off-canvas so it never collides with content.
// On-brand by construction (palette color) — no frame-specific marks borrowed.
function bareDecoration(sys) {
  const { w, h } = sys.canvas;
  const accent = (sys.tokens.palette ?? []).find((c) => /^#/.test(c) && c.toLowerCase() !== "#ffffff" && c.toLowerCase() !== "#f3f3f3") ?? "#5FA0FB";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${w}" height="${h}" fill="${sys.tokens.colors.bg}"/>` +
    `<circle cx="${w}" cy="0" r="${Math.round(h * 0.42)}" fill="${accent}" fill-opacity="0.9"/>` +
    `</svg>`;
}

mkdirSync(resolve("fixtures/out/phase6"), { recursive: true });
const out = [];
const origIds = new Set(system.layouts.map((l) => l.id));

for (const { name, plan } of plans) {
  const { layout, placement } = synthesize(system, plan);

  const contentRegions = layout.regions.map((r) => r.bbox);
  const slide = solveDeckSlide(layout, placement, system.tokens, system.canvas);
  const isOriginal = origIds.has(layout.id);
  const warn = slide.warnings.filter((w) => /high|overlap|out_of|overflow/.test(w));

  // (a) whole-reuse v1: borrow the least-overlapping frame decoration.
  const decoFrame = pickDecorationFrame(system, contentRegions);
  const borrowed = readFileSync(resolve(`fixtures/assets/${theme}/decorations/${decoFrame}.svg`), "utf8");
  writeFileSync(resolve("fixtures/out/phase6", `${name}_borrowed.png`), rasterize(renderComposite(slide, borrowed), 960));

  // (b) generated treatment: palette corner blob (on-brand, no borrowed marks).
  writeFileSync(resolve("fixtures/out/phase6", `${name}_generated.png`), rasterize(renderComposite(slide, bareDecoration(system)), 960));

  console.log(`${name}: layoutId="${layout.id}" original=${isOriginal} cards=${placement.cards.length} elems=${slide.elements.length} borrowedDeco=${decoFrame}${warn.length ? "  ⚠ " + warn.join("; ") : "  ✓ clean"}`);
  out.push(`${name}_borrowed.png`, `${name}_generated.png`);
}

const cards = out.map((f) => `<figure><figcaption>${f.replace(".png", "")}</figcaption><img src="phase6/${f}"></figure>`).join("\n");
writeFileSync(resolve("fixtures/out/phase6.html"), `<!doctype html><meta charset=utf-8><title>phase6 synthesis</title><style>body{font:13px -apple-system,sans-serif;margin:24px;background:#fafafa}figure{margin:0 0 20px}figcaption{font-size:12px;color:#555;margin-bottom:4px}img{width:100%;max-width:900px;border:1px solid #ddd;border-radius:6px;display:block}</style><h1>Phase 6 — synthesized pages (no original frame)</h1>${cards}`);
console.log("\nviewer: fixtures/out/phase6.html");
