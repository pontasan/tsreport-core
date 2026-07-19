import { Font } from '../font.js'
import { createReportBook, type FontMap, type ReportBookPart } from '../layout/engine.js'
import { TextMeasurer } from '../measure/text-measurer.js'
import { renderToPdf } from '../renderer/renderer.js'
import type {
  PdfAnnotation,
  PdfAnnotationSubtype,
  PdfBackendOptions,
  PdfEmbeddedFile,
  PdfPreservedAnnotation,
} from '../renderer/pdf-backend.js'
import type { ElementDef, FrameDef, ReportTemplate, StyleDef } from '../types/template.js'
import { PdfContentLexer } from './content-lexer.js'
import {
  PdfImporter,
  type ImportedAnnotation,
  type ImportedFontInfo,
  type ImportedPage,
  type PdfImportOptions,
} from './pdf-page-importer.js'
import { PdfName, type PdfValue } from './pdf-parser.js'

export interface PdfRedactionApplyOptions extends PdfImportOptions {
  /** Apply only Redact annotations whose /NM value occurs in this list. Omit to apply every Redact annotation. */
  annotationNames?: string[]
  /** Fonts used when an input font is not embedded. Keys are font family names or /DA resource names without '/'. */
  fonts?: Record<string, Font>
  /** Additional PDF output settings. Annotation, image, and font resources are owned by the redaction operation. */
  output?: Omit<PdfBackendOptions, 'annotations' | 'images' | 'fonts'>
}

interface Point { x: number, y: number }
interface RedactionRegion { points: [Point, Point, Point, Point] }

interface PageRedactionState {
  page: ImportedPage
  redactions: ImportedAnnotation[]
  annotations: ImportedAnnotation[]
}

interface RetainedAnnotation {
  annotation: ImportedAnnotation
  pageIndex: number
}

interface ParsedDefaultAppearance {
  fontName: string
  fontSize: number
  color: string
}

/**
 * Applies Redact annotations and returns a newly reconstructed PDF.
 * The original content streams and object graph are never copied into the result.
 */
