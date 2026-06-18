import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { extractThemeSystem, type ClassifyFn, type SlideInput } from "@stencil/extractor";
import type { MockupAsset } from "@stencil/normalizer";
import type { DecoFrag } from "@stencil/synthesizer";

/**
 * Dynamic theme registry. A "theme" is a folder of example slides plus a baked
 * design system (system.json + decorations). Built-in themes live in the repo;
 * user-imported themes live under apps/web/.data/themes/<slug>/ and are baked
 * in-process (the same extractThemeSystem pipeline the CLI uses).
 */

let cachedRoot: string | null = null;
/** Monorepo root — the dir that contains templates/ and fixtures/. */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = process.env.STENCIL_ROOT ?? process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "templates")) && existsSync(resolve(dir, "fixtures"))) {
      cachedRoot = dir;
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  cachedRoot = process.env.STENCIL_ROOT ?? process.cwd();
  return cachedRoot;
}

let cachedAssets: string | null = null;
/** Where baked builtin assets live. Prefers the app-local copy (apps/web/assets,
 *  which is bundled into the Vercel functions); falls back to repo fixtures for
 *  local development. */
export function builtinAssetsRoot(): string {
  if (cachedAssets) return cachedAssets;
  // Cover every plausible lambda cwd (apps/web or repo root) + local dev.
  const candidates = [
    resolve(process.cwd(), "assets"),
    resolve(process.cwd(), "apps/web/assets"),
    resolve(repoRoot(), "apps/web/assets"),
    resolve(repoRoot(), "fixtures/assets"),
  ];
  cachedAssets = candidates.find((p) => existsSync(p)) ?? candidates[0];
  return cachedAssets;
}

const BUILTIN: Record<string, { name: string; dir: string }> = {
  colorful: { name: "Colorful", dir: "colorfulldesign" },
  black: { name: "Black", dir: "blackdesign" },
  green: { name: "Green", dir: "greendesign" },
};

export function userThemesRoot(): string {
  return resolve(repoRoot(), "apps/web/.data/themes");
}

export interface ThemePaths {
  slug: string;
  name: string;
  builtin: boolean;
  templatesDir: string;
  systemPath: string;
  decoDir: string;
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

const SLUG_RE = /^[a-z0-9-]{1,40}$/;

export function resolveTheme(slug: string): ThemePaths | null {
  if (!SLUG_RE.test(slug)) return null;
  const b = BUILTIN[slug];
  const root = repoRoot();
  if (b) {
    return {
      slug, name: b.name, builtin: true,
      templatesDir: resolve(root, "templates", b.dir),
      systemPath: resolve(builtinAssetsRoot(), slug, "system.json"),
      decoDir: resolve(builtinAssetsRoot(), slug, "decorations"),
    };
  }
  const base = resolve(userThemesRoot(), slug);
  if (!existsSync(base)) return null;
  return {
    slug, name: slug, builtin: false,
    templatesDir: resolve(base, "templates"),
    systemPath: resolve(base, "system.json"),
    decoDir: resolve(base, "decorations"),
  };
}

function countSvgs(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".svg")).length;
  } catch {
    return 0;
  }
}

export interface ThemeInfo {
  slug: string;
  name: string;
  builtin: boolean;
  slides: number;
  baked: boolean;
  /** A few representative colors (normalized hex) for a visual identity chip. */
  swatches: string[];
}

const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", transparent: "#ffffff" };
function toHex(c: string): string | null {
  const v = c.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return v;
  return null;
}

