import type {
  AlignmentGrid, Block, Canvas, CardSpec, DesignSystemIR, FlowDirection, Hierarchy, Region, Role,
  SpacingRhythm, TypeToken,
} from "@stencil/ir";

/**
 * Explicit, structured design grammar (DEVDOC Phase 6). Consolidates the
 * theme's extracted rules into ONE spec the synthesizer consumes — and, crucially,
 * mines a NORMALIZED archetype skeleton per archetype by aggregating the regions of
 * its example slides (median bands as canvas fractions). The skeleton is a design
 * PATTERN, not a copied frame: synthesis instantiates it with new content, so the
 * output reproduces the theme's spatial language without reusing any single slide.
 */

export interface ArchetypeZone {
  id: string;                 // header | title | body | cards | footer
  role?: Role;                // dominant single role (for non-card zones)
  xFrac: [number, number];    // normalized horizontal band [0..1]
  yFrac: [number, number];    // normalized vertical band [0..1]
  flow: FlowDirection;
  block?: string;             // block id when this is a repeatable card row
}

export interface ImageZone {
  xFrac: [number, number];
  yFrac: [number, number];
  ratio: number;              // target aspect (w/h) — user image is cover-cropped to it
  mediaKind?: string;         // photo | device_mockup | avatar | chart_line | logo
  /** When set, this zone is a device mockup: stamp this frame asset and drop the
   *  user image into its screen (clipped). The frame bbox is the zone box. */
  mockupRef?: string;
}

/** How much decoration this archetype's examples actually carry — so synthesis
 * reproduces the theme's habit instead of forcing a shape on every slide. */
export interface DecorationProfile {
  /** Median non-background decoration area as a fraction of the canvas (0 = none). */
  coverage: number;
  /** Median count of non-background decoration elements. */
  count: number;
}

export interface ArchetypeSkeleton {
  archetype: string;
  support: number;            // how many example slides backed this pattern
  zones: ArchetypeZone[];
  /** Image cells this archetype expects (mined from example image slots). Empty
   *  for text-only archetypes. Filled only when the user supplies images. */
  imageZones: ImageZone[];
  /** Decoration habit of this archetype's examples (amount, not forced). */
  decoration: DecorationProfile;
}

