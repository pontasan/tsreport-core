/**
 * Render tree (composite tree of drawing instructions)
 *
 * Output of the layout engine, input to the renderer.
 * RenderGroup is the composite node (the only node type with children).
 * All other nodes are leaf nodes.
 * Coordinates are relative to the parent.
 *
 * Units: all coordinates, dimensions, line widths, and font sizes are in pt (1pt = 1/72 inch).
 * pt is used as the unified unit across all layers:
 * template → layout engine → render tree → renderer.
 * For Canvas drawing, the renderer converts pt → screen coordinates via RenderOptions.scale.
 *
 * The renderer only needs to walk the tree recursively
 * and draw each node according to its type.
 */

import type { PaintValue } from '../renderer/backend.js'
import type { OptionalContentDef, PageTransparencyGroupDef, PdfActionDef, PdfFormXObjectDef, PdfOpiMetadataDef, PdfProcessColorSpaceDef, PdfRawValueDef } from './template.js'
import type { PdfMeasurement, PdfPointData } from '../pdf/pdf-measurement.js'

// ─── Structure tags (Tagged PDF / accessibility) ───

export type StructureRole =
  | 'Document' | 'DocumentFragment' | 'Part' | 'Art' | 'Sect' | 'Div' | 'Aside'
  | 'BlockQuote' | 'Caption' | 'TOC' | 'TOCI' | 'Index' | 'NonStruct' | 'Private'
  | 'H' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6'
  | 'P' | 'Title' | 'FENote'
  | 'L' | 'LI' | 'Lbl' | 'LBody'
  | 'Table' | 'TR' | 'TH' | 'TD' | 'THead' | 'TBody' | 'TFoot'
  | 'Span' | 'Sub' | 'Em' | 'Strong' | 'Quote' | 'Note' | 'Reference' | 'BibEntry' | 'Code' | 'Link' | 'Annot'
  | 'Ruby' | 'RB' | 'RT' | 'RP' | 'Warichu' | 'WT' | 'WP'
  | 'Figure' | 'Formula' | 'Form'
  | 'Artifact'

export type StructurePlacement = 'block' | 'inline' | 'before' | 'start' | 'end'
export type StructureWritingMode = 'lr-tb' | 'rl-tb' | 'tb-rl'
export type StructureTextAlign = 'start' | 'center' | 'end' | 'justify'
export type StructureBlockAlign = 'before' | 'middle' | 'after' | 'justify'
export type StructureInlineAlign = 'start' | 'center' | 'end'
export type StructureListNumbering =
  | 'none'
  | 'disc'
  | 'circle'
  | 'square'
  | 'decimal'
  | 'upper-roman'
  | 'lower-roman'
  | 'upper-alpha'
  | 'lower-alpha'

export type StructurePhoneticAlphabet = 'ipa' | 'x-sampa' | 'zh-Latn-pinyin' | 'zh-Latn-wadegile'

export interface StructureLayoutAttributes {
  placement?: StructurePlacement
  writingMode?: StructureWritingMode
  bbox?: [number, number, number, number]
  width?: number | 'auto'
  height?: number | 'auto'
  startIndent?: number
  endIndent?: number
  textIndent?: number
  spaceBefore?: number
  spaceAfter?: number
  textAlign?: StructureTextAlign
  blockAlign?: StructureBlockAlign
  inlineAlign?: StructureInlineAlign
}

/** Semantic MathML tree embedded below a Formula structure element. */
export interface MathMlStructureNode {
  name: string
  text?: string
  attributes?: Record<string, string>
  children?: MathMlStructureNode[]
}

export type StructureAttributeOwner =
  | 'ARIA-1.1' | 'Artifact' | 'CSS-1' | 'CSS-2' | 'CSS-3'
  | 'HTML-3.20' | 'HTML-4.01' | 'HTML-5.00'
  | 'Layout' | 'List' | 'NSO' | 'OEB-1.00' | 'PrintField'
  | 'RDFa-1.10' | 'RTF-1.05' | 'Table' | 'XML-1.00'

