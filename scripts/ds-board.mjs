import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { buildGrammarSpec } from "../packages/synthesizer/dist/index.js";
import { placeMockup } from "../packages/normalizer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

// One self-contained board PNG documenting a theme's design system: type scale (real
// fonts), grid & margin, spacing rhythm, archetype skeletons paired with a real
// example slide, and device mockups. No external refs — everything embedded.
const theme = process.argv[2] ?? "colorful";
const DIR = { colorful: "colorfulldesign", black: "blackdesign", green: "greendesign" }[theme];
const sys = JSON.parse(readFileSync(`fixtures/assets/${theme}/system.json`, "utf8"));
const s = buildGrammarSpec(sys);
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ZC = { header: "#e6194b", title: "#3cb44b", cards: "#4363d8", body: "#f58231", footer: "#911eb4" };
const W = 1600;

// representative real slide per archetype
const repByArch = {};
for (const L of sys.layouts) { const a = L.archetype; if (a && !repByArch[a]) repByArch[a] = L.id.replace(`${theme}_`, ""); }
const exampleURI = (name) => {
  const p = `templates/${DIR}/${name}.svg`;
  if (!existsSync(p)) return null;
  try { return "data:image/png;base64," + rasterize(readFileSync(p, "utf8"), 600).toString("base64"); } catch { return null; }
};

function skel(sk, x, y, w, h) {
  let p = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#fff" stroke="#ddd"/>`;
  for (const z of sk.zones) {
    const zx = x + z.xFrac[0] * w, zw = (z.xFrac[1] - z.xFrac[0]) * w, zy = y + z.yFrac[0] * h, zh = (z.yFrac[1] - z.yFrac[0]) * h;
    const c = ZC[z.id] ?? "#888";
    p += `<rect x="${zx.toFixed(1)}" y="${zy.toFixed(1)}" width="${zw.toFixed(1)}" height="${zh.toFixed(1)}" fill="${c}" fill-opacity="0.12" stroke="${c}" stroke-width="0.8"/>`;
    p += `<text x="${(zx + 4).toFixed(1)}" y="${(zy + 13).toFixed(1)}" font-family="Inter" font-size="9" fill="${c}">${esc(z.id)}</text>`;
  }
  for (const z of sk.imageZones) {
    const zx = x + z.xFrac[0] * w, zw = (z.xFrac[1] - z.xFrac[0]) * w, zy = y + z.yFrac[0] * h, zh = (z.yFrac[1] - z.yFrac[0]) * h;
    const c = z.mockupRef ? "#0a7" : "#999";
    p += `<rect x="${zx.toFixed(1)}" y="${zy.toFixed(1)}" width="${zw.toFixed(1)}" height="${zh.toFixed(1)}" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="0.8" stroke-dasharray="3 2"/>`;
  }
  return p;
}

const lab = (x, y, t) => `<text x="${x}" y="${y}" font-family="Inter" font-size="12" font-weight="700" letter-spacing="1.2" fill="#6b6b6b">${t}</text>`;
let svg = "";

// header
svg += `<text x="48" y="58" font-family="Bricolage Grotesque" font-size="40" font-weight="300" fill="#0a0a0a">${esc(theme)}</text>`;
svg += `<text x="48" y="84" font-family="Inter" font-size="14" fill="#999">design system · ${s.archetypes.reduce((a, b) => a + b.support, 0)} slides distilled</text>`;

// PALETTE + semantic
svg += lab(48, 132, "PALETTE");
s.palette.slice(0, 10).forEach((c, i) => { svg += `<rect x="${48 + i * 44}" y="146" width="36" height="36" rx="7" fill="${c}" stroke="#ddd"/>`; });
["primary", "accent", "bg", "text"].forEach((k, i) => { svg += `<rect x="${48 + i * 130}" y="200" width="22" height="22" rx="5" fill="${s.colors[k]}" stroke="#ddd"/><text x="${76 + i * 130}" y="216" font-family="Inter" font-size="11" fill="#777">${k} ${esc(s.colors[k])}</text>`; });

// TYPE SCALE
svg += lab(640, 132, "TYPE SCALE");
Object.entries(s.type).sort((a, b) => (b[1].size ?? 0) - (a[1].size ?? 0)).slice(0, 5).forEach(([role, t], i) => {
  const y = 162 + i * 38, disp = Math.min(t.size ?? 16, 34);
  svg += `<text x="640" y="${y}" font-family="${t.family}" font-size="${disp}" font-weight="${t.weight}" fill="#0a0a0a">${esc(role)}</text>`;
  svg += `<text x="860" y="${y}" font-family="Inter" font-size="12" fill="#9a9a9a">${esc(t.family)} · ${t.size} · ${t.weight}</text>`;
});

