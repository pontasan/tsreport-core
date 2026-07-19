import type { PdfMeasurement, PdfPointData } from '../pdf/pdf-measurement.js'

/**
 * Type definitions for the report template JSON
 *
 * Dimension units: all coordinates, sizes, margins, line widths, and font sizes are in pt (1pt = 1/72 inch).
 * This matches the native PDF unit, and the render tree inherits this unit as-is.
 * For Canvas drawing, the renderer's scale option converts pt → screen pixels.
 */

// ─── Expressions ───

/**
 * Expression type. Either a string mini-language or a callback (TypeScript function).
 *
 * String expressions:
 *   'field.customer.name'
 *   'field.price * field.quantity'
 *   '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`'
 *   'field.amount > 0 ? "OK" : "NG"'
 *
 * Callback: (field, vars, param, report) => field.customer.name
 */
export type Expression = string | ExpressionCallback

/**
 * Expression callback. Writes expression logic directly as a TypeScript function.
 */
export type ExpressionCallback = (
  field: Record<string, unknown>,
  vars: Record<string, unknown>,
  param: Record<string, unknown>,
  report: ReportContext,
) => unknown

/**
 * Report execution context. Passed as the 4th argument to expression callbacks.
 */
export interface ReportContext {
  /** Current page number (1-based) */
  PAGE_NUMBER: number
  /** Current column number (1-based) */
  COLUMN_NUMBER: number
  /** Number of records processed */
  REPORT_COUNT: number
  /** Total page count (finalized with evaluationTime=report) */
  TOTAL_PAGES: number
  /** Subreport return value */
  RETURN_VALUE?: unknown
  /** Built-in format function */
  format: (value: unknown, pattern: string) => string
  /** Custom formatters (registered in the template) */
  formatters: Record<string, (value: unknown) => string>
}

// ─── Top level ───

export interface ReportTemplate {
  name?: string
  page: PageSettings
  columns?: ColumnSettings
  styles?: StyleDef[]
  parameters?: ParameterDef[]
  fields?: FieldDef[]
  variables?: VariableDef[]
  groups?: GroupDef[]
  bands: BandSet
  /** Custom formatters. Map of pattern name → format function */
  formatters?: Record<string, (value: unknown) => string>
  /** Page break after the title band */
  titleNewPage?: boolean
  /** Page break before the summary band */
  summaryNewPage?: boolean
  /** Whether to draw pageHeader/pageFooter on the summary page when summaryNewPage is set (default: false) */
  summaryWithPageHeaderAndFooter?: boolean
  /** Places the column footer right below the column content instead of at the bottom (default: false) */
  floatColumnFooter?: boolean
}

// ─── Page settings ───

export interface PageSettings {
  /** Predefined size name: "A4", "B5", "Letter", etc. */
  size?: string
  /** Custom width (pt) */
  width?: number
  /** Custom height (pt) */
  height?: number
  orientation?: 'portrait' | 'landscape'
  margins?: Margins
  /** PDF page transparency blending color space and group flags. */
  transparencyGroup?: PageTransparencyGroupDef
}

export interface PageTransparencyGroupDef {
  colorSpace?: PdfProcessColorSpaceDef
  isolated?: boolean
  knockout?: boolean
}

export interface Margins {
  /** Top margin (pt) */
  top: number
  /** Bottom margin (pt) */
  bottom: number
  /** Left margin (pt) */
  left: number
  /** Right margin (pt) */
  right: number
}

// ─── Columns ───

export interface ColumnSettings {
  count?: number
  /** Column width (pt) */
  width?: number
  /** Spacing between columns (pt) */
  spacing?: number
  printOrder?: 'vertical' | 'horizontal'
}

// ─── Styles ───

export interface StyleDef {
  name: string
  parentStyle?: string
  isDefault?: boolean
  fontFamily?: string
  /** Font size (pt) */
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  /** Foreground color ("#RRGGBB" or "#RRGGBBAA") */
  forecolor?: string
  /** Background color */
  backcolor?: string
  hAlign?: 'left' | 'center' | 'right' | 'justify'
  vAlign?: 'top' | 'middle' | 'bottom'
  /** Text rotation (degrees) */
  rotation?: 0 | 90 | 180 | 270
  padding?: Padding
  border?: BorderDef
  /** Display mode */
  mode?: 'opaque' | 'transparent'
  /** Opacity (0.0-1.0) */
  opacity?: number
  /** Variable Font axis values (e.g. { wght: 700, wdth: 75 }) */
  variation?: Record<string, number>
  /** Writing mode */
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'
  conditionalStyles?: ConditionalStyleDef[]
  /** Text direction (ltr/rtl/auto) */
  direction?: 'ltr' | 'rtl' | 'auto'
  /** OpenType script tag used for shaping. */
  openTypeScript?: string
  /** OpenType language-system tag used for shaping. */
  openTypeLanguage?: string
  /** Global OpenType feature values; zero disables and type 3 uses one-based alternate indices. */
  openTypeFeatures?: Record<string, number>
}

export interface ConditionalStyleDef {
  condition: Expression
  fontFamily?: string
  /** Font size (pt) */
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  forecolor?: string
  backcolor?: string
  hAlign?: 'left' | 'center' | 'right' | 'justify'
  vAlign?: 'top' | 'middle' | 'bottom'
  opacity?: number
  openTypeScript?: string
  openTypeLanguage?: string
  openTypeFeatures?: Record<string, number>
}

export interface Padding {
  /** Top padding (pt) */
  top?: number
  /** Bottom padding (pt) */
  bottom?: number
  /** Left padding (pt) */
  left?: number
  /** Right padding (pt) */
  right?: number
}

export interface BorderDef {
  /** Line width (pt) */
  width?: number
  color?: string
  style?: 'solid' | 'dashed' | 'dotted'
  top?: BorderSideDef | null
  bottom?: BorderSideDef | null
  left?: BorderSideDef | null
  right?: BorderSideDef | null
}

export interface BorderSideDef {
  /** Line width (pt) */
  width: number
  color: string
  style: 'solid' | 'dashed' | 'dotted'
}

// ─── Parameters / fields / variables ───

export interface ParameterDef {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date'
  defaultValue?: unknown
}

export interface FieldDef {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date'
}

export interface VariableDef {
  name: string
  expression: Expression
  calculation: 'nothing' | 'count' | 'distinctCount' | 'sum' | 'average' | 'min' | 'max' | 'first'
  resetType?: 'report' | 'page' | 'column' | 'group' | 'none'
  resetGroup?: string
  incrementCondition?: Expression
  initialValue?: Expression
}

// ─── Groups ───

export interface GroupDef {
  name: string
  expression: Expression
  keepTogether?: boolean
  /** Minimum remaining height required to start the group (pt) */
  minHeightToStartNewPage?: number
  reprintHeaderOnEachPage?: boolean
  resetPageNumber?: boolean
  startNewPage?: boolean
  startNewColumn?: boolean
  footerPosition?: 'normal' | 'stackAtBottom' | 'forceAtBottom' | 'collateAtBottom'
  header?: BandDef
  footer?: BandDef
}

