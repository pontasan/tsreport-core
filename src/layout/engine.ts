/**
 * Layout engine
 *
 * Template JSON + data source JSON → RenderDocument (render tree)
 *
 * Processes data according to the band model, handles page breaks and group
 * control, and generates render instructions as a composite tree structure.
 */

import type {
  ReportTemplate, DataSource, BandDef, ElementDef,
  StyleDef, VariableDef, GroupDef, Expression, ReportContext,
  HyperlinkDef, ImageDef, PathDef,
} from '../types/template.js'
import type {
  RenderDocument, RenderPage, RenderNode, RenderGroup, RenderText,
  RenderLink, RenderBookmark, RenderSvg, RenderGlyphRun, RenderPath,
  BlendMode, OverprintMode,
} from '../types/render.js'
import { evaluateExpression, formatValue } from './expression.js'
import { parseExpressionSource, type ExpressionAstNode } from '../expression-language.js'
import { layoutText, type TextLayoutOptions, type LayoutLine } from './text-layout.js'
import { getBaseDirection } from './bidi.js'
import { parseMarkup, type StyledRun } from './markup-parser.js'
import type { TextMeasurer } from '../measure/text-measurer.js'
import { shapeGlyphRun } from '../measure/glyph-run.js'
import type { Font } from '../font.js'
import { renderBarcode } from './barcode-renderer.js'
import { parseMathLaTeX } from '../math/math-parser.js'
import { layoutMathFormula } from '../math/math-layout.js'
import { layoutTable, layoutTablePaged, type TableDef, type TableLayoutContext } from './table-layout.js'
import { layoutCrosstab, layoutCrosstabPaged, type CrosstabDef, type CrosstabLayoutContext } from './crosstab-layout.js'
import { ResourceResolver, type ReportResources } from './resource-resolver.js'
import { appendBorderNodes, buildBackgroundRect, lineStyleDash } from './decoration.js'
import { parseSvgPath } from '../svg/svg-path-parser.js'
import { resolveFillPaint, offsetPaintValue, scalePaintY } from './gradient.js'
import { currentWorkingDirectory } from '../runtime-environment.js'
import { forEachRenderDocumentImageReference, type RenderImageReference } from '../render-image-reference.js'

/** Map of font ID → TextMeasurer */
export type FontMap = Map<string, TextMeasurer>

// ─── Predefined page sizes (pt) ───

const PAGE_SIZES: Record<string, { width: number, height: number }> = {
  A0: { width: 2384, height: 3370 },
  A1: { width: 1684, height: 2384 },
  A2: { width: 1191, height: 1684 },
  A3: { width: 842, height: 1191 },
  A4: { width: 595, height: 842 },
  A5: { width: 420, height: 595 },
  A6: { width: 298, height: 420 },
  B4: { width: 729, height: 1032 },
  B5: { width: 516, height: 729 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
  Tabloid: { width: 792, height: 1224 },
}

/** Column-aware band types (bands that use column width / column X) */
const COLUMN_BAND_TYPES = new Set(['detail', 'groupHeader', 'groupFooter', 'columnHeader', 'columnFooter'])

// Floating-point tolerance for pagination decisions. Band heights are pt
// floats; a design whose bands exactly fill the page accumulates ulp-scale
// rounding in the cursor, which must never trigger a page break on its own.
const PAGINATION_EPSILON = 1e-6

// ─── createReport ───

const MAX_SUBREPORT_DEPTH = 10
type PageFlowKind = 'data' | 'nonData'

export interface ResolvedSubreportTemplate {
  template: ReportTemplate
  workingDirectory?: string
}

export type SubreportTemplateResolver = (
  ref: string,
  context: { workingDirectory: string },
) => ResolvedSubreportTemplate | null

export interface CreateReportOptions {
  fontMap?: FontMap
  resources?: ReportResources
  workingDirectory?: string
  resolveSubreportTemplate?: SubreportTemplateResolver
}

interface LegacyDataSourceImageFields {
  images?: Record<string, string | Uint8Array>
  imageSizes?: Record<string, { width: number; height: number }>
  imageResolver?: (ref: string) => Uint8Array | null
}

export function mergeReportResources(
  dataSource: DataSource & Record<string, unknown>,
  explicitResources?: ReportResources,
): ReportResources | undefined {
  const legacy = dataSource as DataSource & LegacyDataSourceImageFields
  const merged: ReportResources = {}
  let hasAny = false

  if (legacy.images) {
    merged.images = legacy.images
    hasAny = true
  }
  if (legacy.imageSizes) {
    merged.imageSizes = legacy.imageSizes
    hasAny = true
  }
  if (legacy.imageResolver) {
    merged.resolveImage = (ref: string): Uint8Array | null => legacy.imageResolver!(ref)
    hasAny = true
  }

  if (explicitResources?.images) {
    merged.images = explicitResources.images
    hasAny = true
  }
  if (explicitResources?.fileRoot !== undefined) {
    merged.fileRoot = explicitResources.fileRoot
    hasAny = true
  }
  if (explicitResources?.imageSizes) {
    merged.imageSizes = explicitResources.imageSizes
    hasAny = true
  }
  if (explicitResources?.resolveImage) {
    merged.resolveImage = explicitResources.resolveImage
    hasAny = true
  }
  if (explicitResources?.resolveImageSize) {
    merged.resolveImageSize = explicitResources.resolveImageSize
    hasAny = true
  }

  return hasAny ? merged : undefined
}

export function createReport(
  template: ReportTemplate,
  dataSource: DataSource & Record<string, unknown>,
  fontMap?: FontMap,
): RenderDocument
export function createReport(
  template: ReportTemplate,
  dataSource: DataSource & Record<string, unknown>,
  options?: CreateReportOptions,
): RenderDocument
export function createReport(
  template: ReportTemplate,
  dataSource: DataSource & Record<string, unknown>,
  arg3?: FontMap | CreateReportOptions,
): RenderDocument {
  let fontMap: FontMap | undefined
  let options: CreateReportOptions | undefined
  if (arg3 instanceof Map) {
    fontMap = arg3
  } else if (arg3) {
    options = arg3
    fontMap = arg3.fontMap
  }

  return createRootLayoutEngine(template, dataSource, fontMap, options).run()
}

function createRootLayoutEngine(
  template: ReportTemplate,
  dataSource: DataSource & Record<string, unknown>,
  fontMap: FontMap | undefined,
  options: CreateReportOptions | undefined,
): LayoutEngine {
  const workingDirectory = options?.workingDirectory ?? currentWorkingDirectory()
  const resources = mergeReportResources(dataSource, options?.resources)
  const resolveBareLocalFiles = options?.workingDirectory !== undefined || resources?.fileRoot !== undefined
  const resourceResolver = new ResourceResolver(resources, workingDirectory, resolveBareLocalFiles)
  return new LayoutEngine(
    template,
    dataSource,
    fontMap,
    0,
    resources,
    workingDirectory,
    options?.resolveSubreportTemplate,
    resolveBareLocalFiles,
    resourceResolver,
  )
}

// ─── Report book (combining multiple reports) ───

/** A single report that makes up a report book */
export interface ReportBookPart {
  template: ReportTemplate
  data: DataSource & Record<string, unknown>
  options?: CreateReportOptions
}

export interface ReportBookOptions {
  /**
   * Continuous page numbering. When true, each part's PAGE_NUMBER is a serial
   * number starting from the beginning of the book, and TOTAL_PAGES (resolved
   * with evaluationTime=report) becomes the total page count of the whole book.
   */
  continuousPageNumbers?: boolean
}

/**
 * Generates multiple report templates + data as a single RenderDocument.
 * Each part may have a different paper size and orientation (portrait and
 * landscape can be mixed within a single PDF).
 */
export function createReportBook(
  parts: ReportBookPart[],
  options?: ReportBookOptions,
): RenderDocument {
  if (parts.length === 0) {
    throw new Error('createReportBook: parts が空です')
  }
  const continuous = options?.continuousPageNumbers === true

  // Run layout for each part sequentially (PAGE_NUMBER offset is the cumulative page count of preceding parts)
  const engines: LayoutEngine[] = []
  let totalPages = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const engine = createRootLayoutEngine(part.template, part.data, part.options?.fontMap, part.options)
    if (continuous) {
      engine.setPageContext(totalPages, null)
    }
    engine.runLayout()
    totalPages += engine.pageCount
    engines.push(engine)
  }

  // After the total page count is fixed, resolve deferred evaluations, build documents, and combine them
  let runningOffset = 0
  const docs: RenderDocument[] = []
  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i]!
    if (continuous) {
      engine.setPageContext(runningOffset, totalPages)
    }
    runningOffset += engine.pageCount
    docs.push(engine.finalizeDocument())
  }
  return combineReports(docs)
}

/**
 * Combines multiple already-generated RenderDocuments into one.
 * Page numbers are not recalculated (use createReportBook if continuous page
 * numbering is needed).
 * - pageIndex of bookmarks / anchors is shifted to the combined position
 * - When anchor names collide, the one that appeared first takes precedence
 * - When image keys collide, keys in subsequent documents are made unique and their references are rewritten
 */
export function combineReports(docs: RenderDocument[]): RenderDocument {
  if (docs.length === 0) {
    throw new Error('combineReports: docs が空です')
  }

  const pages: RenderPage[] = []
  const bookmarks: RenderBookmark[] = []
  const anchors = new Map<string, { pageIndex: number, y: number }>()
  let images: Record<string, string | Uint8Array> | undefined
  let tagged = false
  let lang: string | undefined

  let pageOffset = 0
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!

    // Resolve image key collisions (rename and rewrite references only when contents differ)
    if (doc.images) {
      if (images === undefined) {
        images = {}
      }
      const renames = new Map<string, string>()
      for (const key of Object.keys(doc.images)) {
        const value = doc.images[key]!
        const existing = images[key]
        if (existing === undefined) {
          images[key] = value
        } else if (existing !== value) {
          const newKey = allocateBookImageKey(images, doc.images, i, key)
          images[newKey] = value
          renames.set(key, newKey)
        }
      }
      if (renames.size > 0) renameImageIds(doc, renames)
    }

    for (let p = 0; p < doc.pages.length; p++) {
      pages.push(doc.pages[p]!)
    }
    if (doc.bookmarks) {
      for (let b = 0; b < doc.bookmarks.length; b++) {
        const bm = doc.bookmarks[b]!
        bookmarks.push({ label: bm.label, level: bm.level, pageIndex: bm.pageIndex + pageOffset, y: bm.y })
      }
    }
    if (doc.anchors) {
      for (const [name, entry] of doc.anchors) {
        if (!anchors.has(name)) {
          anchors.set(name, { pageIndex: entry.pageIndex + pageOffset, y: entry.y })
        }
      }
    }
    if (doc.tagged) tagged = true
    if (lang === undefined && doc.lang !== undefined) lang = doc.lang

    pageOffset += doc.pages.length
  }

  const result: RenderDocument = { pages }
  if (bookmarks.length > 0) result.bookmarks = bookmarks
  if (anchors.size > 0) result.anchors = anchors
  if (images !== undefined && Object.keys(images).length > 0) result.images = images
  if (tagged) result.tagged = true
  if (lang !== undefined) result.lang = lang
  return result
}

function allocateBookImageKey(
  accumulated: Record<string, string | Uint8Array>,
  incoming: Record<string, string | Uint8Array>,
  documentIndex: number,
  sourceKey: string,
): string {
  const prefix = '__bk' + documentIndex + '_'
  let candidate = prefix + sourceKey
  let sequence = 1
  while (candidate in accumulated || candidate in incoming) {
    candidate = prefix + sequence++ + '_' + sourceKey
  }
  return candidate
}

function renameImageIds(document: RenderDocument, renames: Map<string, string>): void {
  forEachRenderDocumentImageReference(document, renameImageReference, renames)
}

function renameImageReference(reference: RenderImageReference, renames: Map<string, string>): void {
  const renamed = renames.get(reference.imageId)
  if (renamed !== undefined) reference.imageId = renamed
}

// ─── For collectMode ───

interface SubreportBand {
  height: number
  children: RenderNode[]
  deferredEvals?: DeferredEval[]
  /** Marker: a forced page break collected inside a subreport, propagated to the parent flow. */
  pageBreak?: boolean
}

interface PendingInlineBands {
  bands: SubreportBand[]
  /** Consumes the remaining page/column space after the content (subreport runToBottom). */
  runToBottom?: boolean
  elemX: number
  elemY: number
  elemWidth: number
  elemHeight: number
}

interface BandLayoutEntry {
  elem: ElementDef
  node: RenderNode
  effectiveHeight: number
}

interface BandLayout {
  entries: BandLayoutEntry[]
  effectiveHeight: number
  deferredEvals: DeferredEval[]
}

type DeferredEvaluationTime = 'band' | 'column' | 'page' | 'group' | 'report' | 'masterNow' | 'masterReport' | 'auto'

interface EvaluationSnapshot {
  field: Record<string, unknown>
  vars: Record<string, unknown>
  params: Record<string, unknown>
  report: ReportContext
}

interface AutoVariableTarget {
  name: string
  time: DeferredEvaluationTime
  groupName?: string
}

interface AutoBuiltinTarget {
  name: 'PAGE_NUMBER' | 'COLUMN_NUMBER' | 'REPORT_COUNT' | 'TOTAL_PAGES'
  time: DeferredEvaluationTime
}

interface AutoEvaluationState {
  snapshot: EvaluationSnapshot
  variables: AutoVariableTarget[]
  builtins: AutoBuiltinTarget[]
}

// ─── Internal: layout engine ───

export class LayoutEngine {
  private template: ReportTemplate
  private dataSource: DataSource
  private fontMap: FontMap | undefined
  private pages: RenderPage[] = []
  private currentPage!: RenderPage
  private cursorY = 0 // Y coordinate within the current page

  // Page dimensions
  private pageWidth: number
  private pageHeight: number
  private marginTop: number
  private marginBottom: number
  private marginLeft: number
  private marginRight: number
  private contentWidth: number
  private contentTop: number
  private contentBottom: number

  // Multi-column layout
  private columnCount: number
  private columnWidth: number
  private columnSpacing: number
  private currentColumn = 0
  private columnContentStartY = 0 // Y coordinate after the page header (column start position)

  // Data processing
  private currentRow: Record<string, unknown> = {}
  private previousRow: Record<string, unknown> = {}
  private variables: Record<string, unknown> = {}
  private variableAccumulators: Map<string, VariableAccumulator> = new Map()
  private returnValueAccumulators: Map<string, VariableAccumulator> = new Map()
  private returnValueVars: Set<string> = new Set()
  // Collected subreport result kept from height estimation to rendering,
  // so the child report runs once per row instead of twice.
  private subreportRunCache: Map<ElementDef, { row: unknown; engine: LayoutEngine; bands: SubreportBand[] }> = new Map()
  // Pre-increment variable values while the current row's bands render:
  // footers evaluated at a mid-row page/column break must not include the
  // not-yet-printed row. Null outside the row rendering window.
  private rowPendingSnapshot: Record<string, unknown> | null = null
  // usingCache: resolved child templates per template name within this run.
  private subreportTemplateCache: Map<string, {
    template: ReportTemplate
    workingDirectory: string
    resolveBareLocalFiles: boolean
  }> = new Map()
  private pageNumber = 0
  private reportRecordCount = 0

  // For report books: page number offset and total page count override
  private pageNumberOffset = 0
  private totalPagesOverride: number | null = null

  // Expression evaluation context (reused to reduce GC)
  private readonly reportContext: ReportContext = {
    PAGE_NUMBER: 0,
    COLUMN_NUMBER: 1,
    REPORT_COUNT: 0,
    TOTAL_PAGES: 0,
    format: formatValue,
    formatters: {},
  }

  // Groups
  private groupValues: Map<string, unknown> = new Map()
  /** Upper bound for reprintHeaderOnEachPage during group break processing (only groups below this index are reprinted) */
  private reprintGroupLimit: number | null = null

  // Style resolution
  private resolvedStyles: Map<string, ResolvedStyle> = new Map()
  // Style marked isDefault: applied to elements without an explicit style reference
  private defaultStyleDef: StyleDef | undefined
  private defaultResolvedStyle: ResolvedStyle = DEFAULT_STYLE

  // Deferred evaluation
  private deferredEvals: DeferredEval[] = []

  // footerPosition: deferred group footers placed at the bottom of the page (accumulated when a group closes)
  // dataRow: data row used for footer expression evaluation (the row at the time the group closed)
  private deferredBottomFooters: { band: BandDef, group: GroupDef, position: string, dataRow: Record<string, unknown> }[] = []

  // masterFooterPosition: the strongest footerPosition within a group-close cycle (per common report behavior)
  // FORCE > STACK > NORMAL. COLLATE does not change the master (weak).
  // inner=FORCE → master=FORCE → outer=STACK is also promoted to FORCE
  // inner=COLLATE + outer=NORMAL → master=NORMAL → COLLATE cancelled (inline)
  private masterFooterPosition: 'normal' | 'stackAtBottom' | 'forceAtBottom' = 'normal'

  // For isPrintRepeatedValues: previous value tracking
  private previousValues: Map<string, string> = new Map()

  // collectMode (for subreports)
  private collectMode = false
  private collectedBands: SubreportBand[] = []
  private pendingInlineBandsList: PendingInlineBands[] = []

  // printOrder
  private printOrder: 'vertical' | 'horizontal' = 'vertical'
  private horizontalRowStartY = 0
  private horizontalRowMaxH = 0
  private pageStartConsumed = false
  private currentPageFlowKind: PageFlowKind = 'nonData'

  // Bookmarks / anchors
  private bookmarks: RenderBookmark[] = []
  private anchors = new Map<string, { pageIndex: number, y: number }>()

  // Resource resolution (currently implemented for images)
  private readonly resourceResolver: ResourceResolver
  private readonly reportResources: ReportResources | undefined

  /** X coordinate of the current column */
  private get columnX(): number {
    return this.marginLeft + this.currentColumn * (this.columnWidth + this.columnSpacing)
  }

  private isTitleBandStartNewPage(): boolean {
    return this.template.bands.title?.startNewPage ?? this.template.titleNewPage ?? false
  }

  private isSummaryBandStartNewPage(): boolean {
    return this.template.bands.summary?.startNewPage ?? this.template.summaryNewPage ?? false
  }

  private getPageFooterHeight(isLastPage: boolean = false): number {
    const footerBand = isLastPage && this.template.bands.lastPageFooter
      ? this.template.bands.lastPageFooter
      : this.template.bands.pageFooter
    return footerBand?.height ?? 0
  }

  private getColumnFooterHeight(): number {
    return this.usesColumnFooter() ? (this.template.bands.columnFooter?.height ?? 0) : 0
  }

  private usesColumnHeader(flowKind: PageFlowKind = this.currentPageFlowKind): boolean {
    return flowKind === 'data'
  }

  private usesColumnFooter(flowKind: PageFlowKind = this.currentPageFlowKind): boolean {
    return flowKind === 'data'
  }

  private getDeferredBottomFooterHeight(): number {
    let total = 0
    for (let i = 0; i < this.deferredBottomFooters.length; i++) {
      total += this.deferredBottomFooters[i]!.band.height
    }
    return total
  }

  private getOverflowBottomY(): number {
    return this.contentBottom
      - this.getPageFooterHeight()
      - this.getColumnFooterHeight()
      - this.getDeferredBottomFooterHeight()
  }

  private getFreshPageAvailableHeight(flowKind: PageFlowKind = this.currentPageFlowKind): number {
    return this.contentBottom
      - this.contentTop
      - (this.template.bands.pageHeader?.height ?? 0)
      - this.getPageFooterHeight()
      - this.getColumnFooterHeightForFlow(flowKind)
  }

  private getColumnFooterHeightForFlow(flowKind: PageFlowKind): number {
    return this.usesColumnFooter(flowKind) ? (this.template.bands.columnFooter?.height ?? 0) : 0
  }

  /**
   * Column footer position: pinned to the bottom of the column area, or right
   * below the column content when floatColumnFooter is enabled.
   */
  private resolveColumnFooterY(columnFooter: BandDef): number {
    const bottomY = this.contentBottom - this.getPageFooterHeight() - columnFooter.height
    if (this.template.floatColumnFooter && this.cursorY < bottomY) {
      return this.cursorY
    }
    return bottomY
  }

  private shouldBreakBeforeBand(band: BandDef, bandType: string): boolean {
    if (!band.startNewPage) return false
    if (bandType === 'title' || bandType === 'summary') return false
    if (bandType === 'background' || bandType === 'pageFooter' || bandType === 'columnFooter') return false
    return this.pageStartConsumed
  }

  private shouldConsumePageStart(bandType: string): boolean {
    return bandType === 'title'
      || bandType === 'detail'
      || bandType === 'groupFooter'
      || bandType === 'summary'
      || bandType === 'noData'
  }

  private willRenderBand(band: BandDef | undefined): boolean {
    if (!band) return false
    if (!band.printWhenExpression) return true
    return Boolean(this.evalExpr(band.printWhenExpression))
  }

  constructor(
    template: ReportTemplate,
    dataSource: DataSource,
    fontMap: FontMap | undefined,
    private subreportDepth: number,
    reportResources: ReportResources | undefined,
    private workingDirectory: string,
    private subreportResolver: SubreportTemplateResolver | undefined,
    private resolveBareLocalFiles: boolean,
    resourceResolver: ResourceResolver,
  ) {
    this.template = template
    this.dataSource = dataSource
    this.fontMap = fontMap
    this.reportResources = reportResources
    this.resourceResolver = resourceResolver

    // Resolve page size
    const pageDef = template.page
    let w: number, h: number
    if (pageDef.size && PAGE_SIZES[pageDef.size]) {
      w = PAGE_SIZES[pageDef.size]!.width
      h = PAGE_SIZES[pageDef.size]!.height
    } else {
      w = pageDef.width ?? 595
      h = pageDef.height ?? 842
    }
    if (pageDef.orientation === 'landscape') {
      [w, h] = [h, w]
    }
    this.pageWidth = w
    this.pageHeight = h

    const m = pageDef.margins ?? { top: 0, bottom: 0, left: 0, right: 0 }
    this.marginTop = m.top
    this.marginBottom = m.bottom
    this.marginLeft = m.left
    this.marginRight = m.right
    this.contentWidth = w - m.left - m.right
    this.contentTop = m.top
    this.contentBottom = h - m.bottom

    // Multi-column settings
    const colDef = template.columns
    this.columnCount = colDef?.count ?? 1
    this.columnSpacing = colDef?.spacing ?? 0
    if (this.columnCount > 1) {
      this.columnWidth = colDef?.width ?? (this.contentWidth - (this.columnCount - 1) * this.columnSpacing) / this.columnCount
    } else {
      this.columnWidth = this.contentWidth
    }

    // printOrder setting
    this.printOrder = colDef?.printOrder ?? 'vertical'

    // Custom formatter setup
    if (template.formatters) {
      this.reportContext.formatters = template.formatters
    }

    // Resolve styles
    this.resolveStyles()

    // Initialize variables
    this.initVariables()
  }

  run(): RenderDocument {
    this.runLayout()
    return this.finalizeDocument()
  }

