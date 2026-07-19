import { describe, it, expect } from 'vitest'
import { createReport, createReportBook, combineReports } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderNode, RenderText, RenderDocument } from '../../src/types/render.js'



function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function pageTexts(doc: RenderDocument, pageIndex: number): string[] {
  return collectTexts(doc.pages[pageIndex]!.children).map(t => t.text)
}


function simpleTemplate(name: string, options?: {
  landscape?: boolean
  detailHeight?: number
}): ReportTemplate {
  return {
    name,
    page: {
      size: 'A4',
      orientation: options?.landscape === true ? 'landscape' : 'portrait',
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
    },
    bands: {
      details: [{
        height: options?.detailHeight ?? 700,
        elements: [
          { type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: 'field.label' },
        ],
      }],
      pageFooter: {
        height: 20,
        elements: [
          {
            type: 'textField', x: 0, y: 0, width: 100, height: 20,
            expression: '`P${PAGE_NUMBER}`',
          },
          {
            type: 'textField', x: 100, y: 0, width: 100, height: 20,
            expression: '`of ${TOTAL_PAGES}`',
            evaluationTime: 'report',
          },
        ],
      },
    } as ReportTemplate['bands'],
  }
}

function rows(prefix: string, count: number): DataSource {
  const result: Record<string, unknown>[] = []
  for (let i = 0; i < count; i++) result.push({ label: prefix + (i + 1) })
  return { rows: result }
}

// ─── createReportBook ───

describe('createReportBook', () => {
  it('複数パートのページが順に結合される', () => {
    const doc = createReportBook([
      { template: simpleTemplate('p1'), data: rows('A', 2) },
      { template: simpleTemplate('p2'), data: rows('B', 3) },
    ])
    expect(doc.pages.length).toBe(5)
    expect(pageTexts(doc, 0).join('|')).toContain('A1')
    expect(pageTexts(doc, 2).join('|')).toContain('B1')
    expect(pageTexts(doc, 4).join('|')).toContain('B3')
  })

  it('continuousPageNumbers: PAGE_NUMBER が通し番号になり TOTAL_PAGES がブック全体になる', () => {
    const doc = createReportBook([
      { template: simpleTemplate('p1'), data: rows('A', 2) },
      { template: simpleTemplate('p2'), data: rows('B', 3) },
    ], { continuousPageNumbers: true })

    expect(doc.pages.length).toBe(5)
    expect(pageTexts(doc, 0)).toContain('P1')
    expect(pageTexts(doc, 0)).toContain('of 5')
    expect(pageTexts(doc, 1)).toContain('P2')
    
    expect(pageTexts(doc, 2)).toContain('P3')
    expect(pageTexts(doc, 2)).toContain('of 5')
    expect(pageTexts(doc, 4)).toContain('P5')
  })

  it('continuousPageNumbers なし: 各パートのページ番号は独立', () => {
    const doc = createReportBook([
      { template: simpleTemplate('p1'), data: rows('A', 2) },
      { template: simpleTemplate('p2'), data: rows('B', 2) },
    ])
    expect(pageTexts(doc, 0)).toContain('P1')
    expect(pageTexts(doc, 0)).toContain('of 2')
    expect(pageTexts(doc, 2)).toContain('P1')
    expect(pageTexts(doc, 3)).toContain('P2')
    expect(pageTexts(doc, 3)).toContain('of 2')
  })

  it('縦横混在: パートごとに用紙の向きが異なるページサイズを保持する', () => {
    const doc = createReportBook([
      { template: simpleTemplate('portrait'), data: rows('A', 1) },
      { template: simpleTemplate('landscape', { landscape: true }), data: rows('B', 1) },
    ])
    // The 700pt detail band does not fit the landscape content height (535pt),
    // so the landscape part correctly splits into 2 pages.
    expect(doc.pages.length).toBe(3)
    const p0 = doc.pages[0]!
    const p1 = doc.pages[1]!
    const p2 = doc.pages[2]!
    expect(p0.width).toBeLessThan(p0.height)
    expect(p1.width).toBeGreaterThan(p1.height)
    expect(p2.width).toBeGreaterThan(p2.height)
    expect(p0.height).toBe(p1.width)
    expect(p0.width).toBe(p1.height)
  })

  it('parts が空の場合はエラー', () => {
    expect(() => createReportBook([])).toThrow()
  })
})

// ─── combineReports ───

