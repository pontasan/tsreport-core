import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, BinaryReader, PathCommand } from '../../src/index.js'
import { parseCff, parseCffReal } from '../../src/parsers/cff-parser.js'
import { parseSfntDirectory, getTableReader } from '../../src/parsers/sfnt-parser.js'
import { PATH_COMMAND_COORDS } from '../../src/types/glyph.js'
import { encodeDictReal } from '../../src/subset/cff-subset.js'

const NOTO_SANS_JP_PATH = resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')
const SOURCE_SANS_PATH = resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf')
const STIX_MATH_PATH = resolve(__dirname, '../fixtures/fonts/STIXTwoMath-Regular.otf')

// --- Helper: load font from file path ---
function loadFont(path: string): Font {
  const buffer = readFileSync(path).buffer as ArrayBuffer
  return Font.load(buffer)
}

// --- Helper: subset and reload ---
function subsetAndReload(font: Font, text: string): Font {
  const subsetBuffer = font.subset(text)
  return Font.load(subsetBuffer)
}

// --- Helper: exact outline comparison ---
function expectOutlineMatch(original: Font, subset: Font, codePoint: number) {
  const origGlyph = original.getGlyphByCodePoint(codePoint)
  const subGlyph = subset.getGlyphByCodePoint(codePoint)

  expect(subGlyph.outline.commands.length, `commands.length mismatch for U+${codePoint.toString(16).toUpperCase()}`).toBe(origGlyph.outline.commands.length)
  expect(subGlyph.outline.coords.length, `coords.length mismatch for U+${codePoint.toString(16).toUpperCase()}`).toBe(origGlyph.outline.coords.length)

  // Compare each command byte
  for (let i = 0; i < origGlyph.outline.commands.length; i++) {
    expect(subGlyph.outline.commands[i], `command[${i}] mismatch for U+${codePoint.toString(16).toUpperCase()}`).toBe(origGlyph.outline.commands[i])
  }

  // Compare each coordinate with tolerance for floating point
  for (let i = 0; i < origGlyph.outline.coords.length; i++) {
    expect(subGlyph.outline.coords[i], `coord[${i}] mismatch for U+${codePoint.toString(16).toUpperCase()}`).toBeCloseTo(origGlyph.outline.coords[i]!, 2)
  }

  expect(subGlyph.advanceWidth, `advanceWidth mismatch for U+${codePoint.toString(16).toUpperCase()}`).toBe(origGlyph.advanceWidth)
}

// --- Helper: verify command/coord alignment for a glyph ---
function expectCommandCoordAlignment(font: Font, codePoint: number) {
  const glyph = font.getGlyphByCodePoint(codePoint)
  const { commands, coords } = glyph.outline

  let expectedCoords = 0
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    const count = PATH_COMMAND_COORDS[cmd as PathCommand]
    expect(count, `Unknown command type ${cmd} at index ${i}`).toBeDefined()
    expectedCoords += count
  }

  expect(coords.length, `coord count mismatch for U+${codePoint.toString(16).toUpperCase()}`).toBe(expectedCoords)
}

// --- Helper: iterate code points in a string ---
function codePointsOf(text: string): number[] {
  const result: number[] = []
  for (const char of text) {
    result.push(char.codePointAt(0)!)
  }
  return result
}

function toContiguousArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function extractIndexItems(index: { count: number; offsets: number[]; data: BinaryReader }): Uint8Array[] {
  const items: Uint8Array[] = []
  for (let i = 0; i < index.count; i++) {
    const offset = index.offsets[i]! - 1
    const length = index.offsets[i + 1]! - index.offsets[i]!
    const reader = index.data.subReader(offset, length)
    const data = new Uint8Array(length)
    for (let j = 0; j < length; j++) data[j] = reader.readUint8()
    items.push(data)
  }
  return items
}

function countReturnOnlySubrs(items: Uint8Array[]): number {
  let count = 0
  for (const item of items) {
    if (item.length === 1 && item[0] === 11) count++
  }
  return count
}

