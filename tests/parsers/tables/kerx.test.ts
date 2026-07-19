import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseKerx } from '../../../src/parsers/tables/kerx.js'

function getKerxSearchValues(nPairs: number): { searchRange: number, entrySelector: number, rangeShift: number } {
  if (nPairs === 0) return { searchRange: 0, entrySelector: 0, rangeShift: 0 }
  let power = 1
  let entrySelector = 0
  while (power * 2 <= nPairs) { power *= 2; entrySelector++ }
  return { searchRange: power * 6, entrySelector, rangeShift: (nPairs - power) * 6 }
}

/**
 * Wraps one or more pre-built kerx subtables with the kerx header
 */
function buildKerx(subtables: ArrayBuffer[], version = 2, includeCoverageArray = version >= 3): ArrayBuffer {
  let total = 8
  for (const s of subtables) total += s.byteLength
  if (includeCoverageArray) total += subtables.length * 4

  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let pos = 0

  view.setUint16(pos, version); pos += 2 // version
  view.setUint16(pos, 0); pos += 2 // padding
  view.setUint32(pos, subtables.length); pos += 4

  for (const s of subtables) {
    bytes.set(new Uint8Array(s), pos)
    pos += s.byteLength
  }
  if (includeCoverageArray) {
    for (let i = 0; i < subtables.length; i++) {
      view.setUint32(pos, 0xFFFFFFFF)
      pos += 4
    }
  }
  return buf
}

function buildKerxWithCoverageBitfield(
  subtable: ArrayBuffer,
  version: number,
  numGlyphs: number,
  coverageOffset: number,
  fill = 0xFF,
): ArrayBuffer {
  const bitfieldSize = (numGlyphs + 7) >> 3
  const paddedBitfieldSize = (bitfieldSize + 3) & ~3
  const total = 8 + subtable.byteLength + 4 + paddedBitfieldSize
  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let pos = 0

  view.setUint16(pos, version); pos += 2
  view.setUint16(pos, 0); pos += 2
  view.setUint32(pos, 1); pos += 4
  bytes.set(new Uint8Array(subtable), pos)
  pos += subtable.byteLength

  const coverageStart = pos
  view.setUint32(pos, coverageOffset); pos += 4
  if (coverageOffset !== 0 && coverageStart + coverageOffset + paddedBitfieldSize <= total) {
    const bitfieldStart = coverageStart + coverageOffset
    for (let i = 0; i < bitfieldSize; i++) view.setUint8(bitfieldStart + i, fill)
  }

  return buf
}

/**
 * Format 0: ordered list of kerning pairs
 */
function buildKerxFormat0(
  pairs: { left: number, right: number, value: number }[],
  coverage = 0,
  tupleCount = 0,
): ArrayBuffer {
  const length = 12 + 16 + pairs.length * 6
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)
  let pos = 0

  view.setUint32(pos, length); pos += 4
  view.setUint32(pos, coverage); pos += 4 // format 0 in low byte
  view.setUint32(pos, tupleCount); pos += 4

  view.setUint32(pos, pairs.length); pos += 4
  const search = getKerxSearchValues(pairs.length)
  view.setUint32(pos, search.searchRange); pos += 4
  view.setUint32(pos, search.entrySelector); pos += 4
  view.setUint32(pos, search.rangeShift); pos += 4

  for (const p of pairs) {
    view.setUint16(pos, p.left); pos += 2
    view.setUint16(pos, p.right); pos += 2
    view.setInt16(pos, p.value); pos += 2
  }
  return buf
}

function buildKerxFormat0Vector(left: number, right: number, vectorValue: number | number[], coverage = 0): ArrayBuffer {
  const vector = Array.isArray(vectorValue) ? vectorValue : [vectorValue]
  const vectorOffset = 34
  const length = vectorOffset + vector.length * 2
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)
  let pos = 0

  view.setUint32(pos, length); pos += 4
  view.setUint32(pos, coverage); pos += 4
  view.setUint32(pos, vector.length); pos += 4

  view.setUint32(pos, 1); pos += 4
  view.setUint32(pos, 6); pos += 4
  view.setUint32(pos, 0); pos += 4
  view.setUint32(pos, 0); pos += 4

  view.setUint16(pos, left); pos += 2
  view.setUint16(pos, right); pos += 2
  view.setInt16(pos, vectorOffset); pos += 2

  for (let i = 0; i < vector.length; i++) view.setInt16(vectorOffset + i * 2, vector[i]!)

  return buf
}

