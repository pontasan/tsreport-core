// Incremental update writer (ISO 32000 §7.5.6): append changed/new objects with
// a /Prev-chained xref, leaving the original bytes untouched.

import { describe, expect, it } from 'vitest'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { parsePdf, PdfRef, PdfStream } from '../../src/pdf/pdf-parser.js'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

function basePdf(): Uint8Array {
  const backend = new PdfBackend({ fonts: {}, metadata: { title: 'Original' } })
  backend.beginDocument()
  backend.beginPage(100, 100)
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}

describe('appendIncrementalUpdate', () => {
  it('replaces an existing object through a /Prev-chained xref, preserving original bytes', () => {
    const base = basePdf()
    const infoRef = parsePdf(base).trailer.get('Info')
    expect(infoRef).toBeInstanceOf(PdfRef)
    const ref = infoRef as PdfRef

    const updated = appendIncrementalUpdate(base, [
      { num: ref.num, gen: ref.gen, body: '<< /Title (Updated) >>' },
    ])

    // The original bytes are an exact prefix (nothing rewritten).
    expect(updated.subarray(0, base.length)).toEqual(base)
    expect(updated.length).toBeGreaterThan(base.length)

    const doc = parsePdf(updated)
    // The newest trailer carries /Info forward; the replaced object wins.
    const info = doc.resolve(doc.trailer.get('Info') ?? null) as Map<string, unknown>
    expect(latin1((info.get('Title') as { bytes: Uint8Array }).bytes)).toBe('Updated')
    // An untouched object still resolves through the /Prev chain.
    expect(doc.getCatalog().get('Type')).toMatchObject({ name: 'Catalog' })
  })

  it('adds a new object (stream) reachable in the updated document', () => {
    const base = basePdf()
    const size = parsePdf(base).trailer.get('Size') as number
    const newNum = size // next free object number

    const data = 'hello incremental'
    const updated = appendIncrementalUpdate(base, [
      { num: newNum, body: `<< /Length ${data.length} >>\nstream\n${data}\nendstream` },
    ])

    const doc = parsePdf(updated)
    const obj = doc.getObject(newNum)
    expect(obj).toBeInstanceOf(PdfStream)
    expect(latin1(doc.decodeStream(obj as PdfStream))).toBe(data)
  })

  it('writes a /Prev-chained cross-reference stream revision', () => {
    const base = basePdf()
    const size = parsePdf(base).trailer.get('Size') as number
    const updated = appendIncrementalUpdate(base, [
      { num: size, body: '<< /Revision /XRefStream >>' },
    ], undefined, { xrefFormat: 'stream' })
    expect(updated.subarray(0, base.length)).toEqual(base)
    const tail = latin1(updated.subarray(base.length))
    expect(tail).toContain('/Type /XRef')
    expect(tail).toContain('/W [1 8 2]')
    expect(tail).not.toContain('\nxref\n')
    const document = parsePdf(updated)
    expect((document.getObject(size) as Map<string, unknown>).get('Revision')).toMatchObject({ name: 'XRefStream' })
    expect(document.getCatalog().get('Type')).toMatchObject({ name: 'Catalog' })
  })

  it('rejects an empty object list', () => {
    expect(() => appendIncrementalUpdate(basePdf(), [])).toThrow(/at least one object/)
  })
})
