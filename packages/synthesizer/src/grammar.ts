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

/** A learned decoration "recipe" for an archetype: what kind of shape, where it
 *  sits, how strong/large, in which palette role — and which real shape fragments
 *  carry it. Transfers the extracted decoration grammar (kind/salience/anchor) into
 *  the synthesis stage so placement isn't purely geometric. */
export interface DecoTreatment {
  kind: string;          // emphasis | accent | frame | texture | ...
  anchor: string;        // bottom-right | left | top | center | ... (where it sits)
  salience: number;      // 0..1 visual weight → size/strength
  sizeFrac: number;      // median on-canvas area / canvas
  colorRole: "primary" | "accent" | "secondary";
  shapeIds: string[];    // DecoFrag ids (layout ids) whose shape realises this
  support: number;       // how many example elements backed it
}

/** How much decoration this archetype's examples carry + the learned treatments. */
export interface DecorationProfile {
  /** Median non-background decoration area as a fraction of the canvas (0 = none). */
  coverage: number;
  /** Median count of non-background decoration elements. */
  count: number;
  /** Learned decoration recipes (most common first). */
  treatments: DecoTreatment[];
}

interface DecoEl { kind: string; bbox: { x: number; y: number; w: number; h: number }; salience?: number; color?: string; layoutId: string }

/** Which quadrant/edge an element's (clamped) centre falls in. */
function anchorOf(b: DecoEl["bbox"], cw: number, ch: number): string {
  const cx = Math.min(Math.max((b.x + b.w / 2) / cw, 0), 1);
  const cy = Math.min(Math.max((b.y + b.h / 2) / ch, 0), 1);
  const hx = cx < 0.4 ? "left" : cx > 0.6 ? "right" : "center";
  const vy = cy < 0.4 ? "top" : cy > 0.6 ? "bottom" : "mid";
  if (hx === "center" && vy === "mid") return "center";
  if (hx === "center") return vy;
  if (vy === "mid") return hx;
  return `${vy}-${hx}`;
}
function roleOf(color: string | undefined, colors: { primary: string; accent: string }): "primary" | "accent" | "secondary" {
  const c = (color ?? "").toLowerCase();
  if (c && c === (colors.accent ?? "").toLowerCase()) return "accent";
  if (c && c === (colors.primary ?? "").toLowerCase()) return "primary";
  return "secondary";
}
/** Cluster decoration elements by (kind, anchor) into the archetype's treatments. */
function buildTreatments(els: DecoEl[], cw: number, ch: number, colors: { primary: string; accent: string }): DecoTreatment[] {
  const area = cw * ch;
  const groups = new Map<string, { kind: string; anchor: string; sal: number[]; size: number[]; roles: string[]; ids: Set<string> }>();
  // Only true background decoration drives treatments — image_holder/chart/divider
  // are content media or structural lines, not the slide's decorative shapes.
  const SKIP = new Set(["background", "image_holder", "chart", "divider", "frame"]);
  for (const el of els) {
    if (SKIP.has(el.kind)) continue;
    const anchor = anchorOf(el.bbox, cw, ch);
    const key = `${el.kind}@${anchor}`;
    const g = groups.get(key) ?? { kind: el.kind, anchor, sal: [], size: [], roles: [], ids: new Set<string>() };
    g.sal.push(el.salience ?? 0.5);
    g.size.push(Math.min(1, (el.bbox.w * el.bbox.h) / area));
    g.roles.push(roleOf(el.color, colors));
    g.ids.add(el.layoutId);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.sal.length - a.sal.length)
    .slice(0, 3)
    .map((g) => ({ kind: g.kind, anchor: g.anchor, salience: median(g.sal), sizeFrac: median(g.size), colorRole: (mode(g.roles) ?? "secondary") as DecoTreatment["colorRole"], shapeIds: [...g.ids], support: g.sal.length }));
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
  /** Default font family (fallback for roles whose type token omits one). */
  fontFamily: string;
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
    return zone;
  });
}

