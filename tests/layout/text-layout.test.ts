import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { layoutText, type TextLayoutOptions } from '../../src/layout/text-layout.js'
import type { TrakTable } from '../../src/parsers/tables/trak.js'
import type { OpbdTable } from '../../src/parsers/tables/opbd.js'
import type { JustDirectionData, JustTable, JustWidthDeltaPair } from '../../src/parsers/tables/just.js'
import type { JstfPriority, JstfTable } from '../../src/parsers/tables/jstf.js'
import {
  PROP_ATTACHES_ON_RIGHT,
  PROP_USE_COMPLEMENTARY_BRACKET,
  type PropTable,
} from '../../src/parsers/tables/prop.js'
import type { LcarTable } from '../../src/parsers/tables/lcar.js'
import type { GdefTable } from '../../src/parsers/tables/gdef.js'
import type { GposTable, JstfMaxTable } from '../../src/parsers/tables/gpos.js'

const __dirname = new URL('.', import.meta.url).pathname

let robotoMeasurer: TextMeasurer
let notoJPMeasurer: TextMeasurer

function setParsedFontTable(font: Font, tag: 'trak' | 'opbd' | 'just' | 'jstf' | 'prop' | 'lcar' | 'gdef' | 'merg', value: unknown): void {
  Object.defineProperty((font as unknown as { tableManager: object }).tableManager, tag, {
    value,
    configurable: true,
  })
}

function makePropTable(attachingGlyphId: number): PropTable {
  return {
    version: 2,
    format: 1,
    defaultProperties: 0,
    getProperties(glyphId: number): number {
      return glyphId === attachingGlyphId ? PROP_ATTACHES_ON_RIGHT : 0
    },
  }
}

function makeTrakTable(horizontalValue: number, verticalValue: number): TrakTable {
  return {
    horizData: null,
    vertData: null,
    getTracking(horizontal: boolean): number {
      return horizontal ? horizontalValue : verticalValue
    },
  }
}

function makeJustTable(weights: Map<number, number>, vertical = false): JustTable {
  const direction: JustDirectionData = {
    classTable: null,
    getCategories(glyphIds: readonly number[]): Uint8Array {
      return new Uint8Array(glyphIds.length)
    },
    getWidthDeltaPairs(glyphId: number): readonly JustWidthDeltaPair[] | null {
      const weight = weights.get(glyphId)
      if (weight === undefined) return null
      return [{
        justClass: 0,
        beforeGrowLimit: 0,
        beforeShrinkLimit: 0,
        afterGrowLimit: weight,
        afterShrinkLimit: 0,
        growFlags: 0x1000,
        shrinkFlags: 0,
      }]
    },
    getPostcompActions(): null {
      return null
    },
  }
  return {
    version: 1,
    format: 0,
    horizontal: vertical ? null : direction,
    vertical: vertical ? direction : null,
  }
}

function makeJstfTable(script: string, extenderGlyphs: readonly number[]): JstfTable {
  return {
    getPriorities(): readonly JstfPriority[] {
      return []
    },
    getExtenderGlyphs(requestedScript: string): readonly number[] {
      return requestedScript === script ? extenderGlyphs : []
    },
  }
}

function makeJstfMaximumTable(script: string, maximum: JstfMaxTable): JstfTable {
  return {
    getPriorities(requestedScript: string): readonly JstfPriority[] {
      if (requestedScript !== script) return []
      return [{
        gsubShrinkageEnableLookups: [],
        gsubShrinkageDisableLookups: [],
        gposShrinkageEnableLookups: [],
        gposShrinkageDisableLookups: [],
        shrinkageJstfMax: null,
        gsubExtensionEnableLookups: [],
        gsubExtensionDisableLookups: [],
        gposExtensionEnableLookups: [],
        gposExtensionDisableLookups: [],
        extensionJstfMax: maximum,
      }]
    },
    getExtenderGlyphs(): readonly number[] {
      return []
    },
  }
}

function makeJstfPriorityTable(script: string, priority: JstfPriority): JstfTable {
  return {
    getPriorities(requestedScript: string): readonly JstfPriority[] {
      return requestedScript === script ? [priority] : []
    },
    getExtenderGlyphs(): readonly number[] {
      return []
    },
  }
}

function makeOpbdDistanceTable(
  leftGlyphId: number,
  rightGlyphId: number,
  left: number,
  right: number,
  top = 0,
  bottom = 0,
): OpbdTable {
  return {
    version: 1,
    format: 0,
    getOpticalBounds(glyphId: number) {
      if (glyphId === leftGlyphId) return { left, top, right: 0, bottom: 0 }
      if (glyphId === rightGlyphId) return { left: 0, top: 0, right, bottom }
      return null
    },
  }
}

function makeLcarTable(glyphId: number, values: readonly number[]): LcarTable {
  return {
    version: 1,
    format: 0,
    getCaretValues(requestedGlyphId: number): readonly number[] | null {
      return requestedGlyphId === glyphId ? values : null
    },
  }
}

