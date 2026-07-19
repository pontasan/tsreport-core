import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderText, RenderPage } from '../../src/types/render.js'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { readFileSync } from 'fs'

// ─── Helpers ───

function findTexts(page: RenderPage): RenderText[] {
  const texts: RenderText[] = []
  function walk(nodes: import('../../src/types/render.js').RenderNode[]) {
    for (const n of nodes) {
      if (n.type === 'text') texts.push(n)
      if (n.type === 'group') walk(n.children)
    }
  }
  walk(page.children)
  return texts
}

// Load the font and build the FontMap
const fontBuf = readFileSync('tests/fixtures/fonts/Roboto-Regular.ttf')
const font = Font.load(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength) as ArrayBuffer)
const measurer = new TextMeasurer(font)
const fontMap = new Map([['default', measurer]])

// ─── Tests ───

// shrinkToFit: reduce the font size until the text fits the element box.
describe('テキスト自動縮小 (Shrink to Fit)', () => {
  // Verifies that the font size is unchanged when the text already fits.
  it('テキストが収まる場合はフォントサイズを変えない', () => {
    const template: ReportTemplate = {
      page: {
        width: 400, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            text: 'Short',
            x: 0, y: 0, width: 200, height: 30,
            shrinkToFit: true,
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = findTexts(doc.pages[0]!)
    // Default fontSize = 10, unchanged
    expect(texts[0]!.fontSize).toBe(10)
  })

  // Verifies that the font size is reduced when the text overflows the element box.
  it('テキストが溢れる場合はフォントサイズが縮小される', () => {
    // A long text at 10pt in a narrow 50pt width -> shrinking kicks in
    const template: ReportTemplate = {
      page: {
        width: 400, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 14,
          elements: [{
            type: 'staticText',
            text: 'This is a very long text that definitely does not fit',
            x: 0, y: 0, width: 50, height: 14,
            shrinkToFit: true,
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = findTexts(doc.pages[0]!)
    // The font size has become smaller than 10
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0]!.fontSize).toBeLessThan(10)
  })

  // Verifies that shrinking never goes below minFontSize even when the text still does not fit.
  it('minFontSize 未満には縮小しない', () => {
    const template: ReportTemplate = {
      page: {
        width: 400, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 10,
          elements: [{
            type: 'staticText',
            text: 'Extremely long text that will never fit in this tiny 20pt wide box no matter what font size',
            x: 0, y: 0, width: 20, height: 10,
            shrinkToFit: true,
            minFontSize: 6,
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = findTexts(doc.pages[0]!)
    // Must stay at or above minFontSize=6
    for (const t of texts) {
      expect(t.fontSize).toBeGreaterThanOrEqual(6)
    }
  })

  // Verifies that overflowing text is not shrunk when shrinkToFit is off.
  it('shrinkToFit が false の場合は縮小しない', () => {
    const template: ReportTemplate = {
      page: {
        width: 400, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 14,
          elements: [{
            type: 'staticText',
            text: 'This text overflows but shrinkToFit is off so no shrinking',
            x: 0, y: 0, width: 50, height: 14,
            // shrinkToFit not set (default false)
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = findTexts(doc.pages[0]!)
    // Default fontSize = 10, unchanged
    for (const t of texts) {
      expect(t.fontSize).toBe(10)
    }
  })

  // Verifies that with wrap=false the text is shrunk until it fits the element width.
  it('wrap=false + shrinkToFit=true の場合は横幅に収まるまで縮小される', () => {
    const template: ReportTemplate = {
      page: {
        width: 400, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 120,
          elements: [{
            type: 'staticText',
            text: 'LongSingleLineText',
            x: 0, y: 0, width: 50, height: 120,
            wrap: false,
            shrinkToFit: true,
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = findTexts(doc.pages[0]!)
    expect(texts.length).toBe(1)
    expect(texts[0]!.fontSize).toBeLessThan(10)

    const renderedWidth = measurer.measure(texts[0]!.text, texts[0]!.fontSize).width
    expect(renderedWidth).toBeLessThanOrEqual(50.25)
  })

  // Verifies that with wrap=false multi-line text is shrunk based on its longest line.
  it('wrap=false + 複数行テキストでは最長行が横幅に収まるまで縮小される', () => {
    const template: ReportTemplate = {
      page: {
        width: 400, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 120,
          elements: [{
            type: 'staticText',
            text: 'WWWWWWWWWWWWWWWW\nshort',
            x: 0, y: 0, width: 60, height: 120,
            wrap: false,
            shrinkToFit: true,
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] }, fontMap)
    const texts = findTexts(doc.pages[0]!)
    expect(texts.length).toBe(2)

    let maxLineWidth = 0
    for (let i = 0; i < texts.length; i++) {
      const lineWidth = measurer.measure(texts[i]!.text, texts[i]!.fontSize).width
      if (lineWidth > maxLineWidth) maxLineWidth = lineWidth
    }
    expect(maxLineWidth).toBeLessThanOrEqual(60.25)
    expect(texts[0]!.fontSize).toBeLessThan(10)
  })

  // Verifies that shrinkToFit also applies to textField elements, not just staticText.
  it('textField でも shrinkToFit が動作する', () => {
    const template: ReportTemplate = {
      page: {
        width: 400, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 14,
          elements: [{
            type: 'textField',
            expression: 'field.longText',
            x: 0, y: 0, width: 50, height: 14,
            shrinkToFit: true,
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{ longText: 'This is a very long text value from data' }] }, fontMap)
    const texts = findTexts(doc.pages[0]!)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0]!.fontSize).toBeLessThan(10)
  })
})
