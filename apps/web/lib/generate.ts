import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { outlineDeck } from "@stencil/composer";
import { planSlide } from "@stencil/director";
import { solveDeckSlide } from "@stencil/solver";
import { renderComposite } from "@stencil/renderer";
import type { DesignSystemIR, Layout } from "@stencil/ir";
import { resolveTheme } from "./themes";

/**
 * Output stage (DEVDOC ⑤). Server-side deck generation over a baked design
 * system: outline (pick layouts + purpose) → per-slide placement (director) →
 * re-composition (solver) → composite SVG (renderer). The original templates are
 * never read — only the baked system.json + decoration fragments.
 */

/** A theme is any baked slug (built-in or user-imported). */
export type Theme = string;
/** Usable for generation only once its system.json has been baked. */
export function isTheme(v: string): boolean {
  const t = resolveTheme(v);
  return !!t && existsSync(t.systemPath);
}

export interface GeneratedSlide {
  layoutId: string;
  archetype?: string;
  purpose: string;
  svg: string;
  warnings: string[];
}
export interface GeneratedDeck {
  title: string;
  theme: Theme;
  canvas: { w: number; h: number };
  slides: GeneratedSlide[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

export async function generateDeck(theme: Theme, prompt: string, slideCount: number): Promise<GeneratedDeck> {
  const t = resolveTheme(theme);
  if (!t) throw new Error("unknown theme");
  const system = JSON.parse(await readFile(t.systemPath, "utf8")) as DesignSystemIR;

  // No user asset pool yet → restrict to text-complete layouts so image holders
  // never render as empty placeholders. Keeps the deck at template quality.
  const usable: DesignSystemIR = {
    ...system,
    layouts: system.layouts.filter((l) => !l.slots.some((s) => s.type === "image")),
  };
  const byId = new Map<string, Layout>(usable.layouts.map((l) => [l.id, l]));

  const outline = await outlineDeck(usable, prompt, { slides: slideCount });

  const slides = await mapLimit(outline.slides, 3, async (o): Promise<GeneratedSlide | null> => {
    const layout = byId.get(o.layoutId);
    if (!layout) return null;
    const plan = await planSlide(layout, o.purpose, outline.title, prompt, {});
    const rslide = solveDeckSlide(layout, plan, system.tokens, system.canvas);
    const deco = await readFile(resolve(t.decoDir, `${o.layoutId}.svg`), "utf8");
    const svg = renderComposite(rslide, deco);
    return {
      layoutId: o.layoutId,
      ...(layout.archetype ? { archetype: layout.archetype } : {}),
      purpose: o.purpose,
      svg,
      warnings: rslide.warnings,
    };
  });

  return {
    title: outline.title,
    theme,
    canvas: system.canvas,
    slides: slides.filter((s): s is GeneratedSlide => s !== null),
  };
}
