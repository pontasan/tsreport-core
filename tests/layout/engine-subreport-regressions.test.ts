import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReport as createReportCore } from '../../src/layout/engine.js'
import { ResourceResolver } from '../../src/layout/resource-resolver.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'
import {
  getNodeRuntimeBridge,
  installNodeRuntime,
  type NodeRuntimeBridge,
} from '../../src/node-runtime-bridge.js'
import type { CreateReportOptions, SubreportTemplateResolver } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderImage, RenderNode, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

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

/** Collects text nodes with page-absolute coordinates (group offsets composed) */
function collectPositionedTexts(
  nodes: RenderNode[],
  offsetX = 0,
  offsetY = 0,
): Array<{ text: string; x: number; y: number }> {
  const texts: Array<{ text: string; x: number; y: number }> = []
  for (const node of nodes) {
    if (node.type === 'text') {
      texts.push({ text: (node as RenderText).text, x: offsetX + node.x, y: offsetY + node.y })
      continue
    }
    if (node.type === 'group') {
      texts.push(...collectPositionedTexts(node.children, offsetX + node.x, offsetY + node.y))
    }
  }
  return texts
}

function collectImageIds(nodes: RenderNode[]): string[] {
  const ids: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'image') ids.push(node.imageId)
    if (node.type === 'group') ids.push(...collectImageIds(node.children))
  }
  return ids
}

function collectImages(nodes: RenderNode[]): RenderImage[] {
  const images: RenderImage[] = []
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = nodes[nodeIndex]!
    if (node.type === 'image') images.push(node)
    if (node.type === 'group') images.push(...collectImages(node.children))
  }
  return images
}

function pageTexts(
  doc: { pages: Array<{ children: RenderNode[] }> },
  pageIndex: number,
): Array<{ text: string; x: number; y: number }> {
  return collectPositionedTexts(doc.pages[pageIndex]!.children)
}

// ─── Tests ───

