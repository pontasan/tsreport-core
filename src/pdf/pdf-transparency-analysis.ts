import { PdfContentLexer } from './content-lexer.js'
import { collectPdfPages } from './pdf-import.js'
import { PdfDocument, PdfName, PdfStream, parsePdf, type PdfDict, type PdfValue } from './pdf-parser.js'

export type PdfTransparencyReason =
  | 'soft-mask'
  | 'non-unit-fill-alpha'
  | 'non-unit-stroke-alpha'
  | 'non-normal-blend-mode'
  | 'transparency-group'
  | 'image-soft-mask'
  | 'image-smask-in-data'
  | 'annotation-blend-mode'

export interface PdfTransparencyFinding {
  reason: PdfTransparencyReason
  location: string
}

export interface PdfPageTransparencyAnalysis {
  transparent: boolean
  findings: PdfTransparencyFinding[]
}

export interface PdfTransparencyAnalysisOptions {
  password?: string
}

interface TransparencyGraphicsState {
  softMask: boolean
  fillAlpha: number
  strokeAlpha: number
  nonNormalBlendMode: boolean
  fillPattern: string | null
  strokePattern: string | null
  fontName: string | null
  textRenderingMode: number
}

interface AnalysisContext {
  doc: PdfDocument
  findings: PdfTransparencyFinding[]
  findingKeys: Set<string>
  activeStreams: Set<PdfStream>
}

/**
 * Applies ISO 32000-2 Annex Q to one page in a PDF byte sequence.
 * Only resources reached by rendered content are inspected.
 */
export function analyzePdfPageTransparency(
  pdf: Uint8Array,
  pageIndex: number,
  options: PdfTransparencyAnalysisOptions = {},
): PdfPageTransparencyAnalysis {
  const doc = parsePdf(pdf, options.password === undefined ? {} : { password: options.password })
  return analyzeParsedPdfPageTransparency(doc, pageIndex)
}

/** Applies ISO 32000-2 Annex Q to one page of an already parsed document. */
export function analyzeParsedPdfPageTransparency(
  doc: PdfDocument,
  pageIndex: number,
): PdfPageTransparencyAnalysis {
  const pages = collectPdfPages(doc)
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
    throw new Error(`PDF transparency analysis page index ${pageIndex} out of range`)
  }
  const context: AnalysisContext = {
    doc,
    findings: [],
    findingKeys: new Set<string>(),
    activeStreams: new Set<PdfStream>(),
  }
  const page = pages[pageIndex]!
  const resources = resolvedDict(doc, page.resources, `page ${pageIndex + 1} Resources`)
  analyzeContents(context, page.dict.get('Contents') ?? null, resources, `page ${pageIndex + 1}`)
  analyzeAnnotations(context, page.dict.get('Annots') ?? null, resources, `page ${pageIndex + 1}`)
  return { transparent: context.findings.length > 0, findings: context.findings }
}

function analyzeContents(
  context: AnalysisContext,
  contentsValue: PdfValue,
  resources: PdfDict,
  location: string,
): void {
  const resolved = context.doc.resolve(contentsValue)
  if (resolved === null) return
  const streams: PdfStream[] = []
  if (resolved instanceof PdfStream) {
    streams.push(resolved)
  } else if (Array.isArray(resolved)) {
    for (let i = 0; i < resolved.length; i++) {
      const stream = context.doc.resolve(resolved[i]!)
      if (!(stream instanceof PdfStream)) throw new Error(`${location} Contents[${i}] must be a stream`)
      streams.push(stream)
    }
  } else {
    throw new Error(`${location} Contents must be a stream or array of streams`)
  }

  const state = initialGraphicsState()
  const stack: TransparencyGraphicsState[] = []
  for (let i = 0; i < streams.length; i++) {
    analyzeContentStream(context, streams[i]!, resources, `${location} content ${i + 1}`, state, stack)
  }
}

function analyzeContentStream(
  context: AnalysisContext,
  stream: PdfStream,
  inheritedResources: PdfDict,
  location: string,
  state = initialGraphicsState(),
  stack: TransparencyGraphicsState[] = [],
): void {
  if (context.activeStreams.has(stream)) throw new Error(`${location} contains a recursive content stream reference`)
  context.activeStreams.add(stream)
  try {
    const resourcesValue = context.doc.resolve(stream.dict.get('Resources') ?? null)
    const resources = resourcesValue instanceof Map ? resourcesValue : inheritedResources
    const lexer = new PdfContentLexer(context.doc.decodeStream(stream))
    const operands: PdfValue[] = []
    for (;;) {
      const token = lexer.next()
      if (token.type === 'eof') break
      if (token.type === 'object') {
        operands.push(token.value)
        continue
      }
      if (token.type === 'inlineImage') {
        recordPaintState(context, state, true, false, `${location} inline image`)
        operands.length = 0
        continue
      }
      applyOperator(context, resources, location, token.value, operands, state, stack)
      operands.length = 0
    }
  } finally {
    context.activeStreams.delete(stream)
  }
}

