import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { createReport, type FontMap } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderText, RenderNode } from '../../src/types/render.js'

const __dirname = new URL('.', import.meta.url).pathname

let fontMap: FontMap
let measurer: TextMeasurer

beforeAll(() => {
  const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
  const font = Font.load(buffer)
  measurer = new TextMeasurer(font)
  fontMap = new Map([['default', measurer]])
})

// ─── Helpers ───

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const result: RenderText[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'text') result.push(node)
    if (node.type === 'group') result.push(...collectTexts(node.children))
  }
  return result
}

function measureRendererWidth(text: string, fontSize: number, italic: boolean, bold: boolean): number {
  // Mirrors the renderer: shaped glyphs (GSUB/GPOS applied) drawn at shaped advances
  const font = measurer.font
  const metrics = font.metrics
  const scale = fontSize / metrics.unitsPerEm
  const syntheticItalic = italic && !metrics.isItalic
  const syntheticBold = bold && !metrics.isBold
  const slant = syntheticItalic ? Math.tan(12 * Math.PI / 180) : 0
  const boldHalf = syntheticBold ? (fontSize * 0.025) / 2 : 0

  let width = 0
  let penUnits = 0
  let maxRight = 0
  const shaped = font.shapeText(text)
  for (let i = 0; i < shaped.length; i++) {
    const s = shaped[i]!
    width += s.xAdvance * scale

    const glyph = font.getGlyph(s.glyphId)
    let glyphRightUnits = glyph.xMax
    if (slant !== 0) glyphRightUnits += glyph.yMax * slant
    const right = (penUnits + s.xOffset + glyphRightUnits) * scale + boldHalf
    if (right > maxRight) maxRight = right

    penUnits += s.xAdvance
  }

  return maxRight > width ? maxRight : width
}

// ─── Tests ───

// fitWidth scales the font size so the text exactly fills the element width (wrap=false).
describe('fitWidth', () => {
  // Verifies that a short single-line text is scaled up so its rendered width fills the element width.
  it('fitWidth=true + wrap=false + 短テキスト → フォントサイズが拡大される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [{
            type: 'staticText', x: 0, y: 0, width: 200, height: 120,
            text: 'Short',
            wrap: false,
            fitWidth: true,
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.length).toBe(1)
    expect(texts[0]!.fontSize).toBeGreaterThan(10)
    const measured = measureRendererWidth(texts[0]!.text, texts[0]!.fontSize, texts[0]!.italic ?? false, texts[0]!.bold ?? false)
    expect(measured).toBeGreaterThanOrEqual(199.5)
    expect(measured).toBeLessThanOrEqual(200.5)
  })

  // Verifies that an overflowing single-line text is scaled down to exactly fit the element width.
  it('fitWidth=true + wrap=false + 長文 → フォントサイズが縮小される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 80,
          elements: [{
            type: 'staticText', x: 10, y: 0, width: 80, height: 80,
            text: 'This is a very long text that exceeds the element width easily',
            wrap: false,
            fitWidth: true,
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.length).toBe(1)
    expect(texts[0]!.fontSize).toBeLessThan(10)
    const measured = measureRendererWidth(texts[0]!.text, texts[0]!.fontSize, texts[0]!.italic ?? false, texts[0]!.bold ?? false)
    expect(measured).toBeGreaterThanOrEqual(79.5)
    expect(measured).toBeLessThanOrEqual(80.5)
  })

  // Verifies that multi-line text is scaled based on its longest line, not each line independently.
  it('fitWidth=true + wrap=false + 複数行テキスト → 最長行基準で調整される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [{
            type: 'staticText', x: 0, y: 0, width: 100, height: 120,
            text: 'WWWWWWWWWWWW\nshort',
            wrap: false,
            fitWidth: true,
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.length).toBe(2)
    let maxWidth = 0
    for (let i = 0; i < texts.length; i++) {
      const width = measureRendererWidth(texts[i]!.text, texts[i]!.fontSize, texts[i]!.italic ?? false, texts[i]!.bold ?? false)
      if (width > maxWidth) maxWidth = width
    }
    expect(maxWidth).toBeGreaterThanOrEqual(99.5)
    expect(maxWidth).toBeLessThanOrEqual(100.5)
  })

  // Verifies that with right alignment and synthetic italic the rendered right edge stays within the element width.
  it('fitWidth=true + hAlign=right でも右端が要素幅を超えない', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{
        name: 'ItalicStyle',
        fontFamily: 'default',
        fontSize: 10,
        italic: true,
      }],
      bands: {
        details: [{
          height: 120,
          elements: [{
            type: 'staticText', x: 0, y: 0, width: 100, height: 120,
            text: 'RightEdgeCheck',
            style: 'ItalicStyle',
            wrap: false,
            hAlign: 'right',
            fitWidth: true,
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.length).toBe(1)
    const width = measureRendererWidth(texts[0]!.text, texts[0]!.fontSize, texts[0]!.italic ?? false, texts[0]!.bold ?? false)
    const rightEdge = texts[0]!.x + width
    expect(rightEdge).toBeLessThanOrEqual(100.5)
    expect(rightEdge).toBeGreaterThanOrEqual(99.0)
  })

  // Verifies that the font size stays at the specified value when fitWidth is not set.
  it('fitWidth 未指定 → フォントサイズは指定値のまま', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [{
            type: 'staticText', x: 0, y: 0, width: 200, height: 120,
            text: 'Short',
            wrap: false,
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.length).toBe(1)
    expect(texts[0]!.fontSize).toBe(10)
  })
})
