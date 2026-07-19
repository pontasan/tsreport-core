import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Font } from '../../src/font.js'
import { SvgBackend } from '../../src/renderer/svg-backend.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { prepareBitmapGlyph } from '../../src/renderer/bitmap-glyph.js'
import { decodeTiffToRgba } from '../../src/renderer/tiff-decoder.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'
import { decodePng } from '../../src/image/png-parser.js'
import { parseFont } from '../../src/parsers/index.js'
import { getTableReader } from '../../src/parsers/sfnt-parser.js'
import { buildTestFont, buildTable, encodeSimpleGlyph, buildFont, buildHead, buildMaxp, buildHhea, buildHmtx, buildCmap4, buildOs2, buildPost, buildName } from './synthetic-font.js'

const HB_VIEW = '/opt/homebrew/bin/hb-view'

/**
 * Embedded bitmap glyph rendering: sbix / CBDT / EBDT → prepareBitmapGlyph →
 * backend drawImageData, with strike selection, metrics and colorization.
 */

/** Solid-color RGBA PNG */
function makePng(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }
  return encodePngRgba(width, height, rgba)
}

/** sbix table with one strike; per-glyph records (null = no bitmap) */
function buildSbix(
  ppem: number,
  numGlyphs: number,
  records: (null | { graphicType: string, data: Uint8Array, offsetX: number, offsetY: number })[],
  flags = 1,
): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1) // version
    w.writeUint16(flags)
    w.writeUint32(1) // numStrikes
    w.writeUint32(12) // strikeOffset[0]
    // strike header
    w.writeUint16(ppem)
    w.writeUint16(72) // ppi
    // glyphDataOffsets[numGlyphs + 1] (from strike start)
    let dataOffset = 4 + (numGlyphs + 1) * 4
    for (let g = 0; g <= numGlyphs; g++) {
      w.writeUint32(dataOffset)
      if (g < numGlyphs) {
        const rec = records[g]
        if (rec) dataOffset += 8 + rec.data.length
      }
    }
    for (let g = 0; g < numGlyphs; g++) {
      const rec = records[g]
      if (!rec) continue
      w.writeInt16(rec.offsetX)
      w.writeInt16(rec.offsetY)
      w.writeTag(rec.graphicType)
      w.writeBytes(rec.data)
    }
  })
}

/**
 * CBLC + CBDT (format 17: small metrics + PNG, index format 1) for one glyph
 */
function buildCbdtPair(opts: {
  glyphId: number
  png: Uint8Array
  width: number
  height: number
  bearingX: number
  bearingY: number
  ppem: number
}): { cblc: Uint8Array, cbdt: Uint8Array } {
  const cbdt = buildTable(w => {
    w.writeUint16(3); w.writeUint16(0) // version 3.0
    // format 17 record: smallGlyphMetrics(5) + dataLen(4) + png
    w.writeUint8(opts.height)
    w.writeUint8(opts.width)
    w.writeUint8(opts.bearingX & 0xFF)
    w.writeUint8(opts.bearingY & 0xFF)
    w.writeUint8(opts.width + 1) // advance
    w.writeUint32(opts.png.length)
    w.writeBytes(opts.png)
  })
  const recordSize = 5 + 4 + opts.png.length

  const cblc = buildTable(w => {
    w.writeUint16(3); w.writeUint16(0) // version 3.0
    w.writeUint32(1) // numSizes
    // BitmapSize record (48 bytes)
    w.writeUint32(8 + 48) // indexSubTableArrayOffset
    w.writeUint32(24) // IndexSubTableArray + format-1 subtable
    w.writeUint32(1) // numberOfIndexSubTables
    w.writeUint32(0) // colorRef
    for (let i = 0; i < 24; i++) w.writeUint8(0) // hori + vert sbitLineMetrics
    w.writeUint16(opts.glyphId) // startGlyphIndex
    w.writeUint16(opts.glyphId) // endGlyphIndex
    w.writeUint8(opts.ppem) // ppemX
    w.writeUint8(opts.ppem) // ppemY
    w.writeUint8(32) // bitDepth
    w.writeUint8(1) // flags (horizontal)
    // IndexSubTableArray (1 entry)
    w.writeUint16(opts.glyphId) // firstGlyphIndex
    w.writeUint16(opts.glyphId) // lastGlyphIndex
    w.writeUint32(8) // additionalOffsetToIndexSubtable
    // IndexSubTable format 1
    w.writeUint16(1) // indexFormat
    w.writeUint16(17) // imageFormat
    w.writeUint32(4) // imageDataOffset (after the 4-byte CBDT header)
    w.writeUint32(0) // offset[0]
    w.writeUint32(recordSize) // offset[1]
  })

  return { cblc, cbdt }
}

