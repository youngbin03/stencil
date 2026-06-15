import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Theme } from "@stencil/ir";
import { classifySlide } from "@stencil/classifier";
import { extractThemeSystem, type ClassifyFn, type SlideInput } from "./extract.js";

/**
 * Assetize runner: `extract <theme-dir>` builds ONE design system for the theme
 * and writes system.json + per-layout decoration SVGs under fixtures/assets.
 */

const THEME_BY_DIR: Record<string, Theme> = {
  colorfulldesign: "colorful",
  blackdesign: "black",
  greendesign: "green",
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noClassify = args.includes("--no-classify");
  const input = args.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("usage: extract <theme-dir> [--no-classify]");
    process.exit(1);
  }

  const abs = resolve(input);
  const dirName = basename(abs);
  const theme = THEME_BY_DIR[dirName] ?? "colorful";

  const files = readdirSync(abs).filter((f) => f.toLowerCase().endsWith(".svg")).sort();
  const slides: SlideInput[] = files.map((f) => ({
    name: f.replace(/\.svg$/i, ""),
    svg: readFileSync(resolve(abs, f), "utf8"),
  }));

  const outDir = resolve("fixtures/assets", theme);
  const decoDir = resolve(outDir, "decorations");
  mkdirSync(decoDir, { recursive: true });

  const useVision = !noClassify && Boolean(process.env.ANTHROPIC_API_KEY);
  const classify: ClassifyFn | undefined = useVision
    ? (svg, slots) => classifySlide(svg, slots)
    : undefined;
  console.log(useVision ? "classification: Claude vision (Phase 2.5)" : "classification: id-rules only");

  const { system, decorations } = await extractThemeSystem(slides, {
    theme,
    decorationRef: (layoutId) => `fixtures/assets/${theme}/decorations/${layoutId}.svg`,
    ...(classify ? { classify } : {}),
  });

  writeFileSync(resolve(outDir, "system.json"), JSON.stringify(system, null, 2), "utf8");
  for (const d of decorations) writeFileSync(resolve(decoDir, `${d.layoutId}.svg`), d.svg, "utf8");

  console.log(`theme: ${theme}  (${slides.length} slides -> 1 design system)`);
  console.log("shared colors:", JSON.stringify(system.tokens.colors));
  console.log("palette:", system.tokens.palette.join(", "));
  console.log("shared type:", Object.entries(system.tokens.type).map(([r, t]) => `${r} ${t.family}/${t.size}`).join(" · "));
  console.log("grammar grid x:", JSON.stringify(system.grammar.alignmentGrid.xGuides), "rhythm:", JSON.stringify(system.grammar.spacingRhythm.gaps));
  console.log("grouping conventions:", system.grammar.groups.map((g) => g.roles.join("+")).join(", ") || "(none)");
  const archetypes = system.layouts.map((l) => l.archetype).filter(Boolean);
  if (archetypes.length) {
    const counts = archetypes.reduce<Record<string, number>>((m, a) => ((m[a!] = (m[a!] ?? 0) + 1), m), {});
    console.log("archetypes:", Object.entries(counts).map(([a, n]) => `${a}×${n}`).join(", "));
  }
  const media = system.layouts.flatMap((l) => l.slots).filter((s) => s.mediaKind);
  if (media.length) console.log("media slots:", media.map((s) => `${s.mediaKind}${s.replaceable ? "(replaceable)" : ""}`).join(", "));
  console.log("layouts:", system.layouts.length, "→", resolve(outDir, "system.json"));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
