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

// --- writes (server only) ---------------------------------------------------
// Storage/DB mutations use the service-role key, kept server-side and never
// shipped to the client. Set SUPABASE_SERVICE_ROLE_KEY in the environment
// (Vercel + local .env.local) to enable template add/delete on the deployment.
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const wHeaders = (): Record<string, string> => ({ apikey: SERVICE!, authorization: `Bearer ${SERVICE!}` });
export function canWriteTemplates(): boolean { return !!SERVICE; }

/** Upload a template SVG to Storage and upsert its theme + slide rows. */
export async function putTemplate(theme: string, id: string, svg: string): Promise<void> {
  const path = `${theme}/${id}.svg`;
  const up = await fetch(`${URL}/storage/v1/object/templates/${path}`, {
    method: "POST",
    headers: { ...wHeaders(), "content-type": "image/svg+xml", "x-upsert": "true" },
    body: svg,
  });
  if (!up.ok) throw new Error(`storage upload failed (${up.status})`);
  await fetch(`${URL}/rest/v1/themes`, {
    method: "POST",
    headers: { ...wHeaders(), "content-type": "application/json", prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ slug: theme, name: theme.charAt(0).toUpperCase() + theme.slice(1), baked: true }),
  });
  const r = await fetch(`${URL}/rest/v1/template_slides`, {
    method: "POST",
    headers: { ...wHeaders(), "content-type": "application/json", prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ theme, slide_id: id, path, ord: 999 }),
  });
  if (!r.ok) throw new Error(`db upsert failed (${r.status})`);
}

/** Remove a template's Storage objects and slide row. */
export async function removeTemplate(theme: string, id: string): Promise<void> {
  for (const ext of ["svg", "png"]) {
    await fetch(`${URL}/storage/v1/object/templates/${theme}/${id}.${ext}`, { method: "DELETE", headers: wHeaders() });
  }
  const r = await fetch(
    `${URL}/rest/v1/template_slides?theme=eq.${encodeURIComponent(theme)}&slide_id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers: wHeaders() },
  );
  if (!r.ok) throw new Error(`db delete failed (${r.status})`);
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