/** CBLC + CBDT format 6 with premultiplied 32-bit BGRA pixels. */
function buildCbdtBgraPair(glyphId: number, width: number, height: number, bgra: Uint8Array): { cblc: Uint8Array, cbdt: Uint8Array } {
  const cbdt = buildTable(w => {
    w.writeUint16(3); w.writeUint16(0)
    w.writeUint8(height)
    w.writeUint8(width)
    w.writeUint8(0)
    w.writeUint8(height)
    w.writeUint8(width)
    w.writeUint8(0)
    w.writeUint8(0)
    w.writeUint8(height)
    w.writeBytes(bgra)
  })
  const recordSize = 8 + bgra.length
  const cblc = buildTable(w => {
    w.writeUint16(3); w.writeUint16(0)
    w.writeUint32(1)
    w.writeUint32(56)
    w.writeUint32(24)
    w.writeUint32(1)
    w.writeUint32(0)
    for (let i = 0; i < 24; i++) w.writeUint8(0)
    w.writeUint16(glyphId)
    w.writeUint16(glyphId)
    w.writeUint8(16)
    w.writeUint8(16)
    w.writeUint8(32)
    w.writeUint8(1)
    w.writeUint16(glyphId)
    w.writeUint16(glyphId)
    w.writeUint32(8)
    w.writeUint16(1)
    w.writeUint16(6)
    w.writeUint32(4)
    w.writeUint32(0)
    w.writeUint32(recordSize)
  })
  return { cblc, cbdt }
}

/**
 * EBLC + EBDT (format 1: small metrics + byte-aligned rows) for one glyph
 */
function buildEbdtPair(opts: {
  glyphId: number
  rows: number[] // one byte per row (bitDepth 1, width <= 8)
  width: number
  height: number
  bearingX: number
  bearingY: number
  ppem: number
  ppemX?: number
  ppemY?: number
  flags?: 1 | 2
}): { eblc: Uint8Array, ebdt: Uint8Array } {
  const ebdt = buildTable(w => {
    w.writeUint16(2); w.writeUint16(0) // version 2.0
    w.writeUint8(opts.height)
    w.writeUint8(opts.width)
    w.writeUint8(opts.bearingX & 0xFF)
    w.writeUint8(opts.bearingY & 0xFF)
    w.writeUint8(opts.width + 1) // advance
    for (const row of opts.rows) w.writeUint8(row)
  })
  const recordSize = 5 + opts.rows.length

  const eblc = buildTable(w => {
    w.writeUint16(2); w.writeUint16(0) // version 2.0
    w.writeUint32(1) // numSizes
    w.writeUint32(8 + 48) // indexSubTableArrayOffset
    w.writeUint32(24) // IndexSubTableArray + format-1 subtable
    w.writeUint32(1) // numberOfIndexSubTables
    w.writeUint32(0) // colorRef
    for (let i = 0; i < 24; i++) w.writeUint8(0)
    w.writeUint16(opts.glyphId)
    w.writeUint16(opts.glyphId)
    w.writeUint8(opts.ppemX ?? opts.ppem)
    w.writeUint8(opts.ppemY ?? opts.ppem)
    w.writeUint8(1) // bitDepth
    w.writeUint8(opts.flags ?? 1)
    w.writeUint16(opts.glyphId)
    w.writeUint16(opts.glyphId)
    w.writeUint32(8)
    w.writeUint16(1) // indexFormat
    w.writeUint16(1) // imageFormat 1
    w.writeUint32(4) // imageDataOffset
    w.writeUint32(0)
    w.writeUint32(recordSize)
  })

  return { eblc, ebdt }
}

