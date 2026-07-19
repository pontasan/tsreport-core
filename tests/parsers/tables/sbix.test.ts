import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseSbix } from '../../../src/parsers/tables/sbix.js'

/**
 * Build a synthetic sbix table
 */
function buildSbixTable(
  numGlyphs: number,
  strikes: { ppem: number; ppi: number; glyphs: { originX: number; originY: number; type: string; data: Uint8Array }[] }[],
): ArrayBuffer {
  const buf = new ArrayBuffer(4096)
  const view = new DataView(buf)
  let pos = 0

  // Header: version(2) + flags(2) + numStrikes(4) = 8
  view.setUint16(pos, 1); pos += 2 // version
  view.setUint16(pos, 1); pos += 2 // flags: bit 0 is required by the specification
  view.setUint32(pos, strikes.length); pos += 4

  // Strike offsets placeholder
  const strikeOffsetPositions: number[] = []
  for (let i = 0; i < strikes.length; i++) {
    strikeOffsetPositions.push(pos)
    pos += 4
  }

  // Write strikes
  for (let s = 0; s < strikes.length; s++) {
    const strikeStart = pos
    view.setUint32(strikeOffsetPositions[s]!, strikeStart)

    const strike = strikes[s]!
    view.setUint16(pos, strike.ppem); pos += 2
    view.setUint16(pos, strike.ppi); pos += 2

    // glyphDataOffsets: numGlyphs + 1 entries (uint32 each)
    const offsetsStart = pos
    pos += (numGlyphs + 1) * 4

    // Write glyph data and fill offsets
    for (let g = 0; g <= numGlyphs; g++) {
      const relOffset = pos - strikeStart
      view.setUint32(offsetsStart + g * 4, relOffset)

      if (g < numGlyphs && g < strike.glyphs.length) {
        const glyph = strike.glyphs[g]!
        // GlyphData: originOffsetX(2) + originOffsetY(2) + graphicType(4) + data
        view.setInt16(pos, glyph.originX); pos += 2
        view.setInt16(pos, glyph.originY); pos += 2
        for (let c = 0; c < 4; c++) {
          view.setUint8(pos++, glyph.type.charCodeAt(c))
        }
        new Uint8Array(buf).set(glyph.data, pos)
        pos += glyph.data.length
      }
    }
  }

  return buf.slice(0, pos)
}

describe('sbix table parser', () => {
  it('should parse synthetic sbix with PNG glyph', () => {
    const pngData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    const sbix = parseSbix(
      new BinaryReader(buildSbixTable(2, [{
        ppem: 20, ppi: 72,
        glyphs: [
          { originX: 0, originY: 10, type: 'png ', data: pngData },
          { originX: 5, originY: 15, type: 'png ', data: pngData },
        ],
      }])),
      2,
    )

    expect(sbix.availablePpems).toEqual([20])

    const glyph0 = sbix.getGlyphBitmap(0, 20)
    expect(glyph0).not.toBeNull()
    expect(glyph0!.graphicType).toBe('png ')
    expect(glyph0!.originOffsetY).toBe(10)
    expect(glyph0!.data).toEqual(pngData)
  })

  it('should return null for wrong ppem', () => {
    const sbix = parseSbix(
      new BinaryReader(buildSbixTable(1, [{
        ppem: 20, ppi: 72,
        glyphs: [{ originX: 0, originY: 0, type: 'png ', data: new Uint8Array([1]) }],
      }])),
      1,
    )

    expect(sbix.getGlyphBitmap(0, 40)).toBeNull()
  })

  it('should return null for invalid glyphId', () => {
    const sbix = parseSbix(
      new BinaryReader(buildSbixTable(1, [{
        ppem: 20, ppi: 72,
        glyphs: [{ originX: 0, originY: 0, type: 'png ', data: new Uint8Array([1]) }],
      }])),
      1,
    )

    expect(sbix.getGlyphBitmap(-1, 20)).toBeNull()
    expect(sbix.getGlyphBitmap(1, 20)).toBeNull()
  })

  it('should support multiple strikes', () => {
    const data1 = new Uint8Array([1])
    const data2 = new Uint8Array([2])
    const sbix = parseSbix(
      new BinaryReader(buildSbixTable(1, [
        { ppem: 16, ppi: 72, glyphs: [{ originX: 0, originY: 0, type: 'png ', data: data1 }] },
        { ppem: 32, ppi: 72, glyphs: [{ originX: 0, originY: 0, type: 'png ', data: data2 }] },
      ])),
      1,
    )

    expect(sbix.availablePpems).toEqual([16, 32])
    expect(sbix.getGlyphBitmap(0, 16)!.data).toEqual(data1)
    expect(sbix.getGlyphBitmap(0, 32)!.data).toEqual(data2)
  })

  it('distinguishes strikes with the same ppem by ppi', () => {
    const data1 = new Uint8Array([1])
    const data2 = new Uint8Array([2])
    const sbix = parseSbix(
      new BinaryReader(buildSbixTable(1, [
        { ppem: 20, ppi: 96, glyphs: [{ originX: 0, originY: 0, type: 'png ', data: data1 }] },
        { ppem: 20, ppi: 192, glyphs: [{ originX: 0, originY: 0, type: 'png ', data: data2 }] },
      ])),
      1,
    )

    expect(sbix.availableStrikes).toEqual([
      { ppem: 20, ppi: 96, offset: 16 },
      { ppem: 20, ppi: 192, offset: 37 },
    ])
    expect(sbix.getGlyphBitmap(0, 20, 96)!.data).toEqual(data1)
    expect(sbix.getGlyphBitmap(0, 20, 192)!.data).toEqual(data2)
  })
})