  /**
   * For report books: run layout only, deferring resolution of deferred
   * evaluations and document construction.
   * Call setPageContext() → finalizeDocument() once all parts' page counts are fixed.
   */
  runLayout(): void {
    const rows = this.dataSource.rows

    // No data rows
    if (rows.length === 0) {
      this.startNewPage()
      this.renderBand(this.template.bands.pageHeader, 'pageHeader')
      this.renderNoDataBand()
      this.finalizePage(true)
      return
    }

    this.startNewPage()

    // First page: Title → PageHeader → ColumnHeader
    const titleStartsOnNewPage = this.isTitleBandStartNewPage()
    this.renderBand(this.template.bands.title, 'title', false)
    if (titleStartsOnNewPage && this.template.bands.title) {
      // Per common report behavior: do not render pageFooter on the title page
      this.finalizePage(false, true)
      this.startNewPage('data')
      // startNewPage() has already rendered pageHeader + columnHeader on page 2
    } else {
      this.renderBand(this.template.bands.pageHeader, 'pageHeader', false)
      this.columnContentStartY = this.cursorY
      this.currentPageFlowKind = 'data'
      this.renderColumnHeaders()
    }

    // Process data rows
    const isHorizontal = this.printOrder === 'horizontal' && this.columnCount > 1
    if (isHorizontal) {
      this.horizontalRowStartY = this.cursorY
      this.horizontalRowMaxH = 0
    }

    for (let i = 0; i < rows.length; i++) {
      this.previousRow = i > 0 ? rows[i - 1]! : rows[i]!
      this.currentRow = rows[i]!
      this.reportRecordCount++

      // Group processing: close footers/resets first, then calculate the new
      // row's variables so headers and details see running totals that
      // include the current row, then open headers.
      const openedGroup = this.processGroupBreaks(i === 0)
      this.updateVariables()
      if (openedGroup >= 0) this.renderGroupHeadersFrom(openedGroup)

      if (isHorizontal) {
        // Horizontal printing: overflow check at the start of a row (column 0)
        if (this.currentColumn === 0) {
          this.horizontalRowStartY = this.cursorY
          this.horizontalRowMaxH = 0
          // Overflow check based on detail height
          const details = this.template.bands.details ?? []
          let detailH = 0
          for (let d = 0; d < details.length; d++) detailH += this.estimateBandHeight(details[d]!)
          if (detailH > 0 && this.needsOverflow(detailH)) {
            this.breakPage()
            this.horizontalRowStartY = this.cursorY
          }
        }

        // Reset cursor to the row start position
        this.cursorY = this.horizontalRowStartY

        // Render detail bands
        const details = this.template.bands.details ?? []
        for (const detail of details) {
          this.renderBand(detail, 'detail')
        }

        // Track the effective height of this column
        const colHeight = this.cursorY - this.horizontalRowStartY
        if (colHeight > this.horizontalRowMaxH) this.horizontalRowMaxH = colHeight

        // Move to the next column
        this.currentColumn++
        if (this.currentColumn >= this.columnCount) {
          // Row complete: reset column and advance cursorY by the row's max height
          this.currentColumn = 0
          this.cursorY = this.horizontalRowStartY + this.horizontalRowMaxH
        }
      } else {
        // Detail bands (traditional vertical printing)
        const details = this.template.bands.details ?? []
        for (const detail of details) {
          this.renderBand(detail, 'detail')
        }
      }
    }

    // Horizontal printing: finalize cursorY for the last incomplete row
    if (isHorizontal && this.currentColumn > 0) {
      this.cursorY = this.horizontalRowStartY + this.horizontalRowMaxH
      this.currentColumn = 0
    }

    // Final group footers
    this.closeAllGroups()

    // Summary band
    const summaryBand = this.template.bands.summary
    const summaryWillRender = this.willRenderBand(summaryBand)
    const summaryStartsOnNewPage = this.isSummaryBandStartNewPage()
    if (summaryStartsOnNewPage && summaryWillRender) {
      // Per common report behavior: controlled by summaryWithPageHeaderAndFooter
      if (this.template.summaryWithPageHeaderAndFooter) {
        // Normal page break with pageHeader/pageFooter
        this.breakPage('nonData')
      } else {
        // Default: no pageHeader/pageFooter on the summary page
        this.finalizePage(false)
        this.startSummaryPage()
      }
    }
    if (summaryWillRender) {
      this.currentPageFlowKind = 'nonData'
    }
    this.renderBand(summaryBand, 'summary', false)

    // summaryNewPage + !summaryWithPageHeaderAndFooter → finalize without pageFooter
    const skipSummaryFooter = summaryStartsOnNewPage
      && summaryBand !== undefined
      && !this.template.summaryWithPageHeaderAndFooter

    // When the last page footer is taller than the regular page footer, the
    // overflow checks reserved less space than it needs: move it to a fresh
    // page when the content already extends into its area.
    const lastFooter = this.template.bands.lastPageFooter
    if (!skipSummaryFooter && lastFooter && this.cursorY > this.contentBottom - lastFooter.height) {
      this.breakPage()
    }
    this.finalizePage(true, skipSummaryFooter)
  }

  /** Resolves deferred evaluations and builds the final document */
  finalizeDocument(): RenderDocument {
    this.resolveDeferredEvals()
    const doc: RenderDocument = { pages: this.pages }
    if (this.bookmarks.length > 0) doc.bookmarks = this.bookmarks
    if (this.anchors.size > 0) doc.anchors = this.anchors
    this.mergeDocImages(doc)
    return doc
  }

  /** Number of pages laid out */
  get pageCount(): number {
    return this.pages.length
  }

  /**
   * Sets the page number context for report books.
   * offset: total number of pages placed before this part (added to PAGE_NUMBER)
   * totalPages: total page count of the whole book (overrides TOTAL_PAGES)
   * Set offset before runLayout(), and totalPages before finalizeDocument().
   */
  setPageContext(offset: number, totalPages: number | null): void {
    this.pageNumberOffset = offset
    this.totalPagesOverride = totalPages
  }

  /**
   * Collects bands in collectMode (for subreports).
   * No page management — pageHeader / pageFooter / background are not collected.
   * Results accumulate in this.collectedBands.
   */
  runCollect(): SubreportBand[] {
    this.collectMode = true
    this.collectedBands = []
    this.cursorY = 0

    const rows = this.dataSource.rows

    // No data rows
    if (rows.length === 0) {
      this.renderNoDataBand()
      this.resolveDeferredByTime('column')
      this.resolveDeferredByTime('page')
      this.resolveDeferredByTime('report')
      const result = this.collectedBands
      this.collectMode = false
      return result
    }

    // Title
    this.renderBand(this.template.bands.title, 'title')

    // ColumnHeader
    this.currentPageFlowKind = 'data'
    this.renderBand(this.template.bands.columnHeader, 'columnHeader')

    // Process data rows
    for (let i = 0; i < rows.length; i++) {
      this.previousRow = i > 0 ? rows[i - 1]! : rows[i]!
      this.currentRow = rows[i]!
      this.reportRecordCount++

      // Group processing: footers/resets → variable calculation → headers,
      // so running totals include the current row (see runLayout).
      const openedGroup = this.processGroupBreaks(i === 0)
      this.updateVariables()
      if (openedGroup >= 0) this.renderGroupHeadersFrom(openedGroup)

      // Detail bands
      const details = this.template.bands.details ?? []
      for (const detail of details) {
        this.renderBand(detail, 'detail')
      }
    }

    // Final group footers
    this.closeAllGroups()

    // Summary band
    if (this.template.bands.summary) {
      this.currentPageFlowKind = 'nonData'
    }
    this.renderBand(this.template.bands.summary, 'summary')

    // Page/column finalize does not run in collectMode, so resolve
    // remaining deferred evaluations (page/column/report level) here
    this.resolveDeferredByTime('column')
    this.resolveDeferredByTime('page')
    this.resolveDeferredByTime('report')

    const result = this.collectedBands
    this.collectMode = false
    return result
  }

  // ─── Page management ───

  private startNewPage(flowKind: PageFlowKind = this.currentPageFlowKind): void {
    if (this.collectMode) return

    this.pageNumber++
    this.currentColumn = 0
    this.pageStartConsumed = false
    this.currentPageFlowKind = flowKind
    this.currentPage = {
      width: this.pageWidth,
      height: this.pageHeight,
      children: [],
      transparencyGroup: this.template.page.transparencyGroup,
    }
    this.pages.push(this.currentPage)
    this.cursorY = this.contentTop

    // Page-reset variables
    this.resetPageVariables()
    // A new page begins at column 0, so column-reset variables restart here too
    // (common report behavior resets column variables at every page start, not only on a
    // mid-page column break).
    this.resetColumnVariables()

    // Background band
    this.renderBand(this.template.bands.background, 'background')

    if (this.pages.length === 1) {
      // First physical page of the document: run() controls the
      // Title → PageHeader → ColumnHeader order, so only the background is
      // rendered here. Keyed on pages.length rather than pageNumber, because a
      // group's resetPageNumber makes PAGE_NUMBER===1 recur mid-document and
      // those pages must still render their pageHeader/columnHeader.
    } else {
      // Page 2 onward: PageHeader → ColumnHeader
      this.renderBand(this.template.bands.pageHeader, 'pageHeader', false)
      this.columnContentStartY = this.cursorY
      if (this.usesColumnHeader(flowKind)) {
        this.renderColumnHeaders()
      }
    }

    // Horizontal printing: reset the row start position
    if (this.printOrder === 'horizontal') {
      this.horizontalRowStartY = this.cursorY
      this.horizontalRowMaxH = 0
    }
  }

  /**
   * Renders the columnHeader for all columns.
   * In horizontal mode, places a columnHeader at each column position.
   * In vertical mode, only the current column (column 0).
   */
  private renderColumnHeaders(): void {
    const ch = this.template.bands.columnHeader
    if (!ch) return
    if (this.printOrder === 'horizontal' && this.columnCount > 1) {
      const savedY = this.cursorY
      for (let c = 0; c < this.columnCount; c++) {
        this.currentColumn = c
        this.cursorY = savedY
        this.renderBand(ch, 'columnHeader', false)
      }
      this.currentColumn = 0
      this.cursorY = savedY + this.estimateBandHeight(ch)
    } else {
      this.renderBand(ch, 'columnHeader', false)
    }
  }

  /** Starts a dedicated summary page (no pageHeader/columnHeader) */
  private startSummaryPage(): void {
    if (this.collectMode) return

    this.pageNumber++
    this.currentColumn = 0
    this.pageStartConsumed = false
    this.currentPageFlowKind = 'nonData'
    this.currentPage = {
      width: this.pageWidth,
      height: this.pageHeight,
      children: [],
      transparencyGroup: this.template.page.transparencyGroup,
    }
    this.pages.push(this.currentPage)
    this.cursorY = this.contentTop

    this.resetPageVariables()

    // Render background only (no pageHeader/columnHeader)
    this.renderBand(this.template.bands.background, 'background')
  }

  private finalizePage(isLastPage: boolean = false, skipPageFooter: boolean = false): void {
    if (this.collectMode) return

    // Column footer (footer of the current column)
    if (this.usesColumnFooter()) {
      const columnFooter = this.template.bands.columnFooter
      if (columnFooter) {
        const footerY = this.resolveColumnFooterY(columnFooter)
        this.renderFixedBandAt(columnFooter, footerY, 'columnFooter')
      }
    }

    // Page footer / last page footer (skipped when skipPageFooter — e.g. the title page with titleNewPage)
    if (!skipPageFooter) {
      const footerBand = isLastPage && this.template.bands.lastPageFooter
        ? this.template.bands.lastPageFooter
        : this.template.bands.pageFooter
      const pageFooterHeight = footerBand?.height ?? 0

      // footerPosition: group footers placed at the bottom of the page (accumulated when groups close)
      // Expressions are evaluated with the data row from when the group closed
      if (this.deferredBottomFooters.length > 0) {
        const savedRow = this.currentRow
        let bottomY = this.contentBottom - pageFooterHeight
        for (let i = this.deferredBottomFooters.length - 1; i >= 0; i--) {
          const entry = this.deferredBottomFooters[i]!
          this.currentRow = entry.dataRow
          bottomY -= entry.band.height
          this.renderFixedBandAt(entry.band, bottomY, 'groupFooter')
        }
        this.currentRow = savedRow
        this.deferredBottomFooters.length = 0
      }

      if (footerBand) {
        // The footer is placed from the bottom edge of the page
        const footerY = this.contentBottom - footerBand.height
        this.renderFixedBandAt(footerBand, footerY, 'pageFooter')
      }
    }

    // Column-completion deferreds are resolved after the columnFooter is rendered
    this.resolveDeferredByTime('column')

    // Resolve page-level deferred evaluations
    this.resolveDeferredByTime('page')
  }

  private needsOverflow(bandHeight: number): boolean {
    if (this.collectMode) return false
    return this.cursorY + bandHeight > this.getOverflowBottomY() + PAGINATION_EPSILON
  }

  private estimateBandHeight(band: BandDef): number {
    let estimatedHeight = band.height
    const contentBottom = this.estimateBandContentBottom(band)
    if (contentBottom > estimatedHeight) {
      estimatedHeight = contentBottom
    }
    return estimatedHeight
  }

  private estimateBandContentBottom(band: BandDef): number {
    let contentBottom = 0
    for (const rawElem of band.elements ?? []) {
      // Height estimation also uses the same definition as rendering (after onBeforeRender overrides)
      const elem = this.resolveElementForRender(rawElem)
      if (!elem) continue
      const bottom = elem.y + this.estimateElementHeight(elem)
      if (bottom > contentBottom) {
        contentBottom = bottom
      }
    }
    return contentBottom
  }

  private estimateElementHeight(elem: ElementDef): number {
    switch (elem.type) {
      case 'textField':
        return this.estimateTextFieldHeight(elem)
      case 'math':
        return this.estimateMathHeight(elem)
      case 'table':
        return this.estimateTableHeight(elem as import('../types/template.js').TableElementDef)
      case 'crosstab':
        return this.estimateCrosstabHeight(elem as import('../types/template.js').CrosstabElementDef)
      case 'subreport':
        return this.estimateSubreportHeight(elem)
      default:
        return elem.height
    }
  }

  private estimateTextFieldHeight(elem: ElementDef & { type: 'textField' }): number {
    if (elem.evaluationTime && elem.evaluationTime !== 'now') return elem.height

    const rawValue = this.evalExpr(elem.expression)
    let text: string
    if (rawValue == null) {
      text = elem.blankWhenNull ? '' : 'null'
    } else if (elem.pattern) {
      text = this.formatWithPattern(rawValue, elem.pattern)
    } else {
      text = String(rawValue)
    }

    if (elem.isPrintRepeatedValues === false) {
      const elemKey = `${elem.x},${elem.y},${elem.expression}`
      const prevValue = this.previousValues.get(elemKey)
      if (prevValue === text) {
        return elem.isRemoveLineWhenBlank ? 0 : elem.height
      }
    }

    if (!elem.stretchWithOverflow) return elem.height

    const style = this.getStyle(elem)
    const measurer = this.fontMap?.get(style.fontFamily) ?? null
    const node = renderTextToGroup(text, elem, style, measurer, true)
    return node.type === 'group' ? node.height : elem.height
  }

  private estimateMathHeight(elem: ElementDef & { type: 'math' }): number {
    const formula = String(this.evalExpr(elem.formula))
    if (!formula) return 0

    const style = this.getStyle(elem)
    const fontId = elem.mathFontFamily ?? style.fontFamily ?? 'default'
    const measurer = this.fontMap?.get(fontId)
    if (!measurer) return 0

    const font = measurer.font
    const fontSize = elem.fontSize ?? style.fontSize ?? 12
    const box = layoutMathFormula(parseMathLaTeX(formula), font, fontId, fontSize, elem.color ?? elem.forecolor ?? style.forecolor ?? '#000000')
    return Math.max(elem.height, box.height + box.depth)
  }

  private estimateTableHeight(elem: import('../types/template.js').TableElementDef): number {
    const tableDef: TableDef = {
      columns: elem.columns,
      headerRows: elem.headerRows as any,
      detailRows: elem.detailRows as any,
      footerRows: elem.footerRows as any,
    }
    const self = this
    const context: TableLayoutContext = {
      resolveExpression: (expression: string) => {
        const result = self.evalExpr(expression)
        return result != null ? String(result) : ''
      },
      fontMap: this.fontMap,
      renderCellElements(elements: unknown[], cellWidth: number, cellHeight: number): RenderNode[] {
        const nodes: RenderNode[] = []
        const elems = elements as import('../types/template.js').ElementDef[]
        for (let i = 0; i < elems.length; i++) {
          const node = self.renderElement(elems[i]!)
          if (node) nodes.push(node)
        }
        return nodes
      },
      measureCellElements(elements: unknown[], cellWidth: number): number {
        const elems = elements as import('../types/template.js').ElementDef[]
        let maxBottom = 0
        for (let i = 0; i < elems.length; i++) {
          const el = elems[i]!
          const bottom = el.y + el.height
          if (bottom > maxBottom) maxBottom = bottom
        }
        return maxBottom
      },
    }
    return layoutTable(tableDef, elem.x, elem.y, elem.width, this.resolveTableDataRows(elem), context).height
  }

  /** Resolves the table's detail row data (subdataset when dataSourceExpression is set, main data source when omitted) */
  private resolveTableDataRows(elem: import('../types/template.js').TableElementDef): Record<string, unknown>[] {
    if (!elem.dataSourceExpression) return this.dataSource.rows
    const result = this.evalExpr(elem.dataSourceExpression)
    if (!Array.isArray(result)) {
      throw new Error(`Table dataSourceExpression must evaluate to an array of rows, got ${result === null ? 'null' : typeof result}`)
    }
    return result as Record<string, unknown>[]
  }

  private estimateCrosstabHeight(elem: import('../types/template.js').CrosstabElementDef): number {
    const crosstabDef: CrosstabDef = {
      rowGroups: elem.rowGroups,
      columnGroups: elem.columnGroups,
      measures: elem.measures,
      rowHeaderWidth: elem.rowHeaderWidth,
      columnHeaderHeight: elem.columnHeaderHeight,
      cellWidth: elem.cellWidth,
      cellHeight: elem.cellHeight,
      border: elem.border,
      showSubtotals: elem.showSubtotals,
      showGrandTotal: elem.showGrandTotal,
    }
    const context: CrosstabLayoutContext = {
      measurer: this.fontMap?.get('default'),
    }
    let rows: Record<string, unknown>[]
    if (elem.dataSourceExpression) {
      const result = this.evalExpr(elem.dataSourceExpression)
      rows = Array.isArray(result) ? result as Record<string, unknown>[] : this.dataSource.rows
    } else {
      rows = this.dataSource.rows
    }
    return layoutCrosstab(crosstabDef, elem.x, elem.y, rows, context).height
  }

  private estimateSubreportHeight(elem: ElementDef & { type: 'subreport' }): number {
    const childEngine = this.createSubreportEngine(elem)
    if (!childEngine) return 0

    const bands = childEngine.runCollect()
    // Keep the collected result so renderSubreport does not run the child
    // report a second time for the same row (exponential cost when nested).
    this.subreportRunCache.set(elem, { row: this.currentRow, engine: childEngine, bands })
    let totalHeight = 0
    for (let i = 0; i < bands.length; i++) {
      totalHeight += bands[i]!.height
    }
    return totalHeight
  }

  private createSubreportEngine(elem: ElementDef & { type: 'subreport' }): LayoutEngine | null {
    const templateName = String(this.evalExpr(elem.templateExpression))
    let subTemplate: ReportTemplate | undefined
    let childWorkingDirectory = this.workingDirectory
    let childResolveBareLocalFiles = this.resolveBareLocalFiles

    // usingCache: reuse the resolved child template per name within this run.
    const cachedTemplate = elem.usingCache ? this.subreportTemplateCache.get(templateName) : undefined
    if (cachedTemplate) {
      subTemplate = cachedTemplate.template
      childWorkingDirectory = cachedTemplate.workingDirectory
      childResolveBareLocalFiles = cachedTemplate.resolveBareLocalFiles
    } else if (this.subreportResolver) {
      const resolved = this.subreportResolver(templateName, {
        workingDirectory: this.workingDirectory,
      })
      if (resolved) {
        subTemplate = resolved.template
        if (resolved.workingDirectory !== undefined) {
          childWorkingDirectory = resolved.workingDirectory
          childResolveBareLocalFiles = true
        }
        if (elem.usingCache) {
          this.subreportTemplateCache.set(templateName, {
            template: subTemplate,
            workingDirectory: childWorkingDirectory,
            resolveBareLocalFiles: childResolveBareLocalFiles,
          })
        }
      }
    }
    if (!subTemplate) return null

    let subRows: Record<string, unknown>[]
    if (elem.dataSourceExpression) {
      const result = this.evalExpr(elem.dataSourceExpression)
      subRows = Array.isArray(result) ? result : []
    } else {
      subRows = this.dataSource.rows
    }

    const subParams: Record<string, unknown> = {}
    // parametersMapExpression first: individual parameters take precedence.
    if (elem.parametersMapExpression) {
      const map = this.evalExpr(elem.parametersMapExpression)
      if (map && typeof map === 'object') {
        for (const key of Object.keys(map as Record<string, unknown>)) {
          subParams[key] = (map as Record<string, unknown>)[key]
        }
      }
    }
    for (const param of elem.parameters ?? []) {
      subParams[param.name] = this.evalExpr(param.expression)
    }

    if (this.subreportDepth + 1 > MAX_SUBREPORT_DEPTH) {
      throw new Error(`Subreport nesting depth exceeded (max ${MAX_SUBREPORT_DEPTH})`)
    }

    const subDataSource: DataSource = {
      rows: subRows,
      parameters: subParams,
    }

    return new LayoutEngine(
      subTemplate,
      subDataSource,
      this.fontMap,
      this.subreportDepth + 1,
      this.reportResources,
      childWorkingDirectory,
      this.subreportResolver,
      childResolveBareLocalFiles,
      this.resourceResolver.forWorkingDirectory(childWorkingDirectory, childResolveBareLocalFiles),
    )
  }

  private breakColumnOrPage(bandType: string): void {
    const isColumnBand = COLUMN_BAND_TYPES.has(bandType)
    if (this.columnCount > 1 && isColumnBand && this.currentColumn < this.columnCount - 1) {
      this.breakColumn()
    } else {
      this.breakPage()
    }
  }

  private breakColumn(): void {
    // Mid-row break: the footer sees the values before the current row's increment.
    const snapshot = this.rowPendingSnapshot
    const liveVariables = this.variables
    if (snapshot) this.variables = snapshot

    // Column Footer
    const columnFooter = this.template.bands.columnFooter
    if (columnFooter) {
      const footerY = this.resolveColumnFooterY(columnFooter)
      this.renderFixedBandAt(columnFooter, footerY, 'columnFooter')
    }

    // Resolve column-level deferred evaluations
    this.resolveDeferredByTime('column')

    if (snapshot) this.variables = liveVariables

    // Column-reset variables
    this.resetColumnVariables()

    // Move to the next column
    this.currentColumn++
    this.cursorY = this.columnContentStartY

    // Column Header
    this.renderBand(this.template.bands.columnHeader, 'columnHeader', false)
  }

  private breakPage(nextPageFlowKind: PageFlowKind = this.currentPageFlowKind, resetPageNumber: boolean = false): void {
    if (this.collectMode) {
      // Collecting for a subreport: record the break as a marker band so the
      // parent flow performs the actual page break at placement time.
      this.collectedBands.push({ height: 0, children: [], pageBreak: true })
      this.pageStartConsumed = false
      return
    }

    // Mid-row break: footers see the values before the current row's increment.
    const snapshot = this.rowPendingSnapshot
    const liveVariables = this.variables
    if (snapshot) this.variables = snapshot
    this.finalizePage()
    if (snapshot) this.variables = liveVariables
    // A common report engine fills the closing page's
    // footer first and only then resets the page number, so the closing page
    // shows its real number while the new page restarts at 1.
    if (resetPageNumber) this.pageNumber = 0
    this.startNewPage(nextPageFlowKind)

    // Reprint group headers (during group break processing, only outer groups that are already open)
    if (nextPageFlowKind === 'data') {
      const groups = this.template.groups ?? []
      const limit = this.reprintGroupLimit ?? groups.length
      for (let i = 0; i < limit; i++) {
        const group = groups[i]!
        if (group.reprintHeaderOnEachPage && group.header) {
          this.renderBand(group.header, 'groupHeader')
        }
      }
    }
  }

  // ─── Band rendering ───