export function applyPdfRedactions(bytes: Uint8Array, options: PdfRedactionApplyOptions = {}): Uint8Array {
  const importer = PdfImporter.open(bytes, options)
  const selectedNames = options.annotationNames === undefined ? null : new Set(options.annotationNames)
  if (selectedNames !== null && selectedNames.size !== options.annotationNames!.length) {
    throw new Error('PDF redaction annotationNames must not contain duplicates')
  }
  const matchedNames = new Set<string>()
  const states: PageRedactionState[] = []
  const allFontInfos: ImportedFontInfo[] = []

  for (let pageIndex = 0; pageIndex < importer.pageCount; pageIndex++) {
    const page = importer.importPage(pageIndex, {
      ...options,
      includeAnnotationAppearances: false,
      outlineText: true,
      imageIdPrefix: `redaction_page_${pageIndex}_image_`,
    })
    const annotations = importer.importAnnotations(pageIndex, options)
    const redactions: ImportedAnnotation[] = []
    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i]!
      if (annotation.subtype !== 'Redact') continue
      if (selectedNames !== null) {
        if (annotation.name === undefined || !selectedNames.has(annotation.name)) continue
        matchedNames.add(annotation.name)
      }
      redactions.push(annotation)
    }
    states.push({ page, redactions, annotations })
    allFontInfos.push(...page.fonts)
  }

  if (selectedNames !== null) {
    for (const name of selectedNames) {
      if (!matchedNames.has(name)) throw new Error(`PDF redaction annotation name not found: ${name}`)
    }
  }

  const parts: ReportBookPart[] = []
  const retainedAnnotations: RetainedAnnotation[] = []
  for (let pageIndex = 0; pageIndex < states.length; pageIndex++) {
    const state = states[pageIndex]!
    const regions: RedactionRegion[] = []
    for (let i = 0; i < state.redactions.length; i++) regions.push(...annotationRegions(state.redactions[i]!))
    const elements = filterElements(state.page.elements, regions, identityMatrix())
    const styles = [...state.page.styles]

    for (let i = 0; i < state.redactions.length; i++) {
      const annotation = state.redactions[i]!
      const appearance = importer.importRedactionAppearance(pageIndex, annotation.sourceIndex, {
        fontResolver: options.fontResolver,
        includeInvisibleText: options.includeInvisibleText,
        outlineText: true,
        imageIdPrefix: `redaction_page_${pageIndex}_overlay_${annotation.sourceIndex}_`,
      })
      if (appearance !== null) {
        elements.push(...appearance.elements)
        Object.assign(state.page.images, appearance.images)
        allFontInfos.push(...appearance.fonts)
        styles.push(...appearance.styles)
        continue
      }
      elements.push(...buildReplacementElements(annotation, styles, options.fonts ?? {}))
      if (annotation.overlayFont !== undefined) allFontInfos.push(annotation.overlayFont)
    }

    const usedImages = collectUsedImages(elements)
    const images: Record<string, Uint8Array> = {}
    for (const imageId of usedImages) {
      const image = state.page.images[imageId]
      if (image === undefined) throw new Error(`PDF redaction image resource is missing: ${imageId}`)
      images[imageId] = image
    }
    const template: ReportTemplate = {
      page: { width: state.page.width, height: state.page.height, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      styles,
      bands: { details: [{ height: state.page.height, elements }] },
    }
    parts.push({ template, data: { rows: [{}] }, options: { resources: { images } } })

    const pageRegions = regions
    const appliedSourceIndexes = new Set<number>()
    for (let i = 0; i < state.redactions.length; i++) appliedSourceIndexes.add(state.redactions[i]!.sourceIndex)
    for (let i = 0; i < state.annotations.length; i++) {
      const annotation = state.annotations[i]!
      if (appliedSourceIndexes.has(annotation.sourceIndex)) continue
      if (annotationIntersectsRegions(annotation, pageRegions)) continue
      retainedAnnotations.push({ annotation, pageIndex })
    }
  }

  const fonts = loadOutputFonts(allFontInfos, options.fonts ?? {})
  const fontMap: FontMap = new Map()
  for (const key of Object.keys(fonts)) fontMap.set(key, new TextMeasurer(fonts[key]!))
  for (let i = 0; i < parts.length; i++) parts[i]!.options!.fontMap = fontMap
  validateTextFonts(parts, fontMap)

  const document = createReportBook(parts)
  const annotations = preserveAnnotations(retainedAnnotations)
  return renderToPdf(document, { ...options.output, fonts, annotations })
}

type Matrix = [number, number, number, number, number, number]

function identityMatrix(): Matrix {
  return [1, 0, 0, 1, 0, 0]
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

function transformPoint(matrix: Matrix, x: number, y: number): Point {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }
}

function elementMatrix(parent: Matrix, element: ElementDef): Matrix {
  let matrix = multiplyMatrix(parent, [1, 0, 0, 1, element.x, element.y])
  if (element.type === 'frame' && element.affineTransform !== undefined) matrix = multiplyMatrix(matrix, element.affineTransform)
  if (element.type === 'frame' && element.rotation !== undefined && element.rotation !== 0) {
    const x = element.rotationOriginX ?? 0
    const y = element.rotationOriginY ?? 0
    const radians = element.rotation * Math.PI / 180
    const rotation: Matrix = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]
    matrix = multiplyMatrix(matrix, [1, 0, 0, 1, x, y])
    matrix = multiplyMatrix(matrix, rotation)
    matrix = multiplyMatrix(matrix, [1, 0, 0, 1, -x, -y])
  }
  return matrix
}

function elementPolygon(parent: Matrix, element: ElementDef): [Point, Point, Point, Point] {
  const matrix = elementMatrix(parent, element)
  return [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, element.width, 0),
    transformPoint(matrix, element.width, element.height),
    transformPoint(matrix, 0, element.height),
  ]
}

