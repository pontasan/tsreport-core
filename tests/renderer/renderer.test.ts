import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderPage } from '../../src/renderer/renderer.js'
import type { RenderBackend } from '../../src/renderer/backend.js'
import type { RenderDocument, RenderPage } from '../../src/types/render.js'

// Mock backend.

function createMockBackend(): RenderBackend & { calls: [string, ...unknown[]][] } {
  const calls: [string, ...unknown[]][] = []
  return {
    calls,
    beginDocument() { calls.push(['beginDocument']) },
    endDocument() { calls.push(['endDocument']) },
    beginPage(w, h) { calls.push(['beginPage', w, h]) },
    endPage() { calls.push(['endPage']) },
    save() { calls.push(['save']) },
    restore() { calls.push(['restore']) },
    translate(x, y) { calls.push(['translate', x, y]) },
    rotate(angle) { calls.push(['rotate', angle]) },
    transform(a, b, c, d, e, f) { calls.push(['transform', a, b, c, d, e, f]) },
    clip(x, y, w, h) { calls.push(['clip', x, y, w, h]) },
    clipPath(cmds, coords, fillRule) { calls.push(['clipPath', cmds, coords, fillRule]) },
    setOpacity(o) { calls.push(['setOpacity', o]) },
    setBlendMode(mode) { calls.push(['setBlendMode', mode]) },
    setOverprint(fill, stroke, mode) { calls.push(['setOverprint', fill, stroke, mode]) },
    beginDeviceParams(params) { calls.push(['beginDeviceParams', params]) },
    endDeviceParams() { calls.push(['endDeviceParams']) },
    drawText(x, y, text, fontId, fontSize, color, opts) {
      calls.push(['drawText', x, y, text, fontId, fontSize, color, opts])
    },
    drawLine(x1, y1, x2, y2, lw, color, dash) {
      calls.push(['drawLine', x1, y1, x2, y2, lw, color, dash])
    },
    drawRect(x, y, w, h, opts) {
      calls.push(['drawRect', x, y, w, h, opts])
    },
    drawEllipse(cx, cy, rx, ry, opts) {
      calls.push(['drawEllipse', cx, cy, rx, ry, opts])
    },
    drawPath(cmds, coords, opts) {
      calls.push(['drawPath', cmds, coords, opts])
    },
    drawPathWithPaints(cmds, coords, opts) {
      calls.push(['drawPathWithPaints', cmds, coords, opts])
    },
    drawImage(x, y, w, h, id) {
      calls.push(['drawImage', x, y, w, h, id])
    },
    drawImageAffine(a, b, c, d, e, f, id) {
      calls.push(['drawImageAffine', a, b, c, d, e, f, id])
    },
  }
}

// Tests.

