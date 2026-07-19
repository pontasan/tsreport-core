import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseHead } from '../../../src/parsers/tables/head.js'
import { parseMaxp } from '../../../src/parsers/tables/maxp.js'
import { parseLoca } from '../../../src/parsers/tables/loca.js'
import { parseCmap } from '../../../src/parsers/tables/cmap.js'
import { parseGlyph, rawPointsToOutline, parseSimpleGlyphPoints } from '../../../src/parsers/tables/glyf.js'
import { PathCommand, PATH_COMMAND_COORDS } from '../../../src/types/glyph.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')

function loadGlyfDeps(fontPath: string) {
  const buffer = readFileSync(fontPath).buffer as ArrayBuffer
  const sfnt = parseSfntDirectory(buffer)
  const head = parseHead(getTableReader(sfnt, 'head')!)
  const maxp = parseMaxp(getTableReader(sfnt, 'maxp')!)
  const loca = parseLoca(getTableReader(sfnt, 'loca')!, maxp.numGlyphs, head.indexToLocFormat)
  const cmap = parseCmap(getTableReader(sfnt, 'cmap')!)
  const glyfReader = getTableReader(sfnt, 'glyf')!
  return { loca, maxp, cmap, glyfReader }
}

/**
 * Validate that commands and coords arrays are consistent:
 * the total coords consumed by all commands should equal coords.length
 */
function validateOutlineConsistency(
  commands: Uint8Array,
  coords: Float32Array,
) {
  let expectedCoords = 0
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    switch (cmd) {
      case PathCommand.MoveTo:
        expectedCoords += 2
        break
      case PathCommand.LineTo:
        expectedCoords += 2
        break
      case PathCommand.CubicTo:
        expectedCoords += 6
        break
      case PathCommand.Close:
        expectedCoords += 0
        break
      default:
        throw new Error(`Unknown command: ${cmd}`)
    }
  }
  expect(coords.length).toBe(expectedCoords)
}