// ─── Bands ───

export interface BandSet {
  background?: BandDef
  title?: BandDef
  pageHeader?: BandDef
  columnHeader?: BandDef
  details?: BandDef[]
  columnFooter?: BandDef
  pageFooter?: BandDef
  lastPageFooter?: BandDef
  summary?: BandDef
  noData?: BandDef
}

export interface BandDef {
  /** Minimum band height (pt) */
  height: number
  /** If true, this band starts on a new page after a page break */
  startNewPage?: boolean
  /** Spacing before the band (pt) */
  spacingBefore?: number
  /** Spacing after the band (pt) */
  spacingAfter?: number
  splitType?: 'stretch' | 'prevent' | 'immediate'
  printWhenExpression?: Expression | null
  elements?: ElementDef[]
}

// ─── Elements ───

export interface GradientStopDef {
  offset: number
  color: string
  opacity?: number
}

export interface LinearGradientDef {
  type: 'linearGradient'
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  stops: GradientStopDef[]
  spreadMethod?: 'pad' | 'reflect' | 'repeat'
  pdfShading?: PdfAxialRadialShadingDef
}

export interface RadialGradientDef {
  type: 'radialGradient'
  cx?: number
  cy?: number
  r?: number
  fx?: number
  fy?: number
  fr?: number
  stops: GradientStopDef[]
  spreadMethod?: 'pad' | 'reflect' | 'repeat'
  pdfShading?: PdfAxialRadialShadingDef
}

export interface PdfAxialRadialShadingDef {
  domain: [number, number]
  extend: [boolean, boolean]
  functions?: PdfFunctionDef[]
  colorSpace?: PdfShadingColorSpaceDef
  background?: number[]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
  native?: PdfNativeAxialRadialShadingDef
}

export interface PdfNativeAxialRadialShadingDef {
  shadingType: 2 | 3
  coords: [number, number, number, number] | [number, number, number, number, number, number]
  /** Shading-pattern coordinates to element-local top-down coordinates. */
  patternMatrix: [number, number, number, number, number, number]
  bbox?: [number, number, number, number]
  paintOperator: 'pattern' | 'sh'
}

export type GradientDef = LinearGradientDef | RadialGradientDef

/**
 * Tensor-product patch of a mesh gradient. Coordinates are element-local pt
 * (like path geometry; NOT normalized). `points` holds the 4x4 control net
 * as 32 numbers (x,y row-major: p00,p01,...,p33 where the first index walks
 * the u axis and the second the v axis). `colors` holds the corner colors
 * at (u,v) = (0,0), (0,1), (1,1), (1,0).
 */
export interface MeshPatchDef {
  points: number[]
  colors: [string, string, string, string]
}

/** Gouraud-shaded triangle of a mesh gradient (element-local pt). */
export interface MeshTriangleDef {
  /** x0,y0,x1,y1,x2,y2 */
  points: number[]
  colors: [string, string, string]
}

/**
 * Mesh gradient fill (PDF shading types 4/5/6/7). Patches and triangles may
 * both be present; they paint in array order.
 */
/** Lattice-form Gouraud mesh (rows x columns vertex grid). */
export interface MeshLatticeDef {
  /** Vertices per row (>= 2); rows = points.length / 2 / columns */
  columns: number
  /** Vertex coordinates row by row: [x0,y0, x1,y1, ...] (element-local pt) */
  points: number[]
  /** One #RRGGBB color per vertex, same order as points */
  colors: string[]
}

export interface MeshGradientDef {
  type: 'meshGradient'
  patches?: MeshPatchDef[]
  triangles?: MeshTriangleDef[]
  /** Compact display representation used when native PDF mesh data is retained. */
  packedPatches?: { points: Float32Array, colors: Uint32Array }
  /** Compact Gouraud representation used when native PDF mesh data is retained. */
  packedTriangles?: { points: Float32Array, colors: Uint32Array }
  /** Lattice-form mesh (PDF ShadingType 5 equivalent) */
  lattice?: MeshLatticeDef
  pdfShading?: PdfMeshShadingDef
}

export interface PdfMeshShadingDef {
  background?: number[]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
  native?: PdfNativeMeshShadingDef
  nativeFunction?: PdfNativeFunctionShadingDef
}

/** Normative source representation retained for lossless Type 1 shading re-emission. */
export interface PdfNativeFunctionShadingDef {
  domain: [number, number, number, number]
  matrix: [number, number, number, number, number, number]
  /** Shading-pattern coordinates to element-local top-down coordinates. */
  patternMatrix: [number, number, number, number, number, number]
  functions: PdfFunctionDef[]
  colorSpace: PdfShadingColorSpaceDef
  background?: number[]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
  paintOperator: 'pattern' | 'sh'
}

/** Normative source representation retained for lossless PDF mesh re-emission. */
export interface PdfNativeMeshShadingDef {
  shadingType: 4 | 5 | 6 | 7
  bitsPerCoordinate: 1 | 2 | 4 | 8 | 12 | 16 | 24 | 32
  bitsPerComponent: 1 | 2 | 4 | 8 | 12 | 16
  bitsPerFlag?: 2 | 4 | 8
  verticesPerRow?: number
  decode: number[]
  functions?: PdfFunctionDef[]
  colorSpace: PdfShadingColorSpaceDef
  data: Uint8Array
  /** Shading coordinates to element-local top-down coordinates. */
  matrix: [number, number, number, number, number, number]
  /** Background components in the retained color space. */
  background?: number[]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
}

/** Vector path inside a tiling pattern cell (pattern space). */
export interface TilePathDef {
  kind: 'path'
  /** Translation of the path data within the cell (pattern space) */
  x?: number
  y?: number
  /** SVG path data (M/L/C/Z) */
  d: string
  fill?: FillDef
  stroke?: FillDef
  strokeWidth?: number
  fillRule?: 'nonzero' | 'evenodd'
}

/** Raster image inside a tiling pattern cell (pattern space). */
export interface TileImageDef {
  kind: 'image'
  x: number
  y: number
  width: number
  height: number
  /** Image resource id (same resolution as image elements) */
  source: string
}

/** Text painted inside a tiling pattern cell. */
export interface TileTextDef {
  kind: 'text'
  x: number
  y: number
  text: string
  fontFamily: string
  fontSize: number
  color: string
}