  private renderBand(band: BandDef | undefined, bandType: string, honorStartNewPage: boolean = true): void {
    if (!band) return

    // collectMode: skip pageHeader/pageFooter/background/columnFooter
    if (this.collectMode) {
      if (bandType === 'background' || bandType === 'pageHeader' || bandType === 'pageFooter' || bandType === 'columnFooter') {
        return
      }
    }

    // printWhenExpression
    if (band.printWhenExpression) {
      const result = this.evalExpr(band.printWhenExpression)
      if (!result) return
    }

    if (honorStartNewPage && this.shouldBreakBeforeBand(band, bandType)) {
      this.breakPage()
    }

    // A break element splits the band at its position: elements above the break
    // stay on the current page, elements below continue after the forced break.
    if (this.renderBandWithBreaks(band, bandType)) return

    const estimatedHeight = this.estimateBandHeight(band)
    const spacingBefore = band.spacingBefore ?? 0
    const spacingAfter = band.spacingAfter ?? 0
    const totalHeight = spacingBefore + estimatedHeight + spacingAfter

    // Page/column overflow check (excluding background/pageHeader/pageFooter/columnFooter)
    const noOverflowCheck = bandType === 'background' || bandType === 'pageHeader' || bandType === 'columnHeader' || bandType === 'pageFooter' || bandType === 'columnFooter'
    if (!noOverflowCheck && this.needsOverflow(totalHeight)) {
      // Unspecified splitType defaults to stretch, per common report semantics.
      const splitType = band.splitType ?? 'stretch'
      if (this.bandHasInlineFlowElements(band)) {
        // Bands with inline-flow elements (subreports/tables/crosstabs)
        // paginate through placeInlineBands, which splits at row boundaries.
        // For 'prevent', move the whole band to a fresh page/column first
        // when it fits there.
        if (splitType === 'prevent') {
          const freshAvail = this.getFreshPageAvailableHeight()
          if (totalHeight <= freshAvail) {
            this.breakColumnOrPage(bandType)
          }
        }
      } else if (splitType === 'immediate') {
        // A single element taller than any fresh page cannot be moved as a
        // whole: divert to stretch splitting (windowed continuation) so no
        // content is lost.
        if (this.bandHasElementTallerThan(band, this.getFreshPageAvailableHeight())) {
          this.renderStretchBand(band, bandType, spacingBefore, spacingAfter)
          if (this.shouldConsumePageStart(bandType)) this.pageStartConsumed = true
          return
        }
        this.cursorY += spacingBefore
        this.renderBandSplit(band, bandType)
        this.resolveDeferredByTime('band')
        this.cursorY += spacingAfter
        if (this.shouldConsumePageStart(bandType)) this.pageStartConsumed = true
        return
      } else if (splitType === 'stretch') {
        this.renderStretchBand(band, bandType, spacingBefore, spacingAfter)
        if (this.shouldConsumePageStart(bandType)) this.pageStartConsumed = true
        return
      } else {
        // 'prevent': prevent splitting on the first attempt by breaking to a
        // new page/column, then render the entire band there.
        const freshAvail = this.getFreshPageAvailableHeight()
        if (totalHeight <= freshAvail) {
          this.breakColumnOrPage(bandType)
        } else {
          // The band cannot fit even on a fresh page: move to a fresh
          // page/column (unless already at one) and let it split there —
          // prevention only applies to the first attempt.
          if (this.pageStartConsumed) {
            this.breakColumnOrPage(bandType)
          }
          this.renderStretchBand(band, bandType, spacingBefore, spacingAfter)
          if (this.shouldConsumePageStart(bandType)) this.pageStartConsumed = true
          return
        }
      }
    }

    // spacingBefore: advance the cursor before the band
    this.cursorY += spacingBefore

    this.pendingInlineBandsList.length = 0
    const effectiveHeight = this.renderBandAt(band, this.cursorY, bandType)

    // When inline bands from subreports exist
    if (this.pendingInlineBandsList.length > 0) {
      const pendingList = this.pendingInlineBandsList.slice()
      this.pendingInlineBandsList.length = 0

      // Use the start position of the topmost subreport as the reference.
      // The bottom edge uses the actual collected content height (or the
      // declared box when the content is shorter), so the space below the
      // subreport stays consistent with the stretched band extent.
      let minElemY = pendingList[0]!.elemY
      let maxBottom = 0
      for (let i = 0; i < pendingList.length; i++) {
        const p = pendingList[i]!
        if (p.elemY < minElemY) minElemY = p.elemY
        let contentHeight = 0
        for (let m = 0; m < p.bands.length; m++) contentHeight += p.bands[m]!.height
        const extent = contentHeight > p.elemHeight ? contentHeight : p.elemHeight
        const bottom = p.elemY + extent
        if (bottom > maxBottom) maxBottom = bottom
      }

      // collectMode: renderBandAt has already pushed the full-size band to collectedBands
      // Shrink it to the height before the subreport start position to avoid double counting
      if (this.collectMode && this.collectedBands.length > 0) {
        this.collectedBands[this.collectedBands.length - 1]!.height = minElemY
      }

      // Subreport start position within the parent band
      const inlineStartY = this.cursorY + minElemY
      // Remaining height of the parent band (the part below the subreport)
      const afterSubreport = effectiveHeight - maxBottom

      // Set the cursor to the subreport start position
      this.cursorY = inlineStartY

      // Place inline bands for each subreport. Subreports placed side by side
      // in the band each start from the common start line plus their own Y
      // offset; the cursor ends at the lowest end among them.
      const placementStartPage = this.pageNumber
      if (this.collectMode) {
        for (let i = 0; i < pendingList.length; i++) {
          const pending = pendingList[i]!
          const savedCursorY = this.cursorY
          this.cursorY = this.cursorY + (pending.elemY - minElemY)
          this.placeInlineBands(pending)
          // With multiple subreports, keep the cursor at the maximum
          if (i < pendingList.length - 1) {
            const nextCursorY = this.cursorY
            this.cursorY = savedCursorY > nextCursorY ? savedCursorY : nextCursorY
          }
        }
      } else {
        let maxEndCursorY = this.cursorY
        let maxEndPage = -1
        for (let i = 0; i < pendingList.length; i++) {
          const pending = pendingList[i]!
          if (this.pageNumber === placementStartPage) {
            this.cursorY = inlineStartY + (pending.elemY - minElemY)
          }
          // After an earlier subreport flowed to a new page, continue sequentially.
          this.placeInlineBands(pending)
          if (this.pageNumber > maxEndPage || (this.pageNumber === maxEndPage && this.cursorY > maxEndCursorY)) {
            maxEndPage = this.pageNumber
            maxEndCursorY = this.cursorY
          }
        }
        this.cursorY = maxEndCursorY
      }

      // collectMode: padding when the subreport's actual content is less than the reserved height
      if (this.collectMode) {
        const reservedInlineHeight = maxBottom - minElemY
        const actualInlineHeight = this.cursorY - inlineStartY
        const padding = reservedInlineHeight - actualInlineHeight
        if (padding > 0) {
          this.collectedBands.push({ height: padding, children: [] })
          this.cursorY += padding
        }
      }

      // Adjust the cursor: advance at least by the parent band's height
      if (afterSubreport > 0) {
        if (this.collectMode) {
          this.collectedBands.push({ height: afterSubreport, children: [] })
        }
        this.cursorY += afterSubreport
      }
      // Advance at least to the parent band's bottom edge — but only while the
      // flow is still on the page the band started on: after a page break the
      // band's start position is meaningless for the new page.
      if (this.pageNumber === placementStartPage) {
        const minCursorY = inlineStartY + effectiveHeight - minElemY
        if (this.cursorY < minCursorY) {
          this.cursorY = minCursorY
        }
      }

      // runToBottom: the subreport consumes the remaining page/column space.
      if (!this.collectMode) {
        for (let i = 0; i < pendingList.length; i++) {
          if (pendingList[i]!.runToBottom) {
            const bottomY = this.getOverflowBottomY()
            if (this.cursorY < bottomY) this.cursorY = bottomY
            break
          }
        }
      }

      this.resolveDeferredByTime('band')
      this.cursorY += spacingAfter
      if (this.shouldConsumePageStart(bandType)) this.pageStartConsumed = true
      return
    }

    // Resolve band-level deferred evaluations
    this.resolveDeferredByTime('band')

    // background does not advance cursorY
    if (bandType !== 'background') {
      this.cursorY += effectiveHeight + spacingAfter
    }
    if (this.shouldConsumePageStart(bandType)) this.pageStartConsumed = true
  }

  /** True when any element's estimated extent exceeds the given height. */
  private bandHasElementTallerThan(band: BandDef, maxHeight: number): boolean {
    for (const rawElem of band.elements ?? []) {
      const elem = this.resolveElementForRender(rawElem)
      if (!elem) continue
      if (this.estimateElementHeight(elem) > maxHeight) return true
    }
    return false
  }

  /** True when the band contains elements that paginate through the inline band flow. */
  private bandHasInlineFlowElements(band: BandDef): boolean {
    const elements = band.elements
    if (!elements) return false
    for (let i = 0; i < elements.length; i++) {
      if (this.isInlineFlowElement(elements[i]!)) return true
    }
    return false
  }

  private isInlineFlowElement(elem: ElementDef): boolean {
    const t = elem.type
    if (t === 'subreport' || t === 'table' || t === 'crosstab') return true
    if (t === 'frame') {
      const children = (elem as ElementDef & { type: 'frame' }).elements
      if (children) {
        for (let i = 0; i < children.length; i++) {
          if (this.isInlineFlowElement(children[i]!)) return true
        }
      }
    }
    return false
  }

  /**
   * Splits a band containing break elements into segments at each break position.
   * Elements above a break render in place; elements at/below it continue after
   * a forced page/column break (in collectMode, a pageBreak marker band is
   * emitted so the break propagates to the parent flow).
   * Returns false when the band has no active break elements.
   */
  private renderBandWithBreaks(band: BandDef, bandType: string): boolean {
    const elements = band.elements
    if (!elements || elements.length === 0) return false

    let breaks: { y: number; breakType: 'page' | 'column' }[] | null = null
    for (let i = 0; i < elements.length; i++) {
      const rawElem = elements[i]!
      if (rawElem.type !== 'break') continue
      const elem = this.resolveElementForRender(rawElem)
      if (!elem) continue
      if (!breaks) breaks = []
      breaks.push({ y: elem.y, breakType: (elem as ElementDef & { type: 'break' }).breakType })
    }
    if (!breaks) return false
    breaks.sort((a, b) => a.y - b.y)

    let segStart = 0
    for (let i = 0; i <= breaks.length; i++) {
      const isLast = i === breaks.length
      const segEnd = isLast
        ? (band.height > segStart ? band.height : segStart)
        : breaks[i]!.y

      const segElements: ElementDef[] = []
      for (let j = 0; j < elements.length; j++) {
        const el = elements[j]!
        if (el.type === 'break') continue
        if (el.y < segStart) continue
        if (!isLast && el.y >= segEnd) continue
        segElements.push(segStart === 0 ? el : { ...el, y: el.y - segStart })
      }

      const segBand: BandDef = {
        height: segEnd - segStart,
        elements: segElements,
        splitType: band.splitType,
        spacingBefore: i === 0 ? band.spacingBefore : 0,
        spacingAfter: isLast ? band.spacingAfter : 0,
      }
      this.renderBand(segBand, bandType, false)

      if (!isLast) {
        const brk = breaks[i]!
        if (this.collectMode) {
          this.collectedBands.push({ height: 0, children: [], pageBreak: true })
        } else if (brk.breakType === 'column' && this.columnCount > 1 && this.currentColumn < this.columnCount - 1) {
          this.breakColumn()
        } else {
          this.breakPage()
        }
        segStart = brk.y
      }
    }
    return true
  }

  private renderStretchBand(band: BandDef, bandType: string, spacingBefore: number, spacingAfter: number): void {
    let availableHeight = this.getOverflowBottomY() - this.cursorY - spacingBefore
    if (availableHeight <= 0 || band.height > availableHeight) {
      const freshAvail = this.getFreshPageAvailableHeight() - spacingBefore
      if (availableHeight <= 0 || band.height <= freshAvail) {
        this.breakColumnOrPage(bandType)
      }
    }

    this.cursorY += spacingBefore

    const layout = this.collectBandLayout(band, bandType)
    const deferredMap = this.createStretchDeferredMap(layout.deferredEvals)
    let segmentStart = 0
    let segmentIndex = 0

    // isPrintWhenDetailOverflows: elements reprinted on every overflow segment.
    let reprintElems: ElementDef[] | null = null
    for (const rawElem of band.elements ?? []) {
      if (!rawElem.isPrintWhenDetailOverflows) continue
      const elem = this.resolveElementForRender(rawElem)
      if (!elem) continue
      if (!reprintElems) reprintElems = []
      reprintElems.push(elem)
    }

    while (segmentStart < layout.effectiveHeight) {
      availableHeight = this.getOverflowBottomY() - this.cursorY
      if (availableHeight <= 0) {
        // A fresh page/column with no positive content area (e.g. a page footer
        // taller than the printable region) can never hold a segment; breaking
        // again would loop forever creating empty pages. Surface the degenerate
        // geometry instead.
        if (this.getFreshPageAvailableHeight() <= 0) {
          throw new Error('Page content area is non-positive; check page size, margins and footer/header heights')
        }
        this.breakColumnOrPage(bandType)
        continue
      }

      // Reprinted elements sit at the top of overflow segments; the windowed
      // content flows below them.
      let reprintNodes: RenderNode[] | null = null
      let reprintExtent = 0
      if (segmentIndex > 0 && reprintElems) {
        for (let i = 0; i < reprintElems.length; i++) {
          const elem = reprintElems[i]!
          const node = this.renderElement(elem)
          if (!node) continue
          if (!reprintNodes) reprintNodes = []
          reprintNodes.push(node)
          const bottom = elem.y + elem.height
          if (bottom > reprintExtent) reprintExtent = bottom
        }
        if (reprintExtent >= availableHeight) {
          // Degenerate: the reprinted region alone fills the segment.
          reprintNodes = null
          reprintExtent = 0
        }
      }

      const windowAvail = availableHeight - reprintExtent
      let segmentWindowHeight = windowAvail < layout.effectiveHeight - segmentStart
        ? windowAvail
        : layout.effectiveHeight - segmentStart

      // Snap non-final cuts to text line boundaries so no line is sliced in
      // half across pages.
      if (segmentStart + segmentWindowHeight < layout.effectiveHeight) {
        const cut = this.snapCutToTextLines(layout.children, segmentStart, segmentStart + segmentWindowHeight)
        segmentWindowHeight = cut - segmentStart
      }

      const segment = this.createStretchSegment(layout.children, segmentStart, segmentWindowHeight, segmentIndex, deferredMap)
      if (!segment) break
      this.resolveDeferredByTime('masterNow')

      let children = segment.children
      let segmentHeight = segment.height
      if (reprintNodes) {
        for (let i = 0; i < children.length; i++) {
          this.offsetNodeY(children[i]!, reprintExtent)
        }
        children = reprintNodes.concat(children)
        segmentHeight += reprintExtent
      }

      const useColumns = this.columnCount > 1 && COLUMN_BAND_TYPES.has(bandType)
      const group: RenderGroup = {
        type: 'group',
        x: useColumns ? this.columnX : this.marginLeft,
        y: this.cursorY,
        width: useColumns ? this.columnWidth : this.contentWidth,
        height: segmentHeight,
        clip: true,
        children,
      }
      this.currentPage.children.push(group)
      this.cursorY += segmentHeight

      segmentStart += segmentWindowHeight
      segmentIndex++
      if (segmentStart < layout.effectiveHeight) {
        this.breakColumnOrPage(bandType)
      }
    }

    this.resolveDeferredByTime('band')
    this.cursorY += spacingAfter
  }

  private collectBandLayout(band: BandDef, bandType: string): { children: RenderNode[]; effectiveHeight: number; deferredEvals: DeferredEval[] } {
    const savedCollectMode = this.collectMode
    const savedCollectedBands = this.collectedBands
    const savedPendingInlineBands = this.pendingInlineBandsList
    const savedCursorY = this.cursorY
    const savedPageStartConsumed = this.pageStartConsumed
    const savedBookmarks = this.bookmarks.slice()
    const savedAnchors = new Map(this.anchors)
    const deferredStart = this.deferredEvals.length

    this.collectMode = true
    this.collectedBands = []
    this.pendingInlineBandsList = []
    this.cursorY = 0

    this.renderBand(band, bandType, false)

    const bands = this.collectedBands
    const deferredEvals = this.deferredEvals.splice(deferredStart)
    const children: RenderNode[] = []
    let offsetY = 0
    for (let i = 0; i < bands.length; i++) {
      const collectedBand = bands[i]!
      for (let j = 0; j < collectedBand.children.length; j++) {
        const child = collectedBand.children[j]!
        this.offsetNodeY(child, offsetY)
        children.push(child)
      }
      if (collectedBand.deferredEvals) {
        for (let j = 0; j < collectedBand.deferredEvals.length; j++) {
          deferredEvals.push(collectedBand.deferredEvals[j]!)
        }
      }
      offsetY += collectedBand.height
    }

    this.collectMode = savedCollectMode
    this.collectedBands = savedCollectedBands
    this.pendingInlineBandsList = savedPendingInlineBands
    this.cursorY = savedCursorY
    this.pageStartConsumed = savedPageStartConsumed
    this.bookmarks = savedBookmarks
    this.anchors = savedAnchors

    return {
      children,
      effectiveHeight: offsetY,
      deferredEvals,
    }
  }

  private createStretchDeferredMap(deferredEvals: DeferredEval[]): Map<RenderNode, Omit<DeferredEval, 'node'>[]> {
    const map = new Map<RenderNode, Omit<DeferredEval, 'node'>[]>()
    for (let i = 0; i < deferredEvals.length; i++) {
      const deferred = deferredEvals[i]!
      const list = map.get(deferred.node)
      const meta = {
        expression: deferred.expression,
        pattern: deferred.pattern,
        evaluationTime: deferred.evaluationTime,
        elem: deferred.elem,
        style: deferred.style,
        snapshot: deferred.snapshot,
        auto: deferred.auto,
      }
      if (list) {
        list.push(meta)
      } else {
        map.set(deferred.node, [meta])
      }
    }
    return map
  }

  private createStretchSegment(
    children: RenderNode[],
    segmentStart: number,
    availableHeight: number,
    segmentIndex: number,
    deferredMap: Map<RenderNode, Omit<DeferredEval, 'node'>[]>,
  ): { children: RenderNode[]; height: number } | null {
    const segmentEnd = segmentStart + availableHeight
    const visibleChildren: RenderNode[] = []
    let firstVisibleTop = Number.POSITIVE_INFINITY

    for (let i = 0; i < children.length; i++) {
      const child = children[i]!
      const bounds = this.getNodeVerticalBounds(child)
      if (bounds.bottom <= segmentStart || bounds.top >= segmentEnd) continue
      visibleChildren.push(child)
      const visibleTop = bounds.top < segmentStart ? segmentStart : bounds.top
      if (visibleTop < firstVisibleTop) {
        firstVisibleTop = visibleTop
      }
    }

    if (visibleChildren.length === 0) {
      if (segmentIndex === 0) {
        return { children: [], height: availableHeight }
      }
      return null
    }

    const originY = segmentIndex === 0 ? segmentStart : firstVisibleTop
    const clonedChildren: RenderNode[] = []
    for (let i = 0; i < visibleChildren.length; i++) {
      clonedChildren.push(this.cloneNodeWithYOffset(visibleChildren[i]!, -originY, deferredMap))
    }

    return {
      children: clonedChildren,
      height: segmentEnd - originY,
    }
  }

  private cloneNodeWithYOffset(
    node: RenderNode,
    offsetY: number,
    deferredMap: Map<RenderNode, Omit<DeferredEval, 'node'>[]>,
  ): RenderNode {
    let cloned: RenderNode
    switch (node.type) {
      case 'group': {
        cloned = {
          ...node,
          y: node.y + offsetY,
          children: node.children.map(child => this.cloneNodeWithYOffset(child, 0, deferredMap)),
        }
        break
      }
      case 'text': {
        cloned = {
          ...node,
          y: node.y + offsetY,
        }
        break
      }
      case 'line':
        cloned = { ...node, y1: node.y1 + offsetY, y2: node.y2 + offsetY }
        break
      case 'rect':
        cloned = { ...node, y: node.y + offsetY, fill: offsetPaintValue(node.fill, 0, offsetY) }
        break
      case 'ellipse':
        cloned = { ...node, cy: node.cy + offsetY, fill: offsetPaintValue(node.fill, 0, offsetY) }
        break
      case 'image':
        cloned = { ...node, y: node.y + offsetY }
        break
      case 'svg':
        cloned = { ...node, y: node.y + offsetY }
        break
      case 'formField':
        cloned = { ...node, y: node.y + offsetY }
        break
      case 'path': {
        const coords = new Float32Array(node.coords)
        const pdfSourceVector = node.pdfSourceVector === undefined ? undefined : {
          definitions: node.pdfSourceVector.definitions,
          instances: node.pdfSourceVector.instances.map(function (instance) {
            const matrix = instance.matrix
            return {
              definitionIndex: instance.definitionIndex,
              matrix: [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5] + offsetY] as [number, number, number, number, number, number],
            }
          }),
        }
        const affineTransform = node.affineTransform === undefined
          ? undefined
          : [...node.affineTransform] as [number, number, number, number, number, number]
        if (affineTransform === undefined) {
          for (let i = 1; i < coords.length; i += 2) coords[i] = coords[i]! + offsetY
        } else affineTransform[5] += offsetY
        cloned = {
          ...node,
          coords,
          pdfSourceVector,
          affineTransform,
          fill: offsetPaintValue(node.fill, 0, offsetY),
          stroke: offsetPaintValue(node.stroke, 0, offsetY),
        }
        break
      }
    }

