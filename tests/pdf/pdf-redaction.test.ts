import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { applyPdfRedactions } from '../../src/pdf/pdf-redaction.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { parsePdf } from '../../src/pdf/pdf-parser.js'
import { renderToPdf } from '../../src/renderer/renderer.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'
import type { PdfAnnotation } from '../../src/renderer/pdf-backend.js'
import type { ElementDef } from '../../src/types/template.js'
import type { RenderDocument } from '../../src/types/render.js'
import { pdfToText } from '../renderer/pdf-test-utils.js'

let font: Font

beforeAll(function () {
  const bytes = readFileSync(join(__dirname, '..', 'fixtures', 'fonts', 'Roboto-Regular.ttf'))
  font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
})

describe('PDF redaction application', function () {
  it('removes intersecting text, image resources, ActualText, structure data, and the Redact annotation', function () {
    const source = sourcePdf([{
      subtype: 'Redact',
      pageIndex: 0,
      x: 8,
      y: 8,
      width: 155,
      height: 64,
      name: 'secret-area',
      interiorColor: '#000000',
      overlayText: 'REDACTED',
      defaultAppearance: '/F0 10 Tf 1 1 1 rg',
      repeatOverlay: true,
      overlayQuadding: 1,
    }])
    expect(importedText(source)).toContain('VISIBLE CONTENT')

    expect(() => applyPdfRedactions(source)).toThrow(/cannot use subset font/)
    const applied = applyPdfRedactions(source, { fonts: { 'Roboto-Regular': font } })
    const expanded = pdfToText(applied)
    expect(expanded).not.toContain('SECRET CONTENT')
    expect(expanded).not.toContain(utf16Hex('SECRET CONTENT'))
    expect(expanded).not.toContain(utf16Hex('ACTUAL SECRET'))
    expect(expanded).not.toContain(utf16Hex('STRUCTURE SECRET'))
    expect(importedText(applied)).toContain('REDACTED')
    expect(collectPaths(PdfImporter.open(applied).importPage(0).elements).length).toBeGreaterThan(1)

    const doc = parsePdf(applied)
    const catalog = doc.getCatalog()
    expect(catalog.has('StructTreeRoot')).toBe(false)
    const page = collectPdfPages(doc)[0]!
    expect(page.dict.has('Annots')).toBe(false)
    expect(countImageXObjects(doc, page.resources)).toBe(0)
    expect(PdfImporter.open(applied).importAnnotations(0)).toEqual([])
  })

  it('uses /RO instead of IC and OverlayText when applying a Redact annotation', function () {
    const source = sourcePdf([{
      subtype: 'Redact',
      pageIndex: 0,
      x: 8,
      y: 8,
      width: 155,
      height: 34,
      interiorColor: '#000000',
      overlayText: 'IGNORED',
      defaultAppearance: '/F0 10 Tf 1 1 1 rg',
      overlayAppearance: {
        kind: 'stream',
        entries: {
          Type: { kind: 'name', value: 'XObject' },
          Subtype: { kind: 'name', value: 'Form' },
          BBox: { kind: 'array', items: [0, 0, 155, 34] },
          Resources: { kind: 'dictionary', entries: {} },
        },
        data: new TextEncoder().encode('0 1 0 rg 0 0 155 34 re f'),
      },
    }])

    const imported = PdfImporter.open(source).importAnnotations(0)[0]!
    expect(imported.overlayAppearance?.entries.Subtype).toEqual({ kind: 'name', value: 'Form' })
    expect(imported.defaultAppearance).toBe('/F0 10 Tf 1 1 1 rg')

    const applied = applyPdfRedactions(source)
    const expanded = pdfToText(applied)
    expect(expanded).not.toContain(utf16Hex('ACTUAL SECRET'))
    expect(expanded).not.toContain(utf16Hex('IGNORED'))
    const page = PdfImporter.open(applied).importPage(0)
    expect(collectPaths(page.elements).some(function (element) { return element.fill === '#00ff00' })).toBe(true)
  })

  it('applies a named subset and rejects unknown annotation names', function () {
    const source = sourcePdf([
      { subtype: 'Redact', pageIndex: 0, x: 8, y: 8, width: 155, height: 34, name: 'first', interiorColor: '#000000' },
      { subtype: 'Redact', pageIndex: 0, x: 8, y: 55, width: 155, height: 20, name: 'second', interiorColor: '#000000' },
    ])
    expect(importedText(source)).toContain('VISIBLE CONTENT')
    const applied = applyPdfRedactions(source, { annotationNames: ['first'] })
    const expanded = pdfToText(applied)
    expect(expanded).not.toContain(utf16Hex('ACTUAL SECRET'))
    expect(collectPaths(PdfImporter.open(applied).importPage(0).elements).length).toBeGreaterThan(1)
    expect(PdfImporter.open(applied).importAnnotations(0)).toMatchObject([{ subtype: 'Redact', name: 'second' }])
    expect(() => applyPdfRedactions(source, { annotationNames: ['missing'] })).toThrow(/annotation name not found/)
  })
})