export interface StructureNamespaceRoleTarget {
  role: string
  /** Omit to target the default PDF 1.7 standard structure namespace. */
  namespaceIndex?: number
}

export interface StructureNamespaceDefinition {
  uri: string
  /** Index into PdfBackendOptions.embeddedFiles for the namespace schema file. */
  schemaFileIndex?: number
  /** Raw file specification when the schema is not selected from embeddedFiles. */
  schema?: PdfRawValueDef
  /** Namespace-local role map emitted as /RoleMapNS. */
  roleMap?: Record<string, string | StructureNamespaceRoleTarget>
}

export type StructureNamespace = string | StructureNamespaceDefinition

export interface StructureAttribute {
  owner: StructureAttributeOwner
  entries: Record<string, PdfRawValueDef>
  /** Required for NSO and forbidden for every other owner. */
  namespaceIndex?: number
  /** Emits this attribute object as an indirect stream rather than a dictionary. */
  streamData?: Uint8Array
  /** Revision associated with this attribute object in the StructElem /A array. */
  revision?: number
}

export interface StructureUserProperty {
  name: string
  value: string | PdfRawValueDef
  formattedValue?: string
  hidden?: boolean
}

export interface StructureTag {
  /**
   * Structure type. Standard PDF types are recognized directly; a custom type
   * name is allowed when the document supplies a `roleMap` entry mapping it to
   * a standard type (ISO 32000 §14.7.3).
   */
  role: StructureRole | (string & {})
  alt?: string
  /** Replacement text used by assistive technology and text extraction. */
  actualText?: string
  /** Expanded form of an abbreviation. */
  expandedText?: string
  /** Exact pronunciation replacement for this structure element's content. */
  phoneme?: string
  /** Alphabet used by phoneme; defaults to ipa when omitted. */
  phoneticAlphabet?: StructurePhoneticAlphabet
  lang?: string
  /** For TH: distinguishes row/column headers */
  scope?: 'row' | 'column' | 'both'
  /** Table cell row span for TH/TD structure elements. */
  rowSpan?: number
  /** Table cell column span for TH/TD structure elements. */
  colSpan?: number
  /** IDs of header cells associated with a TD/TH structure element. */
  headers?: string[]
  /** PDF /Layout structure attributes. */
  layout?: StructureLayoutAttributes
  /** PDF /List /ListNumbering structure attribute for L structure elements. */
  listNumbering?: StructureListNumbering
  id?: string
  /** Human-readable title of the structure element (PDF /T). */
  title?: string
  /** Deprecated structure-element revision number /R, retained for interchange. */
  revision?: number
  /** Additional standard attribute objects, optionally revision-qualified. */
  attributes?: StructureAttribute[]
  /** UserProperties attribute owner entries. */
  userProperties?: StructureUserProperty[]
  /** Revision associated with the UserProperties attribute object. */
  userPropertiesRevision?: number
  /** Table summary describing structure and purpose (PDF Table /Summary). */
  summary?: string
  /** Artifact classification (PDF /Artifact /Type) for role 'Artifact'. */
  artifactType?: 'Pagination' | 'Layout' | 'Page' | 'Background'
  /** Artifact subtype (PDF /Artifact /Subtype) for pagination artifacts. */
  artifactSubtype?: 'Header' | 'Footer' | 'Watermark'
  /** Artifact bounding box in default user space. */
  artifactBBox?: [number, number, number, number]
  /** Page edges to which an artifact is logically attached. */
  artifactAttached?: ('Top' | 'Bottom' | 'Left' | 'Right')[]
  /** Treats role Artifact as the PDF 2.0 structure type instead of a marked-content artifact. */
  artifactStructureElement?: boolean
  /**
   * Index into the document's structure namespaces (PDF 2.0 /NS, ISO 32000-2
   * 14.7.4). The element's /S is then interpreted within that namespace.
   */
  namespaceIndex?: number
  /** Indexes into PdfBackendOptions.embeddedFiles, emitted as this element's /AF array. */
  associatedFileIndexes?: number[]
  /** PDF /PrintField structure attributes for tagged form-field content. */
  printField?: {
    role: 'radioButton' | 'checkBox' | 'pushButton' | 'textValue' | 'listBox'
    checked?: 'on' | 'off' | 'neutral'
    description?: string
  }
  /** MathML semantic subtree for a Formula element (PDF 2.0 namespace structure). */
  mathml?: MathMlStructureNode
}

