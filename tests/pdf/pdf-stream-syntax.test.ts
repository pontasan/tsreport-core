import { describe, expect, it } from 'vitest'
import { zlibDeflate } from '../../src/compression/deflate.js'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { parsePdf, PdfStream, PdfString, type PdfDocument, type PdfParseOptions } from '../../src/pdf/pdf-parser.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'

function basePdf(): Uint8Array {
  const backend = new PdfBackend({ fonts: {} })
  render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
  return backend.toUint8Array()
}

function addObjects(
  bodies: Array<{ body: string; gen?: number }>,
  options: PdfParseOptions = {},
): { doc: PdfDocument; first: number } {
  const base = basePdf()
  const first = parsePdf(base).trailer.get('Size') as number
  const updated = appendIncrementalUpdate(base, bodies.map((entry, index) => ({
    num: first + index,
    gen: entry.gen,
    body: entry.body,
  })))
  return { doc: parsePdf(updated, options), first }
}

function streamAt(doc: PdfDocument, number: number): PdfStream {
  const value = doc.getObject(number)
  if (!(value instanceof PdfStream)) throw new Error(`object ${number} is not a stream`)
  return value
}

describe('PDF stream syntax and external-file streams', () => {
  it('accepts LF and CRLF after stream with a direct Length', () => {
    const { doc, first } = addObjects([
      { body: '<< /Length 3 >>\nstream\nABC\nendstream' },
      { body: '<< /Length 3 >>\r\nstream\r\nDEF\r\nendstream' },
    ])
    expect(new TextDecoder().decode(streamAt(doc, first).raw)).toBe('ABC')
    expect(new TextDecoder().decode(streamAt(doc, first + 1).raw)).toBe('DEF')
  })

  it('resolves an indirect Length before slicing stream data', () => {
    const base = basePdf()
    const first = parsePdf(base).trailer.get('Size') as number
    const updated = appendIncrementalUpdate(base, [
      { num: first, body: '4' },
      { num: first + 1, body: `<< /Length ${first} 0 R >>\nstream\nDATA\nendstream` },
    ])
    const doc = parsePdf(updated)
    expect(new TextDecoder().decode(streamAt(doc, first + 1).raw)).toBe('DATA')
  })

  it('applies a filter array and the DecodeParms entry at the same index', () => {
    const expected = new Uint8Array([10, 20, 30, 40, 50])
    const compressed = zlibDeflate(expected)
    const encoded = Array.from(compressed, (byte) => byte.toString(16).padStart(2, '0')).join('') + '>'
    const { doc, first } = addObjects([{
      body: `<< /Length ${encoded.length} /Filter [/ASCIIHexDecode /FlateDecode] /DecodeParms [null << /Predictor 1 >>] >>\nstream\n${encoded}\nendstream`,
    }])
    expect(doc.decodeStream(streamAt(doc, first))).toEqual(expected)
  })

  it('resolves and filters an external-file stream through an explicit public callback', () => {
    let requested = ''
    const external = new TextEncoder().encode('414243>')
    const { doc, first } = addObjects([{
      body: '<< /Length 0 /F (external.bin) /FFilter /ASCIIHexDecode /FDecodeParms null >>\nstream\n\nendstream',
    }], {
      externalFileResolver(fileSpecification) {
        if (!(fileSpecification instanceof PdfString)) throw new Error('expected a string file specification')
        requested = new TextDecoder().decode(fileSpecification.bytes)
        return external
      },
    })
    expect(new TextDecoder().decode(doc.decodeStream(streamAt(doc, first)))).toBe('ABC')
    expect(requested).toBe('external.bin')
  })

  it('does not silently substitute inline bytes when an external resolver is absent', () => {
    const { doc, first } = addObjects([{
      body: '<< /Length 0 /F (external.bin) >>\nstream\n\nendstream',
    }])
    expect(() => doc.decodeStream(streamAt(doc, first))).toThrow('externalFileResolver')
  })

  it('rejects DecodeParms arrays that do not match the Filter array', () => {
    const { doc, first } = addObjects([{
      body: '<< /Length 2 /Filter [/ASCIIHexDecode /RunLengthDecode] /DecodeParms [null] >>\nstream\n>\nendstream',
    }])
    expect(() => doc.decodeStream(streamAt(doc, first))).toThrow('DecodeParms array length must match')
  })

  it('rejects a stream keyword without the required LF or CRLF marker', () => {
    const { doc, first } = addObjects([{
      body: '<< /Length 3 >>\nstream ABC\nendstream',
    }])
    expect(() => doc.getObject(first)).toThrow('stream keyword must be followed by LF or CRLF')
  })
})
