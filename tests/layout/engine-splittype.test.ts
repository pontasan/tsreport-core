import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderGroup, RenderNode } from '../../src/types/render.js'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { readFileSync } from 'node:fs'

// ─── Helpers ───

/** Returns the top-level groups (bands) directly under a page */
function topGroups(page: import('../../src/types/render.js').RenderPage): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (let i = 0; i < page.children.length; i++) {
    const child = page.children[i]!
    if (child.type === 'group') groups.push(child)
  }
  return groups
}

/** Recursively collects text nodes from a RenderNode tree */
function collectTexts(nodes: RenderNode[]): import('../../src/types/render.js').RenderText[] {
  const texts: import('../../src/types/render.js').RenderText[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') {
      const sub = collectTexts(node.children)
      for (let j = 0; j < sub.length; j++) texts.push(sub[j]!)
    }
  }
  return texts
}

/** Recursively collects only the text nodes actually visible after applying clip regions */
function collectVisibleTexts(
  nodes: RenderNode[],
  offsetY: number = 0,
  clipTop: number = Number.NEGATIVE_INFINITY,
  clipBottom: number = Number.POSITIVE_INFINITY,
): import('../../src/types/render.js').RenderText[] {
  const texts: import('../../src/types/render.js').RenderText[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'group') {
      const groupTop = offsetY + node.y
      const groupBottom = groupTop + node.height
      const nextClipTop = node.clip ? (groupTop > clipTop ? groupTop : clipTop) : clipTop
      const nextClipBottom = node.clip ? (groupBottom < clipBottom ? groupBottom : clipBottom) : clipBottom
      const sub = collectVisibleTexts(node.children, groupTop, nextClipTop, nextClipBottom)
      for (let j = 0; j < sub.length; j++) texts.push(sub[j]!)
      continue
    }
    if (node.type !== 'text') continue
    const top = offsetY + node.y
    const bottom = top + node.fontSize * 1.2
    if (bottom <= clipTop || top >= clipBottom) continue
    texts.push(node)
  }
  return texts
}

const robotoBuf = readFileSync('tests/fixtures/fonts/Roboto-Regular.ttf')
const robotoFont = Font.load(robotoBuf.buffer.slice(robotoBuf.byteOffset, robotoBuf.byteOffset + robotoBuf.byteLength) as ArrayBuffer)
const stretchFontMap = new Map([['default', new TextMeasurer(robotoFont)]])

// ─── Tests ───

