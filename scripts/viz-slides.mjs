import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { buildGrammarSpec } from "../packages/synthesizer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

// EXPLORATORY: synthesize data-viz slides (timeline, bar chart, donut) from each
// theme's GrammarSpec — palette for color, type for fonts. Full SVG built directly.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W = 1920, H = 1080, M = 120;

// brightest, most saturated palette color (for pills/bars), avoiding bg/near-white/black
function accentColor(spec) {
  const toRGB = (h) => { const m = h.replace("#", ""); const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m; return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)); };
  const sat = (h) => { try { const [r, g, b] = toRGB(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx * (mx / 255); } catch { return 0; } };
  const cands = (spec.palette ?? []).filter((c) => c && c !== spec.colors.bg && sat(c) > 0.15);
  cands.sort((a, b) => sat(b) - sat(a));
  return cands[0] ?? spec.colors.accent ?? spec.colors.primary ?? "#5FA0FB";
}

function frame(spec, inner) {
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${W}" height="${H}" fill="${spec.colors.bg}"/>${inner}</svg>`;
}
function head(spec, eyebrow, title) {
  const tf = spec.type.title?.family ?? spec.type.headline?.family ?? spec.fontFamily;
  const tw = spec.type.title?.weight ?? 300;
  const ef = spec.type.eyebrow?.family ?? spec.fontFamily;
  return `<text x="${M}" y="78" font-family="${ef}" font-size="20" font-weight="600" letter-spacing="2" fill="${spec.colors.text}" opacity="0.6">${esc(eyebrow)}</text>` +
    `<text x="${M}" y="200" font-family="${tf}" font-size="80" font-weight="${tw}" letter-spacing="-1" fill="${spec.colors.text}">${esc(title)}</text>`;
}
function wrap(text, n) { const w = text.split(" "); const out = []; let l = ""; for (const x of w) { if ((l + " " + x).trim().length > n) { out.push(l.trim()); l = x; } else l += " " + x; } if (l.trim()) out.push(l.trim()); return out; }
function bodyLines(spec, x, y, lines, color) {
  const bf = spec.type.body?.family ?? spec.fontFamily;
  return lines.map((ln, i) => `<text x="${x}" y="${y + i * 30}" font-family="${bf}" font-size="22" fill="${color}">${esc(ln)}</text>`).join("");
}

// Timeline (colorful #16 style): big date numerals + connector line w/ end dot +
// OCCURRENCE label + body, with a bold accent blob on light themes.
function timeline(spec, data) {
  const acc = accentColor(spec), dark = spec.colors.text;
  const cols = data.items.length, usable = W - 2 * M, step = usable / cols;
  const lineY = 640;
  const nf = spec.type.title?.family ?? spec.type.headline?.family ?? spec.fontFamily;
  const bf = spec.type.body?.family ?? spec.fontFamily;
  const light = (spec.colors.bg || "").toLowerCase() !== "#000000" && (spec.colors.bg || "").toLowerCase() !== "#000";
  let s = head(spec, data.eyebrow, data.title);
  if (light) s += `<path d="M${W} ${H - 360} C ${W - 220} ${H - 360}, ${W - 360} ${H - 140}, ${W - 360} ${H} L ${W} ${H} Z" fill="${acc}"/>`;
  s += `<line x1="${M}" y1="${lineY}" x2="${W - M}" y2="${lineY}" stroke="${dark}" stroke-opacity="0.5"/>`;
  s += `<circle cx="${W - M}" cy="${lineY}" r="7" fill="${acc}"/>`;
  data.items.forEach((it, i) => {
    const x = M + i * step;
    s += `<text x="${x}" y="${lineY - 150}" font-family="${nf}" font-size="80" font-weight="300" letter-spacing="-2" fill="${dark}">${esc(it.date)}</text>`;
    s += `<text x="${x}" y="${lineY - 98}" font-family="${bf}" font-size="24" font-weight="600" fill="${dark}">${esc(it.label)}</text>`;
    s += `<circle cx="${x + 6}" cy="${lineY}" r="6" fill="${dark}"/>`;
    s += bodyLines(spec, x, lineY + 56, it.body, dark);
  });
  return frame(spec, s);
}

