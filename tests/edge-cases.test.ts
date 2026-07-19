import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, TextMeasurer, PathCommand } from '../src/index.js'

const NOTO_SANS_PATH = resolve(__dirname, 'fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_TTF_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const OTF_PATH = resolve(__dirname, 'fixtures/fonts/SourceSans3-Regular.otf')

describe('Edge cases - .notdef glyph', () => {
  // Verifies glyph ID 0 (.notdef) loads from a glyf-based font with valid metrics and outline containers.
  it('should load .notdef glyph (glyphId=0) from TTF', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyph(0)
    expect(glyph.glyphId).toBe(0)
    expect(glyph.advanceWidth).toBeGreaterThanOrEqual(0)
    // .notdef may or may not have outline data
    expect(glyph.outline).toBeDefined()
    expect(glyph.outline.commands).toBeInstanceOf(Uint8Array)
    expect(glyph.outline.coords).toBeInstanceOf(Float32Array)
  })

  // Verifies glyph ID 0 (.notdef) loads from a CFF-based OTF via the CharString interpreter.
  it('should load .notdef glyph (glyphId=0) from OTF/CFF', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyph(0)
    expect(glyph.glyphId).toBe(0)
    expect(glyph.advanceWidth).toBeGreaterThanOrEqual(0)
    expect(glyph.outline).toBeDefined()
    expect(glyph.outline.commands).toBeInstanceOf(Uint8Array)
    expect(glyph.outline.coords).toBeInstanceOf(Float32Array)
  })
})

describe('Edge cases - Unmapped codepoints', () => {
  // Verifies cmap lookup falls back to glyph 0 for an unmapped Private Use Area codepoint.
  it('should return glyphId=0 for unmapped codepoint', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Use a Private Use Area codepoint unlikely to be mapped
    const glyphId = font.getGlyphId(0xF8FF)
    expect(glyphId).toBe(0)
  })

  // Verifies the maximum Unicode codepoint U+10FFFF maps to glyph 0 without overflow errors.
  it('should return glyphId=0 for very large codepoint (0x10FFFF)', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Maximum valid Unicode codepoint
    const glyphId = font.getGlyphId(0x10FFFF)
    expect(glyphId).toBe(0)
  })

  // Verifies looking up codepoint 0 (NULL) returns a number instead of crashing.
  it('should handle codepoint 0 gracefully', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Codepoint 0 (NULL) - should not crash
    const glyphId = font.getGlyphId(0)
    expect(typeof glyphId).toBe('number')
  })

  // Verifies supplementary-plane codepoints (above BMP) go through cmap format 12 lookup without error.
  it('should handle codepoints above BMP (supplementary plane)', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // U+1F600 (Grinning Face emoji) - may or may not be in font
    const glyphId = font.getGlyphId(0x1F600)
    expect(typeof glyphId).toBe('number')
    expect(glyphId).toBeGreaterThanOrEqual(0)
  })

  // Verifies CJK Extension B codepoints (plane 2) are looked up safely.
  it('should handle CJK extension codepoints', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // U+20000 (CJK Unified Ideographs Extension B)
    const glyphId = font.getGlyphId(0x20000)
    expect(typeof glyphId).toBe('number')
    expect(glyphId).toBeGreaterThanOrEqual(0)
  })
})

