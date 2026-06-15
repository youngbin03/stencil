import { Resvg } from "@resvg/resvg-js";
import type { ManifestSlot } from "@stencil/ir";

/**
 * SVG → PNG rasterization for the vision classifier. Custom theme fonts may
 * fall back to system fonts; that is fine because the classifier also receives
 * structural metadata and reads text from the image.
 */

export function rasterize(svg: string, width = 1280): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true },
    background: "white",
  });
  return resvg.render().asPng();
}

/** Inject numbered boxes over each slot so the model can reference them by index. */
export function annotateSlots(svg: string, slots: ManifestSlot[]): string {
  const overlay = slots
    .map((s, i) => {
      const { x, y, w, h } = s.bbox;
      const n = i + 1;
      return (
        `<rect x="${x}" y="${y}" width="${Math.max(w, 8)}" height="${Math.max(h, 8)}" ` +
        `fill="none" stroke="#FF00AA" stroke-width="3"/>` +
        `<rect x="${x}" y="${y - 26}" width="${22 + String(n).length * 12}" height="24" fill="#FF00AA"/>` +
        `<text x="${x + 6}" y="${y - 8}" font-family="Arial" font-size="20" font-weight="700" fill="#FFFFFF">${n}</text>`
      );
    })
    .join("");
  const g = `<g id="__slot_overlay__">${overlay}</g>`;
  const close = svg.lastIndexOf("</svg>");
  return close === -1 ? svg : svg.slice(0, close) + g + svg.slice(close);
}
