// Visualize each theme as an ESTABLISHED design system (the GrammarSpec distilled
// from its template slides) — palette, type scale, grid/rhythm, hierarchy, blocks,
// archetype skeletons (mined patterns), device mockups, relations.
//   node scripts/design-system.mjs && open fixtures/assets/design-system.html
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildGrammarSpec } from "../packages/synthesizer/dist/index.js";

const themes = ["colorful", "black", "green"];
const THEME_DIR = { colorful: "colorfulldesign", black: "blackdesign", green: "greendesign" };
const root = resolve("fixtures/assets");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ZC = { header: "#e6194b", title: "#3cb44b", cards: "#4363d8", body: "#f58231", footer: "#911eb4" };

// 16:9 diagram of an archetype's zones + image/mockup cells (normalized fracs).
function skeletonSVG(sk) {
  const W = 100, H = 56.25;
  let p = `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#ddd" stroke-width="0.4"/>`;
  for (const z of sk.zones) {
    const x = z.xFrac[0] * W, w = (z.xFrac[1] - z.xFrac[0]) * W, y = z.yFrac[0] * H, h = (z.yFrac[1] - z.yFrac[0]) * H;
    const c = ZC[z.id] ?? "#888";
    p += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}" fill-opacity="0.12" stroke="${c}" stroke-width="0.5"/>`;
    p += `<text x="${(x + 0.8).toFixed(1)}" y="${(y + 2.6).toFixed(1)}" font-size="2" fill="${c}">${esc(z.id)}${z.block ? "*" : ""}</text>`;
  }
  for (const z of sk.imageZones) {
    const x = z.xFrac[0] * W, w = (z.xFrac[1] - z.xFrac[0]) * W, y = z.yFrac[0] * H, h = (z.yFrac[1] - z.yFrac[0]) * H;
    const mock = !!z.mockupRef;
    const c = mock ? "#0a7" : "#999";
    p += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="0.5" stroke-dasharray="1.5 1"/>`;
    p += `<text x="${(x + 0.8).toFixed(1)}" y="${(y + h - 1).toFixed(1)}" font-size="2" fill="${c}">${mock ? "mockup" : z.mediaKind ?? "image"}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="dgm">${p}</svg>`;
}

// A device-mockup asset rendered at its own frame box.
function mockupThumb(asset) {
  const b = asset.frameBBox;
  const defs = asset.defs ?? "";
  return `<svg viewBox="${b.x} ${b.y} ${b.w} ${b.h}" class="mk"><defs>${defs}</defs>${asset.body ?? ""}</svg>`;
}

const sections = [];
for (const theme of themes) {
  const sysPath = resolve(root, theme, "system.json");
  if (!existsSync(sysPath)) continue;
  const sys = JSON.parse(readFileSync(sysPath, "utf8"));
  const spec = buildGrammarSpec(sys);
  const dir = THEME_DIR[theme];
  // A representative real slide per archetype (to pair the abstract pattern with
  // the theme's actual design elements).
  const repByArch = {};
  for (const L of sys.layouts) { const a = L.archetype; if (a && !repByArch[a]) repByArch[a] = L.id.replace(`${theme}_`, ""); }

  // palette + semantic colors
  const swatch = (c, label) => `<div class="sw"><span style="background:${c}"></span><code>${label ?? c}</code></div>`;
  const palette = (spec.palette ?? []).map((c) => swatch(c)).join("");
  const roles = ["primary", "accent", "bg", "text"].map((k) => swatch(spec.colors[k], `${k} ${spec.colors[k]}`)).join("");

  // type scale specimens (capped display size, real px shown)
  const type = Object.entries(spec.type)
    .sort((a, b) => (b[1].size ?? 0) - (a[1].size ?? 0))
    .map(([role, t]) => {
      const disp = Math.min(t.size ?? 16, 44);
      return `<div class="spec"><span class="sp" style="font-size:${disp}px;font-weight:${t.weight};font-family:'${t.family}',sans-serif">${role}</span><code>${t.family} · ${t.size}px · ${t.weight}</code></div>`;
    }).join("");

  // grid + rhythm
  const al = spec.alignment, gp = spec.spacing.gaps;
  const gx = al.xGuides.map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="1080" stroke="#4363d8" stroke-width="2"/>`).join("");
  const gy = (al.yGuides ?? []).map((y) => `<line x1="0" y1="${y}" x2="1920" y2="${y}" stroke="#3cb44b" stroke-width="2"/>`).join("");
  const gridSVG = `<svg viewBox="0 0 1920 1080" class="grid"><rect x="0" y="0" width="1920" height="1080" fill="#fff" stroke="#ddd"/><rect x="${al.margin}" y="${al.margin}" width="${1920 - 2 * al.margin}" height="${1080 - 2 * al.margin}" fill="none" stroke="#bbb" stroke-dasharray="12 8"/>${gx}${gy}</svg>`;
  const rhythm = ["tight", "normal", "loose", "section"].map((k) => `<div class="bar"><span style="width:${Math.min(gp[k], 160)}px"></span><code>${k} ${gp[k]}</code></div>`).join("");

  // blocks (repeatable card templates) — role chips
  const blocks = (spec.blocks ?? []).map((b) => `<div class="block"><b>${esc(b.id)}</b><div class="chips">${b.slots.map((s) => `<span>${s.role}</span>`).join("")}</div></div>`).join("") || "<i>(none)</i>";

  // archetype skeletons (mined patterns)
  const skels = spec.archetypes.map((sk) => {
    const media = [sk.imageZones.filter((z) => z.mockupRef).length && `${sk.imageZones.filter((z) => z.mockupRef).length} mockup`, sk.imageZones.filter((z) => !z.mockupRef).length && `${sk.imageZones.filter((z) => !z.mockupRef).length} image`].filter(Boolean).join(" · ");
    const ex = repByArch[sk.archetype];
    const exImg = ex ? `<figure><img src="../../templates/${dir}/${ex}.svg" loading="lazy"><figcaption>real example</figcaption></figure>` : "";
    return `<div class="ar"><h4>${esc(sk.archetype)} <span>×${sk.support}</span></h4><div class="arpair">${exImg}<figure>${skeletonSVG(sk)}<figcaption>mined pattern</figcaption></figure></div><code>${sk.zones.map((z) => z.id).join(", ")}${media ? " · " + media : ""}</code></div>`;
  }).join("");

  // Decoration language — the theme's actual visual vocabulary (extracted decoration SVGs).
  const decoIds = [...new Set(Object.values(repByArch))].slice(0, 12);
  const decoGallery = decoIds
    .map((name) => `<div class="dec"><img src="${theme}/decorations/${theme}_${name}.svg" loading="lazy"><code>${esc(name)}</code></div>`)
    .join("");

  // mockups
  let mockHtml = "";
  const mdir = resolve(root, theme, "mockups");
  if (existsSync(mdir)) {
    const files = readdirSync(mdir).filter((f) => f.endsWith(".json"));
    mockHtml = files.map((f) => {
      const asset = JSON.parse(readFileSync(resolve(mdir, f), "utf8"));
      return `<div class="mkw"><div class="mkbox" style="background:${spec.colors.bg}">${mockupThumb(asset)}</div><code>${f.replace(".json", "")} · ${Math.round(asset.frameBBox.w)}×${Math.round(asset.frameBBox.h)}</code></div>`;
    }).join("");
  }

  const conv = (spec.relationConventions ?? []).slice(0, 12).map((r) => `${esc(r.pattern)}`).join(", ") || "(none)";

  sections.push(`<section>
    <h2>${theme}<span class="sub">design system · ${sys.layouts.length} slides distilled</span></h2>
    <div class="grid2">
      <div class="box"><h3>Palette</h3><div class="row">${palette}</div><div class="row roles">${roles}</div></div>
      <div class="box"><h3>Type scale</h3>${type}</div>
    </div>
    <div class="grid2">
      <div class="box"><h3>Grid &amp; margin</h3>${gridSVG}<code>x:[${al.xGuides.join(", ")}] · margin ${al.margin}</code></div>
      <div class="box"><h3>Spacing rhythm <small>base ${spec.spacing.baseUnit}</small></h3>${rhythm}<h3 style="margin-top:14px">Hierarchy</h3><code>title:body ${spec.hierarchy.titleToBodyRatio} · conventions: ${conv}</code></div>
    </div>
    <div class="box"><h3>Decoration language <small>the theme's actual visual vocabulary (extracted)</small></h3><div class="decos">${decoGallery}</div></div>
    <div class="box"><h3>Blocks <small>repeatable card templates</small></h3><div class="blocks">${blocks}</div></div>
    <div class="box"><h3>Archetype skeletons <small>real example + the pattern mined across slides (not a copied frame)</small></h3><div class="skels">${skels}</div></div>
    ${mockHtml ? `<div class="box"><h3>Device mockups <small>reusable frames, empty screen = user image slot</small></h3><div class="mocks">${mockHtml}</div></div>` : ""}
  </section>`);
}

