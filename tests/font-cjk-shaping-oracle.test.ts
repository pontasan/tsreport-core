// CJK (Japanese) shaping — vertical (tate-gaki) and horizontal — validated against the HarfBuzz (hb-shape)
// oracle on real macOS Japanese fonts. HarfBuzz applies only the `vert` GSUB
// feature for vertical text — never vpal/valt/vkrn/vrt2 — so full-width glyphs
// stay on a 1em vertical advance and only the intended forms (e.g. brackets,
// punctuation) rotate. Skipped when the fonts are absent (non-macOS CI).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { Font } from '../src/font.js'

const MINCHO = '/System/Library/Fonts/ヒラギノ明朝 ProN.ttc'
const GOTHIC = '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc'

function vshape(path: string, text: string): { gid: number, yAdvance: number }[] {
  const font = Font.load(readFileSync(path).buffer as ArrayBuffer, { fontIndex: 0 })
  return font.shapeText(text, { direction: 'vertical' }).map(g => ({ gid: g.glyphId, yAdvance: g.yAdvance }))
}

describe.skipIf(!existsSync(MINCHO))('vertical shaping matches HarfBuzz (Hiragino Mincho)', () => {
  it('keeps full-width glyphs (incl. punctuation) on a 1em vertical advance', () => {
    // 。 gets its vertical presentation form (7888) via `vert`, and — unlike the
    // old vpal/valt path — keeps a full 1000-unit advance (not 500).
    const g = vshape(MINCHO, '永遠。')
    expect(g.map(x => x.gid)).toEqual([1260, 1301, 7888])
    expect(g.map(x => x.yAdvance)).toEqual([1000, 1000, 1000])
  })

  it('does not over-rotate half-width katakana (vert, not vrt2)', () => {
    // hb keeps ｱｲｳ as 343/344/345 (vert leaves them); vrt2 would substitute
    // them (e.g. to 9101...) — we must match hb and keep the vert forms.
    const g = vshape(MINCHO, 'ｱｲｳ')
    expect(g.map(x => x.gid)).toEqual([343, 344, 345])
    expect(g.map(x => x.yAdvance)).toEqual([1000, 1000, 1000])
  })
})

describe.skipIf(!existsSync(GOTHIC))('vertical shaping matches HarfBuzz (Hiragino Gothic)', () => {
  it('rotates brackets/punctuation but leaves mixed Latin upright, all 1em', () => {
    // 「」（）ー get vertical forms; each glyph advances a full em vertically.
    const g = vshape(GOTHIC, '「あ」（ー）')
    expect(g.map(x => x.yAdvance)).toEqual([1000, 1000, 1000, 1000, 1000, 1000])
    // The two brackets substitute to distinct vertical-form glyphs.
    expect(g[0]!.gid).not.toBe(g[2]!.gid)
  })

  it('circled numbers and full-width Latin keep a 1em vertical advance', () => {
    const g = vshape(GOTHIC, '①②ＡＢ')
    expect(g.map(x => x.yAdvance)).toEqual([1000, 1000, 1000, 1000])
  })
})

function hshape(path: string, text: string): { gid: number, xAdvance: number }[] {
  const font = Font.load(readFileSync(path).buffer as ArrayBuffer, { fontIndex: 0 })
  return font.shapeText(text, { direction: 'horizontal' }).map(g => ({ gid: g.glyphId, xAdvance: g.xAdvance }))
}

// Horizontal Japanese is the primary report body text: full-width glyphs on a
// 1em advance, half-width katakana on a half-em advance, and GPOS kerning
// applied to Latin runs and Latin-CJK boundaries — all matched to HarfBuzz.
describe.skipIf(!existsSync(GOTHIC))('horizontal shaping matches HarfBuzz (Hiragino Gothic)', () => {
  it('keeps full-width kanji/kana on 1em and half-width katakana on half-em', () => {
    const g = hshape(GOTHIC, '日本語ｱｲｳ')
    expect(g.map(x => x.gid)).toEqual([3284, 3722, 1952, 343, 344, 345])
    expect(g.map(x => x.xAdvance)).toEqual([1000, 1000, 1000, 500, 500, 500])
  })

  it('applies GPOS kerning to a full-width interpunct and Latin pair', () => {
    // A・B — the middle dot and Latin advances match hb (A=750, ・=1000, B=712).
    const g = hshape(GOTHIC, 'A・B')
    expect(g.map(x => x.gid)).toEqual([34, 638, 35])
    expect(g.map(x => x.xAdvance)).toEqual([750, 1000, 712])
  })
})
