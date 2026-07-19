/**
 * Crosstab page break tests.
 *
 * Verifies that page splitting via layoutCrosstabPaged is integrated into the engine
 * in the same manner as table page breaking.
 */
import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderText, RenderPage, RenderNode } from '../../src/types/render.js'

// ─── Helpers ───

function findTexts(page: RenderPage): RenderText[] {
  const texts: RenderText[] = []
  function walk(nodes: RenderNode[]) {
    for (const n of nodes) {
      if (n.type === 'text') texts.push(n)
      if (n.type === 'group') walk(n.children)
    }
  }
  walk(page.children)
  return texts
}

/** Generates crosstab data with n row keys R00..R(n-1) crossed with columns C1/C2 */
function makeRows(numRowKeys: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < numRowKeys; i++) {
    const key = `R${String(i).padStart(2, '0')}`
    rows.push({ cat: key, col: 'C1', amount: 10 })
    rows.push({ cat: key, col: 'C2', amount: 20 })
  }
  return rows
}

function makeTemplate(pageHeight: number, showGrandTotal: boolean): ReportTemplate {
  return {
    page: {
      width: 300, height: pageHeight,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    },
    bands: {
      title: {
        height: 500,
        elements: [{
          type: 'crosstab',
          x: 0, y: 0, width: 300, height: 500,
          rowGroups: [{ field: 'cat' }],
          columnGroups: [{ field: 'col' }],
          measures: [{ field: 'amount', calculation: 'sum' }],
          showGrandTotal,
          border: { color: '#000000', width: 0.5 },
        }],
      },
      details: [],
    },
  }
}

// ─── Tests ───

// Tests for crosstab splitting across page boundaries.
describe('クロス集計の改ページ跨ぎ', () => {
  // Regression: a crosstab that fits within one page renders without splitting.
  it('クロス集計がページに収まる場合はそのまま描画（回帰）', () => {
    // 3 rows x 20pt + header 20pt = 80pt < 400pt
    const doc = createReport(makeTemplate(400, false), { rows: makeRows(3) })

    expect(doc.pages.length).toBe(1)

    const texts = findTexts(doc.pages[0]!).map(t => t.text)
    expect(texts).toContain('C1')
    expect(texts).toContain('C2')
    expect(texts).toContain('R00')
    expect(texts).toContain('R01')
    expect(texts).toContain('R02')
    // R00×C1 = 10, R00×C2 = 20
    expect(texts).toContain('10')
    expect(texts).toContain('20')
  })

  // Verifies that a crosstab taller than the page is split across multiple pages.
  it('クロス集計がページを超える場合は複数ページに分割', () => {
    // 20 rows x 20pt + header 20pt = 420pt > 200pt page height
    const doc = createReport(makeTemplate(200, false), { rows: makeRows(20) })

    expect(doc.pages.length).toBeGreaterThan(1)
  })

  // Verifies that column headers are re-rendered on every page after a split.
  it('分割時に列ヘッダーが各ページで再描画される', () => {
    const doc = createReport(makeTemplate(200, false), { rows: makeRows(20) })

    expect(doc.pages.length).toBeGreaterThan(1)
    for (let p = 0; p < doc.pages.length; p++) {
      const texts = findTexts(doc.pages[p]!).map(t => t.text)
      expect(texts).toContain('C1')
      expect(texts).toContain('C2')
    }
  })

  // Verifies that every data row is rendered exactly once across pages, with no loss or duplication.
  it('全データ行が欠落・重複なく正確に1回ずつ描画される', () => {
    const numRowKeys = 20
    const doc = createReport(makeTemplate(200, false), { rows: makeRows(numRowKeys) })

    expect(doc.pages.length).toBeGreaterThan(1)

    const allTexts: string[] = []
    for (const page of doc.pages) {
      for (const t of findTexts(page)) allTexts.push(t.text)
    }

    for (let i = 0; i < numRowKeys; i++) {
      const key = `R${String(i).padStart(2, '0')}`
      const count = allTexts.filter(t => t === key).length
      expect(count, `row ${key} must appear exactly once`).toBe(1)
    }
  })

  // Verifies that rows never straddle a page boundary: each page's chunk fits within the page height.
  it('行がページ境界をまたがない（各ページのチャンクがページ高さに収まる）', () => {
    const pageHeight = 200
    const doc = createReport(makeTemplate(pageHeight, false), { rows: makeRows(20) })

    expect(doc.pages.length).toBeGreaterThan(1)
    for (const page of doc.pages) {
      // Find the crosstab chunk groups (groups with clip)
      function findChunks(nodes: RenderNode[], offsetY: number): { top: number, bottom: number }[] {
        const found: { top: number, bottom: number }[] = []
        for (const n of nodes) {
          if (n.type === 'group') {
            if (n.clip) {
              found.push({ top: offsetY + n.y, bottom: offsetY + n.y + n.height })
            } else {
              found.push(...findChunks(n.children, offsetY + n.y))
            }
          }
        }
        return found
      }
      const chunks = findChunks(page.children, 0)
      for (const chunk of chunks) {
        expect(chunk.bottom).toBeLessThanOrEqual(pageHeight)
      }
    }
  })

  // Verifies that the grand total row renders only on the last page while the grand total column header repeats.
  it('総合計行は最終ページのみに描画される', () => {
    // showGrandTotal: the grand total row draws 'Total' at the row header position (x=2).
    // The grand total column header 'Total' (x=202) repeats on every page, so distinguish by x.
    const grandTotalRowX = 2 // pad
    const doc = createReport(makeTemplate(200, true), { rows: makeRows(20) })

    expect(doc.pages.length).toBeGreaterThan(1)

    // The last page contains the grand total row
    const lastTexts = findTexts(doc.pages[doc.pages.length - 1]!)
    expect(lastTexts.some(t => t.text === 'Total' && t.x === grandTotalRowX)).toBe(true)
    // Grand total value: 20 rows x (10+20) = 600
    expect(lastTexts.some(t => t.text === '600')).toBe(true)

    // Intermediate pages do not contain the grand total row
    for (let p = 0; p < doc.pages.length - 1; p++) {
      const texts = findTexts(doc.pages[p]!)
      expect(texts.some(t => t.text === 'Total' && t.x === grandTotalRowX)).toBe(false)
      expect(texts.some(t => t.text === '600')).toBe(false)
    }

    // The grand total column header is re-rendered on every page
    for (let p = 0; p < doc.pages.length; p++) {
      const texts = findTexts(doc.pages[p]!)
      expect(texts.some(t => t.text === 'Total' && t.x !== grandTotalRowX)).toBe(true)
    }
  })

  // Verifies that grand total values aggregate over the full dataset, unaffected by page splitting.
  it('総合計行の値は全データから集計される（分割の影響を受けない）', () => {
    const doc = createReport(makeTemplate(200, true), { rows: makeRows(20) })

    const lastTexts = findTexts(doc.pages[doc.pages.length - 1]!).map(t => t.text)
    // C1 column total = 20 rows x 10 = 200, C2 column total = 20 rows x 20 = 400
    expect(lastTexts).toContain('200')
    expect(lastTexts).toContain('400')
    // Grand total = 600
    expect(lastTexts).toContain('600')
  })
})
