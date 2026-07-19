import { BinaryReader } from '../binary/reader.js'
import { BinaryWriter } from '../binary/writer.js'
import { parseFont } from '../parsers/index.js'
import { cffGlyphName, parseCff, parseCffGlyph } from '../parsers/cff-parser.js'
import { getTableReader } from '../parsers/sfnt-parser.js'
import { buildCmapTable, buildSfntFromTables } from '../subset/ttf-subset.js'
import { glyphNameToUnicode } from './pdf-encoding.js'
import type { ImportedFontInfo } from './pdf-page-importer.js'

/**
 * Converts a PDF-embedded font program into a standalone OpenType font.
 *
 * PDF FontFile streams are not necessarily installable font files: Type 1C
 * programs are bare CFF data, and subset TrueType programs often contain a
 * producer-specific name table that desktop font loaders reject. This
 * function retains the original glyph programs and metrics while supplying a
 * canonical SFNT wrapper and name table suitable for Editor measurement,
 * outline generation, embedding, and explicit system-font testing.
 *
 * A CID-keyed bare CFF program without Unicode glyph names returns null. Such
 * PDF text has no reversible character mapping and remains glyph outlines in
 * the importer.
 */
export function normalizePdfEmbeddedFont(info: Readonly<ImportedFontInfo>): Uint8Array | null {
  if (info.fontFile === undefined || info.fontFileFormat === undefined) return null
  if (info.fontFileFormat === 'cff') return wrapBareCff(info)
  if (info.fontFileFormat === 'truetype' || info.fontFileFormat === 'opentype') return normalizeSfnt(info)
  return null
}

function normalizeSfnt(info: Readonly<ImportedFontInfo>): Uint8Array {
  const source = bytesToArrayBuffer(info.fontFile!)
  const sfnt = parseFont(source)
  const tables: Array<{ tag: string, data: Uint8Array }> = []
  for (const tag of sfnt.tableDirectory.keys()) {
    if (tag === 'name' || tag === 'DSIG') continue
    const reader = getTableReader(sfnt, tag)!
    const data = reader.readBytes(reader.length)
    if (tag === 'head' && data.length >= 12) new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(8, 0, false)
    tables.push({ tag, data })
  }
  tables.push({ tag: 'name', data: buildNameTable(info) })
  tables.sort(compareTableTags)
  return new Uint8Array(buildSfntFromTables(sfnt.sfntVersion, tables))
}

