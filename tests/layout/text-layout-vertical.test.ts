import { describe, it, expect } from 'vitest'
import { layoutText, type TextLayoutOptions } from '../../src/layout/text-layout.js'
import type { TextMeasurer } from '../../src/measure/text-measurer.js'

// ─── Mock Measurer ───

/**
 * Mock TextMeasurer for tests.
 * Assumes every character is a fixed-width square glyph (CJK-like behavior).
 * charWidth: width/height (pt) of one character at a 10pt font size.
 */
function createMockMeasurer(charWidth: number = 10): TextMeasurer {
  const unitsPerEm = 1000
  // getAdvanceWidth/Height returns font units
  // code multiplies by (fontSize / unitsPerEm) to get pt
  // For fontSize=10: advanceFU * (10/1000) = charWidth => advanceFU = charWidth * 100
  const advanceFontUnits = charWidth * (unitsPerEm / 10) // assuming 10pt default
  return {
    font: {
      metrics: { unitsPerEm, ascender: 800, descender: -200, lineGap: 0 },
      getGlyphId: () => 0,
      getAdvanceWidth: () => advanceFontUnits,
      getAdvanceHeight: () => advanceFontUnits,
      opbd: null,
      getOpticalBounds: () => null,
      getLigatureCaretPositions: () => null,
    },
    measure(text: string, fontSize: number) {
      const s = fontSize / unitsPerEm
      let count = 0
      let i = 0
      while (i < text.length) {
        const cp = text.codePointAt(i)!
        i += cp > 0xFFFF ? 2 : 1
        count++
      }
      const advances = new Float64Array(count)
      const advPt = advanceFontUnits * s
      let width = 0
      for (let j = 0; j < count; j++) {
        advances[j] = advPt
        width += advPt
      }
      return { width, advances }
    },
    measureShaped(text: string, fontSize: number) {
      const m = this.measure(text, fontSize)
      const n = m.advances.length
      const shaped = new Array(n)
      const cpToGlyph = new Int32Array(n)
      for (let j = 0; j < n; j++) {
        shaped[j] = { glyphId: 0, xOffset: 0, yOffset: 0, xAdvance: advanceFontUnits, yAdvance: advanceFontUnits, componentCount: 1 }
        cpToGlyph[j] = j
      }
      return { width: m.width, advances: m.advances, shaped, cpToGlyph }
    },
    getLineHeight(fontSize: number) {
      // (ascender - descender + lineGap) / unitsPerEm * fontSize
      // = (800 - (-200) + 0) / 1000 * fontSize = fontSize
      return fontSize
    },
    getAscent(fontSize: number) {
      return (800 / unitsPerEm) * fontSize
    },
    getDescent(fontSize: number) {
      return (-200 / unitsPerEm) * fontSize
    },
  } as any
}

// ─── Helper ───

function verticalOptions(
  writingMode: 'vertical-rl' | 'vertical-lr',
  overrides: Partial<TextLayoutOptions> = {},
): TextLayoutOptions {
  return {
    maxWidth: 200,
    maxHeight: 100,
    writingMode,
    ...overrides,
  }
}

// ─── Tests ───

