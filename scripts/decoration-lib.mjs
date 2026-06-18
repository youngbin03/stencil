import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Build a reusable library of the theme's REAL organic decoration shapes (the
// `<g id="Decorative">` paths) so synthesis can place them instead of generated
// circles. One entry per decorated slide: { id, frag, bbox(ink), colors, archetype }.
const THEMES = ["colorful", "black", "green"];

function decorativeFrag(svg) {
  const m = svg.match(/<g id="Decorative"[^>]*>([\s\S]*?)<\/g>/);
  if (!m) return null;
  const frag = m[1].trim();
  if (!/<(path|circle|ellipse|polygon)\b/.test(frag)) return null; // organic shapes only
  return frag;
}
function colorsOf(frag) {
  return [...new Set([...frag.matchAll(/fill="(#[0-9a-fA-F]{3,6})"/g)].map((x) => x[1]))];
}
function inkBBox(layout, canvas) {
  const els = (layout?.decorationModel?.elements ?? []).filter((e) => e.kind !== "background");
  if (!els.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { x0 = Math.min(x0, e.bbox.x); y0 = Math.min(y0, e.bbox.y); x1 = Math.max(x1, e.bbox.x + e.bbox.w); y1 = Math.max(y1, e.bbox.y + e.bbox.h); }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(canvas.w, x1); y1 = Math.min(canvas.h, y1);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

for (const theme of THEMES) {
  const base = `fixtures/assets/${theme}`;
  if (!existsSync(`${base}/system.json`) || !existsSync(`${base}/decorations`)) continue;
  const sys = JSON.parse(readFileSync(`${base}/system.json`, "utf8"));
  const byId = new Map(sys.layouts.map((l) => [l.id, l]));
  const lib = [];
  for (const f of readdirSync(`${base}/decorations`).filter((f) => f.endsWith(".svg"))) {
    const id = f.replace(/\.svg$/, "");
    const frag = decorativeFrag(readFileSync(resolve(base, "decorations", f), "utf8"));
    if (!frag) continue;
    const layout = byId.get(id);
    const bbox = inkBBox(layout, sys.canvas);
    if (!bbox) continue;
    lib.push({ id, frag, bbox, colors: colorsOf(frag), ...(layout?.archetype ? { archetype: layout.archetype } : {}) });
  }
  for (const out of [base, `apps/web/assets/${theme}`]) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/decorations-lib.json`, JSON.stringify(lib));
  }
  console.log(`${theme}: ${lib.length} decoration shapes → decorations-lib.json`);
}
