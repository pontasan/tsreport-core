import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseKern } from '../../../src/parsers/tables/kern.js'

const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')

function getFormat0SearchValues(nPairs: number): { searchRange: number; entrySelector: number; rangeShift: number } {
  if (nPairs === 0) return { searchRange: 0, entrySelector: 0, rangeShift: 0 }

  let powerOfTwo = 1
  let entrySelector = 0
  while ((powerOfTwo << 1) <= nPairs) {
    powerOfTwo <<= 1
    entrySelector++
  }

  return {
    searchRange: powerOfTwo * 6,
    entrySelector,
    rangeShift: (nPairs - powerOfTwo) * 6,
  }
}

/**
 * Build a Microsoft kern table (version 0) with Format 0 subtable
 */
function buildKernFormat0(
  pairs: { left: number; right: number; value: number }[],
  isOverride = false,
  searchOverride?: Partial<{ searchRange: number; entrySelector: number; rangeShift: number }>,
  coverageFlags = 0x01,
): ArrayBuffer {
  // Header: version(2) + nTables(2) = 4
  // Subtable header: version(2) + length(2) + coverage(2) = 6
  // Format 0: nPairs(2) + searchRange(2) + entrySelector(2) + rangeShift(2) + pairs(6 each)
  const subtableDataSize = 8 + pairs.length * 6
  const subtableLength = 6 + subtableDataSize
  const totalSize = 4 + subtableLength
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint16(pos, 0); pos += 2 // version 0 (Microsoft)
  view.setUint16(pos, 1); pos += 2 // nTables

  // Subtable header
  view.setUint16(pos, 0); pos += 2 // subtable version
  view.setUint16(pos, subtableLength); pos += 2 // length
  // coverage: format=0 in upper byte, horizontal=1, override flag
  const coverage = (0 << 8) | coverageFlags | (isOverride ? 0x08 : 0)
  view.setUint16(pos, coverage); pos += 2

  // Format 0 data
  const searchValues = getFormat0SearchValues(pairs.length)
  view.setUint16(pos, pairs.length); pos += 2 // nPairs
  view.setUint16(pos, searchOverride?.searchRange ?? searchValues.searchRange); pos += 2
  view.setUint16(pos, searchOverride?.entrySelector ?? searchValues.entrySelector); pos += 2
  view.setUint16(pos, searchOverride?.rangeShift ?? searchValues.rangeShift); pos += 2

  for (const p of pairs) {
    view.setUint16(pos, p.left); pos += 2
    view.setUint16(pos, p.right); pos += 2
    view.setInt16(pos, p.value); pos += 2
  }

  return buf
}

function combineMicrosoftKern(tables: ArrayBuffer[]): ArrayBuffer {
  let length = 4
  for (const table of tables) length += table.byteLength - 4
  const buffer = new ArrayBuffer(length)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  view.setUint16(0, 0)
  view.setUint16(2, tables.length)
  let offset = 4
  for (const table of tables) {
    const subtable = new Uint8Array(table, 4)
    bytes.set(subtable, offset)
    offset += subtable.length
  }
  return buffer
}

function buildAppleKernFormat0(
  pairs: { left: number; right: number; value: number }[],
  coverage: number,
  tupleIndex = 0,
): ArrayBuffer {
  const subtableLength = 8 + 8 + pairs.length * 6
  const buffer = new ArrayBuffer(8 + subtableLength)
  const view = new DataView(buffer)
  view.setUint16(0, 1)
  view.setUint16(2, 0)
  view.setUint32(4, 1)
  view.setUint32(8, subtableLength)
  view.setUint16(12, coverage)
  view.setUint16(14, tupleIndex)
  const search = getFormat0SearchValues(pairs.length)
  view.setUint16(16, pairs.length)
  view.setUint16(18, search.searchRange)
  view.setUint16(20, search.entrySelector)
  view.setUint16(22, search.rangeShift)
  let offset = 24
  for (const pair of pairs) {
    view.setUint16(offset, pair.left)
    view.setUint16(offset + 2, pair.right)
    view.setInt16(offset + 4, pair.value)
    offset += 6
  }
  return buffer
}

