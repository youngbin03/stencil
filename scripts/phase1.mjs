// Phase 1 PoC: normalize -> solve (fixed-slot) -> render (inplace) one slide.
// Run after building packages:  node scripts/phase1.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSvg } from "../packages/normalizer/dist/index.js";
import { solveFixedSlots } from "../packages/solver/dist/index.js";
import { renderInplace } from "../packages/renderer/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = "templates/colorfulldesign/Frame-0.svg";
const baseSvg = readFileSync(resolve(root, inputPath), "utf8");

const manifest = normalizeSvg(baseSvg, {
  layoutId: "colorful_Frame-0",
  theme: "colorful",
  baseTemplate: inputPath,
});

// Hand-authored content keyed by slot id (stands in for the M3 composition IR).
const content = {
  Caption: "STENCIL",
  Caption_2: "2026",
  Body: "AI-generated slides that keep\nyour template's exact design.",
  "Presentation title": "DESIGN\nSYSTEM\nENGINE",
};

const slide = solveFixedSlots(manifest, content);
const outSvg = renderInplace(slide, baseSvg);

const outPath = resolve(root, "fixtures/out/colorful_Frame-0.svg");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, outSvg, "utf8");

console.log("solver warnings:", slide.warnings.length ? slide.warnings : "(none)");
console.log("rendered elements:", slide.elements.map((e) => `${e.id}(${e.role})`).join(", "));
console.log("written:", outPath);