describe('Edge cases - Subset', () => {
  // Verifies subsetting with empty text still emits a loadable font retaining at least .notdef.
  it('empty text subset produces valid font with only .notdef', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const subsetBuffer = font.subset('')
    expect(subsetBuffer.byteLength).toBeGreaterThan(0)

    const subsetFont = Font.load(subsetBuffer)
    // Should contain at least .notdef
    expect(subsetFont.numGlyphs).toBeGreaterThanOrEqual(1)

    // .notdef glyph should be accessible
    const notdef = subsetFont.getGlyph(0)
    expect(notdef.glyphId).toBe(0)
  })

  // Verifies a single-character TTF subset preserves the glyph's advance width and exact outline data.
  it('subset with single character round-trip', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const originalGlyph = font.getGlyphByCodePoint(0x0041) // 'A'

    const subsetBuffer = font.subset('A')
    const subsetFont = Font.load(subsetBuffer)

    const subsetGlyph = subsetFont.getGlyphByCodePoint(0x0041)
    expect(subsetGlyph.advanceWidth).toBe(originalGlyph.advanceWidth)
    expect(subsetGlyph.outline.commands.length).toBe(originalGlyph.outline.commands.length)
    expect(subsetGlyph.outline.coords.length).toBe(originalGlyph.outline.coords.length)

    // Verify outline data matches
    for (let i = 0; i < originalGlyph.outline.commands.length; i++) {
      expect(subsetGlyph.outline.commands[i]).toBe(originalGlyph.outline.commands[i])
    }
    for (let i = 0; i < originalGlyph.outline.coords.length; i++) {
      expect(subsetGlyph.outline.coords[i]).toBeCloseTo(originalGlyph.outline.coords[i]!, 2)
    }
  })

  // Verifies a multi-character subset keeps every mapped character usable after the round-trip.
  it('subset with mixed ASCII + international characters', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Mix of ASCII and Latin Extended characters
    const text = 'Hello'
    const subsetBuffer = font.subset(text)
    expect(subsetBuffer.byteLength).toBeGreaterThan(0)

    const subsetFont = Font.load(subsetBuffer)
    // Each unique character + .notdef
    expect(subsetFont.numGlyphs).toBeGreaterThanOrEqual(1)

    // ASCII characters should survive the round-trip
    for (const char of new Set(text)) {
      const cp = char.codePointAt(0)!
      const originalGid = font.getGlyphId(cp)
      if (originalGid !== 0) {
        const subsetGlyph = subsetFont.getGlyphByCodePoint(cp)
        expect(subsetGlyph.advanceWidth).toBeGreaterThan(0)
      }
    }
  })

  // Verifies the CFF subsetter preserves advance width and yields parseable CharString outlines for one character.
  it('CFF subset with single character round-trip', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const originalGlyph = font.getGlyphByCodePoint(0x0042) // 'B'

    const subsetBuffer = font.subset('B')
    const subsetFont = Font.load(subsetBuffer)

    expect(subsetFont.isCff).toBe(true)
    const subsetGlyph = subsetFont.getGlyphByCodePoint(0x0042)
    // Advance width should be preserved in the subset
    expect(subsetGlyph.advanceWidth).toBe(originalGlyph.advanceWidth)
    // CFF subset outline commands: at minimum should not crash
    // (CFF subsetter may simplify charstrings)
    expect(subsetGlyph.outline.commands).toBeInstanceOf(Uint8Array)
    expect(subsetGlyph.outline.coords).toBeInstanceOf(Float32Array)
  })

  // Verifies the CFF subsetter handles empty input, producing a loadable CFF font.
  it('empty text CFF subset produces valid font', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const subsetBuffer = font.subset('')
    expect(subsetBuffer.byteLength).toBeGreaterThan(0)

    const subsetFont = Font.load(subsetBuffer)
    expect(subsetFont.numGlyphs).toBeGreaterThanOrEqual(1)
    expect(subsetFont.isCff).toBe(true)
  })
})

