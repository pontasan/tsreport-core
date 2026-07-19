/**
 * SVG backend tests
 *
 * Verifies the SvgBackend serializes RenderBackend primitives into standalone
 * per-page <svg> documents with the same drawing semantics as the Canvas
 * backend: glyph outlines as <path> fills, rounded rectangles, dashed lines,
 * ellipses, raster images as data URIs, clipping, multi-page output, XML
 * escaping and native vector rendering of SVG elements.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { SvgBackend } from '../../src/renderer/svg-backend.js'
import { render, renderPage } from '../../src/renderer/renderer.js'
import { createReport } from '../../src/layout/engine.js'
import { zlibDeflate } from '../../src/compression/deflate.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderPage } from '../../src/types/render.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

// ─── Test fonts ───

let ttfFont: Font   // TrueType (Roboto)
let jpFont: Font    // CFF/OTF (NotoSansJP - Japanese CJK)

beforeAll(() => {
  const ttfBuf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  ttfFont = Font.load(ttfBuf.buffer as ArrayBuffer)

  const jpBuf = readFileSync(join(FIXTURES, 'NotoSansJP-Regular.otf'))
  jpFont = Font.load(jpBuf.buffer as ArrayBuffer)
})

// ─── Minimal PNG generation (same approach as the PDF image tests) ───

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const tb = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)])
  const ci = new Uint8Array(4 + data.length)
  ci.set(tb); ci.set(data, 4)
  const crc = crc32(ci)
  const chunk = new Uint8Array(12 + data.length)
  chunk[0] = (data.length >> 24) & 0xFF; chunk[1] = (data.length >> 16) & 0xFF
  chunk[2] = (data.length >> 8) & 0xFF; chunk[3] = data.length & 0xFF
  chunk.set(tb, 4); chunk.set(data, 8)
  chunk[8 + data.length] = (crc >> 24) & 0xFF; chunk[8 + data.length + 1] = (crc >> 16) & 0xFF
  chunk[8 + data.length + 2] = (crc >> 8) & 0xFF; chunk[8 + data.length + 3] = crc & 0xFF
  return chunk
}

function createMinimalPng(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  ihdr[0] = (width >> 24) & 0xFF; ihdr[1] = (width >> 16) & 0xFF; ihdr[2] = (width >> 8) & 0xFF; ihdr[3] = width & 0xFF
  ihdr[4] = (height >> 24) & 0xFF; ihdr[5] = (height >> 16) & 0xFF; ihdr[6] = (height >> 8) & 0xFF; ihdr[7] = height & 0xFF
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
  const rowBytes = width * 3
  const raw = new Uint8Array(height * (rowBytes + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0 // filter None
    for (let x = 0; x < rowBytes; x++) raw[y * (rowBytes + 1) + 1 + x] = (x + y * 17) & 0xFF
  }
  const compressed = zlibDeflate(raw)
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const chunks = [makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', new Uint8Array(0))]
  let total = sig.length
  for (const c of chunks) total += c.length
  const result = new Uint8Array(total)
  result.set(sig)
  let pos = sig.length
  for (const c of chunks) { result.set(c, pos); pos += c.length }
  return result
}

// ─── Helpers ───

/** X coordinate of the first glyph path MoveTo in an SVG page */
function firstGlyphPathX(svg: string): number {
  const m = svg.match(/<path d="M(-?[\d.]+) /)
  expect(m).not.toBeNull()
  return parseFloat(m![1]!)
}

// ─── Tests ───

describe('SvgBackend', () => {

  it('owns image maps and restores constructor images at each document boundary', () => {
    const suppliedImages = { supplied: new Uint8Array([1]) }
    const documentImages = { document: new Uint8Array([2]) }
    const backend = new SvgBackend({ images: suppliedImages, background: null })
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

  // ═══ 1. Full template via createReport + render ═══
  describe('createReport + render 統合', () => {
    // Verifies a template mixing text, rounded rect, dashed line, ellipse and
    // a PNG image serializes into a single well-formed SVG page.
    it('複数要素テンプレート → SVGルート属性・グリフパス・角丸・破線・data URI 画像', () => {
      const png = createMinimalPng(8, 8)
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
        bands: {
          details: [{
            height: 200,
            elements: [
              { type: 'staticText', x: 0, y: 0, width: 200, height: 20, text: 'Invoice Report' },
              { type: 'rectangle', x: 0, y: 30, width: 100, height: 40, radius: 5, fill: '#EEEEEE', stroke: '#333333', strokeWidth: 1 },
              { type: 'line', x: 0, y: 80, width: 200, height: 0, lineWidth: 1, lineStyle: 'dashed', lineColor: '#FF0000' },
              { type: 'ellipse', x: 120, y: 30, width: 60, height: 40, fill: '#00AA00' },
              { type: 'image', x: 0, y: 100, width: 80, height: 60, source: 'logo', scaleMode: 'fillFrame' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, {
        fontMap: new Map([['default', new TextMeasurer(ttfFont)]]),
        resources: { images: { logo: png } },
      })
      const backend = new SvgBackend({ fonts: { default: ttfFont }, images: doc.images })
      render(doc, backend)

      const pages = backend.getPages()
      expect(pages).toHaveLength(1)
      const svg = pages[0]!

      // SVG root: namespaces, pt size, viewBox in pt coordinates
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"')).toBe(true)
      expect(svg).toMatch(/width="[\d.]+pt" height="[\d.]+pt" viewBox="0 0 [\d.]+ [\d.]+">/)
      expect(svg.endsWith('</svg>')).toBe(true)

      // Page background
      expect(svg).toContain('fill="#FFFFFF"')

      // Text as glyph outline paths, not <text>
      expect(svg).toContain('<path d="M')
      expect(svg).not.toContain('<text')

      // Rounded rectangle as a path with A (arc) commands of radius 5
      expect(svg).toMatch(/A5 5 0 0 1/)
      expect(svg).toContain('fill="#EEEEEE"')
      expect(svg).toContain('stroke="#333333"')

      // Dashed line
      expect(svg).toMatch(/<line [^>]*stroke="#FF0000"[^>]*stroke-dasharray="4 2"/)

      // Ellipse
      expect(svg).toMatch(/<ellipse [^>]*fill="#00AA00"/)

      // PNG image embedded as a data URI with layout-driven sizing
      expect(svg).toMatch(/<image [^>]*preserveAspectRatio="none" href="data:image\/png;base64,/)
    })
  })

  // ═══ 2. Glyph outlines + hAlign ═══
  describe('グリフアウトライン描画', () => {
    function renderTextPage(hAlign: 'left' | 'center' | 'right'): string {
      const backend = new SvgBackend({ fonts: { default: ttfFont }, background: null })
      const page: RenderPage = {
        width: 300, height: 100,
        children: [{
          type: 'text', x: 10, y: 10, text: 'AB',
          fontId: 'default', fontSize: 12, color: '#000000',
          hAlign, width: 200,
        }],
      }
      backend.beginPage(page.width, page.height)
      renderPage(page, backend)
      backend.endPage()
      return backend.getPages()[0]!
    }

    // Verifies registered fonts always produce <path> glyph outlines, never <text>.
    it('テキストがグリフ <path> として出力され <text> を含まない', () => {
      const svg = renderTextPage('left')
      expect(svg).toContain('<path d="M')
      expect(svg).not.toContain('<text')
      expect(svg).toContain('fill="#000000"')
    })

    // Verifies hAlign shifts the glyph start X: left < center < right.
    it('hAlign center/right で開始 X 座標が変わる', () => {
      const xLeft = firstGlyphPathX(renderTextPage('left'))
      const xCenter = firstGlyphPathX(renderTextPage('center'))
      const xRight = firstGlyphPathX(renderTextPage('right'))
      expect(xCenter).toBeGreaterThan(xLeft)
      expect(xRight).toBeGreaterThan(xCenter)

      // center = x + (width - textExtent) / 2 with textExtent from advance widths
      const s = 12 / ttfFont.metrics.unitsPerEm
      let textExtent = 0
      for (const ch of 'AB') {
        textExtent += ttfFont.getAdvanceWidth(ttfFont.getGlyphId(ch.codePointAt(0)!)) * s
      }
      const expectedShift = (200 - textExtent) / 2
      expect(xCenter - xLeft).toBeCloseTo(expectedShift, 2)
      expect(xRight - xLeft).toBeCloseTo(expectedShift * 2, 2)
    })

    // Verifies underline emits a decoration <line> with the text color.
    it('underline → 装飾 <line> が出力される', () => {
      const backend = new SvgBackend({ fonts: { default: ttfFont }, background: null })
      backend.beginPage(300, 100)
      backend.drawText(10, 10, 'Test', 'default', 12, '#112233', { underline: true })
      backend.endPage()
      const svg = backend.getPages()[0]!
      expect(svg).toMatch(/<line [^>]*stroke="#112233"/)
    })
  })

  // ═══ 3. Clipping ═══
  describe('クリッピング', () => {
    // Verifies a frame's clipped group produces a <clipPath> definition and a
    // clip-path group reference.
    it('frame 内要素 → <clipPath> 定義と clip-path 参照が生成される', () => {
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 100,
            elements: [{
              type: 'frame', x: 10, y: 10, width: 150, height: 60,
              elements: [
                { type: 'staticText', x: 0, y: 0, width: 140, height: 20, text: 'Framed' },
              ],
            }],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] }, {
        fontMap: new Map([['default', new TextMeasurer(ttfFont)]]),
      })
      const backend = new SvgBackend({ fonts: { default: ttfFont } })
      render(doc, backend)

      const svg = backend.getPages()[0]!
      expect(svg).toContain('<clipPath id="')
      expect(svg).toContain('clip-path="url(#')
      // clip groups are balanced
      expect(svg.split('<g ').length).toBe(svg.split('</g>').length)
    })
  })

  // ═══ 4. Multi-page ═══
  describe('複数ページ', () => {
    // Verifies detail overflow yields one complete <svg> document per page.
    it('detail 溢れ → getPages() がページ数分の <svg> を返す', () => {
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < 12; i++) rows.push({ label: `Row ${i}` })
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
        bands: {
          details: [{
            height: 100,
            elements: [
              { type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: 'field.label' },
            ],
          }],
        },
      }
      const doc = createReport(template, { rows }, {
        fontMap: new Map([['default', new TextMeasurer(ttfFont)]]),
      })
      expect(doc.pages.length).toBeGreaterThanOrEqual(2)

      const backend = new SvgBackend({ fonts: { default: ttfFont } })
      render(doc, backend)

      const pages = backend.getPages()
      expect(pages.length).toBe(doc.pages.length)
      for (const page of pages) {
        expect(page.startsWith('<svg ')).toBe(true)
        expect(page.endsWith('</svg>')).toBe(true)
      }
    })
  })

  // ═══ 5. Japanese text + XML escaping ═══
  describe('日本語テキストと XML エスケープ', () => {
    // Verifies Japanese glyphs render as outline paths through the CJK font.
    it('日本語テキスト → グリフアウトラインが出力される', () => {
      const backend = new SvgBackend({ fonts: { jp: jpFont }, background: null })
      backend.beginPage(300, 100)
      backend.drawText(10, 10, 'あいう漢', 'jp', 12, '#000000')
      backend.endPage()
      const svg = backend.getPages()[0]!
      // 4 glyphs → at least 4 filled paths
      expect(svg.split('<path d="M').length - 1).toBeGreaterThanOrEqual(4)
      expect(svg).not.toContain('<text')
    })

    // Verifies the CSS fallback <text> path escapes XML special characters.
    it('CSS フォールバック <text> で特殊文字がエスケープされる', () => {
      const backend = new SvgBackend({ background: null })
      backend.beginPage(300, 100)
      backend.drawText(10, 10, 'A<B>&"C', 'CustomFont & Co', 12, '#000000')
      backend.endPage()
      const svg = backend.getPages()[0]!
      expect(svg).toContain('<text')
      expect(svg).toContain('A&lt;B&gt;&amp;"C')
      expect(svg).toContain('font-family="CustomFont &amp; Co"')
      expect(svg).not.toContain('A<B>')
    })
  })

  // ═══ 6. SVG element native vector rendering ═══
  describe('SVG 要素のネイティブベクター描画', () => {
    // Verifies an svg-kind element is re-rendered through this backend's own
    // vector primitives (drawSvg → renderSvg) rather than rasterized.
    it('svg 要素 → renderSvg がバックエンドのプリミティブでベクター描画', () => {
      const svgContent = '<svg viewBox="0 0 10 10">'
        + '<rect x="1" y="1" width="8" height="8" fill="#FF0000"/>'
        + '<circle cx="5" cy="5" r="3" fill="#0000FF"/>'
        + '</svg>'
      const template: ReportTemplate = {
        page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 120,
            elements: [{
              type: 'svg', x: 10, y: 10, width: 100, height: 100,
              svgContent: () => svgContent,
            }],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      const backend = new SvgBackend()
      render(doc, backend)

      const svg = backend.getPages()[0]!
      // Vector fills survive (no raster <image> for the svg element)
      expect(svg).not.toContain('<image')
      expect(svg).toMatch(/fill="(#FF0000|rgb\(255, ?0, ?0\))"/i)
      expect(svg).toMatch(/fill="(#0000FF|rgb\(0, ?0, ?255\))"/i)
      // renderSvg clips to the element area on this backend
      expect(svg).toContain('<clipPath id="')
      // groups stay balanced through the nested renderSvg pass
      expect(svg.split('<g ').length).toBe(svg.split('</g>').length)
    })
  })

  // ═══ 7. Image fallbacks ═══
  describe('画像フォールバック', () => {
    it('コンストラクタで供給した画像をdocument画像より優先する', () => {
      const backend = new SvgBackend({
        background: null,
        images: { logo: 'https://example.com/supplied.png' },
      })
      backend.setImages({ logo: 'https://example.com/document.png' })
      backend.beginPage(100, 100)
      backend.drawImage(0, 0, 10, 10, 'logo')
      backend.endPage()
      expect(backend.getPages()[0]).toContain('href="https://example.com/supplied.png"')
    })

    // Verifies a missing image id draws the frame + cross placeholder.
    it('missing 画像 → プレースホルダ（枠 + バツ線）', () => {
      const backend = new SvgBackend({ background: null })
      backend.beginPage(200, 200)
      backend.drawImage(10, 10, 80, 60, 'nonexistent')
      backend.endPage()
      const svg = backend.getPages()[0]!
      expect(svg).toMatch(/<rect [^>]*stroke="#CCCCCC" stroke-width="0.5"/)
      expect(svg).toMatch(/<path d="M10 10L90 70M90 10L10 70"/)
    })

    // Verifies an external URL image is referenced directly by href.
    it('external-url 画像 → href に URL がそのまま入る', () => {
      const backend = new SvgBackend({
        background: null,
        images: { remote: 'https://example.com/a.png' },
      })
      backend.beginPage(200, 200)
      backend.drawImage(0, 0, 100, 100, 'remote')
      backend.endPage()
      const svg = backend.getPages()[0]!
      expect(svg).toContain('href="https://example.com/a.png"')
    })
  })
})
