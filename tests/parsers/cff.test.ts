import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, PathCommand } from '../../src/index.js'

const OTF_PATH = resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf')

describe('CFF parser (OTF)', () => {
  // Verifies an OTTO-flavored font loads with the CFF flag set and format 'otf'.
  it('should load an OTF font', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font).toBeInstanceOf(Font)
    expect(font.isCff).toBe(true)
    expect(font.format).toBe('otf')
  })

  // Verifies family and PostScript names are read from an OTF's name table.
  it('should expose font names', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.familyName).toBeTruthy()
    expect(font.postScriptName).toBeTruthy()
  })

  // Verifies core vertical metrics (unitsPerEm/ascender/descender) have sane values and signs.
  it('should expose metrics', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const m = font.metrics
    expect(m.unitsPerEm).toBeGreaterThan(0)
    expect(m.ascender).toBeGreaterThan(0)
    expect(m.descender).toBeLessThan(0)
  })

  // Verifies cmap lookup resolves 'A' to a non-notdef glyph ID.
  it('should resolve code points to glyph IDs', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const gidA = font.getGlyphId(0x0041) // 'A'
    expect(gidA).toBeGreaterThan(0)
  })

  // Verifies CFF charstrings decode to outlines containing native cubic Beziers.
  it('should parse CFF charstrings to cubic bezier outlines', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyphByCodePoint(0x0041) // 'A'
    expect(glyph.advanceWidth).toBeGreaterThan(0)
    expect(glyph.outline.commands.length).toBeGreaterThan(0)
    expect(glyph.outline.coords.length).toBeGreaterThan(0)

    // CFF produces cubic beziers natively
    let hasCubic = false
    for (let i = 0; i < glyph.outline.commands.length; i++) {
      if (glyph.outline.commands[i] === PathCommand.CubicTo) {
        hasCubic = true
        break
      }
    }
    expect(hasCubic).toBe(true)
  })

  // Verifies the space glyph has an advance width but no outline commands.
  it('should return empty outline for space', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const glyph = font.getGlyphByCodePoint(0x0020)
    expect(glyph.advanceWidth).toBeGreaterThan(0)
    expect(glyph.outline.commands.length).toBe(0)
  })

  // Verifies command/coordinate alignment holds across several parsed glyphs.
  it('should produce valid command/coord alignment', () => {
    const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Check multiple glyphs
    for (const cp of [0x41, 0x42, 0x43, 0x61, 0x62, 0x63]) {
      const glyph = font.getGlyphByCodePoint(cp)
      const { commands, coords } = glyph.outline

      let coordIdx = 0
      for (let i = 0; i < commands.length; i++) {
        switch (commands[i]) {
          case PathCommand.MoveTo: coordIdx += 2; break
          case PathCommand.LineTo: coordIdx += 2; break
          case PathCommand.CubicTo: coordIdx += 6; break
          case PathCommand.Close: break
        }
      }
      expect(coordIdx).toBe(coords.length)
    }
  })
})
