// AAT baseline (bsln) and justification (just) consumption validated against
// real macOS system fonts that carry those tables. Also exercises the cmap
// parser's acceptance of a format-12 subtable in a (3,1) BMP Unicode record
// (Geneva ships one). Skipped when the fonts are absent (non-macOS CI).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { Font } from '../src/font.js'
import { TextMeasurer } from '../src/measure/text-measurer.js'
import { layoutText } from '../src/layout/text-layout.js'

const GENEVA = '/System/Library/Fonts/Geneva.ttf'          // has bsln (+ (3,1) format 12 cmap)
const GEEZA = '/System/Library/Fonts/GeezaPro.ttc'         // has just
const NEWPENINIM = '/System/Library/Fonts/Supplemental/NewPeninimMT.ttc' // AAT Hebrew (morx only)
const ARIAL = '/System/Library/Fonts/Supplemental/Arial.ttf'            // GPOS mark attachment
const MISHAFI = '/System/Library/Fonts/Supplemental/Mishafi.ttf'        // AAT Arabic (morx + kern)
const FARISI = '/System/Library/Fonts/Supplemental/Farisi.ttf'          // AAT Nastaliq (morx + cross-stream kern)
const DIWAN = '/System/Library/Fonts/Supplemental/Diwan Thuluth.ttf'    // AAT Arabic, morx with mixed subtable directions
const WASEEM = '/System/Library/Fonts/Supplemental/Waseem.ttc'          // AAT Nastaliq (morx directions + cross-stream)
const THONBURI = '/System/Library/Fonts/Supplemental/Thonburi.ttc'      // AAT Thai (morx, no GSUB): sara am ligation
const TAMILMN = '/System/Library/Fonts/Supplemental/Tamil MN.ttc'       // morx with a type-5 insertion subtable
const TELUGUMN = '/System/Library/Fonts/Supplemental/Telugu MN.ttc'     // kerx format-4 anchor attachment + ankr
const BANGLAMN = '/System/Library/Fonts/Supplemental/Bangla MN.ttc'     // Indic shaped via morx (AAT), not GSUB
const DEVASANGAM = '/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc' // kerx format-4 non-zero action index
const ROHINGYA = '/System/Library/Fonts/Supplemental/NotoSansHanifiRohingya-Regular.ttf' // cursive-joining USE (SMP)
const MALAYALAMSANGAM = '/System/Library/Fonts/Supplemental/Malayalam Sangam MN.ttc' // AAT kerx pair kern skips marks
const CHALKBOARD = '/System/Library/Fonts/Supplemental/ChalkboardSE.ttc' // morx + GSUB Latin: fi/fl live in morx
const LUCIDAGRANDE = '/System/Library/Fonts/LucidaGrande.ttc'            // morx + GSUB Latin: ffi/ffl/ff live in morx
const APPLE_CHANCERY = '/System/Library/Fonts/Supplemental/Apple Chancery.ttf' // opbd + lcar
const HOEFLER_TEXT = '/System/Library/Fonts/Supplemental/Hoefler Text.ttc' // opbd

describe.skipIf(!existsSync(GENEVA))('AAT bsln baseline consumption', () => {
  it('parses the real Zapf version 1 UInt32 glyph-offset array', () => {
    const font = Font.load(readFileSync(GENEVA).buffer as ArrayBuffer)
    const glyphId = font.getGlyphId(0x41)
    const info = font.getZapfGlyphInfo(glyphId)

    expect(font.zapf?.version).toBe(1)
    expect(info).not.toBeNull()
    expect(info!.unicodes).toEqual([0x41])
  })

  it('loads a font whose (3,1) cmap uses format 12 and resolves baselines', () => {
    const font = Font.load(readFileSync(GENEVA).buffer as ArrayBuffer)
    // cmap format 12 in the BMP record must be accepted: basic glyph lookup works.
    expect(font.getGlyphId(0x41)).toBeGreaterThan(0)
    // bsln consumption: every glyph has a defined baseline class and a numeric
    // roman-baseline coordinate (0 for a Latin design).
    const cls = font.getAatBaselineClass(font.getGlyphId(0x41))
    expect(cls).not.toBeNull()
    expect(Number.isInteger(cls)).toBe(true)
    const coord = font.getAatBaselineCoordinate(font.getGlyphId(0x41))
    expect(coord).not.toBeNull()
    expect(typeof coord).toBe('number')
  })

  it.runIf(existsSync(LUCIDAGRANDE))('aligns different dominant baseline classes in a public glyph run', () => {
    const font = Font.load(readFileSync(LUCIDAGRANDE).buffer as ArrayBuffer)
    const text = 'A\u1D2C'
    const firstGlyph = font.getGlyphId(0x41)
    const secondGlyph = font.getGlyphId(0x1D2C)
    const firstBaseline = font.getAatBaselineCoordinate(firstGlyph)!
    const secondBaseline = font.getAatBaselineCoordinate(secondGlyph)!
    const line = layoutText(text, new TextMeasurer(font), font.metrics.unitsPerEm, { maxWidth: 10000 }).lines[0]!

    expect(line.run!.glyphIds[0]).toBe(firstGlyph)
    expect(line.run!.glyphIds[1]).toBe(secondGlyph)
    expect(line.run!.yOffsets[0]).toBe(0)
    expect(line.run!.yOffsets[1]).toBe(firstBaseline - secondBaseline)
  })
})

