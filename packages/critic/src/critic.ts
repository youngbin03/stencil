import Anthropic from "@anthropic-ai/sdk";
import type { CritiquePatch } from "@stencil/ir";

/**
 * Vision critic (DEVDOC Phase 4.7-c, evaluator-optimizer). Looks at the rendered
 * slide PNG against the template's design grammar and reports overlap/clipping/
 * balance/relation issues with concrete fixes. Verdict gates the revise loop.
 */

export interface CriticContext {
  archetype?: string;
  palette?: string[];
  /** Short grammar note, e.g. "left-heavy, generous whitespace, emphasis right". */
  grammarNote?: string;
}

export interface CriticOptions {
  apiKey?: string;
  model?: string;
}

export async function critiqueSlide(png: Buffer, ctx: CriticContext, opts: CriticOptions = {}): Promise<CritiquePatch> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model,
    max_tokens: 1536,
    system: `You are a strict presentation design reviewer. Judge the rendered slide against
the template's design grammar. Flag only real, visible problems: text overflowing
or clipped, elements overlapping, poor contrast/legibility, uneven spacing, broken
alignment, or imbalance vs the grammar. For each issue give a concrete fix phrased
as content/placement guidance (e.g. "shorten title to ~20 chars", "fewer cards").
If the slide looks clean and on-grammar, return verdict "accept" with no issues.`,
    tools: [{
      name: "critique",
      description: "Report design issues and an overall verdict.",
      input_schema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["accept", "revise"] },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["high", "med", "low"] },
                target: { type: "string", description: "what (e.g. title, kpi card 3)" },
                problem: { type: "string" },
                fix: { type: "string", description: "concrete content/placement guidance" },
              },
              required: ["severity", "target", "problem", "fix"],
              additionalProperties: false,
            },
          },
        },
        required: ["verdict", "issues"],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: "tool", name: "critique" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
        { type: "text", text:
          `Slide archetype: ${ctx.archetype ?? "other"}\nPalette: ${(ctx.palette ?? []).join(", ")}\nDesign grammar: ${ctx.grammarNote ?? "match the template's feel"}\n\nReview this rendered slide.` },
      ],
    }],
  });

  const tool = res.content.find((c) => c.type === "tool_use");
  if (!tool || tool.type !== "tool_use") throw new Error("no tool_use in critic response");
  return tool.input as CritiquePatch;
}
