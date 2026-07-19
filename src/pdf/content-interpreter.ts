import type { BlendModeDef, CalculatorFunctionDef, DeviceParamsDef, ElementDef, FillDef, FrameDef, GradientStopDef, HalftoneDef, HalftoneScreenDef, HalftoneThresholdDef, HalftoneAngledDef, HalftoneThreshold16Def, HalftoneCollectionDef, ImageDef, OptionalContentDef, OverprintModeDef, PathDef, PdfFormXObjectDef, PdfFunctionDef, PdfNativeMeshShadingDef, PdfOptionalContentConfigurationDef, PdfOptionalContentExpressionDef, PdfOptionalContentGroupDef, PdfOptionalContentMembershipDef, PdfOptionalContentOrderDef, PdfOptionalContentPropertiesDef, PdfOptionalContentUsageApplicationDef, PdfProcessColorSpaceDef, PdfRawValueDef, PdfShadingColorSpaceDef, PdfSpecialColorDef, RenderingIntentDef, StaticTextDef, StyleDef, TransferFunctionDef } from '../types/template.js'
import { buildSvgPathD } from '../svg/svg-path-builder.js'
import { parseSvgPath } from '../svg/svg-path-parser.js'
import { PdfContentLexer } from './content-lexer.js'
import { PdfDocument, PdfName, PdfRef, PdfStream, PdfString, type PdfDict, type PdfValue } from './pdf-parser.js'
import { createFontDecoder, type PdfFontDecoder, type PdfGlyphOutline } from './pdf-text-decoder.js'
import { pdfStringToText, type ImportedFontInfo, type PdfFontResolver } from './pdf-page-importer.js'
import type { TileGraphicDef } from '../types/template.js'
import { coonsInteriorPoints } from '../renderer/complex-paint.js'
import { flipImportedPdfImage, importInlinePdfImage, importPdfImageXObject, rawPdfDictionary, rawPdfValue, readPdfOpiMetadata, type ImportedPdfImageData } from './pdf-image-importer.js'
import { evaluateCalculatorFunction, evaluatePdfFunction, evaluateSampledFunction, readPdfFunctionDef } from './pdf-function.js'
import { parsePdfColorSpace, pdfColorSpaceComponents, pdfColorToHex, pdfColorToRgb, pdfShadingColorSpaceDef, pdfSpecialColorDef } from './pdf-colorspace.js'
import { decodePng } from '../image/png-parser.js'
import { pdfMeasurementFromRaw, pdfPointDataFromRaw } from './pdf-measurement.js'
import { parsePdfXmpPacket } from './pdf-xmp.js'
import type { IccTransform } from './icc-profile-reader.js'

type Matrix = [number, number, number, number, number, number]

function sourceVectorDefinition(
  definitions: Array<{ commands: number[], coords: number[] }>,
  byCid: Map<number, number>,
  cid: number,
  outline: PdfGlyphOutline,
): number {
  const existing = byCid.get(cid)
  if (existing !== undefined) return existing
  const commands = new Array<number>(outline.commands.length)
  const coords = new Array<number>(outline.coords.length)
  for (let i = 0; i < commands.length; i++) commands[i] = outline.commands[i]!
  for (let i = 0; i < coords.length; i++) coords[i] = outline.coords[i]!
  const index = definitions.length
  definitions.push({ commands, coords })
  byCid.set(cid, index)
  return index
}

function sourceGlyphMatrix(
  textToPage: Matrix,
  pageHeight: number,
  scaleX: number,
  scaleY: number,
  originX: number,
  originY: number,
): Matrix {
  return [
    textToPage[0] * scaleX,
    -textToPage[1] * scaleX,
    textToPage[2] * scaleY,
    -textToPage[3] * scaleY,
    textToPage[0] * originX + textToPage[2] * originY + textToPage[4],
    pageHeight - (textToPage[1] * originX + textToPage[3] * originY + textToPage[5]),
  ]
}

const OPTIONAL_CONTENT_USAGE_CATEGORIES = new Set(['CreatorInfo', 'Language', 'Export', 'Zoom', 'Print', 'View', 'User', 'PageElement'])
const OPTIONAL_CONTENT_PAGE_ELEMENT_SUBTYPES = new Set(['HF', 'FG', 'BG', 'L'])
const MESH_COORDINATE_BITS = new Set([1, 2, 4, 8, 12, 16, 24, 32])
const MESH_COMPONENT_BITS = new Set([1, 2, 4, 8, 12, 16])
const MESH_FLAG_BITS = new Set([2, 4, 8])
const TEXT_STATE_OPERATORS = new Set(['Tc', 'Tw', 'Tz', 'TL', 'Tf', 'Tr', 'Ts'])
const TEXT_OBJECT_OPERATORS = new Set(['Td', 'TD', 'Tm', 'T*', 'Tj', 'TJ', "'", '"'])
const TEXT_OBJECT_SHARED_OPERATORS = new Set([
  'q', 'Q', 'cm', 'w', 'J', 'j', 'M', 'd', 'ri', 'i', 'gs',
  'CS', 'cs', 'SC', 'SCN', 'sc', 'scn', 'G', 'g', 'RG', 'rg', 'K', 'k',
  'MP', 'DP', 'BMC', 'BDC', 'EMC', 'BX', 'EX',
])
const TYPE3_COLOR_OPERATORS = new Set(['CS', 'cs', 'SC', 'SCN', 'sc', 'scn', 'G', 'g', 'RG', 'rg', 'K', 'k'])
export const PDF_FIXED_CONTENT_OPERATOR_ARITY = new Map<string, number>([
  ['q', 0], ['Q', 0], ['cm', 6], ['w', 1], ['J', 1], ['j', 1], ['M', 1], ['d', 2], ['ri', 1], ['i', 1], ['gs', 1],
  ['m', 2], ['l', 2], ['c', 6], ['v', 4], ['y', 4], ['h', 0], ['re', 4],
  ['f', 0], ['F', 0], ['f*', 0], ['S', 0], ['s', 0], ['B', 0], ['B*', 0], ['b', 0], ['b*', 0], ['n', 0],
  ['W', 0], ['W*', 0], ['g', 1], ['G', 1], ['rg', 3], ['RG', 3], ['k', 4], ['K', 4], ['cs', 1], ['CS', 1],
  ['sh', 1], ['Do', 1], ['BMC', 1], ['BDC', 2], ['EMC', 0], ['MP', 1], ['DP', 2], ['BX', 0], ['EX', 0],
  ['BT', 0], ['ET', 0], ['Tf', 2], ['Td', 2], ['TD', 2], ['Tm', 6], ['T*', 0], ['TL', 1], ['Tc', 1], ['Tw', 1],
  ['Tz', 1], ['Ts', 1], ['Tr', 1], ['Tj', 1], ['TJ', 1], ['d0', 2], ['d1', 6], ["'", 1], ['"', 3],
])

/** Operators whose operand count is selected by the active colour space. */
export const PDF_VARIABLE_CONTENT_OPERATORS = ['SC', 'SCN', 'sc', 'scn'] as const
/** Inline-image delimiters are consumed as one token by PdfContentLexer. */
export const PDF_INLINE_IMAGE_OPERATORS = ['BI', 'ID', 'EI'] as const

interface GraphicsState {
  ctm: Matrix
  fillColor: string
  strokeColor: string
  fillPaint: PdfPaint
  strokePaint: PdfPaint
  fillColorSpace: string | null
  strokeColorSpace: string | null
  lineWidth: number
  lineCap: 'butt' | 'round' | 'square'
  lineJoin: 'miter' | 'round' | 'bevel'
  miterLimit: number
  dashArray: number[]
  dashOffset: number
  fillOpacity: number
  strokeOpacity: number
  softMaskAlpha: number
  alphaIsShape: boolean
  textKnockout: boolean
  blendMode: BlendModeDef
  fillOverprint: boolean
  strokeOverprint: boolean
  overprintMode: OverprintModeDef
  renderingIntent: RenderingIntentDef | null
  clips: ClipRegion[]
  clipIsEmpty: boolean
  deviceParams: DeviceParamsDef | null
  flatness: number
}

/** Reconstructed per-pixel soft mask and the content range it applies to. */
interface SoftMaskCapture {
  /** Index in `elements` where masked content begins. */
  start: number
  /** Graphics-state stack depth when the mask was set (for Q scope exit). */
  stackDepth: number
  mask: {
    type: 'luminosity' | 'alpha'
    colorSpace?: PdfProcessColorSpaceDef
    isolated?: boolean
    knockout?: boolean
    backdrop?: [number, number, number]
    /** Mask group elements in page coordinates. */
    elements: ElementDef[]
    /** /SMask /TR transfer function remapping the mask value. */
    transferFunction?: 'Identity' | TransferFunctionDef
  }
}

/** Accumulated clip path in page coordinates */
interface ClipRegion {
  /** Identity key used for grouping consecutive elements under one clip frame */
  key: string
  commands: Uint8Array
  coords: Float32Array
  fillRule: 'nonzero' | 'evenodd'
  x: number
  y: number
  width: number
  height: number
  /** True when the clip path is a plain axis-aligned rectangle equal to its bbox */
  isRect: boolean
}

/** Buffered text run awaiting merge with subsequent show-text operations */
interface PendingText {
  element: StaticTextDef
  clips: ClipRegion[]
  clipKey: string
  mergeKey: string
  /** Horizontal: baseline y. Vertical: column center x. */
  baselineY: number
  /** Horizontal: right edge x. Vertical: bottom edge y. */
  endX: number
  fontSize: number
  vertical: boolean
}

interface MarkedContentFrame {
  optionalContent: OptionalContentDef | null
  actualText: string | null
  actualTextAssigned: boolean
  elementStart: number
}

interface MarkedContentDefinition {
  optionalContent: OptionalContentDef | null
  actualText: string | null
}

type PdfPaint = string | PdfSpecialColorDef | PdfGradientPaint

type PdfGradientPaint =
  | {
      type: 'meshAbs'
      patches: { points: number[], colors: [string, string, string, string] }[]
      triangles: { points: number[], colors: [string, string, string] }[]
      lattice?: { columns: number, points: number[], colors: string[] }
      common: PdfShadingCommon
      native?: PdfNativeMeshShadingDef
      nativeFunction?: import('../types/template.js').PdfNativeFunctionShadingDef
    }
  | {
      type: 'functionShadingAbs'
      domain: [number, number, number, number]
      /** domain -> page space (top-down) */
      matrix: [number, number, number, number, number, number]
      expression: string
      common: PdfShadingCommon
    }
  | {
      type: 'tilingAbs'
      bbox: [number, number, number, number]
      xStep: number
      yStep: number
      tilingType: 1 | 2 | 3
      /** pattern space -> page space (top-down) */
      matrix: [number, number, number, number, number, number]
      graphics: TileGraphicDef[]
    }
  | {
      type: 'linearGradientAbs'
      x1: number
      y1: number
      x2: number
      y2: number
      stops: GradientStopDef[]
      spreadMethod?: 'pad' | 'reflect' | 'repeat'
      common: PdfShadingCommon
      domain: [number, number]
      extend: [boolean, boolean]
      functions?: PdfFunctionDef[]
      colorSpace: PdfShadingColorSpaceDef
      native: import('../types/template.js').PdfNativeAxialRadialShadingDef
    }
  | {
      type: 'radialGradientAbs'
      cx: number
      cy: number
      r: number
      fx: number
      fy: number
      fr: number
      stops: GradientStopDef[]
      spreadMethod?: 'pad' | 'reflect' | 'repeat'
      common: PdfShadingCommon
      domain: [number, number]
      extend: [boolean, boolean]
      functions?: PdfFunctionDef[]
      colorSpace: PdfShadingColorSpaceDef
      native: import('../types/template.js').PdfNativeAxialRadialShadingDef
    }

interface PdfShadingCommon {
  background?: number[]
  sourceBackground?: number[]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
}

interface CurrentPath {
  commands: number[]
  coords: number[]
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface TextState {
  font: PdfFontDecoder | null
  fontSize: number
  charSpacing: number
  wordSpacing: number
  horizontalScale: number
  leading: number
  rise: number
  renderMode: number
  textMatrix: Matrix
  lineMatrix: Matrix
}

export interface PdfContentInterpreterOptions {
  doc: PdfDocument
  pageWidth: number
  pageHeight: number
  initialMatrix?: Matrix
  resources: PdfDict
  includeInvisibleText?: boolean
  /** Converts shown text to glyph-outline paths instead of semantic text elements. */
  outlineText?: boolean
  /** Target raster resolution used when grid-fitting outlined Type 1 glyphs. */
  outlineDpi?: number
  fontResolver?: PdfFontResolver
  imageIdPrefix?: string
  onProgress?: (done: number, total: number) => void
  /** Clip all content to this bounding box in the initial coordinate space (Form XObject /BBox). */
  clipBBox?: [number, number, number, number]
  visitedForms?: Set<number>
  visitedFormStreams?: Set<PdfStream>
  optionalContentContext?: PdfOptionalContentContext
  /** PDF/X process-output profile used to interpret DeviceCMYK and DeviceGray. */
  deviceCmykTransform?: IccTransform
}

export interface PdfOptionalContentContext {
  event?: 'View' | 'Print' | 'Export'
  zoom?: number
  language?: string
  user?: { individual?: string, title?: string, organization?: string }
}

export class PdfContentInterpreter {
  private readonly doc: PdfDocument
  private readonly pageWidth: number
  private readonly pageHeight: number
  private resources: PdfDict
  private readonly elements: ElementDef[] = []
  private readonly operands: PdfValue[] = []
  private readonly stack: GraphicsState[] = []
  private readonly textStateStack: TextParamSnapshot[] = []
  private readonly visitedForms: Set<number>
  private readonly visitedFormStreams: Set<PdfStream>
  // Keyed by the resolved font dictionary object so reused resource names
  // across Form XObjects never share a decoder (inline dicts have no ref key)
  private readonly fontCache = new Map<PdfDict, PdfFontDecoder>()
  private readonly includeInvisibleText: boolean
  private readonly outlineText: boolean
  private readonly outlineDpi: number | undefined
  private readonly fontResolver: PdfFontResolver | undefined
  private readonly imageIdPrefix: string
  private readonly onProgress?: (done: number, total: number) => void
  private readonly baseMatrix: Matrix
  private readonly images: Record<string, Uint8Array> = {}
  private imageCounter = 0
  private state: GraphicsState
  private textState: TextState = createTextState()
  private path: CurrentPath = createPath()
  private pendingText: PendingText | null = null
  private readonly pendingTextClip: { commands: number[], coords: number[], requested: boolean } = { commands: [], coords: [], requested: false }
  private readonly textStyles = new Map<string, StyleDef>()
  private readonly usedFonts = new Map<string, ImportedFontInfo>()
  private readonly markedContentStack: MarkedContentFrame[] = []
  /** Nesting depth of PDF compatibility sections introduced by BX/EX. */
  private compatibilitySectionDepth = 0
  private inTextObject = false
  private type3CharProcState: { metricsOperator: 'd0' | 'd1' | null } | null = null
  private clipCounter = 0
  private patternCellCounter = 0
  private pendingClipRule: 'nonzero' | 'evenodd' | null = null
  private readonly optionalContentContext: Required<Pick<PdfOptionalContentContext, 'event' | 'zoom'>> & Omit<PdfOptionalContentContext, 'event' | 'zoom'>
  private readonly deviceCmykTransform: IccTransform | undefined
  private optionalContentPropertiesCache: PdfOptionalContentPropertiesDef | undefined
  /** Innermost frame of the most recent clip wrap, reused for consecutive elements sharing the same clips */
  private lastClipWrap: { clipKey: string, frame: FrameDef, originX: number, originY: number } | null = null
  /** Active per-pixel soft mask capture (A6.3 import), or null. */
  private activeSoftMaskCapture: SoftMaskCapture | null = null
  /** Active device-parameter capture (A6.4-A6.7 import), or null. */
  private activeDeviceParamsCapture: { start: number, stackDepth: number, params: DeviceParamsDef } | null = null

  constructor(options: PdfContentInterpreterOptions) {
    this.doc = options.doc
    this.pageWidth = options.pageWidth
    this.pageHeight = options.pageHeight
    this.resources = options.resources
    this.includeInvisibleText = options.includeInvisibleText === true
    this.outlineText = options.outlineText === true
    if (options.outlineDpi !== undefined && (!Number.isFinite(options.outlineDpi) || options.outlineDpi <= 0)) {
      throw new Error('PDF import outlineDpi must be a positive finite number')
    }
    this.outlineDpi = options.outlineDpi
    this.fontResolver = options.fontResolver
    this.imageIdPrefix = options.imageIdPrefix ?? 'pdfimg'
    this.onProgress = options.onProgress
    this.visitedForms = options.visitedForms ?? new Set<number>()
    this.visitedFormStreams = options.visitedFormStreams ?? new Set<PdfStream>()
    this.optionalContentContext = {
      event: options.optionalContentContext?.event ?? 'View',
      zoom: options.optionalContentContext?.zoom ?? 1,
      language: options.optionalContentContext?.language,
      user: options.optionalContentContext?.user,
    }
    this.deviceCmykTransform = options.deviceCmykTransform
    this.baseMatrix = options.initialMatrix ? options.initialMatrix.slice() as Matrix : [1, 0, 0, 1, 0, 0]
    this.state = createGraphicsState(options.initialMatrix)
    if (options.clipBBox) {
      const b = options.clipBBox
      this.clipCurrentSpaceRect(b[0], b[1], b[2], b[3])
    }
  }

  interpret(data: Uint8Array): ElementDef[] {
    const lexer = new PdfContentLexer(data)
    this.reportInterpretProgress(0, data.length)
    let nextProgressOffset = 65536
    for (;;) {
      const token = lexer.next()
      if (token.type === 'eof') break
      if (lexer.offset >= nextProgressOffset) {
        this.reportInterpretProgress(lexer.offset, data.length)
        nextProgressOffset = lexer.offset + 65536
      }
      if (token.type === 'object') {
        this.operands.push(token.value)
      } else if (token.type === 'inlineImage') {
        if (this.type3CharProcState !== null && this.type3CharProcState.metricsOperator === null) {
          throw new Error('PDF import error: a Type3 CharProc must begin with d0 or d1')
        }
        if (this.inTextObject) throw new Error('PDF import error: inline image is not permitted inside a text object')
        this.paintInlineImage(token.dict, token.data)
      } else {
        this.execute(token.value)
        this.operands.length = 0
      }
    }
    this.reportInterpretProgress(data.length, data.length)
    return this.elements
  }

  private reportInterpretProgress(done: number, total: number): void {
    if (this.onProgress !== undefined) this.onProgress(done, total)
  }

  /** Commits any buffered text run and returns the collected elements. Call once after the top-level interpret(). */
  finalize(): ElementDef[] {
    if (this.compatibilitySectionDepth !== 0) {
      throw new Error('PDF import error: unterminated BX compatibility section')
    }
    if (this.inTextObject) throw new Error('PDF import error: unterminated BT text object')
    if (this.markedContentStack.length !== 0) throw new Error('PDF import error: unterminated marked-content sequence')
    this.finalizeSoftMaskCapture()
    this.finalizeDeviceParamsCapture()
    this.flushPendingText()
    return this.elements
  }

  getImages(): Record<string, Uint8Array> {
    return this.images
  }

  /** Named text styles referenced by imported staticText elements (font family / size / weight) */
  getStyles(): StyleDef[] {
    return [...this.textStyles.values()]
  }

  /** Fonts actually used by shown text, including fonts referenced from nested Form XObjects */
  getFontInfos(): ImportedFontInfo[] {
    return [...this.usedFonts.values()]
  }

  readOptionalContent(value: PdfValue): OptionalContentDef {
    return this.optionalContentDefinition(value)
  }

  getOptionalContentProperties(): PdfOptionalContentPropertiesDef | undefined {
    return this.readOptionalContentProperties()
  }

  /**
   * Interprets an annotation appearance stream (PDF 12.5.5). The matrix maps
   * the appearance form space into page user space; drawing state, resources,
   * and text state are isolated from the page content.
   */
  interpretAppearance(data: Uint8Array, resources: PdfDict | null, matrix: Matrix, bbox: [number, number, number, number]): void {
    this.flushPendingText()
    const savedResources = this.resources
    const savedState = this.state
    const savedText = this.textState
    const savedPath = this.path
    const savedPendingClipRule = this.pendingClipRule
    const savedStackLength = this.stack.length
    const savedInTextObject = this.inTextObject
    if (resources !== null) this.resources = resources
    this.state = createGraphicsState(this.baseMatrix)
    this.state.ctm = multiplyMatrix(this.state.ctm, matrix)
    this.clipCurrentSpaceRect(bbox[0], bbox[1], bbox[2], bbox[3])
    this.textState = createTextState()
    this.path = createPath()
    this.pendingClipRule = null
    this.inTextObject = false
    this.interpret(data)
    if (this.inTextObject) throw new Error('PDF import error: unterminated BT text object in appearance stream')
    this.flushPendingText()
    this.stack.length = savedStackLength
    this.resources = savedResources
    this.state = savedState
    this.textState = savedText
    this.path = savedPath
    this.pendingClipRule = savedPendingClipRule
    this.inTextObject = savedInTextObject
  }

  private execute(op: string): void {
    if (this.type3CharProcState !== null) {
      if (this.type3CharProcState.metricsOperator === null && op !== 'd0' && op !== 'd1') {
        throw new Error('PDF import error: a Type3 CharProc must begin with d0 or d1')
      }
      if (this.type3CharProcState.metricsOperator === 'd1' && TYPE3_COLOR_OPERATORS.has(op)) {
        throw new Error(`PDF import error: uncoloured Type3 CharProc declared by d1 cannot use colour operator ${op}`)
      }
    }
    if (this.inTextObject) {
      if (op !== 'ET' && !TEXT_STATE_OPERATORS.has(op) && !TEXT_OBJECT_OPERATORS.has(op) && !TEXT_OBJECT_SHARED_OPERATORS.has(op)) {
        throw new Error(`PDF import error: content operator ${op} is not permitted inside a text object`)
      }
    } else if (TEXT_OBJECT_OPERATORS.has(op) || op === 'ET') {
      throw new Error(`PDF import error: content operator ${op} requires a text object`)
    }
    const arity = PDF_FIXED_CONTENT_OPERATOR_ARITY.get(op)
    if (arity !== undefined && this.operands.length !== arity) {
      throw new Error(`PDF import error: content operator ${op} requires ${arity} operands, got ${this.operands.length}`)
    }
    switch (op) {
      case 'q':
        this.stack.push(copyGraphicsState(this.state))
        this.textStateStack.push(snapshotTextParams(this.textState))
        return
      case 'Q': this.restoreState(); return
      case 'cm': this.concatMatrix(); return
      case 'w': this.state.lineWidth = Math.max(0, this.num(0)); return
      case 'J': this.state.lineCap = lineCap(this.num(0)); return
      case 'j': this.state.lineJoin = lineJoin(this.num(0)); return
      case 'M': this.state.miterLimit = Math.max(1, this.num(0)); return
      case 'd': this.setDash(); return
      case 'ri': this.state.renderingIntent = parseRenderingIntent(this.nameOperand(0)); return
      case 'i': {
        this.state.flatness = Math.max(0, this.num(0))
        return
      }
      case 'gs': this.applyExtGState(); return
      case 'm': this.moveTo(); return
      case 'l': this.lineTo(); return
      case 'c': this.cubicTo(); return
      case 'v': this.cubicV(); return
      case 'y': this.cubicY(); return
      case 'h': this.closePath(); return
      case 're': this.rectanglePath(); return
      case 'f':
      case 'F': this.paint(true, false, 'nonzero'); return
      case 'f*': this.paint(true, false, 'evenodd'); return
      case 'S': this.paint(false, true, 'nonzero'); return
      case 's': this.closePath(); this.paint(false, true, 'nonzero'); return
      case 'B': this.paint(true, true, 'nonzero'); return
      case 'B*': this.paint(true, true, 'evenodd'); return
      case 'b': this.closePath(); this.paint(true, true, 'nonzero'); return
      case 'b*': this.closePath(); this.paint(true, true, 'evenodd'); return
      case 'n': this.finishPathWithoutPaint(); return
      case 'W': this.setClip('nonzero'); return
      case 'W*': this.setClip('evenodd'); return
      case 'g': this.state.fillColorSpace = 'DeviceGray'; this.setDeviceColor(false); return
      case 'G': this.state.strokeColorSpace = 'DeviceGray'; this.setDeviceColor(true); return
      case 'rg': this.state.fillColorSpace = 'DeviceRGB'; this.setDeviceColor(false); return
      case 'RG': this.state.strokeColorSpace = 'DeviceRGB'; this.setDeviceColor(true); return
      case 'k': this.state.fillColorSpace = 'DeviceCMYK'; this.setDeviceColor(false); return
      case 'K': this.state.strokeColorSpace = 'DeviceCMYK'; this.setDeviceColor(true); return
      case 'cs': this.state.fillColorSpace = this.nameOperand(0); return
      case 'CS': this.state.strokeColorSpace = this.nameOperand(0); return
      case 'sc': this.setDeviceColor(false); return
      case 'SC': this.setDeviceColor(true); return
      case 'scn': this.setPatternPaint(false); return
      case 'SCN': this.setPatternPaint(true); return
      case 'sh': this.paintShading(); return
      case 'Do': this.paintXObject(); return
      case 'BMC': this.beginMarkedContent({ optionalContent: null, actualText: null }); return
      case 'BDC': this.beginMarkedContent(this.markedContentDefinition()); return
      case 'EMC': this.endMarkedContent(); return
      case 'MP':
      case 'DP': return
      case 'BX':
        this.compatibilitySectionDepth++
        return
      case 'EX':
        if (this.compatibilitySectionDepth === 0) {
          throw new Error('PDF import error: EX without a matching BX compatibility section')
        }
        this.compatibilitySectionDepth--
        return
      case 'BT':
        this.inTextObject = true
        this.beginText()
        return
      case 'ET':
        this.flushPendingText()
        this.commitTextClip()
        this.inTextObject = false
        return
      case 'Tf': this.setTextFont(); return
      case 'Td': this.moveText(this.num(0), this.num(1)); return
      case 'TD': this.textState.leading = -this.num(1); this.moveText(this.num(0), this.num(1)); return
      case 'Tm': this.setTextMatrix(); return
      case 'T*': this.moveText(0, -this.textState.leading); return
      case 'TL': this.textState.leading = this.num(0); return
      case 'Tc': this.textState.charSpacing = this.num(0); return
      case 'Tw': this.textState.wordSpacing = this.num(0); return
      case 'Tz': this.textState.horizontalScale = this.num(0) / 100; return
      case 'Ts': this.textState.rise = this.num(0); return
      case 'Tr': {
        const mode = this.num(0)
        if (!Number.isInteger(mode) || mode < 0 || mode > 7) throw new Error('PDF import error: Tr rendering mode must be an integer from 0 to 7')
        this.textState.renderMode = mode
        return
      }
      case 'Tj': this.showTextValue(this.operands[0] ?? null); return
      case 'TJ': this.showTextArray(); return
      case 'd0': this.declareType3GlyphMetrics('d0'); return
      case 'd1': this.declareType3GlyphMetrics('d1'); return
      case '\'': this.moveText(0, -this.textState.leading); this.showTextValue(this.operands[0] ?? null); return
      case '"':
        this.textState.wordSpacing = this.num(0)
        this.textState.charSpacing = this.num(1)
        this.moveText(0, -this.textState.leading)
        this.showTextValue(this.operands[2] ?? null)
        return
      default:
        if (this.compatibilitySectionDepth > 0) return
        throw new Error(`PDF import error: unsupported content operator ${op}`)
    }
  }

  private declareType3GlyphMetrics(operator: 'd0' | 'd1'): void {
    if (this.type3CharProcState === null) {
      throw new Error(`PDF import error: ${operator} is only valid in a Type3 CharProc`)
    }
    if (this.type3CharProcState.metricsOperator !== null) {
      throw new Error('PDF import error: a Type3 CharProc may declare d0 or d1 only once')
    }
    this.type3CharProcState.metricsOperator = operator
  }

