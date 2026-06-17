import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { extractThemeSystem, type ClassifyFn, type SlideInput } from "@stencil/extractor";

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
      systemPath: resolve(root, "fixtures/assets", slug, "system.json"),
      decoDir: resolve(root, "fixtures/assets", slug, "decorations"),
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
  if (mockups.length) {
    await mkdir(mockupDir, { recursive: true });
    await Promise.all(mockups.map((m) => writeFile(resolve(mockupDir, `${m.id}.json`), JSON.stringify(m.asset), "utf8")));
  }
  return { layouts: system.layouts.length, slides: slides.length, mockups: mockups.length };
}

/** Allow only safe slide ids (Frame-12, my-upload_3) — blocks path traversal. */
export function safeId(id: string): string | null {
  const base = id.replace(/\.svg$/i, "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(base) ? base : null;
}
