/**
 * Render backend interface
 *
 * Abstraction of drawing primitives. Implemented per output target such as PDF / Canvas.
 * All coordinates are in pt (1pt = 1/72 inch). The backend converts to the output target's coordinate system.
 */

import type { RenderFormField, StructureTag, StructureNamespace, RenderGlyphRun, RenderPdfSourceVector, BlendMode, OverprintMode, RenderingIntent, RenderDeviceParams, RenderOptionalContent, RenderCalculatorFunction, RenderTransferFunction, RenderPageTransparencyGroup, RenderNode, RenderPage } from '../types/render.js'
import type { PdfActionDef, PdfDestinationDef, PdfFormXObjectDef, PdfOpiMetadataDef, PdfProcessColorSpaceDef, PdfSpecialColorDef } from '../types/template.js'
import type { PdfMeasurement, PdfPointData } from '../pdf/pdf-measurement.js'
export type { RenderFormField }
export type { StructureTag, RenderGlyphRun, BlendMode, OverprintMode, RenderingIntent, RenderDeviceParams, RenderOptionalContent } from '../types/render.js'

export interface RectCornerRadii {
  topLeft?: number
  topRight?: number
  bottomRight?: number
  bottomLeft?: number
}

export interface ResolvedRectCornerRadii {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

export interface RectDrawOptions extends ShapeDrawOptions {
  radius?: number
  cornerRadii?: RectCornerRadii
}

export interface RenderBackend {
  // ─── Lifecycle ───
  /** Starts clean document state while retaining immutable constructor configuration. */
  beginDocument(): void
  endDocument(): void
  beginPage(width: number, height: number, options?: { transparencyGroup?: RenderPageTransparencyGroup }): void
  endPage(): void

  // ─── Graphics state ───
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  transform?(a: number, b: number, c: number, d: number, e: number, f: number): void
  clip(x: number, y: number, width: number, height: number): void
  clipPath(commands: Uint8Array, coords: Float32Array, fillRule?: 'nonzero' | 'evenodd'): void
  setOpacity(opacity: number): void
  setBlendMode?(mode: BlendMode): void
  setOverprint?(fill: boolean, stroke: boolean, mode: OverprintMode): void
  /** Raster backends capture an overprinted object so native colorants survive compositing. */
  beginOverprintObject?(): void
  endOverprintObject?(): void
  setRenderingIntent?(intent: RenderingIntent): void
  setTransparencyParameters?(alphaIsShape: boolean | undefined, textKnockout: boolean | undefined): void
  setDeviceParams?(params: RenderDeviceParams): void
  beginDeviceParams?(params: RenderDeviceParams): void
  endDeviceParams?(): void

  // ─── Drawing primitives ───

