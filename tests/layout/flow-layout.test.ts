import { describe, it, expect } from 'vitest'
import { flowLayout } from '../../src/layout/flow-layout.js'
import type { FlowBlock, FlowPageSettings, FlowPageDecorator } from '../../src/layout/flow-layout.js'
import type { RenderNode, RenderGroup, RenderText, RenderRect, RenderLine, RenderImage, RenderEllipse, RenderPath } from '../../src/types/render.js'

// ─── Helpers ───

function settings(overrides?: Partial<FlowPageSettings>): FlowPageSettings {
  return {
    width: 200,
    height: 400,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    ...overrides,
  }
}

function textNode(y: number, fontSize: number = 10, text: string = 'test'): RenderText {
  return { type: 'text', x: 0, y, text, fontId: 'f', fontSize, color: '#000' }
}

function rectNode(y: number, height: number): RenderRect {
  return { type: 'rect', x: 0, y, width: 100, height, fill: '#000' }
}

function lineNode(y1: number, y2: number): RenderLine {
  return { type: 'line', x1: 0, y1, x2: 100, y2, lineWidth: 1, color: '#000' }
}

function imageNode(y: number, height: number): RenderImage {
  return { type: 'image', x: 0, y, width: 100, height, imageId: 'img1' }
}

function ellipseNode(cy: number, ry: number): RenderEllipse {
  return { type: 'ellipse', cx: 50, cy, rx: 30, ry, fill: '#000' }
}

function groupNode(y: number, height: number, children: RenderNode[]): RenderGroup {
  return { type: 'group', x: 0, y, width: 100, height, children }
}

/** Returns the children of the content group of a page */
function getContentChildren(page: { children: RenderNode[] }): RenderNode[] {
  const contentGroup = page.children[0] as RenderGroup
  return contentGroup.children
}

// ─── Basic tests ───

