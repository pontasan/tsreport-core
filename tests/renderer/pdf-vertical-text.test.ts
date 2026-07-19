/**
 * Identity-V vertical CID text output: vertical writing renders as a real
 * text object (selectable/searchable) with a /Encoding /Identity-V Type0
 * variant and /W2 vertical metrics, instead of glyph outline paths.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { pdfToText } from './pdf-test-utils.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

let notoSansJp: Font

beforeAll(() => {
  const jp = readFileSync(join(FIXTURES, 'NotoSansJP-Regular.otf'))
  notoSansJp = Font.load(jp.buffer.slice(jp.byteOffset, jp.byteOffset + jp.byteLength) as ArrayBuffer)
})

function renderVertical(text: string, options?: Record<string, unknown>): string {
  const backend = new PdfBackend({ fonts: { f: notoSansJp } })
  backend.beginDocument()
  backend.beginPage(595, 842)
  backend.drawText(500, 50, text, 'f', 20, '#000000', { writingMode: 'vertical-rl', ...options })
  backend.endPage()
  backend.endDocument()
  return pdfToText(backend.toUint8Array())
}

describe('Identity-V vertical text', () => {
  it('emits a Type0 Identity-V variant sharing the descendant font', () => {
    const text = renderVertical('縦書きのテスト')
    expect(text).toContain('/Encoding /Identity-V')
    expect(text).toContain('/Encoding /Identity-H')
    // Both Type0 variants reference the same descendant CIDFont
    const refs = [...text.matchAll(/\/DescendantFonts \[(\d+) 0 R\]/g)].map(function (m) { return m[1] })
    expect(refs.length).toBe(2)
    expect(refs[0]).toBe(refs[1])
    // The page font resources include the vertical variant
    expect(text).toMatch(/\/F0V \d+ 0 R/)
  })

  it('positions the column at the center-top and emits W2 metrics', () => {
    const text = renderVertical('あ')
    // Tm x = 500 + fontSize/2
    expect(text).toContain('1 0 0 -1 510 50 Tm')
    expect(text).toContain('/DW2 [880 -1000]')
    // W2 entries carry [-advanceHeight vx vy]
    const w2 = text.match(/\/W2 \[([^\]]+)\]/)
    expect(w2).not.toBeNull()
    const gid = notoSansJp.getGlyphId(0x3042)
    const scale1000 = 1000 / notoSansJp.metrics.unitsPerEm
    const expectedAh = -Math.round(notoSansJp.getAdvanceHeight(gid) * scale1000)
    const expectedVx = Math.round(notoSansJp.getAdvanceWidth(gid) * scale1000 / 2)
    expect(w2![1]).toContain(`[${expectedAh} ${expectedVx} `)
  })

  it('letter spacing surfaces as vertical TJ adjustments', () => {
    const spaced = renderVertical('あい', { letterSpacing: 5 })
    // The TJ entries include vertical GPOS advance deltas plus the requested
    // letter spacing, so assert the text-mode spacing surface instead of a
    // fixed legacy value.
    expect(spaced).toMatch(/\[[^\]]*-\d+\s+<0001>[^\]]*\] TJ/)
    expect(spaced).toMatch(/\[[^\]]*-\d+\s+<0002>[^\]]*\] TJ/)
  })

  it('synthetic bold vertical text draws visible glyphs as paths with an invisible text overlay', () => {
    const text = renderVertical('あ', { bold: true })
    // The visible bold glyphs are painted as vector paths (synthetic bold is a
    // path-space operation), so an invisible text layer (render mode 3) is
    // overlaid to keep the run extractable/searchable. That overlay is a real
    // Identity-V text object; assert it is emitted in invisible mode.
    expect(text).toContain('3 Tr')
    expect(text).toContain('0 Tr')
    expect(text).toContain('/Encoding /Identity-V')
  })
})

describe('vertical text round trip', () => {
  it('re-imports Identity-V output as a vertical staticText column', async () => {
    const { PdfImporter } = await import('../../src/index.js')
    const backend = new PdfBackend({ fonts: { f: notoSansJp } })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.drawText(150, 20, '縦書きのテスト', 'f', 16, '#000000', { writingMode: 'vertical-rl' })
    backend.endPage()
    backend.endDocument()
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const texts = page.elements.filter(function (el) { return el.type === 'staticText' })
    expect(texts.length).toBe(1)
    const el = texts[0]! as { x: number, y: number, width: number, height: number, text: string, style?: string }
    expect(el.text).toBe('縦書きのテスト')
    // Column geometry: origin x/y as drawn, width = font size, height follows
    // the shaped vertical advances (HarfBuzz-matching `vert`-only shaping keeps
    // every full-width glyph on a 1em advance, so the column height equals the
    // sum of the vertical advances).
    expect(el.x).toBeCloseTo(150, 1)
    expect(el.y).toBeCloseTo(20, 1)
    expect(el.width).toBeCloseTo(16, 1)
    const shaped = notoSansJp.shapeText('縦書きのテスト', { direction: 'vertical' })
    const expectedHeight = shaped.reduce(function (sum, g) { return sum + g.yAdvance * 16 / notoSansJp.metrics.unitsPerEm }, 0)
    expect(el.height).toBeGreaterThanOrEqual(expectedHeight)
    expect(el.height).toBeLessThan(expectedHeight + 16)
    const style = page.styles.find(function (s) { return s.name === el.style })
    expect(style?.writingMode).toBe('vertical-rl')
  })
})

describe('strikeout metrics consumption', () => {
  it('font metrics expose the OS/2 strikeout values', () => {
    const m = notoSansJp.metrics
    // NotoSansJP carries real OS/2 strikeout metrics (non-zero)
    expect(m.strikeoutPosition).toBeGreaterThan(0)
    expect(m.strikeoutSize).toBeGreaterThan(0)
  })

  it('the strikethrough line derives from strikeoutPosition, not x-height', () => {
    const backend = new PdfBackend({ fonts: { f: notoSansJp } })
    backend.beginDocument()
    backend.beginPage(595, 842)
    backend.drawText(50, 50, 'strike', 'f', 20, '#000000', { strikethrough: true })
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    const m = notoSansJp.metrics
    const scale = 20 / m.unitsPerEm
    const ascent = m.ascender * scale
    const expectedY = 50 + ascent - m.strikeoutPosition * scale
    // The strike line op "x y m x2 y l S" carries the expected y
    const match = text.match(/([\d.]+) ([\d.]+) m [\d.]+ \2 l S/)
    expect(match).not.toBeNull()
    expect(parseFloat(match![2]!)).toBeCloseTo(expectedY, 1)
  })
})
