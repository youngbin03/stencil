import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Curated gallery of presentable generated slides (skips dev/debug artifacts).
const root = resolve("fixtures/out");
const groups = [
  ["Data-viz (latest) — timeline / metric / steps", "viz", (f) => /_(timeline|metric|steps)\.png$/.test(f)],
  ["Synthesis results — across themes & archetypes", "portfolio", () => true],
  ["Device mockups (synthesized)", "mockup-verify", (f) => !f.includes("other")],
  ["Pulse deck (synthesis)", "phase6deck", () => true],
  ["Synthesis singles", "phase6synth", () => true],
  ["Image placement", "phase6img", () => true],
  ["Showcase (filler)", "showcase", (f) => !f.includes("undefined")],
];
let body = "";
let count = 0;
for (const [title, dir, keep] of groups) {
  const d = resolve(root, dir);
  if (!existsSync(d)) continue;
  const files = readdirSync(d).filter((f) => f.endsWith(".png") && keep(f)).sort();
  if (!files.length) continue;
  body += `<h2>${title} <small>${dir}/ · ${files.length}</small></h2><div class="g">`;
  for (const f of files) {
    const id = `${dir}/${f}`;
    body += `<figure><label><input type="checkbox" data-id="${id}"><img src="${id}"></label><figcaption>${f.replace(/\.png$/, "")}</figcaption></figure>`;
    count++;
  }
  body += `</div>`;
}

const html = `<!doctype html><meta charset="utf-8"><title>All generated slides</title>
<style>
  body{font:14px system-ui;margin:0;background:#fafafa;color:#111}
  header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e5e5e5;padding:14px 24px;z-index:5;display:flex;gap:16px;align-items:center}
  header h1{font-size:16px;margin:0} #picks{font:12px ui-monospace,monospace;color:#1f6feb}
  main{padding:8px 24px 60px}
  h2{font-size:14px;margin:24px 0 10px;color:#444} h2 small{color:#aaa;font-weight:400}
  .g{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  figure{margin:0} label{cursor:pointer;display:block}
  img{width:100%;border:1px solid #ddd;border-radius:8px;display:block}
  input{position:absolute;margin:8px}
  label:has(:checked) img{outline:3px solid #1f6feb;outline-offset:2px}
  figcaption{font:11px ui-monospace,monospace;color:#777;margin-top:4px;word-break:break-all}
</style>
<header><h1>All generated slides · ${count}</h1><span>체크해서 고르세요 →</span><span id="picks">(none)</span></header>
<main>${body}</main>
<script>
  const out=document.getElementById('picks');
  document.addEventListener('change',()=>{const p=[...document.querySelectorAll('input:checked')].map(i=>i.dataset.id);out.textContent=p.length?p.join('  '):'(none)';});
</script>`;
const outPath = resolve(root, "gallery.html");
writeFileSync(outPath, html, "utf8");
console.log("written:", outPath, "·", count, "slides");
