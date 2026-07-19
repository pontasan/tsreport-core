/**
 * WYSIWYG precision verification for multi-page PDFs (PDF byte level).
 *
 * The sibling pdf-wysiwyg-precision.test.ts covers page 1 only; this file
 * verifies that render-tree absolute coordinates stay in sync with the PDF
 * output on page 2 and later: page-break placement, margin propagation,
 * pageFooter position, PAGE_NUMBER/TOTAL_PAGES state, page count, MediaBox
 * for landscape/custom paper, and line path operators inside group cm
 * transforms.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { createReport } from '../../src/layout/engine.js'
import { renderToPdf } from '../../src/renderer/renderer.js'
import { pdfToText } from './pdf-test-utils.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderText, RenderRect, RenderLine, RenderDocument } from '../../src/types/render.js'

const FONT_PATH = new URL('../fixtures/fonts/NotoSansJP-Regular.otf', import.meta.url).pathname

let font: Font
let fontMap: Map<string, TextMeasurer>

beforeAll(() => {
  const buffer = readFileSync(FONT_PATH)
  font = Font.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
  fontMap = new Map([['NotoSansJP', new TextMeasurer(font)]])
})

type AbsText = { text: RenderText, x: number, y: number }
type AbsRect = { rect: RenderRect, x: number, y: number }
type AbsLine = { line: RenderLine, x1: number, y1: number, x2: number, y2: number }

function collectAbs(doc: RenderDocument, pageIndex: number) {
  const texts: AbsText[] = []
  const rects: AbsRect[] = []
  const lines: AbsLine[] = []
  function walk(nodes: RenderNode[], ox: number, oy: number): void {
    for (const node of nodes) {
      if (node.type === 'text') texts.push({ text: node, x: ox + node.x, y: oy + node.y })
      else if (node.type === 'rect') rects.push({ rect: node, x: ox + node.x, y: oy + node.y })
      else if (node.type === 'line') lines.push({ line: node, x1: ox + node.x1, y1: oy + node.y1, x2: ox + node.x2, y2: oy + node.y2 })
      else if (node.type === 'group') walk(node.children, ox + node.x, oy + node.y)
    }
  }
  walk(doc.pages[pageIndex]!.children, 0, 0)
  return { texts, rects, lines }
}

/**
 * Splits the expanded PDF text into per-page content stream segments.
 * Each page's content stream starts with the Y-flip "1 0 0 -1 0 <h> cm"
 * emitted by PdfBackend.beginPage and ends at "endstream".
 */
function splitPageStreams(content: string): string[] {
  const segments: string[] = []
  const flipRe = /^1 0 0 -1 0 [\d.]+ cm$/gm
  let m: RegExpExecArray | null
  while ((m = flipRe.exec(content)) !== null) {
    segments.push(content.substring(m.index, content.indexOf('\nendstream', m.index)))
  }
  return segments
}

type PdfLine = { x1: number, y1: number, x2: number, y2: number }
type PdfRect = { x: number, y: number, w: number, h: number }

/**
 * Parses one page content stream tracking q/Q and pure-translation cm
 * operators, and returns line paths ("x1 y1 m x2 y2 l S") and drawn
 * rectangles ("x y w h re" alone on a line; clip rects carry "re W n" on the
 * same line and are excluded) as page-absolute top-down coordinates —
 * directly comparable with render-tree absolute coordinates.
 */
