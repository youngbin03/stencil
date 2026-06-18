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
function txt(x, y, role, s, fill, maxW) {
  let size = spec.type[role]?.size ?? 40;
  if (maxW) { const est = s.length * size * 0.56; if (est > maxW) size = Math.max(14, Math.floor(maxW / (s.length * 0.56))); }
  return `<text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${fam(role)}" font-size="${size}" font-weight="${spec.type[role]?.weight ?? 400}" fill="${fill}" style="white-space:pre">${esc(s)}</text>`;
}
const STRUCTURES = {
  title: { fits: (r) => r.h > H * 0.3 && r.w > W * 0.55, foot: () => (spec.type.title?.size ?? 120) * 1.2 + (spec.type.eyebrow?.size ?? 28) * 1.6 + (spec.type.body?.size ?? 28) * 2, render: (r, fill, acc, d) => { const ts = spec.type.title?.size ?? 120, cy = r.y + r.h * 0.34; let o = txt(r.x, cy, "eyebrow", d.eyebrow, fill, r.w) + txt(r.x, cy + ts * 0.9, "title", d.title, fill, r.w); if (d.body) o += txt(r.x, cy + ts * 0.9 + 78, "body", d.body, fill, r.w * 0.82); return o; } },
  list: {
    fits: (r) => r.h > H * 0.45 && r.w > W * 0.45,
    foot: (r) => 3 * Math.min(r.h / 3.4, 180) + 70,
    render: (r, fill, acc, d) => {
      const items = d.items; const gap = Math.min(r.h / (items.length + 0.4), 180); let y = r.y + gap * 0.6; let out = txt(r.x, r.y + 34, "eyebrow", d.header, fill);
      items.forEach((it, idx) => { y += gap; out += txt(r.x, y, "headline", `0${idx + 1}`, fill) + txt(r.x + 240, y, "headline", it.label, fill, r.w - 540) + txt(r.x + 240, y + 42, "body", it.desc, fill, r.w - 260) + `<line x1="${r.x}" y1="${Math.round(y + 64)}" x2="${Math.round(r.x + r.w)}" y2="${Math.round(y + 64)}" stroke="${acc}" stroke-width="2"/>`; });
      return out;
    },
  },
  kpi: {
    fits: (r) => r.w > W * 0.6 && r.h > H * 0.38,
    foot: () => (spec.type.headline?.size ?? 80) * 1.3 + (spec.type.kpi?.size ?? 120) + (spec.type.caption?.size ?? 28) * 2,
    render: (r, fill, acc, d) => {
      let out = txt(r.x, r.y + (spec.type.headline?.size ?? 80) * 0.82, "headline", d.title, fill, r.w);
      const cw = r.w / 3, cy = r.y + r.h * 0.68; d.k.forEach((v, idx) => { const x = r.x + idx * cw; out += txt(x, cy, "kpi", v, fill, cw - 24) + txt(x, cy + 56, "caption", d.cap[idx], fill, cw - 24); });
      return out;
    },
  },
  quote: { fits: (r) => r.h > H * 0.3 && r.w > W * 0.5, foot: () => 2 * (spec.type.quote?.size ?? 120) + 70, render: (r, fill, acc, d) => { const cy = r.y + r.h * 0.42, qs = spec.type.quote?.size ?? 120; let out = ""; d.q.forEach((line, i) => { out += txt(r.x, cy + i * qs, "quote", line, fill, r.w); }); return out + txt(r.x, cy + d.q.length * qs + 30, "caption", d.cap, fill, r.w); } },
  // one bold statement (2 short lines) + a small kicker
  statement: { fits: (r) => r.w > W * 0.5 && r.h > H * 0.3, foot: () => (spec.type.headline?.size ?? 80) * 2.3 + (spec.type.eyebrow?.size ?? 28) * 1.5 + (spec.type.body?.size ?? 28) * 2, render: (r, fill, acc, d) => { const hs = spec.type.headline?.size ?? 80, cy = r.y + r.h * 0.34; let out = txt(r.x, cy, "eyebrow", d.eyebrow, fill, r.w); d.lines.forEach((l, i) => { out += txt(r.x, cy + (i + 1) * hs * 1.05, "headline", l, fill, r.w); }); if (d.body) out += txt(r.x, cy + (d.lines.length + 1) * hs * 1.05 + 30, "body", d.body, fill, r.w * 0.82); return out; } },
  // a single focal metric + a supporting line
  bignum: { fits: (r) => r.w > W * 0.3 && r.h > H * 0.3, foot: () => (spec.type.kpi?.size ?? 120) + (spec.type.caption?.size ?? 28) + (spec.type.body?.size ?? 28) * 2, render: (r, fill, acc, d) => { const cy = r.y + r.h * 0.45; let out = txt(r.x, cy, "kpi", d.n, fill, r.w) + txt(r.x, cy + 56, "caption", d.cap, fill, r.w); if (d.body) out += txt(r.x, cy + 56 + 60, "body", d.body, fill, Math.min(r.w, W * 0.42)); return out; } },
  // horizontal numbered steps (vs the vertical list)
  steps: { fits: (r) => r.w > W * 0.6 && r.h > H * 0.25, foot: () => (spec.type.headline?.size ?? 80) + (spec.type.label?.size ?? 28) + (spec.type.body?.size ?? 28) * 2.4, render: (r, fill, acc, d) => { const cw = r.w / d.steps.length, cy = r.y + r.h * 0.4, gapL = (spec.type.headline?.size ?? 80) * 0.8; let out = ""; d.steps.forEach((s, i) => { const x = r.x + i * cw; out += txt(x, cy, "headline", s[0], fill, cw - 24) + txt(x, cy + gapL, "label", s[1], fill, cw - 24); if (s[2]) out += txt(x, cy + gapL + 40, "body", s[2], fill, cw - 24); }); return out; } },
  // two side-by-side blocks (label + short body) — before/after, problem/solution
  twocol: { fits: (r) => r.w > W * 0.6 && r.h > H * 0.3, foot: () => (spec.type.label?.size ?? 28) * 1.8 + (spec.type.body?.size ?? 28) * 2.6, render: (r, fill, acc, d) => { const cw = r.w / 2, cy = r.y + r.h * 0.42; let out = ""; d.cols.forEach((c, i) => { const x = r.x + i * cw; out += txt(x, cy, "label", c.label, fill, cw - 30); c.body.forEach((b, j) => { out += txt(x, cy + 50 + j * 36, "body", b, fill, cw - 30); }); }); return out; } },
};

