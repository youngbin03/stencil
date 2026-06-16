import { DOMParser, type Element } from "@xmldom/xmldom";
import { accumulatedTransform, applyBBox } from "@stencil/normalizer";
import type {
  AnchorRegion,
  BBox,
  Canvas,
  DecorationElement,
  DecorationModel,
  ManifestSlot,
  RelationConvention,
  RelationEdge,
  RelationGraph,
  RelationNode,
} from "@stencil/ir";

/**
 * Relation graph extraction (DEVDOC Phase 4.5), deterministic core. Decomposes
 * a layout's decoration into semantic elements and measures typed relations
 * (slot↔slot, slot↔decoration) from geometry. Vision assist is a later option.
 */

const COL_TOL = 24;
const ALIGN_TOL = 8;
const GROUP_GAP = 64;
/** avoids: emphasis must be at least this salient to be worth steering clear of. */
const AVOID_SALIENCE_MIN = 0.3;
/** avoids: emphasis wider than this fraction of the canvas is full-bleed (no side). */
const FULLBLEED_W = 0.8;

// --- geometry / color helpers ----------------------------------------------

function nAttr(el: Element, a: string): number | undefined {
  const v = el.getAttribute(a);
  if (v === null || v === "") return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

function pathBBox(d: string): BBox | undefined {
  const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!nums || nums.length < 2) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    xs.push(Number.parseFloat(nums[i]!));
    ys.push(Number.parseFloat(nums[i + 1]!));
  }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return undefined;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff" };

