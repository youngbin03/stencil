import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import type {
  BBox,
  DesignSystemIR,
  Layout,
  ManifestSlot,
  Palette,
  Region,
  SlotManifest,
  Theme,
  Tokens,
  TypeScale,
  TypeToken,
} from "@stencil/ir";
import { normalizeSvg } from "@stencil/normalizer";

/**
 * Assetize stage (DEVDOC 5/②). Turns a template SVG into a persistent design
 * system asset (tokens + layout + decoration fragment). Generation later reads
 * these assets only — never the original SVG.
 *
 * Phase 2 scope: tokens (colors/type/spacing), one layout with defaultSlots,
 * and the decoration fragment. Block clustering is deferred to Phase 4; the
 * inplace special case (defaultSlots) covers generation until then.
 */

const DEFAULT_LINE_HEIGHT: Record<string, number> = {
  title: 1.05,
  headline: 1.1,
  subtitle: 1.2,
  body: 1.4,
  caption: 1.2,
};

const DEFAULT_SPACING_SCALE = [8, 16, 24, 48, 96];

function modeOf(values: string[]): string | undefined {
  const count = new Map<string, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [v, n] of count) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function num(el: Element, attr: string): number | undefined {
  const v = el.getAttribute(attr);
  if (v === null || v === "") return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Collect fill colors from shapes, separating the full-canvas background. */
function extractColors(doc: ReturnType<DOMParser["parseFromString"]>, canvasW: number, slots: ManifestSlot[]): Palette {
  let bg: string | undefined;
  const shapeFills: string[] = [];

  for (const tag of ["rect", "path", "circle", "ellipse", "polygon"]) {
    const els = doc.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) {
      const el = els[i]!;
      const fill = el.getAttribute("fill");
      // Only solid colors count as tokens; skip none, gradients, patterns.
      if (!fill || fill === "none" || fill.startsWith("url(")) continue;
      if (tag === "rect" && (num(el, "width") ?? 0) >= canvasW * 0.98 && bg === undefined) {
        bg = fill;
        continue;
      }
      shapeFills.push(fill);
    }
  }

  const textColor = modeOf(slots.filter((s) => s.type === "text" && s.color).map((s) => s.color!));
  const accent = modeOf(shapeFills);

  return {
    primary: textColor ?? "#000000",
    accent: accent ?? textColor ?? "#000000",
    bg: bg ?? "#FFFFFF",
    text: textColor ?? "#000000",
  };
}

/** Build the type scale by grouping text slots by role (representative = largest size). */
function extractType(slots: ManifestSlot[]): TypeScale {
  const byRole = new Map<string, ManifestSlot>();
  for (const s of slots) {
    if (s.type !== "text") continue;
    const cur = byRole.get(s.role);
    if (!cur || (s.fontSize ?? 0) > (cur.fontSize ?? 0)) byRole.set(s.role, s);
  }

  const tokenFor = (s: ManifestSlot): TypeToken => ({
    family: s.fontFamily ?? "sans-serif",
    size: s.fontSize ?? 16,
    weight: s.fontWeight ?? 400,
    lineHeight: DEFAULT_LINE_HEIGHT[s.role] ?? 1.2,
  });

  const scale: Record<string, TypeToken> = {};
  for (const [role, slot] of byRole) scale[role] = tokenFor(slot);

  // Guarantee the three required keys (fall back to the largest available).
  const largest = [...byRole.values()].sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0))[0];
  const fallback: TypeToken = largest
    ? tokenFor(largest)
    : { family: "sans-serif", size: 16, weight: 400, lineHeight: 1.2 };
  const ensure = (role: "title" | "subtitle" | "body"): TypeToken => scale[role] ?? fallback;

  return { ...scale, title: ensure("title"), subtitle: ensure("subtitle"), body: ensure("body") };
}

function extractTokens(doc: ReturnType<DOMParser["parseFromString"]>, manifest: SlotManifest): Tokens {
  const type = extractType(manifest.slots);
  return {
    fontFamily: type.body.family,
    colors: extractColors(doc, manifest.canvas.w, manifest.slots),
    type,
    spacing: { unit: 8, scale: DEFAULT_SPACING_SCALE },
  };
}

function unionBBox(slots: ManifestSlot[]): BBox {
  const text = slots.filter((s) => s.type === "text");
  if (text.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...text.map((s) => s.bbox.x));
  const minY = Math.min(...text.map((s) => s.bbox.y));
  const maxX = Math.max(...text.map((s) => s.bbox.x + s.bbox.w));
  const maxY = Math.max(...text.map((s) => s.bbox.y + s.bbox.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function buildLayout(manifest: SlotManifest, decorationRef: string): Layout {
  const region: Region = {
    id: "content",
    bbox: unionBBox(manifest.slots),
    flow: "column",
    gap: 24,
    allowedBlocks: [],
  };
  return {
    id: manifest.layoutId,
    decorationRef,
    regions: [region],
    defaultSlots: manifest.slots.filter((s) => s.type === "text").map((s) => s.id),
  };
}

/** Produce a decoration-only SVG by removing every <text> node. */
export function extractDecoration(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const texts = doc.getElementsByTagName("text");
  // Collect first (live list mutates as we remove).
  const nodes: Element[] = [];
  for (let i = 0; i < texts.length; i++) nodes.push(texts[i]!);
  for (const n of nodes) n.parentNode?.removeChild(n);
  return new XMLSerializer().serializeToString(doc);
}

export interface ExtractOptions {
  templateId: string;
  theme: Theme;
  layoutId: string;
  /** Stored reference for the decoration fragment (e.g. a storage path). */
  decorationRef: string;
}

export interface ExtractResult {
  asset: DesignSystemIR;
  decorationSvg: string;
  manifest: SlotManifest;
}

export function extractAsset(svg: string, opts: ExtractOptions): ExtractResult {
  const manifest = normalizeSvg(svg, {
    layoutId: opts.layoutId,
    theme: opts.theme,
    baseTemplate: opts.decorationRef,
  });
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");

  const asset: DesignSystemIR = {
    templateId: opts.templateId,
    theme: opts.theme,
    version: 1,
    canvas: manifest.canvas,
    tokens: extractTokens(doc, manifest),
    blocks: [],
    layouts: [buildLayout(manifest, opts.decorationRef)],
  };

  return { asset, decorationSvg: extractDecoration(svg), manifest };
}
