import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { buildGrammarSpec } from "../packages/synthesizer/dist/grammar.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

// Design-system AUGMENTATION (no prompt): generate NEW slides for a theme by pairing
// each slide's FAITHFUL decoration (native size/position/colour) with a DIFFERENT
// content structure placed into the decoration's measured OPEN REGION. New slides
// follow the theme grammar (real decoration + type scale + rhythm + colour scheme)
// and are filtered to not duplicate the existing set (decoration × structure).
const theme = process.argv[2] ?? "colorful";
const sys = JSON.parse(readFileSync(`fixtures/assets/${theme}/system.json`, "utf8"));
const spec = buildGrammarSpec(sys);
const { w: W, h: H } = sys.canvas;
const SAFE = Math.round(W * 0.05);
const text = (sys.tokens.colors.text || "#000000");
const accent = (spec.palette || []).find((c) => /^#/.test(c) && ![sys.tokens.colors.bg, "#ffffff", "#f3f3f3", text, "#000000"].includes(c.toLowerCase())) || "#5FA0FB";
const fam = (r) => spec.type[r]?.family || spec.fontFamily || "Inter";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// --- clean decoration: drop bg rect, image holders (pattern), lines & thin line-paths ---
function decoOf(id) {
  const p = `fixtures/assets/${theme}/decorations/${id}.svg`;
  if (!existsSync(p)) return { frag: "", bg: null };
  let s = readFileSync(p, "utf8").replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<defs[\s\S]*?<\/defs>/g, "");
  s = s.replace(/<g id="Frame"[^>]*>/, "").replace(/<\/g>\s*$/, "");
  const els = s.match(/<g id="Decorative"[\s\S]*?<\/g>|<(?:rect|path|circle|ellipse|line)\b[^>]*?\/?>/g) ?? [];
  let bg = null, bgSeen = false; const keep = [];
  for (const el of els) {
    const full = /^<rect/.test(el) && /width="1920"/.test(el) && /height="1080"/.test(el);
    if (full && !bgSeen) { bgSeen = true; const f = (/fill="([^"]+)"/.exec(el)?.[1] || "").toLowerCase(); if (f && !["white", "#ffffff", "#fff", "#f3f3f3", "black", "#000000", "none"].includes(f) && f !== (sys.tokens.colors.bg || "").toLowerCase()) bg = f; continue; }
    if (/^<line/.test(el) || /fill="url\(/.test(el)) continue;          // divider / image holder
    if (/^<path/.test(el) && / d="[^"]*"/.test(el)) {                   // drop hairline-paths (e.g. Decorative_2)
      const ns = (/ d="([^"]+)"/.exec(el)[1].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i + 1 < ns.length; i += 2) { x0 = Math.min(x0, ns[i]); x1 = Math.max(x1, ns[i]); y0 = Math.min(y0, ns[i + 1]); y1 = Math.max(y1, ns[i + 1]); }
      if (y1 - y0 < 6 || x1 - x0 < 6) continue;
    }
    keep.push(el);
  }
  return { frag: keep.join(""), bg };
}

