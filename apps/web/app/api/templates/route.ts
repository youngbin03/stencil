import { NextResponse } from "next/server";
import { readdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { themeDir, safeId } from "@/lib/templates";

export const runtime = "nodejs";

/** GET /api/templates?theme=colorful → { theme, slides: [{ id }] } */
export async function GET(req: Request): Promise<Response> {
  const theme = new URL(req.url).searchParams.get("theme") ?? "";
  const dir = themeDir(theme);
  if (!dir) return NextResponse.json({ error: "unknown theme" }, { status: 400 });
  try {
    const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".svg"));
    files.sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0), nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });
    return NextResponse.json({ theme, slides: files.map((f) => ({ id: f.replace(/\.svg$/i, "") })) });
  } catch {
    return NextResponse.json({ theme, slides: [] });
  }
}

/** POST /api/templates?theme=colorful  body: { name, svg } → add a template slide */
export async function POST(req: Request): Promise<Response> {
  const theme = new URL(req.url).searchParams.get("theme") ?? "";
  const dir = themeDir(theme);
  if (!dir) return NextResponse.json({ error: "unknown theme" }, { status: 400 });
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
  await writeFile(resolve(dir, `${id}.svg`), svg, "utf8");
  return NextResponse.json({ ok: true, id });
}

/** DELETE /api/templates?theme=colorful&id=Frame-3 */
export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const theme = url.searchParams.get("theme") ?? "";
  const dir = themeDir(theme);
  const id = safeId(url.searchParams.get("id") ?? "");
  if (!dir || !id) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    await unlink(resolve(dir, `${id}.svg`));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