describe('CFF Subset', () => {
  // ================================================================
  // 1. CIDFont Subset - Multi-FD Round-Trip
  // ================================================================
  describe('CIDFont multi-FD round-trip', () => {
    // Verifies outlines survive subsetting when glyphs span several FDs (ASCII/katakana/kanji).
    it('should preserve outlines for characters from multiple FDs (ASCII + katakana + kanji)', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = '1.プロジェクト概要'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectOutlineMatch(original, subset, cp)
      }
    })

    // Verifies every glyph in the multi-FD subset has usable outline data and a positive advance.
    it('should return valid glyphs for all characters in multi-FD subset', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = '1.プロジェクト概要'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        const glyph = subset.getGlyphByCodePoint(cp)
        expect(glyph.outline.commands.length, `no commands for U+${cp.toString(16)}`).toBeGreaterThan(0)
        expect(glyph.outline.coords.length, `no coords for U+${cp.toString(16)}`).toBeGreaterThan(0)
        expect(glyph.advanceWidth, `zero advanceWidth for U+${cp.toString(16)}`).toBeGreaterThan(0)
      }
    })
  })

  // ================================================================
  // 2. CIDFont Subset - Structure Verification
  // ================================================================
  describe('CIDFont subset structure verification', () => {
    // Verifies the subset CFF is still CID-keyed with fdSelect and FDArray intact.
    it('should preserve CID structure in the subset', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = '1.プロジェクト概要'
      const subsetBuffer = original.subset(text)

      // Parse the subset font's CFF table directly
      const sfnt = parseSfntDirectory(subsetBuffer)
      const cffReader = getTableReader(sfnt, 'CFF ')
      expect(cffReader).not.toBeNull()

      const cff = parseCff(cffReader!)
      expect(cff.isCIDFont).toBe(true)
      expect(cff.fdSelect).not.toBeNull()
      expect(cff.fdArray).not.toBeNull()
      expect(cff.fdArray!.length).toBeGreaterThan(0)
    })

    // Verifies subsetting never grows the FDArray beyond the original's.
    it('should have fewer or equal FDs compared to original', () => {
      const originalBuffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const originalSfnt = parseSfntDirectory(originalBuffer)
      const originalCffReader = getTableReader(originalSfnt, 'CFF ')
      const originalCff = parseCff(originalCffReader!)

      const original = Font.load(originalBuffer)
      const text = '1.プロジェクト概要'
      const subsetBuffer = original.subset(text)

      const subsetSfnt = parseSfntDirectory(subsetBuffer)
      const subsetCffReader = getTableReader(subsetSfnt, 'CFF ')
      const subsetCff = parseCff(subsetCffReader!)

      expect(subsetCff.fdArray!.length).toBeLessThanOrEqual(originalCff.fdArray!.length)
    })

    // Verifies subset fdSelect covers every glyph and only references existing FDs.
    it('should have fdSelect covering all glyphs in subset', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = '1.プロジェクト概要'
      const subsetBuffer = original.subset(text)

      const sfnt = parseSfntDirectory(subsetBuffer)
      const cffReader = getTableReader(sfnt, 'CFF ')
      const cff = parseCff(cffReader!)

      // fdSelect should have an entry for every glyph
      expect(cff.fdSelect!.length).toBe(cff.charstrings.count)

      // Every fdSelect entry should be a valid FD index
      for (let i = 0; i < cff.fdSelect!.length; i++) {
        expect(cff.fdSelect![i]).toBeLessThan(cff.fdArray!.length)
      }
    })
  })

  // ================================================================
  // 3. CIDFont Subset - Single FD (Kanji Only)
  // ================================================================
  describe('CIDFont subset - kanji only (single FD)', () => {
    // Verifies a subset confined to the kanji FD round-trips outlines exactly.
    it('should round-trip kanji-only subset correctly', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = '概要書'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectOutlineMatch(original, subset, cp)
      }
    })

    // Verifies unused FDs may be dropped when only kanji glyphs are retained.
    it('should potentially have fewer FDs than the full font', () => {
      const originalBuffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const originalSfnt = parseSfntDirectory(originalBuffer)
      const originalCffReader = getTableReader(originalSfnt, 'CFF ')
      const originalCff = parseCff(originalCffReader!)

      const original = Font.load(originalBuffer)
      const subsetBuffer = original.subset('概要書')

      const subsetSfnt = parseSfntDirectory(subsetBuffer)
      const subsetCffReader = getTableReader(subsetSfnt, 'CFF ')
      const subsetCff = parseCff(subsetCffReader!)

      expect(subsetCff.fdArray!.length).toBeLessThanOrEqual(originalCff.fdArray!.length)
    })
  })

  // ================================================================
  // 4. CIDFont Subset - Katakana Only
  // ================================================================
  describe('CIDFont subset - katakana only', () => {
    // Verifies a katakana-only subset round-trips outlines exactly.
    it('should round-trip katakana-only subset correctly', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'プロジェクト'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectOutlineMatch(original, subset, cp)
      }
    })
  })

  // ================================================================
  // 5. CIDFont Subset - ASCII Only
  // ================================================================
  describe('CIDFont subset - ASCII only', () => {
    // Verifies an ASCII-only subset from the CIDFont round-trips outlines exactly.
    it('should round-trip ASCII-only subset correctly', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'ABC123'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectOutlineMatch(original, subset, cp)
      }
    })
  })

  // ================================================================
  // 6. Non-CIDFont Subset Round-Trip
  // ================================================================
  describe('Non-CIDFont subset round-trip (SourceSans3)', () => {
    // Verifies a name-keyed CFF subset round-trips all requested outlines exactly.
    it('should round-trip all characters in subset correctly', () => {
      const original = loadFont(SOURCE_SANS_PATH)
      const text = 'ABCxyz123'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectOutlineMatch(original, subset, cp)
      }
    })

    // Verifies subsetting a name-keyed font does not accidentally emit CID structures.
    it('should not be CIDFont', () => {
      const subsetBuffer = loadFont(SOURCE_SANS_PATH).subset('ABCxyz123')

      const sfnt = parseSfntDirectory(subsetBuffer)
      const cffReader = getTableReader(sfnt, 'CFF ')
      expect(cffReader).not.toBeNull()

      const cff = parseCff(cffReader!)
      expect(cff.isCIDFont).toBe(false)
      expect(cff.fdSelect).toBeNull()
    })

    // Verifies the name-keyed subset is smaller than the original file.
    it('should produce a smaller font', () => {
      const originalBuffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
      const original = Font.load(originalBuffer)
      const subsetBuffer = original.subset('ABCxyz123')

      expect(subsetBuffer.byteLength).toBeLessThan(originalBuffer.byteLength)
    })
  })

  // ================================================================
  // 7. Empty Text Subset
  // ================================================================
  describe('Empty text subset', () => {
    // Verifies an empty-text CIDFont subset still loads with at least .notdef.
    it('should produce a loadable CIDFont with at least .notdef', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const subset = subsetAndReload(original, '')

      expect(subset.numGlyphs).toBeGreaterThanOrEqual(1)
    })

    // Verifies an empty-text name-keyed subset still loads with at least .notdef.
    it('should produce a loadable non-CIDFont with at least .notdef', () => {
      const original = loadFont(SOURCE_SANS_PATH)
      const subset = subsetAndReload(original, '')

      expect(subset.numGlyphs).toBeGreaterThanOrEqual(1)
    })
  })

  // ================================================================
  // 8. Single Character Subset
  // ================================================================
  describe('Single character subset', () => {
    // Verifies the minimal single-glyph subset path for a hiragana character.
    it('should round-trip a single hiragana character (あ)', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'あ'
      const subset = subsetAndReload(original, text)

      const cp = text.codePointAt(0)!
      expectOutlineMatch(original, subset, cp)
    })

    // Verifies a single ASCII glyph subset from the CIDFont round-trips exactly.
    it('should round-trip a single ASCII character from CIDFont', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'A'
      const subset = subsetAndReload(original, text)

      const cp = text.codePointAt(0)!
      expectOutlineMatch(original, subset, cp)
    })

    // Verifies a single-glyph subset from the name-keyed font round-trips exactly.
    it('should round-trip a single ASCII character from non-CIDFont', () => {
      const original = loadFont(SOURCE_SANS_PATH)
      const text = 'Z'
      const subset = subsetAndReload(original, text)

      const cp = text.codePointAt(0)!
      expectOutlineMatch(original, subset, cp)
    })
  })

  // ================================================================
  // 9. Large Text Subset
  // ================================================================
  describe('Large text subset (50+ unique characters)', () => {
    // Stresses subsetting with 50+ unique glyphs across scripts and checks each outline exactly.
    it('should round-trip a paragraph of Japanese text correctly', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'TypeScriptレポートエンジンはフォントエンジン、PDFレンダラー、キャンバスレンダラー、レイアウトエンジンを全てスクラッチで実装しています。外部依存なしで動作します。'
      const codePoints = codePointsOf(text)
      const uniqueCodePoints = [...new Set(codePoints)]

      // Verify we have 50+ unique characters
      expect(uniqueCodePoints.length).toBeGreaterThanOrEqual(50)

      const subset = subsetAndReload(original, text)

      for (const cp of uniqueCodePoints) {
        expectOutlineMatch(original, subset, cp)
      }
    })
  })

  // ================================================================
  // 10. CID-keyed CFF Output via Font.subset
  // ================================================================
  describe('Font.subset produces loadable font', () => {
    // Verifies the public Font.subset API yields a loadable CID subset with working glyphs.
    it('should produce a loadable CIDFont subset via Font.subset', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const subsetBuffer = original.subset('テスト文字列ABC')
      const subset = Font.load(subsetBuffer)

      expect(subset.isCff).toBe(true)
      expect(subset.numGlyphs).toBeGreaterThan(0)

      // All characters should resolve to valid glyphs
      for (const cp of codePointsOf('テスト文字列ABC')) {
        const glyph = subset.getGlyphByCodePoint(cp)
        expect(glyph.advanceWidth).toBeGreaterThan(0)
        expect(glyph.outline.commands.length).toBeGreaterThan(0)
      }
    })

    // Verifies Font.subset on a name-keyed font yields a loadable subset with working glyphs.
    it('should produce a loadable non-CIDFont subset via Font.subset', () => {
      const original = loadFont(SOURCE_SANS_PATH)
      const subsetBuffer = original.subset('Hello World')
      const subset = Font.load(subsetBuffer)

      expect(subset.isCff).toBe(true)
      expect(subset.numGlyphs).toBeGreaterThan(0)

      for (const cp of codePointsOf('HeloWrd')) {
        const glyph = subset.getGlyphByCodePoint(cp)
        expect(glyph.advanceWidth).toBeGreaterThan(0)
        expect(glyph.outline.commands.length).toBeGreaterThan(0)
      }
    })
  })

  // ================================================================
  // 11. Advance Width Preservation
  // ================================================================
  describe('Advance width preservation', () => {
    // Verifies hmtx advance widths survive CIDFont subsetting unchanged.
    it('should preserve advance widths for CIDFont subset', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'あいうABC概要'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        const origGlyph = original.getGlyphByCodePoint(cp)
        const subGlyph = subset.getGlyphByCodePoint(cp)
        expect(subGlyph.advanceWidth, `advanceWidth mismatch for U+${cp.toString(16)}`).toBe(origGlyph.advanceWidth)
      }
    })

    // Verifies hmtx advance widths survive name-keyed subsetting unchanged.
    it('should preserve advance widths for non-CIDFont subset', () => {
      const original = loadFont(SOURCE_SANS_PATH)
      const text = 'ABCxyz!@#'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        const origGlyph = original.getGlyphByCodePoint(cp)
        const subGlyph = subset.getGlyphByCodePoint(cp)
        expect(subGlyph.advanceWidth, `advanceWidth mismatch for U+${cp.toString(16)}`).toBe(origGlyph.advanceWidth)
      }
    })
  })

  // ================================================================
  // 12. cmap Preservation
  // ================================================================
  describe('cmap preservation', () => {
    // Verifies the rebuilt cmap still maps every subset character to a real glyph.
    it('should map included characters to non-zero glyph IDs', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'テスト概要ABC'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        const glyphId = subset.getGlyphId(cp)
        expect(glyphId, `glyph ID for U+${cp.toString(16)} should be non-zero`).toBeGreaterThan(0)
      }
    })

    // Verifies characters outside the subset map to .notdef (glyph 0) in the rebuilt cmap.
    it('should map excluded characters to glyph ID 0', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'ABC'
      const subset = subsetAndReload(original, text)

      // Characters NOT included in the subset should return 0
      const excludedCodePoints = codePointsOf('漢字テスト')
      for (const cp of excludedCodePoints) {
        const glyphId = subset.getGlyphId(cp)
        expect(glyphId, `glyph ID for excluded U+${cp.toString(16)} should be 0`).toBe(0)
      }
    })

    // Verifies cmap inclusion/exclusion behavior for the name-keyed subset.
    it('should preserve cmap for non-CIDFont subset', () => {
      const original = loadFont(SOURCE_SANS_PATH)
      const text = 'Hello'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        const glyphId = subset.getGlyphId(cp)
        expect(glyphId, `glyph ID for U+${cp.toString(16)} should be non-zero`).toBeGreaterThan(0)
      }

      // Excluded character
      const excludedCp = 'Z'.codePointAt(0)!
      expect(subset.getGlyphId(excludedCp)).toBe(0)
    })
  })

  // ================================================================
  // 13. Glyph Outline Exact Match (covered by helper, additional tests)
  // ================================================================
  describe('Glyph outline exact match', () => {
    // Verifies byte-exact commands and near-exact coords for mixed-script CID subsets.
    it('should exactly match outlines for mixed scripts in CIDFont', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'Hello世界こんにちは'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectOutlineMatch(original, subset, cp)
      }
    })

    // Verifies exact outline preservation for punctuation/symbol glyphs in the name-keyed font.
    it('should exactly match outlines for punctuation and symbols', () => {
      const original = loadFont(SOURCE_SANS_PATH)
      const text = '!@#$%^&*()_+-=[]'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectOutlineMatch(original, subset, cp)
      }
    })
  })

  // ================================================================
  // 14. Command/Coord Alignment Check
  // ================================================================
  describe('Command/coord alignment check', () => {
    // Verifies subset CID glyphs keep command/coordinate alignment per PATH_COMMAND_COORDS.
    it('should have consistent command/coord counts for CIDFont subset', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = '1.プロジェクト概要あいう'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectCommandCoordAlignment(subset, cp)
      }
    })

    // Verifies subset name-keyed glyphs keep command/coordinate alignment.
    it('should have consistent command/coord counts for non-CIDFont subset', () => {
      const original = loadFont(SOURCE_SANS_PATH)
      const text = 'ABCxyz123!@#'
      const subset = subsetAndReload(original, text)

      for (const cp of codePointsOf(text)) {
        expectCommandCoordAlignment(subset, cp)
      }
    })

    // Re-validates alignment with an inline coordinate-count walk that rejects unknown commands.
    it('should have consistent command/coord counts for all glyphs via glyph iteration', () => {
      const original = loadFont(NOTO_SANS_JP_PATH)
      const text = 'テスト文字ABC123概要'
      const subset = subsetAndReload(original, text)

      // Verify for every glyph accessible from the text
      for (const cp of codePointsOf(text)) {
        const glyph = subset.getGlyphByCodePoint(cp)
        const { commands, coords } = glyph.outline

        let expectedCoords = 0
        for (let i = 0; i < commands.length; i++) {
          const cmd = commands[i]!
          if (cmd === PathCommand.MoveTo) expectedCoords += 2
          else if (cmd === PathCommand.LineTo) expectedCoords += 2
          else if (cmd === PathCommand.CubicTo) expectedCoords += 6
          else if (cmd === PathCommand.Close) expectedCoords += 0
          else throw new Error(`Unknown command ${cmd} at index ${i}`)
        }

        expect(coords.length, `coord alignment failed for U+${cp.toString(16)}`).toBe(expectedCoords)
      }
    })
  })

  // ================================================================
  // 15. Hinting Data Preservation
  // ================================================================
  describe('Hinting data preservation', () => {
    // Verifies BlueValues survive into the subset's Private DICT verbatim.
    it('should preserve BlueValues in non-CIDFont subset Private DICT', () => {
      const originalBuffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
      const originalSfnt = parseSfntDirectory(originalBuffer)
      const originalCffReader = getTableReader(originalSfnt, 'CFF ')!
      const originalCff = parseCff(originalCffReader)

      // SourceSans3 should have BlueValues (op 6) in Private DICT
      const blueValues = originalCff.privateDictEntries.get(6)

      const original = Font.load(originalBuffer)
      const subsetBuffer = original.subset('ABCxyz')
      const subsetSfnt = parseSfntDirectory(subsetBuffer)
      const subsetCffReader = getTableReader(subsetSfnt, 'CFF ')!
      const subsetCff = parseCff(subsetCffReader)

      if (blueValues && blueValues.length > 0) {
        const subsetBlueValues = subsetCff.privateDictEntries.get(6)
        expect(subsetBlueValues).toBeDefined()
        expect(subsetBlueValues!.length).toBe(blueValues.length)
        for (let i = 0; i < blueValues.length; i++) {
          expect(subsetBlueValues![i]).toBe(blueValues[i]!)
        }
      }
    })

    // Verifies StdHW/StdVW hint widths survive subsetting.
    it('should preserve StdHW and StdVW in non-CIDFont subset', () => {
      const originalBuffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
      const originalSfnt = parseSfntDirectory(originalBuffer)
      const originalCffReader = getTableReader(originalSfnt, 'CFF ')!
      const originalCff = parseCff(originalCffReader)

      const original = Font.load(originalBuffer)
      const subsetBuffer = original.subset('ABCxyz')
      const subsetSfnt = parseSfntDirectory(subsetBuffer)
      const subsetCffReader = getTableReader(subsetSfnt, 'CFF ')!
      const subsetCff = parseCff(subsetCffReader)

      // StdHW (op 10) and StdVW (op 11)
      for (const op of [10, 11]) {
        const origVal = originalCff.privateDictEntries.get(op)
        if (origVal && origVal.length > 0) {
          const subsetVal = subsetCff.privateDictEntries.get(op)
          expect(subsetVal, `op ${op} should be preserved`).toBeDefined()
          expect(subsetVal![0]).toBe(origVal[0]!)
        }
      }
    })

    // Verifies per-FD hinting data is preserved whenever the original CIDFont has any.
    it('should preserve hinting data in CIDFont subset per-FD Private DICTs', () => {
      const originalBuffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const originalSfnt = parseSfntDirectory(originalBuffer)
      const originalCffReader = getTableReader(originalSfnt, 'CFF ')!
      const originalCff = parseCff(originalCffReader)

      const original = Font.load(originalBuffer)
      const subsetBuffer = original.subset('A概')
      const subsetSfnt = parseSfntDirectory(subsetBuffer)
      const subsetCffReader = getTableReader(subsetSfnt, 'CFF ')!
      const subsetCff = parseCff(subsetCffReader)

      expect(subsetCff.isCIDFont).toBe(true)
      expect(subsetCff.fdArray).not.toBeNull()

      // At least one FD should have hinting data preserved
      let foundHintData = false
      for (const fd of subsetCff.fdArray!) {
        if (fd.privateDictEntries.size > 0) {
          // Check for any hint operators (6,7,8,9,10,11,1209-1219)
          for (const op of [6, 7, 8, 9, 10, 11, 1209, 1210, 1211, 1212, 1213]) {
            if (fd.privateDictEntries.has(op)) {
              foundHintData = true
              break
            }
          }
        }
        if (foundHintData) break
      }

      // NotoSansJP should have at least some hinting data in its FDs
      // (This may depend on the specific font, so we check the original first)
      let originalHasHints = false
      for (const fd of originalCff.fdArray!) {
        for (const op of [6, 7, 8, 9, 10, 11, 1209, 1210, 1211, 1212, 1213]) {
          if (fd.privateDictEntries.has(op)) {
            originalHasHints = true
            break
          }
        }
        if (originalHasHints) break
      }

      if (originalHasHints) {
        expect(foundHintData).toBe(true)
      }
    })

    // Verifies real-valued hint entries (BlueScale/ExpansionFactor) are re-encoded without rounding.
    it('should preserve real-number hinting values (BlueScale, ExpansionFactor) without rounding', () => {
      const originalBuffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
      const originalSfnt = parseSfntDirectory(originalBuffer)
      const originalCffReader = getTableReader(originalSfnt, 'CFF ')!
      const originalCff = parseCff(originalCffReader)

      const original = Font.load(originalBuffer)
      const subsetBuffer = original.subset('ABCxyz')
      const subsetSfnt = parseSfntDirectory(subsetBuffer)
      const subsetCffReader = getTableReader(subsetSfnt, 'CFF ')!
      const subsetCff = parseCff(subsetCffReader)

      // BlueScale (1209) is typically a real number like 0.039625
      const origBlueScale = originalCff.privateDictEntries.get(1209)
      if (origBlueScale && origBlueScale.length > 0) {
        const subsetBlueScale = subsetCff.privateDictEntries.get(1209)
        expect(subsetBlueScale).toBeDefined()
        expect(subsetBlueScale![0]).toBe(origBlueScale[0]!)
        // Verify it's actually a real number (not rounded to 0)
        if (!Number.isInteger(origBlueScale[0]!)) {
          expect(subsetBlueScale![0]).not.toBe(Math.round(origBlueScale[0]!))
        }
      }

      // ExpansionFactor (1218) is typically a real number like 0.06
      const origExpFactor = originalCff.privateDictEntries.get(1218)
      if (origExpFactor && origExpFactor.length > 0) {
        const subsetExpFactor = subsetCff.privateDictEntries.get(1218)
        expect(subsetExpFactor).toBeDefined()
        expect(subsetExpFactor![0]).toBe(origExpFactor[0]!)
        if (!Number.isInteger(origExpFactor[0]!)) {
          expect(subsetExpFactor![0]).not.toBe(Math.round(origExpFactor[0]!))
        }
      }
    })

    // Verifies every hinting operator present in the original round-trips value-for-value.
    it('should preserve all hinting operator values exactly through round-trip', () => {
      const originalBuffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
      const originalSfnt = parseSfntDirectory(originalBuffer)
      const originalCffReader = getTableReader(originalSfnt, 'CFF ')!
      const originalCff = parseCff(originalCffReader)

      const original = Font.load(originalBuffer)
      const subsetBuffer = original.subset('Hello')
      const subsetSfnt = parseSfntDirectory(subsetBuffer)
      const subsetCffReader = getTableReader(subsetSfnt, 'CFF ')!
      const subsetCff = parseCff(subsetCffReader)

      // All hinting operators should survive round-trip exactly
      const HINT_OPS = [6, 7, 8, 9, 10, 11, 1209, 1210, 1211, 1212, 1213, 1214, 1217, 1218, 1219]
      for (const op of HINT_OPS) {
        const origValues = originalCff.privateDictEntries.get(op)
        if (origValues && origValues.length > 0) {
          const subsetValues = subsetCff.privateDictEntries.get(op)
          expect(subsetValues, `op ${op} should be preserved`).toBeDefined()
          expect(subsetValues!.length, `op ${op} value count`).toBe(origValues.length)
          for (let i = 0; i < origValues.length; i++) {
            expect(subsetValues![i], `op ${op} value[${i}]`).toBe(origValues[i]!)
          }
        }
      }
    })
  })

  // ================================================================
  // 13. Math CFF stability with physical subroutine removal
  // ================================================================
  // Inlining preserves the complete program while removing both Subr INDEXes.
  describe('Math CFF stability', () => {
    // Verifies the name-keyed MATH subset has no placeholder or retained subroutine programs.
    it('MATHフォントの name-keyed subset では return-only subroutines を注入しない', () => {
      const original = loadFont(STIX_MATH_PATH)
      const subsetBuffer = original.subset('∫√Σ∞0')
      const subsetSfnt = parseSfntDirectory(subsetBuffer)
      const subsetCffReader = getTableReader(subsetSfnt, 'CFF ')
      expect(subsetCffReader).not.toBeNull()

      const subsetCff = parseCff(subsetCffReader!)
      const globalSubrs = extractIndexItems(subsetCff.globalSubrs)
      const localSubrs = extractIndexItems(subsetCff.localSubrs)

      expect(countReturnOnlySubrs(globalSubrs)).toBe(0)
      expect(countReturnOnlySubrs(localSubrs)).toBe(0)
      expect(globalSubrs).toHaveLength(0)
      expect(localSubrs).toHaveLength(0)
    })

    // Verifies the CID-keyed MATH output also contains no return-only subr stubs in any INDEX.
    it('MATHフォントの CID CFF 出力では return-only subroutines を注入しない', () => {
      const original = loadFont(STIX_MATH_PATH)
      const cps = [0x222B, 0x221A, 0x2211, 0x221E, 0x30, 0x78]
      const glyphIds = new Set<number>()
      const cpToGid = new Map<number, number>()
      for (const cp of cps) {
        const gid = original.getGlyphId(cp)
        glyphIds.add(gid)
        cpToGid.set(cp, gid)
      }

      const result = original.subsetByGlyphIds(glyphIds, cpToGid)
      expect(result.cidKeyedCff).toBeDefined()

      const cidCff = parseCff(new BinaryReader(toContiguousArrayBuffer(result.cidKeyedCff!)))
      expect(cidCff.isCIDFont).toBe(true)

      const globalSubrs = extractIndexItems(cidCff.globalSubrs)
      expect(countReturnOnlySubrs(globalSubrs)).toBe(0)
      expect(globalSubrs).toHaveLength(0)

      expect(cidCff.fdArray).not.toBeNull()
      for (const fd of cidCff.fdArray ?? []) {
        const localSubrs = extractIndexItems(fd.localSubrs)
        expect(countReturnOnlySubrs(localSubrs)).toBe(0)
        expect(localSubrs).toHaveLength(0)
      }
    })
  })
})

