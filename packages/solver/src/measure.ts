import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";

/**
 * Accurate text measurement via real font metrics (opentype.js). Replaces the
 * glyph-width heuristic so autofit never overflows. Falls back to a heuristic
 * per-character when a font (or a glyph, e.g. CJK) is unavailable.
 */

const FONT_FILES: Record<string, string> = {
  inter: "Inter.ttf",
  "open sans": "OpenSans.ttf",
  neuton: "Neuton.ttf",
  "bricolage grotesque": "BricolageGrotesque.ttf",
};

const fontsDir = process.env.STENCIL_FONTS_DIR ?? resolve(process.cwd(), "fonts");
const cache = new Map<string, opentype.Font | null>();

function fontFor(family: string): opentype.Font | null {
  const key = family.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key)!;
  const file = FONT_FILES[key];
  let font: opentype.Font | null = null;
  if (file) {
    const path = resolve(fontsDir, file);
    if (existsSync(path)) {
      try {
        const b = readFileSync(path);
        font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      } catch {
        font = null;
      }
    }
  }
  cache.set(key, font);
  return font;
}

/** Heuristic per-character width (fraction of font-size) — fallback only. */
function heuristicChar(ch: string, size: number): number {
  if (ch === " ") return 0.3 * size;
  if (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(ch)) return 1.0 * size;
  if (/[ .,:;'"!|ijl()\[\]]/.test(ch)) return 0.32 * size;
  if (/[A-Z0-9$%@&Wm]/.test(ch)) return 0.62 * size;
  return 0.52 * size;
}

/** Measured advance width of `text` at `size` px in `family` (with fallbacks). */
export function measureWidth(text: string, family: string, size: number): number {
  const font = fontFor(family);
  if (!font) {
    let w = 0;
    for (const ch of text) w += heuristicChar(ch, size);
    return w;
  }
  const upem = font.unitsPerEm || 1000;
  let w = 0;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.index === 0 || glyph.advanceWidth == null) {
      w += heuristicChar(ch, size); // missing glyph (e.g. CJK) → heuristic
    } else {
      w += (glyph.advanceWidth / upem) * size;
    }
  }
  return w;
}
