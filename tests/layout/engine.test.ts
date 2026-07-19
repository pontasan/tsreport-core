import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderGroup, RenderText, RenderLine, RenderRect } from '../../src/types/render.js'

// ─── Helpers ───

/** Recursively collects all text nodes within a page */
function collectTexts(nodes: import('../../src/types/render.js').RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

/** Recursively collects all group nodes within a page */
function collectGroups(nodes: import('../../src/types/render.js').RenderNode[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (const node of nodes) {
    if (node.type === 'group') {
      groups.push(node)
      groups.push(...collectGroups(node.children))
    }
  }
  return groups
}

// ─── Template definitions ───

const simpleTemplate: ReportTemplate = {
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 30, bottom: 30, left: 20, right: 20 },
  },
  fields: [
    { name: 'name', type: 'string' },
    { name: 'amount', type: 'number' },
  ],
  bands: {
    title: {
      height: 40,
      elements: [
        { type: 'staticText', x: 0, y: 10, width: 555, height: 20, text: 'テストレポート' },
      ],
    },
    pageHeader: {
      height: 20,
      elements: [
        { type: 'staticText', x: 0, y: 2, width: 200, height: 15, text: 'ヘッダー' },
      ],
    },
    details: [
      {
        height: 20,
        elements: [
          { type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: "field.name" },
          { type: 'textField', x: 200, y: 0, width: 100, height: 20, expression: "field.amount" },
        ],
      },
    ],
    pageFooter: {
      height: 20,
      elements: [
        { type: 'textField', x: 0, y: 2, width: 555, height: 15, expression: (_f: any, _v: any, _p: any, r: any) => 'Page ' + r.PAGE_NUMBER },
      ],
    },
  },
}

// ─── Tests ───

