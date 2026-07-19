/**
 * PDF parser (ISO 32000-1 compliant)
 *
 * Reads existing PDF files and exposes them as an object graph.
 * Foundation for page import/merge (pdf-import.ts).
 *
 * Supported scope:
 * - Classic xref table + trailer (§7.5.4)
 * - Cross-reference streams (/Type /XRef, PDF 1.5+, §7.5.8)
 *   - W array / Index array / PNG predictor (Predictor 10-15) / TIFF predictor (2)
 * - Object streams (/Type /ObjStm, §7.5.7)
 * - FlateDecode (uses src/compression/inflate.ts)
 * - Incremental updates (Prev chain of multiple xref sections)
 * - hybrid-reference file (/XRefStm)
 * - Standard Security Handler encrypted PDFs when the correct password is supplied
 */

import { zlibInflate } from '../compression/inflate.js'
import { decodeCcittFaxData } from '../compression/ccitt.js'
import {
  createDecryptionContext,
  createDecryptionContextWithKey,
  type DecryptionContext,
  type StandardSecurityCipher,
  type StandardSecurityParams,
} from '../renderer/pdf-encryption.js'
import { recoverPubSecFileKey, type PubSecCredential } from './pdf-pubsec.js'

// ─── Object model ───

/** PDF name object (/Name) */
export class PdfName {
  readonly name: string
  constructor(name: string) {
    this.name = name
  }
}

/** PDF string object (both literal and hex are held as raw byte sequences) */
export class PdfString {
  readonly bytes: Uint8Array
  /** Whether the source token used hexadecimal-string syntax. */
  readonly isHex: boolean
  /** Number of hexadecimal digits in the source token, excluding whitespace. */
  readonly hexDigitCount: number
  constructor(bytes: Uint8Array, isHex = false, hexDigitCount = bytes.length * 2) {
    this.bytes = bytes
    this.isHex = isHex
    this.hexDigitCount = hexDigitCount
  }
}

/** Indirect reference (N G R) */
export class PdfRef {
  readonly num: number
  readonly gen: number
  constructor(num: number, gen: number) {
    this.num = num
    this.gen = gen
  }
}

/** PDF dictionary (keys are names without the leading /) */
export type PdfDict = Map<string, PdfValue>

/** PDF stream object (raw is the on-file byte sequence before filters are applied) */
export class PdfStream {
  readonly dict: PdfDict
  readonly raw: Uint8Array
  readonly objNum: number
  readonly genNum: number
  constructor(dict: PdfDict, raw: Uint8Array, objNum = -1, genNum = 0) {
    this.dict = dict
    this.raw = raw
    this.objNum = objNum
    this.genNum = genNum
  }
}

export type PdfValue =
  | null
  | boolean
  | number
  | PdfName
  | PdfString
  | PdfRef
  | PdfValue[]
  | PdfDict
  | PdfStream

// ─── Lexical analysis ───

export const enum TokType {
  Int,
  Real,
  Name,
  String,
  DictOpen,
  DictClose,
  ArrayOpen,
  ArrayClose,
  Keyword,
  EOF,
}

export function isWhitespace(b: number): boolean {
  return b === 0x20 || b === 0x0A || b === 0x0D || b === 0x09 || b === 0x0C || b === 0x00
}

function pdfEolLengthAt(data: Uint8Array, offset: number): number {
  if (data[offset] === 0x0D) return data[offset + 1] === 0x0A ? 2 : 1
  return data[offset] === 0x0A ? 1 : 0
}

function pdfEolImmediatelyBefore(data: Uint8Array, offset: number): boolean {
  return offset > 0 && (data[offset - 1] === 0x0A || data[offset - 1] === 0x0D)
}

function pdfSingleWhitespaceBetween(data: Uint8Array, start: number, end: number): boolean {
  return end === start + 1 && isWhitespace(data[start]!)
}

function pdfKeywordAt(data: Uint8Array, offset: number, keyword: string): boolean {
  for (let index = 0; index < keyword.length; index++) {
    if (data[offset + index] !== keyword.charCodeAt(index)) return false
  }
  return true
}

function isDelimiter(b: number): boolean {
  return b === 0x28 || b === 0x29 || b === 0x3C || b === 0x3E || b === 0x5B || b === 0x5D
    || b === 0x7B || b === 0x7D || b === 0x2F || b === 0x25
}

function isRegular(b: number): boolean {
  return !isWhitespace(b) && !isDelimiter(b)
}

function hexDigit(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10
  return -1
}

const ENDSTREAM_BYTES = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d] // "endstream"

/** Whether `keyword` appears at `pos` after optional PDF whitespace, as a full token. */
export function streamKeywordFollows(data: Uint8Array, pos: number, keyword: string): boolean {
  let i = pos
  while (i < data.length && isWhitespace(data[i]!)) i++
  for (let k = 0; k < keyword.length; k++) {
    if (data[i + k] !== keyword.charCodeAt(k)) return false
  }
  const after = data[i + keyword.length]
  return after === undefined || !isRegular(after)
}

/**
 * Recover a stream's end when its /Length is wrong or missing: scan for the
 * "endstream" keyword from `start` and return the data end just before the
 * single EOL that precedes it. Returns -1 if no "endstream" is found.
 */
function findEndstream(data: Uint8Array, start: number): number {
  const last = data.length - ENDSTREAM_BYTES.length
  for (let i = start; i <= last; i++) {
    let match = true
    for (let k = 0; k < ENDSTREAM_BYTES.length; k++) {
      if (data[i + k] !== ENDSTREAM_BYTES[k]) { match = false; break }
    }
    if (!match) continue
    let end = i
    if (end > start && data[end - 1] === 0x0A) end--
    if (end > start && data[end - 1] === 0x0D) end--
    return end
  }
  return -1
}

export class Lexer {
  readonly data: Uint8Array
  pos: number

  // Contents of the most recent token
  type: TokType = TokType.EOF
  tokenStart = 0
  num = 0
  text = ''          // Name / Keyword
  bytes: Uint8Array = EMPTY_BYTES  // String
  stringIsHex = false
  stringHexDigitCount = 0

  constructor(data: Uint8Array, pos: number) {
    this.data = data
    this.pos = pos
  }

  skipWhitespace(): void {
    const data = this.data
    while (this.pos < data.length) {
      const b = data[this.pos]!
      if (isWhitespace(b)) {
        this.pos++
      } else if (b === 0x25) { // % comment
        this.pos++
        while (this.pos < data.length && data[this.pos] !== 0x0A && data[this.pos] !== 0x0D) {
          this.pos++
        }
      } else {
        break
      }
    }
  }

  next(): TokType {
    this.skipWhitespace()
    this.tokenStart = this.pos
    this.stringIsHex = false
    this.stringHexDigitCount = 0
    const data = this.data
    if (this.pos >= data.length) {
      this.type = TokType.EOF
      return this.type
    }
    const b = data[this.pos]!

    if (b === 0x2F) { // '/'
      this.pos++
      this.readName()
      this.type = TokType.Name
      return this.type
    }
    if (b === 0x28) { // '('
      this.pos++
      this.readLiteralString()
      this.type = TokType.String
      return this.type
    }
    if (b === 0x3C) { // '<'
      if (data[this.pos + 1] === 0x3C) {
        this.pos += 2
        this.type = TokType.DictOpen
        return this.type
      }
      this.pos++
      this.readHexString()
      this.type = TokType.String
      return this.type
    }
    if (b === 0x3E) { // '>'
      if (data[this.pos + 1] !== 0x3E) {
        throw new Error(`PDF parse error: unexpected '>' at offset ${this.pos}`)
      }
      this.pos += 2
      this.type = TokType.DictClose
      return this.type
    }
    if (b === 0x5B) { // '['
      this.pos++
      this.type = TokType.ArrayOpen
      return this.type
    }
    if (b === 0x5D) { // ']'
      this.pos++
      this.type = TokType.ArrayClose
      return this.type
    }
    if ((b >= 0x30 && b <= 0x39) || b === 0x2B || b === 0x2D || b === 0x2E) {
      this.readNumber()
      return this.type
    }
    if (isRegular(b)) {
      this.readKeyword()
      this.type = TokType.Keyword
      return this.type
    }
    throw new Error(`PDF parse error: unexpected byte 0x${b.toString(16)} at offset ${this.pos}`)
  }

  private readName(): void {
    const data = this.data
    let name = ''
    while (this.pos < data.length) {
      const b = data[this.pos]!
      if (!isRegular(b)) break
      if (b === 0x23) { // '#' escape
        const h1 = hexDigit(data[this.pos + 1] ?? -1)
        const h2 = hexDigit(data[this.pos + 2] ?? -1)
        if (h1 < 0 || h2 < 0) {
          throw new Error(`PDF parse error: invalid name escape at offset ${this.pos}`)
        }
        const decoded = h1 * 16 + h2
        if (decoded === 0) throw new Error(`PDF parse error: a name must not contain null at offset ${this.pos}`)
        name += String.fromCharCode(decoded)
        this.pos += 3
      } else {
        name += String.fromCharCode(b)
        this.pos++
      }
    }
    this.text = name
  }

  private readLiteralString(): void {
    const data = this.data
    const out: number[] = []
    let depth = 1
    while (this.pos < data.length) {
      const b = data[this.pos]!
      if (b === 0x5C) { // '\'
        const e = data[this.pos + 1]
        this.pos += 2
        switch (e) {
          case 0x6E: out.push(0x0A); break // \n
          case 0x72: out.push(0x0D); break // \r
          case 0x74: out.push(0x09); break // \t
          case 0x62: out.push(0x08); break // \b
          case 0x66: out.push(0x0C); break // \f
          case 0x28: out.push(0x28); break // \(
          case 0x29: out.push(0x29); break // \)
          case 0x5C: out.push(0x5C); break // \\
          case 0x0D: // Line continuation (CRLF or CR)
            if (data[this.pos] === 0x0A) this.pos++
            break
          case 0x0A: // Line continuation (LF)
            break
          default: {
            // Octal \ddd (1-3 digits)
            if (e !== undefined && e >= 0x30 && e <= 0x37) {
              let v = e - 0x30
              for (let i = 0; i < 2; i++) {
                const d = data[this.pos]
                if (d !== undefined && d >= 0x30 && d <= 0x37) {
                  v = v * 8 + (d - 0x30)
                  this.pos++
                } else {
                  break
                }
              }
              out.push(v & 0xFF)
            } else if (e !== undefined) {
              // For undefined escapes, ignore the backslash (§7.3.4.2)
              out.push(e)
            }
            break
          }
        }
      } else if (b === 0x28) {
        depth++
        out.push(b)
        this.pos++
      } else if (b === 0x29) {
        depth--
        if (depth === 0) {
          this.pos++
          this.bytes = new Uint8Array(out)
          return
        }
        out.push(b)
        this.pos++
      } else if (b === 0x0D) {
        out.push(0x0A)
        this.pos++
        if (data[this.pos] === 0x0A) this.pos++
      } else if (b === 0x0A) {
        out.push(0x0A)
        this.pos++
      } else {
        out.push(b)
        this.pos++
      }
    }
    throw new Error('PDF parse error: unterminated literal string')
  }