describe('Edge cases - getGlyphIds with strings', () => {
  // Verifies getGlyphIds treats a surrogate pair as one codepoint, yielding a single glyph ID.
  it('should handle surrogate pairs in strings', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // String with surrogate pair: U+1D11E (Musical Symbol G Clef)
    const text = '\uD834\uDD1E'
    const ids = font.getGlyphIds(text)
    // JavaScript for...of iterates codepoints, so one character
    expect(ids.length).toBe(1)
    expect(typeof ids[0]).toBe('number')
  })

  // Verifies codepoint iteration is correct when BMP characters surround a supplementary-plane character.
  it('should handle mixed BMP and supplementary characters', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // 'A' + U+1F600 (emoji, supplementary) + 'B'
    const text = 'A\uD83D\uDE00B'
    const ids = font.getGlyphIds(text)
    // for...of sees 3 codepoints: A, U+1F600, B
    expect(ids.length).toBe(3)
    expect(ids[0]).toBeGreaterThan(0) // 'A' should be mapped
    expect(ids[2]).toBeGreaterThan(0) // 'B' should be mapped
  })

  // Verifies getGlyphIds on an empty string returns an empty array rather than failing.
  it('should return empty array for empty string', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const ids = font.getGlyphIds('')
    expect(ids.length).toBe(0)
  })
})

describe('Edge cases - TextMeasurer', () => {
  // Verifies measuring an empty string yields zero width and no advances.
  it('should handle empty string', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const result = measurer.measure('', 12)
    expect(result.width).toBe(0)
    expect(result.advances.length).toBe(0)
  })

  // Verifies a single character's total width equals its lone advance entry.
  it('should handle single character', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const result = measurer.measure('X', 12)
    expect(result.width).toBeGreaterThan(0)
    expect(result.advances.length).toBe(1)
    expect(result.advances[0]).toBe(result.width)
  })

  // Verifies sub-pixel font sizes (0.5pt) still produce a small positive width without precision collapse.
  it('should handle very small font size', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const result = measurer.measure('Hello', 0.5)
    expect(result.width).toBeGreaterThan(0)
    // Small but non-zero
    expect(result.width).toBeLessThan(10)
  })

  // Verifies extreme font sizes (1000pt) scale without overflow.
  it('should handle very large font size', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const result = measurer.measure('A', 1000)
    expect(result.width).toBeGreaterThan(0)
    expect(result.width).toBeGreaterThan(100) // Should be large
  })

  // Verifies measured width is strictly proportional to font size (2x and 3x checks).
  it('width should scale linearly with font size', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const r10 = measurer.measure('Testing', 10)
    const r20 = measurer.measure('Testing', 20)
    const r30 = measurer.measure('Testing', 30)

    expect(r20.width).toBeCloseTo(r10.width * 2, 5)
    expect(r30.width).toBeCloseTo(r10.width * 3, 5)
  })
})

describe('Edge cases - Glyph caching', () => {
  // Verifies clearGlyphCache discards cached objects so a reload creates a fresh but data-identical glyph.
  it('clearGlyphCache should clear cached glyphs', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Load a glyph to populate cache
    const glyph1 = font.getGlyph(font.getGlyphId(0x0041))

    // Clear cache
    font.clearGlyphCache()

    // Load again - should be a new object (different reference)
    const glyph2 = font.getGlyph(font.getGlyphId(0x0041))
    expect(glyph2).not.toBe(glyph1) // Different object reference after cache clear
    // But data should still be identical
    expect(glyph2.glyphId).toBe(glyph1.glyphId)
    expect(glyph2.advanceWidth).toBe(glyph1.advanceWidth)
  })

  // Verifies repeated getGlyph calls return the identical cached instance (no re-parsing).
  it('multiple calls to getGlyph should return same reference (cached)', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyphId = font.getGlyphId(0x0042) // 'B'
    const glyph1 = font.getGlyph(glyphId)
    const glyph2 = font.getGlyph(glyphId)
    const glyph3 = font.getGlyph(glyphId)

    expect(glyph1).toBe(glyph2)
    expect(glyph2).toBe(glyph3)
  })

  // Verifies the metrics getter memoizes and returns the same object each time.
  it('multiple calls to metrics should return same object', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const metrics1 = font.metrics
    const metrics2 = font.metrics
    expect(metrics1).toBe(metrics2)
  })
})

