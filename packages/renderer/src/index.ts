import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import type { RenderAdapter, RenderImageElement, RenderRectElement, RenderSlide, RenderTextElement, Tokens } from "@stencil/ir";

/**
 * Assemble stage — renderer (DEVDOC ④/⑤, "composite" adapter).
 *
 * Lays the decoration-only SVG fragment as the base and synthesizes editable
 * <text> (and user <image>) on top from the solved render tree. The original
 * template SVG is never read; only the decoration fragment + tokens are used.
 */

const SVG_NS_CLOSE = "</svg>";
const ASCENT = 0.8;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function anchorFor(el: RenderTextElement): { x: number; anchor: string } {
  if (el.align === "center") return { x: el.bbox.x + el.bbox.w / 2, anchor: "middle" };
  if (el.align === "right") return { x: el.bbox.x + el.bbox.w, anchor: "end" };
  return { x: el.bbox.x, anchor: "start" };
}

function renderText(el: RenderTextElement): string {
  const { x, anchor } = anchorFor(el);
  const firstBaseline = el.bbox.y + el.fontSize * ASCENT;
  const step = el.fontSize * el.lineHeight;
  const tspans = el.lines
    .map((line, i) => `<tspan x="${x}" y="${(firstBaseline + i * step).toFixed(2)}">${escapeXml(line)}</tspan>`)
    .join("");
  const ls = el.letterSpacing ? ` letter-spacing="${el.letterSpacing}"` : "";
  return (
    `<text id="${escapeXml(el.id)}" data-role="${el.role}" fill="${el.color}" ` +
    `font-family="${escapeXml(el.fontFamily)}" font-size="${el.fontSize}" font-weight="${el.fontWeight}"${ls} ` +
    `text-anchor="${anchor}" style="white-space:pre">${tspans}</text>`
  );
}

function renderImage(el: RenderImageElement, i: number): string {
  const clip = `clip_${i}`;
  const { x, y, w, h } = el.bbox;
  // A non-rect clip (e.g. a mockup screen path with a notch) clips the image to the
  // exact shape; otherwise the bbox rect. Image still cover-crops to fill the bbox.
  const clipShape = el.clip
    ? `<path d="${escapeXml(el.clip)}"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  return (
    `<clipPath id="${clip}">${clipShape}</clipPath>` +
    `<image href="${escapeXml(el.assetUrl)}" x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" data-role="${el.role}"/>`
  );
}

function renderRect(el: RenderRectElement): string {
  const { x, y, w, h } = el.bbox;
  const rx = el.rx ? ` rx="${el.rx}"` : "";
  return `<rect id="${escapeXml(el.id)}" x="${x}" y="${y}" width="${w}" height="${h}" fill="${el.fill}"${rx}/>`;
}

/** Remove decoration elements (any tag) whose id is in the suppress list. */
function suppressDecoration(decorationSvg: string, ids: string[]): string {
  const doc = new DOMParser().parseFromString(decorationSvg, "image/svg+xml");
  const wanted = new Set(ids);
  const all = doc.getElementsByTagName("*");
  const remove: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    const id = all[i]!.getAttribute("id");
    if (id && wanted.has(id)) remove.push(all[i]!);
  }
  for (const n of remove) n.parentNode?.removeChild(n);
  return new XMLSerializer().serializeToString(doc);
}

export function renderComposite(slide: RenderSlide, decorationSvg: string): string {
  let base = decorationSvg;
  if (slide.suppressDecorationIds?.length) base = suppressDecoration(base, slide.suppressDecorationIds);

  const parts: string[] = [];
  slide.elements.forEach((el, i) => {
    if (el.kind === "text") parts.push(renderText(el));
    else if (el.kind === "image") parts.push(renderImage(el, i));
    else parts.push(renderRect(el));
  });
  const overlay = `<g id="__content__">${parts.join("")}</g>`;
  const close = base.lastIndexOf(SVG_NS_CLOSE);
  return close === -1 ? base + overlay : base.slice(0, close) + overlay + base.slice(close);
}

export const compositeAdapter: RenderAdapter = {
  id: "composite",
  render(slide: RenderSlide, decorationSvg: string, _tokens: Tokens): string {
    return renderComposite(slide, decorationSvg);
  },
};
