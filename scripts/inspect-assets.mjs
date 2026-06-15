// Build a static HTML viewer to inspect assetize output:
// original template vs decoration fragment vs extracted tokens.
// Run after assetizing:  node scripts/inspect-assets.mjs && open fixtures/assets/index.html
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const THEME_DIR = { colorful: "colorfulldesign", black: "blackdesign", green: "greendesign" };
const assetsRoot = resolve("fixtures/assets");

if (!existsSync(assetsRoot)) {
  console.error("no fixtures/assets — run the extractor first");
  process.exit(1);
}

const cards = [];
for (const theme of Object.keys(THEME_DIR)) {
  const dir = resolve(assetsRoot, theme);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".asset.json")).sort()) {
    const name = file.replace(".asset.json", "");
    const asset = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
    const origRel = `../../templates/${THEME_DIR[theme]}/${name}.svg`;
    const decoRel = `${theme}/${name}.decoration.svg`;

    const swatches = Object.entries(asset.tokens.colors)
      .map(([k, v]) => `<div class="sw"><span style="background:${v}"></span>${k}<br><code>${v}</code></div>`)
      .join("");
    const types = Object.entries(asset.tokens.type)
      .map(([role, t]) => `<tr><td>${role}</td><td>${t.family}</td><td>${t.size}</td><td>${t.weight}</td></tr>`)
      .join("");
    const slots = (asset.layouts[0]?.defaultSlots ?? []).join(", ");

    cards.push(`<section class="card">
  <h2>${theme} / ${name}</h2>
  <div class="pair">
    <figure><figcaption>original</figcaption><img src="${origRel}"></figure>
    <figure><figcaption>decoration (text stripped)</figcaption><img src="${decoRel}"></figure>
  </div>
  <div class="meta">
    <div class="colors">${swatches}</div>
    <table><tr><th>role</th><th>family</th><th>size</th><th>weight</th></tr>${types}</table>
    <p class="slots"><b>defaultSlots:</b> ${slots || "(none)"}</p>
  </div>
</section>`);
  }
}

const html = `<!doctype html><meta charset="utf-8"><title>Stencil — asset inspector</title>
<style>
  body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:24px;background:#fafafa;color:#111}
  h1{font-size:18px} h2{font-size:15px;margin:0 0 8px}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:16px;margin:0 0 20px}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  figure{margin:0} figcaption{font-size:12px;color:#888;margin-bottom:4px}
  img{width:100%;border:1px solid #eee;border-radius:6px;background:#fff}
  .meta{display:flex;gap:24px;flex-wrap:wrap;margin-top:12px;align-items:flex-start}
  .colors{display:flex;gap:10px} .sw{font-size:11px;text-align:center}
  .sw span{display:block;width:40px;height:40px;border-radius:6px;border:1px solid #ddd;margin:0 auto 4px}
  table{border-collapse:collapse;font-size:12px} td,th{border:1px solid #eee;padding:3px 8px;text-align:left}
  .slots{font-size:12px;color:#444}
  code{font-size:11px;color:#666}
</style>
<h1>Stencil — asset inspector (${cards.length} layouts)</h1>
${cards.join("\n")}`;

const out = resolve(assetsRoot, "index.html");
writeFileSync(out, html, "utf8");
console.log("written:", out, `(${cards.length} layouts)`);
