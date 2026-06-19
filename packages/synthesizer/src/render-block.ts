import type { LayoutSig } from "./layout-bank.js";
import type { PlanBlock } from "./select.js";

/**
 * Phase 3 — map a content block onto the CHOSEN real layout's roles, producing a
 * PlacementPlan the solver/renderer consume. The layout's own measured geometry, card
 * device, colours and decoration then render faithfully (cards reflow to the block's
 * item count). Pure: no solver/renderer import here.
 */
export interface BlockPlacement { layoutId: string; singles: Record<string, string>; cards: Record<string, string>[]; }

const pick = (have: Set<string>, prefs: string[]): string | null => prefs.find((r) => have.has(r)) ?? null;
const str = (v: unknown): string => (Array.isArray(v) ? v.join("  ") : String(v ?? ""));

export function planFromBlock(sig: LayoutSig, block: PlanBlock): BlockPlacement {
  const L = sig.layout;
  // singles are keyed by slot.id in the solver (real layouts: id="Title", role="title")
  const roleToId = new Map<string, string>();
  for (const s of L.slots) if (s.type === "text" && !roleToId.has(s.role)) roleToId.set(s.role, s.id);
  const textRoles = new Set(roleToId.keys());
  const cardRoles = new Set(sig.cardRoles);
  const singles: Record<string, string> = {};
  const set = (prefs: string[], val: unknown): void => { const v = str(val); if (!v) return; const r = pick(textRoles, prefs); if (r) { const id = roleToId.get(r)!; if (!(id in singles)) singles[id] = v; } };
  // fill one card from (rolePrefs,value) pairs against the layout's card roles
  const mkCard = (pairs: [string[], unknown][]): Record<string, string> => {
    const c: Record<string, string> = {};
    for (const [prefs, val] of pairs) { const v = str(val); if (!v) continue; const r = pick(cardRoles, prefs); if (r && !(r in c)) c[r] = v; }
    return c;
  };
  const d = block.data as Record<string, any>;
  const cards: Record<string, string>[] = [];

  switch (block.kind) {
    case "title": case "feature":
      set(["eyebrow", "label", "subtitle"], d.eyebrow); set(["title", "headline"], d.title); set(["body", "subtitle", "caption"], d.body); break;
    case "statement":
      set(["eyebrow", "label"], d.eyebrow); set(["title", "headline"], (d.lines ?? []).join(" ")); set(["body", "subtitle"], d.body); break;
    case "quote":
      set(["quote", "title", "headline"], (d.q ?? []).join(" ")); set(["caption", "label", "body", "eyebrow"], d.cap); break;
    case "metricRow":
      set(["title", "headline", "eyebrow"], d.title);
      for (const m of (d.metrics ?? [])) cards.push(mkCard([[["kpi", "bignum", "headline", "title"], m.value], [["caption", "label", "body"], m.caption]]));
      break;
    case "list":
      set(["eyebrow", "title", "headline"], d.header);
      for (const it of (d.items ?? [])) cards.push(mkCard([[["headline", "label", "title", "kpi"], it.label], [["body", "caption", "subtitle"], it.desc]]));
      break;
    case "comparison":
      set(["title", "headline", "eyebrow"], d.title);
      for (const col of [d.left, d.right]) if (col) cards.push(mkCard([[["headline", "label", "title", "subtitle"], col.label], [["body", "caption"], (col.points ?? []).join(" · ")]]));
      break;
    case "gallery":
      set(["title", "headline", "eyebrow"], d.title);
      for (const c of (d.captions ?? [])) cards.push(mkCard([[["caption", "label", "body", "subtitle"], c]]));
      break;
  }
  return { layoutId: L.id, singles, cards };
}