function filterElements(elements: ElementDef[], regions: RedactionRegion[], parent: Matrix): ElementDef[] {
  if (regions.length === 0) return elements
  const result: ElementDef[] = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'frame' && element.elements !== undefined) {
      const matrix = elementMatrix(parent, element)
      const children = filterElements(element.elements, regions, matrix)
      const frame: FrameDef = { ...element, elements: children }
      if (element.pdfForm !== undefined) {
        frame.pdfForm = {
          ...element.pdfForm,
          bbox: element.pdfForm.bbox,
          matrix: element.pdfForm.matrix,
          invocationMatrix: element.pdfForm.invocationMatrix,
        }
      }
      if (frame.softMask !== undefined) frame.softMask = { ...frame.softMask, elements: filterElements(frame.softMask.elements, regions, matrix) }
      result.push(frame)
      continue
    }
    if (!polygonIntersectsAny(elementPolygon(parent, element), regions)) result.push(element)
  }
  return result
}

function polygonIntersectsAny(polygon: [Point, Point, Point, Point], regions: RedactionRegion[]): boolean {
  for (let i = 0; i < regions.length; i++) {
    if (convexPolygonsIntersect(polygon, regions[i]!.points)) return true
  }
  return false
}

function convexPolygonsIntersect(a: Point[], b: Point[]): boolean {
  return !hasSeparatingAxis(a, b) && !hasSeparatingAxis(b, a)
}

function hasSeparatingAxis(source: Point[], other: Point[]): boolean {
  for (let i = 0; i < source.length; i++) {
    const current = source[i]!
    const next = source[(i + 1) % source.length]!
    const axisX = -(next.y - current.y)
    const axisY = next.x - current.x
    let sourceMin = Infinity
    let sourceMax = -Infinity
    let otherMin = Infinity
    let otherMax = -Infinity
    for (let p = 0; p < source.length; p++) {
      const projection = source[p]!.x * axisX + source[p]!.y * axisY
      sourceMin = Math.min(sourceMin, projection)
      sourceMax = Math.max(sourceMax, projection)
    }
    for (let p = 0; p < other.length; p++) {
      const projection = other[p]!.x * axisX + other[p]!.y * axisY
      otherMin = Math.min(otherMin, projection)
      otherMax = Math.max(otherMax, projection)
    }
    if (sourceMax <= otherMin || otherMax <= sourceMin) return true
  }
  return false
}

function annotationRegions(annotation: ImportedAnnotation): RedactionRegion[] {
  if (annotation.quadPoints !== undefined && annotation.quadPoints.length > 0) {
    return annotation.quadPoints.map(function (quad) {
      return { points: [point(quad, 0), point(quad, 2), point(quad, 6), point(quad, 4)] }
    })
  }
  return [{ points: rectPoints(annotation.x, annotation.y, annotation.width, annotation.height) }]
}

function point(values: number[], offset: number): Point {
  return { x: values[offset]!, y: values[offset + 1]! }
}

function rectPoints(x: number, y: number, width: number, height: number): [Point, Point, Point, Point] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
}

function annotationIntersectsRegions(annotation: ImportedAnnotation, regions: RedactionRegion[]): boolean {
  return polygonIntersectsAny(rectPoints(annotation.x, annotation.y, annotation.width, annotation.height), regions)
}