describe('サブレポート回帰テスト', () => {
  // Regression: a subreport nested inside a frame lost the frame offset —
  // child content was composed against the band origin instead of the frame.
  // Expected: the frame's x/y are composed into the child content coordinates.
  it('frame 内サブレポート: frame の x/y が子コンテンツ座標に合成される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`SUB${field.n}`' }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'frame',
            x: 50, y: 40, width: 200, height: 60,
            elements: [{
              type: 'subreport',
              x: 10, y: 5, width: 150, height: 40,
              templateExpression: "'sub1'",
              dataSourceExpression: 'field.items',
            }],
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ items: [{ n: 1 }, { n: 2 }] }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    // x = 50(frame) + 10(subreport elem), y = 40(frame) + 5(subreport elem)
    expect(pageTexts(doc, 0)).toEqual([
      { text: 'SUB1', x: 60, y: 45 },
      { text: 'SUB2', x: 60, y: 65 },
    ])
  })

  // Regression: a subreport placed in the pageFooter used to be dropped
  // because footer bands were rendered without processing inline sub-content.
  // Expected: the subreport content renders inside the footer region.
  it('pageFooter 内のサブレポート: フッター領域内に描画される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 15,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 15, text: 'FOOTER-SUB' }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`D${field.n}`' }],
        }],
        pageFooter: {
          height: 30,
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 300, height: 30,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        },
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ n: 1, items: [{ a: 1 }] }, { n: 2, items: [{ a: 1 }] }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    const texts = pageTexts(doc, 0)
    expect(texts.filter(t => t.text.startsWith('D')).map(t => ({ text: t.text, y: t.y }))).toEqual([
      { text: 'D1', y: 0 },
      { text: 'D2', y: 20 },
    ])
    // Footer region is y=170..200; the subreport content starts at the footer top
    const footerSub = texts.find(t => t.text === 'FOOTER-SUB')!
    expect(footerSub.x).toBe(0)
    expect(footerSub.y).toBe(170)
  })

  // Regression: a parent variable fed by subreport returnValues with
  // resetType='group' was never reset. Expected: the accumulated value resets
  // at each group boundary so the group footer shows the per-group total.
  it('returnValues 変数が resetType=group で正しくリセットされる（グループごとの集計）', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{ name: 'subSum', expression: 'field.amount', calculation: 'sum', resetType: 'report' }],
      bands: {
        details: [{
          height: 15,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 15, expression: 'field.amount' }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 500, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      variables: [{
        name: 'groupTotal',
        expression: () => 0,
        calculation: 'sum',
        resetType: 'group',
        resetGroup: 'dept',
      }],
      groups: [{
        name: 'dept',
        expression: 'field.dept',
        footer: {
          height: 20,
          elements: [{ type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: '`TOTAL(${field.dept}):${vars.groupTotal}`' }],
        },
      }],
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 300, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
            returnValues: [{ name: 'groupTotal', subreportVariable: 'subSum', calculation: 'sum' }],
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [
        { dept: 'A', items: [{ amount: 10 }, { amount: 20 }] }, // A total = 30
        { dept: 'B', items: [{ amount: 5 }, { amount: 7 }] },   // B total = 12
      ],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    // Group B's total must be 12, not 42 — the accumulator resets per group
    expect(pageTexts(doc, 0)).toEqual([
      { text: '10', x: 0, y: 0 },
      { text: '20', x: 0, y: 15 },
      { text: 'TOTAL(A):30', x: 0, y: 30 },
      { text: '5', x: 0, y: 50 },
      { text: '7', x: 0, y: 65 },
      { text: 'TOTAL(B):12', x: 0, y: 80 },
    ])
  })

  // Regression: two subreports at the same y (different x) in one band used to
  // be stacked sequentially. Expected: both flow in parallel from the common
  // start Y, forming side-by-side columns.
  it('同一バンド内の横並びサブレポート: 両方とも共通開始Yから並列配置される', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 140, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.label' }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 500, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 40,
          elements: [
            {
              type: 'subreport',
              x: 0, y: 0, width: 140, height: 40,
              templateExpression: "'sub1'",
              dataSourceExpression: 'field.left',
            },
            {
              type: 'subreport',
              x: 160, y: 0, width: 140, height: 40,
              templateExpression: "'sub1'",
              dataSourceExpression: 'field.right',
            },
          ],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        left: [{ label: 'L1' }, { label: 'L2' }],
        right: [{ label: 'R1' }, { label: 'R2' }],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    const texts = pageTexts(doc, 0)
    const byText = new Map(texts.map(t => [t.text, t]))
    expect(byText.get('L1')).toMatchObject({ x: 0, y: 0 })
    expect(byText.get('L2')).toMatchObject({ x: 0, y: 20 })
    expect(byText.get('R1')).toMatchObject({ x: 160, y: 0 })
    expect(byText.get('R2')).toMatchObject({ x: 160, y: 20 })
  })

  // Regression: subreport stretch was invisible to the float logic, so a
  // positionType='float' element below the subreport was not pushed down.
  // Expected: the element is pushed down by the subreport's stretch amount.
  it('positionType=float の要素がサブレポートの伸長分だけ押し下げられる', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`SUB${field.n}`' }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 500, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 60,
          elements: [
            {
              // Reserves 20pt but actually produces 4 rows x 20 = 80pt (stretch = 60)
              type: 'subreport',
              x: 0, y: 0, width: 300, height: 20,
              templateExpression: "'sub1'",
              dataSourceExpression: 'field.items',
            },
            {
              type: 'staticText',
              x: 0, y: 30, width: 100, height: 20,
              positionType: 'float',
              text: 'BELOW',
            },
          ],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    const texts = pageTexts(doc, 0)
    expect(texts.filter(t => t.text.startsWith('SUB')).map(t => ({ text: t.text, y: t.y }))).toEqual([
      { text: 'SUB1', y: 0 },
      { text: 'SUB2', y: 20 },
      { text: 'SUB3', y: 40 },
      { text: 'SUB4', y: 60 },
    ])
    // BELOW is pushed down by the 60pt stretch: 30 + 60 = 90
    const below = texts.find(t => t.text === 'BELOW')!
    expect(below.y).toBe(90)
  })

  // Regression: after a subreport spanned onto the next page, a stale
  // min-cursor guard jumped the cursor forward, leaving a phantom gap before
  // the next band. Expected: the following band starts directly below the
  // subreport continuation.
  it('サブレポートがページを跨いだ後の後続バンド位置が正しい（余分なギャップなし）', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: '`SUB${field.n}`' }],
        }],
      },
    }

    // Page height 100. row1/row2: plain 30pt bands -> cursor 60.
    // row3: subreport band (h=20) with 3 sub rows (60pt) -> 40pt on page 1, 20pt on page 2.
    // row4: 'AFTER' must land directly below SUB3 on page 2.
    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          printWhenExpression: 'field.kind === "plain"',
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 30, expression: 'field.label' }],
        }, {
          height: 20,
          printWhenExpression: 'field.kind === "sub"',
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 300, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [
        { kind: 'plain', label: 'R1' },
        { kind: 'plain', label: 'R2' },
        { kind: 'sub', items: [{ n: 1 }, { n: 2 }, { n: 3 }] },
        { kind: 'plain', label: 'AFTER' },
      ],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(2)

    expect(pageTexts(doc, 0)).toEqual([
      { text: 'R1', x: 0, y: 0 },
      { text: 'R2', x: 0, y: 30 },
      { text: 'SUB1', x: 0, y: 60 },
      { text: 'SUB2', x: 0, y: 80 },
    ])
    expect(pageTexts(doc, 1)).toEqual([
      { text: 'SUB3', x: 0, y: 0 },
      { text: 'AFTER', x: 0, y: 20 }, // directly below, no phantom gap
    ])
  })

  // Regression: a page break requested inside a subreport (group with
  // startNewPage) used to be silently dropped. Expected: the break propagates
  // to the parent as a page advance.
  it('サブレポート内グループの startNewPage が親のページ送りとして伝播する', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      groups: [{
        name: 'g',
        expression: 'field.g',
        startNewPage: true,
        header: {
          height: 15,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 15, expression: '`G:${field.g}`' }],
        },
      }],
      bands: {
        details: [{
          height: 15,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 15, expression: '`row${field.n}`' }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 300, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{
        items: [
          { g: 'X', n: 1 }, { g: 'X', n: 2 },
          { g: 'Y', n: 3 }, { g: 'Y', n: 4 },
        ],
      }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(2)

    expect(pageTexts(doc, 0)).toEqual([
      { text: 'G:X', x: 0, y: 0 },
      { text: 'row1', x: 0, y: 15 },
      { text: 'row2', x: 0, y: 30 },
    ])
    // Group Y starts at the top of the next parent page
    expect(pageTexts(doc, 1)).toEqual([
      { text: 'G:Y', x: 0, y: 0 },
      { text: 'row3', x: 0, y: 15 },
      { text: 'row4', x: 0, y: 30 },
    ])
  })

  // Regression: the child template's margins used to be ignored. Expected
  // (general reporting semantics): the child's left/top margins inset the
  // content inside the subreport element's box.
  it('子テンプレートの左マージンが要素領域内のインセットとして効く（x = 親要素x + 子marginLeft）', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 200, height: 400, margins: { top: 30, bottom: 0, left: 25, right: 0 } },
      bands: {
        details: [{
          height: 20,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'SUB' }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 60,
          elements: [{
            type: 'subreport',
            x: 10, y: 0, width: 250, height: 60,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [{ items: [{ a: 1 }] }],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(1)

    // x = 10 (parent element) + 25 (child marginLeft)
    const sub = pageTexts(doc, 0).find(t => t.text === 'SUB')!
    expect(sub.x).toBe(35)
  })

  // Regression: a subreport band with default splitType used to move wholesale
  // to the next page, leaving a hole. Expected: sub rows fill the remaining
  // space on the current page, then continue on the next page.
  it('デフォルト splitType のサブレポートバンド: 現ページの残りに行を詰めてから次ページへ継続する', () => {
    const subTemplate: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 15,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 15, expression: '`S${field.n}`' }],
        }],
      },
    }

    // Page height 100. row1: plain 20pt -> cursor 20.
    // row2: subreport band (h=20) with 7 sub rows x 15 = 105pt: page 1 fits
    // S1..S5 (20..95), page 2 gets S6,S7. row3: 'AFTER' directly below.
    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          printWhenExpression: 'field.kind === "plain"',
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.label' }],
        }, {
          height: 20,
          printWhenExpression: 'field.kind === "sub"',
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 300, height: 20,
            templateExpression: "'sub1'",
            dataSourceExpression: 'field.items',
          }],
        }],
      },
    }

    const dataSource: LegacyDataSource = {
      rows: [
        { kind: 'plain', label: 'R1' },
        { kind: 'sub', items: Array.from({ length: 7 }, (_, i) => ({ n: i + 1 })) },
        { kind: 'plain', label: 'AFTER' },
      ],
      subreportTemplates: { sub1: subTemplate },
    }

    const doc = createReport(mainTemplate, dataSource)
    expect(doc.pages).toHaveLength(2)

    // Page 1: the band is NOT moved wholesale — S1..S5 pack the remaining space
    expect(pageTexts(doc, 0)).toEqual([
      { text: 'R1', x: 0, y: 0 },
      { text: 'S1', x: 0, y: 20 },
      { text: 'S2', x: 0, y: 35 },
      { text: 'S3', x: 0, y: 50 },
      { text: 'S4', x: 0, y: 65 },
      { text: 'S5', x: 0, y: 80 },
    ])
    // Page 2: continuation from the top, next band directly below
    expect(pageTexts(doc, 1)).toEqual([
      { text: 'S6', x: 0, y: 0 },
      { text: 'S7', x: 0, y: 15 },
      { text: 'AFTER', x: 0, y: 30 },
    ])
  })

  // Regression: the child report used to be filled twice per parent row (once
  // for height estimation, once for rendering) — exponential for nesting.
  // Expected: each subreport is resolved and its data source evaluated exactly
  // once per row, even when nested.
  it('サブレポートは1行につき1回だけ実行される（見積もりとレンダリングで二重実行されない、ネストでも各1回）', () => {
    let innerDsEvals = 0

    const innerSub: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{ height: 10, elements: [{ type: 'staticText', x: 0, y: 0, width: 50, height: 10, text: 'I' }] }],
      },
    }

    const outerSub: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 10,
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 300, height: 10,
            templateExpression: "'inner'",
            dataSourceExpression: () => { innerDsEvals++; return [{ a: 1 }] },
          }],
        }],
      },
    }

    const mainTemplate: ReportTemplate = {
      page: { width: 300, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 10,
          elements: [{
            type: 'subreport',
            x: 0, y: 0, width: 300, height: 10,
            templateExpression: "'outer'",
            dataSourceExpression: 'field.items',
          }],
        }],
      },
    }

    const resolveCounts: Record<string, number> = {}
    const resolver: SubreportTemplateResolver = (ref) => {
      resolveCounts[ref] = (resolveCounts[ref] ?? 0) + 1
      if (ref === 'outer') return { template: outerSub }
      if (ref === 'inner') return { template: innerSub }
      return null
    }

    const doc = createReport(mainTemplate, { rows: [{ items: [{ x: 1 }] }] }, { resolveSubreportTemplate: resolver })

    // Single-fill semantics: 1 parent row -> outer filled once; 1 outer row ->
    // inner filled once; inner data source evaluated once
    expect(resolveCounts).toEqual({ outer: 1, inner: 1 })
    expect(innerDsEvals).toBe(1)
    // And the nested content actually rendered
    expect(pageTexts(doc, 0)).toEqual([{ text: 'I', x: 0, y: 0 }])
  })

  it('子resolverが返したworkingDirectoryから相対画像を解決する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-subreport-image-'))
    try {
      const imagePath = join(dir, 'logo.png')
      writeFileSync(imagePath, encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))
      const child: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'logo.png' }],
          }],
        },
      }
      const parent: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [{
              type: 'subreport',
              x: 0,
              y: 0,
              width: 20,
              height: 20,
              templateExpression: "'child'",
            }],
          }],
        },
      }

      const doc = createReportCore(parent, { rows: [{}] }, {
        resolveSubreportTemplate() {
          return { template: child, workingDirectory: dir }
        },
      })
      const imageId = collectImageIds(doc.pages[0]!.children)[0]!
      expect(imageId).toBe('logo.png\0local:0')
      expect(doc.images?.[imageId]).toBeInstanceOf(Uint8Array)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ブラウザでは子resolverのworkingDirectoryがパス形式の画像IDをmissingへ変えない', () => {
    const previous = getNodeRuntimeBridge()
    delete (globalThis as Record<symbol, NodeRuntimeBridge | undefined>)[Symbol.for('tsreport-core.node-runtime')]
    try {
      const child: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'assets/logo.png' }] }] },
      }
      const parent: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'child'" }] }] },
      }
      const doc = createReportCore(parent, { rows: [{}] }, {
        resolveSubreportTemplate() {
          return { template: child, workingDirectory: '/virtual/templates' }
        },
      })
      expect(collectImageIds(doc.pages[0]!.children)).toContain('assets/logo.png')
    } finally {
      if (previous !== null) installNodeRuntime(previous)
    }
  })

  it('行ごとの子engineでfileRootと解決済み画像を共有する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-subreport-cache-'))
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    try {
      writeFileSync(join(dir, 'logo.png'), encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))
      const actualFs = require('node:fs') as typeof import('node:fs')
      let realpathCalls = 0
      let readCalls = 0
      const fs = {
        realpathSync(path: string): string {
          realpathCalls++
          return actualFs.realpathSync(path)
        },
        statSync(path: string): { isDirectory(): boolean } {
          return actualFs.statSync(path)
        },
        readFileSync(path: string, encoding?: 'utf8'): Uint8Array | string {
          readCalls++
          return encoding === 'utf8' ? actualFs.readFileSync(path, encoding) : actualFs.readFileSync(path)
        },
      }
      const runtime: NodeRuntimeBridge = {
        require(specifier): unknown {
          return specifier === 'node:fs' ? fs : require(specifier)
        },
        execPath: process.execPath,
        randomFill(): void {},
      }
      installNodeRuntime(runtime)

      const child: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'logo.png' }] }] },
      }
      const parent: ReportTemplate = {
        page: { width: 100, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'child'" }] }] },
      }
      createReportCore(parent, { rows: [{}, {}, {}, {}, {}] }, {
        resources: { fileRoot: dir },
        resolveSubreportTemplate() {
          return { template: child, workingDirectory: dir }
        },
      })
      expect(realpathCalls).toBe(2)
      expect(readCalls).toBe(1)
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('異なる子workingDirectoryの同名画像を生参照キーで共有しない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-subreport-image-scope-'))
    try {
      const dirA = join(dir, 'a')
      const dirB = join(dir, 'b')
      mkdirSync(dirA)
      mkdirSync(dirB)
      const imagePath = join(dirA, 'logo.png')
      writeFileSync(imagePath, encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))

      const child: ReportTemplate = {
        page: { width: 50, height: 50, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'logo.png', onError: 'blank' }] }] },
      }
      const parent: ReportTemplate = {
        page: { width: 100, height: 50, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'a'" },
              { type: 'subreport', x: 30, y: 0, width: 20, height: 20, templateExpression: "'b'" },
            ],
          }],
        },
      }

      const doc = createReportCore(parent, { rows: [{}] }, {
        resources: { fileRoot: dir },
        resolveSubreportTemplate(ref) {
          return { template: child, workingDirectory: ref === 'a' ? dirA : dirB }
        },
      })
      expect(collectImageIds(doc.pages[0]!.children)).toEqual(['logo.png'])
      expect(Object.keys(doc.images ?? {})).toEqual(['logo.png'])

      const secondImage = encodePngRgba(1, 1, Uint8Array.from([40, 50, 60, 255]))
      writeFileSync(join(dirB, 'logo.png'), secondImage)
      const collisionDoc = createReportCore(parent, { rows: [{}] }, {
        resources: { fileRoot: dir },
        resolveSubreportTemplate(ref) {
          return { template: child, workingDirectory: ref === 'a' ? dirA : dirB }
        },
      })
      const collisionIds = collectImageIds(collisionDoc.pages[0]!.children)
      expect(collisionIds).toEqual(['logo.png', 'logo.png\0local:0'])
      expect(Object.keys(collisionDoc.images ?? {})).toEqual(collisionIds)
      expect(Array.from(collisionDoc.images?.[collisionIds[1]!] as Uint8Array)).toEqual(Array.from(secondImage))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('行ごとの欠損画像解決をworkingDirectory修飾で負キャッシュする', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-subreport-missing-cache-'))
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    try {
      const actualFs = require('node:fs') as typeof import('node:fs')
      let realpathCalls = 0
      const fs = {
        realpathSync(path: string): string {
          realpathCalls++
          return actualFs.realpathSync(path)
        },
        statSync(path: string): { isDirectory(): boolean } {
          return actualFs.statSync(path)
        },
        readFileSync(path: string, encoding?: 'utf8'): Uint8Array | string {
          return encoding === 'utf8' ? actualFs.readFileSync(path, encoding) : actualFs.readFileSync(path)
        },
      }
      installNodeRuntime({
        require(specifier): unknown {
          return specifier === 'node:fs' ? fs : require(specifier)
        },
        execPath: process.execPath,
        randomFill(): void {},
      })

      const child: ReportTemplate = {
        page: { width: 50, height: 50, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'missing.png', onError: 'blank' }] }] },
      }
      const parent: ReportTemplate = {
        page: { width: 50, height: 150, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'child'" }] }] },
      }
      createReportCore(parent, { rows: [{}, {}, {}, {}, {}] }, {
        resources: { fileRoot: dir },
        resolveSubreportTemplate() {
          return { template: child, workingDirectory: dir }
        },
      })
      expect(realpathCalls).toBe(3)
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('同じ子workingDirectoryのresolver viewを行間で再利用する', () => {
    const resolver = new ResourceResolver(undefined, '/templates', false)
    const first = resolver.forWorkingDirectory('/templates/child', true)
    const second = resolver.forWorkingDirectory('/templates/child', true)
    expect(second).toBe(first)
  })

  it('異なるresolver viewが同一canonical画像へ解決した場合は既存IDを再利用する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-subreport-canonical-image-'))
    try {
      const dirA = join(dir, 'a')
      const dirB = join(dir, 'b')
      mkdirSync(dirA)
      mkdirSync(dirB)
      writeFileSync(join(dirA, 'logo.png'), encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))
      writeFileSync(join(dirB, 'logo.png'), encodePngRgba(1, 1, Uint8Array.from([40, 50, 60, 255])))

      const child: ReportTemplate = {
        page: { width: 30, height: 30, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'logo.png' }] }] },
      }
      const parent: ReportTemplate = {
        page: { width: 100, height: 40, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'a'" },
              { type: 'subreport', x: 30, y: 0, width: 20, height: 20, templateExpression: "'b'" },
              { type: 'subreport', x: 60, y: 0, width: 20, height: 20, templateExpression: "'c'" },
            ],
          }],
        },
      }
      const doc = createReportCore(parent, { rows: [{}] }, {
        resources: { fileRoot: dir },
        resolveSubreportTemplate(ref) {
          return { template: child, workingDirectory: ref === 'a' ? dirA : ref === 'b' ? dirB : dirB + '/.' }
        },
      })
      expect(collectImageIds(doc.pages[0]!.children)).toEqual([
        'logo.png',
        'logo.png\0local:0',
        'logo.png\0local:0',
      ])
      expect(Object.keys(doc.images ?? {})).toEqual(['logo.png', 'logo.png\0local:0'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('同一templateのalternate解決結果を異なるworkingDirectory間で共有しない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-subreport-alternate-view-'))
    try {
      const dirA = join(dir, 'a')
      const dirB = join(dir, 'b')
      mkdirSync(dirA)
      mkdirSync(dirB)
      writeFileSync(join(dirA, 'main.png'), encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))
      writeFileSync(join(dirA, 'alternate.png'), encodePngRgba(1, 1, Uint8Array.from([40, 50, 60, 255])))
      writeFileSync(join(dirB, 'main.png'), encodePngRgba(1, 1, Uint8Array.from([70, 80, 90, 255])))
      writeFileSync(join(dirB, 'alternate.png'), encodePngRgba(1, 1, Uint8Array.from([100, 110, 120, 255])))
      const child: ReportTemplate = {
        page: { width: 30, height: 30, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{
          type: 'image', x: 0, y: 0, width: 20, height: 20,
          source: 'main.png', alternates: [{ source: 'alternate.png' }],
        }] }] },
      }
      const parent: ReportTemplate = {
        page: { width: 60, height: 30, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [
          { type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'a'" },
          { type: 'subreport', x: 30, y: 0, width: 20, height: 20, templateExpression: "'b'" },
        ] }] },
      }
      const doc = createReportCore(parent, { rows: [{}] }, {
        resources: { fileRoot: dir },
        resolveSubreportTemplate(ref) {
          return { template: child, workingDirectory: ref === 'a' ? dirA : dirB }
        },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(2)
      if (images[0]?.type !== 'image' || images[1]?.type !== 'image') throw new Error('Expected images')
      expect(images[0].alternates?.[0]!.imageId).not.toBe(images[1].alternates?.[0]!.imageId)
      expect(doc.images?.[images[0].alternates![0]!.imageId]).not.toBe(doc.images?.[images[1].alternates![0]!.imageId])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('子のローカル画像を親の同名passthrough参照へ公開しない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-subreport-passthrough-image-'))
    try {
      writeFileSync(join(dir, 'logo.png'), encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))
      const child: ReportTemplate = {
        page: { width: 30, height: 30, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'logo.png' }] }] },
      }
      const parent: ReportTemplate = {
        page: { width: 100, height: 40, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [
              { type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'child'" },
              { type: 'image', x: 30, y: 0, width: 20, height: 20, source: 'logo.png' },
            ],
          }],
        },
      }
      const doc = createReportCore(parent, { rows: [{}] }, {
        resolveSubreportTemplate() {
          return { template: child, workingDirectory: dir }
        },
      })
      expect(collectImageIds(doc.pages[0]!.children)).toEqual(['logo.png', 'logo.png\0local:0'])
      expect(Object.keys(doc.images ?? {})).toEqual(['logo.png\0local:0'])
      expect(doc.images?.['logo.png']).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('先行するローカル画像がworkingDirectoryなしの動的passthrough参照を横取りしない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-subreport-dynamic-passthrough-'))
    try {
      writeFileSync(join(dir, 'logo.png'), encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))
      const localChild: ReportTemplate = {
        page: { width: 30, height: 30, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'logo.png' }] }] },
      }
      const passthroughChild: ReportTemplate = {
        page: { width: 30, height: 30, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, sourceExpression: 'field.imageRef' }] }] },
      }
      const parent: ReportTemplate = {
        page: { width: 60, height: 30, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [
          { type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'local'" },
          { type: 'subreport', x: 30, y: 0, width: 20, height: 20, templateExpression: "'passthrough'" },
        ] }] },
      }
      const doc = createReportCore(parent, { rows: [{ imageRef: 'logo.png' }] }, {
        resolveSubreportTemplate(ref) {
          return ref === 'local'
            ? { template: localChild, workingDirectory: dir }
            : { template: passthroughChild }
        },
      })
      expect(collectImageIds(doc.pages[0]!.children)).toEqual(['logo.png\0local:0', 'logo.png'])
      expect(Object.keys(doc.images ?? {})).toEqual(['logo.png\0local:0'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
