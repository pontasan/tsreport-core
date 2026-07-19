/**
 * PDF integration tests.
 *
 * Parses generated PDF binaries and verifies conformance with the PDF spec (ISO 32000-1).
 * Guards against regressions of past bugs (missing GID remapping, missing CIDToGIDMap,
 * broken CFF embedding, etc.).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { BinaryReader } from '../../src/binary/reader.js'
import { parseCff, parseCffGlyph } from '../../src/parsers/cff-parser.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument, RenderNode } from '../../src/types/render.js'
import { zlibInflate } from '../../src/compression/inflate.js'
import { pdfToText } from './pdf-test-utils.js'
import { importPdfPage } from '../../src/pdf/pdf-page-importer.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

// ─── Test fonts ───

let ttfFont: Font   // TrueType (Roboto)
let cffFont: Font   // CFF/OTF (SourceSans3)
let notoFont: Font  // TrueType (NotoSans - multi-script)
let jpFont: Font    // CFF/OTF (NotoSansJP - Japanese CJK)
let stixMathFont: Font // CFF/OTF (STIXTwoMath - MATH table)

beforeAll(() => {
  const ttfBuf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  ttfFont = Font.load(ttfBuf.buffer as ArrayBuffer)

  const cffBuf = readFileSync(join(FIXTURES, 'SourceSans3-Regular.otf'))
  cffFont = Font.load(cffBuf.buffer as ArrayBuffer)

  const notoBuf = readFileSync(join(FIXTURES, 'NotoSans-Regular.ttf'))
  notoFont = Font.load(notoBuf.buffer as ArrayBuffer)

  const jpBuf = readFileSync(join(FIXTURES, 'NotoSansJP-Regular.otf'))
  jpFont = Font.load(jpBuf.buffer as ArrayBuffer)

  const stixMathBuf = readFileSync(join(FIXTURES, 'STIXTwoMath-Regular.otf'))
  stixMathFont = Font.load(stixMathBuf.buffer as ArrayBuffer)
})

describe('PDF text painting modes', () => {
  it('emits and re-imports stroke and fill-stroke text semantics', () => {
    const backend = new PdfBackend({ fonts: { default: ttfFont } })
    const doc: RenderDocument = {
      pages: [{
        width: 200,
        height: 100,
        children: [
          { type: 'text', x: 10, y: 10, text: 'Stroke', fontId: 'default', fontSize: 18, color: '#ff0000', textPaintMode: 'stroke', textStrokeColor: '#00ff00', textStrokeWidth: 2 },
          { type: 'text', x: 10, y: 40, text: 'Both', fontId: 'default', fontSize: 18, color: '#ff0000', textPaintMode: 'fillStroke', textStrokeColor: '#0000ff', textStrokeWidth: 1.5 },
        ],
      }],
    }
    render(doc, backend)
    const bytes = backend.toUint8Array()
    const operators = pdfToText(bytes)
    expect(operators).toContain('1 Tr')
    expect(operators).toContain('2 Tr')

    const imported = importPdfPage(bytes, 0)
    const texts = imported.elements.filter(element => element.type === 'staticText')
    expect(texts[0]).toMatchObject({ text: 'Stroke', textPaintMode: 'stroke', textStrokeColor: '#00ff00', textStrokeWidth: 2 })
    expect(texts[1]).toMatchObject({ text: 'Both', textPaintMode: 'fillStroke', textStrokeColor: '#0000ff', textStrokeWidth: 1.5 })
  })
})

// ─── Helper functions ───

/** Converts a PDF binary to a latin1 string (preserves binary stream byte positions) */
function decodeLatin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!)
  }
  return s
}

/** Extracts all PDF objects: objId → object body */
function extractPdfObjects(text: string): Map<number, string> {
  const map = new Map<number, string>()
  const re = /(\d+) 0 obj\n([\s\S]*?)endobj/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    map.set(Number(m[1]), m[2]!)
  }
  return map
}

/** Finds objects with the given Subtype (exact match: followed by whitespace / '>' / newline) */
function findObjectsByType(
  objects: Map<number, string>, subtype: string,
): Array<{ id: number; body: string }> {
  const re = new RegExp(`/Subtype ${subtype.replace('/', '\\/')}(?=[\\s/>])`)
  const result: Array<{ id: number; body: string }> = []
  for (const [id, body] of objects) {
    if (re.test(body)) {
      result.push({ id, body })
    }
  }
  return result
}

/** Extracts every Tj operator's hex value from the content stream */
function extractTjHexValues(text: string): string[] {
  const values: string[] = []
  const re = /<([0-9A-Fa-f]+)>\s*Tj/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    values.push(m[1]!)
  }
  return values
}

/** Parses the ToUnicode CMap and returns a GID → Unicode code point map */
function parseToUnicodeCMap(cmapText: string): Map<number, number> {
  const map = new Map<number, number>()
  const re = /<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,8})>/g
  let m: RegExpExecArray | null
  // Search within beginbfchar ... endbfchar sections
  const bfcharSection = cmapText.match(/beginbfchar\n([\s\S]*?)endbfchar/g)
  if (!bfcharSection) return map
  for (const section of bfcharSection) {
    while ((m = re.exec(section)) !== null) {
      const gid = parseInt(m[1]!, 16)
      const unicode = m[2]!
      if (unicode.length === 4) {
        map.set(gid, parseInt(unicode, 16))
      } else {
        // Surrogate pair → decode
        const hi = parseInt(unicode.substring(0, 4), 16)
        const lo = parseInt(unicode.substring(4, 8), 16)
        map.set(gid, (hi - 0xD800) * 0x400 + (lo - 0xDC00) + 0x10000)
      }
    }
  }
  return map
}

/** Parses the /W array and returns a GID → width map */
function parseWidthArray(text: string): Map<number, number> {
  const map = new Map<number, number>()
  // Form like /W [1 [600] 2 [500] ...]
  const wMatch = text.match(/\/W\s*\[([\s\S]*?)\](?:\s*>>|\s*\/)/)
  if (!wMatch) return map
  const wContent = wMatch[1]!
  // Pattern: <gid> [<width>]
  const re = /(\d+)\s*\[(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(wContent)) !== null) {
    map.set(Number(m[1]), Number(m[2]))
  }
  return map
}

/** Extracts the stream bytes of a given object (auto-inflates FlateDecode) */
function extractStreamData(
  bytes: Uint8Array, objId: number,
): Uint8Array | null {
  // Locate byte positions in the raw text (pdfToText changes sizes, so it cannot be used)
  const text = decodeLatin1(bytes)
  const objHeader = `${objId} 0 obj\n`
  const objStart = text.indexOf(objHeader)
  if (objStart === -1) return null

  // Find the start of the stream
  const searchFrom = objStart + objHeader.length
  const streamMarker = 'stream\n'
  const streamStart = text.indexOf(streamMarker, searchFrom)
  if (streamStart === -1) return null

  const dataStart = streamStart + streamMarker.length

  // Read /Length
  const dictText = text.substring(searchFrom, streamStart)
  const lengthMatch = dictText.match(/\/Length\s+(\d+)/)
  if (!lengthMatch) return null
  const length = Number(lengthMatch[1])

  const rawData = bytes.slice(dataStart, dataStart + length)

  // Inflate when FlateDecode-compressed
  if (dictText.indexOf('/Filter /FlateDecode') >= 0) {
    return new Uint8Array(zlibInflate(rawData))
  }
  return rawData
}

function toContiguousArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function extractCffIndexItems(index: { count: number; offsets: number[]; data: BinaryReader }): Uint8Array[] {
  const items: Uint8Array[] = []
  for (let i = 0; i < index.count; i++) {
    const offset = index.offsets[i]! - 1
    const length = index.offsets[i + 1]! - index.offsets[i]!
    const reader = index.data.subReader(offset, length)
    const data = new Uint8Array(length)
    for (let j = 0; j < length; j++) data[j] = reader.readUint8()
    items.push(data)
  }
  return items
}

function countReturnOnlySubrs(items: Uint8Array[]): number {
  let count = 0
  for (const item of items) {
    if (item.length === 1 && item[0] === 11) count++
  }
  return count
}

function maxYFromCoords(coords: Float32Array): number {
  let yMax = -Infinity
  for (let i = 1; i < coords.length; i += 2) {
    if (coords[i]! > yMax) yMax = coords[i]!
  }
  return yMax
}

/** Test PDF generation helper */
function generatePdf(
  fonts: Record<string, Font>,
  textEntries: Array<{ text: string; fontId: string }>,
): { bytes: Uint8Array; text: string } {
  const backend = new PdfBackend({ fonts })
  const children = textEntries.map((entry, i) => ({
    type: 'text' as const,
    x: 72,
    y: 72 + i * 20,
    text: entry.text,
    fontId: entry.fontId,
    fontSize: 12,
    color: '#000000',
  }))
  const doc: RenderDocument = {
    pages: [{ width: 595, height: 842, children }],
  }
  render(doc, backend)
  const bytes = backend.toUint8Array()
  const text = pdfToText(bytes)
  return { bytes, text }
}

/** Multi-page PDF generation helper */
function generateMultiPagePdf(
  fonts: Record<string, Font>,
  pages: Array<{ width: number; height: number; textEntries: Array<{ text: string; fontId: string }> }>,
): { bytes: Uint8Array; text: string } {
  const backend = new PdfBackend({ fonts })
  const doc: RenderDocument = {
    pages: pages.map(page => ({
      width: page.width,
      height: page.height,
      children: page.textEntries.map((entry, i) => ({
        type: 'text' as const,
        x: 72,
        y: 72 + i * 20,
        text: entry.text,
        fontId: entry.fontId,
        fontSize: 12,
        color: '#000000',
      })),
    })),
  }
  render(doc, backend)
  const bytes = backend.toUint8Array()
  const text = pdfToText(bytes)
  return { bytes, text }
}

/** PDF generation helper for arbitrary render nodes */
function generatePdfWithNodes(
  fonts: Record<string, Font>,
  children: RenderNode[],
): { bytes: Uint8Array; text: string } {
  const backend = new PdfBackend({ fonts })
  const doc: RenderDocument = {
    pages: [{ width: 595, height: 842, children }],
  }
  render(doc, backend)
  const bytes = backend.toUint8Array()
  const text = pdfToText(bytes)
  return { bytes, text }
}

