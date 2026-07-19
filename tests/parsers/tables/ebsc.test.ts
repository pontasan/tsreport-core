import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseEbsc } from '../../../src/parsers/tables/ebsc.js'

/**
 * Builds a synthetic EBSC table binary.
 */
function buildEbscTable(
  strikes: { ppemX: number, ppemY: number, substitutePpemX: number, substitutePpemY: number }[],
): ArrayBuffer {
  // Header: version(4=Fixed) + numSizes(4) = 8
  // Per strike: hori(12) + vert(12) + ppemX(1) + ppemY(1) + substitutePpemX(1) + substitutePpemY(1) = 28
  const headerSize = 8
  const strikeSize = 28
  const totalSize = headerSize + strikes.length * strikeSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint32(pos, 0x00020000); pos += 4 // version 2.0
  view.setUint32(pos, strikes.length); pos += 4

  for (const s of strikes) {
    // hori sbitLineMetrics (12 bytes) — fill with defaults
    view.setInt8(pos++, 8)   // ascender
    view.setInt8(pos++, -2)  // descender
    view.setUint8(pos++, 10) // widthMax
    view.setInt8(pos++, 1)   // caretSlopeNumerator
    view.setInt8(pos++, 0)   // caretSlopeDenominator
    view.setInt8(pos++, 0)   // caretOffset
    view.setInt8(pos++, 0)   // minOriginSB
    view.setInt8(pos++, 0)   // minAdvanceSB
    view.setInt8(pos++, 8)   // maxBeforeBL
    view.setInt8(pos++, -2)  // minAfterBL
    view.setInt8(pos++, 0)   // pad1
    view.setInt8(pos++, 0)   // pad2

    // vert sbitLineMetrics (12 bytes)
    view.setInt8(pos++, 8)
    view.setInt8(pos++, -2)
    view.setUint8(pos++, 10)
    view.setInt8(pos++, 0)
    view.setInt8(pos++, 1)
    view.setInt8(pos++, 0)
    view.setInt8(pos++, 0)
    view.setInt8(pos++, 0)
    view.setInt8(pos++, 8)
    view.setInt8(pos++, -2)
    view.setInt8(pos++, 0)
    view.setInt8(pos++, 0)

    view.setUint8(pos++, s.ppemX)
    view.setUint8(pos++, s.ppemY)
    view.setUint8(pos++, s.substitutePpemX)
    view.setUint8(pos++, s.substitutePpemY)
  }

  return buf
}

describe('EBSC table parser', () => {
  // Verifies that every BitmapScale record's ppem and substitute-ppem fields are read in order.
  it('should parse strike entries', () => {
    const buf = buildEbscTable([
      { ppemX: 16, ppemY: 16, substitutePpemX: 12, substitutePpemY: 12 },
      { ppemX: 20, ppemY: 20, substitutePpemX: 17, substitutePpemY: 17 },
    ])

    const table = parseEbsc(new BinaryReader(buf))
    expect(table.strikes).toHaveLength(2)
    expect(table.strikes[0]!.ppemX).toBe(16)
    expect(table.strikes[0]!.ppemY).toBe(16)
    expect(table.strikes[0]!.substitutePpemX).toBe(12)
    expect(table.strikes[1]!.ppemX).toBe(20)
  })

  // Verifies that getSubstitutePpem matches a strike by exact ppemX/ppemY and returns its substitute sizes.
  it('should find substitute ppem', () => {
    const buf = buildEbscTable([
      { ppemX: 16, ppemY: 16, substitutePpemX: 12, substitutePpemY: 12 },
    ])

    const table = parseEbsc(new BinaryReader(buf))
    const sub = table.getSubstitutePpem(16, 16)
    expect(sub).not.toBeNull()
    expect(sub!.substitutePpemX).toBe(12)
    expect(sub!.substitutePpemY).toBe(12)
  })

  // Verifies that a ppem size with no BitmapScale record returns null (no scaling substitution available).
  it('should return null for unknown ppem', () => {
    const buf = buildEbscTable([
      { ppemX: 16, ppemY: 16, substitutePpemX: 12, substitutePpemY: 12 },
    ])

    const table = parseEbsc(new BinaryReader(buf))
    expect(table.getSubstitutePpem(24, 24)).toBeNull()
  })

  // Verifies that the horizontal sbitLineMetrics block (ascender/descender/widthMax) is decoded per strike.
  it('should parse sbitLineMetrics', () => {
    const buf = buildEbscTable([
      { ppemX: 16, ppemY: 16, substitutePpemX: 12, substitutePpemY: 12 },
    ])

    const table = parseEbsc(new BinaryReader(buf))
    expect(table.strikes[0]!.hori.ascender).toBe(8)
    expect(table.strikes[0]!.hori.descender).toBe(-2)
    expect(table.strikes[0]!.hori.widthMax).toBe(10)
  })

  // Verifies that numSizes=0 parses to an empty strike list and lookups return null.
  it('should handle empty strikes', () => {
    const buf = buildEbscTable([])
    const table = parseEbsc(new BinaryReader(buf))
    expect(table.strikes).toHaveLength(0)
    expect(table.getSubstitutePpem(12, 12)).toBeNull()
  })
})