function luminance(color: string): number | undefined {
  const hex = (NAMED[color.toLowerCase()] ?? color).replace("#", "");
  if (hex.length !== 6 && hex.length !== 3) return undefined;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return undefined;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function contrast(fill: string, bg: string): number {
  const a = luminance(fill), b = luminance(bg);
  if (a === undefined || b === undefined) return 0.5;
  return Math.abs(a - b) / 255;
}

function center(b: BBox): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
function overlapsY(a: BBox, b: BBox): boolean {
  return a.y < b.y + b.h && b.y < a.y + a.h;
}
function contains(outer: BBox, p: { x: number; y: number }): boolean {
  return p.x >= outer.x && p.x <= outer.x + outer.w && p.y >= outer.y && p.y <= outer.y + outer.h;
}

// --- decoration decomposition ----------------------------------------------

interface Shape {
  tag: string;
  id: string;
  bbox: BBox;
  fill: string;
}

function isInDefs(el: Element): boolean {
  let p: Element | null = el.parentNode as Element | null;
  while (p) {
    if (p.nodeName?.toLowerCase() === "defs") return true;
    p = p.parentNode as Element | null;
  }
  return false;
}

function collectShapes(doc: ReturnType<DOMParser["parseFromString"]>): Shape[] {
  const shapes: Shape[] = [];
  const push = (el: Element, local: BBox | undefined): void => {
    if (!local || isInDefs(el)) return;
    const fill = el.getAttribute("fill") ?? "";
    if (fill === "none") return;
    const bbox = applyBBox(local, accumulatedTransform(el)); // transform-aware
    shapes.push({ tag: el.nodeName.toLowerCase(), id: el.getAttribute("id") ?? "", bbox, fill });
  };
  for (const t of ["rect", "circle", "ellipse", "path", "image", "polygon"]) {
    const els = doc.getElementsByTagName(t);
    for (let i = 0; i < els.length; i++) {
      const el = els[i]!;
      let bbox: BBox | undefined;
      if (t === "rect" || t === "image") {
        bbox = { x: nAttr(el, "x") ?? 0, y: nAttr(el, "y") ?? 0, w: nAttr(el, "width") ?? 0, h: nAttr(el, "height") ?? 0 };
      } else if (t === "circle") {
        const cx = nAttr(el, "cx") ?? 0, cy = nAttr(el, "cy") ?? 0, r = nAttr(el, "r") ?? 0;
        bbox = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
      } else if (t === "ellipse") {
        const cx = nAttr(el, "cx") ?? 0, cy = nAttr(el, "cy") ?? 0, rx = nAttr(el, "rx") ?? 0, ry = nAttr(el, "ry") ?? 0;
        bbox = { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
      } else {
        const d = el.getAttribute("d") ?? el.getAttribute("points") ?? "";
        bbox = pathBBox(d);
      }
      push(el, bbox);
    }
  }
  return shapes;
}

export function extractDecorationModel(
  decorationSvg: string, layoutId: string, decorationRef: string, canvas: Canvas, bg: string,
): DecorationModel {
  const doc = new DOMParser().parseFromString(decorationSvg, "image/svg+xml");
  const shapes = collectShapes(doc);
  const canvasArea = canvas.w * canvas.h || 1;

  const elements: DecorationElement[] = [];
  let z = 0;
  for (const s of shapes) {
    const { bbox, fill } = s;
    const areaNorm = (bbox.w * bbox.h) / canvasArea;
    const minSide = Math.min(bbox.w, bbox.h);
    const aspect = bbox.h > 0 ? bbox.w / bbox.h : 0;
    const sal = Math.min(1, areaNorm * 2) * (0.5 + 0.5 * contrast(fill, bg));

    let kind: DecorationElement["kind"];
    if (s.tag === "image" || fill.startsWith("url(#pattern")) kind = "image_holder";
    else if (s.tag === "rect" && bbox.w >= canvas.w * 0.98 && bbox.h >= canvas.h * 0.98) kind = "background";
    else if (minSide <= 4 || aspect >= 25 || aspect <= 0.04) kind = "divider";
    else if (areaNorm >= 0.05) kind = "emphasis";
    else kind = "accent";

    const el: DecorationElement = { id: s.id || `${kind}_${z}`, kind, bbox, z };
    if (fill && !fill.startsWith("url(")) el.color = fill;
    if (kind !== "background") el.salience = Math.round(sal * 100) / 100;
    if (kind === "image_holder" && bbox.h > 0) el.ratio = `${Math.round((bbox.w / bbox.h) * 100) / 100}:1`;
    if (kind === "divider") el.orientation = bbox.w >= bbox.h ? "horizontal" : "vertical";
    elements.push(el);
    z++;
  }
  return { layoutId, decorationRef, elements };
}

// --- relation measurement ---------------------------------------------------

function cluster<T>(items: T[], key: (t: T) => number, tol: number): T[][] {
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const out: T[][] = [];
  let bucket: T[] = [];
  for (const it of sorted) {
    if (bucket.length === 0 || key(it) - key(bucket[bucket.length - 1]!) <= tol) bucket.push(it);
    else { out.push(bucket); bucket = [it]; }
  }
  if (bucket.length) out.push(bucket);
  return out;
}

function regionOf(b: BBox, canvas: Canvas): AnchorRegion {
  const cx = center(b).x / (canvas.w || 1);
  if (cx < 0.4) return "left_half";
  if (cx > 0.6) return "right_half";
  return "center";
}

function slotSlotEdges(slots: ManifestSlot[]): RelationEdge[] {
  const text = slots.filter((s) => s.type === "text");
  const edges: RelationEdge[] = [];

  // aligned (left) — columns
  for (const col of cluster(text, (s) => s.bbox.x, ALIGN_TOL)) {
    if (col.length >= 2) {
      edges.push({ type: "aligned", axis: "left", nodes: col.map((s) => s.id), confidence: 1 });
      // above + coupled within column (sorted by y)
      const byY = [...col].sort((a, b) => a.bbox.y - b.bbox.y);
      for (let i = 0; i < byY.length - 1; i++) {
        const a = byY[i]!, b = byY[i + 1]!;
        edges.push({ type: "above", a: a.id, b: b.id, confidence: 1 });
        const gap = b.bbox.y - (a.bbox.y + a.bbox.h);
        if (gap >= 0 && gap <= GROUP_GAP) edges.push({ type: "coupled", a: a.id, b: b.id, strength: "tight", confidence: 0.9 });
      }
    }
  }

  // row — same y band
  for (const r of cluster(text, (s) => s.bbox.y, ALIGN_TOL * 2)) {
    if (r.length >= 2) {
      const ids = r.sort((a, b) => a.bbox.x - b.bbox.x).map((s) => s.id);
      edges.push({ type: "row", nodes: ids, distribute: "equal", confidence: 0.9 });
      const ws = r.map((s) => s.bbox.w);
      if (Math.max(...ws) - Math.min(...ws) <= Math.max(...ws) * 0.15) edges.push({ type: "same_size", nodes: ids, confidence: 0.8 });
    }
  }

  // emphasis_rank (font size desc) + reading_order (y then x)
  const rank = [...text].sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0)).map((s) => s.id);
  if (rank.length) edges.push({ type: "emphasis_rank", order: rank, confidence: 1 });
  const reading = [...text].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x).map((s) => s.id);
  if (reading.length) edges.push({ type: "reading_order", order: reading, confidence: 0.9 });

  return edges;
}

