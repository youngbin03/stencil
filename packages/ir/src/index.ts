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

/** A slot with its measured placement, persisted in the layout asset. */
export interface PlacedSlot {
  id: string;
  role: Role;
  type: SlotType;
  bbox: BBox;
  align: TextAlign;
  groupId?: string;
}

export interface Layout {
  id: string;
  /** Reference to the decoration-only SVG fragment (text slots stripped). */
  decorationRef: string;
  /** Measured placement of every text/image slot (assemble reads this). */
  slots: PlacedSlot[];
  regions: Region[];
  /**
   * Slot ids in authoring order. Assemble's inplace special case maps content
   * 1:1 onto these; full re-composition uses `slots` + grammar instead.
   */
  defaultSlots: string[];
}

export interface DesignSystemIR {
  templateId: string;
  theme: Theme;
  version: 1;
  canvas: Canvas;
  tokens: Tokens;
  /** Relational + placement rules of the template (per layout in v1). */
  grammar: DesignGrammar;
  blocks: Block[];
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

export type RenderElement = RenderTextElement | RenderImageElement;

export interface RenderSlide {
  layoutId: string;
  canvas: Canvas;
  /** Original SVG used as the render base; slot text is replaced in place. */
  baseTemplateUrl: string;
  elements: RenderElement[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Renderer adapter boundary (DEVDOC 4.1 / 13.6)
// ---------------------------------------------------------------------------

export interface RenderAdapter {
  /** v1 "inplace" / v2 "resynth", etc. */
  readonly id: string;
  /**
   * @param slide   solved render tree
   * @param baseSvg original template SVG string (used by "inplace"; ignored by "resynth")
   * @param tokens  design system tokens
   */
  render(slide: RenderSlide, baseSvg: string, tokens: Tokens): string;
}
