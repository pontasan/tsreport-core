import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderGroup, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

function findTexts(page: import('../../src/types/render.js').RenderPage): RenderText[] {
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

// ─── Tests ───

// Tests for table splitting across page boundaries.
describe('テーブルの改ページ跨ぎ', () => {
  // Verifies that a table fitting within one page renders without splitting.
  it('テーブルがページに収まる場合はそのまま描画', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        title: {
          height: 200,
          elements: [{
            type: 'table',
            x: 0, y: 0, width: 300, height: 200,
            columns: [{ width: 150 }, { width: 150 }],
            headerRows: [{ height: 20, cells: [{ text: 'Col A' }, { text: 'Col B' }] }],
            detailRows: [{ height: 20, cells: [{ expression: 'field.a' }, { expression: 'field.b' }] }],
          }],
        },
        details: [],
      },
    }

    const rows = [{ a: '1', b: '2' }, { a: '3', b: '4' }]
    const doc = createReport(template, { rows })

    // Fits within a single page
    expect(doc.pages.length).toBe(1)
  })

  // Verifies that a table taller than the page is split across multiple pages.
  it('テーブルがページを超える場合は複数ページに分割', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        title: {
          height: 500,
          elements: [{
            type: 'table',
            x: 0, y: 0, width: 300, height: 500,
            columns: [{ width: 300 }],
            headerRows: [{ height: 20, cells: [{ text: 'Header' }] }],
            detailRows: [{ height: 20, cells: [{ expression: 'field.v' }] }],
          }],
        },
        details: [],
      },
    }

    // 20 rows x 20pt = 400pt + header 20pt = 420pt > 200pt page height
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 20; i++) rows.push({ v: `Row ${i}` })
    const doc = createReport(template, { rows })

    // Split across multiple pages
    expect(doc.pages.length).toBeGreaterThan(1)
  })

  // Verifies that the table header row is re-rendered on every page after a split.
  it('分割時にヘッダーが各ページで再描画される', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        title: {
          height: 500,
          elements: [{
            type: 'table',
            x: 0, y: 0, width: 300, height: 500,
            columns: [{ width: 300 }],
            headerRows: [{ height: 20, cells: [{ text: 'HEADER' }] }],
            detailRows: [{ height: 20, cells: [{ expression: 'field.v' }] }],
          }],
        },
        details: [],
      },
    }

    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 20; i++) rows.push({ v: `Row ${i}` })
    const doc = createReport(template, { rows })

    // Every page contains the "HEADER" text
    for (let p = 0; p < doc.pages.length; p++) {
      const texts = findTexts(doc.pages[p]!)
      const headerTexts = texts.filter(t => t.text === 'HEADER')
      expect(headerTexts.length).toBeGreaterThanOrEqual(1)
    }
  })

  // Verifies that no data row is lost during splitting: every row appears on some page.
  it('全データ行がいずれかのページに含まれる', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 150,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        title: {
          height: 500,
          elements: [{
            type: 'table',
            x: 0, y: 0, width: 300, height: 500,
            columns: [{ width: 300 }],
            headerRows: [{ height: 20, cells: [{ text: 'H' }] }],
            detailRows: [{ height: 20, cells: [{ expression: 'field.v' }] }],
          }],
        },
        details: [],
      },
    }

    const numRows = 15
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < numRows; i++) rows.push({ v: `R${i}` })
    const doc = createReport(template, { rows })

    // All rows are rendered
    const allTexts: string[] = []
    for (const page of doc.pages) {
      const texts = findTexts(page)
      for (const t of texts) allTexts.push(t.text)
    }

    for (let i = 0; i < numRows; i++) {
      expect(allTexts).toContain(`R${i}`)
    }
  })

  // Verifies that footer rows render only on the last page, not on intermediate pages.
  it('フッター行は最終ページのみに描画', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 150,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        title: {
          height: 500,
          elements: [{
            type: 'table',
            x: 0, y: 0, width: 300, height: 500,
            columns: [{ width: 300 }],
            headerRows: [{ height: 20, cells: [{ text: 'H' }] }],
            detailRows: [{ height: 20, cells: [{ expression: 'field.v' }] }],
            footerRows: [{ height: 20, cells: [{ text: 'TOTAL' }] }],
          }],
        },
        details: [],
      },
    }

    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 10; i++) rows.push({ v: `R${i}` })
    const doc = createReport(template, { rows })

    // The last page contains TOTAL
    const lastPage = doc.pages[doc.pages.length - 1]!
    const lastTexts = findTexts(lastPage)
    expect(lastTexts.some(t => t.text === 'TOTAL')).toBe(true)

    // Intermediate pages do not contain TOTAL
    for (let p = 0; p < doc.pages.length - 1; p++) {
      const texts = findTexts(doc.pages[p]!)
      expect(texts.some(t => t.text === 'TOTAL')).toBe(false)
    }
  })
})
