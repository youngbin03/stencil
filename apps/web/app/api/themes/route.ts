import { NextResponse } from "next/server";
import { createTheme, listThemes } from "@/lib/themes";
import { supabaseSlideCounts } from "@/lib/supabase-templates";

export const runtime = "nodejs";

/** GET /api/themes → [{ slug, name, builtin, slides, baked }].
 *  Slide counts come from Supabase when available (serverless has no raw SVGs). */
export async function GET(): Promise<Response> {
  const themes = listThemes();
  const counts = await supabaseSlideCounts();
  for (const t of themes) if (counts[t.slug] != null) t.slides = counts[t.slug]!;
  return NextResponse.json({ themes });
}

/** POST /api/themes  body: { name } → create an empty user theme */
export async function POST(req: Request): Promise<Response> {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    const slug = await createTheme(String(body.name ?? ""));
    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "create failed" }, { status: 400 });
  }
}
