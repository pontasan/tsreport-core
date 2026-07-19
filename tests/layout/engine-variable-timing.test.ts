import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderText } from '../../src/types/render.js'

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function pageTextValues(doc: { pages: { children: RenderNode[] }[] }, page: number): string[] {
  return collectTexts(doc.pages[page]!.children).map(t => t.text)
}

// Variable calculation runs before the detail band renders, so running totals
// include the current row, and initial values seed/reseed the accumulators.
describe('変数の評価タイミングと初期値', () => {
  it('detail の累計が現在行を含む', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [
        { name: 'TOTAL', expression: 'field.v', calculation: 'sum', resetType: 'report' },
      ],
      bands: {
        details: [{
          height: 15,
          elements: [{ type: 'textField', x: 0, y: 0, width: 200, height: 15, expression: '`${vars.TOTAL}`' }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{ v: 10 }, { v: 20 }, { v: 5 }] })
    expect(pageTextValues(doc, 0)).toEqual(['10', '30', '35'])
  })

  it('initialValue が集計のシード値になり、グループリセットで再シードされる', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [
        { name: 'TOTAL', expression: 'field.v', calculation: 'sum', resetType: 'group', resetGroup: 'G', initialValue: '100' },
      ],
      groups: [{ name: 'G', expression: 'field.g' }],
      bands: {
        details: [{
          height: 15,
          elements: [{ type: 'textField', x: 0, y: 0, width: 200, height: 15, expression: '`${field.g}:${vars.TOTAL}`' }],
        }],
      },
    }
    const doc = createReport(template, { rows: [
      { g: 'A', v: 10 }, { g: 'A', v: 20 }, { g: 'B', v: 5 },
    ] })
    expect(pageTextValues(doc, 0)).toEqual(['A:110', 'A:130', 'B:105'])
  })

  it('initialValue が calculation=nothing の初期表示値になる', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [
        { name: 'LABEL', expression: 'field.missing', calculation: 'nothing', initialValue: '"start"' },
      ],
      bands: {
        title: {
          height: 15,
          elements: [{ type: 'textField', x: 0, y: 0, width: 200, height: 15, expression: '`${vars.LABEL}`' }],
        },
        details: [{ height: 10, elements: [] }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    // The title renders before any row increments the variable.
    expect(pageTextValues(doc, 0)).toContain('start')
  })

  it('行途中の改ページでフッターは印字済み行のみの合計、新ページは持ち越し行を含んで再開する', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{ name: 'pageSum', expression: 'field.val', calculation: 'sum', resetType: 'page' }],
      bands: {
        details: [{
          height: 30,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`V:${vars.pageSum}`' }],
        }],
        pageFooter: {
          height: 20,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`PageSum: ${vars.pageSum}`' }],
        },
      },
    }
    // 80pt usable → 2 rows per page; row 3 moves to page 2.
    const doc = createReport(template, { rows: [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }] })
    expect(doc.pages.length).toBe(2)
    // Page 1: details include the current row; the footer excludes the row
    // that moved to page 2.
    expect(pageTextValues(doc, 0)).toEqual(['V:10', 'V:30', 'PageSum: 30'])
    // Page 2 starts with the carried-over row's increment.
    expect(pageTextValues(doc, 1)).toEqual(['V:30', 'V:70', 'PageSum: 70'])
  })
})
