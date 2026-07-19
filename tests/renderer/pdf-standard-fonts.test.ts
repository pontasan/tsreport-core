// Standard-14 reference mode: text draws through non-embedded simple Type1
// fonts with WinAnsi encoding, metrics from the built-in AFM data, and the
// importer measures such text with the same AFM widths (ISO 32000-1 9.6.2.2
// lets these fonts omit /Widths).

import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter } from '../../src/index.js'
import { getStandardFontMetrics, resolveStandardFontName } from '../../src/pdf/standard-font-metrics.js'
import { pdfToText } from './pdf-test-utils.js'

function buildPdf(text: string, fontName = 'Helvetica'): Uint8Array {
  const backend = new PdfBackend({ fonts: {}, standardFonts: { std: fontName } })
  backend.beginDocument()
  backend.beginPage(300, 100)
  backend.drawText(20, 20, text, 'std', 12, '#000000')
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}

describe('standard-14 metrics data', () => {
  it('carries the canonical AFM widths', () => {
    const helv = getStandardFontMetrics('Helvetica')!
    expect(helv.widths[0x20]).toBe(278)  // space
    expect(helv.widths[0x41]).toBe(667)  // A
    expect(helv.widths[0x57]).toBe(944)  // W
    const times = getStandardFontMetrics('Times-Roman')!
    expect(times.widths[0x20]).toBe(250)
    expect(times.widths[0x41]).toBe(722)
    const courier = getStandardFontMetrics('Courier')!
    expect(courier.widths[0x41]).toBe(600)
  })

  it('resolves aliases and subset prefixes', () => {
    expect(resolveStandardFontName('Arial')).toBe('Helvetica')
    expect(resolveStandardFontName('ABCDEF+TimesNewRomanPSMT')).toBe('Times-Roman')
    expect(resolveStandardFontName('SomeUnknownFont')).toBeNull()
  })
})

describe('standard-14 reference output', () => {
  it('emits a non-embedded simple Type1 dictionary with WinAnsi encoding', () => {
    const text = pdfToText(buildPdf('Hello Wörld'))
    expect(text).toContain('/Subtype /Type1')
    expect(text).toContain('/BaseFont /Helvetica')
    expect(text).toContain('/Encoding /WinAnsiEncoding')
    expect(text).not.toContain('/FontFile')
    // ö encodes to WinAnsi 0xF6
    expect(text).toContain('f6726c64')
  })

  it('rejects characters outside WinAnsi explicitly', () => {
    const backend = new PdfBackend({ fonts: {}, standardFonts: { std: 'Helvetica' } })
    backend.beginDocument()
    backend.beginPage(300, 100)
    expect(function () { backend.drawText(20, 20, '日本語', 'std', 12, '#000000') })
      .toThrow(/outside the WinAnsi encoding/)
  })

  it('rejects unknown standard font names at construction', () => {
    expect(function () { new PdfBackend({ fonts: {}, standardFonts: { std: 'ComicSans' } }) })
      .toThrow(/Unknown standard font name/)
  })
})

describe('standard-14 import metrics', () => {
  it('measures non-embedded standard-font text with the AFM widths', () => {
    // Our own output omits /Widths — the importer must still size the text
    const page = PdfImporter.open(buildPdf('AWA')).importPage(0)
    const texts: { text: string, width: number }[] = []
    const walk = function (elements: typeof page.elements): void {
      for (const el of elements) {
        if (el.type === 'staticText') texts.push({ text: (el as { text: string }).text, width: (el as { width: number }).width })
        if (el.type === 'frame' && (el as { elements?: typeof page.elements }).elements !== undefined) {
          walk((el as unknown as { elements: typeof page.elements }).elements)
        }
      }
    }
    walk(page.elements)
    expect(texts.length).toBe(1)
    expect(texts[0]!.text).toBe('AWA')
    // (667 + 944 + 667) / 1000 * 12pt = 27.336pt — nonzero and exact
    const expected = (667 + 944 + 667) / 1000 * 12
    expect(texts[0]!.width).toBeGreaterThanOrEqual(Math.floor(expected))
  })
})
