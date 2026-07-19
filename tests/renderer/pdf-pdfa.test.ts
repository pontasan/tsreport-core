/**
 * PDF/A conformance tests.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend, validatePdfConformance, type PdfAConformance } from '../../src/renderer/pdf-backend.js'
import { generateSRGBIccProfile } from '../../src/renderer/icc-profile.js'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { linearizePdf } from '../../src/pdf/pdf-linearize.js'
import { PdfName, PdfRef, PdfStream, parsePdf } from '../../src/pdf/pdf-parser.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { serializePdfValue } from '../../src/pdf/pdf-serializer.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

let font: Font
let japaneseFont: Font

beforeAll(() => {
  const buf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  font = Font.load(buf.buffer as ArrayBuffer)
  const japanese = readFileSync(join(FIXTURES, 'NotoSansJP-Regular.otf'))
  japaneseFont = Font.load(japanese.buffer as ArrayBuffer)
})

function generatePdf(conformance: PdfAConformance, metadata?: { title?: string; author?: string }): { bytes: Uint8Array; text: string; raw: string } {
  const backend = new PdfBackend({
    fonts: { default: font },
    pdfaConformance: conformance,
    metadata,
  })
  const doc: RenderDocument = {
    pages: [{
      width: 595, height: 842,
      children: [{
        type: 'text', x: 72, y: 72, text: 'PDF/A Test',
        fontId: 'default', fontSize: 12, color: '#000000',
      }],
    }],
  }
  render(doc, backend)
  const bytes = backend.toUint8Array()
  const raw = new TextDecoder('latin1').decode(bytes)
  return { bytes, text: pdfToText(bytes), raw }
}

describe('PDF/A-1b', () => {
  // Verifies that PDF/A-1b output declares PDF 1.4, the highest version allowed by ISO 19005-1.
  it('PDF バージョンが 1.4 である', () => {
    const { raw } = generatePdf('PDF/A-1b')
    expect(raw.startsWith('%PDF-1.4')).toBe(true)
  })

  // Verifies that PDF/A-1b uses a classic ASCII xref table + trailer, since xref streams require PDF 1.5.
  it('従来型 xref テーブルを使用する (xref stream ではない)', () => {
    const { raw } = generatePdf('PDF/A-1b')
    expect(raw).toContain('\nxref\n')
    expect(raw).toContain('\ntrailer\n')
    // No xref stream form (/Type /XRef) may be present
    expect(raw).not.toContain('/Type /XRef')
  })

  // Verifies that PDF/A-1b never emits object streams, which are a PDF 1.5 feature.
  it('ObjStm を使用しない', () => {
    const { text } = generatePdf('PDF/A-1b')
    expect(text).not.toContain('/Type /ObjStm')
  })

  it('CID font subsetに完全なCIDSet streamを付与する', () => {
    const { bytes, text } = generatePdf('PDF/A-1b')
    expect(text).toMatch(/\/CIDSet \d+ 0 R/)
    const reference = /\/CIDSet (\d+) 0 R/.exec(text)
    const incomplete = appendIncrementalUpdate(bytes, [{
      num: Number(reference![1]),
      body: concatBytes(
        latin1Bytes('<< /Length 1 >>\nstream\n'),
        new Uint8Array([0]),
        latin1Bytes('\nendstream'),
      ),
    }])
    expect(() => validatePdfConformance(incomplete, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/CIDSet omits embedded CID/)
  })

  // PDF/A-1 cannot represent transparency; silently dropping opacity would alter the report.
  it('表現不能な透明度を黙って除去せず拒否する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-1b',
    })
    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 0, y: 0, width: 595, height: 842,
          opacity: 0.5,
          children: [{
            type: 'text', x: 72, y: 72, text: 'Semi-transparent',
            fontId: 'default', fontSize: 12, color: '#000000',
          }],
        }],
      }],
    }
    expect(() => render(doc, backend)).toThrow(/forbids transparency groups/)
  })

  it('Highlight外観を透明blendなしで保持する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-1b',
      annotations: [{
        subtype: 'Highlight', pageIndex: 0, x: 10, y: 10, width: 80, height: 20,
        quadPoints: [[10, 10, 90, 10, 10, 30, 90, 30]], color: '#ffff00',
      }],
    })
    render({ pages: [{ width: 120, height: 60, children: [] }] }, backend)
    const bytes = backend.toUint8Array()
    validatePdfConformance(bytes, { pdfaConformance: 'PDF/A-1b' })
    expect(pdfToText(bytes)).not.toContain('/BM /Multiply')
  })
})

describe('PDF/A-2b', () => {
  // Verifies that PDF/A-2b output declares PDF 1.7 as its base version (ISO 19005-2).
  it('PDF バージョンが 1.7 である', () => {
    const { raw } = generatePdf('PDF/A-2b')
    expect(raw.startsWith('%PDF-1.7')).toBe(true)
  })

  // Verifies that PDF/A-2b keeps using the modern xref stream format, which PDF/A-2 permits.
  it('xref stream を使用する', () => {
    const { text } = generatePdf('PDF/A-2b')
    expect(text).toContain('/Type /XRef')
  })

  it('PDF/A-1またはPDF/A-2文書だけを埋め込む', () => {
    const embedded = generatePdf('PDF/A-1b').bytes
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-2b',
      embeddedFiles: [{ name: 'archived.pdf', data: embedded, mimeType: 'application/pdf' }],
    })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    expect(pdfToText(backend.toUint8Array())).toContain('/EmbeddedFiles')
  })
})

describe('PDF/A-3b', () => {
  // Verifies that PDF/A-3b output declares PDF 1.7 as its base version (ISO 19005-3).
  it('PDF バージョンが 1.7 である', () => {
    const { raw } = generatePdf('PDF/A-3b')
    expect(raw.startsWith('%PDF-1.7')).toBe(true)
  })

  it('関連ファイルにAFRelationshipと既定MIME型を付与する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-3b',
      embeddedFiles: [{ name: 'source.bin', data: new Uint8Array([1, 2, 3]), relationship: 'Data' }],
    })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/Subtype /application#2Foctet-stream')
    expect(text).toContain('/AFRelationship /Data')
    expect(text).toMatch(/\/AF \[\d+ 0 R\]/)
  })

  it('AFRelationshipのない関連ファイルを拒否する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-3b',
      embeddedFiles: [{ name: 'source.bin', data: new Uint8Array([1]) }],
    })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    expect(() => backend.toUint8Array()).toThrow(/requires AFRelationship/)
  })

  it('PDF/A-3でPDF 2.0固有AFRelationshipを拒否する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-3b',
      embeddedFiles: [{ name: 'form.xml', data: new Uint8Array([1]), relationship: 'FormData' }],
    })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    expect(() => backend.toUint8Array()).toThrow(/invalid AFRelationship FormData/)
  })

  it('FileAttachment・Watermark・Redactを通常外観とAFへ接続する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-3b',
      annotations: [
        {
          subtype: 'FileAttachment', pageIndex: 0, x: 10, y: 10, width: 28, height: 28,
          file: {
            name: 'source.bin', data: new Uint8Array([1, 2, 3]),
            mimeType: 'application/octet-stream', relationship: 'Data',
          },
        },
        { subtype: 'Watermark', pageIndex: 0, x: 45, y: 10, width: 60, height: 28 },
        {
          subtype: 'Redact', pageIndex: 0, x: 10, y: 50, width: 95, height: 24,
          quadPoints: [[10, 50, 105, 50, 10, 74, 105, 74]], interiorColor: '#000000',
        },
      ],
    })
    render({ pages: [{ width: 120, height: 90, children: [] }] }, backend)
    const bytes = backend.toUint8Array()
    validatePdfConformance(bytes, { pdfaConformance: 'PDF/A-3b' })
    const text = pdfToText(bytes)
    expect(text.match(/\/AP << \/N \d+ 0 R >>/g)).toHaveLength(3)
    expect(text).toMatch(/\/Subtype \/FileAttachment[\s\S]*\/AF \[\d+ 0 R\]/)
  })
})

describe('PDF/A 共通', () => {
  // Verifies that the XMP packet declares pdfaid:part=1 and pdfaid:conformance=B for PDF/A-1b.
  it('XMP メタデータに pdfaid:part と pdfaid:conformance が含まれる (PDF/A-1b)', () => {
    const { text } = generatePdf('PDF/A-1b')
    expect(text).toContain('<pdfaid:part>1</pdfaid:part>')
    expect(text).toContain('<pdfaid:conformance>B</pdfaid:conformance>')
  })

  // Verifies that the XMP packet declares pdfaid:part=2 for PDF/A-2b.
  it('XMP メタデータに pdfaid:part=2 が含まれる (PDF/A-2b)', () => {
    const { text } = generatePdf('PDF/A-2b')
    expect(text).toContain('<pdfaid:part>2</pdfaid:part>')
  })

  // Verifies that the XMP packet declares pdfaid:part=3 for PDF/A-3b.
  it('XMP メタデータに pdfaid:part=3 が含まれる (PDF/A-3b)', () => {
    const { text } = generatePdf('PDF/A-3b')
    expect(text).toContain('<pdfaid:part>3</pdfaid:part>')
  })

  // Verifies that a GTS_PDFA1 OutputIntent with an embedded sRGB ICC profile (/N 3) is emitted.
  it('OutputIntent に sRGB ICC プロファイルが含まれる', () => {
    const { text } = generatePdf('PDF/A-1b')
    expect(text).toContain('/Type /OutputIntent')
    expect(text).toContain('/S /GTS_PDFA1')
    expect(text).toContain('/OutputConditionIdentifier (sRGB IEC61966-2.1)')
    expect(text).toContain('/DestOutputProfile')
    expect(text).toContain('/N 3')
  })

  it('DeviceCMYKを埋め込みDefaultCMYKプロファイルで管理する', () => {
    const backend = new PdfBackend({ fonts: { default: font }, pdfaConformance: 'PDF/A-2b' })
    render({ pages: [{ width: 100, height: 100, children: [{
      type: 'rect', x: 10, y: 10, width: 20, height: 20, fill: 'cmyk(0,100,100,0)',
    }] }] }, backend)
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/DefaultCMYK')
    expect(text).toContain('/N 4')
    expect(text).toMatch(/0 1 1 0 k/)
  })

  // Verifies that the Catalog carries the /OutputIntents array required by PDF/A.
  it('Catalog に /OutputIntents が含まれる', () => {
    const { text } = generatePdf('PDF/A-2b')
    expect(text).toContain('/OutputIntents [')
  })

  it('conformance validator permits omitted OutputIntents when no device colour space is used', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const document = parsePdf(bytes)
    const page = collectPdfPages(document)[0]!.dict
    const resources = document.resolve(page.get('Resources') ?? null)
    const contents = page.get('Contents')
    expect(resources).toBeInstanceOf(Map)
    expect(contents).toBeInstanceOf(PdfRef)
    const updatedResources = new Map(resources as Map<string, import('../../src/pdf/pdf-parser.js').PdfValue>)
    const colorSpaces = new Map<string, import('../../src/pdf/pdf-parser.js').PdfValue>()
    colorSpaces.set('DefaultGray', [
      new PdfName('CalGray'),
      new Map([['WhitePoint', [0.9505, 1, 1.089]], ['Gamma', 2.2]]),
    ])
    updatedResources.set('ColorSpace', colorSpaces)
    const withCalibratedGray = appendIncrementalPageResourcesAndContents(
      bytes,
      updatedResources,
      contents as PdfRef,
      [],
    )
    const withoutOutputIntent = appendIncrementalCatalogValue(withCalibratedGray, 'OutputIntents', null)
    expect(() => validatePdfConformance(withoutOutputIntent, { pdfaConformance: 'PDF/A-1b' }))
      .not.toThrow()
  })

  it('conformance validator requires a DefaultGray or PDF/A OutputIntent for DeviceGray', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const withoutOutputIntent = appendIncrementalCatalogValue(bytes, 'OutputIntents', null)
    expect(() => validatePdfConformance(withoutOutputIntent, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/DeviceGray requires DefaultGray or a PDF\/A OutputIntent/)
  })

  it('conformance validator requires a page blending colour space for transparent pages without OutputIntent', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const formObject = firstObject
    const contentObject = firstObject + 1
    const content = '/T Do'
    const calibratedGray = '[/CalGray << /WhitePoint [0.9505 1 1.089] /Gamma 2.2 >>]'
    const transparentPage = appendIncrementalPageResourcesAndContents(
      bytes,
      new Map([['XObject', new Map([['T', new PdfRef(formObject, 0)]])]]),
      new PdfRef(contentObject, 0),
      [
        {
          num: formObject,
          body: `<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Group << /S /Transparency /CS ${calibratedGray} >> /Length 0 >>\nstream\n\nendstream`,
        },
        { num: contentObject, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` },
      ],
    )
    const withoutOutputIntent = appendIncrementalCatalogValue(transparentPage, 'OutputIntents', null)
    expect(() => validatePdfConformance(withoutOutputIntent, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/transparent page 1 requires a Transparency Group with CS/)

    const document = parsePdf(withoutOutputIntent)
    const page = collectPdfPages(document)[0]!.dict
    const pageReference = document.getObjectReferences().find(function (reference) {
      return document.resolve(reference) === page
    })
    expect(pageReference).toBeInstanceOf(PdfRef)
    const replacement = new Map(page)
    replacement.set('Group', new Map([
      ['S', new PdfName('Transparency')],
      ['CS', [new PdfName('CalGray'), new Map([['WhitePoint', [0.9505, 1, 1.089]], ['Gamma', 2.2]])]],
    ]))
    const withPageGroup = appendIncrementalUpdate(withoutOutputIntent, [{
      num: pageReference!.num,
      gen: pageReference!.gen,
      body: serializePdfValue(replacement),
    }])
    expect(() => validatePdfConformance(withPageGroup, { pdfaConformance: 'PDF/A-2b' })).not.toThrow()
  })

  it('conformance validator rejects mismatched XMP PDF/A part', () => {
    const { raw } = generatePdf('PDF/A-1b')
    const broken = raw.replace('<pdfaid:part>1</pdfaid:part>', '<pdfaid:part>9</pdfaid:part>')
    expect(() => validatePdfConformance(latin1Bytes(broken), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/requires matching XMP PDF\/A part/)
  })

  it('conformance validator rejects Info Title and XMP title mismatch', () => {
    const { raw } = generatePdf('PDF/A-1b', { title: 'Test Report' })
    const broken = raw.replace(
      '<rdf:li xml:lang="x-default">Test Report</rdf:li>',
      '<rdf:li xml:lang="x-default">Test Reporx</rdf:li>',
    )
    expect(() => validatePdfConformance(latin1Bytes(broken), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/Info Title and XMP are not synchronized/)
  })

  it('OutputIntentの省略可能なTypeを要求しない', () => {
    for (const conformance of ['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b'] as const) {
      const { raw } = generatePdf(conformance)
      const withoutOptionalType = raw.replace('/Type /OutputIntent', ' '.repeat('/Type /OutputIntent'.length))
      expect(() => validatePdfConformance(latin1Bytes(withoutOptionalType), { pdfaConformance: conformance })).not.toThrow()
    }
  })

  it('PDF/A-1のInfo同期でXMP側の欠落と複数dc:creator要素を拒否する', () => {
    const titled = generatePdf('PDF/A-1b', { title: 'Test Report' })
    const missingTitle = titled.raw
      .replace('<dc:title>', '<dc:tixle>')
      .replace('</dc:title>', '</dc:tixle>')
    expect(() => validatePdfConformance(latin1Bytes(missingTitle), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/Info Title and XMP are not synchronized/)

    const authored = generatePdf('PDF/A-1b', { author: 'Report Author' })
    const document = parsePdf(authored.bytes)
    const catalog = document.resolve(document.trailer.get('Root') ?? null)
    expect(catalog).toBeInstanceOf(Map)
    const metadataReference = (catalog as Map<string, unknown>).get('Metadata')
    expect(metadataReference).toBeInstanceOf(PdfRef)
    const metadataStream = document.resolve(metadataReference as PdfRef)
    expect(metadataStream).toBeInstanceOf(PdfStream)
    const xml = new TextDecoder().decode(document.decodeStream(metadataStream as PdfStream))
      .replace('<rdf:li>Report Author</rdf:li>', '<rdf:li>Report Author</rdf:li><rdf:li>Second Author</rdf:li>')
    const xmlBytes = new TextEncoder().encode(xml)
    const multipleAuthors = appendIncrementalUpdate(authored.bytes, [{
      num: (metadataReference as PdfRef).num,
      gen: (metadataReference as PdfRef).gen,
      body: concatBytes(
        latin1Bytes(`<< /Type /Metadata /Subtype /XML /Length ${xmlBytes.length} >>\nstream\n`),
        xmlBytes,
        latin1Bytes('\nendstream'),
      ),
    }])
    expect(() => validatePdfConformance(multipleAuthors, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/dc:creator must contain exactly one entry/)
  })

  it('validatorがPDF/A extension schemaの必須prefix・field・custom property対応を検証する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-2b',
      metadata: {
        xmp: {
          properties: [{
            namespaceUri: 'https://example.test/archive/1.0/', prefix: 'arc', name: 'recordId', value: 'R-1',
          }],
          extensionSchemas: [{
            schema: 'Archive schema', namespaceUri: 'https://example.test/archive/1.0/', prefix: 'arc',
            properties: [{ name: 'recordId', valueType: 'Text', category: 'internal', description: 'Record identifier' }],
          }],
        },
      },
    })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    const valid = backend.toUint8Array()
    expect(() => validatePdfConformance(valid, { pdfaConformance: 'PDF/A-2b' })).not.toThrow()

    const raw = new TextDecoder('latin1').decode(valid)
    const wrongPrefix = raw.replaceAll('pdfaExtension', 'xfdaExtension')
    expect(wrongPrefix).not.toBe(raw)
    expect(() => validatePdfConformance(latin1Bytes(wrongPrefix), { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/custom XMP properties require an extension schema|invalid required prefixes/)

    const undefinedField = raw.replaceAll('pdfaProperty:description', 'pdfaProperty:undefinedxx')
    expect(undefinedField).not.toBe(raw)
    expect(() => validatePdfConformance(latin1Bytes(undefinedField), { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/contains undefined field/)
  })

  it('conformance validator rejects fonts used for visible text without embedding', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const content = 'BT /Fbad 12 Tf (A) Tj ET'
    const withFont = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /Font << /Fbad << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${firstObject} 0 R`,
      [{ num: firstObject, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` }],
    )
    expect(() => validatePdfConformance(withFont, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/requires embedded fonts/)
  })

  it('validator permits unembedded fonts used exclusively with text rendering mode 3', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const content = 'BT /Fhidden 12 Tf 3 Tr (A) Tj ET'
    const hiddenText = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /Font << /Fhidden << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${firstObject} 0 R`,
      [{ num: firstObject, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` }],
    )
    expect(() => validatePdfConformance(hiddenText, { pdfaConformance: 'PDF/A-1b' })).not.toThrow()
  })

  it('validator treats a Contents array as one continuous content stream', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const firstPart = 'q BT /Fhidden 12 Tf 3 Tr'
    const secondPart = '(A) Tj ET Q'
    const splitContent = appendIncrementalPageResourcesAndContents(
      bytes,
      new Map([
        ['Font', new Map([['Fhidden', new PdfRef(firstObject, 0)]])],
      ]),
      [new PdfRef(firstObject + 1, 0), new PdfRef(firstObject + 2, 0)],
      [
        { num: firstObject, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
        { num: firstObject + 1, body: `<< /Length ${firstPart.length} >>\nstream\n${firstPart}\nendstream` },
        { num: firstObject + 2, body: `<< /Length ${secondPart.length} >>\nstream\n${secondPart}\nendstream` },
      ],
    )
    expect(() => validatePdfConformance(splitContent, { pdfaConformance: 'PDF/A-1b' })).not.toThrow()
  })

  it('PDF/A-2 validator rejects .notdef even in text rendering mode 3', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const content = 'BT /Fbad 12 Tf 3 Tr (A) Tj ET'
    const charProc = '0 0 d0'
    const invalid = appendIncrementalPageFontAndContent(
      bytes,
      firstObject,
      firstObject + 1,
      [
        {
          num: firstObject,
          body: [
            '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [0.001 0 0 0.001 0 0]',
            `/CharProcs << /.notdef ${firstObject + 2} 0 R >>`,
            '/Encoding << /Type /Encoding /Differences [65 /.notdef] >>',
            '/FirstChar 65 /LastChar 65 /Widths [500] /Resources << >> >>',
          ].join(' '),
        },
        { num: firstObject + 1, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` },
        { num: firstObject + 2, body: `<< /Length ${charProc.length} >>\nstream\n${charProc}\nendstream` },
      ],
    )
    expect(() => validatePdfConformance(invalid, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/forbid the \.notdef glyph/)
  })

  it('validator does not treat an unused font resource as a used font', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const document = parsePdf(bytes)
    const page = collectPdfPages(document)[0]!.dict
    const pageReference = document.getObjectReferences().find(function (reference) {
      return document.resolve(reference) === page
    })
    if (pageReference === undefined) throw new Error('test fixture error: Page reference not found')
    const resources = document.resolve(page.get('Resources') ?? null)
    if (!(resources instanceof Map)) throw new Error('test fixture error: Page Resources dictionary not found')
    const fonts = document.resolve(resources.get('Font') ?? null)
    if (!(fonts instanceof Map)) throw new Error('test fixture error: Page Font resources dictionary not found')
    const updatedFonts = new Map(fonts)
    updatedFonts.set('Fbad', new Map([
      ['Type', new PdfName('Font')],
      ['Subtype', new PdfName('Type1')],
      ['BaseFont', new PdfName('Helvetica')],
    ]))
    const updatedResources = new Map(resources)
    updatedResources.set('Font', updatedFonts)
    const updatedPage = new Map(page)
    updatedPage.set('Resources', updatedResources)
    const withUnusedFont = appendIncrementalUpdate(bytes, [{
      num: pageReference.num,
      gen: pageReference.gen,
      body: serializePdfValue(updatedPage),
    }])
    expect(() => validatePdfConformance(withUnusedFont, { pdfaConformance: 'PDF/A-1b' })).not.toThrow()
  })

  it('validator counts Form XObject fonts only when the form is executed by Do', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const formContent = 'BT /Fhidden 12 Tf (A) Tj ET'
    const form = [
      '<< /Type /XObject /Subtype /Form /BBox [0 0 10 10]',
      `/Resources << /Font << /Fhidden ${firstObject} 0 R >> >>`,
      `/Length ${formContent.length} >>\nstream\n${formContent}\nendstream`,
    ].join(' ')
    const objects = [
      { num: firstObject, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
      { num: firstObject + 1, body: form },
    ]
    const resources = new Map<string, import('../../src/pdf/pdf-parser.js').PdfValue>([
      ['XObject', new Map([['Fm', new PdfRef(firstObject + 1, 0)]])],
    ])

    const unusedContent = ''
    const unused = appendIncrementalPageResourcesAndContents(
      bytes,
      resources,
      new PdfRef(firstObject + 2, 0),
      [...objects, { num: firstObject + 2, body: `<< /Length 0 >>\nstream\n${unusedContent}\nendstream` }],
    )
    expect(() => validatePdfConformance(unused, { pdfaConformance: 'PDF/A-1b' })).not.toThrow()

    const executedContent = '/Fm Do'
    const executed = appendIncrementalPageResourcesAndContents(
      bytes,
      resources,
      new PdfRef(firstObject + 2, 0),
      [...objects, { num: firstObject + 2, body: `<< /Length ${executedContent.length} >>\nstream\n${executedContent}\nendstream` }],
    )
    expect(() => validatePdfConformance(executed, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/requires embedded fonts/)
  })

  it('validatorがPDF/Aのファイル先頭・binary marker・最終EOFを厳密に検証する', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const displaced = concatBytes(new Uint8Array([0x20]), bytes)
    expect(() => validatePdfConformance(displaced, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/header must begin at byte zero/)

    const asciiMarker = bytes.slice()
    const firstLf = asciiMarker.indexOf(0x0A)
    asciiMarker.set([0x41, 0x42, 0x43, 0x44], firstLf + 2)
    expect(() => validatePdfConformance(asciiMarker, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/binary marker comment/)

    expect(() => validatePdfConformance(concatBytes(bytes, new Uint8Array([0x20])), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/final %%EOF/)
  })

  it('validatorがNeedsRenderingを値に関係なく拒否する', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const mutated = appendIncrementalCatalogValue(bytes, 'NeedsRendering', false)
    expect(() => validatePdfConformance(mutated, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/forbids Catalog NeedsRendering/)
  })

  it('validatorが線形化PDF/A-1のheader版と両trailer IDを検証する', () => {
    const linearized = linearizePdf(generatePdf('PDF/A-1b').bytes)
    expect(new TextDecoder('latin1').decode(linearized).startsWith('%PDF-1.4')).toBe(true)
    expect(() => validatePdfConformance(linearized, { pdfaConformance: 'PDF/A-1b' })).not.toThrow()

    const raw = new TextDecoder('latin1').decode(linearized)
    const finalIdentifier = raw.lastIndexOf('/ID [<')
    expect(finalIdentifier).toBeGreaterThan(0)
    const mismatched = linearized.slice()
    const digitOffset = finalIdentifier + '/ID [<'.length
    mismatched[digitOffset] = mismatched[digitOffset] === 0x30 ? 0x31 : 0x30
    expect(() => validatePdfConformance(mismatched, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/linearized first-page and final trailer identifiers must be identical/)
  })

  it('validatorがPDF/Aのhex string偶数桁とxref EOLを字句レベルで検証する', () => {
    const { raw } = generatePdf('PDF/A-1b')
    const oddHex = raw.replace(/(\/ID \[<[0-9A-Fa-f]+)([0-9A-Fa-f])(>)/, '$1 $3')
    expect(oddHex).not.toBe(raw)
    expect(() => validatePdfConformance(latin1Bytes(oddHex), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/hexadecimal strings require an even number of digits/)

    const xrefWithoutEol = raw.replace('\nxref\n', '\nxref ')
    expect(xrefWithoutEol).not.toBe(raw)
    expect(() => validatePdfConformance(latin1Bytes(xrefWithoutEol), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/xref keyword .* is not followed by exactly one EOL marker/)

    const xrefSubsectionWithTwoSpaces = raw.replace('\nxref\n0 ', '\nxref\n0  ')
    expect(xrefSubsectionWithTwoSpaces).not.toBe(raw)
    expect(() => validatePdfConformance(latin1Bytes(xrefSubsectionWithTwoSpaces), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/xref subsection header .* exactly one SPACE byte/)
  })

  it('validatorがPDF/A-2のfont name UTF-8とpredefined CMap境界を検証する', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const type3Content = 'BT /Fbad 12 Tf (A) Tj ET'
    const charProc = '0 0 d0'
    const invalidName = appendIncrementalPageFontAndContent(
      bytes,
      objectNumber,
      objectNumber + 1,
      [
        {
          num: objectNumber,
          body: [
            '<< /Type /Font /Subtype /Type3 /BaseFont /#C3#28 /FontBBox [0 0 1 1]',
            '/FontMatrix [0.001 0 0 0.001 0 0]',
            `/CharProcs << /A ${objectNumber + 2} 0 R >>`,
            '/Encoding << /Type /Encoding /Differences [65 /A] >>',
            '/FirstChar 65 /LastChar 65 /Widths [500] /Resources << >> >>',
          ].join(' '),
        },
        { num: objectNumber + 1, body: `<< /Length ${type3Content.length} >>\nstream\n${type3Content}\nendstream` },
        { num: objectNumber + 2, body: `<< /Length ${charProc.length} >>\nstream\n${charProc}\nendstream` },
      ],
    )
    expect(() => validatePdfConformance(invalidName, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/requires a valid UTF-8 name/)

    const cmapContent = 'BT /Fbad 12 Tf <0001> Tj ET'
    const nonStandardCMap = appendIncrementalPageFontAndContent(
      bytes,
      objectNumber,
      objectNumber + 1,
      [
        {
          num: objectNumber,
          body: '<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /UnknownMap /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>] >>',
        },
        { num: objectNumber + 1, body: `<< /Length ${cmapContent.length} >>\nstream\n${cmapContent}\nendstream` },
      ],
    )
    expect(() => validatePdfConformance(nonStandardCMap, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/non-standard CMap UnknownMap|unknown predefined CMap UnknownMap/)
  })

  it('PDF/A-1ではIdentity-H・Identity-V以外のCMap埋込みを要求する', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const content = 'BT /Fbad 12 Tf <0001> Tj ET'
    const namedPredefinedCMap = appendIncrementalPageFontAndContent(
      bytes,
      objectNumber,
      objectNumber + 1,
      [
        {
          num: objectNumber,
          body: '<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /UniJIS-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 7 >> >>] >>',
        },
        { num: objectNumber + 1, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` },
      ],
    )
    expect(() => validatePdfConformance(namedPredefinedCMap, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/requires non-standard CMap UniJIS-UCS2-H to be embedded/)
  })

  it('validatorが埋込Type1 programの全glyphとCharSetを照合する', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const program = buildPdfAType1Program()
    const fontFile = concatBytes(
      latin1Bytes(`<< /Length ${program.length} /Length1 ${program.length} >>\nstream\n`),
      program,
      latin1Bytes('\nendstream'),
    )
    const content = 'BT /Fbad 12 Tf (A) Tj ET'
    const mutated = appendIncrementalPageFontAndContent(
      bytes,
      firstObject,
      firstObject + 3,
      [
      {
        num: firstObject,
        body: [
          '<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+PdfAType1',
          `/FontDescriptor ${firstObject + 1} 0 R /Encoding /WinAnsiEncoding`,
          '/FirstChar 65 /LastChar 65 /Widths [500] >>',
        ].join(' '),
      },
      {
        num: firstObject + 1,
        body: [
          '<< /Type /FontDescriptor /FontName /ABCDEF+PdfAType1 /Flags 32',
          '/FontBBox [0 0 500 700] /ItalicAngle 0 /Ascent 700 /Descent 0 /CapHeight 700 /StemV 80',
          `/CharSet (/B) /FontFile ${firstObject + 2} 0 R >>`,
        ].join(' '),
      },
      { num: firstObject + 2, body: fontFile },
      { num: firstObject + 3, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` },
      ],
    )
    expect(() => validatePdfConformance(mutated, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/Type1 CharSet omits glyph A|Type1 CharSet does not list every embedded glyph/)
  })

  it('validatorがparserの修復対象でも不一致stream Lengthを拒否する', () => {
    const { raw } = generatePdf('PDF/A-1b')
    const broken = raw.replace(/\/Length (\d+)/, function (_match, digits: string) {
      const value = Number(digits)
      return `/Length ${String(Math.max(0, value - 1)).padStart(digits.length, '0')}`
    })
    expect(() => validatePdfConformance(latin1Bytes(broken), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/stream Length does not match/)
  })

  it('validatorが未定義operatorとPDF/A-1のgraphics-state上限を描画streamで拒否する', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const unknown = 'BX UnsupportedOperator EX'
    const withUnknown = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /XObject << /Bad ${firstObject} 0 R >> >>`,
      [{ num: firstObject, body: `<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length ${unknown.length} >>\nstream\n${unknown}\nendstream` }],
    )
    expect(() => validatePdfConformance(withUnknown, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/forbids undefined content operator UnsupportedOperator/)

    const nested = `${'q '.repeat(29)}${'Q '.repeat(29)}`
    const withNesting = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /XObject << /Bad ${firstObject} 0 R >> >>`,
      [{ num: firstObject, body: `<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length ${nested.length} >>\nstream\n${nested}\nendstream` }],
    )
    expect(() => validatePdfConformance(withNesting, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/graphics-state nesting exceeds 28/)
  })

  it('validatorが実際に描画する文字の埋込glyph欠落を拒否する', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const content = 'BT /Fbad 12 Tf (B) Tj ET'
    const charProc = '0 0 d0'
    const fontObject = [
      '<< /Type /Font /Subtype /Type3 /Name /Fbad /BaseFont /Fbad',
      '/FontBBox [0 0 1 1] /FontMatrix [0.001 0 0 0.001 0 0]',
      `/CharProcs << /A ${firstObject + 2} 0 R >>`,
      '/Encoding << /Type /Encoding /Differences [65 /A 66 /B] >>',
      '/FirstChar 65 /LastChar 66 /Widths [500 500] /Resources << >> >>',
    ].join(' ')
    const mutated = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /Font << /Fbad ${firstObject} 0 R >> >> /Contents ${firstObject + 1} 0 R`,
      [
        { num: firstObject, body: fontObject },
        { num: firstObject + 1, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` },
        { num: firstObject + 2, body: `<< /Length ${charProc.length} >>\nstream\n${charProc}\nendstream` },
      ],
    )
    expect(() => validatePdfConformance(mutated, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/embedded font Fbad omits glyph for character code 66/)
  })

  it('validatorが描画文字のfont dictionary幅と埋込font実幅を照合する', () => {
    const { raw } = generatePdf('PDF/A-1b')
    const broken = raw.replace(/\/W \[(\d+) \[(\d+)\]/, function (_match, cid: string, width: string) {
      const replacement = width.split('').map(function () { return '9' }).join('')
      return `/W [${cid} [${replacement}]`
    })
    expect(broken).not.toBe(raw)
    expect(() => validatePdfConformance(latin1Bytes(broken), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/glyph width .* does not match dictionary width/)
  })

  it('validatorがdevice色空間をDefault色空間またはOutputIntentへ接続する', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const content = '0 0 0 1 k'
    const mutated = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /XObject << /Bad ${objectNumber} 0 R >> >>`,
      [{ num: objectNumber, body: `<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << >> /Length ${content.length} >>\nstream\n${content}\nendstream` }],
    )
    expect(() => validatePdfConformance(mutated, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/DeviceCMYK requires DefaultCMYK or a matching OutputIntent/)
  })

  it('validatorが同名Separationのalternate spaceとtint transform完全一致を要求する', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const mutated = appendIncrementalUpdate(bytes, [{
      num: objectNumber,
      body: [
        '<< /One [/Separation /Spot /DeviceRGB << /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 0 0] /N 1 >>]',
        '/Two [/Separation /Spot /DeviceRGB << /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [0 1 0] /N 1 >>] >>',
      ].join(' '),
    }])
    expect(() => validatePdfConformance(mutated, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/Separation colorant Spot has inconsistent alternate space or tint transform/)
  })

  it('validatorがhalftone TransferFunctionをprimary/custom colorant規則で検証する', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const primaryTransfer = appendIncrementalUpdate(bytes, [{
      num: firstObject,
      body: [
        '<< /HalftoneType 5',
        '/Cyan << /HalftoneType 1 /Frequency 60 /Angle 45 /SpotFunction /Round /TransferFunction /Identity >>',
        '>>',
      ].join(' '),
    }])
    expect(() => validatePdfConformance(primaryTransfer, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/primary-colorant halftones forbid TransferFunction/)

    const missingCustomTransfer = appendIncrementalUpdate(bytes, [{
      num: firstObject,
      body: [
        '<< /HalftoneType 5',
        '/SpotOrange << /HalftoneType 1 /Frequency 60 /Angle 45 /SpotFunction /Round >>',
        '>>',
      ].join(' '),
    }])
    expect(() => validatePdfConformance(missingCustomTransfer, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/custom-colorant halftone SpotOrange requires TransferFunction/)
  })

  it('validatorがICCBased CMYKとoverprintをgraphics state順序込みで検証する', () => {
    const backend = new PdfBackend({ fonts: { default: font }, pdfaConformance: 'PDF/A-1b' })
    render({ pages: [{ width: 100, height: 100, children: [{
      type: 'rect', x: 10, y: 10, width: 20, height: 20, fill: 'cmyk(0,100,100,0)',
    }] }] }, backend)
    const bytes = backend.toUint8Array()
    const expanded = pdfToText(bytes)
    const colorSpaceMatch = /\/DefaultCMYK (\d+) 0 R/.exec(expanded)
    expect(colorSpaceMatch).not.toBeNull()
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const content = '/CSicc cs /GSop gs'
    const form = [
      '<< /Type /XObject /Subtype /Form /BBox [0 0 1 1]',
      `/Resources << /ColorSpace << /CSicc ${colorSpaceMatch![1]} 0 R >>`,
      '/ExtGState << /GSop << /Type /ExtGState /op true /OPM 1 >> >> >>',
      `/Length ${content.length} >>\nstream\n${content}\nendstream`,
    ].join(' ')
    const mutated = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /XObject << /Bad ${firstObject} 0 R >> >>`,
      [{ num: firstObject, body: form }],
    )
    expect(() => validatePdfConformance(mutated, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/OPM 1 is forbidden when ICCBased CMYK overprinting is enabled/)
  })

  it('validatorがPDF/A-2のJPEG 2000 channel・bit depth・colour specificationを検証する', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const jpx = new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'jpx', 'rgb16-lossless.jp2')))
    const valid = appendIncrementalUpdate(bytes, [{
      num: objectNumber,
      body: concatBytes(
        latin1Bytes(`<< /Length ${jpx.length} /Filter /JPXDecode >>\nstream\n`),
        jpx,
        latin1Bytes('\nendstream'),
      ),
    }])
    expect(() => validatePdfConformance(valid, { pdfaConformance: 'PDF/A-2b' })).not.toThrow()

    const forbidden = jpx.slice()
    const colr = findByteSequence(forbidden, [0x63, 0x6F, 0x6C, 0x72])
    expect(colr).toBeGreaterThanOrEqual(0)
    expect(forbidden[colr + 4]).toBe(1)
    forbidden[colr + 7] = 0
    forbidden[colr + 8] = 0
    forbidden[colr + 9] = 0
    forbidden[colr + 10] = 19
    const invalid = appendIncrementalUpdate(bytes, [{
      num: objectNumber,
      body: concatBytes(
        latin1Bytes(`<< /Length ${forbidden.length} /Filter /JPXDecode >>\nstream\n`),
        forbidden,
        latin1Bytes('\nendstream'),
      ),
    }])
    expect(() => validatePdfConformance(invalid, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/JPEG 2000 contains a forbidden colour specification/)

    const explicitColorSpace = appendIncrementalUpdate(bytes, [{
      num: objectNumber,
      body: concatBytes(
        latin1Bytes(`<< /Length ${forbidden.length} /Filter /JPXDecode /ColorSpace /DeviceRGB >>\nstream\n`),
        forbidden,
        latin1Bytes('\nendstream'),
      ),
    }])
    expect(() => validatePdfConformance(explicitColorSpace, { pdfaConformance: 'PDF/A-2b' })).not.toThrow()

    const jp2hType = findByteSequence(jpx, [0x6A, 0x70, 0x32, 0x68])
    expect(jp2hType).toBeGreaterThanOrEqual(4)
    const jp2hStart = jp2hType - 4
    const bpcc = Uint8Array.from([0, 0, 0, 11, 0x62, 0x70, 0x63, 0x63, 7, 7, 7])
    const withBpcc = concatBytes(jpx.slice(0, jp2hStart + 8), bpcc, jpx.slice(jp2hStart + 8))
    const jp2hLength = new DataView(jpx.buffer, jpx.byteOffset + jp2hStart, 4).getUint32(0, false)
    new DataView(withBpcc.buffer, withBpcc.byteOffset + jp2hStart, 4).setUint32(0, jp2hLength + bpcc.length, false)
    const invalidBpcc = appendIncrementalUpdate(bytes, [{
      num: objectNumber,
      body: concatBytes(
        latin1Bytes(`<< /Length ${withBpcc.length} /Filter /JPXDecode >>\nstream\n`),
        withBpcc,
        latin1Bytes('\nendstream'),
      ),
    }])
    expect(() => validatePdfConformance(invalidBpcc, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/JPEG 2000 forbids BPCC/)
  })

  // Verifies that an XMP metadata stream is always generated under PDF/A, even without user metadata.
  it('metadata 未指定でも XMP メタデータが生成される', () => {
    const { text } = generatePdf('PDF/A-1b')
    expect(text).toContain('/Type /Metadata')
    expect(text).toContain('/Subtype /XML')
    expect(text).toContain('x:xmpmeta')
  })

  // Verifies that a user-supplied title appears in both the XMP packet and the Info dict.
  it('metadata 指定時にタイトルが XMP に含まれる', () => {
    const { text } = generatePdf('PDF/A-1b', { title: 'Test Report' })
    expect(text).toContain('Test Report')
    expect(text).toContain('/Title (Test Report)')
  })

  // Verifies that a file identifier (/ID) is generated, as required by PDF/A.
  it('fileId が生成される', () => {
    const { text, raw } = generatePdf('PDF/A-1b')
    expect(text).toContain('/ID [<')
  })

  // Verifies that the Catalog declares /MarkInfo << /Marked true >> under PDF/A.
  it('MarkInfo が Catalog に含まれる', () => {
    const { text } = generatePdf('PDF/A-1b')
    expect(text).toContain('/MarkInfo << /Marked true >>')
  })

  // Verifies that combining encryption with PDF/A conformance throws, since PDF/A forbids encryption.
  it('暗号化と PDF/A の併用でエラーが発生する', () => {
    expect(() => {
      const backend = new PdfBackend({
        fonts: { default: font },
        pdfaConformance: 'PDF/A-1b',
        encryption: { userPassword: 'test', ownerPassword: 'owner' },
      })
      const doc: RenderDocument = {
        pages: [{ width: 595, height: 842, children: [] }],
      }
      render(doc, backend)
      backend.toUint8Array()
    }).toThrow('PDF/A conformance does not allow encryption')
  })

  it('JavaScript action と PDF/A の併用でエラーが発生する', () => {
    expect(() => {
      const backend = new PdfBackend({
        fonts: { default: font },
        pdfaConformance: 'PDF/A-1b',
        javaScript: [{ name: 'doc-ready', script: 'app.alert("ready");' }],
      })
      const doc: RenderDocument = {
        pages: [{ width: 595, height: 842, children: [] }],
      }
      render(doc, backend)
      backend.toUint8Array()
    }).toThrow('PDF/A conformance does not allow JavaScript actions')
  })

  it('Collection と PDF/A の併用でエラーが発生する', () => {
    expect(() => {
      const backend = new PdfBackend({
        fonts: { default: font },
        pdfaConformance: 'PDF/A-1b',
        collection: { view: 'D' },
      })
      const doc: RenderDocument = {
        pages: [{ width: 595, height: 842, children: [] }],
      }
      render(doc, backend)
      backend.toUint8Array()
    }).toThrow('PDF/A conformance does not allow collection dictionaries')
  })

  it('PDF/A-2・PDF/A-3で許可されるCollection dictionaryを公開出力へ接続する', () => {
    for (const conformance of ['PDF/A-2b', 'PDF/A-3b'] as const) {
      const backend = new PdfBackend({
        fonts: { default: font },
        pdfaConformance: conformance,
        collection: { view: 'D' },
      })
      render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
      const bytes = backend.toUint8Array()
      expect(pdfToText(bytes)).toContain('/Type /Collection')
      expect(() => validatePdfConformance(bytes, { pdfaConformance: conformance })).not.toThrow()
    }
  })

  it('validatorがpresence-dependent規則と全action dictionaryをobject graphで検証する', () => {
    const { bytes } = generatePdf('PDF/A-1b')
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const invalidObjects: Array<{ body: string; error: RegExp }> = [
      {
        body: '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Interpolate null /Length 1 >>\nstream\n0\nendstream',
        error: /Image Interpolate must be false/,
      },
      { body: '<< /Type /ExtGState /TR2 null >>', error: /ExtGState TR2 must be Default/ },
      { body: '<< /Type /Action /S /JavaScript /JS (unsafe) >>', error: /forbids JavaScript actions/ },
      {
        body: '<< /Type /Metadata /Subtype /XML /Filter /FlateDecode /Length 1 >>\nstream\nx\nendstream',
        error: /metadata streams forbid Filter/,
      },
    ]
    for (let index = 0; index < invalidObjects.length; index++) {
      const fixture = invalidObjects[index]!
      const invalid = appendIncrementalUpdate(bytes, [{ num: firstObject, body: fixture.body }])
      expect(() => validatePdfConformance(invalid, { pdfaConformance: 'PDF/A-1b' }), fixture.body)
        .toThrow(fixture.error)
    }

    const content = '/NonStandard ri'
    const invalidIntent = appendIncrementalPageResourcesAndContents(
      bytes,
      new Map(),
      new PdfRef(firstObject, 0),
      [{ num: firstObject, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` }],
    )
    expect(() => validatePdfConformance(invalidIntent, { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/rendering intent is invalid/)
  })

  it('PDF/A-2・PDF/A-3のinline imageでJBIG2・JPX filterを拒否する', () => {
    for (const conformance of ['PDF/A-2b', 'PDF/A-3b'] as const) {
      const { bytes } = generatePdf(conformance)
      const firstObject = parsePdf(bytes).trailer.get('Size') as number
      for (const filter of ['JBIG2Decode', 'JPXDecode']) {
        const content = `BI /W 1 /H 1 /BPC 1 /CS /DeviceGray /F /${filter} ID x EI`
        const fixture = appendIncrementalPageResourcesAndContents(
          bytes,
          new Map(),
          new PdfRef(firstObject, 0),
          [{ num: firstObject, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` }],
        )
        expect(() => validatePdfConformance(fixture, { pdfaConformance: conformance }))
          .toThrow(new RegExp(`forbids inline-image filter ${filter}`))
      }
    }
  })

  it('一般注釈に印刷フラグと通常外観を付与する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-1b',
      annotations: [{ subtype: 'Text', pageIndex: 0, x: 10, y: 10, width: 20, height: 20 }],
    })
    const doc: RenderDocument = {
      pages: [{ width: 595, height: 842, children: [] }],
    }
    render(doc, backend)
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/Subtype /Text')
    expect(text).toContain('/F 4')
    expect(text).toMatch(/\/AP << \/N \d+ 0 R >>/)
  })

  it('FreeTextとStampの通常外観を明示フォントの埋込subsetへ接続する', () => {
    const backend = new PdfBackend({
      fonts: { japanese: japaneseFont },
      pdfaConformance: 'PDF/A-2b',
      annotations: [
        {
          subtype: 'FreeText', pageIndex: 0, x: 10, y: 10, width: 160, height: 50,
          contents: '日本語の注釈', defaultAppearance: '/Unused 13 Tf 0 0 0 1 k', fontId: 'japanese',
        },
        {
          subtype: 'Stamp', pageIndex: 0, x: 10, y: 70, width: 120, height: 36,
          icon: 'Approved', fontId: 'japanese',
        },
      ],
    })
    render({ pages: [{ width: 200, height: 140, children: [] }] }, backend)
    const bytes = backend.toUint8Array()
    validatePdfConformance(bytes, { pdfaConformance: 'PDF/A-2b' })
    const text = pdfToText(bytes)
    expect(text.match(/\/AP << \/N \d+ 0 R >>/g)).toHaveLength(2)
    expect(text).toContain('/Subtype /Type0')
    expect(text).toContain('/FontFile3')
    expect(text).toContain('/DefaultCMYK')
    expect(text).not.toContain('/BaseFont /Helvetica')
  })

  it('PDF/Aのテキスト注釈でappearance fontId未指定を拒否する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-2b',
      annotations: [{
        subtype: 'FreeText', pageIndex: 0, x: 10, y: 10, width: 100, height: 30,
        contents: 'annotation', defaultAppearance: '/Helv 12 Tf 0 g',
      }],
    })
    render({ pages: [{ width: 120, height: 60, children: [] }] }, backend)
    expect(() => backend.toUint8Array()).toThrow(/requires an embedded appearance fontId/)
  })

  it('validatorがpage annotationに現れないterminal form fieldにもWidget外観を要求する', () => {
    const { bytes } = generatePdf('PDF/A-2b')
    const fieldObject = parsePdf(bytes).trailer.get('Size') as number
    const document = parsePdf(bytes)
    const root = document.trailer.get('Root') as PdfRef
    const catalog = document.resolve(root) as Map<string, import('../../src/pdf/pdf-parser.js').PdfValue>
    const replacement = new Map(catalog)
    replacement.set('AcroForm', new Map([
      ['Fields', [new PdfRef(fieldObject, 0)]],
      ['NeedAppearances', false],
    ]))
    const invalid = appendIncrementalUpdate(bytes, [
      { num: root.num, gen: root.gen, body: serializePdfValue(replacement) },
      { num: fieldObject, body: '<< /FT /Tx /T (orphan) >>' },
    ])
    expect(() => validatePdfConformance(invalid, { pdfaConformance: 'PDF/A-2b' }))
      .toThrow(/terminal form fields require a Widget appearance/)
  })

  it('PDF/A-2・PDF/A-3ではゼロ面積Widgetの外観例外を適用し、PDF/A-1では適用しない', () => {
    for (const conformance of ['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b'] as const) {
      const { bytes } = generatePdf(conformance)
      const document = parsePdf(bytes)
      const fieldObject = document.trailer.get('Size') as number
      const root = document.trailer.get('Root') as PdfRef
      const catalog = document.resolve(root) as Map<string, import('../../src/pdf/pdf-parser.js').PdfValue>
      const replacement = new Map(catalog)
      replacement.set('AcroForm', new Map([
        ['Fields', [new PdfRef(fieldObject, 0)]],
        ['NeedAppearances', false],
      ]))
      const fixture = appendIncrementalUpdate(bytes, [
        { num: root.num, gen: root.gen, body: serializePdfValue(replacement) },
        { num: fieldObject, body: '<< /Type /Annot /Subtype /Widget /FT /Tx /T (zero) /Rect [10 10 10 10] /F 4 >>' },
      ])
      if (conformance === 'PDF/A-1b') {
        expect(() => validatePdfConformance(fixture, { pdfaConformance: conformance }))
          .toThrow(/Widget form fields require a normal appearance/)
      } else {
        expect(() => validatePdfConformance(fixture, { pdfaConformance: conformance })).not.toThrow()
      }
    }
  })

  it('validatorが非印刷注釈と禁止actionを拒否する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      pdfaConformance: 'PDF/A-1b',
      annotations: [{ subtype: 'Text', pageIndex: 0, x: 10, y: 10, width: 20, height: 20 }],
    })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    const annotationBytes = backend.toUint8Array()
    const invisible = new TextDecoder('latin1').decode(annotationBytes).replace('/F 4', '/F 0')
    expect(() => validatePdfConformance(latin1Bytes(invisible), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/printable and visible/)

    const linked = new PdfBackend({ fonts: { default: font }, pdfaConformance: 'PDF/A-1b' })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, linked)
    linked.addAnnotation(0, { type: 'uri', target: 'https://example.test/', x: 0, y: 0, width: 10, height: 10 })
    const linkBytes = linked.toUint8Array()
    const forbidden = new TextDecoder('latin1').decode(linkBytes).replace('/S /URI', '/S /3D ')
    expect(() => validatePdfConformance(latin1Bytes(forbidden), { pdfaConformance: 'PDF/A-1b' }))
      .toThrow(/forbids 3D actions/)
  })

  // Verifies that the generated sRGB ICC profile has a valid binary layout (signature, class, color space, tags).
  it('ICC プロファイルが有効なバイナリ構造を持つ', () => {
    const icc = generateSRGBIccProfile()
    // The sampled IEC 61966-2-1 TRC keeps the profile compact while avoiding
    // the former gamma-2.2 approximation.
    expect(icc.length).toBeGreaterThan(300)
    expect(icc.length).toBeLessThan(1200)
    // acsp signature (offset 36-39)
    const acsp = String.fromCharCode(icc[36]!, icc[37]!, icc[38]!, icc[39]!)
    expect(acsp).toBe('acsp')
    // Profile class: mntr (offset 12-15)
    const cls = String.fromCharCode(icc[12]!, icc[13]!, icc[14]!, icc[15]!)
    expect(cls).toBe('mntr')
    // Color space: RGB (offset 16-19)
    const cs = String.fromCharCode(icc[16]!, icc[17]!, icc[18]!, icc[19]!)
    expect(cs).toBe('RGB ')
    // Tag count > 0 (offset 128-131)
    const view = new DataView(icc.buffer, icc.byteOffset)
    const tagCount = view.getUint32(128)
    expect(tagCount).toBe(9)
  })
})

function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.charCodeAt(i)
    if (codePoint <= 0xFF) {
      bytes[i] = codePoint
      continue
    }
    const byte = WINDOWS_1252_C1.indexOf(codePoint)
    if (byte < 0) throw new Error(`test fixture error: character U+${codePoint.toString(16)} is not Windows-1252`)
    bytes[i] = 0x80 + byte
  }
  return bytes
}

// WHATWG labels "latin1" as Windows-1252. This table makes the encoder the
// exact inverse of TextDecoder('latin1') for the C1 byte range, preserving
// compressed PDF streams while tests mutate same-length ASCII dictionary data.
const WINDOWS_1252_C1 = [
  0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
  0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
  0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
]

function appendIncrementalEntry(bytes: Uint8Array, typeName: 'Catalog' | 'Page', entry: string): Uint8Array {
  const raw = new TextDecoder('latin1').decode(bytes)
  const found = findTypedObject(raw, typeName)
  const insertAt = found.body.lastIndexOf('>>')
  if (insertAt < 0) throw new Error(`test fixture error: ${typeName} dictionary end not found`)
  const updatedBody = `${found.body.slice(0, insertAt)}${entry} ${found.body.slice(insertAt)}`
  return appendIncrementalUpdate(bytes, [{ num: found.objectNumber, body: updatedBody }])
}

function appendIncrementalCatalogValue(
  bytes: Uint8Array,
  key: string,
  value: import('../../src/pdf/pdf-parser.js').PdfValue,
): Uint8Array {
  const document = parsePdf(bytes)
  const root = document.trailer.get('Root')
  if (!(root instanceof PdfRef)) throw new Error('test fixture error: Catalog reference not found')
  const catalog = document.resolve(root)
  if (!(catalog instanceof Map)) throw new Error('test fixture error: Catalog dictionary not found')
  const replacement = new Map(catalog)
  replacement.set(key, value)
  return appendIncrementalUpdate(bytes, [{ num: root.num, gen: root.gen, body: serializePdfValue(replacement) }])
}

function appendIncrementalPageEntryAndObjects(
  bytes: Uint8Array,
  entry: string,
  objects: Array<{ num: number, body: string }>,
): Uint8Array {
  const raw = new TextDecoder('latin1').decode(bytes)
  const found = findTypedObject(raw, 'Page')
  const insertAt = found.body.lastIndexOf('>>')
  if (insertAt < 0) throw new Error('test fixture error: Page dictionary end not found')
  const updatedBody = `${found.body.slice(0, insertAt)}${entry} ${found.body.slice(insertAt)}`
  return appendIncrementalUpdate(bytes, [{ num: found.objectNumber, body: updatedBody }, ...objects])
}

function appendIncrementalPageFontAndContent(
  bytes: Uint8Array,
  fontObjectNumber: number,
  contentObjectNumber: number,
  objects: Array<{ num: number, body: string | Uint8Array }>,
): Uint8Array {
  return appendIncrementalPageResourcesAndContents(
    bytes,
    new Map([['Font', new Map([['Fbad', new PdfRef(fontObjectNumber, 0)]])]]),
    new PdfRef(contentObjectNumber, 0),
    objects,
  )
}

function appendIncrementalPageResourcesAndContents(
  bytes: Uint8Array,
  resources: Map<string, import('../../src/pdf/pdf-parser.js').PdfValue>,
  contents: PdfRef | PdfRef[],
  objects: Array<{ num: number, body: string | Uint8Array }>,
): Uint8Array {
  const document = parsePdf(bytes)
  const page = collectPdfPages(document)[0]!.dict
  const pageReference = document.getObjectReferences().find(function (reference) {
    return document.resolve(reference) === page
  })
  if (pageReference === undefined) throw new Error('test fixture error: Page reference not found')
  const replacement = new Map(page)
  replacement.set('Resources', resources)
  replacement.set('Contents', contents)
  return appendIncrementalUpdate(bytes, [
    { num: pageReference.num, gen: pageReference.gen, body: serializePdfValue(replacement) },
    ...objects,
  ])
}

function findTypedObject(raw: string, typeName: 'Catalog' | 'Page'): { objectNumber: number, body: string } {
  const objectPattern = /(\d+) 0 obj\s*([\s\S]*?)\nendobj/g
  for (const match of raw.matchAll(objectPattern)) {
    const body = match[2]!
    if (typeName === 'Catalog' && body.includes('/Type /Catalog')) {
      return { objectNumber: Number(match[1]), body }
    }
    if (typeName === 'Page' && /\/Type \/Page(?:\s|\/|>)/.test(body)) {
      return { objectNumber: Number(match[1]), body }
    }
  }
  throw new Error(`test fixture error: ${typeName} object not found`)
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce(function (sum, part) { return sum + part.length }, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function findByteSequence(data: Uint8Array, sequence: readonly number[]): number {
  for (let offset = 0; offset + sequence.length <= data.length; offset++) {
    let matches = true
    for (let index = 0; index < sequence.length; index++) {
      if (data[offset + index] !== sequence[index]) { matches = false; break }
    }
    if (matches) return offset
  }
  return -1
}

function buildPdfAType1Program(): Uint8Array {
  const clear = latin1Bytes(
    '%!PS-AdobeFont-1.0: PdfAType1 001.001\n'
    + '/FontName /PdfAType1 def\n'
    + '/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n'
    + '/Encoding StandardEncoding def\n'
    + 'currentdict end\ncurrentfile eexec\n',
  )
  const notdef = new Uint8Array([...type1Number(0), ...type1Number(250), 13, 14])
  const glyph = new Uint8Array([
    ...type1Number(0), ...type1Number(500), 13,
    ...type1Number(0), ...type1Number(0), 21,
    ...type1Number(100), ...type1Number(0), 5,
    ...type1Number(0), ...type1Number(100), 5,
    ...type1Number(-100), ...type1Number(0), 5,
    9, 14,
  ])
  const encryptedNotdef = encryptType1(notdef, 4330, 4)
  const encryptedGlyph = encryptType1(glyph, 4330, 4)
  const privateProgram = concatBytes(
    latin1Bytes('/Private 8 dict dup begin\n/lenIV 4 def\nend\n/CharStrings 2 dict dup begin\n'),
    latin1Bytes(`/.notdef ${encryptedNotdef.length} RD `), encryptedNotdef, latin1Bytes(' ND\n'),
    latin1Bytes(`/A ${encryptedGlyph.length} RD `), encryptedGlyph, latin1Bytes(' ND\n'),
    latin1Bytes('end\nend\nmark currentfile closefile\n'),
  )
  return concatBytes(clear, encryptType1(privateProgram, 55665, 4))
}

function type1Number(value: number): number[] {
  if (value >= -107 && value <= 107) return [value + 139]
  return [255, (value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF]
}

function encryptType1(plain: Uint8Array, initialKey: number, prefixLength: number): Uint8Array {
  const source = new Uint8Array(prefixLength + plain.length)
  source.set(plain, prefixLength)
  const result = new Uint8Array(source.length)
  let key = initialKey
  for (let index = 0; index < source.length; index++) {
    const encrypted = source[index]! ^ (key >>> 8)
    result[index] = encrypted & 0xFF
    key = ((encrypted + key) * 52845 + 22719) & 0xFFFF
  }
  return result
}
