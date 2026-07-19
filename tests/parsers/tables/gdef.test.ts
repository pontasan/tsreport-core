import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseFont } from '../../../src/parsers/index.js'
import { parseGdef } from '../../../src/parsers/tables/gdef.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
const SOURCE_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/SourceSans3-Regular.otf')
const GUJARATI_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSansGujarati-Regular.ttf')
const F2DOT14 = 16384

function buildItemVariationStore(delta: number): Uint8Array {
  const w = new BinaryWriter()
  w.writeUint16(1) // format
  w.writeUint32(12) // variationRegionListOffset
  w.writeUint16(1) // itemVariationDataCount
  w.writeUint32(22) // itemVariationDataOffset
  w.writeUint16(1) // axisCount
  w.writeUint16(1) // regionCount
  w.writeInt16(0)
  w.writeInt16(F2DOT14)
  w.writeInt16(F2DOT14)
  w.writeUint16(1) // itemCount
  w.writeUint16(1) // wordDeltaCount
  w.writeUint16(1) // regionIndexCount
  w.writeUint16(0) // regionIndex
  w.writeInt16(delta)
  return w.toUint8Array().slice()
}

function buildGdefWithMarkGlyphSets(markGlyphSetsFormat = 1, glyphs: number[] = [5, 7]): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1) // majorVersion
  w.writeUint16(2) // minorVersion
  w.writeUint16(0) // glyphClassDefOffset
  w.writeUint16(0) // attachListOffset
  w.writeUint16(0) // ligCaretListOffset
  w.writeUint16(0) // markAttachClassDefOffset
  w.writeUint16(14) // markGlyphSetsDefOffset
  w.writeUint16(markGlyphSetsFormat)
  w.writeUint16(1) // markGlyphSetCount
  w.writeUint32(8) // coverageOffset
  w.writeUint16(1) // Coverage format 1
  w.writeUint16(glyphs.length)
  for (const glyph of glyphs) w.writeUint16(glyph)
  return w.toArrayBuffer()
}

function buildGdefWithItemVariationStore(): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1) // majorVersion
  w.writeUint16(3) // minorVersion
  w.writeUint16(0) // glyphClassDefOffset
  w.writeUint16(0) // attachListOffset
  w.writeUint16(0) // ligCaretListOffset
  w.writeUint16(0) // markAttachClassDefOffset
  w.writeUint16(0) // markGlyphSetsDefOffset
  w.writeUint32(18) // itemVarStoreOffset
  w.writeBytes(buildItemVariationStore(20))
  return w.toArrayBuffer()
}

function buildGdefWithAttachmentList(): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1)
  w.writeUint16(0)
  w.writeUint16(0)
  w.writeUint16(12) // attachListOffset
  w.writeUint16(0)
  w.writeUint16(0)
  w.writeUint16(6) // coverageOffset
  w.writeUint16(1) // glyphCount
  w.writeUint16(12) // attachPointOffset
  w.writeUint16(1) // Coverage format 1
  w.writeUint16(1)
  w.writeUint16(5)
  w.writeUint16(2) // pointCount
  w.writeUint16(1)
  w.writeUint16(3)
  return w.toArrayBuffer()
}

function buildGdefWithLigatureCarets(): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1)
  w.writeUint16(0)
  w.writeUint16(0)
  w.writeUint16(0)
  w.writeUint16(12) // ligCaretListOffset
  w.writeUint16(0)
  w.writeUint16(6) // coverageOffset
  w.writeUint16(1) // ligGlyphCount
  w.writeUint16(12) // ligGlyphOffset
  w.writeUint16(1) // Coverage format 1
  w.writeUint16(1)
  w.writeUint16(10)
  w.writeUint16(3) // caretCount
  w.writeUint16(8)
  w.writeUint16(12)
  w.writeUint16(16)
  w.writeUint16(1)
  w.writeInt16(200)
  w.writeUint16(2)
  w.writeUint16(2)
  w.writeUint16(3)
  w.writeInt16(400)
  w.writeUint16(6) // deviceOffset from CaretValue
  w.writeUint16(12) // startSize
  w.writeUint16(12) // endSize
  w.writeUint16(2) // 4-bit Device deltas
  w.writeUint16(0x1000) // +1 at ppem 12
  return w.toArrayBuffer()
}