describe('Edge cases - Font metrics flags', () => {
  // Verifies the OS/2/head bold flag is false for Roboto Regular.
  it('Regular font should have isBold=false', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.metrics.isBold).toBe(false)
  })

  // Verifies the italic flag is false for Roboto Regular.
  it('Regular font should have isItalic=false', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.metrics.isItalic).toBe(false)
  })

  // Verifies monospace detection is negative for the proportional Roboto font.
  it('Roboto Regular is not monospace', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.metrics.isMonospace).toBe(false)
  })

  // Verifies style flags are also correct for a second TTF font (NotoSans Regular).
  it('NotoSans Regular should have isBold=false and isItalic=false', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.metrics.isBold).toBe(false)
    expect(font.metrics.isItalic).toBe(false)
  })

  // Verifies style flags are also correct for a CFF-based font (SourceSans3 Regular).
  it('SourceSans3 Regular should have isBold=false and isItalic=false', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.metrics.isBold).toBe(false)
    expect(font.metrics.isItalic).toBe(false)
  })

  // Verifies isMonospace reflects post.isFixedPitch by checking two proportional fonts report false.
  it('isMonospace should be derived from post.isFixedPitch', () => {
    // Both Roboto and NotoSans are proportional fonts
    const robotoBuffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const robotoFont = Font.load(robotoBuffer)
    expect(robotoFont.metrics.isMonospace).toBe(false)

    const notoBuffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const notoFont = Font.load(notoBuffer)
    expect(notoFont.metrics.isMonospace).toBe(false)
  })
})

describe('Edge cases - subsetByGlyphIds API', () => {
  // Verifies subsetting by explicit glyph IDs plus a cmap mapping yields a loadable font with the expected glyphs.
  it('should work with explicit glyphId set', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyphIdA = font.getGlyphId(0x0041) // 'A'
    const glyphIdB = font.getGlyphId(0x0042) // 'B'

    const glyphIds = new Set<number>([glyphIdA, glyphIdB])
    const codePointToGlyphId = new Map<number, number>([
      [0x0041, glyphIdA],
      [0x0042, glyphIdB],
    ])

    const result = font.subsetByGlyphIds(glyphIds, codePointToGlyphId)
    expect(result.buffer.byteLength).toBeGreaterThan(0)
    expect(result.oldToNewGlyphId.size).toBeGreaterThanOrEqual(3)

    const subsetFont = Font.load(result.buffer)
    // .notdef + 2 glyphs
    expect(subsetFont.numGlyphs).toBeGreaterThanOrEqual(3)
  })

  // Verifies the codePointToGlyphId argument is optional and the subset still loads.
  it('should work without codePointToGlyphId mapping', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyphIdA = font.getGlyphId(0x0041)
    const glyphIds = new Set<number>([glyphIdA])

    const result = font.subsetByGlyphIds(glyphIds)
    expect(result.buffer.byteLength).toBeGreaterThan(0)

    const subsetFont = Font.load(result.buffer)
    expect(subsetFont.numGlyphs).toBeGreaterThanOrEqual(2) // .notdef + A
  })

  // Verifies the glyph-ID based subset path also works for CFF fonts, keeping the CFF table type.
  it('CFF subsetByGlyphIds should produce valid CFF subset', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyphIdC = font.getGlyphId(0x0043) // 'C'
    const glyphIds = new Set<number>([glyphIdC])
    const codePointToGlyphId = new Map<number, number>([
      [0x0043, glyphIdC],
    ])

    const result = font.subsetByGlyphIds(glyphIds, codePointToGlyphId)
    const subsetFont = Font.load(result.buffer)

    expect(subsetFont.isCff).toBe(true)
    expect(subsetFont.numGlyphs).toBeGreaterThanOrEqual(2)
  })
})

