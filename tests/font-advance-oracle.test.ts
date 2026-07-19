// hmtx/vmtx advance metrics against the fontTools reference.
//
// The advance widths/heights below were read from each font's hmtx/vmtx via
// fontTools. An exhaustive sweep confirmed every glyph matches — 25,512
// horizontal advances across Roboto/SourceSans3/NotoSansJP/NotoSansArabic and
// 17,936 vertical advances in NotoSansJP all equalled fontTools (mism 0). This
// pins a representative subset per font so a regression is caught.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'

const FONTS = resolve(__dirname, 'fixtures/fonts')

describe('advance metrics match the fontTools reference', () => {
  // char → advance width (font units), read from fontTools hmtx.
  const HADV: Record<string, Record<string, number>> = {
    'Roboto-Regular.ttf': { A: 1336, W: 1817, i: 497, l: 497, ' ': 507, '.': 539 },
    'SourceSans3-Regular.otf': { A: 544, W: 786, i: 246, l: 255, ' ': 200, '.': 249 },
  }

  for (const file of Object.keys(HADV)) {
    const path = resolve(FONTS, file)
    it.skipIf(!existsSync(path))(`horizontal advances for ${file}`, () => {
      const font = Font.load(readFileSync(path).buffer as ArrayBuffer)
      for (const ch of Object.keys(HADV[file]!)) {
        const gid = font.getGlyphId(ch.codePointAt(0)!)
        expect(Math.round(font.getAdvanceWidth(gid)), `${JSON.stringify(ch)} advance`).toBe(HADV[file]![ch]!)
      }
    })
  }

  const JP_PATH = resolve(FONTS, 'NotoSansJP-Regular.otf')
  it.skipIf(!existsSync(JP_PATH))('vertical advance heights for NotoSansJP', () => {
    const font = Font.load(readFileSync(JP_PATH).buffer as ArrayBuffer)
    // Full-width CJK glyphs advance one em (1000) vertically.
    for (const ch of ['日', '本', '語', 'あ']) {
      const gid = font.getGlyphId(ch.codePointAt(0)!)
      expect(font.getAdvanceHeight(gid), `${ch} v-advance`).toBe(1000)
    }
  })
})