/** Tj hex → ToUnicode → recovered text */
function roundTripDecode(pdfText: string): string[] {
  const tjValues = extractTjHexValues(pdfText)
  const cmapMap = parseToUnicodeCMap(pdfText)
  return tjValues.map(hex => {
    let decoded = ''
    for (let i = 0; i < hex.length; i += 4) {
      const gid = parseInt(hex.substring(i, i + 4), 16)
      const cp = cmapMap.get(gid)
      if (cp != null) decoded += String.fromCodePoint(cp)
    }
    return decoded
  })
}

/** Extracts the FontFile2 (TrueType) stream data */
function extractFontFile2(bytes: Uint8Array, text: string): Uint8Array | null {
  const objects = extractPdfObjects(text)
  const descriptors = [...objects.entries()]
    .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
  if (descriptors.length === 0) return null
  for (const [_, desc] of descriptors) {
    const ff2Match = desc.match(/\/FontFile2\s+(\d+)\s+0\s+R/)
    if (ff2Match) {
      return extractStreamData(bytes, Number(ff2Match[1]))
    }
  }
  return null
}

/** Extracts the set of SFNT table tags */
function extractSfntTags(data: Uint8Array): Set<string> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const numTables = view.getUint16(4)
  const tags = new Set<string>()
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16
    tags.add(String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3),
    ))
  }
  return tags
}

// ─── Tests ───