/**
 * Format 1: contextual kerning state machine.
 * Glyph `pushGlyph` is pushed in the start state; when followed by
 * `kernGlyph` both are pushed and the value list [kernValue, 0xFFFF]
 * is applied (kernValue goes to kernGlyph, the terminator clears the stack).
 */
function buildKerxFormat1(
  pushGlyph: number,
  kernGlyph: number,
  kernValue: number | number[],
  coverageFlags = 0,
): ArrayBuffer {
  const vector = Array.isArray(kernValue) ? kernValue : [kernValue]
  // Layout from state table header start (subtableStart + 12):
  //  0: nClasses=6, classTableOffset=20, stateArrayOffset=30, entryTableOffset=66
  // 16: valueTable offset = 84
  // 20: class lookup (format 8, 2 glyphs) = 10 bytes
  // 30: state array (3 states x 6 classes x uint16) = 36 bytes
  // 66: entry table (3 entries x 6 bytes) = 18 bytes
  // 84: value table: kernValue, 0xFFFF = 4 bytes
  const stSize = 84 + vector.length * 2 + 2
  const length = 12 + stSize
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)

  view.setUint32(0, length)
  view.setUint32(4, coverageFlags | 1) // coverage + format 1
  view.setUint32(8, Array.isArray(kernValue) ? vector.length : 0)

  const s = 12
  view.setUint32(s, 6) // nClasses
  view.setUint32(s + 4, 20) // classTableOffset
  view.setUint32(s + 8, 30) // stateArrayOffset
  view.setUint32(s + 12, 66) // entryTableOffset
  view.setUint32(s + 16, 84) // valueTable offset

  // Class lookup: format 8 trimmed array — pushGlyph -> class 4, kernGlyph -> class 5
  view.setUint16(s + 20, 8)
  view.setUint16(s + 22, pushGlyph)
  view.setUint16(s + 24, 2)
  view.setUint16(s + 26, 4)
  view.setUint16(s + 28, 5)

  // State array: row 0 (start of text), row 1 (start of line), row 2 (seen pushGlyph)
  const rows = [
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1, 2],
  ]
  let pos = s + 30
  for (const row of rows) {
    for (const e of row) {
      view.setUint16(pos, e); pos += 2
    }
  }

  // Entry table: newState(2) + flags(2) + valueIndex(2)
  // entry 0: stay in start state, no action
  view.setUint16(s + 66, 0); view.setUint16(s + 68, 0x0000); view.setUint16(s + 70, 0xFFFF)
  // entry 1: push, go to state 2
  view.setUint16(s + 72, 2); view.setUint16(s + 74, 0x8000); view.setUint16(s + 76, 0xFFFF)
  // entry 2: push, apply value list at index 0, back to start
  view.setUint16(s + 78, 0); view.setUint16(s + 80, 0x8000); view.setUint16(s + 82, 0x0000)

  // Value table: kernValue (applied to the popped current glyph), then terminator
  for (let i = 0; i < vector.length; i++) view.setInt16(s + 84 + i * 2, vector[i]!)
  view.setUint16(s + 84 + vector.length * 2, 0xFFFF)

  return buf
}

/**
 * Format 1 fixture for processDirection=backward.
 * The right glyph is visited first and pushed; the left glyph then applies
 * the kerning value to the pushed right glyph.
 */
