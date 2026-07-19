/**
 * PDF metadata (Info dict + XMP) tests.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend, type PdfMetadata } from '../../src/renderer/pdf-backend.js'
import { render, renderToPdf } from '../../src/renderer/renderer.js'
import type { RenderDocument } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'
import { parsePdf, PdfRef, PdfStream } from '../../src/pdf/pdf-parser.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { buildPdfXmpPacket } from '../../src/pdf/pdf-xmp.js'
import { zlibDeflate } from '../../src/compression/deflate.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

let font: Font

beforeAll(() => {
  const buf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  font = Font.load(buf.buffer as ArrayBuffer)
})

function generatePdf(metadata?: PdfMetadata, encryption?: { userPassword: string; ownerPassword: string }): { bytes: Uint8Array; text: string } {
  const backend = new PdfBackend({
    fonts: { default: font },
    metadata,
    encryption,
  })
  const doc: RenderDocument = {
    pages: [{
      width: 595, height: 842,
      children: [{
        type: 'text', x: 72, y: 72, text: 'Metadata Test',
        fontId: 'default', fontSize: 12, color: '#000000',
      }],
    }],
  }
  render(doc, backend)
  const bytes = backend.toUint8Array()
  return { bytes, text: pdfToText(bytes) }
}

describe('PDF Info Dictionary', () => {
  // Verifies that no /Info reference is emitted in the trailer when no metadata is supplied.
  it('metadata なしの場合、/Info が trailer に含まれない', () => {
    const { text } = generatePdf()
    expect(text).not.toContain('/Info ')
  })

  // Verifies that the title is written as /Title in the Info dict and the trailer gains an /Info reference.
  it('/Title が Info dict に含まれる', () => {
    const { text } = generatePdf({ title: 'Test Report' })
    expect(text).toContain('/Title (Test Report)')
    expect(text).toContain('/Info ')
  })

  it('PDF 2.0 writes non-ASCII text strings as UTF-8 with EF BB BF', () => {
    const backend = new PdfBackend({ fonts: {}, pdfVersion: '2.0', metadata: { title: '日本語' } })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    const pdf = parsePdf(bytes)
    const info = pdf.resolve(pdf.trailer.get('Info') ?? null) as Map<string, unknown>
    const title = pdf.resolve(info.get('Title') as never) as { bytes: Uint8Array }
    expect(title.bytes.subarray(0, 6)).toEqual(new Uint8Array([0xEF, 0xBB, 0xBF, 0xE6, 0x97, 0xA5]))
  })

  // Verifies that the author metadata field is written as /Author in the Info dict.
  it('/Author が Info dict に含まれる', () => {
    const { text } = generatePdf({ author: 'John Doe' })
    expect(text).toContain('/Author (John Doe)')
  })

  // Verifies that the subject metadata field is written as /Subject in the Info dict.
  it('/Subject が Info dict に含まれる', () => {
    const { text } = generatePdf({ subject: 'Monthly Sales Report' })
    expect(text).toContain('/Subject (Monthly Sales Report)')
  })

  // Verifies that the keywords metadata field is written as /Keywords in the Info dict.
  it('/Keywords が Info dict に含まれる', () => {
    const { text } = generatePdf({ keywords: 'report, sales, monthly' })
    expect(text).toContain('/Keywords (report, sales, monthly)')
  })

  // Verifies that the creator metadata field is written as /Creator in the Info dict.
  it('/Creator が Info dict に含まれる', () => {
    const { text } = generatePdf({ creator: 'tsreport v1.0' })
    expect(text).toContain('/Creator (tsreport v1.0)')
  })

  // Verifies that the producer metadata field is written as /Producer in the Info dict.
  it('/Producer が Info dict に含まれる', () => {
    const { text } = generatePdf({ producer: 'tsreport PDF Engine' })
    expect(text).toContain('/Producer (tsreport PDF Engine)')
  })

  // Verifies that /CreationDate is serialized in the PDF date format (D:YYYYMMDDHHMMSS + timezone).
  it('/CreationDate が PDF 日付形式で含まれる', () => {
    const date = new Date('2026-01-15T10:30:00Z')
    const { text } = generatePdf({ creationDate: date })
    // D:YYYYMMDDHHMMSS+HH'mm' or D:YYYYMMDDHHMMSSZ
    expect(text).toMatch(/\/CreationDate \(D:\d{14}[Z+\-]/)
  })

  // Verifies that /ModDate is serialized in the PDF date format.
  it('/ModDate が PDF 日付形式で含まれる', () => {
    const date = new Date('2026-02-20T15:45:00Z')
    const { text } = generatePdf({ modDate: date })
    expect(text).toMatch(/\/ModDate \(D:\d{14}[Z+\-]/)
  })

  // Verifies that the trapping state is written as a PDF name in the Info dict.
  it('/Trapped が Info dict に含まれる', () => {
    const { text } = generatePdf({ trapped: 'unknown' })
    expect(text).toContain('/Trapped /Unknown')
  })

  // Verifies that all eight Info dict entries are emitted when every metadata field is provided.
  it('全フィールド指定時に全エントリが含まれる', () => {
    const { text } = generatePdf({
      title: 'Full Test',
      author: 'Author',
      subject: 'Subject',
      keywords: 'test',
      creator: 'Creator',
      producer: 'Producer',
      creationDate: new Date('2026-01-01T00:00:00Z'),
      modDate: new Date('2026-01-02T00:00:00Z'),
    })
    expect(text).toContain('/Title (Full Test)')
    expect(text).toContain('/Author (Author)')
    expect(text).toContain('/Subject (Subject)')
    expect(text).toContain('/Keywords (test)')
    expect(text).toContain('/Creator (Creator)')
    expect(text).toContain('/Producer (Producer)')
    expect(text).toContain('/CreationDate (D:')
    expect(text).toContain('/ModDate (D:')
  })

  // Verifies that parentheses and backslashes in string values are escaped per PDF literal-string syntax.
  it('特殊文字がエスケープされる', () => {
    const { text } = generatePdf({ title: 'Title (with) parens & backslash\\' })
    expect(text).toContain('/Title (Title \\(with\\) parens & backslash\\\\)')
  })

  // Verifies that the trailer references the Info dict as an indirect object.
  it('trailer に /Info 参照が含まれる', () => {
    const { text } = generatePdf({ title: 'Trailer Test' })
    expect(text).toMatch(/\/Info \d+ 0 R/)
  })

  it('custom Info entries are emitted as PDF values', () => {
    const date = new Date('2026-07-08T10:20:30Z')
    const { bytes, text } = generatePdf({
      title: 'Standard title',
      custom: {
        WorkflowId: 'WF-42',
        Revision: 7,
        Reviewed: true,
        ReviewDate: date,
        ApprovalState: { type: 'name', value: 'Approved' },
        'Cost Center': 'A-100',
        Title: 'Ignored custom title',
      },
    })
    expect(text).toContain('/WorkflowId (WF-42)')
    expect(text).toContain('/Revision 7')
    expect(text).toContain('/Reviewed true')
    expect(text).toMatch(/\/ReviewDate \(D:\d{14}[Z+\-]/)
    expect(text).toContain('/ApprovalState /Approved')
    expect(text).toContain('/Cost#20Center (A-100)')
    expect(text).toContain('/Title (Standard title)')
    expect(text).not.toContain('Ignored custom title')

    const doc = parsePdf(bytes)
    const infoRef = doc.trailer.get('Info')
    expect(infoRef).toBeInstanceOf(PdfRef)
    const info = doc.resolve(infoRef ?? null)
    expect(info).toBeInstanceOf(Map)
    const infoDict = info as Map<string, unknown>
    expect(infoDict.get('WorkflowId')).toHaveProperty('bytes')
    expect(infoDict.get('Revision')).toBe(7)
    expect(infoDict.get('Reviewed')).toBe(true)
    expect(infoDict.get('ApprovalState')).toMatchObject({ name: 'Approved' })
    expect(infoDict.get('Cost Center')).toHaveProperty('bytes')
  })
})

describe('PDF Catalog viewer options', () => {
  function generateCatalogPdf(): Uint8Array {
    const backend = new PdfBackend({
      fonts: {},
      pageMode: 'UseOC',
      pageLayout: 'TwoPageRight',
      viewerPreferences: {
        hideToolbar: true,
        hideMenubar: true,
        hideWindowUI: false,
        fitWindow: true,
        centerWindow: true,
        displayDocTitle: true,
        nonFullScreenPageMode: 'UseOutlines',
        direction: 'R2L',
        viewArea: 'CropBox',
        viewClip: 'TrimBox',
        printArea: 'BleedBox',
        printClip: 'ArtBox',
        printScaling: 'None',
        duplex: 'DuplexFlipLongEdge',
        pickTrayByPDFSize: true,
        printPageRange: [1, 2, 5, 8],
        numCopies: 3,
      },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 20, 20, { fill: '#000000' })
    backend.endPage()
    backend.endDocument()
    return backend.toUint8Array()
  }

  it('emits PageMode, PageLayout, and ViewerPreferences in the catalog', () => {
    const bytes = generateCatalogPdf()
    const text = pdfToText(bytes)
    expect(text).toContain('/PageMode /UseOC')
    expect(text).toContain('/PageLayout /TwoPageRight')
    expect(text).toContain('/ViewerPreferences <<')
    expect(text).toContain('/HideToolbar true')
    expect(text).toContain('/HideMenubar true')
    expect(text).toContain('/HideWindowUI false')
    expect(text).toContain('/FitWindow true')
    expect(text).toContain('/CenterWindow true')
    expect(text).toContain('/DisplayDocTitle true')
    expect(text).toContain('/NonFullScreenPageMode /UseOutlines')
    expect(text).toContain('/Direction /R2L')
    expect(text).toContain('/ViewArea /CropBox')
    expect(text).toContain('/ViewClip /TrimBox')
    expect(text).toContain('/PrintArea /BleedBox')
    expect(text).toContain('/PrintClip /ArtBox')
    expect(text).toContain('/PrintScaling /None')
    expect(text).toContain('/Duplex /DuplexFlipLongEdge')
    expect(text).toContain('/PickTrayByPDFSize true')
    expect(text).toContain('/PrintPageRange [1 2 5 8]')
    expect(text).toContain('/NumCopies 3')

    const catalog = parsePdf(bytes).getCatalog()
    expect(catalog.get('PageMode')).toMatchObject({ name: 'UseOC' })
    expect(catalog.get('PageLayout')).toMatchObject({ name: 'TwoPageRight' })
    const prefs = catalog.get('ViewerPreferences')
    expect(prefs).toBeInstanceOf(Map)
    expect((prefs as Map<string, unknown>).get('PrintScaling')).toMatchObject({ name: 'None' })
    expect((prefs as Map<string, unknown>).get('PrintPageRange')).toEqual([1, 2, 5, 8])
  })

  it('importMetadata and importPageDisplay read Info and display settings back', () => {
    const backend = new PdfBackend({
      fonts: {},
      pageMode: 'UseOutlines',
      pageLayout: 'TwoColumnLeft',
      metadata: {
        title: '請求書', author: '経理部', subject: '2026年7月', keywords: 'invoice,月次',
        creator: 'tsreport', producer: 'tsreport-core',
        creationDate: new Date(Date.UTC(2026, 6, 11)), trapped: false,
        custom: { Department: 'Sales', Revision: 3 },
      },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const importer = PdfImporter.open(backend.toUint8Array())
    const meta = importer.importMetadata()!
    expect(meta.title).toBe('請求書')
    expect(meta.author).toBe('経理部')
    expect(meta.subject).toBe('2026年7月')
    expect(meta.keywords).toBe('invoice,月次')
    expect(meta.creator).toBe('tsreport')
    expect(meta.producer).toBe('tsreport-core')
    expect(meta.creationDate).toMatch(/^D:20260711/)
    expect(meta.trapped).toBe('False')
    expect(meta.custom).toEqual({ Department: 'Sales', Revision: 3 })
    expect(importer.importPageDisplay()).toEqual({ pageMode: 'UseOutlines', pageLayout: 'TwoColumnLeft' })
  })

  it('importViewerPreferences reads every preference back', () => {
    const prefs = PdfImporter.open(generateCatalogPdf()).importViewerPreferences()!
    expect(prefs).toEqual({
      hideToolbar: true,
      hideMenubar: true,
      hideWindowUI: false,
      fitWindow: true,
      centerWindow: true,
      displayDocTitle: true,
      pickTrayByPDFSize: true,
      nonFullScreenPageMode: 'UseOutlines',
      direction: 'R2L',
      viewArea: 'CropBox',
      viewClip: 'TrimBox',
      printArea: 'BleedBox',
      printClip: 'ArtBox',
      printScaling: 'None',
      duplex: 'DuplexFlipLongEdge',
      printPageRange: [1, 2, 5, 8],
      numCopies: 3,
    })
  })

  it('lets explicit PageMode override the outline default', () => {
    const backend = new PdfBackend({ fonts: {}, pageMode: 'UseThumbs' })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.setBookmarks([{ label: 'Chapter', level: 1, pageIndex: 0, y: 10 }])
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/Outlines ')
    expect(text).toContain('/PageMode /UseThumbs')
    expect(text).not.toContain('/PageMode /UseOutlines')
  })

  it('round-trips the independent catalog dictionaries and actions', () => {
    const uriBytes = new TextEncoder().encode('https://example.test/base/')
    const actionUri = new TextEncoder().encode('https://example.test/close')
    const identifier = new Uint8Array([0x10, 0x20, 0x30, 0x40])
    const capturedAt = new Date('2026-07-14T00:00:00.000Z')
    const backend = new PdfBackend({
      fonts: {},
      javaScript: [{ name: 'checkRequirement', script: 'void 0;' }],
      catalog: {
        uri: {
          base: uriBytes,
          entries: { IsMap: true },
        },
        language: 'ja-JP',
        spiderInfo: {
          version: 1,
          commands: [{ url: 'https://example.test/report', levels: 2, flags: 3 }],
          contentSets: [{
            kind: 'page', identifier,
            objects: [{ kind: 'page', pageIndex: 0, preferredZoom: 1.25 }],
            sources: { urls: 'https://example.test/report', commandIndex: 0, timestamp: capturedAt },
            urls: ['https://example.test/report'],
            contentType: 'text/html', createdAt: capturedAt, title: 'Captured report',
          }],
        },
        markInfo: { UserProperties: true, Suspects: false },
        legal: { Attestation: { kind: 'string', bytes: new TextEncoder().encode('Reviewed') } },
        requirements: [{
          type: 'EnableJavaScripts',
          handlers: [{ type: 'JS', script: 'checkRequirement' }, { type: 'NoOp' }],
        }],
        permissions: { UR3: { kind: 'dictionary', entries: { Type: { kind: 'name', value: 'UR' } } } },
        additionalActions: { WC: { subtype: 'URI', entries: { URI: { kind: 'string', bytes: actionUri } } } },
      },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const imported = PdfImporter.open(backend.toUint8Array()).importCatalogModel()
    expect(imported).toEqual({
      uri: { base: uriBytes, entries: { IsMap: true } },
      language: 'ja-JP',
      spiderInfo: {
        version: 1,
        commands: [{ url: 'https://example.test/report', levels: 2, flags: 3 }],
        contentSets: [{
          kind: 'page', identifier,
          objects: [{ kind: 'page', pageIndex: 0, preferredZoom: 1.25 }],
          sources: { urls: 'https://example.test/report', commandIndex: 0, timestamp: capturedAt },
          urls: ['https://example.test/report'],
          contentType: 'text/html', createdAt: capturedAt, title: 'Captured report',
        }],
        images: {},
      },
      markInfo: { UserProperties: true, Suspects: false },
      legal: { Attestation: { kind: 'string', bytes: new TextEncoder().encode('Reviewed') } },
      requirements: [{
        type: 'EnableJavaScripts',
        handlers: [{ type: 'JS', script: 'checkRequirement' }, { type: 'NoOp' }],
      }],
      permissions: { UR3: { kind: 'dictionary', entries: { Type: { kind: 'name', value: 'UR' } } } },
      additionalActions: { WC: { subtype: 'URI', entries: { URI: { kind: 'string', bytes: actionUri } } } },
    })

    const rewritten = new PdfBackend({
      fonts: {}, catalog: imported,
      javaScript: [{ name: 'checkRequirement', script: 'void 0;' }],
    })
    rewritten.beginDocument()
    rewritten.beginPage(100, 100)
    rewritten.endPage()
    rewritten.endDocument()
    expect(PdfImporter.open(rewritten.toUint8Array()).importCatalogModel()).toEqual(imported)
  })

  it('round-trips every PDF 2.0 document requirement type and all common entries', () => {
    const types = [
      'OCInteract', 'OCAutoStates', 'AcroFormInteract', 'Navigation', 'Markup', '3DMarkup',
      'Multimedia', 'U3D', 'PRC', 'Action', 'EnableJavaScripts', 'Attachment', 'AttachmentEditing',
      'Collection', 'CollectionEditing', 'DigSigValidation', 'DigSig', 'DigSigMDP', 'RichMedia',
      'Geospatial2D', 'Geospatial3D', 'DPartInteract', 'SeparationSimulation', 'Transitions', 'Encryption',
    ] as const
    const requirements = types.map(function (type, index) {
      return {
        type,
        version: type === 'PRC' ? { Edition: 1 } : '2.0',
        penalty: index % 101,
        handlers: index === 0
          ? [{ type: 'JS' as const, script: 'requirements' }, { type: 'NoOp' as const }]
          : [] as const,
        ...(type === 'Encryption' ? {
          encryption: { Filter: { kind: 'name' as const, value: 'Standard' }, V: 4, Length: 128 },
        } : {}),
        ...(type === 'DigSig' || type === 'DigSigValidation' || type === 'DigSigMDP' ? {
          digitalSignature: { Type: { kind: 'name' as const, value: 'Sig' }, Filter: { kind: 'name' as const, value: 'Example' } },
        } : {}),
      }
    })
    const backend = new PdfBackend({
      fonts: {}, javaScript: [{ name: 'requirements', script: 'void 0;' }],
      catalog: { requirements },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    expect(PdfImporter.open(bytes).importCatalogModel().requirements).toEqual(requirements)
  })

  it('keeps Web Capture page/image ownership and URL/ID name-tree object identity connected', () => {
    const identifier = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD])
    const jpeg = new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'images', 'cmyk-plain.jpg')))
    const spiderInfo = {
      version: 1 as const,
      commands: [{
        url: 'https://example.test/source', levels: 1, flags: 4,
        postedData: { kind: 'string' as const, bytes: new TextEncoder().encode('a=1') },
        contentType: 'application/x-www-form-urlencoded',
        headers: new TextEncoder().encode('Accept: image/jpeg'),
        settings: { global: { Quality: 90 }, converters: { HTML: { Enabled: true } } },
      }],
      contentSets: [{
        kind: 'page' as const, identifier,
        objects: [{ kind: 'page' as const, pageIndex: 0, preferredZoom: 2 }],
        sources: {
          urls: { destinationUrl: 'https://example.test/source', chains: [['https://example.test/start']] },
          submission: 2 as const, commandIndex: 0,
        },
        urls: ['https://example.test/source'], contentType: 'text/html', title: 'Source page',
      }, {
        kind: 'image' as const, identifier,
        objects: [{ kind: 'image' as const, imageId: 'capture' }],
        sources: { urls: 'https://example.test/source' },
        urls: ['https://example.test/source'], contentType: 'image/jpeg', referenceCounts: 1,
      }],
    }
    const backend = new PdfBackend({ fonts: {}, images: { capture: jpeg }, catalog: { spiderInfo } })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const imported = PdfImporter.open(bytes).importCatalogModel().spiderInfo!
    expect(imported.commands).toEqual(spiderInfo.commands)
    expect(imported.contentSets[0]).toEqual(spiderInfo.contentSets[0])
    expect(imported.contentSets[1]!.kind).toBe('image')
    expect(imported.contentSets[1]!.identifier).toEqual(identifier)
    expect(imported.contentSets[1]!.urls).toEqual(['https://example.test/source'])
    expect(Object.keys(imported.images)).toEqual(['webcapture1_0.png'])

    const rewritten = new PdfBackend({ fonts: {}, images: imported.images, catalog: { spiderInfo: imported } })
    rewritten.beginDocument()
    rewritten.beginPage(100, 100)
    rewritten.endPage()
    rewritten.endDocument()
    const reimported = PdfImporter.open(rewritten.toUint8Array()).importCatalogModel().spiderInfo!
    expect(reimported.commands).toEqual(imported.commands)
    expect(reimported.contentSets).toEqual(imported.contentSets)
    expect(reimported.images).toEqual(imported.images)
  })

  it('merges tagged MarkInfo and rejects conflicting document languages', () => {
    const backend = new PdfBackend({ fonts: {}, catalog: { markInfo: { Suspects: false } } })
    backend.beginDocument()
    backend.setTagged('ja-JP')
    backend.beginPage(100, 100)
    backend.beginTaggedContent({ role: 'P' })
    backend.endTaggedContent()
    backend.endPage()
    backend.endDocument()
    expect(PdfImporter.open(backend.toUint8Array()).importCatalogModel().markInfo).toEqual({ Suspects: false, Marked: true })

    const conflicting = new PdfBackend({ fonts: {}, catalog: { language: 'en-US' } })
    conflicting.beginDocument()
    conflicting.setTagged('ja-JP')
    conflicting.beginPage(100, 100)
    conflicting.endPage()
    conflicting.endDocument()
    expect(() => conflicting.toUint8Array()).toThrow(/language conflicts/)
  })
})

describe('PDF page labels', () => {
  it('emits PageLabels number tree in the catalog', () => {
    const backend = new PdfBackend({
      fonts: {},
      pageLabels: [
        { pageIndex: 0, style: 'r', prefix: 'front-', start: 1 },
        { pageIndex: 2, style: 'D', prefix: 'body-', start: 10 },
      ],
    })
    backend.beginDocument()
    for (let i = 0; i < 3; i++) {
      backend.beginPage(100, 100)
      backend.drawRect(10, 10, 20, 20, { fill: '#000000' })
      backend.endPage()
    }
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/PageLabels << /Nums [0 << /S /r /P (front-) /St 1 >> 2 << /S /D /P (body-) /St 10 >>] >>')

    const pageLabels = parsePdf(bytes).getCatalog().get('PageLabels')
    expect(pageLabels).toBeInstanceOf(Map)
    const nums = (pageLabels as Map<string, unknown>).get('Nums')
    expect(nums).toBeInstanceOf(Array)
    const values = nums as unknown[]
    expect(values[0]).toBe(0)
    expect(values[1]).toBeInstanceOf(Map)
    expect((values[1] as Map<string, unknown>).get('S')).toMatchObject({ name: 'r' })
    expect((values[1] as Map<string, unknown>).get('P')).toHaveProperty('bytes')
    expect((values[1] as Map<string, unknown>).get('St')).toBe(1)
    expect(values[2]).toBe(2)
    expect((values[3] as Map<string, unknown>).get('S')).toMatchObject({ name: 'D' })
    expect((values[3] as Map<string, unknown>).get('St')).toBe(10)
  })

  it('importPageLabels round-trips the number tree', () => {
    const backend = new PdfBackend({
      fonts: {},
      pageLabels: [
        { pageIndex: 0, style: 'r', prefix: 'front-', start: 1 },
        { pageIndex: 2, style: 'D', prefix: 'body-', start: 10 },
        { pageIndex: 5, style: 'A' },
      ],
    })
    backend.beginDocument()
    for (let i = 0; i < 6; i++) { backend.beginPage(100, 100); backend.endPage() }
    backend.endDocument()

    const labels = PdfImporter.open(backend.toUint8Array()).importPageLabels()
    expect(labels).toEqual([
      { pageIndex: 0, style: 'r', prefix: 'front-', start: 1 },
      { pageIndex: 2, style: 'D', prefix: 'body-', start: 10 },
      { pageIndex: 5, style: 'A' },
    ])
  })
})

describe('PDF catalog OpenAction', () => {
  it('emits an OpenAction XYZ destination with top-down y converted to PDF space', () => {
    const backend = new PdfBackend({
      fonts: {},
      openAction: { pageIndex: 1, fit: 'XYZ', x: 20, y: 30, zoom: 1.5 },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.beginPage(200, 300)
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/OpenAction [')
    expect(text).toContain('/XYZ 20 270 1.5]')

    const catalog = parsePdf(bytes).getCatalog()
    const action = catalog.get('OpenAction')
    expect(action).toBeInstanceOf(Array)
    const values = action as unknown[]
    expect(values[0]).toBeInstanceOf(PdfRef)
    expect(values[1]).toMatchObject({ name: 'XYZ' })
    expect(values[2]).toBe(20)
    expect(values[3]).toBe(270)
    expect(values[4]).toBe(1.5)
  })

  it('emits an OpenAction FitR destination rectangle', () => {
    const backend = new PdfBackend({
      fonts: {},
      openAction: { pageIndex: 0, fit: 'FitR', left: 10, top: 20, right: 90, bottom: 80 },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/OpenAction [')
    expect(text).toContain('/FitR 10 20 90 80]')
  })

  it('importOpenAction round-trips the destination page and y', () => {
    const backend = new PdfBackend({
      fonts: {},
      openAction: { pageIndex: 1, fit: 'XYZ', x: 20, y: 30, zoom: 1.5 },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.beginPage(200, 300)
    backend.endPage()
    backend.endDocument()

    const action = PdfImporter.open(backend.toUint8Array()).importOpenAction()
    expect(action).not.toBeNull()
    expect(action!.pageIndex).toBe(1)
    expect(action!.y).toBeCloseTo(30, 5)
  })
})

describe('PDF named destinations', () => {
  it('emits anchor entries as Catalog Names/Dests', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.beginPage(200, 300)
    backend.endPage()
    backend.setAnchors([
      { name: 'chapter-2', pageIndex: 1, y: 30 },
      { name: 'chapter-1', pageIndex: 0, y: 10 },
    ])
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/Names << /Dests << /Names [')
    expect(text).toContain('(chapter-1)')
    expect(text).toContain('/XYZ 0 90 null')
    expect(text).toContain('(chapter-2)')
    expect(text).toContain('/XYZ 0 270 null')

    const catalog = parsePdf(bytes).getCatalog()
    const names = catalog.get('Names')
    expect(names).toBeInstanceOf(Map)
    const dests = (names as Map<string, unknown>).get('Dests')
    expect(dests).toBeInstanceOf(Map)
    const destNames = (dests as Map<string, unknown>).get('Names')
    expect(destNames).toBeInstanceOf(Array)
    const values = destNames as unknown[]
    expect(values[0]).toHaveProperty('bytes')
    expect(values[1]).toBeInstanceOf(Array)
    expect((values[1] as unknown[])[1]).toMatchObject({ name: 'XYZ' })
    expect((values[1] as unknown[])[3]).toBe(90)
    expect(values[2]).toHaveProperty('bytes')
    expect((values[3] as unknown[])[3]).toBe(270)
  })

  it('round-trips additional name and number trees through the generic public model', () => {
    const backend = new PdfBackend({
      fonts: {},
      nameTrees: {
        AP: [
          { name: 'zeta', value: { kind: 'dictionary', entries: { N: 2 } } },
          { name: 'alpha', value: { kind: 'stream', entries: { Type: { kind: 'name', value: 'Metadata' } }, data: new Uint8Array([1, 2, 3]) } },
        ],
      },
      numberTrees: {
        CustomIndex: [
          { key: 9, value: { kind: 'string', bytes: new TextEncoder().encode('nine') } },
          { key: 2, value: { kind: 'name', value: 'Second' } },
        ],
      },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const importer = PdfImporter.open(backend.toUint8Array())
    const names = importer.importNameTree('AP')
    const numbers = importer.importNumberTree('CustomIndex')
    expect(names).toEqual([
      { name: 'alpha', value: { kind: 'stream', entries: { Type: { kind: 'name', value: 'Metadata' }, Length: 3 }, data: new Uint8Array([1, 2, 3]) } },
      { name: 'zeta', value: { kind: 'dictionary', entries: { N: 2 } } },
    ])
    expect(numbers).toEqual([
      { key: 2, value: { kind: 'name', value: 'Second' } },
      { key: 9, value: { kind: 'string', bytes: new TextEncoder().encode('nine') } },
    ])

    const rewritten = new PdfBackend({ fonts: {}, nameTrees: { AP: names }, numberTrees: { CustomIndex: numbers } })
    rewritten.beginDocument()
    rewritten.beginPage(100, 100)
    rewritten.endPage()
    rewritten.endDocument()
    const importedAgain = PdfImporter.open(rewritten.toUint8Array())
    expect(importedAgain.importNameTree('AP').map((entry) => entry.name)).toEqual(['alpha', 'zeta'])
    expect(importedAgain.importNumberTree('CustomIndex')).toEqual(numbers)
  })
})

describe('PDF embedded files', () => {
  it('emits file specifications through Catalog Names/EmbeddedFiles', () => {
    const backend = new PdfBackend({
      fonts: {},
      embeddedFiles: [
        {
          name: 'data.json',
          data: new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d]),
          description: 'Source data',
          mimeType: 'application/json',
          creationDate: new Date('2026-01-02T03:04:05Z'),
          modificationDate: new Date('2026-01-03T04:05:06Z'),
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/Names << /EmbeddedFiles << /Names [(data.json)')
    expect(text).toContain('/Type /Filespec')
    expect(text).toContain('/Type /EmbeddedFile')
    expect(text).toContain('/Subtype /application#2Fjson')
    expect(text).toContain('/Params << /Size 7 /CreationDate (D:20260102')
    expect(text).toContain('/ModDate (D:20260103')

    const doc = parsePdf(bytes)
    const names = doc.getCatalog().get('Names')
    expect(names).toBeInstanceOf(Map)
    const embeddedFiles = (names as Map<string, unknown>).get('EmbeddedFiles')
    expect(embeddedFiles).toBeInstanceOf(Map)
    const nameArray = (embeddedFiles as Map<string, unknown>).get('Names')
    expect(nameArray).toBeInstanceOf(Array)
    const entries = nameArray as unknown[]
    expect(latin1((entries[0] as { bytes: Uint8Array }).bytes)).toBe('data.json')
    const spec = doc.resolve(entries[1] as never)
    expect(spec).toBeInstanceOf(Map)
    expect(latin1((doc.resolve((spec as Map<string, unknown>).get('F') as never) as { bytes: Uint8Array }).bytes)).toBe('data.json')
    expect(latin1((doc.resolve((spec as Map<string, unknown>).get('Desc') as never) as { bytes: Uint8Array }).bytes)).toBe('Source data')
    const ef = doc.resolve((spec as Map<string, unknown>).get('EF') as never)
    expect(ef).toBeInstanceOf(Map)
    const stream = doc.resolve((ef as Map<string, unknown>).get('F') as never)
    expect(stream).toBeInstanceOf(PdfStream)
    const subtype = (stream as PdfStream).dict.get('Subtype')
    expect(subtype).toMatchObject({ name: 'application/json' })
    const params = (stream as PdfStream).dict.get('Params')
    expect(params).toBeInstanceOf(Map)
    expect((params as Map<string, unknown>).get('Size')).toBe(7)
    expect(doc.decodeStream(stream as PdfStream)).toEqual(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d]))
  })

  it('references associated files from the Catalog /AF with /AFRelationship (PDF 2.0)', () => {
    const backend = new PdfBackend({
      fonts: {},
      embeddedFiles: [
        { name: 'report-source.csv', data: new Uint8Array([1, 2, 3]), relationship: 'Data' },
        { name: 'plain.txt', data: new Uint8Array([4, 5]) }, // no relationship -> not in /AF
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    expect(pdfToText(bytes)).toContain('/AFRelationship /Data')

    const doc = parsePdf(bytes)
    const af = doc.resolve(doc.getCatalog().get('AF') ?? null)
    expect(af).toBeInstanceOf(Array)
    // Only the file with a relationship is in /AF.
    expect((af as unknown[]).length).toBe(1)
    const spec = doc.resolve((af as unknown[])[0] as never) as Map<string, unknown>
    expect(spec.get('AFRelationship')).toMatchObject({ name: 'Data' })
    expect(latin1((doc.resolve(spec.get('F') as never) as { bytes: Uint8Array }).bytes)).toBe('report-source.csv')
  })

  it('round-trips every embedded-file parameter including checksum and Mac resource fork', () => {
    const checksum = new Uint8Array([241, 139, 235, 68, 219, 87, 71, 8, 92, 127, 188, 138, 147, 211, 160, 80])
    const resourceFork = new Uint8Array([82, 83, 82, 67])
    const backend = new PdfBackend({
      fonts: {},
      embeddedFiles: [{
        name: 'legacy.bin',
        data: new Uint8Array([1, 3, 5, 7]),
        creationDate: new Date('2026-07-13T01:02:03Z'),
        modificationDate: new Date('2026-07-14T04:05:06Z'),
        checksum,
        mac: { subtype: 'BINA', creator: 'TSRP', resourceFork },
        relationship: 'Supplement',
      }],
    })
    backend.beginDocument(); backend.beginPage(100, 100); backend.endPage(); backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/CheckSum <F18BEB44DB5747085C7FBC8A93D3A050>')
    expect(text).toMatch(/\/Mac << \/Subtype <42494E41> \/Creator <54535250> \/ResFork \d+ 0 R >>/)
    const file = PdfImporter.open(bytes).importEmbeddedFiles()[0]!
    expect(file.checksum).toEqual(checksum)
    expect(file.mac).toEqual({ subtype: 'BINA', creator: 'TSRP', resourceFork })
    expect(file.relationship).toBe('Supplement')

    const rewritten = new PdfBackend({ fonts: {}, embeddedFiles: [file] })
    rewritten.beginDocument(); rewritten.beginPage(100, 100); rewritten.endPage(); rewritten.endDocument()
    expect(PdfImporter.open(rewritten.toUint8Array()).importEmbeddedFiles()[0]).toEqual(file)
  })

  it('importEmbeddedFiles round-trips name, bytes, description, MIME type, and /AFRelationship', () => {
    const backend = new PdfBackend({
      fonts: {},
      embeddedFiles: [
        { name: 'source.csv', data: new Uint8Array([1, 2, 3, 4]), description: 'Report data', mimeType: 'text/csv', relationship: 'Data' },
        { name: 'notes.txt', data: new Uint8Array([65, 66]) },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const files = PdfImporter.open(backend.toUint8Array()).importEmbeddedFiles()
    expect(files.length).toBe(2)
    const src = files.find(f => f.name === 'source.csv')!
    expect(src.data).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(src.description).toBe('Report data')
    expect(src.mimeType).toBe('text/csv')
    expect(src.relationship).toBe('Data')
    const notes = files.find(f => f.name === 'notes.txt')!
    expect(notes.data).toEqual(new Uint8Array([65, 66]))
    expect(notes.relationship).toBeUndefined()
  })

  it('importAssociatedFiles reads the catalog /AF array (PDF 2.0)', () => {
    const backend = new PdfBackend({
      fonts: {},
      embeddedFiles: [
        { name: 'source.csv', data: new Uint8Array([1, 2, 3]), relationship: 'Data' },
        { name: 'plain.txt', data: new Uint8Array([9]) }, // no relationship -> not in /AF
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const af = PdfImporter.open(backend.toUint8Array()).importAssociatedFiles()
    expect(af.length).toBe(1)
    expect(af[0]!.name).toBe('source.csv')
    expect(af[0]!.relationship).toBe('Data')
    expect(af[0]!.data).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('PDF JavaScript name tree', () => {
  it('emits document JavaScript actions through Catalog Names/JavaScript', () => {
    const backend = new PdfBackend({
      fonts: {},
      javaScript: [
        { name: 'doc-ready', script: 'app.alert("ready");' },
      ],
      embeddedFiles: [
        { name: 'readme.txt', data: new Uint8Array([82]) },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.setAnchors([{ name: 'start', pageIndex: 0, y: 0 }])
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/Names << /Dests << /Names [(start)')
    expect(text).toContain('/JavaScript << /Names [(doc-ready) << /S /JavaScript /JS (app.alert\\("ready"\\);) >>] >>')
    expect(text).toContain('/EmbeddedFiles << /Names [(readme.txt)')

    const catalogNames = parsePdf(bytes).getCatalog().get('Names')
    expect(catalogNames).toBeInstanceOf(Map)
    const javaScript = (catalogNames as Map<string, unknown>).get('JavaScript')
    expect(javaScript).toBeInstanceOf(Map)
    const values = (javaScript as Map<string, unknown>).get('Names')
    expect(values).toBeInstanceOf(Array)
    const names = values as unknown[]
    expect(latin1((names[0] as { bytes: Uint8Array }).bytes)).toBe('doc-ready')
    const action = names[1]
    expect(action).toBeInstanceOf(Map)
    expect((action as Map<string, unknown>).get('S')).toMatchObject({ name: 'JavaScript' })
    expect(latin1(((action as Map<string, unknown>).get('JS') as { bytes: Uint8Array }).bytes)).toBe('app.alert("ready");')
  })

  it('importJavaScript round-trips document-level JavaScript actions', () => {
    const backend = new PdfBackend({
      fonts: {},
      javaScript: [
        { name: 'doc-ready', script: 'app.alert("ready");' },
        { name: 'calc', script: 'event.value = 1 + 2;' },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const scripts = PdfImporter.open(backend.toUint8Array()).importJavaScript()
    expect(scripts).toEqual([
      { name: 'calc', script: 'event.value = 1 + 2;' },
      { name: 'doc-ready', script: 'app.alert("ready");' },
    ])
  })
})

describe('PDF collection dictionary', () => {
  it('emits a collection schema, sort dictionary, and file collection item', () => {
    const backend = new PdfBackend({
      fonts: {},
      collection: {
        schema: [
          { key: 'title', name: 'Title', subtype: 'S', order: 1, visible: true, editable: false },
          { key: 'issued', name: 'Issued', subtype: 'D', order: 2 },
          { key: 'amount', name: 'Amount', subtype: 'N', order: 3 },
        ],
        initialDocument: 'invoice.json',
        view: 'D',
        sort: { keys: ['issued', 'title'], ascending: [false, true] },
      },
      embeddedFiles: [
        {
          name: 'invoice.json',
          data: new Uint8Array([123, 125]),
          collectionItem: {
            title: 'Invoice',
            issued: new Date('2026-02-03T04:05:06Z'),
            amount: { value: 42.5, prefix: '$' },
          },
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/Collection << /Type /Collection')
    expect(text).toContain('/Schema << /Type /CollectionSchema /title << /Type /CollectionField /Subtype /S /N (Title) /O 1 /V true /E false >>')
    expect(text).toContain('/D (invoice.json)')
    expect(text).toContain('/View /D')
    expect(text).toContain('/Sort << /Type /CollectionSort /S [/issued /title] /A [false true] >>')
    expect(text).toContain('/CI << /Type /CollectionItem /amount << /Type /CollectionSubitem /D 42.5 /P ($) >> /issued (D:20260203')
    expect(text).toContain('/title (Invoice) >>')

    const doc = parsePdf(bytes)
    const collection = doc.resolve(doc.getCatalog().get('Collection') ?? null)
    expect(collection).toBeInstanceOf(Map)
    expect((collection as Map<string, unknown>).get('Type')).toMatchObject({ name: 'Collection' })
    const schema = (collection as Map<string, unknown>).get('Schema')
    expect(schema).toBeInstanceOf(Map)
    const titleField = (schema as Map<string, unknown>).get('title')
    expect(titleField).toBeInstanceOf(Map)
    expect((titleField as Map<string, unknown>).get('Subtype')).toMatchObject({ name: 'S' })
    expect((titleField as Map<string, unknown>).get('O')).toBe(1)
    expect((titleField as Map<string, unknown>).get('V')).toBe(true)
    expect((titleField as Map<string, unknown>).get('E')).toBe(false)
    const sort = (collection as Map<string, unknown>).get('Sort')
    expect(sort).toBeInstanceOf(Map)
    expect((sort as Map<string, unknown>).get('S')).toBeInstanceOf(Array)
    expect((sort as Map<string, unknown>).get('A')).toEqual([false, true])

    const names = doc.getCatalog().get('Names')
    const embeddedFiles = (names as Map<string, unknown>).get('EmbeddedFiles')
    const nameArray = (embeddedFiles as Map<string, unknown>).get('Names') as unknown[]
    const spec = doc.resolve(nameArray[1] as never) as Map<string, unknown>
    const item = spec.get('CI')
    expect(item).toBeInstanceOf(Map)
    expect(latin1(((item as Map<string, unknown>).get('title') as { bytes: Uint8Array }).bytes)).toBe('Invoice')
    const amount = (item as Map<string, unknown>).get('amount')
    expect(amount).toBeInstanceOf(Map)
    expect((amount as Map<string, unknown>).get('D')).toBe(42.5)

    const importer = PdfImporter.open(bytes)
    expect(importer.importCollection()!.sort).toEqual({ keys: ['issued', 'title'], ascending: [false, true] })
    const importedFile = importer.importEmbeddedFiles()[0]!
    expect(importedFile.collectionItem).toEqual({
      amount: { value: 42.5, prefix: '$' },
      issued: new Date('2026-02-03T04:05:06Z'),
      title: 'Invoice',
    })
  })

  it('importCollection round-trips the schema, initial document, and view', () => {
    const backend = new PdfBackend({
      fonts: {},
      collection: {
        schema: [
          { key: 'title', name: 'Title', subtype: 'S', order: 1, visible: true, editable: false },
          { key: 'amount', name: 'Amount', subtype: 'N', order: 2 },
        ],
        initialDocument: 'invoice.json',
        view: 'T',
      },
      embeddedFiles: [{ name: 'invoice.json', data: new Uint8Array([123, 125]) }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const coll = PdfImporter.open(backend.toUint8Array()).importCollection()
    expect(coll).not.toBeNull()
    expect(coll!.initialDocument).toBe('invoice.json')
    expect(coll!.view).toBe('T')
    const title = coll!.schema.find(f => f.key === 'title')!
    expect(title).toEqual({ key: 'title', name: 'Title', subtype: 'S', order: 1, visible: true, editable: false })
    const amount = coll!.schema.find(f => f.key === 'amount')!
    expect(amount).toEqual({ key: 'amount', name: 'Amount', subtype: 'N', order: 2 })
  })

  it('round-trips PDF 2.0 navigator, colors, split, folders, thumbnails, and folder file association', () => {
    const jpeg = new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'images', 'cmyk-plain.jpg')))
    const created = new Date('2026-07-14T01:02:03Z')
    const backend = new PdfBackend({
      fonts: {}, images: { folderThumb: jpeg },
      collection: {
        schema: [
          { key: 'title', name: 'Title', subtype: 'S' },
          { key: 'date', name: 'Date', subtype: 'D' },
          { key: 'number', name: 'Number', subtype: 'N' },
          { key: 'file', name: 'File', subtype: 'F' },
          { key: 'description', name: 'Description', subtype: 'Desc' },
          { key: 'modified', name: 'Modified', subtype: 'ModDate' },
          { key: 'created', name: 'Created', subtype: 'CreationDate' },
          { key: 'size', name: 'Size', subtype: 'Size' },
          { key: 'compressed', name: 'Compressed size', subtype: 'CompressedSize' },
        ],
        initialDocument: '<1>invoice.txt', view: 'C',
        navigator: { layouts: ['FilmStrip', 'D'] },
        colors: {
          background: [0.1, 0.2, 0.3], cardBackground: [0.9, 0.8, 0.7],
          cardBorder: [0, 0, 0], primaryText: [1, 1, 1], secondaryText: [0.5, 0.5, 0.5],
        },
        sort: { keys: ['title'], ascending: [] },
        split: { direction: 'V', position: 37.5 },
        folders: {
          id: 0, name: 'Root', freeIdRanges: [[2, 9]],
          children: [{
            id: 1, name: 'Invoices', description: 'Issued invoices',
            creationDate: created, modificationDate: created,
            collectionItem: { title: 'Folder title' }, thumbnailImageId: 'folderThumb',
          }],
        },
      },
      embeddedFiles: [{ name: 'invoice.txt', data: new TextEncoder().encode('invoice'), folderId: 1, collectionItem: { title: 'Invoice' } }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    const importer = PdfImporter.open(bytes)
    const collection = importer.importCollection()!
    expect(collection.navigator).toEqual({ layouts: ['FilmStrip', 'D'] })
    expect(collection.schema.map(function (field) { return field.subtype })).toEqual([
      'S', 'D', 'N', 'F', 'Desc', 'ModDate', 'CreationDate', 'Size', 'CompressedSize',
    ])
    expect(collection.colors).toEqual({
      background: [0.1, 0.2, 0.3], cardBackground: [0.9, 0.8, 0.7],
      cardBorder: [0, 0, 0], primaryText: [1, 1, 1], secondaryText: [0.5, 0.5, 0.5],
    })
    expect(collection.split).toEqual({ direction: 'V', position: 37.5 })
    expect(collection.folders).toMatchObject({
      id: 0, name: 'Root', freeIdRanges: [[2, 9]],
      children: [{
        id: 1, name: 'Invoices', description: 'Issued invoices', creationDate: created,
        modificationDate: created, collectionItem: { title: 'Folder title' },
        thumbnailImageId: 'collection-folder-1.png',
      }],
    })
    expect(Object.keys(collection.images)).toEqual(['collection-folder-1.png'])
    const files = importer.importEmbeddedFiles()
    expect(files[0]).toMatchObject({ name: 'invoice.txt', folderId: 1, collectionItem: { title: 'Invoice' } })

    const rewritten = new PdfBackend({ fonts: {}, images: collection.images, collection, embeddedFiles: files })
    rewritten.beginDocument()
    rewritten.beginPage(100, 100)
    rewritten.endPage()
    rewritten.endDocument()
    const second = PdfImporter.open(rewritten.toUint8Array())
    expect(second.importCollection()).toEqual(collection)
    expect(second.importEmbeddedFiles()).toEqual(files)
  })
})

describe('PDF page dictionary options', () => {
  it('importPageBoxes reads CropBox back in report top-left coordinates', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    // cropBox is given in PDF user-space (bottom-up): the bottom half.
    backend.beginPage(200, 100, { cropBox: [0, 0, 200, 50] })
    backend.endPage()
    backend.endDocument()

    const boxes = PdfImporter.open(backend.toUint8Array()).importPageBoxes(0)
    expect(boxes.mediaBox).toEqual([0, 0, 200, 100])
    // The bottom half in PDF space is y 50..100 in report top-left coordinates.
    expect(boxes.cropBox).toEqual([0, 50, 200, 100])
    expect(boxes.trimBox).toBeUndefined()
  })

  it('emits page CropBox, Rotate, and UserUnit', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 100, {
      cropBox: [10, 20, 190, 90],
      rotate: 90,
      userUnit: 2,
    })
    backend.drawRect(10, 10, 20, 20, { fill: '#000000' })
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/CropBox [10 20 190 90]')
    expect(text).toContain('/Rotate 90')
    expect(text).toContain('/UserUnit 2')

    const doc = parsePdf(bytes)
    const pages = collectPdfPages(doc)
    expect(pages).toHaveLength(1)
    const page = pages[0]!.dict
    expect(doc.resolve(page.get('CropBox') ?? null)).toEqual([10, 20, 190, 90])
    expect(doc.resolve(page.get('Rotate') ?? null)).toBe(90)
    expect(doc.resolve(page.get('UserUnit') ?? null)).toBe(2)
  })

  it('round-trips all page presentation and preservation entries through the public importer', () => {
    const backend = new PdfBackend({ fonts: {} })
    const metadataBytes = buildPdfXmpPacket({})
    backend.beginDocument()
    backend.beginPage(200, 100, {
      cropBox: [5, 5, 195, 95],
      bleedBox: [2, 2, 198, 98],
      trimBox: [10, 10, 190, 90],
      artBox: [20, 20, 180, 80],
      rotate: 180,
      userUnit: 2,
      tabs: 'S',
      duration: 12.5,
      transition: {
        style: 'Fly', duration: 1.5, dimension: 'V', motion: 'O',
        direction: 'None', scale: 0.25, rectangular: true,
      },
      viewports: [{
        Type: { kind: 'name', value: 'Viewport' },
        BBox: { kind: 'array', items: [10, 20, 80, 90] },
        Name: { kind: 'string', bytes: new TextEncoder().encode('Model') },
      }],
      additionalActionModels: {
        O: { subtype: 'Named', entries: { N: { kind: 'name', value: 'NextPage' } } },
        C: { subtype: 'Named', entries: { N: { kind: 'name', value: 'PrevPage' } } },
      },
      metadata: {
        kind: 'stream',
        entries: { Type: { kind: 'name', value: 'Metadata' }, Subtype: { kind: 'name', value: 'XML' } },
        data: metadataBytes,
      },
      pieceInfo: {
        Layout: { kind: 'dictionary', entries: { LastModified: { kind: 'string', bytes: new TextEncoder().encode('D:20260713230000+09\'00\'') } } },
      },
      lastModified: { kind: 'string', bytes: new TextEncoder().encode('D:20260713230000+09\'00\'') },
    })
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const page = collectPdfPages(parsePdf(bytes))[0]!.dict
    expect(page.has('BleedBox')).toBe(true)
    expect(page.has('TrimBox')).toBe(true)
    expect(page.has('ArtBox')).toBe(true)
    expect(page.has('VP')).toBe(true)
    expect(page.has('AA')).toBe(true)
    expect(page.has('Metadata')).toBe(true)
    expect(page.has('PieceInfo')).toBe(true)

    const properties = PdfImporter.open(bytes).importPageProperties(0)
    expect(properties).toMatchObject({
      userUnit: 2,
      rotate: 180,
      contentStreamCount: 1,
      tabs: 'S',
      duration: 12.5,
      transition: {
        style: 'Fly', duration: 1.5, dimension: 'V', motion: 'O',
        direction: 'None', scale: 0.25, rectangular: true,
      },
      viewports: [{ Type: { kind: 'name', value: 'Viewport' } }],
      additionalActionModels: {
        O: { subtype: 'Named', entries: { N: { kind: 'name', value: 'NextPage' } } },
      },
      metadata: { kind: 'stream', entries: { Type: { kind: 'name', value: 'Metadata' }, Subtype: { kind: 'name', value: 'XML' } } },
      pieceInfo: { Layout: { kind: 'dictionary' } },
      lastModified: { kind: 'string' },
    })
    expect(properties.boxes).toEqual({
      mediaBox: [0, 0, 400, 200],
      cropBox: [10, 10, 390, 190],
      bleedBox: [4, 4, 396, 196],
      trimBox: [20, 20, 380, 180],
      artBox: [40, 40, 360, 160],
    })
  })

  it('rejects invalid page presentation values instead of silently defaulting them', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    expect(() => backend.beginPage(100, 100, { userUnit: 0 })).toThrow(/UserUnit/)
    expect(() => backend.beginPage(100, 100, { duration: -1 })).toThrow(/duration/)
    expect(() => backend.beginPage(100, 100, { pieceInfo: {} })).toThrow(/LastModified/)
    expect(() => backend.beginPage(100, 100, { transition: { direction: 45 } })).toThrow(/direction/)
  })
})

describe('PDF page thumbnails', () => {
  it('renderToPdf optionsからpage thumbnailを出力する', () => {
    const doc: RenderDocument = {
      pages: [{ width: 200, height: 100, children: [] }],
    }
    const bytes = renderToPdf(doc, {
      fonts: {},
      images: { thumb: makeThumbnailPng() },
      pageOptions: [{ thumbnailImageId: 'thumb' }],
    })
    expect(pdfToText(bytes)).toContain('/Thumb ')
  })

  it('reads page options from PdfBackend in the primitive render API', () => {
    const doc: RenderDocument = {
      pages: [{ width: 200, height: 100, children: [] }],
    }
    const backend = new PdfBackend({
      fonts: {},
      images: { thumb: makeThumbnailPng() },
      pageOptions: [{ thumbnailImageId: 'thumb' }],
    })
    render(doc, backend)
    expect(pdfToText(backend.toUint8Array())).toContain('/Thumb ')
  })

  it('does not erase configured page options with explicit undefined values', () => {
    const backend = new PdfBackend({
      fonts: {},
      images: { thumb: makeThumbnailPng() },
      pageOptions: [{ thumbnailImageId: 'thumb' }],
    })
    backend.beginDocument()
    backend.beginPage(200, 100, { thumbnailImageId: undefined })
    backend.endPage()
    backend.endDocument()
    expect(pdfToText(backend.toUint8Array())).toContain('/Thumb ')
  })

  it('identifies an unavailable page thumbnail in the error', () => {
    const doc: RenderDocument = {
      pages: [{ width: 200, height: 100, children: [] }],
    }
    const backend = new PdfBackend({
      fonts: {},
      pageOptions: [{ thumbnailImageId: 'missing-thumbnail' }],
    })
    render(doc, backend)
    expect(() => backend.toUint8Array()).toThrow('PDF page thumbnail is unavailable: missing-thumbnail')
  })

  it('emits a page Thumb image XObject reference', () => {
    const backend = new PdfBackend({
      fonts: {},
      images: { thumb: makeThumbnailPng() },
    })
    backend.beginDocument()
    backend.beginPage(200, 100, { thumbnailImageId: 'thumb' })
    backend.drawRect(10, 10, 20, 20, { fill: '#000000' })
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/Thumb ')
    expect(text).toContain('/Subtype /Image')

    const doc = parsePdf(bytes)
    const pages = collectPdfPages(doc)
    const thumb = doc.resolve(pages[0]!.dict.get('Thumb') ?? null)
    expect(thumb).toBeInstanceOf(PdfStream)
    expect((thumb as PdfStream).dict.get('Subtype')).toMatchObject({ name: 'Image' })
    expect((thumb as PdfStream).dict.get('Width')).toBe(2)
    expect((thumb as PdfStream).dict.get('Height')).toBe(2)
  })
})

describe('PDF article threads', () => {
  it('emits Catalog Threads, bead dictionaries, and page bead references', () => {
    const threadMetadata = buildPdfXmpPacket({})
    const backend = new PdfBackend({
      fonts: {},
      articleThreads: [{
        info: {
          title: 'Article A',
          author: 'Editor',
          subject: 'Thread test',
          keywords: 'article,bead',
          creator: 'Thread creator', producer: 'Thread producer',
          creationDate: new Date('2026-07-14T00:00:00Z'), modDate: new Date('2026-07-14T01:00:00Z'),
          trapped: false, custom: { Edition: 2, Reviewed: true, Status: { type: 'name', value: 'Final' } },
        },
        beads: [
          { pageIndex: 0, x: 10, y: 20, width: 30, height: 40 },
          { pageIndex: 1, x: 15, y: 25, width: 35, height: 45 },
        ],
        metadata: {
          kind: 'stream',
          entries: { Type: { kind: 'name', value: 'Metadata' }, Subtype: { kind: 'name', value: 'XML' } },
          data: threadMetadata,
        },
      }],
    })
    backend.beginDocument()
    backend.beginPage(200, 100)
    backend.drawRect(10, 10, 20, 20, { fill: '#000000' })
    backend.endPage()
    backend.beginPage(300, 150)
    backend.drawRect(10, 10, 20, 20, { fill: '#000000' })
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    const text = pdfToText(bytes)
    expect(text).toContain('/Threads [')
    expect(text).toContain('/Type /Thread')
    expect(text).toContain('/Type /Bead')
    expect(text).toContain('/I << /Title (Article A) /Author (Editor) /Subject (Thread test) /Keywords (article,bead) /Creator (Thread creator)')
    expect(text).toContain('/B [')

    const doc = parsePdf(bytes)
    const catalog = doc.getCatalog()
    const threads = catalog.get('Threads')
    expect(threads).toBeInstanceOf(Array)
    const thread = doc.resolve((threads as unknown[])[0] as never)
    expect(thread).toBeInstanceOf(Map)
    const metadataStream = doc.resolve((thread as Map<string, unknown>).get('Metadata') as never)
    expect(metadataStream).toBeInstanceOf(PdfStream)
    expect(doc.decodeStream(metadataStream as PdfStream)).toEqual(threadMetadata)
    const info = (thread as Map<string, unknown>).get('I')
    expect(info).toBeInstanceOf(Map)
    expect(latin1(((info as Map<string, unknown>).get('Title') as { bytes: Uint8Array }).bytes)).toBe('Article A')
    const firstBeadRef = (thread as Map<string, unknown>).get('F')
    expect(firstBeadRef).toBeInstanceOf(PdfRef)
    const firstBead = doc.resolve(firstBeadRef as never)
    expect(firstBead).toBeInstanceOf(Map)
    expect((firstBead as Map<string, unknown>).get('Type')).toMatchObject({ name: 'Bead' })
    expect((firstBead as Map<string, unknown>).get('R')).toEqual([10, 40, 40, 80])
    const secondBead = doc.resolve((firstBead as Map<string, unknown>).get('N') as never)
    expect(secondBead).toBeInstanceOf(Map)
    expect((secondBead as Map<string, unknown>).get('R')).toEqual([15, 80, 50, 125])
    expect(doc.resolve((secondBead as Map<string, unknown>).get('N') as never)).toBe(firstBead)
    expect(doc.resolve((firstBead as Map<string, unknown>).get('V') as never)).toBe(secondBead)

    const pages = collectPdfPages(doc)
    const firstPageBeads = doc.resolve(pages[0]!.dict.get('B') ?? null)
    const secondPageBeads = doc.resolve(pages[1]!.dict.get('B') ?? null)
    expect(firstPageBeads).toBeInstanceOf(Array)
    expect(secondPageBeads).toBeInstanceOf(Array)
    expect(doc.resolve((firstPageBeads as unknown[])[0] as never)).toBe(firstBead)
    expect(doc.resolve((secondPageBeads as unknown[])[0] as never)).toBe(secondBead)
    const importedThread = PdfImporter.open(bytes).importArticleThreads()[0]!
    expect(importedThread.info).toEqual({
      title: 'Article A', author: 'Editor', subject: 'Thread test', keywords: 'article,bead',
      creator: 'Thread creator', producer: 'Thread producer',
      creationDate: new Date('2026-07-14T00:00:00Z'), modDate: new Date('2026-07-14T01:00:00Z'),
      trapped: false, custom: { Edition: 2, Reviewed: true, Status: { type: 'name', value: 'Final' } },
    })
    expect(importedThread.metadata?.data.length).toBeGreaterThan(0)
    expect(importedThread.metadata?.entries.Type).toEqual({ kind: 'name', value: 'Metadata' })
    expect(importedThread.metadata?.entries.Subtype).toEqual({ kind: 'name', value: 'XML' })
  })

  it('rejects empty article threads', () => {
    const backend = new PdfBackend({
      fonts: {},
      articleThreads: [{ beads: [] }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/must contain at least one bead/)
  })
})

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes)
}

function makeThumbnailPng(): Uint8Array {
  const ihdr = new Uint8Array(13)
  ihdr[3] = 2
  ihdr[7] = 2
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = new Uint8Array([
    0, 255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 0, 255, 128, 10, 20, 30, 40,
  ])
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const chunks = [pngChunk('IHDR', ihdr), pngChunk('IDAT', zlibDeflate(raw)), pngChunk('IEND', new Uint8Array(0))]
  let total = sig.length
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  out.set(sig)
  let pos = sig.length
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const tb = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)])
  const ci = new Uint8Array(4 + data.length)
  ci.set(tb)
  ci.set(data, 4)
  const crc = pngCrc32(ci)
  const chunk = new Uint8Array(12 + data.length)
  chunk[0] = (data.length >> 24) & 0xFF
  chunk[1] = (data.length >> 16) & 0xFF
  chunk[2] = (data.length >> 8) & 0xFF
  chunk[3] = data.length & 0xFF
  chunk.set(tb, 4)
  chunk.set(data, 8)
  chunk[8 + data.length] = (crc >> 24) & 0xFF
  chunk[8 + data.length + 1] = (crc >> 16) & 0xFF
  chunk[8 + data.length + 2] = (crc >> 8) & 0xFF
  chunk[8 + data.length + 3] = crc & 0xFF
  return chunk
}

function pngCrc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

describe('XMP Metadata Stream', () => {
  // Verifies that a /Type /Metadata /Subtype /XML stream is emitted when metadata is present.
  it('metadata 指定時に /Type /Metadata /Subtype /XML ストリームが存在', () => {
    const { text } = generatePdf({ title: 'XMP Test' })
    expect(text).toContain('/Type /Metadata')
    expect(text).toContain('/Subtype /XML')
  })

  // Verifies that the Catalog references the XMP metadata stream via /Metadata.
  it('Catalog に /Metadata 参照が含まれる', () => {
    const { text } = generatePdf({ title: 'Catalog Test' })
    // /Type /Catalog ... /Metadata N 0 R
    expect(text).toMatch(/\/Metadata \d+ 0 R/)
  })

  // Verifies that the XMP packet is wrapped in xpacket begin/end processing instructions.
  it('XMP に xpacket 処理命令が含まれる', () => {
    const { text } = generatePdf({ title: 'XPacket Test' })
    expect(text).toContain('<?xpacket begin=')
    expect(text).toContain('<?xpacket end="w"?>')
  })

  // Verifies that the title is embedded as dc:title in the XMP packet.
  it('XMP に dc:title が含まれる', () => {
    const { text } = generatePdf({ title: 'My Report Title' })
    expect(text).toContain('My Report Title')
    expect(text).toContain('dc:title')
  })

  // Verifies that the author is embedded as dc:creator in the XMP packet.
  it('XMP に dc:creator が含まれる', () => {
    const { text } = generatePdf({ author: 'Test Author' })
    expect(text).toContain('Test Author')
    expect(text).toContain('dc:creator')
  })

  // Verifies that xmp:CreateDate is written in ISO 8601 format in the XMP packet.
  it('XMP に xmp:CreateDate が ISO 8601 形式で含まれる', () => {
    const date = new Date('2026-03-15T12:00:00Z')
    const { text } = generatePdf({ creationDate: date })
    expect(text).toContain('xmp:CreateDate')
    expect(text).toContain('2026-03-15T12:00:00.000Z')
  })

  // Verifies that the modification date is embedded as xmp:ModifyDate in ISO 8601 format.
  it('XMP に xmp:ModifyDate が含まれる', () => {
    const date = new Date('2026-04-20T08:30:00Z')
    const { text } = generatePdf({ modDate: date })
    expect(text).toContain('xmp:ModifyDate')
    expect(text).toContain('2026-04-20T08:30:00.000Z')
  })

  // Verifies that the producer is embedded as pdf:Producer in the XMP packet.
  it('XMP に pdf:Producer が含まれる', () => {
    const { text } = generatePdf({ producer: 'XMP Producer Test' })
    expect(text).toContain('pdf:Producer')
    expect(text).toContain('XMP Producer Test')
  })

  // Verifies that keywords are embedded as pdf:Keywords in the XMP packet.
  it('XMP に pdf:Keywords が含まれる', () => {
    const { text } = generatePdf({ keywords: 'xmp, test, keywords' })
    expect(text).toContain('pdf:Keywords')
    expect(text).toContain('xmp, test, keywords')
  })

  // Verifies that the subject field maps to dc:description in the XMP packet.
  it('XMP に dc:description (subject) が含まれる', () => {
    const { text } = generatePdf({ subject: 'Test Subject' })
    expect(text).toContain('dc:description')
    expect(text).toContain('Test Subject')
  })

  // Verifies that the creator field maps to xmp:CreatorTool in the XMP packet.
  it('XMP に xmp:CreatorTool (creator) が含まれる', () => {
    const { text } = generatePdf({ creator: 'tsreport' })
    expect(text).toContain('xmp:CreatorTool')
    expect(text).toContain('tsreport')
  })

  // Verifies that XML special characters in metadata values are entity-escaped inside the XMP packet.
  it('XMP の XML 特殊文字がエスケープされる', () => {
    const { text } = generatePdf({ title: 'A < B > C & D "E"' })
    expect(text).toContain('A &lt; B &gt; C &amp; D &quot;E&quot;')
  })

  // Verifies that no XMP metadata stream is generated when no metadata is supplied.
  it('metadata なしの場合、XMP ストリームが生成されない', () => {
    const { text } = generatePdf()
    expect(text).not.toContain('/Type /Metadata')
    expect(text).not.toContain('/Subtype /XML')
    expect(text).not.toContain('<?xpacket')
  })
})

describe('Info + XMP with Encryption', () => {
  // Verifies that the Info dict reference survives in the trailer when encryption is enabled.
  it('暗号化時も Info dict が trailer に含まれる', () => {
    const { text } = generatePdf(
      { title: 'Encrypted Report' },
      { userPassword: 'test', ownerPassword: 'test' },
    )
    expect(text).toMatch(/\/Info \d+ 0 R/)
    expect(text).toContain('/Encrypt ')
  })

  // Verifies that the Catalog still references the XMP stream when encryption is enabled.
  it('暗号化時も XMP が Catalog から参照される', () => {
    const { bytes } = generatePdf(
      { title: 'Encrypted XMP' },
      { userPassword: 'test', ownerPassword: 'test' },
    )
    const catalog = parsePdf(bytes, { password: 'test' }).getCatalog()
    expect(catalog.get('Metadata')).toBeInstanceOf(PdfRef)
  })

  // Verifies that the XMP metadata stream is encrypted by default (the /Encrypt
  // handler does not declare /EncryptMetadata false), so the title must not leak
  // as cleartext but round-trips once decrypted with the password.
  it('暗号化時は XMP メタデータストリームも既定で暗号化される', () => {
    const { text, bytes } = generatePdf(
      { title: 'Readable XMP', producer: 'tsreport Engine' },
      { userPassword: 'test', ownerPassword: 'test' },
    )
    // Default /EncryptMetadata true: the title must not appear in cleartext.
    expect(text).not.toContain('Readable XMP')
    // It decrypts back to the original XMP with the password.
    const doc = parsePdf(bytes, { password: 'test' })
    const md = doc.resolve(doc.getCatalog().get('Metadata') ?? null) as PdfStream
    const data = doc.decodeStream(md)
    let xmp = ''
    for (let i = 0; i < data.length; i++) xmp += String.fromCharCode(data[i]!)
    expect(xmp).toContain('Readable XMP')
  })
})
