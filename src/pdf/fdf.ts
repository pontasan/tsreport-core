/** Forms Data Format (FDF) reader/writer, ISO 32000-2 clause 12.7.8. */

import {
  Lexer,
  ObjectParser,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  TokType,
  isWhitespace,
  type PdfDict,
  type PdfValue,
} from './pdf-parser.js'
import { serializeIndirectObject } from './pdf-serializer.js'

const FDF_HEADER = new Uint8Array([0x25, 0x46, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x32])
const EOF_MARKER = new Uint8Array([0x25, 0x25, 0x45, 0x4F, 0x46])
const encoder = new TextEncoder()

export interface FdfWriteOptions {
  catalog: PdfDict
  objects?: ReadonlyMap<number, PdfValue>
  rootObjectNumber?: number
  includeXref?: boolean
}

export class FdfDocument {
  readonly headerVersion = '1.2'
  readonly trailer: PdfDict
  readonly root: PdfRef
  readonly catalog: PdfDict
  readonly fdf: PdfDict
  readonly objects: ReadonlyMap<number, PdfValue>

  constructor(trailer: PdfDict, root: PdfRef, catalog: PdfDict, fdf: PdfDict, objects: Map<number, PdfValue>) {
    this.trailer = trailer
    this.root = root
    this.catalog = catalog
    this.fdf = fdf
    this.objects = objects
  }

  resolve(value: PdfValue): PdfValue {
    if (!(value instanceof PdfRef)) return value
    if (value.gen !== 0) return null
    return this.objects.get(value.num) ?? null
  }
}

/** Parse a standalone FDF file without treating it as a PDF document. */
export function parseFdf(bytes: Uint8Array): FdfDocument {
  const headerEnd = validateFdfEnvelope(bytes)
  const lexer = new Lexer(bytes, headerEnd)
  const objects = new Map<number, PdfValue>()
  const objectOffsets = new Map<number, number>()
  let trailer: PdfDict | null = null
  let xrefEntries: Map<number, { offset: number, generation: number, inUse: boolean }> | null = null

  for (;;) {
    lexer.skipWhitespace()
    const itemOffset = lexer.pos
    const token = lexer.next()
    if (token === TokType.EOF) break
    if (token === TokType.Keyword && lexer.text === 'trailer') {
      const value = new ObjectParser(null, lexer).parseValue()
      if (!(value instanceof Map)) throw new Error('FDF parse error: trailer dictionary expected')
      trailer = value
      break
    }
    if (token === TokType.Keyword && lexer.text === 'xref') {
      if (xrefEntries !== null) throw new Error('FDF parse error: multiple cross-reference tables are not permitted')
      xrefEntries = parseFdfXref(lexer)
      const trailerToken = lexer.next()
      if (trailerToken !== TokType.Keyword || (lexer.text as string) !== 'trailer') throw new Error('FDF parse error: trailer must follow xref table')
      const value = new ObjectParser(null, lexer).parseValue()
      if (!(value instanceof Map)) throw new Error('FDF parse error: trailer dictionary expected')
      trailer = value
      break
    }
    if (token !== TokType.Int) throw new Error(`FDF parse error: indirect object or trailer expected at offset ${itemOffset}`)
    const objectNumber = lexer.num
    if (objectNumber <= 0 || objects.has(objectNumber)) throw new Error(`FDF parse error: invalid or duplicate object number ${objectNumber}`)
    if (lexer.next() !== TokType.Int || lexer.num !== 0) throw new Error('FDF parse error: every indirect object must use generation 0')
    if (lexer.next() !== TokType.Keyword || lexer.text !== 'obj') throw new Error('FDF parse error: obj keyword expected')
    const value = new ObjectParser(null, lexer, objectNumber, 0, false).parseValue()
    const afterValue = lexer.next()
    let objectValue = value
    if (afterValue === TokType.Keyword && (lexer.text as string) === 'stream') {
      if (!(value instanceof Map)) throw new Error('FDF parse error: stream requires a dictionary')
      const length = value.get('Length')
      if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
        throw new Error('FDF parse error: stream Length must be a direct non-negative integer')
      }
      if (bytes[lexer.pos] === 0x0D && bytes[lexer.pos + 1] === 0x0A) lexer.pos += 2
      else if (bytes[lexer.pos] === 0x0A) lexer.pos++
      else throw new Error('FDF parse error: stream keyword must be followed by LF or CRLF')
      const start = lexer.pos
      const end = start + length
      if (end > bytes.length) throw new Error('FDF parse error: stream Length exceeds the file')
      objectValue = new PdfStream(value, bytes.subarray(start, end), objectNumber, 0)
      lexer.pos = end
      if (lexer.next() !== TokType.Keyword || (lexer.text as string) !== 'endstream') throw new Error('FDF parse error: endstream expected at direct Length boundary')
      if (lexer.next() !== TokType.Keyword || (lexer.text as string) !== 'endobj') throw new Error('FDF parse error: endobj expected after stream')
    } else if (afterValue !== TokType.Keyword || (lexer.text as string) !== 'endobj') {
      throw new Error('FDF parse error: endobj expected')
    }
    objects.set(objectNumber, objectValue)
    objectOffsets.set(objectNumber, itemOffset)
  }

  if (trailer === null) throw new Error('FDF parse error: trailer not found')
  lexer.skipWhitespace()
  if (lexer.next() !== TokType.EOF) throw new Error('FDF parse error: data follows trailer dictionary')
  if (xrefEntries !== null) validateFdfXref(xrefEntries, objectOffsets)
  const root = trailer.get('Root')
  if (!(root instanceof PdfRef) || root.gen !== 0) throw new Error('FDF parse error: trailer Root must be a generation-0 indirect reference')
  const catalog = objects.get(root.num)
  if (!(catalog instanceof Map)) throw new Error('FDF parse error: Root must resolve to the FDF catalog dictionary')
  const resolver = (value: PdfValue): PdfValue => resolveFdfObject(value, objects, 'parse')
  const fdf = validateFdfCatalog(catalog, resolver)
  return new FdfDocument(trailer, root, catalog, fdf, objects)
}

