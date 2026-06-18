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
/** True extent of the shape from its path/circle/ellipse coords (NOT the canvas-
 *  clamped model bbox) so it can be transformed into place without misalignment. */
function fragBBox(frag) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
  for (const m of frag.matchAll(/\sd="([^"]+)"/g)) {
    const nums = (m[1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) ext(nums[i], nums[i + 1]);
  }
  for (const m of frag.matchAll(/<circle[^>]*>/g)) {
    const cx = +(/cx="(-?[\d.]+)"/.exec(m[0])?.[1] ?? NaN), cy = +(/cy="(-?[\d.]+)"/.exec(m[0])?.[1] ?? NaN), r = +(/\br="(-?[\d.]+)"/.exec(m[0])?.[1] ?? 0);
    ext(cx - r, cy - r); ext(cx + r, cy + r);
  }
  for (const m of frag.matchAll(/<ellipse[^>]*>/g)) {
    const cx = +(/cx="(-?[\d.]+)"/.exec(m[0])?.[1] ?? NaN), cy = +(/cy="(-?[\d.]+)"/.exec(m[0])?.[1] ?? NaN), rx = +(/rx="(-?[\d.]+)"/.exec(m[0])?.[1] ?? 0), ry = +(/ry="(-?[\d.]+)"/.exec(m[0])?.[1] ?? 0);
    ext(cx - rx, cy - ry); ext(cx + rx, cy + ry);
  }
  if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return null;
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
    const bbox = fragBBox(frag);
    if (!bbox) continue;
    lib.push({ id, frag, bbox, colors: colorsOf(frag), ...(layout?.archetype ? { archetype: layout.archetype } : {}) });
  }
  for (const out of [base, `apps/web/assets/${theme}`]) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/decorations-lib.json`, JSON.stringify(lib));
  }
  console.log(`${theme}: ${lib.length} decoration shapes → decorations-lib.json`);
}
