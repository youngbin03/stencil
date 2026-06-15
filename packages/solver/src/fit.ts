/**
 * Text fitting (DEVDOC 7.4). Deterministic, font-metric-free heuristic:
 *   1) word wrap to the slot width (CJK breaks per character)
 *   2) autofit: shrink font-size until it fits the slot height
 *   3) ellipsis: if still overflowing at min size, truncate + flag
 * Char widths are estimated as a fraction of font-size (no font files needed);
 * precise opentype/canvas metrics can replace estimateWidth later.
 */

const CJK = /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
const TOKENIZE = /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]|[^\s\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]+|\s+/g;

/** Estimated advance width of a string at a given font-size (px). */
export function estimateWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    if (ch === " ") units += 0.3;
    else if (CJK.test(ch)) units += 1.0;
    else if (/[ .,:;'"!|ijl()\[\]]/.test(ch)) units += 0.32;
    else if (/[A-Z0-9$%@&Wm]/.test(ch)) units += 0.62;
    else units += 0.52;
  }
  return units * fontSize;
}

/** Greedy word wrap of a single line to maxWidth. CJK characters break freely. */
export function wrapLine(text: string, maxWidth: number, fontSize: number): string[] {
  if (maxWidth <= 0) return [text];
  const tokens = text.match(TOKENIZE) ?? [text];
  const lines: string[] = [];
  let cur = "";
  for (const tok of tokens) {
    const isSpace = /^\s+$/.test(tok);
    if (isSpace) {
      if (cur !== "") cur += " ";
      continue;
    }
    const tentative = cur === "" ? tok : cur + (cur.endsWith(" ") ? "" : "") + tok;
    if (cur !== "" && estimateWidth(tentative, fontSize) > maxWidth) {
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

/** Fit content into a box: wrap, then shrink, then ellipsize. */
export function fitText(
  content: string,
  box: FitBox,
  baseFontSize: number,
  lineHeight: number,
  minFontSize = Math.max(12, baseFontSize * 0.5),
): FitResult {
  const explicit = content.split("\n");
  const wrapAll = (fs: number): string[] => explicit.flatMap((l) => wrapLine(l, box.w, fs));

  // No usable height constraint → just wrap at the base size.
  if (box.h <= 0) return { lines: wrapAll(baseFontSize), fontSize: baseFontSize, overflow: false };

  let fontSize = baseFontSize;
  for (;;) {
    const lines = wrapAll(fontSize);
    const totalH = lines.length * fontSize * lineHeight;
    if (totalH <= box.h) return { lines, fontSize, overflow: false };
    if (fontSize <= minFontSize) {
      // Ellipsize: keep as many lines as fit, mark last with an ellipsis.
      const maxLines = Math.max(1, Math.floor(box.h / (fontSize * lineHeight)));
      const kept = lines.slice(0, maxLines);
      if (kept.length) kept[kept.length - 1] = `${kept[kept.length - 1]!.replace(/\s+$/, "")}…`;
      return { lines: kept, fontSize, overflow: true };
    }
    fontSize = Math.max(minFontSize, Math.round(fontSize * 0.92));
  }
}
