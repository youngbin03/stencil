import { NextResponse } from "next/server";
import { classifySlide } from "@stencil/classifier";
import { rebakeTheme } from "@/lib/themes";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/themes/rebake?slug=<slug>[&vision=1]
 * Re-assetizes the theme from its template SVGs into system.json + decorations.
 * Default is deterministic (id-rule roles, no API cost); vision=1 adds Claude
 * vision classification (requires ANTHROPIC_API_KEY).
 */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const vision = url.searchParams.get("vision") === "1" && Boolean(process.env.ANTHROPIC_API_KEY);
  try {
    const classify = vision ? (svg: string, slots: Parameters<typeof classifySlide>[1]) => classifySlide(svg, slots) : undefined;
    const result = await rebakeTheme(slug, classify);
    return NextResponse.json({ ok: true, vision, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "rebake failed" }, { status: 400 });
  }
}