function parsePageOps(segment: string): { lines: PdfLine[], rects: PdfRect[] } {
  const lines: PdfLine[] = []
  const rects: PdfRect[] = []
  let tx = 0
  let ty = 0
  const stack: Array<[number, number]> = []
  for (const op of segment.split('\n')) {
    if (op === 'q') { stack.push([tx, ty]); continue }
    if (op === 'Q') { const s = stack.pop()!; tx = s[0]; ty = s[1]; continue }
    let m = op.match(/^1 0 0 1 ([-\d.]+) ([-\d.]+) cm$/)
    if (m) { tx += parseFloat(m[1]!); ty += parseFloat(m[2]!); continue }
    m = op.match(/^([-\d.]+) ([-\d.]+) m ([-\d.]+) ([-\d.]+) l S$/)
    if (m) { lines.push({ x1: tx + parseFloat(m[1]!), y1: ty + parseFloat(m[2]!), x2: tx + parseFloat(m[3]!), y2: ty + parseFloat(m[4]!) }); continue }
    m = op.match(/^([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re$/)
    if (m) rects.push({ x: tx + parseFloat(m[1]!), y: ty + parseFloat(m[2]!), w: parseFloat(m[3]!), h: parseFloat(m[4]!) })
  }
  return { lines, rects }
}

function pdftotextAvailable(): boolean {
  let path: string
  try {
    path = execSync('which pdftotext').toString().trim()
  } catch {
    return false
  }
  return path !== ''
}

type BboxWord = { xMin: number, yMin: number, text: string }

/** Runs pdftotext -bbox and returns words grouped per <page> block. */
function pdftotextBboxPages(pdf: Uint8Array): BboxWord[][] {
  const pdfPath = join(tmpdir(), `tsreport-precision-mp-${process.pid}.pdf`)
  writeFileSync(pdfPath, pdf)
  const bboxXml = execSync(`pdftotext -bbox ${JSON.stringify(pdfPath)} -`).toString()
  unlinkSync(pdfPath)
  const pages: BboxWord[][] = []
  const blocks = bboxXml.split('<page').slice(1)
  const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]+)<\/word>/g
  for (const block of blocks) {
    const words: BboxWord[] = []
    let m: RegExpExecArray | null
    while ((m = wordRe.exec(block)) !== null) {
      words.push({ xMin: parseFloat(m[1]!), yMin: parseFloat(m[2]!), text: m[3]! })
    }
    pages.push(words)
  }
  return pages
}

/** Runs plain pdftotext and returns the text of each page (\f separated). */
function pdftotextPlainPages(pdf: Uint8Array): string[] {
  const pdfPath = join(tmpdir(), `tsreport-precision-mp-${process.pid}.pdf`)
  writeFileSync(pdfPath, pdf)
  const plain = execSync(`pdftotext ${JSON.stringify(pdfPath)} -`).toString()
  unlinkSync(pdfPath)
  // The output ends with a trailing \f, so drop the final empty segment
  const pages = plain.split('\f')
  pages.pop()
  return pages
}

