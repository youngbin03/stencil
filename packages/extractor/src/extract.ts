import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import type {
  Canvas,
  DesignSystemIR,
  Layout,
  LayoutArchetype,
  ManifestSlot,
  Palette,
  SlotGroup,
  Theme,
  Tokens,
  TypeScale,
  TypeToken,
} from "@stencil/ir";
import { normalizeSvg } from "@stencil/normalizer";
import { extractGroups, extractThemeGrammar, placeSlots, textSlots, type SlotLabelLite } from "./grammar.js";
import { buildRelationGraph, extractDecorationModel, relationConventions } from "./relations.js";
import { extractBlocks, extractCardSpec, extractRegions } from "./layout.js";
import type { Block, RelationGraph } from "@stencil/ir";

/** Injected vision classifier (Phase 2.5). Returns null on failure → id-rule fallback. */
export type ClassifyFn = (
  svg: string,
  slots: ManifestSlot[],
) => Promise<{ archetype: LayoutArchetype; labels: Map<string, SlotLabelLite> } | null>;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

/**
 * Assetize stage (DEVDOC ②). Builds ONE design system per theme: shared tokens
 * and grammar measured across every slide, plus each slide as a layout and its
 * decoration fragment. Generation later reads this system only — never the SVGs.
 */

const DEFAULT_LINE_HEIGHT: Record<string, number> = {
  title: 1.05,
  headline: 1.1,
  subtitle: 1.2,
  body: 1.4,
  caption: 1.2,
};
const DEFAULT_SPACING_SCALE = [8, 16, 24, 48, 96];

function num(el: Element, attr: string): number | undefined {
  const v = el.getAttribute(attr);
  if (v === null || v === "") return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Most frequent value (ties → first seen). */
function modeOf<T>(values: T[]): T | undefined {
  const count = new Map<T, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestN = 0;
  for (const [v, n] of count) if (n > bestN) ((best = v), (bestN = n));
  return best;
}

/** Distinct values ordered by frequency desc. */
function byFrequency<T>(values: T[]): T[] {
  const count = new Map<T, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

interface SlideFills {
  background?: string;
  shapeFills: string[];
}

/** Collect solid fills from one slide, separating the full-canvas background. */
function collectFills(doc: ReturnType<DOMParser["parseFromString"]>, canvasW: number): SlideFills {
  let background: string | undefined;
  const shapeFills: string[] = [];
  for (const tag of ["rect", "path", "circle", "ellipse", "polygon"]) {
    const els = doc.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) {
      const el = els[i]!;
      const fill = el.getAttribute("fill");
      if (!fill || fill === "none" || fill.startsWith("url(")) continue;
      if (tag === "rect" && (num(el, "width") ?? 0) >= canvasW * 0.98 && background === undefined) {
        background = fill;
        continue;
      }
      shapeFills.push(fill);
    }
  }
  return background === undefined ? { shapeFills } : { background, shapeFills };
}

/** Shared type scale: per role, the most common font-size (tie → larger) sets the rank. */
function extractType(slots: ManifestSlot[]): TypeScale {
  const byRole = new Map<string, ManifestSlot[]>();
  for (const s of textSlots(slots)) (byRole.get(s.role) ?? byRole.set(s.role, []).get(s.role)!).push(s);

  const tokenFor = (group: ManifestSlot[]): TypeToken => {
    const size = modeOf(group.map((s) => s.fontSize ?? 16)) ?? 16;
    const rep = group.find((s) => (s.fontSize ?? 16) === size) ?? group[0]!;
    return {
      family: rep.fontFamily ?? "sans-serif",
      size,
      weight: rep.fontWeight ?? 400,
      lineHeight: DEFAULT_LINE_HEIGHT[rep.role] ?? 1.2,
    };
  };

  const scale: Record<string, TypeToken> = {};
  for (const [role, group] of byRole) scale[role] = tokenFor(group);

  const allSorted = textSlots(slots).sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0));
  const fallback: TypeToken = allSorted[0]
    ? tokenFor([allSorted[0]])
    : { family: "sans-serif", size: 16, weight: 400, lineHeight: 1.2 };
  const ensure = (role: "title" | "subtitle" | "body"): TypeToken => scale[role] ?? fallback;
  return { ...scale, title: ensure("title"), subtitle: ensure("subtitle"), body: ensure("body") };
}

function extractColors(backgrounds: string[], shapeFills: string[], textColors: string[]): Palette {
  const bg = modeOf(backgrounds);
  const text = modeOf(textColors);
  const accent = modeOf(shapeFills.filter((c) => c !== bg));
  return {
    primary: text ?? "#000000",
    accent: accent ?? text ?? "#000000",
    bg: bg ?? "#FFFFFF",
    text: text ?? "#000000",
  };
}

/** Decoration-only SVG: remove every <text> node, keep shapes/decoration. */
export function extractDecoration(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const texts = doc.getElementsByTagName("text");
  const nodes: Element[] = [];
  for (let i = 0; i < texts.length; i++) nodes.push(texts[i]!);
  for (const n of nodes) n.parentNode?.removeChild(n);
  return new XMLSerializer().serializeToString(doc);
}

export interface SlideInput {
  /** File name without extension; used for the layout id. */
  name: string;
  svg: string;
}

export interface ThemeDecoration {
  layoutId: string;
  svg: string;
}

export interface ThemeResult {
  system: DesignSystemIR;
  decorations: ThemeDecoration[];
}