// ─── Renderer options ───

/**
 * Options passed to the renderer
 *
 * All render tree coordinates are in pt on paper (1pt = 1/72 inch).
 * The renderer converts to the output coordinate system according to these options.
 *
 * - PDF: scale is usually 1.0 (1pt = 1 PDF user unit)
 * - Canvas: scale controls the editor zoom factor
 *   The Canvas side allocates the pixel buffer as scale × devicePixelRatio
 */
export interface RenderOptions {
  /** Scaling factor (default: 1.0 = actual size) */
  scale?: number
}

// ─── Document / page ───

// ─── Hyperlinks ───

export interface RenderLink {
  /** Link type */
  type: 'uri' | 'localAnchor' | 'localPage' | 'remoteAnchor' | 'remotePage'
  /** Link target (URL, anchor name, page number) */
  target: string
  /** Remote PDF file path (for remotePage/remoteAnchor) */
  remoteDocument?: string
}

// ─── Bookmarks ───

export interface RenderBookmark {
  /** Bookmark label */
  label: string
  /** Hierarchy level (1-6) */
  level: number
  /** Page index (0-based) */
  pageIndex: number
  /** Y coordinate within the page (pt) */
  y: number
}

/** Final output of the layout engine */
export interface RenderDocument {
  pages: RenderPage[]
  /** Bookmark list (for the PDF outline) */
  bookmarks?: RenderBookmark[]
  /** Anchor name → { pageIndex, y } mapping (for hyperlink destinations) */
  anchors?: Map<string, { pageIndex: number, y: number }>
  /** Image resources (imageId → base64/data URI string or binary) */
  images?: Record<string, string | Uint8Array>
  /** Enable Tagged PDF */
  tagged?: boolean
  /** Document language (BCP 47) */
  lang?: string
  /**
   * Maps custom structure type names used in tags to standard PDF structure
   * types (emitted as the StructTreeRoot /RoleMap).
   */
  roleMap?: Record<string, string>
  /**
   * Structure namespace URIs (PDF 2.0 /Namespaces, ISO 32000-2 14.7.4). Tags
   * reference one by index via StructureTag.namespaceIndex.
   */
  structureNamespaces?: StructureNamespace[]
  /** Indexes into PdfBackendOptions.embeddedFiles, in pronunciation match order. */
  pronunciationLexiconFileIndexes?: number[]
}

/** Render tree for one page */
export interface RenderPage {
  /** Page width (pt) */
  width: number
  /** Page height (pt) */
  height: number
  children: RenderNode[]
  /** Stable cache namespace for repeated Canvas rendering. Used only with revision. */
  cacheKey?: string
  /** Increment whenever page content or referenced visual resources change. */
  revision?: number
  /** PDF page transparency blending color space and group flags. */
  transparencyGroup?: RenderPageTransparencyGroup
}

export type RenderPageTransparencyGroup = PageTransparencyGroupDef

export type BlendMode =
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

export type OverprintMode = 0 | 1

/** PDF color rendering intent (ISO 32000 §8.6.5.8, ExtGState /RI). */
export type RenderingIntent = 'AbsoluteColorimetric' | 'RelativeColorimetric' | 'Saturation' | 'Perceptual'

/** A PostScript calculator function (FunctionType 4) mapping one 0..1 input to one 0..1 output. */
export interface RenderCalculatorFunction {
  /** PostScript body, e.g. '{ 1 exch sub }' for an inverting transfer curve. */
  expression: string
}

export type RenderTransferFunction = RenderCalculatorFunction | import('./template.js').PdfFunctionDef

