import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseOpbd } from '../../../src/parsers/tables/opbd.js'

/**
  * Opbd table build (format 0, AAT Lookup format 6)
 */

function buildOpbdTable(
  format: number,
  entries: { glyphId: number, left: number, top: number, right: number, bottom: number }[],
): ArrayBuffer {
  // Header: version(4=Fixed) + format(2) = 6
  // Lookup table (format 6): format(2) + unitSize(2) + nUnits(2) + searchRange(2) + entrySelector(2) + rangeShift(2) + entries(4 each) + sentinel(4)
  // Bounds data: 8 bytes each (4 Int16)

  const lookupHeaderSize = 12 // format(2) + unitSize(2) + nUnits(2) + search fields(6)
  const lookupEntrySize = 4 // glyph(2) + value(2)
  const boundsSize = 8 // 4 × Int16

  const headerSize = 6
  const lookupSize = lookupHeaderSize + (entries.length + 1) * lookupEntrySize // +1 for sentinel
  const boundsDataSize = entries.length * boundsSize

  const boundsDataStart = headerSize + lookupSize

  const totalSize = headerSize + lookupSize + boundsDataSize
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint32(pos, 0x00010000); pos += 4 // version 1.0
  view.setUint16(pos, format); pos += 2

  // Lookup table (format 6: single table)
  view.setUint16(pos, 6); pos += 2 // format 6
  view.setUint16(pos, 4); pos += 2 // unitSize
  view.setUint16(pos, entries.length); pos += 2 // nUnits
  view.setUint16(pos, 0); pos += 2 // searchRange
  view.setUint16(pos, 0); pos += 2 // entrySelector
  view.setUint16(pos, 0); pos += 2 // rangeShift

  for (let i = 0; i < entries.length; i++) {
    view.setUint16(pos, entries[i]!.glyphId); pos += 2
    view.setUint16(pos, boundsDataStart + i * boundsSize); pos += 2 // offset to bounds
  }
  // Sentinel
  view.setUint16(pos, 0xFFFF); pos += 2
  view.setUint16(pos, 0); pos += 2

  // Bounds data
  for (const e of entries) {
    view.setInt16(pos, e.left); pos += 2
    view.setInt16(pos, e.top); pos += 2
    view.setInt16(pos, e.right); pos += 2
    view.setInt16(pos, e.bottom); pos += 2
  }

  return buf
}

describe('opbd table parser', () => {
  it('should parse format 0 (distance values)', () => {
    const buf = buildOpbdTable(0, [
      { glyphId: 10, left: -20, top: 5, right: 15, bottom: -10 },
    ])

    const table = parseOpbd(new BinaryReader(buf))
    expect(table.version).toBe(1)
    expect(table.format).toBe(0)

    const bounds = table.getOpticalBounds(10)
    expect(bounds).not.toBeNull()
    expect(bounds!.left).toBe(-20)
    expect(bounds!.top).toBe(5)
    expect(bounds!.right).toBe(15)
    expect(bounds!.bottom).toBe(-10)
  })

  it('should return null for unknown glyph', () => {
    const buf = buildOpbdTable(0, [
      { glyphId: 10, left: -20, top: 5, right: 15, bottom: -10 },
    ])

    const table = parseOpbd(new BinaryReader(buf))
    expect(table.getOpticalBounds(99)).toBeNull()
  })

  it('should parse multiple glyphs', () => {
    const buf = buildOpbdTable(0, [
      { glyphId: 5, left: -10, top: 0, right: 10, bottom: 0 },
      { glyphId: 10, left: -20, top: 5, right: 15, bottom: -5 },
      { glyphId: 20, left: 0, top: 0, right: 0, bottom: 0 },
    ])

    const table = parseOpbd(new BinaryReader(buf))
    expect(table.getOpticalBounds(5)!.left).toBe(-10)
    expect(table.getOpticalBounds(10)!.right).toBe(15)
    expect(table.getOpticalBounds(20)!.left).toBe(0)
  })

  it('should parse format 1 (control point values)', () => {
    const buf = buildOpbdTable(1, [
      { glyphId: 15, left: 0, top: 1, right: 2, bottom: 3 },
    ])

    const table = parseOpbd(new BinaryReader(buf))
    expect(table.format).toBe(1)

    const bounds = table.getOpticalBounds(15)
    expect(bounds).not.toBeNull()
    expect(bounds!.left).toBe(0)
    expect(bounds!.top).toBe(1)
    expect(bounds!.right).toBe(2)
    expect(bounds!.bottom).toBe(3)
  })

  it('should handle empty table', () => {
    const buf = buildOpbdTable(0, [])
    const table = parseOpbd(new BinaryReader(buf))
    expect(table.getOpticalBounds(0)).toBeNull()
  })

  it('should reject unsupported versions', () => {
    const buf = buildOpbdTable(0, [
      { glyphId: 10, left: -20, top: 5, right: 15, bottom: -10 },
    ])
    new DataView(buf).setUint32(0, 0x00020000)

    expect(() => parseOpbd(new BinaryReader(buf))).toThrow(
      'Unsupported opbd table version: 0x00020000',
    )
  })

  it('should reject unsupported formats', () => {
    const buf = buildOpbdTable(2, [
      { glyphId: 10, left: -20, top: 5, right: 15, bottom: -10 },
    ])

    expect(() => parseOpbd(new BinaryReader(buf))).toThrow('Unsupported opbd format: 2')
  })

  it('should reject bounds offsets that overlap the header', () => {
    const buf = buildOpbdTable(0, [
      { glyphId: 10, left: -20, top: 5, right: 15, bottom: -10 },
    ])
    new DataView(buf).setUint16(20, 4)

    expect(() => parseOpbd(new BinaryReader(buf))).toThrow(
      'opbd glyph 10 bounds offset overlaps opbd header: 4',
    )
  })

  it('should reject truncated bounds records', () => {
    const buf = buildOpbdTable(0, [
      { glyphId: 10, left: -20, top: 5, right: 15, bottom: -10 },
    ]).slice(0, -1)

    expect(() => parseOpbd(new BinaryReader(buf))).toThrow(
      'opbd glyph 10 bounds exceeds opbd table length',
    )
  })
})
