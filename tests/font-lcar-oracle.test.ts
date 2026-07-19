// AAT ligature caret (lcar) consumption validated against real system fonts
// that carry an lcar table (macOS Apple Chancery / Hoefler Text). Skipped when
// those fonts are absent (non-macOS CI).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { Font } from '../src/font.js'
import { TextMeasurer } from '../src/measure/text-measurer.js'
import { layoutText } from '../src/layout/text-layout.js'

const APPLE_CHANCERY = '/System/Library/Fonts/Supplemental/Apple Chancery.ttf'

describe.skipIf(!existsSync(APPLE_CHANCERY))('AAT lcar ligature-caret consumption', () => {
  it('returns sane caret positions for ligature glyphs in a real lcar font', () => {
    const font = Font.load(readFileSync(APPLE_CHANCERY).buffer as ArrayBuffer)
    let ligaturesWithCarets = 0
    for (let g = 0; g < 3000 && ligaturesWithCarets < 20; g++) {
      const carets = font.getLigatureCaretPositions(g)
      if (carets === null || carets.length === 0) continue
      ligaturesWithCarets++
      const advance = font.getAdvanceWidth(g)
      // Carets partition the ligature: each lies within the glyph advance and
      // the sequence is strictly increasing.
      for (const c of carets) {
        expect(c).toBeGreaterThan(0)
        expect(c).toBeLessThanOrEqual(advance)
      }
      for (let i = 1; i < carets.length; i++) expect(carets[i]!).toBeGreaterThan(carets[i - 1]!)
    }
    // The font is known to carry ligature carets; the API must surface them.
    expect(ligaturesWithCarets).toBeGreaterThan(0)
  })

  it('returns null for a glyph without ligature carets (a space)', () => {
    const font = Font.load(readFileSync(APPLE_CHANCERY).buffer as ArrayBuffer)
    const space = font.getGlyphId(0x20)
    const carets = font.getLigatureCaretPositions(space)
    expect(carets === null || carets.length === 0).toBe(true)
  })

  it('exposes real lcar divisions as scaled public layout caret stops', () => {
    const font = Font.load(readFileSync(APPLE_CHANCERY).buffer as ArrayBuffer)
    const candidates = ['ffi', 'ffl', 'fi', 'fl']
    let text = ''
    let glyphId = 0
    let caretValues: number[] = []
    for (let i = 0; i < candidates.length && text === ''; i++) {
      const shaped = font.shapeText(candidates[i]!)
      for (let g = 0; g < shaped.length; g++) {
        const values = font.getLigatureCaretPositions(shaped[g]!.glyphId)
        if (values !== null && values.length > 0) {
          text = candidates[i]!
          glyphId = shaped[g]!.glyphId
          caretValues = values
          break
        }
      }
    }
    expect(text).not.toBe('')
    const fontSize = 24
    const line = layoutText(text, new TextMeasurer(font), fontSize, { maxWidth: 1000 }).lines[0]!
    const glyphIndex = Array.from(line.run!.glyphIds).indexOf(glyphId)
    expect(glyphIndex).toBeGreaterThanOrEqual(0)
    let pen = 0
    for (let i = 0; i < glyphIndex; i++) pen += line.run!.advances[i]!
    const scale = fontSize / font.metrics.unitsPerEm
    const stops = Array.from(line.caretPositions!)
    for (let i = 0; i < caretValues.length; i++) {
      expect(stops).toContain(pen + line.run!.xOffsets[glyphIndex]! + caretValues[i]! * scale)
    }
  })
})
