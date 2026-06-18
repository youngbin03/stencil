import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

// --- open region = the largest band CLEAR of the decoration's salient mass (its
// clamped bbox is a hard boundary), so any content placed there can't cross the
// decoration. Returns null if the decoration leaves no usable room. ---
const GAP = 48;
function openRegion(layout) {
  const els = (layout.decorationModel?.elements ?? []).filter((e) => e.kind !== "background" && (e.salience ?? 0) >= 0.2);
  if (!els.length) return { x: SAFE, y: SAFE, w: W - 2 * SAFE, h: H - 2 * SAFE };
  const mx0 = Math.max(0, Math.min(...els.map((e) => e.bbox.x)));
  const my0 = Math.max(0, Math.min(...els.map((e) => e.bbox.y)));
  const mx1 = Math.min(W, Math.max(...els.map((e) => e.bbox.x + e.bbox.w)));
  const my1 = Math.min(H, Math.max(...els.map((e) => e.bbox.y + e.bbox.h)));
  const bands = [
    { x: SAFE, y: SAFE, w: W - 2 * SAFE, h: my0 - SAFE - GAP },              // above mass
    { x: SAFE, y: my1 + GAP, w: W - 2 * SAFE, h: H - SAFE - (my1 + GAP) },   // below
    { x: SAFE, y: SAFE, w: mx0 - SAFE - GAP, h: H - 2 * SAFE },              // left of
    { x: mx1 + GAP, y: SAFE, w: W - SAFE - (mx1 + GAP), h: H - 2 * SAFE },   // right of
  ].filter((r) => r.w > W * 0.3 && r.h > H * 0.22);
  if (!bands.length) return null;
  bands.sort((a, b) => b.w * b.h - a.w * a.h);
  return bands[0];
}

// --- content structures (placeholder, consistent voice) placed INTO the region ---
function txt(x, y, role, s, fill) {
  return `<text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${fam(role)}" font-size="${spec.type[role]?.size ?? 40}" font-weight="${spec.type[role]?.weight ?? 400}" fill="${fill}" style="white-space:pre">${esc(s)}</text>`;
}
const STRUCTURES = {
  title: { fits: (r) => r.h > H * 0.25 && r.w > W * 0.55, render: (r, fill) => { const cy = r.y + r.h * 0.42; return txt(r.x, cy, "eyebrow", "Overview", fill) + txt(r.x, cy + (spec.type.title?.size ?? 120) * 0.9, "title", "Designing with intent", fill); } },
  list: {
    fits: (r) => r.h > H * 0.45 && r.w > W * 0.45,
    render: (r, fill) => {
      const items = ["Start from the problem", "Shape the core idea", "Ship and learn"];
      const gap = Math.min(r.h / (items.length + 1), 150); let y = r.y + gap * 0.9; let out = txt(r.x, r.y + 40, "eyebrow", "In this section", fill);
      items.forEach((t, idx) => { y += gap; out += txt(r.x, y, "headline", `0${idx + 1}`, fill) + txt(r.x + 260, y, "subtitle", t, fill) + `<line x1="${r.x}" y1="${Math.round(y + 24)}" x2="${Math.round(r.x + r.w)}" y2="${Math.round(y + 24)}" stroke="${accent}" stroke-width="3"/>`; });
      return out;
    },
  },
  kpi: {
    fits: (r) => r.w > W * 0.6 && r.h > H * 0.25,
    render: (r, fill) => {
      const k = ["38%", "2.4×", "+12"], cap = ["Adoption lift", "Faster delivery", "Retention gain"];
      const cw = r.w / 3, cy = r.y + r.h * 0.5; let out = "";
      k.forEach((v, idx) => { const x = r.x + idx * cw; out += txt(x, cy, "kpi", v, fill) + txt(x, cy + 56, "caption", cap[idx], fill); });
      return out;
    },
  },
  quote: { fits: (r) => r.h > H * 0.3 && r.w > W * 0.5, render: (r, fill) => { const cy = r.y + r.h * 0.45; return txt(r.x, cy, "quote", "Simplicity is the", fill) + txt(r.x, cy + (spec.type.quote?.size ?? 120) * 1.0, "quote", "keystone of design.", fill) + txt(r.x, cy + (spec.type.quote?.size ?? 120) * 1.0 + 70, "caption", "— Design Principle", fill); } },
};

function isDark(hex) { const h = (hex || "").replace("#", ""); if (h.length !== 6) return false; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.62; }

mkdirSync(`fixtures/out/augment`, { recursive: true });
const made = [];
const seen = new Set();
const structNames = Object.keys(STRUCTURES);
for (const L of sys.layouts) {
  const { frag, bg } = decoOf(L.id);
  if (!frag.trim()) continue;            // need a real decoration to pair with
  const region = openRegion(L);
  if (!region) continue;                 // decoration leaves no clear room
  const bgFill = bg || sys.tokens.colors.bg;
  const fill = bg ? (isDark(bg) ? "#FFFFFF" : text) : text;
  for (const sName of structNames) {
    if (sName === L.archetype) continue;           // skip the original pairing
    const sig = `${L.id}:${sName}:${bg || "light"}`;
    if (seen.has(sig)) continue;
    const st = STRUCTURES[sName];
    if (!st.fits(region)) continue;
    seen.add(sig);
    const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${bgFill}"/>${bg ? frag.replace(/fill="#[0-9a-fA-F]{3,6}"/g, 'fill="#FFFFFF"') : frag}${st.render(region, fill)}</svg>`;
    const name = `${L.id}__${sName}`;
    writeFileSync(`fixtures/out/augment/${name}.png`, rasterize(svg, 1100));
    made.push({ name, deco: L.id, struct: sName, region: `${Math.round(region.w)}×${Math.round(region.h)}@${Math.round(region.x)},${Math.round(region.y)}`, full: !!bg });
  }
}
// gallery
const cards = made.map((m) => `<figure><img src="${m.name}.png"><figcaption><b>${m.struct}</b> on <code>${m.deco}</code>${m.full ? " · full-colour" : ""}<br><small>open ${m.region}</small></figcaption></figure>`).join("");
writeFileSync(`fixtures/out/augment/index.html`, `<!doctype html><meta charset=utf8><title>${theme} augmented</title><style>body{font-family:Inter,system-ui;background:#0a0a0a;color:#eee;margin:0;padding:28px}h1{font-weight:600}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}figure{margin:0;background:#161616;border-radius:12px;overflow:hidden}img{width:100%;display:block;border-bottom:1px solid #222}figcaption{padding:10px 14px;font-size:13px;color:#bbb}code{color:#8ab4ff}</style><h1>${theme} — augmented (${made.length} new slides)</h1><p style="color:#888">Faithful decoration × different content structure, placed in the decoration's open region. Not in the original set.</p><div class=g>${cards}</div>`);
console.log(`${theme}: ${made.length} new slides → fixtures/out/augment/index.html`);
console.log(made.slice(0, 12).map((m) => `  ${m.struct} on ${m.deco} (open ${m.region})${m.full ? " full-colour" : ""}`).join("\n"));