  private restoreState(): void {
    const state = this.stack.pop()
    if (!state) throw new Error('PDF import error: graphics state stack underflow')
    this.state = state
    // The text parameters (font, size, spacing, render mode, rise) are part of
    // the graphics state and are restored by Q; Tm/Tlm are not (PDF 9.3.1)
    const textParams = this.textStateStack.pop()
    if (textParams !== undefined) restoreTextParams(this.textState, textParams)
    // A real soft mask set inside this q-scope is cleared as the scope exits.
    if (this.activeSoftMaskCapture !== null && this.stack.length < this.activeSoftMaskCapture.stackDepth) {
      this.finalizeSoftMaskCapture()
    }
    if (this.activeDeviceParamsCapture !== null && this.stack.length < this.activeDeviceParamsCapture.stackDepth) {
      this.finalizeDeviceParamsCapture()
      if (this.state.deviceParams !== null) this.beginDeviceParamsCapture(this.state.deviceParams)
    }
  }

  private concatMatrix(): void {
    const m: Matrix = [this.num(0), this.num(1), this.num(2), this.num(3), this.num(4), this.num(5)]
    this.state.ctm = multiplyMatrix(this.state.ctm, m)
  }

  private setDash(): void {
    const arr = this.resolve(this.operands[0] ?? null)
    if (!Array.isArray(arr)) throw new Error('PDF import error: dash pattern must be an array')
    const dash: number[] = []
    for (let i = 0; i < arr.length; i++) {
      const v = this.resolve(arr[i]!)
      if (typeof v !== 'number') throw new Error('PDF import error: dash array must contain numbers')
      if (v < 0) throw new Error('PDF import error: dash array values must be non-negative')
      dash.push(v)
    }
    if (dash.length > 0 && dash.every(function (value) { return value === 0 })) {
      throw new Error('PDF import error: dash array values must not all be zero')
    }
    this.state.dashArray = dash
    this.state.dashOffset = this.num(1)
  }

  private applyExtGState(): void {
    const name = this.nameOperand(0)
    const ext = this.plainDictResource('ExtGState', name)
    const lw = this.resolve(ext.get('LW') ?? null)
    if (typeof lw === 'number') this.state.lineWidth = Math.max(0, lw)
    const lc = this.resolve(ext.get('LC') ?? null)
    if (typeof lc === 'number') this.state.lineCap = lineCap(lc)
    const lj = this.resolve(ext.get('LJ') ?? null)
    if (typeof lj === 'number') this.state.lineJoin = lineJoin(lj)
    const ml = this.resolve(ext.get('ML') ?? null)
    if (typeof ml === 'number') this.state.miterLimit = Math.max(1, ml)
    const ca = this.resolve(ext.get('ca') ?? null)
    if (typeof ca === 'number') this.state.fillOpacity = ca
    const CA = this.resolve(ext.get('CA') ?? null)
    if (typeof CA === 'number') this.state.strokeOpacity = CA
    const bm = this.resolve(ext.get('BM') ?? null)
    if (bm !== null) this.state.blendMode = parseBlendMode(bm)
    const fillOverprint = this.resolve(ext.get('op') ?? null)
    if (typeof fillOverprint === 'boolean') this.state.fillOverprint = fillOverprint
    const strokeOverprint = this.resolve(ext.get('OP') ?? null)
    if (typeof strokeOverprint === 'boolean') this.state.strokeOverprint = strokeOverprint
    const overprintMode = this.resolve(ext.get('OPM') ?? null)
    if (typeof overprintMode === 'number') this.state.overprintMode = parseOverprintMode(overprintMode)
    const renderingIntent = this.resolve(ext.get('RI') ?? null)
    if (renderingIntent instanceof PdfName) this.state.renderingIntent = parseRenderingIntent(renderingIntent.name)
    const softMask = this.resolve(ext.get('SMask') ?? null)
    if (softMask !== null) this.applyExtGStateSoftMask(softMask)
    const alphaIsShape = this.resolve(ext.get('AIS') ?? null)
    if (alphaIsShape !== null) {
      if (typeof alphaIsShape !== 'boolean') throw new Error('PDF import error: ExtGState /AIS must be boolean')
      this.state.alphaIsShape = alphaIsShape
    }
    const textKnockout = this.resolve(ext.get('TK') ?? null)
    if (textKnockout !== null) {
      if (typeof textKnockout !== 'boolean') throw new Error('PDF import error: ExtGState /TK must be boolean')
      if (this.inTextObject) throw new Error('PDF import error: ExtGState /TK may not be set inside a text object')
      this.state.textKnockout = textKnockout
    }
    const deviceParams = this.readDeviceParams(ext)
    if (deviceParams !== null) this.setDeviceParams(deviceParams)
    const d = this.resolve(ext.get('D') ?? null)
    if (Array.isArray(d) && Array.isArray(this.resolve(d[0] ?? null))) {
      const values = this.resolve(d[0]!) as PdfValue[]
      const dash: number[] = []
      for (let i = 0; i < values.length; i++) {
        const v = this.resolve(values[i]!)
        if (typeof v !== 'number') throw new Error('PDF import error: ExtGState dash array must contain numbers')
        if (v < 0) throw new Error('PDF import error: ExtGState dash array values must be non-negative')
        dash.push(v)
      }
      if (dash.length > 0 && dash.every(function (value) { return value === 0 })) {
        throw new Error('PDF import error: ExtGState dash array values must not all be zero')
      }
      this.state.dashArray = dash
      const phase = this.resolve(d[1] ?? null)
      if (typeof phase === 'number') this.state.dashOffset = phase
    }
  }

  private setFillColor(color: string, colorSpace: string | null = null): void {
    this.state.fillColor = color
    this.state.fillPaint = color
    this.state.fillColorSpace = colorSpace
  }

  private setStrokeColor(color: string, colorSpace: string | null = null): void {
    this.state.strokeColor = color
    this.state.strokePaint = color
    this.state.strokeColorSpace = colorSpace
  }

  private setDeviceColor(stroke: boolean): void {
    const colorSpaceName = stroke ? this.state.strokeColorSpace : this.state.fillColorSpace
    const colorSpace = this.currentColorSpace(stroke)
    const count = pdfColorSpaceComponents(colorSpace)
    this.requireOperandCount(count, stroke ? 'SC' : 'sc')
    const components: number[] = []
    for (let i = 0; i < count; i++) components.push(this.num(i))
    const normalized = normalizeContentColorComponents(colorSpace, components)
    const intent = this.state.renderingIntent ?? 'RelativeColorimetric'
    const blackPointCompensation = this.state.deviceParams?.useBlackPointCompensation === 'on'
    const color = pdfColorToHex(this.doc, colorSpace, normalized, intent, blackPointCompensation, this.deviceCmykTransform)
    const paint = pdfSpecialColorDef(this.doc, colorSpace, normalized, intent, blackPointCompensation, this.deviceCmykTransform) ?? color
    if (stroke) {
      this.state.strokeColor = color
      this.state.strokePaint = paint
      this.state.strokeColorSpace = colorSpaceName
    } else {
      this.state.fillColor = color
      this.state.fillPaint = paint
      this.state.fillColorSpace = colorSpaceName
    }
  }

  private setPatternPaint(stroke: boolean): void {
    const colorSpace = this.currentColorSpace(stroke)
    if (colorSpace.kind !== 'pattern') {
      this.setDeviceColor(stroke)
      return
    }
    const patternName = this.nameOperand(this.operands.length - 1)
    const componentCount = colorSpace.base === null ? 0 : pdfColorSpaceComponents(colorSpace.base)
    this.requireOperandCount(componentCount + 1, stroke ? 'SCN' : 'scn')
    const components: number[] = []
    for (let i = 0; i < this.operands.length - 1; i++) {
      const value = this.resolve(this.operands[i]!)
      if (typeof value === 'number') components.push(value)
    }
    const uncoloredHex = colorSpace.base === null
      ? null
      : colorArrayToHexIn(this.doc, colorSpace.base, normalizeContentColorComponents(colorSpace.base, components), this.deviceCmykTransform)
    const paint = this.gradientPaintFromPattern(patternName, uncoloredHex)
    if (stroke) this.state.strokePaint = paint
    else this.state.fillPaint = paint
  }

  private currentColorSpace(stroke: boolean) {
    const name = stroke ? this.state.strokeColorSpace : this.state.fillColorSpace
    if (name === null) throw new Error('PDF import error: color space must be selected before sc/SC')
    return parsePdfColorSpace(this.doc, new PdfName(name), this.resources)
  }

  private moveTo(): void {
    const p = this.point(this.num(0), this.num(1))
    this.path.commands.push(0)
    this.path.coords.push(p[0], p[1])
    this.path.currentX = p[0]
    this.path.currentY = p[1]
    this.path.startX = p[0]
    this.path.startY = p[1]
  }

  private lineTo(): void {
    const p = this.point(this.num(0), this.num(1))
    this.path.commands.push(1)
    this.path.coords.push(p[0], p[1])
    this.path.currentX = p[0]
    this.path.currentY = p[1]
  }

  private cubicTo(): void {
    const p1 = this.point(this.num(0), this.num(1))
    const p2 = this.point(this.num(2), this.num(3))
    const p3 = this.point(this.num(4), this.num(5))
    this.path.commands.push(2)
    this.path.coords.push(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1])
    this.path.currentX = p3[0]
    this.path.currentY = p3[1]
  }

  private cubicV(): void {
    const p2 = this.point(this.num(0), this.num(1))
    const p3 = this.point(this.num(2), this.num(3))
    this.path.commands.push(2)
    this.path.coords.push(this.path.currentX, this.path.currentY, p2[0], p2[1], p3[0], p3[1])
    this.path.currentX = p3[0]
    this.path.currentY = p3[1]
  }

  private cubicY(): void {
    const p1 = this.point(this.num(0), this.num(1))
    const p3 = this.point(this.num(2), this.num(3))
    this.path.commands.push(2)
    this.path.coords.push(p1[0], p1[1], p3[0], p3[1], p3[0], p3[1])
    this.path.currentX = p3[0]
    this.path.currentY = p3[1]
  }

  private closePath(): void {
    if (this.path.commands.length === 0) return
    this.path.commands.push(3)
    this.path.currentX = this.path.startX
    this.path.currentY = this.path.startY
  }

  private rectanglePath(): void {
    const x = this.num(0)
    const y = this.num(1)
    const w = this.num(2)
    const h = this.num(3)
    this.appendMovePoint(x, y)
    this.appendLinePoint(x + w, y)
    this.appendLinePoint(x + w, y + h)
    this.appendLinePoint(x, y + h)
    this.closePath()
  }

  private appendMovePoint(x: number, y: number): void {
    const p = this.point(x, y)
    this.path.commands.push(0)
    this.path.coords.push(p[0], p[1])
    this.path.currentX = p[0]
    this.path.currentY = p[1]
    this.path.startX = p[0]
    this.path.startY = p[1]
  }

  private appendLinePoint(x: number, y: number): void {
    const p = this.point(x, y)
    this.path.commands.push(1)
    this.path.coords.push(p[0], p[1])
    this.path.currentX = p[0]
    this.path.currentY = p[1]
  }

  private setClip(fillRule: 'nonzero' | 'evenodd'): void {
    this.pendingClipRule = fillRule
  }

  private applyPendingClip(): void {
    if (this.pendingClipRule === null) return
    if (this.path.commands.length === 0) {
      this.state.clipIsEmpty = true
      this.state.clips = []
    } else if (!this.state.clipIsEmpty) {
      this.addClipRegion(this.path.commands, this.path.coords, this.pendingClipRule)
    }
    this.pendingClipRule = null
  }

  private finishPathWithoutPaint(): void {
    this.applyPendingClip()
    this.path = createPath()
  }