export interface TileGroupDef {
  kind: 'group'
  x: number
  y: number
  width: number
  height: number
  affineTransform?: [number, number, number, number, number, number]
  clipPath?: { d: string, fillRule?: 'nonzero' | 'evenodd' }
  opacity?: number
  blendMode?: BlendModeDef
  overprintFill?: boolean
  overprintStroke?: boolean
  overprintMode?: OverprintModeDef
  renderingIntent?: RenderingIntentDef
  /** Interpret alpha constants and soft masks as shape values (PDF /AIS). */
  alphaIsShape?: boolean
  /** Text knockout state inherited by text in this group (PDF /TK). */
  textKnockout?: boolean
  optionalContent?: OptionalContentDef
  transparencyGroup?: boolean
  isolated?: boolean
  knockout?: boolean
  deviceParams?: DeviceParamsDef
  pdfForm?: PdfFormXObjectDef
  softMask?: {
    type: 'luminosity' | 'alpha'
    colorSpace?: PdfProcessColorSpaceDef
    isolated?: boolean
    knockout?: boolean
    backdrop?: [number, number, number]
    transferFunction?: 'Identity' | TransferFunctionDef
    graphics: TileGraphicDef[]
  }
  graphics: TileGraphicDef[]
}

export type TileGraphicDef = TilePathDef | TileImageDef | TileTextDef | TileGroupDef

/**
 * Tiling pattern fill (PDF pattern type 1). The cell graphics repeat every
 * xStep/yStep in pattern space; `matrix` maps pattern space to element-local
 * space (identity when omitted).
 */
export interface TilingPatternDef {
  type: 'tilingPattern'
  tilingType?: 1 | 2 | 3
  /** PDF PaintType: colored patterns own their colors; uncolored patterns take `color` at use-site. */
  paintType?: 'colored' | 'uncolored'
  /** Use-site color for uncolored tiling patterns. */
  color?: string
  bbox: [number, number, number, number]
  xStep: number
  yStep: number
  matrix?: [number, number, number, number, number, number]
  graphics: TileGraphicDef[]
}

export interface SampledFunctionDef {
  /** FunctionType 0 sample grid dimensions for x and y. */
  size: [number, number]
  /** Raw sample precision used in the PDF stream. */
  bitsPerSample: 1 | 2 | 4 | 8 | 12 | 16 | 24 | 32
  /** Output range pairs. RGB shadings use [0,1,0,1,0,1]. */
  range: [number, number, number, number, number, number]
  /** Sample values in x-major order, three values per grid point. */
  samples: number[]
  /** Optional FunctionType 0 Encode array. */
  encode?: [number, number, number, number]
  /** Optional FunctionType 0 Decode array. */
  decode?: [number, number, number, number, number, number]
}

/**
 * Function-based shading (PDF ShadingType 1): a function maps (x, y) in the
 * domain to RGB. Calculator functions output as FunctionType 4; sampled
 * functions output as FunctionType 0.
 */
export type FunctionShadingDef = CalculatorFunctionShadingDef | SampledFunctionShadingDef

export interface CalculatorFunctionShadingDef {
  type: 'functionShading'
  /** [x0, x1, y0, y1] input domain */
  domain: [number, number, number, number]
  /** Domain -> element-local pt mapping (default identity) */
  matrix?: [number, number, number, number, number, number]
  /** Optional Shading dictionary /Background color in DeviceRGB components. */
  background?: [number, number, number]
  /** Optional Shading dictionary /BBox in shading coordinate space. */
  bbox?: [number, number, number, number]
  /** Optional Shading dictionary /AntiAlias hint. */
  antiAlias?: boolean
  /** PDF painting operator: PatternType 2 by default, or direct `sh` under the current clip. */
  paintOperator?: 'pattern' | 'sh'
  /** PostScript calculator body (FunctionType 4), e.g. '{ 2 copy add 2 div }' — takes x y, leaves r g b */
  expression: string
}

export interface SampledFunctionShadingDef {
  type: 'functionShading'
  /** [x0, x1, y0, y1] input domain */
  domain: [number, number, number, number]
  /** Domain -> element-local pt mapping (default identity) */
  matrix?: [number, number, number, number, number, number]
  /** Optional Shading dictionary /Background color in DeviceRGB components. */
  background?: [number, number, number]
  /** Optional Shading dictionary /BBox in shading coordinate space. */
  bbox?: [number, number, number, number]
  /** Optional Shading dictionary /AntiAlias hint. */
  antiAlias?: boolean
  /** PDF painting operator: PatternType 2 by default, or direct `sh` under the current clip. */
  paintOperator?: 'pattern' | 'sh'
  /** Sampled FunctionType 0 data. */
  sampled: SampledFunctionDef
}

/** Serializable PDF function used by process/spot color models. */
export type PdfFunctionDef =
  | {
      functionType: 0
      domain: number[]
      range: number[]
      size: number[]
      bitsPerSample: 1 | 2 | 4 | 8 | 12 | 16 | 24 | 32
      order: 1 | 3
      encode: number[]
      decode: number[]
      data: Uint8Array
    }
  | {
      functionType: 2
      domain: [number, number]
      range?: number[]
      c0: number[]
      c1: number[]
      exponent: number
    }
  | {
      functionType: 3
      domain: [number, number]
      range?: number[]
      functions: PdfFunctionDef[]
      bounds: number[]
      encode: number[]
    }
  | {
      functionType: 4
      domain: number[]
      range: number[]
      expression: string
    }

export type PdfProcessColorSpaceDef =
  | { kind: 'gray' }
  | { kind: 'rgb' }
  | { kind: 'cmyk' }
  | { kind: 'calgray'; whitePoint: [number, number, number]; blackPoint: [number, number, number]; gamma: number }
  | { kind: 'calrgb'; whitePoint: [number, number, number]; blackPoint: [number, number, number]; gamma: [number, number, number]; matrix: [number, number, number, number, number, number, number, number, number] }
  | { kind: 'lab'; whitePoint: [number, number, number]; blackPoint: [number, number, number]; range: [number, number, number, number] }
  | { kind: 'icc'; components: 1 | 3 | 4; range: number[]; profile: Uint8Array }

export interface PdfSeparationColorSpaceDef {
  kind: 'separation'
  name: string
  alternate: PdfProcessColorSpaceDef
  tintTransform: PdfFunctionDef
}

export interface PdfDeviceNProcessDef {
  colorSpace: PdfProcessColorSpaceDef
  components: string[]
}

export interface PdfDeviceNMixingHintsDef {
  solidities: Record<string, number>
  printingOrder: string[]
  dotGain: Record<string, PdfFunctionDef>
}

export interface PdfDeviceNColorSpaceDef {
  kind: 'deviceN'
  names: string[]
  alternate: PdfProcessColorSpaceDef
  tintTransform: PdfFunctionDef
  subtype: 'DeviceN' | 'NChannel'
  colorants: Record<string, PdfSeparationColorSpaceDef>
  process?: PdfDeviceNProcessDef
  mixingHints?: PdfDeviceNMixingHintsDef
}

export interface PdfIndexedColorSpaceDef {
  kind: 'indexed'
  base: PdfProcessColorSpaceDef | PdfSeparationColorSpaceDef | PdfDeviceNColorSpaceDef
  high: number
  lookup: Uint8Array
}