  private readHexString(): void {
    const data = this.data
    const out: number[] = []
    let hi = -1
    let digitCount = 0
    while (this.pos < data.length) {
      const b = data[this.pos]!
      if (b === 0x3E) { // '>'
        this.pos++
        if (hi >= 0) out.push(hi * 16) // An odd digit count is padded with a low-order 0 (§7.3.4.3)
        this.bytes = new Uint8Array(out)
        this.stringIsHex = true
        this.stringHexDigitCount = digitCount
        return
      }
      const h = hexDigit(b)
      if (h >= 0) {
        digitCount++
        if (hi < 0) {
          hi = h
        } else {
          out.push(hi * 16 + h)
          hi = -1
        }
      } else if (!isWhitespace(b)) {
        throw new Error(`PDF parse error: invalid hex string char at offset ${this.pos}`)
      }
      this.pos++
    }
    throw new Error('PDF parse error: unterminated hex string')
  }

  private readNumber(): void {
    const data = this.data
    const start = this.pos
    let digitCount = 0
    let dotCount = 0
    if (data[this.pos] === 0x2B || data[this.pos] === 0x2D) this.pos++
    while (this.pos < data.length) {
      const b = data[this.pos]!
      if (b >= 0x30 && b <= 0x39) {
        digitCount++
        this.pos++
      } else if (b === 0x2E) {
        dotCount++
        if (dotCount > 1) throw new Error(`PDF parse error: invalid number at offset ${start}`)
        this.pos++
      } else {
        break
      }
    }
    let s = ''
    for (let i = start; i < this.pos; i++) {
      s += String.fromCharCode(data[i]!)
    }
    this.num = Number(s)
    if (digitCount === 0 || !Number.isFinite(this.num)) {
      throw new Error(`PDF parse error: invalid number "${s}" at offset ${start}`)
    }
    if (dotCount === 0 && !Number.isSafeInteger(this.num)) {
      throw new Error(`PDF parse error: integer is outside the exact numeric range at offset ${start}`)
    }
    this.type = dotCount === 0 ? TokType.Int : TokType.Real
  }

  private readKeyword(): void {
    const data = this.data
    let s = ''
    while (this.pos < data.length && isRegular(data[this.pos]!)) {
      s += String.fromCharCode(data[this.pos]!)
      this.pos++
    }
    this.text = s
  }
}

const EMPTY_BYTES = new Uint8Array(0)

// ─── xref entries ───

const enum XrefType { Free, Normal, Compressed }

interface XrefEntry {
  type: XrefType
  /** Normal: file offset / Compressed: ObjStm object number */
  field1: number
  /** Normal: generation number / Compressed: index within the ObjStm */
  field2: number
}

// ─── PDF document ───

interface ObjStmContent {
  ids: number[]
  offsets: number[]
  data: Uint8Array
  first: number
}

export interface PdfParseOptions {
  password?: string
  /**
   * Recipient credential for public-key-encrypted PDFs (/Filter
   * /Adobe.PubSec): the recipient's DER-encoded X.509 certificate and RSA or
   * EC private key. The file key is recovered from the /Recipients CMS envelopes.
   */
  recipient?: PubSecCredential
  /** Resolves a file specification used by an external-file stream dictionary. */
  externalFileResolver?: (fileSpecification: PdfValue) => Uint8Array
}

export class PdfDocument {
  private readonly data: Uint8Array
  /** In-file offset of the "%PDF-" header (correction base when leading garbage is present) */
  private readonly base: number
  private readonly xref = new Map<number, XrefEntry>()
  private readonly objectCache = new Map<number, PdfValue>()
  private readonly objStmCache = new Map<number, ObjStmContent>()
  private readonly resolvingObjects = new Set<number>()
  private readonly pdfaLexicalViolations: string[] = []
  private readonly pdfa1LexicalViolations: string[] = []
  private readonly xrefSections: Array<{ offset: number, trailer: PdfDict }> = []
  private containsXrefStream = false
  private decryptCtx: DecryptionContext | null = null
  private encryptObjNum = -1
  private readonly externalFileResolver: ((fileSpecification: PdfValue) => Uint8Array) | undefined
  /** Version declared by the file header before any catalog /Version override. */
  readonly headerVersion: string
  /** Trailer dictionary of the newest (first) xref section */
  readonly trailer: PdfDict

  private constructor(
    data: Uint8Array,
    base: number,
    headerVersion: string,
    trailer: PdfDict,
    externalFileResolver?: (fileSpecification: PdfValue) => Uint8Array,
  ) {
    this.data = data
    this.base = base
    this.headerVersion = headerVersion
    this.trailer = trailer
    this.externalFileResolver = externalFileResolver
  }

  /** Parse a PDF binary */
  static parse(bytes: Uint8Array, options: PdfParseOptions = {}): PdfDocument {
    const header = readPdfHeader(bytes)

    const startxref = readStartXref(bytes)
    const doc = new PdfDocument(bytes, header.base, header.version, new Map(), options.externalFileResolver)
    const trailer = doc.loadXrefChain(startxref)
    // trailer is readonly, so transfer the Map contents into it
    for (const [k, v] of trailer) {
      doc.trailer.set(k, v)
    }
    doc.initializeDecryption(options.password ?? '', options.recipient ?? null)
    return doc
  }

  // ─── Public API ───

  /** Resolve an indirect reference (any other value is returned as-is) */
  resolve(value: PdfValue): PdfValue {
    if (value instanceof PdfRef) {
      return this.getObject(value.num, value.gen)
    }
    return value
  }

  /** Get an object by object number (free/undefined yields null) */
  getObject(num: number, generation?: number): PdfValue {
    const entry = this.xref.get(num)
    if (!entry || entry.type === XrefType.Free) {
      this.objectCache.set(num, null)
      return null
    }
    const actualGeneration = entry.type === XrefType.Normal ? entry.field2 : 0
    if (generation !== undefined && generation !== actualGeneration) return null
    if (this.objectCache.has(num)) return this.objectCache.get(num)!
    if (this.resolvingObjects.has(num)) throw new Error(`PDF parse error: circular indirect object resolution at ${num} ${actualGeneration} R`)

    this.resolvingObjects.add(num)
    try {
      let value: PdfValue
      if (entry.type === XrefType.Normal) {
        value = this.parseIndirectObjectAt(this.base + entry.field1, num, entry.field2)
      } else {
        value = this.parseCompressedObject(entry.field1, entry.field2, num)
      }
      this.objectCache.set(num, value)
      return value
    } finally {
      this.resolvingObjects.delete(num)
    }
  }

  /** Return the active cross-reference generation, including a free entry's next generation. */
  getObjectGeneration(num: number): number | null {
    const entry = this.xref.get(num)
    if (entry === undefined) return null
    return entry.type === XrefType.Compressed ? 0 : entry.field2
  }

  /** Return every active in-use indirect object reference in object-number order. */
  getObjectReferences(): PdfRef[] {
    const references: PdfRef[] = []
    for (const [num, entry] of this.xref) {
      if (num === 0 || entry.type === XrefType.Free) continue
      references.push(new PdfRef(num, entry.type === XrefType.Normal ? entry.field2 : 0))
    }
    references.sort(function (a, b) { return a.num - b.num })
    return references
  }

  /** Return physical-file lexical deviations that PDF/A makes non-conforming. */
  getPdfALexicalViolations(): readonly string[] {
    return this.pdfaLexicalViolations.slice()
  }

  /** Return physical-file lexical deviations specific to ISO 19005-1. */
  getPdfA1LexicalViolations(): readonly string[] {
    return this.pdfa1LexicalViolations.slice()
  }

  /** Return the parsed xref-section trailers in newest-to-oldest chain order. */
  getXrefSections(): ReadonlyArray<{ offset: number, trailer: PdfDict }> {
    return this.xrefSections.map(function (section) {
      return { offset: section.offset, trailer: new Map(section.trailer) }
    })
  }

  /** Whether any primary or hybrid cross-reference section is a stream. */
  hasXrefStreams(): boolean {
    return this.containsXrefStream
  }

  /** Whether the active cross-reference map addresses any compressed object. */
  hasObjectStreams(): boolean {
    for (const entry of this.xref.values()) {
      if (entry.type === XrefType.Compressed) return true
    }
    return false
  }

  /** Whether the active cross-reference entry marks this object number free. */
  isObjectFree(num: number): boolean {
    return this.xref.get(num)?.type === XrefType.Free
  }

  /** Return the next object number stored in a free cross-reference entry. */
  getFreeObjectNext(num: number): number | null {
    const entry = this.xref.get(num)
    return entry?.type === XrefType.Free ? entry.field1 : null
  }

  /** Get the catalog (Document Catalog) */
  getCatalog(): PdfDict {
    const root = this.resolve(this.trailer.get('Root') ?? null)
    if (!(root instanceof Map)) {
      throw new Error('PDF parse error: /Root catalog not found in trailer')
    }
    return root
  }

