import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliCompress, Font } from '../../src/index.js'
import { unwrapWoff2 } from '../../src/parsers/woff2-parser.js'

const WOFF2_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.woff2')

function encodeBase128(value: number): number[] {
  const bytes = [value & 0x7f]
  for (let remaining = value >>> 7; remaining !== 0; remaining >>>= 7) bytes.unshift((remaining & 0x7f) | 0x80)
  return bytes
}

function buildHmtxTransformWoff2(flags: number): ArrayBuffer {
  const head = new Uint8Array(54)
  new DataView(head.buffer).setUint16(16, 0x0800, false)
  const hhea = new Uint8Array(36)
  new DataView(hhea.buffer).setUint16(34, 2, false)
  const maxp = new Uint8Array(6)
  new DataView(maxp.buffer).setUint16(4, 3, false)
  const glyf = new Uint8Array(20)
  const glyfView = new DataView(glyf.buffer)
  glyfView.setInt16(0, 1, false)
  glyfView.setInt16(2, -5, false)
  glyfView.setInt16(10, 1, false)
  glyfView.setInt16(12, 7, false)
  const loca = new Uint8Array(16)
  const locaView = new DataView(loca.buffer)
  locaView.setUint32(0, 0, false)
  locaView.setUint32(4, 0, false)
  locaView.setUint32(8, 10, false)
  locaView.setUint32(12, 20, false)
  const transformedHmtx = Uint8Array.from([flags, 0x01, 0xf4, 0x02, 0x58])
  const tables = [
    { index: 1, version: 0, originalLength: head.length, data: head },
    { index: 2, version: 0, originalLength: hhea.length, data: hhea },
    { index: 4, version: 0, originalLength: maxp.length, data: maxp },
    { index: 10, version: 3, originalLength: glyf.length, data: glyf },
    { index: 11, version: 3, originalLength: loca.length, data: loca },
    { index: 3, version: 1, originalLength: 10, data: transformedHmtx, transformLength: transformedHmtx.length },
  ]
  const directory: number[] = []
  for (const table of tables) {
    directory.push((table.version << 6) | table.index, ...encodeBase128(table.originalLength))
    if (table.transformLength !== undefined) directory.push(...encodeBase128(table.transformLength))
  }
  const rawLength = tables.reduce(function (sum, table) { return sum + table.data.length }, 0)
  const raw = new Uint8Array(rawLength)
  let rawOffset = 0
  for (const table of tables) { raw.set(table.data, rawOffset); rawOffset += table.data.length }
  const compressed = brotliCompress(raw, { quality: 11, mode: 'font' })
  const output = new Uint8Array((48 + directory.length + compressed.length + 3) & ~3)
  const view = new DataView(output.buffer)
  view.setUint32(0, 0x774f4632, false)
  view.setUint32(4, 0x00010000, false)
  view.setUint32(8, output.length, false)
  view.setUint16(12, tables.length, false)
  view.setUint32(16, 12 + tables.length * 16 + 56 + 36 + 8 + 20 + 16 + 12, false)
  view.setUint32(20, compressed.length, false)
  output.set(directory, 48)
  output.set(compressed, 48 + directory.length)
  return output.buffer
}