  private clipCurrentSpaceRect(x1: number, y1: number, x2: number, y2: number): void {
    const p0 = this.point(x1, y1)
    const p1 = this.point(x2, y1)
    const p2 = this.point(x2, y2)
    const p3 = this.point(x1, y2)
    this.addClipRegion(
      [0, 1, 1, 1, 3],
      [p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]],
      'nonzero',
    )
  }

  private addClipRegion(commands: number[], coords: number[], fillRule: 'nonzero' | 'evenodd'): void {
    const bounds = pathBounds(coords)
    const region: ClipRegion = {
      key: 'c' + this.clipCounter++,
      commands: new Uint8Array(commands),
      coords: new Float32Array(coords),
      fillRule,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isRect: pathIsAxisAlignedRect(commands, coords, bounds),
    }
    // A rectangular clip nested inside a larger rectangular clip fully replaces it
    const clips = this.state.clips.filter(function (existing) {
      return !(region.isRect && existing.isRect && rectContainsRect(existing, region))
    })
    clips.push(region)
    this.state.clips = clips
  }

  private paint(fill: boolean, stroke: boolean, fillRule: 'nonzero' | 'evenodd'): void {
    this.applyPendingClip()
    if (this.path.commands.length === 0) {
      this.path = createPath()
      return
    }
    const element = this.createPathElement(fill, stroke, fillRule)
    this.pushElement(element)
    this.path = createPath()
  }

  private pushElement(element: ElementDef): void {
    this.flushPendingText()
    if (!this.isContentVisible() || this.state.clipIsEmpty) return
    this.pushWithClips(element, this.activeClips(element))
  }

  /** Clips that actually cut into the element bbox. Rectangular clips fully containing the element are dropped. */
  private activeClips(element: { x: number, y: number, width: number, height: number }): ClipRegion[] {
    const clips = this.state.clips
    if (clips.length === 0) return clips
    const active: ClipRegion[] = []
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]!
      if (clip.isRect && rectContainsRect(clip, element)) continue
      active.push(clip)
    }
    return active
  }

  private pushWithClips(element: ElementDef, clips: ClipRegion[]): void {
    if (clips.length === 0) {
      this.lastClipWrap = null
      this.elements.push(element)
      return
    }
    const clipKey = clipListKey(clips)
    if (this.lastClipWrap !== null && this.lastClipWrap.clipKey === clipKey) {
      element.x -= this.lastClipWrap.originX
      element.y -= this.lastClipWrap.originY
      this.lastClipWrap.frame.elements!.push(element)
      return
    }
    // Wrap from the innermost clip outwards. Element coordinates are in page
    // space at each step and become local to the enclosing frame.
    let current: ElementDef = element
    let innerFrame: FrameDef | null = null
    for (let i = clips.length - 1; i >= 0; i--) {
      const clip = clips[i]!
      current.x -= clip.x
      current.y -= clip.y
      const frame: FrameDef = {
        type: 'frame',
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height,
        clipPath: { d: buildSvgPathD(clip.commands, translateCoords(clip.coords, -clip.x, -clip.y)), fillRule: clip.fillRule },
        elements: [current],
      }
      if (innerFrame === null) innerFrame = frame
      current = frame
    }
    this.lastClipWrap = {
      clipKey,
      frame: innerFrame!,
      originX: clips[clips.length - 1]!.x,
      originY: clips[clips.length - 1]!.y,
    }
    this.elements.push(current)
  }

  private createPathElement(fill: boolean, stroke: boolean, fillRule: 'nonzero' | 'evenodd'): PathDef {
    const bounds = pathBounds(this.path.coords)
    const preserveStrokeTransform = stroke
      && typeof this.state.strokePaint === 'string'
      && (!fill || typeof this.state.fillPaint === 'string')
    const strokeMatrix = pdfUserToPageMatrix(this.state.ctm, this.pageHeight)
    const inverse = preserveStrokeTransform ? invertMatrix(strokeMatrix) : null
    const local = new Float32Array(this.path.coords.length)
    for (let i = 0; i < this.path.coords.length; i += 2) {
      if (inverse === null) {
        local[i] = this.path.coords[i]! - bounds.x
        local[i + 1] = this.path.coords[i + 1]! - bounds.y
      } else {
        const point = transformPoint(inverse, this.path.coords[i]!, this.path.coords[i + 1]!)
        local[i] = point[0]
        local[i + 1] = point[1]
      }
    }
    const commands = new Uint8Array(this.path.commands)
    const element: PathDef = {
      type: 'path',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      d: buildSvgPathD(commands, local),
    }
    if (inverse !== null) {
      element.affineTransform = [
        strokeMatrix[0], strokeMatrix[1], strokeMatrix[2], strokeMatrix[3],
        strokeMatrix[4] - bounds.x, strokeMatrix[5] - bounds.y,
      ]
    }
    if (fill) {
      element.fill = normalizePaint(this.state.fillPaint, bounds)
      element.fillRule = fillRule
      const fillOpacity = this.effectiveFillOpacity()
      if (fillOpacity !== 1) element.fillOpacity = fillOpacity
    }
    if (stroke) {
      element.stroke = normalizePaint(this.state.strokePaint, bounds)
      element.strokeWidth = this.state.lineWidth
      const strokeOpacity = this.effectiveStrokeOpacity()
      if (strokeOpacity !== 1) element.strokeOpacity = strokeOpacity
      element.strokeLinecap = this.state.lineCap
      element.strokeLinejoin = this.state.lineJoin
      element.strokeMiterLimit = this.state.miterLimit
      if (this.state.dashArray.length > 0) element.strokeDasharray = this.state.dashArray.slice()
      if (this.state.dashOffset !== 0) element.strokeDashoffset = this.state.dashOffset
    }
    this.applyGraphicsStateFlags(element, fill, stroke)
    return element
  }

  private beginText(): void {
    this.textState.textMatrix = [1, 0, 0, 1, 0, 0]
    this.textState.lineMatrix = [1, 0, 0, 1, 0, 0]
    this.pendingTextClip.commands.length = 0
    this.pendingTextClip.coords.length = 0
    this.pendingTextClip.requested = false
  }

  private setTextFont(): void {
    const fontName = this.nameOperand(0)
    this.textState.fontSize = this.num(1)
    const raw = this.resourceValue('Font', fontName)
    const fontDict = this.resolve(raw)
    if (!(fontDict instanceof Map)) throw new Error('PDF import error: font resource must be a dictionary')
    let decoder = this.fontCache.get(fontDict)
    if (!decoder) {
      decoder = createFontDecoder(this.doc, fontDict, this.fontResolver)
      this.fontCache.set(fontDict, decoder)
    }
    this.textState.font = decoder
    const infoKey = decoder.info.baseFont + '|' + decoder.info.subtype
    if (!this.usedFonts.has(infoKey)) this.usedFonts.set(infoKey, decoder.info)
  }

  private setTextMatrix(): void {
    const matrix: Matrix = [this.num(0), this.num(1), this.num(2), this.num(3), this.num(4), this.num(5)]
    this.textState.textMatrix = matrix
    this.textState.lineMatrix = matrix
  }

  private moveText(tx: number, ty: number): void {
    const translated = multiplyMatrix(this.textState.lineMatrix, [1, 0, 0, 1, tx, ty])
    this.textState.lineMatrix = translated
    this.textState.textMatrix = translated
  }

  private showTextArray(): void {
    const array = this.resolve(this.operands[0] ?? null)
    if (!Array.isArray(array)) throw new Error('PDF import error: TJ operand must be an array')
    if (!this.textState.font) throw new Error('PDF import error: text shown before Tf')
    if (this.textState.font.type3 !== null) {
      const segments: Array<Uint8Array | number> = []
      for (let i = 0; i < array.length; i++) {
        const value = this.resolve(array[i]!)
        if (value instanceof PdfString) segments.push(value.bytes)
        else if (typeof value === 'number') segments.push(value)
        else throw new Error('PDF import error: TJ array must contain strings and numbers')
      }
      this.emitType3Text(segments)
      return
    }
    if (this.textState.font.outlineOnly || this.outlineText) {
      if (!this.textState.font.hasGlyphOutlines) throw new Error('PDF import error: outlining text requires an embedded or resolved font program')
      const segments: Array<Uint8Array | number> = []
      for (let i = 0; i < array.length; i++) {
        const value = this.resolve(array[i]!)
        if (value instanceof PdfString) segments.push(value.bytes)
        else if (typeof value === 'number') segments.push(value)
        else throw new Error('PDF import error: TJ array must contain strings and numbers')
      }
      this.emitOutlineText(segments)
      return
    }
    // Process items sequentially: strings emit runs and numeric adjustments
    // move the pen, so large gaps naturally split into separate elements
    for (let i = 0; i < array.length; i++) {
      const value = this.resolve(array[i]!)
      if (value instanceof PdfString) {
        this.showSegmentedBytes(value.bytes)
      } else if (typeof value === 'number') {
        // PDF 9.4.3: the adjustment applies to the writing direction
        if (this.textState.font.vertical) this.advanceTextVertical(-value / 1000 * this.textState.fontSize)
        else this.advanceText(-value / 1000 * this.textState.fontSize * this.textState.horizontalScale)
      }
      else throw new Error('PDF import error: TJ array must contain strings and numbers')
    }
  }

  /**
   * Emits a show-text byte string, splitting at anomalously wide space
   * glyphs (>1em advance). Form writers align separate fields on one line
   * with such spaces; keeping them in one run would fuse the fields.
   */
  private showSegmentedBytes(bytes: Uint8Array): void {
    const font = this.textState.font!
    this.appendTextClipBytes(bytes)
    if (font.vertical) {
      if (bytes.length > 0) {
        const metrics = font.metrics(bytes)
        this.emitVerticalText(font.decode(bytes), font.verticalAdvance(bytes), metrics.glyphs)
      }
      return
    }
    const codes = font.codes(bytes)
    let segmentStart = 0
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!
      const slice = bytes.subarray(code.start, code.end)
      if (font.decode(slice) !== ' ') continue
      const advance = font.metrics(slice).units
      if (advance <= 1000) continue
      const segment = bytes.subarray(segmentStart, code.start)
      if (segment.length > 0) {
        const metrics = font.metrics(segment)
        this.emitText(font.decode(segment), metrics.units, metrics.glyphs, metrics.spaces)
      }
      // Word spacing applies only to a one-byte character code 32.
      const wordSpace = code.length === 1 && code.code === 0x20 ? this.textState.wordSpacing : 0
      this.advanceText(advance / 1000 * this.textState.fontSize * this.textState.horizontalScale
        + (this.textState.charSpacing + wordSpace) * this.textState.horizontalScale)
      segmentStart = code.end
    }
    const tail = bytes.subarray(segmentStart)
    if (tail.length > 0) {
      const metrics = font.metrics(tail)
      this.emitText(font.decode(tail), metrics.units, metrics.glyphs, metrics.spaces)
    }
  }

  private showTextValue(value: PdfValue): void {
    const resolved = this.resolve(value)
    if (!(resolved instanceof PdfString)) throw new Error('PDF import error: Tj operand must be a string')
    if (!this.textState.font) throw new Error('PDF import error: text shown before Tf')
    if (this.textState.font.type3 !== null) {
      this.emitType3Text([resolved.bytes])
      return
    }
    if (this.textState.font.outlineOnly || this.outlineText) {
      if (!this.textState.font.hasGlyphOutlines) throw new Error('PDF import error: outlining text requires an embedded or resolved font program')
      this.emitOutlineText([resolved.bytes])
      return
    }
    this.showSegmentedBytes(resolved.bytes)
  }

  private emitType3Text(segments: Array<Uint8Array | number>): void {
    const ts = this.textState
    if (!ts.font || ts.font.type3 === null) throw new Error('PDF import error: Type3 text shown without Type3 font')
    this.flushPendingText()
    // PDF text rendering mode does not affect Type 3 glyph descriptions. The
    // CharProc's own graphics operators determine both paint and clipping.
    const invisible = !this.isContentVisible()
    const m = multiplyMatrix(this.state.ctm, ts.textMatrix)
    let penX = 0
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s]!
      if (typeof segment === 'number') {
        penX -= segment / 1000 * ts.fontSize * ts.horizontalScale
        continue
      }
      for (let i = 0; i < segment.length; i++) {
        const code = segment[i]!
        const metrics = ts.font.metrics(segment.subarray(i, i + 1))
        if (!invisible) {
          const textRenderingMatrix: Matrix = [ts.fontSize * ts.horizontalScale, 0, 0, ts.fontSize, penX, ts.rise]
          const glyphMatrix = multiplyMatrix(multiplyMatrix(m, textRenderingMatrix), ts.font.type3.fontMatrix)
          const charProc = ts.font.type3.charProc(code)
          if (charProc !== null) this.interpretType3CharProc(charProc, ts.font.type3.resources, glyphMatrix)
        }
        const wordSpace = code === 0x20 ? ts.wordSpacing : 0
        penX += (metrics.units / 1000 * ts.fontSize + ts.charSpacing + wordSpace) * ts.horizontalScale
      }
    }
    this.advanceText(penX)
  }

  private interpretType3CharProc(charProc: PdfStream, resources: PdfDict | null, matrix: Matrix): void {
    const savedResources = this.resources
    const savedState = this.state
    const savedText = this.textState
    const savedPath = this.path
    const savedOperands = this.operands.slice()
    const savedStackLength = this.stack.length
    const savedTextStackLength = this.textStateStack.length
    const savedInTextObject = this.inTextObject
    const savedType3CharProcState = this.type3CharProcState
    if (resources !== null) this.resources = resources
    this.state = copyGraphicsState(savedState)
    this.state.ctm = matrix
    this.textState = createTextState()
    this.path = createPath()
    this.operands.length = 0
    this.inTextObject = false
    this.type3CharProcState = { metricsOperator: null }
    this.interpret(this.doc.decodeStream(charProc))
    if (this.type3CharProcState.metricsOperator === null) {
      throw new Error('PDF import error: a Type3 CharProc must declare d0 or d1')
    }
    if (this.inTextObject) throw new Error('PDF import error: unterminated BT text object in Type3 CharProc')
    this.flushPendingText()
    this.stack.length = savedStackLength
    this.textStateStack.length = savedTextStackLength
    this.operands.length = 0
    for (let i = 0; i < savedOperands.length; i++) this.operands.push(savedOperands[i]!)
    this.resources = savedResources
    this.state = savedState
    this.textState = savedText
    this.path = savedPath
    this.inTextObject = savedInTextObject
    this.type3CharProcState = savedType3CharProcState
  }

  /**
   * Imports a show-text run of an outline-only font (CID-keyed CFF without
   * any Unicode mapping) as one vector path element per run.
   */
  private emitOutlineText(segments: Array<Uint8Array | number>): void {
    const ts = this.textState
    if (!ts.font) throw new Error('PDF import error: text shown before Tf')
    this.flushPendingText()
    const invisible = !this.isContentVisible() || (ts.renderMode === 3 && !this.includeInvisibleText) || ts.renderMode === 7
    const m = multiplyMatrix(this.state.ctm, ts.textMatrix)
    const commands: number[] = []
    const coords: number[] = []
    const sourceDefinitions: Array<{ commands: number[], coords: number[] }> = []
    const sourceInstances: Array<{ definitionIndex: number, matrix: Matrix }> = []
    const sourceDefinitionByCid = new Map<number, number>()
    const sourceBacked = ts.renderMode === 0 && !invisible
    const outlinePpem = this.outlinePpem(m)
    const vertical = ts.font.vertical
    // penX/penY accumulate the text-space displacement (em-scaled pt). Vertical
    // writing advances penY downward; horizontal advances penX.
    let penX = 0
    let penY = 0
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s]!
      if (typeof segment === 'number') {
        if (vertical) penY -= segment / 1000 * ts.fontSize
        else penX -= segment / 1000 * ts.fontSize * ts.horizontalScale
        continue
      }
      const codes = ts.font.codes(segment)
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]!
        const cid = ts.font.cid(code)
        const codeBytes = segment.subarray(code.start, code.end)
        const metrics = ts.font.metrics(codeBytes)
        if (vertical) {
          const verticalMetrics = ts.font.verticalGlyphMetrics(code)
          if (!invisible || ts.renderMode >= 4) {
            const offX = -verticalMetrics.vx / 1000 * ts.fontSize
            const offY = -verticalMetrics.vy / 1000 * ts.fontSize
            const outline = ts.font.glyphOutline(cid, outlinePpem)
            this.appendGlyphOutline(commands, coords, outline, m, penX + offX, penY + offY)
            if (sourceBacked) {
              const definitionIndex = sourceVectorDefinition(sourceDefinitions, sourceDefinitionByCid, cid, outline)
              sourceInstances.push({
                definitionIndex,
                matrix: sourceGlyphMatrix(m, this.pageHeight, ts.fontSize / 1000 * ts.horizontalScale, ts.fontSize / 1000, penX + offX, ts.rise + penY + offY),
              })
            }
          }
          // Vertical displacement ty = (w1/1000)*Tfs + Tc (PDF 9.4.4); Tw applies
          // only to single-byte code 32, which never occurs in 2-byte Type0
          penY += verticalMetrics.w1 / 1000 * ts.fontSize + ts.charSpacing
        } else {
          if (!invisible || ts.renderMode >= 4) {
            const outline = ts.font.glyphOutline(cid, outlinePpem)
            this.appendGlyphOutline(commands, coords, outline, m, penX, penY)
            if (sourceBacked) {
              const definitionIndex = sourceVectorDefinition(sourceDefinitions, sourceDefinitionByCid, cid, outline)
              sourceInstances.push({
                definitionIndex,
                matrix: sourceGlyphMatrix(m, this.pageHeight, ts.fontSize / 1000 * ts.horizontalScale, ts.fontSize / 1000, penX, ts.rise + penY),
              })
            }
          }
          penX += (metrics.units / 1000 * ts.fontSize + ts.charSpacing) * ts.horizontalScale
        }
      }
    }
    if (ts.renderMode >= 4) this.appendPendingTextClip(commands, coords)
    if (!invisible && commands.length > 0) {
      const bounds = pathBounds(coords)
      const local = new Float32Array(coords.length)
      for (let i = 0; i < coords.length; i += 2) {
        local[i] = coords[i]! - bounds.x
        local[i + 1] = coords[i + 1]! - bounds.y
      }
      const element: PathDef = {
        type: 'path',
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        d: buildSvgPathD(new Uint8Array(commands), local),
        fillRule: 'nonzero',
      }
      if (sourceBacked) {
        element.pdfSourceVector = {
          definitions: sourceDefinitions,
          instances: sourceInstances.map(function (instance) {
            const matrix = instance.matrix
            return {
              definitionIndex: instance.definitionIndex,
              matrix: [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4] - bounds.x, matrix[5] - bounds.y],
            }
          }),
        }
      }
      if (textModeFills(ts.renderMode)) {
        element.fill = this.state.fillColor
        const fillOpacity = this.effectiveFillOpacity()
        if (fillOpacity !== 1) element.fillOpacity = fillOpacity
      }
      if (textModeStrokes(ts.renderMode)) {
        element.stroke = this.state.strokeColor
        element.strokeWidth = this.state.lineWidth
        const strokeOpacity = this.effectiveStrokeOpacity()
        if (strokeOpacity !== 1) element.strokeOpacity = strokeOpacity
      }
      this.applyGraphicsStateFlags(element, textModeFills(ts.renderMode), textModeStrokes(ts.renderMode))
      this.pushElement(element)
    }
    // Advance the text matrix by the total run displacement for the next run.
    if (vertical) this.textState.textMatrix = multiplyMatrix(this.textState.textMatrix, [1, 0, 0, 1, 0, penY])
    else this.advanceText(penX)
  }

  private appendTextClipBytes(bytes: Uint8Array): void {
    const ts = this.textState
    if (ts.renderMode < 4) return
    this.pendingTextClip.requested = true
    if (bytes.length === 0) return
    if (ts.font === null || !ts.font.hasGlyphOutlines) {
      throw new Error('PDF import error: text clipping requires an embedded font program or PdfImportOptions.fontResolver')
    }
    const m = multiplyMatrix(this.state.ctm, ts.textMatrix)
    const commands: number[] = []
    const coords: number[] = []
    let penX = 0
    let penY = 0
    for (const code of ts.font.codes(bytes)) {
      const codeBytes = bytes.subarray(code.start, code.end)
      const cid = ts.font.cid(code)
      if (ts.font.vertical) {
        const verticalMetrics = ts.font.verticalGlyphMetrics(code)
        const offX = -verticalMetrics.vx / 1000 * ts.fontSize
        const offY = -verticalMetrics.vy / 1000 * ts.fontSize
        this.appendGlyphOutline(commands, coords, ts.font.glyphOutline(cid, this.outlinePpem(m)), m, penX + offX, penY + offY)
        const wordSpace = code.length === 1 && code.code === 0x20 ? ts.wordSpacing : 0
        penY += verticalMetrics.w1 / 1000 * ts.fontSize + ts.charSpacing + wordSpace
      } else {
        this.appendGlyphOutline(commands, coords, ts.font.glyphOutline(cid, this.outlinePpem(m)), m, penX, penY)
        const metrics = ts.font.metrics(codeBytes)
        const wordSpace = code.length === 1 && code.code === 0x20 ? ts.wordSpacing : 0
        penX += (metrics.units / 1000 * ts.fontSize + ts.charSpacing + wordSpace) * ts.horizontalScale
      }
    }
    this.appendPendingTextClip(commands, coords)
  }

  private appendPendingTextClip(commands: number[], coords: number[]): void {
    this.pendingTextClip.requested = true
    for (let i = 0; i < commands.length; i++) this.pendingTextClip.commands.push(commands[i]!)
    for (let i = 0; i < coords.length; i++) this.pendingTextClip.coords.push(coords[i]!)
  }

  private commitTextClip(): void {
    if (!this.pendingTextClip.requested) return
    if (this.pendingTextClip.commands.length === 0) {
      this.state.clips = []
      this.state.clipIsEmpty = true
    } else if (!this.state.clipIsEmpty) {
      this.addClipRegion(this.pendingTextClip.commands, this.pendingTextClip.coords, 'nonzero')
    }
    this.pendingTextClip.commands.length = 0
    this.pendingTextClip.coords.length = 0
    this.pendingTextClip.requested = false
  }

  /** Transforms one glyph outline from 1/1000 em glyph space into page coordinates. */
  private appendGlyphOutline(commands: number[], coords: number[], outline: { commands: Uint8Array, coords: Float32Array }, m: Matrix, penX: number, penY: number): void {
    const ts = this.textState
    const scaleX = ts.fontSize / 1000 * ts.horizontalScale
    const scaleY = ts.fontSize / 1000
    for (let i = 0; i < outline.commands.length; i++) commands.push(outline.commands[i]!)
    for (let i = 0; i < outline.coords.length; i += 2) {
      const tx = penX + outline.coords[i]! * scaleX
      const ty = ts.rise + penY + outline.coords[i + 1]! * scaleY
      const p = transformPoint(m, tx, ty)
      coords.push(p[0], this.pageHeight - p[1])
    }
  }

  private outlinePpem(textToPage: Matrix): number | undefined {
    if (this.outlineDpi === undefined) return undefined
    const yScale = Math.sqrt(textToPage[2] * textToPage[2] + textToPage[3] * textToPage[3])
    const ppem = Math.abs(this.textState.fontSize) * yScale * this.outlineDpi / 72
    if (!Number.isFinite(ppem) || ppem <= 0) throw new Error('PDF import text transform produces an invalid Type 1 target ppem')
    return ppem
  }

  private decodeText(value: PdfString): string {
    if (!this.textState.font) throw new Error('PDF import error: text shown before Tf')
    return this.textState.font.decode(value.bytes)
  }

  private emitText(text: string, units: number, glyphs: number, spaces: number): void {
    const ts = this.textState
    if (!ts.font) throw new Error('PDF import error: text shown before Tf')
    // Advance in unscaled text space (PDF 9.4.4). Applied to the text matrix
    // even when the run produces no visible element.
    const advance = (units / 1000 * ts.fontSize + ts.charSpacing * glyphs + ts.wordSpacing * spaces) * ts.horizontalScale
    if (text.length === 0 || !this.isContentVisible() || (ts.renderMode === 3 && !this.includeInvisibleText) || ts.renderMode === 7) {
      this.advanceText(advance)
      return
    }
    // Text render modes: 0/4 fill, 1/5 stroke, 2/6 fill+stroke, 3 invisible, 7 clip only.
    // Stroke-only text keeps the stroke color as its visible color.
    const color = ts.renderMode === 1 || ts.renderMode === 5 ? this.state.strokeColor : this.state.fillColor
    // Effective glyph scale comes from the combined text and current
    // transformation matrices, not from the Tf size alone.
    const m = multiplyMatrix(this.state.ctm, ts.textMatrix)
    const scaleX = Math.hypot(m[0], m[1])
    const scaleY = Math.hypot(m[2], m[3])
    const fontSize = Math.abs(ts.fontSize) * scaleY
    const width = Math.abs(advance) * scaleX
    const rotation = textAxisRotation(m)
    const origin = transformPoint(m, 0, ts.rise)
    const ox = origin[0]
    const oy = this.pageHeight - origin[1]
    const styleName = this.registerTextStyle(ts.font, fontSize)
    const element: StaticTextDef = {
      type: 'staticText',
      x: ox,
      y: oy - fontSize,
      width,
      height: fontSize * 1.2,
      text,
      forecolor: color,
      style: styleName,
      wrap: false,
      baselineOffset: fontSize,
    }
    this.applyTextPaintMode(element, ts.renderMode)
    this.applyMarkedContentActualText(element)
    this.applyGraphicsStateFlags(element, textModeFills(ts.renderMode), textModeStrokes(ts.renderMode))
    if (rotation !== null && rotation !== 0) {
      element.rotation = rotation
      applyRotatedTextBounds(element, rotation, ox, oy, width, fontSize)
    }
    if (ts.horizontalScale !== 1) element.horizontalScale = ts.horizontalScale
    // Template text layout applies horizontalScale to glyph advances and
    // spacing as one unit, matching PDF's Tz semantics.  Keep Tc/Tw in the
    // unscaled text space here; multiplying them by Tz now would apply the
    // horizontal scale a second time when the imported template is laid out.
    const letterSpacing = ts.charSpacing * scaleX
    if (Math.abs(letterSpacing) > 0.01) element.letterSpacing = letterSpacing
    const wordSpacing = ts.wordSpacing * scaleX
    if (Math.abs(wordSpacing) > 0.01) element.wordSpacing = wordSpacing
    // Non-opaque fill (ExtGState /ca) or a constant soft mask (/SMask value
    // collapsed to an alpha) makes the text semi-transparent; wrap it in a frame
    // carrying that opacity, which the layout engine and every backend honor.
    const textOpacity = this.effectiveFillOpacity()
    if (textOpacity < 1 && rotation !== null) {
      this.flushPendingText()
      const child: StaticTextDef = { ...element, x: 0, y: 0 }
      const frame: FrameDef = {
        type: 'frame', x: element.x, y: element.y, width: element.width, height: element.height,
        opacity: textOpacity, elements: [child],
      }
      this.pushWithClips(frame, this.activeClips(element))
      this.advanceText(advance)
      return
    }
    if (rotation === 0 && this.tryMergeText(element, styleName, oy, fontSize)) {
      this.advanceText(advance)
      return
    }
    this.flushPendingText()
    if (rotation === null) {
      const frame = rotatedTextFrame(element, m, width, fontSize, ox, oy)
      if (textOpacity < 1) frame.opacity = textOpacity
      const clips = this.activeClips(horizontalTextBounds(m, this.pageHeight, width, fontSize))
      this.pushWithClips(frame, clips)
      this.advanceText(advance)
      return
    }
    // Clip containment is tested against the estimated glyph ink extent, not
    // the looser element box, so tight appearance-stream clips that the
    // original ink fits inside do not survive as clipping frames.
    const clips = this.activeClips(rotation === 0 ? textInkBounds(ox, oy, width, fontSize) : element)
    if (rotation === 0) {
      this.pendingText = {
        element,
        clips,
        clipKey: clipListKey(clips),
        mergeKey: textMergeKey(styleName, color, element.letterSpacing ?? 0, element.blendMode, element.actualText, element.alphaIsShape, element.textKnockout),
        baselineY: oy,
        endX: ox + width,
        fontSize,
        vertical: false,
      }
    } else {
      this.pushWithClips(element, clips)
    }
    this.advanceText(advance)
  }

  /**
   * Emits a vertical (Identity-V etc.) show-text run as a staticText column.
   * The text matrix origin is the vertical origin of the first glyph
   * (top-center of the column); downUnits is the total /W2 displacement.
   */
  private emitVerticalText(text: string, downUnits: number, glyphs: number): void {
    const ts = this.textState
    // Advance in unscaled text space: downward displacement plus Tc per glyph
    const advance = -(downUnits / 1000 * ts.fontSize) - ts.charSpacing * glyphs
    if (text.length === 0 || !this.isContentVisible() || (ts.renderMode === 3 && !this.includeInvisibleText) || ts.renderMode === 7) {
      this.advanceTextVertical(advance)
      return
    }
    const color = ts.renderMode === 1 || ts.renderMode === 5 ? this.state.strokeColor : this.state.fillColor
    if (this.state.softMaskAlpha !== 1) {
      throw new Error('PDF import error: ExtGState /SMask dictionary on imported vertical text requires text mask compositing')
    }
    const m = multiplyMatrix(this.state.ctm, ts.textMatrix)
    const rotation = textAxisRotation(m)
    const scaleX = Math.hypot(m[0], m[1])
    const scaleY = Math.hypot(m[2], m[3])
    const fontSize = Math.abs(ts.fontSize) * scaleY
    const columnHeight = Math.abs(advance) * scaleY
    const origin = transformPoint(m, 0, ts.rise)
    const ox = origin[0]
    const oy = this.pageHeight - origin[1]
    const styleName = this.registerTextStyle(ts.font!, fontSize, true)
    const bounds = verticalTextBounds(m, this.pageHeight, fontSize, columnHeight, ts.rise)
    const element: StaticTextDef = {
      type: 'staticText',
      x: bounds.x,
      y: bounds.y,
      width: fontSize,
      height: columnHeight,
      text,
      forecolor: color,
      style: styleName,
      wrap: false,
    }
    this.applyTextPaintMode(element, ts.renderMode)
    this.applyMarkedContentActualText(element)
    this.applyGraphicsStateFlags(element, textModeFills(ts.renderMode), textModeStrokes(ts.renderMode))
    if (rotation !== null && rotation !== 0) {
      element.rotation = rotation
      element.width = bounds.width
      element.height = bounds.height
    }
    const letterSpacing = ts.charSpacing * scaleY
    if (Math.abs(letterSpacing) > 0.01) element.letterSpacing = letterSpacing
    if (rotation === null) {
      this.flushPendingText()
      const frame = rotatedVerticalTextFrame(element, m, this.pageHeight, fontSize, columnHeight, ts.rise)
      this.pushWithClips(frame, this.activeClips(verticalTextBounds(m, this.pageHeight, fontSize, columnHeight, ts.rise)))
      this.advanceTextVertical(advance)
      return
    }
    if (rotation !== 0) {
      this.flushPendingText()
      this.pushWithClips(element, this.activeClips(element))
      this.advanceTextVertical(advance)
      return
    }
    if (this.tryMergeVerticalText(element, styleName, ox, fontSize)) {
      this.advanceTextVertical(advance)
      return
    }
    this.flushPendingText()
    const clips = this.activeClips(element)
    this.pendingText = {
      element,
      clips,
      clipKey: clipListKey(clips),
      mergeKey: textMergeKey(styleName, color, element.letterSpacing ?? 0, element.blendMode, element.actualText, element.alphaIsShape, element.textKnockout),
      baselineY: ox,
      endX: oy + columnHeight,
      fontSize,
      vertical: true,
    }
    this.advanceTextVertical(advance)
  }

  /** Appends the run to the buffered column when it continues the same vertical line. */
  private tryMergeVerticalText(element: StaticTextDef, styleName: string, centerX: number, fontSize: number): boolean {
    const pending = this.pendingText
    if (pending === null || !pending.vertical) return false
    const mergeKey = textMergeKey(styleName, element.forecolor!, element.letterSpacing ?? 0, element.blendMode, element.actualText, element.alphaIsShape, element.textKnockout)
    if (pending.mergeKey !== mergeKey) return false
    if (Math.abs(pending.baselineY - centerX) > Math.max(0.25, fontSize * 0.05)) return false
    const gap = element.y - pending.endX
    const tolerance = Math.max(0.35, fontSize * 0.15)
    if (gap < -tolerance || gap > tolerance) return false
    const clips = this.activeClips(element)
    if (clipListKey(clips) !== pending.clipKey) return false
    pending.element.text += element.text
    pending.endX = element.y + element.height
    pending.element.height = pending.endX - pending.element.y
    return true
  }

  /** Appends the run to the buffered text when it continues the same visual line. */
  private tryMergeText(element: StaticTextDef, styleName: string, baselineY: number, fontSize: number): boolean {
    const pending = this.pendingText
    if (pending === null || pending.vertical) return false
    const mergeKey = textMergeKey(styleName, element.forecolor!, element.letterSpacing ?? 0, element.blendMode, element.actualText, element.alphaIsShape, element.textKnockout)
    if (pending.mergeKey !== mergeKey) return false
    if ((pending.element.horizontalScale ?? 1) !== (element.horizontalScale ?? 1)) return false
    // A whitespace boundary between separate show operations marks a field
    // gap (form cells align this way); joining them would fuse distinct
    // fields into one text, so keep such runs separate.
    if (isWhitespace(pending.element.text.charCodeAt(pending.element.text.length - 1))) return false
    if (isWhitespace(element.text.charCodeAt(0))) return false
    if (Math.abs(pending.baselineY - baselineY) > Math.max(0.25, fontSize * 0.05)) return false
    const gap = element.x - pending.endX
    const tolerance = Math.max(0.35, fontSize * 0.15)
    if (gap < -tolerance || gap > tolerance) return false
    const clips = this.activeClips(textInkBounds(element.x, baselineY, element.width, fontSize))
    if (clipListKey(clips) !== pending.clipKey) return false
    pending.element.text += element.text
    pending.endX = element.x + element.width
    pending.element.width = pending.endX - pending.element.x
    return true
  }

  private flushPendingText(): void {
    const pending = this.pendingText
    if (pending === null) return
    this.pendingText = null
    this.pushWithClips(pending.element, pending.clips)
  }

  /** Registers (or reuses) a named style for the font family / size combination. */
  private registerTextStyle(font: PdfFontDecoder, fontSize: number, vertical = false): string {
    const size = Math.round(fontSize * 10) / 10
    const key = font.familyName + '|' + size + '|' + (font.info.bold ? 'b' : '') + (font.info.italic ? 'i' : '') + (vertical ? '|v' : '')
    const existing = this.textStyles.get(key)
    if (existing !== undefined) return existing.name
    const style: StyleDef = {
      name: 'pdf_text_' + this.textStyles.size,
      fontFamily: font.familyName,
      fontSize: size,
    }
    if (font.info.bold) style.bold = true
    if (font.info.italic) style.italic = true
    if (vertical) style.writingMode = 'vertical-rl'
    this.textStyles.set(key, style)
    return style.name
  }

  private gradientPaintFromPattern(name: string, uncoloredHex: string | null): PdfGradientPaint {
    const patternValue = this.resolve(this.resourceValue('Pattern', name))
    const pattern: PdfDict | null = patternValue instanceof PdfStream ? patternValue.dict : (patternValue instanceof Map ? patternValue : null)
    if (pattern === null) throw new Error(`PDF import error: pattern /${name} must be a dictionary or stream`)
    const patternType = this.resolve(pattern.get('PatternType') ?? null)
    if (patternType === 1) {
      if (!(patternValue instanceof PdfStream)) throw new Error(`PDF import error: tiling pattern /${name} must be a stream`)
      return this.tilingPaintFromPattern(patternValue, uncoloredHex)
    }
    if (patternType !== 2) throw new Error(`PDF import error: unsupported pattern type for /${name}`)
    const matrixValue = this.resolve(pattern.get('Matrix') ?? null)
    const patternMatrix: Matrix = Array.isArray(matrixValue)
      ? this.numberArray(matrixValue, 'pattern Matrix') as Matrix
      : [1, 0, 0, 1, 0, 0]
    return this.gradientPaintFromShading(pattern.get('Shading') ?? null, multiplyMatrix(patternMatrix, this.baseMatrix), 'pattern')
  }

  /**
   * Tiling pattern (pattern type 1): interprets the cell content stream with
   * a nested interpreter (identity base matrix, so the cell stays in native
   * pattern space; the composed matrix carries the page orientation) and
   * converts the resulting vector/image elements into tile graphics.
   */
  private tilingPaintFromPattern(stream: PdfStream, uncoloredHex: string | null): PdfGradientPaint {
    const dict = stream.dict
    const bbox = normalizePdfRectangle(this.numberArray(dict.get('BBox') ?? null, 'tiling pattern BBox'), 'tiling pattern BBox')
    const xStep = this.numberValue(dict.get('XStep') ?? null, 'tiling pattern XStep')
    const yStep = this.numberValue(dict.get('YStep') ?? null, 'tiling pattern YStep')
    if (xStep === 0 || yStep === 0) throw new Error('PDF import error: tiling pattern XStep and YStep must be nonzero')
    const matrixValue = this.resolve(dict.get('Matrix') ?? null)
    const matrix = Array.isArray(matrixValue) ? this.numberArray(matrixValue, 'tiling pattern Matrix') : [1, 0, 0, 1, 0, 0]
    if (matrix.length !== 6) throw new Error('PDF import error: tiling pattern Matrix requires exactly six numbers')
    const resourcesValue = this.resolve(dict.get('Resources') ?? null)
    if (!(resourcesValue instanceof Map)) throw new Error('PDF import error: tiling pattern requires a Resources dictionary')
    const resources = resourcesValue
    const paintType = this.resolve(dict.get('PaintType') ?? null)
    if (paintType !== 1 && paintType !== 2) throw new Error('PDF import error: tiling pattern PaintType must be 1 or 2')
    const tilingType = this.resolve(dict.get('TilingType') ?? null)
    if (tilingType !== 1 && tilingType !== 2 && tilingType !== 3) throw new Error('PDF import error: tiling pattern TilingType must be 1, 2, or 3')

    const sub = new PdfContentInterpreter({
      doc: this.doc,
      pageWidth: Math.abs(bbox[2]! - bbox[0]!),
      pageHeight: Math.abs(bbox[3]! - bbox[1]!),
      resources,
      fontResolver: this.fontResolver,
      outlineText: this.outlineText,
      outlineDpi: this.outlineDpi,
      imageIdPrefix: `${this.imageIdPrefix}_pat${this.patternCellCounter++}`,
      deviceCmykTransform: this.deviceCmykTransform,
    })
    sub.interpret(this.doc.decodeStream(stream))
    const cellElements = sub.finalize()
    const subImages = sub.getImages()
    for (const key of Object.keys(subImages)) {
      this.images[key] = subImages[key]!
    }
    const tileColor = paintType === 2 ? uncoloredHex : null
    const graphics: TileGraphicDef[] = []
    const styles = new Map<string, StyleDef>()
    const cellStyles = sub.getStyles()
    for (let i = 0; i < cellStyles.length; i++) styles.set(cellStyles[i]!.name, cellStyles[i]!)
    collectTileGraphics(cellElements, tileColor, graphics, styles)

    // Pattern space maps through the pattern /Matrix and the page base
    // matrix into default page space, then the top-down flip of the
    // importer's coordinate convention
    const toDefault = multiplyMatrix(matrix as Matrix, this.baseMatrix)
    const flip: Matrix = [1, 0, 0, -1, 0, this.pageHeight]
    const composed = multiplyMatrix(toDefault, flip) as [number, number, number, number, number, number]
    return {
      type: 'tilingAbs',
      bbox: [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!],
      xStep,
      yStep,
      tilingType,
      matrix: composed,
      graphics,
    }
  }

  private numberValue(value: PdfValue, label: string): number {
    const resolved = this.resolve(value)
    if (typeof resolved !== 'number') throw new Error(`PDF import error: ${label} must be a number`)
    return resolved
  }

  /** Proper 1-in function evaluation at an arbitrary t (mesh vertex colors). */
  private functionValuesAt(value: PdfValue, t: number): number[] {
    return evaluatePdfFunction(this.doc, value, [t])
  }

  /** 2-in function evaluation for function-based shading (type 1). */
  private functionValuesAt2(value: PdfValue, x: number, y: number): number[] {
    return evaluatePdfFunction(this.doc, value, [x, y])
  }

  private paintShading(): void {
    if (!this.isContentVisible()) return
    const name = this.nameOperand(0)
    const paint = this.gradientPaintFromShading(this.resourceValue('Shading', name), this.state.ctm, 'sh')
    const bounds = this.currentShadingPaintBounds()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const element = createFillRectPath(bounds, normalizePaint(paint, bounds))
    this.pushElement(element)
  }

  private currentShadingPaintBounds(): { x: number, y: number, width: number, height: number } {
    let x1 = 0
    let y1 = 0
    let x2 = this.pageWidth
    let y2 = this.pageHeight
    const clips = this.state.clips
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]!
      x1 = Math.max(x1, clip.x)
      y1 = Math.max(y1, clip.y)
      x2 = Math.min(x2, clip.x + clip.width)
      y2 = Math.min(y2, clip.y + clip.height)
    }
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
  }

  /**
   * `space` is the matrix mapping the shading coordinates to default page
   * space: the CTM for the sh operator, the pattern matrix (composed with
   * the base matrix) for shading patterns — pattern space is NOT affected
   * by the CTM at paint time.
   */
  private gradientPaintFromShading(value: PdfValue, space: Matrix, paintOperator: 'pattern' | 'sh'): PdfGradientPaint {
    const resolved = this.resolve(value)
    const shading: PdfDict | null = resolved instanceof PdfStream ? resolved.dict : (resolved instanceof Map ? resolved : null)
    if (shading === null) throw new Error('PDF import error: shading must be a dictionary or stream')
    const shadingType = this.resolve(shading.get('ShadingType') ?? null)
    if (typeof shadingType !== 'number' || !Number.isInteger(shadingType) || shadingType < 1 || shadingType > 7) throw new Error('PDF import error: ShadingType must be an integer from 1 to 7')
    const colorSpace = parsePdfColorSpace(this.doc, this.resolve(shading.get('ColorSpace') ?? null), this.resources)
    const colorComponents = pdfColorSpaceComponents(colorSpace)
    const sourceCommon = this.readShadingCommon(shading, colorSpace)
    const common = this.transformShadingCommon(sourceCommon, space)
    if (paintOperator === 'sh') {
      delete common.background
      delete common.sourceBackground
      delete sourceCommon.sourceBackground
    }
    if (shadingType === 1) return this.functionMeshFromShading(shading, space, colorSpace, common, sourceCommon, paintOperator)
    if (shadingType === 4 || shadingType === 5 || shadingType === 6 || shadingType === 7) {
      if (!(resolved instanceof PdfStream)) throw new Error('PDF import error: mesh shading must be a stream')
      return this.meshPaintFromShading(resolved, shadingType, space, colorSpace, common, sourceCommon)
    }
    const coords = this.numberArray(shading.get('Coords') ?? null, 'shading coordinates')
    const domainValue = this.resolve(shading.get('Domain') ?? null)
    const domain = domainValue === null ? [0, 1] : this.numberArray(domainValue, 'shading Domain')
    if (domain.length !== 2 || domain[0]! > domain[1]!) throw new Error('PDF import error: axial/radial shading Domain must be one ordered pair')
    const functionValue = shading.get('Function')
    if (functionValue === undefined) throw new Error('PDF import error: axial/radial shading requires Function')
    const functions = this.readShadingFunctions(functionValue, 1, colorComponents, domain)
    const stops = this.gradientStopsFromFunction(functionValue, colorSpace, domain as [number, number])
    const extend = this.resolve(shading.get('Extend') ?? null)
    const extendValues: [boolean, boolean] = extend === null ? [false, false] : this.booleanPair(extend, 'shading Extend')
    const spreadMethod = extendValues[0] || extendValues[1] ? 'pad' : undefined
    if (shadingType === 2) {
      if (coords.length !== 4) throw new Error('PDF import error: axial shading requires exactly four coordinates')
      const p1 = this.pointIn(space, coords[0]!, coords[1]!)
      const p2 = this.pointIn(space, coords[2]!, coords[3]!)
      return { type: 'linearGradientAbs', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stops, spreadMethod, common, domain: domain as [number, number], extend: extendValues, functions, colorSpace: pdfShadingColorSpaceDef(this.doc, colorSpace), native: { shadingType: 2, coords: [coords[0]!, coords[1]!, coords[2]!, coords[3]!], patternMatrix: pdfUserToPageMatrix(space, this.pageHeight), ...(sourceCommon.bbox === undefined ? {} : { bbox: [...sourceCommon.bbox] as [number, number, number, number] }), paintOperator } }
    }
    if (shadingType === 3) {
      if (coords.length !== 6) throw new Error('PDF import error: radial shading requires exactly six coordinates')
      if (coords[2]! < 0 || coords[5]! < 0) throw new Error('PDF import error: radial shading radii must be non-negative')
      const f = this.pointIn(space, coords[0]!, coords[1]!)
      const c = this.pointIn(space, coords[3]!, coords[4]!)
      const scale = matrixAreaScale(space)
      return { type: 'radialGradientAbs', fx: f[0], fy: f[1], fr: coords[2]! * scale, cx: c[0], cy: c[1], r: coords[5]! * scale, stops, spreadMethod, common, domain: domain as [number, number], extend: extendValues, functions, colorSpace: pdfShadingColorSpaceDef(this.doc, colorSpace), native: { shadingType: 3, coords: [coords[0]!, coords[1]!, coords[2]!, coords[3]!, coords[4]!, coords[5]!], patternMatrix: pdfUserToPageMatrix(space, this.pageHeight), ...(sourceCommon.bbox === undefined ? {} : { bbox: [...sourceCommon.bbox] as [number, number, number, number] }), paintOperator } }
    }
    throw new Error(`PDF import error: unsupported shading type ${String(shadingType)}`)
  }

  private readShadingCommon(shading: PdfDict, colorSpace: ReturnType<typeof parsePdfColorSpace>): PdfShadingCommon {
    const common: PdfShadingCommon = {}
    const background = this.resolve(shading.get('Background') ?? null)
    if (background !== null) {
      const values = this.numberArray(background, 'shading Background')
      if (values.length !== pdfColorSpaceComponents(colorSpace)) throw new Error('PDF import error: shading Background must match ColorSpace components')
      common.background = pdfColorToRgb(this.doc, colorSpace, values, undefined, false, this.deviceCmykTransform)
      common.sourceBackground = values
    }
    const bbox = this.resolve(shading.get('BBox') ?? null)
    if (bbox !== null) {
      common.bbox = normalizePdfRectangle(this.numberArray(bbox, 'shading BBox'), 'shading BBox')
    }
    const antiAlias = this.resolve(shading.get('AntiAlias') ?? null)
    if (antiAlias !== null) {
      if (typeof antiAlias !== 'boolean') throw new Error('PDF import error: shading AntiAlias must be a boolean')
      common.antiAlias = antiAlias
    }
    return common
  }

  private transformShadingCommon(common: PdfShadingCommon, space: Matrix): PdfShadingCommon {
    if (common.bbox === undefined) return { ...common }
    const b = common.bbox
    const p0 = this.pointIn(space, b[0], b[1])
    const p1 = this.pointIn(space, b[2], b[1])
    const p2 = this.pointIn(space, b[2], b[3])
    const p3 = this.pointIn(space, b[0], b[3])
    const bounds = pathBounds([p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]])
    return { ...common, bbox: [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height] }
  }

  private booleanPair(value: PdfValue, label: string): [boolean, boolean] {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`PDF import error: ${label} must contain exactly two booleans`)
    const first = this.resolve(value[0]!)
    const second = this.resolve(value[1]!)
    if (typeof first !== 'boolean' || typeof second !== 'boolean') throw new Error(`PDF import error: ${label} must contain exactly two booleans`)
    return [first, second]
  }

  private readShadingFunctions(value: PdfValue, inputCount: number, outputCount: number, domain: number[]): PdfFunctionDef[] {
    const resolved = this.resolve(value)
    const values = Array.isArray(resolved) ? resolved : [value]
    if (values.length !== 1 && values.length !== outputCount) throw new Error('PDF import error: shading Function array must contain one function per ColorSpace component')
    const functions = values.map((functionValue) => readPdfFunctionDef(this.doc, functionValue))
    for (let i = 0; i < functions.length; i++) {
      const fn = functions[i]!
      if (pdfFunctionInputCount(fn) !== inputCount) throw new Error('PDF import error: shading function input dimension is invalid')
      const fnOutputs = pdfFunctionOutputCount(fn)
      if (values.length === 1 ? fnOutputs !== outputCount : fnOutputs !== 1) throw new Error('PDF import error: shading function output dimension does not match ColorSpace')
      for (let d = 0; d < inputCount; d++) {
        const fnDomain = pdfFunctionDomain(fn)
        if (fnDomain[d * 2]! > domain[d * 2]! || fnDomain[d * 2 + 1]! < domain[d * 2 + 1]!) {
          throw new Error('PDF import error: shading function Domain must contain the shading Domain')
        }
      }
    }
    return functions
  }

  /**
   * Mesh shadings (types 4/5/6/7): decodes the packed vertex/patch stream
   * into page-space triangles and tensor patches. Coons patches (type 6)
   * are promoted to tensor patches with the spec interior formulas.
   */
  private meshPaintFromShading(
    stream: PdfStream,
    shadingType: 4 | 5 | 6 | 7,
    space: Matrix,
    colorSpace: ReturnType<typeof parsePdfColorSpace>,
    common: PdfShadingCommon,
    sourceCommon: PdfShadingCommon,
  ): PdfGradientPaint {
    const dict = stream.dict
    const bitsPerCoordinate = this.numberValue(dict.get('BitsPerCoordinate') ?? null, 'BitsPerCoordinate')
    const bitsPerComponent = this.numberValue(dict.get('BitsPerComponent') ?? null, 'BitsPerComponent')
    if (!MESH_COORDINATE_BITS.has(bitsPerCoordinate)) throw new Error('PDF import error: mesh BitsPerCoordinate is not permitted')
    if (!MESH_COMPONENT_BITS.has(bitsPerComponent)) throw new Error('PDF import error: mesh BitsPerComponent is not permitted')
    const decode = this.numberArray(dict.get('Decode') ?? null, 'mesh shading Decode')
    const fnValue = dict.get('Function') ?? null
    const hasFunction = this.resolve(fnValue) !== null
    const componentCount = hasFunction ? 1 : pdfColorSpaceComponents(colorSpace)
    if (decode.length !== 4 + componentCount * 2) {
      throw new Error('PDF import error: mesh shading Decode array length is invalid')
    }
    const functions = hasFunction ? this.readShadingFunctions(fnValue, 1, pdfColorSpaceComponents(colorSpace), [decode[4]!, decode[5]!]) : undefined
    const streamData = this.doc.decodeStream(stream)
    const reader = new MeshBitReader(streamData)
    const nativeBase = {
      shadingType,
      bitsPerCoordinate: bitsPerCoordinate as PdfNativeMeshShadingDef['bitsPerCoordinate'],
      bitsPerComponent: bitsPerComponent as PdfNativeMeshShadingDef['bitsPerComponent'],
      decode: decode.slice(),
      ...(functions === undefined ? {} : { functions }),
      colorSpace: pdfShadingColorSpaceDef(this.doc, colorSpace),
      data: streamData.slice(),
      matrix: pdfUserToPageMatrix(space, this.pageHeight),
      ...(sourceCommon.sourceBackground === undefined ? {} : { background: sourceCommon.sourceBackground.slice() }),
      ...(sourceCommon.bbox === undefined ? {} : { bbox: [...sourceCommon.bbox] as [number, number, number, number] }),
      ...(sourceCommon.antiAlias === undefined ? {} : { antiAlias: sourceCommon.antiAlias }),
    }
    const pointFn = (x: number, y: number): [number, number] => this.pointIn(space, x, y)
    const maxCoord = bitsPerCoordinate >= 32 ? 0xffffffff : (1 << bitsPerCoordinate) - 1
    const maxComp = bitsPerComponent >= 32 ? 0xffffffff : (1 << bitsPerComponent) - 1
    const readVertexPoint = (): [number, number] => {
      const rx = reader.readBits(bitsPerCoordinate)
      const ry = reader.readBits(bitsPerCoordinate)
      const x = decode[0]! + rx / maxCoord * (decode[1]! - decode[0]!)
      const y = decode[2]! + ry / maxCoord * (decode[3]! - decode[2]!)
      return pointFn(x, y)
    }
    const readColor = (): string => {
      const comps: number[] = []
      for (let c = 0; c < componentCount; c++) {
        const raw = reader.readBits(bitsPerComponent)
        comps.push(decode[4 + c * 2]! + raw / maxComp * (decode[5 + c * 2]! - decode[4 + c * 2]!))
      }
      if (hasFunction) return colorArrayToHexIn(this.doc, colorSpace, this.functionValuesAt(fnValue, comps[0]!), this.deviceCmykTransform)
      return colorArrayToHexIn(this.doc, colorSpace, comps, this.deviceCmykTransform)
    }

    const triangles: { points: number[], colors: [string, string, string] }[] = []
    const patches: { points: number[], colors: [string, string, string, string] }[] = []

    if (shadingType === 4) {
      const bitsPerFlag = this.numberValue(dict.get('BitsPerFlag') ?? null, 'BitsPerFlag')
      if (!MESH_FLAG_BITS.has(bitsPerFlag)) throw new Error('PDF import error: mesh BitsPerFlag is not permitted')
      let previous: { points: [number, number][], colors: string[] } | null = null
      while (reader.hasBits(bitsPerFlag + bitsPerCoordinate * 2 + bitsPerComponent * componentCount)) {
        const flag = reader.readBits(bitsPerFlag)
        const p = readVertexPoint()
        const color = readColor()
        if (flag === 0) {
          reader.readBits(bitsPerFlag)
          const p2 = readVertexPoint()
          const c2 = readColor()
          reader.readBits(bitsPerFlag)
          const p3 = readVertexPoint()
          const c3 = readColor()
          previous = { points: [p, p2, p3], colors: [color, c2, c3] }
        } else if (previous !== null && flag === 1) {
          previous = { points: [previous.points[1]!, previous.points[2]!, p], colors: [previous.colors[1]!, previous.colors[2]!, color] }
        } else if (previous !== null && flag === 2) {
          previous = { points: [previous.points[0]!, previous.points[2]!, p], colors: [previous.colors[0]!, previous.colors[2]!, color] }
        } else {
          throw new Error(`PDF import error: invalid free-form mesh flag ${flag}`)
        }
        triangles.push({
          points: [previous.points[0]![0], previous.points[0]![1], previous.points[1]![0], previous.points[1]![1], previous.points[2]![0], previous.points[2]![1]],
          colors: [previous.colors[0]!, previous.colors[1]!, previous.colors[2]!] as [string, string, string],
        })
      }
    } else if (shadingType === 5) {
      // Lattice-form mesh keeps its grid structure (round-trips as Type 5)
      const perRow = this.numberValue(dict.get('VerticesPerRow') ?? null, 'VerticesPerRow')
      if (perRow < 2) throw new Error('PDF import error: lattice mesh requires at least two vertices per row')
      const latticePoints: number[] = []
      const latticeColors: string[] = []
      while (reader.hasBits((bitsPerCoordinate * 2 + bitsPerComponent * componentCount) * perRow)) {
        for (let v = 0; v < perRow; v++) {
          const point = readVertexPoint()
          latticePoints.push(point[0], point[1])
          latticeColors.push(readColor())
        }
      }
      reader.requireZeroPadding()
      if (latticePoints.length >= perRow * 4) {
        return { type: 'meshAbs', patches: [], triangles: [], lattice: { columns: perRow, points: latticePoints, colors: latticeColors }, common, native: { ...nativeBase, verticesPerRow: perRow } }
      }
      throw new Error('PDF import error: lattice mesh requires at least two rows')
    } else {
      const bitsPerFlag = this.numberValue(dict.get('BitsPerFlag') ?? null, 'BitsPerFlag')
      if (!MESH_FLAG_BITS.has(bitsPerFlag)) throw new Error('PDF import error: mesh BitsPerFlag is not permitted')
      const tensor = shadingType === 7
      // Boundary points d1..d12 in data order plus the previous patch's
      // shared edge per the flag (spec tables 84-86)
      let previousBoundary: [number, number][] | null = null
      let previousColors: string[] | null = null
      let previousInternal: [number, number][] | null = null
      while (reader.hasBits(bitsPerFlag + bitsPerCoordinate * 2)) {
        const flag = reader.readBits(bitsPerFlag)
        let boundary: [number, number][]
        let colors: string[]
        if (flag === 0) {
          boundary = []
          for (let i = 0; i < 12; i++) boundary.push(readVertexPoint())
          const internal: [number, number][] = []
          if (tensor) {
            for (let i = 0; i < 4; i++) internal.push(readVertexPoint())
          }
          colors = [readColor(), readColor(), readColor(), readColor()]
          patches.push(buildTensorPatch(boundary, tensor ? internal : null, colors))
          previousBoundary = boundary
          previousColors = colors
          previousInternal = tensor ? internal : null
          continue
        }
        if (previousBoundary === null || previousColors === null) {
          throw new Error('PDF import error: mesh patch edge flag without a previous patch')
        }
        // Shared edge: 4 points and 2 colors from the previous patch
        let shared: [number, number][]
        let sharedColors: [string, string]
        if (flag === 1) {
          shared = [previousBoundary[3]!, previousBoundary[4]!, previousBoundary[5]!, previousBoundary[6]!]
          sharedColors = [previousColors[1]!, previousColors[2]!]
        } else if (flag === 2) {
          shared = [previousBoundary[6]!, previousBoundary[7]!, previousBoundary[8]!, previousBoundary[9]!]
          sharedColors = [previousColors[2]!, previousColors[3]!]
        } else if (flag === 3) {
          shared = [previousBoundary[9]!, previousBoundary[10]!, previousBoundary[11]!, previousBoundary[0]!]
          sharedColors = [previousColors[3]!, previousColors[0]!]
        } else {
          throw new Error(`PDF import error: invalid mesh patch flag ${flag}`)
        }
        boundary = shared.slice()
        for (let i = 0; i < 8; i++) boundary.push(readVertexPoint())
        const internal: [number, number][] = []
        if (tensor) {
          for (let i = 0; i < 4; i++) internal.push(readVertexPoint())
        }
        colors = [sharedColors[0], sharedColors[1], readColor(), readColor()]
        patches.push(buildTensorPatch(boundary, tensor ? internal : null, colors))
        previousBoundary = boundary
        previousColors = colors
        previousInternal = tensor ? internal : null
      }
      void previousInternal
    }
    reader.requireZeroPadding()
    const bitsPerFlag = this.numberValue(dict.get('BitsPerFlag') ?? null, 'BitsPerFlag') as PdfNativeMeshShadingDef['bitsPerFlag']
    return { type: 'meshAbs', patches, triangles, common, native: { ...nativeBase, bitsPerFlag } }
  }

  /**
   * Function-based shading (type 1): samples the 2-in function over the
   * domain lattice and emits flat tensor patches, keeping the result
   * resolution independent instead of rasterizing.
   */
  private functionMeshFromShading(
    shading: PdfDict,
    space: Matrix,
    colorSpace: ReturnType<typeof parsePdfColorSpace>,
    common: PdfShadingCommon,
    sourceCommon: PdfShadingCommon,
    paintOperator: 'pattern' | 'sh',
  ): PdfGradientPaint {
    const domainValue = this.resolve(shading.get('Domain') ?? null)
    const domain = Array.isArray(domainValue) ? this.numberArray(domainValue, 'shading Domain') : [0, 1, 0, 1]
    if (domain.length !== 4 || domain[0]! > domain[1]! || domain[2]! > domain[3]!) throw new Error('PDF import error: function shading Domain must contain two ordered pairs')
    const matrixValue = this.resolve(shading.get('Matrix') ?? null)
    const matrix = Array.isArray(matrixValue) ? this.numberArray(matrixValue, 'shading Matrix') : [1, 0, 0, 1, 0, 0]
    if (matrix.length !== 6) throw new Error('PDF import error: function shading Matrix requires exactly six numbers')
    const fnValue = shading.get('Function')
    if (fnValue === undefined) throw new Error('PDF import error: function shading requires Function')
    const functions = this.readShadingFunctions(fnValue, 2, pdfColorSpaceComponents(colorSpace), domain)
    // A single Type 4 calculator function with RGB output keeps its source
    // expression so the shading round-trips as a native ShadingType 1
    const fnResolved = this.resolve(fnValue)
    if (fnResolved instanceof PdfStream && colorSpaceIsRgbLike(colorSpace)) {
      const fnType = this.resolve(fnResolved.dict.get('FunctionType') ?? null)
      if (fnType === 4) {
        const source = asciiText(this.doc.decodeStream(fnResolved))
        // multiplyMatrix(a, b) applies b first: shading /Matrix, then the
        // coordinate space, then the top-down flip
        const toDefault = multiplyMatrix(space, [matrix[0]!, matrix[1]!, matrix[2]!, matrix[3]!, matrix[4]!, matrix[5]!])
        const flip: Matrix = [1, 0, 0, -1, 0, this.pageHeight]
        const composed = multiplyMatrix(flip, toDefault)
        return {
          type: 'functionShadingAbs',
          domain: [domain[0]!, domain[1]!, domain[2]!, domain[3]!],
          matrix: [composed[0], composed[1], composed[2], composed[3], composed[4], composed[5]],
          expression: source,
          common,
        }
      }
    }
    const N = 8
    const patches: { points: number[], colors: [string, string, string, string] }[] = []
    const corner = (u: number, v: number): { point: [number, number], color: string } => {
      const dx = domain[0]! + u * (domain[1]! - domain[0]!)
      const dy = domain[2]! + v * (domain[3]! - domain[2]!)
      const tx = matrix[0]! * dx + matrix[2]! * dy + matrix[4]!
      const ty = matrix[1]! * dx + matrix[3]! * dy + matrix[5]!
      return { point: this.pointIn(space, tx, ty), color: colorArrayToHexIn(this.doc, colorSpace, this.functionValuesAt2(fnValue, dx, dy), this.deviceCmykTransform) }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const c00 = corner(i / N, j / N)
        const c01 = corner(i / N, (j + 1) / N)
        const c11 = corner((i + 1) / N, (j + 1) / N)
        const c10 = corner((i + 1) / N, j / N)
        patches.push(flatTensorPatch(c00.point, c01.point, c11.point, c10.point, [c00.color, c01.color, c11.color, c10.color]))
      }
    }
    return {
      type: 'meshAbs',
      patches,
      triangles: [],
      common,
      native: undefined,
      nativeFunction: {
        domain: [domain[0]!, domain[1]!, domain[2]!, domain[3]!],
        matrix: [matrix[0]!, matrix[1]!, matrix[2]!, matrix[3]!, matrix[4]!, matrix[5]!],
        patternMatrix: pdfUserToPageMatrix(space, this.pageHeight),
        functions,
        colorSpace: pdfShadingColorSpaceDef(this.doc, colorSpace),
        ...(paintOperator === 'sh' || sourceCommon.sourceBackground === undefined ? {} : { background: sourceCommon.sourceBackground.slice() }),
        ...(sourceCommon.bbox === undefined ? {} : { bbox: [...sourceCommon.bbox] as [number, number, number, number] }),
        ...(sourceCommon.antiAlias === undefined ? {} : { antiAlias: sourceCommon.antiAlias }),
        paintOperator,
      },
    }
  }

  private gradientStopsFromFunction(
    value: PdfValue,
    colorSpace: ReturnType<typeof parsePdfColorSpace>,
    domain: [number, number],
  ): GradientStopDef[] {
    const fn = this.resolve(value)
    if (Array.isArray(fn)) {
      const stops: GradientStopDef[] = []
      for (let i = 0; i <= 64; i++) {
        const offset = i / 64
        const input = domain[0] + offset * (domain[1] - domain[0])
        stops.push({ offset, color: colorArrayToHexIn(this.doc, colorSpace, evaluatePdfFunction(this.doc, value, [input]), this.deviceCmykTransform) })
      }
      return stops
    }
    const fnDict = functionDict(fn)
    const functionType = this.resolve(fnDict.get('FunctionType') ?? null)
    if (functionType === 0) {
      if (!(fn instanceof PdfStream)) throw new Error('PDF import error: sampled shading function must be a stream')
      return this.sampledFunctionStops(fn, colorSpace)
    }
    if (functionType === 2) {
      const exponent = this.resolve(fnDict.get('N') ?? null)
      if (typeof exponent !== 'number') throw new Error('PDF import error: exponential shading function requires N')
      if (exponent !== 1) return this.sampleGradientFunction(value, colorSpace, domain, 32)
      return [
        { offset: 0, color: colorArrayToHexIn(this.doc, colorSpace, evaluatePdfFunction(this.doc, value, [domain[0]]), this.deviceCmykTransform) },
        { offset: 1, color: colorArrayToHexIn(this.doc, colorSpace, evaluatePdfFunction(this.doc, value, [domain[1]]), this.deviceCmykTransform) },
      ]
    }
    if (functionType === 3) {
      const functions = this.resolve(fnDict.get('Functions') ?? null)
      if (!Array.isArray(functions) || functions.length === 0) throw new Error('PDF import error: stitching function requires sub-functions')
      const domainValue = this.resolve(fnDict.get('Domain') ?? null)
      const domain = Array.isArray(domainValue) ? this.numberArray(domainValue, 'function Domain') : [0, 1]
      if (domain.length !== 2) throw new Error('PDF import error: stitching function Domain must contain two numbers')
      const bounds = this.numberArray(fnDict.get('Bounds') ?? [], 'function Bounds')
      if (bounds.length !== functions.length - 1) throw new Error('PDF import error: stitching function Bounds length must be sub-functions minus one')
      const encode = this.numberArray(fnDict.get('Encode') ?? [], 'function Encode')
      if (encode.length !== functions.length * 2) throw new Error('PDF import error: stitching function Encode must contain two numbers per sub-function')
      const stops: GradientStopDef[] = []
      for (let i = 0; i < functions.length; i++) {
        const start = i === 0 ? domain[0]! : bounds[i - 1]!
        const end = i === functions.length - 1 ? domain[1]! : bounds[i]!
        const offset0 = normalizeFunctionStopOffset(start, domain)
        const offset1 = normalizeFunctionStopOffset(end, domain)
        const intervals = this.isLinearExponentialFunction(functions[i]!) ? 1 : 32
        for (let step = 0; step <= intervals; step++) {
          const fraction = step / intervals
          const input = start + (end - start) * fraction
          const mapped = mapStitchingInput(input, start, end, encode[i * 2]!, encode[i * 2 + 1]!)
          const stop = {
            offset: offset0 + (offset1 - offset0) * fraction,
            color: colorArrayToHexIn(this.doc, colorSpace, this.functionValuesAt(functions[i]!, mapped), this.deviceCmykTransform),
          }
          // The start of segment i shares its offset with the end of segment
          // i-1. Keep both only when the source function has a hard transition.
          const previous = stops.length > 0 ? stops[stops.length - 1]! : null
          if (previous === null || previous.offset !== stop.offset || previous.color !== stop.color) stops.push(stop)
        }
      }
      return stops
    }
    if (functionType === 4) {
      if (!(fn instanceof PdfStream)) throw new Error('PDF import error: calculator shading function must be a stream')
      const stops: GradientStopDef[] = []
      for (let i = 0; i <= 16; i++) {
        const offset = i / 16
        const input = domain[0] + offset * (domain[1] - domain[0])
        stops.push({ offset, color: colorArrayToHexIn(this.doc, colorSpace, evaluatePdfFunction(this.doc, value, [input]), this.deviceCmykTransform) })
      }
      return stops
    }
    throw new Error(`PDF import error: unsupported shading function type ${String(functionType)}`)
  }

  private sampleGradientFunction(
    value: PdfValue,
    colorSpace: ReturnType<typeof parsePdfColorSpace>,
    domain: [number, number],
    intervals: number,
  ): GradientStopDef[] {
    const stops: GradientStopDef[] = []
    for (let i = 0; i <= intervals; i++) {
      const offset = i / intervals
      const input = domain[0] + offset * (domain[1] - domain[0])
      stops.push({
        offset,
        color: colorArrayToHexIn(this.doc, colorSpace, evaluatePdfFunction(this.doc, value, [input]), this.deviceCmykTransform),
      })
    }
    return stops
  }

  private isLinearExponentialFunction(value: PdfValue): boolean {
    const resolved = this.resolve(value)
    const dict = functionDict(resolved)
    const functionType = this.resolve(dict.get('FunctionType') ?? null)
    if (functionType !== 2) return false
    return this.resolve(dict.get('N') ?? null) === 1
  }

  private sampledFunctionStops(stream: PdfStream, colorSpace: ReturnType<typeof parsePdfColorSpace>): GradientStopDef[] {
    const size = this.numberArray(stream.dict.get('Size') ?? null, 'sampled function Size')
    if (size.length !== 1) throw new Error('PDF import error: sampled shading function must have one input dimension')
    const sampleCount = size[0]!
    if (sampleCount < 2) throw new Error('PDF import error: sampled shading function needs at least two samples')
    const domain = this.numberArray(stream.dict.get('Domain') ?? null, 'sampled function Domain')
    if (domain.length !== 2) throw new Error('PDF import error: sampled shading function Domain must contain two numbers')
    const stops: GradientStopDef[] = []
    for (let sample = 0; sample < sampleCount; sample++) {
      const offset = sample / (sampleCount - 1)
      const input = domain[0]! + offset * (domain[1]! - domain[0]!)
      const values = evaluateSampledFunction(this.doc, stream, [input])
      stops.push({ offset: sample / (sampleCount - 1), color: colorArrayToHexIn(this.doc, colorSpace, values, this.deviceCmykTransform) })
    }
    return stops
  }

  private functionColorAt(value: PdfValue, t: number): number[] {
    return evaluatePdfFunction(this.doc, value, [t])
  }

  private numberArray(value: PdfValue, label: string): number[] {
    const resolved = this.resolve(value)
    if (!Array.isArray(resolved)) throw new Error(`PDF import error: ${label} must be an array`)
    const out: number[] = []
    for (let i = 0; i < resolved.length; i++) {
      const item = this.resolve(resolved[i]!)
      if (typeof item !== 'number') throw new Error(`PDF import error: ${label} must contain numbers`)
      out.push(item)
    }
    return out
  }

  private numberFromDict(dict: PdfDict, key: string): number {
    const value = this.resolve(dict.get(key) ?? null)
    if (typeof value !== 'number') throw new Error(`PDF import error: /${key} must be a number`)
    return value
  }

  private advanceText(advance: number): void {
    this.textState.textMatrix = multiplyMatrix(this.textState.textMatrix, [1, 0, 0, 1, advance, 0])
  }

  /** Vertical writing advance: displaces the text matrix along y (negative = down). */
  private advanceTextVertical(advance: number): void {
    this.textState.textMatrix = multiplyMatrix(this.textState.textMatrix, [1, 0, 0, 1, 0, advance])
  }

  private paintXObject(): void {
    const name = this.nameOperand(0)
    if (!this.isContentVisible()) return
    const xObjectValue = this.dictResource('XObject', name)
    const xObjectDict = xObjectValue instanceof PdfStream ? xObjectValue.dict : xObjectValue
    const subtype = this.resolve(xObjectDict.get('Subtype') ?? null)
    if (!(subtype instanceof PdfName)) throw new Error(`PDF import error: XObject /${name} has no subtype`)
    if (subtype.name === 'Image') {
      if (!(xObjectValue instanceof PdfStream)) throw new Error(`PDF import error: image XObject /${name} must be a stream`)
      const selectedImage = this.visibleImageXObject(xObjectValue)
      if (selectedImage === null) return
      const placement = imagePlacement(this.state.ctm, this.pageHeight)
      const imported = importPdfImageXObject(
        this.doc,
        selectedImage,
        this.state.fillColor,
        this.state.deviceParams?.useBlackPointCompensation === 'on',
        this.deviceCmykTransform,
      )
      const oriented = flipImportedPdfImage(imported, placement.flipX, placement.flipY)
      const imageId = this.registerImage(oriented.bytes, oriented.extension)
      const element = this.createImageElement(imageId, placement, oriented)
      const selectedOc = selectedImage.dict.get('OC')
      if (selectedOc !== undefined) element.optionalContent = this.optionalContentDefinition(selectedOc)
      this.pushElement(element)
      return
    }
    if (subtype.name !== 'Form') throw new Error(`PDF import error: unsupported XObject subtype /${subtype.name}`)
    const ref = this.resourceRef('XObject', name)
    if (ref !== null && this.visitedForms.has(ref.num)) {
      throw new Error(`PDF import error: circular Form XObject reference ${ref.num}`)
    }
    if (!(xObjectValue instanceof PdfStream)) throw new Error(`PDF import error: XObject /${name} must be a stream`)
    if (this.visitedFormStreams.has(xObjectValue)) throw new Error(`PDF import error: circular direct Form XObject /${name}`)

    const dict = xObjectValue.dict
    const type = this.resolve(dict.get('Type') ?? null)
    if (type !== null && (!(type instanceof PdfName) || type.name !== 'XObject')) {
      throw new Error('PDF import error: Form XObject Type must be /XObject')
    }
    const formTypeValue = this.resolve(dict.get('FormType') ?? null)
    if (formTypeValue !== null && formTypeValue !== 1) throw new Error('PDF import error: Form XObject FormType must be 1')
    const bbox = normalizePdfRectangle(this.numberArray(xObjectValue.dict.get('BBox') ?? null, 'Form XObject BBox'), 'Form XObject BBox')
    const matrixValue = this.resolve(dict.get('Matrix') ?? null)
    let formMatrix: Matrix = [1, 0, 0, 1, 0, 0]
    if (matrixValue !== null) {
      if (!Array.isArray(matrixValue)) throw new Error('PDF import error: Form XObject Matrix must be an array')
      const values = this.numberArray(matrixValue, 'Form XObject Matrix')
      if (values.length !== 6) throw new Error('PDF import error: Form XObject Matrix requires exactly six numbers')
      formMatrix = values as Matrix
    }

    let formResources = this.resources
    if (dict.has('Resources')) {
      const resourceValue = this.resolve(dict.get('Resources') ?? null)
      if (!(resourceValue instanceof Map)) throw new Error('PDF import error: Form XObject Resources must be a dictionary')
      formResources = resourceValue
    }
    const width = bbox[2]! - bbox[0]!
    const height = bbox[3]! - bbox[1]!
    if (ref !== null) this.visitedForms.add(ref.num)
    this.visitedFormStreams.add(xObjectValue)
    const sub = new PdfContentInterpreter({
      doc: this.doc,
      pageWidth: width,
      pageHeight: height,
      initialMatrix: [1, 0, 0, 1, -bbox[0]!, -bbox[1]!],
      resources: formResources,
      fontResolver: this.fontResolver,
      outlineText: this.outlineText,
      outlineDpi: this.outlineDpi,
      imageIdPrefix: `${this.imageIdPrefix}_form${this.imageCounter++}_`,
      visitedForms: this.visitedForms,
      visitedFormStreams: this.visitedFormStreams,
      optionalContentContext: this.optionalContentContext,
      deviceCmykTransform: this.deviceCmykTransform,
    })
    const inheritedState = copyGraphicsState(this.state)
    const transparencyGroup = isTransparencyGroup(this.doc, dict)
    const groupOpacity = this.effectiveFillOpacity()
    const groupBlendMode = this.state.blendMode
    if (transparencyGroup) {
      inheritedState.fillOpacity = 1
      inheritedState.strokeOpacity = 1
      inheritedState.softMaskAlpha = 1
      inheritedState.blendMode = 'normal'
    }
    inheritedState.ctm = [1, 0, 0, 1, -bbox[0]!, -bbox[1]!]
    inheritedState.clips = []
    inheritedState.clipIsEmpty = false
    sub.state = inheritedState
    restoreTextParams(sub.textState, snapshotTextParams(this.textState))
    sub.clipCurrentSpaceRect(bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!)
    sub.interpret(this.doc.decodeStream(xObjectValue))
    const formElements = sub.finalize()
    this.visitedFormStreams.delete(xObjectValue)
    if (ref !== null) this.visitedForms.delete(ref.num)
    this.mergeNestedInterpreter(sub)

    const form = this.readFormXObjectMetadata(dict, bbox as [number, number, number, number], formMatrix, formTypeValue === 1)
    const sourceToLocal: Matrix = [1, 0, 0, -1, bbox[0]!, bbox[3]!]
    const pageFlip: Matrix = [1, 0, 0, -1, 0, this.pageHeight]
    const previewTransform = multiplyMatrix(pageFlip, multiplyMatrix(this.state.ctm, multiplyMatrix(formMatrix, sourceToLocal)))
    const frame: FrameDef = {
      type: 'frame', x: 0, y: 0, width, height,
      affineTransform: previewTransform,
      pdfForm: form,
      elements: formElements,
    }
    const formOc = dict.get('OC')
    if (formOc !== undefined) frame.optionalContent = this.optionalContentDefinition(formOc)
    const group = this.resolve(dict.get('Group') ?? null)
    if (group instanceof Map && transparencyGroup) {
      frame.transparencyGroup = true
      const isolated = this.resolve(group.get('I') ?? null)
      const knockout = this.resolve(group.get('K') ?? null)
      if (isolated !== null && typeof isolated !== 'boolean') throw new Error('PDF import error: transparency Group I must be a boolean')
      if (knockout !== null && typeof knockout !== 'boolean') throw new Error('PDF import error: transparency Group K must be a boolean')
      if (isolated === true) frame.isolated = true
      if (knockout === true) frame.knockout = true
      if (groupOpacity !== 1) frame.opacity = groupOpacity
      if (groupBlendMode !== 'normal') frame.blendMode = groupBlendMode
    }
    this.flushPendingText()
    if (!this.state.clipIsEmpty) this.pushWithClips(frame, this.activeClips(matrixRectBounds(previewTransform, 0, 0, width, height)))
    this.lastClipWrap = null
  }

  private mergeNestedInterpreter(interpreter: PdfContentInterpreter): void {
    const nestedImages = interpreter.getImages()
    for (const key of Object.keys(nestedImages)) this.images[key] = nestedImages[key]!
    const nestedStyles = interpreter.getStyles()
    for (let i = 0; i < nestedStyles.length; i++) this.textStyles.set(nestedStyles[i]!.name, nestedStyles[i]!)
    const nestedFonts = interpreter.getFontInfos()
    for (let i = 0; i < nestedFonts.length; i++) {
      const font = nestedFonts[i]!
      this.usedFonts.set(font.baseFont + '|' + font.subtype, font)
    }
  }

  private readFormXObjectMetadata(
    dict: PdfDict,
    bbox: [number, number, number, number],
    matrix: Matrix,
    hasFormType: boolean,
  ): PdfFormXObjectDef {
    const form: PdfFormXObjectDef = {
      bbox: bbox.slice() as [number, number, number, number],
      matrix: matrix.slice() as Matrix,
      invocationMatrix: this.state.ctm.slice() as Matrix,
    }
    if (hasFormType) form.formType = 1

    const group = this.resolve(dict.get('Group') ?? null)
    if (group !== null) {
      if (!(group instanceof Map)) throw new Error('PDF import error: Form XObject Group must be a dictionary')
      const type = this.resolve(group.get('Type') ?? null)
      if (type !== null && (!(type instanceof PdfName) || type.name !== 'Group')) throw new Error('PDF import error: Form Group Type must be /Group')
      const subtype = this.resolve(group.get('S') ?? null)
      if (!(subtype instanceof PdfName)) throw new Error('PDF import error: Form Group requires a name S')
      form.group = rawPdfDictionary(this.doc, group, new Set<object>())
    }

    const reference = this.resolve(dict.get('Ref') ?? null)
    if (reference !== null) {
      if (!(reference instanceof Map)) throw new Error('PDF import error: Form XObject Ref must be a dictionary')
      this.validateReferenceXObject(reference)
      form.reference = rawPdfDictionary(this.doc, reference, new Set<object>())
    }

    const metadata = this.resolve(dict.get('Metadata') ?? null)
    if (metadata !== null) {
      if (!(metadata instanceof PdfStream)) throw new Error('PDF import error: Form XObject Metadata must be a stream')
      const metadataType = this.resolve(metadata.dict.get('Type') ?? null)
      const metadataSubtype = this.resolve(metadata.dict.get('Subtype') ?? null)
      if (!(metadataType instanceof PdfName) || metadataType.name !== 'Metadata') throw new Error('PDF import error: Form Metadata Type must be /Metadata')
      if (!(metadataSubtype instanceof PdfName) || metadataSubtype.name !== 'XML') throw new Error('PDF import error: Form Metadata Subtype must be /XML')
      parsePdfXmpPacket(this.doc.decodeStream(metadata))
      const rawMetadata = rawPdfValue(this.doc, metadata, new Set<object>())
      if (typeof rawMetadata !== 'object' || rawMetadata === null || rawMetadata.kind !== 'stream') {
        throw new Error('PDF import error: Form Metadata stream preservation failed')
      }
      form.metadata = rawMetadata
    }

    const pieceInfo = this.resolve(dict.get('PieceInfo') ?? null)
    if (pieceInfo !== null) {
      if (!(pieceInfo instanceof Map)) throw new Error('PDF import error: Form XObject PieceInfo must be a dictionary')
      form.pieceInfo = rawPdfDictionary(this.doc, pieceInfo, new Set<object>())
    }
    const lastModifiedValue = dict.get('LastModified')
    if (pieceInfo !== null && lastModifiedValue === undefined) throw new Error('PDF import error: Form XObject PieceInfo requires LastModified')
    if (lastModifiedValue !== undefined) {
      const lastModified = this.resolve(lastModifiedValue)
      if (!(lastModified instanceof PdfString)) throw new Error('PDF import error: Form XObject LastModified must be a date string')
      form.lastModified = rawPdfValue(this.doc, lastModified, new Set<object>())
    }

    const structParent = this.optionalNonNegativeInteger(dict, 'StructParent')
    const structParents = this.optionalNonNegativeInteger(dict, 'StructParents')
    if (structParent !== null && structParents !== null) throw new Error('PDF import error: Form XObject cannot contain both StructParent and StructParents')
    if (structParent !== null) form.structParent = structParent
    if (structParents !== null) form.structParents = structParents

    const opi = readPdfOpiMetadata(this.doc, dict, 'Form XObject')
    if (opi !== null) form.opi = opi
    const formName = this.resolve(dict.get('Name') ?? null)
    if (formName !== null) {
      if (!(formName instanceof PdfName)) throw new Error('PDF import error: Form XObject Name must be a name')
      form.name = formName.name
    }
    const measure = this.resolve(dict.get('Measure') ?? null)
    if (measure !== null) {
      if (!(measure instanceof Map)) throw new Error('PDF import error: Form XObject Measure must be a dictionary')
      form.measure = pdfMeasurementFromRaw(rawPdfDictionary(this.doc, measure, new Set<object>()))
    }
    const pointData = this.resolve(dict.get('PtData') ?? null)
    if (pointData !== null) {
      form.pointData = pdfPointDataFromRaw(rawPdfValue(this.doc, pointData, new Set<object>()))
    }
    return form
  }

  private validateReferenceXObject(reference: PdfDict): void {
    const file = this.resolve(reference.get('F') ?? null)
    if (!(file instanceof PdfString) && !(file instanceof Map)) throw new Error('PDF import error: reference XObject Ref requires file specification F')
    const page = this.resolve(reference.get('Page') ?? null)
    if (!(page instanceof PdfString) && !(typeof page === 'number' && Number.isInteger(page) && page >= 0)) {
      throw new Error('PDF import error: reference XObject Ref Page must be a non-negative integer or text string')
    }
    const id = this.resolve(reference.get('ID') ?? null)
    if (id !== null) {
      if (!Array.isArray(id) || id.length !== 2) throw new Error('PDF import error: reference XObject Ref ID must contain two byte strings')
      for (let i = 0; i < id.length; i++) {
        if (!(this.resolve(id[i]!) instanceof PdfString)) throw new Error('PDF import error: reference XObject Ref ID must contain two byte strings')
      }
    }
  }

  private optionalNonNegativeInteger(dict: PdfDict, key: string): number | null {
    const value = this.resolve(dict.get(key) ?? null)
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`PDF import error: Form XObject ${key} must be a non-negative integer`)
    return value
  }

  private visibleImageXObject(base: PdfStream): PdfStream | null {
    const baseOc = base.dict.get('OC')
    if (baseOc === undefined || this.optionalContentVisible(baseOc)) return base
    const alternates = this.resolve(base.dict.get('Alternates') ?? null)
    if (!Array.isArray(alternates)) return base
    for (let i = 0; i < alternates.length; i++) {
      const alternate = this.resolve(alternates[i]!)
      if (!(alternate instanceof Map)) throw new Error('PDF import error: alternate image entry must be a dictionary')
      const oc = alternate.get('OC')
      if (oc === undefined || !this.optionalContentVisible(oc)) continue
      const image = this.resolve(alternate.get('Image') ?? null)
      if (!(image instanceof PdfStream)) throw new Error('PDF import error: alternate image dictionary requires an Image stream')
      return image
    }
    return base
  }

  private paintInlineImage(dict: PdfDict, data: Uint8Array): void {
    if (!this.isContentVisible()) return
    const placement = imagePlacement(this.state.ctm, this.pageHeight)
    const imported = importInlinePdfImage(
      this.doc,
      dict,
      data,
      this.state.fillColor,
      this.state.deviceParams?.useBlackPointCompensation === 'on',
      this.deviceCmykTransform,
    )
    const oriented = flipImportedPdfImage(imported, placement.flipX, placement.flipY)
    const imageId = this.registerImage(oriented.bytes, oriented.extension)
    this.pushElement(this.createImageElement(imageId, placement, oriented))
  }

  private registerImage(bytes: Uint8Array, extension: 'jpg' | 'png'): string {
    const imageId = `${this.imageIdPrefix}${this.imageCounter++}.${extension}`
    this.images[imageId] = bytes
    return imageId
  }

  private createImageElement(imageId: string, placement: ImagePlacement, imported: ImportedPdfImageData): ImageDef {
    const element: ImageDef = {
      type: 'image',
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      source: imageId,
      scaleMode: 'fillFrame',
    }
    if (placement.rotation !== 0) element.rotation = placement.rotation
    if (placement.affineTransform !== undefined) element.affineTransform = placement.affineTransform
    const opacity = this.effectiveFillOpacity()
    if (opacity !== 1) element.opacity = opacity
    this.applyGraphicsStateFlags(element, true, false)
    if (imported.intent !== null) element.renderingIntent = imported.intent
    element.interpolate = imported.interpolate ?? false
    if (imported.alternates.length > 0) {
      element.alternates = imported.alternates.map((alternate) => ({
        source: this.registerImage(alternate.image.bytes, alternate.image.extension),
        ...(alternate.defaultForPrinting ? { defaultForPrinting: true } : {}),
      }))
    }
    if (imported.opi !== null) element.opi = imported.opi
    if (imported.measure !== null) element.measure = imported.measure
    if (imported.pointData !== null) element.pointData = imported.pointData
    return element
  }

  private effectiveFillOpacity(): number {
    return clamp01(this.state.fillOpacity * this.state.softMaskAlpha)
  }

  private effectiveStrokeOpacity(): number {
    return clamp01(this.state.strokeOpacity * this.state.softMaskAlpha)
  }

  private applyExtGStateSoftMask(value: PdfValue): void {
    if (value instanceof PdfName) {
      if (value.name === 'None') {
        this.finalizeSoftMaskCapture()
        this.state.softMaskAlpha = 1
        return
      }
      throw new Error(`PDF import error: unsupported ExtGState soft mask name /${value.name}`)
    }
    if (value instanceof Map) {
      const constant = this.constantSoftMaskAlpha(value)
      if (constant !== null) {
        // Uniform mask: an exact constant alpha (composited over the backdrop).
        this.finalizeSoftMaskCapture()
        this.state.softMaskAlpha = constant
        return
      }
      // Non-uniform mask: reconstruct the mask group as a real per-pixel soft
      // mask and capture the range of content painted while it is active.
      this.beginRealSoftMask(value)
      return
    }
    throw new Error('PDF import error: ExtGState /SMask must be /None or a dictionary')
  }

  /**
   * Start a real (per-pixel) soft mask (PDF 11.6.5.2). The mask group is
   * interpreted in the current page coordinate space so its elements align
   * with the masked content; every element painted until the mask is cleared
   * (Q past the mask's scope, /SMask /None, or end of stream) is wrapped in a
   * frame carrying the mask.
   */
  private beginRealSoftMask(dict: PdfDict): void {
    this.finalizeSoftMaskCapture()
    this.flushPendingText()
    const subtype = this.resolve(dict.get('S') ?? null)
    if (!(subtype instanceof PdfName)) throw new Error('PDF import error: ExtGState /SMask dictionary requires /S')
    // /SMask /TR remaps the computed mask value; a function is captured (and
    // applied per-pixel by the backends), /Identity or absent means none.
    const transfer = this.resolve(dict.get('TR') ?? null)
    let transferFunction: 'Identity' | TransferFunctionDef | undefined
    if (transfer instanceof PdfName && transfer.name === 'Identity') transferFunction = 'Identity'
    else if (transfer !== null) transferFunction = this.readScalarTransferFunction(transfer)
    const group = this.resolve(dict.get('G') ?? null)
    if (!(group instanceof PdfStream)) throw new Error('PDF import error: ExtGState /SMask dictionary requires form XObject /G')
    const groupResources = this.resolve(group.dict.get('Resources') ?? null)
    const groupDictionary = this.resolve(group.dict.get('Group') ?? null)
    if (!(groupDictionary instanceof Map)) throw new Error('PDF import error: ExtGState /SMask /G requires a transparency group')
    const groupSubtype = this.resolve(groupDictionary.get('S') ?? null)
    if (!(groupSubtype instanceof PdfName) || groupSubtype.name !== 'Transparency') {
      throw new Error('PDF import error: ExtGState /SMask /G group must be /Transparency')
    }
    let colorSpace: PdfProcessColorSpaceDef | undefined
    const colorSpaceValue = groupDictionary.get('CS')
    if (colorSpaceValue !== undefined) {
      const parsed = pdfShadingColorSpaceDef(
        this.doc,
        parsePdfColorSpace(this.doc, colorSpaceValue, groupResources instanceof Map ? groupResources : this.resources),
      )
      if (parsed.kind === 'separation' || parsed.kind === 'deviceN' || parsed.kind === 'indexed') {
        throw new Error('PDF import error: soft-mask transparency Group /CS must be a process color space')
      }
      colorSpace = parsed
    }
    const isolatedValue = this.resolve(groupDictionary.get('I') ?? null)
    if (isolatedValue !== null && typeof isolatedValue !== 'boolean') {
      throw new Error('PDF import error: soft-mask transparency Group /I must be boolean')
    }
    const isolated = typeof isolatedValue === 'boolean' ? isolatedValue : undefined
    const knockoutValue = this.resolve(groupDictionary.get('K') ?? null)
    if (knockoutValue !== null && typeof knockoutValue !== 'boolean') {
      throw new Error('PDF import error: soft-mask transparency Group /K must be boolean')
    }
    const knockout = typeof knockoutValue === 'boolean' ? knockoutValue : undefined
    const groupMatrix = this.resolve(group.dict.get('Matrix') ?? null)
    const formMatrix: Matrix = Array.isArray(groupMatrix) && groupMatrix.length >= 6
      ? valuesToMatrix(groupMatrix)
      : [1, 0, 0, 1, 0, 0]
    const bbox = normalizePdfRectangle(this.numberArray(group.dict.get('BBox') ?? null, 'soft mask group BBox'), 'soft mask group BBox')
    const interpreter = new PdfContentInterpreter({
      doc: this.doc,
      pageWidth: this.pageWidth,
      pageHeight: this.pageHeight,
      initialMatrix: multiplyMatrix(this.state.ctm, formMatrix),
      resources: groupResources instanceof Map ? groupResources : this.resources,
      fontResolver: this.fontResolver,
      outlineText: this.outlineText,
      outlineDpi: this.outlineDpi,
      imageIdPrefix: `${this.imageIdPrefix}_smask${this.imageCounter++}_`,
      // Form XObject content is clipped to its /BBox (ISO 32000 §8.10.1);
      // content outside the mask box takes the backdrop, not the mask value.
      clipBBox: [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!],
      deviceCmykTransform: this.deviceCmykTransform,
    })
    interpreter.interpret(this.doc.decodeStream(group))
    const maskElements = interpreter.finalize()
    const maskImages = interpreter.getImages()
    for (const key in maskImages) this.images[key] = maskImages[key]!
    const backdrop = this.softMaskBackdrop(dict)
    this.activeSoftMaskCapture = {
      start: this.elements.length,
      stackDepth: this.stack.length,
      mask: {
        type: subtype.name === 'Luminosity' ? 'luminosity' : 'alpha',
        colorSpace,
        ...(isolated !== undefined ? { isolated } : {}),
        ...(knockout !== undefined ? { knockout } : {}),
        backdrop,
        elements: maskElements,
        ...(transferFunction !== undefined ? { transferFunction } : {}),
      },
    }
    this.state.softMaskAlpha = 1
  }

  /** Reads the /SMask /BC backdrop color as a DeviceRGB triple, if present. */
  private softMaskBackdrop(dict: PdfDict): [number, number, number] | undefined {
    const bc = this.resolve(dict.get('BC') ?? null)
    if (!Array.isArray(bc) || bc.length === 0) return undefined
    const comps: number[] = []
    for (let i = 0; i < bc.length; i++) {
      const v = this.resolve(bc[i]!)
      if (typeof v !== 'number') return undefined
      comps.push(v)
    }
    if (comps.length === 1) return [comps[0]!, comps[0]!, comps[0]!]
    if (comps.length >= 3) return [comps[0]!, comps[1]!, comps[2]!]
    return undefined
  }

  /**
   * Finalize the active real soft mask: wrap every element painted while it was
   * active in a non-isolated frame carrying the reconstructed mask. The mask
   * ExtGState originally composites those objects against their current
   * backdrop; isolating this editing frame would change blend-mode results.
   * Mask and content share page coordinates, so both are offset by the same
   * content bounds to become frame-local.
   */
  private finalizeSoftMaskCapture(): void {
    const capture = this.activeSoftMaskCapture
    if (capture === null) return
    this.activeSoftMaskCapture = null
    this.flushPendingText()
    const captured = this.elements.splice(capture.start)
    if (captured.length === 0) return
    const bounds = elementListVisualBounds(captured)
    for (let i = 0; i < captured.length; i++) {
      translateElementToLocal(captured[i]!, bounds.x, bounds.y)
    }
    for (let i = 0; i < capture.mask.elements.length; i++) {
      translateElementToLocal(capture.mask.elements[i]!, bounds.x, bounds.y)
    }
    const frame: FrameDef = {
      type: 'frame',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isolated: false,
      softMask: {
        type: capture.mask.type,
        colorSpace: capture.mask.colorSpace,
        isolated: capture.mask.isolated,
        knockout: capture.mask.knockout,
        backdrop: capture.mask.backdrop,
        elements: capture.mask.elements,
        ...(capture.mask.transferFunction !== undefined ? { transferFunction: capture.mask.transferFunction } : {}),
      },
      elements: captured,
    }
    this.elements.push(frame)
    this.lastClipWrap = null
  }

  /**
   * Reads device print-production parameters (PDF ExtGState /TR /BG /UCR /HT).
   * Type 0/2/3/4 functions retain their normative dictionaries/streams,
   * including a four-function per-colorant /TR array.
   */
  private readDeviceParams(ext: PdfDict): DeviceParamsDef | null {
    const params: DeviceParamsDef = {}
    let has = false
    // §8.4.5: the /TR2 /BG2 /UCR2 variants supersede /TR /BG /UCR when present,
    // and additionally accept the name /Default (use the device default).
    const tr = this.resolve((ext.get('TR2') ?? ext.get('TR')) ?? null)
    if (tr !== null) {
      const f = this.readTransferFunction(tr)
      if (f !== null) { params.transferFunction = f; has = true }
    }
    const bg = this.resolve((ext.get('BG2') ?? ext.get('BG')) ?? null)
    if (bg !== null) {
      const f = this.readSeparationFunction(bg)
      if (f !== null) { params.blackGeneration = f; has = true }
    }
    const ucr = this.resolve((ext.get('UCR2') ?? ext.get('UCR')) ?? null)
    if (ucr !== null) {
      const f = this.readSeparationFunction(ucr)
      if (f !== null) { params.undercolorRemoval = f; has = true }
    }
    const ht = this.resolve(ext.get('HT') ?? null)
    if (ht !== null) {
      const h = this.readHalftone(ht)
      if (h !== null) { params.halftone = h; has = true }
    }
    const halftoneOrigin = this.resolve(ext.get('HTO') ?? null)
    if (halftoneOrigin !== null) {
      if (!Array.isArray(halftoneOrigin) || halftoneOrigin.length !== 2) throw new Error('PDF import error: /HTO must be an array of two numbers')
      const x = this.resolve(halftoneOrigin[0]!)
      const y = this.resolve(halftoneOrigin[1]!)
      if (typeof x !== 'number' || typeof y !== 'number') throw new Error('PDF import error: /HTO must contain two numbers')
      params.halftoneOrigin = [x, y]
      has = true
    }
    const blackPoint = this.resolve(ext.get('UseBlackPtComp') ?? null)
    if (blackPoint instanceof PdfName) {
      if (blackPoint.name === 'ON') params.useBlackPointCompensation = 'on'
      else if (blackPoint.name === 'OFF') params.useBlackPointCompensation = 'off'
      else if (blackPoint.name === 'Default') params.useBlackPointCompensation = 'default'
      else throw new Error(`PDF import error: unsupported /UseBlackPtComp value /${blackPoint.name}`)
      has = true
    }
    const flatness = this.resolve(ext.get('FL') ?? null)
    if (typeof flatness === 'number') { params.flatness = flatness; has = true }
    const smoothness = this.resolve(ext.get('SM') ?? null)
    if (typeof smoothness === 'number') { params.smoothness = smoothness; has = true }
    const strokeAdjustment = this.resolve(ext.get('SA') ?? null)
    if (typeof strokeAdjustment === 'boolean') { params.strokeAdjustment = strokeAdjustment; has = true }
    return has ? params : null
  }

  /** A /BG2 or /UCR2 value: the name /Default, or a convertible function. */
  private readSeparationFunction(value: PdfValue): 'Default' | CalculatorFunctionDef | null {
    if (value instanceof PdfName) return value.name === 'Default' ? 'Default' : null
    return this.readCalculatorFunction(value)
  }

  private readTransferFunction(value: PdfValue): 'Identity' | 'Default' | TransferFunctionDef | TransferFunctionDef[] | null {
    if (value instanceof PdfName) {
      if (value.name === 'Identity' || value.name === 'Default') return value.name
      throw new Error(`PDF import error: unsupported transfer function name /${value.name}`)
    }
    const resolved = this.resolve(value)
    // A per-colorant /TR array contains exactly four scalar functions (§10.4).
    if (Array.isArray(resolved)) {
      if (resolved.length !== 4) throw new Error('PDF import error: transfer function array must contain four functions')
      const fns: TransferFunctionDef[] = []
      for (const el of resolved) {
        fns.push(this.readScalarTransferFunction(el!))
      }
      return fns
    }
    return this.readScalarTransferFunction(value)
  }

  private readScalarTransferFunction(value: PdfValue): PdfFunctionDef {
    const fn = readPdfFunctionDef(this.doc, value)
    if (pdfFunctionInputCount(fn) !== 1 || pdfFunctionOutputCount(fn) !== 1) throw new Error('PDF import error: transfer function must map one input to one output')
    return fn
  }

  private readCalculatorFunction(value: PdfValue): CalculatorFunctionDef | null {
    const resolved = this.resolve(value)
    const dict = resolved instanceof PdfStream ? resolved.dict : (resolved instanceof Map ? resolved : null)
    if (dict === null) return null
    const functionType = this.resolve(dict.get('FunctionType') ?? null)
    if (functionType === 4) {
      if (!(resolved instanceof PdfStream)) return null
      const expression = new TextDecoder('latin1').decode(this.doc.decodeStream(resolved)).trim()
      return expression.length > 0 ? { expression } : null
    }
    // A type-2 (exponential) single-output function — the common transfer /
    // black-generation / undercolor-removal form — converts losslessly to the
    // equivalent type-4 calculator: y = C0 + x^N × (C1 − C0).
    if (functionType === 2) {
      const c0 = this.optionalNumberOrSingletonArray(dict.get('C0') ?? null, 0)
      const c1 = this.optionalNumberOrSingletonArray(dict.get('C1') ?? null, 1)
      const n = this.resolve(dict.get('N') ?? null)
      if (c0 === null || c1 === null || typeof n !== 'number') return null
      const delta = c1 - c0
      return { expression: `{ ${formatPostScriptNumber(n)} exp ${formatPostScriptNumber(delta)} mul ${formatPostScriptNumber(c0)} add }` }
    }
    // A type-3 (stitching) function is converted to a calculator that selects a
    // sub-function by input range, interpolating the input into each piece's
    // Encode domain — provided every sub-function is itself convertible.
    if (functionType === 3) {
      const domainV = this.resolve(dict.get('Domain') ?? null)
      const funcsV = this.resolve(dict.get('Functions') ?? null)
      const boundsV = this.resolve(dict.get('Bounds') ?? null)
      const encodeV = this.resolve(dict.get('Encode') ?? null)
      if (!Array.isArray(domainV) || !Array.isArray(funcsV) || !Array.isArray(boundsV) || !Array.isArray(encodeV)) return null
      const domain = this.numberArray(domainV, 'stitching Domain')
      const bounds = this.numberArray(boundsV, 'stitching Bounds')
      const encode = this.numberArray(encodeV, 'stitching Encode')
      const count = funcsV.length
      if (domain.length !== 2 || count === 0 || bounds.length !== count - 1 || encode.length !== count * 2) return null
      const subBodies: string[] = []
      for (const f of funcsV) {
        const sub = this.readCalculatorFunction(f!)
        if (sub === null) return null
        subBodies.push(sub.expression.replace(/^\{/, '').replace(/\}$/, '').trim()) // inline the procedure body
      }
      const segment = (k: number): string => {
        const low = k === 0 ? domain[0]! : bounds[k - 1]!
        const high = k === count - 1 ? domain[1]! : bounds[k]!
        const e0 = encode[2 * k]!
        const e1 = encode[2 * k + 1]!
        const span = high - low
        const factor = span === 0 ? 0 : (e1 - e0) / span
        // Input x is on the stack: interpolate into [e0, e1], then run the sub-function.
        return `${formatPostScriptNumber(low)} sub ${formatPostScriptNumber(factor)} mul ${formatPostScriptNumber(e0)} add ${subBodies[k]}`
      }
      const build = (k: number): string =>
        k === count - 1 ? segment(k) : `dup ${formatPostScriptNumber(bounds[k]!)} lt { ${segment(k)} } { ${build(k + 1)} } ifelse`
      return { expression: `{ ${build(0)} }` }
    }
    // A type-0 (sampled) single-output function is lowered to the equivalent
    // calculator by piecewise-linear interpolation over its Size[0] samples,
    // so every transfer / black-generation / undercolor function is carried
    // uniformly as a type-4 expression (matching the type-2 / type-3 lowering).
    if (functionType === 0) {
      if (!(resolved instanceof PdfStream)) return null
      const sizeV = this.resolve(dict.get('Size') ?? null)
      if (!Array.isArray(sizeV)) return null
      const size = this.numberArray(sizeV, 'sampled function Size')
      if (size.length !== 1 || size[0]! < 2) return null
      const count = size[0]!
      const domainV = this.resolve(dict.get('Domain') ?? null)
      const domain = Array.isArray(domainV) ? this.numberArray(domainV, 'sampled function Domain') : [0, 1]
      if (domain.length !== 2) return null
      const pos = (i: number): number => domain[0]! + (i / (count - 1)) * (domain[1]! - domain[0]!)
      // Decode each grid point to its single output value.
      const s: number[] = []
      for (let i = 0; i < count; i++) {
        const values = evaluateSampledFunction(this.doc, resolved, [pos(i)])
        if (values.length !== 1) return null
        s.push(values[0]!)
      }
      const segment = (k: number): string => {
        const span = pos(k + 1) - pos(k)
        const slope = span === 0 ? 0 : (s[k + 1]! - s[k]!) / span
        return `${formatPostScriptNumber(pos(k))} sub ${formatPostScriptNumber(slope)} mul ${formatPostScriptNumber(s[k]!)} add`
      }
      const build = (k: number): string =>
        k === count - 2 ? segment(k) : `dup ${formatPostScriptNumber(pos(k + 1))} lt { ${segment(k)} } { ${build(k + 1)} } ifelse`
      return { expression: `{ ${build(0)} }` }
    }
    return null
  }

  /** A scalar function coefficient given as a number or a one-element array. */
  private optionalNumberOrSingletonArray(value: PdfValue, fallback: number): number | null {
    const resolved = this.resolve(value)
    if (resolved === null) return fallback
    if (typeof resolved === 'number') return resolved
    if (Array.isArray(resolved) && resolved.length === 1) {
      const only = this.resolve(resolved[0]!)
      if (typeof only === 'number') return only
    }
    return null
  }

  /** A halftone dictionary's /TransferFunction (§10.6.5): 'Identity' or a
   *  convertible function; absent when the key is missing or unsupported. */
  private readHalftoneTransfer(dict: PdfDict): 'Identity' | TransferFunctionDef | undefined {
    const value = this.resolve(dict.get('TransferFunction') ?? null)
    if (value === null) return undefined
    if (value instanceof PdfName) {
      if (value.name === 'Identity') return 'Identity'
      throw new Error(`PDF import error: unsupported halftone TransferFunction name /${value.name}`)
    }
    return this.readScalarTransferFunction(value)
  }

  private readHalftone(value: PdfValue): 'Default' | HalftoneDef | null {
    if (value instanceof PdfName) return value.name === 'Default' ? 'Default' : null
    const dict = value instanceof PdfStream ? value.dict : (value instanceof Map ? value : null)
    if (dict === null) return null
    const halftoneType = this.resolve(dict.get('HalftoneType') ?? null)
    if (halftoneType === 1) {
      const frequency = this.resolve(dict.get('Frequency') ?? null)
      const angle = this.resolve(dict.get('Angle') ?? null)
      const spot = this.resolve(dict.get('SpotFunction') ?? null)
      if (typeof frequency !== 'number' || typeof angle !== 'number') return null
      // /SpotFunction is either a predefined name or a function (§10.6.5.2).
      let screen: HalftoneScreenDef
      if (spot instanceof PdfName) screen = { frequency, angle, spotFunction: spot.name }
      else {
        const fn = this.readCalculatorFunction(spot)
        if (fn === null) return null
        screen = { frequency, angle, spotFunction: fn }
      }
      const accurateScreens = this.resolve(dict.get('AccurateScreens') ?? null)
      if (accurateScreens !== null) {
        if (typeof accurateScreens !== 'boolean') throw new Error('PDF import error: halftone /AccurateScreens must be a boolean')
        screen.accurateScreens = accurateScreens
      }
      const tf = this.readHalftoneTransfer(dict)
      if (tf !== undefined) screen.transferFunction = tf
      return screen
    }
    // Type-6 threshold array: Width×Height 8-bit thresholds in the stream data.
    if (halftoneType === 6 && value instanceof PdfStream) {
      const width = this.resolve(dict.get('Width') ?? null)
      const height = this.resolve(dict.get('Height') ?? null)
      if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return null
      const data = this.doc.decodeStream(value)
      if (data.length < width * height) return null
      const thresholds: number[] = []
      for (let i = 0; i < width * height; i++) thresholds.push(data[i]!)
      const result: HalftoneThresholdDef = { type: 6, width, height, thresholds }
      const tf = this.readHalftoneTransfer(dict)
      if (tf !== undefined) result.transferFunction = tf
      return result
    }
    // Type-10 angled threshold array: (Xsquare²+Ysquare²) 8-bit thresholds.
    if (halftoneType === 10 && value instanceof PdfStream) {
      const xsquare = this.resolve(dict.get('Xsquare') ?? null)
      const ysquare = this.resolve(dict.get('Ysquare') ?? null)
      if (typeof xsquare !== 'number' || typeof ysquare !== 'number' || xsquare <= 0 || ysquare <= 0) return null
      const count = xsquare * xsquare + ysquare * ysquare
      const data = this.doc.decodeStream(value)
      if (data.length < count) return null
      const thresholds: number[] = []
      for (let i = 0; i < count; i++) thresholds.push(data[i]!)
      const result: HalftoneAngledDef = { type: 10, xsquare, ysquare, thresholds }
      const tf = this.readHalftoneTransfer(dict)
      if (tf !== undefined) result.transferFunction = tf
      return result
    }
    // Type-16 threshold array: 16-bit thresholds, optional second rectangle.
    if (halftoneType === 16 && value instanceof PdfStream) {
      const width = this.resolve(dict.get('Width') ?? null)
      const height = this.resolve(dict.get('Height') ?? null)
      const width2 = this.resolve(dict.get('Width2') ?? null)
      const height2 = this.resolve(dict.get('Height2') ?? null)
      if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return null
      const hasSecond = typeof width2 === 'number' && typeof height2 === 'number' && width2 > 0 && height2 > 0
      const count = width * height + (hasSecond ? width2 * height2 : 0)
      const data = this.doc.decodeStream(value)
      if (data.length < count * 2) return null
      const thresholds: number[] = []
      for (let i = 0; i < count; i++) thresholds.push((data[i * 2]! << 8) | data[i * 2 + 1]!)
      const result: HalftoneThreshold16Def = { type: 16, width, height, thresholds }
      if (hasSecond) { result.width2 = width2; result.height2 = height2 }
      const tf = this.readHalftoneTransfer(dict)
      if (tf !== undefined) result.transferFunction = tf
      return result
    }
    // Type-5: a dictionary of per-colorant halftones.
    if (halftoneType === 5 && value instanceof Map) {
      const halftones: HalftoneCollectionDef['halftones'] = []
      for (const [key, entry] of value) {
        if (key === 'Type' || key === 'HalftoneType') continue
        const sub = this.readHalftone(this.resolve(entry))
        if (sub === null || sub === 'Default' || sub.type === 5) return null
        halftones.push({ colorant: key, halftone: sub })
      }
      return halftones.length > 0 ? { type: 5, halftones } : null
    }
    return null
  }

  private beginDeviceParamsCapture(params: DeviceParamsDef): void {
    this.finalizeDeviceParamsCapture()
    this.flushPendingText()
    this.activeDeviceParamsCapture = { start: this.elements.length, stackDepth: this.stack.length, params }
  }

  private setDeviceParams(params: DeviceParamsDef): void {
    this.state.deviceParams = { ...(this.state.deviceParams ?? {}), ...params }
    this.beginDeviceParamsCapture(this.state.deviceParams)
  }

  /** Wraps content painted while device params were active in a frame carrying them. */
  private finalizeDeviceParamsCapture(): void {
    const capture = this.activeDeviceParamsCapture
    if (capture === null) return
    this.activeDeviceParamsCapture = null
    this.flushPendingText()
    const captured = this.elements.splice(capture.start)
    if (captured.length === 0) return
    const bounds = elementListVisualBounds(captured)
    for (let i = 0; i < captured.length; i++) {
      translateElementToLocal(captured[i]!, bounds.x, bounds.y)
    }
    this.elements.push({
      type: 'frame',
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      // This frame scopes scan-conversion parameters; it is not a PDF clip.
      // Its bounds are an allocation/culling hint only and must never cut
      // transformed vector paint or stroke overhang.
      clip: false,
      deviceParams: capture.params,
      elements: captured,
    })
    this.lastClipWrap = null
  }

  private constantSoftMaskAlpha(dict: PdfDict): number | null {
    const subtype = this.resolve(dict.get('S') ?? null)
    if (!(subtype instanceof PdfName)) throw new Error('PDF import error: ExtGState /SMask dictionary requires /S')
    if (subtype.name !== 'Alpha' && subtype.name !== 'Luminosity') {
      throw new Error(`PDF import error: unsupported ExtGState /SMask subtype /${subtype.name}`)
    }
    const transferValue = dict.get('TR') ?? null
    const transfer = this.resolve(transferValue)
    if (transfer instanceof PdfName && transfer.name !== 'Identity') {
      throw new Error(`PDF import error: unsupported ExtGState /SMask transfer function /${transfer.name}`)
    }
    const group = this.resolve(dict.get('G') ?? null)
    if (!(group instanceof PdfStream)) throw new Error('PDF import error: ExtGState /SMask dictionary requires form XObject /G')
    const groupSubtype = this.resolve(group.dict.get('Subtype') ?? null)
    if (!(groupSubtype instanceof PdfName) || groupSubtype.name !== 'Form') {
      throw new Error('PDF import error: ExtGState /SMask /G must be a Form XObject')
    }
    const groupDict = this.resolve(group.dict.get('Group') ?? null)
    if (!(groupDict instanceof Map)) throw new Error('PDF import error: ExtGState /SMask /G requires a transparency group')
    const groupS = this.resolve(groupDict.get('S') ?? null)
    if (!(groupS instanceof PdfName) || groupS.name !== 'Transparency') {
      throw new Error('PDF import error: ExtGState /SMask /G group must be /Transparency')
    }
    const bbox = normalizePdfRectangle(this.numberArray(group.dict.get('BBox') ?? null, 'soft mask group BBox'), 'soft mask group BBox')
    const width = bbox[2]! - bbox[0]!
    const height = bbox[3]! - bbox[1]!
    // A degenerate (zero-area) soft-mask BBox covers nothing and cannot
    // define a mask; rather than failing the page, drop the soft mask (no-op),
    // matching the treatment of other degenerate geometry on import.
    if (width <= 0 || height <= 0) return null
    const groupResources = this.resolve(group.dict.get('Resources') ?? null)
    const interpreter = new PdfContentInterpreter({
      doc: this.doc,
      pageWidth: width,
      pageHeight: height,
      initialMatrix: [1, 0, 0, 1, -bbox[0]!, -bbox[1]!],
      resources: groupResources instanceof Map ? groupResources : this.resources,
      fontResolver: this.fontResolver,
      outlineText: this.outlineText,
      outlineDpi: this.outlineDpi,
      imageIdPrefix: `${this.imageIdPrefix}_smask${this.imageCounter}_`,
      deviceCmykTransform: this.deviceCmykTransform,
    })
    const elements = interpreter.interpret(this.doc.decodeStream(group))
    const alpha = constantAlphaFromSoftMaskElements(elements, width, height, subtype.name, interpreter.getImages())
    if (alpha === null) return null
    return this.applySoftMaskTransfer(transferValue, alpha)
  }

  private applySoftMaskTransfer(value: PdfValue, alpha: number): number {
    const transfer = this.resolve(value)
    if (transfer === null) return alpha
    if (transfer instanceof PdfName && transfer.name === 'Identity') return alpha
    if (transfer instanceof PdfName) {
      throw new Error(`PDF import error: unsupported ExtGState /SMask transfer function /${transfer.name}`)
    }
    const values = this.functionValuesAt(value, alpha)
    if (values.length !== 1) throw new Error('PDF import error: ExtGState /SMask transfer function must produce one value')
    return clamp01(values[0]!)
  }

  private applyGraphicsStateFlags(element: ElementDef, fill: boolean, stroke: boolean): void {
    if (this.state.blendMode !== 'normal') element.blendMode = this.state.blendMode
    if (fill && this.state.fillOverprint) element.overprintFill = true
    if (stroke && this.state.strokeOverprint) element.overprintStroke = true
    if ((element.overprintFill === true || element.overprintStroke === true) && this.state.overprintMode !== 0) {
      element.overprintMode = this.state.overprintMode
    }
    if (this.state.renderingIntent !== null) element.renderingIntent = this.state.renderingIntent
    if (this.state.alphaIsShape) element.alphaIsShape = true
    if (!this.state.textKnockout) element.textKnockout = false
  }

  private applyTextPaintMode(element: StaticTextDef, mode: number): void {
    const paintMode = mode & 3
    if (paintMode === 1) {
      element.textPaintMode = 'stroke'
      element.textStrokeColor = this.state.strokeColor
      element.textStrokeWidth = this.state.lineWidth
    } else if (paintMode === 2) {
      element.textPaintMode = 'fillStroke'
      element.textStrokeColor = this.state.strokeColor
      element.textStrokeWidth = this.state.lineWidth
    }
  }

  private dictResource(kind: string, name: string): PdfDict | PdfStream {
    const value = this.resourceValue(kind, name)
    const resolved = this.resolve(value)
    if (!(resolved instanceof Map) && !(resolved instanceof PdfStream)) {
      throw new Error(`PDF import error: resource /${kind} /${name} must be a dictionary or stream`)
    }
    return resolved
  }

  private plainDictResource(kind: string, name: string): PdfDict {
    const value = this.dictResource(kind, name)
    if (!(value instanceof Map)) {
      throw new Error(`PDF import error: resource /${kind} /${name} must be a dictionary`)
    }
    return value
  }

  private resourceRef(kind: string, name: string): PdfRef | null {
    const group = this.resolve(this.resources.get(kind) ?? null)
    if (!(group instanceof Map)) throw new Error(`PDF import error: resource dictionary /${kind} not found`)
    const value = group.get(name)
    return value instanceof PdfRef ? value : null
  }

  private resourceValue(kind: string, name: string): PdfValue {
    const group = this.resolve(this.resources.get(kind) ?? null)
    if (!(group instanceof Map)) throw new Error(`PDF import error: resource dictionary /${kind} not found`)
    const value = group.get(name)
    if (value === undefined) throw new Error(`PDF import error: resource /${kind} /${name} not found`)
    return value
  }

  private point(x: number, y: number): [number, number] {
    const p = transformPoint(this.state.ctm, x, y)
    return [p[0], this.pageHeight - p[1]]
  }

  /** Like point(), but through an explicit coordinate space matrix. */
  private pointIn(space: Matrix, x: number, y: number): [number, number] {
    const p = transformPoint(space, x, y)
    return [p[0], this.pageHeight - p[1]]
  }

  private num(index: number): number {
    const value = this.resolve(this.operands[index] ?? null)
    if (typeof value !== 'number') throw new Error(`PDF import error: numeric operand ${index} expected`)
    return value
  }

  private requireOperandCount(count: number, operator: string): void {
    if (this.operands.length !== count) {
      throw new Error(`PDF import error: content operator ${operator} requires ${count} operands, got ${this.operands.length}`)
    }
  }

  private nameOperand(index: number): string {
    const value = this.resolve(this.operands[index] ?? null)
    if (!(value instanceof PdfName)) throw new Error(`PDF import error: name operand ${index} expected`)
    return value.name
  }

  private resolve(value: PdfValue): PdfValue {
    return this.doc.resolve(value)
  }

  private beginMarkedContent(definition: MarkedContentDefinition): void {
    this.flushPendingText()
    this.markedContentStack.push({
      optionalContent: definition.optionalContent,
      actualText: definition.actualText,
      actualTextAssigned: false,
      elementStart: this.elements.length,
    })
  }

  private endMarkedContent(): void {
    this.flushPendingText()
    const marked = this.markedContentStack.pop()
    if (marked === undefined) throw new Error('PDF import error: marked content stack underflow')
    if (marked.optionalContent === null || marked.elementStart === this.elements.length) return
    const children = this.elements.splice(marked.elementStart)
    const bounds = elementListVisualBounds(children)
    for (let i = 0; i < children.length; i++) {
      translateElementToLocal(children[i]!, bounds.x, bounds.y)
    }
    this.elements.push({
      type: 'frame', x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      optionalContent: marked.optionalContent,
      elements: children,
    })
    this.lastClipWrap = null
  }

  private isContentVisible(): boolean {
    return true
  }

  private markedContentDefinition(): MarkedContentDefinition {
    const tag = this.resolve(this.operands[0] ?? null)
    if (!(tag instanceof PdfName)) throw new Error('PDF import error: marked content tag must be a name')
    const property = this.operands[1] ?? null
    const resolved = this.resolve(this.markedContentProperty(property))
    const optionalContent = tag.name === 'OC'
      ? this.optionalContentDefinition(this.markedContentProperty(property))
      : resolved instanceof Map && resolved.has('OC')
        ? this.optionalContentDefinition(resolved.get('OC')!)
        : null
    const actualTextValue = resolved instanceof Map ? this.resolve(resolved.get('ActualText') ?? null) : null
    if (actualTextValue !== null && !(actualTextValue instanceof PdfString)) {
      throw new Error('PDF import error: marked-content ActualText must be a string')
    }
    return {
      optionalContent,
      actualText: actualTextValue instanceof PdfString ? pdfStringToText(actualTextValue) : null,
    }
  }

  private applyMarkedContentActualText(element: StaticTextDef): void {
    for (let i = this.markedContentStack.length - 1; i >= 0; i--) {
      const frame = this.markedContentStack[i]!
      if (frame.actualText === null || frame.actualTextAssigned) continue
      element.actualText = frame.actualText
      frame.actualTextAssigned = true
      return
    }
  }

  private markedContentProperty(value: PdfValue): PdfValue {
    const resolved = this.resolve(value)
    if (resolved instanceof PdfName) return this.resourceValue('Properties', resolved.name)
    return value
  }

  private optionalContentDefinition(value: PdfValue): OptionalContentDef {
    const resolved = this.resolve(value)
    if (!(resolved instanceof Map)) throw new Error('PDF import error: optional content property must be a dictionary')
    const type = this.resolve(resolved.get('Type') ?? null)
    let membership: PdfOptionalContentGroupDef | PdfOptionalContentMembershipDef
    if (type instanceof PdfName && type.name === 'OCG') membership = this.readOptionalContentGroup(value)
    else if (type instanceof PdfName && type.name === 'OCMD') membership = this.readOptionalContentMembership(resolved)
    else throw new Error('PDF import error: optional content property Type must be /OCG or /OCMD')
    const properties = this.readOptionalContentProperties()
    return {
      name: membership.kind === 'group' ? membership.name : membership.groups.map(function (group) { return group.name }).join(' / '),
      visible: this.optionalContentVisibleForEvent(value, this.optionalContentContext.event),
      print: this.optionalContentVisibleForEvent(value, 'Print'),
      membership,
      ...(properties === undefined ? {} : { properties }),
    }
  }

  private readOptionalContentGroup(value: PdfValue): PdfOptionalContentGroupDef {
    if (!(value instanceof PdfRef)) throw new Error('PDF import error: optional content groups must be indirect objects')
    const resolved = this.resolve(value)
    if (!(resolved instanceof Map)) throw new Error('PDF import error: optional content group must be a dictionary')
    const type = this.resolve(resolved.get('Type') ?? null)
    if (!(type instanceof PdfName) || type.name !== 'OCG') throw new Error('PDF import error: optional content group Type must be /OCG')
    const name = this.resolve(resolved.get('Name') ?? null)
    if (!(name instanceof PdfString)) throw new Error('PDF import error: optional content group requires text string Name')
    const intents = this.optionalContentIntentArray(resolved.get('Intent'), false)
    if (intents === 'All') throw new Error('PDF import error: OCG Intent cannot be /All')
    const group: PdfOptionalContentGroupDef = {
      kind: 'group', id: this.optionalContentGroupId(value), name: pdfStringToText(name), intents,
    }
    const usage = this.resolve(resolved.get('Usage') ?? null)
    if (usage !== null) {
      if (!(usage instanceof Map)) throw new Error('PDF import error: optional content group Usage must be a dictionary')
      this.validateOptionalContentUsage(usage)
      group.usage = rawPdfDictionary(this.doc, usage, new Set<object>())
    }
    return group
  }

  private optionalContentGroupId(value: PdfValue): string {
    const ref = value as PdfRef
    return `ocg-${ref.num}-${ref.gen}`
  }

  private readOptionalContentMembership(dict: PdfDict): PdfOptionalContentMembershipDef {
    const groupsValue = this.resolve(dict.get('OCGs') ?? null)
    const groupValues = groupsValue === null ? [] : Array.isArray(groupsValue) ? groupsValue : [dict.get('OCGs')!]
    const groups: PdfOptionalContentGroupDef[] = []
    for (let i = 0; i < groupValues.length; i++) {
      if (this.resolve(groupValues[i]!) === null) continue
      groups.push(this.readOptionalContentGroup(groupValues[i]!))
    }
    const policyValue = this.resolve(dict.get('P') ?? null)
    const policy = policyValue === null ? 'AnyOn' : policyValue instanceof PdfName ? policyValue.name : ''
    if (policy !== 'AllOn' && policy !== 'AnyOn' && policy !== 'AnyOff' && policy !== 'AllOff') {
      throw new Error('PDF import error: optional content membership P must be /AllOn, /AnyOn, /AnyOff, or /AllOff')
    }
    const membership: PdfOptionalContentMembershipDef = { kind: 'membership', groups, policy }
    const expression = this.resolve(dict.get('VE') ?? null)
    if (expression !== null) {
      if (!Array.isArray(expression)) throw new Error('PDF import error: optional content membership VE must be an array')
      membership.expression = this.readOptionalContentExpression(expression)
    }
    return membership
  }

  private readOptionalContentExpression(expr: PdfValue[]): PdfOptionalContentExpressionDef {
    if (expr.length < 2) throw new Error('PDF import error: optional content visibility expression requires operands')
    const op = this.resolve(expr[0]!)
    if (!(op instanceof PdfName) || (op.name !== 'And' && op.name !== 'Or' && op.name !== 'Not')) {
      throw new Error('PDF import error: optional content visibility expression has an invalid operator')
    }
    if (op.name === 'Not' && expr.length !== 2) throw new Error('PDF import error: optional content Not expression requires one operand')
    const operands: Array<PdfOptionalContentGroupDef | PdfOptionalContentExpressionDef> = []
    for (let i = 1; i < expr.length; i++) {
      const operand = this.resolve(expr[i]!)
      operands.push(Array.isArray(operand) ? this.readOptionalContentExpression(operand) : this.readOptionalContentGroup(expr[i]!))
    }
    return { operator: op.name, operands }
  }

  private readOptionalContentProperties(): PdfOptionalContentPropertiesDef | undefined {
    if (this.optionalContentPropertiesCache !== undefined) return this.optionalContentPropertiesCache
    const value = this.resolve(this.doc.getCatalog().get('OCProperties') ?? null)
    if (value === null) return undefined
    if (!(value instanceof Map)) throw new Error('PDF import error: Catalog OCProperties must be a dictionary')
    const groupValues = this.resolve(value.get('OCGs') ?? null)
    if (!Array.isArray(groupValues)) throw new Error('PDF import error: OCProperties requires OCGs array')
    const groups = groupValues.map((group) => this.readOptionalContentGroup(group))
    const known = new Set(groups.map(function (group) { return group.id }))
    const defaultValue = this.resolve(value.get('D') ?? null)
    if (!(defaultValue instanceof Map)) throw new Error('PDF import error: OCProperties requires default configuration D')
    const defaultConfiguration = this.readOptionalContentConfiguration(defaultValue, known, true)
    const configsValue = this.resolve(value.get('Configs') ?? null)
    if (configsValue !== null && !Array.isArray(configsValue)) throw new Error('PDF import error: OCProperties Configs must be an array')
    const configurations: PdfOptionalContentConfigurationDef[] = []
    if (Array.isArray(configsValue)) {
      for (let i = 0; i < configsValue.length; i++) {
        const config = this.resolve(configsValue[i]!)
        if (!(config instanceof Map)) throw new Error('PDF import error: OCProperties Configs entries must be dictionaries')
        configurations.push(this.readOptionalContentConfiguration(config, known, false))
      }
    }
    this.optionalContentPropertiesCache = { groups, defaultConfiguration, configurations }
    return this.optionalContentPropertiesCache
  }

  private readOptionalContentConfiguration(dict: PdfDict, known: Set<string>, isDefault: boolean): PdfOptionalContentConfigurationDef {
    const baseValue = this.resolve(dict.get('BaseState') ?? null)
    const baseState = baseValue === null ? 'ON' : baseValue instanceof PdfName ? baseValue.name : ''
    if (baseState !== 'ON' && baseState !== 'OFF' && baseState !== 'Unchanged') throw new Error('PDF import error: optional content BaseState is invalid')
    if (isDefault && baseState !== 'ON') throw new Error('PDF import error: default optional content configuration BaseState must be /ON')
    const intents = this.optionalContentIntentArray(dict.get('Intent'), true)
    if (isDefault && (intents === 'All' || intents.length !== 1 || intents[0] !== 'View')) {
      throw new Error('PDF import error: default optional content configuration Intent must be /View')
    }
    const config: PdfOptionalContentConfigurationDef = {
      baseState,
      on: this.optionalContentGroupIdArray(dict.get('ON'), known, 'ON'),
      off: this.optionalContentGroupIdArray(dict.get('OFF'), known, 'OFF'),
      intents,
      applications: this.readOptionalContentApplications(dict.get('AS'), known),
      order: this.readOptionalContentOrder(dict.get('Order'), known),
      listMode: this.optionalContentListMode(dict.get('ListMode')),
      radioButtonGroups: this.readOptionalContentRadioGroups(dict.get('RBGroups'), known),
      locked: this.optionalContentGroupIdArray(dict.get('Locked'), known, 'Locked'),
    }
    const radioMembers = new Set<string>()
    for (let i = 0; i < config.radioButtonGroups.length; i++) {
      const radio = config.radioButtonGroups[i]!
      let enabled = 0
      for (let ri = 0; ri < radio.length; ri++) {
        if (radioMembers.has(radio[ri]!)) throw new Error('PDF import error: an OCG cannot belong to multiple RBGroups collections')
        radioMembers.add(radio[ri]!)
        const state = config.off.includes(radio[ri]!) ? false : config.on.includes(radio[ri]!) ? true : config.baseState !== 'OFF'
        if (state) enabled++
      }
      if (enabled > 1) throw new Error('PDF import error: RBGroups initial state may enable at most one OCG')
    }
    const name = this.resolve(dict.get('Name') ?? null)
    if (name !== null) {
      if (!(name instanceof PdfString)) throw new Error('PDF import error: optional content configuration Name must be a text string')
      config.name = pdfStringToText(name)
    }
    const creator = this.resolve(dict.get('Creator') ?? null)
    if (creator !== null) {
      if (!(creator instanceof PdfString)) throw new Error('PDF import error: optional content configuration Creator must be a text string')
      config.creator = pdfStringToText(creator)
    }
    return config
  }

  private optionalContentIntentArray(value: PdfValue | undefined, allowAll: boolean): string[] | 'All' {
    const resolved = this.resolve(value ?? null)
    if (resolved === null) return ['View']
    const values = Array.isArray(resolved) ? resolved : [value!]
    const intents: string[] = []
    for (let i = 0; i < values.length; i++) {
      const intent = this.resolve(values[i]!)
      if (!(intent instanceof PdfName)) throw new Error('PDF import error: optional content Intent must contain names')
      if (intent.name === 'All') {
        if (!allowAll || values.length !== 1) throw new Error('PDF import error: optional content Intent /All must be the only configuration intent')
        return 'All'
      }
      intents.push(intent.name)
    }
    return intents
  }

  private optionalContentGroupIdArray(value: PdfValue | undefined, known: Set<string>, label: string): string[] {
    const resolved = this.resolve(value ?? null)
    if (resolved === null) return []
    if (!Array.isArray(resolved)) throw new Error(`PDF import error: optional content ${label} must be an array`)
    const ids: string[] = []
    const seen = new Set<string>()
    for (let i = 0; i < resolved.length; i++) {
      const group = this.readOptionalContentGroup(resolved[i]!)
      if (!known.has(group.id)) throw new Error(`PDF import error: optional content ${label} references an OCG absent from OCProperties OCGs`)
      if (seen.has(group.id)) throw new Error(`PDF import error: optional content ${label} contains a duplicate OCG`)
      seen.add(group.id)
      ids.push(group.id)
    }
    return ids
  }

  private readOptionalContentApplications(value: PdfValue | undefined, known: Set<string>): PdfOptionalContentUsageApplicationDef[] {
    const resolved = this.resolve(value ?? null)
    if (resolved === null) return []
    if (!Array.isArray(resolved)) throw new Error('PDF import error: optional content AS must be an array')
    const applications: PdfOptionalContentUsageApplicationDef[] = []
    for (let i = 0; i < resolved.length; i++) {
      const dict = this.resolve(resolved[i]!)
      if (!(dict instanceof Map)) throw new Error('PDF import error: optional content AS entries must be dictionaries')
      const event = this.resolve(dict.get('Event') ?? null)
      if (!(event instanceof PdfName) || (event.name !== 'View' && event.name !== 'Print' && event.name !== 'Export')) {
        throw new Error('PDF import error: optional content usage application Event is invalid')
      }
      const categoriesValue = this.resolve(dict.get('Category') ?? null)
      if (!Array.isArray(categoriesValue) || categoriesValue.length === 0) throw new Error('PDF import error: optional content usage application Category must be a non-empty array')
      const categories: PdfOptionalContentUsageApplicationDef['categories'] = []
      for (let ci = 0; ci < categoriesValue.length; ci++) {
        const category = this.resolve(categoriesValue[ci]!)
        if (!(category instanceof PdfName) || !OPTIONAL_CONTENT_USAGE_CATEGORIES.has(category.name)) {
          throw new Error('PDF import error: optional content usage application Category is invalid')
        }
        categories.push(category.name as PdfOptionalContentUsageApplicationDef['categories'][number])
      }
      applications.push({ event: event.name, groupIds: this.optionalContentGroupIdArray(dict.get('OCGs'), known, 'usage application OCGs'), categories })
    }
    return applications
  }

  private readOptionalContentOrder(value: PdfValue | undefined, known: Set<string>): PdfOptionalContentOrderDef[] {
    const resolved = this.resolve(value ?? null)
    if (resolved === null) return []
    if (!Array.isArray(resolved)) throw new Error('PDF import error: optional content Order must be an array')
    const out: PdfOptionalContentOrderDef[] = []
    for (let i = 0; i < resolved.length; i++) {
      const item = this.resolve(resolved[i]!)
      if (Array.isArray(item)) {
        let label: string | undefined
        let start = 0
        const first = this.resolve(item[0] ?? null)
        if (first instanceof PdfString) { label = pdfStringToText(first); start = 1 }
        const children = this.readOptionalContentOrder(item.slice(start), known)
        out.push({ kind: 'branch', ...(label === undefined ? {} : { label }), children })
      } else {
        const group = this.readOptionalContentGroup(resolved[i]!)
        if (!known.has(group.id)) throw new Error('PDF import error: optional content Order references an unknown OCG')
        out.push({ kind: 'group', groupId: group.id })
      }
    }
    return out
  }

  private optionalContentListMode(value: PdfValue | undefined): 'AllPages' | 'VisiblePages' {
    const resolved = this.resolve(value ?? null)
    if (resolved === null) return 'AllPages'
    if (!(resolved instanceof PdfName) || (resolved.name !== 'AllPages' && resolved.name !== 'VisiblePages')) throw new Error('PDF import error: optional content ListMode is invalid')
    return resolved.name
  }

  private readOptionalContentRadioGroups(value: PdfValue | undefined, known: Set<string>): string[][] {
    const resolved = this.resolve(value ?? null)
    if (resolved === null) return []
    if (!Array.isArray(resolved)) throw new Error('PDF import error: optional content RBGroups must be an array')
    const result: string[][] = []
    for (let i = 0; i < resolved.length; i++) {
      const group = this.resolve(resolved[i]!)
      if (!Array.isArray(group)) throw new Error('PDF import error: optional content RBGroups entries must be arrays')
      result.push(this.optionalContentGroupIdArray(group, known, 'RBGroups'))
    }
    return result
  }

  private validateOptionalContentUsage(usage: PdfDict): void {
    const creator = this.optionalContentUsageDict(usage, 'CreatorInfo')
    if (creator !== null) {
      if (!(this.resolve(creator.get('Creator') ?? null) instanceof PdfString)) throw new Error('PDF import error: OCG CreatorInfo requires Creator text string')
      if (!(this.resolve(creator.get('Subtype') ?? null) instanceof PdfName)) throw new Error('PDF import error: OCG CreatorInfo requires Subtype name')
    }
    const language = this.optionalContentUsageDict(usage, 'Language')
    if (language !== null) {
      if (!(this.resolve(language.get('Lang') ?? null) instanceof PdfString)) throw new Error('PDF import error: OCG Language requires Lang text string')
      this.optionalContentStateName(language.get('Preferred'), 'Language Preferred', false)
    }
    const exportUsage = this.optionalContentUsageDict(usage, 'Export')
    if (exportUsage !== null) this.optionalContentStateName(exportUsage.get('ExportState'), 'ExportState', true)
    const zoom = this.optionalContentUsageDict(usage, 'Zoom')
    if (zoom !== null) {
      const min = this.optionalContentUsageNumber(zoom, 'min', 0)
      const max = this.optionalContentUsageNumber(zoom, 'max', Infinity)
      if (min < 0 || max < min) throw new Error('PDF import error: OCG Zoom range is invalid')
    }
    const print = this.optionalContentUsageDict(usage, 'Print')
    if (print !== null) {
      const subtype = this.resolve(print.get('Subtype') ?? null)
      if (subtype !== null && !(subtype instanceof PdfName)) throw new Error('PDF import error: OCG Print Subtype must be a name')
      this.optionalContentStateName(print.get('PrintState'), 'PrintState', false)
    }
    const view = this.optionalContentUsageDict(usage, 'View')
    if (view !== null) this.optionalContentStateName(view.get('ViewState'), 'ViewState', false)
    const user = this.optionalContentUsageDict(usage, 'User')
    if (user !== null) {
      const type = this.resolve(user.get('Type') ?? null)
      if (!(type instanceof PdfName) || (type.name !== 'Ind' && type.name !== 'Ttl' && type.name !== 'Org')) throw new Error('PDF import error: OCG User Type is invalid')
      const names = this.resolve(user.get('Name') ?? null)
      const values = Array.isArray(names) ? names : [names]
      if (values.length === 0 || values.some((name) => !(this.resolve(name) instanceof PdfString))) throw new Error('PDF import error: OCG User Name must contain text strings')
    }
    const pageElement = this.optionalContentUsageDict(usage, 'PageElement')
    if (pageElement !== null) {
      const subtype = this.resolve(pageElement.get('Subtype') ?? null)
      if (!(subtype instanceof PdfName) || !OPTIONAL_CONTENT_PAGE_ELEMENT_SUBTYPES.has(subtype.name)) throw new Error('PDF import error: OCG PageElement Subtype is invalid')
    }
  }

  private optionalContentUsageDict(usage: PdfDict, key: string): PdfDict | null {
    const value = this.resolve(usage.get(key) ?? null)
    if (value === null) return null
    if (!(value instanceof Map)) throw new Error(`PDF import error: OCG Usage ${key} must be a dictionary`)
    return value
  }

  private optionalContentStateName(value: PdfValue | undefined, label: string, required: boolean): 'ON' | 'OFF' | null {
    const resolved = this.resolve(value ?? null)
    if (resolved === null) {
      if (required) throw new Error(`PDF import error: OCG ${label} is required`)
      return null
    }
    if (!(resolved instanceof PdfName) || (resolved.name !== 'ON' && resolved.name !== 'OFF')) throw new Error(`PDF import error: OCG ${label} must be /ON or /OFF`)
    return resolved.name
  }

  private optionalContentUsageNumber(dict: PdfDict, key: string, defaultValue: number): number {
    const value = this.resolve(dict.get(key) ?? null)
    if (value === null) return defaultValue
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`PDF import error: OCG Zoom ${key} must be a finite number`)
    return value
  }

  private optionalContentVisible(value: PdfValue): boolean {
    return this.optionalContentVisibleForEvent(value, this.optionalContentContext.event)
  }

  private optionalContentVisibleForEvent(value: PdfValue, event: 'View' | 'Print' | 'Export'): boolean {
    const resolved = this.resolve(value)
    if (resolved === null) return true
    if (!(resolved instanceof Map)) throw new Error('PDF import error: optional content property must be a dictionary')
    const type = this.resolve(resolved.get('Type') ?? null)
    if (type instanceof PdfName && type.name === 'OCMD') return this.optionalContentMembershipVisible(resolved, event)
    return this.optionalContentGroupVisible(value, event)
  }

  private optionalContentMembershipVisible(dict: PdfDict, event: 'View' | 'Print' | 'Export'): boolean {
    const ve = this.resolve(dict.get('VE') ?? null)
    if (Array.isArray(ve)) return this.optionalContentExpressionVisible(ve, event)
    const ocgsValue = this.resolve(dict.get('OCGs') ?? null)
    const ocgs = Array.isArray(ocgsValue) ? ocgsValue : (ocgsValue === null ? [] : [dict.get('OCGs')!])
    if (ocgs.length === 0) return true
    const policyValue = this.resolve(dict.get('P') ?? null)
    const policy = policyValue instanceof PdfName ? policyValue.name : 'AnyOn'
    let onCount = 0
    for (let i = 0; i < ocgs.length; i++) {
      if (this.optionalContentGroupVisible(ocgs[i]!, event)) onCount++
    }
    if (policy === 'AllOn') return onCount === ocgs.length
    if (policy === 'AnyOff') return onCount < ocgs.length
    if (policy === 'AllOff') return onCount === 0
    if (policy === 'AnyOn') return onCount > 0
    throw new Error(`PDF import error: unsupported optional content visibility policy /${policy}`)
  }

  private optionalContentExpressionVisible(expr: PdfValue[], event: 'View' | 'Print' | 'Export'): boolean {
    if (expr.length === 0) throw new Error('PDF import error: optional content visibility expression is empty')
    const op = this.resolve(expr[0]!)
    if (!(op instanceof PdfName)) throw new Error('PDF import error: optional content visibility expression operator must be a name')
    if (op.name === 'Not') {
      if (expr.length !== 2) throw new Error('PDF import error: optional content Not expression requires one operand')
      return !this.optionalContentOperandVisible(expr[1]!, event)
    }
    if (op.name === 'And') {
      for (let i = 1; i < expr.length; i++) {
        if (!this.optionalContentOperandVisible(expr[i]!, event)) return false
      }
      return true
    }
    if (op.name === 'Or') {
      for (let i = 1; i < expr.length; i++) {
        if (this.optionalContentOperandVisible(expr[i]!, event)) return true
      }
      return false
    }
    throw new Error(`PDF import error: unsupported optional content visibility expression /${op.name}`)
  }

  private optionalContentOperandVisible(value: PdfValue, event: 'View' | 'Print' | 'Export'): boolean {
    const resolved = this.resolve(value)
    if (Array.isArray(resolved)) return this.optionalContentExpressionVisible(resolved, event)
    return this.optionalContentGroupVisible(value, event)
  }

  private optionalContentGroupVisible(value: PdfValue, event: 'View' | 'Print' | 'Export'): boolean {
    const properties = this.readOptionalContentProperties()
    if (properties === undefined) return true
    const group = this.readOptionalContentGroup(value)
    const config = properties.defaultConfiguration
    if (config.intents !== 'All' && !group.intents.some(function (intent) { return config.intents.includes(intent) })) return true
    let state = config.baseState !== 'OFF'
    if (config.on.includes(group.id)) state = true
    if (config.off.includes(group.id)) state = false
    let recommendation: boolean | null = null
    for (let i = 0; i < config.applications.length; i++) {
      const application = config.applications[i]!
      if (application.event !== event || !application.groupIds.includes(group.id)) continue
      for (let ci = 0; ci < application.categories.length; ci++) {
        const current = this.optionalContentUsageRecommendation(group, application.categories[ci]!, properties, application)
        if (current === false) recommendation = false
        else if (current === true && recommendation === null) recommendation = true
      }
    }
    return recommendation ?? state
  }

  private optionalContentUsageRecommendation(
    group: PdfOptionalContentGroupDef,
    category: PdfOptionalContentUsageApplicationDef['categories'][number],
    properties: PdfOptionalContentPropertiesDef,
    application: PdfOptionalContentUsageApplicationDef,
  ): boolean | null {
    const usage = group.usage
    if (usage === undefined) return null
    if (category === 'View') return rawOptionalContentState(usage.View, 'ViewState')
    if (category === 'Print') return rawOptionalContentState(usage.Print, 'PrintState')
    if (category === 'Export') return rawOptionalContentState(usage.Export, 'ExportState')
    if (category === 'Zoom') {
      const zoom = rawOptionalContentDictionary(usage.Zoom)
      if (zoom === null) return null
      const min = typeof zoom.min === 'number' ? zoom.min : 0
      const max = typeof zoom.max === 'number' ? zoom.max : Infinity
      return this.optionalContentContext.zoom >= min && this.optionalContentContext.zoom < max
    }
    if (category === 'User') {
      const user = rawOptionalContentDictionary(usage.User)
      if (user === null || this.optionalContentContext.user === undefined) return null
      const type = rawOptionalContentName(user.Type)
      const expected = type === 'Ind' ? this.optionalContentContext.user.individual
        : type === 'Ttl' ? this.optionalContentContext.user.title
          : type === 'Org' ? this.optionalContentContext.user.organization : undefined
      if (expected === undefined) return false
      return rawOptionalContentStrings(user.Name).includes(expected)
    }
    if (category === 'Language') {
      const requested = this.optionalContentContext.language?.toLowerCase()
      if (requested === undefined) return null
      const candidates = properties.groups.filter(function (candidate) { return application.groupIds.includes(candidate.id) })
      let exactExists = false
      for (let i = 0; i < candidates.length; i++) {
        const language = rawOptionalContentDictionary(candidates[i]!.usage?.Language)
        if (language !== null && rawOptionalContentString(language.Lang)?.toLowerCase() === requested) exactExists = true
      }
      const language = rawOptionalContentDictionary(usage.Language)
      if (language === null) return false
      const own = rawOptionalContentString(language.Lang)?.toLowerCase()
      if (exactExists) return own === requested
      const requestedPrimary = requested.split('-')[0]
      const ownPrimary = own?.split('-')[0]
      return requestedPrimary === ownPrimary && rawOptionalContentName(language.Preferred) === 'ON'
    }
    return null
  }

}

