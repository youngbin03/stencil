import { resolve } from "node:path";

/** Maps a public theme name to its on-disk template directory. */
export const THEME_DIR: Record<string, string> = {
  colorful: "colorfulldesign",
  black: "blackdesign",
  green: "greendesign",
};

/** Repo-root templates dir (next dev runs from apps/web). */
export function templatesRoot(): string {
  return resolve(process.cwd(), "..", "..", "templates");
}

export function themeDir(theme: string): string | null {
  const dir = THEME_DIR[theme];
  return dir ? resolve(templatesRoot(), dir) : null;
}

/** Allow only safe slide ids (Frame-12, my-upload_3) — blocks path traversal. */
export function safeId(id: string): string | null {
  const base = id.replace(/\.svg$/i, "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(base) ? base : null;
}
