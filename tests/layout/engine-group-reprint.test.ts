import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

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

function pageTexts(doc: { pages: Array<{ children: RenderNode[] }> }, pageIndex: number) {
  return collectPositionedTexts(doc.pages[pageIndex]!.children)
}

function countTexts(entries: Array<{ text: RenderText }>, value: string): number {
  let count = 0
  for (const entry of entries) {
    if (entry.text.text === value) count++
  }
  return count
}

// ─── Tests ───

describe('GroupDef.reprintHeaderOnEachPage', () => {
  // page 100pt / margins 0 / groupHeader 20pt / detail 20pt -> 5 bands per page
  function makeTemplate(reprint: boolean, rows: Array<{ dept: string; name: string }>): ReportTemplate {
    return {
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
        reprintHeaderOnEachPage: reprint,
        header: {
          height: 20,
          elements: [
            {
              type: 'textField', x: 0, y: 0, width: 100, height: 20,
              expression: (f: any) => 'HDR:' + f.dept,
            },
          ],
        },
      }],
      bands: {
        details: [{
          height: 20,
          elements: [
            {
              type: 'textField', x: 0, y: 0, width: 100, height: 20,
              expression: (f: any) => 'ROW:' + f.name,
            },
          ],
        }],
      },
    }
  }

  function makeRows(dept: string, count: number): Array<{ dept: string; name: string }> {
    const rows: Array<{ dept: string; name: string }> = []
    for (let i = 1; i <= count; i++) rows.push({ dept, name: dept + i })
    return rows
  }

  // A single group spanning multiple pages: header reprint behavior at each page top.
  describe('ページ跨ぎ（単一グループが複数ページに続く）', () => {
    // Verifies that the group header is reprinted at the top of every continuation page when reprint is enabled.
    it('reprintHeaderOnEachPage=true: 2ページ目以降の先頭にヘッダーが再印字される', () => {
      // Page1: HDR + A1..A4, Page2: HDR + A5..A8, Page3: HDR + A9, A10
      const doc = createReport(makeTemplate(true, makeRows('A', 10)), { rows: makeRows('A', 10) })
      expect(doc.pages.length).toBe(3)

      for (let p = 0; p < doc.pages.length; p++) {
        const texts = pageTexts(doc, p)
        // Exactly one header on each page
        expect(countTexts(texts, 'HDR:A')).toBe(1)
        // The header is at the top of the page (y=0, above all detail rows)
        const header = texts.find(e => e.text.text === 'HDR:A')!
        expect(header.y).toBe(0)
        for (const entry of texts) {
          if (entry.text.text.startsWith('ROW:')) {
            expect(entry.y).toBeGreaterThan(header.y)
          }
        }
      }

      // All detail rows are rendered without omission
      const allTexts = doc.pages.flatMap((_, p) => pageTexts(doc, p))
      for (let i = 1; i <= 10; i++) {
        expect(countTexts(allTexts, 'ROW:A' + i)).toBe(1)
      }
    })

    // Verifies that no header appears on continuation pages when reprint is disabled.
    it('reprintHeaderOnEachPage=false: 2ページ目以降にヘッダーは描画されない', () => {
      // Page1: HDR + A1..A4, Page2: A5..A9, Page3: A10
      const doc = createReport(makeTemplate(false, makeRows('A', 10)), { rows: makeRows('A', 10) })
      expect(doc.pages.length).toBe(3)

      expect(countTexts(pageTexts(doc, 0), 'HDR:A')).toBe(1)
      for (let p = 1; p < doc.pages.length; p++) {
        expect(countTexts(pageTexts(doc, p), 'HDR:A')).toBe(0)
      }
    })
  })

  // Interaction of a group change with a page break in the same run.
  describe('グループ切替とページ跨ぎの組み合わせ', () => {
    // Verifies that group-change headers appear mid-page while reprint headers appear only at page tops.
    it('切替時はページ途中にヘッダー、跨ぎ時はページ先頭に再印字ヘッダー', () => {
      // rows: A×6, B×7
      // Page1: HDR:A + A1..A4
      // Page2: HDR:A(reprint) + A5, A6, HDR:B(group change) + B1
      // Page3: HDR:B(reprint) + B2..B5
      // Page4: HDR:B(reprint) + B6, B7
      const rows = [...makeRows('A', 6), ...makeRows('B', 7)]
      const doc = createReport(makeTemplate(true, rows), { rows })
      expect(doc.pages.length).toBe(4)

      // Page1: group-start header only
      const p1 = pageTexts(doc, 0)
      expect(countTexts(p1, 'HDR:A')).toBe(1)
      expect(countTexts(p1, 'HDR:B')).toBe(0)

      // Page2: HDR:A at the top (reprint), HDR:B mid-page (group change)
      const p2 = pageTexts(doc, 1)
      expect(countTexts(p2, 'HDR:A')).toBe(1)
      expect(countTexts(p2, 'HDR:B')).toBe(1)
      const reprintA = p2.find(e => e.text.text === 'HDR:A')!
      const switchB = p2.find(e => e.text.text === 'HDR:B')!
      expect(reprintA.y).toBe(0)
      // The group-change header comes right after A6 (y=40), i.e. y=60
      expect(switchB.y).toBe(60)
      // B1 comes right after the group-change header
      const b1 = p2.find(e => e.text.text === 'ROW:B1')!
      expect(b1.y).toBe(80)

      // Page3/Page4: only the current group's (B) header is reprinted at the top; A is not reprinted
      for (const p of [2, 3]) {
        const texts = pageTexts(doc, p)
        expect(countTexts(texts, 'HDR:A')).toBe(0)
        expect(countTexts(texts, 'HDR:B')).toBe(1)
        expect(texts.find(e => e.text.text === 'HDR:B')!.y).toBe(0)
      }
    })
  })

  // Reprint behavior combined with startNewPage / resetPageNumber group options.
  describe('startNewPage / resetPageNumber との組み合わせ', () => {
    // Verifies that reprint still occurs on page overflow after a startNewPage group break, without duplicating the header.
    it('startNewPage=true のグループ切替後も、ページ跨ぎで再印字される', () => {
      const rows = [...makeRows('A', 3), ...makeRows('B', 7)]
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
          reprintHeaderOnEachPage: true,
          startNewPage: true,
          resetPageNumber: true,
          header: {
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: (f: any) => 'HDR:' + f.dept,
              },
            ],
          },
        }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: (f: any) => 'ROW:' + f.name,
              },
            ],
          }],
          pageFooter: {
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'FOOTER' },
            ],
          },
        },
      }
      // content 100 - footer 20 = 80pt per page
      // Page1: HDR:A + A1..A3 (80)
      // Page2 (startNewPage): HDR:B + B1..B3
      // Page3: HDR:B(reprint) + B4..B6
      // Page4: HDR:B(reprint) + B7
      const doc = createReport(template, { rows })
      expect(doc.pages.length).toBe(4)

      // Page1: group A only
      const p1 = pageTexts(doc, 0)
      expect(countTexts(p1, 'HDR:A')).toBe(1)
      expect(countTexts(p1, 'HDR:B')).toBe(0)
      expect(countTexts(p1, 'ROW:A3')).toBe(1)

      // Page2: group B starts (startNewPage); the header appears once at the top only
      // (per common report behavior: a group-start page break does not duplicate the reprint header)
      const p2 = pageTexts(doc, 1)
      expect(countTexts(p2, 'HDR:A')).toBe(0)
      expect(countTexts(p2, 'HDR:B')).toBe(1)
      expect(p2.find(e => e.text.text === 'HDR:B')!.y).toBe(0)
      expect(countTexts(p2, 'ROW:B1')).toBe(1)

      // Page3/4: exactly one reprint header at the top of each overflow page
      for (const p of [2, 3]) {
        const texts = pageTexts(doc, p)
        expect(countTexts(texts, 'HDR:B')).toBe(1)
        expect(texts.find(e => e.text.text === 'HDR:B')!.y).toBe(0)
      }
      expect(countTexts(pageTexts(doc, 3), 'ROW:B7')).toBe(1)
    })

    // Verifies that resetPageNumber makes PAGE_NUMBER restart at 1 on the group's new page.
    it('resetPageNumber + startNewPage: グループ開始の新ページが PAGE_NUMBER=1 になる', () => {
      const rows = [
        { dept: 'A', name: 'A1' },
        { dept: 'B', name: 'B1' },
      ]
      const template: ReportTemplate = {
        page: { width: 200, height: 140, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
        groups: [{
          name: 'dept',
          expression: 'field.dept',
          startNewPage: true,
          resetPageNumber: true,
          header: {
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: '`PN:${PAGE_NUMBER}`',
              },
            ],
          },
        }],
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.name' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows })
      expect(doc.pages.length).toBe(2)
      // Page1: group A's header renders with PAGE_NUMBER=1
      expect(countTexts(pageTexts(doc, 0), 'PN:1')).toBe(1)
      // Page2: group B's new page has its page number reset, so PAGE_NUMBER=1
      expect(countTexts(pageTexts(doc, 1), 'PN:1')).toBe(1)
    })
  })
})
