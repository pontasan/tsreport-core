import { describe, expect, it } from 'vitest'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { parsePdf, PdfRef } from '../../src/pdf/pdf-parser.js'
import { rewritePdfToTraditional } from '../../src/pdf/pdf-rewrite.js'

const encoder = new TextEncoder()

interface ClassicObject {
  num: number
  generation: number
  body: string
}

interface FreeEntry {
  next: number
  generation: number
}

function classicPdf(objects: ClassicObject[], size: number, freeEntries: Map<number, FreeEntry>): Uint8Array {
  let body = '%PDF-2.0\n'
  const offsets = new Map<number, number>()
  const generations = new Map<number, number>()
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i]!
    offsets.set(object.num, encoder.encode(body).length)
    generations.set(object.num, object.generation)
    body += `${object.num} ${object.generation} obj\n${object.body}\nendobj\n`
  }
  const xrefOffset = encoder.encode(body).length
  body += `xref\n0 ${size}\n`
  for (let num = 0; num < size; num++) {
    const offset = offsets.get(num)
    if (offset !== undefined) {
      body += `${String(offset).padStart(10, '0')} ${String(generations.get(num)!).padStart(5, '0')} n \n`
    } else {
      const free = freeEntries.get(num) ?? { next: 0, generation: 0xFFFF }
      body += `${String(free.next).padStart(10, '0')} ${String(free.generation).padStart(5, '0')} f \n`
    }
  }
  const root = objects.find(object => object.body.includes('/Type /Catalog'))!
  body += `trailer\n<< /Size ${size} /Root ${root.num} ${root.generation} R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return encoder.encode(body)
}

function generationPdf(): Uint8Array {
  return classicPdf([
    { num: 1, generation: 2, body: '<< /Type /Catalog /Target 2 4 R >>' },
    { num: 2, generation: 4, body: '<< /Value 42 >>' },
  ], 4, new Map([
    [0, { next: 3, generation: 0xFFFF }],
    [3, { next: 0, generation: 1 }],
  ]))
}

function xrefStreamEntry(type: number, field1: number, field2: number): Uint8Array {
  return new Uint8Array([type, (field1 >> 8) & 0xFF, field1 & 0xFF, (field2 >> 8) & 0xFF, field2 & 0xFF])
}

function objectStreamPdf(data: string, first = 4, objectStreamGeneration = 0): Uint8Array {
  const header = encoder.encode('%PDF-2.0\n')
  const catalog = encoder.encode('1 0 obj\n<< /Type /Catalog /Target 2 0 R >>\nendobj\n')
  const objectStreamOffset = header.length + catalog.length
  const payload = encoder.encode(data)
  const objectStream = concatBytes(
    encoder.encode(`3 ${objectStreamGeneration} obj\n<< /Type /ObjStm /N 1 /First ${first} /Length ${payload.length} >>\nstream\n`),
    payload,
    encoder.encode('\nendstream\nendobj\n'),
  )
  const xrefOffset = objectStreamOffset + objectStream.length
  const entries = concatBytes(
    xrefStreamEntry(0, 0, 0xFFFF),
    xrefStreamEntry(1, header.length, 0),
    xrefStreamEntry(2, 3, 0),
    xrefStreamEntry(1, objectStreamOffset, objectStreamGeneration),
    xrefStreamEntry(1, xrefOffset, 0),
  )
  const xref = concatBytes(
    encoder.encode(`4 0 obj\n<< /Type /XRef /Size 5 /W [1 2 2] /Root 1 0 R /Length ${entries.length} >>\nstream\n`),
    entries,
    encoder.encode(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`),
  )
  return concatBytes(header, catalog, objectStream, xref)
}