/** A type-1 halftone screen (PDF /HT, ISO 32000 §10.6.5.2). */
/** Type-1 spot-function halftone screen. */
export interface RenderHalftoneScreen {
  type?: 1
  /** Screen frequency in halftone cells per inch. */
  frequency: number
  /** Screen angle in degrees. */
  angle: number
  /** A predefined spot-function name (e.g. 'Round', 'Ellipse', 'Line',
   *  'Diamond'), or a calculator function taking (x, y) in [-1, 1] to [-1, 1]. */
  spotFunction: string | RenderCalculatorFunction
  /** Requests the high-precision screen construction algorithm. */
  accurateScreens?: boolean
  /** Optional /TransferFunction applied during halftoning: 'Identity' or a function. */
  transferFunction?: 'Identity' | RenderTransferFunction
}

/** Type-6 threshold-array halftone (Width×Height bytes). */
export interface RenderHalftoneThreshold {
  type: 6
  width: number
  height: number
  thresholds: number[]
  /** Optional /TransferFunction applied during halftoning: 'Identity' or a function. */
  transferFunction?: 'Identity' | RenderTransferFunction
}

/** Type-10 angled threshold halftone (Xsquare/Ysquare cells). */
export interface RenderHalftoneAngled {
  type: 10
  xsquare: number
  ysquare: number
  thresholds: number[]
  /** Optional /TransferFunction applied during halftoning: 'Identity' or a function. */
  transferFunction?: 'Identity' | RenderTransferFunction
}

/** Type-16 threshold halftone with 16-bit thresholds and optional second rectangle. */
export interface RenderHalftoneThreshold16 {
  type: 16
  width: number
  height: number
  width2?: number
  height2?: number
  thresholds: number[]
  /** Optional /TransferFunction applied during halftoning: 'Identity' or a function. */
  transferFunction?: 'Identity' | RenderTransferFunction
}

/** Type-5 halftone: a per-colorant collection (Cyan/Magenta/.../Default). */
export interface RenderHalftoneCollection {
  type: 5
  halftones: Array<{ colorant: string, halftone: RenderHalftoneScreen | RenderHalftoneThreshold | RenderHalftoneAngled | RenderHalftoneThreshold16 }>
}

export type RenderHalftone =
  | RenderHalftoneScreen | RenderHalftoneThreshold | RenderHalftoneAngled | RenderHalftoneThreshold16 | RenderHalftoneCollection

/**
 * Device print-production graphics-state parameters (PDF ExtGState /TR /BG
 * /UCR /HT). These affect device color separation, not the on-screen page.
 */
export interface RenderDeviceParams {
  /**
   * /TR transfer function: 'Identity', 'Default', a single calculator function
   * applied to every colorant, or an array of four per-colorant functions.
   */
  transferFunction?: 'Identity' | 'Default' | RenderTransferFunction | RenderTransferFunction[]
  /** /BG black-generation function, or 'Default' (from /BG2) for the device default. */
  blackGeneration?: 'Default' | RenderCalculatorFunction
  /** /UCR undercolor-removal function, or 'Default' (from /UCR2) for the device default. */
  undercolorRemoval?: 'Default' | RenderCalculatorFunction
  /** /HT halftone: 'Default' or a type-1 halftone screen. */
  halftone?: 'Default' | RenderHalftone
  /** PDF 2.0 halftone origin (/HTO) in device-space pixels. */
  halftoneOrigin?: [number, number]
  /** PDF 2.0 black-point compensation control (/UseBlackPtComp). */
  useBlackPointCompensation?: 'on' | 'off' | 'default'
  /** Flatness tolerance (/FL). */
  flatness?: number
  /** Smoothness tolerance (/SM). */
  smoothness?: number
  /** Automatic stroke adjustment (/SA). */
  strokeAdjustment?: boolean
}

export type RenderOptionalContent = OptionalContentDef

// ─── Node union type ───

export type RenderNode =
  | RenderGroup
  | RenderText
  | RenderLine
  | RenderRect
  | RenderEllipse
  | RenderPath
  | RenderImage
  | RenderSvg
  | RenderFormField