function buildEbsc(targetX: number, targetY: number, sourceX: number, sourceY: number): Uint8Array {
  return buildTable(w => {
    w.writeUint16(2); w.writeUint16(0)
    w.writeUint32(1)
    for (let i = 0; i < 24; i++) w.writeUint8(0)
    w.writeUint8(targetX)
    w.writeUint8(targetY)
    w.writeUint8(sourceX)
    w.writeUint8(sourceY)
  })
}

/** Minimal little-endian uncompressed 8-bit grayscale TIFF */
function buildGrayTiff(width: number, height: number, pixels: number[]): Uint8Array {
  const numEntries = 8
  const ifdOffset = 8
  const dataOffset = ifdOffset + 2 + numEntries * 12 + 4
  const buf = new ArrayBuffer(dataOffset + pixels.length)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  bytes[0] = 0x49; bytes[1] = 0x49 // 'II'
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  let pos = ifdOffset
  view.setUint16(pos, numEntries, true); pos += 2
  const entries: [number, number, number, number][] = [
    [256, 3, 1, width], // ImageWidth
    [257, 3, 1, height], // ImageLength
    [258, 3, 1, 8], // BitsPerSample
    [259, 3, 1, 1], // Compression: none
    [262, 3, 1, 1], // Photometric: BlackIsZero
    [273, 4, 1, dataOffset], // StripOffsets
    [277, 3, 1, 1], // SamplesPerPixel
    [279, 4, 1, pixels.length], // StripByteCounts
  ]
  for (const [tag, type, count, value] of entries) {
    view.setUint16(pos, tag, true); pos += 2
    view.setUint16(pos, type, true); pos += 2
    view.setUint32(pos, count, true); pos += 4
    if (type === 3) view.setUint16(pos, value, true)
    else view.setUint32(pos, value, true)
    pos += 4
  }
  view.setUint32(pos, 0, true); pos += 4 // next IFD
  for (let i = 0; i < pixels.length; i++) bytes[dataOffset + i] = pixels[i]!
  return bytes
}

const SQUARE: [number, number][] = [[100, 100], [500, 100], [500, 500], [100, 500]]

