// PDF linearization (ISO 32000-1 Annex F). Structure and hint tables are
// validated with qpdf --check-linearization when qpdf is installed — qpdf
// decodes the hint stream and cross-checks every offset, length, and shared
// object reference against the actual file layout.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { linearizePdf } from '../../src/pdf/pdf-linearize.js'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { parsePdf, PdfRef, PdfName, PdfString } from '../../src/pdf/pdf-parser.js'

function qpdfPath(): string | null {
  for (const p of ['/opt/homebrew/bin/qpdf', '/usr/bin/qpdf', '/usr/local/bin/qpdf']) {
    try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p } catch { /* not here */ }
  }
  try { execFileSync('qpdf', ['--version'], { stdio: 'ignore' }); return 'qpdf' } catch { return null }
}
const QPDF = qpdfPath()

function checkLinearization(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'lin-'))
  try {
    const file = join(dir, 'doc.pdf')
    writeFileSync(file, bytes)
    try {
      return execFileSync(QPDF!, ['--check-linearization', file], { encoding: 'utf8' })
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? (e as Error).message)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function inspectWithQpdf(bytes: Uint8Array, option: '--show-linearization' | '--check'): string {
  const dir = mkdtempSync(join(tmpdir(), 'lin-inspect-'))
  try {
    const file = join(dir, 'doc.pdf')
    writeFileSync(file, bytes)
    return execFileSync(QPDF!, [option, file], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function findRevision(pdf: Uint8Array, expected: string): boolean {
  const doc = parsePdf(pdf)
  const size = doc.trailer.get('Size') as number
  for (let object = 1; object < size; object++) {
    let value: unknown
    try { value = doc.getObject(object) } catch { continue }
    if (!(value instanceof Map)) continue
    const revision = value.get('Revision')
    if (revision instanceof PdfString && new TextDecoder().decode(revision.bytes) === expected) return true
  }
  return false
}

/** Build a simple N-page PDF with a shared font and per-page content streams. */
function buildPdf(pageCount: number, id?: string, sharedAfterFirstPage = false): Uint8Array {
  const objs: string[] = []
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ')
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`)
  const fontNum = 3 + pageCount * 2
  const lateSharedNum = fontNum + 1
  for (let i = 0; i < pageCount; i++) {
    const lateShared = sharedAfterFirstPage && i > 0 ? ` /ExtGState << /GS1 ${lateSharedNum} 0 R >>` : ''
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents ${3 + pageCount + i} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >>${lateShared} >> >>`)
  }
  for (let i = 0; i < pageCount; i++) {
    const useLateShared = sharedAfterFirstPage && i > 0 ? ' q /GS1 gs Q' : ''
    const s = `BT /F1 12 Tf 10 50 Td (Page ${i + 1}) Tj ET${useLateShared}`
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`)
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  if (sharedAfterFirstPage) objs.push('<< /Type /ExtGState /CA 0.5 /ca 0.5 >>')
  let body = '%PDF-1.7\n'
  const offsets: number[] = []
  for (let i = 0; i < objs.length; i++) {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xrefOff = body.length
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  const idEntry = id ? ` /ID [${id} ${id}]` : ''
  body += `${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${idEntry} >>\nstartxref\n${xrefOff}\n%%EOF\n`
  const bytes = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xFF
  return bytes
}

describe('linearizePdf', () => {
  it('produces a well-formed linearized structure our parser reads back', () => {
    const lin = linearizePdf(buildPdf(3))
    // The linearization parameter dictionary is the first object in the file.
    const head = new TextDecoder().decode(lin.subarray(0, 300))
    expect(head).toContain('/Linearized 1')
    expect(head).toMatch(/\/L \d+ \/H \[ \d+ \d+ \] \/O \d+ \/E \d+ \/N 3 \/T \d+/)
    // /L equals the actual file length.
    const l = Number(/\/L (\d+)/.exec(head)![1])
    expect(l).toBe(lin.length)
    // Our own parser reads the linearized file: catalog, page tree, contents.
    const doc = parsePdf(lin)
    const catalog = doc.getCatalog()
    const pages = doc.resolve(catalog.get('Pages') ?? null) as Map<string, never>
    expect(doc.resolve(pages.get('Count'))).toBe(3)
    const kids = doc.resolve(pages.get('Kids')) as unknown[]
    expect(kids).toHaveLength(3)
    const firstPage = doc.resolve(kids[0] as PdfRef) as Map<string, unknown>
    expect((doc.resolve(firstPage.get('Type') as never) as PdfName).name).toBe('Page')
  })

  it('linearizes a PDF carrying a full /ID pair (reserves enough main-trailer room)', () => {
    // A standard 16-byte /ID pair makes the main trailer exceed the 90-byte
    // floor; the reserved region must grow with the /ID length. Encrypted and
    // PDF/A inputs always carry /ID, so this must not throw.
    const id = '<0123456789abcdef0123456789abcdef>'
    const lin = linearizePdf(buildPdf(3, id))
    const doc = parsePdf(lin)
    const pages = doc.resolve(doc.getCatalog().get('Pages') ?? null) as Map<string, never>
    expect(doc.resolve(pages.get('Count'))).toBe(3)
    // The main trailer preserves the /ID.
    expect(new TextDecoder().decode(lin)).toContain('/ID [<0123456789abcdef0123456789abcdef>')
  })

  it('linearizes a PDF with an oversized /ID pair (first-trailer region grows)', () => {
    // A 32-byte /ID pair (64 hex chars each) overflows the fixed 160-byte
    // first-trailer floor; the reserved region must grow with the /ID length.
    // Some producers and imported files carry /IDs longer than 16 bytes.
    const id = '<' + 'ab'.repeat(32) + '>'
    const lin = linearizePdf(buildPdf(2, id))
    const doc = parsePdf(lin)
    const pages = doc.resolve(doc.getCatalog().get('Pages') ?? null) as Map<string, never>
    expect(doc.resolve(pages.get('Count'))).toBe(2)
    expect(new TextDecoder().decode(lin)).toContain('ab'.repeat(32))
  })

  it('places the first page section before every other page object', () => {
    const lin = linearizePdf(buildPdf(3))
    const text = new TextDecoder().decode(lin)
    const doc = parsePdf(lin)
    const catalog = doc.getCatalog()
    const pages = doc.resolve(catalog.get('Pages') ?? null) as Map<string, never>
    const kids = doc.resolve(pages.get('Kids')) as PdfRef[]
    const posOf = (num: number): number => text.indexOf(`\n${num} 0 obj`)
    const firstPagePos = posOf(kids[0]!.num)
    for (let i = 1; i < kids.length; i++) {
      expect(firstPagePos).toBeLessThan(posOf(kids[i]!.num))
    }
  })

  it.skipIf(QPDF === null)('passes qpdf --check-linearization for 1, 3, and 8 page documents', () => {
    for (const n of [1, 3, 8]) {
      const lin = linearizePdf(buildPdf(n))
      expect(checkLinearization(lin), `${n} pages`).toContain('no linearization errors')
    }
  })

  it.skipIf(QPDF === null)('encodes real content ranges and a part-8 shared object in every hint field', () => {
    const lin = linearizePdf(buildPdf(3, undefined, true))
    const hints = inspectWithQpdf(lin, '--show-linearization')
    expect(hints).toMatch(/min_content_offset: [1-9]\d*/)
    expect(hints).toMatch(/min_content_length: [1-9]\d*/)
    expect(hints).toMatch(/Page 0:[\s\S]*?content_offset: [1-9]\d*[\s\S]*?content_length: [1-9]\d*/)
    expect(hints).toMatch(/Page 1:[\s\S]*?nshared_objects: [1-9]\d*/)
    expect(hints).toMatch(/first_shared_obj: [1-9]\d*/)
    expect(hints).toMatch(/first_shared_offset: [1-9]\d*/)
    const first = Number(/nshared_first_page: (\d+)/.exec(hints)![1])
    const total = Number(/nshared_total: (\d+)/.exec(hints)![1])
    expect(total).toBeGreaterThan(first)
    expect(checkLinearization(lin)).toContain('no linearization errors')
  })

  it.skipIf(QPDF === null)('re-linearizes an incremental input and remains valid after a later incremental update', () => {
    const original = buildPdf(3)
    const originalSize = parsePdf(original).trailer.get('Size') as number
    const updatedInput = appendIncrementalUpdate(original, [
      { num: originalSize, body: '<< /Revision (before-linearization) >>' },
    ], undefined, { xrefFormat: 'stream' })
    const lin = linearizePdf(updatedInput)
    expect(findRevision(lin, 'before-linearization')).toBe(true)
    expect(checkLinearization(lin)).toContain('no linearization errors')

    const size = parsePdf(lin).trailer.get('Size') as number
    const after = appendIncrementalUpdate(lin, [{ num: size, body: '<< /Revision (after-linearization) >>' }])
    const appended = parsePdf(after).getObject(size) as Map<string, unknown>
    expect(new TextDecoder().decode((appended.get('Revision') as PdfString).bytes)).toBe('after-linearization')
    expect(after.subarray(0, lin.length)).toEqual(lin)
    expect(inspectWithQpdf(after, '--check')).toContain('No syntax or stream encoding errors found')
  })

  it.skipIf(QPDF === null)('survives a qpdf content round-trip (same page text)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lin-'))
    try {
      const src = join(dir, 'src.pdf')
      const linFile = join(dir, 'lin.pdf')
      writeFileSync(src, buildPdf(3))
      writeFileSync(linFile, linearizePdf(buildPdf(3)))
      // qpdf --show-npages exercises page-tree navigation of the output.
      const npages = execFileSync(QPDF!, ['--show-npages', linFile], { encoding: 'utf8' }).trim()
      expect(npages).toBe('3')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
