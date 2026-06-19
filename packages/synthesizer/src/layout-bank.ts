import type { DesignSystemIR, Layout, BBox } from "@stencil/ir";

/**
 * Phase 0 — Layout bank. A MEASURED signature per real template layout. No single
 * "shapeKind" label (that abstraction lost information / mis-bucketed); the raw
 * signature dimensions are the matching key (see select.ts). All fields are extracted,
 * so this generalizes to any imported+baked template.
 */

// chrome roles are page furniture, not content cards
const CHROME = new Set(["eyebrow", "pagenum", "footer"]);

export interface LayoutSig {
  id: string;
  archetype: string;
  background: string;
  textSlots: number;
  imageCount: number;
  cardCount: number;       // cardSpec.baseCount (0 if none)
  cardRoles: string[];     // distinct template roles
  /** a real card device = >=1 card whose roles include a non-chrome (content) role.
   *  Filters extraction noise like [eyebrow/eyebrow] while keeping [label x4] lists. */
  cardUsable: boolean;
  hasBigNumber: boolean;   // a kpi / bignum role anywhere
  hasQuote: boolean;
  region: BBox | null;     // bbox union of core (non-chrome) slots
  decorationRef: string;
  layout: Layout;          // the real layout — rendered faithfully downstream
}

export function signature(L: Layout): LayoutSig {
  const slots = L.slots ?? [];
  const textSlots = slots.filter((s) => s.type === "text").length;
  const imageCount = slots.filter((s) => s.type === "image").length;
  const cs = (L as { cardSpec?: { baseCount?: number; roles?: string[] } }).cardSpec;
  const cardCount = cs?.baseCount ?? 0;
  const cardRoles = [...new Set(cs?.roles ?? [])];
  const cardUsable = cardCount >= 1 && cardRoles.some((r) => !CHROME.has(r));
  const arch = (L as { archetype?: string }).archetype ?? "?";
  const roles = new Set<string>([...slots.map((s) => s.role), ...cardRoles]);
  const hasBigNumber = roles.has("kpi") || roles.has("bignum");
  const hasQuote = roles.has("quote") || arch === "quote";
  const core = slots.filter((s) => s.bbox && !CHROME.has(s.role));
  const region = core.length
    ? {
        x: Math.min(...core.map((s) => s.bbox!.x)),
        y: Math.min(...core.map((s) => s.bbox!.y)),
        w: Math.max(...core.map((s) => s.bbox!.x + s.bbox!.w)) - Math.min(...core.map((s) => s.bbox!.x)),
        h: Math.max(...core.map((s) => s.bbox!.y + s.bbox!.h)) - Math.min(...core.map((s) => s.bbox!.y)),
      }
    : null;
  return { id: L.id, archetype: arch, background: (L as { background?: string }).background ?? "#FFFFFF", textSlots, imageCount, cardCount, cardRoles, cardUsable, hasBigNumber, hasQuote, region, decorationRef: (L as { decorationRef?: string }).decorationRef ?? "", layout: L };
}

export function buildLayoutBank(system: DesignSystemIR): LayoutSig[] {
  return (system.layouts ?? []).map(signature);
}
