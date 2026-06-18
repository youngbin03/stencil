import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import { resolveTheme, safeId } from "@/lib/themes";
import { listSupabaseSlides, canWriteTemplates, putTemplate, removeTemplate } from "@/lib/supabase-templates";

export const runtime = "nodejs";

/** GET /api/templates?theme=<slug> → { theme, slides: [{ id, thumb? }] }.
 *  Prefers Supabase (works on serverless where the raw SVGs aren't shipped);
 *  falls back to the local filesystem for dev / not-yet-seeded user themes. */
export async function GET(req: Request): Promise<Response> {
  const theme = new URL(req.url).searchParams.get("theme") ?? "";
  const t = resolveTheme(theme);
  if (!t) return NextResponse.json({ error: "unknown theme" }, { status: 400 });
  const sb = await listSupabaseSlides(theme);
  if (sb.length) return NextResponse.json({ theme, slides: sb });
  try {
    const files = (await readdir(t.templatesDir)).filter((f) => f.toLowerCase().endsWith(".svg"));
    files.sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0), nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });
    return NextResponse.json({ theme, slides: files.map((f) => ({ id: f.replace(/\.svg$/i, "") })) });
  } catch {
    return NextResponse.json({ theme, slides: [] });
  }
}

/** POST /api/templates?theme=<slug>  body: { name, svg } → add a template slide */
export async function POST(req: Request): Promise<Response> {
  const theme = new URL(req.url).searchParams.get("theme") ?? "";
  const t = resolveTheme(theme);
  if (!t) return NextResponse.json({ error: "unknown theme" }, { status: 400 });
  let body: { name?: string; svg?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const id = safeId(String(body.name ?? "").replace(/[^\w.-]+/g, "-"));
  const svg = String(body.svg ?? "");
  if (!id) return NextResponse.json({ error: "invalid name" }, { status: 400 });
  if (!/<svg[\s>]/i.test(svg)) return NextResponse.json({ error: "not an SVG" }, { status: 400 });
  if (!canWriteTemplates()) {
    return NextResponse.json({ error: "template writes are not configured (set SUPABASE_SERVICE_ROLE_KEY)" }, { status: 501 });
  }
  try {
    await putTemplate(theme, id, svg);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "upload failed" }, { status: 500 });
  }
}

/** DELETE /api/templates?theme=<slug>&id=Frame-3 */
export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const theme = url.searchParams.get("theme") ?? "";
  const t = resolveTheme(theme);
  const id = safeId(url.searchParams.get("id") ?? "");
  if (!t || !id) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!canWriteTemplates()) {
    return NextResponse.json({ error: "template writes are not configured (set SUPABASE_SERVICE_ROLE_KEY)" }, { status: 501 });
  }
  try {
    await removeTemplate(theme, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 500 });
  }
}
