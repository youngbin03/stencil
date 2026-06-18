import type { GrammarSpec } from "./grammar.js";

/**
 * DENSE content structures — the same well-composed, info-rich layouts proven in the
 * offline augmentation path (scripts/augment.mjs). Each structure renders a different
 * composition (title / list / kpi / quote / statement / bignum / steps / twocol) into
 * a region, styled by the THEME's own grammar (type scale + fonts). This is the shared
 * source of truth so live generation produces the same density as augmentation.
 *
 * Pure: render(region, fill, acc, data) -> SVG fragment string. No I/O, no raster.
 */

export interface Region { x: number; y: number; w: number; h: number; }
export type StructName = "title" | "list" | "kpi" | "quote" | "statement" | "bignum" | "steps" | "twocol";

interface TypeEntry { size?: number; weight?: number; family?: string; }

export interface Structure {
  fits: (r: Region) => boolean;
  /** approximate content height — used to vertically centre within a taller region */
  foot: (r: Region) => number;
  render: (r: Region, fill: string, acc: string, d: any) => string;
}

const escXml = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function makeStructures(spec: GrammarSpec, W: number, H: number): Record<StructName, Structure> {
  const type = spec.type as unknown as Record<string, TypeEntry | undefined>;
  const sizeOf = (role: string, fallback: number): number => type[role]?.size ?? fallback;
  const fam = (role: string): string => type[role]?.family ?? (spec as unknown as { fontFamily?: string }).fontFamily ?? "Inter";
  const weightOf = (role: string): number => type[role]?.weight ?? 400;

  // emit one text node, shrinking font to fit maxW (same width-fit as augmentation)
  const txt = (x: number, y: number, role: string, s: string, fill: string, maxW?: number): string => {
    let size = sizeOf(role, 40);
    const str = String(s ?? "");
    if (maxW && str.length) { const est = str.length * size * 0.56; if (est > maxW) size = Math.max(14, Math.floor(maxW / (str.length * 0.56))); }
    return `<text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${fam(role)}" font-size="${size}" font-weight="${weightOf(role)}" fill="${fill}" style="white-space:pre">${escXml(str)}</text>`;
  };

  return {
    title: {
      fits: (r) => r.h > H * 0.3 && r.w > W * 0.55,
      foot: () => sizeOf("title", 120) * 1.2 + sizeOf("eyebrow", 28) * 1.6 + sizeOf("body", 28) * 2,
      render: (r, fill, _acc, d) => {
        const ts = sizeOf("title", 120), cy = r.y + r.h * 0.34;
        let o = txt(r.x, cy, "eyebrow", d.eyebrow, fill, r.w) + txt(r.x, cy + ts * 0.9, "title", d.title, fill, r.w);
        if (d.body) o += txt(r.x, cy + ts * 0.9 + 78, "body", d.body, fill, r.w * 0.82);
        return o;
      },
    },
    list: {
      fits: (r) => r.h > H * 0.45 && r.w > W * 0.45,
      foot: (r) => 3 * Math.min(r.h / 3.4, 180) + 70,
      render: (r, fill, acc, d) => {
        const items: { label: string; desc: string }[] = d.items ?? [];
        const gap = Math.min(r.h / (items.length + 0.4), 180);
        let y = r.y + gap * 0.6;
        let out = txt(r.x, r.y + 34, "eyebrow", d.header, fill);
        items.forEach((it, idx) => {
          y += gap;
          out += txt(r.x, y, "headline", `0${idx + 1}`, fill)
            + txt(r.x + 240, y, "headline", it.label, fill, r.w - 540)
            + txt(r.x + 240, y + 42, "body", it.desc, fill, r.w - 260)
            + `<line x1="${r.x}" y1="${Math.round(y + 64)}" x2="${Math.round(r.x + r.w)}" y2="${Math.round(y + 64)}" stroke="${acc}" stroke-width="2"/>`;
        });
        return out;
      },
    },
    kpi: {
      fits: (r) => r.w > W * 0.6 && r.h > H * 0.38,
      foot: () => sizeOf("headline", 80) * 1.3 + sizeOf("kpi", 120) + sizeOf("caption", 28) * 2,
      render: (r, fill, _acc, d) => {
        let out = txt(r.x, r.y + sizeOf("headline", 80) * 0.82, "headline", d.title, fill, r.w);
        const k: string[] = d.k ?? [], cap: string[] = d.cap ?? [];
        const cw = r.w / Math.max(1, k.length), cy = r.y + r.h * 0.68;
        k.forEach((v, idx) => { const x = r.x + idx * cw; out += txt(x, cy, "kpi", v, fill, cw - 24) + txt(x, cy + 56, "caption", cap[idx] ?? "", fill, cw - 24); });
        return out;
      },
    },
    quote: {
      fits: (r) => r.h > H * 0.3 && r.w > W * 0.5,
      foot: () => 2 * sizeOf("quote", 120) + 70,
      render: (r, fill, _acc, d) => {
        const cy = r.y + r.h * 0.42, qs = sizeOf("quote", 120);
        const lines: string[] = d.q ?? [];
        let out = "";
        lines.forEach((line, i) => { out += txt(r.x, cy + i * qs, "quote", line, fill, r.w); });
        return out + txt(r.x, cy + lines.length * qs + 30, "caption", d.cap, fill, r.w);
      },
    },
    statement: {
      fits: (r) => r.w > W * 0.5 && r.h > H * 0.3,
      foot: () => sizeOf("headline", 80) * 2.3 + sizeOf("eyebrow", 28) * 1.5 + sizeOf("body", 28) * 2,
      render: (r, fill, _acc, d) => {
        const hs = sizeOf("headline", 80), cy = r.y + r.h * 0.34;
        const lines: string[] = d.lines ?? [];
        let out = txt(r.x, cy, "eyebrow", d.eyebrow, fill, r.w);
        lines.forEach((l, i) => { out += txt(r.x, cy + (i + 1) * hs * 1.05, "headline", l, fill, r.w); });
        if (d.body) out += txt(r.x, cy + (lines.length + 1) * hs * 1.05 + 30, "body", d.body, fill, r.w * 0.82);
        return out;
      },
    },
    bignum: {
      fits: (r) => r.w > W * 0.3 && r.h > H * 0.3,
      foot: () => sizeOf("kpi", 120) + sizeOf("caption", 28) + sizeOf("body", 28) * 2,
      render: (r, fill, _acc, d) => {
        const cy = r.y + r.h * 0.45;
        let out = txt(r.x, cy, "kpi", d.n, fill, r.w) + txt(r.x, cy + 56, "caption", d.cap, fill, r.w);
        if (d.body) out += txt(r.x, cy + 56 + 60, "body", d.body, fill, Math.min(r.w, W * 0.42));
        return out;
      },
    },
    steps: {
      fits: (r) => r.w > W * 0.6 && r.h > H * 0.25,
      foot: () => sizeOf("headline", 80) + sizeOf("label", 28) + sizeOf("body", 28) * 2.4,
      render: (r, fill, _acc, d) => {
        const steps: string[][] = d.steps ?? [];
        const cw = r.w / Math.max(1, steps.length), cy = r.y + r.h * 0.4, gapL = sizeOf("headline", 80) * 0.8;
        let out = "";
        steps.forEach((s, i) => {
          const x = r.x + i * cw;
          out += txt(x, cy, "headline", s[0] ?? `0${i + 1}`, fill, cw - 24) + txt(x, cy + gapL, "label", s[1] ?? "", fill, cw - 24);
          if (s[2]) out += txt(x, cy + gapL + 40, "body", s[2], fill, cw - 24);
        });
        return out;
      },
    },
    twocol: {
      fits: (r) => r.w > W * 0.6 && r.h > H * 0.3,
      foot: () => sizeOf("label", 28) * 1.8 + sizeOf("body", 28) * 2.6,
      render: (r, fill, _acc, d) => {
        const cols: { label: string; body: string[] }[] = d.cols ?? [];
        const cw = r.w / Math.max(1, cols.length), cy = r.y + r.h * 0.42;
        let out = "";
        cols.forEach((c, i) => {
          const x = r.x + i * cw;
          out += txt(x, cy, "label", c.label, fill, cw - 30);
          (c.body ?? []).forEach((b, j) => { out += txt(x, cy + 50 + j * 36, "body", b, fill, cw - 30); });
        });
        return out;
      },
    },
  };
}

