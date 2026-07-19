import { PdfDocument, PdfName, PdfStream, type PdfDict, type PdfValue } from './pdf-parser.js'
import { resolveStandardFontName, getStandardFontMetrics } from './standard-font-metrics.js'
import {
  decodeSimpleFontBytes,
  macOsRomanCodeForGlyphName,
  simpleFontGlyphName,
  simpleFontIsSymbolic,
  standardEncodingGlyphNames,
  symbolicTrueTypeGlyphId,
} from './pdf-encoding.js'
import type { ImportedFontInfo, PdfFontResolver } from './pdf-page-importer.js'
import { Font } from '../font.js'
import { cffGlyphName, parseCff, parseCffGlyph } from '../parsers/cff-parser.js'
import { parseType1 } from '../parsers/type1-parser.js'
import { BinaryReader } from '../binary/reader.js'
import { PdfCMap, identityPdfCMap, parsePdfCMap, type PdfDecodedCode } from './pdf-cmap.js'
import { adobeCMapResource } from './adobe-cmap-resources.js'

export interface PdfTextMetrics {
  /** Total glyph advance in 1/1000 text-space units */
  units: number
  /** Number of glyphs consumed */
  glyphs: number
  /** Number of single-byte space codes (0x20) subject to word spacing */
  spaces: number
}

export interface PdfGlyphOutline {
  commands: Uint8Array
  coords: Float32Array
}

export interface PdfVerticalMetrics {
  /** Vertical origin y offset from the horizontal origin (1/1000 em, default 880) */
  vy: number
  /** Vertical displacement per glyph (1/1000 em, negative = downward, default -1000) */
  w1: number
}

export interface PdfVerticalGlyphMetrics extends PdfVerticalMetrics {
  /** Horizontal coordinate of the vertical origin. */
  vx: number
}

export type PdfFontMatrix = [number, number, number, number, number, number]

export interface PdfType3Font {
  fontMatrix: PdfFontMatrix
  resources: PdfDict | null
  hasCharProc(code: number): boolean
  charProc(code: number): PdfStream | null
}

interface PdfGlyphSource {
  contains(glyph: number): boolean
  isNotdef(glyph: number): boolean
  advance(glyph: number): number | null
  outline(glyph: number, ppem?: number): PdfGlyphOutline
}

export interface PdfFontDecoder {
  baseFont: string
  familyName: string
  subtype: string
  info: ImportedFontInfo
  /** True for vertical writing mode CMaps (Identity-V etc.) */
  vertical: boolean
  /** Default vertical metrics (/DW2) for vertical fonts */
  verticalMetrics: PdfVerticalMetrics
  /**
   * Total vertical displacement of a 2-byte code string in 1/1000 em
   * (positive = downward), using per-CID /W2 metrics with the /DW2 default.
   */
  verticalAdvance(bytes: Uint8Array): number
  /** Per-character vertical displacement and origin after W2/DW2 resolution. */
  verticalGlyphMetrics(code: PdfDecodedCode): PdfVerticalGlyphMetrics
  /**
   * True when the font carries no Unicode mapping (CID-keyed CFF without
   * ToUnicode). Text must then be imported as glyph outline paths.
   */
  outlineOnly: boolean
  /** Whether the embedded font program can provide exact glyph outlines. */
  hasGlyphOutlines: boolean
  /** Splits a PDF string using the font CMap's 1-to-4-byte code-space ranges. */
  codes(bytes: Uint8Array): PdfDecodedCode[]
  /** Resolves one character code through cidchar/cidrange/notdef mappings. */
  cid(code: PdfDecodedCode): number
  /** Tests whether the embedded font contains the exact glyph selected by the PDF character code. */
  hasGlyph(cid: number): boolean
  /** Tests whether the character code resolves to glyph 0 or the .notdef character procedure. */
  isNotdef(cid: number): boolean
  /** Embedded-program advance in 1/1000 text-space units, or null for Type 3 fonts. */
  glyphAdvance(cid: number): number | null
  decode(bytes: Uint8Array): string
  metrics(bytes: Uint8Array): PdfTextMetrics
  /** Glyph outline in 1/1000 em glyph space (y-up). The argument is a CID for Type0 and a character code for simple fonts. */
  glyphOutline(cid: number, ppem?: number): PdfGlyphOutline
  /** Type3 glyph program access; null for all other font subtypes */
  type3: PdfType3Font | null
}