describe('renderer - ツリーウォーカー', () => {
  let backend: ReturnType<typeof createMockBackend>

  beforeEach(() => {
    backend = createMockBackend()
  })

  describe('render()', () => {
    it('空ドキュメントで beginDocument / endDocument が呼ばれる', () => {
      const doc: RenderDocument = { pages: [] }
      render(doc, backend)
      expect(backend.calls).toEqual([
        ['beginDocument'],
        ['endDocument'],
      ])
    })

    it('複数ページのライフサイクル', () => {
      const doc: RenderDocument = {
        pages: [
          { width: 595, height: 842, children: [] },
          { width: 595, height: 842, children: [] },
        ],
      }
      render(doc, backend)
      expect(backend.calls).toEqual([
        ['beginDocument'],
        ['beginPage', 595, 842],
        ['endPage'],
        ['beginPage', 595, 842],
        ['endPage'],
        ['endDocument'],
      ])
    })
  })

  describe('renderPage()', () => {
    it('beginDocument/endDocument を呼ばない', () => {
      const page: RenderPage = { width: 595, height: 842, children: [] }
      renderPage(page, backend)
      expect(backend.calls).toEqual([
        ['beginPage', 595, 842],
        ['endPage'],
      ])
    })
  })

  it('applies an affine path transform around geometry and stroke painting', () => {
    const page: RenderPage = {
      width: 100,
      height: 100,
      children: [{
        type: 'path',
        commands: Uint8Array.of(0, 1),
        coords: Float32Array.of(0, 0, 10, 0),
        affineTransform: [2, 0.5, 1, 3, 10, 20],
        stroke: '#000000',
        strokeWidth: 4,
      }],
    }
    renderPage(page, backend)
    expect(backend.calls.slice(1, -1).map((call) => call[0])).toEqual(['save', 'transform', 'drawPathWithPaints', 'restore'])
    expect(backend.calls[2]).toEqual(['transform', 2, 0.5, 1, 3, 10, 20])
  })

  it('applies imported Form affine transforms in preview backends', () => {
    renderPage({
      width: 100,
      height: 100,
      children: [{
        type: 'group', x: 0, y: 0, width: 10, height: 10,
        affineTransform: [2, 0, 0, 3, 7, 11],
        children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#0000ff' }],
      }],
    }, backend)
    expect(backend.calls.map((call) => call[0])).toContain('transform')
    expect(backend.calls).toContainEqual(['transform', 2, 0, 0, 3, 7, 11])
  })

  it('preserves imported Form boundaries while applying the shared affine placement', () => {
    backend.beginPdfForm = function (form) { backend.calls.push(['beginPdfForm', form]) }
    backend.endPdfForm = function () { backend.calls.push(['endPdfForm']) }
    renderPage({
      width: 100,
      height: 100,
      children: [{
        type: 'group', x: 0, y: 0, width: 10, height: 10,
        affineTransform: [2, 0, 0, 3, 7, 11],
        pdfForm: { bbox: [0, 0, 10, 10], matrix: [2, 0, 0, 3, 4, 5], invocationMatrix: [1, 0, 0, 1, 7, 11] },
        children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#0000ff' }],
      }],
    }, backend)
    expect(backend.calls.map((call) => call[0])).toEqual([
      'beginPage', 'save', 'translate', 'transform', 'beginPdfForm', 'drawRect', 'endPdfForm', 'restore', 'endPage',
    ])
    expect(backend.calls).toContainEqual(['transform', 2, 0, 0, 3, 7, 11])
  })

  it('applies imported Form opacity to the completed Form invocation', () => {
    backend.beginPdfForm = function (form) { backend.calls.push(['beginPdfForm', form]) }
    backend.endPdfForm = function () { backend.calls.push(['endPdfForm']) }
    renderPage({
      width: 100,
      height: 100,
      children: [{
        type: 'group', x: 0, y: 0, width: 10, height: 10,
        opacity: 0.3,
        pdfForm: { bbox: [0, 0, 10, 10], matrix: [1, 0, 0, 1, 0, 0] },
        children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#ffffff' }],
      }],
    }, backend)

    const opacityIndex = backend.calls.findIndex(function (call) { return call[0] === 'setOpacity' })
    const beginFormIndex = backend.calls.findIndex(function (call) { return call[0] === 'beginPdfForm' })
    expect(backend.calls[opacityIndex]).toEqual(['setOpacity', 0.3])
    expect(opacityIndex).toBeLessThan(beginFormIndex)
  })

  it('omits currently hidden optional content in preview backends', () => {
    renderPage({
      width: 100,
      height: 100,
      children: [
        { type: 'group', x: 0, y: 0, width: 10, height: 10, optionalContent: { name: 'Visible', visible: true }, children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#00ff00' }] },
        { type: 'group', x: 20, y: 0, width: 10, height: 10, optionalContent: { name: 'Hidden', visible: false }, children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#ff0000' }] },
      ],
    }, backend)
    expect(backend.calls.filter((call) => call[0] === 'drawRect')).toHaveLength(1)
    expect(backend.calls.find((call) => call[0] === 'drawRect')?.[5]).toMatchObject({ fill: '#00ff00' })
  })

  describe('テキストノード', () => {
    it('drawText が呼ばれる', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'text', x: 10, y: 20,
            text: 'Hello', fontId: 'default', fontSize: 12, color: '#000000',
            bold: true, hAlign: 'center', width: 100,
          },
        ],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawText')
      expect(drawCall).toBeDefined()
      expect(drawCall![1]).toBe(10)  // x
      expect(drawCall![2]).toBe(20)  // y
      expect(drawCall![3]).toBe('Hello')
      expect(drawCall![4]).toBe('default')
      expect(drawCall![5]).toBe(12)
      expect(drawCall![6]).toBe('#000000')
      const opts = drawCall![7] as Record<string, unknown>
      expect(opts.bold).toBe(true)
      expect(opts.hAlign).toBe('center')
      expect(opts.width).toBe(100)
    })

    it('outlineText が drawText options に渡される', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'text', x: 10, y: 20,
            text: 'Outlined', fontId: 'default', fontSize: 12, color: '#000000',
            outlineText: true,
          },
        ],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawText')
      expect(drawCall).toBeDefined()
      const opts = drawCall![7] as Record<string, unknown>
      expect(opts.outlineText).toBe(true)
    })

    it('pdfFontMode が drawText options に渡される', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [{
          type: 'text', x: 10, y: 20,
          text: 'Referenced', fontId: 'default', fontSize: 12, color: '#000000',
          pdfFontMode: 'reference',
        }],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawText')
      expect(drawCall).toBeDefined()
      const opts = drawCall![7] as Record<string, unknown>
      expect(opts.pdfFontMode).toBe('reference')
    })
  })

  describe('線ノード', () => {
    it('drawLine が呼ばれる', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'line', x1: 0, y1: 10, x2: 100, y2: 10,
            lineWidth: 1, color: '#FF0000', dash: [4, 2],
          },
        ],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawLine')
      expect(drawCall).toBeDefined()
      expect(drawCall![1]).toBe(0)
      expect(drawCall![5]).toBe(1)
      expect(drawCall![6]).toBe('#FF0000')
      expect(drawCall![7]).toEqual([4, 2])
    })
  })

  describe('矩形ノード', () => {
    it('drawRect が呼ばれる', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'rect', x: 10, y: 20, width: 100, height: 50,
            fill: '#FF0000', stroke: '#000000', strokeWidth: 2, radius: 5,
          },
        ],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawRect')
      expect(drawCall).toBeDefined()
      expect(drawCall![1]).toBe(10)
      expect(drawCall![2]).toBe(20)
      expect(drawCall![3]).toBe(100)
      expect(drawCall![4]).toBe(50)
      const opts = drawCall![5] as Record<string, unknown>
      expect(opts.fill).toBe('#FF0000')
      expect(opts.radius).toBe(5)
    })

    it('四隅個別の角丸が drawRect に渡される', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'rect',
            x: 10,
            y: 20,
            width: 100,
            height: 50,
            stroke: '#000000',
            cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
          },
        ],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawRect')
      expect(drawCall).toBeDefined()
      const opts = drawCall![5] as Record<string, unknown>
      expect(opts.cornerRadii).toEqual({ topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 })
    })
  })

  describe('楕円ノード', () => {
    it('drawEllipse が呼ばれる', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'ellipse', cx: 50, cy: 50, rx: 30, ry: 20,
            fill: '#00FF00',
          },
        ],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawEllipse')
      expect(drawCall).toBeDefined()
      expect(drawCall![1]).toBe(50)
      expect(drawCall![2]).toBe(50)
    })
  })

  describe('パスノード', () => {
    it('drawPathWithPaints が呼ばれる', () => {
      const cmds = new Uint8Array([0, 1, 3])
      const coords = new Float32Array([10, 20, 30, 40])
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          { type: 'path', commands: cmds, coords, fill: '#0000FF' },
        ],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawPathWithPaints')
      expect(drawCall).toBeDefined()
      expect(drawCall![1]).toBe(cmds)
      expect(drawCall![2]).toBe(coords)
    })
  })

  describe('画像ノード', () => {
    it('drawImage が呼ばれる', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          { type: 'image', x: 10, y: 20, width: 100, height: 80, imageId: 'logo' },
        ],
      }
      renderPage(page, backend)
      const drawCall = backend.calls.find(c => c[0] === 'drawImage')
      expect(drawCall).toBeDefined()
      expect(drawCall![5]).toBe('logo')
    })

    it('affineTransform は drawImageAffine に渡される', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          { type: 'image', x: 10, y: 20, width: 100, height: 80, imageId: 'logo', affineTransform: [20, -5, 4, -10, 10, 80] },
        ],
      }
      renderPage(page, backend)
      expect(backend.calls).toContainEqual(['drawImageAffine', 20, -5, 4, -10, 10, 80, 'logo'])
    })

    it('blendMode は描画を save/restore で囲む', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'path',
            commands: new Uint8Array([0, 1, 1, 1, 3]),
            coords: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
            fill: '#ff0000',
            blendMode: 'multiply',
          },
        ],
      }
      renderPage(page, backend)
      const blendIndex = backend.calls.findIndex(c => c[0] === 'setBlendMode')
      const drawIndex = backend.calls.findIndex(c => c[0] === 'drawPathWithPaints')
      expect(backend.calls[blendIndex - 1]).toEqual(['save'])
      expect(backend.calls[blendIndex]).toEqual(['setBlendMode', 'multiply'])
      expect(drawIndex).toBeGreaterThan(blendIndex)
      expect(backend.calls[drawIndex + 1]).toEqual(['restore'])
    })

    it('blendMode normal は親の blendMode をリセットする', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [{
          type: 'group',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          blendMode: 'multiply',
          children: [{
            type: 'path',
            commands: new Uint8Array([0, 1, 1, 1, 3]),
            coords: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
            fill: '#00ff00',
            blendMode: 'normal',
          }],
        }],
      }
      renderPage(page, backend)
      expect(backend.calls.filter(c => c[0] === 'setBlendMode')).toEqual([
        ['setBlendMode', 'multiply'],
        ['setBlendMode', 'normal'],
      ])
    })

    it('overprint は描画を save/restore で囲む', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'path',
            commands: new Uint8Array([0, 1, 1, 1, 3]),
            coords: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
            fill: '#ff0000',
            stroke: '#000000',
            overprintFill: true,
            overprintStroke: true,
            overprintMode: 1,
          },
        ],
      }
      renderPage(page, backend)
      const overprintIndex = backend.calls.findIndex(c => c[0] === 'setOverprint')
      const drawIndex = backend.calls.findIndex(c => c[0] === 'drawPathWithPaints')
      expect(backend.calls[overprintIndex - 1]).toEqual(['save'])
      expect(backend.calls[overprintIndex]).toEqual(['setOverprint', true, true, 1])
      expect(drawIndex).toBeGreaterThan(overprintIndex)
      expect(backend.calls[drawIndex + 1]).toEqual(['restore'])
    })
  })

  describe('グループノード', () => {
    it('wraps device transfer parameters around the group content', () => {
      const params = { transferFunction: { expression: '{ 1 exch sub }' } } as const
      const page: RenderPage = { width: 100, height: 100, children: [{
        type: 'group', x: 0, y: 0, width: 50, height: 50, deviceParams: params,
        children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#000000' }],
      }] }
      renderPage(page, backend)
      const begin = backend.calls.findIndex(c => c[0] === 'beginDeviceParams')
      const draw = backend.calls.findIndex(c => c[0] === 'drawRect')
      const end = backend.calls.findIndex(c => c[0] === 'endDeviceParams')
      expect(begin).toBeGreaterThanOrEqual(0)
      expect(draw).toBeGreaterThan(begin)
      expect(end).toBeGreaterThan(draw)
    })

    it('save/translate/restore が呼ばれる', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'group', x: 50, y: 100, width: 200, height: 300,
            children: [],
          },
        ],
      }
      renderPage(page, backend)
      const calls = backend.calls.filter(c => ['save', 'translate', 'restore'].includes(c[0]))
      expect(calls).toEqual([
        ['save'],
        ['translate', 50, 100],
        ['restore'],
      ])
    })

    it('clip が設定される', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'group', x: 10, y: 20, width: 100, height: 50,
            clip: true,
            children: [],
          },
        ],
      }
      renderPage(page, backend)
      const clipCall = backend.calls.find(c => c[0] === 'clip')
      expect(clipCall).toEqual(['clip', 0, 0, 100, 50])
    })

    it('opacity が設定される', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'group', x: 0, y: 0, width: 100, height: 100,
            opacity: 0.5,
            children: [],
          },
        ],
      }
      renderPage(page, backend)
      const opCall = backend.calls.find(c => c[0] === 'setOpacity')
      expect(opCall).toEqual(['setOpacity', 0.5])
    })

    it('rotation が設定される', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'group', x: 10, y: 20, width: 100, height: 200,
            rotation: -90,
            rotationOriginX: 100,
            rotationOriginY: 100,
            children: [
              {
                type: 'text', x: 0, y: 0,
                text: 'Rotated', fontId: 'default', fontSize: 12, color: '#000',
              },
            ],
          },
        ],
      }
      renderPage(page, backend)
      const calls = backend.calls.filter(c =>
        ['save', 'translate', 'rotate', 'restore', 'drawText'].includes(c[0] as string)
      )
      expect(calls).toEqual([
        ['save'],
        ['translate', 10, 20],        // group position
        ['translate', 100, 100],       // to rotation origin
        ['rotate', -90],               // rotate
        ['translate', -100, -100],     // back from origin
        ['drawText', 0, 0, 'Rotated', 'default', 12, '#000', expect.any(Object)],
        ['restore'],
      ])
    })

    it('opacity=1.0 では setOpacity が呼ばれない', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'group', x: 0, y: 0, width: 100, height: 100,
            opacity: 1.0,
            children: [],
          },
        ],
      }
      renderPage(page, backend)
      const opCall = backend.calls.find(c => c[0] === 'setOpacity')
      expect(opCall).toBeUndefined()
    })

    it('ネストされたグループが正しく描画される', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          {
            type: 'group', x: 10, y: 20, width: 200, height: 200,
            children: [
              {
                type: 'group', x: 5, y: 5, width: 190, height: 190,
                children: [
                  {
                    type: 'text', x: 0, y: 0,
                    text: 'Nested', fontId: 'default', fontSize: 10, color: '#000',
                  },
                ],
              },
            ],
          },
        ],
      }
      renderPage(page, backend)

      // Outergroup.
      
      expect(backend.calls).toContainEqual(['save'])
      expect(backend.calls).toContainEqual(['translate', 10, 20])

      // Innergroup.
      
      expect(backend.calls).toContainEqual(['translate', 5, 5])

      // Text.
      
      const textCall = backend.calls.find(c => c[0] === 'drawText')
      expect(textCall).toBeDefined()
      expect(textCall![3]).toBe('Nested')

      // Restore 2.
      
      const restores = backend.calls.filter(c => c[0] === 'restore')
      expect(restores).toHaveLength(2)
    })
  })

  describe('複合ページ', () => {
    it('全ノード型を含むページの描画順序', () => {
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          { type: 'rect', x: 0, y: 0, width: 595, height: 842, fill: '#FFFFFF' },
          {
            type: 'group', x: 50, y: 50, width: 495, height: 742,
            clip: true,
            children: [
              { type: 'text', x: 10, y: 10, text: 'Title', fontId: 'default', fontSize: 18, color: '#000' },
              { type: 'line', x1: 10, y1: 35, x2: 485, y2: 35, lineWidth: 1, color: '#000' },
              { type: 'ellipse', cx: 250, cy: 100, rx: 20, ry: 20, fill: '#0000FF' },
            ],
          },
        ],
      }
      renderPage(page, backend)

      const ops = backend.calls.map(c => c[0])
      expect(ops).toEqual([
        'beginPage',
        'drawRect',
        'save', 'translate', 'clip',
        'drawText', 'drawLine', 'drawEllipse',
        'restore',
        'endPage',
      ])
    })
  })
})