function buildReplacementElements(annotation: ImportedAnnotation, styles: StyleDef[], suppliedFonts: Record<string, Font>): ElementDef[] {
  const result: ElementDef[] = []
  const regions = annotationRegions(annotation)
  if (annotation.interiorColor !== undefined) {
    for (let i = 0; i < regions.length; i++) {
      const bounds = polygonBounds(regions[i]!.points)
      const points = regions[i]!.points
      const d = `M ${points[0].x - bounds.x} ${points[0].y - bounds.y} L ${points[1].x - bounds.x} ${points[1].y - bounds.y} L ${points[2].x - bounds.x} ${points[2].y - bounds.y} L ${points[3].x - bounds.x} ${points[3].y - bounds.y} Z`
      result.push({ type: 'path', x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, d, fill: annotation.interiorColor })
    }
  }
  if (annotation.overlayText === undefined) return result
  if (annotation.defaultAppearance === undefined) throw new Error('PDF redaction OverlayText requires DA')
  const appearance = parseDefaultAppearance(annotation.defaultAppearance)
  let familyName: string
  if (suppliedFonts[annotation.overlayFont?.familyName ?? ''] !== undefined) {
    familyName = annotation.overlayFont!.familyName
  } else if (suppliedFonts[appearance.fontName] !== undefined) {
    familyName = appearance.fontName
  } else {
    const info = annotation.overlayFont
    if (info === undefined || info.fontFile === undefined) {
      throw new Error(`PDF redaction OverlayText requires font data for /${appearance.fontName}`)
    }
    if (/^[A-Z]{6}\+/.test(info.baseFont)) {
      throw new Error(`PDF redaction OverlayText cannot use subset font ${info.baseFont}; supply the complete font as ${info.familyName}`)
    }
    if (info.fontFileFormat !== 'truetype' && info.fontFileFormat !== 'opentype') {
      throw new Error(`PDF redaction OverlayText requires a TrueType or OpenType font for ${info.familyName}`)
    }
    familyName = info.familyName
  }
  const styleName = `__pdf_redaction_${annotation.sourceIndex}`
  styles.push({ name: styleName, fontFamily: familyName, fontSize: appearance.fontSize, forecolor: appearance.color })
  let text = annotation.overlayText
  if (annotation.repeatOverlay === true) {
    const columns = Math.max(1, Math.ceil(annotation.width / Math.max(appearance.fontSize, appearance.fontSize * text.length * 0.5)))
    const rows = Math.max(1, Math.ceil(annotation.height / (appearance.fontSize * 1.2)))
    text = new Array(columns * rows).fill(annotation.overlayText).join(' ')
  }
  result.push({
    type: 'staticText',
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    text,
    style: styleName,
    hAlign: annotation.overlayQuadding === 1 ? 'center' : annotation.overlayQuadding === 2 ? 'right' : 'left',
    vAlign: 'middle',
    wrap: annotation.repeatOverlay === true,
    shrinkToFit: annotation.repeatOverlay !== true,
  })
  return result
}

function polygonBounds(points: Point[]): { x: number, y: number, width: number, height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < points.length; i++) {
    minX = Math.min(minX, points[i]!.x)
    minY = Math.min(minY, points[i]!.y)
    maxX = Math.max(maxX, points[i]!.x)
    maxY = Math.max(maxY, points[i]!.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function parseDefaultAppearance(value: string): ParsedDefaultAppearance {
  const bytes = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i)
  const lexer = new PdfContentLexer(bytes)
  const operands: PdfValue[] = []
  let fontName: string | undefined
  let fontSize: number | undefined
  let color = '#000000'
  for (;;) {
    const token = lexer.next()
    if (token.type === 'eof') break
    if (token.type === 'object') {
      operands.push(token.value)
      continue
    }
    if (token.type === 'inlineImage') throw new Error('PDF redaction DA cannot contain an inline image')
    if (token.value === 'Tf') {
      if (operands.length !== 2 || !(operands[0] instanceof PdfName) || !positiveNumber(operands[1])) {
        throw new Error('PDF redaction DA Tf requires a font name and positive font size')
      }
      fontName = operands[0].name
      fontSize = operands[1]
    } else if (token.value === 'g') {
      color = grayColor(operands)
    } else if (token.value === 'rg') {
      color = rgbColor(operands)
    } else if (token.value === 'k') {
      color = cmykColor(operands)
    }
    operands.length = 0
  }
  if (fontName === undefined || fontSize === undefined) throw new Error('PDF redaction DA requires Tf')
  return { fontName, fontSize, color }
}

function positiveNumber(value: PdfValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function colorComponent(value: PdfValue | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('PDF redaction DA color component must be between 0 and 1')
  return value
}

function grayColor(values: PdfValue[]): string {
  if (values.length !== 1) throw new Error('PDF redaction DA g requires one operand')
  const value = colorComponent(values[0])
  return colorHex(value, value, value)
}

function rgbColor(values: PdfValue[]): string {
  if (values.length !== 3) throw new Error('PDF redaction DA rg requires three operands')
  return colorHex(colorComponent(values[0]), colorComponent(values[1]), colorComponent(values[2]))
}

function cmykColor(values: PdfValue[]): string {
  if (values.length !== 4) throw new Error('PDF redaction DA k requires four operands')
  const c = colorComponent(values[0])
  const m = colorComponent(values[1])
  const y = colorComponent(values[2])
  const k = colorComponent(values[3])
  return colorHex(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k))
}

function colorHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(function (value) { return Math.round(value * 255).toString(16).padStart(2, '0') }).join('')
}

