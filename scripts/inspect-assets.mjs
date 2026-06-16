// HTML viewer for theme design systems: shared tokens/grammar at the top,
// then each layout (original vs decoration). Run after extracting themes:
//   node scripts/inspect-assets.mjs && open fixtures/assets/index.html
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const THEME_DIR = { colorful: "colorfulldesign", black: "blackdesign", green: "greendesign" };
const assetsRoot = resolve("fixtures/assets");
if (!existsSync(assetsRoot)) {
  console.error("no fixtures/assets — run the extractor first");
  process.exit(1);
}

const sections = [];
for (const theme of Object.keys(THEME_DIR)) {
  const sysPath = resolve(assetsRoot, theme, "system.json");
  if (!existsSync(sysPath)) continue;
  const sys = JSON.parse(readFileSync(sysPath, "utf8"));

  const palette = (sys.tokens.palette ?? [])
    .map((c) => `<span class="chip" title="${c}" style="background:${c}"></span>`)
    .join("");
  const types = Object.entries(sys.tokens.type)
    .map(([role, t]) => `<tr><td>${role}</td><td>${t.family}</td><td>${t.size}</td><td>${t.weight}</td></tr>`)
    .join("");
  const g = sys.grammar;
  const conventions = (g.groups ?? []).map((gr) => gr.roles.join("+")).join(", ") || "(none)";

  const cw = sys.canvas?.w ?? 1920;
  const ch = sys.canvas?.h ?? 1080;
  // SVG overlay of regions (bbox solid) + their safeArea growth limit (dashed).
  const regionOverlay = (regions) => {
    if (!regions?.length) return "";
    const colors = { header: "#e6194b", title: "#3cb44b", cards: "#4363d8", body: "#f58231", footer: "#911eb4" };
    const parts = regions.map((r) => {
      const c = colors[r.id] ?? "#888";
      const b = r.bbox;
      const sa = r.safeArea;
      const saRect = sa
        ? `<rect x="${sa.x}" y="${sa.y}" width="${sa.w}" height="${sa.h}" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="14 10" opacity="0.7"/>`
        : "";
      return `${saRect}<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${c}" fill-opacity="0.10" stroke="${c}" stroke-width="2"/>` +
        `<text x="${b.x + 6}" y="${b.y + 26}" font-size="26" fill="${c}" font-family="sans-serif">${r.id} (${r.flow})</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${cw} ${ch}" class="overlay" preserveAspectRatio="xMidYMid meet">${parts}</svg>`;
  };

  const cards = (sys.layouts ?? [])
    .map((L) => {
      const name = L.id.replace(`${theme}_`, "");
      const orig = `../../templates/${THEME_DIR[theme]}/${name}.svg`;
      const deco = `${theme}/decorations/${L.id}.svg`;
      const slotList = (L.slots ?? [])
        .map((s) => (s.mediaKind ? `${s.role}:${s.mediaKind}${s.replaceable ? "*" : ""}` : s.role))
        .join(", ");
      const arche = L.archetype ? `<span class="arche">${L.archetype}</span>` : "";
      const regions = L.regions ?? [];
      const edges = L.relationGraph?.edges ?? [];
      const avoids = edges.filter((e) => e.type === "avoids").length;
      const over = edges.filter((e) => e.type === "over").length;
      const grows = regions
        .filter((r) => r.safeArea && r.safeArea.h > r.bbox.h + 1)
        .map((r) => `${r.id}+${Math.round(r.safeArea.h - r.bbox.h)}`)
        .join(", ") || "(none)";
      const card = L.cardSpec ? ` · card×${L.cardSpec.baseCount}[${(L.cardSpec.roles ?? []).join("/")}]` : "";
      return `<div class="card">
        <h4>${name} ${arche}<span class="bg" style="background:${L.background}"></span><code>${L.background}</code></h4>
        <div class="pair">
          <figure><figcaption>original + regions / safeArea(dashed)</figcaption>
            <div class="stack"><img src="${orig}">${regionOverlay(regions)}</div></figure>
          <figure><figcaption>decoration</figcaption><img src="${deco}"></figure>
        </div>
        <p class="slots">slots: ${slotList || "(none)"}</p>
        <p class="meta">regions: ${regions.length} · grow room: ${grows} · relations: ${avoids} avoids, ${over} over${card}</p>
      </div>`;
    })
    .join("\n");

  sections.push(`<section class="theme">
    <h2>${theme} — design system (${sys.layouts.length} layouts)</h2>
    <div class="system">
      <div><b>palette</b><div class="palette">${palette}</div></div>
      <div><b>shared type</b><table><tr><th>role</th><th>family</th><th>size</th><th>weight</th></tr>${types}</table></div>
      <div class="grammar">
        <b>grammar</b>
        <div>grid x: [${g.alignmentGrid.xGuides.join(", ")}] · y: [${g.alignmentGrid.yGuides.join(", ")}] · margin ${g.alignmentGrid.margin}</div>
        <div>rhythm (base ${g.spacingRhythm.baseUnit}): ${g.spacingRhythm.gaps.tight}/${g.spacingRhythm.gaps.normal}/${g.spacingRhythm.gaps.loose}/${g.spacingRhythm.gaps.section}</div>
        <div>hierarchy ratio: ${g.hierarchy.titleToBodyRatio} · conventions: ${conventions}</div>
      </div>
    </div>
    <div class="cards">${cards}</div>
  </section>`);
}

const html = `<!doctype html><meta charset="utf-8"><title>Stencil — design systems</title>
<style>
  body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:24px;background:#fafafa;color:#111}
  h1{font-size:18px} h2{font-size:16px;margin:28px 0 12px;border-bottom:2px solid #111;padding-bottom:4px}
  .system{display:flex;gap:28px;flex-wrap:wrap;background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:16px;margin-bottom:16px;align-items:flex-start}
  .palette{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;max-width:320px}
  .chip{width:24px;height:24px;border-radius:5px;border:1px solid #ddd}
  table{border-collapse:collapse;font-size:12px;margin-top:6px} td,th{border:1px solid #eee;padding:3px 8px;text-align:left}
  .grammar div{font-size:12px;color:#555;margin-top:3px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:10px}
  .card h4{margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:6px}
  .arche{font-size:10px;background:#111;color:#fff;border-radius:4px;padding:1px 6px}
  .bg{width:14px;height:14px;border-radius:3px;border:1px solid #ccc;display:inline-block}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  figure{margin:0} figcaption{font-size:11px;color:#999} img{width:100%;border:1px solid #eee;border-radius:4px;background:#fff;display:block}
  .stack{position:relative} .stack img{display:block} .overlay{position:absolute;inset:0;width:100%;height:100%}
  .slots{font-size:11px;color:#666;margin:8px 0 0} code{font-size:11px;color:#666}
  .meta{font-size:11px;color:#2a6;margin:4px 0 0;font-family:ui-monospace,monospace}
</style>
<h1>Stencil — design systems (${sections.length} themes)</h1>
${sections.join("\n")}`;

const out = resolve(assetsRoot, "index.html");
writeFileSync(out, html, "utf8");
console.log("written:", out, `(${sections.length} themes)`);
