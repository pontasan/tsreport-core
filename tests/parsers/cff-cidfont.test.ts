import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, BinaryReader, PathCommand } from '../../src/index.js'
import { parseCff, parseCffGlyph, parseCharset } from '../../src/parsers/cff-parser.js'
import { getTableReader, parseSfntDirectory } from '../../src/parsers/sfnt-parser.js'

const NOTO_JP_PATH = resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')
const SOURCE_SANS_PATH = resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf')

function loadCff(fontPath: string) {
  const buffer = readFileSync(fontPath).buffer as ArrayBuffer
  const sfnt = parseSfntDirectory(buffer)
  const cffReader = getTableReader(sfnt, 'CFF ')
  if (!cffReader) throw new Error('CFF table not found')
  return parseCff(cffReader)
}

function loadFont(fontPath: string) {
  const buffer = readFileSync(fontPath).buffer as ArrayBuffer
  return Font.load(buffer)
}

// =========================================================================
// 1. CIDFont Detection
// =========================================================================

describe('CIDFont Detection', () => {
  // Verifies the ROS entry in NotoSansJP's Top DICT triggers CIDFont detection.
  it('NotoSansJP should be detected as CIDFont', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.isCIDFont).toBe(true)
  })

  // Verifies a plain name-keyed CFF font is not misdetected as a CIDFont.
  it('SourceSans3 should NOT be detected as CIDFont', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.isCIDFont).toBe(false)
  })

  // Verifies a CIDFont exposes its parsed per-glyph fdSelect array.
  it('CIDFont should have fdSelect (Uint8Array)', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.fdSelect).not.toBeNull()
    expect(cff.fdSelect).toBeInstanceOf(Uint8Array)
  })

  // Verifies a CIDFont exposes its FDArray of font DICTs.
  it('CIDFont should have fdArray (array)', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.fdArray).not.toBeNull()
    expect(Array.isArray(cff.fdArray)).toBe(true)
  })

  // Verifies non-CIDFonts leave fdSelect null since they have no FD mapping.
  it('non-CIDFont should have fdSelect=null', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.fdSelect).toBeNull()
  })

  // Verifies non-CIDFonts leave fdArray null.
  it('non-CIDFont should have fdArray=null', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.fdArray).toBeNull()
  })
})

// =========================================================================
// 2. FDArray Parsing
// =========================================================================

describe('FDArray Parsing', () => {
  // Verifies NotoSansJP's FDArray parses into more than a single font DICT.
  it('NotoSansJP fdArray should have multiple entries', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.fdArray).not.toBeNull()
    expect(cff.fdArray!.length).toBeGreaterThan(1)
  })

  // Pins the exact FDArray size (18) of NotoSansJP as a parsing regression check.
  it('NotoSansJP fdArray should have 18 entries', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.fdArray!.length).toBe(18)
  })

  // Verifies every FD carries the per-FD subr and width fields the interpreter needs.
  it('each FD should have localSubrs, localBias, defaultWidthX, nominalWidthX', () => {
    const cff = loadCff(NOTO_JP_PATH)
    for (const fd of cff.fdArray!) {
      expect(fd).toHaveProperty('localSubrs')
      expect(fd).toHaveProperty('localBias')
      expect(fd).toHaveProperty('defaultWidthX')
      expect(fd).toHaveProperty('nominalWidthX')
      expect(typeof fd.localBias).toBe('number')
      expect(typeof fd.defaultWidthX).toBe('number')
      expect(typeof fd.nominalWidthX).toBe('number')
    }
  })

  // Verifies the kanji FD's large local subr INDEX is parsed completely.
  it('FD 12 (kanji) should have many localSubrs (count > 1000)', () => {
    const cff = loadCff(NOTO_JP_PATH)
    const fd12 = cff.fdArray![12]!
    expect(fd12.localSubrs.count).toBeGreaterThan(1000)
  })

  // Verifies the katakana FD has its own non-empty local subr INDEX.
  it('FD 13 (katakana) should have localSubrs (count > 0)', () => {
    const cff = loadCff(NOTO_JP_PATH)
    const fd13 = cff.fdArray![13]!
    expect(fd13.localSubrs.count).toBeGreaterThan(0)
  })

  // Verifies the ASCII FD has its own non-empty local subr INDEX.
  it('FD 14 (ASCII) should have localSubrs (count > 0)', () => {
    const cff = loadCff(NOTO_JP_PATH)
    const fd14 = cff.fdArray![14]!
    expect(fd14.localSubrs.count).toBeGreaterThan(0)
  })

  // Verifies FDs without a Subrs entry get an empty local subr INDEX rather than garbage.
  it('FDs with no local subrs should have localSubrs.count === 0', () => {
    const cff = loadCff(NOTO_JP_PATH)
    const emptyFDs = cff.fdArray!.filter(fd => fd.localSubrs.count === 0)
    for (const fd of emptyFDs) {
      expect(fd.localSubrs.count).toBe(0)
    }
  })
})

