/**
 * Shaped glyph run rendering tests
 *
 * Verifies that the shaping result used for layout measurement (GSUB ligatures,
 * GPOS kerning, vertical alternates, justify/letter spacing) is the same one
 * rendered by the PDF and Canvas backends:
 * - PDF TJ adjustments reproduce the measured (shaped) width exactly
 * - Ligature glyphs are shown as single glyphs and restored via ToUnicode
 * - justify / letterSpacing reach the PDF output (TJ or Tc)
 * - Vertical text uses vert-substituted glyph IDs in every path
 * - Shaped glyphs (ligature / vertical alternates) are embedded in the subset
 * - Shaping runs at most once per line
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { layoutText } from '../../src/layout/text-layout.js'
import { renderTextToGroup, type TextContentStyle } from '../../src/layout/engine.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { CanvasBackend } from '../../src/renderer/canvas-backend.js'
import { SvgBackend } from '../../src/renderer/svg-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { zlibInflate } from '../../src/compression/inflate.js'
import { pdfToText } from './pdf-test-utils.js'
import type { RenderDocument, RenderNode } from '../../src/types/render.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

let notoSans: Font
let notoSansJp: Font

beforeAll(() => {
  const latin = readFileSync(join(FIXTURES, 'NotoSans-Regular.ttf'))
  notoSans = Font.load(latin.buffer.slice(latin.byteOffset, latin.byteOffset + latin.byteLength) as ArrayBuffer)
  const jp = readFileSync(join(FIXTURES, 'NotoSansJP-Regular.otf'))
  notoSansJp = Font.load(jp.buffer.slice(jp.byteOffset, jp.byteOffset + jp.byteLength) as ArrayBuffer)
})

// ─── Helpers ───

function baseStyle(fontSize: number, hAlign: TextContentStyle['hAlign'] = 'left'): TextContentStyle {
  return {
    fontFamily: 'f',
    fontSize,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    forecolor: '#000000',
    hAlign,
    vAlign: 'top',
  }
}

function renderNodeToPdf(node: RenderNode, font: Font): Uint8Array {
  const doc: RenderDocument = {
    pages: [{ width: 595, height: 842, children: [node] }],
  }
  const backend = new PdfBackend({ fonts: { f: font } })
  render(doc, backend)
  return backend.toUint8Array()
}

/** Parse the /W array into a newGid → width (thousandths of em) map */
function parseWidths(pdfText: string): Map<number, number> {
  const idx = pdfText.indexOf('/W [')
  expect(idx).toBeGreaterThanOrEqual(0)
  // Find the matching closing bracket of the (nested) /W array
  let depth = 0
  let end = -1
  for (let i = idx + 3; i < pdfText.length; i++) {
    const ch = pdfText[i]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  expect(end).toBeGreaterThan(idx)
  const body = pdfText.substring(idx + 4, end)
  const widths = new Map<number, number>()
  const re = /(\d+) \[(\d+)\]/g
  let e: RegExpExecArray | null
  while ((e = re.exec(body)) !== null) {
    widths.set(parseInt(e[1]!, 10), parseInt(e[2]!, 10))
  }
  return widths
}

interface ShowTextGroup {
  glyphIds: number[]
  /** Rendered pen advance of the whole group in thousandths of em */
  widthTh: number
}

/**
 * Concatenate decompressed stream bodies containing the given marker
 * (avoids false matches inside embedded font binaries)
 */
function streamsContaining(pdfText: string, marker: string): string {
  const parts: string[] = []
  const re = /stream\n([\s\S]*?)\nendstream/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pdfText)) !== null) {
    if (m[1]!.includes(marker)) parts.push(m[1]!)
  }
  return parts.join('\n')
}

