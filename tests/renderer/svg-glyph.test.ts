import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Font } from '../../src/font.js'
import { SvgBackend } from '../../src/renderer/svg-backend.js'
import { CanvasBackend } from '../../src/renderer/canvas-backend.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { parseSvg } from '../../src/svg/svg-parser.js'
import { renderSvgGlyph } from '../../src/svg/svg-renderer.js'
import { buildTestFont, buildTable, encodeSimpleGlyph, UPEM } from './synthetic-font.js'
import { pdfToText } from './pdf-test-utils.js'

const RSVG_CONVERT = '/opt/homebrew/bin/rsvg-convert'

/**
 * OT-SVG glyph rendering: SVG table document → glyph element selection →
 * y-down font-unit coordinate mapping → all three backends.
 */

/** Builds an SVG table with one document covering [startGid, endGid] */
function buildSvgTable(startGid: number, endGid: number, doc: string): Uint8Array {
  const docBytes = new TextEncoder().encode(doc)
  return buildTable(w => {
    w.writeUint16(0) // version
    w.writeUint32(10) // svgDocumentListOffset
    w.writeUint32(0) // reserved
    // SVGDocumentList
    w.writeUint16(1) // numEntries
    w.writeUint16(startGid)
    w.writeUint16(endGid)
    w.writeUint32(2 + 12) // svgDocOffset (from document list start)
    w.writeUint32(docBytes.length)
    w.writeBytes(docBytes)
  })
}

function buildCpalTable(): Uint8Array {
  return buildTable(w => {
    w.writeUint16(0)
    w.writeUint16(1)
    w.writeUint16(2)
    w.writeUint16(2)
    w.writeUint32(16)
    w.writeUint16(0)
    w.writeUint16(1)
    w.writeUint8(0); w.writeUint8(0); w.writeUint8(255); w.writeUint8(255)
    w.writeUint8(255); w.writeUint8(0); w.writeUint8(0); w.writeUint8(128)
  })
}

function buildColrV0Table(baseGlyphId: number, layerGlyphId: number, paletteIndex: number): Uint8Array {
  return buildTable(w => {
    w.writeUint16(0)
    w.writeUint16(1)
    w.writeUint32(14)
    w.writeUint32(20)
    w.writeUint16(1)
    w.writeUint16(baseGlyphId)
    w.writeUint16(0)
    w.writeUint16(1)
    w.writeUint16(layerGlyphId)
    w.writeUint16(paletteIndex)
  })
}

function buildVerticalHeader(): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1); w.writeUint16(0)
    w.writeInt16(500); w.writeInt16(-500); w.writeInt16(0)
    w.writeUint16(1000)
    w.writeInt16(50); w.writeInt16(50); w.writeInt16(900)
    w.writeInt16(0); w.writeInt16(1); w.writeInt16(0)
    for (let i = 0; i < 4; i++) w.writeInt16(0)
    w.writeInt16(0); w.writeUint16(2)
  })
}

function buildVerticalMetrics(): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1000); w.writeInt16(0)
    w.writeUint16(1000); w.writeInt16(50)
  })
}

function buildThreeEntryCpalTable(): Uint8Array {
  return buildTable(w => {
    w.writeUint16(0)
    w.writeUint16(3)
    w.writeUint16(2)
    w.writeUint16(6)
    w.writeUint32(16)
    w.writeUint16(0)
    w.writeUint16(3)
    // Palette 0: red, green, blue. Palette 1: cyan, magenta, yellow.
    w.writeUint8(0); w.writeUint8(0); w.writeUint8(255); w.writeUint8(255)
    w.writeUint8(0); w.writeUint8(255); w.writeUint8(0); w.writeUint8(255)
    w.writeUint8(255); w.writeUint8(0); w.writeUint8(0); w.writeUint8(255)
    w.writeUint8(255); w.writeUint8(255); w.writeUint8(0); w.writeUint8(255)
    w.writeUint8(255); w.writeUint8(0); w.writeUint8(255); w.writeUint8(255)
    w.writeUint8(0); w.writeUint8(255); w.writeUint8(255); w.writeUint8(255)
  })
}

const SQUARE: [number, number][] = [[100, 100], [500, 100], [500, 500], [100, 500]]