  /** Apply the stream's filters and return the decoded data */
  decodeStream(stream: PdfStream): Uint8Array {
    const externalFile = this.resolve(stream.dict.get('F') ?? null)
    let data = stream.raw
    let filterVal: PdfValue
    let parmsVal: PdfValue
    if (externalFile !== null) {
      if (this.externalFileResolver === undefined) {
        throw new Error('PDF parse error: external-file stream requires externalFileResolver')
      }
      data = this.externalFileResolver(externalFile)
      filterVal = this.resolve(stream.dict.get('FFilter') ?? null)
      parmsVal = this.resolve(stream.dict.get('FDecodeParms') ?? null)
    } else {
      filterVal = this.resolve(stream.dict.get('Filter') ?? null)
      parmsVal = this.resolve(stream.dict.get('DecodeParms') ?? stream.dict.get('DP') ?? null)
    }
    if (filterVal === null) return data

    const filters: PdfName[] = []
    if (filterVal instanceof PdfName) {
      filters.push(filterVal)
    } else if (Array.isArray(filterVal)) {
      for (let i = 0; i < filterVal.length; i++) {
        const f = this.resolve(filterVal[i]!)
        if (!(f instanceof PdfName)) {
          throw new Error('PDF parse error: /Filter array must contain names')
        }
        filters.push(f)
      }
    } else {
      throw new Error('PDF parse error: invalid /Filter value')
    }
    for (let i = 0; i < filters.length; i++) {
      if (filters[i]!.name !== 'Crypt') continue
      if (i !== 0) throw new Error('PDF parse error: Crypt must be the first stream filter')
      for (let later = i + 1; later < filters.length; later++) {
        if (filters[later]!.name === 'Crypt') throw new Error('PDF parse error: Crypt stream filter must occur only once')
      }
      const type = this.resolve(stream.dict.get('Type') ?? null)
      if (type instanceof PdfName && type.name === 'XRef') {
        throw new Error('PDF parse error: a cross-reference stream must not use the Crypt filter')
      }
    }

    const parmsList: (PdfDict | null)[] = []
    if (parmsVal instanceof Map) {
      if (filters.length !== 1) throw new Error('PDF parse error: a filter array requires a matching DecodeParms array')
      parmsList.push(parmsVal)
    } else if (Array.isArray(parmsVal)) {
      if (parmsVal.length !== filters.length) throw new Error('PDF parse error: DecodeParms array length must match Filter array length')
      for (let i = 0; i < parmsVal.length; i++) {
        const p = this.resolve(parmsVal[i]!)
        if (p !== null && !(p instanceof Map)) throw new Error('PDF parse error: DecodeParms array entries must be dictionaries or null')
        parmsList.push(p instanceof Map ? p : null)
      }
    } else if (parmsVal !== null) {
      throw new Error('PDF parse error: DecodeParms must be a dictionary, array, or null')
    }

    for (let i = 0; i < filters.length; i++) {
      const name = filters[i]!.name
      const parms = parmsList[i] ?? null
      if (name === 'FlateDecode' || name === 'Fl') {
        data = zlibInflate(data)
        data = this.applyPredictor(data, parms)
      } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
        data = decodeAsciiHex(data)
      } else if (name === 'ASCII85Decode' || name === 'A85') {
        data = decodeAscii85(data)
      } else if (name === 'RunLengthDecode' || name === 'RL') {
        data = decodeRunLength(data)
      } else if (name === 'LZWDecode' || name === 'LZW') {
        data = decodeLzw(data, parms)
        data = this.applyPredictor(data, parms)
      } else if (name === 'CCITTFaxDecode' || name === 'CCF') {
        data = decodeCcittFax(data, parms)
      } else if (name === 'Crypt') {
        data = decodeCryptFilter(data, parms, this.decryptCtx, stream.objNum, stream.genNum)
      } else {
        throw new Error(`PDF parse error: unsupported stream filter /${name}`)
      }
    }
    return data
  }

  // ─── xref loading ───

  private loadXrefChain(startOffset: number): PdfDict {
    let offset = startOffset
    const visited = new Set<number>()
    let firstTrailer: PdfDict | null = null

    while (offset >= 0) {
      const sectionOffset = offset
      if (visited.has(offset)) {
        throw new Error('PDF parse error: circular xref chain')
      }
      visited.add(offset)

      if (!Number.isSafeInteger(offset) || offset < 0 || this.base + offset >= this.data.length) {
        throw new Error(`PDF parse error: xref offset ${offset} is outside the file`)
      }
      const lexer = new Lexer(this.data, this.base + offset)
      lexer.skipWhitespace()
      const save = lexer.pos
      const tok = lexer.next()

      let sectionDict: PdfDict
      if (tok === TokType.Keyword && lexer.text === 'xref') {
        const eolLength = pdfEolLengthAt(this.data, lexer.pos)
        if (eolLength === 0 || pdfEolLengthAt(this.data, lexer.pos + eolLength) !== 0) {
          this.pdfaLexicalViolations.push(`xref keyword at offset ${lexer.tokenStart} is not followed by exactly one EOL marker`)
        }
        sectionDict = this.loadClassicXrefSection(lexer)
      } else {
        lexer.pos = save
        sectionDict = this.loadXrefStreamAt(lexer.pos)
      }

      if (!firstTrailer) firstTrailer = sectionDict
      this.xrefSections.push({ offset: sectionOffset, trailer: sectionDict })

      const prev = sectionDict.get('Prev')
      if (prev === undefined) {
        offset = -1
      } else if (typeof prev === 'number' && Number.isSafeInteger(prev) && prev >= 0) {
        offset = prev
      } else {
        throw new Error('PDF parse error: trailer /Prev must be a non-negative integer')
      }
    }

    if (!firstTrailer) {
      throw new Error('PDF parse error: no xref section found')
    }
    const size = requireInt(firstTrailer.get('Size') ?? null, '/Size')
    this.validateXrefEntries(size)
    return firstTrailer
  }

  private validateXrefEntries(size: number): void {
    if (size <= 0) throw new Error('PDF parse error: /Size must be positive')
    const zero = this.xref.get(0)
    if (zero === undefined || zero.type !== XrefType.Free || zero.field2 !== 0xFFFF) {
      throw new Error('PDF parse error: object 0 must be a free xref entry with generation 65535')
    }
    for (const [num, entry] of this.xref) {
      if (num < 0 || num >= size) throw new Error(`PDF parse error: xref object number ${num} is outside /Size ${size}`)
      if (entry.type !== XrefType.Compressed && (entry.field2 < 0 || entry.field2 > 0xFFFF)) {
        throw new Error(`PDF parse error: xref generation for object ${num} is outside 0..65535`)
      }
      if (entry.type === XrefType.Free && (entry.field1 < 0 || entry.field1 >= size)) {
        throw new Error(`PDF parse error: free xref entry ${num} links outside /Size ${size}`)
      }
    }
    const visited = new Set<number>([0])
    let next = zero.field1
    while (next !== 0) {
      if (visited.has(next)) throw new Error(`PDF parse error: circular free xref list at object ${next}`)
      visited.add(next)
      const entry = this.xref.get(next)
      if (entry === undefined || entry.type !== XrefType.Free) {
        throw new Error(`PDF parse error: free xref list links to in-use object ${next}`)
      }
      if (entry.field2 === 0xFFFF) throw new Error(`PDF parse error: permanently free object ${next} appears in the reusable free list`)
      next = entry.field1
    }
  }

  /**
   * Load a classic xref table section and return the trailer dictionary.
   *
   * hybrid-reference file (/XRefStm) support:
   * Within a single section, precedence is "classic in-use > XRefStm > classic free".
   * Across sections (incremental update), the newer section wins (first come, first served).
   */
  private loadClassicXrefSection(lexer: Lexer): PdfDict {
    const freeNums: number[] = []

    for (;;) {
      const tok = lexer.next()
      if (tok === TokType.Keyword && lexer.text === 'trailer') {
        break
      }
      if (tok !== TokType.Int) {
        throw new Error(`PDF parse error: invalid xref subsection at offset ${lexer.pos}`)
      }
      const start = lexer.num
      const startEnd = lexer.pos
      if (lexer.next() !== TokType.Int) {
        throw new Error(`PDF parse error: invalid xref subsection count at offset ${lexer.pos}`)
      }
      if (lexer.tokenStart !== startEnd + 1 || this.data[startEnd] !== 0x20) {
        this.pdfa1LexicalViolations.push(`xref subsection header at offset ${startEnd} does not separate its two integers with exactly one SPACE byte`)
      }
      const count = lexer.num
      if (start < 0 || count < 0) throw new Error('PDF parse error: xref subsection start and count must be non-negative')
      for (let i = 0; i < count; i++) {
        if (lexer.next() !== TokType.Int) {
          throw new Error(`PDF parse error: invalid xref entry at offset ${lexer.pos}`)
        }
        const f1 = lexer.num
        if (lexer.next() !== TokType.Int) {
          throw new Error(`PDF parse error: invalid xref entry at offset ${lexer.pos}`)
        }
        const f2 = lexer.num
        if (lexer.next() !== TokType.Keyword || (lexer.text !== 'n' && lexer.text !== 'f')) {
          throw new Error(`PDF parse error: invalid xref entry type at offset ${lexer.pos}`)
        }
        const num = start + i
        if (lexer.text === 'n') {
          if (f1 < 0 || f2 < 0 || f2 > 0xFFFF) throw new Error(`PDF parse error: invalid in-use xref entry for object ${num}`)
          if (!this.xref.has(num)) {
            this.xref.set(num, { type: XrefType.Normal, field1: f1, field2: f2 })
          }
        } else {
          if (f1 < 0 || f2 < 0 || f2 > 0xFFFF) throw new Error(`PDF parse error: invalid free xref entry for object ${num}`)
          freeNums.push(num, f1, f2)
        }
      }
    }

    const parser = new ObjectParser(this, lexer)
    const trailer = parser.parseValue()
    if (!(trailer instanceof Map)) {
      throw new Error('PDF parse error: trailer dictionary not found')
    }

    // hybrid-reference: /XRefStm entries take precedence over classic free entries
    const xrefStm = trailer.get('XRefStm')
    if (xrefStm !== undefined && (typeof xrefStm !== 'number' || !Number.isSafeInteger(xrefStm) || xrefStm < 0)) {
      throw new Error('PDF parse error: trailer /XRefStm must be a non-negative integer')
    }
    if (typeof xrefStm === 'number') {
      this.loadXrefStreamAt(this.base + xrefStm)
    }

    for (let i = 0; i < freeNums.length; i += 3) {
      const num = freeNums[i]!
      if (!this.xref.has(num)) {
        this.xref.set(num, { type: XrefType.Free, field1: freeNums[i + 1]!, field2: freeNums[i + 2]! })
      }
    }

    return trailer
  }

  /** Load a cross-reference stream and return its stream dictionary (trailer equivalent) */
  private loadXrefStreamAt(absPos: number): PdfDict {
    this.containsXrefStream = true
    const obj = this.parseIndirectObjectAt(absPos, -1)
    if (!(obj instanceof PdfStream)) {
      throw new Error('PDF parse error: cross-reference stream expected')
    }
    const dict = obj.dict
    const typeName = dict.get('Type')
    if (!(typeName instanceof PdfName) || typeName.name !== 'XRef') {
      throw new Error('PDF parse error: /Type /XRef expected in cross-reference stream')
    }

    const wVal = this.resolve(dict.get('W') ?? null)
    if (!Array.isArray(wVal) || wVal.length < 3) {
      throw new Error('PDF parse error: invalid /W in cross-reference stream')
    }
    const w0 = requireInt(this.resolve(wVal[0]!), '/W[0]')
    const w1 = requireInt(this.resolve(wVal[1]!), '/W[1]')
    const w2 = requireInt(this.resolve(wVal[2]!), '/W[2]')
    const entrySize = w0 + w1 + w2
    if (w0 < 0 || w1 < 0 || w2 < 0 || entrySize === 0) throw new Error('PDF parse error: /W widths must be non-negative and not all zero')

    const size = requireInt(this.resolve(dict.get('Size') ?? null), '/Size')
    if (size <= 0) throw new Error('PDF parse error: cross-reference stream /Size must be positive')

    let index: number[] = [0, size]
    const indexVal = this.resolve(dict.get('Index') ?? null)
    if (Array.isArray(indexVal)) {
      index = []
      for (let i = 0; i < indexVal.length; i++) {
        index.push(requireInt(this.resolve(indexVal[i]!), '/Index'))
      }
    }
    if ((index.length & 1) !== 0) throw new Error('PDF parse error: cross-reference stream /Index must contain pairs')
    const indexedObjects = new Set<number>()
    for (let i = 0; i < index.length; i += 2) {
      const start = index[i]!
      const count = index[i + 1]!
      if (start < 0 || count < 0 || start + count > size) throw new Error('PDF parse error: cross-reference stream /Index is outside /Size')
      for (let object = start; object < start + count; object++) {
        if (indexedObjects.has(object)) throw new Error(`PDF parse error: overlapping cross-reference stream /Index at object ${object}`)
        indexedObjects.add(object)
      }
    }

    const data = this.decodeStream(obj)

    let pos = 0
    for (let si = 0; si + 1 < index.length; si += 2) {
      const start = index[si]!
      const count = index[si + 1]!
      for (let i = 0; i < count; i++) {
        if (pos + entrySize > data.length) {
          throw new Error('PDF parse error: cross-reference stream data too short')
        }
        // type: when the width is 0, the default is 1 (§7.5.8.3)
        let type = 1
        if (w0 > 0) type = readBE(data, pos, w0)
        const f1 = w1 > 0 ? readBE(data, pos + w0, w1) : 0
        const f2 = w2 > 0 ? readBE(data, pos + w0 + w1, w2) : 0
        pos += entrySize

        const num = start + i
        if (!this.xref.has(num)) {
          if (type === 0) {
            if (f1 < 0 || f1 >= size || f2 > 0xFFFF) throw new Error(`PDF parse error: invalid free xref stream entry for object ${num}`)
            this.xref.set(num, { type: XrefType.Free, field1: f1, field2: f2 })
          } else if (type === 1) {
            if (f2 > 0xFFFF) throw new Error(`PDF parse error: invalid xref stream generation for object ${num}`)
            this.xref.set(num, { type: XrefType.Normal, field1: f1, field2: f2 })
          } else if (type === 2) {
            if (f1 <= 0) throw new Error(`PDF parse error: invalid object stream number for compressed object ${num}`)
            this.xref.set(num, { type: XrefType.Compressed, field1: f1, field2: f2 })
          }
          // type > 2 is ignored as "reference is null" (§7.5.8.3: future extension)
        }
      }
    }

    return dict
  }

  // ─── Object parsing ───

  /** Parse an indirect object (N G obj ... endobj) at an absolute file offset */
  private parseIndirectObjectAt(absPos: number, expectedNum: number, expectedGeneration = -1): PdfValue {
    const lexer = new Lexer(this.data, absPos)
    if (lexer.next() !== TokType.Int) {
      throw new Error(`PDF parse error: object number expected at offset ${absPos}`)
    }
    const objectNumberStart = lexer.tokenStart
    const objectNumberEnd = lexer.pos
    if (!pdfEolImmediatelyBefore(this.data, objectNumberStart)) {
      this.pdfaLexicalViolations.push(`object number at offset ${objectNumberStart} is not preceded by an EOL marker`)
    }
    const num = lexer.num
    if (num <= 0) throw new Error(`PDF parse error: invalid indirect object number ${num} at offset ${absPos}`)
    if (expectedNum >= 0 && num !== expectedNum) {
      throw new Error(`PDF parse error: object number mismatch at offset ${absPos} (expected ${expectedNum}, found ${num})`)
    }
    if (lexer.next() !== TokType.Int) {
      throw new Error(`PDF parse error: generation number expected at offset ${absPos}`)
    }
    if (!pdfSingleWhitespaceBetween(this.data, objectNumberEnd, lexer.tokenStart)) {
      this.pdfaLexicalViolations.push(`object ${num} number and generation are not separated by one whitespace byte`)
    }
    const generationEnd = lexer.pos
    const genNum = lexer.num
    if (genNum < 0 || genNum > 0xFFFF) throw new Error(`PDF parse error: invalid generation number ${genNum} at offset ${absPos}`)
    if (expectedGeneration >= 0 && genNum !== expectedGeneration) {
      throw new Error(`PDF parse error: generation mismatch at offset ${absPos} (expected ${expectedGeneration}, found ${genNum})`)
    }
    if (lexer.next() !== TokType.Keyword || lexer.text !== 'obj') {
      throw new Error(`PDF parse error: "obj" keyword expected at offset ${absPos}`)
    }
    if (!pdfSingleWhitespaceBetween(this.data, generationEnd, lexer.tokenStart)) {
      this.pdfaLexicalViolations.push(`object ${num} generation and obj keyword are not separated by one whitespace byte`)
    }
    if (pdfEolLengthAt(this.data, lexer.pos) === 0) {
      this.pdfaLexicalViolations.push(`object ${num} obj keyword is not followed by an EOL marker`)
    }

    const decryptStrings = this.decryptCtx !== null && num !== this.encryptObjNum
    const parser = new ObjectParser(this, lexer, num, genNum, decryptStrings)
    const value = parser.parseValue()

    lexer.skipWhitespace()
    const save = lexer.pos
    const tok = lexer.next()
    const keyword: string = tok === TokType.Keyword ? lexer.text : ''
    if (keyword === 'stream') {
      if (!(value instanceof Map)) {
        throw new Error(`PDF parse error: stream without dictionary at offset ${absPos}`)
      }
      return this.readStreamData(value, lexer, num, genNum)
    }
    if (keyword === 'endobj') {
      if (!pdfEolImmediatelyBefore(this.data, lexer.tokenStart)) {
        this.pdfaLexicalViolations.push(`object ${num} endobj keyword is not preceded by an EOL marker`)
      }
      if (pdfEolLengthAt(this.data, lexer.pos) === 0) {
        this.pdfaLexicalViolations.push(`object ${num} endobj keyword is not followed by an EOL marker`)
      }
      return value
    }
    // Omitted endobj (a minor deviation where the next object or xref follows) — accept the value as-is
    this.pdfaLexicalViolations.push(`object ${num} omits its endobj keyword`)
    lexer.pos = save
    return value
  }

  /** Read stream data starting immediately after the "stream" keyword */
  private readStreamData(dict: PdfDict, lexer: Lexer, objNum: number, genNum: number): PdfStream {
    const data = this.data
    // The stream keyword is followed by CRLF or LF (§7.3.8.1)
    if (data[lexer.pos] === 0x0D && data[lexer.pos + 1] === 0x0A) lexer.pos += 2
    else if (data[lexer.pos] === 0x0A) lexer.pos++
    else throw new Error('PDF parse error: stream keyword must be followed by LF or CRLF')

    const lengthVal = this.resolve(dict.get('Length') ?? null)
    const dataStart = lexer.pos
    let dataEnd: number
    // A valid /Length points exactly at the "endstream" keyword. When it does
    // not (a wrong or missing /Length, common in real files), recover by scanning
    // for the "endstream" keyword and using the byte before it — the same repair
    // real PDF readers perform. The scanned end wins over a bad /Length.
    if (typeof lengthVal === 'number' && Number.isInteger(lengthVal) && lengthVal >= 0
      && dataStart + lengthVal <= data.length
      && streamKeywordFollows(data, dataStart + lengthVal, 'endstream')) {
      dataEnd = dataStart + lengthVal
    } else {
      const found = findEndstream(data, dataStart)
      if (found < 0) {
        throw new Error('PDF parse error: "endstream" keyword not found for stream')
      }
      dataEnd = found
    }

    let endstreamStart = dataEnd
    const beforeEndstream = pdfEolLengthAt(data, endstreamStart)
    if (beforeEndstream === 0) {
      this.pdfaLexicalViolations.push(`object ${objNum} endstream keyword is not preceded by an EOL marker`)
      while (endstreamStart < data.length && isWhitespace(data[endstreamStart]!)) endstreamStart++
    } else {
      endstreamStart += beforeEndstream
    }
    if (!pdfKeywordAt(data, endstreamStart, 'endstream')) {
      while (endstreamStart < data.length && isWhitespace(data[endstreamStart]!)) endstreamStart++
    }
    const afterEndstream = endstreamStart + 'endstream'.length
    const endstreamEolLength = pdfEolLengthAt(data, afterEndstream)
    if (!pdfKeywordAt(data, endstreamStart, 'endstream') || endstreamEolLength === 0) {
      this.pdfaLexicalViolations.push(`object ${objNum} endstream keyword is not followed by an EOL marker`)
    } else {
      const endobjStart = afterEndstream + endstreamEolLength
      if (!pdfKeywordAt(data, endobjStart, 'endobj')) {
        this.pdfaLexicalViolations.push(`object ${objNum} endobj keyword is not immediately preceded by its EOL marker`)
      } else if (pdfEolLengthAt(data, endobjStart + 'endobj'.length) === 0) {
        this.pdfaLexicalViolations.push(`object ${objNum} endobj keyword is not followed by an EOL marker`)
      }
    }

    let raw = data.subarray(dataStart, dataEnd)
    if (this.shouldDecryptStream(dict)) {
      const type = dict.get('Type')
      raw = this.decryptCtx!.decryptStream(
        objNum,
        genNum,
        raw,
        type instanceof PdfName && type.name === 'EmbeddedFile',
      )
    }
    return new PdfStream(dict, raw, objNum, genNum)
  }

  /** Parse an object inside an object stream */
  private parseCompressedObject(objStmNum: number, index: number, expectedNum: number): PdfValue {
    let content = this.objStmCache.get(objStmNum)
    if (!content) {
      const objStmEntry = this.xref.get(objStmNum)
      if (objStmEntry === undefined || objStmEntry.type !== XrefType.Normal || objStmEntry.field2 !== 0) {
        throw new Error(`PDF parse error: object stream ${objStmNum} must be an uncompressed generation-0 object`)
      }
      const stm = this.getObject(objStmNum, 0)
      if (!(stm instanceof PdfStream)) {
        throw new Error(`PDF parse error: object stream ${objStmNum} not found`)
      }
      const typeName = stm.dict.get('Type')
      if (!(typeName instanceof PdfName) || typeName.name !== 'ObjStm') {
        throw new Error(`PDF parse error: object ${objStmNum} is not /Type /ObjStm`)
      }
      const n = requireInt(this.resolve(stm.dict.get('N') ?? null), '/N')
      const first = requireInt(this.resolve(stm.dict.get('First') ?? null), '/First')
      if (n < 0 || first < 0) throw new Error(`PDF parse error: object stream ${objStmNum} /N and /First must be non-negative`)
      const decoded = this.decodeStream(stm)
      if (first > decoded.length) throw new Error(`PDF parse error: object stream ${objStmNum} /First exceeds decoded data`)
      this.validateObjectStreamExtends(objStmNum, stm)

      const ids: number[] = []
      const offsets: number[] = []
      const idSet = new Set<number>()
      const headerLexer = new Lexer(decoded, 0)
      for (let i = 0; i < n; i++) {
        if (headerLexer.next() !== TokType.Int) {
          throw new Error(`PDF parse error: invalid object stream header in ${objStmNum}`)
        }
        const id = headerLexer.num
        if (id <= 0 || idSet.has(id)) throw new Error(`PDF parse error: invalid or duplicate object number ${id} in object stream ${objStmNum}`)
        idSet.add(id)
        ids.push(id)
        if (headerLexer.next() !== TokType.Int) {
          throw new Error(`PDF parse error: invalid object stream header in ${objStmNum}`)
        }
        const objectOffset = headerLexer.num
        if (objectOffset < 0 || (i === 0 ? objectOffset !== 0 : objectOffset <= offsets[i - 1]!)) {
          throw new Error(`PDF parse error: object offsets must be strictly increasing from zero in object stream ${objStmNum}`)
        }
        offsets.push(objectOffset)
      }
      headerLexer.skipWhitespace()
      if (headerLexer.pos > first) throw new Error(`PDF parse error: object stream ${objStmNum} /First overlaps its header`)
      if (n > 0 && first + offsets[n - 1]! >= decoded.length) throw new Error(`PDF parse error: object offset exceeds object stream ${objStmNum}`)
      content = { ids, offsets, data: decoded, first }
      this.objStmCache.set(objStmNum, content)
    }

    if (index < 0 || index >= content.ids.length) {
      throw new Error(`PDF parse error: object stream index ${index} out of range in ${objStmNum}`)
    }
    if (content.ids[index] !== expectedNum) {
      throw new Error(`PDF parse error: object number mismatch in object stream ${objStmNum} (expected ${expectedNum}, found ${content.ids[index]})`)
    }

    const lexer = new Lexer(content.data, content.first + content.offsets[index]!)
    const parser = new ObjectParser(this, lexer, expectedNum, 0, false)
    const value = parser.parseValue()
    if (value instanceof PdfRef) throw new Error(`PDF parse error: compressed object ${expectedNum} cannot consist only of an indirect reference`)
    const end = index + 1 < content.offsets.length
      ? content.first + content.offsets[index + 1]!
      : content.data.length
    lexer.skipWhitespace()
    if (lexer.pos !== end) throw new Error(`PDF parse error: trailing data in compressed object ${expectedNum}`)
    return value
  }

  private validateObjectStreamExtends(objStmNum: number, stream: PdfStream): void {
    const visited = new Set<number>([objStmNum])
    let current = stream
    for (;;) {
      const extendsValue = current.dict.get('Extends')
      if (extendsValue === undefined) return
      if (!(extendsValue instanceof PdfRef)) throw new Error('PDF parse error: object stream /Extends must be an indirect reference')
      if (visited.has(extendsValue.num)) throw new Error(`PDF parse error: circular object stream /Extends graph at ${extendsValue.num}`)
      visited.add(extendsValue.num)
      const next = this.getObject(extendsValue.num, extendsValue.gen)
      if (!(next instanceof PdfStream)) throw new Error(`PDF parse error: object stream /Extends target ${extendsValue.num} is not a stream`)
      const type = next.dict.get('Type')
      if (!(type instanceof PdfName) || type.name !== 'ObjStm') {
        throw new Error(`PDF parse error: object stream /Extends target ${extendsValue.num} is not /Type /ObjStm`)
      }
      current = next
    }
  }

  decryptStringBytes(objNum: number, genNum: number, data: Uint8Array, decrypt: boolean): Uint8Array {
    if (!decrypt || !this.decryptCtx) return data
    return this.decryptCtx.decryptString(objNum, genNum, data)
  }

  private shouldDecryptStream(dict: PdfDict): boolean {
    if (!this.decryptCtx) return false
    const type = dict.get('Type')
    if (type instanceof PdfName && type.name === 'XRef') return false
    const filter = dict.get('Filter')
    if (filter instanceof PdfName && filter.name === 'Crypt') return false
    if (Array.isArray(filter)) {
      for (let i = 0; i < filter.length; i++) {
        const name = this.resolve(filter[i]!)
        if (name instanceof PdfName && name.name === 'Crypt') return false
      }
    }
    if (!this.decryptCtx.encryptMetadata && type instanceof PdfName && type.name === 'Metadata') return false
    return true
  }

  private initializeDecryption(password: string, recipient: PubSecCredential | null): void {
    const encryptValue = this.trailer.get('Encrypt')
    if (encryptValue === undefined || encryptValue === null) return
    if (encryptValue instanceof PdfName && encryptValue.name === 'Identity') return
    if (!(encryptValue instanceof PdfRef)) {
      throw new Error('PDF parse error: /Encrypt must be an indirect reference')
    }
    this.encryptObjNum = encryptValue.num
    const encryptDict = this.getObject(encryptValue.num, encryptValue.gen)
    if (!(encryptDict instanceof Map)) {
      throw new Error('PDF parse error: /Encrypt object must be a dictionary')
    }
    const filter = encryptDict.get('Filter')
    if (filter instanceof PdfName && filter.name === 'Adobe.PubSec') {
      this.initializePubSecDecryption(encryptDict, recipient)
      return
    }
    if (!(filter instanceof PdfName) || filter.name !== 'Standard') {
      throw new Error('PDF parse error: only /Standard and /Adobe.PubSec security handlers are supported')
    }

    const version = requireInt(this.resolve(encryptDict.get('V') ?? null), '/Encrypt /V')
    const revision = requireInt(this.resolve(encryptDict.get('R') ?? null), '/Encrypt /R')
    const lengthVal = this.resolve(encryptDict.get('Length') ?? null)
    const lengthBits = typeof lengthVal === 'number' ? lengthVal : revision <= 2 ? 40 : 128
    this.validateStandardSecurityParameters(version, revision, lengthBits)
    const oValue = requireStringBytes(this.resolve(encryptDict.get('O') ?? null), '/Encrypt /O')
    const uValue = requireStringBytes(this.resolve(encryptDict.get('U') ?? null), '/Encrypt /U')
    const pValue = requireInt(this.resolve(encryptDict.get('P') ?? null), '/Encrypt /P')
    const idArray = this.resolve(this.trailer.get('ID') ?? null)
    if (!Array.isArray(idArray) || idArray.length === 0) {
      throw new Error('PDF parse error: encrypted PDF trailer must contain /ID')
    }
    const fileId = requireStringBytes(this.resolve(idArray[0]!), 'trailer /ID[0]')
    const encryptMetadataValue = this.resolve(encryptDict.get('EncryptMetadata') ?? null)
    const encryptMetadata = typeof encryptMetadataValue === 'boolean' ? encryptMetadataValue : true
    const cryptFilters = this.resolveStandardCryptFilters(encryptDict, version)
    const cipher = this.resolveStandardCipher(encryptDict, version, revision, cryptFilters)
    const stringCipher = version >= 4
      ? this.resolveNamedCryptFilter(encryptDict, 'StrF', version === 5 ? 'StdCF' : 'Identity', cryptFilters)
      : cipher
    const embeddedFileCipher = version >= 4 && encryptDict.has('EFF')
      ? this.resolveNamedCryptFilter(encryptDict, 'EFF', 'Identity', cryptFilters)
      : cipher

    const params: StandardSecurityParams = {
      version,
      revision,
      lengthBits,
      oValue,
      uValue,
      pValue,
      fileId,
      cipher,
      stringCipher,
      embeddedFileCipher,
      cryptFilters,
      encryptMetadata,
    }
    const ueValue = this.resolve(encryptDict.get('UE') ?? null)
    if (ueValue !== null) params.ueValue = requireStringBytes(ueValue, '/Encrypt /UE')
    const oeValue = this.resolve(encryptDict.get('OE') ?? null)
    if (oeValue !== null) params.oeValue = requireStringBytes(oeValue, '/Encrypt /OE')
    const permsValue = this.resolve(encryptDict.get('Perms') ?? null)
    if (permsValue !== null) params.permsValue = requireStringBytes(permsValue, '/Encrypt /Perms')

    this.decryptCtx = createDecryptionContext(params, password)
  }

  /**
   * Public-key security handler (ISO 32000-1 7.6.4/7.6.5). The file key is
   * recovered from the /Recipients CMS envelopes using the recipient's private
   * key; per-object decryption then uses the crypt filter's cipher exactly as
   * the standard handler does.
   */
  private initializePubSecDecryption(encryptDict: PdfDict, recipient: PubSecCredential | null): void {
    if (recipient === null) {
      throw new Error('PDF parse error: public-key-encrypted PDF requires a recipient credential')
    }
    const version = requireInt(this.resolve(encryptDict.get('V') ?? null), '/Encrypt /V')
    const encryptMetadataValue = this.resolve(encryptDict.get('EncryptMetadata') ?? null)
    const encryptMetadata = typeof encryptMetadataValue === 'boolean' ? encryptMetadataValue : true

    // Collect /Recipients and the cipher. V4/V5 route through a named crypt
    // filter (the recipients live on the filter); V1/V2 put them at top level.
    const cryptFilters = this.resolveStandardCryptFilters(encryptDict, version)
    let cipher: StandardSecurityCipher
    let recipientsValue: PdfValue
    let filterEncryptMetadata = encryptMetadata
    if (version === 4 || version === 5) {
      const name = this.resolveNamedCryptFilterName(encryptDict, 'StmF', 'StdCF')
      cipher = cryptFilters.get(name) ?? 'none'
      const cf = this.resolve(encryptDict.get('CF') ?? null)
      const filterDict = cf instanceof Map ? this.resolve(cf.get(name) ?? null) : null
      if (!(filterDict instanceof Map)) throw new Error(`PDF parse error: PubSec crypt filter /${name} missing`)
      recipientsValue = this.resolve(filterDict.get('Recipients') ?? null)
      const em = this.resolve(filterDict.get('EncryptMetadata') ?? null)
      if (typeof em === 'boolean') filterEncryptMetadata = em
    } else if (version === 1 || version === 2) {
      cipher = 'rc4'
      recipientsValue = this.resolve(encryptDict.get('Recipients') ?? null)
    } else {
      throw new Error(`PDF parse error: unsupported PubSec /V ${version}`)
    }

    const recipients: Uint8Array[] = []
    if (recipientsValue instanceof PdfString) {
      recipients.push(recipientsValue.bytes)
    } else if (Array.isArray(recipientsValue)) {
      for (const r of recipientsValue) {
        const rv = this.resolve(r)
        if (rv instanceof PdfString) recipients.push(rv.bytes)
      }
    }
    if (recipients.length === 0) throw new Error('PDF parse error: PubSec /Recipients is empty')

    const lengthVal = this.resolve(encryptDict.get('Length') ?? null)
    const keyLengthBytes = cipher === 'aesv3' ? 32 : typeof lengthVal === 'number' ? lengthVal / 8 : 16
    const useSha256 = cipher === 'aesv3'
    const fileKey = recoverPubSecFileKey(recipients, recipient, keyLengthBytes, useSha256, filterEncryptMetadata)

    const params: StandardSecurityParams = {
      version,
      revision: version === 5 ? 6 : version === 4 ? 4 : 2,
      lengthBits: keyLengthBytes * 8,
      oValue: new Uint8Array(0),
      uValue: new Uint8Array(0),
      pValue: 0,
      fileId: new Uint8Array(0),
      cipher,
      stringCipher: cipher,
      embeddedFileCipher: version >= 4 && encryptDict.has('EFF')
        ? this.resolveNamedCryptFilter(encryptDict, 'EFF', 'Identity', cryptFilters)
        : cipher,
      cryptFilters,
      encryptMetadata,
    }
    this.decryptCtx = createDecryptionContextWithKey(params, fileKey)
  }

  private resolveNamedCryptFilterName(encryptDict: PdfDict, key: string, fallback: string): string {
    const value = this.resolve(encryptDict.get(key) ?? null)
    return value instanceof PdfName ? value.name : fallback
  }

  private resolveStandardCipher(
    encryptDict: PdfDict,
    version: number,
    revision: number,
    cryptFilters: ReadonlyMap<string, StandardSecurityCipher>,
  ): StandardSecurityCipher {
    // V5 (AES-256, R5 deprecated / R6 ISO 32000-2) selects the cipher through the
    // named crypt filter, defaulting to /StdCF.
    if (revision === 6 || version === 5) return this.resolveNamedCryptFilter(encryptDict, 'StmF', 'StdCF', cryptFilters)
    if (version === 1 || version === 2 || version === 3) return 'rc4'
    if (version !== 4) {
      throw new Error(`PDF parse error: unsupported /Standard security handler V=${version}`)
    }
    return this.resolveNamedCryptFilter(encryptDict, 'StmF', 'Identity', cryptFilters)
  }

  private validateStandardSecurityParameters(version: number, revision: number, lengthBits: number): void {
    if (!Number.isInteger(lengthBits) || lengthBits < 40 || lengthBits > 256 || lengthBits % 8 !== 0) {
      throw new Error(`PDF parse error: invalid Standard security key length ${lengthBits}`)
    }
    if (revision === 2 && (version !== 1 || lengthBits !== 40)) {
      throw new Error('PDF parse error: Standard security R=2 requires V=1 and a 40-bit key')
    }
    if (revision === 3 && (version !== 2 && version !== 3)) {
      throw new Error('PDF parse error: Standard security R=3 requires V=2 or V=3')
    }
    if (revision === 4 && version !== 4) {
      throw new Error('PDF parse error: Standard security R=4 requires V=4')
    }
    if ((revision === 5 || revision === 6) && (version !== 5 || lengthBits !== 256)) {
      throw new Error(`PDF parse error: Standard security R=${revision} requires V=5 and a 256-bit key`)
    }
    if (revision < 2 || revision > 6) {
      throw new Error(`PDF parse error: unsupported Standard security revision ${revision}`)
    }
  }

  private resolveNamedCryptFilter(
    encryptDict: PdfDict,
    key: string,
    defaultName: string,
    cryptFilters: ReadonlyMap<string, StandardSecurityCipher>,
  ): StandardSecurityCipher {
    const value = this.resolve(encryptDict.get(key) ?? null)
    const filterName = value instanceof PdfName ? value.name : defaultName
    if (filterName === 'Identity') return 'none'
    const cipher = cryptFilters.get(filterName)
    if (cipher !== undefined) return cipher
    throw new Error(`PDF parse error: encrypted PDF /CF /${filterName} must be a dictionary`)
  }

  private resolveStandardCryptFilters(encryptDict: PdfDict, version: number): Map<string, StandardSecurityCipher> {
    const filters = new Map<string, StandardSecurityCipher>()
    if (version < 4) return filters
    const stmF = this.resolve(encryptDict.get('StmF') ?? null)
    const cf = this.resolve(encryptDict.get('CF') ?? null)
    if (cf === null) return filters
    if (!(cf instanceof Map)) {
      throw new Error('PDF parse error: encrypted PDF /CF must be a dictionary')
    }
    for (const [name, value] of cf) {
      const dict = this.resolve(value)
      if (!(dict instanceof Map)) {
        throw new Error(`PDF parse error: encrypted PDF /CF /${name} must be a dictionary`)
      }
      const cfm = this.resolve(dict.get('CFM') ?? null)
      if (!(cfm instanceof PdfName)) {
        throw new Error(`PDF parse error: encrypted PDF /CF /${name} /CFM must be a name`)
      }
      filters.set(name, standardCryptFilterCipher(cfm.name))
    }
    return filters
  }

  // ─── Filters ───

  /** Apply the post-FlateDecode predictor (Predictor 2: TIFF, 10-15: PNG) */
  private applyPredictor(data: Uint8Array, parms: PdfDict | null): Uint8Array {
    if (!parms) return data
    const predictorVal = this.resolve(parms.get('Predictor') ?? null)
    if (predictorVal !== null && (typeof predictorVal !== 'number' || !Number.isInteger(predictorVal))) {
      throw new Error('PDF parse error: predictor Predictor must be an integer')
    }
    const predictor = typeof predictorVal === 'number' ? predictorVal : 1
    if (predictor === 1) return data
    const colorsVal = this.resolve(parms.get('Colors') ?? null)
    const bpcVal = this.resolve(parms.get('BitsPerComponent') ?? null)
    const columnsVal = this.resolve(parms.get('Columns') ?? null)
    if (colorsVal !== null && (typeof colorsVal !== 'number' || !Number.isInteger(colorsVal))) {
      throw new Error('PDF parse error: predictor Colors must be an integer')
    }
    if (bpcVal !== null && (typeof bpcVal !== 'number' || !Number.isInteger(bpcVal))) {
      throw new Error('PDF parse error: predictor BitsPerComponent must be an integer')
    }
    if (columnsVal !== null && (typeof columnsVal !== 'number' || !Number.isInteger(columnsVal))) {
      throw new Error('PDF parse error: predictor Columns must be an integer')
    }
    const colors = typeof colorsVal === 'number' ? colorsVal : 1
    const bpc = typeof bpcVal === 'number' ? bpcVal : 8
    const columns = typeof columnsVal === 'number' ? columnsVal : 1
    return applyPdfPredictor(data, predictor, colors, bpc, columns)
  }
}

