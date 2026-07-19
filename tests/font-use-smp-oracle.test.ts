// SMP (astral-plane) Universal Shaping Engine scripts. These Brahmic and
// related complex scripts live above the BMP (Kaithi, Brahmi, Sharada, Newa,
// Tirhuta, ...) and were previously routed through the non-complex path, which
// (a) mis-shaped them and (b) could loop unboundedly: a chain-context lookup
// whose nested MultipleSubst re-inserted the trigger glyph expanded the buffer
// without bound (heap exhaustion). Both are fixed — the scripts route through
// the USE shaper and the contextual apply advances past inserted glyphs.
// Expected glyph IDs are the HarfBuzz (hb-shape) oracle. Skipped when the
// macOS system fonts are absent (non-macOS CI).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { Font } from '../src/font.js'

const DIR = '/System/Library/Fonts/Supplemental/'
const KAITHI = DIR + 'NotoSansKaithi-Regular.ttf'
const BRAHMI = DIR + 'NotoSansBrahmi-Regular.ttf'
const SHARADA = DIR + 'NotoSansSharada-Regular.ttf'
const NEWA = DIR + 'NotoSansNewa-Regular.ttf'
const TIRHUTA = DIR + 'NotoSansTirhuta-Regular.ttf'
const KHUDAWADI = DIR + 'NotoSansKhudawadi-Regular.ttf'
const DEVA_MN = DIR + 'Devanagari Sangam MN.ttc'
const BUHID = DIR + 'NotoSansBuhid-Regular.ttf'
const PHAGSPA = DIR + 'NotoSansPhagsPa-Regular.ttf'
const SAURASHTRA = DIR + 'NotoSansSaurashtra-Regular.ttf'
const SYLOTI = DIR + 'NotoSansSylotiNagri-Regular.ttf'
const LIMBU = DIR + 'NotoSansLimbu-Regular.ttf'

function shape(path: string, text: string, script: string): number[] {
  const font = Font.load(readFileSync(path).buffer as ArrayBuffer)
  return font.shapeText(text, { script, direction: 'horizontal' }).map(g => g.glyphId)
}

// The reduced crash case: Kaithi KA (U+1108D) + pre-base vowel sign I (U+110B1).
// hb-shape reorders the pre-base matra before the base: [nullR, ktVSI.alt2, ktKa].
describe.skipIf(!existsSync(KAITHI))('USE SMP: Kaithi (no runaway expansion)', () => {
  it('shapes KA + pre-base I-matra without hanging, matching HarfBuzz', () => {
    expect(shape(KAITHI, '\u{1108D}\u{110B1}', 'kthi')).toEqual([294, 217, 18])
  })
})

describe.skipIf(!existsSync(BRAHMI))('USE SMP: Brahmi', () => {
  it('shapes KA + AA-matra, matching HarfBuzz', () => {
    expect(shape(BRAHMI, '\u{11013}\u{11038}', 'brah')).toEqual([24, 61])
  })
})

describe.skipIf(!existsSync(SHARADA))('USE SMP: Sharada', () => {
  it('shapes a virama conjunct, matching HarfBuzz', () => {
    expect(shape(SHARADA, '\u{11191}\u{111CA}\u{11197}', 'shrd')).toEqual([21, 78, 27])
  })
})

describe.skipIf(!existsSync(NEWA))('USE SMP: Newa', () => {
  it('shapes a KA-virama-KA conjunct, matching HarfBuzz', () => {
    expect(shape(NEWA, '\u{1140E}\u{11442}\u{1140E}', 'newa')).toEqual([284, 160])
  })
})

describe.skipIf(!existsSync(TIRHUTA))('USE SMP: Tirhuta', () => {
  it('shapes KA + AA-matra, matching HarfBuzz', () => {
    expect(shape(TIRHUTA, '\u{1148F}\u{114B0}', 'tirh')).toEqual([25, 58])
  })
})

// Unicode vowel constraints: a prohibited independent-vowel + vowel-sign
// sequence gets a dotted circle inserted on the GSUB path (matching HarfBuzz).
describe.skipIf(!existsSync(BRAHMI))('vowel constraints (GSUB path)', () => {
  it('inserts a dotted circle for Brahmi A + AA-sign (invalid)', () => {
    // [brm_A, uni25CC, brm_vowelAA] — glyph 227 is the dotted circle.
    expect(shape(BRAHMI, '\u{11005}\u{11038}', 'brah')).toEqual([10, 227, 61])
  })
  it('inserts a dotted circle for Khudawadi A + vowel sign U (invalid)', () => {
    expect(shape(KHUDAWADI, '\u{112B0}\u{112E5}', 'sind')).toEqual([22, 11, 75])
  })
  it('leaves a well-formed Brahmi consonant + AA-sign untouched', () => {
    expect(shape(BRAHMI, '\u{11013}\u{11038}', 'brah')).toEqual([24, 61])
  })
})

