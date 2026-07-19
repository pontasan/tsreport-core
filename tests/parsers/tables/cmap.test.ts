import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseCmap, validateCmapConformance } from '../../../src/parsers/tables/cmap.js'
import { Font } from '../../../src/font.js'
import { existsSync } from 'node:fs'

const FONT_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const JP_FONT_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSansJP-Regular.otf')

describe('cmap table parser', () => {
  function writeUint24(w: BinaryWriter, value: number): void {
    w.writeUint8((value >>> 16) & 0xFF)
    w.writeUint8((value >>> 8) & 0xFF)
    w.writeUint8(value & 0xFF)
  }

  function writeFormat0(w: BinaryWriter, glyphIds?: number[], length = 262): void {
    w.writeUint16(0)
    w.writeUint16(length)
    w.writeUint16(0)
    for (let i = 0; i < 256; i++) {
      w.writeUint8(glyphIds?.[i] ?? 0)
    }
  }

  function writeFormat6(w: BinaryWriter, firstCode: number, glyphIds: number[], language = 0): void {
    w.writeUint16(6)
    w.writeUint16(10 + glyphIds.length * 2)
    w.writeUint16(language)
    w.writeUint16(firstCode)
    w.writeUint16(glyphIds.length)
    for (const glyphId of glyphIds) w.writeUint16(glyphId)
  }

  function writeFormat4(
    w: BinaryWriter,
    opts?: {
      searchRange?: number
      entrySelector?: number
      rangeShift?: number
      endCodes?: number[]
      startCodes?: number[]
      idDeltas?: number[]
      idRangeOffsets?: number[]
      glyphIds?: number[]
      reservedPad?: number
    },
  ): void {
    const endCodes = opts?.endCodes ?? [0x41, 0xFFFF]
    const startCodes = opts?.startCodes ?? [0x41, 0xFFFF]
    const idDeltas = opts?.idDeltas ?? [10 - 0x41, 1]
    const idRangeOffsets = opts?.idRangeOffsets ?? [0, 0]
    const glyphIds = opts?.glyphIds ?? []
    const segCount = endCodes.length
    const entrySelector = Math.floor(Math.log2(segCount))
    const searchRange = 2 * (1 << entrySelector)
    const rangeShift = segCount * 2 - searchRange
    w.writeUint16(4)
    w.writeUint16(16 + segCount * 8 + glyphIds.length * 2)
    w.writeUint16(0)
    w.writeUint16(segCount * 2)
    w.writeUint16(opts?.searchRange ?? searchRange)
    w.writeUint16(opts?.entrySelector ?? entrySelector)
    w.writeUint16(opts?.rangeShift ?? rangeShift)
    for (const endCode of endCodes) w.writeUint16(endCode)
    w.writeUint16(opts?.reservedPad ?? 0)
    for (const startCode of startCodes) w.writeUint16(startCode)
    for (const idDelta of idDeltas) w.writeInt16(idDelta)
    for (const idRangeOffset of idRangeOffsets) w.writeUint16(idRangeOffset)
    for (const glyphId of glyphIds) w.writeUint16(glyphId)
  }

  function buildSingleSubtableCmap(
    formatWriter: (w: BinaryWriter) => void,
    platformId = 0,
    encodingId = 3,
  ): ArrayBuffer {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(1)
    w.writeUint16(platformId)
    w.writeUint16(encodingId)
    w.writeUint32(12)
    formatWriter(w)
    return w.toArrayBuffer()
  }

  function writeFormat8(
    w: BinaryWriter,
    groups: { start: number, end: number, glyph: number }[],
    opts?: { reserved?: number, length?: number, is32Words?: number[] },
  ): void {
    w.writeUint16(8)
    w.writeUint16(opts?.reserved ?? 0)
    w.writeUint32(opts?.length ?? (8208 + groups.length * 12))
    w.writeUint32(0)
    const is32 = new Uint8Array(8192)
    const is32Words = opts?.is32Words ?? collectFormat8HighWords(groups)
    for (const word of is32Words) {
      is32[word >>> 3] |= 1 << (7 - (word & 7))
    }
    w.writeBytes(is32)
    w.writeUint32(groups.length)
    for (const group of groups) {
      w.writeUint32(group.start)
      w.writeUint32(group.end)
      w.writeUint32(group.glyph)
    }
  }

  function collectFormat8HighWords(groups: { start: number, end: number }[]): number[] {
    const words = new Set<number>()
    for (const group of groups) {
      for (let cp = group.start; cp <= group.end; cp++) {
        if (cp > 0xFFFF) words.add(cp >>> 16)
      }
    }
    return [...words]
  }

  function writeFormat10(
    w: BinaryWriter,
    startCharCode: number,
    glyphIds: number[],
    opts?: { reserved?: number, length?: number },
  ): void {
    w.writeUint16(10)
    w.writeUint16(opts?.reserved ?? 0)
    w.writeUint32(opts?.length ?? (20 + glyphIds.length * 2))
    w.writeUint32(0)
    w.writeUint32(startCharCode)
    w.writeUint32(glyphIds.length)
    for (const glyphId of glyphIds) w.writeUint16(glyphId)
  }

  function writeFormat12(
    w: BinaryWriter,
    groups: { start: number, end: number, glyph: number }[],
    opts?: { reserved?: number, length?: number },
  ): void {
    w.writeUint16(12)
    w.writeUint16(opts?.reserved ?? 0)
    w.writeUint32(opts?.length ?? (16 + groups.length * 12))
    w.writeUint32(0)
    w.writeUint32(groups.length)
    for (const group of groups) {
      w.writeUint32(group.start)
      w.writeUint32(group.end)
      w.writeUint32(group.glyph)
    }
  }

  function writeFormat13(
    w: BinaryWriter,
    groups: { start: number, end: number, glyph: number }[],
    opts?: { reserved?: number, length?: number },
  ): void {
    w.writeUint16(13)
    w.writeUint16(opts?.reserved ?? 0)
    w.writeUint32(opts?.length ?? (16 + groups.length * 12))
    w.writeUint32(0)
    w.writeUint32(groups.length)
    for (const group of groups) {
      w.writeUint32(group.start)
      w.writeUint32(group.end)
      w.writeUint32(group.glyph)
    }
  }

  function buildCmapWithFormat14(): ArrayBuffer {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(20)
    w.writeUint16(0); w.writeUint16(5); w.writeUint32(34)
    writeFormat6(w, 0x41, [10, 20])

    w.writeUint16(14)
    w.writeUint32(38)
    w.writeUint32(1)
    writeUint24(w, 0xFE00)
    w.writeUint32(21)
    w.writeUint32(29)
    w.writeUint32(1)
    writeUint24(w, 0x42)
    w.writeUint8(0)
    w.writeUint32(1)
    writeUint24(w, 0x41)
    w.writeUint16(99)
    return w.toArrayBuffer()
  }

  // Verifies against a real font (Noto Sans) that ASCII code points resolve to distinct non-zero glyph IDs.
  it('should parse cmap and resolve ASCII characters', () => {
    const buffer = readFileSync(FONT_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'cmap')!
    expect(reader).not.toBeNull()

    const cmap = parseCmap(reader)

    // 'A' (U+0041) should map to a non-zero glyph ID
    const glyphIdA = cmap.getGlyphId(0x0041)
    expect(glyphIdA).toBeGreaterThan(0)

    // 'Z' (U+005A) should map to a different glyph ID
    const glyphIdZ = cmap.getGlyphId(0x005A)
    expect(glyphIdZ).toBeGreaterThan(0)
    expect(glyphIdZ).not.toBe(glyphIdA)

    // space (U+0020)
    const glyphIdSpace = cmap.getGlyphId(0x0020)
    expect(glyphIdSpace).toBeGreaterThan(0)
  })

  // Verifies that an unmapped code point (supplementary PUA) maps to glyph 0 (.notdef) per the cmap contract.
  it('should return 0 for unmapped code points', () => {
    const buffer = readFileSync(FONT_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'cmap')!
    const cmap = parseCmap(reader)

    // Private Use Area (U+F0000) - likely unmapped
    const glyphId = cmap.getGlyphId(0xF0000)
    expect(glyphId).toBe(0)
  })

  // Verifies that entries() yields valid (codePoint, glyphId) pairs so callers can enumerate the character map.
  it('should iterate entries', () => {
    const buffer = readFileSync(FONT_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'cmap')!
    const cmap = parseCmap(reader)

    let count = 0
    for (const [cp, glyphId] of cmap.entries()) {
      expect(cp).toBeGreaterThanOrEqual(0)
      expect(glyphId).toBeGreaterThan(0)
      count++
      if (count > 100) break // Only check the first 100 entries
    }
    expect(count).toBeGreaterThan(0)
  })

  it('should parse and validate format 0 byte mappings', () => {
    const glyphIds: number[] = []
    glyphIds[0x41] = 12
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat0(w, glyphIds),
      1,
      0,
    )))

    expect(cmap.getGlyphId(0x41)).toBe(12)
    expect(cmap.getGlyphId(0x100)).toBe(0)
    expect([...cmap.entries()]).toEqual([[0x41, 12]])
  })

  it('should reject format 0 subtables with non-standard length', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat0(w, [], 263),
      1,
      0,
    )))).toThrow(
      'cmap format 0 length must be 262, got 263',
    )
  })

  // Verifies cmap format 2 enumeration covers both one-byte and high-byte subHeader mappings.
  it('should iterate format 2 high-byte subHeader entries', () => {
    const w = new BinaryWriter()
    w.writeUint16(0) // version
    w.writeUint16(1) // numTables
    w.writeUint16(1) // platformID: Macintosh
    w.writeUint16(1) // encodingID
    w.writeUint32(12)

    // Format 2 subtable with subHeader 0 for one-byte codes and subHeader 1 for high byte 0x81.
    w.writeUint16(2)
    w.writeUint16(542)
    w.writeUint16(0)
    for (let i = 0; i < 256; i++) {
      w.writeUint16(i === 0x81 ? 8 : 0)
    }
    w.writeUint16(0x41)
    w.writeUint16(2)
    w.writeInt16(0)
    w.writeUint16(10)
    w.writeUint16(0x40)
    w.writeUint16(2)
    w.writeInt16(1)
    w.writeUint16(6)
    w.writeUint16(5)
    w.writeUint16(6)
    w.writeUint16(9)
    w.writeUint16(10)

    const cmap = parseCmap(new BinaryReader(w.toArrayBuffer()))
    expect(cmap.getGlyphId(0x41)).toBe(5)
    expect(cmap.getGlyphId(0x42)).toBe(6)
    expect(cmap.getGlyphId(0x8140)).toBe(10)
    expect(cmap.getGlyphId(0x8141)).toBe(11)

    expect([...cmap.entries()]).toEqual([
      [0x41, 5],
      [0x42, 6],
      [0x8140, 10],
      [0x8141, 11],
    ])
  })

  it('should reject format 2 subHeader keys that are not byte offsets to 8-byte subHeaders', () => {
    const buffer = buildSingleSubtableCmap((w) => {
      w.writeUint16(2)
      w.writeUint16(526)
      w.writeUint16(0)
      for (let i = 0; i < 256; i++) w.writeUint16(i === 0x81 ? 7 : 0)
      w.writeUint16(0)
      w.writeUint16(0)
      w.writeInt16(0)
      w.writeUint16(0)
    }, 1, 1)

    expect(() => parseCmap(new BinaryReader(buffer))).toThrow(
      'cmap format 2 subHeaderKey 129 must be a multiple of 8, got 7',
    )
  })

  it('should reject format 2 subHeader character ranges that exceed one byte', () => {
    const buffer = buildSingleSubtableCmap((w) => {
      w.writeUint16(2)
      w.writeUint16(528)
      w.writeUint16(0)
      for (let i = 0; i < 256; i++) w.writeUint16(0)
      w.writeUint16(0xFE)
      w.writeUint16(3)
      w.writeInt16(0)
      w.writeUint16(8)
      w.writeUint16(1)
    }, 1, 1)

    expect(() => parseCmap(new BinaryReader(buffer))).toThrow(
      'cmap format 2 subHeader 0 character range exceeds one byte',
    )
  })

  it('should reject format 2 idRangeOffsets outside glyphIdArray', () => {
    const buffer = buildSingleSubtableCmap((w) => {
      w.writeUint16(2)
      w.writeUint16(526)
      w.writeUint16(0)
      for (let i = 0; i < 256; i++) w.writeUint16(0)
      w.writeUint16(0x41)
      w.writeUint16(1)
      w.writeInt16(0)
      w.writeUint16(4)
    }, 1, 1)

    expect(() => parseCmap(new BinaryReader(buffer))).toThrow(
      'cmap format 2 subHeader 0 idRangeOffset references outside glyphIdArray',
    )
  })

  it('should prefer a full Unicode cmap over a BMP Unicode cmap', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(20)
    w.writeUint16(0); w.writeUint16(4); w.writeUint32(32)
    writeFormat6(w, 0x41, [10])
    writeFormat12(w, [
      { start: 0x41, end: 0x41, glyph: 20 },
      { start: 0x1F600, end: 0x1F600, glyph: 30 },
    ])

    const cmap = parseCmap(new BinaryReader(w.toArrayBuffer()))
    expect(cmap.getGlyphId(0x41)).toBe(20)
    expect(cmap.getGlyphId(0x1F600)).toBe(30)
    expect(cmap.encodingRecords).toHaveLength(2)
    expect(cmap.selectedEncoding).toMatchObject({ platformId: 0, encodingId: 4, format: 12 })
    expect(cmap.encodingRecords[0]!.mapping!.getGlyphId(0x41)).toBe(10)
    expect(cmap.encodingRecords[1]!.mapping!.getGlyphId(0x41)).toBe(20)
  })

  it('should validate a non-selected cmap subtable instead of leaving it parse-only', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(20)
    w.writeUint16(3); w.writeUint16(10); w.writeUint32(32)
    writeFormat6(w, 0x41, [10])
    writeFormat12(w, [{ start: 0x41, end: 0x41, glyph: 20 }], { length: 16 })

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap format 12 length must be 28, got 16',
    )
  })

  it('should apply cmap format 14 default and non-default UVS records', () => {
    const cmap = parseCmap(new BinaryReader(buildCmapWithFormat14()))

    expect(cmap.getGlyphIdWithVariation(0x41, 0xFE00)).toBe(99)
    expect(cmap.getGlyphIdWithVariation(0x42, 0xFE00)).toBe(20)
    expect(cmap.getGlyphIdWithVariation(0x43, 0xFE00)).toBe(0)
    expect(cmap.getVariationGlyphId(0x41, 0xFE00)).toBe(99)
    expect(cmap.getVariationGlyphId(0x42, 0xFE00)).toBe(20)
    expect(cmap.getVariationGlyphId(0x43, 0xFE00)).toBeNull()
    expect([...cmap.variationSequences()]).toEqual([
      { codePoint: 0x42, variationSelector: 0xFE00, glyphId: 20, isDefault: true },
      { codePoint: 0x41, variationSelector: 0xFE00, glyphId: 99, isDefault: false },
    ])
  })

  // Real-font IVS spot-check: the non-default gids below were read from
  // NotoSansJP's actual format-14 subtable via fontTools. A non-default UVS
  // record selects the variant glyph; a default UVS record and an unsupported
  // variation sequence both resolve to the base cmap glyph (the selector is
  // ignored), matching HarfBuzz's rendering fallback.
  it.skipIf(!existsSync(JP_FONT_PATH))('resolves real IVS mappings matching fontTools', () => {
    const font = Font.load(readFileSync(JP_FONT_PATH).buffer as ArrayBuffer)
    const cmap = font.cmap
    // Non-default UVS records: base, variationSelector, expected variant gid.
    const nonDefault: [number, number, number][] = [
      [0x4FAE, 0xFE00, 15189], // 侮 VS1
      [0x50E7, 0xFE00, 15190], // 僧 VS1
      [0x514D, 0xFE00, 15191], // 免 VS1
      [0x51DE, 0xFE00, 15164], // 凞 VS1
      [0x52C9, 0xFE00, 15192], // 勉 VS1
      [0x4FAE, 0xE0101, 15189], // 侮 VS18 (IVS) → same variant glyph
    ]
    for (const [base, vs, gid] of nonDefault) {
      expect(cmap.getGlyphIdWithVariation(base, vs), `U+${base.toString(16)} VS`).toBe(gid)
    }
    // Default UVS record (E0100 lists 侮): resolves to the base glyph.
    expect(cmap.getGlyphIdWithVariation(0x4FAE, 0xE0100)).toBe(font.getGlyphId(0x4FAE))
    // Unsupported variation sequence (no record for A + VS1): selector ignored,
    // falls back to the base glyph.
    expect(cmap.getGlyphIdWithVariation(0x41, 0xFE00)).toBe(font.getGlyphId(0x41))
  })

  it('should parse and validate format 4 segment mapping', () => {
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap((w) => writeFormat4(w))))

    expect(cmap.getGlyphId(0x41)).toBe(10)
    expect(cmap.getGlyphId(0x42)).toBe(0)
  })

  it('ignores incorrect format 4 binary-search header fields (advisory)', () => {
    // Real fonts (e.g. macOS Shree714) ship wrong searchRange/entrySelector/
    // rangeShift; they are advisory and must not cause rejection.
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap((w) => {
      writeFormat4(w, { searchRange: 2 })
    })))
    expect(cmap.getGlyphId(0x41)).toBe(10)
    expect(() => validateCmapConformance(cmap, 20, false)).toThrow(
      'cmap format 4 search fields must be 4/1/0, got 2/1/0',
    )
  })

  it('should reject non-zero format 4 reservedPad', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap((w) => {
      writeFormat4(w, { reservedPad: 1 })
    })))).toThrow(
      'cmap format 4 reservedPad must be 0, got 1',
    )
  })

  it('should reject format 4 segment arrays without the 0xFFFF sentinel', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap((w) => {
      writeFormat4(w, {
        endCodes: [0x41, 0x42],
        startCodes: [0x41, 0x42],
        idDeltas: [10 - 0x41, 11 - 0x42],
      })
    })))).toThrow(
      'cmap format 4 final endCode must be 0xFFFF',
    )
  })

  it('should reject overlapping format 4 segments', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap((w) => {
      writeFormat4(w, {
        endCodes: [0x43, 0x45, 0xFFFF],
        startCodes: [0x41, 0x43, 0xFFFF],
        idDeltas: [10 - 0x41, 20 - 0x43, 1],
        idRangeOffsets: [0, 0, 0],
      })
    })))).toThrow(
      'cmap format 4 segment 1 overlaps the previous segment',
    )
  })

  it('tolerates format 4 idRangeOffsets outside glyphIdArray (lookup returns 0)', () => {
    // Some real fonts (macOS Diwan Thuluth) declare a /length that truncates the
    // glyphIdArray; out-of-range references resolve to glyph 0 rather than
    // rejecting the whole font.
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap((w) => {
      writeFormat4(w, {
        idRangeOffsets: [4, 0],
      })
    })))
    expect(cmap.getGlyphId(0x41)).toBe(0)
  })

  it('should reject format 6 subtables whose declared length does not match entryCount', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap((w) => {
      w.writeUint16(6)
      w.writeUint16(12)
      w.writeUint16(0)
      w.writeUint16(0x41)
      w.writeUint16(2)
      w.writeUint16(10)
    })))).toThrow(
      'cmap format 6 length must be 14, got 12',
    )
  })

  it('should reject format 6 trimmed arrays that exceed the BMP range', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap((w) => {
      writeFormat6(w, 0xFFFF, [10, 11])
    })))).toThrow(
      'cmap format 6 character range exceeds U+FFFF',
    )
  })

  it('should parse and validate format 8 mixed 16/32-bit groups', () => {
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat8(w, [
        { start: 0x41, end: 0x41, glyph: 12 },
        { start: 0x10000, end: 0x10001, glyph: 40 },
      ]),
      1,
      1,
    )))

    expect(cmap.getGlyphId(0x41)).toBe(12)
    expect(cmap.getGlyphId(0x10000)).toBe(40)
    expect(cmap.getGlyphId(0x10001)).toBe(41)
    expect([...cmap.entries()]).toEqual([
      [0x41, 12],
      [0x10000, 40],
      [0x10001, 41],
    ])
  })

  it('should reject non-zero format 8 reserved fields', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat8(w, [], { reserved: 1 }),
      1,
      1,
    )))).toThrow(
      'cmap format 8 reserved field must be 0, got 1',
    )
  })

  it('should reject format 8 subtables whose declared length does not match numGroups', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat8(w, [{ start: 0x41, end: 0x41, glyph: 10 }], { length: 8208 }),
      1,
      1,
    )))).toThrow(
      'cmap format 8 length must be 8220, got 8208',
    )
  })

  it('should reject format 8 groups that conflict with the is32 bitmap', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat8(w, [{ start: 0x10000, end: 0x10000, glyph: 40 }], { is32Words: [] }),
      1,
      1,
    )))).toThrow(
      'cmap format 8 group 0 is32 bit for word 0x1 must be 1',
    )

    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat8(w, [{ start: 0x41, end: 0x41, glyph: 12 }], { is32Words: [0x41] }),
      1,
      1,
    )))).toThrow(
      'cmap format 8 group 0 is32 bit for word 0x41 must be 0',
    )
  })

  it('should parse and validate format 10 trimmed arrays', () => {
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat10(w, 0x10000, [50, 51]),
      0,
      4,
    )))

    expect(cmap.getGlyphId(0x10000)).toBe(50)
    expect(cmap.getGlyphId(0x10001)).toBe(51)
    expect([...cmap.entries()]).toEqual([
      [0x10000, 50],
      [0x10001, 51],
    ])
  })

  it('should reject non-zero format 10 reserved fields', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat10(w, 0x10000, [50], { reserved: 1 }),
      0,
      4,
    )))).toThrow(
      'cmap format 10 reserved field must be 0, got 1',
    )
  })

  it('should reject format 10 subtables whose range exceeds Unicode', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat10(w, 0x10FFFF, [50, 51]),
      0,
      4,
    )))).toThrow(
      'cmap format 10 character range exceeds Unicode range',
    )
  })

  it('should reject non-zero format 12 reserved fields', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat12(w, [{ start: 0x41, end: 0x41, glyph: 10 }], { reserved: 1 }),
      0,
      4,
    )))).toThrow(
      'cmap format 12 reserved field must be 0, got 1',
    )
  })

  it('should reject format 12 subtables whose declared length does not match numGroups', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat12(w, [{ start: 0x41, end: 0x41, glyph: 10 }], { length: 16 }),
      0,
      4,
    )))).toThrow(
      'cmap format 12 length must be 28, got 16',
    )
  })

  it('should reject format 12 groups outside the Unicode range', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat12(w, [{ start: 0x110000, end: 0x110000, glyph: 10 }]),
      0,
      4,
    )))).toThrow(
      'cmap format 12 group 0 endCharCode exceeds Unicode range',
    )
  })

  it('should parse and validate format 13 constant map groups', () => {
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat13(w, [{ start: 0x10000, end: 0x10001, glyph: 70 }]),
      0,
      6,
    )))

    expect(cmap.getGlyphId(0x10000)).toBe(70)
    expect(cmap.getGlyphId(0x10001)).toBe(70)
    expect([...cmap.entries()]).toEqual([
      [0x10000, 70],
      [0x10001, 70],
    ])
  })

  it('should reject non-zero format 13 reserved fields', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat13(w, [{ start: 0x41, end: 0x41, glyph: 10 }], { reserved: 1 }),
      0,
      6,
    )))).toThrow(
      'cmap format 13 reserved field must be 0, got 1',
    )
  })

  it('should reject format 13 subtables whose declared length does not match numGroups', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat13(w, [{ start: 0x41, end: 0x41, glyph: 10 }], { length: 16 }),
      0,
      6,
    )))).toThrow(
      'cmap format 13 length must be 28, got 16',
    )
  })

  it('should reject format 13 groups outside the Unicode range', () => {
    expect(() => parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat13(w, [{ start: 0x110000, end: 0x110000, glyph: 10 }]),
      0,
      6,
    )))).toThrow(
      'cmap format 13 group 0 endCharCode exceeds Unicode range',
    )
  })

  it('should reject cmap encoding records that are not sorted', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(3); w.writeUint16(1); w.writeUint32(20)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(32)
    writeFormat6(w, 0x41, [10])
    writeFormat6(w, 0x41, [20])

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap encoding record 1 is not in strictly increasing platform/encoding/language order',
    )
  })

  it('should reject non-zero language fields in non-Macintosh subtables', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(1)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(12)
    writeFormat6(w, 0x41, [10], 1)

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap encoding record 0 non-Macintosh language field must be 0',
    )
  })

  it('should reject format 14 outside platform 0 encoding 5', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(1)
    w.writeUint16(0); w.writeUint16(4); w.writeUint32(12)
    w.writeUint16(14)
    w.writeUint32(10)
    w.writeUint32(0)

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap format 14 must use platform 0 encoding 5, got platform 0 encoding 4',
    )
  })

  it('should reject unsorted format 14 variation selector records', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(20)
    w.writeUint16(0); w.writeUint16(5); w.writeUint32(32)
    writeFormat6(w, 0x41, [10])
    w.writeUint16(14)
    w.writeUint32(32)
    w.writeUint32(2)
    writeUint24(w, 0xFE01); w.writeUint32(0); w.writeUint32(0)
    writeUint24(w, 0xFE00); w.writeUint32(0); w.writeUint32(0)

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap format 14 variation selector record 1 is not in strictly increasing order',
    )
  })

  it('should reject format 14 subtables shorter than their selector records', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(20)
    w.writeUint16(0); w.writeUint16(5); w.writeUint32(32)
    writeFormat6(w, 0x41, [10])
    w.writeUint16(14)
    w.writeUint32(20)
    w.writeUint32(1)
    writeUint24(w, 0xFE00)
    w.writeUint32(0)
    w.writeUint32(0)

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap format 14 length is invalid',
    )
  })

  it('should reject format 14 default UVS tables that exceed the subtable length', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(20)
    w.writeUint16(0); w.writeUint16(5); w.writeUint32(32)
    writeFormat6(w, 0x41, [10])
    w.writeUint16(14)
    w.writeUint32(25)
    w.writeUint32(1)
    writeUint24(w, 0xFE00)
    w.writeUint32(21)
    w.writeUint32(0)
    w.writeUint32(1)

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap format 14 default UVS table for selector fe00 exceeds subtable length',
    )
  })

  it('should reject format 14 default UVS ranges outside the 24-bit value range', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(20)
    w.writeUint16(0); w.writeUint16(5); w.writeUint32(32)
    writeFormat6(w, 0x41, [10])
    w.writeUint16(14)
    w.writeUint32(29)
    w.writeUint32(1)
    writeUint24(w, 0xFE00)
    w.writeUint32(21)
    w.writeUint32(0)
    w.writeUint32(1)
    writeUint24(w, 0xFFFFFF)
    w.writeUint8(1)

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap format 14 default UVS range 0 exceeds 24-bit Unicode value range',
    )
  })

  it('should reject format 14 non-default UVS tables that exceed the subtable length', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(2)
    w.writeUint16(0); w.writeUint16(3); w.writeUint32(20)
    w.writeUint16(0); w.writeUint16(5); w.writeUint32(32)
    writeFormat6(w, 0x41, [10])
    w.writeUint16(14)
    w.writeUint32(25)
    w.writeUint32(1)
    writeUint24(w, 0xFE00)
    w.writeUint32(0)
    w.writeUint32(21)
    w.writeUint32(1)

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap format 14 non-default UVS table for selector fe00 exceeds subtable length',
    )
  })

  it('should reject overlapping format 12 groups', () => {
    const w = new BinaryWriter()
    w.writeUint16(0)
    w.writeUint16(1)
    w.writeUint16(0); w.writeUint16(4); w.writeUint32(12)
    writeFormat12(w, [
      { start: 0x41, end: 0x43, glyph: 10 },
      { start: 0x43, end: 0x45, glyph: 20 },
    ])

    expect(() => parseCmap(new BinaryReader(w.toArrayBuffer()))).toThrow(
      'cmap format 12 group 1 overlaps or is out of order',
    )
  })

  it('should separate permissive legacy record decoding from OpenType 1.9.1 record conformance', () => {
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat12(w, [{ start: 0x41, end: 0x41, glyph: 2 }]),
      3,
      1,
    )))
    expect(cmap.getGlyphId(0x41)).toBe(2)
    expect(() => validateCmapConformance(cmap, 3, false)).toThrow(
      'cmap Windows Unicode BMP encoding record 0 must use format 4',
    )
  })

  it('should reject cmap glyph IDs outside maxp in explicit conformance validation', () => {
    const cmap = parseCmap(new BinaryReader(buildSingleSubtableCmap(
      (w) => writeFormat6(w, 0x41, [3]),
    )))
    expect(() => validateCmapConformance(cmap, 3, false)).toThrow(
      'cmap encoding record 0 maps character code 0x41 to glyph 3, but maxp.numGlyphs is 3',
    )
  })
})
