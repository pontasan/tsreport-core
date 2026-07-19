import { PdfDocument, PdfName, PdfStream, PdfString, type PdfDict, type PdfValue } from './pdf-parser.js'
import { parseType1 } from '../parsers/type1-parser.js'
import { cffGlyphName, parseCff } from '../parsers/cff-parser.js'
import { BinaryReader } from '../binary/reader.js'
import { parseFont } from '../parsers/index.js'
import { getTableReader } from '../parsers/sfnt-parser.js'
import { Font } from '../font.js'
import { symbolicBaseFontEncoding } from './symbol-encoding.js'
import { aglNameToUnicode } from './agl-data.js'

export type SimpleEncodingName = 'StandardEncoding' | 'WinAnsiEncoding' | 'MacRomanEncoding' | 'MacExpertEncoding'
type PdfPredefinedEncodingName = Exclude<SimpleEncodingName, 'StandardEncoding'>

/** The Symbol/ZapfDingbats built-in byte→Unicode encoding, or null. */
function symbolicEncoding(doc: PdfDocument, font: PdfDict): string[] | null {
  const baseFont = doc.resolve(font.get('BaseFont') ?? null)
  const name = baseFont instanceof PdfName ? baseFont.name : baseFont instanceof PdfString ? new TextDecoder().decode(baseFont.bytes) : null
  return name === null ? null : symbolicBaseFontEncoding(name)
}

/** Built-in code-to-glyph-name encoding of an embedded Type 1/CFF program. */
const type1BuiltinCache = new WeakMap<PdfDict, string[] | null>()

function embeddedType1BuiltinGlyphNames(doc: PdfDocument, font: PdfDict): string[] | null {
  const cached = type1BuiltinCache.get(font)
  if (cached !== undefined) return cached
  let result: string[] | null = null
  const descriptor = doc.resolve(font.get('FontDescriptor') ?? null)
  if (descriptor instanceof Map) {
    const fontFile = doc.resolve(descriptor.get('FontFile') ?? null)
    if (fontFile instanceof PdfStream) {
      result = parseType1(doc.decodeStream(fontFile), standardEncodingGlyphNames()).encoding
    } else {
      const fontFile3 = doc.resolve(descriptor.get('FontFile3') ?? null)
      if (fontFile3 instanceof PdfStream) {
        const subtype = doc.resolve(fontFile3.dict.get('Subtype') ?? null)
        if (!(subtype instanceof PdfName)) throw new Error('PDF import error: FontFile3 requires a Subtype name')
        const bytes = doc.decodeStream(fontFile3)
        if (subtype.name === 'Type1C') {
          result = cffBuiltinGlyphNames(parseCff(new BinaryReader(exactArrayBuffer(bytes))))
        } else if (subtype.name === 'OpenType') {
          const sfnt = parseFont(exactArrayBuffer(bytes))
          const cffReader = getTableReader(sfnt, 'CFF ')
          if (cffReader !== null) result = cffBuiltinGlyphNames(parseCff(cffReader))
        }
      }
    }
  }
  type1BuiltinCache.set(font, result)
  return result
}

