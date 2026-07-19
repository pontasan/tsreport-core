import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanvasBackend, CanvasRenderCache, clearCanvasImageCache } from '../../src/renderer/canvas-backend.js'
import { renderPage } from '../../src/renderer/renderer.js'
import type { RenderPage } from '../../src/types/render.js'
import type { PdfSpecialColorDef } from '../../src/types/template.js'

// ─── Mock Canvas 2D context ───

function createMockCtx() {
  const calls: [string, ...unknown[]][] = []

  const ctx = {
    canvas: {
      width: 0,
      height: 0,
      style: { width: '', height: '' },
    },
    // call tracking
    _calls: calls,
    // properties
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 0,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    font: '',
    textBaseline: '' as string,
    // methods
    save: vi.fn(() => calls.push(['save'])),
    restore: vi.fn(() => calls.push(['restore'])),
    setTransform: vi.fn((...args: unknown[]) => calls.push(['setTransform', ...args])),
    transform: vi.fn((...args: unknown[]) => calls.push(['transform', ...args])),
    translate: vi.fn((x: number, y: number) => calls.push(['translate', x, y])),
    rotate: vi.fn((angle: number) => calls.push(['rotate', angle])),
    beginPath: vi.fn(() => calls.push(['beginPath'])),
    closePath: vi.fn(() => calls.push(['closePath'])),
    moveTo: vi.fn((x: number, y: number) => calls.push(['moveTo', x, y])),
    lineTo: vi.fn((x: number, y: number) => calls.push(['lineTo', x, y])),
    bezierCurveTo: vi.fn((...args: unknown[]) => calls.push(['bezierCurveTo', ...args])),
    rect: vi.fn((x: number, y: number, w: number, h: number) => calls.push(['rect', x, y, w, h])),
    ellipse: vi.fn((...args: unknown[]) => calls.push(['ellipse', ...args])),
    roundRect: vi.fn((...args: unknown[]) => calls.push(['roundRect', ...args])),
    clip: vi.fn(() => calls.push(['clip'])),
    fill: vi.fn(() => calls.push(['fill'])),
    stroke: vi.fn(() => calls.push(['stroke'])),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => calls.push(['fillRect', x, y, w, h])),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => calls.push(['strokeRect', x, y, w, h])),
    drawImage: vi.fn((...args: unknown[]) => calls.push(['drawImage', ...args])),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    })),
    putImageData: vi.fn((...args: unknown[]) => calls.push(['putImageData', ...args])),
    fillText: vi.fn((text: string, x: number, y: number) => calls.push(['fillText', text, x, y])),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    setLineDash: vi.fn((segments: number[]) => calls.push(['setLineDash', segments])),
    arcTo: vi.fn((...args: unknown[]) => calls.push(['arcTo', ...args])),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 36, f: 36 })),
  }

  return ctx
}

