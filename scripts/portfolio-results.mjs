import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildGrammarSpec, synthesizeFromGrammar, archetypeSchema, chooseDecoration } from "../packages/synthesizer/dist/index.js";
import { solveDeckSlide } from "../packages/solver/dist/index.js";
import { renderComposite } from "../packages/renderer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

// Generate clean, varied synthesis results for the portfolio gallery.
const TITLES = {
  cover: "Support that never sleeps",
  content: "Support teams are drowning",
  stat: "Momentum you can measure",
  comparison: "Legacy tools vs Pulse",
  quote: "Pulse turned hours of triage into minutes.",
  section: "How Pulse works",
  agenda: "What we'll cover",
  closing: "Let's ship faster, together",
  team: "The people behind Pulse",
};
const SINGLES = (arch, role) => ({
  title: TITLES[arch] ?? "Built for modern support teams",
  headline: TITLES[arch] ?? "Built for modern support teams",
  quote: TITLES.quote,
  subtitle: "An AI copilot for customer support",
  eyebrow: arch === "section" ? "02" : "Pulse",
  label: "Pulse",
  body: "Pulse drafts replies your team can send in one click — grounded in your own docs.",
  caption: "Sara Lin · Head of Support, Northwind",
  footer: "Pulse — AI Support Copilot",
  pagenum: "01",
}[role] ?? "Built for support teams");

// [name, description, kicker] — distinct content per card role (no duplicate lines).
const FEAT = [
  ["Auto-draft", "Drafts replies instantly from your knowledge base.", "Speed"],
  ["Smart routing", "Sends every ticket to the right agent in seconds.", "Accuracy"],
  ["Live insights", "Surfaces trends before they become problems.", "Foresight"],
];
const KPI = ["62%", "4x", "+18"];
const KCAP = ["tickets deflected", "faster first reply", "CSAT points"];
const cardCell = (role, i) => {
  if (role === "kpi") return KPI[i] ?? "3x";
  if (role === "caption") return KCAP[i] ?? FEAT[i]?.[2] ?? "—";
  if (role === "body") return FEAT[i]?.[1] ?? "—";              // description
  if (role === "subtitle" || role === "label") return FEAT[i]?.[2] ?? "—"; // short kicker
  return FEAT[i]?.[0] ?? "—";                                   // headline = the name
};
const content = (spec, arch) => {
  const s = archetypeSchema(spec, arch);
  const singles = {};
  for (const r of s.singles) singles[r] = SINGLES(arch, r);
  const cards = s.cardRoles.length ? [0, 1, 2].map((i) => Object.fromEntries(s.cardRoles.map((r) => [r, cardCell(r, i)]))) : undefined;
  return { archetype: arch, singles, ...(cards ? { cards } : {}) };
};

const outDir = "fixtures/out/portfolio";
mkdirSync(outDir, { recursive: true });
const themes = ["colorful", "black", "green"];
const made = [];
for (const theme of themes) {
  const p = `fixtures/assets/${theme}/system.json`;
  if (!existsSync(p)) continue;
  const spec = buildGrammarSpec(JSON.parse(readFileSync(p, "utf8")));
  for (const sk of spec.archetypes) {
    const arch = sk.archetype;
    if (arch === "other" || arch === "gallery") continue;            // skip noise/3-up
    if (sk.imageZones.some((z) => z.mockupRef)) continue;            // skip wide-mockup overlap cases
    const { layout, placement } = synthesizeFromGrammar(spec, content(spec, arch));
    const slide = solveDeckSlide(layout, placement, spec, { w: spec.canvas.w, h: spec.canvas.h });
    const deco = chooseDecoration(spec, slide, arch, sk.support % 5);
    const svg = renderComposite(slide, deco.svg);
    const out = `${outDir}/${theme}_${arch}.png`;
    writeFileSync(out, rasterize(svg, 1280));
    made.push(out);
  }
}
console.log(made.join("\n"));
console.log(`\n${made.length} slides → ${outDir}`);