/**
 * Build a kern table with Format 2 (class-based) subtable
 */
function buildKernFormat2(
  leftClasses: { firstGlyph: number; classValues: number[] },
  rightClasses: { firstGlyph: number; classValues: number[] },
  kernMatrix: number[][],
): ArrayBuffer {
  // This builds a Microsoft (version 0) kern table with a Format 2 subtable
  // subtable header: version(2) + length(2) + coverage(2) = 6
  // Format 2 header: rowWidth(2) + leftClassTableOffset(2) + rightClassTableOffset(2) + arrayOffset(2) = 8
  // Left class table: firstGlyph(2) + glyphCount(2) + classValues(2 each)
  // Right class table: firstGlyph(2) + glyphCount(2) + classValues(2 each)
  // Array: rowWidth * numRows of int16 values

  const numLeftClasses = leftClasses.classValues.length
  const numRightClasses = rightClasses.classValues.length
  const numRows = kernMatrix.length
  const numCols = kernMatrix[0]?.length ?? 0
  const rowWidth = numCols * 2 // each value is int16

  const leftClassSize = 4 + numLeftClasses * 2
  const rightClassSize = 4 + numRightClasses * 2
  const arraySize = numRows * rowWidth

  const format2DataSize = 8 + leftClassSize + rightClassSize + arraySize
  const subtableLength = 6 + format2DataSize
  const totalSize = 4 + subtableLength

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Table header
  view.setUint16(pos, 0); pos += 2 // version 0
  view.setUint16(pos, 1); pos += 2 // nTables

  // Subtable header
  const subtableStart = pos
  view.setUint16(pos, 0); pos += 2 // subtable version
  view.setUint16(pos, subtableLength); pos += 2
  const coverage = (2 << 8) | 0x01 // format 2, horizontal
  view.setUint16(pos, coverage); pos += 2

  // Format 2 header (offsets relative to subtable start)
  const format2Start = pos
  const leftClassOffset = 8 + 6 // from subtable start: subtable header(6) + format2 header(8) = 14
  const rightClassOffset = leftClassOffset + leftClassSize
  const arrayOffset = rightClassOffset + rightClassSize

  view.setUint16(pos, rowWidth); pos += 2
  view.setUint16(pos, leftClassOffset); pos += 2
  view.setUint16(pos, rightClassOffset); pos += 2
  view.setUint16(pos, arrayOffset); pos += 2

  // Left class table
  view.setUint16(pos, leftClasses.firstGlyph); pos += 2
  view.setUint16(pos, numLeftClasses); pos += 2
  for (const cv of leftClasses.classValues) {
    view.setUint16(pos, cv); pos += 2
  }

  // Right class table
  view.setUint16(pos, rightClasses.firstGlyph); pos += 2
  view.setUint16(pos, numRightClasses); pos += 2
  for (const cv of rightClasses.classValues) {
    view.setUint16(pos, cv); pos += 2
  }

  // Kern value array
  for (const row of kernMatrix) {
    for (const val of row) {
      view.setInt16(pos, val); pos += 2
    }
  }

  return buf
}

/**
 * Build a kern table with Format 3 (compact) subtable — Apple AAT version 1
 */
