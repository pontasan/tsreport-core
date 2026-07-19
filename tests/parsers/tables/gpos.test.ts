import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../../src/index.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { buildCompactGposTable, parseGpos } from '../../../src/parsers/tables/gpos.js'
import { parseGsub } from '../../../src/parsers/tables/gsub.js'
import { parseGdef } from '../../../src/parsers/tables/gdef.js'

const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const SOURCE_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/SourceSans3-Regular.otf')

describe('GPOS テーブル', () => {
  describe('PairPos カーニング', () => {
    // Verifies that GPOS PairPos yields the expected negative kerning for the classic "AV" pair in Roboto.
    it('Roboto で "AV" に負のカーニングが存在する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)
      expect(aGid).toBeGreaterThan(0)
      expect(vGid).toBeGreaterThan(0)

      const kerning = font.getKerning(aGid, vGid)
      // "AV" typically has negative kerning
      expect(kerning).toBeLessThan(0)
    })

    // Verifies negative kerning for an uppercase/lowercase pair ("To"), exercising a different class pairing.
    it('Roboto で "To" にカーニングが存在する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const tGid = font.getGlyphId('T'.codePointAt(0)!)
      const oGid = font.getGlyphId('o'.codePointAt(0)!)

      const kerning = font.getKerning(tGid, oGid)
      // "To" also typically has negative kerning
      expect(kerning).toBeLessThan(0)
    })

    // Verifies that getKerning returns 0 for a pair ("HI") with no kerning entry.
    it('カーニングのないペアは 0 を返す', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const hGid = font.getGlyphId('H'.codePointAt(0)!)
      const iGid = font.getGlyphId('I'.codePointAt(0)!)

      const kerning = font.getKerning(hGid, iGid)
      // "HI" normally needs no kerning
      expect(kerning).toBe(0)
    })
    // Real-font oracle: exact XAdvance values read from Roboto's GPOS kern
    // feature via fontTools. An exhaustive sweep of all Format 1 pairs across
    // Roboto (1794), NotoSans (1026) and SourceSans3 (2293) matched fontTools;
    // this pins a representative subset.
    it('Roboto のカーニング値が fontTools と一致する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      const gid = (ch: string): number => font.getGlyphId(ch.codePointAt(0)!)
      expect(font.getKerning(gid('A'), gid('V'))).toBe(-87)
      expect(font.getKerning(gid('T'), gid('o'))).toBe(-99)
      expect(font.getKerning(gid('T'), gid('a'))).toBe(-113)
      expect(font.getKerning(gid('Y'), gid('o'))).toBe(-65)
      expect(font.getKerning(gid('L'), gid('T'))).toBe(-275)
      expect(font.getKerning(gid('P'), gid(','))).toBe(-324)
    })

    // A zero-value Format 1 pair is a lookup match per OpenType (subtable
    // iteration stops), so it deliberately overrides a class kern in a later
    // subtable of the same lookup. SourceSans3 gids (401, 1467) carry an
    // explicit 0 in subtable 0 while the class subtable 10 would give 60;
    // the correct result is 0 (fontTools agrees).
    it('明示的な値0の Format 1 ペアが後続クラスカーニングを上書きする', () => {
      const font = Font.load(readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer)
      expect(font.getKerning(401, 1467)).toBe(0)
      expect(font.getKerning(799, 1004)).toBe(0)
    })
  })

  describe('getPositionAdjustments()', () => {
    // Verifies that shapeText applies GPOS kerning: the shaped 'A' xAdvance is smaller than its raw advance width.
    it('Roboto で "AV" の位置調整を取得できる', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('AV')
      expect(shaped.length).toBe(2)

      // Kerning is applied to the xAdvance of 'A'
      const aAdvance = shaped[0]!.xAdvance
      const aWidth = font.getAdvanceWidth(shaped[0]!.glyphId)

      // Kerning should make xAdvance smaller than advanceWidth
      expect(aAdvance).toBeLessThan(aWidth)
    })

    // Verifies that shapeText is deterministic: repeated calls yield identical glyph IDs and positioning.
    it('shapeText の結果が一貫性を持つ', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const text = 'Testing'
      const shaped1 = font.shapeText(text)
      const shaped2 = font.shapeText(text)

      expect(shaped1.length).toBe(shaped2.length)
      for (let i = 0; i < shaped1.length; i++) {
        expect(shaped1[i]!.glyphId).toBe(shaped2[i]!.glyphId)
        expect(shaped1[i]!.xAdvance).toBe(shaped2[i]!.xAdvance)
        expect(shaped1[i]!.xOffset).toBe(shaped2[i]!.xOffset)
        expect(shaped1[i]!.yOffset).toBe(shaped2[i]!.yOffset)
      }
    })
  })

  describe('PairPos Format 2 class 0 (regression)', () => {
    // Regression: PairPos Format 2 must treat glyphs absent from ClassDef as class 0 so their kerning still applies.
    it('getKerning should work for glyphs not in ClassDef (class 0)', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // "AV" kerning must work regardless of whether glyphs are in ClassDef
      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)
      const kerning = font.getKerning(aGid, vGid)
      expect(kerning).toBeLessThan(0)

      // Also verify via shapeText — uses applyPairPos with classData fallback
      const shaped = font.shapeText('AV')
      expect(shaped[0]!.xAdvance).toBeLessThan(font.getAdvanceWidth(aGid))
    })
  })

  describe('PairPos Format 1 value2', () => {
    function emptyFormat2SinglePosGpos(): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(10); w.writeUint16(30); w.writeUint16(44)
      w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
      w.writeUint16(4); w.writeUint16(0)
      w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(1); w.writeTag('kern'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(1); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      w.writeUint16(2); w.writeUint16(8); w.writeUint16(0x0004); w.writeUint16(0)
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      return w.toUint8Array()
    }

    it('materializes an empty variable SinglePos branch as an empty no-op lookup', () => {
      const source = emptyFormat2SinglePosGpos()
      const parsed = parseGpos(new BinaryReader(source.buffer as ArrayBuffer))
      expect(parsed.getPositionAdjustments([2], null, null, new Set(['kern']))[0]!.xAdvance).toBe(0)
      const rebuilt = buildCompactGposTable(
        new BinaryReader(source.buffer as ArrayBuffer),
        new Map([[0, 0], [1, 1], [2, 2]]),
      )
      const rebuiltGpos = parseGpos(new BinaryReader(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength))
      expect(rebuiltGpos.getPositionAdjustments([2], null, null, new Set(['kern']))[0]!.xAdvance).toBe(0)
    })

    function featureVariationSinglePosGpos(): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(1)
      w.writeUint16(14) // ScriptList
      w.writeUint16(34) // FeatureList
      w.writeUint16(48) // LookupList
      w.writeUint32(98) // FeatureVariations
      // ScriptList @14: DFLT script.
      w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
      // Script @22 and DefaultLangSys @26.
      w.writeUint16(4); w.writeUint16(0)
      w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(1); w.writeUint16(0)
      // FeatureList @34: kern -> lookup 0 by default.
      w.writeUint16(1); w.writeTag('kern'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @48: lookup 0 applies -10, lookup 1 applies -40.
      w.writeUint16(2); w.writeUint16(6); w.writeUint16(28)
      w.writeUint16(1); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      w.writeUint16(1); w.writeUint16(8); w.writeUint16(0x0004); w.writeInt16(-10)
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      w.writeUint16(1); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      w.writeUint16(1); w.writeUint16(8); w.writeUint16(0x0004); w.writeInt16(-40)
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      // FeatureVariations @98: axis 0 in [0.5, 1.0] replaces feature 0 with lookup 1.
      w.writeUint16(1); w.writeUint16(0); w.writeUint32(1)
      w.writeUint32(16); w.writeUint32(30)
      w.writeUint16(1); w.writeUint32(6)
      w.writeUint16(1); w.writeUint16(0); w.writeInt16(8192); w.writeInt16(16384)
      w.writeUint16(1); w.writeUint16(0); w.writeUint16(1)
      w.writeUint16(0); w.writeUint32(12)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(1)
      return w.toUint8Array()
    }

    it('applies alternate Feature tables from GPOS FeatureVariations', () => {
      const gpos = parseGpos(new BinaryReader(featureVariationSinglePosGpos().buffer as ArrayBuffer), 1)

      expect(gpos.getPositionAdjustments([2], null, null, new Set(['kern']), null)[0]!.xAdvance).toBe(-10)
      expect(gpos.getPositionAdjustments([2], null, null, new Set(['kern']), null, null, 'ltr', null, [0])[0]!.xAdvance).toBe(-10)
      expect(gpos.getPositionAdjustments([2], null, null, new Set(['kern']), null, null, 'ltr', null, [0.75])[0]!.xAdvance).toBe(-40)
    })

    it('materializes GPOS FeatureVariations when building a static instance', () => {
      const source = featureVariationSinglePosGpos()
      const rebuilt = buildCompactGposTable(
        new BinaryReader(source.buffer as ArrayBuffer),
        new Map([[0, 0], [1, 1], [2, 2]]),
        { coords: [0.75], gdef: null },
        1,
      )
      const view = new DataView(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength)
      expect(view.getUint16(2, false)).toBe(0)
      const gpos = parseGpos(new BinaryReader(rebuilt.buffer.slice(
        rebuilt.byteOffset,
        rebuilt.byteOffset + rebuilt.byteLength,
      ) as ArrayBuffer))
      expect(gpos.getPositionAdjustments([2], null, null, new Set(['kern']))[0]!.xAdvance).toBe(-40)
    })

    function pairPosValue2Gpos(): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(10) // ScriptList
      w.writeUint16(30) // FeatureList
      w.writeUint16(44) // LookupList
      // ScriptList @10: DFLT script.
      w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
      // Script @18 and DefaultLangSys @22.
      w.writeUint16(4); w.writeUint16(0)
      w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(1); w.writeUint16(0)
      // FeatureList @30: kern -> lookup 0.
      w.writeUint16(1); w.writeTag('kern'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(2); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      // PairPos format 1 @56. Coverage order maps PairSet 0 to glyph 1 and PairSet 1 to glyph 2.
      w.writeUint16(1); w.writeUint16(30); w.writeUint16(0x0004); w.writeUint16(0x0001)
      w.writeUint16(2); w.writeUint16(14); w.writeUint16(22)
      // PairSet for glyph 1: pair 1+2 applies v1.xAdvance and v2.xPlacement.
      w.writeUint16(1); w.writeUint16(2); w.writeInt16(-20); w.writeInt16(30)
      // PairSet for glyph 2: would apply to 2+3 only if glyph 2 were not consumed by value2 above.
      w.writeUint16(1); w.writeUint16(3); w.writeInt16(-50); w.writeInt16(70)
      // Coverage table @86.
      w.writeUint16(1); w.writeUint16(2); w.writeUint16(1); w.writeUint16(2)
      return w.toUint8Array()
    }

    it('applies value2 to the second glyph and consumes that glyph for pair iteration', () => {
      const gpos = parseGpos(new BinaryReader(pairPosValue2Gpos().buffer as ArrayBuffer))
      const adjustments = gpos.getPositionAdjustments([1, 2, 3], null, null, null, null)

      expect(adjustments[0]!.xAdvance).toBe(-20)
      expect(adjustments[1]!.xPlacement).toBe(30)
      expect(adjustments[1]!.xAdvance).toBe(0)
      expect(adjustments[2]!.xPlacement).toBe(0)
    })
  })

  describe('PairPos Format 2 value2', () => {
    function pairPosClassValue2Gpos(): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(10) // ScriptList
      w.writeUint16(30) // FeatureList
      w.writeUint16(44) // LookupList
      // ScriptList @10: DFLT script.
      w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
      // Script @18 and DefaultLangSys @22.
      w.writeUint16(4); w.writeUint16(0)
      w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(1); w.writeUint16(0)
      // FeatureList @30: kern -> lookup 0.
      w.writeUint16(1); w.writeTag('kern'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(2); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      // PairPos format 2 @56: 2x2 class matrix with v1.xAdvance and v2.xPlacement.
      w.writeUint16(2); w.writeUint16(32); w.writeUint16(0x0004); w.writeUint16(0x0001)
      w.writeUint16(40); w.writeUint16(50); w.writeUint16(2); w.writeUint16(2)
      // Class1 0 + Class2 0 applies to glyphs 1+2.
      w.writeInt16(-11); w.writeInt16(21)
      w.writeInt16(0); w.writeInt16(0)
      w.writeInt16(0); w.writeInt16(0)
      // Class1 1 + Class2 1 would apply to glyphs 2+3 if glyph 2 were not consumed.
      w.writeInt16(-50); w.writeInt16(70)
      // Coverage table @88: glyphs 1 and 2 may start pairs.
      w.writeUint16(1); w.writeUint16(2); w.writeUint16(1); w.writeUint16(2)
      // ClassDef1 @96: glyph 1 -> class 0, glyph 2 -> class 1.
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2); w.writeUint16(0); w.writeUint16(1)
      // ClassDef2 @106: glyph 2 -> class 0, glyph 3 -> class 1.
      w.writeUint16(1); w.writeUint16(2); w.writeUint16(2); w.writeUint16(0); w.writeUint16(1)
      return w.toUint8Array()
    }

    it('applies class-pair value2 and consumes the second glyph for pair iteration', () => {
      const gpos = parseGpos(new BinaryReader(pairPosClassValue2Gpos().buffer as ArrayBuffer))
      const adjustments = gpos.getPositionAdjustments([1, 2, 3], null, null, null, null)

      expect(adjustments[0]!.xAdvance).toBe(-11)
      expect(adjustments[1]!.xPlacement).toBe(21)
      expect(adjustments[1]!.xAdvance).toBe(0)
      expect(adjustments[2]!.xPlacement).toBe(0)
    })
  })

  describe('Mark positioning', () => {
    // Smoke test: shaping a combining-mark sequence ('à') runs the mark positioning path without failing.
    it('NotoSans でマーク位置調整が取得できる', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // Shape an accented character (combining marks)
      const shaped = font.shapeText('à')
      expect(shaped.length).toBeGreaterThan(0)
    })
  })

  describe('MarkLigPos component anchors', () => {
    function gdefForLigatureMarks(): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(12); w.writeUint16(0); w.writeUint16(0); w.writeUint16(0)
      // ClassDef format 2: f/i base, fi ligature, acute mark.
      w.writeUint16(2); w.writeUint16(3)
      w.writeUint16(1); w.writeUint16(2); w.writeUint16(1)
      w.writeUint16(12); w.writeUint16(12); w.writeUint16(2)
      w.writeUint16(100); w.writeUint16(100); w.writeUint16(3)
      return w.toUint8Array()
    }

    function ligatureAcrossMarksGsub(): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(10) // ScriptList
      w.writeUint16(30) // FeatureList
      w.writeUint16(44) // LookupList
      // ScriptList @10: DFLT script.
      w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
      // Script @18 and DefaultLangSys @22.
      w.writeUint16(4); w.writeUint16(0)
      w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(1); w.writeUint16(0)
      // FeatureList @30: liga -> lookup 0.
      w.writeUint16(1); w.writeTag('liga'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(4); w.writeUint16(0x0008); w.writeUint16(1); w.writeUint16(8)
      // LigatureSubst format 1 @56: glyph 1 + glyph 2 -> glyph 12, skipping marks.
      w.writeUint16(1); w.writeUint16(18); w.writeUint16(1); w.writeUint16(8)
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(12); w.writeUint16(2); w.writeUint16(2)
      // Coverage table @74.
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(1)
      return w.toUint8Array()
    }

    function markLigatureComponentGpos(): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(10) // ScriptList
      w.writeUint16(30) // FeatureList
      w.writeUint16(44) // LookupList
      // ScriptList @10: DFLT script.
      w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
      // Script @18 and DefaultLangSys @22.
      w.writeUint16(4); w.writeUint16(0)
      w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(1); w.writeUint16(0)
      // FeatureList @30: mark -> lookup 0.
      w.writeUint16(1); w.writeTag('mark'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(5); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      // MarkLigPos format 1 @56: one mark class, one ligature, two components.
      w.writeUint16(1); w.writeUint16(46); w.writeUint16(52); w.writeUint16(1)
      w.writeUint16(12); w.writeUint16(24)
      // MarkArray @68: glyph 100 has a zero mark anchor.
      w.writeUint16(1); w.writeUint16(0); w.writeUint16(6)
      w.writeUint16(1); w.writeInt16(0); w.writeInt16(0)
      // LigatureArray @80 and LigatureAttach @84.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(2); w.writeUint16(6); w.writeUint16(12)
      // Component 0 anchor @90, component 1 anchor @96.
      w.writeUint16(1); w.writeInt16(100); w.writeInt16(200)
      w.writeUint16(1); w.writeInt16(300); w.writeInt16(400)
      // Coverage tables @102 and @108.
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(100)
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(12)
      return w.toUint8Array()
    }

    it('attaches consecutive marks to consecutive ligature components', () => {
      const gpos = parseGpos(new BinaryReader(markLigatureComponentGpos().buffer as ArrayBuffer))
      const adjustments = gpos.getPositionAdjustments(
        [12, 100, 100],
        null,
        null,
        null,
        new Map([[0, 2]]),
      )

      expect(adjustments[1]!.xPlacement).toBe(100)
      expect(adjustments[1]!.yPlacement).toBe(200)
      expect(adjustments[2]!.xPlacement).toBe(300)
      expect(adjustments[2]!.yPlacement).toBe(400)
    })

    it('uses GSUB ligature mark component metadata instead of counting marks', () => {
      const gdef = parseGdef(new BinaryReader(gdefForLigatureMarks().buffer as ArrayBuffer))
      const gsub = parseGsub(new BinaryReader(ligatureAcrossMarksGsub().buffer as ArrayBuffer))
      const substituted = gsub.applySubstitutionsWithMetadata(
        [1, 100, 100, 2],
        new Set(['liga']),
        null,
        null,
        gdef,
      )

      expect(substituted.glyphIds).toEqual([12, 100, 100])
      expect(substituted.ligatureMarkComponents?.get(1)).toBe(0)
      expect(substituted.ligatureMarkComponents?.get(2)).toBe(0)

      const gpos = parseGpos(new BinaryReader(markLigatureComponentGpos().buffer as ArrayBuffer))
      const adjustments = gpos.getPositionAdjustments(
        substituted.glyphIds,
        null,
        null,
        null,
        new Map([[0, 2]]),
        gdef,
        'ltr',
        null,
        null,
        undefined,
        substituted.ligatureMarkComponents,
      )

      expect(adjustments[1]!.xPlacement).toBe(100)
      expect(adjustments[1]!.yPlacement).toBe(200)
      expect(adjustments[2]!.xPlacement).toBe(100)
      expect(adjustments[2]!.yPlacement).toBe(200)
    })
  })

  describe('ExtensionPos', () => {
    function extensionSinglePosGpos(extensionFormat = 1, extensionLookupType = 1): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(10) // ScriptList
      w.writeUint16(30) // FeatureList
      w.writeUint16(44) // LookupList
      // ScriptList @10: DFLT script.
      w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
      // Script @18 and DefaultLangSys @22.
      w.writeUint16(4); w.writeUint16(0)
      w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(1); w.writeUint16(0)
      // FeatureList @30: kern -> lookup 0.
      w.writeUint16(1); w.writeTag('kern'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(9); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      // ExtensionPos format 1 @56 wrapping SinglePos @64.
      w.writeUint16(extensionFormat); w.writeUint16(extensionLookupType); w.writeUint32(8)
      // SinglePos format 1 @64: xPlacement -40 for glyph 2.
      w.writeUint16(1); w.writeUint16(8); w.writeUint16(0x0001); w.writeInt16(-40)
      // Coverage table @72.
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      return w.toUint8Array()
    }

    function inconsistentExtensionPosGpos(): Uint8Array {
      const w = new BinaryWriter()
      w.writeUint16(1); w.writeUint16(0)
      w.writeUint16(10) // ScriptList
      w.writeUint16(30) // FeatureList
      w.writeUint16(44) // LookupList
      // ScriptList @10: DFLT script.
      w.writeUint16(1); w.writeTag('DFLT'); w.writeUint16(8)
      // Script @18 and DefaultLangSys @22.
      w.writeUint16(4); w.writeUint16(0)
      w.writeUint16(0); w.writeUint16(0xFFFF); w.writeUint16(1); w.writeUint16(0)
      // FeatureList @30: kern -> lookup 0.
      w.writeUint16(1); w.writeTag('kern'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(9); w.writeUint16(0); w.writeUint16(2); w.writeUint16(10); w.writeUint16(18)
      // Two ExtensionPos subtables @58 and @66 with different extensionLookupType values.
      w.writeUint16(1); w.writeUint16(1); w.writeUint32(16)
      w.writeUint16(1); w.writeUint16(2); w.writeUint32(8)
      // SinglePos format 1 @74: xPlacement -40 for glyph 2.
      w.writeUint16(1); w.writeUint16(8); w.writeUint16(0x0001); w.writeInt16(-40)
      // Coverage table @82.
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      return w.toUint8Array()
    }

    it('applies a SinglePos lookup through an ExtensionPos wrapper', () => {
      const gpos = parseGpos(new BinaryReader(extensionSinglePosGpos().buffer as ArrayBuffer))
      const adjustments = gpos.getPositionAdjustments([2], null, null, null, null)
      expect(adjustments[0]!.xPlacement).toBe(-40)
    })

    it('rejects ExtensionPos formats other than 1', () => {
      expect(() => parseGpos(new BinaryReader(extensionSinglePosGpos(2).buffer as ArrayBuffer))).toThrow(
        'Unsupported ExtensionPos format: 2',
      )
    })

    it('rejects ExtensionPos references to lookup type 9', () => {
      expect(() => parseGpos(new BinaryReader(extensionSinglePosGpos(1, 9).buffer as ArrayBuffer))).toThrow(
        'ExtensionPos extensionLookupType must not be 9',
      )
    })

    it('rejects mixed extensionLookupType values in one ExtensionPos lookup', () => {
      expect(() => parseGpos(new BinaryReader(inconsistentExtensionPosGpos().buffer as ArrayBuffer))).toThrow(
        'GPOS ExtensionPos subtables must use the same extensionLookupType: 1 != 2',
      )
    })
  })
})
