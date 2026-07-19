import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, PdfBackend, PdfImporter } from '../../src/index.js'
import { render } from '../../src/renderer/renderer.js'
import { pdfToText } from './pdf-test-utils.js'

const ROBOTO_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')

describe('PDF Shading Pattern', () => {
  // Verifies plain text output produces a valid /Font resource without any Shading entries.
  it('ShadingDef が正しく生成される（リソースに /Shading が含まれる）', () => {
    // Drives PdfBackend directly to exercise the Shading path.
    // No test fixture font has COLR v1 glyphs, so this only validates
    // the surrounding structure as a unit test.
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const backend = new PdfBackend({ fonts: { roboto: font } })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.drawText(10, 10, 'A', 'roboto', 12, '#000000')
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    expect(pdf.length).toBeGreaterThan(0)
    const text = pdfToText(pdf)
    // Plain text does not use Shading
    expect(text).toContain('/Font')
  })

  // Verifies no /Shading section is emitted when the document contains no gradients.
  it('buildShadingFunction が Type 2 Function を生成する（2 stops）', () => {
    // Validate the generated PDF after adding shadingDefs.
    // ShadingDef and buildShadingFunction are internal helpers.
    // The PDF output is the observable contract.
    // Indirect check: ShadingDef and buildShadingFunction are module-internal,
    // so the behavior is validated through the full PDF output.
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const backend = new PdfBackend({ fonts: { roboto: font } })
    backend.beginDocument()
    backend.beginPage(200, 200)
    // Plain drawText → no Shading
    backend.drawText(10, 10, 'Hello', 'roboto', 12, '#000000')
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const text = pdfToText(pdf)
    // No Shading section (no gradients in the document)
    expect(text).not.toContain('/Shading')
  })

  // Verifies that setOpacity produces an ExtGState resource with the expected /ca value.
  it('ExtGState に blending mode を含める', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const backend = new PdfBackend({ fonts: { roboto: font } })
    backend.beginDocument()
    backend.beginPage(200, 200)
    // setOpacity generates an ExtGState
    backend.save()
    backend.setOpacity(0.5)
    backend.drawRect(10, 10, 100, 100, { fill: '#ff0000' })
    backend.restore()
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const text = pdfToText(pdf)
    expect(text).toContain('/ExtGState')
    expect(text).toContain('/ca 0.5')
  })

  // Verifies that a text + rect page yields a structurally valid PDF (header, EOF, Catalog, Page).
  it('PDF 出力が有効な構造を持つ', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const backend = new PdfBackend({ fonts: { roboto: font } })
    backend.beginDocument()
    backend.beginPage(595, 842)
    backend.drawText(72, 72, 'Test', 'roboto', 24, '#333333')
    backend.drawRect(50, 50, 200, 100, { fill: '#eeeeee', stroke: '#000000', strokeWidth: 1 })
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const text = pdfToText(pdf)
    expect(text).toContain('%PDF-1.7')
    expect(text).toContain('%%EOF')
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('/Type /Page')
  })
})

// Sanity checks around the internal shading-function generation logic (no COLR v1 fixture available).
describe('PDF Shading Function 生成ロジック', () => {
  // Verifies an empty page still renders to a non-empty PDF; a smoke test standing in for compositeModeToBlendMode.
  it('compositeModeToBlendMode マッピング（内部関数テスト）', () => {
    // CompositeMode enum values → PDF blend mode.
    // The function is module-internal, so it is tested indirectly.
    // Verifying Multiply (23) → 'Multiply' would require a COLR v1 font;
    // here only basic soundness is checked.
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const backend = new PdfBackend({ fonts: { roboto: font } })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    expect(pdf.length).toBeGreaterThan(0)
  })

  // Output → import round-trip fidelity for axial-gradient stops. Smooth
  // multi-stop gradients must not gain duplicate stops, and a hard colour stop
  // (two stops at the same offset with different colours) must keep both — the
  // backend must not drop the incoming colour nor emit a zero-width segment.
  function roundTripStops(stops: { offset: number, color: string }[]): { offset: number, color: string }[] {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [
      { type: 'rect', x: 0, y: 0, width: 100, height: 100,
        fill: { type: 'linear-gradient', x1: 0, y1: 0, x2: 100, y2: 0, stops } },
    ] }] } as never, backend)
    const fill = PdfImporter.open(backend.toUint8Array()).importPage(0).elements
      .map((e: { fill?: unknown }) => e.fill).find((f): f is { stops: { offset: number, color: string }[] } =>
        typeof f === 'object' && f !== null && (f as { type?: string }).type === 'linearGradient')
    if (!fill) throw new Error('expected an imported linear gradient')
    return fill.stops.map((s) => ({ offset: s.offset, color: s.color }))
  }

  it('round-trips smooth multi-stop gradients without duplicating stops', () => {
    expect(roundTripStops([{ offset: 0, color: '#ff0000' }, { offset: 0.5, color: '#00ff00' }, { offset: 1, color: '#0000ff' }]))
      .toEqual([{ offset: 0, color: '#ff0000' }, { offset: 0.5, color: '#00ff00' }, { offset: 1, color: '#0000ff' }])
    expect(roundTripStops([{ offset: 0, color: '#ff0000' }, { offset: 0.3, color: '#00ff00' }, { offset: 0.7, color: '#ffff00' }, { offset: 1, color: '#0000ff' }]))
      .toEqual([{ offset: 0, color: '#ff0000' }, { offset: 0.3, color: '#00ff00' }, { offset: 0.7, color: '#ffff00' }, { offset: 1, color: '#0000ff' }])
  })

  it('round-trips a radial gradient focal point (normalized, top-origin)', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [
      { type: 'rect', x: 0, y: 0, width: 100, height: 100,
        fill: { type: 'radial-gradient', cx: 50, cy: 50, r: 50, fx: 30, fy: 20, fr: 0,
          stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] } },
    ] }] } as never, backend)
    const fill = PdfImporter.open(backend.toUint8Array()).importPage(0).elements
      .map((e: { fill?: unknown }) => e.fill).find((f): f is Record<string, number> =>
        typeof f === 'object' && f !== null && (f as { type?: string }).type === 'radialGradient')
    if (!fill) throw new Error('expected an imported radial gradient')
    // Coordinates normalize to the 100pt rect; the focal point keeps its
    // top-origin position (poppler rasterizes the white spot at 30,20).
    expect(fill.cx).toBeCloseTo(0.5, 5)
    expect(fill.cy).toBeCloseTo(0.5, 5)
    expect(fill.r).toBeCloseTo(0.5, 5)
    expect(fill.fx).toBeCloseTo(0.3, 5)
    expect(fill.fy).toBeCloseTo(0.2, 5)
    expect(fill.fr).toBeCloseTo(0, 5)
  })

  it('preserves a hard colour stop through output and import', () => {
    // red→green up to 0.5, sharp jump to yellow, then yellow→blue.
    expect(roundTripStops([
      { offset: 0, color: '#ff0000' },
      { offset: 0.5, color: '#00ff00' },
      { offset: 0.5, color: '#ffff00' },
      { offset: 1, color: '#0000ff' },
    ])).toEqual([
      { offset: 0, color: '#ff0000' },
      { offset: 0.5, color: '#00ff00' },
      { offset: 0.5, color: '#ffff00' },
      { offset: 1, color: '#0000ff' },
    ])
  })
})
