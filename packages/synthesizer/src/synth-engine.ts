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

/** A user-provided image (we place, never generate). */
export interface Asset {
  id: string;
  url: string;       // data URI or URL
  ratio?: number;    // w/h, for best-fit zone matching
  desc?: string;
  mediaKind?: string;
}

export interface ContentPlan {
  archetype: string;
  singles: Partial<Record<Role, string>>;
  cards?: Record<string, string>[];
  /** Optional user images; placed into the archetype's image zones (cover-crop). */
  images?: Asset[];
}

const ZONE_ROLES: Record<string, Role[]> = {
  header: ["eyebrow", "label", "pagenum", "caption"],
  title: ["title", "headline", "quote", "subtitle"],
  body: ["body", "subtitle", "bullet", "caption"],
  footer: ["footer", "pagenum", "caption", "label"],
};

/** The content an archetype expects — single roles + card roles + image count.
 * Drives the LLM content planner so it writes exactly what the layout needs. */
export function archetypeSchema(spec: GrammarSpec, archetype: string): { archetype: string; singles: Role[]; cardRoles: Role[]; images: number } {
  const sk = spec.archetypes.find((a) => a.archetype === archetype) ?? spec.archetypes[0]!;
  const singles: Role[] = [];
  for (const z of sk.zones) {
    if (z.id === "cards") continue;
    const role = (ZONE_ROLES[z.id] ?? []).find((r) => !singles.includes(r));
    if (role) singles.push(role);
  }
  const cardsZone = sk.zones.find((z) => z.block);
  const cardRoles = cardsZone ? (spec.blocks.find((b) => b.id === cardsZone.block)?.slots.map((s) => s.role) ?? []) : [];
  return { archetype, singles, cardRoles, images: sk.imageZones.length };
}

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

  // --- baseline design floor (always enforced, independent of theme) ---
  // Inner padding: a comfortable safe margin even when the theme's grid is tight
  // (e.g. colorful's 31px hugged the edges). Minimum readable font size.
  const SAFE = Math.max(spec.alignment.margin, Math.round(W * 0.05));
  const MIN_FONT = Math.round(H * 0.017); // ~18px at 1080p — readability floor
  const LEAD_MIN = Math.round(H * 0.05);  // ~54px — every slide needs one focal line
  const sz = (v: number): number => Math.max(v, MIN_FONT);
  const DISPLAY: ReadonlySet<Role> = new Set(["title", "headline", "quote", "kpi", "subtitle"]);

  // User images → place into this archetype's image zones (cover-crop) and reserve
  // their space, constraining the text column to the complementary side (or above
  // an image row). We place, never generate; only as many zones as images given.
  const margin = SAFE;
  const snapBox = (z: { xFrac: [number, number]; yFrac: [number, number] }): BBox => {
    const x = snapX(z.xFrac[0] * W), x1 = snapX(z.xFrac[1] * W);
    const y = Math.round(z.yFrac[0] * H), y1 = Math.round(z.yFrac[1] * H);
    return { x, y, w: Math.max(60, x1 - x), h: Math.max(60, y1 - y) };
  };
  const useImages = (plan.images ?? []).slice(0, skeleton.imageZones.length);
  const imageBoxes = skeleton.imageZones.slice(0, useImages.length).map(snapBox);
  let tx0 = margin, tx1 = W - margin, textBottomCap = H;
  if (imageBoxes.length) {
    const minX = Math.min(...imageBoxes.map((b) => b.x));
    const maxR = Math.max(...imageBoxes.map((b) => b.x + b.w));
    const minY = Math.min(...imageBoxes.map((b) => b.y));
    if (maxR - minX > W * 0.6) textBottomCap = Math.max(H * 0.4, minY - section); // image row → text above
    else if (minX > W * 0.5) tx1 = minX - section;                                 // images right → text left
    else tx0 = maxR + section;                                                      // images left → text right
  }

  // Horizontal placement: mined x-band clamped into the text column [tx0, tx1].
  const colX = (id: string, defFracW: number): { x: number; w: number } => {
    const z = zoneById.get(id);
    let x0 = z ? snapX(z.xFrac[0] * W) : tx0;
    let x1 = z ? snapX(z.xFrac[1] * W) : Math.round(tx0 + W * defFracW);
    x0 = Math.min(Math.max(tx0, x0), tx1 - Math.round(W * 0.18));
    x1 = Math.min(tx1, Math.max(x0 + Math.round(W * 0.2), x1));
    return { x: x0, w: x1 - x0 };
  };

  // Build the vertical stack (header → title → cards|body) as relative blocks,
  // then center the whole group; footer is pinned to the bottom band. This makes
  // overlap impossible while still honouring mined columns, type scale, rhythm and
  // the theme's MEASURED card internals.
  interface Item { id: string; role?: Role; kind: "single" | "cards"; x: number; w: number; h: number; relY: number; fontSize?: number; }
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
      const rowW = tx1 - tx0;
      const cardW = Math.min(cs?.cardW ?? Math.round(rowW / Math.max(1, plan.cards!.length) * 0.9), Math.round(rowW / Math.max(1, plan.cards!.length)));
      const rowH = cs ? cs.rowBBox.h : Math.ceil(useRoles.reduce((s, r) => s + (spec.type[r]?.size ?? 40) * lh * 1.4, 0));
      const template: CardTemplateSlot[] = cs
        ? cs.template.map((t) => ({ ...t }))
        : useRoles.map((role, i) => ({ role, type: "text" as const, dx: 0, dy: i * Math.ceil((spec.type[role]?.size ?? 40) * 1.4),
            w: cardW, h: Math.ceil((spec.type[role]?.size ?? 40) * 1.3), fontSize: sz(spec.type[role]?.size ?? 40), fontWeight: spec.type[role]?.weight ?? 400, color: spec.colors.text, align: "left" as TextAlign }));
      items.push({ id: "cards", kind: "cards", x: tx0, w: rowW, h: rowH, relY: rel });
      cardSpec = { template, rowBBox: { x: tx0, y: 0, w: rowW, h: rowH }, cardW, colY0: 0, baseCount: plan.cards!.length, roles: useRoles, memberIds: [], decorationIds: [] };
      rel += rowH + section;
      continue;
    }
    const role = pickRole(zoneId);
    if (!role) continue;
    usedRole.add(role);
    const t = spec.type[role];
    const fontSize = sz(t?.size ?? 24);
    const lines = role === "title" || role === "headline" || role === "quote" ? 2 : role === "body" || role === "subtitle" ? 3 : 1;
    const h = Math.ceil(fontSize * lh * lines);
    const col = colX(zoneId, role === "title" || role === "quote" ? 0.6 : 0.5);
    // Mined zone widths come from short source text and can be too narrow for
    // generated copy (titles wrapping into many narrow lines). Enforce a role-based
    // minimum width so headings read on 1-2 lines.
    const colW = tx1 - tx0;
    const minW = role === "title" || role === "headline" || role === "quote" ? Math.round(colW * 0.66)
      : role === "body" || role === "subtitle" ? Math.round(colW * 0.55) : col.w;
    const w = Math.min(Math.max(col.w, minW), tx1 - col.x);
    items.push({ id: zoneId, role, kind: "single", x: col.x, w, h, relY: rel, fontSize });
    rel += h + (zoneId === "header" ? tight : loose);
  }

  // Lead-size floor: every slide needs one focal line. If nothing display-sized
  // exists (no cards, no title/headline/kpi), promote the largest single to LEAD_MIN.
  const hasDisplay = !!cardSpec || items.some((it) => it.role && DISPLAY.has(it.role) && (it.fontSize ?? 0) >= LEAD_MIN);
  if (!hasDisplay) {
    // Promote the most content-meaningful single (title/body before label/eyebrow),
    // so the focal line carries substance — not a kicker like "Traction".
    const order = ["title", "headline", "quote", "subtitle", "body", "kpi", "bullet", "label", "eyebrow", "caption", "footer"];
    const lead = [...items].filter((it) => it.kind === "single")
      .sort((a, b) => order.indexOf(a.role as string) - order.indexOf(b.role as string))[0];
    if (lead && (lead.fontSize ?? 0) < LEAD_MIN) {
      const newH = Math.ceil(LEAD_MIN * lh * 2);
      const delta = newH - lead.h;
      lead.fontSize = LEAD_MIN;
      lead.h = newH;
      for (const it of items) if (it.relY > lead.relY) it.relY += delta;
      rel += delta;
    }
  }
  const groupH = rel;
  // Center the text group in the available vertical space (full height for side
  // images; above the band for an image row).
  const top = Math.min(Math.max(margin, Math.round((textBottomCap - groupH) / 2)), Math.max(margin, textBottomCap - groupH));

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
    slots.push({ id: it.id, role: it.role!, type: "text", bbox, align: "left", fontSize: it.fontSize ?? sz(t?.size ?? 24), fontWeight: t?.weight ?? 400, color: spec.colors.text, ...(t?.family ? { fontFamily: t.family } : {}) });
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
    slots.push({ id: "footer", role: fRole, type: "text", bbox, align: "left", fontSize: sz(t?.size ?? 20), fontWeight: t?.weight ?? 400, color: spec.colors.text, ...(t?.family ? { fontFamily: t.family } : {}) });
    regions.push({ id: "footer", bbox, flow: "row", gap: tight, allowedBlocks: [], slotIds: ["footer"] });
    singles.footer = plan.singles[fRole]!;
    defaultSlots.push("footer");
  }

  // Place user images into the reserved zones (cover-crop), bound by order.
  const images: Record<string, string> = {};
  imageBoxes.forEach((bbox, i) => {
    const id = `image_${i}`;
    const slot: PlacedSlot = { id, role: "image", type: "image", bbox, align: "left" };
    const mk = skeleton.imageZones[i]?.mediaKind;
    if (mk) slot.mediaKind = mk as NonNullable<PlacedSlot["mediaKind"]>;
    slots.push(slot);
    images[id] = useImages[i]!.url;
  });

  const layout: Layout = {
    id: `synth_${plan.archetype}_${spec.theme}`,
    decorationRef: "", background: spec.colors.bg,
    slots, regions, defaultSlots,
    ...(cardSpec ? { cardSpec } : {}),
  };
  const placement: PlacementPlan = { layoutId: layout.id, cards: plan.cards ?? [], singles };
  if (Object.keys(images).length) placement.images = images;
  return { layout, placement };
}