// --- open region via OCCUPANCY GRID + LARGEST EMPTY RECTANGLE ---
// Rasterize the decoration shapes (transparent bg) to a low-res grid, mark any inked
// cell (incl. thin lines/dots/curves — what bbox misses) + a SAFE border as occupied,
// dilate slightly for padding, then find the biggest all-empty axis-aligned rectangle.
// Deterministic, shape-accurate, no per-decoration tuning. Returns null if too small.
const GW = 192, PAD = 2;
function largestEmptyRect(occ, gw, gh) {
  const heights = new Array(gw).fill(0);
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) heights[c] = occ[r * gw + c] ? 0 : heights[c] + 1;
    const stack = [];
    for (let c = 0; c <= gw; c++) {
      const hc = c < gw ? heights[c] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= hc) {
        const h = heights[stack.pop()];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const area = h * (c - left);
        if (area > best.area) best = { area, x: left, y: r - h + 1, w: c - left, h };
      }
      stack.push(c);
    }
  }
  return best;
}
function openRegion(frag) {
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><g>${frag}</g></svg>`;
  const img = new Resvg(svg, { fitTo: { mode: "width", value: GW } }).render();
  const gw = img.width, gh = img.height, px = img.pixels;
  const occ = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) if (px[i * 4 + 3] > 20) occ[i] = 1;        // inked
  const dil = occ.slice();
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (occ[y * gw + x]) {
    for (let dy = -PAD; dy <= PAD; dy++) for (let dx = -PAD; dx <= PAD; dx++) {
      const ny = y + dy, nx = x + dx; if (ny >= 0 && ny < gh && nx >= 0 && nx < gw) dil[ny * gw + nx] = 1;
    }
  }
  const mc = Math.round((SAFE / W) * gw);                                       // SAFE margin → occupied border
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (x < mc || x >= gw - mc || y < mc || y >= gh - mc) dil[y * gw + x] = 1;
  const b = largestEmptyRect(dil, gw, gh);
  if (b.area < gw * gh * 0.06) return null;
  const cw = W / gw, ch = H / gh;
  return { x: Math.round(b.x * cw), y: Math.round(b.y * ch), w: Math.round(b.w * cw), h: Math.round(b.h * ch) };
}

// --- content structures (placeholder, consistent voice) placed INTO the region ---
function txt(x, y, role, s, fill) {
  return `<text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${fam(role)}" font-size="${spec.type[role]?.size ?? 40}" font-weight="${spec.type[role]?.weight ?? 400}" fill="${fill}" style="white-space:pre">${esc(s)}</text>`;
}
const STRUCTURES = {
  title: { fits: (r) => r.h > H * 0.25 && r.w > W * 0.55, render: (r, fill, acc, d) => { const cy = r.y + r.h * 0.42; return txt(r.x, cy, "eyebrow", d.eyebrow, fill) + txt(r.x, cy + (spec.type.title?.size ?? 120) * 0.9, "title", d.title, fill); } },
  list: {
    fits: (r) => r.h > H * 0.45 && r.w > W * 0.45,
    render: (r, fill, acc, d) => {
      const items = d.items; const gap = Math.min(r.h / (items.length + 1), 150); let y = r.y + gap * 0.9; let out = txt(r.x, r.y + 40, "eyebrow", d.header, fill);
      items.forEach((t, idx) => { y += gap; out += txt(r.x, y, "headline", `0${idx + 1}`, fill) + txt(r.x + 260, y, "subtitle", t, fill) + `<line x1="${r.x}" y1="${Math.round(y + 24)}" x2="${Math.round(r.x + r.w)}" y2="${Math.round(y + 24)}" stroke="${acc}" stroke-width="3"/>`; });
      return out;
    },
  },
  kpi: {
    fits: (r) => r.w > W * 0.6 && r.h > H * 0.25,
    render: (r, fill, acc, d) => {
      const cw = r.w / 3, cy = r.y + r.h * 0.5; let out = "";
      d.k.forEach((v, idx) => { const x = r.x + idx * cw; out += txt(x, cy, "kpi", v, fill) + txt(x, cy + 56, "caption", d.cap[idx], fill); });
      return out;
    },
  },
  quote: { fits: (r) => r.h > H * 0.3 && r.w > W * 0.5, render: (r, fill, acc, d) => { const cy = r.y + r.h * 0.42, qs = spec.type.quote?.size ?? 120; let out = ""; d.q.forEach((line, i) => { out += txt(r.x, cy + i * qs, "quote", line, fill); }); return out + txt(r.x, cy + d.q.length * qs + 30, "caption", d.cap, fill); } },
};

// Content pools — consistent voice (neutral product/design), parallel structure,
// fixed info amount per role. Each generated slide gets a DIFFERENT set.
const POOL = {
  title: [
    { eyebrow: "Overview", title: "Designing with intent" },
    { eyebrow: "Vision", title: "Built for clarity" },
    { eyebrow: "Principle", title: "Less, but better" },
    { eyebrow: "Approach", title: "Start with the user" },
  ],
  list: [
    { header: "In this section", items: ["Start from the problem", "Shape the core idea", "Ship and learn"] },
    { header: "How we work", items: ["Listen to users", "Prototype fast", "Measure what matters"] },
    { header: "Our priorities", items: ["Reduce friction", "Earn trust", "Compound value"] },
  ],
  kpi: [
    { k: ["38%", "2.4×", "+12"], cap: ["Adoption lift", "Faster delivery", "Retention gain"] },
    { k: ["94%", "3.1M", "-40%"], cap: ["Satisfaction", "Active users", "Response time"] },
    { k: ["2×", "+18", "99.9%"], cap: ["Throughput", "NPS gain", "Uptime"] },
  ],
  quote: [
    { q: ["Simplicity is the", "keystone of design."], cap: "— Design Principle" },
    { q: ["Clarity beats", "cleverness."], cap: "— Team Value" },
    { q: ["Make the right thing", "the easy thing."], cap: "— Product Maxim" },
  ],
};