const GLYPH_DOC = '<svg xmlns="http://www.w3.org/2000/svg">'
  + '<g id="glyph1"><rect x="100" y="-500" width="400" height="500" fill="#FF0000"/></g>'
  + '<g id="glyph2"><circle cx="0" cy="0" r="10" fill="#00FF00"/></g>'
  + '</svg>'

function loadSvgFont(doc: string = GLYPH_DOC): Font {
  return Font.load(buildTestFont(
    [null, encodeSimpleGlyph(SQUARE, [3]), encodeSimpleGlyph(SQUARE, [3])],
    [[0x41, 1], [0x42, 2]],
    [['SVG ', buildSvgTable(1, 2, doc)]],
  ))
}

describe('Font.getSvgGlyphDocument', () => {
  it('returns the SVG document for covered glyphs and null otherwise', () => {
    const font = loadSvgFont()
    expect(font.getSvgGlyphDocument(1)).toContain('glyph1')
    expect(font.getSvgGlyphDocument(2)).toContain('glyph2')
    expect(font.getSvgGlyphDocument(0)).toBeNull()
    expect(font.getSvgGlyphDocument(3)).toBeNull()
  })

  it('removes unused glyph ranges from a stable-GID subset', () => {
    const font = loadSvgFont()
    const result = font.subsetPreservingTables('A')
    const subset = Font.load(result.buffer)
    expect(subset.getSvgGlyphDocument(1)).toContain('glyph1')
    expect(subset.getSvgGlyphDocument(2)).toBeNull()
  })

  it('remaps SVG glyph IDs in a compact subset', () => {
    const font = loadSvgFont()
    const subset = Font.load(font.subset('B'))
    const glyphId = subset.getGlyphId(0x42)
    expect(glyphId).toBe(1)
    const document = subset.getSvgGlyphDocument(glyphId)!
    expect(document).toContain('id="glyph1"')
    expect(document).not.toContain('#ff0000')
    expect(document.length).toBeLessThan(GLYPH_DOC.length)
    expect(subset.getSvgGlyphDocument(2)).toBeNull()

    const backend = new SvgBackend({ fonts: { compact: subset }, background: null })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 50, 'B', 'compact', 40, '#000000')
    backend.endPage()
    expect(backend.getPages()[0]!.toLowerCase()).toContain('#00ff00')
  })

  it('retains a referenced glyph element while pruning unrelated glyph programs', () => {
    const document = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<g id="glyph1"><use href="#glyph2"/></g>'
      + '<g id="glyph2"><rect width="20" height="20" fill="#00ff00"/></g>'
      + '<g id="glyph3"><rect width="20" height="20" fill="#ff0000"/></g></svg>'
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3]), encodeSimpleGlyph(SQUARE, [3]), encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1], [0x42, 2], [0x43, 3]],
      [['SVG ', buildSvgTable(1, 3, document)]],
    ))
    const subset = Font.load(font.subsetPreservingTables('A').buffer)
    const retained = subset.getSvgGlyphDocument(1)!
    expect(retained).toContain('id="glyph1"')
    expect(retained).toContain('id="unmappedGlyph2"')
    expect(retained).toContain('href="#unmappedGlyph2"')
    expect(retained).not.toContain('glyph3')
  })

  it('physically compacts CPAL entries and remaps OT-SVG palette variables', () => {
    const document = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<g id="glyph1"><rect width="100" height="100" fill="var(--color2, black)"/></g></svg>'
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['SVG ', buildSvgTable(1, 1, document)], ['CPAL', buildThreeEntryCpalTable()]],
    ))
    const subset = Font.load(font.subset('A'))
    expect(subset.getSvgGlyphDocument(1)).toContain('--color0')
    expect(subset.getColorFromPalette(0, 0)).toEqual({ r: 0, g: 0, b: 255, a: 255 })
    expect(subset.getColorFromPalette(1, 0)).toEqual({ r: 255, g: 255, b: 0, a: 255 })
    expect(subset.getColorFromPalette(0, 1)).toBeNull()
  })
})

