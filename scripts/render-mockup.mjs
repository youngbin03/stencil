import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildGrammarSpec, synthesizeFromGrammar, archetypeSchema, chooseDecoration } from "../packages/synthesizer/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { placeMockup } from "../packages/normalizer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

const theme = "black";
const sys = JSON.parse(readFileSync(`fixtures/assets/${theme}/system.json`, "utf8"));
const spec = buildGrammarSpec(sys);
const mockups = {};
for (const f of readdirSync(`fixtures/assets/${theme}/mockups`)) mockups[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(`fixtures/assets/${theme}/mockups/${f}`, "utf8"));

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
  subtitle: "Built for modern support teams", eyebrow: "Product", label: "Product",
  body: "Your AI copilot drafts replies your team can send in one click.",
  bullet: "Drafts replies instantly", quote: "Pulse changed how we work.",
  caption: "Support copilot", footer: "Pulse — AI Support", pagenum: "01", kpi: "62%",
};
const content = (arch) => {
  const s = archetypeSchema(spec, arch);
  const singles = {};
  for (const r of s.singles) singles[r] = ALL[r] ?? "Built for support teams";
  const cards = s.cardRoles.length ? [0, 1, 2].map((i) => Object.fromEntries(s.cardRoles.map((r) => [r, r === "kpi" ? ["62%", "4x", "+18"][i] : ["Deflected", "Faster", "CSAT"][i]]))) : undefined;
  return { archetype: arch, singles, ...(cards ? { cards } : {}) };
};

mkdirSync("fixtures/out/mockup-verify", { recursive: true });
const made = [];
for (const a of spec.archetypes) {
  const { layout, placement } = synthesizeFromGrammar(spec, content(a.archetype));
  const hasMock = layout.slots.some((s) => s.mockupRef);
  if (!hasMock) continue;
  const slide = solveDeckSlide(layout, placement, spec, { w: spec.canvas.w, h: spec.canvas.h });
  const deco = chooseDecoration(spec, slide, a.archetype, 0);
  let svg = renderComposite(slide, deco.svg);
  svg = injectMockups(svg, layout);
  const out = `fixtures/out/mockup-verify/${theme}_${a.archetype}.png`;
  writeFileSync(out, rasterize(svg, 1280));
  const n = layout.slots.filter((s) => s.mockupRef).length;
  made.push(`${a.archetype} (${n} mockup frame${n > 1 ? "s" : ""}) → ${out}`);
}
console.log(made.length ? made.join("\n") : "no archetype produced a mockup zone");