describe.skipIf(!existsSync(HOEFLER_TEXT))('AAT opbd layout consumption', () => {
  it('applies a real font optical edge to the first rendered glyph', () => {
    const font = Font.load(readFileSync(HOEFLER_TEXT).buffer as ArrayBuffer)
    let character = ''
    let glyphId = 0
    let edge = 0
    let first = true
    for (let cp = 32; cp < 0x10000 && character === ''; cp++) {
      const candidate = font.getGlyphId(cp)
      const bounds = font.getOpticalBounds(candidate)
      if (candidate !== 0 && bounds !== null && (bounds.left !== 0 || bounds.right !== 0)) {
        character = String.fromCodePoint(cp)
        glyphId = candidate
        first = bounds.left !== 0
        edge = first ? bounds.left : bounds.right
      }
    }
    expect(character).not.toBe('')
    const fontSize = 20
    const line = layoutText(first ? `${character} ` : ` ${character}`, new TextMeasurer(font), fontSize, { maxWidth: 1000 }).lines[0]!
    const glyphIndex = first ? 0 : line.run!.glyphIds.length - 1

    expect(line.run!.glyphIds[glyphIndex]).toBe(glyphId)
    expect(line.run!.xOffsets[glyphIndex]).toBeCloseTo(edge * fontSize / font.metrics.unitsPerEm)
  })
})

describe.skipIf(!existsSync(GEEZA))('AAT just justification consumption', () => {
  it('surfaces a non-zero justification grow weight for a font with a just table', () => {
    const font = Font.load(readFileSync(GEEZA).buffer as ArrayBuffer)
    let nonZero = 0
    for (let g = 0; g < 800 && nonZero < 5; g++) {
      if (font.getJustificationGrowWeight(g) !== 0) nonZero++
    }
    expect(nonZero).toBeGreaterThan(0)
  })
})

// Fallback mark positioning: an AAT font (morx only, no GPOS/ankr/kerx-4)
// centers combining marks over their cluster base. The expected x-offsets are
// verified against HarfBuzz (hb-shape) for the same text/font.
describe.skipIf(!existsSync(NEWPENINIM))('fallback mark positioning (AAT Hebrew)', () => {
  it('centers Hebrew nikud over the cluster base, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(NEWPENINIM).buffer as ArrayBuffer, { fontIndex: 0 })
    // בְּרֵאשִׁית — HarfBuzz places the two zero-advance point glyphs (126, 136)
    // at x-offset 157 and 22 respectively; every other glyph stays at 0.
    const r = font.shapeText('בְּרֵאשִׁית', { script: 'hebr', language: 'he', direction: 'horizontal' })
    const byGlyph = new Map<number, number>()
    for (const g of r) if (g.xAdvance === 0) byGlyph.set(g.glyphId, g.xOffset)
    expect(byGlyph.get(126)).toBe(157)
    expect(byGlyph.get(136)).toBe(22)
    // The marks carry their y in the outline, so the fallback leaves y at 0.
    for (const g of r) if (g.xAdvance === 0) expect(g.yOffset).toBe(0)
  })
})