export function createFontDecoder(doc: PdfDocument, fontValue: PdfValue, fontResolver?: PdfFontResolver): PdfFontDecoder {
  const font = doc.resolve(fontValue)
  if (!(font instanceof Map)) {
    throw new Error('PDF import error: font resource must be a dictionary')
  }
  const subtype = nameValue(doc.resolve(font.get('Subtype') ?? null), 'font subtype')
  const baseFont = optionalName(doc.resolve(font.get('BaseFont') ?? null)) ?? 'Unknown'
  const familyName = stripSubsetPrefix(baseFont)
  const encodingCMap = subtype === 'Type0' ? loadEncodingCMap(doc, font) : null
  const toUnicode = loadToUnicodeCMap(doc, font)
  const descriptor = resolveFontDescriptor(doc, font)
  const cidWidths = subtype === 'Type0' ? readCidWidthsData(doc, font) : null
  const metrics = buildMetricsResolver(doc, font, descriptor, subtype, encodingCMap, cidWidths)
  const flags = numberValue(doc.resolve(descriptor?.get('Flags') ?? null), 0)
  const info: ImportedFontInfo = {
    baseFont,
    familyName,
    subtype,
    flags,
    italic: (flags & 0x40) !== 0,
    serif: (flags & 0x02) !== 0,
    fixedPitch: (flags & 0x01) !== 0,
    bold: (flags & 0x40000) !== 0 || /bold/i.test(baseFont),
  }
  attachFontFile(doc, descriptor, info)
  if (info.fontFile === undefined && fontResolver !== undefined) {
    const resolved = fontResolver(info)
    if (resolved !== null) {
      info.fontFile = new Uint8Array(resolved.data)
      info.fontFileFormat = resolved.format
    }
  }
  // Predefined UTF-16/UCS-2 CMaps carry Unicode code points directly
  const encodingName = optionalName(doc.resolve(font.get('Encoding') ?? null))
  const unicodeSourceEncoding = subtype === 'Type0' && encodingName !== null
    ? sourceUnicodeEncoding(encodingName)
    : null
  const vertical = encodingCMap?.wMode === 1
  const verticalMetrics = vertical ? readVerticalMetrics(doc, font) : { vy: 880, w1: -1000 }
  const verticalWidths = vertical ? readVerticalWidths(doc, font) : null
  const type3 = subtype === 'Type3' ? readType3Font(doc, font) : null
  const needsEmbeddedMapping = toUnicode === null && subtype === 'Type0' && !unicodeSourceEncoding
  const embeddedDecoder = needsEmbeddedMapping && (info.fontFileFormat === 'truetype' || info.fontFileFormat === 'opentype')
    ? createEmbeddedType0Decoder(doc, font, info, encodingCMap!)
    : null
  // A Type0 font that yields no Unicode (CID-keyed bare CFF, or a subset with no
  // 'cmap' and no /ToUnicode) carries no text; its glyphs are imported as outline
  // paths instead of staticText. Bare CFF maps CID→GID via its charset; embedded
  // TrueType/OpenType subsets map through /CIDToGIDMap.
  const glyphSource = info.fontFile === undefined
    ? null
    : subtype === 'Type0'
      ? (info.fontFileFormat === 'cff'
          ? createCffOutlineSource(info.fontFile)
          : (info.fontFileFormat === 'truetype' || info.fontFileFormat === 'opentype')
              ? createEmbeddedType0OutlineSource(doc, font, info)
              : null)
      : createEmbeddedSimpleOutlineSource(doc, font, info)
  const outlineOnly = needsEmbeddedMapping && embeddedDecoder === null && glyphSource !== null

  return {
    baseFont,
    familyName,
    subtype,
    info,
    vertical,
    verticalMetrics,
    type3,
    outlineOnly,
    hasGlyphOutlines: glyphSource !== null,
    codes(bytes: Uint8Array): PdfDecodedCode[] {
      if (encodingCMap !== null) return encodingCMap.decode(bytes)
      const result = new Array<PdfDecodedCode>(bytes.length)
      for (let i = 0; i < bytes.length; i++) result[i] = { code: bytes[i]!, length: 1, start: i, end: i + 1 }
      return result
    },
    cid(code: PdfDecodedCode): number {
      return encodingCMap === null ? code.code : encodingCMap.cid(code)
    },
    hasGlyph(cid: number): boolean {
      if (type3 !== null) return type3.hasCharProc(cid)
      return glyphSource !== null && glyphSource.contains(cid)
    },
    isNotdef(cid: number): boolean {
      if (type3 !== null) return simpleFontGlyphName(doc, font, cid) === '.notdef'
      if (glyphSource !== null) return glyphSource.isNotdef(cid)
      if (subtype !== 'Type0') return simpleFontGlyphName(doc, font, cid) === '.notdef'
      return cid === 0
    },
    glyphAdvance(cid: number): number | null {
      return glyphSource?.advance(cid) ?? null
    },
    decode(bytes: Uint8Array): string {
      if (toUnicode !== null) return decodeWithToUnicode(bytes, toUnicode)
      if (subtype === 'Type0') {
        if (unicodeSourceEncoding !== null) return decodeUnicodeSource(bytes, unicodeSourceEncoding)
        // No /ToUnicode, no embedded cmap, and no embedded outlines to draw
        // (outlineOnly is false here): a non-embedded CID font, typical of a
        // scanned page's invisible OCR text layer. The text carries no
        // recoverable Unicode and nothing to render, so the run contributes
        // nothing rather than failing the whole page.
        if (embeddedDecoder === null) return ''
        return embeddedDecoder(bytes)
      }
      return decodeSimpleFontBytes(doc, font, bytes)
    },
    metrics(bytes: Uint8Array): PdfTextMetrics {
      return metrics(bytes)
    },
    verticalAdvance(bytes: Uint8Array): number {
      let total = 0
      for (const code of encodingCMap!.decode(bytes)) {
        total += -this.verticalGlyphMetrics(code).w1
      }
      return total
    },
    verticalGlyphMetrics(code: PdfDecodedCode): PdfVerticalGlyphMetrics {
      if (encodingCMap === null || cidWidths === null) throw new Error('PDF import error: vertical metrics require a Type0 font')
      const cid = encodingCMap.cid(code)
      const explicit = verticalWidths?.get(cid)
      if (explicit !== undefined) return explicit
      const width = cidWidths.widths.get(cid) ?? cidWidths.defaultWidth
      return { w1: verticalMetrics.w1, vx: width / 2, vy: verticalMetrics.vy }
    },
    glyphOutline(cid: number, ppem?: number): PdfGlyphOutline {
      if (glyphSource === null) throw new Error('PDF import error: glyph outlines are unavailable for this font')
      return glyphSource.outline(cid, ppem)
    },
  }
}