    const deferredList = deferredMap.get(node)
    if (deferredList) {
      for (let i = 0; i < deferredList.length; i++) {
        const deferred = deferredList[i]!
        this.deferredEvals.push({
          node: cloned,
          expression: deferred.expression,
          pattern: deferred.pattern,
          evaluationTime: deferred.evaluationTime,
          elem: deferred.elem,
          style: deferred.style,
          snapshot: deferred.snapshot,
          auto: deferred.auto ? this.cloneAutoEvaluationState(deferred.auto) : undefined,
        })
      }
    }
    return cloned
  }

  /**
   * Finds the topmost text line that a horizontal cut would slice in half.
   * Returns the line's top (band coordinates), or null when the cut is clean.
   */
  private findStraddlingTextTop(children: RenderNode[], offsetY: number, cut: number): number | null {
    let minTop: number | null = null
    for (let i = 0; i < children.length; i++) {
      const node = children[i]!
      if (node.type === 'text') {
        const top = offsetY + node.y
        const bottom = top + node.fontSize * 1.2
        if (top < cut && bottom > cut) {
          if (minTop === null || top < minTop) minTop = top
        }
      } else if (node.type === 'group') {
        const inner = this.findStraddlingTextTop(node.children, offsetY + node.y, cut)
        if (inner !== null && (minTop === null || inner < minTop)) minTop = inner
      }
    }
    return minTop
  }

  /**
   * Lowers a stretch segment cut so it does not slice any text line in half.
   * Falls back to the proposed cut when no clean cut above the segment start
   * exists (a single line taller than the window), guaranteeing progress.
   */
  private snapCutToTextLines(children: RenderNode[], segmentStart: number, proposedCut: number): number {
    let cut = proposedCut
    for (;;) {
      const straddleTop = this.findStraddlingTextTop(children, 0, cut)
      if (straddleTop === null) return cut
      if (straddleTop <= segmentStart) return proposedCut
      cut = straddleTop
    }
  }

  private getNodeVerticalBounds(node: RenderNode): { top: number; bottom: number } {
    switch (node.type) {
      case 'group':
        return { top: node.y, bottom: node.y + node.height }
      case 'text':
        return { top: node.y, bottom: node.y + node.fontSize * 1.2 }
      case 'line': {
        const top = node.y1 < node.y2 ? node.y1 : node.y2
        const bottom = node.y1 > node.y2 ? node.y1 : node.y2
        return { top, bottom }
      }
      case 'rect':
        return { top: node.y, bottom: node.y + node.height }
      case 'ellipse':
        return { top: node.cy - node.ry, bottom: node.cy + node.ry }
      case 'image':
        return { top: node.y, bottom: node.y + node.height }
      case 'svg':
        return { top: node.y, bottom: node.y + node.height }
      case 'formField':
        return { top: node.y, bottom: node.y + node.height }
      case 'path': {
        if (node.pdfSourceVector !== undefined) return sourceVectorVerticalBounds(node)
        if (node.coords.length < 2) return { top: 0, bottom: 0 }
        const first = renderPathPoint(node, 0)
        let top = first[1]
        let bottom = first[1]
        for (let i = 2; i < node.coords.length; i += 2) {
          const y = renderPathPoint(node, i)[1]
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
        return { top, bottom }
      }
    }
  }

  /**
   * Renders a band and returns its effective height.
   * Two-pass processing:
   *   Pass 1: render each element and compute effective heights
   *   Pass 2: finalize positions/sizes based on positionType/stretchType
   */
  /**
   * Renders a band at a fixed position (page/column footers, bottom group footers).
   * Fixed bands cannot flow to the next page, so inline bands produced by
   * subreports/tables/crosstabs inside the band are placed within the element's
   * reserved box on the current page, clipped to that box.
   */
  private renderFixedBandAt(band: BandDef, y: number, bandType: string): number {
    const pendingStart = this.pendingInlineBandsList.length
    const height = this.renderBandAt(band, y, bandType)
    if (this.pendingInlineBandsList.length > pendingStart) {
      const useColumns = this.columnCount > 1 && COLUMN_BAND_TYPES.has(bandType)
      for (let i = pendingStart; i < this.pendingInlineBandsList.length; i++) {
        const pending = this.pendingInlineBandsList[i]!
        const baseX = useColumns ? this.columnX + pending.elemX : this.marginLeft + pending.elemX
        const children: RenderNode[] = []
        let yOffset = 0
        for (let j = 0; j < pending.bands.length; j++) {
          const inlineBand = pending.bands[j]!
          // Fixed bands cannot break pages: page break markers have no effect here.
          if (inlineBand.pageBreak) continue
          this.resolveInlineBandDeferredEvals(inlineBand)
          children.push({
            type: 'group',
            x: 0,
            y: yOffset,
            width: pending.elemWidth,
            height: inlineBand.height,
            children: inlineBand.children,
          })
          yOffset += inlineBand.height
        }
        this.currentPage.children.push({
          type: 'group',
          x: baseX,
          y: y + pending.elemY,
          width: pending.elemWidth,
          height: pending.elemHeight,
          clip: true,
          children,
        })
      }
      this.pendingInlineBandsList.length = pendingStart
    }
    return height
  }

  private renderBandAt(band: BandDef, y: number, bandType: string): number {
    // ─── Pass 1: render elements and compute effective heights ───
    interface LayoutEntry {
      elem: ElementDef
      node: RenderNode | null
      effectiveHeight: number
      /** Downward displacement applied in pass 2 (float / fixRelativeToBottom). */
      floatOffset?: number
      /** Upward shift from removed blank lines (isRemoveLineWhenBlank). */
      yShift?: number
      /** Range of pendingInlineBandsList entries produced by this element. */
      pendingStart?: number
      pendingEnd?: number
    }

    const entries: LayoutEntry[] = []
    const deferredStart = this.deferredEvals.length
    // Vertical strips left blank by non-printing isRemoveLineWhenBlank elements.
    let blankStrips: { top: number; bottom: number }[] | null = null

    for (const rawElem of band.elements ?? []) {
      // Resolve in the order onBeforeRender → printWhenExpression
      const elem = this.resolveElementForRender(rawElem)
      if (!elem) {
        if (rawElem.isRemoveLineWhenBlank) {
          if (!blankStrips) blankStrips = []
          blankStrips.push({ top: rawElem.y, bottom: rawElem.y + rawElem.height })
        }
        continue
      }

      const pendingBefore = this.pendingInlineBandsList.length
      const node = this.renderElement(elem)
      if (!node) {
        const pendingAfter = this.pendingInlineBandsList.length
        if (pendingAfter > pendingBefore) {
          // Inline-flow element (subreport/table/crosstab): its content is
          // placed through placeInlineBands, but its actual extent still
          // stretches the band and pushes floating elements below it.
          let contentHeight = elem.height
          for (let k = pendingBefore; k < pendingAfter; k++) {
            const p = this.pendingInlineBandsList[k]!
            let h = 0
            for (let m = 0; m < p.bands.length; m++) h += p.bands[m]!.height
            const bottom = p.elemY - elem.y + h
            if (bottom > contentHeight) contentHeight = bottom
          }
          entries.push({ elem, node: null, effectiveHeight: contentHeight, pendingStart: pendingBefore, pendingEnd: pendingAfter })
        }
        continue
      }

      // Compute effective height: use the node's height for stretchWithOverflow text
      let effectiveHeight = elem.height
      if (node.type === 'group' && node.height > elem.height) {
        effectiveHeight = node.height
      }

      entries.push({ elem, node, effectiveHeight })
    }

    // isRemoveLineWhenBlank: collapse blank vertical strips that no printed
    // element overlaps — elements below shift up and the band shrinks.
    let removedTotal = 0
    if (blankStrips) {
      blankStrips.sort((a, b) => a.top - b.top)
      for (let s = 0; s < blankStrips.length; s++) {
        const strip = blankStrips[s]!
        let overlapped = false
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i]!.elem
          if (e.y < strip.bottom && e.y + e.height > strip.top) {
            overlapped = true
            break
          }
        }
        if (overlapped) continue
        const stripHeight = strip.bottom - strip.top
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!
          if (entry.elem.y >= strip.bottom) {
            entry.yShift = (entry.yShift ?? 0) - stripHeight
          }
        }
        removedTotal += stripHeight
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        if (entry.yShift) {
          if (entry.node) this.offsetNodeY(entry.node, entry.yShift)
          if (entry.pendingStart !== undefined) {
            for (let k = entry.pendingStart; k < entry.pendingEnd!; k++) {
              this.pendingInlineBandsList[k]!.elemY += entry.yShift
            }
          }
        }
      }
    }

    // Band effective height = max(band.height, maximum bottom edge of all elements)
    let bandEffectiveHeight = band.height - removedTotal
    for (const entry of entries) {
      const bottom = entry.elem.y + (entry.yShift ?? 0) + entry.effectiveHeight
      if (bottom > bandEffectiveHeight) {
        bandEffectiveHeight = bottom
      }
    }

    // ─── Pass 2: finalize positions/sizes based on positionType/stretchType ───
    const bandStretch = bandEffectiveHeight - band.height

    for (const entry of entries) {
      const { elem, node } = entry
      const positionType = elem.positionType ?? 'fixRelativeToTop'
      const stretchType = elem.stretchType ?? 'noStretch'

      // positionType handling
      if (positionType === 'float' && bandStretch > 0) {
        // float: shifts downward by the stretch amount of elements above it
        let maxStretchAbove = 0
        for (const other of entries) {
          if (other === entry) continue
          if (other.elem.y + other.elem.height <= elem.y) {
            // other is above this element
            const stretch = other.effectiveHeight - other.elem.height
            if (stretch > maxStretchAbove) maxStretchAbove = stretch
          }
        }
        if (maxStretchAbove > 0) {
          this.applyEntryOffset(entry, maxStretchAbove)
        }
      } else if (positionType === 'fixRelativeToBottom' && bandStretch > 0) {
        // fixRelativeToBottom: keep the distance from the band's bottom edge
        this.applyEntryOffset(entry, bandStretch)
      }
      // fixRelativeToTop: as-is (default)

      // stretchType handling
      if (node && stretchType === 'containerHeight' && bandStretch > 0) {
        // Match the element's height to the band's effective height
        this.setNodeHeight(node, bandEffectiveHeight)
      } else if (node && stretchType === 'containerBottom' && bandStretch > 0) {
        // Match the element's bottom edge to the band's effective height (height change only)
        const newHeight = bandEffectiveHeight - elem.y
        this.setNodeHeight(node, newHeight)
      }
    }

    // Floated elements can extend the band beyond the pass-1 extent.
    for (const entry of entries) {
      const floatOffset = entry.floatOffset ?? 0
      if (floatOffset > 0) {
        const bottom = entry.elem.y + floatOffset + entry.effectiveHeight
        if (bottom > bandEffectiveHeight) bandEffectiveHeight = bottom
      }
    }

    // collectMode: add the band to collectedBands and return
    if (this.collectMode) {
      this.collectedBands.push({
        height: bandEffectiveHeight,
        children: extractNodes(entries),
        deferredEvals: this.extractDeferredEvalsByTimeSince(deferredStart, 'masterNow'),
      })
      return bandEffectiveHeight
    }

    // Create group (column-aware bands use column width / column X coordinate)
    const useColumns = this.columnCount > 1 && COLUMN_BAND_TYPES.has(bandType)
    const group: RenderGroup = {
      type: 'group',
      x: useColumns ? this.columnX : this.marginLeft,
      y,
      width: useColumns ? this.columnWidth : this.contentWidth,
      height: bandEffectiveHeight,
      children: extractNodes(entries),
    }

    this.currentPage.children.push(group)
    return bandEffectiveHeight
  }

  /**
   * For splitType=immediate: renders a band split across page boundaries.
   * Elements that fit within availableHeight go on the current page; elements
   * that exceed it go on the next page.
   */
  private renderBandSplit(band: BandDef, bandType: string): void {
    // Render all elements and record their effective vertical extents.
    // The stretched height (e.g. stretchWithOverflow text) decides the split,
    // not the declared height, so stretched content is never cut off.
    interface SplitEntry {
      elem: ElementDef
      node: RenderNode
      top: number
      bottom: number
    }
    const entries: SplitEntry[] = []
    for (const rawElem of band.elements ?? []) {
      // Resolve in the order onBeforeRender → printWhenExpression
      const elem = this.resolveElementForRender(rawElem)
      if (!elem) continue
      const node = this.renderElement(elem)
      if (!node) continue
      let effectiveHeight = elem.height
      if (node.type === 'group' && node.height > elem.height) {
        effectiveHeight = node.height
      }
      entries.push({ elem, node, top: elem.y, bottom: elem.y + effectiveHeight })
    }

    const useColumns = this.columnCount > 1 && COLUMN_BAND_TYPES.has(bandType)

    if (entries.length === 0) {
      const avail = this.getOverflowBottomY() - this.cursorY
      this.cursorY += band.height < avail ? band.height : avail
      return
    }

    // Distribute elements across as many pages/columns as needed.
    let remaining = entries
    let shift = 0
    let retriedOnFreshPage = false
    let reprintEntries: SplitEntry[] | null = null
    let isContinuation = false
    for (;;) {
      const avail = this.getOverflowBottomY() - this.cursorY

      // isPrintWhenDetailOverflows: re-render flagged elements already printed
      // on an earlier segment at the top of each overflow segment; the
      // continued content flows below them.
      let reprintNodes: RenderNode[] | null = null
      let contentOffset = 0
      if (isContinuation && reprintEntries) {
        for (let i = 0; i < reprintEntries.length; i++) {
          const e = reprintEntries[i]!
          const node = this.renderElement(e.elem)
          if (!node) continue
          if (!reprintNodes) reprintNodes = []
          reprintNodes.push(node)
          const bottom = e.elem.y + e.elem.height
          if (bottom > contentOffset) contentOffset = bottom
        }
        if (contentOffset >= avail) {
          // Degenerate: the reprinted region alone fills the segment.
          reprintNodes = null
          contentOffset = 0
        }
      }

      const current: SplitEntry[] = []
      const moved: SplitEntry[] = []
      for (let i = 0; i < remaining.length; i++) {
        const e = remaining[i]!
        if (e.bottom - shift + contentOffset <= avail) current.push(e)
        else moved.push(e)
      }

      if (current.length === 0) {
        if (!retriedOnFreshPage) {
          // Nothing fits here: move the remaining content to a fresh page/column
          // as a whole (positions within the band are preserved).
          this.breakColumnOrPage(bandType)
          retriedOnFreshPage = true
          continue
        }
        // Even a fresh page cannot hold the topmost element (bands with such
        // elements are normally diverted to stretch splitting by renderBand):
        // force-place the topmost element clipped to guarantee progress.
        let topIndex = 0
        for (let i = 1; i < moved.length; i++) {
          if (moved[i]!.top < moved[topIndex]!.top) topIndex = i
        }
        current.push(moved[topIndex]!)
        moved.splice(topIndex, 1)
      }
      retriedOnFreshPage = false

      const nodes: RenderNode[] = reprintNodes ?? []
      let contentBottom = contentOffset
      for (let i = 0; i < current.length; i++) {
        const e = current[i]!
        const offset = contentOffset - shift
        if (offset !== 0) this.offsetNodeY(e.node, offset)
        nodes.push(e.node)
        const b = e.bottom - shift + contentOffset
        if (b > contentBottom) contentBottom = b
      }

      const isLast = moved.length === 0
      // Non-final segments span the full window up to the split line: moved
      // elements keep their offsets relative to that line.
      let segmentHeight = avail
      if (isLast) {
        // Final segment: content extent, preserving the band's declared height.
        segmentHeight = contentBottom
        const declaredRest = band.height - shift + contentOffset
        if (declaredRest > segmentHeight) segmentHeight = declaredRest
        if (segmentHeight > avail) segmentHeight = avail
      }

      const group: RenderGroup = {
        type: 'group',
        x: useColumns ? this.columnX : this.marginLeft,
        y: this.cursorY,
        width: useColumns ? this.columnWidth : this.contentWidth,
        height: segmentHeight,
        clip: true,
        children: nodes,
      }
      this.currentPage.children.push(group)
      this.cursorY += segmentHeight

      if (isLast) return

      // Record flagged elements printed on this segment for reprinting.
      for (let i = 0; i < current.length; i++) {
        const e = current[i]!
        if (e.elem.isPrintWhenDetailOverflows) {
          if (!reprintEntries) reprintEntries = []
          reprintEntries.push(e)
        }
      }

      // Continue on the next page/column. Moved elements keep their offsets
      // relative to the split line; elements straddling the split line are
      // shifted up so the topmost one starts at the top (no negative Y).
      this.breakColumnOrPage(bandType)
      isContinuation = true
      const splitLine = shift + avail - contentOffset
      let minTop = moved[0]!.top
      for (let i = 1; i < moved.length; i++) {
        if (moved[i]!.top < minTop) minTop = moved[i]!.top
      }
      const nextShift = minTop < splitLine ? minTop : splitLine
      if (nextShift > shift) shift = nextShift
      remaining = moved
    }
  }

  /**
   * Applies a downward displacement to a layout entry: the render node when
   * present, and any inline bands (subreport content) the element produced.
   */
  private applyEntryOffset(
    entry: { node: RenderNode | null; floatOffset?: number; pendingStart?: number; pendingEnd?: number },
    offset: number,
  ): void {
    entry.floatOffset = (entry.floatOffset ?? 0) + offset
    if (entry.node) this.offsetNodeY(entry.node, offset)
    if (entry.pendingStart !== undefined) {
      for (let k = entry.pendingStart; k < entry.pendingEnd!; k++) {
        this.pendingInlineBandsList[k]!.elemY += offset
      }
    }
  }

  /** Offsets a node's Y coordinate */
  private offsetNodeY(node: RenderNode, offset: number): void {
    if (node.type === 'group') {
      node.y += offset
    } else if (node.type === 'text') {
      node.y += offset
    } else if (node.type === 'line') {
      node.y1 += offset
      node.y2 += offset
    } else if (node.type === 'rect') {
      node.y += offset
      node.fill = offsetPaintValue(node.fill, 0, offset)
    } else if (node.type === 'ellipse') {
      node.cy += offset
      node.fill = offsetPaintValue(node.fill, 0, offset)
    } else if (node.type === 'image') {
      node.y += offset
    } else if (node.type === 'svg') {
      node.y += offset
    } else if (node.type === 'path') {
      if (node.affineTransform === undefined) {
        const coords = node.coords
        for (let i = 1; i < coords.length; i += 2) coords[i] = coords[i]! + offset
      } else node.affineTransform[5] += offset
      node.fill = offsetPaintValue(node.fill, 0, offset)
      node.stroke = offsetPaintValue(node.stroke, 0, offset)
    }
  }

  /** Sets a node's height */
  private setNodeHeight(node: RenderNode, height: number): void {
    if (node.type === 'group') {
      node.height = height
    } else if (node.type === 'rect') {
      const oldHeight = node.height
      node.height = height
      if (oldHeight !== 0) node.fill = scalePaintY(node.fill, node.y, height / oldHeight)
    } else if (node.type === 'ellipse') {
      const oldRy = node.ry
      node.ry = height / 2
      if (oldRy !== 0) node.fill = scalePaintY(node.fill, node.cy - oldRy, node.ry / oldRy)
    } else if (node.type === 'image') {
      node.height = height
    } else if (node.type === 'path') {
      const bounds = this.getNodeVerticalBounds(node)
      const oldHeight = bounds.bottom - bounds.top
      if (oldHeight !== 0) {
        const scaleY = height / oldHeight
        if (node.affineTransform === undefined) {
          const coords = node.coords
          for (let i = 1; i < coords.length; i += 2) coords[i] = bounds.top + (coords[i]! - bounds.top) * scaleY
        } else {
          node.affineTransform[1] *= scaleY
          node.affineTransform[3] *= scaleY
          node.affineTransform[5] = bounds.top + (node.affineTransform[5] - bounds.top) * scaleY
        }
        node.fill = scalePaintY(node.fill, bounds.top, scaleY)
        node.stroke = scalePaintY(node.stroke, bounds.top, scaleY)
      }
    }
  }

  /**
   * When placing a non-group element into a decoration wrapper (group),
   * converts its existing absolute coordinates (band-relative) into
   * wrapper-relative coordinates.
   */
  private localizeNodeForWrapper(node: RenderNode, offsetX: number, offsetY: number): RenderNode {
    switch (node.type) {
      case 'group':
        return { ...node, x: node.x - offsetX, y: node.y - offsetY }
      case 'text':
        return { ...node, x: node.x - offsetX, y: node.y - offsetY }
      case 'line':
        return {
          ...node,
          x1: node.x1 - offsetX,
          y1: node.y1 - offsetY,
          x2: node.x2 - offsetX,
          y2: node.y2 - offsetY,
        }
      case 'rect':
        return { ...node, x: node.x - offsetX, y: node.y - offsetY, fill: offsetPaintValue(node.fill, -offsetX, -offsetY) }
      case 'ellipse':
        return { ...node, cx: node.cx - offsetX, cy: node.cy - offsetY, fill: offsetPaintValue(node.fill, -offsetX, -offsetY) }
      case 'image':
        return { ...node, x: node.x - offsetX, y: node.y - offsetY }
      case 'svg':
        return { ...node, x: node.x - offsetX, y: node.y - offsetY }
      case 'formField':
        return { ...node, x: node.x - offsetX, y: node.y - offsetY }
      case 'path': {
        const coords = new Float32Array(node.coords.length)
        coords.set(node.coords)
        const affineTransform = node.affineTransform === undefined
          ? undefined
          : [...node.affineTransform] as [number, number, number, number, number, number]
        if (affineTransform === undefined) {
          for (let i = 0; i < coords.length; i += 2) {
            coords[i] = coords[i]! - offsetX
            coords[i + 1] = coords[i + 1]! - offsetY
          }
        } else {
          affineTransform[4] -= offsetX
          affineTransform[5] -= offsetY
        }
        return {
          ...node,
          coords,
          affineTransform,
          fill: offsetPaintValue(node.fill, -offsetX, -offsetY),
          stroke: offsetPaintValue(node.stroke, -offsetX, -offsetY),
        }
      }
    }
  }

  // ─── Element rendering ───

  /**
   * Resolves the element definition used for rendering. null means "do not render".
   *
   * Evaluation order: onBeforeRender → printWhenExpression → (conditionalStyles inside renderElement).
   * When onBeforeRender returns an ElementDef, all attributes including
   * printWhenExpression are evaluated against the overridden definition.
   *
   * Performance: elements without onBeforeRender incur only a property
   * existence check, adding no extra overhead.
   */
  private resolveElementForRender(elem: ElementDef): ElementDef | null {
    if (elem.onBeforeRender) {
      const overridden = elem.onBeforeRender(
        elem,
        this.currentRow,
        this.variables,
        this.dataSource.parameters ?? {},
        this.syncReportContext(),
      )
      if (overridden === null) return null
      elem = overridden
    }
    if (elem.printWhenExpression) {
      const result = this.evalExpr(elem.printWhenExpression)
      if (!result) return null
    }
    return elem
  }

  private renderElement(elem: ElementDef): RenderNode | null {
    let node: RenderNode | null
    switch (elem.type) {
      case 'formField': node = this.renderFormField(elem); break
      case 'staticText': node = this.renderStaticText(elem); break
      case 'textField': node = this.renderTextField(elem); break
      case 'line': node = this.renderLine(elem); break
      case 'rectangle': node = this.renderRect(elem); break
      case 'ellipse': node = this.renderEllipse(elem); break
      case 'path': node = this.renderPathElement(elem); break
      case 'image': node = this.renderImage(elem); break
      case 'frame': node = this.renderFrame(elem); break
      case 'subreport': node = this.renderSubreport(elem); break
      case 'barcode': node = this.renderBarcodeElement(elem); break
      case 'math': node = this.renderMathElement(elem); break
      case 'svg': node = this.renderSvgElement(elem as ElementDef & { type: 'svg'; svgContent: Expression }); break
      case 'table': node = this.renderTableElement(elem as ElementDef & { type: 'table' }); break
      case 'crosstab': node = this.renderCrosstabElement(elem as ElementDef & { type: 'crosstab' }); break
      case 'break': return this.renderBreak(elem)
      default: return null
    }

    if (!node) return null

    // Color rendering intent (ExtGState /RI) applies to every node type that
    // carries other graphics-state hints (all but the interactive form field).
    if (elem.renderingIntent !== undefined && node.type !== 'formField') {
      node.renderingIntent = elem.renderingIntent
    }
    if (elem.alphaIsShape !== undefined) node.alphaIsShape = elem.alphaIsShape
    if (elem.textKnockout !== undefined) node.textKnockout = elem.textKnockout

    // Hyperlink handling
    const hyperlinkElem = elem as { hyperlink?: any, anchorName?: string, bookmarkLevel?: number }
    if (hyperlinkElem.hyperlink) {
      const link = resolveHyperlinkDef(hyperlinkElem.hyperlink, (expr) => this.evalExpr(expr))
      if (link) attachLinkToNode(node, link, elem)
    }

    // Register anchor name
    if (hyperlinkElem.anchorName) {
      const pageIndex = this.pages.length - 1
      this.anchors.set(hyperlinkElem.anchorName, {
        pageIndex: pageIndex >= 0 ? pageIndex : 0,
        y: this.cursorY + elem.y,
      })
    }

    // Register bookmark
    if (hyperlinkElem.bookmarkLevel) {
      const pageIndex = this.pages.length - 1
      const label = extractText(node)
      if (label) {
        this.bookmarks.push({
          label,
          level: hyperlinkElem.bookmarkLevel,
          pageIndex: pageIndex >= 0 ? pageIndex : 0,
          y: this.cursorY + elem.y,
        })
      }
    }

    // Apply border and background
    const style = this.getStyle(elem)
    // line / rectangle / ellipse / path can draw lines themselves,
    // so style.border (box decoration) is not applied.
    const border = (elem.type === 'line' || elem.type === 'rectangle' || elem.type === 'ellipse' || elem.type === 'path')
      ? undefined
      : style.border
    const isOpaque = (elem.mode ?? style.mode) === 'opaque'
    const backcolor = elem.backcolor ?? style.backcolor
    const opacity = elem.opacity ?? style.opacity

    const hasBorder = border !== undefined
    const hasBackground = isOpaque && backcolor && backcolor !== 'transparent'
    const hasOpacity = opacity !== undefined && opacity < 1

    // A group already provides exactly the compositing boundary required by
    // opacity.  Keep opacity on that group when no box decoration is needed.
    // This is also essential for imported PDF Forms: their affine transform
    // must be active before the transparency surface is bounded.  Wrapping an
    // affine Form at its pre-transform x/y crops translated or sheared paint.
    const attachOpacityToGroup = hasOpacity && !hasBorder && !hasBackground
      && node.type === 'group' && node.opacity === undefined
    if (attachOpacityToGroup) {
      (node as RenderGroup).opacity = opacity
    } else if (hasBorder || hasBackground || hasOpacity) {
      // Placing a border directly on clipped content clips the four corners,
      // so decorations are always handled in an outer wrapper.
      // Tables/crosstabs internally expand their height to the sum of row heights,
      // so match the wrapper size to the actual content size
      const useNodeHeight = (elem.type === 'table' || elem.type === 'crosstab') && node.type === 'group'
      const wrapperHeight = useNodeHeight ? (node as RenderGroup).height : elem.height
      const wrapperWidth = useNodeHeight ? (node as RenderGroup).width : elem.width

      const wrapper: RenderGroup = {
        type: 'group',
        x: elem.x,
        y: elem.y,
        width: wrapperWidth,
        height: wrapperHeight,
        children: [],
      }
      // Normalize the node's coordinates to be relative to the wrapper (group)
      node = this.localizeNodeForWrapper(node, elem.x, elem.y)

      // Opacity
      if (hasOpacity) {
        wrapper.opacity = opacity
      }

      // Decoration size: use the wrapper's actual size
      const decoWidth = wrapper.width
      const decoHeight = wrapper.height

      // Background color (inserted at the front of children)
      if (hasBackground) {
        wrapper.children.unshift(buildBackgroundRect(decoWidth, decoHeight, backcolor!))
      }

      // Border (appended at the end of children)
      if (hasBorder) {
        appendBorderNodes(wrapper.children, decoWidth, decoHeight, border!)
      }

      wrapper.children.push(node)
      node = wrapper
    }

    return this.wrapOptionalContent(node, elem)
  }

  private wrapOptionalContent(node: RenderNode, elem: ElementDef): RenderNode {
    if (elem.optionalContent === undefined) return node
    const useNodeSize = node.type === 'group'
    const wrapper: RenderGroup = {
      type: 'group',
      x: elem.x,
      y: elem.y,
      width: useNodeSize ? node.width : elem.width,
      height: useNodeSize ? node.height : elem.height,
      optionalContent: {
        ...elem.optionalContent,
      },
      children: [this.localizeNodeForWrapper(node, elem.x, elem.y)],
    }
    return wrapper
  }

  private renderFormField(elem: ElementDef & { type: 'formField' }): RenderNode {
    const style = this.getStyle(elem)
    const node: RenderNode = {
      type: 'formField',
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.height,
      fieldType: elem.fieldType,
      name: elem.fieldName,
      fontId: style.fontFamily,
      fontSize: style.fontSize,
      color: style.forecolor,
    }
    const valueBearing = elem.fieldType === 'text' || elem.fieldType === 'dropdown' || elem.fieldType === 'listbox'
    if (valueBearing && elem.value !== undefined) {
      const value = this.evalExpr(elem.value)
      if (value !== null && value !== undefined) node.value = String(value)
    }
    if ((elem.fieldType === 'checkbox' || elem.fieldType === 'radio') && elem.checked !== undefined) {
      node.checked = !!this.evalExpr(elem.checked)
    }
    if (elem.exportValue !== undefined) node.exportValue = elem.exportValue
    if (elem.options !== undefined) {
      node.options = elem.options.map(o => ({ value: o.value, label: o.label ?? o.value }))
    }
    if (elem.editable !== undefined) node.editable = elem.editable
    if (elem.multiSelect !== undefined) node.multiSelect = elem.multiSelect
    if (elem.caption !== undefined) node.caption = elem.caption
    if (elem.action !== undefined) node.action = elem.action
    if (elem.multiline !== undefined) node.multiline = elem.multiline
    if (elem.readOnly !== undefined) node.readOnly = elem.readOnly
    if (elem.required !== undefined) node.required = elem.required
    if (elem.noExport !== undefined) node.noExport = elem.noExport
    if (elem.password !== undefined) node.password = elem.password
    if (elem.fileSelect !== undefined) node.fileSelect = elem.fileSelect
    if (elem.doNotSpellCheck !== undefined) node.doNotSpellCheck = elem.doNotSpellCheck
    if (elem.doNotScroll !== undefined) node.doNotScroll = elem.doNotScroll
    if (elem.comb !== undefined) node.comb = elem.comb
    if (elem.richText !== undefined) node.richText = elem.richText
    if (elem.richTextStream !== undefined) node.richTextStream = elem.richTextStream
    if (elem.defaultStyle !== undefined) node.defaultStyle = elem.defaultStyle
    if (elem.valueStream !== undefined) node.valueStream = elem.valueStream
    if (elem.defaultValue !== undefined) node.defaultValue = elem.defaultValue
    if (elem.sort !== undefined) node.sort = elem.sort
    if (elem.commitOnSelectionChange !== undefined) node.commitOnSelectionChange = elem.commitOnSelectionChange
    if (elem.radiosInUnison !== undefined) node.radiosInUnison = elem.radiosInUnison
    if (elem.additionalActions !== undefined) node.additionalActions = elem.additionalActions
    if (elem.calculationOrder !== undefined) node.calculationOrder = elem.calculationOrder
    if (elem.maxLength !== undefined) node.maxLength = elem.maxLength
    if (elem.borderColor !== undefined) node.borderColor = elem.borderColor
    if (elem.backgroundColor !== undefined) node.backgroundColor = elem.backgroundColor
    return node
  }

  private renderStaticText(elem: ElementDef & { type: 'staticText' }): RenderNode {
    const style = this.getStyle(elem)
    const rotation = elem.rotation ?? style.rotation

    if (rotation) {
      const swapDims = rotation === 90 || rotation === 270
      const virtElem = { ...elem, x: 0, y: 0, width: swapDims ? elem.height : elem.width, height: swapDims ? elem.width : elem.height }
      const contentNode = elem.markup === 'html' || elem.markup === 'styled'
        ? this.renderMarkupContent(elem.text, virtElem, style)
        : this.renderTextContent(elem.text, virtElem, style, false)
      return this.wrapWithRotation(contentNode, elem, rotation)
    }

    if (elem.markup === 'html' || elem.markup === 'styled') {
      return this.renderMarkupContent(elem.text, elem, style)
    }
    return this.renderTextContent(elem.text, elem, style, false)
  }

  private renderTextField(elem: ElementDef & { type: 'textField' }): RenderNode {
    const style = this.getStyle(elem)

    if (elem.evaluationTime === 'auto') {
      return this.renderAutoTextField(elem, style)
    }

    if ((!elem.evaluationTime || elem.evaluationTime === 'now') && this.collectMode && this.expressionReferencesPageContext(elem.expression)) {
      const placeholder = this.renderResolvedTextFieldNode(elem, style, '')
      this.deferredEvals.push({
        node: placeholder,
        expression: elem.expression,
        pattern: elem.pattern,
        evaluationTime: 'masterNow',
        elem,
        style,
        snapshot: this.createEvaluationSnapshot(),
      })
      return placeholder
    }

    // Deferred evaluation check
    if (elem.evaluationTime && elem.evaluationTime !== 'now') {
      const placeholder = this.renderResolvedTextFieldNode(elem, style, '')
      this.deferredEvals.push({
        node: placeholder,
        expression: elem.expression,
        pattern: elem.pattern,
        evaluationTime: elem.evaluationTime,
        elem,
        style,
      })
      return placeholder
    }

    const rawValue = this.evalExpr(elem.expression)
    const text = this.resolveTextFieldText(elem, rawValue)
    if (this.shouldSuppressRepeatedText(elem, text)) {
      return this.renderEmptyPlaceholder(elem)
    }
    return this.renderResolvedTextFieldNode(elem, style, text)
  }

  private renderAutoTextField(elem: ElementDef & { type: 'textField' }, style: ResolvedStyle): RenderNode {
    if (typeof elem.expression !== 'string') {
      throw new Error('evaluationTime=auto requires a string expression so variable references can be analyzed')
    }

    const autoState = this.createAutoEvaluationState(elem.expression)
    if (autoState.variables.length === 0 && autoState.builtins.length === 0) {
      const rawValue = evaluateExpression(elem.expression, autoState.snapshot.field, autoState.snapshot.vars, autoState.snapshot.params, autoState.snapshot.report)
      const text = this.resolveTextFieldText(elem, rawValue)
      if (this.shouldSuppressRepeatedText(elem, text)) {
        return this.renderEmptyPlaceholder(elem)
      }
      return this.renderResolvedTextFieldNode(elem, style, text)
    }

    const placeholder = this.renderResolvedTextFieldNode(elem, style, '')
    this.deferredEvals.push({
      node: placeholder,
      expression: elem.expression,
      pattern: elem.pattern,
      evaluationTime: 'auto',
      elem,
      style,
      auto: autoState,
    })
    return placeholder
  }

  private resolveTextFieldText(
    elem: ElementDef & { type: 'textField' },
    rawValue: unknown,
  ): string {
    if (rawValue == null) {
      return elem.blankWhenNull ? '' : 'null'
    }
    if (elem.pattern) {
      return this.formatWithPattern(rawValue, elem.pattern)
    }
    return String(rawValue)
  }

  private shouldSuppressRepeatedText(
    elem: ElementDef & { type: 'textField' },
    text: string,
  ): boolean {
    if (elem.isPrintRepeatedValues !== false) return false
    const elemKey = `${elem.x},${elem.y},${elem.expression}`
    const prevValue = this.previousValues.get(elemKey)
    this.previousValues.set(elemKey, text)
    return prevValue === text
  }

  private renderResolvedTextFieldNode(
    elem: ElementDef & { type: 'textField' },
    style: ResolvedStyle,
    text: string,
  ): RenderNode {
    const rotation = elem.rotation ?? style.rotation
    if (rotation) {
      const swapDims = rotation === 90 || rotation === 270
      const virtElem = { ...elem, x: 0, y: 0, width: swapDims ? elem.height : elem.width, height: swapDims ? elem.width : elem.height }
      const contentNode = elem.markup === 'html' || elem.markup === 'styled'
        ? this.renderMarkupContent(text, virtElem, style)
        : this.renderTextContent(text, virtElem, style, elem.stretchWithOverflow ?? false)
      return this.wrapWithRotation(contentNode, elem, rotation)
    }

    if (elem.markup === 'html' || elem.markup === 'styled') {
      return this.renderMarkupContent(text, elem, style)
    }
    return this.renderTextContent(text, elem, style, elem.stretchWithOverflow ?? false)
  }

  /**
   * Converts text with HTML markup into RenderNodes
   * Generates a RenderText node with an individual style for each StyledRun
   */
  private renderMarkupContent(
    html: string,
    elem: ElementDef & {
      hAlign?: string
      vAlign?: string
      outlineText?: boolean
      pdfFontMode?: 'embedded' | 'reference'
      textPaintMode?: 'fill' | 'stroke' | 'fillStroke'
      textStrokeColor?: string
      textStrokeWidth?: number
      openTypeScript?: string
      openTypeLanguage?: string
      openTypeFeatures?: Record<string, number>
    },
    baseStyle: ResolvedStyle,
  ): RenderNode {
    const runs = parseMarkup(html)
    if (runs.length === 0) {
      return this.renderTextContent('', elem, baseStyle, false)
    }

    // Concatenate the plain text of all runs and split into lines
    let plainText = ''
    for (let ri = 0; ri < runs.length; ri++) plainText += runs[ri]!.text
    const measurer = this.fontMap?.get(baseStyle.fontFamily)

    if (!measurer) {
      // No measurer → place each run as an individual RenderText
      const children: RenderNode[] = []
      let x = 0
      for (const run of runs) {
        if (run.text === '\n') continue
        // Without font metrics the sup/sub scaling uses the OS/2 conventions
        const supSub = run.superscript === true || run.subscript === true
        const runFontSize = (run.fontSize ?? baseStyle.fontSize) * (supSub ? 0.6 : 1)
        const runShift = run.superscript === true
          ? -(run.fontSize ?? baseStyle.fontSize) * 0.35
          : run.subscript === true ? (run.fontSize ?? baseStyle.fontSize) * 0.075 : 0
        children.push({
          type: 'text',
          x: elem.x + x,
          y: elem.y + runShift,
          text: run.text,
          fontId: run.fontFamily ?? baseStyle.fontFamily,
          fontSize: runFontSize,
          color: run.color ?? baseStyle.forecolor,
          bold: run.bold ?? baseStyle.bold,
          italic: run.italic ?? baseStyle.italic,
          underline: run.underline ?? baseStyle.underline,
          strikethrough: (run.strikethrough ?? baseStyle.strikethrough) || undefined,
          variation: baseStyle.variation,
          writingMode: baseStyle.writingMode,
          outlineText: elem.outlineText || undefined,
          pdfFontMode: elem.pdfFontMode,
          textPaintMode: elem.textPaintMode,
          textStrokeColor: elem.textStrokeColor,
          textStrokeWidth: elem.textStrokeWidth,
          blendMode: elem.blendMode,
          overprintFill: elem.overprintFill,
          overprintStroke: elem.overprintStroke,
          overprintMode: elem.overprintMode,
        })
      }
      if (children.length === 1) return children[0]!
      return {
        type: 'group',
        x: elem.x,
        y: elem.y,
        width: elem.width,
        height: elem.height,
        children,
      }
    }

    // Measurer available → split into lines via text layout, then map styles
    const layoutResult = layoutText(plainText, measurer, baseStyle.fontSize, {
      maxWidth: elem.width,
      maxHeight: elem.height,
      elementHeight: elem.height,
      hAlign: (elem.hAlign ?? baseStyle.hAlign) as any,
      vAlign: (elem.vAlign ?? baseStyle.vAlign) as any,
      openTypeScript: elem.openTypeScript ?? baseStyle.openTypeScript,
      openTypeLanguage: elem.openTypeLanguage ?? baseStyle.openTypeLanguage,
      openTypeFeatures: elem.openTypeFeatures ?? baseStyle.openTypeFeatures,
    })

    const children: RenderNode[] = []

    // Index runs by character position
    const runRanges: { start: number; end: number; run: StyledRun }[] = []
    let charPos = 0
    for (const run of runs) {
      runRanges.push({ start: charPos, end: charPos + run.text.length, run })
      charPos += run.text.length
    }

    let globalPos = 0
    for (const line of layoutResult.lines) {
      if (line.text === '') {
        globalPos++ // newline char
        continue
      }
      const lineStart = globalPos
      const lineEnd = globalPos + line.text.length

      // Find runs spanning this line and create styled RenderText nodes
      let lineX = 0
      for (const { start, end, run } of runRanges) {
        const overlapStart = Math.max(start, lineStart)
        const overlapEnd = Math.min(end, lineEnd)
        if (overlapStart >= overlapEnd) continue

        const runText = plainText.slice(overlapStart, overlapEnd)
        if (runText === '') continue

        let fontSize = run.fontSize ?? baseStyle.fontSize
        // Measure with the segment's own font: a face switch must advance by
        // the width of the glyphs actually drawn, not the base font's width
        const segMeasurer = run.fontFamily !== undefined
          ? this.fontMap!.get(run.fontFamily) ?? measurer
          : measurer

        // <sup>/<sub>: scale and shift by the font's OS/2 recommendations
        // (ySuperscript*/ySubscript*, MVAR-adjusted under variations)
        let baselineShift = 0
        let runXOffset = 0
        let supSubScaleX = 1
        if (run.superscript === true || run.subscript === true) {
          const fm = segMeasurer.font.metrics
          const upem = fm.unitsPerEm
          const ySize = run.superscript === true ? fm.superscriptYSize : fm.subscriptYSize
          const xSize = run.superscript === true ? fm.superscriptXSize : fm.subscriptXSize
          const yOffset = run.superscript === true ? -fm.superscriptYOffset : fm.subscriptYOffset
          const xOffset = run.superscript === true ? fm.superscriptXOffset : fm.subscriptXOffset
          baselineShift = yOffset / upem * fontSize
          runXOffset = xOffset / upem * fontSize
          supSubScaleX = ySize !== 0 ? xSize / ySize : 1
          fontSize = fontSize * (ySize / upem)
        }

        // Shape the segment once: the glyph run drives both the drawn glyphs
        // (kerning/ligatures included) and the advance to the next segment
        const isVerticalWm = baseStyle.writingMode === 'vertical-rl' || baseStyle.writingMode === 'vertical-lr'
        let segWidth: number
        let segGlyphRun: RenderGlyphRun | undefined
        const featureValues = elem.openTypeFeatures ?? baseStyle.openTypeFeatures
        const featureSettings = buildOpenTypeFeatureSettings(featureValues)
        const shapeOptions = {
          script: elem.openTypeScript ?? baseStyle.openTypeScript,
          language: elem.openTypeLanguage ?? baseStyle.openTypeLanguage,
          featureSettings,
        }
        if (isVerticalWm) {
          // Vertical markup keeps the text-based path (the backend reshapes
          // vertically with vert/vrt2)
          segWidth = segMeasurer.measure(runText, fontSize, shapeOptions).width
          segGlyphRun = undefined
        } else {
          segGlyphRun = shapeGlyphRun(segMeasurer.font, runText, fontSize, 0, 0, false, 1, 'ltr', shapeOptions)
          segWidth = 0
          const segAdvances = segGlyphRun.advances
          for (let ai = 0; ai < segAdvances.length; ai++) segWidth += segAdvances[ai]!
        }

        const textNode: RenderText = {
          type: 'text',
          x: lineX + runXOffset,
          y: line.y + baselineShift,
          text: runText,
          fontId: run.fontFamily ?? baseStyle.fontFamily,
          fontSize,
          color: run.color ?? baseStyle.forecolor,
          bold: run.bold ?? baseStyle.bold,
          italic: run.italic ?? baseStyle.italic,
          underline: run.underline ?? baseStyle.underline,
          strikethrough: (run.strikethrough ?? baseStyle.strikethrough) || undefined,
          variation: baseStyle.variation,
          writingMode: baseStyle.writingMode,
          outlineText: elem.outlineText || undefined,
          pdfFontMode: elem.pdfFontMode,
          textPaintMode: elem.textPaintMode,
          textStrokeColor: elem.textStrokeColor,
          textStrokeWidth: elem.textStrokeWidth,
          glyphRun: segGlyphRun,
          horizontalScale: supSubScaleX !== 1 ? supSubScaleX : undefined,
          blendMode: elem.blendMode,
          overprintFill: elem.overprintFill,
          overprintStroke: elem.overprintStroke,
          overprintMode: elem.overprintMode,
        }
        children.push(textNode)
        lineX += segWidth
      }

      globalPos = lineEnd
      // Account for the space/newline between lines
      if (globalPos < plainText.length && (plainText[globalPos] === ' ' || plainText[globalPos] === '\n')) {
        globalPos++
      }
    }

    return {
      type: 'group',
      x: elem.x,
      y: elem.y,
      width: elem.width,
        height: elem.height,
        children,
        blendMode: elem.blendMode,
        overprintFill: elem.overprintFill,
        overprintStroke: elem.overprintStroke,
        overprintMode: elem.overprintMode,
      }
  }

  /**
   * Common method converting text content into a RenderNode.
   * Delegates to the standalone function renderTextToGroup.
   */
  private renderTextContent(
    text: string,
    elem: ElementDef & { hAlign?: string; vAlign?: string; lineSpacing?: any; letterSpacing?: number; tracking?: number; wordSpacing?: number; horizontalScale?: number; firstLineIndent?: number; leftIndent?: number; rightIndent?: number; padding?: any; stretchWithOverflow?: boolean; textTruncate?: string; shrinkToFit?: boolean; minFontSize?: number; fitWidth?: boolean; tabStops?: { position: number; alignment?: 'left' | 'center' | 'right' }[]; wrap?: boolean },
    style: ResolvedStyle,
    stretchWithOverflow: boolean,
  ): RenderNode {
    const measurer = this.fontMap?.get(style.fontFamily) ?? null
    return renderTextToGroup(text, elem, style, measurer, stretchWithOverflow)
  }

  /**
   * Wraps a text node with a rotation wrapper.
   * Places an inner group with a rotation transform inside an outer group
   * (original element position/size, with clipping).
   */
  private wrapWithRotation(
    contentNode: RenderNode,
    elem: { x: number; y: number; width: number; height: number },
    rotation: 90 | 180 | 270,
  ): RenderGroup {
    const swapDims = rotation === 90 || rotation === 270
    const layoutW = swapDims ? elem.height : elem.width
    const layoutH = swapDims ? elem.width : elem.height
    const rotParams = getRotationTransform(rotation, elem.width, elem.height)

    const innerGroup: RenderGroup = contentNode.type === 'group'
      ? { ...(contentNode as RenderGroup), ...rotParams }
      : {
          type: 'group',
          x: 0, y: 0,
          width: layoutW, height: layoutH,
          children: [contentNode],
          ...rotParams,
        }

    return {
      type: 'group',
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.height,
      clip: true,
      children: [innerGroup],
    }
  }

  /**
   * Break element: handled at the band level (renderBandWithBreaks).
   * A break element reaching element rendering (e.g. inside a frame) has no effect.
   */
  private renderBreak(_elem: ElementDef & { type: 'break' }): RenderNode | null {
    return null
  }

  /**
   * Returns an empty placeholder (for isPrintRepeatedValues / isRemoveLineWhenBlank)
   */
  private renderEmptyPlaceholder(elem: ElementDef): RenderGroup {
    return {
      type: 'group',
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.isRemoveLineWhenBlank ? 0 : elem.height,
      children: [],
    }
  }

  private renderLine(elem: ElementDef & { type: 'line' }): RenderNode {
    const color = elem.lineColor ?? elem.forecolor ?? '#000000'
    const dash = lineStyleDash(elem.lineStyle)
    return {
      type: 'line',
      x1: elem.x,
      y1: elem.y,
      x2: elem.x + elem.width,
      y2: elem.y + elem.height,
      lineWidth: elem.lineWidth ?? 1,
      color,
      dash,
      blendMode: elem.blendMode,
      overprintStroke: elem.overprintStroke,
      overprintMode: elem.overprintMode,
    }
  }

  private renderRect(elem: ElementDef & { type: 'rectangle' }): RenderNode {
    const style = this.getStyle(elem)
    return {
      type: 'rect',
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.height,
      radius: elem.radius,
      cornerRadii: elem.cornerRadii,
      fill: resolveFillPaint(elem.fill ?? (style.backcolor !== 'transparent' ? style.backcolor : undefined), elem.x, elem.y, elem.width, elem.height),
      stroke: elem.stroke ?? style.forecolor,
      strokeWidth: elem.strokeWidth ?? 1,
      blendMode: elem.blendMode,
      overprintFill: elem.overprintFill,
      overprintStroke: elem.overprintStroke,
      overprintMode: elem.overprintMode,
    }
  }

  private renderEllipse(elem: ElementDef & { type: 'ellipse' }): RenderNode {
    return {
      type: 'ellipse',
      cx: elem.x + elem.width / 2,
      cy: elem.y + elem.height / 2,
      rx: elem.width / 2,
      ry: elem.height / 2,
      fill: resolveFillPaint(elem.fill, elem.x, elem.y, elem.width, elem.height),
      stroke: elem.stroke,
      strokeWidth: elem.strokeWidth,
      blendMode: elem.blendMode,
      overprintFill: elem.overprintFill,
      overprintStroke: elem.overprintStroke,
      overprintMode: elem.overprintMode,
    }
  }

  private renderPathElement(elem: PathDef): RenderPath {
    const parsed = elem.pdfSourceVector === undefined
      ? parseSvgPath(elem.d)
      : { commands: new Uint8Array(), coords: new Float32Array() }
    const coords = new Float32Array(parsed.coords.length)
    let sx = 1
    let sy = 1
    let ox = 0
    let oy = 0
    if (elem.viewBox) {
      ox = elem.viewBox[0]
      oy = elem.viewBox[1]
      sx = elem.width / elem.viewBox[2]
      sy = elem.height / elem.viewBox[3]
    }
    for (let i = 0; i < parsed.coords.length; i += 2) {
      coords[i] = (parsed.coords[i]! - ox) * sx
      coords[i + 1] = (parsed.coords[i + 1]! - oy) * sy
    }
    const affineTransform = elem.affineTransform === undefined
      ? undefined
      : [
          elem.affineTransform[0], elem.affineTransform[1], elem.affineTransform[2], elem.affineTransform[3],
          elem.affineTransform[4] + elem.x, elem.affineTransform[5] + elem.y,
        ] as [number, number, number, number, number, number]
    if (affineTransform === undefined) {
      for (let i = 0; i < coords.length; i += 2) {
        coords[i] = coords[i]! + elem.x
        coords[i + 1] = coords[i + 1]! + elem.y
      }
    }
    return {
      type: 'path',
      commands: parsed.commands,
      coords,
      pdfSourceVector: elem.pdfSourceVector === undefined ? undefined : {
        definitions: elem.pdfSourceVector.definitions.map(function (definition) {
          return {
            commands: new Uint8Array(definition.commands),
            coords: new Float32Array(definition.coords),
          }
        }),
        instances: elem.pdfSourceVector.instances.map(function (instance) {
          const matrix = instance.matrix
          return {
            definitionIndex: instance.definitionIndex,
            matrix: [
              matrix[0], matrix[1], matrix[2], matrix[3],
              matrix[4] + (affineTransform === undefined ? elem.x : 0),
              matrix[5] + (affineTransform === undefined ? elem.y : 0),
            ],
          }
        }),
      },
      affineTransform,
      fill: resolveFillPaint(elem.fill, elem.x, elem.y, elem.width, elem.height),
      fillRule: elem.fillRule,
      fillOpacity: elem.fillOpacity,
      stroke: resolveFillPaint(elem.stroke, elem.x, elem.y, elem.width, elem.height),
      strokeWidth: elem.strokeWidth,
      strokeOpacity: elem.strokeOpacity,
      strokeLinecap: elem.strokeLinecap,
      strokeLinejoin: elem.strokeLinejoin,
      strokeMiterLimit: elem.strokeMiterLimit,
      strokeDasharray: elem.strokeDasharray,
      strokeDashoffset: elem.strokeDashoffset,
      blendMode: elem.blendMode,
      overprintFill: elem.overprintFill,
      overprintStroke: elem.overprintStroke,
      overprintMode: elem.overprintMode,
    }
  }

  private renderImage(elem: ImageDef): RenderNode | null {
    const onError = elem.onError ?? 'icon'

    // 1. Resolve image source
    let imageId: string | undefined
    if (elem.sourceExpression) {
      const result = this.evalExpr(elem.sourceExpression)
      imageId = this.resourceResolver.resolveImageIdFromExpression(result)
    }
    // sourceExpression is null/undefined or absent → fall back to source
    if (imageId === undefined) {
      imageId = elem.source
    }
    if (imageId === undefined) {
      switch (onError) {
        case 'error': throw new Error('Image source is undefined')
        case 'blank': return null
        default: return this.renderImageErrorIcon(elem)
      }
    }

    // 2. Resolve image data
    const sourceImageId = imageId
    const resolvedImageId = this.resourceResolver.ensureImageAvailable(sourceImageId)
    if (resolvedImageId === null) {
      switch (onError) {
        case 'error': throw new Error(`Image not found: ${sourceImageId}`)
        case 'blank': return null
        default: return this.renderImageErrorIcon(elem)
      }
    }
    imageId = resolvedImageId

    const alternates = elem.alternates === undefined
      ? undefined
      : this.resourceResolver.resolveImageAlternates(elem.alternates)
    const pdfImageFlags = {
      renderingIntent: elem.renderingIntent,
      interpolate: elem.interpolate,
      alternates,
      opi: elem.opi,
      measure: elem.measure,
      pointData: elem.pointData,
    }

    // 3. Resolve image size
    const scaleMode = elem.scaleMode ?? 'retainShape'
    const hAlign = elem.hAlign ?? 'left'
    const vAlign = elem.vAlign ?? 'top'
    const imgSize = scaleMode === 'fillFrame' ? null : this.resourceResolver.getImageSize(imageId, sourceImageId)

    if (elem.affineTransform !== undefined) {
      return {
        type: 'image',
        x: elem.x,
        y: elem.y,
        width: elem.width,
        height: elem.height,
        imageId,
        affineTransform: elem.affineTransform.slice() as [number, number, number, number, number, number],
        opacity: elem.opacity,
        blendMode: elem.blendMode,
        overprintFill: elem.overprintFill,
        overprintMode: elem.overprintMode,
        ...pdfImageFlags,
      }
    }

    // Image size unknown → same behavior as fillFrame
    if (!imgSize) {
      return { type: 'image', x: elem.x, y: elem.y, width: elem.width, height: elem.height, imageId, rotation: elem.rotation, opacity: elem.opacity, blendMode: elem.blendMode, overprintFill: elem.overprintFill, overprintMode: elem.overprintMode, ...pdfImageFlags }
    }

    const imgW = imgSize.width
    const imgH = imgSize.height

    // If the image size is zero, draw across the whole frame
    if (imgW <= 0 || imgH <= 0) {
      return { type: 'image', x: elem.x, y: elem.y, width: elem.width, height: elem.height, imageId, rotation: elem.rotation, opacity: elem.opacity, blendMode: elem.blendMode, overprintFill: elem.overprintFill, overprintMode: elem.overprintMode, ...pdfImageFlags }
    }

    switch (scaleMode) {
      case 'fillFrame':
        return { type: 'image', x: elem.x, y: elem.y, width: elem.width, height: elem.height, imageId, rotation: elem.rotation, opacity: elem.opacity, blendMode: elem.blendMode, overprintFill: elem.overprintFill, overprintMode: elem.overprintMode, ...pdfImageFlags }

      case 'retainShape': {
        const scale = Math.min(elem.width / imgW, elem.height / imgH)
        const drawW = imgW * scale
        const drawH = imgH * scale
        let drawX = elem.x
        let drawY = elem.y
        if (hAlign === 'center') drawX += (elem.width - drawW) / 2
        else if (hAlign === 'right') drawX += elem.width - drawW
        if (vAlign === 'middle') drawY += (elem.height - drawH) / 2
        else if (vAlign === 'bottom') drawY += elem.height - drawH
        return { type: 'image', x: drawX, y: drawY, width: drawW, height: drawH, imageId, rotation: elem.rotation, opacity: elem.opacity, blendMode: elem.blendMode, overprintFill: elem.overprintFill, overprintMode: elem.overprintMode, ...pdfImageFlags }
      }

      case 'clip':
      case 'realSize': {
        let imgX = 0
        let imgY = 0
        if (hAlign === 'center') imgX = (elem.width - imgW) / 2
        else if (hAlign === 'right') imgX = elem.width - imgW
        if (vAlign === 'middle') imgY = (elem.height - imgH) / 2
        else if (vAlign === 'bottom') imgY = elem.height - imgH
        return {
          type: 'group',
          x: elem.x,
          y: elem.y,
          width: elem.width,
          height: elem.height,
          clip: true,
          blendMode: elem.blendMode,
          overprintFill: elem.overprintFill,
          overprintMode: elem.overprintMode,
          children: [{
            type: 'image',
            x: imgX,
            y: imgY,
            width: imgW,
            height: imgH,
            imageId,
            rotation: elem.rotation,
            opacity: elem.opacity,
            blendMode: elem.blendMode,
            overprintFill: elem.overprintFill,
            overprintMode: elem.overprintMode,
            ...pdfImageFlags,
          }],
        }
      }
    }
  }

  /** Placeholder for image errors (X mark) */
  private renderImageErrorIcon(elem: ElementDef): RenderGroup {
    return {
      type: 'group',
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.height,
      children: [
        { type: 'rect', x: 0, y: 0, width: elem.width, height: elem.height, stroke: '#CCCCCC', strokeWidth: 0.5 },
        { type: 'line', x1: 0, y1: 0, x2: elem.width, y2: elem.height, lineWidth: 0.5, color: '#CCCCCC' },
        { type: 'line', x1: elem.width, y1: 0, x2: 0, y2: elem.height, lineWidth: 0.5, color: '#CCCCCC' },
      ],
    }
  }

  private renderFrame(elem: ElementDef & { type: 'frame' }): RenderNode {
    const group: RenderGroup = {
      type: 'group',
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.height,
      clip: elem.clip !== false,
      children: [],
      blendMode: elem.blendMode,
      overprintFill: elem.overprintFill,
      overprintStroke: elem.overprintStroke,
      overprintMode: elem.overprintMode,
    }
    if (elem.rotation !== undefined && elem.rotation !== 0) {
      group.rotation = -elem.rotation
      group.rotationOriginX = elem.rotationOriginX ?? 0
      group.rotationOriginY = elem.rotationOriginY ?? 0
    }
    if (elem.affineTransform !== undefined) group.affineTransform = elem.affineTransform
    if (elem.pdfForm !== undefined) group.pdfForm = elem.pdfForm
    if (elem.clipPath) {
      const parsed = parseSvgPath(elem.clipPath.d)
      group.clipPath = {
        commands: parsed.commands,
        coords: parsed.coords,
        fillRule: elem.clipPath.fillRule,
      }
    }

    // Transparency group / soft mask (A6.2/A6.3). Frame opacity is applied by
    // the outer decoration wrapper (renderElement), so it is left off this
    // group; isolation and the soft mask belong to the composited unit itself.
    if (elem.transparencyGroup === true) group.transparencyGroup = true
    if (elem.isolated === true) group.isolated = true
    if (elem.knockout === true) group.knockout = true
    if (elem.deviceParams) group.deviceParams = elem.deviceParams
    if (elem.softMask) {
      const maskContent: RenderNode[] = []
      for (const child of elem.softMask.elements) {
        const node = this.renderElement(child)
        if (node) maskContent.push(node)
      }
      group.softMask = {
        type: elem.softMask.type,
        colorSpace: elem.softMask.colorSpace,
        isolated: elem.softMask.isolated,
        knockout: elem.softMask.knockout,
        backdrop: elem.softMask.backdrop,
        content: maskContent,
      }
      if (elem.softMask.transferFunction) group.softMask.transferFunction = elem.softMask.transferFunction
    }

    // Background
    if (elem.backcolor) {
      group.children.push({
        type: 'rect',
        x: 0,
        y: 0,
        width: elem.width,
        height: elem.height,
        fill: elem.backcolor,
      })
    }

    // Child elements
    const pendingStart = this.pendingInlineBandsList.length
    for (const child of elem.elements ?? []) {
      const node = this.renderElement(child)
      if (node) group.children.push(node)
    }
    // Inline bands produced by children (subreports/tables/crosstabs) carry
    // frame-relative coordinates; shift them into band coordinates.
    for (let i = pendingStart; i < this.pendingInlineBandsList.length; i++) {
      const pending = this.pendingInlineBandsList[i]!
      pending.elemX += elem.x
      pending.elemY += elem.y
    }

    return group
  }

  private renderBarcodeElement(elem: ElementDef & { type: 'barcode' }): RenderNode {
    const data = String(this.evalExpr(elem.expression))
    return renderBarcode(elem.barcodeType, data, {
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.height,
      showText: elem.showText,
      errorCorrectionLevel: elem.errorCorrectionLevel,
    })
  }

  private renderMathElement(elem: ElementDef & { type: 'math' }): RenderNode | null {
    const formula = String(this.evalExpr(elem.formula))
    if (!formula) return null

    const style = this.getStyle(elem)
    const fontId = elem.mathFontFamily ?? style.fontFamily ?? 'default'
    const measurer = this.fontMap?.get(fontId)
    if (!measurer) return null

    const font = measurer.font
    const fontSize = elem.fontSize ?? style.fontSize ?? 12
    const color = elem.color ?? elem.forecolor ?? style.forecolor ?? '#000000'

    const ast = parseMathLaTeX(formula)
    const box = layoutMathFormula(ast, font, fontId, fontSize, color)

    // Place the box at the element position (baseline vertically centered)
    // If the formula's actual extent (box.height + box.depth) exceeds elem.height,
    // expand the group height so clipping does not cut it off.
    const mathHeight = box.height + box.depth
    const groupHeight = Math.max(elem.height, mathHeight)
    const baselineYInGroup = (groupHeight + box.height - box.depth) / 2

    const group: RenderGroup = {
      type: 'group',
      x: elem.x,
      y: elem.y,
      width: Math.max(elem.width, box.width),
      height: groupHeight,
      children: [{
        type: 'group' as const,
        x: 0,
        y: baselineYInGroup,
        width: box.width,
        height: mathHeight,
        children: box.nodes,
      }],
    }

    return group
  }

  private renderSvgElement(elem: ElementDef & { type: 'svg'; svgContent: Expression }): RenderNode {
    const svgData = String(this.evalExpr(elem.svgContent))
    const node: RenderSvg = {
      type: 'svg',
      x: elem.x,
      y: elem.y,
      width: elem.width,
      height: elem.height,
      svgData,
    }
    return node
  }

  private renderTableElement(elem: ElementDef & { type: 'table' }): RenderNode {
    const tableElem = elem as import('../types/template.js').TableElementDef

    // Build TableDef from element definition
    const tableDef: TableDef = {
      columns: tableElem.columns,
      headerRows: tableElem.headerRows as any,
      detailRows: tableElem.detailRows as any,
      footerRows: tableElem.footerRows as any,
      border: tableElem.border,
    }

    // Context for expression resolution and text wrapping
    const self = this
    const context: TableLayoutContext = {
      resolveExpression: (expression: string) => {
        const result = self.evalExpr(expression)
        return result != null ? String(result) : ''
      },
      fontMap: this.fontMap,
      renderCellElements(elements: unknown[], cellWidth: number, cellHeight: number): RenderNode[] {
        const nodes: RenderNode[] = []
        const elems = elements as import('../types/template.js').ElementDef[]
        for (let i = 0; i < elems.length; i++) {
          const node = self.renderElement(elems[i]!)
          if (node) nodes.push(node)
        }
        return nodes
      },
      measureCellElements(elements: unknown[], cellWidth: number): number {
        const elems = elements as import('../types/template.js').ElementDef[]
        let maxBottom = 0
        for (let i = 0; i < elems.length; i++) {
          const el = elems[i]!
          const bottom = el.y + el.height
          if (bottom > maxBottom) maxBottom = bottom
        }
        return maxBottom
      },
    }

    // Data rows: subdataset when dataSourceExpression is set, main data source when omitted
    const rows = this.resolveTableDataRows(tableElem)

    // Page spanning: split into pages when the table does not fit in the remaining area
    const availableHeight = this.getOverflowBottomY() - this.cursorY - elem.y

    // First lay out the whole table to check whether it fits
    const fullGroup = layoutTable(tableDef, elem.x, elem.y, elem.width, rows, context)
    if (fullGroup.height <= availableHeight || rows.length === 0) {
      return fullGroup
    }

    // Page spanning needed: split per page and add as inline bands
    const bands: SubreportBand[] = []
    let startRow = 0
    let isFirstPage = true
    const pageHeaderHeight = this.template.bands.pageHeader?.height ?? 0
    const fullPageHeight = this.contentBottom - this.contentTop - pageHeaderHeight - this.getPageFooterHeight() - this.getColumnFooterHeight()

    while (startRow < rows.length) {
      const maxH = isFirstPage ? availableHeight : fullPageHeight
      // Chunks are positioned by the inline-band wrapper (elemX/elemY), so
      // they are laid out at the origin — applying elem.x/elem.y here would
      // double the offset.
      const result = layoutTablePaged(tableDef, 0, 0, elem.width, rows, context, startRow, maxH)

      bands.push({
        height: result.group.height,
        children: [result.group],
      })

      startRow += result.renderedDataRows
      if (result.complete) break
      isFirstPage = false
    }

    // Set into pendingInlineBandsList → renderBand places them via placeInlineBands()
    this.pendingInlineBandsList.push({
      bands,
      elemX: elem.x,
      elemY: elem.y,
      elemWidth: elem.width,
      elemHeight: elem.height,
    })

    // Return null — the content is placed by placeInlineBands on the renderBand side
    return null as any
  }

  private renderCrosstabElement(elem: ElementDef & { type: 'crosstab' }): RenderNode {
    const ctElem = elem as import('../types/template.js').CrosstabElementDef

    const crosstabDef: CrosstabDef = {
      rowGroups: ctElem.rowGroups,
      columnGroups: ctElem.columnGroups,
      measures: ctElem.measures,
      rowHeaderWidth: ctElem.rowHeaderWidth,
      columnHeaderHeight: ctElem.columnHeaderHeight,
      cellWidth: ctElem.cellWidth,
      cellHeight: ctElem.cellHeight,
      border: ctElem.border,
      showSubtotals: ctElem.showSubtotals,
      showGrandTotal: ctElem.showGrandTotal,
    }

    const context: CrosstabLayoutContext = {
      measurer: this.fontMap?.get('default'),
    }

    // Data source: take data from the expression when present, otherwise the main data source
    let rows: Record<string, unknown>[]
    if (ctElem.dataSourceExpression) {
      const result = this.evalExpr(ctElem.dataSourceExpression)
      rows = Array.isArray(result) ? result as Record<string, unknown>[] : this.dataSource.rows
    } else {
      rows = this.dataSource.rows
    }

    // Page spanning: when the crosstab does not fit in the remaining area, split into pages at row boundaries
    const availableHeight = this.getOverflowBottomY() - this.cursorY - elem.y

    // First lay out the whole crosstab to check whether it fits
    const fullGroup = layoutCrosstab(crosstabDef, elem.x, elem.y, rows, context)
    if (fullGroup.height <= availableHeight || rows.length === 0) {
      return fullGroup
    }

    // Page spanning needed: split per page and add as inline bands
    const bands: SubreportBand[] = []
    let startRow = 0
    let isFirstPage = true
    const pageHeaderHeight = this.template.bands.pageHeader?.height ?? 0
    const fullPageHeight = this.contentBottom - this.contentTop - pageHeaderHeight - this.getPageFooterHeight() - this.getColumnFooterHeight()

    for (;;) {
      const maxH = isFirstPage ? availableHeight : fullPageHeight
      // Chunks are positioned by the inline-band wrapper (elemX/elemY), so
      // they are laid out at the origin — applying elem.x/elem.y here would
      // double the offset.
      const result = layoutCrosstabPaged(crosstabDef, 0, 0, rows, context, startRow, maxH)

      bands.push({
        height: result.group.height,
        children: [result.group],
      })

      startRow += result.renderedDataRows
      if (result.complete) break
      isFirstPage = false
    }

    // Set into pendingInlineBandsList → renderBand places them via placeInlineBands()
    this.pendingInlineBandsList.push({
      bands,
      elemX: elem.x,
      elemY: elem.y,
      elemWidth: elem.width,
      elemHeight: elem.height,
    })

    // Return null — the content is placed by placeInlineBands on the renderBand side
    return null as any
  }

  private renderSubreport(elem: ElementDef & { type: 'subreport' }): RenderNode | null {
    // Reuse the result collected during height estimation for the same row.
    const cached = this.subreportRunCache.get(elem)
    let childEngine: LayoutEngine
    let bands: SubreportBand[]
    if (cached && cached.row === this.currentRow) {
      this.subreportRunCache.delete(elem)
      childEngine = cached.engine
      bands = cached.bands
    } else {
      const created = this.createSubreportEngine(elem)
      if (!created) return null
      childEngine = created
      bands = childEngine.runCollect()
    }

    if (bands.length === 0) return null

    // Set the collected bands into pendingInlineBandsList.
    // renderBand() calls placeInlineBands() to place them into the parent's
    // page flow. The child report's own left margin insets its content within
    // the element region.
    this.pendingInlineBandsList.push({
      bands,
      runToBottom: elem.runToBottom,
      elemX: elem.x + childEngine.marginLeft,
      elemY: elem.y,
      elemWidth: elem.width,
      elemHeight: elem.height,
    })

    // returnValues: apply subreport variable values to the parent.
    if (elem.returnValues) {
      const childVars = childEngine.variables
      for (let i = 0; i < elem.returnValues.length; i++) {
        const rv = elem.returnValues[i]!
        const childValue = childVars[rv.subreportVariable]
        // Mark this variable so updateVariables() does not overwrite it.
        this.returnValueVars.add(rv.name)
        if (rv.calculation === 'nothing') {
          this.variables[rv.name] = childValue
        } else {
          // Accumulator dedicated to returnValues, aggregated by rv.calculation.
          let acc = this.returnValueAccumulators.get(rv.name)
          if (!acc) {
            acc = new VariableAccumulator(rv.calculation)
            this.returnValueAccumulators.set(rv.name, acc)
          }
          acc.add(childValue)
          this.variables[rv.name] = acc.value
        }
      }
    }

    // Return null because renderBand places content through placeInlineBands.
    return null
  }