function applyOperator(
  context: AnalysisContext,
  resources: PdfDict,
  location: string,
  operator: string,
  operands: PdfValue[],
  state: TransparencyGraphicsState,
  stack: TransparencyGraphicsState[],
): void {
  if (operator === 'q') {
    stack.push(copyGraphicsState(state))
    return
  }
  if (operator === 'Q') {
    const restored = stack.pop()
    if (restored === undefined) throw new Error(`${location} has an unmatched Q operator`)
    assignGraphicsState(state, restored)
    return
  }
  if (operator === 'gs') {
    applyExtGState(context, resources, requireNameOperand(operands, 0, location, operator), state, location)
    return
  }
  if (operator === 'Tf') {
    state.fontName = requireNameOperand(operands, 0, location, operator)
    return
  }
  if (operator === 'Tr') {
    const mode = requireNumberOperand(operands, 0, location, operator)
    if (!Number.isInteger(mode) || mode < 0 || mode > 7) throw new Error(`${location} Tr must be an integer from 0 through 7`)
    state.textRenderingMode = mode
    return
  }
  if (operator === 'scn') {
    state.fillPattern = lastNameOperand(operands)
    return
  }
  if (operator === 'SCN') {
    state.strokePattern = lastNameOperand(operands)
    return
  }
  if (operator === 'Do') {
    recordPaintState(context, state, true, false, `${location} Do`)
    analyzeXObject(context, resources, requireNameOperand(operands, 0, location, operator), location)
    return
  }
  if (operator === 'sh') {
    recordPaintState(context, state, true, false, `${location} sh`)
    analyzeActivePattern(context, resources, state.fillPattern, `${location} fill pattern`)
    return
  }
  if (isTextPaintOperator(operator)) {
    const fill = state.textRenderingMode === 0 || state.textRenderingMode === 2 || state.textRenderingMode === 4 || state.textRenderingMode === 6
    const stroke = state.textRenderingMode === 1 || state.textRenderingMode === 2 || state.textRenderingMode === 5 || state.textRenderingMode === 6
    if (fill || stroke) {
      recordPaintState(context, state, fill, stroke, `${location} text`)
      if (fill) analyzeActivePattern(context, resources, state.fillPattern, `${location} text fill pattern`)
      if (stroke) analyzeActivePattern(context, resources, state.strokePattern, `${location} text stroke pattern`)
      analyzeType3Font(context, resources, state.fontName, location)
    }
    return
  }
  const pathPaint = pathPaintingChannels(operator)
  if (pathPaint !== null) {
    recordPaintState(context, state, pathPaint.fill, pathPaint.stroke, `${location} ${operator}`)
    if (pathPaint.fill) analyzeActivePattern(context, resources, state.fillPattern, `${location} fill pattern`)
    if (pathPaint.stroke) analyzeActivePattern(context, resources, state.strokePattern, `${location} stroke pattern`)
  }
}

function applyExtGState(
  context: AnalysisContext,
  resources: PdfDict,
  name: string,
  state: TransparencyGraphicsState,
  location: string,
): void {
  const dictionary = namedResourceDict(context.doc, resources, 'ExtGState', name, location)
  if (dictionary.has('SMask')) {
    const mask = context.doc.resolve(dictionary.get('SMask')!)
    state.softMask = !(mask instanceof PdfName && mask.name === 'None')
  }
  if (dictionary.has('ca')) state.fillAlpha = requireResolvedNumber(context.doc, dictionary.get('ca')!, `${location} ExtGState ${name} ca`)
  if (dictionary.has('CA')) state.strokeAlpha = requireResolvedNumber(context.doc, dictionary.get('CA')!, `${location} ExtGState ${name} CA`)
  if (dictionary.has('BM')) state.nonNormalBlendMode = hasNonNormalBlendMode(context.doc, dictionary.get('BM')!, `${location} ExtGState ${name} BM`)
}

function recordPaintState(
  context: AnalysisContext,
  state: TransparencyGraphicsState,
  fill: boolean,
  stroke: boolean,
  location: string,
): void {
  if (state.softMask) addFinding(context, 'soft-mask', location)
  if (fill && state.fillAlpha < 1) addFinding(context, 'non-unit-fill-alpha', location)
  if (stroke && state.strokeAlpha < 1) addFinding(context, 'non-unit-stroke-alpha', location)
  if (state.nonNormalBlendMode) addFinding(context, 'non-normal-blend-mode', location)
}

