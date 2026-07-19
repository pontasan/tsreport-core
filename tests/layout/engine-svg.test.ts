import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, SvgElementDef, ElementDef } from '../../src/types/template.js'
import type { RenderNode, RenderGroup, RenderSvg } from '../../src/types/render.js'

// ─── Helpers ───

function collectSvgNodes(nodes: RenderNode[]): RenderSvg[] {
  const result: RenderSvg[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'svg') result.push(node)
    if (node.type === 'group') {
      const children = collectSvgNodes((node as RenderGroup).children)
      for (let j = 0; j < children.length; j++) {
        result.push(children[j]!)
      }
    }
  }
  return result
}

function makeTemplate(svgElem: Partial<SvgElementDef> & { svgContent: SvgElementDef['svgContent'] }): ReportTemplate {
  return {
    page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: {
      details: [{
        height: 200,
        elements: [{
          type: 'svg',
          x: 10, y: 20,
          width: 100, height: 80,
          ...svgElem,
        } as SvgElementDef],
      }],
    },
  }
}

// ─── Tests ───

describe('SVG element (SvgElementDef)', () => {
  // Verifies that an SVG element renders at its defined position and size with the markup preserved.
  it('SVG要素が正しい位置・サイズで描画される', () => {
    const svgStr = '<svg><circle cx="50" cy="50" r="40"/></svg>'
    const doc = createReport(
      makeTemplate({ svgContent: () => svgStr }),
      { rows: [{}] },
    )
    const svgNodes = collectSvgNodes(doc.pages[0]!.children)
    expect(svgNodes).toHaveLength(1)
    expect(svgNodes[0]!.x).toBe(10)
    expect(svgNodes[0]!.y).toBe(20)
    expect(svgNodes[0]!.width).toBe(100)
    expect(svgNodes[0]!.height).toBe(80)
    expect(svgNodes[0]!.svgData).toBe(svgStr)
  })

  // Verifies that a string expression for svgContent is evaluated against field data.
  it('文字列式が評価される', () => {
    const doc = createReport(
      makeTemplate({ svgContent: 'field.svgMarkup' }),
      { rows: [{ svgMarkup: '<svg><rect width="10" height="10"/></svg>' }] },
    )
    const svgNodes = collectSvgNodes(doc.pages[0]!.children)
    expect(svgNodes).toHaveLength(1)
    expect(svgNodes[0]!.svgData).toBe('<svg><rect width="10" height="10"/></svg>')
  })

  // Verifies that a callback expression for svgContent receives field data and its result is rendered.
  it('コールバック式が評価される', () => {
    const doc = createReport(
      makeTemplate({
        svgContent: (field: Record<string, unknown>) => `<svg><text>${String(field.label)}</text></svg>`,
      }),
      { rows: [{ label: 'Hello' }] },
    )
    const svgNodes = collectSvgNodes(doc.pages[0]!.children)
    expect(svgNodes).toHaveLength(1)
    expect(svgNodes[0]!.svgData).toBe('<svg><text>Hello</text></svg>')
  })

  // Verifies that an SVG element coexists with other element types inside the same band.
  it('バンド内で他の要素と共存する', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 200,
          elements: [
            { type: 'rectangle', x: 0, y: 0, width: 200, height: 200 } as ElementDef,
            { type: 'svg', x: 10, y: 10, width: 80, height: 60, svgContent: () => '<svg/>' } as SvgElementDef,
          ],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const svgNodes = collectSvgNodes(doc.pages[0]!.children)
    expect(svgNodes).toHaveLength(1)
    expect(svgNodes[0]!.x).toBe(10)
    expect(svgNodes[0]!.y).toBe(10)
    expect(svgNodes[0]!.width).toBe(80)
    expect(svgNodes[0]!.height).toBe(60)
  })

  // Verifies that an SVG element nested inside a frame renders with frame-relative coordinates.
  it('フレーム内のSVG要素が描画される', () => {
    const svgStr = '<svg><line x1="0" y1="0" x2="50" y2="40"/></svg>'
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 300,
          elements: [{
            type: 'frame',
            x: 20, y: 30,
            width: 200, height: 200,
            elements: [
              { type: 'svg', x: 5, y: 5, width: 50, height: 40, svgContent: () => svgStr } as SvgElementDef,
            ],
          } as ElementDef],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const svgNodes = collectSvgNodes(doc.pages[0]!.children)
    expect(svgNodes).toHaveLength(1)
    expect(svgNodes[0]!.x).toBe(5)
    expect(svgNodes[0]!.y).toBe(5)
    expect(svgNodes[0]!.width).toBe(50)
    expect(svgNodes[0]!.height).toBe(40)
    expect(svgNodes[0]!.svgData).toBe(svgStr)
  })
})
