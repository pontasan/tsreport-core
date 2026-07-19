import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Font } from '../../src/font.js'
import { PdfBackend, validatePdfConformance } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument } from '../../src/types/render.js'

const conformance = process.env.TSREPORT_PDF_CONFORMANCE === '1'
const preflight = process.env.PDFX_PREFLIGHT_BIN
let directory = ''
let font: Font

beforeAll(function () {
  const source = readFileSync(join(__dirname, '..', 'fixtures', 'fonts', 'Roboto-Regular.ttf'))
  font = Font.load(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer)
  if (!conformance) return
  if (preflight === undefined || !existsSync(preflight)) {
    throw new Error('PDF/X conformance requires PDFX_PREFLIGHT_BIN')
  }
  directory = mkdtempSync(join(tmpdir(), 'tsreport-pdfx-preflight-'))
})

afterAll(function () {
  if (directory !== '') rmSync(directory, { recursive: true, force: true })
})

describe('independent PDF/X-1a:2003 preflight oracle', function () {
  it('accepts process, spot, embedded-font, and TrapNet fixtures', function () {
    const fixtures = [buildTextTrapFixture(), buildSpotFixture(), buildImageShadingFixture()]
    for (let index = 0; index < fixtures.length; index++) {
      expect(() => validatePdfConformance(fixtures[index]!, { pdfxConformance: 'PDF/X-1a' })).not.toThrow()
    }
    if (!conformance) return
    for (let index = 0; index < fixtures.length; index++) {
      const file = join(directory, `valid-${index + 1}.pdf`)
      writeFileSync(file, fixtures[index]!)
      const result = runPreflight(file)
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    }
  }, 30_000)

  it('rejects a fixture with an invalid PDF/X identification value', function () {
    if (!conformance) return
    const valid = buildSpotFixture()
    const text = new TextDecoder('latin1').decode(valid)
    const invalidText = text.replace('/GTS_PDFXVersion (PDF/X-1a:2003)', '/GTS_PDFXVersion (PDF/X-1a:200X)')
    if (invalidText === text) throw new Error('PDF/X negative fixture could not locate GTS_PDFXVersion')
    const invalid = new Uint8Array(invalidText.length)
    for (let index = 0; index < invalidText.length; index++) invalid[index] = invalidText.charCodeAt(index) & 0xFF
    const file = join(directory, 'invalid-identification.pdf')
    writeFileSync(file, invalid)
    const result = runPreflight(file)
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0)
  }, 30_000)
})

function runPreflight(file: string): ReturnType<typeof spawnSync> {
  return spawnSync(preflight!, [file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

function buildTextTrapFixture(): Uint8Array {
  const backend = new PdfBackend({
    fonts: { default: font },
    pdfxConformance: 'PDF/X-1a',
    metadata: { trapped: true },
    annotations: [{
      subtype: 'TrapNet', pageIndex: 0, x: 12, y: 12, width: 20, height: 20,
      lastModified: new Date(Date.UTC(2026, 6, 14, 0, 0, 0)),
      appearanceState: 'Default',
      appearances: [{
        name: 'Default', bbox: [0, 0, 20, 20],
        content: new TextEncoder().encode('0 0 0 1 k 0 0 20 20 re f'),
      }],
    }],
  })
  const document: RenderDocument = {
    pages: [{
      width: 300,
      height: 200,
      children: [{
        type: 'text', x: 24, y: 24, text: 'Independent PDF/X preflight',
        fontId: 'default', fontSize: 12, color: 'cmyk(0,0,0,100)',
      }],
    }],
  }
  render(document, backend)
  return backend.toUint8Array()
}

function buildSpotFixture(): Uint8Array {
  const backend = new PdfBackend({ fonts: {}, pdfxConformance: 'PDF/X-1a' })
  backend.beginDocument()
  backend.beginPage(200, 100)
  backend.drawRect(20, 20, 80, 40, { fill: 'spot(Gold,0,24,94,0)' })
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}

function buildImageShadingFixture(): Uint8Array {
  const image = readFileSync(join(__dirname, '..', 'fixtures', 'images', 'cmyk-plain.jpg'))
  const backend = new PdfBackend({
    fonts: {},
    images: { cmyk: new Uint8Array(image.buffer, image.byteOffset, image.byteLength) },
    pdfxConformance: 'PDF/X-1a',
  })
  backend.beginDocument()
  backend.beginPage(240, 120)
  backend.drawImage(10, 10, 80, 80, 'cmyk')
  backend.drawPathWithPaints(
    new Uint8Array([0, 1, 1, 1, 3]),
    new Float32Array([110, 10, 220, 10, 220, 90, 110, 90]),
    {
      fill: {
        type: 'linear-gradient', x1: 110, y1: 10, x2: 220, y2: 90,
        stops: [
          { offset: 0, color: 'cmyk(100,0,0,0)' },
          { offset: 1, color: 'cmyk(0,100,0,0)' },
        ],
      },
    },
  )
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}