function analyzeXObject(context: AnalysisContext, resources: PdfDict, name: string, location: string): void {
  const value = namedResource(context.doc, resources, 'XObject', name, location)
  if (!(value instanceof PdfStream)) throw new Error(`${location} XObject ${name} must be a stream`)
  const subtype = context.doc.resolve(value.dict.get('Subtype') ?? null)
  if (!(subtype instanceof PdfName)) throw new Error(`${location} XObject ${name} requires Subtype`)
  if (subtype.name === 'Form') {
    analyzeFormLikeStream(context, value, resources, `${location} Form ${name}`)
  } else if (subtype.name === 'Image') {
    analyzeImage(context, value.dict, `${location} Image ${name}`)
  }
}

function analyzeFormLikeStream(
  context: AnalysisContext,
  stream: PdfStream,
  inheritedResources: PdfDict,
  location: string,
): void {
  const group = context.doc.resolve(stream.dict.get('Group') ?? null)
  if (group instanceof Map) {
    const subtype = context.doc.resolve(group.get('S') ?? null)
    if (subtype instanceof PdfName && subtype.name === 'Transparency') addFinding(context, 'transparency-group', location)
  }
  analyzeContentStream(context, stream, inheritedResources, location)
}

function analyzeImage(context: AnalysisContext, dictionary: PdfDict, location: string): void {
  const softMask = context.doc.resolve(dictionary.get('SMask') ?? null)
  if (softMask instanceof PdfStream) addFinding(context, 'image-soft-mask', location)
  const smaskInData = context.doc.resolve(dictionary.get('SMaskInData') ?? null)
  if (typeof smaskInData === 'number' && smaskInData > 0) addFinding(context, 'image-smask-in-data', location)
}

function analyzeActivePattern(
  context: AnalysisContext,
  resources: PdfDict,
  name: string | null,
  location: string,
): void {
  if (name === null) return
  const pattern = namedResource(context.doc, resources, 'Pattern', name, location)
  if (!(pattern instanceof PdfStream)) return
  const patternType = context.doc.resolve(pattern.dict.get('PatternType') ?? null)
  if (patternType === 1) analyzeFormLikeStream(context, pattern, resources, `${location} ${name}`)
}

function analyzeType3Font(
  context: AnalysisContext,
  resources: PdfDict,
  name: string | null,
  location: string,
): void {
  if (name === null) return
  const font = namedResource(context.doc, resources, 'Font', name, location)
  if (!(font instanceof Map)) throw new Error(`${location} Font ${name} must be a dictionary`)
  const subtype = context.doc.resolve(font.get('Subtype') ?? null)
  if (!(subtype instanceof PdfName) || subtype.name !== 'Type3') return
  const charProcs = context.doc.resolve(font.get('CharProcs') ?? null)
  if (!(charProcs instanceof Map)) throw new Error(`${location} Type3 Font ${name} requires CharProcs`)
  const fontResourcesValue = context.doc.resolve(font.get('Resources') ?? null)
  const fontResources = fontResourcesValue instanceof Map ? fontResourcesValue : resources
  for (const [glyphName, raw] of charProcs) {
    const stream = context.doc.resolve(raw)
    if (!(stream instanceof PdfStream)) throw new Error(`${location} Type3 CharProc ${glyphName} must be a stream`)
    analyzeFormLikeStream(context, stream, fontResources, `${location} Type3 ${name}/${glyphName}`)
  }
}

function analyzeAnnotations(
  context: AnalysisContext,
  annotationsValue: PdfValue,
  pageResources: PdfDict,
  location: string,
): void {
  const resolved = context.doc.resolve(annotationsValue)
  if (resolved === null) return
  if (!Array.isArray(resolved)) throw new Error(`${location} Annots must be an array`)
  for (let i = 0; i < resolved.length; i++) {
    const annotation = context.doc.resolve(resolved[i]!)
    if (!(annotation instanceof Map)) throw new Error(`${location} annotation ${i + 1} must be a dictionary`)
    if (annotation.has('BM') && hasNonNormalBlendMode(context.doc, annotation.get('BM')!, `${location} annotation ${i + 1} BM`)) {
      addFinding(context, 'annotation-blend-mode', `${location} annotation ${i + 1}`)
    }
    const appearance = context.doc.resolve(annotation.get('AP') ?? null)
    if (!(appearance instanceof Map)) continue
    for (const [appearanceKind, raw] of appearance) {
      analyzeAppearanceValue(context, raw, pageResources, `${location} annotation ${i + 1} ${appearanceKind}`)
    }
  }
}