describe('CBDT bitmap glyphs', () => {
  const png = makePng(4, 4, 255, 0, 0)
  const { cblc, cbdt } = buildCbdtPair({
    glyphId: 1, png, width: 4, height: 4, bearingX: 1, bearingY: 4, ppem: 16,
  })
  const font = Font.load(buildTestFont(
    [null, encodeSimpleGlyph(SQUARE, [3])],
    [[0x41, 1]],
    [['CBLC', cblc], ['CBDT', cbdt]],
  ))

  it('getBitmapGlyphRender returns normalized PNG metrics', () => {
    const bg = font.getBitmapGlyphRender(1, 16)!
    expect(bg).not.toBeNull()
    expect(bg.image).toBe('png')
    expect(bg.ppem).toBe(16)
    expect(bg.width).toBe(4)
    expect(bg.height).toBe(4)
    expect(bg.bearingX).toBe(1)
    expect(bg.bottom).toBe(0) // bearingY(4) − height(4)
    expect(font.getBitmapGlyphRender(0, 16)).toBeNull()
  })

  it('prepareBitmapGlyph scales the draw rectangle by fontSize / strike ppem', () => {
    // fontSize 32, strike ppem 16 → 2pt per pixel
    const d = prepareBitmapGlyph(font, 1, 32, 16, '#000000')!
    expect(d).not.toBeNull()
    expect(d.mimeType).toBe('image/png')
    expect(d.left).toBeCloseTo(2, 6) // bearingX 1 × 2
    expect(d.top).toBeCloseTo(-8, 6) // top edge 4px above baseline × 2
    expect(d.width).toBeCloseTo(8, 6)
    expect(d.height).toBeCloseTo(8, 6)
  })

  it('SvgBackend embeds the bitmap glyph as a data-URI image', () => {
    const backend = new SvgBackend({ fonts: { f1: font }, background: null })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'f1', 32, '#000000')
    backend.endPage()
    const page = backend.getPages()[0]!
    expect(page).toContain('<image')
    expect(page).toContain('data:image/png;base64,')
  })

  it('PdfBackend embeds the bitmap glyph as an image XObject', () => {
    const backend = new PdfBackend({ fonts: { f1: font } })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'f1', 32, '#000000')
    backend.endPage()
    backend.endDocument()
    const pdf = new TextDecoder('latin1').decode(backend.toUint8Array())
    expect(pdf).toContain('%PDF')
    expect(pdf).toContain('/Image')
  })

  it('converts premultiplied 32-bit BGRA glyphs to straight-alpha PNG', () => {
    const pair = buildCbdtBgraPair(1, 2, 1, new Uint8Array([
      0, 0, 128, 128,
      255, 0, 0, 255,
    ]))
    const bgraFont = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['CBLC', pair.cblc], ['CBDT', pair.cbdt]],
    ))
    const drawable = prepareBitmapGlyph(bgraFont, 1, 16, 16, '#000000')!
    const decoded = decodePng(drawable.data)
    expect(Array.from(decoded.pixels)).toEqual([
      255, 0, 0, 128,
      0, 0, 255, 255,
    ])
  })

  it('rebuilds CBDT/CBLC in stable and compact subsets', () => {
    const stable = Font.load(font.subsetPreservingTables('A').buffer)
    expect(stable.getBitmapGlyphRender(1, 16)!.data).toEqual(png)

    const compactBuffer = font.subset('A')
    const compact = Font.load(compactBuffer)
    expect(compact.getBitmapGlyphRender(compact.getGlyphId(0x41), 16)!.data).toEqual(png)
    const compactSfnt = parseFont(compactBuffer)
    expect(getTableReader(compactSfnt, 'CBLC')).not.toBeNull()
    expect(getTableReader(compactSfnt, 'CBDT')).not.toBeNull()
  })

  it.skipIf(!existsSync(HB_VIEW))('matches HarfBuzz bitmap rasterization before and after subsetting', async () => {
    const source = buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['CBLC', cblc], ['CBDT', cbdt]],
    )
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-bitmap-oracle-'))
    try {
      const fontPath = join(directory, 'source.ttf')
      const oraclePath = join(directory, 'oracle.png')
      writeFileSync(fontPath, new Uint8Array(source))
      execFileSync(HB_VIEW, [
        '--output-file', oraclePath,
        '--output-format=png',
        '--font-size=128',
        '--font-ppem=16',
        fontPath,
        'A',
      ])

      const expected = await sharp(oraclePath).flatten({ background: '#ffffff' })
        .trim({ background: '#ffffff' }).resize(128, 128, { fit: 'fill' }).removeAlpha().raw().toBuffer()
      for (const candidate of [Font.load(source), Font.load(Font.load(source).subset('A'))]) {
        const backend = new SvgBackend({ fonts: { bitmap: candidate }, background: '#ffffff' })
        backend.beginDocument()
        backend.beginPage(180, 180)
        backend.drawText(20, 20, 'A', 'bitmap', 128, '#000000')
        backend.endPage()
        backend.endDocument()
        const actual = await sharp(Buffer.from(backend.getPages()[0]!)).flatten({ background: '#ffffff' })
          .trim({ background: '#ffffff' }).resize(128, 128, { fit: 'fill' }).removeAlpha().raw().toBuffer()
        let absoluteError = 0
        for (let i = 0; i < actual.length; i++) absoluteError += Math.abs(actual[i]! - expected[i]!)
        // HarfBuzz/Cairo adds one antialiased boundary column while the SVG
        // backend preserves the source bitmap's hard pixel edge.
        expect(absoluteError / actual.length).toBeLessThan(15)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('sbix bitmap glyphs', () => {
  const png = makePng(5, 5, 0, 128, 255)
  const dupeData = new Uint8Array([0, 1]) // points to glyph 1
  const sourceBuffer = buildTestFont(
    [null, encodeSimpleGlyph(SQUARE, [3]), encodeSimpleGlyph(SQUARE, [3])],
    [[0x41, 1], [0x42, 2]],
    [['sbix', buildSbix(20, 3, [
      null,
      { graphicType: 'png ', data: png, offsetX: 2, offsetY: 3 },
      { graphicType: 'dupe', data: dupeData, offsetX: 0, offsetY: 0 },
    ])]],
  )
  const font = Font.load(sourceBuffer)

  it('returns sbix PNG data with origin offsets (lower-left anchoring)', () => {
    const bg = font.getBitmapGlyphRender(1, 20)!
    expect(bg.image).toBe('png')
    expect(bg.ppem).toBe(20)
    expect(bg.width).toBe(0) // dimensions derive from the image
    expect(bg.bearingX).toBe(102)
    expect(bg.bottom).toBe(103)
  })

  it('derives the draw rectangle from the decoded PNG dimensions', () => {
    // The contour's (xMin, yMin)=(100,100) anchors the sbix design origin.
    // fontSize 40, strike 20 → 2pt per pixel.
    const d = prepareBitmapGlyph(font, 1, 40, 20, '#000000')!
    expect(d.left).toBeCloseTo(204, 6)
    expect(d.top).toBeCloseTo(-216, 6)
    expect(d.width).toBeCloseTo(10, 6)
    expect(d.height).toBeCloseTo(10, 6)
  })

  it("resolves 'dupe' records through the referenced glyph", () => {
    const bg = font.getBitmapGlyphRender(2, 20)!
    expect(bg).not.toBeNull()
    expect(bg.image).toBe('png')
    expect(bg.data.length).toBe(png.length)
    expect(font.getBitmapGlyph(2, 20)!.data).toEqual(png)
  })

  it('uses the drawing position as the design origin when the glyph has no contours', () => {
    const emptyGlyphFont = Font.load(buildTestFont(
      [null],
      [],
      [['sbix', buildSbix(20, 1, [
        { graphicType: 'png ', data: png, offsetX: 2, offsetY: 3 },
      ])]],
    ))
    const bg = emptyGlyphFont.getBitmapGlyphRender(0, 20)!
    expect(bg.bearingX).toBe(2)
    expect(bg.bottom).toBe(3)
  })

  it('rejects cyclic dupe records', () => {
    const cyclicFont = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3]), encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1], [0x42, 2]],
      [['sbix', buildSbix(20, 3, [
        null,
        { graphicType: 'dupe', data: new Uint8Array([0, 2]), offsetX: 0, offsetY: 0 },
        { graphicType: 'dupe', data: new Uint8Array([0, 1]), offsetX: 0, offsetY: 0 },
      ])]],
    ))
    expect(() => cyclicFont.getBitmapGlyphRender(1, 20)).toThrow(/dupe cycle/)
  })

  it('draws the outline over the bitmap when sbix flags bit 1 is set', () => {
    const overlayFont = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['sbix', buildSbix(20, 2, [
        null,
        { graphicType: 'png ', data: png, offsetX: 0, offsetY: 0 },
      ], 3)]],
    ))
    const backend = new SvgBackend({ fonts: { f1: overlayFont }, background: null })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'f1', 20, '#000000')
    backend.endPage()
    const page = backend.getPages()[0]!
    expect(page).toContain('<image')
    expect(page).toContain('<path')
  })

  it('physically rebuilds stable and compact sbix subsets', () => {
    const sourceSbixLength = getTableReader(parseFont(sourceBuffer), 'sbix')!.length
    const stableBuffer = font.subsetPreservingTables('A').buffer
    const stable = Font.load(stableBuffer)
    expect(stable.getBitmapGlyphRender(1, 20)!.image).toBe('png')
    expect(stable.getBitmapGlyphRender(2, 20)).toBeNull()
    expect(getTableReader(parseFont(stableBuffer), 'sbix')!.length).toBeLessThan(sourceSbixLength)

    const compact = Font.load(font.subset('B'))
    expect(compact.numGlyphs).toBe(2)
    expect(compact.getBitmapGlyphRender(compact.getGlyphId(0x42), 20)!.image).toBe('png')
  })

  it('decodes sbix TIFF graphics into PNG payloads', () => {
    const tiff = buildGrayTiff(2, 2, [0, 85, 170, 255])
    const tiffFont = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['sbix', buildSbix(16, 2, [
        null,
        { graphicType: 'tiff', data: tiff, offsetX: 0, offsetY: 0 },
      ])]],
    ))
    const d = prepareBitmapGlyph(tiffFont, 1, 16, 16, '#000000')!
    expect(d.mimeType).toBe('image/png')
    const decoded = decodePng(d.data)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.pixels[0]).toBe(0) // gray 0
    expect(decoded.pixels[4]).toBe(85) // gray 85
    expect(decoded.pixels[15]).toBe(255) // alpha opaque
  })
})

