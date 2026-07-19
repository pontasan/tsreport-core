import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseHhea } from '../../../src/parsers/tables/hhea.js'
import { parseMaxp } from '../../../src/parsers/tables/maxp.js'
import { parseHmtx } from '../../../src/parsers/tables/hmtx.js'
import { parseCmap } from '../../../src/parsers/tables/cmap.js'

const FONT_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')

describe('hmtx table parser', () => {
  function buildHmtxTable(
    metrics: { advanceWidth: number, leftSideBearing: number }[],
    extraLsbs: number[],
    extraBytes = 0,
  ): ArrayBuffer {
    const w = new BinaryWriter()
    for (const metric of metrics) {
      w.writeUint16(metric.advanceWidth)
      w.writeInt16(metric.leftSideBearing)
    }
    for (const lsb of extraLsbs) {
      w.writeInt16(lsb)
    }
    for (let i = 0; i < extraBytes; i++) w.writeUint8(0)
    return w.toArrayBuffer()
  }

  it('should parse long metrics plus trailing left side bearings', () => {
    const hmtx = parseHmtx(new BinaryReader(buildHmtxTable(
      [
        { advanceWidth: 500, leftSideBearing: 10 },
        { advanceWidth: 600, leftSideBearing: 20 },
      ],
      [30, -40],
    )), 2, 4)

    expect(hmtx.getAdvanceWidth(0)).toBe(500)
    expect(hmtx.getLsb(0)).toBe(10)
    expect(hmtx.getAdvanceWidth(1)).toBe(600)
    expect(hmtx.getLsb(1)).toBe(20)
    expect(hmtx.getAdvanceWidth(2)).toBe(600)
    expect(hmtx.getLsb(2)).toBe(30)
    expect(hmtx.getAdvanceWidth(3)).toBe(600)
    expect(hmtx.getLsb(3)).toBe(-40)
  })

  it('should reject numberOfHMetrics outside the glyph range', () => {
    expect(() => parseHmtx(new BinaryReader(buildHmtxTable([], [])), 0, 4)).toThrow(
      'hmtx numberOfHMetrics must be in the range 1..4, got 0',
    )
    expect(() => parseHmtx(new BinaryReader(buildHmtxTable([], [])), 5, 4)).toThrow(
      'hmtx numberOfHMetrics must be in the range 1..4, got 5',
    )
  })

  it('should reject truncated and overlong tables', () => {
    expect(() => parseHmtx(new BinaryReader(buildHmtxTable(
      [{ advanceWidth: 500, leftSideBearing: 10 }],
      [],
    )), 1, 2)).toThrow('hmtx table length must be 6, got 4')

    expect(() => parseHmtx(new BinaryReader(buildHmtxTable(
      [{ advanceWidth: 500, leftSideBearing: 10 }],
      [20],
      2,
    )), 1, 2)).toThrow('hmtx table length must be 6, got 8')
  })

  // Verifies that advance widths from a real font are positive and proportionally sensible ('i' narrower than 'M').
  it('should return advance widths for glyphs', () => {
    const buffer = readFileSync(FONT_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)

    const hhea = parseHhea(getTableReader(sfnt, 'hhea')!)
    const maxp = parseMaxp(getTableReader(sfnt, 'maxp')!)
    const hmtx = parseHmtx(getTableReader(sfnt, 'hmtx')!, hhea.numberOfHMetrics, maxp.numGlyphs)
    const cmap = parseCmap(getTableReader(sfnt, 'cmap')!)

    // 'A' should have positive advance width
    const glyphIdA = cmap.getGlyphId(0x0041)
    const awA = hmtx.getAdvanceWidth(glyphIdA)
    expect(awA).toBeGreaterThan(0)

    // 'i' should be narrower than 'M'
    const glyphIdI = cmap.getGlyphId(0x0069) // 'i'
    const glyphIdM = cmap.getGlyphId(0x004D) // 'M'
    const awI = hmtx.getAdvanceWidth(glyphIdI)
    const awM = hmtx.getAdvanceWidth(glyphIdM)
    expect(awI).toBeLessThan(awM)
  })

  // Verifies that getAdvanceWidth returns 0 for negative or beyond-numGlyphs glyph IDs.
  it('should return 0 for out-of-range glyph IDs', () => {
    const buffer = readFileSync(FONT_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)

    const hhea = parseHhea(getTableReader(sfnt, 'hhea')!)
    const maxp = parseMaxp(getTableReader(sfnt, 'maxp')!)
    const hmtx = parseHmtx(getTableReader(sfnt, 'hmtx')!, hhea.numberOfHMetrics, maxp.numGlyphs)

    expect(hmtx.getAdvanceWidth(-1)).toBe(0)
    expect(hmtx.getAdvanceWidth(999999)).toBe(0)
  })
})