export interface GrammarSpec {
  theme: string;
  canvas: Canvas;
  palette: string[];
  colors: { primary: string; accent: string; bg: string; text: string };
  type: Record<string, TypeToken>;
  spacing: SpacingRhythm;
  alignment: AlignmentGrid;
  hierarchy: Hierarchy;
  blocks: Block[];
  /** Measured card internals keyed by role signature (e.g. "kpi/caption"). */
  cardSpecs: Record<string, CardSpec>;
  relationConventions: { pattern: string; support: number }[];
  archetypes: ArchetypeSkeleton[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function mode<T>(xs: T[]): T | undefined {
  const c = new Map<T, number>();
  let best: T | undefined, bestN = 0;
  for (const x of xs) { const n = (c.get(x) ?? 0) + 1; c.set(x, n); if (n > bestN) { bestN = n; best = x; } }
  return best;
}

interface ImgSlot { xFrac: number; yFrac: number; wFrac: number; hFrac: number; ratio: number; mediaKind?: string; mockupRef?: string }

/** Cluster example image slots into representative image cells (columns). */
function mineImageZones(slots: ImgSlot[]): ImageZone[] {
  if (slots.length === 0) return [];
  const cols: ImgSlot[][] = [];
  for (const s of [...slots].sort((a, b) => a.xFrac - b.xFrac)) {
    const col = cols.find((c) => Math.abs(c[0]!.xFrac - s.xFrac) < 0.1);
    if (col) col.push(s); else cols.push([s]);
  }
  return cols.map((c) => {
    const x = median(c.map((s) => s.xFrac)), w = median(c.map((s) => s.wFrac));
    const y = median(c.map((s) => s.yFrac)), h = median(c.map((s) => s.hFrac));
    const zone: ImageZone = { xFrac: [x, x + w], yFrac: [y, y + h], ratio: median(c.map((s) => s.ratio)) };
    const mk = mode(c.map((s) => s.mediaKind).filter(Boolean));
    if (mk) zone.mediaKind = mk;
    const ref = mode(c.map((s) => s.mockupRef).filter(Boolean));
    if (ref) zone.mockupRef = ref;
    return zone;
  });
}

/** Aggregate the regions of one archetype's example slides into a median skeleton. */
function mineSkeleton(archetype: string, examples: { regions: Region[]; imgSlots: ImgSlot[]; decoCoverage: number; decoCount: number; canvas: Canvas }[]): ArchetypeSkeleton | undefined {
  const byZone = new Map<string, { x0: number[]; x1: number[]; y0: number[]; y1: number[]; flow: FlowDirection[]; block: (string | undefined)[]; role: (Role | undefined)[] }>();
  for (const ex of examples) {
    for (const r of ex.regions) {
      const z = byZone.get(r.id) ?? { x0: [], x1: [], y0: [], y1: [], flow: [], block: [], role: [] };
      z.x0.push(r.bbox.x / ex.canvas.w);
      z.x1.push((r.bbox.x + r.bbox.w) / ex.canvas.w);
      z.y0.push(r.bbox.y / ex.canvas.h);
      z.y1.push((r.bbox.y + r.bbox.h) / ex.canvas.h);
      z.flow.push(r.flow);
      z.block.push(r.blockId);
      byZone.set(r.id, z);
    }
  }
  const zones: ArchetypeZone[] = [];
  for (const [id, z] of byZone) {
    if (z.x0.length === 0) continue;
    const zone: ArchetypeZone = {
      id,
      xFrac: [Math.max(0, median(z.x0)), Math.min(1, median(z.x1))],
      yFrac: [Math.max(0, median(z.y0)), Math.min(1, median(z.y1))],
      flow: mode(z.flow) ?? "column",
    };
    const block = mode(z.block.filter((b): b is string => !!b));
    if (block) zone.block = block;
    zones.push(zone);
  }
  zones.sort((a, b) => a.yFrac[0] - b.yFrac[0]);
  const imageZones = mineImageZones(examples.flatMap((e) => e.imgSlots));
  const decoration: DecorationProfile = {
    coverage: median(examples.map((e) => e.decoCoverage)),
    count: Math.round(median(examples.map((e) => e.decoCount))),
  };
  if (zones.length === 0 && imageZones.length === 0) return undefined;
  return { archetype, support: examples.length, zones, imageZones, decoration };
}

export function buildGrammarSpec(system: DesignSystemIR): GrammarSpec {
  // One measured card spec per role signature — the theme's real card internals.
  const cardSpecs: Record<string, CardSpec> = {};
  for (const L of system.layouts) {
    if (L.cardSpec) {
      const key = L.cardSpec.roles.join("/");
      if (!cardSpecs[key]) cardSpecs[key] = L.cardSpec;
    }
  }

  // Mine a normalized skeleton per archetype from its example slides' regions.
  const canvasArea = system.canvas.w * system.canvas.h;
  const byArch = new Map<string, { regions: Region[]; imgSlots: ImgSlot[]; decoCoverage: number; decoCount: number; canvas: Canvas }[]>();
  for (const L of system.layouts) {
    const a = L.archetype ?? "other";
    if (!L.regions?.length && !L.slots.some((s) => s.type === "image")) continue;
    // Image zones. For a device mockup the FRAME rect (the chrome) is the placement
    // box and carries mockupRef; the screen path's geometry comes from the asset, so
    // we skip clip slots. Plain photos pass through unchanged.
    const imgs = L.slots.filter((s) => s.type === "image");
    const screens = imgs.filter((s) => s.clip);
    const contains = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
      a.x <= b.x + 1 && a.y <= b.y + 1 && a.x + a.w >= b.x + b.w - 1 && a.y + a.h >= b.y + b.h - 1;
    const imgSlots: ImgSlot[] = imgs.flatMap((s) => {
      if (s.clip) return []; // screen — geometry supplied by the mockup asset
      const isFrame = !!L.mockupRef && screens.some((sc) => contains(s.bbox, sc.bbox));
      const z: ImgSlot = {
        xFrac: s.bbox.x / system.canvas.w, yFrac: s.bbox.y / system.canvas.h,
        wFrac: s.bbox.w / system.canvas.w, hFrac: s.bbox.h / system.canvas.h,
        ratio: s.bbox.h > 0 ? s.bbox.w / s.bbox.h : 1,
        ...(s.mediaKind ? { mediaKind: s.mediaKind } : {}),
      };
      if (isFrame && L.mockupRef) z.mockupRef = L.mockupRef;
      return [z];
    });
    const deco = (L.decorationModel?.elements ?? []).filter((d) => d.kind !== "background");
    const decoCoverage = deco.reduce((s, d) => s + Math.min(d.bbox.w * d.bbox.h, canvasArea), 0) / canvasArea;
    (byArch.get(a) ?? byArch.set(a, []).get(a)!).push({ regions: L.regions ?? [], imgSlots, decoCoverage, decoCount: deco.length, canvas: system.canvas });
  }
  const archetypes: ArchetypeSkeleton[] = [];
  for (const [a, exs] of byArch) {
    const sk = mineSkeleton(a, exs);
    if (sk) archetypes.push(sk);
  }
  archetypes.sort((a, b) => b.support - a.support);

  return {
    theme: system.theme,
    canvas: system.canvas,
    palette: system.tokens.palette ?? [],
    colors: system.tokens.colors,
    type: system.tokens.type,
    spacing: system.grammar.spacingRhythm,
    alignment: system.grammar.alignmentGrid,
    hierarchy: system.grammar.hierarchy,
    blocks: system.blocks ?? [],
    cardSpecs,
    relationConventions: system.relationConventions
      ?? system.grammar.groups?.map((g) => ({ pattern: g.roles.join("+"), support: 1 }))
      ?? [],
    archetypes,
  };
}
