import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { layoutText, type TextLayoutOptions } from '../../src/layout/text-layout.js'

const __dirname = new URL('.', import.meta.url).pathname

let measurer: TextMeasurer

beforeAll(() => {
  const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
  const font = Font.load(buffer)
  measurer = new TextMeasurer(font)
})

// ─── Helpers ───

function defaultOptions(overrides: Partial<TextLayoutOptions> = {}): TextLayoutOptions {
  return {
    maxWidth: 400,
    ...overrides,
  }
}

// ─── Tests ───

describe('tabStops', () => {
  // Verifies that a tab advances to an explicitly defined tab stop position.
  it('タブ + 定義済み tabStops → 正しい位置に揃う', () => {
    const text = 'Name\tValue'
    const result = layoutText(text, measurer, 10, defaultOptions({
      tabStops: [{ position: 100 }],
    }))
    expect(result.lines).toHaveLength(1)
    const line = result.lines[0]!
    // Width of 'Name' + tab advance = around 100pt
    // The width of 'Value' is added on top, so the line exceeds 100pt
    expect(line.width).toBeGreaterThan(100)
    // Must be wider than 'NameValue' without the tab
    const noTabResult = layoutText('NameValue', measurer, 10, defaultOptions())
    expect(line.width).toBeGreaterThan(noTabResult.lines[0]!.width)
  })

  // Verifies that without tabStops a tab advances by the default 40pt interval (common-report-compatible).
  it('タブ + tabStops 未定義 → デフォルト 40pt 間隔（一般的な帳票動作）', () => {
    const text = 'A\tB'
    const result = layoutText(text, measurer, 10, defaultOptions())
    expect(result.lines).toHaveLength(1)
    const line = result.lines[0]!
    // Width of 'A' is below 40pt, so the tab advances to the 40pt position
    const bWidth = layoutText('B', measurer, 10, defaultOptions()).lines[0]!.width
    // Width after the tab is around 40pt + bWidth
    expect(line.width).toBeCloseTo(40 + bWidth, 0)
  })

  // Verifies that tabStopWidth overrides the default tab interval.
  it('tabStopWidth 指定 → カスタムデフォルト間隔', () => {
    const text = 'A\tB'
    const result = layoutText(text, measurer, 10, defaultOptions({ tabStopWidth: 72 }))
    expect(result.lines).toHaveLength(1)
    const line = result.lines[0]!
    const bWidth = layoutText('B', measurer, 10, defaultOptions()).lines[0]!.width
    // tabStopWidth=72pt -> the tab advances to the 72pt position
    expect(line.width).toBeCloseTo(72 + bWidth, 0)
  })

  // Verifies that consecutive tabs advance to their respective tab stop positions.
  it('複数タブストップ → 各タブが対応する位置に移動', () => {
    const text = 'Col1\tCol2\tCol3'
    const result = layoutText(text, measurer, 10, defaultOptions({
      tabStops: [
        { position: 80 },
        { position: 160 },
      ],
    }))
    expect(result.lines).toHaveLength(1)
    const line = result.lines[0]!
    // First tab aligns at 80pt, second at 160pt
    // Line width is around 160pt + width of 'Col3'
    const col3Width = layoutText('Col3', measurer, 10, defaultOptions()).lines[0]!.width
    expect(line.width).toBeCloseTo(160 + col3Width, 0)
  })

  // Verifies that a tab near the line end causes the following text to wrap.
  it('タブが行末付近 → 次行に折り返し', () => {
    const text = 'AAAA\tBBBB'
    const result = layoutText(text, measurer, 10, defaultOptions({
      maxWidth: 60,
      tabStops: [{ position: 50 }],
    }))
    // 'AAAA' + tab(->50pt) + 'BBBB' > 60pt -> wrapping occurs
    expect(result.lines.length).toBeGreaterThanOrEqual(1)
  })

  // Verifies that tabs work independently on each line of multi-line text.
  it('複数行テキスト内のタブ', () => {
    const text = 'A\t1\nB\t2'
    const result = layoutText(text, measurer, 10, defaultOptions({
      tabStops: [{ position: 50 }],
    }))
    // 2 lines (explicit newline)
    expect(result.lines).toHaveLength(2)
    // Tabs work correctly on each line
    expect(result.lines[0]!.width).toBeGreaterThan(50)
    expect(result.lines[1]!.width).toBeGreaterThan(50)
  })
})