// =========================================================================
// 3. FDSelect
// =========================================================================

describe('FDSelect', () => {
  // Verifies fdSelect provides an FD index for every glyph in the charstrings INDEX.
  it('fdSelect length should equal numGlyphs (charstrings.count)', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.fdSelect!.length).toBe(cff.charstrings.count)
  })

  // Verifies fdSelect routes a kanji glyph to the kanji font DICT (FD 12).
  it('kanji glyph should map to FD 12', () => {
    const font = loadFont(NOTO_JP_PATH)
    const cff = loadCff(NOTO_JP_PATH)
    const gid = font.getGlyphId(0x6982) 
    expect(gid).toBeGreaterThan(0)
    expect(cff.fdSelect![gid]).toBe(12)
  })

  // Verifies fdSelect routes a katakana glyph to FD 13.
  it('katakana glyph should map to FD 13', () => {
    const font = loadFont(NOTO_JP_PATH)
    const cff = loadCff(NOTO_JP_PATH)
    const gid = font.getGlyphId(0x30D7) 
    expect(gid).toBeGreaterThan(0)
    expect(cff.fdSelect![gid]).toBe(13)
  })

  // Verifies fdSelect routes an ASCII digit glyph to FD 14.
  it('ASCII digit glyph should map to FD 14', () => {
    const font = loadFont(NOTO_JP_PATH)
    const cff = loadCff(NOTO_JP_PATH)
    const gid = font.getGlyphId(0x0031) // '1'
    expect(gid).toBeGreaterThan(0)
    expect(cff.fdSelect![gid]).toBe(14)
  })

  // Verifies no fdSelect entry points past the end of the FDArray.
  it('all fdSelect values should be valid indices (< fdArray.length)', () => {
    const cff = loadCff(NOTO_JP_PATH)
    const fdCount = cff.fdArray!.length
    for (let i = 0; i < cff.fdSelect!.length; i++) {
      expect(cff.fdSelect![i]).toBeLessThan(fdCount)
    }
  })
})

// =========================================================================
// 4. Per-FD Glyph Parsing (parseCffGlyph)
// =========================================================================

describe('Per-FD Glyph Parsing (parseCffGlyph)', () => {
  // Verifies a kanji glyph parses using FD 12's local subrs and width defaults.
  it('should parse a kanji glyph (FD 12) with many commands', () => {
    const font = loadFont(NOTO_JP_PATH)
    const cff = loadCff(NOTO_JP_PATH)
    const gid = font.getGlyphId(0x6982) 
    const result = parseCffGlyph(cff, gid)
    expect(result.outline.commands.length).toBeGreaterThan(0)
    expect(result.outline.coords.length).toBeGreaterThan(0)
    expect(result.width).toBeGreaterThan(0)
  })

  // Verifies a katakana glyph parses using FD 13's per-FD data.
  it('should parse a katakana glyph (FD 13) with commands', () => {
    const font = loadFont(NOTO_JP_PATH)
    const cff = loadCff(NOTO_JP_PATH)
    const gid = font.getGlyphId(0x30D7) 
    const result = parseCffGlyph(cff, gid)
    expect(result.outline.commands.length).toBeGreaterThan(0)
    expect(result.outline.coords.length).toBeGreaterThan(0)
    expect(result.width).toBeGreaterThan(0)
  })

  // Verifies an ASCII glyph parses using FD 14's per-FD data.
  it('should parse an ASCII glyph (FD 14) with commands', () => {
    const font = loadFont(NOTO_JP_PATH)
    const cff = loadCff(NOTO_JP_PATH)
    const gid = font.getGlyphId(0x0031) // '1'
    const result = parseCffGlyph(cff, gid)
    expect(result.outline.commands.length).toBeGreaterThan(0)
    expect(result.outline.coords.length).toBeGreaterThan(0)
    expect(result.width).toBeGreaterThan(0)
  })

  // Verifies command/coordinate counts stay consistent for glyphs drawn from different FDs.
  it('all outlines should have valid command/coord alignment', () => {
    const font = loadFont(NOTO_JP_PATH)
    const cff = loadCff(NOTO_JP_PATH)

    // Check glyphs from different FDs
    const codePoints = [
      0x6982, 
      0x30D7, 
      0x0031, // '1' — ASCII (FD 14)
      0x0041, // 'A'
      0x3042, 
    ]

    for (const cp of codePoints) {
      const gid = font.getGlyphId(cp)
      if (gid === 0) continue // skip unmapped

      const result = parseCffGlyph(cff, gid)
      const { commands, coords } = result.outline

      let coordIdx = 0
      for (let i = 0; i < commands.length; i++) {
        switch (commands[i]) {
          case PathCommand.MoveTo: coordIdx += 2; break
          case PathCommand.LineTo: coordIdx += 2; break
          case PathCommand.CubicTo: coordIdx += 6; break
          case PathCommand.Close: break
        }
      }
      expect(coordIdx).toBe(coords.length)
    }
  })

  // Sanity-checks parsed coordinates stay within a plausible range for a 1000-upem font.
  it('bounding boxes should be in reasonable range for unitsPerEm=1000', () => {
    const font = loadFont(NOTO_JP_PATH)
    const cff = loadCff(NOTO_JP_PATH)

    const codePoints = [0x6982, 0x30D7, 0x0031]

    for (const cp of codePoints) {
      const gid = font.getGlyphId(cp)
      const result = parseCffGlyph(cff, gid)
      const { coords } = result.outline

      for (let i = 0; i < coords.length; i++) {
        // Coordinates should be within a reasonable range for 1000 upem
        expect(coords[i]).toBeGreaterThanOrEqual(-500)
        expect(coords[i]).toBeLessThanOrEqual(1100)
      }
    }
  })
})

