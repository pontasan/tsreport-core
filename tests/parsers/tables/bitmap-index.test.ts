import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import {
  parseBitmapLocationHeader,
  findGlyphBitmapOffset,
  readSmallGlyphMetrics,
  readBigGlyphMetrics,
} from '../../../src/parsers/tables/bitmap-index.js'

/**
 * EBLC/CBLC bitmap index regression tests.
 * Builds synthetic location tables and verifies IndexSubTable formats 1-5.
 */

/** Writes the 8-byte EBLC/CBLC header and one 48-byte BitmapSize record */
function writeLocationTable(w: BinaryWriter, opts: {
  indexSubTableArrayOffset: number
  numberOfIndexSubTables: number
  startGlyphIndex: number
  endGlyphIndex: number
  ppemX: number
  ppemY: number
  bitDepth: number
}): void {
  w.writeUint16(3) // majorVersion (CBLC permits 32-bit color strikes)
  w.writeUint16(0) // minorVersion
  w.writeUint32(1) // numSizes

  w.writeUint32(opts.indexSubTableArrayOffset)
  w.writeUint32(0) // patched after the subtable is written
  w.writeUint32(opts.numberOfIndexSubTables)
  w.writeUint32(0) // colorRef
  for (let i = 0; i < 12; i++) w.writeUint8(0) // sbitLineMetrics hori
  for (let i = 0; i < 12; i++) w.writeUint8(0) // sbitLineMetrics vert
  w.writeUint16(opts.startGlyphIndex)
  w.writeUint16(opts.endGlyphIndex)
  w.writeUint8(opts.ppemX)
  w.writeUint8(opts.ppemY)
  w.writeUint8(opts.bitDepth)
  w.writeUint8(1) // flags (HORIZONTAL_METRICS)
}

/** Builds a table with a single IndexSubTable; subtableBody follows the 8-byte subtable header */
function buildSingleSubtable(opts: {
  firstGlyph: number
  lastGlyph: number
  indexFormat: number
  imageFormat: number
  imageDataOffset: number
  body: (w: BinaryWriter) => void
}): ArrayBuffer {
  const arrayOffset = 8 + 48 // header + one BitmapSize record
  const w = new BinaryWriter()
  writeLocationTable(w, {
    indexSubTableArrayOffset: arrayOffset,
    numberOfIndexSubTables: 1,
    startGlyphIndex: opts.firstGlyph,
    endGlyphIndex: opts.lastGlyph,
    ppemX: 32,
    ppemY: 32,
    bitDepth: 32,
  })

  // IndexSubTableArray (one entry)
  w.writeUint16(opts.firstGlyph)
  w.writeUint16(opts.lastGlyph)
  w.writeUint32(8) // additionalOffsetToIndexSubtable (right after the array)

  // IndexSubTable header
  w.writeUint16(opts.indexFormat)
  w.writeUint16(opts.imageFormat)
  w.writeUint32(opts.imageDataOffset)
  opts.body(w)

  const buffer = w.toArrayBuffer()
  new DataView(buffer).setUint32(12, buffer.byteLength - arrayOffset)
  return buffer
}

