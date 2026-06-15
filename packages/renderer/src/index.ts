import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import type {
  RenderAdapter,
  RenderSlide,
  RenderTextElement,
  Tokens,
} from "@stencil/ir";

/**
 * M5 renderer — "inplace" adapter (DEVDOC 6/M5, v1).
 *
 * Takes the original template SVG as the base and replaces only the text
 * content of matched slots. Font, color, position and every non-text element
 * are left exactly as authored — the design is preserved pixel-for-pixel.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function findTextById(doc: ReturnType<DOMParser["parseFromString"]>, id: string): Element | null {
  const texts = doc.getElementsByTagName("text");
  for (let i = 0; i < texts.length; i++) {
    if (texts[i]!.getAttribute("id") === id) return texts[i]!;
  }
  return null;
}

interface OrigLine {
  x: string | null;
  y: string | null;
}

function readOrigTspans(textEl: Element): OrigLine[] {
  const tspans = textEl.getElementsByTagName("tspan");
  const out: OrigLine[] = [];
  for (let i = 0; i < tspans.length; i++) {
    out.push({ x: tspans[i]!.getAttribute("x"), y: tspans[i]!.getAttribute("y") });
  }
  return out;
}

/** Replace a <text>'s children with new <tspan> lines, reusing original x/y. */
function replaceText(
  doc: ReturnType<DOMParser["parseFromString"]>,
  textEl: Element,
  el: RenderTextElement,
): void {
  const orig = readOrigTspans(textEl);
  const baseX = orig[0]?.x ?? String(el.bbox.x);
  const firstY = orig[0]?.y ? Number.parseFloat(orig[0].y) : el.bbox.y + el.fontSize * 0.8;
  const gap =
    orig.length >= 2 && orig[0]?.y && orig[1]?.y
      ? Number.parseFloat(orig[1].y) - Number.parseFloat(orig[0].y)
      : el.fontSize * el.lineHeight;

  while (textEl.firstChild) textEl.removeChild(textEl.firstChild);

  el.lines.forEach((line, i) => {
    const tspan = doc.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", orig[i]?.x ?? baseX);
    tspan.setAttribute("y", orig[i]?.y ?? String(firstY + i * gap));
    tspan.appendChild(doc.createTextNode(line));
    textEl.appendChild(tspan);
  });
}

export function renderInplace(slide: RenderSlide, baseSvg: string): string {
  const doc = new DOMParser().parseFromString(baseSvg, "image/svg+xml");

  for (const el of slide.elements) {
    if (el.kind !== "text") continue;
    const textEl = findTextById(doc, el.id);
    if (!textEl) continue;
    textEl.setAttribute("data-role", el.role);
    replaceText(doc, textEl, el);
  }

  return new XMLSerializer().serializeToString(doc);
}

export const inplaceAdapter: RenderAdapter = {
  id: "inplace",
  render(slide: RenderSlide, baseSvg: string, _tokens: Tokens): string {
    return renderInplace(slide, baseSvg);
  },
};