function wrapBareCff(info: Readonly<ImportedFontInfo>): Uint8Array | null {
  const cffBytes = info.fontFile!.slice()
  const cff = parseCff(new BinaryReader(bytesToArrayBuffer(cffBytes)))
  if (cff.isCIDFont) return null
  const numGlyphs = cff.charstrings.count
  if (numGlyphs <= 0 || numGlyphs > 0xFFFF) throw new Error(`PDF embedded CFF glyph count ${numGlyphs} is invalid`)
  const fontMatrixScale = cff.fontMatrix?.[0] ?? 0.001
  if (!Number.isFinite(fontMatrixScale) || fontMatrixScale <= 0) throw new Error('PDF embedded CFF FontMatrix scale must be positive')
  const unitsPerEm = Math.round(1 / fontMatrixScale)
  if (unitsPerEm < 16 || unitsPerEm > 0x4000) throw new Error(`PDF embedded CFF unitsPerEm ${unitsPerEm} is invalid`)

  const hmtx = new BinaryWriter(numGlyphs * 4)
  const cmap = new Map<number, number>()
  let xMin = 0
  let yMin = 0
  let xMax = 0
  let yMax = 0
  let advanceMax = 0
  let minLsb = 0
  let minRsb = 0
  let xMaxExtent = 0
  let initialized = false
  for (let gid = 0; gid < numGlyphs; gid++) {
    const glyph = parseCffGlyph(cff, gid)
    const bounds = outlineBounds(glyph.outline.coords)
    const advance = clampUint16(Math.round(glyph.width), `PDF embedded CFF glyph ${gid} advance`)
    const lsb = clampInt16(Math.floor(bounds.xMin), `PDF embedded CFF glyph ${gid} left side bearing`)
    hmtx.writeUint16(advance)
    hmtx.writeInt16(lsb)
    if (advance > advanceMax) advanceMax = advance
    const right = advance - lsb - (bounds.xMax - bounds.xMin)
    const extent = lsb + bounds.xMax - bounds.xMin
    if (!initialized) {
      xMin = bounds.xMin
      yMin = bounds.yMin
      xMax = bounds.xMax
      yMax = bounds.yMax
      minLsb = lsb
      minRsb = right
      xMaxExtent = extent
      initialized = true
    } else {
      xMin = Math.min(xMin, bounds.xMin)
      yMin = Math.min(yMin, bounds.yMin)
      xMax = Math.max(xMax, bounds.xMax)
      yMax = Math.max(yMax, bounds.yMax)
      minLsb = Math.min(minLsb, lsb)
      minRsb = Math.min(minRsb, right)
      xMaxExtent = Math.max(xMaxExtent, extent)
    }
    if (gid !== 0) {
      const unicode = glyphNameToUnicode(cffGlyphName(cff, gid))
      const points = [...unicode]
      if (unicode !== '\uFFFD' && points.length === 1) {
        const codePoint = points[0]!.codePointAt(0)!
        if (!cmap.has(codePoint)) cmap.set(codePoint, gid)
      }
    }
  }
  if (cmap.size === 0) return null

  const cmapEntries = [...cmap.entries()]
    .map(function ([codePoint, newGlyphId]) { return { codePoint, newGlyphId } })
    .sort(function (a, b) { return a.codePoint - b.codePoint })
  const head = buildHeadTable(unitsPerEm, xMin, yMin, xMax, yMax, info)
  const hhea = buildHheaTable(yMax, yMin, advanceMax, minLsb, minRsb, xMaxExtent, numGlyphs)
  const maxp = new BinaryWriter(6)
  maxp.writeUint32(0x00005000)
  maxp.writeUint16(numGlyphs)
  const tables = [
    { tag: 'CFF ', data: cffBytes },
    { tag: 'cmap', data: buildCmapTable(cmapEntries) },
    { tag: 'head', data: head },
    { tag: 'hhea', data: hhea },
    { tag: 'hmtx', data: hmtx.toUint8Array().slice() },
    { tag: 'maxp', data: maxp.toUint8Array().slice() },
    { tag: 'name', data: buildNameTable(info) },
    { tag: 'post', data: buildPostTable(info) },
  ]
  tables.sort(compareTableTags)
  return new Uint8Array(buildSfntFromTables(0x4F54544F, tables))
}

function buildHeadTable(unitsPerEm: number, xMin: number, yMin: number, xMax: number, yMax: number, info: Readonly<ImportedFontInfo>): Uint8Array {
  const writer = new BinaryWriter(54)
  writer.writeUint32(0x00010000)
  writer.writeUint32(0x00010000)
  writer.writeUint32(0)
  writer.writeUint32(0x5F0F3CF5)
  writer.writeUint16(0x0003)
  writer.writeUint16(unitsPerEm)
  writer.writeUint32(0); writer.writeUint32(0)
  writer.writeUint32(0); writer.writeUint32(0)
  writer.writeInt16(clampInt16(Math.floor(xMin), 'PDF embedded CFF head.xMin'))
  writer.writeInt16(clampInt16(Math.floor(yMin), 'PDF embedded CFF head.yMin'))
  writer.writeInt16(clampInt16(Math.ceil(xMax), 'PDF embedded CFF head.xMax'))
  writer.writeInt16(clampInt16(Math.ceil(yMax), 'PDF embedded CFF head.yMax'))
  writer.writeUint16((info.bold ? 1 : 0) | (info.italic ? 2 : 0))
  writer.writeUint16(8)
  writer.writeInt16(2)
  writer.writeInt16(0)
  writer.writeInt16(0)
  return writer.toUint8Array().slice()
}

function buildHheaTable(ascender: number, descender: number, advanceMax: number, minLsb: number, minRsb: number, xMaxExtent: number, numGlyphs: number): Uint8Array {
  const writer = new BinaryWriter(36)
  writer.writeUint32(0x00010000)
  writer.writeInt16(clampInt16(Math.ceil(Math.max(0, ascender)), 'PDF embedded CFF hhea.ascender'))
  writer.writeInt16(clampInt16(Math.floor(Math.min(0, descender)), 'PDF embedded CFF hhea.descender'))
  writer.writeInt16(0)
  writer.writeUint16(clampUint16(advanceMax, 'PDF embedded CFF hhea.advanceWidthMax'))
  writer.writeInt16(clampInt16(Math.floor(minLsb), 'PDF embedded CFF hhea.minLeftSideBearing'))
  writer.writeInt16(clampInt16(Math.floor(minRsb), 'PDF embedded CFF hhea.minRightSideBearing'))
  writer.writeInt16(clampInt16(Math.ceil(xMaxExtent), 'PDF embedded CFF hhea.xMaxExtent'))
  writer.writeInt16(1); writer.writeInt16(0); writer.writeInt16(0)
  writer.writeInt16(0); writer.writeInt16(0); writer.writeInt16(0); writer.writeInt16(0)
  writer.writeInt16(0)
  writer.writeUint16(numGlyphs)
  return writer.toUint8Array().slice()
}

