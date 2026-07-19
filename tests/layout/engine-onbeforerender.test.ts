import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource, ElementDef, StaticTextDef } from '../../src/types/template.js'
import type { RenderNode, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

/** Recursively collect all text nodes on a page */
function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

/** Build an A4, zero-margin template with a single detail band */
function makeTemplate(elements: ElementDef[]): ReportTemplate {
  return {
    page: { size: 'A4', orientation: 'portrait', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: {
      details: [{ height: 30, elements }],
    },
  }
}

// ─── Tests ───

// onBeforeRender element hook: skip rendering (null), override attributes, and interact with printWhenExpression.
describe('onBeforeRender', () => {
  describe('条件描画（null 返却）', () => {
    // Verifies that returning null from onBeforeRender suppresses the element.
    it('null を返すと要素が描画されない', () => {
      const template = makeTemplate([
        {
          type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'SKIPPED',
          onBeforeRender: () => null,
        },
        { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'RENDERED' },
      ])
      const doc = createReport(template, { rows: [{}] })
      const texts = collectTexts(doc.pages[0]!.children).map(t => t.text)

      expect(texts).not.toContain('SKIPPED')
      expect(texts).toContain('RENDERED')
    })

    // Verifies that per-row skipping works by inspecting field values in the callback.
    it('field を参照して行ごとに描画をスキップできる（printWhenExpression の上位互換）', () => {
      const template = makeTemplate([
        {
          type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'VISIBLE',
          onBeforeRender: (elem, field) => (field.hide ? null : elem),
        },
      ])
      const data: DataSource = { rows: [{ hide: false }, { hide: true }, { hide: false }] }
      const doc = createReport(template, data)
      const texts = collectTexts(doc.pages[0]!.children).filter(t => t.text === 'VISIBLE')

      expect(texts.length).toBe(2)
    })
  })

  describe('属性の動的上書き（ElementDef 返却）', () => {
    // Verifies that a returned override replaces the rendered text without mutating the template definition.
    it('staticText の text が上書きされて描画される', () => {
      const original: StaticTextDef = {
        type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'ORIGINAL',
        onBeforeRender: (elem) => ({ ...(elem as StaticTextDef), text: 'OVERRIDDEN' }),
      }
      const doc = createReport(makeTemplate([original]), { rows: [{}] })
      const texts = collectTexts(doc.pages[0]!.children).map(t => t.text)

      expect(texts).toContain('OVERRIDDEN')
      expect(texts).not.toContain('ORIGINAL')
      // The template definition itself is unchanged (the override applies only at render time)
      expect(original.text).toBe('ORIGINAL')
    })

    // Verifies that the callback receives the original element definition as its first argument.
    it('コールバックの第1引数には元の要素定義が渡される', () => {
      let received: ElementDef | null = null
      const original: StaticTextDef = {
        type: 'staticText', x: 5, y: 0, width: 200, height: 20, text: 'A',
        onBeforeRender: (elem) => {
          received = elem
          return elem
        },
      }
      createReport(makeTemplate([original]), { rows: [{}] })

      expect(received).toBe(original)
    })

    // Verifies that forecolor / width / x overrides are reflected in the render output.
    it('forecolor / width / x の上書きが出力に反映される', () => {
      const template = makeTemplate([
        {
          type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'STYLED',
          onBeforeRender: (elem) => ({ ...(elem as StaticTextDef), x: 50, width: 200, forecolor: '#FF0000' }),
        },
      ])
      const doc = createReport(template, { rows: [{}] })
      const text = collectTexts(doc.pages[0]!.children).find(t => t.text === 'STYLED')!

      expect(text).toBeDefined()
      expect(text.color).toBe('#FF0000')
      expect(text.x).toBe(50)
      expect(text.width).toBe(200)
    })
  })

  describe('式評価コンテキストへのアクセス', () => {
    // Verifies that field values enable per-row overrides (only negative amounts are colored red).
    it('field を参照して行ごとに異なる上書きができる（マイナス金額の行だけ赤色）', () => {
      const template = makeTemplate([
        {
          type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: 'field.amount',
          onBeforeRender: (elem, field) =>
            (field.amount as number) < 0 ? { ...elem, forecolor: '#FF0000' } : elem,
        },
      ])
      const data: DataSource = { rows: [{ amount: 100 }, { amount: -50 }, { amount: 30 }] }
      const doc = createReport(template, data)
      const texts = collectTexts(doc.pages[0]!.children)

      const plus1 = texts.find(t => t.text === '100')!
      const minus = texts.find(t => t.text === '-50')!
      const plus2 = texts.find(t => t.text === '30')!
      expect(plus1.color).toBe('#000000')
      expect(minus.color).toBe('#FF0000')
      expect(plus2.color).toBe('#000000')
    })

    // Verifies that the callback can read vars, param, and report context values.
    it('vars / param / report にアクセスできる', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', orientation: 'portrait', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        variables: [
          { name: 'total', expression: 'field.amount', calculation: 'sum', initialValue: '0' },
        ],
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 300, height: 20, text: '',
                onBeforeRender: (elem, _field, vars, param, report) => ({
                  ...(elem as StaticTextDef),
                  text: `${param.label}:${vars.total}:page${report.PAGE_NUMBER}`,
                }),
              },
            ],
          }],
        },
      }
      const data: DataSource = {
        rows: [{ amount: 10 }, { amount: 25 }],
        parameters: { label: 'SUM' },
      }
      const doc = createReport(template, data)
      const texts = collectTexts(doc.pages[0]!.children).map(t => t.text)

      // Variables are calculated before the detail band renders, so running
      // totals include the current row:
      // row 1 renders with total=10, row 2 renders with total=35
      expect(texts).toContain('SUM:10:page1')
      expect(texts).toContain('SUM:35:page1')
    })
  })

  describe('printWhenExpression との評価順', () => {
    // Verifies that a printWhenExpression overridden by onBeforeRender is the one evaluated (falsy -> truthy).
    it('onBeforeRender で上書きされた printWhenExpression が評価される（falsy → truthy）', () => {
      // The original printWhenExpression is always false, but
      // onBeforeRender swaps in a truthy expression, so the element renders
      const template = makeTemplate([
        {
          type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'REVIVED',
          printWhenExpression: 'field.show',
          onBeforeRender: (elem) => ({ ...(elem as StaticTextDef), printWhenExpression: 'field.amount > 0' }),
        },
      ])
      const doc = createReport(template, { rows: [{ show: false, amount: 1 }] })
      const texts = collectTexts(doc.pages[0]!.children).map(t => t.text)

      expect(texts).toContain('REVIVED')
    })

    // Verifies that a printWhenExpression added by onBeforeRender can suppress rendering (truthy -> falsy).
    it('onBeforeRender で上書きされた printWhenExpression が評価される（truthy → falsy）', () => {
      // The original definition has no printWhenExpression, but
      // onBeforeRender sets a falsy expression, so the element is not rendered
      const template = makeTemplate([
        {
          type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'SUPPRESSED',
          onBeforeRender: (elem) => ({ ...(elem as StaticTextDef), printWhenExpression: 'field.show' }),
        },
        { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'CONTROL' },
      ])
      const doc = createReport(template, { rows: [{ show: false }] })
      const texts = collectTexts(doc.pages[0]!.children).map(t => t.text)

      expect(texts).not.toContain('SUPPRESSED')
      expect(texts).toContain('CONTROL')
    })
  })

  describe('未指定要素の従来挙動', () => {
    // Verifies that elements without onBeforeRender remain controlled solely by printWhenExpression.
    it('onBeforeRender 未指定の要素は従来通り printWhenExpression のみで制御される', () => {
      const template = makeTemplate([
        { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'SHOWN', printWhenExpression: 'field.show' },
        { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'HIDDEN', printWhenExpression: 'field.hide' },
      ])
      const doc = createReport(template, { rows: [{ show: true, hide: false }] })
      const texts = collectTexts(doc.pages[0]!.children).map(t => t.text)

      expect(texts).toContain('SHOWN')
      expect(texts).not.toContain('HIDDEN')
    })
  })
})
