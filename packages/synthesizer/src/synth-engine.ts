import type {
  BBox, CardSpec, CardTemplateSlot, Layout, PlacedSlot, PlacementPlan, Region, Role, TextAlign,
} from "@stencil/ir";
import type { ArchetypeZone, GrammarSpec } from "./grammar.js";

/**
 * Grammar-only layout synthesis (DEVDOC Phase 6). Instantiates a mined archetype
 * skeleton (normalized zones) into a concrete Layout using ONLY the GrammarSpec —
 * the theme's grid guides, spacing rhythm, type scale and measured card internals.
 * No original frame is copied; the skeleton is an aggregated pattern and all
 * geometry is regenerated. Output feeds the existing solver + renderer.
 */

export interface ContentPlan {
  archetype: string;
  singles: Partial<Record<Role, string>>;
  cards?: Record<string, string>[];
}

const ZONE_ROLES: Record<string, Role[]> = {
  header: ["eyebrow", "label", "pagenum", "caption"],
  title: ["title", "headline", "quote", "subtitle"],
  body: ["body", "subtitle", "bullet", "caption"],
  footer: ["footer", "pagenum", "caption", "label"],
};

function snap(guides: number[], v: number, tol: number): number {
  let best = v, bestD = tol;
  for (const g of guides) { const d = Math.abs(g - v); if (d < bestD) { best = g; bestD = d; } }
  return Math.round(best);
}

function cardSpecForBlock(spec: GrammarSpec, blockId: string): { roles: Role[]; cs: CardSpec | undefined } {
  const block = spec.blocks.find((b) => b.id === blockId);
  const roles = (block?.slots ?? []).map((s) => s.role);
  const cs = spec.cardSpecs[roles.join("/")];
  return { roles, cs };
}