function buildPostTable(info: Readonly<ImportedFontInfo>): Uint8Array {
  const writer = new BinaryWriter(32)
  writer.writeUint32(0x00030000)
  writer.writeInt32(info.italic ? -12 * 65536 : 0)
  writer.writeInt16(-75)
  writer.writeInt16(50)
  writer.writeUint32(info.fixedPitch ? 1 : 0)
  writer.writeUint32(0); writer.writeUint32(0); writer.writeUint32(0); writer.writeUint32(0)
  return writer.toUint8Array().slice()
}

function buildNameTable(info: Readonly<ImportedFontInfo>): Uint8Array {
  const pdfName = stripSubsetPrefix(info.baseFont)
  const separator = pdfName.lastIndexOf('-')
  const hasStyleSuffix = separator > 0 && separator < pdfName.length - 1
  const family = hasStyleSuffix ? pdfName.slice(0, separator) : info.familyName || pdfName || 'PDF Embedded Font'
  const subfamily = hasStyleSuffix
    ? pdfName.slice(separator + 1)
    : info.bold && info.italic ? 'Bold Italic' : info.bold ? 'Bold' : info.italic ? 'Italic' : 'Regular'
  const fullName = family + (subfamily === 'Regular' ? '' : ' ' + subfamily)
  const postScriptName = sanitizePostScriptName(pdfName || family)
  const values = new Map<number, string>([[1, family], [2, subfamily], [4, fullName], [6, postScriptName]])
  const ids = [...values.keys()].sort(function (a, b) { return a - b })
  const encoded = ids.map(function (id) { return utf16Be(values.get(id)!) })
  const writer = new BinaryWriter(6 + ids.length * 12 + encoded.reduce(function (sum, value) { return sum + value.length }, 0))
  writer.writeUint16(0)
  writer.writeUint16(ids.length)
  writer.writeUint16(6 + ids.length * 12)
  let offset = 0
  for (let i = 0; i < ids.length; i++) {
    writer.writeUint16(3)
    writer.writeUint16(1)
    writer.writeUint16(0x0409)
    writer.writeUint16(ids[i]!)
    writer.writeUint16(encoded[i]!.length)
    writer.writeUint16(offset)
    offset += encoded[i]!.length
  }
  for (let i = 0; i < encoded.length; i++) writer.writeBytes(encoded[i]!)
  return writer.toUint8Array().slice()
}

function outlineBounds(coords: Float32Array): { xMin: number, yMin: number, xMax: number, yMax: number } {
  if (coords.length === 0) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  let xMin = coords[0]!
  let yMin = coords[1]!
  let xMax = xMin
  let yMax = yMin
  for (let i = 2; i < coords.length; i += 2) {
    xMin = Math.min(xMin, coords[i]!)
    yMin = Math.min(yMin, coords[i + 1]!)
    xMax = Math.max(xMax, coords[i]!)
    yMax = Math.max(yMax, coords[i + 1]!)
  }
  return { xMin, yMin, xMax, yMax }
}

function utf16Be(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    bytes[i * 2] = code >>> 8
    bytes[i * 2 + 1] = code & 0xFF
  }
  return bytes
}

function sanitizePostScriptName(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0x21 && code <= 0x7E && '[](){}<>/%'.indexOf(value[i]!) < 0) result += value[i]
  }
  return result === '' ? 'PDFEmbeddedFont' : result.slice(0, 63)
}

function stripSubsetPrefix(value: string): string {
  return /^[A-Z]{6}\+/.test(value) ? value.slice(7) : value
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function compareTableTags(a: { tag: string }, b: { tag: string }): number {
  return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0
}

function clampUint16(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) throw new Error(`${field} ${value} is outside 0..65535`)
  return value
}

function clampInt16(value: number, field: string): number {
  if (!Number.isInteger(value) || value < -0x8000 || value > 0x7FFF) throw new Error(`${field} ${value} is outside -32768..32767`)
  return value
}
