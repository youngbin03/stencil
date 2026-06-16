import Anthropic from "@anthropic-ai/sdk";
import type { Layout, PlacementPlan } from "@stencil/ir";
import { detectRepeatGroup } from "@stencil/solver";

/**
 * Placement director (DEVDOC Phase 4.7-a). Given a layout (its repeatable card
 * roles + fixed single slots) and the slide's purpose, Claude decides how many
 * cards to produce and writes content for cards + singles. Coordinate-free:
 * the solver reflows the cards by the relation graph. Claude does not emit
 * positions, sizes, or colors.
 */

export interface AssetRef {
  id: string;
  /** URL or data-URI placed into the slot. */
  url: string;
  /** Short description to help the model match assets to slots. */
  desc?: string;
}

export interface DirectorOptions {
  apiKey?: string;
  model?: string;
  /** Pool of user/library images the director may bind to image slots. */
  assetPool?: AssetRef[];
  /** Critique feedback from a previous attempt (Phase 4.7-c revise loop). */
  feedback?: string;
}

function maxChars(slot: { bbox: { w: number }; fontSize?: number }): number {
  const fs = slot.fontSize ?? 24;
  return Math.max(6, Math.floor(slot.bbox.w / (fs * 0.7)) * 2);
}

export async function planSlide(
  layout: Layout, purpose: string, deckTitle: string, topic: string, opts: DirectorOptions = {},
): Promise<PlacementPlan> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

  const group = detectRepeatGroup(layout);
  const memberIds = new Set(group?.memberIds ?? []);
  const cardRoles = group?.roles ?? [];
  const singleSlots = layout.slots
    .filter((s) => s.type === "text" && !memberIds.has(s.id) && s.role !== "decoration" && s.role !== "divider")
    .map((s) => ({ id: s.id, role: s.role, max: maxChars(s) }));
  const imageSlots = layout.slots.filter((s) => s.type === "image");
  const pool = opts.assetPool ?? [];
  const imageLine = imageSlots.length && pool.length
    ? `Image slots to fill from the asset pool (pick the best assetId for each):\n` +
      imageSlots.map((s) => `- ${s.id} (${s.mediaKind ?? "image"})`).join("\n") +
      `\nAsset pool:\n` + pool.map((a) => `- ${a.id}${a.desc ? `: ${a.desc}` : ""}`).join("\n")
    : "No image slots to fill (images: []).";

  // No repeatable card → fall back to a singles-only plan (still relation-safe).
  const cardLine = group
    ? `This slide has a REPEATABLE CARD with roles [${cardRoles.join(", ")}] (originally ${group.baseCount} cards). Produce a sensible number of cards for the topic (2–6); each card fills these roles. kpi = a short metric (e.g. +38%, 120K).`
    : `This slide has no repeatable card; produce cards = [].`;

  const singleLine = singleSlots.map((s) => `- ${s.id} (${s.role}, ≤${s.max} chars)`).join("\n") || "(none)";

  const anthropic = new Anthropic({ apiKey });
  const res = await anthropic.messages.create({
    model,
    max_tokens: 3072,
    system: `You arrange content into a slide from a fixed design system. Decide how many
repeatable cards to use and write concise content for each card and each fixed
single slot. Respect roles and character budgets. Do NOT output coordinates,
sizes, colors, or fonts — only text. Use the tool.`,
    tools: [{
      name: "place_slide",
      description: "Provide repeatable cards and fixed single-slot text.",
      input_schema: {
        type: "object",
        properties: {
          cards: {
            type: "array",
            items: {
              type: "object",
              properties: {
                slots: {
                  type: "array",
                  items: { type: "object", properties: { role: { type: "string" }, text: { type: "string" } }, required: ["role", "text"], additionalProperties: false },
                },
              },
              required: ["slots"],
              additionalProperties: false,
            },
          },
          singles: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: false },
          },
          images: {
            type: "array",
            items: { type: "object", properties: { slotId: { type: "string" }, assetId: { type: "string" } }, required: ["slotId", "assetId"], additionalProperties: false },
          },
        },
        required: ["cards", "singles"],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: "tool", name: "place_slide" },
    messages: [{
      role: "user",
      content: [{ type: "text", text:
        `Deck: ${deckTitle}\nTopic: ${topic}\nThis slide's purpose: ${purpose}\nLayout archetype: ${layout.archetype ?? "other"}\n\n${cardLine}\n\nFixed single slots (fill each):\n${singleLine}\n\n${imageLine}` +
        (opts.feedback ? `\n\nThe previous attempt had issues — revise to fix them (shorten text / fewer cards as needed):\n${opts.feedback}` : "") }],
    }],
  });

  const tool = res.content.find((c) => c.type === "tool_use");
  if (!tool || tool.type !== "tool_use") throw new Error("no tool_use in director response");
  const input = tool.input as {
    cards: { slots: { role: string; text: string }[] }[];
    singles: { id: string; text: string }[];
    images?: { slotId: string; assetId: string }[];
  };

  const cardRoleSet = new Set(cardRoles);
  const cards = input.cards.map((c) => {
    const rec: Record<string, string> = {};
    for (const s of c.slots) if (cardRoleSet.has(s.role)) rec[s.role] = s.text;
    return rec;
  }).filter((c) => Object.keys(c).length > 0);

  const validSingle = new Set(singleSlots.map((s) => s.id));
  const singles: Record<string, string> = {};
  for (const s of input.singles) if (validSingle.has(s.id)) singles[s.id] = s.text;

  const validImage = new Set(imageSlots.map((s) => s.id));
  const poolById = new Map(pool.map((a) => [a.id, a.url]));
  const images: Record<string, string> = {};
  for (const b of input.images ?? []) {
    if (validImage.has(b.slotId) && poolById.has(b.assetId)) images[b.slotId] = poolById.get(b.assetId)!;
  }

  const plan: PlacementPlan = { layoutId: layout.id, cards, singles };
  if (Object.keys(images).length) plan.images = images;
  return plan;
}