// GRID + RHYTHM
svg += lab(1180, 132, "GRID · margin");
const gw = 360, gh = 203, gx = 1180, gy = 146;
svg += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="6" fill="#fff" stroke="#ddd"/>`;
const mm = s.alignment.margin / 1920 * gw;
svg += `<rect x="${gx + mm}" y="${gy + mm}" width="${gw - 2 * mm}" height="${gh - 2 * mm}" fill="none" stroke="#ccc" stroke-dasharray="4 3"/>`;
s.alignment.xGuides.forEach((x) => { const xx = gx + x / 1920 * gw; svg += `<line x1="${xx}" y1="${gy}" x2="${xx}" y2="${gy + gh}" stroke="#4363d8" stroke-width="1"/>`; });
svg += lab(1180, gy + gh + 30, `SPACING rhythm · base ${s.spacing.baseUnit}`);
const gp = s.spacing.gaps;
["tight", "normal", "loose", "section"].forEach((k, i) => { svg += `<rect x="${gx}" y="${gy + gh + 44 + i * 18}" width="${Math.min(gp[k], 180)}" height="9" rx="2" fill="#111"/><text x="${gx + Math.min(gp[k], 180) + 8}" y="${gy + gh + 52 + i * 18}" font-family="Inter" font-size="11" fill="#777">${k} ${gp[k]}</text>`; });

// ARCHETYPE SKELETONS — real example + mined pattern
let y = 470;
svg += lab(48, y, "ARCHETYPE SKELETONS · real example + the pattern mined across slides (not a copied frame)");
y += 22;
const tops = s.archetypes.filter((a) => a.archetype !== "other").slice(0, 4);
const pw = 320, ph = 180, gapMid = 14, blockW = pw * 2 + gapMid, perRow = 2, gapX = 56, gapY = 60;
tops.forEach((sk, i) => {
  const bx = 48 + (i % perRow) * (blockW + gapX), by = y + Math.floor(i / perRow) * (ph + gapY);
  const ex = exampleURI(repByArch[sk.archetype]);
  if (ex) svg += `<image href="${ex}" x="${bx}" y="${by}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMid meet"/><rect x="${bx}" y="${by}" width="${pw}" height="${ph}" rx="6" fill="none" stroke="#ddd"/>`;
  else svg += `<rect x="${bx}" y="${by}" width="${pw}" height="${ph}" rx="6" fill="#f0f0f0" stroke="#ddd"/>`;
  svg += skel(sk, bx + pw + gapMid, by, pw, ph);
  svg += `<text x="${bx}" y="${by + ph + 18}" font-family="Inter" font-size="12" font-weight="700" fill="#111">${esc(sk.archetype)} <tspan fill="#aaa">×${sk.support}</tspan> <tspan fill="#bbb" font-weight="400">— real · mined</tspan></text>`;
});
y += 2 * (ph + gapY) + 6;

// DEVICE MOCKUPS
let mockDefs = "", mockBody = "";
const mdir = `fixtures/assets/${theme}/mockups`;
if (existsSync(mdir)) {
  svg += lab(48, y, "DEVICE MOCKUPS · reusable frame, empty screen = user image slot");
  const files = readdirSync(mdir).filter((f) => f.endsWith(".json"));
  files.slice(0, 6).forEach((f, i) => {
    const asset = JSON.parse(readFileSync(`${mdir}/${f}`, "utf8"));
    const box = { x: 48 + i * 200, y: y + 16, w: 170, h: 230 };
    svg += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="${s.colors.bg}" stroke="#e5e5e5"/>`;
    const { defs, markup } = placeMockup(asset, box);
    mockDefs += defs; mockBody += markup;
    svg += `<text x="${box.x}" y="${box.y + box.h + 16}" font-family="Inter" font-size="10" fill="#999">${Math.round(asset.frameBBox.w)}×${Math.round(asset.frameBBox.h)}</text>`;
  });
  y += 230 + 40;
}

const H = y + 10;
const out = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${mockDefs}</defs><rect width="${W}" height="${H}" fill="#fafafa"/>${svg}${mockBody}</svg>`;
writeFileSync(`docs/assets/ds-${theme}.png`, rasterize(out, 1600));
console.log(`docs/assets/ds-${theme}.png  (${W}x${H})`);
