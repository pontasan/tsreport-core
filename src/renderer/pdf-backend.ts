/**
 * PDF 1.7 backend
 *
 * Implements RenderBackend and produces a valid PDF 1.7 binary.
 *
 * Text: CIDFont + Identity-H encoding (GIDs specified directly)
 * Fonts: subset and embedded at endDocument() time
 * Coordinate system: Y axis flipped via page CTM (origin top-left, Y downward -> converted to PDF native coordinates)
 */

import { Font } from '../font.js'
import { paintFormFieldAppearance } from './form-field-appearance.js'
import { resolveStandardFontName, getStandardFontMetrics } from '../pdf/standard-font-metrics.js'
import { standardEncodingGlyphNames, winAnsiCodeForCodePoint } from '../pdf/pdf-encoding.js'
import type {
  RenderBackend, TextDrawOptions, ShapeDrawOptions, RectDrawOptions, ResolvedRectCornerRadii,
  LinkAnnotation, BookmarkEntry, AnchorEntry,
  PathPaintOptions, GradientPaint, GradientStop, BlendMode, RenderingIntent, RenderDeviceParams, StructureTag, RenderOptionalContent,
  MeshGradientPaint, TilingPatternPaint, FunctionShadingPaint, OverprintMode, RenderFormField, TileGraphic, TileGroupGraphic, TilePathGraphic,
  TransparencyGroupOptions, ImageDrawOptions,
} from './backend.js'
import { resolveRectCornerRadii } from './backend.js'
import type { RenderGlyphRun, RenderPdfSourceVector, RenderCalculatorFunction, RenderHalftone, RenderTransferFunction, StructureNamespace, StructureNamespaceDefinition, StructureNamespaceRoleTarget } from '../types/render.js'
import type { PageTransparencyGroupDef, PdfActionDef, PdfDestinationDef, PdfDeviceNColorSpaceDef, PdfEmbeddedTargetDef, PdfFormXObjectDef, PdfFunctionDef, PdfOpiMetadataDef, PdfOptionalContentConfigurationDef, PdfOptionalContentExpressionDef, PdfOptionalContentGroupDef, PdfOptionalContentMembershipDef, PdfOptionalContentOrderDef, PdfOptionalContentPropertiesDef, PdfPageTransitionDef, PdfProcessColorSpaceDef, PdfRawValueDef, PdfSeparationColorSpaceDef, PdfShadingColorSpaceDef, PdfSpecialColorDef, PdfStructureDestinationDef, PdfWindowsLaunchParametersDef } from '../types/template.js'
import { shapeGlyphRun } from '../measure/glyph-run.js'
import { TextMeasurer } from '../measure/text-measurer.js'
import { layoutText } from '../layout/text-layout.js'
import {
  DEFAULT_STRUCTURE_NAMESPACE, PDF_20_STRUCTURE_NAMESPACE, STANDARD_STRUCTURE_ROLES,
  isDefaultStructureRole, isPdf20OnlyStructureRole, isPdf20StructureRole,
} from '../pdf/pdf-logical-structure.js'
import { parsePdfPronunciationLexicon } from '../pdf/pdf-pronunciation-lexicon.js'
import { decodePdfTextStringBytes, encodePdfTextStringBytes } from '../pdf/pdf-text-string.js'
import { validatePdfOpiMetadata } from '../pdf/pdf-opi.js'
import { verifyPdfSignatures } from '../pdf/pdf-signature.js'
import { validatePdfDestinationProfileReference } from '../pdf/pdf-output-intent.js'
import { validatePdfXfa, type PdfXfa } from '../pdf/pdf-xfa.js'
import { decodeU3dScene, renderPdf3DPoster } from '../pdf/pdf-3d.js'
import { decodePrcScene } from '../pdf/pdf-prc.js'
import {
  inspectIccProfile,
  parseIccOutputProfile,
  parseIccProfile,
  type IccOutputTransform,
  type IccProfileHeader,
  type IccRenderingIntent,
} from '../pdf/icc-profile-reader.js'
import { validateBcp47LanguageTag } from '../pdf/language-tag.js'
import { PdfContentLexer } from '../pdf/content-lexer.js'
import {
  requiredPdfVersionForExtensions,
  validatePdfDeveloperExtensions,
  type PdfDeveloperExtension,
  type PdfDeveloperExtensions,
} from '../pdf/pdf-extensions.js'
import type { CompositeMode, ExtendMode } from '../parsers/tables/colr.js'
import { createEncryptionContext, md5, randomBytes, type EncryptionContext, type PdfEncryptionOptions } from './pdf-encryption.js'
import { createPubSecEncryptionContext, type PdfPubSecEncryptionOptions } from '../pdf/pdf-pubsec.js'
import { generateCmykIccProfile, generateSRGBIccProfile } from './icc-profile.js'
import {
  renderColrV1Glyph, parseForegroundColor, sampleColorLine,
  extendGradientStops, mapExtendMode,
  type ColrV1PaintOps, type ResolvedColor, type ResolvedColorStop,
} from './colr-v1-renderer.js'
import { detectImageFormat } from '../image/image-utils.js'
import { parseJpegInfo } from '../image/jpeg-parser.js'
import { decodeJpegToRgba } from '../image/jpeg-decoder.js'
import { decodeJpx, type JpxImage } from '../compression/jpx-decoder.js'
import { decodeJbig2 } from '../compression/jbig2-decoder.js'
import {
  getDefaultRasterImageDecoder,
  type RasterImageDecoder,
} from './raster-image-decoder.js'
import { resolveImageResource } from './image-resource.js'
import { BackendImageResources } from '../image-resource-map.js'
import { collectPdfOptionImageReferences } from '../pdf-option-image-reference.js'
import { zlibDeflate } from '../compression/deflate.js'
import { zlibInflate } from '../compression/inflate.js'
import { parseOpenTypeSvg, parseSvg } from '../svg/svg-parser.js'
import { renderSvg, renderSvgGlyph } from '../svg/svg-renderer.js'
import { coonsInteriorPoints, isComplexPaint, multiplyPaintMatrix, transformMeshPaint, type PaintMatrix } from './complex-paint.js'
import { isPrintColor, parseTemplateColor, type CalibratedColor, type DeviceNColor, type TemplateColor } from './color.js'
import type { SvgDocument } from '../svg/svg-types.js'
import { prepareBitmapGlyph } from './bitmap-glyph.js'
import { validateRenderDeviceParams } from './device-raster.js'
import { mergePositionedGlyphOutlines, type PositionedGlyphOutline } from './merged-glyph-outline.js'
import {
  applyPdfPredictor,
  decodeAscii85,
  decodeAsciiHex,
  decodeLzw,
  decodeRunLength,
  parsePdf,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  type PdfDict,
  type PdfValue,
} from '../pdf/pdf-parser.js'
import { collectPdfPages } from '../pdf/pdf-import.js'
import { analyzeParsedPdfPageTransparency } from '../pdf/pdf-transparency-analysis.js'
import { createFontDecoder, type PdfFontDecoder } from '../pdf/pdf-text-decoder.js'
import { adobeCMapResource } from '../pdf/adobe-cmap-resources.js'
import { aglNameToUnicode } from '../pdf/agl-data.js'
import { parseType1 } from '../parsers/type1-parser.js'
import { BinaryReader } from '../binary/reader.js'
import { cffGlyphName, parseCff } from '../parsers/cff-parser.js'
import { parseFont } from '../parsers/index.js'
import { getTableReader } from '../parsers/sfnt-parser.js'
import {
  isPdfMeasurementViewport,
  pdfMeasurementToRaw,
  pdfMeasurementViewportToRaw,
  pdfPointDataToRaw,
  type PdfMeasurement,
  type PdfMeasurementViewport,
  type PdfPointData,
} from '../pdf/pdf-measurement.js'
import { isXmlNmToken } from '../pdf/xml-name.js'
import {
  validatePdfMediaDefinition,
  validatePdfMediaMimeType,
  type PdfMediaClipSection,
  type PdfMediaDuration,
  type PdfMediaFloatingWindow,
  type PdfMediaOffset,
  type PdfMediaPlayParameters,
  type PdfMediaScreenParameters,
  type PdfMediaDefinition,
} from '../pdf/pdf-media.js'
import {
  buildPdfXmpPacket,
  parsePdfXmpPacket,
  validatePdfAXmpPacket,
  validatePdfXmpSynchronization,
  type PdfXmpMetadata,
} from '../pdf/pdf-xmp.js'

// ─── Public interfaces ───

/** Document metadata (Info dict + XMP) */
export type PdfTrappedState = boolean | 'unknown'

export type PdfInfoCustomValue =
  | string
  | number
  | boolean
  | Date
  | { type: 'name', value: string }

export interface PdfMetadata {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: Date
  modDate?: Date
  /** PDF Info /Trapped entry: true, false, or unknown trapping state. */
  trapped?: PdfTrappedState
  /** Additional PDF Info dictionary entries. */
  custom?: Record<string, PdfInfoCustomValue>
  /** Typed additions or an exact imported XMP packet. */
  xmp?: PdfXmpMetadata
}

/** PDF/A conformance level */
export type PdfAConformance = 'PDF/A-1b' | 'PDF/A-2b' | 'PDF/A-3b'

/** PDF/X print conformance (PDF/X-1a:2003 = CMYK/spot only, PDF 1.4, no transparency) */
export type PdfXConformance = 'PDF/X-1a'

export type PdfPageMode =
  | 'UseNone'
  | 'UseOutlines'
  | 'UseThumbs'
  | 'FullScreen'
  | 'UseOC'
  | 'UseAttachments'

export type PdfPageLayout =
  | 'SinglePage'
  | 'OneColumn'
  | 'TwoColumnLeft'
  | 'TwoColumnRight'
  | 'TwoPageLeft'
  | 'TwoPageRight'

export type PdfPageBoundary = 'MediaBox' | 'CropBox' | 'BleedBox' | 'TrimBox' | 'ArtBox'

export type PdfPageLabelStyle = 'D' | 'R' | 'r' | 'A' | 'a'

export interface PdfPageLabel {
  /** Zero-based page index where this label range starts. */
  pageIndex: number
  /** PDF page label style: decimal, uppercase/lowercase roman, uppercase/lowercase letters. */
  style?: PdfPageLabelStyle
  /** Prefix prepended to generated page numbers. */
  prefix?: string
  /** First number in this label range. */
  start?: number
}

export type PdfDestinationFit =
  | 'XYZ'
  | 'Fit'
  | 'FitH'
  | 'FitV'
  | 'FitR'
  | 'FitB'
  | 'FitBH'
  | 'FitBV'

export interface PdfOpenAction {
  /** Zero-based page index. */
  pageIndex: number
  /** PDF destination fit mode. Coordinates use report top-left user space. */
  fit: PdfDestinationFit
  x?: number
  y?: number
  left?: number
  top?: number
  right?: number
  bottom?: number
  zoom?: number | null
}

export interface PdfNamedDestination {
  name: string
  destination: PdfDestinationDef
}

export interface PdfNameTreeEntry {
  name: string
  value: PdfRawValueDef
}

export interface PdfNumberTreeEntry {
  key: number
  value: PdfRawValueDef
}

export interface PdfEmbeddedFile {
  /** Name used in the EmbeddedFiles name tree and as the file specification. */
  name: string
  /** Embedded file bytes. */
  data: Uint8Array
  /** Optional file description shown by PDF viewers. */
  description?: string
  /** MIME type written as the EmbeddedFile stream /Subtype. */
  mimeType?: string
  /** Creation timestamp written to the EmbeddedFile /Params dictionary. */
  creationDate?: Date
  /** Modification timestamp written to the EmbeddedFile /Params dictionary. */
  modificationDate?: Date
  /** 16-byte MD5 digest written to EmbeddedFile /Params /CheckSum. */
  checksum?: Uint8Array
  /** Classic Mac file information written to EmbeddedFile /Params /Mac. */
  mac?: PdfEmbeddedFileMacParameters
  /** Per-file collection item values keyed by PdfCollectionField.key. */
  collectionItem?: Record<string, PdfCollectionItemValue>
  /** PDF 2.0 collection folder ID. The name-tree key is encoded as <ID>name. */
  folderId?: number
  /**
   * Associated-file relationship (PDF/A-3 and PDF 2.0 /AFRelationship). When
   * set, the file is also referenced from the document catalog /AF array.
   */
  relationship?: PdfAFRelationship
}

export interface PdfEmbeddedFileMacParameters {
  /** Mac file type byte string. */
  subtype?: string
  /** Mac creator signature byte string. */
  creator?: string
  /** Resource-fork bytes embedded as the /ResFork stream. */
  resourceFork?: Uint8Array
}

/** PDF 2.0 associated-file relationship (ISO 32000-2 §7.11.4.2). */
export type PdfAFRelationship =
  | 'Source' | 'Data' | 'Alternative' | 'Supplement'
  | 'EncryptedPayload' | 'FormData' | 'Schema' | 'Unspecified'

export interface PdfJavaScriptAction {
  /** Name used in the JavaScript name tree. */
  name: string
  /** JavaScript source stored in the action dictionary /JS entry. */
  script: string
}

export type PdfCollectionFieldSubtype =
  | 'S' | 'D' | 'N' | 'F' | 'Desc' | 'ModDate' | 'CreationDate' | 'Size' | 'CompressedSize'

export type PdfCollectionView = 'D' | 'T' | 'H' | 'C'

export type PdfCollectionRgb = [number, number, number]

export interface PdfCollectionColors {
  background?: PdfCollectionRgb
  cardBackground?: PdfCollectionRgb
  cardBorder?: PdfCollectionRgb
  primaryText?: PdfCollectionRgb
  secondaryText?: PdfCollectionRgb
}

export interface PdfCollectionSplit {
  direction?: 'H' | 'V' | 'N'
  position?: number
}

export interface PdfCollectionNavigator {
  /** Named layouts in preference order; the final entry must be D, T, or H. */
  layouts: string[]
}

export interface PdfCollectionFolder {
  id: number
  name: string
  collectionItem?: Record<string, PdfCollectionItemValue>
  description?: string
  creationDate?: Date
  modificationDate?: Date
  thumbnailImageId?: string
  /** Inclusive free-ID ranges. Valid only on the root folder. */
  freeIdRanges?: Array<[number, number]>
  children?: PdfCollectionFolder[]
}

export interface PdfCollectionSubitem {
  /** Actual collection value stored in /D. */
  value: string | number | Date
  /** Optional prefix stored in /P. */
  prefix?: string
}

export type PdfCollectionItemValue = string | number | Date | PdfCollectionSubitem

export interface PdfCollectionField {
  /** Collection schema key used in /Schema and file /CI dictionaries. */
  key: string
  /** Human-readable field name stored in /N. */
  name: string
  /** PDF collection field subtype. */
  subtype: PdfCollectionFieldSubtype
  /** Field order in the collection UI. */
  order?: number
  /** Whether the field is visible. */
  visible?: boolean
  /** Whether the field is editable. */
  editable?: boolean
}

export interface PdfCollectionSort {
  /** Schema keys used as the sort keys. */
  keys: string[]
  /** Sort direction: single boolean for all keys or one boolean per key. */
  ascending?: boolean | boolean[]
}

export interface PdfCollection {
  /** Collection schema fields. */
  schema?: PdfCollectionField[]
  /** Initial embedded file name. */
  initialDocument?: string
  /** Collection view mode: details, tile, or hidden. */
  view?: PdfCollectionView
  /** PDF 2.0 navigator. Required when view is C. */
  navigator?: PdfCollectionNavigator
  colors?: PdfCollectionColors
  /** Collection sort dictionary. */
  sort?: PdfCollectionSort
  /** Root of the PDF 2.0 folder hierarchy. */
  folders?: PdfCollectionFolder
  split?: PdfCollectionSplit
}

export interface PdfArticleInfo extends PdfMetadata {
  /** Article title stored in the thread information dictionary. */
  title?: string
  /** Article author stored in the thread information dictionary. */
  author?: string
  /** Article subject stored in the thread information dictionary. */
  subject?: string
  /** Article keywords stored in the thread information dictionary. */
  keywords?: string
}

export interface PdfArticleBead {
  /** Zero-based page index containing this bead rectangle. */
  pageIndex: number
  /** Bead rectangle in report top-left user coordinates. */
  x: number
  y: number
  width: number
  height: number
}

export interface PdfArticleThread {
  /** Optional PDF thread information dictionary. */
  info?: PdfArticleInfo
  /** Ordered article beads. The generated /N and /V links form a closed chain. */
  beads: PdfArticleBead[]
  /** PDF 2.0 thread metadata stream. */
  metadata?: Extract<PdfRawValueDef, { kind: 'stream' }>
}

export type PdfDocumentRequirementType =
  | 'OCInteract' | 'OCAutoStates' | 'AcroFormInteract' | 'Navigation'
  | 'Markup' | '3DMarkup' | 'Multimedia' | 'U3D' | 'PRC' | 'Action'
  | 'EnableJavaScripts' | 'Attachment' | 'AttachmentEditing'
  | 'Collection' | 'CollectionEditing' | 'DigSigValidation' | 'DigSig'
  | 'DigSigMDP' | 'RichMedia' | 'Geospatial2D' | 'Geospatial3D'
  | 'DPartInteract' | 'SeparationSimulation' | 'Transitions' | 'Encryption'

export type PdfDocumentRequirementVersion = string | Record<string, PdfRawValueDef>

export type PdfDocumentRequirementHandler =
  | { type: 'JS', script?: string }
  | { type: 'NoOp' }

/** A PDF 2.0 document requirement. Requirement handlers are retained, never executed. */
export interface PdfDocumentRequirement {
  type: PdfDocumentRequirementType
  version?: PdfDocumentRequirementVersion
  handlers?: PdfDocumentRequirementHandler | PdfDocumentRequirementHandler[]
  penalty?: number
  /** Required only for the Encryption requirement. */
  encryption?: Record<string, PdfRawValueDef>
  /** Used only by DigSig, DigSigValidation, and DigSigMDP requirements. */
  digitalSignature?: Record<string, PdfRawValueDef>
}

export interface PdfWebCaptureUrlAlias {
  destinationUrl: string
  chains?: string[][]
}

export interface PdfWebCaptureSource {
  urls: string | PdfWebCaptureUrlAlias
  timestamp?: Date
  expiresAt?: Date
  submission?: 0 | 1 | 2
  /** Zero-based index in PdfWebCapture.commands. Valid only for page sets. */
  commandIndex?: number
}

export interface PdfWebCaptureCommandSettings {
  global?: Record<string, PdfRawValueDef>
  converters?: Record<string, Record<string, PdfRawValueDef>>
}

export type PdfWebCapturePostedData =
  | { kind: 'string', bytes: Uint8Array }
  | { kind: 'stream', data: Uint8Array, entries?: Record<string, PdfRawValueDef> }

export interface PdfWebCaptureCommand {
  url: string
  levels?: number
  flags?: number
  postedData?: PdfWebCapturePostedData
  contentType?: string
  headers?: Uint8Array
  settings?: PdfWebCaptureCommandSettings
}

export type PdfWebCaptureContentObject =
  | { kind: 'page', pageIndex: number, preferredZoom?: number }
  | { kind: 'image', imageId: string }

interface PdfWebCaptureContentSetBase {
  identifier: Uint8Array
  objects: PdfWebCaptureContentObject[]
  sources: PdfWebCaptureSource | PdfWebCaptureSource[]
  /** URL name-tree keys that resolve to this content set. */
  urls: string[]
  contentType?: string
  createdAt?: Date
}

export interface PdfWebCapturePageSet extends PdfWebCaptureContentSetBase {
  kind: 'page'
  title?: string
  textIdentifier?: Uint8Array
}

export interface PdfWebCaptureImageSet extends PdfWebCaptureContentSetBase {
  kind: 'image'
  referenceCounts: number | number[]
}

export type PdfWebCaptureContentSet = PdfWebCapturePageSet | PdfWebCaptureImageSet

/** Web Capture content database and the commands that produced it. */
export interface PdfWebCapture {
  version: 1
  commands?: PdfWebCaptureCommand[]
  contentSets: PdfWebCaptureContentSet[]
}

export type PdfAnnotationSubtype =
  | 'Link'
  | 'Widget'
  | 'Text'
  | 'FreeText'
  | 'Line'
  | 'Square'
  | 'Circle'
  | 'Polygon'
  | 'PolyLine'
  | 'Highlight'
  | 'Underline'
  | 'Squiggly'
  | 'StrikeOut'
  | 'Stamp'
  | 'Caret'
  | 'Ink'
  | 'Popup'
  | 'Sound'
  | 'Movie'
  | 'Screen'
  | 'PrinterMark'
  | 'TrapNet'
  | 'Watermark'
  | 'FileAttachment'
  | 'Redact'
  | 'Projection'
  | '3D'
  | 'RichMedia'

export type PdfAnnotationLineEnding =
  | 'None'
  | 'Square'
  | 'Circle'
  | 'Diamond'
  | 'OpenArrow'
  | 'ClosedArrow'
  | 'Butt'
  | 'ROpenArrow'
  | 'RClosedArrow'
  | 'Slash'

export type PdfAnnotationTextIcon =
  | 'Comment'
  | 'Key'
  | 'Note'
  | 'Help'
  | 'NewParagraph'
  | 'Paragraph'
  | 'Insert'

export type PdfAnnotationStampIcon =
  | 'Approved'
  | 'Experimental'
  | 'NotApproved'
  | 'AsIs'
  | 'Expired'
  | 'NotForPublicRelease'
  | 'Confidential'
  | 'Final'
  | 'Sold'
  | 'Departmental'
  | 'ForComment'
  | 'TopSecret'
  | 'Draft'
  | 'ForPublicRelease'

export type PdfAnnotationFileAttachmentIcon =
  | 'Graph'
  | 'Paperclip'
  | 'PushPin'
  | 'Tag'

export type PdfSoundEncoding = 'Raw' | 'Signed' | 'muLaw' | 'ALaw'

export type PdfAnnotationPoint = [number, number]

export type PdfAnnotationBorderStyle = 'solid' | 'dashed' | 'beveled' | 'inset' | 'underline'

export interface PdfAnnotationBorderEffect {
  style: 'cloudy'
  /** Cloud intensity from 0 through 2 (PDF /BE /I). */
  intensity: number
}

export type PdfAnnotationQuadPoints = [number, number, number, number, number, number, number, number]

export type PdfCaretAnnotationSymbol = 'P' | 'None'

export type PdfFixedPrintMatrix = [number, number, number, number, number, number]

export interface PdfFixedPrint {
  matrix?: PdfFixedPrintMatrix
  horizontalTranslation?: number
  verticalTranslation?: number
}

export type PdfMovieRotation = 0 | 90 | 180 | 270

export interface PdfMovie {
  file: PdfEmbeddedFile
  aspect?: [number, number]
  rotate?: PdfMovieRotation
  poster?: boolean
}

export interface PdfScreenAppearanceCharacteristics {
  rotation?: PdfMovieRotation
  borderColor?: string
  backgroundColor?: string
  normalCaption?: string
  rolloverCaption?: string
  alternateCaption?: string
}

export interface PdfAnnotationBase {
  /** Zero-based page index containing the annotation. */
  pageIndex: number
  /** Annotation rectangle in report top-left user coordinates. */
  x: number
  y: number
  width: number
  height: number
  /** /Contents text. */
  contents?: string
  /** /NM unique annotation name. */
  name?: string
  /** /M modification date. */
  modifiedDate?: Date
  /** /C RGB color as #RRGGBB. */
  color?: string
  /** Border width (pt) for the /BS dictionary and generated appearance. Default 1. */
  borderWidth?: number
  /** /BS /D dash array (pt); emits a dashed border style. */
  dashArray?: number[]
  /** Border style written to /BS /S and consumed by the generated appearance. */
  borderStyle?: PdfAnnotationBorderStyle
  /** Border effect written to /BE and consumed by the generated appearance. */
  borderEffect?: PdfAnnotationBorderEffect
  /** /CA constant opacity (0..1) applied when painting the annotation. */
  opacity?: number
  /** Raw PDF annotation flags bitset. */
  flags?: number
  /** Viewer-bound action retained and serialized but never executed. */
  action?: PdfActionDef
  /** Annotation /Dest; mutually exclusive with action. */
  destination?: PdfDestinationDef
  /** Annotation trigger actions written to /AA and never executed by core. */
  additionalActions?: Record<string, PdfActionDef>
  /** PDF 2.0 annotation-level associated files written as indirect file specifications. */
  associatedFiles?: PdfEmbeddedFile[]
  /** Structure element /ID that owns this annotation through an OBJR. */
  structureElementId?: string
}

/** Lossless annotation dictionary model for standard subtype entries. */
export interface PdfPreservedAnnotation extends PdfAnnotationBase {
  model: 'preserved'
  subtype: PdfAnnotationSubtype
  /** Entries not represented by PdfAnnotationBase or annotation relationships. */
  entries: Record<string, PdfRawValueDef>
  /** /AP appearance dictionary. */
  appearanceDictionary?: Record<string, PdfRawValueDef>
  /** /AS appearance state. */
  appearanceState?: string
  /** Global index in PdfBackendOptions.annotations referenced by /Popup. */
  popupIndex?: number
  /** Parent annotation index for a preserved Popup. */
  parentIndex?: number
  /** Reply target annotation index written to /IRT. */
  replyToIndex?: number
}

export interface PdfLinkAnnotation extends PdfAnnotationBase {
  subtype: 'Link'
}

export interface PdfTextAnnotation extends PdfAnnotationBase {
  subtype: 'Text'
  icon?: PdfAnnotationTextIcon
  open?: boolean
}

export interface PdfFreeTextAnnotation extends PdfAnnotationBase {
  subtype: 'FreeText'
  defaultAppearance: string
  /** Font used by the generated normal appearance. Required for PDF/A output. */
  fontId?: string
  /** Paragraph direction used by shaping and visual-order layout. */
  direction?: 'ltr' | 'rtl' | 'auto'
  defaultStyle?: string
  quadding?: 0 | 1 | 2
}

export interface PdfLineAnnotation extends PdfAnnotationBase {
  subtype: 'Line'
  start: PdfAnnotationPoint
  end: PdfAnnotationPoint
  lineEndings?: [PdfAnnotationLineEnding, PdfAnnotationLineEnding]
  interiorColor?: string
}

export interface PdfSquareCircleAnnotation extends PdfAnnotationBase {
  subtype: 'Square' | 'Circle'
  interiorColor?: string
}

export type PdfTextMarkupAnnotationSubtype = 'Highlight' | 'Underline' | 'Squiggly' | 'StrikeOut'

export interface PdfTextMarkupAnnotation extends PdfAnnotationBase {
  subtype: PdfTextMarkupAnnotationSubtype
  quadPoints: PdfAnnotationQuadPoints[]
}

export type PdfHighlightAnnotation = PdfTextMarkupAnnotation

export interface PdfPolygonAnnotation extends PdfAnnotationBase {
  subtype: 'Polygon' | 'PolyLine'
  vertices: PdfAnnotationPoint[]
  lineEndings?: [PdfAnnotationLineEnding, PdfAnnotationLineEnding]
  interiorColor?: string
}

export interface PdfStampAnnotation extends PdfAnnotationBase {
  subtype: 'Stamp'
  icon?: PdfAnnotationStampIcon
  /** Font used to draw the stamp label. Required for PDF/A output. */
  fontId?: string
}

export interface PdfCaretAnnotation extends PdfAnnotationBase {
  subtype: 'Caret'
  symbol?: PdfCaretAnnotationSymbol
  rectDifferences?: [number, number, number, number]
}

/** Redaction annotation (ISO 32000 §12.5.6.23): marks regions for removal. */
export interface PdfRedactAnnotation extends PdfAnnotationBase {
  subtype: 'Redact'
  /** /QuadPoints content regions to be redacted. */
  quadPoints?: PdfAnnotationQuadPoints[]
  /** /IC interior color filling the region after redaction, as #RRGGBB. */
  interiorColor?: string
  /** /OverlayText drawn over the redacted region. */
  overlayText?: string
  /** /DA default appearance content used to paint overlayText. Required with overlayText. */
  defaultAppearance?: string
  /** /Repeat: repeat the overlay text to fill the region. */
  repeatOverlay?: boolean
  /** /Q overlay-text quadding: 0 left-justified, 1 centered, 2 right-justified. */
  overlayQuadding?: 0 | 1 | 2
  /** /RO replacement Form XObject. Takes precedence over IC and text overlay entries when redaction is applied. */
  overlayAppearance?: Extract<PdfRawValueDef, { kind: 'stream' }>
}

/** PDF 2.0 projection annotation associated with an external run-time environment. */
export interface PdfProjectionAnnotation extends PdfAnnotationBase {
  subtype: 'Projection'
}

export interface PdfInkAnnotation extends PdfAnnotationBase {
  subtype: 'Ink'
  paths: PdfAnnotationPoint[][]
}

export interface PdfPopupAnnotation extends PdfAnnotationBase {
  subtype: 'Popup'
  /** Index in PdfBackendOptions.annotations of the parent markup annotation. */
  parentIndex: number
  open?: boolean
}

export interface PdfSoundAnnotation extends PdfAnnotationBase {
  subtype: 'Sound'
  /** Raw sample bytes stored in the PDF /Sound stream. */
  data: Uint8Array
  /** Sampling rate in samples per second. */
  sampleRate: number
  /** Number of sound channels. */
  channels: number
  /** Bits per sample value written as /B. */
  bitsPerSample: number
  /** Sample encoding name written as /E. */
  encoding: PdfSoundEncoding
  /** Optional speaker icon name. */
  icon?: 'Speaker' | 'Mic'
}

export interface PdfMovieAnnotation extends PdfAnnotationBase {
  subtype: 'Movie'
  title?: string
  movie: PdfMovie
  activation?: boolean
}

/** Embedded media played by a Screen annotation's /Rendition action (ISO 32000 13.2). */
export interface PdfScreenMedia extends PdfMediaDefinition {
  /** Rendition and media-clip name (/N), shown by viewers in playback UI. */
  name: string
  /** Media MIME type (media clip /CT). */
  mimeType: string
  /** File name for the embedded media file specification. */
  fileName: string
  /** Embedded media bytes. */
  data: Uint8Array
}

export interface PdfScreenAnnotation extends PdfAnnotationBase {
  subtype: 'Screen'
  title?: string
  appearance?: PdfScreenAppearanceCharacteristics
  /** Media rendition bound via a /Rendition action (ISO 32000 12.6.4.14). */
  media?: PdfScreenMedia
}

export interface PdfPrepressAppearance {
  /** Appearance-state name used when AP/N contains alternate appearances. */
  name: string
  bbox: PdfPageBox
  content: Uint8Array
  matrix?: [number, number, number, number, number, number]
  resources?: Record<string, PdfRawValueDef>
}

export interface PdfPrinterMarkAppearance extends PdfPrepressAppearance {
  markStyle?: string
  colorants?: Record<string, PdfSeparationColorSpaceDef>
}

export interface PdfPrinterMarkAnnotation extends PdfAnnotationBase {
  subtype: 'PrinterMark'
  /** Printer-mark kind such as ColorBar or RegistrationTarget. */
  markName?: string
  appearances: PdfPrinterMarkAppearance[]
  /** Required when more than one normal appearance is present. */
  appearanceState?: string
}

export interface PdfTrapNetAnnotation extends PdfAnnotationBase {
  subtype: 'TrapNet'
  appearances: PdfPrepressAppearance[]
  /** Required current trap-network appearance state. */
  appearanceState: string
  /** Date-based invalidation and object-version invalidation are mutually exclusive. */
  lastModified?: Date
  /** Generates Version and AnnotStates from the serialized page description. */
  version?: 'page-description'
  /** Font resource IDs replaced while producing the trap network. */
  fontFauxingFontIds?: string[]
}

export interface PdfWatermarkAnnotation extends PdfAnnotationBase {
  subtype: 'Watermark'
  fixedPrint?: PdfFixedPrint
}

export interface PdfFileAttachmentAnnotation extends PdfAnnotationBase {
  subtype: 'FileAttachment'
  file: PdfEmbeddedFile
  icon?: PdfAnnotationFileAttachmentIcon
}

/** Rich media annotation (ISO 32000-2 12.5.6.24). The media bytes pass through. */
export interface PdfRichMediaAnnotation extends PdfAnnotationBase {
  subtype: 'RichMedia'
  /** Configuration and instance content type. */
  contentType: 'Video' | 'Sound' | 'Flash' | '3D'
  /** Asset name in the RichMediaContent assets name tree. */
  assetName: string
  /** Asset MIME type for the embedded file stream. */
  mimeType: string
  /** Embedded media bytes. */
  data: Uint8Array
  /** Activation condition (/RichMediaSettings /Activation /Condition, default XA=explicit). */
  activationCondition?: 'PO' | 'PV' | 'XA'
  /** Deactivation condition (/Deactivation /Condition, default XD=explicit). */
  deactivationCondition?: 'PC' | 'PI' | 'XD'
}

/** 3D artwork annotation (ISO 32000 13.6.2). */
export interface Pdf3DAnnotation extends PdfAnnotationBase {
  subtype: '3D'
  /** 3D stream subtype: Universal 3D or Product Representation Compact. */
  format: 'U3D' | 'PRC'
  /** 3D artwork bytes, embedded as the /3DD stream. */
  data: Uint8Array
  /** External name of the default view (/3DV /XN, ISO 32000 13.6.4). */
  viewName?: string
  /** Activate the artwork when its page opens (/3DA /A /PO, table 298). */
  activateOnPageOpen?: boolean
  /** Render the decoded scene bounds as the annotation's inactive normal appearance. */
  poster?: 'scene'
}

export type PdfAnnotation =
  | PdfPreservedAnnotation
  | PdfLinkAnnotation
  | PdfTextAnnotation
  | PdfFreeTextAnnotation
  | PdfLineAnnotation
  | PdfSquareCircleAnnotation
  | PdfTextMarkupAnnotation
  | PdfPolygonAnnotation
  | PdfStampAnnotation
  | PdfCaretAnnotation
  | PdfInkAnnotation
  | PdfPopupAnnotation
  | PdfSoundAnnotation
  | PdfMovieAnnotation
  | PdfScreenAnnotation
  | PdfPrinterMarkAnnotation
  | PdfTrapNetAnnotation
  | PdfWatermarkAnnotation
  | PdfFileAttachmentAnnotation
  | PdfRedactAnnotation
  | PdfProjectionAnnotation
  | Pdf3DAnnotation
  | PdfRichMediaAnnotation

/** Indirect dictionary/stream owned by a structure element through an OBJR. */
export interface PdfStructureObjectReference {
  structureElementId: string
  object: Extract<PdfRawValueDef, { kind: 'dictionary' | 'stream' }>
  /** Page context written on the OBJR when the object belongs to one page. */
  pageIndex?: number
}

type PdfTypedAnnotation = Exclude<PdfAnnotation, PdfPreservedAnnotation>

export type PdfPageRotation = 0 | 90 | 180 | 270

export type PdfPageBox = [number, number, number, number]

export type PdfDeviceColorant =
  | { kind: 'name', value: string }
  | { kind: 'string', value: string }

/** Page-set relationship for composite/separation production pages. */
export interface PdfSeparationInfo {
  /** Zero-based indexes of every page representing the same document page. */
  pages: number[]
  deviceColorant: PdfDeviceColorant
  colorSpace?: PdfSeparationColorSpaceDef | PdfDeviceNColorSpaceDef
}

export type PdfPageTransparencyGroup = PageTransparencyGroupDef

export interface PdfPageOptions {
  /** Page dictionary /CropBox in default user-space units. */
  cropBox?: PdfPageBox
  /** Page dictionary /BleedBox in default user-space units. */
  bleedBox?: PdfPageBox
  /** Page dictionary /TrimBox in default user-space units. */
  trimBox?: PdfPageBox
  /** Page dictionary /ArtBox in default user-space units. */
  artBox?: PdfPageBox
  /** Page dictionary /Rotate value. */
  rotate?: PdfPageRotation
  /** Page dictionary /UserUnit value. */
  userUnit?: number
  /** Annotation tab order. */
  tabs?: 'R' | 'C' | 'S'
  /** Presentation page duration in seconds. */
  duration?: number
  /** Presentation transition dictionary. */
  transition?: PdfPageTransitionDef
  /** Typed measurement viewports or raw viewport dictionaries retained verbatim. */
  viewports?: (PdfMeasurementViewport | Record<string, PdfRawValueDef>)[]
  /** Page additional-actions dictionary. Actions are retained, not executed. */
  additionalActions?: Record<string, PdfRawValueDef>
  /** Typed page trigger actions. Actions are retained, not executed. */
  additionalActionModels?: Record<string, PdfActionDef>
  /** Page metadata stream. */
  metadata?: Extract<PdfRawValueDef, { kind: 'stream' }>
  /** Page-piece dictionary. */
  pieceInfo?: Record<string, PdfRawValueDef>
  /** Page modification date; required when pieceInfo is present. */
  lastModified?: PdfRawValueDef
  /** Image resource ID emitted as the page dictionary /Thumb image XObject. */
  thumbnailImageId?: string
  /** Separation-page relationship. Declaring it on one member applies it to the complete page set. */
  separationInfo?: PdfSeparationInfo
  /** Page-level transparency group dictionary. */
  transparencyGroup?: PdfPageTransparencyGroup
}

/**
 * One document part in the DPart hierarchy (ISO 32000-2 14.12). Groups a
 * contiguous page range under document-part metadata (DPM), used by
 * production workflows to attach logical structure (chapters, mail-merge
 * recipients) to page ranges.
 */
export type PdfDocumentPartMetadataValue =
  | string
  | number
  | boolean
  | Date
  | { type: 'name', value: string }
  | PdfDocumentPartMetadataValue[]
  | { [key: string]: PdfDocumentPartMetadataValue }

export interface PdfDocumentPart {
  /** First page index (0-based, inclusive). Required on a leaf node. */
  startPage?: number
  /** Last page index (0-based, inclusive). Omitted when equal to startPage. */
  endPage?: number
  /** Document-part metadata written as the /DPart /DPM dictionary. */
  metadata?: Record<string, PdfDocumentPartMetadataValue>
  /** Immediate descendants, grouped exactly as the PDF /DParts array of arrays. */
  children?: PdfDocumentPart[][]
}

/** Complete PDF 2.0 document-part hierarchy rooted at DPartRootNode. */
export interface PdfDocumentPartHierarchy {
  root: PdfDocumentPart
  /** DPM key names that identify nodes at successive hierarchy levels. */
  nodeNameList?: string[]
  /** Zero-based hierarchy level whose DPM is a document record. */
  recordLevel?: number
}

interface PreparedPdfDocumentPart {
  id: number
  parentId: number
  source: PdfDocumentPart
  startPage?: number
  endPage?: number
  childGroups: PreparedPdfDocumentPart[][]
}

interface PreparedPdfDocumentPartHierarchy {
  rootId: number
  rootDictionaryId: number
  root: PreparedPdfDocumentPart
  nodeNameList?: string[]
  recordLevel?: number
  pageNodeIds: number[]
  actionNodeIds: number[]
}

export interface PdfViewerPreferences {
  hideToolbar?: boolean
  hideMenubar?: boolean
  hideWindowUI?: boolean
  fitWindow?: boolean
  centerWindow?: boolean
  displayDocTitle?: boolean
  nonFullScreenPageMode?: Extract<PdfPageMode, 'UseNone' | 'UseOutlines' | 'UseThumbs' | 'UseOC'>
  direction?: 'L2R' | 'R2L'
  viewArea?: PdfPageBoundary
  viewClip?: PdfPageBoundary
  printArea?: PdfPageBoundary
  printClip?: PdfPageBoundary
  printScaling?: 'None' | 'AppDefault'
  duplex?: 'Simplex' | 'DuplexFlipShortEdge' | 'DuplexFlipLongEdge'
  pickTrayByPDFSize?: boolean
  printPageRange?: number[]
  numCopies?: number
}

/** PDF 2.0 catalog dictionaries not owned by another dedicated backend option. */
export interface PdfCatalogModel {
  /** Catalog /URI dictionary. Base is kept as bytes; further entries are lossless. */
  uri?: { base?: Uint8Array, entries?: Record<string, PdfRawValueDef> }
  /** Catalog /Lang, independent of whether the document is tagged. */
  language?: string
  /** Catalog /SpiderInfo plus /Names /URLS and /IDS Web Capture database. */
  spiderInfo?: PdfWebCapture
  /** Catalog /Extensions developer-extension declarations. */
  extensions?: PdfDeveloperExtensions
  /** Catalog /MarkInfo dictionary. Tagged output forces /Marked true. */
  markInfo?: Record<string, PdfRawValueDef>
  /** Catalog /Legal dictionary. */
  legal?: Record<string, PdfRawValueDef>
  /** Catalog /Requirements array. */
  requirements?: PdfDocumentRequirement[]
  /** Catalog /Perms dictionary. */
  permissions?: Record<string, PdfRawValueDef>
  /** Catalog trigger actions /AA. Actions are retained but never executed. */
  additionalActions?: Record<string, PdfActionDef>
}

/** ICC profile embedded by a PDF OutputIntent dictionary. */
export interface PdfOutputIntentProfile {
  /** Number of color components declared by the ICC profile stream. */
  components: 1 | 3 | 4
  /** Complete ICC profile bytes. */
  data: Uint8Array
}

/** CMYK destination profile and output-condition metadata for PDF/X-1a. */
export interface PdfXOutputProfile {
  /** Complete ICC output-profile bytes. The data color space must be CMYK. */
  data: Uint8Array
  /** Registered or locally unique output-condition identifier. */
  outputConditionIdentifier: string
  outputCondition?: string
  registryName?: string
  info?: string
  /** ICC rendering intent used for every RGB-to-CMYK conversion. */
  renderingIntent?: IccRenderingIntent
}

/** Catalog OutputIntent dictionary (ISO 32000-2, 14.11.5). */
export interface PdfOutputIntent {
  /** Output-intent subtype name written as /S. */
  subtype: string
  outputCondition?: string
  outputConditionIdentifier?: string
  registryName?: string
  info?: string
  /** Embedded destination ICC profile. */
  destinationProfile?: PdfOutputIntentProfile
  /** Externally referenced destination profile dictionary. */
  destinationProfileReference?: Record<string, PdfRawValueDef>
}

export interface PdfBackendOptions {
  /** fontId → Font mapping */
  fonts: Record<string, Font>
  /** Requested PDF header version. PDF 2.0-only features raise this automatically. */
  pdfVersion?: '1.4' | '1.5' | '1.6' | '1.7' | '2.0'
  /** Encryption options (password protection) */
  encryption?: PdfEncryptionOptions
  /** X.509 certificate encryption through the Adobe.PubSec security handler. */
  publicKeyEncryption?: PdfPubSecEncryptionOptions
  /** Streams explicitly routed through the /Identity crypt filter. */
  identityCryptFilter?: { metadata?: boolean, embeddedFiles?: string[] }
  /** Image resources (imageId → base64/data URI string or binary) */
  images?: Record<string, string | Uint8Array>
  /** Per-page PDF dictionaries consumed by this backend in page order. */
  pageOptions?: readonly PdfPageOptions[]
  /** Document metadata */
  metadata?: PdfMetadata
  optionalContentProperties?: PdfOptionalContentPropertiesDef
  /** Catalog /PageMode. */
  pageMode?: PdfPageMode
  /** Catalog /PageLayout. */
  pageLayout?: PdfPageLayout
  /** Catalog /ViewerPreferences dictionary. */
  viewerPreferences?: PdfViewerPreferences
  /** Remaining typed/lossless Catalog dictionaries. */
  catalog?: PdfCatalogModel
  /** Catalog /OutputIntents. Owned automatically when PDF/A or PDF/X output is requested. */
  outputIntents?: PdfOutputIntent[]
  /** Catalog /PageLabels number tree. */
  pageLabels?: PdfPageLabel[]
  /** Compatibility page-range list, normalized to one child group below a root node. */
  documentParts?: PdfDocumentPart[]
  /** Arbitrarily deep PDF 2.0 document-part hierarchy. */
  documentPartHierarchy?: PdfDocumentPartHierarchy
  /** Catalog /OpenAction destination. */
  openAction?: PdfOpenAction
  /** Catalog /OpenAction action dictionary. Mutually exclusive with openAction. */
  documentOpenAction?: PdfActionDef
  /** Catalog destination name tree entries. */
  namedDestinations?: PdfNamedDestination[]
  /** Additional Catalog /Names trees not owned by a dedicated option. */
  nameTrees?: Record<string, PdfNameTreeEntry[]>
  /** Additional catalog number trees not owned by a dedicated option. */
  numberTrees?: Record<string, PdfNumberTreeEntry[]>
  /** Catalog /Names /JavaScript action entries. */
  javaScript?: PdfJavaScriptAction[]
  /** Catalog /Names /EmbeddedFiles entries. */
  embeddedFiles?: PdfEmbeddedFile[]
  /** Catalog /Collection dictionary. */
  collection?: PdfCollection
  /** Catalog /Threads article thread dictionaries. */
  articleThreads?: PdfArticleThread[]
  /** Page annotation dictionaries other than hyperlinks and AcroForm widgets. */
  annotations?: PdfAnnotation[]
  /** XML Forms Architecture data in the AcroForm /XFA entry (Annex K). */
  xfa?: PdfXfa
  /** Non-annotation indirect objects connected to structure elements by OBJR. */
  structureObjects?: PdfStructureObjectReference[]
  /** PDF/A conformance level */
  pdfaConformance?: PdfAConformance
  pdfxConformance?: PdfXConformance
  /** PDF/X OutputIntent profile; the same profile drives all content conversion. */
  pdfxOutputProfile?: PdfXOutputProfile
  /**
   * Content color management: 'srgb-icc' wraps every RGB content color in an
   * ICCBased sRGB color space (cs/scn) instead of DeviceRGB operators.
   */
  colorProfile?: 'srgb-icc'
  /** PNG/WebP/AVIF decoder implementation (default: pure TypeScript, PNG only) */
  rasterImageDecoder?: RasterImageDecoder
  /**
   * Standard-14 reference mode: fontId -> standard font name (e.g.
   * 'Helvetica'). Text draws as a non-embedded simple Type1 font with
   * WinAnsi encoding; metrics come from the built-in AFM data.
   */
  standardFonts?: Record<string, string>
}

export interface PdfConformanceValidationOptions {
  pdfaConformance?: PdfAConformance
  pdfxConformance?: PdfXConformance
  /** Verifies exact registered output-condition identifiers used by PDF/X. */
  pdfxOutputConditionValidator?: import('../pdf/pdf-output-intent.js').PdfXOutputConditionValidator
}

function hasDefaultPrintingAlternate(alternate: { defaultForPrinting?: boolean }): boolean {
  return alternate.defaultForPrinting === true
}

function sameImageAlternates(
  left: Array<{ imageId: string, defaultForPrinting?: boolean }>,
  right: Array<{ imageId: string, defaultForPrinting?: boolean }>,
): boolean {
  if (left.length !== right.length) return false
  for (let alternateIndex = 0; alternateIndex < left.length; alternateIndex++) {
    const leftAlternate = left[alternateIndex]!
    const rightAlternate = right[alternateIndex]!
    if (
      leftAlternate.imageId !== rightAlternate.imageId
      || (leftAlternate.defaultForPrinting === true) !== (rightAlternate.defaultForPrinting === true)
    ) return false
  }
  return true
}

function mergePdfPageOptions(
  configured: PdfPageOptions | undefined,
  explicit: PdfPageOptions | undefined,
): PdfPageOptions | undefined {
  if (configured === undefined) return explicit
  if (explicit === undefined) return configured
  const merged = { ...configured } as Record<string, unknown>
  const explicitValues = explicit as Record<string, unknown>
  const keys = Object.keys(explicitValues)
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex]!
    const value = explicitValues[key]
    if (value !== undefined) merged[key] = value
  }
  return merged as PdfPageOptions
}

export class PdfBackend implements RenderBackend {
  private fonts: Record<string, Font>

  // Font tracking
  private fontRefMap = new Map<string, string>()  // fontId → "/F0"
  private fontUses = new Map<string, { fontId: string, mode: 'embedded' | 'reference' }>()
  /** fontId -> canonical standard-14 name (reference mode) */
  private standardFonts = new Map<string, string>()
  private verticalTextFonts = new Set<string>()  // fontIds needing an Identity-V Type0 variant
  private fontCounter = 0
  private usedGlyphs = new Map<string, Set<number>>()  // fontId → glyphId set
  private usedCodePoints = new Map<string, Map<number, number>>()  // fontId → (codePoint → glyphId)
  private glyphSourceTexts = new Map<string, Map<number, string>>()  // fontId → (glyphId → source text, for ToUnicode of shaped glyphs)

  // GID remapping (new GIDs after subsetting)
  private fontGidRemap = new Map<string, Map<number, number>>()  // fontId → (oldGid → newGid)

  // ExtGState tracking (opacity + blending mode)
  private gsCounter = 0
  private gsMap = new Map<string, string>()  // "f:0.5|s:0.5" or "bm:Multiply" → "/GS0"
  private gsValues: ExtGStateEntry[] = []

  // Shading tracking (for COLR v1 gradients)
  private shadingDefs: ShadingDef[] = []
  private meshPatternMap = new Map<string, string[]>()
  private tilingPatternMap = new Map<string, string>()
  private functionShadingMap = new Map<string, string>()
  private functionShadingIndexMap = new Map<string, number>()
  /** Collected interactive form fields (AcroForm widgets) */
  private formFieldDefs: FormFieldRecord[] = []
  private tilingPatternPdfDefs: TilingPatternPdfDef[] = []
  private separationMap = new Map<string, string>()
  private separationDefs: SeparationDef[] = []
  private deviceNMap = new Map<string, string>()
  private deviceNDefs: DeviceNDef[] = []
  private pdfSpecialColorMap = new Map<string, string>()
  private pdfSpecialColorDefs: PdfSpecialColorSpaceRecord[] = []
  private calibratedColorSpaceMap = new Map<string, string>()
  private calibratedColorSpaceDefs: CalibratedColorSpaceDef[] = []
  private patternColorSpaceMap = new Map<string, string>()
  private patternColorSpaceDefs: PatternColorSpaceDef[] = []
  private gradientPatternDefs: GradientPatternDef[] = []
  private gradientPatternMap = new Map<string, string>()  // gradient key -> "/P0"
  private gradientPatternCounter = 0

  // Transparency groups + soft masks (A6.2/A6.3). Captured child ops are
  // materialized into /Group Form XObjects at document serialization time.
  private opsStack: PdfOp[][] = []
  private transparencyGroupDefs: TransparencyGroupDef[] = []
  private transparencyGroupStack: TransparencyGroupFrame[] = []
  private pendingSoftMask: PendingSoftMask | null = null
  private capturingSoftMask: CapturingSoftMask | null = null
  private importedFormDefs: ImportedFormDef[] = []
  private importedFormStack: ImportedFormFrame[] = []
  private importedFormSemanticCounter = 0
  private sourceVectorDefs: SourceVectorFormDef[] = []
  private sourceVectorDefMap = new Map<string, number>()

  // Page accumulation
  private pageDataList: PageData[] = []
  private currentOps: PdfOp[] = []
  private currentPageWidth = 0
  private currentPageHeight = 0
  private currentPageOptions: PdfPageOptions | undefined
  private ctm: PdfMatrix = [1, 0, 0, 1, 0, 0]
  private ctmStack: PdfMatrix[] = []
  private parsedColorCache = new Map<string, TemplateColor>()
  private emittedGraphicsState: PdfEmittedGraphicsState = {}
  private emittedGraphicsStateStack: PdfEmittedGraphicsState[] = []
  private emittedGraphicsStateDepth = 0

  // Annotations (hyperlinks)
  private pageAnnotations = new Map<number, LinkAnnotation[]>()

  // Bookmarks/anchors
  private bookmarkEntries: BookmarkEntry[] = []
  private anchorEntries: AnchorEntry[] = []

  // Images
  private readonly imageResources: BackendImageResources
  private imageXObjects: ImageXObjectInfo[] = []
  private imageRefMap = new Map<string, string>()  // imageId → "/Im0"
  private imageInterpolation = new Map<string, boolean>()
  private imageIntent = new Map<string, RenderingIntent>()
  private imageAlternates = new Map<string, Array<{ imageId: string, defaultForPrinting?: boolean }>>()
  private alternateSelections = new WeakMap<NonNullable<ImageDrawOptions['alternates']>, Array<{ imageId: string, defaultForPrinting?: boolean }>>()
  private imageOpi = new Map<string, PdfOpiMetadataDef>()
  private imageMeasurements = new Map<string, PdfMeasurement>()
  private imagePointData = new Map<string, PdfPointData[]>()
  private imageCounter = 0
  private pageImages: Set<string>[] = []  // imageIds used per page
  private currentPageImages = new Set<string>()
  private rasterImageDecoder: RasterImageDecoder
  private ccittImageParams = new Map<string, CcittImageParams>()
  private encodedImageParams = new Map<string, EncodedImageParams>()
  /** OT-SVG glyph documents parsed once per document string */
  private svgGlyphDocCache = new Map<string, SvgDocument>()

  // Encryption
  private encryptionOptions?: PdfEncryptionOptions
  private publicKeyEncryptionOptions?: PdfPubSecEncryptionOptions
  private identityCryptFilter?: { metadata?: boolean, embeddedFiles?: string[] }
  private encryptCtx: EncryptionContext | null = null

  // Metadata
  private metadata?: PdfMetadata
  private pageMode?: PdfPageMode
  private pageLayout?: PdfPageLayout
  private viewerPreferences?: PdfViewerPreferences
  private catalogModel?: PdfCatalogModel
  private outputIntents?: PdfOutputIntent[]
  private pageLabels?: PdfPageLabel[]
  private documentParts?: PdfDocumentPart[]
  private documentPartHierarchy?: PdfDocumentPartHierarchy
  private openAction?: PdfOpenAction
  private documentOpenAction?: PdfActionDef
  private namedDestinations: PdfNamedDestination[] = []
  private nameTrees: Record<string, PdfNameTreeEntry[]> = {}
  private numberTrees: Record<string, PdfNumberTreeEntry[]> = {}
  private javaScript: PdfJavaScriptAction[] = []
  private embeddedFiles: PdfEmbeddedFile[] = []
  private collection?: PdfCollection
  private articleThreads: PdfArticleThread[] = []
  private annotations: PdfAnnotation[] = []
  private xfa?: PdfXfa
  private structureObjects: PdfStructureObjectReference[] = []
  private requestedPdfVersion?: '1.4' | '1.5' | '1.6' | '1.7' | '2.0'

  // PDF/A
  private pdfaConformance?: PdfAConformance
  private pdfxConformance?: PdfXConformance
  private pdfxOutputProfile?: PdfXOutputProfile
  private pdfxColorTransform?: IccOutputTransform
  private colorProfile?: 'srgb-icc'
  /** '/CSicc' once the ICCBased sRGB color space has been referenced */
  private iccColorSpaceName: string | null = null
  /** imageId -> stencil paint color for images emitted as /ImageMask */
  private stencilColors = new Map<string, string>()

  // Tagged PDF
  private tagged = false
  private documentLang?: string
  private roleMap?: Record<string, string>  // custom structure role -> standard PDF role
  private structureNamespaces?: StructureNamespaceDefinition[]
  private pronunciationLexiconFileIndexes?: number[]
  private mcidCounter = 0  // per-page MCID counter
  private structElements: StructElement[] = []  // all structure elements
  private structStack: number[] = []  // structure element nesting stack (structElements index)
  private taggedContentStack: { structElementIndex: number | null, markedContent: boolean }[] = []
  private pageStructParents: number[] = []  // page index → StructParents value
  private annotationStructElems = new Map<number, number[]>()  // pageIndex → (annotation index → structElem index, -1 = none)
  private pageMcidToStructElem: number[][] = []  // pageIndex → mcid → structElements index

  // Optional content groups (PDF layers)
  private optionalContentMap = new Map<string, string>()
  private optionalContentDefs: OptionalContentDef[] = []
  private readonly configuredOptionalContentProperties?: PdfOptionalContentPropertiesDef
  private readonly configuredPageOptions?: readonly PdfPageOptions[]

  constructor(options: PdfBackendOptions) {
    this.fonts = options.fonts
    this.requestedPdfVersion = options.pdfVersion
    this.encryptionOptions = options.encryption
    this.publicKeyEncryptionOptions = options.publicKeyEncryption
    this.identityCryptFilter = options.identityCryptFilter
    if (this.encryptionOptions !== undefined && this.publicKeyEncryptionOptions !== undefined) {
      throw new Error('PDF password encryption and public-key encryption are mutually exclusive')
    }
    this.imageResources = new BackendImageResources(options.images)
    this.configuredPageOptions = options.pageOptions
    this.metadata = options.metadata
    this.configuredOptionalContentProperties = options.optionalContentProperties
    if (this.configuredOptionalContentProperties !== undefined) validateOptionalContentPropertiesModel(this.configuredOptionalContentProperties)
    this.pageMode = options.pageMode
    this.pageLayout = options.pageLayout
    this.viewerPreferences = options.viewerPreferences
    this.catalogModel = options.catalog
    if (this.catalogModel?.extensions !== undefined) validatePdfDeveloperExtensions(this.catalogModel.extensions)
    this.outputIntents = options.outputIntents
    this.pageLabels = options.pageLabels
    this.documentParts = options.documentParts
    this.documentPartHierarchy = options.documentPartHierarchy
    if (this.documentParts !== undefined && this.documentPartHierarchy !== undefined) {
      throw new Error('PDF documentParts and documentPartHierarchy are mutually exclusive')
    }
    this.openAction = options.openAction
    this.documentOpenAction = options.documentOpenAction
    if (this.openAction !== undefined && this.documentOpenAction !== undefined) {
      throw new Error('PDF openAction and documentOpenAction are mutually exclusive')
    }
    this.namedDestinations = options.namedDestinations ?? []
    this.nameTrees = options.nameTrees ?? {}
    this.numberTrees = options.numberTrees ?? {}
    this.javaScript = options.javaScript ?? []
    this.embeddedFiles = options.embeddedFiles ?? []
    this.collection = options.collection
    this.articleThreads = options.articleThreads ?? []
    this.annotations = options.annotations ?? []
    this.xfa = options.xfa
    if (this.xfa !== undefined) validatePdfXfa(this.xfa)
    this.structureObjects = options.structureObjects ?? []
    this.pdfaConformance = options.pdfaConformance
    this.pdfxConformance = options.pdfxConformance
    if (options.pdfxOutputProfile !== undefined && this.pdfxConformance === undefined) {
      throw new Error('PDF pdfxOutputProfile requires pdfxConformance')
    }
    if (this.pdfxConformance !== undefined) {
      this.pdfxOutputProfile = options.pdfxOutputProfile ?? {
        data: generateCmykIccProfile(),
        outputConditionIdentifier: 'tsreport reference CMYK',
        info: 'tsreport reference CMYK output condition',
        renderingIntent: 'RelativeColorimetric',
      }
      if (this.pdfxOutputProfile.outputConditionIdentifier.length === 0) {
        throw new Error('PDF/X output-condition identifier must not be empty')
      }
      this.pdfxColorTransform = parseIccOutputProfile(this.pdfxOutputProfile.data)
      if (this.pdfxColorTransform.components !== 4 || this.pdfxColorTransform.destinationColorSpace !== 'CMYK') {
        throw new Error('PDF/X-1a output profile must have a four-component CMYK device space')
      }
    }
    if (this.xfa !== undefined && this.pdfaConformance !== undefined) {
      throw new Error(`${this.pdfaConformance} forbids XFA forms`)
    }
    if (this.xfa !== undefined && this.pdfxConformance !== undefined) {
      throw new Error(`${this.pdfxConformance} forbids interactive forms`)
    }
    if (this.outputIntents !== undefined && (this.pdfaConformance !== undefined || this.pdfxConformance !== undefined)) {
      throw new Error('PDF outputIntents are owned by PDF/A and PDF/X conformance output')
    }
    validatePdfOutputIntents(this.outputIntents)
    this.colorProfile = options.colorProfile
    this.rasterImageDecoder = options.rasterImageDecoder ?? getDefaultRasterImageDecoder()
    if (options.standardFonts) {
      for (const fontId of Object.keys(options.standardFonts)) {
        const canonical = resolveStandardFontName(options.standardFonts[fontId]!)
        if (canonical === null) {
          throw new Error(`Unknown standard font name: ${options.standardFonts[fontId]}`)
        }
        this.standardFonts.set(fontId, canonical)
      }
    }
  }

  // ─── Lifecycle ───

  beginDocument(): void {
    this.imageResources.beginDocument()
    this.pageDataList = []
    this.currentPageOptions = undefined
    this.fontRefMap.clear()
    this.fontUses.clear()
    this.verticalTextFonts.clear()
    this.fontCounter = 0
    this.usedGlyphs.clear()
    this.usedCodePoints.clear()
    this.glyphSourceTexts.clear()
    this.fontGidRemap.clear()
    this.gsCounter = 0
    this.gsMap.clear()
    this.gsValues = []
    this.shadingDefs = []
    this.transparencyGroupDefs = []
    this.importedFormDefs = []
    this.importedFormStack = []
    this.importedFormSemanticCounter = 0
    this.sourceVectorDefs = []
    this.sourceVectorDefMap.clear()
    this.gradientPatternDefs = []
    this.gradientPatternMap.clear()
    this.gradientPatternCounter = 0
    this.meshPatternMap.clear()
    this.tilingPatternMap.clear()
    this.functionShadingMap.clear()
    this.functionShadingIndexMap.clear()
    this.formFieldDefs = []
    this.tilingPatternPdfDefs = []
    this.separationMap.clear()
    this.separationDefs = []
    this.deviceNMap.clear()
    this.deviceNDefs = []
    this.pdfSpecialColorMap.clear()
    this.pdfSpecialColorDefs = []
    this.calibratedColorSpaceMap.clear()
    this.calibratedColorSpaceDefs = []
    this.patternColorSpaceMap.clear()
    this.patternColorSpaceDefs = []
    this.iccColorSpaceName = null
    this.stencilColors.clear()
    this.pageAnnotations.clear()
    this.bookmarkEntries = []
    this.anchorEntries = []
    this.imageXObjects = []
    this.imageRefMap.clear()
    this.imageInterpolation.clear()
    this.imageIntent.clear()
    this.imageAlternates.clear()
    this.alternateSelections = new WeakMap()
    this.imageOpi.clear()
    this.imageMeasurements.clear()
    this.imagePointData.clear()
    this.imageCounter = 0
    this.ccittImageParams.clear()
    this.encodedImageParams.clear()
    this.pageImages = []
    this.ctm = [1, 0, 0, 1, 0, 0]
    this.ctmStack = []
    this.parsedColorCache.clear()
    this.resetEmittedGraphicsState()
    this.emittedGraphicsStateDepth = 0
    // Reset Tagged PDF state
    this.mcidCounter = 0
    this.structElements = []
    this.structStack = []
    this.taggedContentStack = []
    this.pageStructParents = []
    this.annotationStructElems = new Map()
    this.pageMcidToStructElem = []
    this.optionalContentMap.clear()
    this.optionalContentDefs = []
  }

  endDocument(): void {
    // The PDF binary is produced by toUint8Array()
  }

  beginPage(width: number, height: number, options?: PdfPageOptions): void {
    this.imageResources.beginPage()
    const configuredOptions = this.configuredPageOptions?.[this.pageDataList.length]
    const pageOptions = mergePdfPageOptions(configuredOptions, options)
    validatePdfPageOptions(pageOptions)
    this.currentOps = []
    this.currentPageWidth = width
    this.currentPageHeight = height
    this.currentPageOptions = pageOptions
    // Y axis flip: move the origin to the top-left with Y pointing downward
    this.currentOps.push(`1 0 0 -1 0 ${pn(height)} cm`)
    // Lower the curve flattening tolerance to reduce seam artifacts when zoomed in.
    // Flatness (i) in the PDF spec is a rendering quality hint and does not change the geometry.
    this.currentOps.push('0.01 i')
    this.ctm = [1, 0, 0, -1, 0, height]
    this.ctmStack = []
    this.resetEmittedGraphicsState()
    this.emittedGraphicsStateDepth = 0
    // Tagged PDF: reset the MCID counter per page
    this.mcidCounter = 0
  }

  endPage(): void {
    if (this.taggedContentStack.length !== 0 || this.structStack.length !== 0) {
      throw new Error('Tagged PDF content must be closed before endPage')
    }
    this.pageDataList.push({
      width: this.currentPageWidth,
      height: this.currentPageHeight,
      cropBox: this.currentPageOptions?.cropBox === undefined ? undefined : [
        this.currentPageOptions.cropBox[0],
        this.currentPageOptions.cropBox[1],
        this.currentPageOptions.cropBox[2],
        this.currentPageOptions.cropBox[3],
      ],
      bleedBox: copyPdfPageBox(this.currentPageOptions?.bleedBox),
      trimBox: copyPdfPageBox(this.currentPageOptions?.trimBox),
      artBox: copyPdfPageBox(this.currentPageOptions?.artBox),
      rotate: this.currentPageOptions?.rotate,
      userUnit: this.currentPageOptions?.userUnit,
      tabs: this.currentPageOptions?.tabs,
      duration: this.currentPageOptions?.duration,
      transition: this.currentPageOptions?.transition,
      viewports: this.currentPageOptions?.viewports,
      additionalActions: this.currentPageOptions?.additionalActions,
      additionalActionModels: this.currentPageOptions?.additionalActionModels,
      metadata: this.currentPageOptions?.metadata,
      pieceInfo: this.currentPageOptions?.pieceInfo,
      lastModified: this.currentPageOptions?.lastModified,
      thumbnailImageId: this.currentPageOptions?.thumbnailImageId,
      separationInfo: this.currentPageOptions?.separationInfo,
      transparencyGroup: this.currentPageOptions?.transparencyGroup,
      ops: this.currentOps,
    })
    this.currentOps = []
    this.currentPageOptions = undefined
    this.pageImages.push(this.currentPageImages)
    this.currentPageImages = new Set()
  }

  // ─── Graphics state ───

  save(): void {
    this.pushGraphicsState()
    this.ctmStack.push(this.ctm)
  }

  restore(): void {
    this.popGraphicsState()
    if (this.ctmStack.length > 0) {
      this.ctm = this.ctmStack.pop()!
    }
  }

  translate(x: number, y: number): void {
    if (x === 0 && y === 0) return
    this.currentOps.push(`1 0 0 1 ${pn(x)} ${pn(y)} cm`)
    this.ctm = multiplyPdfMatrix(this.ctm, [1, 0, 0, 1, x, y])
  }

  rotate(angle: number): void {
    const rad = angle * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    this.currentOps.push(`${pn(cos)} ${pn(sin)} ${pn(-sin)} ${pn(cos)} 0 0 cm`)
    this.ctm = multiplyPdfMatrix(this.ctm, [cos, sin, -sin, cos, 0, 0])
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0) return
    this.currentOps.push(`${pn(a)} ${pn(b)} ${pn(c)} ${pn(d)} ${pn(e)} ${pn(f)} cm`)
    this.ctm = multiplyPdfMatrix(this.ctm, [a, b, c, d, e, f])
  }

  clip(x: number, y: number, width: number, height: number): void {
    this.currentOps.push(`${pn(x)} ${pn(y)} ${pn(width)} ${pn(height)} re W n`)
  }

  clipPath(commands: Uint8Array, coords: Float32Array, fillRule?: 'nonzero' | 'evenodd'): void {
    this.appendPathCommands(commands, coords)
    this.currentOps.push(fillRule === 'evenodd' ? 'W* n' : 'W n')
  }

  setOpacity(opacity: number): void {
    if ((this.pdfaConformance === 'PDF/A-1b' || this.pdfxConformance === 'PDF/X-1a') && opacity < 1) {
      throw new Error(`${this.pdfaConformance ?? this.pdfxConformance} forbids transparency opacity`)
    }
    this.applyPathOpacity(opacity, opacity)
  }

  setBlendMode(mode: BlendMode): void {
    const blendMode = pdfBlendModeFromSvg(mode)
    if ((this.pdfaConformance === 'PDF/A-1b' || this.pdfxConformance === 'PDF/X-1a')
      && blendMode !== 'Normal' && blendMode !== 'Compatible') {
      throw new Error(`${this.pdfaConformance ?? this.pdfxConformance} forbids non-normal blend modes`)
    }
    const key = `bm:${blendMode}`
    let name = this.gsMap.get(key)
    if (!name) {
      name = `/GS${this.gsCounter++}`
      this.gsMap.set(key, name)
      this.gsValues.push({ name, blendMode })
    }
    this.currentOps.push(`${name} gs`)
  }

  setOverprint(fill: boolean, stroke: boolean, mode: OverprintMode): void {
    const key = `op:${fill ? 1 : 0}|OP:${stroke ? 1 : 0}|OPM:${mode}`
    let name = this.gsMap.get(key)
    if (!name) {
      name = `/GS${this.gsCounter++}`
      this.gsMap.set(key, name)
      this.gsValues.push({ name, overprintFill: fill, overprintStroke: stroke, overprintMode: mode })
    }
    this.currentOps.push(`${name} gs`)
  }

  setRenderingIntent(intent: RenderingIntent): void {
    const key = `ri:${intent}`
    let name = this.gsMap.get(key)
    if (!name) {
      name = `/GS${this.gsCounter++}`
      this.gsMap.set(key, name)
      this.gsValues.push({ name, renderingIntent: intent })
    }
    this.currentOps.push(`${name} gs`)
  }

  setTransparencyParameters(alphaIsShape: boolean | undefined, textKnockout: boolean | undefined): void {
    const key = `ais:${alphaIsShape === undefined ? '-' : alphaIsShape ? 1 : 0}|tk:${textKnockout === undefined ? '-' : textKnockout ? 1 : 0}`
    let name = this.gsMap.get(key)
    if (!name) {
      name = `/GS${this.gsCounter++}`
      this.gsMap.set(key, name)
      this.gsValues.push({ name, alphaIsShape, textKnockout })
    }
    this.currentOps.push(`${name} gs`)
  }

  setDeviceParams(params: RenderDeviceParams): void {
    validateRenderDeviceParams(params)
    const key = `dp:${JSON.stringify(params)}`
    let name = this.gsMap.get(key)
    if (!name) {
      name = `/GS${this.gsCounter++}`
      this.gsMap.set(key, name)
      this.gsValues.push({ name, deviceParams: params })
    }
    this.currentOps.push(`${name} gs`)
  }

  // ─── Drawing primitives ───

  drawText(
    x: number, y: number,
    text: string,
    fontId: string, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void {
    const explicitActualText = options?.actualText === undefined ? null : pdfUtf16BeHex(options.actualText)
    const standardName = this.standardFonts.get(fontId)
    if (standardName !== undefined) {
      this.drawStandardFontText(x, y, text, fontId, standardName, fontSize, color, options)
      return
    }
    const font = this.fonts[fontId]
    if (!font) throw new Error(`Font not found: ${fontId}`)
    const fontMode = options?.pdfFontMode ?? 'embedded'
    const fontUseKey = fontMode === 'reference' ? `${fontId}\u0000reference` : fontId

    // Apply Variable Font axis values (reset after drawing)
    const hasVariation = !!options?.variation
    if (hasVariation) {
      font.setVariation(options!.variation!)
    }

    const m = font.metrics
    const scale = fontSize / m.unitsPerEm
    const ascent = m.ascender * scale
    const baseline = y + (options?.baselineOffset ?? ascent)
    const isVertical = options?.writingMode === 'vertical-rl' || options?.writingMode === 'vertical-lr'
    const horizontalScale = isVertical ? 1 : (options?.horizontalScale ?? 1)

    // Determine synthetic Bold/Italic
    const needsSyntheticBold = !!options?.bold && !m.isBold
    const needsSyntheticItalic = !!options?.italic && !m.isItalic
    const slant = needsSyntheticItalic ? Math.tan(12 * Math.PI / 180) : 0
    const boldWidth = needsSyntheticBold ? fontSize * 0.025 : 0

    const hasPresetGlyphIds = !!options?.glyphIds && options.glyphIds.length > 0
    // A bitmap-only font with no scalable outlines cannot be subset/embedded:
    // its glyphs are drawn as bitmap images referenced by no text operator, so
    // no /Font resource exists. CFF2 (variable) fonts ARE embeddable: the
    // instance is baked into a static CID-keyed CFF (see subsetCff2ByGlyphIds).
    const cannotEmbed = !font.hasScalableOutlines
    // When a variation is specified, draw in path mode (the subset does not retain gvar).
    // Also fall back to path mode when bold/italic flags are set (glyph coordinate manipulation is impossible in Text mode).
    // Preset glyphIds (math variants/assemblies) prefer path drawing to avoid PDF viewer-dependent differences.
    // A MATH table alone does not force path mode: plain text in a math font
    // (e.g. STIX Two Math) draws as selectable, extractable text; only actual
    // math-variant glyphs (hasPresetGlyphIds) use path drawing.
    const hasAatShapeOverrides = options?.glyphRun?.xScales !== undefined
      || options?.glyphRun?.yScales !== undefined
      || options?.glyphRun?.outlineOverrides !== undefined
      || options?.glyphRun?.mergeGroups !== undefined
    const forcePathMode = !!options?.outlineText || hasVariation || needsSyntheticBold || needsSyntheticItalic || hasPresetGlyphIds || hasAatShapeOverrides

    // Shaped glyph run: provided by the layout engine, or shaped here for direct
    // vertical calls (vertical alternates vert/vrt2 apply to every vertical path).
    // When a run is present, its advances are authoritative (spacing already baked in).
    let run = options?.glyphRun
    if (!run && isVertical && !hasPresetGlyphIds) {
      run = shapeGlyphRun(font, text, fontSize, options?.letterSpacing ?? 0, 0, true, 1, options?.direction ?? 'ltr')
    }
    const letterSpacing = run ? 0 : (options?.letterSpacing ?? 0)

    // GID conversion + tracking + color check
    const glyphIds: number[] = []
    let textExtent = 0
    let hasColorGlyphs = false
    let hasV1ColorGlyphs = false
    let hasSvgOrBitmapGlyphs = false
    const fontHasColrGlyphs = font.hasColrGlyphs
    const fontHasSvgOrBitmapGlyphs = font.hasSvgGlyphs || font.hasEmbeddedBitmapGlyphs
    if (run) {
      const runGlyphIds = run.glyphIds
      const runAdvances = run.advances
      for (let gi = 0; gi < runGlyphIds.length; gi++) {
        const gid = runGlyphIds[gi]!
        glyphIds.push(gid)
        textExtent += runAdvances[gi]!
        if (fontHasColrGlyphs && !hasV1ColorGlyphs && font.getPaintTree(gid)) {
          hasV1ColorGlyphs = true
        }
        if (fontHasColrGlyphs && !hasColorGlyphs && font.getColorLayers(gid)) {
          hasColorGlyphs = true
        }
        if (fontHasSvgOrBitmapGlyphs && !hasSvgOrBitmapGlyphs && this.hasSvgOrBitmapGlyph(font, gid, fontSize)) {
          hasSvgOrBitmapGlyphs = true
        }
      }
      this.trackGlyphRun(fontUseKey, run, text)
    } else {
      const presetGlyphIds = options?.glyphIds
      let gi2 = 0
      for (let ti = 0; ti < text.length; ti++) {
        let cp = text.charCodeAt(ti)
        if (cp >= 0xD800 && cp <= 0xDBFF && ti + 1 < text.length) {
          const lo = text.charCodeAt(ti + 1)
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            cp = ((cp - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
            ti++
          }
        }
        const gid = presetGlyphIds && gi2 < presetGlyphIds.length ? presetGlyphIds[gi2]! : font.getGlyphId(cp)
        glyphIds.push(gid)
        this.trackGlyph(fontUseKey, cp, gid)
        if (isVertical) {
          textExtent += font.getAdvanceHeight(gid) * scale
        } else {
          textExtent += (font.getAdvanceWidth(gid) * scale + letterSpacing) * horizontalScale
        }
        if (fontHasColrGlyphs && !hasV1ColorGlyphs && font.getPaintTree(gid)) {
          hasV1ColorGlyphs = true
        }
        if (fontHasColrGlyphs && !hasColorGlyphs && font.getColorLayers(gid)) {
          hasColorGlyphs = true
        }
        if (fontHasSvgOrBitmapGlyphs && !hasSvgOrBitmapGlyphs && this.hasSvgOrBitmapGlyph(font, gid, fontSize)) {
          hasSvgOrBitmapGlyphs = true
        }
        gi2++
      }
    }

    // hAlign calculation (horizontal writing only)
    let drawX = x
    if (!isVertical && options?.hAlign && options.width) {
      if (options.hAlign === 'center') {
        drawX = x + (options.width - textExtent) / 2
      } else if (options.hAlign === 'right') {
        drawX = x + options.width - textExtent
      }
    }

    const [r, g, b] = parseColor(color)
    const textPaint = pdfTextPaint(color, options)
    const nonFillTextPaint = textPaint.mode !== 'fill'

    // Maintain the font subset even for path drawing (for PDF structure/validation and ToUnicode).
    // A non-embeddable font (CFF2 or bitmap-only) is not registered: its glyphs
    // are drawn purely as paths / bitmap images referenced by no text operator,
    // so no /Font resource is needed for it.
    const ref = cannotEmbed || options?.outlineText === true ? '' : this.ensureFontRef(fontId, fontMode)

    // Vertical text renders as real CID text with Identity-V unless the run
    // carries cross-column GPOS placements (rare) or path mode is forced.
    // Inline-axis placement is represented in text mode with Ts/TJ below.
    let verticalCrossOffsets = false
    let verticalRotations = false
    if (isVertical && run) {
      for (let gi = 0; gi < run.glyphIds.length; gi++) {
        if (run.xOffsets[gi] !== 0) { verticalCrossOffsets = true; break }
      }
      if (run.rotations !== undefined) {
        for (let gi = 0; gi < run.rotations.length; gi++) {
          if (run.rotations[gi] === 90) { verticalRotations = true; break }
        }
      }
    }

    if (forcePathMode || hasV1ColorGlyphs || hasColorGlyphs || hasSvgOrBitmapGlyphs || (isVertical && (verticalCrossOffsets || verticalRotations))) {
      // Path mode drawing (color / variation / vertical writing)
      const baseY = baseline
      let cx = drawX
      let cy = baseY
      for (let gi = 0; gi < glyphIds.length; gi++) {
        const gid = glyphIds[gi]!
        // COLR v1 check
        // Compute glyph origin adjustment for vertical writing
        let glyphCx = cx
        let glyphCy = cy
        if (isVertical) {
          const halfAw = font.getAdvanceWidth(gid) * scale / 2
          const vOriginY = font.getVerticalOrigin(gid) * scale
          glyphCx = cx + fontSize / 2 - halfAw + (run?.xOffsets[gi] ?? 0)
          glyphCy = cy - ascent + vOriginY - (run?.yOffsets[gi] ?? 0)
        } else if (run) {
          // Apply GPOS placement offsets (mark positioning etc.)
          glyphCx = cx + run.xOffsets[gi]!
          glyphCy = cy - run.yOffsets[gi]!
        }

        const mergeGroup = run?.mergeGroups?.[gi] ?? 0
        if (mergeGroup !== 0) {
          const outlines: PositionedGlyphOutline[] = []
          let groupCx = cx
          let groupCy = cy
          let end = gi
          while (end < glyphIds.length && run!.mergeGroups![end] === mergeGroup) {
            const memberGid = glyphIds[end]!
            let originX = groupCx + run!.xOffsets[end]!
            let originY = groupCy - run!.yOffsets[end]!
            if (isVertical) {
              const halfAw = font.getAdvanceWidth(memberGid) * scale / 2
              originX = groupCx + fontSize / 2 - halfAw + run!.xOffsets[end]!
              originY = groupCy - ascent + font.getVerticalOrigin(memberGid) * scale - run!.yOffsets[end]!
            }
            const override = run!.outlineOverrides?.[end] ?? null
            outlines.push({
              outline: override ?? font.getGlyph(memberGid).outline,
              originX,
              originY,
              xScale: run!.xScales?.[end] ?? 1,
              yScale: run!.yScales?.[end] ?? 1,
              rotation: run!.rotations?.[end] === 90 ? 90 : 0,
            })
            if (isVertical) groupCy += run!.advances[end]!
            else groupCx += run!.advances[end]!
            end++
          }
          const merged = mergePositionedGlyphOutlines(outlines, scale, horizontalScale, slant)
          this.appendGlyphPath(merged.commands, merged.coords, 0, 0, 1, 1, r, g, b, 0, boldWidth, textPaint)
          cx = groupCx
          cy = groupCy
          gi = end - 1
          continue
        }

        const glyphScale = run?.xScales?.[gi] ?? 1
        const glyphYScale = run?.yScales?.[gi] ?? 1
        const glyphRotation = run?.rotations?.[gi] === 90 ? 90 : 0
        if (glyphRotation === 90) {
          this.pushGraphicsState()
          this.currentOps.push(`0 1 -1 0 ${pn(glyphCx + glyphCy)} ${pn(glyphCy - glyphCx)} cm`)
        }
        if (glyphScale !== 1 || glyphYScale !== 1) {
          this.pushGraphicsState()
          this.currentOps.push(`${pn(glyphScale)} 0 0 ${pn(glyphYScale)} ${pn(glyphCx * (1 - glyphScale))} ${pn(glyphCy * (1 - glyphYScale))} cm`)
        }

        const outlineOverride = run?.outlineOverrides?.[gi] ?? null
        const paintTree = outlineOverride === null && !nonFillTextPaint ? font.getPaintTree(gid) : null
        if (paintTree) {
          const fg = parseForegroundColor(color)
          const ctx: PdfColrContext = {
            ops: this.currentOps, font,
            shadingDefs: this.shadingDefs,
            gsMap: this.gsMap, gsValues: this.gsValues,
            gsCounter: this.gsCounter,
            outputTransform: this.pdfxColorTransform,
            renderingIntent: this.pdfxOutputProfile?.renderingIntent,
          }
          const colrOps = createPdfColrV1Ops(ctx)
          renderColrV1Glyph(font, gid, colrOps, scale, glyphCx, glyphCy, fg)
          this.gsCounter = ctx.gsCounter
        } else {
          // COLR v0 check
          const colorLayers = outlineOverride === null && !nonFillTextPaint ? font.getColorLayers(gid) : null
          if (colorLayers && colorLayers.length > 0) {
            for (let li = 0; li < colorLayers.length; li++) {
              const layer = colorLayers[li]!
              let lr = r, lg = g, lb = b
              if (layer.paletteIndex !== 0xFFFF) {
                const c = font.getColorFromSelectedPalette(layer.paletteIndex)
                if (c) { lr = c.r / 255; lg = c.g / 255; lb = c.b / 255 }
              }
              const layerGlyph = font.getGlyph(layer.glyphId)
              this.appendGlyphPath(layerGlyph.outline.commands, layerGlyph.outline.coords, glyphCx, glyphCy, scale, horizontalScale, lr, lg, lb, slant, boldWidth, textPaint)
            }
          } else if (outlineOverride !== null || nonFillTextPaint || !this.drawSvgOrBitmapGlyph(font, gid, glyphCx, glyphCy, fontSize, scale, color, isVertical)) {
            const outline = outlineOverride ?? font.getGlyph(gid).outline
            this.appendGlyphPath(outline.commands, outline.coords, glyphCx, glyphCy, scale, horizontalScale, r, g, b, slant, boldWidth, textPaint)
          }
        }
        if (glyphScale !== 1 || glyphYScale !== 1) this.popGraphicsState()
        if (glyphRotation === 90) this.popGraphicsState()
        if (run) {
          if (isVertical) {
            cy += run.advances[gi]!
          } else {
            cx += run.advances[gi]!
          }
        } else if (isVertical) {
          cy += font.getAdvanceHeight(gid) * scale
        } else {
          cx += (font.getAdvanceWidth(gid) * scale + letterSpacing) * horizontalScale
        }
      }
      // Path-drawn glyphs carry no text-showing operator, so the /ToUnicode CMap
      // is never exercised and the run is invisible to extraction, search and
      // accessibility. Overlay the same glyphs as invisible text (render mode 3)
      // so the text layer is recoverable. Only possible for embeddable fonts
      // (bitmap-only fonts have no /Font resource: ref is empty). A shared
      // skeleton run additionally needs /ActualText (see runSourceAmbiguous).
      if (ref !== '') {
        const overlayActual = explicitActualText ?? (run && this.runSourceAmbiguous(run, text)
          ? pdfUtf16BeHex(text) : null)
        if (overlayActual !== null) this.currentOps.push(`/Span << /ActualText ${overlayActual} >> BDC`)
        this.currentOps.push('BT')
        this.currentOps.push('3 Tr')
        if (isVertical) {
          this.verticalTextFonts.add(fontUseKey)
          this.currentOps.push(`${ref}V ${pn(fontSize)} Tf`)
          this.currentOps.push(`1 0 0 -1 ${pn(x + fontSize / 2)} ${pn(y)} Tm`)
          if (run) {
            const ov = computeVerticalRunTextAdjustments(font, run, glyphIds, fontSize)
            this.currentOps.push({ type: 'textGlyphs', fontId: fontUseKey, glyphIds, adjustments: ov.adjustments, rises: ov.rises })
          } else {
            this.currentOps.push({ type: 'textGlyphs', fontId: fontUseKey, glyphIds })
          }
        } else {
          this.currentOps.push(`${ref} ${pn(fontSize)} Tf`)
          // Non-run path drawing advances each glyph by its default width plus
          // letterSpacing; mirror that with Tc so the invisible layer stays
          // aligned with the visible glyphs for selection.
          if (letterSpacing !== 0) this.currentOps.push(`${pn(letterSpacing)} Tc`)
          this.currentOps.push(`${pn(horizontalScale)} 0 0 -1 ${pn(drawX)} ${pn(baseline)} Tm`)
          if (run) {
            const ov = computeRunTextAdjustments(font, run, glyphIds, fontSize, horizontalScale)
            this.currentOps.push({ type: 'textGlyphs', fontId: fontUseKey, glyphIds, adjustments: ov.adjustments, rises: ov.rises })
          } else {
            this.currentOps.push({ type: 'textGlyphs', fontId: fontUseKey, glyphIds })
          }
          if (letterSpacing !== 0) this.currentOps.push('0 Tc')
        }
        this.currentOps.push('0 Tr')
        this.currentOps.push('ET')
        if (overlayActual !== null) this.currentOps.push('EMC')
      }
    } else if (isVertical) {
      // Vertical text mode: Identity-V encoding, the current point tracks the
      // vertical origin (top-center of the column) and W2 metrics advance it
      this.verticalTextFonts.add(fontUseKey)
      const actualText = explicitActualText ?? (run && this.runSourceAmbiguous(run, text)
        ? pdfUtf16BeHex(text) : null)
      if (actualText !== null) this.currentOps.push(`/Span << /ActualText ${actualText} >> BDC`)
      this.currentOps.push('BT')
      this.pushTextPaint(textPaint)
      this.currentOps.push(`${ref}V ${pn(fontSize)} Tf`)
      this.currentOps.push(`1 0 0 -1 ${pn(x + fontSize / 2)} ${pn(y)} Tm`)
      if (run) {
        const runAdj = computeVerticalRunTextAdjustments(font, run, glyphIds, fontSize)
        this.currentOps.push({ type: 'textGlyphs', fontId: fontUseKey, glyphIds, adjustments: runAdj.adjustments, rises: runAdj.rises })
      } else {
        this.currentOps.push({ type: 'textGlyphs', fontId: fontUseKey, glyphIds })
      }
      this.currentOps.push('ET')
      if (actualText !== null) this.currentOps.push('EMC')
    } else {
      // Text mode (re-flip Y with Tm to render upright)
      const actualText = explicitActualText ?? (run && this.runSourceAmbiguous(run, text)
        ? pdfUtf16BeHex(text) : null)
      if (actualText !== null) this.currentOps.push(`/Span << /ActualText ${actualText} >> BDC`)
      this.currentOps.push('BT')
      this.pushTextPaint(textPaint)
      this.currentOps.push(`${ref} ${pn(fontSize)} Tf`)
      if (letterSpacing !== 0) {
        this.currentOps.push(`${pn(letterSpacing)} Tc`)
      }
      this.currentOps.push(`${pn(horizontalScale)} 0 0 -1 ${pn(drawX)} ${pn(baseline)} Tm`)
      if (run) {
        // Shaped run: emit TJ adjustments so viewers reproduce the shaped positions
        const runAdj = computeRunTextAdjustments(font, run, glyphIds, fontSize, horizontalScale)
        this.currentOps.push({ type: 'textGlyphs', fontId: fontUseKey, glyphIds, adjustments: runAdj.adjustments, rises: runAdj.rises })
      } else {
        this.currentOps.push({ type: 'textGlyphs', fontId: fontUseKey, glyphIds })
      }
      if (letterSpacing !== 0) {
        this.currentOps.push('0 Tc')
      }
      this.currentOps.push('ET')
      if (actualText !== null) this.currentOps.push('EMC')
    }

    // Underline (horizontal writing only)
    if (options?.underline && !isVertical) {
      const ulPos = m.underlinePosition * scale
      const ulThick = Math.max(m.underlineThickness * scale, 0.5)
      const lineY = baseline - ulPos
      this.pushGraphicsState()
      this.pushStrokeColor(color)
      this.currentOps.push(`${pn(ulThick)} w`)
      this.currentOps.push(`${pn(drawX)} ${pn(lineY)} m ${pn(drawX + textExtent)} ${pn(lineY)} l S`)
      this.popGraphicsState()
    }

    // Strikethrough (horizontal writing only)
    if (options?.strikethrough && !isVertical) {
      const strikeY = baseline - m.strikeoutPosition * scale
      const strikeThick = Math.max(m.strikeoutSize * scale, 0.5)
      this.pushGraphicsState()
      this.pushStrokeColor(color)
      this.currentOps.push(`${pn(strikeThick)} w`)
      this.currentOps.push(`${pn(drawX)} ${pn(strikeY)} m ${pn(drawX + textExtent)} ${pn(strikeY)} l S`)
      this.popGraphicsState()
    }

    // Reset Variable Font axis values (prevent leakage into other drawText calls)
    if (hasVariation) {
      font.setVariation({})
    }
  }

  drawLine(
    x1: number, y1: number, x2: number, y2: number,
    lineWidth: number, color: string,
    dash?: number[],
  ): void {
    this.pushStrokeColor(color)
    const lineWidthState = pn(lineWidth)
    if (this.emittedGraphicsState.lineWidth !== lineWidthState) {
      this.currentOps.push(`${lineWidthState} w`)
      this.emittedGraphicsState.lineWidth = lineWidthState
    }
    if (dash && dash.length > 0) {
      let dashStr = ''
      for (let di = 0; di < dash.length; di++) {
        if (di > 0) dashStr += ' '
        dashStr += pn(dash[di]!)
      }
      this.currentOps.push(`[${dashStr}] 0 d`)
      this.emittedGraphicsState.dash = `[${dashStr}] 0`
    }
    this.currentOps.push(`${pn(x1)} ${pn(y1)} m ${pn(x2)} ${pn(y2)} l S`)
    if (dash && dash.length > 0) {
      this.currentOps.push('[] 0 d')
      this.emittedGraphicsState.dash = '[] 0'
    }
  }

  drawRect(
    x: number, y: number, width: number, height: number,
    options?: RectDrawOptions,
  ): void {
    const hasFill = !!options?.fill
    const hasStroke = !!options?.stroke
    const radii = resolveRectCornerRadii(width, height, options)
    const hasRoundedCorners = radii.topLeft > 0
      || radii.topRight > 0
      || radii.bottomRight > 0
      || radii.bottomLeft > 0

    if (hasFill) {
      this.pushFillColor(options!.fill!)
    }
    if (hasStroke) {
      this.pushStrokeColor(options!.stroke!)
      this.appendShapeStrokeStyle(options!)
    }

    if (hasRoundedCorners) {
      this.appendRoundedRect(x, y, width, height, radii)
    } else {
      this.currentOps.push(`${pn(x)} ${pn(y)} ${pn(width)} ${pn(height)} re`)
    }

    this.currentOps.push(paintOp(hasFill, hasStroke, options?.fillRule))
  }

  drawEllipse(
    cx: number, cy: number, rx: number, ry: number,
    options?: ShapeDrawOptions,
  ): void {
    const hasFill = !!options?.fill
    const hasStroke = !!options?.stroke

    if (hasFill) {
      this.pushFillColor(options!.fill!)
    }
    if (hasStroke) {
      this.pushStrokeColor(options!.stroke!)
      this.appendShapeStrokeStyle(options!)
    }

    // Approximate the ellipse with 4 cubic Beziers (κ ≈ 0.5522847498)
    const k = 0.5522847498
    const kx = rx * k
    const ky = ry * k
    this.currentOps.push(`${pn(cx - rx)} ${pn(cy)} m`)
    this.currentOps.push(`${pn(cx - rx)} ${pn(cy - ky)} ${pn(cx - kx)} ${pn(cy - ry)} ${pn(cx)} ${pn(cy - ry)} c`)
    this.currentOps.push(`${pn(cx + kx)} ${pn(cy - ry)} ${pn(cx + rx)} ${pn(cy - ky)} ${pn(cx + rx)} ${pn(cy)} c`)
    this.currentOps.push(`${pn(cx + rx)} ${pn(cy + ky)} ${pn(cx + kx)} ${pn(cy + ry)} ${pn(cx)} ${pn(cy + ry)} c`)
    this.currentOps.push(`${pn(cx - kx)} ${pn(cy + ry)} ${pn(cx - rx)} ${pn(cy + ky)} ${pn(cx - rx)} ${pn(cy)} c`)
    this.currentOps.push('h')

    this.currentOps.push(paintOp(hasFill, hasStroke, options?.fillRule))
  }

  drawPath(
    commands: Uint8Array, coords: Float32Array,
    options?: ShapeDrawOptions,
  ): void {
    const hasFill = !!options?.fill
    const hasStroke = !!options?.stroke

    if (hasFill) {
      this.pushFillColor(options!.fill!)
    }
    if (hasStroke) {
      this.pushStrokeColor(options!.stroke!)
      this.appendShapeStrokeStyle(options!)
    }

    this.applyPathOpacity(
      hasFill ? options?.fillOpacity ?? 1 : 1,
      hasStroke ? options?.strokeOpacity ?? 1 : 1,
    )

    this.appendPathCommands(commands, coords)

    this.currentOps.push(paintOp(hasFill, hasStroke, options?.fillRule))
  }

  drawPathWithPaints(
    commands: Uint8Array, coords: Float32Array,
    options: PathPaintOptions,
  ): void {
    const hasFill = !!options.fill
    const hasStroke = !!options.stroke
    if (!hasFill && !hasStroke) return
    if (isComplexPaint(options.fill) || isComplexPaint(options.stroke)) {
      this.drawComplexPaintPath(commands, coords, options)
      return
    }

    this.pushGraphicsState()

    let fillOpacity = hasFill ? options.fillOpacity ?? 1 : 1
    let strokeOpacity = hasStroke ? options.strokeOpacity ?? 1 : 1

    if (hasFill) {
      const fill = options.fill! as string | PdfSpecialColorDef | GradientPaint
      if (typeof fill === 'string') {
        this.pushFillColor(fill)
      } else if (fill.type === 'pdfSpecialColor') {
        this.pushPdfSpecialColor(fill, false)
      } else {
        const uniformOpacity = extractUniformGradientOpacity(fill)
        if (uniformOpacity != null) {
          fillOpacity *= uniformOpacity
        }
        const patternPaint = transformGradientPaintForPattern(fill, this.ctm)
        const patternName = this.ensureGradientPattern(patternPaint)
        this.currentOps.push('/Pattern cs')
        this.currentOps.push(`${patternName} scn`)
      }
    }
    if (hasStroke) {
      const stroke = options.stroke! as string | PdfSpecialColorDef | GradientPaint
      if (typeof stroke === 'string') {
        this.pushStrokeColor(stroke)
      } else if (stroke.type === 'pdfSpecialColor') {
        this.pushPdfSpecialColor(stroke, true)
      } else {
        const uniformOpacity = extractUniformGradientOpacity(stroke)
        if (uniformOpacity != null) {
          strokeOpacity *= uniformOpacity
        }
        const patternPaint = transformGradientPaintForPattern(stroke, this.ctm)
        const patternName = this.ensureGradientPattern(patternPaint)
        this.currentOps.push('/Pattern CS')
        this.currentOps.push(`${patternName} SCN`)
      }
      this.appendShapeStrokeStyle(options)
    }

    this.applyPathOpacity(fillOpacity, strokeOpacity)

    this.appendPathCommands(commands, coords)
    this.currentOps.push(paintOp(hasFill, hasStroke, options.fillRule))
    this.popGraphicsState()
  }

  drawPdfSourceVector(
    source: RenderPdfSourceVector,
    options: PathPaintOptions,
  ): void {
    const optimizedFill = typeof options.fill === 'string' && !options.stroke
      ? options.fill
      : undefined
    if (optimizedFill === undefined) {
      for (let i = 0; i < source.instances.length; i++) {
        const instance = source.instances[i]!
        const definition = source.definitions[instance.definitionIndex]
        if (definition === undefined) throw new Error(`PDF source vector definition ${instance.definitionIndex} is missing`)
        if (definition.commands.length === 0) continue
        this.pushGraphicsState()
        this.transform(...instance.matrix)
        this.drawPathWithPaints(definition.commands, definition.coords, options)
        this.popGraphicsState()
      }
      return
    }

    this.pushGraphicsState()
    this.pushFillColor(optimizedFill)
    this.applyPathOpacity(options.fillOpacity ?? 1, 1)
    for (let i = 0; i < source.instances.length; i++) {
      const instance = source.instances[i]!
      const definition = source.definitions[instance.definitionIndex]
      if (definition === undefined) throw new Error(`PDF source vector definition ${instance.definitionIndex} is missing`)
      if (definition.commands.length === 0) continue
      const definitionIndex = this.ensureSourceVectorDefinition(
        definition.commands,
        definition.coords,
        options.fillRule ?? 'nonzero',
      )
      this.currentOps.push({
        type: 'sourceVectorInvoke',
        definitionIndex,
        matrix: [...instance.matrix],
      })
    }
    this.popGraphicsState()
  }

  private ensureSourceVectorDefinition(
    commands: Uint8Array,
    coords: Float32Array,
    fillRule: 'nonzero' | 'evenodd',
  ): number {
    const key = `${fillRule}|${commands.join(',')}|${coords.join(',')}`
    const existing = this.sourceVectorDefMap.get(key)
    if (existing !== undefined) return existing
    const bbox = pathCoordinateBounds(coords)
    const definitionIndex = this.sourceVectorDefs.length
    this.sourceVectorDefs.push({
      body: `${pathCommandsPdf(commands, coords)}\n${fillRule === 'evenodd' ? 'f*' : 'f'}`,
      bbox,
    })
    this.sourceVectorDefMap.set(key, definitionIndex)
    return definitionIndex
  }

  drawImage(
    x: number, y: number, width: number, height: number,
    imageId: string,
    options?: ImageDrawOptions,
  ): void {
    if (options?.interpolate !== undefined) this.imageInterpolation.set(imageId, options.interpolate)
    if (options?.intent !== undefined) this.imageIntent.set(imageId, options.intent)
    if (options?.alternates !== undefined) {
      const availableAlternates = this.resolveAvailableImageAlternates(options.alternates)
      if (availableAlternates.length > 0) {
        this.registerImageAlternates(imageId, availableAlternates)
      }
    }
    if (options?.opi !== undefined) {
      if (this.pdfxConformance !== undefined) throw new Error(`${this.pdfxConformance} forbids OPI image metadata`)
      validatePdfOpiMetadata(options.opi, `image ${imageId}`)
      this.imageOpi.set(imageId, options.opi)
    }
    if (options?.measure !== undefined) this.imageMeasurements.set(imageId, options.measure)
    if (options?.pointData !== undefined) this.imagePointData.set(imageId, options.pointData)
    let imName = this.imageRefMap.get(imageId)
    if (imName) {
      this.currentPageImages.add(imageId)
      // PDF Image XObject drawing: place with cm, then draw with Do
      // Y-flipped coordinate system: negate the height and offset y to (y+height) to draw upright
      this.pushGraphicsState()
      const cachedStencil = this.stencilColors.get(imageId)
      if (cachedStencil !== undefined) this.pushFillColor(cachedStencil)
      this.currentOps.push(`${pn(width)} 0 0 ${pn(-height)} ${pn(x)} ${pn(y + height)} cm`)
      this.currentOps.push(`${imName} Do`)
      this.popGraphicsState()
      return
    }

    const resolved = resolveImageResource(this.images, imageId)
    const encodedParams = this.encodedImageParams.get(imageId)
    if (encodedParams !== undefined) {
      const data = this.images[imageId]
      if (!(data instanceof Uint8Array)) {
        throw new Error('Encoded image data must be stored as bytes')
      }
      if (encodedParams.inline && !(this.pdfxConformance !== undefined && encodedParams.colorSpace === 'DeviceRGB')) {
        this.pushGraphicsState()
        this.currentOps.push(`${pn(width)} 0 0 ${pn(-height)} ${pn(x)} ${pn(y + height)} cm`)
        this.currentOps.push(buildInlineEncodedImageOp(data, encodedParams))
        this.popGraphicsState()
        return
      }
      imName = `/Im${this.imageCounter++}`
      this.registerEncodedImage(imName, imageId, data, encodedParams)
      this.currentPageImages.add(imageId)
      this.pushGraphicsState()
      this.currentOps.push(`${pn(width)} 0 0 ${pn(-height)} ${pn(x)} ${pn(y + height)} cm`)
      this.currentOps.push(`${imName} Do`)
      this.popGraphicsState()
      return
    }
    const ccittParams = this.ccittImageParams.get(imageId)
    if (ccittParams !== undefined) {
      const data = this.images[imageId]
      if (!(data instanceof Uint8Array)) {
        throw new Error('CCITT image data must be stored as bytes')
      }
      imName = `/Im${this.imageCounter++}`
      this.registerCcittImage(imName, imageId, data, ccittParams)
      this.currentPageImages.add(imageId)
      this.pushGraphicsState()
      this.currentOps.push(`${pn(width)} 0 0 ${pn(-height)} ${pn(x)} ${pn(y + height)} cm`)
      this.currentOps.push(`${imName} Do`)
      this.popGraphicsState()
      return
    }
    if (resolved.kind === 'svg') {
      // SVG images are always drawn as vectors
      const svgDoc = parseSvg(resolved.data)
      renderSvg(svgDoc, this, x, y, width, height)
      return
    }
    if (resolved.kind === 'missing' || resolved.kind === 'unsupported' || resolved.kind === 'external-url') {
      this.drawImagePlaceholder(x, y, width, height)
      return
    }
    if (resolved.kind === 'pdf-passthrough') {
      imName = `/Im${this.imageCounter++}`
      if (resolved.format === 'jpx') {
        this.registerJpxImage(imName, imageId, resolved.data)
      } else {
        this.registerJbig2Image(imName, imageId, resolved.data)
      }
      this.currentPageImages.add(imageId)
      this.pushGraphicsState()
      this.currentOps.push(`${pn(width)} 0 0 ${pn(-height)} ${pn(x)} ${pn(y + height)} cm`)
      this.currentOps.push(`${imName} Do`)
      this.popGraphicsState()
      return
    }
    const data = resolved.data
    const format = resolved.format

    // Only raster images are registered and reused as XObjects
    imName = `/Im${this.imageCounter++}`
    this.imageRefMap.set(imageId, imName)
    if (format === 'jpeg') {
      const info = parseJpegInfo(data)
      if (this.pdfxConformance && info.components === 3) {
        // PDF/X-1a forbids DeviceRGB: decode the JPEG and re-encode as CMYK
        const jpeg = decodeJpegToRgba(data)
        this.registerDecodedImageCmyk(imName, imageId, { width: jpeg.width, height: jpeg.height, pixels: jpeg.rgba })
        this.currentPageImages.add(imageId)
        this.pushGraphicsState()
        this.currentOps.push(`${pn(width)} 0 0 ${pn(-height)} ${pn(x)} ${pn(y + height)} cm`)
        this.currentOps.push(`${imName} Do`)
        this.popGraphicsState()
        return
      }
      const colorSpace = info.components === 1 ? 'DeviceGray'
        : info.components === 4 ? 'DeviceCMYK' : 'DeviceRGB'
      const xobj: ImageXObjectInfo = {
        name: imName,
        imageId,
        data,
        width: info.width,
        height: info.height,
        colorSpace,
        bitsPerComponent: info.bitsPerComponent,
        filter: 'DCTDecode',
      }
      // Adobe CMYK JPEGs (APP14 marker, transform 0/2) store inverted ink
      // values; the inverting /Decode restores them, matching how viewers render
      // them. Plain (non-Adobe) CMYK JPEGs carry ink directly and must not be
      // inverted, so gate on the Adobe marker rather than the component count.
      if (info.components === 4 && info.isAdobeCMYK) {
        xobj.decode = '/Decode [1 0 1 0 1 0 1 0]'
      }
      this.imageXObjects.push(xobj)
    } else {
      this.registerDecodedImage(
        imName,
        imageId,
        this.rasterImageDecoder.decodeRgba(data, format),
      )
    }

    this.currentPageImages.add(imageId)
    this.pushGraphicsState()
    const stencilColor = this.stencilColors.get(imageId)
    if (stencilColor !== undefined) this.pushFillColor(stencilColor)
    this.currentOps.push(`${pn(width)} 0 0 ${pn(-height)} ${pn(x)} ${pn(y + height)} cm`)
    this.currentOps.push(`${imName} Do`)
    this.popGraphicsState()
  }

  private drawImagePlaceholder(x: number, y: number, width: number, height: number): void {
    this.currentOps.push('0.8 0.8 0.8 RG')
    this.currentOps.push('0.5 w')
    this.emittedGraphicsState.strokeColor = undefined
    this.emittedGraphicsState.lineWidth = '0.5'
    this.currentOps.push(`${pn(x)} ${pn(y)} ${pn(width)} ${pn(height)} re S`)
  }

  private ensureImageXObject(imageId: string, usage: string): string {
    const imageName = this.tryEnsureImageXObject(imageId, usage)
    if (imageName === null) throw new Error(`PDF ${usage} is unavailable: ${imageId}`)
    return imageName
  }

  private registerImageAlternates(
    imageId: string,
    alternates: Array<{ imageId: string, defaultForPrinting?: boolean }>,
  ): void {
    const registered = this.imageAlternates.get(imageId)
    if (registered === undefined) {
      this.imageAlternates.set(imageId, alternates)
      return
    }
    if (registered === alternates) return
    if (!sameImageAlternates(registered, alternates)) {
      throw new Error(`PDF image ${imageId} has conflicting alternate definitions`)
    }
  }

  private resolveAvailableImageAlternates(
    alternates: NonNullable<ImageDrawOptions['alternates']>,
  ): Array<{ imageId: string, defaultForPrinting?: boolean }> {
    const cached = this.alternateSelections.get(alternates)
    if (cached !== undefined) return cached
    const available: Array<{ imageId: string, defaultForPrinting?: boolean }> = []
    for (let alternateIndex = 0; alternateIndex < alternates.length; alternateIndex++) {
      const alternate = alternates[alternateIndex]!
      if (this.tryEnsureImageXObject(alternate.imageId, 'alternate image') !== null) available.push(alternate)
    }
    if (this.pdfxConformance !== undefined && available.some(hasDefaultPrintingAlternate)) {
      throw new Error(`${this.pdfxConformance} forbids alternate images selected by default for printing`)
    }
    this.alternateSelections.set(alternates, available)
    return available
  }

  private tryEnsureImageXObject(imageId: string, usage: string): string | null {
    const existing = this.imageRefMap.get(imageId)
    if (existing !== undefined) return existing

    const encodedParams = this.encodedImageParams.get(imageId)
    if (encodedParams !== undefined) {
      const data = this.images[imageId]
      if (!(data instanceof Uint8Array)) {
        throw new Error('Encoded image data must be stored as bytes')
      }
      const imName = `/Im${this.imageCounter++}`
      this.registerEncodedImage(imName, imageId, data, encodedParams)
      return imName
    }

    const ccittParams = this.ccittImageParams.get(imageId)
    if (ccittParams !== undefined) {
      const data = this.images[imageId]
      if (!(data instanceof Uint8Array)) {
        throw new Error('CCITT image data must be stored as bytes')
      }
      const imName = `/Im${this.imageCounter++}`
      this.registerCcittImage(imName, imageId, data, ccittParams)
      return imName
    }

    const resolved = resolveImageResource(this.images, imageId)
    if (resolved.kind === 'missing') return null
    if (resolved.kind === 'svg' || resolved.kind === 'unsupported' || resolved.kind === 'external-url') {
      throw new Error(`PDF ${usage} must contain embedded raster data: ${imageId}`)
    }
    const imName = `/Im${this.imageCounter++}`
    if (resolved.kind === 'pdf-passthrough') {
      if (resolved.format === 'jpx') this.registerJpxImage(imName, imageId, resolved.data)
      else this.registerJbig2Image(imName, imageId, resolved.data)
      return imName
    }

    if (resolved.format === 'jpeg') {
      const info = parseJpegInfo(resolved.data)
      if (this.pdfxConformance && info.components === 3) {
        const jpeg = decodeJpegToRgba(resolved.data)
        this.registerDecodedImageCmyk(imName, imageId, { width: jpeg.width, height: jpeg.height, pixels: jpeg.rgba })
        return imName
      }
      const colorSpace = info.components === 1 ? 'DeviceGray'
        : info.components === 4 ? 'DeviceCMYK' : 'DeviceRGB'
      const xobj: ImageXObjectInfo = {
        name: imName,
        imageId,
        data: resolved.data,
        width: info.width,
        height: info.height,
        colorSpace,
        bitsPerComponent: info.bitsPerComponent,
        filter: 'DCTDecode',
      }
      // Adobe CMYK JPEGs (APP14 marker, transform 0/2) store inverted ink
      // values; the inverting /Decode restores them, matching how viewers render
      // them. Plain (non-Adobe) CMYK JPEGs carry ink directly and must not be
      // inverted, so gate on the Adobe marker rather than the component count.
      if (info.components === 4 && info.isAdobeCMYK) {
        xobj.decode = '/Decode [1 0 1 0 1 0 1 0]'
      }
      this.imageXObjects.push(xobj)
      this.imageRefMap.set(imageId, imName)
      return imName
    }

    this.registerDecodedImage(imName, imageId, this.rasterImageDecoder.decodeRgba(resolved.data, resolved.format))
    this.imageRefMap.set(imageId, imName)
    return imName
  }

  private registerJpxImage(imName: string, imageId: string, data: Uint8Array): void {
    const image = decodeJpx(data)
    if (this.pdfxConformance !== undefined && image.colorChannels.length === 3) {
      this.registerDecodedImageCmyk(imName, imageId, jpxImageToRgba(image))
      return
    }
    const colorSpace = image.colorChannels.length === 1 ? 'DeviceGray'
      : image.colorChannels.length === 3 ? 'DeviceRGB'
        : image.colorChannels.length === 4 && image.alphaChannel === null ? 'DeviceCMYK'
          : null
    if (colorSpace === null) {
      throw new Error(`Unsupported JPX component count: ${image.componentCount}`)
    }
    this.imageXObjects.push({
      name: imName,
      imageId,
      data,
      width: image.width,
      height: image.height,
      colorSpace,
      bitsPerComponent: image.bitDepth,
      filter: 'JPXDecode',
      ...(image.alphaChannel === null ? {} : { smaskInData: image.premultipliedAlpha ? 2 as const : 1 as const }),
    })
    this.imageRefMap.set(imageId, imName)
  }

  private registerJbig2Image(imName: string, imageId: string, data: Uint8Array): void {
    const image = decodeJbig2(data)
    this.imageXObjects.push({
      name: imName,
      imageId,
      data,
      width: image.width,
      height: image.height,
      colorSpace: 'DeviceGray',
      bitsPerComponent: 1,
      filter: 'JBIG2Decode',
    })
    this.imageRefMap.set(imageId, imName)
  }

  private registerCcittImage(imName: string, imageId: string, data: Uint8Array, params: CcittImageParams): void {
    let decodeParms = `/DecodeParms << /K ${params.k} /Columns ${params.columns} /Rows ${params.rows}`
    if (params.blackIs1) decodeParms += ' /BlackIs1 true'
    if (params.encodedByteAlign) decodeParms += ' /EncodedByteAlign true'
    if (params.endOfLine) decodeParms += ' /EndOfLine true'
    decodeParms += ' >>'
    this.imageXObjects.push({
      name: imName,
      imageId,
      data,
      width: params.columns,
      height: params.rows,
      colorSpace: 'DeviceGray',
      bitsPerComponent: 1,
      filter: 'CCITTFaxDecode',
      decodeParms,
    })
    this.imageRefMap.set(imageId, imName)
  }

  private registerEncodedImage(imName: string, imageId: string, data: Uint8Array, params: EncodedImageParams): void {
    if (this.pdfxConformance !== undefined && params.colorSpace === 'DeviceRGB') {
      const decoded = decodeEncodedRgbImage(data, params)
      this.registerDecodedImageCmyk(imName, imageId, decoded, params.intent ?? undefined)
      return
    }
    this.imageXObjects.push({
      name: imName,
      imageId,
      data,
      width: params.columns,
      height: params.rows,
      colorSpace: params.colorSpace,
      bitsPerComponent: params.bitsPerComponent,
      filter: params.filter,
      decodeParms: buildEncodedImageDecodeParms(params),
      mask: params.maskRanges === null ? undefined : `/Mask [${params.maskRanges.join(' ')}]`,
      decode: params.decode === null ? undefined : `/Decode [${params.decode.map(pn).join(' ')}]`,
      intent: params.intent === null ? undefined : `/Intent /${params.intent}`,
      interpolate: params.interpolate === null ? undefined : params.interpolate,
    })
    this.imageRefMap.set(imageId, imName)
  }

  drawSvg(x: number, y: number, width: number, height: number, svgData: string): void {
    const svgDoc = parseSvg(svgData)
    renderSvg(svgDoc, this, x, y, width, height)
  }

  /** Register a decoded RGBA image as a PDF XObject (shared by WebP/AVIF) */
  /**
   * PDF/X-1a raster path: RGB pixels pass through the embedded output profile
   * and the alpha channel is composited over paper white (soft masks are prohibited).
   */
  private registerDecodedImageCmyk(
    imName: string,
    imageId: string,
    decoded: { width: number; height: number; pixels: Uint8Array },
    renderingIntent?: IccRenderingIntent,
  ): void {
    const w = decoded.width
    const h = decoded.height
    const pixels = decoded.pixels
    const rowLen = 1 + w * 4
    const filtered = new Uint8Array(h * rowLen)
    for (let y = 0; y < h; y++) {
      const rowOff = y * rowLen
      filtered[rowOff] = 0  // no PNG predictor for 4-channel data
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4
        const a = pixels[si + 3]! / 255
        // Composite over paper white, then convert through the output profile.
        const r = (pixels[si]! / 255) * a + (1 - a)
        const g = (pixels[si + 1]! / 255) * a + (1 - a)
        const b = (pixels[si + 2]! / 255) * a + (1 - a)
        const transform = this.pdfxColorTransform
        if (transform === undefined) throw new Error('PDF/X output profile transform is not initialized')
        const [c, m, yv, k] = iccOutputCmyk(
          transform,
          renderingIntent ?? this.pdfxOutputProfile?.renderingIntent,
          r,
          g,
          b,
        )
        const di = rowOff + 1 + x * 4
        filtered[di] = Math.round(c * 255)
        filtered[di + 1] = Math.round(m * 255)
        filtered[di + 2] = Math.round(yv * 255)
        filtered[di + 3] = Math.round(k * 255)
      }
    }
    const compressed = zlibDeflate(filtered, 4)
    this.imageXObjects.push({
      name: imName,
      imageId,
      width: w,
      height: h,
      colorSpace: 'DeviceCMYK',
      bitsPerComponent: 8,
      filter: 'FlateDecode',
      data: compressed,
      decodeParms: `/DecodeParms << /Predictor 15 /Colors 4 /BitsPerComponent 8 /Columns ${w} >>`,
    })
    this.imageRefMap.set(imageId, imName)
  }

  private registerDecodedImage(imName: string, imageId: string, decoded: { width: number; height: number; pixels: Uint8Array }): void {
    if (this.pdfxConformance) {
      this.registerDecodedImageCmyk(imName, imageId, decoded)
      return
    }
    const w = decoded.width
    const h = decoded.height
    const pixelCount = w * h
    const pixels = decoded.pixels

    // Stencil detection: binary alpha (0/255) with a single opaque color is
    // exactly the ISO 32000 8.9.6.2 image mask — 1 bit per pixel painted in
    // the current fill color (bit 0 = paint).
    const stencil = buildStencilMaskData(w, h, pixels)
    if (stencil !== null) {
      this.imageXObjects.push({
        name: imName,
        imageId,
        data: stencil.compressed,
        width: w,
        height: h,
        colorSpace: '',
        bitsPerComponent: 1,
        imageMask: true,
        filter: 'FlateDecode',
      })
      this.stencilColors.set(imageId, stencil.color)
      this.imageRefMap.set(imageId, imName)
      return
    }

    // Lossless palettization: images with at most 256 unique colors emit as
    // an Indexed color space at the smallest sufficient bit depth (1/2/4/8),
    // pixel-identical to the RGB form and considerably smaller.
    const indexed = buildIndexedImageData(w, h, pixels)
    if (indexed !== null) {
      const entry: ImageXObjectInfo = {
        name: imName,
        imageId,
        data: indexed.compressed,
        width: w,
        height: h,
        colorSpace: indexed.colorSpace,
        bitsPerComponent: indexed.bitsPerComponent,
        filter: 'FlateDecode',
      }
      if (indexed.hasAlpha) {
        const binaryMask = buildBinaryAlphaMask(w, h, pixels)
        if (binaryMask !== null) {
          entry.maskData = binaryMask.compressed
          entry.maskWidth = w
          entry.maskHeight = h
        } else {
          const alpha = buildAlphaSmask(w, h, pixels)
          entry.smaskData = alpha.compressed
          entry.smaskWidth = w
          entry.smaskHeight = h
          entry.smaskBpc = 8
          entry.smaskDecodeParms = alpha.decodeParms
        }
      }
      this.imageXObjects.push(entry)
      this.imageRefMap.set(imageId, imName)
      return
    }

    // Split RGBA into RGB + Alpha and apply the PNG Sub filter
    // The Sub filter turns adjacent pixels into deltas, giving LZ77 fast, high compression
    const rgbRowLen = 1 + w * 3  // filter byte + pixel data
    const rgbFiltered = new Uint8Array(h * rgbRowLen)
    let hasAlpha = false

    for (let y = 0; y < h; y++) {
      const rowOff = y * rgbRowLen
      rgbFiltered[rowOff] = 1  // filter type = Sub
      const pixRow = y * w
      // First pixel (left=0, so delta = original value)
      if (w > 0) {
        const si = (pixRow) * 4
        rgbFiltered[rowOff + 1] = pixels[si]!
        rgbFiltered[rowOff + 2] = pixels[si + 1]!
        rgbFiltered[rowOff + 3] = pixels[si + 2]!
        const a = pixels[si + 3]!
        if (a !== 255) hasAlpha = true
      }
      // Second and later: current - left
      for (let x = 1; x < w; x++) {
        const si = (pixRow + x) * 4
        const pi = (pixRow + x - 1) * 4
        rgbFiltered[rowOff + 1 + x * 3] = (pixels[si]! - pixels[pi]!) & 0xFF
        rgbFiltered[rowOff + 2 + x * 3] = (pixels[si + 1]! - pixels[pi + 1]!) & 0xFF
        rgbFiltered[rowOff + 3 + x * 3] = (pixels[si + 2]! - pixels[pi + 2]!) & 0xFF
        const a = pixels[si + 3]!
        if (a !== 255) hasAlpha = true
      }
    }

    const rgbCompressed = zlibDeflate(rgbFiltered, 4)
    const decodeParms = `/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${w} >>`

    if (hasAlpha) {
      const entry: ImageXObjectInfo = {
        name: imName,
        imageId,
        data: rgbCompressed,
        width: w,
        height: h,
        colorSpace: 'DeviceRGB',
        bitsPerComponent: 8,
        filter: 'FlateDecode',
        decodeParms,
      }
      const binaryMask = buildBinaryAlphaMask(w, h, pixels)
      if (binaryMask !== null) {
        entry.maskData = binaryMask.compressed
        entry.maskWidth = w
        entry.maskHeight = h
      } else {
        const alpha = buildAlphaSmask(w, h, pixels)
        entry.smaskData = alpha.compressed
        entry.smaskWidth = w
        entry.smaskHeight = h
        entry.smaskBpc = 8
        entry.smaskDecodeParms = alpha.decodeParms
      }
      this.imageXObjects.push(entry)
    } else {
      this.imageXObjects.push({
        name: imName,
        imageId,
        data: rgbCompressed,
        width: w,
        height: h,
        colorSpace: 'DeviceRGB',
        bitsPerComponent: 8,
        filter: 'FlateDecode',
        decodeParms,
      })
    }
  }

  drawImageData(
    x: number, y: number, width: number, height: number,
    data: Uint8Array,
    mimeType?: string,
  ): void {
    const format = detectImageFormat(data)
    const ccittParams = parseCcittMimeParams(mimeType)
    const encodedParams = parseEncodedImageMimeParams(mimeType)
    const ext = mimeType && mimeType.includes('/') ? mimeType.split('/')[1]! : format
    const imageId = `__svg_data_${hashBytesFNV1a(data)}_${ext}`
    if (!this.images[imageId]) {
      this.images[imageId] = data
    }
    if (ccittParams !== null) this.ccittImageParams.set(imageId, ccittParams)
    if (encodedParams !== null) this.encodedImageParams.set(imageId, encodedParams)
    this.drawImage(x, y, width, height, imageId)
  }

  drawImageAffine(
    a: number, b: number, c: number, d: number, e: number, f: number,
    imageId: string,
    options?: ImageDrawOptions,
  ): void {
    const t = imageAffineToYDown(a, b, c, d, e, f)
    this.pushGraphicsState()
    this.currentOps.push(`${pn(t.a)} ${pn(t.b)} ${pn(t.c)} ${pn(t.d)} ${pn(t.e)} ${pn(t.f)} cm`)
    this.drawImage(0, 0, 1, 1, imageId, options)
    this.popGraphicsState()
  }

  drawImageDataAffine(
    a: number, b: number, c: number, d: number, e: number, f: number,
    data: Uint8Array,
    mimeType?: string,
  ): void {
    const format = detectImageFormat(data)
    const ccittParams = parseCcittMimeParams(mimeType)
    const encodedParams = parseEncodedImageMimeParams(mimeType)
    const ext = mimeType && mimeType.includes('/') ? mimeType.split('/')[1]! : format
    const imageId = `__svg_data_${hashBytesFNV1a(data)}_${ext}`
    if (!this.images[imageId]) {
      this.images[imageId] = data
    }
    if (ccittParams !== null) this.ccittImageParams.set(imageId, ccittParams)
    if (encodedParams !== null) this.encodedImageParams.set(imageId, encodedParams)
    this.drawImageAffine(a, b, c, d, e, f, imageId)
  }

  // ─── Annotations/bookmarks/anchors ───

  addAnnotation(pageIndex: number, annotation: LinkAnnotation): void {
    if (this.pdfxConformance) {
      throw new Error(`${this.pdfxConformance} forbids link annotations`)
    }
    let list = this.pageAnnotations.get(pageIndex)
    if (!list) {
      list = []
      this.pageAnnotations.set(pageIndex, list)
    }
    list.push(annotation)
    // Tagged PDF: a Link annotation inside an open Link structure element is
    // integrated into the structure tree via an OBJR (ISO 32000 §14.7.4.4).
    let structElem = -1
    if (this.tagged && this.structStack.length > 0) {
      const top = this.structStack[this.structStack.length - 1]!
      const role = this.structElements[top]!.role
      if (resolvePdfStructureRole(role, this.roleMap) === 'Link') structElem = top
    }
    let seList = this.annotationStructElems.get(pageIndex)
    if (seList === undefined) {
      seList = []
      this.annotationStructElems.set(pageIndex, seList)
    }
    seList.push(structElem)
  }

  drawFormField(x: number, y: number, width: number, height: number, field: RenderFormField): void {
    // Build the initial appearance in an isolated op buffer (the same
    // serialization machinery as page content, so embedded fonts work).
    // Toggle fields (checkbox/radio) carry both an on- and off-state stream;
    // /AS then selects which shows.
    this.ensureFontRef(field.fontId)
    const isToggle = field.fieldType === 'checkbox' || field.fieldType === 'radio'
    const onOps = this.buildFieldAppearance(width, height, field, true)
    const offOps = isToggle ? this.buildFieldAppearance(width, height, field, false) : null
    this.formFieldDefs.push({
      pageIndex: this.pageDataList.length,
      x, y, width, height, field, onOps, offOps,
    })
  }

  private buildFieldAppearance(width: number, height: number, field: RenderFormField, active: boolean): PdfOp[] {
    const saved = this.currentOps
    const ops: PdfOp[] = []
    this.currentOps = ops
    this.resetEmittedGraphicsState()
    // Top-down convention inside the BBox, matching the page ops
    this.currentOps.push(`1 0 0 -1 0 ${pn(height)} cm`)
    this.paintFormFieldAppearance(0, 0, width, height, field, active)
    this.currentOps = saved
    this.resetEmittedGraphicsState()
    return ops
  }

  /** Shared appearance painter (identical logic across all backends). */
  private paintFormFieldAppearance(x: number, y: number, width: number, height: number, field: RenderFormField, active: boolean): void {
    paintFormFieldAppearance(this, x, y, width, height, field, active)
  }

  beginContentGroup(): void {
    this.resetEmittedGraphicsState()
    this.currentOps.push({ type: 'groupStart' })
  }

  endContentGroup(): void {
    this.currentOps.push({ type: 'groupEnd' })
    this.resetEmittedGraphicsState()
  }

  beginPdfForm(form: PdfFormXObjectDef): void {
    if (this.pdfxConformance !== undefined) {
      if (form.opi !== undefined) throw new Error(`${this.pdfxConformance} forbids OPI Form XObjects`)
      if (form.reference !== undefined) throw new Error(`${this.pdfxConformance} forbids reference Form XObjects`)
    }
    this.opsStack.push(this.currentOps)
    this.currentOps = []
    this.resetEmittedGraphicsState()
    this.importedFormStack.push({
      form, ctm: this.ctm, ctmStack: this.ctmStack,
      semanticId: this.importedFormSemanticCounter++, mcidCounter: 0,
    })
    const b = form.bbox
    this.ctm = [1, 0, 0, -1, b[0], b[3]]
    this.ctmStack = []
  }

  endPdfForm(): void {
    const frame = this.importedFormStack.pop()
    if (frame === undefined) throw new Error('endPdfForm without a matching beginPdfForm')
    const ops = this.currentOps
    this.currentOps = this.opsStack.pop()!
    this.resetEmittedGraphicsState()
    this.ctm = frame.ctm
    this.ctmStack = frame.ctmStack
    const formIndex = this.importedFormDefs.length
    this.importedFormDefs.push({ form: frame.form, ops, semanticId: frame.semanticId })
    this.currentOps.push({ type: 'formInvoke', formIndex })
  }

  beginSoftMask(type: 'luminosity' | 'alpha', width: number, height: number, backdrop?: [number, number, number], transferFunction?: 'Identity' | RenderTransferFunction, x = 0, y = 0, colorSpace?: PdfProcessColorSpaceDef, isolated?: boolean, knockout?: boolean): void {
    if (this.pdfaConformance === 'PDF/A-1b' || this.pdfxConformance === 'PDF/X-1a') {
      throw new Error(`${this.pdfaConformance ?? this.pdfxConformance} forbids soft masks`)
    }
    this.opsStack.push(this.currentOps)
    this.currentOps = []
    this.resetEmittedGraphicsState()
    this.capturingSoftMask = {
      maskType: type === 'luminosity' ? 'Luminosity' : 'Alpha',
      width, height, x, y, colorSpace, isolated, knockout, backdrop, transfer: transferFunction,
    }
  }

  endSoftMask(): void {
    const cap = this.capturingSoftMask
    if (cap === null) throw new Error('endSoftMask without a matching beginSoftMask')
    const ops = this.currentOps
    this.currentOps = this.opsStack.pop()!
    this.resetEmittedGraphicsState()
    this.capturingSoftMask = null
    const defIndex = this.transparencyGroupDefs.length
    this.transparencyGroupDefs.push({
      ops,
      x: cap.x,
      y: cap.y,
      width: cap.width,
      height: cap.height,
      colorSpace: cap.colorSpace,
      isolated: cap.isolated ?? true,
      knockout: cap.knockout ?? false,
    })
    this.pendingSoftMask = { defIndex, maskType: cap.maskType, backdrop: cap.backdrop, transfer: cap.transfer }
  }

  beginTransparencyGroup(width: number, height: number, options: TransparencyGroupOptions): void {
    const transparencyForbidden = this.pdfaConformance === 'PDF/A-1b' || this.pdfxConformance === 'PDF/X-1a'
    if (transparencyForbidden && ((options.opacity ?? 1) < 1 || options.isolated || options.knockout || options.hasSoftMask)) {
      throw new Error(`${this.pdfaConformance ?? this.pdfxConformance} forbids transparency groups`)
    }
    const flatten = transparencyForbidden
    this.opsStack.push(this.currentOps)
    this.currentOps = []
    this.resetEmittedGraphicsState()
    this.transparencyGroupStack.push({
      width, height, x: options.x ?? 0, y: options.y ?? 0,
      isolated: options.isolated,
      knockout: options.knockout,
      opacity: options.opacity,
      softMask: options.hasSoftMask ? this.pendingSoftMask : null,
      flatten,
    })
    this.pendingSoftMask = null
  }

  endTransparencyGroup(): void {
    const frame = this.transparencyGroupStack.pop()
    if (frame === undefined) throw new Error('endTransparencyGroup without a matching beginTransparencyGroup')
    const ops = this.currentOps
    this.currentOps = this.opsStack.pop()!
    this.resetEmittedGraphicsState()
    if (frame.flatten) {
      for (let i = 0; i < ops.length; i++) this.currentOps.push(ops[i]!)
      return
    }
    const defIndex = this.transparencyGroupDefs.length
    this.transparencyGroupDefs.push({ ops, x: frame.x, y: frame.y, width: frame.width, height: frame.height, isolated: frame.isolated, knockout: frame.knockout })
    this.currentOps.push({
      type: 'transparencyInvoke',
      groupIndex: defIndex,
      opacity: frame.opacity,
      softMaskIndex: frame.softMask ? frame.softMask.defIndex : -1,
      softMaskType: frame.softMask ? frame.softMask.maskType : undefined,
      softMaskBackdrop: frame.softMask ? frame.softMask.backdrop : undefined,
      softMaskTransfer: frame.softMask ? frame.softMask.transfer : undefined,
    })
  }

  setBookmarks(bookmarks: BookmarkEntry[]): void {
    this.bookmarkEntries = bookmarks
  }

  setAnchors(anchors: AnchorEntry[]): void {
    this.anchorEntries = anchors
  }

  setImages(images: Record<string, string | Uint8Array>): void {
    this.imageResources.setDocumentImages(images)
    this.alternateSelections = new WeakMap()
  }

  private get images(): Record<string, string | Uint8Array> {
    return this.imageResources.images
  }

  // ─── Tagged PDF ───

  setTagged(
    lang?: string,
    roleMap?: Record<string, string>,
    namespaces?: StructureNamespace[],
    pronunciationLexiconFileIndexes?: number[],
  ): void {
    this.tagged = true
    if (lang !== undefined) validateBcp47LanguageTag(lang, 'PDF document language')
    this.documentLang = lang
    if (roleMap) {
      validatePdfStructureRoleMap(roleMap)
      this.roleMap = roleMap
    }
    if (namespaces && namespaces.length > 0) {
      const normalized = namespaces.map(function (namespace): StructureNamespaceDefinition {
        return typeof namespace === 'string' ? { uri: namespace } : namespace
      })
      const unique = new Set(normalized.map(function (namespace) { return namespace.uri }))
      if (unique.size !== normalized.length || normalized.some(function (namespace) { return namespace.uri === '' })) {
        throw new Error('PDF structure namespace URIs must be non-empty and unique')
      }
      validatePdfStructureNamespaces(normalized)
      this.structureNamespaces = normalized
    }
    if (pronunciationLexiconFileIndexes !== undefined) {
      if (pronunciationLexiconFileIndexes.length === 0
        || new Set(pronunciationLexiconFileIndexes).size !== pronunciationLexiconFileIndexes.length
        || pronunciationLexiconFileIndexes.some(function (index) { return !Number.isInteger(index) || index < 0 })) {
        throw new Error('PDF pronunciation lexicon file indexes must be non-empty, unique non-negative integers')
      }
      this.pronunciationLexiconFileIndexes = pronunciationLexiconFileIndexes.slice()
    }
  }

  private ensureStructureNamespace(uri: string): number {
    if (this.structureNamespaces === undefined) this.structureNamespaces = []
    for (let i = 0; i < this.structureNamespaces.length; i++) {
      if (this.structureNamespaces[i]!.uri === uri) return i
    }
    this.structureNamespaces.push({ uri })
    return this.structureNamespaces.length - 1
  }

  beginTaggedContent(tag: StructureTag): void {
    if (!this.tagged) return
    if (tag.lang !== undefined) validateBcp47LanguageTag(tag.lang, 'PDF structure language')
    validateArtifactTag(tag)
    validatePdfStructureTagAttributes(tag)
    if (tag.artifactStructureElement === true && tag.role !== 'Artifact') {
      throw new Error('PDF artifactStructureElement requires the Artifact role')
    }
    if (tag.role === 'Artifact' && tag.artifactStructureElement !== true) {
      const artifactEntries: string[] = []
      if (tag.artifactType) artifactEntries.push(`/Type /${tag.artifactType}`)
      if (tag.artifactSubtype) artifactEntries.push(`/Subtype /${tag.artifactSubtype}`)
      if (tag.artifactBBox) artifactEntries.push(`/BBox ${pdfPageBoxString(tag.artifactBBox)}`)
      if (tag.artifactAttached) artifactEntries.push(`/Attached [${tag.artifactAttached.map(encodePdfName).join(' ')}]`)
      if (tag.actualText !== undefined) artifactEntries.push(`/ActualText (${pdfEscapeString(tag.actualText)})`)
      if (tag.lang !== undefined) artifactEntries.push(`/Lang (${pdfEscapeString(tag.lang)})`)
      if (artifactEntries.length > 0) this.currentOps.push(`/Artifact << ${artifactEntries.join(' ')} >> BDC`)
      else this.currentOps.push('/Artifact BMC')
      this.taggedContentStack.push({ structElementIndex: null, markedContent: true })
      return
    }
    const pageIndex = this.pageDataList.length  // current page (before endPage)
    let namespaceIndex = tag.namespaceIndex
    if (namespaceIndex === undefined && isPdf20OnlyStructureRole(tag.role)) {
      namespaceIndex = this.ensureStructureNamespace(PDF_20_STRUCTURE_NAMESPACE)
    }
    if (namespaceIndex !== undefined && (
      !Number.isInteger(namespaceIndex) || namespaceIndex < 0
      || this.structureNamespaces === undefined || namespaceIndex >= this.structureNamespaces.length
    )) throw new Error(`PDF structure namespace index out of range: ${namespaceIndex}`)
    if (!isDefaultStructureRole(tag.role) && namespaceIndex === undefined && this.roleMap?.[tag.role] === undefined) {
      throw new Error(`PDF custom structure role requires a RoleMap or namespace: ${tag.role}`)
    }
    validateStructureRoleForNamespace(tag.role, namespaceIndex, this.structureNamespaces)
    const attributes = tag.attributes ?? []
    for (let i = 0; i < attributes.length; i++) {
      const attributeNamespace = attributes[i]!.namespaceIndex
      if (attributeNamespace !== undefined && (
        !Number.isInteger(attributeNamespace) || attributeNamespace < 0
        || this.structureNamespaces === undefined || attributeNamespace >= this.structureNamespaces.length
      )) throw new Error(`PDF structure attribute namespace index out of range: ${attributeNamespace}`)
    }

    // Create the structure element
    const elemIndex = this.structElements.length
    const parentIndex = this.structStack.length > 0 ? this.structStack[this.structStack.length - 1]! : -1

    const elem: StructElement = {
      role: tag.role,
      parentIndex,
      childIndices: [],
      mcids: [],
      alt: tag.alt,
      actualText: tag.actualText,
      expandedText: tag.expandedText,
      phoneme: tag.phoneme,
      phoneticAlphabet: tag.phoneticAlphabet,
      lang: tag.lang,
      scope: tag.scope,
      rowSpan: tag.rowSpan,
      colSpan: tag.colSpan,
      headers: tag.headers,
      layout: tag.layout,
      listNumbering: tag.listNumbering,
      id: tag.id,
      title: tag.title,
      revision: tag.revision,
      attributes: tag.attributes,
      userProperties: tag.userProperties,
      userPropertiesRevision: tag.userPropertiesRevision,
      summary: tag.summary,
      namespaceIndex,
      artifactType: tag.artifactType,
      artifactSubtype: tag.artifactSubtype,
      artifactBBox: tag.artifactBBox,
      artifactAttached: tag.artifactAttached,
      associatedFileIndexes: tag.associatedFileIndexes,
      printField: tag.printField,
    }
    this.structElements.push(elem)

    // Register the child with its parent
    if (parentIndex >= 0) {
      this.structElements[parentIndex]!.childIndices.push(elemIndex)
    }
    if (tag.mathml !== undefined) {
      if (tag.role !== 'Formula') throw new Error('MathML structure is only valid on a Formula element')
      const mathmlUri = 'http://www.w3.org/1998/Math/MathML'
      const mathmlNamespaceIndex = this.ensureStructureNamespace(mathmlUri)
      appendMathMlStructElements(this.structElements, elemIndex, tag.mathml, mathmlNamespaceIndex)
    }

    // Container roles (Document, Part, Sect, Div, Table, TR, THead, TBody, TFoot, L, LI, TOC, TOCI, BlockQuote)
    // -> no BDC in the content stream, structure tree only. A custom role is
    // classified by the standard role it maps to via /RoleMap.
    const effectiveRole = resolvePdfStructureRoleAcrossNamespaces(tag.role, namespaceIndex, this.roleMap, this.structureNamespaces)
    let markedContent = false
    if (!isContainerRole(effectiveRole)) {
      // Content role -> assign MCID + BDC/EMC
      const formFrame = this.importedFormStack[this.importedFormStack.length - 1]
      const mcid = formFrame === undefined ? this.mcidCounter++ : formFrame.mcidCounter++
      elem.mcids.push({ pageIndex, mcid, ...(formFrame === undefined ? {} : { formSemanticId: formFrame.semanticId }) })

      if (formFrame === undefined) {
        // Extend the pageMcidToStructElem table
        while (this.pageMcidToStructElem.length <= pageIndex) {
          this.pageMcidToStructElem.push([])
        }
        this.pageMcidToStructElem[pageIndex]![mcid] = elemIndex
      }

      const propStr = taggedPropertyList(mcid, tag)
      this.currentOps.push(`/${tag.role} ${propStr} BDC`)
      markedContent = true
    }

    this.structStack.push(elemIndex)
    this.taggedContentStack.push({ structElementIndex: elemIndex, markedContent })
  }

  endTaggedContent(): void {
    if (!this.tagged) return
    const frame = this.taggedContentStack.pop()
    if (frame === undefined) throw new Error('endTaggedContent without a matching beginTaggedContent')
    if (frame.structElementIndex !== null) {
      const elemIndex = this.structStack.pop()
      if (elemIndex !== frame.structElementIndex) throw new Error('Tagged PDF structure stack is inconsistent')
    }
    if (frame.markedContent) this.currentOps.push('EMC')
  }

  beginOptionalContent(group: RenderOptionalContent): void {
    const name = this.ensureOptionalContentGroup(group)
    this.currentOps.push(`/OC ${name} BDC`)
  }

  endOptionalContent(): void {
    this.currentOps.push('EMC')
  }

  // ─── PDF output ───

  /** Get the finished PDF binary */
  toUint8Array(): Uint8Array {
    const pdfa = this.pdfaConformance

    // PDF/A + encryption is not allowed
    if (pdfa && this.encryptionOptions) {
      throw new Error('PDF/A conformance does not allow encryption')
    }
    if (this.pdfxConformance && this.encryptionOptions) {
      throw new Error('PDF/X conformance does not allow encryption')
    }
    if (pdfa) validatePdfAEmbeddedFiles(pdfa, this.embeddedFiles)
    if (pdfa && this.javaScript.length > 0) {
      throw new Error('PDF/A conformance does not allow JavaScript actions')
    }
    if (pdfa === 'PDF/A-1b' && this.collection !== undefined) {
      throw new Error('PDF/A conformance does not allow collection dictionaries')
    }
    if (pdfa) {
      validatePdfAAnnotationInputs(pdfa, this.annotations)
      validatePdfAFormFieldInputs(pdfa, this.formFieldDefs)
    }
    if ((this.pdfaConformance === 'PDF/A-1b' || this.pdfxConformance) && (this.optionalContentDefs.length > 0 || this.configuredOptionalContentProperties !== undefined)) {
      throw new Error('PDF 1.4 conformance does not allow optional content groups')
    }
    // PDF/A prohibits transfer functions. PDF/X additionally constrains the
    // black-generation and undercolor-removal functions used for production.
    if (pdfa || this.pdfxConformance) {
      for (let gsi = 0; gsi < this.gsValues.length; gsi++) {
        const dp = this.gsValues[gsi]!.deviceParams
        if (dp === undefined) continue
        const label = pdfa ?? this.pdfxConformance
        if (dp.transferFunction !== undefined && dp.transferFunction !== 'Default') {
          throw new Error(`${label} conformance forbids ExtGState transfer functions (/TR)`)
        }
        if (this.pdfxConformance && dp.blackGeneration !== undefined && dp.blackGeneration !== 'Default') {
          throw new Error(`${label} conformance forbids ExtGState black-generation functions (/BG)`)
        }
        if (this.pdfxConformance && dp.undercolorRemoval !== undefined && dp.undercolorRemoval !== 'Default') {
          throw new Error(`${label} conformance forbids ExtGState undercolor-removal functions (/UCR)`)
        }
      }
    }

    // Create the encryption context (if needed)
    if (this.encryptionOptions) {
      this.encryptCtx = createEncryptionContext(this.encryptionOptions)
    } else if (this.publicKeyEncryptionOptions) {
      this.encryptCtx = createPubSecEncryptionContext(this.publicKeyEncryptionOptions)
    }
    const enc = this.encryptCtx
    if (this.identityCryptFilter !== undefined) {
      if (enc === null) throw new Error('PDF Identity crypt-filter routing requires encryption')
      const supportsCryptFilters = enc.encryptDict.includes('/V 4') || enc.encryptDict.includes('/V 5')
      if (!supportsCryptFilters) throw new Error('PDF Identity crypt-filter routing requires a V4 or V5 encryption handler')
    }
    const identityEmbeddedFiles = new Set(this.identityCryptFilter?.embeddedFiles ?? [])
    for (const name of identityEmbeddedFiles) {
      if (!this.embeddedFiles.some(function (file) { return file.name === name })) {
        throw new Error(`PDF Identity crypt-filter routing references unknown embedded file ${name}`)
      }
    }
    const identityEmbeddedFilesViaEff = enc !== null
      && this.embeddedFiles.length > 0
      && this.embeddedFiles.every(function (file) { return identityEmbeddedFiles.has(file.name) })
    if (identityEmbeddedFilesViaEff) {
      const eff = enc.encryptDict.findIndex(function (entry) { return entry.startsWith('/EFF ') })
      if (eff < 0) throw new Error('PDF encryption handler does not expose an embedded-file crypt filter')
      enc.encryptDict[eff] = '/EFF /Identity'
    }

    const w = new PdfWriter()
    const alloc = () => w.allocId()

    // Header: conformance profiles pin 1.4. PDF 2.0-only structures promote
    // the document automatically; an explicit higher encryption version also
    // participates in the selection.
    const pdfx = this.pdfxConformance
    if ((pdfa !== undefined || pdfx !== undefined) && this.requiresPdf20()) {
      throw new Error('PDF conformance error: the selected PDF/A or PDF/X profile cannot contain PDF 2.0-only features')
    }
    const extensionVersion = requiredPdfVersionForExtensions(this.catalogModel?.extensions)
    if ((pdfa === 'PDF/A-1b' || pdfx) && Number(extensionVersion) > 1.4) {
      throw new Error('PDF conformance error: developer extension BaseVersion exceeds the profile PDF version')
    }
    const pdfVersion = pdfa === 'PDF/A-1b' || pdfx
      ? '1.4'
      : maxPdfVersion(
          this.requestedPdfVersion ?? '1.7',
          enc?.pdfVersion ?? '1.4',
          extensionVersion,
          this.requiresPdf20() ? '2.0' : (this.optionalContentDefs.length > 0 || this.configuredOptionalContentProperties !== undefined) ? '1.5' : '1.4',
        )
    w.writeHeader(pdfVersion)

    // Reserve object IDs up front
    const catalogId = alloc()
    const pagesId = alloc()
    const encryptId = enc ? alloc() : 0
    const pageIds: number[] = []
    for (let pi = 0; pi < this.pageDataList.length; pi++) pageIds.push(alloc())
    const structTreeRootId = this.tagged && this.structElements.length > 0 ? alloc() : 0
    const structElemIds: number[] = []
    for (let si = 0; si < this.structElements.length; si++) structElemIds.push(alloc())
    let nextStructureParentKey = this.pageDataList.length
    let actionAnnotationIds: number[] = []
    let actionOptionalGroupObjects = new Map<string, number>()
    let actionDocumentPartIds: number[] = []
    let actionRichMediaInstanceIds = new Map<number, number[]>()
    let actionArticleThreadIds: number[] = []
    let actionArticleBeadIds: number[][] = []
    const actionAnnotationSubtypes = this.annotations.map(function (annotation) { return annotation.subtype })

    // Encryption-aware stream writing helper
    // PDF spec: filters are applied in reverse order, encryption is the implicit final filter -> encrypt after compression
    const writeStream = (objId: number, data: Uint8Array, extraDict?: string): void => {
      let streamData = data
      let filterStr = ''
      const identityCrypt = extraDict?.includes(IDENTITY_CRYPT_MARKER) === true
      const identityEff = extraDict?.includes(IDENTITY_EFF_MARKER) === true
      if (identityCrypt) extraDict = extraDict!.replace(IDENTITY_CRYPT_MARKER, '')
      if (identityEff) extraDict = extraDict!.replace(IDENTITY_EFF_MARKER, '')
      // Skip if extraDict already contains /Filter (image XObjects etc.)
      const hasFilter = !!extraDict && extraDict.indexOf('/Filter') >= 0
      if (!hasFilter) {
        const compressed = zlibDeflate(data)
        if (compressed.length < data.length) {
          streamData = compressed
          filterStr = identityCrypt
            ? '/Filter [/Crypt /FlateDecode] /DecodeParms [<< /Name /Identity >> null] '
            : '/Filter /FlateDecode '
        }
      }
      if (identityCrypt && filterStr === '') filterStr = '/Filter /Crypt /DecodeParms << /Name /Identity >> '
      const encrypted = enc && !identityCrypt && !identityEff ? enc.encryptStream(objId, 0, streamData) : streamData
      const dict = extraDict
        ? `<< /Length ${encrypted.length} ${filterStr}${extraDict}>>`
        : `<< /Length ${encrypted.length} ${filterStr}>>`
      w.writeStreamObj(dict, encrypted)
    }

    const rawPdfValuePdf = (value: PdfRawValueDef): string => {
      if (value === null) return 'null'
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (typeof value === 'number') return pn(value)
      if (value.kind === 'name') return encodePdfName(value.value)
      if (value.kind === 'string') return `<${bytesToHex(value.bytes)}>`
      if (value.kind === 'array') return `[${value.items.map(rawPdfValuePdf).join(' ')}]`
      if (value.kind === 'dictionary') return rawPdfDictionaryPdf(value.entries)
      const id = alloc()
      const entries = rawPdfDictionaryEntries(value.entries, true)
      w.beginObj(id)
      writeStream(id, value.data, entries.length === 0 ? undefined : entries + ' ')
      w.endObj()
      return `${id} 0 R`
    }
    const rawPdfDictionaryEntries = (entries: Record<string, PdfRawValueDef>, skipLength = false): string => {
      const parts: string[] = []
      for (const key of Object.keys(entries)) {
        if (skipLength && key === 'Length') continue
        parts.push(`${encodePdfName(key)} ${rawPdfValuePdf(entries[key]!)}`)
      }
      return parts.join(' ')
    }
    const rawPdfDictionaryPdf = (entries: Record<string, PdfRawValueDef>): string => `<< ${rawPdfDictionaryEntries(entries)} >>`
    const separationInfoByPage = buildPdfSeparationInfoByPage(this.pageDataList)
    const webCaptureState = validatePdfWebCapture(this.catalogModel?.spiderInfo, this.pageDataList.length)
    validatePdfDocumentRequirements(this.catalogModel?.requirements, this.javaScript)
    const validateActionEntries = function (action: PdfActionDef): void {
      const subtype = action.subtype
      const value = function (key: string): PdfRawValueDef | undefined { return action.entries[key] }
      const fileSpecification = function (key: string): void {
        const entry = value(key)
        if (entry === undefined || entry === null || typeof entry === 'boolean' || typeof entry === 'number'
          || (entry.kind !== 'string' && entry.kind !== 'dictionary')) {
          throw new Error(`PDF ${subtype} action ${key} must be a file specification`)
        }
      }
      if (subtype === 'GoToR' || subtype === 'SubmitForm' || subtype === 'ImportData') fileSpecification('F')
      if (subtype === 'GoToE' && value('F') === undefined && action.embeddedTarget === undefined) {
        throw new Error('PDF GoToE action requires embeddedTarget when F is absent')
      }
      if (subtype === 'Launch') {
        if (value('F') === undefined && action.launchParameters === undefined) {
          throw new Error('PDF Launch action requires F when no platform dictionary is present')
        }
        if (value('F') !== undefined) fileSpecification('F')
      }
      if (subtype === 'Thread') {
        const destination = value('D')
        if (action.articleTarget === undefined && (destination === undefined || destination === null || typeof destination === 'boolean'
          || (typeof destination === 'number' && !Number.isInteger(destination))
          || (typeof destination !== 'number' && destination.kind !== 'string' && destination.kind !== 'dictionary'))) {
          throw new Error('PDF Thread action requires a thread dictionary, integer, or text string D')
        }
        const bead = value('B')
        if (bead !== undefined && (bead === null || typeof bead === 'boolean'
          || (typeof bead === 'number' && !Number.isInteger(bead))
          || (typeof bead !== 'number' && bead.kind !== 'dictionary'))) {
          throw new Error('PDF Thread action B must be a bead dictionary or integer')
        }
      }
      const uri = value('URI')
      if (subtype === 'URI' && (uri === undefined || uri === null || typeof uri !== 'object' || uri.kind !== 'string')) {
        throw new Error('PDF URI action requires a string URI')
      }
      const sound = value('Sound')
      if (subtype === 'Sound' && (sound === undefined || sound === null || typeof sound !== 'object' || sound.kind !== 'stream')) {
        throw new Error('PDF Sound action requires a Sound stream')
      }
      if (subtype === 'Movie') {
        const hasAnnotation = action.annotationTarget !== undefined
        const title = value('T')
        const hasTitle = title !== undefined && title !== null && typeof title === 'object' && title.kind === 'string'
        if (hasAnnotation === hasTitle) throw new Error('PDF Movie action requires exactly one of annotationTarget or string T')
      }
      const namedAction = value('N')
      if (subtype === 'Named' && (namedAction === undefined || namedAction === null || typeof namedAction !== 'object' || namedAction.kind !== 'name')) {
        throw new Error('PDF Named action requires a name N')
      }
      if (subtype === 'JavaScript') {
        const script = value('JS')
        if (script === undefined || script === null || typeof script !== 'object' || (script.kind !== 'string' && script.kind !== 'stream')) {
          throw new Error('PDF JavaScript action requires a string or stream JS')
        }
      }
      if (subtype === 'Rendition') {
        const operation = value('OP')
        const script = value('JS')
        if (operation === undefined && (script === undefined || script === null || typeof script !== 'object' || (script.kind !== 'string' && script.kind !== 'stream'))) {
          throw new Error('PDF Rendition action requires OP or string/stream JS')
        }
        if (operation !== undefined && (typeof operation !== 'number' || !Number.isInteger(operation) || operation < 0 || operation > 4)) {
          throw new Error('PDF Rendition action OP must be an integer from 0 through 4')
        }
        const rendition = value('R')
        if ((operation === 0 || operation === 4) && (rendition === undefined || rendition === null || typeof rendition !== 'object' || rendition.kind !== 'dictionary')) {
          throw new Error(`PDF Rendition action R is required for operation ${operation}`)
        }
        if (typeof operation === 'number' && action.annotationTarget === undefined) {
          throw new Error(`PDF Rendition action annotationTarget is required for operation ${operation}`)
        }
      }
      const transition = value('Trans')
      if (subtype === 'Trans' && (transition === undefined || transition === null || typeof transition !== 'object' || transition.kind !== 'dictionary')) {
        throw new Error('PDF Trans action requires a Trans dictionary')
      }
      if (subtype === 'GoTo3DView') {
        const view = value('V')
        if (view === undefined || view === null || typeof view === 'boolean'
          || (typeof view === 'number' && !Number.isInteger(view))
          || (typeof view !== 'number' && view.kind !== 'dictionary' && view.kind !== 'name' && view.kind !== 'string')) {
          throw new Error('PDF GoTo3DView action requires a view dictionary, integer, string, or name V')
        }
      }
      if (subtype === 'RichMediaExecute') {
        const command = value('CMD')
        const commandName = command !== undefined && command !== null && typeof command === 'object' && command.kind === 'dictionary'
          ? command.entries.C : undefined
        if (commandName === undefined || commandName === null || typeof commandName !== 'object' || commandName.kind !== 'string') {
          throw new Error('PDF RichMediaExecute action requires a CMD dictionary with command string C')
        }
      }
    }
    const pdfActionPdf = function (action: PdfActionDef, path = new Set<PdfActionDef>()): string {
      if (path.has(action)) throw new Error('PDF action Next chain must not be circular')
      path.add(action)
      validateActionEntries(action)
      const entries = [`/Type /Action`, `/S /${action.subtype}`]
      const destinationAction = action.subtype === 'GoTo' || action.subtype === 'GoToR' || action.subtype === 'GoToE'
      if (destinationAction) {
        if (action.destination === undefined) throw new Error(`PDF ${action.subtype} action requires a destination`)
        if (action.subtype === 'GoTo' && action.destination.kind === 'explicit' && action.destination.page.kind !== 'local') {
          throw new Error('PDF GoTo action requires a local destination')
        }
        if ((action.subtype === 'GoToR' || action.subtype === 'GoToE') && action.destination.kind === 'explicit' && action.destination.page.kind !== 'remote') {
          throw new Error(`PDF ${action.subtype} action requires a remote destination`)
        }
        entries.push(`/D ${buildPdfDestination(action.destination, pageIds)}`)
      } else if (action.destination !== undefined) {
        throw new Error(`PDF ${action.subtype} action must not define a destination property`)
      }
      if (action.structureDestination !== undefined) {
        if (action.subtype !== 'GoTo' && action.subtype !== 'GoToR') {
          throw new Error(`PDF ${action.subtype} action must not define a structure destination`)
        }
        const expectedScope = action.subtype === 'GoTo' ? 'local' : 'remote'
        if (action.structureDestination.target.kind !== expectedScope) {
          throw new Error(`PDF ${action.subtype} action has an invalid structure destination scope`)
        }
        entries.push(`/SD ${buildPdfStructureDestination(action.structureDestination, structElemIds)}`)
      }
      const expectedTargetEntry = action.subtype === 'Movie' && action.annotationTarget !== undefined ? 'Annotation'
        : action.subtype === 'Rendition' ? 'AN'
        : action.subtype === 'GoTo3DView' || action.subtype === 'RichMediaExecute' ? 'TA' : null
      if (action.annotationTarget !== undefined) {
        if (expectedTargetEntry === null || action.annotationTarget.entry !== expectedTargetEntry) {
          throw new Error(`PDF ${action.subtype} action has an invalid annotation target entry`)
        }
        const annotationId = actionAnnotationIds[action.annotationTarget.annotationIndex]
        if (annotationId === undefined) throw new Error(`PDF action annotation index ${action.annotationTarget.annotationIndex} out of range`)
        const targetSubtype = actionAnnotationSubtypes[action.annotationTarget.annotationIndex]
        const validTarget = action.subtype === 'Movie' ? targetSubtype === 'Movie'
          : action.subtype === 'Rendition' ? targetSubtype === 'Screen'
          : action.subtype === 'GoTo3DView' ? targetSubtype === '3D' || targetSubtype === 'RichMedia'
            : targetSubtype === 'RichMedia'
        if (!validTarget) throw new Error(`PDF ${action.subtype} action has an invalid target annotation subtype ${targetSubtype}`)
        entries.push(`/${expectedTargetEntry} ${annotationId} 0 R`)
      } else if (action.subtype === 'GoTo3DView' || action.subtype === 'RichMediaExecute') {
        throw new Error(`PDF ${action.subtype} action requires an annotation target`)
      }
      if (action.optionalContentState !== undefined) {
        if (action.subtype !== 'SetOCGState' || action.optionalContentState.length === 0) {
          throw new Error(`PDF ${action.subtype} action has an invalid optional-content state`)
        }
        const state: string[] = []
        let hasOperator = false
        let groupsForOperator = 0
        for (let i = 0; i < action.optionalContentState.length; i++) {
          const item = action.optionalContentState[i]!
          if (item.kind === 'operator') {
            if (hasOperator && groupsForOperator === 0) throw new Error('Each PDF SetOCGState operator requires at least one group')
            state.push(`/${item.value}`)
            hasOperator = true
            groupsForOperator = 0
          } else {
            if (!hasOperator) throw new Error('PDF SetOCGState state must begin with an operator')
            const id = actionOptionalGroupObjects.get(item.groupId)
            if (id === undefined) throw new Error(`PDF SetOCGState references unknown optional-content group ${item.groupId}`)
            state.push(`${id} 0 R`)
            groupsForOperator++
          }
        }
        if (groupsForOperator === 0) throw new Error('Each PDF SetOCGState operator requires at least one group')
        entries.push(`/State [${state.join(' ')}]`)
      } else if (action.subtype === 'SetOCGState') {
        throw new Error('PDF SetOCGState action requires optionalContentState')
      }
      if (action.documentPartIndex !== undefined) {
        if (action.subtype !== 'GoToDp') throw new Error(`PDF ${action.subtype} action must not define a document part`)
        const id = actionDocumentPartIds[action.documentPartIndex]
        if (id === undefined) throw new Error(`PDF GoToDp document part index ${action.documentPartIndex} out of range`)
        entries.push(`/Dp ${id} 0 R`)
      } else if (action.subtype === 'GoToDp') {
        throw new Error('PDF GoToDp action requires documentPartIndex')
      }
      if (action.embeddedTarget !== undefined) {
        if (action.subtype !== 'GoToE') throw new Error(`PDF ${action.subtype} action must not define an embedded target`)
        entries.push(`/T ${buildPdfEmbeddedTarget(action.embeddedTarget)}`)
      }
      if (action.launchParameters !== undefined) {
        if (action.subtype !== 'Launch') throw new Error(`PDF ${action.subtype} action must not define launch platform parameters`)
        if (action.launchParameters.windows !== undefined) entries.push(`/Win ${pdfWindowsLaunchParameters(action.launchParameters.windows)}`)
        if (action.launchParameters.mac !== undefined) entries.push(`/Mac ${rawPdfDictionaryPdf(action.launchParameters.mac)}`)
        if (action.launchParameters.unix !== undefined) entries.push(`/Unix ${rawPdfDictionaryPdf(action.launchParameters.unix)}`)
      }
      if (action.richMediaInstanceIndex !== undefined) {
        if (action.subtype !== 'RichMediaExecute' || action.annotationTarget === undefined) {
          throw new Error(`PDF ${action.subtype} action must not define a RichMedia instance`)
        }
        const instances = actionRichMediaInstanceIds.get(action.annotationTarget.annotationIndex)
        const instanceId = instances?.[action.richMediaInstanceIndex]
        if (instanceId === undefined) throw new Error(`PDF RichMedia instance index ${action.richMediaInstanceIndex} out of range`)
        entries.push(`/TI ${instanceId} 0 R`)
      }
      if (action.fieldTargets !== undefined) {
        const expectedFieldEntry = action.subtype === 'Hide' ? 'T'
          : action.subtype === 'SubmitForm' || action.subtype === 'ResetForm' ? 'Fields' : null
        if (expectedFieldEntry === null || action.fieldTargets.entry !== expectedFieldEntry || action.fieldTargets.names.length === 0) {
          throw new Error(`PDF ${action.subtype} action has invalid field targets`)
        }
        const values = action.fieldTargets.names.map(pdfString)
        const value = action.fieldTargets.scalar ? values[0]! : `[${values.join(' ')}]`
        entries.push(`/${expectedFieldEntry} ${value}`)
      } else if (action.subtype === 'Hide') {
        throw new Error('PDF Hide action requires fieldTargets')
      }
      if (action.articleTarget !== undefined) {
        if (action.subtype !== 'Thread') throw new Error(`PDF ${action.subtype} action must not define an article target`)
        const threadId = actionArticleThreadIds[action.articleTarget.threadIndex]
        if (threadId === undefined) throw new Error(`PDF article thread index ${action.articleTarget.threadIndex} out of range`)
        entries.push(`/D ${threadId} 0 R`)
        if (action.articleTarget.beadIndex !== undefined) {
          const beadId = actionArticleBeadIds[action.articleTarget.threadIndex]?.[action.articleTarget.beadIndex]
          if (beadId === undefined) throw new Error(`PDF article bead index ${action.articleTarget.beadIndex} out of range`)
          entries.push(`/B ${beadId} 0 R`)
        }
      }
      const keys = Object.keys(action.entries)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!
        if (key === 'Type' || key === 'S' || key === 'Next'
          || (destinationAction && key === 'D')
          || ((action.subtype === 'GoTo' || action.subtype === 'GoToR') && key === 'SD')
          || (expectedTargetEntry !== null && key === expectedTargetEntry)
          || (action.subtype === 'SetOCGState' && key === 'State')
          || (action.subtype === 'GoToDp' && key === 'Dp')
          || (action.subtype === 'GoToE' && key === 'T')
          || (action.subtype === 'Launch' && (key === 'Win' || key === 'Mac' || key === 'Unix'))
          || (action.subtype === 'RichMediaExecute' && key === 'TI')
          || (action.subtype === 'Hide' && key === 'T')
          || ((action.subtype === 'SubmitForm' || action.subtype === 'ResetForm') && key === 'Fields')
          || (action.subtype === 'Thread' && action.articleTarget !== undefined && (key === 'D' || key === 'B'))) throw new Error(`PDF action entries must not contain reserved key ${key}`)
        entries.push(`${encodePdfName(key)} ${rawPdfValuePdf(action.entries[key]!)}`)
      }
      if (action.next !== undefined) {
        if (Array.isArray(action.next)) {
          if (action.next.length === 0) throw new Error('PDF action Next array must not be empty')
          entries.push(`/Next [${action.next.map(function (next) { return pdfActionPdf(next, path) }).join(' ')}]`)
        } else {
          entries.push(`/Next ${pdfActionPdf(action.next, path)}`)
        }
      }
      path.delete(action)
      return `<< ${entries.join(' ')} >>`
    }
    const pdfAdditionalActionsPdf = function (actions: Record<string, PdfActionDef>): string {
      const entries: string[] = []
      for (const key of Object.keys(actions)) entries.push(`${encodePdfName(key)} ${pdfActionPdf(actions[key]!)}`)
      return `<< ${entries.join(' ')} >>`
    }
    const pdfFieldAdditionalActionsPdf = function (actions: Partial<Record<'K' | 'F' | 'V' | 'C', PdfActionDef>>): string {
      const keys = Object.keys(actions)
      if (keys.length === 0) throw new Error('PDF form field additional actions must not be empty')
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== 'K' && keys[i] !== 'F' && keys[i] !== 'V' && keys[i] !== 'C') {
          throw new Error(`Unsupported PDF form field additional-action trigger: ${keys[i]}`)
        }
      }
      return pdfAdditionalActionsPdf(actions as Record<string, PdfActionDef>)
    }

    // Annotation appearances participate in font subsetting, so they must be
    // shaped and registered before the font objects are materialized.
    const preparedAnnotationAppearances = this.prepareEmbeddedAnnotationAppearances(pdfa)

    // ─── Font object generation ───
    const fontObjects = new Map<string, number>()  // fontId → Type0 font object id

    for (const [fontUseKey, refName] of this.fontRefMap) {
      const fontUse = this.fontUses.get(fontUseKey)
      if (fontUse === undefined) throw new Error(`PDF font use not registered: ${fontUseKey}`)
      const fontId = fontUse.fontId
      const standardName = this.standardFonts.get(fontId)
      if (standardName !== undefined) {
        // Standard-14 reference: non-embedded simple Type1 dictionary
        const symbolic = standardName === 'Symbol' || standardName === 'ZapfDingbats'
        const fontObjId = alloc()
        w.writeDeferredDict(fontObjId, [
          '/Type /Font',
          '/Subtype /Type1',
          `/BaseFont /${standardName}`,
          ...(symbolic ? [] : ['/Encoding /WinAnsiEncoding']),
        ])
        fontObjects.set(refName, fontObjId)
        continue
      }
      const font = this.fonts[fontId]!
      const used = this.usedGlyphs.get(fontUseKey) ?? new Set()
      const cpMap = this.usedCodePoints.get(fontUseKey) ?? new Map()
      if (pdfa !== undefined && used.has(0)) {
        throw new Error(`${pdfa} text references the .notdef glyph in font ${fontId}`)
      }

      if (fontUse.mode === 'reference') {
        if (pdfa !== undefined) throw new Error(`${pdfa} requires embedded font programs: ${fontId}`)
        const m = font.metrics
        const scale1000 = 1000 / m.unitsPerEm
        const sortedGids = [...used].sort(function (a, b) { return a - b })
        const widthEntries: string[] = []
        for (let gi = 0; gi < sortedGids.length; gi++) {
          const gid = sortedGids[gi]!
          widthEntries.push(`${gid} [${Math.round(font.getAdvanceWidth(gid) * scale1000)}]`)
        }
        const defaultWidth = Math.round(font.getAdvanceWidth(0) * scale1000)
        const baseName = escapePdfNameBody(font.postScriptName || fontId)
        const descriptorId = alloc()
        const cidFontId = alloc()
        const type0Id = alloc()
        const toUnicodeId = alloc()
        const ascent = Math.round(m.ascender * scale1000)
        const descent = Math.round(m.descender * scale1000)
        const capH = Math.round((m.capHeight || m.ascender) * scale1000)
        let flags = 4
        if (m.italicAngle !== 0) flags |= 64
        let bboxXMin = 0
        let bboxYMin = descent
        let bboxXMax = 1000
        let bboxYMax = ascent
        for (let gi = 0; gi < sortedGids.length; gi++) {
          const glyph = font.getGlyph(sortedGids[gi]!)
          const gxMin = Math.floor(glyph.xMin * scale1000)
          const gyMin = Math.floor(glyph.yMin * scale1000)
          const gxMax = Math.ceil(glyph.xMax * scale1000)
          const gyMax = Math.ceil(glyph.yMax * scale1000)
          if (gxMin < bboxXMin) bboxXMin = gxMin
          if (gyMin < bboxYMin) bboxYMin = gyMin
          if (gxMax > bboxXMax) bboxXMax = gxMax
          if (gyMax > bboxYMax) bboxYMax = gyMax
        }
        w.writeDeferredDict(descriptorId, [
          '/Type /FontDescriptor',
          `/FontName /${baseName}`,
          `/FontFamily ${pdfString(font.familyName || fontId)}`,
          `/FontStretch /${pdfFontStretchName(m.widthClass)}`,
          `/FontWeight ${Math.max(100, Math.min(900, Math.round(m.weightClass / 100) * 100))}`,
          `/Flags ${flags}`,
          `/FontBBox [${bboxXMin} ${bboxYMin} ${bboxXMax} ${bboxYMax}]`,
          `/ItalicAngle ${m.italicAngle}`,
          `/Ascent ${Math.max(ascent, bboxYMax)}`,
          `/Descent ${Math.min(descent, bboxYMin)}`,
          `/CapHeight ${capH}`,
          `/StemV ${m.isBold ? 120 : 80}`,
        ])
        const cidFontEntries = [
          '/Type /Font',
          `/Subtype ${font.isCff || font.isCff2 ? '/CIDFontType0' : '/CIDFontType2'}`,
          `/BaseFont /${baseName}`,
          '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>',
          `/FontDescriptor ${descriptorId} 0 R`,
          `/DW ${defaultWidth}`,
          `/W [${widthEntries.join(' ')}]`,
        ]
        if (this.verticalTextFonts.has(fontUseKey)) {
          const w2Entries: string[] = []
          for (let gi = 0; gi < sortedGids.length; gi++) {
            const gid = sortedGids[gi]!
            const ah = Math.round(font.getAdvanceHeight(gid) * scale1000)
            const vx = Math.round(font.getAdvanceWidth(gid) * scale1000 / 2)
            const vy = Math.round(font.getVerticalOrigin(gid) * scale1000)
            w2Entries.push(`${gid} [${-ah} ${vx} ${vy}]`)
          }
          cidFontEntries.push('/DW2 [880 -1000]')
          cidFontEntries.push(`/W2 [${w2Entries.join(' ')}]`)
        }
        if (!font.isCff && !font.isCff2) cidFontEntries.push('/CIDToGIDMap /Identity')
        w.writeDeferredDict(cidFontId, cidFontEntries)
        const identityGidMap = new Map<number, number>()
        for (let gi = 0; gi < sortedGids.length; gi++) identityGidMap.set(sortedGids[gi]!, sortedGids[gi]!)
        const toUnicodeCmap = buildToUnicodeCMap(cpMap, this.glyphSourceTexts.get(fontUseKey), identityGidMap)
        w.beginObj(toUnicodeId)
        writeStream(toUnicodeId, encodeAscii(toUnicodeCmap))
        w.endObj()
        w.writeDeferredDict(type0Id, [
          '/Type /Font',
          '/Subtype /Type0',
          `/BaseFont /${baseName}`,
          '/Encoding /Identity-H',
          `/DescendantFonts [${cidFontId} 0 R]`,
          `/ToUnicode ${toUnicodeId} 0 R`,
        ])
        fontObjects.set(refName, type0Id)
        if (this.verticalTextFonts.has(fontUseKey)) {
          const type0VId = alloc()
          w.writeDeferredDict(type0VId, [
            '/Type /Font',
            '/Subtype /Type0',
            `/BaseFont /${baseName}`,
            '/Encoding /Identity-V',
            `/DescendantFonts [${cidFontId} 0 R]`,
            `/ToUnicode ${toUnicodeId} 0 R`,
          ])
          fontObjects.set(refName + 'V', type0VId)
        }
        continue
      }

      const embedding = font.embeddingPermissions
      let embeddedGlyphs = used
      if (embedding.noSubsetting) {
        embeddedGlyphs = new Set<number>()
        for (let glyphId = 0; glyphId < font.numGlyphs; glyphId++) embeddedGlyphs.add(glyphId)
      }
      // Build the embedded font with GID mapping. OS/2 licensing restrictions
      // are enforced by Font.subsetByGlyphIds; NO_SUBSETTING retains every glyph.
      const subsetResult = font.subsetByGlyphIds(embeddedGlyphs, cpMap)
      const oldToNew = subsetResult.oldToNewGlyphId

      const baseName = font.postScriptName || fontId
      const subsetName = embedding.noSubsetting
        ? escapePdfNameBody(baseName)
        : `${generateSubsetPrefix()}+${escapePdfNameBody(baseName)}`

      // Store the GID remapping table (for content stream rewriting)
      this.fontGidRemap.set(fontUseKey, oldToNew)

      // Font metrics
      const m = font.metrics
      const scale1000 = 1000 / m.unitsPerEm

      // /W array (new GID → width in 1/1000 em units)
      const widthEntries: string[] = []
      const sortedGids = [...used].sort((a, b) => a - b)
      for (let gi = 0; gi < sortedGids.length; gi++) {
        const gid = sortedGids[gi]!
        const newGid = oldToNew.get(gid) ?? gid
        const aw = font.getAdvanceWidth(gid)
        widthEntries.push(`${newGid} [${Math.round(aw * scale1000)}]`)
      }
      const defaultWidth = Math.round(font.getAdvanceWidth(0) * scale1000)

      // ToUnicode CMap (based on new GIDs)
      const toUnicodeCmap = buildToUnicodeCMap(cpMap, this.glyphSourceTexts.get(fontUseKey), oldToNew)

      // Object allocation
      const fontFileId = alloc()
      const descriptorId = alloc()
      const cidFontId = alloc()
      const type0Id = alloc()
      const toUnicodeId = alloc()
      const cidSetId = pdfa === 'PDF/A-1b' ? alloc() : 0

      // FontFile2 (TrueType) or FontFile3 /CIDFontType0C (CFF, including a CFF2
      // font baked to a static CFF at its current instance)
      const isCff = font.isCff || font.isCff2
      w.beginObj(fontFileId)
      if (isCff) {
        const cffData = subsetResult.cidKeyedCff ?? new Uint8Array(subsetResult.buffer)
        writeStream(fontFileId, cffData, '/Subtype /CIDFontType0C ')
      } else {
        const subsetBytes = new Uint8Array(subsetResult.buffer)
        const origLen = subsetBytes.length
        writeStream(fontFileId, subsetBytes, `/Length1 ${origLen} `)
      }
      w.endObj()

      if (cidSetId !== 0) {
        const subsetCids = new Set<number>(oldToNew.values())
        subsetCids.add(0)
        let highestCid = 0
        for (const cid of subsetCids) if (cid > highestCid) highestCid = cid
        const cidSet = new Uint8Array((highestCid >> 3) + 1)
        for (const cid of subsetCids) cidSet[cid >> 3]! |= 1 << (7 - (cid & 7))
        w.beginObj(cidSetId)
        writeStream(cidSetId, cidSet)
        w.endObj()
      }

      // FontDescriptor
      let flags = 4  // Symbolic
      if (m.italicAngle !== 0) flags |= 64  // Italic
      const ascent = Math.round(m.ascender * scale1000)
      const descent = Math.round(m.descender * scale1000)
      const capH = Math.round((m.capHeight || m.ascender) * scale1000)
      const stemV = m.isBold ? 120 : 80

      // FontBBox: scan the actual bboxes of all glyphs in the subset
      // ascender/descender alone would clip large variant glyphs (math ∫ etc.)
      let bboxXMin = 0
      let bboxYMin = descent
      let bboxXMax = 1000
      let bboxYMax = ascent
      for (let gi = 0; gi < sortedGids.length; gi++) {
        const gid = sortedGids[gi]!
        const g = font.getGlyph(gid)
        // FontBBox must encompass every glyph (ISO 32000-1 9.8.1): round the
        // low corners down and the high corners up so scaling to 1000/upm never
        // shrinks the box inside a glyph's true extent.
        const gxMin = Math.floor(g.xMin * scale1000)
        const gyMin = Math.floor(g.yMin * scale1000)
        const gxMax = Math.ceil(g.xMax * scale1000)
        const gyMax = Math.ceil(g.yMax * scale1000)
        if (gxMin < bboxXMin) bboxXMin = gxMin
        if (gyMin < bboxYMin) bboxYMin = gyMin
        if (gxMax > bboxXMax) bboxXMax = gxMax
        if (gyMax > bboxYMax) bboxYMax = gyMax
      }

      w.writeDeferredDict(descriptorId, [
        '/Type /FontDescriptor',
        `/FontName /${subsetName}`,
        `/Flags ${flags}`,
        `/FontBBox [${bboxXMin} ${bboxYMin} ${bboxXMax} ${bboxYMax}]`,
        `/ItalicAngle ${m.italicAngle}`,
        `/Ascent ${Math.max(ascent, bboxYMax)}`,
        `/Descent ${Math.min(descent, bboxYMin)}`,
        `/CapHeight ${capH}`,
        `/StemV ${stemV}`,
        isCff ? `/FontFile3 ${fontFileId} 0 R` : `/FontFile2 ${fontFileId} 0 R`,
        ...(cidSetId === 0 ? [] : [`/CIDSet ${cidSetId} 0 R`]),
      ])

      // CIDFont
      const cidSubtype = isCff ? '/CIDFontType0' : '/CIDFontType2'
      const cidFontEntries = [
        '/Type /Font',
        `/Subtype ${cidSubtype}`,
        `/BaseFont /${subsetName}`,
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>',
        `/FontDescriptor ${descriptorId} 0 R`,
        `/DW ${defaultWidth}`,
        `/W [${widthEntries.join(' ')}]`,
      ]
      // Vertical metrics for Identity-V use: w1y (downward advance), and the
      // position vector from the horizontal to the vertical origin
      if (this.verticalTextFonts.has(fontUseKey)) {
        const w2Entries: string[] = []
        for (let gi = 0; gi < sortedGids.length; gi++) {
          const gid = sortedGids[gi]!
          const newGid = oldToNew.get(gid) ?? gid
          const ah = Math.round(font.getAdvanceHeight(gid) * scale1000)
          const vx = Math.round(font.getAdvanceWidth(gid) * scale1000 / 2)
          const vy = Math.round(font.getVerticalOrigin(gid) * scale1000)
          w2Entries.push(`${newGid} [${-ah} ${vx} ${vy}]`)
        }
        cidFontEntries.push('/DW2 [880 -1000]')
        cidFontEntries.push(`/W2 [${w2Entries.join(' ')}]`)
      }
      // CIDToGIDMap is mandatory for CIDFontType2 (TrueType)
      // Identity = CID values are used directly as GIDs
      if (!isCff) {
        cidFontEntries.push('/CIDToGIDMap /Identity')
      }
      w.writeDeferredDict(cidFontId, cidFontEntries)

      // ToUnicode
      const cmapBytes = encodeAscii(toUnicodeCmap)
      w.beginObj(toUnicodeId)
      writeStream(toUnicodeId, cmapBytes)
      w.endObj()

      // Type0 font
      w.writeDeferredDict(type0Id, [
        '/Type /Font',
        '/Subtype /Type0',
        `/BaseFont /${subsetName}`,
        '/Encoding /Identity-H',
        `/DescendantFonts [${cidFontId} 0 R]`,
        `/ToUnicode ${toUnicodeId} 0 R`,
      ])

      fontObjects.set(refName, type0Id)

      if (this.verticalTextFonts.has(fontUseKey)) {
        const type0VId = alloc()
        w.writeDeferredDict(type0VId, [
          '/Type /Font',
          '/Subtype /Type0',
          `/BaseFont /${subsetName}`,
          '/Encoding /Identity-V',
          `/DescendantFonts [${cidFontId} 0 R]`,
          `/ToUnicode ${toUnicodeId} 0 R`,
        ])
        fontObjects.set(refName + 'V', type0VId)
      }
    }

    // ─── ExtGState object generation ───
    const gsObjects = new Map<string, number>()  // "/GS0" → object id
    for (let gsi = 0; gsi < this.gsValues.length; gsi++) {
      const entry = this.gsValues[gsi]!
      const id = alloc()
      const dictEntries = ['/Type /ExtGState']
      if (entry.blendMode) {
        dictEntries.push(`/BM /${entry.blendMode}`)
      }
      if (entry.fillOpacity != null) dictEntries.push(`/ca ${pn(entry.fillOpacity)}`)
      if (entry.strokeOpacity != null) dictEntries.push(`/CA ${pn(entry.strokeOpacity)}`)
      if (entry.overprintStroke != null) dictEntries.push(`/OP ${entry.overprintStroke ? 'true' : 'false'}`)
      if (entry.overprintFill != null) dictEntries.push(`/op ${entry.overprintFill ? 'true' : 'false'}`)
      if (entry.overprintMode != null) dictEntries.push(`/OPM ${entry.overprintMode}`)
      if (entry.renderingIntent != null) dictEntries.push(`/RI /${entry.renderingIntent}`)
      if (entry.alphaIsShape !== undefined) dictEntries.push(`/AIS ${entry.alphaIsShape ? 'true' : 'false'}`)
      if (entry.textKnockout !== undefined) dictEntries.push(`/TK ${entry.textKnockout ? 'true' : 'false'}`)
      if (entry.deviceParams !== undefined) {
        const dp = entry.deviceParams
        const arrayPdf = (values: number[]): string => `[${values.map(pn).join(' ')}]`
        const emitFunction = (fn: RenderTransferFunction): number => {
          if ('functionType' in fn) {
            if (fn.functionType === 0) {
              const id = alloc()
              w.beginObj(id)
              writeStream(id, fn.data, `/FunctionType 0 /Domain ${arrayPdf(fn.domain)} /Range ${arrayPdf(fn.range)} /Size ${arrayPdf(fn.size)} /BitsPerSample ${fn.bitsPerSample} /Order ${fn.order} /Encode ${arrayPdf(fn.encode)} /Decode ${arrayPdf(fn.decode)} `)
              w.endObj()
              return id
            }
            if (fn.functionType === 2) {
              const id = alloc()
              w.writeDeferredDict(id, ['/FunctionType 2', `/Domain ${arrayPdf(fn.domain)}`, ...(fn.range === undefined ? [] : [`/Range ${arrayPdf(fn.range)}`]), `/C0 ${arrayPdf(fn.c0)}`, `/C1 ${arrayPdf(fn.c1)}`, `/N ${pn(fn.exponent)}`])
              return id
            }
            if (fn.functionType === 3) {
              const ids = fn.functions.map(emitFunction)
              const id = alloc()
              w.writeDeferredDict(id, ['/FunctionType 3', `/Domain ${arrayPdf(fn.domain)}`, ...(fn.range === undefined ? [] : [`/Range ${arrayPdf(fn.range)}`]), `/Functions [${ids.map(function (ref) { return `${ref} 0 R` }).join(' ')}]`, `/Bounds ${arrayPdf(fn.bounds)}`, `/Encode ${arrayPdf(fn.encode)}`])
              return id
            }
            const id = alloc()
            w.beginObj(id)
            writeStream(id, encodeAscii(fn.expression), `/FunctionType 4 /Domain ${arrayPdf(fn.domain)} /Range ${arrayPdf(fn.range)} `)
            w.endObj()
            return id
          }
          const fnId = alloc()
          w.beginObj(fnId)
          writeStream(fnId, encodeAscii(fn.expression), '/FunctionType 4 /Domain [0 1] /Range [0 1] ')
          w.endObj()
          return fnId
        }
        // A spot function maps (x, y) in [-1, 1] to a value in [-1, 1] (§10.6.5.2).
        const emitSpotFunction = (fn: RenderCalculatorFunction): number => {
          const fnId = alloc()
          w.beginObj(fnId)
          writeStream(fnId, encodeAscii(fn.expression), '/FunctionType 4 /Domain [-1 1 -1 1] /Range [-1 1] ')
          w.endObj()
          return fnId
        }
        // A halftone dict's /TransferFunction is a 1-in-1-out function, so it
        // shares emitFunction's [0 1] -> [0 1] domain/range.
        const htTransfer = (tf: 'Identity' | RenderTransferFunction | undefined): string =>
          tf === undefined ? '' : tf === 'Identity' ? '/TransferFunction /Identity ' : `/TransferFunction ${emitFunction(tf)} 0 R `
        const emitHalftone = (ht: RenderHalftone): number => {
          if (ht.type === 6) {
            // Type-6 threshold array: a halftone stream (§10.5.5.3).
            const tfEntry = htTransfer(ht.transferFunction)
            const htId = alloc()
            w.beginObj(htId)
            writeStream(htId, Uint8Array.from(ht.thresholds),
              `/Type /Halftone /HalftoneType 6 /Width ${ht.width} /Height ${ht.height} ${tfEntry}`)
            w.endObj()
            return htId
          }
          if (ht.type === 10) {
            // Type-10 angled threshold array (§10.5.5.4).
            const tfEntry = htTransfer(ht.transferFunction)
            const htId = alloc()
            w.beginObj(htId)
            writeStream(htId, Uint8Array.from(ht.thresholds),
              `/Type /Halftone /HalftoneType 10 /Xsquare ${ht.xsquare} /Ysquare ${ht.ysquare} ${tfEntry}`)
            w.endObj()
            return htId
          }
          if (ht.type === 16) {
            // Type-16 threshold array with 16-bit thresholds (§10.5.5.5).
            const bytes = new Uint8Array(ht.thresholds.length * 2)
            for (let i = 0; i < ht.thresholds.length; i++) { bytes[i * 2] = (ht.thresholds[i]! >> 8) & 0xFF; bytes[i * 2 + 1] = ht.thresholds[i]! & 0xFF }
            const second = ht.width2 !== undefined && ht.height2 !== undefined ? ` /Width2 ${ht.width2} /Height2 ${ht.height2}` : ''
            const tfEntry = htTransfer(ht.transferFunction)
            const htId = alloc()
            w.beginObj(htId)
            writeStream(htId, bytes, `/Type /Halftone /HalftoneType 16 /Width ${ht.width} /Height ${ht.height}${second} ${tfEntry}`)
            w.endObj()
            return htId
          }
          if (ht.type === 5) {
            // Type-5 per-colorant collection (§10.5.5.2): each colorant references a halftone.
            const entries = ht.halftones.map(e => `/${e.colorant} ${emitHalftone(e.halftone)} 0 R`)
            const htId = alloc()
            w.writeDeferredDict(htId, ['/Type /Halftone', '/HalftoneType 5', ...entries])
            return htId
          }
          const spotEntry = typeof ht.spotFunction === 'string'
            ? `/SpotFunction /${ht.spotFunction}`
            : `/SpotFunction ${emitSpotFunction(ht.spotFunction)} 0 R`
          const tfRef = ht.transferFunction === undefined ? []
            : ht.transferFunction === 'Identity' ? ['/TransferFunction /Identity']
            : [`/TransferFunction ${emitFunction(ht.transferFunction)} 0 R`]
          const htId = alloc()
          w.writeDeferredDict(htId, [
            '/Type /Halftone', '/HalftoneType 1',
            `/Frequency ${pn(ht.frequency)}`, `/Angle ${pn(ht.angle)}`, spotEntry,
            ...(ht.accurateScreens === undefined ? [] : [`/AccurateScreens ${ht.accurateScreens}`]),
            ...tfRef,
          ])
          return htId
        }
        if (dp.transferFunction !== undefined) {
          // The name /Default is valid only on /TR2 (§8.4.5); /Identity and
          // functions use /TR.
          if (dp.transferFunction === 'Default') dictEntries.push('/TR2 /Default')
          else if (dp.transferFunction === 'Identity') dictEntries.push('/TR /Identity')
          else if (Array.isArray(dp.transferFunction)) {
            const refs = dp.transferFunction.map(fn => `${emitFunction(fn)} 0 R`).join(' ')
            dictEntries.push(`/TR [${refs}]`)
          } else dictEntries.push(`/TR ${emitFunction(dp.transferFunction)} 0 R`)
        }
        if (dp.blackGeneration !== undefined) {
          if (dp.blackGeneration === 'Default') dictEntries.push('/BG2 /Default')
          else dictEntries.push(`/BG ${emitFunction(dp.blackGeneration)} 0 R`)
        }
        if (dp.undercolorRemoval !== undefined) {
          if (dp.undercolorRemoval === 'Default') dictEntries.push('/UCR2 /Default')
          else dictEntries.push(`/UCR ${emitFunction(dp.undercolorRemoval)} 0 R`)
        }
        if (dp.useBlackPointCompensation !== undefined) {
          const value = dp.useBlackPointCompensation === 'on' ? 'ON' : dp.useBlackPointCompensation === 'off' ? 'OFF' : 'Default'
          dictEntries.push(`/UseBlackPtComp /${value}`)
        }
        if (dp.flatness !== undefined) dictEntries.push(`/FL ${pn(dp.flatness)}`)
        if (dp.smoothness !== undefined) dictEntries.push(`/SM ${pn(dp.smoothness)}`)
        if (dp.strokeAdjustment !== undefined) dictEntries.push(`/SA ${pdfBool(dp.strokeAdjustment)}`)
        if (dp.halftone !== undefined) {
          if (dp.halftone === 'Default') dictEntries.push('/HT /Default')
          else dictEntries.push(`/HT ${emitHalftone(dp.halftone)} 0 R`)
        }
        if (dp.halftoneOrigin !== undefined) dictEntries.push(`/HTO [${pn(dp.halftoneOrigin[0])} ${pn(dp.halftoneOrigin[1])}]`)
      }
      w.writeDeferredDict(id, dictEntries)
      gsObjects.set(entry.name, id)
    }

    // ─── Separation color space objects (spot colors) ───
    const colorSpaceObjects = new Map<string, number>()  // "/CS0" → object id
    const numberArrayPdf = function (values: readonly number[]): string {
      return `[${values.map(pn).join(' ')}]`
    }
    const emitPdfFunction = (fn: PdfFunctionDef): number => {
      if (fn.functionType === 0) {
        const id = alloc()
        w.beginObj(id)
        writeStream(
          id,
          fn.data,
          `/FunctionType 0 /Domain ${numberArrayPdf(fn.domain)} /Range ${numberArrayPdf(fn.range)} ` +
          `/Size ${numberArrayPdf(fn.size)} /BitsPerSample ${fn.bitsPerSample} /Order ${fn.order} ` +
          `/Encode ${numberArrayPdf(fn.encode)} /Decode ${numberArrayPdf(fn.decode)} `,
        )
        w.endObj()
        return id
      }
      if (fn.functionType === 2) {
        const id = alloc()
        w.writeDeferredDict(id, [
          '/FunctionType 2',
          `/Domain ${numberArrayPdf(fn.domain)}`,
          ...(fn.range === undefined ? [] : [`/Range ${numberArrayPdf(fn.range)}`]),
          `/C0 ${numberArrayPdf(fn.c0)}`,
          `/C1 ${numberArrayPdf(fn.c1)}`,
          `/N ${pn(fn.exponent)}`,
        ])
        return id
      }
      if (fn.functionType === 3) {
        const subFunctions = fn.functions.map(emitPdfFunction)
        const id = alloc()
        w.writeDeferredDict(id, [
          '/FunctionType 3',
          `/Domain ${numberArrayPdf(fn.domain)}`,
          ...(fn.range === undefined ? [] : [`/Range ${numberArrayPdf(fn.range)}`]),
          `/Functions [${subFunctions.map(function (ref) { return `${ref} 0 R` }).join(' ')}]`,
          `/Bounds ${numberArrayPdf(fn.bounds)}`,
          `/Encode ${numberArrayPdf(fn.encode)}`,
        ])
        return id
      }
      const id = alloc()
      w.beginObj(id)
      writeStream(id, encodeAscii(fn.expression), `/FunctionType 4 /Domain ${numberArrayPdf(fn.domain)} /Range ${numberArrayPdf(fn.range)} `)
      w.endObj()
      return id
    }
    const processColorSpacePdf = (colorSpace: PdfProcessColorSpaceDef): string => {
      if (colorSpace.kind === 'gray') return '/DeviceGray'
      if (colorSpace.kind === 'rgb') return '/DeviceRGB'
      if (colorSpace.kind === 'cmyk') return '/DeviceCMYK'
      if (colorSpace.kind === 'calgray') {
        return `[/CalGray << /WhitePoint ${numberArrayPdf(colorSpace.whitePoint)} /BlackPoint ${numberArrayPdf(colorSpace.blackPoint)} /Gamma ${pn(colorSpace.gamma)} >>]`
      }
      if (colorSpace.kind === 'calrgb') {
        return `[/CalRGB << /WhitePoint ${numberArrayPdf(colorSpace.whitePoint)} /BlackPoint ${numberArrayPdf(colorSpace.blackPoint)} /Gamma ${numberArrayPdf(colorSpace.gamma)} /Matrix ${numberArrayPdf(colorSpace.matrix)} >>]`
      }
      if (colorSpace.kind === 'lab') {
        return `[/Lab << /WhitePoint ${numberArrayPdf(colorSpace.whitePoint)} /BlackPoint ${numberArrayPdf(colorSpace.blackPoint)} /Range ${numberArrayPdf(colorSpace.range)} >>]`
      }
      const profileId = alloc()
      w.beginObj(profileId)
      writeStream(profileId, colorSpace.profile, `/N ${colorSpace.components} /Range ${numberArrayPdf(colorSpace.range)} `)
      w.endObj()
      return `[/ICCBased ${profileId} 0 R]`
    }
    const separationColorSpacePdf = (colorSpace: PdfSeparationColorSpaceDef): string => {
      const functionId = emitPdfFunction(colorSpace.tintTransform)
      return `[/Separation ${encodePdfName(colorSpace.name)} ${processColorSpacePdf(colorSpace.alternate)} ${functionId} 0 R]`
    }
    const specialColorSpacePdf = (colorSpace: PdfSeparationColorSpaceDef | PdfDeviceNColorSpaceDef): string => {
      if (colorSpace.kind === 'separation') return separationColorSpacePdf(colorSpace)
      const functionId = emitPdfFunction(colorSpace.tintTransform)
      const colorantEntries = Object.keys(colorSpace.colorants).map(function (name) {
        return `${encodePdfName(name)} ${separationColorSpacePdf(colorSpace.colorants[name]!)}`
      })
      const attributeEntries: string[] = [`/Subtype /${colorSpace.subtype}`]
      if (colorantEntries.length > 0) attributeEntries.push(`/Colorants << ${colorantEntries.join(' ')} >>`)
      if (colorSpace.process !== undefined) {
        attributeEntries.push(
          `/Process << /ColorSpace ${processColorSpacePdf(colorSpace.process.colorSpace)} ` +
          `/Components [${colorSpace.process.components.map(encodePdfName).join(' ')}] >>`,
        )
      }
      if (colorSpace.mixingHints !== undefined) {
        const solidityEntries = Object.keys(colorSpace.mixingHints.solidities).map(function (name) {
          return `${encodePdfName(name)} ${pn(colorSpace.mixingHints!.solidities[name]!)}`
        })
        const dotGainEntries = Object.keys(colorSpace.mixingHints.dotGain).map(function (name) {
          return `${encodePdfName(name)} ${emitPdfFunction(colorSpace.mixingHints!.dotGain[name]!)} 0 R`
        })
        const hintEntries: string[] = []
        if (solidityEntries.length > 0) hintEntries.push(`/Solidities << ${solidityEntries.join(' ')} >>`)
        if (colorSpace.mixingHints.printingOrder.length > 0) {
          hintEntries.push(`/PrintingOrder [${colorSpace.mixingHints.printingOrder.map(encodePdfName).join(' ')}]`)
        }
        if (dotGainEntries.length > 0) hintEntries.push(`/DotGain << ${dotGainEntries.join(' ')} >>`)
        attributeEntries.push(`/MixingHints << ${hintEntries.join(' ')} >>`)
      }
      return `[/DeviceN [${colorSpace.names.map(encodePdfName).join(' ')}] ${processColorSpacePdf(colorSpace.alternate)} ${functionId} 0 R << ${attributeEntries.join(' ')} >>]`
    }
    const shadingColorSpacePdf = (colorSpace: PdfShadingColorSpaceDef): string => {
      if (colorSpace.kind === 'separation' || colorSpace.kind === 'deviceN') return specialColorSpacePdf(colorSpace)
      if (colorSpace.kind === 'indexed') {
        const base = colorSpace.base.kind === 'separation' || colorSpace.base.kind === 'deviceN'
          ? specialColorSpacePdf(colorSpace.base)
          : processColorSpacePdf(colorSpace.base)
        return `[/Indexed ${base} ${colorSpace.high} <${bytesToHex(colorSpace.lookup)}>]`
      }
      return processColorSpacePdf(colorSpace)
    }
    if (this.iccColorSpaceName !== null) {
      // ICCBased sRGB color space for managed content colors
      const iccData = generateSRGBIccProfile()
      const iccStreamId = alloc()
      w.beginObj(iccStreamId)
      writeStream(iccStreamId, iccData, `/N 3 `)
      w.endObj()
      const csId = alloc()
      w.beginObj(csId)
      w.writeRawLine(`[/ICCBased ${iccStreamId} 0 R]`)
      w.endObj()
      colorSpaceObjects.set(this.iccColorSpaceName, csId)
    }
    if (pdfa !== undefined) {
      const cmykProfileId = alloc()
      w.beginObj(cmykProfileId)
      writeStream(cmykProfileId, generateCmykIccProfile(), '/N 4 ')
      w.endObj()
      const defaultCmykId = alloc()
      w.beginObj(defaultCmykId)
      w.writeRawLine(`[/ICCBased ${cmykProfileId} 0 R]`)
      w.endObj()
      colorSpaceObjects.set('/DefaultCMYK', defaultCmykId)
    }
    for (let ci = 0; ci < this.separationDefs.length; ci++) {
      const def = this.separationDefs[ci]!
      const tintId = alloc()
      w.writeDeferredDict(tintId, [
        '/FunctionType 2',
        '/Domain [0 1]',
        '/C0 [0 0 0 0]',
        `/C1 [${pn(def.cmyk[0])} ${pn(def.cmyk[1])} ${pn(def.cmyk[2])} ${pn(def.cmyk[3])}]`,
        '/N 1',
      ])
      const csId = alloc()
      w.beginObj(csId)
      w.writeRawLine(`[/Separation ${encodePdfName(def.spotName)} /DeviceCMYK ${tintId} 0 R]`)
      w.endObj()
      colorSpaceObjects.set(def.name, csId)
    }
    for (let ci = 0; ci < this.deviceNDefs.length; ci++) {
      const def = this.deviceNDefs[ci]!
      const tintId = alloc()
      const domain = new Array(def.color.names.length).fill('0 1').join(' ')
      const pops = new Array(def.color.names.length).fill('pop').join(' ')
      const alternate = def.color.alternateCmyk.map(pn).join(' ')
      w.beginObj(tintId)
      writeStream(
        tintId,
        encodeAscii(`{ ${pops} ${alternate} }`),
        `/FunctionType 4 /Domain [${domain}] /Range [0 1 0 1 0 1 0 1] `,
      )
      w.endObj()
      const csId = alloc()
      w.beginObj(csId)
      w.writeRawLine(`[/DeviceN [${def.color.names.map(encodePdfName).join(' ')}] /DeviceCMYK ${tintId} 0 R]`)
      w.endObj()
      colorSpaceObjects.set(def.name, csId)
    }
    for (let ci = 0; ci < this.pdfSpecialColorDefs.length; ci++) {
      const def = this.pdfSpecialColorDefs[ci]!
      const csId = alloc()
      const body = specialColorSpacePdf(def.colorSpace)
      w.beginObj(csId)
      w.writeRawLine(body)
      w.endObj()
      colorSpaceObjects.set(def.name, csId)
    }
    for (let ci = 0; ci < this.calibratedColorSpaceDefs.length; ci++) {
      const def = this.calibratedColorSpaceDefs[ci]!
      const csId = alloc()
      w.beginObj(csId)
      w.writeRawLine(calibratedColorSpacePdf(def.color))
      w.endObj()
      colorSpaceObjects.set(def.name, csId)
    }
    for (let ci = 0; ci < this.patternColorSpaceDefs.length; ci++) {
      const def = this.patternColorSpaceDefs[ci]!
      const csId = alloc()
      w.beginObj(csId)
      w.writeRawLine(`[/Pattern ${def.baseColorSpace}]`)
      w.endObj()
      colorSpaceObjects.set(def.name, csId)
    }

    // ─── Optional content groups, membership dictionaries, and configurations ───
    const optionalGroups = new Map<string, PdfOptionalContentGroupDef>()
    let optionalProperties: PdfOptionalContentPropertiesDef | undefined = this.configuredOptionalContentProperties
    if (optionalProperties !== undefined) {
      for (let gi = 0; gi < optionalProperties.groups.length; gi++) optionalGroups.set(optionalProperties.groups[gi]!.id, optionalProperties.groups[gi]!)
    }
    for (let oi = 0; oi < this.optionalContentDefs.length; oi++) {
      const def = this.optionalContentDefs[oi]!
      const properties = def.content.properties
      if (properties !== undefined) {
        validateOptionalContentPropertiesModel(properties)
        if (optionalProperties !== undefined && JSON.stringify(optionalProperties) !== JSON.stringify(properties)) {
          throw new Error('PDF output cannot combine different optional-content configuration sets')
        }
        optionalProperties = properties
        for (let gi = 0; gi < properties.groups.length; gi++) optionalGroups.set(properties.groups[gi]!.id, properties.groups[gi]!)
      }
      const membership = def.content.membership
      if (membership?.kind === 'group') optionalGroups.set(membership.id, membership)
      else if (membership?.kind === 'membership') {
        for (let gi = 0; gi < membership.groups.length; gi++) optionalGroups.set(membership.groups[gi]!.id, membership.groups[gi]!)
      } else {
        optionalGroups.set(`legacy:${def.name}`, { kind: 'group', id: `legacy:${def.name}`, name: def.title, intents: ['View'] })
      }
    }
    const optionalGroupObjects = new Map<string, number>()
    for (const [groupId, group] of optionalGroups) {
      const id = alloc()
      const entries = ['/Type /OCG', `/Name (${pdfEscapeString(group.name)})`]
      if (group.intents.length === 1) entries.push(`/Intent ${encodePdfName(group.intents[0]!)}`)
      else entries.push(`/Intent [${group.intents.map(encodePdfName).join(' ')}]`)
      if (group.usage !== undefined) entries.push(`/Usage ${rawPdfDictionaryPdf(group.usage)}`)
      else if (groupId.startsWith('legacy:')) {
        const def = this.optionalContentDefs.find(function (candidate) { return `legacy:${candidate.name}` === groupId })!
        entries.push(`/Usage << /View << /ViewState /${def.visible ? 'ON' : 'OFF'} >> /Print << /PrintState /${def.print ? 'ON' : 'OFF'} >> >>`)
      }
      w.writeDeferredDict(id, entries)
      optionalGroupObjects.set(groupId, id)
    }
    actionOptionalGroupObjects = optionalGroupObjects
    const optionalContentObjects = new Map<string, number>()  // resource name -> OCG/OCMD object id
    for (let oi = 0; oi < this.optionalContentDefs.length; oi++) {
      const def = this.optionalContentDefs[oi]!
      const membership = def.content.membership
      if (membership === undefined) {
        const groupId = `legacy:${def.name}`
        optionalContentObjects.set(def.name, optionalGroupObjects.get(groupId)!)
        continue
      }
      if (membership.kind === 'group') {
        const groupId = membership.id
        optionalContentObjects.set(def.name, optionalGroupObjects.get(groupId)!)
        continue
      }
      const id = alloc()
      const refs = membership.groups.map(function (group) { return `${optionalGroupObjects.get(group.id)!} 0 R` })
      const entries = ['/Type /OCMD', `/OCGs [${refs.join(' ')}]`, `/P /${membership.policy}`]
      if (membership.expression !== undefined) entries.push(`/VE ${optionalContentExpressionPdf(membership.expression, optionalGroupObjects)}`)
      w.writeDeferredDict(id, entries)
      optionalContentObjects.set(def.name, id)
    }

    // ─── Shading object generation ───
    const shadingObjects = new Map<string, number>()  // "/Sh0" → object id
    for (let si = 0; si < this.shadingDefs.length; si++) {
      const def = this.shadingDefs[si]!
      const shadingName = `/Sh${si}`

      if (def.type === 'mesh') {
        // Mesh shading: packed vertex/patch data stream
        let decodeStr = ''
        for (let di = 0; di < def.decode.length; di++) {
          if (di > 0) decodeStr += ' '
          decodeStr += pn(def.decode[di]!)
        }
        const meshId = alloc()
        let functionEntry = ''
        if (def.functions !== undefined) {
          const ids = def.functions.map(emitPdfFunction)
          functionEntry = `/Function ${ids.length === 1 ? `${ids[0]} 0 R` : `[${ids.map(function (id) { return `${id} 0 R` }).join(' ')}]`} `
        }
        w.beginObj(meshId)
        writeStream(
          meshId, def.data,
          `/ShadingType ${def.shadingType} /ColorSpace ${def.colorSpace === undefined ? (def.cmyk ? '/DeviceCMYK' : '/DeviceRGB') : shadingColorSpacePdf(def.colorSpace)} `
          + `/BitsPerCoordinate ${def.bitsPerCoordinate ?? 32} /BitsPerComponent ${def.bitsPerComponent ?? 8} `
          + `${def.shadingType === 5 ? `/VerticesPerRow ${def.verticesPerRow} ` : `/BitsPerFlag ${def.bitsPerFlag ?? 8} `}/Decode [${decodeStr}] ${functionEntry}`
          + `${def.background === undefined ? (def.pdfShading?.background === undefined ? '' : `/Background [${def.pdfShading.background.map(pn).join(' ')}] `) : `/Background [${def.background.map(pn).join(' ')}] `}`
          + `${def.bbox === undefined ? (def.pdfShading?.bbox === undefined ? '' : `/BBox [${def.pdfShading.bbox.map(pn).join(' ')}] `) : `/BBox [${def.bbox.map(pn).join(' ')}] `}`
          + `${def.antiAlias === undefined ? (def.pdfShading?.antiAlias === undefined ? '' : `/AntiAlias ${def.pdfShading.antiAlias ? 'true' : 'false'} `) : `/AntiAlias ${def.antiAlias ? 'true' : 'false'} `}`,
        )
        w.endObj()
        shadingObjects.set(shadingName, meshId)
        continue
      }

      if (def.type === 'retained-function') {
        const ids = def.functions.map(emitPdfFunction)
        const functionPdf = ids.length === 1 ? `${ids[0]} 0 R` : `[${ids.map(function (id) { return `${id} 0 R` }).join(' ')}]`
        const shadeId = alloc()
        w.writeDeferredDict(shadeId, [
          '/ShadingType 1',
          `/ColorSpace ${shadingColorSpacePdf(def.colorSpace)}`,
          `/Domain [${def.domain.map(pn).join(' ')}]`,
          `/Matrix [${def.shadingMatrix.map(pn).join(' ')}]`,
          ...(def.background === undefined ? [] : [`/Background [${def.background.map(pn).join(' ')}]`]),
          ...(def.bbox === undefined ? [] : [`/BBox [${def.bbox.map(pn).join(' ')}]`]),
          ...(def.antiAlias === undefined ? [] : [`/AntiAlias ${def.antiAlias ? 'true' : 'false'}`]),
          `/Function ${functionPdf}`,
        ])
        shadingObjects.set(shadingName, shadeId)
        continue
      }

      if (def.type === 'function') {
        // ShadingType 1: FunctionType 4 calculator or FunctionType 0 sampled
        // functions yield the shading's declared process components.
        const fnId = alloc()
        if (def.function.kind === 'sampled') {
          const sampled = def.function
          const encode = sampled.encode === undefined ? '' : `/Encode [${sampled.encode.map(pn).join(' ')}] `
          const decode = sampled.decode === undefined ? '' : `/Decode [${sampled.decode.map(pn).join(' ')}] `
          w.beginObj(fnId)
          writeStream(
            fnId,
            encodeSampledFunctionData(sampled),
            `/FunctionType 0 /Domain [${pn(def.domain[0])} ${pn(def.domain[1])} ${pn(def.domain[2])} ${pn(def.domain[3])}] `
            + `/Range [${sampled.range.map(pn).join(' ')}] /Size [${sampled.size[0]} ${sampled.size[1]}] `
            + `/BitsPerSample ${sampled.bitsPerSample} ${encode}${decode}`,
          )
          w.endObj()
        } else {
          w.beginObj(fnId)
          writeStream(
            fnId, encodeAscii(def.function.expression),
            `/FunctionType 4 /Domain [${pn(def.domain[0])} ${pn(def.domain[1])} ${pn(def.domain[2])} ${pn(def.domain[3])}] `
            + `/Range [${def.cmyk ? '0 1 0 1 0 1 0 1' : '0 1 0 1 0 1'}] `,
          )
          w.endObj()
        }
        const shadeId = alloc()
        w.writeDeferredDict(shadeId, [
          '/ShadingType 1',
          `/ColorSpace ${def.cmyk ? '/DeviceCMYK' : '/DeviceRGB'}`,
          `/Domain [${pn(def.domain[0])} ${pn(def.domain[1])} ${pn(def.domain[2])} ${pn(def.domain[3])}]`,
          `/Matrix [${def.matrix.map(pn).join(' ')}]`,
          ...(def.background === undefined ? [] : [`/Background [${def.background.map(pn).join(' ')}]`]),
          ...(def.bbox === undefined ? [] : [`/BBox [${def.bbox.map(pn).join(' ')}]`]),
          ...(def.antiAlias === undefined ? [] : [`/AntiAlias ${def.antiAlias ? 'true' : 'false'}`]),
          `/Function ${fnId} 0 R`,
        ])
        shadingObjects.set(shadingName, shadeId)
        continue
      }

      // Generate or retain the Function object(s).
      let functionPdf: string
      const retainedFunctions = pdfx === undefined ? def.pdfShading?.functions : undefined
      if (retainedFunctions !== undefined) {
        const ids = retainedFunctions.map(emitPdfFunction)
        functionPdf = ids.length === 1 ? `${ids[0]} 0 R` : `[${ids.map(function (id) { return `${id} 0 R` }).join(' ')}]`
      } else {
        const funcId = buildShadingFunction(
          w,
          alloc,
          def.stops,
          pdfx === undefined ? undefined : this.pdfxColorTransform,
          this.pdfxOutputProfile?.renderingIntent,
        )
        functionPdf = `${funcId} 0 R`
      }

      // Shading object
      let coordsStr = ''
      for (let ci = 0; ci < def.coords.length; ci++) {
        if (ci > 0) coordsStr += ' '
        coordsStr += pn(def.coords[ci]!)
      }
      const shadingId = alloc()
      const shadingType = def.type === 'axial' ? '2' : '3'
      const sourceBackground = def.pdfShading?.background
      let shadingBackground = sourceBackground
      if (pdfx !== undefined && sourceBackground !== undefined) {
        if (def.pdfShading?.colorSpace?.kind === 'cmyk' && sourceBackground.length === 4) {
          shadingBackground = sourceBackground
        } else if (sourceBackground.length === 3) {
          const transform = this.pdfxColorTransform
          if (transform === undefined) throw new Error('PDF/X output profile transform is not initialized')
          shadingBackground = iccOutputCmyk(
            transform,
            this.pdfxOutputProfile?.renderingIntent,
            sourceBackground[0]!, sourceBackground[1]!, sourceBackground[2]!,
          )
        } else {
          throw new Error(`${pdfx} cannot convert a retained shading Background without an RGB or native CMYK process color`)
        }
      }
      w.writeDeferredDict(shadingId, [
        `/ShadingType ${shadingType}`,
        `/ColorSpace ${pdfx ? '/DeviceCMYK' : def.pdfShading?.colorSpace === undefined ? PDF_SVG_GRADIENT_COLORSPACE : shadingColorSpacePdf(def.pdfShading.colorSpace)}`,
        `/Coords [${coordsStr}]`,
        ...(def.pdfShading === undefined ? [] : [`/Domain [${def.pdfShading.domain.map(pn).join(' ')}]`]),
        ...(shadingBackground === undefined ? [] : [`/Background [${shadingBackground.map(pn).join(' ')}]`]),
        ...((def.pdfShading?.native?.bbox ?? def.pdfShading?.bbox) === undefined ? [] : [`/BBox [${(def.pdfShading?.native?.bbox ?? def.pdfShading!.bbox)!.map(pn).join(' ')}]`]),
        ...(def.pdfShading?.antiAlias === undefined ? [] : [`/AntiAlias ${def.pdfShading.antiAlias ? 'true' : 'false'}`]),
        `/Function ${functionPdf}`,
        `/Extend [${def.extend[0] ? 'true' : 'false'} ${def.extend[1] ? 'true' : 'false'}]`,
      ])

      shadingObjects.set(shadingName, shadingId)
    }

    // ─── Gradient Pattern object generation (for SVG gradient fill/stroke) ───
    const patternObjects = new Map<string, number>()  // "/P0" → object id
    for (let pi = 0; pi < this.gradientPatternDefs.length; pi++) {
      const def = this.gradientPatternDefs[pi]!
      const patternId = alloc()
      const shadingName = `/Sh${def.shadingIndex}`
      const shadingId = shadingObjects.get(shadingName)
      if (!shadingId) {
        throw new Error(`Shading not found for gradient pattern: ${shadingName}`)
      }
      w.writeDeferredDict(patternId, [
        '/Type /Pattern',
        '/PatternType 2',
        `/Shading ${shadingId} 0 R`,
        ...(def.matrix === undefined ? [] : [`/Matrix [${def.matrix.map(pn).join(' ')}]`]),
      ])
      patternObjects.set(def.name, patternId)
    }

    // ─── Image XObject generation ───
    const optionImageReferences = collectPdfOptionImageReferences({
      catalog: this.catalogModel,
      collection: this.collection,
      pageOptions: this.pageDataList,
    })
    const pageThumbnailNames = new Array<string | null>(this.pageDataList.length).fill(null)
    for (let referenceIndex = 0; referenceIndex < optionImageReferences.length; referenceIndex++) {
      const reference = optionImageReferences[referenceIndex]!
      const imageName = this.ensureImageXObject(reference.imageId, reference.usage)
      if (reference.usage === 'page thumbnail') pageThumbnailNames[reference.pageIndex] = imageName
    }
    const imageObjects = new Map<string, number>()  // "/Im0" → object id
    const mainImageIds = new Array<number>(this.imageXObjects.length)
    for (let ii = 0; ii < this.imageXObjects.length; ii++) {
      const id = alloc()
      mainImageIds[ii] = id
      imageObjects.set(this.imageXObjects[ii]!.name, id)
    }
    for (let ii = 0; ii < this.imageXObjects.length; ii++) {
      const img = this.imageXObjects[ii]!
      const requestedInterpolation = this.imageInterpolation.get(img.imageId) ?? img.interpolate
      const interpolation = requestedInterpolation ?? (this.pdfaConformance === undefined ? true : undefined)
      const interpolationEntry = interpolation === undefined ? '' : `/Interpolate ${interpolation ? 'true' : 'false'} `

      // SMask object (alpha channel)
      let smaskId = 0
      if (img.smaskData) {
        smaskId = alloc()
        w.beginObj(smaskId)
        let smaskDict = `/Subtype /Image /Width ${img.smaskWidth} /Height ${img.smaskHeight} /ColorSpace /DeviceGray /BitsPerComponent ${img.smaskBpc} /Filter /FlateDecode ${interpolationEntry}`
        if (img.smaskDecodeParms) smaskDict += img.smaskDecodeParms + ' '
        writeStream(smaskId, img.smaskData, smaskDict)
        w.endObj()
      }

      let maskId = 0
      if (img.maskData) {
        maskId = alloc()
        w.beginObj(maskId)
        const maskDict = `/Subtype /Image /Width ${img.maskWidth} /Height ${img.maskHeight} /ImageMask true /BitsPerComponent 1 /Filter /FlateDecode /Decode [0 1] ${interpolationEntry}`
        writeStream(maskId, img.maskData, maskDict)
        w.endObj()
      }

      // Main image object
      const imgId = mainImageIds[ii]!
      let extraDict: string
      if (img.imageMask === true) {
        extraDict = `/Subtype /Image /Width ${img.width} /Height ${img.height} /ImageMask true /BitsPerComponent 1 /Filter /${img.filter} `
      } else {
        const cs = img.colorSpace[0] === '[' ? img.colorSpace : `/${img.colorSpace}`
        extraDict = `/Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent ${img.bitsPerComponent} /Filter /${img.filter} `
      }
      if (img.decodeParms) extraDict += img.decodeParms + ' '
      if (img.decode) extraDict += img.decode + ' '
      if (img.mask) extraDict += img.mask + ' '
      if (maskId) extraDict += `/Mask ${maskId} 0 R `
      const intent = this.imageIntent.get(img.imageId)
      if (intent !== undefined) extraDict += `/Intent /${intent} `
      else if (img.intent) extraDict += img.intent + ' '
      extraDict += interpolationEntry
      if (smaskId) extraDict += `/SMask ${smaskId} 0 R `
      if (img.smaskInData !== undefined) extraDict += `/SMaskInData ${img.smaskInData} `
      const webCaptureIdentifier = webCaptureState.imageIdentifiers.get(img.imageId)
      if (webCaptureIdentifier !== undefined) extraDict += `/ID <${bytesToHex(webCaptureIdentifier)}> `
      const alternates = this.imageAlternates.get(img.imageId)
      if (alternates !== undefined && alternates.length > 0) {
        const entries: string[] = []
        for (let ai = 0; ai < alternates.length; ai++) {
          const alternate = alternates[ai]!
          const alternateName = this.imageRefMap.get(alternate.imageId)
          const alternateId = alternateName === undefined ? undefined : imageObjects.get(alternateName)
          if (alternateId === undefined) throw new Error(`Alternate image resource is not registered: ${alternate.imageId}`)
          entries.push(`<< /Image ${alternateId} 0 R${alternate.defaultForPrinting ? ' /DefaultForPrinting true' : ''} >>`)
        }
        extraDict += `/Alternates [${entries.join(' ')}] `
      }
      const opi = this.imageOpi.get(img.imageId)
      if (opi !== undefined) extraDict += `/OPI << /${opi.version} ${rawPdfDictionaryPdf(opi.entries)} >> `
      const measure = this.imageMeasurements.get(img.imageId)
      if (measure !== undefined) extraDict += `/Measure ${rawPdfDictionaryPdf(pdfMeasurementToRaw(measure))} `
      const pointData = this.imagePointData.get(img.imageId)
      if (pointData !== undefined) extraDict += `/PtData ${rawPdfValuePdf(pdfPointDataToRaw(pointData))} `
      w.beginObj(imgId)
      writeStream(imgId, img.data, extraDict)
      w.endObj()

    }

    // ─── Resource dictionary string ───
    let fontEntries = ''
    for (const [name, id] of fontObjects) {
      if (fontEntries) fontEntries += ' '
      fontEntries += `${name} ${id} 0 R`
    }
    let shEntries = ''
    for (const [name, id] of shadingObjects) {
      if (shEntries) shEntries += ' '
      shEntries += `${name} ${id} 0 R`
    }

    // ─── Transparency groups + soft masks (A6.2/A6.3) ───
    // Captured group ops are materialized on demand into /Group Form XObjects.
    // A transparency group's body may reference nested transparency groups, so
    // materialization recurses; ids are allocated up front and bodies written
    // after the shared resources dictionary is final. Soft masks add an
    // ExtGState carrying /SMask referencing the mask group's Form XObject.
    interface TransparencyFormSlot { id: number, name: string, body: string, x: number, y: number, width: number, height: number, colorSpace?: PdfProcessColorSpaceDef, isolated: boolean, knockout: boolean }
    const transparencyFormBodies: TransparencyFormSlot[] = []
    const transparencyFormByDef = new Map<number, { id: number, name: string }>()
    interface ImportedFormSlot { id: number, name: string, body: string, form: PdfFormXObjectDef, semanticId: number }
    const importedFormBodies: ImportedFormSlot[] = []
    const importedFormByDef = new Map<number, { id: number, name: string }>()
    const sourceVectorFormIds = new Array<number>(this.sourceVectorDefs.length)
    const sourceVectorFormNames = new Array<string>(this.sourceVectorDefs.length)
    for (let i = 0; i < this.sourceVectorDefs.length; i++) {
      sourceVectorFormIds[i] = alloc()
      sourceVectorFormNames[i] = `/Sv${i}`
    }
    const softMaskGsMap = new Map<string, string>()
    // Soft-mask /TR transfer functions, deduplicated by their normative model.
    const softMaskTransferMap = new Map<string, number>()
    const ensureSoftMaskTransfer = (transfer: RenderTransferFunction): number => {
      const key = JSON.stringify(transfer)
      const existing = softMaskTransferMap.get(key)
      if (existing !== undefined) return existing
      const trId = 'functionType' in transfer
        ? emitPdfFunction(transfer)
        : emitPdfFunction({ functionType: 4, domain: [0, 1], range: [0, 1], expression: transfer.expression })
      softMaskTransferMap.set(key, trId)
      return trId
    }
    let serializeCapturedOps: (ops: PdfOp[]) => string
    const ensureTransparencyForm = (defIndex: number): { id: number, name: string } => {
      const existing = transparencyFormByDef.get(defIndex)
      if (existing !== undefined) return existing
      const def = this.transparencyGroupDefs[defIndex]!
      const id = alloc()
      const name = `/Tp${transparencyFormBodies.length}`
      const ref = { id, name }
      transparencyFormByDef.set(defIndex, ref)
      // Reserve the slot before recursing so nested groups get distinct names.
      const slot: TransparencyFormSlot = { id, name, body: '', x: def.x, y: def.y, width: def.width, height: def.height, colorSpace: def.colorSpace, isolated: def.isolated, knockout: def.knockout }
      transparencyFormBodies.push(slot)
      slot.body = serializeCapturedOps(def.ops)
      return ref
    }
    const ensureImportedForm = (defIndex: number): { id: number, name: string } => {
      const existing = importedFormByDef.get(defIndex)
      if (existing !== undefined) return existing
      const def = this.importedFormDefs[defIndex]!
      const id = alloc()
      const name = `/Fx${importedFormBodies.length}`
      const ref = { id, name }
      importedFormByDef.set(defIndex, ref)
      const slot: ImportedFormSlot = { id, name, body: '', form: def.form, semanticId: def.semanticId }
      importedFormBodies.push(slot)
      slot.body = serializeCapturedOps(def.ops)
      return ref
    }
    const emitTransparencyInvoke = (op: TransparencyInvokeOp): string => {
      const content = ensureTransparencyForm(op.groupIndex)
      const needsCa = op.opacity != null && op.opacity < 1
      const needsMask = op.softMaskIndex >= 0
      let gsName: string | null = null
      if (needsCa || needsMask) {
        let maskDict = ''
        if (needsMask) {
          const mask = ensureTransparencyForm(op.softMaskIndex)
          const bc = op.softMaskBackdrop
          const bcStr = bc ? ` /BC [${pn(bc[0])} ${pn(bc[1])} ${pn(bc[2])}]` : ''
          const trStr = op.softMaskTransfer === undefined ? ''
            : op.softMaskTransfer === 'Identity' ? ' /TR /Identity'
              : ` /TR ${ensureSoftMaskTransfer(op.softMaskTransfer)} 0 R`
          maskDict = `/SMask << /Type /Mask /S /${op.softMaskType} /G ${mask.id} 0 R${bcStr}${trStr} >>`
        }
        const caStr = needsCa ? `/ca ${pn(op.opacity!)} /CA ${pn(op.opacity!)}` : ''
        const key = `tp:${caStr}|${maskDict}`
        const cached = softMaskGsMap.get(key)
        if (cached !== undefined) {
          gsName = cached
        } else {
          gsName = `/GS${this.gsCounter++}`
          const dictEntries = ['/Type /ExtGState']
          if (caStr) dictEntries.push(caStr)
          if (maskDict) dictEntries.push(maskDict)
          const gsId = alloc()
          w.writeDeferredDict(gsId, dictEntries)
          gsObjects.set(gsName, gsId)
          softMaskGsMap.set(key, gsName)
        }
      }
      if (gsName) return `q ${gsName} gs ${content.name} Do Q`
      return `q ${content.name} Do Q`
    }
    const emitFormInvoke = (op: FormInvokeOp): string => {
      const content = ensureImportedForm(op.formIndex)
      const form = this.importedFormDefs[op.formIndex]!.form
      const b = form.bbox
      // RenderGroup.affineTransform is the canonical local-to-parent mapping
      // shared by every backend. The retained Form still carries its original
      // /Matrix and its body maps local top-down coordinates back into the
      // original BBox, so cancel those definition-space transforms at the Do
      // site instead of reapplying the source page's placement.
      const sourceToLocal: PdfMatrix = [1, 0, 0, -1, b[0], b[3]]
      const m = invertPdfMatrix(multiplyPdfMatrix(form.matrix, sourceToLocal))
      return `q ${m.map(pn).join(' ')} cm ${content.name} Do Q`
    }
    const emitSourceVectorInvoke = (op: SourceVectorInvokeOp): string => {
      const name = sourceVectorFormNames[op.definitionIndex]
      if (name === undefined) throw new Error(`PDF source vector definition ${op.definitionIndex} is missing`)
      return `q ${op.matrix.map(pn).join(' ')} cm ${name} Do Q`
    }
    serializeCapturedOps = (ops: PdfOp[]): string => {
      const parts: string[] = []
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!
        if (typeof op === 'string') parts.push(op)
        else if (op.type === 'shading') parts.push(`/Sh${op.shadingIndex} sh`)
        else if (op.type === 'textGlyphs') parts.push(buildTextShowOps(op, this.fontGidRemap.get(op.fontId)))
        else if (op.type === 'transparencyInvoke') parts.push(emitTransparencyInvoke(op))
        else if (op.type === 'formInvoke') parts.push(emitFormInvoke(op))
        else if (op.type === 'sourceVectorInvoke') parts.push(emitSourceVectorInvoke(op))
        else throw new Error('Content-group markers are not valid inside transparency groups')
      }
      return parts.join('\n')
    }

    // Pass 1: serialize every page's ops into segments; content groups
    // (one per top-level page child) that repeat with identical bytes on the
    // same page geometry become shared Form XObjects (A6.9 deduplication).
    interface FormXObjectDef { body: string, width: number, height: number, count: number, name: string | null }
    const formXObjectMap = new Map<string, FormXObjectDef>()
    const formXObjectDefs: FormXObjectDef[] = []
    const pageSegments: (string | FormXObjectDef)[][] = []
    for (let pi = 0; pi < this.pageDataList.length; pi++) {
      const page = this.pageDataList[pi]!
      const segments: (string | FormXObjectDef)[] = []
      let groupParts: string[] | null = null
      for (let oi = 0; oi < page.ops.length; oi++) {
        const op = page.ops[oi]!
        let text: string
        if (typeof op === 'string') {
          text = op
        } else if (op.type === 'shading') {
          text = `/Sh${op.shadingIndex} sh`
        } else if (op.type === 'textGlyphs') {
          text = buildTextShowOps(op, this.fontGidRemap.get(op.fontId))
        } else if (op.type === 'transparencyInvoke') {
          text = emitTransparencyInvoke(op)
        } else if (op.type === 'formInvoke') {
          text = emitFormInvoke(op)
        } else if (op.type === 'sourceVectorInvoke') {
          text = emitSourceVectorInvoke(op)
        } else if (op.type === 'groupStart') {
          groupParts = []
          continue
        } else {
          const body = (groupParts ?? []).join('\n')
          groupParts = null
          if (this.tagged && /\/MCID\s+\d+/.test(body)) {
            segments.push(body)
            continue
          }
          const key = `${pn(page.width)}x${pn(page.height)}|${body}`
          let def = formXObjectMap.get(key)
          if (def === undefined) {
            def = { body, width: page.width, height: page.height, count: 0, name: null }
            formXObjectMap.set(key, def)
          }
          def.count++
          if (def.count === 2) {
            def.name = `/Fm${formXObjectDefs.length}`
            formXObjectDefs.push(def)
          }
          segments.push(def)
          continue
        }
        if (groupParts !== null) groupParts.push(text)
        else segments.push(text)
      }
      pageSegments.push(segments)
    }

    // Tiling-cell groups may allocate transparency or imported Form XObjects.
    // Serialize them before freezing the shared ExtGState/XObject resources.
    const tilingPatternBodies = this.tilingPatternPdfDefs.map(function (def) {
      return serializeCapturedOps(def.ops)
    })

    // gsObjects is now complete (pass 1 may have added soft-mask ExtGStates).
    let gsEntries = ''
    for (const [name, id] of gsObjects) {
      if (gsEntries) gsEntries += ' '
      gsEntries += `${name} ${id} 0 R`
    }

    // IDs for the shared Form XObjects (bodies are written after the
    // document resources dictionary is final)
    const formXObjectIds: number[] = []
    for (let i = 0; i < formXObjectDefs.length; i++) formXObjectIds.push(alloc())

    let xobjEntries = ''
    for (const [name, id] of imageObjects) {
      if (xobjEntries) xobjEntries += ' '
      xobjEntries += `${name} ${id} 0 R`
    }
    for (let i = 0; i < formXObjectDefs.length; i++) {
      if (xobjEntries) xobjEntries += ' '
      xobjEntries += `${formXObjectDefs[i]!.name} ${formXObjectIds[i]} 0 R`
    }
    for (let i = 0; i < transparencyFormBodies.length; i++) {
      if (xobjEntries) xobjEntries += ' '
      xobjEntries += `${transparencyFormBodies[i]!.name} ${transparencyFormBodies[i]!.id} 0 R`
    }
    for (let i = 0; i < importedFormBodies.length; i++) {
      if (xobjEntries) xobjEntries += ' '
      xobjEntries += `${importedFormBodies[i]!.name} ${importedFormBodies[i]!.id} 0 R`
    }
    for (let i = 0; i < sourceVectorFormIds.length; i++) {
      if (xobjEntries) xobjEntries += ' '
      xobjEntries += `${sourceVectorFormNames[i]} ${sourceVectorFormIds[i]} 0 R`
    }

    // ─── Tiling pattern object generation ───
    // The cell resources reference the already-emitted shared objects
    // (gradient patterns, images, graphics states); nested tiling patterns
    // do not exist in the model, so no self reference is possible.
    for (let ti = 0; ti < this.tilingPatternPdfDefs.length; ti++) {
      const def = this.tilingPatternPdfDefs[ti]!
      let cellResources = '<< '
      {
        let cellGs = ''
        for (const [name, id] of gsObjects) {
          if (cellGs) cellGs += ' '
          cellGs += `${name} ${id} 0 R`
        }
        let cellPatterns = ''
        for (const [name, id] of patternObjects) {
          if (cellPatterns) cellPatterns += ' '
          cellPatterns += `${name} ${id} 0 R`
        }
        let cellSh = ''
        for (const [name, id] of shadingObjects) {
          if (cellSh) cellSh += ' '
          cellSh += `${name} ${id} 0 R`
        }
        const cellXobj = xobjEntries
        let cellProperties = ''
        for (const [name, id] of optionalContentObjects) {
          if (cellProperties) cellProperties += ' '
          cellProperties += `${name} ${id} 0 R`
        }
        if (cellGs) cellResources += `/ExtGState << ${cellGs} >> `
        let cellFonts = ''
        for (const [, refName] of this.fontRefMap) {
          const id = fontObjects.get(refName)
          if (id !== undefined) cellFonts += `${refName} ${id} 0 R `
        }
        if (cellFonts) cellResources += `/Font << ${cellFonts}>> `
        if (pdfa !== undefined) {
          const defaultCmyk = colorSpaceObjects.get('/DefaultCMYK')
          if (defaultCmyk === undefined) throw new Error(`${pdfa} DefaultCMYK resource is not initialized`)
          cellResources += `/ColorSpace << /DefaultCMYK ${defaultCmyk} 0 R >> `
        }
        if (cellSh) cellResources += `/Shading << ${cellSh} >> `
        if (cellPatterns) cellResources += `/Pattern << ${cellPatterns} >> `
        if (cellXobj) cellResources += `/XObject << ${cellXobj} >> `
        if (cellProperties) cellResources += `/Properties << ${cellProperties} >> `
      }
      cellResources += '>>'
      const cellBytes = new TextEncoder().encode(tilingPatternBodies[ti]!)
      const patternId = alloc()
      w.beginObj(patternId)
      writeStream(
        patternId, cellBytes,
        `/Type /Pattern /PatternType 1 /PaintType ${def.paintType} /TilingType ${def.tilingType} `
        + `/BBox [${pn(def.bbox[0])} ${pn(def.bbox[1])} ${pn(def.bbox[2])} ${pn(def.bbox[3])}] `
        + `/XStep ${pn(def.xStep)} /YStep ${pn(def.yStep)} `
        + `/Matrix [${pn(def.matrix[0])} ${pn(def.matrix[1])} ${pn(def.matrix[2])} ${pn(def.matrix[3])} ${pn(def.matrix[4])} ${pn(def.matrix[5])}] `
        + `/Resources ${cellResources} `,
      )
      w.endObj()
      patternObjects.set(def.name, patternId)
    }

    let patternEntries = ''
    for (const [name, id] of patternObjects) {
      if (patternEntries) patternEntries += ' '
      patternEntries += `${name} ${id} 0 R`
    }
    let colorSpaceEntries = ''
    for (const [name, id] of colorSpaceObjects) {
      if (colorSpaceEntries) colorSpaceEntries += ' '
      colorSpaceEntries += `${name} ${id} 0 R`
    }
    let propertyEntries = ''
    for (const [name, id] of optionalContentObjects) {
      if (propertyEntries) propertyEntries += ' '
      propertyEntries += `${name} ${id} 0 R`
    }

    const resourceEntries: string[] = []
    if (fontEntries) resourceEntries.push(`/Font << ${fontEntries} >>`)
    if (gsEntries) resourceEntries.push(`/ExtGState << ${gsEntries} >>`)
    if (shEntries) resourceEntries.push(`/Shading << ${shEntries} >>`)
    if (patternEntries) resourceEntries.push(`/Pattern << ${patternEntries} >>`)
    if (colorSpaceEntries) resourceEntries.push(`/ColorSpace << ${colorSpaceEntries} >>`)
    if (propertyEntries) resourceEntries.push(`/Properties << ${propertyEntries} >>`)
    if (xobjEntries) resourceEntries.push(`/XObject << ${xobjEntries} >>`)
    const resourcesStr = `<< ${resourceEntries.join(' ')} >>`
    const resourcesId = alloc()
    w.writeDeferredDict(resourcesId, resourceEntries)
    const resourcesRef = `${resourcesId} 0 R`

    // Shared Form XObjects for deduplicated content groups
    for (let i = 0; i < formXObjectDefs.length; i++) {
      const def = formXObjectDefs[i]!
      const formId = formXObjectIds[i]!
      w.beginObj(formId)
      writeStream(
        formId, encodeAscii(def.body),
        `/Type /XObject /Subtype /Form /BBox [0 0 ${pn(def.width)} ${pn(def.height)}] /Resources ${resourcesRef} `,
      )
      w.endObj()
    }

    // Immutable PDF-source vectors remain reusable Form XObjects. Their
    // placement matrices stay in page content, preserving source sharing.
    for (let i = 0; i < this.sourceVectorDefs.length; i++) {
      const def = this.sourceVectorDefs[i]!
      const id = sourceVectorFormIds[i]!
      w.beginObj(id)
      writeStream(
        id, encodeAscii(def.body),
        `/Type /XObject /Subtype /Form /BBox [${def.bbox.map(pn).join(' ')}] /Resources << >> `,
      )
      w.endObj()
    }

    // Transparency group Form XObjects (A6.2/A6.3): content + soft-mask groups.
    for (let i = 0; i < transparencyFormBodies.length; i++) {
      const slot = transparencyFormBodies[i]!
      const groupColorSpace = slot.colorSpace === undefined ? '/DeviceRGB' : processColorSpacePdf(slot.colorSpace)
      const groupDict = `/Group << /Type /Group /S /Transparency /CS ${groupColorSpace} /I ${slot.isolated ? 'true' : 'false'} /K ${slot.knockout ? 'true' : 'false'} >>`
      w.beginObj(slot.id)
      writeStream(
        slot.id, encodeAscii(slot.body),
        `/Type /XObject /Subtype /Form /BBox [${pn(slot.x)} ${pn(slot.y)} ${pn(slot.x + slot.width)} ${pn(slot.y + slot.height)}] ${groupDict} /Resources ${resourcesRef} `,
      )
      w.endObj()
    }

    // Preserved imported Form XObjects. The generated body uses top-down local
    // coordinates, so the leading matrix maps it back into the original form
    // space before the retained Form /Matrix is applied.
    const formStructParents = new Map<number, { key: number, formId: number, mcidToStructElem: number[] }>()
    for (let i = 0; i < importedFormBodies.length; i++) {
      const slot = importedFormBodies[i]!
      const mcidToStructElem: number[] = []
      for (let si = 0; si < this.structElements.length; si++) {
        const mcids = this.structElements[si]!.mcids
        for (let mi = 0; mi < mcids.length; mi++) {
          const reference = mcids[mi]!
          if (reference.formSemanticId === slot.semanticId) mcidToStructElem[reference.mcid] = si
        }
      }
      if (mcidToStructElem.length > 0) {
        formStructParents.set(slot.semanticId, { key: nextStructureParentKey++, formId: slot.id, mcidToStructElem })
      }
    }
    for (let i = 0; i < importedFormBodies.length; i++) {
      const slot = importedFormBodies[i]!
      const form = slot.form
      const b = form.bbox
      const body = `${pn(1)} 0 0 -1 ${pn(b[0])} ${pn(b[3])} cm\n${slot.body}`
      let extra = ''
      if (form.formType !== undefined) extra += `/FormType ${form.formType} `
      if (form.group !== undefined) extra += `/Group ${rawPdfDictionaryPdf(form.group)} `
      if (form.reference !== undefined) extra += `/Ref ${rawPdfDictionaryPdf(form.reference)} `
      if (form.metadata !== undefined) {
        validatePdfMetadataStreamDef(form.metadata, 'Form XObject')
        extra += `/Metadata ${rawPdfValuePdf(form.metadata)} `
      }
      if (form.pieceInfo !== undefined) extra += `/PieceInfo ${rawPdfDictionaryPdf(form.pieceInfo)} `
      if (form.lastModified !== undefined) extra += `/LastModified ${rawPdfValuePdf(form.lastModified)} `
      const formParentTree = formStructParents.get(slot.semanticId)
      if (formParentTree !== undefined) {
        if (form.structParent !== undefined || form.structParents !== undefined) throw new Error('PDF tagged Form owns its StructParents entry')
        extra += `/StructParents ${formParentTree.key} `
      } else {
        if (form.structParent !== undefined) extra += `/StructParent ${form.structParent} `
        if (form.structParents !== undefined) extra += `/StructParents ${form.structParents} `
      }
      if (form.opi !== undefined) {
        validatePdfOpiMetadata(form.opi, `Form XObject ${slot.semanticId}`)
        extra += `/OPI << /${form.opi.version} ${rawPdfDictionaryPdf(form.opi.entries)} >> `
      }
      if (form.name !== undefined) extra += `/Name ${encodePdfName(form.name)} `
      if (form.measure !== undefined) extra += `/Measure ${rawPdfDictionaryPdf(pdfMeasurementToRaw(form.measure))} `
      if (form.pointData !== undefined) extra += `/PtData ${rawPdfValuePdf(pdfPointDataToRaw(form.pointData))} `
      w.beginObj(slot.id)
      writeStream(
        slot.id, encodeAscii(body),
        `/Type /XObject /Subtype /Form /BBox [${b.map(pn).join(' ')}] `
        + `/Matrix [${form.matrix.map(pn).join(' ')}] /Resources ${resourcesRef} ${extra}`,
      )
      w.endObj()
    }

    // Allocate the complete hierarchy before pages so every page can point to
    // its leaf DPart and every node can carry its exact indirect Parent link.
    const preparedDPartHierarchy = preparePdfDocumentPartHierarchy(
      this.documentPartHierarchy,
      this.documentParts,
      this.pageDataList.length,
      alloc,
    )
    const dpartIdByPage = preparedDPartHierarchy?.pageNodeIds
      ?? new Array(this.pageDataList.length).fill(0)
    actionDocumentPartIds = preparedDPartHierarchy?.actionNodeIds ?? []

    const articleThreads = writeArticleThreads(this.articleThreads, w, alloc, pageIds, this.pageDataList, rawPdfValuePdf)
    actionArticleThreadIds = articleThreads.threadIds
    actionArticleBeadIds = articleThreads.beadIdsByThread
    const explicitAnnotationData = buildPdfAnnotationData(this.annotations, this.pageDataList.length, alloc)
    actionAnnotationIds = explicitAnnotationData.ids
    actionRichMediaInstanceIds = explicitAnnotationData.richMediaInstanceIds

    // ─── AcroForm fields (widget annotations + appearance streams) ───
    const fieldIdsByPage = new Map<number, number[]>()
    const fieldAppearanceStateById = new Map<number, string | null>()
    const allFieldIds: number[] = []        // widget annotations (page /Annots)
    const allAcroFormFieldIds: number[] = [] // top-level fields (catalog /AcroForm /Fields)
    for (let i = 0; i < this.annotations.length; i++) {
      const annotation = this.annotations[i]!
      if (isPreservedAnnotation(annotation) && annotation.subtype === 'Widget') {
        allAcroFormFieldIds.push(explicitAnnotationData.ids[i]!)
      }
    }
    const calculationOrderFields: { id: number, order: number }[] = []
    if (this.formFieldDefs.length > 0) {
      const usedNames = new Set<string>()
      const serializeAppearance = (ops: PdfOp[]): string => {
        const parts: string[] = []
        for (const op of ops) {
          if (typeof op === 'string') parts.push(op)
          else if (op.type === 'shading') parts.push(`/Sh${op.shadingIndex} sh`)
          else if (op.type === 'textGlyphs') parts.push(buildTextShowOps(op, this.fontGidRemap.get(op.fontId)))
          else if (op.type === 'sourceVectorInvoke') parts.push(emitSourceVectorInvoke(op))
          else throw new Error('Group markers are not valid inside field appearances')
        }
        return parts.join('\n')
      }
      const writeAppearance = (def: FormFieldRecord, ops: PdfOp[]): number => {
        const id = alloc()
        w.beginObj(id)
        writeStream(
          id, encodeAscii(serializeAppearance(ops)),
          `/Type /XObject /Subtype /Form /BBox [0 0 ${pn(def.width)} ${pn(def.height)}] /Resources ${resourcesRef} `,
        )
        w.endObj()
        return id
      }
      const registerFieldId = (fieldId: number, pageIndex: number, appearanceState: string | null): void => {
        allFieldIds.push(fieldId)
        fieldAppearanceStateById.set(fieldId, appearanceState)
        let list = fieldIdsByPage.get(pageIndex)
        if (list === undefined) {
          list = []
          fieldIdsByPage.set(pageIndex, list)
        }
        list.push(fieldId)
      }
      const rectOf = (def: FormFieldRecord): string => {
        const page = this.pageDataList[def.pageIndex]!
        const y1 = page.height - def.y
        const y2 = page.height - (def.y + def.height)
        return `[${pn(def.x)} ${pn(y2)} ${pn(def.x + def.width)} ${pn(y1)}]`
      }
      const writeFieldValueStream = (data: Uint8Array): string => {
        const id = alloc()
        w.beginObj(id)
        writeStream(id, data)
        w.endObj()
        return `${id} 0 R`
      }
      const registerCalculationOrder = (id: number, order: number | undefined): void => {
        if (order === undefined) return
        if (!Number.isInteger(order) || order < 0) throw new Error('Form field calculationOrder must be a non-negative integer')
        calculationOrderFields.push({ id, order })
      }
      const defaultAppearance = (def: FormFieldRecord): string => {
        const fontName = pdfa === undefined ? '/Helv' : this.fontRefMap.get(def.field.fontId)
        if (fontName === undefined) throw new Error(`${pdfa} form field font is not embedded: ${def.field.fontId}`)
        return `(${fontName} ${pn(def.field.fontSize)} Tf 0 g)`
      }

      // Radio buttons that share a name form one exclusive group; every other
      // field is standalone. Partition while preserving order.
      const radioGroups = new Map<string, FormFieldRecord[]>()
      const singles: FormFieldRecord[] = []
      for (const def of this.formFieldDefs) {
        if (def.field.fieldType === 'radio') {
          let group = radioGroups.get(def.field.name)
          if (group === undefined) {
            group = []
            radioGroups.set(def.field.name, group)
          }
          group.push(def)
        } else {
          if (usedNames.has(def.field.name)) throw new Error(`Duplicate form field name: ${def.field.name}`)
          usedNames.add(def.field.name)
          singles.push(def)
        }
      }
      for (const name of radioGroups.keys()) {
        if (usedNames.has(name)) throw new Error(`Duplicate form field name: ${name}`)
        usedNames.add(name)
      }

      // ── Radio groups ──
      for (const [name, group] of radioGroups) {
        for (const def of group) {
          if (this.pageDataList[def.pageIndex] === undefined) throw new Error('Form field recorded outside a page')
        }
        const fieldId = alloc()
        // The selected export value is whichever button is checked
        let selected: string | null = null
        for (const def of group) {
          if (def.field.checked === true) selected = def.field.exportValue ?? 'Yes'
        }
        const widgetIds: number[] = []
        for (const def of group) {
          const exportValue = def.field.exportValue ?? 'Yes'
          const onId = writeAppearance(def, def.onOps)
          const offId = writeAppearance(def, def.offOps!)
          const state = selected === exportValue ? `/${escapePdfNameBody(exportValue)}` : '/Off'
          const widgetId = alloc()
          w.writeDeferredDict(widgetId, [
            '/Type /Annot',
            '/Subtype /Widget',
            `/Parent ${fieldId} 0 R`,
            `/Rect ${rectOf(def)}`,
            `/P ${pageIds[def.pageIndex]} 0 R`,
            '/F 4',
            `/AS ${state}`,
            `/AP << /N << /${escapePdfNameBody(exportValue)} ${onId} 0 R /Off ${offId} 0 R >> >>`,
          ])
          widgetIds.push(widgetId)
          registerFieldId(widgetId, def.pageIndex, selected === exportValue ? exportValue : 'Off')
        }
        // Radio field: Radio flag (1<<15) + NoToggleToOff (1<<14)
        let flags = (1 << 15) | (1 << 14)
        if (group[0]!.field.readOnly === true) flags |= 1
        if (group[0]!.field.required === true) flags |= 2
        if (group[0]!.field.noExport === true) flags |= 4
        if (group[0]!.field.radiosInUnison === true) flags |= 1 << 25
        const fieldDict = [
          '/FT /Btn',
          `/T (${pdfEscapeString(name)})`,
          `/Ff ${flags}`,
          `/Kids [${widgetIds.map(id => `${id} 0 R`).join(' ')}]`,
          `/V ${selected !== null ? `/${escapePdfNameBody(selected)}` : '/Off'}`,
          `/DA ${defaultAppearance(group[0]!)}`,
        ]
        const groupAdditionalActions = group[0]!.field.additionalActions
        const serializedGroupAdditionalActions = groupAdditionalActions === undefined ? undefined : pdfFieldAdditionalActionsPdf(groupAdditionalActions)
        for (let i = 1; i < group.length; i++) {
          const actions = group[i]!.field.additionalActions
          const serialized = actions === undefined ? undefined : pdfFieldAdditionalActionsPdf(actions)
          if (serialized !== serializedGroupAdditionalActions) throw new Error(`Radio field ${name} widgets must define identical additional actions`)
        }
        if (serializedGroupAdditionalActions !== undefined) fieldDict.push(`/AA ${serializedGroupAdditionalActions}`)
        w.writeDeferredDict(fieldId, fieldDict)
        allAcroFormFieldIds.push(fieldId)
        registerCalculationOrder(fieldId, group[0]!.field.calculationOrder)
      }

      // ── Standalone fields ──
      for (const def of singles) {
        const page = this.pageDataList[def.pageIndex]
        if (!page) throw new Error('Form field recorded outside a page')
        const field = def.field
        const fieldId = alloc()
        const dict: string[] = [
          '/Type /Annot',
          '/Subtype /Widget',
          `/T (${pdfEscapeString(field.name)})`,
          `/Rect ${rectOf(def)}`,
          `/P ${pageIds[def.pageIndex]} 0 R`,
          '/F 4',
        ]
        let flags = 0
        let annotationAppearanceState: string | null = null
        if (field.readOnly === true) flags |= 1
        if (field.required === true) flags |= 2
        if (field.noExport === true) flags |= 4

        if (field.fieldType === 'checkbox') {
          const exportValue = field.exportValue ?? 'Yes'
          const onId = writeAppearance(def, def.onOps)
          const offId = writeAppearance(def, def.offOps!)
          const state = field.checked === true ? `/${escapePdfNameBody(exportValue)}` : '/Off'
          annotationAppearanceState = field.checked === true ? exportValue : 'Off'
          dict.push('/FT /Btn')
          dict.push(`/V ${state}`, `/AS ${state}`)
          dict.push(`/AP << /N << /${escapePdfNameBody(exportValue)} ${onId} 0 R /Off ${offId} 0 R >> >>`)
        } else if (field.fieldType === 'pushbutton') {
          flags |= 1 << 16 // Pushbutton
          const onId = writeAppearance(def, def.onOps)
          dict.push('/FT /Btn')
          dict.push(`/AP << /N ${onId} 0 R >>`)
          if (field.caption !== undefined) dict.push(`/MK << /CA (${pdfEscapeString(field.caption)}) >>`)
          if (field.action !== undefined) dict.push(`/A << /Type /Action /S /URI /URI (${pdfEscapeString(field.action)}) >>`)
        } else if (field.fieldType === 'signature') {
          const onId = writeAppearance(def, def.onOps)
          dict.push('/FT /Sig')
          dict.push(`/AP << /N ${onId} 0 R >>`)
        } else if (field.fieldType === 'dropdown' || field.fieldType === 'listbox') {
          if (field.fieldType === 'dropdown') {
            flags |= 1 << 17 // Combo
            if (field.editable === true) flags |= 1 << 18 // Edit
          } else if (field.multiSelect === true) {
            flags |= 1 << 21 // MultiSelect
          }
          if (field.sort === true) flags |= 1 << 19
          if (field.doNotSpellCheck === true) flags |= 1 << 22
          if (field.commitOnSelectionChange === true) flags |= 1 << 26
          const onId = writeAppearance(def, def.onOps)
          dict.push('/FT /Ch')
          const options = field.options ?? []
          const optStr = options.map(o => o.label === o.value
            ? `(${pdfEscapeString(o.value)})`
            : `[(${pdfEscapeString(o.value)}) (${pdfEscapeString(o.label)})]`).join(' ')
          dict.push(`/Opt [${optStr}]`)
          if (field.value !== undefined && field.value !== '') {
            const selected = field.fieldType === 'listbox' && field.multiSelect === true
              ? `[${field.value.split('\n').map(v => `(${pdfEscapeString(v)})`).join(' ')}]`
              : `(${pdfEscapeString(field.value)})`
            dict.push(`/V ${selected}`)
          }
          dict.push(`/AP << /N ${onId} 0 R >>`)
          dict.push(`/DA ${defaultAppearance(def)}`)
        } else {
          // text (/Tx)
          if (field.multiline === true) flags |= 1 << 12
          if (field.password === true) flags |= 1 << 13
          if (field.fileSelect === true) flags |= 1 << 20
          if (field.doNotSpellCheck === true) flags |= 1 << 22
          if (field.doNotScroll === true) flags |= 1 << 23
          if (field.comb === true) flags |= 1 << 24
          if (field.richText !== undefined || field.richTextStream !== undefined) flags |= 1 << 25
          if (field.fileSelect === true && (field.multiline === true || field.password === true)) {
            throw new Error('PDF text field FileSelect cannot be combined with Multiline or Password')
          }
          if (field.comb === true && (field.multiline === true || field.password === true || field.fileSelect === true || field.maxLength === undefined)) {
            throw new Error('PDF text field Comb requires MaxLen and forbids Multiline, Password, and FileSelect')
          }
          if (field.value !== undefined && field.valueStream !== undefined) throw new Error('PDF text field cannot define both value and valueStream')
          if (field.richText !== undefined && field.richTextStream !== undefined) throw new Error('PDF text field cannot define both richText and richTextStream')
          const onId = writeAppearance(def, def.onOps)
          dict.push('/FT /Tx')
          if (field.valueStream !== undefined) dict.push(`/V ${writeFieldValueStream(field.valueStream)}`)
          else if (field.value !== undefined) dict.push(`/V (${pdfEscapeString(field.value)})`)
          if (field.defaultValue !== undefined) dict.push(`/DV (${pdfEscapeString(field.defaultValue)})`)
          if (field.richTextStream !== undefined) dict.push(`/RV ${writeFieldValueStream(field.richTextStream)}`)
          else if (field.richText !== undefined) dict.push(`/RV (${pdfEscapeString(field.richText)})`)
          if (field.defaultStyle !== undefined) dict.push(`/DS (${pdfEscapeString(field.defaultStyle)})`)
          if (field.maxLength !== undefined) dict.push(`/MaxLen ${field.maxLength}`)
          dict.push(`/AP << /N ${onId} 0 R >>`)
          dict.push(`/DA ${defaultAppearance(def)}`)
        }
        if (flags !== 0) dict.push(`/Ff ${flags}`)
        if (field.additionalActions !== undefined) dict.push(`/AA ${pdfFieldAdditionalActionsPdf(field.additionalActions)}`)
        w.writeDeferredDict(fieldId, dict)
        allAcroFormFieldIds.push(fieldId)
        registerCalculationOrder(fieldId, field.calculationOrder)
        registerFieldId(fieldId, def.pageIndex, annotationAppearanceState)
      }
    }

    // ─── Anchor map construction (for local link resolution) ───
    const anchorMap = new Map<string, { pageIndex: number, y: number }>()
    for (let ai = 0; ai < this.anchorEntries.length; ai++) {
      const a = this.anchorEntries[ai]!
      anchorMap.set(a.name, { pageIndex: a.pageIndex, y: a.y })
    }

    // ─── Reserve page IDs up front (for localAnchor/bookmark resolution) ───

    // Tagged PDF Link-annotation OBJR integration (§14.7.4.4): OBJR entries to
    // append to each structure element's /K, plus /StructParent → element
    // entries for the ParentTree. StructParent numbers start after the page
    // range (page StructParents use the page index).
    const objrByStructElem = new Map<number, string[]>()
    const annotStructParentEntries: { num: number, structElemIndex: number }[] = []
    let nextAnnotStructParent = nextStructureParentKey
    const structElementIndexById = new Map<string, number>()
    for (let si = 0; si < this.structElements.length; si++) {
      const id = this.structElements[si]!.id
      if (id === undefined) continue
      if (structElementIndexById.has(id)) throw new Error(`PDF structure element ID must be unique: ${id}`)
      structElementIndexById.set(id, si)
    }
    if (this.structureObjects.length > 0 && !this.tagged) {
      throw new Error('PDF structureObjects require tagged output')
    }
    for (let oi = 0; oi < this.structureObjects.length; oi++) {
      const reference = this.structureObjects[oi]!
      const structElemIndex = structElementIndexById.get(reference.structureElementId)
      if (structElemIndex === undefined) throw new Error(`PDF structure object element ID not found: ${reference.structureElementId}`)
      if (reference.pageIndex !== undefined && (!Number.isInteger(reference.pageIndex) || reference.pageIndex < 0 || reference.pageIndex >= pageIds.length)) {
        throw new Error(`PDF structure object page index ${reference.pageIndex} out of range`)
      }
      if (reference.object.entries.StructParent !== undefined || reference.object.entries.StructParents !== undefined) {
        throw new Error('PDF structure object owns its StructParent entry')
      }
      const structParent = nextAnnotStructParent++
      const objectId = alloc()
      if (reference.object.kind === 'dictionary') {
        w.writeDeferredDict(objectId, [rawPdfDictionaryEntries(reference.object.entries), `/StructParent ${structParent}`])
      } else {
        w.beginObj(objectId)
        const entries = rawPdfDictionaryEntries(reference.object.entries, true)
        writeStream(objectId, reference.object.data, `${entries}${entries === '' ? '' : ' '}/StructParent ${structParent} `)
        w.endObj()
      }
      annotStructParentEntries.push({ num: structParent, structElemIndex })
      let objrs = objrByStructElem.get(structElemIndex)
      if (objrs === undefined) {
        objrs = []
        objrByStructElem.set(structElemIndex, objrs)
      }
      const pageReference = reference.pageIndex === undefined ? '' : ` /Pg ${pageIds[reference.pageIndex]!} 0 R`
      objrs.push(`<< /Type /OBJR /Obj ${objectId} 0 R${pageReference} >>`)
    }

    for (let pi = 0; pi < this.pageDataList.length; pi++) {
      const page = this.pageDataList[pi]!
      const contentId = alloc()
      const pageId = pageIds[pi]!

      // Content stream from the pre-serialized segments: repeated content
      // groups reference their shared Form XObject
      const contentParts: string[] = []
      for (const segment of pageSegments[pi]!) {
        if (typeof segment === 'string') {
          contentParts.push(segment)
        } else {
          contentParts.push(segment.name !== null ? `${segment.name} Do` : segment.body)
        }
      }
      const contentStr = contentParts.join('\n')
      const contentBytes = encodeAscii(contentStr)
      w.beginObj(contentId)
      writeStream(contentId, contentBytes)
      w.endObj()

      // Annotation generation
      const annotations = this.pageAnnotations.get(pi)
      const annotIds: number[] = []
      const trapNetAnnotIds: number[] = []
      if (annotations) {
        for (let ai = 0; ai < annotations.length; ai++) {
          const ann = annotations[ai]!
          const annotId = alloc()
          annotIds.push(annotId)
          // PDF coordinate conversion: Y flip (top-down -> bottom-up)
          const pdfY1 = page.height - ann.y
          const pdfY2 = page.height - (ann.y + ann.height)
          const annotDict: string[] = [
            '/Type /Annot',
            '/Subtype /Link',
            `/Rect [${pn(ann.x)} ${pn(pdfY2)} ${pn(ann.x + ann.width)} ${pn(pdfY1)}]`,
            '/Border [0 0 0]',
          ]
          if (pdfa !== undefined) annotDict.push('/F 4')

          switch (ann.type) {
            case 'uri':
              annotDict.push(`/A << /Type /Action /S /URI /URI (${pdfEscapeString(ann.target)}) >>`)
              break
            case 'localAnchor': {
              const dest = anchorMap.get(ann.target)
              if (dest && dest.pageIndex < pageIds.length) {
                const destPageId = pageIds[dest.pageIndex]!
                const destY = this.pageDataList[dest.pageIndex]?.height ?? page.height
                annotDict.push(`/Dest [${destPageId} 0 R /XYZ 0 ${pn(destY - dest.y)} null]`)
              }
              break
            }
            case 'localPage': {
              const targetPage = parseInt(ann.target, 10) - 1
              if (targetPage >= 0 && targetPage < pageIds.length) {
                const destPageId = pageIds[targetPage]!
                const destH = this.pageDataList[targetPage]?.height ?? page.height
                annotDict.push(`/Dest [${destPageId} 0 R /XYZ 0 ${pn(destH)} null]`)
              }
              break
            }
            case 'remotePage': {
              const file = ann.remoteDocument ?? ''
              annotDict.push(`/A << /Type /Action /S /GoToR /F (${pdfEscapeString(file)}) /D [${parseInt(ann.target, 10) - 1} /Fit] >>`)
              break
            }
            case 'remoteAnchor': {
              const file = ann.remoteDocument ?? ''
              annotDict.push(`/A << /Type /Action /S /GoToR /F (${pdfEscapeString(file)}) /D (${pdfEscapeString(ann.target)}) >>`)
              break
            }
          }

          const structElemIndex = this.annotationStructElems.get(pi)?.[ai] ?? -1
          if (structElemIndex >= 0) {
            const structParentNum = nextAnnotStructParent++
            annotDict.push(`/StructParent ${structParentNum}`)
            annotStructParentEntries.push({ num: structParentNum, structElemIndex })
            let objrs = objrByStructElem.get(structElemIndex)
            if (objrs === undefined) {
              objrs = []
              objrByStructElem.set(structElemIndex, objrs)
            }
            objrs.push(`<< /Type /OBJR /Obj ${annotId} 0 R /Pg ${pageId} 0 R >>`)
          }

          w.writeDeferredDict(annotId, annotDict)
        }
      }
      const explicitAnnotationIndexes = explicitAnnotationData.byPage.get(pi)
      const pageAnnotationStates: (string | null)[] = []
      if (annotations !== undefined) {
        for (let ai = 0; ai < annotations.length; ai++) pageAnnotationStates.push(null)
      }
      if (explicitAnnotationIndexes !== undefined) {
        for (let ai = 0; ai < explicitAnnotationIndexes.length; ai++) {
          const annotation = this.annotations[explicitAnnotationIndexes[ai]!]!
          if (annotation.subtype !== 'TrapNet') pageAnnotationStates.push(pdfAnnotationAppearanceState(annotation))
        }
      }
      const annotationFieldIds = fieldIdsByPage.get(pi) ?? []
      for (let ai = 0; ai < annotationFieldIds.length; ai++) {
        pageAnnotationStates.push(fieldAppearanceStateById.get(annotationFieldIds[ai]!) ?? null)
      }
      const pageVersionObjectIds = pdfIndirectObjectIds(resourcesStr)
      pageVersionObjectIds.unshift(contentId, resourcesId)
      if (explicitAnnotationIndexes !== undefined) {
        for (let ai = 0; ai < explicitAnnotationIndexes.length; ai++) {
          const annotationIndex = explicitAnnotationIndexes[ai]!
          const annotation = this.annotations[annotationIndex]!
          const annotId = explicitAnnotationData.ids[annotationIndex]!
          if (annotation.subtype === 'TrapNet') trapNetAnnotIds.push(annotId)
          else annotIds.push(annotId)
          let structParent: number | undefined
          if (annotation.structureElementId !== undefined) {
            const structElemIndex = structElementIndexById.get(annotation.structureElementId)
            if (structElemIndex === undefined) throw new Error(`PDF annotation structure element ID not found: ${annotation.structureElementId}`)
            structParent = nextAnnotStructParent++
            annotStructParentEntries.push({ num: structParent, structElemIndex })
            let objrs = objrByStructElem.get(structElemIndex)
            if (objrs === undefined) {
              objrs = []
              objrByStructElem.set(structElemIndex, objrs)
            }
            objrs.push(`<< /Type /OBJR /Obj ${annotId} 0 R /Pg ${pageIds[pi]!} 0 R >>`)
          }
          writePdfAnnotation(
            annotId,
            annotationIndex,
            annotation,
            page,
            pageIds[pi]!,
            w,
            alloc,
            writeStream,
            explicitAnnotationData.ids,
            explicitAnnotationData.richMediaInstanceIds,
            pageIds,
            explicitAnnotationData.popupByParent.get(annotationIndex),
            pdfActionPdf,
            rawPdfValuePdf,
            rawPdfDictionaryPdf,
            separationColorSpacePdf,
            pageVersionObjectIds,
            pageAnnotationStates,
            this.fontRefMap,
            fontObjects,
            this.fontGidRemap,
            structParent,
            pdfa,
            pdfx,
            preparedAnnotationAppearances.get(annotationIndex),
            colorSpaceObjects.get('/DefaultCMYK'),
          )
        }
      }

      // Page
      if (page.metadata !== undefined) validatePdfMetadataStreamDef(page.metadata, `page ${pi}`)
      const pageDict: string[] = [
        '/Type /Page',
        `/Parent ${pagesId} 0 R`,
        `/MediaBox [0 0 ${pn(page.width)} ${pn(page.height)}]`,
        ...(page.cropBox === undefined ? [] : [`/CropBox ${pdfPageBoxString(page.cropBox)}`]),
        ...(page.bleedBox === undefined ? [] : [`/BleedBox ${pdfPageBoxString(page.bleedBox)}`]),
        ...(page.trimBox === undefined ? [] : [`/TrimBox ${pdfPageBoxString(page.trimBox)}`]),
        ...(page.artBox === undefined ? [] : [`/ArtBox ${pdfPageBoxString(page.artBox)}`]),
        ...(page.rotate === undefined ? [] : [`/Rotate ${page.rotate}`]),
        ...(page.userUnit === undefined ? [] : [`/UserUnit ${pn(page.userUnit)}`]),
        ...(page.tabs === undefined ? [] : [`/Tabs /${page.tabs}`]),
        ...(page.duration === undefined ? [] : [`/Dur ${pn(page.duration)}`]),
        ...(page.transition === undefined ? [] : [`/Trans ${pdfPageTransitionPdf(page.transition)}`]),
        ...(page.viewports === undefined ? [] : [`/VP [${page.viewports.map(function (viewport) {
          return rawPdfDictionaryPdf(isPdfMeasurementViewport(viewport) ? pdfMeasurementViewportToRaw(viewport) : viewport)
        }).join(' ')}]`]),
        ...(page.additionalActions === undefined ? [] : [`/AA ${rawPdfDictionaryPdf(page.additionalActions)}`]),
        ...(page.additionalActionModels === undefined ? [] : [`/AA ${pdfAdditionalActionsPdf(page.additionalActionModels)}`]),
        ...(page.metadata === undefined ? [] : [`/Metadata ${rawPdfValuePdf(page.metadata)}`]),
        ...(page.pieceInfo === undefined ? [] : [`/PieceInfo ${rawPdfDictionaryPdf(page.pieceInfo)}`]),
        ...(page.lastModified === undefined ? [] : [`/LastModified ${rawPdfValuePdf(page.lastModified)}`]),
        ...(pdfx ? [
          ...(page.trimBox === undefined ? [`/TrimBox [0 0 ${pn(page.width)} ${pn(page.height)}]`] : []),
          ...(page.bleedBox === undefined ? [`/BleedBox [0 0 ${pn(page.width)} ${pn(page.height)}]`] : []),
        ] : []),
        `/Contents ${contentId} 0 R`,
        `/Resources ${resourcesRef}`,
      ]
      const separationInfo = separationInfoByPage.get(pi)
      if (separationInfo !== undefined) {
        const colorant = separationInfo.deviceColorant.kind === 'name'
          ? encodePdfName(separationInfo.deviceColorant.value)
          : pdfString(separationInfo.deviceColorant.value)
        const separationEntries = [
          `/Pages [${separationInfo.pages.map(function (pageIndex) { return `${pageIds[pageIndex]!} 0 R` }).join(' ')}]`,
          `/DeviceColorant ${colorant}`,
        ]
        if (separationInfo.colorSpace !== undefined) {
          separationEntries.push(`/ColorSpace ${specialColorSpacePdf(separationInfo.colorSpace)}`)
        }
        pageDict.push(`/SeparationInfo << ${separationEntries.join(' ')} >>`)
      }
      if (page.transparencyGroup !== undefined) {
        const groupEntries = ['/Type /Group', '/S /Transparency']
        if (page.transparencyGroup.colorSpace !== undefined) groupEntries.push(`/CS ${processColorSpacePdf(page.transparencyGroup.colorSpace)}`)
        if (page.transparencyGroup.isolated !== undefined) groupEntries.push(`/I ${pdfBool(page.transparencyGroup.isolated)}`)
        if (page.transparencyGroup.knockout !== undefined) groupEntries.push(`/K ${pdfBool(page.transparencyGroup.knockout)}`)
        pageDict.push(`/Group << ${groupEntries.join(' ')} >>`)
      }
      const webCaptureIdentifier = webCaptureState.pageIdentifiers.get(pi)
      if (webCaptureIdentifier !== undefined) pageDict.push(`/ID <${bytesToHex(webCaptureIdentifier)}>`)
      const pageCaptureObject = webCaptureState.pageObjects.get(pi)
      if (pageCaptureObject?.preferredZoom !== undefined) pageDict.push(`/PZ ${pn(pageCaptureObject.preferredZoom)}`)
      const thumbnailName = pageThumbnailNames[pi]
      if (thumbnailName === undefined) throw new Error(`PDF page thumbnail name missing for page ${pi + 1}`)
      if (thumbnailName !== null) {
        const thumbnailId = imageObjects.get(thumbnailName)
        if (thumbnailId === undefined) throw new Error(`PDF page thumbnail image object missing: ${thumbnailName}`)
        pageDict.push(`/Thumb ${thumbnailId} 0 R`)
      }
      const pageBeadIds = articleThreads.pageBeadIds.get(pi)
      if (pageBeadIds !== undefined && pageBeadIds.length > 0) {
        pageDict.push(`/B [${pageBeadIds.map(function (id) { return `${id} 0 R` }).join(' ')}]`)
      }
      const pageFieldIds = fieldIdsByPage.get(pi) ?? []
      if (annotIds.length > 0 || pageFieldIds.length > 0 || trapNetAnnotIds.length > 0) {
        let annotStr = ''
        for (let ai = 0; ai < annotIds.length; ai++) {
          if (annotStr) annotStr += ' '
          annotStr += `${annotIds[ai]!} 0 R`
        }
        for (const fid of pageFieldIds) {
          if (annotStr) annotStr += ' '
          annotStr += `${fid} 0 R`
        }
        for (let ai = 0; ai < trapNetAnnotIds.length; ai++) {
          if (annotStr) annotStr += ' '
          annotStr += `${trapNetAnnotIds[ai]!} 0 R`
        }
        pageDict.push(`/Annots [${annotStr}]`)
      }
      // Tagged PDF: StructParents
      if ((this.pageMcidToStructElem[pi]?.length ?? 0) > 0) {
        this.pageStructParents.push(pi)
        pageDict.push(`/StructParents ${pi}`)
      }
      if (dpartIdByPage[pi] !== 0) {
        pageDict.push(`/DPart ${dpartIdByPage[pi]} 0 R`)
      }
      w.writeDeferredDict(pageId, pageDict)
    }

    // ─── Pages ───
    let kidsStr = ''
    for (let ki = 0; ki < pageIds.length; ki++) {
      if (ki > 0) kidsStr += ' '
      kidsStr += `${pageIds[ki]!} 0 R`
    }
    w.writeDeferredDict(pagesId, [
      '/Type /Pages',
      `/Kids [${kidsStr}]`,
      `/Count ${pageIds.length}`,
    ])

    // ─── Outline (bookmark) generation ───
    let outlinesId: number | null = null
    if (this.bookmarkEntries.length > 0) {
      outlinesId = alloc()
      const outlineItems = buildOutlineTree(
        this.bookmarkEntries, pageIds, this.pageDataList, w, alloc, outlinesId, pdfActionPdf,
      )
      if (outlineItems.length > 0) {
        w.writeDeferredDict(outlinesId, [
          '/Type /Outlines',
          `/First ${outlineItems[0]!.id} 0 R`,
          `/Last ${outlineItems[outlineItems.length - 1]!.id} 0 R`,
          `/Count ${countOutlineItems(outlineItems)}`,
        ])
      } else {
        w.writeDeferredDict(outlinesId, ['/Type /Outlines', '/Count 0'])
      }
    }

    const collectionFieldKeys = pdfCollectionFieldKeys(this.collection)
    const collectionFolderIds = pdfCollectionFolderIds(this.collection?.folders)
    const javaScriptNameTree = buildJavaScriptNameTree(this.javaScript)
    const embeddedFilesResult = writeEmbeddedFilesNameTree(
      this.embeddedFiles, w, alloc, writeStream, collectionFieldKeys, collectionFolderIds,
      identityEmbeddedFiles, identityEmbeddedFilesViaEff, pdfa,
    )
    const embeddedFilesNameTree = embeddedFilesResult.nameTree
    const collectionDictionary = writeCollectionDictionary(
      this.collection, collectionFieldKeys, w, alloc, imageObjects, this.imageRefMap,
    )

    // ─── Structure tree (Tagged PDF) ───
    if (this.tagged && this.structElements.length > 0) {
      validateStructureElementReferences(this.structElements)
      // ParentTree (NumberTree): StructParents → MCID→StructElem mapping
      const parentTreeId = alloc()
      const parentTreeNums: string[] = []
      for (let pi = 0; pi < this.pageMcidToStructElem.length; pi++) {
        const mcidMap = this.pageMcidToStructElem[pi]
        if (!mcidMap || mcidMap.length === 0) continue
        let arrStr = ''
        for (let mi = 0; mi < mcidMap.length; mi++) {
          if (mi > 0) arrStr += ' '
          const seIdx = mcidMap[mi]!
          arrStr += `${structElemIds[seIdx]!} 0 R`
        }
        parentTreeNums.push(`${pi} [${arrStr}]`)
      }
      for (const formParent of formStructParents.values()) {
        let arrStr = ''
        for (let mi = 0; mi < formParent.mcidToStructElem.length; mi++) {
          if (mi > 0) arrStr += ' '
          const structElemIndex = formParent.mcidToStructElem[mi]
          arrStr += structElemIndex === undefined ? 'null' : `${structElemIds[structElemIndex]!} 0 R`
        }
        parentTreeNums.push(`${formParent.key} [${arrStr}]`)
      }
      // Link-annotation StructParent entries map a single number to one
      // structure element (their numbers follow the page range, so /Nums stays
      // key-sorted).
      for (let ei = 0; ei < annotStructParentEntries.length; ei++) {
        const entry = annotStructParentEntries[ei]!
        parentTreeNums.push(`${entry.num} ${structElemIds[entry.structElemIndex]!} 0 R`)
      }
      w.writeDeferredDict(parentTreeId, [
        '/Nums [' + parentTreeNums.join(' ') + ']',
      ])

      // PDF 2.0 structure namespaces (ISO 32000-2 14.7.4): one Namespace dict
      // per URI, referenced by StructTreeRoot /Namespaces and per-element /NS.
      const namespaceIds: number[] = []
      if (this.structureNamespaces !== undefined) {
        for (let n = 0; n < this.structureNamespaces.length; n++) {
          namespaceIds.push(alloc())
        }
        for (let n = 0; n < this.structureNamespaces.length; n++) {
          const namespace = this.structureNamespaces[n]!
          const entries = ['/Type /Namespace', `/NS ${pdfString(namespace.uri)}`]
          if (namespace.schemaFileIndex !== undefined) {
            const schemaId = embeddedFilesResult.fileIds[namespace.schemaFileIndex]
            if (schemaId === undefined) throw new Error(`PDF structure namespace schema-file index ${namespace.schemaFileIndex} out of range`)
            entries.push(`/Schema ${schemaId} 0 R`)
          } else if (namespace.schema !== undefined) {
            entries.push(`/Schema ${rawPdfValuePdf(namespace.schema)}`)
          }
          if (namespace.roleMap !== undefined && Object.keys(namespace.roleMap).length > 0) {
            const roleMapId = alloc()
            const roleMapEntries: string[] = []
            for (const role of Object.keys(namespace.roleMap)) {
              const target = namespace.roleMap[role]!
              if (typeof target === 'string') roleMapEntries.push(`${encodePdfName(role)} ${encodePdfName(target)}`)
              else {
                if (target.namespaceIndex === undefined) roleMapEntries.push(`${encodePdfName(role)} ${encodePdfName(target.role)}`)
                else roleMapEntries.push(`${encodePdfName(role)} [${encodePdfName(target.role)} ${namespaceIds[target.namespaceIndex]!} 0 R]`)
              }
            }
            w.writeDeferredDict(roleMapId, roleMapEntries)
            entries.push(`/RoleMapNS ${roleMapId} 0 R`)
          }
          w.writeDeferredDict(namespaceIds[n]!, entries)
        }
      }

      // Attribute deduplication (/ClassMap): revision-free attribute objects
      // shared by two or more elements are hoisted into a named class.
      const attrStrings: (TaggedAttributesResult | null)[] = []
      const attrCounts = new Map<string, number>()
      const attributeObjectPdf = (attribute: NonNullable<StructureTag['attributes']>[number]): string => {
        const entries = [`/O /${attribute.owner}`]
        if (attribute.namespaceIndex !== undefined) entries.push(`/NS ${namespaceIds[attribute.namespaceIndex]!} 0 R`)
        for (const key of Object.keys(attribute.entries)) {
          if (key !== 'Length') entries.push(`${encodePdfName(key)} ${rawPdfValuePdf(attribute.entries[key]!)}`)
        }
        if (attribute.streamData === undefined) return `<< ${entries.join(' ')} >>`
        const id = alloc()
        w.beginObj(id)
        writeStream(id, attribute.streamData, entries.join(' ') + ' ')
        w.endObj()
        return `${id} 0 R`
      }
      for (let si = 0; si < this.structElements.length; si++) {
        const result = taggedAttributes(this.structElements[si]!, attributeObjectPdf, rawPdfValuePdf)
        attrStrings.push(result)
        if (result !== null && result.classable) attrCounts.set(result.value, (attrCounts.get(result.value) ?? 0) + 1)
      }
      const attrClassNames = new Map<string, string>()
      let classCounter = 0
      for (const [attr, count] of attrCounts) {
        if (count >= 2) attrClassNames.set(attr, `C${classCounter++}`)
      }

      // StructElem object generation
      for (let si = 0; si < this.structElements.length; si++) {
        const elem = this.structElements[si]!
        const elemId = structElemIds[si]!
        const parentObjId = elem.parentIndex >= 0 ? structElemIds[elem.parentIndex]! : structTreeRootId

        const dict: string[] = [
          '/Type /StructElem',
          `/S /${elem.role}`,
          `/P ${parentObjId} 0 R`,
        ]

        if (elem.lang) dict.push(`/Lang (${pdfEscapeString(elem.lang)})`)
        if (elem.title) dict.push(`/T (${pdfEscapeString(elem.title)})`)
        if (elem.alt) dict.push(`/Alt (${pdfEscapeString(elem.alt)})`)
        if (elem.actualText) dict.push(`/ActualText (${pdfEscapeString(elem.actualText)})`)
        if (elem.expandedText) dict.push(`/E (${pdfEscapeString(elem.expandedText)})`)
        if (elem.phoneme !== undefined) dict.push(`/Phoneme ${pdfString(elem.phoneme)}`)
        if (elem.phoneticAlphabet !== undefined) dict.push(`/PhoneticAlphabet /${elem.phoneticAlphabet}`)
        if (elem.id) dict.push(`/ID (${pdfEscapeString(elem.id)})`)
        if (elem.revision !== undefined) dict.push(`/R ${elem.revision}`)
        if (elem.role === 'Table' && elem.summary) dict.push(`/Summary (${pdfEscapeString(elem.summary)})`)
        if (elem.namespaceIndex !== undefined && elem.namespaceIndex >= 0 && elem.namespaceIndex < namespaceIds.length) {
          dict.push(`/NS ${namespaceIds[elem.namespaceIndex]!} 0 R`)
        }
        if (elem.associatedFileIndexes !== undefined) {
          const refs: string[] = []
          for (let afi = 0; afi < elem.associatedFileIndexes.length; afi++) {
            const fileIndex = elem.associatedFileIndexes[afi]!
            const fileId = embeddedFilesResult.fileIds[fileIndex]
            if (fileId === undefined) throw new Error(`PDF structure associated-file index ${fileIndex} out of range`)
            if (this.embeddedFiles[fileIndex]!.relationship === undefined) {
              throw new Error(`PDF structure associated file ${fileIndex} requires an AFRelationship`)
            }
            refs.push(`${fileId} 0 R`)
          }
          if (refs.length > 0) dict.push(`/AF [${refs.join(' ')}]`)
        }

        // /Pg: the page a single-page element's content is on (from its MCIDs).
        if (elem.mcids.length > 0) {
          const elemPage = elem.mcids[0]!.pageIndex
          const sametPage = elem.mcids.every(m => m.pageIndex === elemPage)
          if (sametPage && elemPage < pageIds.length) dict.push(`/Pg ${pageIds[elemPage]!} 0 R`)
        }

        const attributes = attrStrings[si]!
        if (attributes !== null) {
          const cls = attributes.classable ? attrClassNames.get(attributes.value) : undefined
          if (cls !== undefined) dict.push(`/C /${cls}`)
          else dict.push(`/A ${attributes.value}`)
        }

        // /K: child elements + MCID references
        const kParts: string[] = []
        // MCID references
        for (let mi = 0; mi < elem.mcids.length; mi++) {
          const m = elem.mcids[mi]!
          const pg = m.pageIndex < pageIds.length ? pageIds[m.pageIndex]! : pageIds[0]!
          if (m.formSemanticId === undefined) {
            kParts.push(`<< /Type /MCR /MCID ${m.mcid} /Pg ${pg} 0 R >>`)
          } else {
            const formParent = formStructParents.get(m.formSemanticId)
            if (formParent === undefined) throw new Error('PDF tagged Form content was not materialized')
            kParts.push(`<< /Type /MCR /MCID ${m.mcid} /Stm ${formParent.formId} 0 R /Pg ${pg} 0 R >>`)
          }
        }
        // Child structure elements
        for (let ci = 0; ci < elem.childIndices.length; ci++) {
          kParts.push(`${structElemIds[elem.childIndices[ci]!]!} 0 R`)
        }
        // Link annotation OBJR references owned by this element
        const objrs = objrByStructElem.get(si)
        if (objrs !== undefined) {
          for (let oi = 0; oi < objrs.length; oi++) kParts.push(objrs[oi]!)
        }

        if (kParts.length === 1) {
          dict.push(`/K ${kParts[0]!}`)
        } else if (kParts.length > 1) {
          dict.push(`/K [${kParts.join(' ')}]`)
        }

        w.writeDeferredDict(elemId, dict)
      }

      // StructTreeRoot
      // Set the top-level elements in /K
      const topLevelIndices: number[] = []
      for (let si = 0; si < this.structElements.length; si++) {
        if (this.structElements[si]!.parentIndex < 0) {
          topLevelIndices.push(si)
        }
      }
      let kStr: string
      if (topLevelIndices.length === 1) {
        kStr = `/K ${structElemIds[topLevelIndices[0]!]!} 0 R`
      } else {
        let arr = ''
        for (let ti = 0; ti < topLevelIndices.length; ti++) {
          if (ti > 0) arr += ' '
          arr += `${structElemIds[topLevelIndices[ti]!]!} 0 R`
        }
        kStr = `/K [${arr}]`
      }
      // /IDTree: a name tree mapping every element /ID to its StructElem, so
      // /ID references (e.g. table /Headers) are resolvable (ISO 32000 §14.7.2).
      const idEntries: { id: string, objId: number }[] = []
      for (let si = 0; si < this.structElements.length; si++) {
        const id = this.structElements[si]!.id
        if (id) idEntries.push({ id, objId: structElemIds[si]! })
      }
      const rootEntries = [
        '/Type /StructTreeRoot',
        kStr,
        `/ParentTree ${parentTreeId} 0 R`,
        `/ParentTreeNextKey ${nextAnnotStructParent}`,
      ]
      if (namespaceIds.length > 0) {
        rootEntries.push(`/Namespaces [${namespaceIds.map(id => `${id} 0 R`).join(' ')}]`)
      }
      if (this.pronunciationLexiconFileIndexes !== undefined) {
        const references: string[] = []
        for (let i = 0; i < this.pronunciationLexiconFileIndexes.length; i++) {
          const fileIndex = this.pronunciationLexiconFileIndexes[i]!
          const fileId = embeddedFilesResult.fileIds[fileIndex]
          const file = this.embeddedFiles[fileIndex]
          if (fileId === undefined || file === undefined) throw new Error(`PDF pronunciation lexicon file index ${fileIndex} out of range`)
          parsePdfPronunciationLexicon(file.data)
          references.push(`${fileId} 0 R`)
        }
        rootEntries.push(`/PronunciationLexicon [${references.join(' ')}]`)
      }
      // /ClassMap: shared attribute classes referenced by element /C.
      if (attrClassNames.size > 0) {
        const classEntries: string[] = []
        for (const [attr, cls] of attrClassNames) classEntries.push(`/${cls} ${attr}`)
        rootEntries.push(`/ClassMap << ${classEntries.join(' ')} >>`)
      }
      // /RoleMap: custom structure types mapped to standard ones, restricted to
      // roles actually used in the tree.
      if (this.roleMap) {
        const usedRoles = new Set<string>()
        for (let si = 0; si < this.structElements.length; si++) usedRoles.add(this.structElements[si]!.role)
        for (const role of Array.from(usedRoles)) {
          let target = this.roleMap[role]
          while (target !== undefined && !STANDARD_STRUCTURE_ROLES.has(target)) {
            usedRoles.add(target)
            target = this.roleMap[target]
          }
        }
        const roleMapEntries: string[] = []
        for (const custom of Object.keys(this.roleMap)) {
          if (usedRoles.has(custom)) roleMapEntries.push(`/${custom} /${this.roleMap[custom]!}`)
        }
        if (roleMapEntries.length > 0) rootEntries.push(`/RoleMap << ${roleMapEntries.join(' ')} >>`)
      }
      if (idEntries.length > 0) {
        idEntries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const names: string[] = []
        for (let i = 0; i < idEntries.length; i++) names.push(`(${pdfEscapeString(idEntries[i]!.id)}) ${idEntries[i]!.objId} 0 R`)
        const idTreeId = alloc()
        w.writeDeferredDict(idTreeId, [`/Names [${names.join(' ')}]`])
        rootEntries.push(`/IDTree ${idTreeId} 0 R`)
      }
      w.writeDeferredDict(structTreeRootId, rootEntries)
    }

    // ─── Encrypt dictionary ───
    if (enc) {
      w.beginObj(encryptId)
      w.writeDict(enc.encryptDict)
      w.endObj()
    }

    // ─── Info dict / XMP metadata ───
    let infoId = 0
    let xmpId = 0
    // Required for PDF/A: generate XMP even when metadata is unspecified
    const baseMeta = this.metadata ?? (pdfa || pdfx ? {} as PdfMetadata : null)
    let meta = baseMeta
    if (pdfx && baseMeta) {
      const now = new Date()
      meta = {
        ...baseMeta,
        title: baseMeta.title ?? 'Report',
        creationDate: baseMeta.creationDate ?? now,
        modDate: baseMeta.modDate ?? now,
      }
    }
    if (meta) {
      // Info dict (PDF 1.7 §14.3.3)
      infoId = alloc()
      const infoEntries: string[] = []
      if (pdfx) {
        // PDF/X: version key, Trapped, and a Title are required
        infoEntries.push('/GTS_PDFXVersion (PDF/X-1a:2003)')
        infoEntries.push('/GTS_PDFXConformance (PDF/X-1a:2003)')
        infoEntries.push(`/Trapped ${pdfTrappedName(meta.trapped ?? false)}`)
      }
      if (!pdfx && meta.trapped !== undefined) infoEntries.push(`/Trapped ${pdfTrappedName(meta.trapped)}`)
      if (meta.title) infoEntries.push(`/Title (${pdfEscapeString(meta.title)})`)
      if (meta.author) infoEntries.push(`/Author (${pdfEscapeString(meta.author)})`)
      if (meta.subject) infoEntries.push(`/Subject (${pdfEscapeString(meta.subject)})`)
      if (meta.keywords) infoEntries.push(`/Keywords (${pdfEscapeString(meta.keywords)})`)
      if (meta.creator) infoEntries.push(`/Creator (${pdfEscapeString(meta.creator)})`)
      if (meta.producer) infoEntries.push(`/Producer (${pdfEscapeString(meta.producer)})`)
      if (meta.creationDate) infoEntries.push(`/CreationDate (${formatPdfDate(meta.creationDate)})`)
      if (meta.modDate) infoEntries.push(`/ModDate (${formatPdfDate(meta.modDate)})`)
      appendCustomInfoEntries(infoEntries, meta.custom)
      w.writeDeferredDict(infoId, infoEntries)

      // XMP Metadata stream (PDF 1.7 §14.3.2). Left uncompressed. It is
      // encrypted along with the rest of the document unless the encryption
      // handler declares /EncryptMetadata false (then it stays plaintext so
      // external tools can read it).
      xmpId = alloc()
      const pdfaPart = pdfa === 'PDF/A-1b' ? 1 : pdfa === 'PDF/A-2b' ? 2 : pdfa === 'PDF/A-3b' ? 3 : undefined
      const xmpBytesPlain = buildPdfXmpPacket(meta, pdfaPart, pdfx === undefined ? undefined : 'PDF/X-1a:2003')
      const identityMetadata = enc !== null && this.identityCryptFilter?.metadata === true
      const xmpBytes = enc && enc.encryptMetadata && !identityMetadata ? enc.encryptStream(xmpId, 0, xmpBytesPlain) : xmpBytesPlain
      w.beginObj(xmpId)
      w.writeStreamObj(
        `<< /Type /Metadata /Subtype /XML${identityMetadata ? ' /Filter /Crypt /DecodeParms << /Name /Identity >>' : ''} /Length ${xmpBytes.length} >>`,
        xmpBytes,
      )
      w.endObj()
    }

    // ─── OutputIntent dictionaries ───
    let outputIntentsStr = ''
    if (this.outputIntents !== undefined) {
      const outputIntentIds: number[] = []
      for (let i = 0; i < this.outputIntents.length; i++) {
        const intent = this.outputIntents[i]!
        const entries = [
          '/Type /OutputIntent',
          `/S ${encodePdfName(intent.subtype)}`,
        ]
        if (intent.outputCondition !== undefined) entries.push(`/OutputCondition ${pdfString(intent.outputCondition)}`)
        if (intent.outputConditionIdentifier !== undefined) entries.push(`/OutputConditionIdentifier ${pdfString(intent.outputConditionIdentifier)}`)
        if (intent.registryName !== undefined) entries.push(`/RegistryName ${pdfString(intent.registryName)}`)
        if (intent.info !== undefined) entries.push(`/Info ${pdfString(intent.info)}`)
        if (intent.destinationProfile !== undefined) {
          const profileId = alloc()
          w.beginObj(profileId)
          writeStream(profileId, intent.destinationProfile.data, `/N ${intent.destinationProfile.components} `)
          w.endObj()
          entries.push(`/DestOutputProfile ${profileId} 0 R`)
        }
        if (intent.destinationProfileReference !== undefined) {
          entries.push(`/DestOutputProfileRef ${rawPdfDictionaryPdf(intent.destinationProfileReference)}`)
        }
        const outputIntentId = alloc()
        w.writeDeferredDict(outputIntentId, entries)
        outputIntentIds.push(outputIntentId)
      }
      outputIntentsStr = `/OutputIntents [${outputIntentIds.map(function (id) { return `${id} 0 R` }).join(' ')}]`
    } else if (pdfx) {
      const profile = this.pdfxOutputProfile
      if (profile === undefined) throw new Error('PDF/X output profile is not initialized')
      const iccData = profile.data
      const iccStreamId = alloc()
      w.beginObj(iccStreamId)
      writeStream(iccStreamId, iccData, `/N 4 `)
      w.endObj()
      const outputIntentId = alloc()
      w.writeDeferredDict(outputIntentId, [
        '/Type /OutputIntent',
        '/S /GTS_PDFX',
        `/OutputConditionIdentifier ${pdfString(profile.outputConditionIdentifier)}`,
        ...(profile.outputCondition === undefined ? [] : [`/OutputCondition ${pdfString(profile.outputCondition)}`]),
        ...(profile.registryName === undefined ? [] : [`/RegistryName ${pdfString(profile.registryName)}`]),
        ...(profile.info === undefined ? [] : [`/Info ${pdfString(profile.info)}`]),
        `/DestOutputProfile ${iccStreamId} 0 R`,
      ])
      outputIntentsStr = `/OutputIntents [${outputIntentId} 0 R]`
    }

    // ─── PDF/A OutputIntent ───
    if (pdfa && !pdfx) {
      const iccData = generateSRGBIccProfile()
      const iccStreamId = alloc()
      w.beginObj(iccStreamId)
      writeStream(iccStreamId, iccData, `/N 3 `)
      w.endObj()

      const outputIntentId = alloc()
      w.writeDeferredDict(outputIntentId, [
        '/Type /OutputIntent',
        '/S /GTS_PDFA1',
        '/OutputConditionIdentifier (sRGB IEC61966-2.1)',
        '/RegistryName (http://www.color.org)',
        `/DestOutputProfile ${iccStreamId} 0 R`,
      ])
      outputIntentsStr = `/OutputIntents [${outputIntentId} 0 R]`
    }

    // ─── fileId ───
    // Use enc.fileId when encrypting, generate a random one for PDF/A
    let fileId = enc?.fileId
    if (!fileId && (pdfa || pdfx)) {
      fileId = generateRandomFileId()
    }

    // ─── Catalog ───
    // Write the validated hierarchy after page object IDs are known.
    if (preparedDPartHierarchy !== undefined) {
      writePreparedPdfDocumentPart(w, preparedDPartHierarchy.root, pageIds)
      const rootEntries = [
        '/Type /DPartRoot',
        `/DPartRootNode ${preparedDPartHierarchy.rootId} 0 R`,
      ]
      if (preparedDPartHierarchy.recordLevel !== undefined) {
        rootEntries.push(`/RecordLevel ${preparedDPartHierarchy.recordLevel}`)
      }
      if (preparedDPartHierarchy.nodeNameList !== undefined) {
        rootEntries.push(`/NodeNameList [${preparedDPartHierarchy.nodeNameList.map(encodePdfName).join(' ')}]`)
      }
      w.writeDeferredDict(preparedDPartHierarchy.rootDictionaryId, rootEntries)
    }

    const catalogEntries: string[] = [
      '/Type /Catalog',
      `/Pages ${pagesId} 0 R`,
    ]
    if (preparedDPartHierarchy !== undefined) {
      catalogEntries.push(`/DPartRoot ${preparedDPartHierarchy.rootDictionaryId} 0 R`)
    }
    // Associated files (PDF 2.0 /AF): document-level references to embedded
    // files that carry an /AFRelationship.
    if (embeddedFilesResult.associatedFileIds.length > 0) {
      catalogEntries.push(`/AF [${embeddedFilesResult.associatedFileIds.map(id => `${id} 0 R`).join(' ')}]`)
    }
    let xfaEntry: string | undefined
    if (this.xfa !== undefined) {
      if (this.xfa.kind === 'document') {
        const streamId = alloc()
        w.beginObj(streamId)
        writeStream(streamId, this.xfa.data)
        w.endObj()
        xfaEntry = `${streamId} 0 R`
      } else {
        const entries: string[] = []
        for (let i = 0; i < this.xfa.packets.length; i++) {
          const packet = this.xfa.packets[i]!
          const streamId = alloc()
          w.beginObj(streamId)
          writeStream(streamId, packet.data)
          w.endObj()
          entries.push(`${pdfString(packet.name)} ${streamId} 0 R`)
        }
        xfaEntry = `[${entries.join(' ')}]`
      }
    }
    if (allAcroFormFieldIds.length > 0 || xfaEntry !== undefined) {
      const acroFormEntries = [`/Fields [${allAcroFormFieldIds.map(id => `${id} 0 R`).join(' ')}]`]
      calculationOrderFields.sort(function (a, b) { return a.order - b.order })
      for (let i = 1; i < calculationOrderFields.length; i++) {
        if (calculationOrderFields[i - 1]!.order === calculationOrderFields[i]!.order) {
          throw new Error(`Duplicate form field calculationOrder: ${calculationOrderFields[i]!.order}`)
        }
      }
      if (calculationOrderFields.length > 0) {
        acroFormEntries.push(`/CO [${calculationOrderFields.map(function (field) { return `${field.id} 0 R` }).join(' ')}]`)
      }
      if (allAcroFormFieldIds.length > 0) {
        if (pdfa === undefined) {
          const helvId = alloc()
          w.writeDeferredDict(helvId, ['/Type /Font', '/Subtype /Type1', '/BaseFont /Helvetica', '/Encoding /WinAnsiEncoding'])
          acroFormEntries.push(`/DR << /Font << /Helv ${helvId} 0 R >> >>`, '/DA (/Helv 0 Tf 0 g)')
        } else {
          const embeddedFonts = Array.from(fontObjects.entries())
          if (embeddedFonts.length === 0) throw new Error(`${pdfa} AcroForm requires an embedded default font`)
          const resources = embeddedFonts.map(function ([name, id]) { return `${name} ${id} 0 R` }).join(' ')
          acroFormEntries.push(`/DR << /Font << ${resources} >> >>`, `/DA (${embeddedFonts[0]![0]} 0 Tf 0 g)`)
        }
      }
      if (xfaEntry !== undefined) acroFormEntries.push(`/XFA ${xfaEntry}`)
      catalogEntries.push(`/AcroForm << ${acroFormEntries.join(' ')} >>`)
    }
    if (this.pageMode !== undefined) {
      catalogEntries.push(`/PageMode /${this.pageMode}`)
    }
    if (this.pageLayout !== undefined) {
      catalogEntries.push(`/PageLayout /${this.pageLayout}`)
    }
    if (this.viewerPreferences !== undefined) {
      const viewerPreferences = buildViewerPreferences(this.viewerPreferences)
      if (viewerPreferences !== '') catalogEntries.push(`/ViewerPreferences << ${viewerPreferences} >>`)
    }
    if (this.pageLabels !== undefined && this.pageLabels.length > 0) {
      catalogEntries.push(`/PageLabels ${buildPageLabelsDictionary(this.pageLabels)}`)
    }
    if (this.openAction !== undefined) {
      catalogEntries.push(`/OpenAction ${buildOpenActionDestination(this.openAction, pageIds, this.pageDataList)}`)
    }
    if (this.documentOpenAction !== undefined) catalogEntries.push(`/OpenAction ${pdfActionPdf(this.documentOpenAction)}`)
    const namedDests = buildNamedDestinations(anchorMap, pageIds, this.pageDataList, this.namedDestinations)
    const webCapture = writePdfWebCapture(
      this.catalogModel?.spiderInfo,
      w,
      alloc,
      writeStream,
      rawPdfDictionaryPdf,
      pageIds,
      imageObjects,
      this.imageRefMap,
    )
    const catalogNameEntries: string[] = []
    const catalogNames = buildCatalogNames(namedDests, javaScriptNameTree, embeddedFilesNameTree)
    if (catalogNames !== '') catalogNameEntries.push(catalogNames)
    if (webCapture.urlsNameTree !== '') catalogNameEntries.push(`/URLS ${webCapture.urlsNameTree}`)
    if (webCapture.idsNameTree !== '') catalogNameEntries.push(`/IDS ${webCapture.idsNameTree}`)
    const reservedNameTrees = new Set(['Dests', 'JavaScript', 'EmbeddedFiles', 'URLS', 'IDS'])
    const additionalNameTreeKeys = Object.keys(this.nameTrees).sort()
    for (let i = 0; i < additionalNameTreeKeys.length; i++) {
      const key = additionalNameTreeKeys[i]!
      if (reservedNameTrees.has(key)) throw new Error(`PDF name tree ${key} is owned by a dedicated backend option`)
      const entries = this.nameTrees[key]!
      if (entries.length === 0) throw new Error(`PDF name tree ${key} must not be empty`)
      const sorted = entries.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 })
      const values: string[] = []
      for (let j = 0; j < sorted.length; j++) {
        if (sorted[j]!.name === '') throw new Error(`PDF name tree ${key} contains an empty key`)
        if (j > 0 && sorted[j - 1]!.name === sorted[j]!.name) throw new Error(`PDF name tree ${key} contains duplicate key ${sorted[j]!.name}`)
        values.push(`${pdfString(sorted[j]!.name)} ${rawPdfValuePdf(sorted[j]!.value)}`)
      }
      catalogNameEntries.push(`${encodePdfName(key)} << /Names [${values.join(' ')}] >>`)
    }
    if (catalogNameEntries.length > 0) {
      catalogEntries.push(`/Names << ${catalogNameEntries.join(' ')} >>`)
    }
    const additionalNumberTreeKeys = Object.keys(this.numberTrees).sort()
    for (let i = 0; i < additionalNumberTreeKeys.length; i++) {
      const key = additionalNumberTreeKeys[i]!
      if (key === 'PageLabels') throw new Error('PDF number tree PageLabels is owned by the pageLabels option')
      const entries = this.numberTrees[key]!
      if (entries.length === 0) throw new Error(`PDF number tree ${key} must not be empty`)
      const sorted = entries.slice().sort(function (a, b) { return a.key - b.key })
      const values: string[] = []
      for (let j = 0; j < sorted.length; j++) {
        if (!Number.isInteger(sorted[j]!.key)) throw new Error(`PDF number tree ${key} keys must be integers`)
        if (j > 0 && sorted[j - 1]!.key === sorted[j]!.key) throw new Error(`PDF number tree ${key} contains duplicate key ${sorted[j]!.key}`)
        values.push(`${sorted[j]!.key} ${rawPdfValuePdf(sorted[j]!.value)}`)
      }
      catalogEntries.push(`${encodePdfName(key)} << /Nums [${values.join(' ')}] >>`)
    }
    if (outlinesId !== null) {
      catalogEntries.push(`/Outlines ${outlinesId} 0 R`)
      if (this.pageMode === undefined) catalogEntries.push('/PageMode /UseOutlines')
    }
    if (xmpId !== 0) {
      catalogEntries.push(`/Metadata ${xmpId} 0 R`)
    }
    if (outputIntentsStr) {
      catalogEntries.push(outputIntentsStr)
    }
    if (collectionDictionary !== '') {
      catalogEntries.push(`/Collection ${collectionDictionary}`)
    }
    if (articleThreads.catalogEntry !== '') {
      catalogEntries.push(articleThreads.catalogEntry)
    }
    if (this.optionalContentDefs.length > 0 || optionalProperties !== undefined) {
      catalogEntries.push(buildOptionalContentProperties(this.optionalContentDefs, optionalGroups, optionalGroupObjects, optionalProperties, pdfa))
    }
    if (this.catalogModel?.uri !== undefined) {
      const uriEntries = { ...(this.catalogModel.uri.entries ?? {}) }
      if ('Base' in uriEntries) throw new Error('PDF catalog URI entries must not contain reserved Base')
      if (this.catalogModel.uri.base !== undefined) uriEntries.Base = { kind: 'string', bytes: this.catalogModel.uri.base }
      catalogEntries.push(`/URI ${rawPdfDictionaryPdf(uriEntries)}`)
    }
    if (webCapture.spiderInfo !== '') catalogEntries.push(`/SpiderInfo ${webCapture.spiderInfo}`)
    if (this.catalogModel?.extensions !== undefined) {
      catalogEntries.push(`/Extensions ${pdfDeveloperExtensionsPdf(this.catalogModel.extensions, rawPdfDictionaryPdf)}`)
    }
    if (this.catalogModel?.legal !== undefined) catalogEntries.push(`/Legal ${rawPdfDictionaryPdf(this.catalogModel.legal)}`)
    if (this.catalogModel?.requirements !== undefined) {
      catalogEntries.push(`/Requirements [${this.catalogModel.requirements.map(function (requirement) {
        return pdfDocumentRequirementPdf(requirement, rawPdfDictionaryPdf)
      }).join(' ')}]`)
    }
    if (this.catalogModel?.permissions !== undefined) catalogEntries.push(`/Perms ${rawPdfDictionaryPdf(this.catalogModel.permissions)}`)
    if (this.catalogModel?.additionalActions !== undefined) {
      catalogEntries.push(`/AA ${pdfAdditionalActionsPdf(this.catalogModel.additionalActions)}`)
    }
    // Tagged PDF: StructTreeRoot + MarkInfo + Lang
    if (structTreeRootId !== 0) {
      catalogEntries.push(`/StructTreeRoot ${structTreeRootId} 0 R`)
    }
    if (this.catalogModel?.markInfo !== undefined || pdfa || structTreeRootId !== 0) {
      const markInfo = { ...(this.catalogModel?.markInfo ?? {}) }
      if (pdfa || structTreeRootId !== 0) markInfo.Marked = true
      if (this.structElements.some(function (element) { return element.userProperties !== undefined })) markInfo.UserProperties = true
      catalogEntries.push(`/MarkInfo ${rawPdfDictionaryPdf(markInfo)}`)
    }
    if (this.catalogModel?.language !== undefined && this.documentLang !== undefined && this.catalogModel.language !== this.documentLang) {
      throw new Error('PDF catalog language conflicts with tagged document language')
    }
    const catalogLanguage = this.catalogModel?.language ?? this.documentLang
    if (catalogLanguage !== undefined) {
      validateBcp47LanguageTag(catalogLanguage, 'PDF catalog language')
      catalogEntries.push(`/Lang ${pdfString(catalogLanguage)}`)
    }
    w.writeDeferredDict(catalogId, catalogEntries)

    // ─── Serialization ───
    if (pdfa === 'PDF/A-1b' || pdfx) {
      // PDF/A-1b and PDF/X-1a (PDF 1.4): ObjStm not allowed, traditional xref table
      w.writeDirectDicts()
      w.writeTraditionalXref(catalogId, infoId, fileId)
    } else {
      // PDF 1.7+: ObjStm + xref stream
      w.writeObjStreams(enc)
      w.writeXrefStream(catalogId, infoId, encryptId, fileId)
    }

    const bytes = w.toUint8Array()
    validatePdfConformance(bytes, { pdfaConformance: pdfa, pdfxConformance: pdfx })
    return bytes
  }

  private requiresPdf20(): boolean {
    if (requiredPdfVersionForExtensions(this.catalogModel?.extensions) === '2.0') return true
    for (let i = 0; i < this.pageDataList.length; i++) {
      const viewports = this.pageDataList[i]!.viewports
      if (viewports === undefined) continue
      for (let k = 0; k < viewports.length; k++) {
        const viewport = viewports[k]!
        if (isPdfMeasurementViewport(viewport) && viewport.measure?.kind === 'geospatial') return true
      }
    }
    for (let i = 0; i < this.importedFormDefs.length; i++) {
      if (this.importedFormDefs[i]!.form.measure?.kind === 'geospatial') return true
    }
    for (const measure of this.imageMeasurements.values()) if (measure.kind === 'geospatial') return true
    if (this.structureNamespaces !== undefined && this.structureNamespaces.length > 0) return true
    if (this.pronunciationLexiconFileIndexes !== undefined) return true
    if (this.outputIntents?.some(function (intent) { return intent.destinationProfileReference !== undefined })) return true
    if (this.documentParts !== undefined && this.documentParts.length > 0) return true
    if (this.documentPartHierarchy !== undefined) return true
    if (this.collection !== undefined) {
      if (this.collection.view === 'C' || this.collection.navigator !== undefined || this.collection.colors !== undefined
        || this.collection.folders !== undefined || this.collection.split !== undefined) return true
      if (this.collection.schema !== undefined) {
        for (let i = 0; i < this.collection.schema.length; i++) {
          if (this.collection.schema[i]!.subtype === 'CompressedSize') return true
        }
      }
    }
    for (let i = 0; i < this.articleThreads.length; i++) if (this.articleThreads[i]!.metadata !== undefined) return true
    const requirements = this.catalogModel?.requirements
    if (requirements !== undefined) {
      for (let i = 0; i < requirements.length; i++) {
        const requirement = requirements[i]!
        if (requirement.type !== 'EnableJavaScripts' || requirement.version !== undefined
          || requirement.penalty !== undefined || requirement.encryption !== undefined
          || requirement.digitalSignature !== undefined) return true
      }
    }
    for (let i = 0; i < this.embeddedFiles.length; i++) {
      if (this.embeddedFiles[i]!.relationship !== undefined && this.pdfaConformance !== 'PDF/A-3b') return true
    }
    for (let i = 0; i < this.structElements.length; i++) {
      const element = this.structElements[i]!
      const type = element.role
      if (PDF_20_STRUCTURE_TYPES.has(type)) return true
      if (element.phoneme !== undefined || element.phoneticAlphabet !== undefined) return true
      if (element.printField?.role === 'listBox') return true
      const attributes = element.attributes ?? []
      for (let a = 0; a < attributes.length; a++) {
        const attribute = attributes[a]!
        if (PDF_20_STRUCTURE_ATTRIBUTE_OWNERS.has(attribute.owner)) return true
        if (attribute.owner === 'List' && (
          attribute.entries.ContinuedList !== undefined || attribute.entries.ContinuedFrom !== undefined
        )) return true
      }
    }
    for (let i = 0; i < this.gsValues.length; i++) {
      const params = this.gsValues[i]!.deviceParams
      if (params?.useBlackPointCompensation !== undefined || params?.halftoneOrigin !== undefined) return true
    }
    return false
  }

  // ─── Internal helpers ───

  /**
   * Standard-14 reference mode: text encodes to WinAnsi bytes (or raw codes
   * for Symbol/ZapfDingbats) and draws through a non-embedded simple Type1
   * font. Widths come from the built-in AFM metrics.
   */
  private drawStandardFontText(
    x: number, y: number,
    text: string,
    fontId: string, standardName: string, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void {
    if (options?.writingMode === 'vertical-rl' || options?.writingMode === 'vertical-lr') {
      throw new Error('Standard-14 fonts do not support vertical writing')
    }
    const metrics = getStandardFontMetrics(standardName)!
    const symbolic = standardName === 'Symbol' || standardName === 'ZapfDingbats'
    const bytes: number[] = []
    let widthUnits = 0
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      const code = symbolic ? cp : winAnsiCodeForCodePoint(cp)
      if (code === null || code > 255) {
        throw new Error(`Character U+${cp.toString(16).toUpperCase()} is outside the ${symbolic ? standardName : 'WinAnsi'} encoding`)
      }
      bytes.push(code)
      widthUnits += metrics.widths[code]!
    }
    const ref = this.ensureFontRef(fontId)
    const scale = fontSize / 1000
    const ascent = metrics.ascender * scale
    const baseline = y + (options?.baselineOffset ?? ascent)
    const horizontalScale = options?.horizontalScale ?? 1
    const textExtent = widthUnits * scale * horizontalScale

    const actualText = options?.actualText === undefined ? null : pdfUtf16BeHex(options.actualText)
    if (actualText !== null) this.currentOps.push(`/Span << /ActualText ${actualText} >> BDC`)
    // Same top-down convention as the embedded-font path: re-flip Y via Tm
    this.currentOps.push('BT')
    const textPaint = pdfTextPaint(color, options)
    this.pushTextPaint(textPaint)
    this.currentOps.push(`${ref} ${pn(fontSize)} Tf`)
    this.currentOps.push(`${pn(horizontalScale)} 0 0 -1 ${pn(x)} ${pn(baseline)} Tm`)
    let hex = ''
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i]!.toString(16).padStart(2, '0')
    }
    this.currentOps.push(`<${hex}> Tj`)
    this.currentOps.push('ET')
    if (actualText !== null) this.currentOps.push('EMC')
    if (options?.underline) {
      // AFM underline metrics: position -100, thickness 50 across the set
      const lineY = baseline + 100 * scale
      this.pushGraphicsState()
      this.pushStrokeColor(color)
      this.currentOps.push(`${pn(Math.max(50 * scale, 0.5))} w`)
      this.currentOps.push(`${pn(x)} ${pn(lineY)} m ${pn(x + textExtent)} ${pn(lineY)} l S`)
      this.popGraphicsState()
    }
    if (options?.strikethrough) {
      const lineY = baseline - metrics.capHeight * scale / 2
      this.pushGraphicsState()
      this.pushStrokeColor(color)
      this.currentOps.push(`${pn(Math.max(50 * scale, 0.5))} w`)
      this.currentOps.push(`${pn(x)} ${pn(lineY)} m ${pn(x + textExtent)} ${pn(lineY)} l S`)
      this.popGraphicsState()
    }
  }

  private pushTextPaint(paint: PdfTextPaint): void {
    if (paint.mode !== 'stroke') this.pushFillColor(paint.fillColor)
    if (paint.mode !== 'fill') {
      this.pushStrokeColor(paint.strokeColor)
      const lineWidth = pn(paint.strokeWidth)
      this.currentOps.push(`${lineWidth} w`)
      this.emittedGraphicsState.lineWidth = lineWidth
    }
    this.currentOps.push(`${paint.mode === 'fill' ? 0 : paint.mode === 'stroke' ? 1 : 2} Tr`)
  }

  private ensureFontRef(fontId: string, mode: 'embedded' | 'reference' = 'embedded'): string {
    const fontUseKey = mode === 'reference' ? `${fontId}\u0000reference` : fontId
    let ref = this.fontRefMap.get(fontUseKey)
    if (!ref) {
      ref = `/F${this.fontCounter++}`
      this.fontRefMap.set(fontUseKey, ref)
      this.fontUses.set(fontUseKey, { fontId, mode })
    }
    return ref
  }

  /**
   * Shapes annotation text before font subsetting so appearance glyphs enter the
   * same embedded subset and ToUnicode map as page text.
   */
  private prepareEmbeddedAnnotationAppearances(pdfa: PdfAConformance | undefined): Map<number, PreparedAnnotationAppearance> {
    const prepared = new Map<number, PreparedAnnotationAppearance>()
    for (let index = 0; index < this.annotations.length; index++) {
      const annotation = this.annotations[index]!
      if (isPreservedAnnotation(annotation)) continue
      if (annotation.subtype !== 'FreeText' && annotation.subtype !== 'Stamp') continue
      if (annotation.fontId === undefined) {
        if (pdfa !== undefined) throw new Error(`${pdfa} ${annotation.subtype} annotation requires an embedded appearance fontId`)
        continue
      }
      if (this.standardFonts.has(annotation.fontId)) {
        throw new Error(`PDF annotation appearance font must be embedded: ${annotation.fontId}`)
      }
      const font = this.fonts[annotation.fontId]
      if (font === undefined) throw new Error(`PDF annotation appearance font not found: ${annotation.fontId}`)
      const page = this.pageDataList[annotation.pageIndex]
      if (page === undefined) throw new Error(`PDF annotation page index ${annotation.pageIndex} out of range`)
      const fontResource = this.ensureFontRef(annotation.fontId)
      const appearance = annotation.subtype === 'FreeText'
        ? prepareFreeTextAppearance(annotation, page, font, fontResource)
        : prepareStampAppearance(annotation, page, font, fontResource)
      for (let lineIndex = 0; lineIndex < appearance.lines.length; lineIndex++) {
        const line = appearance.lines[lineIndex]!
        requirePdfTextRepresentableRun(line.run, `${annotation.subtype} annotation appearance`)
        this.trackGlyphRun(annotation.fontId, line.run, line.text)
      }
      prepared.set(index, appearance)
    }
    return prepared
  }

  private trackGlyph(fontId: string, codePoint: number, glyphId: number): void {
    let glyphSet = this.usedGlyphs.get(fontId)
    if (!glyphSet) {
      glyphSet = new Set()
      this.usedGlyphs.set(fontId, glyphSet)
    }
    glyphSet.add(glyphId)

    let cpMap = this.usedCodePoints.get(fontId)
    if (!cpMap) {
      cpMap = new Map()
      this.usedCodePoints.set(fontId, cpMap)
    }
    cpMap.set(codePoint, glyphId)
  }

  /**
   * Track the glyphs of a shaped run for subsetting and ToUnicode generation.
   * Shaped glyph IDs (ligatures, vertical alternates) enter the subset glyph set,
   * and each glyph records its source text so ToUnicode can map it back
   * (bfchar supports multi-code-unit targets for ligatures).
   */
  /**
   * Detects when a shaped run's glyph->source mapping cannot be represented by a
   * per-glyph /ToUnicode CMap: a single glyph id used for two different source
   * substrings within the run. Fonts that share a base skeleton across letters
   * (e.g. Arabic medial TA and BA differ only by dots, decomposed to one shared
   * base glyph + distinct dot glyphs) hit this — the shared glyph maps to one
   * code point via /ToUnicode, silently corrupting the other letter on
   * extraction. Returns true so the caller wraps the run in a /Span /ActualText
   * marked-content sequence (ISO 32000-1 14.9.4), which extractors honour over
   * the glyph-level CMap. Same skeleton mapping to the SAME char (e.g. "papa")
   * is not ambiguous and returns false.
   */
  private runSourceAmbiguous(run: RenderGlyphRun, text: string): boolean {
    const glyphIds = run.glyphIds
    const clusters = run.clusters
    const seen = new Map<number, string>()
    let ti = 0
    for (let gi = 0; gi < glyphIds.length; gi++) {
      const gid = glyphIds[gi]!
      const compCount = clusters[gi]!
      const start = ti
      for (let c = 0; c < compCount && ti < text.length; c++) {
        const cp = text.charCodeAt(ti)
        if (cp >= 0xD800 && cp <= 0xDBFF && ti + 1 < text.length) {
          const lo = text.charCodeAt(ti + 1)
          if (lo >= 0xDC00 && lo <= 0xDFFF) ti++
        }
        ti++
      }
      if (ti > start) {
        const sub = text.substring(start, ti)
        const prev = seen.get(gid)
        if (prev !== undefined) {
          if (prev !== sub) return true
        } else {
          seen.set(gid, sub)
        }
      }
    }
    return false
  }

  private trackGlyphRun(fontId: string, run: RenderGlyphRun, text: string): void {
    let glyphSet = this.usedGlyphs.get(fontId)
    if (!glyphSet) {
      glyphSet = new Set()
      this.usedGlyphs.set(fontId, glyphSet)
    }
    let cpMap = this.usedCodePoints.get(fontId)
    if (!cpMap) {
      cpMap = new Map()
      this.usedCodePoints.set(fontId, cpMap)
    }
    let srcMap = this.glyphSourceTexts.get(fontId)
    if (!srcMap) {
      srcMap = new Map()
      this.glyphSourceTexts.set(fontId, srcMap)
    }

    const glyphIds = run.glyphIds
    const clusters = run.clusters
    let ti = 0  // UTF-16 index into text
    for (let gi = 0; gi < glyphIds.length; gi++) {
      const gid = glyphIds[gi]!
      glyphSet.add(gid)

      const compCount = clusters[gi]!
      const start = ti
      let firstCp = -1
      for (let c = 0; c < compCount && ti < text.length; c++) {
        let cp = text.charCodeAt(ti)
        if (cp >= 0xD800 && cp <= 0xDBFF && ti + 1 < text.length) {
          const lo = text.charCodeAt(ti + 1)
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            cp = ((cp - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
            ti++
          }
        }
        ti++
        if (c === 0) firstCp = cp
      }

      if (compCount === 1 && firstCp >= 0) {
        cpMap.set(firstCp, gid)
      }
      if (ti > start && !srcMap.has(gid)) {
        srcMap.set(gid, text.substring(start, ti))
      }
    }
  }

  private appendPathCommands(commands: Uint8Array, coords: Float32Array): void {
    if (commands.length === 0) return
    let ci = 0
    for (let i = 0; i < commands.length; i++) {
      switch (commands[i]) {
        case 0:
          this.currentOps.push(`${pathCoordinate(coords[ci]!)} ${pathCoordinate(coords[ci + 1]!)} m`)
          ci += 2
          break
        case 1:
          this.currentOps.push(`${pathCoordinate(coords[ci]!)} ${pathCoordinate(coords[ci + 1]!)} l`)
          ci += 2
          break
        case 2:
          this.currentOps.push(
            `${pathCoordinate(coords[ci]!)} ${pathCoordinate(coords[ci + 1]!)} `
            + `${pathCoordinate(coords[ci + 2]!)} ${pathCoordinate(coords[ci + 3]!)} `
            + `${pathCoordinate(coords[ci + 4]!)} ${pathCoordinate(coords[ci + 5]!)} c`,
          )
          ci += 6
          break
        case 3:
          this.currentOps.push('h')
          break
        default:
          throw new Error(`Unknown path command: ${commands[i]}`)
      }
    }
    if (ci !== coords.length) throw new Error('Path coordinate count does not match commands')
  }

  /**
   * Emits the fill color selection ops. Native PDF color functions use their
   * matching color spaces unless conformance rules require a CMYK fallback.
   */
  private pushFillColor(color: string): void {
    if (this.emittedGraphicsState.fillColor === color) return
    const parsed = this.parseColor(color)
    if (parsed.spotName !== null && parsed.cmyk !== null) {
      const name = this.ensureSeparationColorSpace(parsed.spotName, parsed.cmyk)
      this.currentOps.push(`${name} cs`)
      this.currentOps.push('1 scn')
      this.emittedGraphicsState.fillColor = color
      return
    }
    if (parsed.deviceN !== null) {
      const name = this.ensureDeviceNColorSpace(parsed.deviceN)
      this.currentOps.push(`${name} cs`)
      this.currentOps.push(`${parsed.deviceN.tints.map(pn).join(' ')} scn`)
      this.emittedGraphicsState.fillColor = color
      return
    }
    if (parsed.cmyk !== null) {
      this.currentOps.push(`${pn(parsed.cmyk[0])} ${pn(parsed.cmyk[1])} ${pn(parsed.cmyk[2])} ${pn(parsed.cmyk[3])} k`)
      this.emittedGraphicsState.fillColor = color
      return
    }
    if (parsed.calibrated !== null && !this.pdfxConformance) {
      const name = this.ensureCalibratedColorSpace(parsed.calibrated)
      this.currentOps.push(`${name} cs`)
      this.currentOps.push(`${calibratedColorComponents(parsed.calibrated).map(pn).join(' ')} scn`)
      this.emittedGraphicsState.fillColor = color
      return
    }
    if (this.pdfxConformance) {
      const [c, m, y, k] = this.pdfxCmyk(parsed.r, parsed.g, parsed.b)
      this.currentOps.push(`${pn(c)} ${pn(m)} ${pn(y)} ${pn(k)} k`)
      this.emittedGraphicsState.fillColor = color
      return
    }
    if (this.colorProfile === 'srgb-icc') {
      const name = this.ensureIccColorSpace()
      this.currentOps.push(`${name} cs`)
      this.currentOps.push(`${pn(parsed.r)} ${pn(parsed.g)} ${pn(parsed.b)} scn`)
      this.emittedGraphicsState.fillColor = color
      return
    }
    if (parsed.r === parsed.g && parsed.g === parsed.b) {
      // Achromatic colors use the DeviceGray operator (ISO 32000 8.6.4.2)
      this.currentOps.push(`${pn(parsed.r)} g`)
      this.emittedGraphicsState.fillColor = color
      return
    }
    this.currentOps.push(`${pn(parsed.r)} ${pn(parsed.g)} ${pn(parsed.b)} rg`)
    this.emittedGraphicsState.fillColor = color
  }

  private pushStrokeColor(color: string): void {
    if (this.emittedGraphicsState.strokeColor === color) return
    const parsed = this.parseColor(color)
    if (parsed.spotName !== null && parsed.cmyk !== null) {
      const name = this.ensureSeparationColorSpace(parsed.spotName, parsed.cmyk)
      this.currentOps.push(`${name} CS`)
      this.currentOps.push('1 SCN')
      this.emittedGraphicsState.strokeColor = color
      return
    }
    if (parsed.deviceN !== null) {
      const name = this.ensureDeviceNColorSpace(parsed.deviceN)
      this.currentOps.push(`${name} CS`)
      this.currentOps.push(`${parsed.deviceN.tints.map(pn).join(' ')} SCN`)
      this.emittedGraphicsState.strokeColor = color
      return
    }
    if (parsed.cmyk !== null) {
      this.currentOps.push(`${pn(parsed.cmyk[0])} ${pn(parsed.cmyk[1])} ${pn(parsed.cmyk[2])} ${pn(parsed.cmyk[3])} K`)
      this.emittedGraphicsState.strokeColor = color
      return
    }
    if (parsed.calibrated !== null && !this.pdfxConformance) {
      const name = this.ensureCalibratedColorSpace(parsed.calibrated)
      this.currentOps.push(`${name} CS`)
      this.currentOps.push(`${calibratedColorComponents(parsed.calibrated).map(pn).join(' ')} SCN`)
      this.emittedGraphicsState.strokeColor = color
      return
    }
    if (this.pdfxConformance) {
      const [c, m, y, k] = this.pdfxCmyk(parsed.r, parsed.g, parsed.b)
      this.currentOps.push(`${pn(c)} ${pn(m)} ${pn(y)} ${pn(k)} K`)
      this.emittedGraphicsState.strokeColor = color
      return
    }
    if (this.colorProfile === 'srgb-icc') {
      const name = this.ensureIccColorSpace()
      this.currentOps.push(`${name} CS`)
      this.currentOps.push(`${pn(parsed.r)} ${pn(parsed.g)} ${pn(parsed.b)} SCN`)
      this.emittedGraphicsState.strokeColor = color
      return
    }
    if (parsed.r === parsed.g && parsed.g === parsed.b) {
      this.currentOps.push(`${pn(parsed.r)} G`)
      this.emittedGraphicsState.strokeColor = color
      return
    }
    this.currentOps.push(`${pn(parsed.r)} ${pn(parsed.g)} ${pn(parsed.b)} RG`)
    this.emittedGraphicsState.strokeColor = color
  }

  private parseColor(color: string): TemplateColor {
    let parsed = this.parsedColorCache.get(color)
    if (parsed === undefined) {
      parsed = parseTemplateColor(color)
      this.parsedColorCache.set(color, parsed)
    }
    return parsed
  }

  private resetEmittedGraphicsState(): void {
    this.emittedGraphicsState.fillColor = undefined
    this.emittedGraphicsState.strokeColor = undefined
    this.emittedGraphicsState.lineWidth = undefined
    this.emittedGraphicsState.lineCap = undefined
    this.emittedGraphicsState.lineJoin = undefined
    this.emittedGraphicsState.miterLimit = undefined
    this.emittedGraphicsState.dash = undefined
  }

  private pushGraphicsState(): void {
    this.currentOps.push('q')
    let state = this.emittedGraphicsStateStack[this.emittedGraphicsStateDepth]
    if (state === undefined) {
      state = {}
      this.emittedGraphicsStateStack.push(state)
    }
    copyPdfEmittedGraphicsState(this.emittedGraphicsState, state)
    this.emittedGraphicsStateDepth++
  }

  private popGraphicsState(): void {
    this.currentOps.push('Q')
    if (this.emittedGraphicsStateDepth > 0) {
      copyPdfEmittedGraphicsState(this.emittedGraphicsStateStack[--this.emittedGraphicsStateDepth]!, this.emittedGraphicsState)
    } else {
      this.resetEmittedGraphicsState()
    }
  }

  private ensureIccColorSpace(): string {
    if (this.iccColorSpaceName === null) this.iccColorSpaceName = '/CSicc'
    return this.iccColorSpaceName
  }

  private ensureDeviceNColorSpace(color: DeviceNColor): string {
    const key = deviceNColorKey(color)
    const existing = this.deviceNMap.get(key)
    if (existing) return existing
    const name = `/CSDN${this.deviceNDefs.length}`
    this.deviceNDefs.push({ name, color })
    this.deviceNMap.set(key, name)
    return name
  }

  private ensureCalibratedColorSpace(color: CalibratedColor): string {
    const key = calibratedColorKey(color)
    const existing = this.calibratedColorSpaceMap.get(key)
    if (existing) return existing
    const name = `/CSCal${this.calibratedColorSpaceDefs.length}`
    this.calibratedColorSpaceDefs.push({ name, color })
    this.calibratedColorSpaceMap.set(key, name)
    return name
  }

  private ensurePatternColorSpace(baseColorSpace: string): string {
    const existing = this.patternColorSpaceMap.get(baseColorSpace)
    if (existing) return existing
    const name = `/CSPat${this.patternColorSpaceDefs.length}`
    this.patternColorSpaceDefs.push({ name, baseColorSpace })
    this.patternColorSpaceMap.set(baseColorSpace, name)
    return name
  }

  private uncoloredPatternColor(paint: TilingPatternPaint): { colorSpaceName: string, components: string[] } {
    if (paint.color === undefined) {
      throw new Error('Uncolored tiling patterns require a use-site color')
    }
    const parsed = parseTemplateColor(paint.color)
    if (parsed.spotName !== null && parsed.cmyk !== null) {
      return {
        colorSpaceName: this.ensurePatternColorSpace(this.ensureSeparationColorSpace(parsed.spotName, parsed.cmyk)),
        components: ['1'],
      }
    }
    if (parsed.deviceN !== null) {
      return {
        colorSpaceName: this.ensurePatternColorSpace(this.ensureDeviceNColorSpace(parsed.deviceN)),
        components: parsed.deviceN.tints.map(pn),
      }
    }
    if (parsed.cmyk !== null) {
      return {
        colorSpaceName: this.ensurePatternColorSpace('/DeviceCMYK'),
        components: parsed.cmyk.map(pn),
      }
    }
    if (parsed.calibrated !== null && !this.pdfxConformance) {
      return {
        colorSpaceName: this.ensurePatternColorSpace(this.ensureCalibratedColorSpace(parsed.calibrated)),
        components: calibratedColorComponents(parsed.calibrated).map(pn),
      }
    }
    if (this.pdfxConformance) {
      const [c, m, y, k] = this.pdfxCmyk(parsed.r, parsed.g, parsed.b)
      return {
        colorSpaceName: this.ensurePatternColorSpace('/DeviceCMYK'),
        components: [pn(c), pn(m), pn(y), pn(k)],
      }
    }
    if (this.colorProfile === 'srgb-icc') {
      return {
        colorSpaceName: this.ensurePatternColorSpace(this.ensureIccColorSpace()),
        components: [pn(parsed.r), pn(parsed.g), pn(parsed.b)],
      }
    }
    if (parsed.r === parsed.g && parsed.g === parsed.b) {
      return {
        colorSpaceName: this.ensurePatternColorSpace('/DeviceGray'),
        components: [pn(parsed.r)],
      }
    }
    return {
      colorSpaceName: this.ensurePatternColorSpace('/DeviceRGB'),
      components: [pn(parsed.r), pn(parsed.g), pn(parsed.b)],
    }
  }

  private ensureOptionalContentGroup(group: RenderOptionalContent): string {
    const visible = group.visible !== false
    const print = group.print ?? visible
    const membershipKey = group.membership === undefined ? group.name : optionalContentMembershipKey(group.membership)
    const key = membershipKey + '|' + visible + '|' + print
    const existing = this.optionalContentMap.get(key)
    if (existing) return existing
    const name = `/OC${this.optionalContentDefs.length}`
    this.optionalContentDefs.push({ name, title: group.name, visible, print, content: group })
    this.optionalContentMap.set(key, name)
    return name
  }

  private pdfxCmyk(r: number, g: number, b: number): [number, number, number, number] {
    const transform = this.pdfxColorTransform
    const profile = this.pdfxOutputProfile
    if (transform === undefined || profile === undefined) throw new Error('PDF/X ICC color transform is not initialized')
    const converted = transform.fromRgb([r, g, b], profile.renderingIntent ?? 'RelativeColorimetric')
    if (converted.length !== 4) throw new Error('PDF/X ICC color transform did not produce four CMYK components')
    return [converted[0]!, converted[1]!, converted[2]!, converted[3]!]
  }

  private ensureSeparationColorSpace(spotName: string, cmyk: [number, number, number, number]): string {
    const key = spotName + '|' + cmyk.join(',')
    const existing = this.separationMap.get(key)
    if (existing) return existing
    const name = `/CS${this.separationDefs.length}`
    this.separationDefs.push({ name, spotName, cmyk })
    this.separationMap.set(key, name)
    return name
  }

  private pushPdfSpecialColor(color: PdfSpecialColorDef, stroke: boolean): void {
    const name = this.ensurePdfSpecialColorSpace(color.colorSpace)
    this.currentOps.push(`${name} ${stroke ? 'CS' : 'cs'}`)
    this.currentOps.push(`${color.components.map(pn).join(' ')} ${stroke ? 'SCN' : 'scn'}`)
  }

  private ensurePdfSpecialColorSpace(colorSpace: PdfSeparationColorSpaceDef | PdfDeviceNColorSpaceDef): string {
    const key = pdfSpecialColorKey(colorSpace)
    const existing = this.pdfSpecialColorMap.get(key)
    if (existing !== undefined) return existing
    const name = `/CSS${this.pdfSpecialColorDefs.length}`
    this.pdfSpecialColorDefs.push({ name, colorSpace })
    this.pdfSpecialColorMap.set(key, name)
    return name
  }

  private ensureGradientPattern(paint: GradientPaint): string {
    const key = gradientPaintKey(paint)
    const existing = this.gradientPatternMap.get(key)
    if (existing) return existing

    const shadingIndex = this.shadingDefs.length
    this.shadingDefs.push(gradientPaintToShadingDef(paint))

    const name = `/P${this.gradientPatternCounter++}`
    const shading = this.shadingDefs[shadingIndex]!
    this.gradientPatternDefs.push({ name, shadingIndex, matrix: shading.type === 'axial' || shading.type === 'radial' ? shading.matrix : undefined })
    this.gradientPatternMap.set(key, name)
    return name
  }

  /**
   * Mesh gradient / tiling pattern fills and strokes. Mesh gradients emit
   * native shading patterns (ShadingType 4 for triangles, 7 for tensor
   * patches — one scn each, painted in model order); tiling patterns emit a
   * native PatternType 1 cell stream.
   */
  private drawComplexPaintPath(
    commands: Uint8Array, coords: Float32Array,
    options: PathPaintOptions,
  ): void {
    const fill = options.fill
    if (fill !== undefined) {
      if (isComplexPaint(fill)) {
        if (fill.type === 'function-shading' && fill.paintOperator === 'sh') {
          this.pushGraphicsState()
          this.applyPathOpacity(options.fillOpacity ?? 1, 1)
          this.appendPathCommands(commands, coords)
          this.currentOps.push(options.fillRule === 'evenodd' ? 'W* n' : 'W n')
          this.currentOps.push({ type: 'shading', shadingIndex: this.ensureFunctionShadingIndex(fill, fill.matrix) })
          this.popGraphicsState()
          return
        }
        const names = this.ensureComplexPatterns(fill)
        for (let i = 0; i < names.length; i++) {
          this.pushGraphicsState()
          this.pushPatternFillColor(fill, names[i]!)
          this.applyPathOpacity(options.fillOpacity ?? 1, 1)
          this.appendPathCommands(commands, coords)
          this.currentOps.push(paintOp(true, false, options.fillRule))
          this.popGraphicsState()
        }
      } else {
        this.drawPathWithPaints(commands, coords, { ...options, stroke: undefined })
      }
    }
    const stroke = options.stroke
    if (stroke !== undefined) {
      if (isComplexPaint(stroke)) {
        const names = this.ensureComplexPatterns(stroke)
        for (let i = 0; i < names.length; i++) {
          this.pushGraphicsState()
          this.pushPatternStrokeColor(stroke, names[i]!)
          this.appendShapeStrokeStyle(options)
          this.applyPathOpacity(1, options.strokeOpacity ?? 1)
          this.appendPathCommands(commands, coords)
          this.currentOps.push('S')
          this.popGraphicsState()
        }
      } else {
        this.drawPathWithPaints(commands, coords, { ...options, fill: undefined })
      }
    }
  }

  private ensureComplexPatterns(paint: MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint): string[] {
    if (paint.type === 'function-shading') {
      return [this.ensureFunctionShadingPattern(paint)]
    }
    if (paint.type === 'mesh-gradient') {
      // Pattern space is the default page space: bake the current CTM
      // (including the page flip) into the mesh geometry
      const transformed = transformMeshPaint(paint, this.ctm as PaintMatrix)
      const key = meshPaintKey(transformed)
      const existing = this.meshPatternMap.get(key)
      if (existing) return existing
      const names: string[] = []
      const defs = encodeMeshShadingDefs(
        transformed,
        this.pdfxColorTransform,
        this.pdfxOutputProfile?.renderingIntent,
      )
      for (let i = 0; i < defs.length; i++) {
        const shadingIndex = this.shadingDefs.length
        this.shadingDefs.push(defs[i]!)
        const name = `/P${this.gradientPatternCounter++}`
        const def = defs[i]!
        this.gradientPatternDefs.push({ name, shadingIndex, matrix: def.type === 'mesh' ? def.matrix : def.patternMatrix })
        names.push(name)
      }
      this.meshPatternMap.set(key, names)
      return names
    }
    return [this.ensureTilingPattern(paint)]
  }

  private pushPatternFillColor(paint: MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint, patternName: string): void {
    this.emittedGraphicsState.fillColor = undefined
    if (paint.type === 'tiling-pattern' && paint.paintType === 'uncolored') {
      const color = this.uncoloredPatternColor(paint)
      this.currentOps.push(`${color.colorSpaceName} cs`)
      this.currentOps.push(`${color.components.join(' ')} ${patternName} scn`)
      return
    }
    this.currentOps.push('/Pattern cs')
    this.currentOps.push(`${patternName} scn`)
  }

  private pushPatternStrokeColor(paint: MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint, patternName: string): void {
    this.emittedGraphicsState.strokeColor = undefined
    if (paint.type === 'tiling-pattern' && paint.paintType === 'uncolored') {
      const color = this.uncoloredPatternColor(paint)
      this.currentOps.push(`${color.colorSpaceName} CS`)
      this.currentOps.push(`${color.components.join(' ')} ${patternName} SCN`)
      return
    }
    this.currentOps.push('/Pattern CS')
    this.currentOps.push(`${patternName} SCN`)
  }

  /** ShadingType 1 pattern: FunctionType 4 calculator or FunctionType 0 sampled function. */
  private ensureFunctionShadingPattern(paint: FunctionShadingPaint): string {
    // Pattern space is the default page space: compose the paint matrix
    // (domain -> page top-down) with the current CTM (including the flip)
    const matrix = multiplyPaintMatrix(this.ctm as PaintMatrix, paint.matrix)
    const key = functionShadingPaintKey(paint, matrix)
    const existing = this.functionShadingMap.get(key)
    if (existing) return existing
    const shadingIndex = this.ensureFunctionShadingIndex(paint, matrix)
    const name = `/P${this.gradientPatternCounter++}`
    this.gradientPatternDefs.push({ name, shadingIndex })
    this.functionShadingMap.set(key, name)
    return name
  }

  private ensureFunctionShadingIndex(paint: FunctionShadingPaint, matrix: PaintMatrix): number {
    const key = functionShadingPaintKey(paint, matrix)
    const existing = this.functionShadingIndexMap.get(key)
    if (existing !== undefined) return existing
    if (this.pdfxConformance !== undefined && !('sampled' in paint)) {
      throw new Error(`${this.pdfxConformance} cannot preserve an RGB calculator-function shading through a nonlinear ICC output transform; provide a sampled function`)
    }
    let shadingFunction: FunctionShadingFunctionPdf
    if ('sampled' in paint) {
      shadingFunction = this.pdfxColorTransform === undefined
        ? {
            kind: 'sampled',
            size: [paint.sampled.size[0], paint.sampled.size[1]],
            bitsPerSample: paint.sampled.bitsPerSample,
            range: paint.sampled.range.slice(),
            samples: paint.sampled.samples.slice(),
            encode: paint.sampled.encode,
            decode: paint.sampled.decode?.slice(),
          }
        : convertSampledFunctionShadingToCmyk(
            paint.sampled,
            this.pdfxColorTransform,
            this.pdfxOutputProfile?.renderingIntent,
          )
    } else {
      shadingFunction = { kind: 'calculator', expression: paint.expression }
    }
    const background = paint.background === undefined
      ? undefined
      : this.pdfxColorTransform === undefined
        ? paint.background.slice()
        : iccOutputCmyk(
            this.pdfxColorTransform,
            this.pdfxOutputProfile?.renderingIntent,
            paint.background[0],
            paint.background[1],
            paint.background[2],
          )
    const shadingIndex = this.shadingDefs.length
    this.shadingDefs.push({
      type: 'function',
      domain: paint.domain,
      matrix,
      background,
      bbox: paint.bbox,
      antiAlias: paint.antiAlias,
      function: shadingFunction,
      cmyk: this.pdfxConformance !== undefined,
    })
    this.functionShadingIndexMap.set(key, shadingIndex)
    return shadingIndex
  }

  private ensureTilingPattern(paint: TilingPatternPaint): string {
    const matrix = multiplyPaintMatrix(this.ctm as PaintMatrix, paint.matrix)
    const key = tilingPaintKey(paint, matrix)
    const existing = this.tilingPatternMap.get(key)
    if (existing) return existing

    // The cell content is produced by this backend's own drawing methods so
    // every graphic kind (colors, gradients, images) reuses the standard
    // plumbing. Pattern space equals our top-down user space (the composed
    // /Matrix carries the page flip), so the tracked CTM is identity while
    // the cell ops are recorded.
    const savedOps = this.currentOps
    const savedCtm = this.ctm
    const cellOps: PdfOp[] = []
    this.currentOps = cellOps
    this.ctm = [1, 0, 0, 1, 0, 0]
    try {
      for (let g = 0; g < paint.graphics.length; g++) this.drawTilingGraphic(paint.graphics[g]!, paint)
    } finally {
      this.currentOps = savedOps
      this.ctm = savedCtm
    }

    const name = `/P${this.gradientPatternCounter++}`
    this.tilingPatternPdfDefs.push({
      name,
      paintType: paint.paintType === 'uncolored' ? 2 : 1,
      tilingType: paint.tilingType ?? 1,
      bbox: paint.bbox,
      xStep: paint.xStep,
      yStep: paint.yStep,
      matrix,
      ops: cellOps,
    })
    this.tilingPatternMap.set(key, name)
    return name
  }

  private drawTilingGraphic(graphic: TileGraphic, paint: TilingPatternPaint): void {
    if (graphic.kind === 'text') {
      const color = paint.paintType === 'uncolored' ? this.uncoloredTilingColor(paint) : graphic.color
      if (this.fonts[graphic.fontId] === undefined && !this.standardFonts.has(graphic.fontId)) {
        throw new Error(`Tiling-pattern font not found: ${graphic.fontId}`)
      }
      this.drawText(graphic.x, graphic.y + graphic.fontSize, graphic.text, graphic.fontId, graphic.fontSize, color)
      return
    }
    if (graphic.kind === 'image') {
      if (paint.paintType === 'uncolored') throw new Error('Uncolored tiling patterns cannot contain images')
      this.drawImage(graphic.x, graphic.y, graphic.width, graphic.height, graphic.imageId)
      return
    }
    if (graphic.kind === 'group') {
      this.drawTilingGroup(graphic, paint)
      return
    }
    if (paint.paintType === 'uncolored') this.appendUncoloredTilePath(graphic)
    else this.drawPathWithPaints(graphic.commands, graphic.coords, { fill: graphic.fill, stroke: graphic.stroke, strokeWidth: graphic.strokeWidth, fillRule: graphic.fillRule })
  }

  private drawTilingGroup(group: TileGroupGraphic, paint: TilingPatternPaint): void {
    this.save()
    this.translate(group.x, group.y)
    if (group.affineTransform !== undefined) this.transform(...group.affineTransform)
    if (group.clipPath !== undefined) this.clipPath(group.clipPath.commands, group.clipPath.coords, group.clipPath.fillRule)
    if (group.blendMode !== undefined) this.setBlendMode(group.blendMode)
    if (group.overprintFill !== undefined || group.overprintStroke !== undefined || group.overprintMode !== undefined) {
      this.setOverprint(group.overprintFill === true, group.overprintStroke === true, group.overprintMode ?? 0)
    }
    if (group.renderingIntent !== undefined) this.setRenderingIntent(group.renderingIntent)
    if (group.alphaIsShape !== undefined || group.textKnockout !== undefined) {
      this.setTransparencyParameters(group.alphaIsShape, group.textKnockout)
    }
    if (group.optionalContent !== undefined) this.beginOptionalContent(group.optionalContent)
    if (group.deviceParams !== undefined) this.setDeviceParams(group.deviceParams)
    if (group.pdfForm !== undefined) {
      if (group.opacity !== undefined && group.opacity < 1) this.setOpacity(group.opacity)
      this.beginPdfForm(group.pdfForm)
      for (let i = 0; i < group.graphics.length; i++) this.drawTilingGraphic(group.graphics[i]!, paint)
      this.endPdfForm()
      if (group.optionalContent !== undefined) this.endOptionalContent()
      this.restore()
      return
    }
    const transparency = group.transparencyGroup === true || group.isolated === true || group.knockout === true || group.softMask !== undefined || (group.opacity !== undefined && group.opacity < 1)
    if (transparency) {
      if (group.softMask !== undefined) {
        this.beginSoftMask(group.softMask.type, group.width, group.height, group.softMask.backdrop, group.softMask.transferFunction, 0, 0, group.softMask.colorSpace, group.softMask.isolated, group.softMask.knockout)
        for (let i = 0; i < group.softMask.graphics.length; i++) this.drawTilingGraphic(group.softMask.graphics[i]!, paint)
        this.endSoftMask()
      }
      this.beginTransparencyGroup(group.width, group.height, {
        isolated: group.isolated === true,
        knockout: group.knockout === true,
        opacity: group.opacity,
        hasSoftMask: group.softMask !== undefined,
      })
    } else if (group.opacity !== undefined && group.opacity < 1) this.setOpacity(group.opacity)
    for (let i = 0; i < group.graphics.length; i++) this.drawTilingGraphic(group.graphics[i]!, paint)
    if (transparency) this.endTransparencyGroup()
    if (group.optionalContent !== undefined) this.endOptionalContent()
    this.restore()
  }

  private appendUncoloredTilePath(graphic: TilePathGraphic): void {
    const hasFill = graphic.fill !== undefined
    const hasStroke = graphic.stroke !== undefined
    if (!hasFill && !hasStroke) return
    if (hasFill && typeof graphic.fill !== 'string') {
      throw new Error('Uncolored tiling pattern fill must be a stencil color marker')
    }
    if (hasStroke && typeof graphic.stroke !== 'string') {
      throw new Error('Uncolored tiling pattern stroke must be a stencil color marker')
    }
    if (hasStroke) {
      this.appendShapeStrokeStyle({ strokeWidth: graphic.strokeWidth })
    }
    this.appendPathCommands(graphic.commands, graphic.coords)
    if (hasFill && hasStroke) {
      this.currentOps.push(graphic.fillRule === 'evenodd' ? 'B*' : 'B')
    } else if (hasFill) {
      this.currentOps.push(graphic.fillRule === 'evenodd' ? 'f*' : 'f')
    } else {
      this.currentOps.push('S')
    }
  }

  private uncoloredTilingColor(paint: TilingPatternPaint): string {
    if (paint.color === undefined) throw new Error('Uncolored tiling pattern requires a use-site color')
    return paint.color
  }

  private appendShapeStrokeStyle(options: ShapeDrawOptions | PathPaintOptions): void {
    const lineWidth = pn(options.strokeWidth ?? 1)
    if (this.emittedGraphicsState.lineWidth !== lineWidth) {
      this.currentOps.push(`${lineWidth} w`)
      this.emittedGraphicsState.lineWidth = lineWidth
    }
    const lineCap = pdfLineCap(options.strokeLinecap)
    if (this.emittedGraphicsState.lineCap !== lineCap) {
      this.currentOps.push(`${lineCap} J`)
      this.emittedGraphicsState.lineCap = lineCap
    }
    const lineJoin = pdfLineJoin(options.strokeLinejoin)
    if (this.emittedGraphicsState.lineJoin !== lineJoin) {
      this.currentOps.push(`${lineJoin} j`)
      this.emittedGraphicsState.lineJoin = lineJoin
    }
    const miter = options.strokeMiterLimit
    const miterLimit = pn(Number.isFinite(miter) ? Math.max(1, miter!) : 10)
    if (this.emittedGraphicsState.miterLimit !== miterLimit) {
      this.currentOps.push(`${miterLimit} M`)
      this.emittedGraphicsState.miterLimit = miterLimit
    }

    const dash = normalizeDashArray(options.strokeDasharray)
    const dashOffset = Number.isFinite(options.strokeDashoffset) ? options.strokeDashoffset! : 0
    if (dash && dash.length > 0) {
      let dashStr = ''
      for (let i = 0; i < dash.length; i++) {
        if (i > 0) dashStr += ' '
        dashStr += pn(dash[i]!)
      }
      const dashState = `[${dashStr}] ${pn(dashOffset)}`
      if (this.emittedGraphicsState.dash !== dashState) {
        this.currentOps.push(`${dashState} d`)
        this.emittedGraphicsState.dash = dashState
      }
    } else {
      if (this.emittedGraphicsState.dash !== '[] 0') {
        this.currentOps.push('[] 0 d')
        this.emittedGraphicsState.dash = '[] 0'
      }
    }
  }

  private applyPathOpacity(fillOpacity: number, strokeOpacity: number): void {
    const fill = clamp01(fillOpacity)
    const stroke = clamp01(strokeOpacity)
    if (fill >= 1 && stroke >= 1) return
    // PDF/A-1b and PDF/X-1a: transparency is prohibited
    if (this.pdfaConformance === 'PDF/A-1b' || this.pdfxConformance === 'PDF/X-1a') return

    const key = `f:${fill.toFixed(4)}|s:${stroke.toFixed(4)}`
    let name = this.gsMap.get(key)
    if (!name) {
      name = `/GS${this.gsCounter++}`
      this.gsMap.set(key, name)
      this.gsValues.push({ name, fillOpacity: fill, strokeOpacity: stroke })
    }
    this.currentOps.push(`${name} gs`)
  }

  /** Whether a glyph has an OT-SVG document or an embedded bitmap (forces path mode) */
  private hasSvgOrBitmapGlyph(font: Font, gid: number, fontSize: number): boolean {
    if (font.hasSvgGlyphs && font.getSvgGlyphDocument(gid) !== null) return true
    if (!font.hasEmbeddedBitmapGlyphs) return false
    const bitmap = font.getBitmapGlyphRender(gid, fontSize)
    if (bitmap === null) return false
    // A monochrome embedded bitmap ('mask', e.g. EBDT/EBLC) is a small-size
    // screen hint; when the font also has scalable outlines the outline is used
    // instead so PDF text stays selectable and resolution-independent. Color
    // bitmaps (sbix/CBDT PNG) and outline-less bitmap fonts still use the bitmap.
    if (bitmap.image === 'mask' && font.hasScalableOutlines) return false
    return true
  }

  /**
   * Draws an OT-SVG or embedded bitmap glyph following the color font
   * priority order (COLR handled by the caller): SVG → sbix/CBDT/EBDT.
   * OT-SVG documents go through the project SVG renderer as PDF vector ops;
   * bitmaps are embedded as image XObjects.
   * @returns true when the glyph was drawn
   */
  private drawSvgOrBitmapGlyph(
    font: Font, gid: number,
    glyphCx: number, glyphCy: number,
    fontSize: number, s: number, color: string, vertical: boolean,
  ): boolean {
    const svgSource = font.hasSvgGlyphs ? font.getSvgGlyphDocument(gid) : null
    if (svgSource !== null) {
      let doc = this.svgGlyphDocCache.get(svgSource)
      if (!doc) {
        doc = parseOpenTypeSvg(svgSource)
        this.svgGlyphDocCache.set(svgSource, doc)
      }
      renderSvgGlyph(doc, this, gid, glyphCx, glyphCy, s, font.metrics.unitsPerEm, { foregroundColor: color, paletteFont: font })
      return true
    }

    if (!font.hasEmbeddedBitmapGlyphs) return false
    const bitmap = prepareBitmapGlyph(font, gid, fontSize, fontSize, color, fontSize, 1, vertical)
    if (bitmap) {
      this.drawImageData(
        glyphCx + bitmap.left, glyphCy + bitmap.top,
        bitmap.width, bitmap.height,
        bitmap.data, bitmap.mimeType,
      )
      return !bitmap.drawOutlines
    }

    return false
  }

  /** Draw a glyph outline as a PDF path (for color glyphs) */
  private appendGlyphPath(
    commands: Uint8Array, coords: Float32Array,
    cx: number, baseY: number, s: number, horizontalScale: number,
    r: number, g: number, b: number,
    slant?: number, boldWidth?: number, textPaint?: PdfTextPaint,
  ): void {
    if (commands.length === 0) return
    const paint = textPaint !== undefined && textPaint.mode !== 'fill'
      ? textPaint
      : { mode: 'fill' as const, fillColor: rgb01ToHex(r, g, b), strokeColor: rgb01ToHex(r, g, b), strokeWidth: 0 }
    if (paint.mode !== 'stroke') this.pushFillColor(paint.fillColor)
    if (paint.mode !== 'fill') {
      this.pushStrokeColor(paint.strokeColor)
      const lineWidth = pn(paint.strokeWidth)
      this.currentOps.push(`${lineWidth} w`)
      this.emittedGraphicsState.lineWidth = lineWidth
    }
    const t = slant || 0
    let ci = 0
    for (let i = 0; i < commands.length; i++) {
      switch (commands[i]) {
        case 0: { // MoveTo
          const fx = coords[ci]!, fy = coords[ci + 1]!
          this.currentOps.push(`${pn(cx + (fx + fy * t) * s * horizontalScale)} ${pn(baseY - fy * s)} m`)
          ci += 2
          break
        }
        case 1: { // LineTo
          const fx = coords[ci]!, fy = coords[ci + 1]!
          this.currentOps.push(`${pn(cx + (fx + fy * t) * s * horizontalScale)} ${pn(baseY - fy * s)} l`)
          ci += 2
          break
        }
        case 2: { // CubicTo
          const fx1 = coords[ci]!, fy1 = coords[ci + 1]!
          const fx2 = coords[ci + 2]!, fy2 = coords[ci + 3]!
          const fx3 = coords[ci + 4]!, fy3 = coords[ci + 5]!
          this.currentOps.push(
            `${pn(cx + (fx1 + fy1 * t) * s * horizontalScale)} ${pn(baseY - fy1 * s)} ` +
            `${pn(cx + (fx2 + fy2 * t) * s * horizontalScale)} ${pn(baseY - fy2 * s)} ` +
            `${pn(cx + (fx3 + fy3 * t) * s * horizontalScale)} ${pn(baseY - fy3 * s)} c`,
          )
          ci += 6
          break
        }
        case 3: // Close
          this.currentOps.push('h')
          break
      }
    }
    if (paint.mode === 'stroke') {
      this.currentOps.push('S')
    } else if (paint.mode === 'fillStroke') {
      this.currentOps.push('B')
    } else if (boldWidth) {
      this.currentOps.push(`${pn(boldWidth)} w 1 j ${pn(r)} ${pn(g)} ${pn(b)} RG B`)
      this.emittedGraphicsState.lineWidth = pn(boldWidth)
      this.emittedGraphicsState.lineJoin = 1
      this.emittedGraphicsState.strokeColor = undefined
    } else {
      this.currentOps.push('f')
    }
  }

  private appendRoundedRect(
    x: number, y: number, w: number, h: number, radii: ResolvedRectCornerRadii,
  ): void {
    const kTopLeft = radii.topLeft * 0.5522847498
    const kTopRight = radii.topRight * 0.5522847498
    const kBottomRight = radii.bottomRight * 0.5522847498
    const kBottomLeft = radii.bottomLeft * 0.5522847498

    this.currentOps.push(`${pn(x + radii.topLeft)} ${pn(y)} m`)
    this.currentOps.push(`${pn(x + w - radii.topRight)} ${pn(y)} l`)
    if (radii.topRight > 0) {
      this.currentOps.push(
        `${pn(x + w - radii.topRight + kTopRight)} ${pn(y)} ` +
        `${pn(x + w)} ${pn(y + radii.topRight - kTopRight)} ` +
        `${pn(x + w)} ${pn(y + radii.topRight)} c`,
      )
    } else {
      this.currentOps.push(`${pn(x + w)} ${pn(y)} l`)
    }
    this.currentOps.push(`${pn(x + w)} ${pn(y + h - radii.bottomRight)} l`)
    if (radii.bottomRight > 0) {
      this.currentOps.push(
        `${pn(x + w)} ${pn(y + h - radii.bottomRight + kBottomRight)} ` +
        `${pn(x + w - radii.bottomRight + kBottomRight)} ${pn(y + h)} ` +
        `${pn(x + w - radii.bottomRight)} ${pn(y + h)} c`,
      )
    } else {
      this.currentOps.push(`${pn(x + w)} ${pn(y + h)} l`)
    }
    this.currentOps.push(`${pn(x + radii.bottomLeft)} ${pn(y + h)} l`)
    if (radii.bottomLeft > 0) {
      this.currentOps.push(
        `${pn(x + radii.bottomLeft - kBottomLeft)} ${pn(y + h)} ` +
        `${pn(x)} ${pn(y + h - radii.bottomLeft + kBottomLeft)} ` +
        `${pn(x)} ${pn(y + h - radii.bottomLeft)} c`,
      )
    } else {
      this.currentOps.push(`${pn(x)} ${pn(y + h)} l`)
    }
    this.currentOps.push(`${pn(x)} ${pn(y + radii.topLeft)} l`)
    if (radii.topLeft > 0) {
      this.currentOps.push(
        `${pn(x)} ${pn(y + radii.topLeft - kTopLeft)} ` +
        `${pn(x + radii.topLeft - kTopLeft)} ${pn(y)} ` +
        `${pn(x + radii.topLeft)} ${pn(y)} c`,
      )
    } else {
      this.currentOps.push(`${pn(x)} ${pn(y)} l`)
    }
    this.currentOps.push('h')
  }
}

function validateStructureElementReferences(elements: StructElement[]): void {
  const ids = new Map<string, StructElement>()
  for (let i = 0; i < elements.length; i++) {
    const id = elements[i]!.id
    if (id === undefined) continue
    if (id === '' || ids.has(id)) throw new Error(`PDF structure element IDs must be non-empty and unique: ${id}`)
    ids.set(id, elements[i]!)
  }
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.role === 'Ruby') {
      let bases = 0
      let rubyTexts = 0
      for (let c = 0; c < element.childIndices.length; c++) {
        const role = elements[element.childIndices[c]!]!.role
        if (role === 'RB') bases++
        else if (role === 'RT') rubyTexts++
        else if (role !== 'RP') throw new Error(`PDF Ruby structure contains invalid child role: ${role}`)
      }
      if (bases === 0 || rubyTexts === 0) throw new Error('PDF Ruby structure requires RB and RT children')
    } else if (element.role === 'Warichu') {
      let texts = 0
      for (let c = 0; c < element.childIndices.length; c++) {
        const role = elements[element.childIndices[c]!]!.role
        if (role === 'WT') texts++
        else if (role !== 'WP') throw new Error(`PDF Warichu structure contains invalid child role: ${role}`)
      }
      if (texts === 0) throw new Error('PDF Warichu structure requires a WT child')
    }
    let headers = element.headers
    if (headers === undefined) {
      const table = element.attributes?.find(function (attribute) { return attribute.owner === 'Table' })
      const rawHeaders = table?.entries.Headers
      if (rawHeaders !== undefined && isRawArray(rawHeaders)) {
        headers = rawHeaders.items.map(function (value) {
          if (typeof value !== 'object' || value === null || value.kind !== 'string') {
            throw new Error('PDF Table Headers entries must be byte strings')
          }
          return decodePdfTextStringBytes(value.bytes)
        })
      }
    }
    if (headers === undefined) continue
    for (let h = 0; h < headers.length; h++) {
      const target = ids.get(headers[h]!)
      if (target === undefined || target.role !== 'TH' || target === element) {
        throw new Error(`PDF table header association must reference a TH structure element ID: ${headers[h]}`)
      }
    }
  }
}

interface PdfDocumentPartPreparationState {
  pageNodeIds: number[]
  allNodeIds: number[]
  seenNodes: Set<PdfDocumentPart>
  previousLeafEnd: number
  maxDepth: number
  pageCount: number
  allocate: () => number
}

function preparePdfDocumentPartHierarchy(
  hierarchy: PdfDocumentPartHierarchy | undefined,
  compatibilityParts: PdfDocumentPart[] | undefined,
  pageCount: number,
  allocate: () => number,
): PreparedPdfDocumentPartHierarchy | undefined {
  if (hierarchy === undefined && (compatibilityParts === undefined || compatibilityParts.length === 0)) return undefined
  if (pageCount === 0) throw new Error('PDF document-part hierarchy requires at least one page')

  const compatibility = hierarchy === undefined
  const normalized = hierarchy ?? { root: { children: [compatibilityParts!] } }
  const rootDictionaryId = allocate()
  const state: PdfDocumentPartPreparationState = {
    pageNodeIds: new Array(pageCount).fill(0),
    allNodeIds: [],
    seenNodes: new Set<PdfDocumentPart>(),
    previousLeafEnd: -1,
    maxDepth: 0,
    pageCount,
    allocate,
  }
  const root = preparePdfDocumentPartNode(normalized.root, rootDictionaryId, 0, state)

  for (let pageIndex = 0; pageIndex < state.pageNodeIds.length; pageIndex++) {
    if (state.pageNodeIds[pageIndex] === 0) {
      throw new Error(`PDF document-part hierarchy does not assign page ${pageIndex}`)
    }
  }
  const nodeNameList = normalized.nodeNameList
  if (nodeNameList !== undefined) {
    if (nodeNameList.length !== state.maxDepth + 1) {
      throw new Error(`PDF document-part NodeNameList must contain ${state.maxDepth + 1} names`)
    }
    for (let i = 0; i < nodeNameList.length; i++) {
      if (!isXmlNmToken(nodeNameList[i]!)) {
        throw new Error(`PDF document-part NodeNameList entry ${i} is not an XML NMTOKEN`)
      }
    }
  }
  if (normalized.recordLevel !== undefined) {
    if (!Number.isInteger(normalized.recordLevel) || normalized.recordLevel < 0 || normalized.recordLevel > state.maxDepth) {
      throw new Error(`PDF document-part RecordLevel must be an integer from 0 through ${state.maxDepth}`)
    }
  }

  let actionNodeIds = state.allNodeIds.slice(1)
  if (compatibility) {
    actionNodeIds = []
    for (let i = 0; i < root.childGroups.length; i++) {
      const group = root.childGroups[i]!
      for (let k = 0; k < group.length; k++) actionNodeIds.push(group[k]!.id)
    }
  }
  return {
    rootId: root.id,
    rootDictionaryId,
    root,
    nodeNameList,
    recordLevel: normalized.recordLevel,
    pageNodeIds: state.pageNodeIds,
    actionNodeIds,
  }
}

function preparePdfDocumentPartNode(
  source: PdfDocumentPart,
  parentId: number,
  depth: number,
  state: PdfDocumentPartPreparationState,
): PreparedPdfDocumentPart {
  if (state.seenNodes.has(source)) throw new Error('PDF document-part node must have exactly one parent')
  state.seenNodes.add(source)
  if (depth > state.maxDepth) state.maxDepth = depth
  if (source.metadata !== undefined) validatePdfDocumentPartMetadata(source.metadata)

  const id = state.allocate()
  state.allNodeIds.push(id)
  const childGroups: PreparedPdfDocumentPart[][] = []
  if (source.children !== undefined) {
    if (source.startPage !== undefined || source.endPage !== undefined) {
      throw new Error('PDF document-part node must not contain both children and a page range')
    }
    if (source.children.length === 0) throw new Error('PDF document-part children must not be empty')
    for (let groupIndex = 0; groupIndex < source.children.length; groupIndex++) {
      const sourceGroup = source.children[groupIndex]!
      if (sourceGroup.length === 0) throw new Error('PDF document-part child group must not be empty')
      const group: PreparedPdfDocumentPart[] = []
      for (let childIndex = 0; childIndex < sourceGroup.length; childIndex++) {
        group.push(preparePdfDocumentPartNode(sourceGroup[childIndex]!, id, depth + 1, state))
      }
      childGroups.push(group)
    }
    return { id, parentId, source, childGroups }
  }

  const startPage = source.startPage
  if (!Number.isInteger(startPage)) throw new Error('PDF document-part leaf requires an integer startPage')
  const endPage = source.endPage ?? startPage
  if (!Number.isInteger(endPage) || startPage! < 0 || endPage! < startPage! || endPage! >= state.pageCount) {
    throw new Error('PDF document-part leaf has an out-of-range page span')
  }
  if (startPage! <= state.previousLeafEnd) {
    throw new Error('PDF document-part leaf ranges must follow page-tree order without overlap')
  }
  state.previousLeafEnd = endPage!
  for (let pageIndex = startPage!; pageIndex <= endPage!; pageIndex++) state.pageNodeIds[pageIndex] = id
  return { id, parentId, source, startPage, endPage, childGroups }
}

function validatePdfDocumentPartMetadata(metadata: Record<string, PdfDocumentPartMetadataValue>): void {
  const keys = Object.keys(metadata)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    validateUnicodeScalars(key, 'PDF document-part metadata key')
    validatePdfDocumentPartMetadataValue(metadata[key]!, new Set<object>())
  }
}

function validatePdfDocumentPartMetadataValue(value: PdfDocumentPartMetadataValue, path: Set<object>): void {
  if (typeof value === 'string') {
    validateUnicodeScalars(value, 'PDF document-part metadata string')
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PDF document-part metadata number must be finite')
    return
  }
  if (typeof value === 'boolean') return
  if (value instanceof Date) {
    formatPdfDate(value)
    return
  }
  if (value === null) throw new Error('PDF document-part metadata does not permit null')
  if (path.has(value)) throw new Error('PDF document-part metadata must not be circular')
  path.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) validatePdfDocumentPartMetadataValue(value[i]!, path)
  } else if (isPdfDocumentPartMetadataName(value)) {
    validateUnicodeScalars(value.value, 'PDF document-part metadata name')
  } else {
    const dictionary = value as Record<string, PdfDocumentPartMetadataValue>
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) {
      validateUnicodeScalars(keys[i]!, 'PDF document-part metadata dictionary key')
      validatePdfDocumentPartMetadataValue(dictionary[keys[i]!]!, path)
    }
  }
  path.delete(value)
}

function writePreparedPdfDocumentPart(w: PdfWriter, node: PreparedPdfDocumentPart, pageIds: number[]): void {
  for (let groupIndex = 0; groupIndex < node.childGroups.length; groupIndex++) {
    const group = node.childGroups[groupIndex]!
    for (let childIndex = 0; childIndex < group.length; childIndex++) {
      writePreparedPdfDocumentPart(w, group[childIndex]!, pageIds)
    }
  }
  const entries = ['/Type /DPart', `/Parent ${node.parentId} 0 R`]
  if (node.childGroups.length > 0) {
    const groups: string[] = []
    for (let groupIndex = 0; groupIndex < node.childGroups.length; groupIndex++) {
      const group = node.childGroups[groupIndex]!
      groups.push(`[${group.map(function (child) { return `${child.id} 0 R` }).join(' ')}]`)
    }
    entries.push(`/DParts [${groups.join(' ')}]`)
  } else {
    entries.push(`/Start ${pageIds[node.startPage!]!} 0 R`)
    if (node.endPage !== node.startPage) entries.push(`/End ${pageIds[node.endPage!]!} 0 R`)
  }
  if (node.source.metadata !== undefined) {
    const metadataEntries: string[] = []
    const keys = Object.keys(node.source.metadata)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!
      metadataEntries.push(`${encodePdfName(key)} ${pdfDocumentPartMetadataValuePdf(node.source.metadata[key]!)}`)
    }
    entries.push(`/DPM << ${metadataEntries.join(' ')} >>`)
  }
  w.writeDeferredDict(node.id, entries)
}

function pdfDocumentPartMetadataValuePdf(value: PdfDocumentPartMetadataValue): string {
  if (typeof value === 'string') return pdfString(value)
  if (typeof value === 'number') return pn(value)
  if (typeof value === 'boolean') return pdfBool(value)
  if (value instanceof Date) return pdfString(value)
  if (Array.isArray(value)) return `[${value.map(pdfDocumentPartMetadataValuePdf).join(' ')}]`
  if (isPdfDocumentPartMetadataName(value)) return encodePdfName(value.value)
  const dictionary = value as Record<string, PdfDocumentPartMetadataValue>
  const entries: string[] = []
  const keys = Object.keys(value)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    entries.push(`${encodePdfName(key)} ${pdfDocumentPartMetadataValuePdf(dictionary[key]!)}`)
  }
  return `<< ${entries.join(' ')} >>`
}

function isPdfDocumentPartMetadataName(value: object): value is { type: 'name', value: string } {
  return 'type' in value && value.type === 'name' && 'value' in value && typeof value.value === 'string'
}

// ─── PDF writer ───

class PdfWriter {
  private chunks: Uint8Array[] = []
  private pendingStrings: string[] = []
  private offset = 0
  private objectOffsets = new Map<number, number>()
  private nextId = 0
  private pdf20 = false

  // ObjStm: pack dict-only objects into an ObjStm
  private deferredDicts: { id: number; content: string }[] = []
  // Info about objects stored in ObjStms (for xref Type 2)
  compressedObjMap = new Map<number, { objstmId: number; index: number }>()

  allocId(): number {
    return ++this.nextId
  }

  writeHeader(version?: string): void {
    this.pdf20 = version === '2.0'
    this.writeStr(`%PDF-${version ?? '1.7'}\n%\xE2\xE3\xCF\xD3\n\n`)
  }

  beginObj(id: number): void {
    this.objectOffsets.set(id, this.offset)
    this.writeStr(`${id} 0 obj\n`)
  }

  endObj(): void {
    this.writeStr('endobj\n\n')
  }

  /** Writes a raw object body line (array objects etc.) */
  writeRawLine(content: string): void {
    this.writeStr(content + '\n')
  }

  writeDict(entries: string[]): void {
    this.writeStr('<< ')
    for (let i = 0; i < entries.length; i++) {
      this.writeStr(entries[i]! + ' ')
    }
    this.writeStr('>>\n')
  }

  writeStreamObj(dictStr: string, data: Uint8Array): void {
    this.writeStr(dictStr + '\nstream\n')
    this.writeBytes(data)
    this.writeStr('\nendstream\n')
  }

  /**
   * Buffer a dict-only object for the ObjStm.
   * Used instead of beginObj/writeDict/endObj.
   */
  writeDeferredDict(id: number, entries: string[]): void {
    let content = '<< '
    for (let i = 0; i < entries.length; i++) {
      content += entries[i]! + ' '
    }
    content += '>>'
    this.deferredDicts.push({ id, content })
  }

  /**
   * Pack the buffered dict objects into an ObjStm.
   * Call right before writing the xref stream.
   */
  writeObjStreams(enc?: EncryptionContext | null): void {
    if (this.deferredDicts.length === 0) return

    const objstmId = this.allocId()
    const dicts = this.deferredDicts

    // Header part: "id1 off1 id2 off2 ..." (each object's ID and offset within the body)
    // Body part: concatenated dict contents
    const bodyParts: string[] = []
    let bodyLength = 0
    const headerParts: string[] = []
    for (let i = 0; i < dicts.length; i++) {
      headerParts.push(`${dicts[i]!.id} ${bodyLength}`)
      const body = expandPdfTextPlaceholders(dicts[i]!.content, this.pdf20) + '\n'
      bodyParts.push(body)
      bodyLength += body.length
      this.compressedObjMap.set(dicts[i]!.id, { objstmId, index: i })
    }
    const header = headerParts.join(' ') + ' '
    const raw = header + bodyParts.join('')
    const rawBytes = encodeAscii(raw)
    const compressed = zlibDeflate(rawBytes)
    const useFlate = compressed.length < rawBytes.length
    let streamData = useFlate ? compressed : rawBytes

    let dict = `<< /Type /ObjStm /N ${dicts.length} /First ${header.length}`
    if (useFlate) dict += ' /Filter /FlateDecode'
    if (enc) streamData = enc.encryptStream(objstmId, 0, streamData)
    dict += ` /Length ${streamData.length} >>`

    this.beginObj(objstmId)
    this.writeStreamObj(dict, streamData)
    this.endObj()
  }

  /**
   * Write the buffered dict objects out directly as regular objects.
   * PDF/A-1b cannot use ObjStm, so serialization goes through this path.
   */
  writeDirectDicts(): void {
    for (let i = 0; i < this.deferredDicts.length; i++) {
      const d = this.deferredDicts[i]!
      this.beginObj(d.id)
      this.writeStr(d.content + '\n')
      this.endObj()
    }
    this.deferredDicts = []
  }

  /**
   * Traditional xref table + trailer (PDF 1.4)
   * PDF/A-1b cannot use xref streams, so an ASCII table is used.
   */
  writeTraditionalXref(rootId: number, infoId: number, fileId?: string): void {
    const xrefOffset = this.offset

    const size = this.nextId + 1
    this.writeStr('xref\n')
    this.writeStr(`0 ${size}\n`)

    const freeObjects: number[] = []
    for (let i = 1; i < size; i++) {
      if (!this.objectOffsets.has(i)) freeObjects.push(i)
    }
    this.writeStr(`${String(freeObjects[0] ?? 0).padStart(10, '0')} 65535 f \n`)

    // Entries 1..nextId
    let freeIndex = 0
    for (let i = 1; i < size; i++) {
      const off = this.objectOffsets.get(i)
      if (off !== undefined) {
        this.writeStr(off.toString().padStart(10, '0') + ' 00000 n \n')
      } else {
        this.writeStr(`${String(freeObjects[freeIndex + 1] ?? 0).padStart(10, '0')} 00000 f \n`)
        freeIndex++
      }
    }

    // Trailer
    let trailer = `<< /Size ${size} /Root ${rootId} 0 R`
    if (infoId) trailer += ` /Info ${infoId} 0 R`
    if (fileId) trailer += ` /ID [<${fileId}> <${fileId}>]`
    trailer += ' >>'

    this.writeStr('trailer\n')
    this.writeStr(trailer + '\n')
    this.writeStr('startxref\n')
    this.writeStr(`${xrefOffset}\n`)
    this.writeStr('%%EOF\n')
  }

  /**
   * Cross-reference stream (PDF 1.5+, ISO 32000-1 §7.5.8)
   *
   * Emits a binary xref stream instead of the traditional ASCII xref table.
   * The xref stream itself also serves as the trailer.
   * Compressed with FlateDecode to reduce file size.
   *
   * @param rootId - Catalog object ID
   * @param infoId - Info dict object ID (0 = none)
   * @param encryptId - Encrypt object ID (0 = none)
   * @param fileId - file identifier hex (encryption only)
   */
  writeXrefStream(rootId: number, infoId: number, encryptId: number, fileId?: string): void {
    // Reserve an object ID for the xref stream itself
    const xrefObjId = this.allocId()
    const xrefOffset = this.offset

    const size = this.nextId + 1 // 0 (free) + all objects + the xref stream itself
    const hasCompressed = this.compressedObjMap.size > 0

    // W[1] field width: byte offset for Type 1, ObjStm ID for Type 2
    let maxW1Value = xrefOffset
    for (const off of this.objectOffsets.values()) {
      if (off > maxW1Value) maxW1Value = off
    }
    // W[1] of a Type 2 entry is the ObjStm ID (usually a small value)
    for (const info of this.compressedObjMap.values()) {
      if (info.objstmId > maxW1Value) maxW1Value = info.objstmId
    }

    const w1 = maxW1Value <= 0xFF ? 1
             : maxW1Value <= 0xFFFF ? 2
             : maxW1Value <= 0xFFFFFF ? 3
             : 4

    // W[2] field width: generation 65535 for free object 0 and the ObjStm index.
    // Two bytes are always required to represent object 0's mandatory generation.
    let w2 = 2
    if (hasCompressed) {
      let maxIndex = 0
      for (const info of this.compressedObjMap.values()) {
        if (info.index > maxIndex) maxIndex = info.index
      }
      if (maxIndex > 0xFFFF) w2 = maxIndex <= 0xFFFFFF ? 3 : 4
    }

    const entrySize = 1 + w1 + w2
    const freeObjects: number[] = []
    for (let i = 1; i < size; i++) {
      if (i !== xrefObjId && !this.objectOffsets.has(i) && !this.compressedObjMap.has(i)) freeObjects.push(i)
    }

    // Build the binary entries
    const rawData = new Uint8Array(size * entrySize)
    let pos = 0

    // Entry 0: free-list head (type=0, generation=65535)
    rawData[pos++] = 0 // type = free
    const firstFree = freeObjects[0] ?? 0
    for (let j = w1 - 1; j >= 0; j--) rawData[pos++] = (firstFree >> (j * 8)) & 0xFF
    for (let j = w2 - 1; j >= 0; j--) rawData[pos++] = j < 2 ? 0xFF : 0

    // Entries 1..nextId
    let freeIndex = 0
    for (let i = 1; i < size; i++) {
      const compressed = this.compressedObjMap.get(i)
      if (compressed) {
        // Type 2: object inside an ObjStm
        rawData[pos++] = 2
        // W[1]: ObjStm object number
        for (let j = w1 - 1; j >= 0; j--) {
          rawData[pos++] = (compressed.objstmId >> (j * 8)) & 0xFF
        }
        // W[2]: index within the ObjStm
        for (let j = w2 - 1; j >= 0; j--) {
          rawData[pos++] = (compressed.index >> (j * 8)) & 0xFF
        }
      } else if (i === xrefObjId || this.objectOffsets.has(i)) {
        // Type 1: regular object
        const off = i === xrefObjId ? xrefOffset : (this.objectOffsets.get(i) ?? 0)
        rawData[pos++] = 1
        for (let j = w1 - 1; j >= 0; j--) {
          rawData[pos++] = (off >> (j * 8)) & 0xFF
        }
        for (let j = 0; j < w2; j++) rawData[pos++] = 0 // generation = 0
      } else {
        rawData[pos++] = 0
        const next = freeObjects[freeIndex + 1] ?? 0
        for (let j = w1 - 1; j >= 0; j--) rawData[pos++] = (next >> (j * 8)) & 0xFF
        for (let j = 0; j < w2; j++) rawData[pos++] = 0
        freeIndex++
      }
    }

    // FlateDecode compression
    const compressed = zlibDeflate(rawData)
    const useCompression = compressed.length < rawData.length
    const streamData = useCompression ? compressed : rawData

    // xref stream dictionary
    let dict = `<< /Type /XRef /Size ${size} /W [1 ${w1} ${w2}] /Root ${rootId} 0 R`
    if (infoId) dict += ` /Info ${infoId} 0 R`
    if (encryptId) dict += ` /Encrypt ${encryptId} 0 R`
    if (fileId) dict += ` /ID [<${fileId}> <${fileId}>]`
    if (useCompression) dict += ' /Filter /FlateDecode'
    dict += ` /Length ${streamData.length} >>`

    // Write the xref stream object
    this.objectOffsets.set(xrefObjId, xrefOffset)
    this.writeStr(`${xrefObjId} 0 obj\n`)
    this.writeStreamObj(dict, streamData)
    this.writeStr('endobj\n\n')

    this.writeStr('startxref\n')
    this.writeStr(`${xrefOffset}\n`)
    this.writeStr('%%EOF\n')
  }

  toUint8Array(): Uint8Array {
    this.flushPendingStrings()
    let total = 0
    for (let i = 0; i < this.chunks.length; i++) {
      total += this.chunks[i]!.length
    }
    const result = new Uint8Array(total)
    let pos = 0
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!
      result.set(chunk, pos)
      pos += chunk.length
    }
    return result
  }

  private writeStr(s: string): void {
    const expanded = expandPdfTextPlaceholders(s, this.pdf20)
    this.pendingStrings.push(expanded)
    this.offset += expanded.length
  }

  private writeBytes(data: Uint8Array): void {
    this.flushPendingStrings()
    this.chunks.push(data)
    this.offset += data.length
  }

  private flushPendingStrings(): void {
    if (this.pendingStrings.length === 0) return
    this.chunks.push(encodeAscii(this.pendingStrings.join('')))
    this.pendingStrings.length = 0
  }
}

// ─── COLR v1 PDF implementation ───

/** Shading definition (converted to a PDF object in toUint8Array()) */
interface GradientShadingDef {
  type: 'axial' | 'radial'
  coords: number[]  // axial: [x0,y0,x1,y1], radial: [x0,y0,r0,x1,y1,r1]
  stops: PdfGradientStop[]
  extend: [boolean, boolean]
  pdfShading?: import('../types/template.js').PdfAxialRadialShadingDef
  matrix?: PaintMatrix
}

interface PdfGradientStop {
  offset: number
  r: number
  g: number
  b: number
  cmyk?: [number, number, number, number]
  specialColor?: boolean
}

/** Mesh shading with a pre-encoded packed vertex/patch stream */
interface MeshShadingDef {
  type: 'mesh'
  /** 4 = free-form triangles, 5 = lattice-form, 6 = Coons patches, 7 = tensor-product patches */
  shadingType: 4 | 5 | 6 | 7
  /** ShadingType 5 only: /VerticesPerRow */
  verticesPerRow?: number
  data: Uint8Array
  /** [xmin xmax ymin ymax (0 1) x components] */
  decode: number[]
  /** DeviceCMYK data (PDF/X) instead of DeviceRGB */
  cmyk: boolean
  bitsPerCoordinate?: 1 | 2 | 4 | 8 | 12 | 16 | 24 | 32
  bitsPerComponent?: 1 | 2 | 4 | 8 | 12 | 16
  bitsPerFlag?: 2 | 4 | 8
  functions?: PdfFunctionDef[]
  colorSpace?: PdfShadingColorSpaceDef
  background?: number[]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
  matrix?: PaintMatrix
  pdfShading?: import('../types/template.js').PdfMeshShadingDef
}

type ShadingDef = GradientShadingDef | MeshShadingDef | FunctionShadingDefPdf | RetainedFunctionShadingDefPdf

interface RetainedFunctionShadingDefPdf {
  type: 'retained-function'
  domain: [number, number, number, number]
  shadingMatrix: PaintMatrix
  patternMatrix: PaintMatrix
  functions: PdfFunctionDef[]
  colorSpace: PdfShadingColorSpaceDef
  background?: number[]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
}

/** ShadingType 1 (function-based) shading */
interface FunctionShadingDefPdf {
  type: 'function'
  domain: [number, number, number, number]
  matrix: PaintMatrix
  background?: number[]
  bbox?: [number, number, number, number]
  antiAlias?: boolean
  function: FunctionShadingFunctionPdf
  cmyk: boolean
}

type FunctionShadingFunctionPdf =
  | { kind: 'calculator', expression: string }
  | {
      kind: 'sampled'
      size: [number, number]
      bitsPerSample: 1 | 2 | 4 | 8 | 12 | 16 | 24 | 32
      range: number[]
      samples: number[]
      encode?: [number, number, number, number]
      decode?: number[]
    }

/** Spot color as a Separation color space with a CMYK alternate */
interface SeparationDef {
  name: string
  spotName: string
  cmyk: [number, number, number, number]
}

/** DeviceN color space with a constant CMYK alternate for the emitted tint vector */
interface DeviceNDef {
  name: string
  color: DeviceNColor
}

interface PdfSpecialColorSpaceRecord {
  name: string
  colorSpace: PdfSeparationColorSpaceDef | PdfDeviceNColorSpaceDef
}

function pdfSpecialColorKey(colorSpace: PdfSeparationColorSpaceDef | PdfDeviceNColorSpaceDef): string {
  return JSON.stringify(colorSpace)
}

/** CalGray/CalRGB/Lab color space referenced from page resources */
interface CalibratedColorSpaceDef {
  name: string
  color: CalibratedColor
}

interface OptionalContentDef {
  name: string
  title: string
  visible: boolean
  print: boolean
  content: RenderOptionalContent
}

/** Tiling pattern cell recorded as backend ops, emitted as a PatternType 1 stream */
interface TilingPatternPdfDef {
  name: string
  paintType: 1 | 2
  tilingType: 1 | 2 | 3
  bbox: [number, number, number, number]
  xStep: number
  yStep: number
  matrix: [number, number, number, number, number, number]
  ops: PdfOp[]
}

/** Uncolored Pattern color space resource: [/Pattern baseColorSpace] */
interface PatternColorSpaceDef {
  name: string
  baseColorSpace: string
}

interface GradientPatternDef {
  name: string // "/P0"
  shadingIndex: number
  matrix?: PaintMatrix
}

/** Lazily evaluated operation for Shading drawing */
interface ShadingOp {
  type: 'shading'
  shadingIndex: number
}

/** ExtGState entry */
interface ExtGStateEntry {
  name: string
  fillOpacity?: number
  strokeOpacity?: number
  blendMode?: string
  overprintFill?: boolean
  overprintStroke?: boolean
  overprintMode?: OverprintMode
  renderingIntent?: RenderingIntent
  alphaIsShape?: boolean
  textKnockout?: boolean
  deviceParams?: RenderDeviceParams
}

/** Container roles: no BDC/EMC output to the content stream (structure tree only) */
const CONTAINER_ROLES = new Set([
  'Document', 'DocumentFragment', 'Part', 'Art', 'Sect', 'Div', 'Aside',
  'BlockQuote', 'Caption', 'TOC', 'TOCI', 'Index', 'NonStruct', 'Private',
  'Table', 'TR', 'THead', 'TBody', 'TFoot',
  'L', 'LI',
  'Ruby', 'Warichu',
])

const PDF_20_STRUCTURE_TYPES = new Set([
  'Title', 'FENote', 'Sub', 'Em', 'Strong', 'DocumentFragment', 'Aside', 'Artifact',
])

function isContainerRole(role: string): boolean {
  return CONTAINER_ROLES.has(role)
}

function validatePdfStructureRoleMap(roleMap: Record<string, string>): void {
  for (const custom of Object.keys(roleMap)) {
    if (custom === '' || isDefaultStructureRole(custom)) {
      throw new Error(`PDF RoleMap key must be a non-standard structure role: ${custom}`)
    }
    const visited = new Set<string>([custom])
    let target = roleMap[custom]!
    while (!isDefaultStructureRole(target)) {
      if (target === '' || visited.has(target)) throw new Error(`PDF RoleMap contains a cycle or empty target at ${custom}`)
      visited.add(target)
      const next = roleMap[target]
      if (next === undefined) throw new Error(`PDF RoleMap target does not resolve to a standard structure role: ${target}`)
      target = next
    }
  }
}

function validatePdfStructureNamespaces(namespaces: StructureNamespaceDefinition[]): void {
  for (let i = 0; i < namespaces.length; i++) {
    const namespace = namespaces[i]!
    if (namespace.schemaFileIndex !== undefined && (!Number.isInteger(namespace.schemaFileIndex) || namespace.schemaFileIndex < 0)) {
      throw new Error(`PDF structure namespace schema-file index is invalid: ${namespace.schemaFileIndex}`)
    }
    if (namespace.schemaFileIndex !== undefined && namespace.schema !== undefined) {
      throw new Error('PDF structure namespace schemaFileIndex and schema are mutually exclusive')
    }
    if (namespace.schema !== undefined) validateStructureAttributeValue(namespace.schema)
    const roleMap = namespace.roleMap
    if (roleMap === undefined) continue
    for (const role of Object.keys(roleMap)) {
      if (role === '') throw new Error('PDF namespace RoleMapNS key must not be empty')
      if ((namespace.uri === DEFAULT_STRUCTURE_NAMESPACE && isDefaultStructureRole(role))
        || (namespace.uri === PDF_20_STRUCTURE_NAMESPACE && isPdf20StructureRole(role))) {
        throw new Error(`PDF namespace RoleMapNS may not remap a standard role in its own namespace: ${role}`)
      }
      const target = roleMap[role]!
      const targetRole = typeof target === 'string' ? target : target.role
      const targetNamespace = typeof target === 'string' ? undefined : target.namespaceIndex
      if (targetRole === '') throw new Error(`PDF namespace RoleMapNS target must not be empty: ${role}`)
      if (targetNamespace !== undefined && (
        !Number.isInteger(targetNamespace) || targetNamespace < 0 || targetNamespace >= namespaces.length
      )) throw new Error(`PDF namespace RoleMapNS target namespace is out of range: ${targetNamespace}`)
      if (targetNamespace === undefined && !isDefaultStructureRole(targetRole)) {
        throw new Error(`PDF namespace RoleMapNS default-namespace target is not a standard role: ${targetRole}`)
      }
    }
  }
  for (let namespaceIndex = 0; namespaceIndex < namespaces.length; namespaceIndex++) {
    const roleMap = namespaces[namespaceIndex]!.roleMap
    if (roleMap === undefined) continue
    for (const role of Object.keys(roleMap)) {
      const visited = new Set<string>()
      let currentRole = role
      let currentNamespace: number | undefined = namespaceIndex
      while (currentNamespace !== undefined) {
        const key = `${currentNamespace}:${currentRole}`
        if (visited.has(key)) throw new Error(`PDF namespace RoleMapNS contains a cycle at ${role}`)
        visited.add(key)
        const target: string | StructureNamespaceRoleTarget | undefined = namespaces[currentNamespace]!.roleMap?.[currentRole]
        if (target === undefined) break
        currentRole = typeof target === 'string' ? target : target.role
        currentNamespace = typeof target === 'string' ? undefined : target.namespaceIndex
      }
      if (currentNamespace !== undefined) {
        validateStructureRoleForNamespace(currentRole, currentNamespace, namespaces)
      }
    }
  }
}

function validateStructureRoleForNamespace(
  role: string,
  namespaceIndex: number | undefined,
  namespaces: StructureNamespaceDefinition[] | undefined,
): void {
  if (namespaceIndex === undefined || namespaces === undefined) return
  const namespace = namespaces[namespaceIndex]!
  if (namespace.uri === DEFAULT_STRUCTURE_NAMESPACE && !isDefaultStructureRole(role) && namespace.roleMap?.[role] === undefined) {
    throw new Error(`PDF 1.7 standard namespace does not define structure role: ${role}`)
  }
  if (namespace.uri === PDF_20_STRUCTURE_NAMESPACE && !isPdf20StructureRole(role) && namespace.roleMap?.[role] === undefined) {
    throw new Error(`PDF 2.0 standard namespace does not define structure role: ${role}`)
  }
}

function resolvePdfStructureRole(role: string, roleMap: Record<string, string> | undefined): string {
  if (roleMap === undefined) return role
  let resolved = role
  while (roleMap[resolved] !== undefined) resolved = roleMap[resolved]!
  return resolved
}

function resolvePdfStructureRoleAcrossNamespaces(
  role: string,
  namespaceIndex: number | undefined,
  roleMap: Record<string, string> | undefined,
  namespaces: StructureNamespaceDefinition[] | undefined,
): string {
  if (namespaceIndex === undefined) return resolvePdfStructureRole(role, roleMap)
  let currentRole = role
  let currentNamespace: number | undefined = namespaceIndex
  const visited = new Set<string>()
  while (currentNamespace !== undefined && namespaces !== undefined) {
    const key = `${currentNamespace}:${currentRole}`
    if (visited.has(key)) throw new Error(`PDF namespace RoleMapNS contains a cycle at ${role}`)
    visited.add(key)
    const target: string | StructureNamespaceRoleTarget | undefined = namespaces[currentNamespace]!.roleMap?.[currentRole]
    if (target === undefined) return currentRole
    currentRole = typeof target === 'string' ? target : target.role
    currentNamespace = typeof target === 'string' ? undefined : target.namespaceIndex
  }
  return currentRole
}

function validateArtifactTag(tag: StructureTag): void {
  const hasArtifactProperties = tag.artifactType !== undefined || tag.artifactSubtype !== undefined
    || tag.artifactBBox !== undefined || tag.artifactAttached !== undefined
  if (tag.role !== 'Artifact') {
    if (hasArtifactProperties) throw new Error('PDF artifact properties require the Artifact role')
    return
  }
  if (tag.artifactSubtype !== undefined && tag.artifactType !== 'Pagination') {
    throw new Error('PDF artifact Subtype requires Type Pagination')
  }
  if (tag.artifactBBox !== undefined) {
    if (tag.artifactBBox[0] > tag.artifactBBox[2] || tag.artifactBBox[1] > tag.artifactBBox[3]) {
      throw new Error('PDF artifact BBox must be ordered')
    }
    for (let i = 0; i < tag.artifactBBox.length; i++) {
      if (!Number.isFinite(tag.artifactBBox[i])) throw new Error('PDF artifact BBox must be finite')
    }
  }
  if (tag.artifactAttached !== undefined) {
    if (tag.artifactAttached.length === 0) throw new Error('PDF artifact Attached must not be empty')
    const edges = new Set(tag.artifactAttached)
    if (edges.size !== tag.artifactAttached.length) throw new Error('PDF artifact Attached must not contain duplicate edges')
  }
}

const PDF_STRUCTURE_ATTRIBUTE_KEYS: Record<string, Set<string>> = {
  Layout: new Set([
    'Placement', 'WritingMode', 'BackgroundColor', 'BorderColor', 'BorderStyle', 'BorderThickness', 'Padding', 'Color',
    'SpaceBefore', 'SpaceAfter', 'StartIndent', 'EndIndent', 'TextIndent', 'TextAlign', 'BBox', 'Width', 'Height',
    'BlockAlign', 'InlineAlign', 'TBorderStyle', 'TPadding', 'BaselineShift', 'LineHeight', 'TextDecorationColor',
    'TextDecorationThickness', 'TextDecorationType', 'RubyAlign', 'RubyPosition', 'GlyphOrientationVertical',
    'ColumnCount', 'ColumnGap', 'ColumnWidths',
  ]),
  List: new Set(['ListNumbering', 'ContinuedList', 'ContinuedFrom']),
  PrintField: new Set(['Role', 'checked', 'Desc']),
  Table: new Set(['RowSpan', 'ColSpan', 'Headers', 'Scope']),
  Artifact: new Set(['Type', 'BBox', 'Attached', 'Subtype']),
}

const STANDARD_STRUCTURE_ATTRIBUTE_OWNERS = new Set([
  'ARIA-1.1', 'Artifact', 'CSS-1', 'CSS-2', 'CSS-3', 'HTML-3.20', 'HTML-4.01', 'HTML-5.00',
  'Layout', 'List', 'NSO', 'OEB-1.00', 'PrintField', 'RDFa-1.10', 'RTF-1.05', 'Table', 'XML-1.00',
])

const PDF_20_STRUCTURE_ATTRIBUTE_OWNERS = new Set(['ARIA-1.1', 'Artifact', 'CSS-3', 'HTML-5.00', 'NSO', 'RDFa-1.10'])

function validatePdfStructureTagAttributes(tag: StructureTag): void {
  if (tag.phoneme !== undefined && tag.phoneme === '') throw new Error('PDF structure phoneme must not be empty')
  if (tag.phoneticAlphabet !== undefined && tag.phoneme === undefined) {
    throw new Error('PDF structure phoneticAlphabet requires phoneme')
  }
  if (tag.phoneticAlphabet !== undefined && !['ipa', 'x-sampa', 'zh-Latn-pinyin', 'zh-Latn-wadegile'].includes(tag.phoneticAlphabet)) {
    throw new Error(`PDF structure phonetic alphabet is invalid: ${tag.phoneticAlphabet}`)
  }
  if (tag.revision !== undefined && (!Number.isInteger(tag.revision) || tag.revision < 0)) {
    throw new Error('PDF structure element revision must be a non-negative integer')
  }
  const attributes = tag.attributes ?? []
  for (let i = 0; i < attributes.length; i++) {
    const attribute = attributes[i]!
    if (attribute.owner === 'List' && tag.role !== 'L') throw new Error('PDF List attributes require an L structure element')
    if (attribute.owner === 'PrintField' && tag.role !== 'Form') throw new Error('PDF PrintField attributes require a Form structure element')
    if (attribute.owner === 'Table' && tag.role !== 'TH' && tag.role !== 'TD') {
      throw new Error('PDF Table attributes require a TH or TD structure element')
    }
    if (attribute.owner === 'Artifact' && (tag.role !== 'Artifact' || tag.artifactStructureElement !== true)) {
      throw new Error('PDF Artifact attributes require an Artifact structure element')
    }
    if ((attribute.owner === 'Layout' && tag.layout !== undefined)
      || (attribute.owner === 'List' && tag.listNumbering !== undefined)
      || (attribute.owner === 'PrintField' && tag.printField !== undefined)
      || (attribute.owner === 'Table' && (tag.scope !== undefined || tag.rowSpan !== undefined || tag.colSpan !== undefined || tag.headers !== undefined))
      || (attribute.owner === 'Artifact' && (
        tag.artifactType !== undefined || tag.artifactSubtype !== undefined || tag.artifactBBox !== undefined || tag.artifactAttached !== undefined
      ))) throw new Error(`PDF structure attribute owner ${attribute.owner} duplicates typed attributes`)
    const allowed = PDF_STRUCTURE_ATTRIBUTE_KEYS[attribute.owner]
    if (!STANDARD_STRUCTURE_ATTRIBUTE_OWNERS.has(attribute.owner)) {
      throw new Error(`PDF standard structure attribute owner is invalid: ${attribute.owner}`)
    }
    if (attribute.owner === 'NSO' ? attribute.namespaceIndex === undefined : attribute.namespaceIndex !== undefined) {
      throw new Error('PDF NSO structure attributes require namespaceIndex and other owners forbid it')
    }
    const keys = Object.keys(attribute.entries)
    if (keys.length === 0) throw new Error(`PDF ${attribute.owner} structure attribute must not be empty`)
    for (let k = 0; k < keys.length; k++) {
      if (allowed !== undefined && !allowed.has(keys[k]!)) throw new Error(`PDF ${attribute.owner} structure attribute key is invalid: ${keys[k]}`)
      const value = attribute.entries[keys[k]!]!
      validateStructureAttributeValue(value)
      validateStandardStructureAttributeValue(attribute.owner, keys[k]!, value)
      if (attribute.owner === 'Table' && keys[k] === 'Scope' && tag.role !== 'TH') {
        throw new Error('PDF Table Scope attribute requires a TH structure element')
      }
    }
    validateStandardStructureAttributeEntries(attribute.owner, attribute.entries)
    if (attribute.streamData !== undefined && !(attribute.streamData instanceof Uint8Array)) {
      throw new Error('PDF structure attribute streamData must be a Uint8Array')
    }
    if (attribute.revision !== undefined && (!Number.isInteger(attribute.revision) || attribute.revision < 0)) {
      throw new Error('PDF structure attribute revision must be a non-negative integer')
    }
  }
  if (tag.userProperties !== undefined) {
    if (tag.userProperties.length === 0) throw new Error('PDF UserProperties must not be empty')
    const names = new Set<string>()
    for (let i = 0; i < tag.userProperties.length; i++) {
      const property = tag.userProperties[i]!
      if (property.name === '' || names.has(property.name)) throw new Error('PDF UserProperties names must be non-empty and unique')
      if (typeof property.value !== 'string') validateStructureAttributeValue(property.value)
      if (property.formattedValue !== undefined && typeof property.formattedValue !== 'string') {
        throw new Error('PDF UserProperties formattedValue must be a string')
      }
      if (property.hidden !== undefined && typeof property.hidden !== 'boolean') {
        throw new Error('PDF UserProperties hidden must be boolean')
      }
      names.add(property.name)
    }
  }
  if (tag.userPropertiesRevision !== undefined && (
    tag.userProperties === undefined || !Number.isInteger(tag.userPropertiesRevision) || tag.userPropertiesRevision < 0
  )) throw new Error('PDF UserProperties revision requires properties and must be a non-negative integer')
  validateHighLevelStructureAttributes(tag)
}

function validateStandardStructureAttributeEntries(owner: string, entries: Record<string, PdfRawValueDef>): void {
  if (owner === 'Layout') {
    const bbox = entries.BBox
    if (bbox !== undefined && isRawArray(bbox)) {
      const values = bbox.items as number[]
      if (values[0]! > values[2]! || values[1]! > values[3]!) throw new Error('PDF Layout BBox must be ordered')
    }
    const count = entries.ColumnCount
    if (typeof count === 'number') {
      const gap = entries.ColumnGap
      const widths = entries.ColumnWidths
      if (gap !== undefined && isRawArray(gap) && gap.items.length !== count - 1) throw new Error('PDF Layout ColumnGap array length must be ColumnCount - 1')
      if (widths !== undefined && isRawArray(widths) && widths.items.length !== count) throw new Error('PDF Layout ColumnWidths array length must equal ColumnCount')
    }
  } else if (owner === 'List') {
    if (entries.ContinuedFrom !== undefined && entries.ContinuedList !== true) {
      throw new Error('PDF List ContinuedFrom requires ContinuedList true')
    }
  } else if (owner === 'PrintField') {
    const role = entries.Role
    if (entries.checked !== undefined && (!isStructureName(role!, ['rb', 'cb']))) {
      throw new Error('PDF PrintField checked requires rb or cb Role')
    }
  } else if (owner === 'Artifact') {
    const bbox = entries.BBox
    if (bbox !== undefined && isRawArray(bbox)) {
      const values = bbox.items as number[]
      if (values[0]! > values[2]! || values[1]! > values[3]!) throw new Error('PDF Artifact BBox must be ordered')
    }
    if (entries.Subtype !== undefined && !isStructureName(entries.Type!, ['Pagination'])) {
      throw new Error('PDF Artifact Subtype requires Type Pagination')
    }
    const attached = entries.Attached
    if (attached !== undefined && isRawArray(attached)) {
      const values = attached.items.map(function (item) { return (item as { value: string }).value })
      if (new Set(values).size !== values.length) throw new Error('PDF Artifact Attached must not contain duplicates')
    }
  }
}

function validateHighLevelStructureAttributes(tag: StructureTag): void {
  const tableValue = function (name: string, value: number | undefined): void {
    if (value === undefined) return
    if ((tag.role !== 'TH' && tag.role !== 'TD') || !Number.isInteger(value) || value < 1) {
      throw new Error(`PDF structure ${name} requires a positive integer on TH or TD`)
    }
  }
  tableValue('rowSpan', tag.rowSpan)
  tableValue('colSpan', tag.colSpan)
  if (tag.scope !== undefined && tag.role !== 'TH') throw new Error('PDF structure scope requires a TH element')
  if (tag.headers !== undefined) {
    if ((tag.role !== 'TH' && tag.role !== 'TD') || tag.headers.length === 0 || new Set(tag.headers).size !== tag.headers.length
      || tag.headers.some(function (id) { return id === '' })) {
      throw new Error('PDF structure headers require non-empty unique IDs on TH or TD')
    }
  }
  if (tag.summary !== undefined && tag.role !== 'Table') throw new Error('PDF structure summary requires a Table element')
  if (tag.listNumbering !== undefined && tag.role !== 'L') throw new Error('PDF listNumbering requires an L structure element')
  if (tag.printField !== undefined && tag.role !== 'Form') throw new Error('PDF printField requires a Form structure element')
  const layout = tag.layout
  if (layout !== undefined) {
    const values = [
      layout.startIndent, layout.endIndent, layout.textIndent, layout.spaceBefore, layout.spaceAfter,
      typeof layout.width === 'number' ? layout.width : undefined,
      typeof layout.height === 'number' ? layout.height : undefined,
      ...(layout.bbox ?? []),
    ]
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== undefined && !Number.isFinite(values[i])) throw new Error('PDF structure layout values must be finite')
    }
    if (layout.bbox !== undefined && (layout.bbox[0] > layout.bbox[2] || layout.bbox[1] > layout.bbox[3])) {
      throw new Error('PDF structure layout BBox must be ordered')
    }
  }
}

function validateStandardStructureAttributeValue(owner: string, key: string, value: PdfRawValueDef): void {
  const fail = function (): never { throw new Error(`PDF ${owner} structure attribute ${key} has an invalid value`) }
  if (owner === 'Layout') {
    const numeric = new Set([
      'SpaceBefore', 'SpaceAfter', 'StartIndent', 'EndIndent', 'TextIndent', 'BaselineShift',
      'TextDecorationThickness',
    ])
    if (numeric.has(key)) {
      if (typeof value !== 'number') fail()
      return
    }
    if (key === 'Placement') return requireStructureName(value, ['Block', 'Inline', 'Before', 'Start', 'End'], fail)
    if (key === 'WritingMode') return requireStructureName(value, ['LrTb', 'RlTb', 'TbRl'], fail)
    if (key === 'TextAlign') return requireStructureName(value, ['Start', 'Center', 'End', 'Justify'], fail)
    if (key === 'BlockAlign') return requireStructureName(value, ['Before', 'Middle', 'After', 'Justify'], fail)
    if (key === 'InlineAlign') return requireStructureName(value, ['Start', 'Center', 'End'], fail)
    if (key === 'TextDecorationType') return requireStructureName(value, ['None', 'Underline', 'Overline', 'LineThrough'], fail)
    if (key === 'RubyAlign') return requireStructureName(value, ['Start', 'Center', 'End', 'Justify', 'Distribute'], fail)
    if (key === 'RubyPosition') return requireStructureName(value, ['Before', 'After', 'Warichu', 'Inline'], fail)
    if (key === 'Width' || key === 'Height' || key === 'LineHeight') {
      if (typeof value === 'number') return
      requireStructureName(value, key === 'LineHeight' ? ['Normal', 'Auto'] : ['Auto'], fail)
      return
    }
    if (key === 'BBox') return requireNumberArray(value, 4, fail)
    if (key === 'BackgroundColor' || key === 'Color' || key === 'TextDecorationColor') return requireColor(value, fail)
    if (key === 'BorderColor') {
      if (isNumberArray(value, 3)) return
      if (isRawArray(value) && value.items.length === 4 && value.items.every(function (item) { return isNumberArray(item, 3) })) return
      fail()
    }
    if (key === 'BorderStyle' || key === 'TBorderStyle') {
      if (isStructureName(value, STRUCTURE_BORDER_STYLES)) return
      if (isRawArray(value) && value.items.length === 4 && value.items.every(function (item) { return isStructureName(item, STRUCTURE_BORDER_STYLES) })) return
      fail()
    }
    if (key === 'BorderThickness' || key === 'Padding' || key === 'TPadding') {
      if (typeof value === 'number' || isNumberArray(value, 4)) return
      fail()
    }
    if (key === 'GlyphOrientationVertical') {
      if (typeof value === 'number' && Number.isInteger(value)) return
      requireStructureName(value, ['Auto'], fail)
      return
    }
    if (key === 'ColumnCount') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) fail()
      return
    }
    if (key === 'ColumnGap' || key === 'ColumnWidths') {
      if (typeof value === 'number' || isNumberArray(value)) return
      fail()
    }
    return
  }
  if (owner === 'List') {
    if (key === 'ListNumbering') return requireStructureName(value, STRUCTURE_LIST_NUMBERING_NAMES, fail)
    if (key === 'ContinuedList') {
      if (typeof value !== 'boolean') fail()
      return
    }
    if (!isRawString(value)) fail()
    return
  }
  if (owner === 'PrintField') {
    if (key === 'Role') return requireStructureName(value, ['rb', 'cb', 'pb', 'tv', 'lb'], fail)
    if (key === 'checked') return requireStructureName(value, ['on', 'off', 'neutral'], fail)
    if (!isRawString(value)) fail()
    return
  }
  if (owner === 'Table') {
    if (key === 'RowSpan' || key === 'ColSpan') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) fail()
      return
    }
    if (key === 'Scope') return requireStructureName(value, ['Row', 'Column', 'Both'], fail)
    if (!isRawArray(value) || value.items.length === 0 || !value.items.every(isRawString)) fail()
    return
  }
  if (owner === 'Artifact') {
    if (key === 'Type') return requireStructureName(value, ['Pagination', 'Layout', 'Page', 'Background'], fail)
    if (key === 'Subtype') return requireStructureName(value, ['Header', 'Footer', 'Watermark'], fail)
    if (key === 'BBox') return requireNumberArray(value, 4, fail)
    if (!isRawArray(value) || value.items.length === 0
      || !value.items.every(function (item) { return isStructureName(item, ['Top', 'Bottom', 'Left', 'Right']) })) fail()
  }
}

const STRUCTURE_BORDER_STYLES = ['None', 'Hidden', 'Dotted', 'Dashed', 'Solid', 'Double', 'Groove', 'Ridge', 'Inset', 'Outset']
const STRUCTURE_LIST_NUMBERING_NAMES = ['None', 'Disc', 'Circle', 'Square', 'Decimal', 'UpperRoman', 'LowerRoman', 'UpperAlpha', 'LowerAlpha']

function isRawArray(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'array' }> {
  return typeof value === 'object' && value !== null && value.kind === 'array'
}

function isRawString(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'string' }> {
  return typeof value === 'object' && value !== null && value.kind === 'string'
}

function isStructureName(value: PdfRawValueDef, allowed: string[]): boolean {
  return typeof value === 'object' && value !== null && value.kind === 'name' && allowed.includes(value.value)
}

function requireStructureName(value: PdfRawValueDef, allowed: string[], fail: () => never): void {
  if (!isStructureName(value, allowed)) fail()
}

function isNumberArray(value: PdfRawValueDef, length?: number): boolean {
  return isRawArray(value) && (length === undefined || value.items.length === length)
    && value.items.every(function (item) { return typeof item === 'number' })
}

function requireNumberArray(value: PdfRawValueDef, length: number, fail: () => never): void {
  if (!isNumberArray(value, length)) fail()
}

function requireColor(value: PdfRawValueDef, fail: () => never): void {
  if (!isNumberArray(value, 3) || (value as Extract<PdfRawValueDef, { kind: 'array' }>).items.some(function (item) {
    return (item as number) < 0 || (item as number) > 1
  })) fail()
}

function validateStructureAttributeValue(value: PdfRawValueDef): void {
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PDF structure attribute number must be finite')
    return
  }
  if (value.kind === 'array') {
    for (let i = 0; i < value.items.length; i++) validateStructureAttributeValue(value.items[i]!)
  } else if (value.kind === 'dictionary' || value.kind === 'stream') {
    for (const key of Object.keys(value.entries)) validateStructureAttributeValue(value.entries[key]!)
  }
}

function taggedPropertyList(mcid: number, tag: StructureTag): string {
  const entries = [`/MCID ${mcid}`]
  if (tag.alt) entries.push(`/Alt (${pdfEscapeString(tag.alt)})`)
  if (tag.actualText) entries.push(`/ActualText (${pdfEscapeString(tag.actualText)})`)
  if (tag.expandedText) entries.push(`/E (${pdfEscapeString(tag.expandedText)})`)
  return `<< ${entries.join(' ')} >>`
}

interface TaggedAttributesResult {
  value: string
  classable: boolean
}

function taggedAttributes(
  elem: StructElement,
  attributeObjectPdf: (attribute: NonNullable<StructureTag['attributes']>[number]) => string,
  rawValuePdf: (value: PdfRawValueDef) => string,
): TaggedAttributesResult | null {
  const dicts: { value: string, revision?: number }[] = []
  const layout = taggedLayoutAttributes(elem)
  if (layout !== null) dicts.push({ value: layout })
  const table = taggedTableAttributes(elem)
  if (table !== null) dicts.push({ value: table })
  const list = taggedListAttributes(elem)
  if (list !== null) dicts.push({ value: list })
  const printField = taggedPrintFieldAttributes(elem)
  if (printField !== null) dicts.push({ value: printField })
  const attributes = elem.attributes ?? []
  for (let i = 0; i < attributes.length; i++) {
    const attribute = attributes[i]!
    dicts.push({ value: attributeObjectPdf(attribute), revision: attribute.revision })
  }
  if (elem.role === 'Artifact') {
    const entries = ['/O /Artifact']
    if (elem.artifactType !== undefined) entries.push(`/Type /${elem.artifactType}`)
    if (elem.artifactSubtype !== undefined) entries.push(`/Subtype /${elem.artifactSubtype}`)
    if (elem.artifactBBox !== undefined) entries.push(`/BBox ${pdfPageBoxString(elem.artifactBBox)}`)
    if (elem.artifactAttached !== undefined) entries.push(`/Attached [${elem.artifactAttached.map(encodePdfName).join(' ')}]`)
    if (entries.length > 1) dicts.push({ value: `<< ${entries.join(' ')} >>` })
  }
  if (elem.userProperties !== undefined) {
    const properties: string[] = []
    for (let i = 0; i < elem.userProperties.length; i++) {
      const property = elem.userProperties[i]!
      const entries = [`/N ${pdfString(property.name)}`, `/V ${structureUserPropertyValuePdf(property.value, rawValuePdf)}`]
      if (property.formattedValue !== undefined) entries.push(`/F ${pdfString(property.formattedValue)}`)
      if (property.hidden !== undefined) entries.push(`/H ${pdfBool(property.hidden)}`)
      properties.push(`<< ${entries.join(' ')} >>`)
    }
    dicts.push({ value: `<< /O /UserProperties /P [${properties.join(' ')}] >>`, revision: elem.userPropertiesRevision })
  }
  if (dicts.length === 0) return null
  const classable = dicts.every(function (item) { return item.revision === undefined })
  if (dicts.length === 1 && classable) return { value: dicts[0]!.value, classable: true }
  return {
    value: `[${dicts.map(function (item) { return item.value + (item.revision === undefined ? '' : ` ${item.revision}`) }).join(' ')}]`,
    classable,
  }
}

function taggedPrintFieldAttributes(elem: StructElement): string | null {
  const field = elem.printField
  if (field === undefined) return null
  const roles = { radioButton: 'rb', checkBox: 'cb', pushButton: 'pb', textValue: 'tv', listBox: 'lb' } as const
  const entries = ['/O /PrintField', `/Role /${roles[field.role]}`]
  if (field.checked !== undefined) entries.push(`/checked /${field.checked}`)
  if (field.description !== undefined) entries.push(`/Desc (${pdfEscapeString(field.description)})`)
  return `<< ${entries.join(' ')} >>`
}

function taggedLayoutAttributes(elem: StructElement): string | null {
  const layout = elem.layout
  if (layout === undefined) return null
  const entries = ['/O /Layout']
  if (layout.placement !== undefined) entries.push(`/Placement /${pdfStructurePlacement(layout.placement)}`)
  if (layout.writingMode !== undefined) entries.push(`/WritingMode /${pdfStructureWritingMode(layout.writingMode)}`)
  if (layout.bbox !== undefined) entries.push(`/BBox [${pn(layout.bbox[0])} ${pn(layout.bbox[1])} ${pn(layout.bbox[2])} ${pn(layout.bbox[3])}]`)
  if (layout.width !== undefined) entries.push(`/Width ${pdfStructureDimension(layout.width)}`)
  if (layout.height !== undefined) entries.push(`/Height ${pdfStructureDimension(layout.height)}`)
  if (layout.startIndent !== undefined) entries.push(`/StartIndent ${pn(layout.startIndent)}`)
  if (layout.endIndent !== undefined) entries.push(`/EndIndent ${pn(layout.endIndent)}`)
  if (layout.textIndent !== undefined) entries.push(`/TextIndent ${pn(layout.textIndent)}`)
  if (layout.spaceBefore !== undefined) entries.push(`/SpaceBefore ${pn(layout.spaceBefore)}`)
  if (layout.spaceAfter !== undefined) entries.push(`/SpaceAfter ${pn(layout.spaceAfter)}`)
  if (layout.textAlign !== undefined) entries.push(`/TextAlign /${pdfStructureTextAlign(layout.textAlign)}`)
  if (layout.blockAlign !== undefined) entries.push(`/BlockAlign /${pdfStructureBlockAlign(layout.blockAlign)}`)
  if (layout.inlineAlign !== undefined) entries.push(`/InlineAlign /${pdfStructureInlineAlign(layout.inlineAlign)}`)
  return entries.length === 1 ? null : `<< ${entries.join(' ')} >>`
}

function taggedTableAttributes(elem: StructElement): string | null {
  const entries = ['/O /Table']
  if (elem.scope && elem.role === 'TH') {
    const scopeVal = elem.scope === 'row' ? 'Row' : elem.scope === 'column' ? 'Column' : 'Both'
    entries.push(`/Scope /${scopeVal}`)
  }
  if (elem.rowSpan !== undefined) entries.push(`/RowSpan ${elem.rowSpan}`)
  if (elem.colSpan !== undefined) entries.push(`/ColSpan ${elem.colSpan}`)
  if (elem.headers !== undefined) {
    const values: string[] = []
    for (let i = 0; i < elem.headers.length; i++) values.push(`(${pdfEscapeString(elem.headers[i]!)})`)
    entries.push(`/Headers [${values.join(' ')}]`)
  }
  return entries.length === 1 ? null : `<< ${entries.join(' ')} >>`
}

function taggedListAttributes(elem: StructElement): string | null {
  if (elem.listNumbering === undefined) return null
  return `<< /O /List /ListNumbering /${pdfStructureListNumbering(elem.listNumbering)} >>`
}

function structureUserPropertyValuePdf(value: string | PdfRawValueDef, rawValuePdf: (raw: PdfRawValueDef) => string): string {
  if (typeof value === 'string') return pdfString(value)
  return rawValuePdf(value)
}

type StructureLayout = NonNullable<StructureTag['layout']>
type StructurePlacementName = NonNullable<StructureLayout['placement']>
type StructureWritingModeName = NonNullable<StructureLayout['writingMode']>
type StructureTextAlignName = NonNullable<StructureLayout['textAlign']>
type StructureBlockAlignName = NonNullable<StructureLayout['blockAlign']>
type StructureInlineAlignName = NonNullable<StructureLayout['inlineAlign']>
type StructureListNumberingName = NonNullable<StructureTag['listNumbering']>

const PDF_STRUCTURE_PLACEMENT: Record<StructurePlacementName, string> = {
  block: 'Block',
  inline: 'Inline',
  before: 'Before',
  start: 'Start',
  end: 'End',
}

const PDF_STRUCTURE_WRITING_MODE: Record<StructureWritingModeName, string> = {
  'lr-tb': 'LrTb',
  'rl-tb': 'RlTb',
  'tb-rl': 'TbRl',
}

const PDF_STRUCTURE_TEXT_ALIGN: Record<StructureTextAlignName, string> = {
  start: 'Start',
  center: 'Center',
  end: 'End',
  justify: 'Justify',
}

const PDF_STRUCTURE_BLOCK_ALIGN: Record<StructureBlockAlignName, string> = {
  before: 'Before',
  middle: 'Middle',
  after: 'After',
  justify: 'Justify',
}

const PDF_STRUCTURE_INLINE_ALIGN: Record<StructureInlineAlignName, string> = {
  start: 'Start',
  center: 'Center',
  end: 'End',
}

const PDF_STRUCTURE_LIST_NUMBERING: Record<StructureListNumberingName, string> = {
  none: 'None',
  disc: 'Disc',
  circle: 'Circle',
  square: 'Square',
  decimal: 'Decimal',
  'upper-roman': 'UpperRoman',
  'lower-roman': 'LowerRoman',
  'upper-alpha': 'UpperAlpha',
  'lower-alpha': 'LowerAlpha',
}

function pdfStructurePlacement(value: StructurePlacementName): string {
  return PDF_STRUCTURE_PLACEMENT[value]
}

function pdfStructureWritingMode(value: StructureWritingModeName): string {
  return PDF_STRUCTURE_WRITING_MODE[value]
}

function pdfStructureTextAlign(value: StructureTextAlignName): string {
  return PDF_STRUCTURE_TEXT_ALIGN[value]
}

function pdfStructureBlockAlign(value: StructureBlockAlignName): string {
  return PDF_STRUCTURE_BLOCK_ALIGN[value]
}

function pdfStructureInlineAlign(value: StructureInlineAlignName): string {
  return PDF_STRUCTURE_INLINE_ALIGN[value]
}

function pdfStructureListNumbering(value: StructureListNumberingName): string {
  return PDF_STRUCTURE_LIST_NUMBERING[value]
}

function pdfStructureDimension(value: number | 'auto'): string {
  return value === 'auto' ? '/Auto' : pn(value)
}

/** Tagged PDF: structure element */
interface StructElement {
  role: string
  parentIndex: number  // parent structElements index (-1 = directly under StructTreeRoot)
  childIndices: number[]  // child structElements indices
  mcids: { pageIndex: number, mcid: number, formSemanticId?: number }[]  // MCID references
  alt?: string
  actualText?: string
  expandedText?: string
  phoneme?: string
  phoneticAlphabet?: StructureTag['phoneticAlphabet']
  lang?: string
  scope?: string
  rowSpan?: number
  colSpan?: number
  headers?: string[]
  layout?: StructureTag['layout']
  listNumbering?: StructureTag['listNumbering']
  id?: string
  title?: string
  revision?: number
  attributes?: StructureTag['attributes']
  userProperties?: StructureTag['userProperties']
  userPropertiesRevision?: number
  artifactType?: StructureTag['artifactType']
  artifactSubtype?: StructureTag['artifactSubtype']
  artifactBBox?: StructureTag['artifactBBox']
  artifactAttached?: StructureTag['artifactAttached']
  summary?: string
  namespaceIndex?: number
  associatedFileIndexes?: number[]
  printField?: StructureTag['printField']
}

function appendMathMlStructElements(
  elements: StructElement[],
  parentIndex: number,
  node: NonNullable<StructureTag['mathml']>,
  namespaceIndex: number,
): void {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(node.name)) throw new Error(`Invalid MathML element name: ${node.name}`)
  const attributes: NonNullable<StructureTag['attributes']> = []
  if (node.attributes !== undefined) {
    const entries: Record<string, PdfRawValueDef> = {}
    for (const name of Object.keys(node.attributes)) {
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw new Error(`Invalid MathML attribute name: ${name}`)
      entries[name] = { kind: 'string', bytes: encodePdfTextStringBytes(node.attributes[name]!) }
    }
    if (Object.keys(entries).length > 0) attributes.push({ owner: 'NSO', namespaceIndex, entries })
  }
  const index = elements.length
  elements.push({
    role: node.name,
    parentIndex,
    childIndices: [],
    mcids: [],
    actualText: node.text,
    ...(attributes.length === 0 ? {} : { attributes }),
    namespaceIndex,
  })
  elements[parentIndex]!.childIndices.push(index)
  if (node.children === undefined) return
  for (let i = 0; i < node.children.length; i++) appendMathMlStructElements(elements, index, node.children[i]!, namespaceIndex)
}

/** Shared context passed to createPdfColrV1Ops */
interface PdfColrContext {
  ops: PdfOp[]
  font: Font
  shadingDefs: ShadingDef[]
  gsMap: Map<string, string>
  gsValues: ExtGStateEntry[]
  gsCounter: number
  outputTransform?: IccOutputTransform
  renderingIntent?: IccRenderingIntent
}

/** Append a glyph outline as a clip path to the PDF operations */
function appendGlyphClipPath(
  ops: PdfOp[],
  font: Font, glyphId: number,
  scale: number, cx: number, baseY: number,
): void {
  const glyph = font.getGlyph(glyphId)
  const { commands, coords } = glyph.outline
  if (commands.length === 0) return
  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    switch (commands[i]) {
      case 0:
        ops.push(`${pn(cx + coords[ci]! * scale)} ${pn(baseY - coords[ci + 1]! * scale)} m`)
        ci += 2
        break
      case 1:
        ops.push(`${pn(cx + coords[ci]! * scale)} ${pn(baseY - coords[ci + 1]! * scale)} l`)
        ci += 2
        break
      case 2:
        ops.push(
          `${pn(cx + coords[ci]! * scale)} ${pn(baseY - coords[ci + 1]! * scale)} ` +
          `${pn(cx + coords[ci + 2]! * scale)} ${pn(baseY - coords[ci + 3]! * scale)} ` +
          `${pn(cx + coords[ci + 4]! * scale)} ${pn(baseY - coords[ci + 5]! * scale)} c`,
        )
        ci += 6
        break
      case 3:
        ops.push('h')
        break
    }
  }
  ops.push('W n')
}

/** CompositeMode → PDF Blend Mode name mapping */
function compositeModeToBlendMode(mode: CompositeMode): string | null {
  switch (mode) {
    case 13: return 'Screen'
    case 14: return 'Overlay'
    case 15: return 'Darken'
    case 16: return 'Lighten'
    case 17: return 'ColorDodge'
    case 18: return 'ColorBurn'
    case 19: return 'HardLight'
    case 20: return 'SoftLight'
    case 21: return 'Difference'
    case 22: return 'Exclusion'
    case 23: return 'Multiply'
    case 24: return 'Hue'
    case 25: return 'Saturation'
    case 26: return 'Color'
    case 27: return 'Luminosity'
    default: return null  // Porter-Duff modes like SRC_OVER map to Normal (default)
  }
}

/** Ensure an ExtGState (for blending mode) */
function ensureBlendModeGs(ctx: PdfColrContext, blendMode: string): string {
  const key = `bm:${blendMode}`
  let name = ctx.gsMap.get(key)
  if (!name) {
    name = `/GS${ctx.gsCounter++}`
    ctx.gsMap.set(key, name)
    ctx.gsValues.push({ name, blendMode })
  }
  return name
}

/** Ensure an ExtGState (for resetting to the Normal blending mode) */
function ensureNormalGs(ctx: PdfColrContext): string {
  const key = 'bm:Normal'
  let name = ctx.gsMap.get(key)
  if (!name) {
    name = `/GS${ctx.gsCounter++}`
    ctx.gsMap.set(key, name)
    ctx.gsValues.push({ name, blendMode: 'Normal' })
  }
  return name
}

/** Create a ColrV1PaintOps implementation for PDF */
function createPdfColrV1Ops(ctx: PdfColrContext): ColrV1PaintOps {
  const { ops, font, shadingDefs } = ctx
  return {
    save() { ops.push('q') },
    restore() { ops.push('Q') },

    transform(xx: number, yx: number, xy: number, yy: number, dx: number, dy: number) {
      ops.push(`${pn(xx)} ${pn(yx)} ${pn(xy)} ${pn(yy)} ${pn(dx)} ${pn(dy)} cm`)
    },

    clipGlyph(f: Font, glyphId: number, scale: number, cx: number, baseY: number) {
      appendGlyphClipPath(ops, f, glyphId, scale, cx, baseY)
    },

    clipRect(xMin: number, yMin: number, xMax: number, yMax: number, scale: number, cx: number, baseY: number) {
      const x = cx + xMin * scale
      const y = baseY - yMax * scale
      const w = (xMax - xMin) * scale
      const h = (yMax - yMin) * scale
      ops.push(`${pn(x)} ${pn(y)} ${pn(w)} ${pn(h)} re W n`)
    },

    fillSolid(color: ResolvedColor) {
      ops.push(colrFillColorOperator(ctx, color))
      ops.push('f')
    },

    fillLinearGradient(
      x0: number, y0: number, x1: number, y1: number,
      _x2: number, _y2: number,
      stops: ResolvedColorStop[], extend: ExtendMode,
      scale: number, cx: number, baseY: number,
    ) {
      if (stops.length === 0) { ops.push('f'); return }
      if (stops.length === 1) {
        const c = stops[0]!.color
        ops.push(colrFillColorOperator(ctx, c))
        ops.push('f')
        return
      }

      const N = 10
      let usedStops = stops
      let coords: number[]

      if (extend !== 0) {
        usedStops = extendGradientStops(stops, extend, N)
        const dx = (x1 - x0) * scale
        const dy = (y1 - y0) * scale
        coords = [
          cx + x0 * scale - N * dx, baseY - y0 * scale + N * dy,
          cx + x1 * scale + N * dx, baseY - y1 * scale - N * dy,
        ]
      } else {
        coords = [
          cx + x0 * scale, baseY - y0 * scale,
          cx + x1 * scale, baseY - y1 * scale,
        ]
      }

      const shadingStops: { offset: number, r: number, g: number, b: number }[] = []
      for (let si = 0; si < usedStops.length; si++) {
        const s = usedStops[si]!
        shadingStops.push({ offset: s.offset, r: s.color.r, g: s.color.g, b: s.color.b })
      }
      const shadingIndex = shadingDefs.length
      shadingDefs.push({
        type: 'axial',
        coords,
        stops: shadingStops,
        extend: [true, true],
      })
      ops.push({ type: 'shading', shadingIndex })
    },

    fillRadialGradient(
      x0: number, y0: number, r0: number,
      x1: number, y1: number, r1: number,
      stops: ResolvedColorStop[], extend: ExtendMode,
      scale: number, cx: number, baseY: number,
    ) {
      if (stops.length === 0) { ops.push('f'); return }
      if (stops.length === 1) {
        const c = stops[0]!.color
        ops.push(colrFillColorOperator(ctx, c))
        ops.push('f')
        return
      }

      const N = 10
      let usedStops = stops
      let coords: number[]

      if (extend !== 0) {
        usedStops = extendGradientStops(stops, extend, N)
        const dx = (x1 - x0) * scale
        const dy = (y1 - y0) * scale
        const dr = (r1 - r0) * scale
        coords = [
          cx + x0 * scale - N * dx, baseY - y0 * scale + N * dy, Math.max(0, r0 * scale - N * dr),
          cx + x1 * scale + N * dx, baseY - y1 * scale - N * dy, r1 * scale + N * dr,
        ]
      } else {
        coords = [
          cx + x0 * scale, baseY - y0 * scale, r0 * scale,
          cx + x1 * scale, baseY - y1 * scale, r1 * scale,
        ]
      }

      const shadingStops: { offset: number, r: number, g: number, b: number }[] = []
      for (let si = 0; si < usedStops.length; si++) {
        const s = usedStops[si]!
        shadingStops.push({ offset: s.offset, r: s.color.r, g: s.color.g, b: s.color.b })
      }
      const shadingIndex = shadingDefs.length
      shadingDefs.push({
        type: 'radial',
        coords,
        stops: shadingStops,
        extend: [true, true],
      })
      ops.push({ type: 'shading', shadingIndex })
    },

    fillSweepGradient(
      centerX: number, centerY: number,
      startAngle: number, endAngle: number,
      stops: ResolvedColorStop[], extend: ExtendMode,
      scale: number, cx: number, baseY: number,
    ) {
      // Sweep gradients are approximated by sector subdivision (same approach as Canvas)
      if (stops.length === 0) { ops.push('f'); return }
      const canvasCX = cx + centerX * scale
      const canvasCY = baseY - centerY * scale
      const startRad = -startAngle * 2 * Math.PI
      const endRad = -endAngle * 2 * Math.PI

      const SECTORS = 360
      const totalAngle = endRad - startRad
      const stepAngle = totalAngle / SECTORS
      const R = 4000  // sufficiently large radius

      const firstOff = stops[0]?.offset ?? 0
      const lastOff = stops[stops.length - 1]?.offset ?? 1

      for (let i = 0; i < SECTORS; i++) {
        const a0 = startRad + stepAngle * i
        const a1 = a0 + stepAngle
        const t = (i + 0.5) / SECTORS

        const mapped = extend !== 0
          ? mapExtendMode(t, firstOff, lastOff, extend)
          : t
        const color = sampleColorLine(stops, mapped)

        ops.push(colrFillColorOperator(ctx, color))
        // Sector path: center → arc start → arc end → close
        const x0 = canvasCX + R * Math.cos(a0)
        const y0 = canvasCY + R * Math.sin(a0)
        const x1 = canvasCX + R * Math.cos(a1)
        const y1 = canvasCY + R * Math.sin(a1)
        ops.push(`${pn(canvasCX)} ${pn(canvasCY)} m`)
        ops.push(`${pn(x0)} ${pn(y0)} l`)
        ops.push(`${pn(x1)} ${pn(y1)} l`)
        ops.push('h f')
      }
    },

    setCompositeMode(mode: CompositeMode) {
      const blendMode = compositeModeToBlendMode(mode)
      if (blendMode) {
        const name = ensureBlendModeGs(ctx, blendMode)
        ops.push(`${name} gs`)
      }
    },

    resetCompositeMode() {
      const name = ensureNormalGs(ctx)
      ops.push(`${name} gs`)
    },
  }
}

function colrFillColorOperator(ctx: PdfColrContext, color: ResolvedColor): string {
  if (ctx.outputTransform === undefined) return `${pn(color.r)} ${pn(color.g)} ${pn(color.b)} rg`
  const [c, m, y, k] = iccOutputCmyk(ctx.outputTransform, ctx.renderingIntent, color.r, color.g, color.b)
  return `${pn(c)} ${pn(m)} ${pn(y)} ${pn(k)} k`
}

/** Generate the Function object for a PDF Shading */
function shadingColorComponents(
  stop: PdfGradientStop,
  transform: IccOutputTransform | undefined,
  intent: IccRenderingIntent | undefined,
): string {
  if (transform === undefined) return `${pn(stop.r)} ${pn(stop.g)} ${pn(stop.b)}`
  if (stop.specialColor === true) {
    throw new Error('PDF/X gradients with Separation or DeviceN stops require one explicit native shading color space')
  }
  if (stop.cmyk !== undefined) return stop.cmyk.map(pn).join(' ')
  const [c, m, y, k] = iccOutputCmyk(transform, intent, stop.r, stop.g, stop.b)
  return `${pn(c)} ${pn(m)} ${pn(y)} ${pn(k)}`
}

function buildShadingFunction(
  w: PdfWriter,
  alloc: () => number,
  stops: PdfGradientStop[],
  transform: IccOutputTransform | undefined,
  intent: IccRenderingIntent | undefined,
): number {
  if (stops.length <= 2) {
    // Type 2 Exponential Interpolation Function
    const c0 = stops[0] ?? { offset: 0, r: 0, g: 0, b: 0 }
    const c1 = stops[stops.length - 1] ?? c0
    const id = alloc()
    w.writeDeferredDict(id, [
      '/FunctionType 2',
      '/Domain [0 1]',
      `/C0 [${shadingColorComponents(c0, transform, intent)}]`,
      `/C1 [${shadingColorComponents(c1, transform, intent)}]`,
      '/N 1',
    ])
    return id
  }

  // Type 3 Stitching Function: one Type 2 sub-function per non-degenerate
  // segment. A pair of stops that share an offset is a hard colour stop; it is
  // represented by two adjacent sub-functions meeting at that bound with
  // different colours (a discontinuity), not by a zero-width sub-function —
  // emitting a zero-width segment would round-trip to a spurious stop.
  const segments: { s0: typeof stops[number], s1: typeof stops[number], end: number }[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i]!
    const s1 = stops[i + 1]!
    if (s1.offset - s0.offset <= 1e-9) continue
    segments.push({ s0, s1, end: s1.offset })
  }
  if (segments.length <= 1) {
    // No interior boundary survives: fall back to a single exponential ramp
    // between the first and last stop colours.
    const c0 = stops[0]!
    const c1 = stops[stops.length - 1]!
    const id = alloc()
    w.writeDeferredDict(id, [
      '/FunctionType 2',
      '/Domain [0 1]',
      `/C0 [${shadingColorComponents(c0, transform, intent)}]`,
      `/C1 [${shadingColorComponents(c1, transform, intent)}]`,
      '/N 1',
    ])
    return id
  }

  const subFuncIds: number[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const funcId = alloc()
    w.writeDeferredDict(funcId, [
      '/FunctionType 2',
      '/Domain [0 1]',
      `/C0 [${shadingColorComponents(seg.s0, transform, intent)}]`,
      `/C1 [${shadingColorComponents(seg.s1, transform, intent)}]`,
      '/N 1',
    ])
    subFuncIds.push(funcId)
  }

  // Bounds: the end offset of every sub-function except the last.
  let bounds = ''
  for (let i = 0; i < segments.length - 1; i++) {
    if (i > 0) bounds += ' '
    bounds += pn(segments[i]!.end)
  }
  // Encode: [0 1] for each sub-function
  let encode = ''
  let funcRefs = ''
  for (let i = 0; i < subFuncIds.length; i++) {
    if (i > 0) { encode += ' '; funcRefs += ' ' }
    encode += '0 1'
    funcRefs += `${subFuncIds[i]!} 0 R`
  }

  const stitchId = alloc()
  w.writeDeferredDict(stitchId, [
    '/FunctionType 3',
    '/Domain [0 1]',
    `/Functions [${funcRefs}]`,
    `/Bounds [${bounds}]`,
    `/Encode [${encode}]`,
  ])
  return stitchId
}

// ─── Utilities ───

/** Lazily evaluated operation for text drawing (GIDs are remapped after subsetting) */
interface TextGlyphsOp {
  type: 'textGlyphs'
  fontId: string
  glyphIds: number[]
  /** TJ adjustment inserted before glyph i (thousandths of text space) */
  adjustments?: number[]
  /** Text rise (Ts) per glyph (pt, from GPOS y placement) */
  rises?: number[]
}

/**
 * Vertical-mode TJ adjustments: a viewer advances the current point down by
 * the /W2 metrics; deltas against the shaped run advances (letter spacing,
 * justification) are emitted per glyph, in thousandths of text space.
 */
function computeVerticalRunTextAdjustments(
  font: Font,
  run: RenderGlyphRun,
  glyphIds: number[],
  fontSize: number,
): { adjustments?: number[]; rises?: number[] } {
  const scale = fontSize / font.metrics.unitsPerEm
  const adjustments: number[] = []
  let hasAdjustment = false
  let rises: number[] | undefined
  for (let gi = 0; gi < glyphIds.length; gi++) {
    const defaultAdvance = font.getAdvanceHeight(glyphIds[gi]!) * scale
    const delta = defaultAdvance - run.advances[gi]!
    const value = Math.round(delta / fontSize * 1000)
    adjustments.push(value)
    if (value !== 0) hasAdjustment = true
    const yOff = run.yOffsets[gi]!
    if (yOff !== 0) {
      if (!rises) rises = new Array(glyphIds.length).fill(0)
      rises[gi] = yOff
    }
  }
  return {
    adjustments: hasAdjustment ? adjustments : undefined,
    rises,
  }
}

/**
 * Compute TJ adjustments so a viewer advancing by the /W widths reproduces the
 * shaped glyph positions (kerning, GPOS offsets, letter/word/justify spacing are
 * baked into run.advances). Adjustment values follow PDF 32000-1 9.4.3: positive
 * values move the pen left, expressed in thousandths of text space, inserted
 * before the glyph they position. GPOS y placements are returned as text rises.
 */
function computeRunTextAdjustments(
  font: Font,
  run: RenderGlyphRun,
  glyphIds: number[],
  fontSize: number,
  horizontalScale: number,
): { adjustments?: number[]; rises?: number[] } {
  const k = 1000 / font.metrics.unitsPerEm
  const n = glyphIds.length
  // A non-positive font size draws zero-scale (invisible) glyphs, so there are
  // no positions to reproduce. Bail out before the division so deltaTh cannot
  // become NaN/Infinity and leak into the PDF content stream as a broken number.
  if (!(fontSize > 0) || !(horizontalScale > 0)) {
    return {}
  }
  let adjustments: number[] | undefined
  let rises: number[] | undefined
  let desired = 0  // pt: shaped pen position
  let actual = 0   // pt: viewer pen position (/W advances + emitted adjustments)
  for (let gi = 0; gi < n; gi++) {
    const target = desired + run.xOffsets[gi]!
    const deltaTh = (target - actual) * 1000 / (fontSize * horizontalScale)
    if (deltaTh > 0.5 || deltaTh < -0.5) {
      const adjTh = Math.round(deltaTh * 100) / 100
      if (!adjustments) {
        adjustments = new Array(n).fill(0)
      }
      adjustments[gi] = -adjTh
      actual += adjTh * fontSize * horizontalScale / 1000
    }
    // The viewer advances by the /W entry (advance width rounded to thousandths of em)
    actual += Math.round(font.getAdvanceWidth(glyphIds[gi]!) * k) * fontSize * horizontalScale / 1000
    desired += run.advances[gi]!
    const yOff = run.yOffsets[gi]!
    if (yOff !== 0) {
      if (!rises) {
        rises = new Array(n).fill(0)
      }
      rises[gi] = yOff
    }
  }
  return { adjustments, rises }
}

/** Build PDF show-text operators for a TextGlyphsOp (plain Tj, or TJ with adjustments / Ts rises) */
function buildTextShowOps(op: TextGlyphsOp, remap: Map<number, number> | undefined): string {
  const glyphIds = op.glyphIds
  const n = glyphIds.length

  if (!op.adjustments && !op.rises) {
    let hexStr = ''
    for (let gi = 0; gi < n; gi++) {
      const newGid = remap?.get(glyphIds[gi]!) ?? glyphIds[gi]!
      hexStr += newGid.toString(16).padStart(4, '0')
    }
    return `<${hexStr}> Tj`
  }

  const adjustments = op.adjustments
  const rises = op.rises
  let result = ''
  let arrParts = ''
  let hex = ''
  let currentRise = 0
  for (let gi = 0; gi < n; gi++) {
    const rise = rises ? rises[gi]! : 0
    if (rise !== currentRise) {
      if (hex !== '') {
        arrParts += `<${hex}>`
        hex = ''
      }
      if (arrParts !== '') {
        result += `[${arrParts}] TJ\n`
        arrParts = ''
      }
      result += `${pn(rise)} Ts\n`
      currentRise = rise
    }
    const adj = adjustments ? adjustments[gi]! : 0
    if (adj !== 0) {
      if (hex !== '') {
        arrParts += `<${hex}>`
        hex = ''
      }
      arrParts += `${pn(adj)} `
    }
    const newGid = remap?.get(glyphIds[gi]!) ?? glyphIds[gi]!
    hex += newGid.toString(16).padStart(4, '0')
  }
  if (hex !== '') arrParts += `<${hex}>`
  if (arrParts !== '') result += `[${arrParts}] TJ`
  if (currentRise !== 0) result += '\n0 Ts'
  return result
}

interface FormFieldRecord {
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  field: RenderFormField
  onOps: PdfOp[]
  offOps: PdfOp[] | null
}

interface PdfEmittedGraphicsState {
  fillColor?: string
  strokeColor?: string
  lineWidth?: string
  lineCap?: number
  lineJoin?: number
  miterLimit?: string
  dash?: string
}

function copyPdfEmittedGraphicsState(source: PdfEmittedGraphicsState, target: PdfEmittedGraphicsState): void {
  target.fillColor = source.fillColor
  target.strokeColor = source.strokeColor
  target.lineWidth = source.lineWidth
  target.lineCap = source.lineCap
  target.lineJoin = source.lineJoin
  target.miterLimit = source.miterLimit
  target.dash = source.dash
}

type PdfOp = string | TextGlyphsOp | ShadingOp | GroupMarkerOp | TransparencyInvokeOp | FormInvokeOp | SourceVectorInvokeOp

/** Content-group boundary marker (deduplication candidate range). */
interface GroupMarkerOp {
  type: 'groupStart' | 'groupEnd'
}

/** Invocation of a captured transparency group (A6.2/A6.3). */
interface TransparencyInvokeOp {
  type: 'transparencyInvoke'
  /** Index into PdfBackend.transparencyGroupDefs for the content group. */
  groupIndex: number
  /** Group constant alpha (PDF /ca /CA), if < 1. */
  opacity?: number
  /** Index of the soft-mask source group, or -1 when there is no soft mask. */
  softMaskIndex: number
  softMaskType?: 'Luminosity' | 'Alpha'
  softMaskBackdrop?: [number, number, number]
  softMaskTransfer?: 'Identity' | RenderTransferFunction
}

interface FormInvokeOp {
  type: 'formInvoke'
  formIndex: number
}

interface SourceVectorInvokeOp {
  type: 'sourceVectorInvoke'
  definitionIndex: number
  matrix: PdfMatrix
}

interface SourceVectorFormDef {
  body: string
  bbox: [number, number, number, number]
}

interface ImportedFormDef {
  form: PdfFormXObjectDef
  ops: PdfOp[]
  semanticId: number
}

interface ImportedFormFrame {
  form: PdfFormXObjectDef
  ctm: PdfMatrix
  ctmStack: PdfMatrix[]
  semanticId: number
  mcidCounter: number
}

/** Captured transparency group: child ops plus /Group attributes. */
interface TransparencyGroupDef {
  ops: PdfOp[]
  x: number
  y: number
  width: number
  height: number
  colorSpace?: PdfProcessColorSpaceDef
  isolated: boolean
  knockout: boolean
}

/** Active beginTransparencyGroup/endTransparencyGroup frame. */
interface TransparencyGroupFrame {
  x: number
  y: number
  width: number
  height: number
  isolated: boolean
  knockout: boolean
  opacity?: number
  softMask: PendingSoftMask | null
  /** PDF/A-1 and PDF/X-1a discard constant alpha without emitting a transparency Form. */
  flatten: boolean
}

/** A finalized soft mask awaiting the next beginTransparencyGroup. */
interface PendingSoftMask {
  defIndex: number
  maskType: 'Luminosity' | 'Alpha'
  backdrop?: [number, number, number]
  transfer?: 'Identity' | RenderTransferFunction
}

/** Active beginSoftMask/endSoftMask capture. */
interface CapturingSoftMask {
  maskType: 'Luminosity' | 'Alpha'
  width: number
  height: number
  x: number
  y: number
  colorSpace?: PdfProcessColorSpaceDef
  isolated?: boolean
  knockout?: boolean
  backdrop?: [number, number, number]
  transfer?: 'Identity' | RenderTransferFunction
}

interface PageData {
  width: number
  height: number
  cropBox?: PdfPageBox
  bleedBox?: PdfPageBox
  trimBox?: PdfPageBox
  artBox?: PdfPageBox
  rotate?: PdfPageRotation
  userUnit?: number
  tabs?: 'R' | 'C' | 'S'
  duration?: number
  transition?: PdfPageTransitionDef
  viewports?: (PdfMeasurementViewport | Record<string, PdfRawValueDef>)[]
  additionalActions?: Record<string, PdfRawValueDef>
  additionalActionModels?: Record<string, PdfActionDef>
  metadata?: Extract<PdfRawValueDef, { kind: 'stream' }>
  pieceInfo?: Record<string, PdfRawValueDef>
  lastModified?: PdfRawValueDef
  thumbnailImageId?: string
  separationInfo?: PdfSeparationInfo
  transparencyGroup?: PdfPageTransparencyGroup
  ops: PdfOp[]
}

type PdfMatrix = [number, number, number, number, number, number]

/** PDF Image XObject info */
interface ImageXObjectInfo {
  name: string           // e.g. "/Im0"
  imageId: string
  data: Uint8Array       // image binary
  width: number
  height: number
  colorSpace: string     // "DeviceRGB" | "DeviceGray" | "DeviceCMYK"
  bitsPerComponent: number
  /** Stencil mask image: /ImageMask true, no /ColorSpace, bit 0 = paint */
  imageMask?: boolean
  filter: string         // "DCTDecode" | "FlateDecode"
  decodeParms?: string   // PDF dict string
  decode?: string        // "/Decode [1 0 1 0 1 0 1 0]" (for CMYK inversion)
  smaskData?: Uint8Array // alpha channel (already deflated)
  smaskWidth?: number
  smaskHeight?: number
  smaskBpc?: number
  smaskDecodeParms?: string
  smaskInData?: 1 | 2
  mask?: string
  maskData?: Uint8Array
  maskWidth?: number
  maskHeight?: number
  intent?: string
  interpolate?: boolean
}

interface CcittImageParams {
  columns: number
  rows: number
  k: number
  blackIs1: boolean
  encodedByteAlign: boolean
  endOfLine: boolean
}

interface EncodedImageParams {
  columns: number
  rows: number
  filter: 'FlateDecode' | 'LZWDecode' | 'ASCIIHexDecode' | 'ASCII85Decode' | 'RunLengthDecode'
  colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK'
  bitsPerComponent: 1 | 2 | 4 | 8 | 16
  earlyChange: 0 | 1
  predictor: number
  colors: number
  maskRanges: number[] | null
  decode: number[] | null
  intent: 'AbsoluteColorimetric' | 'RelativeColorimetric' | 'Saturation' | 'Perceptual' | null
  interpolate: boolean | null
  inline: boolean
}

// Prioritize real-world compatibility of SVG gradients: Shadings use DeviceRGB.
// (Fixing to CalRGB tends to cause color shifts across PDF viewer implementations)
const PDF_SVG_GRADIENT_COLORSPACE = '/DeviceRGB'
const IDENTITY_CRYPT_MARKER = '__TSREPORT_IDENTITY_CRYPT__'
const IDENTITY_EFF_MARKER = '__TSREPORT_IDENTITY_EFF__'

/**
 * Convert an ASCII string to a Uint8Array
 * Sufficient because PDF content streams are ASCII only
 */
function encodeAscii(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    bytes[i] = s.charCodeAt(i) & 0xFF
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  let value = ''
  for (let i = 0; i < bytes.length; i++) value += bytes[i]!.toString(16).padStart(2, '0').toUpperCase()
  return value
}

/** Convert a number to a PDF string (integers without a dot, decimals up to 12 digits) */
function pn(v: number): string {
  if (Number.isInteger(v)) return v.toString()
  const s = v.toFixed(12)
  let end = s.length - 1
  while (end > 0 && s[end] === '0') end--
  if (s[end] === '.') end--
  return s.substring(0, end + 1)
}

/** Float32 path coordinates need sub-micro-point precision, not binary-tail digits. */
function pathCoordinate(value: number): string {
  if (Number.isInteger(value)) return value.toString()
  const fixed = value.toFixed(6)
  let end = fixed.length - 1
  while (end > 0 && fixed[end] === '0') end--
  if (fixed[end] === '.') end--
  const result = fixed.substring(0, end + 1)
  return result === '-0' ? '0' : result
}

function pathCommandsPdf(commands: Uint8Array, coords: Float32Array): string {
  const ops: string[] = []
  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    switch (commands[i]) {
      case 0:
        ops.push(`${pathCoordinate(coords[ci]!)} ${pathCoordinate(coords[ci + 1]!)} m`)
        ci += 2
        break
      case 1:
        ops.push(`${pathCoordinate(coords[ci]!)} ${pathCoordinate(coords[ci + 1]!)} l`)
        ci += 2
        break
      case 2:
        ops.push(
          `${pathCoordinate(coords[ci]!)} ${pathCoordinate(coords[ci + 1]!)} `
          + `${pathCoordinate(coords[ci + 2]!)} ${pathCoordinate(coords[ci + 3]!)} `
          + `${pathCoordinate(coords[ci + 4]!)} ${pathCoordinate(coords[ci + 5]!)} c`,
        )
        ci += 6
        break
      case 3:
        ops.push('h')
        break
      default:
        throw new Error(`Unknown path command: ${commands[i]}`)
    }
  }
  if (ci !== coords.length) throw new Error('Path coordinate count does not match commands')
  return ops.join('\n')
}

function pathCoordinateBounds(coords: Float32Array): [number, number, number, number] {
  if (coords.length < 2) throw new Error('Source vector definition has no coordinates')
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
  return [minX, minY, maxX, maxY]
}

function maxPdfVersion(...versions: string[]): string {
  let selected = versions[0] ?? '1.7'
  for (let i = 1; i < versions.length; i++) {
    if (Number(versions[i]) > Number(selected)) selected = versions[i]!
  }
  return selected
}

function pdfNumberArray(values: readonly number[]): string {
  return values.map(pn).join(' ')
}

function pdfPageBoxString(box: PdfPageBox): string {
  return `[${pn(box[0])} ${pn(box[1])} ${pn(box[2])} ${pn(box[3])}]`
}

function copyPdfPageBox(box: PdfPageBox | undefined): PdfPageBox | undefined {
  return box === undefined ? undefined : [box[0], box[1], box[2], box[3]]
}

function validatePdfPageOptions(options: PdfPageOptions | undefined): void {
  if (options === undefined) return
  const boxes: (PdfPageBox | undefined)[] = [options.cropBox, options.bleedBox, options.trimBox, options.artBox]
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]
    if (box === undefined) continue
    for (let j = 0; j < 4; j++) {
      if (!Number.isFinite(box[j])) throw new Error('PDF page box coordinates must be finite numbers')
    }
    if (box[0] > box[2] || box[1] > box[3]) throw new Error('PDF page box coordinates must be ordered')
  }
  if (options.rotate !== undefined && options.rotate !== 0 && options.rotate !== 90 && options.rotate !== 180 && options.rotate !== 270) {
    throw new Error('PDF page rotation must be 0, 90, 180, or 270')
  }
  if (options.userUnit !== undefined && (!Number.isFinite(options.userUnit) || options.userUnit <= 0)) {
    throw new Error('PDF page UserUnit must be a positive finite number')
  }
  if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration < 0)) {
    throw new Error('PDF page duration must be a non-negative finite number')
  }
  if (options.tabs !== undefined && options.tabs !== 'R' && options.tabs !== 'C' && options.tabs !== 'S') {
    throw new Error('PDF page Tabs must be R, C, or S')
  }
  if (options.pieceInfo !== undefined && options.lastModified === undefined) {
    throw new Error('PDF page PieceInfo requires LastModified')
  }
  if (options.additionalActions !== undefined && options.additionalActionModels !== undefined) {
    throw new Error('PDF page additionalActions and additionalActionModels are mutually exclusive')
  }
  if (options.transition !== undefined) validatePdfPageTransition(options.transition)
}

function buildPdfSeparationInfoByPage(pages: PageData[]): Map<number, PdfSeparationInfo> {
  const result = new Map<number, PdfSeparationInfo>()
  const keys = new Map<number, string>()
  for (let sourceIndex = 0; sourceIndex < pages.length; sourceIndex++) {
    const info = pages[sourceIndex]!.separationInfo
    if (info === undefined) continue
    if (info.pages.length === 0) throw new Error(`PDF page ${sourceIndex + 1} SeparationInfo Pages must not be empty`)
    const sortedPages = info.pages.slice().sort(function (a, b) { return a - b })
    for (let i = 0; i < sortedPages.length; i++) {
      const pageIndex = sortedPages[i]!
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
        throw new Error(`PDF page ${sourceIndex + 1} SeparationInfo page index ${pageIndex} out of range`)
      }
      if (i > 0 && sortedPages[i - 1] === pageIndex) {
        throw new Error(`PDF page ${sourceIndex + 1} SeparationInfo contains duplicate page index ${pageIndex}`)
      }
    }
    if (!sortedPages.includes(sourceIndex)) {
      throw new Error(`PDF page ${sourceIndex + 1} SeparationInfo Pages must include the declaring page`)
    }
    if (info.deviceColorant.kind === 'name' && info.deviceColorant.value.length === 0) {
      throw new Error(`PDF page ${sourceIndex + 1} SeparationInfo DeviceColorant name must not be empty`)
    }
    if (info.deviceColorant.kind === 'string' && info.deviceColorant.value.length === 0) {
      throw new Error(`PDF page ${sourceIndex + 1} SeparationInfo DeviceColorant string must not be empty`)
    }
    const colorantName = info.deviceColorant.value
    if (info.colorSpace?.kind === 'separation' && info.colorSpace.name !== colorantName) {
      throw new Error(`PDF page ${sourceIndex + 1} SeparationInfo DeviceColorant must match the Separation colorant`)
    }
    if (info.colorSpace?.kind === 'deviceN' && !info.colorSpace.names.includes(colorantName)) {
      throw new Error(`PDF page ${sourceIndex + 1} SeparationInfo DeviceColorant must be present in the DeviceN colorants`)
    }
    const normalized: PdfSeparationInfo = { ...info, pages: sortedPages }
    const key = pdfSeparationInfoKey(normalized)
    for (let i = 0; i < sortedPages.length; i++) {
      const pageIndex = sortedPages[i]!
      const existingKey = keys.get(pageIndex)
      if (existingKey !== undefined && existingKey !== key) {
        throw new Error(`PDF page ${pageIndex + 1} belongs to conflicting SeparationInfo page sets`)
      }
      keys.set(pageIndex, key)
      result.set(pageIndex, normalized)
    }
  }
  return result
}

function pdfSeparationInfoKey(info: PdfSeparationInfo): string {
  const colorant = info.deviceColorant.kind === 'name'
    ? `name:${info.deviceColorant.value}`
    : `string:${info.deviceColorant.value}`
  return `${info.pages.join(',')}|${colorant}|${info.colorSpace === undefined ? '' : pdfSpecialColorKey(info.colorSpace)}`
}

function validatePdfOutputIntents(intents: PdfOutputIntent[] | undefined): void {
  if (intents === undefined) return
  if (intents.length === 0) throw new Error('PDF outputIntents must not be empty')
  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i]!
    if (intent.subtype.length === 0) throw new Error(`PDF OutputIntent ${i + 1} subtype must not be empty`)
    if (intent.destinationProfile !== undefined && intent.destinationProfileReference !== undefined) {
      throw new Error(`PDF OutputIntent ${i + 1} destination profile and destination profile reference are mutually exclusive`)
    }
    if (intent.destinationProfile !== undefined) {
      if (intent.destinationProfile.data.length === 0) throw new Error(`PDF OutputIntent ${i + 1} destination profile must not be empty`)
      const components = intent.destinationProfile.components
      if (components !== 1 && components !== 3 && components !== 4) {
        throw new Error(`PDF OutputIntent ${i + 1} destination profile components must be 1, 3, or 4`)
      }
      const header = inspectIccProfile(intent.destinationProfile.data)
      if (header.components !== components) {
        throw new Error(`PDF OutputIntent ${i + 1} destination profile components do not match the ICC data color space`)
      }
    }
    if (intent.destinationProfileReference !== undefined) {
      validatePdfDestinationProfileReference(intent.destinationProfileReference, i)
    }
  }
}

function validatePdfPageTransition(transition: PdfPageTransitionDef): void {
  if (transition.style !== undefined && transition.style !== 'Split' && transition.style !== 'Blinds'
    && transition.style !== 'Box' && transition.style !== 'Wipe' && transition.style !== 'Dissolve'
    && transition.style !== 'Glitter' && transition.style !== 'R' && transition.style !== 'Fly'
    && transition.style !== 'Push' && transition.style !== 'Cover' && transition.style !== 'Uncover'
    && transition.style !== 'Fade') {
    throw new Error('PDF page transition style is invalid')
  }
  if (transition.duration !== undefined && (!Number.isFinite(transition.duration) || transition.duration < 0)) {
    throw new Error('PDF page transition duration must be a non-negative finite number')
  }
  if (typeof transition.direction === 'number' && transition.direction !== 0 && transition.direction !== 90
    && transition.direction !== 180 && transition.direction !== 270 && transition.direction !== 315) {
    throw new Error('PDF page transition direction must be 0, 90, 180, 270, 315, or None')
  }
  if (transition.scale !== undefined && (!Number.isFinite(transition.scale) || transition.scale < 0 || transition.scale > 1)) {
    throw new Error('PDF page transition scale must be between 0 and 1')
  }
}

function pdfPageTransitionPdf(transition: PdfPageTransitionDef): string {
  const entries = ['/Type /Trans']
  if (transition.style !== undefined) entries.push(`/S /${transition.style}`)
  if (transition.duration !== undefined) entries.push(`/D ${pn(transition.duration)}`)
  if (transition.dimension !== undefined) entries.push(`/Dm /${transition.dimension}`)
  if (transition.motion !== undefined) entries.push(`/M /${transition.motion}`)
  if (transition.direction !== undefined) entries.push(`/Di ${transition.direction === 'None' ? '/None' : pn(transition.direction)}`)
  if (transition.scale !== undefined) entries.push(`/SS ${pn(transition.scale)}`)
  if (transition.rectangular !== undefined) entries.push(`/B ${transition.rectangular ? 'true' : 'false'}`)
  return `<< ${entries.join(' ')} >>`
}

function calibratedColorComponents(color: CalibratedColor): number[] {
  switch (color.kind) {
    case 'calgray':
      return [color.gray]
    case 'calrgb':
    case 'lab':
      return color.components
  }
}

function deviceNColorKey(color: DeviceNColor): string {
  return `${color.names.join(',')}|${color.tints.join(',')}|${color.alternateCmyk.join(',')}`
}

function functionShadingPaintKey(paint: FunctionShadingPaint, matrix: PaintMatrix): string {
  const prefix = 'fs|' + paint.domain.join(',') + '|' + matrix.map(pn).join(',')
    + '|bg=' + (paint.background?.map(pn).join(',') ?? '')
    + '|bbox=' + (paint.bbox?.map(pn).join(',') ?? '')
    + '|aa=' + (paint.antiAlias === undefined ? '' : String(paint.antiAlias))
  if ('sampled' in paint) {
    const s = paint.sampled
    return prefix + '|sampled|' + s.size.join(',') + '|' + s.bitsPerSample + '|'
      + s.range.join(',') + '|' + (s.encode?.join(',') ?? '') + '|' + (s.decode?.join(',') ?? '')
      + '|' + s.samples.join(',')
  }
  return prefix + '|calculator|' + paint.expression
}

function convertSampledFunctionShadingToCmyk(
  sampled: Extract<FunctionShadingPaint, { sampled: unknown }>['sampled'],
  transform: IccOutputTransform,
  intent: IccRenderingIntent | undefined,
): Extract<FunctionShadingFunctionPdf, { kind: 'sampled' }> {
  const expected = sampled.size[0] * sampled.size[1] * 3
  if (sampled.samples.length !== expected) {
    throw new Error('RGB sampled function samples length must be Size product multiplied by three')
  }
  const converted: number[] = []
  for (let index = 0; index < sampled.samples.length; index += 3) {
    const cmyk = iccOutputCmyk(
      transform,
      intent,
      sampled.samples[index]!,
      sampled.samples[index + 1]!,
      sampled.samples[index + 2]!,
    )
    converted.push(cmyk[0], cmyk[1], cmyk[2], cmyk[3])
  }
  return {
    kind: 'sampled',
    size: [sampled.size[0], sampled.size[1]],
    bitsPerSample: sampled.bitsPerSample,
    range: [0, 1, 0, 1, 0, 1, 0, 1],
    samples: converted,
    encode: sampled.encode,
    decode: [0, 1, 0, 1, 0, 1, 0, 1],
  }
}

function encodeSampledFunctionData(sampled: Extract<FunctionShadingFunctionPdf, { kind: 'sampled' }>): Uint8Array {
  const outputs = sampled.range.length / 2
  const expected = sampled.size[0] * sampled.size[1] * outputs
  if (sampled.samples.length !== expected) {
    throw new Error('Sampled function samples length must match Size and Range output count')
  }
  const bits = sampled.bitsPerSample
  const maxSample = Math.pow(2, bits) - 1
  const totalBits = sampled.samples.length * bits
  const out = new Uint8Array(Math.ceil(totalBits / 8))
  const decode = sampled.decode ?? sampled.range
  let bitPos = 0
  for (let i = 0; i < sampled.samples.length; i++) {
    const component = i % outputs
    const d0 = decode[component * 2]!
    const d1 = decode[component * 2 + 1]!
    const span = d1 - d0
    const normalized = span === 0 ? 0 : (sampled.samples[i]! - d0) / span
    const raw = Math.round(Math.max(0, Math.min(1, normalized)) * maxSample)
    bitPos = writeBits(out, bitPos, raw, bits)
  }
  return out
}

function writeBits(out: Uint8Array, bitPos: number, value: number, bits: number): number {
  for (let bit = bits - 1; bit >= 0; bit--) {
    const mask = Math.pow(2, bit)
    if (Math.floor(value / mask) % 2 === 1) {
      out[bitPos >> 3]! |= 1 << (7 - (bitPos & 7))
    }
    bitPos++
  }
  return bitPos
}

function calibratedColorKey(color: CalibratedColor): string {
  switch (color.kind) {
    case 'calgray':
      return `calgray|${color.whitePoint.join(',')}|${color.gamma}`
    case 'calrgb':
      return `calrgb|${color.whitePoint.join(',')}|${color.gamma.join(',')}|${color.matrix.join(',')}`
    case 'lab':
      return `lab|${color.whitePoint.join(',')}|${color.range.join(',')}`
  }
}

function calibratedColorSpacePdf(color: CalibratedColor): string {
  switch (color.kind) {
    case 'calgray':
      return `[/CalGray << /WhitePoint [${pdfNumberArray(color.whitePoint)}] /Gamma ${pn(color.gamma)} >>]`
    case 'calrgb':
      return `[/CalRGB << /WhitePoint [${pdfNumberArray(color.whitePoint)}] /Gamma [${pdfNumberArray(color.gamma)}] /Matrix [${pdfNumberArray(color.matrix)}] >>]`
    case 'lab':
      return `[/Lab << /WhitePoint [${pdfNumberArray(color.whitePoint)}] /Range [${pdfNumberArray(color.range)}] >>]`
  }
}

function parseCcittMimeParams(mimeType: string | undefined): CcittImageParams | null {
  if (mimeType === undefined) return null
  const parts = mimeType.split(';')
  const type = parts[0]!.trim().toLowerCase()
  if (type !== 'image/ccitt' && type !== 'image/ccitt-fax' && type !== 'image/g3fax' && type !== 'image/g4fax') return null
  const params = new Map<string, string>()
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!
    const eq = part.indexOf('=')
    if (eq < 0) continue
    params.set(part.substring(0, eq).trim().toLowerCase(), part.substring(eq + 1).trim())
  }
  const defaultK = type === 'image/g4fax' ? -1 : 0
  return {
    columns: requiredPositiveIntegerMimeParam(params, 'columns'),
    rows: requiredPositiveIntegerMimeParam(params, 'rows'),
    k: optionalIntegerMimeParam(params, 'k', defaultK),
    blackIs1: optionalBooleanMimeParam(params, 'blackis1', false),
    encodedByteAlign: optionalBooleanMimeParam(params, 'encodedbytealign', false),
    endOfLine: optionalBooleanMimeParam(params, 'endofline', false),
  }
}

function parseEncodedImageMimeParams(mimeType: string | undefined): EncodedImageParams | null {
  if (mimeType === undefined) return null
  const parts = mimeType.split(';')
  const type = parts[0]!.trim().toLowerCase()
  const filter = encodedImageFilterFromMimeType(type)
  if (filter === null) return null
  const params = parseMimeParamMap(parts)
  const colorSpace = requiredDeviceColorSpaceMimeParam(params)
  const bitsPerComponent = requiredBitsPerComponentMimeParam(params)
  return {
    columns: requiredPositiveIntegerMimeParam(params, 'columns'),
    rows: requiredPositiveIntegerMimeParam(params, 'rows'),
    filter,
    colorSpace,
    bitsPerComponent,
    earlyChange: optionalEarlyChangeMimeParam(params),
    predictor: optionalIntegerMimeParam(params, 'predictor', 1),
    colors: optionalIntegerMimeParam(params, 'colors', colorSpaceComponentCount(colorSpace)),
    maskRanges: optionalMaskRangesMimeParam(params),
    decode: optionalNumberArrayMimeParam(params, 'decode'),
    intent: optionalRenderingIntentMimeParam(params),
    interpolate: optionalNullableBooleanMimeParam(params, 'interpolate'),
    inline: optionalBooleanMimeParam(params, 'inline', false),
  }
}

function encodedImageFilterFromMimeType(type: string): EncodedImageParams['filter'] | null {
  if (type === 'image/flate' || type === 'image/pdf-flate') return 'FlateDecode'
  if (type === 'image/lzw' || type === 'image/pdf-lzw') return 'LZWDecode'
  if (type === 'image/asciihex' || type === 'image/pdf-asciihex') return 'ASCIIHexDecode'
  if (type === 'image/ascii85' || type === 'image/pdf-ascii85') return 'ASCII85Decode'
  if (type === 'image/runlength' || type === 'image/pdf-runlength') return 'RunLengthDecode'
  return null
}

function parseMimeParamMap(parts: string[]): Map<string, string> {
  const params = new Map<string, string>()
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!
    const eq = part.indexOf('=')
    if (eq < 0) continue
    params.set(part.substring(0, eq).trim().toLowerCase(), part.substring(eq + 1).trim())
  }
  return params
}

function requiredDeviceColorSpaceMimeParam(params: Map<string, string>): 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK' {
  const value = params.get('colorspace')
  if (value === undefined) throw new Error('LZW image MIME parameter colorspace is required')
  const lower = value.toLowerCase()
  if (lower === 'devicegray' || lower === 'gray') return 'DeviceGray'
  if (lower === 'devicergb' || lower === 'rgb') return 'DeviceRGB'
  if (lower === 'devicecmyk' || lower === 'cmyk') return 'DeviceCMYK'
  throw new Error('LZW image MIME parameter colorspace must be DeviceGray, DeviceRGB, or DeviceCMYK')
}

function requiredBitsPerComponentMimeParam(params: Map<string, string>): 1 | 2 | 4 | 8 | 16 {
  const value = params.get('bitspercomponent') ?? params.get('bpc')
  if (value === undefined) throw new Error('LZW image MIME parameter bitspercomponent is required')
  const n = parseIntegerMimeParam(value, 'bitspercomponent')
  if (n === 1 || n === 2 || n === 4 || n === 8 || n === 16) return n
  throw new Error('LZW image MIME parameter bitspercomponent must be 1, 2, 4, 8, or 16')
}

function optionalEarlyChangeMimeParam(params: Map<string, string>): 0 | 1 {
  const value = params.get('earlychange')
  if (value === undefined) return 1
  const n = parseIntegerMimeParam(value, 'earlychange')
  if (n === 0 || n === 1) return n
  throw new Error('LZW image MIME parameter earlychange must be 0 or 1')
}

function optionalMaskRangesMimeParam(params: Map<string, string>): number[] | null {
  const value = params.get('mask')
  if (value === undefined) return null
  const pieces = value.split(',')
  if (pieces.length === 0 || (pieces.length & 1) !== 0) {
    throw new Error('PDF image MIME parameter mask must contain min,max pairs')
  }
  const ranges = new Array<number>(pieces.length)
  for (let i = 0; i < pieces.length; i++) {
    const n = parseIntegerMimeParam(pieces[i]!.trim(), 'mask')
    if (n < 0) throw new Error('PDF image MIME parameter mask values must be non-negative')
    ranges[i] = n
  }
  return ranges
}

function optionalNumberArrayMimeParam(params: Map<string, string>, name: string): number[] | null {
  const value = params.get(name)
  if (value === undefined) return null
  const pieces = value.split(',')
  if (pieces.length === 0) throw new Error(`PDF image MIME parameter ${name} must contain numbers`)
  const values = new Array<number>(pieces.length)
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!.trim()
    const n = Number(piece)
    if (piece === '' || !Number.isFinite(n)) {
      throw new Error(`PDF image MIME parameter ${name} must contain numbers`)
    }
    values[i] = n
  }
  return values
}

function optionalRenderingIntentMimeParam(params: Map<string, string>): EncodedImageParams['intent'] {
  const value = params.get('intent')
  if (value === undefined) return null
  const normalized = value.charAt(0) === '/' ? value.substring(1) : value
  if (
    normalized === 'AbsoluteColorimetric' ||
    normalized === 'RelativeColorimetric' ||
    normalized === 'Saturation' ||
    normalized === 'Perceptual'
  ) {
    return normalized
  }
  throw new Error('PDF image MIME parameter intent must be AbsoluteColorimetric, RelativeColorimetric, Saturation, or Perceptual')
}

function optionalNullableBooleanMimeParam(params: Map<string, string>, name: string): boolean | null {
  if (!params.has(name)) return null
  return optionalBooleanMimeParam(params, name, false)
}

function colorSpaceComponentCount(colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK'): number {
  if (colorSpace === 'DeviceGray') return 1
  if (colorSpace === 'DeviceRGB') return 3
  return 4
}

function encodedImageDecodeParmsDict(params: EncodedImageParams): string | null {
  const entries: string[] = []
  if (params.filter === 'LZWDecode') entries.push(`/EarlyChange ${params.earlyChange}`)
  if (params.predictor !== 1) {
    entries.push(`/Predictor ${params.predictor}`)
    entries.push(`/Colors ${params.colors}`)
    entries.push(`/BitsPerComponent ${params.bitsPerComponent}`)
    entries.push(`/Columns ${params.columns}`)
  }
  if (entries.length === 0) return null
  return `<< ${entries.join(' ')} >>`
}

function buildEncodedImageDecodeParms(params: EncodedImageParams): string | undefined {
  const dict = encodedImageDecodeParmsDict(params)
  return dict === null ? undefined : `/DecodeParms ${dict}`
}

function buildInlineEncodedImageOp(data: Uint8Array, params: EncodedImageParams): string {
  const lines = [
    'BI',
    `/Width ${params.columns}`,
    `/Height ${params.rows}`,
    `/ColorSpace /${params.colorSpace}`,
    `/BitsPerComponent ${params.bitsPerComponent}`,
    `/Filter [/ASCIIHexDecode /${params.filter}]`,
  ]
  const decodeParms = encodedImageDecodeParmsDict(params)
  if (decodeParms !== null) lines.push(`/DecodeParms [null ${decodeParms}]`)
  if (params.maskRanges !== null) lines.push(`/Mask [${params.maskRanges.join(' ')}]`)
  if (params.decode !== null) lines.push(`/Decode [${params.decode.map(pn).join(' ')}]`)
  if (params.intent !== null) lines.push(`/Intent /${params.intent}`)
  if (params.interpolate !== null) lines.push(`/Interpolate ${params.interpolate ? 'true' : 'false'}`)
  lines.push('ID')
  lines.push(`${asciiHexString(data)}>`)
  lines.push('EI')
  return lines.join('\n')
}

function asciiHexString(data: Uint8Array): string {
  const hex = '0123456789ABCDEF'
  let out = ''
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!
    out += hex[b >> 4]! + hex[b & 15]!
  }
  return out
}

function requiredPositiveIntegerMimeParam(params: Map<string, string>, name: string): number {
  const value = params.get(name)
  if (value === undefined) throw new Error(`PDF image MIME parameter ${name} is required`)
  const n = parseIntegerMimeParam(value, name)
  if (n <= 0) throw new Error(`PDF image MIME parameter ${name} must be positive`)
  return n
}

function optionalIntegerMimeParam(params: Map<string, string>, name: string, defaultValue: number): number {
  const value = params.get(name)
  return value === undefined ? defaultValue : parseIntegerMimeParam(value, name)
}

function parseIntegerMimeParam(value: string, name: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`PDF image MIME parameter ${name} must be an integer`)
  return parseInt(value, 10)
}

function optionalBooleanMimeParam(params: Map<string, string>, name: string, defaultValue: boolean): boolean {
  const value = params.get(name)
  if (value === undefined) return defaultValue
  const lower = value.toLowerCase()
  if (lower === 'true' || lower === '1') return true
  if (lower === 'false' || lower === '0') return false
  throw new Error(`PDF image MIME parameter ${name} must be boolean`)
}

function buildOptionalContentProperties(
  defs: OptionalContentDef[],
  groups: Map<string, PdfOptionalContentGroupDef>,
  objects: Map<string, number>,
  properties: PdfOptionalContentPropertiesDef | undefined,
  pdfa: PdfAConformance | undefined,
): string {
  const allRefs = [...groups.keys()].map(function (id) { return optionalContentGroupRef(id, objects) })
  let model = properties
  if (model === undefined) {
    const on: string[] = []
    const off: string[] = []
    const order: PdfOptionalContentOrderDef[] = []
    const seen = new Set<string>()
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i]!
      const membership = def.content.membership
      const directGroups = membership?.kind === 'membership' ? membership.groups
        : [membership?.kind === 'group' ? membership : groups.get(`legacy:${def.name}`)!]
      for (let gi = 0; gi < directGroups.length; gi++) {
        const groupId = directGroups[gi]!.id
        if (seen.has(groupId)) continue
        seen.add(groupId)
        ;(def.visible ? on : off).push(groupId)
        order.push({ kind: 'group', groupId })
      }
    }
    model = {
      groups: [...groups.values()],
      defaultConfiguration: {
        name: pdfa === 'PDF/A-2b' || pdfa === 'PDF/A-3b' ? 'Default' : undefined,
        baseState: 'ON', on, off, intents: ['View'], order, listMode: 'AllPages', radioButtonGroups: [], locked: [],
        applications: pdfa === 'PDF/A-2b' || pdfa === 'PDF/A-3b' ? [] : [
          { event: 'View', groupIds: [...groups.keys()], categories: ['View'] },
          { event: 'Print', groupIds: [...groups.keys()], categories: ['Print'] },
        ],
      },
      configurations: [],
    }
  }
  if (pdfa === 'PDF/A-2b' || pdfa === 'PDF/A-3b') validatePdfAOptionalContentModel(pdfa, model)
  const defaultPdf = optionalContentConfigurationPdf(model.defaultConfiguration, objects)
  const configsPdf = model.configurations.length === 0 ? '' : ` /Configs [${model.configurations.map(function (config) { return optionalContentConfigurationPdf(config, objects) }).join(' ')}]`
  return `/OCProperties << /OCGs [${allRefs.join(' ')}] /D ${defaultPdf}${configsPdf} >>`
}

function validatePdfAOptionalContentModel(pdfa: PdfAConformance, model: PdfOptionalContentPropertiesDef): void {
  const groupIds = new Set(model.groups.map(function (group) { return group.id }))
  const names = new Set<string>()
  const configurations = [model.defaultConfiguration, ...model.configurations]
  for (let index = 0; index < configurations.length; index++) {
    const configuration = configurations[index]!
    if (configuration.name === undefined || configuration.name.length === 0) {
      throw new Error(`${pdfa} optional-content configuration ${index + 1} requires a non-empty Name`)
    }
    if (names.has(configuration.name)) throw new Error(`${pdfa} optional-content configuration Name must be unique: ${configuration.name}`)
    names.add(configuration.name)
    if (configuration.applications.length > 0) throw new Error(`${pdfa} optional-content configurations forbid AS applications`)
    const ordered = new Set<string>()
    for (let orderIndex = 0; orderIndex < configuration.order.length; orderIndex++) {
      collectOptionalContentOrderGroups(configuration.order[orderIndex]!, ordered)
    }
    for (const groupId of groupIds) {
      if (!ordered.has(groupId)) throw new Error(`${pdfa} optional-content configuration Order omits group ${groupId}`)
    }
  }
}

function collectOptionalContentOrderGroups(order: PdfOptionalContentOrderDef, target: Set<string>): void {
  if (order.kind === 'group') {
    target.add(order.groupId)
    return
  }
  for (let index = 0; index < order.children.length; index++) collectOptionalContentOrderGroups(order.children[index]!, target)
}

function optionalContentConfigurationPdf(config: PdfOptionalContentConfigurationDef, objects: Map<string, number>): string {
  const entries: string[] = []
  if (config.name !== undefined) entries.push(`/Name (${pdfEscapeString(config.name)})`)
  if (config.creator !== undefined) entries.push(`/Creator (${pdfEscapeString(config.creator)})`)
  entries.push(`/BaseState /${config.baseState}`)
  entries.push(`/ON [${config.on.map(function (id) { return optionalContentGroupRef(id, objects) }).join(' ')}]`)
  entries.push(`/OFF [${config.off.map(function (id) { return optionalContentGroupRef(id, objects) }).join(' ')}]`)
  entries.push(config.intents === 'All' ? '/Intent /All' : `/Intent [${config.intents.map(encodePdfName).join(' ')}]`)
  if (config.applications.length > 0) {
    entries.push(`/AS [${config.applications.map(function (application) {
      const refs = application.groupIds.map(function (id) { return optionalContentGroupRef(id, objects) })
      return `<< /Event /${application.event} /OCGs [${refs.join(' ')}] /Category [${application.categories.map(encodePdfName).join(' ')}] >>`
    }).join(' ')}]`)
  }
  entries.push(`/Order [${config.order.map(function (item) { return optionalContentOrderPdf(item, objects) }).join(' ')}]`)
  entries.push(`/ListMode /${config.listMode}`)
  entries.push(`/RBGroups [${config.radioButtonGroups.map(function (radio) { return `[${radio.map(function (id) { return optionalContentGroupRef(id, objects) }).join(' ')}]` }).join(' ')}]`)
  entries.push(`/Locked [${config.locked.map(function (id) { return optionalContentGroupRef(id, objects) }).join(' ')}]`)
  return `<< ${entries.join(' ')} >>`
}

function optionalContentOrderPdf(order: PdfOptionalContentOrderDef, objects: Map<string, number>): string {
  if (order.kind === 'group') return optionalContentGroupRef(order.groupId, objects)
  const label = order.label === undefined ? '' : `(${pdfEscapeString(order.label)}) `
  return `[${label}${order.children.map(function (child) { return optionalContentOrderPdf(child, objects) }).join(' ')}]`
}

function optionalContentGroupRef(id: string, objects: Map<string, number>): string {
  const objectId = objects.get(id)
  if (objectId === undefined) throw new Error(`Optional content group object missing: ${id}`)
  return `${objectId} 0 R`
}

function optionalContentExpressionPdf(expression: PdfOptionalContentExpressionDef, objects: Map<string, number>): string {
  return `[/${expression.operator} ${expression.operands.map(function (operand) {
    return 'operator' in operand ? optionalContentExpressionPdf(operand, objects) : optionalContentGroupRef(operand.id, objects)
  }).join(' ')}]`
}

function optionalContentMembershipKey(membership: PdfOptionalContentGroupDef | PdfOptionalContentMembershipDef): string {
  if (membership.kind === 'group') return `group:${membership.id}`
  return `membership:${membership.policy}:${membership.groups.map(function (group) { return group.id }).join(',')}:${JSON.stringify(membership.expression)}`
}

function validateOptionalContentPropertiesModel(properties: PdfOptionalContentPropertiesDef): void {
  const known = new Set<string>()
  for (let i = 0; i < properties.groups.length; i++) {
    const group = properties.groups[i]!
    if (group.id.length === 0 || known.has(group.id)) throw new Error('Optional content group ids must be non-empty and unique')
    if (group.name.length === 0) throw new Error('Optional content groups require a name')
    known.add(group.id)
  }
  validateOptionalContentConfigurationModel(properties.defaultConfiguration, known, true)
  for (let i = 0; i < properties.configurations.length; i++) validateOptionalContentConfigurationModel(properties.configurations[i]!, known, false)
}

function validateOptionalContentConfigurationModel(config: PdfOptionalContentConfigurationDef, known: Set<string>, isDefault: boolean): void {
  if (isDefault && config.baseState !== 'ON') throw new Error('Default optional content configuration BaseState must be ON')
  if (isDefault && (config.intents === 'All' || config.intents.length !== 1 || config.intents[0] !== 'View')) throw new Error('Default optional content configuration Intent must be View')
  validateOptionalContentIds(config.on, known, 'ON')
  validateOptionalContentIds(config.off, known, 'OFF')
  validateOptionalContentIds(config.locked, known, 'Locked')
  for (let i = 0; i < config.applications.length; i++) validateOptionalContentIds(config.applications[i]!.groupIds, known, 'usage application OCGs')
  const radioMembers = new Set<string>()
  for (let i = 0; i < config.radioButtonGroups.length; i++) {
    const radio = config.radioButtonGroups[i]!
    validateOptionalContentIds(radio, known, 'RBGroups')
    for (let ri = 0; ri < radio.length; ri++) {
      if (radioMembers.has(radio[ri]!)) throw new Error(`Optional content group belongs to more than one RBGroups collection: ${radio[ri]}`)
      radioMembers.add(radio[ri]!)
    }
    let enabled = 0
    for (let ri = 0; ri < radio.length; ri++) {
      const initial = config.off.includes(radio[ri]!) ? false : config.on.includes(radio[ri]!) ? true : config.baseState !== 'OFF'
      if (initial) enabled++
    }
    if (enabled > 1) throw new Error('Optional content RBGroups initial state may enable at most one group')
  }
  for (let i = 0; i < config.order.length; i++) validateOptionalContentOrderModel(config.order[i]!, known)
}

function validateOptionalContentIds(ids: string[], known: Set<string>, label: string): void {
  const seen = new Set<string>()
  for (let i = 0; i < ids.length; i++) {
    if (!known.has(ids[i]!)) throw new Error(`Optional content ${label} references an unknown group: ${ids[i]}`)
    if (seen.has(ids[i]!)) throw new Error(`Optional content ${label} contains a duplicate group: ${ids[i]}`)
    seen.add(ids[i]!)
  }
}

function validateOptionalContentOrderModel(order: PdfOptionalContentOrderDef, known: Set<string>): void {
  if (order.kind === 'group') {
    if (!known.has(order.groupId)) throw new Error(`Optional content Order references an unknown group: ${order.groupId}`)
    return
  }
  for (let i = 0; i < order.children.length; i++) validateOptionalContentOrderModel(order.children[i]!, known)
}

function buildViewerPreferences(prefs: PdfViewerPreferences): string {
  const entries: string[] = []
  if (prefs.hideToolbar !== undefined) entries.push(`/HideToolbar ${pdfBool(prefs.hideToolbar)}`)
  if (prefs.hideMenubar !== undefined) entries.push(`/HideMenubar ${pdfBool(prefs.hideMenubar)}`)
  if (prefs.hideWindowUI !== undefined) entries.push(`/HideWindowUI ${pdfBool(prefs.hideWindowUI)}`)
  if (prefs.fitWindow !== undefined) entries.push(`/FitWindow ${pdfBool(prefs.fitWindow)}`)
  if (prefs.centerWindow !== undefined) entries.push(`/CenterWindow ${pdfBool(prefs.centerWindow)}`)
  if (prefs.displayDocTitle !== undefined) entries.push(`/DisplayDocTitle ${pdfBool(prefs.displayDocTitle)}`)
  if (prefs.nonFullScreenPageMode !== undefined) entries.push(`/NonFullScreenPageMode /${prefs.nonFullScreenPageMode}`)
  if (prefs.direction !== undefined) entries.push(`/Direction /${prefs.direction}`)
  if (prefs.viewArea !== undefined) entries.push(`/ViewArea /${prefs.viewArea}`)
  if (prefs.viewClip !== undefined) entries.push(`/ViewClip /${prefs.viewClip}`)
  if (prefs.printArea !== undefined) entries.push(`/PrintArea /${prefs.printArea}`)
  if (prefs.printClip !== undefined) entries.push(`/PrintClip /${prefs.printClip}`)
  if (prefs.printScaling !== undefined) entries.push(`/PrintScaling /${prefs.printScaling}`)
  if (prefs.duplex !== undefined) entries.push(`/Duplex /${prefs.duplex}`)
  if (prefs.pickTrayByPDFSize !== undefined) entries.push(`/PickTrayByPDFSize ${pdfBool(prefs.pickTrayByPDFSize)}`)
  if (prefs.printPageRange !== undefined) entries.push(`/PrintPageRange [${prefs.printPageRange.map(function (n) { return String(n) }).join(' ')}]`)
  if (prefs.numCopies !== undefined) entries.push(`/NumCopies ${prefs.numCopies}`)
  return entries.join(' ')
}

function buildPageLabelsDictionary(labels: PdfPageLabel[]): string {
  const entries: string[] = []
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!
    const labelEntries: string[] = []
    if (label.style !== undefined) labelEntries.push(`/S /${label.style}`)
    if (label.prefix !== undefined) labelEntries.push(`/P (${pdfEscapeString(label.prefix)})`)
    if (label.start !== undefined) labelEntries.push(`/St ${label.start}`)
    entries.push(`${label.pageIndex} << ${labelEntries.join(' ')} >>`)
  }
  return `<< /Nums [${entries.join(' ')}] >>`
}

function buildOpenActionDestination(action: PdfOpenAction, pageIds: number[], pages: PageData[]): string {
  const pageId = pageIds[action.pageIndex]
  const page = pages[action.pageIndex]
  if (pageId === undefined || page === undefined) {
    throw new Error(`PDF OpenAction page index ${action.pageIndex} out of range`)
  }
  const pageRef = `${pageId} 0 R`
  switch (action.fit) {
    case 'XYZ':
      return `[${pageRef} /XYZ ${pdfDestinationNumberOrNull(action.x)} ${pdfDestinationYOrNull(action.y, page)} ${pdfZoomOrNull(action.zoom)}]`
    case 'Fit':
    case 'FitB':
      return `[${pageRef} /${action.fit}]`
    case 'FitH':
    case 'FitBH':
      return `[${pageRef} /${action.fit} ${pdfDestinationYOrNull(action.y, page)}]`
    case 'FitV':
    case 'FitBV':
      return `[${pageRef} /${action.fit} ${pdfDestinationNumberOrNull(action.x)}]`
    case 'FitR':
      return `[${pageRef} /FitR ${pn(action.left ?? 0)} ${pn(page.height - (action.bottom ?? page.height))} ${pn(action.right ?? page.width)} ${pn(page.height - (action.top ?? 0))}]`
  }
}

function buildPdfDestination(destination: PdfDestinationDef, pageIds: number[]): string {
  if (destination.kind === 'named') {
    return destination.representation === 'name' ? encodePdfName(destination.name) : pdfString(destination.name)
  }
  let page: string
  if (destination.page.kind === 'local') {
    const pageId = pageIds[destination.page.pageIndex]
    if (pageId === undefined) throw new Error(`PDF destination page index ${destination.page.pageIndex} out of range`)
    page = `${pageId} 0 R`
  } else {
    if (!Number.isInteger(destination.page.pageNumber) || destination.page.pageNumber < 0) {
      throw new Error('PDF remote destination page number must be a non-negative integer')
    }
    page = String(destination.page.pageNumber)
  }
  const expected = destination.fit === 'XYZ' ? 3
    : destination.fit === 'FitH' || destination.fit === 'FitV' || destination.fit === 'FitBH' || destination.fit === 'FitBV' ? 1
    : destination.fit === 'FitR' ? 4 : 0
  if (destination.parameters.length !== expected) {
    throw new Error(`PDF ${destination.fit} destination requires ${expected} parameters`)
  }
  const parameters: string[] = []
  for (let i = 0; i < destination.parameters.length; i++) {
    const value = destination.parameters[i]
    if (value === undefined) throw new Error('PDF destination parameter is missing')
    if (value !== null && !Number.isFinite(value)) throw new Error('PDF destination parameters must be finite numbers or null')
    if (destination.fit === 'FitR' && value === null) throw new Error('PDF FitR destination parameters must be numbers')
    parameters.push(value === null ? 'null' : pn(value))
  }
  return `[${page} /${destination.fit}${parameters.length === 0 ? '' : ' ' + parameters.join(' ')}]`
}

function buildPdfStructureDestination(destination: PdfStructureDestinationDef, structElemIds: number[]): string {
  let target: string
  if (destination.target.kind === 'local') {
    const id = structElemIds[destination.target.structureElementIndex]
    if (id === undefined) throw new Error(`PDF structure destination element index ${destination.target.structureElementIndex} out of range`)
    target = `${id} 0 R`
  } else {
    target = `<${bytesToHex(destination.target.structureElementId)}>`
  }
  const expected = destination.fit === 'XYZ' ? 3
    : destination.fit === 'FitH' || destination.fit === 'FitV' || destination.fit === 'FitBH' || destination.fit === 'FitBV' ? 1
    : destination.fit === 'FitR' ? 4 : 0
  if (destination.parameters.length !== expected) {
    throw new Error(`PDF ${destination.fit} structure destination requires ${expected} parameters`)
  }
  const parameters: string[] = []
  for (let i = 0; i < destination.parameters.length; i++) {
    const value = destination.parameters[i]
    if (value === undefined) throw new Error('PDF structure destination parameter is missing')
    if (value !== null && !Number.isFinite(value)) throw new Error('PDF structure destination parameters must be finite numbers or null')
    if (destination.fit === 'FitR' && value === null) throw new Error('PDF FitR structure destination parameters must be numbers')
    parameters.push(value === null ? 'null' : pn(value))
  }
  return `[${target} /${destination.fit}${parameters.length === 0 ? '' : ' ' + parameters.join(' ')}]`
}

function buildPdfEmbeddedTarget(target: PdfEmbeddedTargetDef, path = new Set<PdfEmbeddedTargetDef>()): string {
  if (path.has(target)) throw new Error('PDF embedded GoTo target chain must not be circular')
  path.add(target)
  const entries = [`/R /${target.relationship}`]
  if (target.name !== undefined) entries.push(`/N <${bytesToHex(target.name)}>`)
  if (target.page !== undefined) entries.push(`/P ${pdfEmbeddedTargetSelector(target.page)}`)
  if (target.annotation !== undefined) entries.push(`/A ${pdfEmbeddedTargetSelector(target.annotation)}`)
  if (target.relationship === 'P') {
    if (target.name !== undefined || target.page !== undefined || target.annotation !== undefined) {
      throw new Error('PDF parent embedded GoTo target must not define name, page, or annotation selectors')
    }
  } else {
    const nameTreeTarget = target.name !== undefined && target.page === undefined && target.annotation === undefined
    const annotationTarget = target.name === undefined && target.page !== undefined && target.annotation !== undefined
    if (!nameTreeTarget && !annotationTarget) {
      throw new Error('PDF child embedded GoTo target requires either a name or both page and annotation selectors')
    }
  }
  if (target.target !== undefined) entries.push(`/T ${buildPdfEmbeddedTarget(target.target, path)}`)
  path.delete(target)
  return `<< ${entries.join(' ')} >>`
}

function pdfEmbeddedTargetSelector(value: number | { kind: 'string', bytes: Uint8Array }): string {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) throw new Error('PDF embedded target selector must be a non-negative integer')
    return String(value)
  }
  return `<${bytesToHex(value.bytes)}>`
}

function pdfWindowsLaunchParameters(parameters: PdfWindowsLaunchParametersDef): string {
  const entries = [`/F <${bytesToHex(parameters.file)}>`]
  if (parameters.defaultDirectory !== undefined) entries.push(`/D <${bytesToHex(parameters.defaultDirectory)}>`)
  if (parameters.operation !== undefined) entries.push(`/O <${bytesToHex(parameters.operation)}>`)
  if (parameters.parameters !== undefined) entries.push(`/P <${bytesToHex(parameters.parameters)}>`)
  return `<< ${entries.join(' ')} >>`
}

function buildNamedDestinations(
  anchors: Map<string, { pageIndex: number, y: number }>,
  pageIds: number[],
  pages: PageData[],
  destinations: PdfNamedDestination[],
): string {
  if (anchors.size === 0 && destinations.length === 0) return ''
  const named = new Map<string, string>()
  for (const [name, dest] of anchors) {
    const pageId = pageIds[dest.pageIndex]
    const page = pages[dest.pageIndex]
    if (pageId === undefined || page === undefined) {
      throw new Error(`PDF named destination ${name} page index ${dest.pageIndex} out of range`)
    }
    named.set(name, `[${pageId} 0 R /XYZ 0 ${pn(page.height - dest.y)} null]`)
  }
  for (let i = 0; i < destinations.length; i++) {
    const item = destinations[i]!
    if (named.has(item.name)) throw new Error(`Duplicate PDF named destination: ${item.name}`)
    if (item.destination.kind !== 'explicit' || item.destination.page.kind !== 'local') {
      throw new Error(`PDF named destination ${item.name} requires a local explicit destination`)
    }
    named.set(item.name, buildPdfDestination(item.destination, pageIds))
  }
  const names = Array.from(named.keys()).sort()
  const entries: string[] = []
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    entries.push(`${pdfString(name)} ${named.get(name)!}`)
  }
  if (entries.length === 0) return ''
  return `<< /Names [${entries.join(' ')}] >>`
}

function buildCatalogNames(namedDests: string, javaScript: string, embeddedFiles: string): string {
  const entries: string[] = []
  if (namedDests !== '') entries.push(`/Dests ${namedDests}`)
  if (javaScript !== '') entries.push(`/JavaScript ${javaScript}`)
  if (embeddedFiles !== '') entries.push(`/EmbeddedFiles ${embeddedFiles}`)
  return entries.join(' ')
}

function buildJavaScriptNameTree(actions: PdfJavaScriptAction[]): string {
  if (actions.length === 0) return ''
  const sorted = actions.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 })
  const entries: string[] = []
  let previousName = ''
  for (let i = 0; i < sorted.length; i++) {
    const action = sorted[i]!
    if (action.name === '') throw new Error('PDF JavaScript action name must not be empty')
    if (i > 0 && action.name === previousName) throw new Error(`Duplicate PDF JavaScript action name: ${action.name}`)
    previousName = action.name
    entries.push(`${pdfString(action.name)} << /S /JavaScript /JS ${pdfString(action.script)} >>`)
  }
  return `<< /Names [${entries.join(' ')}] >>`
}

function writeEmbeddedFilesNameTree(
  files: PdfEmbeddedFile[],
  w: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
  collectionFieldKeys: Set<string> | null,
  collectionFolderIds: Set<number> | null,
  identityFiles: Set<string>,
  identityViaEff: boolean,
  pdfa: PdfAConformance | undefined,
): { nameTree: string, associatedFileIds: number[], fileIds: number[] } {
  if (files.length === 0) return { nameTree: '', associatedFileIds: [], fileIds: [] }
  const sorted = files.map(function (file, index) {
    return { file, index, treeName: file.folderId === undefined ? file.name : `<${file.folderId}>${file.name}` }
  }).sort(function (a, b) { return a.treeName < b.treeName ? -1 : a.treeName > b.treeName ? 1 : 0 })
  const entries: string[] = []
  const associatedFileIds: number[] = []
  const fileIds: number[] = new Array(files.length)
  let previousName = ''
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]!
    const file = item.file
    if (file.name === '') throw new Error('PDF embedded file name must not be empty')
    if (file.folderId !== undefined) {
      if (!Number.isInteger(file.folderId) || file.folderId < 0) throw new Error(`PDF embedded file ${file.name} folder ID must be a non-negative integer`)
      if (collectionFolderIds === null || !collectionFolderIds.has(file.folderId)) throw new Error(`PDF embedded file ${file.name} references an unknown collection folder ID`)
    }
    if (i > 0 && item.treeName === previousName) throw new Error(`Duplicate PDF embedded file name-tree key: ${item.treeName}`)
    previousName = item.treeName

    const streamId = alloc()
    const params = buildPdfEmbeddedFileParameters(file, w, alloc, writeStream)
    const mimeType = file.mimeType ?? (pdfa === 'PDF/A-3b' ? 'application/octet-stream' : undefined)
    const subtype = mimeType === undefined ? '' : `/Subtype ${encodePdfName(mimeType)} `
    w.beginObj(streamId)
    const identityMarker = identityFiles.has(file.name)
      ? identityViaEff ? IDENTITY_EFF_MARKER : IDENTITY_CRYPT_MARKER
      : ''
    writeStream(streamId, file.data, `/Type /EmbeddedFile ${subtype}/Params << ${params} >> ${identityMarker}`)
    w.endObj()

    const fileSpecId = alloc()
    fileIds[item.index] = fileSpecId
    const fileSpecEntries = [
      '/Type /Filespec',
      `/F ${pdfFileSpecificationString(file.name)}`,
      `/UF ${pdfString(file.name)}`,
      `/EF << /F ${streamId} 0 R /UF ${streamId} 0 R >>`,
    ]
    if (file.description !== undefined) fileSpecEntries.push(`/Desc ${pdfString(file.description)}`)
    if (file.relationship !== undefined) {
      fileSpecEntries.push(`/AFRelationship ${pdfAfRelationshipPdf(file.relationship)}`)
      associatedFileIds.push(fileSpecId)
    }
    const collectionItem = buildCollectionItemDictionary(file.collectionItem, collectionFieldKeys)
    if (collectionItem !== '') fileSpecEntries.push(`/CI ${collectionItem}`)
    w.writeDeferredDict(fileSpecId, fileSpecEntries)
    entries.push(`${pdfString(item.treeName)} ${fileSpecId} 0 R`)
  }
  return { nameTree: `<< /Names [${entries.join(' ')}] >>`, associatedFileIds, fileIds }
}

function pdfCollectionFieldKeys(collection: PdfCollection | undefined): Set<string> | null {
  if (collection === undefined || collection.schema === undefined) return null
  const keys = new Set<string>()
  for (let i = 0; i < collection.schema.length; i++) {
    const field = collection.schema[i]!
    if (field.key === '') throw new Error('PDF collection field key must not be empty')
    if (keys.has(field.key)) throw new Error(`Duplicate PDF collection field key: ${field.key}`)
    keys.add(field.key)
  }
  return keys
}

function pdfCollectionFolderIds(root: PdfCollectionFolder | undefined): Set<number> | null {
  if (root === undefined) return null
  const ids = new Set<number>()
  const folders: PdfCollectionFolder[] = [root]
  while (folders.length > 0) {
    const folder = folders.pop()!
    if (!Number.isInteger(folder.id) || folder.id < 0) throw new Error('PDF collection folder IDs must be non-negative integers')
    if (ids.has(folder.id)) throw new Error(`Duplicate PDF collection folder ID: ${folder.id}`)
    ids.add(folder.id)
    if (folder.children !== undefined) {
      for (let i = folder.children.length - 1; i >= 0; i--) folders.push(folder.children[i]!)
    }
  }
  return ids
}

function writeCollectionDictionary(
  collection: PdfCollection | undefined,
  fieldKeys: Set<string> | null,
  writer: PdfWriter,
  alloc: () => number,
  imageObjects: Map<string, number>,
  imageRefMap: Map<string, string>,
): string {
  if (collection === undefined) return ''
  const entries = ['/Type /Collection']
  if (collection.schema !== undefined && collection.schema.length > 0) {
    const fieldEntries: string[] = []
    for (let i = 0; i < collection.schema.length; i++) {
      const field = collection.schema[i]!
      const dict = [
        '/Type /CollectionField',
        `/Subtype /${field.subtype}`,
        `/N ${pdfString(field.name)}`,
      ]
      if (field.order !== undefined) dict.push(`/O ${field.order}`)
      if (field.visible !== undefined) dict.push(`/V ${pdfBool(field.visible)}`)
      if (field.editable !== undefined) dict.push(`/E ${pdfBool(field.editable)}`)
      fieldEntries.push(`/${escapePdfNameBody(field.key)} << ${dict.join(' ')} >>`)
    }
    entries.push(`/Schema << /Type /CollectionSchema ${fieldEntries.join(' ')} >>`)
  }
  if (collection.initialDocument !== undefined) entries.push(`/D ${pdfString(collection.initialDocument)}`)
  if (collection.view !== undefined) entries.push(`/View /${collection.view}`)
  if (collection.view === 'C' && collection.navigator === undefined) throw new Error('PDF collection view C requires a navigator')
  if (collection.navigator !== undefined) {
    if (collection.navigator.layouts.length === 0) throw new Error('PDF collection navigator layouts must not be empty')
    const lastLayout = collection.navigator.layouts[collection.navigator.layouts.length - 1]!
    if (lastLayout !== 'D' && lastLayout !== 'T' && lastLayout !== 'H') {
      throw new Error('PDF collection navigator layouts must end with D, T, or H')
    }
    const navigatorId = alloc()
    const layouts = collection.navigator.layouts.map(encodePdfName)
    writer.writeDeferredDict(navigatorId, [
      '/Type /Navigator',
      `/Layout ${layouts.length === 1 ? layouts[0]! : `[${layouts.join(' ')}]`}`,
    ])
    entries.push(`/Navigator ${navigatorId} 0 R`)
  }
  if (collection.colors !== undefined) {
    const colors: string[] = ['/Type /CollectionColors']
    appendPdfCollectionColor(colors, 'Background', collection.colors.background)
    appendPdfCollectionColor(colors, 'CardBackground', collection.colors.cardBackground)
    appendPdfCollectionColor(colors, 'CardBorder', collection.colors.cardBorder)
    appendPdfCollectionColor(colors, 'PrimaryText', collection.colors.primaryText)
    appendPdfCollectionColor(colors, 'SecondaryText', collection.colors.secondaryText)
    entries.push(`/Colors << ${colors.join(' ')} >>`)
  }
  if (collection.sort !== undefined) entries.push(`/Sort ${buildCollectionSortDictionary(collection.sort, fieldKeys)}`)
  if (collection.folders !== undefined) {
    const folderIds = new Map<PdfCollectionFolder, number>()
    const folderList: Array<{ folder: PdfCollectionFolder, parent?: PdfCollectionFolder, next?: PdfCollectionFolder, root: boolean }> = [
      { folder: collection.folders, root: true },
    ]
    const usedIds = new Set<number>()
    for (let listIndex = 0; listIndex < folderList.length; listIndex++) {
      const item = folderList[listIndex]!
      const folder = item.folder
      if (!Number.isInteger(folder.id) || folder.id < 0) throw new Error('PDF collection folder IDs must be non-negative integers')
      if (usedIds.has(folder.id)) throw new Error(`Duplicate PDF collection folder ID: ${folder.id}`)
      usedIds.add(folder.id)
      if (folder.name === '') throw new Error(`PDF collection folder ${folder.id} name must not be empty`)
      if (!item.root && folder.freeIdRanges !== undefined) throw new Error(`PDF collection folder ${folder.id} Free ranges are valid only on the root`)
      folderIds.set(folder, alloc())
      if (folder.children !== undefined) {
        const siblingNames = new Set<string>()
        for (let childIndex = 0; childIndex < folder.children.length; childIndex++) {
          const child = folder.children[childIndex]!
          const normalized = child.name.normalize('NFKC').toLowerCase()
          if (siblingNames.has(normalized)) throw new Error(`PDF collection folder ${folder.id} has duplicate sibling name ${child.name}`)
          siblingNames.add(normalized)
          folderList.push({ folder: child, parent: folder, next: folder.children[childIndex + 1], root: false })
        }
      }
    }
    if (collection.folders.freeIdRanges !== undefined) {
      for (const id of usedIds) {
        for (let rangeIndex = 0; rangeIndex < collection.folders.freeIdRanges.length; rangeIndex++) {
          const range = collection.folders.freeIdRanges[rangeIndex]!
          if (id >= range[0] && id <= range[1]) throw new Error(`PDF collection folder Free range contains the used ID ${id}`)
        }
      }
    }
    for (let listIndex = 0; listIndex < folderList.length; listIndex++) {
      const item = folderList[listIndex]!
      const folder = item.folder
      const folderEntries = ['/Type /Folder', `/ID ${folder.id}`, `/Name ${pdfString(folder.name)}`]
      if (item.parent !== undefined) folderEntries.push(`/Parent ${folderIds.get(item.parent)!} 0 R`)
      if (folder.children !== undefined && folder.children.length > 0) folderEntries.push(`/Child ${folderIds.get(folder.children[0]!)!} 0 R`)
      if (item.next !== undefined) folderEntries.push(`/Next ${folderIds.get(item.next)!} 0 R`)
      const collectionItem = buildCollectionItemDictionary(folder.collectionItem, fieldKeys)
      if (collectionItem !== '') folderEntries.push(`/CI ${collectionItem}`)
      if (folder.description !== undefined) folderEntries.push(`/Desc ${pdfString(folder.description)}`)
      if (folder.creationDate !== undefined) folderEntries.push(`/CreationDate ${pdfString(folder.creationDate)}`)
      if (folder.modificationDate !== undefined) folderEntries.push(`/ModDate ${pdfString(folder.modificationDate)}`)
      if (folder.thumbnailImageId !== undefined) {
        const imageName = imageRefMap.get(folder.thumbnailImageId)
        const imageId = imageName === undefined ? undefined : imageObjects.get(imageName)
        if (imageId === undefined) throw new Error(`PDF collection folder thumbnail is not registered: ${folder.thumbnailImageId}`)
        folderEntries.push(`/Thumb ${imageId} 0 R`)
      }
      if (folder.freeIdRanges !== undefined) {
        const ranges: string[] = []
        let previousHigh = -1
        for (let rangeIndex = 0; rangeIndex < folder.freeIdRanges.length; rangeIndex++) {
          const range = folder.freeIdRanges[rangeIndex]!
          if (!Number.isInteger(range[0]) || !Number.isInteger(range[1]) || range[0] < 0 || range[0] > range[1]) {
            throw new Error('PDF collection folder Free ranges must be ordered non-negative integer pairs')
          }
          if (range[0] <= previousHigh) throw new Error('PDF collection folder Free ranges must not overlap')
          previousHigh = range[1]
          ranges.push(`${range[0]} ${range[1]}`)
        }
        folderEntries.push(`/Free [${ranges.join(' ')}]`)
      }
      writer.writeDeferredDict(folderIds.get(folder)!, folderEntries)
    }
    entries.push(`/Folders ${folderIds.get(collection.folders)!} 0 R`)
  }
  if (collection.split !== undefined) {
    const split = ['/Type /CollectionSplit']
    if (collection.split.direction !== undefined) split.push(`/Direction /${collection.split.direction}`)
    if (collection.split.position !== undefined) {
      if (!Number.isFinite(collection.split.position) || collection.split.position < 0 || collection.split.position > 100) {
        throw new Error('PDF collection split position must be from 0 to 100')
      }
      split.push(`/Position ${pn(collection.split.position)}`)
    }
    entries.push(`/Split << ${split.join(' ')} >>`)
  }
  return `<< ${entries.join(' ')} >>`
}

function appendPdfCollectionColor(entries: string[], key: string, color: PdfCollectionRgb | undefined): void {
  if (color === undefined) return
  for (let component = 0; component < 3; component++) {
    if (!Number.isFinite(color[component]) || color[component]! < 0 || color[component]! > 1) {
      throw new Error(`PDF collection ${key} color components must be from 0 to 1`)
    }
  }
  entries.push(`/${key} [${color.map(pn).join(' ')}]`)
}

function buildCollectionSortDictionary(sort: PdfCollectionSort, fieldKeys: Set<string> | null): string {
  if (sort.keys.length === 0) throw new Error('PDF collection sort keys must not be empty')
  if (fieldKeys === null) throw new Error('PDF collection sort requires a schema')
  const keyNames: string[] = []
  for (let i = 0; i < sort.keys.length; i++) {
    const key = sort.keys[i]!
    if (!fieldKeys.has(key)) throw new Error(`PDF collection sort key is not in schema: ${key}`)
    keyNames.push(`/${escapePdfNameBody(key)}`)
  }
  const entries = [
    '/Type /CollectionSort',
    `/S ${keyNames.length === 1 ? keyNames[0]! : `[${keyNames.join(' ')}]`}`,
  ]
  if (sort.ascending !== undefined) {
    if (Array.isArray(sort.ascending)) {
      entries.push(`/A [${sort.ascending.map(pdfBool).join(' ')}]`)
    } else {
      entries.push(`/A ${pdfBool(sort.ascending)}`)
    }
  }
  return `<< ${entries.join(' ')} >>`
}

function buildCollectionItemDictionary(item: Record<string, PdfCollectionItemValue> | undefined, fieldKeys: Set<string> | null): string {
  if (item === undefined) return ''
  if (fieldKeys === null || fieldKeys.size === 0) throw new Error('PDF embedded file collection item requires a collection schema')
  const keys = Object.keys(item).sort()
  const entries: string[] = ['/Type /CollectionItem']
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    if (!fieldKeys.has(key)) throw new Error(`PDF embedded file collection item key is not in schema: ${key}`)
    entries.push(`/${escapePdfNameBody(key)} ${pdfCollectionItemValue(item[key]!)}`)
  }
  return `<< ${entries.join(' ')} >>`
}

function pdfCollectionItemValue(value: PdfCollectionItemValue): string {
  if (typeof value === 'number') return pn(value)
  if (!(value instanceof Date) && typeof value === 'object') {
    const entries = [`/Type /CollectionSubitem`, `/D ${pdfCollectionItemValue(value.value)}`]
    if (value.prefix !== undefined) entries.push(`/P ${pdfString(value.prefix)}`)
    return `<< ${entries.join(' ')} >>`
  }
  return pdfString(value)
}

function buildPdfAnnotationData(
  annotations: PdfAnnotation[],
  pageCount: number,
  alloc: () => number,
): { byPage: Map<number, number[]>, ids: number[], popupByParent: Map<number, number>, richMediaInstanceIds: Map<number, number[]> } {
  const byPage = new Map<number, number[]>()
  const ids: number[] = []
  const popupByParent = new Map<number, number>()
  const richMediaInstanceIds = new Map<number, number[]>()
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i]!
    if (annotation.pageIndex < 0 || annotation.pageIndex >= pageCount) {
      throw new Error(`PDF annotation ${i + 1} page index ${annotation.pageIndex} out of range`)
    }
    validatePrepressAnnotation(annotation, i)
    ids.push(alloc())
    if (annotation.subtype === 'RichMedia') {
      const count = isPreservedAnnotation(annotation) ? countPreservedRichMediaInstances(annotation) : 1
      const instanceIds: number[] = []
      for (let j = 0; j < count; j++) instanceIds.push(alloc())
      richMediaInstanceIds.set(i, instanceIds)
    }
    let list = byPage.get(annotation.pageIndex)
    if (list === undefined) {
      list = []
      byPage.set(annotation.pageIndex, list)
    }
    list.push(i)
  }
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i]!
    if (annotation.subtype !== 'Popup') continue
    const parentIndex = annotation.parentIndex
    if (parentIndex === undefined || !Number.isInteger(parentIndex) || parentIndex < 0 || parentIndex >= annotations.length) {
      throw new Error(`PDF Popup annotation ${i + 1} parent index ${parentIndex} out of range`)
    }
    if (parentIndex === i) throw new Error(`PDF Popup annotation ${i + 1} cannot reference itself as parent`)
    const parent = annotations[parentIndex]!
    if (parent.subtype === 'Popup') throw new Error(`PDF Popup annotation ${i + 1} parent must not be another Popup annotation`)
    if (parent.pageIndex !== annotation.pageIndex) throw new Error(`PDF Popup annotation ${i + 1} parent must be on the same page`)
    if (popupByParent.has(parentIndex)) throw new Error(`PDF annotation ${parentIndex + 1} has more than one Popup annotation`)
    popupByParent.set(parentIndex, ids[i]!)
  }
  const trapNetPages = new Set<number>()
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i]!
    if (annotation.subtype !== 'TrapNet') continue
    if (trapNetPages.has(annotation.pageIndex)) throw new Error(`PDF page ${annotation.pageIndex + 1} has more than one TrapNet annotation`)
    trapNetPages.add(annotation.pageIndex)
  }
  return { byPage, ids, popupByParent, richMediaInstanceIds }
}

function validatePrepressAnnotation(annotation: PdfAnnotation, index: number): void {
  if (isPreservedAnnotation(annotation)) return
  if (annotation.subtype !== 'PrinterMark' && annotation.subtype !== 'TrapNet') return
  if (annotation.flags !== undefined && annotation.flags !== 68) {
    throw new Error(`PDF ${annotation.subtype} annotation ${index + 1} flags must be Print and ReadOnly only`)
  }
  if (annotation.appearances.length === 0) {
    throw new Error(`PDF ${annotation.subtype} annotation ${index + 1} requires at least one appearance`)
  }
  const names = new Set<string>()
  for (let i = 0; i < annotation.appearances.length; i++) {
    const appearance = annotation.appearances[i]!
    if (appearance.name.length === 0) throw new Error(`PDF ${annotation.subtype} annotation appearance name must not be empty`)
    if (names.has(appearance.name)) throw new Error(`PDF ${annotation.subtype} annotation has duplicate appearance ${appearance.name}`)
    names.add(appearance.name)
    if (appearance.content.length === 0) throw new Error(`PDF ${annotation.subtype} annotation appearance ${appearance.name} must not be empty`)
    if (appearance.bbox[0] > appearance.bbox[2] || appearance.bbox[1] > appearance.bbox[3]) {
      throw new Error(`PDF ${annotation.subtype} annotation appearance ${appearance.name} BBox must be ordered`)
    }
    for (let j = 0; j < appearance.bbox.length; j++) {
      if (!Number.isFinite(appearance.bbox[j])) throw new Error(`PDF ${annotation.subtype} annotation appearance BBox must be finite`)
    }
    if ('colorants' in appearance && appearance.colorants !== undefined) {
      for (const colorant of Object.keys(appearance.colorants)) {
        if (appearance.colorants[colorant]!.name !== colorant) {
          throw new Error(`PDF PrinterMark appearance Colorants key ${colorant} must match its Separation colorant`)
        }
      }
    }
  }
  if (annotation.subtype === 'PrinterMark') {
    if (annotation.appearances.length > 1 && annotation.appearanceState === undefined) {
      throw new Error(`PDF PrinterMark annotation ${index + 1} requires appearanceState for alternate appearances`)
    }
    if (annotation.appearanceState !== undefined && !names.has(annotation.appearanceState)) {
      throw new Error(`PDF PrinterMark annotation ${index + 1} appearanceState does not name an appearance`)
    }
  } else {
    if (!names.has(annotation.appearanceState)) {
      throw new Error(`PDF TrapNet annotation ${index + 1} appearanceState does not name an appearance`)
    }
    if ((annotation.lastModified === undefined) === (annotation.version === undefined)) {
      throw new Error(`PDF TrapNet annotation ${index + 1} requires exactly one invalidation method`)
    }
  }
}

function writePrepressAppearanceDictionary(
  appearances: readonly (PdfPrepressAppearance | PdfPrinterMarkAppearance)[],
  appearanceState: string | undefined,
  printerMark: boolean,
  pdfx: PdfXConformance | undefined,
  w: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
  rawDictionaryPdf: (entries: Record<string, PdfRawValueDef>) => string,
  separationColorSpacePdf: (colorSpace: PdfSeparationColorSpaceDef) => string,
): { dictionary: string, state?: string } {
  const refs: string[] = []
  for (let i = 0; i < appearances.length; i++) {
    const appearance = appearances[i]!
    const id = alloc()
    const entries = [
      '/Type /XObject',
      '/Subtype /Form',
      `/BBox ${pdfPageBoxString(appearance.bbox)}`,
      `/Resources ${rawDictionaryPdf(appearance.resources ?? {})}`,
    ]
    if (!printerMark && pdfx !== undefined) entries.push('/PCM /DeviceCMYK')
    if (appearance.matrix !== undefined) entries.push(`/Matrix [${appearance.matrix.map(pn).join(' ')}]`)
    if (printerMark) {
      const mark = appearance as PdfPrinterMarkAppearance
      if (mark.markStyle !== undefined) entries.push(`/MarkStyle ${pdfString(mark.markStyle)}`)
      if (mark.colorants !== undefined) {
        const colorants = Object.keys(mark.colorants).map(function (name) {
          return `${encodePdfName(name)} ${separationColorSpacePdf(mark.colorants![name]!)}`
        })
        entries.push(`/Colorants << ${colorants.join(' ')} >>`)
      }
    }
    w.beginObj(id)
    writeStream(id, appearance.content, entries.join(' ') + ' ')
    w.endObj()
    refs.push(`${encodePdfName(appearance.name)} ${id} 0 R`)
  }
  if (appearances.length === 1 && appearanceState === undefined) {
    const ref = refs[0]!.substring(refs[0]!.indexOf(' ') + 1)
    return { dictionary: `<< /N ${ref} >>` }
  }
  return { dictionary: `<< /N << ${refs.join(' ')} >> >>`, ...(appearanceState === undefined ? {} : { state: appearanceState }) }
}

function writePdfAnnotation(
  annotId: number,
  annotationIndex: number,
  annotation: PdfAnnotation,
  page: PageData,
  pageId: number,
  w: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
  annotationIds: number[],
  richMediaInstanceIds: Map<number, number[]>,
  pageIds: number[],
  popupId: number | undefined,
  actionPdf: (action: PdfActionDef) => string,
  rawValuePdf: (value: PdfRawValueDef) => string,
  rawDictionaryPdf: (entries: Record<string, PdfRawValueDef>) => string,
  separationColorSpacePdf: (colorSpace: PdfSeparationColorSpaceDef) => string,
  pageVersionObjectIds: number[],
  pageAnnotationStates: (string | null)[],
  fontRefMap: Map<string, string>,
  fontObjects: Map<string, number>,
  fontGidRemap: Map<string, Map<number, number>>,
  structParent: number | undefined,
  pdfa: PdfAConformance | undefined,
  pdfx: PdfXConformance | undefined,
  preparedAppearance: PreparedAnnotationAppearance | undefined,
  defaultCmykColorSpaceId: number | undefined,
): void {
  const dict = [
    '/Type /Annot',
    `/Subtype /${annotation.subtype}`,
    `/Rect ${pdfAnnotationRect(annotation, page)}`,
    `/P ${pageId} 0 R`,
  ]
  if (structParent !== undefined) dict.push(`/StructParent ${structParent}`)
  appendPdfAnnotationCommon(dict, annotation, pageIds, popupId, actionPdf)
  if (pdfa !== undefined && annotation.subtype !== 'Popup' && annotation.flags === undefined) dict.push('/F 4')
  if ((annotation.subtype === 'PrinterMark' || annotation.subtype === 'TrapNet') && annotation.flags === undefined) {
    dict.push('/F 68')
  }
  const associatedFileIds: number[] = []
  if (annotation.associatedFiles !== undefined) {
    if (annotation.associatedFiles.length === 0) throw new Error('PDF annotation associatedFiles must not be empty')
    for (let i = 0; i < annotation.associatedFiles.length; i++) {
      const file = annotation.associatedFiles[i]!
      if (file.relationship === undefined) throw new Error('PDF annotation associated file requires an AFRelationship')
      const fileSpec = writeAnnotationFileSpec(file, w, alloc, writeStream)
      const fileId = alloc()
      w.writeDeferredDict(fileId, [fileSpec.substring(2, fileSpec.length - 2).trim()])
      associatedFileIds.push(fileId)
    }
  }

  if (isPreservedAnnotation(annotation)) {
    if (annotation.subtype === 'Widget') {
      const fieldType = annotation.entries.FT
      if (fieldType === undefined || fieldType === null || typeof fieldType !== 'object' || fieldType.kind !== 'name'
        || (fieldType.value !== 'Btn' && fieldType.value !== 'Tx' && fieldType.value !== 'Ch' && fieldType.value !== 'Sig')) {
        throw new Error('PDF preserved Widget annotation requires FT name Btn, Tx, Ch, or Sig')
      }
    }
    if (annotation.subtype === 'Popup') {
      if (annotation.parentIndex === undefined) throw new Error('PDF preserved Popup annotation requires parentIndex')
      const parentId = annotationIds[annotation.parentIndex]
      if (parentId === undefined) throw new Error(`PDF preserved Popup parent index ${annotation.parentIndex} out of range`)
      dict.push(`/Parent ${parentId} 0 R`)
    }
    if (annotation.popupIndex !== undefined) {
      const targetId = annotationIds[annotation.popupIndex]
      if (targetId === undefined) throw new Error(`PDF annotation Popup index ${annotation.popupIndex} out of range`)
      if (popupId !== undefined && popupId !== targetId) throw new Error('PDF annotation has conflicting Popup relationships')
      if (popupId === undefined) dict.push(`/Popup ${targetId} 0 R`)
    }
    if (annotation.replyToIndex !== undefined) {
      const targetId = annotationIds[annotation.replyToIndex]
      if (targetId === undefined) throw new Error(`PDF annotation reply-to index ${annotation.replyToIndex} out of range`)
      dict.push(`/IRT ${targetId} 0 R`)
    }
    if (annotation.appearanceDictionary !== undefined) dict.push(`/AP ${rawDictionaryPdf(annotation.appearanceDictionary)}`)
    if (annotation.appearanceState !== undefined) dict.push(`/AS ${encodePdfName(annotation.appearanceState)}`)
    const reserved = new Set(['Type', 'Subtype', 'Rect', 'P', 'Contents', 'NM', 'M', 'F', 'C', 'CA', 'A', 'Dest', 'AA', 'AP', 'AS', 'AF', 'Popup', 'Parent', 'IRT'])
    for (const key of Object.keys(annotation.entries)) {
      if (reserved.has(key) && !(key === 'A' && annotation.action === undefined)) {
        throw new Error(`PDF preserved annotation entries must not contain reserved key ${key}`)
      }
      if (annotation.subtype === 'RichMedia' && key === 'RichMediaContent') {
        const instanceIds = richMediaInstanceIds.get(annotationIndex)
        if (instanceIds === undefined) throw new Error('PDF preserved RichMedia instance objects were not allocated')
        dict.push(`/RichMediaContent ${writePreservedRichMediaContent(annotation.entries[key]!, instanceIds, w, rawValuePdf)}`)
      } else {
        dict.push(`${encodePdfName(key)} ${rawValuePdf(annotation.entries[key]!)}`)
      }
    }
  } else if (annotation.subtype === 'Link') {
    // Link destination/action entries are emitted by the common dictionary.
  } else if (annotation.subtype === 'Text') {
    if (annotation.icon !== undefined) dict.push(`/Name /${annotation.icon}`)
    if (annotation.open !== undefined) dict.push(`/Open ${pdfBool(annotation.open)}`)
  } else if (annotation.subtype === 'FreeText') {
    const defaultAppearance = preparedAppearance === undefined
      ? annotation.defaultAppearance
      : `${preparedAppearance.fontResource} ${pn(preparedAppearance.fontSize)} Tf ${preparedAppearance.colorOp}`
    dict.push(`/DA ${pdfString(defaultAppearance)}`)
    if (annotation.defaultStyle !== undefined) dict.push(`/DS ${pdfString(annotation.defaultStyle)}`)
    if (annotation.quadding !== undefined) dict.push(`/Q ${annotation.quadding}`)
  } else if (annotation.subtype === 'Line') {
    dict.push(`/L [${pdfAnnotationPoint(annotation.start, page)} ${pdfAnnotationPoint(annotation.end, page)}]`)
    if (annotation.lineEndings !== undefined) dict.push(`/LE [/${annotation.lineEndings[0]} /${annotation.lineEndings[1]}]`)
    if (annotation.interiorColor !== undefined) dict.push(`/IC ${pdfAnnotationColor(annotation.interiorColor)}`)
  } else if (annotation.subtype === 'Square' || annotation.subtype === 'Circle') {
    if (annotation.interiorColor !== undefined) dict.push(`/IC ${pdfAnnotationColor(annotation.interiorColor)}`)
  } else if (annotation.subtype === 'Polygon' || annotation.subtype === 'PolyLine') {
    if (annotation.vertices.length === 0) throw new Error(`PDF ${annotation.subtype} annotation requires at least one vertex`)
    dict.push(`/Vertices [${pdfAnnotationVertices(annotation.vertices, page)}]`)
    if (annotation.subtype === 'PolyLine' && annotation.lineEndings !== undefined) {
      dict.push(`/LE [/${annotation.lineEndings[0]} /${annotation.lineEndings[1]}]`)
    }
    if (annotation.interiorColor !== undefined) dict.push(`/IC ${pdfAnnotationColor(annotation.interiorColor)}`)
  } else if (annotation.subtype === 'Highlight' || annotation.subtype === 'Underline' || annotation.subtype === 'Squiggly' || annotation.subtype === 'StrikeOut') {
    if (annotation.quadPoints.length === 0) throw new Error(`PDF ${annotation.subtype} annotation requires at least one QuadPoints entry`)
    dict.push(`/QuadPoints [${pdfAnnotationQuadPoints(annotation.quadPoints, page)}]`)
  } else if (annotation.subtype === 'Stamp') {
    if (annotation.icon !== undefined) dict.push(`/Name /${annotation.icon}`)
  } else if (annotation.subtype === 'Caret') {
    if (annotation.symbol !== undefined) dict.push(`/Sy /${annotation.symbol}`)
    if (annotation.rectDifferences !== undefined) dict.push(`/RD [${annotation.rectDifferences.map(pn).join(' ')}]`)
  } else if (annotation.subtype === 'Ink') {
    if (annotation.paths.length === 0) throw new Error('PDF Ink annotation requires at least one path')
    dict.push(`/InkList [${pdfAnnotationInkList(annotation.paths, page)}]`)
  } else if (annotation.subtype === 'Popup') {
    dict.push(`/Parent ${annotationIds[annotation.parentIndex]!} 0 R`)
    if (annotation.open !== undefined) dict.push(`/Open ${pdfBool(annotation.open)}`)
  } else if (annotation.subtype === 'Sound') {
    dict.push(`/Sound ${writeAnnotationSound(annotation, w, alloc, writeStream)} 0 R`)
    if (annotation.icon !== undefined) dict.push(`/Name /${annotation.icon}`)
  } else if (annotation.subtype === 'Movie') {
    if (annotation.title !== undefined) dict.push(`/T ${pdfString(annotation.title)}`)
    dict.push(`/Movie ${pdfMovieDictionary(annotation.movie, w, alloc, writeStream)}`)
    if (annotation.activation !== undefined) dict.push(`/A ${pdfBool(annotation.activation)}`)
  } else if (annotation.subtype === 'Screen') {
    if (annotation.title !== undefined) dict.push(`/T ${pdfString(annotation.title)}`)
    if (annotation.appearance !== undefined) dict.push(`/MK ${pdfScreenAppearance(annotation.appearance)}`)
    if (annotation.media !== undefined) {
      if (annotation.action !== undefined || annotation.destination !== undefined) throw new Error('PDF Screen annotation media and explicit action/destination are mutually exclusive')
      dict.push(`/A ${writeScreenRenditionAction(annotation.media, annotId, w, alloc, writeStream)} 0 R`)
    }
  } else if (annotation.subtype === 'PrinterMark') {
    if (annotation.markName !== undefined) dict.push(`/MN ${encodePdfName(annotation.markName)}`)
    const appearance = writePrepressAppearanceDictionary(
      annotation.appearances,
      annotation.appearanceState,
      true,
      pdfx,
      w,
      alloc,
      writeStream,
      rawDictionaryPdf,
      separationColorSpacePdf,
    )
    dict.push(`/AP ${appearance.dictionary}`)
    if (appearance.state !== undefined) dict.push(`/AS ${encodePdfName(appearance.state)}`)
  } else if (annotation.subtype === 'TrapNet') {
    const appearance = writePrepressAppearanceDictionary(
      annotation.appearances,
      annotation.appearanceState,
      false,
      pdfx,
      w,
      alloc,
      writeStream,
      rawDictionaryPdf,
      separationColorSpacePdf,
    )
    dict.push(`/AP ${appearance.dictionary}`)
    dict.push(`/AS ${encodePdfName(annotation.appearanceState)}`)
    if (annotation.lastModified !== undefined) dict.push(`/LastModified ${pdfString(annotation.lastModified)}`)
    if (annotation.version !== undefined) {
      dict.push(`/Version [${pageVersionObjectIds.map(function (id) { return `${id} 0 R` }).join(' ')}]`)
      dict.push(`/AnnotStates [${pageAnnotationStates.map(function (state) { return state === null ? 'null' : encodePdfName(state) }).join(' ')}]`)
    }
    if (annotation.fontFauxingFontIds !== undefined) {
      const ids = annotation.fontFauxingFontIds.map(function (fontId) {
        const resourceName = fontRefMap.get(fontId)
        const id = resourceName === undefined ? undefined : fontObjects.get(resourceName)
        if (id === undefined) throw new Error(`PDF TrapNet FontFauxing font is not embedded: ${fontId}`)
        return `${id} 0 R`
      })
      if (ids.length === 0) throw new Error('PDF TrapNet FontFauxing must not be empty')
      dict.push(`/FontFauxing [${ids.join(' ')}]`)
    }
  } else if (annotation.subtype === 'Watermark') {
    if (annotation.fixedPrint !== undefined) dict.push(`/FixedPrint ${pdfFixedPrint(annotation.fixedPrint)}`)
  } else if (annotation.subtype === 'FileAttachment') {
    const fileSpec = writeAnnotationFileSpec(annotation.file, w, alloc, writeStream)
    if (pdfa === 'PDF/A-3b') {
      const fileId = alloc()
      w.writeDeferredDict(fileId, [fileSpec.substring(2, fileSpec.length - 2).trim()])
      dict.push(`/FS ${fileId} 0 R`)
      associatedFileIds.push(fileId)
    } else {
      dict.push(`/FS ${fileSpec}`)
    }
    if (annotation.icon !== undefined) dict.push(`/Name /${annotation.icon}`)
  } else if (annotation.subtype === '3D') {
    if (annotation.format === 'U3D') decodeU3dScene(annotation.data)
    else decodePrcScene(annotation.data)
    const streamId = alloc()
    w.beginObj(streamId)
    writeStream(streamId, annotation.data, `/Type /3D /Subtype /${annotation.format} `)
    dict.push(`/3DD ${streamId} 0 R`)
    if (annotation.viewName !== undefined) {
      dict.push(`/3DV << /Type /3DView /XN ${pdfString(annotation.viewName)} >>`)
    }
    if (annotation.activateOnPageOpen === true) {
      dict.push('/3DA << /A /PO >>')
    }
  } else if (annotation.subtype === 'RichMedia') {
    // Rich media content (ISO 32000-2 12.5.6.24): the asset file specification
    // is written as its own object so the assets name tree and the instance
    // /Asset entry share one reference.
    const fileSpec = writeAnnotationFileSpec(
      { name: annotation.assetName, data: annotation.data, mimeType: annotation.mimeType },
      w, alloc, writeStream,
    )
    const assetId = alloc()
    w.writeDeferredDict(assetId, [fileSpec.substring(2, fileSpec.length - 2).trim()])
    const instanceId = richMediaInstanceIds.get(annotationIndex)?.[0]
    if (instanceId === undefined) throw new Error('PDF RichMedia annotation instance object was not allocated')
    w.writeDeferredDict(instanceId, ['/Type /RichMediaInstance', `/Subtype /${annotation.contentType}`, `/Asset ${assetId} 0 R`])
    const configuration = `<< /Type /RichMediaConfiguration /Subtype /${annotation.contentType} /Instances [${instanceId} 0 R] >>`
    dict.push(`/RichMediaContent << /Assets << /Names [${pdfString(annotation.assetName)} ${assetId} 0 R] >> /Configurations [${configuration}] >>`)
    const activation = annotation.activationCondition ?? 'XA'
    const deactivation = annotation.deactivationCondition ?? 'XD'
    dict.push(`/RichMediaSettings << /Activation << /Condition /${activation} >> /Deactivation << /Condition /${deactivation} >> >>`)
  } else if (annotation.subtype === 'Redact') {
    if (annotation.quadPoints !== undefined && annotation.quadPoints.length > 0) {
      dict.push(`/QuadPoints [${pdfAnnotationQuadPoints(annotation.quadPoints, page)}]`)
    }
    if (annotation.interiorColor !== undefined) dict.push(`/IC ${pdfAnnotationColor(annotation.interiorColor)}`)
    if (annotation.overlayText !== undefined) {
      if (annotation.defaultAppearance === undefined) throw new Error('PDF Redact annotation OverlayText requires defaultAppearance')
      dict.push(`/OverlayText ${pdfString(annotation.overlayText)}`)
      dict.push(`/DA ${pdfByteString(annotation.defaultAppearance)}`)
    } else if (annotation.defaultAppearance !== undefined) {
      throw new Error('PDF Redact annotation defaultAppearance requires overlayText')
    }
    if (annotation.repeatOverlay !== undefined) dict.push(`/Repeat ${pdfBool(annotation.repeatOverlay)}`)
    if (annotation.overlayQuadding !== undefined) dict.push(`/Q ${annotation.overlayQuadding}`)
    if (annotation.overlayAppearance !== undefined) {
      validateRedactionOverlayAppearance(annotation.overlayAppearance)
      dict.push(`/RO ${rawValuePdf(annotation.overlayAppearance)}`)
    }
  } else if (annotation.subtype === 'Projection') {
    // Projection annotations have no subtype-specific required entries.
  } else {
    throw new Error(`Unsupported PDF annotation subtype: ${(annotation as PdfAnnotation).subtype}`)
  }

  if (associatedFileIds.length > 0) {
    dict.push(`/AF [${associatedFileIds.map(function (id) { return `${id} 0 R` }).join(' ')}]`)
  }

  // Normal appearance stream (/AP /N): renders the annotation identically across
  // viewers and is required for PDF/A. Text appearances that name a fontId use
  // the same embedded subset and shaped glyph sequence as ordinary page text.
  const appearance = isPreservedAnnotation(annotation) ? null : preparedAppearance !== undefined
    ? buildPreparedAnnotationAppearance(preparedAppearance, fontObjects, fontGidRemap, defaultCmykColorSpaceId)
    : annotation.subtype === 'FreeText'
      ? buildFreeTextAppearance(annotation, page, w, alloc)
      : annotation.subtype === 'Stamp'
        ? buildStampAppearance(annotation, page, w, alloc)
        : buildAnnotationAppearance(annotation as PdfTypedAnnotation, page, pdfa)
  if (appearance !== null) {
    if (appearance.borderWidth !== null) {
      const style = pdfAnnotationBorderStyle(annotation)
      const dash = style === 'D'
        ? ` /D [${(annotation.dashArray ?? [3]).map(pn).join(' ')}]`
        : ''
      dict.push(`/BS << /Type /Border /W ${pn(appearance.borderWidth)} /S /${style}${dash} >>`)
      if (annotation.borderEffect !== undefined) {
        if (annotation.borderEffect.style !== 'cloudy') throw new Error('Unsupported PDF annotation border effect')
        if (!Number.isFinite(annotation.borderEffect.intensity) || annotation.borderEffect.intensity < 0 || annotation.borderEffect.intensity > 2) {
          throw new Error('PDF annotation cloudy border intensity must be between 0 and 2')
        }
        dict.push(`/BE << /S /C /I ${pn(annotation.borderEffect.intensity)} >>`)
      }
    }
    const apId = alloc()
    const b = appearance.bbox
    w.beginObj(apId)
    writeStream(
      apId, encodeAscii(appearance.content),
      `/Type /XObject /Subtype /Form /BBox [${pn(b[0])} ${pn(b[1])} ${pn(b[2])} ${pn(b[3])}] /Matrix [1 0 0 1 0 0] /Resources ${appearance.resources} `,
    )
    w.endObj()
    dict.push(`/AP << /N ${apId} 0 R >>`)
  }

  w.writeDeferredDict(annotId, dict)
}

function pdfAnnotationBorderStyle(annotation: PdfAnnotationBase): 'S' | 'D' | 'B' | 'I' | 'U' {
  const style = annotation.borderStyle ?? (annotation.dashArray !== undefined ? 'dashed' : 'solid')
  if (style === 'solid') return 'S'
  if (style === 'dashed') return 'D'
  if (style === 'beveled') return 'B'
  if (style === 'inset') return 'I'
  return 'U'
}

function appendPdfAnnotationCommon(
  dict: string[],
  annotation: PdfAnnotationBase,
  pageIds: number[],
  popupId: number | undefined,
  actionPdf: (action: PdfActionDef) => string,
): void {
  if (annotation.contents !== undefined) dict.push(`/Contents ${pdfString(annotation.contents)}`)
  if (annotation.name !== undefined) dict.push(`/NM ${pdfString(annotation.name)}`)
  if (annotation.modifiedDate !== undefined) dict.push(`/M ${pdfString(annotation.modifiedDate)}`)
  if (annotation.color !== undefined) dict.push(`/C ${pdfAnnotationColor(annotation.color)}`)
  if (annotation.opacity !== undefined) dict.push(`/CA ${pn(annotation.opacity)}`)
  if (annotation.flags !== undefined) dict.push(`/F ${annotation.flags}`)
  if (annotation.action !== undefined && annotation.destination !== undefined) {
    throw new Error('PDF annotation action and destination are mutually exclusive')
  }
  if (annotation.action !== undefined) dict.push(`/A ${actionPdf(annotation.action)}`)
  if (annotation.destination !== undefined) dict.push(`/Dest ${buildPdfDestination(annotation.destination, pageIds)}`)
  if (annotation.additionalActions !== undefined) {
    const actions: string[] = []
    for (const key of Object.keys(annotation.additionalActions)) {
      actions.push(`${encodePdfName(key)} ${actionPdf(annotation.additionalActions[key]!)}`)
    }
    dict.push(`/AA << ${actions.join(' ')} >>`)
  }
  if (popupId !== undefined) dict.push(`/Popup ${popupId} 0 R`)
}

function isPreservedAnnotation(annotation: PdfAnnotation): annotation is PdfPreservedAnnotation {
  return 'model' in annotation && annotation.model === 'preserved'
}

function pdfAnnotationAppearanceState(annotation: PdfAnnotation): string | null {
  if (isPreservedAnnotation(annotation)) return annotation.appearanceState ?? null
  if (annotation.subtype === 'PrinterMark') return annotation.appearanceState ?? null
  return null
}

function pdfIndirectObjectIds(value: string): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const pattern = /(?:^|\s)(\d+)\s+0\s+R(?:\s|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const id = Number(match[1])
    if (!seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

function countPreservedRichMediaInstances(annotation: PdfPreservedAnnotation): number {
  const content = annotation.entries.RichMediaContent
  if (content === undefined || content === null || typeof content !== 'object' || content.kind !== 'dictionary') {
    throw new Error('PDF preserved RichMedia annotation requires a RichMediaContent dictionary')
  }
  const configurations = content.entries.Configurations
  if (configurations === undefined || configurations === null || typeof configurations !== 'object' || configurations.kind !== 'array' || configurations.items.length === 0) {
    throw new Error('PDF preserved RichMediaContent requires a non-empty Configurations array')
  }
  let count = 0
  for (let i = 0; i < configurations.items.length; i++) {
    const configuration = configurations.items[i]
    if (configuration === undefined || configuration === null || typeof configuration !== 'object' || configuration.kind !== 'dictionary') {
      throw new Error(`PDF preserved RichMedia configuration ${i} must be a dictionary`)
    }
    const instances = configuration.entries.Instances
    if (instances === undefined || instances === null || typeof instances !== 'object' || instances.kind !== 'array' || instances.items.length === 0) {
      throw new Error(`PDF preserved RichMedia configuration ${i} requires a non-empty Instances array`)
    }
    count += instances.items.length
  }
  return count
}

function writePreservedRichMediaContent(
  value: PdfRawValueDef,
  instanceIds: number[],
  w: PdfWriter,
  rawValuePdf: (value: PdfRawValueDef) => string,
): string {
  if (value === null || typeof value !== 'object' || value.kind !== 'dictionary') {
    throw new Error('PDF preserved RichMediaContent must be a dictionary')
  }
  const configurations = value.entries.Configurations
  if (configurations === undefined || configurations === null || typeof configurations !== 'object' || configurations.kind !== 'array') {
    throw new Error('PDF preserved RichMediaContent requires Configurations')
  }
  const configurationPdf: string[] = []
  let instanceIndex = 0
  for (let i = 0; i < configurations.items.length; i++) {
    const configuration = configurations.items[i]
    if (configuration === undefined || configuration === null || typeof configuration !== 'object' || configuration.kind !== 'dictionary') {
      throw new Error(`PDF preserved RichMedia configuration ${i} must be a dictionary`)
    }
    const instances = configuration.entries.Instances
    if (instances === undefined || instances === null || typeof instances !== 'object' || instances.kind !== 'array') {
      throw new Error(`PDF preserved RichMedia configuration ${i} requires Instances`)
    }
    const refs: string[] = []
    for (let j = 0; j < instances.items.length; j++) {
      const instance = instances.items[j]
      const id = instanceIds[instanceIndex++]
      if (id === undefined || instance === undefined || instance === null || typeof instance !== 'object' || instance.kind !== 'dictionary') {
        throw new Error(`PDF preserved RichMedia instance ${j} must be a dictionary`)
      }
      const entries: string[] = []
      for (const key of Object.keys(instance.entries)) entries.push(`${encodePdfName(key)} ${rawValuePdf(instance.entries[key]!)}`)
      w.writeDeferredDict(id, entries)
      refs.push(`${id} 0 R`)
    }
    const entries: string[] = []
    for (const key of Object.keys(configuration.entries)) {
      entries.push(key === 'Instances'
        ? `/Instances [${refs.join(' ')}]`
        : `${encodePdfName(key)} ${rawValuePdf(configuration.entries[key]!)}`)
    }
    configurationPdf.push(`<< ${entries.join(' ')} >>`)
  }
  if (instanceIndex !== instanceIds.length) throw new Error('PDF preserved RichMedia instance allocation mismatch')
  const entries: string[] = []
  for (const key of Object.keys(value.entries)) {
    entries.push(key === 'Configurations'
      ? `/Configurations [${configurationPdf.join(' ')}]`
      : `${encodePdfName(key)} ${rawValuePdf(value.entries[key]!)}`)
  }
  return `<< ${entries.join(' ')} >>`
}

function writeAnnotationSound(
  annotation: PdfSoundAnnotation,
  w: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
): number {
  if (annotation.data.length === 0) throw new Error('PDF Sound annotation data must not be empty')
  if (!Number.isFinite(annotation.sampleRate) || annotation.sampleRate <= 0) throw new Error('PDF Sound annotation sampleRate must be positive')
  if (!Number.isInteger(annotation.channels) || annotation.channels <= 0) throw new Error('PDF Sound annotation channels must be a positive integer')
  if (!Number.isInteger(annotation.bitsPerSample) || annotation.bitsPerSample <= 0) throw new Error('PDF Sound annotation bitsPerSample must be a positive integer')
  const soundId = alloc()
  w.beginObj(soundId)
  writeStream(
    soundId,
    annotation.data,
    `/Type /Sound /R ${pn(annotation.sampleRate)} /C ${annotation.channels} /B ${annotation.bitsPerSample} /E /${annotation.encoding} `,
  )
  w.endObj()
  return soundId
}

function pdfMovieDictionary(
  movie: PdfMovie,
  w: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
): string {
  const entries = [`/F ${writeAnnotationFileSpec(movie.file, w, alloc, writeStream)}`]
  if (movie.aspect !== undefined) {
    if (!Number.isFinite(movie.aspect[0]) || !Number.isFinite(movie.aspect[1]) || movie.aspect[0] <= 0 || movie.aspect[1] <= 0) {
      throw new Error('PDF Movie annotation Aspect values must be positive')
    }
    entries.push(`/Aspect [${pn(movie.aspect[0])} ${pn(movie.aspect[1])}]`)
  }
  if (movie.rotate !== undefined) entries.push(`/Rotate ${movie.rotate}`)
  if (movie.poster !== undefined) entries.push(`/Poster ${pdfBool(movie.poster)}`)
  return `<< ${entries.join(' ')} >>`
}

function pdfScreenAppearance(appearance: PdfScreenAppearanceCharacteristics): string {
  const entries: string[] = []
  if (appearance.rotation !== undefined) entries.push(`/R ${appearance.rotation}`)
  if (appearance.borderColor !== undefined) entries.push(`/BC ${pdfAnnotationColor(appearance.borderColor)}`)
  if (appearance.backgroundColor !== undefined) entries.push(`/BG ${pdfAnnotationColor(appearance.backgroundColor)}`)
  if (appearance.normalCaption !== undefined) entries.push(`/CA ${pdfString(appearance.normalCaption)}`)
  if (appearance.rolloverCaption !== undefined) entries.push(`/RC ${pdfString(appearance.rolloverCaption)}`)
  if (appearance.alternateCaption !== undefined) entries.push(`/AC ${pdfString(appearance.alternateCaption)}`)
  return `<< ${entries.join(' ')} >>`
}

function pdfFixedPrint(fixedPrint: PdfFixedPrint): string {
  const entries = ['/Type /FixedPrint']
  if (fixedPrint.matrix !== undefined) {
    for (let i = 0; i < fixedPrint.matrix.length; i++) {
      if (!Number.isFinite(fixedPrint.matrix[i])) throw new Error('PDF fixed print Matrix values must be finite')
    }
    entries.push(`/Matrix [${fixedPrint.matrix.map(pn).join(' ')}]`)
  }
  if (fixedPrint.horizontalTranslation !== undefined) {
    if (!Number.isFinite(fixedPrint.horizontalTranslation)) throw new Error('PDF fixed print H value must be finite')
    entries.push(`/H ${pn(fixedPrint.horizontalTranslation)}`)
  }
  if (fixedPrint.verticalTranslation !== undefined) {
    if (!Number.isFinite(fixedPrint.verticalTranslation)) throw new Error('PDF fixed print V value must be finite')
    entries.push(`/V ${pn(fixedPrint.verticalTranslation)}`)
  }
  return `<< ${entries.join(' ')} >>`
}

/**
 * Writes a /Rendition action playing an embedded media file in a Screen
 * annotation (ISO 32000 12.6.4.14): action -> media rendition (13.2.3) ->
 * media clip data (13.2.4) -> embedded file specification. Returns the action
 * object number.
 */
function writeScreenRenditionAction(
  media: PdfScreenMedia,
  screenAnnotId: number,
  w: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
): number {
  if (media.name === '') throw new Error('PDF Screen media name must not be empty')
  if (media.fileName === '') throw new Error('PDF Screen media file name must not be empty')
  if (media.data.length === 0) throw new Error('PDF Screen media data must not be empty')
  validatePdfMediaMimeType(media.mimeType)
  validatePdfMediaDefinition(media)
  const fileSpec = writeAnnotationFileSpec(
    { name: media.fileName, data: media.data, mimeType: media.mimeType },
    w, alloc, writeStream,
  )
  const clipId = alloc()
  const clipEntries = [
    '/Type /MediaClip',
    '/S /MCD',
    `/N ${pdfString(media.name)}`,
    `/CT ${pdfString(media.mimeType)}`,
    `/D ${fileSpec}`,
    `/P << /Type /MediaPermissions /TF ${pdfString(media.temporaryFilePermission ?? 'TEMPACCESS')} >>`,
  ]
  if (media.alternateText !== undefined) {
    const alt: string[] = []
    for (const entry of media.alternateText) {
      if (entry.language !== '') validateBcp47LanguageTag(entry.language)
      alt.push(pdfString(entry.language), pdfString(entry.text))
    }
    clipEntries.push(`/Alt [${alt.join(' ')}]`)
  }
  if (media.baseUrl !== undefined) {
    clipEntries.push(`/${media.baseUrlMustBeHonored === true ? 'MH' : 'BE'} << /BU ${pdfString(media.baseUrl)} >>`)
  }
  w.writeDeferredDict(clipId, clipEntries)
  let selectedClipId = clipId
  for (const section of media.sections ?? []) {
    const sectionId = alloc()
    const sectionEntries = [
      '/Type /MediaClip',
      '/S /MCS',
      `/D ${selectedClipId} 0 R`,
    ]
    const mh = pdfMediaSectionSelector(section, true)
    const be = pdfMediaSectionSelector(section, false)
    if (mh !== '') sectionEntries.push(`/MH << ${mh} >>`)
    if (be !== '') sectionEntries.push(`/BE << ${be} >>`)
    w.writeDeferredDict(sectionId, sectionEntries)
    selectedClipId = sectionId
  }
  const renditionId = alloc()
  const renditionEntries = [
    '/Type /Rendition',
    '/S /MR',
    `/N ${pdfString(media.name)}`,
    `/C ${selectedClipId} 0 R`,
  ]
  if (media.playParameters !== undefined) renditionEntries.push(`/P ${pdfMediaPlayParameters(media.playParameters)}`)
  if (media.screenParameters !== undefined) renditionEntries.push(`/SP ${pdfMediaScreenParameters(media.screenParameters)}`)
  w.writeDeferredDict(renditionId, renditionEntries)
  const actionId = alloc()
  w.writeDeferredDict(actionId, [
    '/Type /Action',
    '/S /Rendition',
    '/OP 0',
    `/R ${renditionId} 0 R`,
    `/AN ${screenAnnotId} 0 R`,
  ])
  return actionId
}

function pdfMediaOffset(offset: PdfMediaOffset): string {
  if (offset.kind === 'time') return `<< /Type /MediaOffset /S /T /T << /Type /Timespan /S /S /V ${pn(offset.seconds)} >> >>`
  if (offset.kind === 'frame') return `<< /Type /MediaOffset /S /F /F ${offset.frame} >>`
  return `<< /Type /MediaOffset /S /M /M ${pdfString(offset.marker)} >>`
}

function pdfMediaSectionSelector(section: PdfMediaClipSection, mustHonor: boolean): string {
  const entries: string[] = []
  if (section.begin !== undefined && (section.mustHonorBegin === true) === mustHonor) entries.push(`/B ${pdfMediaOffset(section.begin)}`)
  if (section.end !== undefined && (section.mustHonorEnd === true) === mustHonor) entries.push(`/E ${pdfMediaOffset(section.end)}`)
  return entries.join(' ')
}

function pdfMediaDuration(duration: PdfMediaDuration): string {
  if (duration.kind === 'intrinsic') return '<< /Type /MediaDuration /S /I >>'
  if (duration.kind === 'infinite') return '<< /Type /MediaDuration /S /F >>'
  return `<< /Type /MediaDuration /S /T /T << /Type /Timespan /S /S /V ${pn(duration.seconds)} >> >>`
}

function pdfMediaPlayParameters(parameters: PdfMediaPlayParameters): string {
  const entries: string[] = []
  if (parameters.volumePercent !== undefined) entries.push(`/V ${pn(parameters.volumePercent)}`)
  if (parameters.showController !== undefined) entries.push(`/C ${pdfBool(parameters.showController)}`)
  if (parameters.fit !== undefined) entries.push(`/F ${parameters.fit}`)
  if (parameters.duration !== undefined) entries.push(`/D ${pdfMediaDuration(parameters.duration)}`)
  if (parameters.autoPlay !== undefined) entries.push(`/A ${pdfBool(parameters.autoPlay)}`)
  if (parameters.repeatCount !== undefined) entries.push(`/RC ${pn(parameters.repeatCount)}`)
  return `<< /Type /MediaPlayParams /${parameters.mustHonor === true ? 'MH' : 'BE'} << ${entries.join(' ')} >> >>`
}

function pdfMediaFloatingWindow(window: PdfMediaFloatingWindow): string {
  const entries = [`/Type /FWParams`, `/D [${window.width} ${window.height}]`]
  if (window.relativeTo !== undefined) entries.push(`/RT ${window.relativeTo}`)
  if (window.position !== undefined) entries.push(`/P ${window.position}`)
  if (window.offscreen !== undefined) entries.push(`/O ${window.offscreen}`)
  if (window.titleBar !== undefined) entries.push(`/T ${pdfBool(window.titleBar)}`)
  if (window.closeControl !== undefined) entries.push(`/UC ${pdfBool(window.closeControl)}`)
  if (window.resize !== undefined) entries.push(`/R ${window.resize}`)
  if (window.title !== undefined) entries.push(`/TT [${pdfString('')} ${pdfString(window.title)}]`)
  return `<< ${entries.join(' ')} >>`
}

function pdfMediaScreenParameters(parameters: PdfMediaScreenParameters): string {
  const entries: string[] = []
  if (parameters.window !== undefined) entries.push(`/W ${parameters.window}`)
  if (parameters.backgroundRgb !== undefined) entries.push(`/B [${parameters.backgroundRgb.map(pn).join(' ')}]`)
  if (parameters.opacity !== undefined) entries.push(`/O ${pn(parameters.opacity)}`)
  if (parameters.monitor !== undefined) entries.push(`/M ${parameters.monitor}`)
  if (parameters.floatingWindow !== undefined) entries.push(`/F ${pdfMediaFloatingWindow(parameters.floatingWindow)}`)
  return `<< /Type /MediaScreenParams /${parameters.mustHonor === true ? 'MH' : 'BE'} << ${entries.join(' ')} >> >>`
}

function writeAnnotationFileSpec(
  file: PdfEmbeddedFile,
  w: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
): string {
  if (file.name === '') throw new Error('PDF file attachment annotation file name must not be empty')
  const streamId = alloc()
  const params = buildPdfEmbeddedFileParameters(file, w, alloc, writeStream)
  const subtype = file.mimeType === undefined ? '' : `/Subtype ${encodePdfName(file.mimeType)} `
  w.beginObj(streamId)
  writeStream(streamId, file.data, `/Type /EmbeddedFile ${subtype}/Params << ${params} >> `)
  w.endObj()
  const entries = [
    '/Type /Filespec',
    `/F ${pdfFileSpecificationString(file.name)}`,
    `/UF ${pdfString(file.name)}`,
    `/EF << /F ${streamId} 0 R /UF ${streamId} 0 R >>`,
  ]
  if (file.description !== undefined) entries.push(`/Desc ${pdfString(file.description)}`)
  if (file.relationship !== undefined) entries.push(`/AFRelationship ${pdfAfRelationshipPdf(file.relationship)}`)
  return `<< ${entries.join(' ')} >>`
}

const PDF_AF_RELATIONSHIPS = new Set<PdfAFRelationship>([
  'Source', 'Data', 'Alternative', 'Supplement', 'EncryptedPayload', 'FormData', 'Schema', 'Unspecified',
])

function pdfAfRelationshipPdf(value: PdfAFRelationship): string {
  if (!PDF_AF_RELATIONSHIPS.has(value)) throw new Error(`Unsupported PDF AFRelationship: ${value}`)
  return encodePdfName(value)
}

function buildPdfEmbeddedFileParameters(
  file: PdfEmbeddedFile,
  w: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
): string {
  const entries = [`/Size ${file.data.length}`]
  if (file.creationDate !== undefined) entries.push(`/CreationDate ${pdfString(file.creationDate)}`)
  if (file.modificationDate !== undefined) entries.push(`/ModDate ${pdfString(file.modificationDate)}`)
  if (file.checksum !== undefined) {
    if (file.checksum.length !== 16) throw new Error(`PDF embedded file ${file.name} checksum must contain 16 bytes`)
    if (compareBytes(file.checksum, md5(file.data)) !== 0) {
      throw new Error(`PDF embedded file ${file.name} checksum does not match its data`)
    }
    entries.push(`/CheckSum <${bytesToHex(file.checksum)}>`)
  }
  if (file.mac !== undefined) {
    const macEntries: string[] = []
    if (file.mac.subtype !== undefined) macEntries.push(`/Subtype ${pdfByteString(file.mac.subtype)}`)
    if (file.mac.creator !== undefined) macEntries.push(`/Creator ${pdfByteString(file.mac.creator)}`)
    if (file.mac.resourceFork !== undefined) {
      const resourceForkId = alloc()
      w.beginObj(resourceForkId)
      writeStream(resourceForkId, file.mac.resourceFork)
      w.endObj()
      macEntries.push(`/ResFork ${resourceForkId} 0 R`)
    }
    entries.push(`/Mac << ${macEntries.join(' ')} >>`)
  }
  return entries.join(' ')
}

function pdfAnnotationRect(annotation: PdfAnnotationBase, page: PageData): string {
  const y1 = page.height - annotation.y
  const y2 = page.height - (annotation.y + annotation.height)
  return `[${pn(annotation.x)} ${pn(y2)} ${pn(annotation.x + annotation.width)} ${pn(y1)}]`
}

function pdfAnnotationPoint(point: PdfAnnotationPoint, page: PageData): string {
  return `${pn(point[0])} ${pn(page.height - point[1])}`
}

function pdfAnnotationQuadPoints(quadPoints: PdfAnnotationQuadPoints[], page: PageData): string {
  const parts: string[] = []
  for (let qi = 0; qi < quadPoints.length; qi++) {
    const q = quadPoints[qi]!
    for (let i = 0; i < q.length; i += 2) {
      parts.push(pn(q[i]!))
      parts.push(pn(page.height - q[i + 1]!))
    }
  }
  return parts.join(' ')
}

function pdfAnnotationVertices(vertices: PdfAnnotationPoint[], page: PageData): string {
  const parts: string[] = []
  for (let i = 0; i < vertices.length; i++) parts.push(pdfAnnotationPoint(vertices[i]!, page))
  return parts.join(' ')
}

function pdfAnnotationInkList(paths: PdfAnnotationPoint[][], page: PageData): string {
  const pathEntries: string[] = []
  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi]!
    if (path.length === 0) throw new Error('PDF Ink annotation path must not be empty')
    const coords: string[] = []
    for (let i = 0; i < path.length; i++) coords.push(pdfAnnotationPoint(path[i]!, page))
    pathEntries.push(`[${coords.join(' ')}]`)
  }
  return pathEntries.join(' ')
}

function pdfAnnotationColor(color: string): string {
  const rgb = parseColor(color)
  return `[${pn(rgb[0])} ${pn(rgb[1])} ${pn(rgb[2])}]`
}

interface AnnotationAppearance {
  bbox: [number, number, number, number]
  content: string
  resources: string
  /** Border width recorded in /BS, or null when the appearance has no border. */
  borderWidth: number | null
}

interface PreparedAnnotationTextLine {
  text: string
  run: RenderGlyphRun
  x: number
  baseline: number
  adjustments?: number[]
  rises?: number[]
}

interface PreparedAnnotationAppearance {
  kind: 'freeText' | 'stamp'
  bbox: [number, number, number, number]
  fontId: string
  fontResource: string
  fontSize: number
  colorOp: string
  lines: PreparedAnnotationTextLine[]
  stampBorder?: { color: string, borderWidth: number, x: number, y: number, width: number, height: number }
}

function annotationPdfBounds(annotation: PdfAnnotationBase, page: PageData): [number, number, number, number] {
  return [
    annotation.x,
    page.height - (annotation.y + annotation.height),
    annotation.x + annotation.width,
    page.height - annotation.y,
  ]
}

function prepareFreeTextAppearance(
  annotation: PdfFreeTextAnnotation,
  page: PageData,
  font: Font,
  fontResource: string,
): PreparedAnnotationAppearance {
  const bbox = annotationPdfBounds(annotation, page)
  const fontSize = parseDefaultAppearanceFontSize(annotation.defaultAppearance)
  const colorOp = parseDefaultAppearanceColor(annotation.defaultAppearance)
  const padding = 2
  const maxWidth = Math.max(0, annotation.width - padding * 2)
  const maxHeight = Math.max(0, annotation.height - padding * 2)
  const measurer = new TextMeasurer(font)
  const result = maxWidth === 0 || maxHeight === 0
    ? { lines: [], totalHeight: 0, truncated: annotation.contents !== undefined && annotation.contents.length > 0 }
    : layoutText(annotation.contents ?? '', measurer, fontSize, {
        maxWidth,
        maxHeight,
        elementHeight: maxHeight,
        hAlign: 'left',
        vAlign: 'top',
        direction: annotation.direction ?? 'auto',
        textTruncate: 'truncate',
        unicodeNormalization: 'none',
      })
  const ascent = measurer.getAscent(fontSize)
  const lines: PreparedAnnotationTextLine[] = []
  for (let lineIndex = 0; lineIndex < result.lines.length; lineIndex++) {
    const line = result.lines[lineIndex]!
    const alignOffset = annotation.quadding === 1
      ? (maxWidth - line.width) / 2
      : annotation.quadding === 2
        ? maxWidth - line.width
        : 0
    const baseline = bbox[3] - padding - ascent - line.y
    if (line.run !== undefined) {
      lines.push(prepareAnnotationTextLine(font, line.text, line.run, bbox[0] + padding + alignOffset, baseline, fontSize))
    } else if (line.segments !== undefined) {
      for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex++) {
        const segment = line.segments[segmentIndex]!
        if (segment.run !== undefined) {
          lines.push(prepareAnnotationTextLine(
            font,
            segment.text,
            segment.run,
            bbox[0] + padding + alignOffset + segment.x,
            baseline,
            fontSize,
          ))
        }
      }
    }
  }
  return {
    kind: 'freeText', bbox, fontId: annotation.fontId!, fontResource, fontSize, colorOp, lines,
  }
}

function prepareStampAppearance(
  annotation: PdfStampAnnotation,
  page: PageData,
  font: Font,
  fontResource: string,
): PreparedAnnotationAppearance {
  const bbox = annotationPdfBounds(annotation, page)
  const width = bbox[2] - bbox[0]
  const height = bbox[3] - bbox[1]
  const color = annotation.color ?? '#cc0000'
  const label = stampLabel(annotation.icon ?? 'Draft')
  const measurer = new TextMeasurer(font)
  const padding = Math.min(width, height) * 0.18
  const availableWidth = width - padding * 2
  const availableHeight = height - padding * 2
  let fontSize = 0
  if (availableWidth > 0 && availableHeight > 0 && label.length > 0) {
    const unitWidth = measurer.measure(label, 1).width
    const unitHeight = measurer.getAscent(1) - measurer.getDescent(1)
    if (unitWidth > 0 && unitHeight > 0) fontSize = Math.min(availableWidth / unitWidth, availableHeight / unitHeight, 96)
  }
  const lines: PreparedAnnotationTextLine[] = []
  if (fontSize > 0) {
    const run = shapeGlyphRun(font, label, fontSize, 0, 0, false, 1, 'ltr')
    let textWidth = 0
    for (let index = 0; index < run.advances.length; index++) textWidth += run.advances[index]!
    const baseline = (bbox[1] + bbox[3]) / 2 - (measurer.getAscent(fontSize) + measurer.getDescent(fontSize)) / 2
    lines.push(prepareAnnotationTextLine(font, label, run, (bbox[0] + bbox[2] - textWidth) / 2, baseline, fontSize))
  }
  const borderWidth = Math.max(1, fontSize > 0 ? fontSize * 0.08 : Math.min(width, height) * 0.04)
  return {
    kind: 'stamp', bbox, fontId: annotation.fontId!, fontResource, fontSize, colorOp: fillColorOp(color), lines,
    stampBorder: {
      color,
      borderWidth,
      x: bbox[0] + padding * 0.4,
      y: bbox[1] + padding * 0.4,
      width: width - padding * 0.8,
      height: height - padding * 0.8,
    },
  }
}

function prepareAnnotationTextLine(
  font: Font,
  text: string,
  run: RenderGlyphRun,
  x: number,
  baseline: number,
  fontSize: number,
): PreparedAnnotationTextLine {
  const glyphIds = Array.from(run.glyphIds)
  const positioning = computeRunTextAdjustments(font, run, glyphIds, fontSize, 1)
  return { text, run, x, baseline, adjustments: positioning.adjustments, rises: positioning.rises }
}

function requirePdfTextRepresentableRun(run: RenderGlyphRun, context: string): void {
  if (run.xScales !== undefined || run.yScales !== undefined || run.outlineOverrides !== undefined) {
    throw new Error(`${context} requires outline transformations that cannot be represented by a PDF text operator`)
  }
  for (let index = 0; index < run.glyphIds.length; index++) {
    if (run.glyphIds[index] === 0) throw new Error(`${context} contains a character missing from the selected font`)
  }
}

/** PDF-space stroke color operator (`r g b RG`). */
function strokeColorOp(color: string): string {
  const rgb = parseColor(color)
  return `${pn(rgb[0])} ${pn(rgb[1])} ${pn(rgb[2])} RG`
}

/** PDF-space fill color operator (`r g b rg`). */
function fillColorOp(color: string): string {
  const rgb = parseColor(color)
  return `${pn(rgb[0])} ${pn(rgb[1])} ${pn(rgb[2])} rg`
}

/**
 * Builds a normal appearance stream for the geometric and text-markup
 * annotation subtypes (drawn in PDF page space, so BBox = the annotation Rect
 * and Matrix is identity). Returns null for subtypes rendered from icons/text.
 */
function buildAnnotationAppearance(
  annotation: PdfTypedAnnotation,
  page: PageData,
  pdfa: PdfAConformance | undefined,
): AnnotationAppearance | null {
  const H = page.height
  const rx0 = annotation.x
  const ry0 = H - (annotation.y + annotation.height)
  const rx1 = annotation.x + annotation.width
  const ry1 = H - annotation.y
  const bbox: [number, number, number, number] = [rx0, ry0, rx1, ry1]
  const bw = annotation.borderWidth ?? 1
  const stroke = annotation.color
  const py = (p: PdfAnnotationPoint): number => H - p[1]

  if (annotation.subtype === '3D' && annotation.poster === 'scene') {
    const scene = annotation.format === 'U3D' ? decodeU3dScene(annotation.data) : decodePrcScene(annotation.data)
    const poster = renderPdf3DPoster(scene, annotation.width, annotation.height)
    return {
      bbox,
      content: `q\n1 0 0 1 ${pn(rx0)} ${pn(ry0)} cm\n${poster.content}\nQ`,
      resources: poster.resources ?? '<< >>',
      borderWidth: null,
    }
  }

  if (annotation.subtype === 'Square' || annotation.subtype === 'Circle') {
    const strokeColor = stroke ?? '#000000'
    const fill = annotation.interiorColor
    const x = rx0 + bw / 2
    const y = ry0 + bw / 2
    const wdt = (rx1 - rx0) - bw
    const hgt = (ry1 - ry0) - bw
    if (wdt <= 0 || hgt <= 0) return null
    const ops: string[] = [`${pn(bw)} w`, strokeColorOp(strokeColor)]
    appendAnnotationDash(ops, annotation)
    if (fill !== undefined) ops.push(fillColorOp(fill))
    const hasSpecialBorder = annotation.borderEffect !== undefined
      || annotation.borderStyle === 'underline'
      || annotation.borderStyle === 'beveled'
      || annotation.borderStyle === 'inset'
    if (fill !== undefined && hasSpecialBorder) {
      if (annotation.subtype === 'Square') ops.push(`${pn(x)} ${pn(y)} ${pn(wdt)} ${pn(hgt)} re f`)
      else {
        appendEllipsePath(ops, x + wdt / 2, y + hgt / 2, wdt / 2, hgt / 2)
        ops.push('f')
      }
    }
    if (annotation.borderEffect !== undefined) {
      appendCloudyBorder(ops, annotation.subtype, x, y, wdt, hgt, bw, annotation.borderEffect.intensity)
    } else if (annotation.borderStyle === 'underline' && annotation.subtype === 'Square') {
      ops.push(`${pn(x)} ${pn(y)} m ${pn(x + wdt)} ${pn(y)} l S`)
    } else if (annotation.borderStyle === 'beveled' || annotation.borderStyle === 'inset') {
      appendBeveledBorder(ops, annotation.subtype, x, y, wdt, hgt, bw, annotation.borderStyle === 'inset')
    } else if (annotation.subtype === 'Square') {
      ops.push(`${pn(x)} ${pn(y)} ${pn(wdt)} ${pn(hgt)} re`)
      ops.push(fill !== undefined ? 'B' : 'S')
    } else {
      appendEllipsePath(ops, x + wdt / 2, y + hgt / 2, wdt / 2, hgt / 2)
      ops.push(fill !== undefined ? 'B' : 'S')
    }
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: bw }
  }

  if (annotation.subtype === 'Line') {
    const strokeColor = stroke ?? '#000000'
    const x1 = annotation.start[0], y1 = py(annotation.start)
    const x2 = annotation.end[0], y2 = py(annotation.end)
    const ops = [`${pn(bw)} w`, strokeColorOp(strokeColor)]
    appendAnnotationDash(ops, annotation)
    ops.push(`${pn(x1)} ${pn(y1)} m ${pn(x2)} ${pn(y2)} l S`)
    if (annotation.lineEndings !== undefined) {
      const dx = x2 - x1, dy = y2 - y1
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        appendLineEnding(ops, x1, y1, -dx / len, -dy / len, annotation.lineEndings[0], bw, strokeColor)
        appendLineEnding(ops, x2, y2, dx / len, dy / len, annotation.lineEndings[1], bw, strokeColor)
      }
    }
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: bw }
  }

  if (annotation.subtype === 'Polygon' || annotation.subtype === 'PolyLine') {
    if (annotation.vertices.length < 2) return null
    const strokeColor = stroke ?? '#000000'
    const fill = annotation.interiorColor
    const ops: string[] = [`${pn(bw)} w`, strokeColorOp(strokeColor)]
    appendAnnotationDash(ops, annotation)
    if (fill !== undefined && annotation.subtype === 'Polygon') ops.push(fillColorOp(fill))
    const v0 = annotation.vertices[0]!
    ops.push(`${pn(v0[0])} ${pn(py(v0))} m`)
    for (let i = 1; i < annotation.vertices.length; i++) {
      const v = annotation.vertices[i]!
      ops.push(`${pn(v[0])} ${pn(py(v))} l`)
    }
    if (annotation.subtype === 'Polygon') {
      ops.push('h')
      ops.push(fill !== undefined ? 'B' : 'S')
    } else {
      ops.push('S')
      if (annotation.lineEndings !== undefined && annotation.vertices.length >= 2) {
        const v = annotation.vertices
        const first = v[0]!, second = v[1]!
        const last = v[v.length - 1]!, prev = v[v.length - 2]!
        const d0x = first[0] - second[0], d0y = py(first) - py(second)
        const l0 = Math.sqrt(d0x * d0x + d0y * d0y)
        if (l0 > 0) appendLineEnding(ops, first[0], py(first), d0x / l0, d0y / l0, annotation.lineEndings[0], bw, strokeColor)
        const d1x = last[0] - prev[0], d1y = py(last) - py(prev)
        const l1 = Math.sqrt(d1x * d1x + d1y * d1y)
        if (l1 > 0) appendLineEnding(ops, last[0], py(last), d1x / l1, d1y / l1, annotation.lineEndings[1], bw, strokeColor)
      }
    }
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: bw }
  }

  if (annotation.subtype === 'Text') {
    const fill = stroke ?? '#ffff99'
    const wdt = rx1 - rx0
    const hgt = ry1 - ry0
    if (wdt <= 0 || hgt <= 0) return null
    const fold = Math.min(wdt, hgt) * 0.3
    const lineW = Math.max(0.5, Math.min(wdt, hgt) * 0.04)
    // A sticky-note outline with a folded top-right corner.
    const ops: string[] = [fillColorOp(fill), strokeColorOp('#aaaa00'), `${pn(lineW)} w`]
    ops.push(`${pn(rx0)} ${pn(ry0)} m`)
    ops.push(`${pn(rx1)} ${pn(ry0)} l`)
    ops.push(`${pn(rx1)} ${pn(ry1 - fold)} l`)
    ops.push(`${pn(rx1 - fold)} ${pn(ry1)} l`)
    ops.push(`${pn(rx0)} ${pn(ry1)} l`)
    ops.push('h B')
    ops.push(fillColorOp('#dddd77'))
    ops.push(`${pn(rx1 - fold)} ${pn(ry1)} m ${pn(rx1 - fold)} ${pn(ry1 - fold)} l ${pn(rx1)} ${pn(ry1 - fold)} l h f`)
    ops.push(strokeColorOp('#888800'))
    const lx0 = rx0 + wdt * 0.15
    const lx1 = rx1 - wdt * 0.15
    for (let k = 0; k < 3; k++) {
      const ly = ry1 - hgt * 0.32 - k * hgt * 0.2
      if (ly > ry0 + hgt * 0.1) ops.push(`${pn(lx0)} ${pn(ly)} m ${pn(lx1)} ${pn(ly)} l S`)
    }
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: null }
  }

  if (annotation.subtype === 'Caret') {
    const color = stroke ?? '#000000'
    const rd = annotation.rectDifferences ?? [0, 0, 0, 0]
    const cx0 = rx0 + rd[0]
    const cy0 = ry0 + rd[3]
    const cx1 = rx1 - rd[2]
    const cy1 = ry1 - rd[1]
    if (cx1 <= cx0 || cy1 <= cy0) return null
    // A filled upward caret spanning the (inset) rectangle.
    const midx = (cx0 + cx1) / 2
    const ops = [
      fillColorOp(color),
      `${pn(cx0)} ${pn(cy0)} m`,
      `${pn(midx)} ${pn(cy1)} l`,
      `${pn(cx1)} ${pn(cy0)} l`,
      'h f',
    ]
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: null }
  }

  if (annotation.subtype === 'Ink') {
    if (annotation.paths.length === 0) return null
    const strokeColor = stroke ?? '#000000'
    const ops: string[] = [`${pn(bw)} w`, '1 J', '1 j', strokeColorOp(strokeColor)]
    appendAnnotationDash(ops, annotation)
    for (let pi = 0; pi < annotation.paths.length; pi++) {
      const path = annotation.paths[pi]!
      if (path.length === 0) continue
      ops.push(`${pn(path[0]![0])} ${pn(py(path[0]!))} m`)
      for (let i = 1; i < path.length; i++) ops.push(`${pn(path[i]![0])} ${pn(py(path[i]!))} l`)
      ops.push('S')
    }
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: bw }
  }

  if (annotation.subtype === 'Highlight' || annotation.subtype === 'Underline' || annotation.subtype === 'StrikeOut' || annotation.subtype === 'Squiggly') {
    if (annotation.quadPoints.length === 0) return null
    const color = stroke ?? '#ffff00'
    const ops: string[] = []
    let resources = '<< >>'
    if (annotation.subtype === 'Highlight' && pdfa !== 'PDF/A-1b') {
      // Multiply blend so the highlighted content shows through the color.
      resources = '<< /ExtGState << /GSmul << /Type /ExtGState /BM /Multiply >> >> >>'
      ops.push('/GSmul gs', fillColorOp(color))
      for (let qi = 0; qi < annotation.quadPoints.length; qi++) {
        const q = annotation.quadPoints[qi]!
        // QuadPoints order: (1)UL (2)UR (3)LL (4)LR — fill UL,UR,LR,LL.
        ops.push(`${pn(q[0])} ${pn(H - q[1])} m`)
        ops.push(`${pn(q[2])} ${pn(H - q[3])} l`)
        ops.push(`${pn(q[6])} ${pn(H - q[7])} l`)
        ops.push(`${pn(q[4])} ${pn(H - q[5])} l`)
        ops.push('h')
      }
      ops.push('f')
    } else if (annotation.subtype === 'Highlight') {
      ops.push(`${pn(Math.max(0.5, bw))} w`, strokeColorOp(color))
      for (let qi = 0; qi < annotation.quadPoints.length; qi++) {
        const q = annotation.quadPoints[qi]!
        ops.push(`${pn(q[0])} ${pn(H - q[1])} m`)
        ops.push(`${pn(q[2])} ${pn(H - q[3])} l`)
        ops.push(`${pn(q[6])} ${pn(H - q[7])} l`)
        ops.push(`${pn(q[4])} ${pn(H - q[5])} l h S`)
      }
    } else {
      const lineWidth = bw
      ops.push(`${pn(lineWidth)} w`, strokeColorOp(color))
      for (let qi = 0; qi < annotation.quadPoints.length; qi++) {
        const q = annotation.quadPoints[qi]!
        const ulx = q[0], uly = H - q[1], urx = q[2], ury = H - q[3]
        const llx = q[4], lly = H - q[5], lrx = q[6], lry = H - q[7]
        if (annotation.subtype === 'StrikeOut') {
          // Through the vertical middle of the quad.
          const mlx = (ulx + llx) / 2, mly = (uly + lly) / 2
          const mrx = (urx + lrx) / 2, mry = (ury + lry) / 2
          ops.push(`${pn(mlx)} ${pn(mly)} m ${pn(mrx)} ${pn(mry)} l S`)
        } else if (annotation.subtype === 'Underline') {
          ops.push(`${pn(llx)} ${pn(lly)} m ${pn(lrx)} ${pn(lry)} l S`)
        } else {
          // Squiggly: a zigzag along the baseline.
          appendSquigglyPath(ops, llx, lly, lrx, lry)
        }
      }
    }
    return { bbox, content: ops.join('\n'), resources, borderWidth: annotation.subtype === 'Highlight' ? null : bw }
  }

  if (annotation.subtype === 'FileAttachment') {
    const color = annotation.color ?? '#2f5f99'
    const width = rx1 - rx0
    const height = ry1 - ry0
    if (width <= 0 || height <= 0) return { bbox, content: '', resources: '<< >>', borderWidth: null }
    const inset = Math.min(width, height) * 0.12
    const fold = Math.min(width, height) * 0.28
    const left = rx0 + inset
    const bottom = ry0 + inset
    const right = rx1 - inset
    const top = ry1 - inset
    const lineWidth = Math.max(0.7, Math.min(width, height) * 0.045)
    const ops = [strokeColorOp(color), fillColorOp('#ffffff'), `${pn(lineWidth)} w`]
    ops.push(`${pn(left)} ${pn(bottom)} m ${pn(right)} ${pn(bottom)} l ${pn(right)} ${pn(top - fold)} l`)
    ops.push(`${pn(right - fold)} ${pn(top)} l ${pn(left)} ${pn(top)} l h B`)
    ops.push(`${pn(right - fold)} ${pn(top)} m ${pn(right - fold)} ${pn(top - fold)} l ${pn(right)} ${pn(top - fold)} l S`)
    const clipX = left + (right - left) * 0.32
    const clipBottom = bottom + (top - bottom) * 0.2
    const clipTop = bottom + (top - bottom) * 0.7
    const clipWidth = (right - left) * 0.32
    ops.push(`${pn(clipX)} ${pn(clipBottom)} m`)
    ops.push(`${pn(clipX - clipWidth * 0.35)} ${pn(clipBottom + clipWidth * 0.3)} ${pn(clipX - clipWidth * 0.35)} ${pn(clipTop)} ${pn(clipX)} ${pn(clipTop)} c`)
    ops.push(`${pn(clipX + clipWidth)} ${pn(clipTop)} ${pn(clipX + clipWidth)} ${pn(clipBottom + clipWidth * 0.55)} ${pn(clipX + clipWidth * 0.35)} ${pn(clipBottom + clipWidth * 0.55)} c S`)
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: null }
  }

  if (annotation.subtype === 'Watermark') {
    const color = annotation.color ?? '#808080'
    const width = rx1 - rx0
    const height = ry1 - ry0
    if (width <= 0 || height <= 0) return { bbox, content: '', resources: '<< >>', borderWidth: null }
    const inset = Math.min(width, height) * 0.08
    const lineWidth = Math.max(0.5, Math.min(width, height) * 0.025)
    const ops = [strokeColorOp(color), `${pn(lineWidth)} w`]
    ops.push(`${pn(rx0 + inset)} ${pn(ry0 + inset)} ${pn(width - inset * 2)} ${pn(height - inset * 2)} re S`)
    ops.push(`${pn(rx0 + inset)} ${pn(ry0 + inset)} m ${pn(rx1 - inset)} ${pn(ry1 - inset)} l S`)
    ops.push(`${pn(rx0 + inset)} ${pn(ry1 - inset)} m ${pn(rx1 - inset)} ${pn(ry0 + inset)} l S`)
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: null }
  }

  if (annotation.subtype === 'Redact') {
    const fill = annotation.interiorColor
    const strokeColor = annotation.color ?? '#cc0000'
    const ops: string[] = [`${pn(Math.max(0.5, bw))} w`, strokeColorOp(strokeColor)]
    if (fill !== undefined) ops.push(fillColorOp(fill))
    const regions = annotation.quadPoints ?? []
    if (regions.length === 0) {
      ops.push(`${pn(rx0)} ${pn(ry0)} ${pn(rx1 - rx0)} ${pn(ry1 - ry0)} re ${fill === undefined ? 'S' : 'B'}`)
      if (fill === undefined) {
        ops.push(`${pn(rx0)} ${pn(ry0)} m ${pn(rx1)} ${pn(ry1)} l S`)
        ops.push(`${pn(rx0)} ${pn(ry1)} m ${pn(rx1)} ${pn(ry0)} l S`)
      }
    } else {
      for (let qi = 0; qi < regions.length; qi++) {
        const q = regions[qi]!
        ops.push(`${pn(q[0])} ${pn(H - q[1])} m`)
        ops.push(`${pn(q[2])} ${pn(H - q[3])} l`)
        ops.push(`${pn(q[6])} ${pn(H - q[7])} l`)
        ops.push(`${pn(q[4])} ${pn(H - q[5])} l h ${fill === undefined ? 'S' : 'B'}`)
      }
    }
    return { bbox, content: ops.join('\n'), resources: '<< >>', borderWidth: null }
  }

  return null
}

function appendAnnotationDash(ops: string[], annotation: PdfAnnotationBase): void {
  if (pdfAnnotationBorderStyle(annotation) !== 'D') return
  ops.push(`[${(annotation.dashArray ?? [3]).map(pn).join(' ')}] 0 d`)
}

function appendBeveledBorder(
  ops: string[],
  subtype: 'Square' | 'Circle',
  x: number,
  y: number,
  width: number,
  height: number,
  borderWidth: number,
  inset: boolean,
): void {
  const light = inset ? '#666666' : '#ffffff'
  const dark = inset ? '#ffffff' : '#666666'
  if (subtype === 'Square') {
    ops.push(`${pn(borderWidth)} w`, strokeColorOp(light), `${pn(x)} ${pn(y)} m ${pn(x)} ${pn(y + height)} l ${pn(x + width)} ${pn(y + height)} l S`)
    ops.push(strokeColorOp(dark), `${pn(x + width)} ${pn(y + height)} m ${pn(x + width)} ${pn(y)} l ${pn(x)} ${pn(y)} l S`)
    return
  }
  ops.push(`${pn(borderWidth * 2)} w`, strokeColorOp(dark))
  appendEllipsePath(ops, x + width / 2, y + height / 2, width / 2, height / 2)
  ops.push('S')
  ops.push(`${pn(borderWidth)} w`, strokeColorOp(light))
  appendEllipsePath(ops, x + width / 2, y + height / 2, Math.max(0, width / 2 - borderWidth), Math.max(0, height / 2 - borderWidth))
  ops.push('S')
}

function appendCloudyBorder(
  ops: string[],
  subtype: 'Square' | 'Circle',
  x: number,
  y: number,
  width: number,
  height: number,
  borderWidth: number,
  intensity: number,
): void {
  const radius = Math.max(borderWidth * 1.5, 2 + intensity * 2)
  const circumference = subtype === 'Square'
    ? 2 * (width + height)
    : Math.PI * (width + height)
  const count = Math.max(8, Math.ceil(circumference / (radius * 1.6)))
  for (let i = 0; i < count; i++) {
    let cx: number
    let cy: number
    if (subtype === 'Circle') {
      const angle = (Math.PI * 2 * i) / count
      cx = x + width / 2 + (width / 2) * Math.cos(angle)
      cy = y + height / 2 + (height / 2) * Math.sin(angle)
    } else {
      const distance = (2 * (width + height) * i) / count
      if (distance < width) { cx = x + distance; cy = y }
      else if (distance < width + height) { cx = x + width; cy = y + distance - width }
      else if (distance < 2 * width + height) { cx = x + 2 * width + height - distance; cy = y + height }
      else { cx = x; cy = y + 2 * (width + height) - distance }
    }
    appendEllipsePath(ops, cx, cy, radius, radius)
    ops.push('S')
  }
}

function buildPreparedAnnotationAppearance(
  prepared: PreparedAnnotationAppearance,
  fontObjects: Map<string, number>,
  fontGidRemap: Map<string, Map<number, number>>,
  defaultCmykColorSpaceId: number | undefined,
): AnnotationAppearance {
  const fontObject = fontObjects.get(prepared.fontResource)
  if (fontObject === undefined) throw new Error(`PDF annotation appearance font was not embedded: ${prepared.fontId}`)
  const ops: string[] = []
  if (prepared.stampBorder !== undefined) {
    const border = prepared.stampBorder
    ops.push(
      strokeColorOp(border.color),
      `${pn(border.borderWidth)} w`,
      `${pn(border.x)} ${pn(border.y)} ${pn(border.width)} ${pn(border.height)} re S`,
    )
  }
  if (prepared.lines.length > 0) {
    ops.push('BT', `${prepared.fontResource} ${pn(prepared.fontSize)} Tf`, prepared.colorOp)
    for (let lineIndex = 0; lineIndex < prepared.lines.length; lineIndex++) {
      const line = prepared.lines[lineIndex]!
      ops.push(`1 0 0 1 ${pn(line.x)} ${pn(line.baseline)} Tm`)
      ops.push(buildTextShowOps({
        type: 'textGlyphs',
        fontId: prepared.fontId,
        glyphIds: Array.from(line.run.glyphIds),
        adjustments: line.adjustments,
        rises: line.rises,
      }, fontGidRemap.get(prepared.fontId)))
    }
    ops.push('ET')
  }
  let resources = `<< /Font << ${prepared.fontResource} ${fontObject} 0 R >>`
  if (/\sk\s*$/.test(prepared.colorOp) && defaultCmykColorSpaceId !== undefined) {
    resources += ` /ColorSpace << /DefaultCMYK ${defaultCmykColorSpaceId} 0 R >>`
  }
  resources += ' >>'
  return { bbox: prepared.bbox, content: ops.join('\n'), resources, borderWidth: null }
}

/**
 * Builds a FreeText (§12.5.6.6) appearance: the /Contents text laid out with a
 * Standard-14 Helvetica resource per the /DA font size and color. Callers that
 * need characters outside WinAnsi provide fontId and use the embedded path.
 */
function buildFreeTextAppearance(annotation: PdfFreeTextAnnotation, page: PageData, w: PdfWriter, alloc: () => number): AnnotationAppearance | null {
  const H = page.height
  const rx0 = annotation.x
  const ry0 = H - (annotation.y + annotation.height)
  const rx1 = annotation.x + annotation.width
  const ry1 = H - annotation.y
  const bbox: [number, number, number, number] = [rx0, ry0, rx1, ry1]
  const text = annotation.contents ?? ''
  if (text.length === 0) return { bbox, content: '', resources: '<< >>', borderWidth: null }

  const size = parseDefaultAppearanceFontSize(annotation.defaultAppearance)
  const colorOp = parseDefaultAppearanceColor(annotation.defaultAppearance)

  const metrics = getStandardFontMetrics('Helvetica')!
  const widths = metrics.widths
  const pad = 2
  const maxWidth = (rx1 - rx0) - pad * 2
  if (maxWidth <= 0) return { bbox, content: '', resources: '<< >>', borderWidth: null }

  const lines: number[][] = []
  const rawLines = text.split('\n')
  for (let i = 0; i < rawLines.length; i++) {
    const encoded = winAnsiEncodeBytes(rawLines[i]!)
    if (encoded === null) throw new Error('PDF FreeText contains characters outside WinAnsi; provide an embedded fontId')
    wrapWinAnsiLine(encoded, widths, size, maxWidth, lines)
  }
  if (lines.length === 0) return { bbox, content: '', resources: '<< >>', borderWidth: null }

  const fontId = alloc()
  w.writeDeferredDict(fontId, ['/Type /Font', '/Subtype /Type1', '/BaseFont /Helvetica', '/Encoding /WinAnsiEncoding'])

  const leading = size * 1.15
  const baselineTop = ry1 - pad - (metrics.ascender / 1000) * size
  const ops: string[] = ['BT', `/Helv ${pn(size)} Tf`, colorOp, `${pn(rx0 + pad)} ${pn(baselineTop)} Td`]
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) ops.push(`0 ${pn(-leading)} Td`)
    ops.push(`${pdfLiteralFromBytes(lines[i]!)} Tj`)
  }
  ops.push('ET')
  return { bbox, content: ops.join('\n'), resources: `<< /Font << /Helv ${fontId} 0 R >> >>`, borderWidth: null }
}

/**
 * Builds a rubber-stamp (§12.5.6.12) appearance: a bordered box with the stamp
 * name label (e.g. "APPROVED") sized to fit, in the stamp color.
 */
function buildStampAppearance(annotation: PdfStampAnnotation, page: PageData, w: PdfWriter, alloc: () => number): AnnotationAppearance | null {
  const label = stampLabel(annotation.icon ?? 'Draft')
  const bytes = winAnsiEncodeBytes(label)
  if (bytes === null || bytes.length === 0) throw new Error('PDF Stamp label is not representable in WinAnsi')
  const H = page.height
  const rx0 = annotation.x
  const ry0 = H - (annotation.y + annotation.height)
  const rx1 = annotation.x + annotation.width
  const ry1 = H - annotation.y
  const bbox: [number, number, number, number] = [rx0, ry0, rx1, ry1]
  const boxW = rx1 - rx0
  const boxH = ry1 - ry0
  if (boxW <= 0 || boxH <= 0) return { bbox, content: '', resources: '<< >>', borderWidth: null }

  const color = annotation.color ?? '#cc0000'
  const metrics = getStandardFontMetrics('Helvetica-Bold')!
  const widths = metrics.widths
  let unitWidth = 0
  for (let i = 0; i < bytes.length; i++) unitWidth += (widths[bytes[i]!] ?? 0) / 1000
  if (unitWidth <= 0) throw new Error('PDF Stamp label has no measurable glyph width')

  const pad = Math.min(boxW, boxH) * 0.18
  const availW = boxW - pad * 2
  const availH = boxH - pad * 2
  let size = availW / unitWidth
  const glyphHeight = (metrics.capHeight) / 1000
  if (glyphHeight > 0) size = Math.min(size, availH / glyphHeight)
  size = Math.min(size, 96)
  if (!(size > 0)) return { bbox, content: '', resources: '<< >>', borderWidth: null }

  const fontId = alloc()
  w.writeDeferredDict(fontId, ['/Type /Font', '/Subtype /Type1', '/BaseFont /Helvetica-Bold', '/Encoding /WinAnsiEncoding'])

  const border = Math.max(1, size * 0.08)
  const cx = (rx0 + rx1) / 2
  const cy = (ry0 + ry1) / 2
  const textWidth = unitWidth * size
  const tx = cx - textWidth / 2
  const baseline = cy - (metrics.capHeight / 1000 * size) / 2
  const ops: string[] = [
    strokeColorOp(color), `${pn(border)} w`,
    `${pn(rx0 + pad * 0.4)} ${pn(ry0 + pad * 0.4)} ${pn(boxW - pad * 0.8)} ${pn(boxH - pad * 0.8)} re S`,
    'BT', `/F0 ${pn(size)} Tf`, fillColorOp(color), `${pn(tx)} ${pn(baseline)} Td`, `${pdfLiteralFromBytes(bytes)} Tj`, 'ET',
  ]
  return { bbox, content: ops.join('\n'), resources: `<< /Font << /F0 ${fontId} 0 R >> >>`, borderWidth: null }
}

/** Human-readable uppercase label for a standard stamp icon name. */
function stampLabel(icon: string): string {
  return icon.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()
}

function parseDefaultAppearanceFontSize(da: string): number {
  const pattern = /\/[^\s]+\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+Tf\b/g
  let match: RegExpExecArray | null
  let fontSize: number | null = null
  while ((match = pattern.exec(da)) !== null) fontSize = Number(match[1])
  if (fontSize === null || !Number.isFinite(fontSize) || fontSize <= 0) {
    throw new Error('PDF FreeText defaultAppearance requires a positive Tf font size')
  }
  return fontSize
}

/** Extracts the final color operator (`g`, `rg`, or `k`) from a /DA string. */
function parseDefaultAppearanceColor(da: string): string {
  const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  const pattern = new RegExp(`((?:${number}\\s+){0,3}${number})\\s+(g|rg|k)\\b`, 'g')
  let match: RegExpExecArray | null
  let color: string | null = null
  while ((match = pattern.exec(da)) !== null) {
    const operator = match[2]!
    const values = match[1]!.trim().split(/\s+/).map(Number)
    const expected = operator === 'g' ? 1 : operator === 'rg' ? 3 : 4
    if (values.length !== expected || values.some(function (value) { return !Number.isFinite(value) || value < 0 || value > 1 })) {
      throw new Error(`PDF defaultAppearance ${operator} color requires ${expected} components from 0 through 1`)
    }
    color = `${values.map(pn).join(' ')} ${operator}`
  }
  return color ?? '0 g'
}

/** WinAnsi bytes for a string, or null when any character is outside WinAnsi. */
function winAnsiEncodeBytes(text: string): number[] | null {
  const bytes: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x09) { bytes.push(0x20); continue }  // tab -> space
    const code = winAnsiCodeForCodePoint(cp)
    if (code === null) return null
    bytes.push(code)
  }
  return bytes
}

/** Greedy word-wraps a WinAnsi byte line to maxWidth (pt), appending to `out`. */
function wrapWinAnsiLine(bytes: number[], widths: number[], size: number, maxWidth: number, out: number[][]): void {
  const wordWidth = (word: number[]): number => {
    let sum = 0
    for (let i = 0; i < word.length; i++) sum += (widths[word[i]!] ?? 0) / 1000 * size
    return sum
  }
  let current: number[] = []
  let currentWidth = 0
  let word: number[] = []
  const flushWord = (): void => {
    if (word.length === 0) return
    const ww = wordWidth(word)
    const spaceW = current.length > 0 ? (widths[0x20]! / 1000 * size) : 0
    if (current.length > 0 && currentWidth + spaceW + ww > maxWidth) {
      out.push(current)
      current = word
      currentWidth = ww
    } else {
      if (current.length > 0) { current.push(0x20); currentWidth += spaceW }
      for (let i = 0; i < word.length; i++) current.push(word[i]!)
      currentWidth += ww
    }
    word = []
  }
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x20) flushWord()
    else word.push(bytes[i]!)
  }
  flushWord()
  out.push(current)
}

/** Builds a PDF literal string `( … )` from raw bytes, escaping as needed. */
function pdfLiteralFromBytes(bytes: number[]): string {
  let out = '('
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if (b === 0x28 || b === 0x29 || b === 0x5C) out += '\\' + String.fromCharCode(b)
    else if (b < 0x20 || b > 0x7E) out += '\\' + b.toString(8).padStart(3, '0')
    else out += String.fromCharCode(b)
  }
  return out + ')'
}

/** Appends a 4-cubic ellipse path (same control points as drawEllipse). */
function appendEllipsePath(ops: string[], cx: number, cy: number, rx: number, ry: number): void {
  const kx = rx * 0.5522847498
  const ky = ry * 0.5522847498
  ops.push(`${pn(cx - rx)} ${pn(cy)} m`)
  ops.push(`${pn(cx - rx)} ${pn(cy + ky)} ${pn(cx - kx)} ${pn(cy + ry)} ${pn(cx)} ${pn(cy + ry)} c`)
  ops.push(`${pn(cx + kx)} ${pn(cy + ry)} ${pn(cx + rx)} ${pn(cy + ky)} ${pn(cx + rx)} ${pn(cy)} c`)
  ops.push(`${pn(cx + rx)} ${pn(cy - ky)} ${pn(cx + kx)} ${pn(cy - ry)} ${pn(cx)} ${pn(cy - ry)} c`)
  ops.push(`${pn(cx - kx)} ${pn(cy - ry)} ${pn(cx - rx)} ${pn(cy - ky)} ${pn(cx - rx)} ${pn(cy)} c`)
  ops.push('h')
}

/**
 * Appends a line-ending symbol (arrow / circle / square / diamond / butt /
 * slash) at (x, y). (ox, oy) is the outward unit direction the ending points.
 * Filled endings use the line's stroke color.
 */
function appendLineEnding(ops: string[], x: number, y: number, ox: number, oy: number, ending: PdfAnnotationLineEnding, bw: number, strokeColor: string): void {
  if (ending === 'None') return
  const L = Math.max(bw * 3, 6)
  const half = L * 0.4
  const rot = (lx: number, ly: number): [number, number] => [x + lx * ox - ly * oy, y + lx * oy + ly * ox]
  const pt = (p: [number, number]): string => `${pn(p[0])} ${pn(p[1])}`
  const reversed = ending === 'ROpenArrow' || ending === 'RClosedArrow'
  const sign = reversed ? -1 : 1
  if (ending === 'OpenArrow' || ending === 'ROpenArrow') {
    const tip = rot(0, 0), a = rot(-L * sign, half), b = rot(-L * sign, -half)
    ops.push(`${pt(a)} m ${pt(tip)} l ${pt(b)} l S`)
  } else if (ending === 'ClosedArrow' || ending === 'RClosedArrow') {
    const tip = rot(0, 0), a = rot(-L * sign, half), b = rot(-L * sign, -half)
    ops.push(fillColorOp(strokeColor))
    ops.push(`${pt(tip)} m ${pt(a)} l ${pt(b)} l h B`)
  } else if (ending === 'Butt') {
    const a = rot(0, half), b = rot(0, -half)
    ops.push(`${pt(a)} m ${pt(b)} l S`)
  } else if (ending === 'Slash') {
    const a = rot(half, half), b = rot(-half, -half)
    ops.push(`${pt(a)} m ${pt(b)} l S`)
  } else if (ending === 'Square') {
    const a = rot(half, half), b = rot(half, -half), c = rot(-half, -half), d = rot(-half, half)
    ops.push(fillColorOp(strokeColor))
    ops.push(`${pt(a)} m ${pt(b)} l ${pt(c)} l ${pt(d)} l h B`)
  } else if (ending === 'Diamond') {
    const a = rot(half, 0), b = rot(0, -half), c = rot(-half, 0), d = rot(0, half)
    ops.push(fillColorOp(strokeColor))
    ops.push(`${pt(a)} m ${pt(b)} l ${pt(c)} l ${pt(d)} l h B`)
  } else {
    // Circle
    ops.push(fillColorOp(strokeColor))
    appendEllipsePath(ops, x, y, half, half)
    ops.push('B')
  }
}

/** Appends a zigzag polyline between two baseline points (Squiggly markup). */
function appendSquigglyPath(ops: string[], x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const length = Math.sqrt(dx * dx + dy * dy)
  if (length <= 0) return
  const step = 2
  const amp = 1.2
  const nx = -dy / length
  const ny = dx / length
  const count = Math.max(1, Math.floor(length / step))
  ops.push(`${pn(x0)} ${pn(y0)} m`)
  for (let i = 1; i <= count; i++) {
    const t = i / count
    const bx = x0 + dx * t
    const by = y0 + dy * t
    const offset = (i % 2 === 0) ? 0 : amp
    ops.push(`${pn(bx + nx * offset)} ${pn(by + ny * offset)} l`)
  }
  ops.push('S')
}

function writeArticleThreads(
  threads: PdfArticleThread[],
  w: PdfWriter,
  alloc: () => number,
  pageIds: number[],
  pages: PageData[],
  rawValuePdf: (value: PdfRawValueDef) => string,
): { catalogEntry: string, pageBeadIds: Map<number, number[]>, threadIds: number[], beadIdsByThread: number[][] } {
  const pageBeadIds = new Map<number, number[]>()
  if (threads.length === 0) return { catalogEntry: '', pageBeadIds, threadIds: [], beadIdsByThread: [] }

  const threadIds: number[] = []
  const beadIdsByThread: number[][] = []
  for (let ti = 0; ti < threads.length; ti++) {
    const thread = threads[ti]!
    if (thread.beads.length === 0) throw new Error(`PDF article thread ${ti + 1} must contain at least one bead`)
    const threadId = alloc()
    threadIds.push(threadId)
    const beadIds: number[] = []
    for (let bi = 0; bi < thread.beads.length; bi++) beadIds.push(alloc())
    beadIdsByThread.push(beadIds)
  }

  for (let ti = 0; ti < threads.length; ti++) {
    const thread = threads[ti]!
    const threadId = threadIds[ti]!
    const beadIds = beadIdsByThread[ti]!
    const threadDict = [
      '/Type /Thread',
      `/F ${beadIds[0]} 0 R`,
    ]
    const infoDict = buildArticleInfoDictionary(thread.info)
    if (infoDict !== '') threadDict.push(`/I ${infoDict}`)
    if (thread.metadata !== undefined) {
      validatePdfMetadataStreamDef(thread.metadata, `article thread ${ti + 1}`)
      threadDict.push(`/Metadata ${rawValuePdf(thread.metadata)}`)
    }
    w.writeDeferredDict(threadId, threadDict)

    for (let bi = 0; bi < thread.beads.length; bi++) {
      const bead = thread.beads[bi]!
      const page = pages[bead.pageIndex]
      const pageId = pageIds[bead.pageIndex]
      if (page === undefined || pageId === undefined) {
        throw new Error(`PDF article thread ${ti + 1} bead ${bi + 1} page index ${bead.pageIndex} out of range`)
      }
      const beadId = beadIds[bi]!
      const nextId = beadIds[(bi + 1) % beadIds.length]!
      const prevId = beadIds[(bi + beadIds.length - 1) % beadIds.length]!
      let pageList = pageBeadIds.get(bead.pageIndex)
      if (pageList === undefined) {
        pageList = []
        pageBeadIds.set(bead.pageIndex, pageList)
      }
      pageList.push(beadId)
      w.writeDeferredDict(beadId, [
        '/Type /Bead',
        `/T ${threadId} 0 R`,
        `/N ${nextId} 0 R`,
        `/V ${prevId} 0 R`,
        `/P ${pageId} 0 R`,
        `/R ${articleBeadRect(bead, page)}`,
      ])
    }
  }

  return {
    catalogEntry: `/Threads [${threadIds.map(function (id) { return `${id} 0 R` }).join(' ')}]`,
    pageBeadIds,
    threadIds,
    beadIdsByThread,
  }
}

function buildArticleInfoDictionary(info: PdfArticleInfo | undefined): string {
  if (info === undefined) return ''
  const entries: string[] = []
  if (info.title !== undefined) entries.push(`/Title ${pdfString(info.title)}`)
  if (info.author !== undefined) entries.push(`/Author ${pdfString(info.author)}`)
  if (info.subject !== undefined) entries.push(`/Subject ${pdfString(info.subject)}`)
  if (info.keywords !== undefined) entries.push(`/Keywords ${pdfString(info.keywords)}`)
  if (info.creator !== undefined) entries.push(`/Creator ${pdfString(info.creator)}`)
  if (info.producer !== undefined) entries.push(`/Producer ${pdfString(info.producer)}`)
  if (info.creationDate !== undefined) entries.push(`/CreationDate ${pdfString(info.creationDate)}`)
  if (info.modDate !== undefined) entries.push(`/ModDate ${pdfString(info.modDate)}`)
  if (info.trapped !== undefined) entries.push(`/Trapped /${info.trapped === 'unknown' ? 'Unknown' : info.trapped ? 'True' : 'False'}`)
  appendCustomInfoEntries(entries, info.custom)
  return entries.length === 0 ? '' : `<< ${entries.join(' ')} >>`
}

function articleBeadRect(bead: PdfArticleBead, page: PageData): string {
  const x1 = bead.x
  const x2 = bead.x + bead.width
  const y1 = page.height - bead.y
  const y2 = page.height - (bead.y + bead.height)
  return `[${pn(x1)} ${pn(y2)} ${pn(x2)} ${pn(y1)}]`
}

function pdfDestinationNumberOrNull(value: number | undefined): string {
  return value === undefined ? 'null' : pn(value)
}

function pdfDestinationYOrNull(value: number | undefined, page: PageData): string {
  return value === undefined ? 'null' : pn(page.height - value)
}

function pdfZoomOrNull(value: number | null | undefined): string {
  return value === undefined || value === null ? 'null' : pn(value)
}

interface ValidatedPdfWebCapture {
  pageIdentifiers: Map<number, Uint8Array>
  imageIdentifiers: Map<string, Uint8Array>
  pageObjects: Map<number, Extract<PdfWebCaptureContentObject, { kind: 'page' }>>
}

function validatePdfWebCapture(webCapture: PdfWebCapture | undefined, pageCount: number): ValidatedPdfWebCapture {
  const pageIdentifiers = new Map<number, Uint8Array>()
  const imageIdentifiers = new Map<string, Uint8Array>()
  const pageObjects = new Map<number, Extract<PdfWebCaptureContentObject, { kind: 'page' }>>()
  if (webCapture === undefined) return { pageIdentifiers, imageIdentifiers, pageObjects }
  if (webCapture.version !== 1) throw new Error('PDF Web Capture version must be 1')
  const commands = webCapture.commands ?? []
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
    const command = commands[commandIndex]!
    requirePdfAscii(command.url, `Web Capture command ${commandIndex} URL`)
    if (command.levels !== undefined && (!Number.isInteger(command.levels) || command.levels < 0)) {
      throw new Error(`PDF Web Capture command ${commandIndex} levels must be a non-negative integer`)
    }
    if (command.flags !== undefined && (!Number.isInteger(command.flags) || command.flags < 0 || command.flags > 7)) {
      throw new Error(`PDF Web Capture command ${commandIndex} flags may use only SameSite, SamePath, and Submit`)
    }
    if (command.contentType !== undefined) requirePdfAscii(command.contentType, `Web Capture command ${commandIndex} content type`)
    if (command.postedData?.kind === 'stream' && command.postedData.entries?.Length !== undefined) {
      throw new Error(`PDF Web Capture command ${commandIndex} posted-data stream entries must not contain Length`)
    }
  }
  const contentObjects = new Set<string>()
  for (let setIndex = 0; setIndex < webCapture.contentSets.length; setIndex++) {
    const set = webCapture.contentSets[setIndex]!
    if (set.identifier.length === 0) throw new Error(`PDF Web Capture content set ${setIndex} identifier must not be empty`)
    if (set.objects.length === 0) throw new Error(`PDF Web Capture content set ${setIndex} objects must not be empty`)
    if (set.urls.length === 0) throw new Error(`PDF Web Capture content set ${setIndex} URLs must not be empty`)
    const urls = new Set<string>()
    for (let urlIndex = 0; urlIndex < set.urls.length; urlIndex++) {
      const url = set.urls[urlIndex]!
      requirePdfAscii(url, `Web Capture content set ${setIndex} URL`)
      if (urls.has(url)) throw new Error(`PDF Web Capture content set ${setIndex} contains duplicate URL ${url}`)
      urls.add(url)
    }
    if (set.contentType !== undefined) requirePdfAscii(set.contentType, `Web Capture content set ${setIndex} content type`)
    for (let objectIndex = 0; objectIndex < set.objects.length; objectIndex++) {
      const object = set.objects[objectIndex]!
      if (set.kind !== object.kind) throw new Error(`PDF Web Capture ${set.kind} set ${setIndex} contains a ${object.kind} object`)
      const key = object.kind === 'page' ? `p:${object.pageIndex}` : `i:${object.imageId}`
      if (contentObjects.has(key)) throw new Error(`PDF Web Capture object ${key} belongs to more than one content set`)
      contentObjects.add(key)
      if (object.kind === 'page') {
        if (!Number.isInteger(object.pageIndex) || object.pageIndex < 0 || object.pageIndex >= pageCount) {
          throw new Error(`PDF Web Capture content set ${setIndex} page index is out of range`)
        }
        if (object.preferredZoom !== undefined && (!Number.isFinite(object.preferredZoom) || object.preferredZoom <= 0)) {
          throw new Error(`PDF Web Capture content set ${setIndex} preferred zoom must be positive`)
        }
        pageIdentifiers.set(object.pageIndex, set.identifier)
        pageObjects.set(object.pageIndex, object)
      } else {
        if (object.imageId === '') throw new Error(`PDF Web Capture content set ${setIndex} image ID must not be empty`)
        imageIdentifiers.set(object.imageId, set.identifier)
      }
    }
    const sources = Array.isArray(set.sources) ? set.sources : [set.sources]
    if (sources.length === 0) throw new Error(`PDF Web Capture content set ${setIndex} sources must not be empty`)
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const source = sources[sourceIndex]!
      if (typeof source.urls === 'string') {
        requirePdfAscii(source.urls, `Web Capture content set ${setIndex} source URL`)
      } else {
        requirePdfAscii(source.urls.destinationUrl, `Web Capture content set ${setIndex} source destination URL`)
        const chains = source.urls.chains
        if (chains !== undefined) {
          if (chains.length === 0) throw new Error(`PDF Web Capture content set ${setIndex} URL alias chains must not be empty`)
          for (let chainIndex = 0; chainIndex < chains.length; chainIndex++) {
            const chain = chains[chainIndex]!
            if (chain.length === 0) throw new Error(`PDF Web Capture content set ${setIndex} URL alias chain must not be empty`)
            for (let linkIndex = 0; linkIndex < chain.length; linkIndex++) {
              requirePdfAscii(chain[linkIndex]!, `Web Capture content set ${setIndex} URL alias`)
            }
          }
        }
      }
      if (source.submission !== undefined && set.kind !== 'page') {
        throw new Error(`PDF Web Capture image set ${setIndex} must not declare form submission`)
      }
      if (source.commandIndex !== undefined) {
        if (set.kind !== 'page') throw new Error(`PDF Web Capture image set ${setIndex} must not reference a command`)
        if (!Number.isInteger(source.commandIndex) || source.commandIndex < 0 || source.commandIndex >= commands.length) {
          throw new Error(`PDF Web Capture content set ${setIndex} command index is out of range`)
        }
      }
    }
    if (set.kind === 'image') {
      if (set.objects.length === 1) {
        if (!Number.isInteger(set.referenceCounts) || (set.referenceCounts as number) < 0) {
          throw new Error(`PDF Web Capture image set ${setIndex} requires one non-negative integer reference count`)
        }
      } else {
        if (!Array.isArray(set.referenceCounts) || set.referenceCounts.length !== set.objects.length) {
          throw new Error(`PDF Web Capture image set ${setIndex} reference counts must parallel its objects`)
        }
        for (let countIndex = 0; countIndex < set.referenceCounts.length; countIndex++) {
          const count = set.referenceCounts[countIndex]!
          if (!Number.isInteger(count) || count < 0) throw new Error(`PDF Web Capture image set ${setIndex} reference counts must be non-negative integers`)
        }
      }
    }
  }
  return { pageIdentifiers, imageIdentifiers, pageObjects }
}

function requirePdfAscii(value: string, label: string): void {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7f) throw new Error(`PDF ${label} must be an ASCII string`)
  }
}

function pdfDeveloperExtensionsPdf(
  extensions: PdfDeveloperExtensions,
  rawDictionaryPdf: (entries: Record<string, PdfRawValueDef>) => string,
): string {
  validatePdfDeveloperExtensions(extensions)
  const values: string[] = ['/Type /Extensions']
  const prefixes = Object.keys(extensions)
  for (let p = 0; p < prefixes.length; p++) {
    const prefix = prefixes[p]!
    const value = extensions[prefix]!
    const recordPdf = function (record: PdfDeveloperExtension): string {
      const entries = [
        '/Type /DeveloperExtensions',
        `/BaseVersion ${encodePdfName(record.baseVersion)}`,
        `/ExtensionLevel ${record.extensionLevel}`,
      ]
      if (record.extensionRevision !== undefined) entries.push(`/ExtensionRevision ${pdfString(record.extensionRevision)}`)
      if (record.url !== undefined) entries.push(`/URL ${pdfString(record.url)}`)
      if (record.entries !== undefined) {
        const custom = rawDictionaryPdf(record.entries)
        entries.push(custom.slice(3, -3))
      }
      return `<< ${entries.join(' ')} >>`
    }
    values.push(`${encodePdfName(prefix)} ${Array.isArray(value)
      ? `[${value.map(recordPdf).join(' ')}]`
      : recordPdf(value)}`)
  }
  return `<< ${values.join(' ')} >>`
}

function validatePdfDocumentRequirements(requirements: PdfDocumentRequirement[] | undefined, scripts: PdfJavaScriptAction[]): void {
  if (requirements === undefined) return
  if (requirements.length === 0) throw new Error('PDF catalog Requirements must not be empty')
  const scriptNames = new Set<string>()
  for (let i = 0; i < scripts.length; i++) scriptNames.add(scripts[i]!.name)
  for (let requirementIndex = 0; requirementIndex < requirements.length; requirementIndex++) {
    const requirement = requirements[requirementIndex]!
    if (!PDF_DOCUMENT_REQUIREMENT_TYPES.has(requirement.type)) throw new Error(`Unknown PDF document requirement type: ${requirement.type}`)
    if (requirement.penalty !== undefined && (!Number.isInteger(requirement.penalty) || requirement.penalty < 0 || requirement.penalty > 100)) {
      throw new Error(`PDF document requirement ${requirement.type} penalty must be an integer from 0 to 100`)
    }
    if (requirement.type === 'Encryption') {
      if (requirement.encryption === undefined) throw new Error('PDF Encryption requirement requires an encryption dictionary')
    } else if (requirement.encryption !== undefined) {
      throw new Error(`PDF document requirement ${requirement.type} must not contain Encrypt`)
    }
    const signatureRequirement = requirement.type === 'DigSig' || requirement.type === 'DigSigValidation' || requirement.type === 'DigSigMDP'
    if (!signatureRequirement && requirement.digitalSignature !== undefined) {
      throw new Error(`PDF document requirement ${requirement.type} must not contain DigSig`)
    }
    if (requirement.handlers !== undefined) {
      const handlers = Array.isArray(requirement.handlers) ? requirement.handlers : [requirement.handlers]
      for (let handlerIndex = 0; handlerIndex < handlers.length; handlerIndex++) {
        const handler = handlers[handlerIndex]!
        if (handler.type === 'JS' && handler.script !== undefined && !scriptNames.has(handler.script)) {
          throw new Error(`PDF document requirement handler references missing JavaScript ${handler.script}`)
        }
      }
    }
  }
}

function pdfDocumentRequirementPdf(
  requirement: PdfDocumentRequirement,
  rawDictionaryPdf: (entries: Record<string, PdfRawValueDef>) => string,
): string {
  const entries = ['/Type /Requirement', `/S /${requirement.type}`]
  if (requirement.version !== undefined) {
    entries.push(`/V ${typeof requirement.version === 'string' ? encodePdfName(requirement.version) : rawDictionaryPdf(requirement.version)}`)
  }
  if (requirement.handlers !== undefined) {
    const handlerPdf = function (handler: PdfDocumentRequirementHandler): string {
      if (handler.type === 'NoOp') return '<< /Type /ReqHandler /S /NoOp >>'
      return `<< /Type /ReqHandler /S /JS${handler.script === undefined ? '' : ` /Script ${pdfString(handler.script)}`} >>`
    }
    entries.push(`/RH ${Array.isArray(requirement.handlers)
      ? `[${requirement.handlers.map(handlerPdf).join(' ')}]`
      : handlerPdf(requirement.handlers)}`)
  }
  if (requirement.penalty !== undefined) entries.push(`/Penalty ${requirement.penalty}`)
  if (requirement.encryption !== undefined) entries.push(`/Encrypt ${rawDictionaryPdf(requirement.encryption)}`)
  if (requirement.digitalSignature !== undefined) entries.push(`/DigSig ${rawDictionaryPdf(requirement.digitalSignature)}`)
  return `<< ${entries.join(' ')} >>`
}

function writePdfWebCapture(
  webCapture: PdfWebCapture | undefined,
  writer: PdfWriter,
  alloc: () => number,
  writeStream: (objId: number, data: Uint8Array, extraDict?: string) => void,
  rawDictionaryPdf: (entries: Record<string, PdfRawValueDef>) => string,
  pageIds: number[],
  imageObjects: Map<string, number>,
  imageRefMap: Map<string, string>,
): { spiderInfo: string, urlsNameTree: string, idsNameTree: string } {
  if (webCapture === undefined) return { spiderInfo: '', urlsNameTree: '', idsNameTree: '' }
  const commands = webCapture.commands ?? []
  const commandIds = commands.map(function () { return alloc() })
  const contentSetIds = webCapture.contentSets.map(function () { return alloc() })
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
    const command = commands[commandIndex]!
    const entries = [`/URL ${pdfString(command.url)}`]
    if (command.levels !== undefined) entries.push(`/L ${command.levels}`)
    if (command.flags !== undefined) entries.push(`/F ${command.flags}`)
    if (command.postedData !== undefined) {
      if (command.postedData.kind === 'string') {
        entries.push(`/P <${bytesToHex(command.postedData.bytes)}>`)
      } else {
        const streamId = alloc()
        writer.beginObj(streamId)
        const streamEntries = command.postedData.entries === undefined ? undefined : rawDictionaryPdf(command.postedData.entries).slice(3, -3) + ' '
        writeStream(streamId, command.postedData.data, streamEntries)
        writer.endObj()
        entries.push(`/P ${streamId} 0 R`)
      }
    }
    if (command.contentType !== undefined) entries.push(`/CT ${pdfString(command.contentType)}`)
    if (command.headers !== undefined) entries.push(`/H <${bytesToHex(command.headers)}>`)
    if (command.settings !== undefined) {
      const settings: string[] = []
      if (command.settings.global !== undefined) settings.push(`/G ${rawDictionaryPdf(command.settings.global)}`)
      if (command.settings.converters !== undefined) {
        const converters: string[] = []
        const names = Object.keys(command.settings.converters).sort()
        for (let i = 0; i < names.length; i++) {
          const name = names[i]!
          converters.push(`${encodePdfName(name)} ${rawDictionaryPdf(command.settings.converters[name]!)}`)
        }
        settings.push(`/C << ${converters.join(' ')} >>`)
      }
      entries.push(`/S << ${settings.join(' ')} >>`)
    }
    writer.writeDeferredDict(commandIds[commandIndex]!, entries)
  }
  const urlSets = new Map<string, number[]>()
  for (let setIndex = 0; setIndex < webCapture.contentSets.length; setIndex++) {
    const set = webCapture.contentSets[setIndex]!
    const objects: string[] = []
    for (let objectIndex = 0; objectIndex < set.objects.length; objectIndex++) {
      const object = set.objects[objectIndex]!
      if (object.kind === 'page') {
        objects.push(`${pageIds[object.pageIndex]!} 0 R`)
      } else {
        const imageName = imageRefMap.get(object.imageId)
        const imageId = imageName === undefined ? undefined : imageObjects.get(imageName)
        if (imageId === undefined) throw new Error(`PDF Web Capture image resource is not registered: ${object.imageId}`)
        objects.push(`${imageId} 0 R`)
      }
    }
    const sourcePdf = function (source: PdfWebCaptureSource): string {
      const sourceEntries: string[] = []
      if (typeof source.urls === 'string') {
        sourceEntries.push(`/AU ${pdfString(source.urls)}`)
      } else {
        const alias = [`/U ${pdfString(source.urls.destinationUrl)}`]
        if (source.urls.chains !== undefined) {
          alias.push(`/C [${source.urls.chains.map(function (chain) {
            return `[${chain.map(pdfString).join(' ')}]`
          }).join(' ')}]`)
        }
        sourceEntries.push(`/AU << ${alias.join(' ')} >>`)
      }
      if (source.timestamp !== undefined) sourceEntries.push(`/TS ${pdfString(source.timestamp)}`)
      if (source.expiresAt !== undefined) sourceEntries.push(`/E ${pdfString(source.expiresAt)}`)
      if (source.submission !== undefined) sourceEntries.push(`/S ${source.submission}`)
      if (source.commandIndex !== undefined) sourceEntries.push(`/C ${commandIds[source.commandIndex]!} 0 R`)
      return `<< ${sourceEntries.join(' ')} >>`
    }
    const sources = Array.isArray(set.sources) ? set.sources : [set.sources]
    const entries = [
      '/Type /SpiderContentSet',
      `/S /${set.kind === 'page' ? 'SPS' : 'SIS'}`,
      `/ID <${bytesToHex(set.identifier)}>`,
      `/O [${objects.join(' ')}]`,
      `/SI ${Array.isArray(set.sources) ? `[${sources.map(sourcePdf).join(' ')}]` : sourcePdf(sources[0]!)}`,
    ]
    if (set.contentType !== undefined) entries.push(`/CT ${pdfString(set.contentType)}`)
    if (set.createdAt !== undefined) entries.push(`/TS ${pdfString(set.createdAt)}`)
    if (set.kind === 'page') {
      if (set.title !== undefined) entries.push(`/T ${pdfString(set.title)}`)
      if (set.textIdentifier !== undefined) entries.push(`/TID <${bytesToHex(set.textIdentifier)}>`)
    } else {
      entries.push(`/R ${Array.isArray(set.referenceCounts) ? `[${set.referenceCounts.join(' ')}]` : set.referenceCounts}`)
    }
    writer.writeDeferredDict(contentSetIds[setIndex]!, entries)
    for (let urlIndex = 0; urlIndex < set.urls.length; urlIndex++) {
      const url = set.urls[urlIndex]!
      const indices = urlSets.get(url)
      if (indices === undefined) urlSets.set(url, [setIndex])
      else indices.push(setIndex)
    }
  }
  const urls = Array.from(urlSets.keys()).sort()
  const urlEntries: string[] = []
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!
    const indices = urlSets.get(url)!
    const value = indices.length === 1
      ? `${contentSetIds[indices[0]!]!} 0 R`
      : `[${indices.map(function (index) { return `${contentSetIds[index]!} 0 R` }).join(' ')}]`
    urlEntries.push(`${pdfString(url)} ${value}`)
  }
  const identifierSets = new Map<string, { bytes: Uint8Array, indices: number[] }>()
  for (let setIndex = 0; setIndex < webCapture.contentSets.length; setIndex++) {
    const identifier = webCapture.contentSets[setIndex]!.identifier
    const hex = bytesToHex(identifier)
    const entry = identifierSets.get(hex)
    if (entry === undefined) identifierSets.set(hex, { bytes: identifier, indices: [setIndex] })
    else entry.indices.push(setIndex)
  }
  const identifierOrder = Array.from(identifierSets.values()).sort(function (a, b) { return compareBytes(a.bytes, b.bytes) })
  const identifierEntries = identifierOrder.map(function (entry) {
    const value = entry.indices.length === 1
      ? `${contentSetIds[entry.indices[0]!]!} 0 R`
      : `[${entry.indices.map(function (index) { return `${contentSetIds[index]!} 0 R` }).join(' ')}]`
    return `<${bytesToHex(entry.bytes)}> ${value}`
  })
  const commandRefs = commandIds.length === 0 ? '' : ` /C [${commandIds.map(function (id) { return `${id} 0 R` }).join(' ')}]`
  return {
    spiderInfo: `<< /V 1${commandRefs} >>`,
    urlsNameTree: urlEntries.length === 0 ? '' : `<< /Names [${urlEntries.join(' ')}] >>`,
    idsNameTree: identifierEntries.length === 0 ? '' : `<< /Names [${identifierEntries.join(' ')}] >>`,
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!
  }
  return a.length - b.length
}

const PDF_DOCUMENT_REQUIREMENT_TYPES = new Set<PdfDocumentRequirementType>([
  'OCInteract', 'OCAutoStates', 'AcroFormInteract', 'Navigation', 'Markup', '3DMarkup',
  'Multimedia', 'U3D', 'PRC', 'Action', 'EnableJavaScripts', 'Attachment', 'AttachmentEditing',
  'Collection', 'CollectionEditing', 'DigSigValidation', 'DigSig', 'DigSigMDP', 'RichMedia',
  'Geospatial2D', 'Geospatial3D', 'DPartInteract', 'SeparationSimulation', 'Transitions', 'Encryption',
])

function pdfBool(value: boolean): string {
  return value ? 'true' : 'false'
}

function pdfString(value: string | Date): string {
  return `(${pdfEscapeString(value instanceof Date ? formatPdfDate(value) : value)})`
}

function pdfByteString(value: string): string {
  const bytes = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code > 0xFF) throw new Error('PDF byte string contains a character outside Latin-1')
    bytes[i] = code
  }
  return `<${bytesToHex(bytes)}>`
}

function pdfFileSpecificationString(value: string): string {
  validateUnicodeScalars(value, 'PDF file specification')
  let ascii = true
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7F) { ascii = false; break }
  }
  return ascii ? pdfString(value) : `<${bytesToHex(new TextEncoder().encode(value))}>`
}

function validateRedactionOverlayAppearance(value: Extract<PdfRawValueDef, { kind: 'stream' }>): void {
  const subtype = value.entries.Subtype
  if (typeof subtype !== 'object' || subtype === null || subtype.kind !== 'name' || subtype.value !== 'Form') {
    throw new Error('PDF Redact annotation overlayAppearance must be a Form XObject stream')
  }
  const type = value.entries.Type
  if (type !== undefined && (typeof type !== 'object' || type === null || type.kind !== 'name' || type.value !== 'XObject')) {
    throw new Error('PDF Redact annotation overlayAppearance Type must be XObject')
  }
  validateRawNumberArray(value.entries.BBox, 4, 'PDF Redact annotation overlayAppearance BBox')
  if (value.entries.Matrix !== undefined) validateRawNumberArray(value.entries.Matrix, 6, 'PDF Redact annotation overlayAppearance Matrix')
  const resources = value.entries.Resources
  if (resources !== undefined && (typeof resources !== 'object' || resources === null || resources.kind !== 'dictionary')) {
    throw new Error('PDF Redact annotation overlayAppearance Resources must be a dictionary')
  }
}

function validatePdfMetadataStreamDef(
  value: PdfRawValueDef,
  owner: string,
): void {
  if (typeof value !== 'object' || value === null || value.kind !== 'stream') {
    throw new Error(`PDF ${owner} metadata must be a stream`)
  }
  const type = value.entries.Type
  if (typeof type !== 'object' || type === null || type.kind !== 'name' || type.value !== 'Metadata') {
    throw new Error(`PDF ${owner} metadata stream Type must be Metadata`)
  }
  const subtype = value.entries.Subtype
  if (typeof subtype !== 'object' || subtype === null || subtype.kind !== 'name' || subtype.value !== 'XML') {
    throw new Error(`PDF ${owner} metadata stream Subtype must be XML`)
  }
  parsePdfXmpPacket(value.data)
}

function validateRawNumberArray(value: PdfRawValueDef | undefined, length: number, label: string): void {
  if (typeof value !== 'object' || value === null || value.kind !== 'array' || value.items.length !== length) {
    throw new Error(`${label} must contain ${length} numbers`)
  }
  for (let i = 0; i < value.items.length; i++) {
    if (typeof value.items[i] !== 'number' || !Number.isFinite(value.items[i] as number)) {
      throw new Error(`${label} must contain ${length} numbers`)
    }
  }
}

function appendCustomInfoEntries(entries: string[], custom: Record<string, PdfInfoCustomValue> | undefined): void {
  if (custom === undefined) return
  const keys = Object.keys(custom)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    if (STANDARD_INFO_KEYS.has(key)) continue
    entries.push(`/${escapePdfNameBody(key)} ${pdfInfoCustomValue(custom[key]!)}`)
  }
}

function pdfInfoCustomValue(value: PdfInfoCustomValue): string {
  if (typeof value === 'string') return `(${pdfEscapeString(value)})`
  if (typeof value === 'number') return pn(value)
  if (typeof value === 'boolean') return pdfBool(value)
  if (value instanceof Date) return `(${formatPdfDate(value)})`
  return `/${escapePdfNameBody(value.value)}`
}

const STANDARD_INFO_KEYS = new Set<string>([
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
  'GTS_PDFXVersion',
  'GTS_PDFXConformance',
])

/** "#RRGGBB" → [r, g, b] (0.0〜1.0) */
/**
 * Builds Indexed image data when the RGB channels hold at most 256 unique
 * colors: palette + bit-packed index rows at depth 1/2/4/8. Returns null
 * when the image is not palettizable (kept as direct DeviceRGB).
 */
function buildIndexedImageData(width: number, height: number, pixels: Uint8Array): {
  colorSpace: string, bitsPerComponent: number, compressed: Uint8Array, hasAlpha: boolean,
} | null {
  const pixelCount = width * height
  if (pixelCount === 0) return null
  const paletteIndex = new Map<number, number>()
  const indices = new Uint8Array(pixelCount)
  let hasAlpha = false
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4
    if (pixels[o + 3]! !== 255) hasAlpha = true
    const key = (pixels[o]! << 16) | (pixels[o + 1]! << 8) | pixels[o + 2]!
    let index = paletteIndex.get(key)
    if (index === undefined) {
      if (paletteIndex.size >= 256) return null
      index = paletteIndex.size
      paletteIndex.set(key, index)
    }
    indices[i] = index
  }
  const colorCount = paletteIndex.size
  const bitsPerComponent = colorCount <= 2 ? 1 : colorCount <= 4 ? 2 : colorCount <= 16 ? 4 : 8
  // Bit-packed rows, each padded to a byte boundary (ISO 32000 8.9.5.2)
  const rowBytes = Math.ceil(width * bitsPerComponent / 8)
  const packed = new Uint8Array(rowBytes * height)
  const pixelsPerByte = 8 / bitsPerComponent
  for (let y = 0; y < height; y++) {
    const rowBase = y * rowBytes
    for (let x = 0; x < width; x++) {
      const index = indices[y * width + x]!
      const bitOffset = (x % pixelsPerByte) * bitsPerComponent
      packed[rowBase + Math.floor(x / pixelsPerByte)]! |= index << (8 - bitsPerComponent - bitOffset)
    }
  }
  // Palette lookup as a hex string in index order
  let palette = ''
  for (const key of paletteIndex.keys()) {
    palette += key.toString(16).padStart(6, '0')
  }
  return {
    colorSpace: `[/Indexed /DeviceRGB ${colorCount - 1} <${palette}>]`,
    bitsPerComponent,
    compressed: zlibDeflate(packed, 4),
    hasAlpha,
  }
}

/**
 * Builds /ImageMask stencil data when the image has binary alpha (0 or 255)
 * and a single opaque color: 1 bit per pixel, bit 0 = paint (default
 * /Decode [0 1]). Returns null when the image is not a stencil.
 */
function buildStencilMaskData(width: number, height: number, pixels: Uint8Array): { compressed: Uint8Array, color: string } | null {
  const pixelCount = width * height
  if (pixelCount === 0) return null
  let colorKey = -1
  let hasTransparent = false
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4
    const a = pixels[o + 3]!
    if (a === 0) {
      hasTransparent = true
      continue
    }
    if (a !== 255) return null
    const key = (pixels[o]! << 16) | (pixels[o + 1]! << 8) | pixels[o + 2]!
    if (colorKey < 0) colorKey = key
    else if (colorKey !== key) return null
  }
  // Fully transparent or fully opaque single color: not a stencil use case
  if (!hasTransparent || colorKey < 0) return null
  const rowBytes = Math.ceil(width / 8)
  const packed = new Uint8Array(rowBytes * height)
  packed.fill(0xFF)  // bit 1 = do not paint
  for (let y = 0; y < height; y++) {
    const rowBase = y * rowBytes
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! === 255) {
        packed[rowBase + (x >> 3)]! &= ~(0x80 >> (x & 7))  // bit 0 = paint
      }
    }
    // Clear padding bits beyond the row width (keep them "do not paint")
  }
  const hex = function (v: number): string { return v.toString(16).padStart(2, '0') }
  return {
    compressed: zlibDeflate(packed, 4),
    color: '#' + hex((colorKey >> 16) & 0xFF) + hex((colorKey >> 8) & 0xFF) + hex(colorKey & 0xFF),
  }
}

function buildBinaryAlphaMask(width: number, height: number, pixels: Uint8Array): { compressed: Uint8Array } | null {
  const pixelCount = width * height
  let hasTransparent = false
  for (let i = 0; i < pixelCount; i++) {
    const a = pixels[i * 4 + 3]!
    if (a === 0) hasTransparent = true
    else if (a !== 255) return null
  }
  if (!hasTransparent) return null
  const rowBytes = Math.ceil(width / 8)
  const packed = new Uint8Array(rowBytes * height)
  packed.fill(0xFF)
  for (let y = 0; y < height; y++) {
    const rowBase = y * rowBytes
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! === 255) {
        packed[rowBase + (x >> 3)]! &= ~(0x80 >> (x & 7))
      }
    }
  }
  return { compressed: zlibDeflate(packed, 4) }
}

/** Sub-filtered, deflated 8-bit alpha channel for an image /SMask. */
function buildAlphaSmask(width: number, height: number, pixels: Uint8Array): { compressed: Uint8Array, decodeParms: string } {
  const rowLen = 1 + width
  const filtered = new Uint8Array(height * rowLen)
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowLen
    filtered[rowOff] = 1  // filter type = Sub
    const pixRow = y * width
    if (width > 0) {
      filtered[rowOff + 1] = pixels[pixRow * 4 + 3]!
    }
    for (let x = 1; x < width; x++) {
      filtered[rowOff + 1 + x] = (pixels[(pixRow + x) * 4 + 3]! - pixels[(pixRow + x - 1) * 4 + 3]!) & 0xFF
    }
  }
  return {
    compressed: zlibDeflate(filtered, 4),
    decodeParms: `/DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${width} >>`,
  }
}

/** Converts an sRGB colour through the PDF/X output profile's PCS-to-device transform. */
function iccOutputCmyk(
  transform: IccOutputTransform,
  intent: IccRenderingIntent | undefined,
  r: number,
  g: number,
  b: number,
): [number, number, number, number] {
  const components = transform.fromRgb([r, g, b], intent ?? 'RelativeColorimetric')
  if (components.length !== 4) {
    throw new Error(`PDF/X output profile produced ${components.length} components; CMYK requires 4`)
  }
  return [components[0]!, components[1]!, components[2]!, components[3]!]
}

/** Decodes JP2 component samples to RGBA before PDF/X output-profile conversion. */
function jpxImageToRgba(image: JpxImage): { width: number, height: number, pixels: Uint8Array } {
  const colors = image.colorChannels
  if (colors.length !== 3) throw new Error('PDF/X JPX RGB conversion requires exactly three colour channels')
  const sourceProfile = image.colorProfile === null ? null : parseIccProfile(image.colorProfile)
  if (image.colorProfile !== null && sourceProfile === null) {
    throw new Error('PDF/X JPX embedded ICC profile has no supported device-to-PCS transform')
  }
  if (sourceProfile !== null && sourceProfile.components !== colors.length) {
    throw new Error('PDF/X JPX embedded ICC profile component count does not match its colour channels')
  }
  const pixels = new Uint8Array(image.width * image.height * 4)
  const componentCount = image.componentCount
  const toUnit = function (sample: number, component: number): number {
    const depth = image.componentBitDepths[component]!
    const minimum = image.componentSigned[component]! ? -Math.pow(2, depth - 1) : 0
    const maximum = image.componentSigned[component]! ? Math.pow(2, depth - 1) - 1 : Math.pow(2, depth) - 1
    return clamp01((sample - minimum) / (maximum - minimum))
  }
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const values = colors.map(function (component) {
      return toUnit(image.data[pixel * componentCount + component]!, component)
    })
    const alpha = image.alphaChannel === null
      ? 1
      : toUnit(image.data[pixel * componentCount + image.alphaChannel]!, image.alphaChannel)
    if (image.premultipliedAlpha && alpha > 0) {
      for (let component = 0; component < values.length; component++) {
        values[component] = clamp01(values[component]! / alpha)
      }
    }
    let rgb: number[]
    if (sourceProfile !== null) {
      rgb = sourceProfile.toRgb(values)
    } else if (image.colorSpace === 'sycc') {
      const y = values[0]!
      const cb = values[1]! - 0.5
      const cr = values[2]! - 0.5
      rgb = [y + 1.402 * cr, y - 0.344136 * cb - 0.714136 * cr, y + 1.772 * cb]
    } else {
      rgb = values
    }
    const offset = pixel * 4
    pixels[offset] = Math.round(clamp01(rgb[0]!) * 255)
    pixels[offset + 1] = Math.round(clamp01(rgb[1]!) * 255)
    pixels[offset + 2] = Math.round(clamp01(rgb[2]!) * 255)
    pixels[offset + 3] = Math.round(alpha * 255)
  }
  return { width: image.width, height: image.height, pixels }
}

/** Decodes the public pre-filtered RGB image form before PDF/X colour conversion. */
function decodeEncodedRgbImage(data: Uint8Array, params: EncodedImageParams): { width: number, height: number, pixels: Uint8Array } {
  if (params.colors !== 3) throw new Error('PDF/X encoded DeviceRGB image predictor Colors must be 3')
  let decoded: Uint8Array
  if (params.filter === 'FlateDecode') decoded = zlibInflate(data)
  else if (params.filter === 'LZWDecode') {
    decoded = decodeLzw(data, new Map<string, PdfValue>([['EarlyChange', params.earlyChange]]))
  } else if (params.filter === 'ASCIIHexDecode') decoded = decodeAsciiHex(data)
  else if (params.filter === 'ASCII85Decode') decoded = decodeAscii85(data)
  else decoded = decodeRunLength(data)

  if (params.predictor !== 1) {
    if (params.filter !== 'FlateDecode' && params.filter !== 'LZWDecode') {
      throw new Error('PDF image predictors are only valid with FlateDecode or LZWDecode')
    }
    decoded = applyPdfPredictor(decoded, params.predictor, params.colors, params.bitsPerComponent, params.columns)
  }

  const components = 3
  const rowBytes = Math.ceil(params.columns * components * params.bitsPerComponent / 8)
  const expectedLength = rowBytes * params.rows
  if (decoded.length !== expectedLength) {
    throw new Error(`PDF/X encoded DeviceRGB image decoded to ${decoded.length} bytes; expected ${expectedLength}`)
  }
  const decode = params.decode ?? [0, 1, 0, 1, 0, 1]
  if (decode.length !== components * 2) throw new Error('PDF encoded DeviceRGB image Decode must contain six numbers')
  if (params.maskRanges !== null && params.maskRanges.length !== components * 2) {
    throw new Error('PDF encoded DeviceRGB image Mask must contain six integers')
  }
  const maximum = Math.pow(2, params.bitsPerComponent) - 1
  const pixels = new Uint8Array(params.columns * params.rows * 4)
  for (let row = 0; row < params.rows; row++) {
    for (let column = 0; column < params.columns; column++) {
      const pixelOffset = (row * params.columns + column) * 4
      let masked = params.maskRanges !== null
      for (let component = 0; component < components; component++) {
        const componentIndex = column * components + component
        const sample = readImageBits(
          decoded,
          row * rowBytes * 8 + componentIndex * params.bitsPerComponent,
          params.bitsPerComponent,
        )
        const d0 = decode[component * 2]!
        const d1 = decode[component * 2 + 1]!
        pixels[pixelOffset + component] = Math.round(clamp01(d0 + sample / maximum * (d1 - d0)) * 255)
        if (params.maskRanges !== null && (sample < params.maskRanges[component * 2]! || sample > params.maskRanges[component * 2 + 1]!)) {
          masked = false
        }
      }
      pixels[pixelOffset + 3] = masked ? 0 : 255
    }
  }
  return { width: params.columns, height: params.rows, pixels }
}

function readImageBits(data: Uint8Array, bitOffset: number, bitLength: number): number {
  let value = 0
  for (let index = 0; index < bitLength; index++) {
    const bit = bitOffset + index
    value = value * 2 + ((data[bit >> 3]! >> (7 - (bit & 7))) & 1)
  }
  return value
}

/** Encodes a spot color name as a PDF name object (#xx escapes per spec). */
function encodePdfName(name: string): string {
  return '/' + encodePdfNameBody(name)
}

function encodePdfNameBody(name: string): string {
  validateUnicodeScalars(name, 'PDF name')
  const bytes = new TextEncoder().encode(name)
  let result = ''
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!
    if (byte === 0) throw new Error('PDF name must not contain null')
    const character = String.fromCharCode(byte)
    if (byte >= 0x21 && byte <= 0x7E && !'()<>[]{}/%#'.includes(character)) result += character
    else result += '#' + byte.toString(16).toUpperCase().padStart(2, '0')
  }
  return result
}

function parseColor(hex: string): [number, number, number] {
  if (isPrintColor(hex)) {
    // Contexts without a native CMYK path (gradient stops, mesh vertex
    // colors) use the same RGB approximation as the display backends
    const parsed = parseTemplateColor(hex)
    return [parsed.r, parsed.g, parsed.b]
  }
  const h = hex.startsWith('#') ? hex.slice(1) : hex
  if (h.length === 3) {
    return [
      parseInt(h[0]! + h[0]!, 16) / 255,
      parseInt(h[1]! + h[1]!, 16) / 255,
      parseInt(h[2]! + h[2]!, 16) / 255,
    ]
  }
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ]
}

interface PdfTextPaint {
  mode: 'fill' | 'stroke' | 'fillStroke'
  fillColor: string
  strokeColor: string
  strokeWidth: number
}

function pdfTextPaint(color: string, options?: TextDrawOptions): PdfTextPaint {
  const mode = options?.textPaintMode ?? 'fill'
  const strokeWidth = options?.textStrokeWidth ?? 1
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0) throw new Error('Text stroke width must be a finite non-negative number')
  return {
    mode,
    fillColor: color,
    strokeColor: options?.textStrokeColor ?? color,
    strokeWidth,
  }
}

function rgb01ToHex(r: number, g: number, b: number): string {
  const rr = Math.max(0, Math.min(255, Math.round(r * 255))).toString(16).padStart(2, '0')
  const gg = Math.max(0, Math.min(255, Math.round(g * 255))).toString(16).padStart(2, '0')
  const bb = Math.max(0, Math.min(255, Math.round(b * 255))).toString(16).padStart(2, '0')
  return `#${rr}${gg}${bb}`
}

function multiplyPdfMatrix(a: PdfMatrix, b: PdfMatrix): PdfMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function invertPdfMatrix(matrix: PdfMatrix): PdfMatrix {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  if (determinant === 0) throw new Error('PDF Form matrix must be invertible')
  const a = matrix[3] / determinant
  const b = -matrix[1] / determinant
  const c = -matrix[2] / determinant
  const d = matrix[0] / determinant
  return [a, b, c, d, -(a * matrix[4] + c * matrix[5]), -(b * matrix[4] + d * matrix[5])]
}

function transformPointByPdfMatrix(x: number, y: number, m: PdfMatrix): { x: number, y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  }
}

function transformGradientPaintForPattern(paint: GradientPaint, ctm: PdfMatrix): GradientPaint {
  if (paint.type === 'linear-gradient') {
    const p1 = transformPointByPdfMatrix(paint.x1, paint.y1, ctm)
    const p2 = transformPointByPdfMatrix(paint.x2, paint.y2, ctm)
    return {
      ...paint,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      pdfShading: transformGradientShadingMetadata(paint.pdfShading, ctm),
    }
  }

  const center = transformPointByPdfMatrix(paint.cx, paint.cy, ctm)
  const focus = transformPointByPdfMatrix(paint.fx ?? paint.cx, paint.fy ?? paint.cy, ctm)
  const edge = transformPointByPdfMatrix(paint.cx + paint.r, paint.cy, ctm)
  const frEdge = transformPointByPdfMatrix((paint.fx ?? paint.cx) + (paint.fr ?? 0), paint.fy ?? paint.cy, ctm)
  return {
    ...paint,
    cx: center.x,
    cy: center.y,
    fx: focus.x,
    fy: focus.y,
    r: Math.hypot(edge.x - center.x, edge.y - center.y),
    fr: Math.hypot(frEdge.x - focus.x, frEdge.y - focus.y),
    pdfShading: transformGradientShadingMetadata(paint.pdfShading, ctm),
  }
}

function transformGradientShadingMetadata(
  metadata: import('../types/template.js').PdfAxialRadialShadingDef | undefined,
  matrix: PdfMatrix,
): import('../types/template.js').PdfAxialRadialShadingDef | undefined {
  if (metadata === undefined) return undefined
  const native = metadata.native === undefined ? undefined : {
    ...metadata.native,
    patternMatrix: multiplyPdfMatrix(matrix, metadata.native.patternMatrix),
  }
  if (metadata.bbox === undefined) return { ...metadata, native }
  const b = metadata.bbox
  const points = [
    transformPointByPdfMatrix(b[0], b[1], matrix), transformPointByPdfMatrix(b[2], b[1], matrix),
    transformPointByPdfMatrix(b[2], b[3], matrix), transformPointByPdfMatrix(b[0], b[3], matrix),
  ]
  return {
    ...metadata,
    native,
    bbox: [
      Math.min(...points.map(function (point) { return point.x })),
      Math.min(...points.map(function (point) { return point.y })),
      Math.max(...points.map(function (point) { return point.x })),
      Math.max(...points.map(function (point) { return point.y })),
    ],
  }
}

function meshPaintKey(paint: MeshGradientPaint): string {
  // FNV-1a over the geometry and colors: cheap and collision-safe enough
  // for per-document pattern dedup
  let hash = 0x811c9dc5
  const mix = function (value: number): void {
    const scaled = Math.round(value * 100)
    hash ^= scaled & 0xff
    hash = Math.imul(hash, 0x01000193)
    hash ^= (scaled >> 8) & 0xff
    hash = Math.imul(hash, 0x01000193)
    hash ^= (scaled >> 16) & 0xff
    hash = Math.imul(hash, 0x01000193)
  }
  const mixString = function (value: string): void {
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  const native = paint.pdfShading?.native
  if (native !== undefined) {
    mix(native.shadingType)
    mix(native.bitsPerCoordinate)
    mix(native.bitsPerComponent)
    mix(native.bitsPerFlag ?? 0)
    mix(native.verticesPerRow ?? 0)
    for (let i = 0; i < native.decode.length; i++) mix(native.decode[i]!)
    for (let i = 0; i < native.matrix.length; i++) mix(native.matrix[i]!)
    for (let i = 0; i < native.data.length; i++) {
      hash ^= native.data[i]!
      hash = Math.imul(hash, 0x01000193)
    }
    return `mn|${native.shadingType}|${native.data.length}|${hash >>> 0}`
  }
  for (let i = 0; i < paint.patches.length; i++) {
    const patch = paint.patches[i]!
    for (let j = 0; j < patch.points.length; j++) mix(patch.points[j]!)
    for (let j = 0; j < 4; j++) mixString(patch.colors[j]!)
  }
  for (let i = 0; i < paint.triangles.length; i++) {
    const triangle = paint.triangles[i]!
    for (let j = 0; j < triangle.points.length; j++) mix(triangle.points[j]!)
    for (let j = 0; j < 3; j++) mixString(triangle.colors[j]!)
  }
  if (paint.packedPatches !== undefined) {
    for (let i = 0; i < paint.packedPatches.points.length; i++) mix(paint.packedPatches.points[i]!)
    for (let i = 0; i < paint.packedPatches.colors.length; i++) mix(paint.packedPatches.colors[i]!)
  }
  if (paint.packedTriangles !== undefined) {
    for (let i = 0; i < paint.packedTriangles.points.length; i++) mix(paint.packedTriangles.points[i]!)
    for (let i = 0; i < paint.packedTriangles.colors.length; i++) mix(paint.packedTriangles.colors[i]!)
  }
  return `m|${paint.patches.length}|${paint.triangles.length}|${paint.packedPatches?.points.length ?? 0}|${paint.packedTriangles?.points.length ?? 0}|${hash >>> 0}`
}

function tilingPaintKey(paint: TilingPatternPaint, matrix: [number, number, number, number, number, number]): string {
  let hash = 0x811c9dc5
  const mix = function (value: number): void {
    // 24-bit span (matching meshPaintKey): matrix translations reach full page
    // coordinates (scaled*100 exceeds 16 bits), so a 16-bit mix collides two
    // patterns positioned an exact 655.36pt multiple apart and reuses the wrong
    // /Matrix.
    const scaled = Math.round(value * 100)
    hash ^= scaled & 0xff
    hash = Math.imul(hash, 0x01000193)
    hash ^= (scaled >> 8) & 0xff
    hash = Math.imul(hash, 0x01000193)
    hash ^= (scaled >> 16) & 0xff
    hash = Math.imul(hash, 0x01000193)
  }
  for (let i = 0; i < 6; i++) mix(matrix[i]!)
  for (let i = 0; i < 4; i++) mix(paint.bbox[i]!)
  mix(paint.xStep)
  mix(paint.yStep)
  mix(paint.tilingType ?? 1)
  const paintType = paint.paintType ?? 'colored'
  for (let i = 0; i < paintType.length; i++) {
    hash ^= paintType.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const color = paint.color ?? ''
  for (let i = 0; i < color.length; i++) {
    hash ^= color.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  for (let g = 0; g < paint.graphics.length; g++) {
    const graphic = paint.graphics[g]!
    if (graphic.kind === 'text') {
      mix(graphic.x); mix(graphic.y); mix(graphic.fontSize)
      const value = graphic.text + '|' + graphic.fontId + '|' + graphic.color
      for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193) }
      continue
    }
    if (graphic.kind === 'image') {
      mix(graphic.x)
      mix(graphic.y)
      mix(graphic.width)
      mix(graphic.height)
      for (let i = 0; i < graphic.imageId.length; i++) {
        hash ^= graphic.imageId.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
      }
      continue
    }
    if (graphic.kind === 'group') {
      const value = JSON.stringify(graphic)
      for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193) }
      continue
    }
    for (let i = 0; i < graphic.coords.length; i++) mix(graphic.coords[i]!)
    for (let i = 0; i < graphic.commands.length; i++) mix(graphic.commands[i]!)
    mix(graphic.strokeWidth ?? 1)
    const paints = JSON.stringify([graphic.fill, graphic.stroke, graphic.fillRule])
    for (let i = 0; i < paints.length; i++) {
      hash ^= paints.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return `t|${paint.graphics.length}|${hash >>> 0}`
}

/**
 * Encodes a mesh paint (already in default PDF space) into packed shading
 * streams: one ShadingType 4 stream for the triangles and one ShadingType 7
 * stream for the tensor patches. Point data uses 32-bit coordinates scaled
 * into the Decode range; colors are 8-bit DeviceRGB.
 *
 * Tensor patch data order per ISO 32000 8.7.4.5.7 (flag 0): the 12 boundary
 * points counterclockwise from p00 (p00 p01 p02 p03 p13 p23 p33 p32 p31 p30
 * p20 p10), then the 4 internal points (p11 p12 p22 p21), then the corner
 * colors c(p00) c(p03) c(p33) c(p30). In PDF/X mode every generated vertex
 * colour is converted through the embedded output profile.
 */
function isPdfXNativeShadingColorSpace(colorSpace: PdfShadingColorSpaceDef): boolean {
  if (colorSpace.kind === 'cmyk') return true
  if (colorSpace.kind === 'separation' || colorSpace.kind === 'deviceN') {
    return colorSpace.alternate.kind === 'cmyk'
  }
  return false
}

function encodeMeshShadingDefs(
  paint: MeshGradientPaint,
  transform: IccOutputTransform | undefined,
  intent: IccRenderingIntent | undefined,
): (MeshShadingDef | RetainedFunctionShadingDefPdf)[] {
  const cmyk = transform !== undefined
  const nativeFunction = paint.pdfShading?.nativeFunction
  if (nativeFunction !== undefined && (transform === undefined || isPdfXNativeShadingColorSpace(nativeFunction.colorSpace))) {
    return [{
      type: 'retained-function',
      domain: nativeFunction.domain,
      shadingMatrix: nativeFunction.matrix,
      patternMatrix: nativeFunction.patternMatrix,
      functions: nativeFunction.functions,
      colorSpace: nativeFunction.colorSpace,
      background: nativeFunction.background,
      bbox: nativeFunction.bbox,
      antiAlias: nativeFunction.antiAlias,
    }]
  }
  const native = paint.pdfShading?.native
  if (native !== undefined && (transform === undefined || isPdfXNativeShadingColorSpace(native.colorSpace))) {
    return [{
      type: 'mesh',
      shadingType: native.shadingType,
      verticesPerRow: native.verticesPerRow,
      data: native.data.slice(),
      decode: native.decode.slice(),
      cmyk: false,
      bitsPerCoordinate: native.bitsPerCoordinate,
      bitsPerComponent: native.bitsPerComponent,
      bitsPerFlag: native.bitsPerFlag,
      functions: native.functions,
      colorSpace: native.colorSpace,
      background: native.background,
      bbox: native.bbox,
      antiAlias: native.antiAlias,
      matrix: native.matrix,
      pdfShading: paint.pdfShading,
    }]
  }
  paint = materializePackedMeshPaint(paint)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const scan = function (points: number[]): void {
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i]!)
      maxX = Math.max(maxX, points[i]!)
      minY = Math.min(minY, points[i + 1]!)
      maxY = Math.max(maxY, points[i + 1]!)
    }
  }
  for (let i = 0; i < paint.patches.length; i++) scan(paint.patches[i]!.points)
  for (let i = 0; i < paint.triangles.length; i++) scan(paint.triangles[i]!.points)
  if (paint.lattice !== undefined) scan(paint.lattice.points)
  if (minX === Infinity) return []
  if (maxX - minX < 1e-6) maxX = minX + 1
  if (maxY - minY < 1e-6) maxY = minY + 1
  const decode = cmyk ? [minX, maxX, minY, maxY, 0, 1, 0, 1, 0, 1, 0, 1] : [minX, maxX, minY, maxY, 0, 1, 0, 1, 0, 1]

  const scaleX = function (x: number): number {
    return Math.max(0, Math.min(0xffffffff, Math.round((x - minX) / (maxX - minX) * 0xffffffff)))
  }
  const scaleY = function (y: number): number {
    return Math.max(0, Math.min(0xffffffff, Math.round((y - minY) / (maxY - minY) * 0xffffffff)))
  }
  const pushU32 = function (bytes: number[], value: number): void {
    bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
  }
  const pushColor = function (bytes: number[], color: string): void {
    if (transform !== undefined) {
      const parsed = parseTemplateColor(color)
      if (parsed.spotName !== null || parsed.deviceN !== null) {
        throw new Error('PDF/X generated mesh shadings require one explicit Separation or DeviceN color space for spot colors')
      }
      if (parsed.cmyk !== null) {
        bytes.push(
          Math.round(parsed.cmyk[0] * 255),
          Math.round(parsed.cmyk[1] * 255),
          Math.round(parsed.cmyk[2] * 255),
          Math.round(parsed.cmyk[3] * 255),
        )
        return
      }
      const [cc, mm, yy, kk] = iccOutputCmyk(transform, intent, parsed.r, parsed.g, parsed.b)
      bytes.push(Math.round(cc * 255), Math.round(mm * 255), Math.round(yy * 255), Math.round(kk * 255))
      return
    }
    const [r, g, b] = parseColor(color)
    bytes.push(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
  }

  const defs: MeshShadingDef[] = []
  if (paint.lattice !== undefined && paint.lattice.points.length >= paint.lattice.columns * 4) {
    // Lattice-form Gouraud mesh: ShadingType 5, vertices row by row
    const lattice = paint.lattice
    const bytes: number[] = []
    const vertexCount = lattice.points.length / 2
    for (let v = 0; v < vertexCount; v++) {
      pushU32(bytes, scaleX(lattice.points[v * 2]!))
      pushU32(bytes, scaleY(lattice.points[v * 2 + 1]!))
      pushColor(bytes, lattice.colors[v]!)
    }
    defs.push({ type: 'mesh', shadingType: 5, verticesPerRow: lattice.columns, data: new Uint8Array(bytes), decode, cmyk })
  }
  if (paint.triangles.length > 0) {
    const bytes: number[] = []
    for (let t = 0; t < paint.triangles.length; t++) {
      const triangle = paint.triangles[t]!
      for (let v = 0; v < 3; v++) {
        bytes.push(0)
        pushU32(bytes, scaleX(triangle.points[v * 2]!))
        pushU32(bytes, scaleY(triangle.points[v * 2 + 1]!))
        pushColor(bytes, triangle.colors[v]!)
      }
    }
    defs.push({ type: 'mesh', shadingType: 4, data: new Uint8Array(bytes), decode, cmyk })
  }
  if (paint.patches.length > 0) {
    // Boundary points in the spec data order d1..d12 (ISO 32000 tables 84-85),
    // followed by the tensor-only interior points p11 p12 p22 p21
    const ORDER = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4, 5, 6, 10, 9]
    // Patches whose interior equals the Coons derivation emit as ShadingType 6
    // (12 points); true tensor patches emit as ShadingType 7 (16 points)
    const coonsBytes: number[] = []
    const tensorBytes: number[] = []
    for (let pi = 0; pi < paint.patches.length; pi++) {
      const patch = paint.patches[pi]!
      const bytes = isCoonsEquivalentPatch(patch.points) ? coonsBytes : tensorBytes
      const pointCount = bytes === coonsBytes ? 12 : 16
      bytes.push(0)
      for (let k = 0; k < pointCount; k++) {
        const index = ORDER[k]! * 2
        pushU32(bytes, scaleX(patch.points[index]!))
        pushU32(bytes, scaleY(patch.points[index + 1]!))
      }
      pushColor(bytes, patch.colors[0]!)
      pushColor(bytes, patch.colors[1]!)
      pushColor(bytes, patch.colors[2]!)
      pushColor(bytes, patch.colors[3]!)
    }
    if (coonsBytes.length > 0) {
      defs.push({ type: 'mesh', shadingType: 6, data: new Uint8Array(coonsBytes), decode, cmyk })
    }
    if (tensorBytes.length > 0) {
      defs.push({ type: 'mesh', shadingType: 7, data: new Uint8Array(tensorBytes), decode, cmyk })
    }
  }
  for (let i = 0; i < defs.length; i++) defs[i]!.pdfShading = paint.pdfShading
  return defs
}

function materializePackedMeshPaint(paint: MeshGradientPaint): MeshGradientPaint {
  if (paint.packedPatches === undefined && paint.packedTriangles === undefined) return paint
  const patches = paint.patches.slice()
  const triangles = paint.triangles.slice()
  const packedPatches = paint.packedPatches
  if (packedPatches !== undefined) {
    const count = Math.floor(packedPatches.points.length / 32)
    for (let i = 0; i < count; i++) {
      patches.push({
        points: Array.from(packedPatches.points.subarray(i * 32, i * 32 + 32)),
        colors: [
          packedMeshColor(packedPatches.colors[i * 4]!), packedMeshColor(packedPatches.colors[i * 4 + 1]!),
          packedMeshColor(packedPatches.colors[i * 4 + 2]!), packedMeshColor(packedPatches.colors[i * 4 + 3]!),
        ],
      })
    }
  }
  const packedTriangles = paint.packedTriangles
  if (packedTriangles !== undefined) {
    const count = Math.floor(packedTriangles.points.length / 6)
    for (let i = 0; i < count; i++) {
      triangles.push({
        points: Array.from(packedTriangles.points.subarray(i * 6, i * 6 + 6)),
        colors: [
          packedMeshColor(packedTriangles.colors[i * 3]!), packedMeshColor(packedTriangles.colors[i * 3 + 1]!),
          packedMeshColor(packedTriangles.colors[i * 3 + 2]!),
        ],
      })
    }
  }
  return { ...paint, patches, triangles, packedPatches: undefined, packedTriangles: undefined }
}

function packedMeshColor(value: number): string {
  return '#' + (value & 0xffffff).toString(16).padStart(6, '0')
}

/**
 * True when the patch interior (p11 p12 p21 p22) matches the Coons
 * derivation from its boundary, i.e. the patch carries no extra tensor
 * information and ShadingType 6 encodes it losslessly.
 */
function isCoonsEquivalentPatch(points: number[]): boolean {
  const grid: [number, number][] = []
  for (let i = 0; i < 16; i++) grid.push([points[i * 2]!, points[i * 2 + 1]!])
  const interior = coonsInteriorPoints(grid)
  // grid row-major indices of p11 p12 p21 p22
  const indices = [5, 6, 9, 10]
  // Tolerance relative to the patch extent: the 32-bit coordinate encoding
  // quantizes far finer than this, so equality here is visually exact
  let extent = 0
  for (let i = 1; i < 16; i++) {
    extent = Math.max(extent, Math.abs(grid[i]![0] - grid[0]![0]), Math.abs(grid[i]![1] - grid[0]![1]))
  }
  const tolerance = Math.max(1e-6, extent * 1e-6)
  for (let k = 0; k < 4; k++) {
    const actual = grid[indices[k]!]!
    const derived = interior[k]!
    if (Math.abs(actual[0] - derived[0]) > tolerance || Math.abs(actual[1] - derived[1]) > tolerance) {
      return false
    }
  }
  return true
}

function gradientPaintKey(paint: GradientPaint): string {
  const spread = paint.spreadMethod ?? 'pad'
  if (paint.type === 'linear-gradient') {
    return [
      'l',
      pn(paint.x1), pn(paint.y1), pn(paint.x2), pn(paint.y2),
      spread, JSON.stringify(paint.pdfShading),
      ...paint.stops.map(s => `${pn(s.offset)}:${s.color}:${pn(s.opacity ?? 1)}`),
    ].join('|')
  }
  return [
    'r',
    pn(paint.cx), pn(paint.cy), pn(paint.r),
    pn(paint.fx ?? paint.cx), pn(paint.fy ?? paint.cy), pn(paint.fr ?? 0),
    spread, JSON.stringify(paint.pdfShading),
    ...paint.stops.map(s => `${pn(s.offset)}:${s.color}:${pn(s.opacity ?? 1)}`),
  ].join('|')
}

function gradientPaintToShadingDef(paint: GradientPaint): ShadingDef {
  if (paint.pdfShading !== undefined) {
    const native = paint.pdfShading.native
    return {
      type: paint.type === 'linear-gradient' ? 'axial' : 'radial',
      coords: native?.coords ?? (paint.type === 'linear-gradient'
        ? [paint.x1, paint.y1, paint.x2, paint.y2]
        : [paint.fx ?? paint.cx, paint.fy ?? paint.cy, Math.max(0, paint.fr ?? 0), paint.cx, paint.cy, Math.max(0, paint.r)]),
      stops: normalizeGradientStopsForPdf(paint.stops),
      extend: [paint.pdfShading.extend[0], paint.pdfShading.extend[1]],
      pdfShading: paint.pdfShading,
      matrix: native?.patternMatrix,
    }
  }
  const spread = paint.spreadMethod ?? 'pad'
  const mode = spread === 'repeat' ? 1 : spread === 'reflect' ? 2 : 0
  // spreadMethod=repeat/reflect is theoretically infinite extension. PDF Shading approximates it
  // with a finite length, so increase the repetition count to reduce truncation differences in the visible range.
  const N = mode === 0 ? 0 : 64

  let stops = paint.stops
  if (paint.type === 'linear-gradient') {
    let x1 = paint.x1
    let y1 = paint.y1
    let x2 = paint.x2
    let y2 = paint.y2
    if (mode !== 0 && stops.length >= 2) {
      stops = extendGradientStopsForPdf(stops, mode, N)
      const dx = x2 - x1
      const dy = y2 - y1
      x1 -= N * dx
      y1 -= N * dy
      x2 += N * dx
      y2 += N * dy
    }
    return {
      type: 'axial',
      coords: [x1, y1, x2, y2],
      stops: normalizeGradientStopsForPdf(stops),
      extend: [true, true],
    }
  }
  let fx = paint.fx ?? paint.cx
  let fy = paint.fy ?? paint.cy
  let fr = Math.max(0, paint.fr ?? 0)
  let cx = paint.cx
  let cy = paint.cy
  let r = Math.max(0, paint.r)
  if (mode !== 0 && stops.length >= 2) {
    stops = extendGradientStopsForPdf(stops, mode, N)
    const dx = cx - fx
    const dy = cy - fy
    const dr = r - fr
    fx -= N * dx
    fy -= N * dy
    fr = Math.max(0, fr - N * dr)
    cx += N * dx
    cy += N * dy
    r = Math.max(0, r + N * dr)
  }
  return {
    type: 'radial',
    coords: [
      fx, fy, fr,
      cx, cy, r,
    ],
    stops: normalizeGradientStopsForPdf(stops),
    extend: [true, true],
  }
}

function extractUniformGradientOpacity(paint: GradientPaint): number | null {
  if (paint.stops.length === 0) return null
  let base = clamp01(paint.stops[0]!.opacity ?? 1)
  for (let i = 1; i < paint.stops.length; i++) {
    const o = clamp01(paint.stops[i]!.opacity ?? 1)
    if (Math.abs(o - base) > 1e-6) return null
  }
  return base
}

function extendGradientStopsForPdf(stops: GradientStop[], mode: 1 | 2, N: number): GradientStop[] {
  const resolved: ResolvedColorStop[] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!
    const [r, g, b] = parseColor(s.color)
    resolved.push({
      offset: clamp01(s.offset),
      color: {
        r,
        g,
        b,
        a: clamp01(s.opacity ?? 1),
      },
    })
  }
  const ext = extendGradientStops(resolved, mode, N)
  const out: GradientStop[] = []
  for (let i = 0; i < ext.length; i++) {
    const s = ext[i]!
    out.push({
      offset: clamp01(s.offset),
      color: rgb01ToHex(s.color.r, s.color.g, s.color.b),
      opacity: clamp01(s.color.a),
    })
  }
  return out
}

function normalizeGradientStopsForPdf(stops: GradientStop[]): PdfGradientStop[] {
  const base: PdfGradientStop[] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!
    if (!Number.isFinite(s.offset)) continue
    const parsed = parseTemplateColor(s.color)
    const rawOffset = clamp01(s.offset)
    const offset = base.length > 0
      ? Math.max(rawOffset, base[base.length - 1]!.offset)
      : rawOffset
    base.push({
      offset,
      r: parsed.r,
      g: parsed.g,
      b: parsed.b,
      ...(parsed.cmyk === null ? {} : { cmyk: parsed.cmyk.slice() as [number, number, number, number] }),
      ...((parsed.spotName === null && parsed.deviceN === null) ? {} : { specialColor: true }),
    })
  }
  if (base.length === 0) {
    return [{ offset: 0, r: 0, g: 0, b: 0 }]
  }

  // Collapse runs of stops that share an offset. A run with a single colour is
  // redundant and keeps one stop; a run whose first and last colours differ is
  // a hard colour stop (e.g. SVG `red 50%, blue 50%`) and must keep both so the
  // stitching function emits a zero-width segment for the sharp transition.
  // Intermediate colours inside a run render at zero width and are dropped.
  const merged: PdfGradientStop[] = []
  let i = 0
  while (i < base.length) {
    let j = i
    while (j + 1 < base.length && Math.abs(base[j + 1]!.offset - base[i]!.offset) <= 1e-9) j++
    const first = base[i]!
    const last = base[j]!
    merged.push(first)
    if (j > i && !samePdfGradientStopColor(first, last)) {
      merged.push(last)
    }
    i = j + 1
  }

  if (merged.length === 1) {
    const only = merged[0]!
    return [
      { ...only, offset: 0 },
      { ...only, offset: 1 },
    ]
  }

  if (merged[0]!.offset > 0) {
    const first = merged[0]!
    merged.unshift({ ...first, offset: 0 })
  }
  if (merged[merged.length - 1]!.offset < 1) {
    const last = merged[merged.length - 1]!
    merged.push({ ...last, offset: 1 })
  }
  return merged
}

function samePdfGradientStopColor(first: PdfGradientStop, second: PdfGradientStop): boolean {
  if (first.r !== second.r || first.g !== second.g || first.b !== second.b
    || first.specialColor !== second.specialColor) return false
  if (first.cmyk === undefined || second.cmyk === undefined) return first.cmyk === second.cmyk
  return first.cmyk[0] === second.cmyk[0] && first.cmyk[1] === second.cmyk[1]
    && first.cmyk[2] === second.cmyk[2] && first.cmyk[3] === second.cmyk[3]
}

function normalizeDashArray(dash: number[] | undefined): number[] | undefined {
  if (!dash || dash.length === 0) return undefined
  const out = dash.filter(v => Number.isFinite(v) && v > 0)
  return out.length > 0 ? out : undefined
}

function pdfBlendModeFromSvg(mode: BlendMode): string {
  switch (mode) {
    case 'multiply': return 'Multiply'
    case 'screen': return 'Screen'
    case 'overlay': return 'Overlay'
    case 'darken': return 'Darken'
    case 'lighten': return 'Lighten'
    case 'color-dodge': return 'ColorDodge'
    case 'color-burn': return 'ColorBurn'
    case 'hard-light': return 'HardLight'
    case 'soft-light': return 'SoftLight'
    case 'difference': return 'Difference'
    case 'exclusion': return 'Exclusion'
    case 'hue': return 'Hue'
    case 'saturation': return 'Saturation'
    case 'color': return 'Color'
    case 'luminosity': return 'Luminosity'
    default: return 'Normal'
  }
}

function pdfLineCap(cap: ShapeDrawOptions['strokeLinecap']): 0 | 1 | 2 {
  if (cap === 'round') return 1
  if (cap === 'square') return 2
  return 0
}

function pdfLineJoin(join: ShapeDrawOptions['strokeLinejoin']): 0 | 1 | 2 {
  if (join === 'round') return 1
  if (join === 'bevel') return 2
  return 0
}

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

function hashBytesFNV1a(data: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function imageAffineToYDown(
  a: number, b: number, c: number, d: number, e: number, f: number,
): { a: number, b: number, c: number, d: number, e: number, f: number } {
  // M(y-up) * F(y-down->y-up), F = [1 0 0; 0 -1 1; 0 0 1]
  return {
    a,
    b,
    c: -c,
    d: -d,
    e: c + e,
    f: d + f,
  }
}

/** Painting operator for fill/stroke */
function paintOp(fill: boolean, stroke: boolean, fillRule: 'nonzero' | 'evenodd' = 'nonzero'): string {
  const evenOdd = fillRule === 'evenodd'
  if (fill && stroke) return evenOdd ? 'B*' : 'B'
  if (fill) return evenOdd ? 'f*' : 'f'
  if (stroke) return 'S'
  return 'n'
}

/** Generate a 6-letter subset prefix (A-Z) */
function generateSubsetPrefix(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const random = randomBytes(6)
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars[random[i]! % chars.length]
  }
  return result
}

// Escapes a string for use inside a PDF Name token (§7.3.5). The font's
// PostScript name is embedded into /FontName and /BaseFont; without escaping,
// a crafted name containing spaces, delimiters or "/" would break out of the
// Name token and inject structure into the FontDescriptor/CIDFont dictionaries.
function escapePdfNameBody(name: string): string {
  return encodePdfNameBody(name)
}

function pdfFontStretchName(widthClass: number): string {
  const names = [
    'UltraCondensed', 'ExtraCondensed', 'Condensed', 'SemiCondensed', 'Normal',
    'SemiExpanded', 'Expanded', 'ExtraExpanded', 'UltraExpanded',
  ]
  const index = Math.max(1, Math.min(9, Math.round(widthClass))) - 1
  return names[index]!
}

/** Build the ToUnicode CMap string (based on new GIDs) */
function buildToUnicodeCMap(
  cpMap: Map<number, number>,
  glyphSourceTexts: Map<number, string> | undefined,
  oldToNewGid: Map<number, number>,
): string {
  // Reverse map: new GID → source text
  const gidToUnicode = new Map<number, string>()
  for (const [cp, oldGid] of cpMap) {
    const newGid = oldToNewGid.get(oldGid) ?? oldGid
    // GID 0 is .notdef: it has no Unicode meaning, and every character the font
    // lacks maps to it. Mapping it to the first such character would make every
    // OTHER missing character extract as that one wrong character, so it is left
    // out of the CMap (missing characters then extract as nothing, not garbage).
    if (newGid === 0) continue
    // Multiple codepoints may map to the same GID; use the first one
    if (!gidToUnicode.has(newGid)) {
      gidToUnicode.set(newGid, String.fromCodePoint(cp))
    }
  }
  // Shaped glyphs (ligatures, vertical alternates) map back to their source text
  if (glyphSourceTexts) {
    for (const [oldGid, srcText] of glyphSourceTexts) {
      const newGid = oldToNewGid.get(oldGid) ?? oldGid
      if (newGid === 0) continue
      if (!gidToUnicode.has(newGid)) {
        gidToUnicode.set(newGid, srcText)
      }
    }
  }

  const entries = [...gidToUnicode.entries()].sort((a, b) => a[0] - b[0])

  const lines: string[] = []
  lines.push('/CIDInit /ProcSet findresource begin')
  lines.push('12 dict begin')
  lines.push('begincmap')
  lines.push('/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def')
  lines.push('/CMapName /Adobe-Identity-UCS def')
  lines.push('/CMapType 2 def')
  lines.push('1 begincodespacerange')
  lines.push('<0000> <FFFF>')
  lines.push('endcodespacerange')

  // bfchar entries (at most 100 per batch)
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100)
    lines.push(`${batch.length} beginbfchar`)
    for (const [gid, srcText] of batch) {
      const gidHex = gid.toString(16).padStart(4, '0').toUpperCase()
      // Emit UTF-16BE code units (surrogate pairs and ligature sources included)
      let cpHex = ''
      for (let ci = 0; ci < srcText.length; ci++) {
        cpHex += srcText.charCodeAt(ci).toString(16).padStart(4, '0').toUpperCase()
      }
      lines.push(`<${gidHex}> <${cpHex}>`)
    }
    lines.push('endbfchar')
  }

  lines.push('endcmap')
  lines.push('CMapName currentdict /CMap defineresource pop')
  lines.push('end')
  lines.push('end')

  return lines.join('\n')
}

// ─── PDF outline (bookmark) tree construction ───

interface OutlineNode {
  id: number
  children: OutlineNode[]
}

/**
 * Build the PDF outline tree from bookmark entries and write it out.
 * The return value is the array of top-level outline nodes.
 */
function buildOutlineTree(
  entries: BookmarkEntry[],
  pageIds: number[],
  pageDataList: PageData[],
  w: PdfWriter,
  alloc: () => number,
  outlinesId: number,
  actionPdf: (action: PdfActionDef) => string,
): OutlineNode[] {
  if (entries.length === 0) return []

  // Build the tree structure from the flat entries
  interface TempNode {
    entry: BookmarkEntry
    id: number
    children: TempNode[]
    parent: TempNode | null
  }

  const topLevel: TempNode[] = []
  const stack: TempNode[] = []

  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei]!
    const node: TempNode = {
      entry,
      id: alloc(),
      children: [],
      parent: null,
    }

    // Remove stack entries at or above the level.
    while (stack.length > 0 && stack[stack.length - 1]!.entry.level >= entry.level) {
      stack.pop()
    }

    if (stack.length > 0) {
      const parent = stack[stack.length - 1]!
      node.parent = parent
      parent.children.push(node)
    } else {
      topLevel.push(node)
    }

    stack.push(node)
  }

  // Write PDF objects recursively.
  function writeNode(
    node: TempNode,
    parentId: number,
    prev: TempNode | null,
    next: TempNode | null,
  ): OutlineNode {
    const pageIdx = node.entry.pageIndex
    const destPageId = pageIdx < pageIds.length ? pageIds[pageIdx]! : pageIds[pageIds.length - 1]!
    const pageH = pageDataList[pageIdx]?.height ?? pageDataList[pageDataList.length - 1]?.height ?? 842
    const destY = pageH - node.entry.y

    if (node.entry.action !== undefined && node.entry.destination !== undefined) {
      throw new Error('PDF outline action and destination are mutually exclusive')
    }
    const target = node.entry.action !== undefined
      ? `/A ${actionPdf(node.entry.action)}`
      : node.entry.destination !== undefined
        ? `/Dest ${buildPdfDestination(node.entry.destination, pageIds)}`
        : `/Dest [${destPageId} 0 R /XYZ 0 ${pn(destY)} null]`
    const dict: string[] = [
      '/Type /Outline',
      `/Title (${pdfEscapeString(node.entry.label)})`,
      `/Parent ${parentId} 0 R`,
      target,
    ]

    if (prev) dict.push(`/Prev ${prev.id} 0 R`)
    if (next) dict.push(`/Next ${next.id} 0 R`)

    const childResults: OutlineNode[] = []
    if (node.children.length > 0) {
      dict.push(`/First ${node.children[0]!.id} 0 R`)
      dict.push(`/Last ${node.children[node.children.length - 1]!.id} 0 R`)
      dict.push(`/Count ${countTempNodes(node.children)}`)
    }

    w.writeDeferredDict(node.id, dict)

    // Write child nodes.
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!
      const cp = i > 0 ? node.children[i - 1]! : null
      const cn = i < node.children.length - 1 ? node.children[i + 1]! : null
      childResults.push(writeNode(child, node.id, cp, cn))
    }

    return { id: node.id, children: childResults }
  }

  const results: OutlineNode[] = []
  for (let i = 0; i < topLevel.length; i++) {
    const node = topLevel[i]!
    const prev = i > 0 ? topLevel[i - 1]! : null
    const next = i < topLevel.length - 1 ? topLevel[i + 1]! : null
    results.push(writeNode(node, outlinesId, prev, next))
  }

  return results
}

function countTempNodes(nodes: { children: { children: any[] }[] }[]): number {
  let count = 0
  for (let i = 0; i < nodes.length; i++) {
    count++
    count += countTempNodes(nodes[i]!.children)
  }
  return count
}

function countOutlineItems(items: OutlineNode[]): number {
  let count = 0
  for (let i = 0; i < items.length; i++) {
    count++
    count += countOutlineItems(items[i]!.children)
  }
  return count
}

// Metadata utilities.

/** Convert Date to the PDF date format D:YYYYMMDDHHmmSS+HH'mm'. */
function formatPdfDate(d: Date): string {
  if (!Number.isFinite(d.getTime())) throw new Error('PDF date must be valid')
  const fullYear = d.getFullYear()
  if (fullYear < 0 || fullYear > 9999) throw new Error('PDF date year must be from 0000 through 9999')
  const yyyy = fullYear.toString().padStart(4, '0')
  const MM = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  const HH = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  const tzOffset = -d.getTimezoneOffset()
  if (tzOffset === 0) {
    return `D:${yyyy}${MM}${dd}${HH}${mm}${ss}Z`
  }
  const sign = tzOffset > 0 ? '+' : '-'
  const tzHH = Math.floor(Math.abs(tzOffset) / 60).toString().padStart(2, '0')
  const tzMM = (Math.abs(tzOffset) % 60).toString().padStart(2, '0')
  return `D:${yyyy}${MM}${dd}${HH}${mm}${ss}${sign}${tzHH}'${tzMM}'`
}

function pdfTrappedName(state: PdfTrappedState): string {
  if (state === true) return '/True'
  if (state === false) return '/False'
  return '/Unknown'
}

export function validatePdfConformance(bytes: Uint8Array, options: PdfConformanceValidationOptions): void {
  const pdfa = options.pdfaConformance
  const pdfx = options.pdfxConformance
  if (!pdfa && !pdfx) return
  if (pdfa) validatePdfAFileFraming(bytes, pdfa)
  const doc = parsePdf(bytes)
  if (pdfa) {
    validatePdfAConformance(doc.getCatalog(), doc, pdfa)
    if (pdfa !== 'PDF/A-1b') {
      const signatures = verifyPdfSignatures(bytes)
      for (let index = 0; index < signatures.length; index++) {
        if (!signatures[index]!.coversWholeDocument) {
          throw new Error(`PDF conformance error: ${pdfa} signature ${index + 1} ByteRange must cover the entire document`)
        }
      }
    }
  }
  if (pdfx) validatePdfXConformance(doc.getCatalog(), doc, pdfx, options.pdfxOutputConditionValidator)
}

function validatePdfAEmbeddedFiles(pdfa: PdfAConformance, files: readonly PdfEmbeddedFile[]): void {
  if (files.length === 0) return
  if (pdfa === 'PDF/A-1b') throw new Error('PDF/A-1b forbids embedded files')
  if (pdfa === 'PDF/A-2b') {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!
      if (file.mimeType !== 'application/pdf') {
        throw new Error(`PDF/A-2b embedded file ${file.name} must have MIME type application/pdf`)
      }
      validateEmbeddedPdfA12(file.data, `PDF/A-2b embedded file ${file.name}`)
    }
    return
  }
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!
    if (file.relationship === undefined) throw new Error(`PDF/A-3b embedded file ${file.name} requires AFRelationship`)
    if (!PDFA3_AF_RELATIONSHIPS.has(file.relationship)) {
      throw new Error(`PDF/A-3b embedded file ${file.name} has an invalid AFRelationship ${file.relationship}`)
    }
    validatePdfMediaMimeType(file.mimeType ?? 'application/octet-stream')
  }
}

const PDFA3_AF_RELATIONSHIPS = new Set<PdfAFRelationship>([
  'Source', 'Data', 'Alternative', 'Supplement', 'Unspecified',
])

function validateEmbeddedPdfA12(bytes: Uint8Array, label: string): void {
  const embedded = parsePdf(bytes)
  const catalog = embedded.getCatalog()
  const metadata = embedded.resolve(catalog.get('Metadata') ?? null)
  if (!(metadata instanceof PdfStream)) throw new Error(`${label} must contain PDF/A identification metadata`)
  const packet = new TextDecoder('utf-8', { fatal: true }).decode(embedded.decodeStream(metadata))
  const part = /<pdfaid:part>\s*([12])\s*<\/pdfaid:part>/.exec(packet)
  const conformance = /<pdfaid:conformance>\s*([ABU])\s*<\/pdfaid:conformance>/.exec(packet)
  if (part === null || conformance === null) throw new Error(`${label} must identify as PDF/A-1 or PDF/A-2`)
  validatePdfConformance(bytes, { pdfaConformance: part[1] === '1' ? 'PDF/A-1b' : 'PDF/A-2b' })
}

const PDFA1_ANNOTATION_SUBTYPES = new Set<string>([
  'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Highlight', 'Underline',
  'Squiggly', 'StrikeOut', 'Stamp', 'Ink', 'Popup', 'Widget', 'PrinterMark', 'TrapNet',
])

const PDFA23_ANNOTATION_SUBTYPES = new Set<string>([
  'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine',
  'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink',
  'Popup', 'FileAttachment', 'Widget', 'PrinterMark', 'TrapNet', 'Watermark', 'Redact',
])

const PDFA_ACTION_SUBTYPES = new Set<string>([
  'GoTo', 'GoToR', 'GoToE', 'Launch', 'Thread', 'URI', 'Sound', 'Movie', 'Hide',
  'Named', 'SubmitForm', 'ResetForm', 'ImportData', 'JavaScript', 'SetOCGState',
  'Rendition', 'Trans', 'GoTo3DView',
])

function validatePdfAAnnotationInputs(pdfa: PdfAConformance, annotations: readonly PdfAnnotation[]): void {
  const permitted = pdfa === 'PDF/A-1b' ? PDFA1_ANNOTATION_SUBTYPES : PDFA23_ANNOTATION_SUBTYPES
  for (let index = 0; index < annotations.length; index++) {
    const annotation = annotations[index]!
    if (!permitted.has(annotation.subtype)) {
      throw new Error(`${pdfa} forbids ${annotation.subtype} annotations`)
    }
    const popupMayOmitFlags = pdfa !== 'PDF/A-1b' && annotation.subtype === 'Popup'
    const flags = annotation.flags ?? (popupMayOmitFlags ? undefined : 4)
    if (flags !== undefined) {
      const forbidden = pdfa === 'PDF/A-1b' ? 1 | 2 | 32 : 1 | 2 | 32 | 256
      if ((flags & 4) === 0 || (flags & forbidden) !== 0) {
        throw new Error(`${pdfa} annotation ${index + 1} must be printable and visible`)
      }
    }
    if (pdfa === 'PDF/A-1b' && annotation.opacity !== undefined && annotation.opacity !== 1) {
      throw new Error('PDF/A-1b annotation opacity must be 1')
    }
    if (annotation.subtype === 'Widget' && (annotation.action !== undefined || annotation.additionalActions !== undefined)) {
      throw new Error(`${pdfa} Widget annotations forbid A and AA actions`)
    }
    if (annotation.action !== undefined) validatePdfAAction(pdfa, annotation.action)
    if (annotation.additionalActions !== undefined) {
      for (const action of Object.values(annotation.additionalActions)) validatePdfAAction(pdfa, action)
    }
    if (isPreservedAnnotation(annotation) && (annotation.entries.A !== undefined || annotation.entries.AA !== undefined)) {
      throw new Error(`${pdfa} preserved annotations must expose A and AA as typed actions for validation`)
    }
  }
}

function validatePdfAFormFieldInputs(pdfa: PdfAConformance, fields: readonly FormFieldRecord[]): void {
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!.field
    if (field.action !== undefined) throw new Error(`${pdfa} Widget annotations forbid A actions`)
    if (field.additionalActions !== undefined) throw new Error(`${pdfa} form fields forbid AA actions`)
  }
}

function validatePdfAAction(pdfa: PdfAConformance, action: PdfActionDef): void {
  const permitted = pdfa === 'PDF/A-1b'
    ? new Set(['GoTo', 'GoToR', 'Thread', 'URI', 'Named', 'SubmitForm'])
    : new Set(['GoTo', 'GoToR', 'GoToE', 'Thread', 'URI', 'Named', 'SubmitForm'])
  if (!permitted.has(action.subtype)) throw new Error(`${pdfa} forbids ${action.subtype} actions`)
  if (action.subtype === 'Named') {
    const named = action.entries.N
    if (named === undefined || named === null || typeof named !== 'object' || named.kind !== 'name'
      || (named.value !== 'NextPage' && named.value !== 'PrevPage' && named.value !== 'FirstPage' && named.value !== 'LastPage')) {
      throw new Error(`${pdfa} permits only NextPage, PrevPage, FirstPage, and LastPage named actions`)
    }
  }
  if (Array.isArray(action.next)) {
    for (let index = 0; index < action.next.length; index++) validatePdfAAction(pdfa, action.next[index]!)
  } else if (action.next !== undefined) {
    validatePdfAAction(pdfa, action.next)
  }
}

function validatePdfAConformance(catalog: PdfDict, doc: ReturnType<typeof parsePdf>, pdfa: PdfAConformance): void {
  const outputColorSpace = validatePdfAOutputIntents(catalog, doc, pdfa)
  validatePdfAPageTransparencyGroups(doc, pdfa, outputColorSpace)
  const xmp = requirePdfXmpMetadata(doc, catalog, pdfa)
  requirePdfAXmpIdentification(xmp, pdfa)
  if (pdfa === 'PDF/A-1b') requireInfoMatchesXmp(doc, catalog, pdfa)
  const usedFonts = validatePdfAContentSemantics(doc, pdfa, outputColorSpace)
  requirePdfEmbeddedFonts(doc, pdfa, usedFonts)
  validatePdfAInteractiveObjects(doc, catalog, pdfa, outputColorSpace)
  validatePdfAOptionalContentDictionaries(doc, catalog, pdfa)
  validatePdfAObjectGraph(doc, catalog, pdfa)
  validatePdfATrailer(doc, pdfa)
  if (pdfa === 'PDF/A-1b') {
    if (doc.hasXrefStreams()) throw new Error('PDF conformance error: PDF/A-1b forbids xref streams')
    if (doc.hasObjectStreams()) throw new Error('PDF conformance error: PDF/A-1b forbids object streams')
  }
}

function validatePdfAPageTransparencyGroups(
  doc: ReturnType<typeof parsePdf>,
  pdfa: PdfAConformance,
  outputColorSpace: string | null,
): void {
  if (pdfa === 'PDF/A-1b' || outputColorSpace !== null) return
  const pages = collectPdfPages(doc)
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (!analyzeParsedPdfPageTransparency(doc, pageIndex).transparent) continue
    const page = pages[pageIndex]!
    const group = doc.resolve(page.dict.get('Group') ?? null)
    if (!(group instanceof Map)
      || pdfNameValue(doc.resolve(group.get('S') ?? null)) !== 'Transparency'
      || !group.has('CS')) {
      throw new Error(`PDF conformance error: ${pdfa} transparent page ${pageIndex + 1} requires a Transparency Group with CS when no PDF/A OutputIntent is present`)
    }
    const resources = doc.resolve(page.resources)
    if (!(resources instanceof Map)) {
      throw new Error(`PDF conformance error: ${pdfa} page ${pageIndex + 1} Resources must be a dictionary`)
    }
    validatePdfAColorSpace(
      doc,
      group.get('CS')!,
      resources,
      pdfa,
      null,
      `page ${pageIndex + 1} transparency group`,
    )
  }
}

function validatePdfATrailer(doc: ReturnType<typeof parsePdf>, pdfa: PdfAConformance): void {
  const sections = doc.getXrefSections()
  for (let index = 0; index < sections.length; index++) {
    if (sections[index]!.trailer.has('Encrypt')) {
      throw new Error(`PDF conformance error: ${pdfa} forbids encryption in every trailer dictionary`)
    }
  }
  let firstPageTrailer: PdfDict | null = null
  for (let index = 0; index + 1 < sections.length; index++) {
    if (sections[index]!.offset < sections[index + 1]!.offset) {
      firstPageTrailer = sections[index]!.trailer
      break
    }
  }
  const identifier = doc.resolve((firstPageTrailer ?? doc.trailer).get('ID') ?? null)
  const first = Array.isArray(identifier) ? doc.resolve(identifier[0] ?? null) : null
  const second = Array.isArray(identifier) ? doc.resolve(identifier[1] ?? null) : null
  if (!Array.isArray(identifier) || identifier.length !== 2
    || !(first instanceof PdfString) || first.bytes.length === 0
    || !(second instanceof PdfString) || second.bytes.length === 0) {
    throw new Error(`PDF conformance error: ${pdfa} requires a two-string file identifier in the final trailer`)
  }
  if (firstPageTrailer !== null) {
    let lastSection = sections[0]!
    for (let index = 1; index < sections.length; index++) {
      if (sections[index]!.offset > lastSection.offset) lastSection = sections[index]!
    }
    const lastIdentifier = doc.resolve(lastSection.trailer.get('ID') ?? null)
    if (lastIdentifier !== null && !pdfIdentifierPairsEqual(doc, identifier, lastIdentifier)) {
      throw new Error(`PDF conformance error: ${pdfa} linearized first-page and final trailer identifiers must be identical`)
    }
  }
}

function pdfIdentifierPairsEqual(
  doc: ReturnType<typeof parsePdf>,
  leftValue: PdfValue,
  rightValue: PdfValue,
): boolean {
  const left = doc.resolve(leftValue)
  const right = doc.resolve(rightValue)
  if (!Array.isArray(left) || left.length !== 2 || !Array.isArray(right) || right.length !== 2) return false
  for (let index = 0; index < 2; index++) {
    const leftString = doc.resolve(left[index]!)
    const rightString = doc.resolve(right[index]!)
    if (!(leftString instanceof PdfString) || !(rightString instanceof PdfString)
      || compareBytes(leftString.bytes, rightString.bytes) !== 0) return false
  }
  return true
}

function validatePdfAFileFraming(bytes: Uint8Array, pdfa: PdfAConformance): void {
  if (bytes.length < 16 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44
    || bytes[3] !== 0x46 || bytes[4] !== 0x2D) {
    throw new Error(`PDF conformance error: ${pdfa} PDF header must begin at byte zero`)
  }
  let firstLineEnd = 0
  while (firstLineEnd < bytes.length && bytes[firstLineEnd] !== 0x0A && bytes[firstLineEnd] !== 0x0D) firstLineEnd++
  const header = pdfBytesToLatin1(bytes.subarray(0, firstLineEnd))
  if (pdfa === 'PDF/A-1b' && header !== '%PDF-1.4') {
    throw new Error('PDF conformance error: PDF/A-1b header must declare PDF 1.4')
  }
  if (pdfa !== 'PDF/A-1b' && !/^%PDF-1\.[0-7]$/.test(header)) {
    throw new Error(`PDF conformance error: ${pdfa} header must declare PDF 1.0 through PDF 1.7`)
  }
  let markerStart = firstLineEnd
  if (bytes[markerStart] === 0x0D) markerStart++
  if (bytes[markerStart] === 0x0A) markerStart++
  let markerEnd = markerStart
  while (markerEnd < bytes.length && bytes[markerEnd] !== 0x0A && bytes[markerEnd] !== 0x0D) markerEnd++
  if (bytes[markerStart] !== 0x25) {
    throw new Error(`PDF conformance error: ${pdfa} requires a binary marker comment after the header`)
  }
  if (markerEnd - markerStart < 5
    || bytes[markerStart + 1]! < 0x80 || bytes[markerStart + 2]! < 0x80
    || bytes[markerStart + 3]! < 0x80 || bytes[markerStart + 4]! < 0x80) {
    throw new Error(`PDF conformance error: ${pdfa} binary marker comment requires at least four bytes above 127`)
  }

  const eof = [0x25, 0x25, 0x45, 0x4F, 0x46]
  let eofStart = bytes.length - eof.length
  if (bytes.length >= 2 && bytes[bytes.length - 2] === 0x0D && bytes[bytes.length - 1] === 0x0A) eofStart -= 2
  else if (bytes[bytes.length - 1] === 0x0A || bytes[bytes.length - 1] === 0x0D) eofStart--
  if (eofStart < 0 || eof.some(function (byte, index) { return bytes[eofStart + index] !== byte })) {
    throw new Error(`PDF conformance error: ${pdfa} permits only one optional end-of-line marker after the final %%EOF`)
  }
}

interface PdfAContentValidationState {
  streams: Set<PdfStream>
  activeStreams: Set<PdfStream>
  resources: Set<PdfDict>
  fonts: Set<PdfDict>
  fontDecoders: Map<PdfDict, PdfFontDecoder>
  usedFonts: Map<PdfDict, boolean>
  outputColorSpace: string | null
}

interface PdfAGraphicsValidationState {
  font: PdfFontDecoder | null
  fontDictionary: PdfDict | null
  textRenderingMode: number
  strokingColorSpace: PdfValue
  nonstrokingColorSpace: PdfValue
  overprintStroke: boolean
  overprintFill: boolean
  overprintMode: 0 | 1
}

function validatePdfAContentSemantics(
  doc: ReturnType<typeof parsePdf>,
  pdfa: PdfAConformance,
  outputColorSpace: string | null,
): Map<PdfDict, boolean> {
  const state: PdfAContentValidationState = {
    streams: new Set<PdfStream>(),
    activeStreams: new Set<PdfStream>(),
    resources: new Set<PdfDict>(),
    fonts: new Set<PdfDict>(),
    fontDecoders: new Map<PdfDict, PdfFontDecoder>(),
    usedFonts: new Map<PdfDict, boolean>(),
    outputColorSpace,
  }
  const pages = collectPdfPages(doc)
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]!
    const resources = doc.resolve(page.resources)
    if (!(resources instanceof Map)) {
      throw new Error(`PDF conformance error: ${pdfa} page ${pageIndex + 1} Resources must be a dictionary`)
    }
    validatePdfAResources(doc, resources, pdfa, `page ${pageIndex + 1}`, state)
    validatePdfAContentValue(doc, page.dict.get('Contents') ?? null, resources, pdfa, `page ${pageIndex + 1}`, state, true, true)
    const annotations = doc.resolve(page.dict.get('Annots') ?? null)
    if (!Array.isArray(annotations)) continue
    for (let annotationIndex = 0; annotationIndex < annotations.length; annotationIndex++) {
      const annotation = doc.resolve(annotations[annotationIndex]!)
      if (!(annotation instanceof Map)) continue
      const appearance = doc.resolve(annotation.get('AP') ?? null)
      if (!(appearance instanceof Map)) continue
      for (const [kind, source] of appearance) {
        const resolved = doc.resolve(source)
        if (resolved instanceof PdfStream) {
          validatePdfAContentStream(doc, resolved, resources, pdfa, `page ${pageIndex + 1} annotation ${annotationIndex + 1}/${kind}`, state, false, true)
        } else if (resolved instanceof Map) {
          for (const [name, candidate] of resolved) {
            const stream = doc.resolve(candidate)
            if (!(stream instanceof PdfStream)) {
              throw new Error(`PDF conformance error: ${pdfa} annotation appearance ${kind}/${name} must be a stream`)
            }
            validatePdfAContentStream(doc, stream, resources, pdfa, `page ${pageIndex + 1} annotation ${annotationIndex + 1}/${kind}/${name}`, state, false, true)
          }
        }
      }
    }
  }
  return state.usedFonts
}

function validatePdfAContentValue(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  resources: PdfDict,
  pdfa: PdfAConformance,
  context: string,
  state: PdfAContentValidationState,
  associatedResourcesExplicit: boolean,
  recordUsage: boolean,
): void {
  const resolved = doc.resolve(value)
  if (resolved === null) return
  if (resolved instanceof PdfStream) {
    validatePdfAContentStream(doc, resolved, resources, pdfa, context, state, associatedResourcesExplicit, recordUsage)
    return
  }
  if (!Array.isArray(resolved)) throw new Error(`PDF conformance error: ${pdfa} ${context} Contents must be a stream or array`)
  const parts: Uint8Array[] = []
  let byteLength = 0
  for (let index = 0; index < resolved.length; index++) {
    const stream = doc.resolve(resolved[index]!)
    if (!(stream instanceof PdfStream)) {
      throw new Error(`PDF conformance error: ${pdfa} ${context} content ${index + 1} must be a stream`)
    }
    const bytes = doc.decodeStream(stream)
    parts.push(bytes)
    byteLength += bytes.length + 1
  }
  const combined = new Uint8Array(byteLength)
  let offset = 0
  for (let index = 0; index < parts.length; index++) {
    const bytes = parts[index]!
    combined.set(bytes, offset)
    offset += bytes.length
    combined[offset++] = 0x0A
  }
  validatePdfAContentStream(
    doc,
    new PdfStream(new Map<string, PdfValue>(), combined),
    resources,
    pdfa,
    context,
    state,
    associatedResourcesExplicit,
    recordUsage,
  )
}

function validatePdfAResources(
  doc: ReturnType<typeof parsePdf>,
  resources: PdfDict,
  pdfa: PdfAConformance,
  context: string,
  state: PdfAContentValidationState,
): void {
  if (state.resources.has(resources)) return
  state.resources.add(resources)
  const colorSpaces = doc.resolve(resources.get('ColorSpace') ?? null)
  if (colorSpaces !== null) {
    if (!(colorSpaces instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} ColorSpace resources must be a dictionary`)
    for (const [name, value] of colorSpaces) {
      validatePdfAColorSpace(doc, value, resources, pdfa, state.outputColorSpace, `${context} color space ${name}`)
    }
  }
  const fonts = doc.resolve(resources.get('Font') ?? null)
  if (fonts !== null) {
    if (!(fonts instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} Font resources must be a dictionary`)
    for (const [name, value] of fonts) validatePdfAType3Font(doc, value, resources, pdfa, `${context} font ${name}`, state)
  }
  const xObjects = doc.resolve(resources.get('XObject') ?? null)
  if (xObjects !== null) {
    if (!(xObjects instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} XObject resources must be a dictionary`)
    for (const [name, value] of xObjects) {
      const stream = doc.resolve(value)
      if (!(stream instanceof PdfStream)) throw new Error(`PDF conformance error: ${pdfa} ${context} XObject ${name} must be a stream`)
      const subtype = pdfNameValue(doc.resolve(stream.dict.get('Subtype') ?? null))
      if (subtype === 'Image') {
        const imageMask = doc.resolve(stream.dict.get('ImageMask') ?? null) === true
        if (!imageMask) validatePdfAColorSpace(doc, stream.dict.get('ColorSpace') ?? null, resources, pdfa, state.outputColorSpace, `${context} image ${name}`)
      } else if (subtype === 'Form') {
        validatePdfAContentStream(doc, stream, resources, pdfa, `${context} form ${name}`, state)
      }
    }
  }
  const patterns = doc.resolve(resources.get('Pattern') ?? null)
  if (patterns !== null) {
    if (!(patterns instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} Pattern resources must be a dictionary`)
    for (const [name, value] of patterns) {
      const pattern = doc.resolve(value)
      if (pattern instanceof PdfStream) validatePdfAContentStream(doc, pattern, resources, pdfa, `${context} pattern ${name}`, state)
      else if (pattern instanceof Map) {
        const shading = doc.resolve(pattern.get('Shading') ?? null)
        const dictionary = shading instanceof PdfStream ? shading.dict : shading
        if (dictionary instanceof Map) {
          validatePdfAColorSpace(doc, dictionary.get('ColorSpace') ?? null, resources, pdfa, state.outputColorSpace, `${context} pattern ${name}`)
        }
      }
    }
  }
  const shadings = doc.resolve(resources.get('Shading') ?? null)
  if (shadings !== null) {
    if (!(shadings instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} Shading resources must be a dictionary`)
    for (const [name, value] of shadings) {
      const shading = doc.resolve(value)
      const dictionary = shading instanceof PdfStream ? shading.dict : shading
      if (!(dictionary instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} Shading ${name} must be a dictionary`)
      validatePdfAColorSpace(doc, dictionary.get('ColorSpace') ?? null, resources, pdfa, state.outputColorSpace, `${context} shading ${name}`)
    }
  }
}

function validatePdfAColorSpace(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  resources: PdfDict,
  pdfa: PdfAConformance,
  outputColorSpace: string | null,
  context: string,
  resolving = new Set<string>(),
): void {
  let resolved = doc.resolve(value)
  if (resolved instanceof PdfName && !['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Pattern'].includes(resolved.name)) {
    if (resolving.has(resolved.name)) throw new Error(`PDF conformance error: ${pdfa} cyclic color-space resource ${resolved.name} at ${context}`)
    const colorSpaces = doc.resolve(resources.get('ColorSpace') ?? null)
    if (!(colorSpaces instanceof Map) || !colorSpaces.has(resolved.name)) {
      throw new Error(`PDF conformance error: ${pdfa} color-space resource ${resolved.name} is missing at ${context}`)
    }
    resolving.add(resolved.name)
    validatePdfAColorSpace(doc, colorSpaces.get(resolved.name)!, resources, pdfa, outputColorSpace, context, resolving)
    resolving.delete(resolved.name)
    return
  }
  if (resolved instanceof PdfName) {
    if (resolved.name === 'Pattern') return
    const colorSpaces = doc.resolve(resources.get('ColorSpace') ?? null)
    const defaultName = resolved.name === 'DeviceGray'
      ? 'DefaultGray'
      : resolved.name === 'DeviceRGB' ? 'DefaultRGB' : 'DefaultCMYK'
    const hasDefault = colorSpaces instanceof Map
      && colorSpaces.has(defaultName)
      && isPdfADeviceIndependentDefaultColorSpace(doc, colorSpaces.get(defaultName)!)
    const outputIntentMatches = resolved.name === 'DeviceGray'
      ? outputColorSpace !== null
      : outputColorSpace === (resolved.name === 'DeviceRGB' ? 'RGB' : 'CMYK')
    if (!hasDefault && !outputIntentMatches) {
      const outputRequirement = resolved.name === 'DeviceGray' ? 'a PDF/A OutputIntent' : 'a matching OutputIntent'
      throw new Error(`PDF conformance error: ${pdfa} ${resolved.name} requires ${defaultName} or ${outputRequirement} at ${context}`)
    }
    return
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`PDF conformance error: ${pdfa} color space is invalid at ${context}`)
  }
  const family = pdfNameValue(doc.resolve(resolved[0]!))
  if (family === 'ICCBased' || family === 'CalGray' || family === 'CalRGB' || family === 'Lab') return
  if (family === 'Indexed') {
    validatePdfAColorSpace(doc, resolved[1] ?? null, resources, pdfa, outputColorSpace, context, resolving)
    return
  }
  if (family === 'Separation' || family === 'DeviceN') {
    validatePdfAColorSpace(doc, resolved[2] ?? null, resources, pdfa, outputColorSpace, context, resolving)
    return
  }
  if (family === 'Pattern') {
    if (resolved.length > 1) validatePdfAColorSpace(doc, resolved[1]!, resources, pdfa, outputColorSpace, context, resolving)
    return
  }
  throw new Error(`PDF conformance error: ${pdfa} color space ${family ?? 'unknown'} is invalid at ${context}`)
}

function isPdfADeviceIndependentDefaultColorSpace(doc: ReturnType<typeof parsePdf>, value: PdfValue): boolean {
  const resolved = doc.resolve(value)
  if (!Array.isArray(resolved) || resolved.length === 0) return false
  const family = pdfNameValue(doc.resolve(resolved[0]!))
  return family === 'CalGray' || family === 'CalRGB' || family === 'Lab' || family === 'ICCBased'
}

function validatePdfAType3Font(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  inheritedResources: PdfDict,
  pdfa: PdfAConformance,
  context: string,
  state: PdfAContentValidationState,
): void {
  const font = doc.resolve(value)
  if (!(font instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} must be a font dictionary`)
  if (state.fonts.has(font)) return
  state.fonts.add(font)
  if (pdfNameValue(doc.resolve(font.get('Subtype') ?? null)) !== 'Type3') return
  const charProcs = doc.resolve(font.get('CharProcs') ?? null)
  if (!(charProcs instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} Type3 font requires CharProcs`)
  const hasFontResources = font.has('Resources')
  const resourceValue = doc.resolve(font.get('Resources') ?? inheritedResources)
  if (!(resourceValue instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} Type3 Resources must be a dictionary`)
  validatePdfAResources(doc, resourceValue, pdfa, `${context} Type3`, state)
  for (const [name, procedure] of charProcs) {
    const stream = doc.resolve(procedure)
    if (!(stream instanceof PdfStream)) throw new Error(`PDF conformance error: ${pdfa} ${context} CharProc ${name} must be a stream`)
    validatePdfAContentStream(doc, stream, resourceValue, pdfa, `${context} CharProc ${name}`, state, hasFontResources)
  }
}

function validatePdfAContentStream(
  doc: ReturnType<typeof parsePdf>,
  stream: PdfStream,
  inheritedResources: PdfDict,
  pdfa: PdfAConformance,
  context: string,
  state: PdfAContentValidationState,
  associatedResourcesExplicit = false,
  recordUsage = false,
  inheritedGraphics?: PdfAGraphicsValidationState,
): void {
  if (!recordUsage) {
    if (state.streams.has(stream)) return
    state.streams.add(stream)
  } else {
    if (state.activeStreams.has(stream)) {
      throw new Error(`PDF conformance error: ${pdfa} has recursive Form XObject execution at ${context}`)
    }
    state.activeStreams.add(stream)
  }
  const ownResources = doc.resolve(stream.dict.get('Resources') ?? inheritedResources)
  if (!(ownResources instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ${context} Resources must be a dictionary`)
  validatePdfAResources(doc, ownResources, pdfa, context, state)
  const lexer = new PdfContentLexer(doc.decodeStream(stream))
  const operands: PdfValue[] = []
  const graphicsStack: PdfAGraphicsValidationState[] = []
  let graphics: PdfAGraphicsValidationState = inheritedGraphics === undefined ? {
    font: null,
    fontDictionary: null,
    textRenderingMode: 0,
    strokingColorSpace: new PdfName('DeviceGray'),
    nonstrokingColorSpace: new PdfName('DeviceGray'),
    overprintStroke: false,
    overprintFill: false,
    overprintMode: 0,
  } : { ...inheritedGraphics }
  let markedContentDepth = 0
  let textObjectOpen = false
  for (;;) {
    const token = lexer.next()
    if (token.type === 'eof') {
      if (graphicsStack.length !== 0) throw new Error(`PDF conformance error: ${pdfa} has an unmatched q operator at ${context}`)
      if (markedContentDepth !== 0) throw new Error(`PDF conformance error: ${pdfa} has unmatched marked-content operators at ${context}`)
      if (textObjectOpen) throw new Error(`PDF conformance error: ${pdfa} has an unmatched BT operator at ${context}`)
      if (recordUsage) state.activeStreams.delete(stream)
      return
    }
    if (token.type === 'object') {
      operands.push(token.value)
      continue
    }
    if (token.type === 'inlineImage') {
      const filters = pdfFilterNames(doc, token.dict.get('Filter') ?? token.dict.get('F') ?? null, `${pdfa} ${context} inline image`)
        .map(normalizePdfInlineFilterName)
      const allowedInlineFilters = new Set([
        'ASCIIHexDecode', 'ASCII85Decode', 'FlateDecode', 'RunLengthDecode', 'CCITTFaxDecode', 'DCTDecode',
      ])
      if (pdfa === 'PDF/A-1b') allowedInlineFilters.add('JBIG2Decode')
      for (let index = 0; index < filters.length; index++) {
        if (!allowedInlineFilters.has(filters[index]!)) {
          throw new Error(`PDF conformance error: ${pdfa} forbids inline-image filter ${filters[index]} at ${context}`)
        }
      }
      const interpolate = doc.resolve(token.dict.get('Interpolate') ?? token.dict.get('I') ?? null)
      if ((token.dict.has('Interpolate') || token.dict.has('I')) && interpolate !== false) {
        throw new Error(`PDF conformance error: ${pdfa} inline-image Interpolate must be false at ${context}`)
      }
      const imageMask = doc.resolve(token.dict.get('ImageMask') ?? token.dict.get('IM') ?? null) === true
      const bits = doc.resolve(token.dict.get('BitsPerComponent') ?? token.dict.get('BPC') ?? null)
      if (token.dict.has('BitsPerComponent') || token.dict.has('BPC')) {
        const permitted = imageMask ? [1] : pdfa === 'PDF/A-1b' ? [1, 2, 4, 8] : [1, 2, 4, 8, 16]
        if (typeof bits !== 'number' || !permitted.includes(bits)) {
          throw new Error(`PDF conformance error: ${pdfa} inline-image BitsPerComponent is invalid at ${context}`)
        }
      }
      let colorSpace = token.dict.get('ColorSpace') ?? token.dict.get('CS') ?? null
      if (colorSpace instanceof PdfName && colorSpace.name === 'G') colorSpace = new PdfName('DeviceGray')
      else if (colorSpace instanceof PdfName && colorSpace.name === 'RGB') colorSpace = new PdfName('DeviceRGB')
      else if (colorSpace instanceof PdfName && colorSpace.name === 'CMYK') colorSpace = new PdfName('DeviceCMYK')
      if (!imageMask) validatePdfAColorSpace(doc, colorSpace, ownResources, pdfa, state.outputColorSpace, `${context} inline image`)
      operands.length = 0
      continue
    }
    const operator = token.value
    if (!PDF_X_CONTENT_OPERATORS.has(operator)) {
      throw new Error(`PDF conformance error: ${pdfa} forbids undefined content operator ${operator} at ${context}`)
    }
    const referencesResource = operator === 'Tf' || operator === 'Do' || operator === 'gs'
      || operator === 'cs' || operator === 'CS' || operator === 'sh' || operator === 'scn' || operator === 'SCN'
      || operator === 'BDC' || operator === 'DP'
    if (pdfa !== 'PDF/A-1b' && referencesResource && !stream.dict.has('Resources') && !associatedResourcesExplicit) {
      throw new Error(`PDF conformance error: ${pdfa} ${context} references resources without an explicitly associated Resources dictionary`)
    }
    if (operator === 'q') {
      graphicsStack.push({ ...graphics })
      if (graphicsStack.length > 28) {
        throw new Error(`PDF conformance error: ${pdfa} graphics-state nesting exceeds 28 at ${context}`)
      }
    } else if (operator === 'Q') {
      if (graphicsStack.length === 0) throw new Error(`PDF conformance error: ${pdfa} has an unmatched Q operator at ${context}`)
      graphics = graphicsStack.pop()!
    } else if (operator === 'BMC' || operator === 'BDC') {
      markedContentDepth++
      if (pdfa === 'PDF/A-1b' && markedContentDepth > 10) {
        throw new Error(`PDF conformance error: ${pdfa} marked-content nesting exceeds 10 at ${context}`)
      }
    } else if (operator === 'EMC') {
      if (markedContentDepth === 0) throw new Error(`PDF conformance error: ${pdfa} has an unmatched EMC operator at ${context}`)
      markedContentDepth--
    } else if (operator === 'BT') {
      if (textObjectOpen) throw new Error(`PDF conformance error: ${pdfa} forbids nested BT operators at ${context}`)
      textObjectOpen = true
    } else if (operator === 'ET') {
      if (!textObjectOpen) throw new Error(`PDF conformance error: ${pdfa} has an unmatched ET operator at ${context}`)
      textObjectOpen = false
    } else if (operator === 'Tf') {
      const dictionary = validatePdfANamedResource(doc, operands[operands.length - 2], ownResources, 'Font', pdfa, context)
      if (!(dictionary instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} Font resource is invalid at ${context}`)
      if (pdfNameValue(doc.resolve(dictionary.get('Subtype') ?? null)) === 'Type0') {
        const encoding = doc.resolve(dictionary.get('Encoding') ?? null)
        if (encoding instanceof PdfName && !isPdfACMapAvailableWithoutEmbedding(pdfa, encoding.name)) {
          throw new Error(`PDF conformance error: ${pdfa} requires non-standard CMap ${encoding.name} to be embedded for ${context}`)
        }
      }
      graphics.font = state.fontDecoders.get(dictionary) ?? createFontDecoder(doc, dictionary)
      graphics.fontDictionary = dictionary
      state.fontDecoders.set(dictionary, graphics.font)
    } else if (operator === 'Tr') {
      const renderingMode = doc.resolve(operands[operands.length - 1] ?? null)
      if (typeof renderingMode !== 'number' || !Number.isInteger(renderingMode) || renderingMode < 0 || renderingMode > 7) {
        throw new Error(`PDF conformance error: ${pdfa} Tr requires an integer from 0 through 7 at ${context}`)
      }
      graphics.textRenderingMode = renderingMode
    } else if (operator === 'Do') {
      const xObject = validatePdfANamedResource(doc, operands[operands.length - 1], ownResources, 'XObject', pdfa, context)
      if (recordUsage && xObject instanceof PdfStream
        && pdfNameValue(doc.resolve(xObject.dict.get('Subtype') ?? null)) === 'Form') {
        validatePdfAContentStream(
          doc,
          xObject,
          ownResources,
          pdfa,
          `${context} Form XObject`,
          state,
          xObject.dict.has('Resources'),
          true,
          graphics,
        )
      }
    } else if (operator === 'gs') {
      const dictionary = validatePdfANamedResource(doc, operands[operands.length - 1], ownResources, 'ExtGState', pdfa, context)
      if (!(dictionary instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} ExtGState resource is invalid at ${context}`)
      applyPdfAExtGState(doc, dictionary, graphics, ownResources, pdfa, context)
    } else if (operator === 'rg' || operator === 'RG') {
      const colorSpace = new PdfName('DeviceRGB')
      validatePdfAColorSpace(doc, colorSpace, ownResources, pdfa, state.outputColorSpace, context)
      if (operator === 'RG') graphics.strokingColorSpace = colorSpace
      else graphics.nonstrokingColorSpace = colorSpace
      validatePdfAOverprintState(doc, graphics, ownResources, pdfa, context)
    } else if (operator === 'k' || operator === 'K') {
      const colorSpace = new PdfName('DeviceCMYK')
      validatePdfAColorSpace(doc, colorSpace, ownResources, pdfa, state.outputColorSpace, context)
      if (operator === 'K') graphics.strokingColorSpace = colorSpace
      else graphics.nonstrokingColorSpace = colorSpace
      validatePdfAOverprintState(doc, graphics, ownResources, pdfa, context)
    } else if (operator === 'g' || operator === 'G') {
      const colorSpace = new PdfName('DeviceGray')
      validatePdfAColorSpace(doc, colorSpace, ownResources, pdfa, state.outputColorSpace, context)
      if (operator === 'G') graphics.strokingColorSpace = colorSpace
      else graphics.nonstrokingColorSpace = colorSpace
      validatePdfAOverprintState(doc, graphics, ownResources, pdfa, context)
    } else if (operator === 'ri') {
      const intent = doc.resolve(operands[operands.length - 1] ?? null)
      if (!(intent instanceof PdfName)
        || !['RelativeColorimetric', 'AbsoluteColorimetric', 'Perceptual', 'Saturation'].includes(intent.name)) {
        throw new Error(`PDF conformance error: ${pdfa} rendering intent is invalid at ${context}`)
      }
    } else if (operator === 'cs' || operator === 'CS') {
      const colorSpace = operands[operands.length - 1] ?? null
      validatePdfAColorSpace(doc, colorSpace, ownResources, pdfa, state.outputColorSpace, context)
      if (operator === 'CS') graphics.strokingColorSpace = colorSpace
      else graphics.nonstrokingColorSpace = colorSpace
      validatePdfAOverprintState(doc, graphics, ownResources, pdfa, context)
    } else if (operator === 'Tj' || operator === "'") {
      validatePdfATextString(graphics.font, operands[operands.length - 1], graphics.textRenderingMode, pdfa, context)
      if (recordUsage) {
        recordPdfAFontUse(graphics, operands[operands.length - 1], state)
        validatePdfAType3GlyphExecution(doc, graphics, operands[operands.length - 1], ownResources, pdfa, context, state)
      }
    } else if (operator === '"') {
      validatePdfATextString(graphics.font, operands[operands.length - 1], graphics.textRenderingMode, pdfa, context)
      if (recordUsage) {
        recordPdfAFontUse(graphics, operands[operands.length - 1], state)
        validatePdfAType3GlyphExecution(doc, graphics, operands[operands.length - 1], ownResources, pdfa, context, state)
      }
    } else if (operator === 'TJ') {
      const values = operands[operands.length - 1]
      if (!Array.isArray(values)) throw new Error(`PDF conformance error: ${pdfa} TJ requires an array at ${context}`)
      for (let index = 0; index < values.length; index++) {
        const value = doc.resolve(values[index]!)
        if (value instanceof PdfString) {
          validatePdfATextString(graphics.font, value, graphics.textRenderingMode, pdfa, context)
          if (recordUsage) {
            recordPdfAFontUse(graphics, value, state)
            validatePdfAType3GlyphExecution(doc, graphics, value, ownResources, pdfa, context, state)
          }
        }
        else if (typeof value !== 'number') throw new Error(`PDF conformance error: ${pdfa} TJ arrays permit only strings and numbers at ${context}`)
      }
    }
    operands.length = 0
  }
}

function normalizePdfInlineFilterName(name: string): string {
  if (name === 'AHx') return 'ASCIIHexDecode'
  if (name === 'A85') return 'ASCII85Decode'
  if (name === 'LZW') return 'LZWDecode'
  if (name === 'Fl') return 'FlateDecode'
  if (name === 'RL') return 'RunLengthDecode'
  if (name === 'CCF') return 'CCITTFaxDecode'
  if (name === 'DCT') return 'DCTDecode'
  return name
}

function applyPdfAExtGState(
  doc: ReturnType<typeof parsePdf>,
  dictionary: PdfDict,
  graphics: PdfAGraphicsValidationState,
  resources: PdfDict,
  pdfa: PdfAConformance,
  context: string,
): void {
  const stroke = dictionary.has('OP') ? doc.resolve(dictionary.get('OP')!) : null
  const fill = dictionary.has('op') ? doc.resolve(dictionary.get('op')!) : null
  const mode = dictionary.has('OPM') ? doc.resolve(dictionary.get('OPM')!) : null
  if (stroke !== null) {
    graphics.overprintStroke = stroke as boolean
    if (fill === null) graphics.overprintFill = stroke as boolean
  }
  if (fill !== null) graphics.overprintFill = fill as boolean
  if (mode !== null) graphics.overprintMode = mode as 0 | 1
  validatePdfAOverprintState(doc, graphics, resources, pdfa, context)
}

function validatePdfAOverprintState(
  doc: ReturnType<typeof parsePdf>,
  graphics: PdfAGraphicsValidationState,
  resources: PdfDict,
  pdfa: PdfAConformance,
  context: string,
): void {
  if (graphics.overprintMode !== 1) return
  const invalidStroke = graphics.overprintStroke
    && isPdfAIccBasedCmykColorSpace(doc, graphics.strokingColorSpace, resources, new Set<string>())
  const invalidFill = graphics.overprintFill
    && isPdfAIccBasedCmykColorSpace(doc, graphics.nonstrokingColorSpace, resources, new Set<string>())
  if (invalidStroke || invalidFill) {
    throw new Error(`PDF conformance error: ${pdfa} OPM 1 is forbidden when ICCBased CMYK overprinting is enabled at ${context}`)
  }
}

function isPdfAIccBasedCmykColorSpace(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  resources: PdfDict,
  resolving: Set<string>,
): boolean {
  const resolved = doc.resolve(value)
  if (resolved instanceof PdfName) {
    if (['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Pattern'].includes(resolved.name)) return false
    if (resolving.has(resolved.name)) return false
    const colorSpaces = doc.resolve(resources.get('ColorSpace') ?? null)
    if (!(colorSpaces instanceof Map) || !colorSpaces.has(resolved.name)) return false
    resolving.add(resolved.name)
    const result = isPdfAIccBasedCmykColorSpace(doc, colorSpaces.get(resolved.name)!, resources, resolving)
    resolving.delete(resolved.name)
    return result
  }
  if (!Array.isArray(resolved) || pdfNameValue(doc.resolve(resolved[0] ?? null)) !== 'ICCBased') return false
  const profile = doc.resolve(resolved[1] ?? null)
  return profile instanceof PdfStream && doc.resolve(profile.dict.get('N') ?? null) === 4
}

function validatePdfANamedResource(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue | undefined,
  resources: PdfDict,
  category: string,
  pdfa: PdfAConformance,
  context: string,
): PdfValue {
  if (!(value instanceof PdfName)) throw new Error(`PDF conformance error: ${pdfa} ${category} operator requires a resource name at ${context}`)
  const dictionary = doc.resolve(resources.get(category) ?? null)
  if (!(dictionary instanceof Map) || !dictionary.has(value.name)) {
    throw new Error(`PDF conformance error: ${pdfa} ${category} resource ${value.name} is missing at ${context}`)
  }
  return doc.resolve(dictionary.get(value.name)!)
}

function validatePdfATextString(
  font: PdfFontDecoder | null,
  value: PdfValue | undefined,
  textRenderingMode: number,
  pdfa: PdfAConformance,
  context: string,
): void {
  if (font === null) throw new Error(`PDF conformance error: ${pdfa} text-showing operator requires a selected font at ${context}`)
  if (!(value instanceof PdfString)) throw new Error(`PDF conformance error: ${pdfa} text-showing operator requires a string at ${context}`)
  font.metrics(value.bytes)
  const codes = font.codes(value.bytes)
  for (let index = 0; index < codes.length; index++) {
    const cid = font.cid(codes[index]!)
    if (pdfa !== 'PDF/A-1b' && font.isNotdef(cid)) {
      throw new Error(`PDF conformance error: ${pdfa} text-showing operators forbid the .notdef glyph for character code ${codes[index]!.code} at ${context}`)
    }
    if (textRenderingMode === 3 || !font.hasGlyphOutlines && font.type3 === null) continue
    if (!font.hasGlyph(cid)) {
      throw new Error(`PDF conformance error: ${pdfa} embedded font ${font.baseFont} omits glyph for character code ${codes[index]!.code} at ${context}`)
    }
    const embeddedAdvance = font.glyphAdvance(cid)
    if (embeddedAdvance !== null) {
      const dictionaryAdvance = font.metrics(value.bytes.subarray(codes[index]!.start, codes[index]!.end)).units
      if (Math.abs(embeddedAdvance - dictionaryAdvance) > 1) {
        throw new Error(`PDF conformance error: ${pdfa} embedded font ${font.baseFont} glyph width ${embeddedAdvance} does not match dictionary width ${dictionaryAdvance} at ${context}`)
      }
    }
  }
}

function recordPdfAFontUse(
  graphics: PdfAGraphicsValidationState,
  value: PdfValue | undefined,
  state: PdfAContentValidationState,
): void {
  if (!(value instanceof PdfString) || value.bytes.length === 0 || graphics.fontDictionary === null) return
  const rendersGlyphs = graphics.textRenderingMode !== 3
  state.usedFonts.set(graphics.fontDictionary, rendersGlyphs || state.usedFonts.get(graphics.fontDictionary) === true)
}

function validatePdfAType3GlyphExecution(
  doc: ReturnType<typeof parsePdf>,
  graphics: PdfAGraphicsValidationState,
  value: PdfValue | undefined,
  inheritedResources: PdfDict,
  pdfa: PdfAConformance,
  context: string,
  state: PdfAContentValidationState,
): void {
  const font = graphics.font
  if (font === null || graphics.textRenderingMode === 3 || font.type3 === null || !(value instanceof PdfString)) return
  const resources = font.type3.resources ?? inheritedResources
  const hasFontResources = font.type3.resources !== null
  for (const code of font.codes(value.bytes)) {
    const characterCode = font.cid(code)
    const stream = font.type3.charProc(characterCode)
    if (stream === null) continue
    validatePdfAContentStream(
      doc,
      stream,
      resources,
      pdfa,
      `${context} Type3 character ${characterCode}`,
      state,
      hasFontResources,
      true,
      graphics,
    )
  }
}

function validatePdfXConformance(
  catalog: PdfDict,
  doc: ReturnType<typeof parsePdf>,
  pdfx: PdfXConformance,
  outputConditionValidator: import('../pdf/pdf-output-intent.js').PdfXOutputConditionValidator | undefined,
): void {
  if (doc.hasXrefStreams()) throw new Error(`PDF conformance error: ${pdfx} forbids xref streams`)
  if (doc.hasObjectStreams()) throw new Error(`PDF conformance error: ${pdfx} forbids object streams`)
  requiredPdfXOutputIntent(catalog, doc, pdfx, outputConditionValidator)
  if (doc.resolve(catalog.get('Metadata') ?? null) !== null) requirePdfXmpMetadata(doc, catalog, pdfx)
  validatePdfXInfo(doc, pdfx)
  requirePdfXPageBoxes(doc, pdfx)
  requirePdfXNoInteractiveFeatures(catalog, doc, pdfx)
  requirePdfEmbeddedFonts(doc, pdfx)
  validatePdfXContentColorSpaces(doc, pdfx)
  validatePdfXObjectGraph(doc, catalog, pdfx)
  validatePdfXTrailer(doc, pdfx)
}

function validatePdfAObjectGraph(doc: ReturnType<typeof parsePdf>, catalog: PdfDict, pdfa: PdfAConformance): void {
  const trailerSize = doc.resolve(doc.trailer.get('Size') ?? null)
  if (typeof trailerSize !== 'number' || !Number.isInteger(trailerSize) || trailerSize < 1) {
    throw new Error(`PDF conformance error: ${pdfa} trailer Size must be a positive integer`)
  }
  if (trailerSize > 8388607) {
    throw new Error(`PDF conformance error: ${pdfa} trailer Size exceeds 8388607 objects`)
  }
  if (catalog.has('Requirements')) throw new Error(`PDF conformance error: ${pdfa} forbids Catalog Requirements`)
  if (catalog.has('NeedsRendering')) throw new Error(`PDF conformance error: ${pdfa} forbids Catalog NeedsRendering`)
  const names = doc.resolve(catalog.get('Names') ?? null)
  if (names instanceof Map && names.has('AlternatePresentations')) {
    throw new Error(`PDF conformance error: ${pdfa} forbids AlternatePresentations name trees`)
  }
  if (pdfa === 'PDF/A-1b' && names instanceof Map && names.has('EmbeddedFiles')) {
    throw new Error(`PDF conformance error: ${pdfa} forbids EmbeddedFiles name trees`)
  }
  if (pdfa !== 'PDF/A-1b') {
    const permissions = doc.resolve(catalog.get('Perms') ?? null)
    if (permissions !== null) {
      if (!(permissions instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} Catalog Perms must be a dictionary`)
      for (const key of permissions.keys()) {
        if (key !== 'UR3' && key !== 'DocMDP') throw new Error(`PDF conformance error: ${pdfa} Catalog Perms forbids ${key}`)
      }
      const certification = doc.resolve(permissions.get('DocMDP') ?? null)
      if (certification instanceof Map) validatePdfADocMdpSignatureReferences(doc, certification, pdfa)
    }
  }

  const pages = collectPdfPages(doc)
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const collected = pages[pageIndex]!
    const page = collected.dict
    if (page.has('PresSteps')) throw new Error(`PDF conformance error: ${pdfa} page ${pageIndex + 1} forbids PresSteps`)
    if (pdfa === 'PDF/A-1b') {
      const group = doc.resolve(page.get('Group') ?? null)
      if (group instanceof Map && pdfNameValue(doc.resolve(group.get('S') ?? null)) === 'Transparency') {
        throw new Error(`PDF conformance error: ${pdfa} page ${pageIndex + 1} forbids transparency groups`)
      }
    }
    const boxes: ReadonlyArray<readonly [string, PdfValue | undefined]> = [
      ['MediaBox', collected.mediaBox],
      ['CropBox', collected.cropBox === null ? undefined : collected.cropBox],
      ['BleedBox', page.get('BleedBox')],
      ['TrimBox', page.get('TrimBox')],
      ['ArtBox', page.get('ArtBox')],
    ]
    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
      const key = boxes[boxIndex]![0]
      const value = boxes[boxIndex]![1]
      if (value === undefined) continue
      validatePdfAPageBox(doc, value, pdfa, key)
    }
  }

  const visitedRefs = new Set<string>()
  const visitedObjects = new Set<object>()
  const associatedFileSpecs = new Set<PdfDict>()
  const embeddedFileSpecs = new Set<PdfDict>()
  const separationDefinitions = new Map<string, string>()
  const halftoneColorants = collectPdfAHalftoneColorants(doc, catalog)
  const maximumStringLength = pdfa === 'PDF/A-1b' ? 65535 : 32767

  const visit = function (source: PdfValue, context: string): void {
    if (source instanceof PdfRef) {
      const key = `${source.num}:${source.gen}`
      if (visitedRefs.has(key)) return
      visitedRefs.add(key)
      visit(doc.resolve(source), context)
      return
    }
    if (source instanceof PdfName) {
      if (source.name.length > 127) {
        throw new Error(`PDF conformance error: ${pdfa} name exceeds 127 bytes at ${context}`)
      }
      return
    }
    if (source instanceof PdfString) {
      if (source.isHex && (source.hexDigitCount & 1) !== 0) {
        throw new Error(`PDF conformance error: ${pdfa} hexadecimal strings require an even number of digits at ${context}`)
      }
      if (source.bytes.length > maximumStringLength) {
        throw new Error(`PDF conformance error: ${pdfa} string exceeds ${maximumStringLength} bytes at ${context}`)
      }
      return
    }
    if (typeof source === 'number') {
      validatePdfANumber(source, pdfa, context)
      return
    }
    if (source instanceof PdfStream) {
      if (visitedObjects.has(source)) return
      visitedObjects.add(source)
      validatePdfAStream(doc, source, pdfa, context)
      visit(source.dict, `${context} stream dictionary`)
      return
    }
    if (Array.isArray(source)) {
      if (visitedObjects.has(source)) return
      visitedObjects.add(source)
      if (pdfa === 'PDF/A-1b' && source.length > 8191) {
        throw new Error(`PDF conformance error: ${pdfa} array exceeds 8191 elements at ${context}`)
      }
      const family = pdfNameValue(doc.resolve(source[0] ?? null))
      if (family === 'ICCBased') validatePdfAIccBasedColorSpace(doc, source, pdfa, context)
      if (family === 'DeviceN') validatePdfADeviceNColorSpace(doc, source, pdfa, context)
      if (pdfa !== 'PDF/A-1b' && family === 'Separation') {
        validatePdfASeparationConsistency(doc, source, pdfa, context, separationDefinitions)
      }
      for (let index = 0; index < source.length; index++) visit(source[index]!, `${context}[${index}]`)
      return
    }
    if (!(source instanceof Map)) return
    if (visitedObjects.has(source)) return
    visitedObjects.add(source)
    if (pdfa === 'PDF/A-1b' && source.size > 4095) {
      throw new Error(`PDF conformance error: ${pdfa} dictionary exceeds 4095 entries at ${context}`)
    }

    const type = pdfNameValue(doc.resolve(source.get('Type') ?? null))
    const subtype = pdfNameValue(doc.resolve(source.get('Subtype') ?? null))
    if (pdfa === 'PDF/A-1b' && type === 'ObjStm') {
      throw new Error(`PDF conformance error: ${pdfa} forbids object streams at ${context}`)
    }
    const actionSubtype = pdfNameValue(doc.resolve(source.get('S') ?? null))
    if (actionSubtype !== null && PDFA_ACTION_SUBTYPES.has(actionSubtype)) {
      validatePdfAActionDictionary(doc, pdfa, source)
    }
    if (pdfa === 'PDF/A-1b' && context.endsWith('/Group') && actionSubtype === 'Transparency') {
      throw new Error(`PDF conformance error: ${pdfa} forbids transparency groups at ${context}`)
    }
    if (pdfa !== 'PDF/A-1b' && type === 'StructElem') {
      const structureType = doc.resolve(source.get('S') ?? null)
      if (!(structureType instanceof PdfName)) {
        throw new Error(`PDF conformance error: ${pdfa} structure element requires a name-valued S at ${context}`)
      }
      validatePdfA23Utf8Name(structureType.name, pdfa, `${context}/S`)
    }
    if (pdfa !== 'PDF/A-1b' && source.has('RoleMap')) {
      const roleMap = doc.resolve(source.get('RoleMap') ?? null)
      if (!(roleMap instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} RoleMap must be a dictionary at ${context}`)
      for (const [role, mapped] of roleMap) {
        validatePdfA23Utf8Name(role, pdfa, `${context}/RoleMap key`)
        const mappedRole = doc.resolve(mapped)
        if (!(mappedRole instanceof PdfName)) throw new Error(`PDF conformance error: ${pdfa} RoleMap values must be names at ${context}`)
        validatePdfA23Utf8Name(mappedRole.name, pdfa, `${context}/RoleMap/${role}`)
      }
    }
    if (type === 'XObject' || subtype === 'Image' || subtype === 'Form' || subtype === 'PS') {
      validatePdfAXObject(doc, source, pdfa, context, subtype)
    }
    if (type === 'ExtGState' || context.includes('/ExtGState/')) validatePdfAExtGState(doc, source, pdfa, context)
    if (source.has('HalftoneType')) {
      validatePdfAHalftone(doc, source, pdfa, context, halftoneColorants.get(source) ?? null)
    }
    if (type === 'Metadata') {
      if (subtype !== 'XML') throw new Error(`PDF conformance error: ${pdfa} metadata stream Subtype must be XML at ${context}`)
    }
    if (type === 'Filespec' || source.has('EF')) {
      validatePdfAFileSpecification(doc, source, pdfa, context)
      if (source.has('EF')) embeddedFileSpecs.add(source)
    }
    const associated = doc.resolve(source.get('AF') ?? null)
    if (Array.isArray(associated)) {
      for (let index = 0; index < associated.length; index++) {
        const fileSpec = doc.resolve(associated[index]!)
        if (!(fileSpec instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} AF entries must be file specifications`)
        associatedFileSpecs.add(fileSpec)
      }
    }
    for (const [key, value] of source) visit(value, `${context}/${key}`)
  }

  visit(doc.trailer, 'Trailer')
  visit(catalog, 'Catalog')
  const objectReferences = doc.getObjectReferences()
  for (let index = 0; index < objectReferences.length; index++) {
    const reference = objectReferences[index]!
    visit(reference, `object ${reference.num} ${reference.gen}`)
  }
  const lexicalViolations = pdfa === 'PDF/A-1b'
    ? [...doc.getPdfALexicalViolations(), ...doc.getPdfA1LexicalViolations()]
    : doc.getPdfALexicalViolations()
  if (lexicalViolations.length > 0) {
    throw new Error(`PDF conformance error: ${pdfa} ${lexicalViolations[0]}`)
  }
  if (pdfa === 'PDF/A-3b') {
    for (const fileSpec of embeddedFileSpecs) {
      if (!associatedFileSpecs.has(fileSpec)) {
        throw new Error('PDF conformance error: PDF/A-3b embedded file is not associated through an AF array')
      }
    }
  }
}

function validatePdfASeparationConsistency(
  doc: ReturnType<typeof parsePdf>,
  colorSpace: PdfValue[],
  pdfa: PdfAConformance,
  context: string,
  definitions: Map<string, string>,
): void {
  if (colorSpace.length !== 4) throw new Error(`PDF conformance error: ${pdfa} Separation color space is incomplete at ${context}`)
  const name = doc.resolve(colorSpace[1]!)
  if (!(name instanceof PdfName)) throw new Error(`PDF conformance error: ${pdfa} Separation colorant must be a name at ${context}`)
  validatePdfA23Utf8Name(name.name, pdfa, `${context} Separation colorant`)
  const definition = `${pdfAObjectFingerprint(doc, colorSpace[2]!, new Set<string>())}|${pdfAObjectFingerprint(doc, colorSpace[3]!, new Set<string>())}`
  const previous = definitions.get(name.name)
  if (previous !== undefined && previous !== definition) {
    throw new Error(`PDF conformance error: ${pdfa} Separation colorant ${name.name} has inconsistent alternate space or tint transform`)
  }
  definitions.set(name.name, definition)
}

function pdfAObjectFingerprint(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  referenceStack: Set<string>,
): string {
  if (value instanceof PdfRef) {
    const key = `${value.num}:${value.gen}`
    if (referenceStack.has(key)) return `cycle:${key}`
    referenceStack.add(key)
    const result = pdfAObjectFingerprint(doc, doc.resolve(value), referenceStack)
    referenceStack.delete(key)
    return result
  }
  const resolved = doc.resolve(value)
  if (resolved instanceof PdfRef) return pdfAObjectFingerprint(doc, resolved, referenceStack)
  if (resolved === null) return 'null'
  if (typeof resolved === 'boolean' || typeof resolved === 'number') return JSON.stringify(resolved)
  if (resolved instanceof PdfName) return `/${resolved.name}`
  if (resolved instanceof PdfString) return `s:${bytesToHex(resolved.bytes)}`
  if (Array.isArray(resolved)) return `[${resolved.map(function (item) { return pdfAObjectFingerprint(doc, item, referenceStack) }).join(',')}]`
  if (resolved instanceof PdfStream) {
    const entries = Array.from(resolved.dict.entries())
      .filter(function ([key]) { return key !== 'Length' && key !== 'Filter' && key !== 'DecodeParms' })
      .sort(function (a, b) { return a[0].localeCompare(b[0]) })
      .map(function ([key, item]) { return `${key}:${pdfAObjectFingerprint(doc, item, referenceStack)}` })
    return `stream:{${entries.join(',')}}:${bytesToHex(doc.decodeStream(resolved))}`
  }
  const entries = Array.from(resolved.entries())
    .sort(function (a, b) { return a[0].localeCompare(b[0]) })
    .map(function ([key, item]) { return `${key}:${pdfAObjectFingerprint(doc, item, referenceStack)}` })
  return `{${entries.join(',')}}`
}

function validatePdfAPageBox(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  pdfa: PdfAConformance,
  key: string,
): void {
  const box = doc.resolve(value)
  if (!Array.isArray(box) || box.length !== 4) throw new Error(`PDF conformance error: ${pdfa} ${key} must be a rectangle`)
  const coordinates = box.map(function (item) { return doc.resolve(item) })
  if (coordinates.some(function (item) { return typeof item !== 'number' || !Number.isFinite(item) })) {
    throw new Error(`PDF conformance error: ${pdfa} ${key} must contain four finite numbers`)
  }
  const width = Math.abs((coordinates[2] as number) - (coordinates[0] as number))
  const height = Math.abs((coordinates[3] as number) - (coordinates[1] as number))
  if (width < 3 || width > 14400 || height < 3 || height > 14400) {
    throw new Error(`PDF conformance error: ${pdfa} ${key} dimensions must be from 3 through 14400 user units`)
  }
}

function validatePdfADocMdpSignatureReferences(
  doc: ReturnType<typeof parsePdf>,
  signature: PdfDict,
  pdfa: PdfAConformance,
): void {
  const references = doc.resolve(signature.get('Reference') ?? null)
  if (references === null) return
  if (!Array.isArray(references)) throw new Error(`PDF conformance error: ${pdfa} signature Reference must be an array`)
  for (let index = 0; index < references.length; index++) {
    const reference = doc.resolve(references[index]!)
    if (!(reference instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} signature Reference entries must be dictionaries`)
    for (const key of ['DigestLocation', 'DigestMethod', 'DigestValue']) {
      if (reference.has(key)) throw new Error(`PDF conformance error: ${pdfa} DocMDP signature Reference forbids ${key}`)
    }
  }
}

function validatePdfAIccBasedColorSpace(
  doc: ReturnType<typeof parsePdf>,
  colorSpace: PdfValue[],
  pdfa: PdfAConformance,
  context: string,
): void {
  if (colorSpace.length !== 2) throw new Error(`PDF conformance error: ${pdfa} ICCBased color space must contain one profile at ${context}`)
  const profile = doc.resolve(colorSpace[1]!)
  if (!(profile instanceof PdfStream)) throw new Error(`PDF conformance error: ${pdfa} ICCBased profile must be a stream at ${context}`)
  const n = doc.resolve(profile.dict.get('N') ?? null)
  const header = inspectIccProfile(doc.decodeStream(profile))
  if (n !== header.components || (n !== 1 && n !== 3 && n !== 4)) {
    throw new Error(`PDF conformance error: ${pdfa} ICCBased N does not match its profile at ${context}`)
  }
  const allowedClass = header.profileClass === 'input' || header.profileClass === 'display'
    || header.profileClass === 'output' || header.profileClass === 'colorSpace'
  const allowedSpace = header.dataColorSpace === 'GRAY' || header.dataColorSpace === 'RGB'
    || header.dataColorSpace === 'CMYK' || header.dataColorSpace === 'Lab'
  const maximumVersion = pdfa === 'PDF/A-1b' ? 2 : 4
  if (!allowedClass || !allowedSpace || header.versionMajor > maximumVersion) {
    throw new Error(`PDF conformance error: ${pdfa} ICCBased profile is not permitted at ${context}`)
  }
}

function validatePdfADeviceNColorSpace(
  doc: ReturnType<typeof parsePdf>,
  colorSpace: PdfValue[],
  pdfa: PdfAConformance,
  context: string,
): void {
  if (colorSpace.length < 4) throw new Error(`PDF conformance error: ${pdfa} DeviceN color space is incomplete at ${context}`)
  const names = doc.resolve(colorSpace[1]!)
  if (!Array.isArray(names)) throw new Error(`PDF conformance error: ${pdfa} DeviceN colorants must be an array at ${context}`)
  const maximum = pdfa === 'PDF/A-1b' ? 8 : 32
  if (names.length === 0 || names.length > maximum) {
    throw new Error(`PDF conformance error: ${pdfa} DeviceN permits from 1 through ${maximum} colorants at ${context}`)
  }
  if (pdfa === 'PDF/A-1b') return
  const attributes = doc.resolve(colorSpace[4] ?? null)
  const processNames = new Set<string>()
  if (attributes instanceof Map) {
    const process = doc.resolve(attributes.get('Process') ?? null)
    if (process !== null) {
      if (!(process instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} DeviceN Process must be a dictionary at ${context}`)
      const components = doc.resolve(process.get('Components') ?? null)
      if (!Array.isArray(components) || components.length === 0) {
        throw new Error(`PDF conformance error: ${pdfa} DeviceN Process requires Components at ${context}`)
      }
      for (let index = 0; index < components.length; index++) {
        const component = doc.resolve(components[index]!)
        if (!(component instanceof PdfName)) {
          throw new Error(`PDF conformance error: ${pdfa} DeviceN Process Components must be names at ${context}`)
        }
        processNames.add(component.name)
      }
    }
  }
  const colorantsValue = attributes instanceof Map ? doc.resolve(attributes.get('Colorants') ?? null) : null
  if (colorantsValue !== null && !(colorantsValue instanceof Map)) {
    throw new Error(`PDF conformance error: ${pdfa} DeviceN Colorants must be a dictionary at ${context}`)
  }
  const colorants = colorantsValue instanceof Map ? colorantsValue : null
  for (let index = 0; index < names.length; index++) {
    const name = doc.resolve(names[index]!)
    if (!(name instanceof PdfName)) {
      throw new Error(`PDF conformance error: ${pdfa} DeviceN colorants must be names at ${context}`)
    }
    validatePdfA23Utf8Name(name.name, pdfa, `${context} DeviceN colorant`)
    if (!processNames.has(name.name) && (colorants === null || !colorants.has(name.name))) {
      throw new Error(`PDF conformance error: ${pdfa} DeviceN Colorants omits spot colorant ${name.name} at ${context}`)
    }
  }
}

function validatePdfANumber(value: number, pdfa: PdfAConformance, context: string): void {
  if (!Number.isFinite(value)) throw new Error(`PDF conformance error: ${pdfa} non-finite number at ${context}`)
  if (Number.isInteger(value)) {
    if (value < -2147483648 || value > 2147483647) {
      throw new Error(`PDF conformance error: ${pdfa} integer out of 32-bit range at ${context}`)
    }
    return
  }
  const absolute = Math.abs(value)
  if (pdfa === 'PDF/A-1b') {
    if (absolute > 32767) throw new Error(`PDF conformance error: ${pdfa} real exceeds 32767 at ${context}`)
  } else if (absolute > 3.403e38 || (absolute !== 0 && absolute < 1.175e-38)) {
    throw new Error(`PDF conformance error: ${pdfa} real is outside the permitted range at ${context}`)
  }
}

function validatePdfAStream(
  doc: ReturnType<typeof parsePdf>,
  stream: PdfStream,
  pdfa: PdfAConformance,
  context: string,
): void {
  const declaredLength = doc.resolve(stream.dict.get('Length') ?? null)
  if (typeof declaredLength !== 'number' || !Number.isInteger(declaredLength) || declaredLength !== stream.raw.length) {
    throw new Error(`PDF conformance error: ${pdfa} stream Length does not match its encoded byte length at ${context}`)
  }
  if (stream.dict.has('F') || stream.dict.has('FFilter') || stream.dict.has('FDecodeParms')) {
    throw new Error(`PDF conformance error: ${pdfa} stream forbids external-file filter entries at ${context}`)
  }
  const filters = pdfFilterNames(doc, stream.dict.get('Filter') ?? null, `${pdfa} ${context}`)
  const allowed = pdfa === 'PDF/A-1b'
    ? new Set(['ASCIIHexDecode', 'ASCII85Decode', 'FlateDecode', 'RunLengthDecode', 'CCITTFaxDecode', 'JBIG2Decode', 'DCTDecode'])
    : new Set(['ASCIIHexDecode', 'ASCII85Decode', 'FlateDecode', 'RunLengthDecode', 'CCITTFaxDecode', 'JBIG2Decode', 'DCTDecode', 'JPXDecode', 'Crypt'])
  for (let index = 0; index < filters.length; index++) {
    if (!allowed.has(filters[index]!)) throw new Error(`PDF conformance error: ${pdfa} forbids ${filters[index]} stream filters at ${context}`)
  }
  if (filters.includes('Crypt')) validatePdfAIdentityCryptFilters(doc, stream.dict, filters, context)
  if (filters.includes('JPXDecode')) validatePdfAJpxStream(doc, stream, filters, pdfa, context)
  const type = pdfNameValue(doc.resolve(stream.dict.get('Type') ?? null))
  if (type === 'Metadata') {
    if (pdfa === 'PDF/A-1b' && stream.dict.has('Filter')) {
      throw new Error(`PDF conformance error: ${pdfa} metadata streams forbid Filter at ${context}`)
    }
    if (pdfNameValue(doc.resolve(stream.dict.get('Subtype') ?? null)) !== 'XML') {
      throw new Error(`PDF conformance error: ${pdfa} metadata stream Subtype must be XML at ${context}`)
    }
    const packet = doc.decodeStream(stream)
    const packetText = new TextDecoder('utf-8', { fatal: true }).decode(packet)
    const header = /<\?xpacket\b([^?]*)\?>/.exec(packetText)
    if (header !== null && /\b(?:bytes|encoding)\s*=/.test(header[1]!)) {
      throw new Error(`PDF conformance error: ${pdfa} XMP packet header forbids bytes and encoding attributes at ${context}`)
    }
    parsePdfXmpPacket(packet)
    validatePdfAXmpPacket(packet, pdfa === 'PDF/A-1b' ? 1 : pdfa === 'PDF/A-2b' ? 2 : 3)
  }
}

function validatePdfAJpxStream(
  doc: ReturnType<typeof parsePdf>,
  stream: PdfStream,
  filters: readonly string[],
  pdfa: PdfAConformance,
  context: string,
): void {
  const jpxIndex = filters.indexOf('JPXDecode')
  if (jpxIndex !== filters.length - 1) {
    throw new Error(`PDF conformance error: ${pdfa} JPXDecode must be the final stream filter at ${context}`)
  }
  const parametersValue = doc.resolve(stream.dict.get('DecodeParms') ?? null)
  const parameters = Array.isArray(parametersValue) ? parametersValue : [parametersValue]
  let data = stream.raw
  for (let index = 0; index < jpxIndex; index++) {
    const filter = filters[index]!
    if (filter === 'ASCIIHexDecode') data = decodeAsciiHex(data)
    else if (filter === 'ASCII85Decode') data = decodeAscii85(data)
    else if (filter === 'RunLengthDecode') data = decodeRunLength(data)
    else if (filter === 'FlateDecode') {
      data = zlibInflate(data)
      const dict = doc.resolve(parameters[index] ?? null)
      if (dict instanceof Map) {
        const predictor = pdfADecodeParameter(doc, dict, 'Predictor', 1)
        if (predictor !== 1) {
          data = applyPdfPredictor(
            data,
            predictor,
            pdfADecodeParameter(doc, dict, 'Colors', 1),
            pdfADecodeParameter(doc, dict, 'BitsPerComponent', 8),
            pdfADecodeParameter(doc, dict, 'Columns', 1),
          )
        }
      }
    } else if (filter !== 'Crypt') {
      throw new Error(`PDF conformance error: ${pdfa} ${filter} cannot precede JPXDecode at ${context}`)
    }
  }
  const image = decodeJpx(data)
  if (image.colorChannels.length !== 1 && image.colorChannels.length !== 3 && image.colorChannels.length !== 4) {
    throw new Error(`PDF conformance error: ${pdfa} JPEG 2000 requires 1, 3, or 4 color channels at ${context}`)
  }
  if (image.bitsPerComponentBoxPresent || image.componentBitDepths.length === 0 || image.componentBitDepths.some(function (depth) {
    return depth < 1 || depth > 38 || depth !== image.componentBitDepths[0]
  })) {
    throw new Error(`PDF conformance error: ${pdfa} JPEG 2000 forbids BPCC and requires one shared bit depth from 1 through 38 at ${context}`)
  }
  if (doc.resolve(stream.dict.get('ColorSpace') ?? null) === null) {
    let selected = image.colorSpecifications[0]
    if (image.colorSpecifications.length > 1) {
      const best = image.colorSpecifications.filter(function (specification) { return specification.approximation === 1 })
      if (best.length !== 1) {
        throw new Error(`PDF conformance error: ${pdfa} JPEG 2000 requires exactly one best-fidelity colour specification at ${context}`)
      }
      selected = best[0]
    }
    if (selected === undefined || selected.method < 1 || selected.method > 3 || selected.enumeratedColorSpace === 19) {
      throw new Error(`PDF conformance error: ${pdfa} JPEG 2000 contains a forbidden colour specification at ${context}`)
    }
  }
}

function pdfADecodeParameter(doc: ReturnType<typeof parsePdf>, dict: PdfDict, key: string, fallback: number): number {
  const value = doc.resolve(dict.get(key) ?? null)
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

function pdfFilterNames(doc: ReturnType<typeof parsePdf>, value: PdfValue, context: string): string[] {
  const resolved = doc.resolve(value)
  if (resolved === null) return []
  if (resolved instanceof PdfName) return [resolved.name]
  if (!Array.isArray(resolved)) throw new Error(`PDF conformance error: ${context} Filter must be a name or array`)
  const result: string[] = []
  for (let index = 0; index < resolved.length; index++) {
    const filter = doc.resolve(resolved[index]!)
    if (!(filter instanceof PdfName)) throw new Error(`PDF conformance error: ${context} Filter array must contain names`)
    result.push(filter.name)
  }
  return result
}

function validatePdfAIdentityCryptFilters(
  doc: ReturnType<typeof parsePdf>,
  dict: PdfDict,
  filters: readonly string[],
  context: string,
): void {
  const parameters = doc.resolve(dict.get('DecodeParms') ?? null)
  const values = Array.isArray(parameters) ? parameters : [parameters]
  if (filters.length > 1 && (!Array.isArray(parameters) || parameters.length !== filters.length)) {
    throw new Error(`PDF conformance error: PDF/A DecodeParms must align with Filter entries at ${context}`)
  }
  for (let index = 0; index < filters.length; index++) {
    if (filters[index] !== 'Crypt') continue
    const parameter = doc.resolve(values[index] ?? null)
    if (!(parameter instanceof Map)) {
      throw new Error(`PDF conformance error: PDF/A Crypt filter requires DecodeParms at ${context}`)
    }
    const name = doc.resolve(parameter.get('Name') ?? null)
    if (!(name instanceof PdfName) || name.name !== 'Identity') {
      throw new Error(`PDF conformance error: PDF/A Crypt filter must select Identity at ${context}`)
    }
  }
}

function validatePdfAXObject(
  doc: ReturnType<typeof parsePdf>,
  dict: PdfDict,
  pdfa: PdfAConformance,
  context: string,
  subtype: string | null,
): void {
  if (subtype === 'PS') throw new Error(`PDF conformance error: ${pdfa} forbids PostScript XObjects at ${context}`)
  if (dict.has('OPI')) throw new Error(`PDF conformance error: ${pdfa} XObjects forbid OPI at ${context}`)
  if (subtype === 'Form') {
    if (pdfa === 'PDF/A-1b' && dict.has('SMask')) {
      throw new Error(`PDF conformance error: ${pdfa} Form XObjects forbid SMask at ${context}`)
    }
    if (dict.has('PS') || pdfNameValue(doc.resolve(dict.get('Subtype2') ?? null)) === 'PS') {
      throw new Error(`PDF conformance error: ${pdfa} forbids PostScript Form XObjects at ${context}`)
    }
    if (dict.has('Ref')) throw new Error(`PDF conformance error: ${pdfa} forbids reference XObjects at ${context}`)
    return
  }
  if (subtype !== 'Image') return
  if (dict.has('Alternates')) throw new Error(`PDF conformance error: ${pdfa} Image XObjects forbid Alternates at ${context}`)
  const interpolate = doc.resolve(dict.get('Interpolate') ?? null)
  if (dict.has('Interpolate') && interpolate !== false) {
    throw new Error(`PDF conformance error: ${pdfa} Image Interpolate must be false at ${context}`)
  }
  const imageMask = doc.resolve(dict.get('ImageMask') ?? null) === true
  const bits = doc.resolve(dict.get('BitsPerComponent') ?? null)
  if (dict.has('BitsPerComponent')) {
    const permitted = imageMask ? [1] : pdfa === 'PDF/A-1b' ? [1, 2, 4, 8] : [1, 2, 4, 8, 16]
    if (typeof bits !== 'number' || !permitted.includes(bits)) {
      throw new Error(`PDF conformance error: ${pdfa} Image BitsPerComponent is invalid at ${context}`)
    }
  }
  if (pdfa === 'PDF/A-1b' && dict.has('SMask')) {
    throw new Error(`PDF conformance error: ${pdfa} Image XObjects forbid SMask at ${context}`)
  }
  const intent = doc.resolve(dict.get('Intent') ?? null)
  if (dict.has('Intent') && (!(intent instanceof PdfName)
    || !['RelativeColorimetric', 'AbsoluteColorimetric', 'Perceptual', 'Saturation'].includes(intent.name))) {
    throw new Error(`PDF conformance error: ${pdfa} Image Intent is invalid at ${context}`)
  }
}

function validatePdfAExtGState(doc: ReturnType<typeof parsePdf>, dict: PdfDict, pdfa: PdfAConformance, context: string): void {
  if (dict.has('TR')) throw new Error(`PDF conformance error: ${pdfa} ExtGState forbids TR at ${context}`)
  const tr2 = doc.resolve(dict.get('TR2') ?? null)
  if (dict.has('TR2') && (!(tr2 instanceof PdfName) || tr2.name !== 'Default')) {
    throw new Error(`PDF conformance error: ${pdfa} ExtGState TR2 must be Default at ${context}`)
  }
  if (pdfa !== 'PDF/A-1b' && dict.has('HTP')) throw new Error(`PDF conformance error: ${pdfa} ExtGState forbids HTP at ${context}`)
  for (const key of ['OP', 'op']) {
    if (dict.has(key) && typeof doc.resolve(dict.get(key)!) !== 'boolean') {
      throw new Error(`PDF conformance error: ${pdfa} ExtGState ${key} must be boolean at ${context}`)
    }
  }
  if (dict.has('OPM')) {
    const mode = doc.resolve(dict.get('OPM')!)
    if (mode !== 0 && mode !== 1) {
      throw new Error(`PDF conformance error: ${pdfa} ExtGState OPM must be 0 or 1 at ${context}`)
    }
  }
  const intent = doc.resolve(dict.get('RI') ?? null)
  if (dict.has('RI') && (!(intent instanceof PdfName)
    || !['RelativeColorimetric', 'AbsoluteColorimetric', 'Perceptual', 'Saturation'].includes(intent.name))) {
    throw new Error(`PDF conformance error: ${pdfa} ExtGState rendering intent is invalid at ${context}`)
  }
  const blend = doc.resolve(dict.get('BM') ?? null)
  const standardBlendModes = new Set([
    'Normal', 'Compatible', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten',
    'ColorDodge', 'ColorBurn', 'HardLight', 'SoftLight', 'Difference', 'Exclusion',
    'Hue', 'Saturation', 'Color', 'Luminosity',
  ])
  if (dict.has('BM') && (!(blend instanceof PdfName) || !standardBlendModes.has(blend.name))) {
    throw new Error(`PDF conformance error: ${pdfa} ExtGState blend mode is invalid at ${context}`)
  }
  if (pdfa === 'PDF/A-1b') {
    if (blend !== null && (!(blend instanceof PdfName) || (blend.name !== 'Normal' && blend.name !== 'Compatible'))) {
      throw new Error(`PDF conformance error: ${pdfa} ExtGState blend mode is invalid at ${context}`)
    }
    for (const key of ['CA', 'ca']) {
      const alpha = doc.resolve(dict.get(key) ?? null)
      if (dict.has(key) && alpha !== 1) throw new Error(`PDF conformance error: ${pdfa} ExtGState ${key} must be 1 at ${context}`)
    }
    const mask = doc.resolve(dict.get('SMask') ?? null)
    if (dict.has('SMask') && (!(mask instanceof PdfName) || mask.name !== 'None')) {
      throw new Error(`PDF conformance error: ${pdfa} ExtGState SMask must be None at ${context}`)
    }
  }
}

function validatePdfAHalftone(
  doc: ReturnType<typeof parsePdf>,
  dict: PdfDict,
  pdfa: PdfAConformance,
  context: string,
  colorantNames: ReadonlySet<string> | null,
): void {
  if (pdfa === 'PDF/A-1b') return
  const type = doc.resolve(dict.get('HalftoneType') ?? null)
  if (type !== 1 && type !== 5) throw new Error(`PDF conformance error: ${pdfa} permits only HalftoneType 1 or 5 at ${context}`)
  if (dict.has('HalftoneName')) throw new Error(`PDF conformance error: ${pdfa} halftones forbid HalftoneName at ${context}`)
  const transferFunctionPresent = dict.has('TransferFunction') && doc.resolve(dict.get('TransferFunction')!) !== null
  const names: ReadonlySet<string | null> = colorantNames ?? new Set<string | null>([null])
  for (const name of names) {
    if (name === 'Default') continue
    const primary = name === null || name === 'Cyan' || name === 'Magenta' || name === 'Yellow' || name === 'Black'
    if (primary && transferFunctionPresent) {
      throw new Error(`PDF conformance error: ${pdfa} primary-colorant halftones forbid TransferFunction at ${context}`)
    }
    if (!primary && !transferFunctionPresent) {
      throw new Error(`PDF conformance error: ${pdfa} custom-colorant halftone ${name} requires TransferFunction at ${context}`)
    }
  }
}

function collectPdfAHalftoneColorants(
  doc: ReturnType<typeof parsePdf>,
  catalog: PdfDict,
): Map<PdfDict, Set<string>> {
  const result = new Map<PdfDict, Set<string>>()
  const visitedRefs = new Set<string>()
  const visitedObjects = new Set<object>()

  const visit = function (source: PdfValue): void {
    if (source instanceof PdfRef) {
      const key = `${source.num}:${source.gen}`
      if (visitedRefs.has(key)) return
      visitedRefs.add(key)
      visit(doc.resolve(source))
      return
    }
    if (source instanceof PdfStream) {
      if (visitedObjects.has(source)) return
      visitedObjects.add(source)
      visit(source.dict)
      return
    }
    if (Array.isArray(source)) {
      if (visitedObjects.has(source)) return
      visitedObjects.add(source)
      for (let index = 0; index < source.length; index++) visit(source[index]!)
      return
    }
    if (!(source instanceof Map) || visitedObjects.has(source)) return
    visitedObjects.add(source)
    if (doc.resolve(source.get('HalftoneType') ?? null) === 5) {
      for (const [name, value] of source) {
        if (name === 'Type' || name === 'HalftoneType' || name === 'HalftoneName') continue
        const component = doc.resolve(value)
        const dictionary = component instanceof PdfStream ? component.dict : component
        if (!(dictionary instanceof Map) || !dictionary.has('HalftoneType')) continue
        let names = result.get(dictionary)
        if (names === undefined) {
          names = new Set<string>()
          result.set(dictionary, names)
        }
        names.add(name)
      }
    }
    for (const value of source.values()) visit(value)
  }

  visit(doc.trailer)
  visit(catalog)
  const references = doc.getObjectReferences()
  for (let index = 0; index < references.length; index++) visit(references[index]!)
  return result
}

function validatePdfAFileSpecification(
  doc: ReturnType<typeof parsePdf>,
  fileSpec: PdfDict,
  pdfa: PdfAConformance,
  context: string,
): void {
  const embedded = doc.resolve(fileSpec.get('EF') ?? null)
  if (embedded === null) return
  if (pdfa === 'PDF/A-1b') throw new Error(`PDF conformance error: ${pdfa} file specifications forbid EF at ${context}`)
  if (!(embedded instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} EF must be a dictionary at ${context}`)
  if (!(doc.resolve(fileSpec.get('F') ?? null) instanceof PdfString)
    || !(doc.resolve(fileSpec.get('UF') ?? null) instanceof PdfString)) {
    throw new Error(`PDF conformance error: ${pdfa} embedded file specifications require F and UF at ${context}`)
  }
  const streams = new Set<PdfStream>()
  for (const value of embedded.values()) {
    const stream = doc.resolve(value)
    if (!(stream instanceof PdfStream)) throw new Error(`PDF conformance error: ${pdfa} EF entries must reference streams at ${context}`)
    streams.add(stream)
  }
  if (pdfa === 'PDF/A-2b') {
    for (const stream of streams) validateEmbeddedPdfA12(doc.decodeStream(stream), `${pdfa} embedded file at ${context}`)
  }
  if (pdfa === 'PDF/A-3b') {
    const relationship = doc.resolve(fileSpec.get('AFRelationship') ?? null)
    if (!(relationship instanceof PdfName) || !PDFA3_AF_RELATIONSHIPS.has(relationship.name as PdfAFRelationship)) {
      throw new Error(`PDF conformance error: ${pdfa} embedded file specifications require AFRelationship at ${context}`)
    }
    for (const stream of streams) {
      const mime = pdfNameValue(doc.resolve(stream.dict.get('Subtype') ?? null))
      if (mime === null || !/^[-\w+.]+\/[-\w+.]+$/.test(mime)) {
        throw new Error(`PDF conformance error: ${pdfa} embedded files require a valid MIME Subtype at ${context}`)
      }
    }
  }
}

function validatePdfAInteractiveObjects(
  doc: ReturnType<typeof parsePdf>,
  catalog: PdfDict,
  pdfa: PdfAConformance,
  outputColorSpace: string | null,
): void {
  if (catalog.has('AA')) throw new Error(`PDF conformance error: ${pdfa} forbids Catalog AA actions`)
  const permitted = pdfa === 'PDF/A-1b' ? PDFA1_ANNOTATION_SUBTYPES : PDFA23_ANNOTATION_SUBTYPES
  const pages = collectPdfPages(doc)
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]!.dict
    if (page.has('AA')) throw new Error(`PDF conformance error: ${pdfa} forbids page ${pageIndex + 1} AA actions`)
    const annotations = doc.resolve(page.get('Annots') ?? null)
    if (annotations === null) continue
    if (!Array.isArray(annotations)) throw new Error(`PDF conformance error: ${pdfa} page ${pageIndex + 1} Annots must be an array`)
    for (let index = 0; index < annotations.length; index++) {
      const annotation = doc.resolve(annotations[index]!)
      if (!(annotation instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} annotation must be a dictionary`)
      const subtype = doc.resolve(annotation.get('Subtype') ?? null)
      if (!(subtype instanceof PdfName) || !permitted.has(subtype.name)) {
        throw new Error(`PDF conformance error: ${pdfa} forbids annotation subtype ${subtype instanceof PdfName ? subtype.name : '(missing)'}`)
      }
      const flagsValue = doc.resolve(annotation.get('F') ?? null)
      const popupMayOmitFlags = pdfa !== 'PDF/A-1b' && subtype.name === 'Popup'
      if (flagsValue === null && !popupMayOmitFlags) throw new Error(`PDF conformance error: ${pdfa} ${subtype.name} annotation requires F`)
      if (flagsValue !== null) {
        if (typeof flagsValue !== 'number' || !Number.isInteger(flagsValue)) {
          throw new Error(`PDF conformance error: ${pdfa} annotation F must be an integer`)
        }
        const forbidden = pdfa === 'PDF/A-1b' ? 1 | 2 | 32 : 1 | 2 | 32 | 256
        if ((flagsValue & 4) === 0 || (flagsValue & forbidden) !== 0) {
          throw new Error(`PDF conformance error: ${pdfa} annotation must be printable and visible`)
        }
      }
      if (pdfa === 'PDF/A-1b') {
        const opacity = doc.resolve(annotation.get('CA') ?? null)
        if (annotation.has('CA') && opacity !== 1) throw new Error('PDF conformance error: PDF/A-1b annotation CA must be 1')
        if (outputColorSpace !== 'RGB' && (annotation.has('C') || annotation.has('IC'))) {
          throw new Error('PDF conformance error: PDF/A-1b annotation C and IC require an RGB OutputIntent profile')
        }
      }
      const appearance = doc.resolve(annotation.get('AP') ?? null)
      const rectangle = doc.resolve(annotation.get('Rect') ?? null)
      const zeroArea = Array.isArray(rectangle) && rectangle.length === 4
        && rectangle[0] === rectangle[2] && rectangle[1] === rectangle[3]
      if (pdfa !== 'PDF/A-1b' && subtype.name !== 'Popup' && subtype.name !== 'Link' && !zeroArea && !(appearance instanceof Map)) {
        throw new Error(`PDF conformance error: ${pdfa} ${subtype.name} annotation requires an appearance dictionary`)
      }
      if (appearance instanceof Map) {
        if (appearance.size !== 1 || !appearance.has('N')) {
          throw new Error(`PDF conformance error: ${pdfa} annotation appearance dictionary may contain only N`)
        }
        const normal = doc.resolve(appearance.get('N') ?? null)
        const fieldType = doc.resolve(annotation.get('FT') ?? null)
        const buttonWidget = subtype.name === 'Widget' && fieldType instanceof PdfName && fieldType.name === 'Btn'
        if (buttonWidget ? !(normal instanceof Map) : !(normal instanceof PdfStream)) {
          throw new Error(`PDF conformance error: ${pdfa} annotation has an invalid normal appearance`)
        }
      }
      if (subtype.name === 'Widget' && (annotation.has('A') || annotation.has('AA'))) {
        throw new Error(`PDF conformance error: ${pdfa} Widget annotations forbid A and AA`)
      }
      const action = annotation.get('A')
      if (action !== undefined) validatePdfAActionDictionary(doc, pdfa, action)
      const additionalActions = doc.resolve(annotation.get('AA') ?? null)
      if (additionalActions instanceof Map) {
        for (const value of additionalActions.values()) validatePdfAActionDictionary(doc, pdfa, value)
      }
    }
  }

  const acroForm = doc.resolve(catalog.get('AcroForm') ?? null)
  if (acroForm instanceof Map) {
    const needAppearances = doc.resolve(acroForm.get('NeedAppearances') ?? null)
    if (needAppearances !== null && needAppearances !== false) {
      throw new Error(`PDF conformance error: ${pdfa} AcroForm NeedAppearances must be false or absent`)
    }
    if (acroForm.has('XFA')) throw new Error(`PDF conformance error: ${pdfa} forbids AcroForm XFA`)
    const fields = doc.resolve(acroForm.get('Fields') ?? null)
    if (Array.isArray(fields)) validatePdfAFieldActions(doc, pdfa, fields, new Set<number>(), null)
  }
}

function validatePdfAOptionalContentDictionaries(doc: ReturnType<typeof parsePdf>, catalog: PdfDict, pdfa: PdfAConformance): void {
  const properties = doc.resolve(catalog.get('OCProperties') ?? null)
  if (pdfa === 'PDF/A-1b') {
    if (properties !== null) throw new Error('PDF conformance error: PDF/A-1b forbids OCProperties')
    return
  }
  if (properties === null) return
  if (!(properties instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} OCProperties must be a dictionary`)
  const groups = doc.resolve(properties.get('OCGs') ?? null)
  if (!Array.isArray(groups)) throw new Error(`PDF conformance error: ${pdfa} OCProperties requires OCGs`)
  const groupIds = new Set<number>()
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]!
    if (!(group instanceof PdfRef)) throw new Error(`PDF conformance error: ${pdfa} OCGs entries must be indirect references`)
    groupIds.add(group.num)
  }
  const configurations: PdfDict[] = []
  const defaultConfiguration = doc.resolve(properties.get('D') ?? null)
  if (!(defaultConfiguration instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} OCProperties requires D`)
  configurations.push(defaultConfiguration)
  const alternates = doc.resolve(properties.get('Configs') ?? null)
  if (alternates !== null) {
    if (!Array.isArray(alternates)) throw new Error(`PDF conformance error: ${pdfa} Configs must be an array`)
    for (let index = 0; index < alternates.length; index++) {
      const configuration = doc.resolve(alternates[index]!)
      if (!(configuration instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} Configs entries must be dictionaries`)
      configurations.push(configuration)
    }
  }
  const names = new Set<string>()
  for (let index = 0; index < configurations.length; index++) {
    const configuration = configurations[index]!
    const nameValue = doc.resolve(configuration.get('Name') ?? null)
    if (!(nameValue instanceof PdfString) || nameValue.bytes.length === 0) {
      throw new Error(`PDF conformance error: ${pdfa} optional-content configuration requires a non-empty Name`)
    }
    const name = pdfBytesToLatin1(nameValue.bytes)
    if (names.has(name)) throw new Error(`PDF conformance error: ${pdfa} optional-content configuration names must be unique`)
    names.add(name)
    if (configuration.has('AS')) throw new Error(`PDF conformance error: ${pdfa} optional-content configurations forbid AS`)
    const order = doc.resolve(configuration.get('Order') ?? null)
    if (order !== null) {
      if (!Array.isArray(order)) throw new Error(`PDF conformance error: ${pdfa} optional-content Order must be an array`)
      const ordered = new Set<number>()
      collectPdfOptionalContentOrderRefs(order, ordered)
      for (const groupId of groupIds) {
        if (!ordered.has(groupId)) throw new Error(`PDF conformance error: ${pdfa} optional-content Order omits an OCG`)
      }
    }
  }
}

function collectPdfOptionalContentOrderRefs(items: PdfValue[], target: Set<number>): void {
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    if (item instanceof PdfRef) target.add(item.num)
    else if (Array.isArray(item)) collectPdfOptionalContentOrderRefs(item, target)
  }
}

function validatePdfAFieldActions(
  doc: ReturnType<typeof parsePdf>,
  pdfa: PdfAConformance,
  fields: PdfValue[],
  visited: Set<number>,
  inheritedFieldType: PdfName | null,
): void {
  for (let index = 0; index < fields.length; index++) {
    const source = fields[index]!
    if (source instanceof PdfRef) {
      if (visited.has(source.num)) continue
      visited.add(source.num)
    }
    const field = doc.resolve(source)
    if (!(field instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} field must be a dictionary`)
    if (field.has('A') || field.has('AA')) throw new Error(`PDF conformance error: ${pdfa} form fields forbid A and AA`)
    const ownFieldType = doc.resolve(field.get('FT') ?? null)
    if (ownFieldType !== null && !(ownFieldType instanceof PdfName)) {
      throw new Error(`PDF conformance error: ${pdfa} form field FT must be a name`)
    }
    const fieldType = ownFieldType instanceof PdfName ? ownFieldType : inheritedFieldType
    const subtype = doc.resolve(field.get('Subtype') ?? null)
    if (subtype instanceof PdfName && subtype.name === 'Widget') {
      validatePdfAFieldAppearance(doc, pdfa, field, fieldType)
    }
    const kids = doc.resolve(field.get('Kids') ?? null)
    if (Array.isArray(kids) && kids.length > 0) {
      validatePdfAFieldActions(doc, pdfa, kids, visited, fieldType)
    } else if (!(subtype instanceof PdfName) || subtype.name !== 'Widget') {
      throw new Error(`PDF conformance error: ${pdfa} terminal form fields require a Widget appearance`)
    }
  }
}

function validatePdfAFieldAppearance(
  doc: ReturnType<typeof parsePdf>,
  pdfa: PdfAConformance,
  field: PdfDict,
  fieldType: PdfName | null,
): void {
  if (pdfa !== 'PDF/A-1b') {
    const rectangle = doc.resolve(field.get('Rect') ?? null)
    if (Array.isArray(rectangle) && rectangle.length === 4
      && doc.resolve(rectangle[0]!) === doc.resolve(rectangle[2]!)
      && doc.resolve(rectangle[1]!) === doc.resolve(rectangle[3]!)) return
  }
  const appearance = doc.resolve(field.get('AP') ?? null)
  if (!(appearance instanceof Map) || appearance.size !== 1 || !appearance.has('N')) {
    throw new Error(`PDF conformance error: ${pdfa} Widget form fields require a normal appearance`)
  }
  const normal = doc.resolve(appearance.get('N')!)
  const button = fieldType?.name === 'Btn'
  if (button ? !(normal instanceof Map) : !(normal instanceof PdfStream)) {
    throw new Error(`PDF conformance error: ${pdfa} Widget form field has an invalid normal appearance`)
  }
}

function validatePdfAActionDictionary(
  doc: ReturnType<typeof parsePdf>,
  pdfa: PdfAConformance,
  value: PdfValue,
  visited = new Set<PdfDict>(),
): void {
  const action = doc.resolve(value)
  if (!(action instanceof Map)) throw new Error(`PDF conformance error: ${pdfa} action must be a dictionary`)
  if (visited.has(action)) return
  visited.add(action)
  const subtype = doc.resolve(action.get('S') ?? null)
  const permitted = pdfa === 'PDF/A-1b'
    ? new Set(['GoTo', 'GoToR', 'Thread', 'URI', 'Named', 'SubmitForm'])
    : new Set(['GoTo', 'GoToR', 'GoToE', 'Thread', 'URI', 'Named', 'SubmitForm'])
  if (!(subtype instanceof PdfName) || !permitted.has(subtype.name)) {
    throw new Error(`PDF conformance error: ${pdfa} forbids ${subtype instanceof PdfName ? subtype.name : '(missing)'} actions`)
  }
  if (subtype.name === 'Named') {
    const named = doc.resolve(action.get('N') ?? null)
    if (!(named instanceof PdfName) || (named.name !== 'NextPage' && named.name !== 'PrevPage'
      && named.name !== 'FirstPage' && named.name !== 'LastPage')) {
      throw new Error(`PDF conformance error: ${pdfa} permits only the four page-navigation named actions`)
    }
  }
  const next = doc.resolve(action.get('Next') ?? null)
  if (next instanceof Map) validatePdfAActionDictionary(doc, pdfa, next, visited)
  else if (Array.isArray(next)) {
    for (let index = 0; index < next.length; index++) validatePdfAActionDictionary(doc, pdfa, next[index]!, visited)
  } else if (next !== null) {
    throw new Error(`PDF conformance error: ${pdfa} action Next must be a dictionary or array`)
  }
}

function requirePdfXmpMetadata(doc: ReturnType<typeof parsePdf>, catalog: PdfDict, label: string): string {
  const metadata = doc.resolve(catalog.get('Metadata') ?? null)
  if (!(metadata instanceof PdfStream)) throw new Error(`PDF conformance error: ${label} requires XMP metadata`)
  requirePdfName(metadata.dict.get('Type') ?? null, 'Metadata', `${label} requires Metadata stream Type`)
  requirePdfName(metadata.dict.get('Subtype') ?? null, 'XML', `${label} requires XML metadata`)
  if (label === 'PDF/A-1b' && metadata.dict.has('Filter')) {
    throw new Error('PDF conformance error: PDF/A-1b Catalog metadata stream must not be filtered')
  }
  const bytes = doc.decodeStream(metadata)
  const packet = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const header = /<\?xpacket\b([^?]*)\?>/.exec(packet)
  if (header !== null && /\b(?:bytes|encoding)\s*=/.test(header[1]!)) {
    throw new Error(`PDF conformance error: ${label} XMP packet header forbids bytes and encoding attributes`)
  }
  parsePdfXmpPacket(bytes)
  if (label === 'PDF/A-1b' || label === 'PDF/A-2b' || label === 'PDF/A-3b') {
    validatePdfAXmpPacket(bytes, label === 'PDF/A-1b' ? 1 : label === 'PDF/A-2b' ? 2 : 3)
  }
  return packet
}

function requirePdfAXmpIdentification(xmp: string, pdfa: PdfAConformance): void {
  const part = pdfa === 'PDF/A-1b' ? '1' : pdfa === 'PDF/A-2b' ? '2' : '3'
  const partMatch = /<pdfaid:part>\s*([123])\s*<\/pdfaid:part>/.exec(xmp)
  if (partMatch === null || partMatch[1] !== part) {
    throw new Error(`PDF conformance error: ${pdfa} requires matching XMP PDF/A part`)
  }
  const conformance = /<pdfaid:conformance>\s*([ABU])\s*<\/pdfaid:conformance>/.exec(xmp)
  const permitted = pdfa === 'PDF/A-1b' ? ['A', 'B'] : ['A', 'B', 'U']
  if (conformance === null || !permitted.includes(conformance[1]!)) {
    throw new Error(`PDF conformance error: ${pdfa} requires XMP PDF/A conformance`)
  }
}

function validatePdfXInfo(
  doc: ReturnType<typeof parsePdf>,
  pdfx: PdfXConformance,
): void {
  const info = doc.resolve(doc.trailer.get('Info') ?? null)
  if (!(info instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} requires an Info dictionary`)
  const version = requiredPdfXInfoText(doc, info, 'GTS_PDFXVersion', pdfx)
  if (version !== 'PDF/X-1a:2003') throw new Error(`PDF conformance error: ${pdfx} GTS_PDFXVersion must be PDF/X-1a:2003`)
  requiredPdfXInfoText(doc, info, 'Title', pdfx)
  const creationDate = requiredPdfXInfoText(doc, info, 'CreationDate', pdfx)
  const modificationDate = requiredPdfXInfoText(doc, info, 'ModDate', pdfx)
  parsePdfConformanceDate(creationDate, `${pdfx} Info CreationDate`)
  parsePdfConformanceDate(modificationDate, `${pdfx} Info ModDate`)
  const trapped = doc.resolve(info.get('Trapped') ?? null)
  if (!(trapped instanceof PdfName) || (trapped.name !== 'True' && trapped.name !== 'False')) {
    throw new Error(`PDF conformance error: ${pdfx} Info Trapped must be True or False`)
  }
}

function requiredPdfXInfoText(doc: ReturnType<typeof parsePdf>, info: PdfDict, key: string, pdfx: PdfXConformance): string {
  const value = doc.resolve(info.get(key) ?? null)
  if (!(value instanceof PdfString)) throw new Error(`PDF conformance error: ${pdfx} Info ${key} must be a text string`)
  const text = decodePdfTextStringBytes(value.bytes)
  if (text.length === 0) throw new Error(`PDF conformance error: ${pdfx} Info ${key} must not be empty`)
  return text
}

function requireInfoMatchesXmp(
  doc: ReturnType<typeof parsePdf>,
  catalog: PdfDict,
  label: string,
): void {
  const metadata = doc.resolve(catalog.get('Metadata') ?? null)
  if (!(metadata instanceof PdfStream)) throw new Error(`PDF conformance error: ${label} requires XMP metadata`)
  const parsed = parsePdfXmpPacket(doc.decodeStream(metadata))
  const info = doc.resolve(doc.trailer.get('Info') ?? null)
  if (info === null) return
  if (!(info instanceof Map)) throw new Error(`PDF conformance error: ${label} Info must be a dictionary`)
  const synchronized: PdfMetadata = {}
  const title = pdfInfoString(doc, 'Title')
  const author = pdfInfoString(doc, 'Author')
  const subject = pdfInfoString(doc, 'Subject')
  const keywords = pdfInfoString(doc, 'Keywords')
  const creator = pdfInfoString(doc, 'Creator')
  const producer = pdfInfoString(doc, 'Producer')
  const creationDate = pdfInfoString(doc, 'CreationDate')
  const modDate = pdfInfoString(doc, 'ModDate')
  if (title !== null) synchronized.title = title
  if (author !== null) synchronized.author = author
  if (subject !== null) synchronized.subject = subject
  if (keywords !== null) synchronized.keywords = keywords
  if (creator !== null) synchronized.creator = creator
  if (producer !== null) synchronized.producer = producer
  if (creationDate !== null) synchronized.creationDate = parsePdfConformanceDate(creationDate, `${label} Info CreationDate`)
  if (modDate !== null) synchronized.modDate = parsePdfConformanceDate(modDate, `${label} Info ModDate`)
  const trapped = doc.resolve(info.get('Trapped') ?? null)
  if (trapped !== null) {
    if (!(trapped instanceof PdfName) || (trapped.name !== 'True' && trapped.name !== 'False' && trapped.name !== 'Unknown')) {
      throw new Error(`PDF conformance error: ${label} Info Trapped is invalid`)
    }
    synchronized.trapped = trapped.name === 'True' ? true : trapped.name === 'False' ? false : 'unknown'
  }
  if (author !== null && parsed.authorEntryCount !== 1) {
    throw new Error(`PDF conformance error: ${label} XMP dc:creator must contain exactly one entry when Info Author is present`)
  }
  try {
    validatePdfXmpSynchronization(synchronized, parsed)
  } catch (error) {
    throw new Error(`PDF conformance error: ${label} ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parsePdfConformanceDate(value: string, label: string): Date {
  const match = /^D:(\d{4})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(Z)|([+\-])(\d{2})(?:'(\d{2})'?)?)?)?)?)?)?)?$/.exec(value)
  if (match === null) throw new Error(`PDF conformance error: ${label} is not a PDF date`)
  const year = Number(match[1])
  const month = Number(match[2] ?? '01')
  const day = Number(match[3] ?? '01')
  const hour = Number(match[4] ?? '00')
  const minute = Number(match[5] ?? '00')
  const second = Number(match[6] ?? '00')
  const offsetHour = Number(match[9] ?? '00')
  const offsetMinute = Number(match[10] ?? '00')
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) {
    throw new Error(`PDF conformance error: ${label} contains an out-of-range field`)
  }
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`PDF conformance error: ${label} contains an invalid calendar date`)
  }
  let offset = offsetHour * 60 + offsetMinute
  if (match[8] === '-') offset = -offset
  if (match[8] === undefined) offset = 0
  return new Date(date.getTime() - offset * 60000)
}

function pdfInfoString(doc: ReturnType<typeof parsePdf>, key: string): string | null {
  const info = doc.resolve(doc.trailer.get('Info') ?? null)
  if (!(info instanceof Map)) return null
  const value = doc.resolve(info.get(key) ?? null)
  if (info.has(key) && !(value instanceof PdfString)) {
    throw new Error(`PDF conformance error: Info ${key} must be a string`)
  }
  if (value instanceof PdfString) return decodePdfTextStringBytes(value.bytes)
  return null
}

function requirePdfXPageBoxes(doc: ReturnType<typeof parsePdf>, pdfx: PdfXConformance): void {
  const pages = collectPdfPages(doc)
  if (pages.length === 0) throw new Error(`PDF conformance error: ${pdfx} requires at least one page`)
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    const mediaBox = requirePdfRect(doc, page.mediaBox, `${pdfx} requires page ${i + 1} MediaBox`)
    const hasTrimBox = page.dict.has('TrimBox')
    const hasArtBox = page.dict.has('ArtBox')
    if (hasTrimBox === hasArtBox) {
      throw new Error(`PDF conformance error: ${pdfx} page ${i + 1} requires exactly one of TrimBox or ArtBox`)
    }
    const finishedBoxName = hasTrimBox ? 'TrimBox' : 'ArtBox'
    const finishedBox = requirePdfRect(doc, page.dict.get(finishedBoxName)!, `${pdfx} requires page ${i + 1} ${finishedBoxName}`)
    requirePdfRectInside(finishedBox, mediaBox, `${pdfx} requires page ${i + 1} ${finishedBoxName} inside MediaBox`)
    const cropValue = doc.resolve(page.cropBox)
    const cropBox = cropValue === null ? null : requirePdfRect(doc, page.cropBox, `${pdfx} page ${i + 1} CropBox is invalid`)
    if (cropBox !== null) {
      requirePdfRectInside(cropBox, mediaBox, `${pdfx} requires page ${i + 1} CropBox inside MediaBox`)
      requirePdfRectInside(finishedBox, cropBox, `${pdfx} requires page ${i + 1} ${finishedBoxName} inside CropBox`)
    }
    const bleedValue = doc.resolve(page.dict.get('BleedBox') ?? null)
    if (bleedValue !== null) {
      const bleedBox = requirePdfRect(doc, bleedValue, `${pdfx} page ${i + 1} BleedBox is invalid`)
      requirePdfRectInside(bleedBox, mediaBox, `${pdfx} requires page ${i + 1} BleedBox inside MediaBox`)
      requirePdfRectInside(finishedBox, bleedBox, `${pdfx} requires page ${i + 1} ${finishedBoxName} inside BleedBox`)
      if (cropBox !== null) requirePdfRectInside(bleedBox, cropBox, `${pdfx} requires page ${i + 1} BleedBox inside CropBox`)
    }
  }
}

function requirePdfXNoInteractiveFeatures(catalog: PdfDict, doc: ReturnType<typeof parsePdf>, pdfx: PdfXConformance): void {
  if (doc.resolve(catalog.get('OpenAction') ?? null) !== null) {
    throw new Error(`PDF conformance error: ${pdfx} forbids document open actions`)
  }
  if (doc.resolve(catalog.get('AA') ?? null) !== null) {
    throw new Error(`PDF conformance error: ${pdfx} forbids additional document actions`)
  }
  if (doc.resolve(catalog.get('Collection') ?? null) !== null) {
    throw new Error(`PDF conformance error: ${pdfx} forbids collection dictionaries`)
  }
  const names = doc.resolve(catalog.get('Names') ?? null)
  if (names instanceof Map) {
    if (names.has('JavaScript')) throw new Error(`PDF conformance error: ${pdfx} forbids JavaScript name trees`)
    if (names.has('EmbeddedFiles')) throw new Error(`PDF conformance error: ${pdfx} forbids embedded file name trees`)
    if (names.has('Renditions')) throw new Error(`PDF conformance error: ${pdfx} forbids rendition name trees`)
  }
  const pages = collectPdfPages(doc)
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    const annotations = doc.resolve(page.dict.get('Annots') ?? null)
    if (annotations !== null) validatePdfXAnnotations(doc, page.dict, page.resources, annotations, pdfx, i + 1)
    if (page.dict.has('AA')) throw new Error(`PDF conformance error: ${pdfx} forbids page ${i + 1} additional actions`)
  }
}

function validatePdfXAnnotations(
  doc: ReturnType<typeof parsePdf>,
  page: PdfDict,
  pageResources: PdfValue,
  value: PdfValue,
  pdfx: PdfXConformance,
  pageNumber: number,
): void {
  if (!Array.isArray(value)) throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} Annots must be an array`)
  const trimBoxValue = page.get('TrimBox')
  const finishedBoxName = trimBoxValue === undefined ? 'ArtBox' : 'TrimBox'
  const finishedBox = requirePdfRect(doc, trimBoxValue ?? page.get('ArtBox') ?? null, `${pdfx} page ${pageNumber} ${finishedBoxName} is invalid`)
  const bleedValue = doc.resolve(page.get('BleedBox') ?? null)
  const nonPrintBoundary = bleedValue === null
    ? finishedBox
    : requirePdfRect(doc, bleedValue, `${pdfx} page ${pageNumber} BleedBox is invalid`)
  let hasTrapNet = false
  for (let index = 0; index < value.length; index++) {
    const annotation = doc.resolve(value[index]!)
    if (!(annotation instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} annotation must be a dictionary`)
    const subtype = pdfNameValue(doc.resolve(annotation.get('Subtype') ?? null))
    if (subtype === null) throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} annotation requires Subtype`)
    const rect = requirePdfRect(doc, annotation.get('Rect') ?? null, `${pdfx} page ${pageNumber} ${subtype} annotation requires Rect`)
    if (annotation.has('A') || annotation.has('AA')) {
      throw new Error(`PDF conformance error: ${pdfx} annotations forbid actions`)
    }
    const opacity = doc.resolve(annotation.get('CA') ?? null)
    if (opacity !== null && opacity !== 1) {
      throw new Error(`PDF conformance error: ${pdfx} annotation CA must be 1`)
    }
    if (subtype !== 'PrinterMark' && subtype !== 'TrapNet') {
      requirePdfRectOutside(rect, nonPrintBoundary, `${pdfx} page ${pageNumber} ${subtype} annotation must lie outside ${bleedValue === null ? finishedBoxName : 'BleedBox'}`)
      continue
    }
    const flags = doc.resolve(annotation.get('F') ?? null)
    if (flags !== 68) {
      throw new Error(`PDF conformance error: ${pdfx} ${subtype} annotations require Print and ReadOnly flags only`)
    }
    const appearance = doc.resolve(annotation.get('AP') ?? null)
    if (!(appearance instanceof Map) || !appearance.has('N')) {
      throw new Error(`PDF conformance error: ${pdfx} ${subtype} annotations require a normal appearance`)
    }
    if (subtype === 'PrinterMark') {
      requirePdfRectOutside(rect, finishedBox, `${pdfx} page ${pageNumber} PrinterMark annotation must lie outside ${finishedBoxName}`)
      validatePdfXPrepressAppearanceState(doc, appearance, annotation, pdfx, pageNumber, subtype, false)
      continue
    }
    if (hasTrapNet || index !== value.length - 1) {
      throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} requires one TrapNet annotation at most and as the last Annots entry`)
    }
    hasTrapNet = true
    const info = doc.resolve(doc.trailer.get('Info') ?? null)
    if (!(info instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} requires an Info dictionary`)
    const trapped = doc.resolve(info.get('Trapped') ?? null)
    if (!(trapped instanceof PdfName) || trapped.name !== 'True') {
      throw new Error(`PDF conformance error: ${pdfx} TrapNet annotations require Info Trapped True`)
    }
    const fauxed = doc.resolve(annotation.get('FontFauxing') ?? null)
    if (fauxed !== null && (!Array.isArray(fauxed) || fauxed.length !== 0)) {
      throw new Error(`PDF conformance error: ${pdfx} TrapNet FontFauxing must be absent or empty`)
    }
    validatePdfXPrepressAppearanceState(doc, appearance, annotation, pdfx, pageNumber, subtype, true)
    validatePdfXTrapNetInvalidation(doc, page, pageResources, value, annotation, pdfx, pageNumber)
    validatePdfXTrapNetAppearance(doc, appearance.get('N')!, pdfx, pageNumber)
  }
}

function validatePdfXPrepressAppearanceState(
  doc: ReturnType<typeof parsePdf>,
  appearance: PdfDict,
  annotation: PdfDict,
  pdfx: PdfXConformance,
  pageNumber: number,
  subtype: 'PrinterMark' | 'TrapNet',
  requireState: boolean,
): void {
  const normal = doc.resolve(appearance.get('N')!)
  const state = doc.resolve(annotation.get('AS') ?? null)
  if (normal instanceof PdfStream) {
    if (requireState && !(state instanceof PdfName)) {
      throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} ${subtype} annotation requires an AS name`)
    }
    return
  }
  if (!(normal instanceof Map) || !(state instanceof PdfName) || !normal.has(state.name)) {
    throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} ${subtype} annotation AS must select a normal appearance`)
  }
}

function validatePdfXTrapNetInvalidation(
  doc: ReturnType<typeof parsePdf>,
  page: PdfDict,
  pageResources: PdfValue,
  annotations: PdfValue[],
  trapNet: PdfDict,
  pdfx: PdfXConformance,
  pageNumber: number,
): void {
  const lastModified = doc.resolve(trapNet.get('LastModified') ?? null)
  const versionValue = doc.resolve(trapNet.get('Version') ?? null)
  const statesValue = doc.resolve(trapNet.get('AnnotStates') ?? null)
  const hasVersionState = Array.isArray(versionValue) && Array.isArray(statesValue)
  if ((lastModified instanceof PdfString) === hasVersionState) {
    throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet requires exactly one invalidation method`)
  }
  if (lastModified !== null) {
    if (!(lastModified instanceof PdfString) || versionValue !== null || statesValue !== null) {
      throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet LastModified is invalid`)
    }
    const trapDate = parsePdfConformanceDate(decodePdfTextStringBytes(lastModified.bytes), `${pdfx} page ${pageNumber} TrapNet LastModified`)
    const pageModified = doc.resolve(page.get('LastModified') ?? null)
    if (pageModified !== null) {
      if (!(pageModified instanceof PdfString)) throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} LastModified must be a date string`)
      const pageDate = parsePdfConformanceDate(decodePdfTextStringBytes(pageModified.bytes), `${pdfx} page ${pageNumber} LastModified`)
      if (pageDate.getTime() > trapDate.getTime()) {
        throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet is older than the page description`)
      }
    }
    return
  }
  if (!Array.isArray(versionValue) || !Array.isArray(statesValue)) {
    throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet Version and AnnotStates must both be arrays`)
  }
  const versionReferences = new Set<string>()
  for (let index = 0; index < versionValue.length; index++) {
    const reference = versionValue[index]!
    if (!(reference instanceof PdfRef)) throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet Version entries must be indirect references`)
    versionReferences.add(`${reference.num}:${reference.gen}`)
  }
  const requiredReferences = collectPdfXTrapNetVersionReferences(doc, page, pageResources, pdfx, pageNumber)
  for (const reference of requiredReferences) {
    if (!versionReferences.has(reference)) {
      throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet Version omits page content or resource ${reference}`)
    }
  }
  if (statesValue.length !== annotations.length - 1) {
    throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet AnnotStates must match every preceding annotation`)
  }
  for (let index = 0; index < statesValue.length; index++) {
    const annotation = doc.resolve(annotations[index]!)
    if (!(annotation instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} annotation ${index + 1} is invalid`)
    const expected = doc.resolve(annotation.get('AS') ?? null)
    const actual = doc.resolve(statesValue[index]!)
    if (expected === null ? actual !== null : !(expected instanceof PdfName && actual instanceof PdfName && expected.name === actual.name)) {
      throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet AnnotStates entry ${index + 1} does not match the annotation AS`)
    }
  }
}

function collectPdfXTrapNetVersionReferences(
  doc: ReturnType<typeof parsePdf>,
  page: PdfDict,
  pageResources: PdfValue,
  pdfx: PdfXConformance,
  pageNumber: number,
): Set<string> {
  const references = new Set<string>()
  const addReference = function (value: PdfValue): PdfValue {
    if (value instanceof PdfRef) references.add(`${value.num}:${value.gen}`)
    return doc.resolve(value)
  }
  const rawContents = page.get('Contents')
  if (rawContents !== undefined && doc.resolve(rawContents) !== null) {
    const contents = doc.resolve(rawContents)
    const contentValues = Array.isArray(contents) ? contents : [rawContents]
    for (let index = 0; index < contentValues.length; index++) {
      const value = contentValues[index]!
      if (!(value instanceof PdfRef)) throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet requires indirect page content streams`)
      addReference(value)
    }
  }
  const visitedResources = new Set<PdfDict>()
  const visitResources = function (value: PdfValue): void {
    const resources = addReference(value)
    if (!(resources instanceof Map) || visitedResources.has(resources)) return
    visitedResources.add(resources)
    for (const [category, categoryValue] of resources) {
      if (category === 'ProcSet') continue
      const dictionary = addReference(categoryValue)
      if (!(dictionary instanceof Map)) continue
      for (const resourceValue of dictionary.values()) {
        const resource = addReference(resourceValue)
        if (resource instanceof PdfStream && pdfNameValue(doc.resolve(resource.dict.get('Subtype') ?? null)) === 'Form') {
          const nested = resource.dict.get('Resources')
          if (nested !== undefined) visitResources(nested)
        }
      }
    }
  }
  visitResources(pageResources)
  return references
}

function validatePdfXTrapNetAppearance(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  pdfx: PdfXConformance,
  pageNumber: number,
): void {
  const resolved = doc.resolve(value)
  if (resolved instanceof PdfStream) {
    requirePdfName(resolved.dict.get('PCM') ?? null, 'DeviceCMYK', `${pdfx} page ${pageNumber} TrapNet appearance requires PCM DeviceCMYK`)
    return
  }
  if (!(resolved instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} page ${pageNumber} TrapNet normal appearance is invalid`)
  for (const appearance of resolved.values()) validatePdfXTrapNetAppearance(doc, appearance, pdfx, pageNumber)
}

interface PdfXContentValidationState {
  streams: Set<PdfStream>
  nonPrintStreams: Set<PdfStream>
  resources: Set<PdfDict>
  nonPrintResources: Set<PdfDict>
  fonts: Set<PdfDict>
  nonPrintFonts: Set<PdfDict>
  fontDecoders: Map<PdfDict, PdfFontDecoder>
}

const PDF_X_CONTENT_OPERATORS = new Set([
  'q', 'Q', 'cm', 'w', 'J', 'j', 'M', 'd', 'ri', 'i', 'gs',
  'm', 'l', 'c', 'v', 'y', 'h', 're', 'f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*', 'n', 'W', 'W*',
  'g', 'G', 'rg', 'RG', 'k', 'K', 'cs', 'CS', 'sc', 'SC', 'scn', 'SCN', 'sh', 'Do',
  'BMC', 'BDC', 'EMC', 'MP', 'DP', 'BX', 'EX', 'BT', 'ET', 'Tf', 'Td', 'TD', 'Tm', 'T*', 'TL',
  'Tc', 'Tw', 'Tz', 'Ts', 'Tr', 'Tj', 'TJ', 'd0', 'd1', "'", '"',
])

function validatePdfXContentColorSpaces(doc: ReturnType<typeof parsePdf>, pdfx: PdfXConformance): void {
  const state: PdfXContentValidationState = {
    streams: new Set<PdfStream>(),
    nonPrintStreams: new Set<PdfStream>(),
    resources: new Set<PdfDict>(),
    nonPrintResources: new Set<PdfDict>(),
    fonts: new Set<PdfDict>(),
    nonPrintFonts: new Set<PdfDict>(),
    fontDecoders: new Map<PdfDict, PdfFontDecoder>(),
  }
  const pages = collectPdfPages(doc)
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]!
    const resources = doc.resolve(page.resources)
    if (!(resources instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} page ${pageIndex + 1} Resources must be a dictionary`)
    validatePdfXResources(doc, resources, pdfx, `page ${pageIndex + 1}`, state)
    validatePdfXContentValue(doc, page.dict.get('Contents') ?? null, resources, pdfx, `page ${pageIndex + 1}`, state)
    const annotations = doc.resolve(page.dict.get('Annots') ?? null)
    if (Array.isArray(annotations)) {
      for (let index = 0; index < annotations.length; index++) {
        const annotation = doc.resolve(annotations[index]!)
        if (!(annotation instanceof Map)) continue
        const subtype = pdfNameValue(doc.resolve(annotation.get('Subtype') ?? null))
        const appearance = doc.resolve(annotation.get('AP') ?? null)
        if (!(appearance instanceof Map)) continue
        for (const [appearanceKind, appearanceValue] of appearance) {
          const print = appearanceKind === 'N' && (subtype === 'PrinterMark' || subtype === 'TrapNet')
          const resolved = doc.resolve(appearanceValue)
          if (resolved instanceof PdfStream) {
            const appearanceResources = doc.resolve(resolved.dict.get('Resources') ?? resources)
            if (!(appearanceResources instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} annotation appearance Resources must be a dictionary`)
            validatePdfXContentStream(doc, resolved, appearanceResources, pdfx, `page ${pageIndex + 1} annotation ${index + 1}/${appearanceKind}`, state, print)
          } else if (resolved instanceof Map) {
            for (const [name, value] of resolved) {
              const stream = doc.resolve(value)
              if (!(stream instanceof PdfStream)) throw new Error(`PDF conformance error: ${pdfx} annotation appearance ${name} must be a stream`)
              const appearanceResources = doc.resolve(stream.dict.get('Resources') ?? resources)
              if (!(appearanceResources instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} annotation appearance Resources must be a dictionary`)
              validatePdfXContentStream(doc, stream, appearanceResources, pdfx, `page ${pageIndex + 1} annotation ${index + 1}/${appearanceKind}/${name}`, state, print)
            }
          }
        }
      }
    }
  }
}

function validatePdfXContentValue(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  resources: PdfDict,
  pdfx: PdfXConformance,
  context: string,
  state: PdfXContentValidationState,
): void {
  const resolved = doc.resolve(value)
  if (resolved === null) return
  if (resolved instanceof PdfStream) {
    validatePdfXContentStream(doc, resolved, resources, pdfx, context, state)
    return
  }
  if (!Array.isArray(resolved)) throw new Error(`PDF conformance error: ${pdfx} ${context} Contents must be a stream or array`)
  for (let index = 0; index < resolved.length; index++) {
    validatePdfXContentValue(doc, resolved[index]!, resources, pdfx, `${context} content ${index + 1}`, state)
  }
}

function validatePdfXContentStream(
  doc: ReturnType<typeof parsePdf>,
  stream: PdfStream,
  inheritedResources: PdfDict,
  pdfx: PdfXConformance,
  context: string,
  state: PdfXContentValidationState,
  print = true,
): void {
  const streams = print ? state.streams : state.nonPrintStreams
  if (streams.has(stream)) return
  streams.add(stream)
  const ownResources = doc.resolve(stream.dict.get('Resources') ?? inheritedResources)
  if (!(ownResources instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} Resources must be a dictionary`)
  validatePdfXResources(doc, ownResources, pdfx, context, state, print)
  const lexer = new PdfContentLexer(doc.decodeStream(stream))
  const operands: PdfValue[] = []
  const fontStack: Array<PdfFontDecoder | null> = []
  let font: PdfFontDecoder | null = null
  for (;;) {
    const token = lexer.next()
    if (token.type === 'eof') {
      if (fontStack.length !== 0) throw new Error(`PDF conformance error: ${pdfx} has an unmatched q operator at ${context}`)
      return
    }
    if (token.type === 'object') {
      operands.push(token.value)
      continue
    }
    if (token.type === 'inlineImage') {
      validatePdfXFilterValue(doc, token.dict.get('Filter') ?? token.dict.get('F') ?? null, pdfx, `${context} inline image`)
      let colorSpace = token.dict.get('ColorSpace') ?? token.dict.get('CS') ?? null
      if (colorSpace instanceof PdfName && colorSpace.name === 'G') colorSpace = new PdfName('DeviceGray')
      if (colorSpace instanceof PdfName && colorSpace.name === 'CMYK') colorSpace = new PdfName('DeviceCMYK')
      if (colorSpace instanceof PdfName && colorSpace.name === 'RGB') colorSpace = new PdfName('DeviceRGB')
      const imageMask = doc.resolve(token.dict.get('ImageMask') ?? token.dict.get('IM') ?? null) === true
      if (colorSpace === null && !imageMask) {
        throw new Error(`PDF conformance error: ${pdfx} inline image requires a color space at ${context}`)
      }
      if (print && colorSpace !== null) validatePdfXColorSpace(doc, colorSpace, ownResources, pdfx, `${context} inline image`)
      operands.length = 0
      continue
    }
    const operator = token.value
    if (!PDF_X_CONTENT_OPERATORS.has(operator)) {
      throw new Error(`PDF conformance error: ${pdfx} forbids undefined or PostScript content operator ${operator} at ${context}`)
    }
    if (print && (operator === 'rg' || operator === 'RG')) {
      throw new Error(`PDF conformance error: ${pdfx} forbids ${operator} DeviceRGB operators at ${context}`)
    }
    if (operator === 'q') {
      fontStack.push(font)
    } else if (operator === 'Q') {
      if (fontStack.length === 0) throw new Error(`PDF conformance error: ${pdfx} has an unmatched Q operator at ${context}`)
      font = fontStack.pop()!
    } else if (operator === 'cs' || operator === 'CS') {
      const name = operands[operands.length - 1]
      if (!(name instanceof PdfName)) throw new Error(`PDF conformance error: ${pdfx} ${operator} requires a color-space name at ${context}`)
      if (print) validatePdfXColorSpace(doc, name, ownResources, pdfx, context)
    } else if (operator === 'Tf') {
      const value = validatePdfXNamedResource(doc, operands[operands.length - 2], ownResources, 'Font', pdfx, context)
      const dictionary = value instanceof Map ? value : null
      if (dictionary === null) throw new Error(`PDF conformance error: ${pdfx} Font resource is invalid at ${context}`)
      font = state.fontDecoders.get(dictionary) ?? createFontDecoder(doc, dictionary)
      state.fontDecoders.set(dictionary, font)
    } else if (operator === 'gs') {
      validatePdfXNamedResource(doc, operands[operands.length - 1], ownResources, 'ExtGState', pdfx, context)
    } else if (operator === 'Do') {
      validatePdfXReferencedXObject(doc, operands[operands.length - 1], ownResources, pdfx, context, state, print)
    } else if (operator === 'sh') {
      if (print) validatePdfXReferencedShading(doc, operands[operands.length - 1], ownResources, pdfx, context)
    } else if (operator === 'scn' || operator === 'SCN') {
      const patternName = operands[operands.length - 1]
      if (print && patternName instanceof PdfName) validatePdfXReferencedPattern(doc, patternName, ownResources, pdfx, context, state)
    } else if (operator === 'BDC' || operator === 'DP') {
      const properties = operands[operands.length - 1]
      if (properties instanceof PdfName) validatePdfXNamedResource(doc, properties, ownResources, 'Properties', pdfx, context)
    } else if (operator === 'Tj' || operator === "'") {
      validatePdfXTextString(font, operands[operands.length - 1], pdfx, context)
    } else if (operator === '"') {
      validatePdfXTextString(font, operands[operands.length - 1], pdfx, context)
    } else if (operator === 'TJ') {
      const values = operands[operands.length - 1]
      if (!Array.isArray(values)) throw new Error(`PDF conformance error: ${pdfx} TJ requires an array at ${context}`)
      for (let index = 0; index < values.length; index++) {
        const value = doc.resolve(values[index]!)
        if (value instanceof PdfString) validatePdfXTextString(font, value, pdfx, context)
        else if (typeof value !== 'number') throw new Error(`PDF conformance error: ${pdfx} TJ arrays permit only strings and numbers at ${context}`)
      }
    }
    operands.length = 0
  }
}

function validatePdfXTextString(
  font: PdfFontDecoder | null,
  value: PdfValue | undefined,
  pdfx: PdfXConformance,
  context: string,
): void {
  if (font === null) throw new Error(`PDF conformance error: ${pdfx} text-showing operator requires a selected font at ${context}`)
  if (!(value instanceof PdfString)) throw new Error(`PDF conformance error: ${pdfx} text-showing operator requires a string at ${context}`)
  font.metrics(value.bytes)
  const codes = font.codes(value.bytes)
  for (let index = 0; index < codes.length; index++) {
    const cid = font.cid(codes[index]!)
    if (!font.hasGlyph(cid)) {
      throw new Error(`PDF conformance error: ${pdfx} embedded font ${font.baseFont} omits glyph for character code ${codes[index]!.code} at ${context}`)
    }
  }
}

function validatePdfXNamedResource(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue | undefined,
  resources: PdfDict,
  category: string,
  pdfx: PdfXConformance,
  context: string,
): PdfValue {
  if (!(value instanceof PdfName)) throw new Error(`PDF conformance error: ${pdfx} ${category} operator requires a resource name at ${context}`)
  const dictionary = doc.resolve(resources.get(category) ?? null)
  if (!(dictionary instanceof Map) || !dictionary.has(value.name)) {
    throw new Error(`PDF conformance error: ${pdfx} ${category} resource ${value.name} is missing at ${context}`)
  }
  return doc.resolve(dictionary.get(value.name)!)
}

function validatePdfXResources(
  doc: ReturnType<typeof parsePdf>,
  resources: PdfDict,
  pdfx: PdfXConformance,
  context: string,
  state: PdfXContentValidationState,
  print = true,
): void {
  const visited = print ? state.resources : state.nonPrintResources
  if (visited.has(resources)) return
  visited.add(resources)

  const colorSpaces = doc.resolve(resources.get('ColorSpace') ?? null)
  if (print && colorSpaces !== null) {
    if (!(colorSpaces instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} ColorSpace resources must be a dictionary`)
    for (const name of ['DefaultGray', 'DefaultRGB', 'DefaultCMYK']) {
      if (colorSpaces.has(name)) throw new Error(`PDF conformance error: ${pdfx} print resources forbid ${name} at ${context}`)
    }
    for (const [name, value] of colorSpaces) validatePdfXColorSpace(doc, value, resources, pdfx, `${context} color space ${name}`)
  }

  const xObjects = doc.resolve(resources.get('XObject') ?? null)
  if (xObjects !== null) {
    if (!(xObjects instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} XObject resources must be a dictionary`)
    for (const name of xObjects.keys()) validatePdfXReferencedXObject(doc, new PdfName(name), resources, pdfx, context, state, print)
  }

  const shadings = doc.resolve(resources.get('Shading') ?? null)
  if (print && shadings !== null) {
    if (!(shadings instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} Shading resources must be a dictionary`)
    for (const name of shadings.keys()) validatePdfXReferencedShading(doc, new PdfName(name), resources, pdfx, context)
  }

  const patterns = doc.resolve(resources.get('Pattern') ?? null)
  if (print && patterns !== null) {
    if (!(patterns instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} Pattern resources must be a dictionary`)
    for (const name of patterns.keys()) validatePdfXReferencedPattern(doc, new PdfName(name), resources, pdfx, context, state)
  }

  const fonts = doc.resolve(resources.get('Font') ?? null)
  if (fonts !== null) {
    if (!(fonts instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} Font resources must be a dictionary`)
    for (const [name, value] of fonts) validatePdfXType3Font(doc, value, pdfx, `${context} font ${name}`, state, print)
  }

  const graphicsStates = doc.resolve(resources.get('ExtGState') ?? null)
  if (graphicsStates !== null) {
    if (!(graphicsStates instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} ExtGState resources must be a dictionary`)
    for (const [name, value] of graphicsStates) {
      const dictionary = doc.resolve(value)
      if (!(dictionary instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ExtGState ${name} must be a dictionary at ${context}`)
      validatePdfXExtGState(doc, dictionary, pdfx, `${context} ExtGState ${name}`)
    }
  }
}

function validatePdfXExtGState(
  doc: ReturnType<typeof parsePdf>,
  dictionary: PdfDict,
  pdfx: PdfXConformance,
  context: string,
): void {
  for (const key of ['TR', 'TR2', 'HTP']) {
    if (dictionary.has(key)) throw new Error(`PDF conformance error: ${pdfx} ExtGState forbids ${key} at ${context}`)
  }
  const blend = doc.resolve(dictionary.get('BM') ?? null)
  if (blend !== null && (!(blend instanceof PdfName) || (blend.name !== 'Normal' && blend.name !== 'Compatible'))) {
    throw new Error(`PDF conformance error: ${pdfx} ExtGState BM must be Normal or Compatible at ${context}`)
  }
  for (const key of ['CA', 'ca']) {
    const alpha = doc.resolve(dictionary.get(key) ?? null)
    if (alpha !== null && alpha !== 1) throw new Error(`PDF conformance error: ${pdfx} ExtGState ${key} must be 1 at ${context}`)
  }
  const mask = doc.resolve(dictionary.get('SMask') ?? null)
  if (mask !== null && (!(mask instanceof PdfName) || mask.name !== 'None')) {
    throw new Error(`PDF conformance error: ${pdfx} ExtGState SMask must be None at ${context}`)
  }
  const halftone = doc.resolve(dictionary.get('HT') ?? null)
  if (halftone instanceof Map) validatePdfXHalftone(doc, halftone, pdfx, `${context}/HT`)
  else if (halftone instanceof PdfStream) validatePdfXHalftone(doc, halftone.dict, pdfx, `${context}/HT`)
  else if (halftone !== null && (!(halftone instanceof PdfName) || halftone.name !== 'Default')) {
    throw new Error(`PDF conformance error: ${pdfx} ExtGState HT is invalid at ${context}`)
  }
}

function validatePdfXHalftone(
  doc: ReturnType<typeof parsePdf>,
  dictionary: PdfDict,
  pdfx: PdfXConformance,
  context: string,
): void {
  const type = doc.resolve(dictionary.get('HalftoneType') ?? null)
  if (type !== 1 && type !== 5) throw new Error(`PDF conformance error: ${pdfx} permits only HalftoneType 1 or 5 at ${context}`)
  if (dictionary.has('HalftoneName')) throw new Error(`PDF conformance error: ${pdfx} halftones forbid HalftoneName at ${context}`)
  if (type !== 5) return
  for (const [name, value] of dictionary) {
    if (name === 'Type' || name === 'HalftoneType') continue
    const component = doc.resolve(value)
    const componentDictionary = component instanceof PdfStream ? component.dict : component
    if (!(componentDictionary instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} component halftone ${name} is invalid at ${context}`)
    validatePdfXHalftone(doc, componentDictionary, pdfx, `${context}/${name}`)
  }
}

function validatePdfXType3Font(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  pdfx: PdfXConformance,
  context: string,
  state: PdfXContentValidationState,
  print = true,
): void {
  const font = doc.resolve(value)
  if (!(font instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} must be a font dictionary`)
  const fonts = print ? state.fonts : state.nonPrintFonts
  if (fonts.has(font)) return
  fonts.add(font)
  if (pdfNameValue(doc.resolve(font.get('Subtype') ?? null)) !== 'Type3') return
  const charProcs = doc.resolve(font.get('CharProcs') ?? null)
  if (!(charProcs instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ${context} Type3 font requires CharProcs`)
  const resourceValue = doc.resolve(font.get('Resources') ?? null)
  if (resourceValue !== null && !(resourceValue instanceof Map)) {
    throw new Error(`PDF conformance error: ${pdfx} ${context} Type3 Resources must be a dictionary`)
  }
  const resources: PdfDict = resourceValue instanceof Map ? resourceValue : new Map<string, PdfValue>()
  validatePdfXResources(doc, resources, pdfx, `${context} Type3`, state, print)
  for (const [name, procedure] of charProcs) {
    const stream = doc.resolve(procedure)
    if (!(stream instanceof PdfStream)) throw new Error(`PDF conformance error: ${pdfx} ${context} CharProc ${name} must be a stream`)
    validatePdfXContentStream(doc, stream, resources, pdfx, `${context} CharProc ${name}`, state, print)
  }
}

function validatePdfXColorSpace(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  resources: PdfDict,
  pdfx: PdfXConformance,
  context: string,
): void {
  let resolved = doc.resolve(value)
  if (resolved instanceof PdfName && !['DeviceGray', 'DeviceCMYK', 'Pattern'].includes(resolved.name)) {
    const colorSpaces = doc.resolve(resources.get('ColorSpace') ?? null)
    if (colorSpaces instanceof Map && colorSpaces.has(resolved.name)) resolved = doc.resolve(colorSpaces.get(resolved.name)!)
  }
  if (resolved instanceof PdfName) {
    if (resolved.name === 'DeviceGray' || resolved.name === 'DeviceCMYK' || resolved.name === 'Pattern') return
    throw new Error(`PDF conformance error: ${pdfx} forbids ${resolved.name} color space at ${context}`)
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`PDF conformance error: ${pdfx} color space is invalid at ${context}`)
  }
  const family = pdfNameValue(doc.resolve(resolved[0]!))
  if (family === 'Indexed') {
    validatePdfXColorSpace(doc, resolved[1] ?? null, resources, pdfx, context)
    return
  }
  if (family === 'Separation' || family === 'DeviceN') {
    const alternate = doc.resolve(resolved[2] ?? null)
    if (!(alternate instanceof PdfName) || (alternate.name !== 'DeviceGray' && alternate.name !== 'DeviceCMYK')) {
      throw new Error(`PDF conformance error: ${pdfx} ${family} alternate space must be DeviceGray or DeviceCMYK at ${context}`)
    }
    return
  }
  if (family === 'Pattern') {
    if (resolved.length > 1) validatePdfXColorSpace(doc, resolved[1]!, resources, pdfx, context)
    return
  }
  throw new Error(`PDF conformance error: ${pdfx} forbids ${family ?? 'unknown'} color space at ${context}`)
}

function validatePdfXReferencedXObject(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue | undefined,
  resources: PdfDict,
  pdfx: PdfXConformance,
  context: string,
  state: PdfXContentValidationState,
  print = true,
): void {
  if (!(value instanceof PdfName)) throw new Error(`PDF conformance error: ${pdfx} Do requires an XObject name at ${context}`)
  const xObjects = doc.resolve(resources.get('XObject') ?? null)
  const stream = xObjects instanceof Map ? doc.resolve(xObjects.get(value.name) ?? null) : null
  if (!(stream instanceof PdfStream)) throw new Error(`PDF conformance error: ${pdfx} XObject ${value.name} is missing at ${context}`)
  const subtype = pdfNameValue(doc.resolve(stream.dict.get('Subtype') ?? null))
  if (stream.dict.has('OPI')) throw new Error(`PDF conformance error: ${pdfx} XObject ${value.name} forbids OPI at ${context}`)
  if (subtype === 'Image') {
    validatePdfXImageAlternates(doc, stream, pdfx, `${context} image ${value.name}`)
    const softMask = doc.resolve(stream.dict.get('SMask') ?? null)
    if (softMask !== null && (!(softMask instanceof PdfName) || softMask.name !== 'None')) {
      throw new Error(`PDF conformance error: ${pdfx} image ${value.name} SMask must be None at ${context}`)
    }
    const smaskInData = doc.resolve(stream.dict.get('SMaskInData') ?? null)
    if (smaskInData !== null && smaskInData !== 0) {
      throw new Error(`PDF conformance error: ${pdfx} image ${value.name} forbids embedded alpha at ${context}`)
    }
    const colorSpace = stream.dict.get('ColorSpace')
    const imageMask = doc.resolve(stream.dict.get('ImageMask') ?? null) === true
    if (colorSpace === undefined && !imageMask) {
      throw new Error(`PDF conformance error: ${pdfx} image ${value.name} requires a color space at ${context}`)
    }
    if (print && colorSpace !== undefined) validatePdfXColorSpace(doc, colorSpace, resources, pdfx, `${context} image ${value.name}`)
    return
  }
  if (subtype === 'Form') {
    if (stream.dict.has('Ref')) throw new Error(`PDF conformance error: ${pdfx} forbids reference Form XObject ${value.name} at ${context}`)
    if (stream.dict.has('PS') || pdfNameValue(doc.resolve(stream.dict.get('Subtype2') ?? null)) === 'PS') {
      throw new Error(`PDF conformance error: ${pdfx} forbids PostScript Form XObject ${value.name} at ${context}`)
    }
    const group = doc.resolve(stream.dict.get('Group') ?? null)
    if (group instanceof Map && pdfNameValue(doc.resolve(group.get('S') ?? null)) === 'Transparency') {
      throw new Error(`PDF conformance error: ${pdfx} forbids transparency Form XObject ${value.name} at ${context}`)
    }
    validatePdfXContentStream(doc, stream, resources, pdfx, `${context} form ${value.name}`, state, print)
    return
  }
  if (subtype === 'PS') throw new Error(`PDF conformance error: ${pdfx} forbids PostScript XObject ${value.name} at ${context}`)
  throw new Error(`PDF conformance error: ${pdfx} XObject ${value.name} has unsupported subtype ${subtype ?? 'unknown'} at ${context}`)
}

function validatePdfXImageAlternates(
  doc: ReturnType<typeof parsePdf>,
  image: PdfStream,
  pdfx: PdfXConformance,
  context: string,
): void {
  validatePdfXAlternateSelection(doc, image.dict, image.dict.get('Alternates') ?? null, pdfx, context)
}

function validatePdfXReferencedShading(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue | undefined,
  resources: PdfDict,
  pdfx: PdfXConformance,
  context: string,
): void {
  if (!(value instanceof PdfName)) throw new Error(`PDF conformance error: ${pdfx} sh requires a shading name at ${context}`)
  const shadings = doc.resolve(resources.get('Shading') ?? null)
  const shading = shadings instanceof Map ? doc.resolve(shadings.get(value.name) ?? null) : null
  const dictionary = shading instanceof PdfStream ? shading.dict : shading
  if (!(dictionary instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} shading ${value.name} is missing at ${context}`)
  validatePdfXColorSpace(doc, dictionary.get('ColorSpace') ?? null, resources, pdfx, `${context} shading ${value.name}`)
}

function validatePdfXReferencedPattern(
  doc: ReturnType<typeof parsePdf>,
  name: PdfName,
  resources: PdfDict,
  pdfx: PdfXConformance,
  context: string,
  state: PdfXContentValidationState,
): void {
  const patterns = doc.resolve(resources.get('Pattern') ?? null)
  const pattern = patterns instanceof Map ? doc.resolve(patterns.get(name.name) ?? null) : null
  if (pattern instanceof PdfStream) {
    const patternType = doc.resolve(pattern.dict.get('PatternType') ?? null)
    if (patternType !== 1) throw new Error(`PDF conformance error: ${pdfx} tiling pattern ${name.name} requires PatternType 1 at ${context}`)
    validatePdfXContentStream(doc, pattern, resources, pdfx, `${context} pattern ${name.name}`, state)
    return
  }
  if (!(pattern instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} pattern ${name.name} is missing at ${context}`)
  const patternType = doc.resolve(pattern.get('PatternType') ?? null)
  if (patternType !== 2) throw new Error(`PDF conformance error: ${pdfx} shading pattern ${name.name} requires PatternType 2 at ${context}`)
  const graphicsState = doc.resolve(pattern.get('ExtGState') ?? null)
  if (graphicsState !== null) {
    if (!(graphicsState instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} shading pattern ExtGState must be a dictionary at ${context}`)
    validatePdfXExtGState(doc, graphicsState, pdfx, `${context} pattern ${name.name} ExtGState`)
  }
  const shading = doc.resolve(pattern.get('Shading') ?? null)
  const dictionary = shading instanceof PdfStream ? shading.dict : shading
  if (!(dictionary instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} shading pattern ${name.name} requires Shading at ${context}`)
  validatePdfXColorSpace(doc, dictionary.get('ColorSpace') ?? null, resources, pdfx, `${context} pattern ${name.name}`)
}

const PDF_X_ACTION_TYPES = new Set([
  'GoTo', 'GoToR', 'Launch', 'Thread', 'URI', 'Sound', 'Movie', 'Hide', 'Named',
  'SubmitForm', 'ResetForm', 'ImportData', 'JavaScript', 'Rendition', 'Trans',
  'GoTo3DView', 'GoToE', 'SetOCGState',
])

function validatePdfXObjectGraph(
  doc: ReturnType<typeof parsePdf>,
  catalog: PdfDict,
  pdfx: PdfXConformance,
): void {
  if (catalog.has('OCProperties')) throw new Error(`PDF conformance error: ${pdfx} forbids optional content introduced after PDF 1.4`)
  validatePdfXViewerPreferences(doc, catalog, pdfx)
  const visitedRefs = new Set<string>()
  const visitedObjects = new Set<object>()
  visitPdfXObjectGraph(doc, catalog, pdfx, 'Catalog', visitedRefs, visitedObjects)
  const objectReferences = doc.getObjectReferences()
  for (let index = 0; index < objectReferences.length; index++) {
    const reference = objectReferences[index]!
    visitPdfXObjectGraph(doc, reference, pdfx, `object ${reference.num} ${reference.gen}`, visitedRefs, visitedObjects)
  }
}

function validatePdfXTrailer(doc: ReturnType<typeof parsePdf>, pdfx: PdfXConformance): void {
  if (doc.resolve(doc.trailer.get('Encrypt') ?? null) !== null) {
    throw new Error(`PDF conformance error: ${pdfx} forbids encryption`)
  }
  const identifier = doc.resolve(doc.trailer.get('ID') ?? null)
  if (!Array.isArray(identifier) || identifier.length !== 2
    || !(doc.resolve(identifier[0]!) instanceof PdfString)
    || !(doc.resolve(identifier[1]!) instanceof PdfString)) {
    throw new Error(`PDF conformance error: ${pdfx} requires a two-string trailer ID`)
  }
}

function visitPdfXObjectGraph(
  doc: ReturnType<typeof parsePdf>,
  source: PdfValue,
  pdfx: PdfXConformance,
  context: string,
  visitedRefs: Set<string>,
  visitedObjects: Set<object>,
): void {
  if (source instanceof PdfRef) {
    const key = `${source.num}:${source.gen}`
    if (visitedRefs.has(key)) return
    visitedRefs.add(key)
    visitPdfXObjectGraph(doc, doc.resolve(source), pdfx, context, visitedRefs, visitedObjects)
    return
  }
  if (source instanceof PdfStream) {
    if (visitedObjects.has(source)) return
    visitedObjects.add(source)
    validatePdfXFilterValue(doc, source.dict.get('Filter') ?? null, pdfx, context)
    if (source.dict.has('F')) throw new Error(`PDF conformance error: ${pdfx} forbids external stream file specifications at ${context}`)
    visitPdfXObjectGraph(doc, source.dict, pdfx, `${context} stream dictionary`, visitedRefs, visitedObjects)
    return
  }
  if (Array.isArray(source)) {
    if (visitedObjects.has(source)) return
    visitedObjects.add(source)
    for (let index = 0; index < source.length; index++) {
      visitPdfXObjectGraph(doc, source[index]!, pdfx, `${context}[${index}]`, visitedRefs, visitedObjects)
    }
    return
  }
  if (!(source instanceof Map)) return
  if (visitedObjects.has(source)) return
  visitedObjects.add(source)

  const type = pdfNameValue(doc.resolve(source.get('Type') ?? null))
  const subtype = pdfNameValue(doc.resolve(source.get('Subtype') ?? null))
  const actionType = pdfNameValue(doc.resolve(source.get('S') ?? null))
  if (type === 'Filespec' || source.has('EF')) throw new Error(`PDF conformance error: ${pdfx} forbids file specifications at ${context}`)
  if (type === 'Action' || (actionType !== null && PDF_X_ACTION_TYPES.has(actionType))) {
    throw new Error(`PDF conformance error: ${pdfx} forbids actions at ${context}`)
  }
  if (source.has('OPI')) throw new Error(`PDF conformance error: ${pdfx} forbids OPI at ${context}`)
  if (type === 'Page' && source.has('SeparationInfo')) {
    throw new Error(`PDF conformance error: ${pdfx} forbids pre-separated page descriptions at ${context}`)
  }
  if (type === 'ExtGState' || context.includes('/ExtGState/')) validatePdfXExtGState(doc, source, pdfx, context)
  if (source.has('HalftoneType')) validatePdfXHalftone(doc, source, pdfx, context)
  if (type === 'XObject' || subtype === 'Image' || subtype === 'Form' || subtype === 'PS') {
    validatePdfXReachableXObject(doc, source, pdfx, context, subtype)
  }
  for (const [key, value] of source) {
    visitPdfXObjectGraph(doc, value, pdfx, `${context}/${key}`, visitedRefs, visitedObjects)
  }
}

function validatePdfXReachableXObject(
  doc: ReturnType<typeof parsePdf>,
  dictionary: PdfDict,
  pdfx: PdfXConformance,
  context: string,
  subtype: string | null,
): void {
  if (subtype === 'PS') throw new Error(`PDF conformance error: ${pdfx} forbids PostScript XObjects at ${context}`)
  if (subtype === 'Form') {
    if (dictionary.has('Ref')) throw new Error(`PDF conformance error: ${pdfx} forbids reference Form XObjects at ${context}`)
    if (dictionary.has('PS') || pdfNameValue(doc.resolve(dictionary.get('Subtype2') ?? null)) === 'PS') {
      throw new Error(`PDF conformance error: ${pdfx} forbids PostScript Form XObjects at ${context}`)
    }
    const group = doc.resolve(dictionary.get('Group') ?? null)
    if (group instanceof Map && pdfNameValue(doc.resolve(group.get('S') ?? null)) === 'Transparency') {
      throw new Error(`PDF conformance error: ${pdfx} forbids transparency Form XObjects at ${context}`)
    }
    return
  }
  if (subtype !== 'Image') return
  const softMask = doc.resolve(dictionary.get('SMask') ?? null)
  if (softMask !== null && (!(softMask instanceof PdfName) || softMask.name !== 'None')) {
    throw new Error(`PDF conformance error: ${pdfx} Image SMask must be None at ${context}`)
  }
  const smaskInData = doc.resolve(dictionary.get('SMaskInData') ?? null)
  if (smaskInData !== null && smaskInData !== 0) throw new Error(`PDF conformance error: ${pdfx} forbids embedded image alpha at ${context}`)
  validatePdfXAlternateSelection(doc, dictionary, dictionary.get('Alternates') ?? null, pdfx, context)
}

function validatePdfXAlternateSelection(
  doc: ReturnType<typeof parsePdf>,
  baseImage: PdfDict,
  value: PdfValue,
  pdfx: PdfXConformance,
  context: string,
): void {
  const alternates = doc.resolve(value)
  if (alternates === null) return
  if (!Array.isArray(alternates)) throw new Error(`PDF conformance error: ${pdfx} image Alternates must be an array at ${context}`)
  const baseWidth = requirePdfXImageDimension(doc, baseImage, 'Width', pdfx, context)
  const baseHeight = requirePdfXImageDimension(doc, baseImage, 'Height', pdfx, context)
  for (let index = 0; index < alternates.length; index++) {
    const entry = doc.resolve(alternates[index]!)
    if (!(entry instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} image alternate ${index + 1} must be a dictionary at ${context}`)
    const selected = doc.resolve(entry.get('DefaultForPrinting') ?? null)
    if (selected === true) throw new Error(`PDF conformance error: ${pdfx} image alternates forbid DefaultForPrinting true at ${context}`)
    if (selected !== null && selected !== false) throw new Error(`PDF conformance error: ${pdfx} image alternate DefaultForPrinting must be boolean at ${context}`)
    const image = doc.resolve(entry.get('Image') ?? null)
    if (!(image instanceof PdfStream) || pdfNameValue(doc.resolve(image.dict.get('Subtype') ?? null)) !== 'Image') {
      throw new Error(`PDF conformance error: ${pdfx} image alternate ${index + 1} requires an Image XObject at ${context}`)
    }
    const width = requirePdfXImageDimension(doc, image.dict, 'Width', pdfx, `${context} alternate ${index + 1}`)
    const height = requirePdfXImageDimension(doc, image.dict, 'Height', pdfx, `${context} alternate ${index + 1}`)
    if (baseWidth * height !== width * baseHeight) {
      throw new Error(`PDF conformance error: ${pdfx} alternate images must represent the same image area at ${context}`)
    }
    if (image.dict.has('Alternates')) throw new Error(`PDF conformance error: ${pdfx} alternate images must not contain Alternates at ${context}`)
  }
}

function requirePdfXImageDimension(
  doc: ReturnType<typeof parsePdf>,
  image: PdfDict,
  key: 'Width' | 'Height',
  pdfx: PdfXConformance,
  context: string,
): number {
  const value = doc.resolve(image.get(key) ?? null)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`PDF conformance error: ${pdfx} image ${key} must be a positive integer at ${context}`)
  }
  return value
}

function validatePdfXFilterValue(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  pdfx: PdfXConformance,
  context: string,
): void {
  const resolved = doc.resolve(value)
  if (resolved === null) return
  const filters = Array.isArray(resolved) ? resolved : [resolved]
  for (let index = 0; index < filters.length; index++) {
    const filter = doc.resolve(filters[index]!)
    if (!(filter instanceof PdfName)) throw new Error(`PDF conformance error: ${pdfx} stream Filter must be a name at ${context}`)
    if (filter.name === 'LZWDecode' || filter.name === 'LZW' || filter.name === 'JBIG2Decode') {
      throw new Error(`PDF conformance error: ${pdfx} forbids ${filter.name} compression at ${context}`)
    }
  }
}

function validatePdfXViewerPreferences(
  doc: ReturnType<typeof parsePdf>,
  catalog: PdfDict,
  pdfx: PdfXConformance,
): void {
  const preferences = doc.resolve(catalog.get('ViewerPreferences') ?? null)
  if (preferences === null) return
  if (!(preferences instanceof Map)) throw new Error(`PDF conformance error: ${pdfx} ViewerPreferences must be a dictionary`)
  const hasBleedBox = collectPdfPages(doc).some(function (page) { return page.dict.has('BleedBox') })
  if (!hasBleedBox) return
  for (const key of ['ViewArea', 'ViewClip', 'PrintArea', 'PrintClip']) {
    const value = doc.resolve(preferences.get(key) ?? null)
    if (value !== null && (!(value instanceof PdfName) || (value.name !== 'MediaBox' && value.name !== 'BleedBox'))) {
      throw new Error(`PDF conformance error: ${pdfx} ViewerPreferences ${key} must be MediaBox or BleedBox`)
    }
  }
}

function requirePdfEmbeddedFonts(
  doc: ReturnType<typeof parsePdf>,
  label: string,
  usedFonts?: ReadonlyMap<PdfDict, boolean>,
): void {
  if (usedFonts !== undefined) {
    const checkedFonts = new Set<PdfDict>()
    for (const [font, rendersGlyphs] of usedFonts) {
      requirePdfFontEmbedded(doc, font, label, 'content font', checkedFonts, rendersGlyphs)
    }
    return
  }
  const root = doc.resolve(doc.trailer.get('Root') ?? null)
  if (!(root instanceof Map)) throw new Error(`PDF conformance error: ${label} requires a Catalog dictionary`)
  const checkedFonts = new Set<PdfDict>()
  const visitedRefs = new Set<string>()
  const visitedObjects = new Set<object>()

  const visit = function (source: PdfValue, context: string): void {
    if (source instanceof PdfRef) {
      const key = `${source.num}:${source.gen}`
      if (visitedRefs.has(key)) return
      visitedRefs.add(key)
      visit(doc.resolve(source), context)
      return
    }
    if (source instanceof PdfStream) {
      if (visitedObjects.has(source)) return
      visitedObjects.add(source)
      visit(source.dict, `${context} stream dictionary`)
      return
    }
    if (Array.isArray(source)) {
      if (visitedObjects.has(source)) return
      visitedObjects.add(source)
      for (let index = 0; index < source.length; index++) visit(source[index]!, `${context}[${index}]`)
      return
    }
    if (!(source instanceof Map)) return
    if (visitedObjects.has(source)) return
    visitedObjects.add(source)
    const type = pdfNameValue(doc.resolve(source.get('Type') ?? null))
    if (type === 'Font') requirePdfFontEmbedded(doc, source, label, context, checkedFonts, true)
    for (const [key, value] of source) visit(value, `${context}/${key}`)
  }

  visit(root, 'Catalog')
  const references = doc.getObjectReferences()
  for (let index = 0; index < references.length; index++) {
    const reference = references[index]!
    visit(reference, `object ${reference.num} ${reference.gen}`)
  }
}

const PDFA_PREDEFINED_CMAP_NAMES = new Set<string>(`
Identity-H Identity-V
GB-EUC-H GB-EUC-V GBpc-EUC-H GBpc-EUC-V GBK-EUC-H GBK-EUC-V GBKp-EUC-H GBKp-EUC-V GBK2K-H GBK2K-V UniGB-UCS2-H UniGB-UCS2-V UniGB-UTF16-H UniGB-UTF16-V
B5pc-H B5pc-V HKscs-B5-H HKscs-B5-V ETen-B5-H ETen-B5-V ETenms-B5-H ETenms-B5-V CNS-EUC-H CNS-EUC-V UniCNS-UCS2-H UniCNS-UCS2-V UniCNS-UTF16-H UniCNS-UTF16-V
83pv-RKSJ-H 90ms-RKSJ-H 90ms-RKSJ-V 90msp-RKSJ-H 90msp-RKSJ-V 90pv-RKSJ-H Add-RKSJ-H Add-RKSJ-V EUC-H EUC-V Ext-RKSJ-H Ext-RKSJ-V H V UniJIS-UCS2-H UniJIS-UCS2-V UniJIS-UCS2-HW-H UniJIS-UCS2-HW-V UniJIS-UTF16-H UniJIS-UTF16-V
KSC-EUC-H KSC-EUC-V KSCms-UHC-H KSCms-UHC-V KSCms-UHC-HW-H KSCms-UHC-HW-V KSCpc-EUC-H UniKS-UCS2-H UniKS-UCS2-V UniKS-UTF16-H UniKS-UTF16-V
`.trim().split(/\s+/))

function isPdfACMapAvailableWithoutEmbedding(label: string, name: string): boolean {
  if (label === 'PDF/A-1b') return name === 'Identity-H' || name === 'Identity-V'
  return PDFA_PREDEFINED_CMAP_NAMES.has(name)
}

interface PdfACidSystemInfo {
  registry: Uint8Array
  ordering: Uint8Array
  supplement: number
}

function validatePdfACMapUseCMap(
  doc: ReturnType<typeof parsePdf>,
  cmap: PdfStream,
  label: string,
  context: string,
): void {
  const dictionaryParent = doc.resolve(cmap.dict.get('UseCMap') ?? null)
  if (dictionaryParent !== null
    && (!(dictionaryParent instanceof PdfName) || !isPdfACMapAvailableWithoutEmbedding(label, dictionaryParent.name))) {
    throw new Error(`PDF conformance error: ${label} embedded CMap may reference only a PDF 1.7 predefined CMap for ${context}`)
  }
  const program = pdfBytesToLatin1(doc.decodeStream(cmap))
  const pattern = /\/([^\s<>{}\[\]()/%]+)\s+usecmap\b/g
  for (const match of program.matchAll(pattern)) {
    const name = decodePdfNameToken(match[1]!)
    if (!isPdfACMapAvailableWithoutEmbedding(label, name)) {
      throw new Error(`PDF conformance error: ${label} embedded CMap references non-standard CMap ${name} for ${context}`)
    }
  }
}

function validatePdfACidSystemCompatibility(
  doc: ReturnType<typeof parsePdf>,
  descendantValue: PdfValue,
  encoding: PdfName | PdfStream,
  label: string,
  context: string,
): void {
  const encodingName = encoding instanceof PdfName
    ? encoding.name
    : pdfNameValue(doc.resolve(encoding.dict.get('CMapName') ?? null))
  if (encodingName === 'Identity-H' || encodingName === 'Identity-V') return
  const descendant = doc.resolve(descendantValue)
  if (!(descendant instanceof Map)) throw new Error(`PDF conformance error: ${label} Type0 descendant must be a CIDFont for ${context}`)
  const cidInfo = readPdfACidSystemInfo(doc, descendant.get('CIDSystemInfo') ?? null, label, `${context} descendant`)
  const cmapInfo = encoding instanceof PdfStream
    ? readPdfACidSystemInfo(doc, encoding.dict.get('CIDSystemInfo') ?? null, label, `${context} Encoding CMap`)
    : readPdfACMapProgramCidSystemInfo(encoding.name, label, context)
  if (compareBytes(cidInfo.registry, cmapInfo.registry) !== 0
    || compareBytes(cidInfo.ordering, cmapInfo.ordering) !== 0
    || cidInfo.supplement > cmapInfo.supplement) {
    throw new Error(`PDF conformance error: ${label} CIDFont and CMap CIDSystemInfo are incompatible for ${context}`)
  }
}

function readPdfACidSystemInfo(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  label: string,
  context: string,
): PdfACidSystemInfo {
  const dictionary = doc.resolve(value)
  if (!(dictionary instanceof Map)) throw new Error(`PDF conformance error: ${label} requires CIDSystemInfo for ${context}`)
  const registry = doc.resolve(dictionary.get('Registry') ?? null)
  const ordering = doc.resolve(dictionary.get('Ordering') ?? null)
  const supplement = doc.resolve(dictionary.get('Supplement') ?? null)
  if (!(registry instanceof PdfString) || !(ordering instanceof PdfString)
    || typeof supplement !== 'number' || !Number.isInteger(supplement) || supplement < 0) {
    throw new Error(`PDF conformance error: ${label} has invalid CIDSystemInfo for ${context}`)
  }
  return { registry: registry.bytes, ordering: ordering.bytes, supplement }
}

function readPdfACMapProgramCidSystemInfo(name: string, label: string, context: string): PdfACidSystemInfo {
  const resource = adobeCMapResource(name)
  if (resource === null) throw new Error(`PDF conformance error: ${label} has unknown predefined CMap ${name} for ${context}`)
  const text = pdfBytesToLatin1(resource)
  const registry = readPdfACMapLiteral(text, 'Registry')
  const ordering = readPdfACMapLiteral(text, 'Ordering')
  const supplementMatch = /\/Supplement\s+(\d+)\b/.exec(text)
  if (registry === null || ordering === null || supplementMatch === null) {
    throw new Error(`PDF conformance error: ${label} predefined CMap ${name} omits CIDSystemInfo for ${context}`)
  }
  return { registry, ordering, supplement: Number(supplementMatch[1]) }
}

function readPdfACMapLiteral(program: string, key: string): Uint8Array | null {
  const match = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`).exec(program)
  if (match === null) return null
  const source = match[1]!
  const bytes: number[] = []
  for (let index = 0; index < source.length; index++) {
    let value = source.charCodeAt(index) & 0xFF
    if (value !== 0x5C) {
      bytes.push(value)
      continue
    }
    index++
    if (index >= source.length) break
    value = source.charCodeAt(index) & 0xFF
    if (value >= 0x30 && value <= 0x37) {
      let octal = value - 0x30
      for (let count = 0; count < 2 && index + 1 < source.length; count++) {
        const next = source.charCodeAt(index + 1) & 0xFF
        if (next < 0x30 || next > 0x37) break
        index++
        octal = octal * 8 + next - 0x30
      }
      bytes.push(octal & 0xFF)
    } else {
      bytes.push(value)
    }
  }
  return new Uint8Array(bytes)
}

function decodePdfNameToken(token: string): string {
  return token.replace(/#([0-9A-Fa-f]{2})/g, function (_match, hex: string) {
    return String.fromCharCode(Number.parseInt(hex, 16))
  })
}

function requirePdfFontEmbedded(
  doc: ReturnType<typeof parsePdf>,
  value: PdfValue,
  label: string,
  context: string,
  checked: Set<PdfDict>,
  rendersGlyphs: boolean,
): void {
  const font = doc.resolve(value)
  if (!(font instanceof Map)) throw new Error(`PDF conformance error: ${label} requires ${context} to be a font dictionary`)
  if (checked.has(font)) return
  checked.add(font)

  if (pdfNameValue(doc.resolve(font.get('Type') ?? null)) !== 'Font') {
    throw new Error(`PDF conformance error: ${label} requires Type Font for ${context}`)
  }
  const subtype = pdfNameValue(doc.resolve(font.get('Subtype') ?? null))
  if (subtype === null || !['Type1', 'MMType1', 'TrueType', 'Type3', 'Type0', 'CIDFontType0', 'CIDFontType2'].includes(subtype)) {
    throw new Error(`PDF conformance error: ${label} has an invalid font Subtype for ${context}`)
  }
  const baseFont = doc.resolve(font.get('BaseFont') ?? null)
  if (subtype !== 'Type3' && !(baseFont instanceof PdfName)) {
    throw new Error(`PDF conformance error: ${label} requires BaseFont for ${context}`)
  }
  if (baseFont instanceof PdfName && (label === 'PDF/A-2b' || label === 'PDF/A-3b')) {
    validatePdfA23Utf8Name(baseFont.name, label, `${context}/BaseFont`)
  }
  if (subtype === 'Type0') {
    const descendants = doc.resolve(font.get('DescendantFonts') ?? null)
    if (!Array.isArray(descendants) || descendants.length !== 1) {
      throw new Error(`PDF conformance error: ${label} requires embedded fonts for ${context}`)
    }
    const encoding = doc.resolve(font.get('Encoding') ?? null)
    if (!(encoding instanceof PdfName) && !(encoding instanceof PdfStream)) {
      throw new Error(`PDF conformance error: ${label} requires a named or embedded CMap Encoding for ${context}`)
    }
    if (encoding instanceof PdfName && !isPdfACMapAvailableWithoutEmbedding(label, encoding.name)) {
      throw new Error(`PDF conformance error: ${label} requires non-standard CMap ${encoding.name} to be embedded for ${context}`)
    }
    for (let i = 0; i < descendants.length; i++) {
      requirePdfFontEmbedded(doc, descendants[i]!, label, `${context} descendant ${i + 1}`, checked, rendersGlyphs)
    }
    const decoder = createFontDecoder(doc, font)
    if (encoding instanceof PdfStream) {
      const dictionaryWMode = doc.resolve(encoding.dict.get('WMode') ?? 0)
      if ((dictionaryWMode !== 0 && dictionaryWMode !== 1)
        || (dictionaryWMode === 1) !== decoder.vertical) {
        throw new Error(`PDF conformance error: ${label} embedded CMap WMode does not match its stream program for ${context}`)
      }
      validatePdfACMapUseCMap(doc, encoding, label, context)
    }
    validatePdfACidSystemCompatibility(doc, descendants[0]!, encoding, label, context)
    return
  }

  if (subtype === 'Type3') {
    validatePdfSimpleFontWidths(doc, font, label, context, true, rendersGlyphs)
    return
  }

  const standardFont = baseFont instanceof PdfName ? resolveStandardFontName(baseFont.name) : null
  if (!rendersGlyphs && standardFont !== null && !(doc.resolve(font.get('FontDescriptor') ?? null) instanceof Map)) {
    validatePdfSimpleFontWidths(doc, font, label, context, false, false)
    return
  }
  const descriptor = requirePdfFontDescriptor(doc, font, label, context)
  const subsetCidFont = (subtype === 'CIDFontType0' || subtype === 'CIDFontType2')
    && baseFont instanceof PdfName && /^[A-Z]{6}\+/.test(baseFont.name)
  if (subtype === 'CIDFontType0' || subtype === 'CIDFontType2') {
    validatePdfCidSystemInfo(doc, font, label, context)
  } else {
    validatePdfSimpleFontWidths(doc, font, label, context, false, rendersGlyphs)
  }
  if (subsetCidFont) {
    const cidSet = doc.resolve(descriptor.get('CIDSet') ?? null)
    if (label === 'PDF/A-1b' && !(cidSet instanceof PdfStream)) {
      throw new Error(`PDF conformance error: ${label} requires CIDSet for ${context}`)
    }
    if (cidSet instanceof PdfStream) validatePdfACidSet(doc, font, descriptor, cidSet, label, context)
  }
  if (subtype === 'CIDFontType2' || subtype === 'TrueType') {
    if (subtype === 'CIDFontType2' && rendersGlyphs) {
      const cidToGidMap = doc.resolve(font.get('CIDToGIDMap') ?? null)
      if (!(cidToGidMap instanceof PdfName) && !(cidToGidMap instanceof PdfStream)) {
        throw new Error(`PDF conformance error: ${label} requires CIDToGIDMap for ${context}`)
      }
    }
    if (rendersGlyphs) requirePdfFontFileStream(doc, descriptor, 'FontFile2', label, context)
    return
  }
  if (subtype === 'CIDFontType0') {
    if (rendersGlyphs) {
      requirePdfFontFileStream(doc, descriptor, 'FontFile3', label, context)
      requirePdfFontFileSubtype(doc, descriptor, label === 'PDF/A-2b' || label === 'PDF/A-3b' ? ['CIDFontType0C', 'OpenType'] : ['CIDFontType0C'], label, context)
    }
    return
  }
  if (subtype === 'Type1' || subtype === 'MMType1') {
    const charSet = doc.resolve(descriptor.get('CharSet') ?? null)
    if (label === 'PDF/A-1b' && baseFont instanceof PdfName && /^[A-Z]{6}\+/.test(baseFont.name)) {
      if (!(charSet instanceof PdfString) || charSet.bytes.length === 0) {
        throw new Error(`PDF conformance error: ${label} Type1 subset requires CharSet for ${context}`)
      }
    }
    const type1Stream = doc.resolve(descriptor.get('FontFile') ?? null)
    if (type1Stream instanceof PdfStream && type1Stream.raw.length > 0) {
      if (charSet instanceof PdfString) {
        validatePdfAType1CharSet(doc.decodeStream(type1Stream), 'Type1', charSet, label, context)
      }
      return
    }
    if (hasPdfFontFileStream(doc, descriptor, 'FontFile3')) {
      requirePdfFontFileSubtype(doc, descriptor, label === 'PDF/A-2b' || label === 'PDF/A-3b' ? ['Type1C', 'OpenType'] : ['Type1C'], label, context)
      if (charSet instanceof PdfString) {
        const fontFile = doc.resolve(descriptor.get('FontFile3')!) as PdfStream
        const fontFileSubtype = pdfNameValue(doc.resolve(fontFile.dict.get('Subtype') ?? null)) as 'Type1C' | 'OpenType'
        validatePdfAType1CharSet(doc.decodeStream(fontFile), fontFileSubtype, charSet, label, context)
      }
      return
    }
    if (!rendersGlyphs) return
    throw new Error(`PDF conformance error: ${label} requires embedded fonts for ${context}`)
  }

  throw new Error(`PDF conformance error: ${label} requires embedded fonts for unsupported ${context} subtype ${subtype ?? 'unknown'}`)
}

function validatePdfAType1CharSet(
  bytes: Uint8Array,
  format: 'Type1' | 'Type1C' | 'OpenType',
  charSet: PdfString,
  label: string,
  context: string,
): void {
  const glyphNames: string[] = []
  if (format === 'Type1') {
    glyphNames.push(...parseType1(bytes, standardEncodingGlyphNames()).glyphNames)
  } else if (format === 'Type1C') {
    const copy = bytes.slice()
    const cff = parseCff(new BinaryReader(copy.buffer as ArrayBuffer))
    for (let glyphId = 0; glyphId < cff.charstrings.count; glyphId++) glyphNames.push(cffGlyphName(cff, glyphId))
  } else {
    const copy = bytes.slice()
    const font = Font.load(copy.buffer as ArrayBuffer)
    for (let glyphId = 0; glyphId < font.numGlyphs; glyphId++) {
      const name = font.getGlyphName(glyphId)
      if (name === null) {
        throw new Error(`PDF conformance error: ${label} embedded OpenType Type1 font omits glyph names for ${context}`)
      }
      glyphNames.push(name)
    }
  }

  const source = pdfBytesToLatin1(charSet.bytes)
  const listed: string[] = []
  const pattern = /\/([^\s/]+)/g
  for (const match of source.matchAll(pattern)) listed.push(decodePdfNameToken(match[1]!))
  if (source.replace(pattern, '').trim().length !== 0 || new Set(listed).size !== listed.length) {
    throw new Error(`PDF conformance error: ${label} Type1 CharSet is malformed for ${context}`)
  }
  const expected = new Set(glyphNames.filter(function (name) { return name !== '.notdef' }))
  const actual = new Set(listed)
  if (expected.size !== actual.size) {
    throw new Error(`PDF conformance error: ${label} Type1 CharSet does not list every embedded glyph for ${context}`)
  }
  for (const name of expected) {
    if (!actual.has(name)) {
      throw new Error(`PDF conformance error: ${label} Type1 CharSet omits glyph ${name} for ${context}`)
    }
  }
}

function validatePdfSimpleFontWidths(
  doc: ReturnType<typeof parsePdf>,
  font: PdfDict,
  label: string,
  context: string,
  type3: boolean,
  rendersGlyphs: boolean,
): void {
  const first = doc.resolve(font.get('FirstChar') ?? null)
  const last = doc.resolve(font.get('LastChar') ?? null)
  const widths = doc.resolve(font.get('Widths') ?? null)
  const baseFont = doc.resolve(font.get('BaseFont') ?? null)
  const standardFont = baseFont instanceof PdfName ? resolveStandardFontName(baseFont.name) : null
  const omitsStandardWidths = standardFont !== null && first === null && last === null && widths === null
  if (!omitsStandardWidths && (typeof first !== 'number' || !Number.isInteger(first) || first < 0 || first > 255
    || typeof last !== 'number' || !Number.isInteger(last) || last < first || last > 255
    || !Array.isArray(widths) || widths.length !== last - first + 1)) {
    throw new Error(`PDF conformance error: ${label} requires consistent FirstChar, LastChar, and Widths for ${context}`)
  }
  if (omitsStandardWidths) return
  if (!Array.isArray(widths)) throw new Error(`PDF conformance error: ${label} requires Widths for ${context}`)
  for (let index = 0; index < widths.length; index++) {
    const width = doc.resolve(widths[index]!)
    if (typeof width !== 'number' || !Number.isFinite(width)) {
      throw new Error(`PDF conformance error: ${label} Widths must contain finite numbers for ${context}`)
    }
  }
  if (type3 || pdfNameValue(doc.resolve(font.get('Subtype') ?? null)) !== 'TrueType') return
  const descriptor = requirePdfFontDescriptor(doc, font, label, context)
  const flags = doc.resolve(descriptor.get('Flags') ?? null)
  if (typeof flags !== 'number' || !Number.isInteger(flags)) {
    throw new Error(`PDF conformance error: ${label} TrueType FontDescriptor requires integer Flags for ${context}`)
  }
  const symbolic = (flags & 4) !== 0
  const encoding = doc.resolve(font.get('Encoding') ?? null)
  const fontFile = doc.resolve(descriptor.get('FontFile2') ?? null)
  const embedded = fontFile instanceof PdfStream
    ? loadPdfATrueTypeFont(doc, descriptor, label, context)
    : null
  if (embedded === null && rendersGlyphs) {
    throw new Error(`PDF conformance error: ${label} requires FontFile2 for ${context}`)
  }
  const cmapRecords = embedded === null
    ? []
    : embedded.cmap.encodingRecords.filter(function (record) { return record.format !== 14 })
  const hasMicrosoftSymbol = cmapRecords.some(function (record) { return record.platformId === 3 && record.encodingId === 0 })
  if (symbolic) {
    if (encoding !== null) throw new Error(`PDF conformance error: ${label} symbolic TrueType font forbids Encoding for ${context}`)
    if (embedded !== null && cmapRecords.length !== 1 && !hasMicrosoftSymbol) {
      throw new Error(`PDF conformance error: ${label} symbolic TrueType font requires one cmap or Microsoft Symbol cmap for ${context}`)
    }
    return
  }
  let baseEncoding: PdfValue = encoding
  let differences: PdfValue = null
  if (encoding instanceof Map) {
    differences = doc.resolve(encoding.get('Differences') ?? null)
    if (label === 'PDF/A-1b' && differences !== null) {
      throw new Error(`PDF conformance error: ${label} non-symbolic TrueType Encoding forbids Differences for ${context}`)
    }
    baseEncoding = doc.resolve(encoding.get('BaseEncoding') ?? null)
  }
  if (!(baseEncoding instanceof PdfName)
    || (baseEncoding.name !== 'MacRomanEncoding' && baseEncoding.name !== 'WinAnsiEncoding')) {
    throw new Error(`PDF conformance error: ${label} non-symbolic TrueType font requires MacRomanEncoding or WinAnsiEncoding for ${context}`)
  }
  if (embedded !== null && (hasMicrosoftSymbol ? cmapRecords.length <= 1 : cmapRecords.length === 0)) {
    throw new Error(`PDF conformance error: ${label} non-symbolic TrueType font requires a non-symbolic cmap for ${context}`)
  }
  if (differences !== null) {
    if (!Array.isArray(differences)) {
      throw new Error(`PDF conformance error: ${label} TrueType Differences must be an array for ${context}`)
    }
    for (let index = 0; index < differences.length; index++) {
      const entry = doc.resolve(differences[index]!)
      if (typeof entry === 'number') continue
      if (!(entry instanceof PdfName) || aglNameToUnicode(entry.name) === undefined) {
        throw new Error(`PDF conformance error: ${label} TrueType Differences contains a glyph outside the Adobe Glyph List for ${context}`)
      }
    }
    const hasMicrosoftUnicode = cmapRecords.some(function (record) { return record.platformId === 3 && record.encodingId === 1 })
    if (embedded !== null && !hasMicrosoftUnicode) {
      throw new Error(`PDF conformance error: ${label} TrueType Differences requires a Microsoft Unicode cmap for ${context}`)
    }
  }
}

function loadPdfATrueTypeFont(
  doc: ReturnType<typeof parsePdf>,
  descriptor: PdfDict,
  label: string,
  context: string,
): Font {
  const stream = doc.resolve(descriptor.get('FontFile2') ?? null)
  if (!(stream instanceof PdfStream)) {
    throw new Error(`PDF conformance error: ${label} requires FontFile2 for ${context}`)
  }
  const bytes = doc.decodeStream(stream)
  const copy = bytes.slice()
  try {
    return Font.load(copy.buffer)
  } catch (error) {
    throw new Error(`PDF conformance error: ${label} embedded TrueType font is invalid for ${context}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function validatePdfCidSystemInfo(
  doc: ReturnType<typeof parsePdf>,
  font: PdfDict,
  label: string,
  context: string,
): void {
  const info = doc.resolve(font.get('CIDSystemInfo') ?? null)
  if (!(info instanceof Map)
    || !(doc.resolve(info.get('Registry') ?? null) instanceof PdfString)
    || !(doc.resolve(info.get('Ordering') ?? null) instanceof PdfString)) {
    throw new Error(`PDF conformance error: ${label} CIDFont requires CIDSystemInfo Registry and Ordering for ${context}`)
  }
  const supplement = doc.resolve(info.get('Supplement') ?? null)
  if (typeof supplement !== 'number' || !Number.isInteger(supplement) || supplement < 0) {
    throw new Error(`PDF conformance error: ${label} CIDSystemInfo requires a non-negative integer Supplement for ${context}`)
  }
}

function requirePdfFontFileSubtype(
  doc: ReturnType<typeof parsePdf>,
  descriptor: PdfDict,
  expected: readonly ('Type1C' | 'CIDFontType0C' | 'OpenType')[],
  label: string,
  context: string,
): void {
  const stream = doc.resolve(descriptor.get('FontFile3') ?? null)
  const subtype = stream instanceof PdfStream ? pdfNameValue(doc.resolve(stream.dict.get('Subtype') ?? null)) : null
  if (!(stream instanceof PdfStream) || subtype === null || !expected.includes(subtype as 'Type1C' | 'CIDFontType0C' | 'OpenType')) {
    throw new Error(`PDF conformance error: ${label} FontFile3 requires Subtype ${expected.join(' or ')} for ${context}`)
  }
}

function validatePdfACidSet(
  doc: ReturnType<typeof parsePdf>,
  font: PdfDict,
  descriptor: PdfDict,
  cidSet: PdfStream,
  label: string,
  context: string,
): void {
  const bits = doc.decodeStream(cidSet)
  if (bits.length === 0) throw new Error(`PDF conformance error: ${label} CIDSet is empty for ${context}`)
  const subtype = pdfNameValue(doc.resolve(font.get('Subtype') ?? null))
  const required = subtype === 'CIDFontType2'
    ? collectPdfATrueTypeCids(doc, font, descriptor, label, context)
    : collectPdfACffCids(doc, descriptor, label, context)
  for (const cid of required) {
    const byteIndex = cid >>> 3
    const bit = 0x80 >>> (cid & 7)
    if (byteIndex >= bits.length || (bits[byteIndex]! & bit) === 0) {
      throw new Error(`PDF conformance error: ${label} CIDSet omits embedded CID ${cid} for ${context}`)
    }
  }
}

function collectPdfATrueTypeCids(
  doc: ReturnType<typeof parsePdf>,
  font: PdfDict,
  descriptor: PdfDict,
  label: string,
  context: string,
): Set<number> {
  const embedded = loadPdfATrueTypeFont(doc, descriptor, label, context)
  const mapping = doc.resolve(font.get('CIDToGIDMap') ?? null)
  const result = new Set<number>([0])
  if (mapping instanceof PdfName) {
    if (mapping.name !== 'Identity') {
      throw new Error(`PDF conformance error: ${label} CIDToGIDMap name must be Identity for ${context}`)
    }
    const maximum = Math.min(embedded.numGlyphs - 1, 65535)
    for (let cid = 1; cid <= maximum; cid++) result.add(cid)
    return result
  }
  if (!(mapping instanceof PdfStream)) {
    throw new Error(`PDF conformance error: ${label} CIDFontType2 requires CIDToGIDMap for ${context}`)
  }
  const bytes = doc.decodeStream(mapping)
  if ((bytes.length & 1) !== 0 || bytes.length > 131072) {
    throw new Error(`PDF conformance error: ${label} CIDToGIDMap has an invalid length for ${context}`)
  }
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const glyphId = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (glyphId >= embedded.numGlyphs) {
      throw new Error(`PDF conformance error: ${label} CIDToGIDMap references missing glyph ${glyphId} for ${context}`)
    }
    if (glyphId !== 0) result.add(offset >>> 1)
  }
  return result
}

function collectPdfACffCids(
  doc: ReturnType<typeof parsePdf>,
  descriptor: PdfDict,
  label: string,
  context: string,
): Set<number> {
  const stream = doc.resolve(descriptor.get('FontFile3') ?? null)
  if (!(stream instanceof PdfStream)) {
    throw new Error(`PDF conformance error: ${label} CIDFontType0 requires FontFile3 for ${context}`)
  }
  const subtype = pdfNameValue(doc.resolve(stream.dict.get('Subtype') ?? null))
  const bytes = doc.decodeStream(stream).slice()
  let cffReader: BinaryReader
  if (subtype === 'CIDFontType0C') {
    cffReader = new BinaryReader(bytes.buffer as ArrayBuffer)
  } else if (subtype === 'OpenType') {
    const sfnt = parseFont(bytes.buffer as ArrayBuffer)
    const reader = getTableReader(sfnt, 'CFF ')
    if (reader === null) {
      throw new Error(`PDF conformance error: ${label} OpenType CIDFontType0 requires a CFF table for ${context}`)
    }
    cffReader = reader
  } else {
    throw new Error(`PDF conformance error: ${label} CIDFontType0 has invalid FontFile3 subtype for ${context}`)
  }
  const cff = parseCff(cffReader)
  if (!cff.isCIDFont) {
    throw new Error(`PDF conformance error: ${label} CIDFontType0 requires a CID-keyed CFF program for ${context}`)
  }
  const result = new Set<number>()
  for (let glyphId = 0; glyphId < cff.charset.length; glyphId++) result.add(cff.charset[glyphId]!)
  return result
}

function requirePdfFontDescriptor(doc: ReturnType<typeof parsePdf>, font: PdfDict, label: string, context: string): PdfDict {
  const descriptor = doc.resolve(font.get('FontDescriptor') ?? null)
  if (!(descriptor instanceof Map)) {
    throw new Error(`PDF conformance error: ${label} requires embedded fonts for ${context}`)
  }
  const fontName = doc.resolve(descriptor.get('FontName') ?? null)
  if (!(fontName instanceof PdfName)) {
    throw new Error(`PDF conformance error: ${label} FontDescriptor requires FontName for ${context}`)
  }
  if (label === 'PDF/A-2b' || label === 'PDF/A-3b') {
    validatePdfA23Utf8Name(fontName.name, label, `${context}/FontDescriptor/FontName`)
  }
  return descriptor
}

function requirePdfFontFileStream(
  doc: ReturnType<typeof parsePdf>,
  descriptor: PdfDict,
  key: 'FontFile' | 'FontFile2' | 'FontFile3',
  label: string,
  context: string,
): void {
  if (!hasPdfFontFileStream(doc, descriptor, key)) {
    throw new Error(`PDF conformance error: ${label} requires embedded fonts for ${context}`)
  }
}

function hasPdfFontFileStream(doc: ReturnType<typeof parsePdf>, descriptor: PdfDict, key: 'FontFile' | 'FontFile2' | 'FontFile3'): boolean {
  const fontFile = doc.resolve(descriptor.get(key) ?? null)
  return fontFile instanceof PdfStream && fontFile.raw.length > 0
}

function pdfNameValue(value: PdfValue): string | null {
  return value instanceof PdfName ? value.name : null
}

function validatePdfA23Utf8Name(name: string, pdfa: PdfAConformance, context: string): void {
  if (pdfa === 'PDF/A-1b') return
  const bytes = new Uint8Array(name.length)
  for (let index = 0; index < name.length; index++) bytes[index] = name.charCodeAt(index) & 0xFF
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`PDF conformance error: ${pdfa} requires a valid UTF-8 name at ${context}`)
  }
}

function requirePdfRect(doc: ReturnType<typeof parsePdf>, value: PdfValue, message: string): [number, number, number, number] {
  const rect = doc.resolve(value)
  if (!Array.isArray(rect) || rect.length !== 4) {
    throw new Error(`PDF conformance error: ${message}`)
  }
  const x0 = requirePdfRectNumber(doc, rect[0]!, message)
  const y0 = requirePdfRectNumber(doc, rect[1]!, message)
  const x1 = requirePdfRectNumber(doc, rect[2]!, message)
  const y1 = requirePdfRectNumber(doc, rect[3]!, message)
  if (x1 <= x0 || y1 <= y0) throw new Error(`PDF conformance error: ${message}`)
  return [x0, y0, x1, y1]
}

function requirePdfRectNumber(doc: ReturnType<typeof parsePdf>, value: PdfValue, message: string): number {
  const n = doc.resolve(value)
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`PDF conformance error: ${message}`)
  return n
}

function requirePdfRectInside(inner: [number, number, number, number], outer: [number, number, number, number], message: string): void {
  if (inner[0] < outer[0] || inner[1] < outer[1] || inner[2] > outer[2] || inner[3] > outer[3]) {
    throw new Error(`PDF conformance error: ${message}`)
  }
}

function requirePdfRectOutside(inner: [number, number, number, number], outer: [number, number, number, number], message: string): void {
  if (inner[0] < outer[2] && inner[2] > outer[0] && inner[1] < outer[3] && inner[3] > outer[1]) {
    throw new Error(`PDF conformance error: ${message}`)
  }
}

function validatePdfAOutputIntents(
  catalog: PdfDict,
  doc: ReturnType<typeof parsePdf>,
  pdfa: PdfAConformance,
): string | null {
  const outputIntents = doc.resolve(catalog.get('OutputIntents') ?? null)
  if (outputIntents === null) return null
  if (!Array.isArray(outputIntents)) {
    throw new Error(`PDF conformance error: ${pdfa} Catalog OutputIntents must be an array`)
  }
  let pdfaIntent: PdfDict | null = null
  let sharedProfile: PdfRef | null = null
  for (let index = 0; index < outputIntents.length; index++) {
    const outputIntent = doc.resolve(outputIntents[index]!)
    if (!(outputIntent instanceof Map)) {
      throw new Error(`PDF conformance error: ${pdfa} OutputIntents entry ${index + 1} must be a dictionary`)
    }
    if (outputIntent.has('Type')) {
      requirePdfName(outputIntent.get('Type')!, 'OutputIntent', `${pdfa} OutputIntents entry ${index + 1} Type must be OutputIntent`)
    }
    const subtype = doc.resolve(outputIntent.get('S') ?? null)
    if (pdfa !== 'PDF/A-1b' && subtype instanceof PdfName && subtype.name === 'GTS_PDFX'
      && outputIntent.has('DestOutputProfileRef')) {
      throw new Error(`PDF conformance error: ${pdfa} PDF/X OutputIntent forbids DestOutputProfileRef`)
    }
    const profile = outputIntent.get('DestOutputProfile')
    if (profile !== undefined) {
      if (!(profile instanceof PdfRef)) {
        throw new Error(`PDF conformance error: ${pdfa} destination output profiles must be indirect streams`)
      }
      if (sharedProfile === null) sharedProfile = profile
      else if (profile.num !== sharedProfile.num || profile.gen !== sharedProfile.gen) {
        throw new Error(`PDF conformance error: ${pdfa} OutputIntents must share one destination output profile`)
      }
    }
    if (subtype instanceof PdfName && subtype.name === 'GTS_PDFA1') {
      if (profile === undefined) {
        throw new Error(`PDF conformance error: ${pdfa} GTS_PDFA1 OutputIntent requires DestOutputProfile`)
      }
      if (pdfaIntent === null) pdfaIntent = outputIntent
    }
  }
  if (pdfaIntent === null) return null
  const profile = requireOutputProfileComponents(
    doc,
    pdfaIntent,
    [1, 3, 4],
    `${pdfa} requires a GRAY, RGB, or CMYK destination profile`,
    pdfa === 'PDF/A-1b' ? 2 : 4,
  )
  return profile.dataColorSpace
}

function requiredPdfXOutputIntent(
  catalog: PdfDict,
  doc: ReturnType<typeof parsePdf>,
  pdfx: PdfXConformance,
  outputConditionValidator: import('../pdf/pdf-output-intent.js').PdfXOutputConditionValidator | undefined,
): PdfDict {
  const outputIntents = doc.resolve(catalog.get('OutputIntents') ?? null)
  if (!Array.isArray(outputIntents) || outputIntents.length === 0) {
    throw new Error(`PDF conformance error: ${pdfx} requires Catalog /OutputIntents`)
  }
  let pdfxIntent: PdfDict | null = null
  for (let index = 0; index < outputIntents.length; index++) {
    const outputIntent = doc.resolve(outputIntents[index]!)
    if (!(outputIntent instanceof Map)) {
      throw new Error(`PDF conformance error: ${pdfx} OutputIntents entry ${index + 1} must be a dictionary`)
    }
    requirePdfName(outputIntent.get('Type') ?? null, 'OutputIntent', `${pdfx} OutputIntents entry ${index + 1} requires Type OutputIntent`)
    const subtype = doc.resolve(outputIntent.get('S') ?? null)
    if (!(subtype instanceof PdfName)) {
      throw new Error(`PDF conformance error: ${pdfx} OutputIntents entry ${index + 1} requires an S name`)
    }
    if (subtype.name === 'GTS_PDFX') {
      if (pdfxIntent !== null) throw new Error(`PDF conformance error: ${pdfx} requires exactly one GTS_PDFX OutputIntent`)
      pdfxIntent = outputIntent
    }
  }
  if (pdfxIntent === null) throw new Error(`PDF conformance error: ${pdfx} requires exactly one GTS_PDFX OutputIntent`)

  const identifier = doc.resolve(pdfxIntent.get('OutputConditionIdentifier') ?? null)
  if (!(identifier instanceof PdfString)) {
    throw new Error(`PDF conformance error: ${pdfx} OutputIntent requires an OutputConditionIdentifier text string`)
  }
  const registryValue = doc.resolve(pdfxIntent.get('RegistryName') ?? null)
  if (registryValue !== null && !(registryValue instanceof PdfString)) {
    throw new Error(`PDF conformance error: ${pdfx} OutputIntent RegistryName must be a text string`)
  }
  const registry = registryValue instanceof PdfString ? decodePdfTextStringBytes(registryValue.bytes) : null
  if (registry !== null) {
    if (outputConditionValidator === undefined) {
      throw new Error(`PDF conformance error: ${pdfx} registered OutputIntent requires pdfxOutputConditionValidator`)
    }
    const exact = outputConditionValidator({
      registryName: registry,
      outputConditionIdentifier: decodePdfTextStringBytes(identifier.bytes),
    })
    if (!exact) throw new Error(`PDF conformance error: ${pdfx} OutputConditionIdentifier does not exactly match its registry entry`)
  }
  const profileValue = pdfxIntent.get('DestOutputProfile')
  if (profileValue === undefined && registry !== 'http://www.color.org') {
    throw new Error(`PDF conformance error: ${pdfx} OutputIntent requires DestOutputProfile without the ICC registry`)
  }
  if (profileValue !== undefined) {
    if (!(profileValue instanceof PdfRef)) {
      throw new Error(`PDF conformance error: ${pdfx} DestOutputProfile must be an indirect stream`)
    }
    const header = requireOutputProfileComponents(
      doc,
      pdfxIntent,
      4,
      `${pdfx} requires a four-component CMYK destination profile`,
      4,
    )
    if (header.versionMajor !== 2 || header.profileClass !== 'output' || header.dataColorSpace !== 'CMYK') {
      throw new Error(`PDF conformance error: ${pdfx} DestOutputProfile must be an ICC.1:1998 version 2 CMYK Output Device Profile`)
    }
  }
  return pdfxIntent
}

function requireOutputProfileComponents(
  doc: ReturnType<typeof parsePdf>,
  outputIntent: PdfDict,
  expected: number | readonly number[],
  message: string,
  maximumIccMajorVersion = 4,
): IccProfileHeader {
  const profile = doc.resolve(outputIntent.get('DestOutputProfile') ?? null)
  if (!(profile instanceof PdfStream)) throw new Error(`PDF conformance error: ${message}`)
  const n = doc.resolve(profile.dict.get('N') ?? null)
  const expectedValues = typeof expected === 'number' ? [expected] : expected
  if (typeof n !== 'number' || !expectedValues.includes(n)) throw new Error(`PDF conformance error: ${message}`)
  const header = inspectIccProfile(doc.decodeStream(profile))
  if (header.components !== n || header.versionMajor > maximumIccMajorVersion
    || (header.profileClass !== 'output' && header.profileClass !== 'display')
    || (header.dataColorSpace !== 'GRAY' && header.dataColorSpace !== 'RGB' && header.dataColorSpace !== 'CMYK')) {
    throw new Error(`PDF conformance error: ${message}`)
  }
  return header
}

function requirePdfName(value: PdfValue, name: string, message: string): void {
  if (!(value instanceof PdfName) || value.name !== name) {
    throw new Error(`PDF conformance error: ${message}`)
  }
}

function requirePdfValue(value: PdfValue, message: string): void {
  if (value === null || value === undefined) throw new Error(`PDF conformance error: ${message}`)
}

function pdfBytesToLatin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes)
}

/** Generate a random 16-byte fileId as a 32-character hex string. */
function generateRandomFileId(): string {
  return bytesToHex(randomBytes(16))
}

/** Escape XML special characters. */
function xmlEscape(s: string): string {
  let r = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch === 0x26) r += '&amp;'       // &
    else if (ch === 0x3C) r += '&lt;'    // <
    else if (ch === 0x3E) r += '&gt;'    // >
    else if (ch === 0x22) r += '&quot;'  // "
    else if (ch === 0x27) r += '&apos;'  // '
    else r += s[i]
  }
  return r
}

/** Escape PDF string characters: parentheses and backslashes. */
function pdfEscapeString(s: string): string {
  validateUnicodeScalars(s, 'PDF text string')
  // Defer the text-string byte encoding until the writer knows the selected
  // PDF version. PDF 2.0 uses UTF-8+BOM; earlier versions use UTF-16BE+BOM.
  let requiresUnicode = false
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code > 0x7E || code <= 0x08 || code === 0x0B || code === 0x0C
      || (code >= 0x0E && code <= 0x17) || code === 0x7F) {
      requiresUnicode = true
      break
    }
  }
  if (requiresUnicode) {
    let hex = ''
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0')
    return `~tsr-text-${hex}~`
  }
  let escaped = ''
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code === 0x5C) escaped += '\\\\'
    else if (code === 0x28) escaped += '\\('
    else if (code === 0x29) escaped += '\\)'
    else if (code === 0x0A) escaped += '\\n'
    else if (code === 0x0D) escaped += '\\r'
    else if (code === 0x09) escaped += '\\t'
    else if (code === 0x7E) escaped += '\\176'
    else escaped += s[i]!
  }
  return escaped
}

function validateUnicodeScalars(value: string, label: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const low = value.charCodeAt(i + 1)
      if (low < 0xDC00 || low > 0xDFFF) throw new Error(`${label} contains an unpaired high surrogate`)
      i++
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new Error(`${label} contains an unpaired low surrogate`)
    }
  }
}

function expandPdfTextPlaceholders(value: string, pdf20: boolean): string {
  return value.replace(/~tsr-text-([0-9a-f]+)~/g, function (_match, hex: string): string {
    let text = ''
    for (let i = 0; i < hex.length; i += 4) text += String.fromCharCode(parseInt(hex.substring(i, i + 4), 16))
    const bytes = pdf20 ? encodePdfUtf8TextString(text) : encodePdfUtf16TextString(text)
    let escaped = ''
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!
      if (b === 0x28) escaped += '\\('
      else if (b === 0x29) escaped += '\\)'
      else if (b === 0x5C) escaped += '\\\\'
      else if (b >= 0x20 && b <= 0x7E) escaped += String.fromCharCode(b)
      else escaped += `\\${b.toString(8).padStart(3, '0')}`
    }
    return escaped
  })
}

function encodePdfUtf8TextString(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value)
  const bytes = new Uint8Array(encoded.length + 3)
  bytes.set([0xEF, 0xBB, 0xBF])
  bytes.set(encoded, 3)
  return bytes
}

function encodePdfUtf16TextString(value: string): Uint8Array {
  const bytes = new Uint8Array(2 + value.length * 2)
  bytes[0] = 0xFE
  bytes[1] = 0xFF
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    bytes[2 + i * 2] = code >>> 8
    bytes[3 + i * 2] = code & 0xFF
  }
  return bytes
}

/**
 * Generate a PDF UTF-16BE hex string.
 * Required for bookmark labels and other text containing non-ASCII characters.
 * BOM (FE FF) + UTF-16BE encoding.
 */

/** PDF hex string: <FEFF + UTF-16BE code units>. Used for /ActualText. */
function pdfUtf16BeHex(s: string): string {
  let out = 'FEFF'
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    out += ((code >> 8) & 0xFF).toString(16).padStart(2, '0')
    out += (code & 0xFF).toString(16).padStart(2, '0')
  }
  return '<' + out.toUpperCase() + '>'
}

function pdfUtf16BeHexString(s: string): string {
  // PDF literal string: BOM prefix + UTF-16BE bytes
  // Output surrogate pairs as UTF-16 encoding directly.
  const bytes: number[] = [0xFE, 0xFF]  // BOM
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    // charCodeAt returns surrogate pairs directly, which is correct for UTF-16BE.
    bytes.push((code >> 8) & 0xFF)
    bytes.push(code & 0xFF)
  }
  // Convert bytes to an escaped PDF literal string.
  let result = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if (b === 0x5C) result += '\\\\'    // backslash
    else if (b === 0x28) result += '\\(' // (
    else if (b === 0x29) result += '\\)' // )
    else result += String.fromCharCode(b)
  }
  return result
}
