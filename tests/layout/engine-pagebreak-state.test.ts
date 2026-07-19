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

function pageTextValues(doc: { pages: Array<{ children: RenderNode[] }> }, pageIndex: number): string[] {
  const entries = pageTexts(doc, pageIndex)
  const values: string[] = []
  for (const entry of entries) values.push(entry.text.text)
  return values
}

function countTexts(entries: Array<{ text: RenderText }>, value: string): number {
  let count = 0
  for (const entry of entries) {
    if (entry.text.text === value) count++
  }
  return count
}

// ─── Tests ───

describe('改ページとページ番号系の状態管理', () => {
  describe('自然な改ページでの PAGE_NUMBER 進行', () => {
    // Detail overflow drives 3 natural page breaks; PAGE_NUMBER (now) must advance
    // 1,2,3 in both pageHeader and pageFooter of each page.
    it('detail あふれによる3ページで pageHeader/pageFooter の PAGE_NUMBER が 1,2,3 と進む', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [{ name: 'name', type: 'string' }],
        bands: {
          pageHeader: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`HPN:${PAGE_NUMBER}`' },
            ],
          },
          details: [{
            height: 30,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.name' },
            ],
          }],
          pageFooter: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`FPN:${PAGE_NUMBER}`' },
            ],
          },
        },
      }
      // 100 - header 20 - footer 20 = 60pt → 2 detail rows (30pt) per page → 6 rows = 3 pages
      const doc = createReport(template, {
        rows: [{ name: 'r1' }, { name: 'r2' }, { name: 'r3' }, { name: 'r4' }, { name: 'r5' }, { name: 'r6' }],
      })
      expect(doc.pages.length).toBe(3)
      for (let p = 0; p < 3; p++) {
        const values = pageTextValues(doc, p)
        expect(values).toContain('HPN:' + (p + 1))
        expect(values).toContain('FPN:' + (p + 1))
      }
    })
  })

  describe('Page X of Y パターン', () => {
    // PAGE_NUMBER (now) and TOTAL_PAGES (report) side by side: X advances per page
    // while Y is the final page count on every page.
    it('now の PAGE_NUMBER と report の TOTAL_PAGES が全ページで正しい', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [{ name: 'name', type: 'string' }],
        bands: {
          details: [{
            height: 30,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.name' },
            ],
          }],
          pageFooter: {
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 60, height: 20,
                expression: '`X:${PAGE_NUMBER}`',
                evaluationTime: 'now',
              },
              {
                type: 'textField', x: 60, y: 0, width: 60, height: 20,
                expression: '`Y:${TOTAL_PAGES}`',
                evaluationTime: 'report',
              },
            ],
          },
        },
      }
      // 100 - footer 20 = 80pt → 2 rows per page → 5 rows = 3 pages (2+2+1)
      const doc = createReport(template, {
        rows: [{ name: 'r1' }, { name: 'r2' }, { name: 'r3' }, { name: 'r4' }, { name: 'r5' }],
      })
      expect(doc.pages.length).toBe(3)
      for (let p = 0; p < 3; p++) {
        const values = pageTextValues(doc, p)
        expect(values).toContain('X:' + (p + 1))
        expect(values).toContain('Y:3')
      }
    })
  })

  describe('break 要素 type=column', () => {
    // A column break advances COLUMN_NUMBER 1→2; a column break on the last
    // column advances the page instead (PAGE_NUMBER +1, COLUMN_NUMBER back to 1).
    it('改カラムで COLUMN_NUMBER が進み、最終カラムでは改ページになる', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        columns: { count: 2, spacing: 0 },
        fields: [{ name: 'name', type: 'string' }],
        bands: {
          details: [
            {
              height: 30,
              elements: [
                {
                  type: 'textField', x: 0, y: 0, width: 100, height: 20,
                  expression: '`R:${field.name} C:${COLUMN_NUMBER} P:${PAGE_NUMBER}`',
                },
              ],
            },
            {
              height: 0,
              elements: [
                { type: 'break', x: 0, y: 0, width: 0, height: 0, breakType: 'column' },
              ],
            },
          ],
        },
      }
      const doc = createReport(template, {
        rows: [{ name: 'r1' }, { name: 'r2' }, { name: 'r3' }],
      })
      expect(doc.pages.length).toBe(2)

      // Page 1: r1 in column 1, r2 in column 2 (x offset 100pt)
      const p1 = pageTexts(doc, 0)
      expect(countTexts(p1, 'R:r1 C:1 P:1')).toBe(1)
      expect(countTexts(p1, 'R:r2 C:2 P:1')).toBe(1)
      const r1 = p1.find(e => e.text.text === 'R:r1 C:1 P:1')!
      const r2 = p1.find(e => e.text.text === 'R:r2 C:2 P:1')!
      expect(r1.x).toBeLessThan(100)
      expect(r2.x).toBeGreaterThanOrEqual(100)

      // Page 2: the break on the last column advanced the page, r3 back in column 1
      const p2 = pageTexts(doc, 1)
      expect(countTexts(p2, 'R:r3 C:1 P:2')).toBe(1)
      expect(p2.find(e => e.text.text === 'R:r3 C:1 P:2')!.x).toBeLessThan(100)
    })
  })

  describe('group startNewColumn', () => {
    // startNewColumn moves each new group value to the next column; from the last
    // column it falls through to a page break.
    it('グループ切替で改カラム、最終カラムからは改ページ', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        columns: { count: 2, spacing: 0 },
        fields: [
          { name: 'grp', type: 'string' },
          { name: 'name', type: 'string' },
        ],
        groups: [{
          name: 'grp',
          expression: 'field.grp',
          startNewColumn: true,
          header: {
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: '`G:${field.grp} C:${COLUMN_NUMBER} P:${PAGE_NUMBER}`',
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
      const doc = createReport(template, {
        rows: [
          { grp: 'A', name: 'a1' },
          { grp: 'B', name: 'b1' },
          { grp: 'C', name: 'c1' },
        ],
      })
      expect(doc.pages.length).toBe(2)

      const p1 = pageTexts(doc, 0)
      expect(countTexts(p1, 'G:A C:1 P:1')).toBe(1)
      expect(countTexts(p1, 'G:B C:2 P:1')).toBe(1)
      expect(p1.find(e => e.text.text === 'G:B C:2 P:1')!.x).toBeGreaterThanOrEqual(100)

      const p2 = pageTexts(doc, 1)
      expect(countTexts(p2, 'G:C C:1 P:2')).toBe(1)
    })
  })

  describe('resetPageNumber の多セグメント', () => {
    // Three startNewPage+resetPageNumber groups, each spanning 2 pages: the
    // now-evaluated PAGE_NUMBER in the detail band must restart at 1 on the first
    // page of each segment and advance 1,2 within the segment.
    it('3セグメントそれぞれで PAGE_NUMBER が 1,2 と再開する', () => {
      const rows: Array<{ seg: string; name: string }> = []
      for (const seg of ['a', 'b', 'c']) {
        for (let i = 1; i <= 7; i++) rows.push({ seg, name: seg + i })
      }
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [
          { name: 'seg', type: 'string' },
          { name: 'name', type: 'string' },
        ],
        groups: [{
          name: 'seg',
          expression: 'field.seg',
          startNewPage: true,
          resetPageNumber: true,
          header: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`SEG:${field.seg}`' },
            ],
          },
        }],
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`${field.name} PN:${PAGE_NUMBER}`' },
            ],
          }],
        },
      }
      // 100pt page, 20pt bands → 5 bands per page.
      // Segment page 1: SEG header + 4 details, page 2: 3 details → 2 pages per segment.
      const doc = createReport(template, { rows })
      expect(doc.pages.length).toBe(6)

      for (let s = 0; s < 3; s++) {
        const seg = ['a', 'b', 'c'][s]!
        const first = pageTextValues(doc, s * 2)
        const second = pageTextValues(doc, s * 2 + 1)
        // Segment-first page: numbering restarts at 1
        expect(first).toContain('SEG:' + seg)
        expect(first).toContain(seg + '1 PN:1')
        expect(first).toContain(seg + '4 PN:1')
        // Segment-second page: advances to 2 within the segment
        expect(second).toContain(seg + '5 PN:2')
        expect(second).toContain(seg + '7 PN:2')
      }
    })
  })

  describe('resetPageNumber × TOTAL_PAGES (report)', () => {
    // Current behavior: TOTAL_PAGES with evaluationTime=report is the page count
    // of the whole document; resetPageNumber does not affect it.
    it('TOTAL_PAGES はリセットの影響を受けずドキュメント総ページ数のまま', () => {
      const rows: Array<{ seg: string; name: string }> = []
      for (const seg of ['A', 'B']) {
        for (let i = 1; i <= 5; i++) rows.push({ seg, name: seg + i })
      }
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [
          { name: 'seg', type: 'string' },
          { name: 'name', type: 'string' },
        ],
        groups: [{
          name: 'seg',
          expression: 'field.seg',
          startNewPage: true,
          resetPageNumber: true,
          header: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`SEG:${field.seg}`' },
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
          pageFooter: {
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: '`T:${TOTAL_PAGES}`',
                evaluationTime: 'report',
              },
            ],
          },
        },
      }
      // 100 - footer 20 = 80pt. Segment page 1: SEG (20) + 3 details, page 2: 2 details
      // → 2 pages per segment × 2 segments = 4 pages.
      const doc = createReport(template, { rows })
      expect(doc.pages.length).toBe(4)
      for (let p = 0; p < 4; p++) {
        expect(pageTextValues(doc, p)).toContain('T:4')
      }
    })
  })

  describe('resetPageNumber まわりの 一般的な帳票動作（回帰防止）', () => {
    // Common report behavior fills the closing page's pageFooter BEFORE resetting the counter, so the
    // segment's last page must print its real in-segment number, not 0. Guards the
    // fix where the reset was moved after finalizePage() inside breakPage().
    it('resetPageNumber の閉じページ pageFooter は実ページ番号を表示する（0 ではない）', () => {
      const rows: Array<{ dept: string; name: string }> = []
      for (let i = 1; i <= 6; i++) rows.push({ dept: 'A', name: 'A' + i })
      for (let i = 1; i <= 6; i++) rows.push({ dept: 'B', name: 'B' + i })
      const template: ReportTemplate = {
        page: { width: 200, height: 120, margins: { top: 10, bottom: 10, left: 10, right: 10 } },
        groups: [{ name: 'dept', expression: 'field.dept', startNewPage: true, resetPageNumber: true }],
        bands: {
          details: [{ height: 20, elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.name' }] }],
          pageFooter: {
            height: 20,
            elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`PN:${PAGE_NUMBER}`', evaluationTime: 'now' }],
          },
        },
      }
      // 2 segments × 2 pages; each segment: closing page keeps its number, next restarts at 1.
      const doc = createReport(template, { rows })
      expect(doc.pages.length).toBe(4)
      expect(pageTextValues(doc, 0)).toContain('PN:1')
      expect(pageTextValues(doc, 1)).toContain('PN:2')
      expect(pageTextValues(doc, 2)).toContain('PN:1')
      expect(pageTextValues(doc, 3)).toContain('PN:2')
    })

    // A group's resetPageNumber makes PAGE_NUMBER===1 recur mid-document; those
    // segment-start pages must still render the pageHeader (previously skipped
    // because startNewPage keyed the "first page" test on pageNumber===1).
    it('resetPageNumber 後のセグメント先頭ページでも pageHeader が描画される', () => {
      const rows: Array<{ dept: string; name: string }> = []
      for (let i = 1; i <= 4; i++) rows.push({ dept: 'A', name: 'A' + i })
      for (let i = 1; i <= 4; i++) rows.push({ dept: 'B', name: 'B' + i })
      const template: ReportTemplate = {
        page: { width: 200, height: 120, margins: { top: 10, bottom: 10, left: 10, right: 10 } },
        groups: [{ name: 'dept', expression: 'field.dept', startNewPage: true, resetPageNumber: true }],
        bands: {
          pageHeader: { height: 20, elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'HEADER' }] },
          details: [{ height: 20, elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.name' }] }],
        },
      }
      const doc = createReport(template, { rows })
      expect(doc.pages.length).toBe(2)
      // Both the first page and segment B's reset page (PAGE_NUMBER===1) render the header.
      for (let p = 0; p < doc.pages.length; p++) {
        expect(pageTextValues(doc, p)).toContain('HEADER')
      }
    })

    // A page break starts a fresh column 0, so resetType=column variables restart on
    // the new page — not only at a mid-page column break. Guards the resetColumnVariables
    // call added to startNewPage.
    it('resetType=column の変数がページ跨ぎ（新カラム0）でリセットされる', () => {
      const template: ReportTemplate = {
        page: { width: 200, height: 80, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'val', type: 'number' }],
        variables: [{ name: 'colSum', expression: 'field.val', calculation: 'sum', resetType: 'column' }],
        bands: {
          details: [{
            height: 30,
            elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: (_f: unknown, v: { colSum: number }) => 'CSUM:' + v.colSum }],
          }],
        },
      }
      // 80pt / 30pt rows → 2 rows per page. Page 2 begins a new column, so colSum
      // restarts instead of carrying the page-1 total. Variables are calculated
      // before the detail renders (running totals include the current row), and
      // the row that moves to the new page re-applies its increment after the
      // column reset: page 2 starts at CSUM:3 (row 3 only), then CSUM:7.
      const doc = createReport(template, { rows: [{ val: 1 }, { val: 2 }, { val: 3 }, { val: 4 }] })
      expect(doc.pages.length).toBe(2)
      expect(pageTextValues(doc, 0)).toEqual(['CSUM:1', 'CSUM:3'])
      expect(pageTextValues(doc, 1)).toEqual(['CSUM:3', 'CSUM:7'])
    })
  })

  describe('変数 resetType=page/column の境界', () => {
    // A count variable with resetType=page: each pageFooter shows the number of
    // rows on that page only, across 3 pages.
    it('resetType=page の count が各ページで再集計される（3ページ）', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [{ name: 'val', type: 'number' }],
        variables: [{
          name: 'pageCnt',
          expression: 'field.val',
          calculation: 'count',
          resetType: 'page',
        }],
        bands: {
          details: [{
            height: 30,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.val' },
            ],
          }],
          pageFooter: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: (_f: any, v: any) => 'CNT:' + v.pageCnt },
            ],
          },
        },
      }
      // 100 - footer 20 = 80pt → 2 rows per page → 5 rows = pages with 2, 2, 1 rows
      const doc = createReport(template, {
        rows: [{ val: 1 }, { val: 2 }, { val: 3 }, { val: 4 }, { val: 5 }],
      })
      expect(doc.pages.length).toBe(3)
      expect(pageTextValues(doc, 0)).toContain('CNT:2')
      expect(pageTextValues(doc, 1)).toContain('CNT:2')
      expect(pageTextValues(doc, 2)).toContain('CNT:1')
    })

    // A sum variable with resetType=column: each columnFooter shows the sum of
    // rows in that column only; the value restarts from the first row after the
    // column boundary. (The page-boundary reset case is covered by the common report behavior
    // regression block above.)
    it('resetType=column の sum がカラム跨ぎで再集計される', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        columns: { count: 2, spacing: 0 },
        fields: [{ name: 'val', type: 'number' }],
        variables: [{
          name: 'colSum',
          expression: 'field.val',
          calculation: 'sum',
          resetType: 'column',
        }],
        bands: {
          details: [{
            height: 30,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.val' },
            ],
          }],
          columnFooter: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: (_f: any, v: any) => 'CSUM:' + v.colSum },
            ],
          },
        },
      }
      // 100 - columnFooter 20 = 80pt → 2 rows (30pt) per column.
      // Column 1: 1+2=3, column 2: 3+4=7 (resets and re-accumulates from row 3).
      const doc = createReport(template, {
        rows: [{ val: 1 }, { val: 2 }, { val: 3 }, { val: 4 }],
      })
      expect(doc.pages.length).toBe(1)
      const p1 = pageTextValues(doc, 0)
      expect(p1).toContain('CSUM:3')
      expect(p1).toContain('CSUM:7')
    })
  })

  describe('evaluationTime=page の複数ページ', () => {
    // A report-reset sum shown in the pageHeader with evaluationTime=page must be
    // the value as of that page's completion — different on every page.
    it('各ページの evaluationTime=page フィールドがページ確定時点の値になる', () => {
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
                expression: (_f: any, v: any) => 'PT:' + v.total,
                evaluationTime: 'page',
              },
            ],
          },
          details: [{
            height: 30,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.val' },
            ],
          }],
        },
      }
      // 100 - header 20 = 80pt → 2 rows per page → 5 rows = 3 pages.
      // Cumulative totals as of page completion: 30, 100, 150.
      const doc = createReport(template, {
        rows: [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }, { val: 50 }],
      })
      expect(doc.pages.length).toBe(3)
      expect(pageTextValues(doc, 0)).toContain('PT:30')
      expect(pageTextValues(doc, 1)).toContain('PT:100')
      expect(pageTextValues(doc, 2)).toContain('PT:150')
    })

    it('evaluationTime=auto はfieldをNow、変数をresetType対応時点で評価する', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        variables: [{
          name: 'total',
          expression: 'field.val',
          calculation: 'sum',
          resetType: 'report',
        }],
        bands: {
          details: [{
            height: 20,
            elements: [{
              type: 'textField', x: 0, y: 0, width: 180, height: 20,
              expression: '`row:${field.val}/total:${vars.total}`',
              evaluationTime: 'auto',
            }],
          }],
        },
      }

      const doc = createReport(template, {
        rows: [{ val: 10 }, { val: 20 }],
      })
      const texts = pageTextValues(doc, 0)
      expect(texts).toContain('row:10/total:30')
      expect(texts).toContain('row:20/total:30')
    })

    it('evaluationTime=auto はpage変数とreport変数を同一式で混在できる', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        variables: [
          {
            name: 'pageSum',
            expression: 'field.val',
            calculation: 'sum',
            resetType: 'page',
          },
          {
            name: 'total',
            expression: 'field.val',
            calculation: 'sum',
            resetType: 'report',
          },
        ],
        bands: {
          details: [{
            height: 30,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.val' },
            ],
          }],
          pageFooter: {
            height: 20,
            elements: [{
              type: 'textField', x: 0, y: 0, width: 180, height: 20,
              expression: '`P:${vars.pageSum}/T:${vars.total}`',
              evaluationTime: 'auto',
            }],
          },
        },
      }

      const doc = createReport(template, {
        rows: [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }, { val: 50 }],
      })
      expect(doc.pages.length).toBe(3)
      expect(pageTextValues(doc, 0)).toContain('P:30/T:150')
      expect(pageTextValues(doc, 1)).toContain('P:70/T:150')
      expect(pageTextValues(doc, 2)).toContain('P:50/T:150')
    })

    // auto with the PAGE_NUMBER builtin: PAGE_NUMBER resolves at page time, so a
    // detail field shows the page it actually lands on (1,1,2,2 across 2 pages).
    it('evaluationTime=auto の PAGE_NUMBER が各行の配置ページ番号になる', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 80,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 30,
            elements: [{
              type: 'textField', x: 0, y: 0, width: 100, height: 20,
              expression: '`AP:${PAGE_NUMBER}`',
              evaluationTime: 'auto',
            }],
          }],
        },
      }
      // 80pt / 30pt rows → 2 rows per page → 4 rows = 2 pages.
      const doc = createReport(template, { rows: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }] })
      expect(doc.pages.length).toBe(2)
      expect(pageTextValues(doc, 0).filter(t => t === 'AP:1')).toHaveLength(2)
      expect(pageTextValues(doc, 1).filter(t => t === 'AP:2')).toHaveLength(2)
    })

    // auto with a group-reset variable: each group footer shows that group's own sum,
    // captured at the group's reset time (A=3, B=30).
    it('evaluationTime=auto の group リセット変数が各グループの値で解決される', () => {
      const template: ReportTemplate = {
        page: {
          width: 300, height: 400,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [{ name: 'g', type: 'string' }, { name: 'v', type: 'number' }],
        groups: [{
          name: 'g',
          expression: 'field.g',
          footer: {
            height: 20,
            elements: [{
              type: 'textField', x: 0, y: 0, width: 200, height: 20,
              expression: '`GSUM:${vars.gsum}`',
              evaluationTime: 'auto',
            }],
          },
        }],
        variables: [{
          name: 'gsum', expression: 'field.v', calculation: 'sum',
          resetType: 'group', resetGroup: 'g',
        }],
        bands: {
          details: [{
            height: 15,
            elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 15, expression: 'field.v' }],
          }],
        },
      }
      const doc = createReport(template, {
        rows: [{ g: 'A', v: 1 }, { g: 'A', v: 2 }, { g: 'B', v: 10 }, { g: 'B', v: 20 }],
      })
      const values = pageTextValues(doc, 0)
      expect(values).toContain('GSUM:3')
      expect(values).toContain('GSUM:30')
    })
  })

  describe('summary バンドとページ番号', () => {
    // A summary band that overflows to a new page must advance PAGE_NUMBER; the
    // summary and the new page's footer both see the incremented value.
    it('summary が新ページにあふれた場合も PAGE_NUMBER が進む', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        fields: [{ name: 'name', type: 'string' }],
        bands: {
          details: [{
            height: 30,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.name' },
            ],
          }],
          summary: {
            height: 40,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`SPN:${PAGE_NUMBER}`' },
            ],
          },
          pageFooter: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`FPN:${PAGE_NUMBER}`' },
            ],
          },
        },
      }
      // 100 - footer 20 = 80pt. 2 rows (60pt) leave 20pt < summary 40pt → summary overflows to page 2.
      const doc = createReport(template, { rows: [{ name: 'r1' }, { name: 'r2' }] })
      expect(doc.pages.length).toBe(2)

      const p1 = pageTextValues(doc, 0)
      expect(p1).toContain('FPN:1')
      expect(p1).not.toContain('SPN:1')

      const p2 = pageTextValues(doc, 1)
      expect(p2).toContain('SPN:2')
      expect(p2).toContain('FPN:2')
    })
  })
})
