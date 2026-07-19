import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderText, RenderRect, RenderImage, RenderGroup } from '../../src/types/render.js'

// ─── Helpers ───

function collectByType<T extends RenderNode>(nodes: RenderNode[], type: T['type']): T[] {
  const result: T[] = []
  for (const node of nodes) {
    if (node.type === type) result.push(node as T)
    if (node.type === 'group') result.push(...collectByType<T>(node.children, type))
  }
  return result
}

function collectTexts(nodes: RenderNode[]): RenderText[] {
  return collectByType<RenderText>(nodes, 'text')
}

/** Returns the index of the top-level band group in page children that contains the given text */
function findBandIndexContainingText(children: RenderNode[], value: string): number {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    if (child.type !== 'group') continue
    if (collectTexts(child.children).some(t => t.text === value)) return i
  }
  return -1
}

/** Returns the index of the top-level band group in page children that contains a rect */
function findBandIndexContainingRect(children: RenderNode[]): number {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    if (child.type !== 'group') continue
    if (collectByType<RenderRect>(child.children, 'rect').length > 0) return i
  }
  return -1
}

// ─── Tests ───

// Tests for the background band (common report-style page background rendered on every page).
describe('backgroundバンド', () => {
  // Verifies that background band elements (rectangle + staticText) are rendered on every page.
  it('rectangle + staticText が全ページに描画される', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        background: {
          height: 100,
          elements: [
            { type: 'rectangle', x: 0, y: 0, width: 200, height: 100, fill: '#EEEEEE' },
            { type: 'staticText', x: 5, y: 5, width: 100, height: 20, text: 'BG-WATERMARK' },
          ],
        },
        details: [{
          height: 30,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'DETAIL' },
          ],
        }],
      },
    }
    // 30pt x 7 rows / 100pt page = 3 rows per page = 3 pages
    const doc = createReport(template, { rows: [{}, {}, {}, {}, {}, {}, {}] })
    expect(doc.pages.length).toBe(3)

    for (const page of doc.pages) {
      const rects = collectByType<RenderRect>(page.children, 'rect')
      const bgRect = rects.find(r => r.fill === '#EEEEEE')
      expect(bgRect).toBeDefined()
      expect(bgRect!.width).toBe(200)
      expect(bgRect!.height).toBe(100)

      const texts = collectTexts(page.children)
      expect(texts.filter(t => t.text === 'BG-WATERMARK')).toHaveLength(1)
    }
  })

  // Verifies that the background band group is positioned inside the page margins (content-area based).
  it('背景バンドはマージンを考慮したコンテンツ領域基準で配置される', () => {
    // Implementation spec (engine.ts startNewPage / renderBandAt):
    // The background band is placed at cursorY = contentTop (= margins.top) as a band group
    // with x = marginLeft and width = contentWidth.
    // As in common report behavior, the inside of the margins is the band's coordinate origin.
    const template: ReportTemplate = {
      page: {
        width: 200, height: 200,
        margins: { top: 20, bottom: 10, left: 15, right: 5 },
      },
      bands: {
        background: {
          height: 170,
          elements: [
            { type: 'rectangle', x: 0, y: 0, width: 50, height: 30, fill: '#CCCCCC' },
          ],
        },
        details: [{ height: 30, elements: [] }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    expect(doc.pages.length).toBe(1)

    const page = doc.pages[0]!
    const bandIndex = findBandIndexContainingRect(page.children)
    expect(bandIndex).toBeGreaterThanOrEqual(0)

    const bandGroup = page.children[bandIndex] as RenderGroup
    // The band group is placed inside the margins
    expect(bandGroup.x).toBe(15)           // margins.left
    expect(bandGroup.y).toBe(20)           // margins.top
    expect(bandGroup.width).toBe(180)      // 200 - left 15 - right 5
    expect(bandGroup.height).toBe(170)     // Height from the band definition

    // Elements keep their band-relative coordinates
    const rect = collectByType<RenderRect>(bandGroup.children, 'rect')[0]!
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(0)
  })

  // Verifies that a background image element (letterhead paper) is drawn on every page and registered as a resource.
  it('image要素（source指定）との組み合わせ: 台紙が全ページに描画される', () => {
    const png = readFileSync(join(__dirname, '../sample/images/sample1.png'))
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        background: {
          height: 100,
          elements: [
            {
              type: 'image', x: 0, y: 0, width: 200, height: 100,
              source: 'paper', scaleMode: 'fillFrame',
            },
          ],
        },
        details: [{
          height: 40,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'DETAIL' },
          ],
        }],
      },
    }
    // 40pt x 5 rows / 100pt page = 2 rows per page = 3 pages
    const doc = createReport(template, { rows: [{}, {}, {}, {}, {}] }, {
      resources: {
        images: { paper: new Uint8Array(png) },
      },
    })
    expect(doc.pages.length).toBe(3)

    for (const page of doc.pages) {
      const images = collectByType<RenderImage>(page.children, 'image')
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toBe('paper')
      expect(images[0]!.width).toBe(200)
      expect(images[0]!.height).toBe(100)
    }

    // The image resource is registered in the document
    expect(doc.images).toBeDefined()
    expect(doc.images!['paper']).toBeDefined()
  })

  // Verifies z-order: the background band is first in page children, before pageHeader and detail.
  it('z順: 背景バンドは各ページの children 先頭で、pageHeader/detail より先に描画される', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        background: {
          height: 100,
          elements: [
            { type: 'rectangle', x: 0, y: 0, width: 200, height: 100, fill: '#EEEEEE' },
          ],
        },
        pageHeader: {
          height: 20,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'HEADER' },
          ],
        },
        details: [{
          height: 30,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'DETAIL' },
          ],
        }],
      },
    }
    // content 100 - header 20 = 80, so 2 rows per page = 2 pages
    const doc = createReport(template, { rows: [{}, {}, {}] })
    expect(doc.pages.length).toBe(2)

    for (const page of doc.pages) {
      const bgIndex = findBandIndexContainingRect(page.children)
      const headerIndex = findBandIndexContainingText(page.children, 'HEADER')
      const detailIndex = findBandIndexContainingText(page.children, 'DETAIL')

      // Background comes first (the renderer draws children in order, so it ends up at the back)
      expect(bgIndex).toBe(0)
      expect(headerIndex).toBeGreaterThan(bgIndex)
      expect(detailIndex).toBeGreaterThan(bgIndex)
      // pageHeader comes before detail
      expect(detailIndex).toBeGreaterThan(headerIndex)
    }
  })
})
