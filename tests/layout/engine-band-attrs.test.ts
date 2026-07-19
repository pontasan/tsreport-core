import { describe, it, expect } from 'vitest'
import { createReport as createReportCore } from '../../src/layout/engine.js'
import type { CreateReportOptions, SubreportTemplateResolver } from '../../src/layout/engine.js'
import type { ReportTemplate, SubreportDef, DataSource } from '../../src/types/template.js'
import type { RenderNode } from '../../src/types/render.js'

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

interface PositionedText { text: string; y: number; x: number }

function collectPositioned(nodes: RenderNode[], out: PositionedText[], offX = 0, offY = 0): void {
  for (const node of nodes) {
    if (node.type === 'text') out.push({ text: node.text, x: offX + node.x, y: offY + node.y })
    if (node.type === 'group') collectPositioned(node.children, out, offX + node.x, offY + node.y)
  }
}

function pageTexts(doc: { pages: { children: RenderNode[] }[] }, page: number): PositionedText[] {
  const out: PositionedText[] = []
  collectPositioned(doc.pages[page]!.children, out)
  return out
}

describe('isPrintWhenDetailOverflows', () => {
  it('stretch 分割の継続セグメント先頭に要素が再印字され、継続コンテンツがその下に流れる', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 150,
          splitType: 'stretch',
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'LABEL', isPrintWhenDetailOverflows: true },
            { type: 'staticText', x: 0, y: 30, width: 100, height: 20, text: 'A' },
            { type: 'staticText', x: 0, y: 120, width: 100, height: 20, text: 'B' },
          ],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    expect(doc.pages.length).toBe(2)

    const p1 = pageTexts(doc, 0)
    expect(p1.find(t => t.text === 'LABEL')!.y).toBe(0)
    expect(p1.find(t => t.text === 'A')!.y).toBe(30)

    // Page 2: LABEL reprinted at the segment top, continued content below it.
    const p2 = pageTexts(doc, 1)
    expect(p2.find(t => t.text === 'LABEL')!.y).toBe(0)
    expect(p2.find(t => t.text === 'B')!.y).toBe(20)
  })

  it('immediate 分割の継続セグメントでも再印字される', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 150,
          splitType: 'immediate',
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'LABEL', isPrintWhenDetailOverflows: true },
            { type: 'staticText', x: 0, y: 30, width: 100, height: 20, text: 'A' },
            { type: 'staticText', x: 0, y: 120, width: 100, height: 20, text: 'B' },
          ],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    expect(doc.pages.length).toBe(2)

    const p2 = pageTexts(doc, 1)
    const label = p2.find(t => t.text === 'LABEL')!
    const b = p2.find(t => t.text === 'B')!
    expect(label.y).toBe(0)
    // Continued content flows below the reprinted region (LABEL bottom = 20).
    expect(b.y).toBeGreaterThanOrEqual(20)
  })
})

describe('floatColumnFooter', () => {
  it('columnFooter がコンテンツ直下に配置される（ページ下部固定ではなく）', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      floatColumnFooter: true,
      bands: {
        details: [{
          height: 30,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.v' }],
        }],
        columnFooter: {
          height: 20,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'CF' }],
        },
      },
    }
    const doc = createReport(template, { rows: [{ v: 'r1' }, { v: 'r2' }] })
    const texts = pageTexts(doc, 0)
    expect(texts.find(t => t.text === 'CF')!.y).toBe(60)
  })

  it('floatColumnFooter なしでは従来どおり下部固定', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.v' }],
        }],
        columnFooter: {
          height: 20,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'CF' }],
        },
      },
    }
    const doc = createReport(template, { rows: [{ v: 'r1' }, { v: 'r2' }] })
    const texts = pageTexts(doc, 0)
    expect(texts.find(t => t.text === 'CF')!.y).toBe(180)
  })
})

describe('subreport 追加属性', () => {
  const childTemplate: ReportTemplate = {
    page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: {
      details: [{
        height: 20,
        elements: [{ type: 'textField', x: 0, y: 0, width: 150, height: 20, expression: '`S${field.n}`' }],
      }],
    },
  }

  const paramChildTemplate: ReportTemplate = {
    page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: {
      details: [{
        height: 20,
        elements: [{ type: 'textField', x: 0, y: 0, width: 150, height: 20, expression: '`${param.prefix}${field.n}`' }],
      }],
    },
  }

  it('runToBottom でサブレポート後の要素が次ページへ送られる', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [
          {
            height: 20,
            elements: [{
              type: 'subreport', x: 0, y: 0, width: 200, height: 20,
              templateExpression: "'sub1'",
              dataSourceExpression: 'field.items',
              runToBottom: true,
            } as SubreportDef],
          },
          {
            height: 20,
            elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'AFTER' }],
          },
        ],
      },
    }
    const doc = createReport(template, {
      rows: [{ items: [{ n: 1 }, { n: 2 }] }],
      subreportTemplates: { sub1: childTemplate },
    })
    // The subreport consumed the rest of the page: AFTER starts on page 2.
    expect(doc.pages.length).toBe(2)
    expect(pageTexts(doc, 1).some(t => t.text === 'AFTER')).toBe(true)
    expect(pageTexts(doc, 0).some(t => t.text === 'AFTER')).toBe(false)
  })

  it('parametersMapExpression のエントリが子パラメータへ渡り、個別 parameters が優先される', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'subreport', x: 0, y: 0, width: 200, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
            parametersMapExpression: 'field.paramMap',
          } as SubreportDef],
        }],
      },
    }
    const doc = createReport(template, {
      rows: [{ items: [{ n: 7 }], paramMap: { prefix: 'P-' } }],
      subreportTemplates: { sub1: paramChildTemplate },
    })
    expect(pageTexts(doc, 0).some(t => t.text === 'P-7')).toBe(true)

    // Individual parameters override map entries.
    const template2: ReportTemplate = {
      ...template,
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'subreport', x: 0, y: 0, width: 200, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
            parametersMapExpression: 'field.paramMap',
            parameters: [{ name: 'prefix', expression: "'Q-'" }],
          } as SubreportDef],
        }],
      },
    }
    const doc2 = createReport(template2, {
      rows: [{ items: [{ n: 7 }], paramMap: { prefix: 'P-' } }],
      subreportTemplates: { sub1: paramChildTemplate },
    })
    expect(pageTexts(doc2, 0).some(t => t.text === 'Q-7')).toBe(true)
  })
})
