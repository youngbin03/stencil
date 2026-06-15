import type { Role } from "@stencil/ir";

/**
 * id→role mapping (DEVDOC 8.0). Figma layer names are preserved as svg `id`;
 * there is no `data-*` contract, so roles are inferred from the normalized id.
 */

/** Normalize a Figma id into a dictionary key: strip `_n` suffix, collapse whitespace, lowercase. */
export function normalizeKey(id: string): string {
  return id
    .replace(/_\d+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Exact-match dictionary from normalized key to closed-vocabulary role. */
const DICTIONARY: Record<string, Role> = {
  // title
  "presentation title": "title",
  title: "title",
  h1: "title",
  // headline
  headline: "headline",
  h2: "headline",
  // subtitle
  subtitle: "subtitle",
  "h3 regular": "subtitle",
  "h3 medium": "subtitle",
  "subtitle+body": "subtitle",
  // eyebrow
  "project name": "eyebrow",
  date: "eyebrow",
  // body
  body: "body",
  "body medium": "body",
  "body 3": "body",
  "text block": "body",
  textblock: "body",
  text: "body",
  content: "body",
  "list item": "body",
  "team member": "body",
  header: "body",
  // caption
  caption: "caption",
  label: "caption",
  number: "caption",
  metric: "caption",
  annotate: "caption",
  // quote
  quote: "quote",
  // divider
  line: "divider",
  "v axis": "divider",
  // image
  image: "image",
  "profile pic": "image",
  "screen **insert designs here**": "image",
  // decoration
  decorative: "decoration",
  group: "decoration",
  vector: "decoration",
  shape: "decoration",
  diagram: "decoration",
  "pie slice": "decoration",
};

/** Prefix-based fallbacks for ids whose exact key is not in the dictionary. */
const PREFIX_RULES: Array<{ prefix: string; role: Role }> = [
  { prefix: "iphone", role: "image" },
  { prefix: "apple iphone", role: "image" },
  { prefix: "macbook", role: "image" },
  { prefix: "android", role: "image" },
  { prefix: "frame", role: "decoration" },
  { prefix: "rectangle", role: "decoration" },
  { prefix: "ellipse", role: "decoration" },
  { prefix: "union", role: "decoration" },
  { prefix: "subtract", role: "decoration" },
  { prefix: "star", role: "decoration" },
  { prefix: "polygon", role: "decoration" },
];

export interface RoleMapResult {
  role: Role;
  /** True when no rule matched and we fell back to decoration. */
  uncertain: boolean;
}

/** Map a raw Figma id to a role. Unmatched ids fall back to decoration + uncertain. */
export function mapRole(id: string): RoleMapResult {
  const key = normalizeKey(id);

  const exact = DICTIONARY[key];
  if (exact) return { role: exact, uncertain: false };

  for (const { prefix, role } of PREFIX_RULES) {
    if (key.startsWith(prefix)) return { role, uncertain: false };
  }

  return { role: "decoration", uncertain: true };
}
