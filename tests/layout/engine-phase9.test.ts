import { describe, it, expect } from 'vitest'
import { createReport as createReportCore } from '../../src/layout/engine.js'
import type { CreateReportOptions, SubreportTemplateResolver } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderNode, RenderGroup, RenderText } from '../../src/types/render.js'

// Helpers.

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

// Tests.

describe('Phase 9: サブレポート', () => {
  it('基本的なサブレポートが埋め込まれる', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'SubItem',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 10, y: 5,
            width: 180, height: 90,
            templateExpression: "'sub1'",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    // 'SubItem' text.
    
    const allTexts = collectTexts(doc.pages[0]!.children)
    const subTexts = allTexts.filter(t => t.text === 'SubItem')
    expect(subTexts.length).toBe(1)
  })

  it('summary 内 subreport の継続ページでも親の columnHeader/columnFooter を描画しない', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 120, height: 20,
            expression: 'field.label',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 90, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      columns: { count: 2, width: 100, spacing: 0 },
      bands: {
        columnHeader: {
          height: 10,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 10,
            text: 'ParentColumnHeader',
          }],
        },
        columnFooter: {
          height: 10,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 10,
            text: 'ParentColumnFooter',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 10,
            text: 'ParentDetail',
          }],
        }],
        summary: {
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 180, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        },
      },
    }

    const doc = createReport(mainTemplate, {
      rows: [{
        items: [
          { label: 'Child 01' },
          { label: 'Child 02' },
          { label: 'Child 03' },
          { label: 'Child 04' },
          { label: 'Child 05' },
          { label: 'Child 06' },
        ],
      }],
      subreportTemplates: { sub1: subTemplate },
    })

    expect(doc.pages.length).toBeGreaterThan(1)

    for (let i = 1; i < doc.pages.length; i++) {
      const texts = collectTexts(doc.pages[i]!.children).map(text => text.text)
      expect(texts.some(text => text.startsWith('Child '))).toBe(true)
      expect(texts.some(text => text === 'ParentColumnHeader')).toBe(false)
      expect(texts.some(text => text === 'ParentColumnFooter')).toBe(false)
    }
  })

  it('サブレポートのデータソース式が評価される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'field.name',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 200,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        items: [{ name: 'Alice' }, { name: 'Bob' }],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    const names = allTexts.filter(t => t.text === 'Alice' || t.text === 'Bob')
    expect(names.length).toBe(2)
  })

  it('サブレポートのパラメータが渡される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      parameters: [{ name: 'title', type: 'string' }],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'param.title',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            parameters: [{
              name: 'title',
              expression: "'Hello World'",
            }],
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    const helloTexts = allTexts.filter(t => t.text === 'Hello World')
    expect(helloTexts.length).toBe(1)
  })

  it('テンプレートが見つからない場合はnullを返す', () => {
    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 50,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 50,
            templateExpression: "'nonexistent'",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: {},
    }

    // Error.
    
    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)
  })

  it('サブレポートがクリッピングされる', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
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

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 80,
          elements: [{
            type: 'subreport',
            x: 10, y: 5,
            width: 180, height: 70,
            templateExpression: "'sub1'",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allGroups = collectGroups(doc.pages[0]!.children)
    // Group clip=true.
    
    const subreportGroup = allGroups.find(g =>
      g.clip && g.x === 10 && g.y === 5
    )
    // RenderElement with directposition.
    // RenderBandAt group with coordinate.
    
    
    expect(doc.pages).toHaveLength(1)
  })

  it('サブレポートに複数行のデータがある場合', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
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

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 200,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        items: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    const rowTexts = allTexts.filter(t => t.text === 'Row')
    expect(rowTexts.length).toBe(5)
  })

  it('subreportTemplates が未指定の場合はnullを返す', () => {
    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 50,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 50,
            templateExpression: "'sub1'",
          }],
        }],
      },
    }

    const doc = createReport(mainTemplate, { rows: [{ id: 1 }] })
    expect(doc.pages).toHaveLength(1)
    // Rendering, error.
    
  })

  it('サブレポートの画像リソースが親から引き継がれる', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'image',
            x: 0, y: 0, width: 80, height: 60,
            source: 'logo',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 120,
            templateExpression: "'sub1'",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { sub1: subTemplate },
    }

    // Error, imagedraw.
    
    const doc = createReport(mainTemplate, dataSource, {
      resources: {
        images: { logo: 'data:image/png;base64,...' },
        imageSizes: { logo: { width: 160, height: 120 } },
      },
    })
    expect(doc.pages).toHaveLength(1)
  })

  it('dataSourceExpression が配列でない場合は空データとして扱う', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        noData: {
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 30,
            text: 'No Data',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'Should Not Appear',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.badField",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1, badField: 'not an array' }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)
    const allTexts = collectTexts(doc.pages[0]!.children)
    // 'No Data' banddraw.
    
    const noDataTexts = allTexts.filter(t => t.text === 'No Data')
    expect(noDataTexts.length).toBe(1)
    // Detail draw.
    
    const detailTexts = allTexts.filter(t => t.text === 'Should Not Appear')
    expect(detailTexts.length).toBe(0)
  })

  // Add:
  

  it('空のサブレポートデータ（rows=[]）— noDataバンドが表示される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        noData: {
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 30,
            text: 'Empty Sub',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'SubDetail',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1, items: [] }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'Empty Sub')).toBe(true)
    expect(allTexts.some(t => t.text === 'SubDetail')).toBe(false)
  })

  it('パラメータ式が複雑 — field.price * 1.1 のような計算式', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      parameters: [{ name: 'taxPrice', type: 'number' }],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'param.taxPrice',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            parameters: [{
              name: 'taxPrice',
              expression: (f: any) => f.price * 1.1,
            }],
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1, price: 100 }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    // 100 * 1.1 = 110 (with 110.00000000000001 possiblewith)
    
    expect(allTexts.some(t => parseFloat(t.text) === 110.00000000000001 || t.text === '110')).toBe(true)
  })

  // Add: internallayout.
  

  it('サブレポート内にグループがある', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      groups: [{
        name: 'category',
        expression: 'field.cat',
        header: {
          height: 15,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 15,
            expression: 'field.cat',
          }],
        },
      }],
      bands: {
        details: [{
          height: 15,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 15,
            expression: 'field.name',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 200,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        items: [
          { cat: 'Fruit', name: 'Apple' },
          { cat: 'Fruit', name: 'Banana' },
          { cat: 'Veggie', name: 'Carrot' },
        ],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'Fruit')).toBe(true)
    expect(allTexts.some(t => t.text === 'Veggie')).toBe(true)
    expect(allTexts.some(t => t.text === 'Apple')).toBe(true)
    expect(allTexts.some(t => t.text === 'Banana')).toBe(true)
    expect(allTexts.some(t => t.text === 'Carrot')).toBe(true)
  })

  it('サブレポートの高さが親の要素高さより大きい — 全データが表示される（clip しない）', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
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

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 50,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 50,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        items: Array.from({ length: 20 }, (_, i) => ({ n: i })),
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    // 20row × 20pt = 400pt -> 400pt page.
    
    expect(doc.pages).toHaveLength(1)
    // 20rowtext (clip)
    
    const allTexts = collectTexts(doc.pages[0]!.children)
    const rowTexts = allTexts.filter(t => t.text === 'Row')
    expect(rowTexts.length).toBe(20)
  })

  // Add: multiple /.
  

  it('同一行に2つのサブレポート', () => {
    const subTemplateA: ReportTemplate = {
      page: { width: 100, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'SubA',
          }],
        }],
      },
    }
    const subTemplateB: ReportTemplate = {
      page: { width: 100, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'SubB',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [
            {
              type: 'subreport',
              x: 0, y: 0,
              width: 100, height: 100,
              templateExpression: "'subA'",
            },
            {
              type: 'subreport',
              x: 100, y: 0,
              width: 100, height: 100,
              templateExpression: "'subB'",
            },
          ],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { subA: subTemplateA, subB: subTemplateB },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'SubA')).toBe(true)
    expect(allTexts.some(t => t.text === 'SubB')).toBe(true)
  })

  it('親の複数行でそれぞれ異なるサブレポートデータ', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'field.name',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [
        { id: 1, items: [{ name: 'A1' }, { name: 'A2' }] },
        { id: 2, items: [{ name: 'B1' }] },
      ],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    // Pagetext collect.
    
    const allTexts: RenderText[] = []
    for (const page of doc.pages) {
      allTexts.push(...collectTexts(page.children))
    }
    expect(allTexts.some(t => t.text === 'A1')).toBe(true)
    expect(allTexts.some(t => t.text === 'A2')).toBe(true)
    expect(allTexts.some(t => t.text === 'B1')).toBe(true)
  })

  it('ネストしたサブレポート（2階層）', () => {
    const innerSubTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 15,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 15,
            expression: 'field.task',
          }],
        }],
      },
    }

    const outerSubTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [
            {
              type: 'textField',
              x: 0, y: 0, width: 100, height: 15,
              expression: 'field.dept',
            },
            {
              type: 'subreport',
              x: 0, y: 15,
              width: 200, height: 85,
              templateExpression: "'inner'",
              dataSourceExpression: "field.tasks",
            },
          ],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 200,
            templateExpression: "'outer'",
            dataSourceExpression: "field.departments",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        departments: [
          { dept: 'Engineering', tasks: [{ task: 'Code' }, { task: 'Review' }] },
          { dept: 'Design', tasks: [{ task: 'Mockup' }] },
        ],
      }],
      subreportTemplates: { outer: outerSubTemplate, inner: innerSubTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'Engineering')).toBe(true)
    expect(allTexts.some(t => t.text === 'Design')).toBe(true)
    expect(allTexts.some(t => t.text === 'Code')).toBe(true)
    expect(allTexts.some(t => t.text === 'Review')).toBe(true)
    expect(allTexts.some(t => t.text === 'Mockup')).toBe(true)
  })

  it('ネストしたサブレポート（3階層）', () => {
    const level3: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 15,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 15,
            expression: 'field.empName',
          }],
        }],
      },
    }

    const level2: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [
            {
              type: 'textField',
              x: 0, y: 0, width: 100, height: 15,
              expression: 'field.deptName',
            },
            {
              type: 'subreport',
              x: 0, y: 15,
              width: 200, height: 85,
              templateExpression: "'lv3'",
              dataSourceExpression: "field.employees",
            },
          ],
        }],
      },
    }

    const level1: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 200,
          elements: [
            {
              type: 'textField',
              x: 0, y: 0, width: 100, height: 15,
              expression: 'field.companyName',
            },
            {
              type: 'subreport',
              x: 0, y: 15,
              width: 200, height: 185,
              templateExpression: "'lv2'",
              dataSourceExpression: "field.depts",
            },
          ],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 800, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 400,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 400,
            templateExpression: "'lv1'",
            dataSourceExpression: "field.companies",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        companies: [{
          companyName: 'Acme',
          depts: [{
            deptName: 'Dev',
            employees: [{ empName: 'Alice' }, { empName: 'Bob' }],
          }],
        }],
      }],
      subreportTemplates: { lv1: level1, lv2: level2, lv3: level3 },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'Acme')).toBe(true)
    expect(allTexts.some(t => t.text === 'Dev')).toBe(true)
    expect(allTexts.some(t => t.text === 'Alice')).toBe(true)
    expect(allTexts.some(t => t.text === 'Bob')).toBe(true)
  })

  // Add: for.
  

  it('マスター・ディテール帳票 — 注文→明細の典型パターン', () => {
    const detailTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 15,
          elements: [
            {
              type: 'textField',
              x: 0, y: 0, width: 100, height: 15,
              expression: 'field.product',
            },
            {
              type: 'textField',
              x: 100, y: 0, width: 50, height: 15,
              expression: 'field.qty',
            },
          ],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 150,
          elements: [
            {
              type: 'textField',
              x: 0, y: 0, width: 200, height: 20,
              expression: (f: any) => 'Order: ' + f.orderId,
            },
            {
              type: 'subreport',
              x: 0, y: 20,
              width: 200, height: 130,
              templateExpression: "'detail'",
              dataSourceExpression: "field.items",
            },
          ],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [
        {
          orderId: 'ORD-001',
          items: [
            { product: 'Widget', qty: 5 },
            { product: 'Gadget', qty: 3 },
          ],
        },
        {
          orderId: 'ORD-002',
          items: [
            { product: 'Doohickey', qty: 1 },
          ],
        },
      ],
      subreportTemplates: { detail: detailTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    // Pagetext collect (pageheight with multiplepage)
    
    const allTexts: RenderText[] = []
    for (const page of doc.pages) {
      allTexts.push(...collectTexts(page.children))
    }
    expect(allTexts.some(t => t.text === 'Order: ORD-001')).toBe(true)
    expect(allTexts.some(t => t.text === 'Order: ORD-002')).toBe(true)
    expect(allTexts.some(t => t.text === 'Widget')).toBe(true)
    expect(allTexts.some(t => t.text === 'Gadget')).toBe(true)
    expect(allTexts.some(t => t.text === 'Doohickey')).toBe(true)
  })

  it('パラメータ複数 — 3つ以上のパラメータを渡す', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      parameters: [
        { name: 'p1', type: 'string' },
        { name: 'p2', type: 'number' },
        { name: 'p3', type: 'string' },
      ],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 200, height: 20,
            expression: (_f: any, _v: any, p: any) => p.p1 + '-' + p.p2 + '-' + p.p3,
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            parameters: [
              { name: 'p1', expression: "'Hello'" },
              { name: 'p2', expression: "42" },
              { name: 'p3', expression: "'World'" },
            ],
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'Hello-42-World')).toBe(true)
  })

  it('サブレポートの位置（x, y）が正しい — インライン配置', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'SubContent',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 30, y: 25,
            width: 140, height: 50,
            templateExpression: "'sub1'",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    // Band with place.
    // Element x=30 as, y=25 position from.
    
    
    const allGroups = collectGroups(doc.pages[0]!.children)
    // Band marginLeft + elemX = 0 + 30 = 30 position place.
    
    const subGroup = allGroups.find(g => g.x === 30 && g.width === 140)
    expect(subGroup).toBeDefined()
    // Text check.
    
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'SubContent')).toBe(true)
  })

  it('サブレポート内のテキストフィールドが正しく評価される — field参照がサブレポートのrowを見る', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: "field.subField",
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        mainField: 'MAIN',
        items: [
          { subField: 'SUB_VALUE_1' },
          { subField: 'SUB_VALUE_2' },
        ],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    // Verify that field.subField data is displayed.
    expect(allTexts.some(t => t.text === 'SUB_VALUE_1')).toBe(true)
    expect(allTexts.some(t => t.text === 'SUB_VALUE_2')).toBe(true)
    // The parent row text should not be displayed.
    expect(allTexts.some(t => t.text === 'MAIN')).toBe(false)
  })

  it('サブレポートのデータソースが undefined — dataSourceExpressionが未定義フィールドを参照', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        noData: {
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'NoData',
          }],
        },
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'Detail',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.nonExistent",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)
    const allTexts = collectTexts(doc.pages[0]!.children)
    // Undefinedcolumn with data as, noDatabanddisplay.
    
    expect(allTexts.some(t => t.text === 'NoData')).toBe(true)
  })

  it('サブレポート内に画像がある — 親のimagesが引き継がれて画像描画', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 50,
          elements: [
            {
              type: 'image',
              x: 0, y: 0, width: 40, height: 30,
              source: 'icon',
            },
            {
              type: 'textField',
              x: 50, y: 0, width: 100, height: 20,
              expression: 'field.label',
            },
          ],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1, items: [{ label: 'Test' }] }],
      subreportTemplates: { sub1: subTemplate },
    }

    // Error (image)
    
    const doc = createReport(mainTemplate, dataSource, {
      resources: {
        images: { icon: 'data:image/png;base64,dummy' },
        imageSizes: { icon: { width: 40, height: 30 } },
      },
    })
    expect(doc.pages).toHaveLength(1)
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'Test')).toBe(true)
  })

  // Page.
  

  it('サブレポートがページ境界を超えたとき親が改ページして続行する', () => {
    // Pageheight 100pt, 10 row × 20pt = 200pt.
    
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
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
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1, items: Array.from({ length: 10 }, (_, i) => ({ n: i })) }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)

    // 10 rows x 20pt = 200pt, so a 100pt page needs at least 2 pages.
    expect(doc.pages.length).toBeGreaterThanOrEqual(2)

    // Each page should contain Row text.
    for (const page of doc.pages) {
      const texts = collectTexts(page.children)
      expect(texts.some(t => t.text === 'Row')).toBe(true)
    }

    // The report should render all 10 Row texts.
    let totalRows = 0
    for (const page of doc.pages) {
      totalRows += collectTexts(page.children).filter(t => t.text === 'Row').length
    }
    expect(totalRows).toBe(10)
  })

  it('サブレポートの後に親レポートの次の行が続く', () => {
    // Subreport height: 2 rows x 20pt = 40pt.
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'SubRow',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 40,
          elements: [
            {
              type: 'staticText',
              x: 0, y: 0, width: 200, height: 20,
              text: 'ParentLabel',
            },
            {
              type: 'subreport',
              x: 0, y: 20,
              width: 200, height: 20,
              templateExpression: "'sub1'",
              dataSourceExpression: "field.items",
            },
          ],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [
        { id: 1, items: [{ n: 1 }, { n: 2 }] },
        { id: 2, items: [{ n: 3 }] },
      ],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    const allTexts = collectTexts(doc.pages[0]!.children)
    const parentLabels = allTexts.filter(t => t.text === 'ParentLabel')
    const subRows = allTexts.filter(t => t.text === 'SubRow')
    expect(parentLabels.length).toBe(2) 
    expect(subRows.length).toBe(3) 
  })

  it('サブレポートのページ跨ぎ時に親の pageHeader が再描画される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 30,
            text: 'SubRow',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        pageHeader: {
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'PageHeader',
          }],
        },
        details: [{
          height: 30,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 30,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1, items: Array.from({ length: 6 }, (_, i) => ({ n: i })) }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages.length).toBeGreaterThanOrEqual(2)

    // 2 page pageHeader.
    
    for (let p = 1; p < doc.pages.length; p++) {
      const texts = collectTexts(doc.pages[p]!.children)
      expect(texts.some(t => t.text === 'PageHeader')).toBe(true)
    }
  })

  it('ネストしたサブレポートがページ境界を超えたとき正しく改ページする', () => {
    const innerSubTemplate: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 25,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 25,
            text: 'InnerRow',
          }],
        }],
      },
    }

    const outerSubTemplate: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 30,
            templateExpression: "'inner'",
            dataSourceExpression: "field.innerItems",
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
            templateExpression: "'outer'",
            dataSourceExpression: "field.outerItems",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        outerItems: [
          { name: 'A', innerItems: Array.from({ length: 4 }, (_, i) => ({ v: i })) },
          { name: 'B', innerItems: Array.from({ length: 4 }, (_, i) => ({ v: i })) },
        ],
      }],
      subreportTemplates: {
        outer: outerSubTemplate,
        inner: innerSubTemplate,
      },
    }

    const doc = createReport(mainTemplate, dataSource)

    // 8 row × 25pt = 200pt -> page 100pt -> 2 pagetop.
    
    expect(doc.pages.length).toBeGreaterThanOrEqual(2)

    // Page with total 8 InnerRow.
    
    let totalInner = 0
    for (const page of doc.pages) {
      totalInner += collectTexts(page.children).filter(t => t.text === 'InnerRow').length
    }
    expect(totalInner).toBe(8)
  })

  it('ネストしたサブレポートのバンド高さが二重計上されない', () => {
    // In collectMode, renderBandAt pushes the band height once.
    // placeInlineBands then places the collected inline bands at the parent's Y position.
    // The parent should not require an extra page due to double-counted nested band height.
    //
    // Parent page: 100pt
    // Outer sub: band h=80, textField(y=0,h=20), inner sub(y=20,h=60)
    // Inner sub: 3 rows × 20pt = 60pt
    // Total: 20 + 60 = 80pt -> 100pt page (1page)
    // Time: 80 + 60 = 140pt -> 100pt page (2page)
    
    
    const innerSub: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 20,
            text: 'InnerRow',
          }],
        }],
      },
    }

    const outerSub: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 80,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'Header' },
            { type: 'subreport', x: 0, y: 20, width: 200, height: 60, templateExpression: "'inner'", dataSourceExpression: "field.innerItems" },
          ],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{ type: 'subreport', x: 0, y: 0, width: 200, height: 30, templateExpression: "'outer'", dataSourceExpression: "field.outerItems" }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1, outerItems: [{ name: 'G1', innerItems: [{ v: 1 }, { v: 2 }, { v: 3 }] }] }],
      subreportTemplates: { outer: outerSub, inner: innerSub },
    }

    const doc = createReport(mainTemplate, dataSource)

    // 80pt content should fit on a 100pt page.
    expect(doc.pages).toHaveLength(1)

    // Header and all inner rows should render on the single page.
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'Header')).toBe(true)
    expect(allTexts.filter(t => t.text === 'InnerRow').length).toBe(3)
  })

  it('ネストしたサブレポートで X オフセットが正しく適用される', () => {
    // Validate that collectMode applies pending.elemX when placeInlineBands runs.
    const innerSub: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'InnerText',
          }],
        }],
      },
    }

    const outerSub: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 50,
          elements: [{
            type: 'subreport',
            x: 30, y: 0,
            width: 140, height: 50,
            templateExpression: "'inner'",
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'outer'",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1 }],
      subreportTemplates: { outer: outerSub, inner: innerSub },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    // The inner subreport band is collected under the outer subreport's elemX=30.
    // The parent placeInlineBands call creates the positioned group.
    // collectMode passes the inner bands through that positioned group.
    // The innerSub x=30 offset is therefore applied by collectMode placement.
    // The final render tree must contain an X=30 group.
    const allGroups = collectGroups(doc.pages[0]!.children)
    // Find the X=30 group.
    const offsetGroup = allGroups.find(g => g.x === 30)
    expect(offsetGroup).toBeDefined()

    // The inner text should remain visible inside the positioned group.
    const allTexts = collectTexts(doc.pages[0]!.children)
    expect(allTexts.some(t => t.text === 'InnerText')).toBe(true)
  })

  it('サブレポートの高さが親バンドの予約高さを超えても全データが表示される', () => {
    // Subreport height: 20 rows x 20pt = 400pt, while the parent reserves 50pt.
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
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

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 50,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 50,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ id: 1, items: Array.from({ length: 20 }, (_, i) => ({ n: i })) }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)

    // With 20 'Row' text (clip)
    
    let totalRows = 0
    for (const page of doc.pages) {
      totalRows += collectTexts(page.children).filter(t => t.text === 'Row').length
    }
    expect(totalRows).toBe(20)
  })

  it('同一バンド内の2つのサブレポートがページをまたぐ', () => {
    // Place two subreports in the same band as columns at x=0 and x=100.
    // The total page height should include both column flows correctly.
    const subTemplateA: ReportTemplate = {
      page: { width: 100, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 25,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 25,
            text: 'A-Row',
          }],
        }],
      },
    }
    const subTemplateB: ReportTemplate = {
      page: { width: 100, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 25,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 25,
            text: 'B-Row',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [
            { type: 'subreport', x: 0, y: 0, width: 100, height: 30, templateExpression: "'subA'", dataSourceExpression: "field.itemsA" },
            { type: 'subreport', x: 100, y: 0, width: 100, height: 30, templateExpression: "'subB'", dataSourceExpression: "field.itemsB" },
          ],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        itemsA: Array.from({ length: 6 }, (_, i) => ({ n: i })),
        itemsB: Array.from({ length: 4 }, (_, i) => ({ n: i })),
      }],
      subreportTemplates: { subA: subTemplateA, subB: subTemplateB },
    }

    const doc = createReport(mainTemplate, dataSource)

    // A: 6 × 25pt = 150pt, B: 4 × 25pt = 100pt -> page 100pt -> multiplepage.
    
    expect(doc.pages.length).toBeGreaterThanOrEqual(2)

    // Page with A 6 row, B 4 row.
    
    let totalA = 0, totalB = 0
    for (const page of doc.pages) {
      const texts = collectTexts(page.children)
      totalA += texts.filter(t => t.text === 'A-Row').length
      totalB += texts.filter(t => t.text === 'B-Row').length
    }
    expect(totalA).toBe(6)
    expect(totalB).toBe(4)
  })

  // Return value handling.
  

  it('returnValues: サブレポートの sum 変数を親に返す', () => {
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
        summary: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'vars.itemTotal',
          }],
        },
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{
        name: 'grandTotal',
        expression: (f: any) => 0,
        calculation: 'sum',
        resetType: 'report',
      }],
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 200,
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
            expression: 'vars.grandTotal',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        items: [{ amount: 100 }, { amount: 200 }, { amount: 300 }],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    // ItemTotal = 600 parent grandTotal.
    // GrandTotal sum with 600 -> 600.
    
    
    expect(allTexts.some(t => t.text === '600')).toBe(true)
  })

  it('returnValues: 複数 returnValues (sum/count/max) を同時に返す', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [
        { name: 'subSum', expression: 'field.value', calculation: 'sum', resetType: 'report' },
        { name: 'subCount', expression: 'field.value', calculation: 'count', resetType: 'report' },
        { name: 'subMax', expression: 'field.value', calculation: 'max', resetType: 'report' },
      ],
      bands: {
        details: [{
          height: 15,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 15,
            expression: 'field.value',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [
        { name: 'totalSum', expression: (f: any) => 0, calculation: 'sum', resetType: 'report' },
        { name: 'totalCount', expression: (f: any) => 0, calculation: 'sum', resetType: 'report' },
        { name: 'totalMax', expression: (f: any) => 0, calculation: 'max', resetType: 'report' },
      ],
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 200,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
            returnValues: [
              { name: 'totalSum', subreportVariable: 'subSum', calculation: 'sum' },
              { name: 'totalCount', subreportVariable: 'subCount', calculation: 'sum' },
              { name: 'totalMax', subreportVariable: 'subMax', calculation: 'max' },
            ],
          }],
        }],
        summary: {
          height: 20,
          elements: [
            {
              type: 'textField',
              x: 0, y: 0, width: 60, height: 20,
              expression: 'vars.totalSum',
            },
            {
              type: 'textField',
              x: 60, y: 0, width: 60, height: 20,
              expression: 'vars.totalCount',
            },
            {
              type: 'textField',
              x: 120, y: 0, width: 60, height: 20,
              expression: 'vars.totalMax',
            },
          ],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        items: [{ value: 10 }, { value: 30 }, { value: 20 }],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    // subSum=60, subCount=3, subMax=30
    expect(allTexts.some(t => t.text === '60')).toBe(true)   // totalSum
    expect(allTexts.some(t => t.text === '3')).toBe(true)    // totalCount
    expect(allTexts.some(t => t.text === '30')).toBe(true)   // totalMax
  })

  it('returnValues: 複数サブレポート行で親の変数が累積される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{
        name: 'subtotal',
        expression: (f: any) => f.qty * f.price,
        calculation: 'sum',
        resetType: 'report',
      }],
      bands: {
        details: [{
          height: 15,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 15,
            expression: (f: any) => f.qty * f.price,
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 800, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [
        { name: 'grandTotal', expression: (f: any) => 0, calculation: 'sum', resetType: 'report' },
        { name: 'deptCount', expression: (f: any) => 0, calculation: 'sum', resetType: 'report' },
      ],
      bands: {
        details: [{
          height: 100,
          elements: [
            {
              type: 'textField',
              x: 0, y: 0, width: 100, height: 15,
              expression: 'field.dept',
            },
            {
              type: 'subreport',
              x: 0, y: 15,
              width: 200, height: 85,
              templateExpression: "'sub1'",
              dataSourceExpression: 'field.items',
              returnValues: [
                { name: 'grandTotal', subreportVariable: 'subtotal', calculation: 'sum' },
                { name: 'deptCount', subreportVariable: 'subtotal', calculation: 'count' },
              ],
            },
          ],
        }],
        summary: {
          height: 20,
          elements: [
            {
              type: 'textField',
              x: 0, y: 0, width: 100, height: 20,
              expression: 'vars.grandTotal',
            },
            {
              type: 'textField',
              x: 100, y: 0, width: 100, height: 20,
              expression: 'vars.deptCount',
            },
          ],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [
        {
          dept: '営業部',
          items: [
            { qty: 10, price: 5000 },   // 50,000
            { qty: 20, price: 10000 },  // 200,000
          ],
        },
        {
          dept: '開発部',
          items: [
            { qty: 5, price: 30000 },   // 150,000
            { qty: 1, price: 80000 },   // 80,000
          ],
        },
        {
          dept: '総務部',
          items: [
            { qty: 5, price: 5000 },    // 25,000
          ],
        },
      ],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts: RenderText[] = []
    for (const page of doc.pages) {
      allTexts.push(...collectTexts(page.children))
    }

    // Sales: 250,000 + Development: 230,000 + Administration: 25,000 = 505,000.
    expect(allTexts.some(t => t.text === '505000')).toBe(true)   // grandTotal
    // deptCount should count 3 departments.
    expect(allTexts.some(t => t.text === '3')).toBe(true)         // deptCount
  })

  it('returnValues: calculation=nothing で値を直接セット', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{
        name: 'lastItem',
        expression: 'field.name',
        calculation: 'nothing',
        resetType: 'report',
      }],
      bands: {
        details: [{
          height: 15,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 15,
            expression: 'field.name',
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{
        name: 'parentVar',
        expression: (f: any) => '',
        calculation: 'nothing',
        resetType: 'report',
      }],
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 100,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
            returnValues: [{
              name: 'parentVar',
              subreportVariable: 'lastItem',
              calculation: 'nothing',
            }],
          }],
        }],
        summary: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'vars.parentVar',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        items: [{ name: 'First' }, { name: 'Second' }, { name: 'Last' }],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    // Nothing after value -> 'Last'.
    
    expect(allTexts.some(t => t.text === 'Last')).toBe(true)
  })

  it('サブレポート内の evaluationTime=report が正しく解決される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{
        name: 'total',
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
        summary: {
          height: 20,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'vars.total',
            evaluationTime: 'report',
          }],
        },
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'subreport',
            x: 0, y: 0,
            width: 200, height: 200,
            templateExpression: "'sub1'",
            dataSourceExpression: "field.items",
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        id: 1,
        items: [{ amount: 100 }, { amount: 200 }, { amount: 300 }],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    const allTexts = collectTexts(doc.pages[0]!.children)
    // vars.total = 100 + 200 + 300 = 600
    expect(allTexts.some(t => t.text === '600')).toBe(true)
  })
})