function sourcePdf(annotations: PdfAnnotation[]): Uint8Array {
  const png = encodePngRgba(1, 1, new Uint8Array([255, 0, 0, 255]))
  const document: RenderDocument = {
    tagged: true,
    images: { secretImage: png },
    pages: [{
      width: 180,
      height: 120,
      children: [
        { type: 'text', x: 10, y: 12, width: 145, text: 'SECRET CONTENT', actualText: 'ACTUAL SECRET', fontId: 'default', fontSize: 12, color: '#000000', tag: { role: 'P', actualText: 'STRUCTURE SECRET' } },
        { type: 'image', x: 10, y: 38, width: 40, height: 30, imageId: 'secretImage', tag: { role: 'Figure', alt: 'SECRET IMAGE ALT' } },
        { type: 'text', x: 10, y: 88, width: 145, text: 'VISIBLE CONTENT', fontId: 'default', fontSize: 12, color: '#000000', tag: { role: 'P' } },
      ],
    }],
  }
  return renderToPdf(document, { fonts: { default: font }, annotations })
}

function countImageXObjects(doc: ReturnType<typeof parsePdf>, resourcesValue: unknown): number {
  const resources = doc.resolve(resourcesValue as never)
  if (!(resources instanceof Map)) return 0
  const xobjects = doc.resolve(resources.get('XObject') ?? null)
  if (!(xobjects instanceof Map)) return 0
  let count = 0
  for (const value of xobjects.values()) {
    const stream = doc.resolve(value)
    if (typeof stream === 'object' && stream !== null && 'dict' in stream) {
      const subtype = doc.resolve((stream as { dict: Map<string, unknown> }).dict.get('Subtype') as never)
      if (typeof subtype === 'object' && subtype !== null && 'name' in subtype && (subtype as { name: string }).name === 'Image') count++
    }
  }
  return count
}

function collectPaths(elements: ElementDef[]): Array<Extract<ElementDef, { type: 'path' }>> {
  const result: Array<Extract<ElementDef, { type: 'path' }>> = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'path') result.push(element)
    if (element.type === 'frame' && element.elements !== undefined) result.push(...collectPaths(element.elements))
  }
  return result
}

function importedText(bytes: Uint8Array): string {
  const elements = PdfImporter.open(bytes).importPage(0).elements
  const texts: string[] = []
  collectTextInto(elements, texts)
  return texts.join(' ')
}

function collectTextInto(elements: ElementDef[], texts: string[]): void {
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'staticText') texts.push(element.text, element.actualText ?? '')
    if (element.type === 'frame' && element.elements !== undefined) collectTextInto(element.elements, texts)
  }
}

function utf16Hex(value: string): string {
  let result = 'FEFF'
  for (let i = 0; i < value.length; i++) result += value.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  return result
}