describe.skipIf(!existsSync(ARIAL))('fallback mark positioning does not fire for GPOS fonts', () => {
  it('leaves a GPOS-positioned combining mark untouched (no fallback centering)', () => {
    const font = Font.load(readFileSync(ARIAL).buffer as ArrayBuffer)
    // x + combining acute (U+0301): Arial has GPOS (no morx), so the mark is
    // positioned by GPOS mark-to-base and the fallback (morx path only) must not
    // run — the mark keeps its GPOS offsets, not a fallback-centered x + zero y.
    const r = font.shapeText('x\u0301', { script: 'latn', language: 'en', direction: 'horizontal' })
    expect(r.length).toBe(2)
    const mark = r[1]!
    expect(mark.xAdvance).toBe(0)
    expect(mark.xOffset).toBeLessThan(0)
    expect(mark.yOffset).not.toBe(0)
  })
})

describe.skipIf(!existsSync(MISHAFI))('AAT kern format-1 state machine mark positioning', () => {
  it('positions marks via the kern state machine, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(MISHAFI).buffer as ArrayBuffer)
    // Mishafi is a morx font that ALSO carries a 'kern' table whose format-1
    // state machines position the marks. \u0628\u0650\u0633\u0652\u0645\u0650 shapes to (logical order) glyphs
    // [2813, 1084, 1085, 957, 991]; HarfBuzz's kern places glyph 1084 at
    // x-offset +480 (advance 480) and glyph 2813 at x-offset -480 (advance 296),
    // leaving the rest at 0. The morx-deleted glyph is kept as a 0xFFFF marker
    // through positioning so the state transitions match HarfBuzz.
    const r = font.shapeText('\u0628\u0650\u0633\u0652\u0645\u0650', {
      script: 'arab', language: 'ar', direction: 'horizontal',
    })
    const byGlyph = new Map<number, { xOffset: number, xAdvance: number }>()
    for (const g of r) byGlyph.set(g.glyphId, { xOffset: g.xOffset, xAdvance: g.xAdvance })
    expect(byGlyph.get(1084)).toEqual({ xOffset: 480, xAdvance: 480 })
    expect(byGlyph.get(2813)).toEqual({ xOffset: -480, xAdvance: 296 })
    expect(byGlyph.get(1085)).toEqual({ xOffset: 0, xAdvance: 0 })
    // No fallback-centering fractions: every offset is an exact integer.
    for (const g of r) expect(Number.isInteger(g.xOffset)).toBe(true)
  })
})

describe.skipIf(!existsSync(FARISI))('AAT kern cross-stream cascading baseline', () => {
  it('propagates the cross-stream y-shift to following glyphs, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(FARISI).buffer as ArrayBuffer)
    // Farisi is a Nastaliq AAT font: its 'kern' cross-stream subtable raises the
    // baseline and the shift PERSISTS along the cascade. سلام shapes to glyphs
    // (logical) [420, 186, 129]; HarfBuzz gives both 186 and 420 a y-offset of
    // 120 (the cascade), not just the glyph the value fires on.
    const r = font.shapeText('سلام', { script: 'arab', language: 'fa', direction: 'horizontal' })
    const byGlyph = new Map<number, number>()
    for (const g of r) byGlyph.set(g.glyphId, g.yOffset)
    expect(byGlyph.get(186)).toBe(120)
    expect(byGlyph.get(420)).toBe(120)
    expect(byGlyph.get(129)).toBe(0)
  })
})

describe.skipIf(!existsSync(DIWAN))('morx per-subtable processing direction (RTL)', () => {
  it('reverses non-descending subtables for RTL text so later substitutions match HarfBuzz', () => {
    const font = Font.load(readFileSync(DIWAN).buffer as ArrayBuffer)
    // ثلث in Diwan Thuluth: many morx subtables lack the Descending flag, so for
    // RTL text HarfBuzz processes them last-to-first. Without that direction
    // handling the later contextual substitutions never fire (the run stops at
    // the joining forms). HarfBuzz yields visual [1300, 833, 2009] = logical
    // [2009, 833, 1300].
    const r = font.shapeText('ثلث', { script: 'arab', language: 'ar', direction: 'horizontal' })
    expect(r.map(g => g.glyphId)).toEqual([2009, 833, 1300])
  })
})