function buildKerxFormat1Backward(leftGlyph: number, rightGlyph: number, kernValue: number): ArrayBuffer {
  const stSize = 88
  const length = 12 + stSize
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)

  view.setUint32(0, length)
  view.setUint32(4, 0x10000001) // processDirection + format 1
  view.setUint32(8, 0)

  const s = 12
  view.setUint32(s, 6)
  view.setUint32(s + 4, 20)
  view.setUint32(s + 8, 30)
  view.setUint32(s + 12, 66)
  view.setUint32(s + 16, 84)

  view.setUint16(s + 20, 8)
  view.setUint16(s + 22, leftGlyph)
  view.setUint16(s + 24, 2)
  view.setUint16(s + 26, 5) // left glyph applies
  view.setUint16(s + 28, 4) // right glyph pushes

  const rows = [
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1, 2],
  ]
  let pos = s + 30
  for (const row of rows) {
    for (const e of row) {
      view.setUint16(pos, e); pos += 2
    }
  }

  view.setUint16(s + 66, 0); view.setUint16(s + 68, 0x0000); view.setUint16(s + 70, 0xFFFF)
  view.setUint16(s + 72, 2); view.setUint16(s + 74, 0x8000); view.setUint16(s + 76, 0xFFFF)
  view.setUint16(s + 78, 0); view.setUint16(s + 80, 0x0000); view.setUint16(s + 82, 0x0000)

  view.setInt16(s + 84, kernValue)
  view.setUint16(s + 86, 0xFFFF)

  return buf
}

/**
 * Writes an AAT lookup table format 6 with a single (glyph, value) unit.
 * Layout: format(2) + BinSrchHeader(10) + glyph(2) + value(2) = 16 bytes.
 */
function writeLookupFormat6Single(view: DataView, offset: number, glyph: number, value: number): void {
  view.setUint16(offset, 6) // format
  view.setUint16(offset + 2, 4) // unitSize
  view.setUint16(offset + 4, 1) // nUnits
  // offset+6..12: searchRange, entrySelector, rangeShift (zero, unused by the parser)
  view.setUint16(offset + 12, glyph)
  view.setUint16(offset + 14, value)
}

/**
 * Format 2: simple row/column class based array.
 * leftGlyph maps to row 1, rightGlyph maps to column 1 of a 2x2 array
 * whose [1][1] cell holds `value`.
 */
function buildKerxFormat2(leftGlyph: number, rightGlyph: number, value: number): ArrayBuffer {
  // 12: rowWidth=4, leftOffsetTable=28, rightOffsetTable=44, array=60
  // 28: left lookup (format 6, 1 unit) = 16 bytes
  // 44: right lookup (format 6, 1 unit) = 16 bytes
  // 60: kerning array 2x2 int16 = 8 bytes
  const length = 68
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)

  view.setUint32(0, length)
  view.setUint32(4, 2) // coverage: format 2
  view.setUint32(8, 0) // tupleCount

  view.setUint32(12, 4) // rowWidth (2 columns x 2 bytes)
  view.setUint32(16, 28)
  view.setUint32(20, 44)
  view.setUint32(24, 60)

  // Class values are flat element indices: row 1 starts at element 2 and
  // column 1 adds one, selecting element 3.
  writeLookupFormat6Single(view, 28, leftGlyph, 2)
  writeLookupFormat6Single(view, 44, rightGlyph, 1)

  view.setInt16(60, 0)
  view.setInt16(62, 0)
  view.setInt16(64, 0)
  view.setInt16(66, value)

  return buf
}

function buildKerxFormat2Vector(leftGlyph: number, rightGlyph: number): ArrayBuffer {
  const arrayOffset = 60
  const vectorOffset = 68
  const length = 72
  const buf = buildKerxFormat2(leftGlyph, rightGlyph, vectorOffset).slice(0, length)
  const expanded = new ArrayBuffer(length)
  new Uint8Array(expanded).set(new Uint8Array(buf))
  const view = new DataView(expanded)
  view.setUint32(0, length)
  view.setUint32(8, 2)
  view.setUint16(arrayOffset + 6, vectorOffset)
  view.setInt16(vectorOffset, 100)
  view.setInt16(vectorOffset + 2, 20)
  return expanded
}

/**
 * Format 4: control/anchor point attachment state machine.
 * markGlyph is marked in the start state; when followed by currGlyph the
 * action at index 0 is performed.
 */