export type PdfShadingColorSpaceDef =
  | PdfProcessColorSpaceDef
  | PdfSeparationColorSpaceDef
  | PdfDeviceNColorSpaceDef
  | PdfIndexedColorSpaceDef

/** A Separation/DeviceN value with an independently computed display color. */
export interface PdfSpecialColorDef {
  type: 'pdfSpecialColor'
  colorSpace: PdfSeparationColorSpaceDef | PdfDeviceNColorSpaceDef
  components: number[]
  displayColor: string
}

export type FillDef = string | PdfSpecialColorDef | GradientDef | MeshGradientDef | TilingPatternDef | FunctionShadingDef
export type BlendModeDef =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
export type OverprintModeDef = 0 | 1

/** PDF color rendering intent (ExtGState /RI). */
export type RenderingIntentDef = 'AbsoluteColorimetric' | 'RelativeColorimetric' | 'Saturation' | 'Perceptual'

export interface OptionalContentDef {
  /** Optional content group name shown by PDF viewers. */
  name: string
  /** Initial view state. Default is true. */
  visible?: boolean
  /** Initial print state. Default is visible. */
  print?: boolean
  /** Original OCG or OCMD semantics retained from a PDF source. */
  membership?: PdfOptionalContentGroupDef | PdfOptionalContentMembershipDef
  /** Catalog-level optional-content configurations shared by this membership. */
  properties?: PdfOptionalContentPropertiesDef
}

export interface PdfOptionalContentGroupDef {
  kind: 'group'
  id: string
  name: string
  intents: string[]
  usage?: Record<string, PdfRawValueDef>
}

export interface PdfOptionalContentMembershipDef {
  kind: 'membership'
  groups: PdfOptionalContentGroupDef[]
  policy: 'AllOn' | 'AnyOn' | 'AnyOff' | 'AllOff'
  expression?: PdfOptionalContentExpressionDef
}

export interface PdfOptionalContentExpressionDef {
  operator: 'And' | 'Or' | 'Not'
  operands: Array<PdfOptionalContentGroupDef | PdfOptionalContentExpressionDef>
}

export interface PdfOptionalContentPropertiesDef {
  groups: PdfOptionalContentGroupDef[]
  defaultConfiguration: PdfOptionalContentConfigurationDef
  configurations: PdfOptionalContentConfigurationDef[]
}

export interface PdfOptionalContentConfigurationDef {
  name?: string
  creator?: string
  baseState: 'ON' | 'OFF' | 'Unchanged'
  on: string[]
  off: string[]
  intents: string[] | 'All'
  applications: PdfOptionalContentUsageApplicationDef[]
  order: PdfOptionalContentOrderDef[]
  listMode: 'AllPages' | 'VisiblePages'
  radioButtonGroups: string[][]
  locked: string[]
}

export interface PdfOptionalContentUsageApplicationDef {
  event: 'View' | 'Print' | 'Export'
  groupIds: string[]
  categories: Array<'CreatorInfo' | 'Language' | 'Export' | 'Zoom' | 'Print' | 'View' | 'User' | 'PageElement'>
}

export type PdfOptionalContentOrderDef =
  | { kind: 'group', groupId: string }
  | { kind: 'branch', label?: string, children: PdfOptionalContentOrderDef[] }

export type ElementDef =
  | FormFieldDef
  | StaticTextDef
  | TextFieldDef
  | LineDef
  | RectangleDef
  | EllipseDef
  | PathDef
  | ImageDef
  | FrameDef
  | SubreportDef
  | BreakDef
  | BarcodeDef
  | MathDef
  | SvgElementDef
  | TableElementDef
  | CrosstabElementDef

/**
 * Callback invoked just before element rendering (conditional rendering + dynamic attribute override).
 *
 * - Returning null skips rendering the element (superset of printWhenExpression)
 * - Returning an ElementDef renders with that definition (dynamic override of any
 *   attribute: text, width/height, image source, barcode data, colors, etc.)
 * - Evaluation order: onBeforeRender → printWhenExpression (evaluated against the overridden definition) → conditionalStyles
 *
 * Signature design: the existing code has no aggregate type like ExpressionContext;
 * expression evaluation is unified on the ExpressionCallback argument form (field, vars, param, report).
 * onBeforeRender therefore adopts the same form, with the target element elem prepended.
 * Templates are defined in TypeScript, so the function is held directly (no JSON serialization needed).
 */
export type OnBeforeRenderCallback = (
  elem: ElementDef,
  field: Record<string, unknown>,
  vars: Record<string, unknown>,
  param: Record<string, unknown>,
  report: ReportContext,
) => ElementDef | null

/** Properties common to all elements. All coordinates and dimensions are in pt. */
export interface ElementBase {
  /** Stable identifier used to locate and modify this element before layout. */
  id?: string
  /** X coordinate within the parent band/container (pt) */
  x: number
  /** Y coordinate within the parent band/container (pt) */
  y: number
  /** Width (pt) */
  width: number
  /** Height (pt) */
  height: number
  style?: string
  positionType?: 'float' | 'fixRelativeToTop' | 'fixRelativeToBottom'
  stretchType?: 'noStretch' | 'containerHeight' | 'containerBottom'
  printWhenExpression?: Expression | null
  /** Callback just before rendering. Return null to skip rendering, or an ElementDef to override attributes. */
  onBeforeRender?: OnBeforeRenderCallback
  isRemoveLineWhenBlank?: boolean
  isPrintRepeatedValues?: boolean
  /** Reprints this element on each page/column the band overflows onto. */
  isPrintWhenDetailOverflows?: boolean
  mode?: 'opaque' | 'transparent'
  forecolor?: string
  backcolor?: string
  border?: BorderDef
  padding?: Padding
  /** Blend mode used while drawing this element */
  blendMode?: BlendModeDef
  /** Nonstroking overprint flag used while drawing this element */
  overprintFill?: boolean
  /** Stroking overprint flag used while drawing this element */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintModeDef
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntentDef
  /** Interpret alpha constants and soft masks as shape values (PDF /AIS). */
  alphaIsShape?: boolean
  /** Treat glyphs in a text object as a knockout unit (PDF /TK). Default true. */
  textKnockout?: boolean
  /** PDF optional content group (layer) for this element and its decoration. */
  optionalContent?: OptionalContentDef
  /** Element opacity (0.0-1.0), applied as a group when the element has children. */
  opacity?: number
}

// ─── Hyperlinks ───

export interface HyperlinkDef {
  /** Link type */
  type: 'reference' | 'localAnchor' | 'localPage' | 'remoteAnchor' | 'remotePage'
  /** Link target (URL, anchor name, or page number expression) */
  target: Expression
  /** Remote PDF file path (for remotePage/remoteAnchor) */
  remoteDocument?: Expression
}

/** Tab stop definition */
export interface TabStopDef {
  /** Tab position (pt) */
  position: number
  /** Tab alignment (default: left) */
  alignment?: 'left' | 'center' | 'right'
}

