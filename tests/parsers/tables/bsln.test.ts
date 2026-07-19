import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseBsln } from '../../../src/parsers/tables/bsln.js'

function writeHeader(view: DataView, format: number, defaultBaseline: number): void {
  view.setUint32(0, 0x00010000)
  view.setUint16(4, format)
  view.setUint16(6, defaultBaseline)
}

/** Lookup format 6 with a single (glyph, value) unit at the given offset */
function writeLookupSingle(view: DataView, offset: number, glyph: number, value: number): void {
  view.setUint16(offset, 6)
  view.setUint16(offset + 2, 4)
  view.setUint16(offset + 4, 1)
  view.setUint16(offset + 12, glyph)
  view.setUint16(offset + 14, value)
}

describe('bsln table parser', () => {
  it('should parse format 0 (distance, no mapping)', () => {
    const buf = new ArrayBuffer(72)
    const view = new DataView(buf)
    writeHeader(view, 0, 1)
    view.setInt16(8, 0) // delta[0] Roman
    view.setInt16(10, 855) // delta[1] Ideographic centered
    view.setInt16(14, 1520) // delta[3] Hanging

    const table = parseBsln(new BinaryReader(buf))
    expect(table.format).toBe(0)
    expect(table.defaultBaseline).toBe(1)
    expect(table.deltas![0]).toBe(0)
    expect(table.deltas![1]).toBe(855)
    expect(table.deltas![3]).toBe(1520)
    expect(table.stdGlyph).toBeNull()
    expect(table.getBaselineClass(42)).toBe(1) // always the default
  })

  it('should parse format 1 (distance, with mapping)', () => {
    const buf = new ArrayBuffer(72 + 16)
    const view = new DataView(buf)
    writeHeader(view, 1, 1)
    view.setInt16(10, 855)
    writeLookupSingle(view, 72, 3, 0) // glyph 3 -> Roman baseline

    const table = parseBsln(new BinaryReader(buf))
    expect(table.format).toBe(1)
    expect(table.deltas![1]).toBe(855)
    expect(table.getBaselineClass(3)).toBe(0)
    expect(table.getBaselineClass(99)).toBe(1) // default
  })

  it('should parse format 2 (control point, no mapping)', () => {
    const buf = new ArrayBuffer(74)
    const view = new DataView(buf)
    writeHeader(view, 2, 0)
    view.setUint16(8, 33) // stdGlyph
    for (let i = 0; i < 32; i++) view.setUint16(10 + i * 2, 0xFFFF)
    view.setUint16(10, 4) // ctlPoints[0]
    view.setUint16(12, 9) // ctlPoints[1]

    const table = parseBsln(new BinaryReader(buf))
    expect(table.format).toBe(2)
    expect(table.stdGlyph).toBe(33)
    expect(table.ctlPoints![0]).toBe(4)
    expect(table.ctlPoints![1]).toBe(9)
    expect(table.ctlPoints![2]).toBe(0xFFFF)
    expect(table.deltas).toBeNull()
    expect(table.getBaselineClass(7)).toBe(0)
  })

  it('should parse format 3 (control point, with mapping)', () => {
    const buf = new ArrayBuffer(74 + 16)
    const view = new DataView(buf)
    writeHeader(view, 3, 0)
    view.setUint16(8, 33)
    view.setUint16(10, 4)
    writeLookupSingle(view, 74, 5, 3) // glyph 5 -> hanging baseline

    const table = parseBsln(new BinaryReader(buf))
    expect(table.format).toBe(3)
    expect(table.stdGlyph).toBe(33)
    expect(table.getBaselineClass(5)).toBe(3)
    expect(table.getBaselineClass(6)).toBe(0)
  })

  it('should reject unknown formats', () => {
    const buf = new ArrayBuffer(72)
    const view = new DataView(buf)
    writeHeader(view, 9, 0)

    expect(() => parseBsln(new BinaryReader(buf))).toThrow('Unsupported bsln format: 9')
  })

  it('should reject unsupported versions', () => {
    const buf = new ArrayBuffer(72)
    const view = new DataView(buf)
    writeHeader(view, 0, 0)
    view.setUint32(0, 0x00020000)

    expect(() => parseBsln(new BinaryReader(buf))).toThrow(
      'Unsupported bsln table version: 0x00020000',
    )
  })

  it('should reject default baseline values outside 0..31', () => {
    const buf = new ArrayBuffer(72)
    const view = new DataView(buf)
    writeHeader(view, 0, 32)

    expect(() => parseBsln(new BinaryReader(buf))).toThrow(
      'bsln defaultBaseline must be in the range 0..31, got 32',
    )
  })

  it('should reject truncated distance baseline arrays', () => {
    const buf = new ArrayBuffer(71)
    const view = new DataView(buf)
    writeHeader(view, 0, 0)

    expect(() => parseBsln(new BinaryReader(buf))).toThrow(
      'bsln distance baseline deltas exceeds bsln table length',
    )
  })

  it('should reject truncated control point data', () => {
    const buf = new ArrayBuffer(73)
    const view = new DataView(buf)
    writeHeader(view, 2, 0)

    expect(() => parseBsln(new BinaryReader(buf))).toThrow(
      'bsln control point data exceeds bsln table length',
    )
  })

  it('should reject standard glyphs outside numGlyphs', () => {
    const buf = new ArrayBuffer(74)
    const view = new DataView(buf)
    writeHeader(view, 2, 0)
    view.setUint16(8, 33)

    expect(() => parseBsln(new BinaryReader(buf), 33)).toThrow(
      'bsln stdGlyph 33 exceeds numGlyphs 33',
    )
  })

  it('should reject mapped baseline values outside 0..31', () => {
    const buf = new ArrayBuffer(72 + 16)
    const view = new DataView(buf)
    writeHeader(view, 1, 0)
    writeLookupSingle(view, 72, 3, 32)

    expect(() => parseBsln(new BinaryReader(buf))).toThrow(
      'bsln glyph 3 baseline value must be in the range 0..31, got 32',
    )
  })
})
