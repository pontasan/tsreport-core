import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { Font } from '../../src/font.js'
import { shapeGlyphRun } from '../../src/measure/glyph-run.js'
import { CanvasBackend } from '../../src/renderer/canvas-backend.js'
import { SvgBackend } from '../../src/renderer/svg-backend.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { parsePdf, PdfName, PdfStream } from '../../src/pdf/pdf-parser.js'

const FONT_PATH = resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')
const PDFTOPPM = '/opt/homebrew/bin/pdftoppm'
const RSVG_CONVERT = '/opt/homebrew/bin/rsvg-convert'
const bytes = readFileSync(FONT_PATH)
const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

function recordingContext() {
  const transforms: number[][] = []
  return {
    transforms,
    ctx: {
      canvas: { width: 0, height: 0, style: {} },
      save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      transform: vi.fn(function record(...values: number[]) { transforms.push(values) }),
      beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), bezierCurveTo: vi.fn(),
      rect: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), setLineDash: vi.fn(),
      fillStyle: '', strokeStyle: '', lineWidth: 0,
    },
  }
}

describe('vertical glyph rotation reaches every backend', function () {
  it('retains UAX #50 rotation classes after vertical GSUB shaping', function () {
    const shaped = font.shapeText('A漢〈、', { direction: 'vertical' })
    expect(shaped.map(function map(g) { return g.verticalRotation })).toEqual([90, 0, 0, 0])
    const run = shapeGlyphRun(font, 'A漢〈、', 16, 0, 0, true)
    expect(Array.from(run.rotations!)).toEqual([90, 0, 0, 0])
  })

  it('rotates R-class outlines in Canvas and SVG', function () {
    const canvas = recordingContext()
    const canvasBackend = new CanvasBackend(canvas.ctx, { fonts: { f: font }, background: null, devicePixelRatio: 1 })
    canvasBackend.beginPage(100, 100)
    canvasBackend.drawText(10, 10, 'A漢', 'f', 16, '#000000', { writingMode: 'vertical-rl' })
    expect(canvas.transforms).toContainEqual([0, 1, -1, 0, 0, 0])

    const svgBackend = new SvgBackend({ fonts: { f: font }, background: null })
    svgBackend.beginDocument()
    svgBackend.beginPage(100, 100)
    svgBackend.drawText(10, 10, 'A漢', 'f', 16, '#000000', { writingMode: 'vertical-rl' })
    svgBackend.endPage()
    const svg = svgBackend.getPages()[0]!
    expect(svg).toContain('rotate(90)')
  })

  it.skipIf(!existsSync(PDFTOPPM) || !existsSync(RSVG_CONVERT))('keeps SVG preview and PDF print raster geometry aligned', async function () {
    const directory = join(tmpdir(), `tsreport-vertical-${process.pid}-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    try {
      const pdfBackend = new PdfBackend({ fonts: { f: font } })
      pdfBackend.beginDocument()
      pdfBackend.beginPage(120, 120)
      pdfBackend.drawText(20, 20, 'A漢〈、', 'f', 24, '#000000', { writingMode: 'vertical-rl' })
      pdfBackend.endPage()
      pdfBackend.endDocument()
      const pdfPath = join(directory, 'vertical.pdf')
      const pdfOutput = join(directory, 'pdf')
      writeFileSync(pdfPath, pdfBackend.toUint8Array())
      execFileSync(PDFTOPPM, ['-f', '1', '-singlefile', '-r', '144', '-png', pdfPath, pdfOutput])

      const svgBackend = new SvgBackend({ fonts: { f: font }, background: '#ffffff' })
      svgBackend.beginDocument()
      svgBackend.beginPage(120, 120)
      svgBackend.drawText(20, 20, 'A漢〈、', 'f', 24, '#000000', { writingMode: 'vertical-rl' })
      svgBackend.endPage()
      const svgPath = join(directory, 'vertical.svg')
      const svgOutput = join(directory, 'svg.png')
      writeFileSync(svgPath, svgBackend.getPages()[0]!)
      execFileSync(RSVG_CONVERT, ['--width', '240', '--height', '240', '--background-color', 'white', '--output', svgOutput, svgPath])

      const pdfPixels = await sharp(readFileSync(`${pdfOutput}.png`)).greyscale().raw().toBuffer()
      const svgPixels = await sharp(readFileSync(svgOutput)).greyscale().raw().toBuffer()
      expect(pdfPixels.length).toBe(svgPixels.length)
      let intersection = 0
      let union = 0
      for (let i = 0; i < pdfPixels.length; i++) {
        const pdfInk = pdfPixels[i]! < 224
        const svgInk = svgPixels[i]! < 224
        if (pdfInk && svgInk) intersection++
        if (pdfInk || svgInk) union++
      }
      expect(union).toBeGreaterThan(500)
      expect(intersection / union).toBeGreaterThan(0.9)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses rotated path geometry plus an invisible Identity-V text layer in PDF', function () {
    const backend = new PdfBackend({ fonts: { f: font } })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 10, 'A漢', 'f', 16, '#000000', { writingMode: 'vertical-rl' })
    backend.endPage()
    backend.endDocument()
    const pdfBytes = backend.toUint8Array()
    const document = parsePdf(pdfBytes)
    const catalog = document.getCatalog()
    const pages = document.resolve(catalog.get('Pages') ?? null) as Map<string, unknown>
    const page = document.resolve((document.resolve(pages.get('Kids') ?? null) as unknown[])[0] as never) as Map<string, unknown>
    const content = document.resolve(page.get('Contents') ?? null) as PdfStream
    const operators = new TextDecoder().decode(document.decodeStream(content))
    expect(operators).toMatch(/0 1 -1 0 [\d.-]+ [\d.-]+ cm/)
    expect(operators).toContain('3 Tr')
    const resources = document.resolve(page.get('Resources') ?? null) as Map<string, unknown>
    const fonts = document.resolve(resources.get('Font') ?? null) as Map<string, unknown>
    const hasIdentityV = Array.from(fonts.values()).some(function hasVerticalEncoding(value) {
      const dictionary = document.resolve(value as never)
      if (!(dictionary instanceof Map)) return false
      const encoding = document.resolve(dictionary.get('Encoding') ?? null)
      return encoding instanceof PdfName && encoding.name === 'Identity-V'
    })
    expect(hasIdentityV).toBe(true)
  })
})