function cffBuiltinGlyphNames(cff: ReturnType<typeof parseCff>): string[] {
  if (cff.isCIDFont || cff.encoding === null) throw new Error('PDF import error: simple Type 1 font requires a non-CID CFF encoding')
  const names = new Array<string>(256)
  for (let code = 0; code < 256; code++) names[code] = cffGlyphName(cff, cff.encoding.getGlyphId(code))
  return names
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const trueTypeBuiltinCache = new WeakMap<PdfDict, string[] | null>()

function embeddedTrueTypeBuiltinGlyphNames(doc: PdfDocument, font: PdfDict): string[] | null {
  const cached = trueTypeBuiltinCache.get(font)
  if (cached !== undefined) return cached
  const descriptor = doc.resolve(font.get('FontDescriptor') ?? null)
  let bytes: Uint8Array | null = null
  if (descriptor instanceof Map) {
    const fontFile2 = doc.resolve(descriptor.get('FontFile2') ?? null)
    if (fontFile2 instanceof PdfStream) bytes = doc.decodeStream(fontFile2)
    if (bytes === null) {
      const fontFile3 = doc.resolve(descriptor.get('FontFile3') ?? null)
      if (fontFile3 instanceof PdfStream) {
        const subtype = doc.resolve(fontFile3.dict.get('Subtype') ?? null)
        if (subtype instanceof PdfName && subtype.name === 'OpenType') {
          const candidate = doc.decodeStream(fontFile3)
          const sfnt = parseFont(exactArrayBuffer(candidate))
          if (sfnt.tableDirectory.has('glyf')) bytes = candidate
        }
      }
    }
  }
  const result = bytes === null ? null : trueTypeSymbolicGlyphNames(bytes)
  trueTypeBuiltinCache.set(font, result)
  return result
}

function trueTypeSymbolicGlyphNames(bytes: Uint8Array): string[] {
  const embedded = Font.load(exactArrayBuffer(bytes))
  const names = new Array<string>(256)
  const reverse = new Map<number, number>()
  for (const [codePoint, glyphId] of embedded.cmap.entries()) {
    if (!reverse.has(glyphId)) reverse.set(glyphId, codePoint)
  }
  for (let code = 0; code < 256; code++) {
    const glyphId = symbolicTrueTypeGlyphId(embedded, code)
    const glyphName = embedded.getGlyphName(glyphId)
    if (glyphName !== null) names[code] = glyphName
    else {
      const codePoint = reverse.get(glyphId)
      names[code] = codePoint === undefined ? '.notdef' : `u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return names
}

export function symbolicTrueTypeGlyphId(font: Font, code: number): number {
  const records = font.cmap.encodingRecords
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (record.platformId !== 3 || record.encodingId !== 0 || record.mapping === null) continue
    const candidates = [code, 0xF000 | code, 0xF100 | code, 0xF200 | code]
    for (let k = 0; k < candidates.length; k++) {
      const glyphId = record.mapping.getGlyphId(candidates[k]!)
      if (glyphId !== 0) return glyphId
    }
    return 0
  }
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (record.platformId === 1 && record.encodingId === 0 && record.mapping !== null) {
      return record.mapping.getGlyphId(code)
    }
  }
  return 0
}

function glyphNamesToUnicode(names: string[]): string[] {
  const out = new Array<string>(256)
  for (let i = 0; i < 256; i++) {
    const name = names[i] ?? '.notdef'
    out[i] = name === '.notdef' ? '' : glyphNameToUnicode(name)
  }
  return out
}

export function decodeSimpleFontBytes(doc: PdfDocument, font: PdfDict, bytes: Uint8Array): string {
  const encoding = buildSimpleEncoding(doc, font)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += encoding[bytes[i]!]!
  return out
}

export function simpleFontGlyphName(doc: PdfDocument, font: PdfDict, code: number): string {
  return buildSimpleGlyphNameEncoding(doc, font)[code] ?? '.notdef'
}

function buildSimpleEncoding(doc: PdfDocument, font: PdfDict): string[] {
  const subtype = simpleFontSubtype(doc, font)
  const encodingValue = doc.resolve(font.get('Encoding') ?? null)
  if (subtype === 'Type3' && encodingValue === null) throw new Error('PDF import error: Type3 font requires an Encoding')
  const implicit = implicitGlyphNames(doc, font, subtype)
  const standardSymbolic = (subtype === 'Type1' || subtype === 'MMType1') && embeddedType1BuiltinGlyphNames(doc, font) === null
    ? symbolicEncoding(doc, font)
    : null
  const implicitUnicode = standardSymbolic ?? glyphNamesToUnicode(implicit)
  // A symbolic TrueType font always uses its cmap-based built-in encoding; its
  // PDF Encoding entry is ignored by ISO 32000-2 9.6.6.4.
  if (subtype === 'TrueType' && simpleFontIsSymbolic(doc, font)) return implicitUnicode
  if (encodingValue === null) return implicitUnicode
  if (encodingValue instanceof PdfName || encodingValue instanceof Map) {
    return buildUnicodeEncodingValue(doc, encodingValue, implicitUnicode, subtype, new Set())
  }
  throw new Error('PDF import error: font Encoding must be a name or dictionary')
}

function buildSimpleGlyphNameEncoding(doc: PdfDocument, font: PdfDict): string[] {
  const subtype = simpleFontSubtype(doc, font)
  const encodingValue = doc.resolve(font.get('Encoding') ?? null)
  if (subtype === 'Type3' && encodingValue === null) throw new Error('PDF import error: Type3 font requires an Encoding')
  const implicit = implicitGlyphNames(doc, font, subtype)
  if (subtype === 'TrueType' && simpleFontIsSymbolic(doc, font)) return implicit
  if (encodingValue === null) return implicit
  if (encodingValue instanceof PdfName || encodingValue instanceof Map) {
    return buildGlyphNameEncodingValue(doc, encodingValue, implicit, subtype, new Set())
  }
  throw new Error('PDF import error: font Encoding must be a name or dictionary')
}

type SimpleFontSubtype = 'Type1' | 'MMType1' | 'TrueType' | 'Type3'

function simpleFontSubtype(doc: PdfDocument, font: PdfDict): SimpleFontSubtype {
  const value = doc.resolve(font.get('Subtype') ?? null)
  if (!(value instanceof PdfName)) throw new Error('PDF import error: simple font Subtype must be a name')
  if (value.name === 'Type1' || value.name === 'MMType1' || value.name === 'TrueType' || value.name === 'Type3') return value.name
  throw new Error(`PDF import error: /${value.name} is not a simple font subtype`)
}

export function simpleFontIsSymbolic(doc: PdfDocument, font: PdfDict): boolean {
  const descriptor = doc.resolve(font.get('FontDescriptor') ?? null)
  if (descriptor instanceof Map) {
    const flags = doc.resolve(descriptor.get('Flags') ?? null)
    if (typeof flags === 'number') return (flags & 4) !== 0
  }
  return symbolicEncoding(doc, font) !== null
}

function implicitGlyphNames(doc: PdfDocument, font: PdfDict, subtype: SimpleFontSubtype): string[] {
  if (subtype === 'Type3') return notdefGlyphNames()
  if (subtype === 'TrueType') {
    if (!simpleFontIsSymbolic(doc, font)) return buildNamedGlyphNameEncoding('StandardEncoding')
    return embeddedTrueTypeBuiltinGlyphNames(doc, font) ?? notdefGlyphNames()
  }
  const embedded = embeddedType1BuiltinGlyphNames(doc, font)
  if (embedded !== null) return [...embedded]
  if (!simpleFontIsSymbolic(doc, font)) return buildNamedGlyphNameEncoding('StandardEncoding')
  return notdefGlyphNames()
}

function notdefGlyphNames(): string[] {
  return new Array<string>(256).fill('.notdef')
}

function buildUnicodeEncodingValue(
  doc: PdfDocument,
  value: PdfName | PdfDict,
  implicit: string[],
  subtype: SimpleFontSubtype,
  visited: Set<PdfDict>,
): string[] {
  if (value instanceof PdfName) return buildNamedEncoding(encodingName(value.name))
  validateEncodingDictionary(doc, value)
  if (visited.has(value)) throw new Error('PDF import error: circular font BaseEncoding dictionary')
  visited.add(value)
  const base = doc.resolve(value.get('BaseEncoding') ?? null)
  if (base !== null && !(base instanceof PdfName)) throw new Error('PDF import error: Encoding BaseEncoding must be a name')
  const encoding = base instanceof PdfName
    ? buildUnicodeEncodingValue(doc, base, implicit, subtype, visited)
    : [...implicit]
  applyDifferences(doc, encoding, value)
  if (subtype === 'TrueType') fillUndefinedUnicodeWithStandard(encoding)
  visited.delete(value)
  return encoding
}

function buildGlyphNameEncodingValue(
  doc: PdfDocument,
  value: PdfName | PdfDict,
  implicit: string[],
  subtype: SimpleFontSubtype,
  visited: Set<PdfDict>,
): string[] {
  if (value instanceof PdfName) return buildNamedGlyphNameEncoding(encodingName(value.name))
  validateEncodingDictionary(doc, value)
  if (visited.has(value)) throw new Error('PDF import error: circular font BaseEncoding dictionary')
  visited.add(value)
  const base = doc.resolve(value.get('BaseEncoding') ?? null)
  if (base !== null && !(base instanceof PdfName)) throw new Error('PDF import error: Encoding BaseEncoding must be a name')
  const encoding = base instanceof PdfName
    ? buildGlyphNameEncodingValue(doc, base, implicit, subtype, visited)
    : [...implicit]
  applyGlyphNameDifferences(doc, encoding, value)
  if (subtype === 'TrueType') fillUndefinedGlyphNamesWithStandard(encoding)
  visited.delete(value)
  return encoding
}

function validateEncodingDictionary(doc: PdfDocument, dict: PdfDict): void {
  const type = doc.resolve(dict.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'Encoding')) {
    throw new Error('PDF import error: Encoding dictionary Type must be /Encoding')
  }
}

function encodingName(name: string): PdfPredefinedEncodingName {
  if (name === 'WinAnsiEncoding' || name === 'MacRomanEncoding' || name === 'MacExpertEncoding') return name
  throw new Error(`PDF import error: unsupported simple font encoding /${name}`)
}

function fillUndefinedUnicodeWithStandard(encoding: string[]): void {
  const standard = buildNamedEncoding('StandardEncoding')
  for (let code = 0; code < 256; code++) if (encoding[code] === '') encoding[code] = standard[code]!
}

function fillUndefinedGlyphNamesWithStandard(encoding: string[]): void {
  const standard = buildNamedGlyphNameEncoding('StandardEncoding')
  for (let code = 0; code < 256; code++) if (encoding[code] === '.notdef') encoding[code] = standard[code]!
}

function applyDifferences(doc: PdfDocument, encoding: string[], dict: PdfDict): void {
  const value = doc.resolve(dict.get('Differences') ?? null)
  if (value === null) return
  if (!Array.isArray(value)) throw new Error('PDF import error: Encoding Differences must be an array')
  let code = -1
  for (let i = 0; i < value.length; i++) {
    const item = doc.resolve(value[i]!)
    if (typeof item === 'number') {
      if (!Number.isInteger(item) || item < 0 || item > 255) throw new Error('PDF import error: Encoding Differences code must be an integer from 0 to 255')
      code = item
    } else if (item instanceof PdfName) {
      if (code < 0 || code > 255) throw new Error('PDF import error: Encoding Differences name has no code')
      encoding[code] = glyphNameToUnicode(item.name)
      code++
    } else {
      throw new Error('PDF import error: Encoding Differences entries must be numbers or names')
    }
  }
}

function applyGlyphNameDifferences(doc: PdfDocument, encoding: string[], dict: PdfDict): void {
  const value = doc.resolve(dict.get('Differences') ?? null)
  if (value === null) return
  if (!Array.isArray(value)) throw new Error('PDF import error: Encoding Differences must be an array')
  let code = -1
  for (let i = 0; i < value.length; i++) {
    const item = doc.resolve(value[i]!)
    if (typeof item === 'number') {
      if (!Number.isInteger(item) || item < 0 || item > 255) throw new Error('PDF import error: Encoding Differences code must be an integer from 0 to 255')
      code = item
    } else if (item instanceof PdfName) {
      if (code < 0 || code > 255) throw new Error('PDF import error: Encoding Differences name has no code')
      encoding[code] = item.name
      code++
    } else {
      throw new Error('PDF import error: Encoding Differences entries must be numbers or names')
    }
  }
}

function buildNamedEncoding(name: SimpleEncodingName): string[] {
  const encoding = new Array<string>(256).fill('')
  if (name === 'MacExpertEncoding') {
    applyGlyphNames(encoding, MAC_EXPERT_GLYPH_NAMES)
    return encoding
  }
  if (name === 'MacRomanEncoding') {
    applyCodePoints(encoding, MAC_ROMAN_CODEPOINTS)
    return encoding
  }
  applyAscii(encoding)
  if (name === 'WinAnsiEncoding') {
    applyCodePoints(encoding, WIN_ANSI_CODEPOINTS)
    applyWinAnsiUnusedBullets(encoding)
  }
  else applyStandardEncoding(encoding)
  return encoding
}

/** Adobe StandardEncoding as code -> glyph name (for Type1 seac composition). */
export function standardEncodingGlyphNames(): string[] {
  return buildNamedGlyphNameEncoding('StandardEncoding')
}

function buildNamedGlyphNameEncoding(name: SimpleEncodingName): string[] {
  const encoding = new Array<string>(256)
  for (let i = 0; i < encoding.length; i++) encoding[i] = '.notdef'
  if (name === 'MacExpertEncoding') {
    applyGlyphNameArray(encoding, MAC_EXPERT_GLYPH_NAMES)
    return encoding
  }
  if (name === 'MacRomanEncoding') {
    applyCodePointGlyphNames(encoding, MAC_ROMAN_CODEPOINTS)
    encoding[0xCA] = 'space'
    return encoding
  }
  applyAsciiGlyphNames(encoding)
  if (name === 'WinAnsiEncoding') {
    applyCodePointGlyphNames(encoding, WIN_ANSI_CODEPOINTS)
    applyWinAnsiGlyphNameExceptions(encoding)
  }
  else applyStandardGlyphNames(encoding)
  return encoding
}

function applyAscii(encoding: string[]): void {
  for (let code = 0x20; code <= 0x7E; code++) encoding[code] = String.fromCharCode(code)
}

function applyCodePoints(encoding: string[], map: Record<number, number>): void {
  const codes = Object.keys(map)
  for (let i = 0; i < codes.length; i++) {
    const code = Number(codes[i]!)
    encoding[code] = String.fromCodePoint(map[code]!)
  }
}

function applyGlyphNames(encoding: string[], names: readonly string[]): void {
  for (let code = 0; code < names.length; code++) {
    const name = names[code]!
    if (name !== '') encoding[code] = glyphNameToUnicode(name)
  }
}

function applyWinAnsiUnusedBullets(encoding: string[]): void {
  encoding[0x7F] = '\u2022'
  encoding[0x81] = '\u2022'
  encoding[0x8D] = '\u2022'
  encoding[0x8F] = '\u2022'
  encoding[0x90] = '\u2022'
  encoding[0x9D] = '\u2022'
}

function applyWinAnsiGlyphNameExceptions(encoding: string[]): void {
  encoding[0x7F] = 'bullet'
  encoding[0x81] = 'bullet'
  encoding[0x8D] = 'bullet'
  encoding[0x8F] = 'bullet'
  encoding[0x90] = 'bullet'
  encoding[0x9D] = 'bullet'
  encoding[0xA0] = 'space'
  encoding[0xAD] = 'hyphen'
}

function applyStandardEncoding(encoding: string[]): void {
  const names = Object.keys(STANDARD_DIFFERENCES)
  for (let i = 0; i < names.length; i++) {
    const code = Number(names[i]!)
    encoding[code] = glyphNameToUnicode(STANDARD_DIFFERENCES[code]!)
  }
}

function applyAsciiGlyphNames(encoding: string[]): void {
  for (let code = 0x20; code <= 0x7E; code++) encoding[code] = glyphNameFromUnicode(String.fromCharCode(code))
}

function applyCodePointGlyphNames(encoding: string[], map: Record<number, number>): void {
  const codes = Object.keys(map)
  for (let i = 0; i < codes.length; i++) {
    const code = Number(codes[i]!)
    encoding[code] = glyphNameFromUnicode(String.fromCodePoint(map[code]!))
  }
}

function applyGlyphNameArray(encoding: string[], names: readonly string[]): void {
  for (let code = 0; code < names.length; code++) {
    const name = names[code]!
    if (name !== '') encoding[code] = name
  }
}

function applyStandardGlyphNames(encoding: string[]): void {
  const names = Object.keys(STANDARD_DIFFERENCES)
  for (let i = 0; i < names.length; i++) {
    const code = Number(names[i]!)
    encoding[code] = STANDARD_DIFFERENCES[code]!
  }
}

/**
 * Resolve a glyph name to its Unicode string via the Adobe Glyph List
 * algorithm (https://github.com/adobe-type-tools/agl-specification): drop the
 * suffix after the first period, split ligature components at underscores, and
 * map each component through the AGL, the expert set, or the uniXXXX / uXXXXXX
 * conventions.
 */
export function glyphNameToUnicode(name: string): string {
  if (name === '.notdef') return ''
  const base = name.indexOf('.') >= 0 ? name.slice(0, name.indexOf('.')) : name
  if (base === '') return ''
  let result = ''
  for (const component of base.split('_')) result += glyphNameComponentToUnicode(component)
  return result
}

function glyphNameComponentToUnicode(name: string): string {
  // The full Adobe Glyph List is authoritative (ISO 32000-1 9.10.2).
  const agl = aglNameToUnicode(name)
  if (agl !== undefined) return agl
  // Names outside AGL 2.0 that newer-font naming conventions define (AGLFN),
  // e.g. doubledanda.
  const direct = GLYPH_UNICODE[name]
  if (direct !== undefined) return direct
  if (/^uni[0-9A-Fa-f]{4}(?:[0-9A-Fa-f]{4})*$/.test(name)) return unicodeNameToString(name, 3, 4)
  // Non-conformant but common: `uni` followed by 5–6 hex digits denotes a single
  // supplementary-plane code point (e.g. uni1000BA = U+1000BA) rather than 4-digit
  // BMP groups. Accept it when the value is a valid code point.
  if (/^uni[0-9A-Fa-f]{5,6}$/.test(name)) {
    const cp = parseInt(name.slice(3), 16)
    if (cp <= 0x10FFFF) return String.fromCodePoint(cp)
  }
  if (/^u[0-9A-Fa-f]{4,6}$/.test(name)) return unicodeNameToString(name, 1, name.length - 1)
  // A glyph name outside the AGL / uniXXXX conventions (e.g. a font-private name)
  // has no derivable code point. The glyph still
  // renders from its outline; for text extraction it maps to U+FFFD (the Unicode
  // replacement character) — the honest "unknown character" — rather than failing
  // the whole page import.
  return '�'
}

function glyphNameFromUnicode(value: string): string {
  const name = GLYPH_NAME_BY_UNICODE.get(value)
  if (name !== undefined) return name
  throw new Error(`PDF import error: no glyph name for Unicode ${value.codePointAt(0)!.toString(16)}`)
}

function unicodeNameToString(name: string, start: number, width: number): string {
  let out = ''
  for (let i = start; i < name.length; i += width) out += String.fromCodePoint(parseInt(name.substring(i, i + width), 16))
  return out
}

let winAnsiRev: Map<number, number> | null = null
let macOsRomanGlyphRev: Map<string, number> | null = null

/**
 * WinAnsi byte for a Unicode code point (ASCII passes through), or null when
 * the character is outside the WinAnsi set.
 */
export function winAnsiCodeForCodePoint(cp: number): number | null {
  if (cp >= 0x20 && cp <= 0x7E) return cp
  if (winAnsiRev === null) {
    winAnsiRev = new Map()
    for (const key of Object.keys(WIN_ANSI_CODEPOINTS)) {
      const code = Number(key)
      winAnsiRev.set(WIN_ANSI_CODEPOINTS[code]!, code)
    }
  }
  const code = winAnsiRev.get(cp)
  return code !== undefined ? code : null
}

export function macOsRomanCodeForGlyphName(name: string): number | null {
  if (macOsRomanGlyphRev === null) {
    macOsRomanGlyphRev = new Map()
    const names = buildNamedGlyphNameEncoding('MacRomanEncoding')
    for (let code = 0; code < names.length; code++) {
      const glyphName = names[code]!
      if (glyphName !== '.notdef' && !macOsRomanGlyphRev.has(glyphName)) macOsRomanGlyphRev.set(glyphName, code)
    }
    // The Macintosh cmap uses the host Mac OS Roman encoding, whose currency
    // slot was changed to Euro after PDF's frozen MacRomanEncoding was defined.
    macOsRomanGlyphRev.set('Euro', 0xDB)
  }
  return macOsRomanGlyphRev.get(name) ?? null
}

const WIN_ANSI_CODEPOINTS: Record<number, number> = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
  0xA0: 0x00A0, 0xA1: 0x00A1, 0xA2: 0x00A2, 0xA3: 0x00A3, 0xA4: 0x00A4, 0xA5: 0x00A5, 0xA6: 0x00A6,
  0xA7: 0x00A7, 0xA8: 0x00A8, 0xA9: 0x00A9, 0xAA: 0x00AA, 0xAB: 0x00AB, 0xAC: 0x00AC, 0xAD: 0x00AD,
  0xAE: 0x00AE, 0xAF: 0x00AF, 0xB0: 0x00B0, 0xB1: 0x00B1, 0xB2: 0x00B2, 0xB3: 0x00B3, 0xB4: 0x00B4,
  0xB5: 0x00B5, 0xB6: 0x00B6, 0xB7: 0x00B7, 0xB8: 0x00B8, 0xB9: 0x00B9, 0xBA: 0x00BA, 0xBB: 0x00BB,
  0xBC: 0x00BC, 0xBD: 0x00BD, 0xBE: 0x00BE, 0xBF: 0x00BF, 0xC0: 0x00C0, 0xC1: 0x00C1, 0xC2: 0x00C2,
  0xC3: 0x00C3, 0xC4: 0x00C4, 0xC5: 0x00C5, 0xC6: 0x00C6, 0xC7: 0x00C7, 0xC8: 0x00C8, 0xC9: 0x00C9,
  0xCA: 0x00CA, 0xCB: 0x00CB, 0xCC: 0x00CC, 0xCD: 0x00CD, 0xCE: 0x00CE, 0xCF: 0x00CF, 0xD0: 0x00D0,
  0xD1: 0x00D1, 0xD2: 0x00D2, 0xD3: 0x00D3, 0xD4: 0x00D4, 0xD5: 0x00D5, 0xD6: 0x00D6, 0xD7: 0x00D7,
  0xD8: 0x00D8, 0xD9: 0x00D9, 0xDA: 0x00DA, 0xDB: 0x00DB, 0xDC: 0x00DC, 0xDD: 0x00DD, 0xDE: 0x00DE,
  0xDF: 0x00DF, 0xE0: 0x00E0, 0xE1: 0x00E1, 0xE2: 0x00E2, 0xE3: 0x00E3, 0xE4: 0x00E4, 0xE5: 0x00E5,
  0xE6: 0x00E6, 0xE7: 0x00E7, 0xE8: 0x00E8, 0xE9: 0x00E9, 0xEA: 0x00EA, 0xEB: 0x00EB, 0xEC: 0x00EC,
  0xED: 0x00ED, 0xEE: 0x00EE, 0xEF: 0x00EF, 0xF0: 0x00F0, 0xF1: 0x00F1, 0xF2: 0x00F2, 0xF3: 0x00F3,
  0xF4: 0x00F4, 0xF5: 0x00F5, 0xF6: 0x00F6, 0xF7: 0x00F7, 0xF8: 0x00F8, 0xF9: 0x00F9, 0xFA: 0x00FA,
  0xFB: 0x00FB, 0xFC: 0x00FC, 0xFD: 0x00FD, 0xFE: 0x00FE, 0xFF: 0x00FF,
}

const MAC_ROMAN_CODEPOINTS: Record<number, number> = {
  0x20: 0x0020, 0x21: 0x0021, 0x22: 0x0022, 0x23: 0x0023, 0x24: 0x0024, 0x25: 0x0025, 0x26: 0x0026,
  0x27: 0x0027, 0x28: 0x0028, 0x29: 0x0029, 0x2A: 0x002A, 0x2B: 0x002B, 0x2C: 0x002C, 0x2D: 0x002D,
  0x2E: 0x002E, 0x2F: 0x002F, 0x30: 0x0030, 0x31: 0x0031, 0x32: 0x0032, 0x33: 0x0033, 0x34: 0x0034,
  0x35: 0x0035, 0x36: 0x0036, 0x37: 0x0037, 0x38: 0x0038, 0x39: 0x0039, 0x3A: 0x003A, 0x3B: 0x003B,
  0x3C: 0x003C, 0x3D: 0x003D, 0x3E: 0x003E, 0x3F: 0x003F, 0x40: 0x0040, 0x41: 0x0041, 0x42: 0x0042,
  0x43: 0x0043, 0x44: 0x0044, 0x45: 0x0045, 0x46: 0x0046, 0x47: 0x0047, 0x48: 0x0048, 0x49: 0x0049,
  0x4A: 0x004A, 0x4B: 0x004B, 0x4C: 0x004C, 0x4D: 0x004D, 0x4E: 0x004E, 0x4F: 0x004F, 0x50: 0x0050,
  0x51: 0x0051, 0x52: 0x0052, 0x53: 0x0053, 0x54: 0x0054, 0x55: 0x0055, 0x56: 0x0056, 0x57: 0x0057,
  0x58: 0x0058, 0x59: 0x0059, 0x5A: 0x005A, 0x5B: 0x005B, 0x5C: 0x005C, 0x5D: 0x005D, 0x5E: 0x005E,
  0x5F: 0x005F, 0x60: 0x0060, 0x61: 0x0061, 0x62: 0x0062, 0x63: 0x0063, 0x64: 0x0064, 0x65: 0x0065,
  0x66: 0x0066, 0x67: 0x0067, 0x68: 0x0068, 0x69: 0x0069, 0x6A: 0x006A, 0x6B: 0x006B, 0x6C: 0x006C,
  0x6D: 0x006D, 0x6E: 0x006E, 0x6F: 0x006F, 0x70: 0x0070, 0x71: 0x0071, 0x72: 0x0072, 0x73: 0x0073,
  0x74: 0x0074, 0x75: 0x0075, 0x76: 0x0076, 0x77: 0x0077, 0x78: 0x0078, 0x79: 0x0079, 0x7A: 0x007A,
  0x7B: 0x007B, 0x7C: 0x007C, 0x7D: 0x007D, 0x7E: 0x007E, 0x80: 0x00C4, 0x81: 0x00C5, 0x82: 0x00C7,
  0x83: 0x00C9, 0x84: 0x00D1, 0x85: 0x00D6, 0x86: 0x00DC, 0x87: 0x00E1, 0x88: 0x00E0, 0x89: 0x00E2,
  0x8A: 0x00E4, 0x8B: 0x00E3, 0x8C: 0x00E5, 0x8D: 0x00E7, 0x8E: 0x00E9, 0x8F: 0x00E8, 0x90: 0x00EA,
  0x91: 0x00EB, 0x92: 0x00ED, 0x93: 0x00EC, 0x94: 0x00EE, 0x95: 0x00EF, 0x96: 0x00F1, 0x97: 0x00F3,
  0x98: 0x00F2, 0x99: 0x00F4, 0x9A: 0x00F6, 0x9B: 0x00F5, 0x9C: 0x00FA, 0x9D: 0x00F9, 0x9E: 0x00FB,
  0x9F: 0x00FC, 0xA0: 0x2020, 0xA1: 0x00B0, 0xA2: 0x00A2, 0xA3: 0x00A3, 0xA4: 0x00A7, 0xA5: 0x2022,
  0xA6: 0x00B6, 0xA7: 0x00DF, 0xA8: 0x00AE, 0xA9: 0x00A9, 0xAA: 0x2122, 0xAB: 0x00B4, 0xAC: 0x00A8,
  0xAD: 0x2260, 0xAE: 0x00C6, 0xAF: 0x00D8, 0xB0: 0x221E, 0xB1: 0x00B1, 0xB2: 0x2264, 0xB3: 0x2265,
  0xB4: 0x00A5, 0xB5: 0x00B5, 0xB6: 0x2202, 0xB7: 0x2211, 0xB8: 0x220F, 0xB9: 0x03C0, 0xBA: 0x222B,
  0xBB: 0x00AA, 0xBC: 0x00BA, 0xBD: 0x03A9, 0xBE: 0x00E6, 0xBF: 0x00F8, 0xC0: 0x00BF, 0xC1: 0x00A1,
  0xC2: 0x00AC, 0xC3: 0x221A, 0xC4: 0x0192, 0xC5: 0x2248, 0xC6: 0x2206, 0xC7: 0x00AB, 0xC8: 0x00BB,
  0xC9: 0x2026, 0xCA: 0x00A0, 0xCB: 0x00C0, 0xCC: 0x00C3, 0xCD: 0x00D5, 0xCE: 0x0152, 0xCF: 0x0153,
  0xD0: 0x2013, 0xD1: 0x2014, 0xD2: 0x201C, 0xD3: 0x201D, 0xD4: 0x2018, 0xD5: 0x2019, 0xD6: 0x00F7,
  0xD7: 0x25CA, 0xD8: 0x00FF, 0xD9: 0x0178, 0xDA: 0x2044, 0xDB: 0x00A4, 0xDC: 0x2039, 0xDD: 0x203A,
  0xDE: 0xFB01, 0xDF: 0xFB02, 0xE0: 0x2021, 0xE1: 0x00B7, 0xE2: 0x201A, 0xE3: 0x201E, 0xE4: 0x2030,
  0xE5: 0x00C2, 0xE6: 0x00CA, 0xE7: 0x00C1, 0xE8: 0x00CB, 0xE9: 0x00C8, 0xEA: 0x00CD, 0xEB: 0x00CE,
  0xEC: 0x00CF, 0xED: 0x00CC, 0xEE: 0x00D3, 0xEF: 0x00D4, 0xF0: 0xF8FF, 0xF1: 0x00D2, 0xF2: 0x00DA,
  0xF3: 0x00DB, 0xF4: 0x00D9, 0xF5: 0x0131, 0xF6: 0x02C6, 0xF7: 0x02DC, 0xF8: 0x00AF, 0xF9: 0x02D8,
  0xFA: 0x02D9, 0xFB: 0x02DA, 0xFC: 0x00B8, 0xFD: 0x02DD, 0xFE: 0x02DB, 0xFF: 0x02C7,
}

const MAC_EXPERT_GLYPH_NAMES = [
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  'space', 'exclamsmall', 'Hungarumlautsmall', 'centoldstyle', 'dollaroldstyle',
  'dollarsuperior', 'ampersandsmall', 'Acutesmall', 'parenleftsuperior',
  'parenrightsuperior', 'twodotenleader', 'onedotenleader', 'comma', 'hyphen',
  'period', 'fraction', 'zerooldstyle', 'oneoldstyle', 'twooldstyle',
  'threeoldstyle', 'fouroldstyle', 'fiveoldstyle', 'sixoldstyle',
  'sevenoldstyle', 'eightoldstyle', 'nineoldstyle', 'colon', 'semicolon', '',
  'threequartersemdash', '', 'questionsmall', '', '', '', '', 'Ethsmall', '',
  '', 'onequarter', 'onehalf', 'threequarters', 'oneeighth', 'threeeighths',
  'fiveeighths', 'seveneighths', 'onethird', 'twothirds', '', '', '', '', '',
  '', 'ff', 'fi', 'fl', 'ffi', 'ffl', 'parenleftinferior', '',
  'parenrightinferior', 'Circumflexsmall', 'hypheninferior', 'Gravesmall',
  'Asmall', 'Bsmall', 'Csmall', 'Dsmall', 'Esmall', 'Fsmall', 'Gsmall',
  'Hsmall', 'Ismall', 'Jsmall', 'Ksmall', 'Lsmall', 'Msmall', 'Nsmall',
  'Osmall', 'Psmall', 'Qsmall', 'Rsmall', 'Ssmall', 'Tsmall', 'Usmall',
  'Vsmall', 'Wsmall', 'Xsmall', 'Ysmall', 'Zsmall', 'colonmonetary',
  'onefitted', 'rupiah', 'Tildesmall', '', '', 'asuperior', 'centsuperior',
  '', '', '', '', 'Aacutesmall', 'Agravesmall', 'Acircumflexsmall',
  'Adieresissmall', 'Atildesmall', 'Aringsmall', 'Ccedillasmall',
  'Eacutesmall', 'Egravesmall', 'Ecircumflexsmall', 'Edieresissmall',
  'Iacutesmall', 'Igravesmall', 'Icircumflexsmall', 'Idieresissmall',
  'Ntildesmall', 'Oacutesmall', 'Ogravesmall', 'Ocircumflexsmall',
  'Odieresissmall', 'Otildesmall', 'Uacutesmall', 'Ugravesmall',
  'Ucircumflexsmall', 'Udieresissmall', '', 'eightsuperior', 'fourinferior',
  'threeinferior', 'sixinferior', 'eightinferior', 'seveninferior',
  'Scaronsmall', '', 'centinferior', 'twoinferior', '', 'Dieresissmall', '',
  'Caronsmall', 'osuperior', 'fiveinferior', '', 'commainferior',
  'periodinferior', 'Yacutesmall', '', 'dollarinferior', '', '', 'Thornsmall',
  '', 'nineinferior', 'zeroinferior', 'Zcaronsmall', 'AEsmall', 'Oslashsmall',
  'questiondownsmall', 'oneinferior', 'Lslashsmall', '', '', '', '', '', '',
  'Cedillasmall', '', '', '', '', '', 'OEsmall', 'figuredash',
  'hyphensuperior', '', '', '', '', 'exclamdownsmall', '', 'Ydieresissmall',
  '', 'onesuperior', 'twosuperior', 'threesuperior', 'foursuperior',
  'fivesuperior', 'sixsuperior', 'sevensuperior', 'ninesuperior',
  'zerosuperior', '', 'esuperior', 'rsuperior', 'tsuperior', '', '',
  'isuperior', 'ssuperior', 'dsuperior', '', '', '', '', '', 'lsuperior',
  'Ogoneksmall', 'Brevesmall', 'Macronsmall', 'bsuperior', 'nsuperior',
  'msuperior', 'commasuperior', 'periodsuperior', 'Dotaccentsmall',
  'Ringsmall', '', '', '', '',
] as const

const STANDARD_DIFFERENCES: Record<number, string> = {
  39: 'quoteright', 96: 'quoteleft', 161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen',
  166: 'florin', 167: 'section', 168: 'currency', 169: 'quotesingle', 170: 'quotedblleft', 171: 'guillemotleft',
  172: 'guilsinglleft', 173: 'guilsinglright', 174: 'fi', 175: 'fl', 177: 'endash', 178: 'dagger',
  179: 'daggerdbl', 180: 'periodcentered', 182: 'paragraph', 183: 'bullet', 184: 'quotesinglbase',
  185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright', 188: 'ellipsis', 189: 'perthousand',
  191: 'questiondown', 193: 'grave', 194: 'acute', 195: 'circumflex', 196: 'tilde', 197: 'macron', 198: 'breve',
  199: 'dotaccent', 200: 'dieresis', 202: 'ring', 203: 'cedilla', 205: 'hungarumlaut', 206: 'ogonek',
  207: 'caron', 208: 'emdash', 225: 'AE', 227: 'ordfeminine', 232: 'Lslash', 233: 'Oslash', 234: 'OE',
  235: 'ordmasculine', 241: 'ae', 245: 'dotlessi', 248: 'lslash', 249: 'oslash', 250: 'oe', 251: 'germandbls',
}

// Preferred glyph names for building the standard named encodings (reverse
// lookup via GLYPH_NAME_BY_UNICODE), plus forward supplements for names the
// AGL lacks (e.g. doubledanda, from newer-font naming conventions). Forward
// glyph-name resolution consults the full AGL first (agl-data.ts).
const GLYPH_UNICODE: Record<string, string> = {
  A: 'A', AE: '\u00C6', Aacute: '\u00C1', Acircumflex: '\u00C2', Adieresis: '\u00C4', Agrave: '\u00C0', Aring: '\u00C5',
  Atilde: '\u00C3', B: 'B', C: 'C', Ccedilla: '\u00C7', D: 'D', E: 'E', Eacute: '\u00C9', Ecircumflex: '\u00CA',
  Edieresis: '\u00CB', Egrave: '\u00C8', Eth: '\u00D0', Euro: '\u20AC', F: 'F', G: 'G', H: 'H', I: 'I',
  Iacute: '\u00CD', Icircumflex: '\u00CE', Idieresis: '\u00CF', Igrave: '\u00CC', J: 'J', K: 'K', L: 'L',
  Lslash: '\u0141', M: 'M', N: 'N', Ntilde: '\u00D1', O: 'O', OE: '\u0152', Oacute: '\u00D3', Ocircumflex: '\u00D4',
  Odieresis: '\u00D6', Ograve: '\u00D2', Omega: '\u03A9', Oslash: '\u00D8', Otilde: '\u00D5', P: 'P', Q: 'Q', R: 'R', S: 'S',
  Scaron: '\u0160', T: 'T', Thorn: '\u00DE', U: 'U', Uacute: '\u00DA', Ucircumflex: '\u00DB', Udieresis: '\u00DC',
  Ugrave: '\u00D9', V: 'V', W: 'W', X: 'X', Y: 'Y', Yacute: '\u00DD', Ydieresis: '\u0178', Z: 'Z',
  Delta: '\u2206', Zcaron: '\u017D', a: 'a', aacute: '\u00E1', acircumflex: '\u00E2', acute: '\u00B4', adieresis: '\u00E4',
  ae: '\u00E6', agrave: '\u00E0', ampersand: '&', apple: '\uF8FF', approxequal: '\u2248', aring: '\u00E5', asciicircum: '^', asciitilde: '~',
  asterisk: '*', at: '@', atilde: '\u00E3', b: 'b', backslash: '\\', bar: '|', braceleft: '{', braceright: '}',
  bracketleft: '[', bracketright: ']', breve: '\u02D8', brokenbar: '\u00A6', bullet: '\u2022', c: 'c',
  caron: '\u02C7', ccedilla: '\u00E7', cedilla: '\u00B8', cent: '\u00A2', circumflex: '\u02C6', colon: ':',
  comma: ',', copyright: '\u00A9', currency: '\u00A4', d: 'd', dagger: '\u2020', daggerdbl: '\u2021',
  degree: '\u00B0', dieresis: '\u00A8', divide: '\u00F7', dollar: '$', dotaccent: '\u02D9', dotlessi: '\u0131',
  e: 'e', eacute: '\u00E9', ecircumflex: '\u00EA', edieresis: '\u00EB', egrave: '\u00E8', eight: '8',
  ellipsis: '\u2026', emdash: '\u2014', endash: '\u2013', equal: '=', eth: '\u00F0', exclam: '!',
  exclamdown: '\u00A1', f: 'f', fi: '\uFB01', five: '5', fl: '\uFB02', florin: '\u0192', four: '4',
  fraction: '\u2044', g: 'g', germandbls: '\u00DF', grave: '`', greater: '>', greaterequal: '\u2265', guillemotleft: '\u00AB',
  guillemotright: '\u00BB', guilsinglleft: '\u2039', guilsinglright: '\u203A', h: 'h', hungarumlaut: '\u02DD',
  hyphen: '-', i: 'i', iacute: '\u00ED', icircumflex: '\u00EE', idieresis: '\u00EF', igrave: '\u00EC',
  infinity: '\u221E', integral: '\u222B', j: 'j', k: 'k', l: 'l', less: '<', lessequal: '\u2264', logicalnot: '\u00AC', lozenge: '\u25CA', lslash: '\u0142', m: 'm', macron: '\u00AF',
  mu: '\u00B5', multiply: '\u00D7', n: 'n', nine: '9', nonbreakingspace: '\u00A0', notequal: '\u2260', ntilde: '\u00F1', numbersign: '#', o: 'o',
  oacute: '\u00F3', ocircumflex: '\u00F4', odieresis: '\u00F6', oe: '\u0153', ogonek: '\u02DB', ograve: '\u00F2',
  one: '1', onehalf: '\u00BD', onequarter: '\u00BC', onesuperior: '\u00B9', ordfeminine: '\u00AA',
  ordmasculine: '\u00BA', oslash: '\u00F8', otilde: '\u00F5', p: 'p', paragraph: '\u00B6', parenleft: '(',
  parenright: ')', partialdiff: '\u2202', percent: '%', period: '.', periodcentered: '\u00B7', perthousand: '\u2030', pi: '\u03C0', plus: '+',
  plusminus: '\u00B1', product: '\u220F', q: 'q', question: '?', questiondown: '\u00BF', quotedbl: '"', quotedblbase: '\u201E',
  quotedblleft: '\u201C', quotedblright: '\u201D', quoteleft: '\u2018', quoteright: '\u2019',
  quotesinglbase: '\u201A', quotesingle: '\'', r: 'r', registered: '\u00AE', ring: '\u02DA', s: 's',
  radical: '\u221A', scaron: '\u0161', section: '\u00A7', semicolon: ';', seven: '7', sfthyphen: '\u00AD', six: '6', slash: '/', space: ' ',
  sterling: '\u00A3', summation: '\u2211', t: 't', thorn: '\u00FE', three: '3', threequarters: '\u00BE', threesuperior: '\u00B3',
  tilde: '\u02DC', trademark: '\u2122', two: '2', twosuperior: '\u00B2', u: 'u', uacute: '\u00FA',
  ucircumflex: '\u00FB', udieresis: '\u00FC', ugrave: '\u00F9', underscore: '_', v: 'v', w: 'w', x: 'x',
  y: 'y', yacute: '\u00FD', ydieresis: '\u00FF', yen: '\u00A5', z: 'z', zcaron: '\u017E', zero: '0',
  // Additional standard AGL names seen in real embedded fonts.
  gbreve: '\u011F', danda: '\u0964', doubledanda: '\u0965', minus: '\u2212', dotlessj: '\u0237',
  // Greek alphabet (AGL). Delta/Omega/mu/pi are covered above via the symbol
  // forms; the rest of the letters complete the block.
  Alpha: '\u0391', Beta: '\u0392', Gamma: '\u0393', Epsilon: '\u0395', Zeta: '\u0396', Eta: '\u0397', Theta: '\u0398',
  Iota: '\u0399', Kappa: '\u039A', Lambda: '\u039B', Mu: '\u039C', Nu: '\u039D', Xi: '\u039E', Omicron: '\u039F',
  Pi: '\u03A0', Rho: '\u03A1', Sigma: '\u03A3', Tau: '\u03A4', Upsilon: '\u03A5', Phi: '\u03A6', Chi: '\u03A7', Psi: '\u03A8',
  alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4', epsilon: '\u03B5', zeta: '\u03B6', eta: '\u03B7',
  theta: '\u03B8', iota: '\u03B9', kappa: '\u03BA', lambda: '\u03BB', nu: '\u03BD', xi: '\u03BE', omicron: '\u03BF',
  rho: '\u03C1', sigma: '\u03C3', sigma1: '\u03C2', tau: '\u03C4', upsilon: '\u03C5', phi: '\u03C6', chi: '\u03C7', psi: '\u03C8', omega: '\u03C9',
}

const GLYPH_NAME_BY_UNICODE = buildGlyphNameByUnicode()

function buildGlyphNameByUnicode(): Map<string, string> {
  const out = new Map<string, string>()
  const names = Object.keys(GLYPH_UNICODE)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    const value = GLYPH_UNICODE[name]!
    if (!out.has(value)) out.set(value, name)
  }
  return out
}