  drawText(
    x: number, y: number,
    text: string,
    fontId: string, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void

  drawLine(
    x1: number, y1: number, x2: number, y2: number,
    lineWidth: number, color: string,
    dash?: number[],
  ): void

  drawRect(
    x: number, y: number, width: number, height: number,
    options?: RectDrawOptions,
  ): void

  drawEllipse(
    cx: number, cy: number, rx: number, ry: number,
    options?: ShapeDrawOptions,
  ): void

  drawPath(
    commands: Uint8Array, coords: Float32Array,
    options?: ShapeDrawOptions,
  ): void

  /**
   * Draw by passing an SVG path d string directly to the backend implementation.
   * A return value of true means it was drawn; on false/undefined the caller falls back.
   */
  drawPathData?(
    d: string,
    transform: [number, number, number, number, number, number],
    options?: ShapeDrawOptions,
  ): boolean

  /**
   * Extended path drawing with solid or gradient paints.
   */
  drawPathWithPaints(
    commands: Uint8Array, coords: Float32Array,
    options: PathPaintOptions,
  ): void

  /** Draw immutable shared vector definitions through affine instances. */
  drawPdfSourceVector?(
    source: RenderPdfSourceVector,
    options: PathPaintOptions,
  ): void

  drawSvg?(
    x: number, y: number, width: number, height: number,
    svgData: string,
  ): void

  drawImage(
    x: number, y: number, width: number, height: number,
    imageId: string,
    options?: ImageDrawOptions,
  ): void

  /**
   * Draw an image from raw data (for SVG <image href="data:...">).
   * Backends without an implementation fall back to going through drawImage(imageId).
   */
  drawImageData?(
    x: number, y: number, width: number, height: number,
    data: Uint8Array,
    mimeType?: string,
  ): void

  /**
   * Draw an image with an arbitrary affine matrix.
   * The matrix maps unit-square image coordinates (u, v) to drawing coordinates:
   * [x]   [a c e] [u]
   * [y] = [b d f] [v]
   * [1]   [0 0 1] [1]
   */
  drawImageAffine?(
    a: number, b: number, c: number, d: number, e: number, f: number,
    imageId: string,
    options?: ImageDrawOptions,
  ): void

  /**
   * Draw a raw-data image with an arbitrary affine matrix (for SVG data URIs).
   */
  drawImageDataAffine?(
    a: number, b: number, c: number, d: number, e: number, f: number,
    data: Uint8Array,
    mimeType?: string,
  ): void

  // ─── Optional: annotations/bookmarks ───

  /** Add a link annotation (for the PDF backend) */
  addAnnotation?(pageIndex: number, annotation: LinkAnnotation): void

  /** Set the bookmark list (for the PDF backend) */
  setBookmarks?(bookmarks: BookmarkEntry[]): void

  /** Set the anchor list (for the PDF backend) */
  setAnchors?(anchors: AnchorEntry[]): void

  /**
   * Merge document resources below constructor-supplied resources.
   * Call after beginDocument and before beginPage. The next beginDocument discards them.
   */
  setImages?(images: Record<string, string | Uint8Array>): void

  // ─── Optional: Tagged PDF / accessibility ───

  /** Enable Tagged PDF mode */
  setTagged?(
    lang?: string,
    roleMap?: Record<string, string>,
    structureNamespaces?: StructureNamespace[],
    pronunciationLexiconFileIndexes?: number[],
  ): void

  /** Begin tagged content (BDC / BMC) */
  /**
   * Optional content-group boundaries around self-contained op sequences
   * (one per top-level page child). Backends may deduplicate groups whose
   * final content is identical across pages (PDF Form XObjects).
   */
  /**
   * Interactive form field (AcroForm widget). Preview backends draw the
   * initial appearance; the PDF backend also emits the interactive field.
   */
  drawFormField?(x: number, y: number, width: number, height: number, field: RenderFormField): void

  /** Returns true when cached content was composited and the renderer must skip the node. */
  beginContentGroup?(node: RenderNode, index: number, page: RenderPage): boolean | void
  endContentGroup?(): void

  /** Capture a preserved PDF Form XObject in its local top-down coordinate system. */
  beginPdfForm?(form: PdfFormXObjectDef): void
  endPdfForm?(): void

  beginOptionalContent?(group: RenderOptionalContent): void
  endOptionalContent?(): void

  /**
   * Begin capturing a soft-mask source group (PDF ExtGState /SMask /G).
   * Drawing between begin/end defines the mask; end pairs with the next
   * beginTransparencyGroup, which consumes the captured mask.
   */
  beginSoftMask?(type: 'luminosity' | 'alpha', width: number, height: number, backdrop?: [number, number, number], transferFunction?: 'Identity' | RenderTransferFunction, x?: number, y?: number, colorSpace?: PdfProcessColorSpaceDef, isolated?: boolean, knockout?: boolean): void
  endSoftMask?(): void

  /**
   * Begin a transparency group (PDF /Group /S /Transparency). Drawing between
   * begin/end is composited as an isolated/knockout unit, then drawn under the
   * current CTM with the given group opacity and any pending soft mask.
   */
  beginTransparencyGroup?(width: number, height: number, options: TransparencyGroupOptions): void
  endTransparencyGroup?(): void
  /** Raster backend can apply constant alpha directly when the subtree has exactly one solid paint. */
  directSinglePaintGroupOpacity?: boolean
  /** Capture one direct child as a single transparency-group compositing object. */
  beginTransparencyObject?(node?: RenderNode): void
  endTransparencyObject?(): void

  beginTaggedContent?(tag: StructureTag): void

  /** End tagged content (EMC) */
  endTaggedContent?(): void
}

export interface ImageDrawOptions {
  interpolate?: boolean
  intent?: RenderingIntent
  alternates?: Array<{ imageId: string, defaultForPrinting?: boolean }>
  opi?: PdfOpiMetadataDef
  measure?: PdfMeasurement
  pointData?: PdfPointData[]
}

export interface TransparencyGroupOptions {
  /** PDF /Group /I: composite against a fully transparent backdrop. */
  isolated: boolean
  /** PDF /Group /K: knockout group. */
  knockout: boolean
  /** Constant alpha (PDF /ca /CA) applied to the composited group, if < 1. */
  opacity?: number
  /** Whether a soft mask was captured (beginSoftMask/endSoftMask) for this group. */
  hasSoftMask: boolean
  /** Lower-left/top-left origin of the group's device-space bounds. */
  x?: number
  y?: number
}

export interface TextDrawOptions {
  /** Replacement text for extraction and accessibility. */
  actualText?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  hAlign?: 'left' | 'center' | 'right'
  /** Text block width (pt, used for hAlign calculation) */
  width?: number
  /** Variable Font axis values */
  variation?: Record<string, number>
  /** Writing direction */
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'
  /** Resolved visual text direction. */
  direction?: 'ltr' | 'rtl'
  /** Specify glyph IDs directly (bypasses cmap) */
  glyphIds?: number[]
  /** Whether to outline the text (draw glyph paths) */
  outlineText?: boolean
  /** PDF font program handling. Non-PDF backends ignore this property. */
  pdfFontMode?: 'embedded' | 'reference'
  textPaintMode?: 'fill' | 'stroke' | 'fillStroke'
  textStrokeColor?: string
  textStrokeWidth?: number
  /**
   * Extra spacing per glyph (pt, letter spacing / justify distribution).
   * Ignored when glyphRun is present (spacing is already baked into its advances).
   */
  letterSpacing?: number
  /** Horizontal text scale multiplier. Default is 1. */
  horizontalScale?: number
  /** Explicit baseline offset from the supplied Y coordinate. */
  baselineOffset?: number
  /** Shaped glyph run from the layout engine (authoritative glyphs + positions) */
  glyphRun?: RenderGlyphRun
}

export interface ShapeDrawOptions {
  fill?: string
  stroke?: string
  fillOpacity?: number
  strokeOpacity?: number
  strokeWidth?: number
  fillRule?: 'nonzero' | 'evenodd'
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDasharray?: number[]
  strokeDashoffset?: number
}

export function hasRectCornerRadius(
  options?: Pick<RectDrawOptions, 'radius' | 'cornerRadii'>,
): boolean {
  if (options === undefined) return false
  if (options.radius !== undefined && options.radius > 0) return true
  const corners = options.cornerRadii
  return corners !== undefined && (
    (corners.topLeft !== undefined && corners.topLeft > 0)
    || (corners.topRight !== undefined && corners.topRight > 0)
    || (corners.bottomRight !== undefined && corners.bottomRight > 0)
    || (corners.bottomLeft !== undefined && corners.bottomLeft > 0)
  )
}

export function resolveRectCornerRadii(
  width: number,
  height: number,
  options?: Pick<RectDrawOptions, 'radius' | 'cornerRadii'>,
): ResolvedRectCornerRadii {
  const limit = Math.min(width, height) / 2
  const radius = options?.radius ?? 0
  const cornerRadii = options?.cornerRadii
  return {
    topLeft: clampRectCornerRadius(cornerRadii?.topLeft ?? radius, limit),
    topRight: clampRectCornerRadius(cornerRadii?.topRight ?? radius, limit),
    bottomRight: clampRectCornerRadius(cornerRadii?.bottomRight ?? radius, limit),
    bottomLeft: clampRectCornerRadius(cornerRadii?.bottomLeft ?? radius, limit),
  }
}

function clampRectCornerRadius(value: number, limit: number): number {
  if (value <= 0) return 0
  if (value >= limit) return limit
  return value
}

export interface GradientStop {
  offset: number
  color: string
  opacity?: number
}

export interface LinearGradientPaint {
  type: 'linear-gradient'
  x1: number
  y1: number
  x2: number
  y2: number
  stops: GradientStop[]
  spreadMethod?: 'pad' | 'reflect' | 'repeat'
  pdfShading?: import('../types/template.js').PdfAxialRadialShadingDef
}

export interface RadialGradientPaint {
  type: 'radial-gradient'
  cx: number
  cy: number
  r: number
  fx?: number
  fy?: number
  fr?: number
  stops: GradientStop[]
  spreadMethod?: 'pad' | 'reflect' | 'repeat'
  pdfShading?: import('../types/template.js').PdfAxialRadialShadingDef
}

export type GradientPaint = LinearGradientPaint | RadialGradientPaint

/**
 * Tensor-product patch in page coordinates: 4x4 control net as 32 numbers
 * (x,y row-major p00..p33), corner colors at (u,v)=(0,0),(0,1),(1,1),(1,0).
 */
export interface MeshPatch {
  points: number[]
  colors: [string, string, string, string]
}

/** Gouraud triangle in page coordinates (x0,y0,x1,y1,x2,y2). */
export interface MeshTriangle {
  points: number[]
  colors: [string, string, string]
}

/** Mesh gradient paint (PDF shading types 4/5/6/7). */
/** Lattice-form Gouraud mesh (rows x columns vertex grid). */
export interface MeshLattice {
  columns: number
  points: number[]
  colors: string[]
}

export interface MeshGradientPaint {
  type: 'mesh-gradient'
  patches: MeshPatch[]
  triangles: MeshTriangle[]
  packedPatches?: { points: Float32Array, colors: Uint32Array }
  packedTriangles?: { points: Float32Array, colors: Uint32Array }
  /** Lattice-form mesh (PDF ShadingType 5) */
  lattice?: MeshLattice
  pdfShading?: import('../types/template.js').PdfMeshShadingDef
}

/** Vector path of a tiling pattern cell (pattern space, cubic path data). */
export interface TilePathGraphic {
  kind: 'path'
  commands: Uint8Array
  coords: Float32Array
  fill?: PaintValue
  stroke?: PaintValue
  strokeWidth?: number
  fillRule?: 'nonzero' | 'evenodd'
}

/** Raster image of a tiling pattern cell (pattern space). */
export interface TileImageGraphic {
  kind: 'image'
  x: number
  y: number
  width: number
  height: number
  imageId: string
}

export interface TileTextGraphic {
  kind: 'text'
  x: number
  y: number
  text: string
  fontId: string
  fontSize: number
  color: string
}

export interface TileGroupGraphic {
  kind: 'group'
  x: number
  y: number
  width: number
  height: number
  affineTransform?: [number, number, number, number, number, number]
  clipPath?: { commands: Uint8Array, coords: Float32Array, fillRule?: 'nonzero' | 'evenodd' }
  opacity?: number
  blendMode?: BlendMode
  overprintFill?: boolean
  overprintStroke?: boolean
  overprintMode?: OverprintMode
  renderingIntent?: RenderingIntent
  alphaIsShape?: boolean
  textKnockout?: boolean
  optionalContent?: RenderOptionalContent
  transparencyGroup?: boolean
  isolated?: boolean
  knockout?: boolean
  deviceParams?: RenderDeviceParams
  pdfForm?: PdfFormXObjectDef
  softMask?: {
    type: 'luminosity' | 'alpha'
    colorSpace?: PdfProcessColorSpaceDef
    isolated?: boolean
    knockout?: boolean
    backdrop?: [number, number, number]
    transferFunction?: 'Identity' | RenderTransferFunction
    graphics: TileGraphic[]
  }
  graphics: TileGraphic[]
}

export type TileGraphic = TilePathGraphic | TileImageGraphic | TileTextGraphic | TileGroupGraphic

/**
 * Tiling pattern paint (PDF pattern type 1). The cell graphics repeat every
 * xStep/yStep in pattern space; `matrix` maps pattern space to page space.
 */
export interface TilingPatternPaint {
  type: 'tiling-pattern'
  tilingType?: 1 | 2 | 3
  /** PDF PaintType: colored patterns own their colors; uncolored patterns take `color` at use-site. */
  paintType?: 'colored' | 'uncolored'
  /** Use-site color for uncolored tiling patterns. */
  color?: string
  bbox: [number, number, number, number]
  xStep: number
  yStep: number
  matrix: [number, number, number, number, number, number]
  graphics: TileGraphic[]
}

export interface SampledFunctionPaint {
  size: [number, number]
  bitsPerSample: 1 | 2 | 4 | 8 | 12 | 16 | 24 | 32
  range: [number, number, number, number, number, number]
  samples: number[]
  encode?: [number, number, number, number]
  decode?: [number, number, number, number, number, number]
}

export type FunctionShadingPaint = CalculatorFunctionShadingPaint | SampledFunctionShadingPaint

/** Function-based shading paint (PDF ShadingType 1, FunctionType 4). */
export interface CalculatorFunctionShadingPaint {
  type: 'function-shading'
  /** [x0, x1, y0, y1] input domain */
  domain: [number, number, number, number]
  /** Domain -> page/element space mapping */
  matrix: [number, number, number, number, number, number]
  /** Optional Shading dictionary /Background color in DeviceRGB components. */
  background?: [number, number, number]
  /** Optional Shading dictionary /BBox in shading coordinate space. */
  bbox?: [number, number, number, number]
  /** Optional Shading dictionary /AntiAlias hint. */
  antiAlias?: boolean
  /** PDF painting operator: PatternType 2 by default, or direct `sh` under the current clip. */
  paintOperator?: 'pattern' | 'sh'
  /** PostScript calculator body: consumes x y, leaves r g b (0..1) */
  expression: string
}

/** Function-based shading paint (PDF ShadingType 1, FunctionType 0). */
export interface SampledFunctionShadingPaint {
  type: 'function-shading'
  /** [x0, x1, y0, y1] input domain */
  domain: [number, number, number, number]
  /** Domain -> page/element space mapping */
  matrix: [number, number, number, number, number, number]
  /** Optional Shading dictionary /Background color in DeviceRGB components. */
  background?: [number, number, number]
  /** Optional Shading dictionary /BBox in shading coordinate space. */
  bbox?: [number, number, number, number]
  /** Optional Shading dictionary /AntiAlias hint. */
  antiAlias?: boolean
  /** PDF painting operator: PatternType 2 by default, or direct `sh` under the current clip. */
  paintOperator?: 'pattern' | 'sh'
  /** Sampled function table. */
  sampled: SampledFunctionPaint
}

export type PaintValue = string | PdfSpecialColorDef | GradientPaint | MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint

export interface PathPaintOptions {
  fill?: PaintValue
  stroke?: PaintValue
  fillOpacity?: number
  strokeOpacity?: number
  strokeWidth?: number
  fillRule?: 'nonzero' | 'evenodd'
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDasharray?: number[]
  strokeDashoffset?: number
}

/** Link annotation (used when the backend supports it) */
export interface LinkAnnotation {
  /** Link type */
  type: 'uri' | 'localAnchor' | 'localPage' | 'remoteAnchor' | 'remotePage'
  /** Link target */
  target: string
  /** Remote PDF file path */
  remoteDocument?: string
  /** Link area rectangle (pt, page coordinate system) */
  x: number
  y: number
  width: number
  height: number
}

/** Bookmark information */
export interface BookmarkEntry {
  label: string
  level: number
  pageIndex: number
  y: number
  /** Complete outline destination; overrides pageIndex/y when present. */
  destination?: PdfDestinationDef
  /** Viewer-bound outline action; mutually exclusive with destination. */
  action?: PdfActionDef
}

/** Anchor information */
export interface AnchorEntry {
  name: string
  pageIndex: number
  y: number
}