function buildKernFormat3(
  glyphCount: number,
  kernValues: number[],
  leftClass: number[],
  rightClass: number[],
  kernIndex: number[],
): ArrayBuffer {
  const leftClassCount = Math.max(...leftClass) + 1
  const rightClassCount = Math.max(...rightClass) + 1

  // Apple header: version(2) + padding(2) + nTables(4) = 8
  // Subtable header: length(4) + coverage(2) + tupleIndex(2) = 8
  // Format 3 data: glyphCount(2) + kernValueCount(1) + leftClassCount(1) + rightClassCount(1) + flags(1)
  //   + kernValues(2 each) + leftClass(1 each) + rightClass(1 each) + kernIndex(1 each)
  const format3DataSize = 6 + kernValues.length * 2 + glyphCount + glyphCount + leftClassCount * rightClassCount
  const subtableLength = 8 + format3DataSize
  const totalSize = 8 + subtableLength

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Apple kern header (version 1.0 as uint32 major.minor)
  view.setUint16(pos, 1); pos += 2 // version major = 1
  view.setUint16(pos, 0); pos += 2 // version minor
  view.setUint32(pos, 1); pos += 4 // nTables

  // Subtable header
  view.setUint32(pos, subtableLength); pos += 4
  // coverage: format=3 in lower byte, not vertical, not cross-stream
  view.setUint16(pos, 3); pos += 2 // format 3
  view.setUint16(pos, 0); pos += 2 // tupleIndex

  // Format 3 data
  view.setUint16(pos, glyphCount); pos += 2
  view.setUint8(pos++, kernValues.length)
  view.setUint8(pos++, leftClassCount)
  view.setUint8(pos++, rightClassCount)
  view.setUint8(pos++, 0) // flags

  for (const kv of kernValues) {
    view.setInt16(pos, kv); pos += 2
  }
  for (let i = 0; i < glyphCount; i++) {
    view.setUint8(pos++, leftClass[i] ?? 0)
  }
  for (let i = 0; i < glyphCount; i++) {
    view.setUint8(pos++, rightClass[i] ?? 0)
  }
  for (const ki of kernIndex) {
    view.setUint8(pos++, ki)
  }

  return buf
}

