import { NextResponse } from "next/server";
import { generateDeck, isTheme } from "@/lib/generate";
import { generateSynthDeck } from "@/lib/synth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  let body: { theme?: string; prompt?: string; slideCount?: number; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const theme = String(body.theme ?? "");
  const prompt = String(body.prompt ?? "").trim();
  const slideCount = Math.min(12, Math.max(1, Number(body.slideCount) || 6));
  const mode = body.mode === "synthesis" ? "synthesis" : "filler";

  if (!isTheme(theme)) return NextResponse.json({ error: "unknown theme" }, { status: 400 });
  if (prompt.length < 4) return NextResponse.json({ error: "prompt too short" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured on the server" }, { status: 500 });
  }

  try {
    const deck = mode === "synthesis"
      ? await generateSynthDeck(theme, prompt, slideCount)
      : await generateDeck(theme, prompt, slideCount);
    return NextResponse.json({ mode, ...deck });
  } catch (err) {
    const message = err instanceof Error ? err.message : "generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
