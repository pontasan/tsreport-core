// Form XObject deduplication: content groups (top-level page children) whose
// serialized ops repeat across pages emit once as a shared /Fm XObject and
// every occurrence references it with Do. The importer already interprets
// Form XObjects, so the round trip must reproduce the elements per page.

import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter } from '../../src/index.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'

function headerRect(): RenderDocument['pages'][number]['children'][number] {
  return { type: 'rect', x: 10, y: 10, width: 100, height: 20, fill: '#336699' }
}

describe('Form XObject deduplication', () => {
  it('repeated page headers emit one shared Form XObject', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({
      pages: [
        { width: 200, height: 300, children: [headerRect(), { type: 'rect', x: 10, y: 100, width: 30, height: 30, fill: '#ff0000' }] },
        { width: 200, height: 300, children: [headerRect(), { type: 'rect', x: 10, y: 100, width: 60, height: 30, fill: '#00ff00' }] },
        { width: 200, height: 300, children: [headerRect()] },
      ],
    }, backend)
    const text = pdfToText(backend.toUint8Array())
    // One shared form, referenced from all three pages
    expect(text.match(/\/Subtype \/Form/g)?.length).toBe(1)
    expect(text.match(/\/Fm0 Do/g)?.length).toBe(3)
    const resourceRefs = Array.from(text.matchAll(/\/Resources (\d+) 0 R/g), function (match) { return match[1]! })
    expect(resourceRefs).toHaveLength(4)
    expect(new Set(resourceRefs).size).toBe(1)
    // The unique rects are NOT deduplicated
    expect(text).not.toContain('/Fm1')
  })

  it('unique content stays inline (no forms emitted)', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({
      pages: [
        { width: 200, height: 300, children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#111111' }] },
        { width: 200, height: 300, children: [{ type: 'rect', x: 5, y: 0, width: 10, height: 10, fill: '#222222' }] },
      ],
    }, backend)
    const text = pdfToText(backend.toUint8Array())
    expect(text).not.toContain('/Subtype /Form')
  })

  it('round trips through the importer with per-page elements intact', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({
      pages: [
        { width: 200, height: 300, children: [headerRect()] },
        { width: 200, height: 300, children: [headerRect()] },
      ],
    }, backend)
    const importer = PdfImporter.open(backend.toUint8Array())
    for (let p = 0; p < 2; p++) {
      const page = importer.importPage(p)
      const rects = collectPaintedElements(page.elements)
      expect(rects.length).toBeGreaterThanOrEqual(1)
    }
  })
})

function collectPaintedElements(elements: Array<{ type: string, elements?: unknown[] }>): Array<{ type: string }> {
  const out: Array<{ type: string }> = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'path' || element.type === 'rectangle') out.push(element)
    if (element.elements !== undefined) out.push(...collectPaintedElements(element.elements as Array<{ type: string, elements?: unknown[] }>))
  }
  return out
}
