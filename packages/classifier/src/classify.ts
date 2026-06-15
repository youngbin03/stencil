import Anthropic from "@anthropic-ai/sdk";
import type { LayoutArchetype, ManifestSlot, MediaKind, Role } from "@stencil/ir";
import { annotateSlots, rasterize } from "./rasterize.js";

/**
 * Vision-led slot classifier (DEVDOC Phase 2.5). Rasterizes the slide, overlays
 * numbered slot boxes, and asks Claude (vision + structural metadata) to assign
 * a rich role / mediaKind / replaceability to each numbered slot and a slide
 * archetype. Structural signals are given as evidence, not as a decision.
 */

const ROLES: Role[] = [
  "title", "subtitle", "eyebrow", "headline", "body", "bullet", "caption",
  "quote", "label", "kpi", "image", "table", "logo", "footer", "pagenum",
  "divider", "decoration",
];
const MEDIA_KINDS: MediaKind[] = [
  "photo", "device_mockup", "chart_pie", "chart_bar", "chart_line",
  "logo", "avatar", "icon", "illustration",
];
const ARCHETYPES: LayoutArchetype[] = [
  "cover", "agenda", "section", "content", "stat", "quote",
  "comparison", "team", "gallery", "closing", "other",
];

export interface SlotLabel {
  role: Role;
  mediaKind?: MediaKind;
  replaceable?: boolean;
  note?: string;
}

export interface SlideClassification {
  archetype: LayoutArchetype;
  /** slot id → label */
  labels: Map<string, SlotLabel>;
}

const TOOL = {
  name: "classify_slide",
  description: "Classify each numbered slot and the slide's overall intent.",
  input_schema: {
    type: "object" as const,
    properties: {
      archetype: { type: "string", enum: ARCHETYPES, description: "Overall intent/purpose of the slide." },
      slots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer", description: "The slot's overlay number." },
            role: { type: "string", enum: ROLES },
            mediaKind: { type: "string", enum: MEDIA_KINDS, description: "For image/graphic slots only." },
            replaceable: { type: "boolean", description: "Can a user upload replace this image (true for photo/mockup placeholders, false for logos/decoration)." },
            note: { type: "string", description: "Short reason (<=10 words)." },
          },
          required: ["n", "role"],
          additionalProperties: false,
        },
      },
    },
    required: ["archetype", "slots"],
    additionalProperties: false,
  },
};

function metaTable(slots: ManifestSlot[]): string {
  const rows = slots.map((s, i) => {
    const { x, y, w, h } = s.bbox;
    const aspect = h > 0 ? (w / h).toFixed(2) : "-";
    return `${i + 1}\t${s.type}\tidGuess=${s.role}\tbbox=(${Math.round(x)},${Math.round(y)},${Math.round(w)}x${Math.round(h)})\taspect=${aspect}\tfont=${s.fontFamily ?? "-"}/${s.fontSize ?? "-"}\tlayerId="${s.id}"`;
  });
  return ["n\ttype\tidGuess\tbbox\taspect\tfont\tlayerId", ...rows].join("\n");
}

const SYSTEM = `You label slots in a presentation slide to build a design system.
Use the image as primary evidence and the metadata table as supporting evidence.
Identify what each numbered box really is — e.g. a phone/device mockup placeholder,
a pie/bar chart, a logo, an avatar, a headline, or a KPI metric (short number like
+38%, $2.4B). The "idGuess" is a weak hint from the Figma layer name; trust the
visual + geometry over it. Mark image placeholders that should hold user content
as replaceable. Return one entry per numbered slot via the tool.`;

export interface ClassifyOptions {
  apiKey?: string;
  model?: string;
}

export async function classifySlide(
  svg: string,
  slots: ManifestSlot[],
  opts: ClassifyOptions = {},
): Promise<SlideClassification> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

  const png = rasterize(annotateSlots(svg, slots));
  const client = new Anthropic({ apiKey });

  const res = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
          { type: "text", text: `Slots (numbered to match the pink boxes):\n${metaTable(slots)}` },
        ],
      },
    ],
  });

  const tool = res.content.find((c) => c.type === "tool_use");
  if (!tool || tool.type !== "tool_use") throw new Error("no tool_use in response");
  const input = tool.input as {
    archetype: LayoutArchetype;
    slots: Array<{ n: number; role: Role; mediaKind?: MediaKind; replaceable?: boolean; note?: string }>;
  };

  const labels = new Map<string, SlotLabel>();
  for (const entry of input.slots) {
    const slot = slots[entry.n - 1];
    if (!slot) continue;
    const label: SlotLabel = { role: entry.role };
    if (entry.mediaKind) label.mediaKind = entry.mediaKind;
    if (entry.replaceable !== undefined) label.replaceable = entry.replaceable;
    if (entry.note) label.note = entry.note;
    labels.set(slot.id, label);
  }

  return { archetype: input.archetype, labels };
}
