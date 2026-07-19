import { describe, expect, it } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderGroup, RenderNode, RenderPath } from '../../src/types/render.js'

describe('LayoutEngine path elements', () => {
  it('converts local path data through viewBox into page coordinates', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'path',
            x: 10,
            y: 20,
            width: 80,
            height: 40,
            viewBox: [0, 0, 40, 20],
            d: 'M0 0 L40 20 Z',
            fill: '#112233',
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] })
    const node = firstPath(doc.pages[0]!.children)
    expect(node.type).toBe('path')
    expect(Array.from(node.commands)).toEqual([0, 1, 3])
    expect(Array.from(node.coords)).toEqual([10, 20, 90, 60])
    expect(node.fill).toBe('#112233')
  })

  it('expands object-bounding-box gradients into user-space coordinates', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'path',
            x: 10,
            y: 20,
            width: 80,
            height: 40,
            d: 'M0 0 L80 0 L80 40 Z',
            fill: {
              type: 'linearGradient',
              x1: 0,
              y1: 0.25,
              x2: 1,
              y2: 0.75,
              stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff' },
              ],
            },
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] })
    const node = firstPath(doc.pages[0]!.children)
    expect(node.fill).toEqual({
      type: 'linear-gradient',
      x1: 10,
      y1: 30,
      x2: 90,
      y2: 50,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
      spreadMethod: undefined,
    })
  })

  it('keeps gradient coordinates aligned when wrapping styled path elements', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'path',
            x: 10,
            y: 20,
            width: 80,
            height: 40,
            d: 'M0 0 L80 0 L80 40 Z',
            mode: 'opaque',
            backcolor: '#ffffff',
            fill: {
              type: 'linearGradient',
              stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff' },
              ],
            },
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] })
    const group = firstElementGroup(doc.pages[0]!.children)
    const path = firstPath(group.children)
    expect(Array.from(path.coords)).toEqual([0, 0, 80, 0, 80, 40])
    expect(path.fill).toMatchObject({ type: 'linear-gradient', x1: 0, y1: 0, x2: 80, y2: 0 })
  })

  it('keeps affine path geometry in source space and positions its transform in page space', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'path', x: 10, y: 20, width: 30, height: 20,
            d: 'M0 0 L10 0', affineTransform: [2, 0.5, 1, 3, 0, 0],
            stroke: '#000000', strokeWidth: 4,
          }],
        }],
      },
    }
    const path = firstPath(createReport(template, { rows: [{}] }).pages[0]!.children)
    expect(Array.from(path.coords)).toEqual([0, 0, 10, 0])
    expect(path.affineTransform).toEqual([2, 0.5, 1, 3, 10, 20])
    expect(path.strokeWidth).toBe(4)
  })
})

function firstPath(nodes: RenderNode[]): RenderPath {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'path') return node
    if (node.type === 'group') {
      const found = findPath(node.children)
      if (found) return found
    }
  }
  throw new Error('path not found')
}

function findPath(nodes: RenderNode[]): RenderPath | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'path') return node
    if (node.type === 'group') {
      const found = findPath(node.children)
      if (found) return found
    }
  }
  return null
}

function firstElementGroup(nodes: RenderNode[]): RenderGroup {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'group') {
      for (let c = 0; c < node.children.length; c++) {
        const child = node.children[c]!
        if (child.type === 'group') return child
      }
    }
  }
  throw new Error('element group not found')
}