// Content pools — consistent voice (neutral product/design), parallel structure,
// fixed info amount per role. Each generated slide gets a DIFFERENT set.
const POOL = {
  title: [
    { eyebrow: "Overview", title: "Designing with intent", body: "A short, confident promise that frames the rest of the deck." },
    { eyebrow: "Vision", title: "Built for clarity", body: "Where we're headed and why it matters to the people we serve." },
    { eyebrow: "Principle", title: "Less, but better", body: "The fewer moving parts, the easier it is to trust the result." },
    { eyebrow: "Approach", title: "Start with the user", body: "Every decision traces back to a real problem worth solving." },
  ],
  list: [
    { header: "In this section", items: [{ label: "Start from the problem", desc: "Name the real pain before reaching for a solution." }, { label: "Shape the core idea", desc: "Find the smallest thing that proves the value." }, { label: "Ship and learn", desc: "Release early, then let evidence guide the next step." }] },
    { header: "How we work", items: [{ label: "Listen to users", desc: "Signals from real usage outrank internal opinions." }, { label: "Prototype fast", desc: "Make it tangible in days, not quarters." }, { label: "Measure what matters", desc: "A few honest metrics beat a wall of dashboards." }] },
    { header: "Our priorities", items: [{ label: "Reduce friction", desc: "Remove steps until only the essential remain." }, { label: "Earn trust", desc: "Be predictable, fast, and quietly reliable." }, { label: "Compound value", desc: "Small wins that stack into a durable advantage." }] },
  ],
  kpi: [
    { title: "Results we can measure", k: ["38%", "2.4×", "+12"], cap: ["Adoption lift", "Faster delivery", "Retention gain"] },
    { title: "The quarter in numbers", k: ["94%", "3.1M", "-40%"], cap: ["Satisfaction", "Active users", "Response time"] },
    { title: "Performance at a glance", k: ["2×", "+18", "99.9%"], cap: ["Throughput", "NPS gain", "Uptime"] },
  ],
  quote: [
    { q: ["Simplicity is the", "keystone of design."], cap: "— Design Principle" },
    { q: ["Clarity beats", "cleverness."], cap: "— Team Value" },
    { q: ["Make the right thing", "the easy thing."], cap: "— Product Maxim" },
  ],
  statement: [
    { eyebrow: "North star", lines: ["Build things", "people love."], body: "Loved products earn the right to grow." },
    { eyebrow: "Mission", lines: ["Make complex", "feel simple."], body: "Hide the machinery; show the outcome." },
    { eyebrow: "Belief", lines: ["Ship small,", "learn fast."], body: "Momentum comes from many small, honest steps." },
  ],
  bignum: [
    { n: "10×", cap: "Faster iteration", body: "From idea to shipped in a fraction of the time." },
    { n: "<2s", cap: "Median response", body: "Fast enough that it feels invisible." },
    { n: "100K+", cap: "Teams onboarded", body: "Adopted across organisations of every size." },
  ],
  steps: [
    { steps: [["01", "Discover", "Frame the real problem"], ["02", "Design", "Shape the core idea"], ["03", "Deliver", "Ship and then learn"]] },
    { steps: [["01", "Listen", "Gather real signals"], ["02", "Build", "Make it tangible"], ["03", "Measure", "Let evidence lead"]] },
  ],
  twocol: [
    { cols: [{ label: "Before", body: ["Manual, slow,", "disconnected."] }, { label: "After", body: ["Automated, fast,", "unified."] }] },
    { cols: [{ label: "Problem", body: ["Too many tools,", "too little signal."] }, { label: "Solution", body: ["One place for", "what matters."] }] },
  ],
};

