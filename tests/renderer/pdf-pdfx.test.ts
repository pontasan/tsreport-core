// PDF/X-1a conformance output: CMYK-only content, OutputIntent with a CMYK
// profile, PDF 1.4 structure, no transparency, required Info keys.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend, validatePdfConformance } from '../../src/renderer/pdf-backend.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { pdfToText } from './pdf-test-utils.js'
import { zlibDeflate } from '../../src/compression/deflate.js'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { PdfName, PdfStream, parsePdf } from '../../src/pdf/pdf-parser.js'
import { generateCmykIccProfile } from '../../src/renderer/icc-profile.js'

// Minimal RGBA PNG (colorType 6), mirroring the generator in pdf-image.test.ts
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const tb = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)])
  const ci = new Uint8Array(4 + data.length)
  ci.set(tb); ci.set(data, 4)
  const crc = crc32(ci)
  const chunk = new Uint8Array(12 + data.length)
  chunk[0] = (data.length >> 24) & 0xFF; chunk[1] = (data.length >> 16) & 0xFF
  chunk[2] = (data.length >> 8) & 0xFF; chunk[3] = data.length & 0xFF
  chunk.set(tb, 4); chunk.set(data, 8)
  chunk[8 + data.length] = (crc >> 24) & 0xFF; chunk[8 + data.length + 1] = (crc >> 16) & 0xFF
  chunk[8 + data.length + 2] = (crc >> 8) & 0xFF; chunk[8 + data.length + 3] = crc & 0xFF
  return chunk
}