describe.skipIf(!existsSync(WASEEM))('morx directions + cross-stream combined (Nastaliq)', () => {
  it('shapes وسيم with the correct glyphs and cascading baseline, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(WASEEM).buffer as ArrayBuffer)
    // Waseem needs both the morx subtable-direction handling (glyph 318, not 316)
    // and the cross-stream cascade (y-offset 386/256). HarfBuzz visual output:
    // 237@256, 318@386, 464@386, 148@0 → logical below.
    const r = font.shapeText('وسيم', { script: 'arab', language: 'ar', direction: 'horizontal' })
    expect(r.map(g => ({ g: g.glyphId, yo: g.yOffset }))).toEqual([
      { g: 148, yo: 0 }, { g: 464, yo: 386 }, { g: 318, yo: 386 }, { g: 237, yo: 256 },
    ])
  })
})

describe.skipIf(!existsSync(THONBURI))('AAT Thai sara am is ligated by morx, not decomposed', () => {
  it('keeps SARA AM undecomposed so morx ligates ko+sara am, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(THONBURI).buffer as ArrayBuffer)
    // Thonburi has no GSUB, so it is an AAT (morx) font. HarfBuzz does NOT run the
    // OpenType Thai shaper's SARA AM decomposition here; morx ligates ก (U+0E01)
    // + ำ (U+0E33) directly into a single glyph (1195). Decomposing first would
    // wrongly yield two glyphs.
    const r = font.shapeText('กำ', { script: 'thai', language: 'th', direction: 'horizontal' })
    expect(r.map(g => g.glyphId)).toEqual([1195])
  })
})

describe.skipIf(!existsSync(TAMILMN))('morx type-5 insertion reads the insertion action offset', () => {
  it('inserts the glyph the insertionActionOffset points at, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(TAMILMN).buffer as ArrayBuffer)
    // Tamil MN's morx uses a type-5 insertion subtable. For ka (129) + O-matra
    // glyph (160), HarfBuzz's morx inserts glyph 152 (the post-base part),
    // substitutes 160→157, and reorders to [157, 129, 152]. The insertion glyph
    // list is located via the 5th header word (insertionActionOffset), NOT at a
    // fixed +16; using the wrong base inserted glyph 0 (notdef).
    const morx = (font as unknown as { tableManager: { morx: {
      applySubstitutions(g: number[], f?: unknown, rtl?: boolean): number[]
    } } }).tableManager.morx
    expect(morx.applySubstitutions([129, 160], undefined, false)).toEqual([157, 129, 152])
  })
})

describe.skipIf(!existsSync(TELUGUMN))('kerx format-4 + ankr anchor attachment resolution', () => {
  it('resolves the anchor offset the way HarfBuzz applies kerx to place the mark', () => {
    const font = Font.load(readFileSync(TELUGUMN).buffer as ArrayBuffer)
    const tm = (font as unknown as { tableManager: {
      morx: { applySubstitutionsTracked(r: { glyphs: number[], clusters: number[] }, f?: unknown, rtl?: boolean): { glyphs: number[], glyphsWithDeletions?: number[] } },
      kerx: { getAttachments(g: number[]): ReadonlyArray<{ markIndex: number, currentIndex: number, actionType: number, values: readonly number[] }> },
      ankr: { getAnchorPoints(g: number): ReadonlyArray<{ x: number, y: number }> | null },
    } }).tableManager
    // కై (ka U+0C15 + ai U+0C48): morx keeps the deleted glyph as a 0xFFFF
    // marker → [475, 65535, 712]. kerx format-4 attaches 712 to 475 via anchor
    // index 0 of each; ankr gives glyph 475 anchor (467,0) and 712 anchor (0,0).
    // With 475's advance 929, HarfBuzz places 712 at x-offset -462.
    const gids = [font.getGlyphId(0x0C15), font.getGlyphId(0x0C48)]
    const tracked = tm.morx.applySubstitutionsTracked({ glyphs: gids, clusters: [0, 1] }, undefined, false)
    const buffer = tracked.glyphsWithDeletions ?? tracked.glyphs
    const atts = tm.kerx.getAttachments(buffer)
    expect(atts.length).toBe(1)
    const att = atts[0]!
    expect(att.actionType).toBe(1)
    const markAnchor = tm.ankr.getAnchorPoints(buffer[att.markIndex]!)![att.values[0]!]!
    const currAnchor = tm.ankr.getAnchorPoints(buffer[att.currentIndex]!)![att.values[1]!]!
    // 475 advance (929) is the pen distance from the mark to the attaching glyph.
    const markAdvance = font.getAdvanceWidth(475)
    const xOffset = (0 + markAnchor.x) - (markAdvance + currAnchor.x)
    expect(xOffset).toBe(-462)
  })
})

