import type { ElementDef, FrameDef, HyperlinkDef, PdfActionDef, PdfActionSubtypeDef, PdfDestinationDef, PdfDestinationFitDef, PdfEmbeddedTargetDef, PdfEmbeddedTargetSelectorDef, PdfLaunchPlatformParametersDef, PdfOptionalContentPropertiesDef, PdfOptionalContentStateDef, PdfPageTransitionDef, PdfRawValueDef, PdfStructureDestinationDef, PdfWindowsLaunchParametersDef, StyleDef } from '../types/template.js'
import { parsePdf, PdfDocument, PdfName, PdfRef, PdfStream, PdfString, type PdfDict, type PdfValue } from './pdf-parser.js'
import { collectPdfPages, type CollectedPage } from './pdf-import.js'
import { PdfContentInterpreter } from './content-interpreter.js'
import { PdfContentLexer } from './content-lexer.js'
import { createFontDecoder } from './pdf-text-decoder.js'
import { importPdfImageXObject, rawPdfDictionary, rawPdfValue } from './pdf-image-importer.js'
import {
  DEFAULT_STRUCTURE_NAMESPACE, PDF_20_STRUCTURE_NAMESPACE,
  isDefaultStructureRole, isPdf20StructureRole,
} from './pdf-logical-structure.js'
import { parsePdfPronunciationLexicon, type PdfPronunciationLexicon } from './pdf-pronunciation-lexicon.js'
import type {
  PdfDocumentRequirement,
  PdfDocumentRequirementHandler,
  PdfDocumentRequirementType,
  PdfCollection,
  PdfCollectionFieldSubtype,
  PdfCollectionFolder,
  PdfArticleInfo,
  PdfWebCapture,
  PdfWebCaptureCommand,
  PdfWebCaptureContentSet,
  PdfWebCaptureSource,
  PdfOutputIntent,
  PdfSeparationInfo,
  PdfPageTransparencyGroup,
  PdfDocumentPartMetadataValue,
  PdfAFRelationship,
  PdfEmbeddedFileMacParameters,
} from '../renderer/pdf-backend.js'
import { parsePdfColorSpace, pdfShadingColorSpaceDef } from './pdf-colorspace.js'
import { inspectIccProfile, parseIccProfile, type IccTransform } from './icc-profile-reader.js'
import { validateBcp47LanguageTag } from './language-tag.js'
import {
  parsePdfSignatureFieldLock,
  parsePdfSignatureSeedValue,
  type PdfSignatureFieldLock,
  type PdfSignatureSeedValue,
} from './pdf-signature-policy.js'
import type { PubSecCredential } from './pdf-pubsec.js'
import {
  parsePdfFragmentIdentifier,
  resolvePdfFragmentIdentifier,
  type PdfResolvedFragmentIdentifier,
} from './pdf-fragment-identifier.js'
import { decodePdfTextStringBytes } from './pdf-text-string.js'
import { validatePdfDestinationProfileReference, type PdfXOutputProfileResolver } from './pdf-output-intent.js'
import {
  comparePdfSpecificationVersions,
  requiredPdfVersionForExtensions,
  validatePdfDeveloperExtensions,
  type PdfDeveloperExtension,
  type PdfDeveloperExtensions,
  type PdfSpecificationVersion,
} from './pdf-extensions.js'
import { isXmlNmToken } from './xml-name.js'
import { md5 } from '../renderer/pdf-encryption.js'
import {
  parsePdfXmpPacket,
  validatePdfXmpSynchronization,
  type ParsedPdfXmpMetadata,
} from './pdf-xmp.js'
import {
  pdfMeasurementViewportFromRaw,
  type PdfMeasurementViewport,
} from './pdf-measurement.js'
import { validatePdfXfa, type PdfXfa, type PdfXfaPacket } from './pdf-xfa.js'
import { decodeU3dScene, type Pdf3DDecodedScene } from './pdf-3d.js'
import { decodePrcScene } from './pdf-prc.js'

type Matrix = [number, number, number, number, number, number]

export interface PdfImportOptions {
  annotationIntent?: 'screen' | 'print'
  /** Whether annotation appearance streams are painted into imported page elements. Defaults to true. */
  includeAnnotationAppearances?: boolean
  includeInvisibleText?: boolean
  /** Converts imported shown text to glyph-outline paths. */
  outlineText?: boolean
  /** Target raster resolution used to grid-fit Type 1 glyph outlines. */
  outlineDpi?: number
  imageIdPrefix?: string
  password?: string
  /** X.509 certificate and private key for an Adobe.PubSec encrypted PDF. */
  recipient?: PubSecCredential
  onProgress?: PdfImportProgressCallback
  /** Resolves a font program when the PDF references a non-embedded font. */
  fontResolver?: PdfFontResolver
  /** Resolves a registered PDF/X output condition to its ICC profile bytes. */
  pdfxOutputProfileResolver?: PdfXOutputProfileResolver
  optionalContentContext?: {
    event?: 'View' | 'Print' | 'Export'
    zoom?: number
    language?: string
    user?: { individual?: string, title?: string, organization?: string }
  }
}

export type PdfImportProgressStage =
  | 'open-parse'
  | 'open-pages'
  | 'open-complete'
  | 'page-contents'
  | 'page-interpret'
  | 'page-annotations'
  | 'page-complete'

export interface PdfImportProgress {
  stage: PdfImportProgressStage
  pageIndex?: number
  done: number
  total: number
}

export type PdfImportProgressCallback = (progress: PdfImportProgress) => void

export interface ImportedPage {
  width: number
  height: number
  elements: ElementDef[]
  images: Record<string, Uint8Array>
  fonts: ImportedFontInfo[]
  /** Named text styles referenced by staticText elements (font family / size / weight) */
  styles: StyleDef[]
  /** Page dictionary semantics that are not represented by rendered elements. */
  pageProperties: ImportedPageProperties
  optionalContentProperties?: PdfOptionalContentPropertiesDef
}

export interface ImportedRedactionAppearance {
  elements: ElementDef[]
  images: Record<string, Uint8Array>
  fonts: ImportedFontInfo[]
  styles: StyleDef[]
}

export interface ImportedPageProperties {
  boxes: ImportedPageBoxes
  userUnit: number
  rotate: 0 | 90 | 180 | 270
  contentStreamCount: number
  tabs?: 'R' | 'C' | 'S'
  duration?: number
  transition?: PdfPageTransitionDef
  viewports?: Record<string, PdfRawValueDef>[]
  /** Parsed coordinate and measurement semantics for /VP entries containing /Measure or /PtData. */
  measurementViewports?: PdfMeasurementViewport[]
  additionalActions?: Record<string, PdfRawValueDef>
  /** Page trigger actions as typed, non-executable action trees. */
  additionalActionModels?: Record<string, PdfActionDef>
  metadata?: Extract<PdfRawValueDef, { kind: 'stream' }>
  pieceInfo?: Record<string, PdfRawValueDef>
  lastModified?: PdfRawValueDef
  separationInfo?: PdfSeparationInfo
  transparencyGroup?: PdfPageTransparencyGroup
}

export interface ImportedFontInfo {
  baseFont: string
  familyName: string
  subtype: string
  flags: number
  italic: boolean
  serif: boolean
  fixedPitch: boolean
  bold: boolean
  fontFile?: Uint8Array
  fontFileFormat?: 'truetype' | 'type1' | 'cff' | 'opentype'
}

export interface PdfResolvedFontProgram {
  data: Uint8Array
  format: 'truetype' | 'type1' | 'cff' | 'opentype'
}

export type PdfFontResolver = (font: Readonly<ImportedFontInfo>) => PdfResolvedFontProgram | null

/** One imported interactive form (AcroForm) field. */
export interface ImportedFormField {
  /** Fully qualified name: parent partial names joined with '.' (ISO 32000 12.7.3.2) */
  name: string
  /** Field type /FT: 'Btn' | 'Tx' | 'Ch' | 'Sig' (inherited from ancestors) */
  type: string
  /** Field value /V as text: string content, checkbox/radio state name, or comma-joined choices */
  value?: string
  /** Decoded bytes when /V is a stream-valued field value. */
  valueStream?: Uint8Array
  /** Lossless field value, including names, arrays, dictionaries, and streams. */
  valueRaw?: PdfRawValueDef
  /** Inheritance-resolved /Ff bit mask. */
  flags: number
  /** Semantic names of every set field flag for this field type. */
  flagNames: ImportedFormFieldFlag[]
  /** Inheritance-resolved default value /DV. */
  defaultValueRaw?: PdfRawValueDef
  /** Inheritance-resolved default appearance /DA. */
  defaultAppearance?: string
  /** Default rich-text style /DS. */
  defaultStyle?: string
  /** Inheritance-resolved quadding /Q. */
  quadding?: 0 | 1 | 2
  /** Rich-text value /RV, retained as a string or stream object. */
  richValue?: PdfRawValueDef
  /** Field-level additional actions /AA, retained but never executed. */
  additionalActions?: Record<string, PdfRawValueDef>
  /** Field trigger actions as typed, non-executable action trees. */
  additionalActionModels?: Record<string, PdfActionDef>
  /** Parsed signature-field /Lock policy. */
  signatureLock?: PdfSignatureFieldLock
  /** Parsed signature-field /SV constraints, including certificate constraints. */
  signatureSeedValue?: PdfSignatureSeedValue
  /** All non-relational entries from the field dictionary for type-specific round-trip. */
  entries: Record<string, PdfRawValueDef>
  /** Zero-based position in AcroForm /CO, when this field participates in calculation order. */
  calculationOrderIndex?: number
  /** 0-based page of the field's widget (when the widget carries /P) */
  pageIndex?: number
  /** Terminal widget dictionaries, including radio/checkbox appearance states. */
  widgets: ImportedFormWidget[]
  children: ImportedFormField[]
}

export type ImportedFormFieldFlag =
  | 'ReadOnly' | 'Required' | 'NoExport'
  | 'NoToggleToOff' | 'Radio' | 'Pushbutton' | 'RadiosInUnison'
  | 'Multiline' | 'Password' | 'FileSelect' | 'DoNotSpellCheck' | 'DoNotScroll' | 'Comb' | 'RichText'
  | 'Combo' | 'Edit' | 'Sort' | 'MultiSelect' | 'CommitOnSelChange'

export interface ImportedFormWidget {
  pageIndex?: number
  appearanceState?: string
  appearance?: Record<string, PdfRawValueDef>
}

interface InheritedFormFieldAttributes {
  type?: PdfValue
  value?: PdfValue
  flags?: PdfValue
  defaultValue?: PdfValue
  defaultAppearance?: PdfValue
  quadding?: PdfValue
}

/** Marked-content or annotation reference inside a structure element. */
export type ImportedStructureContent =
  | { kind: 'mcid', pageIndex: number, mcid: number, streamObject?: { objectNumber: number, generation: number, structParents: number } }
  | { kind: 'annotation', pageIndex: number, annotationIndex: number, objectNumber: number, generation: number }
  | { kind: 'object', pageIndex?: number, objectNumber: number, generation: number }

/** One imported logical structure (Tagged PDF) element. */
export interface ImportedStructureNode {
  /** Structure type /S as written */
  role: string
  /** Standard role after /RoleMap resolution (only when a mapping applies) */
  mappedRole?: string
  /** Index into ImportedStructureModel.namespaces for the element's explicit /NS. */
  namespaceIndex?: number
  /** Namespace index after RoleMapNS resolution, omitted for the default namespace. */
  mappedNamespaceIndex?: number
  alt?: string
  actualText?: string
  /** Expanded form of an abbreviation (/E). */
  expandedText?: string
  phoneme?: string
  phoneticAlphabet?: 'ipa' | 'x-sampa' | 'zh-Latn-pinyin' | 'zh-Latn-wadegile'
  lang?: string
  /** Human-readable title (/T). */
  title?: string
  /** Table summary (/Summary), only on Table elements. */
  summary?: string
  /** Element identifier (/ID). */
  id?: string
  /** Exact /ID byte string used by Annex O structelem resolution. */
  idBytes?: Uint8Array
  /** Deprecated StructElem /R revision, retained for interchange. */
  revision?: number
  /** Expanded /A and /C attribute objects in effective array order. */
  attributes?: ImportedStructureAttribute[]
  /** Parsed /UserProperties entries. */
  userProperties?: ImportedStructureUserProperty[]
  ruby?: ImportedRubyStructure
  warichu?: ImportedWarichuStructure
  mathml?: ImportedMathMlStructureNode
  list?: ImportedListStructure
  table?: ImportedTableStructure
  artifact?: ImportedArtifactStructure
  /** Structure-element /AF files, decoded from their shared file specifications. */
  associatedFiles?: ImportedEmbeddedFile[]
  /** Indices into importEmbeddedFiles(), ready for Render StructureTag. */
  associatedFileIndexes?: number[]
  content: ImportedStructureContent[]
  children: ImportedStructureNode[]
}

export interface ImportedRubyStructure {
  bases: ImportedStructureNode[]
  rubyTexts: ImportedStructureNode[]
  punctuations: ImportedStructureNode[]
}

export interface ImportedWarichuStructure {
  texts: ImportedStructureNode[]
  punctuations: ImportedStructureNode[]
}

export interface ImportedMathMlStructureNode {
  name: string
  text?: string
  attributes?: Record<string, string>
  children: ImportedMathMlStructureNode[]
}

export interface ImportedListStructure {
  numbering?: string
  continuedList?: boolean
  continuedFrom?: string
}

export interface ImportedTableStructure {
  rowSpan?: number
  colSpan?: number
  scope?: string
  headerIds?: string[]
  headerElementIndexes?: number[]
}

export interface ImportedArtifactStructure {
  type?: string
  subtype?: string
  bbox?: [number, number, number, number]
  attached?: string[]
}

export interface ImportedMarkedContentArtifact extends ImportedArtifactStructure {
  pageIndex: number
  actualText?: string
  lang?: string
  streamObject?: { objectNumber: number, generation: number }
}

export interface ImportedStructureAttribute {
  owner: string
  entries: Record<string, PdfRawValueDef>
  namespaceIndex?: number
  streamData?: Uint8Array
  revision?: number
  className?: string
}

export interface ImportedStructureUserProperty {
  name: string
  value: PdfRawValueDef
  formattedValue?: string
  hidden?: boolean
  revision?: number
}

/** Document-wide Tagged PDF dictionaries and logical roots. */
export interface ImportedStructureModel {
  roots: ImportedStructureNode[]
  roleMap: Record<string, string>
  classMap: Record<string, PdfRawValueDef>
  namespaces: ImportedStructureNamespace[]
  pronunciationLexicons: ImportedPronunciationLexicon[]
  pronunciationLexiconFileIndexes?: number[]
  parentTreeNextKey?: number
}

export interface ImportedPronunciationLexicon {
  file: ImportedEmbeddedFile
  fileIndex?: number
  lexicon: PdfPronunciationLexicon
}

export interface ImportedStructureNamespaceRoleTarget {
  role: string
  namespaceIndex?: number
}

export interface ImportedStructureNamespace {
  uri: string
  entries: Record<string, PdfRawValueDef>
  schemaFileIndex?: number
  schema?: PdfRawValueDef
  roleMap: Record<string, ImportedStructureNamespaceRoleTarget>
}

function firstStructurePage(root: ImportedStructureNode): number | undefined {
  const stack: ImportedStructureNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.content.length > 0) return node.content[0]!.pageIndex
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!)
  }
  return undefined
}

/** One imported outline (bookmark) node. */
export interface ImportedOutlineNode {
  title: string
  /** 0-based destination page (absent when the destination has no page) */
  pageIndex?: number
  /** Destination y from the page top (pt), when the destination carries one */
  y?: number
  /** URI action target (mutually exclusive with pageIndex) */
  uri?: string
  /** Complete outline action dictionary, retained but never executed. */
  actionModel?: PdfActionDef
  /** Complete outline destination with a semantic page reference. */
  destination?: PdfDestinationDef
  children: ImportedOutlineNode[]
}

export interface ImportedEmbeddedFile {
  /** File specification name (/UF preferred, else /F). */
  name: string
  /** Decoded embedded file bytes. */
  data: Uint8Array
  /** File description (/Desc), when present. */
  description?: string
  /** Embedded file stream /Subtype MIME type, when present. */
  mimeType?: string
  /** Embedded file /Params /CreationDate, when present. */
  creationDate?: Date
  /** Embedded file /Params /ModDate, when present. */
  modificationDate?: Date
  /** Embedded file /Params /CheckSum. */
  checksum?: Uint8Array
  /** Embedded file /Params /Mac. */
  mac?: PdfEmbeddedFileMacParameters
  /** Associated-file relationship (/AFRelationship), when present. */
  relationship?: PdfAFRelationship
  /** Portfolio collection values from the file specification /CI dictionary. */
  collectionItem?: Record<string, string | number | Date | { value: string | number | Date, prefix?: string }>
  /** PDF 2.0 collection folder ID encoded in the EmbeddedFiles name-tree key. */
  folderId?: number
}

export interface ImportedCollectionField {
  /** Schema key (name-tree key of the field in /Schema). */
  key: string
  /** /N human-readable field name. */
  name: string
  /** /Subtype field type (S/D/N/F/Desc). */
  subtype: PdfCollectionFieldSubtype
  /** /O display order. */
  order?: number
  /** /V visible flag. */
  visible?: boolean
  /** /E editable flag. */
  editable?: boolean
}

export interface ImportedCollection extends PdfCollection {
  /** Schema fields, in schema iteration order. */
  schema: ImportedCollectionField[]
  /** /D initial document name. */
  initialDocument?: string
  /** /View mode (D/T/H/C). */
  view?: PdfCollection['view']
  /** Collection sort keys and ascending order. */
  sort?: { keys: string[], ascending?: boolean | boolean[] }
  /** Decoded folder thumbnail resources keyed by PdfCollectionFolder.thumbnailImageId. */
  images: Record<string, Uint8Array>
}

export interface ImportedJavaScript {
  /** Name-tree key. */
  name: string
  /** /JS document-level JavaScript source. */
  script: string
}

export interface ImportedPageLabel {
  /** Zero-based page index where this label range starts. */
  pageIndex: number
  /** Label style: 'D' decimal, 'R'/'r' Roman, 'A'/'a' letters. */
  style?: string
  /** Prefix prepended to the generated number. */
  prefix?: string
  /** First number in the range (/St). */
  start?: number
}

export interface ImportedAnnotation {
  /** Index across all page /Annots arrays in document page order. */
  sourceIndex: number
  /** Annotation /Subtype. */
  subtype: string
  /** Annotation rectangle in report top-left coordinates (pt). */
  x: number
  y: number
  width: number
  height: number
  /** /Contents text, when present. */
  contents?: string
  /** /NM annotation name, when present. */
  name?: string
  /** /C color as #RRGGBB (gray/RGB arrays), when present. */
  color?: string
  /** /IC interior color as #RRGGBB, when present. */
  interiorColor?: string
  /** /OverlayText (Redact), when present. */
  overlayText?: string
  /** /DA byte string (Redact), when present. */
  defaultAppearance?: string
  /** /Repeat (Redact), default false. */
  repeatOverlay?: boolean
  /** /Q overlay quadding (Redact), default 0. */
  overlayQuadding?: 0 | 1 | 2
  /** /RO replacement Form XObject stream (Redact), when present. */
  overlayAppearance?: Extract<PdfRawValueDef, { kind: 'stream' }>
  /** Font selected by the Redact annotation /DA string. */
  overlayFont?: ImportedFontInfo
  /**
   * /QuadPoints regions (text markup / Redact) in report top-left coordinates,
   * one 8-number quad (UL UR LL LR point pairs) per marked region.
   */
  quadPoints?: number[][]
  /**
   * /Vertices (Polygon / PolyLine) in report top-left coordinates, as x,y
   * pairs.
   */
  vertices?: number[]
  /**
   * /InkList (Ink) in report top-left coordinates: one x,y-pair array per
   * stroke path.
   */
  inkList?: number[][]
  /** /L (Line) start/end as [x1, y1, x2, y2] in report top-left coordinates. */
  line?: [number, number, number, number]
  /** /LE line-ending styles (Line / PolyLine), e.g. ['OpenArrow', 'None']. */
  lineEndings?: [string, string]
  /** /BS /W border width (pt), when a border style dictionary is present. */
  borderWidth?: number
  /** /BS /D dash array (pt), when the border style is dashed. */
  dashArray?: number[]
  /** /BS /S border style name. */
  borderStyle?: 'solid' | 'dashed' | 'beveled' | 'inset' | 'underline'
  /** /BE cloudy border intensity. */
  borderEffect?: { style: 'cloudy', intensity: number }
  /** /CA constant opacity (0..1), when present. */
  opacity?: number
  /** /M modification date string, when present. */
  modifiedDate?: string
  /** /F annotation flags bitset, when present. */
  flags?: number
  /** Non-navigation Link action preserved for a viewer or editor to execute. */
  action?: ImportedLinkAction
  /** Complete action dictionary, including Next chains. Never executed. */
  actionModel?: PdfActionDef
  /** Link annotation /Dest with a semantic page reference. */
  destination?: PdfDestinationDef
  /** Annotation trigger actions from /AA. Never executed. */
  additionalActionModels?: Record<string, PdfActionDef>
  /** Normal/rollover/down appearance dictionary entries from /AP. */
  appearance?: Record<string, PdfRawValueDef>
  /** Appearance state /AS. */
  appearanceState?: string
  /** Global page-order index referenced by a markup annotation /Popup. */
  popupIndex?: number
  /** Global page-order parent index for a Popup annotation. */
  parentIndex?: number
  /** Global page-order reply target from /IRT. */
  replyToIndex?: number
  /** All unmodelled annotation entries, including subtype-specific dictionaries. */
  entries: Record<string, PdfRawValueDef>
  /** Annotation-level associated files from /AF. */
  associatedFiles?: ImportedEmbeddedFile[]
  /** Decoded 3D artwork carried by a /Subtype /3D annotation. */
  threeDimensional?: Imported3DArtwork
}

export interface Imported3DArtwork {
  format: 'U3D' | 'PRC'
  data: Uint8Array
  /** Decoded ECMA-363 or ISO 14739-1 scene semantics. */
  scene: Pdf3DDecodedScene
  viewName?: string
  activateOnPageOpen: boolean
}

export interface ImportedNamedDestination {
  name: string
  destination: PdfDestinationDef
}

export interface ImportedNameTreeEntry {
  name: string
  value: PdfRawValueDef
}

export interface ImportedNumberTreeEntry {
  key: number
  value: PdfRawValueDef
}

export type ImportedLinkAction =
  | { type: 'launch', file: string, newWindow?: boolean }
  | { type: 'hide', targets: string[], hide: boolean }
  | { type: 'submitForm', url: string, fields?: string[], flags?: number }
  | { type: 'resetForm', fields?: string[], flags?: number }

/** One document part from the catalog /DPartRoot hierarchy (ISO 32000-2 14.12). */
export interface ImportedDocumentPart {
  /** First page index (0-based, inclusive), present on leaf nodes. */
  startPage?: number
  /** Last page index (0-based, inclusive), present on leaf nodes. */
  endPage?: number
  /** /DPM document-part metadata values, when present. */
  metadata?: Record<string, PdfDocumentPartMetadataValue>
  /** Immediate descendants, preserving the /DParts array-of-arrays grouping. */
  children?: ImportedDocumentPart[][]
}

export interface ImportedDocumentPartHierarchy {
  root: ImportedDocumentPart
  nodeNameList?: string[]
  recordLevel?: number
}

/** One article thread from the catalog /Threads array (round-trips PdfBackend articleThreads). */
export interface ImportedArticleThread {
  /** /I thread information entries, when present. */
  info?: PdfArticleInfo
  /** Ordered beads following the /N chain from /F. */
  beads: { pageIndex: number, x: number, y: number, width: number, height: number }[]
  /** PDF 2.0 thread metadata stream. */
  metadata?: Extract<PdfRawValueDef, { kind: 'stream' }>
}

/** Trailer /Info dictionary entries (round-trips PdfBackend metadata). */
export interface ImportedMetadata {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  /** /CreationDate as the raw PDF date string (D:YYYYMMDD...). */
  creationDate?: string
  /** /ModDate as the raw PDF date string. */
  modDate?: string
  /** /Trapped: 'True' | 'False' | 'Unknown'. */
  trapped?: string
  /** Any further Info entries (custom keys) as text/number/boolean values. */
  custom?: Record<string, string | number | boolean>
  /** Parsed and byte-exact document-level XMP packet. */
  xmp?: ParsedPdfXmpMetadata
}

/** Catalog /ViewerPreferences entries (round-trips PdfBackend viewerPreferences). */
export interface ImportedViewerPreferences {
  hideToolbar?: boolean
  hideMenubar?: boolean
  hideWindowUI?: boolean
  fitWindow?: boolean
  centerWindow?: boolean
  displayDocTitle?: boolean
  nonFullScreenPageMode?: string
  direction?: string
  viewArea?: string
  viewClip?: string
  printArea?: string
  printClip?: string
  printScaling?: string
  duplex?: string
  pickTrayByPDFSize?: boolean
  printPageRange?: number[]
  numCopies?: number
}

/** Catalog dictionaries that are independent of page display and name trees. */
export interface ImportedCatalogModel {
  uri?: { base?: Uint8Array, entries: Record<string, PdfRawValueDef> }
  language?: string
  spiderInfo?: ImportedWebCapture
  extensions?: PdfDeveloperExtensions
  markInfo?: Record<string, PdfRawValueDef>
  legal?: Record<string, PdfRawValueDef>
  requirements?: PdfDocumentRequirement[]
  permissions?: Record<string, PdfRawValueDef>
  additionalActions?: Record<string, PdfActionDef>
  outputIntents?: PdfOutputIntent[]
}

/** Typed Web Capture database plus image resources needed to re-emit image sets. */
export interface ImportedWebCapture extends PdfWebCapture {
  images: Record<string, Uint8Array>
}

function readPdfDeveloperExtensions(
  doc: PdfDocument,
  value: PdfValue,
  effectiveVersion: PdfSpecificationVersion,
): PdfDeveloperExtensions {
  if (!(value instanceof Map)) throw new Error('PDF import error: catalog /Extensions must be a dictionary')
  const type = doc.resolve(value.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'Extensions')) {
    throw new Error('PDF import error: Extensions /Type must be /Extensions')
  }
  const result: PdfDeveloperExtensions = {}
  for (const [prefix, unresolved] of value) {
    if (prefix === 'Type') continue
    const resolved = doc.resolve(unresolved)
    if (Array.isArray(resolved)) {
      result[prefix] = resolved.map(function (record, index) {
        return readPdfDeveloperExtension(doc, prefix, record, index)
      })
    } else {
      result[prefix] = readPdfDeveloperExtension(doc, prefix, resolved, 0)
    }
  }
  validatePdfDeveloperExtensions(result)
  const requiredVersion = requiredPdfVersionForExtensions(result)
  if (comparePdfSpecificationVersions(requiredVersion, effectiveVersion) > 0) {
    throw new Error(`PDF import error: developer extension BaseVersion ${requiredVersion} exceeds document version ${effectiveVersion}`)
  }
  return result
}

function readPdfDeveloperExtension(
  doc: PdfDocument,
  prefix: string,
  value: PdfValue,
  index: number,
): PdfDeveloperExtension {
  if (!(value instanceof Map)) throw new Error(`PDF import error: developer extension ${prefix}[${index}] must be a dictionary`)
  const type = doc.resolve(value.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'DeveloperExtensions')) {
    throw new Error(`PDF import error: developer extension ${prefix}[${index}] /Type must be /DeveloperExtensions`)
  }
  const baseVersion = doc.resolve(value.get('BaseVersion') ?? null)
  if (!(baseVersion instanceof PdfName)) {
    throw new Error(`PDF import error: developer extension ${prefix}[${index}] requires name /BaseVersion`)
  }
  comparePdfSpecificationVersions(baseVersion.name, baseVersion.name)
  const extensionLevel = doc.resolve(value.get('ExtensionLevel') ?? null)
  if (typeof extensionLevel !== 'number' || !Number.isSafeInteger(extensionLevel)) {
    throw new Error(`PDF import error: developer extension ${prefix}[${index}] requires integer /ExtensionLevel`)
  }
  const extensionRevision = doc.resolve(value.get('ExtensionRevision') ?? null)
  if (extensionRevision !== null && !(extensionRevision instanceof PdfString)) {
    throw new Error(`PDF import error: developer extension ${prefix}[${index}] /ExtensionRevision must be a text string`)
  }
  const url = doc.resolve(value.get('URL') ?? null)
  if (url !== null && !(url instanceof PdfString)) {
    throw new Error(`PDF import error: developer extension ${prefix}[${index}] /URL must be a text string`)
  }
  const entries = rawPdfDictionary(doc, value, new Set<object>())
  delete entries.Type
  delete entries.BaseVersion
  delete entries.ExtensionLevel
  delete entries.ExtensionRevision
  delete entries.URL
  return {
    baseVersion: baseVersion.name as PdfSpecificationVersion,
    extensionLevel,
    ...(extensionRevision instanceof PdfString ? { extensionRevision: pdfStringToText(extensionRevision) } : {}),
    ...(url instanceof PdfString ? { url: pdfStringToText(url) } : {}),
    ...(Object.keys(entries).length === 0 ? {} : { entries }),
  }
}

function effectivePdfSpecificationVersion(doc: PdfDocument, catalog: PdfDict): PdfSpecificationVersion {
  comparePdfSpecificationVersions(doc.headerVersion, doc.headerVersion)
  const catalogVersion = doc.resolve(catalog.get('Version') ?? null)
  if (catalogVersion !== null && !(catalogVersion instanceof PdfName)) {
    throw new Error('PDF import error: catalog /Version must be a name')
  }
  if (!(catalogVersion instanceof PdfName)) return doc.headerVersion as PdfSpecificationVersion
  return (comparePdfSpecificationVersions(catalogVersion.name, doc.headerVersion) > 0
    ? catalogVersion.name
    : doc.headerVersion) as PdfSpecificationVersion
}

function readPdfOutputIntent(doc: PdfDocument, value: PdfValue, index: number): PdfOutputIntent {
  const dictionary = doc.resolve(value)
  if (!(dictionary instanceof Map)) throw new Error(`PDF import error: OutputIntent ${index + 1} must be a dictionary`)
  const type = doc.resolve(dictionary.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'OutputIntent')) {
    throw new Error(`PDF import error: OutputIntent ${index + 1} /Type must be /OutputIntent`)
  }
  const subtype = doc.resolve(dictionary.get('S') ?? null)
  if (!(subtype instanceof PdfName)) throw new Error(`PDF import error: OutputIntent ${index + 1} requires /S`)
  const result: PdfOutputIntent = { subtype: subtype.name }
  const textEntries: [string, 'outputCondition' | 'outputConditionIdentifier' | 'registryName' | 'info'][] = [
    ['OutputCondition', 'outputCondition'],
    ['OutputConditionIdentifier', 'outputConditionIdentifier'],
    ['RegistryName', 'registryName'],
    ['Info', 'info'],
  ]
  for (let i = 0; i < textEntries.length; i++) {
    const [key, property] = textEntries[i]!
    const text = doc.resolve(dictionary.get(key) ?? null)
    if (text === null) continue
    if (!(text instanceof PdfString)) throw new Error(`PDF import error: OutputIntent ${index + 1} /${key} must be a string`)
    result[property] = pdfStringToText(text)
  }
  const profile = doc.resolve(dictionary.get('DestOutputProfile') ?? null)
  if (profile !== null) {
    if (!(profile instanceof PdfStream)) throw new Error(`PDF import error: OutputIntent ${index + 1} /DestOutputProfile must be a stream`)
    const components = doc.resolve(profile.dict.get('N') ?? null)
    if (components !== 1 && components !== 3 && components !== 4) {
      throw new Error(`PDF import error: OutputIntent ${index + 1} destination profile /N must be 1, 3, or 4`)
    }
    const data = doc.decodeStream(profile)
    const header = inspectIccProfile(data)
    if (header.components !== components) {
      throw new Error(`PDF import error: OutputIntent ${index + 1} destination profile /N does not match the ICC data color space`)
    }
    result.destinationProfile = { components, data }
  }
  const profileReference = doc.resolve(dictionary.get('DestOutputProfileRef') ?? null)
  if (profileReference !== null) {
    const effectiveVersion = effectivePdfSpecificationVersion(doc, doc.getCatalog())
    if (comparePdfSpecificationVersions(effectiveVersion, '2.0') < 0) {
      throw new Error(`PDF import error: OutputIntent ${index + 1} /DestOutputProfileRef requires PDF 2.0`)
    }
    if (!(profileReference instanceof Map)) {
      throw new Error(`PDF import error: OutputIntent ${index + 1} /DestOutputProfileRef must be a dictionary`)
    }
    result.destinationProfileReference = rawPdfDictionary(doc, profileReference, new Set<object>())
    validatePdfDestinationProfileReference(result.destinationProfileReference, index)
  }
  if (result.destinationProfile !== undefined && result.destinationProfileReference !== undefined) {
    throw new Error(`PDF import error: OutputIntent ${index + 1} has both destination profile forms`)
  }
  return result
}

function readPdfSeparationInfo(
  doc: PdfDocument,
  pages: CollectedPage[],
  currentPageIndex: number,
  dictionary: PdfDict,
): PdfSeparationInfo {
  const pageValues = dictionary.get('Pages')
  if (!Array.isArray(pageValues) || pageValues.length === 0) {
    throw new Error('PDF import error: SeparationInfo /Pages must be a non-empty array')
  }
  const pageIndexes: number[] = []
  for (let i = 0; i < pageValues.length; i++) {
    const pageRef = pageValues[i]
    if (!(pageRef instanceof PdfRef)) throw new Error(`PDF import error: SeparationInfo /Pages[${i}] must be a page reference`)
    const pageIndex = pageIndexForRef(pages, pageRef)
    if (pageIndex < 0) throw new Error(`PDF import error: SeparationInfo /Pages[${i}] references an unknown page`)
    if (pageIndexes.includes(pageIndex)) throw new Error(`PDF import error: SeparationInfo /Pages contains duplicate page ${pageIndex + 1}`)
    pageIndexes.push(pageIndex)
  }
  if (!pageIndexes.includes(currentPageIndex)) {
    throw new Error('PDF import error: SeparationInfo /Pages must include the current page')
  }
  const colorant = doc.resolve(dictionary.get('DeviceColorant') ?? null)
  const deviceColorant = colorant instanceof PdfName
    ? { kind: 'name' as const, value: colorant.name }
    : colorant instanceof PdfString
      ? { kind: 'string' as const, value: pdfStringToText(colorant) }
      : null
  if (deviceColorant === null) throw new Error('PDF import error: SeparationInfo /DeviceColorant must be a name or string')
  const colorSpaceValue = dictionary.get('ColorSpace')
  if (colorSpaceValue === undefined) return { pages: pageIndexes, deviceColorant }
  const colorSpace = pdfShadingColorSpaceDef(doc, parsePdfColorSpace(doc, colorSpaceValue))
  if (colorSpace.kind !== 'separation' && colorSpace.kind !== 'deviceN') {
    throw new Error('PDF import error: SeparationInfo /ColorSpace must be Separation or DeviceN')
  }
  return { pages: pageIndexes, deviceColorant, colorSpace }
}

function readPdfPageTransparencyGroup(doc: PdfDocument, dictionary: PdfDict): PdfPageTransparencyGroup {
  const type = doc.resolve(dictionary.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'Group')) throw new Error('PDF import error: page Group /Type must be /Group')
  const subtype = doc.resolve(dictionary.get('S') ?? null)
  if (!(subtype instanceof PdfName) || subtype.name !== 'Transparency') throw new Error('PDF import error: page Group /S must be /Transparency')
  const result: PdfPageTransparencyGroup = {}
  const colorSpaceValue = dictionary.get('CS')
  if (colorSpaceValue !== undefined) {
    const colorSpace = pdfShadingColorSpaceDef(doc, parsePdfColorSpace(doc, colorSpaceValue))
    if (colorSpace.kind === 'separation' || colorSpace.kind === 'deviceN' || colorSpace.kind === 'indexed') {
      throw new Error('PDF import error: page transparency Group /CS must be a process color space')
    }
    result.colorSpace = colorSpace
  }
  const isolated = doc.resolve(dictionary.get('I') ?? null)
  if (isolated !== null) {
    if (typeof isolated !== 'boolean') throw new Error('PDF import error: page transparency Group /I must be boolean')
    result.isolated = isolated
  }
  const knockout = doc.resolve(dictionary.get('K') ?? null)
  if (knockout !== null) {
    if (typeof knockout !== 'boolean') throw new Error('PDF import error: page transparency Group /K must be boolean')
    result.knockout = knockout
  }
  return result
}

/**
 * Page boundary boxes in report top-left coordinates, each as
 * [x1, y1, x2, y2]. mediaBox always equals [0, 0, pageWidth, pageHeight];
 * the others are present only when the page declares them.
 */
export interface ImportedPageBoxes {
  mediaBox: [number, number, number, number]
  cropBox?: [number, number, number, number]
  bleedBox?: [number, number, number, number]
  trimBox?: [number, number, number, number]
  artBox?: [number, number, number, number]
}

export class PdfImporter {
  private readonly doc: PdfDocument
  private readonly pages: CollectedPage[]

  private constructor(doc: PdfDocument, pages: CollectedPage[]) {
    this.doc = doc
    this.pages = pages
  }

  static open(bytes: Uint8Array, options: Pick<PdfImportOptions, 'password' | 'recipient' | 'onProgress'> = {}): PdfImporter {
    reportProgress(options.onProgress, 'open-parse', 0, bytes.length)
    const parseOptions: { password?: string, recipient?: PubSecCredential } = {}
    if (options.password !== undefined) parseOptions.password = options.password
    if (options.recipient !== undefined) parseOptions.recipient = options.recipient
    const doc = parsePdf(bytes, parseOptions)
    reportProgress(options.onProgress, 'open-parse', bytes.length, bytes.length)
    reportProgress(options.onProgress, 'open-pages', 0, 1)
    const pages = collectPdfPages(doc)
    reportProgress(options.onProgress, 'open-pages', 1, 1)
    reportProgress(options.onProgress, 'open-complete', 1, 1)
    return new PdfImporter(doc, pages)
  }

  get pageCount(): number {
    return this.pages.length
  }

  importPage(pageIndex: number, options?: PdfImportOptions): ImportedPage {
    if (pageIndex < 0 || pageIndex >= this.pages.length) {
      throw new Error(`PDF import error: page index ${pageIndex} out of range`)
    }
    const page = this.pages[pageIndex]!
    const box = resolveBox(this.doc, page.mediaBox, 'MediaBox')
    const userUnit = readPageUserUnit(this.doc, page)
    const rotate = readPageRotate(this.doc, page)
    const rawWidth = (box.x2 - box.x1) * userUnit
    const rawHeight = (box.y2 - box.y1) * userUnit
    const width = rotate === 90 || rotate === 270 ? rawHeight : rawWidth
    const height = rotate === 90 || rotate === 270 ? rawWidth : rawHeight
    const initialMatrix = buildPageInitialMatrix(box, userUnit, rotate)
    const resourcesValue = this.doc.resolve(page.resources)
    if (!(resourcesValue instanceof Map)) throw new Error('PDF import error: page Resources must be a dictionary')
    const resources = resourcesValue
    const deviceCmykTransform = this.pdfxDeviceCmykTransform(options?.pdfxOutputProfileResolver)
    reportProgress(options?.onProgress, 'page-contents', 0, 1, pageIndex)
    const contents = this.readPageContents(page)
    reportProgress(options?.onProgress, 'page-contents', 1, 1, pageIndex)
    const interpreter = new PdfContentInterpreter({
      doc: this.doc,
      pageWidth: width,
      pageHeight: height,
      initialMatrix,
      resources,
      includeInvisibleText: options?.includeInvisibleText,
      outlineText: options?.outlineText,
      outlineDpi: options?.outlineDpi,
      fontResolver: options?.fontResolver,
      imageIdPrefix: options?.imageIdPrefix,
      onProgress: options?.onProgress === undefined ? undefined : function (done, total) {
        reportProgress(options.onProgress, 'page-interpret', done, total, pageIndex)
      },
      optionalContentContext: options?.optionalContentContext ?? { event: options?.annotationIntent === 'print' ? 'Print' : 'View' },
      deviceCmykTransform,
    })
    interpreter.interpret(contents)
    const elements = interpreter.finalize()
    reportProgress(options?.onProgress, 'page-annotations', 0, 1, pageIndex)
    if (options?.includeAnnotationAppearances !== false) {
      processAnnotations(this.doc, this.pages, page, initialMatrix, height, elements, interpreter, options?.annotationIntent ?? 'screen')
    }
    reportProgress(options?.onProgress, 'page-annotations', 1, 1, pageIndex)
    reportProgress(options?.onProgress, 'page-complete', 1, 1, pageIndex)
    const optionalContentProperties = interpreter.getOptionalContentProperties()
    return {
      width,
      height,
      elements,
      images: interpreter.getImages(),
      fonts: interpreter.getFontInfos(),
      styles: interpreter.getStyles(),
      pageProperties: this.importPageProperties(pageIndex),
      ...(optionalContentProperties === undefined ? {} : { optionalContentProperties }),
    }
  }

  /**
   * Imports the document outline (bookmarks): /Outlines /First../Next chains
   * with /Dest arrays, named destinations, GoTo and URI actions. Destination
   * pages resolve to 0-based indices and the destination y converts to the
   * top-down page coordinate the rest of the importer uses.
   */
  importOutlines(): ImportedOutlineNode[] {
    const catalog = this.doc.getCatalog()
    const outlines = this.doc.resolve(catalog.get('Outlines') ?? null)
    if (outlines === null) return []
    if (!(outlines instanceof Map)) throw new Error('PDF import error: catalog /Outlines must be a dictionary')
    return this.readOutlineChildren(outlines, new Set())
  }

  /**
   * Embedded files from the catalog /Names /EmbeddedFiles name tree, decoded
   * and paired with their /AFRelationship (round-trips PdfBackend embeddedFiles).
   */
  importEmbeddedFiles(): ImportedEmbeddedFile[] {
    const names = this.doc.resolve(this.doc.getCatalog().get('Names') ?? null)
    if (names === null) return []
    if (!(names instanceof Map)) throw new Error('PDF import error: catalog /Names must be a dictionary')
    const tree = this.doc.resolve(names.get('EmbeddedFiles') ?? null)
    if (tree === null) return []
    if (!(tree instanceof Map)) throw new Error('PDF import error: catalog /Names /EmbeddedFiles must be a name tree dictionary')
    const pairs: [string, PdfValue][] = []
    collectNameTreeEntries(this.doc, tree, pairs, new Set())
    const files: ImportedEmbeddedFile[] = []
    for (let i = 0; i < pairs.length; i++) {
      const spec = this.doc.resolve(pairs[i]![1])
      if (!(spec instanceof Map)) throw new Error('PDF import error: embedded file specification must be a dictionary')
      files.push(this.readEmbeddedFileSpec(spec, pairs[i]![0]))
    }
    let folderIds: Set<number> | undefined
    for (let i = 0; i < files.length; i++) {
      const folderId = files[i]!.folderId
      if (folderId === undefined) continue
      if (folderIds === undefined) {
        const collection = this.importCollection()
        if (collection?.folders === undefined) throw new Error(`PDF import error: embedded file ${files[i]!.name} references a collection folder without /Folders`)
        folderIds = pdfCollectionFolderIds(collection.folders)
      }
      if (!folderIds.has(folderId)) throw new Error(`PDF import error: embedded file ${files[i]!.name} references unknown collection folder ID ${folderId}`)
    }
    return files
  }

  /** Leaf page ranges from the catalog document-part hierarchy in depth-first order. */
  importDocumentParts(): ImportedDocumentPart[] {
    const hierarchy = this.importDocumentPartHierarchy()
    if (hierarchy === undefined) return []
    const result: ImportedDocumentPart[] = []
    collectImportedDocumentPartLeaves(hierarchy.root, result)
    return result
  }

  /** Complete ISO 32000-2 document-part hierarchy, including grouping and root metadata. */
  importDocumentPartHierarchy(): ImportedDocumentPartHierarchy | undefined {
    const rootReference = this.doc.getCatalog().get('DPartRoot')
    if (rootReference === undefined) return undefined
    if (!(rootReference instanceof PdfRef)) throw new Error('PDF import error: catalog /DPartRoot must be an indirect reference')
    const rootDictionary = this.doc.resolve(rootReference)
    if (!(rootDictionary instanceof Map)) throw new Error('PDF import error: catalog /DPartRoot must be a dictionary')
    const rootType = this.doc.resolve(rootDictionary.get('Type') ?? null)
    if (!(rootType instanceof PdfName) || rootType.name !== 'DPartRoot') {
      throw new Error('PDF import error: document-part root /Type must be /DPartRoot')
    }
    const rootNodeReference = rootDictionary.get('DPartRootNode')
    if (!(rootNodeReference instanceof PdfRef)) throw new Error('PDF import error: /DPartRootNode must be an indirect reference')
    const rootNode = this.doc.resolve(rootNodeReference)
    if (!(rootNode instanceof Map)) throw new Error('PDF import error: /DPartRootNode must be a dictionary')
    const root = readImportedDocumentPart(
      this.doc,
      this.pages,
      rootNode,
      rootDictionary,
      new Set<PdfDict>(),
      new Set<PdfDict>(),
    )
    const result: ImportedDocumentPartHierarchy = { root }

    const nodeNameListValue = this.doc.resolve(rootDictionary.get('NodeNameList') ?? null)
    if (nodeNameListValue !== null) {
      if (!Array.isArray(nodeNameListValue)) throw new Error('PDF import error: /NodeNameList must be an array')
      const nodeNameList: string[] = []
      for (let i = 0; i < nodeNameListValue.length; i++) {
        const name = this.doc.resolve(nodeNameListValue[i]!)
        if (!(name instanceof PdfName)) throw new Error(`PDF import error: /NodeNameList entry ${i} must be a name`)
        if (!isXmlNmToken(name.name)) throw new Error(`PDF import error: /NodeNameList entry ${i} is not an XML NMTOKEN`)
        nodeNameList.push(name.name)
      }
      result.nodeNameList = nodeNameList
    }
    const recordLevel = this.doc.resolve(rootDictionary.get('RecordLevel') ?? null)
    if (recordLevel !== null) {
      if (typeof recordLevel !== 'number' || !Number.isInteger(recordLevel) || recordLevel < 0) {
        throw new Error('PDF import error: /RecordLevel must be a non-negative integer')
      }
      result.recordLevel = recordLevel
    }
    const maximumDepth = validateImportedDocumentPartHierarchy(result.root, this.pages.length)
    if (result.nodeNameList !== undefined && result.nodeNameList.length !== maximumDepth + 1) {
      throw new Error(`PDF import error: /NodeNameList must contain ${maximumDepth + 1} names`)
    }
    if (result.recordLevel !== undefined && result.recordLevel > maximumDepth) {
      throw new Error(`PDF import error: /RecordLevel must not exceed hierarchy level ${maximumDepth}`)
    }
    return result
  }

  /**
   * The catalog /Threads article threads (round-trips PdfBackend
   * articleThreads): thread info plus beads in /N-chain order, bead
   * rectangles in report top-left coordinates.
   */
  importArticleThreads(): ImportedArticleThread[] {
    const threads = this.doc.resolve(this.doc.getCatalog().get('Threads') ?? null)
    if (threads === null) return []
    if (!Array.isArray(threads)) throw new Error('PDF import error: catalog /Threads must be an array')
    const result: ImportedArticleThread[] = []
    const ownedBeads = new Set<number>()
    for (let t = 0; t < threads.length; t++) {
      const threadReference = threads[t]!
      if (!(threadReference instanceof PdfRef)) throw new Error(`PDF import error: thread ${t} must be an indirect reference`)
      const thread = this.doc.resolve(threadReference)
      if (!(thread instanceof Map)) throw new Error(`PDF import error: thread ${t} must be a dictionary`)
      const threadType = this.doc.resolve(thread.get('Type') ?? null)
      if (threadType !== null && (!(threadType instanceof PdfName) || threadType.name !== 'Thread')) {
        throw new Error(`PDF import error: thread ${t} /Type must be /Thread`)
      }
      const item: ImportedArticleThread = { beads: [] }
      const info = this.doc.resolve(thread.get('I') ?? null)
      if (info instanceof Map) {
        const entries: NonNullable<ImportedArticleThread['info']> = {}
        const known = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'])
        for (const [key, prop] of [
          ['Title', 'title'], ['Author', 'author'], ['Subject', 'subject'], ['Keywords', 'keywords'],
          ['Creator', 'creator'], ['Producer', 'producer'],
        ] as const) {
          const v = this.doc.resolve(info.get(key) ?? null)
          if (v instanceof PdfString) entries[prop] = pdfStringToText(v)
        }
        const creationDate = this.doc.resolve(info.get('CreationDate') ?? null)
        if (creationDate instanceof PdfString) entries.creationDate = pdfDateString(creationDate, `thread ${t} creation date`)
        else if (creationDate !== null) throw new Error(`PDF import error: thread ${t} /I /CreationDate must be a date`)
        const modificationDate = this.doc.resolve(info.get('ModDate') ?? null)
        if (modificationDate instanceof PdfString) entries.modDate = pdfDateString(modificationDate, `thread ${t} modification date`)
        else if (modificationDate !== null) throw new Error(`PDF import error: thread ${t} /I /ModDate must be a date`)
        const trapped = this.doc.resolve(info.get('Trapped') ?? null)
        if (trapped instanceof PdfName && (trapped.name === 'True' || trapped.name === 'False' || trapped.name === 'Unknown')) {
          entries.trapped = trapped.name === 'Unknown' ? 'unknown' : trapped.name === 'True'
        } else if (trapped !== null) throw new Error(`PDF import error: thread ${t} /I /Trapped is invalid`)
        const custom: NonNullable<PdfArticleInfo['custom']> = {}
        for (const [key, raw] of info) {
          if (known.has(key)) continue
          const value = this.doc.resolve(raw)
          if (value instanceof PdfString) custom[key] = pdfStringToText(value)
          else if (value instanceof PdfName) custom[key] = { type: 'name', value: value.name }
          else if (typeof value === 'number' || typeof value === 'boolean') custom[key] = value
        }
        if (Object.keys(custom).length > 0) entries.custom = custom
        item.info = entries
      } else if (info !== null) throw new Error(`PDF import error: thread ${t} /I must be a dictionary`)
      const metadataReference = thread.get('Metadata')
      if (metadataReference !== undefined && !(metadataReference instanceof PdfRef)) {
        throw new Error(`PDF import error: thread ${t} /Metadata must be an indirect reference`)
      }
      const metadata = this.doc.resolve(metadataReference ?? null)
      if (metadata !== null) {
        if (!(metadata instanceof PdfStream)) throw new Error(`PDF import error: thread ${t} /Metadata must be a stream`)
        validateImportedPdfMetadataStream(this.doc, metadata, `thread ${t}`)
        const raw = rawPdfValue(this.doc, metadata, new Set<object>())
        if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' || raw.kind !== 'stream') {
          throw new Error(`PDF import error: thread ${t} /Metadata must be a stream`)
        }
        item.metadata = raw
      }
      const firstRef = thread.get('F')
      if (!(firstRef instanceof PdfRef)) throw new Error(`PDF import error: thread ${t} /F must be a bead reference`)
      // Follow the /N chain; the bead list is a closed loop ending back at /F.
      let beadRef: PdfRef = firstRef
      const visited = new Set<number>()
      let previousRef: PdfRef | undefined
      let firstPreviousRef: PdfRef | undefined
      while (true) {
        if (visited.has(beadRef.num)) {
          if (beadRef.num !== firstRef.num) throw new Error(`PDF import error: thread ${t} bead chain closes on a non-first bead`)
          break
        }
        visited.add(beadRef.num)
        if (ownedBeads.has(beadRef.num)) throw new Error(`PDF import error: bead ${beadRef.num} belongs to more than one thread`)
        ownedBeads.add(beadRef.num)
        const bead = this.doc.resolve(beadRef)
        if (!(bead instanceof Map)) throw new Error(`PDF import error: thread ${t} bead must be a dictionary`)
        const beadType = this.doc.resolve(bead.get('Type') ?? null)
        if (beadType !== null && (!(beadType instanceof PdfName) || beadType.name !== 'Bead')) {
          throw new Error(`PDF import error: thread ${t} bead /Type must be /Bead`)
        }
        const beadThread = bead.get('T')
        if (!(beadThread instanceof PdfRef) || beadThread.num !== threadReference.num) {
          throw new Error(`PDF import error: thread ${t} bead /T does not reference its thread`)
        }
        const previous = bead.get('V')
        if (!(previous instanceof PdfRef)) throw new Error(`PDF import error: thread ${t} bead /V must be a bead reference`)
        if (previousRef === undefined) firstPreviousRef = previous
        else if (previous.num !== previousRef.num) throw new Error(`PDF import error: thread ${t} bead /V chain is inconsistent`)
        const pageRef = bead.get('P')
        if (!(pageRef instanceof PdfRef)) throw new Error(`PDF import error: thread ${t} bead /P must be a page reference`)
        const pageIndex = pageIndexForRef(this.pages, pageRef)
        const page = this.pages[pageIndex]!
        const pageBeads = this.doc.resolve(page.dict.get('B') ?? null)
        if (!Array.isArray(pageBeads) || !pageBeads.some(function (value) { return value instanceof PdfRef && value.num === beadRef.num })) {
          throw new Error(`PDF import error: thread ${t} bead is missing from page ${pageIndex} /B`)
        }
        const box = resolveBox(this.doc, page.mediaBox, 'MediaBox')
        const userUnit = readPageUserUnit(this.doc, page)
        const rotate = readPageRotate(this.doc, page)
        const rawWidth = (box.x2 - box.x1) * userUnit
        const rawHeight = (box.y2 - box.y1) * userUnit
        const pageHeight = rotate === 90 || rotate === 270 ? rawWidth : rawHeight
        const initialMatrix = buildPageInitialMatrix(box, userUnit, rotate)
        const rectHolder = new Map<string, PdfValue>([['Rect', bead.get('R') ?? null]])
        const rect = readAnnotationRect(this.doc, rectHolder, initialMatrix, pageHeight)
        item.beads.push({ pageIndex, x: rect.x, y: rect.y, width: rect.width, height: rect.height })
        const next = bead.get('N')
        if (!(next instanceof PdfRef)) throw new Error(`PDF import error: thread ${t} bead /N must be a bead reference`)
        previousRef = beadRef
        beadRef = next
      }
      if (previousRef === undefined || firstPreviousRef === undefined || firstPreviousRef.num !== previousRef.num) {
        throw new Error(`PDF import error: thread ${t} bead chain /V does not close on the final bead`)
      }
      result.push(item)
    }
    return result
  }

  /**
   * The trailer /Info document metadata (round-trips PdfBackend metadata).
   * Returns null when the document has no Info dictionary.
   */
  importMetadata(): ImportedMetadata | null {
    const info = this.doc.resolve(this.doc.trailer.get('Info') ?? null)
    if (info !== null && !(info instanceof Map)) throw new Error('PDF import error: trailer /Info must be a dictionary')
    const xmp = this.importXmpMetadata()
    if (info === null && xmp === null) return null
    const result: ImportedMetadata = {}
    const strings: [string, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer' | 'creationDate' | 'modDate'][] = [
      ['Title', 'title'], ['Author', 'author'], ['Subject', 'subject'], ['Keywords', 'keywords'],
      ['Creator', 'creator'], ['Producer', 'producer'], ['CreationDate', 'creationDate'], ['ModDate', 'modDate'],
    ]
    const known = new Set<string>(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'])
    for (const [key, prop] of strings) {
      const v = info instanceof Map ? this.doc.resolve(info.get(key) ?? null) : null
      if (v instanceof PdfString) result[prop] = pdfStringToText(v)
    }
    const trapped = info instanceof Map ? this.doc.resolve(info.get('Trapped') ?? null) : null
    if (trapped instanceof PdfName) result.trapped = trapped.name
    let custom: Record<string, string | number | boolean> | undefined
    for (const [key, rawValue] of info instanceof Map ? info : new Map<string, PdfValue>()) {
      if (known.has(key)) continue
      const v = this.doc.resolve(rawValue)
      let value: string | number | boolean
      if (v instanceof PdfString) value = pdfStringToText(v)
      else if (v instanceof PdfName) value = v.name
      else if (typeof v === 'number' || typeof v === 'boolean') value = v
      else continue
      if (custom === undefined) custom = {}
      custom[key] = value
    }
    if (custom !== undefined) result.custom = custom
    if (xmp !== null) {
      validatePdfXmpSynchronization({
        title: result.title,
        author: result.author,
        subject: result.subject,
        keywords: result.keywords,
        creator: result.creator,
        producer: result.producer,
        creationDate: result.creationDate === undefined ? undefined : parsePdfDateText(result.creationDate, 'Info CreationDate'),
        modDate: result.modDate === undefined ? undefined : parsePdfDateText(result.modDate, 'Info ModDate'),
        trapped: result.trapped === 'True' ? true : result.trapped === 'False' ? false : result.trapped === 'Unknown' ? 'unknown' : undefined,
      }, xmp)
      result.xmp = xmp
      if (result.title === undefined) result.title = xmp.title
      if (result.author === undefined) result.author = xmp.author
      if (result.subject === undefined) result.subject = xmp.subject
      if (result.keywords === undefined) result.keywords = xmp.keywords
      if (result.creator === undefined) result.creator = xmp.creator
      if (result.producer === undefined) result.producer = xmp.producer
    }
    return result
  }

  /** Validates and parses the Catalog document-level /Metadata XMP stream. */
  importXmpMetadata(): ParsedPdfXmpMetadata | null {
    const reference = this.doc.getCatalog().get('Metadata')
    if (reference === undefined) return null
    if (!(reference instanceof PdfRef)) throw new Error('PDF import error: Catalog /Metadata must be an indirect reference')
    const metadata = this.doc.resolve(reference)
    if (!(metadata instanceof PdfStream)) throw new Error('PDF import error: Catalog /Metadata must be a stream')
    const type = this.doc.resolve(metadata.dict.get('Type') ?? null)
    const subtype = this.doc.resolve(metadata.dict.get('Subtype') ?? null)
    if (!(type instanceof PdfName) || type.name !== 'Metadata') throw new Error('PDF import error: Catalog metadata stream /Type must be /Metadata')
    if (!(subtype instanceof PdfName) || subtype.name !== 'XML') throw new Error('PDF import error: Catalog metadata stream /Subtype must be /XML')
    return parsePdfXmpPacket(this.doc.decodeStream(metadata))
  }

  /**
   * The catalog /PageMode and /PageLayout display settings (round-trips
   * PdfBackend pageMode/pageLayout). Absent entries stay undefined.
   */
  importPageDisplay(): { pageMode?: string, pageLayout?: string } {
    const catalog = this.doc.getCatalog()
    const result: { pageMode?: string, pageLayout?: string } = {}
    const mode = this.doc.resolve(catalog.get('PageMode') ?? null)
    if (mode instanceof PdfName) result.pageMode = mode.name
    const layout = this.doc.resolve(catalog.get('PageLayout') ?? null)
    if (layout instanceof PdfName) result.pageLayout = layout.name
    return result
  }

  /** Imports Catalog URI/Lang/SpiderInfo/MarkInfo/Legal/Requirements/Perms/AA. */
  importCatalogModel(): ImportedCatalogModel {
    const catalog = this.doc.getCatalog()
    const result: ImportedCatalogModel = {}
    const uri = this.doc.resolve(catalog.get('URI') ?? null)
    if (uri !== null) {
      if (!(uri instanceof Map)) throw new Error('PDF import error: catalog /URI must be a dictionary')
      const entries = rawPdfDictionary(this.doc, uri, new Set<object>())
      const base = this.doc.resolve(uri.get('Base') ?? null)
      if (base !== null && !(base instanceof PdfString)) throw new Error('PDF import error: catalog /URI /Base must be a string')
      delete entries.Base
      result.uri = { ...(base instanceof PdfString ? { base: base.bytes.slice() } : {}), entries }
    }
    const language = this.doc.resolve(catalog.get('Lang') ?? null)
    if (language !== null) {
      if (!(language instanceof PdfString)) throw new Error('PDF import error: catalog /Lang must be a text string')
      result.language = pdfStringToText(language)
      validateBcp47LanguageTag(result.language, 'PDF catalog /Lang')
    }
    const spiderInfo = this.doc.resolve(catalog.get('SpiderInfo') ?? null)
    if (spiderInfo !== null) {
      if (!(spiderInfo instanceof Map)) throw new Error('PDF import error: catalog /SpiderInfo must be a dictionary')
      result.spiderInfo = readPdfWebCapture(this.doc, this.pages, catalog, spiderInfo)
    }
    const extensions = this.doc.resolve(catalog.get('Extensions') ?? null)
    if (extensions !== null) {
      result.extensions = readPdfDeveloperExtensions(this.doc, extensions, effectivePdfSpecificationVersion(this.doc, catalog))
    }
    const dictionaries: [string, keyof Pick<ImportedCatalogModel, 'markInfo' | 'legal' | 'permissions'>][] = [
      ['MarkInfo', 'markInfo'], ['Legal', 'legal'], ['Perms', 'permissions'],
    ]
    for (let i = 0; i < dictionaries.length; i++) {
      const [key, property] = dictionaries[i]!
      const dictionary = this.doc.resolve(catalog.get(key) ?? null)
      if (dictionary === null) continue
      if (!(dictionary instanceof Map)) throw new Error(`PDF import error: catalog /${key} must be a dictionary`)
      result[property] = rawPdfDictionary(this.doc, dictionary, new Set<object>())
    }
    const requirements = this.doc.resolve(catalog.get('Requirements') ?? null)
    if (requirements !== null) {
      if (!Array.isArray(requirements) || requirements.length === 0) throw new Error('PDF import error: catalog /Requirements must be a non-empty array')
      result.requirements = readPdfDocumentRequirements(this.doc, requirements, this.importJavaScript())
    }
    const additionalActions = this.doc.resolve(catalog.get('AA') ?? null)
    if (additionalActions !== null) {
      if (!(additionalActions instanceof Map)) throw new Error('PDF import error: catalog /AA must be a dictionary')
      result.additionalActions = readAdditionalActionModels(this.doc, this.pages, additionalActions, 'catalog AA')
    }
    const outputIntents = this.doc.resolve(catalog.get('OutputIntents') ?? null)
    if (outputIntents !== null) {
      if (!Array.isArray(outputIntents) || outputIntents.length === 0) {
        throw new Error('PDF import error: catalog /OutputIntents must be a non-empty array')
      }
      result.outputIntents = outputIntents.map((value, index) => readPdfOutputIntent(this.doc, value, index))
    }
    return result
  }

  /**
   * The catalog /ViewerPreferences dictionary (round-trips PdfBackend
   * viewerPreferences). Returns null when the catalog has none.
   */
  importViewerPreferences(): ImportedViewerPreferences | null {
    const prefs = this.doc.resolve(this.doc.getCatalog().get('ViewerPreferences') ?? null)
    if (prefs === null) return null
    if (!(prefs instanceof Map)) throw new Error('PDF import error: catalog /ViewerPreferences must be a dictionary')
    const result: ImportedViewerPreferences = {}
    const bools: [string, keyof ImportedViewerPreferences][] = [
      ['HideToolbar', 'hideToolbar'], ['HideMenubar', 'hideMenubar'], ['HideWindowUI', 'hideWindowUI'],
      ['FitWindow', 'fitWindow'], ['CenterWindow', 'centerWindow'], ['DisplayDocTitle', 'displayDocTitle'],
      ['PickTrayByPDFSize', 'pickTrayByPDFSize'],
    ]
    for (const [key, prop] of bools) {
      const v = this.doc.resolve(prefs.get(key) ?? null)
      if (typeof v === 'boolean') (result[prop] as boolean | undefined) = v
    }
    const names: [string, keyof ImportedViewerPreferences][] = [
      ['NonFullScreenPageMode', 'nonFullScreenPageMode'], ['Direction', 'direction'],
      ['ViewArea', 'viewArea'], ['ViewClip', 'viewClip'], ['PrintArea', 'printArea'],
      ['PrintClip', 'printClip'], ['PrintScaling', 'printScaling'], ['Duplex', 'duplex'],
    ]
    for (const [key, prop] of names) {
      const v = this.doc.resolve(prefs.get(key) ?? null)
      if (v instanceof PdfName) (result[prop] as string | undefined) = v.name
    }
    const range = this.doc.resolve(prefs.get('PrintPageRange') ?? null)
    if (Array.isArray(range)) {
      const out: number[] = []
      for (let i = 0; i < range.length; i++) out.push(numberAt(this.doc, range, i, 'PrintPageRange'))
      result.printPageRange = out
    }
    const copies = this.doc.resolve(prefs.get('NumCopies') ?? null)
    if (typeof copies === 'number') result.numCopies = copies
    return result
  }

  /**
   * Page boundary boxes (CropBox / BleedBox / TrimBox / ArtBox) in report
   * top-left coordinates, round-tripping PdfBackend page boxes. MediaBox and
   * CropBox are inheritance-resolved; the print-production boxes are read
   * from the page dictionary directly (they do not inherit).
   */
  importPageBoxes(pageIndex: number): ImportedPageBoxes {
    if (pageIndex < 0 || pageIndex >= this.pages.length) {
      throw new Error(`PDF import error: page index ${pageIndex} out of range`)
    }
    const page = this.pages[pageIndex]!
    const box = resolveBox(this.doc, page.mediaBox, 'MediaBox')
    const userUnit = readPageUserUnit(this.doc, page)
    const rotate = readPageRotate(this.doc, page)
    const rawWidth = (box.x2 - box.x1) * userUnit
    const rawHeight = (box.y2 - box.y1) * userUnit
    const width = rotate === 90 || rotate === 270 ? rawHeight : rawWidth
    const height = rotate === 90 || rotate === 270 ? rawWidth : rawHeight
    const initialMatrix = buildPageInitialMatrix(box, userUnit, rotate)
    const toPage = (value: PdfValue, label: string): [number, number, number, number] => {
      const b = resolveBox(this.doc, value, label)
      const p0 = transformPdfPointToPage(initialMatrix, height, b.x1, b.y1)
      const p1 = transformPdfPointToPage(initialMatrix, height, b.x2, b.y2)
      return [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])]
    }
    const result: ImportedPageBoxes = { mediaBox: [0, 0, width, height] }
    const crop = this.doc.resolve(page.cropBox)
    if (crop !== null && crop !== undefined) result.cropBox = toPage(crop, 'CropBox')
    for (const [key, prop] of [['BleedBox', 'bleedBox'], ['TrimBox', 'trimBox'], ['ArtBox', 'artBox']] as const) {
      const value = this.doc.resolve(page.dict.get(key) ?? null)
      if (value !== null) result[prop] = toPage(value, key)
    }
    return result
  }

  /**
   * Imports presentation and preservation entries from one page dictionary.
   * Actions are retained as data and are never executed by the importer.
   */
  importPageProperties(pageIndex: number): ImportedPageProperties {
    if (pageIndex < 0 || pageIndex >= this.pages.length) {
      throw new Error(`PDF import error: page index ${pageIndex} out of range`)
    }
    const page = this.pages[pageIndex]!
    const result: ImportedPageProperties = {
      boxes: this.importPageBoxes(pageIndex),
      userUnit: readPageUserUnit(this.doc, page),
      rotate: readPageRotate(this.doc, page),
      contentStreamCount: pageContentStreamCount(this.doc, page),
    }

    const tabs = this.doc.resolve(page.dict.get('Tabs') ?? null)
    if (tabs !== null) {
      if (!(tabs instanceof PdfName) || (tabs.name !== 'R' && tabs.name !== 'C' && tabs.name !== 'S')) {
        throw new Error('PDF import error: page Tabs must be /R, /C, or /S')
      }
      result.tabs = tabs.name
    }

    const duration = this.doc.resolve(page.dict.get('Dur') ?? null)
    if (duration !== null) {
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
        throw new Error('PDF import error: page Dur must be a non-negative finite number')
      }
      result.duration = duration
    }

    const transition = this.doc.resolve(page.dict.get('Trans') ?? null)
    if (transition !== null) {
      if (!(transition instanceof Map)) throw new Error('PDF import error: page Trans must be a dictionary')
      result.transition = readPageTransition(this.doc, transition)
    }

    const viewports = this.doc.resolve(page.dict.get('VP') ?? null)
    if (viewports !== null) {
      if (!Array.isArray(viewports)) throw new Error('PDF import error: page VP must be an array')
      result.viewports = []
      for (let i = 0; i < viewports.length; i++) {
        const viewport = this.doc.resolve(viewports[i]!)
        if (!(viewport instanceof Map)) throw new Error(`PDF import error: page VP[${i}] must be a dictionary`)
        const rawViewport = rawPdfDictionary(this.doc, viewport, new Set<object>())
        result.viewports.push(rawViewport)
        if (rawViewport.Measure !== undefined || rawViewport.PtData !== undefined) {
          if (result.measurementViewports === undefined) result.measurementViewports = []
          result.measurementViewports.push(pdfMeasurementViewportFromRaw(rawViewport))
        }
      }
    }

    const additionalActions = this.doc.resolve(page.dict.get('AA') ?? null)
    if (additionalActions !== null) {
      if (!(additionalActions instanceof Map)) throw new Error('PDF import error: page AA must be a dictionary')
      result.additionalActionModels = readAdditionalActionModels(this.doc, this.pages, additionalActions, 'page /AA')
    }

    const metadata = this.doc.resolve(page.dict.get('Metadata') ?? null)
    if (metadata !== null) {
      if (!(metadata instanceof PdfStream)) throw new Error('PDF import error: page Metadata must be a stream')
      validateImportedPdfMetadataStream(this.doc, metadata, 'page')
      const rawMetadata = rawPdfValue(this.doc, metadata, new Set<object>())
      if (typeof rawMetadata !== 'object' || rawMetadata === null || rawMetadata.kind !== 'stream') {
        throw new Error('PDF import error: page Metadata stream preservation failed')
      }
      result.metadata = rawMetadata
    }

    const pieceInfo = this.doc.resolve(page.dict.get('PieceInfo') ?? null)
    const lastModifiedValue = page.dict.get('LastModified')
    if (pieceInfo !== null) {
      if (!(pieceInfo instanceof Map)) throw new Error('PDF import error: page PieceInfo must be a dictionary')
      if (lastModifiedValue === undefined) throw new Error('PDF import error: page PieceInfo requires LastModified')
      result.pieceInfo = rawPdfDictionary(this.doc, pieceInfo, new Set<object>())
    }
    if (lastModifiedValue !== undefined) {
      result.lastModified = rawPdfValue(this.doc, lastModifiedValue, new Set<object>())
    }
    const separationInfo = this.doc.resolve(page.dict.get('SeparationInfo') ?? null)
    if (separationInfo !== null) {
      if (!(separationInfo instanceof Map)) throw new Error('PDF import error: page SeparationInfo must be a dictionary')
      result.separationInfo = readPdfSeparationInfo(this.doc, this.pages, pageIndex, separationInfo)
    }
    const transparencyGroup = this.doc.resolve(page.dict.get('Group') ?? null)
    if (transparencyGroup !== null) {
      if (!(transparencyGroup instanceof Map)) throw new Error('PDF import error: page Group must be a dictionary')
      result.transparencyGroup = readPdfPageTransparencyGroup(this.doc, transparencyGroup)
    }
    return result
  }

  /**
   * Annotations on a page as typed data (subtype, rectangle in report top-left
   * coordinates, and common entries), round-tripping PdfBackend annotations.
   */
  importAnnotations(pageIndex: number, options: Pick<PdfImportOptions, 'fontResolver'> = {}): ImportedAnnotation[] {
    if (pageIndex < 0 || pageIndex >= this.pages.length) {
      throw new Error(`PDF import error: page index ${pageIndex} out of range`)
    }
    const page = this.pages[pageIndex]!
    const box = resolveBox(this.doc, page.mediaBox, 'MediaBox')
    const userUnit = readPageUserUnit(this.doc, page)
    const rotate = readPageRotate(this.doc, page)
    const rawWidth = (box.x2 - box.x1) * userUnit
    const rawHeight = (box.y2 - box.y1) * userUnit
    const height = rotate === 90 || rotate === 270 ? rawWidth : rawHeight
    const initialMatrix = buildPageInitialMatrix(box, userUnit, rotate)
    const annotsValue = this.doc.resolve(page.dict.get('Annots') ?? null)
    if (annotsValue === null) return []
    if (!Array.isArray(annotsValue)) throw new Error('PDF import error: /Annots must be an array')
    const result: ImportedAnnotation[] = []
    const sourceOffset = annotationOffsetForPage(this.doc, this.pages, pageIndex)
    for (let i = 0; i < annotsValue.length; i++) {
      const annot = this.doc.resolve(annotsValue[i]!)
      if (!(annot instanceof Map)) throw new Error(`PDF import error: annotation ${i} must be a dictionary`)
      const subtype = this.doc.resolve(annot.get('Subtype') ?? null)
      if (!(subtype instanceof PdfName)) throw new Error(`PDF import error: annotation ${i} has no subtype`)
      const rect = readAnnotationRect(this.doc, annot, initialMatrix, height)
      const item: ImportedAnnotation = {
        sourceIndex: sourceOffset + i, subtype: subtype.name,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        entries: {},
      }
      const contents = this.doc.resolve(annot.get('Contents') ?? null)
      if (contents instanceof PdfString) item.contents = pdfStringToText(contents)
      const name = this.doc.resolve(annot.get('NM') ?? null)
      if (name instanceof PdfString) item.name = pdfStringToText(name)
      const color = pdfColorArrayToHex(this.doc, annot.get('C') ?? null)
      if (color !== null) item.color = color
      const ic = pdfColorArrayToHex(this.doc, annot.get('IC') ?? null)
      if (ic !== null) item.interiorColor = ic
      const overlay = this.doc.resolve(annot.get('OverlayText') ?? null)
      if (overlay !== null) {
        if (!(overlay instanceof PdfString)) throw new Error(`PDF import error: annotation ${i} /OverlayText must be a string`)
        item.overlayText = pdfStringToText(overlay)
      }
      const defaultAppearance = this.doc.resolve(annot.get('DA') ?? null)
      if (defaultAppearance !== null) {
        if (!(defaultAppearance instanceof PdfString)) throw new Error(`PDF import error: annotation ${i} /DA must be a byte string`)
        item.defaultAppearance = latin1Bytes(defaultAppearance.bytes)
      }
      if (item.overlayText !== undefined && item.defaultAppearance === undefined) {
        throw new Error(`PDF import error: Redact annotation ${i} /OverlayText requires /DA`)
      }
      if (item.defaultAppearance !== undefined) {
        const fontName = redactionDefaultAppearanceFontName(item.defaultAppearance)
        const resources = this.doc.resolve(page.resources)
        if (!(resources instanceof Map)) throw new Error('PDF import error: page Resources must be a dictionary')
        const fontResources = this.doc.resolve(resources.get('Font') ?? null)
        if (fontResources instanceof Map) {
          const fontValue = fontResources.get(fontName)
          if (fontValue !== undefined) item.overlayFont = createFontDecoder(this.doc, fontValue, options.fontResolver).info
        }
      }
      const repeat = this.doc.resolve(annot.get('Repeat') ?? null)
      if (repeat !== null) {
        if (typeof repeat !== 'boolean') throw new Error(`PDF import error: annotation ${i} /Repeat must be boolean`)
        item.repeatOverlay = repeat
      }
      const quadding = this.doc.resolve(annot.get('Q') ?? null)
      if (quadding !== null) {
        if (quadding !== 0 && quadding !== 1 && quadding !== 2) {
          throw new Error(`PDF import error: annotation ${i} /Q must be 0, 1, or 2`)
        }
        item.overlayQuadding = quadding
      }
      const replacementOverlay = this.doc.resolve(annot.get('RO') ?? null)
      if (replacementOverlay !== null) {
        if (!(replacementOverlay instanceof PdfStream)) throw new Error(`PDF import error: annotation ${i} /RO must be a stream`)
        const replacementType = this.doc.resolve(replacementOverlay.dict.get('Type') ?? null)
        if (replacementType !== null && (!(replacementType instanceof PdfName) || replacementType.name !== 'XObject')) {
          throw new Error(`PDF import error: annotation ${i} /RO Type must be /XObject`)
        }
        const replacementSubtype = this.doc.resolve(replacementOverlay.dict.get('Subtype') ?? null)
        if (!(replacementSubtype instanceof PdfName) || replacementSubtype.name !== 'Form') {
          throw new Error(`PDF import error: annotation ${i} /RO must be a Form XObject stream`)
        }
        resolveBox(this.doc, replacementOverlay.dict.get('BBox') ?? null, 'RO BBox')
        const replacementMatrix = this.doc.resolve(replacementOverlay.dict.get('Matrix') ?? null)
        if (replacementMatrix !== null) {
          if (!Array.isArray(replacementMatrix) || replacementMatrix.length !== 6) throw new Error(`PDF import error: annotation ${i} /RO Matrix must contain six numbers`)
          for (let m = 0; m < 6; m++) numberAt(this.doc, replacementMatrix, m, 'RO Matrix')
        }
        const replacementResources = this.doc.resolve(replacementOverlay.dict.get('Resources') ?? null)
        if (replacementResources !== null && !(replacementResources instanceof Map)) {
          throw new Error(`PDF import error: annotation ${i} /RO Resources must be a dictionary`)
        }
        const rawReplacement = rawPdfValue(this.doc, replacementOverlay, new Set<object>())
        if (typeof rawReplacement !== 'object' || rawReplacement === null || rawReplacement.kind !== 'stream') {
          throw new Error(`PDF import error: annotation ${i} /RO stream preservation failed`)
        }
        item.overlayAppearance = rawReplacement
      }
      const quads = this.doc.resolve(annot.get('QuadPoints') ?? null)
      if (quads !== null) {
        if (!Array.isArray(quads) || quads.length % 8 !== 0) {
          throw new Error(`PDF import error: annotation ${i} /QuadPoints must hold 8 numbers per quad`)
        }
        const out: number[][] = []
        for (let q = 0; q < quads.length; q += 8) {
          out.push(this.pointPairsToPage(quads, q, 8, initialMatrix, height, 'QuadPoints'))
        }
        item.quadPoints = out
      }
      const vertices = this.doc.resolve(annot.get('Vertices') ?? null)
      if (vertices !== null) {
        if (!Array.isArray(vertices) || vertices.length % 2 !== 0) {
          throw new Error(`PDF import error: annotation ${i} /Vertices must hold x,y number pairs`)
        }
        item.vertices = this.pointPairsToPage(vertices, 0, vertices.length, initialMatrix, height, 'Vertices')
      }
      const inkList = this.doc.resolve(annot.get('InkList') ?? null)
      if (inkList !== null) {
        if (!Array.isArray(inkList)) throw new Error(`PDF import error: annotation ${i} /InkList must be an array of paths`)
        const paths: number[][] = []
        for (let p = 0; p < inkList.length; p++) {
          const path = this.doc.resolve(inkList[p]!)
          if (!Array.isArray(path) || path.length % 2 !== 0) {
            throw new Error(`PDF import error: annotation ${i} /InkList path ${p} must hold x,y number pairs`)
          }
          paths.push(this.pointPairsToPage(path, 0, path.length, initialMatrix, height, 'InkList'))
        }
        item.inkList = paths
      }
      const line = this.doc.resolve(annot.get('L') ?? null)
      if (line !== null) {
        if (!Array.isArray(line) || line.length !== 4) {
          throw new Error(`PDF import error: annotation ${i} /L must hold four numbers`)
        }
        const pts = this.pointPairsToPage(line, 0, 4, initialMatrix, height, 'L')
        item.line = [pts[0]!, pts[1]!, pts[2]!, pts[3]!]
      }
      const le = this.doc.resolve(annot.get('LE') ?? null)
      if (Array.isArray(le) && le.length === 2) {
        const le0 = this.doc.resolve(le[0]!)
        const le1 = this.doc.resolve(le[1]!)
        if (le0 instanceof PdfName && le1 instanceof PdfName) item.lineEndings = [le0.name, le1.name]
      }
      const bs = this.doc.resolve(annot.get('BS') ?? null)
      if (bs instanceof Map) {
        const w = this.doc.resolve(bs.get('W') ?? null)
        if (typeof w === 'number') item.borderWidth = w
        const dash = this.doc.resolve(bs.get('D') ?? null)
        if (Array.isArray(dash)) {
          const out: number[] = []
          for (let d = 0; d < dash.length; d++) out.push(numberAt(this.doc, dash, d, 'BS D'))
          item.dashArray = out
        }
        const style = this.doc.resolve(bs.get('S') ?? null)
        if (style instanceof PdfName) item.borderStyle = importedAnnotationBorderStyle(style.name)
      }
      const be = this.doc.resolve(annot.get('BE') ?? null)
      if (be instanceof Map) {
        const style = this.doc.resolve(be.get('S') ?? null)
        const intensity = this.doc.resolve(be.get('I') ?? null)
        if (style instanceof PdfName && style.name === 'C') {
          item.borderEffect = { style: 'cloudy', intensity: typeof intensity === 'number' ? intensity : 0 }
        }
      }
      const ca = this.doc.resolve(annot.get('CA') ?? null)
      if (typeof ca === 'number') item.opacity = ca
      const modified = this.doc.resolve(annot.get('M') ?? null)
      if (modified instanceof PdfString) item.modifiedDate = pdfStringToText(modified)
      const flags = this.doc.resolve(annot.get('F') ?? null)
      if (typeof flags === 'number') item.flags = flags
      if (subtype.name === '3D') item.threeDimensional = readImported3DArtwork(this.doc, annot, i)
      if (subtype.name === 'Link') {
        const action = this.doc.resolve(annot.get('A') ?? null)
        if (action instanceof Map) {
          const importedAction = readImportedLinkAction(this.doc, action)
          if (importedAction !== null) item.action = importedAction
        }
      }
      if (annot.has('A') && this.doc.resolve(annot.get('A')!) instanceof Map) {
        item.actionModel = readPdfAction(this.doc, this.pages, annot.get('A')!, new Set<PdfDict>())
      }
      if (annot.has('Dest')) item.destination = readPdfDestination(this.doc, this.pages, annot.get('Dest')!, 'local')
      const additionalActions = this.doc.resolve(annot.get('AA') ?? null)
      if (additionalActions !== null) {
        if (!(additionalActions instanceof Map)) throw new Error(`PDF import error: annotation ${i} /AA must be a dictionary`)
        item.additionalActionModels = readAdditionalActionModels(this.doc, this.pages, additionalActions, `annotation ${i} AA`)
      }
      const appearance = this.doc.resolve(annot.get('AP') ?? null)
      if (appearance !== null) {
        if (!(appearance instanceof Map)) throw new Error(`PDF import error: annotation ${i} /AP must be a dictionary`)
        item.appearance = rawPdfDictionary(this.doc, appearance, new Set<object>())
      }
      const appearanceState = this.doc.resolve(annot.get('AS') ?? null)
      if (appearanceState !== null) {
        if (!(appearanceState instanceof PdfName)) throw new Error(`PDF import error: annotation ${i} /AS must be a name`)
        item.appearanceState = appearanceState.name
      }
      validateImportedPrepressAnnotation(this.doc, annot, subtype, annotsValue.length, i)
      if (annot.has('Popup')) item.popupIndex = readAnnotationRelationship(this.doc, this.pages, annot.get('Popup')!, '/Popup')
      if (subtype.name === 'Popup') {
        if (!annot.has('Parent')) throw new Error(`PDF import error: Popup annotation ${i} requires /Parent`)
        item.parentIndex = readAnnotationRelationship(this.doc, this.pages, annot.get('Parent')!, '/Parent')
      }
      if (annot.has('IRT')) item.replyToIndex = readAnnotationRelationship(this.doc, this.pages, annot.get('IRT')!, '/IRT')
      const associatedFiles = this.doc.resolve(annot.get('AF') ?? null)
      if (associatedFiles !== null) {
        if (!Array.isArray(associatedFiles) || associatedFiles.length === 0) {
          throw new Error(`PDF import error: annotation ${i} /AF must be a non-empty array`)
        }
        item.associatedFiles = associatedFiles.map((file, fileIndex) => {
          const spec = this.doc.resolve(file)
          if (!(spec instanceof Map)) throw new Error(`PDF import error: annotation ${i} /AF entry ${fileIndex} must be a file specification`)
          const imported = this.readEmbeddedFileSpec(spec, '')
          if (imported.relationship === undefined) throw new Error(`PDF import error: annotation ${i} /AF entry ${fileIndex} requires /AFRelationship`)
          return imported
        })
      }
      for (const [key, value] of annot) {
        if (!IMPORTED_ANNOTATION_MODELED_KEYS.has(key) || (key === 'A' && item.actionModel === undefined)) {
          item.entries[key] = rawPdfValue(this.doc, value, new Set<object>())
        }
      }
      result.push(item)
    }
    return result
  }

  /** Imports the /RO Form XObject used after applying one Redact annotation. */
  importRedactionAppearance(
    pageIndex: number,
    sourceIndex: number,
    options: Pick<PdfImportOptions, 'fontResolver' | 'includeInvisibleText' | 'outlineText' | 'outlineDpi' | 'imageIdPrefix' | 'pdfxOutputProfileResolver'> = {},
  ): ImportedRedactionAppearance | null {
    if (pageIndex < 0 || pageIndex >= this.pages.length) throw new Error(`PDF import error: page index ${pageIndex} out of range`)
    const page = this.pages[pageIndex]!
    const annotsValue = this.doc.resolve(page.dict.get('Annots') ?? null)
    if (!Array.isArray(annotsValue)) throw new Error('PDF import error: /Annots must be an array')
    const localIndex = sourceIndex - annotationOffsetForPage(this.doc, this.pages, pageIndex)
    if (localIndex < 0 || localIndex >= annotsValue.length) {
      throw new Error(`PDF import error: annotation source index ${sourceIndex} is not on page ${pageIndex}`)
    }
    const annotation = this.doc.resolve(annotsValue[localIndex]!)
    if (!(annotation instanceof Map)) throw new Error(`PDF import error: annotation ${localIndex} must be a dictionary`)
    const subtype = this.doc.resolve(annotation.get('Subtype') ?? null)
    if (!(subtype instanceof PdfName) || subtype.name !== 'Redact') {
      throw new Error(`PDF import error: annotation source index ${sourceIndex} is not Redact`)
    }
    const replacement = this.doc.resolve(annotation.get('RO') ?? null)
    if (replacement === null) return null
    if (!(replacement instanceof PdfStream)) throw new Error(`PDF import error: Redact annotation ${localIndex} /RO must be a stream`)

    const box = resolveBox(this.doc, page.mediaBox, 'MediaBox')
    const userUnit = readPageUserUnit(this.doc, page)
    const rotate = readPageRotate(this.doc, page)
    const rawWidth = (box.x2 - box.x1) * userUnit
    const rawHeight = (box.y2 - box.y1) * userUnit
    const width = rotate === 90 || rotate === 270 ? rawHeight : rawWidth
    const height = rotate === 90 || rotate === 270 ? rawWidth : rawHeight
    const initialMatrix = buildPageInitialMatrix(box, userUnit, rotate)
    const pageResources = this.doc.resolve(page.resources)
    if (!(pageResources instanceof Map)) throw new Error('PDF import error: page Resources must be a dictionary')
    const deviceCmykTransform = this.pdfxDeviceCmykTransform(options.pdfxOutputProfileResolver)
    const interpreter = new PdfContentInterpreter({
      doc: this.doc,
      pageWidth: width,
      pageHeight: height,
      initialMatrix,
      resources: pageResources,
      includeInvisibleText: options.includeInvisibleText,
      outlineText: options.outlineText,
      outlineDpi: options.outlineDpi,
      fontResolver: options.fontResolver,
      imageIdPrefix: options.imageIdPrefix ?? `redaction${sourceIndex}_`,
      deviceCmykTransform,
    })

    const bbox = resolveBox(this.doc, replacement.dict.get('BBox') ?? null, 'BBox')
    const formMatrixValue = this.doc.resolve(replacement.dict.get('Matrix') ?? null)
    const formMatrix: Matrix = Array.isArray(formMatrixValue) && formMatrixValue.length >= 6
      ? [
          numberAt(this.doc, formMatrixValue, 0, 'Matrix'), numberAt(this.doc, formMatrixValue, 1, 'Matrix'),
          numberAt(this.doc, formMatrixValue, 2, 'Matrix'), numberAt(this.doc, formMatrixValue, 3, 'Matrix'),
          numberAt(this.doc, formMatrixValue, 4, 'Matrix'), numberAt(this.doc, formMatrixValue, 5, 'Matrix'),
        ]
      : [1, 0, 0, 1, 0, 0]
    const rectValue = this.doc.resolve(annotation.get('Rect') ?? null)
    if (!Array.isArray(rectValue) || rectValue.length !== 4) throw new Error(`PDF import error: Redact annotation ${localIndex} /Rect must contain four numbers`)
    const rectX = Math.min(numberAt(this.doc, rectValue, 0, 'Rect'), numberAt(this.doc, rectValue, 2, 'Rect'))
    const rectY = Math.min(numberAt(this.doc, rectValue, 1, 'Rect'), numberAt(this.doc, rectValue, 3, 'Rect'))
    const matrix = multiplyMatrixValues([1, 0, 0, 1, rectX, rectY], formMatrix)
    const resourcesValue = this.doc.resolve(replacement.dict.get('Resources') ?? null)
    if (resourcesValue !== null && !(resourcesValue instanceof Map)) throw new Error(`PDF import error: Redact annotation ${localIndex} /RO Resources must be a dictionary`)
    const resources: PdfDict | null = resourcesValue instanceof Map ? resourcesValue : null
    interpreter.interpretAppearance(
      this.doc.decodeStream(replacement),
      resources,
      matrix,
      [bbox.x1, bbox.y1, bbox.x2, bbox.y2],
    )
    return {
      elements: interpreter.finalize(),
      images: interpreter.getImages(),
      fonts: interpreter.getFontInfos(),
      styles: interpreter.getStyles(),
    }
  }

  private pdfxDeviceCmykTransform(resolver: PdfXOutputProfileResolver | undefined): IccTransform | undefined {
    const values = this.doc.resolve(this.doc.getCatalog().get('OutputIntents') ?? null)
    if (values === null) return undefined
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('PDF import error: catalog /OutputIntents must be a non-empty array')
    }
    let pdfxIntent: PdfOutputIntent | null = null
    for (let index = 0; index < values.length; index++) {
      const intent = readPdfOutputIntent(this.doc, values[index]!, index)
      if (intent.subtype !== 'GTS_PDFX') continue
      if (pdfxIntent !== null) throw new Error('PDF import error: PDF/X requires exactly one GTS_PDFX OutputIntent')
      pdfxIntent = intent
    }
    if (pdfxIntent === null) return undefined

    let profile: Uint8Array
    if (pdfxIntent.destinationProfile !== undefined) {
      profile = pdfxIntent.destinationProfile.data
    } else {
      if (pdfxIntent.registryName === undefined || pdfxIntent.outputConditionIdentifier === undefined) {
        throw new Error('PDF import error: PDF/X registered OutputIntent requires RegistryName and OutputConditionIdentifier')
      }
      if (resolver === undefined) {
        throw new Error('PDF import error: PDF/X registered OutputIntent requires pdfxOutputProfileResolver')
      }
      profile = resolver({
        registryName: pdfxIntent.registryName,
        outputConditionIdentifier: pdfxIntent.outputConditionIdentifier,
      })
    }
    const header = inspectIccProfile(profile)
    if (header.profileClass !== 'output' || header.dataColorSpace !== 'CMYK' || header.components !== 4) {
      throw new Error('PDF import error: PDF/X OutputIntent profile must be a four-component CMYK output profile')
    }
    const transform = parseIccProfile(profile)
    if (transform === null || transform.components !== 4) {
      throw new Error('PDF import error: PDF/X OutputIntent profile requires a supported CMYK device-to-PCS transform')
    }
    return transform
  }

  /** Maps `count` numbers (x,y pairs) from `values[start..]` into report top-left coordinates. */
  private pointPairsToPage(
    values: PdfValue[],
    start: number,
    count: number,
    initialMatrix: Matrix,
    pageHeight: number,
    label: string,
  ): number[] {
    const out: number[] = []
    for (let p = 0; p < count; p += 2) {
      const px = numberAt(this.doc, values, start + p, label)
      const py = numberAt(this.doc, values, start + p + 1, label)
      const pt = transformPdfPointToPage(initialMatrix, pageHeight, px, py)
      out.push(pt[0], pt[1])
    }
    return out
  }

  /**
   * The catalog /Collection dictionary (round-trips PdfBackend collection):
   * portable-collection schema fields, initial document, and view mode.
   */
  importCollection(): ImportedCollection | null {
    const coll = this.doc.resolve(this.doc.getCatalog().get('Collection') ?? null)
    if (coll === null) return null
    if (!(coll instanceof Map)) throw new Error('PDF import error: catalog /Collection must be a dictionary')
    const collectionType = this.doc.resolve(coll.get('Type') ?? null)
    if (collectionType !== null && (!(collectionType instanceof PdfName) || collectionType.name !== 'Collection')) {
      throw new Error('PDF import error: collection /Type must be /Collection')
    }
    const result: ImportedCollection = { schema: [], images: {} }
    const schema = this.doc.resolve(coll.get('Schema') ?? null)
    if (schema instanceof Map) {
      const schemaType = this.doc.resolve(schema.get('Type') ?? null)
      if (schemaType !== null && (!(schemaType instanceof PdfName) || schemaType.name !== 'CollectionSchema')) {
        throw new Error('PDF import error: collection schema /Type must be /CollectionSchema')
      }
      for (const [key, fieldValue] of schema) {
        if (key === 'Type') continue
        const field = this.doc.resolve(fieldValue)
        if (!(field instanceof Map)) throw new Error(`PDF import error: collection field ${key} must be a dictionary`)
        const subtype = this.doc.resolve(field.get('Subtype') ?? null)
        const name = this.doc.resolve(field.get('N') ?? null)
        if (!(subtype instanceof PdfName) || !PDF_COLLECTION_FIELD_SUBTYPES.has(subtype.name)) {
          throw new Error(`PDF import error: collection field ${key} has an invalid /Subtype`)
        }
        if (!(name instanceof PdfString)) throw new Error(`PDF import error: collection field ${key} requires /N`)
        const entry: ImportedCollectionField = {
          key,
          name: pdfStringToText(name),
          subtype: subtype.name as PdfCollectionFieldSubtype,
        }
        const order = this.doc.resolve(field.get('O') ?? null)
        if (typeof order === 'number') entry.order = order
        const visible = this.doc.resolve(field.get('V') ?? null)
        if (typeof visible === 'boolean') entry.visible = visible
        const editable = this.doc.resolve(field.get('E') ?? null)
        if (typeof editable === 'boolean') entry.editable = editable
        result.schema.push(entry)
      }
    }
    else if (schema !== null) throw new Error('PDF import error: collection /Schema must be a dictionary')
    const initial = this.doc.resolve(coll.get('D') ?? null)
    if (initial instanceof PdfString) result.initialDocument = pdfStringToText(initial)
    else if (initial !== null) throw new Error('PDF import error: collection /D must be a byte string')
    const view = this.doc.resolve(coll.get('View') ?? null)
    if (view instanceof PdfName && (view.name === 'D' || view.name === 'T' || view.name === 'H' || view.name === 'C')) result.view = view.name
    else if (view !== null) throw new Error('PDF import error: collection /View must be /D, /T, /H, or /C')
    const sort = this.doc.resolve(coll.get('Sort') ?? null)
    if (sort !== null) {
      if (!(sort instanceof Map)) throw new Error('PDF import error: collection /Sort must be a dictionary')
      const sortType = this.doc.resolve(sort.get('Type') ?? null)
      if (sortType !== null && (!(sortType instanceof PdfName) || sortType.name !== 'CollectionSort')) {
        throw new Error('PDF import error: collection sort /Type must be /CollectionSort')
      }
      const keyValue = this.doc.resolve(sort.get('S') ?? null)
      const keyValues = keyValue instanceof PdfName ? [keyValue] : Array.isArray(keyValue) ? keyValue : null
      if (keyValues === null || keyValues.length === 0) throw new Error('PDF import error: collection /Sort /S must be a name or non-empty name array')
      const keys: string[] = []
      for (let i = 0; i < keyValues.length; i++) {
        const key = this.doc.resolve(keyValues[i]!)
        if (!(key instanceof PdfName)) throw new Error('PDF import error: collection /Sort /S array entries must be names')
        keys.push(key.name)
      }
      const importedSort: NonNullable<ImportedCollection['sort']> = { keys }
      const ascending = this.doc.resolve(sort.get('A') ?? null)
      if (typeof ascending === 'boolean') importedSort.ascending = ascending
      else if (ascending !== null) {
        if (!Array.isArray(ascending)) throw new Error('PDF import error: collection /Sort /A must be a boolean or boolean array')
        const values: boolean[] = []
        for (let i = 0; i < ascending.length; i++) {
          const value = this.doc.resolve(ascending[i]!)
          if (typeof value !== 'boolean') throw new Error('PDF import error: collection /Sort /A array entries must be booleans')
          values.push(value)
        }
        importedSort.ascending = values
      }
      result.sort = importedSort
    }
    const navigatorValue = coll.get('Navigator')
    if (navigatorValue !== undefined) {
      if (!(navigatorValue instanceof PdfRef)) throw new Error('PDF import error: collection /Navigator must be an indirect reference')
      const navigator = this.doc.resolve(navigatorValue)
      if (!(navigator instanceof Map)) throw new Error('PDF import error: collection /Navigator must be a dictionary')
      const navigatorType = this.doc.resolve(navigator.get('Type') ?? null)
      if (navigatorType !== null && (!(navigatorType instanceof PdfName) || navigatorType.name !== 'Navigator')) {
        throw new Error('PDF import error: collection navigator /Type must be /Navigator')
      }
      const layoutValue = this.doc.resolve(navigator.get('Layout') ?? null)
      const layoutValues = layoutValue instanceof PdfName ? [layoutValue] : Array.isArray(layoutValue) ? layoutValue : null
      if (layoutValues === null || layoutValues.length === 0) throw new Error('PDF import error: collection navigator /Layout must be a name or non-empty array')
      const layouts: string[] = []
      for (let layoutIndex = 0; layoutIndex < layoutValues.length; layoutIndex++) {
        const layout = this.doc.resolve(layoutValues[layoutIndex]!)
        if (!(layout instanceof PdfName)) throw new Error('PDF import error: collection navigator /Layout array must contain names')
        layouts.push(layout.name)
      }
      const finalLayout = layouts[layouts.length - 1]!
      if (finalLayout !== 'D' && finalLayout !== 'T' && finalLayout !== 'H') throw new Error('PDF import error: collection navigator must end with /D, /T, or /H')
      result.navigator = { layouts }
    }
    if (result.view === 'C' && result.navigator === undefined) throw new Error('PDF import error: collection view /C requires /Navigator')
    const colors = this.doc.resolve(coll.get('Colors') ?? null)
    if (colors !== null) {
      if (!(colors instanceof Map)) throw new Error('PDF import error: collection /Colors must be a dictionary')
      const colorsType = this.doc.resolve(colors.get('Type') ?? null)
      if (colorsType !== null && (!(colorsType instanceof PdfName) || colorsType.name !== 'CollectionColors')) {
        throw new Error('PDF import error: collection colors /Type must be /CollectionColors')
      }
      result.colors = {}
      const colorKeys = [
        ['Background', 'background'], ['CardBackground', 'cardBackground'], ['CardBorder', 'cardBorder'],
        ['PrimaryText', 'primaryText'], ['SecondaryText', 'secondaryText'],
      ] as const
      for (let colorIndex = 0; colorIndex < colorKeys.length; colorIndex++) {
        const [key, property] = colorKeys[colorIndex]!
        const color = this.doc.resolve(colors.get(key) ?? null)
        if (color === null) continue
        result.colors[property] = readPdfCollectionColor(this.doc, color, key)
      }
    }
    const split = this.doc.resolve(coll.get('Split') ?? null)
    if (split !== null) {
      if (!(split instanceof Map)) throw new Error('PDF import error: collection /Split must be a dictionary')
      const splitType = this.doc.resolve(split.get('Type') ?? null)
      if (splitType !== null && (!(splitType instanceof PdfName) || splitType.name !== 'CollectionSplit')) {
        throw new Error('PDF import error: collection split /Type must be /CollectionSplit')
      }
      result.split = {}
      const direction = this.doc.resolve(split.get('Direction') ?? null)
      if (direction instanceof PdfName && (direction.name === 'H' || direction.name === 'V' || direction.name === 'N')) result.split.direction = direction.name
      else if (direction !== null) throw new Error('PDF import error: collection split /Direction must be /H, /V, or /N')
      const position = this.doc.resolve(split.get('Position') ?? null)
      if (typeof position === 'number' && Number.isFinite(position) && position >= 0 && position <= 100) result.split.position = position
      else if (position !== null) throw new Error('PDF import error: collection split /Position must be from 0 to 100')
    }
    const foldersValue = coll.get('Folders')
    if (foldersValue !== undefined) {
      if (!(foldersValue instanceof PdfRef)) throw new Error('PDF import error: collection /Folders must be an indirect reference')
      const fieldSubtypes = new Map<string, PdfCollectionFieldSubtype>()
      for (let fieldIndex = 0; fieldIndex < result.schema.length; fieldIndex++) {
        const field = result.schema[fieldIndex]!
        fieldSubtypes.set(field.key, field.subtype)
      }
      result.folders = readPdfCollectionFolderTree(this.doc, foldersValue, fieldSubtypes, result.images)
    }
    return result
  }

  /** All legacy and name-tree destinations with page references normalized to page indices. */
  importNamedDestinations(): ImportedNamedDestination[] {
    const values = new Map<string, PdfValue>()
    const catalog = this.doc.getCatalog()
    const legacy = this.doc.resolve(catalog.get('Dests') ?? null)
    if (legacy !== null) {
      if (!(legacy instanceof Map)) throw new Error('PDF import error: catalog /Dests must be a dictionary')
      for (const [name, value] of legacy) values.set(name, value)
    }
    const names = this.doc.resolve(catalog.get('Names') ?? null)
    if (names !== null) {
      if (!(names instanceof Map)) throw new Error('PDF import error: catalog /Names must be a dictionary')
      const tree = this.doc.resolve(names.get('Dests') ?? null)
      if (tree !== null) {
        if (!(tree instanceof Map)) throw new Error('PDF import error: catalog /Names /Dests must be a name tree dictionary')
        const entries: [string, PdfValue][] = []
        collectNameTreeEntries(this.doc, tree, entries, new Set())
        for (let i = 0; i < entries.length; i++) {
          const [name, value] = entries[i]!
          if (values.has(name)) throw new Error(`PDF import error: duplicate named destination ${name}`)
          values.set(name, value)
        }
      }
    }
    const result: ImportedNamedDestination[] = []
    for (const [name, raw] of values) {
      const resolved = this.doc.resolve(raw)
      const destinationValue = resolved instanceof Map ? resolved.get('D') : raw
      if (destinationValue === undefined) throw new Error(`PDF import error: named destination ${name} dictionary requires /D`)
      const destination = readPdfDestination(this.doc, this.pages, destinationValue, 'local')
      if (destination.kind !== 'explicit') throw new Error(`PDF import error: named destination ${name} must resolve to an explicit destination`)
      result.push({ name, destination })
    }
    result.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 })
    return result
  }

  /** Parse and resolve all ISO 32000-2 Annex O parameters against this PDF. */
  resolveFragmentIdentifier(value: string): PdfResolvedFragmentIdentifier {
    const structureElements: { id: Uint8Array, index: number, pageIndex?: number }[] = []
    const structure = this.importStructureTree()
    let structureIndex = 0
    const stack: ImportedStructureNode[] = []
    for (let i = structure.length - 1; i >= 0; i--) stack.push(structure[i]!)
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.idBytes !== undefined) {
        const pageIndex = firstStructurePage(node)
        structureElements.push(pageIndex === undefined
          ? { id: node.idBytes, index: structureIndex }
          : { id: node.idBytes, index: structureIndex, pageIndex })
      }
      structureIndex++
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!)
    }

    const annotations: { name: string, index: number, pageIndex: number }[] = []
    let annotationIndex = 0
    for (let pageIndex = 0; pageIndex < this.pages.length; pageIndex++) {
      const values = this.doc.resolve(this.pages[pageIndex]!.dict.get('Annots') ?? null)
      if (values === null) continue
      if (!Array.isArray(values)) throw new Error(`PDF import error: page ${pageIndex + 1} /Annots must be an array`)
      for (let i = 0; i < values.length; i++) {
        const annotation = this.doc.resolve(values[i]!)
        if (!(annotation instanceof Map)) throw new Error(`PDF import error: page ${pageIndex + 1} annotation ${i + 1} must be a dictionary`)
        const name = this.doc.resolve(annotation.get('NM') ?? null)
        if (name instanceof PdfString) annotations.push({ name: pdfStringToText(name), index: annotationIndex, pageIndex })
        annotationIndex++
      }
    }

    const embeddedFiles: { name: string, index: number }[] = []
    const names = this.doc.resolve(this.doc.getCatalog().get('Names') ?? null)
    if (names !== null) {
      if (!(names instanceof Map)) throw new Error('PDF import error: catalog /Names must be a dictionary')
      const tree = this.doc.resolve(names.get('EmbeddedFiles') ?? null)
      if (tree !== null) {
        if (!(tree instanceof Map)) throw new Error('PDF import error: catalog /Names /EmbeddedFiles must be a name tree dictionary')
        const entries: [string, PdfValue][] = []
        collectNameTreeEntries(this.doc, tree, entries, new Set())
        for (let i = 0; i < entries.length; i++) embeddedFiles.push({ name: entries[i]![0], index: i })
      }
    }

    return resolvePdfFragmentIdentifier(parsePdfFragmentIdentifier(value), {
      pageCount: this.pages.length,
      namedDestinations: this.importNamedDestinations(),
      structureElements,
      annotations,
      embeddedFiles,
    })
  }

  /** Imports and flattens one Catalog /Names name tree in key order. */
  importNameTree(name: string): ImportedNameTreeEntry[] {
    const names = this.doc.resolve(this.doc.getCatalog().get('Names') ?? null)
    if (names === null) return []
    if (!(names instanceof Map)) throw new Error('PDF import error: catalog /Names must be a dictionary')
    const tree = this.doc.resolve(names.get(name) ?? null)
    if (tree === null) return []
    if (!(tree instanceof Map)) throw new Error(`PDF import error: catalog /Names /${name} must be a name tree dictionary`)
    const pairs: [string, PdfValue][] = []
    collectNameTreeEntries(this.doc, tree, pairs, new Set())
    pairs.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0 })
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i - 1]![0] === pairs[i]![0]) throw new Error(`PDF import error: duplicate name tree key ${pairs[i]![0]}`)
    }
    return pairs.map((pair) => ({ name: pair[0], value: rawPdfValue(this.doc, pair[1], new Set<object>()) }))
  }

  /** Imports and flattens a catalog number tree in numeric key order. */
  importNumberTree(name: string): ImportedNumberTreeEntry[] {
    const tree = this.doc.resolve(this.doc.getCatalog().get(name) ?? null)
    if (tree === null) return []
    if (!(tree instanceof Map)) throw new Error(`PDF import error: catalog /${name} must be a number tree dictionary`)
    const pairs: [number, PdfValue][] = []
    collectNumberTreeEntries(this.doc, tree, pairs, new Set())
    pairs.sort(function (a, b) { return a[0] - b[0] })
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i - 1]![0] === pairs[i]![0]) throw new Error(`PDF import error: duplicate number tree key ${pairs[i]![0]}`)
    }
    return pairs.map((pair) => ({ key: pair[0], value: rawPdfValue(this.doc, pair[1], new Set<object>()) }))
  }

  /**
   * The catalog /OpenAction destination (round-trips PdfBackend openAction):
   * the 0-based page and, when present, the destination y in report top-left
   * coordinates. Returns null when absent or a non-GoTo action.
   */
  importOpenAction(): { pageIndex: number, y?: number } | null {
    const value = this.doc.resolve(this.doc.getCatalog().get('OpenAction') ?? null)
    if (value === null) return null
    let dest: PdfValue | null
    if (value instanceof Map) {
      const s = this.doc.resolve(value.get('S') ?? null)
      if (!(s instanceof PdfName) || s.name !== 'GoTo') return null
      dest = value.get('D') ?? null
    } else {
      dest = value
    }
    if (dest === null) return null
    return this.resolveOutlineDestination(dest)
  }

  /** Catalog /OpenAction as a complete action tree; destination arrays return null. */
  importOpenActionModel(): PdfActionDef | null {
    const value = this.doc.getCatalog().get('OpenAction')
    if (value === undefined) return null
    const resolved = this.doc.resolve(value)
    return resolved instanceof Map ? readPdfAction(this.doc, this.pages, value, new Set<PdfDict>()) : null
  }

  /**
   * Document-level JavaScript from the catalog /Names /JavaScript name tree
   * (round-trips PdfBackend javaScript), sorted by name.
   */
  importJavaScript(): ImportedJavaScript[] {
    const names = this.doc.resolve(this.doc.getCatalog().get('Names') ?? null)
    if (names === null) return []
    if (!(names instanceof Map)) throw new Error('PDF import error: catalog /Names must be a dictionary')
    const tree = this.doc.resolve(names.get('JavaScript') ?? null)
    if (tree === null) return []
    if (!(tree instanceof Map)) throw new Error('PDF import error: catalog /Names /JavaScript must be a name tree dictionary')
    const pairs: [string, PdfValue][] = []
    collectNameTreeEntries(this.doc, tree, pairs, new Set())
    const result: ImportedJavaScript[] = []
    for (let i = 0; i < pairs.length; i++) {
      const action = this.doc.resolve(pairs[i]![1])
      if (!(action instanceof Map)) throw new Error('PDF import error: JavaScript action must be a dictionary')
      const js = this.doc.resolve(action.get('JS') ?? null)
      const script = js instanceof PdfString ? pdfStringToText(js) : js instanceof PdfStream ? latin1Bytes(this.doc.decodeStream(js)) : ''
      result.push({ name: pairs[i]![0], script })
    }
    return result
  }

  /**
   * Page labels from the catalog /PageLabels number tree (round-trips
   * PdfBackend pageLabels), sorted by starting page index.
   */
  importPageLabels(): ImportedPageLabel[] {
    const tree = this.doc.resolve(this.doc.getCatalog().get('PageLabels') ?? null)
    if (tree === null) return []
    if (!(tree instanceof Map)) throw new Error('PDF import error: catalog /PageLabels must be a number tree dictionary')
    const pairs: [number, PdfValue][] = []
    collectNumberTreeEntries(this.doc, tree, pairs, new Set())
    pairs.sort((a, b) => a[0] - b[0])
    const labels: ImportedPageLabel[] = []
    for (let i = 0; i < pairs.length; i++) {
      const dict = this.doc.resolve(pairs[i]![1])
      if (!(dict instanceof Map)) throw new Error('PDF import error: page label value must be a dictionary')
      const label: ImportedPageLabel = { pageIndex: pairs[i]![0] }
      const style = this.doc.resolve(dict.get('S') ?? null)
      if (style instanceof PdfName) label.style = style.name
      const prefix = this.doc.resolve(dict.get('P') ?? null)
      if (prefix instanceof PdfString) label.prefix = pdfStringToText(prefix)
      const start = this.doc.resolve(dict.get('St') ?? null)
      if (typeof start === 'number') label.start = start
      labels.push(label)
    }
    return labels
  }

  /**
   * Document-level associated files from the catalog /AF array (PDF 2.0
   * §7.11.4). Each entry is a file specification with an /AFRelationship;
   * round-trips PdfBackend embedded files that carry a relationship.
   */
  importAssociatedFiles(): ImportedEmbeddedFile[] {
    const af = this.doc.resolve(this.doc.getCatalog().get('AF') ?? null)
    if (af === null) return []
    if (!Array.isArray(af)) throw new Error('PDF import error: catalog /AF must be an array')
    const result: ImportedEmbeddedFile[] = []
    for (let i = 0; i < af.length; i++) {
      const spec = this.doc.resolve(af[i]!)
      if (!(spec instanceof Map)) throw new Error(`PDF import error: /AF entry ${i} must be a file specification`)
      const file = this.readEmbeddedFileSpec(spec, '')
      if (file.relationship === undefined) throw new Error(`PDF import error: /AF entry ${i} requires /AFRelationship`)
      result.push(file)
    }
    return result
  }

  private readEmbeddedFileSpec(spec: PdfDict, treeName: string): ImportedEmbeddedFile {
    const type = this.doc.resolve(spec.get('Type') ?? null)
    if (!(type instanceof PdfName) || type.name !== 'Filespec') {
      throw new Error('PDF import error: an embedded file specification must have /Type /Filespec')
    }
    const uf = this.doc.resolve(spec.get('UF') ?? null)
    const f = this.doc.resolve(spec.get('F') ?? null)
    if (spec.has('UF') && !(uf instanceof PdfString)) throw new Error('PDF import error: embedded file /UF must be a text string')
    if (spec.has('F') && !(f instanceof PdfString)) throw new Error('PDF import error: embedded file /F must be a byte string')
    const name = uf instanceof PdfString ? pdfStringToText(uf) : f instanceof PdfString ? pdfStringToText(f) : treeName
    const ef = this.doc.resolve(spec.get('EF') ?? null)
    if (!(ef instanceof Map)) throw new Error('PDF import error: embedded file /EF must be a dictionary')
    const streamValue = this.doc.resolve(ef.get('F') ?? ef.get('UF') ?? null)
    if (!(streamValue instanceof PdfStream)) throw new Error('PDF import error: embedded file /EF /F must be a stream')
    const file: ImportedEmbeddedFile = { name, data: this.doc.decodeStream(streamValue) }
    const folderMatch = /^<(\d+)>(.*)$/.exec(treeName)
    if (folderMatch !== null) file.folderId = Number(folderMatch[1])
    const desc = this.doc.resolve(spec.get('Desc') ?? null)
    if (desc instanceof PdfString) file.description = pdfStringToText(desc)
    const subtype = streamValue.dict.get('Subtype')
    if (subtype instanceof PdfName) file.mimeType = subtype.name
    const params = this.doc.resolve(streamValue.dict.get('Params') ?? null)
    if (params !== null) {
      if (!(params instanceof Map)) throw new Error('PDF import error: embedded file /Params must be a dictionary')
      const size = this.doc.resolve(params.get('Size') ?? null)
      if (size !== null && (!Number.isInteger(size) || size !== file.data.length)) {
        throw new Error('PDF import error: embedded file /Params /Size must equal the decoded file length')
      }
      const creationDate = this.doc.resolve(params.get('CreationDate') ?? null)
      if (creationDate instanceof PdfString) file.creationDate = pdfDateString(creationDate, 'embedded file creation date')
      else if (creationDate !== null) throw new Error('PDF import error: embedded file /Params /CreationDate must be a date string')
      const modificationDate = this.doc.resolve(params.get('ModDate') ?? null)
      if (modificationDate instanceof PdfString) file.modificationDate = pdfDateString(modificationDate, 'embedded file modification date')
      else if (modificationDate !== null) throw new Error('PDF import error: embedded file /Params /ModDate must be a date string')
      const checksum = this.doc.resolve(params.get('CheckSum') ?? null)
      if (checksum instanceof PdfString) {
        if (checksum.bytes.length !== 16) throw new Error('PDF import error: embedded file /Params /CheckSum must contain 16 bytes')
        if (!equalBytes(checksum.bytes, md5(file.data))) {
          throw new Error('PDF import error: embedded file /Params /CheckSum does not match its data')
        }
        file.checksum = checksum.bytes.slice()
      } else if (checksum !== null) throw new Error('PDF import error: embedded file /Params /CheckSum must be a byte string')
      const macValue = this.doc.resolve(params.get('Mac') ?? null)
      if (macValue !== null) {
        if (!(macValue instanceof Map)) throw new Error('PDF import error: embedded file /Params /Mac must be a dictionary')
        const mac: PdfEmbeddedFileMacParameters = {}
        const subtype = this.doc.resolve(macValue.get('Subtype') ?? null)
        if (subtype instanceof PdfString) mac.subtype = latin1Bytes(subtype.bytes)
        else if (subtype !== null) throw new Error('PDF import error: embedded file /Params /Mac /Subtype must be a byte string')
        const creator = this.doc.resolve(macValue.get('Creator') ?? null)
        if (creator instanceof PdfString) mac.creator = latin1Bytes(creator.bytes)
        else if (creator !== null) throw new Error('PDF import error: embedded file /Params /Mac /Creator must be a byte string')
        const resourceFork = this.doc.resolve(macValue.get('ResFork') ?? null)
        if (resourceFork instanceof PdfStream) mac.resourceFork = this.doc.decodeStream(resourceFork)
        else if (resourceFork !== null) throw new Error('PDF import error: embedded file /Params /Mac /ResFork must be a stream')
        file.mac = mac
      }
    }
    const rel = this.doc.resolve(spec.get('AFRelationship') ?? null)
    if (rel instanceof PdfName) {
      if (!PDF_AF_RELATIONSHIP_NAMES.has(rel.name)) throw new Error(`PDF import error: unsupported /AFRelationship /${rel.name}`)
      file.relationship = rel.name as PdfAFRelationship
    } else if (rel !== null) throw new Error('PDF import error: /AFRelationship must be a name')
    const collectionItem = this.doc.resolve(spec.get('CI') ?? null)
    if (collectionItem !== null) {
      if (!(collectionItem instanceof Map)) throw new Error('PDF import error: embedded file /CI must be a dictionary')
      const item: NonNullable<ImportedEmbeddedFile['collectionItem']> = {}
      const fieldSubtypes = this.collectionFieldSubtypes()
      for (const [key, raw] of collectionItem) {
        if (key === 'Type') continue
        const subtype = fieldSubtypes.get(key)
        if (subtype === undefined) throw new Error(`PDF import error: collection item key is not in the collection schema: ${key}`)
        const value = this.doc.resolve(raw)
        if (value instanceof PdfString) item[key] = importedCollectionScalar(value, subtype, key)
        else if (typeof value === 'number') item[key] = importedCollectionScalar(value, subtype, key)
        else if (value instanceof Map) {
          const data = this.doc.resolve(value.get('D') ?? null)
          const prefix = this.doc.resolve(value.get('P') ?? null)
          if (!(data instanceof PdfString) && typeof data !== 'number') {
            throw new Error(`PDF import error: collection subitem ${key} /D must be a string or number`)
          }
          if (prefix !== null && !(prefix instanceof PdfString)) throw new Error(`PDF import error: collection subitem ${key} /P must be a string`)
          item[key] = {
            value: importedCollectionScalar(data, subtype, key),
            ...(prefix instanceof PdfString ? { prefix: pdfStringToText(prefix) } : {}),
          }
        } else throw new Error(`PDF import error: collection item ${key} must be a string, number, or subitem dictionary`)
      }
      file.collectionItem = item
    }
    return file
  }

  private collectionFieldSubtypes(): Map<string, string> {
    const result = new Map<string, string>()
    const collection = this.doc.resolve(this.doc.getCatalog().get('Collection') ?? null)
    if (!(collection instanceof Map)) return result
    const schema = this.doc.resolve(collection.get('Schema') ?? null)
    if (!(schema instanceof Map)) return result
    for (const [key, rawField] of schema) {
      if (key === 'Type') continue
      const field = this.doc.resolve(rawField)
      if (!(field instanceof Map)) throw new Error(`PDF import error: collection field ${key} must be a dictionary`)
      const subtype = this.doc.resolve(field.get('Subtype') ?? null)
      if (!(subtype instanceof PdfName)) throw new Error(`PDF import error: collection field ${key} requires a name /Subtype`)
      result.set(key, subtype.name)
    }
    return result
  }

  private readOutlineChildren(parent: PdfDict, visited: Set<PdfDict>): ImportedOutlineNode[] {
    const nodes: ImportedOutlineNode[] = []
    let current = this.doc.resolve(parent.get('First') ?? null)
    while (current !== null) {
      if (!(current instanceof Map)) throw new Error('PDF import error: outline item must be a dictionary')
      if (visited.has(current)) throw new Error('PDF import error: circular outline chain')
      visited.add(current)
      nodes.push(this.readOutlineItem(current, visited))
      current = this.doc.resolve(current.get('Next') ?? null)
    }
    return nodes
  }

  private readOutlineItem(item: PdfDict, visited: Set<PdfDict>): ImportedOutlineNode {
    const titleValue = this.doc.resolve(item.get('Title') ?? null)
    if (!(titleValue instanceof PdfString)) throw new Error('PDF import error: outline item /Title must be a string')
    const node: ImportedOutlineNode = {
      title: pdfStringToText(titleValue),
      children: this.readOutlineChildren(item, visited),
    }
    let dest = item.get('Dest') ?? null
    const action = this.doc.resolve(item.get('A') ?? null)
    if (dest === null && action !== null) {
      if (!(action instanceof Map)) throw new Error('PDF import error: outline item /A must be a dictionary')
      const subtype = this.doc.resolve(action.get('S') ?? null)
      if (!(subtype instanceof PdfName)) throw new Error('PDF import error: outline action /S must be a name')
      if (subtype.name === 'GoTo') {
        node.actionModel = readPdfAction(this.doc, this.pages, item.get('A')!, new Set<PdfDict>())
        dest = action.get('D') ?? null
        if (dest === null) throw new Error('PDF import error: outline GoTo action requires /D')
      } else if (subtype.name === 'URI') {
        node.actionModel = readPdfAction(this.doc, this.pages, item.get('A')!, new Set<PdfDict>())
        const uri = this.doc.resolve(action.get('URI') ?? null)
        if (!(uri instanceof PdfString)) throw new Error('PDF import error: outline URI action requires /URI')
        node.uri = pdfStringToText(uri)
        return node
      } else {
        node.actionModel = readPdfAction(this.doc, this.pages, item.get('A')!, new Set<PdfDict>())
        return node
      }
    }
    if (dest !== null) {
      if (node.actionModel === undefined) node.destination = readPdfDestination(this.doc, this.pages, dest, 'local')
      const resolved = this.resolveOutlineDestination(dest)
      if (resolved !== null) {
        node.pageIndex = resolved.pageIndex
        if (resolved.y !== undefined) node.y = resolved.y
      }
    }
    return node
  }

  private resolveOutlineDestination(dest: PdfValue): { pageIndex: number, y?: number } | null {
    let value = this.doc.resolve(dest)
    if (value instanceof PdfString || value instanceof PdfName) {
      const name = value instanceof PdfString ? pdfStringToText(value) : value.name
      const named = lookupNamedDestination(this.doc, name)
      if (named === null) return null
      value = this.doc.resolve(named)
      if (value instanceof Map) value = this.doc.resolve(value.get('D') ?? null)
    }
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error('PDF import error: outline destination must be an array')
    }
    const pageValue = this.doc.resolve(value[0]!)
    let pageIndex = -1
    for (let i = 0; i < this.pages.length; i++) {
      if (this.pages[i]!.dict === pageValue) {
        pageIndex = i
        break
      }
    }
    if (pageIndex < 0) {
      if (typeof pageValue === 'number') pageIndex = pageValue
      else return null
    }
    const fit = this.doc.resolve(value[1] ?? null)
    let y: number | undefined
    if (fit instanceof PdfName) {
      // /XYZ left top zoom → top; /FitH top → top (both PDF y-up)
      const topValue = fit.name === 'XYZ' ? this.doc.resolve(value[3] ?? null)
        : fit.name === 'FitH' || fit.name === 'FitBH' ? this.doc.resolve(value[2] ?? null)
        : null
      if (typeof topValue === 'number' && pageIndex >= 0 && pageIndex < this.pages.length) {
        const box = resolveBox(this.doc, this.pages[pageIndex]!.mediaBox, 'MediaBox')
        y = (box.y2 - box.y1) - (topValue - box.y1)
      }
    }
    return { pageIndex, y }
  }

  /**
   * Imports the Tagged PDF logical structure tree: /StructTreeRoot with
   * nested structure elements, marked-content references resolved to
   * 0-based page indices and /RoleMap-mapped standard roles.
   */
  importStructureTree(): ImportedStructureNode[] {
    return this.importStructureModel()?.roots ?? []
  }

  /** Extracts marked-content Artifact property lists from page and Form streams. */
  importMarkedContentArtifacts(pageIndex?: number): ImportedMarkedContentArtifact[] {
    if (pageIndex !== undefined && (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pages.length)) {
      throw new Error(`PDF import error: artifact page index out of range: ${pageIndex}`)
    }
    const result: ImportedMarkedContentArtifact[] = []
    const first = pageIndex ?? 0
    const end = pageIndex === undefined ? this.pages.length : pageIndex + 1
    for (let i = first; i < end; i++) {
      const page = this.pages[i]!.dict
      const resources = this.doc.resolve(page.get('Resources') ?? null)
      if (!(resources instanceof Map)) throw new Error(`PDF import error: page ${i} requires Resources for artifact extraction`)
      const contents = this.doc.resolve(page.get('Contents') ?? null)
      if (contents === null) continue
      const streams = Array.isArray(contents) ? contents : [contents]
      for (let c = 0; c < streams.length; c++) {
        const stream = this.doc.resolve(streams[c]!)
        if (!(stream instanceof PdfStream)) throw new Error(`PDF import error: page ${i} Contents entry ${c} must be a stream`)
        collectImportedArtifacts(this.doc, this.doc.decodeStream(stream), resources, i, undefined, result, new Set<PdfStream>())
      }
    }
    return result
  }

  /** Imports the complete document-level structure dictionaries and hierarchy. */
  importStructureModel(): ImportedStructureModel | null {
    const catalog = this.doc.getCatalog()
    const root = this.doc.resolve(catalog.get('StructTreeRoot') ?? null)
    if (root === null) return null
    if (!(root instanceof Map)) throw new Error('PDF import error: /StructTreeRoot must be a dictionary')
    validateImportedStructureCrossReferences(this.doc, this.pages, root)
    const roleMapValue = this.doc.resolve(root.get('RoleMap') ?? null)
    const roleMap = new Map<string, string>()
    if (roleMapValue instanceof Map) {
      for (const [key, mapped] of roleMapValue) {
        const resolvedRole = this.doc.resolve(mapped)
        if (resolvedRole instanceof PdfName) roleMap.set(key, resolvedRole.name)
      }
    } else if (roleMapValue !== null) {
      throw new Error('PDF import error: /StructTreeRoot /RoleMap must be a dictionary')
    }
    const associatedFileIndexes = embeddedFileReferenceIndexes(this.doc)
    const importedNamespaces = readImportedStructureNamespaces(this.doc, root, associatedFileIndexes)
    const pronunciationLexicons = this.readPronunciationLexicons(root, associatedFileIndexes)
    const nodes: ImportedStructureNode[] = []
    this.readStructureKids(
      root.get('K') ?? null, null, roleMap, importedNamespaces.namespaces, importedNamespaces.indexes,
      associatedFileIndexes, nodes, new Set(),
    )
    connectImportedStructureSemantics(nodes, importedNamespaces.namespaces)
    validateImportedStructureUserPropertyMark(this.doc, nodes)
    const classMap: Record<string, PdfRawValueDef> = {}
    const classMapValue = this.doc.resolve(root.get('ClassMap') ?? null)
    if (classMapValue instanceof Map) {
      for (const [name, value] of classMapValue) classMap[name] = rawPdfValue(this.doc, value, new Set<object>())
    }
    const parentTreeNextKey = this.doc.resolve(root.get('ParentTreeNextKey') ?? null)
    return {
      roots: nodes,
      roleMap: Object.fromEntries(roleMap),
      classMap,
      namespaces: importedNamespaces.namespaces,
      pronunciationLexicons: pronunciationLexicons.lexicons,
      ...(pronunciationLexicons.fileIndexes === undefined ? {} : { pronunciationLexiconFileIndexes: pronunciationLexicons.fileIndexes }),
      ...(typeof parentTreeNextKey === 'number' ? { parentTreeNextKey } : {}),
    }
  }

  private readPronunciationLexicons(
    root: PdfDict,
    embeddedFileIndexes: Map<string, number>,
  ): { lexicons: ImportedPronunciationLexicon[], fileIndexes?: number[] } {
    const value = this.doc.resolve(root.get('PronunciationLexicon') ?? null)
    if (value === null) return { lexicons: [] }
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error('PDF import error: StructTreeRoot /PronunciationLexicon must be a non-empty array')
    }
    const lexicons: ImportedPronunciationLexicon[] = []
    const fileIndexes: number[] = []
    let allIndexed = true
    for (let i = 0; i < value.length; i++) {
      const reference = value[i]
      if (!(reference instanceof PdfRef)) throw new Error(`PDF import error: pronunciation lexicon ${i} must be an indirect file specification`)
      const dictionary = this.doc.resolve(reference)
      if (!(dictionary instanceof Map)) throw new Error(`PDF import error: pronunciation lexicon ${i} must reference a file specification`)
      const file = this.readEmbeddedFileSpec(dictionary, '')
      const lexicon = parsePdfPronunciationLexicon(file.data)
      const fileIndex = embeddedFileIndexes.get(`${reference.num}:${reference.gen}`)
      if (fileIndex === undefined) allIndexed = false
      else fileIndexes.push(fileIndex)
      lexicons.push({ file, lexicon, ...(fileIndex === undefined ? {} : { fileIndex }) })
    }
    return { lexicons, ...(allIndexed ? { fileIndexes } : {}) }
  }

  private readStructureKids(
    value: PdfValue,
    inheritedPage: number | null,
    roleMap: Map<string, string>,
    namespaces: ImportedStructureNamespace[],
    namespaceIndexes: Map<PdfDict, number>,
    associatedFileIndexes: Map<string, number>,
    out: ImportedStructureNode[],
    visited: Set<PdfDict>,
  ): void {
    const resolved = this.doc.resolve(value)
    if (resolved === null || resolved === undefined) return
    if (Array.isArray(resolved)) {
      for (let i = 0; i < resolved.length; i++) {
        this.readStructureKids(resolved[i]!, inheritedPage, roleMap, namespaces, namespaceIndexes, associatedFileIndexes, out, visited)
      }
      return
    }
    if (!(resolved instanceof Map)) {
      throw new Error('PDF import error: structure element kids must be dictionaries, arrays, or MCIDs')
    }
    if (visited.has(resolved)) throw new Error('PDF import error: circular structure tree')
    visited.add(resolved)
    const node = this.readStructureElement(resolved, inheritedPage, roleMap, namespaces, namespaceIndexes, associatedFileIndexes, visited)
    if (node !== null) out.push(node)
  }

  private readStructureElement(
    dict: PdfDict,
    inheritedPage: number | null,
    roleMap: Map<string, string>,
    namespaces: ImportedStructureNamespace[],
    namespaceIndexes: Map<PdfDict, number>,
    associatedFileIndexes: Map<string, number>,
    visited: Set<PdfDict>,
  ): ImportedStructureNode | null {
    const role = this.doc.resolve(dict.get('S') ?? null)
    if (!(role instanceof PdfName)) throw new Error('PDF import error: structure element /S must be a name')
    const node: ImportedStructureNode = { role: role.name, content: [], children: [] }
    const namespaceReference = dict.get('NS')
    const namespaceValue = this.doc.resolve(namespaceReference ?? null)
    let namespaceIndex: number | undefined
    if (namespaceValue !== null) {
      if (!(namespaceReference instanceof PdfRef) || !(namespaceValue instanceof Map)) {
        throw new Error('PDF import error: structure element /NS must be an indirect namespace dictionary')
      }
      namespaceIndex = namespaceIndexes.get(namespaceValue)
      if (namespaceIndex === undefined) throw new Error('PDF import error: structure element /NS is not listed in StructTreeRoot /Namespaces')
      node.namespaceIndex = namespaceIndex
    }
    const mapped = resolveImportedStructureRole(role.name, namespaceIndex, roleMap, namespaces)
    if (mapped.role !== role.name || mapped.namespaceIndex !== namespaceIndex) {
      node.mappedRole = mapped.role
      if (mapped.namespaceIndex !== undefined) node.mappedNamespaceIndex = mapped.namespaceIndex
    }
    const alt = this.doc.resolve(dict.get('Alt') ?? null)
    if (alt instanceof PdfString) node.alt = pdfStringToText(alt)
    const actualText = this.doc.resolve(dict.get('ActualText') ?? null)
    if (actualText instanceof PdfString) node.actualText = pdfStringToText(actualText)
    const expandedText = this.doc.resolve(dict.get('E') ?? null)
    if (expandedText instanceof PdfString) node.expandedText = pdfStringToText(expandedText)
    const phoneme = this.doc.resolve(dict.get('Phoneme') ?? null)
    const alphabet = this.doc.resolve(dict.get('PhoneticAlphabet') ?? null)
    if (phoneme !== null) {
      if (!(phoneme instanceof PdfString) || pdfStringToText(phoneme) === '') throw new Error('PDF import error: structure /Phoneme must be a non-empty text string')
      node.phoneme = pdfStringToText(phoneme)
      if (alphabet === null) node.phoneticAlphabet = 'ipa'
    }
    if (alphabet !== null) {
      if (node.phoneme === undefined || !(alphabet instanceof PdfName)
        || !['ipa', 'x-sampa', 'zh-Latn-pinyin', 'zh-Latn-wadegile'].includes(alphabet.name)) {
        throw new Error('PDF import error: structure /PhoneticAlphabet requires Phoneme and a standard alphabet name')
      }
      node.phoneticAlphabet = alphabet.name as ImportedStructureNode['phoneticAlphabet']
    }
    const lang = this.doc.resolve(dict.get('Lang') ?? null)
    if (lang instanceof PdfString) {
      node.lang = pdfStringToText(lang)
      validateBcp47LanguageTag(node.lang, 'PDF structure /Lang')
    } else if (lang !== null) throw new Error('PDF import error: structure /Lang must be a text string')
    const title = this.doc.resolve(dict.get('T') ?? null)
    if (title instanceof PdfString) node.title = pdfStringToText(title)
    const summary = this.doc.resolve(dict.get('Summary') ?? null)
    if (summary instanceof PdfString) node.summary = pdfStringToText(summary)
    const id = this.doc.resolve(dict.get('ID') ?? null)
    if (id instanceof PdfString) {
      node.id = pdfStringToText(id)
      node.idBytes = id.bytes.slice()
    }
    const revision = this.doc.resolve(dict.get('R') ?? null)
    if (revision !== null) {
      if (!Number.isInteger(revision) || (revision as number) < 0) throw new Error('PDF import error: structure element /R must be a non-negative integer')
      node.revision = revision as number
    }
    const importedAttributes = readImportedStructureAttributes(this.doc, dict, namespaceIndexes)
    if (importedAttributes.attributes.length > 0) node.attributes = importedAttributes.attributes
    if (importedAttributes.userProperties.length > 0) node.userProperties = importedAttributes.userProperties
    const associatedFilesValue = this.doc.resolve(dict.get('AF') ?? null)
    if (associatedFilesValue !== null) {
      if (!Array.isArray(associatedFilesValue) || associatedFilesValue.length === 0) {
        throw new Error('PDF import error: structure element /AF must be a non-empty array')
      }
      const associatedFiles: ImportedEmbeddedFile[] = []
      const indexes: number[] = []
      let allIndexed = true
      for (let i = 0; i < associatedFilesValue.length; i++) {
        const reference = associatedFilesValue[i]
        if (!(reference instanceof PdfRef)) throw new Error(`PDF import error: structure element /AF entry ${i} must be an indirect reference`)
        const specification = this.doc.resolve(reference)
        if (!(specification instanceof Map)) throw new Error(`PDF import error: structure element /AF entry ${i} must be a file specification`)
        const file = this.readEmbeddedFileSpec(specification, '')
        if (file.relationship === undefined) throw new Error(`PDF import error: structure element /AF entry ${i} requires /AFRelationship`)
        associatedFiles.push(file)
        const index = associatedFileIndexes.get(`${reference.num}:${reference.gen}`)
        if (index === undefined) allIndexed = false
        else indexes.push(index)
      }
      node.associatedFiles = associatedFiles
      if (allIndexed) node.associatedFileIndexes = indexes
    }

    const page = this.resolveStructurePage(dict.get('Pg') ?? null) ?? inheritedPage

    const kids = dict.get('K') ?? null
    this.collectStructureContent(kids, page, roleMap, namespaces, namespaceIndexes, associatedFileIndexes, node, visited)
    return node
  }

  private collectStructureContent(
    value: PdfValue,
    page: number | null,
    roleMap: Map<string, string>,
    namespaces: ImportedStructureNamespace[],
    namespaceIndexes: Map<PdfDict, number>,
    associatedFileIndexes: Map<string, number>,
    node: ImportedStructureNode,
    visited: Set<PdfDict>,
  ): void {
    const resolved = this.doc.resolve(value)
    if (resolved === null || resolved === undefined) return
    if (typeof resolved === 'number') {
      if (page === null) throw new Error('PDF import error: structure MCID without a page reference')
      node.content.push({ kind: 'mcid', pageIndex: page, mcid: resolved })
      return
    }
    if (Array.isArray(resolved)) {
      for (let i = 0; i < resolved.length; i++) {
        this.collectStructureContent(resolved[i]!, page, roleMap, namespaces, namespaceIndexes, associatedFileIndexes, node, visited)
      }
      return
    }
    if (!(resolved instanceof Map)) {
      throw new Error('PDF import error: structure element content must be a dictionary, array, or MCID')
    }
    const typeValue = this.doc.resolve(resolved.get('Type') ?? null)
    const typeName = typeValue instanceof PdfName ? typeValue.name : null
    if (typeName === 'MCR') {
      const mcid = this.doc.resolve(resolved.get('MCID') ?? null)
      if (typeof mcid !== 'number') throw new Error('PDF import error: /MCR requires a numeric /MCID')
      const mcrPage = this.resolveStructurePage(resolved.get('Pg') ?? null) ?? page
      if (mcrPage === null) throw new Error('PDF import error: /MCR without a page reference')
      const streamReference = resolved.get('Stm')
      if (streamReference === undefined) node.content.push({ kind: 'mcid', pageIndex: mcrPage, mcid })
      else {
        if (!(streamReference instanceof PdfRef)) throw new Error('PDF import error: /MCR /Stm must be an indirect reference')
        const stream = this.doc.resolve(streamReference)
        if (!(stream instanceof PdfStream)) throw new Error('PDF import error: /MCR /Stm must reference a stream')
        const structParents = this.doc.resolve(stream.dict.get('StructParents') ?? null)
        if (!Number.isInteger(structParents) || (structParents as number) < 0) throw new Error('PDF import error: /MCR /Stm requires /StructParents')
        node.content.push({
          kind: 'mcid', pageIndex: mcrPage, mcid,
          streamObject: { objectNumber: streamReference.num, generation: streamReference.gen, structParents: structParents as number },
        })
      }
      return
    }
    if (typeName === 'OBJR') {
      const objrPage = this.resolveStructurePage(resolved.get('Pg') ?? null) ?? page
      const objectReference = resolved.get('Obj')
      if (!(objectReference instanceof PdfRef)) throw new Error('PDF import error: /OBJR /Obj must be an indirect reference')
      const annotationIndex = objrPage === null ? -1 : this.structureAnnotationIndex(objrPage, objectReference)
      if (annotationIndex >= 0) {
        node.content.push({
          kind: 'annotation', pageIndex: objrPage!, annotationIndex,
          objectNumber: objectReference.num, generation: objectReference.gen,
        })
      } else {
        node.content.push({
          kind: 'object', ...(objrPage === null ? {} : { pageIndex: objrPage }),
          objectNumber: objectReference.num, generation: objectReference.gen,
        })
      }
      return
    }
    // Nested structure element
    if (visited.has(resolved)) throw new Error('PDF import error: circular structure tree')
    visited.add(resolved)
    const child = this.readStructureElement(resolved, page, roleMap, namespaces, namespaceIndexes, associatedFileIndexes, visited)
    if (child !== null) node.children.push(child)
  }

  private resolveStructurePage(value: PdfValue): number | null {
    const page = this.doc.resolve(value ?? null)
    if (!(page instanceof Map)) return null
    for (let i = 0; i < this.pages.length; i++) {
      if (this.pages[i]!.dict === page) return i
    }
    return null
  }

  private structureAnnotationIndex(pageIndex: number, objectReference: PdfRef): number {
    const annotations = this.doc.resolve(this.pages[pageIndex]!.dict.get('Annots') ?? null)
    if (!Array.isArray(annotations)) return -1
    for (let i = 0; i < annotations.length; i++) {
      const value = annotations[i]
      if (value instanceof PdfRef && value.num === objectReference.num && value.gen === objectReference.gen) return i
    }
    return -1
  }

  /**
   * Imports interactive form (AcroForm) field values: the /Fields tree with
   * inherited /FT and /V per ISO 32000 12.7.3, values decoded to text.
   */
  importFormFields(): ImportedFormField[] {
    const catalog = this.doc.getCatalog()
    const acroForm = this.doc.resolve(catalog.get('AcroForm') ?? null)
    if (acroForm === null) return []
    if (!(acroForm instanceof Map)) throw new Error('PDF import error: catalog /AcroForm must be a dictionary')
    const fields = this.doc.resolve(acroForm.get('Fields') ?? null)
    if (fields === null) return []
    if (!Array.isArray(fields)) throw new Error('PDF import error: /AcroForm /Fields must be an array')
    const result: ImportedFormField[] = []
    const fieldByDictionary = new Map<PdfDict, ImportedFormField>()
    const visited = new Set<PdfDict>()
    for (let i = 0; i < fields.length; i++) {
      result.push(this.readFormField(fields[i]!, '', {}, visited, fieldByDictionary))
    }
    const calculationOrder = this.doc.resolve(acroForm.get('CO') ?? null)
    if (calculationOrder !== null) {
      if (!Array.isArray(calculationOrder)) throw new Error('PDF import error: /AcroForm /CO must be an array')
      for (let i = 0; i < calculationOrder.length; i++) {
        const dictionary = this.doc.resolve(calculationOrder[i]!)
        if (!(dictionary instanceof Map)) throw new Error(`PDF import error: /AcroForm /CO[${i}] must reference a field dictionary`)
        const field = fieldByDictionary.get(dictionary)
        if (field === undefined) throw new Error(`PDF import error: /AcroForm /CO[${i}] is not in the Fields tree`)
        if (field.calculationOrderIndex !== undefined) throw new Error('PDF import error: /AcroForm /CO contains a duplicate field')
        field.calculationOrderIndex = i
      }
    }
    return result
  }

  /** Imports and validates the complete AcroForm /XFA XDP representation. */
  importXfa(): PdfXfa | null {
    const catalog = this.doc.getCatalog()
    const acroForm = this.doc.resolve(catalog.get('AcroForm') ?? null)
    if (acroForm === null) return null
    if (!(acroForm instanceof Map)) throw new Error('PDF import error: catalog /AcroForm must be a dictionary')
    const value = this.doc.resolve(acroForm.get('XFA') ?? null)
    if (value === null) return null
    if (value instanceof PdfStream) {
      const result: PdfXfa = { kind: 'document', data: this.doc.decodeStream(value).slice() }
      validatePdfXfa(result)
      return result
    }
    if (!Array.isArray(value) || value.length === 0 || (value.length & 1) !== 0) {
      throw new Error('PDF import error: /AcroForm /XFA must be a stream or a non-empty alternating name/stream array')
    }
    const packets: PdfXfaPacket[] = []
    for (let i = 0; i < value.length; i += 2) {
      const name = this.doc.resolve(value[i]!)
      const stream = this.doc.resolve(value[i + 1]!)
      if (!(name instanceof PdfString)) throw new Error(`PDF import error: /AcroForm /XFA[${i}] must be a packet-name string`)
      if (!(stream instanceof PdfStream)) throw new Error(`PDF import error: /AcroForm /XFA[${i + 1}] must be a packet stream`)
      packets.push({ name: pdfStringToText(name), data: this.doc.decodeStream(stream).slice() })
    }
    const result: PdfXfa = { kind: 'packets', packets }
    validatePdfXfa(result)
    return result
  }

  private readFormField(
    value: PdfValue,
    parentName: string,
    inherited: InheritedFormFieldAttributes,
    visited: Set<PdfDict>,
    fieldByDictionary: Map<PdfDict, ImportedFormField>,
  ): ImportedFormField {
    const dict = this.doc.resolve(value)
    if (!(dict instanceof Map)) throw new Error('PDF import error: form field must be a dictionary')
    if (visited.has(dict)) throw new Error('PDF import error: circular form field tree')
    visited.add(dict)

    const partialValue = this.doc.resolve(dict.get('T') ?? null)
    if (partialValue !== null && !(partialValue instanceof PdfString)) throw new Error('PDF import error: form field /T must be a string')
    const partial = partialValue instanceof PdfString ? pdfStringToText(partialValue) : ''
    const name = parentName === '' ? partial : (partial === '' ? parentName : parentName + '.' + partial)

    const typeRaw = dict.has('FT') ? dict.get('FT')! : (inherited.type ?? null)
    const typeValue = this.doc.resolve(typeRaw)
    if (typeValue !== null && (!(typeValue instanceof PdfName) || !FORM_FIELD_TYPES.has(typeValue.name))) {
      throw new Error('PDF import error: form field /FT must be /Btn, /Tx, /Ch, or /Sig')
    }
    const type = typeValue instanceof PdfName ? typeValue.name : ''

    const rawValue = dict.has('V') ? dict.get('V')! : (inherited.value ?? null)
    const rawFlags = dict.has('Ff') ? dict.get('Ff')! : (inherited.flags ?? null)
    const resolvedFlags = this.doc.resolve(rawFlags)
    if (resolvedFlags !== null && (typeof resolvedFlags !== 'number' || !Number.isInteger(resolvedFlags) || resolvedFlags < 0 || resolvedFlags > 0xFFFFFFFF)) {
      throw new Error('PDF import error: form field /Ff must be an unsigned 32-bit integer')
    }
    const flags = typeof resolvedFlags === 'number' ? resolvedFlags : 0
    const field: ImportedFormField = {
      name, type, flags, flagNames: formFieldFlagNames(type, flags),
      entries: preservedFormFieldEntries(this.doc, dict), widgets: [], children: [],
    }
    fieldByDictionary.set(dict, field)
    const resolvedValue = this.doc.resolve(rawValue)
    if (resolvedValue !== null) {
      field.valueRaw = rawPdfValue(this.doc, rawValue, new Set<object>())
    }
    if (resolvedValue instanceof PdfStream) {
      field.valueStream = this.doc.decodeStream(resolvedValue)
    } else {
      const text = this.formValueToText(rawValue)
      if (text !== null) field.value = text
    }

    const defaultValue = dict.has('DV') ? dict.get('DV')! : inherited.defaultValue
    if (defaultValue !== undefined) field.defaultValueRaw = rawPdfValue(this.doc, defaultValue, new Set<object>())
    const defaultAppearance = dict.has('DA') ? dict.get('DA')! : inherited.defaultAppearance
    if (defaultAppearance !== undefined) {
      const resolved = this.doc.resolve(defaultAppearance)
      if (!(resolved instanceof PdfString)) throw new Error('PDF import error: form field /DA must be a string')
      field.defaultAppearance = pdfStringToText(resolved)
    }
    const quadding = dict.has('Q') ? dict.get('Q')! : inherited.quadding
    if (quadding !== undefined) {
      const resolved = this.doc.resolve(quadding)
      if (resolved !== 0 && resolved !== 1 && resolved !== 2) throw new Error('PDF import error: form field /Q must be 0, 1, or 2')
      field.quadding = resolved
    }
    const richValue = dict.get('RV')
    if (richValue !== undefined) {
      const resolved = this.doc.resolve(richValue)
      if (!(resolved instanceof PdfString) && !(resolved instanceof PdfStream)) {
        throw new Error('PDF import error: form field /RV must be a string or stream')
      }
      field.richValue = rawPdfValue(this.doc, richValue, new Set<object>())
    }
    const defaultStyle = this.doc.resolve(dict.get('DS') ?? null)
    if (defaultStyle !== null) {
      if (!(defaultStyle instanceof PdfString)) throw new Error('PDF import error: form field /DS must be a string')
      field.defaultStyle = pdfStringToText(defaultStyle)
    }
    const additionalActions = this.doc.resolve(dict.get('AA') ?? null)
    if (additionalActions !== null) {
      if (!(additionalActions instanceof Map)) throw new Error('PDF import error: form field /AA must be a dictionary')
      field.additionalActionModels = readAdditionalActionModels(this.doc, this.pages, additionalActions, 'form field /AA')
    }
    if (type === 'Sig' && dict.has('Lock')) {
      const lock = dict.get('Lock')!
      if (!(lock instanceof PdfRef)) throw new Error('PDF import error: signature field /Lock must be an indirect reference')
      field.signatureLock = parsePdfSignatureFieldLock(this.doc, lock, pdfStringToText)
    }
    if (type === 'Sig' && dict.has('SV')) {
      const seedValue = dict.get('SV')!
      if (!(seedValue instanceof PdfRef)) throw new Error('PDF import error: signature field /SV must be an indirect reference')
      field.signatureSeedValue = parsePdfSignatureSeedValue(this.doc, seedValue, pdfStringToText)
    }

    const ownWidget = this.readFormWidget(dict)
    if (ownWidget !== null) {
      field.widgets.push(ownWidget)
      if (ownWidget.pageIndex !== undefined) field.pageIndex = ownWidget.pageIndex
    }

    const kidsValue = dict.get('Kids')
    if (kidsValue !== undefined) {
      const kids = this.doc.resolve(kidsValue)
      if (!Array.isArray(kids)) throw new Error('PDF import error: form field /Kids must be an array')
      const nextInherited: InheritedFormFieldAttributes = {
        type: typeRaw === null ? undefined : typeRaw,
        value: rawValue === null ? undefined : rawValue,
        flags: rawFlags === null ? undefined : rawFlags,
        defaultValue,
        defaultAppearance,
        quadding,
      }
      for (let i = 0; i < kids.length; i++) {
        const kid = this.doc.resolve(kids[i]!)
        // Pure widget kids (no /T) merge into the parent field; only kids
        // with a partial name form child fields
        if (kid instanceof Map && this.doc.resolve(kid.get('T') ?? null) instanceof PdfString) {
          field.children.push(this.readFormField(kids[i]!, name, nextInherited, visited, fieldByDictionary))
        } else if (kid instanceof Map) {
          const widget = this.readFormWidget(kid)
          if (widget === null) throw new Error(`PDF import error: form field kid ${i} must be a field or Widget annotation`)
          field.widgets.push(widget)
          if (field.pageIndex === undefined && widget.pageIndex !== undefined) field.pageIndex = widget.pageIndex
        } else {
          throw new Error(`PDF import error: form field kid ${i} must be a dictionary`)
        }
      }
    }
    return field
  }

  private readFormWidget(dict: PdfDict): ImportedFormWidget | null {
    const subtype = this.doc.resolve(dict.get('Subtype') ?? null)
    if (!(subtype instanceof PdfName) || subtype.name !== 'Widget') return null
    const widget: ImportedFormWidget = {}
    const page = this.doc.resolve(dict.get('P') ?? null)
    if (page !== null) {
      if (!(page instanceof Map)) throw new Error('PDF import error: Widget /P must reference a page')
      for (let i = 0; i < this.pages.length; i++) {
        if (this.pages[i]!.dict === page) {
          widget.pageIndex = i
          break
        }
      }
      if (widget.pageIndex === undefined) throw new Error('PDF import error: Widget /P is not in the page tree')
    }
    const state = this.doc.resolve(dict.get('AS') ?? null)
    if (state !== null) {
      if (!(state instanceof PdfName)) throw new Error('PDF import error: Widget /AS must be a name')
      widget.appearanceState = state.name
    }
    const appearance = this.doc.resolve(dict.get('AP') ?? null)
    if (appearance !== null) {
      if (!(appearance instanceof Map)) throw new Error('PDF import error: Widget /AP must be a dictionary')
      widget.appearance = rawPdfDictionary(this.doc, appearance, new Set<object>())
    }
    return widget
  }

  private formValueToText(value: PdfValue): string | null {
    const resolved = this.doc.resolve(value)
    if (resolved === null || resolved === undefined) return null
    if (resolved instanceof PdfString) return pdfStringToText(resolved)
    if (resolved instanceof PdfName) return resolved.name
    if (typeof resolved === 'number') return String(resolved)
    if (Array.isArray(resolved)) {
      const parts: string[] = []
      for (let i = 0; i < resolved.length; i++) {
        const text = this.formValueToText(resolved[i]!)
        if (text !== null) parts.push(text)
      }
      return parts.join(',')
    }
    if (resolved instanceof PdfStream) return null
    if (resolved instanceof Map) {
      // Signature dictionaries etc. — surface the /Type or omit
      return null
    }
    return null
  }

  private readPageContents(page: CollectedPage): Uint8Array {
    const contentsValue = this.doc.resolve(page.dict.get('Contents') ?? null)
    if (contentsValue === null) return new Uint8Array(0)
    if (contentsValue instanceof PdfStream) return this.doc.decodeStream(contentsValue)
    if (Array.isArray(contentsValue)) {
      const decoded: Uint8Array[] = []
      let total = 0
      for (let i = 0; i < contentsValue.length; i++) {
        const item = this.doc.resolve(contentsValue[i]!)
        if (!(item instanceof PdfStream)) {
          throw new Error(`PDF import error: page content array item ${i} is not a stream`)
        }
        const bytes = this.doc.decodeStream(item)
        decoded.push(bytes)
        total += bytes.length + 1
      }
      const out = new Uint8Array(total)
      let pos = 0
      for (let i = 0; i < decoded.length; i++) {
        out.set(decoded[i]!, pos)
        pos += decoded[i]!.length
        out[pos++] = 0x0A
      }
      return out
    }
    throw new Error('PDF import error: /Contents must be a stream or stream array')
  }
}

function validateImportedStructureUserPropertyMark(doc: PdfDocument, roots: ImportedStructureNode[]): void {
  const stack = roots.slice()
  let hasUserProperties = false
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.userProperties !== undefined) hasUserProperties = true
    for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]!)
  }
  const markInfo = doc.resolve(doc.getCatalog().get('MarkInfo') ?? null)
  const marked = markInfo instanceof Map ? doc.resolve(markInfo.get('UserProperties') ?? null) : null
  if (hasUserProperties && marked !== true) {
    throw new Error('PDF import error: structure UserProperties require Catalog MarkInfo /UserProperties true')
  }
}

function connectImportedStructureSemantics(roots: ImportedStructureNode[], namespaces: ImportedStructureNamespace[]): void {
  const nodes: ImportedStructureNode[] = []
  const stack = roots.slice().reverse()
  while (stack.length > 0) {
    const node = stack.pop()!
    nodes.push(node)
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!)
  }
  const indexes = new Map<ImportedStructureNode, number>()
  const ids = new Map<string, ImportedStructureNode>()
  for (let i = 0; i < nodes.length; i++) {
    indexes.set(nodes[i]!, i)
    if (nodes[i]!.id !== undefined) ids.set(nodes[i]!.id!, nodes[i]!)
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.role === 'Ruby') {
      const bases = node.children.filter(function (child) { return child.role === 'RB' })
      const rubyTexts = node.children.filter(function (child) { return child.role === 'RT' })
      const punctuations = node.children.filter(function (child) { return child.role === 'RP' })
      if (bases.length === 0 || rubyTexts.length === 0 || bases.length + rubyTexts.length + punctuations.length !== node.children.length) {
        throw new Error('PDF import error: Ruby structure requires RB and RT children, with optional RP children')
      }
      node.ruby = { bases, rubyTexts, punctuations }
    } else if (node.role === 'Warichu') {
      const texts = node.children.filter(function (child) { return child.role === 'WT' })
      const punctuations = node.children.filter(function (child) { return child.role === 'WP' })
      if (texts.length === 0 || texts.length + punctuations.length !== node.children.length) {
        throw new Error('PDF import error: Warichu structure requires WT children, with optional WP children')
      }
      node.warichu = { texts, punctuations }
    }
    if (node.role === 'Formula') {
      const mathChildren = node.children.filter(function (child) {
        return child.role === 'math' && child.namespaceIndex !== undefined
          && namespaces[child.namespaceIndex]?.uri === 'http://www.w3.org/1998/Math/MathML'
      })
      if (mathChildren.length > 1) throw new Error('PDF import error: Formula contains multiple MathML roots')
      if (mathChildren.length === 1) node.mathml = importedMathMlNode(mathChildren[0]!, namespaces)
    }
    const list = importedAttribute(node, 'List')
    if (list !== undefined) {
      const numbering = importedName(list.entries.ListNumbering)
      const continuedList = list.entries.ContinuedList
      const continuedFrom = importedText(list.entries.ContinuedFrom)
      node.list = {
        ...(numbering === undefined ? {} : { numbering }),
        ...(typeof continuedList === 'boolean' ? { continuedList } : {}),
        ...(continuedFrom === undefined ? {} : { continuedFrom }),
      }
    }
    const table = importedAttribute(node, 'Table')
    if (table !== undefined) {
      const headerIds = importedTextArray(table.entries.Headers)
      const headerElementIndexes: number[] = []
      if (headerIds !== undefined) {
        for (let h = 0; h < headerIds.length; h++) {
          const target = ids.get(headerIds[h]!)
          if (target === undefined || target.role !== 'TH' || target === node) {
            throw new Error(`PDF import error: Table Headers does not reference another TH element: ${headerIds[h]}`)
          }
          headerElementIndexes.push(indexes.get(target)!)
        }
      }
      node.table = {
        ...(typeof table.entries.RowSpan === 'number' ? { rowSpan: table.entries.RowSpan } : {}),
        ...(typeof table.entries.ColSpan === 'number' ? { colSpan: table.entries.ColSpan } : {}),
        ...(importedName(table.entries.Scope) === undefined ? {} : { scope: importedName(table.entries.Scope)! }),
        ...(headerIds === undefined ? {} : { headerIds, headerElementIndexes }),
      }
    }
    const artifact = importedAttribute(node, 'Artifact')
    if (node.role === 'Artifact' && artifact !== undefined) {
      const bbox = importedNumberArray(artifact.entries.BBox, 4)
      node.artifact = {
        ...(importedName(artifact.entries.Type) === undefined ? {} : { type: importedName(artifact.entries.Type)! }),
        ...(importedName(artifact.entries.Subtype) === undefined ? {} : { subtype: importedName(artifact.entries.Subtype)! }),
        ...(bbox === undefined ? {} : { bbox: bbox as [number, number, number, number] }),
        ...(importedNameArray(artifact.entries.Attached) === undefined ? {} : { attached: importedNameArray(artifact.entries.Attached)! }),
      }
    }
  }
}

function importedAttribute(node: ImportedStructureNode, owner: string): ImportedStructureAttribute | undefined {
  return node.attributes?.find(function (attribute) { return attribute.owner === owner })
}

function importedName(value: PdfRawValueDef | undefined): string | undefined {
  return typeof value === 'object' && value !== null && value.kind === 'name' ? value.value : undefined
}

function importedText(value: PdfRawValueDef | undefined): string | undefined {
  return typeof value === 'object' && value !== null && value.kind === 'string' ? decodePdfTextStringBytes(value.bytes) : undefined
}

function importedTextArray(value: PdfRawValueDef | undefined): string[] | undefined {
  if (typeof value !== 'object' || value === null || value.kind !== 'array') return undefined
  const result: string[] = []
  for (let i = 0; i < value.items.length; i++) {
    const text = importedText(value.items[i])
    if (text === undefined) return undefined
    result.push(text)
  }
  return result
}

function importedNameArray(value: PdfRawValueDef | undefined): string[] | undefined {
  if (typeof value !== 'object' || value === null || value.kind !== 'array') return undefined
  const result: string[] = []
  for (let i = 0; i < value.items.length; i++) {
    const name = importedName(value.items[i])
    if (name === undefined) return undefined
    result.push(name)
  }
  return result
}

function importedNumberArray(value: PdfRawValueDef | undefined, length: number): number[] | undefined {
  if (typeof value !== 'object' || value === null || value.kind !== 'array' || value.items.length !== length
    || !value.items.every(function (item) { return typeof item === 'number' })) return undefined
  return value.items as number[]
}

function importedMathMlNode(node: ImportedStructureNode, namespaces: ImportedStructureNamespace[]): ImportedMathMlStructureNode {
  const children: ImportedMathMlStructureNode[] = []
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!
    if (child.namespaceIndex === undefined || namespaces[child.namespaceIndex]?.uri !== 'http://www.w3.org/1998/Math/MathML') {
      throw new Error('PDF import error: MathML descendants must explicitly use the MathML namespace')
    }
    children.push(importedMathMlNode(child, namespaces))
  }
  let attributes: Record<string, string> | undefined
  const namespaceAttributes = node.attributes?.find(function (attribute) {
    return attribute.owner === 'NSO' && attribute.namespaceIndex === node.namespaceIndex
  })
  if (namespaceAttributes !== undefined) {
    attributes = {}
    for (const name of Object.keys(namespaceAttributes.entries)) {
      const value = importedText(namespaceAttributes.entries[name])
      if (value === undefined) throw new Error(`PDF import error: MathML attribute ${name} must be a text string`)
      attributes[name] = value
    }
  }
  return {
    name: node.role,
    ...(node.actualText === undefined ? {} : { text: node.actualText }),
    ...(attributes === undefined ? {} : { attributes }),
    children,
  }
}

function validateImportedPdfMetadataStream(doc: PdfDocument, metadata: PdfStream, owner: string): void {
  const type = doc.resolve(metadata.dict.get('Type') ?? null)
  const subtype = doc.resolve(metadata.dict.get('Subtype') ?? null)
  if (!(type instanceof PdfName) || type.name !== 'Metadata') {
    throw new Error(`PDF import error: ${owner} metadata stream /Type must be /Metadata`)
  }
  if (!(subtype instanceof PdfName) || subtype.name !== 'XML') {
    throw new Error(`PDF import error: ${owner} metadata stream /Subtype must be /XML`)
  }
  parsePdfXmpPacket(doc.decodeStream(metadata))
}

interface ImportedStructureValidationContext {
  doc: PdfDocument
  pages: CollectedPage[]
  root: PdfDict
  parentTree: Map<number, PdfValue>
  ids: Map<string, PdfDict>
  visited: Set<PdfDict>
  validatedContentOwners: Set<object>
}

function validateImportedStructureCrossReferences(doc: PdfDocument, pages: CollectedPage[], root: PdfDict): void {
  const type = doc.resolve(root.get('Type') ?? null)
  if (!(type instanceof PdfName) || type.name !== 'StructTreeRoot') {
    throw new Error('PDF import error: structure root /Type must be /StructTreeRoot')
  }
  validateImportedStructureRoleMap(doc, root)
  validateImportedStructureClassMap(doc, root)
  validateImportedStructureNamespaces(doc, root)

  const parentTree = new Map<number, PdfValue>()
  const parentTreeValue = doc.resolve(root.get('ParentTree') ?? null)
  if (parentTreeValue !== null) {
    if (!(parentTreeValue instanceof Map)) throw new Error('PDF import error: structure /ParentTree must be a number tree')
    const entries: [number, PdfValue][] = []
    collectNumberTreeEntries(doc, parentTreeValue, entries, new Set<PdfDict>())
    for (let i = 0; i < entries.length; i++) {
      const key = entries[i]![0]
      if (!Number.isInteger(key) || key < 0) throw new Error('PDF import error: ParentTree keys must be non-negative integers')
      if (parentTree.has(key)) throw new Error(`PDF import error: duplicate ParentTree key ${key}`)
      parentTree.set(key, entries[i]![1])
    }
  }
  const nextKey = doc.resolve(root.get('ParentTreeNextKey') ?? null)
  if (nextKey !== null && (!Number.isInteger(nextKey) || (nextKey as number) < 0)) {
    throw new Error('PDF import error: /ParentTreeNextKey must be a non-negative integer')
  }
  if (typeof nextKey === 'number') {
    for (const key of parentTree.keys()) {
      if (key >= nextKey) throw new Error('PDF import error: /ParentTreeNextKey must exceed every ParentTree key')
    }
  }

  const context: ImportedStructureValidationContext = {
    doc, pages, root, parentTree, ids: new Map<string, PdfDict>(), visited: new Set<PdfDict>(), validatedContentOwners: new Set<object>(),
  }
  validateImportedStructureKids(context, root.get('K') ?? null, root, null)
  for (let i = 0; i < pages.length; i++) validateImportedPageParentTree(context, pages[i]!.dict, i)
  validateImportedStructureIdTree(context)
}

function validateImportedPageParentTree(context: ImportedStructureValidationContext, page: PdfDict, pageIndex: number): void {
  const key = context.doc.resolve(page.get('StructParents') ?? null)
  if (key === null) return
  if (!Number.isInteger(key) || (key as number) < 0) throw new Error(`PDF import error: page ${pageIndex} /StructParents must be a non-negative integer`)
  const array = context.doc.resolve(context.parentTree.get(key as number) ?? null)
  if (!Array.isArray(array)) throw new Error(`PDF import error: ParentTree key ${key} for page ${pageIndex} must be an array`)
  validateImportedMarkedContentOwner(context, page, page, null, array, key as number)
}

function validateImportedStructureRoleMap(doc: PdfDocument, root: PdfDict): void {
  const value = doc.resolve(root.get('RoleMap') ?? null)
  if (value === null) return
  if (!(value instanceof Map)) throw new Error('PDF import error: structure /RoleMap must be a dictionary')
  const roleMap = new Map<string, string>()
  for (const [role, rawTarget] of value) {
    const target = doc.resolve(rawTarget)
    if (!(target instanceof PdfName)) throw new Error(`PDF import error: RoleMap ${role} target must be a name`)
    roleMap.set(role, target.name)
  }
  for (const role of roleMap.keys()) {
    const visited = new Set<string>()
    let current = role
    while (roleMap.has(current)) {
      if (visited.has(current)) throw new Error(`PDF import error: RoleMap contains a cycle at ${role}`)
      visited.add(current)
      current = roleMap.get(current)!
    }
    if (!isDefaultStructureRole(current)) {
      throw new Error(`PDF import error: RoleMap ${role} does not resolve to a default standard structure role`)
    }
  }
}

function resolveImportedStructureRole(
  role: string,
  namespaceIndex: number | undefined,
  roleMap: Map<string, string>,
  namespaces: ImportedStructureNamespace[],
): ImportedStructureNamespaceRoleTarget {
  if (namespaceIndex === undefined) {
    let resolved = role
    while (roleMap.has(resolved)) resolved = roleMap.get(resolved)!
    return { role: resolved }
  }
  let currentRole = role
  let currentNamespace: number | undefined = namespaceIndex
  const visited = new Set<string>()
  while (currentNamespace !== undefined) {
    const key = `${currentNamespace}:${currentRole}`
    if (visited.has(key)) throw new Error(`PDF import error: namespace RoleMapNS contains a cycle at ${role}`)
    visited.add(key)
    const target: ImportedStructureNamespaceRoleTarget | undefined = namespaces[currentNamespace]!.roleMap[currentRole]
    if (target === undefined) return { role: currentRole, namespaceIndex: currentNamespace }
    currentRole = target.role
    currentNamespace = target.namespaceIndex
  }
  return { role: currentRole }
}

function readImportedStructureNamespaces(
  doc: PdfDocument,
  root: PdfDict,
  embeddedFileIndexes: Map<string, number>,
): { namespaces: ImportedStructureNamespace[], indexes: Map<PdfDict, number> } {
  const value = doc.resolve(root.get('Namespaces') ?? null)
  const namespaces: ImportedStructureNamespace[] = []
  const indexes = new Map<PdfDict, number>()
  if (value === null) return { namespaces, indexes }
  if (!Array.isArray(value)) throw new Error('PDF import error: structure /Namespaces must be an array')
  const dictionaries: PdfDict[] = []
  for (let i = 0; i < value.length; i++) {
    const dictionary = doc.resolve(value[i]!)
    if (!(dictionary instanceof Map)) throw new Error(`PDF import error: structure namespace ${i} must be a dictionary`)
    dictionaries.push(dictionary)
    indexes.set(dictionary, i)
    const uri = doc.resolve(dictionary.get('NS') ?? null)
    if (!(uri instanceof PdfString)) throw new Error(`PDF import error: structure namespace ${i} /NS must be a string`)
    const entries: Record<string, PdfRawValueDef> = {}
    for (const [key, raw] of dictionary) {
      if (key !== 'NS' && key !== 'Schema' && key !== 'RoleMapNS') entries[key] = rawPdfValue(doc, raw, new Set<object>())
    }
    const namespace: ImportedStructureNamespace = { uri: pdfStringToText(uri), entries, roleMap: {} }
    const schema = dictionary.get('Schema')
    if (schema !== undefined) {
      if (schema instanceof PdfRef) {
        const index = embeddedFileIndexes.get(`${schema.num}:${schema.gen}`)
        if (index !== undefined) namespace.schemaFileIndex = index
      }
      if (namespace.schemaFileIndex === undefined) namespace.schema = rawPdfValue(doc, schema, new Set<object>())
    }
    namespaces.push(namespace)
  }
  for (let i = 0; i < dictionaries.length; i++) {
    const roleMap = doc.resolve(dictionaries[i]!.get('RoleMapNS') ?? null)
    if (roleMap === null) continue
    if (!(roleMap instanceof Map)) throw new Error(`PDF import error: structure namespace ${i} /RoleMapNS must be a dictionary`)
    for (const [role, rawTarget] of roleMap) {
      const target = doc.resolve(rawTarget)
      if (target instanceof PdfName) {
        if (!isDefaultStructureRole(target.name)) {
          throw new Error(`PDF import error: namespace RoleMapNS ${role} has a non-standard default-namespace target`)
        }
        namespaces[i]!.roleMap[role] = { role: target.name }
        continue
      }
      if (!Array.isArray(target) || target.length !== 2) {
        throw new Error(`PDF import error: namespace RoleMapNS ${role} target must be a name or [name namespace]`)
      }
      const targetRole = doc.resolve(target[0]!)
      const targetNamespaceReference = target[1]
      const targetNamespace = doc.resolve(targetNamespaceReference!)
      if (!(targetRole instanceof PdfName) || !(targetNamespaceReference instanceof PdfRef) || !(targetNamespace instanceof Map)) {
        throw new Error(`PDF import error: namespace RoleMapNS ${role} target must contain a name and indirect namespace`)
      }
      const targetIndex = indexes.get(targetNamespace)
      if (targetIndex === undefined) throw new Error(`PDF import error: namespace RoleMapNS ${role} target is not listed in /Namespaces`)
      namespaces[i]!.roleMap[role] = { role: targetRole.name, namespaceIndex: targetIndex }
    }
  }
  for (let i = 0; i < namespaces.length; i++) {
    for (const role of Object.keys(namespaces[i]!.roleMap)) {
      if ((namespaces[i]!.uri === DEFAULT_STRUCTURE_NAMESPACE && isDefaultStructureRole(role))
        || (namespaces[i]!.uri === PDF_20_STRUCTURE_NAMESPACE && isPdf20StructureRole(role))) {
        throw new Error(`PDF import error: namespace RoleMapNS remaps a standard role in its own namespace: ${role}`)
      }
      const resolved = resolveImportedStructureRole(role, i, new Map(), namespaces)
      if (resolved.namespaceIndex === undefined) {
        if (!isDefaultStructureRole(resolved.role)) {
          throw new Error(`PDF import error: namespace RoleMapNS ${role} does not resolve to a standard role`)
        }
      } else {
        const uri = namespaces[resolved.namespaceIndex]!.uri
        if (uri === DEFAULT_STRUCTURE_NAMESPACE && !isDefaultStructureRole(resolved.role)) {
          throw new Error(`PDF import error: namespace RoleMapNS ${role} does not resolve within the PDF 1.7 namespace`)
        }
        if (uri === PDF_20_STRUCTURE_NAMESPACE && !isPdf20StructureRole(resolved.role)) {
          throw new Error(`PDF import error: namespace RoleMapNS ${role} does not resolve within the PDF 2.0 namespace`)
        }
      }
    }
  }
  return { namespaces, indexes }
}

function validateImportedStructureClassMap(doc: PdfDocument, root: PdfDict): void {
  const value = doc.resolve(root.get('ClassMap') ?? null)
  if (value === null) return
  if (!(value instanceof Map)) throw new Error('PDF import error: structure /ClassMap must be a dictionary')
  for (const [name, rawAttributes] of value) {
    const attributes = doc.resolve(rawAttributes)
    if (attributes instanceof Map || attributes instanceof PdfStream) continue
    if (!Array.isArray(attributes) || attributes.length === 0) {
      throw new Error(`PDF import error: ClassMap ${name} must be an attribute dictionary or non-empty array`)
    }
    for (let i = 0; i < attributes.length; i++) {
      const attribute = doc.resolve(attributes[i]!)
      if (!(attribute instanceof Map) && !(attribute instanceof PdfStream)) {
        throw new Error(`PDF import error: ClassMap ${name} entry ${i} must be a dictionary or stream`)
      }
    }
  }
}

function validateImportedStructureNamespaces(doc: PdfDocument, root: PdfDict): void {
  const value = doc.resolve(root.get('Namespaces') ?? null)
  if (value === null) return
  if (!Array.isArray(value)) throw new Error('PDF import error: structure /Namespaces must be an array')
  const uris = new Set<string>()
  for (let i = 0; i < value.length; i++) {
    if (!(value[i] instanceof PdfRef)) throw new Error(`PDF import error: structure namespace ${i} must be indirect`)
    const namespace = doc.resolve(value[i]!)
    if (!(namespace instanceof Map)) throw new Error(`PDF import error: structure namespace ${i} must be a dictionary`)
    const type = doc.resolve(namespace.get('Type') ?? null)
    const uri = doc.resolve(namespace.get('NS') ?? null)
    if (!(type instanceof PdfName) || type.name !== 'Namespace') throw new Error(`PDF import error: structure namespace ${i} /Type must be /Namespace`)
    if (!(uri instanceof PdfString)) throw new Error(`PDF import error: structure namespace ${i} /NS must be a string`)
    const text = pdfStringToText(uri)
    if (text === '' || uris.has(text)) throw new Error(`PDF import error: structure namespace ${i} URI must be non-empty and unique`)
    uris.add(text)
  }
}

function validateImportedStructureKids(
  context: ImportedStructureValidationContext,
  value: PdfValue,
  expectedParent: PdfDict,
  inheritedPage: PdfDict | null,
): void {
  const resolved = context.doc.resolve(value)
  if (resolved === null || resolved === undefined) return
  if (Array.isArray(resolved)) {
    for (let i = 0; i < resolved.length; i++) validateImportedStructureKids(context, resolved[i]!, expectedParent, inheritedPage)
    return
  }
  if (!(resolved instanceof Map)) throw new Error('PDF import error: structure tree kids must be structure-element dictionaries')
  validateImportedStructureElement(context, resolved, expectedParent, inheritedPage)
}

function validateImportedStructureElement(
  context: ImportedStructureValidationContext,
  element: PdfDict,
  expectedParent: PdfDict,
  inheritedPage: PdfDict | null,
): void {
  if (context.visited.has(element)) throw new Error('PDF import error: circular or multiply-owned structure element')
  context.visited.add(element)
  const type = context.doc.resolve(element.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'StructElem')) {
    throw new Error('PDF import error: structure element /Type must be /StructElem')
  }
  const role = context.doc.resolve(element.get('S') ?? null)
  if (!(role instanceof PdfName)) throw new Error('PDF import error: structure element /S must be a name')
  const parentReference = element.get('P')
  if (!(parentReference instanceof PdfRef) || context.doc.resolve(parentReference) !== expectedParent) {
    throw new Error('PDF import error: structure element /P does not reference its owning parent')
  }
  const page = importedStructurePage(context, element.get('Pg') ?? null) ?? inheritedPage
  const id = context.doc.resolve(element.get('ID') ?? null)
  if (id instanceof PdfString) {
    const text = pdfStringToText(id)
    if (context.ids.has(text)) throw new Error(`PDF import error: duplicate structure ID ${text}`)
    context.ids.set(text, element)
  } else if (id !== null) throw new Error('PDF import error: structure element /ID must be a string')
  validateImportedStructureContent(context, element.get('K') ?? null, element, page)
}

function validateImportedStructureContent(
  context: ImportedStructureValidationContext,
  value: PdfValue,
  owner: PdfDict,
  page: PdfDict | null,
): void {
  const resolved = context.doc.resolve(value)
  if (resolved === null || resolved === undefined) return
  if (typeof resolved === 'number') {
    validateImportedMcidParent(context, owner, page, null, resolved)
    return
  }
  if (Array.isArray(resolved)) {
    for (let i = 0; i < resolved.length; i++) validateImportedStructureContent(context, resolved[i]!, owner, page)
    return
  }
  if (!(resolved instanceof Map)) throw new Error('PDF import error: structure /K has an invalid content item')
  const type = context.doc.resolve(resolved.get('Type') ?? null)
  if (type instanceof PdfName && type.name === 'MCR') {
    const mcid = context.doc.resolve(resolved.get('MCID') ?? null)
    if (!Number.isInteger(mcid) || (mcid as number) < 0) throw new Error('PDF import error: MCR /MCID must be a non-negative integer')
    const mcrPage = importedStructurePage(context, resolved.get('Pg') ?? null) ?? page
    const streamReference = resolved.get('Stm')
    if (streamReference !== undefined && !(streamReference instanceof PdfRef)) throw new Error('PDF import error: MCR /Stm must be an indirect reference')
    const stream = streamReference instanceof PdfRef ? context.doc.resolve(streamReference) : null
    if (streamReference !== undefined && !(stream instanceof PdfStream)) throw new Error('PDF import error: MCR /Stm must reference a stream')
    validateImportedMcidParent(context, owner, mcrPage, stream instanceof PdfStream ? stream : null, mcid as number)
    return
  }
  if (type instanceof PdfName && type.name === 'OBJR') {
    validateImportedObjectReference(context, owner, resolved, page)
    return
  }
  validateImportedStructureElement(context, resolved, owner, page)
}

function validateImportedMcidParent(
  context: ImportedStructureValidationContext,
  owner: PdfDict,
  page: PdfDict | null,
  stream: PdfStream | null,
  mcid: number,
): void {
  if (!Number.isInteger(mcid) || mcid < 0) throw new Error('PDF import error: structure MCID must be a non-negative integer')
  const dictionary = stream === null ? page : stream.dict
  if (dictionary === null) throw new Error('PDF import error: structure MCID has no page or stream')
  const key = context.doc.resolve(dictionary.get('StructParents') ?? null)
  if (!Number.isInteger(key) || (key as number) < 0) throw new Error('PDF import error: MCID owner requires a non-negative /StructParents key')
  const array = context.doc.resolve(context.parentTree.get(key as number) ?? null)
  if (!Array.isArray(array)) throw new Error(`PDF import error: ParentTree key ${key} must map MCIDs to an array`)
  validateImportedMarkedContentOwner(context, dictionary, page, stream, array, key as number)
  if (mcid >= array.length || context.doc.resolve(array[mcid] ?? null) !== owner) {
    throw new Error(`PDF import error: ParentTree key ${key} MCID ${mcid} does not map to its structure element`)
  }
}

function validateImportedMarkedContentOwner(
  context: ImportedStructureValidationContext,
  dictionary: PdfDict,
  page: PdfDict | null,
  stream: PdfStream | null,
  parentArray: PdfValue[],
  parentTreeKey: number,
): void {
  const identity = stream ?? dictionary
  if (context.validatedContentOwners.has(identity)) return
  context.validatedContentOwners.add(identity)
  const resources = context.doc.resolve(dictionary.get('Resources') ?? page?.get('Resources') ?? null)
  if (!(resources instanceof Map)) throw new Error('PDF import error: marked-content owner requires a Resources dictionary')
  const mcids = stream === null
    ? importedPageMarkedContentIds(context.doc, dictionary, resources)
    : importedStreamMarkedContentIds(context.doc, stream, resources)
  for (const mcid of mcids) {
    if (mcid >= parentArray.length || context.doc.resolve(parentArray[mcid] ?? null) === null) {
      throw new Error(`PDF import error: marked-content MCID ${mcid} is missing from ParentTree key ${parentTreeKey}`)
    }
  }
  for (let mcid = 0; mcid < parentArray.length; mcid++) {
    if (context.doc.resolve(parentArray[mcid] ?? null) !== null && !mcids.has(mcid)) {
      throw new Error(`PDF import error: ParentTree key ${parentTreeKey} MCID ${mcid} is absent from its content stream`)
    }
  }
}

function importedPageMarkedContentIds(doc: PdfDocument, page: PdfDict, resources: PdfDict): Set<number> {
  const result = new Set<number>()
  const contents = doc.resolve(page.get('Contents') ?? null)
  if (contents === null) return result
  if (contents instanceof PdfStream) {
    collectImportedMarkedContentIds(doc, doc.decodeStream(contents), resources, result)
    return result
  }
  if (!Array.isArray(contents)) throw new Error('PDF import error: page Contents must be a stream or array')
  for (let i = 0; i < contents.length; i++) {
    const stream = doc.resolve(contents[i]!)
    if (!(stream instanceof PdfStream)) throw new Error(`PDF import error: page Contents entry ${i} must be a stream`)
    collectImportedMarkedContentIds(doc, doc.decodeStream(stream), resources, result)
  }
  return result
}

function importedStreamMarkedContentIds(doc: PdfDocument, stream: PdfStream, resources: PdfDict): Set<number> {
  const result = new Set<number>()
  collectImportedMarkedContentIds(doc, doc.decodeStream(stream), resources, result)
  return result
}

function collectImportedMarkedContentIds(doc: PdfDocument, data: Uint8Array, resources: PdfDict, result: Set<number>): void {
  const lexer = new PdfContentLexer(data)
  const operands: PdfValue[] = []
  for (;;) {
    const token = lexer.next()
    if (token.type === 'eof') return
    if (token.type === 'object') {
      operands.push(token.value)
      continue
    }
    if (token.type === 'operator' && token.value === 'BDC') {
      if (operands.length !== 2) throw new Error('PDF import error: BDC requires a tag and property list')
      let properties = doc.resolve(operands[1]!)
      if (properties instanceof PdfName) {
        const propertyResources = doc.resolve(resources.get('Properties') ?? null)
        if (!(propertyResources instanceof Map)) throw new Error('PDF import error: named marked-content property requires Properties resources')
        properties = doc.resolve(propertyResources.get(properties.name) ?? null)
      }
      if (!(properties instanceof Map)) throw new Error('PDF import error: BDC property list must be a dictionary or named resource')
      const mcid = doc.resolve(properties.get('MCID') ?? null)
      if (mcid !== null) {
        if (!Number.isInteger(mcid) || (mcid as number) < 0) throw new Error('PDF import error: marked-content MCID must be a non-negative integer')
        if (result.has(mcid as number)) throw new Error(`PDF import error: duplicate marked-content MCID ${mcid}`)
        result.add(mcid as number)
      }
    }
    operands.length = 0
  }
}

function collectImportedArtifacts(
  doc: PdfDocument,
  data: Uint8Array,
  resources: PdfDict,
  pageIndex: number,
  streamReference: PdfRef | undefined,
  result: ImportedMarkedContentArtifact[],
  activeForms: Set<PdfStream>,
): void {
  const lexer = new PdfContentLexer(data)
  const operands: PdfValue[] = []
  for (;;) {
    const token = lexer.next()
    if (token.type === 'eof') return
    if (token.type === 'object') {
      operands.push(token.value)
      continue
    }
    if (token.type === 'inlineImage') {
      operands.length = 0
      continue
    }
    if (token.value === 'BMC') {
      if (operands.length !== 1 || !(doc.resolve(operands[0]!) instanceof PdfName)) {
        throw new Error('PDF import error: BMC requires one name tag')
      }
      const tag = doc.resolve(operands[0]!) as PdfName
      if (tag.name === 'Artifact') result.push(importedArtifactProperty(doc, null, pageIndex, streamReference))
    } else if (token.value === 'BDC') {
      if (operands.length !== 2 || !(doc.resolve(operands[0]!) instanceof PdfName)) {
        throw new Error('PDF import error: BDC requires a name tag and property list')
      }
      const tag = doc.resolve(operands[0]!) as PdfName
      if (tag.name === 'Artifact') {
        let property = doc.resolve(operands[1]!)
        if (property instanceof PdfName) {
          const properties = doc.resolve(resources.get('Properties') ?? null)
          if (!(properties instanceof Map)) throw new Error('PDF import error: named Artifact property requires Properties resources')
          property = doc.resolve(properties.get(property.name) ?? null)
        }
        if (!(property instanceof Map)) throw new Error('PDF import error: Artifact BDC property list must be a dictionary')
        result.push(importedArtifactProperty(doc, property, pageIndex, streamReference))
      }
    } else if (token.value === 'Do') {
      if (operands.length !== 1 || !(doc.resolve(operands[0]!) instanceof PdfName)) {
        throw new Error('PDF import error: Do requires one XObject name')
      }
      const name = doc.resolve(operands[0]!) as PdfName
      const xobjects = doc.resolve(resources.get('XObject') ?? null)
      if (xobjects instanceof Map) {
        const raw = xobjects.get(name.name)
        const object = doc.resolve(raw ?? null)
        if (object instanceof PdfStream) {
          const subtype = doc.resolve(object.dict.get('Subtype') ?? null)
          if (subtype instanceof PdfName && subtype.name === 'Form') {
            if (activeForms.has(object)) throw new Error('PDF import error: cyclic Form XObject during artifact extraction')
            const formResources = doc.resolve(object.dict.get('Resources') ?? null)
            if (formResources !== null && !(formResources instanceof Map)) throw new Error('PDF import error: Form Resources must be a dictionary')
            activeForms.add(object)
            collectImportedArtifacts(
              doc, doc.decodeStream(object), formResources instanceof Map ? formResources : resources, pageIndex,
              raw instanceof PdfRef ? raw : undefined, result, activeForms,
            )
            activeForms.delete(object)
          }
        }
      }
    }
    operands.length = 0
  }
}

function importedArtifactProperty(
  doc: PdfDocument,
  property: PdfDict | null,
  pageIndex: number,
  streamReference: PdfRef | undefined,
): ImportedMarkedContentArtifact {
  const artifact: ImportedMarkedContentArtifact = {
    pageIndex,
    ...(streamReference === undefined ? {} : { streamObject: { objectNumber: streamReference.num, generation: streamReference.gen } }),
  }
  if (property === null) return artifact
  const type = doc.resolve(property.get('Type') ?? null)
  const subtype = doc.resolve(property.get('Subtype') ?? null)
  const bbox = doc.resolve(property.get('BBox') ?? null)
  const attached = doc.resolve(property.get('Attached') ?? null)
  const actualText = doc.resolve(property.get('ActualText') ?? null)
  const lang = doc.resolve(property.get('Lang') ?? null)
  if (type !== null) {
    if (!(type instanceof PdfName) || !['Pagination', 'Layout', 'Page', 'Background'].includes(type.name)) {
      throw new Error('PDF import error: Artifact Type is invalid')
    }
    artifact.type = type.name
  }
  if (subtype !== null) {
    if (!(subtype instanceof PdfName) || !['Header', 'Footer', 'Watermark'].includes(subtype.name) || type instanceof PdfName && type.name !== 'Pagination') {
      throw new Error('PDF import error: Artifact Subtype requires Pagination and a standard subtype')
    }
    artifact.subtype = subtype.name
  }
  if (bbox !== null) {
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(function (value) { return typeof doc.resolve(value) === 'number' })) {
      throw new Error('PDF import error: Artifact BBox must be a rectangle')
    }
    const values = bbox.map(function (value) { return doc.resolve(value) as number }) as [number, number, number, number]
    if (values[0] > values[2] || values[1] > values[3]) throw new Error('PDF import error: Artifact BBox must be ordered')
    artifact.bbox = values
  }
  if (attached !== null) {
    if (!Array.isArray(attached) || attached.length === 0) throw new Error('PDF import error: Artifact Attached must be a non-empty array')
    const edges = attached.map(function (value) {
      const edge = doc.resolve(value)
      if (!(edge instanceof PdfName) || !['Top', 'Bottom', 'Left', 'Right'].includes(edge.name)) {
        throw new Error('PDF import error: Artifact Attached edge is invalid')
      }
      return edge.name
    })
    if (new Set(edges).size !== edges.length) throw new Error('PDF import error: Artifact Attached contains duplicates')
    artifact.attached = edges
  }
  if (actualText !== null) {
    if (!(actualText instanceof PdfString)) throw new Error('PDF import error: Artifact ActualText must be a text string')
    artifact.actualText = pdfStringToText(actualText)
  }
  if (lang !== null) {
    if (!(lang instanceof PdfString)) throw new Error('PDF import error: Artifact Lang must be a text string')
    artifact.lang = pdfStringToText(lang)
    validateBcp47LanguageTag(artifact.lang, 'PDF Artifact Lang')
  }
  return artifact
}

function validateImportedObjectReference(
  context: ImportedStructureValidationContext,
  owner: PdfDict,
  objectReference: PdfDict,
  inheritedPage: PdfDict | null,
): void {
  const rawObject = objectReference.get('Obj')
  if (!(rawObject instanceof PdfRef)) throw new Error('PDF import error: OBJR /Obj must be an indirect reference')
  const object = context.doc.resolve(rawObject)
  const dictionary = object instanceof PdfStream ? object.dict : object instanceof Map ? object : null
  if (dictionary === null) throw new Error('PDF import error: OBJR /Obj must reference a dictionary or stream')
  const key = context.doc.resolve(dictionary.get('StructParent') ?? null)
  if (!Number.isInteger(key) || (key as number) < 0) throw new Error('PDF import error: OBJR target requires a non-negative /StructParent key')
  if (context.doc.resolve(context.parentTree.get(key as number) ?? null) !== owner) {
    throw new Error(`PDF import error: ParentTree key ${key} does not map the OBJR target to its structure element`)
  }
  const page = importedStructurePage(context, objectReference.get('Pg') ?? null) ?? inheritedPage
  const type = context.doc.resolve(dictionary.get('Type') ?? null)
  if (page === null && type instanceof PdfName && type.name === 'Annot') throw new Error('PDF import error: annotation OBJR requires a page')
}

function importedStructurePage(context: ImportedStructureValidationContext, value: PdfValue): PdfDict | null {
  const page = context.doc.resolve(value)
  if (page === null || page === undefined) return null
  if (!(page instanceof Map) || !context.pages.some(function (candidate) { return candidate.dict === page })) {
    throw new Error('PDF import error: structure /Pg must reference a document page')
  }
  return page
}

function validateImportedStructureIdTree(context: ImportedStructureValidationContext): void {
  const value = context.doc.resolve(context.root.get('IDTree') ?? null)
  if (value === null) {
    if (context.ids.size > 0) throw new Error('PDF import error: structure IDs require an /IDTree')
    return
  }
  if (!(value instanceof Map)) throw new Error('PDF import error: structure /IDTree must be a name tree')
  const entries: [string, PdfValue][] = []
  collectNameTreeEntries(context.doc, value, entries, new Set<PdfDict>())
  if (entries.length !== context.ids.size) throw new Error('PDF import error: IDTree does not contain every structure ID exactly once')
  const names = new Set<string>()
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i]![0]
    if (names.has(name)) throw new Error(`PDF import error: duplicate IDTree key ${name}`)
    names.add(name)
    if (context.doc.resolve(entries[i]![1]) !== context.ids.get(name)) {
      throw new Error(`PDF import error: IDTree key ${name} does not map to its structure element`)
    }
  }
}

function readImportedStructureAttributes(
  doc: PdfDocument,
  element: PdfDict,
  namespaceIndexes: Map<PdfDict, number>,
): { attributes: ImportedStructureAttribute[], userProperties: ImportedStructureUserProperty[] } {
  const attributes: ImportedStructureAttribute[] = []
  const userProperties: ImportedStructureUserProperty[] = []
  appendImportedAttributeSequence(doc, element.get('A') ?? null, undefined, namespaceIndexes, attributes, userProperties)
  const classes = doc.resolve(element.get('C') ?? null)
  if (classes === null) return { attributes, userProperties }
  const root = doc.resolve(doc.getCatalog().get('StructTreeRoot') ?? null)
  const classMap = root instanceof Map ? doc.resolve(root.get('ClassMap') ?? null) : null
  if (!(classMap instanceof Map)) throw new Error('PDF import error: structure /C requires a ClassMap')
  const items = Array.isArray(classes) ? classes : [classes]
  let lastClassAttributes: ImportedStructureAttribute[] = []
  let lastClassUserProperties: ImportedStructureUserProperty[] = []
  for (let i = 0; i < items.length; i++) {
    const item = doc.resolve(items[i]!)
    if (typeof item === 'number') {
      if (!Number.isInteger(item) || item < 0 || (lastClassAttributes.length === 0 && lastClassUserProperties.length === 0)) {
        throw new Error('PDF import error: structure class revision is invalid')
      }
      for (let k = 0; k < lastClassAttributes.length; k++) lastClassAttributes[k]!.revision = item
      for (let k = 0; k < lastClassUserProperties.length; k++) lastClassUserProperties[k]!.revision = item
      lastClassAttributes = []
      lastClassUserProperties = []
      continue
    }
    if (!(item instanceof PdfName)) throw new Error('PDF import error: structure /C must contain class names and revisions')
    const classValue = classMap.get(item.name)
    if (classValue === undefined) throw new Error(`PDF import error: structure class is missing from ClassMap: ${item.name}`)
    const start = attributes.length
    const userStart = userProperties.length
    appendImportedAttributeSequence(doc, classValue, item.name, namespaceIndexes, attributes, userProperties)
    lastClassAttributes = attributes.slice(start)
    lastClassUserProperties = userProperties.slice(userStart)
  }
  return { attributes, userProperties }
}

function appendImportedAttributeSequence(
  doc: PdfDocument,
  value: PdfValue,
  className: string | undefined,
  namespaceIndexes: Map<PdfDict, number>,
  attributes: ImportedStructureAttribute[],
  userProperties: ImportedStructureUserProperty[],
): void {
  const resolved = doc.resolve(value)
  if (resolved === null || resolved === undefined) return
  const items = Array.isArray(resolved) ? resolved : [resolved]
  let previous: ImportedStructureAttribute | undefined
  let previousUserStart = -1
  for (let i = 0; i < items.length; i++) {
    const item = doc.resolve(items[i]!)
    if (typeof item === 'number') {
      if (!Number.isInteger(item) || item < 0 || (previous === undefined && previousUserStart < 0) || previous?.revision !== undefined) {
        throw new Error('PDF import error: structure attribute revision is invalid')
      }
      if (previous !== undefined) previous.revision = item
      else for (let k = previousUserStart; k < userProperties.length; k++) userProperties[k]!.revision = item
      previous = undefined
      previousUserStart = -1
      continue
    }
    const stream = item instanceof PdfStream ? item : null
    const dictionary = stream !== null ? stream.dict : item instanceof Map ? item : null
    if (dictionary === null) throw new Error('PDF import error: structure attributes must be dictionaries, streams, and revisions')
    const owner = doc.resolve(dictionary.get('O') ?? null)
    if (!(owner instanceof PdfName)) throw new Error('PDF import error: structure attribute requires an /O owner')
    if (owner.name === 'UserProperties') {
      previousUserStart = userProperties.length
      appendImportedUserProperties(doc, dictionary, userProperties)
      previous = undefined
      continue
    }
    const entries: Record<string, PdfRawValueDef> = {}
    for (const [key, raw] of dictionary) {
      if (key === 'O' || key === 'NS' || key === 'Length'
        || (stream !== null && (key === 'Filter' || key === 'DecodeParms' || key === 'DL'))) continue
      entries[key] = rawPdfValue(doc, raw, new Set<object>())
    }
    const namespaceReference = dictionary.get('NS')
    const namespace = doc.resolve(namespaceReference ?? null)
    let namespaceIndex: number | undefined
    if (owner.name === 'NSO') {
      if (!(namespaceReference instanceof PdfRef) || !(namespace instanceof Map)) {
        throw new Error('PDF import error: NSO structure attribute requires an indirect /NS')
      }
      namespaceIndex = namespaceIndexes.get(namespace)
      if (namespaceIndex === undefined) throw new Error('PDF import error: NSO attribute namespace is not listed in /Namespaces')
    } else if (namespace !== null) {
      throw new Error('PDF import error: only NSO structure attributes may contain /NS')
    }
    previous = {
      owner: owner.name,
      entries,
      ...(namespaceIndex === undefined ? {} : { namespaceIndex }),
      ...(stream === null ? {} : { streamData: doc.decodeStream(stream) }),
      ...(className === undefined ? {} : { className }),
    }
    previousUserStart = -1
    attributes.push(previous)
  }
}

function appendImportedUserProperties(doc: PdfDocument, dictionary: PdfDict, out: ImportedStructureUserProperty[]): void {
  const properties = doc.resolve(dictionary.get('P') ?? null)
  if (!Array.isArray(properties) || properties.length === 0) throw new Error('PDF import error: UserProperties /P must be a non-empty array')
  const names = new Set<string>()
  for (let i = 0; i < properties.length; i++) {
    const property = doc.resolve(properties[i]!)
    if (!(property instanceof Map)) throw new Error(`PDF import error: UserProperties entry ${i} must be a dictionary`)
    const nameValue = doc.resolve(property.get('N') ?? null)
    const value = property.get('V')
    if (!(nameValue instanceof PdfString) || value === undefined) throw new Error(`PDF import error: UserProperties entry ${i} requires /N and /V`)
    const name = pdfStringToText(nameValue)
    if (name === '' || names.has(name)) throw new Error('PDF import error: UserProperties names must be non-empty and unique')
    names.add(name)
    const formatted = doc.resolve(property.get('F') ?? null)
    const hidden = doc.resolve(property.get('H') ?? null)
    if (formatted !== null && !(formatted instanceof PdfString)) throw new Error(`PDF import error: UserProperties entry ${i} /F must be a string`)
    if (hidden !== null && typeof hidden !== 'boolean') throw new Error(`PDF import error: UserProperties entry ${i} /H must be boolean`)
    out.push({
      name,
      value: rawPdfValue(doc, value, new Set<object>()),
      ...(formatted instanceof PdfString ? { formattedValue: pdfStringToText(formatted) } : {}),
      ...(typeof hidden === 'boolean' ? { hidden } : {}),
    })
  }
}

const PDF_ACTION_SUBTYPES = new Set<PdfActionSubtypeDef>([
  'GoTo', 'GoToR', 'GoToE', 'GoToDp', 'Launch', 'Thread', 'URI', 'Sound', 'Movie', 'Hide',
  'Named', 'SubmitForm', 'ResetForm', 'ImportData', 'JavaScript', 'SetOCGState',
  'Rendition', 'Trans', 'GoTo3DView', 'RichMediaExecute',
])

const PDF_DESTINATION_PARAMETER_COUNTS: Record<PdfDestinationFitDef, number> = {
  XYZ: 3, Fit: 0, FitH: 1, FitV: 1, FitR: 4, FitB: 0, FitBH: 1, FitBV: 1,
}

function readPdfDestination(
  doc: PdfDocument,
  pages: CollectedPage[],
  value: PdfValue,
  scope: 'local' | 'remote',
): PdfDestinationDef {
  const destination = doc.resolve(value)
  if (destination instanceof PdfString) {
    return { kind: 'named', name: pdfStringToText(destination), representation: 'string' }
  }
  if (destination instanceof PdfName) {
    return { kind: 'named', name: destination.name, representation: 'name' }
  }
  if (!Array.isArray(destination) || destination.length < 2) {
    throw new Error('PDF import error: explicit destination must be an array')
  }
  const fitValue = doc.resolve(destination[1]!)
  if (!(fitValue instanceof PdfName) || !(fitValue.name in PDF_DESTINATION_PARAMETER_COUNTS)) {
    throw new Error('PDF import error: explicit destination has an invalid fit name')
  }
  const fit = fitValue.name as PdfDestinationFitDef
  const parameterCount = PDF_DESTINATION_PARAMETER_COUNTS[fit]
  if (destination.length !== parameterCount + 2) {
    throw new Error(`PDF import error: /${fit} destination requires ${parameterCount} parameters`)
  }
  const parameters: (number | null)[] = []
  for (let i = 0; i < parameterCount; i++) {
    const parameter = doc.resolve(destination[i + 2]!)
    if (parameter === null) {
      if (fit === 'FitR') {
        throw new Error(`PDF import error: /FitR destination parameter ${i} must be a number`)
      }
      parameters.push(null)
      continue
    }
    if (typeof parameter !== 'number' || !Number.isFinite(parameter)) {
      throw new Error(`PDF import error: /${fit} destination parameter ${i} must be a number or null`)
    }
    parameters.push(parameter)
  }
  if (scope === 'local') {
    if (!(destination[0] instanceof PdfRef)) {
      throw new Error('PDF import error: local explicit destination must start with an indirect page reference')
    }
    return {
      kind: 'explicit',
      page: { kind: 'local', pageIndex: destinationPageIndex(doc, pages, destination[0]!) },
      fit,
      parameters,
    }
  }
  const pageNumber = doc.resolve(destination[0]!)
  if (typeof pageNumber !== 'number' || !Number.isInteger(pageNumber) || pageNumber < 0) {
    throw new Error('PDF import error: remote explicit destination must start with a non-negative page number')
  }
  return { kind: 'explicit', page: { kind: 'remote', pageNumber }, fit, parameters }
}

function readPdfStructureDestination(
  doc: PdfDocument,
  value: PdfValue,
  scope: 'local' | 'remote',
): PdfStructureDestinationDef {
  const destination = doc.resolve(value)
  if (!Array.isArray(destination) || destination.length < 2) {
    throw new Error('PDF import error: structure destination must be an array')
  }
  const fitValue = doc.resolve(destination[1]!)
  if (!(fitValue instanceof PdfName) || !(fitValue.name in PDF_DESTINATION_PARAMETER_COUNTS)) {
    throw new Error('PDF import error: structure destination has an invalid fit name')
  }
  const fit = fitValue.name as PdfDestinationFitDef
  const parameterCount = PDF_DESTINATION_PARAMETER_COUNTS[fit]
  if (destination.length !== parameterCount + 2) {
    throw new Error(`PDF import error: /${fit} structure destination requires ${parameterCount} parameters`)
  }
  const parameters: (number | null)[] = []
  for (let i = 0; i < parameterCount; i++) {
    const parameter = doc.resolve(destination[i + 2]!)
    if (parameter === null) {
      if (fit === 'FitR') {
        throw new Error(`PDF import error: /FitR structure destination parameter ${i} must be a number`)
      }
      parameters.push(null)
      continue
    }
    if (typeof parameter !== 'number' || !Number.isFinite(parameter)) {
      throw new Error(`PDF import error: /${fit} structure destination parameter ${i} must be a number or null`)
    }
    parameters.push(parameter)
  }
  if (scope === 'local') {
    const target = destination[0]
    if (!(target instanceof PdfRef)) throw new Error('PDF import error: local structure destination requires an indirect StructElem reference')
    return {
      target: { kind: 'local', structureElementIndex: structureElementIndexForRef(doc, target) },
      fit,
      parameters,
    }
  }
  const target = doc.resolve(destination[0]!)
  if (!(target instanceof PdfString)) throw new Error('PDF import error: remote structure destination requires a structure element ID string')
  return { target: { kind: 'remote', structureElementId: target.bytes.slice() }, fit, parameters }
}

function structureElementIndexForRef(doc: PdfDocument, target: PdfRef): number {
  const targetDictionary = doc.resolve(target)
  if (!(targetDictionary instanceof Map)) throw new Error('PDF import error: structure destination target must be a StructElem dictionary')
  const root = doc.resolve(doc.getCatalog().get('StructTreeRoot') ?? null)
  if (!(root instanceof Map)) throw new Error('PDF import error: structure destination requires a StructTreeRoot')
  let index = 0
  let found = -1
  const visited = new Set<PdfDict>()
  const visit = function (value: PdfValue): void {
    const resolved = doc.resolve(value)
    if (Array.isArray(resolved)) {
      for (let i = 0; i < resolved.length; i++) visit(resolved[i]!)
      return
    }
    if (!(resolved instanceof Map)) return
    const type = doc.resolve(resolved.get('Type') ?? null)
    const role = doc.resolve(resolved.get('S') ?? null)
    if (!(type instanceof PdfName) || type.name !== 'StructElem' || !(role instanceof PdfName)) return
    if (visited.has(resolved)) throw new Error('PDF import error: circular structure tree')
    visited.add(resolved)
    if (resolved === targetDictionary) found = index
    index++
    visit(resolved.get('K') ?? null)
  }
  visit(root.get('K') ?? null)
  if (found < 0) throw new Error('PDF import error: structure destination target is not in the StructTreeRoot hierarchy')
  return found
}

function readPdfAction(doc: PdfDocument, pages: CollectedPage[], value: PdfValue, path: Set<PdfDict>): PdfActionDef {
  const action = doc.resolve(value)
  if (!(action instanceof Map)) throw new Error('PDF import error: action must be a dictionary')
  if (path.has(action)) throw new Error('PDF import error: circular action /Next chain')
  path.add(action)
  const type = doc.resolve(action.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'Action')) {
    throw new Error('PDF import error: action /Type must be /Action')
  }
  const subtypeValue = doc.resolve(action.get('S') ?? null)
  if (!(subtypeValue instanceof PdfName) || !PDF_ACTION_SUBTYPES.has(subtypeValue.name as PdfActionSubtypeDef)) {
    throw new Error(`PDF import error: unsupported action subtype ${subtypeValue instanceof PdfName ? '/' + subtypeValue.name : String(subtypeValue)}`)
  }
  const entries: Record<string, PdfRawValueDef> = {}
  const subtype = subtypeValue.name as PdfActionSubtypeDef
  const hasDestination = subtype === 'GoTo' || subtype === 'GoToR' || subtype === 'GoToE'
  const hasStructureDestination = subtype === 'GoTo' || subtype === 'GoToR'
  const targetEntry = subtype === 'Movie' && action.has('Annotation') ? 'Annotation'
    : subtype === 'Rendition' ? 'AN'
    : subtype === 'GoTo3DView' || subtype === 'RichMediaExecute' ? 'TA' : null
  const threadReference = subtype === 'Thread' && action.get('D') instanceof PdfRef ? action.get('D') as PdfRef : undefined
  const beadReference = subtype === 'Thread' && action.get('B') instanceof PdfRef ? action.get('B') as PdfRef : undefined
  for (const [key, entry] of action) {
    if (key !== 'Type' && key !== 'S' && key !== 'Next'
      && !(hasDestination && key === 'D')
      && !(hasStructureDestination && key === 'SD')
      && !(targetEntry !== null && key === targetEntry)
      && !(subtype === 'SetOCGState' && key === 'State')
      && !(subtype === 'GoToDp' && key === 'Dp')
      && !(subtype === 'GoToE' && key === 'T')
      && !(subtype === 'Launch' && (key === 'Win' || key === 'Mac' || key === 'Unix'))
      && !(subtype === 'RichMediaExecute' && key === 'TI')
      && !(subtype === 'Hide' && key === 'T')
      && !((subtype === 'SubmitForm' || subtype === 'ResetForm') && key === 'Fields')
      && !(subtype === 'Thread' && ((key === 'D' && threadReference !== undefined) || (key === 'B' && beadReference !== undefined)))) {
      entries[key] = rawPdfValue(doc, entry, new Set<object>())
    }
  }
  const result: PdfActionDef = { subtype, entries }
  if (hasDestination) {
    const destination = action.get('D')
    if (destination === undefined) throw new Error(`PDF import error: /${subtype} action requires /D`)
    result.destination = readPdfDestination(doc, pages, destination, subtype === 'GoTo' ? 'local' : 'remote')
  }
  if (hasStructureDestination && action.has('SD')) {
    result.structureDestination = readPdfStructureDestination(doc, action.get('SD')!, subtype === 'GoTo' ? 'local' : 'remote')
  }
  let targetReference: PdfRef | undefined
  if (targetEntry !== null && action.has(targetEntry)) {
    const target = action.get(targetEntry)!
    if (!(target instanceof PdfRef)) throw new Error(`PDF import error: /${subtype} /${targetEntry} must be an indirect annotation reference`)
    targetReference = target
    const targetSubtypes = subtype === 'Movie' ? ['Movie'] : subtype === 'Rendition' ? ['Screen']
      : subtype === 'GoTo3DView' ? ['3D', 'RichMedia'] : ['RichMedia']
    result.annotationTarget = { entry: targetEntry, annotationIndex: annotationIndexForRef(doc, pages, target, targetSubtypes) }
  }
  if ((subtype === 'GoTo3DView' || subtype === 'RichMediaExecute') && result.annotationTarget === undefined) {
    throw new Error(`PDF import error: /${subtype} action requires /TA`)
  }
  if (subtype === 'SetOCGState') {
    const state = doc.resolve(action.get('State') ?? null)
    if (!Array.isArray(state) || state.length === 0) throw new Error('PDF import error: /SetOCGState action requires a non-empty /State array')
    result.optionalContentState = readOptionalContentState(doc, state)
  }
  if (subtype === 'GoToDp') {
    const documentPart = action.get('Dp')
    if (!(documentPart instanceof PdfRef)) throw new Error('PDF import error: /GoToDp action requires an indirect /Dp document-part reference')
    result.documentPartIndex = documentPartIndexForRef(doc, documentPart)
  }
  if (subtype === 'GoToE' && action.has('T')) result.embeddedTarget = readEmbeddedTarget(doc, action.get('T')!, new Set<PdfDict>())
  if (subtype === 'Launch') result.launchParameters = readLaunchPlatformParameters(doc, action)
  if (subtype === 'RichMediaExecute' && action.has('TI')) {
    const instance = action.get('TI')!
    if (!(instance instanceof PdfRef) || targetReference === undefined) {
      throw new Error('PDF import error: /RichMediaExecute /TI requires indirect /TA and /TI references')
    }
    result.richMediaInstanceIndex = richMediaInstanceIndexForRef(doc, targetReference, instance)
  }
  if (subtype === 'Hide') {
    const target = action.get('T')
    if (target === undefined) throw new Error('PDF import error: /Hide action requires /T')
    const resolved = doc.resolve(target)
    result.fieldTargets = { entry: 'T', names: readActionFieldNames(doc, target, '/Hide /T'), scalar: !Array.isArray(resolved) }
  } else if ((subtype === 'SubmitForm' || subtype === 'ResetForm') && action.has('Fields')) {
    result.fieldTargets = { entry: 'Fields', names: readActionFieldNames(doc, action.get('Fields')!, '/Fields'), scalar: false }
  }
  if (threadReference !== undefined) result.articleTarget = readArticleActionTarget(doc, threadReference, beadReference)
  validateImportedPdfAction(doc, action, result)
  if (action.has('Next')) {
    const nextRaw = action.get('Next')!
    const next = doc.resolve(nextRaw)
    if (Array.isArray(next)) {
      result.next = next.map(function (entry) { return readPdfAction(doc, pages, entry, path) })
    } else {
      result.next = readPdfAction(doc, pages, nextRaw, path)
    }
  }
  path.delete(action)
  return result
}

function validateImportedPdfAction(doc: PdfDocument, action: PdfDict, result: PdfActionDef): void {
  const subtype = result.subtype
  const resolved = function (key: string): PdfValue | undefined {
    const value = action.get(key)
    return value === undefined ? undefined : doc.resolve(value)
  }
  const requireFileSpecification = function (key: string): void {
    const value = resolved(key)
    if (!(value instanceof PdfString) && !(value instanceof Map)) {
      throw new Error(`PDF import error: /${subtype} action /${key} must be a file specification`)
    }
  }
  if (subtype === 'GoToR' || subtype === 'SubmitForm' || subtype === 'ImportData') requireFileSpecification('F')
  if (subtype === 'GoToE' && !action.has('F') && result.embeddedTarget === undefined) {
    throw new Error('PDF import error: /GoToE action requires /T when /F is absent')
  }
  if (subtype === 'Launch' && !action.has('F') && result.launchParameters === undefined) {
    throw new Error('PDF import error: /Launch action requires /F when no platform dictionary is present')
  }
  if (subtype === 'Launch' && action.has('F')) requireFileSpecification('F')
  if (subtype === 'Thread') {
    const destination = resolved('D')
    if (destination === undefined) throw new Error('PDF import error: /Thread action requires /D')
    if (!(destination instanceof Map) && !(destination instanceof PdfString)
      && (typeof destination !== 'number' || !Number.isInteger(destination))) {
      throw new Error('PDF import error: /Thread action /D must be a thread dictionary, integer, or text string')
    }
    const bead = resolved('B')
    if (bead !== undefined && !(bead instanceof Map) && (typeof bead !== 'number' || !Number.isInteger(bead))) {
      throw new Error('PDF import error: /Thread action /B must be a bead dictionary or integer')
    }
  }
  if (subtype === 'URI' && !(resolved('URI') instanceof PdfString)) {
    throw new Error('PDF import error: /URI action requires a string /URI')
  }
  if (subtype === 'Sound' && !(resolved('Sound') instanceof PdfStream)) {
    throw new Error('PDF import error: /Sound action requires a sound stream /Sound')
  }
  if (subtype === 'Movie') {
    const annotation = action.has('Annotation')
    const title = resolved('T')
    if (annotation === (title instanceof PdfString)) {
      throw new Error('PDF import error: /Movie action requires exactly one of /Annotation or string /T')
    }
  }
  if (subtype === 'Named' && !(resolved('N') instanceof PdfName)) {
    throw new Error('PDF import error: /Named action requires a name /N')
  }
  if (subtype === 'JavaScript') {
    const script = resolved('JS')
    if (!(script instanceof PdfString) && !(script instanceof PdfStream)) {
      throw new Error('PDF import error: /JavaScript action requires a string or stream /JS')
    }
  }
  if (subtype === 'Rendition') validateImportedRenditionAction(doc, action, result)
  if (subtype === 'Trans' && !(resolved('Trans') instanceof Map)) {
    throw new Error('PDF import error: /Trans action requires a transition dictionary /Trans')
  }
  if (subtype === 'GoTo3DView') {
    const view = resolved('V')
    if (!(view instanceof Map) && !(view instanceof PdfName) && !(view instanceof PdfString)
      && (typeof view !== 'number' || !Number.isInteger(view))) {
      throw new Error('PDF import error: /GoTo3DView action requires a view dictionary, integer, string, or name /V')
    }
  }
  if (subtype === 'RichMediaExecute') {
    const command = resolved('CMD')
    if (!(command instanceof Map)) throw new Error('PDF import error: /RichMediaExecute action requires a /CMD dictionary')
    if (!(doc.resolve(command.get('C') ?? null) instanceof PdfString)) {
      throw new Error('PDF import error: RichMedia /CMD requires a command string /C')
    }
  }
}

function validateImportedRenditionAction(doc: PdfDocument, action: PdfDict, result: PdfActionDef): void {
  const operation = doc.resolve(action.get('OP') ?? null)
  const script = doc.resolve(action.get('JS') ?? null)
  if (operation === null && !(script instanceof PdfString) && !(script instanceof PdfStream)) {
    throw new Error('PDF import error: /Rendition action requires integer /OP or string/stream /JS')
  }
  if (operation !== null && (typeof operation !== 'number' || !Number.isInteger(operation) || operation < 0 || operation > 4)) {
    throw new Error('PDF import error: /Rendition /OP must be an integer from 0 through 4')
  }
  if ((operation === 0 || operation === 4) && !(doc.resolve(action.get('R') ?? null) instanceof Map)) {
    throw new Error(`PDF import error: /Rendition /R is required for operation ${operation}`)
  }
  if (typeof operation === 'number' && result.annotationTarget === undefined) {
    throw new Error(`PDF import error: /Rendition /AN is required for operation ${operation}`)
  }
}

function readLaunchPlatformParameters(doc: PdfDocument, action: PdfDict): PdfLaunchPlatformParametersDef | undefined {
  const result: PdfLaunchPlatformParametersDef = {}
  const windows = doc.resolve(action.get('Win') ?? null)
  if (windows !== null) {
    if (!(windows instanceof Map)) throw new Error('PDF import error: Launch /Win must be a dictionary')
    result.windows = readWindowsLaunchParameters(doc, windows)
  }
  const mac = doc.resolve(action.get('Mac') ?? null)
  if (mac !== null) {
    if (!(mac instanceof Map)) throw new Error('PDF import error: Launch /Mac must be a dictionary')
    result.mac = rawPdfDictionary(doc, mac, new Set<object>())
  }
  const unix = doc.resolve(action.get('Unix') ?? null)
  if (unix !== null) {
    if (!(unix instanceof Map)) throw new Error('PDF import error: Launch /Unix must be a dictionary')
    result.unix = rawPdfDictionary(doc, unix, new Set<object>())
  }
  return result.windows === undefined && result.mac === undefined && result.unix === undefined ? undefined : result
}

function readWindowsLaunchParameters(doc: PdfDocument, dictionary: PdfDict): PdfWindowsLaunchParametersDef {
  const file = readLaunchByteString(doc, dictionary.get('F'), '/Win /F', true)!
  const defaultDirectory = readLaunchByteString(doc, dictionary.get('D'), '/Win /D', false)
  const operation = readLaunchByteString(doc, dictionary.get('O'), '/Win /O', false)
  const parameters = readLaunchByteString(doc, dictionary.get('P'), '/Win /P', false)
  return {
    file,
    ...(defaultDirectory === undefined ? {} : { defaultDirectory }),
    ...(operation === undefined ? {} : { operation }),
    ...(parameters === undefined ? {} : { parameters }),
  }
}

function readLaunchByteString(doc: PdfDocument, value: PdfValue | undefined, label: string, required: boolean): Uint8Array | undefined {
  if (value === undefined) {
    if (required) throw new Error(`PDF import error: Launch ${label} is required`)
    return undefined
  }
  const resolved = doc.resolve(value)
  if (!(resolved instanceof PdfString)) throw new Error(`PDF import error: Launch ${label} must be a byte string`)
  return resolved.bytes.slice()
}

function richMediaInstanceIndexForRef(doc: PdfDocument, annotationRef: PdfRef, instanceRef: PdfRef): number {
  const annotation = doc.resolve(annotationRef)
  if (!(annotation instanceof Map)) throw new Error('PDF import error: RichMediaExecute /TA must reference an annotation dictionary')
  const content = doc.resolve(annotation.get('RichMediaContent') ?? null)
  if (!(content instanceof Map)) throw new Error('PDF import error: RichMedia target annotation requires /RichMediaContent')
  const configurations = doc.resolve(content.get('Configurations') ?? null)
  if (!Array.isArray(configurations)) throw new Error('PDF import error: RichMediaContent requires /Configurations')
  let index = 0
  for (let i = 0; i < configurations.length; i++) {
    const configuration = doc.resolve(configurations[i]!)
    if (!(configuration instanceof Map)) throw new Error('PDF import error: RichMedia configuration must be a dictionary')
    const instances = doc.resolve(configuration.get('Instances') ?? null)
    if (!Array.isArray(instances)) throw new Error('PDF import error: RichMedia configuration requires /Instances')
    for (let j = 0; j < instances.length; j++) {
      const candidate = instances[j]
      if (candidate instanceof PdfRef && candidate.num === instanceRef.num && candidate.gen === instanceRef.gen) return index
      index++
    }
  }
  throw new Error(`PDF import error: RichMediaExecute /TI ${instanceRef.num} ${instanceRef.gen} R is not an instance of /TA`)
}

function readEmbeddedTarget(doc: PdfDocument, value: PdfValue, path: Set<PdfDict>): PdfEmbeddedTargetDef {
  const dictionary = doc.resolve(value)
  if (!(dictionary instanceof Map)) throw new Error('PDF import error: embedded GoTo target must be a dictionary')
  if (path.has(dictionary)) throw new Error('PDF import error: circular embedded GoTo target chain')
  path.add(dictionary)
  const relationship = doc.resolve(dictionary.get('R') ?? null)
  if (!(relationship instanceof PdfName) || (relationship.name !== 'C' && relationship.name !== 'P')) {
    throw new Error('PDF import error: embedded GoTo target /R must be /C or /P')
  }
  const result: PdfEmbeddedTargetDef = { relationship: relationship.name }
  const name = doc.resolve(dictionary.get('N') ?? null)
  if (name !== null) {
    if (!(name instanceof PdfString)) throw new Error('PDF import error: embedded GoTo target /N must be a byte string')
    result.name = name.bytes.slice()
  }
  if (dictionary.has('P')) result.page = readEmbeddedTargetSelector(doc, dictionary.get('P')!, '/P')
  if (dictionary.has('A')) result.annotation = readEmbeddedTargetSelector(doc, dictionary.get('A')!, '/A')
  if (relationship.name === 'P') {
    if (result.name !== undefined || result.page !== undefined || result.annotation !== undefined) {
      throw new Error('PDF import error: parent embedded GoTo target must not contain /N, /P, or /A')
    }
  } else {
    const nameTreeTarget = result.name !== undefined && result.page === undefined && result.annotation === undefined
    const annotationTarget = result.name === undefined && result.page !== undefined && result.annotation !== undefined
    if (!nameTreeTarget && !annotationTarget) {
      throw new Error('PDF import error: child embedded GoTo target requires either /N or both /P and /A')
    }
  }
  if (dictionary.has('T')) result.target = readEmbeddedTarget(doc, dictionary.get('T')!, path)
  path.delete(dictionary)
  return result
}

function readEmbeddedTargetSelector(doc: PdfDocument, value: PdfValue, label: string): PdfEmbeddedTargetSelectorDef {
  const resolved = doc.resolve(value)
  if (typeof resolved === 'number' && Number.isInteger(resolved) && resolved >= 0) return resolved
  if (resolved instanceof PdfString) return { kind: 'string', bytes: resolved.bytes.slice() }
  throw new Error(`PDF import error: embedded GoTo target ${label} must be a non-negative integer or byte string`)
}

function readOptionalContentState(doc: PdfDocument, values: PdfValue[]): PdfOptionalContentStateDef[] {
  const result: PdfOptionalContentStateDef[] = []
  let hasOperator = false
  let groupsForOperator = 0
  for (let i = 0; i < values.length; i++) {
    const raw = values[i]!
    const value = doc.resolve(raw)
    if (value instanceof PdfName && (value.name === 'ON' || value.name === 'OFF' || value.name === 'Toggle')) {
      if (hasOperator && groupsForOperator === 0) {
        throw new Error('PDF import error: each /SetOCGState operator requires at least one OCG')
      }
      result.push({ kind: 'operator', value: value.name })
      hasOperator = true
      groupsForOperator = 0
      continue
    }
    if (!(raw instanceof PdfRef)) throw new Error(`PDF import error: /SetOCGState /State[${i}] must be an operator or OCG reference`)
    if (!hasOperator) throw new Error('PDF import error: /SetOCGState /State must begin with an operator')
    if (!(value instanceof Map)) throw new Error(`PDF import error: /SetOCGState /State[${i}] must reference an OCG dictionary`)
    const type = doc.resolve(value.get('Type') ?? null)
    if (!(type instanceof PdfName) || type.name !== 'OCG') throw new Error(`PDF import error: /SetOCGState /State[${i}] must reference /Type /OCG`)
    result.push({ kind: 'group', groupId: `ocg-${raw.num}-${raw.gen}` })
    groupsForOperator++
  }
  if (groupsForOperator === 0) throw new Error('PDF import error: each /SetOCGState operator requires at least one OCG')
  return result
}

function documentPartIndexForRef(doc: PdfDocument, target: PdfRef): number {
  const root = doc.resolve(doc.getCatalog().get('DPartRoot') ?? null)
  if (!(root instanceof Map)) throw new Error('PDF import error: /GoToDp requires a catalog /DPartRoot')
  const rootNode = doc.resolve(root.get('DPartRootNode') ?? null)
  if (!(rootNode instanceof Map)) throw new Error('PDF import error: /DPartRoot requires /DPartRootNode')
  const refs: PdfRef[] = []
  collectDocumentPartRefs(doc, rootNode, refs, new Set<PdfDict>())
  for (let i = 0; i < refs.length; i++) {
    if (refs[i]!.num === target.num && refs[i]!.gen === target.gen) return i
  }
  throw new Error(`PDF import error: /GoToDp target ${target.num} ${target.gen} R is not in the document-part hierarchy`)
}

function collectDocumentPartRefs(doc: PdfDocument, parent: PdfDict, out: PdfRef[], visited: Set<PdfDict>): void {
  if (visited.has(parent)) throw new Error('PDF import error: circular document-part hierarchy')
  visited.add(parent)
  const children = doc.resolve(parent.get('DParts') ?? null)
  if (children === null) return
  if (!Array.isArray(children)) throw new Error('PDF import error: document-part /DParts must be an array')
  for (let groupIndex = 0; groupIndex < children.length; groupIndex++) {
    const group = doc.resolve(children[groupIndex]!)
    if (!Array.isArray(group) || group.length === 0) {
      throw new Error('PDF import error: document-part child groups must be non-empty arrays')
    }
    for (let childIndex = 0; childIndex < group.length; childIndex++) {
      const ref = group[childIndex]
      if (!(ref instanceof PdfRef)) throw new Error('PDF import error: document-part children must be indirect references')
      const child = doc.resolve(ref)
      if (!(child instanceof Map)) throw new Error('PDF import error: document-part child must be a dictionary')
      out.push(ref)
      collectDocumentPartRefs(doc, child, out, visited)
    }
  }
}

function readArticleActionTarget(doc: PdfDocument, threadRef: PdfRef, beadRef: PdfRef | undefined): { threadIndex: number, beadIndex?: number } {
  const threads = doc.resolve(doc.getCatalog().get('Threads') ?? null)
  if (!Array.isArray(threads)) throw new Error('PDF import error: Thread action reference requires catalog /Threads')
  let threadIndex = -1
  for (let i = 0; i < threads.length; i++) {
    const candidate = threads[i]
    if (candidate instanceof PdfRef && candidate.num === threadRef.num && candidate.gen === threadRef.gen) {
      threadIndex = i
      break
    }
  }
  if (threadIndex < 0) throw new Error('PDF import error: Thread action /D reference is not in catalog /Threads')
  if (beadRef === undefined) return { threadIndex }
  const thread = doc.resolve(threadRef)
  if (!(thread instanceof Map)) throw new Error('PDF import error: article thread must be a dictionary')
  let current = thread.get('F')
  const visited = new Set<string>()
  let beadIndex = 0
  while (current instanceof PdfRef) {
    const key = `${current.num}:${current.gen}`
    if (visited.has(key)) break
    visited.add(key)
    if (current.num === beadRef.num && current.gen === beadRef.gen) return { threadIndex, beadIndex }
    const bead = doc.resolve(current)
    if (!(bead instanceof Map)) throw new Error('PDF import error: article bead must be a dictionary')
    current = bead.get('N')
    beadIndex++
  }
  throw new Error('PDF import error: Thread action /B reference is not a bead of /D')
}

function readAdditionalActionModels(doc: PdfDocument, pages: CollectedPage[], dictionary: PdfDict, label: string): Record<string, PdfActionDef> {
  const result: Record<string, PdfActionDef> = {}
  for (const [trigger, value] of dictionary) {
    try {
      result[trigger] = readPdfAction(doc, pages, value, new Set<PdfDict>())
    } catch (error) {
      if (error instanceof Error) throw new Error(`PDF import error: ${label} /${trigger}: ${error.message}`)
      throw error
    }
  }
  return result
}

function readImportedLinkAction(doc: PdfDocument, action: PdfDict): ImportedLinkAction | null {
  const subtype = doc.resolve(action.get('S') ?? null)
  if (!(subtype instanceof PdfName)) throw new Error('PDF import error: Link annotation action requires /S')
  if (subtype.name === 'URI' || subtype.name === 'GoTo' || subtype.name === 'GoToR' || subtype.name === 'Named') return null
  if (subtype.name === 'Launch') {
    const file = readActionFileName(doc, action.get('F') ?? null)
    const newWindow = doc.resolve(action.get('NewWindow') ?? null)
    return { type: 'launch', file, ...(typeof newWindow === 'boolean' ? { newWindow } : {}) }
  }
  if (subtype.name === 'Hide') {
    const targets = readActionFieldNames(doc, action.get('T') ?? null, '/Hide /T')
    const hide = doc.resolve(action.get('H') ?? null)
    return { type: 'hide', targets, hide: typeof hide === 'boolean' ? hide : true }
  }
  if (subtype.name === 'SubmitForm') {
    const url = readActionFileName(doc, action.get('F') ?? null)
    const fields = readOptionalActionFields(doc, action.get('Fields') ?? null)
    const flags = doc.resolve(action.get('Flags') ?? null)
    return { type: 'submitForm', url, ...(fields === undefined ? {} : { fields }), ...(typeof flags === 'number' ? { flags } : {}) }
  }
  if (subtype.name === 'ResetForm') {
    const fields = readOptionalActionFields(doc, action.get('Fields') ?? null)
    const flags = doc.resolve(action.get('Flags') ?? null)
    return { type: 'resetForm', ...(fields === undefined ? {} : { fields }), ...(typeof flags === 'number' ? { flags } : {}) }
  }
  return null
}

function readActionFileName(doc: PdfDocument, value: PdfValue): string {
  const resolved = doc.resolve(value)
  if (resolved instanceof PdfString) return pdfStringToText(resolved)
  if (resolved instanceof Map) {
    const uf = doc.resolve(resolved.get('UF') ?? resolved.get('F') ?? null)
    if (uf instanceof PdfString) return pdfStringToText(uf)
  }
  throw new Error('PDF import error: action file specification requires /F or /UF')
}

function readOptionalActionFields(doc: PdfDocument, value: PdfValue): string[] | undefined {
  if (doc.resolve(value) === null) return undefined
  return readActionFieldNames(doc, value, '/Fields')
}

function readActionFieldNames(doc: PdfDocument, value: PdfValue, label: string): string[] {
  const resolved = doc.resolve(value)
  const values = Array.isArray(resolved) ? resolved : [resolved]
  const names: string[] = []
  for (let i = 0; i < values.length; i++) {
    const field = doc.resolve(values[i]!)
    if (field instanceof PdfString) names.push(pdfStringToText(field))
    else if (field instanceof Map) {
      const name = doc.resolve(field.get('T') ?? null)
      if (!(name instanceof PdfString)) throw new Error(`PDF import error: ${label} field dictionary requires /T`)
      names.push(pdfStringToText(name))
    } else throw new Error(`PDF import error: ${label} must contain field names or dictionaries`)
  }
  return names
}

function importedAnnotationBorderStyle(name: string): 'solid' | 'dashed' | 'beveled' | 'inset' | 'underline' {
  if (name === 'S') return 'solid'
  if (name === 'D') return 'dashed'
  if (name === 'B') return 'beveled'
  if (name === 'I') return 'inset'
  if (name === 'U') return 'underline'
  throw new Error(`PDF import error: unsupported annotation border style /${name}`)
}

export function getPdfPageCount(bytes: Uint8Array, options?: Pick<PdfImportOptions, 'password'>): number {
  return PdfImporter.open(bytes, options).pageCount
}

export function importPdfPage(bytes: Uint8Array, pageIndex: number, options?: PdfImportOptions): ImportedPage {
  return PdfImporter.open(bytes, options).importPage(pageIndex, options)
}

function reportProgress(
  onProgress: PdfImportProgressCallback | undefined,
  stage: PdfImportProgressStage,
  done: number,
  total: number,
  pageIndex?: number,
): void {
  if (onProgress === undefined) return
  const progress: PdfImportProgress = { stage, done, total }
  if (pageIndex !== undefined) progress.pageIndex = pageIndex
  onProgress(progress)
}

function resolveBox(doc: PdfDocument, value: PdfValue, label: string): { x1: number; y1: number; x2: number; y2: number } {
  const box = doc.resolve(value)
  if (!Array.isArray(box) || box.length !== 4) {
    throw new Error(`PDF import error: /${label} must be an array of four numbers`)
  }
  const xa = numberAt(doc, box, 0, label)
  const ya = numberAt(doc, box, 1, label)
  const xb = numberAt(doc, box, 2, label)
  const yb = numberAt(doc, box, 3, label)
  return { x1: Math.min(xa, xb), y1: Math.min(ya, yb), x2: Math.max(xa, xb), y2: Math.max(ya, yb) }
}

function numberAt(doc: PdfDocument, values: PdfValue[], index: number, label: string): number {
  const value = doc.resolve(values[index]!)
  if (typeof value !== 'number') {
    throw new Error(`PDF import error: /${label}[${index}] must be a number`)
  }
  return value
}

function normalizeRotate(value: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value % 90 !== 0) {
    throw new Error(`PDF import error: page Rotate must be an integer multiple of 90, got ${value}`)
  }
  const normalized = ((value % 360) + 360) % 360
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) return normalized
  throw new Error(`PDF import error: invalid page rotation ${value}`)
}

function readPageUserUnit(doc: PdfDocument, page: CollectedPage): number {
  const value = doc.resolve(page.dict.get('UserUnit') ?? null)
  if (value === null) return 1
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('PDF import error: page UserUnit must be a positive finite number')
  }
  return value
}

function readPageRotate(doc: PdfDocument, page: CollectedPage): 0 | 90 | 180 | 270 {
  const value = doc.resolve(page.rotate)
  if (value === null) return 0
  if (typeof value !== 'number') throw new Error('PDF import error: page Rotate must be a number')
  return normalizeRotate(value)
}

function pageContentStreamCount(doc: PdfDocument, page: CollectedPage): number {
  const value = doc.resolve(page.dict.get('Contents') ?? null)
  if (value === null) return 0
  if (value instanceof PdfStream) return 1
  if (!Array.isArray(value)) throw new Error('PDF import error: page Contents must be a stream or stream array')
  for (let i = 0; i < value.length; i++) {
    if (!(doc.resolve(value[i]!) instanceof PdfStream)) {
      throw new Error(`PDF import error: page content array item ${i} is not a stream`)
    }
  }
  return value.length
}

function readPageTransition(doc: PdfDocument, dict: PdfDict): PdfPageTransitionDef {
  const type = doc.resolve(dict.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'Trans')) {
    throw new Error('PDF import error: transition Type must be /Trans')
  }
  const result: PdfPageTransitionDef = {}
  const style = doc.resolve(dict.get('S') ?? null)
  if (style !== null) {
    if (!(style instanceof PdfName) || !PAGE_TRANSITION_STYLES.has(style.name)) {
      throw new Error('PDF import error: invalid page transition style')
    }
    result.style = style.name as PdfPageTransitionDef['style']
  }
  const duration = doc.resolve(dict.get('D') ?? null)
  if (duration !== null) {
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      throw new Error('PDF import error: transition D must be a non-negative finite number')
    }
    result.duration = duration
  }
  const dimension = doc.resolve(dict.get('Dm') ?? null)
  if (dimension !== null) {
    if (!(dimension instanceof PdfName) || (dimension.name !== 'H' && dimension.name !== 'V')) {
      throw new Error('PDF import error: transition Dm must be /H or /V')
    }
    result.dimension = dimension.name
  }
  const motion = doc.resolve(dict.get('M') ?? null)
  if (motion !== null) {
    if (!(motion instanceof PdfName) || (motion.name !== 'I' && motion.name !== 'O')) {
      throw new Error('PDF import error: transition M must be /I or /O')
    }
    result.motion = motion.name
  }
  const direction = doc.resolve(dict.get('Di') ?? null)
  if (direction !== null) {
    if (direction instanceof PdfName) {
      if (direction.name !== 'None') throw new Error('PDF import error: transition Di name must be /None')
      result.direction = 'None'
    } else if (typeof direction === 'number' && PAGE_TRANSITION_DIRECTIONS.has(direction)) {
      result.direction = direction
    } else {
      throw new Error('PDF import error: transition Di must be 0, 90, 180, 270, 315, or /None')
    }
  }
  const scale = doc.resolve(dict.get('SS') ?? null)
  if (scale !== null) {
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0 || scale > 1) {
      throw new Error('PDF import error: transition SS must be between 0 and 1')
    }
    result.scale = scale
  }
  const rectangular = doc.resolve(dict.get('B') ?? null)
  if (rectangular !== null) {
    if (typeof rectangular !== 'boolean') throw new Error('PDF import error: transition B must be boolean')
    result.rectangular = rectangular
  }
  return result
}

const PAGE_TRANSITION_STYLES = new Set([
  'Split', 'Blinds', 'Box', 'Wipe', 'Dissolve', 'Glitter', 'R', 'Fly', 'Push', 'Cover', 'Uncover', 'Fade',
])
const PAGE_TRANSITION_DIRECTIONS = new Set([0, 90, 180, 270, 315])
const FORM_FIELD_TYPES = new Set(['Btn', 'Tx', 'Ch', 'Sig'])

function formFieldFlagNames(type: string, flags: number): ImportedFormFieldFlag[] {
  const names: ImportedFormFieldFlag[] = []
  if ((flags & 1) !== 0) names.push('ReadOnly')
  if ((flags & 2) !== 0) names.push('Required')
  if ((flags & 4) !== 0) names.push('NoExport')
  if (type === 'Btn') {
    if ((flags & (1 << 14)) !== 0) names.push('NoToggleToOff')
    if ((flags & (1 << 15)) !== 0) names.push('Radio')
    if ((flags & (1 << 16)) !== 0) names.push('Pushbutton')
    if ((flags & (1 << 25)) !== 0) names.push('RadiosInUnison')
  } else if (type === 'Tx') {
    if ((flags & (1 << 12)) !== 0) names.push('Multiline')
    if ((flags & (1 << 13)) !== 0) names.push('Password')
    if ((flags & (1 << 20)) !== 0) names.push('FileSelect')
    if ((flags & (1 << 22)) !== 0) names.push('DoNotSpellCheck')
    if ((flags & (1 << 23)) !== 0) names.push('DoNotScroll')
    if ((flags & (1 << 24)) !== 0) names.push('Comb')
    if ((flags & (1 << 25)) !== 0) names.push('RichText')
  } else if (type === 'Ch') {
    if ((flags & (1 << 17)) !== 0) names.push('Combo')
    if ((flags & (1 << 18)) !== 0) names.push('Edit')
    if ((flags & (1 << 19)) !== 0) names.push('Sort')
    if ((flags & (1 << 21)) !== 0) names.push('MultiSelect')
    if ((flags & (1 << 22)) !== 0) names.push('DoNotSpellCheck')
    if ((flags & (1 << 26)) !== 0) names.push('CommitOnSelChange')
  }
  return names
}

function preservedFormFieldEntries(doc: PdfDocument, dict: PdfDict): Record<string, PdfRawValueDef> {
  const entries: Record<string, PdfRawValueDef> = {}
  for (const [key, value] of dict) {
    if (key === 'Parent' || key === 'Kids' || key === 'P') continue
    entries[key] = rawPdfValue(doc, value, new Set<object>())
  }
  return entries
}

function buildPageInitialMatrix(
  box: { x1: number; y1: number; x2: number; y2: number },
  userUnit: number,
  rotate: 0 | 90 | 180 | 270,
): Matrix {
  if (rotate === 0) return [userUnit, 0, 0, userUnit, -box.x1 * userUnit, -box.y1 * userUnit]
  if (rotate === 90) return [0, -userUnit, userUnit, 0, -box.y1 * userUnit, box.x2 * userUnit]
  if (rotate === 180) return [-userUnit, 0, 0, -userUnit, box.x2 * userUnit, box.y2 * userUnit]
  return [0, userUnit, -userUnit, 0, box.y2 * userUnit, -box.x1 * userUnit]
}

function processAnnotations(
  doc: PdfDocument,
  pages: CollectedPage[],
  page: CollectedPage,
  initialMatrix: Matrix,
  pageHeight: number,
  elements: ElementDef[],
  interpreter: PdfContentInterpreter,
  intent: 'screen' | 'print',
): void {
  const annotsValue = doc.resolve(page.dict.get('Annots') ?? null)
  if (annotsValue === null) return
  if (!Array.isArray(annotsValue)) throw new Error('PDF import error: /Annots must be an array')
  for (let i = 0; i < annotsValue.length; i++) {
    const annotValue = doc.resolve(annotsValue[i]!)
    if (!(annotValue instanceof Map)) throw new Error(`PDF import error: annotation ${i} must be a dictionary`)
    const subtype = doc.resolve(annotValue.get('Subtype') ?? null)
    if (!(subtype instanceof PdfName)) throw new Error(`PDF import error: annotation ${i} has no subtype`)
    if (!annotationIsVisible(doc, annotValue, subtype, intent)) continue
    const optionalValue = annotValue.get('OC')
    const optionalContent = optionalValue === undefined ? null : interpreter.readOptionalContent(optionalValue)
    const optionalStart = elements.length
    if (subtype.name === 'Link') {
      renderAnnotationAppearance(doc, annotValue, subtype, initialMatrix, interpreter, intent)
      const hyperlink = readLinkHyperlink(doc, pages, annotValue, pages.indexOf(page))
      if (hyperlink !== null) {
        const rect = readAnnotationRect(doc, annotValue, initialMatrix, pageHeight)
        const frame: FrameDef = {
          type: 'frame',
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          hyperlink,
          elements: [],
        }
        elements.push(frame)
      }
      if (optionalContent !== null) wrapAnnotationOptionalContent(elements, optionalStart, optionalContent)
      continue
    }
    if (subtype.name === 'Popup') continue
    renderAnnotationAppearance(doc, annotValue, subtype, initialMatrix, interpreter, intent)
    if (optionalContent !== null) wrapAnnotationOptionalContent(elements, optionalStart, optionalContent)
  }
}

function wrapAnnotationOptionalContent(elements: ElementDef[], start: number, optionalContent: NonNullable<ElementDef['optionalContent']>): void {
  if (start === elements.length) return
  const children = elements.splice(start)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    minX = Math.min(minX, child.x)
    minY = Math.min(minY, child.y)
    maxX = Math.max(maxX, child.x + child.width)
    maxY = Math.max(maxY, child.y + child.height)
  }
  for (let i = 0; i < children.length; i++) {
    children[i]!.x -= minX
    children[i]!.y -= minY
  }
  elements.push({ type: 'frame', x: minX, y: minY, width: maxX - minX, height: maxY - minY, optionalContent, elements: children })
}

/** Annotation flags (PDF 12.5.3): Invisible, Hidden, Print, NoView. */
const ANNOTATION_INVISIBLE = 0x01
const ANNOTATION_HIDDEN = 0x02
const ANNOTATION_PRINT = 0x04
const ANNOTATION_NO_VIEW = 0x20

const STANDARD_ANNOTATION_SUBTYPES = new Set([
  'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine',
  'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink',
  'Popup', 'FileAttachment', 'Sound', 'Movie', 'Widget', 'Screen', 'PrinterMark',
  'TrapNet', 'Watermark', '3D', 'Redact', 'Projection', 'RichMedia',
])

const IMPORTED_ANNOTATION_MODELED_KEYS = new Set([
  'Type', 'Subtype', 'Rect', 'P', 'Contents', 'NM', 'M', 'F', 'C', 'CA', 'BS', 'BE',
  'A', 'Dest', 'AA', 'AP', 'AS', 'AF', 'Popup', 'Parent', 'IRT',
])

function readImported3DArtwork(doc: PdfDocument, annotation: PdfDict, annotationIndex: number): Imported3DArtwork {
  const artwork = doc.resolve(annotation.get('3DD') ?? null)
  if (!(artwork instanceof PdfStream)) throw new Error(`PDF import error: 3D annotation ${annotationIndex} requires a /3DD stream`)
  const type = doc.resolve(artwork.dict.get('Type') ?? null)
  if (!(type instanceof PdfName) || type.name !== '3D') throw new Error(`PDF import error: 3D annotation ${annotationIndex} /3DD requires /Type /3D`)
  const subtype = doc.resolve(artwork.dict.get('Subtype') ?? null)
  if (!(subtype instanceof PdfName) || (subtype.name !== 'U3D' && subtype.name !== 'PRC')) {
    throw new Error(`PDF import error: 3D annotation ${annotationIndex} /3DD Subtype must be /U3D or /PRC`)
  }
  const data = doc.decodeStream(artwork)
  const result: Imported3DArtwork = {
    format: subtype.name,
    data,
    scene: subtype.name === 'U3D' ? decodeU3dScene(data) : decodePrcScene(data),
    activateOnPageOpen: false,
  }
  const view = doc.resolve(annotation.get('3DV') ?? null)
  if (view instanceof Map) {
    const externalName = doc.resolve(view.get('XN') ?? null)
    if (externalName !== null) {
      if (!(externalName instanceof PdfString)) throw new Error(`PDF import error: 3D annotation ${annotationIndex} /3DV /XN must be a string`)
      result.viewName = pdfStringToText(externalName)
    }
  } else if (view !== null && !(view instanceof PdfName) && typeof view !== 'number') {
    throw new Error(`PDF import error: 3D annotation ${annotationIndex} /3DV must be a name, integer, or dictionary`)
  }
  const activation = doc.resolve(annotation.get('3DA') ?? null)
  if (activation !== null) {
    if (!(activation instanceof Map)) throw new Error(`PDF import error: 3D annotation ${annotationIndex} /3DA must be a dictionary`)
    const mode = doc.resolve(activation.get('A') ?? null)
    if (mode !== null && (!(mode instanceof PdfName) || (mode.name !== 'PO' && mode.name !== 'PV' && mode.name !== 'XA'))) {
      throw new Error(`PDF import error: 3D annotation ${annotationIndex} /3DA /A is invalid`)
    }
    result.activateOnPageOpen = mode instanceof PdfName && mode.name === 'PO'
  }
  return result
}

function validateImportedPrepressAnnotation(
  doc: PdfDocument,
  annotation: PdfDict,
  subtype: PdfName,
  annotationCount: number,
  annotationIndex: number,
): void {
  if (subtype.name !== 'PrinterMark' && subtype.name !== 'TrapNet') return
  const flags = doc.resolve(annotation.get('F') ?? null)
  if (flags !== 68) throw new Error(`PDF import error: ${subtype.name} annotation flags must be Print and ReadOnly only`)
  const appearance = doc.resolve(annotation.get('AP') ?? null)
  if (!(appearance instanceof Map)) throw new Error(`PDF import error: ${subtype.name} annotation requires /AP`)
  const normal = doc.resolve(appearance.get('N') ?? null)
  if (!(normal instanceof PdfStream) && !(normal instanceof Map)) {
    throw new Error(`PDF import error: ${subtype.name} annotation /AP /N must be a stream or dictionary`)
  }
  const state = doc.resolve(annotation.get('AS') ?? null)
  if (normal instanceof Map) {
    if (normal.size === 0) throw new Error(`PDF import error: ${subtype.name} annotation normal appearances must not be empty`)
    if (subtype.name === 'TrapNet' || normal.size > 1) {
      if (!(state instanceof PdfName)) throw new Error(`PDF import error: ${subtype.name} annotation requires /AS`)
      if (!normal.has(state.name)) throw new Error(`PDF import error: ${subtype.name} annotation /AS does not select a normal appearance`)
    }
  }
  if (subtype.name === 'PrinterMark') {
    const markName = doc.resolve(annotation.get('MN') ?? null)
    if (markName !== null && !(markName instanceof PdfName)) throw new Error('PDF import error: PrinterMark /MN must be a name')
    return
  }
  if (annotationIndex !== annotationCount - 1) throw new Error('PDF import error: TrapNet annotation must be last in /Annots')
  if (!(state instanceof PdfName)) throw new Error('PDF import error: TrapNet annotation requires /AS')
  const lastModified = doc.resolve(annotation.get('LastModified') ?? null)
  const version = doc.resolve(annotation.get('Version') ?? null)
  const annotationStates = doc.resolve(annotation.get('AnnotStates') ?? null)
  const hasDate = lastModified !== null
  const hasVersion = version !== null || annotationStates !== null
  if (hasDate === hasVersion) throw new Error('PDF import error: TrapNet requires exactly one invalidation method')
  if (hasDate && !(lastModified instanceof PdfString)) throw new Error('PDF import error: TrapNet /LastModified must be a date string')
  if (hasVersion) {
    if (!Array.isArray(version) || version.length === 0) throw new Error('PDF import error: TrapNet /Version must be a non-empty array')
    if (!Array.isArray(annotationStates) || annotationStates.length !== annotationCount - 1) {
      throw new Error('PDF import error: TrapNet /AnnotStates must correspond to every other page annotation')
    }
    for (let i = 0; i < annotationStates.length; i++) {
      const value = doc.resolve(annotationStates[i]!)
      if (value !== null && !(value instanceof PdfName)) throw new Error(`PDF import error: TrapNet /AnnotStates[${i}] must be a name or null`)
    }
  }
  const fontFauxing = doc.resolve(annotation.get('FontFauxing') ?? null)
  if (fontFauxing !== null && (!Array.isArray(fontFauxing) || fontFauxing.length === 0)) {
    throw new Error('PDF import error: TrapNet /FontFauxing must be a non-empty array')
  }
}

function annotationIsVisible(doc: PdfDocument, annot: PdfDict, subtype: PdfName, intent: 'screen' | 'print'): boolean {
  const flagsValue = doc.resolve(annot.get('F') ?? null)
  const flags = typeof flagsValue === 'number' ? flagsValue : 0
  if ((flags & ANNOTATION_HIDDEN) !== 0) return false
  if ((flags & ANNOTATION_INVISIBLE) !== 0 && !STANDARD_ANNOTATION_SUBTYPES.has(subtype.name)) return false
  if (intent === 'print') return (flags & ANNOTATION_PRINT) !== 0
  return (flags & ANNOTATION_NO_VIEW) === 0
}

/** Renders the normal appearance stream of a visible annotation (PDF 12.5.5). */
function renderAnnotationAppearance(
  doc: PdfDocument,
  annot: PdfDict,
  subtype: PdfName,
  initialMatrix: Matrix,
  interpreter: PdfContentInterpreter,
  intent: 'screen' | 'print',
): void {
  if (!annotationIsVisible(doc, annot, subtype, intent)) return
  const ap = doc.resolve(annot.get('AP') ?? null)
  if (ap === null) return
  if (!(ap instanceof Map)) throw new Error('PDF import error: annotation /AP must be a dictionary')
  const stream = resolveNormalAppearance(doc, ap, annot)
  if (stream === null) return
  const bboxValue = doc.resolve(stream.dict.get('BBox') ?? null)
  if (!Array.isArray(bboxValue) || bboxValue.length < 4) {
    throw new Error('PDF import error: annotation appearance stream requires /BBox')
  }
  const bx1 = numberAt(doc, bboxValue, 0, 'BBox')
  const by1 = numberAt(doc, bboxValue, 1, 'BBox')
  const bx2 = numberAt(doc, bboxValue, 2, 'BBox')
  const by2 = numberAt(doc, bboxValue, 3, 'BBox')
  const matrixValue = doc.resolve(stream.dict.get('Matrix') ?? null)
  const formMatrix: Matrix = Array.isArray(matrixValue) && matrixValue.length >= 6
    ? [
        numberAt(doc, matrixValue, 0, 'Matrix'), numberAt(doc, matrixValue, 1, 'Matrix'),
        numberAt(doc, matrixValue, 2, 'Matrix'), numberAt(doc, matrixValue, 3, 'Matrix'),
        numberAt(doc, matrixValue, 4, 'Matrix'), numberAt(doc, matrixValue, 5, 'Matrix'),
      ]
    : [1, 0, 0, 1, 0, 0]
  const rectValue = doc.resolve(annot.get('Rect') ?? null)
  if (!Array.isArray(rectValue) || rectValue.length < 4) {
    throw new Error('PDF import error: annotation /Rect must be an array of four numbers')
  }
  const rx1 = numberAt(doc, rectValue, 0, 'Rect')
  const ry1 = numberAt(doc, rectValue, 1, 'Rect')
  const rx2 = numberAt(doc, rectValue, 2, 'Rect')
  const ry2 = numberAt(doc, rectValue, 3, 'Rect')
  const rectX = Math.min(rx1, rx2)
  const rectY = Math.min(ry1, ry2)
  const rectW = Math.abs(rx2 - rx1)
  const rectH = Math.abs(ry2 - ry1)
  // Transform the BBox by the form matrix and fit the result to /Rect
  const corners: [number, number][] = [[bx1, by1], [bx2, by1], [bx2, by2], [bx1, by2]]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < corners.length; i++) {
    const x = formMatrix[0] * corners[i]![0] + formMatrix[2] * corners[i]![1] + formMatrix[4]
    const y = formMatrix[1] * corners[i]![0] + formMatrix[3] * corners[i]![1] + formMatrix[5]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const sx = maxX - minX === 0 ? 1 : rectW / (maxX - minX)
  const sy = maxY - minY === 0 ? 1 : rectH / (maxY - minY)
  const fit: Matrix = [sx, 0, 0, sy, rectX - minX * sx, rectY - minY * sy]
  const matrix = multiplyMatrixValues(fit, formMatrix)
  const resourcesValue = doc.resolve(stream.dict.get('Resources') ?? null)
  const resources = resourcesValue instanceof Map ? resourcesValue : null
  interpreter.interpretAppearance(doc.decodeStream(stream), resources, matrix, [bx1, by1, bx2, by2])
}

function resolveNormalAppearance(doc: PdfDocument, ap: PdfDict, annot: PdfDict): PdfStream | null {
  const normal = doc.resolve(ap.get('N') ?? null)
  if (normal === null) return null
  if (normal instanceof PdfStream) return normal
  if (normal instanceof Map) {
    const stateValue = doc.resolve(annot.get('AS') ?? null)
    if (stateValue instanceof PdfName) {
      const stateAppearance = normal.get(stateValue.name)
      if (stateAppearance === undefined) return null
      const selected = doc.resolve(stateAppearance)
      if (selected instanceof PdfStream) return selected
      throw new Error(`PDF import error: annotation appearance state /${stateValue.name} must be a stream`)
    }
    throw new Error('PDF import error: annotation appearance state dictionary requires /AS')
  }
  throw new Error('PDF import error: annotation /AP /N must be a stream or state dictionary')
}

function multiplyMatrixValues(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function readLinkHyperlink(doc: PdfDocument, pages: CollectedPage[], annot: PdfDict, pageIndex: number): HyperlinkDef | null {
  const actionValue = doc.resolve(annot.get('A') ?? null)
  if (actionValue instanceof Map) return readActionHyperlink(doc, pages, actionValue, pageIndex)
  const destValue = doc.resolve(annot.get('Dest') ?? null)
  if (destValue !== null) return readDestinationHyperlink(doc, pages, destValue)
  throw new Error('PDF import error: Link annotation requires /A or /Dest')
}

function readActionHyperlink(doc: PdfDocument, pages: CollectedPage[], action: PdfDict, pageIndex: number): HyperlinkDef | null {
  const s = doc.resolve(action.get('S') ?? null)
  if (!(s instanceof PdfName)) throw new Error('PDF import error: Link annotation action requires /S')
  if (s.name === 'URI') {
    const uri = pdfTextString(doc.resolve(action.get('URI') ?? null), '/URI')
    return { type: 'reference', target: literalExpression(uri) }
  }
  if (s.name === 'GoTo') {
    const dest = doc.resolve(action.get('D') ?? null)
    if (dest === null) throw new Error('PDF import error: GoTo action requires /D')
    return readDestinationHyperlink(doc, pages, dest)
  }
  if (s.name === 'GoToR') return readRemoteDestinationHyperlink(doc, action)
  if (s.name === 'Named') {
    // Named page-navigation actions (ISO 32000 12.6.4.2 table 210) resolve
    // relative to the page carrying the annotation. Viewers clamp Next/Prev at
    // the document bounds, so the imported page link does the same.
    const n = doc.resolve(action.get('N') ?? null)
    if (!(n instanceof PdfName)) throw new Error('PDF import error: Named action requires /N')
    let target: number
    if (n.name === 'FirstPage') target = 1
    else if (n.name === 'LastPage') target = pages.length
    else if (n.name === 'NextPage') target = Math.min(pageIndex + 2, pages.length)
    else if (n.name === 'PrevPage') target = Math.max(pageIndex, 1)
    else return null
    return { type: 'localPage', target: literalExpression(String(target)) }
  }
  return null
}

function readDestinationHyperlink(doc: PdfDocument, pages: CollectedPage[], value: PdfValue): HyperlinkDef {
  if (value instanceof PdfString) {
    const name = pdfStringToText(value)
    return resolveNamedDestinationHyperlink(doc, pages, name) ?? { type: 'localAnchor', target: literalExpression(name) }
  }
  if (value instanceof PdfName) {
    return resolveNamedDestinationHyperlink(doc, pages, value.name) ?? { type: 'localAnchor', target: literalExpression(value.name) }
  }
  if (Array.isArray(value) && value.length > 0) {
    const pageIndex = destinationPageIndex(doc, pages, value[0]!)
    return { type: 'localPage', target: literalExpression(String(pageIndex + 1)) }
  }
  throw new Error('PDF import error: unsupported Link annotation destination')
}

function resolveNamedDestinationHyperlink(doc: PdfDocument, pages: CollectedPage[], name: string): HyperlinkDef | null {
  const destination = lookupNamedDestination(doc, name)
  if (destination === null) return null
  const resolved = doc.resolve(destination)
  if (Array.isArray(resolved)) {
    return readDestinationHyperlink(doc, pages, resolved)
  }
  if (resolved instanceof Map) {
    const d = doc.resolve(resolved.get('D') ?? null)
    if (Array.isArray(d)) return readDestinationHyperlink(doc, pages, d)
  }
  throw new Error(`PDF import error: named destination ${name} must resolve to a destination array`)
}

function lookupNamedDestination(doc: PdfDocument, name: string): PdfValue | null {
  const catalog = doc.getCatalog()
  const dests = doc.resolve(catalog.get('Dests') ?? null)
  if (dests instanceof Map) {
    const value = dests.get(name)
    if (value !== undefined) return value
  } else if (dests !== null) {
    throw new Error('PDF import error: catalog /Dests must be a dictionary')
  }

  const names = doc.resolve(catalog.get('Names') ?? null)
  if (names === null) return null
  if (!(names instanceof Map)) throw new Error('PDF import error: catalog /Names must be a dictionary')
  const destNameTree = doc.resolve(names.get('Dests') ?? null)
  if (destNameTree === null) return null
  if (!(destNameTree instanceof Map)) throw new Error('PDF import error: catalog /Names /Dests must be a name tree dictionary')
  return lookupNameTreeValue(doc, destNameTree, name, new Set())
}

function lookupNameTreeValue(doc: PdfDocument, node: PdfDict, name: string, visited: Set<PdfDict>): PdfValue | null {
  if (visited.has(node)) throw new Error('PDF import error: circular named destination name tree')
  visited.add(node)
  const namesValue = doc.resolve(node.get('Names') ?? null)
  if (namesValue !== null) {
    if (!Array.isArray(namesValue)) throw new Error('PDF import error: named destination /Names must be an array')
    if ((namesValue.length % 2) !== 0) throw new Error('PDF import error: named destination /Names array must contain key/value pairs')
    for (let i = 0; i < namesValue.length; i += 2) {
      const key = doc.resolve(namesValue[i]!)
      if (!(key instanceof PdfString)) throw new Error(`PDF import error: named destination key ${i / 2} must be a string`)
      if (pdfStringToText(key) === name) return namesValue[i + 1]!
    }
  }

  const kidsValue = doc.resolve(node.get('Kids') ?? null)
  if (kidsValue === null) return null
  if (!Array.isArray(kidsValue)) throw new Error('PDF import error: named destination /Kids must be an array')
  for (let i = 0; i < kidsValue.length; i++) {
    const kid = doc.resolve(kidsValue[i]!)
    if (!(kid instanceof Map)) throw new Error(`PDF import error: named destination kid ${i} must be a dictionary`)
    const value = lookupNameTreeValue(doc, kid, name, visited)
    if (value !== null) return value
  }
  return null
}

/** Decodes bytes as Latin-1 (used for stream-form JavaScript sources). */
function latin1Bytes(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

function redactionDefaultAppearanceFontName(defaultAppearance: string): string {
  const data = new Uint8Array(defaultAppearance.length)
  for (let i = 0; i < defaultAppearance.length; i++) data[i] = defaultAppearance.charCodeAt(i)
  const lexer = new PdfContentLexer(data)
  const operands: PdfValue[] = []
  let fontName: string | undefined
  for (;;) {
    const token = lexer.next()
    if (token.type === 'eof') break
    if (token.type === 'object') {
      operands.push(token.value)
      continue
    }
    if (token.type === 'inlineImage') throw new Error('PDF import error: Redact annotation /DA cannot contain an inline image')
    if (token.value === 'Tf') {
      if (operands.length !== 2 || !(operands[0] instanceof PdfName) || typeof operands[1] !== 'number' || operands[1] <= 0) {
        throw new Error('PDF import error: Redact annotation /DA Tf requires a font name and positive font size')
      }
      fontName = operands[0].name
    }
    operands.length = 0
  }
  if (fontName === undefined) throw new Error('PDF import error: Redact annotation /DA requires Tf')
  return fontName
}

/** Converts a PDF color array (/C, /IC) to #RRGGBB; null when absent/empty. */
function pdfColorArrayToHex(doc: PdfDocument, value: PdfValue | null): string | null {
  const arr = doc.resolve(value ?? null)
  if (!Array.isArray(arr) || arr.length === 0) return null
  const c = arr.map((v) => {
    const n = doc.resolve(v)
    if (typeof n !== 'number') throw new Error('PDF import error: annotation color component must be a number')
    return n
  })
  const hex = (n: number): string => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0')
  let r: number, g: number, b: number
  if (c.length === 1) { r = g = b = c[0]! }
  else if (c.length === 3) { r = c[0]!; g = c[1]!; b = c[2]! }
  else if (c.length === 4) {
    // CMYK -> RGB (ISO 32000 §10.3.4 naive conversion).
    r = (1 - c[0]!) * (1 - c[3]!); g = (1 - c[1]!) * (1 - c[3]!); b = (1 - c[2]!) * (1 - c[3]!)
  } else {
    throw new Error('PDF import error: annotation color must have 1, 3, or 4 components')
  }
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Collects every (key, value) pair from a number tree (walks /Nums and /Kids). */
function collectNumberTreeEntries(doc: PdfDocument, node: PdfDict, out: [number, PdfValue][], visited: Set<PdfDict>): void {
  if (visited.has(node)) throw new Error('PDF import error: circular number tree')
  visited.add(node)
  const numsValue = doc.resolve(node.get('Nums') ?? null)
  if (numsValue !== null) {
    if (!Array.isArray(numsValue)) throw new Error('PDF import error: number tree /Nums must be an array')
    if ((numsValue.length % 2) !== 0) throw new Error('PDF import error: number tree /Nums must contain key/value pairs')
    for (let i = 0; i < numsValue.length; i += 2) {
      const key = doc.resolve(numsValue[i]!)
      if (typeof key !== 'number') throw new Error(`PDF import error: number tree key ${i / 2} must be a number`)
      out.push([key, numsValue[i + 1]!])
    }
  }
  const kidsValue = doc.resolve(node.get('Kids') ?? null)
  if (kidsValue === null) return
  if (!Array.isArray(kidsValue)) throw new Error('PDF import error: number tree /Kids must be an array')
  for (let i = 0; i < kidsValue.length; i++) {
    const kid = doc.resolve(kidsValue[i]!)
    if (!(kid instanceof Map)) throw new Error(`PDF import error: number tree kid ${i} must be a dictionary`)
    collectNumberTreeEntries(doc, kid, out, visited)
  }
}

function importedCollectionScalar(value: PdfString | number, subtype: string, key: string): string | number | Date {
  if (subtype === 'N') {
    if (typeof value !== 'number') throw new Error(`PDF import error: numeric collection field ${key} requires a number`)
    return value
  }
  if (!(value instanceof PdfString)) throw new Error(`PDF import error: collection field ${key} requires a string`)
  const text = pdfStringToText(value)
  if (subtype !== 'D') return text
  return parsePdfDateText(text, `collection date field ${key}`)
}

function readPdfCollectionColor(doc: PdfDocument, value: PdfValue, key: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`PDF import error: collection ${key} must be a three-component color`)
  const result: [number, number, number] = [0, 0, 0]
  for (let component = 0; component < 3; component++) {
    const number = doc.resolve(value[component]!)
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1) {
      throw new Error(`PDF import error: collection ${key} components must be from 0 to 1`)
    }
    result[component] = number
  }
  return result
}

interface PdfCollectionFolderImportContext {
  doc: PdfDocument
  fieldSubtypes: Map<string, PdfCollectionFieldSubtype>
  images: Record<string, Uint8Array>
  objectNumbers: Set<number>
  folderIds: Set<number>
}

function readPdfCollectionFolderTree(
  doc: PdfDocument,
  rootReference: PdfRef,
  fieldSubtypes: Map<string, PdfCollectionFieldSubtype>,
  images: Record<string, Uint8Array>,
): PdfCollectionFolder {
  const context: PdfCollectionFolderImportContext = {
    doc, fieldSubtypes, images, objectNumbers: new Set<number>(), folderIds: new Set<number>(),
  }
  const root = readPdfCollectionFolderNode(context, rootReference, undefined, true)
  if (root.next !== undefined) throw new Error('PDF import error: collection root folder must not have /Next')
  if (root.folder.freeIdRanges !== undefined) {
    for (const id of context.folderIds) {
      for (let rangeIndex = 0; rangeIndex < root.folder.freeIdRanges.length; rangeIndex++) {
        const range = root.folder.freeIdRanges[rangeIndex]!
        if (id >= range[0] && id <= range[1]) throw new Error(`PDF import error: collection folder /Free contains the used ID ${id}`)
      }
    }
  }
  return root.folder
}

function pdfCollectionFolderIds(root: PdfCollectionFolder): Set<number> {
  const result = new Set<number>()
  const folders: PdfCollectionFolder[] = [root]
  while (folders.length > 0) {
    const folder = folders.pop()!
    result.add(folder.id)
    if (folder.children !== undefined) {
      for (let childIndex = folder.children.length - 1; childIndex >= 0; childIndex--) folders.push(folder.children[childIndex]!)
    }
  }
  return result
}

function readPdfCollectionFolderNode(
  context: PdfCollectionFolderImportContext,
  reference: PdfRef,
  parentReference: PdfRef | undefined,
  root: boolean,
): { folder: PdfCollectionFolder, next?: PdfRef } {
  if (context.objectNumbers.has(reference.num)) throw new Error('PDF import error: circular collection folder hierarchy')
  context.objectNumbers.add(reference.num)
  const dictionary = context.doc.resolve(reference)
  if (!(dictionary instanceof Map)) throw new Error('PDF import error: collection folder must be a dictionary')
  const objectType = context.doc.resolve(dictionary.get('Type') ?? null)
  if (objectType !== null && (!(objectType instanceof PdfName) || objectType.name !== 'Folder')) {
    throw new Error('PDF import error: collection folder /Type must be /Folder')
  }
  const id = context.doc.resolve(dictionary.get('ID') ?? null)
  if (!Number.isInteger(id) || (id as number) < 0) throw new Error('PDF import error: collection folder /ID must be a non-negative integer')
  if (context.folderIds.has(id as number)) throw new Error(`PDF import error: duplicate collection folder ID ${id}`)
  context.folderIds.add(id as number)
  const name = context.doc.resolve(dictionary.get('Name') ?? null)
  if (!(name instanceof PdfString)) throw new Error(`PDF import error: collection folder ${id} requires /Name`)
  const parent = dictionary.get('Parent')
  if (parentReference === undefined) {
    if (parent !== undefined) throw new Error(`PDF import error: root collection folder ${id} must not have /Parent`)
  } else if (!(parent instanceof PdfRef) || parent.num !== parentReference.num) {
    throw new Error(`PDF import error: collection folder ${id} /Parent does not reference its parent`)
  }
  const folder: PdfCollectionFolder = { id: id as number, name: pdfStringToText(name) }
  const collectionItem = context.doc.resolve(dictionary.get('CI') ?? null)
  if (collectionItem !== null) {
    if (!(collectionItem instanceof Map)) throw new Error(`PDF import error: collection folder ${id} /CI must be a dictionary`)
    folder.collectionItem = readPdfCollectionItem(context.doc, collectionItem, context.fieldSubtypes)
  }
  const description = context.doc.resolve(dictionary.get('Desc') ?? null)
  if (description instanceof PdfString) folder.description = pdfStringToText(description)
  else if (description !== null) throw new Error(`PDF import error: collection folder ${id} /Desc must be a text string`)
  const creationDate = context.doc.resolve(dictionary.get('CreationDate') ?? null)
  if (creationDate instanceof PdfString) folder.creationDate = pdfDateString(creationDate, `collection folder ${id} creation date`)
  else if (creationDate !== null) throw new Error(`PDF import error: collection folder ${id} /CreationDate must be a date`)
  const modificationDate = context.doc.resolve(dictionary.get('ModDate') ?? null)
  if (modificationDate instanceof PdfString) folder.modificationDate = pdfDateString(modificationDate, `collection folder ${id} modification date`)
  else if (modificationDate !== null) throw new Error(`PDF import error: collection folder ${id} /ModDate must be a date`)
  const thumbnailReference = dictionary.get('Thumb')
  if (thumbnailReference !== undefined) {
    if (!(thumbnailReference instanceof PdfRef)) throw new Error(`PDF import error: collection folder ${id} /Thumb must be an indirect image stream`)
    const thumbnail = context.doc.resolve(thumbnailReference)
    if (!(thumbnail instanceof PdfStream)) throw new Error(`PDF import error: collection folder ${id} /Thumb must be an image stream`)
    const subtype = context.doc.resolve(thumbnail.dict.get('Subtype') ?? null)
    if (!(subtype instanceof PdfName) || subtype.name !== 'Image') throw new Error(`PDF import error: collection folder ${id} /Thumb must be an image XObject`)
    const imported = importPdfImageXObject(context.doc, thumbnail, '#000000')
    const imageId = `collection-folder-${id}.${imported.extension}`
    context.images[imageId] = imported.bytes
    folder.thumbnailImageId = imageId
  }
  const free = context.doc.resolve(dictionary.get('Free') ?? null)
  if (free !== null) {
    if (!root) throw new Error(`PDF import error: collection folder ${id} /Free is valid only on the root`)
    if (!Array.isArray(free) || (free.length % 2) !== 0) throw new Error('PDF import error: collection folder /Free must contain integer pairs')
    const ranges: Array<[number, number]> = []
    let previousHigh = -1
    for (let rangeIndex = 0; rangeIndex < free.length; rangeIndex += 2) {
      const low = context.doc.resolve(free[rangeIndex]!)
      const high = context.doc.resolve(free[rangeIndex + 1]!)
      if (!Number.isInteger(low) || !Number.isInteger(high) || (low as number) < 0 || (low as number) > (high as number) || (low as number) <= previousHigh) {
        throw new Error('PDF import error: collection folder /Free ranges must be ordered non-overlapping non-negative integer pairs')
      }
      previousHigh = high as number
      ranges.push([low as number, high as number])
    }
    folder.freeIdRanges = ranges
  }
  const child = dictionary.get('Child')
  if (child !== undefined) {
    if (!(child instanceof PdfRef)) throw new Error(`PDF import error: collection folder ${id} /Child must be an indirect reference`)
    folder.children = readPdfCollectionFolderSiblings(context, child, reference)
  }
  const next = dictionary.get('Next')
  if (next !== undefined && !(next instanceof PdfRef)) throw new Error(`PDF import error: collection folder ${id} /Next must be an indirect reference`)
  return { folder, ...(next instanceof PdfRef ? { next } : {}) }
}

function readPdfCollectionFolderSiblings(
  context: PdfCollectionFolderImportContext,
  firstReference: PdfRef,
  parentReference: PdfRef,
): PdfCollectionFolder[] {
  const result: PdfCollectionFolder[] = []
  const names = new Set<string>()
  let reference: PdfRef | undefined = firstReference
  while (reference !== undefined) {
    const item = readPdfCollectionFolderNode(context, reference, parentReference, false)
    const normalized = item.folder.name.normalize('NFKC').toLowerCase()
    if (names.has(normalized)) throw new Error(`PDF import error: duplicate collection sibling folder name ${item.folder.name}`)
    names.add(normalized)
    result.push(item.folder)
    reference = item.next
  }
  return result
}

function readPdfCollectionItem(
  doc: PdfDocument,
  dictionary: PdfDict,
  fieldSubtypes: Map<string, PdfCollectionFieldSubtype>,
): Record<string, string | number | Date | { value: string | number | Date, prefix?: string }> {
  const item: Record<string, string | number | Date | { value: string | number | Date, prefix?: string }> = {}
  for (const [key, raw] of dictionary) {
    if (key === 'Type') continue
    const subtype = fieldSubtypes.get(key)
    if (subtype === undefined) throw new Error(`PDF import error: collection item key is not in the collection schema: ${key}`)
    const value = doc.resolve(raw)
    if (value instanceof PdfString || typeof value === 'number') item[key] = importedCollectionScalar(value, subtype, key)
    else if (value instanceof Map) {
      const data = doc.resolve(value.get('D') ?? null)
      const prefix = doc.resolve(value.get('P') ?? null)
      if (!(data instanceof PdfString) && typeof data !== 'number') throw new Error(`PDF import error: collection subitem ${key} /D must be a string or number`)
      if (prefix !== null && !(prefix instanceof PdfString)) throw new Error(`PDF import error: collection subitem ${key} /P must be a string`)
      item[key] = {
        value: importedCollectionScalar(data, subtype, key),
        ...(prefix instanceof PdfString ? { prefix: pdfStringToText(prefix) } : {}),
      }
    } else throw new Error(`PDF import error: collection item ${key} must be a string, number, or subitem dictionary`)
  }
  return item
}

const PDF_COLLECTION_FIELD_SUBTYPES = new Set<string>([
  'S', 'D', 'N', 'F', 'Desc', 'ModDate', 'CreationDate', 'Size', 'CompressedSize',
])

function readPdfDocumentRequirements(
  doc: PdfDocument,
  values: PdfValue[],
  scripts: ImportedJavaScript[],
): PdfDocumentRequirement[] {
  const scriptNames = new Set<string>()
  for (let i = 0; i < scripts.length; i++) scriptNames.add(scripts[i]!.name)
  const result: PdfDocumentRequirement[] = []
  for (let requirementIndex = 0; requirementIndex < values.length; requirementIndex++) {
    const dictionary = doc.resolve(values[requirementIndex]!)
    if (!(dictionary instanceof Map)) throw new Error(`PDF import error: requirement ${requirementIndex} must be a dictionary`)
    const objectType = doc.resolve(dictionary.get('Type') ?? null)
    if (objectType !== null && (!(objectType instanceof PdfName) || objectType.name !== 'Requirement')) {
      throw new Error(`PDF import error: requirement ${requirementIndex} /Type must be /Requirement`)
    }
    const subtype = doc.resolve(dictionary.get('S') ?? null)
    if (!(subtype instanceof PdfName) || !PDF_DOCUMENT_REQUIREMENT_TYPE_NAMES.has(subtype.name)) {
      throw new Error(`PDF import error: requirement ${requirementIndex} has an unknown /S`)
    }
    const requirement: PdfDocumentRequirement = { type: subtype.name as PdfDocumentRequirementType }
    const version = doc.resolve(dictionary.get('V') ?? null)
    if (version instanceof PdfName) requirement.version = version.name
    else if (version instanceof Map) requirement.version = rawPdfDictionary(doc, version, new Set<object>())
    else if (version !== null) throw new Error(`PDF import error: requirement ${subtype.name} /V must be a name or dictionary`)
    const handlers = doc.resolve(dictionary.get('RH') ?? null)
    if (handlers instanceof Map) {
      requirement.handlers = readPdfRequirementHandler(doc, handlers, subtype.name, scriptNames)
    } else if (Array.isArray(handlers)) {
      requirement.handlers = handlers.map(function (handler, handlerIndex) {
        const resolved = doc.resolve(handler)
        if (!(resolved instanceof Map)) throw new Error(`PDF import error: requirement ${subtype.name} handler ${handlerIndex} must be a dictionary`)
        return readPdfRequirementHandler(doc, resolved, subtype.name, scriptNames)
      })
    } else if (handlers !== null) {
      throw new Error(`PDF import error: requirement ${subtype.name} /RH must be a dictionary or array`)
    }
    const penalty = doc.resolve(dictionary.get('Penalty') ?? null)
    if (penalty !== null) {
      if (!Number.isInteger(penalty) || (penalty as number) < 0 || (penalty as number) > 100) {
        throw new Error(`PDF import error: requirement ${subtype.name} /Penalty must be an integer from 0 to 100`)
      }
      requirement.penalty = penalty as number
    }
    const encryption = doc.resolve(dictionary.get('Encrypt') ?? null)
    if (subtype.name === 'Encryption') {
      if (!(encryption instanceof Map)) throw new Error('PDF import error: Encryption requirement requires an /Encrypt dictionary')
      requirement.encryption = rawPdfDictionary(doc, encryption, new Set<object>())
    } else if (encryption !== null) {
      throw new Error(`PDF import error: requirement ${subtype.name} must not contain /Encrypt`)
    }
    const digitalSignature = doc.resolve(dictionary.get('DigSig') ?? null)
    const signatureRequirement = subtype.name === 'DigSig' || subtype.name === 'DigSigValidation' || subtype.name === 'DigSigMDP'
    if (digitalSignature !== null) {
      if (!signatureRequirement || !(digitalSignature instanceof Map)) {
        throw new Error(`PDF import error: requirement ${subtype.name} has an invalid /DigSig entry`)
      }
      requirement.digitalSignature = rawPdfDictionary(doc, digitalSignature, new Set<object>())
    }
    result.push(requirement)
  }
  return result
}

function readPdfRequirementHandler(
  doc: PdfDocument,
  dictionary: PdfDict,
  requirementType: string,
  scripts: Set<string>,
): PdfDocumentRequirementHandler {
  const objectType = doc.resolve(dictionary.get('Type') ?? null)
  if (objectType !== null && (!(objectType instanceof PdfName) || objectType.name !== 'ReqHandler')) {
    throw new Error(`PDF import error: requirement ${requirementType} handler /Type must be /ReqHandler`)
  }
  const subtype = doc.resolve(dictionary.get('S') ?? null)
  if (!(subtype instanceof PdfName) || (subtype.name !== 'JS' && subtype.name !== 'NoOp')) {
    throw new Error(`PDF import error: requirement ${requirementType} handler /S must be /JS or /NoOp`)
  }
  const script = doc.resolve(dictionary.get('Script') ?? null)
  if (subtype.name === 'NoOp') {
    if (script !== null) throw new Error(`PDF import error: requirement ${requirementType} NoOp handler must not contain /Script`)
    return { type: 'NoOp' }
  }
  if (script === null) return { type: 'JS' }
  if (!(script instanceof PdfString)) throw new Error(`PDF import error: requirement ${requirementType} handler /Script must be a text string`)
  const name = pdfStringToText(script)
  if (!scripts.has(name)) throw new Error(`PDF import error: requirement handler references missing JavaScript ${name}`)
  return { type: 'JS', script: name }
}

function readPdfWebCapture(doc: PdfDocument, pages: CollectedPage[], catalog: PdfDict, spiderInfo: PdfDict): ImportedWebCapture {
  const version = doc.resolve(spiderInfo.get('V') ?? null)
  if (version !== 1) throw new Error('PDF import error: Web Capture /V must be 1.0')
  const commandsValue = doc.resolve(spiderInfo.get('C') ?? null)
  const commands: PdfWebCaptureCommand[] = []
  const commandIndexByObject = new Map<number, number>()
  if (commandsValue !== null) {
    if (!Array.isArray(commandsValue)) throw new Error('PDF import error: Web Capture /C must be an array')
    for (let commandIndex = 0; commandIndex < commandsValue.length; commandIndex++) {
      const reference = commandsValue[commandIndex]!
      if (!(reference instanceof PdfRef)) throw new Error(`PDF import error: Web Capture command ${commandIndex} must be an indirect reference`)
      if (commandIndexByObject.has(reference.num)) throw new Error('PDF import error: Web Capture command is duplicated')
      const dictionary = doc.resolve(reference)
      if (!(dictionary instanceof Map)) throw new Error(`PDF import error: Web Capture command ${commandIndex} must be a dictionary`)
      commandIndexByObject.set(reference.num, commandIndex)
      commands.push(readPdfWebCaptureCommand(doc, dictionary, commandIndex))
    }
  }
  const names = doc.resolve(catalog.get('Names') ?? null)
  if (names === null) return { version: 1, ...(commands.length === 0 ? {} : { commands }), contentSets: [], images: {} }
  if (!(names instanceof Map)) throw new Error('PDF import error: catalog /Names must be a dictionary')
  const idsTree = doc.resolve(names.get('IDS') ?? null)
  const urlsTree = doc.resolve(names.get('URLS') ?? null)
  if (idsTree === null && urlsTree === null) return { version: 1, ...(commands.length === 0 ? {} : { commands }), contentSets: [], images: {} }
  if (!(idsTree instanceof Map) || !(urlsTree instanceof Map)) {
    throw new Error('PDF import error: Web Capture requires both /IDS and /URLS name trees')
  }
  const idPairs: [PdfString, PdfValue][] = []
  collectNameTreeByteEntries(doc, idsTree, idPairs, new Set())
  const urlPairs: [PdfString, PdfValue][] = []
  collectNameTreeByteEntries(doc, urlsTree, urlPairs, new Set())
  const contentSetInfo = new Map<number, { reference: PdfRef, identifier: Uint8Array, urls: string[] }>()
  const orderedReferences: PdfRef[] = []
  for (let pairIndex = 0; pairIndex < idPairs.length; pairIndex++) {
    const [key, value] = idPairs[pairIndex]!
    const references = pdfWebCaptureContentSetReferences(doc, value, 'IDS')
    for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex++) {
      const reference = references[referenceIndex]!
      if (contentSetInfo.has(reference.num)) throw new Error('PDF import error: Web Capture content set appears more than once in /IDS')
      contentSetInfo.set(reference.num, { reference, identifier: key.bytes.slice(), urls: [] })
      orderedReferences.push(reference)
    }
  }
  for (let pairIndex = 0; pairIndex < urlPairs.length; pairIndex++) {
    const [key, value] = urlPairs[pairIndex]!
    const url = pdfAsciiString(key, 'Web Capture URL name-tree key')
    const references = pdfWebCaptureContentSetReferences(doc, value, 'URLS')
    for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex++) {
      const info = contentSetInfo.get(references[referenceIndex]!.num)
      if (info === undefined) throw new Error('PDF import error: Web Capture /URLS references a content set missing from /IDS')
      if (info.urls.includes(url)) throw new Error(`PDF import error: duplicate Web Capture URL ${url}`)
      info.urls.push(url)
    }
  }
  const pageIndexByObject = new Map<number, number>()
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) pageIndexByObject.set(pages[pageIndex]!.ref.num, pageIndex)
  const images: Record<string, Uint8Array> = {}
  const ownedObjects = new Set<number>()
  const contentSets: PdfWebCaptureContentSet[] = []
  for (let setIndex = 0; setIndex < orderedReferences.length; setIndex++) {
    const reference = orderedReferences[setIndex]!
    const info = contentSetInfo.get(reference.num)!
    contentSets.push(readPdfWebCaptureContentSet(
      doc, pages, reference, info.identifier, info.urls, commandIndexByObject,
      pageIndexByObject, ownedObjects, images, setIndex,
    ))
  }
  return { version: 1, ...(commands.length === 0 ? {} : { commands }), contentSets, images }
}

function readPdfWebCaptureCommand(doc: PdfDocument, dictionary: PdfDict, commandIndex: number): PdfWebCaptureCommand {
  const urlValue = doc.resolve(dictionary.get('URL') ?? null)
  if (!(urlValue instanceof PdfString)) throw new Error(`PDF import error: Web Capture command ${commandIndex} requires /URL`)
  const command: PdfWebCaptureCommand = { url: pdfAsciiString(urlValue, `Web Capture command ${commandIndex} URL`) }
  const levels = doc.resolve(dictionary.get('L') ?? null)
  if (levels !== null) {
    if (!Number.isInteger(levels) || (levels as number) < 0) throw new Error(`PDF import error: Web Capture command ${commandIndex} /L must be a non-negative integer`)
    command.levels = levels as number
  }
  const flags = doc.resolve(dictionary.get('F') ?? null)
  if (flags !== null) {
    if (!Number.isInteger(flags) || (flags as number) < 0 || (flags as number) > 7) throw new Error(`PDF import error: Web Capture command ${commandIndex} /F has reserved bits`)
    command.flags = flags as number
  }
  const posted = doc.resolve(dictionary.get('P') ?? null)
  if (posted instanceof PdfString) command.postedData = { kind: 'string', bytes: posted.bytes.slice() }
  else if (posted instanceof PdfStream) {
    const entries = rawPdfDictionary(doc, posted.dict, new Set<object>())
    delete entries.Length
    delete entries.Filter
    delete entries.DecodeParms
    delete entries.F
    delete entries.FFilter
    delete entries.FDecodeParms
    delete entries.DL
    command.postedData = { kind: 'stream', data: doc.decodeStream(posted), ...(Object.keys(entries).length === 0 ? {} : { entries }) }
  } else if (posted !== null) throw new Error(`PDF import error: Web Capture command ${commandIndex} /P must be a string or stream`)
  const contentType = doc.resolve(dictionary.get('CT') ?? null)
  if (contentType instanceof PdfString) command.contentType = pdfAsciiString(contentType, `Web Capture command ${commandIndex} content type`)
  else if (contentType !== null) throw new Error(`PDF import error: Web Capture command ${commandIndex} /CT must be an ASCII string`)
  const headers = doc.resolve(dictionary.get('H') ?? null)
  if (headers instanceof PdfString) command.headers = headers.bytes.slice()
  else if (headers !== null) throw new Error(`PDF import error: Web Capture command ${commandIndex} /H must be a string`)
  const settings = doc.resolve(dictionary.get('S') ?? null)
  if (settings !== null) {
    if (!(settings instanceof Map)) throw new Error(`PDF import error: Web Capture command ${commandIndex} /S must be a dictionary`)
    const global = doc.resolve(settings.get('G') ?? null)
    const converters = doc.resolve(settings.get('C') ?? null)
    if (global !== null && !(global instanceof Map)) throw new Error(`PDF import error: Web Capture command ${commandIndex} settings /G must be a dictionary`)
    if (converters !== null && !(converters instanceof Map)) throw new Error(`PDF import error: Web Capture command ${commandIndex} settings /C must be a dictionary`)
    const converterModels: Record<string, Record<string, PdfRawValueDef>> = {}
    if (converters instanceof Map) {
      for (const [name, value] of converters) {
        const converter = doc.resolve(value)
        if (!(converter instanceof Map)) throw new Error(`PDF import error: Web Capture converter ${name} settings must be a dictionary`)
        converterModels[name] = rawPdfDictionary(doc, converter, new Set<object>())
      }
    }
    command.settings = {
      ...(global instanceof Map ? { global: rawPdfDictionary(doc, global, new Set<object>()) } : {}),
      ...(Object.keys(converterModels).length === 0 ? {} : { converters: converterModels }),
    }
  }
  return command
}

function readPdfWebCaptureContentSet(
  doc: PdfDocument,
  pages: CollectedPage[],
  reference: PdfRef,
  identifierKey: Uint8Array,
  urls: string[],
  commandIndexByObject: Map<number, number>,
  pageIndexByObject: Map<number, number>,
  ownedObjects: Set<number>,
  images: Record<string, Uint8Array>,
  setIndex: number,
): PdfWebCaptureContentSet {
  const dictionary = doc.resolve(reference)
  if (!(dictionary instanceof Map)) throw new Error(`PDF import error: Web Capture content set ${setIndex} must be a dictionary`)
  const objectType = doc.resolve(dictionary.get('Type') ?? null)
  if (objectType !== null && (!(objectType instanceof PdfName) || objectType.name !== 'SpiderContentSet')) {
    throw new Error(`PDF import error: Web Capture content set ${setIndex} /Type must be /SpiderContentSet`)
  }
  const subtype = doc.resolve(dictionary.get('S') ?? null)
  if (!(subtype instanceof PdfName) || (subtype.name !== 'SPS' && subtype.name !== 'SIS')) {
    throw new Error(`PDF import error: Web Capture content set ${setIndex} /S must be /SPS or /SIS`)
  }
  const identifier = doc.resolve(dictionary.get('ID') ?? null)
  if (!(identifier instanceof PdfString) || !equalBytes(identifier.bytes, identifierKey)) {
    throw new Error(`PDF import error: Web Capture content set ${setIndex} /ID does not match the /IDS key`)
  }
  if (urls.length === 0) throw new Error(`PDF import error: Web Capture content set ${setIndex} is missing from /URLS`)
  const objectValues = doc.resolve(dictionary.get('O') ?? null)
  if (!Array.isArray(objectValues) || objectValues.length === 0) throw new Error(`PDF import error: Web Capture content set ${setIndex} /O must be a non-empty array`)
  const objects: PdfWebCaptureContentSet['objects'] = []
  for (let objectIndex = 0; objectIndex < objectValues.length; objectIndex++) {
    const objectReference = objectValues[objectIndex]!
    if (!(objectReference instanceof PdfRef)) throw new Error(`PDF import error: Web Capture content set ${setIndex} object must be an indirect reference`)
    if (ownedObjects.has(objectReference.num)) throw new Error('PDF import error: Web Capture object belongs to more than one content set')
    ownedObjects.add(objectReference.num)
    const pageIndex = pageIndexByObject.get(objectReference.num)
    const object = doc.resolve(objectReference)
    if (subtype.name === 'SPS') {
      if (pageIndex === undefined || !(object instanceof Map)) throw new Error(`PDF import error: Web Capture page set ${setIndex} contains a non-page object`)
      verifyPdfWebCaptureObjectIdentifier(doc, object, identifierKey, `page ${pageIndex}`)
      const preferredZoom = doc.resolve(object.get('PZ') ?? null)
      if (preferredZoom === null) objects.push({ kind: 'page', pageIndex })
      else if (typeof preferredZoom !== 'number' || !Number.isFinite(preferredZoom) || preferredZoom <= 0) {
        throw new Error(`PDF import error: Web Capture page ${pageIndex} /PZ must be positive`)
      } else objects.push({ kind: 'page', pageIndex, preferredZoom })
    } else {
      if (!(object instanceof PdfStream)) throw new Error(`PDF import error: Web Capture image set ${setIndex} contains a non-stream object`)
      const imageSubtype = doc.resolve(object.dict.get('Subtype') ?? null)
      if (!(imageSubtype instanceof PdfName) || imageSubtype.name !== 'Image') throw new Error(`PDF import error: Web Capture image set ${setIndex} contains a non-image XObject`)
      verifyPdfWebCaptureObjectIdentifier(doc, object.dict, identifierKey, `image ${objectReference.num}`)
      const imported = importPdfImageXObject(doc, object, '#000000')
      const imageId = `webcapture${setIndex}_${objectIndex}.${imported.extension}`
      images[imageId] = imported.bytes
      objects.push({ kind: 'image', imageId })
    }
  }
  const sourceValue = doc.resolve(dictionary.get('SI') ?? null)
  const sources: PdfWebCaptureSource[] = []
  if (sourceValue instanceof Map) sources.push(readPdfWebCaptureSource(doc, sourceValue, subtype.name, commandIndexByObject, setIndex))
  else if (Array.isArray(sourceValue) && sourceValue.length > 0) {
    for (let sourceIndex = 0; sourceIndex < sourceValue.length; sourceIndex++) {
      const source = doc.resolve(sourceValue[sourceIndex]!)
      if (!(source instanceof Map)) throw new Error(`PDF import error: Web Capture content set ${setIndex} source must be a dictionary`)
      sources.push(readPdfWebCaptureSource(doc, source, subtype.name, commandIndexByObject, setIndex))
    }
  } else throw new Error(`PDF import error: Web Capture content set ${setIndex} /SI must be a dictionary or non-empty array`)
  const contentType = doc.resolve(dictionary.get('CT') ?? null)
  const createdAt = doc.resolve(dictionary.get('TS') ?? null)
  const common = {
    identifier: identifier.bytes.slice(), objects,
    sources: Array.isArray(sourceValue) ? sources : sources[0]!, urls: urls.slice(),
    ...(contentType instanceof PdfString ? { contentType: pdfAsciiString(contentType, `Web Capture content set ${setIndex} content type`) } : {}),
    ...(createdAt instanceof PdfString ? { createdAt: pdfDateString(createdAt, `Web Capture content set ${setIndex} timestamp`) } : {}),
  }
  if (contentType !== null && !(contentType instanceof PdfString)) throw new Error(`PDF import error: Web Capture content set ${setIndex} /CT must be an ASCII string`)
  if (createdAt !== null && !(createdAt instanceof PdfString)) throw new Error(`PDF import error: Web Capture content set ${setIndex} /TS must be a date`)
  if (subtype.name === 'SPS') {
    const title = doc.resolve(dictionary.get('T') ?? null)
    const textIdentifier = doc.resolve(dictionary.get('TID') ?? null)
    if (title !== null && !(title instanceof PdfString)) throw new Error(`PDF import error: Web Capture page set ${setIndex} /T must be a text string`)
    if (textIdentifier !== null && !(textIdentifier instanceof PdfString)) throw new Error(`PDF import error: Web Capture page set ${setIndex} /TID must be a byte string`)
    return {
      kind: 'page', ...common,
      ...(title instanceof PdfString ? { title: pdfStringToText(title) } : {}),
      ...(textIdentifier instanceof PdfString ? { textIdentifier: textIdentifier.bytes.slice() } : {}),
    }
  }
  const counts = doc.resolve(dictionary.get('R') ?? null)
  let referenceCounts: number | number[]
  if (objects.length === 1) {
    if (!Number.isInteger(counts) || (counts as number) < 0) throw new Error(`PDF import error: Web Capture image set ${setIndex} /R must be a non-negative integer`)
    referenceCounts = counts as number
  } else {
    if (!Array.isArray(counts) || counts.length !== objects.length) throw new Error(`PDF import error: Web Capture image set ${setIndex} /R must parallel /O`)
    referenceCounts = counts.map(function (count) {
      const resolved = doc.resolve(count)
      if (!Number.isInteger(resolved) || (resolved as number) < 0) throw new Error(`PDF import error: Web Capture image set ${setIndex} /R values must be non-negative integers`)
      return resolved as number
    })
  }
  return { kind: 'image', ...common, referenceCounts }
}

function readPdfWebCaptureSource(
  doc: PdfDocument,
  dictionary: PdfDict,
  contentSetSubtype: string,
  commandIndexByObject: Map<number, number>,
  setIndex: number,
): PdfWebCaptureSource {
  const urlsValue = doc.resolve(dictionary.get('AU') ?? null)
  let urls: PdfWebCaptureSource['urls']
  if (urlsValue instanceof PdfString) {
    urls = pdfAsciiString(urlsValue, `Web Capture content set ${setIndex} source URL`)
  } else if (urlsValue instanceof Map) {
    const destination = doc.resolve(urlsValue.get('U') ?? null)
    if (!(destination instanceof PdfString)) throw new Error(`PDF import error: Web Capture content set ${setIndex} URL alias requires /U`)
    const chainsValue = doc.resolve(urlsValue.get('C') ?? null)
    const chains: string[][] = []
    if (chainsValue !== null) {
      if (!Array.isArray(chainsValue) || chainsValue.length === 0) throw new Error(`PDF import error: Web Capture content set ${setIndex} URL alias /C must be non-empty`)
      for (let chainIndex = 0; chainIndex < chainsValue.length; chainIndex++) {
        const chainValue = doc.resolve(chainsValue[chainIndex]!)
        if (!Array.isArray(chainValue) || chainValue.length === 0) throw new Error(`PDF import error: Web Capture content set ${setIndex} URL alias chain must be non-empty`)
        chains.push(chainValue.map(function (entry) {
          const value = doc.resolve(entry)
          if (!(value instanceof PdfString)) throw new Error(`PDF import error: Web Capture content set ${setIndex} URL alias must contain strings`)
          return pdfAsciiString(value, `Web Capture content set ${setIndex} URL alias`)
        }))
      }
    }
    urls = { destinationUrl: pdfAsciiString(destination, `Web Capture content set ${setIndex} URL alias destination`), ...(chains.length === 0 ? {} : { chains }) }
  } else throw new Error(`PDF import error: Web Capture content set ${setIndex} source requires /AU`)
  const source: PdfWebCaptureSource = { urls }
  const timestamp = doc.resolve(dictionary.get('TS') ?? null)
  const expiration = doc.resolve(dictionary.get('E') ?? null)
  if (timestamp instanceof PdfString) source.timestamp = pdfDateString(timestamp, `Web Capture content set ${setIndex} source timestamp`)
  else if (timestamp !== null) throw new Error(`PDF import error: Web Capture content set ${setIndex} source /TS must be a date`)
  if (expiration instanceof PdfString) source.expiresAt = pdfDateString(expiration, `Web Capture content set ${setIndex} source expiration`)
  else if (expiration !== null) throw new Error(`PDF import error: Web Capture content set ${setIndex} source /E must be a date`)
  const submission = doc.resolve(dictionary.get('S') ?? null)
  if (submission !== null) {
    if (contentSetSubtype !== 'SPS' || (submission !== 0 && submission !== 1 && submission !== 2)) {
      throw new Error(`PDF import error: Web Capture content set ${setIndex} source /S is invalid`)
    }
    source.submission = submission
  }
  const command = dictionary.get('C')
  if (command !== undefined) {
    if (contentSetSubtype !== 'SPS' || !(command instanceof PdfRef)) throw new Error(`PDF import error: Web Capture content set ${setIndex} source /C must be an indirect command reference`)
    const commandIndex = commandIndexByObject.get(command.num)
    if (commandIndex === undefined) throw new Error(`PDF import error: Web Capture content set ${setIndex} source references an unknown command`)
    source.commandIndex = commandIndex
  }
  return source
}

function verifyPdfWebCaptureObjectIdentifier(doc: PdfDocument, dictionary: PdfDict, identifier: Uint8Array, label: string): void {
  const value = doc.resolve(dictionary.get('ID') ?? null)
  if (!(value instanceof PdfString) || !equalBytes(value.bytes, identifier)) {
    throw new Error(`PDF import error: Web Capture ${label} /ID does not match its content set`)
  }
}

function pdfWebCaptureContentSetReferences(doc: PdfDocument, value: PdfValue, treeName: string): PdfRef[] {
  const resolved = doc.resolve(value)
  if (value instanceof PdfRef && resolved instanceof Map) return [value]
  if (!Array.isArray(resolved) || resolved.length === 0) throw new Error(`PDF import error: Web Capture /${treeName} value must be an indirect reference or non-empty array`)
  return resolved.map(function (entry) {
    if (!(entry instanceof PdfRef)) throw new Error(`PDF import error: Web Capture /${treeName} array must contain indirect references`)
    return entry
  })
}

function collectNameTreeByteEntries(doc: PdfDocument, node: PdfDict, out: [PdfString, PdfValue][], visited: Set<PdfDict>): void {
  if (visited.has(node)) throw new Error('PDF import error: circular name tree')
  visited.add(node)
  const namesValue = doc.resolve(node.get('Names') ?? null)
  if (namesValue !== null) {
    if (!Array.isArray(namesValue) || (namesValue.length % 2) !== 0) throw new Error('PDF import error: name tree /Names must contain key/value pairs')
    for (let i = 0; i < namesValue.length; i += 2) {
      const key = doc.resolve(namesValue[i]!)
      if (!(key instanceof PdfString)) throw new Error(`PDF import error: name tree key ${i / 2} must be a string`)
      out.push([key, namesValue[i + 1]!])
    }
  }
  const kidsValue = doc.resolve(node.get('Kids') ?? null)
  if (kidsValue === null) return
  if (!Array.isArray(kidsValue)) throw new Error('PDF import error: name tree /Kids must be an array')
  for (let kidIndex = 0; kidIndex < kidsValue.length; kidIndex++) {
    const kid = doc.resolve(kidsValue[kidIndex]!)
    if (!(kid instanceof Map)) throw new Error(`PDF import error: name tree kid ${kidIndex} must be a dictionary`)
    collectNameTreeByteEntries(doc, kid, out, visited)
  }
}

function pdfAsciiString(value: PdfString, label: string): string {
  let result = ''
  for (let i = 0; i < value.bytes.length; i++) {
    const byte = value.bytes[i]!
    if (byte > 0x7f) throw new Error(`PDF import error: ${label} must be ASCII`)
    result += String.fromCharCode(byte)
  }
  return result
}

function pdfDateString(value: PdfString, label: string): Date {
  return parsePdfDateText(pdfStringToText(value), label)
}

export function parsePdfDateText(text: string, label = 'date'): Date {
  const match = /^D:(\d{4})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(Z)|([+\-])(\d{2})(?:'(\d{2})'?)?)?)?)?)?)?)?$/.exec(text)
  if (match === null) throw new Error(`PDF import error: ${label} is not a PDF date`)
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
    throw new Error(`PDF import error: ${label} contains an out-of-range date field`)
  }
  const local = new Date(0)
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, 0)
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) {
    throw new Error(`PDF import error: ${label} contains an invalid calendar date`)
  }
  let offsetMinutes = 0
  if (match[8] === '+' || match[8] === '-') {
    offsetMinutes = offsetHour * 60 + offsetMinute
    if (match[8] === '-') offsetMinutes = -offsetMinutes
  }
  return new Date(local.getTime() - offsetMinutes * 60000)
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const PDF_DOCUMENT_REQUIREMENT_TYPE_NAMES = new Set<string>([
  'OCInteract', 'OCAutoStates', 'AcroFormInteract', 'Navigation', 'Markup', '3DMarkup',
  'Multimedia', 'U3D', 'PRC', 'Action', 'EnableJavaScripts', 'Attachment', 'AttachmentEditing',
  'Collection', 'CollectionEditing', 'DigSigValidation', 'DigSig', 'DigSigMDP', 'RichMedia',
  'Geospatial2D', 'Geospatial3D', 'DPartInteract', 'SeparationSimulation', 'Transitions', 'Encryption',
])

const PDF_AF_RELATIONSHIP_NAMES = new Set<string>([
  'Source', 'Data', 'Alternative', 'Supplement', 'EncryptedPayload', 'FormData', 'Schema', 'Unspecified',
])

/** Collects every (name, value) pair from a name tree (walks /Names and /Kids). */
function collectNameTreeEntries(doc: PdfDocument, node: PdfDict, out: [string, PdfValue][], visited: Set<PdfDict>): void {
  if (visited.has(node)) throw new Error('PDF import error: circular name tree')
  visited.add(node)
  const namesValue = doc.resolve(node.get('Names') ?? null)
  if (namesValue !== null) {
    if (!Array.isArray(namesValue)) throw new Error('PDF import error: name tree /Names must be an array')
    if ((namesValue.length % 2) !== 0) throw new Error('PDF import error: name tree /Names array must contain key/value pairs')
    for (let i = 0; i < namesValue.length; i += 2) {
      const key = doc.resolve(namesValue[i]!)
      if (!(key instanceof PdfString)) throw new Error(`PDF import error: name tree key ${i / 2} must be a string`)
      out.push([pdfStringToText(key), namesValue[i + 1]!])
    }
  }
  const kidsValue = doc.resolve(node.get('Kids') ?? null)
  if (kidsValue === null) return
  if (!Array.isArray(kidsValue)) throw new Error('PDF import error: name tree /Kids must be an array')
  for (let i = 0; i < kidsValue.length; i++) {
    const kid = doc.resolve(kidsValue[i]!)
    if (!(kid instanceof Map)) throw new Error(`PDF import error: name tree kid ${i} must be a dictionary`)
    collectNameTreeEntries(doc, kid, out, visited)
  }
}

function embeddedFileReferenceIndexes(doc: PdfDocument): Map<string, number> {
  const result = new Map<string, number>()
  const names = doc.resolve(doc.getCatalog().get('Names') ?? null)
  if (!(names instanceof Map)) return result
  const tree = doc.resolve(names.get('EmbeddedFiles') ?? null)
  if (!(tree instanceof Map)) return result
  const entries: [string, PdfValue][] = []
  collectNameTreeEntries(doc, tree, entries, new Set<PdfDict>())
  for (let i = 0; i < entries.length; i++) {
    const reference = entries[i]![1]
    if (reference instanceof PdfRef) result.set(`${reference.num}:${reference.gen}`, i)
  }
  return result
}

function readRemoteDestinationHyperlink(doc: PdfDocument, action: PdfDict): HyperlinkDef {
  const file = readFileSpec(doc, doc.resolve(action.get('F') ?? null))
  const dest = doc.resolve(action.get('D') ?? null)
  if (dest instanceof PdfString) {
    return { type: 'remoteAnchor', target: literalExpression(pdfStringToText(dest)), remoteDocument: literalExpression(file) }
  }
  if (dest instanceof PdfName) {
    return { type: 'remoteAnchor', target: literalExpression(dest.name), remoteDocument: literalExpression(file) }
  }
  if (Array.isArray(dest) && dest.length > 0) {
    const first = doc.resolve(dest[0]!)
    if (typeof first !== 'number') throw new Error('PDF import error: remote page destination must start with a page number')
    return { type: 'remotePage', target: literalExpression(String(first + 1)), remoteDocument: literalExpression(file) }
  }
  throw new Error('PDF import error: GoToR action requires /D')
}

function readFileSpec(doc: PdfDocument, value: PdfValue): string {
  if (value instanceof PdfString) return pdfStringToText(value)
  if (value instanceof PdfName) return value.name
  if (value instanceof Map) return pdfTextString(doc.resolve(value.get('F') ?? null), '/F')
  throw new Error('PDF import error: GoToR action requires file specification /F')
}

function destinationPageIndex(doc: PdfDocument, pages: CollectedPage[], value: PdfValue): number {
  const resolved = doc.resolve(value)
  if (value instanceof PdfRef) return pageIndexForRef(pages, value)
  if (typeof resolved === 'number') {
    const index = Math.trunc(resolved)
    if (index < 0 || index >= pages.length) throw new Error(`PDF import error: destination page index ${index} out of range`)
    return index
  }
  if (resolved instanceof Map) {
    for (let i = 0; i < pages.length; i++) {
      if (pages[i]!.dict === resolved) return i
    }
  }
  throw new Error('PDF import error: destination page reference not found')
}

function pageIndexForRef(pages: CollectedPage[], ref: PdfRef): number {
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]!.ref.num === ref.num && pages[i]!.ref.gen === ref.gen) return i
  }
  throw new Error(`PDF import error: destination page ${ref.num} ${ref.gen} R not found`)
}

function readImportedDocumentPart(
  doc: PdfDocument,
  pages: CollectedPage[],
  dictionary: PdfDict,
  expectedParent: PdfDict,
  path: Set<PdfDict>,
  seen: Set<PdfDict>,
): ImportedDocumentPart {
  if (path.has(dictionary)) throw new Error('PDF import error: circular document-part hierarchy')
  if (seen.has(dictionary)) throw new Error('PDF import error: document-part node has more than one parent')
  path.add(dictionary)
  seen.add(dictionary)
  const type = doc.resolve(dictionary.get('Type') ?? null)
  if (!(type instanceof PdfName) || type.name !== 'DPart') throw new Error('PDF import error: document-part /Type must be /DPart')
  const parentReference = dictionary.get('Parent')
  if (!(parentReference instanceof PdfRef) || doc.resolve(parentReference) !== expectedParent) {
    throw new Error('PDF import error: document-part /Parent does not reference its immediate parent')
  }

  const result: ImportedDocumentPart = {}
  const dpmValue = doc.resolve(dictionary.get('DPM') ?? null)
  if (dpmValue !== null) {
    if (!(dpmValue instanceof Map)) throw new Error('PDF import error: document-part /DPM must be a dictionary')
    const metadata: Record<string, PdfDocumentPartMetadataValue> = {}
    for (const [key, value] of dpmValue) metadata[key] = readImportedDocumentPartMetadataValue(doc, value, new Set<object>())
    result.metadata = metadata
  }

  const childrenValue = doc.resolve(dictionary.get('DParts') ?? null)
  if (childrenValue !== null) {
    if (dictionary.has('Start') || dictionary.has('End')) {
      throw new Error('PDF import error: document-part must not contain both /DParts and /Start or /End')
    }
    if (!Array.isArray(childrenValue) || childrenValue.length === 0) {
      throw new Error('PDF import error: document-part /DParts must be a non-empty array')
    }
    const children: ImportedDocumentPart[][] = []
    for (let groupIndex = 0; groupIndex < childrenValue.length; groupIndex++) {
      const groupValue = doc.resolve(childrenValue[groupIndex]!)
      if (!Array.isArray(groupValue) || groupValue.length === 0) {
        throw new Error(`PDF import error: document-part child group ${groupIndex} must be a non-empty array`)
      }
      const group: ImportedDocumentPart[] = []
      for (let childIndex = 0; childIndex < groupValue.length; childIndex++) {
        const reference = groupValue[childIndex]
        if (!(reference instanceof PdfRef)) {
          throw new Error(`PDF import error: document-part child ${groupIndex}:${childIndex} must be an indirect reference`)
        }
        const child = doc.resolve(reference)
        if (!(child instanceof Map)) throw new Error(`PDF import error: document-part child ${groupIndex}:${childIndex} must be a dictionary`)
        group.push(readImportedDocumentPart(doc, pages, child, dictionary, path, seen))
      }
      children.push(group)
    }
    result.children = children
  } else {
    const startReference = dictionary.get('Start')
    if (!(startReference instanceof PdfRef)) throw new Error('PDF import error: document-part leaf /Start must be a page reference')
    const startPage = pageIndexForRef(pages, startReference)
    const endReference = dictionary.get('End')
    if (endReference !== undefined && !(endReference instanceof PdfRef)) {
      throw new Error('PDF import error: document-part leaf /End must be a page reference')
    }
    const endPage = endReference instanceof PdfRef ? pageIndexForRef(pages, endReference) : startPage
    if (endPage < startPage) throw new Error('PDF import error: document-part leaf /End precedes /Start')
    for (let pageIndex = startPage; pageIndex <= endPage; pageIndex++) {
      const pagePartReference = pages[pageIndex]!.dict.get('DPart')
      if (!(pagePartReference instanceof PdfRef) || doc.resolve(pagePartReference) !== dictionary) {
        throw new Error(`PDF import error: page ${pageIndex} does not reference its leaf document part`)
      }
    }
    result.startPage = startPage
    result.endPage = endPage
  }
  path.delete(dictionary)
  return result
}

function readImportedDocumentPartMetadataValue(
  doc: PdfDocument,
  rawValue: PdfValue,
  path: Set<object>,
): PdfDocumentPartMetadataValue {
  const value = doc.resolve(rawValue)
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (value instanceof PdfString) return pdfStringToText(value)
  if (value instanceof PdfName) return { type: 'name', value: value.name }
  if (value === null) throw new Error('PDF import error: document-part metadata does not permit null')
  if (path.has(value)) throw new Error('PDF import error: circular document-part metadata')
  path.add(value)
  if (Array.isArray(value)) {
    const result: PdfDocumentPartMetadataValue[] = []
    for (let i = 0; i < value.length; i++) result.push(readImportedDocumentPartMetadataValue(doc, value[i]!, path))
    path.delete(value)
    return result
  }
  if (value instanceof Map) {
    const result: Record<string, PdfDocumentPartMetadataValue> = {}
    for (const [key, item] of value) result[key] = readImportedDocumentPartMetadataValue(doc, item, path)
    path.delete(value)
    return result
  }
  throw new Error('PDF import error: unsupported document-part metadata value')
}

function collectImportedDocumentPartLeaves(node: ImportedDocumentPart, result: ImportedDocumentPart[]): void {
  if (node.children === undefined) {
    result.push(node)
    return
  }
  for (let groupIndex = 0; groupIndex < node.children.length; groupIndex++) {
    const group = node.children[groupIndex]!
    for (let childIndex = 0; childIndex < group.length; childIndex++) collectImportedDocumentPartLeaves(group[childIndex]!, result)
  }
}

function validateImportedDocumentPartHierarchy(root: ImportedDocumentPart, pageCount: number): number {
  const leaves: ImportedDocumentPart[] = []
  collectImportedDocumentPartLeaves(root, leaves)
  let expectedPage = 0
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!
    if (leaf.startPage !== expectedPage || leaf.endPage === undefined) {
      throw new Error('PDF import error: document-part leaves must cover pages in page-tree order')
    }
    expectedPage = leaf.endPage + 1
  }
  if (expectedPage !== pageCount) throw new Error('PDF import error: document-part leaves do not cover every page')
  return importedDocumentPartMaximumDepth(root, 0)
}

function importedDocumentPartMaximumDepth(node: ImportedDocumentPart, depth: number): number {
  let maximum = depth
  if (node.children === undefined) return maximum
  for (let groupIndex = 0; groupIndex < node.children.length; groupIndex++) {
    const group = node.children[groupIndex]!
    for (let childIndex = 0; childIndex < group.length; childIndex++) {
      const childDepth = importedDocumentPartMaximumDepth(group[childIndex]!, depth + 1)
      if (childDepth > maximum) maximum = childDepth
    }
  }
  return maximum
}

function annotationOffsetForPage(doc: PdfDocument, pages: CollectedPage[], pageIndex: number): number {
  let offset = 0
  for (let i = 0; i < pageIndex; i++) {
    const annotations = doc.resolve(pages[i]!.dict.get('Annots') ?? null)
    if (annotations === null) continue
    if (!Array.isArray(annotations)) throw new Error(`PDF import error: page ${i} /Annots must be an array`)
    offset += annotations.length
  }
  return offset
}

function annotationIndexForRef(doc: PdfDocument, pages: CollectedPage[], ref: PdfRef, expectedSubtypes: string[]): number {
  let index = 0
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const annotations = doc.resolve(pages[pageIndex]!.dict.get('Annots') ?? null)
    if (annotations === null) continue
    if (!Array.isArray(annotations)) throw new Error(`PDF import error: page ${pageIndex} /Annots must be an array`)
    for (let i = 0; i < annotations.length; i++) {
      const value = annotations[i]
      if (value instanceof PdfRef && value.num === ref.num && value.gen === ref.gen) {
        const annotation = doc.resolve(value)
        if (!(annotation instanceof Map)) throw new Error('PDF import error: action target must reference an annotation dictionary')
        const subtype = doc.resolve(annotation.get('Subtype') ?? null)
        if (!(subtype instanceof PdfName) || (expectedSubtypes.length > 0 && !expectedSubtypes.includes(subtype.name))) {
          throw new Error(`PDF import error: action annotation target must have subtype ${expectedSubtypes.join(' or ')}`)
        }
        return index
      }
      index++
    }
  }
  throw new Error(`PDF import error: action annotation target ${ref.num} ${ref.gen} R is not in a page /Annots array`)
}

function readAnnotationRelationship(doc: PdfDocument, pages: CollectedPage[], value: PdfValue, label: string): number {
  if (!(value instanceof PdfRef)) throw new Error(`PDF import error: annotation ${label} must be an indirect annotation reference`)
  return annotationIndexForRef(doc, pages, value, [])
}

function readAnnotationRect(
  doc: PdfDocument,
  annot: PdfDict,
  initialMatrix: Matrix,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const rect = doc.resolve(annot.get('Rect') ?? null)
  if (!Array.isArray(rect) || rect.length < 4) throw new Error('PDF import error: Link annotation /Rect must be an array of four numbers')
  const x1 = numberAt(doc, rect, 0, 'Rect')
  const y1 = numberAt(doc, rect, 1, 'Rect')
  const x2 = numberAt(doc, rect, 2, 'Rect')
  const y2 = numberAt(doc, rect, 3, 'Rect')
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const bottom = Math.min(y1, y2)
  const top = Math.max(y1, y2)
  const p0 = transformPdfPointToPage(initialMatrix, pageHeight, left, bottom)
  const p1 = transformPdfPointToPage(initialMatrix, pageHeight, right, bottom)
  const p2 = transformPdfPointToPage(initialMatrix, pageHeight, right, top)
  const p3 = transformPdfPointToPage(initialMatrix, pageHeight, left, top)
  const x = Math.min(p0[0], p1[0], p2[0], p3[0])
  const y = Math.min(p0[1], p1[1], p2[1], p3[1])
  const maxX = Math.max(p0[0], p1[0], p2[0], p3[0])
  const maxY = Math.max(p0[1], p1[1], p2[1], p3[1])
  return {
    x,
    y,
    width: maxX - x,
    height: maxY - y,
  }
}

function transformPdfPointToPage(matrix: Matrix, pageHeight: number, x: number, y: number): [number, number] {
  const transformedX = matrix[0] * x + matrix[2] * y + matrix[4]
  const transformedY = matrix[1] * x + matrix[3] * y + matrix[5]
  return [transformedX, pageHeight - transformedY]
}

function pdfTextString(value: PdfValue, label: string): string {
  if (!(value instanceof PdfString)) throw new Error(`PDF import error: ${label} must be a string`)
  return pdfStringToText(value)
}

export function pdfStringToText(value: PdfString): string {
  return decodePdfTextStringBytes(value.bytes)
}

function literalExpression(value: string): string {
  return JSON.stringify(value)
}
