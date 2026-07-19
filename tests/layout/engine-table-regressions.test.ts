import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import { layoutTable, layoutTablePaged, type TableDef } from '../../src/layout/table-layout.js'
import { layoutCrosstab } from '../../src/layout/crosstab-layout.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderPage, RenderText } from '../../src/types/render.js'
import type { TextMeasurer } from '../../src/measure/text-measurer.js'

interface AbsText { text: string; absX: number; absY: number }

function collectAbsTexts(page: RenderPage): AbsText[] {
  const out: AbsText[] = []
  function walk(nodes: RenderNode[], ox: number, oy: number): void {
    for (const n of nodes) {
      if (n.type === 'text') out.push({ text: (n as RenderText).text, absX: ox + n.x, absY: oy + n.y })
      else if (n.type === 'group') walk(n.children, ox + n.x, oy + n.y)
    }
  }
  walk(page.children, 0, 0)
  return out
}

function collectNodeTexts(nodes: RenderNode[]): string[] {
  const out: string[] = []
  function walk(list: RenderNode[]): void {
    for (const n of list) {
      if (n.type === 'text') out.push(n.text)
      else if (n.type === 'group') walk(n.children)
    }
  }
  walk(nodes)
  return out
}

// Simple monospaced mock measurer for wrapping tests (no font fixture needed).
function createMockMeasurer(charWidth = 6): TextMeasurer {
  const upm = 1000, asc = 800, desc = -200, gap = 0
  return {
    font: { metrics: { unitsPerEm: upm, ascender: asc, descender: desc, lineGap: gap } },
    measure(text: string) {
      const chars = [...text]
      const advances = new Float64Array(chars.length)
      let width = 0
      for (let i = 0; i < chars.length; i++) { advances[i] = charWidth; width += charWidth }
      return { width, advances }
    },
    measureShaped(text: string, fontSize: number) {
      const m = (this as { measure(t: string, s: number): { width: number; advances: Float64Array } }).measure(text, fontSize)
      const n = m.advances.length
      const advanceFontUnits = charWidth * upm / fontSize
      const shaped = new Array(n)
      const cpToGlyph = new Int32Array(n)
      for (let i = 0; i < n; i++) {
        shaped[i] = { glyphId: 0, xOffset: 0, yOffset: 0, xAdvance: advanceFontUnits, yAdvance: advanceFontUnits, componentCount: 1 }
        cpToGlyph[i] = i
      }
      return { width: m.width, advances: m.advances, shaped, cpToGlyph }
    },
    measureSimple(text: string, fontSize: number) {
      return (this as { measure(t: string, s: number): unknown }).measure(text, fontSize)
    },
    getLineHeight(fontSize: number) { return (asc - desc + gap) * (fontSize / upm) },
    getAscent(fontSize: number) { return asc * (fontSize / upm) },
    getDescent(fontSize: number) { return desc * (fontSize / upm) },
  } as unknown as TextMeasurer
}