function createGraphicsState(initialMatrix?: Matrix): GraphicsState {
  return {
    ctm: initialMatrix ? initialMatrix.slice() as Matrix : [1, 0, 0, 1, 0, 0],
    fillColor: '#000000',
    strokeColor: '#000000',
    fillPaint: '#000000',
    strokePaint: '#000000',
    fillColorSpace: 'DeviceGray',
    strokeColorSpace: 'DeviceGray',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    dashArray: [],
    dashOffset: 0,
    fillOpacity: 1,
    strokeOpacity: 1,
    softMaskAlpha: 1,
    alphaIsShape: false,
    textKnockout: true,
    blendMode: 'normal',
    fillOverprint: false,
    strokeOverprint: false,
    overprintMode: 0,
    renderingIntent: null,
    clips: [],
    clipIsEmpty: false,
    deviceParams: null,
    flatness: 1,
  }
}

function isTransparencyGroup(doc: PdfDocument, dict: PdfDict): boolean {
  const group = doc.resolve(dict.get('Group') ?? null)
  if (!(group instanceof Map)) return false
  const subtype = doc.resolve(group.get('S') ?? null)
  return subtype instanceof PdfName && subtype.name === 'Transparency'
}

function copyGraphicsState(state: GraphicsState): GraphicsState {
  return {
    ctm: state.ctm.slice() as Matrix,
    fillColor: state.fillColor,
    strokeColor: state.strokeColor,
    fillPaint: clonePaint(state.fillPaint),
    strokePaint: clonePaint(state.strokePaint),
    fillColorSpace: state.fillColorSpace,
    strokeColorSpace: state.strokeColorSpace,
    lineWidth: state.lineWidth,
    lineCap: state.lineCap,
    lineJoin: state.lineJoin,
    miterLimit: state.miterLimit,
    dashArray: state.dashArray.slice(),
    dashOffset: state.dashOffset,
    fillOpacity: state.fillOpacity,
    strokeOpacity: state.strokeOpacity,
    softMaskAlpha: state.softMaskAlpha,
    alphaIsShape: state.alphaIsShape,
    textKnockout: state.textKnockout,
    blendMode: state.blendMode,
    fillOverprint: state.fillOverprint,
    strokeOverprint: state.strokeOverprint,
    overprintMode: state.overprintMode,
    renderingIntent: state.renderingIntent,
    clips: state.clips,
    clipIsEmpty: state.clipIsEmpty,
    deviceParams: state.deviceParams === null ? null : { ...state.deviceParams },
    flatness: state.flatness,
  }
}

