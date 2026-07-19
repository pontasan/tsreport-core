// PDF 2.0 structure namespaces (ISO 32000-2 14.7.4): StructTreeRoot /Namespaces
// array of Namespace dicts, referenced by per-element /NS.
import { describe, expect, it } from 'vitest'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { render } from '../../src/renderer/renderer.js'
import { parsePdf, PdfStream } from '../../src/pdf/pdf-parser.js'
import type { RenderDocument } from '../../src/types/render.js'

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1')

describe('structure namespaces', () => {
  it('emits a /Namespaces array and per-element /NS references', () => {
    const doc: RenderDocument = {
      tagged: true,
      structureNamespaces: ['http://iso.org/pdf2/ssn', 'http://www.w3.org/1998/Math/MathML'],
      pages: [{ width: 200, height: 100, children: [
        { type: 'text', x: 10, y: 20, text: 'Heading', fontId: 'd', fontSize: 16, color: '#000000', tag: { role: 'H1', namespaceIndex: 0 } },
        { type: 'text', x: 10, y: 50, text: 'Formula', fontId: 'd', fontSize: 12, color: '#000000', tag: { role: 'Formula', namespaceIndex: 1 } },
      ] }],
    }
    const backend = new PdfBackend({ fonts: { d: makeFont() } })
    render(doc, backend)
    const pdf = parsePdf(backend.toUint8Array())
    const structRoot = resolveStructTreeRoot(pdf)
    const namespaces = pdf.resolve(structRoot.get('Namespaces') ?? null) as unknown[]
    expect(namespaces).toHaveLength(2)
    const ns0 = pdf.resolve(namespaces[0] as never) as Map<string, unknown>
    const ns1 = pdf.resolve(namespaces[1] as never) as Map<string, unknown>
    expect(ns0.get('Type')).toMatchObject({ name: 'Namespace' })
    expect(latin1((ns0.get('NS') as { bytes: Uint8Array }).bytes)).toBe('http://iso.org/pdf2/ssn')
    expect(latin1((ns1.get('NS') as { bytes: Uint8Array }).bytes)).toBe('http://www.w3.org/1998/Math/MathML')

    // Each StructElem references its namespace by object.
    const elems = collectStructElems(pdf, structRoot)
    const h1 = elems.find(e => (e.get('S') as { name: string }).name === 'H1')!
    const formula = elems.find(e => (e.get('S') as { name: string }).name === 'Formula')!
    expect(pdf.resolve(h1.get('NS') as never)).toBe(ns0)
    expect(pdf.resolve(formula.get('NS') as never)).toBe(ns1)
  })

  it('round-trips RoleMapNS, schema files, and NSO attribute ownership', () => {
    const doc: RenderDocument = {
      tagged: true,
      structureNamespaces: [
        {
          uri: 'urn:example:report',
          schemaFileIndex: 0,
          roleMap: { section: { role: 'H1', namespaceIndex: 1 } },
        },
        { uri: 'http://iso.org/pdf2/ssn' },
      ],
      pages: [{ width: 200, height: 100, children: [{
        type: 'text', x: 10, y: 20, text: 'Namespace heading', fontId: 'd', fontSize: 12, color: '#000000',
        tag: {
          role: 'section', namespaceIndex: 0,
          attributes: [{ owner: 'NSO', namespaceIndex: 0, entries: { level: 1 } }],
        },
      }] }],
    }
    const backend = new PdfBackend({
      fonts: { d: makeFont() },
      embeddedFiles: [{ name: 'report-schema.xml', data: new TextEncoder().encode('<schema/>') }],
    })
    render(doc, backend)
    const bytes = backend.toUint8Array()
    const model = PdfImporter.open(bytes).importStructureModel()!
    expect(model.namespaces).toMatchObject([
      {
        uri: 'urn:example:report', schemaFileIndex: 0,
        roleMap: { section: { role: 'H1', namespaceIndex: 1 } },
      },
      { uri: 'http://iso.org/pdf2/ssn', roleMap: {} },
    ])
    expect(model.roots[0]).toMatchObject({
      role: 'section', namespaceIndex: 0, mappedRole: 'H1', mappedNamespaceIndex: 1,
      attributes: [{ owner: 'NSO', namespaceIndex: 0, entries: { level: 1 } }],
    })
  })

  it('automatically assigns PDF 2.0-only structure types to the PDF 2.0 namespace', () => {
    const backend = new PdfBackend({ fonts: { d: makeFont() } })
    render({
      tagged: true,
      pages: [{ width: 200, height: 100, children: [{
        type: 'text', x: 10, y: 20, text: 'Deep heading', fontId: 'd', fontSize: 12, color: '#000000',
        tag: { role: 'H12' },
      }] }],
    }, backend)
    const model = PdfImporter.open(backend.toUint8Array()).importStructureModel()!
    expect(model.namespaces[0]!.uri).toBe('http://iso.org/pdf2/ssn')
    expect(model.roots[0]).toMatchObject({ role: 'H12', namespaceIndex: 0 })
  })
})

// Minimal embeddable font from the Roboto fixture.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
function makeFont(): Font {
  const b = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf'))
  return Font.load(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
}
function resolveStructTreeRoot(pdf: ReturnType<typeof parsePdf>): Map<string, unknown> {
  const catalog = pdf.getCatalog()
  return pdf.resolve(catalog.get('StructTreeRoot') ?? null) as Map<string, unknown>
}
function collectStructElems(pdf: ReturnType<typeof parsePdf>, root: Map<string, unknown>): Map<string, unknown>[] {
  const out: Map<string, unknown>[] = []
  const walk = (node: unknown): void => {
    const m = pdf.resolve(node as never)
    if (!(m instanceof Map)) return
    if ((m.get('Type') as { name?: string })?.name === 'StructElem') out.push(m)
    const k = pdf.resolve(m.get('K') ?? null)
    if (Array.isArray(k)) for (const c of k) walk(c)
    else if (k instanceof Map && (k.get('Type') as { name?: string })?.name === 'StructElem') walk(k)
  }
  const k = pdf.resolve(root.get('K') ?? null)
  if (Array.isArray(k)) for (const c of k) walk(c)
  else walk(k)
  return out
}