function createEmbeddedSimpleOutlineSource(
  doc: PdfDocument,
  font: PdfDict,
  info: ImportedFontInfo,
): PdfGlyphSource | null {
  if (info.fontFile === undefined || info.fontFileFormat === undefined) return null
  if (info.fontFileFormat === 'type1') {
    const type1 = parseType1(info.fontFile, standardEncodingGlyphNames())
    return {
      contains(code: number): boolean {
        const glyphName = simpleFontGlyphName(doc, font, code)
        return glyphName !== '.notdef' && type1.getOutline(glyphName) !== null
      },
      isNotdef(code: number): boolean {
        return simpleFontGlyphName(doc, font, code) === '.notdef'
      },
      advance(code: number): number | null {
        const width = type1.getAdvanceWidth(simpleFontGlyphName(doc, font, code))
        return width === null ? null : width * type1.fontMatrix[0]! * 1000
      },
      outline(code: number, ppem?: number): PdfGlyphOutline {
        const glyphName = simpleFontGlyphName(doc, font, code)
        const outline = ppem === undefined
          ? type1.getOutline(glyphName) ?? type1.getOutline('.notdef')
          : type1.getHintedOutline(glyphName, ppem) ?? type1.getHintedOutline('.notdef', ppem)
        if (outline === null) return { commands: new Uint8Array(), coords: new Float32Array() }
        return transformType1Outline(outline, type1.fontMatrix)
      },
    }
  }
  if (info.fontFileFormat === 'cff') {
    const cff = parseCff(new BinaryReader(arrayBufferFromBytes(info.fontFile)))
    const nameToGid = new Map<string, number>()
    for (let gid = 0; gid < cff.charstrings.count; gid++) nameToGid.set(cffGlyphName(cff, gid), gid)
    const unitScale = cff.fontMatrix === null ? 1 : cff.fontMatrix[0]! * 1000
    return {
      contains(code: number): boolean {
        const gid = nameToGid.get(simpleFontGlyphName(doc, font, code))
        return gid !== undefined && gid !== 0
      },
      isNotdef(code: number): boolean {
        return (nameToGid.get(simpleFontGlyphName(doc, font, code)) ?? 0) === 0
      },
      advance(code: number): number | null {
        const gid = nameToGid.get(simpleFontGlyphName(doc, font, code))
        return gid === undefined ? null : parseCffGlyph(cff, gid).width * unitScale
      },
      outline(code: number): PdfGlyphOutline {
        const gid = nameToGid.get(simpleFontGlyphName(doc, font, code)) ?? 0
        return scaleOutline(parseCffGlyph(cff, gid).outline, unitScale)
      },
    }
  }
  const embedded = Font.load(arrayBufferFromBytes(info.fontFile))
  const nameToGid = new Map<string, number>()
  for (let gid = 0; gid < embedded.numGlyphs; gid++) {
    const name = embedded.getGlyphName(gid)
    if (name !== null && !nameToGid.has(name)) nameToGid.set(name, gid)
  }
  const unitScale = 1000 / embedded.metrics.unitsPerEm
  const glyphId = function (code: number): number {
    if (simpleFontIsSymbolic(doc, font)) return symbolicTrueTypeGlyphId(embedded, code)
    const glyphName = simpleFontGlyphName(doc, font, code)
    const decoded = decodeSimpleFontBytes(doc, font, new Uint8Array([code]))
    return nonsymbolicTrueTypeGlyphId(embedded, glyphName, decoded, nameToGid)
  }
  return {
    contains(code: number): boolean {
      const gid = glyphId(code)
      return gid > 0 && gid < embedded.numGlyphs
    },
    isNotdef(code: number): boolean {
      return glyphId(code) === 0
    },
    advance(code: number): number | null {
      const gid = glyphId(code)
      return gid >= 0 && gid < embedded.numGlyphs ? embedded.getAdvanceWidth(gid) * unitScale : null
    },
    outline(code: number): PdfGlyphOutline {
      return scaleOutline(embedded.getGlyph(glyphId(code)).outline, unitScale)
    },
  }
}

