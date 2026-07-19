import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'

const FONT_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')

describe('AAT public table consumers', function () {
  it('exposes and resolves acnt/fdsc/fmtx/gcid/prop/Zapf/MERG data', function () {
    const font = Font.load(Uint8Array.from(readFileSync(FONT_PATH)).buffer)
    const primaryGlyphId = font.getGlyphId(0x41)
    const secondaryGlyphId = font.getGlyphId(0x56)
    const accentGlyphId = font.getGlyphId(0x5A)
    const manager = (font as unknown as { tableManager: object }).tableManager
    const define = function (name: string, value: unknown): void {
      Object.defineProperty(manager, name, { value, configurable: true })
    }
    define('acnt', {
      getAttachment(glyphId: number): object | null {
        return glyphId === accentGlyphId ? {
          primaryGlyphIndex: primaryGlyphId,
          components: [{ primaryAttachmentPoint: 3, secondaryGlyphIndex: secondaryGlyphId, secondaryGlyphAttachmentNumber: 5 }],
        } : null
      },
    })
    const anchors = [{ x: 120, y: 340 }, { x: -50, y: 90 }]
    define('ankr', {
      getAnchorPoints(glyphId: number): readonly { x: number, y: number }[] | null {
        return glyphId === primaryGlyphId ? anchors : null
      },
    })
    define('fdsc', { getDescriptor(tag: string): number | null { return tag === 'wght' ? 0.75 : null } })
    define('fmtx', {
      glyphIndex: 7,
      horizontalBefore: 0, horizontalAfter: 1,
      horizontalCaretHead: 2, horizontalCaretBase: 3,
      verticalBefore: 4, verticalAfter: 5,
      verticalCaretHead: 6, verticalCaretBase: 7,
    })
    define('gcid', { getCid(glyphId: number): number | null { return glyphId === 9 ? 123 : null } })
    define('prop', { getProperties(glyphId: number): number { return 0x8000 | glyphId } })
    const zapfInfo = { flags: 0x80, unicodes: [0x41], identifiers: [], groups: [], feature: null }
    define('zapf', { getGlyphInfo(glyphId: number): object | null { return glyphId === 10 ? zapfInfo : null } })
    define('merg', {
      getMergeAction(left: number, right: number): number { return left === 1 && right === 2 ? 2 : 0 },
      getMergeGroups(): object[] { return [{ start: 0, end: 2, mergeRequired: true }] },
    })
    Object.defineProperty(font, 'getGlyphControlPoint', {
      value(glyphId: number, pointIndex: number): { x: number, y: number } {
        if (glyphId === 7 && pointIndex === 3) return { x: 703, y: 0 }
        if (glyphId === 7 && pointIndex === 7) return { x: 0, y: -707 }
        return { x: glyphId * 100 + pointIndex, y: glyphId * -100 - pointIndex }
      },
    })

    expect(font.getAccentAttachment(accentGlyphId)).toEqual({
      primaryGlyphId,
      components: [{
        secondaryGlyphId,
        primaryPoint: { x: primaryGlyphId * 100 + 3, y: primaryGlyphId * -100 - 3 },
        secondaryPoint: { x: secondaryGlyphId * 100 + 5, y: secondaryGlyphId * -100 - 5 },
      }],
    })
    expect(font.getAatAnchorPoints(primaryGlyphId)).toBe(anchors)
    const primaryGlyph = font.getGlyph(primaryGlyphId)
    const secondaryGlyph = font.getGlyph(secondaryGlyphId)
    const accentGlyph = font.getGlyph(accentGlyphId)
    expect(accentGlyph.advanceWidth).toBe(primaryGlyph.advanceWidth)
    expect(accentGlyph.outline.commands.length).toBe(
      primaryGlyph.outline.commands.length + secondaryGlyph.outline.commands.length,
    )
    const secondaryStart = primaryGlyph.outline.coords.length
    const translation = (primaryGlyphId - secondaryGlyphId) * 100 - 2
    expect(accentGlyph.outline.coords[secondaryStart]).toBe(secondaryGlyph.outline.coords[0]! + translation)
    expect(accentGlyph.outline.coords[secondaryStart + 1]).toBe(secondaryGlyph.outline.coords[1]! - translation)
    expect(font.getAatFontDescriptor('wght')).toBe(0.75)
    expect(font.getAatPointMetrics()).toEqual({
      horizontalBefore: { x: 700, y: -700 },
      horizontalAfter: { x: 701, y: -701 },
      horizontalCaretHead: { x: 702, y: -702 },
      horizontalCaretBase: { x: 703, y: 0 },
      verticalBefore: { x: 704, y: -704 },
      verticalAfter: { x: 705, y: -705 },
      verticalCaretHead: { x: 706, y: -706 },
      verticalCaretBase: { x: 0, y: -707 },
    })
    expect(font.getGlyphCid(9)).toBe(123)
    expect(font.getAatGlyphProperties(6)).toBe(0x8006)
    expect(font.getAatGlyphPropertyInfo(6)).toEqual({
      raw: 0x8006,
      floater: true,
      hangsLeftOrTop: false,
      hangsRightOrBottom: false,
      usesComplementaryBracket: false,
      complementaryGlyphId: null,
      attachesOnRight: false,
      directionalityClass: 6,
    })
    expect(font.getZapfGlyphInfo(10)).toBe(zapfInfo)
    expect(font.getMergeAction(1, 2)).toBe(2)
    expect(font.getMergeGroups([1, 2])).toEqual([{ start: 0, end: 2, mergeRequired: true }])

    Object.defineProperty(font, 'metricsCache', { value: null, writable: true, configurable: true })
    expect(font.metrics).toMatchObject({
      ascender: -700,
      descender: -701,
      lineGap: 0,
      horizontalCaretSlopeRise: -702,
      horizontalCaretSlopeRun: -1,
      horizontalCaretOffset: 703,
      verticalAscender: 704,
      verticalDescender: 705,
      verticalLineGap: 0,
      verticalCaretSlopeRise: 1,
      verticalCaretSlopeRun: 706,
      verticalCaretOffset: -707,
    })
  })
})