/** PDF transparent-imaging graphics-state flags shared by rendered objects. */
export interface RenderTransparencyState {
  /** Interpret the current alpha constant and soft mask as shape values (/AIS). */
  alphaIsShape?: boolean
  /** Treat all glyphs in one text object as a knockout unit (/TK). Default true. */
  textKnockout?: boolean
}

// ─── Composite node ───

/**
 * Group (composite)
 * The only node type that has children.
 * Represents bands, frames, clipping regions, etc.
 */
export interface RenderGroup extends RenderTransparencyState {
  type: 'group'
  /** X coordinate relative to parent (pt) */
  x: number
  /** Y coordinate relative to parent (pt) */
  y: number
  /** Width (pt) */
  width: number
  /** Height (pt) */
  height: number
  /** Stable cache namespace for this top-level group. Used only with revision. */
  cacheKey?: string
  /** Increment whenever group content or referenced visual resources change. */
  revision?: number
  /** Whether to clip children to the rectangular region */
  clip?: boolean
  clipPath?: {
    commands: Uint8Array
    coords: Float32Array
    fillRule?: 'nonzero' | 'evenodd'
  }
  /** Opacity (0.0-1.0) */
  opacity?: number
  /** Blend mode applied while drawing this group */
  blendMode?: BlendMode
  /** Nonstroking overprint flag applied while drawing this group */
  overprintFill?: boolean
  /** Stroking overprint flag applied while drawing this group */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintMode
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntent
  /** PDF optional content group (layer). */
  optionalContent?: RenderOptionalContent
  /** Preserves the presence of a PDF transparency-group boundary even when /I and /K are both false. */
  transparencyGroup?: boolean
  /**
   * Isolated transparency group (PDF /Group /I). When set (or when `knockout`
   * or `softMask` is set) the group's children are composited into a
   * transparency group Form XObject before opacity/blend/mask is applied,
   * so overlapping children do not double-composite.
   */
  isolated?: boolean
  /** Knockout transparency group (PDF /Group /K). */
  knockout?: boolean
  /** Soft mask applied while compositing this group (PDF ExtGState /SMask). */
  softMask?: RenderSoftMask
  /** Device print-production parameters (PDF ExtGState /TR /BG /UCR /HT). */
  deviceParams?: RenderDeviceParams
  /** Rotation angle (degrees) */
  rotation?: number
  /** Rotation origin X (relative to the group, pt) */
  rotationOriginX?: number
  /** Rotation origin Y (relative to the group, pt) */
  rotationOriginY?: number
  /** Maps group-local top-down coordinates into its parent coordinate space. */
  affineTransform?: [number, number, number, number, number, number]
  /** Original PDF Form XObject boundary and dictionary metadata. */
  pdfForm?: PdfFormXObjectDef
  children: RenderNode[]
  /** Hyperlink info */
  link?: RenderLink
  /** Structure tag (for Tagged PDF) */
  tag?: StructureTag
}

/**
 * Soft mask (PDF ExtGState /SMask). The mask is defined by compositing
 * `content` as a transparency group; its per-pixel luminosity (type
 * 'luminosity') or alpha (type 'alpha') becomes the mask value applied
 * to the masked group.
 */
export interface RenderSoftMask {
  /** Mask derived from the group's luminosity or alpha. */
  type: 'luminosity' | 'alpha'
  /** Blending color space of the soft-mask transparency group. */
  colorSpace?: PdfProcessColorSpaceDef
  /** Isolation flag of the soft-mask transparency group. */
  isolated?: boolean
  /** Knockout flag of the soft-mask transparency group. */
  knockout?: boolean
  /**
   * Backdrop color (DeviceRGB 0-1) for a luminosity mask outside the mask
   * group's bounding box. PDF /SMask /BC. Default black (fully masked).
   */
  backdrop?: [number, number, number]
  /** Nodes whose composited luminosity/alpha define the mask. */
  content: RenderNode[]
  /** Optional /TR transfer function (PDF /SMask /TR) remapping the computed
   *  mask value (0..1) before it is applied. 'Identity' or absent means none. */
  transferFunction?: 'Identity' | RenderTransferFunction
}