/**
    * Place collected subreport bands into the parent page flow.
    * Run needsOverflow() before placing each band,
    * and continue on a new page with breakPage() when overflow occurs.
    * When collectMode is active, append to collectedBands.
 */
  
  private placeInlineBands(pending: PendingInlineBands): void {
    const useColumns = this.columnCount > 1
    const baseX = useColumns ? this.columnX + pending.elemX : this.marginLeft + pending.elemX

    for (let i = 0; i < pending.bands.length; i++) {
      const band = pending.bands[i]!

      // Forced page break collected inside the subreport: propagate to this flow.
      if (band.pageBreak) {
        if (this.collectMode) {
          this.collectedBands.push({ height: 0, children: [], pageBreak: true })
        } else {
          this.breakPage()
        }
        continue
      }

      if (this.collectMode) {
        // collectMode: append to collectedBands and wrap in a group when an X offset exists.
        if (pending.elemX !== 0) {
          this.collectedBands.push({
            height: band.height,
            children: [{
              type: 'group' as const,
              x: pending.elemX,
              y: 0,
              width: pending.elemWidth,
              height: band.height,
              children: band.children,
            }],
            deferredEvals: band.deferredEvals,
          })
        } else {
          this.collectedBands.push({
            height: band.height,
            children: band.children,
            deferredEvals: band.deferredEvals,
          })
        }
        this.cursorY += band.height
        continue
      }

      // Overflow check.
      if (this.needsOverflow(band.height)) {
        this.breakPage()
      }

      this.resolveInlineBandDeferredEvals(band)

      // Place the band on the page.
      const group: RenderGroup = {
        type: 'group',
        x: baseX,
        y: this.cursorY,
        width: pending.elemWidth,
        height: band.height,
        clip: true,
        children: band.children,
      }

      this.currentPage.children.push(group)
      this.cursorY += band.height
    }
  }

  private resolveInlineBandDeferredEvals(band: SubreportBand): void {
    if (!band.deferredEvals) return
    for (let i = 0; i < band.deferredEvals.length; i++) {
      const deferred = band.deferredEvals[i]!
      if (deferred.evaluationTime === 'masterNow') {
        // Fix the master page context now (the page this band is placed on) and
        // defer to the master report end so TOTAL_PAGES becomes the final count.
        this.captureMasterPlacement(deferred)
        this.deferredEvals.push(deferred)
      } else {
        this.resolveSingleDeferred(deferred)
      }
    }
  }

  

  /**
   * Phase 1 of group processing for a data row: detects the outermost changed
   * group, closes footers (evaluated with the previous row), resets group
   * variables, and performs page/column breaks. Returns the index of the
   * outermost opened group, or -1 when no group opens on this row.
   * Group headers are rendered afterwards by renderGroupHeadersFrom(), after
   * the new row's variable values have been calculated.
   */
  private processGroupBreaks(isFirst: boolean): number {
    const groups = this.template.groups ?? []
    if (groups.length === 0) return -1

    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!
      const newValue = this.evalExpr(group.expression)
      const oldValue = this.groupValues.get(group.name)

      if (isFirst || newValue !== oldValue) {
        // Horizontal print order: reset the column to 0 when a group changes.
        if (this.printOrder === 'horizontal' && this.currentColumn > 0) {
          this.cursorY = this.horizontalRowStartY + this.horizontalRowMaxH
          this.currentColumn = 0
        }

        // Group break: close footers from inner to outer groups.
        // Evaluate footer expressions with the closing group's last row.
        if (!isFirst) {
          const savedRow = this.currentRow
          this.currentRow = this.previousRow
          this.masterFooterPosition = this.computeMasterFooterPosition(groups, g, groups.length - 1)
          for (let inner = groups.length - 1; inner >= g; inner--) {
            this.renderGroupFooter(groups[inner]!)
            this.resetGroupVariables(groups[inner]!.name)
          }
          // post-loop: master=FORCE -> consume all remaining space
          if (this.masterFooterPosition === 'forceAtBottom') {
            this.cursorY = this.contentBottom - this.getPageFooterHeight()
          }
          this.masterFooterPosition = 'normal'
          this.currentRow = savedRow
        }

        // Update values.
        this.groupValues.set(group.name, newValue)

        // resetPageNumber (common report semantics): the page number restarts on
        // the page this group opens, i.e. only when the group actually causes a
        // page break. The reset is deferred into breakPage() so the closing
        // page's footer keeps its real number (see breakPage).
        const resetPN = !!group.resetPageNumber && !isFirst
        let pageBroken = false

        // For page breaks caused by group breaks, suppress reprinting groups not opened yet.
        // This avoids duplicating the normal header render.
        this.reprintGroupLimit = g

        // Column break or page break. The first group instance also breaks when
        // the current page already has content (e.g. a title on the same page).
        const breakable = !isFirst || this.pageStartConsumed
        if (breakable && group.startNewColumn) {
          if (this.columnCount > 1 && this.currentColumn < this.columnCount - 1) {
            // A column break stays on the same page, so it never resets the page number.
            this.breakColumn()
          } else {
            this.breakPage(this.currentPageFlowKind, resetPN)
            pageBroken = true
          }
        } else if (breakable && group.startNewPage) {
          this.breakPage(this.currentPageFlowKind, resetPN)
          pageBroken = true
        } else if (breakable && group.minHeightToStartNewPage) {
          const remaining = this.getOverflowBottomY() - this.cursorY
          if (remaining < group.minHeightToStartNewPage) {
            this.breakPage(this.currentPageFlowKind, resetPN)
            pageBroken = true
          }
        }

        // keepTogether: check whether the entire group fits in the remaining space.
        if (group.keepTogether) {
          const estimatedHeight = this.estimateGroupHeight(groups, g)
          const remaining = this.getOverflowBottomY() - this.cursorY
          // Break the page only when remaining space is insufficient and a full page can fit the group.
          if (estimatedHeight > remaining) {
            const freshAvail = this.getFreshPageAvailableHeight()
            if (estimatedHeight <= freshAvail) {
              // Only reset here if no earlier break in this group already did.
              this.breakPage(this.currentPageFlowKind, pageBroken ? false : resetPN)
              pageBroken = true
            }
          }
        }

        return g // After one break, all inner groups are already reset.
      }
    }
    return -1
  }

  /**
   * Phase 2 of group processing: renders headers from the outermost opened
   * group inward. Runs after the current row's variables are calculated so
   * header expressions see the values including the row that opens the group.
   */
  private renderGroupHeadersFrom(g: number): void {
    const groups = this.template.groups ?? []
    for (let inner = g; inner < groups.length; inner++) {
      const innerGroup = groups[inner]!
      // Even when headers overflow, reprint only already-rendered outer groups.
      this.reprintGroupLimit = inner
      this.renderBand(innerGroup.header, 'groupHeader')
      if (inner > g) {
        this.groupValues.set(innerGroup.name, this.evalExpr(innerGroup.expression))
      }
    }
    this.reprintGroupLimit = null

    // Horizontal print order: reset the horizontal row start after group headers.
    if (this.printOrder === 'horizontal') {
      this.horizontalRowStartY = this.cursorY
      this.horizontalRowMaxH = 0
    }
  }

