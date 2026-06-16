import type { BBox, Layout, RenderSlide, RenderTextElement, Tokens } from "@stencil/ir";
import { estimateWidth } from "./fit.js";

/**
 * Self-check gate (deterministic). Inspects the assembled slide before output:
 * contrast / overlap / overflow / out-of-bounds / emptiness. Safe issues are
 * auto-fixed deterministically (low-contrast text → recolor from palette);
 * the rest are reported as warnings for the orchestrator (retry / vision / fallback).
 */

const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff" };
const CONTRAST_MIN = 70; // luminance delta (0..255) below which text is "buried"

function luminance(color: string): number | undefined {
  const hex = (NAMED[color.toLowerCase()] ?? color).replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (full.length !== 6) return undefined;
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return undefined;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function center(b: BBox): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
function contains(o: BBox, p: { x: number; y: number }): boolean {
  return p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h;
}
function overlapArea(a: BBox, b: BBox): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

/**
 * Actual rendered ink box of a text element (not the reserved slot bbox). Text
 * slots reserve generous width for long content; fitText guarantees the wrapped
 * glyphs stay within bbox.w and the chosen alignment, so the real ink can be far
 * narrower than the slot. Out-of-bounds must judge the ink, not the reservation,
 * else wide display slots near the canvas edge raise false positives.
 */
function textInk(t: RenderTextElement): BBox {
  const lh = t.lineHeight ?? 1.2;
  const h = t.lines.length * t.fontSize * lh;
  const ls = typeof t.letterSpacing === "number" ? t.letterSpacing : parseFloat(String(t.letterSpacing ?? 0)) || 0;
  let w = 0;
  for (const line of t.lines) {
    const lw = estimateWidth(line, t.fontSize, t.fontFamily) + ls * Math.max(0, line.length - 1);
    if (lw > w) w = lw;
  }
  w = Math.min(w, t.bbox.w); // fitText never exceeds the slot width
  const x = t.align === "center" ? t.bbox.x + (t.bbox.w - w) / 2
    : t.align === "right" ? t.bbox.x + t.bbox.w - w
    : t.bbox.x;
  return { x, y: t.bbox.y, w, h };
}

/** The fill a text element sits on: top-most cloned rect → decoration → background. */
function backgroundAt(p: { x: number; y: number }, slide: RenderSlide, layout: Layout): string {
  // Cloned card rects are drawn over decoration; check them last-drawn-first.
  for (let i = slide.elements.length - 1; i >= 0; i--) {
    const el = slide.elements[i]!;
    if (el.kind === "rect" && contains(el.bbox, p)) return el.fill;
  }
  const deco = (layout.decorationModel?.elements ?? []).filter((d) => d.kind !== "background" && d.color);
  let best: string | undefined;
  let bestZ = -1;
  for (const d of deco) if (contains(d.bbox, p) && d.z > bestZ) ((best = d.color), (bestZ = d.z));
  return best ?? layout.background;
}

function pickContrastColor(bg: string, palette: string[]): string {
  const bgL = luminance(bg) ?? 255;
  const candidates = ["#FFFFFF", "#000000", ...palette];
  let best = bgL > 128 ? "#000000" : "#FFFFFF";
  let bestDelta = -1;
  for (const c of candidates) {
    const l = luminance(c);
    if (l === undefined) continue;
    const d = Math.abs(l - bgL);
    if (d > bestDelta) ((best = c), (bestDelta = d));
  }
  return best;
}

export interface SelfCheckIssue {
  kind: "contrast" | "overlap" | "overflow" | "out_of_bounds" | "emptiness";
  severity: "high" | "med" | "low";
  target: string;
  detail?: string;
}

/**
 * Run the gate. Mutates text colors to fix low contrast (safe, deterministic)
 * and returns remaining issues. Caller decides retry/vision/fallback on those.
 */
export function selfCheck(slide: RenderSlide, layout: Layout, tokens: Tokens): SelfCheckIssue[] {
  const issues: SelfCheckIssue[] = [];
  const texts = slide.elements.filter((e): e is RenderTextElement => e.kind === "text");

  // 1) Contrast — auto-fix by recoloring buried text.
  for (const t of texts) {
    const bg = backgroundAt(center(t.bbox), slide, layout);
    const tl = luminance(t.color), bl = luminance(bg);
    if (tl !== undefined && bl !== undefined && Math.abs(tl - bl) < CONTRAST_MIN) {
      const fixed = pickContrastColor(bg, tokens.palette);
      if (fixed.toLowerCase() !== t.color.toLowerCase()) {
        t.color = fixed; // deterministic auto-fix
        issues.push({ kind: "contrast", severity: "low", target: t.id, detail: `recolored on ${bg}` });
      }
    }
  }

  // 2) Overlap — text/text significant intersection (report only).
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!, b = texts[j]!;
      const ov = overlapArea(a.bbox, b.bbox);
      const minA = Math.min(a.bbox.w * a.bbox.h, b.bbox.w * b.bbox.h);
      if (minA > 0 && ov / minA > 0.35) issues.push({ kind: "overlap", severity: "high", target: `${a.id}~${b.id}` });
    }
  }

  // 3) Overflow (fit ellipsized/shrunk past slot).
  for (const t of texts) if (t.overflow) issues.push({ kind: "overflow", severity: "med", target: t.id });

  // 4) Out of bounds. Cloned card rects that blow past the canvas indicate a
  //    bad repeat/decoration match (they cover real content) → high severity.
  for (const e of slide.elements) {
    const b = e.kind === "text" ? textInk(e) : e.bbox;
    const oob = b.x < -2 || b.y < -2 || b.x + b.w > slide.canvas.w + 2 || b.y + b.h > slide.canvas.h + 2;
    if (!oob) continue;
    if (e.kind === "rect") {
      const oversize = b.w > slide.canvas.w * 1.2 || b.h > slide.canvas.h * 1.2;
      if (oversize) issues.push({ kind: "out_of_bounds", severity: "high", target: e.id, detail: "oversized cloned rect" });
    } else {
      issues.push({ kind: "out_of_bounds", severity: "med", target: e.id });
    }
  }

  // 5) Emptiness — content covers too little of the canvas.
  if (slide.elements.length) {
    const xs = slide.elements.map((e) => e.bbox);
    const cover = xs.reduce((s, b) => s + b.w * b.h, 0) / (slide.canvas.w * slide.canvas.h);
    if (cover < 0.06) issues.push({ kind: "emptiness", severity: "low", target: "slide", detail: `${(cover * 100).toFixed(1)}%` });
  }

  return issues;
}