describe.skipIf(!existsSync(ARIAL))('default-ignorable code points are hidden, not rendered as .notdef', () => {
  it('replaces an unsupported word joiner (U+2060) with a zero-advance space, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(ARIAL).buffer as ArrayBuffer)
    // Arial has no glyph for U+2060 (WORD JOINER); without default-ignorable
    // hiding it renders as .notdef (glyph 0, a tofu box). HarfBuzz replaces it
    // with the space glyph and zeroes the advance.
    const space = font.getGlyphId(0x20)
    const r = font.shapeText('A⁠B', { script: 'latn', language: 'en', direction: 'horizontal' })
    expect(r.length).toBe(3)
    expect(r[1]!.glyphId).toBe(space)
    expect(r[1]!.glyphId).not.toBe(0)
    expect(r[1]!.xAdvance).toBe(0)
  })
})

describe.skipIf(!existsSync(MALAYALAMSANGAM))('AAT kerx pair kerning ignores marks (morx path)', () => {
  it('does not apply a base–base class kern across a combining mark, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(MALAYALAMSANGAM).buffer as ArrayBuffer)
    // സ്വാ (sa + virama + va + aa) shapes to [166, 248(virama), 169(aa)]. The
    // font defines a class kern of 280 for the pair (166, 248), but 248's source
    // is the virama — a mark — which HarfBuzz's kern machine skips
    // (LookupFlag::IgnoreMarks). So glyph 166 keeps its natural advance 2240,
    // not 2520.
    const r = font.shapeText('സ്വാ', { script: 'mlym', language: 'ml', direction: 'horizontal' })
    expect(r[0]!.glyphId).toBe(166)
    expect(r[0]!.xAdvance).toBe(2240)
  })

  it('kerns across a deleted mark slot with the kern1/kern2 split, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(MALAYALAMSANGAM).buffer as ArrayBuffer)
    // ശ്രീ (sha + virama + ra + ii): morx rearranges ra+virama into the pre-base
    // form 250 stored at ra's slot (a base, Lo), leaving the virama slot deleted
    // (a nonspacing mark). HarfBuzz's kern machine — which runs before deleted
    // glyphs are removed — skips the deleted mark slot and kerns the pair
    // (250, 164) = -30, split as kern1 = -15 onto 250's advance and kern2 = -15
    // onto 164's advance and offset.
    const r = font.shapeText('ശ്രീ', { script: 'mlym', language: 'ml', direction: 'horizontal' })
    expect(r.map(g => `${g.glyphId}@${g.xOffset},${g.yOffset}+${g.xAdvance}`).join(' '))
      .toBe('250@0,0+440 164@-15,0+1744 171@0,0+546')
  })
})

describe.skipIf(!existsSync(ROHINGYA))('Hanifi Rohingya (SMP) is recognized as a cursive USE script', () => {
  it('applies USE joining forms (init/fina) to Rohingya, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(ROHINGYA).buffer as ArrayBuffer)
    // 𐴌𐴟 (RA U+10D0C + VOWEL U U+10D1F): the block (U+10D00-10D3F) was missing
    // from the USE class table, so it never reached the USE shaper and stayed in
    // isolated forms. Now RA takes its initial form and U its final — logical
    // [60, 138], the same joined pair HarfBuzz produces.
    const r = font.shapeText('𐴌𐴟', { script: 'rohg', language: 'rhg', direction: 'horizontal' })
    expect(r.map(g => g.glyphId)).toEqual([60, 138])
  })
})