describe('layoutText vertical', () => {
  // Verifies that vertical-rl places a short text as a single column at the right edge.
  it('vertical-rl: short text fits in single column at right side', () => {
    const measurer = createMockMeasurer(10)
    // 3 chars * 10pt = 30pt height, maxHeight=100 -> fits in one column
    const result = layoutText('abc', measurer, 10, verticalOptions('vertical-rl'))

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.text).toBe('abc')
    expect(result.truncated).toBe(false)

    // vertical-rl: first column should be at the right edge
    // colWidth = lineHeight = 10, maxWidth = 200
    // x = 200 - 1 * 10 = 190
    expect(result.lines[0]!.x).toBe(190)
    expect(result.lines[0]!.y).toBe(0)
  })

  // Verifies that vertical-rl wraps overflowing text into columns advancing right-to-left.
  it('vertical-rl: long text wraps into multiple columns right-to-left', () => {
    const measurer = createMockMeasurer(10)
    // 15 chars * 10pt = 150pt total, maxHeight=50 -> 5 chars per column -> 3 columns
    const result = layoutText('あいうえおかきくけこさしすせそ', measurer, 10, verticalOptions('vertical-rl', {
      maxHeight: 50,
    }))

    expect(result.lines).toHaveLength(3)

    // vertical-rl: columns go right-to-left
    // col 0: x = 200 - 10 = 190
    // col 1: x = 200 - 20 = 180
    // col 2: x = 200 - 30 = 170
    expect(result.lines[0]!.x).toBe(190)
    expect(result.lines[1]!.x).toBe(180)
    expect(result.lines[2]!.x).toBe(170)

    // Each column should have 5 chars
    expect(result.lines[0]!.text).toHaveLength(5)
    expect(result.lines[1]!.text).toHaveLength(5)
    expect(result.lines[2]!.text).toHaveLength(5)
    expect(result.truncated).toBe(false)
  })

  // Verifies that vertical-lr places the first column at the left edge.
  it('vertical-lr: single column starts at left side', () => {
    const measurer = createMockMeasurer(10)
    const result = layoutText('abc', measurer, 10, verticalOptions('vertical-lr'))

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.text).toBe('abc')
    // vertical-lr: first column at x = 0
    expect(result.lines[0]!.x).toBe(0)
  })

  // Verifies that vertical-lr columns advance left-to-right.
  it('vertical-lr: multiple columns go left-to-right', () => {
    const measurer = createMockMeasurer(10)
    // 10 chars * 10pt = 100pt, maxHeight=50 -> 5 chars per col -> 2 columns
    const result = layoutText('あいうえおかきくけこ', measurer, 10, verticalOptions('vertical-lr', {
      maxHeight: 50,
    }))

    expect(result.lines).toHaveLength(2)

    // vertical-lr: columns go left-to-right
    // col 0: x = 0
    // col 1: x = 10
    expect(result.lines[0]!.x).toBe(0)
    expect(result.lines[1]!.x).toBe(10)
    expect(result.truncated).toBe(false)
  })

  // Verifies that an explicit newline starts a new column in vertical writing mode.
  it('newline creates new column', () => {
    const measurer = createMockMeasurer(10)
    // Two paragraphs separated by newline -> at least 2 columns
    const result = layoutText('あいう\nかきく', measurer, 10, verticalOptions('vertical-rl', {
      maxHeight: 100,
    }))

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]!.text).toBe('あいう')
    expect(result.lines[1]!.text).toBe('かきく')

    // Columns should have different x values (rl: descending)
    expect(result.lines[0]!.x!).toBeGreaterThan(result.lines[1]!.x!)
  })

  // Verifies that CJK text wraps at character boundaries without losing any characters.
  it('CJK text wraps at character boundaries', () => {
    const measurer = createMockMeasurer(10)
    // 7 chars, maxHeight=30 -> 3 chars per column, then 3, then 1
    const result = layoutText('漢字テスト用文', measurer, 10, verticalOptions('vertical-rl', {
      maxHeight: 30,
    }))

    expect(result.lines.length).toBeGreaterThanOrEqual(2)
    // Total chars across all columns should equal original
    let totalChars = 0
    for (let i = 0; i < result.lines.length; i++) {
      totalChars += [...result.lines[i]!.text].length
    }
    expect(totalChars).toBe(7)
  })

  // Verifies that maxWidth caps the number of columns and sets truncated=true.
  it('maxWidth limits number of columns, truncated=true', () => {
    const measurer = createMockMeasurer(10)
    // 20 chars, maxHeight=50 -> 5 chars per col -> need 4 cols -> 4*10=40pt width
    // maxWidth=25 -> only 2 columns fit (2*10=20 <= 25, 3*10=30 > 25)
    const result = layoutText('あいうえおかきくけこさしすせそたちつてと', measurer, 10, verticalOptions('vertical-rl', {
      maxWidth: 25,
      maxHeight: 50,
    }))

    expect(result.lines).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  // Verifies that an empty string yields no columns, zero height, and no truncation.
  it('empty text returns empty result', () => {
    const measurer = createMockMeasurer(10)
    const result = layoutText('', measurer, 10, verticalOptions('vertical-rl'))

    expect(result.lines).toHaveLength(0)
    expect(result.totalHeight).toBe(0)
    expect(result.truncated).toBe(false)
  })

  // Verifies that totalHeight equals the tallest column's height.
  it('totalHeight equals max column height', () => {
    const measurer = createMockMeasurer(10)
    // 7 chars, maxHeight=50 -> col1: 5 chars (50pt), col2: 2 chars (20pt)
    const result = layoutText('あいうえおかき', measurer, 10, verticalOptions('vertical-rl', {
      maxHeight: 50,
    }))

    expect(result.lines).toHaveLength(2)
    // totalHeight should be max of column heights = 50
    expect(result.totalHeight).toBe(50)
  })

  // With lineHeight > 1em, the 1em glyph cell must be centered within the
  // column pitch (leading split evenly on both sides of the column).
  it('lineHeight > 1em のとき1em字面セルが列ピッチ内で中央に置かれる', () => {
    const measurer = createMockMeasurer(10) as unknown as { getLineHeight(fontSize: number): number }
    measurer.getLineHeight = (fontSize: number) => fontSize * 1.5

    // colWidth = 15, fontSize = 10 → cell offset = 2.5
    const result = layoutText('あいう\nかきく', measurer as any, 10, verticalOptions('vertical-rl', {
      maxHeight: 100,
    }))

    expect(result.lines).toHaveLength(2)
    // vertical-rl: column boxes are [185, 200] and [170, 185];
    // the 10pt em cells are centered: x = 185 + 2.5 and 170 + 2.5
    expect(result.lines[0]!.x).toBeCloseTo(187.5, 10)
    expect(result.lines[1]!.x).toBeCloseTo(172.5, 10)
  })
})
