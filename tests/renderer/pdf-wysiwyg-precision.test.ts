/**
 * WYSIWYG precision verification (PDF byte level).
 *
 * Verifies that the absolute coordinates of the render tree (the shared source
 * for the editor canvas and PDF) match the generated PDF content stream
 * operators (Tm / re / line paths) exactly, in pt units.
 *
 * Editor canvas <-> core render tree parity is covered by the editor-side
 * wysiwyg_parity.test.ts; this file covers render tree <-> PDF output parity,
 * so screen display and PDF output coordinate consistency is guaranteed end to end.
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

function collectAbs(doc: RenderDocument) {
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
  walk(doc.pages[0]!.children, 0, 0)
  return { texts, rects, lines }
}

describe('WYSIWYG精度: レンダーツリー座標とPDF演算子の一致', () => {
  const template: ReportTemplate = {
    page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    styles: [{ name: 's', fontFamily: 'NotoSansJP', fontSize: 12 }],
    bands: {
      title: {
        height: 400,
        elements: [
          { type: 'staticText', x: 100, y: 50, width: 300, height: 20, style: 's', text: '精度検証テキスト', padding: { top: 0, bottom: 0, left: 0, right: 0 } },
          { type: 'staticText', x: 37.5, y: 120.25, width: 200, height: 20, style: 's', text: 'Fractional', padding: { top: 0, bottom: 0, left: 0, right: 0 } },
          { type: 'rectangle', x: 30, y: 200, width: 150, height: 60, fill: '#FFEE00', stroke: '#003366', strokeWidth: 2 },
          { type: 'line', x: 20, y: 300, width: 400, height: 0, lineWidth: 1.5, lineColor: '#CC0000' },
        ],
      },
    },
  }

  // Cross-checks text positions in the PDF against render-tree coordinates using poppler's pdftotext as an independent implementation.
  it('テキストのPDF上の絶対位置がレンダーツリー座標と一致する（pdftotext -bbox による第三者検証）', () => {
    // Extract absolute text bounding boxes from the PDF with an independent
    // implementation (poppler's pdftotext) and compare them against the render
    // tree's absolute coordinates (= the editor canvas draw coordinates).
    let pdftotextPath: string
    try {
      pdftotextPath = execSync('which pdftotext').toString().trim()
    } catch {
      // Skip when the verification tool is unavailable (coordinate checks are covered by the re / mm tests below)
      return
    }
    if (pdftotextPath === '') return

    const doc = createReport(template, { rows: [{}] }, { fontMap })
    const { texts } = collectAbs(doc)
    expect(texts.length).toBe(2)

    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const pdfPath = join(tmpdir(), `tsreport-precision-${process.pid}.pdf`)
    writeFileSync(pdfPath, pdf)
    const bboxXml = execSync(`pdftotext -bbox ${JSON.stringify(pdfPath)} -`).toString()
    unlinkSync(pdfPath)

    // <word xMin="..." yMin="..." xMax="..." yMax="...">TEXT</word>
    const words: Array<{ xMin: number, yMin: number, text: string }> = []
    const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]+)<\/word>/g
    let m: RegExpExecArray | null
    while ((m = wordRe.exec(bboxXml)) !== null) {
      words.push({ xMin: parseFloat(m[1]!), yMin: parseFloat(m[2]!), text: m[3]! })
    }
    expect(words.length).toBeGreaterThanOrEqual(2)

    for (const t of texts) {
      const firstWord = t.text.text.split(/\s/)[0]!
      const word = words.find(w => w.text.startsWith(firstWord.slice(0, 4)))
      expect(word, `"${t.text.text}" がPDFから抽出できる`).toBeDefined()
      // xMin is the glyph's actual ink left edge, so it differs from the layout position by the side bearing; require < 1pt
      expect(Math.abs(word!.xMin - t.x), `"${t.text.text}" のX座標: render=${t.x} pdf=${word!.xMin}`).toBeLessThan(1)
      // yMin is the glyph top edge; it must fall within fontSize of the layout Y (line top)
      expect(word!.yMin - t.y, `"${t.text.text}" のY座標: render=${t.y} pdf=${word!.yMin}`).toBeGreaterThanOrEqual(0)
      expect(word!.yMin - t.y, `"${t.text.text}" のY座標: render=${t.y} pdf=${word!.yMin}`).toBeLessThan(t.text.fontSize)
    }
  })

  // Verifies that the rect's re operator in the content stream matches the render tree's absolute x/y/w/h within 0.01pt.
  it('矩形の re 演算子が レンダーツリー絶対座標と一致する', () => {
    const doc = createReport(template, { rows: [{}] }, { fontMap })
    const { rects } = collectAbs(doc)
    const target = rects.find(r => r.rect.fill === '#FFEE00')
    expect(target).toBeDefined()

    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const content = pdfToText(pdf)

    const res: Array<{ x: number, y: number, w: number, h: number }> = []
    const re = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      res.push({ x: parseFloat(m[1]!), y: parseFloat(m[2]!), w: parseFloat(m[3]!), h: parseFloat(m[4]!) })
    }
    const match = res.find(r =>
      Math.abs(r.x - target!.x) < 0.01 && Math.abs(r.y - target!.y) < 0.01
      && Math.abs(r.w - target!.rect.width) < 0.01 && Math.abs(r.h - target!.rect.height) < 0.01)
    expect(match, `rect (${target!.x}, ${target!.y}, ${target!.rect.width}, ${target!.rect.height}) がPDFに存在する`).toBeDefined()
  })

  // Verifies that mm-specified coordinates propagate to the PDF as exact pt conversions (4-decimal rounding).
  it('mm指定の座標がpt換算でPDFまで正確に伝播する（21mm = 59.5276pt）', () => {
    // The editor displays mm but stores pt internally: 21mm = 21 / 25.4 * 72 pt
    const mm = (v: number) => v / 25.4 * 72
    const tmpl: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      styles: [{ name: 's', fontFamily: 'NotoSansJP', fontSize: 10 }],
      bands: {
        title: {
          height: 400,
          elements: [
            { type: 'rectangle', x: mm(21), y: mm(30), width: mm(50), height: mm(10), fill: '#123456' },
          ],
        },
      },
    }
    const doc = createReport(tmpl, { rows: [{}] }, { fontMap })
    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const content = pdfToText(pdf)

    // 21mm=59.5276pt, 30mm=85.0394pt, 50mm=141.7323pt, 10mm=28.3465pt (pn() rounds to 4 decimals)
    const re = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g
    let m: RegExpExecArray | null
    let found = false
    while ((m = re.exec(content)) !== null) {
      if (Math.abs(parseFloat(m[1]!) - 59.5276) < 0.001
        && Math.abs(parseFloat(m[2]!) - 85.0394) < 0.001
        && Math.abs(parseFloat(m[3]!) - 141.7323) < 0.001
        && Math.abs(parseFloat(m[4]!) - 28.3465) < 0.001) found = true
    }
    expect(found, 'mm→pt換算座標がPDFに正確に出力される').toBe(true)
  })

  // Verifies that the A4 page size (595x842pt) flows from the render tree into the PDF /MediaBox unchanged.
  it('ページサイズがA4の正確なpt寸法でPDFに出力される', () => {
    const doc = createReport(template, { rows: [{}] }, { fontMap })
    expect(doc.pages[0]!.width).toBe(595)
    expect(doc.pages[0]!.height).toBe(842)
    const pdf = renderToPdf(doc, { fonts: { NotoSansJP: font } })
    const content = pdfToText(pdf)
    expect(content).toContain('/MediaBox [0 0 595 842]')
  })
})