/** Write a standalone FDF file, optionally including its non-required xref table. */
export function writeFdf(options: FdfWriteOptions): Uint8Array {
  const rootObjectNumber = options.rootObjectNumber ?? 1
  if (!Number.isSafeInteger(rootObjectNumber) || rootObjectNumber <= 0) throw new Error('FDF write error: invalid root object number')
  const objects = new Map<number, PdfValue>(options.objects ?? [])
  objects.set(rootObjectNumber, options.catalog)
  for (const objectNumber of objects.keys()) {
    if (!Number.isSafeInteger(objectNumber) || objectNumber <= 0) throw new Error(`FDF write error: invalid object number ${objectNumber}`)
    validateNoNestedStreams(objects.get(objectNumber)!, true)
  }
  const resolver = (value: PdfValue): PdfValue => resolveFdfObject(value, objects, 'write')
  validateFdfCatalog(options.catalog, resolver)

  const numbers = Array.from(objects.keys()).sort((a, b) => a - b)
  const parts: Uint8Array[] = []
  let offset = 0
  const offsets = new Map<number, number>()
  const push = (bytes: Uint8Array): void => { parts.push(bytes); offset += bytes.length }
  push(encoder.encode('%FDF-1.2\n'))
  for (let i = 0; i < numbers.length; i++) {
    const number = numbers[i]!
    offsets.set(number, offset)
    push(encoder.encode(`${number} 0 obj\n`))
    push(serializeIndirectObject(objects.get(number)!))
    push(encoder.encode('\nendobj\n'))
  }
  if (options.includeXref) {
    const size = numbers[numbers.length - 1]! + 1
    const free = new Array<number>()
    for (let number = 1; number < size; number++) if (!offsets.has(number)) free.push(number)
    let xref = `xref\n0 ${size}\n${String(free[0] ?? 0).padStart(10, '0')} 65535 f \n`
    let freeIndex = 0
    for (let number = 1; number < size; number++) {
      const objectOffset = offsets.get(number)
      if (objectOffset !== undefined) xref += `${String(objectOffset).padStart(10, '0')} 00000 n \n`
      else {
        xref += `${String(free[freeIndex + 1] ?? 0).padStart(10, '0')} 00000 f \n`
        freeIndex++
      }
    }
    push(encoder.encode(xref))
  }
  push(encoder.encode(`trailer\n<< /Root ${rootObjectNumber} 0 R >>\n%%EOF\n`))
  return concatBytes(parts)
}