function nonsymbolicTrueTypeGlyphId(
  font: Font,
  glyphName: string,
  unicode: string,
  postNames: Map<string, number>,
): number {
  const records = font.cmap.encodingRecords
  const codePoint = unicode.length === 0 ? null : unicode.codePointAt(0)!
  const singleCodePoint = codePoint !== null && unicode.length === (codePoint > 0xFFFF ? 2 : 1)
  if (singleCodePoint) {
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      if (record.platformId === 3 && record.encodingId === 1 && record.mapping !== null) {
        const glyphId = record.mapping.getGlyphId(codePoint)
        if (glyphId !== 0) return glyphId
        break
      }
    }
  }
  const macCode = macOsRomanCodeForGlyphName(glyphName)
  if (macCode !== null) {
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      if (record.platformId === 1 && record.encodingId === 0 && record.mapping !== null) {
        const glyphId = record.mapping.getGlyphId(macCode)
        if (glyphId !== 0) return glyphId
        break
      }
    }
  }
  return postNames.get(glyphName) ?? 0
}

function transformType1Outline(outline: PdfGlyphOutline, matrix: number[]): PdfGlyphOutline {
  const coords = new Float32Array(outline.coords.length)
  for (let i = 0; i < coords.length; i += 2) {
    const x = outline.coords[i]!
    const y = outline.coords[i + 1]!
    coords[i] = (matrix[0]! * x + matrix[2]! * y + matrix[4]!) * 1000
    coords[i + 1] = (matrix[1]! * x + matrix[3]! * y + matrix[5]!) * 1000
  }
  return { commands: outline.commands, coords }
}

function readType3Font(doc: PdfDocument, font: PdfDict): PdfType3Font {
  const charProcs = doc.resolve(font.get('CharProcs') ?? null)
  if (!(charProcs instanceof Map)) throw new Error('PDF import error: Type3 font requires a CharProcs dictionary')
  const resourcesValue = doc.resolve(font.get('Resources') ?? null)
  if (resourcesValue !== null && !(resourcesValue instanceof Map)) throw new Error('PDF import error: Type3 Resources must be a dictionary')
  const resources: PdfDict | null = resourcesValue instanceof Map ? resourcesValue : null
  const fontMatrix = readType3FontMatrix(doc, font)
  return {
    fontMatrix,
    resources,
    hasCharProc(code: number): boolean {
      const glyphName = simpleFontGlyphName(doc, font, code)
      return glyphName !== '.notdef' && charProcs.has(glyphName)
    },
    charProc(code: number): PdfStream | null {
      const glyphName = simpleFontGlyphName(doc, font, code)
      let value = doc.resolve(charProcs.get(glyphName) ?? null)
      if (value === null && glyphName !== '.notdef') value = doc.resolve(charProcs.get('.notdef') ?? null)
      if (value === null) return null
      if (!(value instanceof PdfStream)) throw new Error(`PDF import error: Type3 CharProc /${glyphName} must be a stream`)
      return value
    },
  }
}

function readType3FontMatrix(doc: PdfDocument, font: PdfDict): PdfFontMatrix {
  const matrix = doc.resolve(font.get('FontMatrix') ?? null)
  if (matrix === null) return [0.001, 0, 0, 0.001, 0, 0]
  if (!Array.isArray(matrix) || matrix.length < 6) throw new Error('PDF import error: Type3 FontMatrix must be an array')
  const out: number[] = []
  for (let i = 0; i < 6; i++) {
    const value = doc.resolve(matrix[i]!)
    if (typeof value !== 'number') throw new Error('PDF import error: Type3 FontMatrix values must be numbers')
    out.push(value)
  }
  return out as PdfFontMatrix
}

/** Builds a CID -> glyph outline source from a bare CFF font program. */
// A Type0 font (CIDFontType2 or CFF-in-OpenType) with neither a /ToUnicode CMap
// nor a 'cmap' in its embedded subset carries no Unicode information; its text is
// imported as glyph outlines instead. The CID maps to a GID through the font's
// /CIDToGIDMap (Identity by default), and the glyf/CFF outline is taken directly.
function createEmbeddedType0OutlineSource(
  doc: PdfDocument,
  font: PdfDict,
  info: ImportedFontInfo,
): PdfGlyphSource | null {
  if (!info.fontFile) return null
  if (info.fontFileFormat === 'type1') return null
  const embedded = Font.load(arrayBufferFromBytes(info.fontFile))
  const descendant = resolveDescendantFont(doc, font)
  const cidToGid = buildCidToGidResolver(doc, descendant)
  // Glyph outlines feed appendGlyphOutline, which assumes the standard
  // 1000-units/em text-space convention; TrueType outlines are in font units
  // (commonly 2048/em) and must be normalized.
  const unitScale = 1000 / embedded.metrics.unitsPerEm
  return {
    contains(cid: number): boolean {
      const gid = cidToGid(cid)
      return gid > 0 && gid < embedded.numGlyphs
    },
    isNotdef(cid: number): boolean {
      return cidToGid(cid) === 0
    },
    advance(cid: number): number | null {
      const gid = cidToGid(cid)
      return gid >= 0 && gid < embedded.numGlyphs ? embedded.getAdvanceWidth(gid) * unitScale : null
    },
    outline(cid: number): PdfGlyphOutline {
      const outline = embedded.getGlyph(cidToGid(cid)).outline
      return scaleOutline(outline, unitScale)
    },
  }
}

function scaleOutline(outline: PdfGlyphOutline, scale: number): PdfGlyphOutline {
  if (scale === 1) return outline
  const coords = new Float32Array(outline.coords.length)
  for (let i = 0; i < coords.length; i++) coords[i] = outline.coords[i]! * scale
  return { commands: outline.commands, coords }
}

