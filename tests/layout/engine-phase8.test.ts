import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderGroup, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function collectGroups(nodes: RenderNode[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (const node of nodes) {
    if (node.type === 'group') {
      groups.push(node)
      groups.push(...collectGroups(node.children))
    }
  }
  return groups
}

/** Collects detail band groups (page-level groups that contain text). */
function getDetailGroups(nodes: RenderNode[]): RenderGroup[] {
  const result: RenderGroup[] = []
  for (const node of nodes) {
    if (node.type === 'group') {
      const texts = collectTexts(node.children)
      if (texts.length > 0) {
        result.push(node)
      }
    }
  }
  return result
}

// ─── Tests ───

// Multi-column layout: column flow, column headers/footers, breaks, and page transitions.
describe('Phase 8: 段組み（マルチカラム）', () => {
  // Verifies that omitting the columns setting keeps the legacy single-column layout.
  it('columns 未指定の場合は従来通り（1列）', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'Row',
          }],
        }],
      },
    }
    const doc = createReport(template, {
      rows: [{ id: 1 }, { id: 2 }],
    })
    expect(doc.pages).toHaveLength(1)
    const groups = getDetailGroups(doc.pages[0]!.children)
    // All groups start at x=0 (marginLeft=0)
    for (const g of groups) {
      expect(g.x).toBe(0)
    }
  })

  // Verifies that detail bands are laid out at the computed column width in a 2-column layout.
  it('2列レイアウト: Detail バンドが列幅で配置される', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Column width = (200 - 10) / 2 = 95
    const doc = createReport(template, {
      rows: [{ id: 1 }, { id: 2 }],
    })
    expect(doc.pages).toHaveLength(1)
    const details = getDetailGroups(doc.pages[0]!.children)
    expect(details.length).toBe(2)
    // Both rows stay in column 1 (no overflow yet)
    expect(details[0]!.x).toBe(0)
    expect(details[0]!.width).toBe(95)
    expect(details[1]!.x).toBe(0)
  })

  // Verifies that rows overflow into the second column when the first column is full.
  it('2列レイアウト: 列溢れで2列目に移動', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [{
          height: 40,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 40,
            text: 'Item',
          }],
        }],
      },
    }
    // Column width = (200 - 10) / 2 = 95
    // Page height 100, row height 40: 2 rows per column, then column 2
    const doc = createReport(template, {
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
    })
    expect(doc.pages).toHaveLength(1)
    const details = getDetailGroups(doc.pages[0]!.children)
    expect(details.length).toBe(3)

    // Column 1: x = 0
    expect(details[0]!.x).toBe(0)
    expect(details[1]!.x).toBe(0)
    // Column 2: x = 95 + 10 = 105
    expect(details[2]!.x).toBe(105)
  })

  // Verifies that a page break occurs once both columns are full.
  it('2列レイアウト: 両列溢れで改ページ', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [{
          height: 40,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 40,
            text: 'Item',
          }],
        }],
      },
    }
    // 2 rows per column x 2 columns = 4 rows/page, so 5 rows span 2 pages
    const doc = createReport(template, {
      rows: Array.from({ length: 5 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(2)

    // Page 1: 4 rows
    const page1Details = getDetailGroups(doc.pages[0]!.children)
    expect(page1Details.length).toBe(4)

    // Page 2: 1 row
    const page2Details = getDetailGroups(doc.pages[1]!.children)
    expect(page2Details.length).toBe(1)
  })

  // Verifies column width and x positions across a 3-column layout.
  it('3列レイアウト', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 60,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 3, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Column width = (300 - 2*10) / 3 ≈ 93.33
    // 3 rows per column x 3 columns = 9 rows/page
    const colWidth = (300 - 20) / 3
    const doc = createReport(template, {
      rows: Array.from({ length: 7 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(1)

    const details = getDetailGroups(doc.pages[0]!.children)
    expect(details.length).toBe(7)

    // Column 1: x = 0
    expect(details[0]!.x).toBeCloseTo(0, 1)
    expect(details[1]!.x).toBeCloseTo(0, 1)
    expect(details[2]!.x).toBeCloseTo(0, 1)
    // Column 2: x = colWidth + 10
    expect(details[3]!.x).toBeCloseTo(colWidth + 10, 1)
    // Column 3: x = 2 * (colWidth + 10)
    expect(details[6]!.x).toBeCloseTo(2 * (colWidth + 10), 1)
  })

  // Verifies that the column header band is rendered at the top of each column.
  it('Column Header が各列の先頭に描画される', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        columnHeader: {
          height: 15,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 15,
            text: 'Header',
          }],
        },
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 30,
            text: 'Item',
          }],
        }],
      },
    }
    // Usable column height = 100 - 15 (columnHeader) = 85
    // Two 30pt rows fit (60pt); the 3rd row (90pt) overflows to column 2
    const doc = createReport(template, {
      rows: Array.from({ length: 4 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(1)

    // The 'Header' text appears twice (columns 1 and 2)
    const allTexts = collectTexts(doc.pages[0]!.children)
    const headerTexts = allTexts.filter(t => t.text === 'Header')
    expect(headerTexts.length).toBe(2)
  })

  // Verifies that the column footer band is rendered at the bottom of each column.
  it('Column Footer が各列の末尾に描画される', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        columnFooter: {
          height: 15,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 15,
            text: 'Footer',
          }],
        },
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 30,
            text: 'Item',
          }],
        }],
      },
    }
    // Usable height = 100 - 15 (columnFooter) = 85
    // 3 rows (90pt) overflow to column 2, so column 1's footer is rendered
    const doc = createReport(template, {
      rows: Array.from({ length: 4 }, (_, i) => ({ id: i + 1 })),
    })

    // The 'Footer' text appears twice
    const allTexts = collectTexts(doc.pages[0]!.children)
    const footerTexts = allTexts.filter(t => t.text === 'Footer')
    expect(footerTexts.length).toBe(2)
  })

  // Verifies that a break element with breakType=column forces a move to the next column.
  it('break 要素で改列', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Force a column break with a break element
    const templateWithBreak = {
      ...template,
      bands: {
        details: [
          {
            height: 20,
            elements: [{
              type: 'staticText' as const,
              x: 0, y: 0, width: 80, height: 20,
              text: 'Before',
            }],
          },
          {
            height: 0,
            elements: [{
              type: 'break' as const,
              x: 0, y: 0, width: 0, height: 0,
              breakType: 'column' as const,
            }],
          },
          {
            height: 20,
            elements: [{
              type: 'staticText' as const,
              x: 0, y: 0, width: 80, height: 20,
              text: 'After',
            }],
          },
        ],
      },
    }
    const doc = createReport(templateWithBreak as ReportTemplate, { rows: [{}] })

    const details = getDetailGroups(doc.pages[0]!.children)
    // 'Before' is in column 1, 'After' in column 2
    const beforeGroup = details.find(g => collectTexts(g.children).some(t => t.text === 'Before'))
    const afterGroup = details.find(g => collectTexts(g.children).some(t => t.text === 'After'))
    expect(beforeGroup).toBeDefined()
    expect(afterGroup).toBeDefined()
    expect(beforeGroup!.x).toBe(0)
    expect(afterGroup!.x).toBe(105) // (200-10)/2 + 10 = 105
  })

  // Verifies that page header/footer bands span the full page width while details use column width.
  it('Page Header/Footer はページ全幅を使用', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        pageHeader: {
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'Page Header',
          }],
        },
        pageFooter: {
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'Page Footer',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const page = doc.pages[0]!

    // Page header group width = full page width (200)
    const allGroups = collectGroups(page.children)
    const headerGroup = allGroups.find(g =>
      collectTexts(g.children).some(t => t.text === 'Page Header')
    )
    expect(headerGroup).toBeDefined()
    expect(headerGroup!.width).toBe(200) // full page width

    // Detail group width = column width (95)
    const detailGroup = allGroups.find(g =>
      collectTexts(g.children).some(t => t.text === 'Item')
    )
    expect(detailGroup).toBeDefined()
    expect(detailGroup!.width).toBe(95) // column width
  })

  // Verifies that an explicit columns.width overrides the computed column width.
  it('カスタム列幅', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, width: 120, spacing: 20 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const details = getDetailGroups(doc.pages[0]!.children)
    expect(details[0]!.width).toBe(120)
  })

  // ─── Additional tests: boundary conditions ───

  // Boundary: page height equals row height, so each column holds exactly one row.
  it('1行ちょうどで列が埋まる — ページ高さ=行高さで即次列へ', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 20,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Column width = (200 - 10) / 2 = 95
    // One row per column: 2 rows fill 2 columns, the 3rd starts a new page
    const doc = createReport(template, {
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
    })
    expect(doc.pages).toHaveLength(2)
    const page1Details = getDetailGroups(doc.pages[0]!.children)
    expect(page1Details.length).toBe(2)
    expect(page1Details[0]!.x).toBe(0)
    expect(page1Details[1]!.x).toBe(105) // 95 + 10
  })

  // Extreme case: row height equals page height, giving one row per column.
  it('行高さ=ページ高さの場合 — 1列1行の極端ケース', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 40,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [{
          height: 40,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 40,
            text: 'Item',
          }],
        }],
      },
    }
    const doc = createReport(template, {
      rows: Array.from({ length: 4 }, (_, i) => ({ id: i + 1 })),
    })
    // 1 row per column x 2 columns = 2 rows/page, so 4 rows span 2 pages
    expect(doc.pages).toHaveLength(2)
  })

  // Verifies column width and x coordinates are accurate with 5 columns.
  it('大量列（5列） — 列幅・X座標の正確性', () => {
    const template: ReportTemplate = {
      page: {
        width: 500, height: 40,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 5, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 60, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Column width = (500 - 4*10) / 5 = 460/5 = 92
    const colWidth = (500 - 40) / 5
    const doc = createReport(template, {
      rows: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(1)
    const details = getDetailGroups(doc.pages[0]!.children)
    expect(details.length).toBe(10)
    // Verify each column's x: col0=0, col1=92+10, col2=2*(92+10), ...
    expect(details[0]!.x).toBeCloseTo(0, 1)
    expect(details[2]!.x).toBeCloseTo(colWidth + 10, 1)
    expect(details[4]!.x).toBeCloseTo(2 * (colWidth + 10), 1)
    expect(details[6]!.x).toBeCloseTo(3 * (colWidth + 10), 1)
    expect(details[8]!.x).toBeCloseTo(4 * (colWidth + 10), 1)
  })

  // Verifies that columns are adjacent when spacing=0.
  it('列間スペース0 — spacing=0で列が隣接', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 40,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 0 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Column width = 200 / 2 = 100
    const doc = createReport(template, {
      rows: Array.from({ length: 4 }, (_, i) => ({ id: i + 1 })),
    })
    const details = getDetailGroups(doc.pages[0]!.children)
    expect(details[0]!.x).toBe(0)
    expect(details[0]!.width).toBe(100)
    // Column 2's x equals the column width 100 (spacing=0)
    expect(details[2]!.x).toBe(100)
  })

  // ─── Additional tests: column/page transition accuracy ───

  // Verifies exact column-to-page transitions across 3 columns and 3 pages.
  it('3列×3ページの完全な遷移', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 40,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 3, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 60, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // 2 rows per column x 3 columns = 6 rows/page, so 18 rows span 3 pages
    const doc = createReport(template, {
      rows: Array.from({ length: 18 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(3)
    for (const page of doc.pages) {
      const details = getDetailGroups(page.children)
      expect(details.length).toBe(6)
    }
  })

  // Verifies column header and footer render together in every column.
  it('Column Header + Column Footer 同時使用', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        columnHeader: {
          height: 15,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 15,
            text: 'CH',
          }],
        },
        columnFooter: {
          height: 15,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 15,
            text: 'CF',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Usable height = 100 - 15 (CH) - 15 (CF) = 70
    // 20pt rows: 3 rows (60pt) fit, 4 rows (80pt) overflow to column 2
    // 2 columns x 3 rows = 6 rows/page, so 6 rows fit on 1 page
    const doc = createReport(template, {
      rows: Array.from({ length: 6 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(1)
    const allTexts = collectTexts(doc.pages[0]!.children)
    const chTexts = allTexts.filter(t => t.text === 'CH')
    const cfTexts = allTexts.filter(t => t.text === 'CF')
    expect(chTexts.length).toBe(2) // columns 1 and 2
    expect(cfTexts.length).toBe(2) // columns 1 and 2
  })

  // Verifies page headers/footers and column headers/footers coexist correctly.
  it('Column Header/Footer と Page Header/Footer の共存', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 150,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        pageHeader: {
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'PH',
          }],
        },
        pageFooter: {
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'PF',
          }],
        },
        columnHeader: {
          height: 15,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 15,
            text: 'CH',
          }],
        },
        columnFooter: {
          height: 15,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 15,
            text: 'CF',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Usable height = 150 - 20(PH) - 20(PF) - 15(CH) - 15(CF) = 80
    // Row height 20: 4 rows/column x 2 columns = 8 rows/page
    const doc = createReport(template, {
      rows: Array.from({ length: 5 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(1)
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.filter(t => t.text === 'PH').length).toBe(1)
    expect(allTexts.filter(t => t.text === 'PF').length).toBe(1)
    expect(allTexts.filter(t => t.text === 'CH').length).toBeGreaterThanOrEqual(1)
  })

  // ─── Additional tests: combination with groups ───

  // Verifies that group header bands are rendered at column width, not page width.
  it('グループヘッダーが列幅で描画される', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      groups: [{
        name: 'dept',
        expression: 'field.dept',
        header: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 80, height: 20,
            expression: 'field.dept',
          }],
        },
      }],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Row',
          }],
        }],
      },
    }
    const doc = createReport(template, {
      rows: [{ dept: 'A' }, { dept: 'A' }],
    })
    expect(doc.pages).toHaveLength(1)
    const allGroups = collectGroups(doc.pages[0]!.children)
    // The group header is rendered at the column width (95)
    const ghGroup = allGroups.find(g =>
      collectTexts(g.children).some(t => t.text === 'A')
    )
    expect(ghGroup).toBeDefined()
    expect(ghGroup!.width).toBe(95)
  })

  // Verifies that startNewColumn moves to a new column when the group value changes.
  it('グループ startNewColumn — グループ変更時に新列へ移動', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      groups: [{
        name: 'dept',
        expression: 'field.dept',
        startNewColumn: true,
        header: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 80, height: 20,
            expression: 'field.dept',
          }],
        },
      }],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Row',
          }],
        }],
      },
    }
    const doc = createReport(template, {
      rows: [{ dept: 'A' }, { dept: 'B' }],
    })
    expect(doc.pages).toHaveLength(1)
    const allGroups = collectGroups(doc.pages[0]!.children)
    // Group A is in column 1 (x=0), group B in column 2 (x=105)
    const groupA = allGroups.find(g =>
      collectTexts(g.children).some(t => t.text === 'A')
    )
    const groupB = allGroups.find(g =>
      collectTexts(g.children).some(t => t.text === 'B')
    )
    expect(groupA).toBeDefined()
    expect(groupB).toBeDefined()
    expect(groupA!.x).toBe(0)
    expect(groupB!.x).toBe(105)
  })

  // ─── Additional tests: variables and built-in variables ───

  // Verifies the built-in COLUMN_NUMBER variable increments per column.
  it('COLUMN_NUMBER が正しい — 各列でCOLUMN_NUMBERが1,2,3と増加', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 40,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 3, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 80, height: 20,
            expression: 'COLUMN_NUMBER',
          }],
        }],
      },
    }
    // 2 rows per column: rows 1-2 in col 1, rows 3-4 in col 2, rows 5-6 in col 3
    const doc = createReport(template, {
      rows: Array.from({ length: 6 }, (_, i) => ({ id: i + 1 })),
    })
    const texts = collectTexts(doc.pages[0]!.children)
    // Column 1 renders '1', column 2 '2', column 3 '3'
    expect(texts.filter(t => t.text === '1').length).toBe(2)
    expect(texts.filter(t => t.text === '2').length).toBe(2)
    expect(texts.filter(t => t.text === '3').length).toBe(2)
  })

  // Verifies that variables with resetType=column reset at each column break.
  it('変数の column リセット — resetType=column の変数が改列時にリセット', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 40,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      variables: [{
        name: 'colCount',
        expression: '1',
        calculation: 'sum',
        resetType: 'column',
      }],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 80, height: 20,
            expression: 'vars.colCount',
          }],
        }],
      },
    }
    // 2 rows per column x 2 columns
    const doc = createReport(template, {
      rows: Array.from({ length: 4 }, (_, i) => ({ id: i + 1 })),
    })
    const texts = collectTexts(doc.pages[0]!.children)
    // Variables are calculated before the detail band renders, so running
    // totals include the current row. The column reset re-applies the row
    // that moves into the new column, so column 2 restarts at 1.
    // Column 1: 1, 2; column 2 resets: 1, 2
    const values = texts.map(t => t.text)
    expect(values).toEqual(['1', '2', '1', '2'])
  })

  // Add:
  

  it('左右マージン付き段組み — 列幅が正しい', () => {
    const template: ReportTemplate = {
      page: {
        width: 240, height: 200,
        margins: { top: 0, bottom: 0, left: 20, right: 20 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // contentWidth = 240 - 20 - 20 = 200
    // Column width = (200 - 10) / 2 = 95
    const doc = createReport(template, {
      rows: Array.from({ length: 3 }, (_, i) => ({ id: i + 1 })),
    })
    const details = getDetailGroups(doc.pages[0]!.children)
    expect(details[0]!.width).toBe(95)
    // 1column marginLeft=20 from.
    
    expect(details[0]!.x).toBe(20)
  })

  it('上下マージン付き段組み — 使用可能高さがマージン分減る', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 10, bottom: 10, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    // Forpossibleheight = 100 - 10 - 10 = 80.
    // 20ptrow -> 4row/column × 2column = 8row/page.
    
    
    const doc = createReport(template, {
      rows: Array.from({ length: 9 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(2)
    const page1Details = getDetailGroups(doc.pages[0]!.children)
    expect(page1Details.length).toBe(8)
  })

  // Add: for.
  

  it('大量データの段組み（100行、3列）— ページ数の正確性', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 3, spacing: 10 },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 60, height: 20,
            text: 'Row',
          }],
        }],
      },
    }
    // Columnwidth = (300 - 20) / 3 ≈ 93.33.
    // 1column 10row(200/20) × 3column = 30row/page.
    // 100row -> ceil(100/30) = 4page (30+30+30+10)
    
    
    
    const doc = createReport(template, {
      rows: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })),
    })
    expect(doc.pages).toHaveLength(4)
    // The last page contains the remaining 10 detail rows.
    const lastPageDetails = getDetailGroups(doc.pages[3]!.children)
    expect(lastPageDetails.length).toBe(10)
  })

  it('段組みレポートの空データ — rows=[]でnoDataバンドが全幅表示', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        noData: {
          height: 40,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 40,
            text: 'データなし',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [] })
    expect(doc.pages).toHaveLength(1)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.some(t => t.text === 'データなし')).toBe(true)
    expect(texts.some(t => t.text === 'Item')).toBe(false)
  })

  it('break type=column が最終列の場合はページブレーク', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        details: [
          {
            height: 20,
            elements: [{
              type: 'staticText' as const,
              x: 0, y: 0, width: 80, height: 20,
              text: 'Before',
            }],
          },
          {
            height: 0,
            elements: [{
              type: 'break' as const,
              x: 0, y: 0, width: 0, height: 0,
              breakType: 'column' as const,
            }],
          },
          {
            height: 20,
            elements: [{
              type: 'staticText' as const,
              x: 0, y: 0, width: 80, height: 20,
              text: 'After',
            }],
          },
        ],
      },
    }
    // 1row: Before -> break(column) -> After(2column)
    // 2row: Before -> break(column) -> column with page -> After(page1column)
    
    
    const doc = createReport(template as ReportTemplate, {
      rows: [{ id: 1 }, { id: 2 }],
    })
    expect(doc.pages).toHaveLength(2)
  })

  it('Title/Summary バンドはページ全幅', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      columns: { count: 2, spacing: 10 },
      bands: {
        title: {
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 30,
            text: 'Title',
          }],
        },
        summary: {
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 30,
            text: 'Summary',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 80, height: 20,
            text: 'Item',
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const allGroups = collectGroups(doc.pages[0]!.children)
    const titleGroup = allGroups.find(g =>
      collectTexts(g.children).some(t => t.text === 'Title')
    )
    const summaryGroup = allGroups.find(g =>
      collectTexts(g.children).some(t => t.text === 'Summary')
    )
    expect(titleGroup).toBeDefined()
    expect(titleGroup!.width).toBe(200) // full page width
    expect(summaryGroup).toBeDefined()
    expect(summaryGroup!.width).toBe(200) // full page width
  })
})