function asciiText(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!)
  return out
}

/** True when the color space passes RGB components straight through. */
function colorSpaceIsRgbLike(colorSpace: { kind: string }): boolean {
  return colorSpace.kind === 'rgb'
}

function clonePaint(paint: PdfPaint): PdfPaint {
  if (typeof paint === 'string') return paint
  if (paint.type === 'pdfSpecialColor') return paint
  if (paint.type === 'meshAbs' || paint.type === 'tilingAbs' || paint.type === 'functionShadingAbs') return { ...paint }
  return { ...paint, stops: paint.stops.slice() } as PdfGradientPaint
}

function createPath(): CurrentPath {
  return { commands: [], coords: [], startX: 0, startY: 0, currentX: 0, currentY: 0 }
}

function normalizePdfRectangle(values: number[], label: string): [number, number, number, number] {
  if (values.length !== 4) throw new Error(`PDF import error: ${label} requires exactly four numbers`)
  return [
    Math.min(values[0]!, values[2]!),
    Math.min(values[1]!, values[3]!),
    Math.max(values[0]!, values[2]!),
    Math.max(values[1]!, values[3]!),
  ]
}

interface TextParamSnapshot {
  font: PdfFontDecoder | null
  fontSize: number
  charSpacing: number
  wordSpacing: number
  horizontalScale: number
  leading: number
  rise: number
  renderMode: number
}

