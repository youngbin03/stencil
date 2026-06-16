/**
 * @stencil/ir — single source of truth for the data contracts in DEVDOC chapter 7.
 * All other packages depend on these types. Changing a contract here is an
 * intentional, cross-cutting decision.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export interface Canvas {
  w: number;
  h: number;
}

/** Axis-aligned bounding box in viewBox pixels. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Theme = "colorful" | "black" | "green";

export type FlowDirection = "column" | "row";

export type TextAlign = "left" | "center" | "right";

/**
 * Closed role vocabulary (DEVDOC 7.1-B). The normalizer maps Figma layer ids
 * onto these. `decoration`/`divider` are preserved visually but ignored by
 * extraction and composition.
 */
export type Role =
  | "title"
  | "subtitle"
  | "eyebrow"
  | "headline"
  | "body"
  | "bullet"
  | "caption"
  | "quote"
  | "label"
  | "kpi"
  | "image"
  | "table"
  | "logo"
  | "footer"
  | "pagenum"
  | "divider"
  | "decoration";

export type SlotType = "text" | "image";

/** Finer-grained kind for image/graphic slots (Phase 2.5 vision classifier). */
export type MediaKind =
  | "photo"
  | "device_mockup"
  | "chart_pie"
  | "chart_bar"
  | "chart_line"
  | "logo"
  | "avatar"
  | "icon"
  | "illustration";

/** Intent of a slide, used by composition to pick the right layout. */
export type LayoutArchetype =
  | "cover"
  | "agenda"
  | "section"
  | "content"
  | "stat"
  | "quote"
  | "comparison"
  | "team"
  | "gallery"
  | "closing"
  | "other";

// ---------------------------------------------------------------------------
// 7.4 Slot manifest — output of M0 (normalizer)
// ---------------------------------------------------------------------------

/**
 * One text/image slot read from a Figma SVG. Text attributes are measured
 * directly from the `<text>` node (DEVDOC 8.0), not estimated.
 */
export interface ManifestSlot {
  /** Original Figma layer id, kept for traceability and as the render anchor. */
  id: string;
  role: Role;
  type: SlotType;
  bbox: BBox;
  /** Fill color read from the original <text> (hex). */
  color?: string;
  /** Real font-family from the original <text>. */
  fontFamily?: string;
  /** Real font-size (px) from the original <text>. */
  fontSize?: number;
  /** Real font-weight from the original <text>. */
  fontWeight?: number;
  /** Real letter-spacing, e.g. "-0.03em". */
  letterSpacing?: string;
  align?: TextAlign;
  /** Image aspect ratio constraint, e.g. "16:9". */
  ratio?: string;
  /** Set when id→role mapping is ambiguous; must be resolved before M2 passes. */
  uncertain?: boolean;
}

/** Layer intentionally not mapped to a slot (kept untouched in the base template). */
export interface UnmappedLayer {
  id: string;
  reason: string;
}

export interface SlotManifest {
  layoutId: string;
  theme: Theme;
  canvas: Canvas;
  /** Storage reference to the original SVG used as the render base. */
  baseTemplate: string;
  slots: ManifestSlot[];
  unmapped: UnmappedLayer[];
}

// ---------------------------------------------------------------------------
// 7.2 Design system IR — persistent asset, produced by M1 (extractor)
// ---------------------------------------------------------------------------

export interface Palette {
  primary: string;
  accent: string;
  bg: string;
  text: string;
  [key: string]: string;
}

export interface TypeToken {
  /** Real font-family read from <text>; roles may differ across a theme. */
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
}

export interface TypeScale {
  title: TypeToken;
  subtitle: TypeToken;
  body: TypeToken;
  [key: string]: TypeToken;
}

export interface SpacingToken {
  unit: number;
  scale: number[];
}

export interface Tokens {
  /** Default body font (representative); per-slot real family takes precedence. */
  fontFamily: string;
  colors: Palette;
  /** All distinct colors used across the theme, most frequent first. */
  palette: string[];
  type: TypeScale;
  spacing: SpacingToken;
}

/** A slot definition inside a reusable block. */
export interface BlockSlot {
  role: Role;
  type: SlotType;
  /** Max character count for text slots. */
  max?: number;
  /** Aspect ratio for image slots. */
  ratio?: string;
}

export interface Block {
  id: string;
  bbox: BBox;
  repeatable: boolean;
  slots: BlockSlot[];
}

export interface Region {
  id: string;
  bbox: BBox;
  flow: FlowDirection;
  gap: number;
  allowedBlocks: string[];
  /** Slot ids placed in this region (assemble reads regions, not raw slots). */
  slotIds?: string[];
  /** If this region is a repeatable block row, its block id. */
  blockId?: string;
}

