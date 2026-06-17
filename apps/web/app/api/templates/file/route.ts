import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveTheme, safeId } from "@/lib/themes";

export const runtime = "nodejs";

/** GET /api/templates/file?theme=<slug>&id=Frame-3 → the template SVG */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const t = resolveTheme(url.searchParams.get("theme") ?? "");
  const id = safeId(url.searchParams.get("id") ?? "");
  if (!t || !id) return new Response("bad request", { status: 400 });
  try {
    const svg = await readFile(resolve(t.templatesDir, `${id}.svg`), "utf8");
    return new Response(svg, {
      headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