// Metric (black #22 style): a big metric callout on the left + a 2×2 quadrant
// bubble matrix on the right (cross axes, sized bubbles with labels).
function metric(spec, data) {
  const acc = accentColor(spec), dark = spec.colors.text;
  const nf = spec.type.title?.family ?? spec.type.headline?.family ?? spec.fontFamily;
  const bf = spec.type.body?.family ?? spec.fontFamily;
  let s = head(spec, data.eyebrow, data.title);
  // left metric callout
  const mx = M, my = 560;
  s += `<text x="${mx}" y="${my}" font-family="${nf}" font-size="200" font-weight="300" letter-spacing="-6" fill="${dark}">${esc(data.metric)}</text>`;
  s += `<text x="${mx}" y="${my + 56}" font-family="${bf}" font-size="28" font-weight="600" fill="${dark}">${esc(data.metricLabel)}</text>`;
  s += bodyLines(spec, mx, my + 104, wrap(data.body, 34), dark);
  // right 2x2 quadrant
  const cx = 1380, cy = 560, ext = 320;
  s += `<line x1="${cx}" y1="${cy - ext}" x2="${cx}" y2="${cy + ext}" stroke="${dark}" stroke-opacity="0.35"/>`;
  s += `<line x1="${cx - ext}" y1="${cy}" x2="${cx + ext}" y2="${cy}" stroke="${dark}" stroke-opacity="0.35"/>`;
  const axf = `font-family="${bf}" font-size="20" font-weight="600" fill="${dark}" opacity="0.6"`;
  s += `<text x="${cx}" y="${cy - ext - 24}" text-anchor="middle" ${axf}>${esc(data.axis.top)}</text>`;
  s += `<text x="${cx}" y="${cy + ext + 40}" text-anchor="middle" ${axf}>${esc(data.axis.bottom)}</text>`;
  s += `<text x="${cx - ext - 16}" y="${cy + 7}" text-anchor="end" ${axf}>${esc(data.axis.left)}</text>`;
  s += `<text x="${cx + ext + 16}" y="${cy + 7}" text-anchor="start" ${axf}>${esc(data.axis.right)}</text>`;
  for (const b of data.bubbles) {
    const bx = cx + b.qx * ext * 0.5, by = cy - b.qy * ext * 0.5, r = b.r;
    s += `<circle cx="${bx}" cy="${by}" r="${r}" fill="${acc}" fill-opacity="0.85"/>`;
    s += `<text x="${bx}" y="${by + 6}" text-anchor="middle" font-family="${bf}" font-size="18" font-weight="600" fill="${spec.colors.bg}">${esc(b.label)}</text>`;
  }
  return frame(spec, s);
}

// Numbered process steps (colorful #17 style): big numerals 01–04 across columns.
function steps(spec, data) {
  const acc = accentColor(spec), dark = spec.colors.text;
  const cols = data.items.length, usable = W - 2 * M, step = usable / cols;
  const nf = spec.type.title?.family ?? spec.type.headline?.family ?? spec.fontFamily;
  const tf = spec.type.headline?.family ?? spec.fontFamily;
  const bf = spec.type.body?.family ?? spec.fontFamily;
  let s = head(spec, data.eyebrow, data.title);
  data.items.forEach((it, i) => {
    const x = M + i * step, y = 520;
    s += `<text x="${x}" y="${y}" font-family="${nf}" font-size="120" font-weight="300" fill="${acc}">${esc(it.num)}</text>`;
    s += `<line x1="${x}" y1="${y + 30}" x2="${x + step - 70}" y2="${y + 30}" stroke="${dark}" stroke-opacity="0.25"/>`;
    s += `<text x="${x}" y="${y + 90}" font-family="${tf}" font-size="34" font-weight="600" fill="${dark}">${esc(it.title)}</text>`;
    s += bodyLines(spec, x, y + 134, it.body, dark);
  });
  return frame(spec, s);
}
const ST = {
  eyebrow: "HOW IT WORKS", title: "From ticket to reply in four steps",
  items: [
    { num: "01", title: "Connect", body: wrap("Sync your help docs and past tickets.", 24) },
    { num: "02", title: "Draft", body: wrap("Pulse writes a reply grounded in your content.", 24) },
    { num: "03", title: "Review", body: wrap("An agent approves or tweaks it in one click.", 24) },
    { num: "04", title: "Learn", body: wrap("Every edit sharpens the next draft.", 24) },
  ],
};
const TL = {
  eyebrow: "ROADMAP", title: "Timeline",
  items: [
    { date: "2026", label: "LAUNCH", body: wrap("AI drafting beta ships to 50 design partners.", 26) },
    { date: "2027", label: "SCALE", body: wrap("Smart routing GA and the first analytics dashboard.", 26) },
    { date: "2028", label: "EXTEND", body: wrap("Voice control integration and SOC 2 compliance.", 26) },
    { date: "2029", label: "EXPAND", body: wrap("Marketplace opens; expansion to three regions.", 26) },
  ],
};
const ME = {
  eyebrow: "TRACTION", title: "Where Pulse wins",
  metric: "4.2x", metricLabel: "average first-year ROI",
  body: "Customers reach payback in under five months — and adoption compounds from there.",
  axis: { top: "High impact", bottom: "Low impact", left: "Slow to adopt", right: "Fast to adopt" },
  bubbles: [
    { qx: 1, qy: 1, r: 75, label: "Auto-draft" },
    { qx: -1, qy: 1, r: 51, label: "Insights" },
    { qx: 1, qy: -1, r: 60, label: "Routing" },
    { qx: -1, qy: -1, r: 40, label: "Voice" },
  ],
};

mkdirSync("fixtures/out/viz", { recursive: true });
const made = [];
for (const theme of ["colorful", "black", "green"]) {
  const p = `fixtures/assets/${theme}/system.json`;
  if (!existsSync(p)) continue;
  const spec = buildGrammarSpec(JSON.parse(readFileSync(p, "utf8")));
  for (const [name, svg] of [["timeline", timeline(spec, TL)], ["metric", metric(spec, ME)], ["steps", steps(spec, ST)]]) {
    const out = `fixtures/out/viz/${theme}_${name}.png`;
    writeFileSync(out, rasterize(svg, 1280));
    made.push(out);
  }
}
console.log(made.join("\n"));