function createCffOutlineSource(fontFile: Uint8Array): PdfGlyphSource {
  const buffer = fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength) as ArrayBuffer
  const cff = parseCff(new BinaryReader(buffer))
  // charset maps GID -> CID for CID-keyed fonts; invert it for lookup
  const cidToGid = new Map<number, number>()
  for (let gid = 0; gid < cff.charset.length; gid++) {
    if (!cidToGid.has(cff.charset[gid]!)) cidToGid.set(cff.charset[gid]!, gid)
  }
  // Normalize by the CFF FontMatrix to the 1000-units/em convention: the
  // default matrix 0.001 leaves outlines unchanged; nonstandard scales
  // (e.g. 0.0005 for 2000/em) rescale accordingly.
  const m = cff.fontMatrix
  const unitScale = m === null ? 1 : m[0]! * 1000
  return {
    contains(cid: number): boolean {
      const gid = cidToGid.get(cid)
      return gid !== undefined && gid !== 0
    },
    isNotdef(cid: number): boolean {
      return (cidToGid.get(cid) ?? 0) === 0
    },
    advance(cid: number): number | null {
      const gid = cidToGid.get(cid)
      return gid === undefined ? null : parseCffGlyph(cff, gid).width * unitScale
    },
    outline(cid: number): PdfGlyphOutline {
      const gid = cidToGid.get(cid) ?? 0
      return scaleOutline(parseCffGlyph(cff, gid).outline, unitScale)
    },
  }
}

type MetricsResolver = (bytes: Uint8Array) => PdfTextMetrics
type TextDecoder = (bytes: Uint8Array) => string

function buildMetricsResolver(
  doc: PdfDocument,
  font: PdfDict,
  descriptor: PdfDict | null,
  subtype: string,
  cmap: PdfCMap | null,
  cidWidths: CidWidthsData | null,
): MetricsResolver {
  if (subtype === 'Type0') return buildCidMetricsResolver(cmap!, cidWidths!)
  return buildSimpleMetricsResolver(doc, font, descriptor, subtype)
}

function buildSimpleMetricsResolver(doc: PdfDocument, font: PdfDict, descriptor: PdfDict | null, subtype: string): MetricsResolver {
  const firstCharValue = doc.resolve(font.get('FirstChar') ?? null)
  const widthsValue = doc.resolve(font.get('Widths') ?? null)
  // Type3 glyph metrics live in the glyph space defined by /FontMatrix.
  // Rescale to the standard 1/1000 text-space convention.
  const unitScale = subtype === 'Type3' ? type3UnitScale(doc, font) : 1
  const missingWidth = numberValue(doc.resolve(descriptor?.get('MissingWidth') ?? null), 0) * unitScale
  let widths: number[] | null = null
  let firstChar = 0
  if (typeof firstCharValue === 'number' && Array.isArray(widthsValue)) {
    firstChar = firstCharValue
    widths = []
    for (let i = 0; i < widthsValue.length; i++) {
      const width = doc.resolve(widthsValue[i]!)
      if (typeof width !== 'number') throw new Error('PDF import error: simple font Widths array must contain numbers')
      widths.push(width * unitScale)
    }
  } else {
    // ISO 32000-1 9.6.2.2: the standard 14 fonts may omit /Widths because
    // their metrics are assumed known — supply the built-in AFM widths
    const baseFontValue = doc.resolve(font.get('BaseFont') ?? null)
    if (baseFontValue instanceof PdfName) {
      const standardName = resolveStandardFontName(baseFontValue.name)
      if (standardName !== null) {
        const metrics = getStandardFontMetrics(standardName)!
        firstChar = 0
        widths = metrics.widths
      }
    }
  }
  return function simpleMetricsResolver(bytes: Uint8Array): PdfTextMetrics {
    let units = 0
    let spaces = 0
    for (let i = 0; i < bytes.length; i++) {
      if (widths !== null) {
        const index = bytes[i]! - firstChar
        units += index >= 0 && index < widths.length ? widths[index]! : missingWidth
      } else {
        units += missingWidth
      }
      if (bytes[i] === 0x20) spaces++
    }
    return { units, glyphs: bytes.length, spaces }
  }
}

function type3UnitScale(doc: PdfDocument, font: PdfDict): number {
  const matrix = doc.resolve(font.get('FontMatrix') ?? null)
  if (!Array.isArray(matrix) || matrix.length < 6) return 1
  const a = doc.resolve(matrix[0]!)
  if (typeof a !== 'number') throw new Error('PDF import error: Type3 FontMatrix values must be numbers')
  return Math.abs(a) * 1000
}

interface CidWidthsData {
  defaultWidth: number
  widths: Map<number, number>
}

function readCidWidthsData(doc: PdfDocument, font: PdfDict): CidWidthsData {
  const descendant = resolveDescendantFont(doc, font)
  const defaultWidthValue = doc.resolve(descendant.get('DW') ?? null)
  if (defaultWidthValue !== null && typeof defaultWidthValue !== 'number') throw new Error('PDF import error: CIDFont DW must be a number')
  const defaultWidth = numberValue(defaultWidthValue, 1000)
  const widths = new Map<number, number>()
  const w = doc.resolve(descendant.get('W') ?? null)
  if (w !== null) {
    if (!Array.isArray(w)) throw new Error('PDF import error: CIDFont W must be an array')
    readCidWidths(doc, w, widths)
  }
  return { defaultWidth, widths }
}

