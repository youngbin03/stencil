import { readFileSync, writeFileSync } from "node:fs";
const m = JSON.parse(readFileSync("scripts/.thumbs-manifest.json", "utf8"));
const names = { colorful: "Colorful", black: "Black", green: "Green" };
const num = (id) => parseInt(id.replace(/\D/g, ""), 10) || 0;
let sql = "insert into public.themes (slug,name,baked) values " +
  Object.keys(m).map((s) => `('${s}','${names[s] ?? s}',true)`).join(",") +
  " on conflict (slug) do update set name=excluded.name, baked=excluded.baked;\n";
const rows = [];
for (const [t, ids] of Object.entries(m)) for (const id of ids) rows.push(`('${t}','${id}','${t}/${id}.png',${num(id)})`);
sql += "insert into public.template_slides (theme,slide_id,path,ord) values " + rows.join(",") +
  " on conflict (theme,slide_id) do update set path=excluded.path, ord=excluded.ord;";
writeFileSync("/tmp/seed.sql", sql);
console.log("wrote", sql.length, "chars,", rows.length, "slides");