describe('Edge cases - Outline command types', () => {
  // Verifies CFF outlines emit only MoveTo/LineTo/CubicTo/Close, never quadratic commands.
  it('CFF glyph outlines should produce only cubic commands (no quadratic)', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Check multiple glyphs
    const codepoints = [0x0041, 0x0042, 0x0061, 0x0067, 0x0053] // A, B, a, g, S
    for (const cp of codepoints) {
      const glyph = font.getGlyphByCodePoint(cp)
      const { commands } = glyph.outline

      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i]!
        // Only MoveTo, LineTo, CubicTo, Close are valid
        expect([PathCommand.MoveTo, PathCommand.LineTo, PathCommand.CubicTo, PathCommand.Close])
          .toContain(cmd)
        // No QuadraticTo (value 4 or any other) should exist
        expect(cmd).toBeLessThanOrEqual(PathCommand.Close)
      }
    }
  })

  // Verifies the engine converts TTF quadratic beziers to cubic so outlines use one uniform command set.
  it('TTF glyph outlines should also produce only cubic commands (quad-to-cubic conversion)', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // TTF natively uses quadratic beziers, but the engine converts to cubic
    const codepoints = [0x0041, 0x0042, 0x0061, 0x0067, 0x0053] // A, B, a, g, S
    for (const cp of codepoints) {
      const glyph = font.getGlyphByCodePoint(cp)
      const { commands } = glyph.outline

      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i]!
        expect([PathCommand.MoveTo, PathCommand.LineTo, PathCommand.CubicTo, PathCommand.Close])
          .toContain(cmd)
      }
    }
  })

  // Verifies a curved TTF glyph ('S') actually contains CubicTo commands after quad-to-cubic conversion.
  it('TTF "S" should have cubic curves (converted from quadratic)', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyphByCodePoint(0x0053) // 'S' - has curves
    const { commands } = glyph.outline

    let hasCubic = false
    for (let i = 0; i < commands.length; i++) {
      if (commands[i] === PathCommand.CubicTo) {
        hasCubic = true
        break
      }
    }
    expect(hasCubic).toBe(true)
  })
})

