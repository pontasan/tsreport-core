import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createReport } from '../../src/layout/engine.js'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

const ROBOTO_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')
const NOTO_JP_PATH = resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')

function loadFont(path: string): Font {
  const buffer = readFileSync(path).buffer as ArrayBuffer
  return Font.load(buffer)
}

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function renderMarkup(text: string): { texts: RenderText[]; roboto: Font; notoJp: Font } {
  const roboto = loadFont(ROBOTO_PATH)
  const notoJp = loadFont(NOTO_JP_PATH)
  const fontMap = new Map([
    ['en', new TextMeasurer(roboto)],
    ['jp', new TextMeasurer(notoJp)],
  ])
  const template: ReportTemplate = {
    page: { size: 'A4', margins: { top: 40, bottom: 40, left: 40, right: 40 } },
    styles: [{ name: 'base', fontFamily: 'en', fontSize: 12 }],
    bands: {
      title: {
        height: 100,
        elements: [{
          type: 'staticText',
          x: 0, y: 0, width: 500, height: 40,
          text, markup: 'html', style: 'base',
        }],
      },
    },
  }
  const doc = createReport(template, { rows: [{}] }, fontMap)
  return { texts: collectTexts(doc.pages[0]!.children), roboto, notoJp }
}

function runWidth(node: RenderText): number {
  let total = 0
  for (const a of node.glyphRun!.advances) total += a
  return total
}

// ─── Tests ───

describe('markup segments carry shaped glyph runs', () => {
  // Verifies every markup segment gets a glyph run so that the drawn glyphs
  // (kerning included) match the widths used to place the following segments.
  it('each segment carries a glyphRun and consecutive segments abut exactly', () => {
    const { texts } = renderMarkup('AVATAR <b>bold</b> end')
    expect(texts.length).toBe(3)
    for (const t of texts) {
      expect(t.glyphRun).toBeDefined()
    }
    // The next segment starts exactly at the drawn end of the previous one
    const first = texts[0]!
    const second = texts[1]!
    expect(second.x).toBeCloseTo(first.x + runWidth(first), 6)
    const third = texts[2]!
    expect(third.x).toBeCloseTo(second.x + runWidth(second), 6)
  })

  // Verifies the segment advance includes kerning: the shaped width of
  // "AVATAR " differs from the raw hmtx sum, and the placement uses the
  // shaped width (regression for the placement/drawing width mismatch).
  it('segment advance uses shaped (kerned) width, not raw hmtx sum', () => {
    const { texts, roboto } = renderMarkup('AVATAR <b>bold</b>')
    const first = texts[0]!
    expect(first.text).toBe('AVATAR ')
    const scale = 12 / roboto.metrics.unitsPerEm
    let hmtxSum = 0
    for (const ch of 'AVATAR ') {
      hmtxSum += roboto.getAdvanceWidth(roboto.getGlyphId(ch.codePointAt(0)!)) * scale
    }
    const shaped = runWidth(first)
    // Roboto kerns "AV"/"VA"/"TA": the shaped width must differ from raw hmtx
    expect(Math.abs(hmtxSum - shaped)).toBeGreaterThan(0.5)
    expect(texts[1]!.x).toBeCloseTo(first.x + shaped, 6)
  })

  // Verifies a face-switched segment advances by its own font's width, not the
  // base font's width (regression for the base-font measurement bug).
  it('font-switched segment advances by its own font width', () => {
    const { texts, notoJp } = renderMarkup('en <font face="jp">日本語</font> end')
    const jpSeg = texts.find(t => t.text === '日本語')!
    const endSeg = texts.find(t => t.text === ' end')!
    expect(jpSeg).toBeDefined()
    expect(endSeg).toBeDefined()
    expect(jpSeg.fontId).toBe('jp')
    const jpWidth = new TextMeasurer(notoJp).measure('日本語', 12).width
    expect(endSeg.x - jpSeg.x).toBeCloseTo(jpWidth, 6)
    // The segment's glyph run holds real glyphs of the jp font (not .notdef)
    for (const gid of jpSeg.glyphRun!.glyphIds) {
      expect(gid).not.toBe(0)
    }
  })
})

describe('markup <sup>/<sub> consume the OS/2 recommendations', () => {
  it('<sup> scales by ySuperscriptYSize and shifts by ySuperscriptYOffset', () => {
    const { texts, roboto } = renderMarkup('x<sup>2</sup>')
    const base = texts.find(t => t.text === 'x')!
    const sup = texts.find(t => t.text === '2')!
    const fm = roboto.metrics
    expect(sup.fontSize).toBeCloseTo(12 * fm.superscriptYSize / fm.unitsPerEm, 3)
    expect(base.y - sup.y).toBeCloseTo(12 * fm.superscriptYOffset / fm.unitsPerEm, 3)
    expect(sup.x).toBeGreaterThan(base.x)
  })

  it('<sub> scales by ySubscriptYSize and shifts down by ySubscriptYOffset', () => {
    const { texts, roboto } = renderMarkup('H<sub>2</sub>O')
    const base = texts.find(t => t.text === 'H')!
    const sub = texts.find(t => t.text === '2')!
    const fm = roboto.metrics
    expect(sub.fontSize).toBeCloseTo(12 * fm.subscriptYSize / fm.unitsPerEm, 3)
    expect(sub.y - base.y).toBeCloseTo(12 * fm.subscriptYOffset / fm.unitsPerEm, 3)
  })
})