describe('createReport', () => {
  describe('基本構造', () => {
    // Verifies the render tree structure: page → group (band) → leaf nodes.
    it('ツリー構造: ページ → グループ（バンド） → リーフノード', () => {
      const data: DataSource = {
        rows: [
          { name: '商品A', amount: 1000 },
        ],
      }
      const doc = createReport(simpleTemplate, data)

      expect(doc.pages.length).toBe(1)
      const page = doc.pages[0]!

      // Direct children of a page are RenderGroups (bands)
      for (const child of page.children) {
        expect(child.type).toBe('group')
      }
    })

    // Verifies that each band is represented as a RenderGroup node.
    it('バンドはRenderGroupとして表現される', () => {
      const data: DataSource = {
        rows: [{ name: 'A', amount: 100 }],
      }
      const doc = createReport(simpleTemplate, data)
      const page = doc.pages[0]!

      // The title, pageHeader, detail, summary (absent), and pageFooter bands each become a group
      const groups = page.children.filter(n => n.type === 'group') as RenderGroup[]
      expect(groups.length).toBeGreaterThanOrEqual(3) // excluding background: title + pageHeader + detail + pageFooter
    })

    // Verifies A4 page dimensions in points (595x842).
    it('ページ寸法がA4', () => {
      const data: DataSource = { rows: [{ name: 'A', amount: 100 }] }
      const doc = createReport(simpleTemplate, data)
      expect(doc.pages[0]!.width).toBe(595)
      expect(doc.pages[0]!.height).toBe(842)
    })

    // Verifies landscape orientation swaps page width and height.
    it('landscape指定でページが横向き', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', orientation: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [] }] },
      }
      const doc = createReport(template, { rows: [{}] })
      expect(doc.pages[0]!.width).toBe(842)
      expect(doc.pages[0]!.height).toBe(595)
    })
  })

  describe('テキスト描画', () => {
    // Verifies that a StaticText element becomes a RenderText node.
    it('StaticTextがRenderTextノードになる', () => {
      const data: DataSource = { rows: [{ name: 'A', amount: 100 }] }
      const doc = createReport(simpleTemplate, data)
      const texts = collectTexts(doc.pages[0]!.children)

      const title = texts.find(t => t.text === 'テストレポート')
      expect(title).toBeDefined()
      expect(title!.type).toBe('text')
    })

    // Verifies that the outlineText flag is propagated to the RenderText node.
    it('outlineText が RenderText に伝播される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 120, height: 20, text: 'Outlined', outlineText: true },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const texts = collectTexts(doc.pages[0]!.children)
      const outlined = texts.find((node) => node.text === 'Outlined')
      expect(outlined).toBeDefined()
      expect(outlined!.outlineText).toBe(true)
    })

    // Verifies that a TextField displays the evaluated result of its expression.
    it('TextFieldが式の評価結果を表示', () => {
      const data: DataSource = {
        rows: [{ name: '商品B', amount: 2500 }],
      }
      const doc = createReport(simpleTemplate, data)
      const texts = collectTexts(doc.pages[0]!.children)

      expect(texts.some(t => t.text === '商品B')).toBe(true)
      expect(texts.some(t => t.text === '2500')).toBe(true)
    })

    // Verifies arithmetic evaluation inside a callback expression.
    it('式で算術演算', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [
          { name: 'price', type: 'number' },
          { name: 'qty', type: 'number' },
        ],
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: (f: any) => f.price * f.qty },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ price: 500, qty: 3 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '1500')).toBe(true)
    })

    // Verifies number formatting is applied via the pattern property.
    it('format関数で数値書式', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'amount', type: 'number' }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: 'field.amount',
                pattern: '¥#,##0',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ amount: 12345 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '¥12,345')).toBe(true)
    })

    // Verifies built-in functions (format, round) can be evaluated inside expressions.
    it('組み込み関数を式内で評価できる', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'amount', type: 'number' }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 140, height: 20,
                expression: 'format(round(field.amount, 1), "#,##0.0")',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ amount: 12345.67 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '12,345.7')).toBe(true)
    })

    // Verifies the pattern property and the format() function share the same formatting system.
    it('pattern と format() が同じ書式系で評価される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'amount', type: 'number' }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 140, height: 20,
                expression: 'field.amount',
                pattern: '¥#,##0.00',
              },
              {
                type: 'textField', x: 150, y: 0, width: 140, height: 20,
                expression: 'format(field.amount, "¥#,##0.00")',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ amount: 12345.6 }] })
      const texts = collectTexts(doc.pages[0]!.children).map((node) => node.text)
      expect(texts.filter((text) => text === '¥12,345.60').length).toBe(2)
    })

    // Verifies built-in functions can be evaluated inside printWhenExpression.
    it('組み込み関数を printWhenExpression で評価できる', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'amount', type: 'number' }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 140, height: 20,
                expression: '"visible"',
                printWhenExpression: 'roundDown(field.amount, 0) >= 100',
              },
              {
                type: 'textField', x: 0, y: 20, width: 140, height: 20,
                expression: '"hidden"',
                printWhenExpression: 'roundDown(field.amount, 0) < 100',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ amount: 100.9 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === 'visible')).toBe(true)
      expect(texts.some(t => t.text === 'hidden')).toBe(false)
    })
  })

  describe('ページ分割', () => {
    // Verifies a page break occurs when bands do not fit in the content area.
    it('バンドがページに収まらない場合に改ページ', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 10, bottom: 10, left: 10, right: 10 },
        },
        bands: {
          details: [{ height: 30, elements: [] }],
        },
      }
      // Content area: 100 - 10 - 10 = 80pt
      // 30pt * 3 rows = 90pt → should split into 2 pages
      const data: DataSource = {
        rows: [{}, {}, {}],
      }
      const doc = createReport(template, data)
      expect(doc.pages.length).toBe(2)
    })

    // Verifies the page break calculation accounts for the pageFooter height.
    it('pageFooterの高さを考慮して改ページ', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{ height: 40, elements: [] }],
          pageFooter: { height: 20, elements: [] },
        },
      }
      // Content area = 100pt, footer = 20pt → effectively 80pt
      // 40pt * 2 rows = 80pt → 2 rows on page 1, 3rd row on page 2
      const doc = createReport(template, { rows: [{}, {}, {}] })
      expect(doc.pages.length).toBe(2)
    })

    // Verifies the summary page-break check uses its effective height so it never overlaps the pageFooter.
    it('Summary は実効高さで改ページ判定し pageFooter と重ならない', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 160,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{ height: 80, elements: [] }],
          summary: {
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 60, width: 100, height: 20, text: 'Summary' },
            ],
          },
          pageFooter: {
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Footer' },
            ],
          },
        },
      }

      const doc = createReport(template, { rows: [{}] })
      expect(doc.pages.length).toBe(2)

      const lastPageGroups = collectGroups(doc.pages[1]!.children)
      const summaryGroup = lastPageGroups.find(group => collectTexts(group.children).some(text => text.text === 'Summary'))
      const footerGroup = lastPageGroups.find(group => collectTexts(group.children).some(text => text.text === 'Footer'))

      expect(summaryGroup).toBeDefined()
      expect(footerGroup).toBeDefined()
      expect(summaryGroup!.y + summaryGroup!.height).toBeLessThanOrEqual(footerGroup!.y)
    })

    // Verifies a detail band with startNewPage=true starts on a fresh page.
    it('startNewPage=true の detail band は新しいページから開始する', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 160,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [
            {
              height: 40,
              elements: [
                { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Detail-1' },
              ],
            },
            {
              height: 40,
              startNewPage: true,
              elements: [
                { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Detail-2' },
              ],
            },
          ],
        },
      }

      const doc = createReport(template, { rows: [{}] })
      expect(doc.pages.length).toBe(2)
      expect(collectTexts(doc.pages[0]!.children).some(text => text.text === 'Detail-1')).toBe(true)
      expect(collectTexts(doc.pages[0]!.children).some(text => text.text === 'Detail-2')).toBe(false)
      expect(collectTexts(doc.pages[1]!.children).some(text => text.text === 'Detail-2')).toBe(true)
    })

    // Verifies the effective height of a subreport inside the summary is included in the page-break check against the pageFooter.
    it('Summary 内 subreport の実効高さも pageFooter と重ならないよう改ページ判定する', () => {
      const subTemplate: ReportTemplate = {
        page: {
          width: 200, height: 160,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [
            {
              height: 80,
              elements: [
                { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Child Detail' },
              ],
            },
          ],
        },
      }

      const template: ReportTemplate = {
        page: {
          width: 200, height: 160,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{ height: 80, elements: [] }],
          summary: {
            height: 20,
            elements: [
              { type: 'subreport', x: 0, y: 0, width: 100, height: 20, templateExpression: '"child"' },
            ],
          },
          pageFooter: {
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Footer' },
            ],
          },
        },
      }

      const doc = createReport(template, { rows: [{}] }, {
        resolveSubreportTemplate: function (ref) {
          if (ref !== 'child') return null
          return { template: subTemplate }
        },
      })

      expect(doc.pages.length).toBe(2)
      expect(collectTexts(doc.pages[0]!.children).some(text => text.text === 'Child Detail')).toBe(false)
      expect(collectTexts(doc.pages[1]!.children).some(text => text.text === 'Child Detail')).toBe(true)
    })

    // Verifies PAGE_NUMBER increments correctly on each generated page.
    it('ページ番号が正しくインクリメント', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{ height: 40, elements: [] }],
          pageFooter: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: (_f: any, _v: any, _p: any, r: any) => 'P' + r.PAGE_NUMBER },
            ],
          },
        },
      }
      const doc = createReport(template, { rows: [{}, {}, {}, {}, {}] })
      expect(doc.pages.length).toBeGreaterThan(1)

      // Verify the page number in each page footer
      for (let i = 0; i < doc.pages.length; i++) {
        const texts = collectTexts(doc.pages[i]!.children)
        expect(texts.some(t => t.text === `P${i + 1}`)).toBe(true)
      }
    })
  })

  describe('グループ（コントロールブレーク）', () => {
    const groupTemplate: ReportTemplate = {
      page: {
        size: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      fields: [
        { name: 'dept', type: 'string' },
        { name: 'amount', type: 'number' },
      ],
      variables: [
        {
          name: 'groupSum',
          expression: 'field.amount',
          calculation: 'sum',
          resetType: 'group',
          resetGroup: 'deptGroup',
        },
        {
          name: 'grandTotal',
          expression: 'field.amount',
          calculation: 'sum',
          resetType: 'report',
        },
      ],
      groups: [
        {
          name: 'deptGroup',
          expression: 'field.dept',
          header: {
            height: 25,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 200, height: 25, expression: "field.dept" },
            ],
          },
          footer: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: (_f: any, v: any) => '小計: ' + v.groupSum },
            ],
          },
        },
      ],
      bands: {
        details: [{
          height: 20,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: "field.amount" },
          ],
        }],
        summary: {
          height: 20,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: (_f: any, v: any) => '合計: ' + v.grandTotal },
          ],
        },
      },
    }

    // Verifies group headers are rendered whenever the group expression value changes.
    it('グループヘッダーが表示される', () => {
      const data: DataSource = {
        rows: [
          { dept: '営業', amount: 100 },
          { dept: '営業', amount: 200 },
          { dept: '開発', amount: 300 },
        ],
      }
      const doc = createReport(groupTemplate, data)
      const texts = collectTexts(doc.pages[0]!.children)

      // Group headers
      expect(texts.some(t => t.text === '営業')).toBe(true)
      expect(texts.some(t => t.text === '開発')).toBe(true)
    })

    // Verifies group footers show the subtotal from a group-reset sum variable.
    it('グループフッターに小計が表示される', () => {
      const data: DataSource = {
        rows: [
          { dept: '営業', amount: 100 },
          { dept: '営業', amount: 200 },
          { dept: '開発', amount: 300 },
        ],
      }
      const doc = createReport(groupTemplate, data)
      const texts = collectTexts(doc.pages[0]!.children)

      // Sales group subtotal = 300
      expect(texts.some(t => t.text === '小計: 300')).toBe(true)
      // Development group subtotal = 300
      expect(texts.some(t => t.text === '小計: 300')).toBe(true)
    })

    // Verifies the report-level sum variable shows the grand total in the summary band.
    it('総合計がサマリに表示される', () => {
      const data: DataSource = {
        rows: [
          { dept: '営業', amount: 100 },
          { dept: '営業', amount: 200 },
          { dept: '開発', amount: 300 },
        ],
      }
      const doc = createReport(groupTemplate, data)
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '合計: 600')).toBe(true)
    })
  })

  describe('変数', () => {
    // Verifies a count variable increments per row and is available in the summary.
    it('count変数', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'x', type: 'number' }],
        variables: [
          { name: 'cnt', expression: '1', calculation: 'count', resetType: 'report' },
        ],
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: "vars.cnt" },
            ],
          }],
          summary: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: (_f: any, v: any) => 'Total: ' + v.cnt },
            ],
          },
        },
      }
      const doc = createReport(template, { rows: [{x: 1}, {x: 2}, {x: 3}] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === 'Total: 3')).toBe(true)
    })

    // Verifies a sum variable accumulates field values across all rows.
    it('sum変数', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'val', type: 'number' }],
        variables: [
          { name: 'total', expression: 'field.val', calculation: 'sum', resetType: 'report' },
        ],
        bands: {
          details: [{ height: 20, elements: [] }],
          summary: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: "vars.total" },
            ],
          },
        },
      }
      const doc = createReport(template, { rows: [{ val: 10 }, { val: 20 }, { val: 30 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '60')).toBe(true)
    })

    // Verifies a string expression containing arithmetic is evaluated and displayed.
    it('文字列式で算術結果を表示できる', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [
          { name: 'price', type: 'number' },
          { name: 'qty', type: 'number' },
        ],
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.price * field.qty' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ price: 120, qty: 3 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '360')).toBe(true)
    })
  })

  describe('スタイル', () => {
    // Verifies style properties (font, size, bold, color) are applied to the RenderText node.
    it('スタイルのプロパティがRenderTextに反映される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [
          { name: 'Bold', fontFamily: 'NotoSansJP', fontSize: 14, bold: true, forecolor: '#FF0000' },
        ],
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Bold', style: 'Bold' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const texts = collectTexts(doc.pages[0]!.children)
      const boldText = texts.find(t => t.text === 'Bold')!
      expect(boldText.fontId).toBe('NotoSansJP')
      expect(boldText.fontSize).toBe(14)
      expect(boldText.bold).toBe(true)
      expect(boldText.color).toBe('#FF0000')
    })

    // Verifies the isDefault style applies to elements without an explicit style reference.
    it('isDefaultスタイルがstyle未指定要素に適用される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [
          { name: 'Base', isDefault: true, fontFamily: 'NotoSansJP', fontSize: 16, forecolor: '#0000FF' },
          { name: 'Named', fontSize: 9 },
        ],
        bands: {
          details: [{
            height: 40,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Unstyled' },
              { type: 'staticText', x: 0, y: 20, width: 100, height: 20, text: 'Named', style: 'Named' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const texts = collectTexts(doc.pages[0]!.children)
      const unstyled = texts.find(t => t.text === 'Unstyled')!
      expect(unstyled.fontId).toBe('NotoSansJP')
      expect(unstyled.fontSize).toBe(16)
      expect(unstyled.color).toBe('#0000FF')
      // An explicit style reference is unaffected by the default style
      const named = texts.find(t => t.text === 'Named')!
      expect(named.fontSize).toBe(9)
    })

    // Verifies a child style inherits parent style properties and can override them.
    it('スタイル継承', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [
          { name: 'Base', fontFamily: 'Meiryo', fontSize: 12, forecolor: '#333333' },
          { name: 'Child', parentStyle: 'Base', bold: true },
        ],
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Inherited', style: 'Child' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const texts = collectTexts(doc.pages[0]!.children)
      const t = texts.find(t => t.text === 'Inherited')!
      expect(t.fontId).toBe('Meiryo')  // inherited from parent
      expect(t.fontSize).toBe(12)       // inherited from parent
      expect(t.bold).toBe(true)          // overridden by child
      expect(t.color).toBe('#333333')    // inherited from parent
    })

    // Verifies conditional styles are applied only when their condition matches.
    it('条件付きスタイル', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'val', type: 'number' }],
        styles: [
          {
            name: 'Conditional',
            forecolor: '#000000',
            conditionalStyles: [
              { condition: (f: any) => f.val < 0, forecolor: '#FF0000' },
            ],
          },
        ],
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.val', style: 'Conditional' },
            ],
          }],
        },
      }
      // Positive value
      const doc1 = createReport(template, { rows: [{ val: 100 }] })
      const t1 = collectTexts(doc1.pages[0]!.children).find(t => t.text === '100')!
      expect(t1.color).toBe('#000000')

      // Negative value
      const doc2 = createReport(template, { rows: [{ val: -50 }] })
      const t2 = collectTexts(doc2.pages[0]!.children).find(t => t.text === '-50')!
      expect(t2.color).toBe('#FF0000')
    })
  })

  describe('その他の要素', () => {
    // Verifies a line element becomes a RenderLine with lineWidth and color.
    it('Line要素', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'line', x: 0, y: 10, width: 500, height: 0, lineWidth: 2, lineColor: '#333333' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const allNodes: import('../../src/types/render.js').RenderNode[] = []
      function collect(nodes: import('../../src/types/render.js').RenderNode[]) {
        for (const n of nodes) {
          allNodes.push(n)
          if (n.type === 'group') collect(n.children)
        }
      }
      collect(doc.pages[0]!.children)
      const line = allNodes.find(n => n.type === 'line')
      expect(line).toBeDefined()
      expect((line as any).lineWidth).toBe(2)
      expect((line as any).color).toBe('#333333')
    })

    // Verifies a rectangle element becomes a RenderRect with radius and fill.
    it('Rectangle要素', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 50,
            elements: [
              { type: 'rectangle', x: 10, y: 10, width: 100, height: 30, radius: 5, fill: '#F0F0F0', stroke: '#000000' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const allNodes: import('../../src/types/render.js').RenderNode[] = []
      function collect(nodes: import('../../src/types/render.js').RenderNode[]) {
        for (const n of nodes) {
          allNodes.push(n)
          if (n.type === 'group') collect(n.children)
        }
      }
      collect(doc.pages[0]!.children)
      const rect = allNodes.find(n => n.type === 'rect') as RenderRect
      expect(rect).toBeDefined()
      expect(rect.radius).toBe(5)
      expect(rect.fill).toBe('#F0F0F0')
    })

    // Verifies per-corner radii on a rectangle element are propagated to the RenderRect.
    it('Rectangle要素で四隅個別の角丸が反映される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 50,
            elements: [
              {
                type: 'rectangle',
                x: 10,
                y: 10,
                width: 100,
                height: 30,
                cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
                fill: '#F0F0F0',
                stroke: '#000000',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const allNodes: import('../../src/types/render.js').RenderNode[] = []
      function collect(nodes: import('../../src/types/render.js').RenderNode[]) {
        for (const n of nodes) {
          allNodes.push(n)
          if (n.type === 'group') collect(n.children)
        }
      }
      collect(doc.pages[0]!.children)
      const rect = allNodes.find(n => n.type === 'rect') as RenderRect
      expect(rect).toBeDefined()
      expect(rect.cornerRadii).toEqual({ topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 })
    })

    // Verifies a frame element becomes a nested RenderGroup containing its child elements.
    it('Frame要素（コンポジット）', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 50,
            elements: [
              {
                type: 'frame', x: 10, y: 5, width: 200, height: 40,
                elements: [
                  { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Inside' },
                ],
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const groups = collectGroups(doc.pages[0]!.children)
      // The frame is nested as a RenderGroup
      const frameGroup = groups.find(g => g.x === 10 && g.y === 5)
      expect(frameGroup).toBeDefined()
      const innerTexts = collectTexts(frameGroup!.children)
      expect(innerTexts.some(t => t.text === 'Inside')).toBe(true)
    })

    it('Frame要素の任意角回転がRenderGroupに反映される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 60,
            elements: [
              {
                type: 'frame',
                x: 10,
                y: 10,
                width: 40,
                height: 20,
                rotation: 30,
                rotationOriginX: 0,
                rotationOriginY: 10,
                elements: [
                  { type: 'staticText', x: 0, y: 0, width: 40, height: 12, text: 'Tilted' },
                ],
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const groups = collectGroups(doc.pages[0]!.children)
      const frameGroup = groups.find(g => g.x === 10 && g.y === 10 && g.width === 40 && g.height === 20)
      expect(frameGroup).toBeDefined()
      expect(frameGroup!.rotation).toBe(-30)
      expect(frameGroup!.rotationOriginX).toBe(0)
      expect(frameGroup!.rotationOriginY).toBe(10)
      const innerText = collectTexts(frameGroup!.children).find(t => t.text === 'Tilted')
      expect(innerText).toMatchObject({ x: 0, y: 0, width: 40 })
    })
  })

  describe('noData', () => {
    // Verifies the noData band is rendered when the data source has zero rows.
    it('データ0件でnoDataバンドが表示される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{ height: 20, elements: [] }],
          noData: {
            height: 40,
            elements: [
              { type: 'staticText', x: 0, y: 10, width: 500, height: 20, text: 'データがありません' },
            ],
          },
        },
      }
      const doc = createReport(template, { rows: [] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === 'データがありません')).toBe(true)
    })
  })

  describe('遅延評価', () => {
    // Verifies evaluationTime=report defers evaluation so TOTAL_PAGES resolves after pagination completes.
    it('evaluationTime=reportで総ページ数が評価される', () => {
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
      // 100pt page, header 20pt → effectively 80pt, detail 30pt → 2 rows/page
      // 5 rows → 3 pages
      const doc = createReport(template, { rows: [{}, {}, {}, {}, {}] })
      expect(doc.pages.length).toBe(3)

      // TOTAL_PAGES on every page resolves to 3
      for (const page of doc.pages) {
        const texts = collectTexts(page.children)
        expect(texts.some(t => t.text === '3')).toBe(true)
      }
    })
  })

  describe('パラメータ', () => {
    // Verifies parameters supplied via the data source are accessible in expressions.
    it('パラメータが式内で参照できる', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        parameters: [{ name: 'title', type: 'string', defaultValue: 'Default' }],
        bands: {
          title: {
            height: 30,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 200, height: 30, expression: 'param.title' },
            ],
          },
          details: [{ height: 20, elements: [] }],
        },
      }
      const doc = createReport(template, {
        rows: [{}],
        parameters: { title: 'カスタムタイトル' },
      })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === 'カスタムタイトル')).toBe(true)
    })
  })

  describe('printWhenExpression', () => {
    // Verifies an element is hidden when printWhenExpression evaluates to false.
    it('条件falseで要素が非表示', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'show', type: 'boolean' }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Visible',
                printWhenExpression: 'field.show',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ show: false }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === 'Visible')).toBe(false)
    })

    // Verifies an element is shown when printWhenExpression evaluates to true.
    it('条件trueで要素が表示', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'show', type: 'boolean' }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Visible',
                printWhenExpression: 'field.show',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ show: true }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === 'Visible')).toBe(true)
    })

    // Verifies comparison and ternary operators work inside printWhenExpression.
    it('比較演算と三項演算を含む式で出し分けできる', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [
          { name: 'amount', type: 'number' },
          { name: 'code', type: 'string' },
        ],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'HIGH',
                printWhenExpression: 'field.amount >= 1000 && (field.code === "A" ? true : false)',
              },
            ],
          }],
        },
      }
      const hiddenDoc = createReport(template, { rows: [{ amount: 900, code: 'A' }] })
      const shownDoc = createReport(template, { rows: [{ amount: 1200, code: 'A' }] })
      expect(collectTexts(hiddenDoc.pages[0]!.children).some(t => t.text === 'HIGH')).toBe(false)
      expect(collectTexts(shownDoc.pages[0]!.children).some(t => t.text === 'HIGH')).toBe(true)
    })
  })

  describe('バンド描画順序', () => {
    // Verify that bands render in Title -> PageHeader -> ColumnHeader -> Detail order.
    // Marker texts are placed in each band.
    // Their ascending Y coordinates are checked.
    // The assertions use those coordinates to confirm the draw order.
    const bandOrderTemplate: ReportTemplate = {
      page: {
        size: 'A4',
        orientation: 'portrait',
        margins: { top: 30, bottom: 30, left: 20, right: 20 },
      },
      bands: {
        title: {
          height: 40,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'TITLE_BAND' },
          ],
        },
        pageHeader: {
          height: 25,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'PAGE_HEADER' },
          ],
        },
        columnHeader: {
          height: 20,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'COL_HEADER' },
          ],
        },
        details: [{
          height: 20,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: "field.v" },
          ],
        }],
        pageFooter: {
          height: 20,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'PAGE_FOOTER' },
          ],
        },
      },
    }

    /** Returns the first text of a band group */
    function bandText(group: RenderGroup): string {
      const texts = collectTexts(group.children)
      return texts[0]?.text ?? ''
    }

    // Verifies band render order on page 1: Title → PageHeader → ColumnHeader → Detail.
    it('1ページ目: Title → PageHeader → ColumnHeader → Detail の順', () => {
      const doc = createReport(bandOrderTemplate, { rows: [{ v: 'ROW1' }] })
      const page = doc.pages[0]!
      const bands = page.children.filter(n => n.type === 'group') as RenderGroup[]

      // Extract each band's text and confirm the ordering
      const bandLabels = bands.map(b => bandText(b)).filter(t => t !== '')
      const titleIdx = bandLabels.indexOf('TITLE_BAND')
      const phIdx = bandLabels.indexOf('PAGE_HEADER')
      const chIdx = bandLabels.indexOf('COL_HEADER')
      const detailIdx = bandLabels.indexOf('ROW1')

      expect(titleIdx).toBeGreaterThanOrEqual(0)
      expect(phIdx).toBeGreaterThanOrEqual(0)
      expect(chIdx).toBeGreaterThanOrEqual(0)
      expect(detailIdx).toBeGreaterThanOrEqual(0)

      // Order: Title < PageHeader < ColumnHeader < Detail
      expect(titleIdx).toBeLessThan(phIdx)
      expect(phIdx).toBeLessThan(chIdx)
      expect(chIdx).toBeLessThan(detailIdx)
    })

    // Verifies Y coordinates increase in band order on page 1.
    it('1ページ目: Title の Y < PageHeader の Y < ColumnHeader の Y', () => {
      const doc = createReport(bandOrderTemplate, { rows: [{ v: 'ROW1' }] })
      const page = doc.pages[0]!
      const bands = page.children.filter(n => n.type === 'group') as RenderGroup[]

      const titleBand = bands.find(b => bandText(b) === 'TITLE_BAND')!
      const phBand = bands.find(b => bandText(b) === 'PAGE_HEADER')!
      const chBand = bands.find(b => bandText(b) === 'COL_HEADER')!
      const detailBand = bands.find(b => bandText(b) === 'ROW1')!

      expect(titleBand.y).toBeLessThan(phBand.y)
      expect(phBand.y).toBeLessThan(chBand.y)
      expect(chBand.y).toBeLessThan(detailBand.y)
    })

    // Verifies page 2 has no Title band and keeps the PageHeader → ColumnHeader → Detail order.
    it('2ページ目: Title なし、PageHeader → ColumnHeader → Detail の順', () => {
      // Force a second page with many rows
      const rows = Array.from({ length: 50 }, (_, i) => ({ v: `R${i}` }))
      const doc = createReport(bandOrderTemplate, { rows })
      expect(doc.pages.length).toBeGreaterThanOrEqual(2)

      const page2 = doc.pages[1]!
      const bands = page2.children.filter(n => n.type === 'group') as RenderGroup[]
      const bandLabels = bands.map(b => bandText(b)).filter(t => t !== '')

      // Page 2 must not contain the Title band
      expect(bandLabels.includes('TITLE_BAND')).toBe(false)

      // PageHeader comes before ColumnHeader
      const phIdx = bandLabels.indexOf('PAGE_HEADER')
      const chIdx = bandLabels.indexOf('COL_HEADER')
      expect(phIdx).toBeGreaterThanOrEqual(0)
      expect(chIdx).toBeGreaterThanOrEqual(0)
      expect(phIdx).toBeLessThan(chIdx)
    })

    // Verifies the PageHeader is still rendered before the NoData band when there are no rows.
    it('noData 時も PageHeader が描画される', () => {
      const templateWithNoData: ReportTemplate = {
        ...bandOrderTemplate,
        bands: {
          ...bandOrderTemplate.bands,
          noData: {
            height: 30,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'NO_DATA' },
            ],
          },
        },
      }
      const doc = createReport(templateWithNoData, { rows: [] })
      const page = doc.pages[0]!
      const texts = collectTexts(page.children)

      expect(texts.some(t => t.text === 'PAGE_HEADER')).toBe(true)
      expect(texts.some(t => t.text === 'NO_DATA')).toBe(true)

      // PageHeader is drawn before NoData
      const bands = page.children.filter(n => n.type === 'group') as RenderGroup[]
      const bandLabels = bands.map(b => bandText(b)).filter(t => t !== '')
      const phIdx = bandLabels.indexOf('PAGE_HEADER')
      const ndIdx = bandLabels.indexOf('NO_DATA')
      expect(phIdx).toBeLessThan(ndIdx)
    })
  })

  describe('カスタムフォーマッター', () => {
    // Verifies a custom formatter registered in template.formatters is applied via pattern.
    it('pattern でカスタムフォーマッターが適用される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        formatters: {
          currency: (v) => `¥${Number(v).toLocaleString()}`,
        },
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.price', pattern: 'currency' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ price: 50000 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '¥50,000')).toBe(true)
    })

    // Verifies a pattern with no matching custom formatter falls back to the built-in format engine.
    it('pattern が組み込みフォーマットにフォールバックする', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        formatters: {
          currency: (v) => `¥${Number(v).toLocaleString()}`,
        },
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.amount', pattern: '#,##0' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ amount: 99999 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '99,999')).toBe(true)
    })
  })

  describe('コールバック式', () => {
    // Verifies a callback function can be used as a TextField expression.
    it('コールバック式がTextFieldに使える', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 200, height: 20,
                expression: (f: any) => `${f.name} (${f.age}才)`,
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ name: '田中', age: 30 }] })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === '田中 (30才)')).toBe(true)
    })

    // Verifies a callback function can be used as a group break expression.
    it('コールバック式がグループに使える', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        groups: [{
          name: 'dept',
          expression: (f: any) => f.dept,
          header: {
            height: 20,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: 'field.dept' },
            ],
          },
        }],
        bands: {
          details: [{ height: 20, elements: [] }],
        },
      }
      const doc = createReport(template, {
        rows: [{ dept: 'A' }, { dept: 'A' }, { dept: 'B' }],
      })
      const texts = collectTexts(doc.pages[0]!.children)
      expect(texts.some(t => t.text === 'A')).toBe(true)
      expect(texts.some(t => t.text === 'B')).toBe(true)
    })

    // Verifies a callback function can be used as printWhenExpression.
    it('コールバック式がprintWhenExpressionに使える', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Visible',
                printWhenExpression: (f: any) => f.show === true,
              },
            ],
          }],
        },
      }
      // show=true → visible
      const doc1 = createReport(template, { rows: [{ show: true }] })
      expect(collectTexts(doc1.pages[0]!.children).some(t => t.text === 'Visible')).toBe(true)
      // show=false → hidden
      const doc2 = createReport(template, { rows: [{ show: false }] })
      expect(collectTexts(doc2.pages[0]!.children).some(t => t.text === 'Visible')).toBe(false)
    })
  })
})
