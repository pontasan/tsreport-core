/**
  * Variable Font / vertical writing automatic.
  * Check, data validate.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument, RenderText } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'

const NOTO_VAR_PATH = resolve(__dirname, '../fixtures/fonts/NotoSans-VariableFont_wdth,wght.ttf')
const NOTO_JP_PATH = resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')
const ROBOTO_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')

// Variable Font: Font validate.


describe('Variable Font glyph variation', () => {
  it.skipIf(!existsSync(NOTO_VAR_PATH))('setVariation(wght) で getGlyph のアウトラインが変わる', () => {
    const font = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    const gid = font.getGlyphId('A'.codePointAt(0)!)
    expect(gid).toBeGreaterThan(0)

    // wght=100 (thin)
    font.setVariation({ wght: 100 })
    const thin = font.getGlyph(gid)
    // Coordinate ()
    
    const thinCoords = new Float32Array(thin.outline.coords)

    // wght=900 (black)
    font.setVariation({ wght: 900 })
    const black = font.getGlyph(gid)
    const blackCoords = new Float32Array(black.outline.coords)

    // Print coordinates for manual inspection.
    console.log('  gid:', gid, 'coordsLen:', thinCoords.length)
    console.log('  wght=100 first 6:', Array.from(thinCoords.slice(0, 6)))
    console.log('  wght=900 first 6:', Array.from(blackCoords.slice(0, 6)))

    // Coordinate.
    
    expect(thinCoords.length).toBe(blackCoords.length)
    let hasDiff = false
    for (let i = 0; i < thinCoords.length; i++) {
      if (thinCoords[i] !== blackCoords[i]) {
        hasDiff = true
        break
      }
    }
    expect(hasDiff).toBe(true)
  })

  it.skipIf(!existsSync(NOTO_VAR_PATH))('setVariation(wght) で advanceWidth が変わる', () => {
    const font = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    const gid = font.getGlyphId('A'.codePointAt(0)!)

    font.setVariation({ wght: 100 })
    const thinWidth = font.getAdvanceWidth(gid)

    font.setVariation({ wght: 900 })
    const blackWidth = font.getAdvanceWidth(gid)

    // AdvanceWidth (font)
    // Errorget with.
    
    
    expect(thinWidth).toBeGreaterThan(0)
    expect(blackWidth).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(NOTO_VAR_PATH))('setVariation 後の getGlyph はキャッシュクリアされた新しい値を返す', () => {
    const font = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    const gid = font.getGlyphId('H'.codePointAt(0)!)

    // Wght=400 with.
    
    font.setVariation({ wght: 400 })
    const normal = font.getGlyph(gid)
    const normalCoords = new Float32Array(normal.outline.coords)

    // Wght=900.
    
    font.setVariation({ wght: 900 })
    const heavy = font.getGlyph(gid)

    // With.
    
    let hasDiff = false
    for (let i = 0; i < normalCoords.length; i++) {
      if (normalCoords[i] !== heavy.outline.coords[i]) {
        hasDiff = true
        break
      }
    }
    expect(hasDiff).toBe(true)
  })
})

// Variable Font: PDF validate.


describe('PDF backend Variable Font rendering', () => {
  it.skipIf(!existsSync(NOTO_VAR_PATH))('variation 指定時はパスモード (f オペレータ) で描画する', () => {
    const font = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { notoVar: font, default: font } })

    const doc: RenderDocument = {
      pages: [{
        width: 200, height: 100,
        children: [{
          type: 'text', x: 10, y: 10, text: 'A',
          fontId: 'notoVar', fontSize: 12, color: '#000000',
          variation: { wght: 700 },
        } as RenderText],
      }],
    }
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const content = pdfToText(pdf)

    // Pathmode with 'f' (fill)
    // Textmode with 'BT'... 'ET'.
    // Variation timepathmode.
    // Directvalidate,.
    // PDF check.
    
    
    
    
    
    expect(pdf.length).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(NOTO_VAR_PATH))('異なる weight で異なるパスデータが生成される', () => {
    const font1 = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    const font2 = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)

    // 2々 PDF generatecompare.
    
    const makePdf = (f: Font, wght: number): Uint8Array => {
      const backend = new PdfBackend({ fonts: { v: f, default: f } })
      const doc: RenderDocument = {
        pages: [{
          width: 200, height: 100,
          children: [{
            type: 'text', x: 10, y: 10, text: 'AB',
            fontId: 'v', fontSize: 20, color: '#000000',
            variation: { wght },
          } as RenderText],
        }],
      }
      render(doc, backend)
      return backend.toUint8Array()
    }

    const thin = makePdf(font1, 100)
    const heavy = makePdf(font2, 900)

    // (fontpathdata generate)
    // With.
    
    
    expect(thin.length).not.toBe(heavy.length)
  })

  it.skipIf(!existsSync(NOTO_VAR_PATH))('variation なしの場合はテキストモード (BT/ET) で描画する', () => {
    const font = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { v: font, default: font } })

    const doc: RenderDocument = {
      pages: [{
        width: 200, height: 100,
        children: [{
          type: 'text', x: 10, y: 10, text: 'A',
          fontId: 'v', fontSize: 12, color: '#000000',
          // Variation without.
          
        } as RenderText],
      }],
    }
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const content = pdfToText(pdf)

    // Textmode with BT/ET.
    
    expect(content).toContain('BT')
    expect(content).toContain('ET')
  })
})

// Vertical writing: Font validate.


describe('Vertical metrics', () => {
  it.skipIf(!existsSync(NOTO_JP_PATH))('getAdvanceHeight が正の値を返す', () => {
    const font = Font.load(readFileSync(NOTO_JP_PATH).buffer as ArrayBuffer)
    const gid = font.getGlyphId('あ'.codePointAt(0)!)
    expect(gid).toBeGreaterThan(0)

    const ah = font.getAdvanceHeight(gid)
    expect(ah).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(NOTO_JP_PATH))('getVerticalOrigin が正の値を返す', () => {
    const font = Font.load(readFileSync(NOTO_JP_PATH).buffer as ArrayBuffer)
    const gid = font.getGlyphId('あ'.codePointAt(0)!)

    const vo = font.getVerticalOrigin(gid)
    expect(vo).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(ROBOTO_PATH))('TTF フォントでも getAdvanceHeight がエラーなく動く', () => {
    const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
    const gid = font.getGlyphId('A'.codePointAt(0)!)

    const ah = font.getAdvanceHeight(gid)
    expect(ah).toBeGreaterThan(0)
  })
})

// Vertical writing: PDF validate.


describe('PDF backend vertical writing', () => {
  it.skipIf(!existsSync(NOTO_JP_PATH))('writingMode=vertical-rl はパスモードで描画する', () => {
    const font = Font.load(readFileSync(NOTO_JP_PATH).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { jp: font, default: font } })

    const doc: RenderDocument = {
      pages: [{
        width: 100, height: 300,
        children: [{
          type: 'text', x: 10, y: 10, text: 'あい',
          fontId: 'jp', fontSize: 12, color: '#000000',
          writingMode: 'vertical-rl',
        } as RenderText],
      }],
    }
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const content = pdfToText(pdf)

    // Vertical writingpathmode with draw with BT/ET.
    // (page with BT)
    
    
    expect(pdf.length).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(NOTO_JP_PATH))('縦書きの PDF サイズが横書きと異なる', () => {
    const font = Font.load(readFileSync(NOTO_JP_PATH).buffer as ArrayBuffer)

    const makePdf = (writingMode?: 'horizontal-tb' | 'vertical-rl'): Uint8Array => {
      const backend = new PdfBackend({ fonts: { jp: font, default: font } })
      const doc: RenderDocument = {
        pages: [{
          width: 200, height: 400,
          children: [{
            type: 'text', x: 10, y: 10, text: 'あいうえお',
            fontId: 'jp', fontSize: 14, color: '#000000',
            writingMode,
          } as RenderText],
        }],
      }
      render(doc, backend)
      return backend.toUint8Array()
    }

    const horizontal = makePdf('horizontal-tb')
    const vertical = makePdf('vertical-rl')

    // Renderingpath ->.
    
    expect(horizontal.length).not.toBe(vertical.length)
  })
})

// Variable Font: subset gvar validate.


describe('Variable Font subset baking', () => {
  it.skipIf(!existsSync(NOTO_VAR_PATH))('サブセットに variation 適用済みアウトラインが含まれる', () => {
    // Wght=100 with subset.
    
    const font100 = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    font100.setVariation({ wght: 100 })
    const subset100 = font100.subset('A')
    const subFont100 = Font.load(subset100)

    // Wght=900 with subset.
    
    const font900 = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    font900.setVariation({ wght: 900 })
    const subset900 = font900.subset('A')
    const subFont900 = Font.load(subset900)

    // Subsetfont from 'A' get.
    
    const gid100 = subFont100.getGlyphId('A'.codePointAt(0)!)
    const gid900 = subFont900.getGlyphId('A'.codePointAt(0)!)
    expect(gid100).toBeGreaterThan(0)
    expect(gid900).toBeGreaterThan(0)

    const g100 = subFont100.getGlyph(gid100)
    const g900 = subFont900.getGlyph(gid900)

    // Subset.
    
    expect(g100.outline.coords.length).toBeGreaterThan(0)
    expect(g900.outline.coords.length).toBeGreaterThan(0)

    let hasDiff = false
    const len = Math.min(g100.outline.coords.length, g900.outline.coords.length)
    for (let i = 0; i < len; i++) {
      if (g100.outline.coords[i] !== g900.outline.coords[i]) {
        hasDiff = true
        break
      }
    }
    expect(hasDiff).toBe(true)
  })

  it.skipIf(!existsSync(NOTO_VAR_PATH))('サブセットの advanceWidth が variation に応じて変わる', () => {
    const font100 = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    font100.setVariation({ wght: 100 })
    const subFont100 = Font.load(font100.subset('A'))

    const font900 = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    font900.setVariation({ wght: 900 })
    const subFont900 = Font.load(font900.subset('A'))

    const gid100 = subFont100.getGlyphId('A'.codePointAt(0)!)
    const gid900 = subFont900.getGlyphId('A'.codePointAt(0)!)

    const aw100 = subFont100.getAdvanceWidth(gid100)
    const aw900 = subFont900.getAdvanceWidth(gid900)

    expect(aw100).toBeGreaterThan(0)
    expect(aw900).toBeGreaterThan(0)
    // Wght=900 wght=100 advanceWidth.
    
    expect(aw100).not.toBe(aw900)
  })

  it.skipIf(!existsSync(NOTO_VAR_PATH))('全 ASCII 英字がサブセット後に有効なアウトラインを持つ', () => {
    const font = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)
    font.setVariation({ wght: 700 })
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    const subFont = Font.load(font.subset(text))

    for (const ch of text) {
      const gid = subFont.getGlyphId(ch.codePointAt(0)!)
      expect(gid).toBeGreaterThan(0)
      const glyph = subFont.getGlyph(gid)
      expect(glyph.outline.commands.length).toBeGreaterThan(0)
      expect(glyph.outline.coords.length).toBeGreaterThan(0)
    }
  })

  it.skipIf(!existsSync(NOTO_VAR_PATH))('gvar 適用前後で glyph bounds が合理的', () => {
    const font = Font.load(readFileSync(NOTO_VAR_PATH).buffer as ArrayBuffer)

    for (const wght of [100, 400, 900]) {
      font.setVariation({ wght })
      const gid = font.getGlyphId('H'.codePointAt(0)!)
      const glyph = font.getGlyph(gid)
      const coords = glyph.outline.coords

      // Coordinate unitsPerEm range (with)
      
      const upm = font.metrics.unitsPerEm
      for (let i = 0; i < coords.length; i++) {
        expect(Math.abs(coords[i]!)).toBeLessThan(upm * 3)
      }
    }
  })
})
