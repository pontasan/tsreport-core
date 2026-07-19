/**
 * Color font renderer integration tests
 *
 * Verifies COLR v0 color-layer drawing on the Canvas backend and
 * color-glyph path drawing on the PDF backend.
 *
 * Since no real color font file is available, drawing commands are
 * verified through a Font mock plus a Canvas context mock.
 */

import { describe, test, expect, vi } from 'vitest'
import { CanvasBackend } from '../../src/renderer/canvas-backend.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import type { Font } from '../../src/font.js'
import { pdfToText } from '../renderer/pdf-test-utils.js'

/** Minimal Font mock for tests */
function createMockFont(options?: {
  colorLayers?: Map<number, { glyphId: number, paletteIndex: number }[]>
  paletteColors?: Map<number, { r: number, g: number, b: number, a: number }>
}): Font {
  const colorLayers = options?.colorLayers ?? new Map()
  const paletteColors = options?.paletteColors ?? new Map()

  // Base glyph outline (a simple rectangle)
  const makeOutline = () => ({
    commands: new Uint8Array([0, 1, 1, 1, 3]),   // MoveTo, LineTo×3, Close
    coords: new Float32Array([0, 0, 500, 0, 500, 700, 0, 700]),
  })

  return {
    metrics: {
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      xHeight: 500,
      capHeight: 700,
      underlinePosition: -100,
      underlineThickness: 50,
      italicAngle: 0,
      isBold: false,
    },
    hasScalableOutlines: true,  // provides glyf-style outlines via getGlyph
    hasColrGlyphs: colorLayers.size > 0,
    hasSvgGlyphs: false,
    hasEmbeddedBitmapGlyphs: false,
    embeddingPermissions: { level: 'installable', noSubsetting: false, bitmapOnly: false },
    getGlyphId: (cp: number) => cp,  // codePoint = glyphId for simplicity
    getGlyph: (_gid: number) => ({ outline: makeOutline() }),
    getAdvanceWidth: (_gid: number) => 600,
    getColorLayers: (gid: number) => {
      const layers = colorLayers.get(gid)
      return layers ?? null
    },
    getColorFromSelectedPalette: (colorIdx: number) => {
      return paletteColors.get(colorIdx) ?? null
    },
    getPaintTree: (_gid: number) => null,
    getClipBox: (_gid: number) => null,
    getSvgGlyphDocument: (_gid: number) => null,
    getBitmapGlyphRender: (_gid: number, _ppem: number) => null,
    setVariation: vi.fn(),
    postScriptName: 'MockFont',
    isCff: false,
    subsetByGlyphIds: () => ({
      buffer: new ArrayBuffer(0),
      oldToNewGlyphId: new Map(),
    }),
  } as unknown as Font
}

/** Mock of a Canvas 2D context */
function createMockCanvasContext() {
  const calls: { method: string, args: unknown[] }[] = []
  const storage: Record<string, unknown> = {}
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === 'canvas') {
        return { width: 0, height: 0, style: {} }
      }
      if (prop === '_calls') return calls
      // Return a previously set value
      if (prop in storage) return storage[prop]
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
      }
    },
    set(_target, prop: string, value: unknown) {
      calls.push({ method: prop, args: [value] })
      storage[prop] = value
      return true
    },
  }
  return new Proxy({} as Record<string, unknown>, handler)
}

