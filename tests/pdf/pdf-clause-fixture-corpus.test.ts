import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import {
  Font,
  PdfBackend,
  PdfImporter,
  getPdfPageCount,
  importPdfPage,
  render,
  type PdfBackendOptions,
  type RenderDocument,
} from '../../src/index.js'

interface ClauseFixture {
  id: string
  clause: string
  builder: keyof typeof builders
  checks: string[]
}

interface ClauseCorpus {
  schemaVersion: number
  specification: string
  fixtures: ClauseFixture[]
}

const corpus = JSON.parse(readFileSync(
  resolve(process.cwd(), 'conformance/pdf-clause-fixture-corpus.json'), 'utf8',
)) as ClauseCorpus
const fontBytes = readFileSync(resolve(process.cwd(), 'tests/fixtures/fonts/Roboto-Regular.ttf'))
const font = Font.load(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength))
const conformance = process.env.TSREPORT_PDF_CONFORMANCE === '1'

function pdf(doc: RenderDocument, options: Omit<PdfBackendOptions, 'fonts'> = {}): Uint8Array {
  const backend = new PdfBackend({ fonts: { default: font }, ...options })
  render(doc, backend)
  return backend.toUint8Array()
}

const builders = {
  syntax(): Uint8Array {
    return pdf({ pages: [{ width: 144, height: 144, children: [] }] }, {
      pdfVersion: '1.4',
      catalog: { extensions: { ADBE: { baseVersion: '1.7', extensionLevel: 3 } } },
    })
  },
  graphics(): Uint8Array {
    return pdf({ pages: [{ width: 144, height: 144, children: [
      { type: 'rect', x: 12, y: 12, width: 60, height: 40, fill: '#cc3300' },
      { type: 'rect', x: 72, y: 72, width: 60, height: 60, fill: '#0066cc', stroke: '#111111', strokeWidth: 2 },
    ] }] })
  },
  text(): Uint8Array {
    return pdf({ pages: [{ width: 240, height: 100, children: [
      { type: 'text', x: 20, y: 30, text: 'Clause 9 text fixture', fontId: 'default', fontSize: 14, color: '#111111' },
    ] }] })
  },
  rendering(): Uint8Array {
    return pdf({ pages: [{ width: 144, height: 144, children: [{
      type: 'group', x: 0, y: 0, width: 144, height: 144,
      deviceParams: { flatness: 20, smoothness: 0.5, strokeAdjustment: true, transferFunction: 'Identity' },
      children: [{ type: 'rect', x: 24, y: 24, width: 96, height: 96, fill: '#777777' }],
    }] }] })
  },
  transparency(): Uint8Array {
    return pdf({ pages: [{ width: 144, height: 144, children: [{
      type: 'group', x: 12, y: 12, width: 120, height: 120, isolated: true, opacity: 0.65,
      children: [
        { type: 'rect', x: 0, y: 0, width: 90, height: 90, fill: '#ff0000' },
        { type: 'rect', x: 30, y: 30, width: 90, height: 90, fill: '#0000ff' },
      ],
    }] }] })
  },
  interactive(): Uint8Array {
    return pdf({ pages: [{ width: 240, height: 120, children: [] }] }, {
      annotations: [{ subtype: 'Text', pageIndex: 0, x: 10, y: 10, width: 18, height: 18, contents: 'Clause 12 note' }],
      formFields: [{ type: 'text', name: 'clause12', pageIndex: 0, x: 40, y: 20, width: 120, height: 24, value: 'form value' }],
    })
  },
  multimedia(): Uint8Array {
    return pdf({ pages: [{ width: 240, height: 120, children: [] }] }, {
      annotations: [{
        subtype: 'Sound', pageIndex: 0, x: 10, y: 10, width: 24, height: 24,
        data: new Uint8Array([0, 32, 64, 32, 0]), sampleRate: 8000, channels: 1, bitsPerSample: 8, encoding: 'Raw',
      }, {
        subtype: 'Screen', pageIndex: 0, x: 50, y: 10, width: 120, height: 70,
        media: { name: 'clip', mimeType: 'video/mp4', fileName: 'clip.mp4', data: new Uint8Array([0, 0, 0, 0]) },
      }],
    })
  },
  interchange(): Uint8Array {
    return pdf({ tagged: true, lang: 'en-US', pages: [{ width: 240, height: 100, children: [
      { type: 'text', x: 20, y: 30, text: 'Clause 14 interchange', fontId: 'default', fontSize: 14, color: '#111111', tag: { role: 'P' } },
    ] }] }, {
      metadata: { title: 'Clause 14 fixture', author: 'tsreport-core' },
      embeddedFiles: [{ name: 'source.txt', data: new TextEncoder().encode('source'), relationship: 'Source' }],
    })
  },
}

