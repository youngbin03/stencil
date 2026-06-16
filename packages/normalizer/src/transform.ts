import type { Element } from "@xmldom/xmldom";
import type { BBox } from "@stencil/ir";

/**
 * SVG transform handling. Figma exports place images/shapes inside groups with
 * `transform` (translate/matrix), so attribute coordinates are local — we must
 * compose the ancestor chain to get true viewBox-space bboxes.
 */

export interface Matrix {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function nums(s: string): number[] {
  return (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

/** Parse one `transform` attribute (translate/scale/matrix/rotate-lite). */
export function parseTransform(value: string): Matrix {
  let m = IDENTITY;
  const re = /(translate|scale|matrix|rotate)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const [, op, args] = match;
    const p = nums(args!);
    let t: Matrix = IDENTITY;
    if (op === "translate") t = { ...IDENTITY, e: p[0] ?? 0, f: p[1] ?? 0 };
    else if (op === "scale") t = { ...IDENTITY, a: p[0] ?? 1, d: p[1] ?? p[0] ?? 1 };
    else if (op === "matrix" && p.length === 6) t = { a: p[0]!, b: p[1]!, c: p[2]!, d: p[3]!, e: p[4]!, f: p[5]! };
    else if (op === "rotate") {
      const r = ((p[0] ?? 0) * Math.PI) / 180;
      t = { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 };
    }
    m = mul(m, t);
  }
  return m;
}

/** Composed transform from the viewBox root down to (and including) `el`. */
export function accumulatedTransform(el: Element): Matrix {
  const chain: Matrix[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeName) {
    const tv = cur.getAttribute?.("transform");
    if (tv) chain.push(parseTransform(tv));
    cur = cur.parentNode as Element | null;
  }
  // chain is self→root; compose root→self.
  let m = IDENTITY;
  for (let i = chain.length - 1; i >= 0; i--) m = mul(m, chain[i]!);
  return m;
}

/** Transform a local bbox into viewBox space (axis-aligned bounding of corners). */
export function applyBBox(box: BBox, m: Matrix): BBox {
  const pts = [
    [box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h],
  ].map(([x, y]) => ({ x: m.a * x! + m.c * y! + m.e, y: m.b * x! + m.d * y! + m.f }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}
