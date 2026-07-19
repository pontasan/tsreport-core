/**
 * Crosstab multi-level group, subtotal, and multi-measure tests.
 *
 * - Multi-level row groups: one column per level; outer groups merge vertically (rowSpan-like)
 * - Multi-level column groups: outer on top row, inner below; outer spans the width of its child columns
 * - Subtotals (showSubtotals): a "Total" row/column at the end of each non-innermost group block
 * - Multiple measures: stacked vertically inside data cells (matching common report defaults)
 * - headerFormat: formatting applied to group header values
 * - Multi-level + page break splitting, and regression of the existing single-level output
 *
 * Runs without font measurement (no measurer) so cell coordinates are deterministic.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { createReport, type FontMap } from '../../src/layout/engine.js'
import type { ReportTemplate, ElementDef } from '../../src/types/template.js'
import type { RenderText, RenderPage, RenderNode } from '../../src/types/render.js'

// ─── Helpers ───

/** Collects all text nodes in a page with absolute coordinates */
function findTexts(page: RenderPage): RenderText[] {
  const texts: RenderText[] = []
  function walk(nodes: RenderNode[], offsetX: number, offsetY: number) {
    for (const n of nodes) {
      if (n.type === 'text') texts.push({ ...n, x: n.x + offsetX, y: n.y + offsetY })
      if (n.type === 'group') walk(n.children, offsetX + n.x, offsetY + n.y)
    }
  }
  walk(page.children, 0, 0)
  return texts
}

function hasTextAt(texts: RenderText[], text: string, x: number, y: number): boolean {
  return texts.some(t => t.text === text && t.x === x && t.y === y)
}