describe.skipIf(!existsSync(BANGLAMN))('Indic fonts are shaped through morx (AAT), matching HarfBuzz', () => {
  it('uses morx (not GSUB) so Bangla split-O yields the pre-base form HarfBuzz produces', () => {
    const font = Font.load(readFileSync(BANGLAMN).buffer as ArrayBuffer, { fontIndex: 0 })
    // সো (sa + O-matra U+09CB): via GSUB the font yields the plain e-matra 174;
    // Apple/HarfBuzz shape through morx, which recomposes and substitutes the
    // pre-base form 214. Reordered pre-base [214, 163, 167].
    const r = font.shapeText('সো', { script: 'beng', language: 'bn', direction: 'horizontal' })
    expect(r.map(g => g.glyphId)).toEqual([214, 163, 167])
  })
})

describe.skipIf(!existsSync(TELUGUMN))('AAT Indic mark positioning via kerx (morx path)', () => {
  it('places the Telugu ai-matra by kerx format-4 anchor attachment, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(TELUGUMN).buffer as ArrayBuffer, { fontIndex: 0 })
    // కై (ka + ai U+0C48): glyph 712 is anchor-attached (kerx format-4 + ankr)
    // to glyph 475, landing at x-offset -462 — the same as HarfBuzz.
    const r = font.shapeText('కై', { script: 'telu', language: 'te', direction: 'horizontal' })
    const byGlyph = new Map<number, { xOffset: number, yOffset: number }>()
    for (const g of r) byGlyph.set(g.glyphId, { xOffset: g.xOffset, yOffset: g.yOffset })
    expect(byGlyph.get(712)).toEqual({ xOffset: -462, yOffset: 0 })
  })
})

describe.skipIf(!existsSync(DEVASANGAM))('kerx format-4 action index scaling (multi-action control table)', () => {
  it('reads the correct anchor action for a non-zero action index (Devanagari vocalic R)', () => {
    const font = Font.load(readFileSync(DEVASANGAM).buffer as ArrayBuffer, { fontIndex: 0 })
    // कृ (ka + vocalic R U+0943): glyph 1326 attaches via a kerx format-4 anchor
    // action whose index is non-zero — the action byte offset must scale by the
    // per-action field count (×4 here), or the wrong anchor indices are read.
    // HarfBuzz places 1326 at x-offset -823, y-offset 11.
    const r = font.shapeText('कृ', { script: 'deva', language: 'hi', direction: 'horizontal' })
    const mark = r.find(g => g.glyphId === 1326)!
    expect({ xOffset: mark.xOffset, yOffset: mark.yOffset }).toEqual({ xOffset: -823, yOffset: 11 })
  })
})

// _hb_apply_morx: a font that carries 'morx' is shaped through AAT for every
// script — including plain Latin — even when it ALSO has a GSUB. These Apple
// fonts keep their fi/fl/ff ligatures in morx (their GSUB does not form them),
// so preferring GSUB would drop the ligatures. Glyph ids verified with hb-shape.
describe.skipIf(!existsSync(CHALKBOARD))('morx preferred over GSUB for Latin ligatures', () => {
  it('forms fi/fl ligatures from morx (not the GSUB), matching HarfBuzz', () => {
    const font = Font.load(readFileSync(CHALKBOARD).buffer as ArrayBuffer, { fontIndex: 0 })
    const r = font.shapeText('ffi fflaffe', { script: 'latn', language: 'en', direction: 'horizontal' })
    // hb-shape: 74(f) 191(fi) 3(sp) 74(f) 192(fl) 69(a) 74(f) 74(f) 73(e).
    expect(r.map(g => g.glyphId)).toEqual([74, 191, 3, 74, 192, 69, 74, 74, 73])
  })
})

describe.skipIf(!existsSync(LUCIDAGRANDE))('morx preferred over GSUB for f-ligatures (3+ components)', () => {
  it('forms ffi/ffl/ff ligatures from morx, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(LUCIDAGRANDE).buffer as ArrayBuffer, { fontIndex: 2 })
    const r = font.shapeText('ffi fflaffe', { script: 'latn', language: 'en', direction: 'horizontal' })
    // hb-shape: 1280(ffi) 3(sp) 1281(ffl) 68(a) 1277(ff) 72(e).
    expect(r.map(g => g.glyphId)).toEqual([1280, 3, 1281, 68, 1277, 72])
  })
})