describe('encodeDictReal', () => {
  function roundTrip(value: number): number {
    const encoded = encodeDictReal(value)
    // encoded[0] === 30 (real marker), rest is BCD nibbles
    const buf = new ArrayBuffer(encoded.length - 1)
    const view = new Uint8Array(buf)
    for (let i = 1; i < encoded.length; i++) view[i - 1] = encoded[i]!
    const reader = new BinaryReader(buf)
    return parseCffReal(reader)
  }

  // Verifies BCD real encoding round-trips typical positive hint values exactly.
  it('should encode positive real numbers correctly', () => {
    expect(roundTrip(0.039625)).toBe(0.039625)
    expect(roundTrip(0.06)).toBe(0.06)
    expect(roundTrip(3.14159)).toBe(3.14159)
  })

  // Verifies the sign nibble is emitted for negative reals.
  it('should encode negative real numbers correctly', () => {
    expect(roundTrip(-2.5)).toBe(-2.5)
    expect(roundTrip(-0.039625)).toBe(-0.039625)
  })

  // Verifies whole numbers still encode and parse correctly through the real encoder.
  it('should encode integer-like real values correctly', () => {
    expect(roundTrip(1)).toBe(1)
    expect(roundTrip(0)).toBe(0)
    expect(roundTrip(100)).toBe(100)
  })

  // Verifies exponent nibbles handle values whose toString() uses scientific notation.
  it('should encode scientific notation values correctly', () => {
    // JavaScript toString() uses scientific notation for very small/large values
    expect(roundTrip(1e-7)).toBe(1e-7)
    expect(roundTrip(1e20)).toBe(1e20)
  })

  // Verifies the encoded operand starts with the DICT real-number marker byte 30.
  it('should start encoded bytes with marker 30', () => {
    const encoded = encodeDictReal(0.5)
    expect(encoded[0]).toBe(30)
  })

  // Verifies the BCD stream is terminated with the 0xF end nibble.
  it('should terminate with nibble 0xF', () => {
    const encoded = encodeDictReal(0.5)
    const lastByte = encoded[encoded.length - 1]!
    // Last byte should contain 0xF nibble (either high or low)
    expect((lastByte & 0x0F) === 0x0F || (lastByte >> 4) === 0x0F).toBe(true)
  })
})