beforeAll(() => {
  const robotoBuffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
  const robotoFont = Font.load(robotoBuffer)
  robotoMeasurer = new TextMeasurer(robotoFont)

  const notoJPBuffer = readFileSync(resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')).buffer as ArrayBuffer
  const notoJPFont = Font.load(notoJPBuffer)
  notoJPMeasurer = new TextMeasurer(notoJPFont)
})

// ─── Helpers ───

function defaultOptions(overrides: Partial<TextLayoutOptions> = {}): TextLayoutOptions {
  return {
    maxWidth: 200,
    ...overrides,
  }
}

// ─── Tests ───

describe('layoutText', () => {
  describe('基本動作', () => {
    // Verifies that an empty string produces no lines, zero height, and no truncation.
    it('空文字列', () => {
      const result = layoutText('', robotoMeasurer, 10, defaultOptions())
      expect(result.lines).toHaveLength(0)
      expect(result.totalHeight).toBe(0)
      expect(result.truncated).toBe(false)
    })

    // Verifies that text fitting within maxWidth stays on a single line.
    it('短いテキストは1行', () => {
      const result = layoutText('Hello', robotoMeasurer, 10, defaultOptions())
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]!.text).toBe('Hello')
      expect(result.lines[0]!.width).toBeGreaterThan(0)
      expect(result.truncated).toBe(false)
    })

    // Verifies horizontalScale multiplies line width and glyph advances without changing text content.
    it('horizontalScale で行幅と glyph advance が縮小される', () => {
      const normal = layoutText('Hello', robotoMeasurer, 10, defaultOptions())
      const scaled = layoutText('Hello', robotoMeasurer, 10, defaultOptions({ horizontalScale: 0.5 }))
      expect(scaled.lines).toHaveLength(1)
      expect(scaled.lines[0]!.text).toBe('Hello')
      expect(scaled.lines[0]!.width).toBeCloseTo(normal.lines[0]!.width * 0.5, 5)
      expect(scaled.lines[0]!.run!.advances[0]).toBeCloseTo(normal.lines[0]!.run!.advances[0]! * 0.5, 5)
    })

    // Verifies that explicit newline characters split the text into separate lines.
    it('明示的改行で分割', () => {
      const result = layoutText('Line1\nLine2\nLine3', robotoMeasurer, 10, defaultOptions())
      expect(result.lines).toHaveLength(3)
      expect(result.lines[0]!.text).toBe('Line1')
      expect(result.lines[1]!.text).toBe('Line2')
      expect(result.lines[2]!.text).toBe('Line3')
    })

    // Verifies that Unicode mandatory line separators are treated as explicit paragraph breaks.
    it('CRLF/CR/NEL/Unicode 行区切りで分割', () => {
      const result = layoutText('A\r\nB\rC\u0085D\u2028E\u2029F', robotoMeasurer, 10, defaultOptions())
      expect(result.lines.map(line => line.text)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    })

    // Verifies that layout input is normalized to NFC by default.
    it('Unicode 正規化: 既定で NFC に正規化する', () => {
      const result = layoutText('Cafe\u0301', robotoMeasurer, 10, defaultOptions())
      expect(result.lines[0]!.text).toBe('Café')
    })

    // Verifies that normalization can be disabled when exact source code points must be preserved.
    it('Unicode 正規化: none で入力コードポイントを保持する', () => {
      const result = layoutText('Cafe\u0301', robotoMeasurer, 10, defaultOptions({ unicodeNormalization: 'none' }))
      expect(result.lines[0]!.text).toBe('Cafe\u0301')
    })

    // Verifies that an explicit normalization form is honored.
    it('Unicode 正規化: NFD を指定できる', () => {
      const result = layoutText('Café', robotoMeasurer, 10, defaultOptions({ unicodeNormalization: 'NFD' }))
      expect(result.lines[0]!.text).toBe('Cafe\u0301')
    })

    // Verifies that line Y positions increase monotonically from line to line.
    it('Y座標が行ごとに増加', () => {
      const result = layoutText('Line1\nLine2\nLine3', robotoMeasurer, 10, defaultOptions())
      expect(result.lines[0]!.y).toBe(0)
      expect(result.lines[1]!.y).toBeGreaterThan(result.lines[0]!.y)
      expect(result.lines[2]!.y).toBeGreaterThan(result.lines[1]!.y)
    })
  })

  describe('英語ワードラップ', () => {
    // Verifies that English text wraps at word boundaries and each line is a substring of the source.
    it('単語境界で折り返し', () => {
      const text = 'The quick brown fox jumps over the lazy dog'
      // Narrow the width to force wrapping
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({ maxWidth: 80 }))
      expect(result.lines.length).toBeGreaterThan(1)
      // Each line must be a substring of the original text
      for (const line of result.lines) {
        expect(text.includes(line.text.trim())).toBe(true)
      }
    })

    // Verifies that a single word wider than the line is broken at character boundaries.
    it('単語が行幅を超える場合は文字単位で分割', () => {
      const text = 'Supercalifragilisticexpialidocious'
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({ maxWidth: 50 }))
      expect(result.lines.length).toBeGreaterThan(1)
    })

    // Verifies that forced character-level wrapping still respects UAX#29 grapheme clusters.
    it('結合文字列は強制分割でも書記素クラスタ内部で分割しない', () => {
      const result = layoutText('a\u0301b', robotoMeasurer, 10, defaultOptions({ maxWidth: 1, unicodeNormalization: 'none' }))
      expect(result.lines.map(line => line.text)).toEqual(['a\u0301', 'b'])
    })

    // Verifies that breaking after a space never leaves a leading space on the next line.
    it('スペースの後で改行', () => {
      const text = 'word1 word2 word3'
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({ maxWidth: 50 }))
      // No line should start with a space
      for (const line of result.lines) {
        expect(line.text[0]).not.toBe(' ')
      }
    })
  })

  describe('日本語テキスト', () => {
    // Verifies that Japanese text wraps into multiple lines when it exceeds maxWidth.
    it('日本語テキストの折り返し', () => {
      const text = 'これはテスト文字列です。日本語のテキストが正しく折り返されることを確認します。'
      const result = layoutText(text, notoJPMeasurer, 10, defaultOptions({ maxWidth: 100 }))
      expect(result.lines.length).toBeGreaterThan(1)
    })

    // Verifies kinsoku shori: closing punctuation never appears at the start of a line.
    it('行頭禁則文字が行頭に来ない', () => {
      // Confirm that the full stop never appears at line start
      const text = 'あいうえおかきくけこさしすせそ。たちつてと'
      const result = layoutText(text, notoJPMeasurer, 10, defaultOptions({ maxWidth: 80 }))
      for (const line of result.lines) {
        if (line.text.length > 0) {
          expect('、。，．）」』】〉》〕｝'.includes(line.text[0]!)).toBe(false)
        }
      }
    })

    // Verifies kinsoku shori: opening brackets never appear at the end of a line.
    it('行末禁則文字が行末に来ない', () => {
      // Confirm that an opening bracket never appears at line end
      const text = 'テスト（かっこ）のテスト'
      const result = layoutText(text, notoJPMeasurer, 10, defaultOptions({ maxWidth: 60 }))
      for (let i = 0; i < result.lines.length - 1; i++) {
        const line = result.lines[i]!.text
        if (line.length > 0) {
          const lastChar = line[line.length - 1]!
          expect('（「『【〈《〔｛'.includes(lastChar)).toBe(false)
        }
      }
    })
  })

  describe('混在テキスト', () => {
    // Verifies that mixed English and Japanese text lays out without losing any characters.
    it('英語と日本語の混在', () => {
      const text = 'Hello世界！This is テストです。'
      const result = layoutText(text, notoJPMeasurer, 10, defaultOptions({ maxWidth: 80 }))
      expect(result.lines.length).toBeGreaterThanOrEqual(1)
      // All characters must be preserved
      const joined = result.lines.map(l => l.text).join('')
      expect(joined.replace(/ /g, '')).toContain('Hello世界')
    })
  })

  describe('letterSpacing', () => {
    // Verifies that letterSpacing increases the measured line width.
    it('letterSpacing で文字間が広がる', () => {
      const text = 'Hello'
      const normal = layoutText(text, robotoMeasurer, 10, defaultOptions())
      const spaced = layoutText(text, robotoMeasurer, 10, defaultOptions({ letterSpacing: 2 }))
      // 5 chars x 2pt = 10pt wider
      expect(spaced.lines[0]!.width).toBeGreaterThan(normal.lines[0]!.width)
    })

    // Verifies that letterSpacing affects where lines break (never fewer lines than without it).
    it('letterSpacing で折り返し位置が変わる', () => {
      const text = 'ABCDEFGHIJ'
      const normal = layoutText(text, robotoMeasurer, 10, defaultOptions({ maxWidth: 70 }))
      const spaced = layoutText(text, robotoMeasurer, 10, defaultOptions({ maxWidth: 70, letterSpacing: 5 }))
      expect(spaced.lines.length).toBeGreaterThanOrEqual(normal.lines.length)
    })
  })

  describe('AAT trak', () => {
    // Verifies AAT trak FUnit values are converted to pt and added to shaped glyph advances.
    it('tracking 指定で trak のサイズ別文字間隔を layout と glyph run に反映する', () => {
      const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(buffer)
      setParsedFontTable(font, 'trak', makeTrakTable(100, 0))
      const measurer = new TextMeasurer(font)
      const text = 'Hello'
      const fontSize = 10
      const trackingPt = 100 * fontSize / font.metrics.unitsPerEm

      const normal = layoutText(text, measurer, fontSize, defaultOptions())
      const tracked = layoutText(text, measurer, fontSize, defaultOptions({ tracking: 1 }))

      expect(tracked.lines[0]!.width).toBeCloseTo(normal.lines[0]!.width + text.length * trackingPt, 5)
      expect(tracked.lines[0]!.run!.advances[0]).toBeCloseTo(normal.lines[0]!.run!.advances[0]! + trackingPt, 5)
    })

    it('vertical TrackDataを縦書きglyph advanceへ反映する', () => {
      const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(buffer)
      setParsedFontTable(font, 'trak', makeTrakTable(0, 100))
      const measurer = new TextMeasurer(font)
      const fontSize = 10
      const options = defaultOptions({ maxHeight: 100, writingMode: 'vertical-rl' })
      const normal = layoutText('AB', measurer, fontSize, options)
      const tracked = layoutText('AB', measurer, fontSize, { ...options, tracking: 1 })
      const trackingPt = 100 * fontSize / font.metrics.unitsPerEm

      expect(tracked.lines[0]!.run!.advances[0]).toBeCloseTo(normal.lines[0]!.run!.advances[0]! + trackingPt)
    })
  })

  describe('AAT opbd', () => {
    // Verifies opbd format 0 distance values move only the edge glyphs and do not change line advances.
    it('opbd の左右 optical bounds を行頭/行末 glyph offset に反映する', () => {
      const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const text = 'Hi'
      const hGid = font.getGlyphId('H'.codePointAt(0)!)
      const iGid = font.getGlyphId('i'.codePointAt(0)!)
      setParsedFontTable(font, 'opbd', makeOpbdDistanceTable(hGid, iGid, -100, 120))
      const measurer = new TextMeasurer(font)
      const fontSize = 10
      const scale = fontSize / font.metrics.unitsPerEm

      const line = layoutText(text, measurer, fontSize, defaultOptions()).lines[0]!

      expect(line.run).toBeDefined()
      expect(line.run!.xOffsets[0]).toBeCloseTo(-100 * scale, 5)
      expect(line.run!.xOffsets[line.run!.xOffsets.length - 1]).toBeCloseTo(120 * scale, 5)
      const advanceTotal = Array.from(line.run!.advances).reduce((sum, advance) => sum + advance, 0)
      expect(line.width).toBeCloseTo(advanceTotal, 6)
    })

    it('縦書き列の先頭top・末尾bottom optical boundsをglyph配置へ反映する', () => {
      const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const aGlyph = font.getGlyphId(0x41)
      const bGlyph = font.getGlyphId(0x42)
      setParsedFontTable(font, 'opbd', makeOpbdDistanceTable(aGlyph, bGlyph, 0, 0, 120, -80))
      const fontSize = 10
      const result = layoutText('AB', new TextMeasurer(font), fontSize, defaultOptions({
        maxWidth: 100,
        maxHeight: 100,
        writingMode: 'vertical-rl',
      }))
      const run = result.lines[0]!.run!
      const scale = fontSize / font.metrics.unitsPerEm

      expect(run.yOffsets[0]).toBeCloseTo(120 * scale)
      expect(run.yOffsets[run.yOffsets.length - 1]).toBeCloseTo(-80 * scale)
    })

  })

  describe('AAT lcar', () => {
    it('ligature division pointsを公開layout caret stopsへ接続する', () => {
      const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const glyphId = font.getGlyphId(0x41)
      setParsedFontTable(font, 'lcar', makeLcarTable(glyphId, [200, 400]))
      const fontSize = 10
      const result = layoutText('A', new TextMeasurer(font), fontSize, defaultOptions())
      const scale = fontSize / font.metrics.unitsPerEm
      const advance = result.lines[0]!.run!.advances[0]!

      expect(Array.from(result.lines[0]!.caretPositions!)).toEqual([0, 200 * scale, 400 * scale, advance])
    })
  })

  describe('OpenType GDEF ligature carets', () => {
    it('connects real-font GDEF ligature carets to public layout stops', () => {
      const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/NotoSans-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const shaped = font.shapeText('ffi')
      expect(shaped).toHaveLength(1)
      expect(shaped[0]!.glyphId).toBe(1656)

      const fontSize = 10
      const result = layoutText('ffi', new TextMeasurer(font), fontSize, defaultOptions())
      const scale = fontSize / font.metrics.unitsPerEm
      const advance = result.lines[0]!.run!.advances[0]!

      expect(Array.from(result.lines[0]!.caretPositions!)).toEqual([
        0, 315 * scale, 631 * scale, advance,
      ])
    })

    it('applies GDEF Device caret adjustment at the requested layout ppem', () => {
      const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const glyphId = font.getGlyphId(0x41)
      const gdef: GdefTable = {
        majorVersion: 1,
        minorVersion: 0,
        getGlyphClass: () => 0,
        getMarkAttachClass: () => 0,
        isMarkInSet: () => false,
        getAttachmentPointIndices: () => [],
        getLigatureCaretValues(requestedGlyphId: number, ppem?: number) {
          return requestedGlyphId === glyphId
            ? [{ format: 3, coordinate: 200, pointIndex: null, deviceDelta: ppem === 20 ? 1 : 0 }]
            : null
        },
        getVarDelta: () => 0,
      }
      setParsedFontTable(font, 'gdef', gdef)
      const fontSize = 10
      const result = layoutText('A', new TextMeasurer(font), fontSize, defaultOptions({ devicePpem: 20 }))
      const scale = fontSize / font.metrics.unitsPerEm

      expect(result.lines[0]!.caretPositions![1]).toBeCloseTo(
        (200 + font.metrics.unitsPerEm / 20) * scale,
      )
    })
  })

  describe('wordSpacing', () => {
    // Verifies that wordSpacing widens spaces and thus the total line width.
    it('wordSpacing でスペースの幅が広がる', () => {
      const text = 'Hello World'
      const normal = layoutText(text, robotoMeasurer, 10, defaultOptions())
      const spaced = layoutText(text, robotoMeasurer, 10, defaultOptions({ wordSpacing: 10 }))
      expect(spaced.lines[0]!.width).toBeGreaterThan(normal.lines[0]!.width)
    })
  })

  describe('lineSpacing', () => {
    // Verifies that default (single) line spacing yields a positive line gap.
    it('single (デフォルト)', () => {
      const text = 'Line1\nLine2'
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions())
      const lineHeight = result.lines[1]!.y - result.lines[0]!.y
      expect(lineHeight).toBeGreaterThan(0)
    })

    // Verifies that 1.5 line spacing yields 1.5x the single-spacing gap.
    it('1.5行間', () => {
      const text = 'Line1\nLine2'
      const single = layoutText(text, robotoMeasurer, 10, defaultOptions())
      const oneAndHalf = layoutText(text, robotoMeasurer, 10, defaultOptions({
        lineSpacing: { type: '1.5' },
      }))
      const singleGap = single.lines[1]!.y - single.lines[0]!.y
      const oneAndHalfGap = oneAndHalf.lines[1]!.y - oneAndHalf.lines[0]!.y
      expect(oneAndHalfGap).toBeCloseTo(singleGap * 1.5, 1)
    })

    // Verifies that double line spacing yields 2x the single-spacing gap.
    it('double行間', () => {
      const text = 'Line1\nLine2'
      const single = layoutText(text, robotoMeasurer, 10, defaultOptions())
      const double = layoutText(text, robotoMeasurer, 10, defaultOptions({
        lineSpacing: { type: 'double' },
      }))
      const singleGap = single.lines[1]!.y - single.lines[0]!.y
      const doubleGap = double.lines[1]!.y - double.lines[0]!.y
      expect(doubleGap).toBeCloseTo(singleGap * 2, 1)
    })

    // Verifies that fixed line spacing uses the exact given value as the line gap.
    it('fixed行間', () => {
      const text = 'Line1\nLine2'
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({
        lineSpacing: { type: 'fixed', value: 20 },
      }))
      const gap = result.lines[1]!.y - result.lines[0]!.y
      expect(gap).toBeCloseTo(20, 1)
    })

    // Verifies that proportional line spacing multiplies the single-spacing gap by the given factor.
    it('proportional行間', () => {
      const text = 'Line1\nLine2'
      const single = layoutText(text, robotoMeasurer, 10, defaultOptions())
      const prop = layoutText(text, robotoMeasurer, 10, defaultOptions({
        lineSpacing: { type: 'proportional', value: 2.5 },
      }))
      const singleGap = single.lines[1]!.y - single.lines[0]!.y
      const propGap = prop.lines[1]!.y - prop.lines[0]!.y
      expect(propGap).toBeCloseTo(singleGap * 2.5, 1)
    })
  })

  describe('vAlign', () => {
    // Verifies that vAlign=top starts the first line at Y=0.
    it('top (デフォルト): Y=0 から開始', () => {
      const result = layoutText('Hello', robotoMeasurer, 10, defaultOptions({
        elementHeight: 100,
        vAlign: 'top',
      }))
      expect(result.lines[0]!.y).toBe(0)
    })

    // Verifies that vAlign=middle centers the text vertically within elementHeight.
    it('middle: 中央配置', () => {
      const result = layoutText('Hello', robotoMeasurer, 10, defaultOptions({
        elementHeight: 100,
        vAlign: 'middle',
      }))
      // Y should be around (100 - lineHeight) / 2
      expect(result.lines[0]!.y).toBeGreaterThan(0)
      expect(result.lines[0]!.y).toBeLessThan(50)
    })

    // Verifies that vAlign=bottom pushes the text to the bottom of elementHeight.
    it('bottom: 下寄せ配置', () => {
      const result = layoutText('Hello', robotoMeasurer, 10, defaultOptions({
        elementHeight: 100,
        vAlign: 'bottom',
      }))
      // Y should be around 100 - lineHeight
      expect(result.lines[0]!.y).toBeGreaterThan(50)
    })

    // Verifies that vAlign=middle centers a multi-line block around the element midpoint.
    it('複数行の middle', () => {
      const text = 'Line1\nLine2\nLine3'
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({
        elementHeight: 200,
        vAlign: 'middle',
      }))
      // Placed near the vertical center
      const midY = result.lines[1]!.y
      expect(midY).toBeGreaterThan(50)
      expect(midY).toBeLessThan(150)
    })
  })

  describe('justify', () => {
    // Verifies that hAlign=justify sets justifySpacing on all lines except the last one.
    it('最終行以外に justifySpacing が設定される', () => {
      const text = 'The quick brown fox jumps over the lazy dog and more text here'
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({
        maxWidth: 100,
        hAlign: 'justify',
      }))
      if (result.lines.length > 1) {
        // All lines except the last have justifySpacing set
        for (let i = 0; i < result.lines.length - 1; i++) {
          const line = result.lines[i]!
          if (line.text.length > 1) {
            // Either justifySpacing exists or the line width is already close to maxWidth
            expect(line.justifySpacing !== undefined || line.width >= 95).toBe(true)
          }
        }
        // The last line must not have justifySpacing
        expect(result.lines[result.lines.length - 1]!.justifySpacing).toBeUndefined()
      }
    })

    // Verifies AAT just width delta pairs are consumed before generic character-gap justification.
    it('AAT just の grow limit を glyph run の justify 配分に使う', () => {
      const robotoBuffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(robotoBuffer)
      const aGlyph = font.getGlyphId('A'.codePointAt(0)!)
      const vGlyph = font.getGlyphId('V'.codePointAt(0)!)
      setParsedFontTable(font, 'just', makeJustTable(new Map([
        [aGlyph, 2],
        [vGlyph, 1],
      ])))
      const measurer = new TextMeasurer(font)
      const base = layoutText('AV\nz', measurer, 10, defaultOptions({ maxWidth: 100 }))
      const justified = layoutText('AV\nz', measurer, 10, defaultOptions({ maxWidth: 100, hAlign: 'justify' }))

      const baseRun = base.lines[0]!.run!
      const justifiedRun = justified.lines[0]!.run!
      const delta = 100 - baseRun.advances.reduce((sum, value) => sum + value, 0)

      expect(justifiedRun.advances[0]).toBeCloseTo(baseRun.advances[0]! + delta * 2 / 3, 6)
      expect(justifiedRun.advances[1]).toBeCloseTo(baseRun.advances[1]! + delta / 3, 6)
    })

    // Verifies JSTF ExtenderGlyph data is consumed before generic character-gap justification.
    it('JSTF ExtenderGlyph を glyph run の justify 拡張対象として使う', () => {
      const robotoBuffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(robotoBuffer)
      const aGlyph = font.getGlyphId('A'.codePointAt(0)!)
      const vGlyph = font.getGlyphId('V'.codePointAt(0)!)
      setParsedFontTable(font, 'jstf', makeJstfTable('latn', [aGlyph]))
      const measurer = new TextMeasurer(font)
      const base = layoutText('AV\nz', measurer, 10, defaultOptions({ maxWidth: 100 }))
      const justified = layoutText('AV\nz', measurer, 10, defaultOptions({ maxWidth: 100, hAlign: 'justify' }))

      const baseRun = base.lines[0]!.run!
      const justifiedRun = justified.lines[0]!.run!
      const delta = 100 - base.lines[0]!.width

      expect(justifiedRun.glyphIds[0]).toBe(aGlyph)
      expect(justifiedRun.glyphIds[1]).toBe(vGlyph)
      expect(justifiedRun.advances[0]).toBeCloseTo(baseRun.advances[0]! + delta, 6)
      expect(justifiedRun.advances[1]).toBeCloseTo(baseRun.advances[1]!, 6)
    })

    it('JSTF priorityのJstfMaxを最大値までのlayout調整として使う', () => {
      const robotoBuffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(robotoBuffer)
      const maximum: JstfMaxTable = {
        getPositionAdjustments(glyphIds: number[]) {
          return glyphIds.map((_, index) => ({
            xPlacement: index === 0 ? 20 : 0,
            yPlacement: 0,
            xAdvance: index === 0 ? 200 : 0,
            yAdvance: 0,
          }))
        },
      }
      setParsedFontTable(font, 'jstf', makeJstfMaximumTable('latn', maximum))
      const measurer = new TextMeasurer(font)
      const base = layoutText('AV\nz', measurer, 10, defaultOptions({ maxWidth: 100 }))
      const baseWidth = base.lines[0]!.width
      const targetWidth = baseWidth + 0.5
      const justified = layoutText('AV\nz', measurer, 10, defaultOptions({
        maxWidth: targetWidth,
        hAlign: 'justify',
        openTypeScript: 'latn',
      }))

      expect(justified.lines[0]!.width).toBeCloseTo(targetWidth)
      expect(justified.lines[0]!.run!.advances[0]).toBeCloseTo(base.lines[0]!.run!.advances[0]! + 0.5)
      expect(justified.lines[0]!.run!.xOffsets[0]).toBeCloseTo(base.lines[0]!.run!.xOffsets[0]! + 0.05)
    })

    it('JSTF GPOS disableをBiDi前の論理文字列から再shapeする', () => {
      const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const manager = (font as unknown as { tableManager: { gpos: GposTable } }).tableManager
      const kernLookups = manager.gpos.getFeatureLookupIndices(new Set(['kern']), 'latn')
      expect(kernLookups.length).toBeGreaterThan(0)
      const priority: JstfPriority = {
        gsubShrinkageEnableLookups: [],
        gsubShrinkageDisableLookups: [],
        gposShrinkageEnableLookups: [],
        gposShrinkageDisableLookups: [],
        shrinkageJstfMax: null,
        gsubExtensionEnableLookups: [],
        gsubExtensionDisableLookups: [],
        gposExtensionEnableLookups: [],
        gposExtensionDisableLookups: kernLookups,
        extensionJstfMax: null,
      }
      setParsedFontTable(font, 'jstf', makeJstfPriorityTable('latn', priority))
      const fontSize = 10
      const scale = fontSize / font.metrics.unitsPerEm
      const expanded = font.shapeText('AV', { script: 'latn', jstf: { priority, mode: 'extend' } })
      const targetWidth = expanded.reduce((sum, glyph) => sum + glyph.xAdvance * scale, 0)
      const result = layoutText('AV\nz', new TextMeasurer(font), fontSize, defaultOptions({
        maxWidth: targetWidth,
        hAlign: 'justify',
        openTypeScript: 'latn',
      }))

      expect(result.lines[0]!.run!.glyphIds).toHaveLength(2)
      expect(Array.from(result.lines[0]!.run!.glyphIds)).toEqual(expanded.map(glyph => glyph.glyphId))
      expect(Array.from(result.lines[0]!.run!.advances)).toEqual(
        expanded.map(glyph => glyph.xAdvance * scale),
      )
      expect(result.lines[0]!.width).toBeCloseTo(targetWidth)
    })

    it('prop attaches-on-right で右隣との間へ justification spacing を入れない', () => {
      const robotoBuffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(robotoBuffer)
      const aGlyph = font.getGlyphId('A'.codePointAt(0)!)
      setParsedFontTable(font, 'prop', makePropTable(aGlyph))
      const measurer = new TextMeasurer(font)
      const base = layoutText('AV\nz', measurer, 10, defaultOptions({ maxWidth: 100 }))
      const justified = layoutText('AV\nz', measurer, 10, defaultOptions({ maxWidth: 100, hAlign: 'justify' }))

      expect(Array.from(justified.lines[0]!.run!.advances)).toEqual(Array.from(base.lines[0]!.run!.advances))
    })

    it('縦書きでは just vertical data を列の inline-axis justification に使う', () => {
      const robotoBuffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
      const font = Font.load(robotoBuffer)
      const weights = new Map<number, number>()
      for (const character of 'ABCDE') weights.set(font.getGlyphId(character.codePointAt(0)!), 1)
      setParsedFontTable(font, 'just', makeJustTable(weights, true))
      const result = layoutText('ABCDE', new TextMeasurer(font), 10, defaultOptions({
        maxWidth: 100,
        maxHeight: 25,
        writingMode: 'vertical-rl',
        hAlign: 'justify',
      }))

      expect(result.lines.length).toBeGreaterThan(1)
      expect(result.lines[0]!.run!.advances.reduce((sum, value) => sum + value, 0)).toBeCloseTo(25)
      expect(result.lines[result.lines.length - 1]!.justifySpacing).toBeUndefined()
    })
  })

  describe('textTruncate', () => {
    // Verifies that textTruncate=truncate drops lines exceeding maxHeight and flags truncated.
    it('truncate: 高さを超える行を切り捨て', () => {
      const text = 'Line1\nLine2\nLine3\nLine4\nLine5'
      const lineHeight = robotoMeasurer.getLineHeight(10)
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({
        maxHeight: lineHeight * 2.5,
        textTruncate: 'truncate',
      }))
      expect(result.lines.length).toBeLessThanOrEqual(2)
      expect(result.truncated).toBe(true)
    })

    // Verifies that textTruncate=ellipsisChar appends an ellipsis to the last visible line.
    it('ellipsisChar: 省略記号付きで切り詰め', () => {
      const text = 'Line1\nLine2\nLine3\nLine4\nLine5'
      const lineHeight = robotoMeasurer.getLineHeight(10)
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({
        maxHeight: lineHeight * 2.5,
        textTruncate: 'ellipsisChar',
      }))
      expect(result.truncated).toBe(true)
      // The last line must contain the ellipsis
      const lastLine = result.lines[result.lines.length - 1]!
      expect(lastLine.text).toContain('...')
    })

    // Verifies that textTruncate=none still drops lines exceeding maxHeight (same as truncate).
    it('none: 切り詰めなし（高さ制限のみ）', () => {
      const text = 'Line1\nLine2\nLine3\nLine4\nLine5'
      const lineHeight = robotoMeasurer.getLineHeight(10)
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({
        maxHeight: lineHeight * 2.5,
        textTruncate: 'none',
      }))
      // Lines beyond the height limit are dropped (same behavior as truncate)
      expect(result.lines.length).toBeLessThanOrEqual(2)
    })
  })

  describe('stretchWithOverflow', () => {
    // Verifies that stretchWithOverflow=true renders all lines beyond elementHeight without truncation.
    it('stretchWithOverflow=true: 全行を描画', () => {
      const text = 'Line1\nLine2\nLine3\nLine4\nLine5'
      const lineHeight = robotoMeasurer.getLineHeight(10)
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({
        elementHeight: lineHeight * 2,
        stretchWithOverflow: true,
      }))
      expect(result.lines).toHaveLength(5)
      expect(result.truncated).toBe(false)
      expect(result.totalHeight).toBeGreaterThan(lineHeight * 2)
    })

    // Verifies that stretchWithOverflow=false keeps output within the element height.
    it('stretchWithOverflow=false: 高さ内に収める', () => {
      const text = 'Line1\nLine2\nLine3\nLine4\nLine5'
      const lineHeight = robotoMeasurer.getLineHeight(10)
      const result = layoutText(text, robotoMeasurer, 10, defaultOptions({
        elementHeight: lineHeight * 2,
        stretchWithOverflow: false,
        maxHeight: lineHeight * 2,
      }))
      expect(result.lines.length).toBeLessThan(5)
    })
  })

  describe('インデント', () => {
    // Verifies that firstLineIndent narrows only the first line, never reducing the line count.
    it('firstLineIndent: 1行目のみインデント', () => {
      const text = 'The quick brown fox jumps over the lazy dog and continues with more text'
      const withIndent = layoutText(text, robotoMeasurer, 10, defaultOptions({
        maxWidth: 100,
        firstLineIndent: 20,
      }))
      const withoutIndent = layoutText(text, robotoMeasurer, 10, defaultOptions({
        maxWidth: 100,
      }))
      // With the indent the line count is greater or equal (first line is narrower)
      expect(withIndent.lines.length).toBeGreaterThanOrEqual(withoutIndent.lines.length)
    })

    // Verifies that leftIndent narrows all lines, never reducing the line count.
    it('leftIndent: 全行にインデント', () => {
      const text = 'ABCDEFGHIJKLMNOP'
      const withIndent = layoutText(text, robotoMeasurer, 10, defaultOptions({
        maxWidth: 100,
        leftIndent: 30,
      }))
      const withoutIndent = layoutText(text, robotoMeasurer, 10, defaultOptions({
        maxWidth: 100,
      }))
      // With the indent the line count is greater or equal
      expect(withIndent.lines.length).toBeGreaterThanOrEqual(withoutIndent.lines.length)
    })
  })
})