function buildKerxFormat4(
  markGlyph: number,
  currGlyph: number,
  actionType: number,
  actionValues: number[],
): ArrayBuffer {
  // Layout from state table header start (subtableStart + 12):
  //  0: nClasses=6, classTableOffset=20, stateArrayOffset=30, entryTableOffset=54
  // 16: flags = actionType << 30 | controlTableOffset(72)
  // 20: class lookup (format 8) = 10 bytes
  // 30: state array = 24 bytes
  // 54: entry table (3 x 6 bytes) = 18 bytes
  // 72: control point table
  const actionBytes = actionValues.length * 2
  const stSize = 72 + actionBytes
  const length = 12 + stSize
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)

  view.setUint32(0, length)
  view.setUint32(4, 4) // coverage: format 4
  view.setUint32(8, 0) // tupleCount

  const s = 12
  view.setUint32(s, 6)
  view.setUint32(s + 4, 20)
  view.setUint32(s + 8, 30)
  view.setUint32(s + 12, 54)
  view.setUint32(s + 16, ((actionType << 30) | 72) >>> 0)

  // Class lookup: markGlyph -> class 4, currGlyph -> class 5
  view.setUint16(s + 20, 8)
  view.setUint16(s + 22, markGlyph)
  view.setUint16(s + 24, 2)
  view.setUint16(s + 26, 4)
  view.setUint16(s + 28, 5)

  const rows = [
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1, 2],
  ]
  let pos = s + 30
  for (const row of rows) {
    for (const e of row) {
      view.setUint16(pos, e); pos += 2
    }
  }

  // entry 0: no action
  view.setUint16(s + 54, 0); view.setUint16(s + 56, 0x0000); view.setUint16(s + 58, 0xFFFF)
  // entry 1: mark, go to state 1
  view.setUint16(s + 60, 1); view.setUint16(s + 62, 0x8000); view.setUint16(s + 64, 0xFFFF)
  // entry 2: perform action 0, back to start
  view.setUint16(s + 66, 0); view.setUint16(s + 68, 0x0000); view.setUint16(s + 70, 0x0000)

  pos = s + 72
  for (const v of actionValues) {
    view.setInt16(pos, v); pos += 2
  }

  return buf
}

function buildKerxFormat4Backward(
  leftGlyph: number,
  rightGlyph: number,
  actionType: number,
  actionValues: number[],
): ArrayBuffer {
  const actionBytes = actionValues.length * 2
  const stSize = 72 + actionBytes
  const length = 12 + stSize
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)

  view.setUint32(0, length)
  view.setUint32(4, 0x10000004) // processDirection + format 4
  view.setUint32(8, 0)

  const s = 12
  view.setUint32(s, 6)
  view.setUint32(s + 4, 20)
  view.setUint32(s + 8, 30)
  view.setUint32(s + 12, 54)
  view.setUint32(s + 16, ((actionType << 30) | 72) >>> 0)

  view.setUint16(s + 20, 8)
  view.setUint16(s + 22, leftGlyph)
  view.setUint16(s + 24, 2)
  view.setUint16(s + 26, 5) // left glyph performs the action after backward traversal marks right glyph
  view.setUint16(s + 28, 4) // right glyph marks

  const rows = [
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1, 2],
  ]
  let pos = s + 30
  for (const row of rows) {
    for (const e of row) {
      view.setUint16(pos, e); pos += 2
    }
  }

  view.setUint16(s + 54, 0); view.setUint16(s + 56, 0x0000); view.setUint16(s + 58, 0xFFFF)
  view.setUint16(s + 60, 1); view.setUint16(s + 62, 0x8000); view.setUint16(s + 64, 0xFFFF)
  view.setUint16(s + 66, 0); view.setUint16(s + 68, 0x0000); view.setUint16(s + 70, 0x0000)

  pos = s + 72
  for (const v of actionValues) {
    view.setInt16(pos, v); pos += 2
  }

  return buf
}

/**
 * Format 6: simple index-based n x m array.
 * leftGlyph -> row 1 (pre-multiplied by columnCount=2), rightGlyph -> column 1;
 * the 2x2 array cell [1][1] holds `value`.
 */