// Regression: paginated tables/crosstabs used to double-apply elem.x/elem.y
// (chunks carried the offsets AND the inline-band wrapper re-applied them),
// shifting content on every page and pushing the first chunk off page 1.
describe('テーブル/クロス集計のページ分割座標', () => {
  it('分割テーブルの絶対座標が非分割と一致する（elem.x/y の二重適用なし）', () => {
    function makeTemplate(pageHeight: number, numRows: number): { template: ReportTemplate; rows: Record<string, unknown>[] } {
      const template: ReportTemplate = {
        page: { width: 400, height: pageHeight, margins: { top: 5, bottom: 5, left: 10, right: 10 } },
        bands: {
          title: {
            height: pageHeight - 10,
            elements: [{
              type: 'table',
              x: 50, y: 30, width: 200, height: 100,
              columns: [{ width: 100 }, { width: 100 }],
              headerRows: [{ height: 20, cells: [{ text: 'HA' }, { text: 'HB' }] }],
              detailRows: [{ height: 20, cells: [{ expression: 'field.a' }, { expression: 'field.b' }] }],
            }],
          },
          details: [],
        },
      }
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < numRows; i++) rows.push({ a: `R${i}`, b: `S${i}` })
      return { template, rows }
    }

    // Control: fits on one page
    const ctl = makeTemplate(600, 3)
    const ctlTexts = collectAbsTexts(createReport(ctl.template, { rows: ctl.rows }).pages[0]!)
    const ctlHA = ctlTexts.find(t => t.text === 'HA')!
    const ctlS0 = ctlTexts.find(t => t.text === 'S0')!
    expect(ctlHA.absX).toBe(62) // marginLeft 10 + elem.x 50 + padding 2

    // Paginated: same content must land at the same absolute position
    const pgd = makeTemplate(200, 20)
    const doc = createReport(pgd.template, { rows: pgd.rows })
    expect(doc.pages.length).toBeGreaterThan(1)

    const p1 = collectAbsTexts(doc.pages[0]!)
    expect(p1.length).toBeGreaterThan(0) // page 1 must not be empty
    const p1HA = p1.find(t => t.text === 'HA')!
    const p1S0 = p1.find(t => t.text === 'S0')!
    expect(p1HA.absX).toBe(ctlHA.absX)
    expect(p1HA.absY).toBe(ctlHA.absY)
    expect(p1S0.absX).toBe(ctlS0.absX)

    // Continuation pages: X stays put, content restarts below the top margin
    const p2 = collectAbsTexts(doc.pages[1]!)
    const p2HA = p2.find(t => t.text === 'HA')!
    expect(p2HA.absX).toBe(ctlHA.absX)
    expect(p2HA.absY).toBe(7) // marginTop 5 + padding 2
  })

  it('分割クロス集計の絶対座標が非分割と一致し、1ページ目が空にならない', () => {
    function makeTemplate(pageHeight: number, numProducts: number): { template: ReportTemplate; rows: Record<string, unknown>[] } {
      const template: ReportTemplate = {
        page: { width: 500, height: pageHeight, margins: { top: 5, bottom: 5, left: 10, right: 10 } },
        bands: {
          title: {
            height: pageHeight - 10,
            elements: [{
              type: 'crosstab',
              x: 40, y: 25, width: 400, height: 100,
              rowGroups: [{ field: 'product' }],
              columnGroups: [{ field: 'quarter' }],
              measures: [{ field: 'amount', calculation: 'sum' }],
              rowHeaderWidth: 80, columnHeaderHeight: 20, cellWidth: 60, cellHeight: 20,
            }],
          },
          details: [],
        },
      }
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < numProducts; i++) {
        rows.push({ product: `P${i}`, quarter: 'Q1', amount: 10 + i })
        rows.push({ product: `P${i}`, quarter: 'Q2', amount: 20 + i })
      }
      return { template, rows }
    }

    const ctl = makeTemplate(600, 3)
    const ctlTexts = collectAbsTexts(createReport(ctl.template, { rows: ctl.rows }).pages[0]!)
    const ctlQ1 = ctlTexts.find(t => t.text === 'Q1')!
    const ctlP0 = ctlTexts.find(t => t.text === 'P0')!
    expect(ctlQ1.absX).toBe(132) // marginLeft 10 + elem.x 40 + rowHeaderWidth 80 + padding 2
    expect(ctlP0.absX).toBe(52)  // marginLeft 10 + elem.x 40 + padding 2

    const pgd = makeTemplate(150, 30)
    const doc = createReport(pgd.template, { rows: pgd.rows })
    expect(doc.pages.length).toBeGreaterThan(1)

    for (let p = 0; p < Math.min(doc.pages.length, 3); p++) {
      const texts = collectAbsTexts(doc.pages[p]!)
      expect(texts.length, `page ${p + 1} must not be empty`).toBeGreaterThan(0)
      const q1 = texts.find(t => t.text === 'Q1')!
      expect(q1.absX, `page ${p + 1} column header X`).toBe(ctlQ1.absX)
      const firstRowHeader = texts.find(t => /^P\d+$/.test(t.text))!
      expect(firstRowHeader.absX, `page ${p + 1} row header X`).toBe(ctlP0.absX)
    }
  })
})