/** Map a planner archetype to the densest structure that expresses it. Image/mockup
 *  archetypes are intentionally absent — those stay on the synth-engine path. */
export const STRUCTURE_FOR_ARCHETYPE: Record<string, StructName> = {
  cover: "title",
  closing: "title",
  section: "statement",
  agenda: "list",
  stat: "kpi",
  quote: "quote",
  comparison: "twocol",
  team: "list",
  content: "statement",
};

/** Per-structure LLM output schema + a writing hint. The model returns this shape
 *  directly; it is rendered verbatim by the matching structure. */
export const STRUCTURE_SCHEMA: Record<StructName, { schema: object; hint: string }> = {
  title: {
    hint: "A title slide: a short eyebrow (1-2 words), a punchy title (<= 6 words), and one supporting sentence.",
    schema: { type: "object", properties: { eyebrow: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["eyebrow", "title", "body"], additionalProperties: false },
  },
  list: {
    hint: "A 3-item list: a header, and 3 items each with a short label (2-4 words) and a one-sentence description.",
    schema: { type: "object", properties: { header: { type: "string" }, items: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", properties: { label: { type: "string" }, desc: { type: "string" } }, required: ["label", "desc"], additionalProperties: false } } }, required: ["header", "items"], additionalProperties: false },
  },
  kpi: {
    hint: "A metrics slide: a title, then exactly 3 metrics. k = the big numbers (e.g. +38%, 120K, 2.4x); cap = a short caption under each.",
    schema: { type: "object", properties: { title: { type: "string" }, k: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } }, cap: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } }, required: ["title", "k", "cap"], additionalProperties: false },
  },
  quote: {
    hint: "A quote slide: q = the quote split into 1-2 short lines; cap = the attribution.",
    schema: { type: "object", properties: { q: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } }, cap: { type: "string" } }, required: ["q", "cap"], additionalProperties: false },
  },
  statement: {
    hint: "A bold statement: a short eyebrow, lines = a 2-line headline, and one supporting sentence (body).",
    schema: { type: "object", properties: { eyebrow: { type: "string" }, lines: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } }, body: { type: "string" } }, required: ["eyebrow", "lines", "body"], additionalProperties: false },
  },
  bignum: {
    hint: "A single focal metric: n = the number (e.g. 10x), cap = a short caption, body = one supporting sentence.",
    schema: { type: "object", properties: { n: { type: "string" }, cap: { type: "string" }, body: { type: "string" } }, required: ["n", "cap", "body"], additionalProperties: false },
  },
  steps: {
    hint: "3 horizontal steps: each step = [number, label, one short description]. e.g. ['01','Discover','Frame the real problem'].",
    schema: { type: "object", properties: { steps: { type: "array", minItems: 3, maxItems: 3, items: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } } }, required: ["steps"], additionalProperties: false },
  },
  twocol: {
    hint: "Two side-by-side columns (before/after, problem/solution): each col = a label and a 2-line body.",
    schema: { type: "object", properties: { cols: { type: "array", minItems: 2, maxItems: 2, items: { type: "object", properties: { label: { type: "string" }, body: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } } }, required: ["label", "body"], additionalProperties: false } } }, required: ["cols"], additionalProperties: false },
  },
};
