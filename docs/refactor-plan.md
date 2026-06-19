# Refactor plan — layout-bank-driven generation

## Goal
Replace `archetype → 1 fixed structure` (text-only variety) with
`content block → choose among the template's REAL measured layouts → render faithfully`.
Diversity and quality both come from human-designed layouts. Selection and geometry are
measurement-driven (no accumulated magic numbers).

## Target pipeline
```
prompt
  → planner v2: ordered CONTENT BLOCKS {kind, data}   (LLM: semantics only)
  → for each block:
      candidates = layoutBank.byShape(block)           (measured signature match)
      pick       = argmax  fit × richness × novelty     (no thresholds)
      slide      = renderFaithful(pick, block, reflow)  (template's own styling)
  → evaluate gate → re-pick on fail
  → deck
```

## Phases (each independently verifiable; 0–2 are additive, 6 is the cutover)

### Phase 0 — Layout-bank index  [foundation]
- From `system.json`, compute a measured **signature** per layout:
  `{ archetype, background, textSlots, cardCount, cardRoles, hasImage, hasMockup,
     hasBigNumber, contentRegion(bbox), decorationRef }`.
- Deliver: `buildLayoutBank(system)` + `byShape(blockKind)` query.
- Verify: dump signatures for colorful/green/black; counts sane (green ~5 content, etc.).

### Phase 1 — Planner v2: content blocks
- LLM emits **content shapes**, not archetypes: `titleSlide, metricRow(3–5), list(n),
  quote, comparison(2col), gallery(n), feature+media, statement`.
- Reuse/extend `STRUCTURE_SCHEMA` for per-block output schemas.
- Verify: planner output for 3 prompts is well-formed; covers a varied mix.

### Phase 2 — Matching/selection engine
- Score each candidate layout for a block:
  - `fit`     = block cardinality/kind vs layout slot capacity (within a reflow range).
  - `richness`= projected ink fill of the layout's content region (reject sparse).
  - `novelty` = penalty if the layout id is already used in this deck (forces variety).
- `pick = argmax(fit × richness × novelty)`. Deterministic, measured.
- Verify: same block kind yields DIFFERENT layouts across a deck; dedup holds.

### Phase 3 — Faithful renderer (merge augmentation path)
- Render the chosen layout with its **own measured styling**: background colour, slot
  geometry, `cardSpec` (incl. colour boxes), type scale, decoration, image zones.
- Reflow card/item count to the block's data (3↔4↔5) so it is not a verbatim copy.
- Reuse the augmentation renderer + `structures.ts` as ONE renderer among layouts.
- Verify: fidelity matches the template (KPI boxes, colours, fonts); no overflow/float.

### Phase 4 — Image / mockup handling
- Mockup frames stamped with the gradient placeholder screen; photo zones use the
  place-don't-generate policy (placeholder or omit).
- Verify: gallery/feature slides read complete; no empty holes.

### Phase 5 — Quality gate + dedup integration
- `evaluateSlide` gate per slide; on REVISE/REJECT → re-pick the next-best candidate.
- Enforce deck-level novelty (no repeated layout).
- Verify: no broken slide ships; deck shows real layout variety.

### Phase 6 — Cutover + magic-number cleanup
- Route `generateSynthDeck` through the new pipeline; retire the single-structure mapping.
- Replace remaining constants with measured signals:
  - char-width `0.52/0.56` → **opentype.js** font metrics (already a dep).
  - band fractions / gallery offsets → template's **measured margins & rhythm**.
  - KPI box geometry → template's **measured KPI box** sizes.
- Verify: regenerate 3 themes × 2 prompts; compare diversity + quality vs current.

## Sequencing / risk
- Build Phases 0–3 alongside the current path (feature-flagged) so nothing breaks.
- Cut over (Phase 6) only after Phase 5 verification passes on all 3 themes.
- Each phase ends with a render-and-look verification (rasterize, inspect).