describe('flowLayout', () => {
  describe('基本', () => {
    // Verifies that a block fitting on one page produces a single page with all children.
    it('1ページに収まるブロック', () => {
      const blocks: FlowBlock[] = [
        { height: 50, children: [textNode(0), rectNode(20, 30)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(1)
      const children = getContentChildren(doc.pages[0])
      expect(children).toHaveLength(2)
    })

    // Verifies that an empty block array still produces one empty page.
    it('空ブロック配列 → 1ページ（空）', () => {
      const doc = flowLayout([], settings())
      expect(doc.pages).toHaveLength(1)
      const children = getContentChildren(doc.pages[0])
      expect(children).toHaveLength(0)
    })

    // Verifies that blocks with empty children are skipped and consume no vertical space.
    it('空children のブロックはスキップ', () => {
      const blocks: FlowBlock[] = [
        { height: 100, children: [] },
        { height: 50, children: [textNode(0)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(1)
      const children = getContentChildren(doc.pages[0])
      expect(children).toHaveLength(1)
      // textNode stays at y=0 (the previous block was skipped so cursorY=0)
      expect((children[0] as RenderText).y).toBe(0)
    })

    // Verifies that page margins are applied to the content group's position and size.
    it('マージンが適用される', () => {
      const blocks: FlowBlock[] = [
        { height: 50, children: [textNode(0)] },
      ]
      const doc = flowLayout(blocks, settings({
        marginTop: 20, marginBottom: 30, marginLeft: 10, marginRight: 10,
      }))
      expect(doc.pages).toHaveLength(1)
      const contentGroup = doc.pages[0].children[0] as RenderGroup
      expect(contentGroup.x).toBe(10) // marginLeft
      expect(contentGroup.y).toBe(20) // marginTop
      expect(contentGroup.width).toBe(180) // 200 - 10 - 10
      expect(contentGroup.height).toBe(350) // 400 - 20 - 30
    })

    // Verifies that stacked blocks on one page are offset by the cumulative height.
    it('複数ブロックが1ページに収まる', () => {
      const blocks: FlowBlock[] = [
        { height: 100, children: [rectNode(0, 100)] },
        { height: 100, children: [rectNode(0, 100)] },
        { height: 100, children: [rectNode(0, 100)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(1)
      const children = getContentChildren(doc.pages[0])
      expect(children).toHaveLength(3)
      // Second block is offset to y=100
      expect((children[1] as RenderRect).y).toBe(100)
      // Third is at y=200
      expect((children[2] as RenderRect).y).toBe(200)
    })
  })

  // ─── Page breaks ───

  describe('改ページ', () => {
    // Verifies that an overflowing rect is clip-split across two pages at the boundary.
    it('2ブロックが2ページに分かれる（rect はクリップ分割）', () => {
      const blocks: FlowBlock[] = [
        { height: 300, children: [rectNode(0, 300)] },
        { height: 300, children: [rectNode(0, 300)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      // p1: rect of block1 + clipped top 100pt group of block2
      expect(p1).toHaveLength(2)
      expect((p1[0] as RenderRect).type).toBe('rect')
      const clipTop = p1[1] as RenderGroup
      expect(clipTop.type).toBe('group')
      expect(clipTop.clip).toBe(true)
      expect(clipTop.height).toBe(100) // remaining 400-300=100
      const p2 = getContentChildren(doc.pages[1])
      // p2: clipped bottom 200pt group of block2
      expect(p2).toHaveLength(1)
      const clipBottom = p2[0] as RenderGroup
      expect(clipBottom.type).toBe('group')
      expect(clipBottom.clip).toBe(true)
      expect(clipBottom.height).toBe(200)
    })

    // Verifies that blocks exactly filling the page height do not trigger a page break.
    it('ぴったり収まる場合は改ページしない', () => {
      const blocks: FlowBlock[] = [
        { height: 200, children: [rectNode(0, 200)] },
        { height: 200, children: [rectNode(0, 200)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(1)
    })

    // Verifies that three full-page blocks produce three pages.
    it('3ブロックが3ページに分かれる', () => {
      const blocks: FlowBlock[] = [
        { height: 400, children: [rectNode(0, 400)] },
        { height: 400, children: [rectNode(0, 400)] },
        { height: 400, children: [rectNode(0, 400)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(3)
    })

    // Verifies that page-break decisions account for the reduced content height from margins.
    it('マージン考慮の改ページ', () => {
      const blocks: FlowBlock[] = [
        { height: 300, children: [rectNode(0, 300)] },
        { height: 100, children: [rectNode(0, 100)] },
      ]
      // contentHeight = 400 - 50 - 50 = 300
      const doc = flowLayout(blocks, settings({ marginTop: 50, marginBottom: 50 }))
      expect(doc.pages).toHaveLength(2)
    })
  })

  // ─── Atomic splitting ───

  // Per-node-type behavior when an element straddles the page boundary: move whole vs clip-split.
  describe('原子的分割', () => {
    // Verifies that a text node straddling the boundary moves to the next page as a whole.
    it('text は境界で次ページに丸ごと移動', () => {
      const blocks: FlowBlock[] = [{
        height: 500,
        children: [
          rectNode(0, 350),     // 0-350: fits on the current page
          textNode(380, 10),    // 380-390: fits on the current page
          textNode(395, 10),    // 395-405: straddles the boundary -> moved whole to the next page
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      const p2 = getContentChildren(doc.pages[1])
      // p1: rect(0,350) + text(380)
      expect(p1).toHaveLength(2)
      // p2: text (395-400=y on the next page, offset by -400)
      expect(p2.length).toBeGreaterThanOrEqual(1)
    })

    // Verifies that a line node straddling the boundary is clip-split across pages.
    it('line は境界でクリップ分割', () => {
      const blocks: FlowBlock[] = [{
        height: 500,
        children: [
          rectNode(0, 350),
          lineNode(390, 420),  // straddles the boundary -> clip split
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      const p2 = getContentChildren(doc.pages[1])
      // p1: rect + clip group of the line
      expect(p1.length).toBe(2)
      const clipGroup1 = p1[1] as RenderGroup
      expect(clipGroup1.type).toBe('group')
      expect(clipGroup1.clip).toBe(true)
      // p2: clip group holding the rest of the line
      expect(p2.length).toBe(1)
      const clipGroup2 = p2[0] as RenderGroup
      expect(clipGroup2.type).toBe('group')
      expect(clipGroup2.clip).toBe(true)
    })

    // Verifies that an image node straddling the boundary moves to the next page as a whole.
    it('image は境界で次ページに丸ごと移動', () => {
      const blocks: FlowBlock[] = [{
        height: 500,
        children: [
          rectNode(0, 350),
          imageNode(380, 50),  // 380-430: straddles the boundary
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p2 = getContentChildren(doc.pages[1])
      expect(p2.length).toBeGreaterThanOrEqual(1)
    })

    // Verifies that a rect straddling the boundary is clip-split with correct heights on both pages.
    it('rect は境界でクリップ分割', () => {
      const blocks: FlowBlock[] = [{
        height: 500,
        children: [
          rectNode(0, 350),
          rectNode(380, 50),  // 380-430: straddles the boundary -> clip split
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      const p2 = getContentChildren(doc.pages[1])
      // p1: rect(0,350) + clip group of the upper part of rect(380,50)
      expect(p1.length).toBe(2)
      const clipGroup1 = p1[1] as RenderGroup
      expect(clipGroup1.type).toBe('group')
      expect(clipGroup1.clip).toBe(true)
      expect(clipGroup1.y).toBe(380)
      expect(clipGroup1.height).toBe(20) // splitY(400) - bounds.top(380)
      // p2: clip group of the lower part of rect(380,50)
      expect(p2.length).toBe(1)
      const clipGroup2 = p2[0] as RenderGroup
      expect(clipGroup2.type).toBe('group')
      expect(clipGroup2.clip).toBe(true)
      expect(clipGroup2.height).toBe(30) // elemHeight(50) - clipHeight(20)
    })

    // Verifies that an ellipse straddling the boundary moves to the next page as a whole.
    it('ellipse は境界で次ページに丸ごと移動', () => {
      const blocks: FlowBlock[] = [{
        height: 500,
        children: [
          rectNode(0, 350),
          ellipseNode(410, 30),  // 380-440: straddles the boundary
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p2 = getContentChildren(doc.pages[1])
      expect(p2.length).toBeGreaterThanOrEqual(1)
    })

    // Verifies that a group straddling the boundary is split recursively over its children.
    it('group は再帰的に子要素を分割', () => {
      const blocks: FlowBlock[] = [{
        height: 500,
        children: [
          groupNode(300, 200, [
            rectNode(0, 50),    // 0-50 in group -> absolute 300-350: current page
            rectNode(60, 50),   // 60-110 in group -> absolute 360-410: split
            rectNode(150, 50),  // 150-200 in group -> absolute 450-500: next page
          ]),
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      const p2 = getContentChildren(doc.pages[1])
      // Current page holds the upper part of the group
      expect(p1.length).toBeGreaterThanOrEqual(1)
      const g1 = p1[0] as RenderGroup
      expect(g1.type).toBe('group')
      // Next page holds the lower part of the group
      expect(p2.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── Forced clip splitting ───

  describe('強制クリップ分割', () => {
    // Verifies that a single element taller than the content height is force-split with clip groups.
    it('contentHeight 超の単一要素 → クリップ分割', () => {
      // One rect larger than the whole page
      const blocks: FlowBlock[] = [{
        height: 600,
        children: [rectNode(0, 600)],  // 600pt > contentHeight(400pt)
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      const p2 = getContentChildren(doc.pages[1])
      // Both pages hold a clip group
      expect(p1.length).toBeGreaterThanOrEqual(1)
      expect(p2.length).toBeGreaterThanOrEqual(1)
      // Clip group on p1
      const g1 = p1[0] as RenderGroup
      expect(g1.type).toBe('group')
      expect(g1.clip).toBe(true)
    })
  })

  // ─── Compound splitting ───

  describe('複合分割', () => {
    // Verifies that a block 1.5x the page height splits into 2 pages.
    it('1.5倍高さのブロック → 2ページ分割', () => {
      const blocks: FlowBlock[] = [{
        height: 600,
        children: [
          rectNode(0, 100),
          rectNode(100, 100),
          rectNode(200, 100),
          rectNode(300, 100),
          rectNode(400, 100),
          rectNode(500, 100),
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
    })

    // Verifies that a block 2.5x the page height splits into 3 pages.
    it('2.5倍高さ → 3ページ', () => {
      const blocks: FlowBlock[] = [{
        height: 1000,
        children: [
          rectNode(0, 100),
          rectNode(200, 100),
          rectNode(400, 100),
          rectNode(600, 100),
          rectNode(800, 100),
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(3)
    })

    // Verifies splitting of a block that starts on a partially used page.
    it('部分使用後の分割', () => {
      // First block uses half of the page; the next block does not fit into the remainder
      const blocks: FlowBlock[] = [
        { height: 250, children: [rectNode(0, 250)] },
        { height: 300, children: [
          rectNode(0, 100),
          rectNode(100, 100),
          rectNode(200, 100),
        ] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      const p2 = getContentChildren(doc.pages[1])
      // p1: first block + part of the second
      expect(p1.length).toBeGreaterThanOrEqual(2)
      // p2: the rest of the second block
      expect(p2.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── keepTogether ───

  describe('keepTogether', () => {
    // Verifies that a keepTogether block not fitting the remainder moves whole to the next page.
    it('収まらない → 次ページに丸ごと移動', () => {
      const blocks: FlowBlock[] = [
        { height: 250, children: [rectNode(0, 250)] },
        { height: 200, keepTogether: true, children: [rectNode(0, 200)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      const p2 = getContentChildren(doc.pages[1])
      expect(p1).toHaveLength(1)
      expect(p2).toHaveLength(1)
      expect((p2[0] as RenderRect).y).toBe(0)
    })

    // Verifies that a keepTogether block fitting the remainder stays on the same page.
    it('収まる → 同ページに配置', () => {
      const blocks: FlowBlock[] = [
        { height: 100, children: [rectNode(0, 100)] },
        { height: 200, keepTogether: true, children: [rectNode(0, 200)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(1)
    })

    // Verifies that a keepTogether block taller than the content height is force-split anyway.
    it('contentHeight 超の keepTogether → 強制分割', () => {
      const blocks: FlowBlock[] = [
        { height: 600, keepTogether: true, children: [
          rectNode(0, 200),
          rectNode(200, 200),
          rectNode(400, 200),
        ] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
    })
  })

  // ─── decorator ───

  describe('decorator', () => {
    // Verifies that the page decorator adds its nodes to every page.
    it('全ページに装飾を追加', () => {
      const blocks: FlowBlock[] = [
        { height: 400, children: [rectNode(0, 400)] },
        { height: 400, children: [rectNode(0, 400)] },
      ]
      const decorator: FlowPageDecorator = (info) => [
        textNode(info.contentHeight + 10, 8, `Page ${info.pageIndex + 1} / ${info.totalPages}`),
      ]
      const doc = flowLayout(blocks, settings(), decorator)
      expect(doc.pages).toHaveLength(2)
      // Each page has the contentGroup + the decorator node
      expect(doc.pages[0].children).toHaveLength(2)
      expect(doc.pages[1].children).toHaveLength(2)
    })

    // Verifies that the decorator receives correct pageIndex and totalPages for every page.
    it('pageIndex と totalPages が正しい', () => {
      const blocks: FlowBlock[] = [
        { height: 400, children: [rectNode(0, 400)] },
        { height: 400, children: [rectNode(0, 400)] },
        { height: 400, children: [rectNode(0, 400)] },
      ]
      const infos: { pageIndex: number; totalPages: number }[] = []
      const decorator: FlowPageDecorator = (info) => {
        infos.push({ pageIndex: info.pageIndex, totalPages: info.totalPages })
        return []
      }
      flowLayout(blocks, settings(), decorator)
      expect(infos).toHaveLength(3)
      expect(infos[0]).toEqual({ pageIndex: 0, totalPages: 3 })
      expect(infos[1]).toEqual({ pageIndex: 1, totalPages: 3 })
      expect(infos[2]).toEqual({ pageIndex: 2, totalPages: 3 })
    })

    // Verifies that the decorator receives margin-adjusted contentWidth and contentHeight.
    it('contentWidth と contentHeight がマージン考慮', () => {
      const blocks: FlowBlock[] = [
        { height: 100, children: [rectNode(0, 100)] },
      ]
      let capturedInfo: { contentWidth: number; contentHeight: number } | null = null
      const decorator: FlowPageDecorator = (info) => {
        capturedInfo = { contentWidth: info.contentWidth, contentHeight: info.contentHeight }
        return []
      }
      flowLayout(blocks, settings({ marginTop: 20, marginBottom: 30, marginLeft: 10, marginRight: 10 }), decorator)
      expect(capturedInfo!.contentWidth).toBe(180)
      expect(capturedInfo!.contentHeight).toBe(350)
    })
  })

  // ─── Edge cases ───

  describe('エッジケース', () => {
    // Verifies that a zero-height horizontal line (y1 === y2) is placed correctly within a page.
    it('水平線 (y1 === y2) はページ内に正しく配置', () => {
      const blocks: FlowBlock[] = [{
        height: 410,
        children: [
          rectNode(0, 350),
          lineNode(360, 360),  // horizontal line: bounds = {top:360, bottom:360}, zero height
          textNode(395, 10),   // 395-405: straddles the page boundary
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      // rect + line remain on the current page
      expect(p1.length).toBeGreaterThanOrEqual(2)
    })

    // Verifies that a path node's bounding box is used for splitting and its coords are re-based on the next page.
    it('path 要素のバウンディングボックスとオフセット', () => {
      const path: RenderPath = {
        type: 'path',
        commands: new Uint8Array([0, 1, 1, 3]),
        coords: new Float32Array([10, 380, 50, 420, 90, 380]),
        fill: '#000',
      }
      const blocks: FlowBlock[] = [{
        height: 450,
        children: [rectNode(0, 350), path],  // path: y 380-420, straddles
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p2 = getContentChildren(doc.pages[1])
      expect(p2.length).toBeGreaterThanOrEqual(1)
      // The path moves to the next page with y re-based to 0
      const movedPath = p2[0] as RenderPath
      expect(movedPath.type).toBe('path')
      expect(movedPath.coords[1]).toBe(0) // first Y coordinate re-based to 0
    })

    // Verifies that offsetNodeY with dy=0 returns the identical node object (no copy).
    it('dy=0 の offsetNodeY はノードをそのまま返す', () => {
      const blocks: FlowBlock[] = [
        { height: 400, children: [rectNode(0, 400)] },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(1)
      const children = getContentChildren(doc.pages[0])
      // cursorY=0 with offset=0 -> same object
      expect(children[0]).toBe(blocks[0].children[0])
    })

    // Verifies that no next page is created when all elements end at or before splitY.
    it('全要素が splitY 以下の場合 next は空', () => {
      // Block height is large but all elements fit within the page
      const blocks: FlowBlock[] = [{
        height: 500,
        children: [
          rectNode(0, 100),
          rectNode(100, 100),
          rectNode(200, 100),
          // no elements in the 300-400 area -> everything fits in current
        ],
      }]
      const doc = flowLayout(blocks, settings())
      // All elements have bounds.bottom <= 400, so 1 page
      expect(doc.pages).toHaveLength(1)
    })

    // Verifies that forced clip splitting produces a clip group with a finite width (not Infinity).
    it('強制クリップ分割で clip group の width が有限値', () => {
      const blocks: FlowBlock[] = [{
        height: 600,
        children: [rectNode(0, 600)],
      }]
      const doc = flowLayout(blocks, settings())
      const p1 = getContentChildren(doc.pages[0])
      const g1 = p1[0] as RenderGroup
      expect(g1.clip).toBe(true)
      expect(g1.width).toBe(200)  // contentWidth, not Infinity
      expect(isFinite(g1.width)).toBe(true)
    })

    // Verifies that a huge element spanning three pages is clip-split on each page.
    it('多段分割: 3ページにまたがる巨大要素', () => {
      // 1200pt rect -> contentHeight=400 -> 3 pages
      const blocks: FlowBlock[] = [{
        height: 1200,
        children: [rectNode(0, 1200)],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(3)
      // Each page holds a clip group
      for (let i = 0; i < 3; i++) {
        const children = getContentChildren(doc.pages[i])
        expect(children.length).toBeGreaterThanOrEqual(1)
      }
    })

    // Verifies that after a group split the carried-over group starts at y=0 on the next page.
    it('group 分割後の次ページ group の y は 0', () => {
      const blocks: FlowBlock[] = [{
        height: 500,
        children: [
          groupNode(300, 200, [
            rectNode(0, 50),
            rectNode(150, 50),
          ]),
        ],
      }]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p2 = getContentChildren(doc.pages[1])
      const g2 = p2[0] as RenderGroup
      expect(g2.type).toBe('group')
      expect(g2.y).toBe(0)
    })

    // Verifies that row spacing is preserved on the next page when row groups split across the boundary.
    it('グループ行の分割時に行間が保持される', () => {
      // When row groups (rect+text) cross the page boundary, the next page
      // must keep the original row spacing (20pt)
      const lineHeight = 20
      const lineCount = 30  // 30 rows * 20pt = 600pt > 400pt
      const children: RenderNode[] = []
      for (let i = 0; i < lineCount; i++) {
        children.push(groupNode(i * lineHeight, lineHeight, [
          rectNode(0, lineHeight),
          textNode(2, 10, `Row ${i + 1}`),
        ]))
      }
      const blocks: FlowBlock[] = [
        { height: lineCount * lineHeight, children },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)

      // Verify the row spacing on page 2
      const p2 = getContentChildren(doc.pages[1])
      expect(p2.length).toBeGreaterThan(1)
      for (let i = 1; i < p2.length; i++) {
        const prev = p2[i - 1] as RenderGroup
        const curr = p2[i] as RenderGroup
        const gap = curr.y - prev.y
        expect(gap).toBeCloseTo(lineHeight, 5)
      }

      // The first row on page 2 starts at y=0
      const first = p2[0] as RenderGroup
      expect(first.y).toBeCloseTo(0, 5)
    })

    // Verifies that multi-line text without keepTogether is distributed across pages.
    it('keepTogether=false の複数行テキストがページ分割される', () => {
      // 40 lines of text (12pt apart each) = 480pt > 400pt
      const children: RenderNode[] = []
      for (let i = 0; i < 40; i++) {
        children.push(textNode(i * 12, 10, `Line ${i + 1}`))
      }
      const blocks: FlowBlock[] = [
        { height: 480, children },
      ]
      const doc = flowLayout(blocks, settings())
      expect(doc.pages).toHaveLength(2)
      const p1 = getContentChildren(doc.pages[0])
      const p2 = getContentChildren(doc.pages[1])
      // 400/12 = 33 lines on page 1, the remaining 7 on page 2
      expect(p1.length).toBeGreaterThan(0)
      expect(p2.length).toBeGreaterThan(0)
    })
  })
})
