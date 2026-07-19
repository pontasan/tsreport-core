import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseAnkr } from '../../../src/parsers/tables/ankr.js'

/**
 * Build an ankr table with anchor points for two glyphs.
 * Uses an AAT lookup format 6 (single units).
 */
function buildAnkr(entries: { glyphId: number, points: { x: number, y: number }[] }[]): ArrayBuffer {
  // Header (12) + lookup format 6 (2 + 10 + 4 * n) + glyph data
  const lookupSize = 12 + entries.length * 4
  const glyphDataOffset = 12 + lookupSize

  let glyphDataSize = 0
  const dataOffsets: number[] = []
  for (const e of entries) {
    dataOffsets.push(glyphDataSize)
    glyphDataSize += 4 + e.points.length * 4
  }

  const buf = new ArrayBuffer(glyphDataOffset + glyphDataSize)
  const view = new DataView(buf)

  view.setUint16(0, 0) // version
  view.setUint16(2, 0) // flags
  view.setUint32(4, 12) // lookupTableOffset
  view.setUint32(8, glyphDataOffset)

  // Lookup format 6
  view.setUint16(12, 6)
  view.setUint16(14, 4) // unitSize
  view.setUint16(16, entries.length) // nUnits
  let pos = 24
  for (let i = 0; i < entries.length; i++) {
    view.setUint16(pos, entries[i]!.glyphId); pos += 2
    view.setUint16(pos, dataOffsets[i]!); pos += 2
  }

  // Glyph data table
  pos = glyphDataOffset
  for (const e of entries) {
    view.setUint32(pos, e.points.length); pos += 4
    for (const p of e.points) {
      view.setInt16(pos, p.x); pos += 2
      view.setInt16(pos, p.y); pos += 2
    }
  }

  return buf
}

describe('ankr table parser', () => {
  it('should return anchor points for covered glyphs', () => {
    const buf = buildAnkr([
      { glyphId: 5, points: [{ x: 100, y: -50 }, { x: 200, y: 300 }] },
      { glyphId: 7, points: [{ x: 10, y: 20 }] },
    ])
    const table = parseAnkr(new BinaryReader(buf))

    expect(table.version).toBe(0)
    expect(table.getAnchorPoints(5)).toEqual([{ x: 100, y: -50 }, { x: 200, y: 300 }])
    expect(table.getAnchorPoints(7)).toEqual([{ x: 10, y: 20 }])
  })

  it('should return null for glyphs without anchor points', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [{ x: 1, y: 2 }] }])
    const table = parseAnkr(new BinaryReader(buf))

    expect(table.getAnchorPoints(6)).toBeNull()
  })

  it('should reject unsupported versions', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [{ x: 1, y: 2 }] }])
    new DataView(buf).setUint16(0, 1)

    expect(() => parseAnkr(new BinaryReader(buf))).toThrow('Unsupported ankr table version: 1')
  })

  it('should reject non-zero flags', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [{ x: 1, y: 2 }] }])
    new DataView(buf).setUint16(2, 1)

    expect(() => parseAnkr(new BinaryReader(buf))).toThrow('ankr flags must be zero, got 1')
  })

  it('should reject lookup offsets other than the header size', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [{ x: 1, y: 2 }] }])
    new DataView(buf).setUint32(4, 16)

    expect(() => parseAnkr(new BinaryReader(buf))).toThrow('ankr lookupTableOffset must be 12, got 16')
  })

  it('should reject glyph data offsets that do not follow the lookup offset', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [{ x: 1, y: 2 }] }])
    new DataView(buf).setUint32(8, 12)

    expect(() => parseAnkr(new BinaryReader(buf))).toThrow(
      'ankr glyphDataTableOffset must follow lookupTableOffset',
    )
  })

  it('should reject unsupported lookup formats', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [{ x: 1, y: 2 }] }])
    new DataView(buf).setUint16(12, 10)

    expect(() => parseAnkr(new BinaryReader(buf))).toThrow('Unsupported ankr lookup format: 10')
  })

  it('should reject anchor entry offsets outside the glyph data table', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [{ x: 1, y: 2 }] }])
    const view = new DataView(buf)
    const glyphDataOffset = view.getUint32(8)
    view.setUint16(26, buf.byteLength - glyphDataOffset - 2)

    expect(() => parseAnkr(new BinaryReader(buf))).toThrow(
      'ankr glyph 5 anchor entry exceeds ankr table length',
    )
  })

  it('should reject glyph entries with zero anchor points', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [] }])

    expect(() => parseAnkr(new BinaryReader(buf))).toThrow(
      'ankr glyph 5 must not be included with zero anchor points',
    )
  })

  it('should reject truncated anchor point arrays', () => {
    const buf = buildAnkr([{ glyphId: 5, points: [{ x: 1, y: 2 }] }])
    const view = new DataView(buf)
    const glyphDataOffset = view.getUint32(8)
    view.setUint32(glyphDataOffset, 2)

    expect(() => parseAnkr(new BinaryReader(buf))).toThrow(
      'ankr glyph 5 anchor points exceeds ankr table length',
    )
  })
})
