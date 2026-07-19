import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, TextMeasurer, PathCommand } from '../src/index.js'

const NOTO_SANS_PATH = resolve(__dirname, 'fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')

describe('Font', () => {
  describe('loading', () => {
    // Verifies Font.load parses a TTF ArrayBuffer into a Font instance.
    it('should load a TTF font from ArrayBuffer', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font).toBeInstanceOf(Font)
    })

    // Verifies loading a second TTF font (Roboto) succeeds.
    it('should load Roboto', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font).toBeInstanceOf(Font)
    })

    // Verifies Font.load throws on a buffer that is not a font instead of returning a broken instance.
    it('should throw on invalid data', () => {
      const buffer = new ArrayBuffer(16)
      expect(() => Font.load(buffer)).toThrow()
    })
  })

  describe('font properties', () => {
    // Verifies the family name is parsed from the name table and matches the loaded font.
    it('should expose font names', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.familyName).toBeTruthy()
      expect(font.familyName.toLowerCase()).toContain('noto')
    })

    // Verifies core metrics have sane signs: positive unitsPerEm/ascender, negative descender.
    it('should expose metrics', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const metrics = font.metrics
      expect(metrics.unitsPerEm).toBeGreaterThan(0)
      expect(metrics.ascender).toBeGreaterThan(0)
      expect(metrics.descender).toBeLessThan(0)
    })

    // Verifies numGlyphs is read from maxp and is non-zero.
    it('should report number of glyphs', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.numGlyphs).toBeGreaterThan(0)
    })
  })

  describe('glyph lookup', () => {
    // Verifies cmap lookup maps 'A' to a non-.notdef glyph ID.
    it('should resolve code point to glyph ID', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const glyphId = font.getGlyphId(0x0041) // 'A'
      expect(glyphId).toBeGreaterThan(0)
    })

    // Verifies getGlyph returns a populated glyph: matching ID, positive advance, non-empty outline.
    it('should retrieve glyph data', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const glyphId = font.getGlyphId(0x0041) // 'A'
      const glyph = font.getGlyph(glyphId)

      expect(glyph.glyphId).toBe(glyphId)
      expect(glyph.advanceWidth).toBeGreaterThan(0)
      expect(glyph.outline.commands.length).toBeGreaterThan(0)
      expect(glyph.outline.coords.length).toBeGreaterThan(0)
    })

    // Verifies repeated getGlyph calls return the same cached object reference.
    it('should cache glyphs', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const glyphId = font.getGlyphId(0x0041)
      const glyph1 = font.getGlyph(glyphId)
      const glyph2 = font.getGlyph(glyphId)
      expect(glyph1).toBe(glyph2) // same object reference
    })

    // Verifies the getGlyphByCodePoint convenience wrapper resolves and loads a glyph in one call.
    it('should get glyph by code point', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const glyph = font.getGlyphByCodePoint(0x0042) // 'B'
      expect(glyph.advanceWidth).toBeGreaterThan(0)
      expect(glyph.outline.commands.length).toBeGreaterThan(0)
    })

    // Verifies getGlyphIds maps each character of a string to a mapped glyph ID.
    it('should get multiple glyph IDs from string', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const ids = font.getGlyphIds('ABC')
      expect(ids.length).toBe(3)
      ids.forEach(id => expect(id).toBeGreaterThan(0))
    })
  })

  describe('glyph outlines', () => {
    // Verifies the command stream's implied coordinate count exactly matches the coords array length.
    it('should produce valid cubic bezier outlines', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const glyph = font.getGlyphByCodePoint(0x0041) // 'A'
      const { commands, coords } = glyph.outline

      // Verify command sequence
      let coordIdx = 0
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i]!
        switch (cmd) {
          case PathCommand.MoveTo:
            coordIdx += 2
            break
          case PathCommand.LineTo:
            coordIdx += 2
            break
          case PathCommand.CubicTo:
            coordIdx += 6
            break
          case PathCommand.Close:
            break
          default:
            throw new Error(`Unknown command: ${cmd}`)
        }
      }
      expect(coordIdx).toBe(coords.length)
    })

    // Verifies the .notdef glyph (ID 0) loads without error and has a non-negative advance.
    it('should handle .notdef glyph (glyphId=0)', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const glyph = font.getGlyph(0)
      expect(glyph.glyphId).toBe(0)
      // .notdef may or may not have an outline
      expect(glyph.advanceWidth).toBeGreaterThanOrEqual(0)
    })

    // Verifies the space glyph has a positive advance but an empty outline (no contours).
    it('should return empty outline for space character', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const glyph = font.getGlyphByCodePoint(0x0020) // space
      expect(glyph.advanceWidth).toBeGreaterThan(0)
      expect(glyph.outline.commands.length).toBe(0)
    })
  })
})

describe('TextMeasurer', () => {
  // Verifies measure returns a positive total width and one positive advance per character.
  it('should measure text width', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const result = measurer.measure('Hello', 12)
    expect(result.width).toBeGreaterThan(0)
    expect(result.advances.length).toBe(5)
    for (let i = 0; i < result.advances.length; i++) {
      expect(result.advances[i]).toBeGreaterThan(0)
    }
  })

  // Verifies doubling the font size doubles the measured width (linear scaling).
  it('should scale with font size', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const r12 = measurer.measure('A', 12)
    const r24 = measurer.measure('A', 24)
    expect(r24.width).toBeCloseTo(r12.width * 2, 5)
  })

  // Verifies getLineHeight (ascender - descender + lineGap) exceeds the nominal font size.
  it('should compute line height', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const lineHeight = measurer.getLineHeight(12)
    expect(lineHeight).toBeGreaterThan(0)
    expect(lineHeight).toBeGreaterThan(12) // line height > font size
  })

  // Verifies scaled ascent is positive and descent is negative at a given font size.
  it('should compute ascent and descent', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const ascent = measurer.getAscent(12)
    const descent = measurer.getDescent(12)
    expect(ascent).toBeGreaterThan(0)
    expect(descent).toBeLessThan(0)
  })

  // Verifies proportional metrics: 'M' measures wider than 'i'.
  it('wider characters should have larger advance', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const measurer = new TextMeasurer(font)

    const rI = measurer.measure('i', 12)
    const rM = measurer.measure('M', 12)
    expect(rM.width).toBeGreaterThan(rI.width)
  })
})