describe('PDF Integration', () => {

  it('emits explicit ActualText independently of the visible glyph text', () => {
    const { text } = generatePdfWithNodes({ default: ttfFont }, [{
      type: 'text', x: 72, y: 72, text: 'A', actualText: 'Ω',
      fontId: 'default', fontSize: 12, color: '#000000',
    }])
    expect(text).toMatch(/\/ActualText <FEFF03A9>/i)
  })

  // ═══ 1. PDF Structure ═══
  describe('PDF Structure', () => {
    // Verifies that the xref stream's /Size covers all objects plus the object-0 free entry.
    it('xref ストリームの /Size がオブジェクト数と一致', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'Hello', fontId: 'default' }],
      )

      // Read the xref stream's /Size
      const sizeMatch = text.match(/\/Type \/XRef[^>]*\/Size\s+(\d+)/)
        ?? text.match(/\/Size\s+(\d+)[^>]*\/Type \/XRef/)
      expect(sizeMatch).not.toBeNull()
      const xrefSize = Number(sizeMatch![1])

      // Count actual objects (object-0 free entry + N objects)
      const objects = extractPdfObjects(text)
      // Size = object count + 1 (object-0 free entry) — includes the xref stream itself
      expect(xrefSize).toBeGreaterThanOrEqual(objects.size + 1)
    })

    // Verifies that the startxref value points exactly at the xref stream object header.
    it('xref ストリームのオフセットが startxref と一致', () => {
      const { bytes } = generatePdf(
        { default: ttfFont },
        [{ text: 'Test', fontId: 'default' }],
      )
      // Use raw text to verify byte positions
      const text = decodeLatin1(bytes)

      // Read the startxref value
      const startxrefMatch = text.match(/startxref\n(\d+)\n/)
      expect(startxrefMatch).not.toBeNull()
      const xrefOffset = Number(startxrefMatch![1])

      // The xref stream object sits at that offset
      const atOffset = text.substring(xrefOffset, xrefOffset + 30)
      expect(atOffset).toMatch(/^\d+ 0 obj/)
    })

    // Verifies that every stream's declared /Length equals the actual byte count up to endstream.
    it('stream の /Length が実際のバイト数と一致', () => {
      const { bytes } = generatePdf(
        { default: ttfFont },
        [{ text: 'Width', fontId: 'default' }],
      )
      // Use raw text to verify byte positions
      const text = decodeLatin1(bytes)

      // Validate the Length of every stream
      const re = /\/Length\s+(\d+)\s*(?:\/[^>]*)*>>\nstream\n/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const declaredLength = Number(m[1])
        const streamDataStart = m.index! + m[0].length
        // Find the endstream position
        const endstreamPos = text.indexOf('\nendstream', streamDataStart)
        expect(endstreamPos).toBeGreaterThan(streamDataStart)
        const actualLength = endstreamPos - streamDataStart
        expect(actualLength).toBe(declaredLength)
      }
    })

    // Verifies that the trailer's /Root reference resolves to a Catalog object with a /Pages entry.
    it('trailer /Root が有効な Catalog を参照', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'Root', fontId: 'default' }],
      )

      const rootMatch = text.match(/\/Root\s+(\d+)\s+0\s+R/)
      expect(rootMatch).not.toBeNull()
      const rootId = Number(rootMatch![1])

      const objects = extractPdfObjects(text)
      const catalog = objects.get(rootId)
      expect(catalog).toBeDefined()
      expect(catalog).toContain('/Type /Catalog')
      expect(catalog).toContain('/Pages')
    })
  })

  // ═══ 2. Font Dictionary - TrueType ═══
  describe('Font Dictionary - TrueType', () => {
    let pdfText: string
    let objects: Map<number, string>

    beforeAll(() => {
      const result = generatePdf(
        { default: ttfFont },
        [{ text: 'Hello', fontId: 'default' }],
      )
      pdfText = result.text
      objects = extractPdfObjects(pdfText)
    })

    // Verifies the Type0 font dict for TrueType carries Identity-H encoding, DescendantFonts, and ToUnicode.
    it('Type0 フォントの必須エントリ', () => {
      const type0 = findObjectsByType(objects, '/Type0')
      expect(type0.length).toBeGreaterThanOrEqual(1)

      const font = type0[0]!.body
      expect(font).toContain('/Subtype /Type0')
      expect(font).toContain('/Encoding /Identity-H')
      expect(font).toContain('/DescendantFonts')
      expect(font).toContain('/ToUnicode')
    })

    // Verifies the CIDFontType2 dict carries CIDSystemInfo, FontDescriptor, DW, and a W width array.
    it('CIDFontType2 の必須エントリ', () => {
      const cidFonts = findObjectsByType(objects, '/CIDFontType2')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)

      const cidFont = cidFonts[0]!.body
      expect(cidFont).toContain('/CIDSystemInfo')
      expect(cidFont).toContain('/FontDescriptor')
      expect(cidFont).toContain('/DW')
      expect(cidFont).toContain('/W [')
    })

    // Verifies the FontDescriptor has the required metrics and embeds TrueType data via /FontFile2.
    it('FontDescriptor の必須エントリ（/FontFile2）', () => {
      // Find objects containing a FontDescriptor
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      expect(descriptors.length).toBeGreaterThanOrEqual(1)

      const desc = descriptors[0]![1]
      expect(desc).toContain('/FontBBox')
      expect(desc).toContain('/Ascent')
      expect(desc).toContain('/Descent')
      expect(desc).toContain('/CapHeight')
      expect(desc).toContain('/FontFile2')  // TrueType → FontFile2
    })
  })

  // ═══ 3. Font Dictionary - CFF ═══
  describe('Font Dictionary - CFF', () => {
    let pdfText: string
    let objects: Map<number, string>

    beforeAll(() => {
      const result = generatePdf(
        { default: cffFont },
        [{ text: 'Hello', fontId: 'default' }],
      )
      pdfText = result.text
      objects = extractPdfObjects(pdfText)
    })

    // Verifies the Type0 font dict for CFF carries Identity-H encoding, DescendantFonts, and ToUnicode.
    it('Type0 フォントの必須エントリ（CFF版）', () => {
      const type0 = findObjectsByType(objects, '/Type0')
      expect(type0.length).toBeGreaterThanOrEqual(1)

      const font = type0[0]!.body
      expect(font).toContain('/Subtype /Type0')
      expect(font).toContain('/Encoding /Identity-H')
      expect(font).toContain('/DescendantFonts')
      expect(font).toContain('/ToUnicode')
    })

    // Verifies the CIDFontType0 dict carries CIDSystemInfo, FontDescriptor, DW, and a W width array.
    it('CIDFontType0 の必須エントリ', () => {
      const cidFonts = findObjectsByType(objects, '/CIDFontType0')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)

      const cidFont = cidFonts[0]!.body
      expect(cidFont).toContain('/CIDSystemInfo')
      expect(cidFont).toContain('/FontDescriptor')
      expect(cidFont).toContain('/DW')
      expect(cidFont).toContain('/W [')
    })

    // Verifies CFF embedding uses /FontFile3 whose stream is tagged /Subtype /CIDFontType0C.
    it('FontDescriptor が /FontFile3 + /Subtype /CIDFontType0C を参照', () => {
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      expect(descriptors.length).toBeGreaterThanOrEqual(1)

      const desc = descriptors[0]![1]
      expect(desc).toContain('/FontFile3')  // CFF → FontFile3

      // The object referenced by FontFile3 must have /Subtype /CIDFontType0C
      const ff3Match = desc.match(/\/FontFile3\s+(\d+)\s+0\s+R/)
      expect(ff3Match).not.toBeNull()
      const ff3Id = Number(ff3Match![1])
      const ff3Obj = objects.get(ff3Id)
      expect(ff3Obj).toBeDefined()
      expect(ff3Obj).toContain('/Subtype /CIDFontType0C')
    })
  })

  // ═══ 4. GID Remapping ═══
  describe('GID Remapping', () => {
    // Verifies TrueType subsetting remaps 'A' to the first subset GID (0001) in the Tj operator.
    it('TTF: Tj hex が新 GID（<0001>）を使用', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'A', fontId: 'default' }],
      )

      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)
      // The subset GID for 'A' is 0001 (right after .notdef=0000)
      expect(tjValues[0]).toBe('0001')
    })

    // Verifies CFF subsetting remaps 'A' to the first subset GID (0001) in the Tj operator.
    it('CFF: Tj hex が新 GID（<0001>）を使用', () => {
      const { text } = generatePdf(
        { default: cffFont },
        [{ text: 'A', fontId: 'default' }],
      )

      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)
      expect(tjValues[0]).toBe('0001')
    })

    // Verifies multiple characters get sequential subset GIDs ("AB" → 0001 0002).
    it('複数文字: "AB" → <00010002>（連番の新 GID）', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'AB', fontId: 'default' }],
      )

      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)
      // "AB" → GIDs 1 and 2 (sequential after subsetting)
      expect(tjValues[0]).toBe('00010002')
    })
  })

  // ═══ 5. Width Array /W ═══
  describe('Width Array /W', () => {
    // Verifies the /W array indexes widths by the new subset GID and matches the source TTF advance width.
    it('TTF: 新 GID で正しい幅', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'A', fontId: 'default' }],
      )

      // Read /W from the CIDFont object
      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType2')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)

      const widths = parseWidthArray(cidFonts[0]!.body)
      // Check the width for new GID=1
      expect(widths.has(1)).toBe(true)

      // Compare against the original width of 'A'
      const origGid = ttfFont.getGlyphId('A'.codePointAt(0)!)
      const expectedWidth = Math.round(
        ttfFont.getAdvanceWidth(origGid) * 1000 / ttfFont.metrics.unitsPerEm,
      )
      expect(widths.get(1)).toBe(expectedWidth)
    })

    // Verifies the /W array for CFF fonts also maps the new subset GID to the source advance width.
    it('CFF: 新 GID で正しい幅', () => {
      const { text } = generatePdf(
        { default: cffFont },
        [{ text: 'A', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType0')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)

      const widths = parseWidthArray(cidFonts[0]!.body)
      expect(widths.has(1)).toBe(true)

      const origGid = cffFont.getGlyphId('A'.codePointAt(0)!)
      const expectedWidth = Math.round(
        cffFont.getAdvanceWidth(origGid) * 1000 / cffFont.metrics.unitsPerEm,
      )
      expect(widths.get(1)).toBe(expectedWidth)
    })

    // Verifies the CIDFont declares a numeric /DW (default width) entry.
    it('/DW が数値で存在', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'Test', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType2')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)

      const dwMatch = cidFonts[0]!.body.match(/\/DW\s+(\d+)/)
      expect(dwMatch).not.toBeNull()
      expect(Number(dwMatch![1])).toBeGreaterThanOrEqual(0)
    })
  })

  // ═══ 6. ToUnicode CMap ═══
  describe('ToUnicode CMap', () => {
    it('TTF: 新 GID → 正しい Unicode コードポイント', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'A', fontId: 'default' }],
      )

      const cmapMap = parseToUnicodeCMap(text)
      // GID=1 -> U+0041 ('A')
      
      expect(cmapMap.get(1)).toBe(0x0041)
    })

    it('CFF: 新 GID → 正しい Unicode コードポイント', () => {
      const { text } = generatePdf(
        { default: cffFont },
        [{ text: 'B', fontId: 'default' }],
      )

      const cmapMap = parseToUnicodeCMap(text)
      // GID=1 -> U+0042 ('B')
      
      expect(cmapMap.get(1)).toBe(0x0042)
    })

    it('CMap 構造の妥当性（codespacerange, bfchar）', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'ABC', fontId: 'default' }],
      )

      // ToUnicode CMap.
      
      expect(text).toContain('begincmap')
      expect(text).toContain('endcmap')
      expect(text).toContain('1 begincodespacerange')
      expect(text).toContain('<0000> <FFFF>')
      expect(text).toContain('endcodespacerange')
      expect(text).toContain('beginbfchar')
      expect(text).toContain('endbfchar')
    })
  })

  // ═══ 7. CIDToGIDMap ═══
  describe('CIDToGIDMap', () => {
    it('TrueType CIDFont に /CIDToGIDMap /Identity が存在', () => {
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: 'Test', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType2')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)
      expect(cidFonts[0]!.body).toContain('/CIDToGIDMap /Identity')
    })

    it('CFF CIDFont に /CIDToGIDMap が不在', () => {
      const { text } = generatePdf(
        { default: cffFont },
        [{ text: 'Test', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType0')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)
      expect(cidFonts[0]!.body).not.toContain('/CIDToGIDMap')
    })
  })

  // ═══ 8. CFF Structure ═══
  describe('CFF Structure', () => {
    it('埋め込み CFF が SFNT ラッパーなし（先頭が CFF ヘッダー major=1）', () => {
      const { bytes, text } = generatePdf(
        { default: cffFont },
        [{ text: 'Test', fontId: 'default' }],
      )

      // FontFile3.
      
      const objects = extractPdfObjects(text)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      expect(descriptors.length).toBeGreaterThanOrEqual(1)

      const ff3Match = descriptors[0]![1].match(/\/FontFile3\s+(\d+)\s+0\s+R/)
      expect(ff3Match).not.toBeNull()
      const ff3Id = Number(ff3Match![1])

      const streamData = extractStreamData(bytes, ff3Id)
      expect(streamData).not.toBeNull()
      expect(streamData!.length).toBeGreaterThan(4)

      // CFF header: major=1, minor=0.
      
      expect(streamData![0]).toBe(1)  // major version
      expect(streamData![1]).toBe(0)  // minor version
    })

    it('Top DICT に ROS (op 12 30) が存在', () => {
      const { bytes, text } = generatePdf(
        { default: cffFont },
        [{ text: 'ROS', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      const ff3Match = descriptors[0]![1].match(/\/FontFile3\s+(\d+)\s+0\s+R/)
      const ff3Id = Number(ff3Match![1])
      const streamData = extractStreamData(bytes, ff3Id)
      expect(streamData).not.toBeNull()

      // CFF op 12 30 (ROS) check.
      
      const data = streamData!
      let foundRos = false
      for (let i = 0; i < data.length - 1; i++) {
        if (data[i] === 12 && data[i + 1] === 30) {
          foundRos = true
          break
        }
      }
      expect(foundRos).toBe(true)
    })

    it('Top DICT に FDArray (op 12 36) と FDSelect (op 12 37) が存在', () => {
      const { bytes, text } = generatePdf(
        { default: cffFont },
        [{ text: 'FD', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      const ff3Match = descriptors[0]![1].match(/\/FontFile3\s+(\d+)\s+0\s+R/)
      const ff3Id = Number(ff3Match![1])
      const streamData = extractStreamData(bytes, ff3Id)
      expect(streamData).not.toBeNull()

      const data = streamData!
      let foundFDArray = false
      let foundFDSelect = false
      for (let i = 0; i < data.length - 1; i++) {
        if (data[i] === 12 && data[i + 1] === 36) foundFDArray = true
        if (data[i] === 12 && data[i + 1] === 37) foundFDSelect = true
      }
      expect(foundFDArray).toBe(true)
      expect(foundFDSelect).toBe(true)
    })

    it('Math CFF: ∫大型バリアントの yMax を保持し、return-only subroutines を注入しない', () => {
      const integralCp = 0x222B
      const integralGid = stixMathFont.getGlyphId(integralCp)
      const variants = stixMathFont.math!.getVerticalVariants(integralGid)
      expect(variants.length).toBeGreaterThan(1)
      const selectedVariantGid = variants[1]!.variantGlyph
      const sourceYMax = maxYFromCoords(stixMathFont.getGlyph(selectedVariantGid).outline.coords)

      const backend = new PdfBackend({ fonts: { default: stixMathFont } })
      const doc: RenderDocument = {
        pages: [{
          width: 595,
          height: 842,
          children: [{
            type: 'text',
            x: 72,
            y: 72,
            text: '∫',
            fontId: 'default',
            fontSize: 14,
            color: '#000000',
            glyphIds: [selectedVariantGid],
          }],
        }],
      }
      render(doc, backend)
      const pdfBytes = backend.toUint8Array()
      const pdfText = pdfToText(pdfBytes)

      const objects = extractPdfObjects(pdfText)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      expect(descriptors.length).toBeGreaterThanOrEqual(1)

      const ff3Match = descriptors[0]![1].match(/\/FontFile3\s+(\d+)\s+0\s+R/)
      expect(ff3Match).not.toBeNull()
      const ff3Id = Number(ff3Match![1])
      const cffBytes = extractStreamData(pdfBytes, ff3Id)
      expect(cffBytes).not.toBeNull()

      const subsetCff = parseCff(new BinaryReader(toContiguousArrayBuffer(cffBytes!)))
      const cmap = parseToUnicodeCMap(pdfText)
      let newIntegralGid = -1
      for (const [gid, cp] of cmap) {
        if (cp === integralCp) {
          newIntegralGid = gid
          break
        }
      }
      expect(newIntegralGid).toBeGreaterThanOrEqual(0)

      const subsetIntegral = parseCffGlyph(subsetCff, newIntegralGid)
      const subsetYMax = maxYFromCoords(subsetIntegral.outline.coords)
      expect(subsetYMax).toBe(sourceYMax)

      const globalSubrs = extractCffIndexItems(subsetCff.globalSubrs)
      expect(countReturnOnlySubrs(globalSubrs)).toBe(0)
      for (const fd of subsetCff.fdArray ?? []) {
        const localSubrs = extractCffIndexItems(fd.localSubrs)
        expect(countReturnOnlySubrs(localSubrs)).toBe(0)
      }
    })

    it('Math CFF: 通常テキストは抽出可能なテキストとして描画（パスにしない）', () => {
      const backend = new PdfBackend({ fonts: { default: stixMathFont } })
      const doc: RenderDocument = {
        pages: [{
          width: 200, height: 100,
          children: [{ type: 'text', x: 10, y: 50, text: 'Hi', fontId: 'default', fontSize: 14, color: '#000000' }],
        }],
      }
      render(doc, backend)
      const pdfText = pdfToText(backend.toUint8Array())
      // A MATH table alone must not force path mode: plain text uses text-showing
      // operators (BT … Tj) and carries a ToUnicode CMap so it stays extractable.
      expect(pdfText).toContain('BT')
      expect(pdfText).toContain('/ToUnicode')
      const cmap = parseToUnicodeCMap(pdfText)
      expect([...cmap.values()]).toContain(0x48) // 'H'
      expect([...cmap.values()]).toContain(0x69) // 'i'
    })
  })

  // ═══ 9. TrueType Structure ═══
  describe('TrueType Structure', () => {
    it('埋め込み TrueType が有効な SFNT（sfntVersion = 0x00010000）', () => {
      const { bytes, text } = generatePdf(
        { default: ttfFont },
        [{ text: 'SFNT', fontId: 'default' }],
      )

      // FontFile2.
      
      const objects = extractPdfObjects(text)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      expect(descriptors.length).toBeGreaterThanOrEqual(1)

      const ff2Match = descriptors[0]![1].match(/\/FontFile2\s+(\d+)\s+0\s+R/)
      expect(ff2Match).not.toBeNull()
      const ff2Id = Number(ff2Match![1])

      const streamData = extractStreamData(bytes, ff2Id)
      expect(streamData).not.toBeNull()
      expect(streamData!.length).toBeGreaterThan(12)

      // SFNT version: 0x00010000 (TrueType)
      const view = new DataView(streamData!.buffer, streamData!.byteOffset, streamData!.byteLength)
      expect(view.getUint32(0)).toBe(0x00010000)
    })

    it('必須テーブル存在（glyf, loca, head, hhea, maxp, hmtx, cmap）', () => {
      const { bytes, text } = generatePdf(
        { default: ttfFont },
        [{ text: 'Tables', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      const ff2Match = descriptors[0]![1].match(/\/FontFile2\s+(\d+)\s+0\s+R/)
      const ff2Id = Number(ff2Match![1])
      const streamData = extractStreamData(bytes, ff2Id)
      expect(streamData).not.toBeNull()

      // Read table tags from the table directory.
      const view = new DataView(streamData!.buffer, streamData!.byteOffset, streamData!.byteLength)
      const numTables = view.getUint16(4)
      const tags = new Set<string>()
      for (let i = 0; i < numTables; i++) {
        const offset = 12 + i * 16
        const tag = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3),
        )
        tags.add(tag)
      }

      const required = ['glyf', 'loca', 'head', 'hhea', 'maxp', 'hmtx', 'cmap']
      for (const tag of required) {
        expect(tags.has(tag), `missing table: ${tag}`).toBe(true)
      }
    })

    it('CFF テーブルが存在しない', () => {
      const { bytes, text } = generatePdf(
        { default: ttfFont },
        [{ text: 'NoCFF', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      const ff2Match = descriptors[0]![1].match(/\/FontFile2\s+(\d+)\s+0\s+R/)
      const ff2Id = Number(ff2Match![1])
      const streamData = extractStreamData(bytes, ff2Id)
      expect(streamData).not.toBeNull()

      const view = new DataView(streamData!.buffer, streamData!.byteOffset, streamData!.byteLength)
      const numTables = view.getUint16(4)
      const tags = new Set<string>()
      for (let i = 0; i < numTables; i++) {
        const offset = 12 + i * 16
        const tag = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3),
        )
        tags.add(tag)
      }

      expect(tags.has('CFF ')).toBe(false)
      expect(tags.has('CFF2')).toBe(false)
    })
  })

  // ═══ 10. Multi-font ═══
  describe('Multi-font', () => {
    let pdfText: string
    let objects: Map<number, string>

    beforeAll(() => {
      const result = generatePdf(
        { ttf: ttfFont, cff: cffFont },
        [
          { text: 'TrueType', fontId: 'ttf' },
          { text: 'OpenType', fontId: 'cff' },
        ],
      )
      pdfText = result.text
      objects = extractPdfObjects(pdfText)
    })

    it('TTF + CFF の 2 フォント → 2 つの Type0 フォントオブジェクト', () => {
      const type0 = findObjectsByType(objects, '/Type0')
      expect(type0.length).toBe(2)
    })

    it('各フォントが独立した GID リマッピング', () => {
      const tjValues = extractTjHexValues(pdfText)
      expect(tjValues.length).toBe(2)
      // Layout closure can place referenced GSUB glyphs before a text glyph,
      // so derive each expected CID from that font's own compact mapping.
      const ttfMapping = ttfFont.subsetWithMapping('TrueType').oldToNewGlyphId
      const cffMapping = cffFont.subsetWithMapping('OpenType').oldToNewGlyphId
      const ttfFirst = ttfMapping.get(ttfFont.getGlyphId('T'.codePointAt(0)!))!
      const cffFirst = cffMapping.get(cffFont.getGlyphId('O'.codePointAt(0)!))!
      expect(parseInt(tjValues[0]!.substring(0, 4), 16)).toBe(ttfFirst)
      expect(parseInt(tjValues[1]!.substring(0, 4), 16)).toBe(cffFirst)
    })

    it('TTF に CIDToGIDMap あり、CFF になし', () => {
      const cidType2 = findObjectsByType(objects, '/CIDFontType2')
      const cidType0 = findObjectsByType(objects, '/CIDFontType0')

      expect(cidType2.length).toBe(1)
      expect(cidType0.length).toBe(1)

      expect(cidType2[0]!.body).toContain('/CIDToGIDMap /Identity')
      expect(cidType0[0]!.body).not.toContain('/CIDToGIDMap')
    })
  })

  // ═══ 11. Round-trip ═══
  describe('Round-trip', () => {
    it('TTF: テキスト → PDF → Tj 抽出 → ToUnicode デコード → 元テキストと一致', () => {
      const original = 'Hello'
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: original, fontId: 'default' }],
      )

      // Tj hex get.
      
      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)

      // ToUnicode get.
      
      const cmapMap = parseToUnicodeCMap(text)

      // Hex -> GID sequence -> Unicode -> character sequence.
      const hex = tjValues[0]!
      let decoded = ''
      for (let i = 0; i < hex.length; i += 4) {
        const gid = parseInt(hex.substring(i, i + 4), 16)
        const cp = cmapMap.get(gid)
        expect(cp, `GID ${gid} not found in ToUnicode`).toBeDefined()
        decoded += String.fromCodePoint(cp!)
      }
      expect(decoded).toBe(original)
    })

    it('CFF: テキスト → PDF → Tj 抽出 → ToUnicode デコード → 元テキストと一致', () => {
      const original = 'World'
      const { text } = generatePdf(
        { default: cffFont },
        [{ text: original, fontId: 'default' }],
      )

      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)

      const cmapMap = parseToUnicodeCMap(text)
      const hex = tjValues[0]!
      let decoded = ''
      for (let i = 0; i < hex.length; i += 4) {
        const gid = parseInt(hex.substring(i, i + 4), 16)
        const cp = cmapMap.get(gid)
        expect(cp, `GID ${gid} not found in ToUnicode`).toBeDefined()
        decoded += String.fromCodePoint(cp!)
      }
      expect(decoded).toBe(original)
    })

    it('多文字テスト（"ABCabc123"）', () => {
      const original = 'ABCabc123'
      const { text } = generatePdf(
        { default: ttfFont },
        [{ text: original, fontId: 'default' }],
      )

      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)

      const cmapMap = parseToUnicodeCMap(text)
      const hex = tjValues[0]!
      // 9character × 4 hex digits = 36.
      
      expect(hex.length).toBe(36)

      let decoded = ''
      for (let i = 0; i < hex.length; i += 4) {
        const gid = parseInt(hex.substring(i, i + 4), 16)
        const cp = cmapMap.get(gid)
        expect(cp, `GID ${gid} not found in ToUnicode`).toBeDefined()
        decoded += String.fromCodePoint(cp!)
      }
      expect(decoded).toBe(original)
    })
  })

  // ═══ 12. ASCII / font (NotoSans: Latin/Greek/Cyrillic/Devanagari) ═══.
  
  describe('Non-ASCII / Multi-script (NotoSans)', () => {
    // NotoSans-Regular.ttf Latin, Greek, Cyrillic, Devanagari.
    // CJK requires NotoSansCJK.

    it('アクセント付きラテン文字のラウンドトリップ', () => {
      const original = 'éàüñ'
      const { text } = generatePdf(
        { default: notoFont },
        [{ text: original, fontId: 'default' }],
      )

      const decoded = roundTripDecode(text)
      expect(decoded.length).toBeGreaterThanOrEqual(1)
      expect(decoded[0]).toBe(original)
    })

    it('ギリシャ文字のラウンドトリップ', () => {
      const original = 'ΑΒΓ'  // U+0391, U+0392, U+0393
      const { text } = generatePdf(
        { default: notoFont },
        [{ text: original, fontId: 'default' }],
      )

      const decoded = roundTripDecode(text)
      expect(decoded[0]).toBe(original)
    })

    it('キリル文字のラウンドトリップ', () => {
      const original = 'АБВ'  // U+0410, U+0411, U+0412
      const { text } = generatePdf(
        { default: notoFont },
        [{ text: original, fontId: 'default' }],
      )

      const decoded = roundTripDecode(text)
      expect(decoded[0]).toBe(original)
    })

    it('多言語混在テキスト（Latin + Greek + Cyrillic + ASCII）', () => {
      const original = 'Café ΑΒ АБ 123'
      const { text } = generatePdf(
        { default: notoFont },
        [{ text: original, fontId: 'default' }],
      )

      const decoded = roundTripDecode(text)
      expect(decoded[0]).toBe(original)
    })

    it('非 ASCII 文字の幅が正しく設定される', () => {
      // é (U+00E9)
      const { text } = generatePdf(
        { default: notoFont },
        [{ text: 'é', fontId: 'default' }],
      )

      // Tj hex from GID get.
      
      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)
      const newGid = parseInt(tjValues[0]!, 16)

      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType2')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)

      const widths = parseWidthArray(cidFonts[0]!.body)
      expect(widths.has(newGid)).toBe(true)

      const origGid = notoFont.getGlyphId(0x00E9)
      const expectedWidth = Math.round(
        notoFont.getAdvanceWidth(origGid) * 1000 / notoFont.metrics.unitsPerEm,
      )
      expect(widths.get(newGid)).toBe(expectedWidth)
    })

    it('ToUnicode CMap に各スクリプトのコードポイントが含まれる', () => {
      const { text } = generatePdf(
        { default: notoFont },
        [{ text: 'AéΑА', fontId: 'default' }],  // Latin, Accented, Greek, Cyrillic
      )

      const cmapMap = parseToUnicodeCMap(text)
      const unicodeValues = [...cmapMap.values()]
      expect(unicodeValues).toContain(0x0041)  // A
      expect(unicodeValues).toContain(0x00E9)  // é
      expect(unicodeValues).toContain(0x0391)  // Α (Greek Alpha)
      expect(unicodeValues).toContain(0x0410)  // А (Cyrillic A)
    })

    it('CIDFontType2 + CIDToGIDMap /Identity（NotoSans は TrueType）', () => {
      const { text } = generatePdf(
        { default: notoFont },
        [{ text: 'ΑΒ', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType2')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)
      expect(cidFonts[0]!.body).toContain('/CIDToGIDMap /Identity')
    })

    it('多数の異なる非 ASCII 文字（サブセットサイズ検証）', () => {
      // 15character: + +.
      
      const chars = 'àáâãäåæçèéΑΒΓΔΕ'
      const { text } = generatePdf(
        { default: notoFont },
        [{ text: chars, fontId: 'default' }],
      )

      // Check.
      
      const decoded = roundTripDecode(text)
      expect(decoded[0]).toBe(chars)

      // Tj hex from all GID get, /W check.
      
      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)
      const hex = tjValues[0]!
      const usedGids = new Set<number>()
      for (let i = 0; i < hex.length; i += 4) {
        usedGids.add(parseInt(hex.substring(i, i + 4), 16))
      }

      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType2')
      const widths = parseWidthArray(cidFonts[0]!.body)
      for (const gid of usedGids) {
        expect(widths.has(gid), `GID ${gid} missing in /W`).toBe(true)
      }
    })
  })

  // ═══ 13. multiplefont ═══.
  
  describe('Multi-font Mixed', () => {
    it('3 フォント混在（TTF + CFF + NotoSans）→ 3 つの Type0', () => {
      const { text } = generatePdf(
        { roboto: ttfFont, source: cffFont, noto: notoFont },
        [
          { text: 'Roboto', fontId: 'roboto' },
          { text: 'Source', fontId: 'source' },
          { text: 'Noto', fontId: 'noto' },
        ],
      )

      const objects = extractPdfObjects(text)
      const type0 = findObjectsByType(objects, '/Type0')
      expect(type0.length).toBe(3)
    })

    it('3 フォントで CIDFontType2 が 2 つ、CIDFontType0 が 1 つ', () => {
      const { text } = generatePdf(
        { roboto: ttfFont, source: cffFont, noto: notoFont },
        [
          { text: 'R', fontId: 'roboto' },
          { text: 'S', fontId: 'source' },
          { text: 'N', fontId: 'noto' },
        ],
      )

      const objects = extractPdfObjects(text)
      const cidType2 = findObjectsByType(objects, '/CIDFontType2')
      const cidType0 = findObjectsByType(objects, '/CIDFontType0')
      expect(cidType2.length).toBe(2)   // Roboto + NotoSans
      expect(cidType0.length).toBe(1)   // SourceSans3
    })

    it('同じ文字を異なるフォントで描画 → 各フォントに独立した ToUnicode', () => {
      const { text } = generatePdf(
        { roboto: ttfFont, noto: notoFont },
        [
          { text: 'A', fontId: 'roboto' },
          { text: 'A', fontId: 'noto' },
        ],
      )

      // Tj <0001> ()
      
      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBe(2)
      expect(tjValues[0]).toBe('0001')
      expect(tjValues[1]).toBe('0001')
    })

    it('同一ページ内でフォント切り替え → 各フォント参照（/F0, /F1 等）が正しい', () => {
      const { text } = generatePdf(
        { roboto: ttfFont, noto: notoFont },
        [
          { text: 'English', fontId: 'roboto' },
          { text: 'Greek', fontId: 'noto' },
        ],
      )

      // /F0 /F1 Tf with.
      
      expect(text).toMatch(/\/F0\s+\d+\s+Tf/)
      expect(text).toMatch(/\/F1\s+\d+\s+Tf/)
    })

    it('各フォントの BaseFont に異なるサブセットプレフィクスが付与', () => {
      const { text } = generatePdf(
        { roboto: ttfFont, source: cffFont },
        [
          { text: 'R', fontId: 'roboto' },
          { text: 'S', fontId: 'source' },
        ],
      )

      const baseNames = [...text.matchAll(/\/BaseFont\s+\/([A-Z]{6}\+\S+)/g)]
        .map(m => m[1]!)
      // All 6 charactercharacter.
      expect(baseNames.length).toBe(4)  
      
      for (const name of baseNames) {
        expect(name).toMatch(/^[A-Z]{6}\+/)
      }
    })
  })

  // ═══ 14. fontvalidate ═══.
  
  describe('Embedded Font Validation', () => {
    it('TTF サブセットが元フォントより小さい', () => {
      const { bytes, text } = generatePdf(
        { default: ttfFont },
        [{ text: 'A', fontId: 'default' }],
      )

      const fontData = extractFontFile2(bytes, text)
      expect(fontData).not.toBeNull()

      // Original font is 488 KB; the subset with one character should be much smaller.
      const origSize = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf')).length
      expect(fontData!.length).toBeLessThan(origSize)
    })

    it('NotoSans サブセットが元フォントより大幅に小さい', () => {
      const { bytes, text } = generatePdf(
        { default: notoFont },
        [{ text: 'ΑΒ', fontId: 'default' }],
      )

      const fontData = extractFontFile2(bytes, text)
      expect(fontData).not.toBeNull()

      // NotoSans is 2 MB; the subset with two characters should be much smaller.
      const origSize = readFileSync(join(FIXTURES, 'NotoSans-Regular.ttf')).length
      expect(fontData!.length).toBeLessThan(origSize * 0.1)
    })

    it('TTF サブセットが有効な SFNT として再ロード可能', () => {
      const { bytes, text } = generatePdf(
        { default: ttfFont },
        [{ text: 'Hello', fontId: 'default' }],
      )

      const fontData = extractFontFile2(bytes, text)
      expect(fontData).not.toBeNull()

      // Load with check (SFNT)
      
      const reloaded = Font.load(fontData!.buffer.slice(
        fontData!.byteOffset, fontData!.byteOffset + fontData!.byteLength,
      ))
      expect(reloaded.numGlyphs).toBeGreaterThan(0)
    })

    it('サブセット後のグリフ数が layout closure を含む compact mapping と一致', () => {
      const { bytes, text } = generatePdf(
        { default: ttfFont },
        [{ text: 'ABC', fontId: 'default' }],
      )

      const fontData = extractFontFile2(bytes, text)
      expect(fontData).not.toBeNull()

      const reloaded = Font.load(fontData!.buffer.slice(
        fontData!.byteOffset, fontData!.byteOffset + fontData!.byteLength,
      ))
      // GSUB outputs referenced by the retained features are physical subset
      // dependencies even when they are not direct cmap targets.
      const mapping = ttfFont.subsetWithMapping('ABC').oldToNewGlyphId
      expect(reloaded.numGlyphs).toBe(mapping.size)
      expect(reloaded.getGlyphId('A'.codePointAt(0)!)).toBeGreaterThan(0)
      expect(reloaded.getGlyphId('B'.codePointAt(0)!)).toBeGreaterThan(0)
      expect(reloaded.getGlyphId('C'.codePointAt(0)!)).toBeGreaterThan(0)
    })

    it('CFF サブセットが有効な CFF ヘッダーを持つ', () => {
      const { bytes, text } = generatePdf(
        { default: cffFont },
        [{ text: 'Hello', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      const ff3Match = descriptors[0]![1].match(/\/FontFile3\s+(\d+)\s+0\s+R/)
      expect(ff3Match).not.toBeNull()

      const streamData = extractStreamData(bytes, Number(ff3Match![1]))
      expect(streamData).not.toBeNull()

      // CFF headervalidate: major=1, minor=0, hdrSize≥4.
      
      expect(streamData![0]).toBe(1)   // major
      expect(streamData![1]).toBe(0)   // minor
      expect(streamData![2]).toBeGreaterThanOrEqual(4)  // hdrSize
    })

    it('NotoSans サブセットに使用した文字のアウトラインが含まれる', () => {
      const chars = 'ΑΒ'  
      const { bytes, text } = generatePdf(
        { default: notoFont },
        [{ text: chars, fontId: 'default' }],
      )

      const fontData = extractFontFile2(bytes, text)
      expect(fontData).not.toBeNull()

      const reloaded = Font.load(fontData!.buffer.slice(
        fontData!.byteOffset, fontData!.byteOffset + fontData!.byteLength,
      ))
      // .notdef + 2character + ≥ 3 glyph.
      
      expect(reloaded.numGlyphs).toBeGreaterThanOrEqual(3)

      // .notdef glyph.
      
      let hasOutline = false
      for (let gid = 1; gid < reloaded.numGlyphs; gid++) {
        const glyph = reloaded.getGlyph(gid)
        if (glyph.outline.commands.length > 0) {
          hasOutline = true
          break
        }
      }
      expect(hasOutline).toBe(true)
    })
  })

  // ═══ 15. multiplepage ═══.
  
  describe('Multi-page', () => {
    it('複数ページの PDF で Page オブジェクトが正しい数', () => {
      const { text } = generateMultiPagePdf(
        { default: ttfFont },
        [
          { width: 595, height: 842, textEntries: [{ text: 'Page1', fontId: 'default' }] },
          { width: 595, height: 842, textEntries: [{ text: 'Page2', fontId: 'default' }] },
          { width: 612, height: 792, textEntries: [{ text: 'Page3', fontId: 'default' }] },
        ],
      )

      const objects = extractPdfObjects(text)
      const pages = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /Page') && !body.includes('/Type /Pages'))
      expect(pages.length).toBe(3)

      // Pages /Count 3.
      
      const pagesObj = [...objects.entries()]
        .find(([_, body]) => body.includes('/Type /Pages'))
      expect(pagesObj).toBeDefined()
      expect(pagesObj![1]).toContain('/Count 3')
    })

    it('異なるサイズのページで各 MediaBox が正しい', () => {
      const { text } = generateMultiPagePdf(
        { default: ttfFont },
        [
          { width: 595, height: 842, textEntries: [{ text: 'A4', fontId: 'default' }] },
          { width: 612, height: 792, textEntries: [{ text: 'Letter', fontId: 'default' }] },
        ],
      )

      expect(text).toContain('/MediaBox [0 0 595 842]')
      expect(text).toContain('/MediaBox [0 0 612 792]')
    })

    it('ページ間でフォントリソースが共有される', () => {
      const { text } = generateMultiPagePdf(
        { default: ttfFont },
        [
          { width: 595, height: 842, textEntries: [{ text: 'Page1', fontId: 'default' }] },
          { width: 595, height: 842, textEntries: [{ text: 'Page2', fontId: 'default' }] },
        ],
      )

      // Type0 font 1 (page with)
      
      const objects = extractPdfObjects(text)
      const type0 = findObjectsByType(objects, '/Type0')
      expect(type0.length).toBe(1)
    })

    it('複数ページで使用した全文字のラウンドトリップ', () => {
      const { text } = generateMultiPagePdf(
        { default: notoFont },
        [
          { width: 595, height: 842, textEntries: [{ text: 'ABC', fontId: 'default' }] },
          { width: 595, height: 842, textEntries: [{ text: 'ΑΒΓ', fontId: 'default' }] },
        ],
      )

      const decoded = roundTripDecode(text)
      expect(decoded).toContain('ABC')
      expect(decoded).toContain('ΑΒΓ')
    })
  })

  // ═══ 16. PDF specificationconformance (ISO 32000-1) ═══.
  
  describe('PDF Spec Compliance (ISO 32000-1)', () => {
    describe('Header & File Structure', () => {
      it('%PDF-1.7 ヘッダーで始まる', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'X', fontId: 'default' }],
        )
        expect(text.startsWith('%PDF-1.7\n')).toBe(true)
      })

      it('ヘッダー後にバイナリマーカー（%に続く 4 バイト ≥ 0x80）がある', () => {
        const { bytes } = generatePdf(
          { default: ttfFont },
          [{ text: 'X', fontId: 'default' }],
        )
        // ISO 32000-1 7.5.2: row.
        // "%PDF-1.7\n%" after 4 all ≥ 128.
        
        
        const headerEnd = decodeLatin1(bytes).indexOf('\n') + 1
        expect(bytes[headerEnd]).toBe(0x25)  // '%'
        expect(bytes[headerEnd + 1]!).toBeGreaterThanOrEqual(128)
        expect(bytes[headerEnd + 2]!).toBeGreaterThanOrEqual(128)
        expect(bytes[headerEnd + 3]!).toBeGreaterThanOrEqual(128)
        expect(bytes[headerEnd + 4]!).toBeGreaterThanOrEqual(128)
      })

      it('%%EOF で終わる', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'X', fontId: 'default' }],
        )
        expect(text.trimEnd()).toMatch(/%%EOF$/)
      })
    })

    describe('Object Structure', () => {
      it('全オブジェクトが "N 0 obj ... endobj" 形式', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Obj', fontId: 'default' }],
        )

        const objects = extractPdfObjects(text)
        expect(objects.size).toBeGreaterThan(0)
        // Eachcheck (extractPdfObjects endobj with get)
        
        for (const [id] of objects) {
          expect(id).toBeGreaterThan(0)
        }
      })

      it('間接参照が "N 0 R" 形式で正しい', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Ref', fontId: 'default' }],
        )

        // All.
        
        const refs = [...text.matchAll(/(\d+)\s+0\s+R/g)]
          .map(m => Number(m[1]))
        const objects = extractPdfObjects(text)

        // Each.
        
        for (const refId of refs) {
          expect(objects.has(refId), `Reference ${refId} 0 R not found`).toBe(true)
        }
      })

      it('stream オブジェクトに /Length が必須', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Stream', fontId: 'default' }],
        )

        // Stream /Length.
        
        const objects = extractPdfObjects(text)
        for (const [_, body] of objects) {
          if (body.includes('stream\n')) {
            expect(body).toContain('/Length ')
          }
        }
      })
    })

    describe('Page Tree', () => {
      it('Catalog → Pages → Page の参照チェーンが有効', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Chain', fontId: 'default' }],
        )

        const objects = extractPdfObjects(text)

        // Catalog → Pages
        const rootMatch = text.match(/\/Root\s+(\d+)\s+0\s+R/)
        const catalogId = Number(rootMatch![1])
        const catalog = objects.get(catalogId)!
        const pagesMatch = catalog.match(/\/Pages\s+(\d+)\s+0\s+R/)
        const pagesId = Number(pagesMatch![1])

        // Pages → Page
        const pagesObj = objects.get(pagesId)!
        expect(pagesObj).toContain('/Type /Pages')
        expect(pagesObj).toContain('/Kids')
        const kidsMatch = pagesObj.match(/\/Kids\s*\[([\s\S]*?)\]/)
        expect(kidsMatch).not.toBeNull()

        // Kids each Page.
        
        const kidRefs = [...kidsMatch![1]!.matchAll(/(\d+)\s+0\s+R/g)]
          .map(m => Number(m[1]))
        expect(kidRefs.length).toBeGreaterThan(0)
        for (const kidId of kidRefs) {
          const page = objects.get(kidId)!
          expect(page).toContain('/Type /Page')
          // Page Parent.
          
          expect(page).toContain(`/Parent ${pagesId} 0 R`)
        }
      })

      it('Page に /MediaBox, /Contents, /Resources が必須', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Page', fontId: 'default' }],
        )

        const objects = extractPdfObjects(text)
        const pages = [...objects.entries()]
          .filter(([_, body]) => body.includes('/Type /Page') && !body.includes('/Type /Pages'))
        expect(pages.length).toBeGreaterThanOrEqual(1)

        for (const [_, body] of pages) {
          expect(body).toContain('/MediaBox')
          expect(body).toContain('/Contents')
          expect(body).toContain('/Resources')
        }
      })

      it('/MediaBox が [0 0 W H] 形式', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Box', fontId: 'default' }],
        )

        const mediaBoxes = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)]
        expect(mediaBoxes.length).toBeGreaterThan(0)
        for (const m of mediaBoxes) {
          // 4 value.
          
          expect(m[1]!.trim()).toMatch(/^0\s+0\s+\d+(\.\d+)?\s+\d+(\.\d+)?$/)
        }
      })
    })

    describe('Content Stream', () => {
      it('テキスト描画が BT ... ET で囲まれる', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'BT', fontId: 'default' }],
        )

        // BT ET.
        
        const btCount = (text.match(/\nBT\n/g) || []).length
        const etCount = (text.match(/\nET\n/g) || []).length
        expect(btCount).toBeGreaterThan(0)
        expect(btCount).toBe(etCount)
      })

      it('Tf（フォント選択）が BT ... ET 内にある', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Tf', fontId: 'default' }],
        )

        // BT〜ET Tf.
        
        const btEtSection = text.match(/BT\n([\s\S]*?)ET/g)
        expect(btEtSection).not.toBeNull()
        expect(btEtSection![0]).toMatch(/\/F\d+\s+\d+(\.\d+)?\s+Tf/)
      })

      it('Tm（テキスト行列）が BT ... ET 内にある', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Tm', fontId: 'default' }],
        )

        const btEtSection = text.match(/BT\n([\s\S]*?)ET/g)
        expect(btEtSection).not.toBeNull()
        // Tm: 6 value + Tm.
        
        expect(btEtSection![0]).toMatch(/[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+Tm/)
      })

      it('ページ先頭に Y 軸反転 CTM がある', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'CTM', fontId: 'default' }],
        )

        // 1 0 0 -1 0 <height> cm
        expect(text).toMatch(/1 0 0 -1 0 \d+ cm/)
      })

      it('グラフィクスステートの save/restore（q/Q）がペアになっている', () => {
        const { text } = generatePdfWithNodes(
          { default: ttfFont },
          [{
            type: 'group', x: 10, y: 10, width: 100, height: 50,
            children: [{
              type: 'text', x: 0, y: 0, text: 'Nested',
              fontId: 'default', fontSize: 10, color: '#000000',
            }],
          }],
        )

        const qCount = (text.match(/\nq\n/g) || []).length
        const QCount = (text.match(/\nQ\n/g) || []).length
        expect(qCount).toBeGreaterThan(0)
        expect(qCount).toBe(QCount)
      })
    })

    describe('Resource Dictionary', () => {
      it('/Font 辞書にフォント参照が含まれる', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Font', fontId: 'default' }],
        )

        // /Resources << /Font << /F0 N 0 R >> >>
        expect(text).toMatch(/\/Font\s*<<[^>]*\/F\d+\s+\d+\s+0\s+R/)
      })

      it('ExtGState が opacity 使用時にリソースに含まれる', () => {
        const { text } = generatePdfWithNodes(
          { default: ttfFont },
          [{
            type: 'group', x: 0, y: 0, width: 100, height: 100,
            opacity: 0.5,
            children: [],
          }],
        )

        expect(text).toMatch(/\/ExtGState\s*<<[^>]*\/GS\d+\s+\d+\s+0\s+R/)
      })
    })

    describe('Cross-reference Stream', () => {
      it('startxref が xref ストリームオブジェクトを指す', () => {
        const { bytes } = generatePdf(
          { default: ttfFont },
          [{ text: 'Xref', fontId: 'default' }],
        )
        // Position validate raw text for.
        
        const text = decodeLatin1(bytes)

        const startxrefMatch = text.match(/startxref\n(\d+)\n/)
        expect(startxrefMatch).not.toBeNull()
        const xrefOffset = Number(startxrefMatch![1])

        // "N 0 obj" (xref)
        
        const atOffset = text.substring(xrefOffset, xrefOffset + 20)
        expect(atOffset).toMatch(/^\d+ 0 obj/)
      })

      it('xref ストリームに /Type /XRef と /W 配列が含まれる', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Entry', fontId: 'default' }],
        )

        // /Type /XRef.
        
        expect(text).toContain('/Type /XRef')
        // /W width ([1 N M] expression, ObjStm fortime M > 0)
        
        expect(text).toMatch(/\/W \[1 \d+ \d+\]/)
        // ASCII xref table.
        
        expect(text).not.toMatch(/^xref\n/m)
      })

      it('xref ストリームに /Size と /Root が含まれる', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Size', fontId: 'default' }],
        )

        // /Size:
        
        const sizeMatch = text.match(/\/Size\s+(\d+)/)
        expect(sizeMatch).not.toBeNull()
        const size = Number(sizeMatch![1])
        expect(size).toBeGreaterThan(0)

        // /Root: Catalog.
        
        expect(text).toMatch(/\/Root \d+ 0 R/)
      })
    })

    describe('Font Naming Convention', () => {
      it('サブセットプレフィクスが [A-Z]{6}+ 形式', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Name', fontId: 'default' }],
        )

        const baseNames = [...text.matchAll(/\/BaseFont\s+\/([^\s>]+)/g)]
          .map(m => m[1]!)
        expect(baseNames.length).toBeGreaterThan(0)
        for (const name of baseNames) {
          expect(name).toMatch(/^[A-Z]{6}\+.+/)
        }
      })

      it('/FontName と /BaseFont が一致', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Match', fontId: 'default' }],
        )

        const objects = extractPdfObjects(text)

        // Type0 BaseFont.
        
        const type0 = findObjectsByType(objects, '/Type0')
        const baseNameMatch = type0[0]!.body.match(/\/BaseFont\s+\/(\S+)/)
        const baseName = baseNameMatch![1]!

        // FontDescriptor FontName.
        const descriptors = [...objects.entries()]
          .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
        const fontNameMatch = descriptors[0]![1].match(/\/FontName\s+\/(\S+)/)
        const fontName = fontNameMatch![1]!

        expect(baseName).toBe(fontName)
      })
    })

    describe('CIDSystemInfo', () => {
      it('/Registry が (Adobe)、/Ordering が (Identity)、/Supplement が 0', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'CID', fontId: 'default' }],
        )

        const objects = extractPdfObjects(text)
        const cidFonts = findObjectsByType(objects, '/CIDFontType2')
        expect(cidFonts.length).toBeGreaterThanOrEqual(1)

        const body = cidFonts[0]!.body
        expect(body).toMatch(/\/Registry\s*\(Adobe\)/)
        expect(body).toMatch(/\/Ordering\s*\(Identity\)/)
        expect(body).toMatch(/\/Supplement\s+0/)
      })
    })

    describe('ToUnicode CMap Format', () => {
      it('/CIDInit /ProcSet findresource begin で開始', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'CMap', fontId: 'default' }],
        )

        expect(text).toContain('/CIDInit /ProcSet findresource begin')
      })

      it('/CMapName /Adobe-Identity-UCS def が含まれる', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'CMap', fontId: 'default' }],
        )

        expect(text).toContain('/CMapName /Adobe-Identity-UCS def')
      })

      it('/CMapType 2 def が含まれる', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'CMap', fontId: 'default' }],
        )

        expect(text).toContain('/CMapType 2 def')
      })

      it('codespacerange が <0000> <FFFF>（2バイト CID 空間）', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'CS', fontId: 'default' }],
        )

        expect(text).toContain('1 begincodespacerange')
        expect(text).toContain('<0000> <FFFF>')
        expect(text).toContain('endcodespacerange')
      })

      it('bfchar エントリ数が使用文字数と一致', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'ABCDE', fontId: 'default' }],
        )

        // Beginbfchar previousvalue.
        
        const bfcharCount = text.match(/(\d+)\s+beginbfchar/)
        expect(bfcharCount).not.toBeNull()
        expect(Number(bfcharCount![1])).toBe(5)  // A, B, C, D, E
      })
    })

    describe('Color Space', () => {
      it('テキスト色が塗り色演算子で設定（黒はDeviceGrayのg）', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Color', fontId: 'default' }],
        )

        // Black text uses the DeviceGray fill operator: 0 g
        expect(text).toMatch(/[\d.]+ g\b/)
      })

      it('線色が RG（大文字 = ストローク色）で設定', () => {
        const { text } = generatePdfWithNodes(
          { default: ttfFont },
          [{
            type: 'line', x1: 0, y1: 0, x2: 100, y2: 0,
            lineWidth: 1, color: '#FF0000',
          }],
        )

        expect(text).toMatch(/[\d.]+ [\d.]+ [\d.]+ RG/)
      })

      it('RGB 値が 0.0〜1.0 の範囲', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{
            text: 'RGB', fontId: 'default',
          }],
        )

        const rgMatches = [...text.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)]
        for (const m of rgMatches) {
          const r = Number(m[1]), g = Number(m[2]), b = Number(m[3])
          expect(r).toBeGreaterThanOrEqual(0)
          expect(r).toBeLessThanOrEqual(1)
          expect(g).toBeGreaterThanOrEqual(0)
          expect(g).toBeLessThanOrEqual(1)
          expect(b).toBeGreaterThanOrEqual(0)
          expect(b).toBeLessThanOrEqual(1)
        }
      })
    })

    describe('ExtGState', () => {
      it('/Type /ExtGState と /ca, /CA が含まれる', () => {
        const { text } = generatePdfWithNodes(
          { default: ttfFont },
          [{
            type: 'group', x: 0, y: 0, width: 100, height: 100,
            opacity: 0.7,
            children: [],
          }],
        )

        const objects = extractPdfObjects(text)
        const gsObjs = [...objects.entries()]
          .filter(([_, body]) => body.includes('/Type /ExtGState'))
        expect(gsObjs.length).toBeGreaterThanOrEqual(1)

        const gs = gsObjs[0]![1]
        expect(gs).toContain('/ca ')   
        expect(gs).toContain('/CA ')   
      })

      it('opacity 値が正確に反映される', () => {
        const { text } = generatePdfWithNodes(
          { default: ttfFont },
          [{
            type: 'group', x: 0, y: 0, width: 100, height: 100,
            opacity: 0.3,
            children: [],
          }],
        )

        expect(text).toContain('/ca 0.3')
        expect(text).toContain('/CA 0.3')
      })
    })

    describe('Font Flags', () => {
      it('/Flags に Symbolic (bit 2 = 4) が設定されている', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'Flags', fontId: 'default' }],
        )

        const objects = extractPdfObjects(text)
        const descriptors = [...objects.entries()]
          .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
        expect(descriptors.length).toBeGreaterThanOrEqual(1)

        const flagsMatch = descriptors[0]![1].match(/\/Flags\s+(\d+)/)
        expect(flagsMatch).not.toBeNull()
        const flags = Number(flagsMatch![1])
        // Symbolic bit (bit 2) = 4
        expect(flags & 4).toBe(4)
      })
    })

    describe('FontBBox', () => {
      it('/FontBBox が [llx lly urx ury] 形式で数値 4 つ', () => {
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: 'BBox', fontId: 'default' }],
        )

        const objects = extractPdfObjects(text)
        const descriptors = [...objects.entries()]
          .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
        const desc = descriptors[0]![1]

        const bboxMatch = desc.match(/\/FontBBox\s*\[([^\]]+)\]/)
        expect(bboxMatch).not.toBeNull()
        const values = bboxMatch![1]!.trim().split(/\s+/).map(Number)
        expect(values.length).toBe(4)
        // llx <= urx, lly <= ury
        expect(values[0]!).toBeLessThanOrEqual(values[2]!)
        expect(values[1]!).toBeLessThanOrEqual(values[3]!)
      })

      it('/FontBBox が使用グリフの真の範囲を内包する（floor/ceil で丸め、round でクリップしない）', () => {
        // ISO 32000-1 9.8.1: FontBBox must encompass the glyphs. Scaling font
        // units to 1000/upm with Math.round shrinks the box inside a glyph's
        // true extent (up to 0.5 units) for the majority of glyphs; the low
        // corners must floor and the high corners ceil.
        const chars = 'Wjgypq@#Ð'
        const { text } = generatePdf(
          { default: ttfFont },
          [{ text: chars, fontId: 'default' }],
        )
        const objects = extractPdfObjects(text)
        const desc = [...objects.entries()].find(([_, body]) => body.includes('/Type /FontDescriptor'))![1]
        const m = desc.match(/\/FontBBox\s*\[(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\]/)!
        const [llx, lly, urx, ury] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
        const scale = 1000 / ttfFont.metrics.unitsPerEm
        for (const ch of chars) {
          const g = ttfFont.getGlyph(ttfFont.getGlyphId(ch.codePointAt(0)!))
          if (g.xMax === g.xMin) continue
          expect(llx).toBeLessThanOrEqual(g.xMin * scale + 1e-9)
          expect(lly).toBeLessThanOrEqual(g.yMin * scale + 1e-9)
          expect(urx).toBeGreaterThanOrEqual(g.xMax * scale - 1e-9)
          expect(ury).toBeGreaterThanOrEqual(g.yMax * scale - 1e-9)
        }
      })
    })
  })

  // ═══ 17. draw ═══.
  
  describe('Graphics Content Stream', () => {
    it('矩形の fill/stroke 演算子が正しい', () => {
      const { text } = generatePdfWithNodes(
        { default: ttfFont },
        [
          { type: 'rect', x: 10, y: 20, width: 100, height: 50, fill: '#FF0000' },
          { type: 'rect', x: 10, y: 80, width: 100, height: 50, stroke: '#0000FF', strokeWidth: 2 },
          { type: 'rect', x: 10, y: 140, width: 100, height: 50, fill: '#00FF00', stroke: '#000000', strokeWidth: 1 },
        ],
      )

      // Fill -> f.
      
      expect(text).toContain('re\nf\n')
      // Stroke -> S.
      
      expect(text).toContain('re\nS\n')
      // fill + stroke → B
      expect(text).toContain('re\nB\n')
    })

    it('楕円が 4 つのベジエ曲線（c）+ close（h）で描画', () => {
      const { text } = generatePdfWithNodes(
        { default: ttfFont },
        [{
          type: 'ellipse', cx: 100, cy: 100, rx: 50, ry: 30,
          fill: '#00FF00',
        }],
      )

      // M with, c 4, h with.
      
      const streamContent = text.match(/1 0 0 -1[\s\S]*?endstream/)
      expect(streamContent).not.toBeNull()
      const cCount = (streamContent![0].match(/ c\n/g) || []).length
      expect(cCount).toBe(4)
      expect(streamContent![0]).toContain('h\n')
    })

    it('アンダーラインがテキストとともに描画される', () => {
      const { text } = generatePdfWithNodes(
        { default: ttfFont },
        [{
          type: 'text', x: 72, y: 72, text: 'Underlined',
          fontId: 'default', fontSize: 12, color: '#000000',
          underline: true,
        }],
      )

      // Textdrawafter (m... l S)
      
      expect(text).toMatch(/ET[\s\S]*?\d[\s\S]*?m[\s\S]*?l S/)
    })

    it('取り消し線がテキストとともに描画される', () => {
      const { text } = generatePdfWithNodes(
        { default: ttfFont },
        [{
          type: 'text', x: 72, y: 72, text: 'Strikethrough',
          fontId: 'default', fontSize: 12, color: '#000000',
          strikethrough: true,
        }],
      )

      // Textdrawafter.
      
      expect(text).toMatch(/ET[\s\S]*?\d[\s\S]*?m[\s\S]*?l S/)
    })
  })

  // ═══ 18. Japanesefont - CFF/OTF ═══.
  
  describe('Japanese Font - CFF/OTF (NotoSansJP)', () => {
    it('"あいう" の GID リマッピング: Tj hex が新 GID 連番', () => {
      const { text } = generatePdf(
        { default: jpFont },
        [{ text: 'あいう', fontId: 'default' }],
      )

      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBeGreaterThanOrEqual(1)
      // 3character × 4 hex digits = 12.
      
      expect(tjValues[0]!.length).toBe(12)
      // GID 0001, 0002, 0003 ()
      
      expect(tjValues[0]).toBe('000100020003')
    })

    it('ToUnicode: 新 GID → ひらがな Unicode マッピング', () => {
      const { text } = generatePdf(
        { default: jpFont },
        [{ text: 'あいう', fontId: 'default' }],
      )

      const cmapMap = parseToUnicodeCMap(text)
      expect(cmapMap.get(1)).toBe(0x3042)  
      expect(cmapMap.get(2)).toBe(0x3044)  
      expect(cmapMap.get(3)).toBe(0x3046)  
    })

    it('/W 配列: 日本語全角文字の幅が正しい', () => {
      const { text } = generatePdf(
        { default: jpFont },
        [{ text: 'あ', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const cidFonts = findObjectsByType(objects, '/CIDFontType0')
      expect(cidFonts.length).toBeGreaterThanOrEqual(1)

      const widths = parseWidthArray(cidFonts[0]!.body)
      expect(widths.has(1)).toBe(true)

      const origGid = jpFont.getGlyphId(0x3042)
      const expectedWidth = Math.round(
        jpFont.getAdvanceWidth(origGid) * 1000 / jpFont.metrics.unitsPerEm,
      )
      expect(widths.get(1)).toBe(expectedWidth)
      // Japanesecharacter 1000 units.
      
      expect(widths.get(1)!).toBeGreaterThan(500)
    })

    it('FontDescriptor: /FontFile3 /CIDFontType0C', () => {
      const { text } = generatePdf(
        { default: jpFont },
        [{ text: 'あ', fontId: 'default' }],
      )

      const objects = extractPdfObjects(text)
      const descriptors = [...objects.entries()]
        .filter(([_, body]) => body.includes('/Type /FontDescriptor'))
      expect(descriptors.length).toBeGreaterThanOrEqual(1)

      const desc = descriptors[0]![1]
      expect(desc).toContain('/FontFile3')

      const ff3Match = desc.match(/\/FontFile3\s+(\d+)\s+0\s+R/)
      expect(ff3Match).not.toBeNull()
      const ff3Id = Number(ff3Match![1])
      const ff3Obj = objects.get(ff3Id)
      expect(ff3Obj).toBeDefined()
      expect(ff3Obj).toContain('/Subtype /CIDFontType0C')
    })
  })

  // ═══ 19. Japanese+Latin - Multi-font ═══.
  
  describe('Japanese + Latin Multi-font', () => {
    it('Roboto(TTF) + NotoSansJP(CFF) → 2 つの Type0 フォント', () => {
      const { text } = generatePdf(
        { en: ttfFont, jp: jpFont },
        [
          { text: 'Hello', fontId: 'en' },
          { text: '世界', fontId: 'jp' },
        ],
      )

      const objects = extractPdfObjects(text)
      const type0 = findObjectsByType(objects, '/Type0')
      expect(type0.length).toBe(2)
    })

    it('各フォントの GID リマッピングが独立', () => {
      const { text } = generatePdf(
        { en: ttfFont, jp: jpFont },
        [
          { text: 'AB', fontId: 'en' },
          { text: 'あい', fontId: 'jp' },
        ],
      )

      const tjValues = extractTjHexValues(text)
      expect(tjValues.length).toBe(2)
      // Eachfont with 0001 from.
      
      expect(tjValues[0]!.substring(0, 4)).toBe('0001')
      expect(tjValues[1]!.substring(0, 4)).toBe('0001')
    })

    it('Round-trip: 各フォントの bfchar に正しい Unicode マッピングが存在', () => {
      const { text } = generatePdf(
        { en: ttfFont, jp: jpFont },
        [
          { text: 'Hello', fontId: 'en' },
          { text: '世界', fontId: 'jp' },
        ],
      )

      // PDF all bfchar collect (GID with value)
      
      const allUnicodes = new Set<number>()
      const bfcharSections = text.match(/beginbfchar\n([\s\S]*?)endbfchar/g)
      expect(bfcharSections).not.toBeNull()
      expect(bfcharSections!.length).toBe(2)  
      for (const section of bfcharSections!) {
        const re = /<[0-9A-Fa-f]{4}>\s*<([0-9A-Fa-f]{4})>/g
        let m: RegExpExecArray | null
        while ((m = re.exec(section)) !== null) {
          allUnicodes.add(parseInt(m[1]!, 16))
        }
      }

      // 'Hello' eachcharacter.
      
      for (const ch of 'Hello') {
        expect(allUnicodes.has(ch.codePointAt(0)!), `missing ${ch}`).toBe(true)
      }
      // '' eachcharacter.
      
      for (const ch of '世界') {
        expect(allUnicodes.has(ch.codePointAt(0)!), `missing ${ch}`).toBe(true)
      }
    })
  })

  // ═══ 20. Japanese Round-trip ═══.
  
  describe('Japanese Round-trip', () => {
    it('ひらがな: "あいうえお" → PDF → 復元', () => {
      const original = 'あいうえお'
      const { text } = generatePdf(
        { default: jpFont },
        [{ text: original, fontId: 'default' }],
      )

      const decoded = roundTripDecode(text)
      expect(decoded.length).toBeGreaterThanOrEqual(1)
      expect(decoded[0]).toBe(original)
    })

    it('カタカナ+漢字混在: "テスト検証" → PDF → 復元', () => {
      const original = 'テスト検証'
      const { text } = generatePdf(
        { default: jpFont },
        [{ text: original, fontId: 'default' }],
      )

      const decoded = roundTripDecode(text)
      expect(decoded[0]).toBe(original)
    })

    it('Latin+日本語混在（同一フォント内）: "ABC漢字" → PDF → 復元', () => {
      const original = 'ABC漢字'
      const { text } = generatePdf(
        { default: jpFont },
        [{ text: original, fontId: 'default' }],
      )

      const decoded = roundTripDecode(text)
      expect(decoded[0]).toBe(original)
    })
  })
})

// CFF2 (variable) fonts are embedded by baking the current instance into a
// static CID-keyed CFF (CIDFontType0C): the CFF2 charstrings are interpreted
// to plain outlines, re-encoded as Type 2 charstrings, and the exact same
// outlines the rasteriser draws are embedded, so preview and print agree.
const SFINDIA = '/System/Library/Fonts/SFIndia.ttc'
describe.skipIf(!existsSync(SFINDIA))('CFF2 variable font PDF output', () => {
  it('embeds CFF2 glyphs as a static CIDFontType0C and shows them as text', () => {
    const font = Font.load(readFileSync(SFINDIA).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { default: font } })
    const doc: RenderDocument = {
      pages: [{
        width: 200, height: 80,
        children: [{ type: 'text', x: 10, y: 40, text: 'Ab', fontId: 'default', fontSize: 20, color: '#000000' }],
      }],
    }
    render(doc, backend)
    const pdfText = pdfToText(backend.toUint8Array())
    // The font is embedded as CFF (FontFile3 /CIDFontType0C) and selected by a
    // text-showing operator, exactly like a static CFF/OTF font.
    expect(pdfText).toContain('/FontFile3')
    expect(pdfText).toContain('/CIDFontType0C')
    expect(pdfText).toMatch(/\/F\d+ [\d.]+ Tf/)
  })

  it('embeds outlines that re-parse identically to the source CFF2 glyphs', () => {
    const font = Font.load(readFileSync(SFINDIA).buffer as ArrayBuffer)
    // A spread of glyphs with real outlines from the CFF2 charstrings.
    const gids = new Set<number>([0])
    for (let g = 1; g < font.numGlyphs && gids.size < 40; g++) {
      if (font.getGlyph(g).outline.commands.length > 0) gids.add(g)
    }
    const result = font.subsetByGlyphIds(gids)
    expect(result.cidKeyedCff).toBeDefined()
    expect(result.buffer.byteLength).toBeGreaterThan(0)
    const wrapped = Font.load(result.buffer)
    expect(wrapped.numGlyphs).toBe(gids.size)
    const cff = parseCff(new BinaryReader(
      result.cidKeyedCff!.buffer.slice(result.cidKeyedCff!.byteOffset, result.cidKeyedCff!.byteOffset + result.cidKeyedCff!.byteLength) as ArrayBuffer,
    ))
    for (const [oldGid, newGid] of result.oldToNewGlyphId) {
      const src = font.getGlyph(oldGid).outline
      const emb = parseCffGlyph(cff, newGid).outline
      expect(Array.from(emb.commands), `commands gid ${oldGid}`).toEqual(Array.from(src.commands))
      // Charstrings are integer-based; the source outline is compared rounded.
      for (let i = 0; i < src.coords.length; i++) {
        expect(emb.coords[i]).toBe(Math.round(src.coords[i]!))
      }
    }
  })
})