function buildGlyfTransformWoff2(optionFlags = 1, overlapBitmap = 0x40): ArrayBuffer {
  const head = new Uint8Array(54)
  const headView = new DataView(head.buffer)
  headView.setUint16(16, 0x0800, false)
  headView.setInt16(50, 0, false)
  const maxp = new Uint8Array(6)
  new DataView(maxp.buffer).setUint16(4, 2, false)
  const transformed = new Uint8Array(49)
  const transformedView = new DataView(transformed.buffer)
  transformedView.setUint16(2, optionFlags, false)
  transformedView.setUint16(4, 2, false)
  transformedView.setUint16(6, 0, false)
  transformedView.setUint32(8, 4, false)
  transformedView.setUint32(12, 1, false)
  transformedView.setUint32(16, 1, false)
  transformedView.setUint32(20, 2, false)
  transformedView.setUint32(24, 0, false)
  transformedView.setUint32(28, 4, false)
  transformedView.setUint32(32, 0, false)
  transformedView.setInt16(36, 0, false)
  transformedView.setInt16(38, 1, false)
  transformed[40] = 1
  transformed[41] = 0
  transformed[42] = 0
  transformed[43] = 0
  transformed[48] = overlapBitmap
  const tables = [
    { index: 1, version: 0, originalLength: head.length, data: head },
    { index: 4, version: 0, originalLength: maxp.length, data: maxp },
    { index: 10, version: 0, originalLength: 16, data: transformed, transformLength: transformed.length },
    { index: 11, version: 0, originalLength: 6, data: new Uint8Array(), transformLength: 0 },
  ]
  const directory: number[] = []
  for (const table of tables) {
    directory.push((table.version << 6) | table.index, ...encodeBase128(table.originalLength))
    if (table.transformLength !== undefined) directory.push(...encodeBase128(table.transformLength))
  }
  const rawLength = tables.reduce(function (sum, table) { return sum + table.data.length }, 0)
  const raw = new Uint8Array(rawLength)
  let rawOffset = 0
  for (const table of tables) { raw.set(table.data, rawOffset); rawOffset += table.data.length }
  const compressed = brotliCompress(raw, { quality: 11, mode: 'font' })
  const output = new Uint8Array((48 + directory.length + compressed.length + 3) & ~3)
  const view = new DataView(output.buffer)
  view.setUint32(0, 0x774f4632, false)
  view.setUint32(4, 0x00010000, false)
  view.setUint32(8, output.length, false)
  view.setUint16(12, tables.length, false)
  view.setUint32(16, 12 + tables.length * 16 + 56 + 8 + 16 + 8, false)
  view.setUint32(20, compressed.length, false)
  output.set(directory, 48)
  output.set(compressed, 48 + directory.length)
  return output.buffer
}

function findSfntTable(buffer: ArrayBuffer, wantedTag: string): Uint8Array {
  const view = new DataView(buffer)
  const count = view.getUint16(4, false)
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    const tag = String.fromCharCode(...new Uint8Array(buffer, record, 4))
    if (tag === wantedTag) return new Uint8Array(buffer, view.getUint32(record + 8, false), view.getUint32(record + 12, false))
  }
  throw new Error(`Missing ${wantedTag}`)
}

