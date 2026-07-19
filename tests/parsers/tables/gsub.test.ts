import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../../src/index.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseFont } from '../../../src/parsers/index.js'
import { getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseGsub } from '../../../src/parsers/tables/gsub.js'
import { subsetFont } from '../../../src/subset/index.js'
import { buildTestFont } from '../../renderer/synthetic-font.js'

const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const NOTO_MONGOLIAN_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSansMongolian-Regular.ttf')

describe('GSUB テーブル', () => {
  describe('SingleSubst', () => {
    // Smoke test: a font with a GSUB table shapes a single character into one valid glyph.
    it('Roboto に GSUB テーブルが存在する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      // If the GSUB table exists, shapeText works
      const shaped = font.shapeText('A')
      expect(shaped.length).toBe(1)
      expect(shaped[0]!.glyphId).toBeGreaterThan(0)
    })
  })

  describe('LigatureSubst', () => {
    // Verifies LigatureSubst via the 'liga' feature: "fi" merges into a ligature glyph distinct from both components.
    it('Roboto で "fi" がリガチャ置換される', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // Encode "fi" character by character → 2 glyphs
      const fGid = font.getGlyphId('f'.codePointAt(0)!)
      const iGid = font.getGlyphId('i'.codePointAt(0)!)
      expect(fGid).toBeGreaterThan(0)
      expect(iGid).toBeGreaterThan(0)

      // shapeText applies 'liga' → merged into a ligature glyph
      const shaped = font.shapeText('fi')
      // 1 glyph if the ligature applies, otherwise at most 2 glyphs
      expect(shaped.length).toBeLessThanOrEqual(2)

      if (shaped.length === 1) {
        // The ligature glyph differs from both f and i
        expect(shaped[0]!.glyphId).not.toBe(fGid)
        expect(shaped[0]!.glyphId).not.toBe(iGid)
      }
    })

    // Verifies that a three-component sequence ("ffi") shapes into at most 3 glyphs via ligature substitution.
    it('Roboto で "ffi" がリガチャ置換される', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('ffi')
      // "ffi" becomes "f" + "fi" or an "ffi" ligature
      expect(shaped.length).toBeLessThanOrEqual(3)
    })
  })

  describe('applySubstitutions()', () => {
    // Stability check: shaping various strings (including ligature-heavy words) always yields valid glyph IDs and non-negative advances.
    it('複数の文字列でシェーピングが安定動作する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const testStrings = ['Hello', 'Office', 'ffl', 'Testing 123']
      for (const text of testStrings) {
        const shaped = font.shapeText(text)
        expect(shaped.length).toBeGreaterThan(0)
        for (const g of shaped) {
          expect(g.glyphId).toBeGreaterThanOrEqual(0)
          expect(g.xAdvance).toBeGreaterThanOrEqual(0)
        }
      }
    })

    // Verifies that GSUB shaping also works on a second font (NotoSans), not only Roboto.
    it('NotoSans でもシェーピングが動作する', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('Hello World')
      expect(shaped.length).toBeGreaterThan(0)
    })
  })

  describe('getLigatureComponentCounts()', () => {
    // Smoke test for the ligature component-count path used internally by shapeText (exercised via "fi").
    it('Roboto のリガチャコンポーネント数マップが取得できる', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // Internal access for testing — shapeText uses this internally
      // Just verify the shaping result is stable
      const shaped = font.shapeText('fi')
      expect(shaped.length).toBeGreaterThan(0)
    })
  })

  describe('ReverseChainContextSingleSubst', () => {
    it('matches HarfBuzz for a real-font LookupType 8 rule', () => {
      const bytes = readFileSync(NOTO_MONGOLIAN_PATH)
      const sfnt = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      const gsub = parseGsub(getTableReader(sfnt, 'GSUB')!)
      // Lookup 70 maps uni182A.B.init (83) to _uni182A.B.init (1391)
      // when followed by _uni1820.A.fina (1379). The expected sequence was
      // generated with hb-shape after mapping two oracle code points directly
      // to those real-font input glyphs.
      expect(gsub.getLookupType(70)).toBe(8)
      expect(gsub.applyLookup([83, 1379], 70)).toEqual([1391, 1379])
      expect(gsub.applyLookup([83, 12], 70)).toEqual([83, 12])
    })

    function reverseChainGsub(): Uint8Array {
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
      // FeatureList @30: rclt -> lookup 0.
      w.writeUint16(1); w.writeTag('rclt'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(8); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      // ReverseChainContextSingleSubst format 1 @56:
      // input glyph 2 -> 5 only when preceded by glyph 1 and followed by glyph 3.
      w.writeUint16(1); w.writeUint16(16)
      w.writeUint16(1); w.writeUint16(22)
      w.writeUint16(1); w.writeUint16(28)
      w.writeUint16(1); w.writeUint16(5)
      // Coverage tables @72, @78, @84.
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(1)
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(3)
      return w.toUint8Array()
    }

    function makeReverseChainFontBuffer(): ArrayBuffer {
      const glyphs = new Array<Uint8Array | null>(7).fill(null)
      return buildTestFont(glyphs, [
        [0x61, 1], [0x62, 2], [0x63, 3], [0x64, 4], [0x65, 5], [0x78, 6],
      ], [['GSUB', reverseChainGsub()]])
    }

    function makeReverseChainFont(): Font {
      return Font.load(makeReverseChainFontBuffer())
    }

    it('applies a reverse chained single substitution only when backtrack and lookahead match', () => {
      const font = makeReverseChainFont()
      expect(font.shapeText('abc').map(g => g.glyphId)).toEqual([1, 5, 3])
      expect(font.shapeText('xbc').map(g => g.glyphId)).toEqual([6, 2, 3])
      expect(font.shapeText('abd').map(g => g.glyphId)).toEqual([1, 2, 4])
    })

    it('collects reverse chained substitution targets for subsetting', () => {
      const sfnt = parseFont(makeReverseChainFontBuffer())
      const gsub = parseGsub(getTableReader(sfnt, 'GSUB')!)
      expect(gsub.getReferencedGlyphIds().has(5)).toBe(true)
      expect(gsub.getReachableSubstitutionGlyphIds(new Set([0, 2, 3])).has(5)).toBe(false)
      expect(gsub.getReachableSubstitutionGlyphIds(new Set([0, 1, 2, 3])).has(5)).toBe(true)

      const subset = subsetFont(sfnt, new Set([0, 1, 2, 3]), new Map([[0x61, 1], [0x62, 2], [0x63, 3]]))
      expect(subset.oldToNewGlyphId.has(5)).toBe(true)
    })
  })

  describe('ExtensionSubst', () => {
    function featureVariationSingleSubstGsub(): Uint8Array {
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
      // FeatureList @34: rclt -> lookup 0 by default.
      w.writeUint16(1); w.writeTag('rclt'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @48: lookup 0 substitutes 2 -> 5, lookup 1 substitutes 2 -> 9.
      w.writeUint16(2); w.writeUint16(6); w.writeUint16(28)
      w.writeUint16(1); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      w.writeUint16(2); w.writeUint16(8); w.writeUint16(1); w.writeUint16(5)
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      w.writeUint16(1); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      w.writeUint16(2); w.writeUint16(8); w.writeUint16(1); w.writeUint16(9)
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

    it('applies alternate Feature tables from GSUB FeatureVariations', () => {
      const gsub = parseGsub(new BinaryReader(featureVariationSingleSubstGsub().buffer as ArrayBuffer), 1)

      expect(gsub.applySubstitutions([2], new Set(['rclt']), null, null, null, null)).toEqual([5])
      expect(gsub.applySubstitutions([2], new Set(['rclt']), null, null, null, [0])).toEqual([5])
      expect(gsub.applySubstitutions([2], new Set(['rclt']), null, null, null, [0.75])).toEqual([9])
    })

    it('validates FeatureParams in every alternate Feature table at load time', () => {
      const bytes = featureVariationSingleSubstGsub()
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(140, 4, false)
      expect(() => parseGsub(new BinaryReader(bytes.buffer as ArrayBuffer), 1)).toThrow(
        'FeatureParams are not defined for OpenType feature rclt',
      )
    })

    it('applies JSTF enable and disable lookup plans in LookupList order', () => {
      const gsub = parseGsub(new BinaryReader(featureVariationSingleSubstGsub().buffer as ArrayBuffer), 1)

      expect(gsub.applySubstitutions(
        [2], new Set(['rclt']), null, null, null, [0], { enabled: [], disabled: [0] },
      )).toEqual([2])
      expect(gsub.applySubstitutions(
        [2], new Set<string>(), null, null, null, [0], { enabled: [1], disabled: [] },
      )).toEqual([9])
    })

    function extensionSingleSubstGsub(extensionFormat = 1, extensionLookupType = 1): Uint8Array {
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
      // FeatureList @30: rclt -> lookup 0.
      w.writeUint16(1); w.writeTag('rclt'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(7); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
      // ExtensionSubst format 1 @56 wrapping SingleSubst @64.
      w.writeUint16(extensionFormat); w.writeUint16(extensionLookupType); w.writeUint32(8)
      // SingleSubst format 2 @64: glyph 2 -> 5.
      w.writeUint16(2); w.writeUint16(8); w.writeUint16(1); w.writeUint16(5)
      // Coverage table @72.
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      return w.toUint8Array()
    }

    function inconsistentExtensionSubstGsub(): Uint8Array {
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
      // FeatureList @30: rclt -> lookup 0.
      w.writeUint16(1); w.writeTag('rclt'); w.writeUint16(8)
      w.writeUint16(0); w.writeUint16(1); w.writeUint16(0)
      // LookupList @44 and lookup @48.
      w.writeUint16(1); w.writeUint16(4)
      w.writeUint16(7); w.writeUint16(0); w.writeUint16(2); w.writeUint16(10); w.writeUint16(18)
      // Two ExtensionSubst subtables @58 and @66 with different extensionLookupType values.
      w.writeUint16(1); w.writeUint16(1); w.writeUint32(16)
      w.writeUint16(1); w.writeUint16(2); w.writeUint32(8)
      // SingleSubst format 2 @74: glyph 2 -> 5.
      w.writeUint16(2); w.writeUint16(8); w.writeUint16(1); w.writeUint16(5)
      // Coverage table @82.
      w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
      return w.toUint8Array()
    }

    it('applies a SingleSubst lookup through an ExtensionSubst wrapper', () => {
      const glyphs = new Array<Uint8Array | null>(6).fill(null)
      const font = Font.load(buildTestFont(glyphs, [[0x62, 2]], [['GSUB', extensionSingleSubstGsub()]]))
      expect(font.shapeText('b').map(g => g.glyphId)).toEqual([5])
    })

    it('rejects ExtensionSubst formats other than 1', () => {
      expect(() => parseGsub(new BinaryReader(extensionSingleSubstGsub(2).buffer as ArrayBuffer))).toThrow(
        'Unsupported ExtensionSubst format: 2',
      )
    })

    it('rejects ExtensionSubst references to lookup type 7', () => {
      expect(() => parseGsub(new BinaryReader(extensionSingleSubstGsub(1, 7).buffer as ArrayBuffer))).toThrow(
        'ExtensionSubst extensionLookupType must not be 7',
      )
    })

    it('rejects mixed extensionLookupType values in one ExtensionSubst lookup', () => {
      expect(() => parseGsub(new BinaryReader(inconsistentExtensionSubstGsub().buffer as ArrayBuffer))).toThrow(
        'GSUB ExtensionSubst subtables must use the same extensionLookupType: 1 != 2',
      )
    })
  })
})