function buildGdefWithVariableCaret(): ArrayBuffer {
  const variationStore = buildItemVariationStore(20)
  const w = new BinaryWriter()
  w.writeUint16(1)
  w.writeUint16(3)
  w.writeUint16(0)
  w.writeUint16(0)
  w.writeUint16(18) // ligCaretListOffset
  w.writeUint16(0)
  w.writeUint16(0)
  w.writeUint32(46) // itemVarStoreOffset
  w.writeUint16(6) // coverageOffset
  w.writeUint16(1) // ligGlyphCount
  w.writeUint16(12) // ligGlyphOffset
  w.writeUint16(1) // Coverage format 1
  w.writeUint16(1)
  w.writeUint16(10)
  w.writeUint16(1) // caretCount
  w.writeUint16(4) // caretOffset
  w.writeUint16(3)
  w.writeInt16(400)
  w.writeUint16(6) // VariationIndex offset
  w.writeUint16(0) // deltaSetOuterIndex
  w.writeUint16(0) // deltaSetInnerIndex
  w.writeUint16(0x8000) // VariationIndex marker
  w.writeBytes(variationStore)
  return w.toArrayBuffer()
}

describe('GDEF table parser', () => {
  describe('NotoSans-Regular', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'GDEF')

    // Verifies that the fixture font actually contains a GDEF table (precondition for the following tests).
    it('should have GDEF table', () => {
      expect(reader).not.toBeNull()
    })

    if (reader) {
      const gdef = parseGdef(reader)

      // Verifies that the parsed header reports major version 1 with a non-negative minor version.
      it('should have version 1.x', () => {
        expect(gdef.majorVersion).toBe(1)
        expect(gdef.minorVersion).toBeGreaterThanOrEqual(0)
      })

      // Verifies that getGlyphClass returns a value in the valid GlyphClassDef range 0-4 for a cmap-resolved glyph.
      it('should classify glyphs', () => {
        // GlyphClass 0 means unclassified
        // Most glyphs should have some classification
        const manager = new SfntTableManager(sfnt)
        const cmap = manager.cmap

        // Space is typically a Base glyph
        const spaceGid = cmap.getGlyphId(0x20) // space
        const cls = gdef.getGlyphClass(spaceGid)
        // Space might be base (1) or unclassified (0)
        expect(cls).toBeGreaterThanOrEqual(0)
        expect(cls).toBeLessThanOrEqual(4)
      })

      it('matches fontTools ligature caret coordinates', () => {
        expect(gdef.getLigatureCaretValues(1653)).toEqual([
          { format: 1, coordinate: 301, pointIndex: null, deviceDelta: 0 },
        ])
        expect(gdef.getLigatureCaretValues(1656)).toEqual([
          { format: 1, coordinate: 315, pointIndex: null, deviceDelta: 0 },
          { format: 1, coordinate: 631, pointIndex: null, deviceDelta: 0 },
        ])
      })

      // Verifies that glyph IDs beyond the font's range yield class 0 for both glyph class and mark-attach class.
      it('should return 0 for unknown glyphs', () => {
        expect(gdef.getGlyphClass(99999)).toBe(0)
        expect(gdef.getMarkAttachClass(99999)).toBe(0)
      })
    }
  })

  // Real-font oracle: NotoSansGujarati carries all three GDEF subtables. The
  // gid→class values below were read from its actual GDEF via fontTools; an
  // exhaustive sweep of every glyph matched (GlyphClassDef, MarkAttachClassDef
  // and MarkGlyphSets), and this pins a representative subset.
  describe('NotoSansGujarati GDEF matches fontTools', () => {
    const buffer = readFileSync(GUJARATI_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'GDEF')

    it('has a GDEF table', () => {
      expect(reader).not.toBeNull()
    })

    if (reader) {
      const gdef = parseGdef(reader)

      it('classifies base and mark glyphs', () => {
        // gids 7,8 are Base (1); gids 4,5,55 are Mark (3).
        expect(gdef.getGlyphClass(7)).toBe(1)
        expect(gdef.getGlyphClass(8)).toBe(1)
        expect(gdef.getGlyphClass(4)).toBe(3)
        expect(gdef.getGlyphClass(5)).toBe(3)
        expect(gdef.getGlyphClass(55)).toBe(3)
      })

      it('resolves mark-attachment classes', () => {
        expect(gdef.getMarkAttachClass(4)).toBe(2)
        expect(gdef.getMarkAttachClass(5)).toBe(2)
        expect(gdef.getMarkAttachClass(55)).toBe(1)
        expect(gdef.getMarkAttachClass(7)).toBe(0) // a base glyph: unclassified
      })

      it('resolves MarkGlyphSets membership', () => {
        // set 0 contains gids 4,5,64; set 1 contains gids 55,719.
        expect(gdef.isMarkInSet(4, 0)).toBe(true)
        expect(gdef.isMarkInSet(64, 0)).toBe(true)
        expect(gdef.isMarkInSet(55, 0)).toBe(false)
        expect(gdef.isMarkInSet(55, 1)).toBe(true)
        expect(gdef.isMarkInSet(719, 1)).toBe(true)
        expect(gdef.isMarkInSet(4, 1)).toBe(false)
      })
    }
  })

  describe('Roboto-Regular', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'GDEF')

    // Verifies that Roboto contains a GDEF table.
    it('should have GDEF table', () => {
      expect(reader).not.toBeNull()
    })

    if (reader) {
      const gdef = parseGdef(reader)

      // Verifies that GDEF from a second TTF fixture also parses with major version 1.
      it('should have valid version', () => {
        expect(gdef.majorVersion).toBe(1)
      })
    }
  })

  describe('SourceSans3-Regular (OTF)', () => {
    const buffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseFont(buffer)
    const reader = getTableReader(sfnt, 'GDEF')

    // Verifies that a CFF-flavored (OTF) font also exposes a GDEF table through parseFont.
    it('should have GDEF table', () => {
      expect(reader).not.toBeNull()
    })

    if (reader) {
      const gdef = parseGdef(reader)

      // Verifies that GDEF inside an OTF parses with major version 1.
      it('should have valid version', () => {
        expect(gdef.majorVersion).toBe(1)
      })

      // Verifies GlyphClassDef semantics: a letter classifies as Base (1) and a combining accent as Mark (3) when classified.
      it('should classify base and mark glyphs differently', () => {
        const manager = new SfntTableManager(sfnt)
        const cmap = manager.cmap

        // 'A' should be Base (1)
        const aGid = cmap.getGlyphId(0x41) // 'A'
        const aClass = gdef.getGlyphClass(aGid)

        // Combining accent (U+0300) should be Mark (3) if present
        const accentGid = cmap.getGlyphId(0x0300) // combining grave accent
        if (accentGid !== 0) {
          const accentClass = gdef.getGlyphClass(accentGid)
          // Mark glyphs should have class 3
          if (accentClass !== 0) {
            expect(accentClass).toBe(3) // Mark
          }
        }

        // 'A' if classified should be Base
        if (aClass !== 0) {
          expect(aClass).toBe(1) // Base
        }
      })
    }
  })

  describe('SfntTableManager lazy access', () => {
    // Verifies that SfntTableManager lazily parses and exposes the GDEF table via its gdef getter.
    it('should provide gdef via manager', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      const gdef = manager.gdef
      expect(gdef).not.toBeNull()
      if (gdef) {
        expect(gdef.majorVersion).toBe(1)
      }
    })
  })

  describe('synthetic GDEF validation', () => {
    it('parses MarkGlyphSets format 1 coverage tables', () => {
      const gdef = parseGdef(new BinaryReader(buildGdefWithMarkGlyphSets()))

      expect(gdef.majorVersion).toBe(1)
      expect(gdef.minorVersion).toBe(2)
      expect(gdef.isMarkInSet(5, 0)).toBe(true)
      expect(gdef.isMarkInSet(7, 0)).toBe(true)
      expect(gdef.isMarkInSet(6, 0)).toBe(false)
    })

    it('parses GDEF v1.3 ItemVariationStore with fvar axis validation', () => {
      const gdef = parseGdef(new BinaryReader(buildGdefWithItemVariationStore()), 1)

      expect(gdef.getVarDelta(0, 0, [0])).toBe(0)
      expect(gdef.getVarDelta(0, 0, [0.5])).toBe(10)
      expect(gdef.getVarDelta(0, 0, [1])).toBe(20)
    })

    it('parses attachment contour point indices', () => {
      const gdef = parseGdef(new BinaryReader(buildGdefWithAttachmentList()))

      expect(gdef.getAttachmentPointIndices(5)).toEqual([1, 3])
      expect(gdef.getAttachmentPointIndices(6)).toEqual([])
    })

    it('resolves all ligature CaretValue formats and Device deltas', () => {
      const gdef = parseGdef(new BinaryReader(buildGdefWithLigatureCarets()))

      expect(gdef.getLigatureCaretValues(10, 12)).toEqual([
        { format: 1, coordinate: 200, pointIndex: null, deviceDelta: 0 },
        { format: 2, coordinate: 0, pointIndex: 2, deviceDelta: 0 },
        { format: 3, coordinate: 400, pointIndex: null, deviceDelta: 1 },
      ])
      expect(gdef.getLigatureCaretValues(10, 13)![2]!.deviceDelta).toBe(0)
      expect(gdef.getLigatureCaretValues(11)).toBeNull()
    })

    it('resolves CaretValue VariationIndex through the GDEF ItemVariationStore', () => {
      const gdef = parseGdef(new BinaryReader(buildGdefWithVariableCaret()), 1)

      expect(gdef.getLigatureCaretValues(10, undefined, [0])![0]!.coordinate).toBe(400)
      expect(gdef.getLigatureCaretValues(10, undefined, [0.5])![0]!.coordinate).toBe(410)
      expect(gdef.getLigatureCaretValues(10, undefined, [1])![0]!.coordinate).toBe(420)
    })

    it('preserves attachment point order and rejects invalid caret formats', () => {
      const unsortedPoints = new Uint8Array(buildGdefWithAttachmentList())
      unsortedPoints[28] = 0
      unsortedPoints[29] = 1
      expect(parseGdef(new BinaryReader(unsortedPoints.buffer)).getAttachmentPointIndices(5)).toEqual([1, 1])

      const invalidCaretFormat = new Uint8Array(buildGdefWithLigatureCarets())
      invalidCaretFormat[32] = 0
      invalidCaretFormat[33] = 4
      expect(() => parseGdef(new BinaryReader(invalidCaretFormat.buffer))).toThrow(/CaretValue format/)
    })

    it('rejects unsupported versions and invalid offsets', () => {
      const unsupported = new Uint8Array(buildGdefWithMarkGlyphSets())
      new DataView(unsupported.buffer).setUint16(0, 2)
      expect(() => parseGdef(new BinaryReader(unsupported.buffer))).toThrow(/Unsupported GDEF/)

      const badHeaderOffset = new Uint8Array(buildGdefWithMarkGlyphSets())
      badHeaderOffset[5] = 4
      expect(() => parseGdef(new BinaryReader(badHeaderOffset.buffer))).toThrow(/glyphClassDefOffset/)
    })

    it('rejects malformed MarkGlyphSets data', () => {
      expect(() => parseGdef(new BinaryReader(buildGdefWithMarkGlyphSets(2)))).toThrow(/MarkGlyphSets format/)

      const badCoverageOffset = new Uint8Array(buildGdefWithMarkGlyphSets())
      badCoverageOffset[20] = 0
      badCoverageOffset[21] = 0
      badCoverageOffset[22] = 0
      badCoverageOffset[23] = 4
      expect(() => parseGdef(new BinaryReader(badCoverageOffset.buffer))).toThrow(/coverage offset/)
    })

    it('requires fvar axis context for GDEF ItemVariationStore data', () => {
      expect(() => parseGdef(new BinaryReader(buildGdefWithItemVariationStore()))).toThrow(/requires table 'fvar'/)
      expect(() => parseGdef(new BinaryReader(buildGdefWithItemVariationStore()), 2)).toThrow(/axisCount/)
    })
  })
})
