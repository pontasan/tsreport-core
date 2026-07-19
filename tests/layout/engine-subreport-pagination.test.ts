import { describe, it, expect } from 'vitest'
import { createReport as createReportCore } from '../../src/layout/engine.js'
import type { CreateReportOptions, SubreportTemplateResolver } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderNode, RenderText } from '../../src/types/render.js'



type LegacyDataSource = DataSource & {
  subreportTemplates?: Record<string, ReportTemplate>
}

function createReport(
  template: ReportTemplate,
  dataSource: LegacyDataSource,
  options?: CreateReportOptions,
) {
  const subreportTemplates = dataSource.subreportTemplates ?? {}
  const resolveSubreportTemplate: SubreportTemplateResolver = (ref) => {
    const subTemplate = subreportTemplates[ref]
    if (!subTemplate) return null
    return { template: subTemplate }
  }
  const mergedOptions: CreateReportOptions = {
    ...options,
    resolveSubreportTemplate: options?.resolveSubreportTemplate ?? resolveSubreportTemplate,
  }
  return createReportCore(template, dataSource, mergedOptions)
}

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function collectPositionedTexts(
  nodes: RenderNode[],
  offsetX = 0,
  offsetY = 0,
): Array<{ text: RenderText; x: number; y: number }> {
  const texts: Array<{ text: RenderText; x: number; y: number }> = []
  for (const node of nodes) {
    if (node.type === 'text') {
      texts.push({ text: node, x: offsetX + node.x, y: offsetY + node.y })
      continue
    }
    if (node.type === 'group') {
      texts.push(...collectPositionedTexts(node.children, offsetX + node.x, offsetY + node.y))
    }
  }
  return texts
}

function pageTextValues(doc: { pages: Array<{ children: RenderNode[] }> }, pageIndex: number): string[] {
  return collectTexts(doc.pages[pageIndex]!.children).map(t => t.text)
}