/** Applies the TIFF or PNG predictor used by FlateDecode and LZWDecode streams. */
export function applyPdfPredictor(data: Uint8Array, predictor: number, colors: number, bpc: number, columns: number): Uint8Array {
  if (predictor === 1) return data
  if (predictor !== 2 && (predictor < 10 || predictor > 15)) {
    throw new Error(`PDF parse error: unsupported predictor ${predictor}`)
  }
  if (!Number.isInteger(colors) || colors <= 0) {
    throw new Error(`PDF parse error: predictor Colors must be a positive integer, got ${colors}`)
  }
  if (!Number.isInteger(bpc) || (bpc !== 1 && bpc !== 2 && bpc !== 4 && bpc !== 8 && bpc !== 16)) {
    throw new Error(`PDF parse error: predictor BitsPerComponent must be one of 1, 2, 4, 8, or 16, got ${bpc}`)
  }
  if (!Number.isInteger(columns) || columns <= 0) {
    throw new Error(`PDF parse error: predictor Columns must be a positive integer, got ${columns}`)
  }

  const bytesPerPixel = Math.max(1, Math.ceil((colors * bpc) / 8))
  const rowLength = Math.ceil((colors * bpc * columns) / 8)
  if (predictor === 2) return applyTiffPredictor(data, colors, bpc, columns, rowLength)

  const sourceRowLength = rowLength + 1
  if (data.length % sourceRowLength !== 0) throw new Error('PDF parse error: PNG predictor data contains a partial row')
  const rows = Math.floor(data.length / sourceRowLength)
  const out = new Uint8Array(rows * rowLength)
  const previousRow = new Uint8Array(rowLength)
  for (let row = 0; row < rows; row++) {
    const filterType = data[row * sourceRowLength]!
    const source = row * sourceRowLength + 1
    const destination = row * rowLength
    for (let index = 0; index < rowLength; index++) {
      const encoded = data[source + index]!
      const left = index >= bytesPerPixel ? out[destination + index - bytesPerPixel]! : 0
      const up = previousRow[index]!
      const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel]! : 0
      if (filterType === 0) out[destination + index] = encoded
      else if (filterType === 1) out[destination + index] = (encoded + left) & 0xFF
      else if (filterType === 2) out[destination + index] = (encoded + up) & 0xFF
      else if (filterType === 3) out[destination + index] = (encoded + ((left + up) >> 1)) & 0xFF
      else if (filterType === 4) {
        const estimate = left + up - upLeft
        const leftDistance = Math.abs(estimate - left)
        const upDistance = Math.abs(estimate - up)
        const upperLeftDistance = Math.abs(estimate - upLeft)
        const prediction = leftDistance <= upDistance && leftDistance <= upperLeftDistance
          ? left
          : upDistance <= upperLeftDistance ? up : upLeft
        out[destination + index] = (encoded + prediction) & 0xFF
      } else {
        throw new Error(`PDF parse error: invalid PNG predictor filter type ${filterType}`)
      }
    }
    previousRow.set(out.subarray(destination, destination + rowLength))
  }
  return out
}