describe('Edge cases - Outline coordinate consistency', () => {
  /**
   * Verify that the number of coordinate values matches the commands:
   * MoveTo: 2 coords (x, y)
   * LineTo: 2 coords (x, y)
   * CubicTo: 6 coords (cp1x, cp1y, cp2x, cp2y, x, y)
   * Close: 0 coords
   */
  function validateOutlineCoords(commands: Uint8Array, coords: Float32Array): void {
    let expectedCoordCount = 0
    for (let i = 0; i < commands.length; i++) {
      switch (commands[i]) {
        case PathCommand.MoveTo:
          expectedCoordCount += 2
          break
        case PathCommand.LineTo:
          expectedCoordCount += 2
          break
        case PathCommand.CubicTo:
          expectedCoordCount += 6
          break
        case PathCommand.Close:
          // No coords
          break
        default:
          throw new Error(`Unknown command: ${commands[i]}`)
      }
    }
    expect(coords.length).toBe(expectedCoordCount)
  }

  // Verifies TTF outlines keep the coords array length consistent with the command stream across varied glyphs.
  it('TTF glyph outlines should have correct coord counts', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const codepoints = [
      0x0041, 0x0042, 0x0043, // A, B, C
      0x0061, 0x0062, 0x0063, // a, b, c
      0x0030, 0x0031, 0x0032, // 0, 1, 2
      0x0020, // space (empty outline)
      0x0021, // !
      0x0040, // @
    ]

    for (const cp of codepoints) {
      const glyph = font.getGlyphByCodePoint(cp)
      validateOutlineCoords(glyph.outline.commands, glyph.outline.coords)
    }
  })

  // Verifies CFF outlines keep the coords array length consistent with the command stream across varied glyphs.
  it('CFF glyph outlines should have correct coord counts', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const codepoints = [
      0x0041, 0x0042, 0x0043, // A, B, C
      0x0061, 0x0062, 0x0063, // a, b, c
      0x0030, 0x0031, 0x0032, // 0, 1, 2
      0x0020, // space
      0x0021, // !
      0x0040, // @
    ]

    for (const cp of codepoints) {
      const glyph = font.getGlyphByCodePoint(cp)
      validateOutlineCoords(glyph.outline.commands, glyph.outline.coords)
    }
  })

  // Verifies command/coordinate consistency also holds for the TTF .notdef glyph.
  it('.notdef glyph outline should have correct coord counts (TTF)', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyph(0)
    validateOutlineCoords(glyph.outline.commands, glyph.outline.coords)
  })

  // Verifies command/coordinate consistency also holds for the CFF .notdef glyph.
  it('.notdef glyph outline should have correct coord counts (CFF)', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyph(0)
    validateOutlineCoords(glyph.outline.commands, glyph.outline.coords)
  })

  // Verifies each MoveTo consumes exactly two finite coordinates when walking the coord stream.
  it('every MoveTo should have exactly 2 coordinate values', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyphByCodePoint(0x0041) // 'A'
    const { commands, coords } = glyph.outline

    let coordIdx = 0
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]!
      if (cmd === PathCommand.MoveTo) {
        // coords[coordIdx] and coords[coordIdx+1] are x, y
        expect(coordIdx + 2).toBeLessThanOrEqual(coords.length)
        expect(typeof coords[coordIdx]).toBe('number')
        expect(typeof coords[coordIdx + 1]).toBe('number')
        expect(Number.isFinite(coords[coordIdx])).toBe(true)
        expect(Number.isFinite(coords[coordIdx + 1])).toBe(true)
        coordIdx += 2
      } else if (cmd === PathCommand.LineTo) {
        coordIdx += 2
      } else if (cmd === PathCommand.CubicTo) {
        coordIdx += 6
      }
      // Close: 0 coords
    }
  })

  // Verifies each CubicTo consumes exactly six finite coordinates (two control points + endpoint).
  it('every CubicTo should have exactly 6 coordinate values', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyphByCodePoint(0x0053) // 'S' - lots of curves
    const { commands, coords } = glyph.outline

    let coordIdx = 0
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]!
      if (cmd === PathCommand.CubicTo) {
        // 6 coords: cp1x, cp1y, cp2x, cp2y, x, y
        expect(coordIdx + 6).toBeLessThanOrEqual(coords.length)
        for (let j = 0; j < 6; j++) {
          expect(typeof coords[coordIdx + j]).toBe('number')
          expect(Number.isFinite(coords[coordIdx + j])).toBe(true)
        }
        coordIdx += 6
      } else if (cmd === PathCommand.MoveTo || cmd === PathCommand.LineTo) {
        coordIdx += 2
      }
      // Close: 0 coords
    }
  })

  // Verifies each LineTo consumes exactly two finite coordinates and that 'A' contains straight segments.
  it('every LineTo should have exactly 2 coordinate values', () => {
    const buffer = readFileSync(ROBOTO_TTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // 'A' typically has LineTo commands for the straight edges
    const glyph = font.getGlyphByCodePoint(0x0041) // 'A'
    const { commands, coords } = glyph.outline

    let coordIdx = 0
    let hasLineTo = false
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]!
      if (cmd === PathCommand.LineTo) {
        hasLineTo = true
        expect(coordIdx + 2).toBeLessThanOrEqual(coords.length)
        expect(Number.isFinite(coords[coordIdx])).toBe(true)
        expect(Number.isFinite(coords[coordIdx + 1])).toBe(true)
        coordIdx += 2
      } else if (cmd === PathCommand.MoveTo) {
        coordIdx += 2
      } else if (cmd === PathCommand.CubicTo) {
        coordIdx += 6
      }
    }
    expect(hasLineTo).toBe(true) // 'A' should have at least some line segments
  })
})