/**
    * Calculate estimated group height.
    * Header + data rows times detail height + footer + inner group headers/footers.
 */
  
  private estimateGroupHeight(groups: GroupDef[], groupIndex: number): number {
    const group = groups[groupIndex]!
    let height = 0

    // Header height.
    if (group.header) height += this.estimateBandHeight(group.header)

    // Count data rows until the group expression changes from the current position.
    const rows = this.dataSource.rows
    const currentIdx = this.reportRecordCount - 1 // 0-based
    const currentValue = this.evalExpr(group.expression)
    let rowCount = 0

    for (let i = currentIdx; i < rows.length; i++) {
      const savedRow = this.currentRow
      this.currentRow = rows[i]!
      const val = this.evalExpr(group.expression)
      this.currentRow = savedRow
      if (i > currentIdx && val !== currentValue) break
      rowCount++
    }

    // Detail band height times row count.
    const details = this.template.bands.details ?? []
    let detailHeight = 0
    for (let d = 0; d < details.length; d++) {
      detailHeight += this.estimateBandHeight(details[d]!)
    }
    height += rowCount * detailHeight

    // Inner group headers and footers.
    for (let inner = groupIndex + 1; inner < groups.length; inner++) {
      if (groups[inner]!.header) height += this.estimateBandHeight(groups[inner]!.header!)
      if (groups[inner]!.footer) height += this.estimateBandHeight(groups[inner]!.footer!)
    }

    // Footer height.
    if (group.footer) height += this.estimateBandHeight(group.footer)

    return height
  }

  private closeAllGroups(): void {
    const groups = this.template.groups ?? []
    if (groups.length === 0) return
    this.masterFooterPosition = this.computeMasterFooterPosition(groups, 0, groups.length - 1)
    for (let g = groups.length - 1; g >= 0; g--) {
      this.renderGroupFooter(groups[g]!)
      this.resetGroupVariables(groups[g]!.name)
    }
    // post-loop: master=FORCE consumes all remaining space.
    if (this.masterFooterPosition === 'forceAtBottom') {
      this.cursorY = this.contentBottom - this.getPageFooterHeight()
    }
    this.masterFooterPosition = 'normal'
  }

  /** Precompute masterFooterPosition during the close cycle. */
  private computeMasterFooterPosition(groups: GroupDef[], startIdx: number, endIdx: number): 'normal' | 'stackAtBottom' | 'forceAtBottom' {
    let master: 'normal' | 'stackAtBottom' | 'forceAtBottom' = 'normal'
    for (let i = startIdx; i <= endIdx; i++) {
      const pos = groups[i]!.footerPosition ?? 'normal'
      if (pos === 'forceAtBottom') return 'forceAtBottom'
      if (pos === 'stackAtBottom') master = 'stackAtBottom'
      // collateAtBottom and normal do not change master.
    }
    return master
  }

  /** Return the effective footerPosition considering masterFooterPosition. */
  private getEffectiveFooterPosition(pos: string): string {
    if (pos === 'normal') return 'normal'
    if (pos === 'collateAtBottom') {
      // COLLATE is weak: it cooperates with STACK or stronger master values and cancels to inline with NORMAL.
      return this.masterFooterPosition === 'normal' ? 'normal' : this.masterFooterPosition
    }
    // STACK / FORCE: promote to FORCE when master is FORCE.
    if (this.masterFooterPosition === 'forceAtBottom') return 'forceAtBottom'
    return pos
  }

  private renderGroupFooter(group: GroupDef): void {
    if (!group.footer) return

    const pos = group.footerPosition ?? 'normal'
    const effectivePos = this.getEffectiveFooterPosition(pos)

    // Common report behavior resolves FORCE_AT_BOTTOM immediately inside fillGroupFooter.
    // When a footer whose original position is forceAtBottom is in the deferred queue,
    // subsequent content has no physical space and triggers a page break.
    // Use the original position, not the effective value promoted by master.
    //   inner=STACK promoted by master=FORCE is not resolved immediately.
    const hasForceInner = this.deferredBottomFooters.some(d => d.position === 'forceAtBottom')
    if (hasForceInner) {
      this.breakPage()
    }

    if (effectivePos === 'normal') {
      this.renderBand(group.footer, 'groupFooter')
    } else {
      // Save the original position for the hasForceInner check.
      this.deferredBottomFooters.push({ band: group.footer, group, position: pos, dataRow: this.currentRow })
      // Resolve only original FORCE immediately by setting cursorY to the page bottom.
      // Handle effective promotion from STACK to FORCE in the post-loop.
      if (pos === 'forceAtBottom') {
        this.cursorY = this.contentBottom - this.getPageFooterHeight()
      }
    }

    // Resolve group-level deferred evaluations.
    this.resolveDeferredByTime('group', group.name)
  }

  private resetGroupVariables(groupName: string): void {
    for (const varDef of this.template.variables ?? []) {
      if (varDef.resetType === 'group' && varDef.resetGroup === groupName) {
        this.resetVariable(varDef.name)
      }
    }
  }

  private resetPageVariables(): void {
    for (const varDef of this.template.variables ?? []) {
      if (varDef.resetType === 'page') {
        this.resetVariable(varDef.name)
        // Mid-row break: the current row moves to the new page, so its
        // increment carries over into the fresh accumulation.
        if (this.rowPendingSnapshot) this.reapplyRowIncrement(varDef)
      }
    }
  }

  private resetColumnVariables(): void {
    for (const varDef of this.template.variables ?? []) {
      if (varDef.resetType === 'column') {
        this.resetVariable(varDef.name)
        if (this.rowPendingSnapshot) this.reapplyRowIncrement(varDef)
      }
    }
  }

  /** Reset a single variable: returnValue-managed variables reset their dedicated accumulator. */
  private resetVariable(name: string): void {
    const rvAcc = this.returnValueAccumulators.get(name)
    if (rvAcc) {
      rvAcc.reset()
      this.variables[name] = rvAcc.value
      return
    }
    const acc = this.variableAccumulators.get(name)
    acc?.reset()
    this.variables[name] = acc?.value ?? 0
  }

  // noData band.
  

  private renderNoDataBand(): void {
    if (this.template.bands.noData) {
      this.renderBand(this.template.bands.noData, 'noData')
    }
  }

  // Variables.
  

  private initVariables(): void {
    for (const varDef of this.template.variables ?? []) {
      const acc = new VariableAccumulator(varDef.calculation)
      if (varDef.initialValue !== undefined) {
        acc.setInitial(this.evalExpr(varDef.initialValue))
      }
      this.variableAccumulators.set(varDef.name, acc)
      this.variables[varDef.name] = acc.value
    }
  }

  private updateVariables(): void {
    // Snapshot the pre-increment values: while the current row's bands are
    // being rendered, a page/column break must evaluate footers without the
    // not-yet-printed row (see breakPage/breakColumn), and page/column resets
    // re-apply this row's increment so it carries over to the new page/column.
    this.rowPendingSnapshot = { ...this.variables }

    for (const varDef of this.template.variables ?? []) {
      // Skip variables managed by returnValues.
      if (this.returnValueVars.has(varDef.name)) continue

      // Check increment conditions.
      if (varDef.incrementCondition) {
        const shouldIncrement = this.evalExpr(varDef.incrementCondition)
        if (!shouldIncrement) continue
      }

      const value = this.evalExpr(varDef.expression)
      const acc = this.variableAccumulators.get(varDef.name)!
      acc.add(value)
      this.variables[varDef.name] = acc.value
    }
  }

  /** Re-applies the current row's increment to a variable after a mid-row reset. */
  private reapplyRowIncrement(varDef: VariableDef): void {
    if (this.returnValueVars.has(varDef.name)) return
    if (varDef.incrementCondition && !this.evalExpr(varDef.incrementCondition)) return
    const acc = this.variableAccumulators.get(varDef.name)!
    acc.add(this.evalExpr(varDef.expression))
    this.variables[varDef.name] = acc.value
  }

  // Deferred evaluation.
  

  /** Resolve deferred evaluations for the specified timing. */
  private resolveDeferredByTime(time: DeferredEvaluationTime, groupName?: string): void {
    const remaining: DeferredEval[] = []
    for (const deferred of this.deferredEvals) {
      if (deferred.evaluationTime === 'auto') {
        this.captureAutoEvaluationValues(deferred, time, groupName)
        if (this.isAutoEvaluationReady(deferred)) {
          this.resolveAutoDeferred(deferred)
        } else {
          remaining.push(deferred)
        }
      } else if (deferred.evaluationTime === 'masterNow' && time === 'masterNow') {
        // A subreport field referencing the master page context: fix PAGE_NUMBER /
        // COLUMN_NUMBER to the master page this band lands on, then defer the actual
        // evaluation to the master report end so TOTAL_PAGES resolves to the final count.
        this.captureMasterPlacement(deferred)
        remaining.push(deferred)
      } else if (deferred.evaluationTime === time && this.matchesDeferredGroup(deferred, groupName)) {
        this.resolveSingleDeferred(deferred)
      } else {
        remaining.push(deferred)
      }
    }
    this.deferredEvals = remaining
  }

  private extractDeferredEvalsByTimeSince(startIndex: number, time: DeferredEvaluationTime): DeferredEval[] | undefined {
    const extracted: DeferredEval[] = []
    const remaining: DeferredEval[] = []
    for (let i = 0; i < this.deferredEvals.length; i++) {
      const deferred = this.deferredEvals[i]!
      if (i >= startIndex && deferred.evaluationTime === time) {
        extracted.push(deferred)
      } else {
        remaining.push(deferred)
      }
    }
    this.deferredEvals = remaining
    return extracted.length > 0 ? extracted : undefined
  }

  private resolveDeferredEvals(): void {
    // Report-level deferred evaluation; update directly to override TOTAL_PAGES instead of using evalExpr.
    const r = this.reportContext
    const savedTotalPages = r.TOTAL_PAGES
    r.TOTAL_PAGES = this.totalPagesOverride ?? this.pages.length
    r.PAGE_NUMBER = this.pageNumber + this.pageNumberOffset
    r.COLUMN_NUMBER = this.currentColumn + 1
    r.REPORT_COUNT = this.reportRecordCount

    const params = this.dataSource.parameters ?? {}

    const remaining: DeferredEval[] = []
    for (const deferred of this.deferredEvals) {
      if (deferred.evaluationTime === 'auto') {
        this.captureAutoEvaluationValues(deferred, 'report')
        if (this.isAutoEvaluationReady(deferred)) {
          this.resolveAutoDeferred(deferred)
        } else {
          remaining.push(deferred)
        }
      } else if (deferred.evaluationTime === 'report') {
        const rawValue = evaluateExpression(deferred.expression, this.currentRow, this.variables, params, r)
        this.resolveDeferredNode(deferred, rawValue)
      } else if (deferred.evaluationTime === 'masterReport' && deferred.snapshot) {
        // Subreport page-context field: evaluate with the master page pinned at
        // placement time (snapshot.report) but the now-final TOTAL_PAGES.
        const rep = deferred.snapshot.report
        rep.TOTAL_PAGES = r.TOTAL_PAGES
        const rawValue = evaluateExpression(deferred.expression, deferred.snapshot.field, deferred.snapshot.vars, deferred.snapshot.params, rep)
        this.resolveDeferredNode(deferred, rawValue)
      } else {
        remaining.push(deferred)
      }
    }
    this.deferredEvals = remaining
    r.TOTAL_PAGES = savedTotalPages
  }

  private resolveSingleDeferred(deferred: DeferredEval): void {
    const rawValue = this.evalExpr(deferred.expression)
    this.resolveDeferredNode(deferred, rawValue)
  }

  private resolveAutoDeferred(deferred: DeferredEval): void {
    const auto = deferred.auto!
    const rawValue = evaluateExpression(deferred.expression, auto.snapshot.field, auto.snapshot.vars, auto.snapshot.params, auto.snapshot.report)
    this.resolveDeferredNode(deferred, rawValue)
  }

  private resolveDeferredNode(deferred: DeferredEval, rawValue: unknown): void {
    const text = this.resolveTextFieldText(deferred.elem, rawValue)
    const resolvedNode = this.shouldSuppressRepeatedText(deferred.elem, text)
      ? this.renderEmptyPlaceholder(deferred.elem)
      : this.renderResolvedTextFieldNode(deferred.elem, deferred.style, text)
    replaceRenderNodeInPlace(deferred.node, resolvedNode)
  }

  private matchesDeferredGroup(deferred: DeferredEval, groupName?: string): boolean {
    if (deferred.evaluationTime !== 'group') return true
    if (!deferred.elem.evaluationGroup) return true
    return deferred.elem.evaluationGroup === groupName
  }

  private createEvaluationSnapshot(): EvaluationSnapshot {
    return {
      field: { ...this.currentRow },
      vars: { ...this.variables },
      params: { ...(this.dataSource.parameters ?? {}) },
      report: this.cloneReportContext(this.syncReportContext()),
    }
  }

  private cloneReportContext(source: ReportContext): ReportContext {
    const result: ReportContext = {
      PAGE_NUMBER: source.PAGE_NUMBER,
      COLUMN_NUMBER: source.COLUMN_NUMBER,
      REPORT_COUNT: source.REPORT_COUNT,
      TOTAL_PAGES: source.TOTAL_PAGES,
      RETURN_VALUE: source.RETURN_VALUE,
      format: source.format,
      formatters: source.formatters,
    }
    return result
  }

  // Pins a subreport masterNow deferral to the master page it was placed on
  // (PAGE_NUMBER / COLUMN_NUMBER) and re-tags it as masterReport, so its final
  // evaluation — including TOTAL_PAGES — happens at the master report end.
  private captureMasterPlacement(deferred: DeferredEval): void {
    const snapshot = deferred.snapshot
    if (snapshot) {
      const current = this.syncReportContext()
      snapshot.report.PAGE_NUMBER = current.PAGE_NUMBER
      snapshot.report.COLUMN_NUMBER = current.COLUMN_NUMBER
    }
    deferred.evaluationTime = 'masterReport'
  }

  private createAutoEvaluationState(expression: string): AutoEvaluationState {
    const snapshot = this.createEvaluationSnapshot()
    const ast = parseExpressionSource(expression).ast
    const variableNames = new Set<string>()
    const builtinNames = new Set<'PAGE_NUMBER' | 'COLUMN_NUMBER' | 'REPORT_COUNT' | 'TOTAL_PAGES'>()
    collectAutoExpressionReferences(ast, variableNames, builtinNames)

    const variables: AutoVariableTarget[] = []
    for (const name of variableNames) {
      const target = this.getAutoVariableTarget(name)
      if (target.time === 'auto') continue
      variables.push(target)
    }

    const builtins: AutoBuiltinTarget[] = []
    for (const name of builtinNames) {
      const target = this.getAutoBuiltinTarget(name)
      if (target.time === 'auto') continue
      builtins.push(target)
    }

    return { snapshot, variables, builtins }
  }

  private expressionReferencesPageContext(expression: Expression): boolean {
    if (typeof expression !== 'string') return false
    const builtinNames = new Set<'PAGE_NUMBER' | 'COLUMN_NUMBER' | 'REPORT_COUNT' | 'TOTAL_PAGES'>()
    collectAutoExpressionReferences(parseExpressionSource(expression).ast, new Set<string>(), builtinNames)
    return builtinNames.has('PAGE_NUMBER') || builtinNames.has('COLUMN_NUMBER') || builtinNames.has('TOTAL_PAGES')
  }

  private getAutoVariableTarget(name: string): AutoVariableTarget {
    const varDef = this.findVariableDef(name)
    const resetType = varDef?.resetType ?? 'report'
    switch (resetType) {
      case 'page':
        return { name, time: 'page' }
      case 'column':
        return { name, time: 'column' }
      case 'group':
        return { name, time: 'group', groupName: varDef?.resetGroup }
      case 'none':
        return { name, time: 'auto' }
      case 'report':
      default:
        return { name, time: 'report' }
    }
  }

  private getAutoBuiltinTarget(name: 'PAGE_NUMBER' | 'COLUMN_NUMBER' | 'REPORT_COUNT' | 'TOTAL_PAGES'): AutoBuiltinTarget {
    switch (name) {
      case 'PAGE_NUMBER':
        return { name, time: 'page' }
      case 'COLUMN_NUMBER':
        return { name, time: 'column' }
      case 'TOTAL_PAGES':
        return { name, time: 'report' }
      case 'REPORT_COUNT':
        return { name, time: 'auto' }
    }
  }

  private findVariableDef(name: string): VariableDef | undefined {
    const variables = this.template.variables ?? []
    for (let i = 0; i < variables.length; i++) {
      if (variables[i]!.name === name) return variables[i]
    }
    return undefined
  }

  private captureAutoEvaluationValues(deferred: DeferredEval, time: DeferredEvaluationTime, groupName?: string): void {
    const auto = deferred.auto!
    for (let i = auto.variables.length - 1; i >= 0; i--) {
      const target = auto.variables[i]!
      if (target.time !== time) continue
      if (target.time === 'group' && target.groupName !== undefined && target.groupName !== groupName) continue
      auto.snapshot.vars[target.name] = this.variables[target.name]
      auto.variables.splice(i, 1)
    }
    for (let i = auto.builtins.length - 1; i >= 0; i--) {
      const target = auto.builtins[i]!
      if (target.time !== time) continue
      const report = this.syncReportContext()
      auto.snapshot.report[target.name] = report[target.name]
      auto.builtins.splice(i, 1)
    }
  }

  private isAutoEvaluationReady(deferred: DeferredEval): boolean {
    const auto = deferred.auto!
    return auto.variables.length === 0 && auto.builtins.length === 0
  }

  private cloneAutoEvaluationState(source: AutoEvaluationState): AutoEvaluationState {
    return {
      snapshot: {
        field: { ...source.snapshot.field },
        vars: { ...source.snapshot.vars },
        params: { ...source.snapshot.params },
        report: this.cloneReportContext(source.snapshot.report),
      },
      variables: source.variables.map(function (target) {
        return { ...target }
      }),
      builtins: source.builtins.map(function (target) {
        return { ...target }
      }),
    }
  }

  

  // Runtime image merge.

  /** Apply images resolved by ResourceResolver to doc.images. */
  private mergeDocImages(doc: RenderDocument): void {
    const merged = this.resourceResolver.buildMergedImages()
    if (merged) doc.images = merged
  }

  // Expression evaluation.
  

  /** Synchronize and return the reusable ReportContext to reduce GC pressure. */
  private syncReportContext(): ReportContext {
    const r = this.reportContext
    r.PAGE_NUMBER = this.pageNumber + this.pageNumberOffset
    r.COLUMN_NUMBER = this.currentColumn + 1
    r.REPORT_COUNT = this.reportRecordCount
    r.TOTAL_PAGES = this.totalPagesOverride ?? this.pages.length
    return r
  }

  private evalExpr(expression: Expression): unknown {
    return evaluateExpression(
      expression,
      this.currentRow,
      this.variables,
      this.dataSource.parameters ?? {},
      this.syncReportContext(),
    )
  }

  /** Resolve pattern by preferring custom formatters and falling back to the built-in formatter. */
  private formatWithPattern(value: unknown, pattern: string): string {
    const formatter = this.reportContext.formatters[pattern]
    if (formatter) return formatter(value)
    return formatValue(value, pattern)
  }

  // Style resolution.
  

  private resolveStyles(): void {
    for (const styleDef of this.template.styles ?? []) {
      this.resolvedStyles.set(styleDef.name, this.resolveStyle(styleDef))
    }
    // The style marked isDefault applies to elements without an explicit style reference.
    for (const styleDef of this.template.styles ?? []) {
      if (styleDef.isDefault) {
        this.defaultStyleDef = styleDef
        this.defaultResolvedStyle = this.resolvedStyles.get(styleDef.name)!
        break
      }
    }
  }

  private resolveStyle(styleDef: StyleDef, visited?: Set<string>): ResolvedStyle {
    let base: ResolvedStyle = DEFAULT_STYLE

    // Inherit from the parent style while preventing cycles.
    if (styleDef.parentStyle) {
      const seen = visited ?? new Set<string>()
      if (!seen.has(styleDef.name)) {
        seen.add(styleDef.name)
        const parentDef = (this.template.styles ?? []).find(s => s.name === styleDef.parentStyle)
        if (parentDef) {
          base = this.resolveStyle(parentDef, seen)
        }
      }
    }

    // Override with own properties.
    return {
      fontFamily: styleDef.fontFamily ?? base.fontFamily,
      fontSize: styleDef.fontSize ?? base.fontSize,
      bold: styleDef.bold ?? base.bold,
      italic: styleDef.italic ?? base.italic,
      underline: styleDef.underline ?? base.underline,
      strikethrough: styleDef.strikethrough ?? base.strikethrough,
      forecolor: styleDef.forecolor ?? base.forecolor,
      backcolor: styleDef.backcolor ?? base.backcolor,
      hAlign: styleDef.hAlign ?? base.hAlign,
      vAlign: styleDef.vAlign ?? base.vAlign,
      rotation: styleDef.rotation ?? base.rotation,
      border: styleDef.border ?? base.border,
      padding: styleDef.padding ?? base.padding,
      mode: styleDef.mode ?? base.mode,
      opacity: styleDef.opacity ?? base.opacity,
      variation: styleDef.variation ?? base.variation,
      writingMode: styleDef.writingMode ?? base.writingMode,
      direction: styleDef.direction ?? base.direction,
      openTypeScript: styleDef.openTypeScript ?? base.openTypeScript,
      openTypeLanguage: styleDef.openTypeLanguage ?? base.openTypeLanguage,
      openTypeFeatures: styleDef.openTypeFeatures ?? base.openTypeFeatures,
    }
  }

  private getStyle(elem: ElementDef): ResolvedStyle {
    const base = elem.style
      ? (this.resolvedStyles.get(elem.style) ?? DEFAULT_STYLE)
      : this.defaultResolvedStyle

    // Evaluate conditional styles.
    const styleDef = elem.style
      ? (this.template.styles ?? []).find(s => s.name === elem.style)
      : this.defaultStyleDef

    // Avoid copying when there are no conditional styles or element-level overrides.
    const hasOverrides = styleDef?.conditionalStyles || elem.forecolor || elem.backcolor || elem.border || elem.mode || elem.padding
    let result: ResolvedStyle = hasOverrides ? copyStyle(base) : base

    if (styleDef?.conditionalStyles) {
      for (const cs of styleDef.conditionalStyles) {
        const condition = this.evalExpr(cs.condition)
        if (condition) {
          if (cs.fontFamily) result.fontFamily = cs.fontFamily
          if (cs.fontSize) result.fontSize = cs.fontSize
          if (cs.bold !== undefined) result.bold = cs.bold
          if (cs.italic !== undefined) result.italic = cs.italic
          if (cs.forecolor) result.forecolor = cs.forecolor
          if (cs.backcolor) result.backcolor = cs.backcolor
          if (cs.hAlign) result.hAlign = cs.hAlign
          if (cs.openTypeScript) result.openTypeScript = cs.openTypeScript
          if (cs.openTypeLanguage) result.openTypeLanguage = cs.openTypeLanguage
          if (cs.openTypeFeatures) result.openTypeFeatures = cs.openTypeFeatures
        }
      }
    }

    // Override with element-level properties.
    if (elem.forecolor) result.forecolor = elem.forecolor
    if (elem.backcolor) result.backcolor = elem.backcolor
    if (elem.border) {
      if (result === base) result = copyStyle(base)
      result.border = elem.border
    }
    if (elem.mode) {
      if (result === base) result = copyStyle(base)
      result.mode = elem.mode
    }
    if (elem.padding) {
      if (result === base) result = copyStyle(base)
      result.padding = elem.padding
    }

    return result
  }
}

