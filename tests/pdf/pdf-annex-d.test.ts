import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PdfName, PdfString, parsePdf, parsePdfObject } from '../../src/pdf/pdf-parser.js'
import { PdfImporter, parsePdfDateText, pdfStringToText } from '../../src/pdf/pdf-page-importer.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'

const QPDF_AVAILABLE = spawnSync('qpdf', ['--version']).status === 0

function emptyPdf(backend: PdfBackend): Uint8Array {
  backend.beginDocument()
  backend.beginPage(100, 100)
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}

function qpdfCheck(pdf: Uint8Array): string {
  const directory = mkdtempSync(join(tmpdir(), 'tsreport-annex-d-'))
  try {
    const path = join(directory, 'document.pdf')
    writeFileSync(path, pdf)
    return execFileSync('qpdf', ['--check', path], { encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('PDF Annex D strings, names, dates, and file specifications', () => {
  it('decodes every defined PDFDocEncoding byte and rejects every undefined slot', () => {
    const special = new Map<number, number>([
      [0x18, 0x02D8], [0x19, 0x02C7], [0x1A, 0x02C6], [0x1B, 0x02D9], [0x1C, 0x02DD], [0x1D, 0x02DB], [0x1E, 0x02DA], [0x1F, 0x02DC],
      [0x80, 0x2022], [0x81, 0x2020], [0x82, 0x2021], [0x83, 0x2026], [0x84, 0x2014], [0x85, 0x2013], [0x86, 0x0192], [0x87, 0x2044],
      [0x88, 0x2039], [0x89, 0x203A], [0x8A, 0x2212], [0x8B, 0x2030], [0x8C, 0x201E], [0x8D, 0x201C], [0x8E, 0x201D], [0x8F, 0x2018],
      [0x90, 0x2019], [0x91, 0x201A], [0x92, 0x2122], [0x93, 0xFB01], [0x94, 0xFB02], [0x95, 0x0141], [0x96, 0x0152], [0x97, 0x0160],
      [0x98, 0x0178], [0x99, 0x017D], [0x9A, 0x0131], [0x9B, 0x0142], [0x9C, 0x0153], [0x9D, 0x0161], [0x9E, 0x017E], [0xA0, 0x20AC],
    ])
    const undefinedBytes = new Set<number>([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0B, 0x0C,
      0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x7F, 0x9F, 0xAD,
    ])
    for (let byte = 0; byte <= 0xFF; byte++) {
      if (undefinedBytes.has(byte)) {
        expect(() => pdfStringToText(new PdfString(new Uint8Array([byte]))), `0x${byte.toString(16)}`).toThrow(/undefined PDFDocEncoding/)
      } else {
        expect(pdfStringToText(new PdfString(new Uint8Array([byte]))), `0x${byte.toString(16)}`)
          .toBe(String.fromCodePoint(special.get(byte) ?? byte))
      }
    }
  })

  it('strictly decodes UTF-16BE and PDF 2.0 UTF-8 text strings', () => {
    expect(pdfStringToText(new PdfString(new Uint8Array([0xFE, 0xFF, 0xD8, 0x3D, 0xDE, 0x00])))).toBe('😀')
    expect(pdfStringToText(new PdfString(new Uint8Array([0xEF, 0xBB, 0xBF, 0xF0, 0x9F, 0x98, 0x80])))).toBe('😀')
    expect(() => pdfStringToText(new PdfString(new Uint8Array([0xFE, 0xFF, 0x00])))).toThrow(/odd byte length/)
    expect(() => pdfStringToText(new PdfString(new Uint8Array([0xFE, 0xFF, 0xD8, 0x3D])))).toThrow(/unpaired high surrogate/)
    expect(() => pdfStringToText(new PdfString(new Uint8Array([0xEF, 0xBB, 0xBF, 0xC0, 0xAF])))).toThrow()
  })

  it('round-trips literal-string controls without colliding with deferred text encoding', () => {
    const title = '~tsr-text-0041~\n\t(\\)'
    const pdf = emptyPdf(new PdfBackend({ fonts: {}, metadata: { title } }))
    const doc = parsePdf(pdf)
    const info = doc.resolve(doc.trailer.get('Info') ?? null) as Map<string, unknown>
    expect(pdfStringToText(doc.resolve(info.get('Title') as never) as PdfString)).toBe(title)
  })

  it('encodes every name delimiter and supplementary Unicode as UTF-8 bytes', () => {
    const key = 'A \t#()<>[]{}/%😀'
    const pdf = emptyPdf(new PdfBackend({
      fonts: {},
      metadata: { custom: { [key]: { type: 'name', value: '名😀' } } },
    }))
    const doc = parsePdf(pdf)
    const info = doc.resolve(doc.trailer.get('Info') ?? null) as Map<string, unknown>
    const encodedKey = Array.from(new TextEncoder().encode(key), byte => String.fromCharCode(byte)).join('')
    expect(info.has(encodedKey)).toBe(true)
    const encodedValue = info.get(encodedKey) as PdfName
    expect(Array.from(encodedValue.name, character => character.charCodeAt(0))).toEqual(Array.from(new TextEncoder().encode('名😀')))
    expect(() => emptyPdf(new PdfBackend({ fonts: {}, metadata: { custom: { 'bad\0name': 'x' } } }))).toThrow(/name must not contain null/)
    expect(() => parsePdfObject(new TextEncoder().encode('/bad#00name'))).toThrow(/name must not contain null/)
  })

  it('parses partial, leap-day, and timezone dates and rejects invalid field boundaries', () => {
    expect(parsePdfDateText('D:2026').toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(parsePdfDateText("D:20240229112233+05'30'").toISOString()).toBe('2024-02-29T05:52:33.000Z')
    expect(parsePdfDateText('D:20240229112233Z').toISOString()).toBe('2024-02-29T11:22:33.000Z')
    expect(parsePdfDateText('D:0000').getUTCFullYear()).toBe(0)
    for (const invalid of ['D:202413', 'D:20230229', 'D:20240101240000', 'D:20240101120060', 'D:202401Z', 'D:20240101120000+24\'00\'', 'D:20240101120000+05\'60\'']) {
      expect(() => parsePdfDateText(invalid), invalid).toThrow(/PDF date|date field|calendar date/)
    }
  })

  it.skipIf(!QPDF_AVAILABLE)('round-trips Unicode file specifications and embedded-file dates through qpdf', () => {
    const name = '資料/😀.txt'
    const creationDate = new Date('2026-01-02T03:04:05Z')
    const modificationDate = new Date('2026-01-03T04:05:06Z')
    const pdf = emptyPdf(new PdfBackend({
      fonts: {}, pdfVersion: '2.0',
      embeddedFiles: [{ name, data: new Uint8Array([1, 2, 3]), creationDate, modificationDate }],
    }))
    const doc = parsePdf(pdf)
    const names = doc.resolve(doc.getCatalog().get('Names') ?? null) as Map<string, unknown>
    const embeddedFiles = doc.resolve(names.get('EmbeddedFiles') as never) as Map<string, unknown>
    const pairs = doc.resolve(embeddedFiles.get('Names') as never) as unknown[]
    const spec = doc.resolve(pairs[1] as never) as Map<string, unknown>
    const f = doc.resolve(spec.get('F') as never) as PdfString
    const uf = doc.resolve(spec.get('UF') as never) as PdfString
    expect(f.bytes).toEqual(new TextEncoder().encode(name))
    expect(pdfStringToText(uf)).toBe(name)

    const imported = PdfImporter.open(pdf).importEmbeddedFiles()[0]!
    expect(imported.name).toBe(name)
    expect(imported.creationDate?.toISOString()).toBe(creationDate.toISOString())
    expect(imported.modificationDate?.toISOString()).toBe(modificationDate.toISOString())
    expect(qpdfCheck(pdf)).toContain('No syntax or stream encoding errors found')
  })
})