function validateFdfEnvelope(bytes: Uint8Array): number {
  if (bytes.length < FDF_HEADER.length + 1) throw new Error('FDF parse error: truncated file')
  for (let i = 0; i < FDF_HEADER.length; i++) {
    if (bytes[i] !== FDF_HEADER[i]) throw new Error('FDF parse error: header must be %FDF-1.2')
  }
  let headerEnd = FDF_HEADER.length
  if (bytes[headerEnd] === 0x0D && bytes[headerEnd + 1] === 0x0A) headerEnd += 2
  else if (bytes[headerEnd] === 0x0D || bytes[headerEnd] === 0x0A) headerEnd++
  else throw new Error('FDF parse error: header must end with CR, LF, or CRLF')
  const eof = lastIndexOf(bytes, EOF_MARKER)
  if (eof < 0 || (eof > 0 && bytes[eof - 1] !== 0x0A && bytes[eof - 1] !== 0x0D)) {
    throw new Error('FDF parse error: final %%EOF line not found')
  }
  for (let i = eof + EOF_MARKER.length; i < bytes.length; i++) {
    if (!isWhitespace(bytes[i]!)) throw new Error('FDF parse error: non-whitespace follows %%EOF')
  }
  return headerEnd
}

function parseFdfXref(lexer: Lexer): Map<number, { offset: number, generation: number, inUse: boolean }> {
  const entries = new Map<number, { offset: number, generation: number, inUse: boolean }>()
  for (;;) {
    const token = lexer.next()
    if (token === TokType.Keyword && lexer.text === 'trailer') {
      lexer.pos -= 'trailer'.length
      return entries
    }
    if (token !== TokType.Int) throw new Error('FDF parse error: invalid xref subsection')
    const start = lexer.num
    if (lexer.next() !== TokType.Int) throw new Error('FDF parse error: xref subsection count expected')
    const count = lexer.num
    if (start < 0 || count < 0) throw new Error('FDF parse error: invalid xref subsection range')
    for (let i = 0; i < count; i++) {
      if (lexer.next() !== TokType.Int) throw new Error('FDF parse error: xref offset expected')
      const offset = lexer.num
      if (lexer.next() !== TokType.Int) throw new Error('FDF parse error: xref generation expected')
      const generation = lexer.num
      if (lexer.next() !== TokType.Keyword || (lexer.text !== 'n' && lexer.text !== 'f')) throw new Error('FDF parse error: xref entry type expected')
      const number = start + i
      if (entries.has(number)) throw new Error(`FDF parse error: duplicate xref entry ${number}`)
      entries.set(number, { offset, generation, inUse: lexer.text === 'n' })
    }
  }
}

function validateFdfXref(
  entries: Map<number, { offset: number, generation: number, inUse: boolean }>,
  objectOffsets: Map<number, number>,
): void {
  const zero = entries.get(0)
  if (zero === undefined || zero.inUse || zero.generation !== 0xFFFF) throw new Error('FDF parse error: xref object 0 must be free generation 65535')
  for (const [number, offset] of objectOffsets) {
    const entry = entries.get(number)
    if (entry === undefined || !entry.inUse || entry.generation !== 0 || entry.offset !== offset) {
      throw new Error(`FDF parse error: xref entry does not match object ${number}`)
    }
  }
}