/** Parse every Tj / TJ group of the page content streams (widths from the /W map) */
function parseShowTextGroups(pdfText: string, widths: Map<number, number>): ShowTextGroup[] {
  const content = streamsContaining(pdfText, 'BT')
  const groups: ShowTextGroup[] = []
  const showRe = /(?:<([0-9a-f]+)> Tj)|(?:\[(.*?)\] TJ)/g
  let m: RegExpExecArray | null
  while ((m = showRe.exec(content)) !== null) {
    const glyphIds: number[] = []
    let widthTh = 0
    if (m[1] !== undefined) {
      for (let i = 0; i + 4 <= m[1].length; i += 4) {
        const gid = parseInt(m[1].substring(i, i + 4), 16)
        glyphIds.push(gid)
        widthTh += widths.get(gid) ?? 0
      }
    } else {
      const partRe = /<([0-9a-f]+)>|(-?[\d.]+)/g
      let p: RegExpExecArray | null
      while ((p = partRe.exec(m[2]!)) !== null) {
        if (p[1] !== undefined) {
          for (let i = 0; i + 4 <= p[1].length; i += 4) {
            const gid = parseInt(p[1].substring(i, i + 4), 16)
            glyphIds.push(gid)
            widthTh += widths.get(gid) ?? 0
          }
        } else {
          widthTh -= parseFloat(p[2]!)
        }
      }
    }
    groups.push({ glyphIds, widthTh })
  }
  return groups
}

/** Extract and inflate the embedded FontFile2 (TrueType subset) from raw PDF bytes */
function extractFontFile2(bytes: Uint8Array): Uint8Array {
  const raw = Buffer.from(bytes).toString('latin1')
  const re = /<< \/Length (\d+) \/Filter \/FlateDecode \/Length1 \d+ >>\nstream\n/g
  const m = re.exec(raw)
  expect(m).not.toBeNull()
  const start = m!.index + m![0].length
  return zlibInflate(bytes.subarray(start, start + parseInt(m![1]!, 10)))
}

// ─── PDF: kerning ───

