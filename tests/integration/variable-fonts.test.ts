/**
 * Variable Fonts integration tests
 *
 * Verifies the variation property propagates correctly through
 * template → style resolution → RenderText → backend.
 */

import { describe, test, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderText, RenderGroup, RenderNode } from '../../src/types/render.js'

/** Collect all RenderText nodes from a RenderNode tree */
function collectTextNodes(nodes: RenderNode[]): RenderText[] {
  const result: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      result.push(node)
    } else if (node.type === 'group') {
      result.push(...collectTextNodes((node as RenderGroup).children))
    }
  }
  return result
}

describe('Variable Fonts 統合', () => {
  const dataSource: DataSource = {
    rows: [{ name: 'Test' }],
  }

  // Verifies a style's variation axes are carried onto the RenderText node produced by the layout engine.
  test('スタイルの variation が RenderText に伝播される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [
        {
          name: 'variableStyle',
          fontFamily: 'default',
          fontSize: 12,
          variation: { wght: 700, wdth: 75 },
        },
      ],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'Bold Condensed',
            style: 'variableStyle',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    expect(doc.pages.length).toBeGreaterThan(0)

    const texts = collectTextNodes(doc.pages[0]!.children)
    expect(texts.length).toBeGreaterThan(0)

    const textNode = texts.find(t => t.text === 'Bold Condensed')
    expect(textNode).toBeDefined()
    expect(textNode!.variation).toEqual({ wght: 700, wdth: 75 })
  })

  // Verifies RenderText.variation stays undefined when the template specifies no variation.
  test('variation なしの場合は RenderText.variation が undefined', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'Normal Text',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    const textNode = texts.find(t => t.text === 'Normal Text')
    expect(textNode).toBeDefined()
    expect(textNode!.variation).toBeUndefined()
  })

  // Verifies a child style inherits the parent's variation while adding its own properties.
  test('スタイル継承で variation が引き継がれる', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [
        {
          name: 'parentStyle',
          fontFamily: 'default',
          fontSize: 14,
          variation: { wght: 600 },
        },
        {
          name: 'childStyle',
          parentStyle: 'parentStyle',
          forecolor: '#FF0000',
          // variation is inherited from the parent
        },
      ],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'Inherited',
            style: 'childStyle',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    const textNode = texts.find(t => t.text === 'Inherited')
    expect(textNode).toBeDefined()
    expect(textNode!.variation).toEqual({ wght: 600 })
    expect(textNode!.color).toBe('#FF0000')
  })

  // Verifies a child style's variation fully overrides the parent's variation.
  test('子スタイルで variation を上書きできる', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [
        {
          name: 'parentStyle',
          fontFamily: 'default',
          variation: { wght: 400 },
        },
        {
          name: 'childStyle',
          parentStyle: 'parentStyle',
          variation: { wght: 900, wdth: 50 },
        },
      ],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: 'Overridden',
            style: 'childStyle',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    const textNode = texts.find(t => t.text === 'Overridden')
    expect(textNode).toBeDefined()
    expect(textNode!.variation).toEqual({ wght: 900, wdth: 50 })
  })

  // Verifies variation also propagates through textField elements, not just staticText.
  test('textField でも variation が伝播される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      fields: [{ name: 'name', type: 'string' }],
      styles: [
        {
          name: 'varStyle',
          variation: { wght: 500 },
        },
      ],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 100, height: 20,
            expression: 'field.name',
            style: 'varStyle',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0]!.variation).toEqual({ wght: 500 })
  })
})
