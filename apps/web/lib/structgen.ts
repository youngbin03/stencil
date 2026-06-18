import { Resvg } from "@resvg/resvg-js";
import type { Region } from "@stencil/synthesizer";

// Open-region finder (occupancy grid + largest-empty-rectangle), ported from the
// offline augmentation path so live generation places dense content in the SAME clear
// area the decoration leaves. Rasterize the decoration shapes (transparent bg) to a
// low-res grid, mark inked cells + a SAFE border as occupied, dilate, then find the
// biggest all-empty axis-aligned rectangle. Shape-accurate, no per-decoration tuning.
const GW = 192, PAD = 2;

function largestEmptyRect(occ: Uint8Array, gw: number, gh: number): { area: number; x: number; y: number; w: number; h: number } {
  const heights = new Array(gw).fill(0);
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) heights[c] = occ[r * gw + c] ? 0 : heights[c] + 1;
    const stack: number[] = [];
    for (let c = 0; c <= gw; c++) {
      const hc = c < gw ? heights[c] : 0;
      while (stack.length && heights[stack[stack.length - 1]!] >= hc) {
        const h = heights[stack.pop()!]!;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const area = h * (c - left);
        if (area > best.area) best = { area, x: left, y: r - h + 1, w: c - left, h };
      }
      stack.push(c);
    }
  }
  return best;
}

/** Strip the <svg> wrapper and the full-canvas background rect from a decoration SVG,
 *  leaving just the decoration shape fragment (for rasterizing the occupancy grid). */
export function decoShapeFrag(decoSvg: string): string {
  return decoSvg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<rect\s+width="\d+"\s+height="\d+"[^>]*\/>/, "");
}

/** Largest empty rectangle clear of the decoration + a SAFE margin, in canvas space.
 *  Returns null when no usable open area exists (decoration fills the canvas). */
export function openRegion(frag: string, W: number, H: number, SAFE: number): Region | null {
  if (!frag.trim()) return { x: SAFE, y: SAFE, w: W - 2 * SAFE, h: H - 2 * SAFE };
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><g>${frag}</g></svg>`;
  const img = new Resvg(svg, { fitTo: { mode: "width", value: GW } }).render();
  const gw = img.width, gh = img.height, px = img.pixels;
  const occ = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) if (px[i * 4 + 3]! > 20) occ[i] = 1;
  const dil = occ.slice();
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (occ[y * gw + x]) {
    for (let dy = -PAD; dy <= PAD; dy++) for (let dx = -PAD; dx <= PAD; dx++) {
      const ny = y + dy, nx = x + dx; if (ny >= 0 && ny < gh && nx >= 0 && nx < gw) dil[ny * gw + nx] = 1;
    }
  }
  const mc = Math.round((SAFE / W) * gw);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (x < mc || x >= gw - mc || y < mc || y >= gh - mc) dil[y * gw + x] = 1;
  const b = largestEmptyRect(dil, gw, gh);
  if (b.area < gw * gh * 0.06) return null;
  const cw = W / gw, ch = H / gh;
  return { x: Math.round(b.x * cw), y: Math.round(b.y * ch), w: Math.round(b.w * cw), h: Math.round(b.h * ch) };
}
