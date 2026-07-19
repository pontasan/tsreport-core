import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseVdmx } from '../../../src/parsers/tables/vdmx.js'

/**
  * VDMX table build.
 */

function buildVdmxTable(
  ratioRanges: { bCharSet: number; xRatio: number; yStartRatio: number; yEndRatio: number }[],
  groups: { startsz: number; endsz: number; entries: { yPelHeight: number; yMax: number; yMin: number }[] }[],
  ratioToGroupIndex: number[],
  version = 1,
): ArrayBuffer {
  // Header: version(2) + numRecs(2) + numRatios(2) = 6
  // RatioRange: 4 bytes each
  // Offsets: uint16 each
  const numRatios = ratioRanges.length
  const headerSize = 6
  const ratioSize = numRatios * 4
  const offsetsSize = numRatios * 2
  const groupStart = headerSize + ratioSize + offsetsSize

  // Calculate group sizes
  const groupSizes = groups.map(g => 4 + g.entries.length * 6) // recs(2)+startsz(1)+endsz(1) + entry(6) each
  const groupOffsets: number[] = []
  let offset = groupStart
  for (const size of groupSizes) {
    groupOffsets.push(offset)
    offset += size
  }

  const totalSize = offset
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint16(pos, version); pos += 2
  view.setUint16(pos, groups.length); pos += 2 // numRecs
  view.setUint16(pos, numRatios); pos += 2

  // RatioRange records
  for (const r of ratioRanges) {
    view.setUint8(pos++, r.bCharSet)
    view.setUint8(pos++, r.xRatio)
    view.setUint8(pos++, r.yStartRatio)
    view.setUint8(pos++, r.yEndRatio)
  }

  // Offsets (ratio → group)
  for (let i = 0; i < numRatios; i++) {
    const gi = ratioToGroupIndex[i]!
    view.setUint16(pos, groupOffsets[gi]!); pos += 2
  }

  // Groups
  for (const g of groups) {
    view.setUint16(pos, g.entries.length); pos += 2
    view.setUint8(pos++, g.startsz)
    view.setUint8(pos++, g.endsz)
    for (const e of g.entries) {
      view.setUint16(pos, e.yPelHeight); pos += 2
      view.setInt16(pos, e.yMax); pos += 2
      view.setInt16(pos, e.yMin); pos += 2
    }
  }

  return buf
}