/**
 * Mockup arrangement. Devices are placed as a COHERENT GROUP by the designer (e.g.
 * a 3-up phone row, evenly spaced) — that arrangement is a per-slide relationship,
 * not something to blend across slides. So we take the dominant arrangement (the
 * modal mockup count) and average positions only across slides that share it,
 * preserving the real layout (and never overlapping).
 */
function mineMockupZones(arrangements: ImgSlot[][]): ImageZone[] {
  const groups = arrangements.filter((a) => a.length > 0);
  if (groups.length === 0) return [];
  const byCount = new Map<number, ImgSlot[][]>();
  for (const a of groups) (byCount.get(a.length) ?? byCount.set(a.length, []).get(a.length)!).push(a);
  const [count, reps] = [...byCount.entries()].sort((x, y) => y[1].length - x[1].length || x[0] - y[0])[0]!;
  const sorted = reps.map((a) => [...a].sort((p, q) => p.xFrac - q.xFrac));
  const zones: ImageZone[] = [];
  for (let i = 0; i < count; i++) {
    const col = sorted.map((a) => a[i]).filter((s): s is ImgSlot => !!s);
    const x = median(col.map((s) => s.xFrac)), w = median(col.map((s) => s.wFrac));
    const y = median(col.map((s) => s.yFrac)), h = median(col.map((s) => s.hFrac));
    const zone: ImageZone = { xFrac: [x, x + w], yFrac: [y, y + h], ratio: median(col.map((s) => s.ratio)) };
    const ref = mode(col.map((s) => s.mockupRef).filter(Boolean));
    if (ref) zone.mockupRef = ref;
    zones.push(zone);
  }
  return zones;
}

/** Aggregate the regions of one archetype's example slides into a median skeleton. */
function mineSkeleton(archetype: string, examples: { regions: Region[]; imgSlots: ImgSlot[]; decoCoverage: number; decoCount: number; decoEls: DecoEl[]; canvas: Canvas }[], colors: { primary: string; accent: string }): ArchetypeSkeleton | undefined {
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
  // Photos cluster across slides; mockups keep their per-slide arrangement.
  const photoZones = mineImageZones(examples.flatMap((e) => e.imgSlots.filter((s) => !s.mockupRef)));
  const mockupZones = mineMockupZones(examples.map((e) => e.imgSlots.filter((s) => s.mockupRef)));
  const imageZones = [...photoZones, ...mockupZones];
  const cv = examples[0]?.canvas ?? { w: 1920, h: 1080 };
  const decoration: DecorationProfile = {
    coverage: median(examples.map((e) => e.decoCoverage)),
    count: Math.round(median(examples.map((e) => e.decoCount))),
    treatments: buildTreatments(examples.flatMap((e) => e.decoEls), cv.w, cv.h, colors),
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
  const byArch = new Map<string, { regions: Region[]; imgSlots: ImgSlot[]; decoCoverage: number; decoCount: number; decoEls: DecoEl[]; canvas: Canvas }[]>();
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
    const decoEls: DecoEl[] = deco.map((d) => ({ kind: d.kind, bbox: d.bbox, ...(d.salience !== undefined ? { salience: d.salience } : {}), ...(d.color ? { color: d.color } : {}), layoutId: L.id }));
    (byArch.get(a) ?? byArch.set(a, []).get(a)!).push({ regions: L.regions ?? [], imgSlots, decoCoverage, decoCount: deco.length, decoEls, canvas: system.canvas });
  }
  const archetypes: ArchetypeSkeleton[] = [];
  for (const [a, exs] of byArch) {
    const sk = mineSkeleton(a, exs, system.tokens.colors);
    if (sk) archetypes.push(sk);
  }
  archetypes.sort((a, b) => b.support - a.support);

  return {
    theme: system.theme,
    canvas: system.canvas,
    palette: system.tokens.palette ?? [],
    colors: system.tokens.colors,
    fontFamily: system.tokens.fontFamily ?? Object.values(system.tokens.type)[0]?.family ?? "Inter",
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
