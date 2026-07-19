import { describe, expect, it } from 'vitest'
import { PdfBackend, type PdfOutputIntent } from '../../src/renderer/pdf-backend.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { parsePdf, PdfName, PdfStream } from '../../src/pdf/pdf-parser.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { generateCmykIccProfile } from '../../src/renderer/icc-profile.js'

function buildPdf(outputIntents: PdfOutputIntent[]): Uint8Array {
  const backend = new PdfBackend({ fonts: {}, pdfVersion: '2.0', outputIntents })
  backend.beginDocument()
  backend.beginPage(100, 100)
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}

describe('PDF print-production dictionaries', () => {
  it('round-trips embedded and externally referenced OutputIntents', () => {
    const profile = generateCmykIccProfile()
    const bytes = buildPdf([
      {
        subtype: 'GTS_PDFX',
        outputCondition: 'Proof press',
        outputConditionIdentifier: 'Proof-1',
        registryName: 'https://example.test/registry',
        info: 'CMYK proof output',
        destinationProfile: { components: 4, data: profile },
      },
      {
        subtype: 'GTS_PDFX',
        outputConditionIdentifier: 'Remote-1',
        destinationProfileReference: {
          URLs: { kind: 'array', items: [{ kind: 'string', bytes: new TextEncoder().encode('https://example.test/profile.icc') }] },
          CheckSum: { kind: 'string', bytes: new Uint8Array(16).fill(0x5A) },
          ProfileName: { kind: 'string', bytes: new TextEncoder().encode('Remote profile') },
        },
      },
    ])

    const doc = parsePdf(bytes)
    const catalog = doc.getCatalog()
    const intents = doc.resolve(catalog.get('OutputIntents') ?? null) as unknown[]
    expect(intents).toHaveLength(2)
    const first = doc.resolve(intents[0] as never) as Map<string, unknown>
    expect(first.get('Type')).toEqual(new PdfName('OutputIntent'))
    expect(first.get('S')).toEqual(new PdfName('GTS_PDFX'))
    const profileStream = doc.resolve(first.get('DestOutputProfile') as never)
    expect(profileStream).toBeInstanceOf(PdfStream)
    expect((profileStream as PdfStream).dict.get('N')).toBe(4)
    expect(doc.decodeStream(profileStream as PdfStream)).toEqual(profile)

    const imported = PdfImporter.open(bytes).importCatalogModel().outputIntents
    expect(imported).toEqual([
      {
        subtype: 'GTS_PDFX',
        outputCondition: 'Proof press',
        outputConditionIdentifier: 'Proof-1',
        registryName: 'https://example.test/registry',
        info: 'CMYK proof output',
        destinationProfile: { components: 4, data: profile },
      },
      {
        subtype: 'GTS_PDFX',
        outputConditionIdentifier: 'Remote-1',
        destinationProfileReference: {
          URLs: { kind: 'array', items: [{ kind: 'string', bytes: new TextEncoder().encode('https://example.test/profile.icc') }] },
          CheckSum: { kind: 'string', bytes: new Uint8Array(16).fill(0x5A) },
          ProfileName: { kind: 'string', bytes: new TextEncoder().encode('Remote profile') },
        },
      },
    ])

    const roundTripped = buildPdf(imported!)
    expect(PdfImporter.open(roundTripped).importCatalogModel().outputIntents).toEqual(imported)
  })

  it('promotes DestOutputProfileRef output to PDF 2.0 and validates its typed entries', () => {
    const backend = new PdfBackend({
      fonts: {}, pdfVersion: '1.4',
      outputIntents: [{
        subtype: 'GTS_PDFX',
        destinationProfileReference: {
          CheckSum: { kind: 'string', bytes: new Uint8Array(16) },
          ICCVersion: { kind: 'string', bytes: new Uint8Array([4, 0x30, 0, 0]) },
          ProfileCS: { kind: 'string', bytes: new TextEncoder().encode('CMYK') },
          URLs: { kind: 'array', items: [{ kind: 'string', bytes: new TextEncoder().encode('https://example.test/profile.icc') }] },
        },
      }],
    })
    backend.beginDocument(); backend.beginPage(100, 100); backend.endPage(); backend.endDocument()
    expect(new TextDecoder('latin1').decode(backend.toUint8Array().subarray(0, 8))).toBe('%PDF-2.0')

    expect(() => buildPdf([{
      subtype: 'GTS_PDFX', destinationProfileReference: {
        CheckSum: { kind: 'string', bytes: new Uint8Array(4) },
      },
    }])).toThrow(/16-byte MD5/)
    expect(() => buildPdf([{
      subtype: 'GTS_PDFX', destinationProfileReference: {
        URLs: { kind: 'array', items: [] },
      },
    }])).toThrow(/non-empty array/)
  })

  it('rejects invalid OutputIntent ownership and profile forms', () => {
    expect(() => new PdfBackend({
      fonts: {},
      pdfaConformance: 'PDF/A-2b',
      outputIntents: [{ subtype: 'GTS_PDFA1' }],
    })).toThrow(/owned by PDF\/A and PDF\/X/)
    expect(() => buildPdf([{
      subtype: 'GTS_PDFX',
      destinationProfile: { components: 4, data: new Uint8Array([1]) },
      destinationProfileReference: {},
    }])).toThrow(/mutually exclusive/)
  })

  it('emits and imports one identical SeparationInfo page set', () => {
    const separationInfo = {
      pages: [0, 1],
      deviceColorant: { kind: 'string' as const, value: 'Spot Blue' },
      colorSpace: {
        kind: 'separation' as const,
        name: 'Spot Blue',
        alternate: { kind: 'cmyk' as const },
        tintTransform: {
          functionType: 2 as const,
          domain: [0, 1] as [number, number],
          c0: [0, 0, 0, 0],
          c1: [1, 0.5, 0, 0.1],
          exponent: 1,
        },
      },
    }
    const backend = new PdfBackend({ fonts: {}, pdfVersion: '2.0' })
    backend.beginDocument()
    backend.beginPage(100, 100, { separationInfo })
    backend.endPage()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const doc = parsePdf(bytes)
    const pages = collectPdfPages(doc)
    const first = doc.resolve(pages[0]!.dict.get('SeparationInfo') ?? null) as Map<string, unknown>
    const second = doc.resolve(pages[1]!.dict.get('SeparationInfo') ?? null) as Map<string, unknown>
    expect(first.get('Pages')).toEqual(second.get('Pages'))
    expect(first.get('DeviceColorant')).toEqual(second.get('DeviceColorant'))
    expect(first.get('ColorSpace')).toBeDefined()
    expect(PdfImporter.open(bytes).importPageProperties(0).separationInfo).toEqual(separationInfo)
    expect(PdfImporter.open(bytes).importPageProperties(1).separationInfo).toEqual(separationInfo)
  })

  it('rejects conflicting SeparationInfo page sets', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100, {
      separationInfo: { pages: [0, 1], deviceColorant: { kind: 'name', value: 'Cyan' } },
    })
    backend.endPage()
    backend.beginPage(100, 100, {
      separationInfo: { pages: [0, 1], deviceColorant: { kind: 'name', value: 'Magenta' } },
    })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/conflicting SeparationInfo/)
  })

  it('connects PrinterMark and TrapNet appearances to print-production state', () => {
    const markContent = new TextEncoder().encode('0 0 m 10 10 l S')
    const trapContent = new TextEncoder().encode('0 0 10 10 re S')
    const spot = {
      kind: 'separation' as const,
      name: 'Spot Blue',
      alternate: { kind: 'cmyk' as const },
      tintTransform: {
        functionType: 2 as const,
        domain: [0, 1] as [number, number],
        c0: [0, 0, 0, 0],
        c1: [1, 0.5, 0, 0.1],
        exponent: 1,
      },
    }
    const registration = {
      kind: 'separation' as const,
      name: 'All',
      alternate: { kind: 'cmyk' as const },
      tintTransform: {
        functionType: 2 as const,
        domain: [0, 1] as [number, number],
        c0: [0, 0, 0, 0],
        c1: [1, 1, 1, 1],
        exponent: 1,
      },
    }
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: 'PrinterMark', pageIndex: 0, x: 0, y: 0, width: 10, height: 10,
          markName: 'ColorBar', appearanceState: 'PressA',
          appearances: [
            {
              name: 'PressA', bbox: [0, 0, 10, 10], content: markContent, markStyle: 'Press A',
              colorants: { 'Spot Blue': spot, All: registration },
            },
            { name: 'PressB', bbox: [0, 0, 10, 10], content: markContent },
          ],
        },
        {
          subtype: 'TrapNet', pageIndex: 0, x: 0, y: 0, width: 100, height: 100,
          appearanceState: 'Traps', version: 'page-description',
          appearances: [{ name: 'Traps', bbox: [0, 0, 100, 100], content: trapContent }],
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    const printer = doc.resolve(annots[0] as never) as Map<string, unknown>
    const trap = doc.resolve(annots[1] as never) as Map<string, unknown>
    expect(printer.get('F')).toBe(68)
    expect(printer.get('MN')).toEqual(new PdfName('ColorBar'))
    expect(printer.get('AS')).toEqual(new PdfName('PressA'))
    const printerAp = printer.get('AP') as Map<string, unknown>
    const printerNormal = printerAp.get('N') as Map<string, unknown>
    const pressA = doc.resolve(printerNormal.get('PressA') as never) as PdfStream
    expect(pressA.dict.get('MarkStyle')).toBeDefined()
    const colorants = pressA.dict.get('Colorants') as Map<string, unknown>
    expect(colorants).toBeInstanceOf(Map)
    const all = colorants.get('All') as unknown[]
    expect(all[0]).toEqual(new PdfName('Separation'))
    expect(all[1]).toEqual(new PdfName('All'))
    expect(doc.decodeStream(pressA)).toEqual(markContent)

    expect(trap.get('F')).toBe(68)
    expect(trap.get('AS')).toEqual(new PdfName('Traps'))
    expect(trap.has('LastModified')).toBe(false)
    expect(trap.get('Version')).toHaveLength(2)
    expect(trap.get('AnnotStates')).toEqual([new PdfName('PressA')])
  })

  it('round-trips the page transparency group color space and flags', () => {
    const backend = new PdfBackend({ fonts: {}, pdfVersion: '2.0' })
    backend.beginDocument()
    backend.beginPage(100, 100, {
      transparencyGroup: {
        colorSpace: {
          kind: 'lab', whitePoint: [0.9505, 1, 1.089], blackPoint: [0, 0, 0], range: [-128, 127, -128, 127],
        },
        isolated: true,
        knockout: false,
      },
    })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const page = collectPdfPages(parsePdf(bytes))[0]!
    expect(page.dict.get('Group')).toBeInstanceOf(Map)
    expect(PdfImporter.open(bytes).importPageProperties(0).transparencyGroup).toEqual({
      colorSpace: {
        kind: 'lab', whitePoint: [0.9505, 1, 1.089], blackPoint: [0, 0, 0], range: [-128, 127, -128, 127],
      },
      isolated: true,
      knockout: false,
    })
  })
})
