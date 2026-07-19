import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseLtsh } from '../../../src/parsers/tables/ltsh.js'

/**
 * Builds a synthetic LTSH table binary.
 */
function buildLtshTable(yPels: number[], version = 0): ArrayBuffer {
  // Header: version(2) + numGlyphs(2) = 4
  // yPels: uint8 * numGlyphs
  const buf = new ArrayBuffer(4 + yPels.length)
  const view = new DataView(buf)
  let pos = 0

  view.setUint16(pos, version); pos += 2
  view.setUint16(pos, yPels.length); pos += 2

  for (const y of yPels) {
    view.setUint8(pos++, y)
  }

  return buf
}

describe('LTSH table parser', () => {
  // Verifies that per-glyph yPels linearity thresholds are parsed and returned by glyph ID.
  it('should parse synthetic LTSH table', () => {
    const buf = buildLtshTable([1, 10, 20, 30, 255])
    const reader = new BinaryReader(buf)
    const ltsh = parseLtsh(reader, 5)

    expect(ltsh.getLinearThreshold(0)).toBe(1)
    expect(ltsh.getLinearThreshold(1)).toBe(10)
    expect(ltsh.getLinearThreshold(2)).toBe(20)
    expect(ltsh.getLinearThreshold(3)).toBe(30)
    expect(ltsh.getLinearThreshold(4)).toBe(255)
  })

  // Verifies that getLinearThreshold returns 0 for negative or >= numGlyphs glyph IDs.
  it('should return 0 for out-of-range glyphId', () => {
    const buf = buildLtshTable([10, 20])
    const reader = new BinaryReader(buf)
    const ltsh = parseLtsh(reader, 2)

    expect(ltsh.getLinearThreshold(-1)).toBe(0)
    expect(ltsh.getLinearThreshold(2)).toBe(0)
    expect(ltsh.getLinearThreshold(999)).toBe(0)
  })

  // Verifies that a zero-glyph LTSH table parses and yields 0 thresholds.
  it('should handle empty table', () => {
    const buf = buildLtshTable([])
    const reader = new BinaryReader(buf)
    const ltsh = parseLtsh(reader)

    expect(ltsh.getLinearThreshold(0)).toBe(0)
  })

  // Verifies that a future compatible version uses the known threshold array.
  it('should read a future compatible version', () => {
    const buf = buildLtshTable([10], 1)

    expect(parseLtsh(new BinaryReader(buf), 1).getLinearThreshold(0)).toBe(10)
  })

  // Verifies that the table's glyph count matches maxp.numGlyphs when provided.
  it('should reject numGlyphs mismatches', () => {
    const buf = buildLtshTable([10, 20])

    expect(() => parseLtsh(new BinaryReader(buf), 3)).toThrow(/numGlyphs mismatch/)
  })

  // Verifies that the yPixels array length matches the declared numGlyphs exactly.
  it('should reject malformed table lengths', () => {
    const buf = buildLtshTable([10, 20])
    const truncated = buf.slice(0, buf.byteLength - 1)
    const padded = new ArrayBuffer(buf.byteLength + 1)
    new Uint8Array(padded).set(new Uint8Array(buf))

    expect(() => parseLtsh(new BinaryReader(truncated), 2)).toThrow(/length mismatch/)
    expect(() => parseLtsh(new BinaryReader(padded), 2)).toThrow(/length mismatch/)
  })
})
