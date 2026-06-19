import type { LayoutSig } from "./layout-bank.js";
import { type BlockKind, blockMatches } from "./blocks.js";

/**
 * Phase 2 — selection. For a content block, score every compatible real layout and pick
 * the best. Score = fit x richness x novelty x specificity. All terms are measured /
 * relative (no thresholds): variety comes from novelty (used layouts demoted) + the
 * template genuinely having several layouts per shape.
 */

export interface PlanBlock { kind: BlockKind; data: Record<string, unknown>; purpose?: string }

/** kind-specific quality bonus: reward layouts whose device truly fits the block. */
function specificity(kind: BlockKind, s: LayoutSig): number {
  switch (kind) {
    case "metricRow": return s.cardUsable ? 1.3 : 1;          // real metric card grid > bare big number
    case "list": return s.cardUsable ? 1.3 : 1;
    case "comparison": return s.cardCount === 2 ? 1.3 : (s.imageCount === 2 ? 1.15 : 1);
    case "gallery": return 1 + Math.min(0.3, s.imageCount * 0.05); // more frames = richer grid
    default: return 1;
  }
}

const REPEATABLE = new Set<BlockKind>(["metricRow", "list", "gallery", "comparison"]);

export function scoreLayout(block: PlanBlock, s: LayoutSig, used: Set<string>, canvas: { w: number; h: number }): number {
  // The chosen layout DICTATES the item count, so selection is count-agnostic: a repeating
  // block just prefers a real multi-slot device (card grid / image set) over a layout that
  // would have to fake the row.
  const hasDevice = block.kind === "gallery" ? s.imageCount >= 2 : s.cardUsable;
  const fit = !REPEATABLE.has(block.kind) ? 1 : hasDevice ? 1 : 0.5;
  const cover = s.region ? Math.min(1, (s.region.w * s.region.h) / (canvas.w * canvas.h)) : 0.4;
  const richness = 0.5 + 0.5 * cover;                          // denser content region preferred
  const novelty = used.has(s.id) ? 0.3 : 1;                    // demote already-used layouts (variety)
  return fit * richness * novelty * specificity(block.kind, s);
}

/** Pick the best real layout for a block; null if the theme has none. Mutates `used`. */
export function selectLayout(block: PlanBlock, bank: LayoutSig[], used: Set<string>, canvas: { w: number; h: number }): LayoutSig | null {
  const cands = bank.filter((s) => blockMatches(block.kind, s));
  if (!cands.length) return null;
  let best = cands[0]!, bestScore = -Infinity;
  for (const s of cands) { const sc = scoreLayout(block, s, used, canvas); if (sc > bestScore) { bestScore = sc; best = s; } }
  used.add(best.id);
  return best;
}

/** Block kinds the theme can actually realize — given to the planner so it only asks for
 *  shapes that exist (e.g. green has no quote layout). */
export function availableKinds(bank: LayoutSig[]): BlockKind[] {
  const all: BlockKind[] = ["title", "statement", "metricRow", "list", "quote", "comparison", "gallery", "feature"];
  return all.filter((k) => bank.some((s) => blockMatches(k, s)));
}
