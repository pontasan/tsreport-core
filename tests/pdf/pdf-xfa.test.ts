import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter, parsePdf, PdfStream, render, validatePdfXfa } from '../../src/index.js'

const encoder = new TextEncoder()

function bytes(value: string): Uint8Array {
  return encoder.encode(value)
}

function emptyDocument(): { pages: Array<{ width: number, height: number, children: [] }> } {
  return { pages: [{ width: 100, height: 100, children: [] }] }
}

function xdp(value = '<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"/>'): Uint8Array {
  return bytes(`<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">${value}</xdp:xdp>`)
}

function rawPdf(objects: string[]): Uint8Array {
  let source = '%PDF-1.7\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(bytes(source).length)
    source += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = bytes(source).length
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) source += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return bytes(source)
}

describe('PDF Annex K XFA forms', function () {
  it('writes and imports a single XDP stream without changing its bytes', function () {
    const data = xdp()
    const backend = new PdfBackend({ fonts: {}, xfa: { kind: 'document', data } })
    render(emptyDocument(), backend)
    const pdf = backend.toUint8Array()
    const imported = PdfImporter.open(pdf).importXfa()
    expect(imported).toEqual({ kind: 'document', data })

    const doc = parsePdf(pdf)
    const acroForm = doc.resolve(doc.getCatalog().get('AcroForm') ?? null)
    expect(acroForm).toBeInstanceOf(Map)
    const stream = doc.resolve((acroForm as Map<string, unknown>).get('XFA') as never)
    expect(stream).toBeInstanceOf(PdfStream)
    expect(doc.decodeStream(stream as PdfStream)).toEqual(data)
  })

  it('writes and imports an alternating packet-name/stream array in source order', function () {
    const packets = [
      { name: 'preamble', data: bytes('<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">') },
      { name: 'template', data: bytes('<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"/>') },
      { name: 'datasets', data: bytes('<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"/>') },
      { name: 'postamble', data: bytes('</xdp:xdp>') },
    ]
    const backend = new PdfBackend({ fonts: {}, xfa: { kind: 'packets', packets } })
    render(emptyDocument(), backend)
    expect(PdfImporter.open(backend.toUint8Array()).importXfa()).toEqual({ kind: 'packets', packets })
  })

  it('accepts byte-order-marked UTF-16 XDP documents', function () {
    const source = new TextDecoder().decode(xdp())
    const data = new Uint8Array(2 + source.length * 2)
    data[0] = 0xff
    data[1] = 0xfe
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i)
      data[2 + i * 2] = code & 0xff
      data[3 + i * 2] = code >>> 8
    }
    expect(function () { validatePdfXfa({ kind: 'document', data }) }).not.toThrow()
  })

  it('rejects malformed packet models and XML before serialization', function () {
    expect(function () { validatePdfXfa({ kind: 'packets', packets: [] }) }).toThrow(/must not be empty/)
    expect(function () {
      validatePdfXfa({ kind: 'packets', packets: [
        { name: 'same', data: bytes('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">') },
        { name: 'same', data: bytes('</xdp:xdp>') },
      ] })
    }).toThrow(/duplicate packet name/)
    expect(function () { validatePdfXfa({ kind: 'document', data: bytes('<root/>') }) }).toThrow(/root must be xdp/)
    expect(function () {
      validatePdfXfa({ kind: 'document', data: bytes('<xdp:xdp xmlns:xdp="urn:wrong"/>') })
    }).toThrow(/xdp root must use/)
    expect(function () { validatePdfXfa({ kind: 'document', data: new Uint8Array([0xff]) }) }).toThrow(/not valid UTF-8/)
  })

  it('rejects structurally invalid imported XFA arrays', function () {
    const xml = new TextDecoder().decode(xdp())
    const malformed = rawPdf([
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] /XFA [(template) 4 0 R (orphan)] >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>',
      `<< /Length ${bytes(xml).length} >>\nstream\n${xml}\nendstream`,
    ])
    expect(function () { PdfImporter.open(malformed).importXfa() }).toThrow(/alternating name\/stream array/)
  })

  it('keeps XFA out of PDF/A and PDF/X output profiles', function () {
    const data = xdp()
    expect(function () {
      new PdfBackend({ fonts: {}, xfa: { kind: 'document', data }, pdfaConformance: 'PDF/A-2b' })
    }).toThrow(/PDF\/A-2b forbids XFA/)
    expect(function () {
      new PdfBackend({ fonts: {}, xfa: { kind: 'document', data }, pdfxConformance: 'PDF/X-1a' })
    }).toThrow(/PDF\/X-1a forbids interactive forms/)
  })
})
