import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { layoutText, type TextLayoutOptions } from '../../src/layout/text-layout.js'

// ─── Mock TextMeasurer (fixed-width characters) ───

/**
 * Mock that measures every character at a fixed width of 5pt.
 * upm=1000, ascender=800, descender=-200, lineGap=0
 */
function createFixedWidthMeasurer(): TextMeasurer {
  const upm = 1000
  const charWidth = 500 // units
  const asc = 800
  const desc = -200
  return {
    font: {
      metrics: { unitsPerEm: upm, ascender: asc, descender: desc, lineGap: 0 },
    },
    measure(text: string, fontSize: number) {
      const scale = fontSize / upm
      const advances = new Float64Array(text.length)
      for (let i = 0; i < text.length; i++) {
        advances[i] = charWidth * scale
      }
      return { width: text.length * charWidth * scale, advances }
    },
    measureShaped(text: string, fontSize: number) {
      const m = this.measure(text, fontSize)
      const n = m.advances.length
      const shaped = new Array(n)
      const cpToGlyph = new Int32Array(n)
      for (let i = 0; i < n; i++) {
        shaped[i] = { glyphId: 0, xOffset: 0, yOffset: 0, xAdvance: charWidth, yAdvance: charWidth, componentCount: 1 }
        cpToGlyph[i] = i
      }
      return { width: m.width, advances: m.advances, shaped, cpToGlyph }
    },
    getLineHeight(fontSize: number) {
      return (asc - desc) * (fontSize / upm)
    },
    getAscent(fontSize: number) {
      return asc * (fontSize / upm)
    },
    getDescent(fontSize: number) {
      return desc * (fontSize / upm)
    },
  } as unknown as TextMeasurer
}

function defaultOptions(overrides: Partial<TextLayoutOptions> = {}): TextLayoutOptions {
  return {
    maxWidth: 200,
    ...overrides,
  }
}

// ─── Tests ───

describe('Arabic text wrapping', () => {
  const measurer = createFixedWidthMeasurer()
  // fontSize=10, upm=1000 → 1 char = 5pt

  // Verifies that the Arabic comma is treated as a break opportunity and ends a line.
  it('Arabic comma (U+060C) allows line break after it', () => {
    // 10 chars before comma + comma + 10 chars after = 21 chars × 5pt = 105pt
    // maxWidth=60pt → should break after comma (11 chars = 55pt fits)
    const text = '\u0645\u0631\u062D\u0628\u0627\u0020\u0628\u0643\u0645\u0020\u060C\u0634\u0643\u0631\u0627\u0020\u0644\u0643\u0645\u0020\u0627'
    const result = layoutText(text, measurer, 10, defaultOptions({ maxWidth: 60 }))
    expect(result.lines.length).toBeGreaterThan(1)
    // Verify one of the lines ends with the Arabic comma
    let commaAtLineEnd = false
    for (let i = 0; i < result.lines.length - 1; i++) {
      const lineText = result.lines[i]!.text
      if (lineText[lineText.length - 1] === '\u060C') {
        commaAtLineEnd = true
      }
    }
    expect(commaAtLineEnd).toBe(true)
  })

  // Verifies that the Arabic question mark is a preferred break point and ends a line.
  it('Arabic question mark (U+061F) allows line break after it', () => {
    // Build text: 8 Arabic chars + question mark + 8 Arabic chars
    // 17 chars × 5pt = 85pt; maxWidth = 50pt → must break
    const text = '\u0645\u0627\u0630\u0627\u0020\u062A\u0631\u064A\u061F\u0647\u0630\u0627\u0020\u062C\u064A\u062F\u0627'
    const result = layoutText(text, measurer, 10, defaultOptions({ maxWidth: 50 }))
    expect(result.lines.length).toBeGreaterThan(1)
    // Verify the question mark is at the end of a line (preferred break point)
    let qmarkAtLineEnd = false
    for (let i = 0; i < result.lines.length - 1; i++) {
      const lineText = result.lines[i]!.text
      if (lineText[lineText.length - 1] === '\u061F') {
        qmarkAtLineEnd = true
      }
    }
    expect(qmarkAtLineEnd).toBe(true)
  })

  // Verifies that a single Arabic word fitting the width stays on one line without a mid-word break.
  it('Arabic text without punctuation does not break mid-word', () => {
    // A single Arabic word with no spaces or punctuation: 8 chars × 5pt = 40pt
    // maxWidth=50pt → fits in 1 line (no break needed)
    const text = '\u0645\u0631\u062D\u0628\u0627\u0628\u0643\u0645'
    const result = layoutText(text, measurer, 10, defaultOptions({ maxWidth: 50 }))
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.text).toBe(text)
  })

  // Verifies that direction='auto' detects RTL for Arabic text.
  it('auto-detects RTL direction for Arabic text', () => {
    // Arabic text with direction='auto' → should detect RTL
    const text = '\u0645\u0631\u062D\u0628\u0627'
    const result = layoutText(text, measurer, 10, defaultOptions({ direction: 'auto' }))
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.direction).toBe('rtl')
  })

  // Verifies that mixed Arabic-Latin text breaks at spaces and no line starts with a space.
  it('mixed Arabic-Latin text wraps at space boundaries', () => {
    // "Hello مرحبا World شكرا" → mix of Latin and Arabic with spaces
    // 22 chars × 5pt = 110pt; maxWidth=55pt → should break at spaces
    const text = 'Hello \u0645\u0631\u062D\u0628\u0627 World \u0634\u0643\u0631\u0627'
    const result = layoutText(text, measurer, 10, defaultOptions({ maxWidth: 55 }))
    expect(result.lines.length).toBeGreaterThan(1)
    // No line should start with a space
    for (const line of result.lines) {
      if (line.text.length > 0) {
        expect(line.text[0]).not.toBe(' ')
      }
    }
  })
})

