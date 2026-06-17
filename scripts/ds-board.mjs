import { readFileSync, writeFileSync } from "node:fs";
import { buildGrammarSpec } from "../packages/synthesizer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

// One self-contained board PNG documenting a theme's design system (palette, type
// scale in real fonts, grid/rhythm, blocks, archetype skeletons). No external refs.
const theme = process.argv[2] ?? "colorful";
const s = buildGrammarSpec(JSON.parse(readFileSync(`fixtures/assets/${theme}/system.json`, "utf8")));
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W = 1600, H = 1020;
const ZC = { header: "#e6194b", title: "#3cb44b", cards: "#4363d8", body: "#f58231", footer: "#911eb4" };

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
  p += `<text x="${x}" y="${y + h + 16}" font-family="Inter" font-size="12" font-weight="700" fill="#111">${esc(sk.archetype)} <tspan fill="#aaa">×${sk.support}</tspan></text>`;
  return p;
}

let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#fafafa"/>`;
svg += `<text x="48" y="58" font-family="Bricolage Grotesque" font-size="40" font-weight="300" fill="#0a0a0a">${esc(theme)}</text>`;
svg += `<text x="48" y="84" font-family="Inter" font-size="14" fill="#999">design system · ${(s.archetypes.reduce((a, b) => a + b.support, 0))} slides distilled</text>`;
const lab = (x, y, t) => `<text x="${x}" y="${y}" font-family="Inter" font-size="12" font-weight="700" letter-spacing="1.2" fill="#6b6b6b">${t}</text>`;

// PALETTE
svg += lab(48, 132, "PALETTE");
s.palette.slice(0, 10).forEach((c, i) => { svg += `<rect x="${48 + i * 44}" y="146" width="36" height="36" rx="7" fill="${c}" stroke="#ddd"/>`; });
["primary", "accent", "bg", "text"].forEach((k, i) => { svg += `<rect x="${48 + i * 130}" y="200" width="22" height="22" rx="5" fill="${s.colors[k]}" stroke="#ddd"/><text x="${76 + i * 130}" y="216" font-family="Inter" font-size="11" fill="#777">${k} ${esc(s.colors[k])}</text>`; });

// TYPE SCALE
svg += lab(640, 132, "TYPE SCALE");
const types = Object.entries(s.type).sort((a, b) => (b[1].size ?? 0) - (a[1].size ?? 0)).slice(0, 5);
types.forEach(([role, t], i) => {
  const y = 162 + i * 38, disp = Math.min(t.size ?? 16, 34);
  svg += `<text x="640" y="${y}" font-family="${t.family}" font-size="${disp}" font-weight="${t.weight}" fill="#0a0a0a">${esc(role)}</text>`;
  svg += `<text x="860" y="${y}" font-family="Inter" font-size="12" fill="#9a9a9a">${esc(t.family)} · ${t.size} · ${t.weight}</text>`;
});

// GRID + RHYTHM
svg += lab(1180, 132, "GRID · RHYTHM");
const gw = 360, gh = 203, gx = 1180, gy = 146;
svg += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="6" fill="#fff" stroke="#ddd"/>`;
const m = s.alignment.margin / 1920 * gw;
svg += `<rect x="${gx + m}" y="${gy + m}" width="${gw - 2 * m}" height="${gh - 2 * m}" fill="none" stroke="#ccc" stroke-dasharray="4 3"/>`;
s.alignment.xGuides.forEach((x) => { const xx = gx + x / 1920 * gw; svg += `<line x1="${xx}" y1="${gy}" x2="${xx}" y2="${gy + gh}" stroke="#4363d8" stroke-width="1"/>`; });
const gp = s.spacing.gaps;
["tight", "normal", "loose", "section"].forEach((k, i) => { svg += `<rect x="${gx}" y="${gy + gh + 18 + i * 18}" width="${Math.min(gp[k], 160)}" height="9" rx="2" fill="#111"/><text x="${gx + Math.min(gp[k], 160) + 8}" y="${gy + gh + 26 + i * 18}" font-family="Inter" font-size="11" fill="#777">${k} ${gp[k]}</text>`; });

// ARCHETYPE SKELETONS
svg += lab(48, 470, "ARCHETYPE SKELETONS · 여러 슬라이드에서 집계한 패턴 (복사 아님)");
const top = s.archetypes.filter((a) => a.archetype !== "other").slice(0, 8);
const cols = 4, cw = 350, ch = 197, gxs = 48, gys = 492, gapx = 16, gapy = 56;
top.forEach((sk, i) => { const cx = gxs + (i % cols) * (cw + gapx), cy = gys + Math.floor(i / cols) * (ch + gapy); svg += skel(sk, cx, cy, cw, ch); });
svg += `</svg>`;

writeFileSync(`docs/assets/ds-${theme}.png`, rasterize(svg, 1600));
console.log(`docs/assets/ds-${theme}.png`);