// ================================================================
// CFF Subset — exhaustive CJK glyph round-trip tests
//
// 「」(U+904B) after, glyph with.
// CJK Unified Ideographs (U+4E00-U+9FFF) from font glyph.
// Splitsubset -> compare.

// every glyph the font provides in the CJK Unified Ideographs range (U+4E00-U+9FFF)
// is subset in batches and its outline compared against the original.
// ================================================================
describe('CFF Subset — CJK round-trip exhaustive', () => {
  // Collect the code points in the range that the font actually maps to glyphs
  function collectCjkCodePoints(font: Font, start: number, end: number): number[] {
    const cps: number[] = []
    for (let cp = start; cp <= end; cp++) {
      const gid = font.getGlyphId(cp)
      if (gid > 0) cps.push(cp)
    }
    return cps
  }

  // Subset one batch and compare outline command counts for every character in it
  function verifyBatch(original: Font, codePoints: number[]) {
    if (codePoints.length === 0) return
    const text = codePoints.map(cp => String.fromCodePoint(cp)).join('')
    const subset = subsetAndReload(original, text)
    const mismatches: string[] = []
    for (const cp of codePoints) {
      const origGid = original.getGlyphId(cp)
      if (origGid === 0) continue
      const origGlyph = original.getGlyph(origGid)
      const subGid = subset.getGlyphId(cp)
      const subGlyph = subset.getGlyph(subGid)
      if (origGlyph.outline.commands.length !== subGlyph.outline.commands.length) {
        mismatches.push(
          `U+${cp.toString(16).toUpperCase()} "${String.fromCodePoint(cp)}": ` +
          `orig ${origGlyph.outline.commands.length} cmds / subset ${subGlyph.outline.commands.length} cmds`
        )
      }
    }
    expect(mismatches, `Outline mismatches:\n${mismatches.join('\n')}`).toHaveLength(0)
  }

  const BATCH_SIZE = 256

  // Batch round-trips every available glyph in U+4E00-U+5FFF to catch subr-dependent corruption.
  it('CJK Unified Ideographs U+4E00-U+5FFF (基本漢字 前半)', () => {
    const original = loadFont(NOTO_SANS_JP_PATH)
    const allCps = collectCjkCodePoints(original, 0x4E00, 0x5FFF)
    for (let i = 0; i < allCps.length; i += BATCH_SIZE) {
      verifyBatch(original, allCps.slice(i, i + BATCH_SIZE))
    }
  })

  // Batch round-trips every available glyph in U+6000-U+6FFF.
  it('CJK Unified Ideographs U+6000-U+6FFF (基本漢字 中盤)', () => {
    const original = loadFont(NOTO_SANS_JP_PATH)
    const allCps = collectCjkCodePoints(original, 0x6000, 0x6FFF)
    for (let i = 0; i < allCps.length; i += BATCH_SIZE) {
      verifyBatch(original, allCps.slice(i, i + BATCH_SIZE))
    }
  })

  // Batch round-trips every available glyph in U+7000-U+7FFF.
  it('CJK Unified Ideographs U+7000-U+7FFF (基本漢字 中盤)', () => {
    const original = loadFont(NOTO_SANS_JP_PATH)
    const allCps = collectCjkCodePoints(original, 0x7000, 0x7FFF)
    for (let i = 0; i < allCps.length; i += BATCH_SIZE) {
      verifyBatch(original, allCps.slice(i, i + BATCH_SIZE))
    }
  })

  // Batch round-trips every available glyph in U+8000-U+9FFF (range of the original U+904B bug).
  it('CJK Unified Ideographs U+8000-U+9FFF (基本漢字 後半)', () => {
    const original = loadFont(NOTO_SANS_JP_PATH)
    const allCps = collectCjkCodePoints(original, 0x8000, 0x9FFF)
    for (let i = 0; i < allCps.length; i += BATCH_SIZE) {
      verifyBatch(original, allCps.slice(i, i + BATCH_SIZE))
    }
  })

  // Batch round-trips all kana glyphs (U+3040-U+30FF) in a single subset.
  it('ひらがな U+3040-U+309F + カタカナ U+30A0-U+30FF', () => {
    const original = loadFont(NOTO_SANS_JP_PATH)
    const cps = collectCjkCodePoints(original, 0x3040, 0x30FF)
    verifyBatch(original, cps)
  })

  // Batch round-trips fullwidth forms and CJK punctuation glyphs.
  it('全角記号 U+FF01-U+FF9F + CJK 記号 U+3000-U+303F', () => {
    const original = loadFont(NOTO_SANS_JP_PATH)
    const cps = [
      ...collectCjkCodePoints(original, 0x3000, 0x303F),
      ...collectCjkCodePoints(original, 0xFF01, 0xFF9F),
    ]
    verifyBatch(original, cps)
  })
})