// ─── Leaf nodes ───

/**
 * Shaped glyph run.
 * Result of a single shaping pass (GSUB substitution + GPOS positioning) performed
 * by the layout engine. Carried on RenderText so that every backend renders exactly
 * the glyphs and positions the layout was measured with.
 *
 * All values are in pt at the RenderText's fontSize.
 * advances already include letter spacing, word spacing, and justify spacing,
 * so a backend must place glyph i+1 exactly advances[i] after glyph i.
 * For vertical writing modes, advances are vertical (top to bottom) advances.
 */
export interface RenderGlyphRun {
  /** Shaped glyph IDs (post-GSUB: ligatures, vertical alternates, etc.) */
  glyphIds: Uint16Array
  /** Per-glyph advance (pt), spacing included */
  advances: Float64Array
  /** Per-glyph GPOS x placement offset (pt) */
  xOffsets: Float64Array
  /** Per-glyph GPOS y placement offset (pt, positive = up) */
  yOffsets: Float64Array
  /** Per-glyph count of source code points (ligatures cover more than 1) */
  clusters: Uint16Array
  /** Per-glyph zero-based source code-point cluster start used for BiDi reordering. */
  sourceClusters?: Uint32Array
  /** UAX #50 clockwise rotation in vertical layout (0 or 90 degrees). */
  rotations?: Uint8Array
  /** Per-glyph horizontal outline scale used by AAT stretch postcompensation. */
  xScales?: Float64Array
  /** Per-glyph vertical outline scale used by vertical AAT stretch postcompensation. */
  yScales?: Float64Array
  /** Per-glyph outline captured at an AAT ductile-axis value. */
  outlineOverrides?: ({ commands: Uint8Array, coords: Float32Array } | null)[]
  /** Non-zero IDs join contiguous glyphs that MERG requires to rasterize as one outline. */
  mergeGroups?: Uint32Array
}

/** Text drawing */
export interface RenderText extends RenderTransparencyState {
  type: 'text'
  /** X coordinate relative to parent (pt) */
  x: number
  /** Y coordinate relative to parent (pt) */
  y: number
  text: string
  /** Replacement text emitted through marked-content /ActualText. */
  actualText?: string
  fontId: string
  /** Font size (pt) */
  fontSize: number
  /** Text color ("#RRGGBB") */
  color: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  /** Horizontal alignment (used when the renderer positions text within the width) */
  hAlign?: 'left' | 'center' | 'right'
  /** Text block width (pt, for alignment calculation) */
  width?: number
  /** Extra letter spacing (pt, for justify distribution) */
  letterSpacing?: number
  /** Horizontal text scale multiplier. Default is 1. */
  horizontalScale?: number
  /** Explicit baseline offset from this text node's Y coordinate. */
  baselineOffset?: number
  /** Variable Font axis values */
  variation?: Record<string, number>
  /** Writing mode */
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'
  /** Specify glyph IDs directly (bypasses cmap) — for math variant glyphs */
  glyphIds?: number[]
  /** Shaped glyph run produced by the layout engine (authoritative glyphs + positions) */
  glyphRun?: RenderGlyphRun
  /** Whether to outline text (draw glyph paths) */
  outlineText?: boolean
  /** PDF font program handling. Preview backends intentionally ignore this. */
  pdfFontMode?: 'embedded' | 'reference'
  textPaintMode?: 'fill' | 'stroke' | 'fillStroke'
  textStrokeColor?: string
  textStrokeWidth?: number
  /** Text direction */
  direction?: 'ltr' | 'rtl'
  /** Blend mode applied while drawing this text */
  blendMode?: BlendMode
  /** Nonstroking overprint flag applied while drawing this text */
  overprintFill?: boolean
  /** Stroking overprint flag applied while drawing this text */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintMode
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntent
  /** Hyperlink info */
  link?: RenderLink
  /** Structure tag (for Tagged PDF) */
  tag?: StructureTag
}