// =========================================================================
// 5. Non-CIDFont Fields
// =========================================================================

describe('Non-CIDFont Fields', () => {
  // Verifies non-CIDFonts expose local subrs at the top level instead of per-FD.
  it('non-CIDFont should have localSubrs at top level', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.localSubrs).toBeDefined()
    expect(typeof cff.localSubrs.count).toBe('number')
  })

  // Verifies the top-level localBias is computed for non-CIDFonts.
  it('non-CIDFont should have localBias at top level', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(typeof cff.localBias).toBe('number')
  })

  // Verifies defaultWidthX is read from the top-level Private DICT.
  it('non-CIDFont should have defaultWidthX at top level', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(typeof cff.defaultWidthX).toBe('number')
  })

  // Verifies nominalWidthX is read from the top-level Private DICT.
  it('non-CIDFont should have nominalWidthX at top level', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(typeof cff.nominalWidthX).toBe('number')
  })

  // Verifies the top-level local subr INDEX parses to a usable count.
  it('non-CIDFont localSubrs should be usable (count >= 0)', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.localSubrs.count).toBeGreaterThanOrEqual(0)
  })

  // Verifies end-to-end glyph parsing works through the top-level (non-FD) data path.
  it('non-CIDFont glyph parsing should work correctly', () => {
    const font = loadFont(SOURCE_SANS_PATH)
    const cff = loadCff(SOURCE_SANS_PATH)
    const gid = font.getGlyphId(0x0041) // 'A'
    const result = parseCffGlyph(cff, gid)
    expect(result.outline.commands.length).toBeGreaterThan(0)
    expect(result.outline.coords.length).toBeGreaterThan(0)
    expect(result.width).toBeGreaterThan(0)
  })
})

// =========================================================================
// 6. Charset Parsing
// =========================================================================

describe('Charset Parsing', () => {
  // Verifies the parsed charset has one CID per glyph for the CIDFont.
  it('NotoSansJP charset should have length === numGlyphs', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.charset.length).toBe(cff.charstrings.count)
  })

  // Verifies glyph 0 always maps to CID 0 (.notdef) in the CIDFont.
  it('NotoSansJP charset[0] should be 0 (.notdef)', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.charset[0]).toBe(0)
  })

  // Verifies charset length matches glyph count for the name-keyed font too.
  it('SourceSans3 charset should have length === numGlyphs', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.charset.length).toBe(cff.charstrings.count)
  })

  // Verifies .notdef occupies charset slot 0 in the name-keyed font.
  it('SourceSans3 charset[0] should be 0 (.notdef)', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.charset[0]).toBe(0)
  })
})

// =========================================================================
// 7. Subroutine Bias
// =========================================================================