// Positioning engine is chosen independently of morx substitution: a non-Indic
// font that carries morx (so its glyphs come from AAT substitution) but also has
// GPOS is POSITIONED by GPOS, and its legacy 'kern' table is ignored (HarfBuzz
// applies kern/kerx only when there is no GPOS). Applying both would double the
// kerning. Advances verified with hb-shape.
const TRATTATELLO = '/System/Library/Fonts/Supplemental/Trattatello.ttf' // morx + GPOS + kern
describe.skipIf(!existsSync(TRATTATELLO))('GPOS positioning wins over legacy kern for a morx font', () => {
  it('kerns AVATAR via GPOS only, not the legacy kern table (no double kerning)', () => {
    const font = Font.load(readFileSync(TRATTATELLO).buffer as ArrayBuffer, { fontIndex: 0 })
    const r = font.shapeText('AVATAR', { script: 'latn', language: 'en', direction: 'horizontal' })
    // hb-shape: 34+584 55+622 34+600 53+637 34+612 51+614 (GPOS kerning, no offsets).
    expect(r.map(g => g.glyphId)).toEqual([34, 55, 34, 53, 34, 51])
    expect(r.map(g => g.xAdvance)).toEqual([584, 622, 600, 637, 612, 614])
    for (const g of r) expect(g.xOffset).toBe(0)
  })
})

// The legacy 'kern' table is a pre-GPOS fallback: HarfBuzz applies it only when
// the GPOS has no 'kern' feature. Athelas has a GPOS 'kern' feature (empty for
// T–o) AND a legacy 'kern' table that DOES carry a T–o pair; the table must be
// ignored, leaving "To" at its natural advances (verified with hb-shape).
const ATHELAS = '/System/Library/Fonts/Supplemental/Athelas.ttc' // GPOS(kern) + legacy kern + morx
describe.skipIf(!existsSync(ATHELAS))('legacy kern table ignored when GPOS kerns', () => {
  it('does not apply the legacy kern T–o pair because GPOS has a kern feature', () => {
    const font = Font.load(readFileSync(ATHELAS).buffer as ArrayBuffer, { fontIndex: 3 })
    const r = font.shapeText('To', { script: 'latn', language: 'en', direction: 'horizontal' })
    // hb-shape: 38+666 59+536 (natural; the legacy kern's T–o pair is ignored).
    expect(r.map(g => g.glyphId)).toEqual([38, 59])
    expect(r.map(g => g.xAdvance)).toEqual([666, 536])
    for (const g of r) expect(g.xOffset).toBe(0)
  })
})

// Fallback mark positioning must NOT run when GPOS positioned the run. Khmer
// Sangam MN carries morx (so substitution is AAT) AND GPOS (which positions the
// marks): centering the marks a second time would shift them by a whole base
// advance. Verified against hb-shape (all offsets 0).
const KHMERSANGAM = '/System/Library/Fonts/Supplemental/Khmer Sangam MN.ttf' // morx + GPOS
describe.skipIf(!existsSync(KHMERSANGAM))('no fallback mark centering when GPOS positions (Khmer)', () => {
  it('leaves GPOS-positioned Khmer marks unshifted, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(KHMERSANGAM).buffer as ArrayBuffer, { fontIndex: 0 })
    const r = font.shapeText('ភាសាខ្មែរ', { script: 'khmr', language: 'km', direction: 'horizontal' })
    // hb-shape: 303+1946 311+2662 180+827 115+1229 252+0 140+717, every xOffset 0.
    expect(r.map(g => g.glyphId)).toEqual([303, 311, 180, 115, 252, 140])
    expect(r.map(g => g.xAdvance)).toEqual([1946, 2662, 827, 1229, 0, 717])
    for (const g of r) expect(g.xOffset).toBe(0)
  })
})

// Thai/Lao marks are pre-positioned by their glyph outline (a negative left side
// bearing draws the mark over the preceding advanced base). HarfBuzz shapes Thai
// through its dedicated shaper, which does NO generic mark centering, so the mark
// must keep its designed position. Ayuthaya is a legacy AAT Thai font (morx, no
// GPOS/kern/kerx) that would otherwise trigger the fallback centering.
const AYUTHAYA = '/System/Library/Fonts/Supplemental/Ayuthaya.ttf' // AAT Thai, morx only
describe.skipIf(!existsSync(AYUTHAYA))('Thai marks are not fallback-centered', () => {
  it('leaves the tone mark at its outline position, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(AYUTHAYA).buffer as ArrayBuffer)
    // ที่รัก — the mai ek tone (U+0E48) sits over the base via its own negative
    // side bearing; hb-shape reports every xOffset 0 (no centering).
    const r = font.shapeText('ที่รัก', { script: 'thai', language: 'th', direction: 'horizontal' })
    expect(r.map(g => g.glyphId)).toEqual([51, 81, 98, 63, 77, 29])
    for (const g of r) expect(g.xOffset).toBe(0)
  })
})

