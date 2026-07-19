import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseHead } from '../../../src/parsers/tables/head.js'
import { parseMaxp } from '../../../src/parsers/tables/maxp.js'
import { parseLoca } from '../../../src/parsers/tables/loca.js'
import { parseCmap } from '../../../src/parsers/tables/cmap.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')

function loadLoca(fontPath: string) {
  const buffer = readFileSync(fontPath).buffer as ArrayBuffer
  const sfnt = parseSfntDirectory(buffer)
  const head = parseHead(getTableReader(sfnt, 'head')!)
  const maxp = parseMaxp(getTableReader(sfnt, 'maxp')!)
  const loca = parseLoca(getTableReader(sfnt, 'loca')!, maxp.numGlyphs, head.indexToLocFormat)
  const cmap = parseCmap(getTableReader(sfnt, 'cmap')!)
  return { loca, maxp, cmap, head }
}

describe('loca table parser', () => {
  function buildShortLoca(storedOffsets: number[], extraBytes = 0): ArrayBuffer {
    const w = new BinaryWriter()
    for (const offset of storedOffsets) w.writeUint16(offset)
    for (let i = 0; i < extraBytes; i++) w.writeUint8(0)
    return w.toArrayBuffer()
  }

  function buildLongLoca(offsets: number[], extraBytes = 0): ArrayBuffer {
    const w = new BinaryWriter()
    for (const offset of offsets) w.writeUint32(offset)
    for (let i = 0; i < extraBytes; i++) w.writeUint8(0)
    return w.toArrayBuffer()
  }

  describe('synthetic validation', () => {
    it('should parse short loca offsets as stored values multiplied by two', () => {
      const loca = parseLoca(new BinaryReader(buildShortLoca([0, 5, 5, 9])), 3, 0)

      expect(loca.getOffset(0)).toBe(0)
      expect(loca.getLength(0)).toBe(10)
      expect(loca.getOffset(1)).toBe(10)
      expect(loca.getLength(1)).toBe(0)
      expect(loca.getOffset(2)).toBe(10)
      expect(loca.getLength(2)).toBe(8)
    })

    it('should parse long loca offsets directly', () => {
      const loca = parseLoca(new BinaryReader(buildLongLoca([0, 12, 20, 20])), 3, 1)

      expect(loca.getOffset(0)).toBe(0)
      expect(loca.getLength(0)).toBe(12)
      expect(loca.getOffset(1)).toBe(12)
      expect(loca.getLength(1)).toBe(8)
      expect(loca.getOffset(2)).toBe(20)
      expect(loca.getLength(2)).toBe(0)
    })

    it('should reject invalid loca glyph counts and formats', () => {
      expect(() => parseLoca(new BinaryReader(buildShortLoca([])), 0, 0)).toThrow(
        'loca numGlyphs must be greater than 0, got 0',
      )
      expect(() => parseLoca(new BinaryReader(buildShortLoca([0, 1])), 1, 2)).toThrow(
        'loca indexToLocFormat must be 0 or 1, got 2',
      )
    })

    it('should reject loca tables whose length does not match maxp/head counts', () => {
      expect(() => parseLoca(new BinaryReader(buildShortLoca([0, 1], 2)), 1, 0)).toThrow(
        'loca table length must be 4, got 6',
      )
      expect(() => parseLoca(new BinaryReader(buildLongLoca([0, 4])), 2, 1)).toThrow(
        'loca table length must be 12, got 8',
      )
    })

    it('should reject decreasing loca offsets', () => {
      expect(() => parseLoca(new BinaryReader(buildShortLoca([0, 8, 7])), 2, 0)).toThrow(
        'loca offset 2 is smaller than the previous offset',
      )
      expect(() => parseLoca(new BinaryReader(buildLongLoca([0, 20, 12])), 2, 1)).toThrow(
        'loca offset 2 is smaller than the previous offset',
      )
    })
  })

  describe('NotoSans-Regular', () => {
    const { loca, maxp, cmap } = loadLoca(NOTO_SANS_PATH)

    // Verifies that the first loca entry (.notdef) starts at glyf offset 0.
    it('getOffset(0) should return 0 for .notdef glyph', () => {
      // The first glyph offset is typically 0
      const offset = loca.getOffset(0)
      expect(offset).toBe(0)
    })

    // Verifies that a glyph with outline data ('A') has a positive glyf data length.
    it('getLength for most glyphs should be > 0', () => {
      // 'A' (U+0041) should have non-zero outline data
      const glyphIdA = cmap.getGlyphId(0x0041)
      const length = loca.getLength(glyphIdA)
      expect(length).toBeGreaterThan(0)
    })

    // Verifies that the outline-less space glyph has equal consecutive offsets, i.e. length 0.
    it('getLength for space glyph should be 0 (no outline)', () => {
      // Space (U+0020) has no outline, just advance width
      const glyphIdSpace = cmap.getGlyphId(0x0020)
      const length = loca.getLength(glyphIdSpace)
      expect(length).toBe(0)
    })

    // The numGlyphs entry is the required terminal offset; later entries remain out of range.
    it('exposes the terminal offset and rejects indices beyond it', () => {
      expect(loca.getOffset(maxp.numGlyphs)).toBe(
        loca.getOffset(maxp.numGlyphs - 1) + loca.getLength(maxp.numGlyphs - 1),
      )
      expect(loca.getOffset(maxp.numGlyphs + 1)).toBe(0)
      expect(loca.getOffset(999999)).toBe(0)
    })

    // Verifies that getLength returns 0 for glyph IDs at or beyond numGlyphs.
    it('out-of-range glyphId should return 0 length', () => {
      expect(loca.getLength(maxp.numGlyphs)).toBe(0)
      expect(loca.getLength(maxp.numGlyphs + 1)).toBe(0)
      expect(loca.getLength(999999)).toBe(0)
    })

    // Verifies that getOffset returns 0 for negative glyph IDs.
    it('negative glyphId should return 0 offset', () => {
      expect(loca.getOffset(-1)).toBe(0)
      expect(loca.getOffset(-100)).toBe(0)
    })

    // Verifies that getLength returns 0 for negative glyph IDs.
    it('negative glyphId should return 0 length', () => {
      expect(loca.getLength(-1)).toBe(0)
      expect(loca.getLength(-100)).toBe(0)
    })

    // Verifies the spec invariant that loca offsets are monotonically non-decreasing.
    it('offsets should be non-decreasing', () => {
      // Each offset should be >= the previous offset
      let prevOffset = loca.getOffset(0)
      for (let i = 1; i < Math.min(maxp.numGlyphs, 100); i++) {
        const offset = loca.getOffset(i)
        expect(offset).toBeGreaterThanOrEqual(prevOffset)
        prevOffset = offset
      }
    })

    // Verifies that computed glyph data lengths are never negative across the first 100 glyphs.
    it('getLength should always be >= 0', () => {
      for (let i = 0; i < Math.min(maxp.numGlyphs, 100); i++) {
        expect(loca.getLength(i)).toBeGreaterThanOrEqual(0)
      }
    })

    // Verifies that several printable ASCII letters all map to glyphs with non-empty outline data.
    it('glyphs with visible outlines should have length > 0', () => {
      // Check several ASCII printable characters with outlines
      const testChars = [0x0041, 0x0042, 0x0043, 0x0061, 0x0062, 0x0063] // A,B,C,a,b,c
      for (const cp of testChars) {
        const glyphId = cmap.getGlyphId(cp)
        expect(loca.getLength(glyphId)).toBeGreaterThan(0)
      }
    })
  })

  describe('Roboto-Regular', () => {
    const { loca, maxp, cmap } = loadLoca(ROBOTO_PATH)

    // Verifies that the first loca entry is 0 in a second TrueType font.
    it('getOffset(0) should return 0', () => {
      expect(loca.getOffset(0)).toBe(0)
    })

    // Verifies that Roboto's 'A' glyph has non-empty outline data.
    it('getLength for A should be > 0', () => {
      const glyphIdA = cmap.getGlyphId(0x0041)
      expect(loca.getLength(glyphIdA)).toBeGreaterThan(0)
    })

    // Verifies that Roboto's space glyph has zero outline length.
    it('getLength for space should be 0', () => {
      const glyphIdSpace = cmap.getGlyphId(0x0020)
      expect(loca.getLength(glyphIdSpace)).toBe(0)
    })

    // Verifies terminal, out-of-range, and negative glyph ID handling on a second font.
    it('exposes the terminal offset while other out-of-range IDs return 0', () => {
      expect(loca.getOffset(-1)).toBe(0)
      expect(loca.getLength(-1)).toBe(0)
      expect(loca.getOffset(maxp.numGlyphs)).toBe(
        loca.getOffset(maxp.numGlyphs - 1) + loca.getLength(maxp.numGlyphs - 1),
      )
      expect(loca.getLength(maxp.numGlyphs)).toBe(0)
    })
  })

  describe('indexToLocFormat validation', () => {
    // Verifies that head.indexToLocFormat, which selects short/long loca format, is within the spec range.
    it('NotoSans should have indexToLocFormat 0 or 1', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const head = parseHead(getTableReader(sfnt, 'head')!)
      expect(head.indexToLocFormat).toBeGreaterThanOrEqual(0)
      expect(head.indexToLocFormat).toBeLessThanOrEqual(1)
    })
  })

  describe('SfntTableManager lazy access', () => {
    // Verifies that SfntTableManager lazily parses loca with the head/maxp dependencies wired in.
    it('should provide loca via manager', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      const loca = manager.loca
      expect(loca.getOffset(0)).toBe(0)
      expect(loca.getLength(-1)).toBe(0)
    })
  })
})