// ---------------------------------------------------------------------------
// Design grammar — relational/placement rules measured from the template
// (DEVDOC: assetize stage; the "extraction" half of RCE). Deterministic.
// ---------------------------------------------------------------------------

/** Snap guidelines elements align to, in viewBox px. */
export interface AlignmentGrid {
  xGuides: number[];
  yGuides: number[];
  margin: number;
}

/** Vertical gap vocabulary quantized to a base unit. */
export interface SpacingRhythm {
  baseUnit: number;
  gaps: { tight: number; normal: number; loose: number; section: number };
}

export interface HierarchyRank {
  role: Role;
  size: number;
  weight: number;
}

export interface Hierarchy {
  /** Roles ordered by visual weight (largest first). */
  ranks: HierarchyRank[];
  titleToBodyRatio: number;
}

/** A cluster of slots that sit together (proximity + shared alignment). */
export interface SlotGroup {
  id: string;
  roles: Role[];
  slotIds: string[];
}

export interface DesignGrammar {
  alignmentGrid: AlignmentGrid;
  spacingRhythm: SpacingRhythm;
  hierarchy: Hierarchy;
  groups: SlotGroup[];
}

// ---------------------------------------------------------------------------
// Relation graph (DEVDOC Phase 4.5) — decoration structure + typed relations,
// measured deterministically (vision assist optional). Stored per layout.
// ---------------------------------------------------------------------------

export type DecorationKind =
  | "background"
  | "emphasis"
  | "accent"
  | "image_holder"
  | "chart"
  | "divider"
  | "frame"
  | "texture";

/** A semantic element of a layout's decoration (an index over the kept SVG). */
export interface DecorationElement {
  id: string;
  kind: DecorationKind;
  bbox: BBox;
  color?: string;
  /** Draw order (background 0 → foreground). Text always sits above. */
  z: number;
  /** Visual weight 0..1 (area × color contrast); used for emphasis/avoid. */
  salience?: number;
  ratio?: string;
  orientation?: "horizontal" | "vertical";
}

export interface DecorationModel {
  layoutId: string;
  decorationRef: string;
  elements: DecorationElement[];
}

export type RelationType =
  | "above"
  | "below"
  | "left_of"
  | "right_of"
  | "row"
  | "column"
  | "grid"
  | "aligned"
  | "coupled"
  | "same_size"
  | "larger_than"
  | "reading_order"
  | "emphasis_rank"
  | "over"
  | "inside"
  | "anchored_to"
  | "avoids"
  | "beside";

export type AnchorRegion =
  | "left_half"
  | "right_half"
  | "top"
  | "bottom"
  | "center"
  | "left_third"
  | "center_third"
  | "right_third"
  | "top_third"
  | "bottom_third";

/**
 * A typed relation edge. Fields are populated per `type` (loose by design so the
 * closed vocabulary stays in one shape); all relations must reduce to linear
 * constraints for the v2 solver.
 */
export interface RelationEdge {
  type: RelationType;
  /** Pairwise relations. */
  a?: string;
  b?: string;
  /** Set/ordered relations. */
  nodes?: string[];
  order?: string[];
  axis?: "left" | "center" | "right" | "top" | "baseline";
  strength?: "tight" | "loose" | "section";
  distribute?: "equal" | "space_between";
  /** Slot↔decoration relations. */
  slot?: string;
  decoration?: string;
  region?: AnchorRegion;
  /** Measurement confidence 0..1; low → human review. */
  confidence?: number;
}

export interface RelationNode {
  id: string;
  kind: "slot" | "decoration";
  role: Role;
  bbox: BBox;
}

export interface RelationGraph {
  layoutId: string;
  nodes: RelationNode[];
  edges: RelationEdge[];
}

/**
 * Output of the placement director (Phase 4.7-a). Coordinate-free: repeatable
 * cards (each = role→text) get reflowed by the solver into the layout's row
 * region; singles map a fixed slot id → text.
 */
export interface PlacementPlan {
  layoutId: string;
  cards: Record<string, string>[];
  singles: Record<string, string>;
  /** Image slot id → asset URL/data-URI to place (cover-cropped). 4.7-b. */
  images?: Record<string, string>;
}

/** Vision critique of a rendered slide (Phase 4.7-c, evaluator-optimizer). */
export interface CritiqueIssue {
  severity: "high" | "med" | "low";
  target: string;
  problem: string;
  fix: string;
}
export interface CritiquePatch {
  verdict: "accept" | "revise";
  issues: CritiqueIssue[];
}

/** Recurring relation pattern across the theme's slides (Claude vocabulary). */
export interface RelationConvention {
  pattern: string;
  support: number;
}

/**
 * A slot with its measured placement and style, persisted in the layout asset.
 * Carries the slot's own measured font (for inplace fidelity); the theme's
 * shared type scale lives in tokens (for consistency / re-composition).
 */