describe('カラーフォント Canvas レンダリング', () => {
  // Verifies the Canvas backend draws each COLR v0 layer as a separate fill using its CPAL palette color.
  test('COLR v0: カラーレイヤーがあるグリフはレイヤーごとに色を変えて描画', () => {
    const colorLayers = new Map([
      [65, [  // color layers for 'A'
        { glyphId: 100, paletteIndex: 0 },
        { glyphId: 101, paletteIndex: 1 },
      ]],
    ])
    const paletteColors = new Map([
      [0, { r: 255, g: 0, b: 0, a: 255 }],    // red
      [1, { r: 0, g: 0, b: 255, a: 255 }],      // blue
    ])
    const font = createMockFont({ colorLayers, paletteColors })

    const ctx = createMockCanvasContext()
    const backend = new CanvasBackend(ctx, {
      scale: 1,
      devicePixelRatio: 1,
      fonts: { testFont: font },
    })

    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'testFont', 12, '#000000')
    backend.endPage()
    backend.endDocument()

    const calls = (ctx as any)._calls as { method: string, args: unknown[] }[]

    // Was fillStyle set to the red and blue palette colors?
    const fillStyleSets = calls.filter(c => c.method === 'fillStyle')
    const colorValues = fillStyleSets.map(c => c.args[0] as string)
    expect(colorValues).toContain('rgba(255,0,0,1)')
    expect(colorValues).toContain('rgba(0,0,255,1)')

    // fill() is called at least twice (two layers + the white-background fillRect)
    const fillCalls = calls.filter(c => c.method === 'fill')
    expect(fillCalls.length).toBeGreaterThanOrEqual(2)
  })

  // Verifies the special palette index 0xFFFF makes a layer use the current text color instead of CPAL.
  test('COLR v0: paletteIndex=0xFFFF はテキスト色を使用', () => {
    const colorLayers = new Map([
      [65, [
        { glyphId: 100, paletteIndex: 0xFFFF },  // use text color
      ]],
    ])
    const font = createMockFont({ colorLayers })

    const ctx = createMockCanvasContext()
    const backend = new CanvasBackend(ctx, {
      scale: 1,
      devicePixelRatio: 1,
      fonts: { testFont: font },
    })

    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'testFont', 12, '#FF0000')
    backend.endPage()

    const calls = (ctx as any)._calls as { method: string, args: unknown[] }[]
    // drawGlyphOutline sets fillStyle = color (which is '#FF0000') for paletteIndex=0xFFFF
    const fillStyleCalls = calls.filter(
      c => c.method === 'fillStyle' && c.args[0] === '#FF0000',
    )
    expect(fillStyleCalls.length).toBeGreaterThanOrEqual(1)
  })

  // Verifies glyphs without color layers fall back to a normal single-color outline fill.
  test('カラーレイヤーなしのグリフは通常描画', () => {
    const font = createMockFont() // no color layers

    const ctx = createMockCanvasContext()
    const backend = new CanvasBackend(ctx, {
      scale: 1,
      devicePixelRatio: 1,
      fonts: { testFont: font },
    })

    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'testFont', 12, '#000000')
    backend.endPage()

    const calls = (ctx as any)._calls as { method: string, args: unknown[] }[]
    // Normal drawing: drawGlyphOutline calls fill()
    const fillCalls = calls.filter(c => c.method === 'fill')
    expect(fillCalls.length).toBeGreaterThanOrEqual(1)

    // fillStyle is set to '#000000' (the text color)
    const fillStyleCalls = calls.filter(
      c => c.method === 'fillStyle' && c.args[0] === '#000000',
    )
    expect(fillStyleCalls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('カラーフォント PDF レンダリング', () => {
  // Verifies the PDF backend renders COLR glyphs as filled vector paths ('rg' color operator) instead of text.
  test('COLR v0: カラーグリフは PDF パスとして描画される', () => {
    const colorLayers = new Map([
      [65, [
        { glyphId: 100, paletteIndex: 0 },
        { glyphId: 101, paletteIndex: 1 },
      ]],
    ])
    const paletteColors = new Map([
      [0, { r: 255, g: 0, b: 0, a: 255 }],
      [1, { r: 0, g: 0, b: 255, a: 255 }],
    ])
    const font = createMockFont({ colorLayers, paletteColors })

    const backend = new PdfBackend({
      fonts: { testFont: font },
    })

    backend.beginDocument()
    backend.beginPage(595, 842)
    backend.drawText(10, 10, 'A', 'testFont', 12, '#000000')
    backend.endPage()
    backend.endDocument()

    // Generate the PDF output (color glyphs are drawn as paths, not BT/ET)
    const pdfData = backend.toUint8Array()
    expect(pdfData.length).toBeGreaterThan(0)

    // The PDF content includes the 'f' (fill) operator
    const pdfStr = pdfToText(pdfData)
    // Path drawing emits 'rg' (fill color) + path commands + 'f'
    expect(pdfStr).toContain('rg')
  })

  // Verifies non-color glyphs are emitted as regular CID text (BT/ET/Tj operators).
  test('カラーグリフなしの場合は通常の CID テキストとして出力', () => {
    const font = createMockFont()

    const backend = new PdfBackend({
      fonts: { testFont: font },
    })

    backend.beginDocument()
    backend.beginPage(595, 842)
    backend.drawText(10, 10, 'A', 'testFont', 12, '#000000')
    backend.endPage()
    backend.endDocument()

    const pdfData = backend.toUint8Array()
    const pdfStr = pdfToText(pdfData)

    // Text is drawn with BT/ET
    expect(pdfStr).toContain('BT')
    expect(pdfStr).toContain('ET')
    expect(pdfStr).toContain('Tj')
  })
})

describe('Variable Font バックエンド統合', () => {
  // Verifies the Canvas backend forwards the drawText variation option to Font.setVariation.
  test('Canvas: drawText で variation が setVariation に渡される', () => {
    const font = createMockFont()
    const setVariationSpy = vi.spyOn(font, 'setVariation' as any)

    const ctx = createMockCanvasContext()
    const backend = new CanvasBackend(ctx, {
      scale: 1,
      devicePixelRatio: 1,
      fonts: { testFont: font },
    })

    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'testFont', 12, '#000000', {
      variation: { wght: 700, wdth: 75 },
    })
    backend.endPage()

    expect(setVariationSpy).toHaveBeenCalledWith({ wght: 700, wdth: 75 })
  })

  // Verifies the PDF backend forwards the drawText variation option to Font.setVariation.
  test('PDF: drawText で variation が setVariation に渡される', () => {
    const font = createMockFont()
    const setVariationSpy = vi.spyOn(font, 'setVariation' as any)

    const backend = new PdfBackend({
      fonts: { testFont: font },
    })

    backend.beginDocument()
    backend.beginPage(595, 842)
    backend.drawText(10, 10, 'A', 'testFont', 12, '#000000', {
      variation: { wght: 900 },
    })
    backend.endPage()

    expect(setVariationSpy).toHaveBeenCalledWith({ wght: 900 })
  })

  // Verifies setVariation is never invoked when drawText is called without a variation option.
  test('variation なしの場合は setVariation が呼ばれない', () => {
    const font = createMockFont()
    const setVariationSpy = vi.spyOn(font, 'setVariation' as any)

    const ctx = createMockCanvasContext()
    const backend = new CanvasBackend(ctx, {
      scale: 1,
      devicePixelRatio: 1,
      fonts: { testFont: font },
    })

    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A', 'testFont', 12, '#000000')
    backend.endPage()

    expect(setVariationSpy).not.toHaveBeenCalled()
  })
})