function isDark(hex) { const h = (hex || "").replace("#", ""); if (h.length !== 6) return false; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.62; }
function domColor(frag) { const m = frag.match(/fill="(#[0-9a-fA-F]{3,6})"/); return m ? m[1] : accent; }
// A chart graphic (kind 'chart', or ≥3 narrow vertical bars by the model bboxes) is
// content, not background decoration — pairing arbitrary text with it reads wrong.
function isChartLayout(L) {
  const els = (L.decorationModel?.elements ?? []).filter((e) => e.kind !== "background");
  if (els.some((e) => e.kind === "chart")) return true;
  return els.filter((e) => e.bbox.h > e.bbox.w && e.bbox.w < W * 0.18 && e.bbox.w > 0).length >= 3;
}

const N = Number(process.argv[3]) || 10;
const structNames = Object.keys(STRUCTURES);
// 1) enumerate valid candidates (decoration × structure, fit + clear region)
const cands = [];
for (const L of sys.layouts) {
  const { frag, bg } = decoOf(L.id);
  if (!frag.trim()) continue;
  if (isChartLayout(L)) continue;        // chart graphic = content, not decoration
  const region = openRegion(frag);
  if (!region) continue;
  // colour: full-colour bg → everything white; light bg → text=theme, accents harmonise with the decoration's own colour
  const fill = bg ? (isDark(bg) ? "#FFFFFF" : text) : text;
  const acc = bg ? (isDark(bg) ? "#FFFFFF" : text) : domColor(frag);
  const bgFill = bg || sys.tokens.colors.bg;
  for (const sName of structNames) {
    if (sName === L.archetype) continue;
    if (!STRUCTURES[sName].fits(region)) continue;
    // QUALITY = how well the content fills the open region (balance). A short
    // structure floating in a huge region scores low; a good fit scores high.
    const fillR = STRUCTURES[sName].foot(region) / region.h;
    if (fillR < 0.32 || fillR > 1.05) continue;   // too sparse (floats) or overflowing
    const score = 1 - Math.abs(fillR - 0.6);
    cands.push({ id: L.id, sName, frag, bg, bgFill, region, fill, acc, score });
  }
}
// 2) select ~N diverse: best fit first, one per decoration, balanced across structures
cands.sort((a, b) => b.score - a.score);
const picked = []; const usedDeco = new Set(); const sc = {}; const capPer = Math.ceil(N / structNames.length);
for (const c of cands) { if (picked.length >= N) break; if (usedDeco.has(c.id) || (sc[c.sName] || 0) >= capPer) continue; picked.push(c); usedDeco.add(c.id); sc[c.sName] = (sc[c.sName] || 0) + 1; }
for (const c of cands) { if (picked.length >= N) break; if (!picked.includes(c)) picked.push(c); }
// 3) assign a DISTINCT content set per structure
const pi = {};
for (const c of picked) { const arr = POOL[c.sName]; const i = pi[c.sName] || 0; c.data = arr[i % arr.length]; pi[c.sName] = i + 1; }

// 4) render
mkdirSync(`fixtures/out/augment/${theme}`, { recursive: true });
const made = [];
for (const c of picked) {
  const deco = c.bg ? c.frag.replace(/fill="#[0-9a-fA-F]{3,6}"/g, 'fill="#FFFFFF"') : c.frag;
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${c.bgFill}"/>${deco}${STRUCTURES[c.sName].render(c.region, c.fill, c.acc, c.data)}</svg>`;
  const name = `${c.id}__${c.sName}`;
  writeFileSync(`fixtures/out/augment/${theme}/${name}.png`, rasterize(svg, 1100));
  made.push({ name, deco: c.id, struct: c.sName, full: !!c.bg });
}
const cards = made.map((m) => `<figure><img src="${m.name}.png"><figcaption><b>${m.struct}</b> on <code>${m.deco}</code>${m.full ? " · full-colour" : ""}</figcaption></figure>`).join("");
writeFileSync(`fixtures/out/augment/${theme}/index.html`, `<!doctype html><meta charset=utf8><title>${theme} augmented</title><style>body{font-family:Inter,system-ui;background:#0a0a0a;color:#eee;margin:0;padding:28px}h1{font-weight:600}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}figure{margin:0;background:#161616;border-radius:12px;overflow:hidden}img{width:100%;display:block;border-bottom:1px solid #222}figcaption{padding:10px 14px;font-size:13px;color:#bbb}code{color:#8ab4ff}</style><h1>${theme} — augmented (+${made.length} new slides)</h1><p style="color:#888">Faithful decoration × a different content structure (distinct content each), placed in the decoration's largest open rectangle. Distinct from the original set.</p><div class=g>${cards}</div>`);
console.log(`${theme}: +${made.length} new slides (from ${cands.length} candidates) → fixtures/out/augment/${theme}/index.html`);
console.log(made.map((m) => `  ${m.struct} on ${m.deco}${m.full ? " (full-colour)" : ""}`).join("\n"));
