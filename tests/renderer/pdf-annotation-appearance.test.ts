// Annotation normal appearance streams (/AP /N): the geometric and text-markup
// annotation subtypes carry a self-contained vector appearance so viewers (and
// PDF/A) render them identically to the intended shape.

import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter } from '../../src/index.js'
import type { PdfAnnotation } from '../../src/renderer/pdf-backend.js'
import { parsePdf, PdfStream, type PdfDocument } from '../../src/pdf/pdf-parser.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'

interface Parsed {
  dict: Map<string, unknown>
  /** Decoded /AP /N appearance stream content, or null when there is no appearance. */
  appearance: string | null
  appearanceDict: Map<string, unknown> | null
}

function collectAppearanceFills(elements: unknown[], out: string[]): void {
  for (const el of elements) {
    const e = el as Record<string, unknown>
    if (typeof e.fill === 'string') out.push(e.fill)
    if (Array.isArray(e.elements)) collectAppearanceFills(e.elements as unknown[], out)
  }
}

function renderAnnotation(annotation: PdfAnnotation): Parsed {
  const backend = new PdfBackend({ fonts: {}, annotations: [annotation] })
  backend.beginDocument()
  backend.beginPage(200, 200)
  backend.endPage()
  backend.endDocument()
  const doc: PdfDocument = parsePdf(backend.toUint8Array())
  const page = collectPdfPages(doc)[0]!
  const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
  const dict = doc.resolve(annots[0] as never) as Map<string, unknown>
  const ap = doc.resolve(dict.get('AP') ?? null)
  let appearance: string | null = null
  let appearanceDict: Map<string, unknown> | null = null
  if (ap instanceof Map) {
    const n = doc.resolve(ap.get('N') ?? null)
    if (n instanceof PdfStream) {
      appearance = new TextDecoder('latin1').decode(doc.decodeStream(n))
      appearanceDict = n.dict
    }
  }
  return { dict, appearance, appearanceDict }
}

