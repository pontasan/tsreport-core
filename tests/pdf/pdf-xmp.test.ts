import { describe, expect, it } from 'vitest'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { PdfImporter, parsePdfDateText } from '../../src/pdf/pdf-page-importer.js'
import { buildPdfXmpPacket, parsePdfXmpPacket } from '../../src/pdf/pdf-xmp.js'

function onePage(metadata: ConstructorParameters<typeof PdfBackend>[0]['metadata']): Uint8Array {
  const backend = new PdfBackend({ fonts: {}, metadata })
  backend.beginDocument(); backend.beginPage(100, 100); backend.endPage(); backend.endDocument()
  return backend.toUint8Array()
}

function replaceAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error('Replacement must preserve byte length')
  const source = new TextEncoder().encode(from)
  const replacement = new TextEncoder().encode(to)
  const result = bytes.slice()
  outer: for (let i = 0; i <= result.length - source.length; i++) {
    for (let k = 0; k < source.length; k++) if (result[i + k] !== source[k]) continue outer
    result.set(replacement, i)
    return result
  }
  throw new Error(`Byte sequence not found: ${from}`)
}

describe('PDF XMP metadata', () => {
  it('writes UTF-8 synchronized fields, typed properties, and a PDF/A extension schema', () => {
    const bytes = buildPdfXmpPacket({
      title: '月次請求書',
      author: '経理部',
      creationDate: new Date('2026-07-14T01:02:03.000Z'),
      xmp: {
        properties: [
          { namespaceUri: 'https://example.test/report/1.0/', prefix: 'report', name: 'Department', value: '営業部' },
          { namespaceUri: 'https://example.test/report/1.0/', prefix: 'report', name: 'Tags', value: { kind: 'bag', items: ['請求', '月次'] } },
        ],
        extensionSchemas: [{
          schema: 'Report metadata', namespaceUri: 'https://example.test/report/1.0/', prefix: 'report',
          properties: [
            { name: 'Department', valueType: 'Text', category: 'external', description: 'Owning department' },
            { name: 'Tags', valueType: 'bag Text', category: 'external', description: 'Report tags' },
          ],
        }],
      },
    }, 3)
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    expect(xml).toContain('月次請求書')
    expect(xml).toContain('<report:Department>営業部</report:Department>')
    expect(xml).toContain('<pdfaExtension:schemas><rdf:Bag>')
    expect(xml).toContain('<pdfaProperty:valueType>bag Text</pdfaProperty:valueType>')
    expect(parsePdfXmpPacket(bytes)).toMatchObject({ title: '月次請求書', author: '経理部', authorEntryCount: 1 })
  })

  it('requires a declared extension schema for custom PDF/A properties', () => {
    expect(() => buildPdfXmpPacket({
      xmp: { properties: [{ namespaceUri: 'https://example.test/custom/', prefix: 'custom', name: 'Value', value: 'x' }] },
    }, 2)).toThrow(/requires an extension schema/)
  })

  it('imports and byte-exactly re-emits a synchronized XMP packet', () => {
    const original = onePage({
      title: '請求書', author: '経理部', modDate: new Date('2026-07-14T02:03:04Z'),
      xmp: {
        properties: [{ namespaceUri: 'https://example.test/report/', prefix: 'report', name: 'Code', value: 'R-42' }],
      },
    })
    const importer = PdfImporter.open(original)
    const metadata = importer.importMetadata()!
    expect(metadata.title).toBe('請求書')
    expect(metadata.xmp).toBeDefined()
    const rawPacket = metadata.xmp!.rawPacket

    const rewritten = onePage({
      title: metadata.title,
      author: metadata.author,
      modDate: parsePdfDateText(metadata.modDate!),
      xmp: { rawPacket },
    })
    expect(PdfImporter.open(rewritten).importXmpMetadata()!.rawPacket).toEqual(rawPacket)
  })

  it('rejects Info/XMP conflicts and non-XML Catalog metadata streams', () => {
    const other = buildPdfXmpPacket({ title: 'Other title' })
    expect(() => onePage({ title: 'Info title', xmp: { rawPacket: other } })).toThrow(/not synchronized/)
    expect(() => onePage({ title: 'Info title', xmp: { rawPacket: buildPdfXmpPacket({}) } })).toThrow(/not synchronized/)

    const valid = onePage({ title: 'Metadata' })
    const invalidSubtype = replaceAscii(valid, '/Subtype /XML', '/Subtype /Bad')
    expect(() => PdfImporter.open(invalidSubtype).importXmpMetadata()).toThrow(/Subtype must be \/XML/)
  })
})
