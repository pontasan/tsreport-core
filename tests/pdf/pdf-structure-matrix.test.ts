import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { parsePdf, PdfRef, PdfString } from '../../src/pdf/pdf-parser.js'
import { rewritePdfToTraditional } from '../../src/pdf/pdf-rewrite.js'
import { signPdf } from '../../src/pdf/pdf-signer.js'
import { verifyPdfSignatures } from '../../src/pdf/pdf-signature.js'
import { hybridSigningPdf } from './signing-fixtures.js'

const QPDF_AVAILABLE = spawnSync('qpdf', ['--version']).status === 0
const FONT_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')
const SIGNATURE_FIXTURES = resolve(__dirname, '../fixtures/signatures')

function bytes(path: string): Uint8Array {
  const value = readFileSync(path)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function generatedPdf(): Uint8Array {
  const font = Font.load(bytes(FONT_PATH).buffer as ArrayBuffer)
  const backend = new PdfBackend({ fonts: { default: font } })
  render({ pages: [{ width: 100, height: 100, children: [
    { type: 'text', x: 5, y: 20, text: 'Structure', fontId: 'default', fontSize: 10, color: '#000000' },
  ] }] }, backend)
  return backend.toUint8Array()
}

function expectStructureSemantics(pdf: Uint8Array, markerNum: number | null, marker: string | null, hybrid: boolean): void {
  const doc = parsePdf(pdf)
  const catalog = doc.getCatalog()
  expect(catalog.get('Type')).toMatchObject({ name: 'Catalog' })
  const pages = doc.resolve(catalog.get('Pages') ?? null)
  expect(pages).toBeInstanceOf(Map)
  expect(doc.resolve((pages as Map<string, unknown>).get('Count') as never)).toBe(1)
  if (markerNum !== null && marker !== null) {
    const revisionObject = doc.getObject(markerNum)
    expect(revisionObject).toBeInstanceOf(Map)
    const value = doc.resolve((revisionObject as Map<string, unknown>).get('Matrix') as never)
    expect(value).toBeInstanceOf(PdfString)
    expect(new TextDecoder().decode((value as PdfString).bytes)).toBe(marker)
  }
  if (hybrid) {
    const compressedRef = catalog.get('CompressedMetadata')
    expect(compressedRef).toBeInstanceOf(PdfRef)
    const compressed = doc.resolve(compressedRef as PdfRef)
    expect(compressed).toBeInstanceOf(Map)
    expect(doc.resolve((compressed as Map<string, unknown>).get('Preserved') as never)).toBe(true)
  }
}

describe('PDF file structure cross-product', () => {
  it('reads, rewrites, and signs every base-structure and incremental-xref combination', () => {
    const compressed = generatedPdf()
    const bases = [
      { name: 'classic', pdf: rewritePdfToTraditional(compressed) },
      { name: 'xref-object-stream', pdf: compressed },
      { name: 'hybrid-reference', pdf: hybridSigningPdf() },
    ]
    const revisions = ['none', 'classic', 'stream'] as const
    const directory = QPDF_AVAILABLE ? mkdtempSync(join(tmpdir(), 'tsreport-structure-matrix-')) : null
    try {
      for (let baseIndex = 0; baseIndex < bases.length; baseIndex++) {
        for (let revisionIndex = 0; revisionIndex < revisions.length; revisionIndex++) {
          const base = bases[baseIndex]!
          const revision = revisions[revisionIndex]!
          let input = base.pdf
          let markerNum: number | null = null
          let marker: string | null = null
          if (revision !== 'none') {
            const size = parsePdf(input).trailer.get('Size') as number
            markerNum = size
            marker = `${base.name}-${revision}`
            input = appendIncrementalUpdate(input, [
              { num: markerNum, body: `<< /Matrix (${marker}) >>` },
            ], undefined, { xrefFormat: revision === 'stream' ? 'stream' : 'table' })
          }
          const hybrid = base.name === 'hybrid-reference'
          expectStructureSemantics(input, markerNum, marker, hybrid)
          const rewritten = rewritePdfToTraditional(input)
          expectStructureSemantics(rewritten, markerNum, marker, hybrid)
          const signed = signPdf({
            pdf: input,
            privateKeyDer: bytes(join(SIGNATURE_FIXTURES, 'signer-key.der')),
            certDer: bytes(join(SIGNATURE_FIXTURES, 'signer-cert.der')),
            signingTime: new Date(Date.UTC(2026, 6, 14, 4, baseIndex, revisionIndex)),
            fieldName: `${base.name}-${revision}`,
          })
          expect(signed.subarray(0, input.length)).toEqual(input)
          const verification = verifyPdfSignatures(signed)
          expect(verification).toHaveLength(1)
          expect(verification[0]!.digestValid).toBe(true)
          expect(verification[0]!.signatureValid).toBe(true)
          expectStructureSemantics(signed, markerNum, marker, hybrid)
          if (directory !== null) {
            const inputPath = join(directory, `${base.name}-${revision}-input.pdf`)
            const rewrittenPath = join(directory, `${base.name}-${revision}-rewritten.pdf`)
            const signedPath = join(directory, `${base.name}-${revision}-signed.pdf`)
            writeFileSync(inputPath, input)
            writeFileSync(rewrittenPath, rewritten)
            writeFileSync(signedPath, signed)
            expect(function () { execFileSync('qpdf', ['--check', inputPath], { stdio: 'pipe' }) }).not.toThrow()
            expect(function () { execFileSync('qpdf', ['--check', rewrittenPath], { stdio: 'pipe' }) }).not.toThrow()
            expect(function () { execFileSync('qpdf', ['--check', signedPath], { stdio: 'pipe' }) }).not.toThrow()
          }
        }
      }
    } finally {
      if (directory !== null) rmSync(directory, { recursive: true, force: true })
    }
  })
})