function makeTemplate(pageWidth: number, pageHeight: number, element: ElementDef): ReportTemplate {
  return {
    page: { width: pageWidth, height: pageHeight, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: {
      title: { height: pageHeight, elements: [element] },
      details: [],
    },
  }
}

// 2-level row groups (region > city) x 2-level column groups (half > quarter)
// Values are powers of two so every partial sum is unique
const multiLevelData = [
  { region: 'East', city: 'NY', half: 'H1', quarter: 'Q1', amount: 1 },
  { region: 'East', city: 'NY', half: 'H1', quarter: 'Q2', amount: 2 },
  { region: 'East', city: 'NY', half: 'H2', quarter: 'Q3', amount: 4 },
  { region: 'East', city: 'BOS', half: 'H1', quarter: 'Q1', amount: 8 },
  { region: 'East', city: 'BOS', half: 'H1', quarter: 'Q2', amount: 16 },
  { region: 'East', city: 'BOS', half: 'H2', quarter: 'Q3', amount: 32 },
  { region: 'West', city: 'LA', half: 'H1', quarter: 'Q1', amount: 64 },
  { region: 'West', city: 'LA', half: 'H1', quarter: 'Q2', amount: 128 },
  { region: 'West', city: 'LA', half: 'H2', quarter: 'Q3', amount: 256 },
]

// Geometry: rowHeaderWidth=80 x 2 levels means the data area starts at x=160
// colHeaderHeight=20 x 2 levels means data rows start at y=40
// Cell text: x = cellX + 2, y = rowY + 3 (without measurer)

// Tests for crosstab multi-level groups, subtotals, multiple measures, and header formatting.
describe('クロス集計 多段グループ', () => {
  // Verifies hierarchical header placement and data cell positions for 2-level row x 2-level column groups.
  it('2段行グループ × 2段列グループ: 階層ヘッダーとデータ配置', () => {
    const doc = createReport(makeTemplate(600, 300, {
      type: 'crosstab',
      x: 0, y: 0, width: 580, height: 280,
      rowGroups: [{ field: 'region' }, { field: 'city' }],
      columnGroups: [{ field: 'half' }, { field: 'quarter' }],
      measures: [{ field: 'amount', calculation: 'sum' }],
    }), { rows: multiLevelData })

    expect(doc.pages.length).toBe(1)
    const texts = findTexts(doc.pages[0]!)

    // Outer row group headers merge vertically and are drawn only once
    expect(texts.filter(t => t.text === 'East').length).toBe(1)
    expect(texts.filter(t => t.text === 'West').length).toBe(1)
    expect(hasTextAt(texts, 'East', 2, 43)).toBe(true)   // Level-0 column, first row of the East block
    expect(hasTextAt(texts, 'West', 2, 83)).toBe(true)   // First row of the West block (3rd row)

    // Inner row group headers are drawn on every row (level-1 column x=82)
    expect(hasTextAt(texts, 'NY', 82, 43)).toBe(true)
    expect(hasTextAt(texts, 'BOS', 82, 63)).toBe(true)
    expect(hasTextAt(texts, 'LA', 82, 83)).toBe(true)

    // Outer column group headers sit on the top row (y=3), span their child columns, and are drawn once
    expect(texts.filter(t => t.text === 'H1').length).toBe(1)
    expect(hasTextAt(texts, 'H1', 162, 3)).toBe(true)    // Spans the 2 columns Q1+Q2
    expect(hasTextAt(texts, 'H2', 282, 3)).toBe(true)
    // Inner column group headers sit on the lower row (y=23)
    expect(hasTextAt(texts, 'Q1', 162, 23)).toBe(true)
    expect(hasTextAt(texts, 'Q2', 222, 23)).toBe(true)
    expect(hasTextAt(texts, 'Q3', 282, 23)).toBe(true)

    // Data cells: aggregated value at each (row, column) intersection
    expect(hasTextAt(texts, '1', 162, 43)).toBe(true)    // NY x Q1
    expect(hasTextAt(texts, '16', 222, 63)).toBe(true)   // BOS x Q2
    expect(hasTextAt(texts, '256', 282, 83)).toBe(true)  // LA x Q3
  })

  // Verifies subtotal and grand total row/column values and their exact positions with showSubtotals + showGrandTotal.
  it('小計行・小計列 (showSubtotals + showGrandTotal) の値と位置', () => {
    const doc = createReport(makeTemplate(700, 300, {
      type: 'crosstab',
      x: 0, y: 0, width: 680, height: 280,
      rowGroups: [{ field: 'region' }, { field: 'city' }],
      columnGroups: [{ field: 'half' }, { field: 'quarter' }],
      measures: [{ field: 'amount', calculation: 'sum' }],
      showSubtotals: true,
      showGrandTotal: true,
    }), { rows: multiLevelData })

    const texts = findTexts(doc.pages[0]!)

    // Logical rows: NY(40), BOS(60), T[East](80), LA(100), T[West](120), T[grand total](140)
    // Logical columns: Q1(160), Q2(220), T[H1](280), Q3(340), T[H2](400), T[grand total](460)

    // Subtotal row "Total" merges from the level-1 column (x=82) to the right edge
    expect(hasTextAt(texts, 'Total', 82, 83)).toBe(true)   // East subtotal row
    expect(hasTextAt(texts, 'Total', 82, 123)).toBe(true)  // West subtotal row
    // Grand total row "Total" starts at the level-0 column (x=2)
    expect(hasTextAt(texts, 'Total', 2, 143)).toBe(true)

    // Subtotal column "Total" header merges from the level-1 row (y=23) to the bottom
    expect(hasTextAt(texts, 'Total', 282, 23)).toBe(true)  // H1 subtotal column
    expect(hasTextAt(texts, 'Total', 402, 23)).toBe(true)  // H2 subtotal column
    // Grand total column "Total" header starts at the level-0 row (y=3)
    expect(hasTextAt(texts, 'Total', 462, 3)).toBe(true)

    // "Total" appears at 3 rows + 3 columns = 6 places
    expect(texts.filter(t => t.text === 'Total').length).toBe(6)

    // Subtotal values: East subtotal row (per-column sums of 1+2 ... and 8+16+32)
    expect(hasTextAt(texts, '9', 162, 83)).toBe(true)    // T[East] x Q1 = 1+8
    expect(hasTextAt(texts, '27', 282, 83)).toBe(true)   // T[East] x T[H1] = 1+2+8+16
    expect(hasTextAt(texts, '36', 402, 83)).toBe(true)   // T[East] x T[H2] = 4+32
    expect(hasTextAt(texts, '63', 462, 83)).toBe(true)   // T[East] x grand total

    // Subtotal column value: NY row x T[H1] = 1+2
    expect(hasTextAt(texts, '3', 282, 43)).toBe(true)
    // West subtotal row equals the LA row since LA is its only member
    expect(hasTextAt(texts, '448', 462, 123)).toBe(true) // T[West] x grand total

    // Grand total row: per-column totals and the overall total
    expect(hasTextAt(texts, '73', 162, 143)).toBe(true)   // Q1 column total
    expect(hasTextAt(texts, '219', 282, 143)).toBe(true)  // T[H1] column total
    expect(hasTextAt(texts, '511', 462, 143)).toBe(true)  // Grand total
  })

  // Verifies that multiple measures stack vertically per data cell and each measure's format applies individually.
  it('複数メジャーの縦積み表示と format の個別適用', () => {
    // Multiple measures stack vertically inside data cells, matching common report defaults.
    // Each measure occupies one cellHeight slot.
    const rows = [
      { region: 'East', product: 'Widget', amount: 1000 },
      { region: 'East', product: 'Widget', amount: 2000 },
      { region: 'East', product: 'Gadget', amount: 500 },
      { region: 'West', product: 'Widget', amount: 3000 },
    ]
    const doc = createReport(makeTemplate(400, 300, {
      type: 'crosstab',
      x: 0, y: 0, width: 380, height: 280,
      rowGroups: [{ field: 'region' }],
      columnGroups: [{ field: 'product' }],
      measures: [
        { field: 'amount', calculation: 'sum', format: '#,##0' },
        { field: 'amount', calculation: 'count' },
      ],
    }), { rows })

    const texts = findTexts(doc.pages[0]!)

    // Row height = cellHeight(20) x 2 measures = 40
    // East row y=20: sum slot y=23, count slot y=43
    expect(hasTextAt(texts, '3,000', 82, 23)).toBe(true)  // East x Widget: sum (thousands separator format applied)
    expect(hasTextAt(texts, '2', 82, 43)).toBe(true)      // East x Widget: count (no format)
    expect(hasTextAt(texts, '500', 142, 23)).toBe(true)   // East x Gadget: sum
    expect(hasTextAt(texts, '1', 142, 43)).toBe(true)     // East x Gadget: count
    // West row y=60
    expect(hasTextAt(texts, '3,000', 82, 63)).toBe(true)  // West x Widget: sum
    expect(hasTextAt(texts, '1', 82, 83)).toBe(true)      // West x Widget: count
    // Cells with no data show 0 for every measure
    expect(hasTextAt(texts, '0', 142, 63)).toBe(true)     // West x Gadget: sum
    expect(hasTextAt(texts, '0', 142, 83)).toBe(true)     // West x Gadget: count
  })

  // Verifies that headerFormat formats row/column group header values while data values stay raw.
  it('headerFormat がグループヘッダー値に適用される', () => {
    const rows = [
      { code: 1, month: 1000, amount: 10 },
      { code: 2, month: 2000, amount: 20 },
    ]
    const doc = createReport(makeTemplate(400, 300, {
      type: 'crosstab',
      x: 0, y: 0, width: 380, height: 280,
      rowGroups: [{ field: 'code', headerFormat: '.00' }],
      columnGroups: [{ field: 'month', headerFormat: '#,##0' }],
      measures: [{ field: 'amount', calculation: 'sum' }],
    }), { rows })

    const texts = findTexts(doc.pages[0]!).map(t => t.text)

    // Row headers: ".00" formats to 2 decimal places
    expect(texts).toContain('1.00')
    expect(texts).toContain('2.00')
    // Column headers: "#,##0" formats with thousands separators
    expect(texts).toContain('1,000')
    expect(texts).toContain('2,000')
    // Unformatted raw header values must not appear (data values 10/20 do appear)
    expect(texts).not.toContain('1000')
    expect(texts).not.toContain('2000')
  })

  // Verifies page splitting with multi-level groups and subtotals: rows never straddle page boundaries.
  it('多段グループ + 小計の改ページ分割（小計行は境界をまたがない）', () => {
    // 8 outer groups x 2 rows + 8 subtotal rows + 1 grand total row = 25 logical rows x 20pt, far above 200pt
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 8; i++) {
      rows.push({ grp: `G${i}`, item: `I${i}a`, col: 'C1', amount: 3 * i + 1 })
      rows.push({ grp: `G${i}`, item: `I${i}b`, col: 'C1', amount: 3 * i + 2 })
    }
    const pageHeight = 200
    const doc = createReport(makeTemplate(300, pageHeight, {
      type: 'crosstab',
      x: 0, y: 0, width: 300, height: pageHeight,
      rowGroups: [{ field: 'grp' }, { field: 'item' }],
      columnGroups: [{ field: 'col' }],
      measures: [{ field: 'amount', calculation: 'sum' }],
      showSubtotals: true,
      showGrandTotal: true,
      border: { color: '#000000', width: 0.5 },
    }), { rows })

    expect(doc.pages.length).toBeGreaterThan(1)

    const allTexts: string[] = []
    for (const page of doc.pages) {
      const pageTexts = findTexts(page).map(t => t.text)
      // Column headers are re-rendered on every page
      expect(pageTexts).toContain('C1')
      for (const t of pageTexts) allTexts.push(t)
    }

    // Every data row is rendered exactly once, with no loss or duplication
    for (let i = 0; i < 8; i++) {
      expect(allTexts.filter(t => t === `I${i}a`).length, `I${i}a`).toBe(1)
      expect(allTexts.filter(t => t === `I${i}b`).length, `I${i}b`).toBe(1)
      // Each group's subtotal value (6i+3, never colliding with data values 3i+1/3i+2) appears
      // once in the C1 column and once in the grand total column = 2 times (subtotal rows are not split across pages)
      expect(allTexts.filter(t => t === String(6 * i + 3)).length, `subtotal G${i}`).toBe(2)
    }

    // The grand total (sum of (6i+3) = 192) appears only on the last page
    const lastTexts = findTexts(doc.pages[doc.pages.length - 1]!).map(t => t.text)
    expect(lastTexts).toContain('192')
    for (let p = 0; p < doc.pages.length - 1; p++) {
      expect(findTexts(doc.pages[p]!).map(t => t.text)).not.toContain('192')
    }

    // Every chunk (logical rows including subtotal rows) fits within the page height, so no row straddles a page boundary
    for (const page of doc.pages) {
      function findChunks(nodes: RenderNode[], offsetY: number): { top: number, bottom: number }[] {
        const found: { top: number, bottom: number }[] = []
        for (const n of nodes) {
          if (n.type === 'group') {
            if (n.clip) found.push({ top: offsetY + n.y, bottom: offsetY + n.y + n.height })
            else found.push(...findChunks(n.children, offsetY + n.y))
          }
        }
        return found
      }
      for (const chunk of findChunks(page.children, 0)) {
        expect(chunk.bottom).toBeLessThanOrEqual(pageHeight)
      }
    }
  })

  // Regression: single-level output with one group and one measure keeps the original coordinates and size.
  it('回帰: 1グループ1メジャーの単段出力は従来と同一座標', () => {
    const rows = [
      { region: 'East', product: 'Widget', amount: 100 },
      { region: 'East', product: 'Gadget', amount: 200 },
      { region: 'West', product: 'Widget', amount: 150 },
    ]
    const doc = createReport(makeTemplate(400, 300, {
      type: 'crosstab',
      x: 0, y: 0, width: 380, height: 280,
      rowGroups: [{ field: 'region' }],
      columnGroups: [{ field: 'product' }],
      measures: [{ field: 'amount', calculation: 'sum' }],
    }), { rows })

    const texts = findTexts(doc.pages[0]!)

    // Legacy layout: rowHeaderWidth=80, colHeaderHeight=20, cellWidth=60, cellHeight=20
    expect(hasTextAt(texts, 'Widget', 82, 3)).toBe(true)
    expect(hasTextAt(texts, 'Gadget', 142, 3)).toBe(true)
    expect(hasTextAt(texts, 'East', 2, 23)).toBe(true)
    expect(hasTextAt(texts, 'West', 2, 43)).toBe(true)
    expect(hasTextAt(texts, '100', 82, 23)).toBe(true)
    expect(hasTextAt(texts, '200', 142, 23)).toBe(true)
    expect(hasTextAt(texts, '150', 82, 43)).toBe(true)
    // Nonexistent combinations show 0
    expect(hasTextAt(texts, '0', 142, 43)).toBe(true)

    // The overall crosstab size is also unchanged
    function findChunk(nodes: RenderNode[]): { width: number, height: number } | undefined {
      for (const n of nodes) {
        if (n.type === 'group') {
          if (n.clip) return { width: n.width, height: n.height }
          const inner = findChunk(n.children)
          if (inner) return inner
        }
      }
      return undefined
    }
    const chunk = findChunk(doc.pages[0]!.children)!
    expect(chunk.width).toBe(80 + 2 * 60)   // 200
    expect(chunk.height).toBe(20 + 2 * 20)  // 60
  })

  // Verifies that multi-level groups, subtotals, and multiple measures also render with real font measurement.
  it('フォント計測あり（measurer）でも多段・小計・複数メジャーが描画される', () => {
    const fontBuf = readFileSync('tests/fixtures/fonts/Roboto-Regular.ttf')
    const font = Font.load(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength) as ArrayBuffer)
    const fontMap: FontMap = new Map()
    fontMap.set('default', new TextMeasurer(font))

    const doc = createReport(makeTemplate(700, 400, {
      type: 'crosstab',
      x: 0, y: 0, width: 680, height: 380,
      rowGroups: [{ field: 'region' }, { field: 'city' }],
      columnGroups: [{ field: 'half' }, { field: 'quarter' }],
      measures: [
        { field: 'amount', calculation: 'sum' },
        { field: 'amount', calculation: 'count' },
      ],
      showSubtotals: true,
      showGrandTotal: true,
      border: { color: '#000000', width: 0.5 },
    }), { rows: multiLevelData }, fontMap)

    const texts = findTexts(doc.pages[0]!).map(t => t.text)
    expect(texts).toContain('East')
    expect(texts).toContain('NY')
    expect(texts).toContain('H1')
    expect(texts).toContain('Q3')
    expect(texts).toContain('Total')
    // sum: grand total 511, count: total row count 9
    expect(texts).toContain('511')
    expect(texts).toContain('9')
  })
})
