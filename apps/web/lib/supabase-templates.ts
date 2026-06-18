// Read-only Supabase access for template previews. The URL + anon key are public
// client credentials (safe to ship); overridable via env. Storage bucket
// `templates` holds <theme>/<id>.png thumbnails; table `template_slides` lists them.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qtbdeajcbnhcemeqaunt.supabase.co";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0YmRlYWpjYm5oY2VtZXFhdW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjYwMDksImV4cCI6MjA5NzM0MjAwOX0.iBBeicSCr5Sq-VZI2X6pIk_Pc0IA2celrfuHBTclicU";

const headers = { apikey: ANON, authorization: `Bearer ${ANON}` };

export function thumbUrl(path: string): string {
  return `${URL}/storage/v1/object/public/templates/${path}`;
}

/** Slides for a theme (id + public thumbnail URL), ordered. Empty on failure. */
export async function listSupabaseSlides(theme: string): Promise<{ id: string; thumb: string }[]> {
  try {
    const r = await fetch(
      `${URL}/rest/v1/template_slides?theme=eq.${encodeURIComponent(theme)}&select=slide_id,path&order=ord.asc`,
      { headers, cache: "no-store" },
    );
    if (!r.ok) return [];
    const rows = (await r.json()) as { slide_id: string; path: string }[];
    return rows.map((x) => ({ id: x.slide_id, thumb: thumbUrl(x.path) }));
  } catch {
    return [];
  }
}

/** slide count per theme slug (for folder tiles). */
export async function supabaseSlideCounts(): Promise<Record<string, number>> {
  try {
    const r = await fetch(`${URL}/rest/v1/template_slides?select=theme`, { headers, cache: "no-store" });
    if (!r.ok) return {};
    const rows = (await r.json()) as { theme: string }[];
    const c: Record<string, number> = {};
    for (const x of rows) c[x.theme] = (c[x.theme] ?? 0) + 1;
    return c;
  } catch {
    return {};
  }
}