/** Pull a small, de-duplicated swatch set from a baked theme's palette/colors. */
function themeSwatches(systemPath: string): string[] {
  try {
    const sys = JSON.parse(readFileSync(systemPath, "utf8")) as { tokens?: { palette?: string[]; colors?: Record<string, string> } };
    const raw = sys.tokens?.palette?.length ? sys.tokens.palette : Object.values(sys.tokens?.colors ?? {});
    const out: string[] = [];
    for (const c of raw) {
      const hex = toHex(c);
      if (hex && !out.includes(hex)) out.push(hex);
      if (out.length >= 5) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function listThemes(): ThemeInfo[] {
  const out: ThemeInfo[] = [];
  const entry = (slug: string, name: string, builtin: boolean, t: ThemePaths): ThemeInfo => {
    const baked = existsSync(t.systemPath);
    return { slug, name, builtin, slides: countSvgs(t.templatesDir), baked, swatches: baked ? themeSwatches(t.systemPath) : [] };
  };
  for (const slug of Object.keys(BUILTIN)) out.push(entry(slug, resolveTheme(slug)!.name, true, resolveTheme(slug)!));
  const root = userThemesRoot();
  if (existsSync(root)) {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || !SLUG_RE.test(e.name) || BUILTIN[e.name]) continue;
      const t = resolveTheme(e.name);
      if (t) out.push(entry(e.name, e.name, false, t));
    }
  }
  return out;
}

/** Create an empty user theme folder; returns its slug. */
export async function createTheme(name: string): Promise<string> {
  const slug = slugify(name);
  if (!slug) throw new Error("invalid theme name");
  if (BUILTIN[slug]) throw new Error("name reserved");
  const base = resolve(userThemesRoot(), slug);
  if (existsSync(base)) throw new Error("theme already exists");
  await mkdir(resolve(base, "templates"), { recursive: true });
  return slug;
}

/** Re-assetize a theme: read its template SVGs → build one design system →
 *  write system.json + decoration fragments. Vision classify is optional. */
export async function rebakeTheme(slug: string, classify?: ClassifyFn): Promise<{ layouts: number; slides: number; mockups: number }> {
  const t = resolveTheme(slug);
  if (!t) throw new Error("unknown theme");
  const files = readdirSync(t.templatesDir).filter((f) => f.toLowerCase().endsWith(".svg")).sort();
  if (files.length === 0) throw new Error("no template slides to bake");
  const slides: SlideInput[] = await Promise.all(
    files.map(async (f) => ({ name: f.replace(/\.svg$/i, ""), svg: await readFile(resolve(t.templatesDir, f), "utf8") })),
  );
  const { system, decorations, mockups } = await extractThemeSystem(slides, {
    theme: slug as never,
    decorationRef: (layoutId) => `${slug}/decorations/${layoutId}.svg`,
    ...(classify ? { classify } : {}),
  });
  const mockupDir = resolve(dirname(t.systemPath), "mockups");
  await mkdir(t.decoDir, { recursive: true });
  await mkdir(dirname(t.systemPath), { recursive: true });
  await writeFile(t.systemPath, JSON.stringify(system, null, 2), "utf8");
  await Promise.all(decorations.map((d) => writeFile(resolve(t.decoDir, `${d.layoutId}.svg`), d.svg, "utf8")));
  // Organic decoration library (real free-form shapes) for synthesis backgrounds.
  const decoLib = decorations.flatMap((d) => {
    const m = d.svg.match(/<g id="Decorative"[^>]*>([\s\S]*?)<\/g>/);
    const frag = m?.[1]?.trim();
    if (!frag || !/<(path|circle|ellipse|polygon)\b/.test(frag)) return [];
    const layout = system.layouts.find((l) => l.id === d.layoutId);
    // True shape extent from its own path/circle coords (not the canvas-clamped model
    // bbox) so the synthesizer can transform it into place without misalignment.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const ext = (x: number, y: number): void => { if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
    for (const pm of frag.matchAll(/\sd="([^"]+)"/g)) {
      const nums = (pm[1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) ext(nums[i]!, nums[i + 1]!);
    }
    for (const cm of frag.matchAll(/<circle[^>]*>/g)) {
      const cx = Number(/cx="(-?[\d.]+)"/.exec(cm[0])?.[1]), cy = Number(/cy="(-?[\d.]+)"/.exec(cm[0])?.[1]), rr = Number(/\br="(-?[\d.]+)"/.exec(cm[0])?.[1] ?? 0);
      ext(cx - rr, cy - rr); ext(cx + rr, cy + rr);
    }
    if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return [];
    const colors = [...new Set([...frag.matchAll(/fill="(#[0-9a-fA-F]{3,6})"/g)].map((x) => x[1]))];
    return [{ id: d.layoutId, frag, bbox: { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }, colors, ...(layout?.archetype ? { archetype: layout.archetype } : {}) }];
  });
  await writeFile(resolve(dirname(t.systemPath), "decorations-lib.json"), JSON.stringify(decoLib), "utf8");
  if (mockups.length) {
    await mkdir(mockupDir, { recursive: true });
    await Promise.all(mockups.map((m) => writeFile(resolve(mockupDir, `${m.id}.json`), JSON.stringify(m.asset), "utf8")));
  }
  return { layouts: system.layouts.length, slides: slides.length, mockups: mockups.length };
}

/** Load a theme's baked device-mockup assets (id → asset), if any. */
export async function loadMockups(slug: string): Promise<Record<string, MockupAsset>> {
  const t = resolveTheme(slug);
  if (!t) return {};
  const dir = resolve(dirname(t.systemPath), "mockups");
  if (!existsSync(dir)) return {};
  const out: Record<string, MockupAsset> = {};
  await Promise.all(
    readdirSync(dir).filter((f) => f.endsWith(".json")).map(async (f) => {
      out[f.replace(/\.json$/, "")] = JSON.parse(await readFile(resolve(dir, f), "utf8")) as MockupAsset;
    }),
  );
  return out;
}

/** Load a theme's organic decoration-shape library (for synthesis backgrounds). */
export async function loadDecorations(slug: string): Promise<DecoFrag[]> {
  const t = resolveTheme(slug);
  if (!t) return [];
  const p = resolve(dirname(t.systemPath), "decorations-lib.json");
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(await readFile(p, "utf8")) as DecoFrag[];
  } catch {
    return [];
  }
}

/** Allow only safe slide ids (Frame-12, my-upload_3) — blocks path traversal. */
export function safeId(id: string): string | null {
  const base = id.replace(/\.svg$/i, "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(base) ? base : null;
}