describe('kern table parser', () => {
  describe('Format 0 (ordered pairs)', () => {
    // Verifies that a Microsoft version-0 format 0 subtable yields the exact per-pair kern values.
    it('should parse basic kern pairs', () => {
      const buf = buildKernFormat0([
        { left: 36, right: 57, value: -50 },
        { left: 36, right: 58, value: -30 },
        { left: 57, right: 36, value: -20 },
      ])
      const kern = parseKern(new BinaryReader(buf))

      expect(kern.getKerning(36, 57)).toBe(-50)
      expect(kern.getKerning(36, 58)).toBe(-30)
      expect(kern.getKerning(57, 36)).toBe(-20)
    })

    // Verifies that pairs absent from the pair list kern to 0.
    it('should return 0 for unkerned pairs', () => {
      const buf = buildKernFormat0([{ left: 1, right: 2, value: -10 }])
      const kern = parseKern(new BinaryReader(buf))

      expect(kern.getKerning(1, 3)).toBe(0)
      expect(kern.getKerning(3, 1)).toBe(0)
    })

    // Verifies that a subtable with the override coverage bit set replaces rather than accumulates values.
    it('should handle override flag', () => {
      // With override, the last value wins instead of accumulating
      const buf = buildKernFormat0([
        { left: 1, right: 2, value: -50 },
      ], true)
      const kern = parseKern(new BinaryReader(buf))
      expect(kern.getKerning(1, 2)).toBe(-50)
    })

    it('should preserve subtable order for additive, override, and minimum values', () => {
      const buf = combineMicrosoftKern([
        buildKernFormat0([{ left: 1, right: 2, value: -80 }]),
        buildKernFormat0([{ left: 1, right: 2, value: 20 }]),
        buildKernFormat0([{ left: 1, right: 2, value: -30 }], true),
        buildKernFormat0([{ left: 1, right: 2, value: -10 }], false, undefined, 0x03),
      ])
      const kern = parseKern(new BinaryReader(buf))

      expect(kern.getPairAdjustment(1, 2, 'horizontal')).toEqual({
        advance: -10,
        crossStream: null,
        minimum: -10,
      })
      expect(kern.getPairAdjustment(1, 2, 'horizontal', undefined, 20).advance).toBe(-30)
    })

    it('should expose horizontal/vertical and cross-stream adjustments separately', () => {
      const buf = combineMicrosoftKern([
        buildKernFormat0([{ left: 1, right: 2, value: -40 }]),
        buildKernFormat0([{ left: 1, right: 2, value: 25 }], false, undefined, 0x05),
        buildKernFormat0([{ left: 1, right: 2, value: -60 }], false, undefined, 0x00),
        buildKernFormat0([{ left: 1, right: 2, value: -15 }], false, undefined, 0x04),
      ])
      const kern = parseKern(new BinaryReader(buf))

      expect(kern.getPairAdjustment(1, 2, 'horizontal')).toEqual({ advance: -40, crossStream: 25, minimum: null })
      expect(kern.getPairAdjustment(1, 2, 'vertical')).toEqual({ advance: -60, crossStream: -15, minimum: null })
    })

    it('should scale Apple variation subtables by their gvar global tuple', () => {
      const base = buildAppleKernFormat0([{ left: 1, right: 2, value: -40 }], 0)
      const delta = buildAppleKernFormat0([{ left: 1, right: 2, value: -20 }], 0x2000, 1)
      const baseBytes = new Uint8Array(base, 8)
      const deltaBytes = new Uint8Array(delta, 8)
      const combined = new ArrayBuffer(8 + baseBytes.length + deltaBytes.length)
      const view = new DataView(combined)
      const bytes = new Uint8Array(combined)
      view.setUint16(0, 1)
      view.setUint16(2, 0)
      view.setUint32(4, 2)
      bytes.set(baseBytes, 8)
      bytes.set(deltaBytes, 8 + baseBytes.length)
      const kern = parseKern(new BinaryReader(combined))

      expect(kern.getKerning(1, 2)).toBe(-40)
      expect(kern.getKerning(1, 2, [0, 0.5])).toBe(-50)
      expect(() => kern.getKerning(1, 2, [0.5])).toThrow(/tuple index 1 out of range/)
    })

    // Verifies that a format 0 subtable with nPairs = 0 parses and kerns everything to 0.
    it('should handle empty pairs', () => {
      const buf = buildKernFormat0([])
      const kern = parseKern(new BinaryReader(buf))
      expect(kern.getKerning(0, 0)).toBe(0)
    })

    // Verifies the OpenType format 0 binary-search header is validated against nPairs.
    it('should reject an invalid search header', () => {
      const buf = buildKernFormat0([{ left: 1, right: 2, value: -10 }], false, { searchRange: 0 })

      expect(() => parseKern(new BinaryReader(buf))).toThrow(/search header mismatch/)
    })

    // Verifies that the unsigned 32-bit left/right pair key order required by the spec is enforced.
    it('accepts unsorted pair keys (real fonts ship them; lookup is a map)', () => {
      const buf = buildKernFormat0([
        { left: 2, right: 1, value: -20 },
        { left: 1, right: 2, value: -10 },
      ])
      const kern = parseKern(new BinaryReader(buf))
      expect(kern.getKerning(2, 1)).toBe(-20)
      expect(kern.getKerning(1, 2)).toBe(-10)
    })

    // Verifies that pair glyph IDs are checked when maxp.numGlyphs is available.
    it('should reject pair glyph IDs outside numGlyphs', () => {
      const buf = buildKernFormat0([{ left: 1, right: 2, value: -10 }])

      expect(() => parseKern(new BinaryReader(buf), 2)).toThrow(/exceeds numGlyphs/)
    })
  })

  describe('Header validation', () => {
    // Verifies that unknown top-level kern table versions do not parse as empty kerning.
    it('should reject unsupported table versions', () => {
      const buf = new ArrayBuffer(2)
      new DataView(buf).setUint16(0, 2)

      expect(() => parseKern(new BinaryReader(buf))).toThrow(/Unsupported kern table version/)
    })

    // Verifies that a Microsoft subtable length cannot point beyond the table.
    it('should reject subtable lengths outside the kern table', () => {
      const buf = buildKernFormat0([])
      new DataView(buf).setUint16(6, buf.byteLength)

      expect(() => parseKern(new BinaryReader(buf))).toThrow(/exceeds kern table length/)
    })

    // Verifies that reserved Microsoft formats are rejected instead of silently skipped.
    it('should reject unsupported Microsoft subtable formats', () => {
      const buf = buildKernFormat0([])
      new DataView(buf).setUint16(8, 0x0101)

      expect(() => parseKern(new BinaryReader(buf))).toThrow(/Unsupported Microsoft kern subtable format/)
    })

    // Verifies that reserved Microsoft coverage bits must stay clear.
    it('should reject Microsoft coverage reserved bits', () => {
      const buf = buildKernFormat0([])
      new DataView(buf).setUint16(8, 0x0011)

      expect(() => parseKern(new BinaryReader(buf))).toThrow(/reserved bits must be zero/)
    })
  })

  describe('Format 2 (class-based)', () => {
    // Verifies that format 2 resolves left/right class byte offsets into the 2D kern value matrix.
    it('should compute kern values from class matrix', () => {
      // Left classes: glyph 10 → row offset 0, glyph 11 → row offset 4 (rowWidth=4, 2 int16 per row)
      // Right classes: glyph 20 → col offset 0, glyph 21 → col offset 2
      // Matrix:
      //   [[-50, -30],
      //    [-20, -10]]
      const buf = buildKernFormat2(
        { firstGlyph: 10, classValues: [0, 4] }, // rowWidth=4 for 2-col rows
        { firstGlyph: 20, classValues: [0, 2] }, // each col is 2 bytes
        [[-50, -30], [-20, -10]],
      )
      const kern = parseKern(new BinaryReader(buf))

      expect(kern.getKerning(10, 20)).toBe(-50)
      expect(kern.getKerning(10, 21)).toBe(-30)
      expect(kern.getKerning(11, 20)).toBe(-20)
      expect(kern.getKerning(11, 21)).toBe(-10)
    })

    // Verifies that glyphs below the class tables' firstGlyph range kern to 0.
    it('should return 0 for glyphs outside class range', () => {
      const buf = buildKernFormat2(
        { firstGlyph: 10, classValues: [0] },
        { firstGlyph: 20, classValues: [0] },
        [[-50]],
      )
      const kern = parseKern(new BinaryReader(buf))

      expect(kern.getKerning(9, 20)).toBe(0)
      expect(kern.getKerning(10, 19)).toBe(0)
    })
  })

  describe('Format 3 (compact)', () => {
    // Verifies that Apple format 3 resolves leftClass/rightClass/kernIndex arrays into kern values.
    it('should compute kern values from compact format', () => {
      // 4 glyphs, 3 kern values, 2 left classes, 2 right classes
      // kernValues: [0, -40, -20]
      // leftClass: [0, 0, 1, 1] — glyphs 0,1 → class 0; glyphs 2,3 → class 1
      // rightClass: [0, 1, 0, 1] — glyphs 0,2 → class 0; glyphs 1,3 → class 1
      // kernIndex (2×2): [0, 1, 2, 0] — class(0,0)→val0=0, class(0,1)→val1=-40, class(1,0)→val2=-20, class(1,1)→val0=0
      const buf = buildKernFormat3(
        4,
        [0, -40, -20],
        [0, 0, 1, 1],
        [0, 1, 0, 1],
        [0, 1, 2, 0],
      )
      const kern = parseKern(new BinaryReader(buf))

      expect(kern.getKerning(0, 0)).toBe(0) // class(0,0) → 0
      expect(kern.getKerning(0, 1)).toBe(-40) // class(0,1) → -40
      expect(kern.getKerning(2, 0)).toBe(-20) // class(1,0) → -20
      expect(kern.getKerning(2, 1)).toBe(0) // class(1,1) → 0
      expect(kern.getKerning(1, 3)).toBe(-40) // left=1→class0, right=3→class1 → index[0*2+1]=1 → -40
    })

    // Verifies that glyph IDs >= the format 3 glyphCount kern to 0.
    it('should return 0 for glyphs beyond glyphCount', () => {
      const buf = buildKernFormat3(
        2,
        [0, -10],
        [0, 1],
        [0, 1],
        [0, 1, 0, 0],
      )
      const kern = parseKern(new BinaryReader(buf))

      // Glyph 2 is beyond glyphCount
      expect(kern.getKerning(2, 0)).toBe(0)
    })
  })

  describe('Real font', () => {
    // Verifies that parsing a real font's kern table (if present) succeeds and getKerning returns numbers.
    it.skipIf(!existsSync(ROBOTO_PATH))('should parse Roboto kern table', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const reader = getTableReader(sfnt, 'kern')
      if (!reader) return // Roboto may not have kern table (uses GPOS)

      const kern = parseKern(reader)
      // Should return a number (may be 0 if no kerning for these specific pairs)
      expect(typeof kern.getKerning(0, 1)).toBe('number')
    })
  })
})
