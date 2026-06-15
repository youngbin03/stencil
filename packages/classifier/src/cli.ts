import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Theme } from "@stencil/ir";
import { normalizeSvg } from "@stencil/normalizer";
import { classifySlide } from "./classify.js";

/** Test runner: `classify <path-to-svg>` prints the vision classification. */

const THEME_BY_DIR: Record<string, Theme> = {
  colorfulldesign: "colorful",
  blackdesign: "black",
  greendesign: "green",
};

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: classify <path-to-svg>");
    process.exit(1);
  }
  const abs = resolve(input);
  const svg = readFileSync(abs, "utf8");
  const theme = THEME_BY_DIR[basename(dirname(abs))] ?? "colorful";
  const name = basename(abs).replace(/\.svg$/i, "");

  const manifest = normalizeSvg(svg, { layoutId: `${theme}_${name}`, theme, baseTemplate: input });
  const slots = manifest.slots;

  console.log(`classifying ${theme}/${name} — ${slots.length} slots ...`);
  const result = await classifySlide(svg, slots);

  console.log(`archetype: ${result.archetype}`);
  slots.forEach((s, i) => {
    const l = result.labels.get(s.id);
    const extra = l?.mediaKind ? ` [${l.mediaKind}${l.replaceable ? ", replaceable" : ""}]` : "";
    console.log(`  ${String(i + 1).padStart(2)}  "${s.id}"  id-guess=${s.role}  ->  ${l?.role ?? "?"}${extra}${l?.note ? `  (${l.note})` : ""}`);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