export function synthesizeFromGrammar(spec: GrammarSpec, plan: ContentPlan): { layout: Layout; placement: PlacementPlan } {
  const W = spec.canvas.w, H = spec.canvas.h, lh = 1.15;
  const xG = spec.alignment.xGuides, yG = spec.alignment.yGuides;
  const snapX = (v: number): number => snap(xG, v, W * 0.045);
  const skeleton = spec.archetypes.find((a) => a.archetype === plan.archetype) ?? spec.archetypes[0]!;
  const zoneById = new Map(skeleton.zones.map((z) => [z.id, z]));
  const { tight, loose, section } = spec.spacing.gaps;
  const hasCards = !!plan.cards?.length;

  // Horizontal placement from the mined x-band of the zone (kept to preserve the
  // theme's column feel); falls back to a left margin column.
  const colX = (id: string, defFracW: number): { x: number; w: number } => {
    const z = zoneById.get(id);
    const x0 = z ? snapX(z.xFrac[0] * W) : snapX(spec.alignment.margin);
    const x1 = z ? snapX(z.xFrac[1] * W) : snapX(Math.round(W * (spec.alignment.margin / W + defFracW)));
    return { x: Math.max(snapX(spec.alignment.margin), x0), w: Math.max(Math.round(W * 0.25), x1 - x0) };
  };

  // Build the vertical stack (header → title → cards|body) as relative blocks,
  // then center the whole group; footer is pinned to the bottom band. This makes
  // overlap impossible while still honouring mined columns, type scale, rhythm and
  // the theme's MEASURED card internals.
  interface Item { id: string; role?: Role; kind: "single" | "cards"; x: number; w: number; h: number; relY: number; }
  const items: Item[] = [];
  const usedRole = new Set<Role>();
  const pickRole = (zoneId: string): Role | undefined => {
    const prefs = ZONE_ROLES[zoneId] ?? [];
    return prefs.find((r) => plan.singles[r] !== undefined && !usedRole.has(r));
  };

  let rel = 0;
  const order = ["header", "title", hasCards ? "cards" : "body"];
  let cardSpec: CardSpec | undefined;
  for (const zoneId of order) {
    if (zoneId === "cards") {
      const z = zoneById.get("cards");
      const blockId = z?.block ?? spec.blocks.find((b) => b.slots.some((s) => plan.cards![0]![s.role] !== undefined))?.id;
      if (!blockId) continue;
      const { roles, cs } = cardSpecForBlock(spec, blockId);
      const useRoles = roles.length ? roles : (Object.keys(plan.cards![0]!) as Role[]);
      const col = colX("cards", 0.9);
      const rowW = W - 2 * snapX(spec.alignment.margin);
      const cardW = cs?.cardW ?? Math.round(rowW / Math.max(1, plan.cards!.length) * 0.9);
      const rowH = cs ? cs.rowBBox.h : Math.ceil(useRoles.reduce((s, r) => s + (spec.type[r]?.size ?? 40) * lh * 1.4, 0));
      const template: CardTemplateSlot[] = cs
        ? cs.template.map((t) => ({ ...t }))
        : useRoles.map((role, i) => ({ role, type: "text" as const, dx: 0, dy: i * Math.ceil((spec.type[role]?.size ?? 40) * 1.4),
            w: cardW, h: Math.ceil((spec.type[role]?.size ?? 40) * 1.3), fontSize: spec.type[role]?.size ?? 40, fontWeight: spec.type[role]?.weight ?? 400, color: spec.colors.text, align: "left" as TextAlign }));
      items.push({ id: "cards", kind: "cards", x: snapX(spec.alignment.margin), w: rowW, h: rowH, relY: rel });
      cardSpec = { template, rowBBox: { x: snapX(spec.alignment.margin), y: 0, w: rowW, h: rowH }, cardW, colY0: 0, baseCount: plan.cards!.length, roles: useRoles, memberIds: [], decorationIds: [] };
      rel += rowH + section;
      continue;
    }
    const role = pickRole(zoneId);
    if (!role) continue;
    usedRole.add(role);
    const t = spec.type[role];
    const lines = role === "title" || role === "headline" || role === "quote" ? 2 : role === "body" || role === "subtitle" ? 3 : 1;
    const h = Math.ceil((t?.size ?? 24) * lh * lines);
    const col = colX(zoneId, role === "title" || role === "quote" ? 0.6 : 0.5);
    items.push({ id: zoneId, role, kind: "single", x: col.x, w: col.w, h, relY: rel });
    rel += h + (zoneId === "header" ? tight : loose);
  }
  const groupH = rel;
  const top = Math.max(snapX(spec.alignment.margin), Math.round((H - groupH) / 2)); // vertical centering

  const slots: PlacedSlot[] = [];
  const regions: Region[] = [];
  const singles: Record<string, string> = {};
  const defaultSlots: string[] = [];
  for (const it of items) {
    const bbox: BBox = { x: it.x, y: top + it.relY, w: it.w, h: it.h };
    if (it.kind === "cards") {
      cardSpec!.rowBBox = bbox; cardSpec!.colY0 = bbox.y;
      regions.push({ id: "cards", bbox, flow: "row", gap: spec.spacing.gaps.normal, allowedBlocks: zoneById.get("cards")?.block ? [zoneById.get("cards")!.block!] : [], slotIds: [], blockId: zoneById.get("cards")?.block ?? "cards" });
      continue;
    }
    const t = spec.type[it.role!];
    slots.push({ id: it.id, role: it.role!, type: "text", bbox, align: "left", fontSize: t?.size ?? 24, fontWeight: t?.weight ?? 400, color: spec.colors.text, ...(t?.family ? { fontFamily: t.family } : {}) });
    regions.push({ id: it.id, bbox, flow: "column", gap: loose, allowedBlocks: [], slotIds: [it.id] });
    singles[it.id] = plan.singles[it.role!]!;
    defaultSlots.push(it.id);
  }

  // footer pinned to the bottom band, if the plan supplies a footer-ish role.
  const fRole = pickRole("footer");
  if (fRole) {
    const t = spec.type[fRole];
    const h = Math.ceil((t?.size ?? 20) * lh);
    const col = colX("footer", 0.5);
    const bbox: BBox = { x: col.x, y: Math.round(H * 0.92), w: col.w, h };
    slots.push({ id: "footer", role: fRole, type: "text", bbox, align: "left", fontSize: t?.size ?? 20, fontWeight: t?.weight ?? 400, color: spec.colors.text, ...(t?.family ? { fontFamily: t.family } : {}) });
    regions.push({ id: "footer", bbox, flow: "row", gap: tight, allowedBlocks: [], slotIds: ["footer"] });
    singles.footer = plan.singles[fRole]!;
    defaultSlots.push("footer");
  }

  const layout: Layout = {
    id: `synth_${plan.archetype}_${spec.theme}`,
    decorationRef: "", background: spec.colors.bg,
    slots, regions, defaultSlots,
    ...(cardSpec ? { cardSpec } : {}),
  };
  return { layout, placement: { layoutId: layout.id, cards: plan.cards ?? [], singles } };
}