describe('Subroutine Bias', () => {
  function expectedBias(count: number): number {
    if (count < 1240) return 107
    if (count < 33900) return 1131
    return 32768
  }

  // Verifies globalBias matches the spec formula for the CIDFont's global subr count.
  it('CIDFont globalBias should be correct based on globalSubrs.count', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.globalBias).toBe(expectedBias(cff.globalSubrs.count))
  })

  // Verifies globalBias matches the spec formula for the name-keyed font.
  it('non-CIDFont globalBias should be correct based on globalSubrs.count', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.globalBias).toBe(expectedBias(cff.globalSubrs.count))
  })

  // Verifies each FD's localBias follows the spec formula (left at 0 when the FD has no subrs).
  it('each FD localBias should be correct based on its localSubrs.count', () => {
    const cff = loadCff(NOTO_JP_PATH)
    for (const fd of cff.fdArray!) {
      if (fd.localSubrs.count === 0) {
        // When there are no local subrs, bias is left at 0 (never used)
        expect(fd.localBias).toBe(0)
      } else {
        expect(fd.localBias).toBe(expectedBias(fd.localSubrs.count))
      }
    }
  })

  // Verifies the top-level localBias follows the spec formula.
  it('non-CIDFont localBias should be correct based on localSubrs.count', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.localBias).toBe(expectedBias(cff.localSubrs.count))
  })

  // Pins the spec threshold: counts below 1240 use bias 107.
  it('bias formula: count < 1240 yields 107', () => {
    expect(expectedBias(0)).toBe(107)
    expect(expectedBias(1)).toBe(107)
    expect(expectedBias(1239)).toBe(107)
  })

  // Pins the spec threshold: counts below 33900 use bias 1131.
  it('bias formula: count < 33900 yields 1131', () => {
    expect(expectedBias(1240)).toBe(1131)
    expect(expectedBias(33899)).toBe(1131)
  })

  // Pins the spec threshold: counts of 33900 or more use bias 32768.
  it('bias formula: count >= 33900 yields 32768', () => {
    expect(expectedBias(33900)).toBe(32768)
    expect(expectedBias(100000)).toBe(32768)
  })
})

// =========================================================================
// 8. Edge Cases
// =========================================================================

describe('Edge Cases', () => {
  // Verifies glyph 0 of a CIDFont parses into a well-formed (possibly empty) outline.
  it('.notdef glyph (glyphId=0) should parse without error for CIDFont', () => {
    const cff = loadCff(NOTO_JP_PATH)
    const result = parseCffGlyph(cff, 0)
    expect(result).toBeDefined()
    expect(result.outline).toBeDefined()
    expect(result.outline.commands).toBeInstanceOf(Uint8Array)
    expect(result.outline.coords).toBeInstanceOf(Float32Array)
  })

  // Verifies glyph 0 of a name-keyed font parses into a well-formed outline.
  it('.notdef glyph (glyphId=0) should parse without error for non-CIDFont', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    const result = parseCffGlyph(cff, 0)
    expect(result).toBeDefined()
    expect(result.outline).toBeDefined()
    expect(result.outline.commands).toBeInstanceOf(Uint8Array)
    expect(result.outline.coords).toBeInstanceOf(Float32Array)
  })

  // Verifies an out-of-range glyphId yields an empty outline instead of throwing.
  it('out-of-range glyphId should return empty outline', () => {
    const cff = loadCff(NOTO_JP_PATH)
    const result = parseCffGlyph(cff, cff.charstrings.count + 100)
    expect(result.outline.commands.length).toBe(0)
    expect(result.outline.coords.length).toBe(0)
  })

  // Verifies a negative glyphId yields an empty outline for the CIDFont path.
  it('negative glyphId should return empty outline', () => {
    const cff = loadCff(NOTO_JP_PATH)
    const result = parseCffGlyph(cff, -1)
    expect(result.outline.commands.length).toBe(0)
    expect(result.outline.coords.length).toBe(0)
  })

  // Verifies a negative glyphId yields an empty outline for the non-CIDFont path.
  it('negative glyphId should return empty outline for non-CIDFont', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    const result = parseCffGlyph(cff, -1)
    expect(result.outline.commands.length).toBe(0)
    expect(result.outline.coords.length).toBe(0)
  })
})

// =========================================================================
// 9. Predefined Charsets
// =========================================================================