// The AAT morx path must NOT apply vowel constraints: HarfBuzz drops to a
// minimal shaper when morx drives shaping, and the font's own morx supplies the
// dotted circle (here folded into an aa-matra variant glyph, no extra glyph).
describe.skipIf(!existsSync(DEVA_MN))('vowel constraints skipped on AAT morx path', () => {
  it('does not double-insert for Devanagari A + AA-sign (morx font)', () => {
    expect(shape(DEVA_MN, '\u{0905}\u{093E}', 'deva')).toEqual([120, 1372])
  })
  it('leaves well-formed Devanagari (नमस्ते) unchanged', () => {
    expect(shape(DEVA_MN, 'नमस्ते', 'deva')).toEqual([155, 161, 1077, 1283])
  })
})

// BMP USE scripts that were previously missing from the USE coverage (routed to
// the non-complex path). Each exercises a distinct USE behavior, all matched to
// the HarfBuzz oracle.
describe.skipIf(!existsSync(BUHID))('BMP USE: Buhid broken cluster', () => {
  it('inserts a dotted circle for a leading vowel sign (matra-first)', () => {
    // VOWEL SIGN I (U+1752) before a base (U+1740): [dottedCircle, sign, base].
    expect(shape(BUHID, 'ᝒᝀ', 'buhd')).toEqual([43, 25, 7])
  })
})

describe.skipIf(!existsSync(PHAGSPA))('BMP USE: Phags-pa joining', () => {
  it('applies positional (init/fina) joining across two letters', () => {
    expect(shape(PHAGSPA, 'ꡀꡉ', 'phag')).toEqual([53, 122])
  })
})

describe.skipIf(!existsSync(SAURASHTRA))('BMP USE: Saurashtra broken cluster', () => {
  it('inserts a dotted circle for a leading vowel modifier', () => {
    // SIGN ANUSVARA (U+A880) before a base (U+A88D): [dottedCircle, sign, base].
    expect(shape(SAURASHTRA, 'ꢀꢍ', 'saur')).toEqual([95, 5, 18])
  })
})

// The Syloti Nagri font's GSUB carries only the DFLT script, so HarfBuzz shapes
// it with the default (non-USE) shaper — no broken-cluster dotted circle. The
// engine mirrors this by falling back to the non-complex path.
describe.skipIf(!existsSync(SYLOTI))('BMP USE: Syloti Nagri (DFLT-only GSUB → default shaper)', () => {
  it('does not insert a dotted circle for a leading vowel sign', () => {
    expect(shape(SYLOTI, 'ꠣꠀ', 'sylo')).toEqual([52, 17])
  })
})

// A symbol/other (category O) base carrying a matra is a symbol cluster, not a
// broken one — no dotted circle (matches the HarfBuzz USE syllable machine).
describe.skipIf(!existsSync(LIMBU))('BMP USE: Limbu symbol cluster', () => {
  it('does not break an O-category sign followed by a vowel sign', () => {
    expect(shape(LIMBU, '᥀ᤢ', 'limb')).toEqual([57, 35])
  })
})

// The layout / measure path shapes without an explicit script tag. The USE
// routing decision (and its DFLT-only fallback) must still hold there: the OT
// script tag is derived from the code points. Syloti Nagri (DFLT-only GSUB)
// must not gain a spurious dotted circle when shaped through the render path.
import { shapeGlyphRun } from '../src/measure/glyph-run.js'
describe.skipIf(!existsSync(SYLOTI))('render path (no script tag) mirrors USE routing', () => {
  it('Syloti Nagri render path inserts no dotted circle (DFLT-only font)', () => {
    const font = Font.load(readFileSync(SYLOTI).buffer as ArrayBuffer)
    const run = shapeGlyphRun(font, 'ꠣꠀ', 12, 0, 0, false)
    expect(Array.from(run.glyphIds)).toEqual([52, 17])
  })
  it('Buhid render path still inserts the broken-cluster dotted circle', () => {
    const font = Font.load(readFileSync(BUHID).buffer as ArrayBuffer)
    const run = shapeGlyphRun(font, 'ᝒᝀ', 12, 0, 0, false)
    expect(Array.from(run.glyphIds)).toEqual([43, 25, 7])
  })
})