describe('シェープ済みグリフランのPDF出力', () => {
  it('明示ベースラインは要素高による行切捨てを受けずPDF座標まで維持される', () => {
    const fontSize = 12
    const node = renderTextToGroup(
      'SP',
      { x: 10, y: 20, width: 50, height: 1, baselineOffset: fontSize, wrap: false },
      baseStyle(fontSize),
      new TextMeasurer(notoSans),
      false,
    )
    expect(node).toMatchObject({
      type: 'group',
      x: 10,
      y: 20,
      clip: false,
      children: [{ type: 'text', text: 'SP', baselineOffset: fontSize }],
    })

    const pdf = renderNodeToPdf(node, notoSans)
    expect(streamsContaining(pdfToText(pdf), 'BT')).toContain('1 0 0 -1 0 12 Tm')
  })

  it('MERG groupをCanvas・SVG・PDFで一つのoutline pathとして描画する', () => {
    const gidA = notoSans.getGlyphId(0x41)
    const gidV = notoSans.getGlyphId(0x56)
    const fontSize = 12
    const scale = fontSize / notoSans.metrics.unitsPerEm
    const advanceA = notoSans.getAdvanceWidth(gidA) * scale
    const advanceV = notoSans.getAdvanceWidth(gidV) * scale
    const doc: RenderDocument = {
      pages: [{
        width: 100,
        height: 100,
        children: [{
          type: 'text', x: 10, y: 10, text: 'AV', fontId: 'f', fontSize, color: '#000000',
          glyphRun: {
            glyphIds: Uint16Array.of(gidA, gidV),
            advances: Float64Array.of(advanceA, advanceV),
            xOffsets: Float64Array.of(0, 0),
            yOffsets: Float64Array.of(0, 0),
            clusters: Uint16Array.of(1, 1),
            mergeGroups: Uint32Array.of(1, 1),
          },
        }],
      }],
    }

    const canvas = createMergeGroupCanvasContext()
    render(doc, new CanvasBackend(canvas, { fonts: { f: notoSans } }))
    expect(canvas.beginPath).toHaveBeenCalledTimes(1)
    expect(canvas.fill).toHaveBeenCalledTimes(1)
    const glyphA = notoSans.getGlyph(gidA)
    const glyphV = notoSans.getGlyph(gidV)
    const movesInA = countMoveTos(glyphA.outline.commands)
    expect(canvas.moveTo).toHaveBeenCalledTimes(movesInA + countMoveTos(glyphV.outline.commands))
    const firstVMove = canvas.moveTo.mock.calls[movesInA]!
    expect(firstVMove[0]).toBeCloseTo(10 + advanceA + glyphV.outline.coords[0]! * scale, 5)
    expect(firstVMove[1]).toBeCloseTo(10 + notoSans.metrics.ascender * scale - glyphV.outline.coords[1]! * scale, 5)

    const svg = new SvgBackend({ fonts: { f: notoSans }, background: null })
    render(doc, svg)
    const svgPage = svg.getPages()[0]!
    expect(svgPage.match(/<path\s/g)).toHaveLength(1)

    const pdf = new PdfBackend({ fonts: { f: notoSans } })
    render(doc, pdf)
    const pageContent = streamsContaining(pdfToText(pdf.toUint8Array()), 'BT')
    expect(pageContent.match(/^f$/gm)).toHaveLength(1)
  })

  it('AAT stretch の glyph 単位 scale をPDFとSVGの可視アウトラインへ渡す', () => {
    const gid = notoSans.getGlyphId(0x41)
    const fontSize = 12
    const advance = notoSans.getAdvanceWidth(gid) * fontSize / notoSans.metrics.unitsPerEm
    const doc: RenderDocument = {
      pages: [{
        width: 100,
        height: 100,
        children: [{
          type: 'text', x: 10, y: 10, text: 'A', fontId: 'f', fontSize, color: '#000000',
          glyphRun: {
            glyphIds: Uint16Array.of(gid),
            advances: Float64Array.of(advance * 1.5),
            xOffsets: Float64Array.of(0),
            yOffsets: Float64Array.of(0),
            clusters: Uint16Array.of(1),
            xScales: Float64Array.of(1.5),
            yScales: Float64Array.of(1.25),
          },
        }],
      }],
    }

    const pdf = new PdfBackend({ fonts: { f: notoSans } })
    render(doc, pdf)
    expect(streamsContaining(pdfToText(pdf.toUint8Array()), 'BT')).toContain('1.5 0 0 1.25')

    const svg = new SvgBackend({ fonts: { f: notoSans }, background: null })
    render(doc, svg)
    expect(svg.getPages()[0]).toContain('scale(1.5 1.25)')
  })

  it('カーニングを持つテキストの計測幅とPDF実描画幅が一致する', () => {
    const fontSize = 24
    const text = 'AVATAR'
    const measurer = new TextMeasurer(notoSans)
    const measured = measurer.measure(text, fontSize).width

    const node = renderTextToGroup(
      text,
      { x: 0, y: 0, width: 200, height: 50 },
      baseStyle(fontSize),
      measurer,
      false,
    )
    const bytes = renderNodeToPdf(node, notoSans)
    const pdfText = pdfToText(bytes)

    // Kerned text must be emitted with TJ adjustments
    expect(streamsContaining(pdfText, 'BT')).toContain('] TJ')

    const widths = parseWidths(pdfText)
    const groups = parseShowTextGroups(pdfText, widths)
    expect(groups.length).toBe(1)

    const rendered = groups[0]!.widthTh / 1000 * fontSize
    expect(Math.abs(rendered - measured)).toBeLessThan(0.05)
  })

  it('カーニングなしの等幅CJKテキストは従来どおり単一Tjで出力される', () => {
    const fontSize = 12
    const measurer = new TextMeasurer(notoSansJp)
    const node = renderTextToGroup(
      'あいうえお',
      { x: 0, y: 0, width: 200, height: 50 },
      baseStyle(fontSize),
      measurer,
      false,
    )
    const bytes = renderNodeToPdf(node, notoSansJp)
    const pdfText = pdfToText(bytes)

    // Integer full-width advances need no adjustment: plain Tj is kept
    const content = streamsContaining(pdfText, 'BT')
    expect(content).toContain('> Tj')
    expect(content).not.toContain('] TJ')
  })

  // ─── PDF: ligature + ToUnicode + subset ───

  it('リガチャがリガチャグリフ1個で出力されToUnicodeで元テキストに復元される', () => {
    const fontSize = 24
    const text = 'fi'
    const measurer = new TextMeasurer(notoSans)

    // The fixture font ligates "fi" into a single glyph
    const shaped = notoSans.shapeText(text)
    expect(shaped.length).toBe(1)
    expect(shaped[0]!.componentCount).toBe(2)
    const ligGid = shaped[0]!.glyphId
    expect(ligGid).not.toBe(notoSans.getGlyphId(0x66))

    const node = renderTextToGroup(
      text,
      { x: 0, y: 0, width: 200, height: 50 },
      baseStyle(fontSize),
      measurer,
      false,
    )
    const bytes = renderNodeToPdf(node, notoSans)
    const pdfText = pdfToText(bytes)

    // Exactly one glyph is shown
    const widths = parseWidths(pdfText)
    const groups = parseShowTextGroups(pdfText, widths)
    expect(groups.length).toBe(1)
    expect(groups[0]!.glyphIds.length).toBe(1)

    // ToUnicode maps the ligature glyph back to "fi" (multi code unit bfchar)
    const gidHex = groups[0]!.glyphIds[0]!.toString(16).padStart(4, '0').toUpperCase()
    expect(streamsContaining(pdfText, 'beginbfchar')).toContain(`<${gidHex}> <00660069>`)

    // The rendered width equals the measured (shaped) width
    const measured = measurer.measure(text, fontSize).width
    const rendered = groups[0]!.widthTh / 1000 * fontSize
    expect(Math.abs(rendered - measured)).toBeLessThan(0.05)
  })

  it('サブセットフォントにリガチャグリフの実アウトラインが含まれる', () => {
    const measurer = new TextMeasurer(notoSans)
    const node = renderTextToGroup(
      'fi',
      { x: 0, y: 0, width: 200, height: 50 },
      baseStyle(24),
      measurer,
      false,
    )
    const bytes = renderNodeToPdf(node, notoSans)
    const pdfText = pdfToText(bytes)
    const widths = parseWidths(pdfText)
    const groups = parseShowTextGroups(pdfText, widths)
    const subsetGid = groups[0]!.glyphIds[0]!

    // Load the embedded subset and confirm the ligature glyph has an outline
    const fontFile = extractFontFile2(bytes)
    const subsetFont = Font.load(fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength) as ArrayBuffer)
    const glyph = subsetFont.getGlyph(subsetGid)
    expect(glyph.outline.commands.length).toBeGreaterThan(0)
  })

  // ─── PDF: justify / letterSpacing ───

  it('justify指定時にPDFへ字間調整(TJ)が入り行幅が要素幅と一致する', () => {
    const fontSize = 10
    const width = 55
    const measurer = new TextMeasurer(notoSansJp)
    const node = renderTextToGroup(
      'あいうえおかきくけこ',
      { x: 0, y: 0, width, height: 60 },
      baseStyle(fontSize, 'justify'),
      measurer,
      false,
    )
    const bytes = renderNodeToPdf(node, notoSansJp)
    const pdfText = pdfToText(bytes)

    // Justify spacing is expressed through TJ adjustments
    expect(streamsContaining(pdfText, 'BT')).toContain('] TJ')

    const widths = parseWidths(pdfText)
    const groups = parseShowTextGroups(pdfText, widths)
    expect(groups.length).toBe(2)

    // The justified first line stretches exactly to the element content width
    const firstLine = groups[0]!.widthTh / 1000 * fontSize
    expect(Math.abs(firstLine - width)).toBeLessThan(0.05)
  })

  it('レイアウト経由のletterSpacingが描画幅に反映される', () => {
    const fontSize = 12
    const letterSpacing = 2
    const text = 'あいう'
    const measurer = new TextMeasurer(notoSansJp)
    const node = renderTextToGroup(
      text,
      { x: 0, y: 0, width: 200, height: 50, letterSpacing },
      baseStyle(fontSize),
      measurer,
      false,
    )
    const bytes = renderNodeToPdf(node, notoSansJp)
    const pdfText = pdfToText(bytes)

    const widths = parseWidths(pdfText)
    const groups = parseShowTextGroups(pdfText, widths)
    expect(groups.length).toBe(1)

    // Every inter-glyph gap carries the letter spacing. The trailing spacing
    // after the last glyph has no TJ adjustment (nothing follows it), so the
    // pen advance covers the two gaps between the three glyphs.
    const expected = measurer.measure(text, fontSize).width + letterSpacing * 2
    const rendered = groups[0]!.widthTh / 1000 * fontSize
    expect(Math.abs(rendered - expected)).toBeLessThan(0.05)
  })

  it('RenderText.letterSpacing直接指定時はTcとして出力される', () => {
    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 10, y: 10,
          text: 'ABC DEF', fontId: 'f', fontSize: 12, color: '#000000',
          letterSpacing: 5,
        }],
      }],
    }
    const backend = new PdfBackend({ fonts: { f: notoSans } })
    render(doc, backend)
    const pdfText = pdfToText(backend.toUint8Array())

    expect(pdfText).toContain('5 Tc')
    expect(pdfText).toContain('0 Tc')
  })

  // ─── PDF: vertical writing ───

  it('縦書きで「、」等がvert置換グリフで出力されサブセットに含まれる', () => {
    const text = '縦書き、テスト。'
    const vertGid = notoSansJp.shapeText('、', { direction: 'vertical' })[0]!.glyphId
    const cmapGid = notoSansJp.getGlyphId(0x3001)
    expect(vertGid).not.toBe(cmapGid)

    const backend = new PdfBackend({ fonts: { f: notoSansJp } })
    backend.beginDocument()
    backend.beginPage(595, 842)
    backend.drawText(500, 50, text, 'f', 20, '#000000', { writingMode: 'vertical-rl' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const pdfText = pdfToText(bytes)

    // Vertical text renders as a CID text object with Identity-V encoding
    const content = streamsContaining(pdfText, 'BT')
    expect(content).toContain('V 20 Tf')
    expect(pdfText).toContain('/Encoding /Identity-V')
    expect(pdfText).toContain('/W2 [')
    expect(pdfText).toContain('/DW2 [880 -1000]')

    // ToUnicode maps a subset GID back to U+3001, so the tracked glyph for
    // 「、」 is the vert-substituted one and it is part of the subset
    const m = streamsContaining(pdfText, 'beginbfchar').match(/<([0-9A-F]{4})> <3001>/)
    expect(m).not.toBeNull()
    const subsetGid = parseInt(m![1]!, 16)

    // The /W array is built from the subset glyph set: the vert glyph is included
    const widths = parseWidths(pdfText)
    expect(widths.has(subsetGid)).toBe(true)
  })

  it('縦書きレイアウト(layoutText)の行ランがvert置換グリフを持つ', () => {
    const measurer = new TextMeasurer(notoSansJp)
    const result = layoutText('あ、い。', measurer, 12, {
      maxWidth: 100,
      maxHeight: 200,
      writingMode: 'vertical-rl',
    })
    expect(result.lines.length).toBeGreaterThan(0)
    const run = result.lines[0]!.run!
    expect(run).toBeDefined()

    const vertGid = notoSansJp.shapeText('、', { direction: 'vertical' })[0]!.glyphId
    const gids = [...run.glyphIds]
    expect(gids).toContain(vertGid)
    expect(gids).not.toContain(notoSansJp.getGlyphId(0x3001))
  })
})