/** Paragraph properties common to text elements */
interface TextProperties {
  /**
   * Markup type (per common report behavior).
   * styled: styled text (<style forecolor=... isBold=...>, <b>/<i>/<u>, etc.)
   * html: HTML subset (<b>/<i>/<u>/<s>/<font>/<br>/<sup>/<sub>)
   */
  markup?: 'none' | 'styled' | 'html'
  hAlign?: 'left' | 'center' | 'right' | 'justify'
  vAlign?: 'top' | 'middle' | 'bottom'
  /** Text rotation (degrees: 0, 90, 180, 270) */
  rotation?: 0 | 90 | 180 | 270
  /** Line spacing settings */
  lineSpacing?: LineSpacingDef
  /** Letter spacing (pt) */
  letterSpacing?: number
  /** AAT trak track value for font-provided size-dependent tracking */
  tracking?: number
  /** Word spacing (pt, extra width for space characters) */
  wordSpacing?: number
  /** Horizontal text scale multiplier. Default is 1. */
  horizontalScale?: number
  /** Explicit baseline offset from the element top. PDF import uses this to preserve the source text matrix. */
  baselineOffset?: number
  /** First line indent (pt) */
  firstLineIndent?: number
  /** Left indent (pt) */
  leftIndent?: number
  /** Right indent (pt) */
  rightIndent?: number
  /** Padding */
  padding?: Padding
  /** Text direction */
  direction?: 'ltr' | 'rtl' | 'auto'
  /** OpenType script tag used for shaping. */
  openTypeScript?: string
  /** OpenType language-system tag used for shaping. */
  openTypeLanguage?: string
  /** Global OpenType feature values; zero disables and type 3 uses one-based alternate indices. */
  openTypeFeatures?: Record<string, number>
  /** Auto-shrink text: reduce font size to fit within element width/height */
  shrinkToFit?: boolean
  /** Minimum font size when shrinkToFit is set (pt, default: 4) */
  minFontSize?: number
  /** Dynamically fit element width to text width */
  fitWidth?: boolean
  /** Whether to outline text (convert to paths) (default: false) */
  outlineText?: boolean
  /** PDF font program handling. `reference` emits a non-embedded system-font reference. */
  pdfFontMode?: 'embedded' | 'reference'
  /** PDF text paint semantics preserved on import. Defaults to fill. */
  textPaintMode?: 'fill' | 'stroke' | 'fillStroke'
  /** Stroking colour for stroke/fillStroke text. */
  textStrokeColor?: string
  /** Text outline width in points. */
  textStrokeWidth?: number
  /** Tab stop definitions */
  tabStops?: TabStopDef[]
  /** Default tab interval (pt). 40pt when unspecified */
  tabStopWidth?: number
  /** Text wrapping (default: true — undefined means wrapping enabled) */
  wrap?: boolean
}

export interface LineSpacingDef {
  type: 'single' | '1.5' | 'double' | 'proportional' | 'fixed' | 'minimum'
  /** Value for fixed/minimum/proportional */
  value?: number
}

/** Field type of a form field. Maps to the PDF /FT + flags. */
export type FormFieldType =
  | 'text'        // /Tx
  | 'checkbox'    // /Btn checkbox
  | 'radio'       // /Btn radio (widgets grouped by fieldName)
  | 'pushbutton'  // /Btn pushbutton (caption + optional URI action)
  | 'dropdown'    // /Ch combo box
  | 'listbox'     // /Ch list box
  | 'signature'   // /Sig

/** One choice in a dropdown/listbox field. */
export interface FormFieldOption {
  /** Export value stored in the field's /V */
  value: string
  /** Display label (defaults to `value`) */
  label?: string
}

/**
 * Interactive form field (PDF AcroForm widget). The preview backends draw
 * the initial appearance; the PDF backend emits a real /AcroForm field so
 * the produced document is fillable. Covers every PDF field type: text,
 * checkbox, radio, pushbutton, dropdown (combo), listbox and signature.
 */
export interface FormFieldDef extends ElementBase, TextProperties {
  type: 'formField'
  fieldType: FormFieldType
  /**
   * Fully qualified field name. Unique per document, except radio buttons
   * that share a name form one exclusive group.
   */
  fieldName: string
  /** Initial value (text/dropdown/listbox: selected value; expression-evaluated) */
  value?: Expression
  /** Initial checked state (checkbox/radio; expression-evaluated) */
  checked?: Expression
  /** On-state export value (checkbox/radio; default 'Yes'). Distinguishes radio buttons in a group. */
  exportValue?: string
  /** Choices (dropdown/listbox) */
  options?: FormFieldOption[]
  /** Allow free text entry in addition to the choices (dropdown → combo) */
  editable?: boolean
  /** Allow selecting multiple options (listbox) */
  multiSelect?: boolean
  /** Button caption (pushbutton) */
  caption?: string
  /** URI opened when the pushbutton is activated */
  action?: string
  multiline?: boolean
  readOnly?: boolean
  required?: boolean
  noExport?: boolean
  password?: boolean
  fileSelect?: boolean
  doNotSpellCheck?: boolean
  doNotScroll?: boolean
  comb?: boolean
  richText?: string
  richTextStream?: Uint8Array
  defaultStyle?: string
  valueStream?: Uint8Array
  defaultValue?: string
  sort?: boolean
  commitOnSelectionChange?: boolean
  radiosInUnison?: boolean
  /** Field /AA actions (K/F/V/C). Core preserves JavaScript but does not execute it. */
  additionalActions?: Partial<Record<'K' | 'F' | 'V' | 'C', PdfActionDef>>
  calculationOrder?: number
  maxLength?: number
  /** Border color (#RRGGBB; omit for no border) */
  borderColor?: string
  /** Background color (#RRGGBB; omit for transparent) */
  backgroundColor?: string
}

export interface StaticTextDef extends ElementBase, TextProperties {
  type: 'staticText'
  text: string
  /** Replacement text from a PDF marked-content /ActualText property. */
  actualText?: string
  /** Hyperlink */
  hyperlink?: HyperlinkDef
  /** Anchor name (destination for bookmarks/local links) */
  anchorName?: string
  /** Bookmark hierarchy level (1-6, used for the PDF outline) */
  bookmarkLevel?: number
}

export interface TextFieldDef extends ElementBase, TextProperties {
  type: 'textField'
  expression: Expression
  pattern?: string
  blankWhenNull?: boolean
  stretchWithOverflow?: boolean
  evaluationTime?: 'now' | 'band' | 'column' | 'page' | 'group' | 'report' | 'auto'
  evaluationGroup?: string
  textTruncate?: 'none' | 'truncate' | 'ellipsisChar' | 'ellipsisWord'
  /** Hyperlink */
  hyperlink?: HyperlinkDef
  /** Anchor name (destination for bookmarks/local links) */
  anchorName?: string
  /** Bookmark hierarchy level (1-6, used for the PDF outline) */
  bookmarkLevel?: number
}

