import { describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'
import { buildTable, buildTestFont, encodeSimpleGlyph } from './renderer/synthetic-font.js'

const SQUARE: [number, number][] = [[100, 100], [300, 100], [300, 300], [100, 300]]

function hdmx(records: Array<{ ppem: number; widths: number[] }>): Uint8Array {
  const recordSize = (2 + records[0]!.widths.length + 3) & ~3
  return buildTable(function build(w) {
    w.writeUint16(0)
    w.writeUint16(records.length)
    w.writeUint32(recordSize)
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      w.writeUint8(record.ppem)
      w.writeUint8(Math.max(...record.widths))
      for (let j = 0; j < record.widths.length; j++) w.writeUint8(record.widths[j]!)
      for (let j = 2 + record.widths.length; j < recordSize; j++) w.writeUint8(0)
    }
  })
}

function ltsh(thresholds: number[]): Uint8Array {
  return buildTable(function build(w) {
    w.writeUint16(0)
    w.writeUint16(thresholds.length)
    for (let i = 0; i < thresholds.length; i++) w.writeUint8(thresholds[i]!)
  })
}

function gasp(behavior: number): Uint8Array {
  return buildTable(function build(w) {
    w.writeUint16(1)
    w.writeUint16(1)
    w.writeUint16(0xFFFF)
    w.writeUint16(behavior)
  })
}

function vdmx(ppem: number, yMax: number, yMin: number): Uint8Array {
  return buildTable(function build(w) {
    w.writeUint16(1)
    w.writeUint16(1)
    w.writeUint16(1)
    w.writeUint8(1)
    w.writeUint8(0)
    w.writeUint8(0)
    w.writeUint8(0)
    w.writeUint16(12)
    w.writeUint16(1)
    w.writeUint8(ppem)
    w.writeUint8(ppem)
    w.writeUint16(ppem)
    w.writeInt16(yMax)
    w.writeInt16(yMin)
  })
}

function loadDeviceFont(gaspBehavior = 0x0003): Font {
  return Font.load(buildTestFont(
    [null, encodeSimpleGlyph(SQUARE, [3])],
    [[0x41, 1]],
    [
      ['LTSH', ltsh([1, 20])],
      ['VDMX', vdmx(12, 11, -4)],
      ['gasp', gasp(gaspBehavior)],
      ['hdmx', hdmx([
        { ppem: 12, widths: [0, 9] },
        { ppem: 16, widths: [0, 11] },
      ])],
    ],
    0x0010,
  ))
}

describe('shared OpenType device metrics model', () => {
  it('selects hdmx by horizontal ppem, LTSH by vertical ppem, VDMX bounds, and gasp policy', () => {
    const font = loadDeviceFont()
    const metrics = font.getDeviceMetrics(1, 16, 12)
    expect(metrics).toEqual({
      xPpem: 16,
      yPpem: 12,
      advanceWidthPixels: 11,
      advanceSource: 'hdmx',
      linearAdvance: false,
      verticalBounds: { yMax: 11, yMin: -4 },
      verticalBoundsSource: 'VDMX',
      gaspBehavior: 3,
      gridFit: true,
      grayscale: true,
      symmetricGridFit: false,
      symmetricSmoothing: false,
    })
  })

  it('uses rounded linear metrics at and above the LTSH threshold', () => {
    const font = loadDeviceFont()
    const metrics = font.getDeviceMetrics(1, 24, 24)
    expect(metrics.advanceSource).toBe('linear')
    expect(metrics.linearAdvance).toBe(true)
    expect(metrics.advanceWidthPixels).toBe(14)
    expect(metrics.verticalBoundsSource).toBe('scaled')
    expect(metrics.verticalBounds).toEqual({ yMax: 20, yMin: -5 })
  })

  it('does not use instructed hdmx or VDMX values when gasp disables grid fitting', () => {
    const font = loadDeviceFont(0x0002)
    const metrics = font.getDeviceMetrics(1, 12, 12)
    expect(metrics.gridFit).toBe(false)
    expect(metrics.advanceSource).toBe('linear')
    expect(metrics.advanceWidthPixels).toBe(7)
    expect(metrics.verticalBoundsSource).toBe('scaled')
  })

  it('rejects non-integer device sizes and excludes VDMX from variable fonts', () => {
    const font = loadDeviceFont()
    expect(() => font.getDeviceMetrics(1, 12.5)).toThrow(/positive integers/)
    const manager = (font as unknown as { tableManager: object }).tableManager
    Object.defineProperty(manager, 'fvar', { value: { axes: [] }, configurable: true })
    expect(font.getDeviceMetrics(1, 12).verticalBoundsSource).toBe('scaled')
  })

  it('remaps hdmx and LTSH while retaining gasp and VDMX in compact subsets', () => {
    const outline = encodeSimpleGlyph(SQUARE, [3])
    const source = Font.load(buildTestFont(
      [null, outline, outline],
      [[0x41, 1], [0x42, 2]],
      [
        ['LTSH', ltsh([1, 20, 30])],
        ['VDMX', vdmx(12, 11, -4)],
        ['gasp', gasp(0x0003)],
        ['hdmx', hdmx([{ ppem: 12, widths: [0, 9, 13] }])],
      ],
      0x0010,
    ))
    const result = source.subsetWithMapping('B')
    const glyphId = result.oldToNewGlyphId.get(2)!
    const subset = Font.load(result.buffer)
    expect(glyphId).toBe(1)
    const manager = (subset as unknown as { tableManager: { ltsh: { getLinearThreshold(glyphId: number): number } } }).tableManager
    expect(manager.ltsh.getLinearThreshold(glyphId)).toBe(30)
    expect(subset.getDeviceMetrics(glyphId, 12)).toMatchObject({
      advanceWidthPixels: 13,
      advanceSource: 'hdmx',
      verticalBounds: { yMax: 11, yMin: -4 },
      verticalBoundsSource: 'VDMX',
      gaspBehavior: 3,
    })
  })
})
