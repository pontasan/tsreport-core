/**
 * Vertical writing integration tests
 *
 * Verifies the writingMode property propagates correctly through
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

describe('縦書き統合', () => {
  const dataSource: DataSource = {
    rows: [{ text: '縦書きテスト' }],
  }

  // Verifies a style's writingMode 'vertical-rl' is carried onto the resulting RenderText node.
  test('writingMode: vertical-rl が RenderText に伝播される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [
        {
          name: 'verticalStyle',
          fontFamily: 'default',
          fontSize: 12,
          writingMode: 'vertical-rl',
        },
      ],
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 50, height: 100,
            text: '縦書き',
            style: 'verticalStyle',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    expect(doc.pages.length).toBeGreaterThan(0)

    const texts = collectTextNodes(doc.pages[0]!.children)
    expect(texts.length).toBeGreaterThan(0)

    const textNode = texts.find(t => t.text === '縦書き')
    expect(textNode).toBeDefined()
    expect(textNode!.writingMode).toBe('vertical-rl')
  })

  // Verifies the left-to-right vertical mode 'vertical-lr' also propagates to RenderText.
  test('writingMode: vertical-lr が RenderText に伝播される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [
        {
          name: 'verticalLrStyle',
          writingMode: 'vertical-lr',
        },
      ],
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 50, height: 100,
            text: '左縦書き',
            style: 'verticalLrStyle',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    const textNode = texts.find(t => t.text === '左縦書き')
    expect(textNode).toBeDefined()
    expect(textNode!.writingMode).toBe('vertical-lr')
  })

  // Verifies writingMode stays undefined (horizontal layout) when the template does not set it.
  test('writingMode なしの場合は undefined（水平書き）', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 20,
            text: '水平',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    const textNode = texts.find(t => t.text === '水平')
    expect(textNode).toBeDefined()
    expect(textNode!.writingMode).toBeUndefined()
  })

  // Verifies a child style inherits the parent's writingMode alongside its own properties.
  test('スタイル継承で writingMode が引き継がれる', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [
        {
          name: 'parentVertical',
          writingMode: 'vertical-rl',
        },
        {
          name: 'childVertical',
          parentStyle: 'parentVertical',
          forecolor: '#0000FF',
        },
      ],
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 50, height: 100,
            text: '継承縦書き',
            style: 'childVertical',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    const textNode = texts.find(t => t.text === '継承縦書き')
    expect(textNode).toBeDefined()
    expect(textNode!.writingMode).toBe('vertical-rl')
    expect(textNode!.color).toBe('#0000FF')
  })

  // Verifies writingMode also propagates through textField elements, not just staticText.
  test('textField でも writingMode が伝播される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      fields: [{ name: 'text', type: 'string' }],
      styles: [
        {
          name: 'vertStyle',
          writingMode: 'vertical-rl',
        },
      ],
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 50, height: 100,
            expression: 'field.text',
            style: 'vertStyle',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0]!.writingMode).toBe('vertical-rl')
  })

  // Verifies variation and writingMode can be combined in one style and both reach the RenderText.
  test('variation と writingMode を同時に指定できる', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [
        {
          name: 'comboStyle',
          variation: { wght: 700 },
          writingMode: 'vertical-rl',
        },
      ],
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 50, height: 100,
            text: '太縦書き',
            style: 'comboStyle',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    const textNode = texts.find(t => t.text === '太縦書き')
    expect(textNode).toBeDefined()
    expect(textNode!.variation).toEqual({ wght: 700 })
    expect(textNode!.writingMode).toBe('vertical-rl')
  })

  // Verifies HTML markup splits the text into multiple RenderText nodes that all keep the writingMode.
  test('HTML マークアップ付きテキストでも writingMode が伝播される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [
        {
          name: 'vertMarkup',
          writingMode: 'vertical-rl',
        },
      ],
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 50, height: 100,
            text: '<b>太字</b>縦書き',
            markup: 'html',
            style: 'vertMarkup',
          }],
        }],
      },
    }

    const doc = createReport(template, dataSource)
    const texts = collectTextNodes(doc.pages[0]!.children)
    // With markup the text splits into multiple RenderText nodes, but all carry writingMode
    for (const text of texts) {
      expect(text.writingMode).toBe('vertical-rl')
    }
  })
})