export interface LineDef extends ElementBase {
  type: 'line'
  /** Line width (pt) */
  lineWidth?: number
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  lineColor?: string
}

export interface RectangleDef extends ElementBase {
  type: 'rectangle'
  /** Corner radius in pt. */
  radius?: number
  /** Per-corner radius in pt. */
  cornerRadii?: {
    topLeft?: number
    topRight?: number
    bottomRight?: number
    bottomLeft?: number
  }
  fill?: FillDef
  stroke?: string
  /** Stroke width (pt) */
  strokeWidth?: number
}

export interface EllipseDef extends ElementBase {
  type: 'ellipse'
  fill?: FillDef
  stroke?: string
  /** Stroke width (pt) */
  strokeWidth?: number
}

export interface PathDef extends ElementBase {
  type: 'path'
  d: string
  /** Compact shared vector definitions retained from an immutable PDF paint run. */
  pdfSourceVector?: PdfSourceVectorDef
  /** Maps path coordinates into element-local coordinates before painting. */
  affineTransform?: [number, number, number, number, number, number]
  viewBox?: [number, number, number, number]
  fill?: FillDef
  fillRule?: 'nonzero' | 'evenodd'
  fillOpacity?: number
  stroke?: FillDef
  strokeWidth?: number
  strokeOpacity?: number
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDasharray?: number[]
  strokeDashoffset?: number
}

/** One reusable vector definition in the coordinate space of its source program. */
export interface PdfSourceVectorDefinitionDef {
  commands: number[]
  coords: number[]
}

/** One placement of a reusable source vector definition. */
export interface PdfSourceVectorInstanceDef {
  definitionIndex: number
  matrix: [number, number, number, number, number, number]
}

/**
 * Immutable source-backed vector run. Definitions are stored once and placed
 * by affine instances; editors materialize them into ordinary paths only on
 * an explicit unlock operation.
 */
export interface PdfSourceVectorDef {
  definitions: PdfSourceVectorDefinitionDef[]
  instances: PdfSourceVectorInstanceDef[]
}

export interface ImageDef extends ElementBase {
  type: 'image'
  /* Staticimage (images) */
  
  source?: string
  /* Dynamicimageexpression (result: string | Uint8Array | data URI) */
  
  sourceExpression?: Expression
  scaleMode?: 'clip' | 'fillFrame' | 'retainShape' | 'realSize'
  hAlign?: 'left' | 'center' | 'right'
  vAlign?: 'top' | 'middle' | 'bottom'
  onError?: 'error' | 'blank' | 'icon'
  lazy?: boolean
  rotation?: 0 | 90 | 180 | 270
  /** Unit-square image affine matrix in renderer coordinates */
  affineTransform?: [number, number, number, number, number, number]
  opacity?: number
  /** PDF image /Interpolate sampling preference. */
  interpolate?: boolean
  /** PDF alternate image variants. */
  alternates?: PdfImageAlternateDef[]
  /** Open Prepress Interface 1.3/2.0 proxy metadata. */
  opi?: PdfOpiMetadataDef
  /** Image XObject /Measure dictionary. */
  measure?: PdfMeasurement
  /** Image XObject /PtData dictionary or array. */
  pointData?: PdfPointData[]
  /** Hyperlink */
  hyperlink?: HyperlinkDef
}

export interface PdfImageAlternateDef {
  source: string
  defaultForPrinting?: boolean
}

/** Serializable PDF object value for metadata dictionaries that must round trip losslessly. */
export type PdfRawValueDef =
  | null | boolean | number
  | { kind: 'name', value: string }
  | { kind: 'string', bytes: Uint8Array }
  | { kind: 'array', items: PdfRawValueDef[] }
  | { kind: 'dictionary', entries: Record<string, PdfRawValueDef> }
  | { kind: 'stream', entries: Record<string, PdfRawValueDef>, data: Uint8Array }

/** Every standard action subtype defined by ISO 32000-2. */
export type PdfActionSubtypeDef =
  | 'GoTo' | 'GoToR' | 'GoToE' | 'GoToDp' | 'Launch' | 'Thread' | 'URI'
  | 'Sound' | 'Movie' | 'Hide' | 'Named' | 'SubmitForm' | 'ResetForm'
  | 'ImportData' | 'JavaScript' | 'SetOCGState' | 'Rendition' | 'Trans'
  | 'GoTo3DView' | 'RichMediaExecute'

/** Explicit-destination fit names defined by ISO 32000-2, table 149. */
export type PdfDestinationFitDef =
  | 'XYZ' | 'Fit' | 'FitH' | 'FitV' | 'FitR' | 'FitB' | 'FitBH' | 'FitBV'

/**
 * PDF destination retained independently of source object numbers. Explicit
 * destination coordinates are the native PDF values so import and re-output
 * are byte-semantically stable even when the target page is rotated or scaled.
 */
export type PdfDestinationDef =
  | { kind: 'named', name: string, representation: 'name' | 'string' }
  | {
    kind: 'explicit'
    page: { kind: 'local', pageIndex: number } | { kind: 'remote', pageNumber: number }
    fit: PdfDestinationFitDef
    parameters: (number | null)[]
  }

/** PDF 2.0 structure destination used by GoTo and GoToR /SD. */
export interface PdfStructureDestinationDef {
  target:
    | { kind: 'local', structureElementIndex: number }
    | { kind: 'remote', structureElementId: Uint8Array }
  fit: PdfDestinationFitDef
  parameters: (number | null)[]
}

export interface PdfActionAnnotationTargetDef {
  /** /AN for Rendition, /TA for GoTo3DView and RichMediaExecute. */
  entry: 'AN' | 'TA' | 'Annotation'
  /** Index in PdfBackendOptions.annotations, or imported page-order annotation index. */
  annotationIndex: number
}

export type PdfOptionalContentStateDef =
  | { kind: 'operator', value: 'ON' | 'OFF' | 'Toggle' }
  | { kind: 'group', groupId: string }

export type PdfEmbeddedTargetSelectorDef = number | { kind: 'string', bytes: Uint8Array }

/** Recursive target path used by an embedded GoTo action. */
export interface PdfEmbeddedTargetDef {
  relationship: 'C' | 'P'
  name?: Uint8Array
  page?: PdfEmbeddedTargetSelectorDef
  annotation?: PdfEmbeddedTargetSelectorDef
  target?: PdfEmbeddedTargetDef
}

export interface PdfWindowsLaunchParametersDef {
  file: Uint8Array
  defaultDirectory?: Uint8Array
  operation?: Uint8Array
  parameters?: Uint8Array
}

export interface PdfLaunchPlatformParametersDef {
  windows?: PdfWindowsLaunchParametersDef
  mac?: Record<string, PdfRawValueDef>
  unix?: Record<string, PdfRawValueDef>
}

export interface PdfActionFieldTargetsDef {
  entry: 'T' | 'Fields'
  names: string[]
  scalar: boolean
}