describe('EBLC/CBLC bitmap index parser', () => {
  describe('parseBitmapLocationHeader', () => {
    // Verifies the BitmapSize record fields survive the 48-byte record layout.
    it('parses BitmapSize records', () => {
      const w = new BinaryWriter()
      writeLocationTable(w, {
        indexSubTableArrayOffset: 56,
        numberOfIndexSubTables: 3,
        startGlyphIndex: 5,
        endGlyphIndex: 9,
        ppemX: 64,
        ppemY: 72,
        bitDepth: 32,
      })
      for (let i = 0; i < 24; i++) w.writeUint8(0)
      const buffer = w.toArrayBuffer()
      new DataView(buffer).setUint32(12, 24)
      const sizes = parseBitmapLocationHeader(new BinaryReader(buffer))
      expect(sizes).toHaveLength(1)
      expect(sizes[0]!.indexSubTableArrayOffset).toBe(56)
      expect(sizes[0]!.numberOfIndexSubTables).toBe(3)
      expect(sizes[0]!.ppemX).toBe(64)
      expect(sizes[0]!.ppemY).toBe(72)
      expect(sizes[0]!.bitDepth).toBe(32)
    })
  })

  describe('IndexSubTable format 1 (variable size, uint32 offsets)', () => {
    const buffer = buildSingleSubtable({
      firstGlyph: 5,
      lastGlyph: 7,
      indexFormat: 1,
      imageFormat: 17,
      imageDataOffset: 1000,
      body: (w) => {
        // offsetArray: lastGlyph - firstGlyph + 2 entries
        w.writeUint32(0)
        w.writeUint32(100)
        w.writeUint32(250)
        w.writeUint32(400)
      },
    })
    const reader = new BinaryReader(buffer)
    const [size] = parseBitmapLocationHeader(reader)

    // Verifies the offset pair lookup: glyph 6 -> offsets[1..2].
    it('resolves data offset and size from the uint32 offset array', () => {
      const result = findGlyphBitmapOffset(reader, size!, 6)
      expect(result).toMatchObject({ imageFormat: 17, imageDataOffset: 1100, imageDataSize: 150 })
    })

    // Verifies the range boundaries of the subtable.
    it('resolves the first and last glyphs of the range', () => {
      expect(findGlyphBitmapOffset(reader, size!, 5))
        .toMatchObject({ imageFormat: 17, imageDataOffset: 1000, imageDataSize: 100 })
      expect(findGlyphBitmapOffset(reader, size!, 7))
        .toMatchObject({ imageFormat: 17, imageDataOffset: 1250, imageDataSize: 150 })
    })

    // Verifies glyphs outside every subtable range return null.
    it('returns null for glyphs outside the range', () => {
      expect(findGlyphBitmapOffset(reader, size!, 4)).toBeNull()
      expect(findGlyphBitmapOffset(reader, size!, 8)).toBeNull()
    })
  })

  describe('IndexSubTable format 2 (constant size, dense)', () => {
    const buffer = buildSingleSubtable({
      firstGlyph: 5,
      lastGlyph: 8,
      indexFormat: 2,
      imageFormat: 5,
      imageDataOffset: 2000,
      body: (w) => {
        w.writeUint32(64) // imageSize
        for (let i = 0; i < 8; i++) w.writeUint8(0) // bigMetrics
      },
    })
    const reader = new BinaryReader(buffer)
    const [size] = parseBitmapLocationHeader(reader)

    // Verifies offset = imageDataOffset + glyphIndex * imageSize.
    it('computes offsets from the constant image size', () => {
      expect(findGlyphBitmapOffset(reader, size!, 5))
        .toMatchObject({ imageFormat: 5, imageDataOffset: 2000, imageDataSize: 64 })
      expect(findGlyphBitmapOffset(reader, size!, 7))
        .toMatchObject({ imageFormat: 5, imageDataOffset: 2128, imageDataSize: 64 })
    })
  })

  describe('IndexSubTable format 3 (variable size, uint16 offsets)', () => {
    const buffer = buildSingleSubtable({
      firstGlyph: 5,
      lastGlyph: 7,
      indexFormat: 3,
      imageFormat: 2,
      imageDataOffset: 500,
      body: (w) => {
        w.writeUint16(0)
        w.writeUint16(30)
        w.writeUint16(70)
        w.writeUint16(120)
      },
    })
    const reader = new BinaryReader(buffer)
    const [size] = parseBitmapLocationHeader(reader)

    // Verifies the uint16 offset pair lookup: glyph 7 -> offsets[2..3].
    it('resolves data offset and size from the uint16 offset array', () => {
      expect(findGlyphBitmapOffset(reader, size!, 7))
        .toMatchObject({ imageFormat: 2, imageDataOffset: 570, imageDataSize: 50 })
    })
  })

  describe('IndexSubTable format 4 (variable size, sparse)', () => {
    const buffer = buildSingleSubtable({
      firstGlyph: 5,
      lastGlyph: 9,
      indexFormat: 4,
      imageFormat: 17,
      imageDataOffset: 3000,
      body: (w) => {
        w.writeUint32(2) // numGlyphs
        // glyphArray: numGlyphs + 1 entries, last one closes the final range
        w.writeUint16(5); w.writeUint16(0)
        w.writeUint16(7); w.writeUint16(40)
        w.writeUint16(10); w.writeUint16(90)
      },
    })
    const reader = new BinaryReader(buffer)
    const [size] = parseBitmapLocationHeader(reader)

    // Verifies the sparse pair lookup uses the following entry as the end offset.
    it('resolves sparse glyph offsets', () => {
      expect(findGlyphBitmapOffset(reader, size!, 5))
        .toMatchObject({ imageFormat: 17, imageDataOffset: 3000, imageDataSize: 40 })
      expect(findGlyphBitmapOffset(reader, size!, 7))
        .toMatchObject({ imageFormat: 17, imageDataOffset: 3040, imageDataSize: 50 })
    })

    // Verifies in-range glyphs missing from the sparse array return null.
    it('returns null for glyphs absent from the sparse array', () => {
      expect(findGlyphBitmapOffset(reader, size!, 6)).toBeNull()
    })
  })

  describe('IndexSubTable format 5 (constant size, sparse)', () => {
    const buffer = buildSingleSubtable({
      firstGlyph: 5,
      lastGlyph: 9,
      indexFormat: 5,
      imageFormat: 17,
      imageDataOffset: 4000,
      body: (w) => {
        w.writeUint32(32) // imageSize
        for (let i = 0; i < 8; i++) w.writeUint8(0) // bigMetrics
        w.writeUint32(3) // numGlyphs
        w.writeUint16(5)
        w.writeUint16(6)
        w.writeUint16(9)
      },
    })
    const reader = new BinaryReader(buffer)
    const [size] = parseBitmapLocationHeader(reader)

    // Verifies offset = imageDataOffset + arrayPosition * imageSize.
    it('resolves sparse glyphs with a constant image size', () => {
      expect(findGlyphBitmapOffset(reader, size!, 5))
        .toMatchObject({ imageFormat: 17, imageDataOffset: 4000, imageDataSize: 32 })
      expect(findGlyphBitmapOffset(reader, size!, 9))
        .toMatchObject({ imageFormat: 17, imageDataOffset: 4064, imageDataSize: 32 })
    })

    // Verifies in-range glyphs absent from the glyph ID array return null.
    it('returns null for glyphs absent from the glyph ID array', () => {
      expect(findGlyphBitmapOffset(reader, size!, 7)).toBeNull()
    })
  })

  describe('glyph metrics records', () => {
    // Verifies the 5-byte smallGlyphMetrics layout.
    it('reads smallGlyphMetrics', () => {
      const w = new BinaryWriter()
      w.writeUint8(20) // height
      w.writeUint8(16) // width
      w.writeUint8(-2 & 0xFF) // horiBearingX (bearingX, int8)
      w.writeUint8(18) // horiBearingY (bearingY)
      w.writeUint8(17) // horiAdvance (advance)
      const metrics = readSmallGlyphMetrics(new BinaryReader(w.toArrayBuffer()))
      expect(metrics).toEqual({
        height: 20, width: 16,
        horiBearingX: -2, horiBearingY: 18, horiAdvance: 17,
        vertBearingX: 0, vertBearingY: 0, vertAdvance: 0,
      })
    })

    // Verifies the 8-byte bigGlyphMetrics layout.
    it('reads bigGlyphMetrics', () => {
      const w = new BinaryWriter()
      w.writeUint8(20) // height
      w.writeUint8(16) // width
      w.writeUint8(-2 & 0xFF) // horiBearingX (int8)
      w.writeUint8(18) // horiBearingY
      w.writeUint8(17) // horiAdvance
      w.writeUint8(-8 & 0xFF) // vertBearingX (int8)
      w.writeUint8(1) // vertBearingY
      w.writeUint8(22) // vertAdvance
      const metrics = readBigGlyphMetrics(new BinaryReader(w.toArrayBuffer()))
      expect(metrics).toEqual({
        height: 20, width: 16,
        horiBearingX: -2, horiBearingY: 18, horiAdvance: 17,
        vertBearingX: -8, vertBearingY: 1, vertAdvance: 22,
      })
    })
  })
})
