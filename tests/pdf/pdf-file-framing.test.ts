import { describe, expect, it } from 'vitest'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { parsePdf, readStartXref } from '../../src/pdf/pdf-parser.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'

const encoder = new TextEncoder()

function minimalPdf(header = '%PDF-2.0\n', trailerExtra = ''): Uint8Array {
  const objectOffset = encoder.encode(header).length
  let text = `${header}1 0 obj\n<< /Type /Catalog >>\nendobj\n`
  const xrefOffset = encoder.encode(text).length
  text += 'xref\n0 2\n0000000000 65535 f \n'
  text += `${String(objectOffset).padStart(10, '0')} 00000 n \n`
  text += `trailer\n<< /Size 2 /Root 1 0 R${trailerExtra} >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return encoder.encode(text)
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (let i = 0; i < parts.length; i++) length += parts[i]!.length
  const out = new Uint8Array(length)
  let offset = 0
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i]!, offset)
    offset += parts[i]!.length
  }
  return out
}

function hybridPdf(classicObjectWins: boolean): Uint8Array {
  const parts: Uint8Array[] = []
  let offset = 0
  const push = (part: Uint8Array): number => {
    const at = offset
    parts.push(part)
    offset += part.length
    return at
  }
  push(encoder.encode('%PDF-1.7\n'))
  const object1 = push(encoder.encode('1 0 obj\n<< /Type /Catalog /Target 2 0 R >>\nendobj\n'))
  const object2 = classicObjectWins
    ? push(encoder.encode('2 0 obj\n<< /Value 99 >>\nendobj\n'))
    : -1
  const objectStreamData = encoder.encode('2 0 << /Value 42 >>')
  const object3 = push(concat(
    encoder.encode(`3 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Length ${objectStreamData.length} >>\nstream\n`),
    objectStreamData,
    encoder.encode('\nendstream\nendobj\n'),
  ))
  const xrefStreamData = new Uint8Array([2, 3, 0])
  const object4 = push(concat(
    encoder.encode('4 0 obj\n<< /Type /XRef /Size 5 /Index [2 1] /W [1 1 1] /Length 3 >>\nstream\n'),
    xrefStreamData,
    encoder.encode('\nendstream\nendobj\n'),
  ))
  const xref = offset
  let table = 'xref\n0 5\n0000000000 65535 f \n'
  table += `${String(object1).padStart(10, '0')} 00000 n \n`
  table += classicObjectWins
    ? `${String(object2).padStart(10, '0')} 00000 n \n`
    : '0000000000 00000 f \n'
  table += `${String(object3).padStart(10, '0')} 00000 n \n`
  table += `${String(object4).padStart(10, '0')} 00000 n \n`
  table += `trailer\n<< /Size 5 /Root 1 0 R /XRefStm ${object4} >>\nstartxref\n${xref}\n%%EOF\n`
  push(encoder.encode(table))
  return concat(...parts)
}

describe('PDF file header, trailer, and EOF framing', () => {
  it('accepts every standardized header version and every header EOL form', () => {
    for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0']) {
      for (const eol of ['\n', '\r', '\r\n']) {
        expect(parsePdf(minimalPdf(`%PDF-${version}${eol}`)).headerVersion).toBe(version)
      }
    }
  })

  it('rejects malformed, unsupported, unterminated, and displaced headers', () => {
    expect(() => parsePdf(minimalPdf('%PDF-1.8\n'))).toThrow(/unsupported PDF header version/)
    expect(() => parsePdf(minimalPdf('%PDF-2.1\n'))).toThrow(/unsupported PDF header version/)
    expect(() => parsePdf(minimalPdf('%PDF-20\n'))).toThrow(/invalid PDF header version/)
    expect(() => parsePdf(minimalPdf('%PDF-2.0 '))).toThrow(/header must end/)
    expect(() => parsePdf(concat(new Uint8Array(1024).fill(0x20), minimalPdf()))).toThrow(/first 1024 bytes/)
  })

  it('accepts trailing PDF whitespace after final EOF and rejects any other suffix', () => {
    const source = minimalPdf()
    expect(readStartXref(concat(source, encoder.encode('\0\t\r\n\f ')))).toBe(readStartXref(source))
    expect(() => readStartXref(concat(source, encoder.encode('x')))).toThrow(/non-whitespace data follows/)
    expect(() => readStartXref(encoder.encode(new TextDecoder().decode(source).replace('%%EOF', '')))).toThrow(/final %%EOF/)
  })

  it('follows multiple incremental trailers and validates Prev type, bounds, and cycles', () => {
    const once = appendIncrementalUpdate(minimalPdf(), [{ num: 2, body: '<< /Revision 1 >>' }])
    const twice = appendIncrementalUpdate(once, [{ num: 2, body: '<< /Revision 2 >>' }])
    expect((parsePdf(twice).getObject(2) as Map<string, unknown>).get('Revision')).toBe(2)

    expect(() => parsePdf(minimalPdf('%PDF-2.0\n', ' /Prev /Bad'))).toThrow(/trailer \/Prev must be/)
    expect(() => parsePdf(minimalPdf('%PDF-2.0\n', ' /Prev 999999'))).toThrow(/xref offset.*outside the file/)
    const base = minimalPdf()
    const xref = readStartXref(base)
    expect(() => parsePdf(minimalPdf('%PDF-2.0\n', ` /Prev ${xref}`))).toThrow(/circular xref chain/)
  })

  it('loads hybrid-reference XRefStm entries with the required precedence', () => {
    const compressed = parsePdf(hybridPdf(false))
    expect((compressed.resolve(compressed.getCatalog().get('Target')!) as Map<string, unknown>).get('Value')).toBe(42)
    const normal = parsePdf(hybridPdf(true))
    expect((normal.resolve(normal.getCatalog().get('Target')!) as Map<string, unknown>).get('Value')).toBe(99)
    expect(() => parsePdf(minimalPdf('%PDF-2.0\n', ' /XRefStm /Bad'))).toThrow(/trailer \/XRefStm must be/)
  })

  it('emits a binary marker and a final startxref/EOF pair from the PDF writer', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(10, 10)
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const firstLf = bytes.indexOf(0x0A)
    const secondLf = bytes.indexOf(0x0A, firstLf + 1)
    const marker = bytes.subarray(firstLf + 1, secondLf)
    expect(marker[0]).toBe(0x25)
    expect(Array.from(marker.subarray(1)).filter(byte => byte >= 0x80).length).toBeGreaterThanOrEqual(4)
    expect(readStartXref(bytes)).toBeGreaterThan(0)
    expect(parsePdf(bytes).getCatalog()).toBeInstanceOf(Map)
  })
})
