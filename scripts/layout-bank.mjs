// Phase 0 verification — dumps the real buildLayoutBank() output per theme.
import { readFileSync } from "node:fs";
import { buildLayoutBank } from "../packages/synthesizer/dist/layout-bank.js";
for (const th of ["colorful", "green", "black"]) {
  const sys = JSON.parse(readFileSync(`apps/web/assets/${th}/system.json`, "utf8"));
  const bank = buildLayoutBank(sys);
  const usableCards = bank.filter((b) => b.cardUsable).length;
  const noiseCards = bank.filter((b) => b.cardCount > 0 && !b.cardUsable);
  console.log(`\n== ${th}: ${bank.length} layouts | usable-card layouts=${usableCards} | card-noise dropped=${noiseCards.length} (${noiseCards.map((b) => b.id.replace(th + "_", "") + "[" + b.cardRoles + "]").join(", ")})`);
  for (const b of bank) console.log(`  ${b.id.replace(th + "_", "").padEnd(9)} arch=${b.archetype.padEnd(11)} txt=${String(b.textSlots).padEnd(2)} img=${String(b.imageCount).padEnd(2)} cards=${b.cardCount}${b.cardUsable ? "✓" : "·"}[${b.cardRoles.join("/")}] big=${b.hasBigNumber ? "Y" : "·"} q=${b.hasQuote ? "Y" : "·"} bg=${b.background}`);
}
