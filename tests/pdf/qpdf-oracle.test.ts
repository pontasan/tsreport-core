// External spec-compliance oracle: validate generated PDFs with qpdf --check
// when qpdf is installed (skipped otherwise, e.g. on CI without qpdf). This
// guards against spec violations that internal round-trip tests cannot detect
// (it caught the AES-256/R6 Algorithm 2.B key-derivation bug).

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { parsePdf, PdfRef, PdfString } from '../../src/pdf/pdf-parser.js'
import type { RenderDocument } from '../../src/types/render.js'

function qpdfPath(): string | null {
  for (const p of ['/opt/homebrew/bin/qpdf', '/usr/bin/qpdf', '/usr/local/bin/qpdf']) {
    try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p } catch { /* not here */ }
  }
  try { execFileSync('qpdf', ['--version'], { stdio: 'ignore' }); return 'qpdf' } catch { return null }
}

const QPDF = qpdfPath()
const DOC: RenderDocument = {
  pages: [{ width: 400, height: 400, children: [{ type: 'rect', x: 20, y: 20, width: 120, height: 60, fill: '#3366cc' }] }],
}

function check(bytes: Uint8Array, password?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'qpdf-'))
  try {
    const file = join(dir, 'doc.pdf')
    writeFileSync(file, bytes)
    const args = ['--check', file]
    if (password !== undefined) args.splice(1, 0, `--password=${password}`)
    try {
      return execFileSync(QPDF!, args, { encoding: 'utf8' })
    } catch (e) {
      // qpdf exits non-zero on warnings; surface stdout for the assertion.
      return String((e as { stdout?: string }).stdout ?? (e as Error).message)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(QPDF === null)('qpdf spec-compliance oracle', () => {
  it('generates a syntactically valid unencrypted PDF', () => {
    const backend = new PdfBackend({ fonts: {}, metadata: { title: 'QPDF Oracle' } })
    render(DOC, backend)
    expect(check(backend.toUint8Array())).toContain('No syntax or stream encoding errors found')
  })

  it('generates an AES-256 (R6) PDF whose password qpdf accepts (Algorithm 2.B)', () => {
    const backend = new PdfBackend({
      fonts: {},
      encryption: { userPassword: 'u', ownerPassword: 'o', method: 'aes-256' },
    })
    render(DOC, backend)
    const out = check(backend.toUint8Array(), 'u')
    expect(out).toContain('No syntax or stream encoding errors found')
    expect(out).not.toContain('invalid password')
  })

  it('generates an AES-256 R5 PDF whose SASLprep password qpdf accepts', () => {
    const backend = new PdfBackend({
      fonts: {},
      encryption: { userPassword: 'p\u00AAss\u00ADword', ownerPassword: 'owner', method: 'aes-256-r5' },
    })
    render(DOC, backend)
    const out = check(backend.toUint8Array(), 'password')
    expect(out).toContain('No syntax or stream encoding errors found')
    expect(out).not.toContain('invalid password')
  })

  it('generates an AES-128 PDF that qpdf validates', () => {
    const backend = new PdfBackend({
      fonts: {},
      encryption: { userPassword: 'u', ownerPassword: 'o', method: 'aes-128' },
    })
    render(DOC, backend)
    expect(check(backend.toUint8Array(), 'u')).toContain('No syntax or stream encoding errors found')
  })

  it('generates an RC4-128 (V2/R3) PDF that qpdf validates', () => {
    const backend = new PdfBackend({
      fonts: {},
      encryption: { userPassword: 'u', ownerPassword: 'o', method: 'rc4-128' },
    })
    render(DOC, backend)
    expect(check(backend.toUint8Array(), 'u')).toContain('No syntax or stream encoding errors found')
  })

  it('generates an RC4-40 (V1/R2) PDF that qpdf validates', () => {
    const backend = new PdfBackend({ fonts: {}, encryption: { userPassword: 'u', ownerPassword: 'o', method: 'rc4-40' } })
    render(DOC, backend)
    expect(check(backend.toUint8Array(), 'u')).toContain('No syntax or stream encoding errors found')
  })

  it('generates a legacy PDFDocEncoding password that qpdf accepts', () => {
    const password = 'bullet\u2022euro\u20AC'
    const backend = new PdfBackend({ fonts: {}, encryption: { userPassword: password, ownerPassword: 'owner', method: 'aes-128' } })
    render(DOC, backend)
    const out = check(backend.toUint8Array(), password)
    expect(out).toContain('No syntax or stream encoding errors found')
    expect(out).not.toContain('invalid password')
  })

  it('validates /EFF /Identity routing for an encrypted embedded file', () => {
    const backend = new PdfBackend({
      fonts: {},
      encryption: { userPassword: 'u', ownerPassword: 'o', method: 'aes-128' },
      identityCryptFilter: { embeddedFiles: ['public.txt'] },
      embeddedFiles: [{ name: 'public.txt', data: new Uint8Array([80, 85, 66, 76, 73, 67]) }],
    })
    render(DOC, backend)
    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/EFF /Identity')
    expect(check(bytes, 'u')).toContain('No syntax or stream encoding errors found')
  })

  it('validates a Tagged PDF', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.setTagged('en-US')
    render(DOC, backend)
    expect(check(backend.toUint8Array())).toContain('No syntax or stream encoding errors found')
  })

  it('validates annotations (Text, Square, Highlight, Redact)', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        { subtype: 'Text', pageIndex: 0, x: 10, y: 10, width: 18, height: 18, contents: 'note' },
        { subtype: 'Square', pageIndex: 0, x: 40, y: 40, width: 50, height: 30, color: '#ff0000', interiorColor: '#00ff00' },
        { subtype: 'Highlight', pageIndex: 0, x: 10, y: 80, width: 100, height: 14, quadPoints: [[10, 80, 110, 80, 10, 94, 110, 94]] },
        { subtype: 'Redact', pageIndex: 0, x: 10, y: 120, width: 60, height: 15, interiorColor: '#000000', overlayText: 'X', defaultAppearance: '/Helv 10 Tf 1 1 1 rg' },
      ],
    })
    render(DOC, backend)
    expect(check(backend.toUint8Array())).toContain('No syntax or stream encoding errors found')
  })

  it('validates an AcroForm text field', () => {
    const backend = new PdfBackend({
      fonts: {},
      formFields: [{ type: 'text', name: 'f1', pageIndex: 0, x: 10, y: 10, width: 100, height: 20, value: 'hi' }],
    })
    render(DOC, backend)
    expect(check(backend.toUint8Array())).toContain('No syntax or stream encoding errors found')
  })

  it('validates a linear-gradient shading', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 300, height: 300, children: [
      { type: 'rect', x: 10, y: 10, width: 120, height: 120, fill: { type: 'linear-gradient', x1: 0, y1: 0, x2: 1, y2: 1, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] } },
    ] }] }, backend)
    expect(check(backend.toUint8Array())).toContain('No syntax or stream encoding errors found')
  })

  it('validates embedded files + outline + page labels', () => {
    const backend = new PdfBackend({
      fonts: {},
      embeddedFiles: [{ name: 'a.txt', data: new Uint8Array([65, 66]), relationship: 'Data' }],
      pageLabels: [{ pageIndex: 0, style: 'D', start: 1 }],
    })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.drawRect(5, 5, 10, 10, { fill: '#000000' })
    backend.endPage()
    backend.setAnchors([{ name: 'a', pageIndex: 0, y: 0 }])
    backend.endDocument()
    expect(check(backend.toUint8Array())).toContain('No syntax or stream encoding errors found')
  })

  it('validates an incrementally-updated PDF (/Prev-chained xref)', () => {
    const backend = new PdfBackend({ fonts: {}, metadata: { title: 'Original' } })
    render(DOC, backend)
    const base = backend.toUint8Array()
    const infoRef = parsePdf(base).trailer.get('Info') as PdfRef
    const updated = appendIncrementalUpdate(base, [{ num: infoRef.num, gen: infoRef.gen, body: '<< /Title (Updated) >>' }])
    expect(check(updated)).toContain('No syntax or stream encoding errors found')
  })

  it('agrees on PDF object lexical boundaries and string normalization', () => {
    const backend = new PdfBackend({ fonts: {} })
    render(DOC, backend)
    const base = backend.toUint8Array()
    const source = parsePdf(base)
    const objectNumber = source.trailer.get('Size') as number
    const updated = appendIncrementalUpdate(base, [{
      num: objectNumber,
      gen: 0,
      body: '<< /Escaped#20Name (a\r\nb) /Hex <4142F> /Array [true false null .5 1 0 R] >>',
    }])
    expect(check(updated)).toContain('No syntax or stream encoding errors found')

    const value = parsePdf(updated).getObject(objectNumber) as Map<string, unknown>
    expect(Array.from((value.get('Escaped Name') as PdfString).bytes)).toEqual([0x61, 0x0A, 0x62])
    expect(Array.from((value.get('Hex') as PdfString).bytes)).toEqual([0x41, 0x42, 0xF0])
    expect(value.get('Array')).toEqual([true, false, null, 0.5, new PdfRef(1, 0)])
  })
})
