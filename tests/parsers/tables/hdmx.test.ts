import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseHdmx } from '../../../src/parsers/tables/hdmx.js'

/**
 * Builds a synthetic hdmx table binary.
 */
function buildHdmxTable(
  numGlyphs: number,
  records: { pixelSize: number; maxWidth: number; widths: number[] }[],
  options: { version?: number; sizeDeviceRecord?: number } = {},
): ArrayBuffer {
  // sizeDeviceRecord = 2 (pixelSize + maxWidth) + numGlyphs, padded to 4-byte boundary
  const rawRecordSize = 2 + numGlyphs
  const sizeDeviceRecord = options.sizeDeviceRecord ?? ((rawRecordSize + 3) & ~3) // align to 4

  // Header: version(2) + numRecords(2) + sizeDeviceRecord(4) = 8
  const buf = new ArrayBuffer(8 + sizeDeviceRecord * records.length)
  const view = new DataView(buf)
  let pos = 0

  view.setUint16(pos, options.version ?? 0); pos += 2
  view.setInt16(pos, records.length); pos += 2
  view.setInt32(pos, sizeDeviceRecord); pos += 4

  for (const r of records) {
    const recordStart = pos
    view.setUint8(pos++, r.pixelSize)
    view.setUint8(pos++, r.maxWidth)
    for (let i = 0; i < numGlyphs; i++) {
      view.setUint8(pos++, r.widths[i] ?? 0)
    }
    // Pad to sizeDeviceRecord
    pos = recordStart + sizeDeviceRecord
  }

  return buf
}

describe('hdmx table parser', () => {
  // Verifies that device records for multiple ppem sizes are parsed and per-glyph widths are retrievable.
  it('should parse synthetic hdmx table', () => {
    const numGlyphs = 3
    const buf = buildHdmxTable(numGlyphs, [
      { pixelSize: 9, maxWidth: 12, widths: [5, 8, 12] },
      { pixelSize: 12, maxWidth: 16, widths: [7, 10, 16] },
    ])
    const reader = new BinaryReader(buf)
    const hdmx = parseHdmx(reader, numGlyphs)

    expect(hdmx.availablePpems).toEqual([9, 12])
    expect(hdmx.getWidth(9, 0)).toBe(5)
    expect(hdmx.getWidth(9, 1)).toBe(8)
    expect(hdmx.getWidth(9, 2)).toBe(12)
    expect(hdmx.getWidth(12, 0)).toBe(7)
    expect(hdmx.getWidth(12, 2)).toBe(16)
  })

  // Verifies that getWidth returns null when the requested ppem has no device record.
  it('should return null for unavailable ppem', () => {
    const numGlyphs = 2
    const buf = buildHdmxTable(numGlyphs, [
      { pixelSize: 9, maxWidth: 10, widths: [5, 10] },
    ])
    const reader = new BinaryReader(buf)
    const hdmx = parseHdmx(reader, numGlyphs)

    expect(hdmx.getWidth(10, 0)).toBeNull()
  })

  // Verifies that getWidth returns null for negative or >= numGlyphs glyph IDs instead of reading out of bounds.
  it('should return null for out-of-range glyphId', () => {
    const numGlyphs = 2
    const buf = buildHdmxTable(numGlyphs, [
      { pixelSize: 9, maxWidth: 10, widths: [5, 10] },
    ])
    const reader = new BinaryReader(buf)
    const hdmx = parseHdmx(reader, numGlyphs)

    expect(hdmx.getWidth(9, -1)).toBeNull()
    expect(hdmx.getWidth(9, 2)).toBeNull()
  })

  // Verifies that a table with zero device records yields no ppems and null widths.
  it('should handle empty records', () => {
    const numGlyphs = 2
    const buf = buildHdmxTable(numGlyphs, [])
    const reader = new BinaryReader(buf)
    const hdmx = parseHdmx(reader, numGlyphs)

    expect(hdmx.availablePpems).toEqual([])
    expect(hdmx.getWidth(9, 0)).toBeNull()
  })

  // Verifies that a future compatible version uses the known record prefix.
  it('should read a future compatible version', () => {
    const buf = buildHdmxTable(1, [{ pixelSize: 9, maxWidth: 5, widths: [5] }], { version: 1 })

    expect(parseHdmx(new BinaryReader(buf), 1).getWidth(9, 0)).toBe(5)
  })

  // Verifies that the device record size must hold the record payload and be 32-bit aligned.
  it('should reject invalid device record sizes', () => {
    const tooSmall = buildHdmxTable(3, [{ pixelSize: 9, maxWidth: 5, widths: [5, 4, 3] }])
    new DataView(tooSmall).setUint32(4, 4)
    const unaligned = buildHdmxTable(3, [{ pixelSize: 9, maxWidth: 5, widths: [5, 4, 3] }], { sizeDeviceRecord: 5 })

    expect(() => parseHdmx(new BinaryReader(tooSmall), 3)).toThrow(/device record size/)
    expect(() => parseHdmx(new BinaryReader(unaligned), 3)).toThrow(/32-bit aligned/)
  })

  // Verifies that the table length must exactly match the declared record count and record size.
  it('should reject malformed table lengths', () => {
    const buf = buildHdmxTable(1, [{ pixelSize: 9, maxWidth: 5, widths: [5] }])
    const truncated = buf.slice(0, buf.byteLength - 1)
    const padded = new ArrayBuffer(buf.byteLength + 4)
    new Uint8Array(padded).set(new Uint8Array(buf))

    expect(() => parseHdmx(new BinaryReader(truncated), 1)).toThrow(/length mismatch/)
    expect(() => parseHdmx(new BinaryReader(padded), 1)).toThrow(/length mismatch/)
  })

  // Verifies that device records are sorted by increasing ppem pixelSize.
  it('should reject unsorted or duplicate pixel sizes', () => {
    const unsorted = buildHdmxTable(1, [
      { pixelSize: 12, maxWidth: 5, widths: [5] },
      { pixelSize: 9, maxWidth: 4, widths: [4] },
    ])
    const duplicate = buildHdmxTable(1, [
      { pixelSize: 9, maxWidth: 5, widths: [5] },
      { pixelSize: 9, maxWidth: 4, widths: [4] },
    ])

    expect(() => parseHdmx(new BinaryReader(unsorted), 1)).toThrow(/sorted/)
    expect(() => parseHdmx(new BinaryReader(duplicate), 1)).toThrow(/sorted/)
  })

  // Verifies that the declared maxWidth matches the largest width in the record.
  it('should reject maxWidth values inconsistent with widths', () => {
    const buf = buildHdmxTable(3, [{ pixelSize: 9, maxWidth: 4, widths: [2, 4, 8] }])

    expect(() => parseHdmx(new BinaryReader(buf), 3)).toThrow(/maxWidth mismatch/)
  })

  // Verifies that the parser refuses an invalid maxp glyph count.
  it('should reject non-positive numGlyphs', () => {
    const buf = buildHdmxTable(0, [])

    expect(() => parseHdmx(new BinaryReader(buf), 0)).toThrow(/numGlyphs/)
  })
})