/** Line segment drawing */
/** Interactive form field (AcroForm widget + preview appearance). */
/** One choice in a dropdown/listbox render field. */
export interface RenderFormFieldOption {
  value: string
  label: string
}

export interface RenderFormField extends RenderTransparencyState {
  type: 'formField'
  x: number
  y: number
  width: number
  height: number
  fieldType: 'text' | 'checkbox' | 'radio' | 'pushbutton' | 'dropdown' | 'listbox' | 'signature'
  name: string
  /** text/dropdown/listbox: selected value */
  value?: string
  /** checkbox/radio: on state */
  checked?: boolean
  /** checkbox/radio on-state export value (default 'Yes') */
  exportValue?: string
  /** dropdown/listbox choices */
  options?: RenderFormFieldOption[]
  editable?: boolean
  multiSelect?: boolean
  /** pushbutton caption */
  caption?: string
  /** pushbutton URI action */
  action?: string
  fontId: string
  fontSize: number
  color: string
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
  /** Field /AA actions (K/F/V/C), retained as non-executable action models. */
  additionalActions?: Partial<Record<'K' | 'F' | 'V' | 'C', PdfActionDef>>
  calculationOrder?: number
  maxLength?: number
  borderColor?: string
  backgroundColor?: string
}

export interface RenderLine extends RenderTransparencyState {
  /** Tagged PDF structure tag for this graphic */
  tag?: StructureTag
  type: 'line'
  /** Start X (pt, relative to parent) */
  x1: number
  /** Start Y (pt, relative to parent) */
  y1: number
  /** End X (pt, relative to parent) */
  x2: number
  /** End Y (pt, relative to parent) */
  y2: number
  /** Line width (pt) */
  lineWidth: number
  /** Line color ("#RRGGBB") */
  color: string
  /** Dash pattern (pt) [dash length, gap, ...] */
  dash?: number[]
  /** Blend mode applied while drawing this line */
  blendMode?: BlendMode
  /** Nonstroking overprint flag applied while drawing this line */
  overprintFill?: boolean
  /** Stroking overprint flag applied while drawing this line */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintMode
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntent
}

/** Rectangle drawing */
export interface RenderRect extends RenderTransparencyState {
  /** Tagged PDF structure tag for this graphic */
  tag?: StructureTag
  type: 'rect'
  /** X coordinate relative to parent (pt) */
  x: number
  /** Y coordinate relative to parent (pt) */
  y: number
  /** Width (pt) */
  width: number
  /** Height (pt) */
  height: number
  /** Corner radius (pt) */
  radius?: number
  /** Per-corner radii (pt) */
  cornerRadii?: {
    topLeft?: number
    topRight?: number
    bottomRight?: number
    bottomLeft?: number
  }
  /** Fill paint */
  fill?: PaintValue
  /** Stroke color ("#RRGGBB") */
  stroke?: string
  /** Stroke width (pt) */
  strokeWidth?: number
  /** Blend mode applied while drawing this rectangle */
  blendMode?: BlendMode
  /** Nonstroking overprint flag applied while drawing this rectangle */
  overprintFill?: boolean
  /** Stroking overprint flag applied while drawing this rectangle */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintMode
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntent
}

/** Ellipse drawing */
export interface RenderEllipse extends RenderTransparencyState {
  /** Tagged PDF structure tag for this graphic */
  tag?: StructureTag
  type: 'ellipse'
  /** Center X (pt, relative to parent) */
  cx: number
  /** Center Y (pt, relative to parent) */
  cy: number
  /** X radius (pt) */
  rx: number
  /** Y radius (pt) */
  ry: number
  /** Fill paint */
  fill?: PaintValue
  /** Stroke color ("#RRGGBB") */
  stroke?: string
  /** Stroke width (pt) */
  strokeWidth?: number
  /** Blend mode applied while drawing this ellipse */
  blendMode?: BlendMode
  /** Nonstroking overprint flag applied while drawing this ellipse */
  overprintFill?: boolean
  /** Stroking overprint flag applied while drawing this ellipse */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintMode
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntent
}

