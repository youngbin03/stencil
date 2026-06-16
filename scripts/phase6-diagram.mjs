// Render the Phase 6 core-logic pipeline as a PNG diagram.
//   node scripts/phase6-diagram.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { rasterize } from "../packages/classifier/dist/index.js";

const W = 1600, H = 980;
const ink = "#191f28", muted = "#6b7684", line = "#c9cfd6";
const accent = "#3182f6", green = "#12b886", purple = "#7048e8", bg = "#f7f8fa", panel = "#ffffff";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const parts = [];
const rect = (x, y, w, h, fill, stroke = line, rx = 14) =>
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
const text = (x, y, s, size, fill = ink, weight = 400, anchor = "start") =>
  parts.push(`<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`);
const arrow = (x1, y1, x2, y2, color = accent) =>
  parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5" marker-end="url(#a)"/>`);

// title
text(56, 64, "Stencil — design-grammar layout synthesis", 32, ink, 700);
text(56, 96, "Input slides are design EXAMPLES, not templates to fill. New layouts are synthesized from the extracted grammar.", 17, muted);

// --- BAKE row (extract grammar from examples) ---
const by = 150, bh = 116, bw = 300, gapx = 36;
const bakeX = 56;
text(bakeX, by - 14, "BAKE  ·  once per theme", 15, accent, 700);
const bake = [
  ["1 · Template parsing", "slides → measured slots\n(text / image, bbox, font)"],
  ["2 · Grammar extraction", "palette · type scale · grid\nrhythm · hierarchy · relations"],
  ["3 · Archetype skeletons", "per archetype: normalized\nzones (median of examples)"],
];
bake.forEach((b, i) => {
  const x = bakeX + i * (bw + gapx);
  rect(x, by, bw, bh, panel, i === 2 ? green : line);
  text(x + 18, by + 34, b[0], 18, ink, 700);
  b[1].split("\n").forEach((ln, k) => text(x + 18, by + 62 + k * 24, ln, 15, muted));
  if (i < 2) arrow(x + bw + 6, by + bh / 2, x + bw + gapx - 6, by + bh / 2);
});
// grammar spec artifact
const specX = bakeX + 2 * (bw + gapx) + bw + 40;
rect(specX, by, 200, bh, "#eaf3ff", accent);
text(specX + 100, by + 42, "GrammarSpec", 18, accent, 700, "middle");
text(specX + 100, by + 70, "(blocks, cardSpecs,", 13, muted, 400, "middle");
text(specX + 100, by + 90, "skeletons, tokens)", 13, muted, 400, "middle");
arrow(bakeX + 2 * (bw + gapx) + bw + 6, by + bh / 2, specX - 6, by + bh / 2, green);

// --- STAMP row (synthesize per request) ---
const sy = 380, sh = 120, sw = 286;
text(bakeX, sy - 14, "STAMP  ·  per user request", 15, purple, 700);
const stamp = [
  ["4 · Content planning", "prompt → archetype\nsequence + content blocks", "Claude"],
  ["5 · Layout synthesis", "skeleton + grammar →\nNEW coords (no frame copy)", "grammar only"],
  ["6 · Constraint solve", "fit · push-down · safeArea\noverlap / margin check", "deterministic"],
  ["7 · Quality eval", "7 scores 0–10\nrevise<7 · reject novelty<6", "gate"],
];
stamp.forEach((b, i) => {
  const x = bakeX + i * (sw + gapx);
  rect(x, sy, sw, sh, panel, i === 3 ? purple : line);
  text(x + 18, sy + 32, b[0], 17, ink, 700);
  b[1].split("\n").forEach((ln, k) => text(x + 18, sy + 58 + k * 22, ln, 14, muted));
  text(x + 18, sy + sh - 14, b[2], 12, i === 3 ? purple : accent, 700);
  if (i < 3) arrow(x + sw + 6, sy + sh / 2, x + sw + gapx - 6, sy + sh / 2, purple);
});

// inputs into stamp
text(bakeX, sy + sh + 70, "user prompt", 14, muted, 700);
arrow(bakeX + 90, sy + sh + 64, bakeX + 120, sy + sh + 6, muted);
text(bakeX + 300, sy + sh + 70, "user images (optional, placed not generated)", 14, muted, 700);
arrow(bakeX + 360, sy + sh + 64, bakeX + sw + gapx + 100, sy + sh + 6, muted);

// GrammarSpec feeds synthesis (5)
arrow(specX + 100, by + bh + 6, bakeX + (sw + gapx) + sw / 2, sy - 6, green);

// revise loop (7 -> 5)
const lx0 = bakeX + 3 * (sw + gapx) + sw / 2, ly = sy + sh + 30;
parts.push(`<path d="M ${lx0} ${sy + sh + 6} L ${lx0} ${ly} L ${bakeX + (sw + gapx) + sw / 2} ${ly} L ${bakeX + (sw + gapx) + sw / 2} ${sy + sh + 6}" fill="none" stroke="${purple}" stroke-width="2.5" stroke-dasharray="7 6" marker-end="url(#a)"/>`);
text((lx0 + bakeX + (sw + gapx) + sw / 2) / 2, ly + 22, "revise / reject → re-synthesize (N≤2)", 14, purple, 700, "middle");

// --- OUTPUT ---
const oy = 640;
rect(bakeX, oy, sw, 92, "#eafaf1", green);
text(bakeX + sw / 2, oy + 40, "Composite SVG", 18, green, 700, "middle");
text(bakeX + sw / 2, oy + 68, "decoration + text + image", 14, muted, 400, "middle");
arrow(bakeX + sw + gapx - 36, sy + sh + 100, bakeX + sw / 2, oy - 6, green);

// principles box
const px = bakeX + sw + gapx + 40, pw = W - px - 56;
rect(px, oy, pw, 92, panel, line);
text(px + 20, oy + 30, "Invariants", 16, ink, 700);
text(px + 20, oy + 56, "• never copy a source frame  • LLM writes content + picks archetype, never coordinates", 14, muted);
text(px + 20, oy + 78, "• coordinates from grammar (grid · rhythm · hierarchy · measured card internals)  • deterministic, no randomness", 14, muted);

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="a" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#6b7684"/></marker></defs>
<rect width="${W}" height="${H}" fill="${bg}"/>${parts.join("")}</svg>`;

mkdirSync(resolve("fixtures/out"), { recursive: true });
writeFileSync(resolve("fixtures/out/phase6-architecture.png"), rasterize(svg, W));
console.log("wrote fixtures/out/phase6-architecture.png");