// A bitmap-only font (embedded bitmaps via bdat/bloc, no glyf/CFF outlines and
// no OS/2) is drawn glyph-by-glyph as bitmap images; it cannot be subset, so it
// is neither embedded nor referenced by a text-showing operator.
const NISC18030 = '/System/Library/Fonts/Supplemental/NISC18030.ttf'
describe.skipIf(!existsSync(NISC18030))('bitmap-only font PDF output', () => {
  it('draws embedded bitmaps as images instead of failing to embed', () => {
    const font = Font.load(readFileSync(NISC18030).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { default: font } })
    const doc: RenderDocument = {
      pages: [{
        width: 200, height: 80,
        children: [{ type: 'text', x: 10, y: 40, text: '一二三', fontId: 'default', fontSize: 20, color: '#000000' }],
      }],
    }
    render(doc, backend)
    const bytes = backend.toUint8Array()
    const pdfText = pdfToText(bytes)
    // Bitmap glyphs are painted as XObject images; the font is not embedded
    // (no FontFile2/3) nor selected by a text-showing operator.
    expect(pdfText).toContain('/Subtype /Image')
    expect(pdfText).not.toContain('/FontFile2')
    expect(pdfText).not.toContain('/FontFile3')
    expect(pdfText).not.toMatch(/\/F\d+ [\d.]+ Tf/)
  })
})