describe('VDMX table parser', () => {
  it('should parse synthetic VDMX table with catch-all ratio', () => {
    const buf = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{
        startsz: 8,
        endsz: 12,
        entries: [
          { yPelHeight: 8, yMax: 10, yMin: -3 },
          { yPelHeight: 9, yMax: 11, yMin: -3 },
          { yPelHeight: 10, yMax: 12, yMin: -4 },
          { yPelHeight: 11, yMax: 13, yMin: -4 },
          { yPelHeight: 12, yMax: 14, yMin: -5 },
        ],
      }],
      [0],
    )
    const reader = new BinaryReader(buf)
    const vdmx = parseVdmx(reader)

    expect(vdmx.version).toBe(1)
    expect(vdmx.ratioRanges).toHaveLength(1)
    expect(vdmx.groups).toHaveLength(1)
  })

  it('should find yBounds for matching ppem', () => {
    const buf = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{
        startsz: 8,
        endsz: 12,
        entries: [
          { yPelHeight: 8, yMax: 10, yMin: -3 },
          { yPelHeight: 10, yMax: 12, yMin: -4 },
          { yPelHeight: 12, yMax: 14, yMin: -5 },
        ],
      }],
      [0],
    )
    const reader = new BinaryReader(buf)
    const vdmx = parseVdmx(reader)

    expect(vdmx.getYBounds(8)).toEqual({ yMax: 10, yMin: -3 })
    expect(vdmx.getYBounds(10)).toEqual({ yMax: 12, yMin: -4 })
    expect(vdmx.getYBounds(12)).toEqual({ yMax: 14, yMin: -5 })
  })

  it('should return null for ppem outside range', () => {
    const buf = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{
        startsz: 8,
        endsz: 12,
        entries: [
          { yPelHeight: 8, yMax: 10, yMin: -3 },
          { yPelHeight: 12, yMax: 14, yMin: -5 },
        ],
      }],
      [0],
    )
    const reader = new BinaryReader(buf)
    const vdmx = parseVdmx(reader)

    expect(vdmx.getYBounds(7)).toBeNull()
    expect(vdmx.getYBounds(13)).toBeNull()
  })

  it('should return null for non-existent ppem within range', () => {
    const buf = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{
        startsz: 8,
        endsz: 12,
        entries: [
          { yPelHeight: 8, yMax: 10, yMin: -3 },
          { yPelHeight: 12, yMax: 14, yMin: -5 },
        ],
      }],
      [0],
    )
    const reader = new BinaryReader(buf)
    const vdmx = parseVdmx(reader)

    // Ppem=9.
    expect(vdmx.getYBounds(9)).toBeNull()
  })

  it('should match ratio ranges with specific xRatio/yRatio', () => {
    const buf = buildVdmxTable(
      [
        { bCharSet: 1, xRatio: 1, yStartRatio: 1, yEndRatio: 1 },
        { bCharSet: 1, xRatio: 2, yStartRatio: 1, yEndRatio: 2 },
      ],
      [
        { startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] },
        { startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 20, yMin: -6 }] },
      ],
      [0, 1],
    )
    const reader = new BinaryReader(buf)
    const vdmx = parseVdmx(reader)

    // xRatio=1, yRatio=1 → group 0
    expect(vdmx.getYBounds(8, 1, 1)).toEqual({ yMax: 10, yMin: -3 })
    // xRatio=2, yRatio=2 → group 1
    expect(vdmx.getYBounds(8, 2, 2)).toEqual({ yMax: 20, yMin: -6 })
  })

  it('selects version 0 groups using the requested character-set semantics', () => {
    const buf = buildVdmxTable(
      [
        { bCharSet: 0, xRatio: 1, yStartRatio: 1, yEndRatio: 1 },
        { bCharSet: 1, xRatio: 1, yStartRatio: 1, yEndRatio: 1 },
      ],
      [
        { startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 9, yMin: -2 }] },
        { startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 11, yMin: -3 }] },
      ],
      [0, 1],
      0,
    )
    const vdmx = parseVdmx(new BinaryReader(buf))

    expect(vdmx.getYBounds(8, 1, 1)).toEqual({ yMax: 11, yMin: -3 })
    expect(vdmx.getYBounds(8, 1, 1, 0)).toEqual({ yMax: 9, yMin: -2 })
    expect(vdmx.getYBounds(8, 1, 1, 1)).toEqual({ yMax: 11, yMin: -3 })
  })

  it('accepts version 1 all-glyph character-set value 0 when value 1 is absent', () => {
    const buf = buildVdmxTable(
      [{ bCharSet: 0, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -2 }] }],
      [0],
      1,
    )
    const vdmx = parseVdmx(new BinaryReader(buf))

    expect(vdmx.getYBounds(8)).toEqual({ yMax: 10, yMin: -2 })
    expect(vdmx.getYBounds(8, undefined, undefined, 0)).toEqual({ yMax: 10, yMin: -2 })
    expect(vdmx.getYBounds(8, undefined, undefined, 1)).toBeNull()
  })

  it('should handle multiple ratios pointing to same group', () => {
    const buf = buildVdmxTable(
      [
        { bCharSet: 1, xRatio: 1, yStartRatio: 1, yEndRatio: 1 },
        { bCharSet: 1, xRatio: 2, yStartRatio: 1, yEndRatio: 2 },
      ],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] }],
      [0, 0], // both ratio ranges point to same group
    )
    const reader = new BinaryReader(buf)
    const vdmx = parseVdmx(reader)

    expect(vdmx.getYBounds(8, 1, 1)).toEqual({ yMax: 10, yMin: -3 })
    expect(vdmx.getYBounds(8, 2, 2)).toEqual({ yMax: 10, yMin: -3 })
  })

  it('should read a future compatible version using version 1 selection semantics', () => {
    const buf = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] }],
      [0],
      2,
    )

    expect(parseVdmx(new BinaryReader(buf)).getYBounds(8)).toEqual({ yMax: 10, yMin: -3 })
  })

  it('should reject missing groups or ratio ranges', () => {
    const noGroups = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] }],
      [0],
    )
    new DataView(noGroups).setUint16(2, 0)

    const noRatios = new ArrayBuffer(6)
    const noRatiosView = new DataView(noRatios)
    noRatiosView.setUint16(0, 1)
    noRatiosView.setUint16(2, 1)
    noRatiosView.setUint16(4, 0)

    expect(() => parseVdmx(new BinaryReader(noGroups))).toThrow(/at least one group/)
    expect(() => parseVdmx(new BinaryReader(noRatios))).toThrow(/at least one ratio range/)
  })

  it('should reject malformed ratio ranges', () => {
    const defaultNotLast = buildVdmxTable(
      [
        { bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 },
        { bCharSet: 1, xRatio: 1, yStartRatio: 1, yEndRatio: 1 },
      ],
      [
        { startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] },
        { startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 12, yMin: -4 }] },
      ],
      [0, 1],
    )
    const partialZero = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 1, yEndRatio: 1 }],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] }],
      [0],
    )
    const invertedRatio = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 2, yStartRatio: 3, yEndRatio: 1 }],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] }],
      [0],
    )
    const invalidCharset = buildVdmxTable(
      [{ bCharSet: 2, xRatio: 1, yStartRatio: 1, yEndRatio: 1 }],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] }],
      [0],
    )

    expect(() => parseVdmx(new BinaryReader(defaultNotLast))).toThrow(/default ratio group/)
    expect(() => parseVdmx(new BinaryReader(partialZero))).toThrow(/all-zero/)
    expect(() => parseVdmx(new BinaryReader(invertedRatio))).toThrow(/yStartRatio/)
    expect(() => parseVdmx(new BinaryReader(invalidCharset))).toThrow(/character set/)
  })

  it('should reject invalid group offsets and numRecs mismatches', () => {
    const outOfRange = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] }],
      [0],
    )
    new DataView(outOfRange).setUint16(10, outOfRange.byteLength)

    const mismatch = buildVdmxTable(
      [
        { bCharSet: 1, xRatio: 1, yStartRatio: 1, yEndRatio: 1 },
        { bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 },
      ],
      [
        { startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] },
        { startsz: 9, endsz: 9, entries: [{ yPelHeight: 9, yMax: 12, yMin: -4 }] },
      ],
      [0, 0],
    )

    expect(() => parseVdmx(new BinaryReader(outOfRange))).toThrow(/group offset/)
    expect(() => parseVdmx(new BinaryReader(mismatch))).toThrow(/numRecs mismatch/)
  })

  it('should reject malformed VDMX groups', () => {
    const emptyGroup = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{ startsz: 8, endsz: 8, entries: [] }],
      [0],
    )
    const invertedSize = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{ startsz: 9, endsz: 8, entries: [{ yPelHeight: 8, yMax: 10, yMin: -3 }] }],
      [0],
    )
    const unsorted = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{
        startsz: 8,
        endsz: 12,
        entries: [
          { yPelHeight: 12, yMax: 14, yMin: -5 },
          { yPelHeight: 8, yMax: 10, yMin: -3 },
        ],
      }],
      [0],
    )
    const outsideRange = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{ startsz: 8, endsz: 10, entries: [{ yPelHeight: 12, yMax: 14, yMin: -5 }] }],
      [0],
    )
    const invertedBounds = buildVdmxTable(
      [{ bCharSet: 1, xRatio: 0, yStartRatio: 0, yEndRatio: 0 }],
      [{ startsz: 8, endsz: 8, entries: [{ yPelHeight: 8, yMax: -4, yMin: 10 }] }],
      [0],
    )

    expect(() => parseVdmx(new BinaryReader(emptyGroup))).toThrow(/at least one record/)
    expect(() => parseVdmx(new BinaryReader(invertedSize))).toThrow(/startsz/)
    expect(() => parseVdmx(new BinaryReader(unsorted))).toThrow(/sorted/)
    expect(() => parseVdmx(new BinaryReader(outsideRange))).toThrow(/outside/)
    expect(() => parseVdmx(new BinaryReader(invertedBounds))).toThrow(/yMax/)
  })
})