function renderPathPoint(node: RenderPath, index: number): [number, number] {
  const x = node.coords[index]!
  const y = node.coords[index + 1]!
  const matrix = node.affineTransform
  if (matrix === undefined) return [x, y]
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}

function sourceVectorVerticalBounds(node: RenderPath): { top: number, bottom: number } {
  const source = node.pdfSourceVector!
  let top = Infinity
  let bottom = -Infinity
  for (let i = 0; i < source.instances.length; i++) {
    const instance = source.instances[i]!
    const definition = source.definitions[instance.definitionIndex]
    if (definition === undefined) throw new Error(`PDF source vector definition ${instance.definitionIndex} is missing`)
    const matrix = instance.matrix
    for (let c = 0; c < definition.coords.length; c += 2) {
      const x = definition.coords[c]!
      const y = definition.coords[c + 1]!
      let tx = matrix[0] * x + matrix[2] * y + matrix[4]
      let ty = matrix[1] * x + matrix[3] * y + matrix[5]
      const outer = node.affineTransform
      if (outer !== undefined) {
        const ox = outer[0] * tx + outer[2] * ty + outer[4]
        const oy = outer[1] * tx + outer[3] * ty + outer[5]
        tx = ox
        ty = oy
      }
      if (ty < top) top = ty
      if (ty > bottom) bottom = ty
    }
  }
  return top === Infinity ? { top: 0, bottom: 0 } : { top, bottom }
}

// Resolved style.


interface ResolvedStyle {
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  forecolor: string
  backcolor: string
  hAlign: 'left' | 'center' | 'right' | 'justify'
  vAlign: 'top' | 'middle' | 'bottom'
  rotation?: 0 | 90 | 180 | 270
  border?: import('../types/template.js').BorderDef
  padding?: import('../types/template.js').Padding
  mode?: 'opaque' | 'transparent'
  opacity?: number
  variation?: Record<string, number>
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'
  direction?: 'ltr' | 'rtl' | 'auto'
  openTypeScript?: string
  openTypeLanguage?: string
  openTypeFeatures?: Record<string, number>
}

function buildOpenTypeFeatureSettings(
  values: Readonly<Record<string, number>> | undefined,
): { tag: string, value: number }[] | undefined {
  if (values === undefined) return undefined
  const tags = Object.keys(values)
  const settings = new Array<{ tag: string, value: number }>(tags.length)
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!
    settings[i] = { tag, value: values[tag]! }
  }
  return settings
}

const DEFAULT_STYLE: ResolvedStyle = {
  fontFamily: 'default',
  fontSize: 10,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  forecolor: '#000000',
  backcolor: 'transparent',
  hAlign: 'left',
  vAlign: 'top',
}

/** Extract nodes from entries without using .map(). */
function extractNodes(entries: { node: import('../types/render.js').RenderNode | null }[]): import('../types/render.js').RenderNode[] {
  const nodes: import('../types/render.js').RenderNode[] = []
  for (let i = 0; i < entries.length; i++) {
    const node = entries[i]!.node
    if (node) nodes.push(node)
  }
  return nodes
}

