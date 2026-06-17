import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { placeMockup } from "../packages/normalizer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

// Build a self-contained colorful design-system inspector page for GitHub Pages.
// The board (ds-colorful.png) is committed; decoration + mockup thumbnails are
// rasterized and base64-inlined so the page has NO external (fixtures) dependency.
const theme = "colorful";
const sys = JSON.parse(readFileSync(`fixtures/assets/${theme}/system.json`, "utf8"));
const b64 = (svg) => "data:image/png;base64," + rasterize(svg, 560).toString("base64");

// representative decoration per archetype (deduped)
const repByArch = {};
for (const L of sys.layouts) { const a = L.archetype; if (a && a !== "other" && !repByArch[a]) repByArch[a] = L.id; }
const decoDir = `fixtures/assets/${theme}/decorations`;
let decoHtml = "";
for (const [arch, id] of Object.entries(repByArch).slice(0, 8)) {
  const p = `${decoDir}/${id}.svg`;
  if (!existsSync(p)) continue;
  try { decoHtml += `<figure><img src="${b64(readFileSync(p, "utf8"))}" loading="lazy"><figcaption>${arch}</figcaption></figure>`; } catch {}
}

// device mockups → rasterized thumbnails
let mockHtml = "";
const mdir = `fixtures/assets/${theme}/mockups`;
if (existsSync(mdir)) {
  for (const f of readdirSync(mdir).filter((f) => f.endsWith(".json"))) {
    const a = JSON.parse(readFileSync(`${mdir}/${f}`, "utf8"));
    const b = a.frameBBox;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${sys.tokens.colors.bg}"/><defs>${a.defs}</defs>${a.body}</svg>`;
    try { mockHtml += `<figure><img src="${b64(svg)}" loading="lazy"><figcaption>${Math.round(b.w)}×${Math.round(b.h)}</figcaption></figure>`; } catch {}
  }
}

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Stencil — colorful design system</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap"/>
<style>
  body{font:16px/1.6 Inter,-apple-system,system-ui,sans-serif;color:#0a0a0a;margin:0;background:#fafafa;letter-spacing:-.01em}
  .wrap{max-width:1080px;margin:0 auto;padding:0 28px}
  header{padding:44px 0 24px;border-bottom:1px solid #ececec}
  h1{font-size:30px;letter-spacing:-.03em;margin:0 0 8px}
  p.lead{color:#6b6b6b;max-width:760px;margin:0}
  a.back{display:inline-block;margin-top:14px;font-size:13px;color:#2b6fff;text-decoration:none}
  section{padding:34px 0;border-top:1px solid #ececec}
  h2{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;margin:0 0 14px}
  .board{width:100%;border:1px solid #e5e5e5;border-radius:14px;display:block;background:#fff}
  .grid{display:grid;gap:14px}
  .decos{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
  .mocks{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
  figure{margin:0}
  .decos img{width:100%;border:1px solid #eee;border-radius:8px;display:block;background:#fff}
  .mocks figure{border:1px solid #e5e5e5;border-radius:10px;padding:8px;background:${sys.tokens.colors.bg};text-align:center}
  .mocks img{max-height:200px;max-width:100%}
  figcaption{font-size:11px;color:#999;margin-top:4px}
  footer{color:#999;font-size:13px;padding:30px 0 60px;text-align:center}
</style></head><body><div class="wrap">
<header>
  <h1>Colorful — distilled design system</h1>
  <p class="lead">colorful 테마의 슬라이드들을 하나의 재사용 디자인 시스템으로 정리한 결과입니다. 복사한 슬라이드가 아니라 추출한 규칙 — 팔레트, 타입 스케일, 그리드·리듬, 아키타입 골격(실제 예시와 mined 패턴), 장식 언어, 디바이스 목업.</p>
  <a class="back" href="portfolio.html">← 프로젝트 리포트로 돌아가기</a>
</header>
<section>
  <h2>System board</h2>
  <img class="board" src="assets/ds-colorful.png" alt="colorful design system board"/>
</section>
<section>
  <h2>Decoration language · 테마가 실제로 쓰는 장식</h2>
  <div class="grid decos">${decoHtml || "<p>(none)</p>"}</div>
</section>
<section>
  <h2>Device mockups · 재사용 프레임 (빈 화면 = 사용자 이미지 자리)</h2>
  <div class="grid mocks">${mockHtml || "<p>(none)</p>"}</div>
</section>
<footer>Stencil · 디자인 문법 기반 슬라이드 합성 — <a href="https://github.com/youngbin03/stencil" style="color:#2b6fff">github.com/youngbin03/stencil</a></footer>
</div></body></html>`;

writeFileSync("docs/design-system.html", html, "utf8");
console.log("docs/design-system.html", (html.length / 1024 / 1024).toFixed(2), "MB", "| decos:", (decoHtml.match(/figure/g)||[]).length/2, "mocks:", (mockHtml.match(/figure/g)||[]).length/2);
