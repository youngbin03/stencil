import { NextResponse } from "next/server";
import { createTheme, listThemes } from "@/lib/themes";

export const runtime = "nodejs";

/** GET /api/themes → [{ slug, name, builtin, slides, baked }] */
export async function GET(): Promise<Response> {
  return NextResponse.json({ themes: listThemes() });
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
