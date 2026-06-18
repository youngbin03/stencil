import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { buildGrammarSpec, synthesizeFromGrammar, archetypeSchema, pickDecoration } from "../packages/synthesizer/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { placeMockup } from "../packages/normalizer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

const theme = process.argv[2] ?? "colorful";
const sys = JSON.parse(readFileSync(`fixtures/assets/${theme}/system.json`, "utf8"));
const spec = buildGrammarSpec(sys);
let decoLib = [];
try { decoLib = JSON.parse(readFileSync(`fixtures/assets/${theme}/decorations-lib.json`, "utf8")); } catch {}
const mockups = {};
try { for (const f of readdirSync(`fixtures/assets/${theme}/mockups`)) mockups[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(`fixtures/assets/${theme}/mockups/${f}`, "utf8")); } catch {}

function injectMockups(svg, layout) {
  const seen = new Set(); let defs = "", body = "";
  for (const s of layout.slots) {
    if (!s.mockupRef) continue;
    const asset = mockups[s.mockupRef]; if (!asset) continue;
    const { defs: d, markup } = placeMockup(asset, s.bbox);
    if (!seen.has(s.mockupRef)) { defs += d; seen.add(s.mockupRef); }
    body += markup;
  }
  return body ? svg.replace("</svg>", `${defs}${body}</svg>`) : svg;
}

const ALL = {
  title: "Ship Faster With Pulse", headline: "Ship Faster With Pulse",
  subtitle: "Built for modern support teams", eyebrow: "Product", label: "Starter",
  body: "Your AI copilot drafts replies your team can send in one click.",
  bullet: "Drafts replies instantly", quote: "Pulse changed how we work.",
  caption: "Auto-drafted replies", footer: "Pulse — AI Support", pagenum: "01", kpi: "62%",
};
const tiers = [["Starter", "$29/mo", "For small teams getting started"], ["Growth", "$99/mo", "For scaling support orgs"], ["Enterprise", "Custom", "SSO, SLA, dedicated support"]];
const caps = ["Auto-drafted replies", "Tone & brand matching", "Knowledge-base grounding"];
const content = (arch) => {
  const s = archetypeSchema(spec, arch);
  const singles = {};
  for (const r of s.singles) singles[r] = ALL[r] ?? "Built for support teams";
  let cards;
  if (s.cardRoles.length) {
    cards = [0, 1, 2].map((i) => Object.fromEntries(s.cardRoles.map((r) => {
      if (r === "kpi") return [r, ["62%", "4x", "+18"][i]];
      if (r === "caption") return [r, caps[i]];
      if (r === "label") return [r, tiers[i][0]];
      if (r === "headline") return [r, tiers[i][1]];
      if (r === "body") return [r, tiers[i][2]];
      return [r, ["Deflected", "Faster", "CSAT"][i]];
    })));
  }
  return { archetype: arch, singles, ...(cards ? { cards } : {}) };
};

mkdirSync("fixtures/out/verify", { recursive: true });
let i = 0;
for (const a of spec.archetypes) {
  const { layout, placement } = synthesizeFromGrammar(spec, content(a.archetype));
  const slide = solveDeckSlide(layout, placement, spec, { w: spec.canvas.w, h: spec.canvas.h });
  const obstacles = layout.slots.filter((s) => s.type === "image").map((s) => s.bbox);
  const deco = pickDecoration(spec, slide, a.archetype, i++, decoLib, obstacles);
  const dark = (hex) => { const h = (hex || "").replace("#", ""); if (h.length !== 6) return false; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.62; };
  const rendered = deco.bg && dark(deco.bg) ? { ...slide, elements: slide.elements.map((e) => (e.kind === "text" ? { ...e, color: "#FFFFFF" } : e)) } : slide;
  let svg = injectMockups(renderComposite(rendered, deco.svg), layout);
  writeFileSync(`fixtures/out/verify/${theme}_${a.archetype}.png`, rasterize(svg, 1200));
  console.log(`${theme}_${a.archetype}: ${deco.reason}`);
}