// GDEF mark-advance zeroing is a GPOS-prep step: on the AAT (morx) path GPOS
// does not run, so marks must keep their hmtx advance (HarfBuzz does no GDEF
// zeroing there). Sinhala MN shapes through morx AND classifies the consonant
// HA (U+0DC4, glyph 164) as a GDEF mark; zeroing its advance would collapse it.
const SINHALAMN = '/System/Library/Fonts/Supplemental/Sinhala MN.ttc' // Indic morx + GDEF
describe.skipIf(!existsSync(SINHALAMN))('no GDEF advance zeroing on the morx path (Sinhala)', () => {
  it('keeps the hmtx advance of a GDEF-mark-classified consonant, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(SINHALAMN).buffer as ArrayBuffer, { fontIndex: 0 })
    const r = font.shapeText('සිංහල', { script: 'sinh', language: 'si', direction: 'horizontal' })
    // hb-shape: 444+1408 108+927 164+1478 159+1381 — HA (164) keeps advance 1478.
    expect(r.map(g => g.glyphId)).toEqual([444, 108, 164, 159])
    expect(r.map(g => g.xAdvance)).toEqual([1408, 927, 1478, 1381])
  })
})

// Fallback mark centering applies only to NONSPACING marks (zero advance). A
// spacing mark occupies its own advance box and sits after the base, so it must
// not be re-centered over the base. Songti is a morx-only Tibetan/CJK font (no
// GPOS/kern/kerx); its Tibetan vowel sign O (U+0F7C) is spacing (advance 686).
const SONGTI = '/System/Library/Fonts/Supplemental/Songti.ttc'
describe.skipIf(!existsSync(SONGTI))('spacing marks are not fallback-centered (Tibetan)', () => {
  it('leaves a spacing Tibetan vowel at its own advance, matching HarfBuzz', () => {
    const font = Font.load(readFileSync(SONGTI).buffer as ArrayBuffer, { fontIndex: 1 })
    const r = font.shapeText('བོད', { script: 'tibt', language: 'bo', direction: 'horizontal' })
    // hb-shape: 33599+495 33637+686 33594+417 — the vowel O (33637) keeps its
    // 686 advance and stays at xOffset 0 (no centering over the ba).
    expect(r.map(g => g.glyphId)).toEqual([33599, 33637, 33594])
    for (const g of r) expect(g.xOffset).toBe(0)
  })
})

// ToUnicode source-component counts for AAT-Indic (morx) fonts: a morx-formed
// conjunct must report the count of source code points it covers (not 1), and
// reordered glyphs (reph) must still sum to the source length, so PDF text
// extraction round-trips.
const DEVANAGARIMT = '/System/Library/Fonts/Supplemental/DevanagariMT.ttc' // morx-only Indic
describe.skipIf(!existsSync(DEVANAGARIMT))('AAT Indic (morx) ToUnicode component counts', () => {
  it('sums source components across a morx conjunct and reph reordering', () => {
    const font = Font.load(readFileSync(DEVANAGARIMT).buffer as ArrayBuffer, { fontIndex: 0 })
    // Each word: the per-glyph component counts must sum to the source length.
    for (const text of ['नमस्ते', 'क्ष', 'श्री', 'कर्म']) {
      const r = font.shapeText(text, { script: 'deva', language: 'hi', direction: 'horizontal' })
      const sum = r.reduce((a, g) => a + g.componentCount, 0)
      expect(sum, text).toBe([...text].length)
    }
  })

  it('gives a three-source conjunct componentCount 3 (क्ष = KA+VIRAMA+SSA)', () => {
    const font = Font.load(readFileSync(DEVANAGARIMT).buffer as ArrayBuffer, { fontIndex: 0 })
    const r = font.shapeText('क्ष', { script: 'deva', language: 'hi', direction: 'horizontal' })
    expect(r).toHaveLength(1)
    expect(r[0]!.componentCount).toBe(3)
  })
})
