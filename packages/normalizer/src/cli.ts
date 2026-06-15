import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Theme } from "@stencil/ir";
import { normalizeSvg } from "./normalize.js";

/**
 * Phase 0 PoC runner: `normalize <path-to-svg>` prints the SlotManifest JSON.
 * layoutId/theme are derived from the file path.
 */

const THEME_BY_DIR: Record<string, Theme> = {
  colorfulldesign: "colorful",
  blackdesign: "black",
  greendesign: "green",
};

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: normalize <path-to-svg>");
    process.exit(1);
  }

  const abs = resolve(input);
  const svg = readFileSync(abs, "utf8");
  const dir = basename(dirname(abs));
  const theme = THEME_BY_DIR[dir] ?? "colorful";
  const layoutId = `${theme}_${basename(abs).replace(/\.svg$/i, "")}`;

  const manifest = normalizeSvg(svg, {
    layoutId,
    theme,
    baseTemplate: input,
  });

  console.log(JSON.stringify(manifest, null, 2));
}

main();