describe('renderSvgGlyph', () => {
  it('renders only the matching glyph element with y-down font-unit mapping', () => {
    const backend = new SvgBackend({ background: null })
    backend.beginDocument()
    backend.beginPage(200, 200)
    // origin (50, 100), scale 0.1 (fontSize 100 / upem 1000)
    renderSvgGlyph(parseSvg(GLYPH_DOC), backend, 1, 50, 100, 0.1, UPEM)
    backend.endPage()
    const page = backend.getPages()[0]!.toLowerCase()

    // glyph1 rect present (raw font-unit geometry inside a translate+scale group)
    expect(page).toContain('#ff0000')
    expect(page).toContain('translate(50 100)')
    expect(page).toContain('matrix(0.1 0 0 0.1 0 0)')
    expect(page).toContain('m100 -500') // y-down font units used as-is
    expect(page).not.toContain('#00ff00') // glyph2 content not rendered
  })

  it('maps an explicit viewBox onto the em square', () => {
    const doc = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
      + '<g id="glyph1"><rect x="0" y="0" width="100" height="100" fill="#0000FF"/></g>'
      + '</svg>'
    const backend = new SvgBackend({ background: null })
    backend.beginDocument()
    backend.beginPage(500, 500)
    // viewBox 100 → em square 1000 units → ×10, then scale 0.2 → ×2 overall
    renderSvgGlyph(parseSvg(doc), backend, 1, 0, 0, 0.2, UPEM)
    backend.endPage()
    const page = backend.getPages()[0]!.toLowerCase()
    expect(page).toContain('#0000ff')
    // viewBox 100 → em 1000 (×10), then scale 0.2 → overall matrix ×2
    expect(page).toContain('matrix(2 0 0 2 0 0)')
  })

  it('uses explicit root width and height as the viewBox viewport', () => {
    const doc = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 100 100">'
      + '<g id="glyph1"><rect width="100" height="100" fill="#0000FF"/></g></svg>'
    const backend = new SvgBackend({ background: null })
    backend.beginDocument()
    backend.beginPage(500, 500)
    renderSvgGlyph(parseSvg(doc), backend, 1, 0, 0, 0.2, UPEM)
    backend.endPage()
    expect(backend.getPages()[0]!.toLowerCase()).toContain('matrix(1 0 0 1 0 0)')
  })

  it('renders the whole document when no glyph id element exists', () => {
    const doc = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<rect x="0" y="-100" width="100" height="100" fill="#123456"/></svg>'
    const backend = new SvgBackend({ background: null })
    backend.beginDocument()
    backend.beginPage(100, 100)
    renderSvgGlyph(parseSvg(doc), backend, 1, 0, 50, 0.1, UPEM)
    backend.endPage()
    expect(backend.getPages()[0]).toContain('#123456')
  })

  it('treats a glyph id on the root svg as the whole unclipped glyph document', () => {
    const doc = '<svg id="glyph1" xmlns="http://www.w3.org/2000/svg"><rect x="-50" y="-100" width="100" height="100" fill="#654321"/></svg>'
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(100, 100)
    renderSvgGlyph(parseSvg(doc), backend, 1, 50, 50, 0.1, UPEM)
    backend.endPage()
    expect(backend.getPages()[0]).toContain('#654321')
  })

  it('uses the designated glyph element independently of its original ancestors', () => {
    const doc = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<g transform="translate(100 0)" fill="#AA00BB">'
      + '<g id="glyph1"><rect x="0" y="-100" width="100" height="100"/></g>'
      + '</g></svg>'
    const backend = new SvgBackend({ background: null })
    backend.beginDocument()
    backend.beginPage(100, 100)
    renderSvgGlyph(parseSvg(doc), backend, 1, 0, 50, 0.1, UPEM)
    backend.endPage()
    const page = backend.getPages()[0]!.toLowerCase()
    expect(page).not.toContain('#aa00bb')
    expect(page).toContain('#000000')
    expect(page).toContain('matrix(0.1 0 0 0.1 0 0)')
  })
})