function standardCryptFilterCipher(cfm: string): StandardSecurityCipher {
  if (cfm === 'AESV3') return 'aesv3'
  if (cfm === 'AESV2') return 'aesv2'
  if (cfm === 'V2') return 'rc4'
  if (cfm === 'None') return 'none'
  throw new Error(`PDF parse error: unsupported crypt filter method /${cfm}`)
}

function applyTiffPredictor(data: Uint8Array, colors: number, bpc: number, columns: number, rowLen: number): Uint8Array {
  if (data.length % rowLen !== 0) throw new Error('PDF parse error: TIFF predictor data contains a partial row')
  const fullRowsLen = data.length
  if (bpc === 8) {
    for (let off = 0; off < fullRowsLen; off += rowLen) {
      for (let i = colors; i < rowLen; i++) {
        data[off + i] = (data[off + i]! + data[off + i - colors]!) & 0xFF
      }
    }
    return data
  }

  const componentsPerRow = colors * columns
  if (bpc === 16) {
    for (let off = 0; off < fullRowsLen; off += rowLen) {
      for (let component = colors; component < componentsPerRow; component++) {
        const pos = off + component * 2
        const prevPos = off + (component - colors) * 2
        const value = ((data[pos]! << 8) | data[pos + 1]!) + ((data[prevPos]! << 8) | data[prevPos + 1]!)
        data[pos] = (value >> 8) & 0xFF
        data[pos + 1] = value & 0xFF
      }
    }
    return data
  }

  const out = new Uint8Array(data.length)
  const maxValue = (1 << bpc) - 1
  for (let off = 0; off < fullRowsLen; off += rowLen) {
    const values = new Uint16Array(componentsPerRow)
    for (let component = 0; component < componentsPerRow; component++) {
      values[component] = readPackedBits(data, off * 8 + component * bpc, bpc)
    }
    for (let component = colors; component < componentsPerRow; component++) {
      values[component] = (values[component]! + values[component - colors]!) & maxValue
    }
    for (let component = 0; component < componentsPerRow; component++) {
      writePackedBits(out, off * 8 + component * bpc, bpc, values[component]!)
    }
  }
  return out
}