export interface PdfArticleActionTargetDef {
  threadIndex: number
  beadIndex?: number
}

/**
 * Viewer-bound PDF action. The subtype-specific dictionary entries are kept as
 * PDF values; Next preserves whether the source used one action or an array.
 * Actions are serialized and imported but never executed by the core engine.
 */
export interface PdfActionDef {
  subtype: PdfActionSubtypeDef
  entries: Record<string, PdfRawValueDef>
  /** /D for GoTo, GoToR, and GoToE, with page references made semantic. */
  destination?: PdfDestinationDef
  /** PDF 2.0 /SD, with a local StructElem or remote structure ID made semantic. */
  structureDestination?: PdfStructureDestinationDef
  /** Annotation identity used by Rendition, GoTo3DView, and RichMediaExecute. */
  annotationTarget?: PdfActionAnnotationTargetDef
  /** /State sequence for SetOCGState, with OCG identity made semantic. */
  optionalContentState?: PdfOptionalContentStateDef[]
  /** /Dp for GoToDp: documentParts index, or documentPartHierarchy depth-first descendant index. */
  documentPartIndex?: number
  /** /T recursive embedded-file target for GoToE. */
  embeddedTarget?: PdfEmbeddedTargetDef
  /** Platform dictionaries for Launch; retained but never executed. */
  launchParameters?: PdfLaunchPlatformParametersDef
  /** Optional /TI RichMediaInstance index within the targeted annotation. */
  richMediaInstanceIndex?: number
  /** Hide/SubmitForm/ResetForm field selection, canonicalized to field names. */
  fieldTargets?: PdfActionFieldTargetsDef
  /** Thread/bead identity for Thread actions. */
  articleTarget?: PdfArticleActionTargetDef
  next?: PdfActionDef | PdfActionDef[]
}

/** Page presentation transition (ISO 32000 transition dictionary). */
export interface PdfPageTransitionDef {
  style?: 'Split' | 'Blinds' | 'Box' | 'Wipe' | 'Dissolve' | 'Glitter' | 'R' | 'Fly' | 'Push' | 'Cover' | 'Uncover' | 'Fade'
  duration?: number
  dimension?: 'H' | 'V'
  motion?: 'I' | 'O'
  direction?: number | 'None'
  scale?: number
  rectangular?: boolean
}

export interface PdfOpiMetadataDef {
  version: '1.3' | '2.0'
  entries: Record<string, PdfRawValueDef>
}

/** PDF Form XObject dictionary entries that must survive import and re-output. */
export interface PdfFormXObjectDef {
  bbox: [number, number, number, number]
  matrix: [number, number, number, number, number, number]
  /** CTM in effect immediately before the Form /Matrix is concatenated. */
  invocationMatrix: [number, number, number, number, number, number]
  formType?: 1
  group?: Record<string, PdfRawValueDef>
  reference?: Record<string, PdfRawValueDef>
  metadata?: Extract<PdfRawValueDef, { kind: 'stream' }>
  pieceInfo?: Record<string, PdfRawValueDef>
  lastModified?: PdfRawValueDef
  structParent?: number
  structParents?: number
  opi?: PdfOpiMetadataDef
  name?: string
  /** Form /Measure dictionary connected to the shared coordinate model. */
  measure?: PdfMeasurement
  /** Form /PtData dictionary or array connected to geospatial point data. */
  pointData?: PdfPointData[]
}

export interface FrameDef extends ElementBase {
  type: 'frame'
  /** Whether the frame clips its children to its bounds. Default true. */
  clip?: boolean
  border?: BorderDef
  padding?: Padding
  /** Frame rotation angle in degrees (counter-clockwise in page coordinates). */
  rotation?: number
  /** Rotation origin X relative to the frame, pt. Default is 0. */
  rotationOriginX?: number
  /** Rotation origin Y relative to the frame, pt. Default is 0. */
  rotationOriginY?: number
  /** Maps frame-local top-down coordinates into its parent coordinate space. */
  affineTransform?: [number, number, number, number, number, number]
  /** Original PDF Form XObject boundary and dictionary metadata. */
  pdfForm?: PdfFormXObjectDef
  /** Hyperlink */
  hyperlink?: HyperlinkDef
  clipPath?: {
    d: string
    fillRule?: 'nonzero' | 'evenodd'
  }
  /** Preserves a PDF transparency-group boundary when isolation and knockout are both disabled. */
  transparencyGroup?: boolean
  /**
   * Isolated transparency group (PDF /Group /I). When set (or when `knockout`
   * or `softMask` is set) the frame composites as a unit before its opacity /
   * blend / mask is applied.
   */
  isolated?: boolean
  /** Knockout transparency group (PDF /Group /K). */
  knockout?: boolean
  /** Soft mask applied while compositing this frame (PDF ExtGState /SMask). */
  softMask?: FrameSoftMaskDef
  /** Device print-production parameters (PDF ExtGState /TR /BG /UCR /HT). */
  deviceParams?: DeviceParamsDef
  elements?: ElementDef[]
}

/** A PostScript calculator function (FunctionType 4), e.g. '{ 1 exch sub }'. */
export interface CalculatorFunctionDef {
  expression: string
}

export type TransferFunctionDef = CalculatorFunctionDef | PdfFunctionDef

/** A type-1 halftone screen (PDF /HT). */
/** Type-1 spot-function halftone screen. */
export interface HalftoneScreenDef {
  type?: 1
  frequency: number
  angle: number
  /** A predefined spot-function name (e.g. 'Round'), or a calculator function
   *  taking (x, y) in [-1, 1] to a value in [-1, 1]. */
  spotFunction: string | CalculatorFunctionDef
  /** Requests the high-precision screen construction algorithm. */
  accurateScreens?: boolean
  /** Optional /TransferFunction applied during halftoning: 'Identity' or a function. */
  transferFunction?: 'Identity' | TransferFunctionDef
}

/** Type-6 threshold-array halftone (Width×Height bytes). */
export interface HalftoneThresholdDef {
  type: 6
  width: number
  height: number
  /** Width×Height threshold bytes (0-255), row-major. */
  thresholds: number[]
  /** Optional /TransferFunction applied during halftoning: 'Identity' or a function. */
  transferFunction?: 'Identity' | TransferFunctionDef
}

/** Type-10 angled threshold halftone (Xsquare/Ysquare cells). */
export interface HalftoneAngledDef {
  type: 10
  xsquare: number
  ysquare: number
  /** (Xsquare²+Ysquare²) threshold bytes (0-255). */
  thresholds: number[]
  /** Optional /TransferFunction applied during halftoning: 'Identity' or a function. */
  transferFunction?: 'Identity' | TransferFunctionDef
}