// Integration tests: engine-level text layout via createReport with and without a fontMap.
describe('engine text layout integration', () => {
  // Verifies that with a fontMap a wrapping text element is emitted as a RenderGroup of RenderText lines.
  it('fontMap ありで複数行テキストが RenderGroup になる', async () => {
    const { createReport } = await import('../../src/layout/engine.js')
    const robotoBuffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
    const font = Font.load(robotoBuffer)
    const measurer = new TextMeasurer(font)
    const fontMap: Map<string, TextMeasurer> = new Map([['default', measurer]])

    const template: import('../../src/types/template.js').ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [
            {
              type: 'staticText',
              x: 0, y: 0, width: 80, height: 100,
              text: 'The quick brown fox jumps over the lazy dog',
            },
          ],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const page = doc.pages[0]!

    // The band group must contain a group dedicated to the text element
    const bandGroup = page.children[0]!
    expect(bandGroup.type).toBe('group')

    const textGroup = (bandGroup as any).children[0]
    expect(textGroup.type).toBe('group')

    // Multiple RenderText nodes must exist
    const textNodes = textGroup.children.filter((n: any) => n.type === 'text')
    expect(textNodes.length).toBeGreaterThan(1)
  })

  // ─── Simulation of fonts with a large lineGap ───
  // Japanese fonts such as Hiragino Kaku Gothic have a large lineGap (500/1000),
  // making lineHeight = 1.5 x fontSize.
  // Mimics ascender=800, descender=-200, lineGap=500, upm=1000.
  function createLargeLineGapMeasurer() {
    const upm = 1000
    const asc = 800
    const desc = -200
    const gap = 500
    return {
      font: {
        metrics: { unitsPerEm: upm, ascender: asc, descender: desc, lineGap: gap },
        merg: null,
        getLigatureCaretPositions() { return null },
      },
      measure(text: string, fontSize: number) {
        const scale = fontSize / upm
        const w = text.length * 500 * scale // each char width = 500 units
        return { width: w, advances: new Float64Array(text.length).fill(500 * scale) }
      },
      measureShaped(text: string, fontSize: number) {
        const m = this.measure(text, fontSize)
        const n = m.advances.length
        const shaped = new Array(n)
        const cpToGlyph = new Int32Array(n)
        for (let i = 0; i < n; i++) {
          shaped[i] = { glyphId: 0, xOffset: 0, yOffset: 0, xAdvance: 500, yAdvance: 500, componentCount: 1 }
          cpToGlyph[i] = i
        }
        return { width: m.width, advances: m.advances, shaped, cpToGlyph }
      },
      getLineHeight(fontSize: number) {
        return (asc - desc + gap) * (fontSize / upm) // 1.5 x fontSize
      },
      getAscent(fontSize: number) {
        return asc * (fontSize / upm) // 0.8 x fontSize
      },
      getDescent(fontSize: number) {
        return desc * (fontSize / upm) // -0.2 x fontSize
      },
    } as unknown as TextMeasurer
  }

  // Verifies that with a large lineGap font a line is rendered when elementHeight >= glyphHeight even if it is < lineHeight.
  it('lineGap が大きいフォントで elementHeight >= glyphHeight なら1行目が描画される', async () => {
    const { createReport } = await import('../../src/layout/engine.js')
    const measurer = createLargeLineGapMeasurer()
    const fontMap: Map<string, TextMeasurer> = new Map([['default', measurer]])

    // fontSize=20 -> glyphHeight=20, lineHeight=30
    // elementHeight=24 -> glyphHeight(20) < 24 < lineHeight(30)
    const template: import('../../src/types/template.js').ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{ name: 'lg', fontFamily: 'default', fontSize: 20 }],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 24,
            text: 'テスト', style: 'lg',
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const bandGroup = doc.pages[0]!.children[0] as any
    const textGroup = bandGroup.children[0]
    expect(textGroup.type).toBe('group')
    const textNodes = textGroup.children.filter((n: any) => n.type === 'text')
    // Even though lineHeight(30) > elementHeight(24), glyphHeight(20) <= 24 so it is rendered
    expect(textNodes.length).toBe(1)
    expect(textNodes[0].text).toBe('テスト')
  })

  // Verifies that no line is rendered when elementHeight is smaller than the glyph height itself.
  it('lineGap が大きいフォントで elementHeight < glyphHeight なら描画されない', async () => {
    const { createReport } = await import('../../src/layout/engine.js')
    const measurer = createLargeLineGapMeasurer()
    const fontMap: Map<string, TextMeasurer> = new Map([['default', measurer]])

    // fontSize=20 -> glyphHeight=20
    // elementHeight=18 < glyphHeight(20) -> truly does not fit, so nothing is rendered
    const template: import('../../src/types/template.js').ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{ name: 'lg', fontFamily: 'default', fontSize: 20 }],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 18,
            text: 'テスト', style: 'lg',
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const bandGroup = doc.pages[0]!.children[0] as any
    const textGroup = bandGroup.children[0]
    const textNodes = textGroup.children.filter((n: any) => n.type === 'text')
    expect(textNodes.length).toBe(0)
  })

  // Verifies that RenderText.y is the top edge of the text line and does not include the ascent.
  it('RenderText.y はテキスト行の上端位置であり ascent を含まない', async () => {
    const { createReport } = await import('../../src/layout/engine.js')
    const measurer = createLargeLineGapMeasurer()
    const fontMap: Map<string, TextMeasurer> = new Map([['default', measurer]])

    // fontSize=20 -> ascent=16
    // No padding -> RenderText.y should be 0 (top of the line)
    const template: import('../../src/types/template.js').ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{ name: 'lg', fontFamily: 'default', fontSize: 20 }],
      bands: {
        details: [{
          height: 40,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 40,
            text: 'ABC', style: 'lg',
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const bandGroup = doc.pages[0]!.children[0] as any
    const textGroup = bandGroup.children[0]
    const textNode = textGroup.children.find((n: any) => n.type === 'text')
    // y must be the line top (0) with no ascent (16) added
    expect(textNode.y).toBe(0)
  })

  // Verifies the multi-line fit check with a large lineGap font: last line only needs glyphHeight, not full lineHeight.
  it('lineGap が大きいフォントで複数行の収まり判定が正しい', async () => {
    const measurer = createLargeLineGapMeasurer()

    // fontSize=10 -> lineHeight=15, glyphHeight=10
    // maxWidth=25 -> 5pt per char so 5 chars per line -> "ABCDEFGHIJ" is 2 lines
    // Required height for 2 lines = lineHeight + glyphHeight = 15 + 10 = 25
    const result = layoutText('ABCDEFGHIJ', measurer, 10, {
      maxWidth: 25,
      elementHeight: 25,
    })
    expect(result.lines.length).toBe(2)

    // elementHeight=24 < 25 -> the second line does not fit, only 1 line
    const result2 = layoutText('ABCDEFGHIJ', measurer, 10, {
      maxWidth: 25,
      elementHeight: 24,
    })
    expect(result2.lines.length).toBe(1)
  })

  // Verifies that without a fontMap the engine emits a single RenderText node as before.
  it('fontMap なしで従来通り単一 RenderText', async () => {
    const { createReport } = await import('../../src/layout/engine.js')

    const template: import('../../src/types/template.js').ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [
            {
              type: 'staticText',
              x: 0, y: 0, width: 80, height: 100,
              text: 'Hello World',
            },
          ],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] })
    const page = doc.pages[0]!
    const bandGroup = page.children[0]!
    expect(bandGroup.type).toBe('group')

    // A RenderText node directly
    const textNode = (bandGroup as any).children[0]
    expect(textNode.type).toBe('text')
    expect(textNode.text).toBe('Hello World')
  })

  // Verifies prop complementary-glyph offsets take precedence over cmap mirroring in an RTL level.
  it('RTL visual reorder は prop のcomplementary bracket glyphを使用する', () => {
    const font = robotoMeasurer.font
    const sourceGlyph = font.getGlyphId('('.codePointAt(0)!)
    const complementaryGlyph = sourceGlyph + 2
    setParsedFontTable(font, 'prop', {
      version: 3,
      format: 1,
      defaultProperties: 0,
      getProperties(glyphId: number): number {
        return glyphId === sourceGlyph
          ? PROP_USE_COMPLEMENTARY_BRACKET | (2 << 8) | 11
          : 0
      },
    })

    const line = layoutText('(אב', robotoMeasurer, 12, { maxWidth: 200, direction: 'rtl' }).lines[0]!
    expect(Array.from(line.run!.glyphIds)).toContain(complementaryGlyph)
  })

  // Verifies MERG processing reaches the public render run after layout.
  it('MERG required sequenceをRenderGlyphRunへ伝播する', () => {
    const font = robotoMeasurer.font
    setParsedFontTable(font, 'merg', {
      getMergeGroups(glyphIds: readonly number[]): object[] {
        return [{ start: 0, end: glyphIds.length, mergeRequired: true }]
      },
    })

    const line = layoutText('AB', robotoMeasurer, 12, { maxWidth: 200 }).lines[0]!
    expect(Array.from(line.run!.mergeGroups!)).toEqual([1, 1])
  })
})