const html = `<!doctype html><meta charset="utf-8"><title>Stencil — design systems</title>
<style>
  @font-face{font-family:'Inter';src:url('../../fonts/Inter.ttf');font-display:swap}
  @font-face{font-family:'Open Sans';src:url('../../fonts/OpenSans.ttf');font-display:swap}
  @font-face{font-family:'Neuton';src:url('../../fonts/Neuton.ttf');font-display:swap}
  @font-face{font-family:'Bricolage Grotesque';src:url('../../fonts/BricolageGrotesque.ttf');font-display:swap}
  :root{--b:#e6e6e6}
  *{box-sizing:border-box}
  body{font:14px/1.55 -apple-system,system-ui,sans-serif;margin:0;background:#fafafa;color:#111}
  header{padding:28px 32px;border-bottom:1px solid var(--b);background:#fff}
  header h1{margin:0;font-size:20px} header p{margin:4px 0 0;color:#777}
  section{padding:24px 32px;border-bottom:8px solid #f0f0f0}
  h2{font-size:22px;margin:0 0 16px;display:flex;align-items:baseline;gap:10px;text-transform:capitalize}
  h2 .sub{font-size:12px;color:#999;text-transform:none;font-weight:400}
  h3{font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em;color:#444}
  h3 small{font-weight:400;text-transform:none;letter-spacing:0;color:#aaa;margin-left:6px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .box{background:#fff;border:1px solid var(--b);border-radius:12px;padding:16px;margin-bottom:16px}
  .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .roles{margin-top:10px}
  .sw{display:flex;flex-direction:column;align-items:center;gap:3px}
  .sw span{width:34px;height:34px;border-radius:7px;border:1px solid #ddd;display:block}
  code{font:11px/1.4 ui-monospace,SFMono-Regular,monospace;color:#777}
  .spec{display:flex;align-items:baseline;gap:12px;border-bottom:1px dashed #eee;padding:5px 0}
  .spec .sp{min-width:130px;color:#111}
  .grid{width:100%;border-radius:8px;display:block;margin-bottom:6px}
  .bar{display:flex;align-items:center;gap:10px;margin:4px 0}
  .bar span{height:12px;background:#111;border-radius:3px;display:block}
  .blocks{display:flex;gap:10px;flex-wrap:wrap}
  .block{border:1px solid var(--b);border-radius:8px;padding:8px 10px}
  .block b{font-size:11px}
  .chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
  .chips span{font-size:10px;background:#111;color:#fff;border-radius:4px;padding:1px 6px}
  .decos{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
  .dec img{width:100%;border:1px solid #eee;border-radius:6px;display:block;background:#fff}
  .dec code{display:block;margin-top:3px}
  .skels{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  .ar h4{margin:0 0 6px;font-size:12px;display:flex;gap:6px} .ar h4 span{color:#aaa}
  .arpair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .arpair figure{margin:0} .arpair img{width:100%;border:1px solid #eee;border-radius:6px;display:block;background:#fff}
  .arpair figcaption{font-size:10px;color:#aaa;margin-top:3px;text-align:center}
  .dgm{width:100%;border:1px solid #eee;border-radius:6px;display:block;background:#fff}
  .mocks{display:flex;gap:14px;flex-wrap:wrap}
  .mkw{width:120px} .mkbox{border:1px solid var(--b);border-radius:8px;padding:8px;height:200px;display:flex;align-items:center;justify-content:center}
  .mk{max-height:184px;max-width:100%}
</style>
<header><h1>Stencil — established design systems</h1><p>Each theme's template slides distilled into one reusable system. Nothing here is a copied slide — these are the extracted rules.</p></header>
${sections.join("\n")}`;

const out = resolve(root, "design-system.html");
writeFileSync(out, html, "utf8");
console.log("written:", out);