/** Type-16 threshold halftone with 16-bit thresholds and optional second rectangle. */
export interface HalftoneThreshold16Def {
  type: 16
  width: number
  height: number
  width2?: number
  height2?: number
  /** 16-bit threshold values (Width×Height, plus Width2×Height2 when present). */
  thresholds: number[]
  /** Optional /TransferFunction applied during halftoning: 'Identity' or a function. */
  transferFunction?: 'Identity' | TransferFunctionDef
}

/** Type-5 halftone: a per-colorant collection (Cyan/Magenta/.../Default). */
export interface HalftoneCollectionDef {
  type: 5
  halftones: Array<{ colorant: string, halftone: HalftoneScreenDef | HalftoneThresholdDef | HalftoneAngledDef | HalftoneThreshold16Def }>
}

export type HalftoneDef =
  | HalftoneScreenDef | HalftoneThresholdDef | HalftoneAngledDef | HalftoneThreshold16Def | HalftoneCollectionDef

/**
 * Device print-production graphics-state parameters (PDF ExtGState /TR /BG
 * /UCR /HT). These affect device color separation, not the on-screen page.
 */
export interface DeviceParamsDef {
  /**
   * /TR transfer function: 'Identity', 'Default', a single calculator function
   * applied to every colorant, or an array of four per-colorant functions.
   */
  transferFunction?: 'Identity' | 'Default' | TransferFunctionDef | TransferFunctionDef[]
  /** /BG black-generation function, or 'Default' (from /BG2) for the device default. */
  blackGeneration?: 'Default' | CalculatorFunctionDef
  /** /UCR undercolor-removal function, or 'Default' (from /UCR2) for the device default. */
  undercolorRemoval?: 'Default' | CalculatorFunctionDef
  /** /HT halftone: 'Default' or a type-1 halftone screen. */
  halftone?: 'Default' | HalftoneDef
  /** PDF 2.0 halftone origin (/HTO) in device-space pixels. */
  halftoneOrigin?: [number, number]
  /** PDF 2.0 black-point compensation control (/UseBlackPtComp). */
  useBlackPointCompensation?: 'on' | 'off' | 'default'
  flatness?: number
  smoothness?: number
  strokeAdjustment?: boolean
}

/**
 * Soft mask for a frame (PDF ExtGState /SMask). The mask is defined by
 * compositing `elements` as a transparency group; its per-pixel luminosity or
 * alpha becomes the mask applied to the frame.
 */
export interface FrameSoftMaskDef {
  type: 'luminosity' | 'alpha'
  /** Blending color space of the soft-mask transparency group. */
  colorSpace?: PdfProcessColorSpaceDef
  /** Isolation flag of the soft-mask transparency group. */
  isolated?: boolean
  /** Knockout flag of the soft-mask transparency group. */
  knockout?: boolean
  /** /BC backdrop color (DeviceRGB 0-1) for a luminosity mask. Default black. */
  backdrop?: [number, number, number]
  elements: ElementDef[]
  /** Optional /SMask /TR transfer function remapping the mask value (0..1). */
  transferFunction?: 'Identity' | TransferFunctionDef
}

export interface SubreportDef extends ElementBase {
  type: 'subreport'
  templateExpression: Expression
  dataSourceExpression?: Expression
  parameters?: SubreportParamDef[]
  /** Expression yielding an object whose entries are merged into the child parameters (individual `parameters` win). */
  parametersMapExpression?: Expression
  returnValues?: ReturnValueDef[]
  /** Caches the resolved child template per template name within the parent report run. */
  usingCache?: boolean
  /** Consumes the remaining space of the page/column after the subreport content. */
  runToBottom?: boolean
}

export interface SubreportParamDef {
  name: string
  expression: Expression
}

export interface ReturnValueDef {
  name: string
  subreportVariable: string
  calculation: 'nothing' | 'count' | 'sum' | 'average' | 'min' | 'max' | 'first'
}

export interface BreakDef extends ElementBase {
  type: 'break'
  breakType: 'page' | 'column'
}

export interface BarcodeDef extends ElementBase {
  type: 'barcode'
  barcodeType: string
  expression: Expression
  showText?: boolean
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
}

export interface MathDef extends ElementBase {
  type: 'math'
  /** LaTeX expression string, or an expression that resolves it dynamically. */
  formula: Expression
  /* Expressionfont (fontMap) */
  
  mathFontFamily?: string
  /** Font size (pt) */
  fontSize?: number
  /* Charactercolor. */
  
  color?: string
}

export interface SvgElementDef extends ElementBase {
  type: 'svg'
  svgContent: Expression
}

export interface TableElementDef extends ElementBase {
  type: 'table'
  columns: TableColumnElementDef[]
  headerRows?: TableRowElementDef[]
  detailRows?: TableRowElementDef[]
  footerRows?: TableRowElementDef[]
  
  dataSourceExpression?: Expression
}

export interface TableColumnElementDef {
  width: number
  style?: TableCellStyleDef
}

export interface TableRowElementDef {
  height: number
  cells: TableCellElementDef[]
}

export interface TableCellStyleDef {
  hAlign?: 'left' | 'center' | 'right'
  vAlign?: 'top' | 'middle' | 'bottom'
  rotation?: 0 | 90 | 180 | 270
  backcolor?: string
  forecolor?: string
  fontId?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  lineSpacing?: LineSpacingDef
  letterSpacing?: number
  wordSpacing?: number
  firstLineIndent?: number
  leftIndent?: number
  rightIndent?: number
  wrap?: boolean
  shrinkToFit?: boolean
  minFontSize?: number
  fitWidth?: boolean
  outlineText?: boolean
  padding?: number
  border?: BorderDef
  opacity?: number
}

export interface TableCellElementDef extends TableCellStyleDef {
  text?: string
  expression?: Expression
  colSpan?: number
  rowSpan?: number
  /* Cell placechildelement (layout) */
  
  elements?: ElementDef[]
}

export interface CrosstabElementDef extends ElementBase {
  type: 'crosstab'
  /* Rowgroup. */
  
  rowGroups: { field: string; headerFormat?: string }[]
  /* Columngroup. */
  
  columnGroups: { field: string; headerFormat?: string }[]
  /* Cell. */
  
  measures: { field: string; calculation: 'sum' | 'count' | 'average' | 'min' | 'max'; format?: string }[]
  /* Rowheaderwidth (pt) */
  
  rowHeaderWidth?: number
  /* Columnheaderheight (pt) */
  
  columnHeaderHeight?: number
  /* Datacellwidth (pt) */
  
  cellWidth?: number
  /* Datacellheight (pt) */
  
  cellHeight?: number
  /* Border. */
  
  border?: { color?: string; width?: number }
  /* Subtotal display. */
  
  showSubtotals?: boolean
  /* Total display. */
  
  showGrandTotal?: boolean
  /* Data sourceexpression (timedata source for) */
  
  dataSourceExpression?: Expression
}

// Data source.


export interface DataSource {
  rows: Record<string, unknown>[]
  parameters?: Record<string, unknown>
  resources?: Record<string, Record<string, string>>
}