describe('Annotation appearance streams (/AP /N)', () => {
  it('Square: filled + stroked rectangle appearance with /BS width', () => {
    const { dict, appearance, appearanceDict } = renderAnnotation({
      subtype: 'Square', pageIndex: 0, x: 10, y: 10, width: 60, height: 40,
      color: '#ff0000', interiorColor: '#ffff00', borderWidth: 2,
    })
    expect(appearance).not.toBeNull()
    expect((appearanceDict!.get('Subtype') as { name: string }).name).toBe('Form')
    const bs = dict.get('BS') as Map<string, unknown>
    expect(bs.get('W')).toBe(2)
    expect(appearance).toMatch(/1 0 0 RG/)      // red stroke
    expect(appearance).toMatch(/1 1 0 rg/)      // yellow fill
    expect(appearance).toMatch(/ re\nB/)        // rect, fill+stroke
  })

  it('Circle: bezier ellipse appearance', () => {
    const { appearance } = renderAnnotation({
      subtype: 'Circle', pageIndex: 0, x: 10, y: 10, width: 50, height: 50, color: '#0000ff',
    })
    expect(appearance).toMatch(/ c\n/)   // cubic bezier ops
    expect(appearance).toContain('\nS')  // stroke only (no interior)
  })

  it('emits and renders every non-dashed /BS border style', () => {
    const beveled = renderAnnotation({
      subtype: 'Square', pageIndex: 0, x: 10, y: 10, width: 50, height: 30,
      color: '#000000', borderWidth: 2, borderStyle: 'beveled',
    })
    const beveledBs = beveled.dict.get('BS') as Map<string, unknown>
    expect(beveledBs.get('S')).toMatchObject({ name: 'B' })
    expect(beveled.appearance).toContain('1 1 1 RG')
    expect(beveled.appearance).toContain('0.4 0.4 0.4 RG')

    const inset = renderAnnotation({
      subtype: 'Circle', pageIndex: 0, x: 10, y: 10, width: 50, height: 30,
      color: '#000000', borderWidth: 2, borderStyle: 'inset',
    })
    expect(((inset.dict.get('BS') as Map<string, unknown>).get('S'))).toMatchObject({ name: 'I' })
    expect(inset.appearance).toContain(' c')

    const underline = renderAnnotation({
      subtype: 'Square', pageIndex: 0, x: 10, y: 10, width: 50, height: 30,
      color: '#000000', borderWidth: 2, borderStyle: 'underline',
    })
    expect(((underline.dict.get('BS') as Map<string, unknown>).get('S'))).toMatchObject({ name: 'U' })
    expect((underline.appearance!.match(/ l S/g) ?? [])).toHaveLength(1)

    const solid = renderAnnotation({
      subtype: 'Square', pageIndex: 0, x: 10, y: 10, width: 50, height: 30,
      color: '#000000', borderWidth: 2, borderStyle: 'solid',
    })
    expect(((solid.dict.get('BS') as Map<string, unknown>).get('S'))).toMatchObject({ name: 'S' })
  })

  it('emits and renders a cloudy /BE border effect', () => {
    const { dict, appearance } = renderAnnotation({
      subtype: 'Square', pageIndex: 0, x: 10, y: 10, width: 60, height: 40,
      color: '#000000', borderWidth: 1, borderEffect: { style: 'cloudy', intensity: 1.5 },
    })
    const be = dict.get('BE') as Map<string, unknown>
    expect(be.get('S')).toMatchObject({ name: 'C' })
    expect(be.get('I')).toBe(1.5)
    expect((appearance!.match(/h\nS/g) ?? []).length).toBeGreaterThan(8)
  })

  it('Line: stroked line appearance', () => {
    const { appearance } = renderAnnotation({
      subtype: 'Line', pageIndex: 0, x: 10, y: 10, width: 100, height: 10,
      start: [10, 15], end: [110, 15], color: '#00aa00',
    })
    expect(appearance).toMatch(/m \S+ \S+ l S/)
  })

  it('Polygon: closed filled path appearance', () => {
    const { appearance } = renderAnnotation({
      subtype: 'Polygon', pageIndex: 0, x: 10, y: 10, width: 60, height: 60,
      vertices: [[10, 10], [70, 10], [40, 70]], color: '#000000', interiorColor: '#cccccc',
    })
    expect(appearance).toMatch(/ l\nh\nB/)   // close path, fill+stroke
  })

  it('Ink: multi-segment stroked path appearance', () => {
    const { appearance } = renderAnnotation({
      subtype: 'Ink', pageIndex: 0, x: 10, y: 10, width: 80, height: 40,
      paths: [[[10, 20], [30, 40], [50, 20]]], color: '#ff00ff',
    })
    expect(appearance).toMatch(/m[\s\S]*l[\s\S]*l\nS/)
  })

  it('Highlight: Multiply-blended filled quad appearance', () => {
    const { appearance, appearanceDict } = renderAnnotation({
      subtype: 'Highlight', pageIndex: 0, x: 10, y: 10, width: 80, height: 14,
      quadPoints: [[10, 10, 90, 10, 10, 24, 90, 24]], color: '#ffff00',
    })
    const resources = appearanceDict!.get('Resources') as Map<string, unknown>
    const extg = resources.get('ExtGState') as Map<string, unknown>
    const gs = extg.get('GSmul') as Map<string, unknown>
    expect((gs.get('BM') as { name: string }).name).toBe('Multiply')
    expect(appearance).toContain('/GSmul gs')
    expect(appearance).toMatch(/h\nf/)   // filled quad
  })

  it('Underline / StrikeOut: baseline / mid line appearances', () => {
    const underline = renderAnnotation({
      subtype: 'Underline', pageIndex: 0, x: 10, y: 10, width: 80, height: 14,
      quadPoints: [[10, 10, 90, 10, 10, 24, 90, 24]], color: '#ff0000',
    })
    expect(underline.appearance).toMatch(/m \S+ \S+ l S/)

    const strikeout = renderAnnotation({
      subtype: 'StrikeOut', pageIndex: 0, x: 10, y: 10, width: 80, height: 14,
      quadPoints: [[10, 10, 90, 10, 10, 24, 90, 24]], color: '#ff0000',
    })
    expect(strikeout.appearance).toMatch(/m \S+ \S+ l S/)
  })

  it('Line with a closed arrow ending fills an arrowhead', () => {
    const { appearance } = renderAnnotation({
      subtype: 'Line', pageIndex: 0, x: 10, y: 10, width: 100, height: 20,
      start: [10, 20], end: [110, 20], color: '#000000',
      lineEndings: ['None', 'ClosedArrow'],
    })
    // Main line plus a filled (B) arrowhead triangle at the end.
    expect(appearance).toMatch(/m [\s\S]*l S/)   // the line
    expect(appearance).toMatch(/l [\s\S]*l h B/)  // filled closed arrowhead
  })

  it('Line with an open arrow ending strokes an arrowhead', () => {
    const { appearance } = renderAnnotation({
      subtype: 'Line', pageIndex: 0, x: 10, y: 10, width: 100, height: 20,
      start: [10, 20], end: [110, 20], color: '#000000',
      lineEndings: ['OpenArrow', 'None'],
    })
    // Two arrowhead legs meeting at the tip, stroked.
    expect(appearance).toMatch(/m \S+ \S+ l \S+ \S+ l S/)
  })

  it('Caret: filled caret appearance', () => {
    const { appearance } = renderAnnotation({
      subtype: 'Caret', pageIndex: 0, x: 10, y: 10, width: 12, height: 12, color: '#000000',
    })
    expect(appearance).not.toBeNull()
    expect(appearance).toMatch(/m[\s\S]*l[\s\S]*l\nh f/)   // triangle, filled
  })

  it('FreeText: renders text with a Helvetica resource per /DA', () => {
    const { appearance, appearanceDict } = renderAnnotation({
      subtype: 'FreeText', pageIndex: 0, x: 10, y: 10, width: 120, height: 40,
      contents: 'Hello box', defaultAppearance: '/Helv 14 Tf 1 0 0 rg',
    })
    expect(appearance).not.toBeNull()
    expect(appearance).toContain('BT')
    expect(appearance).toContain('/Helv 14 Tf')
    expect(appearance).toContain('1 0 0 rg')
    expect(appearance).toContain('(Hello box) Tj')
    expect(appearance).toContain('ET')
    const resources = appearanceDict!.get('Resources') as Map<string, unknown>
    const font = resources.get('Font') as Map<string, unknown>
    expect(font.has('Helv')).toBe(true)
  })

  it('FreeText: multi-line text emits a line advance per line', () => {
    const { appearance } = renderAnnotation({
      subtype: 'FreeText', pageIndex: 0, x: 10, y: 10, width: 120, height: 60,
      contents: 'Line one\nLine two', defaultAppearance: '/Helv 12 Tf 0 g',
    })
    expect(appearance).toContain('(Line one) Tj')
    expect(appearance).toContain('(Line two) Tj')
    expect(appearance).toMatch(/0 -\S+ Td/)   // line advance
  })

  it('FreeText: non-WinAnsi text requires an explicit embedded font', () => {
    expect(() => renderAnnotation({
      subtype: 'FreeText', pageIndex: 0, x: 10, y: 10, width: 120, height: 40,
      contents: '日本語のテキスト', defaultAppearance: '/Helv 12 Tf 0 g',
    })).toThrow(/provide an embedded fontId/)
  })

  it('FreeText: long text wraps within the box width', () => {
    const { appearance } = renderAnnotation({
      subtype: 'FreeText', pageIndex: 0, x: 10, y: 10, width: 60, height: 80,
      contents: 'the quick brown fox jumps over the lazy dog', defaultAppearance: '/Helv 12 Tf 0 g',
    })
    // More than one Tj => wrapped into multiple lines.
    const tjCount = (appearance!.match(/\) Tj/g) ?? []).length
    expect(tjCount).toBeGreaterThan(1)
  })

  it('round-trips a Square appearance back into an imported shape', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [{
        subtype: 'Square', pageIndex: 0, x: 20, y: 20, width: 60, height: 40,
        color: '#ff0000', interiorColor: '#ffff00', borderWidth: 2,
      }],
    })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.endPage()
    backend.endDocument()
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const fills: string[] = []
    collectAppearanceFills(page.elements, fills)
    // The yellow interior of the square appearance is reconstructed on import.
    expect(fills.map(f => f.toLowerCase())).toContain('#ffff00')
  })

  it('Stamp: bordered box with the stamp name label', () => {
    const { appearance, appearanceDict } = renderAnnotation({
      subtype: 'Stamp', pageIndex: 0, x: 10, y: 10, width: 120, height: 40, icon: 'NotApproved',
    })
    expect(appearance).not.toBeNull()
    expect(appearance).toMatch(/ re S/)                 // border box
    expect(appearance).toContain('(NOT APPROVED) Tj')   // spaced, uppercased label
    const resources = appearanceDict!.get('Resources') as Map<string, unknown>
    expect((resources.get('Font') as Map<string, unknown>).has('F0')).toBe(true)
  })

  it('Text: sticky-note appearance with a folded corner', () => {
    const { dict, appearance } = renderAnnotation({
      subtype: 'Text', pageIndex: 0, x: 10, y: 10, width: 18, height: 18, icon: 'Comment', color: '#ffff99',
    })
    expect((dict.get('Subtype') as { name: string }).name).toBe('Text')
    expect(appearance).not.toBeNull()
    expect(appearance).toMatch(/h B/)   // note body outline, fill+stroke
    expect(appearance).toMatch(/h f/)   // folded corner triangle
  })

  it('does not attach an appearance to non-displayable subtypes (Sound)', () => {
    const { dict, appearance } = renderAnnotation({
      subtype: 'Sound', pageIndex: 0, x: 10, y: 10, width: 18, height: 18,
      data: new Uint8Array([1, 2, 3, 4]), sampleRate: 8000, channels: 1, bitsPerSample: 8, encoding: 'Raw',
    })
    expect((dict.get('Subtype') as { name: string }).name).toBe('Sound')
    expect(appearance).toBeNull()
  })
})
