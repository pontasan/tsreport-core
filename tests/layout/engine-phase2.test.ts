import { describe, it, expect } from 'vitest'
import { createReport, type FontMap } from '../../src/layout/engine.js'
import type { TextMeasurer } from '../../src/measure/text-measurer.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderGroup, RenderText, RenderLine, RenderRect, RenderEllipse, RenderSvg, RenderImage, RenderNode } from '../../src/types/render.js'

// ─── Helpers ───

function createMockMeasurer(charWidth: number = 6): TextMeasurer {
  const unitsPerEm = 1000
  const advanceFontUnits = charWidth * (unitsPerEm / 10)
  return {
    font: {
      metrics: { unitsPerEm, ascender: 800, descender: -200, lineGap: 0 },
      getGlyphId: () => 0,
      getAdvanceWidth: () => advanceFontUnits,
      getAdvanceHeight: () => advanceFontUnits,
    },
    measure(text: string, fontSize: number) {
      const scale = fontSize / unitsPerEm
      const advances = new Float64Array(text.length)
      const advancePt = advanceFontUnits * scale
      let width = 0
      for (let i = 0; i < text.length; i++) {
        advances[i] = advancePt
        width += advancePt
      }
      return { width, advances }
    },
    measureShaped(text: string, fontSize: number) {
      const m = this.measure(text, fontSize)
      const n = m.advances.length
      const shaped = new Array(n)
      const cpToGlyph = new Int32Array(n)
      for (let i = 0; i < n; i++) {
        shaped[i] = { glyphId: 0, xOffset: 0, yOffset: 0, xAdvance: advanceFontUnits, yAdvance: advanceFontUnits, componentCount: 1 }
        cpToGlyph[i] = i
      }
      return { width: m.width, advances: m.advances, shaped, cpToGlyph }
    },
    getLineHeight(fontSize: number) {
      return fontSize
    },
    getAscent(fontSize: number) {
      return (800 / unitsPerEm) * fontSize
    },
    getDescent(fontSize: number) {
      return (-200 / unitsPerEm) * fontSize
    },
  } as unknown as TextMeasurer
}

const mockFontMap: FontMap = new Map([['default', createMockMeasurer()]])

function collectAll(nodes: RenderNode[]): RenderNode[] {
  const result: RenderNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.type === 'group') result.push(...collectAll(node.children))
  }
  return result
}

function collectTexts(nodes: RenderNode[]): RenderText[] {
  return collectAll(nodes).filter(n => n.type === 'text') as RenderText[]
}

function collectLines(nodes: RenderNode[]): RenderLine[] {
  return collectAll(nodes).filter(n => n.type === 'line') as RenderLine[]
}

function collectRects(nodes: RenderNode[]): RenderRect[] {
  return collectAll(nodes).filter(n => n.type === 'rect') as RenderRect[]
}

function collectGroups(nodes: RenderNode[]): RenderGroup[] {
  return collectAll(nodes).filter(n => n.type === 'group') as RenderGroup[]
}

// ─── Tests ───