// Shaper selection also gates the Myanmar and Indic shapers on the font's
// OpenType script (hb_ot_shaper_categorize): a font whose GSUB carries only
// 'DFLT' for the script uses the default shaper, not the reordering one.
const NOTO_MYANMAR = '/System/Library/Fonts/NotoSansMyanmar.ttc'
describe.skipIf(!existsSync(NOTO_MYANMAR))('Myanmar shaper gating (DFLT-only GSUB → default shaper)', () => {
  it('does not pre-base-reorder the medial ra in a DFLT-only Myanmar font', () => {
    // NotoSansMyanmar has only /DFLT (no mym2), so HarfBuzz keeps logical order
    // (base MA 29 before medial ra 48) and positions the medial with GPOS,
    // rather than reordering it before the base.
    const font = Font.load(readFileSync(NOTO_MYANMAR).buffer as ArrayBuffer, { fontIndex: 9 })
    const gids = font.shapeText('မြန်မာ', { script: 'mymr', language: 'my', direction: 'horizontal' }).map(g => g.glyphId)
    expect(gids).toEqual([29, 48, 262, 425, 29, 368])
  })
})

const MYANMAR_MN = '/System/Library/Fonts/Supplemental/Myanmar MN.ttc'
describe.skipIf(!existsSync(MYANMAR_MN))('Myanmar shaper still fires for a mym2 font', () => {
  it('pre-base-reorders and substitutes the medial ra in a mym2 Myanmar font', () => {
    // Myanmar MN declares 'mym2', so the Myanmar shaper reorders the medial ra
    // pre-base and GSUB substitutes it to the combined form (278), matching hb.
    const font = Font.load(readFileSync(MYANMAR_MN).buffer as ArrayBuffer)
    const gids = font.shapeText('မြ', { script: 'mymr', language: 'my', direction: 'horizontal' }).map(g => g.glyphId)
    expect(gids).toEqual([278, 139])
  })
})

// Thai PUA fallback shaping (HarfBuzz preprocess_text_thai): a font with no
// Thai GSUB script (e.g. Arial Unicode) positions tone marks and below-vowels
// through pre-encoded PUA glyphs. Expected glyph IDs are the hb-shape oracle.
const ARIAL_UNICODE = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
describe.skipIf(!existsSync(ARIAL_UNICODE))('Thai PUA fallback shaping (no Thai GSUB)', () => {
  it('shifts tone marks to PUA forms in a font without a Thai GSUB script', () => {
    const font = Font.load(readFileSync(ARIAL_UNICODE).buffer as ArrayBuffer)
    // เป็นไปได้ — MAITAIKHU (0E47) → PUA 5461, MAI THO (0E49) → PUA 5454.
    const gids = font.shapeText('เป็นไปได้', { script: 'thai', direction: 'horizontal' }).map(g => g.glyphId)
    expect(gids).toEqual([2163, 2130, 5461, 2128, 2167, 2130, 2167, 2123, 5454])
  })

  it('shifts a tone mark left over an above-vowel cluster', () => {
    const font = Font.load(readFileSync(ARIAL_UNICODE).buffer as ArrayBuffer)
    // ที่ — SARA II (0E35, above) then MAI EK (0E48, tone) → shift-left PUA 2171.
    const gids = font.shapeText('ที่', { script: 'thai', direction: 'horizontal' }).map(g => g.glyphId)
    expect(gids).toEqual([2126, 2156, 2171])
  })
})

// Shaper selection depends on the OT script HarfBuzz *chooses*: it tries the
// script's real tags, then DFLT/latn. A font with neither the real tag nor a
// DFLT script still routes to the specific shaper (the requested tag is
// chosen). Arial Unicode has no Bengali and no DFLT GSUB script, so Bengali
// still uses the Indic shaper (pre-base matra reordering), matching HarfBuzz.
const ARIAL_UNICODE_2 = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
describe.skipIf(!existsSync(ARIAL_UNICODE_2))('Indic shaper for a font without a DFLT GSUB script', () => {
  it('reorders the pre-base I-matra in Bengali (no beng/DFLT script → still Indic)', () => {
    const font = Font.load(readFileSync(ARIAL_UNICODE_2).buffer as ArrayBuffer)
    // স্ট্রিং — the pre-base vowel sign I (gid 1533) moves before RA (gid 1525).
    const gids = font.shapeText('স্ট্রিং', { script: 'beng', language: 'bn', direction: 'horizontal' }).map(g => g.glyphId)
    expect(gids).toEqual([1529, 1543, 1509, 1543, 1533, 1525, 1485])
  })
})