function snapshotTextParams(ts: TextState): TextParamSnapshot {
  return {
    font: ts.font, fontSize: ts.fontSize, charSpacing: ts.charSpacing, wordSpacing: ts.wordSpacing,
    horizontalScale: ts.horizontalScale, leading: ts.leading, rise: ts.rise, renderMode: ts.renderMode,
  }
}

function restoreTextParams(ts: TextState, s: TextParamSnapshot): void {
  ts.font = s.font; ts.fontSize = s.fontSize; ts.charSpacing = s.charSpacing; ts.wordSpacing = s.wordSpacing
  ts.horizontalScale = s.horizontalScale; ts.leading = s.leading; ts.rise = s.rise; ts.renderMode = s.renderMode
}

function createTextState(): TextState {
  return {
    font: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
    textMatrix: [1, 0, 0, 1, 0, 0],
    lineMatrix: [1, 0, 0, 1, 0, 0],
  }
}

function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function transformPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function matrixRectBounds(matrix: Matrix, x1: number, y1: number, x2: number, y2: number): { x: number, y: number, width: number, height: number } {
  const p0 = transformPoint(matrix, x1, y1)
  const p1 = transformPoint(matrix, x2, y1)
  const p2 = transformPoint(matrix, x2, y2)
  const p3 = transformPoint(matrix, x1, y2)
  return pathBounds([p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]])
}

