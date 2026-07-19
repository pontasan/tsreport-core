import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseColr } from '../../../src/parsers/tables/colr.js'
import { parseCpal } from '../../../src/parsers/tables/cpal.js'
import { Font } from '../../../src/font.js'
import { buildTestFont, encodeSimpleGlyph } from '../../renderer/synthetic-font.js'

/**
 * Build a synthetic COLR v0 table
 */
function buildColrV0(
  baseGlyphs: { glyphId: number; firstLayerIndex: number; numLayers: number }[],
  layers: { glyphId: number; paletteIndex: number }[],
): ArrayBuffer {
  // Header: version(2) + numBaseGlyphRecords(2) + baseGlyphRecordsOffset(4)
  //        + layerRecordsOffset(4) + numLayerRecords(2) = 14
  const headerSize = 14
  const baseGlyphsSize = baseGlyphs.length * 6 // glyphId(2) + firstLayerIndex(2) + numLayers(2)
  const layersSize = layers.length * 4 // glyphId(2) + paletteIndex(2)

  const baseGlyphRecordsOffset = headerSize
  const layerRecordsOffset = baseGlyphRecordsOffset + baseGlyphsSize

  const buf = new ArrayBuffer(headerSize + baseGlyphsSize + layersSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint16(pos, 0); pos += 2 // version 0
  view.setUint16(pos, baseGlyphs.length); pos += 2
  view.setUint32(pos, baseGlyphRecordsOffset); pos += 4
  view.setUint32(pos, layerRecordsOffset); pos += 4
  view.setUint16(pos, layers.length); pos += 2

  // BaseGlyphRecords
  for (const bg of baseGlyphs) {
    view.setUint16(pos, bg.glyphId); pos += 2
    view.setUint16(pos, bg.firstLayerIndex); pos += 2
    view.setUint16(pos, bg.numLayers); pos += 2
  }

  // LayerRecords
  for (const layer of layers) {
    view.setUint16(pos, layer.glyphId); pos += 2
    view.setUint16(pos, layer.paletteIndex); pos += 2
  }

  return buf
}

/**
 * Build a synthetic CPAL table
 */
function buildCpalTable(
  palettes: { blue: number; green: number; red: number; alpha: number }[][],
): ArrayBuffer {
  if (palettes.length === 0) {
    const buf = new ArrayBuffer(12)
    const view = new DataView(buf)
    view.setUint16(0, 0) // version
    view.setUint16(2, 0) // numPaletteEntries
    view.setUint16(4, 0) // numPalettes
    view.setUint16(6, 0) // numColorRecords
    view.setUint32(8, 12) // colorRecordsArrayOffset
    return buf
  }

  const numPaletteEntries = palettes[0]!.length
  const numPalettes = palettes.length
  const totalColors = numPalettes * numPaletteEntries

  // Header: version(2) + numPaletteEntries(2) + numPalettes(2) + numColorRecords(2) + colorRecordsArrayOffset(4) = 12
  // + palette first color indices: numPalettes * 2
  // + color records: totalColors * 4 (BGRA)
  const headerSize = 12
  const indicesSize = numPalettes * 2
  const colorsOffset = headerSize + indicesSize
  const colorsSize = totalColors * 4

  const buf = new ArrayBuffer(colorsOffset + colorsSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint16(pos, 0); pos += 2 // version
  view.setUint16(pos, numPaletteEntries); pos += 2
  view.setUint16(pos, numPalettes); pos += 2
  view.setUint16(pos, totalColors); pos += 2
  view.setUint32(pos, colorsOffset); pos += 4

  // Palette first color indices
  for (let i = 0; i < numPalettes; i++) {
    view.setUint16(pos, i * numPaletteEntries); pos += 2
  }

  // Color records (BGRA)
  for (const palette of palettes) {
    for (const color of palette) {
      view.setUint8(pos++, color.blue)
      view.setUint8(pos++, color.green)
      view.setUint8(pos++, color.red)
      view.setUint8(pos++, color.alpha)
    }
  }

  return buf
}

function buildCpalV1(): Uint8Array {
  const bytes = new Uint8Array(50)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 1)
  view.setUint16(2, 1)
  view.setUint16(4, 2)
  view.setUint16(6, 2)
  view.setUint32(8, 28)
  view.setUint16(12, 0)
  view.setUint16(14, 1)
  view.setUint32(16, 36)
  view.setUint32(20, 44)
  view.setUint32(24, 48)
  bytes.set([0, 0, 255, 255, 255, 0, 0, 128], 28)
  view.setUint32(36, 1)
  view.setUint32(40, 2)
  view.setUint16(44, 300)
  view.setUint16(46, 301)
  view.setUint16(48, 302)
  return bytes
}

describe('COLR v0 table parser', () => {
  // Verifies that getColorLayers returns the layer records sliced by firstLayerIndex/numLayers in order.
  it('should parse base glyph records and layer records', () => {
    const colr = parseColr(new BinaryReader(buildColrV0(
      [{ glyphId: 100, firstLayerIndex: 0, numLayers: 3 }],
      [
        { glyphId: 200, paletteIndex: 0 },
        { glyphId: 201, paletteIndex: 1 },
        { glyphId: 202, paletteIndex: 2 },
      ],
    )))

    const layers = colr.getColorLayers(100)
    expect(layers).not.toBeNull()
    expect(layers).toHaveLength(3)
    expect(layers![0]).toEqual({ glyphId: 200, paletteIndex: 0 })
    expect(layers![1]).toEqual({ glyphId: 201, paletteIndex: 1 })
    expect(layers![2]).toEqual({ glyphId: 202, paletteIndex: 2 })
  })

  // Verifies that a glyph without a BaseGlyphRecord returns null (caller falls back to monochrome rendering).
  it('should return null for unregistered glyphId', () => {
    const colr = parseColr(new BinaryReader(buildColrV0(
      [{ glyphId: 100, firstLayerIndex: 0, numLayers: 1 }],
      [{ glyphId: 200, paletteIndex: 0 }],
    )))

    expect(colr.getColorLayers(999)).toBeNull()
  })

  // Verifies that two base glyphs sharing one layer array each get their own slice via distinct firstLayerIndex values.
  it('should handle multiple base glyphs', () => {
    const colr = parseColr(new BinaryReader(buildColrV0(
      [
        { glyphId: 10, firstLayerIndex: 0, numLayers: 2 },
        { glyphId: 20, firstLayerIndex: 2, numLayers: 1 },
      ],
      [
        { glyphId: 100, paletteIndex: 0 },
        { glyphId: 101, paletteIndex: 1 },
        { glyphId: 200, paletteIndex: 2 },
      ],
    )))

    expect(colr.getColorLayers(10)).toHaveLength(2)
    expect(colr.getColorLayers(20)).toHaveLength(1)
    expect(colr.getColorLayers(20)![0]!.glyphId).toBe(200)
  })
})

describe('CPAL table parser', () => {
  // Verifies that BGRA color records are decoded into red/green/blue/alpha components per palette entry.
  it('should parse palette entries', () => {
    const cpal = parseCpal(new BinaryReader(buildCpalTable([
      [
        { blue: 0, green: 0, red: 255, alpha: 255 },
        { blue: 255, green: 0, red: 0, alpha: 128 },
      ],
    ])))

    expect(cpal.numPalettes).toBe(1)
    expect(cpal.numPaletteEntries).toBe(2)

    const c0 = cpal.getColor(0, 0)
    expect(c0.red).toBe(255)
    expect(c0.blue).toBe(0)
    expect(c0.alpha).toBe(255)

    const c1 = cpal.getColor(0, 1)
    expect(c1.blue).toBe(255)
    expect(c1.alpha).toBe(128)
  })

  // Verifies that colorRecordIndices route each palette to its own block of color records.
  it('should support multiple palettes', () => {
    const cpal = parseCpal(new BinaryReader(buildCpalTable([
      [{ blue: 0, green: 0, red: 255, alpha: 255 }],
      [{ blue: 255, green: 0, red: 0, alpha: 255 }],
    ])))

    expect(cpal.numPalettes).toBe(2)
    expect(cpal.getColor(0, 0).red).toBe(255)
    expect(cpal.getColor(1, 0).blue).toBe(255)
  })

  // Verifies that an out-of-range palette reference is rejected as malformed.
  it('should reject out-of-range indices', () => {
    const cpal = parseCpal(new BinaryReader(buildCpalTable([
      [{ blue: 0, green: 0, red: 255, alpha: 255 }],
    ])))

    expect(() => cpal.getColor(99, 0)).toThrow('out of range')
  })

  // Verifies that getDefaultColor reads entries from palette 0.
  it('should support getDefaultColor', () => {
    const cpal = parseCpal(new BinaryReader(buildCpalTable([
      [{ blue: 100, green: 150, red: 200, alpha: 255 }],
    ])))

    const c = cpal.getDefaultColor(0)
    expect(c.blue).toBe(100)
    expect(c.green).toBe(150)
    expect(c.red).toBe(200)
  })

  it('parses version 1 palette types and name IDs', () => {
    const cpal = parseCpal(new BinaryReader(buildCpalV1().buffer))
    expect(cpal.version).toBe(1)
    expect(cpal.paletteTypes).toEqual([1, 2])
    expect(cpal.paletteLabelNameIds).toEqual([300, 301])
    expect(cpal.paletteEntryLabelNameIds).toEqual([302])
    expect(cpal.getColor(1, 0)).toEqual({ blue: 255, green: 0, red: 0, alpha: 128 })
  })

  it('connects palette selection and entry overrides through the public Font API', () => {
    const outline = encodeSimpleGlyph([[0, 0], [100, 0], [100, 100], [0, 100]], [3])
    const font = Font.load(buildTestFont([null, outline], [[0x41, 1]], [['CPAL', buildCpalV1()]]))
    expect(font.getColorFromSelectedPalette(0)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    font.setColorPalette('dark')
    expect(font.colorPaletteIndex).toBe(1)
    expect(font.getColorFromSelectedPalette(0)).toEqual({ r: 0, g: 0, b: 255, a: 128 })
    font.setColorPaletteOverrides(new Map([[0, { r: 1, g: 2, b: 3, a: 4 }]]))
    expect(font.getColorFromSelectedPalette(0)).toEqual({ r: 1, g: 2, b: 3, a: 4 })
    expect(font.getColorPalettes().map(function (palette) {
      return [palette.usableWithLightBackground, palette.usableWithDarkBackground]
    })).toEqual([[true, false], [false, true]])
  })
})

describe('COLR + CPAL integration', () => {
  // End-to-end check: COLR layer paletteIndex values resolve to the expected CPAL colors, as a renderer would use them.
  it('should resolve color layers to palette colors', () => {
    const colr = parseColr(new BinaryReader(buildColrV0(
      [{ glyphId: 50, firstLayerIndex: 0, numLayers: 2 }],
      [
        { glyphId: 100, paletteIndex: 0 },
        { glyphId: 101, paletteIndex: 1 },
      ],
    )))

    const cpal = parseCpal(new BinaryReader(buildCpalTable([
      [
        { blue: 0, green: 0, red: 255, alpha: 255 }, // index 0: red
        { blue: 255, green: 0, red: 0, alpha: 128 }, // index 1: blue, semi-transparent
      ],
    ])))

    const layers = colr.getColorLayers(50)!
    expect(layers).toHaveLength(2)

    const color0 = cpal.getColor(0, layers[0]!.paletteIndex)
    expect(color0.red).toBe(255)
    expect(color0.alpha).toBe(255)

    const color1 = cpal.getColor(0, layers[1]!.paletteIndex)
    expect(color1.blue).toBe(255)
    expect(color1.alpha).toBe(128)
  })
})