function buildKerxFormat6(leftGlyph: number, rightGlyph: number, value: number): ArrayBuffer {
  // 12: flags=0, rowCount=2, columnCount=2,
  //     rowIndexTableOffset=32, columnIndexTableOffset=48, kerningArrayOffset=64
  // 32: row lookup (format 6, 1 unit) = 16 bytes
  // 48: column lookup (format 6, 1 unit) = 16 bytes
  // 64: kerning array 4 x int16 = 8 bytes
  const length = 72
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)

  view.setUint32(0, length)
  view.setUint32(4, 6) // coverage: format 6
  view.setUint32(8, 0) // tupleCount

  view.setUint32(12, 0) // flags: short values
  view.setUint16(16, 2) // rowCount
  view.setUint16(18, 2) // columnCount
  view.setUint32(20, 32)
  view.setUint32(24, 48)
  view.setUint32(28, 64)

  // Row index: leftGlyph -> 2 (row 1 pre-multiplied by columnCount),
  // column index: rightGlyph -> 1
  writeLookupFormat6Single(view, 32, leftGlyph, 2)
  writeLookupFormat6Single(view, 48, rightGlyph, 1)

  view.setInt16(64, 0)
  view.setInt16(66, 0)
  view.setInt16(68, 0)
  view.setInt16(70, value)

  return buf
}

function buildKerxFormat6Long(leftGlyph: number, rightGlyph: number, value: number): ArrayBuffer {
  const rowOffset = 32
  const columnOffset = 42
  const arrayOffset = 52
  const length = arrayOffset + 16
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)
  view.setUint32(0, length)
  view.setUint32(4, 6)
  view.setUint32(8, 0)
  view.setUint32(12, 1) // valuesAreLong
  view.setUint16(16, 2)
  view.setUint16(18, 2)
  view.setUint32(20, rowOffset)
  view.setUint32(24, columnOffset)
  view.setUint32(28, arrayOffset)

  view.setUint16(rowOffset, 8)
  view.setUint16(rowOffset + 2, leftGlyph)
  view.setUint16(rowOffset + 4, 1)
  view.setUint32(rowOffset + 6, 2)
  view.setUint16(columnOffset, 8)
  view.setUint16(columnOffset + 2, rightGlyph)
  view.setUint16(columnOffset + 4, 1)
  view.setUint32(columnOffset + 6, 1)
  view.setInt32(arrayOffset + 12, value)
  return buf
}

function buildKerxFormat6Vector(leftGlyph: number, rightGlyph: number): ArrayBuffer {
  const rowOffset = 36
  const columnOffset = 52
  const arrayOffset = 68
  const vectorOffset = 76
  const length = 84
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)
  view.setUint32(0, length)
  view.setUint32(4, 6)
  view.setUint32(8, 2)
  view.setUint32(12, 0)
  view.setUint16(16, 2)
  view.setUint16(18, 2)
  view.setUint32(20, rowOffset)
  view.setUint32(24, columnOffset)
  view.setUint32(28, arrayOffset)
  view.setUint32(32, vectorOffset)
  writeLookupFormat6Single(view, rowOffset, leftGlyph, 2)
  writeLookupFormat6Single(view, columnOffset, rightGlyph, 1)
  view.setUint16(arrayOffset + 6, 4)
  view.setInt16(vectorOffset, 0)
  view.setInt16(vectorOffset + 2, 0)
  view.setInt16(vectorOffset + 4, 100)
  view.setInt16(vectorOffset + 6, 20)
  return buf
}