function buildCidMetricsResolver(cmap: PdfCMap, data: CidWidthsData): MetricsResolver {
  return function cidMetricsResolver(bytes: Uint8Array): PdfTextMetrics {
    let units = 0
    let glyphs = 0
    const codes = cmap.decode(bytes)
    for (let i = 0; i < codes.length; i++) {
      const cid = cmap.cid(codes[i]!)
      units += data.widths.get(cid) ?? data.defaultWidth
      glyphs++
    }
    return { units, glyphs, spaces: 0 }
  }
}

function readCidWidths(doc: PdfDocument, values: PdfValue[], widths: Map<number, number>): void {
  for (let i = 0; i < values.length;) {
    const first = doc.resolve(values[i++]!)
    assertCid(first, 'CIDFont W entry')
    const second = doc.resolve(values[i++]!)
    if (Array.isArray(second)) {
      if (first + second.length - 1 > 0xFFFF) throw new Error('PDF import error: CIDFont W width array exceeds CID 65535')
      for (let j = 0; j < second.length; j++) {
        const width = doc.resolve(second[j]!)
        if (typeof width !== 'number') throw new Error('PDF import error: CIDFont W width array must contain numbers')
        widths.set(first + j, width)
      }
    } else if (typeof second === 'number') {
      assertCid(second, 'CIDFont W range end')
      if (second < first) throw new Error('PDF import error: CIDFont W range is reversed')
      const width = doc.resolve(values[i++]!)
      if (typeof width !== 'number') throw new Error('PDF import error: CIDFont W range width must be a number')
      for (let cid = first; cid <= second; cid++) widths.set(cid, width)
    } else {
      throw new Error('PDF import error: CIDFont W entry must contain an array or range')
    }
  }
}

/** Reads /DW2 (default vertical metrics) from the descendant CIDFont */
function readVerticalMetrics(doc: PdfDocument, font: PdfDict): PdfVerticalMetrics {
  const descendant = resolveDescendantFont(doc, font)
  const dw2 = doc.resolve(descendant.get('DW2') ?? null)
  if (dw2 !== null && (!Array.isArray(dw2) || dw2.length !== 2)) throw new Error('PDF import error: CIDFont DW2 must contain exactly two numbers')
  if (Array.isArray(dw2)) {
    const vy = doc.resolve(dw2[0]!)
    const w1 = doc.resolve(dw2[1]!)
    if (typeof vy !== 'number' || typeof w1 !== 'number') throw new Error('PDF import error: CIDFont DW2 values must be numbers')
    return { vy, w1 }
  }
  return { vy: 880, w1: -1000 }
}

/**
 * Per-CID vertical displacements from /W2 (ISO 32000 9.7.4.3):
 * entries are either `c [w1y vx vy ...]` (triples for consecutive CIDs
 * starting at c) or `cFirst cLast w1y vx vy`.
 */
function readVerticalWidths(doc: PdfDocument, font: PdfDict): Map<number, PdfVerticalGlyphMetrics> | null {
  const descendant = resolveDescendantFont(doc, font)
  const w2 = doc.resolve(descendant.get('W2') ?? null)
  if (!Array.isArray(w2)) return null
  const map = new Map<number, PdfVerticalGlyphMetrics>()
  let i = 0
  while (i < w2.length) {
    const first = doc.resolve(w2[i]!)
    assertCid(first, 'W2 entry')
    const second = doc.resolve(w2[i + 1] ?? null)
    if (Array.isArray(second)) {
      for (let t = 0; t + 2 < second.length; t += 3) {
        const w1y = doc.resolve(second[t]!)
        const vx = doc.resolve(second[t + 1]!)
        const vy = doc.resolve(second[t + 2]!)
        if (typeof w1y !== 'number' || typeof vx !== 'number' || typeof vy !== 'number') {
          throw new Error('PDF import error: W2 triple must be numeric')
        }
        map.set(first + t / 3, { w1: w1y, vx, vy })
      }
      if (second.length % 3 !== 0) throw new Error('PDF import error: W2 triples must come in groups of three')
      if (first + second.length / 3 - 1 > 0xFFFF) throw new Error('PDF import error: W2 triples exceed CID 65535')
      i += 2
    } else if (typeof second === 'number') {
      assertCid(second, 'W2 range end')
      if (second < first) throw new Error('PDF import error: W2 range is reversed')
      const w1y = doc.resolve(w2[i + 2] ?? null)
      const vx = doc.resolve(w2[i + 3] ?? null)
      const vy = doc.resolve(w2[i + 4] ?? null)
      if (typeof w1y !== 'number' || typeof vx !== 'number' || typeof vy !== 'number') {
        throw new Error('PDF import error: W2 range entry requires w1y, vx, and vy')
      }
      for (let c = first; c <= second; c++) map.set(c, { w1: w1y, vx, vy })
      i += 5
    } else {
      throw new Error('PDF import error: invalid W2 array entry')
    }
  }
  return map
}