export interface PlacedSlot {
  id: string;
  role: Role;
  type: SlotType;
  bbox: BBox;
  align: TextAlign;
  groupId?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: string;
  ratio?: string;
  /** Finer media kind for image/graphic slots (vision classifier). */
  mediaKind?: MediaKind;
  /** Whether a user upload can replace this image slot. */
  replaceable?: boolean;
  /** Free-form note from the classifier (debugging / human review). */
  note?: string;
}

export interface Layout {
  id: string;
  /** Reference to the decoration-only SVG fragment (text slots stripped). */
  decorationRef: string;
  /** Slide intent from the vision classifier (composition picks by this). */
  archetype?: LayoutArchetype;
  /** This layout's background fill (full-canvas), preserved per layout. */
  background: string;
  /** Measured placement + style of every text/image slot (assemble reads this). */
  slots: PlacedSlot[];
  /** Decoration decomposition (Phase 4.5). */
  decorationModel?: DecorationModel;
  /** Typed relation graph over slots + decoration (Phase 4.5). */
  relationGraph?: RelationGraph;
  regions: Region[];
  /**
   * Slot ids in authoring order. Assemble's inplace special case maps content
   * 1:1 onto these; full re-composition uses `slots` + grammar instead.
   */
  defaultSlots: string[];
}

/**
 * One design system per theme: shared tokens + grammar extracted across all of
 * the theme's slides, plus every slide as a layout. Generation reads this only.
 */
export interface DesignSystemIR {
  /** Theme name; one design system per theme. */
  templateId: string;
  theme: Theme;
  version: 1;
  canvas: Canvas;
  /** Shared design language across the whole theme. */
  tokens: Tokens;
  /** Common relational + placement rules across the theme's slides. */
  grammar: DesignGrammar;
  /** Recurring relation patterns across the theme (Phase 4.5). */
  relationConventions?: RelationConvention[];
  blocks: Block[];
  /** Every slide of the theme, as a layout. */
  layouts: Layout[];
}

// ---------------------------------------------------------------------------
// 7.3 Composition IR — produced per generation by M3 (Claude). No coordinates.
// ---------------------------------------------------------------------------

/** Content map keyed by slot role; image slots reference an asset id. */
export type SlotContent = Record<string, string>;

export interface BlockInstance {
  block: string;
  content: SlotContent;
}

export type RegionContents = Record<string, BlockInstance[]>;

export interface CompositionSlide {
  layoutId: string;
  regions: RegionContents;
}

export type AssetSource = "user_upload" | "generated";

export interface AssetRef {
  assetId: string;
  role: Role;
  source: AssetSource;
  url: string;
}

export interface CompositionIR {
  deckId: string;
  templateId: string;
  title: string;
  slides: CompositionSlide[];
  assets: AssetRef[];
}

// ---------------------------------------------------------------------------
// Render tree — output of M4 (solver), input of M5 (renderer)
// ---------------------------------------------------------------------------

export interface RenderTextElement {
  kind: "text";
  /** Matches the base-template <text> id to replace in place. */
  id: string;
  role: Role;
  bbox: BBox;
  /** Wrapped lines after fitting. */
  lines: string[];
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  letterSpacing?: string;
  color: string;
  align: TextAlign;
  lineHeight: number;
  /** Set when content was ellipsized or shrunk beyond the slot. */
  overflow?: boolean;
}

export interface RenderImageElement {
  kind: "image";
  id: string;
  role: Role;
  bbox: BBox;
  assetUrl: string;
  /** Cover-crop source rect within the original image. */
  ratio?: string;
}

/** A cloned decoration shape (e.g. a card's emphasis rect repeated per card). */
export interface RenderRectElement {
  kind: "rect";
  id: string;
  bbox: BBox;
  fill: string;
  rx?: number;
}

export type RenderElement = RenderTextElement | RenderImageElement | RenderRectElement;

export interface RenderSlide {
  layoutId: string;
  canvas: Canvas;
  /** Decoration-only SVG laid as the base; text is synthesized on top. */
  decorationUrl: string;
  /** Layout background fill (drawn if the decoration fragment lacks one). */
  background?: string;
  /** Decoration element ids to remove before compositing (cloned by reflow). */
  suppressDecorationIds?: string[];
  elements: RenderElement[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Renderer adapter boundary (DEVDOC 4.1 / 13.6)
// ---------------------------------------------------------------------------

export interface RenderAdapter {
  /** v1 "composite"; future "pptx" etc. */
  readonly id: string;
  /**
   * @param slide         solved render tree
   * @param decorationSvg decoration-only SVG fragment to lay as the base
   * @param tokens        design system tokens
   */
  render(slide: RenderSlide, decorationSvg: string, tokens: Tokens): string;
}
