import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

// Rasterize each builtin template to a small PNG and upload it to Supabase
// Storage (public bucket `templates`), so the deployed viewer can show previews
// without shipping the huge raw SVGs. Anon key is a public client key.
const SUPABASE_URL = "https://qtbdeajcbnhcemeqaunt.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0YmRlYWpjYm5oY2VtZXFhdW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjYwMDksImV4cCI6MjA5NzM0MjAwOX0.iBBeicSCr5Sq-VZI2X6pIk_Pc0IA2celrfuHBTclicU";
const THEME_DIR = { colorful: "colorfulldesign", black: "blackdesign", green: "greendesign" };
const MAX = 15 * 1024 * 1024; // skip oversized SVGs (embedded raster) to avoid OOM

async function upload(path, png) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/templates/${path}`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "image/png", "x-upsert": "true" },
    body: png,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

const manifest = {};
for (const [theme, dir] of Object.entries(THEME_DIR)) {
  const src = `templates/${dir}`;
  if (!existsSync(src)) continue;
  const ids = [];
  for (const f of readdirSync(src).filter((f) => f.toLowerCase().endsWith(".svg")).sort()) {
    const id = f.replace(/\.svg$/i, "");
    const p = resolve(src, f);
    if (statSync(p).size > MAX) { console.log("skip (too big):", theme, id); continue; }
    try {
      const png = rasterize(readFileSync(p, "utf8"), 512);
      await upload(`${theme}/${id}.png`, png);
      ids.push(id);
      process.stdout.write(".");
    } catch (e) { console.log("\nfail:", theme, id, e?.message); }
  }
  manifest[theme] = ids;
  console.log(`\n${theme}: ${ids.length} uploaded`);
}
writeFileSync("scripts/.thumbs-manifest.json", JSON.stringify(manifest, null, 2));
console.log("manifest → scripts/.thumbs-manifest.json");
