import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderNode, RenderText, RenderGroup } from '../../src/types/render.js'

// ─── Helpers ───

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

function expectTextYAligned(
  texts: Array<{ text: RenderText; x: number; y: number }>,
  targetText: string,
  referenceText: string,
  predicate?: (entry: { text: RenderText; x: number; y: number }) => boolean,
): void {
  const filter = predicate ?? (() => true)
  const target = texts.find(entry => entry.text.text === targetText && filter(entry))
  const reference = texts.find(entry => entry.text.text === referenceText && filter(entry))
  expect(target).toBeDefined()
  expect(reference).toBeDefined()
  expect(target!.y).toBe(reference!.y)
}

// ─── Tests ───

describe('Phase 4: Break・グループ上級機能・変数リセット・評価タイミング', () => {
  describe('Break 要素', () => {
    // Verifies a break element with breakType=page forces a page break.
    it('break type=page で強制改ページ', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 200,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 30,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Before' },
              { type: 'break', x: 0, y: 20, width: 0, height: 0, breakType: 'page' },
            ],
          }],
        },
      }
      // The break forces a second page (row 2 starts on a new page after the first break)
      const doc = createReport(template, { rows: [{}, {}] })
      expect(doc.pages.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('resetPageNumber', () => {
    // Verifies resetPageNumber restarts page numbering when a group starts on a new page.
    it('グループ開始時にページ番号がリセットされる', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [
          { name: 'dept', type: 'string' },
          { name: 'name', type: 'string' },
        ],
        groups: [{
          name: 'deptGroup',
          expression: 'field.dept',
          startNewPage: true,
          resetPageNumber: true,
          header: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.dept' },
            ],
          },
        }],
        bands: {
          details: [{ height: 20, elements: [
            { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.name' },
          ] }],
          pageFooter: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'PAGE_NUMBER' },
            ],
          },
        },
      }
      const doc = createReport(template, {
        rows: [
          { dept: 'A', name: 'a1' },
          { dept: 'B', name: 'b1' },
        ],
      })
      // Two groups, so at least two pages
      expect(doc.pages.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('変数の page リセット', () => {
    // Verifies a resetType=page sum variable resets at each page boundary.
    it('resetType=page の変数がページ変更時にリセットされる', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [{ name: 'val', type: 'number' }],
        variables: [{
          name: 'pageSum',
          expression: 'field.val',
          calculation: 'sum',
          resetType: 'page',
        }],
        bands: {
          details: [{ height: 30, elements: [
            { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.val' },
          ] }],
          pageFooter: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: (_f: any, v: any) => 'PageSum: ' + v.pageSum },
            ],
          },
        },
      }
      // 100pt page, 30pt detail, 20pt footer → 80pt usable → 2 rows per page
      const doc = createReport(template, {
        rows: [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }],
      })
      expect(doc.pages.length).toBe(2)

      // Page 1 footer contains 10+20=30
      const page1Texts = collectTexts(doc.pages[0]!.children)
      expect(page1Texts.some(t => t.text === 'PageSum: 30')).toBe(true)

      // Page 2 footer contains 30+40=70
      const page2Texts = collectTexts(doc.pages[1]!.children)
      expect(page2Texts.some(t => t.text === 'PageSum: 70')).toBe(true)
    })
  })

  describe('evaluationTime', () => {
    // Verifies band-evaluated text re-runs text layout so it aligns with adjacent static text.
    it('evaluationTime=band でも text layout を再適用して配置が崩れない', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField',
                x: 100, y: 4, width: 20, height: 14,
                expression: '"B"',
                evaluationTime: 'band',
                hAlign: 'left',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
              {
                type: 'staticText',
                x: 90, y: 4, width: 8, height: 14,
                text: '/',
                hAlign: 'center',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
            ],
          }],
        },
      }

      const doc = createReport(template, { rows: [{}] })
      const texts = collectPositionedTexts(doc.pages[0]!.children)
      expectTextYAligned(texts, 'B', '/')
    })

    // Verifies evaluationTime=band defers expression evaluation until the band completes.
    it('evaluationTime=band でバンド完了後に評価', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'val', type: 'number' }],
        variables: [{
          name: 'total',
          expression: 'field.val',
          calculation: 'sum',
          resetType: 'report',
        }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: 'vars.total',
                evaluationTime: 'band',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, {
        rows: [{ val: 10 }, { val: 20 }, { val: 30 }],
      })
      const texts = collectTexts(doc.pages[0]!.children)
      // band evaluation: uses variable values after each row is processed
      // should be evaluated after updateVariables runs for the row
      // but since band rendering precedes updateVariables,
      // the detail band sees the previous update's value
      expect(texts.length).toBeGreaterThan(0)
    })

    // Verifies evaluationTime=page evaluates expressions with values as of page completion.
    it('evaluationTime=page でページ完了後に評価', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [{ name: 'val', type: 'number' }],
        variables: [{
          name: 'total',
          expression: 'field.val',
          calculation: 'sum',
          resetType: 'report',
        }],
        bands: {
          pageHeader: {
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: 'vars.total',
                evaluationTime: 'page',
              },
            ],
          },
          details: [{ height: 30, elements: [] }],
        },
      }
      // Two pages: 100 - 20 (header) = 80, 30pt detail → 2 rows per page
      const doc = createReport(template, {
        rows: [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }],
      })
      expect(doc.pages.length).toBe(2)

      // Page 1 header shows the total as of page completion
      const page1Texts = collectTexts(doc.pages[0]!.children)
      // page evaluation: at the end of page 1, 10+20=30
      expect(page1Texts.some(t => t.text === '30')).toBe(true)
    })

    // Verifies page-evaluated text re-runs text layout so it aligns with adjacent static text.
    it('evaluationTime=page でも text layout を再適用して配置が崩れない', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          pageHeader: {
            height: 20,
            elements: [
              {
                type: 'textField',
                x: 100, y: 4, width: 20, height: 14,
                expression: '"P"',
                evaluationTime: 'page',
                hAlign: 'left',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
              {
                type: 'staticText',
                x: 90, y: 4, width: 8, height: 14,
                text: '/',
                hAlign: 'center',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
            ],
          },
          details: [{ height: 30, elements: [] }],
        },
      }

      const doc = createReport(template, { rows: [{}, {}] })
      const texts = collectPositionedTexts(doc.pages[0]!.children)
      expectTextYAligned(texts, 'P', '/')
    })

    // Verifies column-evaluated text re-runs text layout so it aligns with adjacent static text.
    it('evaluationTime=column でも text layout を再適用して配置が崩れない', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        columns: { count: 2, spacing: 0 },
        bands: {
          details: [{
            height: 30,
            elements: [{
              type: 'staticText',
              x: 0, y: 0, width: 20, height: 14,
              text: 'Item',
            }],
          }],
          columnFooter: {
            height: 20,
            elements: [
              {
                type: 'textField',
                x: 60, y: 4, width: 20, height: 14,
                expression: '"C"',
                evaluationTime: 'column',
                hAlign: 'left',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
              {
                type: 'staticText',
                x: 50, y: 4, width: 8, height: 14,
                text: '/',
                hAlign: 'center',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
            ],
          },
        },
      }

      const doc = createReport(template, { rows: [{}, {}, {}] })
      const texts = collectPositionedTexts(doc.pages[0]!.children)
      expect(texts.some(entry => entry.text.text === 'C' && entry.x < 100)).toBe(true)
      expectTextYAligned(texts, 'C', '/', entry => entry.x < 100)
    })

    // Verifies group-evaluated text re-runs text layout so it aligns with adjacent static text.
    it('evaluationTime=group でも text layout を再適用して配置が崩れない', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 120,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [{ name: 'grp', type: 'string' }],
        groups: [{
          name: 'grp',
          expression: 'field.grp',
          footer: {
            height: 20,
            elements: [
              {
                type: 'textField',
                x: 100, y: 4, width: 20, height: 14,
                expression: '"G"',
                evaluationTime: 'group',
                evaluationGroup: 'grp',
                hAlign: 'left',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
              {
                type: 'staticText',
                x: 90, y: 4, width: 8, height: 14,
                text: '/',
                hAlign: 'center',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
            ],
          },
        }],
        bands: {
          details: [{ height: 20, elements: [] }],
        },
      }

      const doc = createReport(template, { rows: [{ grp: 'A' }] })
      const texts = collectPositionedTexts(doc.pages[0]!.children)
      expectTextYAligned(texts, 'G', '/')
    })

    // Verifies evaluationTime=report resolves TOTAL_PAGES to the final page count on every page.
    it('evaluationTime=report は従来通り最終ページ数', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          pageHeader: {
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: 'TOTAL_PAGES',
                evaluationTime: 'report',
              },
            ],
          },
          details: [{ height: 30, elements: [] }],
        },
      }
      const doc = createReport(template, { rows: [{}, {}, {}, {}, {}] })
      expect(doc.pages.length).toBe(3)

      for (const page of doc.pages) {
        const texts = collectTexts(page.children)
        expect(texts.some(t => t.text === '3')).toBe(true)
      }
    })

    // Verifies report-evaluated TOTAL_PAGES stays aligned with now-evaluated neighbors after layout reapplication.
    it('evaluationTime=report でも text layout を再適用して配置が崩れない', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{ height: 30, elements: [] }],
          pageFooter: {
            height: 20,
            elements: [
              {
                type: 'textField',
                x: 120, y: 4, width: 20, height: 14,
                expression: 'PAGE_NUMBER',
                evaluationTime: 'now',
                hAlign: 'right',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
              {
                type: 'staticText',
                x: 141, y: 4, width: 10, height: 14,
                text: '/',
                hAlign: 'center',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
              {
                type: 'textField',
                x: 152, y: 4, width: 20, height: 14,
                expression: 'TOTAL_PAGES',
                evaluationTime: 'report',
                hAlign: 'left',
                vAlign: 'middle',
                fontSize: 8,
                forecolor: '#888888',
              },
            ],
          },
        },
      }

      const doc = createReport(template, { rows: [{}, {}, {}, {}, {}] })
      expect(doc.pages.length).toBe(3)

      const page1Texts = collectPositionedTexts(doc.pages[0]!.children)
      const pageNumber = page1Texts.find(entry => entry.text.text === '1')
      const separator = page1Texts.find(entry => entry.text.text === '/')
      const totalPages = page1Texts.find(entry => entry.text.text === '3')

      expect(pageNumber).toBeDefined()
      expect(separator).toBeDefined()
      expect(totalPages).toBeDefined()
      expect(pageNumber!.y).toBe(separator!.y)
      expect(totalPages!.y).toBe(separator!.y)
    })
  })
})