function readPackedBits(data: Uint8Array, bitOffset: number, bitLength: number): number {
  let value = 0
  for (let i = 0; i < bitLength; i++) {
    const bit = bitOffset + i
    value = (value << 1) | ((data[bit >> 3]! >> (7 - (bit & 7))) & 1)
  }
  return value
}

function writePackedBits(data: Uint8Array, bitOffset: number, bitLength: number, value: number): void {
  for (let i = 0; i < bitLength; i++) {
    const bit = bitOffset + i
    const shift = bitLength - 1 - i
    if (((value >> shift) & 1) !== 0) {
      const byteIndex = bit >> 3
      data[byteIndex] = data[byteIndex]! | (1 << (7 - (bit & 7)))
    }
  }
}

export function decodeAsciiHex(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let high = -1
  let foundEod = false
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!
    if (b === 0x3E) {
      foundEod = true
      break
    }
    if (isWhitespace(b)) continue
    const h = hexDigit(b)
    if (h < 0) throw new Error('PDF parse error: invalid ASCIIHexDecode data')
    if (high < 0) high = h
    else {
      out.push(high * 16 + h)
      high = -1
    }
  }
  if (!foundEod) throw new Error('PDF parse error: ASCIIHexDecode EOD marker is missing')
  if (high >= 0) out.push(high * 16)
  return new Uint8Array(out)
}