describe('EBDT monochrome bitmap glyphs', () => {
  // 2×2, bitDepth 1: row0 = 10 (pixel 0 set), row1 = 01 (pixel 1 set)
  const { eblc, ebdt } = buildEbdtPair({
    glyphId: 1, rows: [0b10000000, 0b01000000],
    width: 2, height: 2, bearingX: 0, bearingY: 2, ppem: 12,
  })
  const font = Font.load(buildTestFont(
    [null, encodeSimpleGlyph(SQUARE, [3])],
    [[0x41, 1]],
    [['EBLC', eblc], ['EBDT', ebdt]],
  ))
  // A bitmap-only font (no glyf/CFF): monochrome EBDT masks are used only when
  // the font lacks scalable outlines.
  const bitmapOnlyFont = Font.load(buildFont([
    ['head', buildHead()],
    ['maxp', buildMaxp(2)],
    ['hhea', buildHhea(2)],
    ['hmtx', buildHmtx([[600, 0], [600, 0]])],
    ['cmap', buildCmap4([[0x41, 1]])],
    ['OS/2', buildOs2()],
    ['post', buildPost()],
    ['name', buildName()],
    ['EBLC', eblc],
    ['EBDT', ebdt],
  ]))

  it('applies both EBSC axes and scales a non-square strike in device coordinates', () => {
    const pair = buildEbdtPair({
      glyphId: 1, rows: [0b10000000, 0b01000000],
      width: 2, height: 2, bearingX: 1, bearingY: 2, ppem: 12, ppemX: 8, ppemY: 12,
    })
    const scaledFont = Font.load(buildFont([
      ['head', buildHead()], ['maxp', buildMaxp(2)], ['hhea', buildHhea(2)],
      ['hmtx', buildHmtx([[600, 0], [600, 0]])], ['cmap', buildCmap4([[0x41, 1]])],
      ['OS/2', buildOs2()], ['post', buildPost()], ['name', buildName()],
      ['EBLC', pair.eblc], ['EBDT', pair.ebdt], ['EBSC', buildEbsc(16, 24, 8, 12)],
    ]))

    const bitmap = scaledFont.getBitmapGlyphRender(1, 24, 16)!
    expect(bitmap.ppemX).toBe(8)
    expect(bitmap.ppemY).toBe(12)
    const drawable = prepareBitmapGlyph(scaledFont, 1, 24, 24, '#000000', 16, 2 / 3)!
    expect(drawable.left).toBe(2)
    expect(drawable.top).toBe(-4)
    expect(drawable.width).toBe(4)
    expect(drawable.height).toBe(4)
  })

  it('exposes mask data with strike bit depth', () => {
    const bg = font.getBitmapGlyphRender(1, 12)!
    expect(bg.image).toBe('mask')
    expect(bg.bitDepth).toBe(1)
    expect(bg.bitAligned).toBe(false)
    expect(bg.width).toBe(2)
    expect(bg.height).toBe(2)
  })

  it('prefers scalable outlines over a monochrome EBDT mask', () => {
    // The outline font has both glyf and EBDT; the mask is skipped for output.
    expect(prepareBitmapGlyph(font, 1, 12, 12, '#FF0000')).toBeNull()
  })

  it('colorizes the mask with the text foreground color (bitmap-only font)', () => {
    const d = prepareBitmapGlyph(bitmapOnlyFont, 1, 12, 12, '#FF0000')!
    expect(d.mimeType).toBe('image/png')
    const decoded = decodePng(d.data)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    const px = decoded.pixels
    // (0,0): red opaque
    expect(px[0]).toBe(255)
    expect(px[1]).toBe(0)
    expect(px[3]).toBe(255)
    // (1,0): transparent
    expect(px[7]).toBe(0)
    // (0,1): transparent
    expect(px[11]).toBe(0)
    // (1,1): red opaque
    expect(px[12]).toBe(255)
    expect(px[15]).toBe(255)
  })

  it('uses vertical small metrics for vertical bitmap placement', () => {
    const pair = buildEbdtPair({
      glyphId: 1,
      rows: [0xF0, 0xF0],
      width: 4,
      height: 2,
      bearingX: 3,
      bearingY: -2,
      ppem: 12,
      flags: 2,
    })
    const verticalFont = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['EBLC', pair.eblc], ['EBDT', pair.ebdt]],
    ))
    const bg = verticalFont.getBitmapGlyphRender(1, 12, 12, { vertical: true })!
    expect(bg.bearingX).toBe(-2)
    expect(bg.bottom).toBe(-5)
  })

  it('rebuilds EBDT/EBLC in stable and compact subsets', () => {
    const stable = Font.load(font.subsetPreservingTables('A').buffer)
    expect(stable.getBitmapGlyphRender(1, 12)!.data).toEqual(new Uint8Array([0x80, 0x40, 0]))

    const compactBuffer = font.subset('A')
    const compact = Font.load(compactBuffer)
    expect(compact.getBitmapGlyphRender(compact.getGlyphId(0x41), 12)!.data).toEqual(new Uint8Array([0x80, 0x40, 0]))
    const compactSfnt = parseFont(compactBuffer)
    expect(getTableReader(compactSfnt, 'EBLC')).not.toBeNull()
    expect(getTableReader(compactSfnt, 'EBDT')).not.toBeNull()
  })
})