describe('splitType', () => {
  describe('immediate', () => {
    // Verifies immediate split distributes a band's elements across pages at the overflow point.
    it('バンドがオーバーフロー時に要素をページ間で分割する', () => {
      // Page height 200, no margins → content area 200pt
      // detail band height 150, splitType=immediate
      // Element 1: y=0, height=50 → bottom=50 (fits on current page)
      // Element 2: y=60, height=80 → bottom=140 (fits on current page)
      // Row 1 fits entirely. Row 2 has remaining=50pt, element 2 does not fit → split
      const template: ReportTemplate = {
        page: {
          width: 200, height: 200,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 150,
            splitType: 'immediate',
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 50, text: 'Top' },
              { type: 'staticText', x: 0, y: 60, width: 100, height: 80, text: 'Bottom' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}, {}] })

      // Row 1: 150pt → OK, fits in 200pt
      // Row 2: cursorY=150, remaining=50pt, band=150pt → overflow
      // immediate split: element 1 (bottom=50) fits in 50pt, element 2 (bottom=140) does not
      expect(doc.pages.length).toBe(2)

      // Page 1: all of row 1 + the first half of split row 2
      const p1groups = topGroups(doc.pages[0]!)
      // Row 1 band + first-half split group of row 2
      expect(p1groups.length).toBe(2)

      // The first half of row 2 (y=150, split group) contains only the Top element
      const splitGroup1 = p1groups[1]!
      expect(splitGroup1.y).toBe(150)
      expect(splitGroup1.height).toBe(50)
      const texts1 = collectTexts(splitGroup1.children)
      expect(texts1.length).toBe(1)
      expect(texts1[0]!.text).toBe('Top')

      // Page 2: the second-half split group of row 2
      const p2groups = topGroups(doc.pages[1]!)
      expect(p2groups.length).toBeGreaterThanOrEqual(1)
      // The second-half split group contains the Bottom element
      const splitGroup2 = p2groups[p2groups.length - 1]!
      const texts2 = collectTexts(splitGroup2.children)
      expect(texts2.length).toBe(1)
      expect(texts2[0]!.text).toBe('Bottom')
    })

    // Verifies no split happens when the whole band fits on the page.
    it('全要素が収まる場合は分割しない（1ページ）', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 500,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 100,
            splitType: 'immediate',
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 40, text: 'A' },
              { type: 'staticText', x: 0, y: 50, width: 100, height: 40, text: 'B' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })

      // No overflow, so normal rendering
      expect(doc.pages.length).toBe(1)
      const groups = topGroups(doc.pages[0]!)
      expect(groups.length).toBe(1)
      const texts = collectTexts(groups[0]!.children)
      expect(texts.length).toBe(2)
    })

    // Verifies elements whose bottom fits within availableHeight stay on the current page during a split.
    it('全要素がavailableHeight以内に収まる場合はすべて現在ページに配置', () => {
      // Page height 200, detail 100pt
      // Row 1 → cursorY=100, overflow detected on row 2
      // available=100pt, all element bottoms < 100 → everything stays on the current page
      const template: ReportTemplate = {
        page: {
          width: 200, height: 200,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 150,
            splitType: 'immediate',
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 30, text: 'A' },
              { type: 'staticText', x: 0, y: 40, width: 100, height: 30, text: 'B' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}, {}] })

      // Row 2: cursorY=150, availableHeight=50
      // Element A: bottom=30 ≤ 50 → current page
      // Element B: bottom=70 > 50 → next page
      expect(doc.pages.length).toBe(2)

      const p1groups = topGroups(doc.pages[0]!)
      // Row 1 band + first half of split row 2
      const splitGroup = p1groups[p1groups.length - 1]!
      const textsP1 = collectTexts(splitGroup.children)
      expect(textsP1.length).toBe(1)
      expect(textsP1[0]!.text).toBe('A')
    })

    // Verifies carried-over elements on the next page are shifted upward by availableHeight.
    it('次ページの要素Y座標がavailableHeight分オフセットされる', () => {
      // Page height 100, detail 80pt
      // Row 1 → cursorY=80, overflow on row 2
      // available=20pt
      // Element 1: y=0, height=15, bottom=15 ≤ 20 → current page
      // Element 2: y=30, height=40, bottom=70 > 20 → next page (y offset by -20 → y=10)
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 80,
            splitType: 'immediate',
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 15, text: 'Fits' },
              { type: 'staticText', x: 0, y: 30, width: 100, height: 40, text: 'Overflows' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}, {}] })

      expect(doc.pages.length).toBe(2)

      // Second-half split group on page 2
      const p2groups = topGroups(doc.pages[1]!)
      const splitGroup = p2groups[p2groups.length - 1]!
      const texts = collectTexts(splitGroup.children)
      expect(texts.length).toBe(1)
      expect(texts[0]!.text).toBe('Overflows')
      // Original y=30 minus availableHeight=20 → 10
      expect(texts[0]!.y).toBe(10)
    })

    // Verifies availableHeight subtracts the pageFooter height during an immediate split.
    it('pageFooter がある場合のavailableHeight計算', () => {
      // Page height 200, pageFooter height 30
      // needsOverflow threshold: contentBottom(200) - pageFooterHeight(30) = 170
      // detail 120pt
      // Row 1 → cursorY=120, row 2: 120+120=240 > 170 → overflow
      // availableHeight = 200 - 30 - 120 = 50
      const template: ReportTemplate = {
        page: {
          width: 200, height: 200,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 120,
            splitType: 'immediate',
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 40, text: 'Top' },
              { type: 'staticText', x: 0, y: 60, width: 100, height: 50, text: 'Bottom' },
            ],
          }],
          pageFooter: {
            height: 30,
            elements: [],
          },
        },
      }
      const doc = createReport(template, { rows: [{}, {}] })

      // Row 2: cursorY=120, contentBottom=200, pageFooterHeight=30
      // availableHeight = 200 - 30 - 120 = 50
      // Element Top: bottom=40 ≤ 50 → current page
      // Element Bottom: bottom=110 > 50 → next page
      expect(doc.pages.length).toBe(2)

      // Page 1: row 1 band + first-half split + pageFooter (finalizePage)
      // pageFooter is appended last by finalizePage,
      // so the first-half split group is the one at y=120
      const p1groups = topGroups(doc.pages[0]!)
      let splitGroup: RenderGroup | undefined
      for (let i = 0; i < p1groups.length; i++) {
        if (p1groups[i]!.y === 120) {
          splitGroup = p1groups[i]!
          break
        }
      }
      expect(splitGroup).toBeDefined()
      expect(splitGroup!.height).toBe(50)
      const textsP1 = collectTexts(splitGroup!.children)
      expect(textsP1.length).toBe(1)
      expect(textsP1[0]!.text).toBe('Top')
    })
  })

  describe('stretch', () => {
    it('design height が残り高さを超える場合は次ページから開始する', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 200,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 150,
            splitType: 'stretch',
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 30, text: 'Text' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}, {}] })

      expect(doc.pages.length).toBe(2)

      const page1Texts = collectTexts(doc.pages[0]!.children)
      expect(page1Texts.filter(text => text.text === 'Text')).toHaveLength(1)

      const page2Groups = topGroups(doc.pages[1]!)
      expect(page2Groups.length).toBe(1)
      expect(page2Groups[0]!.y).toBe(0)
      expect(page2Groups[0]!.height).toBe(150)
    })

    it('pageFooter 分を除いた残り高さで design height を判定する', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 200,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 100,
            splitType: 'stretch',
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'A' },
            ],
          }],
          pageFooter: {
            height: 40,
            elements: [],
          },
        },
      }
      const doc = createReport(template, { rows: [{}, {}] })

      expect(doc.pages.length).toBe(2)

      const page1Texts = collectTexts(doc.pages[0]!.children)
      expect(page1Texts.filter(text => text.text === 'A')).toHaveLength(1)

      const page2Groups = topGroups(doc.pages[1]!)
      const secondBand = page2Groups[0]!
      expect(secondBand.y).toBe(0)
      expect(secondBand.height).toBe(100)
    })

    it('design height は収まるが stretch した実高さが溢れる場合は次ページへ継続する', () => {
      const template: ReportTemplate = {
        page: {
          width: 180, height: 80,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 20,
            splitType: 'stretch',
            elements: [
              { type: 'textField', x: 0, y: 6, width: 160, height: 14, expression: 'field.body', stretchWithOverflow: true },
            ],
          }],
          pageFooter: {
            height: 10,
            elements: [],
          },
        },
      }
      const data: DataSource = {
        rows: [{
          body: 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12',
        }],
      }
      const doc = createReport(template, data, stretchFontMap)

      expect(doc.pages.length).toBeGreaterThan(1)

      const page1Texts = collectTexts(doc.pages[0]!.children).map(text => text.text)
      const page2TextNodes = collectTexts(doc.pages[1]!.children)
      const page2Texts = page2TextNodes.map(text => text.text)

      expect(page1Texts.some(text => text.includes('L1'))).toBe(true)
      expect(page2Texts.some(text => text.includes('L10') || text.includes('L11') || text.includes('L12'))).toBe(true)
      expect(page2TextNodes[0]!.y).toBeLessThanOrEqual(2)
    })

    it('summary でも stretch overflow を継続し pageFooter と重ならない', () => {
      const template: ReportTemplate = {
        page: {
          width: 180, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{ height: 40, elements: [{ type: 'staticText', x: 0, y: 0, width: 40, height: 10, text: 'D' }] }],
          summary: {
            height: 20,
            splitType: 'stretch',
            elements: [
              { type: 'textField', x: 0, y: 4, width: 160, height: 14, expression: 'param.body', stretchWithOverflow: true },
            ],
          },
          pageFooter: {
            height: 12,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Footer' },
            ],
          },
        },
      }
      const doc = createReport(template, { rows: [{}], parameters: { body: 'S1\nS2\nS3\nS4\nS5\nS6\nS7\nS8\nS9\nS10' } }, stretchFontMap)

      expect(doc.pages.length).toBeGreaterThan(1)

      for (let i = 0; i < doc.pages.length; i++) {
        const groups = topGroups(doc.pages[i]!)
        const footerGroup = groups.find(group => collectTexts(group.children).some(text => text.text === 'Footer'))
        const summaryGroup = groups.find(group => collectTexts(group.children).some(text => text.text.includes('S')))
        if (!footerGroup || !summaryGroup) continue
        expect(summaryGroup.y + summaryGroup.height).toBeLessThanOrEqual(footerGroup.y)
      }
    })

    it('summary だけのページでも stretchWithOverflow テキストの前半を1ページ目、残りを2ページ目以降へ継続する', () => {
      const template: ReportTemplate = {
        page: {
          width: 180, height: 80,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          summary: {
            height: 20,
            splitType: 'stretch',
            elements: [
              { type: 'textField', x: 0, y: 0, width: 160, height: 12, expression: 'param.body', stretchWithOverflow: true },
            ],
          },
        },
      }
      const lines = Array.from({ length: 18 }, (_, index) => `Summary line ${String(index + 1).padStart(2, '0')}`)
      const doc = createReport(template, { rows: [{}], parameters: { body: lines.join('\n') } }, stretchFontMap)

      expect(doc.pages.length).toBeGreaterThan(1)

      const page1Groups = topGroups(doc.pages[0]!)
      expect(page1Groups).toHaveLength(1)
      expect(page1Groups[0]!.y).toBe(0)

      const page1Texts = collectVisibleTexts(doc.pages[0]!.children).map(text => text.text)
      const laterTexts = doc.pages
        .slice(1)
        .flatMap(page => collectVisibleTexts(page.children).map(text => text.text))

      expect(page1Texts.some(text => text === 'Summary line 01')).toBe(true)
      expect(page1Texts.some(text => text === 'Summary line 18')).toBe(false)
      expect(laterTexts.some(text => text === 'Summary line 18')).toBe(true)
      expect(laterTexts.some(text => text === 'Summary line 01')).toBe(false)
    })

    it('summary stretch の継続ページに columnHeader/columnFooter を描画しない', () => {
      const template: ReportTemplate = {
        page: {
          width: 180, height: 80,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        columns: {
          count: 2,
          width: 90,
          spacing: 0,
        },
        summaryWithPageHeaderAndFooter: true,
        bands: {
          pageHeader: {
            height: 10,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'PageHeader' },
            ],
          },
          pageFooter: {
            height: 10,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'PageFooter' },
            ],
          },
          columnHeader: {
            height: 10,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'ColumnHeader' },
            ],
          },
          columnFooter: {
            height: 10,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'ColumnFooter' },
            ],
          },
          details: [{
            height: 20,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'Detail' },
            ],
          }],
          summary: {
            height: 20,
            startNewPage: true,
            splitType: 'stretch',
            elements: [
              { type: 'textField', x: 0, y: 0, width: 160, height: 12, expression: 'param.body', stretchWithOverflow: true },
            ],
          },
        },
      }
      const lines = Array.from({ length: 18 }, (_, index) => `Summary stretch ${String(index + 1).padStart(2, '0')}`)
      const doc = createReport(template, { rows: [{}], parameters: { body: lines.join('\n') } }, stretchFontMap)

      expect(doc.pages.length).toBeGreaterThan(2)

      for (let i = 1; i < doc.pages.length; i++) {
        const texts = collectTexts(doc.pages[i]!.children).map(text => text.text)
        expect(texts.some(text => text.startsWith('Summary stretch'))).toBe(true)
        expect(texts.some(text => text === 'ColumnHeader')).toBe(false)
        expect(texts.some(text => text === 'ColumnFooter')).toBe(false)
      }
    })

    it('stretch overflow の継続ページでは先頭の空白を持ち越さない', () => {
      const template: ReportTemplate = {
        page: {
          width: 180, height: 80,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 20,
            splitType: 'stretch',
            elements: [
              { type: 'textField', x: 0, y: 10, width: 160, height: 10, expression: 'field.body', stretchWithOverflow: true },
            ],
          }],
          pageFooter: {
            height: 10,
            elements: [],
          },
        },
      }
      const doc = createReport(template, { rows: [{ body: 'A1\nA2\nA3\nA4\nA5\nA6\nA7\nA8\nA9\nA10' }] }, stretchFontMap)

      expect(doc.pages.length).toBeGreaterThan(1)
      const page2Texts = collectTexts(doc.pages[1]!.children)
      expect(page2Texts[0]!.y).toBeLessThanOrEqual(2)
    })
  })

  describe('prevent（既存動作の確認）', () => {
    it('オーバーフロー時にバンド全体を次のページに移動する', () => {
      // Pageheight 100.
      
      // detail 60pt, splitType=prevent
      // 1row -> cursorY=60, 2row with 60+60>100 -> overflow -> break page.
      
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 60,
            splitType: 'prevent',
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 30, text: 'Data' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}, {}] })

      expect(doc.pages.length).toBe(2)

      // 1page: 1row.
      
      const p1groups = topGroups(doc.pages[0]!)
      expect(p1groups.length).toBe(1)
      expect(p1groups[0]!.y).toBe(0)

      // 2page: 2row.
      
      const p2groups = topGroups(doc.pages[1]!)
      expect(p2groups.length).toBe(1)
      expect(p2groups[0]!.y).toBe(0)
    })
  })

  describe('デフォルト（splitType未指定）', () => {
    it('オーバーフロー時にバンド全体を次のページに移動する', () => {
      const template: ReportTemplate = {
        page: {
          width: 200, height: 100,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bands: {
          details: [{
            height: 60,
            // SplitType.
            
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 100, height: 30, text: 'Data' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}, {}] })

      expect(doc.pages.length).toBe(2)

      const p1groups = topGroups(doc.pages[0]!)
      expect(p1groups.length).toBe(1)

      const p2groups = topGroups(doc.pages[1]!)
      expect(p2groups.length).toBe(1)
    })
  })
})