export function decodeAscii85(data: Uint8Array): Uint8Array {
  const out: number[] = []
  const group: number[] = []
  let foundEod = false
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!
    if (isWhitespace(b)) continue
    if (b === 0x7E && data[i + 1] === 0x3E) {
      foundEod = true
      break
    }
    if (b === 0x7A) {
      if (group.length !== 0) throw new Error('PDF parse error: invalid z in ASCII85Decode data')
      out.push(0, 0, 0, 0)
      continue
    }
    if (b < 0x21 || b > 0x75) throw new Error('PDF parse error: invalid ASCII85Decode data')
    group.push(b - 0x21)
    if (group.length === 5) {
      emitAscii85Group(group, 4, out)
      group.length = 0
    }
  }
  if (!foundEod) throw new Error('PDF parse error: ASCII85Decode EOD marker is missing')
  if (group.length === 1) throw new Error('PDF parse error: ASCII85Decode final group contains one character')
  if (group.length > 0) {
    const count = group.length - 1
    while (group.length < 5) group.push(84)
    emitAscii85Group(group, count, out)
  }
  return new Uint8Array(out)
}

function emitAscii85Group(group: number[], count: number, out: number[]): void {
  let value = 0
  for (let i = 0; i < 5; i++) value = value * 85 + group[i]!
  if (value > 0xFFFFFFFF) throw new Error('PDF parse error: ASCII85Decode group exceeds 32 bits')
  const bytes = [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF]
  for (let i = 0; i < count; i++) out.push(bytes[i]!)
}

export function decodeRunLength(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let pos = 0
  let foundEod = false
  while (pos < data.length) {
    const n = data[pos++]!
    if (n === 128) {
      foundEod = true
      break
    }
    if (n <= 127) {
      const count = n + 1
      if (pos + count > data.length) throw new Error('PDF parse error: RunLengthDecode literal exceeds data length')
      for (let i = 0; i < count; i++) out.push(data[pos++]!)
    } else {
      const count = 257 - n
      if (pos >= data.length) throw new Error('PDF parse error: RunLengthDecode repeat byte missing')
      const b = data[pos++]!
      for (let i = 0; i < count; i++) out.push(b)
    }
  }
  if (!foundEod) throw new Error('PDF parse error: RunLengthDecode EOD marker is missing')
  return new Uint8Array(out)
}

export function decodeLzw(data: Uint8Array, parms: PdfDict | null): Uint8Array {
  const earlyChangeVal = parms?.get('EarlyChange')
  if (earlyChangeVal !== undefined && typeof earlyChangeVal !== 'number') {
    throw new Error('PDF parse error: LZWDecode EarlyChange must be an integer')
  }
  const earlyChange = typeof earlyChangeVal === 'number' ? earlyChangeVal : 1
  if (!Number.isInteger(earlyChange) || (earlyChange !== 0 && earlyChange !== 1)) {
    throw new Error(`PDF parse error: LZWDecode EarlyChange must be 0 or 1, got ${earlyChange}`)
  }
  const reader = new LzwBitReader(data)
  const table: number[][] = []
  resetLzwTable(table)
  let codeSize = 9
  let prev: number[] | null = null
  const out: number[] = []
  let foundEod = false
  for (;;) {
    const code = reader.read(codeSize)
    if (code < 0) break
    if (code === 257) {
      foundEod = true
      break
    }
    if (code === 256) {
      resetLzwTable(table)
      codeSize = 9
      prev = null
      continue
    }
    let entry: number[]
    if (code < table.length) {
      entry = table[code]!
    } else if (code === table.length && prev) {
      entry = prev.concat(prev[0]!)
    } else {
      throw new Error('PDF parse error: invalid LZWDecode code')
    }
    for (let i = 0; i < entry.length; i++) out.push(entry[i]!)
    if (prev) {
      if (table.length >= 4096) throw new Error('PDF parse error: LZWDecode table is full without a clear-table code')
      table.push(prev.concat(entry[0]!))
      const threshold = (1 << codeSize) - earlyChange
      if (table.length >= threshold && codeSize < 12) codeSize++
    }
    prev = entry
  }
  if (!foundEod) throw new Error('PDF parse error: LZWDecode EOD code is missing')
  if (!reader.hasValidEodPadding()) throw new Error('PDF parse error: invalid LZWDecode padding after EOD')
  return new Uint8Array(out)
}

function decodeCryptFilter(
  data: Uint8Array,
  parms: PdfDict | null,
  ctx: DecryptionContext | null,
  objNum: number,
  genNum: number,
): Uint8Array {
  if (parms === null) return data
  const type = parms.get('Type')
  if (type !== undefined && (!(type instanceof PdfName) || type.name !== 'CryptFilterDecodeParms')) {
    throw new Error('PDF parse error: Crypt filter /Type must be /CryptFilterDecodeParms')
  }
  const name = parms.get('Name')
  if (name === undefined) return data
  if (!(name instanceof PdfName)) throw new Error('PDF parse error: Crypt filter /Name must be a name')
  if (name.name === 'Identity') return data
  if (!ctx) throw new Error(`PDF parse error: Crypt filter /${name.name} requires an encryption context`)
  return ctx.decryptCryptFilter(objNum, genNum, data, name.name)
}