function createMergeGroupCanvasContext() {
  return {
    canvas: { width: 0, height: 0, style: { width: '', height: '' } },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textBaseline: '',
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    transform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    setLineDash: vi.fn(),
  }
}

// ─── Canvas backend ───

describe('シェープ済みグリフランのCanvas出力', () => {
  function createMockCtx() {
    const moveTos: { x: number; y: number }[] = []
    return {
      moveTos,
      canvas: { width: 0, height: 0, style: { width: '', height: '' } },
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      globalAlpha: 1,
      font: '',
      textBaseline: '',
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      transform: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn((x: number, y: number) => { moveTos.push({ x, y }) }),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((t: string) => ({ width: t.length * 6 })),
      setLineDash: vi.fn(),
    }
  }

  it('縦書きの「、」がvert置換グリフのアウトラインで描画される', () => {
    const fontSize = 20
    const ctx = createMockCtx()
    const backend = new CanvasBackend(ctx, { fonts: { f: notoSansJp } })
    backend.beginPage(595, 842)
    backend.drawText(100, 50, '、', 'f', fontSize, '#000000', { writingMode: 'vertical-rl' })

    const scale = fontSize / notoSansJp.metrics.unitsPerEm
    const vertGid = notoSansJp.shapeText('、', { direction: 'vertical' })[0]!.glyphId
    const glyph = notoSansJp.getGlyph(vertGid)
    expect(glyph.outline.commands[0]).toBe(0)

    // Expected first moveTo from the vertical placement of the vert glyph
    const halfAw = notoSansJp.getAdvanceWidth(vertGid) * scale / 2
    const vOriginY = notoSansJp.getVerticalOrigin(vertGid) * scale
    const glyphCx = 100 + fontSize / 2 - halfAw
    const glyphCy = 50 + vOriginY
    const expectedX = glyphCx + glyph.outline.coords[0]! * scale
    const expectedY = glyphCy - glyph.outline.coords[1]! * scale

    expect(ctx.moveTos.length).toBeGreaterThan(0)
    expect(Math.abs(ctx.moveTos[0]!.x - expectedX)).toBeLessThan(0.01)
    expect(Math.abs(ctx.moveTos[0]!.y - expectedY)).toBeLessThan(0.01)
  })

  it('グリフラン付きRenderTextはカーニング適用位置で描画される', () => {
    const fontSize = 24
    const measurer = new TextMeasurer(notoSans)
    const node = renderTextToGroup(
      'AV',
      { x: 0, y: 0, width: 200, height: 50 },
      baseStyle(fontSize),
      measurer,
      false,
    )
    // The canvas backend always draws glyph outlines; it must consume the run
    const ctx = createMockCtx()
    const backend = new CanvasBackend(ctx, { fonts: { f: notoSans } })
    backend.beginPage(595, 842)

    const doc: RenderDocument = { pages: [{ width: 595, height: 842, children: [node] }] }
    render(doc, backend)

    const scale = fontSize / notoSans.metrics.unitsPerEm
    const shaped = notoSans.shapeText('AV')
    expect(shaped.length).toBe(2)

    // First moveTo of the second glyph must sit at the kerned advance of the first
    const glyphA = notoSans.getGlyph(shaped[0]!.glyphId)
    const glyphV = notoSans.getGlyph(shaped[1]!.glyphId)
    const movesPerA = countMoveTos(glyphA.outline.commands)
    expect(ctx.moveTos.length).toBe(movesPerA + countMoveTos(glyphV.outline.commands))

    const kernedAdvance = shaped[0]!.xAdvance * scale
    const expectedVX = kernedAdvance + glyphV.outline.coords[0]! * scale
    expect(Math.abs(ctx.moveTos[movesPerA]!.x - expectedVX)).toBeLessThan(0.01)
  })

  it('AAT stretch のglyph単位XY scaleをCanvas変換へ渡す', () => {
    const gid = notoSans.getGlyphId(0x41)
    const fontSize = 12
    const ctx = createMockCtx()
    const backend = new CanvasBackend(ctx, { fonts: { f: notoSans } })
    const doc: RenderDocument = {
      pages: [{
        width: 100,
        height: 100,
        children: [{
          type: 'text', x: 0, y: 0, text: 'A', fontId: 'f', fontSize, color: '#000000',
          glyphRun: {
            glyphIds: Uint16Array.of(gid),
            advances: Float64Array.of(10),
            xOffsets: Float64Array.of(0),
            yOffsets: Float64Array.of(0),
            clusters: Uint16Array.of(1),
            xScales: Float64Array.of(1.5),
            yScales: Float64Array.of(1.25),
          },
        }],
      }],
    }

    render(doc, backend)

    expect(ctx.scale).toHaveBeenCalledWith(1.5, 1.25)
  })
})