describe('color glyph priority', () => {
  it('an OT-SVG glyph wins over an embedded bitmap', () => {
    const png = makePng(4, 4, 255, 0, 0)
    const { cblc, cbdt } = buildCbdtPair({
      glyphId: 1, png, width: 4, height: 4, bearingX: 0, bearingY: 4, ppem: 16,
    })
    const svgDoc = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<g id="glyph1"><rect x="0" y="-500" width="500" height="500" fill="#00AA00"/></g></svg>'
    const svgTable = buildTable(w => {
      const docBytes = new TextEncoder().encode(svgDoc)
      w.writeUint16(0)
      w.writeUint32(10)
      w.writeUint32(0)
      w.writeUint16(1)
      w.writeUint16(1)
      w.writeUint16(1)
      w.writeUint32(14)
      w.writeUint32(docBytes.length)
      w.writeBytes(docBytes)
    })
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['CBLC', cblc], ['CBDT', cbdt], ['SVG ', svgTable]],
    ))

    const backend = new SvgBackend({ fonts: { f1: font }, background: null })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'f1', 32, '#000000')
    backend.endPage()
    const page = backend.getPages()[0]!.toLowerCase()
    expect(page).toContain('#00aa00') // SVG document rendered
    expect(page).not.toContain('<image') // bitmap not used
  })
})