function slotDecorationEdges(slots: ManifestSlot[], deco: DecorationElement[], canvas: Canvas): RelationEdge[] {
  const edges: RelationEdge[] = [];
  const emphasis = deco.filter((d) => d.kind === "emphasis");
  const overlayable = deco.filter((d) => d.kind === "emphasis" || d.kind === "accent" || d.kind === "image_holder");

  for (const s of slots) {
    if (s.type !== "text") continue;
    const c = center(s.bbox);
    // over: slot center inside an overlayable element
    const on = overlayable.find((d) => contains(d.bbox, c));
    if (on) edges.push({ type: "over", slot: s.id, decoration: on.id, confidence: 0.8 });
    // anchored_to region
    edges.push({ type: "anchored_to", slot: s.id, region: regionOf(s.bbox, canvas), confidence: 0.8 });
    // avoids: the slot sits beside a salient, BOUNDED emphasis in the shared
    // vertical band with clean horizontal separation. Excludes (a) full-bleed
    // emphasis that spans the canvas (no side to avoid), (b) emphasis that
    // contains the slot — that is an "over" relation, not avoidance, and (c)
    // emphasis that horizontally overlaps the slot (no clean gap to preserve).
    for (const e of emphasis) {
      if ((e.salience ?? 0) < AVOID_SALIENCE_MIN) continue;
      if (!overlapsY(s.bbox, e.bbox)) continue;
      if (e.bbox.w >= canvas.w * FULLBLEED_W) continue; // canvas-spanning → meaningless
      if (contains(e.bbox, c)) continue; // slot over decoration, not avoiding it
      const slotLeftOfD = s.bbox.x + s.bbox.w <= e.bbox.x; // slot fully left of D
      const slotRightOfD = s.bbox.x >= e.bbox.x + e.bbox.w; // slot fully right of D
      if (!slotLeftOfD && !slotRightOfD) continue; // horizontal overlap → not a clean avoid
      edges.push({ type: "avoids", slot: s.id, decoration: e.id, confidence: 0.85 });
    }
  }
  return edges;
}

export function buildRelationGraph(
  layoutId: string, slots: ManifestSlot[], deco: DecorationElement[], canvas: Canvas,
): RelationGraph {
  const nodes: RelationNode[] = [
    ...slots.filter((s) => s.type === "text" || s.type === "image").map((s) => ({ id: s.id, kind: "slot" as const, role: s.role, bbox: s.bbox })),
    ...deco.filter((d) => d.kind !== "background").map((d) => ({ id: d.id, kind: "decoration" as const, role: "decoration" as const, bbox: d.bbox })),
  ];
  const edges = [...slotSlotEdges(slots), ...slotDecorationEdges(slots, deco, canvas)];
  return { layoutId, nodes, edges };
}

/** Role-based relation patterns recurring across layouts, frequency-sorted. */
export function relationConventions(graphs: { graph: RelationGraph; slotRole: Map<string, string> }[]): RelationConvention[] {
  const count = new Map<string, number>();
  for (const { graph, slotRole } of graphs) {
    for (const e of graph.edges) {
      let key: string | undefined;
      if (e.type === "coupled" && e.a && e.b) key = `coupled(${e.strength}): ${slotRole.get(e.a)}+${slotRole.get(e.b)}`;
      else if (e.type === "row" && e.nodes) {
        const roles = e.nodes.map((n) => slotRole.get(n)).filter(Boolean);
        if (roles.length) key = `row: ${roles[0]}×${roles.length}`;
      } else if (e.type === "above" && e.a && e.b) key = `above: ${slotRole.get(e.a)}>${slotRole.get(e.b)}`;
      if (key) count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([pattern, support]) => ({ pattern, support }));
}