function createMinimalPng(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  ihdr[0] = (width >> 24) & 0xFF; ihdr[1] = (width >> 16) & 0xFF; ihdr[2] = (width >> 8) & 0xFF; ihdr[3] = width & 0xFF
  ihdr[4] = (height >> 24) & 0xFF; ihdr[5] = (height >> 16) & 0xFF; ihdr[6] = (height >> 8) & 0xFF; ihdr[7] = height & 0xFF
  ihdr[8] = 8; ihdr[9] = 6
  const rowBytes = width * 4
  const raw = new Uint8Array(height * (rowBytes + 1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < rowBytes; x++) raw[y * (rowBytes + 1) + 1 + x] = (x + y * 17) & 0xFF
  }
  const compressed = zlibDeflate(raw)
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const chunks = [makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', new Uint8Array(0))]
  let total = sig.length
  for (const c of chunks) total += c.length
  const result = new Uint8Array(total)
  result.set(sig)
  let pos = sig.length
  for (const c of chunks) { result.set(c, pos); pos += c.length }
  return result
}

function renderX(draw: (backend: InstanceType<typeof PdfBackend>) => void): { text: string, bytes: Uint8Array } {
  const backend = new PdfBackend({ fonts: {}, pdfxConformance: 'PDF/X-1a' })
  backend.beginDocument()
  backend.beginPage(200, 100)
  draw(backend)
  backend.endPage()
  backend.endDocument()
  const bytes = backend.toUint8Array()
  return { text: pdfToText(bytes), bytes }
}

describe('PDF/X-1a', () => {
  it('emits the X-1a document structure', () => {
    const { text, bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-1.4')
    expect(text).toContain('/GTS_PDFXVersion (PDF/X-1a:2003)')
    expect(text).toContain('/Trapped /False')
    expect(text).toContain('/S /GTS_PDFX')
    expect(text).toContain('/N 4')
    expect(text).toContain('/TrimBox [0 0 200 100]')
    expect(text).toContain('/BleedBox [0 0 200 100]')
    expect(text).toContain('/ID [')
    expect(text).toContain('/Title (Report)')
    expect(text).toContain('/CreationDate (D:')
    expect(text).toContain('/ModDate (D:')
    expect(text).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-1a:2003</pdfxid:GTS_PDFXVersion>')
    expect(text).toContain('<rdf:li xml:lang="x-default">Report</rdf:li>')
  })

  it('does not use the PDF header version alone to determine conformance', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes).replace('%PDF-1.4', '%PDF-1.3')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('reads the PDF/X-1:2001 predecessor through the same page interpretation path', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: 'cmyk(100,0,0,0)' })
    })
    const raw = new TextDecoder('latin1').decode(bytes)
    const info = findObjectContaining(raw, '/GTS_PDFXVersion')
    const predecessor = appendIncrementalUpdate(bytes, [{
      num: info.objectNumber,
      body: info.body.replace('/GTS_PDFXVersion (PDF/X-1a:2003)', '/GTS_PDFXVersion (PDF/X-1:2001)'),
    }])
    const page = PdfImporter.open(predecessor).importPage(0)
    expect(page.elements.length).toBeGreaterThan(0)
  })

  it('emits the requested trapping state', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      metadata: { trapped: true },
    })
    backend.beginDocument()
    backend.beginPage(200, 100)
    backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/Trapped /True')
  })

  it('connects PDF/X TrapNet annotations to DeviceCMYK process-color appearances', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      metadata: { trapped: true },
      annotations: [{
        subtype: 'TrapNet', pageIndex: 0, x: 10, y: 10, width: 20, height: 20,
        lastModified: new Date(Date.UTC(2026, 6, 14, 0, 0, 0)),
        appearanceState: 'Default',
        appearances: [{
          name: 'Default', bbox: [0, 0, 20, 20],
          content: new TextEncoder().encode('0 0 0 1 k 0 0 20 20 re f'),
        }],
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    expect(() => validatePdfConformance(bytes, { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
    const text = pdfToText(bytes)
    expect(text).toContain('/Subtype /TrapNet')
    expect(text).toContain('/PCM /DeviceCMYK')
  })

  it('connects TrapNet Version and AnnotStates to the serialized page description', () => {
    const backend = new PdfBackend({
      fonts: {}, pdfxConformance: 'PDF/X-1a', metadata: { trapped: true },
      annotations: [
        { subtype: 'Text', pageIndex: 0, x: 0, y: 0, width: 5, height: 5 },
        {
          subtype: 'TrapNet', pageIndex: 0, x: 10, y: 10, width: 20, height: 20,
          version: 'page-description', appearanceState: 'Default',
          appearances: [{
            name: 'Default', bbox: [0, 0, 20, 20],
            content: new TextEncoder().encode('0 0 0 1 k 0 0 20 20 re f'),
          }],
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100, { trimBox: [10, 10, 90, 90], bleedBox: [10, 10, 90, 90] })
    backend.drawRect(20, 20, 10, 10, { fill: 'cmyk(0,0,0,100)' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    expect(() => validatePdfConformance(bytes, { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
    const text = pdfToText(bytes)
    expect(text).toMatch(/\/Version \[\d+ 0 R/)
    expect(text).toContain('/AnnotStates [null]')
  })

  it('rejects incomplete TrapNet version sets and TrapNet entries that are not last', () => {
    const backend = new PdfBackend({
      fonts: {}, pdfxConformance: 'PDF/X-1a', metadata: { trapped: true },
      annotations: [
        { subtype: 'Text', pageIndex: 0, x: 0, y: 0, width: 5, height: 5 },
        {
          subtype: 'TrapNet', pageIndex: 0, x: 10, y: 10, width: 20, height: 20,
          version: 'page-description', appearanceState: 'Default',
          appearances: [{
            name: 'Default', bbox: [0, 0, 20, 20],
            content: new TextEncoder().encode('0 0 0 1 k 0 0 20 20 re f'),
          }],
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100, { trimBox: [10, 10, 90, 90], bleedBox: [10, 10, 90, 90] })
    backend.drawRect(20, 20, 10, 10, { fill: 'cmyk(0,0,0,100)' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const raw = new TextDecoder('latin1').decode(bytes)
    const trapNet = findObjectContaining(raw, '/Subtype /TrapNet')
    const incomplete = appendIncrementalUpdate(bytes, [{
      num: trapNet.objectNumber,
      body: trapNet.body.replace(/\/Version \[[^\]]*\]/, '/Version []'),
    }])
    expect(() => validatePdfConformance(incomplete, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/TrapNet Version omits page content or resource/)

    const textAnnotation = findObjectContaining(raw, '/Subtype /Text')
    const page = findTypedObject(raw, 'Page')
    const reordered = appendIncrementalUpdate(bytes, [{
      num: page.objectNumber,
      body: page.body.replace(/\/Annots \[[^\]]*\]/, `/Annots [${trapNet.objectNumber} 0 R ${textAnnotation.objectNumber} 0 R]`),
    }])
    expect(() => validatePdfConformance(reordered, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/TrapNet annotation at most and as the last Annots entry/)
  })

  it('rejects a TrapNet when the document is not declared trapped', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      annotations: [{
        subtype: 'TrapNet', pageIndex: 0, x: 10, y: 10, width: 20, height: 20,
        lastModified: new Date(Date.UTC(2026, 6, 14, 0, 0, 0)),
        appearanceState: 'Default',
        appearances: [{
          name: 'Default', bbox: [0, 0, 20, 20],
          content: new TextEncoder().encode('0 0 0 1 k 0 0 20 20 re f'),
        }],
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/TrapNet annotations require Info Trapped True/)
  })

  it('rejects nonempty FontFauxing and non-CMYK TrapNet process-color models', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      metadata: { trapped: true },
      annotations: [{
        subtype: 'TrapNet', pageIndex: 0, x: 10, y: 10, width: 20, height: 20,
        lastModified: new Date(Date.UTC(2026, 6, 14, 0, 0, 0)),
        appearanceState: 'Default',
        appearances: [{
          name: 'Default', bbox: [0, 0, 20, 20],
          content: new TextEncoder().encode('0 0 0 1 k 0 0 20 20 re f'),
        }],
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const raw = new TextDecoder('latin1').decode(bytes)
    const trapNet = findObjectContaining(raw, '/Subtype /TrapNet')
    const withFauxing = appendIncrementalUpdate(bytes, [{
      num: trapNet.objectNumber,
      body: trapNet.body.replace(/\s*>>\s*$/, ' /FontFauxing [null] >>'),
    }])
    expect(() => validatePdfConformance(withFauxing, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/TrapNet FontFauxing must be absent or empty/)

    const appearance = findObjectContaining(raw, '/PCM /DeviceCMYK')
    const withRgbPcm = appendIncrementalUpdate(bytes, [{
      num: appearance.objectNumber,
      body: appearance.body.replace('/PCM /DeviceCMYK', '/PCM /DeviceRGB'),
    }])
    expect(() => validatePdfConformance(withRgbPcm, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/TrapNet appearance requires PCM DeviceCMYK/)
  })

  it('embeds and uses the caller-supplied CMYK output profile', () => {
    const profile = zeroB2aClut(generateCmykIccProfile())
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      pdfxOutputProfile: {
        data: profile,
        outputConditionIdentifier: 'TEST-CMYK',
        info: 'Deterministic test output condition',
      },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(0, 0, 10, 10, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/OutputConditionIdentifier (TEST-CMYK)')
    expect(text).toContain('/Info (Deterministic test output condition)')
    expect(requiredOperatorComponents(text, 'k')).toEqual([0, 0, 0, 0])

    const doc = parsePdf(bytes)
    const intents = doc.resolve(doc.getCatalog().get('OutputIntents') ?? null)
    expect(Array.isArray(intents)).toBe(true)
    const intent = doc.resolve((intents as unknown[])[0] as never)
    expect(intent).toBeInstanceOf(Map)
    const embedded = doc.resolve((intent as Map<string, never>).get('DestOutputProfile') ?? null)
    expect(embedded).toBeInstanceOf(PdfStream)
    expect(doc.decodeStream(embedded as PdfStream)).toEqual(profile)
  })

  it('rejects destination profiles outside the ICC.1:1998 version 2 generation', () => {
    const profile = generateCmykIccProfile().slice()
    profile[8] = 4
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      pdfxOutputProfile: {
        data: profile,
        outputConditionIdentifier: 'TEST-CMYK',
        info: 'Version-boundary fixture',
      },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/ICC\.1:1998 version 2 CMYK Output Device Profile/)
  })

  it('conformance validator requires exactly one GTS_PDFX output intent', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes)
    const match = /\/OutputIntents \[(\d+ 0 R)\]/.exec(raw)
    if (match === null) throw new Error('test fixture error: OutputIntents reference not found')
    const mutated = appendIncrementalEntry(bytes, 'Catalog', `/OutputIntents [${match[1]} ${match[1]}]`)
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/requires exactly one GTS_PDFX OutputIntent/)
  })

  it('conformance validator resolves an exact registered output condition without an embedded profile', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes)
    const intent = findObjectContaining(raw, '/S /GTS_PDFX')
    const body = intent.body
      .replace(/\/DestOutputProfile \d+ 0 R\s*/, '')
      .replace('>>', '/RegistryName (http://www.color.org) >>')
    const mutated = appendIncrementalUpdate(bytes, [{ num: intent.objectNumber, body }])
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/requires pdfxOutputConditionValidator/)
    let identity = ''
    expect(() => validatePdfConformance(mutated, {
      pdfxConformance: 'PDF/X-1a',
      pdfxOutputConditionValidator: function (condition) {
        identity = `${condition.registryName}|${condition.outputConditionIdentifier}`
        return condition.registryName === 'http://www.color.org'
      },
    })).not.toThrow()
    expect(identity).toBe('http://www.color.org|tsreport reference CMYK')
    expect(() => validatePdfConformance(mutated, {
      pdfxConformance: 'PDF/X-1a',
      pdfxOutputConditionValidator: function () { return false },
    })).toThrow(/does not exactly match its registry entry/)
  })

  it('treats OutputConditionIdentifier as the required text-string type without inventing a length constraint', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes)
    const intent = findObjectContaining(raw, '/S /GTS_PDFX')
    const body = intent.body.replace(/\/OutputConditionIdentifier \([^)]*\)/, '/OutputConditionIdentifier ()')
    const mutated = appendIncrementalUpdate(bytes, [{ num: intent.objectNumber, body }])
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('allows page thumbnail image dictionaries', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      images: { thumb: createMinimalPng(2, 2) },
    })
    backend.beginDocument()
    backend.beginPage(200, 100, { thumbnailImageId: 'thumb' })
    backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/Thumb ')
    expect(text).toContain('/ColorSpace /DeviceCMYK')
  })

  it('converts RGB template colors to DeviceCMYK operators', () => {
    const { text } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000', stroke: '#0000ff', strokeWidth: 1 })
    })
    const fill = requiredOperatorComponents(text, 'k')
    expect(fill[0]).toBeLessThan(0.1)
    expect(fill[1]).toBeGreaterThan(0.9)
    expect(fill[2]).toBeGreaterThan(0.9)
    expect(fill[3]).toBeLessThan(0.1)
    const stroke = requiredOperatorComponents(text, 'K')
    expect(stroke[0]).toBeGreaterThan(0.9)
    expect(stroke[1]).toBeGreaterThan(0.9)
    expect(stroke[2]).toBeLessThan(0.1)
    expect(stroke[3]).toBeLessThan(0.1)
    expect(text).not.toMatch(/ rg\n/)
  })

  it('conformance validator rejects DeviceRGB leakage', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const leaked = appendIncrementalEntry(bytes, 'Page', '/Resources << /ColorSpace << /Bad /DeviceRGB >> >>')
    expect(() => validatePdfConformance(leaked, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids DeviceRGB color space/)
  })

  it('rejects alternate image declarations at the PDF/X generation boundary', () => {
    const png = createMinimalPng(2, 2)
    const backend = new PdfBackend({
      fonts: {}, images: { main: png, alternate: png }, pdfxConformance: 'PDF/X-1a',
    })
    backend.beginDocument()
    backend.beginPage(20, 20)
    expect(() => backend.drawImage(0, 0, 20, 20, 'main', {
      alternates: [{ imageId: 'alternate', defaultForPrinting: true }],
    })).toThrow(/forbids alternate images selected by default for printing/)
  })

  it('permits alternate images that are not selected by default for printing', () => {
    const png = createMinimalPng(2, 2)
    const backend = new PdfBackend({
      fonts: {}, images: { main: png, alternate: png }, pdfxConformance: 'PDF/X-1a',
    })
    backend.beginDocument()
    backend.beginPage(20, 20)
    backend.drawImage(0, 0, 20, 20, 'main', { alternates: [{ imageId: 'alternate' }] })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).not.toThrow()
  })

  it('rejects alternate images that do not represent the same image area', () => {
    const backend = new PdfBackend({
      fonts: {},
      images: { main: createMinimalPng(2, 2), alternate: createMinimalPng(4, 2) },
      pdfxConformance: 'PDF/X-1a',
    })
    backend.beginDocument()
    backend.beginPage(20, 20)
    backend.drawImage(0, 0, 20, 20, 'main', { alternates: [{ imageId: 'alternate' }] })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/alternate images must represent the same image area/)
  })

  it('conformance validator scans DeviceRGB operators inside Type3 CharProcs', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const procedure = '1 0 0 rg\n0 0 m\n'
    const font = `<< /Type /Font /Subtype /Type3 /Name /Fbad /FontBBox [0 0 1 1] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /A ${objectNumber} 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [500] >>`
    const mutated = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /Font << /Fbad ${font} >> >>`,
      [{ num: objectNumber, body: `<< /Length ${procedure.length} >>\nstream\n${procedure}endstream` }],
    )
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids rg DeviceRGB operators.*CharProc A/)
  })

  it('conformance validator rejects reachable PostScript XObjects even when unused', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const mutated = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /XObject << /PS1 ${objectNumber} 0 R >> >>`,
      [{ num: objectNumber, body: '<< /Type /XObject /Subtype /PS /Length 0 >>\nstream\n\nendstream' }],
    )
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids PostScript XObject PS1/)
  })

  it('conformance validator rejects missing page TrimBox', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes).replace('/TrimBox [', '/TrimB0x [')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/requires exactly one of TrimBox or ArtBox/)
  })

  it('conformance validator permits an omitted page BleedBox', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes).replace('/BleedBox [', '/BleedB0x [')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('conformance validator permits ArtBox instead of TrimBox', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes).replace('/TrimBox [', '/ArtBox  [')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('conformance validator rejects page boxes outside their parent box', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes).replace('/BleedBox [0 0 200 100]', '/BleedBox [0 0 201 100]')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/requires page 1 BleedBox inside MediaBox/)
  })

  it('rejects link annotations during PDF/X generation', () => {
    const backend = new PdfBackend({ fonts: {}, pdfxConformance: 'PDF/X-1a' })
    expect(() => backend.addAnnotation(0, {
      type: 'uri',
      target: 'https://example.test/',
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    })).toThrow(/forbids link annotations/)
  })

  it('conformance validator permits an empty Annots array', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const withAnnots = appendIncrementalEntry(bytes, 'Page', '/Annots []')
    expect(() => validatePdfConformance(withAnnots, { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('rejects explicit page annotations', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      annotations: [{ subtype: 'Text', pageIndex: 0, x: 10, y: 10, width: 20, height: 20 }],
    })
    backend.beginDocument()
    backend.beginPage(200, 100)
    backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/Text annotation must lie outside BleedBox/)
  })

  it('permits non-print annotations completely outside BleedBox', () => {
    const backend = new PdfBackend({
      fonts: {}, pdfxConformance: 'PDF/X-1a',
      annotations: [{ subtype: 'Text', pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100, { trimBox: [10, 10, 90, 90], bleedBox: [10, 10, 90, 90] })
    backend.drawRect(20, 20, 10, 10, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).not.toThrow()
  })

  it('permits DeviceRGB in non-print annotation appearances outside BleedBox', () => {
    const backend = new PdfBackend({
      fonts: {}, pdfxConformance: 'PDF/X-1a',
      annotations: [{
        subtype: 'Text', pageIndex: 0, x: 0, y: 0, width: 10, height: 10,
        appearanceState: 'Normal',
        appearances: [{
          name: 'Normal', bbox: [0, 0, 10, 10],
          content: new TextEncoder().encode('1 0 0 rg 0 0 10 10 re f'),
        }],
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100, { trimBox: [10, 10, 90, 90], bleedBox: [10, 10, 90, 90] })
    backend.drawRect(20, 20, 10, 10, { fill: 'cmyk(0,0,0,100)' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    expect(() => validatePdfConformance(bytes, { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('retains non-interactive PrinterMark annotations', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      annotations: [{
        subtype: 'PrinterMark', pageIndex: 0, x: 0, y: 0, width: 10, height: 10,
        appearances: [{
          name: 'Registration', bbox: [0, 0, 10, 10],
          content: new TextEncoder().encode('0 0 0 1 K 0.5 w 0 5 m 10 5 l S 5 0 m 5 10 l S'),
        }],
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100, { trimBox: [10, 10, 90, 90] })
    backend.drawRect(10, 10, 20, 20, { fill: 'cmyk(0,0,0,100)' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    validatePdfConformance(bytes, { pdfxConformance: 'PDF/X-1a' })
    const text = pdfToText(bytes)
    expect(text).toContain('/Subtype /PrinterMark')
    expect(text).toContain('/F 68')
  })

  it('rejects DeviceRGB operators inside prepress appearance streams', () => {
    const backend = new PdfBackend({
      fonts: {}, pdfxConformance: 'PDF/X-1a',
      annotations: [{
        subtype: 'PrinterMark', pageIndex: 0, x: 0, y: 0, width: 10, height: 10,
        appearances: [{
          name: 'InvalidRGB', bbox: [0, 0, 10, 10],
          content: new TextEncoder().encode('1 0 0 rg 0 0 10 10 re f'),
        }],
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100, { trimBox: [10, 10, 90, 90] })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/forbids rg DeviceRGB operators/)
  })

  it('conformance validator rejects document open actions', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const withOpenAction = appendIncrementalEntry(bytes, 'Catalog', '/OpenAction []')
    expect(() => validatePdfConformance(withOpenAction, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids document open actions/)
  })

  it('conformance validator rejects action dictionaries anywhere in the reachable graph', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const mutated = appendIncrementalEntry(bytes, 'Catalog', '/PieceInfo << /Automation << /S /URI /URI (https://example.test/) >> >>')
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids actions/)
  })

  it('conformance validator rejects forbidden objects even when they are not reachable from the Catalog', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const size = parsePdf(bytes).trailer.get('Size')
    if (typeof size !== 'number') throw new Error('test fixture error: trailer Size is missing')
    const mutated = appendIncrementalUpdate(bytes, [{
      num: size,
      body: '<< /Type /Filespec /F (unreferenced.dat) >>',
    }])
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids file specifications at object/)
  })

  it.each(['LZWDecode', 'JBIG2Decode'])('conformance validator rejects %s compression', (filter) => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const mutated = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /XObject << /ImBad ${objectNumber} 0 R >> >>`,
      [{
        num: objectNumber,
        body: `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /${filter} /Length 0 >>\nstream\n\nendstream`,
      }],
    )
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(new RegExp(`forbids ${filter} compression`))
  })

  it('conformance validator rejects file specifications anywhere in the reachable graph', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const mutated = appendIncrementalEntry(bytes, 'Catalog', '/PieceInfo << /External << /Type /Filespec /F (asset.tif) >> >>')
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids file specifications/)
  })

  it('conformance validator rejects unknown operators even inside BX and EX', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const objectNumber = parsePdf(bytes).trailer.get('Size') as number
    const content = 'BX UnsupportedOperator EX\n'
    const mutated = appendIncrementalPageEntryAndObjects(
      bytes,
      `/Resources << /XObject << /Bad ${objectNumber} 0 R >> >>`,
      [{ num: objectNumber, body: `<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length ${content.length} >>\nstream\n${content}endstream` }],
    )
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids undefined or PostScript content operator UnsupportedOperator/)
  })

  it('conformance validator rejects transfer functions in ExtGState resources', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const mutated = appendIncrementalEntry(bytes, 'Page', '/Resources << /ExtGState << /Bad << /Type /ExtGState /TR /Identity >> >> >>')
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/ExtGState forbids TR/)
  })

  it('conformance validator rejects default process color spaces on print resources', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const mutated = appendIncrementalEntry(bytes, 'Page', '/Resources << /ColorSpace << /DefaultCMYK /DeviceCMYK >> >>')
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/print resources forbid DefaultCMYK/)
  })

  it('conformance validator rejects ICCBased color spaces on print elements', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const mutated = appendIncrementalEntry(bytes, 'Page', '/Resources << /ColorSpace << /Bad [/ICCBased null] >> >>')
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/forbids ICCBased color space/)
  })

  it('conformance validator restricts spot alternate spaces to DeviceGray or DeviceCMYK', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const mutated = appendIncrementalEntry(bytes, 'Page', '/Resources << /ColorSpace << /Bad [/Separation /Gold [/Indexed /DeviceCMYK 0 <00000000>] null] >> >>')
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/Separation alternate space must be DeviceGray or DeviceCMYK/)
  })

  it('conformance validator restricts viewer preference areas when BleedBox is present', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const mutated = appendIncrementalEntry(bytes, 'Catalog', '/ViewerPreferences << /PrintArea /CropBox >>')
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/ViewerPreferences PrintArea must be MediaBox or BleedBox/)
  })

  it('rejects embedded file name trees', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      embeddedFiles: [{ name: 'data.txt', data: new Uint8Array([65]) }],
    })
    backend.beginDocument()
    backend.beginPage(200, 100)
    backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/forbids embedded file name trees/)
  })

  it('rejects JavaScript name trees', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      javaScript: [{ name: 'doc-ready', script: 'app.alert("ready");' }],
    })
    backend.beginDocument()
    backend.beginPage(200, 100)
    backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/forbids JavaScript name trees/)
  })

  it('rejects collection dictionaries', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      collection: { view: 'D' },
    })
    backend.beginDocument()
    backend.beginPage(200, 100)
    backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    expect(() => backend.toUint8Array()).toThrow(/forbids collection dictionaries/)
  })

  it('conformance validator rejects unembedded page fonts', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const withFont = appendIncrementalEntry(
      bytes,
      'Page',
      '/Resources << /Font << /Fbad << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>',
    )
    expect(() => validatePdfConformance(withFont, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/requires embedded fonts/)
  })

  it('conformance validator requires every used character to have an embedded glyph', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const firstObject = parsePdf(bytes).trailer.get('Size') as number
    const content = 'BT /Fbad 12 Tf (B) Tj ET'
    const charProc = '0 0 d0'
    const font = [
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
        { num: firstObject, body: font },
        { num: firstObject + 1, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` },
        { num: firstObject + 2, body: `<< /Length ${charProc.length} >>\nstream\n${charProc}\nendstream` },
      ],
    )
    expect(() => validatePdfConformance(mutated, { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/embedded font Fbad omits glyph for character code 66/)
  })

  it('conformance validator does not require informative XMP PDF/X identification', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes).replace('PDF/X-1a:2003</pdfxid:GTS_PDFXVersion>', 'PDF/X-1a:200X</pdfxid:GTS_PDFXVersion>')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('conformance validator permits a PDF/X-1a:2003 file without optional Catalog Metadata', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes)
    const catalog = findTypedObject(raw, 'Catalog')
    const body = catalog.body.replace(/\/Metadata \d+ 0 R\s*/, '')
    const withoutMetadata = appendIncrementalUpdate(bytes, [{ num: catalog.objectNumber, body }])
    expect(() => validatePdfConformance(withoutMetadata, { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('conformance validator requires non-empty CreationDate and ModDate Info entries', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes).replace('/CreationDate (', '/CreationDatz (')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/Info CreationDate must be a text string/)
  })

  it('conformance validator rejects Unknown trapping state', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes).replace('/Trapped /False', '/Trapped /Unkn0')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' }))
      .toThrow(/Info Trapped must be True or False/)
  })

  it('conformance validator does not turn recommended Info and XMP synchronization into a shall', () => {
    const { bytes } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: '#ff0000' })
    })
    const raw = new TextDecoder('latin1').decode(bytes)
      .replace('<rdf:li xml:lang="x-default">Report</rdf:li>', '<rdf:li xml:lang="x-default">Reporx</rdf:li>')
    expect(() => validatePdfConformance(latin1Bytes(raw), { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
  })

  it('keeps cmyk() and spot() colors native', () => {
    const { text } = renderX(function (backend) {
      backend.drawRect(10, 10, 50, 30, { fill: 'spot(Gold,0,20,60,20)' })
    })
    expect(text).toContain('/Separation /Gold /DeviceCMYK')
  })

  it('rejects transparency instead of silently changing artwork', () => {
    expect(() => renderX(function (backend) {
      backend.setOpacity(0.5)
    })).toThrow(/forbids transparency opacity/)
  })

  it('emits gradients in DeviceCMYK', () => {
    const { text } = renderX(function (backend) {
      backend.drawPathWithPaints(
        new Uint8Array([0, 1, 1, 1, 3]),
        new Float32Array([0, 0, 50, 0, 50, 50, 0, 50]),
        { fill: { type: 'linear-gradient', x1: 0, y1: 0, x2: 50, y2: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] } },
      )
    })
    expect(text).toContain('/ColorSpace /DeviceCMYK')
    const match = /\/C0 \[([^\]]+)\]/.exec(text)
    expect(match).not.toBeNull()
    const red = match![1]!.trim().split(/\s+/).map(Number)
    expect(red[0]).toBeLessThan(0.1)
    expect(red[1]).toBeGreaterThan(0.9)
    expect(red[2]).toBeGreaterThan(0.9)
    expect(red[3]).toBeLessThan(0.1)
  })

  it('keeps native CMYK gradient stops out of the RGB ICC conversion path', () => {
    const profile = zeroB2aClut(generateCmykIccProfile())
    const backend = new PdfBackend({
      fonts: {}, pdfxConformance: 'PDF/X-1a',
      pdfxOutputProfile: { data: profile, outputConditionIdentifier: 'ZERO-CMYK' },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(
      new Uint8Array([0, 1, 1, 1, 3]),
      new Float32Array([0, 0, 50, 0, 50, 50, 0, 50]),
      {
        fill: {
          type: 'linear-gradient', x1: 0, y1: 0, x2: 50, y2: 0,
          stops: [
            { offset: 0, color: 'cmyk(100,0,0,0)' },
            { offset: 1, color: 'cmyk(0,100,0,0)' },
          ],
        },
      },
    )
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/C0 [1 0 0 0]')
    expect(text).toContain('/C1 [0 1 0 0]')
  })

  it('converts sampled function shadings through the output ICC profile', () => {
    const profile = zeroB2aClut(generateCmykIccProfile())
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      pdfxOutputProfile: { data: profile, outputConditionIdentifier: 'ZERO-CMYK' },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(
      new Uint8Array([0, 1, 1, 1, 3]),
      new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]),
      {
        fill: {
          type: 'function-shading',
          domain: [0, 1, 0, 1],
          matrix: [100, 0, 0, 100, 0, 0],
          sampled: {
            size: [2, 2], bitsPerSample: 8,
            range: [0, 1, 0, 1, 0, 1],
            samples: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
          },
        },
      },
    )
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/ShadingType 1')
    expect(text).toContain('/ColorSpace /DeviceCMYK')
    expect(text).toContain('/Range [0 1 0 1 0 1 0 1]')
    expect(text).not.toContain('/ColorSpace /DeviceRGB')
    const doc = parsePdf(bytes)
    const size = doc.trailer.get('Size') as number
    let samples: Uint8Array | null = null
    for (let objectNumber = 1; objectNumber < size; objectNumber++) {
      const object = doc.getObject(objectNumber)
      if (object instanceof PdfStream && doc.resolve(object.dict.get('FunctionType') ?? null) === 0
        && Array.isArray(doc.resolve(object.dict.get('Size') ?? null))) {
        samples = doc.decodeStream(object)
        break
      }
    }
    expect(samples).not.toBeNull()
    expect(Array.from(samples!)).toEqual(new Array(16).fill(0))
  })

  it('rejects RGB calculator shadings that cannot be composed exactly with ICC', () => {
    expect(() => renderX(function (backend) {
      backend.drawPathWithPaints(
        new Uint8Array([0, 1, 1, 1, 3]),
        new Float32Array([0, 0, 50, 0, 50, 50, 0, 50]),
        {
          fill: {
            type: 'function-shading', domain: [0, 1, 0, 1], matrix: [50, 0, 0, 50, 0, 0],
            expression: '{ pop dup 1 exch sub 0 }',
          },
        },
      )
    })).toThrow(/cannot preserve an RGB calculator-function shading/)
  })

  it('re-encodes RGBA rasters as opaque DeviceCMYK without soft masks', () => {
    const png = createMinimalPng(4, 4)
    const backend = new PdfBackend({
      fonts: {}, images: { logo: png }, pdfxConformance: 'PDF/X-1a',
      pdfxOutputProfile: {
        data: zeroB2aClut(generateCmykIccProfile()),
        outputConditionIdentifier: 'ZERO-CMYK',
      },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawImage(10, 10, 20, 20, 'logo')
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/ColorSpace /DeviceCMYK')
    expect(text).not.toContain('/SMask')
    expect(Array.from(requiredCmykImageData(bytes))).toEqual(new Array(4 * 4 * 4).fill(0))
  })

  it('routes embedded color bitmap glyphs through the CMYK image path', () => {
    const source = readFileSync(join(__dirname, '..', 'fixtures', 'fonts', 'NotoColorEmoji-CBDT-subset.ttf'))
    const font = Font.load(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer)
    const backend = new PdfBackend({
      fonts: { emoji: font }, pdfxConformance: 'PDF/X-1a',
      pdfxOutputProfile: {
        data: zeroB2aClut(generateCmykIccProfile()),
        outputConditionIdentifier: 'ZERO-CMYK',
      },
    })
    backend.beginDocument()
    backend.beginPage(120, 120)
    backend.drawText(10, 10, String.fromCodePoint(0x1F600), 'emoji', 80, '#000000')
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/Subtype /Image')
    expect(text).toContain('/ColorSpace /DeviceCMYK')
    expect(text).not.toContain('/ColorSpace /DeviceRGB')
    expect(Array.from(requiredCmykImageData(bytes)).every(function (value) { return value === 0 })).toBe(true)
  })

  it('decodes pre-filtered inline RGB images before output-profile conversion', () => {
    const encoded = zlibDeflate(new Uint8Array([255, 0, 0, 0, 0, 255]))
    const backend = new PdfBackend({ fonts: {}, pdfxConformance: 'PDF/X-1a' })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawImageData(
      10,
      10,
      20,
      10,
      encoded,
      'image/flate;columns=2;rows=1;colorspace=DeviceRGB;bitspercomponent=8;inline=true',
    )
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/Subtype /Image')
    expect(text).toContain('/ColorSpace /DeviceCMYK')
    expect(text).not.toContain('/ColorSpace /DeviceRGB')
    expect(text).not.toMatch(/\nBI\n/)
  })

  it('rejects encryption', () => {
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      encryption: { userPassword: 'a', method: 'aes-128' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    backend.beginDocument()
    backend.beginPage(10, 10)
    backend.endPage()
    backend.endDocument()
    expect(function () { backend.toUint8Array() }).toThrow()
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

function requiredOperatorComponents(text: string, operator: 'k' | 'K'): number[] {
  const pattern = new RegExp(`(^|\\n)([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+) ${operator}(?=\\n)`)
  const match = pattern.exec(text)
  if (match === null) throw new Error(`test fixture error: ${operator} operator not found`)
  return [Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])]
}

function zeroB2aClut(source: Uint8Array): Uint8Array {
  const profile = source.slice()
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength)
  const tagCount = view.getUint32(128)
  for (let index = 0; index < tagCount; index++) {
    const entry = 132 + index * 12
    const signature = String.fromCharCode(profile[entry]!, profile[entry + 1]!, profile[entry + 2]!, profile[entry + 3]!)
    if (signature !== 'B2A0') continue
    const offset = view.getUint32(entry + 4)
    const inputs = profile[offset + 8]!
    const outputs = profile[offset + 9]!
    const grid = profile[offset + 10]!
    const clutStart = offset + 48 + inputs * 256
    profile.fill(0, clutStart, clutStart + Math.pow(grid, inputs) * outputs)
    return profile
  }
  throw new Error('test fixture error: B2A0 tag not found')
}

function requiredCmykImageData(bytes: Uint8Array): Uint8Array {
  const doc = parsePdf(bytes)
  const size = doc.trailer.get('Size') as number
  for (let objectNumber = 1; objectNumber < size; objectNumber++) {
    const value = doc.getObject(objectNumber)
    if (!(value instanceof PdfStream)) continue
    const subtype = doc.resolve(value.dict.get('Subtype') ?? null)
    const colorSpace = doc.resolve(value.dict.get('ColorSpace') ?? null)
    if (subtype instanceof PdfName && subtype.name === 'Image'
      && colorSpace instanceof PdfName && colorSpace.name === 'DeviceCMYK') {
      return doc.decodeStream(value)
    }
  }
  throw new Error('test fixture error: DeviceCMYK image stream not found')
}

function appendIncrementalEntry(bytes: Uint8Array, typeName: 'Catalog' | 'Page', entry: string): Uint8Array {
  const raw = new TextDecoder('latin1').decode(bytes)
  const found = findTypedObject(raw, typeName)
  const insertAt = found.body.lastIndexOf('>>')
  if (insertAt < 0) throw new Error(`test fixture error: ${typeName} dictionary end not found`)
  const updatedBody = `${found.body.slice(0, insertAt)}${entry} ${found.body.slice(insertAt)}`
  return appendIncrementalUpdate(bytes, [{ num: found.objectNumber, body: updatedBody }])
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

function findObjectContaining(raw: string, needle: string): { objectNumber: number, body: string } {
  const objectPattern = /(\d+) 0 obj\s*([\s\S]*?)\nendobj/g
  for (const match of raw.matchAll(objectPattern)) {
    if (match[2]!.includes(needle)) return { objectNumber: Number(match[1]), body: match[2]! }
  }
  throw new Error(`test fixture error: object containing ${needle} not found`)
}