// Regression: the last-chunk footer used to be appended without a fit check,
// overflowing the page bottom. The footer now defers rows to the next page.
describe('テーブルフッターのページ収まり', () => {
  const tableDef: TableDef = {
    columns: [{ width: 300 }],
    headerRows: [{ height: 20, cells: [{ text: 'H' }] }],
    detailRows: [{ height: 20, cells: [{ expression: 'field.v' }] }],
    footerRows: [{ height: 40, cells: [{ text: 'TOTAL' }] }],
  }
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < 8; i++) rows.push({ v: `R${i}` })

  it('layoutTablePaged: フッター込みで maxHeight を超えるチャンクを生成しない', () => {
    // Remaining 4 rows fit exactly without the footer (header 20 + 80 = 100):
    // the footer must defer rows instead of producing a 140pt chunk.
    const res = layoutTablePaged(tableDef, 0, 0, 300, rows, {}, 4, 100)
    expect(res.group.height).toBeLessThanOrEqual(100)
    expect(res.complete).toBe(false)
  })

  it('エンジン経由: TOTAL 行がページ下端の内側に描画される', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        title: {
          height: 100,
          elements: [{
            type: 'table',
            x: 0, y: 0, width: 300, height: 100,
            columns: [{ width: 300 }],
            headerRows: [{ height: 20, cells: [{ text: 'H' }] }],
            detailRows: [{ height: 20, cells: [{ expression: 'field.v' }] }],
            footerRows: [{ height: 40, cells: [{ text: 'TOTAL' }] }],
          }],
        },
        details: [],
      },
    }
    const doc = createReport(template, { rows })
    const lastPage = doc.pages[doc.pages.length - 1]!
    const texts = collectAbsTexts(lastPage)
    const total = texts.find(t => t.text === 'TOTAL')!
    expect(total).toBeDefined()
    // Footer row occupies 40pt: its top must be at or above height-40
    expect(total.absY).toBeLessThanOrEqual(lastPage.height - 40 + 2 /* padding */)
    // Every page keeps all rows: nothing lost or duplicated
    const allRows = doc.pages.flatMap(p => collectAbsTexts(p)).filter(t => /^R\d$/.test(t.text)).map(t => t.text)
    expect([...allRows].sort()).toEqual(rows.map((_, i) => `R${i}`).sort())
  })
})

// Regression: an empty-data crosstab with showGrandTotal used to render a
// ghost "Total × Total = 0" grid.
describe('空データのクロス集計', () => {
  it('showGrandTotal でもデータ 0 件なら総計セルを描画しない', () => {
    const group = layoutCrosstab({
      rowGroups: [{ field: 'p' }],
      columnGroups: [{ field: 'q' }],
      measures: [{ field: 'v', calculation: 'sum' }],
      showGrandTotal: true,
    }, 0, 0, [])
    expect(collectNodeTexts(group.children)).toEqual([])
  })
})

// Regression: wrapped text in rowSpan cells used to be excluded from the row
// height pass, silently clipping the content.
describe('rowSpan セルの折り返しテキスト', () => {
  it('rowSpan セルの長文がスパン行全体を伸長させる（内容が切り捨てられない）', () => {
    const measurer = createMockMeasurer(6)
    const longText = 'A'.repeat(200)
    const t: TableDef = {
      columns: [{ width: 60 }, { width: 60 }],
      detailRows: [
        { height: 20, cells: [{ text: longText, rowSpan: 2 }, { text: 'B1' }] },
        { height: 20, cells: [{ text: 'B2' }] },
      ],
    }
    const group = layoutTable(t, 0, 0, 120, [{}], { measurer })
    // 200 chars * 6pt = 1200pt over 56pt available width -> ~22 lines * 10pt
    // (+ padding). Without the fix the table stayed at 40pt and clipped ~20
    // lines; with the fix the spanned rows grow to hold the full content.
    expect(group.height).toBeGreaterThanOrEqual(224)
  })
})
