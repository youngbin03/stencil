import { measureWidth } from "./measure.js";

/**
 * Text fitting (DEVDOC 7.4). Wrap → autofit shrink → ellipsis, using accurate
 * font metrics (measure.ts) so a line never overflows the slot. CJK breaks per
 * character; Latin breaks on spaces.
 */

const TOKENIZE = /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]|[^\s\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]+|\s+/g;

/** Backwards-compatible width estimate (default body family). */
export function estimateWidth(text: string, fontSize: number, family = "Inter"): number {
  return measureWidth(text, family, fontSize);
}

/** Greedy word wrap of one line to maxWidth using accurate metrics. */
export function wrapLine(text: string, maxWidth: number, fontSize: number, family: string): string[] {
  if (maxWidth <= 0) return [text];
  const tokens = text.match(TOKENIZE) ?? [text];
  const lines: string[] = [];
  let cur = "";
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      if (cur !== "") cur += " ";
      continue;
    }
    const tentative = cur === "" ? tok : cur + tok;
    if (cur !== "" && measureWidth(tentative, family, fontSize) > maxWidth) {
      lines.push(cur.trimEnd());
      cur = tok;
    } else {
      cur = tentative;
    }
  }
  if (cur.trim() !== "") lines.push(cur.trimEnd());
  return lines.length ? lines : [text];
}

export interface FitResult {
  lines: string[];
  fontSize: number;
  overflow: boolean;
}

export interface FitBox {
  w: number;
  h: number;
}

/** Fit content into a box: wrap, then shrink (width + height), then ellipsize. */
export function fitText(
  content: string,
  box: FitBox,
  baseFontSize: number,
  lineHeight: number,
  family = "Inter",
  minFontSize = Math.max(10, baseFontSize * 0.35),
): FitResult {
  const explicit = content.split("\n");
  const wrapAll = (fs: number): string[] => explicit.flatMap((l) => wrapLine(l, box.w, fs, family));

  if (box.w <= 0 && box.h <= 0) return { lines: explicit, fontSize: baseFontSize, overflow: false };

  let fontSize = baseFontSize;
  for (;;) {
    const lines = wrapAll(fontSize);
    const totalH = lines.length * fontSize * lineHeight;
    const maxLineW = Math.max(...lines.map((l) => measureWidth(l, family, fontSize)));
    const heightOk = box.h <= 0 || totalH <= box.h;
    const widthOk = box.w <= 0 || maxLineW <= box.w * 1.01;
    if (heightOk && widthOk) return { lines, fontSize, overflow: false };
    if (fontSize <= minFontSize) {
      const maxLines = box.h > 0 ? Math.max(1, Math.floor(box.h / (fontSize * lineHeight))) : lines.length;
      const kept = lines.slice(0, maxLines);
      if (kept.length) kept[kept.length - 1] = `${kept[kept.length - 1]!.replace(/\s+$/, "")}…`;
      return { lines: kept, fontSize, overflow: true };
    }
    fontSize = Math.max(minFontSize, Math.round(fontSize * 0.92));
  }
}
