import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render, renderPage } from '../../src/renderer/renderer.js'
import type { RenderDocument, RenderPage } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

let font: Font

beforeAll(() => {
  const buf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  font = Font.load(buf.buffer as ArrayBuffer)
})

function streamsContaining(pdfText: string, marker: string): string {
  const parts: string[] = []
  const re = /stream\n([\s\S]*?)\nendstream/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pdfText)) !== null) {
    if (m[1]!.includes(marker)) parts.push(m[1]!)
  }
  return parts.join('\n')
}

describe('PdfBackend', () => {
  function createBackend(): PdfBackend {
    return new PdfBackend({ fonts: { default: font } })
  }

  describe('基本構造', () => {
    it('空ドキュメントで有効な PDF ヘッダを生成', () => {
      const backend = createBackend()
      const doc: RenderDocument = { pages: [] }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('%PDF-1.7')
      expect(text).toContain('%%EOF')
      expect(text).toContain('/Type /Catalog')
      expect(text).toContain('/Type /Pages')
    })

    it('1ページの PDF を生成', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{ width: 595, height: 842, children: [] }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('/Type /Page')
      expect(text).toContain('/MediaBox [0 0 595 842]')
      expect(text).toContain('/Count 1')
    })

    it('PDF 識別子とフォントサブセット名に Math.random を使わない', () => {
      const originalRandom = Math.random
      Math.random = function (): number {
        throw new Error('Math.random must not be used for PDF identifiers')
      }
      try {
        const backend = createBackend()
        render({
          pages: [{
            width: 200,
            height: 100,
            children: [{
              type: 'text',
              x: 10,
              y: 10,
              text: 'secure',
              fontId: 'default',
              fontSize: 12,
              color: '#000000',
            }],
          }],
        }, backend)
        expect(backend.toUint8Array().length).toBeGreaterThan(0)
      } finally {
        Math.random = originalRandom
      }
    })

    it('複数ページの PDF を生成', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [
          { width: 595, height: 842, children: [] },
          { width: 595, height: 842, children: [] },
          { width: 612, height: 792, children: [] },
        ],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('/Count 3')
      // Page.
      
      expect(text).toContain('/MediaBox [0 0 595 842]')
      expect(text).toContain('/MediaBox [0 0 612 792]')
    })

    it('caches parsed colors and suppresses redundant graphics-state operators without crossing q/Q', () => {
      const backend = createBackend()
      backend.beginDocument()
      backend.beginPage(100, 100)
      backend.drawRect(0, 0, 10, 10, { fill: '#FF0000' })
      backend.drawRect(10, 0, 10, 10, { fill: '#FF0000' })
      backend.drawLine(0, 20, 10, 20, 2, '#000000')
      backend.drawLine(10, 20, 20, 20, 2, '#000000')
      backend.save()
      backend.drawRect(0, 30, 10, 10, { fill: '#0000FF' })
      backend.restore()
      backend.drawRect(20, 0, 10, 10, { fill: '#FF0000' })

      const internals = backend as unknown as { currentOps: unknown[], parsedColorCache: Map<string, unknown> }
      const ops = internals.currentOps.filter((op): op is string => typeof op === 'string')
      expect(ops.filter(op => op === '1 0 0 rg')).toHaveLength(1)
      expect(ops.filter(op => op === '2 w')).toHaveLength(1)
      expect(internals.parsedColorCache.size).toBe(3)
    })

    it('serializes Float32 path coordinates without binary-tail digits', () => {
      const backend = createBackend()
      backend.beginDocument()
      backend.beginPage(2000, 100)
      backend.drawPath(
        new Uint8Array([0, 1]),
        new Float32Array([1200.016, 0, 1200.1234, 10.25]),
        { stroke: '#000000' },
      )

      const internals = backend as unknown as { currentOps: unknown[] }
      const pathOps = internals.currentOps.filter((op): op is string => typeof op === 'string').join('\n')
      expect(pathOps).toContain('1200.015991 0 m')
      expect(pathOps).toContain('1200.123413 10.25 l')
      expect(pathOps).not.toContain('1200.015991210938')
    })

    it('keeps repeated PDF-source vectors as one shared Form XObject', () => {
      const definition = {
        commands: new Uint8Array([0, 1, 2, 1, 3]),
        coords: new Float32Array([0, 0, 12, 0, 16, 0, 16, 8, 12, 12, 0, 12]),
      }
      const instances = Array.from({ length: 120 }, function (_, index) {
        return {
          definitionIndex: 0,
          matrix: [1, 0, 0, 1, 5 + index % 20 * 20, 5 + Math.floor(index / 20) * 20] as [number, number, number, number, number, number],
        }
      })
      const sharedBackend = createBackend()
      render({
        pages: [{
          width: 410,
          height: 130,
          children: [{
            type: 'path',
            commands: new Uint8Array(),
            coords: new Float32Array(),
            pdfSourceVector: { definitions: [definition], instances },
            fill: '#000000',
          }],
        }],
      }, sharedBackend)
      const sharedBytes = sharedBackend.toUint8Array()
      const sharedText = pdfToText(sharedBytes)
      expect(sharedText.match(/\/Sv0 Do/g)).toHaveLength(120)
      expect(sharedText.match(/\/Sv0 \d+ 0 R/g)).toHaveLength(1)

      const commands: number[] = []
      const coords: number[] = []
      for (let i = 0; i < instances.length; i++) {
        const matrix = instances[i]!.matrix
        for (let c = 0; c < definition.commands.length; c++) commands.push(definition.commands[c]!)
        for (let c = 0; c < definition.coords.length; c += 2) {
          coords.push(definition.coords[c]! + matrix[4], definition.coords[c + 1]! + matrix[5])
        }
      }
      const materializedBackend = createBackend()
      render({
        pages: [{
          width: 410,
          height: 130,
          children: [{
            type: 'path',
            commands: new Uint8Array(commands),
            coords: new Float32Array(coords),
            fill: '#000000',
          }],
        }],
      }, materializedBackend)
      expect(sharedBytes.length).toBeLessThan(materializedBackend.toUint8Array().length)
    })
  })

  describe('テキスト描画', () => {
    it('テキストノードで CIDFont が埋め込まれる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'text', x: 72, y: 72,
              text: 'Hello', fontId: 'default', fontSize: 12, color: '#000000',
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      // CIDFont structure.
      
      expect(text).toContain('/Subtype /Type0')
      expect(text).toContain('/Encoding /Identity-H')
      expect(text).toContain('/Subtype /CIDFontType2')
      expect(text).toContain('/CIDSystemInfo')
      // FontDescriptor
      expect(text).toContain('/Type /FontDescriptor')
      // ToUnicode
      expect(text).toContain('beginbfchar')
      expect(text).toContain('endbfchar')
      // Text.
      
      expect(text).toContain('BT')
      expect(text).toContain('Tj')
      expect(text).toContain('ET')
    })

    it('horizontalScale を PDF text matrix に反映する', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 200,
          height: 100,
          children: [{
            type: 'text',
            x: 10,
            y: 20,
            text: 'Scaled',
            fontId: 'default',
            fontSize: 12,
            color: '#000000',
            horizontalScale: 0.5,
          }],
        }],
      }
      render(doc, backend)
      const text = pdfToText(backend.toUint8Array())
      expect(text).toContain('0.5 0 0 -1')
    })

    it('グリフ ID が hex でエンコードされる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'text', x: 0, y: 0,
              text: 'A', fontId: 'default', fontSize: 10, color: '#000000',
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      // SubsetafterGID with hex check.
      // Subset GID, original GID with GID validate.
      // 'A' 1character ->.notdef(0) + 'A' GID -> GID 0 1.
      
      
      
      expect(text).toContain(`<0001>`)
    })

    it('フォント幅情報 /W が含まれる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'text', x: 0, y: 0,
              text: 'Test', fontId: 'default', fontSize: 10, color: '#000000',
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('/W [')
      expect(text).toContain('/DW ')
    })

    it('outlineText 指定時はフォント資源を持たない純粋なベクタパスを出力する', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'text', x: 72, y: 72,
              text: 'Hello', fontId: 'default', fontSize: 12, color: '#000000',
              outlineText: true,
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)
      const content = streamsContaining(text, '0.01 i')

      // Visible glyphs are drawn as vector paths (moveto + fill), not painted as
      // visible text.
      expect(content).toMatch(/\sm\n/)
      expect(content).toMatch(/\nf\n/)
      expect(content).not.toContain(' Tj')
      expect(text).not.toContain('/Type /FontDescriptor')
      expect(text).not.toContain('/FontFile2')
      expect(text).not.toContain('/FontFile3')
    })

    it('reference font mode emits metrics and text without embedding a font program', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [{
            type: 'text', x: 72, y: 72,
            text: 'Hello', fontId: 'default', fontSize: 12, color: '#000000',
            pdfFontMode: 'reference',
          }],
        }],
      }
      render(doc, backend)
      const text = pdfToText(backend.toUint8Array())

      expect(text).toContain('/Type /FontDescriptor')
      expect(text).toContain('/BaseFont /Roboto-Regular')
      expect(text).toContain('/FontFamily (Roboto)')
      expect(text).toContain('/FontStretch /Normal')
      expect(text).toContain('/FontWeight 400')
      expect(text).toContain('/Encoding /Identity-H')
      expect(text).toContain('/W [')
      expect(text).toContain(' Tj')
      expect(text).not.toContain('/FontFile2')
      expect(text).not.toContain('/FontFile3')
    })

    it('同一フォントを要素単位で埋込みとシステム参照に分離する', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'text', x: 72, y: 72,
              text: 'Embedded', fontId: 'default', fontSize: 12, color: '#000000',
            },
            {
              type: 'text', x: 72, y: 96,
              text: 'Reference', fontId: 'default', fontSize: 12, color: '#000000',
              pdfFontMode: 'reference',
            },
          ],
        }],
      }
      render(doc, backend)
      const text = pdfToText(backend.toUint8Array())

      expect(text.match(/\/Type \/FontDescriptor/g)).toHaveLength(2)
      expect(text.match(/\/FontFile2/g)).toHaveLength(1)
      expect(text).toContain('/BaseFont /Roboto-Regular')
      expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Roboto-Regular/)
    })

    it('PDF/Aでは要素単位のシステムフォント参照を拒否する', () => {
      const backend = new PdfBackend({
        fonts: { default: font },
        pdfaConformance: 'PDF/A-2b',
      })
      render({
        pages: [{
          width: 595, height: 842,
          children: [{
            type: 'text', x: 72, y: 72,
            text: 'Reference', fontId: 'default', fontSize: 12, color: '#000000',
            pdfFontMode: 'reference',
          }],
        }],
      }, backend)

      expect(() => backend.toUint8Array()).toThrow(/requires embedded font programs/)
    })
  })

  describe('図形描画', () => {
    it('矩形がコンテンツストリームに含まれる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'rect', x: 10, y: 20, width: 100, height: 50,
              fill: '#FF0000',
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      // Colorset (= 1 0 0 rg)
      
      expect(text).toContain('1 0 0 rg')
      // Path.
      
      expect(text).toContain('10 20 100 50 re')
      // fill
      expect(text).toContain('\nf\n')
    })

    it('線がコンテンツストリームに含まれる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'line', x1: 0, y1: 100, x2: 595, y2: 100,
              lineWidth: 2, color: '#000000',
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('0 G')   // black stroke (DeviceGray)
      expect(text).toContain('2 w')         // line width
      expect(text).toContain('0 100 m 595 100 l S')
    })

    it('破線パターンが含まれる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'line', x1: 0, y1: 0, x2: 100, y2: 0,
              lineWidth: 1, color: '#000000', dash: [4, 2],
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('[4 2] 0 d')
      expect(text).toContain('[] 0 d')     
    })

    it('楕円がベジエ曲線で描画される', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'ellipse', cx: 100, cy: 100, rx: 50, ry: 30,
              fill: '#00FF00', stroke: '#000000', strokeWidth: 1,
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      // C with draw.
      
      expect(text).toMatch(/\d+ \d+ m/)  // moveto
      expect(text).toContain(' c')       // curveto
      expect(text).toContain('h')        // close
      expect(text).toContain('B')        // fill and stroke
    })
  })

  describe('グラフィクスステート', () => {
    it('Y 軸反転 CTM がコンテンツストリームに含まれる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('1 0 0 -1 0 842 cm')
      expect(text).toContain('0.01 i')
    })

    it('グループの translate が含まれる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'group', x: 72, y: 72, width: 451, height: 698,
              children: [],
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('q')    // save
      expect(text).toContain('1 0 0 1 72 72 cm')  // translate
      expect(text).toContain('Q')    // restore
    })

    it('クリッピングが含まれる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'group', x: 10, y: 20, width: 100, height: 50,
              clip: true,
              children: [],
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('0 0 100 50 re W n')
    })

    it('opacity で ExtGState が使われる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'group', x: 0, y: 0, width: 595, height: 842,
              opacity: 0.5,
              children: [],
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      // ExtGState.
      
      expect(text).toContain('/Type /ExtGState')
      expect(text).toContain('/ca 0.5')
      expect(text).toContain('/CA 0.5')
      // With.
      
      expect(text).toContain('/GS0 gs')
      // ExtGState.
      
      expect(text).toContain('/ExtGState')
    })

    it('overprint で ExtGState に OP/op/OPM が出力される', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 100,
          height: 100,
          children: [{
            type: 'path',
            commands: new Uint8Array([0, 1, 1, 1, 3]),
            coords: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
            fill: '#ff0000',
            stroke: '#000000',
            overprintFill: true,
            overprintStroke: true,
            overprintMode: 1,
          }],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('/Type /ExtGState')
      expect(text).toContain('/OP true')
      expect(text).toContain('/op true')
      expect(text).toContain('/OPM 1')
      expect(text).toContain('/GS0 gs')
    })
  })

  describe('xref stream', () => {
    it('xref ストリームが含まれる', () => {
      const backend = createBackend()
      render({ pages: [] }, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('/Type /XRef')
      expect(text).toContain('startxref')
      expect(text).toContain('/Size ')
      expect(text).toContain('/Root ')
      expect(text).toContain('/W [')
    })
  })

  describe('色パース', () => {
    it('#RRGGBB 形式の色が正しく変換される', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'rect', x: 0, y: 0, width: 100, height: 100,
              fill: '#FF8000',  // 1, 0.502, 0
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      // FF/255 = 1, 80/255 ≈ 0.502, 00/255 = 0
      expect(text).toMatch(/1 0\.50\d+ 0 rg/)
    })
  })

  describe('フォントサブセット', () => {
    it('異なる文字を含むページでサブセットプレフィクスが付与される', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'text', x: 0, y: 0,
              text: 'ABC', fontId: 'default', fontSize: 10, color: '#000000',
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      // Subset: 6charactercharacter + "+".
      
      expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+/)
      // FontFile2（TrueType）
      expect(text).toContain('/FontFile2')
    })
  })

  describe('角丸矩形', () => {
    it('radius 指定でベジエ曲線が使われる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'rect', x: 10, y: 20, width: 100, height: 50,
              fill: '#CCCCCC', radius: 5,
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      // Re with c () with draw.
      
      expect(text).not.toContain('10 20 100 50 re')
      expect(text).toContain(' c')
      expect(text).toContain('h')
    })

    it('四隅個別指定でもベジエ曲線が使われる', () => {
      const backend = createBackend()
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            {
              type: 'rect',
              x: 10,
              y: 20,
              width: 100,
              height: 50,
              fill: '#CCCCCC',
              cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
            },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).not.toContain('10 20 100 50 re')
      expect(text).toContain('14 20 m')
      expect(text).toContain(' c')
      expect(text).toContain('h')
    })
  })

  describe('パス描画', () => {
    it('パスコマンドが PDF パスオペレーターに変換される', () => {
      const backend = createBackend()
      const commands = new Uint8Array([0, 1, 2, 3])  // MoveTo, LineTo, CubicTo, Close
      const coords = new Float32Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
      const doc: RenderDocument = {
        pages: [{
          width: 595, height: 842,
          children: [
            { type: 'path', commands, coords, stroke: '#000000', strokeWidth: 1 },
          ],
        }],
      }
      render(doc, backend)
      const bytes = backend.toUint8Array()
      const text = pdfToText(bytes)

      expect(text).toContain('10 20 m')    // MoveTo
      expect(text).toContain('30 40 l')    // LineTo
      expect(text).toContain(' c')         // CubicTo
      expect(text).toContain('h')          // Close
      expect(text).toContain('S')          // Stroke
    })
  })
})
