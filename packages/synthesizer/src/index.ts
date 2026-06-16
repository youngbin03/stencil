export { synthesize, pickDecorationFrame } from "./synthesize.js";
export type { SynthPlan, SynthResult } from "./synthesize.js";
export { buildGrammarSpec } from "./grammar.js";
export type { GrammarSpec, ArchetypeSkeleton, ArchetypeZone } from "./grammar.js";
export { synthesizeFromGrammar, archetypeSchema } from "./synth-engine.js";
export type { ContentPlan, Asset } from "./synth-engine.js";
export { evaluateSlide } from "./evaluate.js";
export type { QualityScores, QualityVerdict } from "./evaluate.js";
export { synthDecoration } from "./decoration.js";