describe('glyf table parser', () => {
  describe('NotoSans-Regular simple glyphs', () => {
    const { loca, cmap, glyfReader } = loadGlyfDeps(NOTO_SANS_PATH)

    // Verifies that a real simple glyph yields a well-formed command stream (starts with MoveTo, includes draw commands and Close) with matching coord counts.
    it('should parse glyph "A" with MoveTo, LineTo/CubicTo, and Close commands', () => {
      const glyphIdA = cmap.getGlyphId(0x0041) // 'A'
      expect(glyphIdA).toBeGreaterThan(0)

      const outline = parseGlyph(glyfReader, loca, glyphIdA)
      expect(outline.commands.length).toBeGreaterThan(0)
      expect(outline.coords.length).toBeGreaterThan(0)

      // First command should be MoveTo
      expect(outline.commands[0]).toBe(PathCommand.MoveTo)

      // Should contain at least one Close command
      const hasClose = Array.from(outline.commands).includes(PathCommand.Close)
      expect(hasClose).toBe(true)

      // Should contain LineTo or CubicTo commands
      const hasLineOrCubic = Array.from(outline.commands).some(
        cmd => cmd === PathCommand.LineTo || cmd === PathCommand.CubicTo
      )
      expect(hasLineOrCubic).toBe(true)

      validateOutlineConsistency(outline.commands, outline.coords)
    })

    // Verifies that a zero-length loca entry (space) yields an empty outline rather than an error.
    it('should parse space glyph with empty outline', () => {
      const glyphIdSpace = cmap.getGlyphId(0x0020) // space
      expect(glyphIdSpace).toBeGreaterThan(0)

      const outline = parseGlyph(glyfReader, loca, glyphIdSpace)
      expect(outline.commands.length).toBe(0)
      expect(outline.coords.length).toBe(0)
    })

    // Verifies that glyph 0 (.notdef) parses without throwing and its outline stays internally consistent.
    it('should parse .notdef glyph (glyph 0) without error', () => {
      const outline = parseGlyph(glyfReader, loca, 0)
      // .notdef may or may not have outlines depending on the font
      validateOutlineConsistency(outline.commands, outline.coords)
    })

    // Verifies that every CubicTo consumes exactly 6 finite coordinates when walking the coord array.
    it('CubicTo commands should have 6 coordinates each', () => {
      const glyphIdO = cmap.getGlyphId(0x004F) // 'O' - likely has curves
      const outline = parseGlyph(glyfReader, loca, glyphIdO)

      let coordIdx = 0
      for (let i = 0; i < outline.commands.length; i++) {
        const cmd = outline.commands[i]!
        if (cmd === PathCommand.CubicTo) {
          // Each CubicTo should consume 6 coords: cp1x, cp1y, cp2x, cp2y, x, y
          expect(coordIdx + 6).toBeLessThanOrEqual(outline.coords.length)
          // All coordinates should be finite numbers
          for (let j = 0; j < 6; j++) {
            expect(Number.isFinite(outline.coords[coordIdx + j])).toBe(true)
          }
          coordIdx += 6
        } else if (cmd === PathCommand.MoveTo || cmd === PathCommand.LineTo) {
          coordIdx += 2
        }
        // Close has 0 coords
      }
    })

    // Smoke-tests a range of letter glyphs to ensure parsing yields consistent non-empty outlines across shapes.
    it('should parse multiple different letter glyphs', () => {
      const testCodePoints = [
        0x0042, // B
        0x0043, // C
        0x0044, // D
        0x0048, // H
        0x004F, // O
        0x0053, // S
        0x0061, // a
        0x0065, // e
        0x006F, // o
      ]

      for (const cp of testCodePoints) {
        const glyphId = cmap.getGlyphId(cp)
        expect(glyphId).toBeGreaterThan(0)

        const outline = parseGlyph(glyfReader, loca, glyphId)
        expect(outline.commands.length).toBeGreaterThan(0)
        expect(outline.coords.length).toBeGreaterThan(0)
        validateOutlineConsistency(outline.commands, outline.coords)
      }
    })

    // Verifies contour structure on a multi-contour glyph ('B'): after every Close the next command is a MoveTo.
    it('each contour should start with MoveTo and end with Close', () => {
      const glyphIdB = cmap.getGlyphId(0x0042) // 'B'
      const outline = parseGlyph(glyfReader, loca, glyphIdB)

      let expectMoveTo = true
      for (let i = 0; i < outline.commands.length; i++) {
        const cmd = outline.commands[i]!
        if (expectMoveTo) {
          expect(cmd).toBe(PathCommand.MoveTo)
          expectMoveTo = false
        }
        if (cmd === PathCommand.Close) {
          expectMoveTo = true
        }
      }
    })
  })

  describe('NotoSans-Regular composite glyphs', () => {
    const { loca, cmap, glyfReader } = loadGlyfDeps(NOTO_SANS_PATH)

    // Verifies that composite glyphs (accented letters built from components) resolve to a flattened, consistent outline.
    it('should parse accented character (composite glyph)', () => {
      // Try common accented characters that are typically composite glyphs
      const accentedCodePoints = [
        0x00C9, // E with acute
        0x00E9, // e with acute
        0x00C0, // A with grave
        0x00FC, // u with diaeresis
        0x00F1, // n with tilde
      ]

      let parsedComposite = false
      for (const cp of accentedCodePoints) {
        const glyphId = cmap.getGlyphId(cp)
        if (glyphId === 0) continue // skip if not in font

        const outline = parseGlyph(glyfReader, loca, glyphId)
        if (outline.commands.length > 0) {
          parsedComposite = true
          expect(outline.commands.length).toBeGreaterThan(0)
          expect(outline.coords.length).toBeGreaterThan(0)
          validateOutlineConsistency(outline.commands, outline.coords)
        }
      }

      // At least one accented character should have been parsed
      expect(parsedComposite).toBe(true)
    })

    // Verifies component merging: E-acute must contain at least the base 'E' outline plus the accent contour.
    it('composite glyph should have more commands than its base glyph', () => {
      const glyphIdE = cmap.getGlyphId(0x0045) // 'E'
      const glyphIdEacute = cmap.getGlyphId(0x00C9) // 'E' with acute

      if (glyphIdEacute === 0) return // skip if not in font

      const outlineE = parseGlyph(glyfReader, loca, glyphIdE)
      const outlineEacute = parseGlyph(glyfReader, loca, glyphIdEacute)

      // The accented version should have at least as many commands
      // (it contains the base glyph plus the accent mark)
      expect(outlineEacute.commands.length).toBeGreaterThanOrEqual(outlineE.commands.length)
    })
  })

  describe('Roboto-Regular', () => {
    const { loca, cmap, glyfReader } = loadGlyfDeps(ROBOTO_PATH)

    // Verifies the parser against a second font (Roboto) to guard against fixture-specific assumptions.
    it('should parse glyph "A" with valid outline', () => {
      const glyphIdA = cmap.getGlyphId(0x0041)
      const outline = parseGlyph(glyfReader, loca, glyphIdA)

      expect(outline.commands.length).toBeGreaterThan(0)
      expect(outline.coords.length).toBeGreaterThan(0)
      expect(outline.commands[0]).toBe(PathCommand.MoveTo)
      validateOutlineConsistency(outline.commands, outline.coords)
    })

    // Verifies that Roboto's space glyph also parses to an empty outline.
    it('should parse space with empty outline', () => {
      const glyphIdSpace = cmap.getGlyphId(0x0020)
      const outline = parseGlyph(glyfReader, loca, glyphIdSpace)
      expect(outline.commands.length).toBe(0)
      expect(outline.coords.length).toBe(0)
    })

    // Verifies that no NaN/Infinity leaks into the coord array (e.g. from delta decoding or quad-to-cubic math).
    it('all coordinates should be finite', () => {
      const glyphIdR = cmap.getGlyphId(0x0052) // 'R'
      const outline = parseGlyph(glyfReader, loca, glyphIdR)

      for (let i = 0; i < outline.coords.length; i++) {
        expect(Number.isFinite(outline.coords[i])).toBe(true)
      }
    })
  })

  describe('quad-to-cubic bezier conversion', () => {
    const { loca, cmap, glyfReader } = loadGlyfDeps(NOTO_SANS_PATH)

    // Verifies via PATH_COMMAND_COORDS that the command stream consumes the coord array exactly, with no leftover coords.
    it('converted CubicTo should have exactly 6 coords per command', () => {
      // 'O' should contain curves (quad bezier in TrueType -> converted to cubic)
      const glyphIdO = cmap.getGlyphId(0x004F)
      const outline = parseGlyph(glyfReader, loca, glyphIdO)

      let coordIdx = 0
      for (let i = 0; i < outline.commands.length; i++) {
        const cmd = outline.commands[i]!
        const numCoords = PATH_COMMAND_COORDS[cmd as PathCommand]
        expect(numCoords).toBeDefined()
        expect(coordIdx + numCoords).toBeLessThanOrEqual(outline.coords.length)
        coordIdx += numCoords
      }
      expect(coordIdx).toBe(outline.coords.length)
    })

    // Verifies that TrueType quadratic curves are always converted, so only MoveTo/LineTo/CubicTo/Close appear.
    it('should not produce QuadTo commands (all quads converted to cubics)', () => {
      const glyphIdS = cmap.getGlyphId(0x0053) // 'S' - lots of curves
      const outline = parseGlyph(glyfReader, loca, glyphIdS)

      for (let i = 0; i < outline.commands.length; i++) {
        const cmd = outline.commands[i]!
        // Only valid commands: MoveTo(0), LineTo(1), CubicTo(2), Close(3)
        expect(cmd).toBeGreaterThanOrEqual(0)
        expect(cmd).toBeLessThanOrEqual(3)
      }
    })

    // Verifies that inherently curved glyphs (O, S, o) actually produce CubicTo commands after conversion.
    it('curved glyphs should contain CubicTo commands', () => {
      // 'O' and 'S' are curved glyphs that must have CubicTo after conversion
      const curvedCodePoints = [0x004F, 0x0053, 0x006F] // O, S, o
      for (const cp of curvedCodePoints) {
        const glyphId = cmap.getGlyphId(cp)
        const outline = parseGlyph(glyfReader, loca, glyphId)
        const hasCubic = Array.from(outline.commands).includes(PathCommand.CubicTo)
        expect(hasCubic).toBe(true)
      }
    })
  })

  describe('regression: all-off-curve contour', () => {
    // Regression: a contour whose points are all off-curve must synthesize its start point as the midpoint of the first and last points and still close.
    it('should produce a closed contour with correct start point', () => {
      // Synthetic glyf data: 1 contour, 3 off-curve points (circle-like)
      // All flags have ON_CURVE_POINT bit = 0
      const raw = {
        endPts: new Uint16Array([2]), // 3 points: 0,1,2
        flags: new Uint8Array([0x00, 0x00, 0x00]), // all off-curve
        xCoords: [0, 100, 50] as number[],
        yCoords: [0, 0, 87] as number[],
        numPoints: 3,
        numberOfContours: 1,
      }

      const outline = rawPointsToOutline(raw)
      expect(outline.commands.length).toBeGreaterThan(0)
      validateOutlineConsistency(outline.commands, outline.coords)

      // First command must be MoveTo
      expect(outline.commands[0]).toBe(PathCommand.MoveTo)
      // Last command must be Close
      expect(outline.commands[outline.commands.length - 1]).toBe(PathCommand.Close)

      // Start point should be midpoint of first (0,0) and last (50,87) = (25, 43.5)
      expect(outline.coords[0]).toBe(25)
      expect(outline.coords[1]).toBeCloseTo(43.5)

      // All coordinates should be finite
      for (let i = 0; i < outline.coords.length; i++) {
        expect(Number.isFinite(outline.coords[i])).toBe(true)
      }
    })
  })

  describe('regression: RawSimpleGlyph uses number[] for coordinates', () => {
    const { loca, cmap, glyfReader } = loadGlyfDeps(NOTO_SANS_PATH)

    // Regression: raw coords must be number[] (not Int16Array) so gvar deltas beyond the int16 range do not wrap.
    it('parseSimpleGlyphPoints returns number[] that can hold large values', () => {
      const glyphIdA = cmap.getGlyphId(0x0041)
      const raw = parseSimpleGlyphPoints(glyfReader, loca, glyphIdA)
      expect(raw).not.toBeNull()

      // Verify coordinates are number[] (can hold values > Int16 range)
      // Simulate gvar delta that would overflow Int16Array
      const originalX = raw!.xCoords[0]!
      raw!.xCoords[0] = 40000 // Would overflow Int16Array (max 32767)
      expect(raw!.xCoords[0]).toBe(40000) // number[] can hold this
      raw!.xCoords[0] = originalX // restore
    })
  })

  describe('edge cases', () => {
    const { loca, maxp, glyfReader } = loadGlyfDeps(NOTO_SANS_PATH)

    // Verifies malformed callers cannot silently alias an out-of-range glyph to glyph zero.
    it('out-of-range glyphId should be rejected', () => {
      expect(() => parseGlyph(glyfReader, loca, maxp.numGlyphs + 100)).toThrow(/outside loca glyph range/)
    })

    // Verifies negative glyph IDs are rejected instead of silently producing blank output.
    it('negative glyphId should be rejected', () => {
      expect(() => parseGlyph(glyfReader, loca, -1)).toThrow(/outside loca glyph range/)
    })
  })

  describe('SfntTableManager getGlyphOutline', () => {
    // Verifies the high-level getGlyphOutline API combines glyf outline data with hmtx advance width.
    it('should return glyph via manager for TTF font', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      const glyphIdA = manager.cmap.getGlyphId(0x0041)
      const glyph = manager.getGlyphOutline(glyphIdA)

      expect(glyph.glyphId).toBe(glyphIdA)
      expect(glyph.advanceWidth).toBeGreaterThan(0)
      expect(glyph.outline.commands.length).toBeGreaterThan(0)
      expect(glyph.outline.coords.length).toBeGreaterThan(0)
      validateOutlineConsistency(glyph.outline.commands, glyph.outline.coords)
    })

    // Verifies that a blank glyph still carries its metric (advance width) even though it has no outline.
    it('space glyph should have advanceWidth > 0 but empty outline', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      const glyphIdSpace = manager.cmap.getGlyphId(0x0020)
      const glyph = manager.getGlyphOutline(glyphIdSpace)

      expect(glyph.advanceWidth).toBeGreaterThan(0)
      expect(glyph.outline.commands.length).toBe(0)
      expect(glyph.outline.coords.length).toBe(0)
    })
  })
})
