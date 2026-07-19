// Color rendering intent (ISO 32000 §8.6.5.8): the ExtGState /RI graphics-state
// parameter is emitted for content that carries a rendering intent and is read
// back from both the `ri` operator and ExtGState /RI on import.

import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter, render } from '../../src/index.js'
import type { RenderDocument } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'

function renderIntentPdf(): Uint8Array {
  const doc: RenderDocument = {
    pages: [{
      width: 100,
      height: 100,
      children: [
        { type: 'rect', x: 10, y: 10, width: 40, height: 40, fill: '#ff0000', renderingIntent: 'Perceptual' },
      ],
    }],
  }
  const backend = new PdfBackend({ fonts: {} })
  render(doc, backend)
  return backend.toUint8Array()
}

describe('PDF rendering intent output (/RI)', () => {
  it('emits an ExtGState /RI and references it before the drawing', () => {
    const text = pdfToText(renderIntentPdf())
    expect(text).toContain('/RI /Perceptual')
    expect(text).toMatch(/\/GS\d+ gs/)
  })

  it('round-trips the rendering intent through the importer', () => {
    const page = PdfImporter.open(renderIntentPdf()).importPage(0)
    const withIntent = findWithIntent(page.elements)
    expect(withIntent).not.toBeNull()
    expect(withIntent!.renderingIntent).toBe('Perceptual')
  })
})

describe('PDF rendering intent import from the `ri` operator', () => {
  it('reads the ri operator into the element rendering intent', () => {
    const page = PdfImporter.open(buildRiOperatorPdf('Saturation')).importPage(0)
    const withIntent = findWithIntent(page.elements)
    expect(withIntent).not.toBeNull()
    expect(withIntent!.renderingIntent).toBe('Saturation')
  })

  it('rejects an unsupported rendering intent name', () => {
    expect(() => PdfImporter.open(buildRiOperatorPdf('Bogus')).importPage(0))
      .toThrow(/unsupported rendering intent/)
  })
})

// ─── Helpers ───

function findWithIntent(elements: unknown[]): (Record<string, unknown> & { renderingIntent?: string }) | null {
  for (const el of elements) {
    const e = el as Record<string, unknown>
    if (typeof e.renderingIntent === 'string') return e as never
    if (Array.isArray(e.elements)) {
      const inner = findWithIntent(e.elements as unknown[])
      if (inner) return inner
    }
  }
  return null
}

/** A minimal single-page PDF whose content stream sets `/<intent> ri` then fills a rect. */
function buildRiOperatorPdf(intent: string): Uint8Array {
  const content = `/${intent} ri\n1 0 0 rg\n10 10 40 40 re f\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ]
  let body = '%PDF-1.7\n'
  const offsets: number[] = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefStart = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 0; i < objects.length; i++) {
    body += `${offsets[i]!.toString().padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new TextEncoder().encode(body)
}
