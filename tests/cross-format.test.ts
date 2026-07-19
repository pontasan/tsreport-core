import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, TextMeasurer, PathCommand } from '../src/index.js'

const TTF_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const WOFF_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.woff')
const WOFF2_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.woff2')

let ttfFont: Font
let woffFont: Font
let woff2Font: Font

beforeAll(() => {
  ttfFont = Font.load(readFileSync(TTF_PATH).buffer as ArrayBuffer)
  woffFont = Font.load(readFileSync(WOFF_PATH).buffer as ArrayBuffer)
  woff2Font = Font.load(readFileSync(WOFF2_PATH).buffer as ArrayBuffer)
})

// Ensures WOFF/WOFF2 decoding yields data identical to the original TTF, proving container decompression is lossless.
describe('Cross-format consistency (Roboto TTF vs WOFF vs WOFF2)', () => {
  describe('Font names', () => {
    // Verifies the name-table family name survives WOFF/WOFF2 decompression unchanged.
    it('familyName should match across all formats', () => {
      expect(woffFont.familyName).toBe(ttfFont.familyName)
      expect(woff2Font.familyName).toBe(ttfFont.familyName)
    })

    // Verifies the PostScript name is identical across all three containers.
    it('postScriptName should match across all formats', () => {
      expect(woffFont.postScriptName).toBe(ttfFont.postScriptName)
      expect(woff2Font.postScriptName).toBe(ttfFont.postScriptName)
    })

    // Verifies the full font name is identical across all three containers.
    it('fullName should match across all formats', () => {
      expect(woffFont.fullName).toBe(ttfFont.fullName)
      expect(woff2Font.fullName).toBe(ttfFont.fullName)
    })

    // Verifies the subfamily (style) name is identical across all three containers.
    it('subfamilyName should match across all formats', () => {
      expect(woffFont.subfamilyName).toBe(ttfFont.subfamilyName)
      expect(woff2Font.subfamilyName).toBe(ttfFont.subfamilyName)
    })
  })

  describe('Font metrics', () => {
    // Verifies head.unitsPerEm is preserved by WOFF/WOFF2 decoding.
    it('unitsPerEm should match across all formats', () => {
      expect(woffFont.metrics.unitsPerEm).toBe(ttfFont.metrics.unitsPerEm)
      expect(woff2Font.metrics.unitsPerEm).toBe(ttfFont.metrics.unitsPerEm)
    })

    // Verifies the ascender metric is preserved by WOFF/WOFF2 decoding.
    it('ascender should match across all formats', () => {
      expect(woffFont.metrics.ascender).toBe(ttfFont.metrics.ascender)
      expect(woff2Font.metrics.ascender).toBe(ttfFont.metrics.ascender)
    })

    // Verifies the descender metric is preserved by WOFF/WOFF2 decoding.
    it('descender should match across all formats', () => {
      expect(woffFont.metrics.descender).toBe(ttfFont.metrics.descender)
      expect(woff2Font.metrics.descender).toBe(ttfFont.metrics.descender)
    })

    // Verifies the lineGap metric is preserved by WOFF/WOFF2 decoding.
    it('lineGap should match across all formats', () => {
      expect(woffFont.metrics.lineGap).toBe(ttfFont.metrics.lineGap)
      expect(woff2Font.metrics.lineGap).toBe(ttfFont.metrics.lineGap)
    })

    // Verifies the OS/2 capHeight metric is preserved by WOFF/WOFF2 decoding.
    it('capHeight should match across all formats', () => {
      expect(woffFont.metrics.capHeight).toBe(ttfFont.metrics.capHeight)
      expect(woff2Font.metrics.capHeight).toBe(ttfFont.metrics.capHeight)
    })

    // Verifies the OS/2 xHeight metric is preserved by WOFF/WOFF2 decoding.
    it('xHeight should match across all formats', () => {
      expect(woffFont.metrics.xHeight).toBe(ttfFont.metrics.xHeight)
      expect(woff2Font.metrics.xHeight).toBe(ttfFont.metrics.xHeight)
    })

    // Verifies the post-table italicAngle is preserved by WOFF/WOFF2 decoding.
    it('italicAngle should match across all formats', () => {
      expect(woffFont.metrics.italicAngle).toBe(ttfFont.metrics.italicAngle)
      expect(woff2Font.metrics.italicAngle).toBe(ttfFont.metrics.italicAngle)
    })

    // Verifies the bold style flag is identical across formats.
    it('isBold should match across all formats', () => {
      expect(woffFont.metrics.isBold).toBe(ttfFont.metrics.isBold)
      expect(woff2Font.metrics.isBold).toBe(ttfFont.metrics.isBold)
    })

    // Verifies the italic style flag is identical across formats.
    it('isItalic should match across all formats', () => {
      expect(woffFont.metrics.isItalic).toBe(ttfFont.metrics.isItalic)
      expect(woff2Font.metrics.isItalic).toBe(ttfFont.metrics.isItalic)
    })

    // Verifies the monospace detection flag is identical across formats.
    it('isMonospace should match across all formats', () => {
      expect(woffFont.metrics.isMonospace).toBe(ttfFont.metrics.isMonospace)
      expect(woff2Font.metrics.isMonospace).toBe(ttfFont.metrics.isMonospace)
    })
  })

  describe('Glyph count', () => {
    // Verifies maxp.numGlyphs is identical across formats, guarding against dropped glyphs in decompression.
    it('numGlyphs should match across all formats', () => {
      expect(woffFont.numGlyphs).toBe(ttfFont.numGlyphs)
      expect(woff2Font.numGlyphs).toBe(ttfFont.numGlyphs)
    })
  })

  describe('Codepoint to glyphId mapping', () => {
    const testCodepoints = [
      { name: 'A', cp: 0x0041 },
      { name: 'Z', cp: 0x005A },
      { name: 'a', cp: 0x0061 },
      { name: 'z', cp: 0x007A },
      { name: '0', cp: 0x0030 },
      { name: '9', cp: 0x0039 },
      { name: 'space', cp: 0x0020 },
      { name: '!', cp: 0x0021 },
      { name: '@', cp: 0x0040 },
      { name: 'period', cp: 0x002E },
    ]

    for (const { name, cp } of testCodepoints) {
      // Verifies cmap lookup returns the same glyph ID in every container format for this codepoint.
      it(`glyphId for "${name}" (U+${cp.toString(16).padStart(4, '0').toUpperCase()}) should match across formats`, () => {
        const ttfGid = ttfFont.getGlyphId(cp)
        const woffGid = woffFont.getGlyphId(cp)
        const woff2Gid = woff2Font.getGlyphId(cp)

        expect(woffGid).toBe(ttfGid)
        expect(woff2Gid).toBe(ttfGid)
      })
    }
  })

  describe('Advance widths', () => {
    const testChars = [0x0041, 0x0061, 0x0057, 0x0069, 0x004D, 0x0020] // A, a, W, i, M, space

    for (const cp of testChars) {
      // Verifies the hmtx advance width for this character is identical in every container format.
      it(`advance width for U+${cp.toString(16).padStart(4, '0').toUpperCase()} should match across formats`, () => {
        const ttfGid = ttfFont.getGlyphId(cp)
        const woffGid = woffFont.getGlyphId(cp)
        const woff2Gid = woff2Font.getGlyphId(cp)

        const ttfAdv = ttfFont.getAdvanceWidth(ttfGid)
        const woffAdv = woffFont.getAdvanceWidth(woffGid)
        const woff2Adv = woff2Font.getAdvanceWidth(woff2Gid)

        expect(woffAdv).toBe(ttfAdv)
        expect(woff2Adv).toBe(ttfAdv)
      })
    }
  })

  describe('Glyph outlines', () => {
    const testCodepoints = [0x0041, 0x0042, 0x0061, 0x0067] // A, B, a, g

    for (const cp of testCodepoints) {
      // Verifies WOFF glyf decompression reproduces the TTF outline exactly (same commands and coordinates).
      it(`outline for U+${cp.toString(16).padStart(4, '0').toUpperCase()} should match across TTF and WOFF`, () => {
        const ttfGlyph = ttfFont.getGlyphByCodePoint(cp)
        const woffGlyph = woffFont.getGlyphByCodePoint(cp)

        // Command sequences must be identical
        expect(woffGlyph.outline.commands.length).toBe(ttfGlyph.outline.commands.length)
        for (let i = 0; i < ttfGlyph.outline.commands.length; i++) {
          expect(woffGlyph.outline.commands[i]).toBe(ttfGlyph.outline.commands[i])
        }

        // Coordinate values must be identical
        expect(woffGlyph.outline.coords.length).toBe(ttfGlyph.outline.coords.length)
        for (let i = 0; i < ttfGlyph.outline.coords.length; i++) {
          expect(woffGlyph.outline.coords[i]).toBeCloseTo(ttfGlyph.outline.coords[i]!, 2)
        }
      })
    }

    for (const cp of testCodepoints) {
      // Verifies WOFF2 transformed-glyf reconstruction reproduces the TTF outline exactly.
      it(`outline for U+${cp.toString(16).padStart(4, '0').toUpperCase()} should match across TTF and WOFF2`, () => {
        const ttfGlyph = ttfFont.getGlyphByCodePoint(cp)
        const woff2Glyph = woff2Font.getGlyphByCodePoint(cp)

        // Command sequences must be identical
        expect(woff2Glyph.outline.commands.length).toBe(ttfGlyph.outline.commands.length)
        for (let i = 0; i < ttfGlyph.outline.commands.length; i++) {
          expect(woff2Glyph.outline.commands[i]).toBe(ttfGlyph.outline.commands[i])
        }

        // Coordinate values must be identical
        expect(woff2Glyph.outline.coords.length).toBe(ttfGlyph.outline.coords.length)
        for (let i = 0; i < ttfGlyph.outline.coords.length; i++) {
          expect(woff2Glyph.outline.coords[i]).toBeCloseTo(ttfGlyph.outline.coords[i]!, 2)
        }
      })
    }

    // Verifies glyph bounding boxes (xMin/yMin/xMax/yMax) are preserved across formats, including WOFF2 bbox reconstruction.
    it('bounding boxes should match for letter "A" across formats', () => {
      const ttfGlyph = ttfFont.getGlyphByCodePoint(0x0041)
      const woffGlyph = woffFont.getGlyphByCodePoint(0x0041)
      const woff2Glyph = woff2Font.getGlyphByCodePoint(0x0041)

      expect(woffGlyph.xMin).toBe(ttfGlyph.xMin)
      expect(woffGlyph.yMin).toBe(ttfGlyph.yMin)
      expect(woffGlyph.xMax).toBe(ttfGlyph.xMax)
      expect(woffGlyph.yMax).toBe(ttfGlyph.yMax)

      expect(woff2Glyph.xMin).toBe(ttfGlyph.xMin)
      expect(woff2Glyph.yMin).toBe(ttfGlyph.yMin)
      expect(woff2Glyph.xMax).toBe(ttfGlyph.xMax)
      expect(woff2Glyph.yMax).toBe(ttfGlyph.yMax)
    })

    // Verifies per-glyph horizontal metrics (advanceWidth, lsb) are preserved, covering WOFF2 hmtx transform.
    it('advanceWidth and lsb should match for "A" across formats', () => {
      const ttfGlyph = ttfFont.getGlyphByCodePoint(0x0041)
      const woffGlyph = woffFont.getGlyphByCodePoint(0x0041)
      const woff2Glyph = woff2Font.getGlyphByCodePoint(0x0041)

      expect(woffGlyph.advanceWidth).toBe(ttfGlyph.advanceWidth)
      expect(woffGlyph.lsb).toBe(ttfGlyph.lsb)

      expect(woff2Glyph.advanceWidth).toBe(ttfGlyph.advanceWidth)
      expect(woff2Glyph.lsb).toBe(ttfGlyph.lsb)
    })
  })

  describe('TextMeasurer consistency', () => {
    // Verifies end-to-end text width measurement is format-independent for a simple string.
    it('should produce same width for "Hello World" across all formats', () => {
      const ttfMeasurer = new TextMeasurer(ttfFont)
      const woffMeasurer = new TextMeasurer(woffFont)
      const woff2Measurer = new TextMeasurer(woff2Font)

      const text = 'Hello World'
      const fontSize = 16

      const ttfResult = ttfMeasurer.measure(text, fontSize)
      const woffResult = woffMeasurer.measure(text, fontSize)
      const woff2Result = woff2Measurer.measure(text, fontSize)

      expect(woffResult.width).toBeCloseTo(ttfResult.width, 5)
      expect(woff2Result.width).toBeCloseTo(ttfResult.width, 5)
    })

    // Verifies each per-character advance in the measure result matches across formats, not just the total width.
    it('should produce same per-character advances across all formats', () => {
      const ttfMeasurer = new TextMeasurer(ttfFont)
      const woffMeasurer = new TextMeasurer(woffFont)
      const woff2Measurer = new TextMeasurer(woff2Font)

      const text = 'ABCxyz123'
      const fontSize = 12

      const ttfResult = ttfMeasurer.measure(text, fontSize)
      const woffResult = woffMeasurer.measure(text, fontSize)
      const woff2Result = woff2Measurer.measure(text, fontSize)

      expect(woffResult.advances.length).toBe(ttfResult.advances.length)
      expect(woff2Result.advances.length).toBe(ttfResult.advances.length)

      for (let i = 0; i < ttfResult.advances.length; i++) {
        expect(woffResult.advances[i]).toBeCloseTo(ttfResult.advances[i]!, 5)
        expect(woff2Result.advances[i]).toBeCloseTo(ttfResult.advances[i]!, 5)
      }
    })

    // Verifies getLineHeight, which derives from vertical metrics, is format-independent.
    it('should produce same line height across all formats', () => {
      const ttfMeasurer = new TextMeasurer(ttfFont)
      const woffMeasurer = new TextMeasurer(woffFont)
      const woff2Measurer = new TextMeasurer(woff2Font)

      const fontSize = 14

      const ttfLineHeight = ttfMeasurer.getLineHeight(fontSize)
      const woffLineHeight = woffMeasurer.getLineHeight(fontSize)
      const woff2LineHeight = woff2Measurer.getLineHeight(fontSize)

      expect(woffLineHeight).toBeCloseTo(ttfLineHeight, 5)
      expect(woff2LineHeight).toBeCloseTo(ttfLineHeight, 5)
    })

    // Verifies scaled ascent and descent values are format-independent.
    it('should produce same ascent and descent across all formats', () => {
      const ttfMeasurer = new TextMeasurer(ttfFont)
      const woffMeasurer = new TextMeasurer(woffFont)
      const woff2Measurer = new TextMeasurer(woff2Font)

      const fontSize = 10

      expect(woffMeasurer.getAscent(fontSize)).toBeCloseTo(ttfMeasurer.getAscent(fontSize), 5)
      expect(woff2Measurer.getAscent(fontSize)).toBeCloseTo(ttfMeasurer.getAscent(fontSize), 5)

      expect(woffMeasurer.getDescent(fontSize)).toBeCloseTo(ttfMeasurer.getDescent(fontSize), 5)
      expect(woff2Measurer.getDescent(fontSize)).toBeCloseTo(ttfMeasurer.getDescent(fontSize), 5)
    })

    // Verifies measurement stays consistent across formats for a long string mixing letters, digits, and symbols.
    it('should produce same measurement for long mixed text', () => {
      const ttfMeasurer = new TextMeasurer(ttfFont)
      const woffMeasurer = new TextMeasurer(woffFont)
      const woff2Measurer = new TextMeasurer(woff2Font)

      const text = 'The quick brown fox jumps over the lazy dog. 0123456789!@#$%'
      const fontSize = 24

      const ttfResult = ttfMeasurer.measure(text, fontSize)
      const woffResult = woffMeasurer.measure(text, fontSize)
      const woff2Result = woff2Measurer.measure(text, fontSize)

      expect(woffResult.width).toBeCloseTo(ttfResult.width, 3)
      expect(woff2Result.width).toBeCloseTo(ttfResult.width, 3)
    })
  })

  describe('Format property differences', () => {
    // Verifies the format property correctly identifies the source container of each loaded font.
    it('each font should report its own format', () => {
      expect(ttfFont.format).toBe('ttf')
      expect(woffFont.format).toBe('woff')
      expect(woff2Font.format).toBe('woff2')
    })

    // Verifies isCff stays false for all containers since Roboto uses TrueType (glyf) outlines.
    it('all three should report isCff as false (Roboto is TTF-based)', () => {
      expect(ttfFont.isCff).toBe(false)
      expect(woffFont.isCff).toBe(false)
      expect(woff2Font.isCff).toBe(false)
    })
  })
})
