// Rewrite a compressed PDF (object streams + xref stream) into traditional
// indirect objects + a classic xref table (ISO 32000 §7.5.4), preserving object
// numbers and content.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { Font } from '../../src/font.js'
import { rewritePdfToTraditional } from '../../src/pdf/pdf-rewrite.js'
import { parsePdf, PdfName, PdfStream } from '../../src/pdf/pdf-parser.js'

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

function compressedPdf(): Uint8Array {
  const font = Font.load(readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer)
  const backend = new PdfBackend({ fonts: { d: font }, metadata: { title: 'Rewrite Me' } })
  render({ pages: [{ width: 300, height: 300, children: [
    { type: 'text', x: 20, y: 30, text: 'Traditional', fontId: 'd', fontSize: 14, color: '#000000' },
  ] }] }, backend)
  return backend.toUint8Array()
}

describe('rewritePdfToTraditional', () => {
  it('expands object streams / xref streams into a classic xref table', () => {
    const original = compressedPdf()
    const raw0 = latin1(original)
    // The generator uses compressed encodings.
    expect(raw0).toContain('/ObjStm')

    const rewritten = rewritePdfToTraditional(original)
    const raw1 = latin1(rewritten)
    expect(raw1).toContain('\nxref\n')       // classic cross-reference table
    expect(raw1).toContain('\ntrailer\n')
    expect(raw1).not.toContain('/ObjStm')     // no object streams
    expect(raw1).not.toContain('/Type /XRef') // no cross-reference stream

    // Content is preserved: the catalog, page, and Info title still resolve.
    const doc = parsePdf(rewritten)
    expect(doc.getCatalog().get('Type')).toMatchObject({ name: 'Catalog' })
    const info = doc.resolve(doc.trailer.get('Info') ?? null) as Map<string, unknown>
    expect(latin1((info.get('Title') as { bytes: Uint8Array }).bytes)).toBe('Rewrite Me')
    // A content stream still decodes.
    const pages = doc.resolve(doc.getCatalog().get('Pages') ?? null) as Map<string, unknown>
    const kids = doc.resolve(pages.get('Kids') ?? null) as unknown[]
    const page = doc.resolve(kids[0] as never) as Map<string, unknown>
    expect((page.get('Type') as PdfName)?.name).toBe('Page')
    const contents = doc.resolve(page.get('Contents') ?? null)
    expect(contents).toBeInstanceOf(PdfStream)
    expect(doc.decodeStream(contents as PdfStream).length).toBeGreaterThan(0)
  })

  it('decrypts an encrypted PDF with the password and rewrites it unencrypted', () => {
    const font = Font.load(readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer)
    const backend = new PdfBackend({
      fonts: { d: font },
      encryption: { userPassword: 'x', ownerPassword: 'o', method: 'aes-128' },
      metadata: { title: 'Secret Doc' },
    })
    render({ pages: [{ width: 200, height: 200, children: [
      { type: 'text', x: 20, y: 30, text: 'Confidential', fontId: 'd', fontSize: 14, color: '#000000' },
    ] }] }, backend)
    const encrypted = backend.toUint8Array()
    expect(latin1(encrypted)).toContain('/Encrypt')

    const rewritten = rewritePdfToTraditional(encrypted, 'x')
    // The output is a plaintext traditional PDF: no /Encrypt, classic xref.
    const doc = parsePdf(rewritten) // parses with no password
    expect(doc.trailer.get('Encrypt')).toBeUndefined()
    expect(latin1(rewritten)).toContain('\nxref\n')
    // Content survives the decrypt+rewrite: the (encrypted) Info title decodes,
    // and the page content stream decodes to non-empty bytes.
    const info = doc.resolve(doc.trailer.get('Info') ?? null) as Map<string, unknown>
    expect(latin1((info.get('Title') as { bytes: Uint8Array }).bytes)).toBe('Secret Doc')
    const pages = doc.resolve(doc.getCatalog().get('Pages') ?? null) as Map<string, unknown>
    const kids = doc.resolve(pages.get('Kids') ?? null) as unknown[]
    const page = doc.resolve(kids[0] as never) as Map<string, unknown>
    const contents = doc.resolve(page.get('Contents') ?? null)
    expect(doc.decodeStream(contents as PdfStream).length).toBeGreaterThan(0)
  })

  it('rejects encrypted input without the correct password', () => {
    const font = Font.load(readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font }, encryption: { userPassword: 'x', method: 'aes-128' } })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    // The parser's standard security handler authentication fails with no password.
    expect(() => rewritePdfToTraditional(backend.toUint8Array())).toThrow()
  })
})

// External validation with qpdf/pdftotext when available.
function tool(name: string): string | null {
  for (const p of [`/opt/homebrew/bin/${name}`, `/usr/bin/${name}`, `/usr/local/bin/${name}`]) {
    try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p } catch { /* */ }
  }
  try { execFileSync(name, ['--version'], { stdio: 'ignore' }); return name } catch { return null }
}
const QPDF = tool('qpdf')

describe.skipIf(QPDF === null)('rewritePdfToTraditional external validation', () => {
  it('qpdf --check accepts the rewritten PDF', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rewrite-'))
    try {
      const file = join(dir, 'r.pdf')
      writeFileSync(file, rewritePdfToTraditional(compressedPdf()))
      const out = execFileSync(QPDF!, ['--check', file], { encoding: 'utf8' })
      expect(out).toContain('No syntax or stream encoding errors found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