/** Arbitrary path drawing (SVG elements and vector shapes) */
export interface RenderPath extends RenderTransparencyState {
  type: 'path'
  /** Path commands (Uint8Array: MoveTo, LineTo, CubicTo, Close) */
  commands: Uint8Array
  /** Coordinate values (Float32Array, pt) */
  coords: Float32Array
  /** Shared immutable source vectors and their page-space placements. */
  pdfSourceVector?: RenderPdfSourceVector
  /** Affine transform applied to geometry and stroke parameters during painting. */
  affineTransform?: [number, number, number, number, number, number]
  /** Fill paint */
  fill?: PaintValue
  fillRule?: 'nonzero' | 'evenodd'
  fillOpacity?: number
  /** Stroke paint */
  stroke?: PaintValue
  /** Stroke width (pt) */
  strokeWidth?: number
  strokeOpacity?: number
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDasharray?: number[]
  strokeDashoffset?: number
  /** Blend mode applied while drawing this path */
  blendMode?: BlendMode
  /** Nonstroking overprint flag applied while drawing this path */
  overprintFill?: boolean
  /** Stroking overprint flag applied while drawing this path */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintMode
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntent
  /** Structure tag (for Tagged PDF) */
  tag?: StructureTag
}

export interface RenderPdfSourceVector {
  definitions: Array<{ commands: Uint8Array, coords: Float32Array }>
  instances: Array<{
    definitionIndex: number
    matrix: [number, number, number, number, number, number]
  }>
}

/** Image drawing */
export interface RenderImage extends RenderTransparencyState {
  type: 'image'
  /** X coordinate relative to parent (pt) */
  x: number
  /** Y coordinate relative to parent (pt) */
  y: number
  /** Width (pt) */
  width: number
  /** Height (pt) */
  height: number
  /** Image resource key */
  imageId: string
  rotation?: 0 | 90 | 180 | 270
  /** Unit-square image affine matrix in renderer coordinates */
  affineTransform?: [number, number, number, number, number, number]
  opacity?: number
  /** Image resampling preference carried from PDF /Interpolate. */
  interpolate?: boolean
  /** Alternate image resources carried from PDF /Alternates. */
  alternates?: Array<{ imageId: string, defaultForPrinting?: boolean }>
  /** Open Prepress Interface proxy metadata. */
  opi?: PdfOpiMetadataDef
  /** Image XObject measurement semantics. */
  measure?: PdfMeasurement
  /** Image XObject point-data semantics. */
  pointData?: PdfPointData[]
  /** Blend mode applied while drawing this image */
  blendMode?: BlendMode
  /** Nonstroking overprint flag applied while drawing this image */
  overprintFill?: boolean
  /** Stroking overprint flag applied while drawing this image */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintMode
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntent
  /** Hyperlink info */
  link?: RenderLink
  /** Structure tag (for Tagged PDF) */
  tag?: StructureTag
}

/** SVG drawing */
export interface RenderSvg extends RenderTransparencyState {
  type: 'svg'
  /** X coordinate relative to parent (pt) */
  x: number
  /** Y coordinate relative to parent (pt) */
  y: number
  /** Width (pt) */
  width: number
  /** Height (pt) */
  height: number
  /** SVG content string */
  svgData: string
  /** Blend mode applied while drawing this SVG */
  blendMode?: BlendMode
  /** Nonstroking overprint flag applied while drawing this SVG */
  overprintFill?: boolean
  /** Stroking overprint flag applied while drawing this SVG */
  overprintStroke?: boolean
  /** PDF overprint mode */
  overprintMode?: OverprintMode
  /** PDF color rendering intent (ExtGState /RI). */
  renderingIntent?: RenderingIntent
  /** Structure tag (for Tagged PDF) */
  tag?: StructureTag
}
