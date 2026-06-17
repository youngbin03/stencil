import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { generateDeck } from "@/lib/generate";
import { generateSynthDeck } from "@/lib/synth";
import { resolveTheme } from "@/lib/themes";

export const runtime = "nodejs";
export const maxDuration = 300;

// Abuse/cost guard for the public deployment: when GATE_PASSWORD is set on the
// server, generation requires a matching x-gate header (the UI prompts once).
function gateOk(req: Request): boolean {
  const pw = process.env.GATE_PASSWORD;
  if (!pw) return true;
  return req.headers.get("x-gate") === pw;
}

export async function POST(req: Request): Promise<Response> {
  if (!gateOk(req)) return NextResponse.json({ error: "access code required" }, { status: 401 });
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

  const resolved = resolveTheme(theme);
  if (!resolved) return NextResponse.json({ error: "unknown theme" }, { status: 400 });
  if (!existsSync(resolved.systemPath)) {
    return NextResponse.json({ error: "theme not baked yet — add slides and Rebake first" }, { status: 400 });
  }
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