describe('Phase 2: ボーダー・パディング・要素共通プロパティ', () => {
  describe('ボーダー', () => {
    // Verifies that a style-defined border generates RenderLine nodes for all four edges.
    it('スタイルにボーダーが定義されていると RenderLine が生成される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [{
          name: 'Bordered',
          border: { width: 1, color: '#000000', style: 'solid' },
        }],
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 10, y: 5, width: 100, height: 20,
                text: 'Bordered', style: 'Bordered',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, mockFontMap)
      const lines = collectLines(doc.pages[0]!.children)
      // Four border edges = four RenderLine nodes
      expect(lines.length).toBe(4)
      expect(lines.every(l => l.color === '#000000')).toBe(true)
      expect(lines.every(l => l.lineWidth === 1)).toBe(true)
    })

    // Verifies per-edge border overrides: top is overridden and bottom=null omits that edge.
    it('各辺を個別に指定できる', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [{
          name: 'PartialBorder',
          border: {
            width: 1, color: '#000000', style: 'solid',
            top: { width: 2, color: '#FF0000', style: 'solid' },
            bottom: null,  // no bottom edge
          },
        }],
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Partial', style: 'PartialBorder',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, mockFontMap)
      const lines = collectLines(doc.pages[0]!.children)
      // bottom=null, so only 3 lines
      expect(lines.length).toBe(3)
      // top is red and thicker
      const topLine = lines.find(l => l.y1 === 0 && l.y2 === 0)
      expect(topLine).toBeDefined()
      expect(topLine!.color).toBe('#FF0000')
      expect(topLine!.lineWidth).toBe(2)
    })

    // Verifies dashed border style produces lines with a dash pattern.
    it('dashed/dotted ボーダースタイル', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [{
          name: 'Dashed',
          border: { width: 1, color: '#000000', style: 'dashed' },
        }],
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Dashed', style: 'Dashed',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, mockFontMap)
      const lines = collectLines(doc.pages[0]!.children)
      expect(lines.length).toBe(4)
      expect(lines.every(l => l.dash !== undefined)).toBe(true)
    })

    // Verifies borders are drawn on a non-clipping outer wrapper while content sits in an inner clipped group.
    it('clip 付き要素のボーダーは外側ラッパーで描画される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [{
          name: 'Bordered',
          border: { width: 1, color: '#000000', style: 'solid' },
        }],
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 10, y: 5, width: 100, height: 20,
                text: 'Bordered', style: 'Bordered',
              },
            ],
          }],
        },
      }

      const doc = createReport(template, { rows: [{}] }, mockFontMap)
      const groups = collectGroups(doc.pages[0]!.children)
      const wrapper = groups.find(g =>
        g.x === 10 && g.y === 5 && g.width === 100 && g.height === 20 &&
        g.children.some(n => n.type === 'line') &&
        g.children.some(n => n.type === 'group'),
      )

      expect(wrapper).toBeDefined()
      expect(wrapper!.clip).toBeUndefined()

      const inner = wrapper!.children.find(n => n.type === 'group') as RenderGroup | undefined
      expect(inner).toBeDefined()
      expect(inner!.clip).toBe(true)
    })

    // Verifies border line endpoints are extended by half the line width so corners overlap.
    it('四辺ボーダーは角で重なるように端点を延長する', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [{
          name: 'Bordered',
          border: { width: 2, color: '#000000', style: 'solid' },
        }],
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Bordered', style: 'Bordered',
              },
            ],
          }],
        },
      }

      const doc = createReport(template, { rows: [{}] })
      const lines = collectLines(doc.pages[0]!.children)

      const topLine = lines.find(l => l.y1 === 0 && l.y2 === 0)
      const bottomLine = lines.find(l => l.y1 === 20 && l.y2 === 20)
      const leftLine = lines.find(l => l.x1 === 0 && l.x2 === 0)
      const rightLine = lines.find(l => l.x1 === 100 && l.x2 === 100)

      expect(topLine).toBeDefined()
      expect(bottomLine).toBeDefined()
      expect(leftLine).toBeDefined()
      expect(rightLine).toBeDefined()

      expect(topLine!.x1).toBe(-1)
      expect(topLine!.x2).toBe(101)
      expect(bottomLine!.x1).toBe(-1)
      expect(bottomLine!.x2).toBe(101)
      expect(leftLine!.y1).toBe(-1)
      expect(leftLine!.y2).toBe(21)
      expect(rightLine!.y1).toBe(-1)
      expect(rightLine!.y2).toBe(21)
    })

    // Verifies line/rectangle/ellipse ignore style.border and draw only their own strokes.
    it('line/rectangle/ellipse は style.border を適用しない（自己描画を優先）', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [{
          name: 'Bordered',
          border: { width: 1, color: '#000000', style: 'solid' },
        }],
        bands: {
          details: [{
            height: 120,
            elements: [
              {
                type: 'line', x: 10, y: 10, width: 40, height: 0,
                style: 'Bordered', lineWidth: 2, lineColor: '#AA0000',
              },
              {
                type: 'rectangle', x: 10, y: 30, width: 40, height: 20,
                style: 'Bordered', stroke: '#00AA00', strokeWidth: 2,
              },
              {
                type: 'ellipse', x: 10, y: 60, width: 40, height: 20,
                style: 'Bordered', stroke: '#0000AA', strokeWidth: 2,
              },
            ],
          }],
        },
      }

      const doc = createReport(template, { rows: [{}] })
      const lines = collectLines(doc.pages[0]!.children)
      const rects = collectRects(doc.pages[0]!.children)

      // No border lines from style.border; only the line element's own single line
      expect(lines.length).toBe(1)
      expect(lines[0]!.lineWidth).toBe(2)
      expect(lines[0]!.color).toBe('#AA0000')

      // rectangle draws only its own stroke
      const rect = rects.find(r => r.stroke === '#00AA00')
      expect(rect).toBeDefined()
      expect(rect!.x).toBe(10)
      expect(rect!.y).toBe(30)

      // ellipse is emitted as a RenderEllipse (no extra lines from style.border)
      const all = collectAll(doc.pages[0]!.children)
      const ellipse = all.find(n => n.type === 'ellipse') as RenderEllipse | undefined
      expect(ellipse).toBeDefined()
      expect(ellipse!.stroke).toBe('#0000AA')
    })
  })

  describe('mode (opaque/transparent)', () => {
    // Verifies mode=opaque renders a background rect using the element backcolor.
    it('mode=opaque で背景色が描画される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Opaque', mode: 'opaque', backcolor: '#FFFF00',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const rects = collectRects(doc.pages[0]!.children)
      // A background RenderRect exists
      const bgRect = rects.find(r => r.fill === '#FFFF00')
      expect(bgRect).toBeDefined()
    })

    // Verifies the default transparent mode renders no background rect even if backcolor is set.
    it('mode 未指定（transparent）では背景色なし', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Transparent', backcolor: '#FFFF00',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const rects = collectRects(doc.pages[0]!.children)
      const bgRect = rects.find(r => r.fill === '#FFFF00')
      expect(bgRect).toBeUndefined()
    })
  })

  describe('opacity', () => {
    // Verifies style opacity is propagated to the decoration wrapper RenderGroup.
    it('opacity がスタイルで設定されると RenderGroup.opacity に反映される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [{ name: 'Semi', opacity: 0.5, border: { width: 1, color: '#000', style: 'solid' } }],
        bands: {
          details: [{
            height: 30,
            elements: [
              {
                type: 'staticText', x: 0, y: 0, width: 100, height: 20,
                text: 'Semi', style: 'Semi',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const groups = collectGroups(doc.pages[0]!.children)
      // The border/background wrapper has opacity 0.5
      const semiGroup = groups.find(g => g.opacity === 0.5)
      expect(semiGroup).toBeDefined()
    })

    it('keeps opacity on an affine Form group so compositing starts after its transform', () => {
      const template: ReportTemplate = {
        page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 200,
            elements: [{
              type: 'frame', x: -100, y: -120, width: 10, height: 10,
              opacity: 0.3,
              transparencyGroup: true,
              affineTransform: [1, 0, 0, 1, 100, 120],
              pdfForm: { bbox: [0, 0, 10, 10], matrix: [1, 0, 0, 1, 0, 0] },
              elements: [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10, fill: '#ffffff' }],
            }],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const affine = collectGroups(doc.pages[0]!.children).find(function (group) {
        return group.affineTransform !== undefined
      })

      expect(affine).toMatchObject({
        x: -100, y: -120, width: 10, height: 10,
        opacity: 0.3,
        transparencyGroup: true,
        affineTransform: [1, 0, 0, 1, 100, 120],
      })
      expect(affine!.children).toHaveLength(1)
    })

    it('does not clip children of a non-clipping graphics-state frame', () => {
      const template: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 100,
            elements: [{
              type: 'frame', x: 10, y: 10, width: 10, height: 10, clip: false,
              deviceParams: { strokeAdjustment: true },
              elements: [{ type: 'rectangle', x: 20, y: 0, width: 10, height: 10, fill: '#ffffff' }],
            }],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const scoped = collectGroups(doc.pages[0]!.children).find(function (group) {
        return group.deviceParams !== undefined
      })

      expect(scoped).toMatchObject({ x: 10, y: 10, width: 10, height: 10, clip: false })
      expect(collectRects(scoped!.children)[0]).toMatchObject({ x: 20, y: 0, width: 10, height: 10 })
    })
  })

  // Decoration wrappers (opacity/border/background) re-base child nodes to local coordinates.
  describe('装飾ラッパーの座標正規化', () => {
    // Verifies decorated elements are re-based to local (0,0) coordinates inside their wrapper group.
    it('rectangle/line/ellipse/svg/image はラッパー内で相対座標(0基点)になる', () => {
      const png1x1 = Uint8Array.from(
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Wk5sAAAAASUVORK5CYII=', 'base64'),
      )

      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        styles: [{ name: 'Decorated', opacity: 0.5 }],
        bands: {
          details: [{
            height: 80,
            elements: [
              {
                type: 'rectangle', x: 10, y: 20, width: 30, height: 40,
                style: 'Decorated', stroke: '#112233', strokeWidth: 2,
              },
              {
                type: 'line', x: 60, y: 20, width: 30, height: 40,
                style: 'Decorated', lineColor: '#AA0000', lineWidth: 2,
              },
              {
                type: 'ellipse', x: 110, y: 20, width: 30, height: 40,
                style: 'Decorated', stroke: '#00AA00', strokeWidth: 2,
              },
              {
                type: 'svg', x: 160, y: 20, width: 30, height: 40,
                style: 'Decorated',
                svgContent: '"<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"1\\" height=\\"1\\"></svg>"',
              },
              {
                type: 'image', x: 210, y: 20, width: 30, height: 40,
                style: 'Decorated', source: 'dot', scaleMode: 'fillFrame',
              },
            ],
          }],
        },
      }

      const doc = createReport(template, { rows: [{}] }, {
        resources: {
          images: { dot: png1x1 },
          imageSizes: { dot: { width: 1, height: 1 } },
        },
      })
      const groups = collectGroups(doc.pages[0]!.children)

      const rectWrapper = groups.find(g => g.x === 10 && g.y === 20 && g.width === 30 && g.height === 40)
      expect(rectWrapper).toBeDefined()
      const rectNode = rectWrapper!.children.find(n => n.type === 'rect' && n.stroke === '#112233') as RenderRect | undefined
      expect(rectNode).toBeDefined()
      expect(rectNode!.x).toBe(0)
      expect(rectNode!.y).toBe(0)

      const lineWrapper = groups.find(g => g.x === 60 && g.y === 20 && g.width === 30 && g.height === 40)
      expect(lineWrapper).toBeDefined()
      const lineNode = lineWrapper!.children.find(n => n.type === 'line' && n.lineWidth === 2 && n.color === '#AA0000') as RenderLine | undefined
      expect(lineNode).toBeDefined()
      expect(lineNode!.x1).toBe(0)
      expect(lineNode!.y1).toBe(0)
      expect(lineNode!.x2).toBe(30)
      expect(lineNode!.y2).toBe(40)

      const ellipseWrapper = groups.find(g => g.x === 110 && g.y === 20 && g.width === 30 && g.height === 40)
      expect(ellipseWrapper).toBeDefined()
      const ellipseNode = ellipseWrapper!.children.find(n => n.type === 'ellipse' && n.stroke === '#00AA00') as RenderEllipse | undefined
      expect(ellipseNode).toBeDefined()
      expect(ellipseNode!.cx).toBe(15)
      expect(ellipseNode!.cy).toBe(20)

      const svgWrapper = groups.find(g => g.x === 160 && g.y === 20 && g.width === 30 && g.height === 40)
      expect(svgWrapper).toBeDefined()
      const svgNode = svgWrapper!.children.find(n => n.type === 'svg') as RenderSvg | undefined
      expect(svgNode).toBeDefined()
      expect(svgNode!.x).toBe(0)
      expect(svgNode!.y).toBe(0)

      const imageWrapper = groups.find(g => g.x === 210 && g.y === 20 && g.width === 30 && g.height === 40)
      expect(imageWrapper).toBeDefined()
      const imageNode = imageWrapper!.children.find(n => n.type === 'image' && n.imageId === 'dot') as RenderImage | undefined
      expect(imageNode).toBeDefined()
      expect(imageNode!.x).toBe(0)
      expect(imageNode!.y).toBe(0)
    })
  })

  describe('isPrintRepeatedValues', () => {
    // Verifies isPrintRepeatedValues=false hides consecutive duplicate field values after the first.
    it('同じ値が連続する場合に2回目以降は非表示', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        fields: [{ name: 'dept', type: 'string' }, { name: 'name', type: 'string' }],
        bands: {
          details: [{
            height: 20,
            elements: [
              {
                type: 'textField', x: 0, y: 0, width: 100, height: 20,
                expression: 'field.dept', isPrintRepeatedValues: false,
              },
              {
                type: 'textField', x: 100, y: 0, width: 100, height: 20,
                expression: 'field.name',
              },
            ],
          }],
        },
      }
      const doc = createReport(template, {
        rows: [
          { dept: '営業', name: '田中' },
          { dept: '営業', name: '鈴木' },
          { dept: '開発', name: '佐藤' },
        ],
      })
      const page = doc.pages[0]!
      const texts = collectTexts(page.children)

      // '' 1display.
      
      const deptTexts = texts.filter(t => t.text === '営業')
      expect(deptTexts.length).toBe(1)

      // '' display.
      
      expect(texts.some(t => t.text === '開発')).toBe(true)

      // All names are displayed
      expect(texts.filter(t => t.text === '田中').length).toBe(1)
      expect(texts.filter(t => t.text === '鈴木').length).toBe(1)
      expect(texts.filter(t => t.text === '佐藤').length).toBe(1)
    })
  })
})