function cyclicExtendsPdf(): Uint8Array {
  const header = encoder.encode('%PDF-2.0\n')
  const catalog = encoder.encode('1 0 obj\n<< /Type /Catalog /Target 2 0 R >>\nendobj\n')
  const offset3 = header.length + catalog.length
  const payload3 = encoder.encode('2 0 << /Value 42 >>')
  const stream3 = concatBytes(
    encoder.encode(`3 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Extends 5 0 R /Length ${payload3.length} >>\nstream\n`),
    payload3,
    encoder.encode('\nendstream\nendobj\n'),
  )
  const offset5 = offset3 + stream3.length
  const stream5 = encoder.encode('5 0 obj\n<< /Type /ObjStm /N 0 /First 0 /Extends 3 0 R /Length 0 >>\nstream\n\nendstream\nendobj\n')
  const xrefOffset = offset5 + stream5.length
  const entries = concatBytes(
    xrefStreamEntry(0, 0, 0xFFFF),
    xrefStreamEntry(1, header.length, 0),
    xrefStreamEntry(2, 3, 0),
    xrefStreamEntry(1, offset3, 0),
    xrefStreamEntry(0, 0, 0xFFFF),
    xrefStreamEntry(1, offset5, 0),
    xrefStreamEntry(1, xrefOffset, 0),
  )
  const xref = concatBytes(
    encoder.encode(`6 0 obj\n<< /Type /XRef /Size 7 /W [1 2 2] /Root 1 0 R /Length ${entries.length} >>\nstream\n`),
    entries,
    encoder.encode(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`),
  )
  return concatBytes(header, catalog, stream3, stream5, xref)
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
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

describe('PDF cross-reference object identity', () => {
  it('resolves only the active generation and exposes free-entry generations', () => {
    const document = parsePdf(generationPdf())
    const catalog = document.getCatalog()
    expect(document.resolve(catalog.get('Target')!)).toBeInstanceOf(Map)
    expect(document.resolve(new PdfRef(2, 3))).toBeNull()
    expect(document.getObjectGeneration(1)).toBe(2)
    expect(document.getObjectGeneration(2)).toBe(4)
    expect(document.getObjectGeneration(3)).toBe(1)
    expect(document.getObjectReferences().map(function (reference) {
      return [reference.num, reference.gen]
    })).toEqual([[1, 2], [2, 4]])
    expect(document.isObjectFree(3)).toBe(true)
    expect(document.getFreeObjectNext(0)).toBe(3)
  })

  it('rejects a generation mismatch between an xref entry and its indirect-object header', () => {
    const bytes = generationPdf()
    const text = new TextDecoder().decode(bytes).replace('00002 n', '00003 n')
    const document = parsePdf(encoder.encode(text))
    expect(() => document.getObject(1)).toThrow(/generation mismatch/)
  })

  it('rejects invalid object-zero entries and non-zero free-list cycles', () => {
    const badZero = classicPdf([
      { num: 1, generation: 0, body: '<< /Type /Catalog >>' },
    ], 2, new Map([[0, { next: 0, generation: 0 }]]))
    expect(() => parsePdf(badZero)).toThrow(/object 0.*generation 65535/)

    const cycle = classicPdf([
      { num: 1, generation: 0, body: '<< /Type /Catalog >>' },
    ], 4, new Map([
      [0, { next: 2, generation: 0xFFFF }],
      [2, { next: 3, generation: 1 }],
      [3, { next: 2, generation: 2 }],
    ]))
    expect(() => parsePdf(cycle)).toThrow(/circular free xref list/)
  })

  it('detects recursive indirect-object resolution through a stream Length reference', () => {
    const bytes = classicPdf([
      { num: 1, generation: 0, body: '<< /Type /Catalog /Data 2 0 R >>' },
      { num: 2, generation: 0, body: '<< /Length 2 0 R >>\nstream\nx\nendstream' },
    ], 3, new Map([[0, { next: 0, generation: 0xFFFF }]]))
    const document = parsePdf(bytes)
    expect(() => document.getObject(2)).toThrow(/circular indirect object resolution/)
  })

  it('preserves active generations through incremental replacement and traditional rewrite', () => {
    const source = generationPdf()
    const updated = appendIncrementalUpdate(source, [
      { num: 2, gen: 4, body: '<< /Value 84 >>' },
    ])
    const updatedDocument = parsePdf(updated)
    expect((updatedDocument.getObject(2, 4) as Map<string, unknown>).get('Value')).toBe(84)
    expect(() => appendIncrementalUpdate(source, [{ num: 2, gen: 0, body: 'null' }])).toThrow(/active generation 4/)

    const rewritten = parsePdf(rewritePdfToTraditional(updated))
    expect(rewritten.trailer.get('Root')).toEqual(new PdfRef(1, 2))
    expect(rewritten.getObjectGeneration(1)).toBe(2)
    expect(rewritten.getObjectGeneration(2)).toBe(4)
    expect(rewritten.getObjectGeneration(3)).toBe(1)
  })

  it('reuses a free object only at its active generation and rebuilds the free list', () => {
    const source = generationPdf()
    const reused = appendIncrementalUpdate(source, [
      { num: 3, gen: 1, body: '<< /Reused true >>' },
    ])
    const document = parsePdf(reused)
    expect((document.getObject(3, 1) as Map<string, unknown>).get('Reused')).toBe(true)
    expect(document.getFreeObjectNext(0)).toBe(0)
    expect(() => appendIncrementalUpdate(source, [{ num: 3, gen: 0, body: 'null' }])).toThrow(/active generation 1/)
  })

  it('resolves generation-0 compressed objects by their object-stream index', () => {
    const document = parsePdf(objectStreamPdf('2 0 << /Value 42 >>'))
    const target = document.resolve(document.getCatalog().get('Target')!) as Map<string, unknown>
    expect(target.get('Value')).toBe(42)
    expect(document.resolve(new PdfRef(2, 1))).toBeNull()
  })

  it('rejects forbidden compressed-object forms and malformed object-stream offsets', () => {
    expect(() => parsePdf(objectStreamPdf('2 0 1 0 R')).getObject(2)).toThrow(/cannot consist only of an indirect reference/)
    expect(() => parsePdf(objectStreamPdf('2 1 x<< /Value 42 >>')).getObject(2)).toThrow(/offsets must be strictly increasing from zero/)
    expect(() => parsePdf(objectStreamPdf('2 0 << /Value 42 >> true')).getObject(2)).toThrow(/trailing data in compressed object/)
    expect(() => parsePdf(objectStreamPdf('2 0 << /Value 42 >>', 4, 1)).getObject(2)).toThrow(/uncompressed generation-0 object/)
  })

  it('rejects a cycle in an object-stream Extends graph', () => {
    expect(() => parsePdf(cyclicExtendsPdf()).getObject(2)).toThrow(/circular object stream \/Extends graph/)
  })
})
