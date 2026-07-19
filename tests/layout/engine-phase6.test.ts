import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderGroup, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function findRotatedGroup(nodes: RenderNode[]): RenderGroup | undefined {
  for (const node of nodes) {
    if (node.type === 'group') {
      if (node.rotation) return node
      const found = findRotatedGroup(node.children)
      if (found) return found
    }
  }
  return undefined
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

// ─── Test template factory ───

function makeTemplate(
  rotation: 0 | 90 | 180 | 270,
  width: number,
  height: number,
  text: string = 'Hello',
  extra?: Partial<import('../../src/types/template.js').StaticTextDef>,
): ReportTemplate {
  return {
    page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: {
      details: [{
        height: Math.max(height + 10, 30),
        elements: [{
          type: 'staticText',
          x: 10, y: 5,
          width, height,
          text,
          rotation,
          ...extra,
        }],
      }],
    },
  }
}

// ─── Tests ───

// Text rotation (Phase 6): rotation group generation, rotation origins, and width/height swapping.
describe('Phase 6: テキスト回転', () => {
  // Verifies rotation=0 renders text without any rotation group.
  it('rotation=0 は回転なし（従来通り）', () => {
    const doc = createReport(makeTemplate(0, 100, 30), { rows: [{}] })
    const page = doc.pages[0]!
    const texts = collectTexts(page.children)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0]!.text).toBe('Hello')

    // No rotation group
    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeUndefined()
  })

  // Verifies rotation=90 (CCW) creates a rotation group with -90 degrees and a centered origin.
  it('rotation=90（左回転）で回転グループが生成される', () => {
    const doc = createReport(makeTemplate(90, 100, 200), { rows: [{}] })
    const page = doc.pages[0]!

    // Text exists
    const texts = collectTexts(page.children)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0]!.text).toBe('Hello')

    // Rotation group exists
    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()
    expect(rotated!.rotation).toBe(-90) // CW negative = CCW 90°
    expect(rotated!.rotationOriginX).toBe(100) // elemHeight / 2 = 200/2
    expect(rotated!.rotationOriginY).toBe(100) // elemHeight / 2 = 200/2
  })

  // Verifies rotation=180 creates an upside-down rotation group with a centered origin.
  it('rotation=180（逆さ）で回転グループが生成される', () => {
    const doc = createReport(makeTemplate(180, 100, 50), { rows: [{}] })
    const page = doc.pages[0]!

    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()
    expect(rotated!.rotation).toBe(180)
    expect(rotated!.rotationOriginX).toBe(50)  // elemWidth / 2
    expect(rotated!.rotationOriginY).toBe(25)  // elemHeight / 2
  })

  // Verifies rotation=270 (CW) creates a rotation group with +90 degrees.
  it('rotation=270（右回転）で回転グループが生成される', () => {
    const doc = createReport(makeTemplate(270, 100, 200), { rows: [{}] })
    const page = doc.pages[0]!

    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()
    expect(rotated!.rotation).toBe(90) // CW positive = CW 90° = 270° CCW
    expect(rotated!.rotationOriginX).toBe(50) // elemWidth / 2 = 100/2
    expect(rotated!.rotationOriginY).toBe(50) // elemWidth / 2 = 100/2
  })

  // Verifies rotation=90 swaps width/height for text layout while the outer clipping group keeps the element size.
  it('rotation=90 で幅と高さが入れ替わる（テキストレイアウト用）', () => {
    // Element: width=100, height=200
    // 90° rotation → layout width=200 (original height), layout height=100 (original width)
    const doc = createReport(makeTemplate(90, 100, 200), { rows: [{}] })
    const page = doc.pages[0]!

    // The outer group keeps the original element dimensions
    const groups = collectGroups(page.children)
    const outerRotGroup = groups.find(g =>
      g.children.some(c => c.type === 'group' && (c as RenderGroup).rotation)
    )
    expect(outerRotGroup).toBeDefined()
    // The outer group has clip=true
    expect(outerRotGroup!.clip).toBe(true)
  })

  // Verifies rotation=270 also swaps width and height for text layout.
  it('rotation=270 で幅と高さが入れ替わる', () => {
    const doc = createReport(makeTemplate(270, 80, 160), { rows: [{}] })
    const page = doc.pages[0]!

    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()
    expect(rotated!.rotation).toBe(90) // CW 90°
  })

  // Verifies rotation defined on a style is applied to the element.
  it('スタイル経由の rotation', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{ name: 'rotated', rotation: 90 }],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 200,
            text: 'StyleRotation',
            style: 'rotated',
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const page = doc.pages[0]!

    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()
    expect(rotated!.rotation).toBe(-90)

    const texts = collectTexts(page.children)
    expect(texts.some(t => t.text === 'StyleRotation')).toBe(true)
  })

  // Verifies element-level rotation overrides style-level rotation.
  it('要素の rotation がスタイルの rotation を上書き', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{ name: 'rotated', rotation: 90 }],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 100, height: 100,
            text: 'Override',
            style: 'rotated',
            rotation: 270,
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const page = doc.pages[0]!

    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()
    expect(rotated!.rotation).toBe(90) // 270° template → 90° CW
  })

  // Verifies rotation applies to textField elements as well.
  it('textField でも回転が適用される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      fields: [{ name: 'val', type: 'string' }],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'textField',
            x: 10, y: 5,
            width: 80, height: 150,
            expression: 'field.val',
            rotation: 90,
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{ val: 'Rotated' }] })
    const page = doc.pages[0]!

    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()
    expect(rotated!.rotation).toBe(-90)

    const texts = collectTexts(page.children)
    expect(texts.some(t => t.text === 'Rotated')).toBe(true)
  })

  // Verifies borders on rotated text stay unrotated, outside the rotation group.
  it('回転テキストにボーダーが追加される場合、ボーダーは回転しない', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{
        name: 'bordered',
        rotation: 90,
        border: { width: 1, color: '#000000' },
      }],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 10, y: 5,
            width: 100, height: 200,
            text: 'Bordered',
            style: 'bordered',
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const page = doc.pages[0]!

    // Text exists
    const texts = collectTexts(page.children)
    expect(texts.some(t => t.text === 'Bordered')).toBe(true)

    // Rotation group exists
    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()

    // Border (line nodes) sits outside the rotation group
    // → the rotation group's children contain no line nodes
    const rotatedChildren = rotated!.children
    const hasLine = rotatedChildren.some(c => c.type === 'line')
    expect(hasLine).toBe(false)
  })

  // Verifies rotation works together with HTML markup styling.
  it('markup=html でも回転が適用される', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 10, y: 5,
            width: 100, height: 200,
            text: '<b>Bold</b> text',
            markup: 'html',
            rotation: 90,
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const page = doc.pages[0]!

    const rotated = findRotatedGroup(page.children)
    expect(rotated).toBeDefined()
    expect(rotated!.rotation).toBe(-90)

    const texts = collectTexts(page.children)
    const boldText = texts.find(t => t.text === 'Bold')
    expect(boldText).toBeDefined()
    expect(boldText!.bold).toBe(true)
  })
})