function resolveDescendantFont(doc: PdfDocument, font: PdfDict): PdfDict {
  const descendants = doc.resolve(font.get('DescendantFonts') ?? null)
  if (!Array.isArray(descendants) || descendants.length !== 1) throw new Error('PDF import error: Type0 font DescendantFonts must contain exactly one font')
  const descendant = doc.resolve(descendants[0]!)
  if (!(descendant instanceof Map)) throw new Error('PDF import error: descendant font must be a dictionary')
  const subtype = doc.resolve(descendant.get('Subtype') ?? null)
  if (!(subtype instanceof PdfName) || (subtype.name !== 'CIDFontType0' && subtype.name !== 'CIDFontType2')) {
    throw new Error('PDF import error: Type0 descendant must be CIDFontType0 or CIDFontType2')
  }
  return descendant
}

function createEmbeddedType0Decoder(doc: PdfDocument, font: PdfDict, info: ImportedFontInfo, cmap: PdfCMap): TextDecoder | null {
  if (!info.fontFile) return null
  if (info.fontFileFormat === 'type1') return null
  const embedded = Font.load(arrayBufferFromBytes(info.fontFile))
  // Embedded subset fonts are addressed by CID/GID and frequently omit 'cmap'.
  // With no ToUnicode and no cmap there is no way to recover Unicode, so the run
  // is left to render as glyph outlines instead (handled by the caller).
  if (!embedded.hasCmap) return null
  const glyphToUnicode = new Map<number, string>()
  for (const [codePoint, glyphId] of embedded.cmap.entries()) {
    if (glyphId !== 0 && !glyphToUnicode.has(glyphId)) glyphToUnicode.set(glyphId, String.fromCodePoint(codePoint))
  }
  const descendant = resolveDescendantFont(doc, font)
  const cidToGid = buildCidToGidResolver(doc, descendant)
  return function embeddedType0Decoder(bytes: Uint8Array): string {
    let out = ''
    const codes = cmap.decode(bytes)
    for (let i = 0; i < codes.length; i++) {
      const cid = cmap.cid(codes[i]!)
      const gid = cidToGid(cid)
      const value = glyphToUnicode.get(gid)
      if (value !== undefined) out += value
    }
    return out
  }
}

function buildCidToGidResolver(doc: PdfDocument, descendant: PdfDict): (cid: number) => number {
  const value = doc.resolve(descendant.get('CIDToGIDMap') ?? null)
  if (value === null) return identityCidToGid
  if (value instanceof PdfName) {
    if (value.name === 'Identity') return identityCidToGid
    throw new Error(`PDF import error: unsupported CIDToGIDMap /${value.name}`)
  }
  if (value instanceof PdfStream) {
    const data = doc.decodeStream(value)
    if ((data.length & 1) !== 0) throw new Error('PDF import error: CIDToGIDMap stream length must be even')
    return function streamCidToGid(cid: number): number {
      const offset = cid * 2
      if (offset + 1 >= data.length) return 0
      return (data[offset]! << 8) | data[offset + 1]!
    }
  }
  throw new Error('PDF import error: CIDToGIDMap must be a name or stream')
}

function assertCid(value: PdfValue, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xFFFF) {
    throw new Error(`PDF import error: ${label} CID must be an integer from 0 to 65535`)
  }
}

function identityCidToGid(cid: number): number {
  return cid
}

export function collectFontInfos(doc: PdfDocument, resources: PdfDict): ImportedFontInfo[] {
  const fontResources = doc.resolve(resources.get('Font') ?? null)
  if (!(fontResources instanceof Map)) return []
  const infos: ImportedFontInfo[] = []
  const seen = new Set<string>()
  for (const [, value] of fontResources) {
    const decoder = createFontDecoder(doc, value)
    const key = `${decoder.info.baseFont}|${decoder.info.subtype}`
    if (!seen.has(key)) {
      infos.push(decoder.info)
      seen.add(key)
    }
  }
  return infos
}

function loadEncodingCMap(doc: PdfDocument, font: PdfDict): PdfCMap {
  const value = doc.resolve(font.get('Encoding') ?? null)
  if (value instanceof PdfName) return predefinedCMap(value.name)
  if (!(value instanceof PdfStream)) throw new Error('PDF import error: Type0 font Encoding must be a CMap name or stream')
  return parsePdfCMap(doc.decodeStream(value), resolveUseCMap(doc, value.dict), predefinedCMap)
}

function loadToUnicodeCMap(doc: PdfDocument, font: PdfDict): PdfCMap | null {
  const value = doc.resolve(font.get('ToUnicode') ?? null)
  if (value === null) return null
  if (!(value instanceof PdfStream)) throw new Error('PDF import error: ToUnicode must be a CMap stream')
  return parsePdfCMap(doc.decodeStream(value), resolveUseCMap(doc, value.dict), predefinedCMap)
}

function resolveUseCMap(doc: PdfDocument, dict: PdfDict): PdfCMap | null {
  const value = doc.resolve(dict.get('UseCMap') ?? null)
  if (value === null) return null
  if (value instanceof PdfName) return predefinedCMap(value.name)
  if (value instanceof PdfStream) return parsePdfCMap(doc.decodeStream(value), resolveUseCMap(doc, value.dict), predefinedCMap)
  throw new Error('PDF import error: UseCMap must be a name or stream')
}