describe('combineReports', () => {
  it('ブックマークとアンカーの pageIndex が結合後の位置にシフトされる', () => {
    const tmplWithAnchor: ReportTemplate = {
      page: { size: 'A4', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 700,
          elements: [
            {
              type: 'staticText', x: 0, y: 0, width: 200, height: 20,
              text: 'アンカー先', anchorName: 'target', bookmarkLevel: 1,
            },
          ],
        }],
      },
    }
    const doc1 = createReport(simpleTemplate('p1'), rows('A', 2))
    const doc2 = createReport(tmplWithAnchor, { rows: [{}] })
    expect(doc2.anchors?.get('target')?.pageIndex).toBe(0)

    const combined = combineReports([doc1, doc2])
    expect(combined.pages.length).toBe(3)
    expect(combined.anchors?.get('target')?.pageIndex).toBe(2)
    const bookmark = combined.bookmarks?.find(b => b.label === 'アンカー先')
    expect(bookmark?.pageIndex).toBe(2)
  })

  it('画像キーが衝突し内容が異なる場合はリネームして参照を書き換える', () => {
    const docA: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{ type: 'image', x: 0, y: 0, width: 50, height: 50, imageId: 'img1' }] }],
      images: { img1: 'data:image/png;base64,AAAA' },
    }
    const docB: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{ type: 'image', x: 0, y: 0, width: 50, height: 50, imageId: 'img1' }] }],
      images: { img1: 'data:image/png;base64,BBBB' },
    }
    const combined = combineReports([docA, docB])
    const imgNodeB = combined.pages[1]!.children[0]!
    expect(imgNodeB.type).toBe('image')
    const renamedId = (imgNodeB as { imageId: string }).imageId
    expect(renamedId).not.toBe('img1')
    expect(combined.images![renamedId]).toBe('data:image/png;base64,BBBB')
    expect(combined.images!['img1']).toBe('data:image/png;base64,AAAA')
  })

  it('画像キー衝突時はalternateとsoft-mask内の参照も同じrenameへ追随する', () => {
    const docA: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [] }],
      images: {
        main: 'data:image/png;base64,AAAA',
        alternate: 'data:image/png;base64,AAAB',
        mask: 'data:image/png;base64,AAAC',
      },
    }
    const docB: RenderDocument = {
      pages: [{
        width: 100,
        height: 100,
        children: [{
          type: 'group',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          children: [{
            type: 'image',
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            imageId: 'main',
            alternates: [{ imageId: 'alternate' }],
          }],
          softMask: {
            type: 'alpha',
            content: [{ type: 'image', x: 0, y: 0, width: 50, height: 50, imageId: 'mask' }],
          },
        }],
      }],
      images: {
        main: 'data:image/png;base64,BBBB',
        alternate: 'data:image/png;base64,BBBC',
        mask: 'data:image/png;base64,BBBD',
      },
    }
    const combined = combineReports([docA, docB])
    const group = combined.pages[1]!.children[0]!
    expect(group.type).toBe('group')
    if (group.type !== 'group') throw new Error('Expected group')
    const image = group.children[0]!
    expect(image.type).toBe('image')
    if (image.type !== 'image') throw new Error('Expected image')
    expect(image.imageId).toBe('__bk1_main')
    expect(image.alternates?.[0]!.imageId).toBe('__bk1_alternate')
    const maskImage = group.softMask?.content[0]!
    expect(maskImage?.type).toBe('image')
    if (maskImage?.type !== 'image') throw new Error('Expected mask image')
    expect(maskImage.imageId).toBe('__bk1_mask')
  })

  it('画像キー衝突時はtiling pattern内の画像参照も同じrenameへ追随する', () => {
    const docA: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [] }],
      images: { tile: 'data:image/png;base64,AAAA' },
    }
    const docB: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{
        type: 'path', commands: new Uint8Array(), coords: new Float32Array(),
        fill: {
          type: 'tiling-pattern', bbox: [0, 0, 10, 10], xStep: 10, yStep: 10,
          matrix: [1, 0, 0, 1, 0, 0],
          graphics: [{ kind: 'group', x: 0, y: 0, width: 10, height: 10, graphics: [], softMask: {
            type: 'alpha', graphics: [{ kind: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'tile' }],
          } }],
        },
      }] }],
      images: { tile: 'data:image/png;base64,BBBB' },
    }
    const combined = combineReports([docA, docB])
    const path = combined.pages[1]!.children[0]!
    if (path.type !== 'path' || typeof path.fill !== 'object' || path.fill.type !== 'tiling-pattern') throw new Error('Expected tiling path')
    const group = path.fill.graphics[0]!
    if (group.kind !== 'group') throw new Error('Expected tile group')
    const image = group.softMask?.graphics[0]!
    if (image?.kind !== 'image') throw new Error('Expected tile image')
    expect(image.imageId).toBe('__bk1_tile')
  })

  it('共有alternate参照を連鎖renameで二重に書き換えない', () => {
    const sharedAlternate = { imageId: 'a' }
    const docA: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [] }],
      images: { a: 'A', __bk1_a: 'AA' },
    }
    const docB: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [
        { type: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'a', alternates: [sharedAlternate] },
        { type: 'image', x: 20, y: 0, width: 10, height: 10, imageId: '__bk1_a', alternates: [sharedAlternate] },
      ] }],
      images: { a: 'B', __bk1_a: 'BB' },
    }
    combineReports([docA, docB])
    expect(sharedAlternate.imageId).toBe('__bk1_1_a')
  })

  it('衝突用の生成キーが既存または後続の入力キーを上書きしない', () => {
    const docA: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [] }],
      images: { logo: 'A', __bk1_logo: 'AA', __bk1_1_logo: 'AAA' },
    }
    const docB: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{ type: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'logo' }] }],
      images: { logo: 'B', __bk1_2_logo: 'BB' },
    }
    const combined = combineReports([docA, docB])
    const image = combined.pages[1]!.children[0]!
    if (image.type !== 'image') throw new Error('Expected image')
    expect(image.imageId).toBe('__bk1_3_logo')
    expect(combined.images).toEqual({
      logo: 'A',
      __bk1_logo: 'AA',
      __bk1_1_logo: 'AAA',
      __bk1_3_logo: 'B',
      __bk1_2_logo: 'BB',
    })
  })

  it('同一内容の画像キー衝突はリネームされない', () => {
    const docA: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{ type: 'image', x: 0, y: 0, width: 50, height: 50, imageId: 'img1' }] }],
      images: { img1: 'data:image/png;base64,AAAA' },
    }
    const docB: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{ type: 'image', x: 0, y: 0, width: 50, height: 50, imageId: 'img1' }] }],
      images: { img1: 'data:image/png;base64,AAAA' },
    }
    const combined = combineReports([docA, docB])
    expect((combined.pages[1]!.children[0] as { imageId: string }).imageId).toBe('img1')
    expect(Object.keys(combined.images!).length).toBe(1)
  })

  it('docs が空の場合はエラー', () => {
    expect(() => combineReports([])).toThrow()
  })
})