export interface ThemeOptions {
  theme: Theme;
  /** Builds the stored decoration ref from a layout id. */
  decorationRef: (layoutId: string) => string;
  /** Optional vision classifier (Phase 2.5). When absent, id-rule roles are kept. */
  classify?: ClassifyFn;
  /** Max concurrent classify calls. */
  concurrency?: number;
}

interface Prepared {
  layoutId: string;
  slide: SlideInput;
  manifest: ReturnType<typeof normalizeSvg>;
  background: string | undefined;
  shapeFills: string[];
}

/** Build one design system from all slides of a theme. */
export async function extractThemeSystem(slides: SlideInput[], opts: ThemeOptions): Promise<ThemeResult> {
  // 1) Deterministic prep: normalize + collect fills per slide.
  const prepared: Prepared[] = slides.map((slide) => {
    const layoutId = `${opts.theme}_${slide.name}`;
    const manifest = normalizeSvg(slide.svg, {
      layoutId,
      theme: opts.theme,
      baseTemplate: opts.decorationRef(layoutId),
    });
    const doc = new DOMParser().parseFromString(slide.svg, "image/svg+xml");
    const fills = collectFills(doc, manifest.canvas.w);
    return { layoutId, slide, manifest, background: fills.background, shapeFills: fills.shapeFills };
  });

  // 2) Vision classification (optional). Overrides slot roles + tags media/archetype.
  const archetypes = new Map<string, LayoutArchetype>();
  const labelsByLayout = new Map<string, Map<string, SlotLabelLite>>();
  if (opts.classify) {
    const results = await mapLimit(prepared, opts.concurrency ?? 4, (p) =>
      opts.classify!(p.slide.svg, p.manifest.slots).catch(() => null),
    );
    results.forEach((res, i) => {
      if (!res) return;
      const p = prepared[i]!;
      archetypes.set(p.layoutId, res.archetype);
      labelsByLayout.set(p.layoutId, res.labels);
      for (const slot of p.manifest.slots) {
        const role = res.labels.get(slot.id)?.role;
        if (role) slot.role = role; // role drives tokens + grammar below
      }
    });
  }

  // 3) Aggregate into one design system.
  const allSlots: ManifestSlot[] = [];
  const slidesTextSlots: ManifestSlot[][] = [];
  const perSlideGroups: SlotGroup[][] = [];
  const backgrounds: string[] = [];
  const shapeFills: string[] = [];
  const decorations: ThemeDecoration[] = [];
  const layouts: Layout[] = [];
  const convInput: { graph: RelationGraph; slotRole: Map<string, string> }[] = [];
  let canvas: Canvas = { w: 0, h: 0 };

  for (const p of prepared) {
    canvas = p.manifest.canvas;
    if (p.background) backgrounds.push(p.background);
    shapeFills.push(...p.shapeFills);

    const text = textSlots(p.manifest.slots);
    const groups = extractGroups(text);
    allSlots.push(...p.manifest.slots);
    slidesTextSlots.push(text);
    perSlideGroups.push(groups);

    // Phase 4.5: decoration decomposition + relation graph (deterministic).
    const decoSvg = extractDecoration(p.slide.svg);
    const decorationRef = opts.decorationRef(p.layoutId);
    const bg = p.background ?? "#FFFFFF";
    const decorationModel = extractDecorationModel(decoSvg, p.layoutId, decorationRef, p.manifest.canvas, bg);
    const relationGraph = buildRelationGraph(p.layoutId, p.manifest.slots, decorationModel.elements, p.manifest.canvas);

    const layout: Layout = {
      id: p.layoutId,
      decorationRef,
      background: bg,
      slots: placeSlots(p.manifest.slots, groups, labelsByLayout.get(p.layoutId)),
      decorationModel,
      relationGraph,
      regions: [], // filled after grammar (needs spacing rhythm)
      defaultSlots: text.map((s) => s.id),
    };
    const archetype = archetypes.get(p.layoutId);
    if (archetype) layout.archetype = archetype;
    layouts.push(layout);
    decorations.push({ layoutId: p.layoutId, svg: decoSvg });
    convInput.push({ graph: relationGraph, slotRole: new Map(p.manifest.slots.map((s) => [s.id, s.role])) });
  }

  const type = extractType(allSlots);
  const textColors = textSlots(allSlots)
    .map((s) => s.color)
    .filter((c): c is string => Boolean(c));
  const grammar = extractThemeGrammar(slidesTextSlots, type, perSlideGroups);

  // Re-composition inputs: semantic regions (per layout) + reusable blocks (theme).
  const blockById = new Map<string, Block>();
  prepared.forEach((p, i) => {
    const layout = layouts[i]!;
    layout.regions = extractRegions(p.manifest.slots, layout.relationGraph, grammar, p.manifest.canvas, layout.decorationModel);
    const cardSpec = extractCardSpec(p.manifest.slots, layout.relationGraph, layout.decorationModel);
    if (cardSpec) layout.cardSpec = cardSpec;
    for (const b of extractBlocks(p.manifest.slots, layout.relationGraph)) blockById.set(b.id, b);
  });

  const tokens: Tokens = {
    fontFamily: type.body.family,
    colors: extractColors(backgrounds, shapeFills, textColors),
    palette: byFrequency([...backgrounds, ...shapeFills, ...textColors]),
    type,
    spacing: { unit: grammar.spacingRhythm.baseUnit, scale: DEFAULT_SPACING_SCALE },
  };

  const system: DesignSystemIR = {
    templateId: opts.theme,
    theme: opts.theme,
    version: 1,
    canvas,
    tokens,
    grammar,
    relationConventions: relationConventions(convInput),
    blocks: [...blockById.values()],
    layouts,
  };

  return { system, decorations };
}