describe('WYSIWYG精度(複数ページ): レンダーツリー座標とPDF出力の一致', () => {
  // A4 (595x842pt), margins top 20 / bottom 20 / left 30 / right 20,
  // detail 40pt + pageFooter 30pt → usable 842-20-20-30 = 772pt → 19 rows/page.
  // 45 rows → 3 pages (19 + 19 + 7).
  const template: ReportTemplate = {
    page: { size: 'A4', margins: { top: 20, bottom: 20, left: 30, right: 20 } },
    styles: [{ name: 's', fontFamily: 'NotoSansJP', fontSize: 12 }],
    fields: [{ name: 'idx', type: 'number' }],
    bands: {
      details: [{
        height: 40,
        elements: [
          { type: 'textField', x: 10, y: 5, width: 200, height: 20, style: 's', expression: '`Row${field.idx}`', padding: { top: 0, bottom: 0, left: 0, right: 0 } },
          { type: 'line', x: 0, y: 30, width: 300, height: 0, lineWidth: 1, lineColor: '#000000' },
          { type: 'rectangle', x: 250, y: 5, width: 80, height: 20, fill: '#DDEEFF' },
        ],
      }],
      pageFooter: {
        height: 30,
        elements: [
          { type: 'textField', x: 0, y: 5, width: 150, height: 20, style: 's', expression: '`PageNo:${PAGE_NUMBER}`', evaluationTime: 'now', padding: { top: 0, bottom: 0, left: 0, right: 0 } },
          { type: 'textField', x: 200, y: 5, width: 150, height: 20, style: 's', expression: '`Total:${TOTAL_PAGES}`', evaluationTime: 'report', padding: { top: 0, bottom: 0, left: 0, right: 0 } },
        ],
      },
    },
  }
  const rows: Array<{ idx: number }> = []
  for (let i = 1; i <= 45; i++) rows.push({ idx: i })

  // Guards page-break placement: absolute text coordinates on pages 2 and 3
  // must match the PDF, verified per <page> block by an independent implementation.
  it('ページ2以降のテキスト絶対位置がレンダーツリー座標と一致する（pdftotext -bbox のページ別検証）', () => {
    if (!pdftotextAvailable()) return

    const doc = createReport(template, { rows }, { fontMap })
    expect(doc.pages.length).toBe(3)
    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const bboxPages = pdftotextBboxPages(pdf)
    expect(bboxPages.length).toBe(3)

    for (const pageIndex of [1, 2]) {
      const { texts } = collectAbs(doc, pageIndex)
      const words = bboxPages[pageIndex]!
      // Every render-tree text on the page appears in the PDF, one word each (no spaces in the fixtures)
      expect(words.length).toBe(texts.length)
      for (const t of texts) {
        const word = words.find(w => w.text === t.text.text)
        expect(word, `page${pageIndex + 1} "${t.text.text}" がPDFから抽出できる`).toBeDefined()
        // xMin is the glyph ink left edge; allow the side bearing (< 1pt)
        expect(Math.abs(word!.xMin - t.x), `page${pageIndex + 1} "${t.text.text}" のX座標: render=${t.x} pdf=${word!.xMin}`).toBeLessThan(1)
        // yMin is the glyph top edge; it must fall within fontSize of the layout Y (line top)
        expect(word!.yMin - t.y, `page${pageIndex + 1} "${t.text.text}" のY座標: render=${t.y} pdf=${word!.yMin}`).toBeGreaterThanOrEqual(0)
        expect(word!.yMin - t.y, `page${pageIndex + 1} "${t.text.text}" のY座標: render=${t.y} pdf=${word!.yMin}`).toBeLessThan(t.text.fontSize)
      }
    }
  })

  // Guards the page-count contract: RenderDocument.pages maps 1:1 to physical
  // PDF pages (/Type /Page objects and per-page content streams).
  it('PDFの実ページ数がレンダーツリーのページ数と一致する', () => {
    const doc = createReport(template, { rows }, { fontMap })
    expect(doc.pages.length).toBe(3)
    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const content = pdfToText(pdf)
    // \b rejects "/Type /Pages" (the page tree root)
    expect((content.match(/\/Type \/Page\b/g) ?? []).length).toBe(doc.pages.length)
    // One content stream (one Y-flip cm) per page
    expect(splitPageStreams(content).length).toBe(doc.pages.length)
  })

  // Guards PAGE_NUMBER (evaluationTime=now) / TOTAL_PAGES (evaluationTime=report)
  // state end to end: each physical PDF page prints its own number and the shared total.
  it('各ページにページ番号(PAGE_NUMBER)と総ページ数(TOTAL_PAGES)が印字される', () => {
    if (!pdftotextAvailable()) return

    const doc = createReport(template, { rows }, { fontMap })
    expect(doc.pages.length).toBe(3)
    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const pages = pdftotextPlainPages(pdf)
    expect(pages.length).toBe(3)
    for (let i = 0; i < pages.length; i++) {
      expect(pages[i]!, `page${i + 1} にそのページの番号が印字される`).toContain(`PageNo:${i + 1}`)
      expect(pages[i]!, `page${i + 1} に総ページ数が印字される`).toContain('Total:3')
    }
  })

  // Guards margin propagation across page breaks: page.margins offsets element
  // absolute coordinates identically on every page, down to the PDF operators.
  it('ページ2以降でも page.margins が絶対座標に正しく反映される', () => {
    const doc = createReport(template, { rows }, { fontMap })
    expect(doc.pages.length).toBe(3)

    // Render tree: the first detail row starts at (left margin + element x, top margin + element y) on every page
    for (const pageIndex of [0, 1, 2]) {
      const { texts, rects } = collectAbs(doc, pageIndex)
      const firstText = texts[0]!
      expect(firstText.x, `page${pageIndex + 1} 先頭行のX = left(30) + 10`).toBe(40)
      expect(firstText.y, `page${pageIndex + 1} 先頭行のY = top(20) + 5`).toBe(25)
      const firstRect = rects[0]!
      expect(firstRect.x, `page${pageIndex + 1} 先頭矩形のX = left(30) + 250`).toBe(280)
      expect(firstRect.y, `page${pageIndex + 1} 先頭矩形のY = top(20) + 5`).toBe(25)
    }

    // PDF operators: the first-row rect re operator resolves to the same absolute
    // coordinates on pages 2 and 3 (0.01pt, group cm transforms accounted for)
    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const segments = splitPageStreams(pdfToText(pdf))
    for (const pageIndex of [1, 2]) {
      const { rects } = parsePageOps(segments[pageIndex]!)
      const match = rects.find(r =>
        Math.abs(r.x - 280) < 0.01 && Math.abs(r.y - 25) < 0.01
        && Math.abs(r.w - 80) < 0.01 && Math.abs(r.h - 20) < 0.01)
      expect(match, `page${pageIndex + 1} の先頭矩形 (280, 25, 80, 20) がPDFに存在する`).toBeDefined()
    }
  })

  // Guards pageFooter placement: the footer band sits at
  // pageHeight - bottom margin - footer height (842 - 20 - 30 = 792) on every page.
  it('pageFooterが全ページで「ページ高さ−下マージン−フッター高さ」起点に配置される', () => {
    const doc = createReport(template, { rows }, { fontMap })
    expect(doc.pages.length).toBe(3)

    // Render tree: footer elements at band origin y=792 + element y=5 on every page
    for (const pageIndex of [0, 1, 2]) {
      const { texts } = collectAbs(doc, pageIndex)
      const pageNo = texts.find(t => t.text.text === `PageNo:${pageIndex + 1}`)
      expect(pageNo, `page${pageIndex + 1} のフッター要素が存在する`).toBeDefined()
      expect(pageNo!.x, `page${pageIndex + 1} フッターX = left(30) + 0`).toBe(30)
      expect(pageNo!.y, `page${pageIndex + 1} フッターY = 842 - 20 - 30 + 5`).toBe(797)
    }

    // PDF side: the representative footer word lands at the same position on every page
    if (!pdftotextAvailable()) return
    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const bboxPages = pdftotextBboxPages(pdf)
    expect(bboxPages.length).toBe(3)
    for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
      const word = bboxPages[pageIndex]!.find(w => w.text === `PageNo:${pageIndex + 1}`)
      expect(word, `page${pageIndex + 1} のフッターがPDFから抽出できる`).toBeDefined()
      expect(Math.abs(word!.xMin - 30), `page${pageIndex + 1} フッターのX座標: pdf=${word!.xMin}`).toBeLessThan(1)
      expect(word!.yMin - 797, `page${pageIndex + 1} フッターのY座標: pdf=${word!.yMin}`).toBeGreaterThanOrEqual(0)
      expect(word!.yMin - 797, `page${pageIndex + 1} フッターのY座標: pdf=${word!.yMin}`).toBeLessThan(12)
    }
  })

  // Guards paper-size fidelity: landscape swaps A4 dimensions and custom
  // width/height flow into /MediaBox unchanged.
  it('landscape とカスタム用紙サイズが /MediaBox に正確に出力される', () => {
    const landscape: ReportTemplate = {
      page: { size: 'A4', orientation: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{ name: 's', fontFamily: 'NotoSansJP', fontSize: 12 }],
      bands: { title: { height: 100, elements: [{ type: 'staticText', x: 10, y: 10, width: 100, height: 20, style: 's', text: 'L' }] } },
    }
    const docL = createReport(landscape, { rows: [{}] }, { fontMap })
    expect(docL.pages[0]!.width).toBe(842)
    expect(docL.pages[0]!.height).toBe(595)
    const contentL = pdfToText(renderToPdf(docL, { fonts: { NotoSansJP: font } }))
    expect(contentL).toContain('/MediaBox [0 0 842 595]')

    const custom: ReportTemplate = {
      page: { width: 400, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{ name: 's', fontFamily: 'NotoSansJP', fontSize: 12 }],
      bands: { title: { height: 100, elements: [{ type: 'staticText', x: 10, y: 10, width: 100, height: 20, style: 's', text: 'C' }] } },
    }
    const docC = createReport(custom, { rows: [{}] }, { fontMap })
    expect(docC.pages[0]!.width).toBe(400)
    expect(docC.pages[0]!.height).toBe(300)
    const contentC = pdfToText(renderToPdf(docC, { fonts: { NotoSansJP: font } }))
    expect(contentC).toContain('/MediaBox [0 0 400 300]')
  })

  // Guards line path precision on later pages: m/l operators inside band group
  // cm transforms must resolve to the render tree's absolute coordinates (0.01pt).
  it('複数ページ目の line の m/l パス座標がレンダーツリー絶対座標と一致する（cm変換考慮）', () => {
    const doc = createReport(template, { rows }, { fontMap })
    expect(doc.pages.length).toBe(3)
    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const segments = splitPageStreams(pdfToText(pdf))

    for (const pageIndex of [1, 2]) {
      const { lines } = collectAbs(doc, pageIndex)
      const pdfLines = parsePageOps(segments[pageIndex]!).lines
      // Every detail row carries exactly one line element and no other stroke paths exist
      expect(lines.length).toBe(pageIndex === 2 ? 7 : 19)
      expect(pdfLines.length).toBe(lines.length)
      for (const l of lines) {
        const match = pdfLines.find(p =>
          Math.abs(p.x1 - l.x1) < 0.01 && Math.abs(p.y1 - l.y1) < 0.01
          && Math.abs(p.x2 - l.x2) < 0.01 && Math.abs(p.y2 - l.y2) < 0.01)
        expect(match, `page${pageIndex + 1} line (${l.x1}, ${l.y1}) -> (${l.x2}, ${l.y2}) がPDFに存在する`).toBeDefined()
      }
    }
  })
})
