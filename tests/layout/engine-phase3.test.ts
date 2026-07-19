import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { createReport, type FontMap } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderGroup, RenderText, RenderRect, RenderNode } from '../../src/types/render.js'

const __dirname = new URL('.', import.meta.url).pathname

let fontMap: FontMap

beforeAll(() => {
  const buffer = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer
  const font = Font.load(buffer)
  const measurer = new TextMeasurer(font)
  fontMap = new Map([['default', measurer]])
})

// ─── Helpers ───

function collectAll(nodes: RenderNode[]): RenderNode[] {
  const result: RenderNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.type === 'group') result.push(...collectAll(node.children))
  }
  return result
}

function collectGroups(nodes: RenderNode[]): RenderGroup[] {
  return collectAll(nodes).filter(n => n.type === 'group') as RenderGroup[]
}

function collectTexts(nodes: RenderNode[]): RenderText[] {
  return collectAll(nodes).filter(n => n.type === 'text') as RenderText[]
}

// ─── Tests ───

describe('Phase 3: positionType / stretchType / バンド伸長', () => {
  describe('stretchWithOverflow によるバンド拡大', () => {
    // Verifies the band grows when stretchWithOverflow text exceeds the declared band height.
    it('stretchWithOverflow テキストがバンド高さを超えるとバンドが拡大する', () => {
      const longText = Array(10).fill('This is a long line.').join(' ')
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,  // intentionally small
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: `'${longText}'`,
                stretchWithOverflow: true,
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, fontMap)
      const page = doc.pages[0]!
      // The band group height grows beyond 20
      const bandGroup = page.children[0] as RenderGroup
      expect(bandGroup.height).toBeGreaterThan(20)
    })
  })

  describe('positionType: float', () => {
    // Verifies positionType=float elements shift down to follow a stretched element above.
    it('float 要素は上の要素の伸長に追従する', () => {
      const longText = Array(10).fill('Long text content.').join(' ')
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 40,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: `'${longText}'`,
                stretchWithOverflow: true,
              },
              {
                type: 'staticText', x: 0, y: 20, width: 100, height: 20,
                text: 'Float element',
                positionType: 'float',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, fontMap)
      const page = doc.pages[0]!
      const bandGroup = page.children[0] as RenderGroup

      // The float element moves below the stretched element
      // Check the effective height of the text group
      const children = bandGroup.children
      expect(children.length).toBe(2)

      // The second (float) element's Y must exceed the original 20
      const floatNode = children[1]!
      if (floatNode.type === 'group') {
        expect(floatNode.y).toBeGreaterThan(20)
      } else if (floatNode.type === 'text') {
        expect(floatNode.y).toBeGreaterThan(20)
      }
    })
  })

  describe('positionType: fixRelativeToBottom', () => {
    // Verifies fixRelativeToBottom keeps the element's distance from the band bottom when the band stretches.
    it('fixRelativeToBottom はバンド下端からの距離を維持', () => {
      const longText = Array(10).fill('Long text content.').join(' ')
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 40,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: `'${longText}'`,
                stretchWithOverflow: true,
              },
              {
                type: 'staticText', x: 0, y: 30, width: 100, height: 10,
                text: 'Bottom fixed',
                positionType: 'fixRelativeToBottom',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, fontMap)
      const page = doc.pages[0]!
      const bandGroup = page.children[0] as RenderGroup

      const children = bandGroup.children
      const bottomNode = children[1]!

      // Moved down by the amount the band stretched
      if (bottomNode.type === 'group') {
        expect(bottomNode.y).toBeGreaterThan(30)
      } else if (bottomNode.type === 'text') {
        expect(bottomNode.y).toBeGreaterThan(30)
      }
    })
  })

  describe('stretchType: containerHeight', () => {
    // Verifies stretchType=containerHeight resizes the element to the band's effective height.
    it('containerHeight: 要素の高さがバンドの実効高さになる', () => {
      const longText = Array(10).fill('Long text content.').join(' ')
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 40,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: `'${longText}'`,
                stretchWithOverflow: true,
              },
              {
                type: 'rectangle', x: 200, y: 0, width: 100, height: 40,
                stretchType: 'containerHeight',
                fill: '#CCCCCC',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, fontMap)
      const page = doc.pages[0]!
      const bandGroup = page.children[0] as RenderGroup

      // The rect height matches the band's effective height
      const rect = collectAll(bandGroup.children).find(n => n.type === 'rect') as RenderRect
      expect(rect).toBeDefined()
      expect(rect.height).toBe(bandGroup.height)
    })
  })

  describe('stretchType: containerBottom', () => {
    // Verifies stretchType=containerBottom extends the element bottom to the band's effective height.
    it('containerBottom: 要素の下端がバンドの実効高さになる', () => {
      const longText = Array(10).fill('Long text content.').join(' ')
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 40,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: `'${longText}'`,
                stretchWithOverflow: true,
              },
              {
                type: 'rectangle', x: 200, y: 10, width: 100, height: 30,
                stretchType: 'containerBottom',
                fill: '#CCCCCC',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, fontMap)
      const page = doc.pages[0]!
      const bandGroup = page.children[0] as RenderGroup

      // The rect bottom (y + height) matches the band's effective height
      const rect = collectAll(bandGroup.children).find(n => n.type === 'rect') as RenderRect
      expect(rect).toBeDefined()
      expect(rect.y + rect.height).toBe(bandGroup.height)
    })
  })

  describe('バンド伸長によるカーソル進行', () => {
    // Verifies the layout cursor advances by the stretched band height so the next band starts right below.
    it('伸長されたバンドの後の要素が正しい位置に配置される', () => {
      const longText = Array(10).fill('Long text content.').join(' ')
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: `'${longText}'`,
                stretchWithOverflow: true,
              },
            ],
          }],
          summary: {
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Summary' },
            ],
          },
        },
      }
      const doc = createReport(template, { rows: [{}] }, fontMap)
      const page = doc.pages[0]!

      // Bottom edge of the detail band group
      const detailGroup = page.children[0] as RenderGroup
      const detailBottom = detailGroup.y + detailGroup.height

      // The summary band group starts immediately after detail
      const summaryGroup = page.children[1] as RenderGroup
      expect(summaryGroup.y).toBe(detailBottom)
    })
  })
})
