/**
 * Unit tests for the complex-script shaping engine (src/shaping/).
 *
 * Real-font glyph sequences are asserted against hb-shape 13.2.1 output
 * (generated offline with --no-positions --no-clusters --no-glyph-names;
 * positions are covered by the hb-compat suite). Hangul is covered with a
 * synthetic font because no fixture font has Hangul glyphs.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'
import {
  getCombiningClass, getModifiedCombiningClass, reorderMarkRuns,
  getIndicDecomposition, composeIndicPair,
} from '../src/shaping/normalize.js'
import { preprocessThaiLao } from '../src/shaping/thai.js'
import { preprocessHangul } from '../src/shaping/hangul.js'
import { isIndicChar } from '../src/shaping/indic.js'
import { getShapingClass, CAT_Ra, CAT_H, CAT_VPre, POS_BASE_C, POS_PRE_M } from '../src/shaping/ot-categories.js'
import { isInitBlocker } from '../src/shaping/complex.js'
import { SyllableGrammar, scanLongest } from '../src/shaping/syllable-machine.js'
import { isDefaultIgnorable } from '../src/shaping/unicode-general-category.js'
import { BinaryWriter } from '../src/binary/writer.js'
import { buildTestFont } from './renderer/synthetic-font.js'

const FONTS_DIR = resolve(__dirname, 'fixtures/fonts')
const fontCache = new Map<string, Font>()

describe('default-ignorable shaping property', () => {
  it('matches shaping-engine compatibility exceptions', () => {
    expect([0x00AD, 0x034F, 0x061C, 0x180B, 0x180E, 0x2060, 0xFEFF, 0xE0100]
      .every(isDefaultIgnorable)).toBe(true)
    expect([0x115F, 0x1160, 0x180F, 0x3164, 0xFFA0, 0x1BCA0]
      .some(isDefaultIgnorable)).toBe(false)
  })
})

function loadFont(file: string): Font {
  let font = fontCache.get(file)
  if (font === undefined) {
    font = Font.load(readFileSync(resolve(FONTS_DIR, file)).buffer as ArrayBuffer)
    fontCache.set(file, font)
  }
  return font
}

function shapeIds(file: string, text: string, script: string): number[] {
  const shaped = loadFont(file).shapeText(text, { script })
  return shaped.map((g) => g.glyphId)
}

function clusterSum(file: string, text: string, script: string): number {
  const shaped = loadFont(file).shapeText(text, { script })
  let sum = 0
  for (const g of shaped) sum += g.componentCount
  return sum
}

describe('normalize: combining classes', () => {
  it('canonical combining classes', () => {
    expect(getCombiningClass(0x0041)).toBe(0)   // A
    expect(getCombiningClass(0x0300)).toBe(230) // combining grave
    expect(getCombiningClass(0x064E)).toBe(30)  // Arabic fatha
    expect(getCombiningClass(0x0651)).toBe(33)  // Arabic shadda
    expect(getCombiningClass(0x093C)).toBe(7)   // Devanagari nukta
    expect(getCombiningClass(0x094D)).toBe(9)   // Devanagari virama
    expect(getCombiningClass(0x0E49)).toBe(107) // Thai mai tho
    expect(getCombiningClass(0x3099)).toBe(8)   // combining dakuten
  })

  it('modified combining classes (shaping order)', () => {
    // Arabic: shadda sorts before the vowel marks.
    expect(getModifiedCombiningClass(0x0651)).toBe(27)
    expect(getModifiedCombiningClass(0x064E)).toBe(31)
    // Thai: sara u before phinthu.
    expect(getModifiedCombiningClass(0x0E38)).toBe(3)
    // Telugu length marks below the halant.
    expect(getModifiedCombiningClass(0x0C55)).toBe(4)
    // Identity elsewhere.
    expect(getModifiedCombiningClass(0x0300)).toBe(230)
  })

  it('reorders mark runs by modified class (stable)', () => {
    // fatha (mod 31) + shadda (mod 27) -> shadda first
    const cps = [0x0645, 0x064E, 0x0651, 0x062F]
    const clusters = [1, 1, 1, 1]
    reorderMarkRuns(cps, clusters)
    expect(cps).toEqual([0x0645, 0x0651, 0x064E, 0x062F])
    // Marks with equal classes keep their input order.
    const cps2 = [0x0628, 0x064B, 0x064B]
    reorderMarkRuns(cps2, [1, 1, 1])
    expect(cps2).toEqual([0x0628, 0x064B, 0x064B])
  })

  it('Indic decomposition data', () => {
    expect(getIndicDecomposition(0x0929)).toEqual([0x0928, 0x093C]) // NNNA
    expect(getIndicDecomposition(0x09CB)).toEqual([0x09C7, 0x09BE]) // Bengali O
    expect(getIndicDecomposition(0x0915)).toBeNull()
    // Composition exclusion: QA does not recompose.
    expect(composeIndicPair(0x0915, 0x093C)).toBe(0)
    // Non-excluded pair recomposes.
    expect(composeIndicPair(0x0928, 0x093C)).toBe(0x0929)
  })

  it('init blocker classification', () => {
    expect(isInitBlocker(0x0020)).toBe(false) // space
    expect(isInitBlocker(0x002C)).toBe(false) // comma
    expect(isInitBlocker(0x0995)).toBe(true)  // Bengali letter
    expect(isInitBlocker(0x09CD)).toBe(true)  // Bengali virama (mark)
    expect(isInitBlocker(0x0030)).toBe(false) // digit
  })
})

describe('indic routing', () => {
  it('routes assigned Sinhala characters without treating block holes as Sinhala', () => {
    expect(isIndicChar(0x0D7F)).toBe(true)
    expect(isIndicChar(0x0D80)).toBe(false)
    expect(isIndicChar(0x0DCA)).toBe(true)
    expect(isIndicChar(0x0DFF)).toBe(false)
    expect(isIndicChar(0x0E00)).toBe(false)
  })
})

describe('shaping classification table', () => {
  it('classifies key characters', () => {
    expect(getShapingClass(0x0930) & 0xFF).toBe(CAT_Ra)      // Devanagari RA
    expect(getShapingClass(0x0930) >> 8).toBe(POS_BASE_C)
    expect(getShapingClass(0x093F) >> 8).toBe(POS_PRE_M)     // i-matra
    expect(getShapingClass(0x17D2) & 0xFF).toBe(CAT_H)       // Khmer coeng
    expect(getShapingClass(0x17C1) & 0xFF).toBe(CAT_VPre)    // Khmer vowel E
    expect(getShapingClass(0x0041) & 0xFF).toBe(0)           // Latin A -> X
  })
})

describe('syllable machine', () => {
  it('longest match wins over alternation order', () => {
    // token A = "1 2", token B = "1 2 3": at [1,2,3] B (longer) must win
    // even though A is registered first.
    const g = new SyllableGrammar()
    const a = g.seq(g.cat([1]), g.cat([2]))
    const b = g.seq(g.cat([1]), g.cat([2]), g.cat([3]))
    g.token(a, 10)
    g.token(b, 20)
    const scanner = g.build()
    expect(scanLongest(scanner, [1, 2, 3], 0, 3)).toBe((3 << 8) | 20)
    expect(scanLongest(scanner, [1, 2, 9], 0, 3)).toBe((2 << 8) | 10)
    expect(scanLongest(scanner, [9], 0, 1)).toBe(0)
  })

  it('ties break by registration order', () => {
    const g = new SyllableGrammar()
    g.token(g.cat([1]), 30)
    g.token(g.cat([1]), 40)
    const scanner = g.build()
    expect(scanLongest(scanner, [1], 0, 1)).toBe((1 << 8) | 30)
  })

  it('handles greedy star with backtrack-hostile tails', () => {
    // token = (1)* 1 2 : NFA must match [1,1,2] fully (a backtracking-free
    // longest-match requirement).
    const g = new SyllableGrammar()
    g.token(g.seq(g.star(g.cat([1])), g.cat([1]), g.cat([2])), 5)
    const scanner = g.build()
    expect(scanLongest(scanner, [1, 1, 2], 0, 3)).toBe((3 << 8) | 5)
  })
})

describe('Thai preprocessing', () => {
  it('decomposes sara am and reorders nikhahit over tone marks', () => {
    const cps = [0x0E19, 0x0E49, 0x0E33] // NO NU, MAI THO, SARA AM
    const clusters = [1, 1, 1]
    preprocessThaiLao(cps, clusters)
    expect(cps).toEqual([0x0E19, 0x0E4D, 0x0E49, 0x0E32])
    expect(clusters.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('decomposes sara am without tone marks in place', () => {
    const cps = [0x0E17, 0x0E33] // THO THAHAN, SARA AM
    const clusters = [1, 1]
    preprocessThaiLao(cps, clusters)
    expect(cps).toEqual([0x0E17, 0x0E4D, 0x0E32])
    expect(clusters.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('handles Lao sara am', () => {
    const cps = [0x0EAA, 0x0EB3]
    const clusters = [1, 1]
    preprocessThaiLao(cps, clusters)
    expect(cps).toEqual([0x0EAA, 0x0ECD, 0x0EB2])
  })

  it('shapes Thai words to hb-shape parity', () => {
    // hb-shape NotoSansThai-Regular.ttf oracle sequences
    expect(shapeIds('NotoSansThai-Regular.ttf', 'น้ำ', 'thai')).toEqual([71, 59, 49, 86])
    expect(shapeIds('NotoSansThai-Regular.ttf', 'ก็', 'thai')).toEqual([29, 53])
    expect(shapeIds('NotoSansThai-Regular.ttf', 'ปั้น', 'thai')).toEqual([80, 46, 49, 71])
  })
})

describe('Indic shaper', () => {
  const DEVA = 'NotoSansDevanagari-Regular.ttf'
  const BENG = 'NotoSansBengali-Regular.ttf'

  it('forms and reorders reph after the base', () => {
    // RA + VIRAMA + KA: reph moves after KA (hb oracle [56, 506])
    expect(shapeIds(DEVA, 'र्क', 'dev2')).toEqual([56, 506])
  })

  it('moves the pre-base i-matra before the consonant', () => {
    // KA + I-MATRA: matra glyph first (hb oracle [545, 56])
    expect(shapeIds(DEVA, 'कि', 'dev2')).toEqual([545, 56])
  })

  it('forms half-form conjuncts', () => {
    // KA + VIRAMA + KA -> half KA + KA (hb oracle [232, 56])
    expect(shapeIds(DEVA, 'क्क', 'dev2')).toEqual([232, 56])
  })

  it('normalizes nukta composites through the nukt feature', () => {
    // QA (U+0958) decomposes to KA + NUKTA (composition-excluded) and the
    // font's nukt feature ligates it back (hb oracle [221]).
    expect(shapeIds(DEVA, 'क़', 'dev2')).toEqual([221])
  })

  it('handles rakar conjuncts with pre-base matra', () => {
    // PA + VIRAMA + RA + I-MATRA + YA (hb oracle [546, 309, 81])
    expect(shapeIds(DEVA, 'प्रिय', 'dev2')).toEqual([546, 309, 81])
  })

  it('shapes Bengali reph and matra reordering', () => {
    expect(shapeIds(BENG, 'র্ক', 'bng2')).toEqual([25, 132]) // reph after base
    expect(shapeIds(BENG, 'কি', 'bng2')).toEqual([60, 25])   // i-matra pre-base
    expect(shapeIds(BENG, 'ক্র', 'bng2')).toEqual([154, 346, 320])
  })

  it('preserves the source code point count in componentCount sums', () => {
    expect(clusterSum(DEVA, 'क्षत्रिय', 'dev2')).toBe(8)
    expect(clusterSum(DEVA, 'र्क कि', 'dev2')).toBe(6)
    expect(clusterSum(BENG, 'ক্র', 'bng2')).toBe(3)
  })

  it('shapes mixed Indic and Latin text without disturbing Latin glyphs', () => {
    const font = loadFont(DEVA)
    const shaped = font.shapeText('कि A', { script: 'dev2' })
    const plain = font.shapeText('A', { script: 'latn' })
    expect(shaped[shaped.length - 1]!.glyphId).toBe(plain[0]!.glyphId)
  })
})

describe('Khmer shaper', () => {
  const KHMR = 'NotoSansKhmer-Regular.ttf'

  it('reorders coeng+RO before the base', () => {
    // SA + COENG + RO + II (hb oracle [196, 59, 85])
    expect(shapeIds(KHMR, 'ស្រី', 'khmr')).toEqual([196, 59, 85])
  })

  it('decomposes split matras and reorders the left part', () => {
    // CHA + OE (U+17BE = 17C1 + right part) + NGO (hb oracle [107, 32, 85, 29])
    expect(shapeIds(KHMR, 'ជើង', 'khmr')).toEqual([107, 32, 85, 29])
  })

  it('applies cfar after a reordered coeng+RO', () => {
    // PO + COENG + RO + VISARGA (hb oracle [196, 50, 115])
    expect(shapeIds(KHMR, 'ព្រះ', 'khmr')).toEqual([196, 50, 115])
  })

  it('carries a default-ignorable through Khmer expansion and reordering', () => {
    // KA + INHERENT AQ + E; HarfBuzz 13.2.1 expands/reorders the cluster and
    // retains U+17B4 at the second output slot as a zero-width space.
    const font = loadFont(KHMR)
    const shaped = font.shapeText('\u1780\u17B4\u17C1', { script: 'khmr' })
    expect(shaped.map(glyph => glyph.glyphId)).toEqual([25, font.getGlyphId(0x20), 107, 360])
    expect(shaped.map(glyph => glyph.xAdvance)).toEqual([636, 0, 288, 635])
  })

  it('preserves componentCount sums', () => {
    expect(clusterSum(KHMR, 'ស្រី', 'khmr')).toBe(4)
    expect(clusterSum(KHMR, 'ជើង', 'khmr')).toBe(3)
  })
})

describe('Myanmar shaper', () => {
  const MYMR = 'NotoSansMyanmar-Regular.ttf'

  it('reorders medial RA before the base', () => {
    // KA + MEDIAL RA (hb oracle [198, 4])
    expect(shapeIds(MYMR, 'ကြ', 'mym2')).toEqual([198, 4])
  })

  it('reorders kinzi after the base', () => {
    // MA + NGA+ASAT+VIRAMA (kinzi) + GA + LA + AA (hb oracle [29, 6, 189, 32, 368])
    expect(shapeIds(MYMR, 'မင်္ဂလာ', 'mym2')).toEqual([29, 6, 189, 32, 368])
  })

  it('keeps pre-base vowel order for vowel stacks', () => {
    // KA + I + U (hb oracle [4, 369, 209])
    expect(shapeIds(MYMR, 'ကို', 'mym2')).toEqual([4, 369, 209])
  })

  it('preserves componentCount sums', () => {
    expect(clusterSum(MYMR, 'မင်္ဂလာ', 'mym2')).toBe(7)
    expect(clusterSum(MYMR, 'ကြ', 'mym2')).toBe(2)
  })
})

describe('Hangul shaper', () => {
  // Synthetic font: glyphs 0..10, all 600 units wide.
  //   1: U+115F (L, non-combining)  2: U+1100 (L)  3: U+1161 (V)
  //   4: U+11A8 (T)  5: U+AC00 (GA) 6: U+AC01 (GAG) 7: U+25CC
  //   8: U+302E (tone)  9: U+11A9 (T, also ljmo target)  10: vjmo target
  //
  // GSUB: DFLT script, features ljmo (single subst glyph 2 -> 9) and
  // vjmo (single subst glyph 3 -> 10).
  function hangulGsub(): Uint8Array {
    const w = new BinaryWriter()
    // Layout (all offsets from table start):
    //   0: header (10 bytes)
    //  10: ScriptList (10 bytes): count=1, 'DFLT' -> offset 8
    //  18: Script table: defaultLangSys=4, langSysCount=0
    //  22: LangSys: lookupOrder=0, required=0xFFFF, count=2, [0, 1]
    //  32: FeatureList: count=2, 'ljmo'->offset 14, 'vjmo'->offset 20
    //  46: Feature 0: params=0, lookupCount=1, [0]
    //  52: Feature 1: params=0, lookupCount=1, [1]
    //  58: LookupList: count=2, offsets [6, 14]
    //  64: Lookup 0: type=1, flag=0, subtableCount=1, [8]
    //  72: SingleSubst fmt2 @72: fmt=2, covOffset=10, count=1, [9]
    //  80: Coverage: fmt=1, count=1, [2]
    //  86: Lookup 1: type=1, flag=0, subtableCount=1, [8]
    //  94: SingleSubst fmt2: fmt=2, covOffset=10, count=1, [10]
    // 102: Coverage: fmt=1, count=1, [3]
    w.writeUint16(1); w.writeUint16(0)
    w.writeUint16(10)  // scriptList
    w.writeUint16(32)  // featureList
    w.writeUint16(58)  // lookupList
    // ScriptList
    w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
    // Script table (@18)
    w.writeUint16(4); w.writeUint16(0)
    // LangSys (@22)
    w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(1)
    // FeatureList (@32)
    w.writeUint16(2)
    w.writeTag('ljmo'); w.writeUint16(14)
    w.writeTag('vjmo'); w.writeUint16(20)
    // Feature 0 (@46)
    w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
    // Feature 1 (@52)
    w.writeUint16(0); w.writeUint16(1); w.writeUint16(1)
    // LookupList (@58)
    w.writeUint16(2); w.writeUint16(6); w.writeUint16(28)
    // Lookup 0 (@64)
    w.writeUint16(1); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
    // SingleSubst fmt2 (@72)
    w.writeUint16(2); w.writeUint16(8); w.writeUint16(1); w.writeUint16(9)
    // Coverage (@80)
    w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
    // Lookup 1 (@86)
    w.writeUint16(1); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
    // SingleSubst fmt2 (@94)
    w.writeUint16(2); w.writeUint16(8); w.writeUint16(1); w.writeUint16(10)
    // Coverage (@102)
    w.writeUint16(1); w.writeUint16(1); w.writeUint16(3)
    return w.toUint8Array()
  }

  function makeHangulFont(): Font {
    const glyphs = new Array<Uint8Array | null>(11).fill(null)
    const cmapping: [number, number][] = [
      [0x115F, 1], [0x1100, 2], [0x1161, 3], [0x11A8, 4],
      [0xAC00, 5], [0xAC01, 6], [0x25CC, 7], [0x302E, 8],
      [0x11A9, 9], // also used as decomposition target below
    ]
    return Font.load(buildTestFont(glyphs, cmapping, [['GSUB', hangulGsub()]]))
  }

  it('preprocess composes <L,V> and <L,V,T> when the font has the syllable', () => {
    const font = makeHangulFont()
    const cps = [0x1100, 0x1161]
    const clusters = [1, 1]
    preprocessHangul(font, cps, clusters)
    expect(cps).toEqual([0xAC00])
    expect(clusters).toEqual([2])

    const cps3 = [0x1100, 0x1161, 0x11A8]
    const clusters3 = [1, 1, 1]
    preprocessHangul(font, cps3, clusters3)
    expect(cps3).toEqual([0xAC01])
    expect(clusters3).toEqual([3])
  })

  it('preprocess combines <LV,T> into <LVT>', () => {
    const font = makeHangulFont()
    const cps = [0xAC00, 0x11A8]
    const clusters = [1, 1]
    preprocessHangul(font, cps, clusters)
    expect(cps).toEqual([0xAC01])
  })

  it('preprocess decomposes syllables the font lacks', () => {
    const font = makeHangulFont()
    // U+AC02 (GAGG) has no glyph; decomposes to L + V + T(U+11A9)
    const cps = [0xAC02]
    const clusters = [1]
    const jamo = preprocessHangul(font, cps, clusters)
    expect(cps).toEqual([0x1100, 0x1161, 0x11A9])
    expect(jamo).toEqual([1, 2, 3])
    expect(clusters.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('reorders a tone mark before its syllable', () => {
    const font = makeHangulFont()
    const cps = [0x1100, 0x1161, 0x302E]
    const clusters = [1, 1, 1]
    preprocessHangul(font, cps, clusters)
    expect(cps).toEqual([0x302E, 0xAC00])
  })

  it('inserts a dotted circle for a lone tone mark', () => {
    const font = makeHangulFont()
    const cps = [0x302E]
    const clusters = [1]
    preprocessHangul(font, cps, clusters)
    expect(cps).toEqual([0x302E, 0x25CC])
  })

  it('applies ljmo/vjmo to uncomposed jamo through shapeText', () => {
    const font = makeHangulFont()
    // U+115F is a non-combining L: <L,V> cannot compose, jamo features apply.
    const shaped = font.shapeText('ᅟᅡ')
    // Hangul fillers are retained as spacing glyphs for shaping compatibility.
    expect(shaped.map((g) => g.glyphId)).toEqual([1, 10])
    // U+1100 is combining but U+AC00 exists, so it composes instead.
    const composed = font.shapeText('가')
    expect(composed.map((g) => g.glyphId)).toEqual([5])
  })
})
