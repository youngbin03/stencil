import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { extractThemeSystem } from "../packages/extractor/dist/extract.js";
import { classifySlide } from "../packages/classifier/dist/index.js";

// Load .env.local (ANTHROPIC_API_KEY) for vision classification.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

// Assetize a theme WITH mockup assets persisted (the CLI omits mockups).
// Usage: node scripts/bake-mockup.mjs templates/blackdesign
const THEME_BY_DIR = { colorfulldesign: "colorful", blackdesign: "black", greendesign: "green" };
const abs = resolve(process.argv[2] ?? "templates/blackdesign");
const theme = THEME_BY_DIR[basename(abs)] ?? "colorful";
const files = readdirSync(abs).filter((f) => f.toLowerCase().endsWith(".svg")).sort();
const slides = files.map((f) => ({ name: f.replace(/\.svg$/i, ""), svg: readFileSync(resolve(abs, f), "utf8") }));

const outDir = resolve("fixtures/assets", theme);
const decoDir = resolve(outDir, "decorations");
const mockupDir = resolve(outDir, "mockups");
mkdirSync(decoDir, { recursive: true });
mkdirSync(mockupDir, { recursive: true });

const useVision = !process.argv.includes("--no-classify") && Boolean(process.env.ANTHROPIC_API_KEY);
console.log(useVision ? "classification: Claude vision" : "classification: id-rules only");
const { system, decorations, mockups } = await extractThemeSystem(slides, {
  theme,
  decorationRef: (id) => `fixtures/assets/${theme}/decorations/${id}.svg`,
  ...(useVision ? { classify: (svg, slots) => classifySlide(svg, slots) } : {}),
});

writeFileSync(resolve(outDir, "system.json"), JSON.stringify(system, null, 2), "utf8");
for (const d of decorations) writeFileSync(resolve(decoDir, `${d.layoutId}.svg`), d.svg, "utf8");
for (const m of mockups) writeFileSync(resolve(mockupDir, `${m.id}.json`), JSON.stringify(m.asset), "utf8");

const mockRefs = system.layouts.filter((l) => l.mockupRef);
const clips = system.layouts.flatMap((l) => l.slots).filter((s) => s.clip);
console.log(`theme=${theme} slides=${slides.length} layouts=${system.layouts.length}`);
console.log(`mockups(deduped assets)=${mockups.length} → ${mockupDir}`);
console.log(`layouts with mockupRef=${mockRefs.length}:`, mockRefs.map((l) => `${l.id}->${l.mockupRef}`).join(", "));
console.log(`screen(clip) slots=${clips.length}`);
console.log("mockup ids:", mockups.map((m) => `${m.id}(frame ${Math.round(m.asset.frameBBox.w)}x${Math.round(m.asset.frameBBox.h)})`).join(", "));