// ─── Visual-order glyph run for BiDi lines (real Arabic font) ───

describe('Arabic BiDi lines carry a visual-order shaped glyph run', () => {
  const fontPath = resolve(__dirname, '../fixtures/fonts/NotoSansArabic-Regular.ttf')

  function loadMeasurer(): TextMeasurer {
    const buffer = readFileSync(fontPath).buffer as ArrayBuffer
    return new TextMeasurer(Font.load(buffer))
  }

  // Verifies an RTL line keeps its glyph run, reordered into visual order with
  // Arabic contextual forms (logical shaping: م=79 init, ر=31 fina, ح=27 init,
  // ب=16+317 medi via ccmp decomposition, ا=9 fina).
  it('RTL line run holds contextual forms in visual order', () => {
    const measurer = loadMeasurer()
    const result = layoutText('مرحبا', measurer, 14, { maxWidth: 300, direction: 'rtl' })
    expect(result.lines).toHaveLength(1)
    const line = result.lines[0]!
    expect(line.direction).toBe('rtl')
    expect(line.run).toBeDefined()
    // Visual order matches HarfBuzz: RTL reversal includes the glyph order
    // inside the decomposed beh cluster (dot mark before its base glyph).
    expect([...line.run!.glyphIds]).toEqual([9, 317, 16, 27, 31, 79])
    // Total run advance equals the measured line width
    let total = 0
    for (const a of line.run!.advances) total += a
    expect(total).toBeCloseTo(line.width, 6)
  })

  // Verifies mirrored characters swap to the mirror glyph inside the run:
  // in an RTL line, '(' must be drawn with the ')' glyph and vice versa.
  it('mirrored brackets swap glyphs inside the reordered run', () => {
    const measurer = loadMeasurer()
    const font = measurer.font
    const result = layoutText('قيمة (123)', measurer, 14, { maxWidth: 300, direction: 'rtl' })
    expect(result.lines).toHaveLength(1)
    const line = result.lines[0]!
    expect(line.run).toBeDefined()
    const openGid = font.getGlyphId('('.codePointAt(0)!)
    const closeGid = font.getGlyphId(')'.codePointAt(0)!)
    const gids = [...line.run!.glyphIds]
    // The mirrored text and the run must agree: for each paren char in the
    // visual text, the glyph at the same cluster position is its cmap glyph
    const chars = [...line.text]
    let cpIdx = 0
    for (let g = 0; g < gids.length; g++) {
      const count = line.run!.clusters[g]!
      if (count === 1) {
        const ch = chars[cpIdx]!
        if (ch === '(') expect(gids[g]).toBe(openGid)
        if (ch === ')') expect(gids[g]).toBe(closeGid)
      }
      cpIdx += count
    }
    // Both paren glyphs appear in the run
    expect(gids).toContain(openGid)
    expect(gids).toContain(closeGid)
  })

  // Verifies measureShaped folds continuation glyphs (cluster 0) into the
  // previous code point so per-code-point advances stay aligned.
  it('measureShaped keeps one advance per code point across decompositions', () => {
    const measurer = loadMeasurer()
    const m = measurer.measureShaped('مرحبا', 14, false)
    expect(m.advances.length).toBe(5) // one advance per code point
    expect(m.shaped.length).toBe(6)   // beh decomposes into skeleton + dot mark
    let total = 0
    for (const a of m.advances) total += a
    expect(total).toBeCloseTo(m.width, 6)
  })
})