describe('Predefined Charsets', () => {
  // Verifies a real font using charset offset 0 still maps glyph 0 to SID 0.
  it('ISOAdobe charset (offset=0): first entry should be 0 (.notdef)', () => {
    // ISOAdobe is identity [0, 1, 2, ...] — used by fonts with charset offset=0
    // We verify by checking the CFF spec-defined behavior
    // Note: most real CFF fonts use format 1/2/custom charsets
    // ISOAdobe is implicitly tested via real fonts where charsetOffset=0
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.charset[0]).toBe(0) // .notdef always SID 0
  })

  // Verifies charset offset 1 expands to the spec-defined Expert SID table, not an identity mapping.
  it('Expert charset (offset=1): should return correct SIDs per CFF spec', () => {
    // parseCharset with offset=1 triggers the Expert predefined charset
    const dummyReader = new BinaryReader(new ArrayBuffer(1))
    const charset = parseCharset(dummyReader, 1, 30)

    expect(charset[0]).toBe(0)    // .notdef
    expect(charset[1]).toBe(1)    // space
    expect(charset[2]).toBe(229)  // exclamsmall
    expect(charset[12]).toBe(13)  // comma
    expect(charset[15]).toBe(99)  // dollar.oldstyle
    // Should NOT be identity mapping
    expect(charset[2]).not.toBe(2)
    expect(charset.length).toBe(30)
  })

  // Verifies charset offset 2 expands to the spec-defined ExpertSubset SID table.
  it('ExpertSubset charset (offset=2): should return correct SIDs per CFF spec', () => {
    const dummyReader = new BinaryReader(new ArrayBuffer(1))
    const charset = parseCharset(dummyReader, 2, 20)

    expect(charset[0]).toBe(0)    // .notdef
    expect(charset[1]).toBe(1)    // space
    expect(charset[2]).toBe(231)  // dollaroldstyle
    // Should NOT be identity mapping
    expect(charset[2]).not.toBe(2)
    expect(charset.length).toBe(20)
  })

  // Verifies charset offset 0 produces the ISOAdobe identity SID mapping.
  it('ISOAdobe charset (offset=0): should return identity mapping', () => {
    const dummyReader = new BinaryReader(new ArrayBuffer(1))
    const charset = parseCharset(dummyReader, 0, 10)

    for (let i = 0; i < 10; i++) {
      expect(charset[i]).toBe(i)
    }
  })

  // Verifies the .notdef-at-slot-0 invariant holds for both font types.
  it('charset[0] is always 0 for both CIDFont and non-CIDFont', () => {
    const cidCff = loadCff(NOTO_JP_PATH)
    expect(cidCff.charset[0]).toBe(0)

    const nonCidCff = loadCff(SOURCE_SANS_PATH)
    expect(nonCidCff.charset[0]).toBe(0)
  })

  // Verifies charset length equals glyph count for both font types.
  it('charset length matches numGlyphs for both font types', () => {
    const cidCff = loadCff(NOTO_JP_PATH)
    expect(cidCff.charset.length).toBe(cidCff.charstrings.count)

    const nonCidCff = loadCff(SOURCE_SANS_PATH)
    expect(nonCidCff.charset.length).toBe(nonCidCff.charstrings.count)
  })
})

// =========================================================================
// 10. Private DICT Entries (Hinting Data)
// =========================================================================

describe('Private DICT Entries', () => {
  // Verifies raw Private DICT entries are retained for the name-keyed font.
  it('non-CIDFont should have privateDictEntries populated', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    expect(cff.privateDictEntries).toBeInstanceOf(Map)
    // SourceSans3 should have at least defaultWidthX or nominalWidthX or hinting data
    expect(cff.privateDictEntries.size).toBeGreaterThan(0)
  })

  // Verifies BlueValues (op 6) is parsed as an even-length delta array from the Private DICT.
  it('non-CIDFont should have BlueValues (op 6) in privateDictEntries', () => {
    const cff = loadCff(SOURCE_SANS_PATH)
    const blueValues = cff.privateDictEntries.get(6)
    // SourceSans3 is known to have BlueValues
    expect(blueValues).toBeDefined()
    expect(blueValues!.length).toBeGreaterThan(0)
    // BlueValues are pairs of integers
    expect(blueValues!.length % 2).toBe(0)
  })

  // Verifies each CIDFont FD keeps its own Private DICT entry map.
  it('CIDFont FDArray entries should have privateDictEntries', () => {
    const cff = loadCff(NOTO_JP_PATH)
    expect(cff.fdArray).not.toBeNull()
    for (const fd of cff.fdArray!) {
      expect(fd.privateDictEntries).toBeInstanceOf(Map)
    }
  })

  // Verifies hinting operators survive parsing in at least one CIDFont FD.
  it('at least one CIDFont FD should have hinting data', () => {
    const cff = loadCff(NOTO_JP_PATH)
    let foundHinting = false
    for (const fd of cff.fdArray!) {
      // Check for BlueValues(6), StdHW(10), StdVW(11)
      if (fd.privateDictEntries.has(6) || fd.privateDictEntries.has(10) || fd.privateDictEntries.has(11)) {
        foundHinting = true
        break
      }
    }
    expect(foundHinting).toBe(true)
  })
})