describe('TIFF decoder', () => {
  it('decodes uncompressed grayscale TIFF (little-endian)', () => {
    const tiff = buildGrayTiff(2, 2, [10, 20, 30, 40])
    const decoded = decodeTiffToRgba(tiff)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.data[0]).toBe(10)
    expect(decoded.data[4]).toBe(20)
    expect(decoded.data[8]).toBe(30)
    expect(decoded.data[12]).toBe(40)
    expect(decoded.data[3]).toBe(255)
  })

  it('rejects unsupported byte order marks', () => {
    const bad = new Uint8Array([0x41, 0x41, 42, 0, 0, 0, 0, 8])
    expect(() => decodeTiffToRgba(bad)).toThrow('byte order')
  })
})

// A bitmap-only font (no glyf/CFF outline, embedded bitmaps via bdat/bloc) must
// render on the SVG backend too: its glyph collection must not call getGlyph
// (which would throw for the missing 'glyf'); the glyphs are drawn from their
// embedded bitmaps as data-URI images, just like on the PDF backend.
const NISC18030 = '/System/Library/Fonts/Supplemental/NISC18030.ttf'
describe.skipIf(!existsSync(NISC18030))('bitmap-only font on the SVG backend', () => {
  it('renders bitmap glyphs as data-URI images instead of throwing on missing glyf', () => {
    const font = Font.load(readFileSync(NISC18030).buffer as ArrayBuffer)
    const backend = new SvgBackend({ fonts: { d: font }, background: null })
    backend.beginDocument()
    backend.beginPage(200, 60)
    backend.drawText(10, 30, '一二三', 'd', 20, '#000000')
    backend.endPage()
    const page = backend.getPages()[0]!
    expect(page).toContain('<image')
    expect(page).toContain('data:image/')
  })
})