function replaceRenderNodeInPlace(target: RenderNode, source: RenderNode): void {
  const targetRecord = target as unknown as Record<string, unknown>
  const sourceRecord = source as unknown as Record<string, unknown>
  for (const key of Object.keys(targetRecord)) {
    delete targetRecord[key]
  }
  for (const [key, value] of Object.entries(sourceRecord)) {
    targetRecord[key] = value
  }
}

/** Shallow-copy ResolvedStyle without spread syntax. */
function copyStyle(s: ResolvedStyle): ResolvedStyle {
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    bold: s.bold,
    italic: s.italic,
    underline: s.underline,
    strikethrough: s.strikethrough,
    forecolor: s.forecolor,
    backcolor: s.backcolor,
    hAlign: s.hAlign,
    vAlign: s.vAlign,
    rotation: s.rotation,
    border: s.border,
    padding: s.padding,
    mode: s.mode,
    opacity: s.opacity,
    variation: s.variation,
    writingMode: s.writingMode,
    direction: s.direction,
    openTypeScript: s.openTypeScript,
    openTypeLanguage: s.openTypeLanguage,
    openTypeFeatures: s.openTypeFeatures,
  }
}

// Variable accumulator.


class VariableAccumulator {
  private calculation: string
  private _count = 0
  private _sum = 0
  private _min = Infinity
  private _max = -Infinity
  private _first: unknown = undefined
  private _distinct = new Set<unknown>()
  private _initial: unknown = undefined

  constructor(calculation: string) {
    this.calculation = calculation
  }

  /** Seeds the accumulator with the variable's initial value (applied again on reset). */
  setInitial(val: unknown): void {
    this._initial = val
    this.seedInitial()
  }

  private seedInitial(): void {
    const val = this._initial
    if (val === undefined || val === null) return
    const num = typeof val === 'number' ? val : Number(val)
    if (isNaN(num)) return
    switch (this.calculation) {
      case 'sum': this._sum = num; break
      case 'count': this._count = num; break
      case 'min': this._min = num; break
      case 'max': this._max = num; break
    }
  }

  get value(): unknown {
    switch (this.calculation) {
      case 'nothing': return this._first !== undefined ? this._first : this._initial
      case 'count': return this._count
      case 'distinctCount': return this._distinct.size
      case 'sum': return this._sum
      case 'average': return this._count > 0 ? this._sum / this._count : 0
      case 'min': return this._min === Infinity ? 0 : this._min
      case 'max': return this._max === -Infinity ? 0 : this._max
      case 'first': return this._first !== undefined ? this._first : this._initial
      default: return 0
    }
  }

  add(val: unknown): void {
    this._count++
    this._distinct.add(val)

    if (this.calculation === 'nothing' || this.calculation === 'first') {
      if (this._first === undefined) this._first = val
      else if (this.calculation === 'nothing') this._first = val
      return
    }

    const num = typeof val === 'number' ? val : Number(val)
    if (!isNaN(num)) {
      this._sum += num
      if (num < this._min) this._min = num
      if (num > this._max) this._max = num
    }
  }

  reset(): void {
    this._count = 0
    this._sum = 0
    this._min = Infinity
    this._max = -Infinity
    this._first = undefined
    this._distinct.clear()
    this.seedInitial()
  }
}
// ─── Hyperlink and bookmark helpers ───
// These helpers convert template hyperlink/bookmark definitions into render nodes.
// Hyperlink definitions are resolved to RenderLink values before attachment.
/** Resolve a hyperlink definition to RenderLink. */
function resolveHyperlinkDef(
  hyperlink: import('../types/template.js').HyperlinkDef,
  evalExpr: (expr: Expression) => unknown,
): RenderLink | null {
  const target = String(evalExpr(hyperlink.target) ?? '')
  if (!target) return null

  switch (hyperlink.type) {
    case 'reference':
      return { type: 'uri', target }
    case 'localAnchor':
      return { type: 'localAnchor', target }
    case 'localPage':
      return { type: 'localPage', target }
    case 'remoteAnchor': {
      const doc = hyperlink.remoteDocument ? String(evalExpr(hyperlink.remoteDocument)) : undefined
      return { type: 'remoteAnchor', target, remoteDocument: doc }
    }
    case 'remotePage': {
      const doc = hyperlink.remoteDocument ? String(evalExpr(hyperlink.remoteDocument)) : undefined
      return { type: 'remotePage', target, remoteDocument: doc }
    }
    default:
      return null
  }
}

/** Extract text from RenderNode for bookmark labels. */
function extractText(node: RenderNode): string {
  if (node.type === 'text') return node.text
  if (node.type === 'group') {
    for (const child of node.children) {
      const t = extractText(child)
      if (t) return t
    }
  }
  return ''
}

/** Attach a link to RenderNode. */
function attachLinkToNode(
  node: RenderNode,
  link: RenderLink,
  elem: ElementDef,
): void {
  if (node.type === 'text') {
    (node as RenderText).link = link
  } else if (node.type === 'image') {
    (node as import('../types/render.js').RenderImage).link = link
  } else if (node.type === 'group') {
    (node as RenderGroup).link = link
  } else {
    // Do not wrap other node types here; wrap them in a group node.
    // Some cases are already wrapped for border/background handling.
    // Do nothing here.
  }
}
// Utilities.
/**
 * Convert template rotation angle, CCW, into RenderGroup rotation parameters.
 * Backends use positive CW rotation; template 90 deg CCW maps to backend -90 deg CW.
 */
function getRotationTransform(
  templateRotation: number,
  elemWidth: number,
  elemHeight: number,
): { rotation: number; rotationOriginX: number; rotationOriginY: number } {
  switch (templateRotation) {
    case 90:
      return { rotation: -90, rotationOriginX: elemHeight / 2, rotationOriginY: elemHeight / 2 }
    case 180:
      return { rotation: 180, rotationOriginX: elemWidth / 2, rotationOriginY: elemHeight / 2 }
    case 270:
      return { rotation: 90, rotationOriginX: elemWidth / 2, rotationOriginY: elemWidth / 2 }
    default:
      return { rotation: 0, rotationOriginX: 0, rotationOriginY: 0 }
  }
}

/** Convert template hAlign to render hAlign; justify becomes left. */
function resolveHAlign(
  align?: 'left' | 'center' | 'right' | 'justify',
): 'left' | 'center' | 'right' {
  if (align === 'justify') return 'left'
  return align ?? 'left'
}

/** Resolve text direction, auto-detecting Arabic or Hebrew text when unspecified. */
function resolveTextDirection(
  explicit: 'ltr' | 'rtl' | 'auto' | undefined,
  text: string,
): 'ltr' | 'rtl' | 'auto' | undefined {
  if (explicit) return explicit
  const detected = getBaseDirection(text)
  if (detected === 'rtl') return 'rtl'
  return undefined
}

/** Measure one line's effective right-edge width with the same model as renderer implementations. */
function measureRenderedTextWidth(
  text: string,
  font: Font,
  fontSize: number,
  italic: boolean,
  bold: boolean,
): number {
  if (text === '') return 0

  const metrics = font.metrics
  const scale = fontSize / metrics.unitsPerEm
  const syntheticItalic = italic && !metrics.isItalic
  const syntheticBold = bold && !metrics.isBold
  const slant = syntheticItalic ? Math.tan(12 * Math.PI / 180) : 0
  const boldHalf = syntheticBold ? (fontSize * 0.025) / 2 : 0

  let width = 0
  let penUnits = 0
  let maxRight = 0
  let i = 0
  while (i < text.length) {
    let cp = text.charCodeAt(i)
    let charLen = 1
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        cp = ((cp - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
        charLen = 2
      }
    }

    const gid = font.getGlyphId(cp)
    const advUnits = font.getAdvanceWidth(gid)
    width += advUnits * scale

    const glyph = font.getGlyph(gid)
    let glyphRightUnits = glyph.xMax
    if (slant !== 0) glyphRightUnits += glyph.yMax * slant
    const right = (penUnits + glyphRightUnits) * scale + boldHalf
    if (right > maxRight) maxRight = right

    penUnits += advUnits
    i += charLen
  }

  if (maxRight > width) width = maxRight
  return width
}

/** Measure the rendered right edge of a shaped glyph run (same model as the renderers). */
function measureRenderedRunWidth(
  run: RenderGlyphRun,
  font: Font,
  fontSize: number,
  italic: boolean,
  bold: boolean,
): number {
  const metrics = font.metrics
  const scale = fontSize / metrics.unitsPerEm
  const syntheticItalic = italic && !metrics.isItalic
  const syntheticBold = bold && !metrics.isBold
  const slant = syntheticItalic ? Math.tan(12 * Math.PI / 180) : 0
  const boldHalf = syntheticBold ? (fontSize * 0.025) / 2 : 0

  let pen = 0
  let maxRight = 0
  const glyphIds = run.glyphIds
  for (let i = 0; i < glyphIds.length; i++) {
    const glyph = font.getGlyph(glyphIds[i]!)
    let glyphRightUnits = glyph.xMax
    if (slant !== 0) glyphRightUnits += glyph.yMax * slant
    const right = pen + run.xOffsets[i]! + glyphRightUnits * scale + boldHalf
    if (right > maxRight) maxRight = right
    pen += run.advances[i]!
  }

  return pen > maxRight ? pen : maxRight
}

/** Return the actual rendered width of one line in points. */
function measureRenderedLineWidth(
  line: LayoutLine,
  font: Font,
  fontSize: number,
  italic: boolean,
  bold: boolean,
): number {
  let lineWidth = 0
  if (line.segments) {
    for (let si = 0; si < line.segments.length; si++) {
      const seg = line.segments[si]!
      if (seg.text === '') continue
      const segWidth = seg.run
        ? measureRenderedRunWidth(seg.run, font, fontSize, italic, bold)
        : measureRenderedTextWidth(seg.text, font, fontSize, italic, bold)
      const segRight = seg.x + segWidth
      if (segRight > lineWidth) lineWidth = segRight
    }
    return lineWidth
  }
  if (line.text === '') return 0
  if (line.run) return measureRenderedRunWidth(line.run, font, fontSize, italic, bold)
  return measureRenderedTextWidth(line.text, font, fontSize, italic, bold)
}

/** Return the longest actual rendered line width in points among LayoutLine entries. */
function measureRenderedMaxLineWidth(
  lines: LayoutLine[],
  font: Font,
  fontSize: number,
  italic: boolean,
  bold: boolean,
): number {
  let maxWidth = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineWidth = measureRenderedLineWidth(line, font, fontSize, italic, bold)
    if (lineWidth > maxWidth) maxWidth = lineWidth
  }
  return maxWidth
}
// ─── Standalone text content rendering ───
// Used independently by the engine and the editor preview.
// TextContentStyle is the shared input contract for renderTextToGroup.
/** Style information passed to renderTextToGroup. */
export interface TextContentStyle {
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  forecolor: string
  hAlign: 'left' | 'center' | 'right' | 'justify'
  vAlign: 'top' | 'middle' | 'bottom'
  padding?: { top?: number; bottom?: number; left?: number; right?: number }
  variation?: Record<string, number>
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'
  direction?: 'ltr' | 'rtl' | 'auto'
  openTypeScript?: string
  openTypeLanguage?: string
  openTypeFeatures?: Record<string, number>
  outlineText?: boolean
  pdfFontMode?: 'embedded' | 'reference'
}

export interface TextContentElement {
  x: number
  y: number
  width: number
  height: number
  actualText?: string
  hAlign?: string
  vAlign?: string
  lineSpacing?: any
  letterSpacing?: number
  tracking?: number
  wordSpacing?: number
  horizontalScale?: number
  baselineOffset?: number
  firstLineIndent?: number
  leftIndent?: number
  rightIndent?: number
  padding?: { top?: number; bottom?: number; left?: number; right?: number }
  textTruncate?: string
  shrinkToFit?: boolean
  minFontSize?: number
  fitWidth?: boolean
  tabStops?: { position: number; alignment?: 'left' | 'center' | 'right' }[]
  tabStopWidth?: number
  direction?: 'ltr' | 'rtl' | 'auto'
  openTypeScript?: string
  openTypeLanguage?: string
  openTypeFeatures?: Record<string, number>
  wrap?: boolean
  outlineText?: boolean
  pdfFontMode?: 'embedded' | 'reference'
  textPaintMode?: 'fill' | 'stroke' | 'fillStroke'
  textStrokeColor?: string
  textStrokeWidth?: number
  blendMode?: BlendMode
  overprintFill?: boolean
  overprintStroke?: boolean
  overprintMode?: OverprintMode
}

/**
  * Standalone function that converts text content into RenderNode values.
  * Used by both the engine internals and the editor canvas preview.
  * When a measurer exists, apply text wrapping, shrinkToFit, and fitWidth, then return a RenderGroup.
  * When no measurer exists, return a single RenderText.
 */

export function renderTextToGroup(
  text: string,
  elem: TextContentElement,
  style: TextContentStyle,
  measurer: TextMeasurer | null,
  stretchWithOverflow: boolean,
): RenderNode {
  if (measurer === null || style.variation === undefined) {
    return renderTextToGroupAtVariation(text, elem, style, measurer, stretchWithOverflow)
  }
  const current = measurer.font.variationCoordinates
  const previous = current === null ? {} : { ...current }
  measurer.font.setVariation(style.variation)
  try {
    return renderTextToGroupAtVariation(text, elem, style, measurer, stretchWithOverflow)
  } finally {
    measurer.font.setVariation(previous)
  }
}

function renderTextToGroupAtVariation(
  text: string,
  elem: TextContentElement,
  style: TextContentStyle,
  measurer: TextMeasurer | null,
  stretchWithOverflow: boolean,
): RenderNode {
  const hAlign = (elem.hAlign ?? style.hAlign) as 'left' | 'center' | 'right' | 'justify'

  // No measurer; use the legacy single text node.
  if (!measurer) {
    return {
      type: 'text',
      x: elem.x,
      y: elem.y,
      text,
      actualText: elem.actualText,
      fontId: style.fontFamily,
      fontSize: style.fontSize,
      color: style.forecolor,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strikethrough: style.strikethrough || undefined,
      hAlign: resolveHAlign(hAlign),
      width: elem.width,
      variation: style.variation,
      writingMode: style.writingMode,
      outlineText: elem.outlineText || style.outlineText || undefined,
      pdfFontMode: elem.pdfFontMode,
      textPaintMode: elem.textPaintMode,
      textStrokeColor: elem.textStrokeColor,
      textStrokeWidth: elem.textStrokeWidth,
      horizontalScale: elem.horizontalScale,
      baselineOffset: elem.baselineOffset,
      blendMode: elem.blendMode,
      overprintFill: elem.overprintFill,
      overprintStroke: elem.overprintStroke,
      overprintMode: elem.overprintMode,
    }
  }

  // Padding precedence: element level, then style level, then none.
  const padding = elem.padding ?? style.padding ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const padTop = padding.top ?? 0
  const padBottom = padding.bottom ?? 0
  const padLeft = padding.left ?? 0
  const padRight = padding.right ?? 0

  // Text layout options.
  const layoutOptions: TextLayoutOptions = {
    maxWidth: elem.wrap === false ? Infinity : (elem.width - padLeft - padRight),
    maxHeight: elem.baselineOffset === undefined ? elem.height - padTop - padBottom : Infinity,
    elementHeight: elem.height - padTop - padBottom,
    hAlign,
    vAlign: (elem.vAlign ?? style.vAlign) as 'top' | 'middle' | 'bottom',
    lineSpacing: elem.lineSpacing,
    letterSpacing: elem.letterSpacing,
    tracking: elem.tracking,
    wordSpacing: elem.wordSpacing,
    horizontalScale: elem.horizontalScale,
    firstLineIndent: elem.firstLineIndent,
    leftIndent: elem.leftIndent,
    rightIndent: elem.rightIndent,
    textTruncate: (elem.textTruncate as any) ?? 'none',
    stretchWithOverflow,
    direction: resolveTextDirection(elem.direction ?? style.direction, text),
    writingMode: style.writingMode,
    tabStops: elem.tabStops,
    tabStopWidth: elem.tabStopWidth,
    openTypeScript: elem.openTypeScript ?? style.openTypeScript,
    openTypeLanguage: elem.openTypeLanguage ?? style.openTypeLanguage,
    openTypeFeatures: elem.openTypeFeatures ?? style.openTypeFeatures,
  }

  const contentWidth = elem.width - padLeft - padRight

  // fitWidth adjusts font size so the longest line fits within the element content width.
  let fontSize = style.fontSize
  if (elem.fitWidth && contentWidth > 0) {
    const font = measurer.font
    let fittedSize = fontSize
    for (let iter = 0; iter < 20; iter++) {
      const fitResult = layoutText(text, measurer, fittedSize, layoutOptions)
      const maxLineWidth = measureRenderedMaxLineWidth(fitResult.lines, font, fittedSize, style.italic, style.bold)
      if (maxLineWidth <= 0) break

      const nextSize = fittedSize * (contentWidth / maxLineWidth)
      if (nextSize < 0.1) {
        fittedSize = 0.1
        break
      }
      if (Math.abs(nextSize - fittedSize) <= 0.05) {
        fittedSize = nextSize
        break
      }
      fittedSize = nextSize
    }
    fontSize = fittedSize
  }

  // Shrink to Fit reduces font size to resolve height overflow or nowrap width overflow.
  if (elem.shrinkToFit) {
    const font = measurer.font
    const minSize = elem.minFontSize ?? 4
    let lo = minSize
    let hi = fontSize
    const firstResult = layoutText(text, measurer, fontSize, layoutOptions)
    let firstHorizontalOverflow = false
    if (elem.wrap === false) {
      const firstWidth = measureRenderedMaxLineWidth(firstResult.lines, font, fontSize, style.italic, style.bold)
      firstHorizontalOverflow = contentWidth <= 0 ? firstResult.lines.length > 0 : firstWidth > contentWidth
    }
    if (firstResult.truncated || firstHorizontalOverflow) {
      for (let iter = 0; iter < 20 && hi - lo > 0.25; iter++) {
        const mid = (lo + hi) / 2
        const midResult = layoutText(text, measurer, mid, layoutOptions)
        let midHorizontalOverflow = false
        if (elem.wrap === false) {
          const midWidth = measureRenderedMaxLineWidth(midResult.lines, font, mid, style.italic, style.bold)
          midHorizontalOverflow = contentWidth <= 0 ? midResult.lines.length > 0 : midWidth > contentWidth
        }
        if (midResult.truncated || midHorizontalOverflow) {
          hi = mid
        } else {
          lo = mid
        }
      }
      fontSize = lo
    }
  }

  const result = layoutText(text, measurer, fontSize, layoutOptions)

  const textWidth = elem.width - padLeft - padRight
  const fitLineWidths: number[] = []
  if (elem.fitWidth) {
    const font = measurer.font
    for (let i = 0; i < result.lines.length; i++) {
      fitLineWidths.push(measureRenderedLineWidth(result.lines[i]!, font, fontSize, style.italic, style.bold))
    }
  }

  // RenderGroup with multiple RenderText nodes.
  const children: RenderNode[] = []
  const resolvedHAlignVal = resolveHAlign(hAlign)
  for (let i = 0; i < result.lines.length; i++) {
    const line = result.lines[i]!
    if (line.text === '' && !line.segments) continue
    let fitAlignOffset = 0
    if (elem.fitWidth) {
      const lineWidth = fitLineWidths[i] ?? 0
      if (hAlign === 'right') {
        fitAlignOffset = textWidth - lineWidth
      } else if (hAlign === 'center') {
        fitAlignOffset = (textWidth - lineWidth) / 2
      }
    }

    // Generate one RenderText per segment when tab segments exist.
    if (line.segments) {
      const lineBaseX = padLeft + fitAlignOffset + (line.x ?? (elem.leftIndent ?? 0))
      const lineBaseY = padTop + line.y
      for (let si = 0; si < line.segments.length; si++) {
        const seg = line.segments[si]!
        if (seg.text === '') continue
        children.push({
          type: 'text',
          x: lineBaseX + seg.x,
          y: lineBaseY,
          text: seg.text,
          fontId: style.fontFamily,
          fontSize,
          color: style.forecolor,
          bold: style.bold,
          italic: style.italic,
          underline: style.underline,
          strikethrough: style.strikethrough || undefined,
          hAlign: 'left',
          width: textWidth - seg.x,
          variation: style.variation,
          writingMode: style.writingMode,
          direction: line.direction,
          outlineText: elem.outlineText || style.outlineText || undefined,
          pdfFontMode: elem.pdfFontMode,
          textPaintMode: elem.textPaintMode,
          textStrokeColor: elem.textStrokeColor,
          textStrokeWidth: elem.textStrokeWidth,
          horizontalScale: elem.horizontalScale,
          baselineOffset: elem.baselineOffset,
          glyphRun: seg.run,
          blendMode: elem.blendMode,
          overprintFill: elem.overprintFill,
          overprintStroke: elem.overprintStroke,
          overprintMode: elem.overprintMode,
        } as RenderText)
      }
      continue
    }

    const textNode: RenderText = {
      type: 'text',
      x: padLeft + fitAlignOffset + (line.x ?? (elem.leftIndent ?? 0)),
      y: padTop + line.y,
      text: line.text,
      actualText: result.lines.length === 1 ? elem.actualText : undefined,
      fontId: style.fontFamily,
      fontSize,
      color: style.forecolor,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strikethrough: style.strikethrough || undefined,
      hAlign: elem.fitWidth ? 'left' : resolvedHAlignVal,
      width: textWidth,
      variation: style.variation,
      writingMode: style.writingMode,
      direction: line.direction,
      outlineText: elem.outlineText || style.outlineText || undefined,
      pdfFontMode: elem.pdfFontMode,
      textPaintMode: elem.textPaintMode,
      textStrokeColor: elem.textStrokeColor,
      textStrokeWidth: elem.textStrokeWidth,
      horizontalScale: elem.horizontalScale,
      baselineOffset: elem.baselineOffset,
      glyphRun: line.run,
      blendMode: elem.blendMode,
      overprintFill: elem.overprintFill,
      overprintStroke: elem.overprintStroke,
      overprintMode: elem.overprintMode,
    }
    if (line.justifySpacing) {
      // Kept for renderers without glyph run support; backends ignore this
      // when a glyph run is present (spacing is baked into the run advances)
      textNode.letterSpacing = line.justifySpacing
    }
    children.push(textNode)
  }

  // Calculate effective height.
  const effectiveHeight = stretchWithOverflow
    ? Math.max(elem.height, result.totalHeight + padTop + padBottom)
    : elem.height

  const group: RenderGroup = {
    type: 'group',
    x: elem.x,
    y: elem.y,
    width: elem.width,
    height: effectiveHeight,
    clip: elem.baselineOffset === undefined && !stretchWithOverflow,
    children,
    blendMode: elem.blendMode,
    overprintFill: elem.overprintFill,
    overprintStroke: elem.overprintStroke,
    overprintMode: elem.overprintMode,
  }

  return group
}

// Deferred evaluation.


function collectAutoExpressionReferences(
  ast: ExpressionAstNode,
  variableNames: Set<string>,
  builtinNames: Set<'PAGE_NUMBER' | 'COLUMN_NUMBER' | 'REPORT_COUNT' | 'TOTAL_PAGES'>,
): void {
  switch (ast.type) {
    case 'identifier':
      if (ast.name === 'PAGE_NUMBER' || ast.name === 'COLUMN_NUMBER' || ast.name === 'REPORT_COUNT' || ast.name === 'TOTAL_PAGES') {
        builtinNames.add(ast.name)
      }
      return
    case 'member':
      if (ast.object.type === 'identifier' && (ast.object.name === 'vars' || ast.object.name === 'var')) {
        variableNames.add(ast.property)
      }
      collectAutoExpressionReferences(ast.object, variableNames, builtinNames)
      return
    case 'call':
      collectAutoExpressionReferences(ast.callee, variableNames, builtinNames)
      for (let i = 0; i < ast.arguments.length; i++) {
        collectAutoExpressionReferences(ast.arguments[i]!, variableNames, builtinNames)
      }
      return
    case 'unary':
      collectAutoExpressionReferences(ast.argument, variableNames, builtinNames)
      return
    case 'binary':
      collectAutoExpressionReferences(ast.left, variableNames, builtinNames)
      collectAutoExpressionReferences(ast.right, variableNames, builtinNames)
      return
    case 'conditional':
      collectAutoExpressionReferences(ast.test, variableNames, builtinNames)
      collectAutoExpressionReferences(ast.consequent, variableNames, builtinNames)
      collectAutoExpressionReferences(ast.alternate, variableNames, builtinNames)
      return
    case 'template':
      for (let i = 0; i < ast.parts.length; i++) {
        const part = ast.parts[i]!
        if (part.type === 'expression') {
          collectAutoExpressionReferences(part.expression, variableNames, builtinNames)
        }
      }
      return
    case 'literal':
      return
  }
}

interface DeferredEval {
  node: RenderNode
  expression: Expression
  pattern?: string
  evaluationTime: DeferredEvaluationTime
  elem: ElementDef & { type: 'textField' }
  style: ResolvedStyle
  snapshot?: EvaluationSnapshot
  auto?: AutoEvaluationState
}
