import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Build a reusable library of each theme's REAL background decoration — generalised
// across decoration vocabularies: colorful = organic <g Decorative> paths, green =
// solid colour-block rects, black = bands. We keep solid, non-content visual shapes
// and EXCLUDE the background rect, image holders (pattern fills) and divider lines.
const THEMES = ["colorful", "black", "green"];
const NEUTRAL = new Set(["white", "#ffffff", "#fff", "#f3f3f3", "black", "#000000", "#000", "none"]);

function extractDeco(svg, bgToken) {
  let inner = svg.replace(/<\?xml[\s\S]*?\?>/, "").replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<defs[\s\S]*?<\/defs>/g, "");
  inner = inner.replace(/<g id="Frame"[^>]*>/, "").replace(/<\/g>\s*$/, "");
  const els = inner.match(/<g id="Decorative"[\s\S]*?<\/g>|<(?:rect|path|circle|ellipse|line)\b[^>]*?\/?>/g) ?? [];
  let bg, bgSeen = false;
  const keep = [];
  for (const el of els) {
    const full = /^<rect/.test(el) && /width="1920"/.test(el) && /height="1080"/.test(el);
    if (full && !bgSeen) {
      bgSeen = true;
      const f = (/fill="([^"]+)"/.exec(el)?.[1] ?? "").toLowerCase();
      if (f && !NEUTRAL.has(f) && f !== (bgToken ?? "").toLowerCase()) bg = f; // full-colour background variant
      continue;
    }
    if (/^<line/.test(el)) continue;        // divider, not decoration
    if (/fill="url\(/.test(el)) continue;   // pattern fill = image holder (content)
    keep.push(el);
  }
  return { frag: keep.join(""), bg };
}

function colorsOf(frag) {
  return [...new Set([...frag.matchAll(/fill="(#[0-9a-fA-F]{3,6})"/g)].map((x) => x[1]))];
}
/** True extent from path/circle/ellipse/rect coords (incl. translate) — generalised. */
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
  for (const m of frag.matchAll(/<rect[^>]*>/g)) {
    const x = +(/\sx="(-?[\d.]+)"/.exec(m[0])?.[1] ?? 0), y = +(/\sy="(-?[\d.]+)"/.exec(m[0])?.[1] ?? 0);
    const wd = +(/width="(-?[\d.]+)"/.exec(m[0])?.[1] ?? 0), hd = +(/height="(-?[\d.]+)"/.exec(m[0])?.[1] ?? 0);
    const tr = /transform="translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)"/.exec(m[0]);
    const tx = tr ? +tr[1] : 0, ty = tr ? +tr[2] : 0;
    ext(x + tx, y + ty); ext(x + tx + wd, y + ty + hd);
  }
  if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return null;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

for (const theme of THEMES) {
  const base = `fixtures/assets/${theme}`;
  if (!existsSync(`${base}/system.json`) || !existsSync(`${base}/decorations`)) continue;
  const sys = JSON.parse(readFileSync(`${base}/system.json`, "utf8"));
  const bgToken = sys.tokens?.colors?.bg;
  const byId = new Map(sys.layouts.map((l) => [l.id, l]));
  const lib = [];
  for (const f of readdirSync(`${base}/decorations`).filter((f) => f.endsWith(".svg"))) {
    const id = f.replace(/\.svg$/, "");
    const { frag, bg } = extractDeco(readFileSync(resolve(base, "decorations", f), "utf8"), bgToken);
    if (!frag.trim()) continue; // no shape decoration (full-colour-bg-only deferred)
    const bbox = fragBBox(frag);
    if (!bbox) continue;
    const layout = byId.get(id);
    lib.push({ id, frag, bbox, colors: colorsOf(frag), ...(bg ? { bg } : {}), ...(layout?.archetype ? { archetype: layout.archetype } : {}) });
  }
  for (const out of [base, `apps/web/assets/${theme}`]) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/decorations-lib.json`, JSON.stringify(lib));
  }
  console.log(`${theme}: ${lib.length} decoration shapes`);
}