function collectUsedImages(elements: ElementDef[]): Set<string> {
  const result = new Set<string>()
  collectImagesInto(elements, result)
  return result
}

function collectImagesInto(elements: ElementDef[], result: Set<string>): void {
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'image' && element.source !== undefined) {
      result.add(element.source)
      if (element.alternates !== undefined) {
        for (let a = 0; a < element.alternates.length; a++) result.add(element.alternates[a]!.source)
      }
    }
    if (element.type === 'frame') {
      if (element.elements !== undefined) collectImagesInto(element.elements, result)
      if (element.softMask !== undefined) collectImagesInto(element.softMask.elements, result)
    }
  }
}

function loadOutputFonts(fontInfos: ImportedFontInfo[], supplied: Record<string, Font>): Record<string, Font> {
  const result: Record<string, Font> = { ...supplied }
  for (let i = 0; i < fontInfos.length; i++) {
    const info = fontInfos[i]!
    if (result[info.familyName] !== undefined || info.fontFile === undefined) continue
    if (info.fontFileFormat !== 'truetype' && info.fontFileFormat !== 'opentype') continue
    const buffer = info.fontFile.buffer.slice(info.fontFile.byteOffset, info.fontFile.byteOffset + info.fontFile.byteLength) as ArrayBuffer
    result[info.familyName] = Font.load(buffer)
  }
  return result
}

function validateTextFonts(parts: ReportBookPart[], fontMap: FontMap): void {
  for (let i = 0; i < parts.length; i++) {
    const template = parts[i]!.template
    const styles = new Map<string, StyleDef>()
    for (let s = 0; s < (template.styles?.length ?? 0); s++) styles.set(template.styles![s]!.name, template.styles![s]!)
    const elements = template.bands.details?.[0]?.elements ?? []
    validateElementFonts(elements, styles, fontMap)
  }
}

function validateElementFonts(elements: ElementDef[], styles: Map<string, StyleDef>, fontMap: FontMap): void {
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'staticText') {
      const family = element.style === undefined ? 'default' : styles.get(element.style)?.fontFamily ?? 'default'
      if (!fontMap.has(family)) throw new Error(`PDF redaction requires font data for ${family}`)
    }
    if (element.type === 'frame') {
      if (element.elements !== undefined) validateElementFonts(element.elements, styles, fontMap)
      if (element.softMask !== undefined) validateElementFonts(element.softMask.elements, styles, fontMap)
    }
  }
}