describe('WOFF2 parser', () => {
  // Verifies a WOFF2 container loads and reports format 'woff2'.
  it('should load a WOFF2 font', () => {
    const buffer = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font).toBeInstanceOf(Font)
    expect(font.format).toBe('woff2')
  })

  // Verifies the name table survives Brotli decompression.
  it('should expose font names', () => {
    const buffer = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.familyName).toBeTruthy()
  })

  // Verifies glyph outlines survive the WOFF2 glyf transform reversal.
  it('should resolve glyphs', () => {
    const buffer = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyphByCodePoint(0x0041) // 'A'
    expect(glyph.advanceWidth).toBeGreaterThan(0)
    expect(glyph.outline.commands.length).toBeGreaterThan(0)
  })

  // Verifies WOFF2 unwrapping is lossless by comparing metrics against the raw TTF source.
  it('should produce same metrics as TTF source', () => {
    const woff2Buf = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
    const ttfBuf = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer

    const woff2Font = Font.load(woff2Buf)
    const ttfFont = Font.load(ttfBuf)

    expect(woff2Font.metrics.unitsPerEm).toBe(ttfFont.metrics.unitsPerEm)
    expect(woff2Font.metrics.ascender).toBe(ttfFont.metrics.ascender)
    expect(woff2Font.numGlyphs).toBe(ttfFont.numGlyphs)
  })

  it.each([
    ['TrueType', 'Roboto-Regular.ttf'],
    ['CFF OpenType', 'SourceSans3-Regular.otf'],
  ])('writes a null-transform %s WOFF2 that round-trips exactly by semantics', (_kind, file) => {
    const source = Font.load(Uint8Array.from(readFileSync(resolve(__dirname, `../fixtures/fonts/${file}`))).buffer)
    const metadata = '<?xml version="1.0" encoding="UTF-8"?><metadata version="1.0"></metadata>'
    const privateData = Uint8Array.from([0x57, 0x4f, 0x46, 0x32])
    const encoded = source.toWoff2({
      majorVersion: 2,
      minorVersion: 7,
      metadata,
      privateData,
    })
    const view = new DataView(encoded)
    expect(view.getUint32(0, false)).toBe(0x774f4632)
    expect(view.getUint16(14, false)).toBe(0)

    const decoded = Font.load(encoded)
    expect(decoded.format).toBe('woff2')
    expect(decoded.numGlyphs).toBe(source.numGlyphs)
    expect(decoded.metrics).toEqual(source.metrics)
    expect(decoded.familyName).toBe(source.familyName)
    for (const codePoint of [0x20, 0x41, 0x67, 0xe9, 0x3a9]) {
      expect(decoded.getGlyphByCodePoint(codePoint)).toEqual(source.getGlyphByCodePoint(codePoint))
    }
    expect(decoded.webFontContainer).toMatchObject({
      majorVersion: 2,
      minorVersion: 7,
      metadata,
      privateData,
    })
  }, 30_000)

  it('exposes extended metadata and private data through Font', () => {
    const source = Uint8Array.from(readFileSync(WOFF2_PATH))
    const metadataBytes = new TextEncoder().encode('<?xml version="1.0"?><metadata version="1.0"></metadata>')
    const compressed = brotliCompress(metadataBytes, { quality: 11, mode: 'font' })
    const metadataOffset = (source.length + 3) & ~3
    const privateBytes = Uint8Array.from([5, 6, 7])
    const privateOffset = (metadataOffset + compressed.length + 3) & ~3
    const bytes = new Uint8Array(privateOffset + privateBytes.length)
    bytes.set(source)
    bytes.set(compressed, metadataOffset)
    bytes.set(privateBytes, privateOffset)
    const view = new DataView(bytes.buffer)
    view.setUint32(8, bytes.length, false)
    view.setUint16(24, 4, false)
    view.setUint16(26, 2, false)
    view.setUint32(28, metadataOffset, false)
    view.setUint32(32, compressed.length, false)
    view.setUint32(36, metadataBytes.length, false)
    view.setUint32(40, privateOffset, false)
    view.setUint32(44, privateBytes.length, false)

    const container = Font.load(bytes.buffer).webFontContainer
    expect(container?.majorVersion).toBe(4)
    expect(container?.minorVersion).toBe(2)
    expect(container?.metadata).toBe(new TextDecoder().decode(metadataBytes))
    expect(container?.metadataDocument?.root.name).toBe('metadata')
    expect(container?.privateData).toEqual(privateBytes)
  })

  it('reconstructs both omitted hmtx bearing arrays from glyph xMin values', () => {
    const sfnt = unwrapWoff2(buildHmtxTransformWoff2(3))
    const hmtx = findSfntTable(sfnt, 'hmtx')
    expect(Array.from(hmtx)).toEqual([0x01, 0xf4, 0x00, 0x00, 0x02, 0x58, 0xff, 0xfb, 0x00, 0x07])
  })

  it('rejects reserved hmtx transform flags', () => {
    expect(() => unwrapWoff2(buildHmtxTransformWoff2(4))).toThrow('invalid transformed hmtx flags')
  })

  it('reconstructs transformed glyf, short loca, and OVERLAP_SIMPLE', () => {
    const sfnt = unwrapWoff2(buildGlyfTransformWoff2())
    const glyf = findSfntTable(sfnt, 'glyf')
    const loca = findSfntTable(sfnt, 'loca')
    expect(glyf[14]).toBe(0x71)
    expect(Array.from(loca)).toEqual([0, 0, 0, 0, 0, 8])
  })

  it('rejects reserved transformed-glyf option flags', () => {
    expect(() => unwrapWoff2(buildGlyfTransformWoff2(2, 0))).toThrow('optionFlags contains reserved bits')
  })

  it('rejects a non-zero reserved header field', () => {
    const bytes = Uint8Array.from(readFileSync(WOFF2_PATH))
    const view = new DataView(bytes.buffer)
    view.setUint16(14, 1, false)
    expect(() => Font.load(bytes.buffer)).toThrow('reserved header field must be zero')
  })

  it('accepts a mismatched totalSfntSize header field as required for decoders', () => {
    const bytes = Uint8Array.from(readFileSync(WOFF2_PATH))
    const view = new DataView(bytes.buffer)
    view.setUint32(16, 1, false)
    expect(Font.load(bytes.buffer).format).toBe('woff2')
  })

  it('rejects extraneous trailing data', () => {
    const source = Uint8Array.from(readFileSync(WOFF2_PATH))
    const bytes = new Uint8Array(source.length + 1)
    bytes.set(source)
    new DataView(bytes.buffer).setUint32(8, bytes.length, false)
    expect(() => Font.load(bytes.buffer)).toThrow('extraneous data after the final block')
  })
})