describe('サブレポート × 改ページ × ページ番号状態', () => {
  // While a subreport flows across 3+ pages, the parent pageFooter is rendered on each
  // page break with evaluationTime=now, so PAGE_NUMBER must advance 1, 2, 3.
  it('サブレポートが複数ページに流れる間、親 pageFooter の PAGE_NUMBER(now) が 1,2,3 と進む', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'Row',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 30,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
        pageFooter: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`PN:${PAGE_NUMBER}`',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      // 10 rows × 20pt = 200pt of subreport content; 80pt available per page → 3 pages
      rows: [{ id: 1, items: Array.from({ length: 10 }, (_, i) => ({ n: i })) }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(3)

    for (let p = 0; p < doc.pages.length; p++) {
      const texts = pageTextValues(doc, p)
      expect(texts.filter(t => t === `PN:${p + 1}`)).toHaveLength(1)
      expect(texts.some(t => t === 'Row')).toBe(true)
    }
  })

  // Even when the total page count is driven purely by subreport overflow,
  // TOTAL_PAGES with evaluationTime=report must resolve to the final count on every page.
  it('親の TOTAL_PAGES(evaluationTime=report) がサブレポート駆動の総ページ数でも全ページで正しい', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'Row',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 30,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
        pageFooter: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`TOTAL:${TOTAL_PAGES}`',
            evaluationTime: 'report',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      // 12 rows × 20pt = 240pt; 80pt per page → 3 pages, entirely subreport-driven
      rows: [{ id: 1, items: Array.from({ length: 12 }, (_, i) => ({ n: i })) }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(3)

    for (let p = 0; p < doc.pages.length; p++) {
      const texts = pageTextValues(doc, p)
      expect(texts.filter(t => t === 'TOTAL:3')).toHaveLength(1)
    }
  })

  // On the continuation page the subreport content must restart exactly below
  // "top margin + parent pageHeader height" — verified via absolute coordinates.
  it('継続ページでサブレポート内容が上マージン＋親pageHeader高さの直下から再開する', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 30,
            expression: '`S${field.n}`',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 150, margins: { top: 20, bottom: 10, left: 10, right: 10 } },
      bands: {
        pageHeader: {
          height: 25,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 25,
            text: 'PH',
          }],
        },
        details: [{
          height: 30,
          elements: [{
            type: 'subreport',
            x: 5, y: 0,
            width: 175, height: 30,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      // Page content: y=45 (top 20 + pageHeader 25) .. 140 → 3 rows of 30pt per page.
      // 5 rows → page1: S1..S3, page2: S4..S5.
      rows: [{ id: 1, items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }] }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(2)

    // Page 1: first subreport row starts right below the pageHeader (y = 20 + 25 = 45)
    const page1 = collectPositionedTexts(doc.pages[0]!.children)
    const s1 = page1.find(e => e.text.text === 'S1')!
    expect(s1).toBeDefined()
    expect(s1.y).toBe(45)
    expect(s1.x).toBe(15) // marginLeft 10 + subreport element x 5

    // Page 2: continuation row S4 restarts at exactly the same absolute position
    const page2 = collectPositionedTexts(doc.pages[1]!.children)
    const s4 = page2.find(e => e.text.text === 'S4')!
    expect(s4).toBeDefined()
    expect(s4.y).toBe(45)
    expect(s4.x).toBe(15)

    // Rows within page 2 keep the 30pt pitch
    const s5 = page2.find(e => e.text.text === 'S5')!
    expect(s5.y).toBe(75)
  })

  // Nested (2-level) subreports crossing multiple pages: the composed X offset
  // (parent element x + outer subreport element x) must hold on every page.
  it('ネストしたサブレポートが複数ページを跨いでも X/Y 合成オフセットが全ページで維持される', () => {
    const innerSub: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 25,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 25,
            expression: '`I${field.v}`',
          }],
        }],
      },
    }

    const outerSub: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 25,
          elements: [{
            type: 'subreport',
            x: 30, y: 0,
            width: 150, height: 25,
            templateExpression: "'inner'",
            dataSourceExpression: 'field.innerItems',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 25,
          elements: [{
            type: 'subreport',
            x: 10, y: 0,
            width: 190, height: 25,
            templateExpression: "'outer'",
            dataSourceExpression: 'field.outerItems',
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      // 8 inner rows × 25pt = 200pt; page height 100pt → 2 pages
      rows: [{
        id: 1,
        outerItems: [{
          innerItems: Array.from({ length: 8 }, (_, i) => ({ v: i + 1 })),
        }],
      }],
      subreportTemplates: { outer: outerSub, inner: innerSub },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(2)

    // Page 1: I1..I4 at x = 10 + 30 = 40, y = 0, 25, 50, 75
    const page1 = collectPositionedTexts(doc.pages[0]!.children)
    for (let i = 1; i <= 4; i++) {
      const entry = page1.find(e => e.text.text === `I${i}`)!
      expect(entry).toBeDefined()
      expect(entry.x).toBe(40)
      expect(entry.y).toBe((i - 1) * 25)
    }

    // Page 2: continuation rows I5..I8 keep the same composed X offset, restarting at y=0
    const page2 = collectPositionedTexts(doc.pages[1]!.children)
    for (let i = 5; i <= 8; i++) {
      const entry = page2.find(e => e.text.text === `I${i}`)!
      expect(entry).toBeDefined()
      expect(entry.x).toBe(40)
      expect(entry.y).toBe((i - 5) * 25)
    }
  })

  // Group header contains a subreport and the group has startNewPage: each group's
  // subreport starts on a fresh page, and PAGE_NUMBER keeps advancing across groups.
  it('グループヘッダー内サブレポート × startNewPage: 各グループが新ページで始まり PAGE_NUMBER が連続する', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`S:${field.label}`',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      groups: [{
        name: 'dept',
        expression: 'field.dept',
        startNewPage: true,
        header: {
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        },
      }],
      bands: {
        details: [{
          height: 10,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 10,
            text: 'ParentDetail',
          }],
        }],
        pageFooter: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`PN:${PAGE_NUMBER}`',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      // Each group's subreport: 5 rows × 20pt = 100pt; 80pt per page → each group spans 2 pages
      rows: [
        { dept: 'A', items: Array.from({ length: 5 }, (_, i) => ({ label: `a${i + 1}` })) },
        { dept: 'B', items: Array.from({ length: 5 }, (_, i) => ({ label: `b${i + 1}` })) },
      ],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(4)

    // Group A occupies pages 1-2, group B (startNewPage) pages 3-4
    expect(pageTextValues(doc, 0).filter(t => t.startsWith('S:a'))).toHaveLength(4)
    expect(pageTextValues(doc, 1).filter(t => t.startsWith('S:a'))).toHaveLength(1)
    expect(pageTextValues(doc, 1).some(t => t.startsWith('S:b'))).toBe(false)
    expect(pageTextValues(doc, 2).filter(t => t.startsWith('S:b'))).toHaveLength(4)
    expect(pageTextValues(doc, 3).filter(t => t.startsWith('S:b'))).toHaveLength(1)

    // PAGE_NUMBER runs continuously 1..4 (no reset)
    for (let p = 0; p < 4; p++) {
      expect(pageTextValues(doc, p).filter(t => t === `PN:${p + 1}`)).toHaveLength(1)
    }
  })

  it('サブレポート内の PAGE_NUMBER(now) は親レポートの現在ページ番号に追随する', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`SPN:${PAGE_NUMBER}`',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
        pageFooter: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`PN:${PAGE_NUMBER}`',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      // 10 rows × 20pt = 200pt; 80pt per page → 3 pages
      rows: [{ id: 1, items: Array.from({ length: 10 }, (_, i) => ({ n: i })) }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(3)

    for (let p = 0; p < doc.pages.length; p++) {
      const texts = pageTextValues(doc, p)
      const subPageNumbers = texts.filter(t => t.startsWith('SPN:'))
      expect(subPageNumbers.length).toBeGreaterThan(0)
      for (const t of subPageNumbers) {
        expect(t).toBe(`SPN:${p + 1}`)
      }
      expect(texts.filter(t => t === `PN:${p + 1}`)).toHaveLength(1)
    }
  })

  // TOTAL_PAGES does not depend on where a subreport band lands, so it must resolve
  // to the master's FINAL page count on every page — not the running count at the
  // moment the band was placed. Guards the masterReport deferral (resolved at report end).
  it('サブレポート内の TOTAL_PAGES はマスターの最終総ページ数を全ページで表示する', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`STP:${TOTAL_PAGES}`',
          }],
        }],
      },
    }
    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 200, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
      },
    }
    const dataSource: LegacyDataSource = {
      // 10 rows × 20pt = 200pt; 80pt per page → 2 pages, entirely subreport-driven
      rows: [{ id: 1, items: Array.from({ length: 10 }, (_, i) => ({ n: i })) }],
      subreportTemplates: { sub1: subTemplate },
    }
    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(2)
    for (let p = 0; p < doc.pages.length; p++) {
      const stp = pageTextValues(doc, p).filter(t => t.startsWith('STP:'))
      expect(stp.length).toBeGreaterThan(0)
      for (const t of stp) expect(t).toBe('STP:2')
    }
  })

  // A single subreport field mixing PAGE_NUMBER (placement-dependent) and TOTAL_PAGES
  // (report-final) must resolve both correctly: X is the master page it lands on,
  // Y is the master's final total. Verifies the unified masterNow→masterReport path.
  it('サブレポート内の "Page X of Y" が X=マスター現在ページ・Y=マスター最終総数になる', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 150, height: 20,
            expression: '`P${PAGE_NUMBER}/${TOTAL_PAGES}`',
          }],
        }],
      },
    }
    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 200, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
      },
    }
    const dataSource: LegacyDataSource = {
      // 10 rows → 2 pages. Page 1 rows show P1/2, page 2 rows show P2/2.
      rows: [{ id: 1, items: Array.from({ length: 10 }, (_, i) => ({ n: i })) }],
      subreportTemplates: { sub1: subTemplate },
    }
    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(2)
    for (const t of pageTextValues(doc, 0).filter(t => t.startsWith('P'))) expect(t).toBe('P1/2')
    for (const t of pageTextValues(doc, 1).filter(t => t.startsWith('P'))) expect(t).toBe('P2/2')
  })

  // Group with resetPageNumber + startNewPage while the group's subreport overflows.
  // A common report engine fills the closing page's footer
  // BEFORE resetting the page number, so each segment's closing page shows its real
  // in-segment number and the next segment restarts at 1: [PN:1, PN:2, PN:1, PN:2].
  it('サブレポート × resetPageNumber: 閉じページは実ページ番号、次セグメントは1から再開する（一般的な帳票動作）', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`S:${field.label}`',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      groups: [{
        name: 'dept',
        expression: 'field.dept',
        startNewPage: true,
        resetPageNumber: true,
        header: {
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        },
      }],
      bands: {
        details: [{
          height: 10,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 10,
            text: 'ParentDetail',
          }],
        }],
        pageFooter: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`PN:${PAGE_NUMBER}`',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      // Each group's subreport: 5 rows × 20pt = 100pt; 80pt per page → 2 pages per group
      rows: [
        { dept: 'A', items: Array.from({ length: 5 }, (_, i) => ({ label: `a${i + 1}` })) },
        { dept: 'B', items: Array.from({ length: 5 }, (_, i) => ({ label: `b${i + 1}` })) },
      ],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(4)

    // Segment A = [PN:1, PN:2], segment B = [PN:1, PN:2]: the closing page of each
    // segment keeps its real number and the next segment restarts at 1 (the reset is
    // applied after the closing page's footer is filled, matching common report behavior).
    const expected = ['PN:1', 'PN:2', 'PN:1', 'PN:2']
    for (let p = 0; p < 4; p++) {
      expect(pageTextValues(doc, p).filter(t => t === expected[p])).toHaveLength(1)
    }
  })

  // returnValues across page breaks: the subreport spans 3 pages, and its accumulated
  // sum must still be returned to the parent variable and printed in the parent summary.
  it('returnValues × ページ跨ぎ: 複数ページに渡るサブレポートの sum が親変数に反映される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{
        name: 'itemTotal',
        expression: 'field.amount',
        calculation: 'sum',
        resetType: 'report',
      }],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'field.amount',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{
        name: 'grandTotal',
        expression: () => 0,
        calculation: 'sum',
        resetType: 'report',
      }],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
            returnValues: [{
              name: 'grandTotal',
              subreportVariable: 'itemTotal',
              calculation: 'sum',
            }],
          }],
        }],
        summary: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: '`GT:${vars.grandTotal}`',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      // 12 rows × 20pt = 240pt; page height 100pt → subreport spans 3 pages
      // amounts 1..12 → sum = 78
      rows: [{ id: 1, items: Array.from({ length: 12 }, (_, i) => ({ amount: i + 1 })) }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages.length).toBeGreaterThanOrEqual(3)

    // The summary on the last page prints the returned total
    const lastPageTexts = pageTextValues(doc, doc.pages.length - 1)
    expect(lastPageTexts.filter(t => t === 'GT:78')).toHaveLength(1)

    // The returned total appears only once in the whole document
    let count = 0
    for (let p = 0; p < doc.pages.length; p++) {
      count += pageTextValues(doc, p).filter(t => t === 'GT:78').length
    }
    expect(count).toBe(1)
  })
})