describe('fixed ISO 32000-2 clause fixture corpus', function () {
  it('fixes one deterministic minimal fixture for every normative clause 7 through 14', function () {
    expect(corpus.schemaVersion).toBe(1)
    expect(corpus.fixtures.map(function (fixture) { return fixture.clause })).toEqual(['7', '8', '9', '10', '11', '12', '13', '14'])
    expect(new Set(corpus.fixtures.map(function (fixture) { return fixture.id })).size).toBe(8)
    for (let i = 0; i < corpus.fixtures.length; i++) {
      const fixture = corpus.fixtures[i]!
      expect(fixture.checks).toContain('core-reader')
      expect(typeof builders[fixture.builder], fixture.id).toBe('function')
      const bytes = builders[fixture.builder]()
      expect(getPdfPageCount(bytes), fixture.id).toBe(1)
      const page = importPdfPage(bytes, 0)
      expect(page.width, fixture.id).toBeGreaterThan(0)
      expect(page.height, fixture.id).toBeGreaterThan(0)
      expect(PdfImporter.open(bytes).importPageProperties(0), fixture.id).toBeDefined()
    }
  })

  it('runs every declared independent check in PDF conformance mode', async function () {
    if (!conformance) {
      expect(process.env.TSREPORT_PDF_CONFORMANCE).toBeUndefined()
      return
    }
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-pdf-clause-corpus-'))
    try {
      for (let i = 0; i < corpus.fixtures.length; i++) {
        const fixture = corpus.fixtures[i]!
        const input = join(directory, `${fixture.id}.pdf`)
        writeFileSync(input, builders[fixture.builder]())
        execFileSync('qpdf', ['--check', input], { stdio: 'pipe' })
        if (fixture.checks.includes('pdftotext')) {
          const output = execFileSync('pdftotext', [input, '-'], { encoding: 'utf8' })
          expect(output, fixture.id).toContain(fixture.clause === '9' ? 'Clause 9 text fixture' : 'Clause 14 interchange')
        }
        if (fixture.checks.includes('pdffonts')) {
          const output = execFileSync('pdffonts', [input], { encoding: 'utf8' })
          expect(output, fixture.id).toContain('yes')
        }
        if (fixture.checks.includes('poppler-render')) {
          execFileSync('pdftoppm', ['-png', '-r', '72', '-singlefile', input, join(directory, `${fixture.id}-poppler`)], { stdio: 'pipe' })
        }
        if (fixture.checks.includes('ghostscript-render')) {
          execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-r72', `-sOutputFile=${join(directory, `${fixture.id}-gs.png`)}`, input], { stdio: 'pipe' })
        }
      }
      const poppler = await sharp(join(directory, 'graphics-poppler.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const ghostscript = await sharp(join(directory, 'graphics-gs.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      expect(poppler.info.width).toBe(ghostscript.info.width)
      expect(poppler.info.height).toBe(ghostscript.info.height)
      let difference = 0
      for (let i = 0; i < poppler.data.length; i++) difference += Math.abs(poppler.data[i]! - ghostscript.data[i]!)
      expect(difference / poppler.data.length).toBeLessThan(3)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