function isDark(hex) { const h = (hex || "").replace("#", ""); if (h.length !== 6) return false; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.62; }
function domColor(frag) { const m = frag.match(/fill="(#[0-9a-fA-F]{3,6})"/); return m ? m[1] : accent; }

const N = Number(process.argv[3]) || 10;
const structNames = Object.keys(STRUCTURES);
// 1) enumerate valid candidates (decoration × structure, fit + clear region)
const cands = [];
for (const L of sys.layouts) {
  const { frag, bg } = decoOf(L.id);
  if (!frag.trim()) continue;
  const region = openRegion(frag);
  if (!region) continue;
  // colour: full-colour bg → everything white; light bg → text=theme, accents harmonise with the decoration's own colour
  const fill = bg ? (isDark(bg) ? "#FFFFFF" : text) : text;
  const acc = bg ? (isDark(bg) ? "#FFFFFF" : text) : domColor(frag);
  const bgFill = bg || sys.tokens.colors.bg;
  for (const sName of structNames) {
    if (sName === L.archetype) continue;
    if (!STRUCTURES[sName].fits(region)) continue;
    cands.push({ id: L.id, sName, frag, bg, bgFill, region, fill, acc, area: region.w * region.h });
  }
}
// 2) select ~N diverse: roomiest first, one per decoration, balanced across structures
cands.sort((a, b) => b.area - a.area);
const picked = []; const usedDeco = new Set(); const sc = {}; const capPer = Math.ceil(N / structNames.length);
for (const c of cands) { if (picked.length >= N) break; if (usedDeco.has(c.id) || (sc[c.sName] || 0) >= capPer) continue; picked.push(c); usedDeco.add(c.id); sc[c.sName] = (sc[c.sName] || 0) + 1; }
for (const c of cands) { if (picked.length >= N) break; if (!picked.includes(c)) picked.push(c); }
// 3) assign a DISTINCT content set per structure
const pi = {};
for (const c of picked) { const arr = POOL[c.sName]; const i = pi[c.sName] || 0; c.data = arr[i % arr.length]; pi[c.sName] = i + 1; }

// 4) render
mkdirSync(`fixtures/out/augment`, { recursive: true });
const made = [];
for (const c of picked) {
  const deco = c.bg ? c.frag.replace(/fill="#[0-9a-fA-F]{3,6}"/g, 'fill="#FFFFFF"') : c.frag;
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${c.bgFill}"/>${deco}${STRUCTURES[c.sName].render(c.region, c.fill, c.acc, c.data)}</svg>`;
  const name = `${c.id}__${c.sName}`;
  writeFileSync(`fixtures/out/augment/${name}.png`, rasterize(svg, 1100));
  made.push({ name, deco: c.id, struct: c.sName, full: !!c.bg });
}
const cards = made.map((m) => `<figure><img src="${m.name}.png"><figcaption><b>${m.struct}</b> on <code>${m.deco}</code>${m.full ? " · full-colour" : ""}</figcaption></figure>`).join("");
writeFileSync(`fixtures/out/augment/index.html`, `<!doctype html><meta charset=utf8><title>${theme} augmented</title><style>body{font-family:Inter,system-ui;background:#0a0a0a;color:#eee;margin:0;padding:28px}h1{font-weight:600}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}figure{margin:0;background:#161616;border-radius:12px;overflow:hidden}img{width:100%;display:block;border-bottom:1px solid #222}figcaption{padding:10px 14px;font-size:13px;color:#bbb}code{color:#8ab4ff}</style><h1>${theme} — augmented (+${made.length} new slides)</h1><p style="color:#888">Faithful decoration × a different content structure (distinct content each), placed in the decoration's largest open rectangle. Distinct from the original set.</p><div class=g>${cards}</div>`);
console.log(`${theme}: +${made.length} new slides (from ${cands.length} candidates) → fixtures/out/augment/index.html`);
console.log(made.map((m) => `  ${m.struct} on ${m.deco}${m.full ? " (full-colour)" : ""}`).join("\n"));