describe('CanvasBackend', () => {
  let ctx: ReturnType<typeof createMockCtx>

  beforeEach(() => {
    ctx = createMockCtx()
  })

  it('owns image maps and restores constructor images at each document boundary', () => {
    const suppliedImages = { supplied: new Uint8Array([1]) }
    const documentImages = { document: new Uint8Array([2]) }
    const backend = new CanvasBackend(ctx, { images: suppliedImages })
    const internals = backend as unknown as { images: Record<string, string | Uint8Array> }

    backend.beginDocument()
    backend.setImages(documentImages)
    backend.beginPage(10, 10)
    backend.drawImageData(0, 0, 1, 1, new Uint8Array([3]), 'image/png')
    expect(Object.keys(suppliedImages)).toEqual(['supplied'])
    expect(Object.keys(documentImages)).toEqual(['document'])
    expect(Object.keys(internals.images)).toContain('document')
    expect(() => backend.setImages(documentImages)).toThrow(
      'Image resources must be set before the first page begins',
    )

    backend.beginDocument()
    expect(Object.keys(internals.images)).toEqual(['supplied'])
  })

  describe('beginPage', () => {
    // Verifies beginPage sizes the canvas buffer by scale × devicePixelRatio and the CSS size by scale only.
    it('キャンバスサイズが scale × dpr で設定される', () => {
      const backend = new CanvasBackend(ctx, { scale: 2.0, devicePixelRatio: 2 })
      backend.beginPage(595, 842)

      expect(ctx.canvas.width).toBe(Math.ceil(595 * 2.0 * 2))
      expect(ctx.canvas.height).toBe(Math.ceil(842 * 2.0 * 2))
      expect(ctx.canvas.style.width).toBe(`${595 * 2.0}px`)
      expect(ctx.canvas.style.height).toBe(`${842 * 2.0}px`)
    })

    // Verifies beginPage installs a base transform of scale × devicePixelRatio via setTransform.
    it('setTransform が scale × dpr で呼ばれる', () => {
      const backend = new CanvasBackend(ctx, { scale: 1.5, devicePixelRatio: 2 })
      backend.beginPage(595, 842)

      expect(ctx.setTransform).toHaveBeenCalledWith(3, 0, 0, 3, 0, 0)
    })

    it('viewport crops the device surface without changing page-space painting', () => {
      const backend = new CanvasBackend(ctx, {
        scale: 1.5,
        devicePixelRatio: 2,
        viewport: { x: 100, y: 200, width: 300, height: 400 },
      })
      backend.beginPage(1000, 2000)

      expect(ctx.canvas.width).toBe(900)
      expect(ctx.canvas.height).toBe(1200)
      expect(ctx.canvas.style.width).toBe('450px')
      expect(ctx.canvas.style.height).toBe('600px')
      expect(ctx.setTransform).toHaveBeenCalledWith(3, 0, 0, 3, -300, -600)
      expect(ctx._calls.find(c => c[0] === 'fillRect')).toEqual(['fillRect', 0, 0, 1000, 2000])
    })

    // Verifies beginPage paints a white background rect covering the full page.
    it('白背景が描画される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.beginPage(595, 842)

      expect(ctx.fillStyle).toBe('#FFFFFF')
      const fillRectCall = ctx._calls.find(c => c[0] === 'fillRect')
      expect(fillRectCall).toEqual(['fillRect', 0, 0, 595, 842])
    })
  })

  describe('save / restore / translate', () => {
    // Verifies save/translate/restore delegate directly to the underlying 2D context.
    it('コンテキストに委譲される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.save()
      backend.translate(10, 20)
      backend.restore()

      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.translate).toHaveBeenCalledWith(10, 20)
      expect(ctx.restore).toHaveBeenCalled()
    })

    it('reuses semantic state frames across repeated page rendering', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      const internals = backend as unknown as {
        graphicsStateStack: object[]
        graphicsStateDepth: number
        blendMode: string
      }

      backend.save()
      const firstFrame = internals.graphicsStateStack[0]
      backend.setBlendMode('multiply')
      backend.restore()
      expect(internals.blendMode).toBe('normal')
      expect(internals.graphicsStateDepth).toBe(0)

      backend.save()
      backend.restore()
      expect(internals.graphicsStateStack).toHaveLength(1)
      expect(internals.graphicsStateStack[0]).toBe(firstFrame)
      expect(internals.graphicsStateDepth).toBe(0)
    })
  })

  describe('print-production raster state', () => {
    it('renders a zero-width PDF hairline as one device pixel', () => {
      const backend = new CanvasBackend(ctx, { scale: 2, devicePixelRatio: 2, background: null })
      backend.beginPage(100, 100)
      backend.drawLine(0, 10, 100, 10, 0, '#000000')
      expect(ctx.lineWidth).toBe(0.25)
    })

    it('stores overprint as native plate state instead of a Canvas blend approximation', () => {
      const backend = new CanvasBackend(ctx, { background: null })
      expect(() => backend.setOverprint(true, false, 1)).not.toThrow()
      expect((ctx as unknown as { globalCompositeOperation?: string }).globalCompositeOperation).not.toBe('multiply')
      expect(() => backend.setRenderingIntent('Perceptual')).not.toThrow()
    })
  })

  describe('clip', () => {
    // Verifies clip builds a rectangular path and applies context clipping.
    it('矩形クリッピングが適用される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.clip(10, 20, 100, 50)

      expect(ctx.beginPath).toHaveBeenCalled()
      expect(ctx.rect).toHaveBeenCalledWith(10, 20, 100, 50)
      expect(ctx.clip).toHaveBeenCalled()
    })
  })

  describe('setOpacity', () => {
    // Verifies setOpacity maps to the context's globalAlpha property.
    it('globalAlpha が設定される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.setOpacity(0.5)
      expect(ctx.globalAlpha).toBe(0.5)
    })
  })

  describe('transparency layers', () => {
    it('bounds a top-level transparency layer to the transformed group extent', () => {
      const offscreenSizes: Array<[number, number]> = []
      class MockOffscreenCanvas {
        width: number
        height: number
        private readonly context = createMockCtx()

        constructor(width: number, height: number) {
          this.width = width
          this.height = height
          this.context.canvas = this as unknown as ReturnType<typeof createMockCtx>['canvas']
          offscreenSizes.push([width, height])
        }

        getContext(): ReturnType<typeof createMockCtx> {
          return this.context
        }
      }
      vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
      ctx.canvas.width = 2000
      ctx.canvas.height = 1000
      ctx.getTransform.mockReturnValue({ a: 2, b: 0, c: 0, d: 2, e: 20, f: 40 })
      const backend = new CanvasBackend(ctx, { background: null })

      backend.beginTransparencyGroup(10, 15, {
        isolated: false,
        knockout: false,
        opacity: 0.3,
        hasSoftMask: false,
      })
      backend.endTransparencyGroup()

      expect(offscreenSizes).toEqual([[22, 32]])
      expect(ctx.drawImage).toHaveBeenLastCalledWith(expect.any(MockOffscreenCanvas), 19, 39)
    })

    it('applies a one-paint group opacity without allocating a transparency layer', () => {
      const offscreenSizes: Array<[number, number]> = []
      class MockOffscreenCanvas {
        width: number
        height: number
        private readonly context = createMockCtx()

        constructor(width: number, height: number) {
          this.width = width
          this.height = height
          this.context.canvas = this as unknown as ReturnType<typeof createMockCtx>['canvas']
          offscreenSizes.push([width, height])
        }

        getContext(): ReturnType<typeof createMockCtx> {
          return this.context
        }
      }
      vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
      const page: RenderPage = {
        width: 100,
        height: 100,
        children: [{
          type: 'group', x: 0, y: 0, width: 10, height: 10, opacity: 0.3,
          children: [{
            type: 'group', x: 0, y: 0, width: 10, height: 10,
            children: [{ type: 'path', x: 0, y: 0, commands: new Uint8Array([0, 1, 1, 4]), coords: new Float32Array([0, 0, 10, 0, 10, 10]), fill: '#ffffff' }],
          }],
        }],
      }

      const backend = new CanvasBackend(ctx, { background: null })
      backend.beginPage(100, 100)
      renderPage(page, backend)

      expect(offscreenSizes).toEqual([])
      expect(ctx.fill).toHaveBeenCalledTimes(1)
    })

    it('retains the complete transparency backdrop when a group has overlapping paints', () => {
      const offscreenSizes: Array<[number, number]> = []
      class MockOffscreenCanvas {
        width: number
        height: number
        private readonly context = createMockCtx()

        constructor(width: number, height: number) {
          this.width = width
          this.height = height
          this.context.canvas = this as unknown as ReturnType<typeof createMockCtx>['canvas']
          this.context.getTransform.mockReturnValue({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
          offscreenSizes.push([width, height])
        }

        getContext(): ReturnType<typeof createMockCtx> {
          return this.context
        }
      }
      vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
      const page: RenderPage = {
        width: 100,
        height: 100,
        children: [{
          type: 'group', x: 0, y: 0, width: 100, height: 100, opacity: 0.3,
          children: [
            { type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#ffffff' },
            { type: 'rect', x: 2, y: 2, width: 8, height: 8, fill: '#000000' },
          ],
        }],
      }

      ctx.getTransform.mockReturnValue({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      const backend = new CanvasBackend(ctx, { background: null })
      backend.beginPage(100, 100)
      renderPage(page, backend)

      expect(offscreenSizes).toEqual([[100, 100], [100, 100], [100, 100]])
    })
  })

  describe('drawText', () => {
    // Verifies drawText sets fill color, font string, and top baseline before calling fillText.
    it('fillText が呼ばれる', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawText(10, 20, 'Hello', 'Arial', 12, '#FF0000')

      expect(ctx.fillStyle).toBe('#FF0000')
      expect(ctx.textBaseline).toBe('top')
      expect(ctx.font).toContain('12px')
      expect(ctx.font).toContain('Arial')
      expect(ctx.fillText).toHaveBeenCalledWith('Hello', 10, 20)
    })

    // Verifies bold/italic options are reflected in the CSS font string.
    it('bold / italic でフォント文字列が変わる', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawText(0, 0, 'Test', 'serif', 14, '#000', { bold: true, italic: true })

      expect(ctx.font).toContain('bold')
      expect(ctx.font).toContain('italic')
    })

    // Verifies hAlign=center offsets the draw x by (width - textWidth) / 2.
    it('hAlign=center で x がオフセットされる', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      // measureText returns text.length * 6 = 30
      backend.drawText(10, 0, 'Hello', 'serif', 12, '#000', { hAlign: 'center', width: 100 })

      // drawX = 10 + (100 - 30) / 2 = 45
      expect(ctx.fillText).toHaveBeenCalledWith('Hello', 45, 0)
    })

    // Verifies hAlign=right right-aligns text within the given width.
    it('hAlign=right で右寄せされる', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawText(10, 0, 'Hi', 'serif', 12, '#000', { hAlign: 'right', width: 100 })

      // drawX = 10 + 100 - 12 = 98
      expect(ctx.fillText).toHaveBeenCalledWith('Hi', 98, 0)
    })

    // Verifies the underline option draws a stroked line in the text color.
    it('underline で線が描画される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawText(0, 0, 'Test', 'serif', 12, '#000', { underline: true })

      // stroke is called (fillText + underline line)
      expect(ctx.stroke).toHaveBeenCalled()
      expect(ctx.strokeStyle).toBe('#000')
    })

    it('measures aligned decorated CSS text once and leaves stroke state untouched for fill-only text', () => {
      ctx.strokeStyle = 'sentinel'
      ctx.lineWidth = 7
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawText(0, 0, 'Test', 'serif', 12, '#000', {
        hAlign: 'center', width: 100, underline: true, strikethrough: true,
      })

      expect(ctx.measureText).toHaveBeenCalledTimes(1)
      // Decorations intentionally set stroke state after the fill-only text draw.
      expect(ctx.strokeStyle).toBe('#000')
      expect(ctx.lineWidth).toBe(Math.max(12 * 0.05, 0.5))

      const plainCtx = createMockCtx()
      plainCtx.strokeStyle = 'sentinel'
      plainCtx.lineWidth = 7
      new CanvasBackend(plainCtx).drawText(0, 0, 'Test', 'serif', 12, '#000')
      expect(plainCtx.strokeStyle).toBe('sentinel')
      expect(plainCtx.lineWidth).toBe(7)
      expect(plainCtx.measureText).not.toHaveBeenCalled()
    })
  })

  describe('explicit revision rendering cache', () => {
    it('reuses unchanged page layers and redraws only the changed group revision', () => {
      const offscreenContexts: ReturnType<typeof createMockCtx>[] = []
      class MockOffscreenCanvas {
        width: number
        height: number
        private readonly context = createMockCtx()

        constructor(width: number, height: number) {
          this.width = width
          this.height = height
          this.context.canvas = this as unknown as ReturnType<typeof createMockCtx>['canvas']
          offscreenContexts.push(this.context)
        }

        getContext(): ReturnType<typeof createMockCtx> {
          return this.context
        }
      }
      vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)

      const cache = new CanvasRenderCache()
      const page: RenderPage = {
        width: 100,
        height: 100,
        cacheKey: 'preview-page',
        revision: 1,
        children: [
          { type: 'group', x: 0, y: 0, width: 50, height: 50, cacheKey: 'header', revision: 1, children: [
            { type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#FF0000' },
          ] },
          { type: 'group', x: 0, y: 50, width: 50, height: 50, cacheKey: 'detail', revision: 1, children: [
            { type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#0000FF' },
          ] },
        ],
      }

      renderPage(page, new CanvasBackend(createMockCtx(), { renderCache: cache }))
      expect(offscreenContexts).toHaveLength(2)
      renderPage(page, new CanvasBackend(createMockCtx(), { renderCache: cache }))
      expect(offscreenContexts).toHaveLength(2)

      page.revision = 2
      ;(page.children[1] as Extract<RenderPage['children'][number], { type: 'group' }>).revision = 2
      renderPage(page, new CanvasBackend(createMockCtx(), { renderCache: cache }))
      expect(offscreenContexts).toHaveLength(3)
      vi.unstubAllGlobals()
    })

    it('does not allocate cache layers without an explicit revision contract', () => {
      const page: RenderPage = {
        width: 100,
        height: 100,
        children: [{ type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#FF0000' }],
      }
      expect(() => renderPage(page, new CanvasBackend(createMockCtx(), { renderCache: new CanvasRenderCache() }))).not.toThrow()
    })
  })

  describe('drawLine', () => {
    // Verifies drawLine strokes a moveTo/lineTo path with the given width and color.
    it('線が描画される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawLine(0, 0, 100, 100, 2, '#0000FF')

      expect(ctx.beginPath).toHaveBeenCalled()
      expect(ctx.moveTo).toHaveBeenCalledWith(0, 0)
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 100)
      expect(ctx.strokeStyle).toBe('#0000FF')
      expect(ctx.lineWidth).toBe(2)
      expect(ctx.stroke).toHaveBeenCalled()
    })

    // Verifies the dash pattern is applied via setLineDash and reset to [] afterwards.
    it('破線パターンが設定される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawLine(0, 0, 100, 0, 1, '#000', [4, 2])

      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 2])
      // reset
      const dashCalls = ctx._calls.filter(c => c[0] === 'setLineDash')
      expect(dashCalls).toHaveLength(2)
      expect(dashCalls[1]).toEqual(['setLineDash', []])
    })
  })

  describe('drawRect', () => {
    // Verifies drawRect fills a rectangular path with the given fill color.
    it('塗りつぶし矩形が描画される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawRect(10, 20, 100, 50, { fill: '#FF0000' })

      expect(ctx.beginPath).toHaveBeenCalled()
      expect(ctx.rect).toHaveBeenCalledWith(10, 20, 100, 50)
      expect(ctx.fillStyle).toBe('#FF0000')
      expect(ctx.fill).toHaveBeenCalled()
    })

    it('applies local fill and stroke opacity without leaking global alpha', () => {
      const alphaStack: number[] = []
      ctx.globalAlpha = 0.8
      ctx.save.mockImplementation(() => {
        alphaStack.push(ctx.globalAlpha)
        ctx._calls.push(['save'])
      })
      ctx.restore.mockImplementation(() => {
        ctx.globalAlpha = alphaStack.pop()!
        ctx._calls.push(['restore'])
      })
      const observedAlpha: number[] = []
      ctx.fill.mockImplementation(() => {
        observedAlpha.push(ctx.globalAlpha)
        ctx._calls.push(['fill'])
      })
      ctx.stroke.mockImplementation(() => {
        observedAlpha.push(ctx.globalAlpha)
        ctx._calls.push(['stroke'])
      })

      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawRect(10, 20, 100, 50, {
        fill: '#FF0000',
        fillOpacity: 0.5,
        stroke: '#000000',
        strokeOpacity: 0.25,
      })

      expect(observedAlpha).toEqual([0.4, 0.2])
      expect(ctx.globalAlpha).toBe(0.8)
      expect(alphaStack).toHaveLength(0)
    })

    // Verifies drawRect strokes the rectangle with the given stroke color and width.
    it('枠線矩形が描画される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawRect(10, 20, 100, 50, { stroke: '#000', strokeWidth: 2 })

      expect(ctx.strokeStyle).toBe('#000')
      expect(ctx.lineWidth).toBe(2)
      expect(ctx.stroke).toHaveBeenCalled()
    })

    // Verifies a uniform corner radius uses roundRect with a scalar radius.
    it('角丸矩形で roundRect が呼ばれる', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawRect(10, 20, 100, 50, { fill: '#CCC', radius: 5 })

      expect(ctx.roundRect).toHaveBeenCalledWith(10, 20, 100, 50, 5)
    })

    // Verifies per-corner radii are passed to roundRect as a 4-element array in TL/TR/BR/BL order.
    it('四隅個別角丸で roundRect に半径配列が渡される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawRect(10, 20, 100, 50, {
        fill: '#CCC',
        cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
      })

      expect(ctx.roundRect).toHaveBeenCalledWith(10, 20, 100, 50, [4, 8, 12, 16])
    })
  })

  describe('drawEllipse', () => {
    // Verifies drawEllipse builds a full ellipse path (0 to 2π) and fills it.
    it('楕円が描画される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawEllipse(50, 50, 30, 20, { fill: '#00FF00' })

      expect(ctx.beginPath).toHaveBeenCalled()
      expect(ctx.ellipse).toHaveBeenCalledWith(50, 50, 30, 20, 0, 0, Math.PI * 2)
      expect(ctx.fillStyle).toBe('#00FF00')
      expect(ctx.fill).toHaveBeenCalled()
    })
  })

  describe('drawPath', () => {
    // Verifies packed path command/coordinate buffers are translated into Canvas path API calls.
    it('パスコマンドが Canvas API に変換される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      const cmds = new Uint8Array([0, 1, 2, 3])  // MoveTo, LineTo, CubicTo, Close
      const coords = new Float32Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])

      backend.drawPath(cmds, coords, { stroke: '#000', strokeWidth: 1 })

      expect(ctx.moveTo).toHaveBeenCalledWith(10, 20)
      expect(ctx.lineTo).toHaveBeenCalledWith(30, 40)
      expect(ctx.bezierCurveTo).toHaveBeenCalledWith(50, 60, 70, 80, 90, 100)
      expect(ctx.closePath).toHaveBeenCalled()
    })
  })

  describe('drawPathData', () => {
    // Verifies drawPathData draws an SVG d-string via Path2D with transform, fill rule, and stroke when Path2D exists.
    it('Path2D が利用可能な場合は d 文字列を直接描画する', () => {
      const originalPath2D = (globalThis as Record<string, unknown>).Path2D
      class MockPath2D {
        d: string
        constructor(d?: string) {
          this.d = d ?? ''
        }
      }
      ;(globalThis as Record<string, unknown>).Path2D = MockPath2D

      try {
        const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
        const ok = backend.drawPathData(
          'M0 0 L10 0 L10 10 Z',
          [1, 0, 0, 1, 5, 6],
          { fill: '#FF0000', stroke: '#000000', strokeWidth: 2, fillRule: 'evenodd' },
        )

        expect(ok).toBe(true)
        expect(ctx.save).toHaveBeenCalled()
        expect(ctx.transform).toHaveBeenCalledWith(1, 0, 0, 1, 5, 6)
        expect(ctx.fill).toHaveBeenCalledTimes(1)
        expect(ctx.fill.mock.calls[0]?.[0]).toBeInstanceOf(MockPath2D)
        expect(ctx.fill.mock.calls[0]?.[1]).toBe('evenodd')
        expect(ctx.stroke).toHaveBeenCalledTimes(1)
        expect(ctx.stroke.mock.calls[0]?.[0]).toBeInstanceOf(MockPath2D)
        expect(ctx.restore).toHaveBeenCalled()
      } finally {
        if (originalPath2D === undefined) delete (globalThis as Record<string, unknown>).Path2D
        else (globalThis as Record<string, unknown>).Path2D = originalPath2D
      }
    })

    // Verifies drawPathData returns false when Path2D is unavailable so the caller can use another path.
    it('Path2D が無い環境では false を返してフォールバック可能にする', () => {
      const originalPath2D = (globalThis as Record<string, unknown>).Path2D
      delete (globalThis as Record<string, unknown>).Path2D
      try {
        const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
        const ok = backend.drawPathData(
          'M0 0 L1 1',
          [1, 0, 0, 1, 0, 0],
          { stroke: '#000000' },
        )
        expect(ok).toBe(false)
      } finally {
        if (originalPath2D === undefined) delete (globalThis as Record<string, unknown>).Path2D
        else (globalThis as Record<string, unknown>).Path2D = originalPath2D
      }
    })
  })

  describe('drawImage', () => {
    it('コンストラクタで供給した画像をdocument画像より優先する', () => {
      const originalImage = (globalThis as Record<string, unknown>).Image
      class SyncImage {
        complete = true
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
      }
      ;(globalThis as Record<string, unknown>).Image = SyncImage
      try {
        clearCanvasImageCache()
        const backend = new CanvasBackend(ctx, { images: { logo: 'https://example.com/supplied.png' } })
        backend.setImages({ logo: 'https://example.com/document.png' })
        backend.drawImage(0, 0, 10, 10, 'logo')
        const image = ctx.drawImage.mock.calls[0]![0] as SyncImage
        expect(image.src).toBe('https://example.com/supplied.png')
      } finally {
        clearCanvasImageCache()
        if (originalImage === undefined) delete (globalThis as Record<string, unknown>).Image
        else (globalThis as Record<string, unknown>).Image = originalImage
      }
    })

    // Verifies a missing image resource draws a placeholder box with an X mark.
    it('プレースホルダーが描画される（×印）', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      backend.drawImage(10, 20, 100, 80, 'logo')

      // border + diagonals
      expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 100, 80)
      expect(ctx.stroke).toHaveBeenCalled()
    })

    // Verifies a registered image resource is drawn immediately when the Image loads synchronously.
    it('画像リソースがある場合は drawImage が呼ばれる（同期読み込み）', () => {
      const originalImage = (globalThis as Record<string, unknown>).Image
      const originalBtoa = (globalThis as Record<string, unknown>).btoa
      class SyncImage {
        complete = true
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
      }
      ;(globalThis as Record<string, unknown>).Image = SyncImage
      ;(globalThis as Record<string, unknown>).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64')

      try {
        clearCanvasImageCache()
        // 1x1 PNG
        const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2kZ8QAAAAASUVORK5CYII='
        const data = Uint8Array.from(Buffer.from(pngBase64, 'base64'))
        const backend = new CanvasBackend(ctx, {
          scale: 1,
          devicePixelRatio: 1,
          images: { logo: data },
        })
        backend.drawImage(10, 20, 100, 80, 'logo')

        expect(ctx.drawImage).toHaveBeenCalledTimes(1)
        expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(SyncImage), 10, 20, 100, 80)
        clearCanvasImageCache()
      } finally {
        if (originalImage === undefined) delete (globalThis as Record<string, unknown>).Image
        else (globalThis as Record<string, unknown>).Image = originalImage
        if (originalBtoa === undefined) delete (globalThis as Record<string, unknown>).btoa
        else (globalThis as Record<string, unknown>).btoa = originalBtoa
      }
    })

    it('resets image smoothing to the shared default after an explicitly pixelated image', () => {
      const originalImage = (globalThis as Record<string, unknown>).Image
      const originalBtoa = (globalThis as Record<string, unknown>).btoa
      class SyncImage {
        complete = true
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
      }
      ;(globalThis as Record<string, unknown>).Image = SyncImage
      ;(globalThis as Record<string, unknown>).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64')

      try {
        clearCanvasImageCache()
        const data = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2kZ8QAAAAASUVORK5CYII=', 'base64'))
        const backend = new CanvasBackend(ctx, { images: { logo: data } })
        backend.drawImage(0, 0, 10, 10, 'logo', { interpolate: false })
        expect(ctx.imageSmoothingEnabled).toBe(false)
        backend.drawImage(0, 0, 10, 10, 'logo')
        expect(ctx.imageSmoothingEnabled).toBe(true)
      } finally {
        clearCanvasImageCache()
        if (originalImage === undefined) delete (globalThis as Record<string, unknown>).Image
        else (globalThis as Record<string, unknown>).Image = originalImage
        if (originalBtoa === undefined) delete (globalThis as Record<string, unknown>).btoa
        else (globalThis as Record<string, unknown>).btoa = originalBtoa
      }
    })

    // A still-loading image is not painted late (that would lose the active
    // clip and stacking order). Load completion invokes onImagesReady; the
    // owner re-renders and the image is drawn synchronously from the cache.
    it('非同期読み込み中は描画せず、ロード完了で onImagesReady が呼ばれ再描画で同期描画される', () => {
      const originalImage = (globalThis as Record<string, unknown>).Image
      const originalBtoa = (globalThis as Record<string, unknown>).btoa
      class AsyncImage {
        static last: AsyncImage | null = null
        complete = false
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          AsyncImage.last = this
        }
      }
      ;(globalThis as Record<string, unknown>).Image = AsyncImage
      ;(globalThis as Record<string, unknown>).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64')

      try {
        clearCanvasImageCache()
        // 1x1 PNG
        const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2kZ8QAAAAASUVORK5CYII='
        const data = Uint8Array.from(Buffer.from(pngBase64, 'base64'))
        const onImagesReady = vi.fn()
        const backend = new CanvasBackend(ctx, {
          scale: 1,
          devicePixelRatio: 1,
          images: { logo: data },
          onImagesReady,
        })

        backend.drawImage(12, 24, 120, 90, 'logo')
        expect(ctx.drawImage).not.toHaveBeenCalled()

        const image = AsyncImage.last!
        image.complete = true
        image.onload?.()
        expect(onImagesReady).toHaveBeenCalledTimes(1)

        // Re-render: a fresh backend finds the image ready in the shared cache.
        const backend2 = new CanvasBackend(ctx, {
          scale: 1,
          devicePixelRatio: 1,
          images: { logo: data },
        })
        backend2.drawImage(12, 24, 120, 90, 'logo')
        expect(ctx.drawImage).toHaveBeenCalledWith(image, 12, 24, 120, 90)
      } finally {
        clearCanvasImageCache()
        if (originalImage === undefined) delete (globalThis as Record<string, unknown>).Image
        else (globalThis as Record<string, unknown>).Image = originalImage
        if (originalBtoa === undefined) delete (globalThis as Record<string, unknown>).btoa
        else (globalThis as Record<string, unknown>).btoa = originalBtoa
      }
    })

    it('coalesces multiple asynchronous raster completions into one redraw', () => {
      const originalImage = (globalThis as Record<string, unknown>).Image
      const originalBtoa = (globalThis as Record<string, unknown>).btoa
      class AsyncImage {
        static all: AsyncImage[] = []
        complete = false
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        constructor() { AsyncImage.all.push(this) }
      }
      ;(globalThis as Record<string, unknown>).Image = AsyncImage
      ;(globalThis as Record<string, unknown>).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64')

      try {
        clearCanvasImageCache()
        const first = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2kZ8QAAAAASUVORK5CYII=', 'base64'))
        const second = first.slice()
        second[second.length - 1] ^= 1
        const onImagesReady = vi.fn()
        const backend = new CanvasBackend(ctx, {
          images: { first, second },
          onImagesReady,
        })

        backend.drawImage(0, 0, 10, 10, 'first')
        backend.drawImage(10, 0, 10, 10, 'second')
        expect(AsyncImage.all).toHaveLength(2)

        AsyncImage.all[0]!.complete = true
        AsyncImage.all[0]!.onload?.()
        expect(onImagesReady).not.toHaveBeenCalled()

        AsyncImage.all[1]!.complete = true
        AsyncImage.all[1]!.onload?.()
        expect(onImagesReady).toHaveBeenCalledTimes(1)
      } finally {
        clearCanvasImageCache()
        if (originalImage === undefined) delete (globalThis as Record<string, unknown>).Image
        else (globalThis as Record<string, unknown>).Image = originalImage
        if (originalBtoa === undefined) delete (globalThis as Record<string, unknown>).btoa
        else (globalThis as Record<string, unknown>).btoa = originalBtoa
      }
    })
  })

  describe('統合テスト: renderPage との連携', () => {
    it('uses the managed display color for an imported PDF special color', () => {
      const fill: PdfSpecialColorDef = {
        type: 'pdfSpecialColor',
        components: [0.5],
        displayColor: '#336699',
        colorSpace: {
          kind: 'separation',
          name: 'Spot',
          alternate: { kind: 'rgb' },
          tintTransform: { functionType: 2, domain: [0, 1], c0: [0, 0, 0], c1: [1, 1, 1], exponent: 1 },
        },
      }
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      renderPage({ width: 100, height: 100, children: [{ type: 'rect', x: 10, y: 10, width: 20, height: 20, fill }] }, backend)
      expect(ctx.fillStyle).toBe('#336699')
      expect(ctx.fill).toHaveBeenCalled()
    })

    // Verifies a full renderPage pass drives the backend correctly for rects, a clipped group, text, and lines.
    it('ページ全体が正しく描画される', () => {
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1 })
      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          { type: 'rect', x: 0, y: 0, width: 595, height: 842, fill: '#FFFFFF' },
          {
            type: 'group', x: 72, y: 72, width: 451, height: 698,
            clip: true,
            children: [
              {
                type: 'text', x: 0, y: 0,
                text: 'Report Title', fontId: 'serif', fontSize: 24, color: '#333333',
              },
              {
                type: 'line', x1: 0, y1: 30, x2: 451, y2: 30,
                lineWidth: 1, color: '#999999',
              },
            ],
          },
        ],
      }

      renderPage(page, backend)

      // beginPage + white background
      expect(ctx.setTransform).toHaveBeenCalled()
      // rect drawing
      expect(ctx.fill).toHaveBeenCalled()
      // group (save, translate, clip)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.translate).toHaveBeenCalledWith(72, 72)
      expect(ctx.clip).toHaveBeenCalled()
      // text
      expect(ctx.fillText).toHaveBeenCalledWith('Report Title', 0, 0)
      // line
      expect(ctx.stroke).toHaveBeenCalled()
      // restore
      expect(ctx.restore).toHaveBeenCalled()
    })
  })
})