describe('kerx table parser', () => {
  describe('table structure', () => {
    it('should reject malformed table headers', () => {
      const unsupportedVersion = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])
      new DataView(unsupportedVersion).setUint16(0, 5)

      const nonZeroPadding = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])
      new DataView(nonZeroPadding).setUint16(2, 1)

      const noSubtables = buildKerx([])

      expect(() => parseKerx(new BinaryReader(new ArrayBuffer(7)))).toThrow(/length/)
      expect(() => parseKerx(new BinaryReader(unsupportedVersion))).toThrow(/Unsupported kerx/)
      expect(() => parseKerx(new BinaryReader(nonZeroPadding))).toThrow(/padding/)
      expect(() => parseKerx(new BinaryReader(noSubtables))).toThrow(/at least one subtable/)
    })

    it('should reject malformed subtables', () => {
      const missingSubtableHeader = buildKerx([])
      new DataView(missingSubtableHeader).setUint32(4, 1)

      const shortSubtable = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])
      new DataView(shortSubtable).setUint32(8, 8)

      const subtableOverflow = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])
      new DataView(subtableOverflow).setUint32(8, subtableOverflow.byteLength)

      const reservedCoverage = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])
      new DataView(reservedCoverage).setUint32(12, 0x00000100)

      const reservedFormat = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])
      new DataView(reservedFormat).setUint32(12, 3)

      const unsupportedFormat = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])
      new DataView(unsupportedFormat).setUint32(12, 7)

      const invalidSearch = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])
      new DataView(invalidSearch).setUint32(24, 0)

      const glyphOutOfRange = buildKerx([buildKerxFormat0([{ left: 10, right: 11, value: -40 }])])

      expect(() => parseKerx(new BinaryReader(missingSubtableHeader))).toThrow(/header exceeds/)
      expect(() => parseKerx(new BinaryReader(shortSubtable))).toThrow(/subtable 0 length/)
      expect(() => parseKerx(new BinaryReader(subtableOverflow))).toThrow(/subtable 0 exceeds/)
      expect(() => parseKerx(new BinaryReader(reservedCoverage))).toThrow(/coverage reserved/)
      expect(() => parseKerx(new BinaryReader(reservedFormat))).toThrow(/Unsupported kerx subtable format/)
      expect(() => parseKerx(new BinaryReader(unsupportedFormat))).toThrow(/Unsupported kerx subtable format/)
      expect(() => parseKerx(new BinaryReader(invalidSearch))).toThrow(/search header mismatch/)
      expect(() => parseKerx(new BinaryReader(glyphOutOfRange), 10)).toThrow(/exceeds numGlyphs/)
    })

    it('should parse version 3 subtable glyph coverage arrays', () => {
      const buf = buildKerxWithCoverageBitfield(buildKerxFormat6(10, 11, -20), 3, 16, 4)
      const table = parseKerx(new BinaryReader(buf), 16)

      expect(table.version).toBe(3)
      expect(table.getKerning(10, 11)).toBe(-20)
    })

    it('should use version 3 glyph coverage to skip state-machine subtables', () => {
      const covered = buildKerxWithCoverageBitfield(buildKerxFormat1(10, 11, -50), 3, 16, 4)
      const uncovered = buildKerxWithCoverageBitfield(buildKerxFormat1(10, 11, -50), 3, 16, 4, 0)

      expect(parseKerx(new BinaryReader(covered), 16).applyContextualKerning([10, 11])).toEqual([0, -50])
      expect(parseKerx(new BinaryReader(uncovered), 16).applyContextualKerning([10, 11])).toEqual([0, 0])
    })

    it('should reject malformed version 3 glyph coverage arrays', () => {
      const overlapping = buildKerxWithCoverageBitfield(buildKerxFormat1(10, 11, -50), 3, 16, 0)
      const overflowing = buildKerxWithCoverageBitfield(buildKerxFormat1(10, 11, -50), 3, 16, 8)

      expect(() => parseKerx(new BinaryReader(overlapping), 16)).toThrow(/overlaps/)
      expect(() => parseKerx(new BinaryReader(overflowing), 16)).toThrow(/exceeds table length/)
    })

      })

  describe('format 0 (ordered pair list)', () => {
    it('should return pair kerning values', () => {
      const buf = buildKerx([buildKerxFormat0([
        { left: 10, right: 11, value: -40 },
        { left: 10, right: 12, value: 15 },
      ])])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.version).toBe(2)
      expect(table.subtables).toHaveLength(1)
      expect(table.subtables[0]!.format).toBe(0)
      expect(table.getKerning(10, 11)).toBe(-40)
      expect(table.getKerning(10, 12)).toBe(15)
      expect(table.getKerning(11, 10)).toBe(0)
    })

    it('should ignore vertical subtables in horizontal pair kerning', () => {
      const buf = buildKerx([buildKerxFormat0(
        [{ left: 10, right: 11, value: -40 }],
        0x80000000, // vertical, format 0
      )])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables[0]!.vertical).toBe(true)
      expect(table.getKerning(10, 11)).toBe(0)
    })

    it('should ignore tupleCount before kerx version 4', () => {
      const buf = buildKerx([buildKerxFormat0(
        [{ left: 10, right: 11, value: -40 }],
        0,
        1,
      )], 2)
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables[0]!.tupleCount).toBe(1)
      expect(table.getKerning(10, 11)).toBe(-40)
    })

    it('should use tuple vectors for kerx version 4', () => {
      const buf = buildKerx([buildKerxFormat0Vector(10, 11, -35)], 4)
      const table = parseKerx(new BinaryReader(buf), 16)

      expect(table.version).toBe(4)
      expect(table.subtables[0]!.tupleCount).toBe(1)
      expect(table.getKerning(10, 11)).toBe(-35)
    })

    it('should resolve tuple vector deltas with gvar global-tuple scalars', () => {
      const buf = buildKerx([buildKerxFormat0Vector(10, 11, [100, 20, -20])], 4)
      const table = parseKerx(new BinaryReader(buf), 16)

      expect(table.getKerning(10, 11)).toBe(100)
      expect(table.getKerning(10, 11, [0.5, 0.25])).toBe(105)
      expect(() => table.getKerning(10, 11, [0.5])).toThrow(/requires 2 gvar global tuples/)
    })

    it('should select vertical and cross-stream pair positioning by direction', () => {
      const buf = buildKerx([
        buildKerxFormat0([{ left: 10, right: 11, value: -40 }]),
        buildKerxFormat0([{ left: 10, right: 11, value: -60 }], 0x80000000),
        buildKerxFormat0([{ left: 10, right: 11, value: 25 }], 0x40000000),
        buildKerxFormat0([{ left: 10, right: 11, value: -15 }], 0xC0000000),
      ])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.getPairAdjustment(10, 11, 'horizontal')).toEqual({ advance: -40, crossStream: 25 })
      expect(table.getPairAdjustment(10, 11, 'vertical')).toEqual({ advance: -60, crossStream: -15 })
    })
  })

  describe('format 1 (contextual state machine)', () => {
    it('should apply contextual kerning to a glyph pair', () => {
      const buf = buildKerx([buildKerxFormat1(10, 11, -50)])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables[0]!.format).toBe(1)
      expect(table.applyContextualKerning([10, 11])).toEqual([0, -50])
    })

    it('should dispatch the end-of-line class for line shaping', () => {
      const subtable = buildKerxFormat1(10, 11, -50)
      // State 1, class 3 uses entry 2, so its pending pushed glyph is kerned
      // only by the line terminator. The text terminator remains entry 0.
      new DataView(subtable).setUint16(12 + 60, 2)
      const table = parseKerx(new BinaryReader(buildKerx([subtable])))

      expect(table.applyContextualKerning([10], undefined, 'text')).toEqual([0])
      expect(table.applyContextualKerning([10], undefined, 'line')).toEqual([-50])
    })

    it('should not kern when the context does not match', () => {
      const buf = buildKerx([buildKerxFormat1(10, 11, -50)])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.applyContextualKerning([11, 10])).toEqual([0, 0])
      expect(table.applyContextualKerning([10, 10, 5])).toEqual([0, 0, 0])
    })

    it('should kern repeated contexts independently', () => {
      const buf = buildKerx([buildKerxFormat1(10, 11, -50)])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.applyContextualKerning([10, 11, 10, 11])).toEqual([0, -50, 0, -50])
    })

    it('should honor backward processDirection for contextual kerning', () => {
      const buf = buildKerx([buildKerxFormat1Backward(10, 11, -50)])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables[0]!.processBackwards).toBe(true)
      expect(table.applyContextualKerning([10, 11])).toEqual([0, -50])
      expect(table.applyContextualKerning([11, 10])).toEqual([0, 0])
    })

    it('should resolve version 4 contextual tuple vectors', () => {
      const table = parseKerx(new BinaryReader(buildKerx([buildKerxFormat1(10, 11, [100, 20])], 4)))

      expect(table.applyContextualKerning([10, 11])).toEqual([0, 100])
      expect(table.applyContextualKerning([10, 11], [0.5])).toEqual([0, 110])
    })

    it('should route contextual vertical and cross-stream values to their axes', () => {
      const vertical = parseKerx(new BinaryReader(buildKerx([
        buildKerxFormat1(10, 11, -50, 0x80000000),
      ])))
      const cross = parseKerx(new BinaryReader(buildKerx([
        buildKerxFormat1(10, 11, 30, 0x40000000),
      ])))

      expect(vertical.applyContextualPositioning([10, 11], 'vertical')).toEqual({
        xAdvance: [0, 0], yAdvance: [0, -50], xOffset: [0, 0], yOffset: [0, -50],
      })
      expect(cross.applyContextualPositioning([10, 11], 'horizontal')).toEqual({
        xAdvance: [0, 0], yAdvance: [0, 0], xOffset: [0, 0], yOffset: [0, 30],
      })
    })
  })

  describe('format 2 (simple n x m array)', () => {
    it('should return kerning from class offset lookups', () => {
      const buf = buildKerx([buildKerxFormat2(20, 30, -80)])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables[0]!.format).toBe(2)
      expect(table.getKerning(20, 30)).toBe(-80)
      // Uncovered glyphs fall into row/column 0, whose cells are zero
      expect(table.getKerning(20, 999)).toBe(0)
      expect(table.getKerning(999, 30)).toBe(0)
    })

    it('should resolve version 4 tuple vectors from class cells', () => {
      const table = parseKerx(new BinaryReader(buildKerx([buildKerxFormat2Vector(20, 30)], 4)), 64)

      expect(table.getKerning(20, 30)).toBe(100)
      expect(table.getKerning(20, 30, [0.5])).toBe(110)
    })
  })

  describe('format 4 (attachment state machine)', () => {
    it('should report anchor point attachments (action type 1)', () => {
      const buf = buildKerx([buildKerxFormat4(40, 41, 1, [2, 3])])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables[0]!.format).toBe(4)
      const attachments = table.getAttachments([40, 41])
      expect(attachments).toEqual([
        { markIndex: 0, currentIndex: 1, actionType: 1, values: [2, 3] },
      ])
    })

    it('should report coordinate attachments (action type 2)', () => {
      const buf = buildKerx([buildKerxFormat4(40, 41, 2, [100, -20, 5, 30])])
      const table = parseKerx(new BinaryReader(buf))

      const attachments = table.getAttachments([40, 41])
      expect(attachments).toEqual([
        { markIndex: 0, currentIndex: 1, actionType: 2, values: [100, -20, 5, 30] },
      ])
    })

    it('should not attach without a preceding mark', () => {
      const buf = buildKerx([buildKerxFormat4(40, 41, 1, [2, 3])])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.getAttachments([41, 40])).toEqual([])
    })

    it('should honor backward processDirection for attachments', () => {
      const buf = buildKerx([buildKerxFormat4Backward(40, 41, 1, [2, 3])])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables[0]!.processBackwards).toBe(true)
      expect(table.getAttachments([40, 41])).toEqual([
        { markIndex: 1, currentIndex: 0, actionType: 1, values: [2, 3] },
      ])
    })
  })

  describe('format 6 (index-based array)', () => {
    it('should return kerning from row/column index lookups', () => {
      const buf = buildKerx([buildKerxFormat6(50, 60, -25)])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables[0]!.format).toBe(6)
      expect(table.getKerning(50, 60)).toBe(-25)
      expect(table.getKerning(60, 50)).toBe(0)
    })

    it('should read long class indices and long kerning values', () => {
      const table = parseKerx(new BinaryReader(buildKerx([buildKerxFormat6Long(50, 60, -100000)])))

      expect(table.getKerning(50, 60)).toBe(-100000)
      expect(table.getKerning(60, 50)).toBe(0)
    })

    it('should resolve version 4 tuple vectors from index cells', () => {
      const table = parseKerx(new BinaryReader(buildKerx([buildKerxFormat6Vector(50, 60)], 4)), 64)

      expect(table.getKerning(50, 60)).toBe(100)
      expect(table.getKerning(50, 60, [0.5])).toBe(110)
    })
  })

  describe('multiple subtables', () => {
    it('should accumulate kerning across subtables', () => {
      const buf = buildKerx([
        buildKerxFormat0([{ left: 50, right: 60, value: -10 }]),
        buildKerxFormat6(50, 60, -25),
      ])
      const table = parseKerx(new BinaryReader(buf))

      expect(table.subtables).toHaveLength(2)
      expect(table.getKerning(50, 60)).toBe(-35)
    })
  })
})