function analyzeAppearanceValue(
  context: AnalysisContext,
  value: PdfValue,
  resources: PdfDict,
  location: string,
): void {
  const resolved = context.doc.resolve(value)
  if (resolved instanceof PdfStream) {
    analyzeFormLikeStream(context, resolved, resources, location)
    return
  }
  if (!(resolved instanceof Map)) throw new Error(`${location} appearance must be a stream or state dictionary`)
  for (const [stateName, raw] of resolved) {
    const stream = context.doc.resolve(raw)
    if (!(stream instanceof PdfStream)) throw new Error(`${location}/${stateName} appearance must be a stream`)
    analyzeFormLikeStream(context, stream, resources, `${location}/${stateName}`)
  }
}

function hasNonNormalBlendMode(doc: PdfDocument, value: PdfValue, location: string): boolean {
  const resolved = doc.resolve(value)
  if (resolved instanceof PdfName) return resolved.name !== 'Normal'
  if (!Array.isArray(resolved) || resolved.length === 0) throw new Error(`${location} must be a name or non-empty array`)
  for (let i = 0; i < resolved.length; i++) {
    const mode = doc.resolve(resolved[i]!)
    if (!(mode instanceof PdfName)) throw new Error(`${location}[${i}] must be a name`)
    if (mode.name !== 'Normal') return true
  }
  return false
}

function addFinding(context: AnalysisContext, reason: PdfTransparencyReason, location: string): void {
  const key = `${reason}\u0000${location}`
  if (context.findingKeys.has(key)) return
  context.findingKeys.add(key)
  context.findings.push({ reason, location })
}

function initialGraphicsState(): TransparencyGraphicsState {
  return {
    softMask: false,
    fillAlpha: 1,
    strokeAlpha: 1,
    nonNormalBlendMode: false,
    fillPattern: null,
    strokePattern: null,
    fontName: null,
    textRenderingMode: 0,
  }
}

function copyGraphicsState(state: TransparencyGraphicsState): TransparencyGraphicsState {
  return { ...state }
}

function assignGraphicsState(target: TransparencyGraphicsState, source: TransparencyGraphicsState): void {
  target.softMask = source.softMask
  target.fillAlpha = source.fillAlpha
  target.strokeAlpha = source.strokeAlpha
  target.nonNormalBlendMode = source.nonNormalBlendMode
  target.fillPattern = source.fillPattern
  target.strokePattern = source.strokePattern
  target.fontName = source.fontName
  target.textRenderingMode = source.textRenderingMode
}

function namedResource(
  doc: PdfDocument,
  resources: PdfDict,
  category: string,
  name: string,
  location: string,
): PdfValue {
  const categoryDict = resolvedDict(doc, resources.get(category) ?? null, `${location} ${category} resources`)
  if (!categoryDict.has(name)) throw new Error(`${location} references missing ${category} resource ${name}`)
  return doc.resolve(categoryDict.get(name)!)
}

function namedResourceDict(
  doc: PdfDocument,
  resources: PdfDict,
  category: string,
  name: string,
  location: string,
): PdfDict {
  const value = namedResource(doc, resources, category, name, location)
  if (!(value instanceof Map)) throw new Error(`${location} ${category} resource ${name} must be a dictionary`)
  return value
}

function resolvedDict(doc: PdfDocument, value: PdfValue, location: string): PdfDict {
  const resolved = doc.resolve(value)
  if (!(resolved instanceof Map)) throw new Error(`${location} must be a dictionary`)
  return resolved
}

function requireResolvedNumber(doc: PdfDocument, value: PdfValue, location: string): number {
  const resolved = doc.resolve(value)
  if (typeof resolved !== 'number' || !Number.isFinite(resolved)) throw new Error(`${location} must be a finite number`)
  return resolved
}

function requireNameOperand(operands: PdfValue[], index: number, location: string, operator: string): string {
  const value = operands[index]
  if (!(value instanceof PdfName)) throw new Error(`${location} ${operator} operand ${index + 1} must be a name`)
  return value.name
}

function requireNumberOperand(operands: PdfValue[], index: number, location: string, operator: string): number {
  const value = operands[index]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${location} ${operator} operand ${index + 1} must be a number`)
  return value
}

function lastNameOperand(operands: PdfValue[]): string | null {
  const value = operands[operands.length - 1]
  return value instanceof PdfName ? value.name : null
}

function isTextPaintOperator(operator: string): boolean {
  return operator === 'Tj' || operator === 'TJ' || operator === "'" || operator === '"'
}

function pathPaintingChannels(operator: string): { fill: boolean, stroke: boolean } | null {
  if (operator === 'f' || operator === 'F' || operator === 'f*') return { fill: true, stroke: false }
  if (operator === 'S' || operator === 's') return { fill: false, stroke: true }
  if (operator === 'B' || operator === 'B*' || operator === 'b' || operator === 'b*') return { fill: true, stroke: true }
  return null
}
