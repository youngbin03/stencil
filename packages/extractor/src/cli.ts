import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Theme } from "@stencil/ir";
import { extractAsset } from "./extract.js";

/**
 * Assetize runner: `extract <path-to-svg>` writes the design system asset JSON
 * and the decoration-only SVG fragment under fixtures/assets/.
 */

const THEME_BY_DIR: Record<string, Theme> = {
  colorfulldesign: "colorful",
  blackdesign: "black",
  greendesign: "green",
};

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: extract <path-to-svg>");
    process.exit(1);
  }

  const abs = resolve(input);
  const svg = readFileSync(abs, "utf8");
  const dir = basename(dirname(abs));
  const theme = THEME_BY_DIR[dir] ?? "colorful";
  const name = basename(abs).replace(/\.svg$/i, "");
  const layoutId = `${theme}_${name}`;

  const outDir = resolve("fixtures/assets", theme);
  mkdirSync(outDir, { recursive: true });
  const decorationRef = `fixtures/assets/${theme}/${name}.decoration.svg`;

  const { asset, decorationSvg, manifest } = extractAsset(svg, {
    templateId: theme,
    theme,
    layoutId,
    decorationRef,
  });

  writeFileSync(resolve(outDir, `${name}.decoration.svg`), decorationSvg, "utf8");
  writeFileSync(resolve(outDir, `${name}.asset.json`), JSON.stringify(asset, null, 2), "utf8");
  writeFileSync(resolve(outDir, `${name}.manifest.json`), JSON.stringify(manifest, null, 2), "utf8");

  console.log("asset:", `${decorationRef.replace(".decoration.svg", ".asset.json")}`);
  console.log("decoration:", decorationRef);
  console.log("tokens.colors:", JSON.stringify(asset.tokens.colors));
  console.log("type roles:", Object.keys(asset.tokens.type).join(", "));
  console.log("defaultSlots:", asset.layouts[0]?.defaultSlots.join(", "));
}

main();