function decodeCcittFax(data: Uint8Array, parms: PdfDict | null): Uint8Array {
  const k = integerParam(parms, 'K', 0)
  const columns = integerParam(parms, 'Columns', 1728)
  const rows = integerParam(parms, 'Rows', 0)
  const encodedByteAlign = booleanParam(parms, 'EncodedByteAlign', false)
  const endOfLine = booleanParam(parms, 'EndOfLine', false)
  const endOfBlock = booleanParam(parms, 'EndOfBlock', true)
  const blackIs1 = booleanParam(parms, 'BlackIs1', false)
  const damagedRowsBeforeError = integerParam(parms, 'DamagedRowsBeforeError', 0)
  if (columns <= 0) throw new Error('PDF parse error: CCITTFaxDecode Columns must be positive')
  if (rows < 0) throw new Error('PDF parse error: CCITTFaxDecode Rows must be non-negative')
  if (damagedRowsBeforeError < 0) throw new Error('PDF parse error: CCITTFaxDecode DamagedRowsBeforeError must be non-negative')
  return decodeCcittFaxData(data, {
    k,
    columns,
    rows,
    encodedByteAlign,
    endOfLine,
    endOfBlock,
    blackIs1,
    damagedRowsBeforeError,
  })
}


function integerParam(dict: PdfDict | null, key: string, defaultValue: number): number {
  if (dict === null) return defaultValue
  const value = dict.get(key)
  if (value === undefined) return defaultValue
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`PDF parse error: CCITTFaxDecode ${key} must be an integer`)
  }
  return value
}

function booleanParam(dict: PdfDict | null, key: string, defaultValue: boolean): boolean {
  if (dict === null) return defaultValue
  const value = dict.get(key)
  if (value === undefined) return defaultValue
  if (typeof value !== 'boolean') throw new Error(`PDF parse error: CCITTFaxDecode ${key} must be a boolean`)
  return value
}


function resetLzwTable(table: number[][]): void {
  table.length = 0
  for (let i = 0; i < 256; i++) table.push([i])
  table.push([])
  table.push([])
}

class LzwBitReader {
  private readonly data: Uint8Array
  private bitPos = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  read(bits: number): number {
    if (this.bitPos + bits > this.data.length * 8) return -1
    let value = 0
    for (let i = 0; i < bits; i++) {
      const absolute = this.bitPos + i
      const b = this.data[absolute >> 3]!
      value = (value << 1) | ((b >> (7 - (absolute & 7))) & 1)
    }
    this.bitPos += bits
    return value
  }

  hasValidEodPadding(): boolean {
    const remaining = this.data.length * 8 - this.bitPos
    if (remaining > 7) return false
    for (let pos = this.bitPos; pos < this.data.length * 8; pos++) {
      if (((this.data[pos >> 3]! >> (7 - (pos & 7))) & 1) !== 0) return false
    }
    return true
  }
}

/** Parse a PDF binary */
export function parsePdf(bytes: Uint8Array, options: PdfParseOptions = {}): PdfDocument {
  return PdfDocument.parse(bytes, options)
}

/** Parse exactly one direct PDF object followed only by whitespace or comments. */
export function parsePdfObject(bytes: Uint8Array): PdfValue {
  const lexer = new Lexer(bytes, 0)
  const value = new ObjectParser(null, lexer).parseValue()
  if (lexer.next() !== TokType.EOF) {
    throw new Error(`PDF parse error: trailing token after direct object at offset ${lexer.pos}`)
  }
  return value
}

// ─── Object syntax parser ───

export class ObjectParser {
  private readonly doc: PdfDocument | null
  private readonly lexer: Lexer
  private readonly objNum: number
  private readonly genNum: number
  private readonly decryptStrings: boolean

  constructor(doc: PdfDocument | null, lexer: Lexer, objNum = -1, genNum = 0, decryptStrings = false) {
    this.doc = doc
    this.lexer = lexer
    this.objNum = objNum
    this.genNum = genNum
    this.decryptStrings = decryptStrings
  }

  parseValue(): PdfValue {
    const tok = this.lexer.next()
    return this.parseValueFromToken(tok)
  }

  private parseValueFromToken(tok: TokType): PdfValue {
    const lexer = this.lexer
    switch (tok) {
      case TokType.Int: {
        // Lookahead for an indirect reference "N G R"
        const num = lexer.num
        const save = lexer.pos
        if (lexer.next() === TokType.Int) {
          const gen = lexer.num
          if (lexer.next() === TokType.Keyword && lexer.text === 'R') {
            if (num <= 0 || gen < 0 || gen > 0xFFFF) {
              throw new Error(`PDF parse error: invalid indirect reference ${num} ${gen} R`)
            }
            return new PdfRef(num, gen)
          }
        }
        lexer.pos = save
        return num
      }
      case TokType.Real:
        return lexer.num
      case TokType.Name:
        return new PdfName(lexer.text)
      case TokType.String:
        return new PdfString(
          this.doc
            ? this.doc.decryptStringBytes(this.objNum, this.genNum, lexer.bytes, this.decryptStrings)
            : lexer.bytes,
          lexer.stringIsHex,
          lexer.stringHexDigitCount,
        )
      case TokType.ArrayOpen: {
        const arr: PdfValue[] = []
        for (;;) {
          const t = lexer.next()
          if (t === TokType.ArrayClose) return arr
          if (t === TokType.EOF) {
            throw new Error('PDF parse error: unterminated array')
          }
          arr.push(this.parseValueFromToken(t))
        }
      }
      case TokType.DictOpen: {
        const dict: PdfDict = new Map()
        for (;;) {
          const t = lexer.next()
          if (t === TokType.DictClose) return dict
          if (t !== TokType.Name) {
            throw new Error(`PDF parse error: dictionary key expected at offset ${lexer.pos}`)
          }
          const key = lexer.text
          dict.set(key, this.parseValue())
        }
      }
      case TokType.Keyword: {
        if (lexer.text === 'true') return true
        if (lexer.text === 'false') return false
        if (lexer.text === 'null') return null
        throw new Error(`PDF parse error: unexpected keyword "${lexer.text}" at offset ${lexer.pos}`)
      }
      default:
        throw new Error(`PDF parse error: unexpected token at offset ${lexer.pos}`)
    }
  }
}

// ─── Helpers ───

const HEADER_PATTERN = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]) // "%PDF-"
const STARTXREF_PATTERN = new Uint8Array([
  0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66, // "startxref"
])
const EOF_PATTERN = new Uint8Array([0x25, 0x25, 0x45, 0x4F, 0x46]) // "%%EOF"

function readPdfHeader(bytes: Uint8Array): { base: number, version: string } {
  const base = indexOfBytes(bytes, HEADER_PATTERN, 0)
  if (base < 0 || base >= 1024) throw new Error('PDF parse error: %PDF- header not found in the first 1024 bytes')
  if (base + 8 > bytes.length) throw new Error('PDF parse error: truncated PDF header')
  const major = bytes[base + 5]!
  const dot = bytes[base + 6]!
  const minor = bytes[base + 7]!
  if (dot !== 0x2E || major < 0x31 || major > 0x32 || minor < 0x30 || minor > 0x39) {
    throw new Error('PDF parse error: invalid PDF header version')
  }
  const version = `${String.fromCharCode(major)}.${String.fromCharCode(minor)}`
  if ((major === 0x31 && minor > 0x37) || (major === 0x32 && minor !== 0x30)) {
    throw new Error(`PDF parse error: unsupported PDF header version ${version}`)
  }
  const eol = bytes[base + 8]
  if (eol !== 0x0A && eol !== 0x0D) throw new Error('PDF parse error: PDF header must end with CR, LF, or CRLF')
  return { base, version }
}

function indexOfBytes(data: Uint8Array, pattern: Uint8Array, from: number): number {
  const limit = data.length - pattern.length
  for (let i = from; i <= limit; i++) {
    let match = true
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        match = false
        break
      }
    }
    if (match) return i
  }
  return -1
}

function lastIndexOfBytes(data: Uint8Array, pattern: Uint8Array): number {
  for (let i = data.length - pattern.length; i >= 0; i--) {
    let match = true
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        match = false
        break
      }
    }
    if (match) return i
  }
  return -1
}

function lastIndexOfBytesBefore(data: Uint8Array, pattern: Uint8Array, before: number): number {
  for (let i = Math.min(before - pattern.length, data.length - pattern.length); i >= 0; i--) {
    let match = true
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        match = false
        break
      }
    }
    if (match) return i
  }
  return -1
}

/** Read the startxref value at the end of the file */
export function readStartXref(bytes: Uint8Array): number {
  const eof = lastIndexOfBytes(bytes, EOF_PATTERN)
  if (eof < 0) throw new Error('PDF parse error: final %%EOF marker not found')
  if (eof > 0 && bytes[eof - 1] !== 0x0A && bytes[eof - 1] !== 0x0D) {
    throw new Error('PDF parse error: %%EOF marker must begin a line')
  }
  for (let i = eof + EOF_PATTERN.length; i < bytes.length; i++) {
    if (!isWhitespace(bytes[i]!)) throw new Error('PDF parse error: non-whitespace data follows final %%EOF marker')
  }
  const pos = lastIndexOfBytesBefore(bytes, STARTXREF_PATTERN, eof)
  if (pos < 0) {
    throw new Error('PDF parse error: startxref not found')
  }
  const prefix = bytes.subarray(0, eof)
  const lexer = new Lexer(prefix, pos + STARTXREF_PATTERN.length)
  if (lexer.next() !== TokType.Int) {
    throw new Error('PDF parse error: invalid startxref offset')
  }
  const offset = lexer.num
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) {
    throw new Error('PDF parse error: startxref offset is outside the file')
  }
  if (lexer.next() !== TokType.EOF) throw new Error('PDF parse error: unexpected data between startxref and %%EOF')
  return offset
}

function requireInt(value: PdfValue, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`PDF parse error: ${label} must be an integer`)
  }
  return value
}

function requireStringBytes(value: PdfValue, label: string): Uint8Array {
  if (!(value instanceof PdfString)) {
    throw new Error(`PDF parse error: ${label} must be a string`)
  }
  return value.bytes
}

function readBE(data: Uint8Array, pos: number, width: number): number {
  let v = 0
  for (let i = 0; i < width; i++) {
    v = v * 256 + data[pos + i]!
  }
  return v
}