function countMoveTos(commands: Uint8Array): number {
  let count = 0
  for (let i = 0; i < commands.length; i++) {
    if (commands[i] === 0) count++
  }
  return count
}

// ─── Shaping count (performance contract) ───

describe('シェーピング実行回数', () => {
  it('レイアウトとPDF出力を通してシェーピングは段落ごとに1回に収まる', () => {
    const paragraph = 'この帳票エンジンは純粋な実装で構築されている。'.repeat(50)
    const text = `${paragraph}\n${paragraph}\n${paragraph}`
    const measurer = new TextMeasurer(notoSansJp)

    const original = notoSansJp.shapeText.bind(notoSansJp)
    let count = 0
    const spy = vi.spyOn(notoSansJp, 'shapeText').mockImplementation((t, o) => {
      count++
      return original(t, o)
    })

    const node = renderTextToGroup(
      text,
      { x: 0, y: 0, width: 400, height: 2000 },
      baseStyle(10),
      measurer,
      true,
    )
    const layoutCalls = count
    expect(layoutCalls).toBe(3)  // one shaping pass per paragraph

    const bytes = renderNodeToPdf(node, notoSansJp)
    expect(bytes.length).toBeGreaterThan(0)
    // Rendering reuses the layout runs: no additional shaping
    expect(count).toBe(layoutCalls)

    spy.mockRestore()
  })
})