function elementVisualBounds(element: ElementDef): { x: number, y: number, width: number, height: number } {
  if (element.type === 'image' && element.affineTransform !== undefined) {
    return matrixRectBounds(element.affineTransform, 0, 0, 1, 1)
  }
  if (element.type === 'path' && element.affineTransform !== undefined) {
    const parsed = parseSvgPath(element.d)
    if (parsed.coords.length >= 2) {
      const transformed: number[] = []
      const viewBox = element.viewBox
      const sx = viewBox === undefined || viewBox[2] === 0 ? 1 : element.width / viewBox[2]
      const sy = viewBox === undefined || viewBox[3] === 0 ? 1 : element.height / viewBox[3]
      const ox = viewBox?.[0] ?? 0
      const oy = viewBox?.[1] ?? 0
      for (let i = 0; i < parsed.coords.length; i += 2) {
        const point = transformPoint(
          element.affineTransform,
          (parsed.coords[i]! - ox) * sx,
          (parsed.coords[i + 1]! - oy) * sy,
        )
        transformed.push(point[0] + element.x, point[1] + element.y)
      }
      const bounds = pathBounds(transformed)
      const matrix = element.affineTransform
      const strokeScale = Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]))
      const strokePadding = element.stroke === undefined ? 0 : (element.strokeWidth ?? 1) * strokeScale / 2
      return {
        x: bounds.x - strokePadding,
        y: bounds.y - strokePadding,
        width: bounds.width + strokePadding * 2,
        height: bounds.height + strokePadding * 2,
      }
    }
  }
  if (element.type === 'frame' && element.affineTransform !== undefined) {
    const bounds = matrixRectBounds(element.affineTransform, 0, 0, element.width, element.height)
    bounds.x += element.x
    bounds.y += element.y
    return bounds
  }
  return { x: element.x, y: element.y, width: element.width, height: element.height }
}

function elementListVisualBounds(elements: ElementDef[]): { x: number, y: number, width: number, height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < elements.length; i++) {
    const bounds = elementVisualBounds(elements[i]!)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function translateElementToLocal(element: ElementDef, x: number, y: number): void {
  element.x -= x
  element.y -= y
  if (element.type === 'image' && element.affineTransform !== undefined) {
    element.affineTransform[4] -= x
    element.affineTransform[5] -= y
  }
}

function rawOptionalContentDictionary(value: PdfRawValueDef | undefined): Record<string, PdfRawValueDef> | null {
  return value !== undefined && typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'dictionary' ? value.entries : null
}

function rawOptionalContentName(value: PdfRawValueDef | undefined): string | null {
  return value !== undefined && typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'name' ? value.value : null
}

function rawOptionalContentString(value: PdfRawValueDef | undefined): string | null {
  if (value === undefined || typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'string') return null
  return pdfStringToText(new PdfString(value.bytes))
}

function rawOptionalContentStrings(value: PdfRawValueDef | undefined): string[] {
  const single = rawOptionalContentString(value)
  if (single !== null) return [single]
  if (value === undefined || typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'array') return []
  const out: string[] = []
  for (let i = 0; i < value.items.length; i++) {
    const item = rawOptionalContentString(value.items[i])
    if (item !== null) out.push(item)
  }
  return out
}

function rawOptionalContentState(value: PdfRawValueDef | undefined, key: string): boolean | null {
  const dict = rawOptionalContentDictionary(value)
  if (dict === null) return null
  const state = rawOptionalContentName(dict[key])
  return state === 'ON' ? true : state === 'OFF' ? false : null
}

function pdfFunctionDomain(fn: PdfFunctionDef): number[] {
  return fn.domain
}

function pdfFunctionInputCount(fn: PdfFunctionDef): number {
  return fn.domain.length / 2
}

function pdfFunctionOutputCount(fn: PdfFunctionDef): number {
  if (fn.functionType === 0 || fn.functionType === 4) return fn.range.length / 2
  if (fn.functionType === 2) return fn.c0.length
  return pdfFunctionOutputCount(fn.functions[0]!)
}

function invertMatrix(matrix: Matrix): Matrix | null {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  if (determinant === 0) return null
  const a = matrix[3] / determinant
  const b = -matrix[1] / determinant
  const c = -matrix[2] / determinant
  const d = matrix[0] / determinant
  return [a, b, c, d, -(a * matrix[4] + c * matrix[5]), -(b * matrix[4] + d * matrix[5])]
}

function pdfUserToPageMatrix(matrix: Matrix, pageHeight: number): Matrix {
  return [matrix[0], -matrix[1], matrix[2], -matrix[3], matrix[4], pageHeight - matrix[5]]
}

interface ImagePlacement {
  x: number
  y: number
  width: number
  height: number
  rotation: 0 | 90 | 180 | 270
  flipX: boolean
  flipY: boolean
  affineTransform?: [number, number, number, number, number, number]
}

function imagePlacement(ctm: Matrix, pageHeight: number): ImagePlacement {
  const p0 = imagePoint(ctm, pageHeight, 0, 0)
  const p1 = imagePoint(ctm, pageHeight, 1, 0)
  const p2 = imagePoint(ctm, pageHeight, 1, 1)
  const p3 = imagePoint(ctm, pageHeight, 0, 1)
  const minX = Math.min(p0[0], p1[0], p2[0], p3[0])
  const minY = Math.min(p0[1], p1[1], p2[1], p3[1])
  const maxX = Math.max(p0[0], p1[0], p2[0], p3[0])
  const maxY = Math.max(p0[1], p1[1], p2[1], p3[1])
  const orientation = imageOrientation(p0, p1, p3)
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: orientation?.rotation ?? 0,
    flipX: orientation?.flipX ?? false,
    flipY: orientation?.flipY ?? false,
    affineTransform: orientation === null ? [
      p1[0] - p0[0],
      p1[1] - p0[1],
      p3[0] - p0[0],
      p3[1] - p0[1],
      p0[0],
      p0[1],
    ] : undefined,
  }
}

function imagePoint(ctm: Matrix, pageHeight: number, x: number, y: number): [number, number] {
  const p = transformPoint(ctm, x, y)
  return [p[0], pageHeight - p[1]]
}

function imageOrientation(p0: [number, number], p1: [number, number], p3: [number, number]): { rotation: 0 | 90 | 180 | 270; flipX: boolean; flipY: boolean } | null {
  const vx: [number, number] = [p1[0] - p0[0], p1[1] - p0[1]]
  const vy: [number, number] = [p3[0] - p0[0], p3[1] - p0[1]]
  const signedArea = vx[0] * vy[1] - vx[1] * vy[0]
  // A degenerate (near-zero-area) image CTM collapses the image to a line or
  // point — invisible, as PDF viewers render it. Report no orientation so the
  // caller places it at its degenerate bounds rather than failing the page.
  if (Math.abs(signedArea) <= 0.001) return null
  const flipX = signedArea > 0
  if (flipX) {
    vx[0] = -vx[0]
    vx[1] = -vx[1]
  }
  const rotation = imageRotationFromVectors(vx, vy)
  return rotation === null ? null : { rotation, flipX, flipY: false }
}

function imageRotationFromVectors(vx: [number, number], vy: [number, number]): 0 | 90 | 180 | 270 | null {
  if (Math.abs(vx[1]) <= 0.001 && Math.abs(vy[0]) <= 0.001) return vx[0] >= 0 ? 0 : 180
  if (Math.abs(vx[0]) <= 0.001 && Math.abs(vy[1]) <= 0.001) return vx[1] >= 0 ? 90 : 270
  return null
}

function matrixAreaScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