function preserveAnnotations(imported: RetainedAnnotation[]): PdfAnnotation[] {
  const retainedSources = new Set<number>()
  for (let i = 0; i < imported.length; i++) retainedSources.add(imported[i]!.annotation.sourceIndex)
  const withoutOrphanPopups = imported.filter(function (entry) {
    const annotation = entry.annotation
    return annotation.subtype !== 'Popup' || (annotation.parentIndex !== undefined && retainedSources.has(annotation.parentIndex))
  })
  const indexBySource = new Map<number, number>()
  for (let i = 0; i < withoutOrphanPopups.length; i++) indexBySource.set(withoutOrphanPopups[i]!.annotation.sourceIndex, i)
  const result: PdfAnnotation[] = []
  for (let i = 0; i < withoutOrphanPopups.length; i++) {
    const entry = withoutOrphanPopups[i]!
    const annotation = entry.annotation
    if (!isPdfAnnotationSubtype(annotation.subtype)) throw new Error(`PDF redaction cannot preserve unknown annotation subtype ${annotation.subtype}`)
    const preserved: PdfPreservedAnnotation = {
      model: 'preserved',
      subtype: annotation.subtype,
      pageIndex: entry.pageIndex,
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
      entries: annotation.entries,
    }
    if (annotation.contents !== undefined) preserved.contents = annotation.contents
    if (annotation.name !== undefined) preserved.name = annotation.name
    if (annotation.color !== undefined) preserved.color = annotation.color
    if (annotation.borderWidth !== undefined) preserved.borderWidth = annotation.borderWidth
    if (annotation.dashArray !== undefined) preserved.dashArray = annotation.dashArray
    if (annotation.borderStyle !== undefined) preserved.borderStyle = annotation.borderStyle
    if (annotation.borderEffect !== undefined) preserved.borderEffect = annotation.borderEffect
    if (annotation.opacity !== undefined) preserved.opacity = annotation.opacity
    if (annotation.modifiedDate !== undefined) preserved.modifiedDate = parsePdfDate(annotation.modifiedDate)
    if (annotation.flags !== undefined) preserved.flags = annotation.flags
    if (annotation.actionModel !== undefined) preserved.action = annotation.actionModel
    if (annotation.destination !== undefined) preserved.destination = annotation.destination
    if (annotation.additionalActionModels !== undefined) preserved.additionalActions = annotation.additionalActionModels
    if (annotation.appearance !== undefined) preserved.appearanceDictionary = annotation.appearance
    if (annotation.appearanceState !== undefined) preserved.appearanceState = annotation.appearanceState
    if (annotation.associatedFiles !== undefined) preserved.associatedFiles = annotation.associatedFiles as PdfEmbeddedFile[]
    if (annotation.popupIndex !== undefined) preserved.popupIndex = indexBySource.get(annotation.popupIndex)
    if (annotation.parentIndex !== undefined) preserved.parentIndex = indexBySource.get(annotation.parentIndex)
    if (annotation.replyToIndex !== undefined) preserved.replyToIndex = indexBySource.get(annotation.replyToIndex)
    result.push(preserved)
  }
  return result
}

function isPdfAnnotationSubtype(value: string): value is PdfAnnotationSubtype {
  return PDF_ANNOTATION_SUBTYPES.has(value as PdfAnnotationSubtype)
}

const PDF_ANNOTATION_SUBTYPES = new Set<PdfAnnotationSubtype>([
  'Link', 'Widget', 'Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine',
  'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup',
  'FileAttachment', 'Sound', 'Movie', 'Screen', 'PrinterMark', 'TrapNet', 'Watermark',
  '3D', 'Redact', 'Projection', 'RichMedia',
])

function parsePdfDate(value: string): Date {
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz]|[+\-])(\d{2})?'?(\d{2})?'?)?$/.exec(value)
  if (match === null) throw new Error(`PDF redaction annotation contains an invalid modification date: ${value}`)
  const year = Number(match[1])
  const month = Number(match[2] ?? '01')
  const day = Number(match[3] ?? '01')
  const hour = Number(match[4] ?? '00')
  const minute = Number(match[5] ?? '00')
  const second = Number(match[6] ?? '00')
  let time = Date.UTC(year, month - 1, day, hour, minute, second)
  if (match[7] === '+') time -= (Number(match[8] ?? '00') * 60 + Number(match[9] ?? '00')) * 60000
  if (match[7] === '-') time += (Number(match[8] ?? '00') * 60 + Number(match[9] ?? '00')) * 60000
  return new Date(time)
}
