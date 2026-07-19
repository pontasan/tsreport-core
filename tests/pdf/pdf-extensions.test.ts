import { describe, expect, it } from 'vitest'
import {
  PdfBackend,
  PdfImporter,
  classifyPdfName,
  render,
  validatePdfDeveloperExtensions,
  validatePdfSecondClassName,
  validatePdfThirdClassName,
  type PdfBackendOptions,
  type PdfDeveloperExtensions,
} from '../../src/index.js'

function createPdf(extensions: PdfDeveloperExtensions, pdfVersion?: PdfBackendOptions['pdfVersion']): Uint8Array {
  const backend = new PdfBackend({ fonts: {}, pdfVersion, catalog: { extensions } })
  render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
  return backend.toUint8Array()
}

function header(bytes: Uint8Array): string {
  return new TextDecoder('iso-8859-1').decode(bytes.subarray(0, 8))
}

describe('PDF developer extensions', () => {
  it('writes and imports a developer extensions dictionary', () => {
    const extensions: PdfDeveloperExtensions = {
      ADBE: {
        baseVersion: '1.7',
        extensionLevel: 3,
        url: 'https://example.test/pdf-extension',
        entries: { ADBE_FeatureSet: { kind: 'name', value: 'Enabled' } },
      },
    }
    const bytes = createPdf(extensions, '1.4')
    expect(header(bytes)).toBe('%PDF-1.7')
    expect(PdfImporter.open(bytes).importCatalogModel().extensions).toEqual(extensions)
  })

  it('writes the ISO_ extension array and promotes the document to PDF 2.0', () => {
    const extensions: PdfDeveloperExtensions = {
      ISO_: [{
        baseVersion: '2.0',
        extensionLevel: 32001,
        extensionRevision: ':2022',
        url: 'https://www.iso.org/standard/45877.html',
      }, {
        baseVersion: '2.0',
        extensionLevel: 32002,
        extensionRevision: ':2022',
        url: 'https://www.iso.org/standard/45878.html',
      }],
    }
    const bytes = createPdf(extensions, '1.4')
    expect(header(bytes)).toBe('%PDF-2.0')
    expect(PdfImporter.open(bytes).importCatalogModel().extensions).toEqual(extensions)
  })

  it('rejects an imported extension whose base version exceeds the document version', () => {
    const bytes = createPdf({
      ISO_: {
        baseVersion: '2.0', extensionLevel: 32001, extensionRevision: ':2022',
        url: 'https://www.iso.org/standard/45877.html',
      },
    })
    const invalid = bytes.slice()
    invalid[5] = 0x31
    invalid[7] = 0x37
    expect(() => PdfImporter.open(invalid).importCatalogModel()).toThrow(/BaseVersion 2.0 exceeds document version 1.7/)
  })

  it('rejects extension dictionaries that violate version and ISO rules', () => {
    expect(() => validatePdfDeveloperExtensions({
      ADBE: [{ baseVersion: '1.7', extensionLevel: 1 }],
    })).toThrow(/arrays.*ISO_/)
    expect(() => validatePdfDeveloperExtensions({
      ISO_: [{ baseVersion: '2.0', extensionLevel: 32002, extensionRevision: ':2022', url: 'https://www.iso.org/standard/2.html' },
        { baseVersion: '2.0', extensionLevel: 32001, extensionRevision: ':2022', url: 'https://www.iso.org/standard/1.html' }],
    })).toThrow(/must increase/)
    expect(() => validatePdfDeveloperExtensions({
      ISO_: { baseVersion: '1.7', extensionLevel: 32001, extensionRevision: '2022', url: 'https://example.test' },
    })).toThrow(/BaseVersion 2.0/)
    expect(() => validatePdfDeveloperExtensions({
      ADBE: { baseVersion: '1.7', extensionLevel: 3, entries: { BaseVersion: { kind: 'name', value: '1.7' } } },
    })).toThrow(/must not redefine/)
  })
})

describe('PDF Annex E name classes', () => {
  it('classifies first-, second-, and third-class names', () => {
    expect(classifyPdfName('Width')).toBe('first')
    expect(classifyPdfName('ADBE_Feature')).toBe('second')
    expect(classifyPdfName('ISO:Feature')).toBe('second')
    expect(classifyPdfName('XXPrivate')).toBe('third')
  })

  it('validates registered and internal extension prefixes', () => {
    expect(() => validatePdfSecondClassName('ADBE_Feature', 'ADBE')).not.toThrow()
    expect(() => validatePdfSecondClassName('ISO:Feature', 'ISO_')).not.toThrow()
    expect(() => validatePdfSecondClassName('ACME_Feature', 'ADBE')).toThrow(/must begin/)
    expect(() => validatePdfThirdClassName('XXPrivate')).not.toThrow()
    expect(() => validatePdfThirdClassName('Private')).toThrow(/must begin with XX/)
  })
})