function valuesToMatrix(values: PdfValue[]): Matrix {
  const m: number[] = []
  for (let i = 0; i < 6; i++) {
    if (typeof values[i] !== 'number') throw new Error('PDF import error: matrix values must be numbers')
    m.push(values[i] as number)
  }
  return m as Matrix
}

function pathBounds(coords: number[]): { x: number; y: number; width: number; height: number } {
  let minX = coords[0]!
  let minY = coords[1]!
  let maxX = minX
  let maxY = minY
  for (let i = 2; i < coords.length; i += 2) {
    const x = coords[i]!
    const y = coords[i + 1]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function lineCap(v: number): 'butt' | 'round' | 'square' {
  if (v === 1) return 'round'
  if (v === 2) return 'square'
  return 'butt'
}

function lineJoin(v: number): 'miter' | 'round' | 'bevel' {
  if (v === 1) return 'round'
  if (v === 2) return 'bevel'
  return 'miter'
}

function parseBlendMode(value: PdfValue): BlendModeDef {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error('PDF import error: ExtGState BM array must not be empty')
    for (let i = 0; i < value.length; i++) {
      const mode = parseBlendModeName(value[i]!)
      if (mode !== null) return mode
    }
    throw new Error('PDF import error: ExtGState BM array contains no supported blend mode')
  }
  const mode = parseBlendModeName(value)
  if (mode === null) throw new Error('PDF import error: unsupported ExtGState blend mode')
  return mode
}

function parseBlendModeName(value: PdfValue): BlendModeDef | null {
  if (!(value instanceof PdfName)) return null
  switch (value.name) {
    case 'Normal':
    case 'Compatible': return 'normal'
    case 'Multiply': return 'multiply'
    case 'Screen': return 'screen'
    case 'Overlay': return 'overlay'
    case 'Darken': return 'darken'
    case 'Lighten': return 'lighten'
    case 'ColorDodge': return 'color-dodge'
    case 'ColorBurn': return 'color-burn'
    case 'HardLight': return 'hard-light'
    case 'SoftLight': return 'soft-light'
    case 'Difference': return 'difference'
    case 'Exclusion': return 'exclusion'
    case 'Hue': return 'hue'
    case 'Saturation': return 'saturation'
    case 'Color': return 'color'
    case 'Luminosity': return 'luminosity'
    default: return null
  }
}

function parseOverprintMode(value: number): OverprintModeDef {
  if (value === 0 || value === 1) return value
  throw new Error(`PDF import error: unsupported ExtGState overprint mode ${value}`)
}

function parseRenderingIntent(name: string): RenderingIntentDef {
  if (name === 'AbsoluteColorimetric' || name === 'RelativeColorimetric' || name === 'Saturation' || name === 'Perceptual') {
    return name
  }
  throw new Error(`PDF import error: unsupported rendering intent /${name}`)
}

function textModeFills(mode: number): boolean {
  return mode === 0 || mode === 2 || mode === 4 || mode === 6
}

function textModeStrokes(mode: number): boolean {
  return mode === 1 || mode === 2 || mode === 5 || mode === 6
}

function grayColor(g: number): string {
  return rgbColor(g, g, g)
}

function rgbColor(r: number, g: number, b: number): string {
  return '#' + byteHex(r) + byteHex(g) + byteHex(b)
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

// Returns a constant alpha when the mask is uniform (single element covering
// the bbox with a constant value), or null when the mask is non-uniform and
// must be reconstructed as a real per-pixel soft mask (not an error: control
// flow, so the caller can take the vector-reconstruction path).
function constantAlphaFromSoftMaskElements(elements: ElementDef[], width: number, height: number, subtype: 'Alpha' | 'Luminosity', images: Record<string, Uint8Array>): number | null {
  if (elements.length !== 1) return null
  const element = elements[0]!
  if (element.type === 'image') {
    return constantAlphaFromSoftMaskImage(element, width, height, subtype, images)
  }
  if (element.type !== 'path') return null
  const path = element as PathDef
  if (!softMaskPathCoversBBox(path, width, height)) return null
  if (path.stroke !== undefined || path.blendMode !== undefined || path.fill === undefined) return null
  const opacity = path.fillOpacity ?? 1
  if (subtype === 'Alpha') return clamp01(opacity)
  if (typeof path.fill !== 'string') return null
  return clamp01(relativeLuminance(path.fill) * opacity)
}

function constantAlphaFromSoftMaskImage(image: ImageDef, width: number, height: number, subtype: 'Alpha' | 'Luminosity', images: Record<string, Uint8Array>): number | null {
  if (!softMaskImageCoversBBox(image, width, height)) return null
  if (image.source === undefined || !image.source.endsWith('.png') || image.blendMode !== undefined || image.overprintFill === true || image.overprintStroke === true) return null
  const bytes = images[image.source]
  if (bytes === undefined) return null
  const decoded = decodePng(bytes)
  const pixels = decoded.pixels
  if (pixels.length === 0) return null
  const opacity = image.opacity ?? 1
  const first = softMaskPixelAlpha(pixels, 0, subtype, opacity)
  for (let offset = 4; offset < pixels.length; offset += 4) {
    if (!nearlyEqual(softMaskPixelAlpha(pixels, offset, subtype, opacity), first)) {
      return null
    }
  }
  return clamp01(first)
}

function softMaskPathCoversBBox(path: PathDef, width: number, height: number): boolean {
  return nearlyEqual(path.x, 0) &&
    nearlyEqual(path.y, 0) &&
    nearlyEqual(path.width, width) &&
    nearlyEqual(path.height, height)
}

function softMaskImageCoversBBox(image: ImageDef, width: number, height: number): boolean {
  return image.rotation === undefined &&
    image.affineTransform === undefined &&
    nearlyEqual(image.x, 0) &&
    nearlyEqual(image.y, 0) &&
    nearlyEqual(image.width, width) &&
    nearlyEqual(image.height, height)
}

function softMaskPixelAlpha(pixels: Uint8Array, offset: number, subtype: 'Alpha' | 'Luminosity', opacity: number): number {
  const alpha = (pixels[offset + 3]! / 255) * opacity
  if (subtype === 'Alpha') return alpha
  return (0.2126 * pixels[offset]! + 0.7152 * pixels[offset + 1]! + 0.0722 * pixels[offset + 2]!) / 255 * alpha
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.001
}

function relativeLuminance(color: string): number {
  const rgb = hexToColorArray(color)
  return clamp01(0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!)
}

function cmykColor(c: number, m: number, y: number, k: number): string {
  return rgbColor(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k))
}

function normalizePaint(paint: PdfPaint, bounds: { x: number; y: number; width: number; height: number }): FillDef {
  if (typeof paint === 'string') return paint
  if (paint.type === 'pdfSpecialColor') return paint
  if (paint.type === 'meshAbs') {
    return {
      type: 'meshGradient',
      patches: paint.patches.map(function (patch) {
        return { points: offsetPointArray(patch.points, -bounds.x, -bounds.y), colors: patch.colors }
      }),
      triangles: paint.triangles.map(function (triangle) {
        return { points: offsetPointArray(triangle.points, -bounds.x, -bounds.y), colors: triangle.colors }
      }),
      ...(paint.lattice !== undefined ? {
        lattice: {
          columns: paint.lattice.columns,
          points: offsetPointArray(paint.lattice.points, -bounds.x, -bounds.y),
          colors: paint.lattice.colors,
        },
      } : {}),
      pdfShading: {
        ...shadingCommonDef(paint.common, -bounds.x, -bounds.y),
        ...(paint.native === undefined ? {} : {
          native: {
            ...paint.native,
            matrix: multiplyMatrix([1, 0, 0, 1, -bounds.x, -bounds.y], paint.native.matrix),
          },
        }),
        ...(paint.nativeFunction === undefined ? {} : {
          nativeFunction: {
            ...paint.nativeFunction,
            patternMatrix: multiplyMatrix([1, 0, 0, 1, -bounds.x, -bounds.y], paint.nativeFunction.patternMatrix),
          },
        }),
      },
    }
  }
  if (paint.type === 'functionShadingAbs') {
    const m = paint.matrix
    return {
      type: 'functionShading',
      domain: paint.domain,
      matrix: [m[0], m[1], m[2], m[3], m[4] - bounds.x, m[5] - bounds.y],
      expression: paint.expression,
      background: paint.common.background as [number, number, number] | undefined,
      bbox: shadingCommonDef(paint.common, -bounds.x, -bounds.y).bbox,
      antiAlias: paint.common.antiAlias,
    }
  }
  if (paint.type === 'tilingAbs') {
    const m = paint.matrix
    return {
      type: 'tilingPattern',
      tilingType: paint.tilingType,
      bbox: paint.bbox,
      xStep: paint.xStep,
      yStep: paint.yStep,
      matrix: [m[0], m[1], m[2], m[3], m[4] - bounds.x, m[5] - bounds.y],
      graphics: paint.graphics,
    }
  }
  if (paint.type === 'linearGradientAbs') {
    return {
      type: 'linearGradient',
      x1: normalizedCoord(paint.x1, bounds.x, bounds.width),
      y1: normalizedCoord(paint.y1, bounds.y, bounds.height),
      x2: normalizedCoord(paint.x2, bounds.x, bounds.width),
      y2: normalizedCoord(paint.y2, bounds.y, bounds.height),
      stops: paint.stops,
      spreadMethod: paint.spreadMethod,
      pdfShading: {
        domain: paint.domain,
        extend: paint.extend,
        functions: paint.functions,
        colorSpace: paint.colorSpace,
        native: {
          ...paint.native,
          patternMatrix: multiplyMatrix([1, 0, 0, 1, -bounds.x, -bounds.y], paint.native.patternMatrix),
        },
        ...shadingCommonDef(paint.common, -bounds.x, -bounds.y),
        ...(paint.common.sourceBackground === undefined ? {} : { background: paint.common.sourceBackground.slice() }),
      },
    }
  }
  const radiusBase = Math.max(bounds.width, bounds.height)
  return {
    type: 'radialGradient',
    cx: normalizedCoord(paint.cx, bounds.x, bounds.width),
    cy: normalizedCoord(paint.cy, bounds.y, bounds.height),
    r: radiusBase === 0 ? 0 : paint.r / radiusBase,
    fx: normalizedCoord(paint.fx, bounds.x, bounds.width),
    fy: normalizedCoord(paint.fy, bounds.y, bounds.height),
    fr: radiusBase === 0 ? 0 : paint.fr / radiusBase,
    stops: paint.stops,
    spreadMethod: paint.spreadMethod,
    pdfShading: {
      domain: paint.domain,
      extend: paint.extend,
      functions: paint.functions,
      colorSpace: paint.colorSpace,
      native: {
        ...paint.native,
        patternMatrix: multiplyMatrix([1, 0, 0, 1, -bounds.x, -bounds.y], paint.native.patternMatrix),
      },
      ...shadingCommonDef(paint.common, -bounds.x, -bounds.y),
      ...(paint.common.sourceBackground === undefined ? {} : { background: paint.common.sourceBackground.slice() }),
    },
  }
}

function shadingCommonDef(common: PdfShadingCommon, dx = 0, dy = 0): {
  background?: [number, number, number]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
} {
  return {
    ...(common.background === undefined ? {} : { background: common.background as [number, number, number] }),
    ...(common.bbox === undefined ? {} : { bbox: [common.bbox[0] + dx, common.bbox[1] + dy, common.bbox[2] + dx, common.bbox[3] + dy] as [number, number, number, number] }),
    ...(common.antiAlias === undefined ? {} : { antiAlias: common.antiAlias }),
  }
}

function normalizedCoord(value: number, origin: number, size: number): number {
  return size === 0 ? 0 : (value - origin) / size
}

function offsetPointArray(points: number[], dx: number, dy: number): number[] {
  const result: number[] = []
  for (let i = 0; i < points.length; i += 2) {
    result.push(points[i]! + dx, points[i + 1]! + dy)
  }
  return result
}

/** Big-endian bit reader over a decoded stream (mesh shadings, sampled functions). */
class MeshBitReader {
  private readonly data: Uint8Array
  private bitPos = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  hasBits(count: number): boolean {
    return this.bitPos + count <= this.data.length * 8
  }

  seekBits(position: number): void {
    this.bitPos = position
  }

  readBits(count: number): number {
    let value = 0
    for (let i = 0; i < count; i++) {
      const byte = this.data[this.bitPos >> 3]
      if (byte === undefined) throw new Error('PDF import error: mesh shading stream is truncated')
      value = value * 2 + ((byte >> (7 - (this.bitPos & 7))) & 1)
      this.bitPos++
    }
    return value
  }

  requireZeroPadding(): void {
    const remaining = this.data.length * 8 - this.bitPos
    if (remaining >= 8) throw new Error('PDF import error: mesh shading stream has a truncated trailing record')
    while (this.bitPos < this.data.length * 8) {
      if (this.readBits(1) !== 0) throw new Error('PDF import error: mesh shading stream has nonzero padding bits')
    }
  }
}

/**
 * Builds a row-major 4x4 tensor patch from the boundary points d1..d12
 * (data order: p00 p01 p02 p03 p13 p23 p33 p32 p31 p30 p20 p10) and the
 * internal points (p11 p12 p22 p21; computed with the spec Coons formulas
 * when absent). Corner colors stay in data order c(p00) c(p03) c(p33) c(p30),
 * matching the model convention (u,v) = (0,0),(0,1),(1,1),(1,0).
 */
function buildTensorPatch(
  boundary: [number, number][],
  internal: [number, number][] | null,
  colors: string[],
): { points: number[], colors: [string, string, string, string] } {
  const grid: [number, number][] = new Array(16)
  const BOUNDARY_GRID = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4]
  for (let i = 0; i < 12; i++) grid[BOUNDARY_GRID[i]!] = boundary[i]!
  if (internal !== null) {
    // Tensor data order: p11 p12 p22 p21
    grid[5] = internal[0]!
    grid[6] = internal[1]!
    grid[10] = internal[2]!
    grid[9] = internal[3]!
  } else {
    // Coons interior per ISO 32000 8.7.4.5.7 (shared with the PDF encoder)
    const interior = coonsInteriorPoints(grid)
    grid[5] = interior[0]!
    grid[6] = interior[1]!
    grid[9] = interior[2]!
    grid[10] = interior[3]!
  }
  const points: number[] = []
  for (let i = 0; i < 16; i++) {
    points.push(grid[i]![0], grid[i]![1])
  }
  return { points, colors: [colors[0]!, colors[1]!, colors[2]!, colors[3]!] }
}

/** Flat tensor patch spanning the quad c00-c01-c11-c10 (bilinear control net). */
function flatTensorPatch(
  p00: [number, number], p01: [number, number], p11: [number, number], p10: [number, number],
  colors: [string, string, string, string],
): { points: number[], colors: [string, string, string, string] } {
  const points: number[] = []
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const u = i / 3
      const v = j / 3
      const w00 = (1 - u) * (1 - v)
      const w01 = (1 - u) * v
      const w11 = u * v
      const w10 = u * (1 - v)
      points.push(
        p00[0] * w00 + p01[0] * w01 + p11[0] * w11 + p10[0] * w10,
        p00[1] * w00 + p01[1] * w01 + p11[1] * w11 + p10[1] * w10,
      )
    }
  }
  return { points, colors }
}

function colorArrayToHexIn(doc: PdfDocument, colorSpace: ReturnType<typeof parsePdfColorSpace>, components: number[], deviceCmykTransform?: IccTransform): string {
  return pdfColorToHex(doc, colorSpace, components, undefined, false, deviceCmykTransform)
}

function normalizeFunctionStopOffset(value: number, domain: number[]): number {
  const span = domain[1]! - domain[0]!
  if (span === 0) return 0
  const offset = (value - domain[0]!) / span
  if (offset <= 0) return 0
  if (offset >= 1) return 1
  return offset
}

function mapStitchingInput(value: number, low: number, high: number, e0: number, e1: number): number {
  const span = high - low
  return span === 0 ? e0 : e0 + (value - low) / span * (e1 - e0)
}

/**
 * Converts interpreted tiling-cell elements into tile graphics. Cells hold
 * vector paths and raster images; text or nested clip frames inside a
 * pattern cell are outside the supported model and fail explicitly.
 */
function collectTileGraphics(elements: ElementDef[], uncoloredHex: string | null, out: TileGraphicDef[], styles: Map<string, StyleDef>): void {
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'path') {
      let fill = element.fill
      let stroke = element.stroke
      if (uncoloredHex !== null) {
        // Uncolored pattern (PaintType 2): every painted shape takes the scn color
        if (fill !== undefined) fill = uncoloredHex
        if (stroke !== undefined) stroke = uncoloredHex
      }
      out.push({
        kind: 'path',
        x: element.x,
        y: element.y,
        d: element.d,
        fill,
        stroke,
        strokeWidth: element.strokeWidth,
        fillRule: element.fillRule,
      })
      continue
    }
    if (element.type === 'image') {
      if (element.source === undefined) throw new Error('PDF import error: tiling pattern image element has no source')
      out.push({ kind: 'image', x: element.x, y: element.y, width: element.width, height: element.height, source: element.source })
      continue
    }
    if (element.type === 'staticText') {
      const style = element.style === undefined ? undefined : styles.get(element.style)
      const fontSize = style?.fontSize
      if (fontSize === undefined) throw new Error('PDF import error: tiling pattern text has no font size')
      out.push({
        kind: 'text', x: element.x, y: element.y, text: element.text,
        fontFamily: style?.fontFamily ?? 'Helvetica',
        fontSize,
        color: uncoloredHex ?? element.forecolor ?? style?.forecolor ?? '#000000',
      })
      continue
    }
    if (element.type === 'frame') {
      const graphics: TileGraphicDef[] = []
      collectTileGraphics(element.elements ?? [], uncoloredHex, graphics, styles)
      let softMask: Extract<TileGraphicDef, { kind: 'group' }>['softMask']
      if (element.softMask !== undefined) {
        const maskGraphics: TileGraphicDef[] = []
        collectTileGraphics(element.softMask.elements, uncoloredHex, maskGraphics, styles)
        softMask = {
          type: element.softMask.type,
          colorSpace: element.softMask.colorSpace,
          isolated: element.softMask.isolated,
          knockout: element.softMask.knockout,
          backdrop: element.softMask.backdrop,
          transferFunction: element.softMask.transferFunction,
          graphics: maskGraphics,
        }
      }
      out.push({
        kind: 'group',
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        affineTransform: element.affineTransform,
        clipPath: element.clipPath,
        opacity: element.opacity,
        blendMode: element.blendMode,
        overprintFill: element.overprintFill,
        overprintStroke: element.overprintStroke,
        overprintMode: element.overprintMode,
        renderingIntent: element.renderingIntent,
        alphaIsShape: element.alphaIsShape,
        textKnockout: element.textKnockout,
        optionalContent: element.optionalContent,
        transparencyGroup: element.transparencyGroup,
        isolated: element.isolated,
        knockout: element.knockout,
        deviceParams: element.deviceParams,
        pdfForm: element.pdfForm,
        softMask,
        graphics,
      })
      continue
    }
    throw new Error(`PDF import error: unsupported element type in a tiling pattern cell: ${element.type}`)
  }
}

function colorArrayToHex(values: number[]): string {
  if (values.length === 1) return rgbColor(values[0]!, values[0]!, values[0]!)
  if (values.length < 3) throw new Error('PDF import error: RGB color array requires three components')
  return rgbColor(values[0]!, values[1]!, values[2]!)
}

function hexToColorArray(color: string): number[] {
  return [
    parseInt(color.slice(1, 3), 16) / 255,
    parseInt(color.slice(3, 5), 16) / 255,
    parseInt(color.slice(5, 7), 16) / 255,
  ]
}

function functionDict(value: PdfValue): PdfDict {
  if (value instanceof PdfStream) return value.dict
  if (value instanceof Map) return value
  throw new Error('PDF import error: shading function must be a dictionary or stream')
}

function readBits(data: Uint8Array, bitPos: number, bits: number): number {
  let value = 0
  for (let i = 0; i < bits; i++) {
    const byte = data[(bitPos + i) >> 3]!
    const bit = 7 - ((bitPos + i) & 7)
    value = (value << 1) | ((byte >> bit) & 1)
  }
  return value
}

function byteHex(v: number): string {
  const n = Math.max(0, Math.min(255, Math.round(v * 255)))
  return n.toString(16).padStart(2, '0')
}

/**
 * Classifies the combined text matrix as an axis-aligned rotation.
 * Returns null for true arbitrary-angle text after validating that the text
 * axes are still orthogonal and can be represented by a rotated text frame.
 */
function textAxisRotation(m: Matrix): 0 | 90 | 180 | 270 | null {
  const scale = Math.hypot(m[0], m[1])
  const epsilon = Math.max(1e-6, scale * 0.001)
  if (Math.abs(m[1]) <= epsilon) return m[0] >= 0 ? 0 : 180
  if (Math.abs(m[0]) <= epsilon) return m[1] > 0 ? 90 : 270
  assertOrthogonalTextAxes(m)
  return null
}

function assertOrthogonalTextAxes(m: Matrix): void {
  const sx = Math.hypot(m[0], m[1])
  const sy = Math.hypot(m[2], m[3])
  if (sx <= 1e-9 || sy <= 1e-9) throw new Error('PDF import error: degenerate text matrix')
  const dot = m[0] * m[2] + m[1] * m[3]
  const epsilon = sx * sy * 0.001
  if (Math.abs(dot) > epsilon) {
    throw new Error('PDF import error: skewed text requires glyph outline import')
  }
}

function textMatrixAngle(m: Matrix): number {
  let angle = Math.atan2(m[1], m[0]) * 180 / Math.PI
  while (angle < 0) angle += 360
  while (angle >= 360) angle -= 360
  return angle
}

function rotatedTextFrame(
  element: StaticTextDef,
  m: Matrix,
  width: number,
  fontSize: number,
  ox: number,
  oy: number,
): FrameDef {
  const height = fontSize * 1.2
  const child: StaticTextDef = { ...element, x: 0, y: 0, width, height }
  return {
    type: 'frame',
    x: ox,
    y: oy - fontSize,
    width,
    height,
    rotation: textMatrixAngle(m),
    rotationOriginX: 0,
    rotationOriginY: fontSize,
    elements: [child],
  }
}

function rotatedVerticalTextFrame(
  element: StaticTextDef,
  m: Matrix,
  pageHeight: number,
  fontSize: number,
  columnHeight: number,
  rise: number,
): FrameDef {
  const origin = transformPoint(m, 0, rise)
  const ox = origin[0]
  const oy = pageHeight - origin[1]
  const child: StaticTextDef = { ...element, x: 0, y: 0, width: fontSize, height: columnHeight }
  return {
    type: 'frame',
    x: ox - fontSize / 2,
    y: oy,
    width: fontSize,
    height: columnHeight,
    rotation: textMatrixAngle(m),
    rotationOriginX: fontSize / 2,
    rotationOriginY: 0,
    elements: [child],
  }
}

function horizontalTextBounds(m: Matrix, pageHeight: number, width: number, fontSize: number): { x: number; y: number; width: number; height: number } {
  const corners: [number, number][] = [
    [0, fontSize],
    [width, fontSize],
    [width, -fontSize * 0.2],
    [0, -fontSize * 0.2],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < corners.length; i++) {
    const p = transformPoint(m, corners[i]![0], corners[i]![1])
    const x = p[0]
    const y = pageHeight - p[1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Repositions the element box for rotated text. The origin (ox, oy) is the
 * baseline start in page coordinates; width is the advance and fontSize the
 * effective glyph size along the reading direction.
 */
function applyRotatedTextBounds(element: StaticTextDef, rotation: 90 | 180 | 270, ox: number, oy: number, width: number, fontSize: number): void {
  if (rotation === 90) {
    // Reads bottom-to-top: advance runs up the page, ascent extends left.
    element.x = ox - fontSize
    element.y = oy - width
    element.width = fontSize * 1.2
    element.height = width
    return
  }
  if (rotation === 270) {
    // Reads top-to-bottom: advance runs down the page, ascent extends right.
    element.x = ox - fontSize * 0.2
    element.y = oy
    element.width = fontSize * 1.2
    element.height = width
    return
  }
  // 180: upside down, advance runs to the left, ascent extends downward.
  element.x = ox - width
  element.y = oy - fontSize * 0.2
  element.width = width
  element.height = fontSize * 1.2
}

function verticalTextBounds(m: Matrix, pageHeight: number, fontSize: number, columnHeight: number, rise: number): { x: number; y: number; width: number; height: number } {
  const half = fontSize / 2
  const corners: [number, number][] = [
    [-half, rise],
    [half, rise],
    [half, rise - columnHeight],
    [-half, rise - columnHeight],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < corners.length; i++) {
    const p = transformPoint(m, corners[i]![0], corners[i]![1])
    const x = p[0]
    const y = pageHeight - p[1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x3000 || code === 0xA0
}

/** Estimated ink extent of a text run: ascent ~0.8em above the baseline, descent ~0.2em below */
function textInkBounds(x: number, baselineY: number, width: number, fontSize: number): { x: number, y: number, width: number, height: number } {
  return { x, y: baselineY - fontSize * 0.8, width, height: fontSize }
}

function textMergeKey(
  styleName: string,
  color: string,
  letterSpacing: number,
  blendMode: BlendModeDef | undefined,
  actualText: string | undefined,
  alphaIsShape: boolean | undefined,
  textKnockout: boolean | undefined,
): string {
  return styleName + '|' + color + '|' + Math.round(letterSpacing * 100) + '|' + (blendMode ?? 'normal') + '|' + (actualText ?? '')
    + '|' + (alphaIsShape === true ? 'shape' : 'opacity') + '|' + (textKnockout === false ? 'composite' : 'knockout')
}

function clipListKey(clips: ClipRegion[]): string {
  if (clips.length === 0) return ''
  let key = clips[0]!.key
  for (let i = 1; i < clips.length; i++) key += ',' + clips[i]!.key
  return key
}

function rectContainsRect(
  outer: { x: number, y: number, width: number, height: number },
  inner: { x: number, y: number, width: number, height: number },
): boolean {
  const epsilon = 0.05
  return inner.x >= outer.x - epsilon
    && inner.y >= outer.y - epsilon
    && inner.x + inner.width <= outer.x + outer.width + epsilon
    && inner.y + inner.height <= outer.y + outer.height + epsilon
}

/**
 * True when the path is a single axis-aligned rectangle matching its bbox:
 * a MoveTo followed by axis-aligned LineTos visiting only bbox corners.
 */
function pathIsAxisAlignedRect(commands: number[], coords: number[], bounds: { x: number, y: number, width: number, height: number }): boolean {
  if (commands.length < 4 || commands.length > 6) return false
  if (commands[0] !== 0) return false
  for (let i = 1; i < commands.length; i++) {
    const command = commands[i]!
    if (command === 2) return false
    if (command === 0 && i !== 0) return false
    if (command === 3 && i !== commands.length - 1) return false
  }
  const epsilon = 0.01
  const x0 = bounds.x
  const x1 = bounds.x + bounds.width
  const y0 = bounds.y
  const y1 = bounds.y + bounds.height
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i]!
    const y = coords[i + 1]!
    const onX = Math.abs(x - x0) <= epsilon || Math.abs(x - x1) <= epsilon
    const onY = Math.abs(y - y0) <= epsilon || Math.abs(y - y1) <= epsilon
    if (!onX || !onY) return false
  }
  const points = coords.length / 2
  return points === 4 || points === 5
}

function translateCoords(coords: Float32Array, dx: number, dy: number): Float32Array {
  const out = new Float32Array(coords.length)
  for (let i = 0; i < coords.length; i += 2) {
    out[i] = coords[i]! + dx
    out[i + 1] = coords[i + 1]! + dy
  }
  return out
}

function normalizeContentColorComponents(colorSpace: ReturnType<typeof parsePdfColorSpace>, components: number[]): number[] {
  if (colorSpace.kind !== 'lab') return components
  return [
    components[0]! / 100,
    (components[1]! - colorSpace.aMin) / (colorSpace.aMax - colorSpace.aMin),
    (components[2]! - colorSpace.bMin) / (colorSpace.bMax - colorSpace.bMin),
  ]
}

function createFillRectPath(bounds: { x: number, y: number, width: number, height: number }, fill: FillDef): PathDef {
  const width = bounds.width
  const height = bounds.height
  return {
    type: 'path',
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    d: `M0 0 L${width} 0 L${width} ${height} L0 ${height} Z`,
    fill,
    fillRule: 'nonzero',
  }
}

/** Format a number for a PostScript calculator program (no exponent notation). */
function formatPostScriptNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}