describe('backend integration (drawText with an OT-SVG font)', () => {
  it.skipIf(!existsSync(RSVG_CONVERT))('matches librsvg for feImage fragments and nested SVG viewports', async () => {
    const document = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <g id="fragment" transform="translate(10 10)"><rect width="30" height="25" fill="#00c040"/></g>
        <filter id="image" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><feImage href="#fragment"/></filter>
      </defs>
      <g id="glyph1"><rect width="100" height="100" filter="url(#image)"/><svg x="50" y="50" width="30" height="20" viewBox="0 0 10 10"><rect width="20" height="10" fill="#2040ff"/></svg></g>
    </svg>`
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-svg-fragment-oracle-'))
    try {
      const oracleSvgPath = join(directory, 'oracle.svg')
      const oraclePath = join(directory, 'oracle.png')
      writeFileSync(oracleSvgPath, document.replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"'))
      execFileSync(RSVG_CONVERT, ['--width=100', '--height=100', '--output', oraclePath, oracleSvgPath])
      const expected = await sharp(oraclePath).raw().toBuffer()
      const backend = new SvgBackend({ background: null })
      backend.beginDocument(); backend.beginPage(100, 100)
      renderSvgGlyph(parseSvg(document), backend, 1, 0, 0, 1, 100)
      backend.endPage(); backend.endDocument()
      const actual = await sharp(Buffer.from(backend.getPages()[0]!)).resize(100, 100, { fit: 'fill' }).raw().toBuffer()
      let error = 0
      for (let i = 0; i < actual.length; i++) error += Math.abs(actual[i]! - expected[i]!)
      expect(error / actual.length).toBeLessThan(5)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.skipIf(!existsSync(RSVG_CONVERT))('matches librsvg for an OT-SVG filter, gradient, clip and mask composition', async () => {
    const document = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gradient"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
        <pattern id="pattern" patternUnits="userSpaceOnUse" width="100" height="100"><rect width="50" height="100" fill="#00c000"/><rect x="50" width="50" height="100" fill="#ffff00"/></pattern>
        <clipPath id="clip"><circle cx="300" cy="-300" r="250"/></clipPath>
        <mask id="mask" maskUnits="userSpaceOnUse" x="0" y="-600" width="600" height="600"><rect x="0" y="-600" width="600" height="600" fill="#ffffff"/></mask>
        <filter id="filter" filterUnits="userSpaceOnUse" x="0" y="-600" width="600" height="600"><feColorMatrix type="saturate" values="0.65"/></filter>
      </defs>
      <g id="glyph1" clip-path="url(#clip)" mask="url(#mask)" filter="url(#filter)"><rect x="0" y="-600" width="300" height="600" fill="url(#gradient)"/><rect x="300" y="-600" width="300" height="600" fill="url(#pattern)"/></g>
    </svg>`
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-svg-oracle-'))
    try {
      const oracleSvgPath = join(directory, 'oracle.svg')
      const oraclePath = join(directory, 'oracle.png')
      const oracleDocument = document.replace(
        '<svg xmlns="http://www.w3.org/2000/svg">',
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 -600 600 600">',
      )
      writeFileSync(oracleSvgPath, oracleDocument)
      execFileSync(RSVG_CONVERT, [
        '--background-color=white', '--width=120', '--height=120', '--output', oraclePath, oracleSvgPath,
      ])
      const expected = await sharp(oraclePath).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer()

      const backend = new SvgBackend({ background: '#ffffff' })
      backend.beginDocument(); backend.beginPage(120, 120)
      renderSvgGlyph(parseSvg(document), backend, 1, 0, 120, 0.2, UPEM)
      backend.endPage(); backend.endDocument()
      const actual = await sharp(Buffer.from(backend.getPages()[0]!)).flatten({ background: '#ffffff' })
        .resize(120, 120, { fit: 'fill' }).removeAlpha().raw().toBuffer()
      let error = 0
      for (let i = 0; i < actual.length; i++) error += Math.abs(actual[i]! - expected[i]!)
      expect(error / actual.length).toBeLessThan(12)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.skipIf(!existsSync(RSVG_CONVERT))('matches the SVG 1.1 feTurbulence algorithm and stitched tile coordinates', async () => {
    const document = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><filter id="noise" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <feTurbulence x="0" y="0" width="100" height="100" baseFrequency="0.08 0.05" numOctaves="3" seed="7" stitchTiles="stitch" type="fractalNoise"/>
      </filter></defs>
      <g id="glyph1" filter="url(#noise)"><rect width="100" height="100"/></g>
    </svg>`
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-svg-turbulence-oracle-'))
    try {
      const oracleSvgPath = join(directory, 'oracle.svg')
      const oraclePath = join(directory, 'oracle.png')
      writeFileSync(oracleSvgPath, document.replace('viewBox="0 0 100 100"', 'width="100" height="100" viewBox="0 0 100 100"'))
      execFileSync(RSVG_CONVERT, ['--width=100', '--height=100', '--output', oraclePath, oracleSvgPath])
      const expected = await sharp(oraclePath).raw().toBuffer()

      const backend = new SvgBackend({ background: null })
      backend.beginDocument(); backend.beginPage(100, 100)
      renderSvgGlyph(parseSvg(document), backend, 1, 0, 0, 0.1, UPEM)
      backend.endPage(); backend.endDocument()
      const actual = await sharp(Buffer.from(backend.getPages()[0]!)).resize(100, 100, { fit: 'fill' }).raw().toBuffer()
      let error = 0
      const channelError = [0, 0, 0, 0]
      for (let i = 0; i < actual.length; i++) {
        const difference = Math.abs(actual[i]! - expected[i]!)
        error += difference
        channelError[i & 3]! += difference
      }
      expect(error / actual.length, `channel MAE: ${channelError.map(value => value / (actual.length / 4)).join(', ')}`).toBeLessThan(5)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('connects currentColor and CPAL variables to foreground and palette selection', () => {
    const document = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<g id="glyph1"><rect x="0" y="-500" width="250" height="500" fill="var(--color0, red)"/>'
      + '<rect x="250" y="-500" width="250" height="500" fill="currentColor"/></g></svg>'
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['SVG ', buildSvgTable(1, 1, document)], ['CPAL', buildCpalTable()]],
    ))
    font.setColorPalette(1)
    const backend = new SvgBackend({ fonts: { f1: font }, background: null })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawText(10, 50, 'A', 'f1', 40, '#123456')
    backend.endPage()
    const page = backend.getPages()[0]!.toLowerCase()
    expect(page).toContain('#0000ff')
    expect(page).toContain('#123456')
    expect(page).toContain('fill-opacity="0.502"')
  })

  it('SvgBackend draws the SVG glyph instead of the outline', () => {
    const font = loadSvgFont()
    const backend = new SvgBackend({ fonts: { f1: font }, background: null })
    backend.beginDocument()
    backend.beginPage(300, 300)
    backend.drawText(10, 10, 'A', 'f1', 100, '#000000')
    backend.endPage()
    const page = backend.getPages()[0]!.toLowerCase()
    expect(page).toContain('#ff0000')
    expect(page).toContain('m100 -500') // SVG glyph geometry, not the square outline
  })

  it('CanvasBackend routes the SVG glyph through the project SVG renderer', () => {
    const font = loadSvgFont()
    const calls: [string, ...unknown[]][] = []
    const ctx = {
      canvas: { width: 0, height: 0, style: {} },
      save: vi.fn(() => calls.push(['save'])),
      restore: vi.fn(() => calls.push(['restore'])),
      setTransform: vi.fn(),
      transform: vi.fn((...a: unknown[]) => calls.push(['transform', ...a])),
      translate: vi.fn((...a: unknown[]) => calls.push(['translate', ...a])),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn((...a: unknown[]) => calls.push(['moveTo', ...a])),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      rect: vi.fn((...a: unknown[]) => calls.push(['rect', ...a])),
      clip: vi.fn(),
      fill: vi.fn((...a: unknown[]) => calls.push(['fill', ...a])),
      stroke: vi.fn(),
      fillRect: vi.fn((...a: unknown[]) => calls.push(['fillRect', ...a])),
      setLineDash: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    }
    const backend = new CanvasBackend(ctx, { fonts: { f1: font }, background: null })
    backend.beginPage(300, 300)
    calls.length = 0
    backend.drawText(10, 10, 'A', 'f1', 100, '#000000')

    // The rect from the glyph document was filled (fillStyle became red at some point)
    const filled = calls.some(c => c[0] === 'fill' || c[0] === 'fillRect')
    expect(filled).toBe(true)
  })

  it('PdfBackend embeds the SVG glyph as vector operations', () => {
    const font = loadSvgFont()
    const backend = new PdfBackend({ fonts: { f1: font } })
    backend.beginDocument()
    backend.beginPage(300, 300)
    backend.drawText(10, 10, 'A', 'f1', 100, '#000000')
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const header = new TextDecoder('latin1').decode(bytes.slice(0, 8))
    expect(header).toContain('%PDF')
  })

  it('selects COLR before SVG in Canvas, SVG and PDF backends', () => {
    const svgDocument = '<svg xmlns="http://www.w3.org/2000/svg"><g id="glyph1"><rect x="0" y="-500" width="500" height="500" fill="#00ff00"/></g></svg>'
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3]), encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [
        ['SVG ', buildSvgTable(1, 1, svgDocument)],
        ['COLR', buildColrV0Table(1, 2, 0)],
        ['CPAL', buildCpalTable()],
      ],
    ))

    const canvasCalls: string[] = []
    const canvasContext = new Proxy({ canvas: { width: 0, height: 0, style: {} } } as Record<string, unknown>, {
      get(target, property: string) {
        if (property in target) return target[property]
        return (...args: unknown[]) => { if (property === 'fillStyle') canvasCalls.push(String(args[0])) }
      },
      set(target, property: string, value: unknown) {
        target[property] = value
        if (property === 'fillStyle') canvasCalls.push(String(value))
        return true
      },
    })
    const canvas = new CanvasBackend(canvasContext, { fonts: { f: font }, background: null })
    canvas.beginPage(100, 100); canvas.drawText(0, 0, 'A', 'f', 40, '#000000')
    expect(canvasCalls.some(value => value.includes('255,0,0'))).toBe(true)
    expect(canvasCalls.some(value => value.includes('0,255,0'))).toBe(false)

    const svg = new SvgBackend({ fonts: { f: font }, background: null })
    svg.beginDocument(); svg.beginPage(100, 100); svg.drawText(0, 0, 'A', 'f', 40, '#000000'); svg.endPage()
    expect(svg.getPages()[0]!.toLowerCase()).toContain('rgba(255,0,0,1)')
    expect(svg.getPages()[0]!.toLowerCase()).not.toContain('#00ff00')

    const pdf = new PdfBackend({ fonts: { f: font } })
    pdf.beginDocument(); pdf.beginPage(100, 100); pdf.drawText(0, 0, 'A', 'f', 40, '#000000'); pdf.endPage(); pdf.endDocument()
    const content = pdfToText(pdf.toUint8Array())
    expect(content).toContain('1 0 0 rg')
    expect(content).not.toContain('0 1 0 rg')
  })

  it('connects OT-SVG glyph selection to vertical metrics in every backend', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
      [['SVG ', buildSvgTable(1, 1, GLYPH_DOC)], ['vhea', buildVerticalHeader()], ['vmtx', buildVerticalMetrics()]],
    ))
    const options = { writingMode: 'vertical-rl' as const, glyphIds: [1, 1] }

    const transforms: unknown[][] = []
    const canvasContext = new Proxy({ canvas: { width: 0, height: 0, style: {} } } as Record<string, unknown>, {
      get(target, property: string) {
        if (property in target) return target[property]
        return (...args: unknown[]) => { if (property === 'translate') transforms.push(args) }
      },
      set(target, property: string, value: unknown) { target[property] = value; return true },
    })
    const canvas = new CanvasBackend(canvasContext, { fonts: { f: font }, background: null })
    canvas.beginPage(100, 120); canvas.drawText(10, 0, 'AA', 'f', 40, '#000000', options)
    expect(transforms.length).toBeGreaterThanOrEqual(2)

    const svg = new SvgBackend({ fonts: { f: font }, background: null })
    svg.beginDocument(); svg.beginPage(100, 120); svg.drawText(10, 0, 'AA', 'f', 40, '#000000', options); svg.endPage()
    const svgPage = svg.getPages()[0]!.toLowerCase()
    expect(svgPage).toContain('#ff0000')
    expect((svgPage.match(/translate\(/g) ?? []).length).toBeGreaterThanOrEqual(2)

    const pdf = new PdfBackend({ fonts: { f: font } })
    pdf.beginDocument(); pdf.beginPage(100, 120); pdf.drawText(10, 0, 'AA', 'f', 40, '#000000', options); pdf.endPage(); pdf.endDocument()
    expect(pdfToText(pdf.toUint8Array())).toContain('1 0 0 rg')
  })
})