const predefinedCMapCache = new Map<string, PdfCMap>()
const predefinedCMapLoading = new Set<string>()

function predefinedCMap(name: string): PdfCMap {
  if (name === 'Identity-H') return identityPdfCMap(false)
  if (name === 'Identity-V') return identityPdfCMap(true)
  const cached = predefinedCMapCache.get(name)
  if (cached !== undefined) return cached
  const resource = adobeCMapResource(name)
  if (resource === null) throw new Error(`PDF import error: unknown predefined CMap /${name}`)
  if (predefinedCMapLoading.has(name)) throw new Error(`PDF import error: cyclic predefined CMap /${name}`)
  predefinedCMapLoading.add(name)
  try {
    const cmap = parsePdfCMap(resource, null, predefinedCMap)
    predefinedCMapCache.set(name, cmap)
    return cmap
  } finally {
    predefinedCMapLoading.delete(name)
  }
}

function decodeWithToUnicode(bytes: Uint8Array, cmap: PdfCMap): string {
  let out = ''
  const codes = cmap.decode(bytes)
  for (let i = 0; i < codes.length; i++) {
    // An incomplete ToUnicode CMap has no recoverable Unicode for the missing
    // source code, but the remaining string is still decodable.
    out += cmap.unicode(codes[i]!) ?? '�'
  }
  return out
}

function resolveFontDescriptor(doc: PdfDocument, font: PdfDict): PdfDict | null {
  const direct = doc.resolve(font.get('FontDescriptor') ?? null)
  if (direct instanceof Map) return direct
  const descendants = doc.resolve(font.get('DescendantFonts') ?? null)
  if (Array.isArray(descendants) && descendants.length > 0) {
    const descendant = doc.resolve(descendants[0]!)
    if (descendant instanceof Map) {
      const descriptor = doc.resolve(descendant.get('FontDescriptor') ?? null)
      if (descriptor instanceof Map) return descriptor
    }
  }
  return null
}

function attachFontFile(doc: PdfDocument, descriptor: PdfDict | null, info: ImportedFontInfo): void {
  if (!descriptor) return
  const fontFile2 = doc.resolve(descriptor.get('FontFile2') ?? null)
  if (fontFile2 instanceof PdfStream) {
    info.fontFile = doc.decodeStream(fontFile2)
    info.fontFileFormat = 'truetype'
    return
  }
  const fontFile3 = doc.resolve(descriptor.get('FontFile3') ?? null)
  if (fontFile3 instanceof PdfStream) {
    info.fontFile = doc.decodeStream(fontFile3)
    const subtype = doc.resolve(fontFile3.dict.get('Subtype') ?? null)
    if (!(subtype instanceof PdfName)) throw new Error('PDF import error: FontFile3 requires a Subtype name')
    if (subtype.name === 'Type1C' || subtype.name === 'CIDFontType0C') info.fontFileFormat = 'cff'
    else if (subtype.name === 'OpenType') info.fontFileFormat = 'opentype'
    else throw new Error(`PDF import error: unsupported FontFile3 Subtype /${subtype.name}`)
    return
  }
  const fontFile = doc.resolve(descriptor.get('FontFile') ?? null)
  if (fontFile instanceof PdfStream) {
    info.fontFile = doc.decodeStream(fontFile)
    info.fontFileFormat = 'type1'
  }
}

function decodeUtf16Be(bytes: Uint8Array): string {
  if ((bytes.length & 1) !== 0) throw new Error('PDF import error: UTF-16BE character string has an odd byte length')
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!)
  }
  return out
}

type SourceUnicodeEncoding = 'utf8' | 'utf16be' | 'utf32be'

function sourceUnicodeEncoding(name: string): SourceUnicodeEncoding | null {
  if (name.includes('UTF8')) return 'utf8'
  if (name.includes('UTF16') || name.includes('UCS2')) return 'utf16be'
  if (name.includes('UTF32')) return 'utf32be'
  return null
}

function decodeUnicodeSource(bytes: Uint8Array, encoding: SourceUnicodeEncoding): string {
  if (encoding === 'utf8') return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (encoding === 'utf16be') return decodeUtf16Be(bytes)
  if ((bytes.length & 3) !== 0) throw new Error('PDF import error: UTF-32BE character string length must be divisible by four')
  let result = ''
  for (let i = 0; i < bytes.length; i += 4) {
    const codePoint = bytes[i]! * 0x1000000 + bytes[i + 1]! * 0x10000 + bytes[i + 2]! * 0x100 + bytes[i + 3]!
    if (codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
      throw new Error(`PDF import error: invalid UTF-32BE code point U+${codePoint.toString(16)}`)
    }
    result += String.fromCodePoint(codePoint)
  }
  return result
}

function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '')
}

function optionalName(value: PdfValue): string | null {
  return value instanceof PdfName ? value.name : null
}

function nameValue(value: PdfValue, label: string): string {
  if (!(value instanceof PdfName)) throw new Error(`PDF import error: ${label} must be a name`)
  return value.name
}

function numberValue(value: PdfValue, defaultValue: number): number {
  return typeof value === 'number' ? value : defaultValue
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}
