import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseLcar } from '../../../src/parsers/tables/lcar.js'

/**
 * Build an lcar table with caret values for one ligature glyph.
 * Lookup format 6 values are offsets from the start of the lcar table.
 */
function buildLcar(format: number, glyphId: number, partials: number[]): ArrayBuffer {
  // header(6) + lookup format 6 single unit(16) + entry(2 + 2n)
  const entryOffset = 6 + 16
  const buf = new ArrayBuffer(entryOffset + 2 + partials.length * 2)
  const view = new DataView(buf)

  view.setUint32(0, 0x00010000)
  view.setUint16(4, format)

  view.setUint16(6, 6) // lookup format
  view.setUint16(8, 4) // unitSize
  view.setUint16(10, 1) // nUnits
  view.setUint16(18, glyphId)
  view.setUint16(20, entryOffset)

  view.setUint16(entryOffset, partials.length)
  for (let i = 0; i < partials.length; i++) {
    view.setInt16(entryOffset + 2 + i * 2, partials[i]!)
  }
  return buf
}

describe('lcar table parser', () => {
  it('should return caret distances (format 0)', () => {
    const buf = buildLcar(0, 20, [500, 1000])
    const table = parseLcar(new BinaryReader(buf))

    expect(table.format).toBe(0)
    expect(table.getCaretValues(20)).toEqual([500, 1000])
  })

  it('should return control point numbers (format 1)', () => {
    const buf = buildLcar(1, 20, [7])
    const table = parseLcar(new BinaryReader(buf))

    expect(table.format).toBe(1)
    expect(table.getCaretValues(20)).toEqual([7])
  })

  it('should return null for non-ligature glyphs', () => {
    const buf = buildLcar(0, 20, [500])
    const table = parseLcar(new BinaryReader(buf))

    expect(table.getCaretValues(21)).toBeNull()
  })

  it('should reject unsupported versions', () => {
    const buf = buildLcar(0, 20, [500])
    new DataView(buf).setUint32(0, 0x00020000)

    expect(() => parseLcar(new BinaryReader(buf))).toThrow(
      'Unsupported lcar table version: 0x00020000',
    )
  })

  it('should reject unsupported formats', () => {
    const buf = buildLcar(2, 20, [500])

    expect(() => parseLcar(new BinaryReader(buf))).toThrow('Unsupported lcar format: 2')
  })

  it('should reject caret entry offsets that overlap the header', () => {
    const buf = buildLcar(0, 20, [500])
    new DataView(buf).setUint16(20, 4)

    expect(() => parseLcar(new BinaryReader(buf))).toThrow(
      'lcar caret entry offset overlaps lcar header: 4',
    )
  })

  it('should reject truncated caret value arrays', () => {
    const buf = buildLcar(0, 20, [500])
    const view = new DataView(buf)
    view.setUint16(22, 2)

    expect(() => parseLcar(new BinaryReader(buf))).toThrow(
      'lcar glyph 20 caret values exceeds lcar table length',
    )
  })
})