function validateFdfCatalog(catalog: PdfDict, resolve: (value: PdfValue) => PdfValue): PdfDict {
  const version = resolve(catalog.get('Version') ?? null)
  if (version !== null && !(version instanceof PdfName)) throw new Error('FDF validation error: catalog Version must be a name')
  const signature = resolve(catalog.get('Sig') ?? null)
  if (signature !== null) requireDict(signature, 'catalog Sig')
  const fdf = requireDict(resolve(catalog.get('FDF') ?? null), 'catalog FDF')
  const file = resolve(fdf.get('F') ?? null)
  if (file !== null && !(file instanceof PdfString) && !(file instanceof Map)) throw new Error('FDF validation error: F must be a file specification')
  const fields = fdf.get('Fields')
  const status = fdf.get('Status')
  const pages = fdf.get('Pages')
  if (pages !== undefined && (fields !== undefined || status !== undefined)) {
    throw new Error('FDF validation error: Pages is mutually exclusive with Fields and Status')
  }
  if (fields !== undefined) validateFdfFields(requireArray(resolve(fields), 'Fields'), resolve, new Set())
  if (status !== undefined && !(resolve(status) instanceof PdfString)) throw new Error('FDF validation error: Status must be a string')
  if (pages !== undefined) validateFdfPages(requireArray(resolve(pages), 'Pages'), resolve)
  const encoding = resolve(fdf.get('Encoding') ?? null)
  if (encoding !== null && !(encoding instanceof PdfName)) throw new Error('FDF validation error: Encoding must be a name')
  const id = resolve(fdf.get('ID') ?? null)
  if (id !== null) {
    const values = requireArray(id, 'ID')
    if (values.length !== 2 || !(resolve(values[0]!) instanceof PdfString) || !(resolve(values[1]!) instanceof PdfString)) {
      throw new Error('FDF validation error: ID must contain two byte strings')
    }
  }
  const annots = resolve(fdf.get('Annots') ?? null)
  if (annots !== null) validateFdfAnnotations(requireArray(annots, 'Annots'), resolve)
  const differences = resolve(fdf.get('Differences') ?? null)
  if (differences !== null && !(differences instanceof PdfStream)) throw new Error('FDF validation error: Differences must be a stream')
  const embedded = resolve(fdf.get('EmbeddedFDFs') ?? null)
  if (embedded !== null) validateEmbeddedFdfs(requireArray(embedded, 'EmbeddedFDFs'), resolve)
  const target = resolve(fdf.get('Target') ?? null)
  if (target !== null && !(target instanceof PdfString)) throw new Error('FDF validation error: Target must be a string')
  const javaScript = resolve(fdf.get('JavaScript') ?? null)
  if (javaScript !== null) {
    const dictionary = requireDict(javaScript, 'JavaScript')
    for (const key of ['Before', 'After', 'AfterPermsReady']) {
      const script = resolve(dictionary.get(key) ?? null)
      if (script !== null && !(script instanceof PdfString) && !(script instanceof PdfStream)) {
        throw new Error(`FDF validation error: JavaScript ${key} must be a text string or stream`)
      }
    }
    const doc = resolve(dictionary.get('Doc') ?? null)
    if (doc !== null) {
      const pairs = requireArray(doc, 'JavaScript Doc')
      if ((pairs.length & 1) !== 0) throw new Error('FDF validation error: JavaScript Doc must contain name/script pairs')
      for (let i = 0; i < pairs.length; i += 2) {
        if (!(resolve(pairs[i]!) instanceof PdfString)) throw new Error('FDF validation error: JavaScript Doc names must be strings')
        const script = resolve(pairs[i + 1]!)
        if (!(script instanceof PdfString) && !(script instanceof PdfStream)) throw new Error('FDF validation error: JavaScript Doc scripts must be text strings or streams')
      }
    }
  }
  return fdf
}

function resolveFdfObject(value: PdfValue, objects: ReadonlyMap<number, PdfValue>, operation: string): PdfValue {
  if (!(value instanceof PdfRef)) return value
  if (value.gen !== 0) throw new Error(`FDF ${operation} error: indirect references must use generation 0`)
  const resolved = objects.get(value.num)
  if (resolved === undefined) throw new Error(`FDF ${operation} error: dangling indirect reference ${value.num} 0 R`)
  return resolved
}

function validateNoNestedStreams(value: PdfValue, indirectRoot: boolean): void {
  if (value instanceof PdfStream) {
    if (!indirectRoot) throw new Error('FDF write error: streams must be indirect objects')
    validateNoNestedStreams(value.dict, false)
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) validateNoNestedStreams(value[i]!, false)
  } else if (value instanceof Map) {
    for (const nested of value.values()) validateNoNestedStreams(nested, false)
  }
}

