import { describe, expect, it } from 'vitest'
import {
  parseFdf,
  writeFdf,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  type PdfDict,
} from '../../src/index.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function string(value: string): PdfString {
  return new PdfString(encoder.encode(value))
}

function field(name: string, value: string, kids?: PdfDict[]): PdfDict {
  const result: PdfDict = new Map([
    ['T', string(name)],
    ['V', string(value)],
    ['Ff', 1],
    ['SetF', 4],
    ['ClrF', 2],
    ['Opt', [string('A'), [string('B'), string('B appearance')]]],
  ])
  if (kids !== undefined) result.set('Kids', kids)
  return result
}

describe('Forms Data Format', () => {
  it('writes and reads fields, status, encoding, identifiers, and annotations without an xref table', () => {
    const child = field('child', 'child-value')
    const rootField = field('root', 'root-value', [child])
    const annotation: PdfDict = new Map([
      ['Type', new PdfName('Annot')],
      ['Subtype', new PdfName('Text')],
      ['Page', 0],
      ['Contents', string('note')],
    ])
    const fdf: PdfDict = new Map([
      ['F', string('target.pdf')],
      ['ID', [new PdfString(new Uint8Array([1, 2])), new PdfString(new Uint8Array([3, 4]))]],
      ['Fields', [rootField]],
      ['Status', string('Imported')],
      ['Encoding', new PdfName('Shift_JIS')],
      ['Annots', [annotation]],
      ['Target', string('frame')],
    ])
    const catalog: PdfDict = new Map([
      ['Version', new PdfName('2.0')],
      ['FDF', fdf],
    ])
    const bytes = writeFdf({ catalog })
    expect(decoder.decode(bytes)).toContain('%FDF-1.2\n')
    expect(decoder.decode(bytes)).not.toContain('\nxref\n')

    const parsed = parseFdf(bytes)
    expect(parsed.headerVersion).toBe('1.2')
    expect((parsed.catalog.get('Version') as PdfName).name).toBe('2.0')
    expect(decoder.decode((parsed.fdf.get('Status') as PdfString).bytes)).toBe('Imported')
    const fields = parsed.fdf.get('Fields') as PdfDict[]
    expect(decoder.decode((fields[0]!.get('T') as PdfString).bytes)).toBe('root')
    expect(decoder.decode((((fields[0]!.get('Kids') as PdfDict[])[0]!.get('V')) as PdfString).bytes)).toBe('child-value')
    expect(((parsed.fdf.get('Annots') as PdfDict[])[0]!.get('Page'))).toBe(0)
  })

  it('round-trips indirect objects, Differences streams, JavaScript, and an optional xref table', () => {
    const differences = new PdfStream(new Map([['Length', 999]]), new Uint8Array([1, 2, 3, 4]), 5, 0)
    const fdf: PdfDict = new Map([
      ['Fields', [new PdfRef(3, 0)]],
      ['Differences', new PdfRef(5, 0)],
      ['EmbeddedFDFs', [string('child.fdf')]],
      ['JavaScript', new Map([
        ['Before', string('before()')],
        ['After', string('after()')],
        ['Doc', [string('library'), string('function library(){}')]],
      ])],
    ])
    const catalog: PdfDict = new Map([['FDF', fdf]])
    const objects = new Map<number, PdfDict | PdfStream>([
      [3, field('indirect', 'value')],
      [5, differences],
    ])
    const bytes = writeFdf({ catalog, objects, rootObjectNumber: 2, includeXref: true })
    expect(decoder.decode(bytes)).toContain('\nxref\n')
    const parsed = parseFdf(bytes)
    expect(parsed.root).toEqual(new PdfRef(2, 0))
    expect(parsed.resolve(new PdfRef(5, 0))).toBeInstanceOf(PdfStream)
    expect(Array.from((parsed.resolve(new PdfRef(5, 0)) as PdfStream).raw)).toEqual([1, 2, 3, 4])

    const second = parseFdf(writeFdf({
      catalog: parsed.catalog,
      objects: parsed.objects,
      rootObjectNumber: parsed.root.num,
      includeXref: true,
    }))
    expect((second.resolve((second.fdf.get('Fields') as PdfRef[])[0]!) as PdfDict).get('Ff')).toBe(1)
  })

  it('supports the mutually exclusive FDF Pages/template/named-page structure', () => {
    const namedPage: PdfDict = new Map([
      ['Name', string('InvoiceTemplate')],
      ['F', string('templates.pdf')],
    ])
    const template: PdfDict = new Map([
      ['TRef', namedPage],
      ['Rename', false],
    ])
    const page: PdfDict = new Map([
      ['Templates', [template]],
      ['Info', new Map()],
    ])
    const catalog: PdfDict = new Map([['FDF', new Map([['Pages', [page]]])]])
    const parsed = parseFdf(writeFdf({ catalog, includeXref: true }))
    const pages = parsed.fdf.get('Pages') as PdfDict[]
    const templates = pages[0]!.get('Templates') as PdfDict[]
    const reference = templates[0]!.get('TRef') as PdfDict
    expect(decoder.decode((reference.get('Name') as PdfString).bytes)).toBe('InvoiceTemplate')
  })

  it('rejects FDF envelope, generation, duplicate-object, and indirect stream-Length violations', () => {
    expect(() => parseFdf(encoder.encode('%PDF-1.2\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'))).toThrow(/header must be %FDF-1.2/)
    expect(() => parseFdf(encoder.encode('%FDF-1.3\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'))).toThrow(/header must be %FDF-1.2/)
    expect(() => parseFdf(encoder.encode('%FDF-1.2\n1 1 obj\n<< /FDF <<>> >>\nendobj\ntrailer\n<< /Root 1 1 R >>\n%%EOF\n'))).toThrow(/generation 0/)
    expect(() => parseFdf(encoder.encode('%FDF-1.2\n1 0 obj\n<< /FDF <<>> >>\nendobj\n1 0 obj\nnull\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'))).toThrow(/duplicate object/)
    expect(() => parseFdf(encoder.encode('%FDF-1.2\n1 0 obj\n<< /FDF << /Differences 2 0 R >> >>\nendobj\n2 0 obj\n<< /Length 3 0 R >>\nstream\nx\nendstream\nendobj\n3 0 obj\n1\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'))).toThrow(/Length must be a direct/)
  })

  it('rejects invalid field, page, annotation, JavaScript, and mutual-exclusion structures', () => {
    const invalid: PdfDict[] = [
      new Map([['Fields', [new Map()]]]),
      new Map([['Pages', []], ['Fields', []]]),
      new Map([['Pages', [new Map()]]]),
      new Map([['Annots', [new Map([['Subtype', new PdfName('Text')]])]]]),
      new Map([['Annots', [new Map([['Subtype', new PdfName('Widget')], ['Page', 0]])]]]),
      new Map([['JavaScript', new Map([['Doc', [string('name')]]])]]),
    ]
    for (let i = 0; i < invalid.length; i++) {
      expect(() => writeFdf({ catalog: new Map([['FDF', invalid[i]!]]) })).toThrow(/FDF validation error/)
    }
    const directStream = new PdfStream(new Map([['Length', 1]]), new Uint8Array([1]), 0, 0)
    expect(() => writeFdf({ catalog: new Map([['FDF', new Map([['Differences', directStream]])]]) }))
      .toThrow(/streams must be indirect objects/)
  })

  it('validates an included xref table against generation-0 object offsets', () => {
    const valid = writeFdf({ catalog: new Map([['FDF', new Map()]]) , includeXref: true })
    const text = decoder.decode(valid)
    const corrupted = text.replace('00000 n', '00001 n')
    expect(() => parseFdf(encoder.encode(corrupted))).toThrow(/xref entry does not match object/)
  })
})