function validateFdfFields(fields: PdfValue[], resolve: (value: PdfValue) => PdfValue, path: Set<PdfDict>): void {
  for (let i = 0; i < fields.length; i++) {
    const field = requireDict(resolve(fields[i]!), 'field')
    if (path.has(field)) throw new Error('FDF validation error: circular field hierarchy')
    const name = resolve(field.get('T') ?? null)
    if (!(name instanceof PdfString)) throw new Error('FDF validation error: field T must be a text string')
    const kids = resolve(field.get('Kids') ?? null)
    if (kids !== null) {
      path.add(field)
      validateFdfFields(requireArray(kids, 'field Kids'), resolve, path)
      path.delete(field)
    }
  }
}

function validateFdfPages(pages: PdfValue[], resolve: (value: PdfValue) => PdfValue): void {
  for (let i = 0; i < pages.length; i++) {
    const page = requireDict(resolve(pages[i]!), 'page')
    const templates = requireArray(resolve(page.get('Templates') ?? null), 'page Templates')
    for (let j = 0; j < templates.length; j++) {
      const template = requireDict(resolve(templates[j]!), 'template')
      const reference = requireDict(resolve(template.get('TRef') ?? null), 'template TRef')
      if (!(resolve(reference.get('Name') ?? null) instanceof PdfString)) throw new Error('FDF validation error: TRef Name must be a string')
      const rename = resolve(template.get('Rename') ?? null)
      if (rename !== null && typeof rename !== 'boolean') throw new Error('FDF validation error: template Rename must be a boolean')
      const fields = resolve(template.get('Fields') ?? null)
      if (fields !== null) requireArray(fields, 'template Fields')
      const file = resolve(reference.get('F') ?? null)
      if (file !== null && !(file instanceof PdfString) && !(file instanceof Map)) throw new Error('FDF validation error: TRef F must be a file specification')
    }
  }
}

function validateFdfAnnotations(annots: PdfValue[], resolve: (value: PdfValue) => PdfValue): void {
  const forbidden = new Set(['Link', 'Movie', 'Widget', 'PrinterMark', 'Screen', 'TrapNet'])
  for (let i = 0; i < annots.length; i++) {
    const annot = requireDict(resolve(annots[i]!), 'annotation')
    const page = resolve(annot.get('Page') ?? null)
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 0) throw new Error('FDF validation error: annotation Page must be a non-negative integer')
    const subtype = resolve(annot.get('Subtype') ?? null)
    if (!(subtype instanceof PdfName)) throw new Error('FDF validation error: annotation Subtype must be a name')
    if (forbidden.has(subtype.name)) throw new Error(`FDF validation error: annotation subtype /${subtype.name} is forbidden in FDF`)
  }
}

function validateEmbeddedFdfs(files: PdfValue[], resolve: (value: PdfValue) => PdfValue): void {
  for (let i = 0; i < files.length; i++) {
    const file = resolve(files[i]!)
    if (file instanceof PdfString) continue
    const specification = requireDict(file, 'EmbeddedFDFs file specification')
    const embedded = resolve(specification.get('EF') ?? null)
    if (embedded === null) continue
    const streams = requireDict(embedded, 'EmbeddedFDFs EF')
    for (const value of streams.values()) {
      const stream = resolve(value)
      if (!(stream instanceof PdfStream)) throw new Error('FDF validation error: EmbeddedFDFs EF values must be streams')
      const revision = resolve(stream.dict.get('EncryptionRevision') ?? null)
      if (revision !== null && revision !== 1) throw new Error('FDF validation error: EncryptionRevision must be 1')
    }
  }
}

function requireDict(value: PdfValue, label: string): PdfDict {
  if (!(value instanceof Map)) throw new Error(`FDF validation error: ${label} must be a dictionary`)
  return value
}

function requireArray(value: PdfValue, label: string): PdfValue[] {
  if (!Array.isArray(value)) throw new Error(`FDF validation error: ${label} must be an array`)
  return value
}

function lastIndexOf(data: Uint8Array, pattern: Uint8Array): number {
  for (let i = data.length - pattern.length; i >= 0; i--) {
    let matched = true
    for (let j = 0; j < pattern.length; j++) if (data[i + j] !== pattern[j]) { matched = false; break }
    if (matched) return i
  }
  return -1
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (let i = 0; i < parts.length; i++) length += parts[i]!.length
  const out = new Uint8Array(length)
  let offset = 0
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i]!, offset)
    offset += parts[i]!.length
  }
  return out
}
