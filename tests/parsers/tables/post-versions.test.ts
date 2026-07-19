import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parsePost } from '../../../src/parsers/tables/post.js'

/**
 * post table version coverage (synthetic binaries):
 * - v1.0: built-in Macintosh standard 258 glyph names
 * - v2.5 (deprecated): offset-based name derivation
 * - v3.0: no glyph names
 * - v4.0: composite-printer character-code names
 */

function buildPostHeader(versionFixed: number): BinaryWriter {
  const w = new BinaryWriter()
  w.writeUint32(versionFixed) // version (Fixed)
  w.writeUint32(0) // italicAngle
  w.writeInt16(-100) // underlinePosition
  w.writeInt16(50) // underlineThickness
  w.writeUint32(0) // isFixedPitch
  w.writeUint32(0); w.writeUint32(0) // minMemType42, maxMemType42
  w.writeUint32(0); w.writeUint32(0) // minMemType1, maxMemType1
  return w
}

describe('post table versions', () => {
  describe('version 1.0', () => {
    const post = parsePost(new BinaryReader(buildPostHeader(0x00010000).toArrayBuffer()))

    // Verifies v1.0 exposes the complete built-in standard name table.
    it('provides all 258 Macintosh standard glyph names', () => {
      expect(post.version).toBe(1.0)
      expect(post.glyphNames).toBeDefined()
      expect(post.glyphNames!.length).toBe(258)
    })

    // Verifies the standard order at known positions (first, common, last).
    it('names follow the standard order', () => {
      const names = post.glyphNames!
      expect(names[0]).toBe('.notdef')
      expect(names[1]).toBe('.null')
      expect(names[2]).toBe('nonmarkingreturn')
      expect(names[3]).toBe('space')
      expect(names[4]).toBe('exclam')
      expect(names[36]).toBe('A')
      expect(names[68]).toBe('a')
      expect(names[257]).toBe('dcroat')
    })

    it('rejects trailing data', () => {
      const w = buildPostHeader(0x00010000)
      w.writeUint8(0)
      expect(() => parsePost(new BinaryReader(w.toArrayBuffer()))).toThrow(
        'post version 1.0 table length must be 32, got 33',
      )
    })

    it('rejects maxp.numGlyphs values other than the standard Macintosh glyph count', () => {
      expect(() => parsePost(new BinaryReader(buildPostHeader(0x00010000).toArrayBuffer()), {
        expectedGlyphCount: 257,
      })).toThrow(
        'post version 1.0 requires maxp.numGlyphs 258, got 257',
      )
    })
  })

  describe('version 2.5 (deprecated)', () => {
    // Verifies offset-based derivation: name index = glyph index + offset.
    it('derives names via per-glyph offsets into the standard table', () => {
      const w = buildPostHeader(0x00025000)
      w.writeUint16(4) // numGlyphs
      // offsets: glyph0 -> 0+0, glyph1 -> 1+2, glyph2 -> 2-1, glyph3 -> 3+10
      w.writeUint8(0)
      w.writeUint8(2)
      w.writeUint8(0xFF) // -1
      w.writeUint8(10)
      const post = parsePost(new BinaryReader(w.toArrayBuffer()))

      expect(post.glyphNames).toEqual([
        '.notdef', // STANDARD_NAMES[0]
        'space', // STANDARD_NAMES[3]
        '.null', // STANDARD_NAMES[1]
        'asterisk', // STANDARD_NAMES[13]
      ])
    })

    // Verifies a derived name index outside the 258-entry table is rejected (malformed font).
    it('throws when a derived name index is out of range', () => {
      const w = buildPostHeader(0x00025000)
      w.writeUint16(1)
      w.writeUint8(0xFF) // glyph0 -> index -1
      expect(() => parsePost(new BinaryReader(w.toArrayBuffer()))).toThrow(/post v2\.5/)
    })

    it('rejects malformed lengths', () => {
      const missingNumGlyphs = buildPostHeader(0x00025000)
      expect(() => parsePost(new BinaryReader(missingNumGlyphs.toArrayBuffer()))).toThrow(
        'post version 2.5 table is missing numGlyphs',
      )

      const shortOffsets = buildPostHeader(0x00025000)
      shortOffsets.writeUint16(2)
      shortOffsets.writeUint8(0)
      expect(() => parsePost(new BinaryReader(shortOffsets.toArrayBuffer()))).toThrow(
        'post version 2.5 table length must be 36, got 35',
      )
    })

    it('rejects numGlyphs that differ from maxp.numGlyphs', () => {
      const w = buildPostHeader(0x00025000)
      w.writeUint16(1)
      w.writeUint8(0)

      expect(() => parsePost(new BinaryReader(w.toArrayBuffer()), {
        expectedGlyphCount: 2,
      })).toThrow(
        'post version 2.5 numGlyphs must match maxp.numGlyphs 2, got 1',
      )
    })
  })

  describe('version 3.0', () => {
    // Verifies v3.0 carries no glyph names.
    it('has no glyph names', () => {
      const post = parsePost(new BinaryReader(buildPostHeader(0x00030000).toArrayBuffer()))
      expect(post.version).toBe(3.0)
      expect(post.glyphNames).toBeUndefined()
    })

    it('rejects trailing data', () => {
      const w = buildPostHeader(0x00030000)
      w.writeUint8(0)
      expect(() => parsePost(new BinaryReader(w.toArrayBuffer()))).toThrow(
        'post version 3.0 table length must be 32, got 33',
      )
    })
  })

  describe('version 4.0', () => {
    it('exposes every composite-printer character code and synthesized name', () => {
      const w = buildPostHeader(0x00040000)
      w.writeUint16(0x0041)
      w.writeUint16(0x4E00)
      w.writeUint16(0xFFFF)
      const post = parsePost(new BinaryReader(w.toArrayBuffer()), { expectedGlyphCount: 3 })
      expect(Array.from(post.glyphNameCharacterCodes!)).toEqual([0x0041, 0x4E00, 0xFFFF])
      expect(post.glyphNames).toEqual(['a0041', 'a4E00', null])
    })

    it('requires one complete uint16 character code per maxp glyph', () => {
      const short = buildPostHeader(0x00040000)
      short.writeUint16(0x0041)
      expect(() => parsePost(new BinaryReader(short.toArrayBuffer()), { expectedGlyphCount: 2 })).toThrow(
        'post version 4.0 table length must be 36, got 34',
      )

      const odd = buildPostHeader(0x00040000)
      odd.writeUint8(0)
      expect(() => parsePost(new BinaryReader(odd.toArrayBuffer()))).toThrow(/complete uint16 character codes/)
    })
  })

  describe('version 2.0 regression', () => {
    // Verifies the existing v2.0 path is unaffected: standard indices + custom names.
    it('resolves standard and custom name indices', () => {
      const w = buildPostHeader(0x00020000)
      w.writeUint16(3) // numGlyphs
      w.writeUint16(0) // glyph0 -> standard '.notdef'
      w.writeUint16(3) // glyph1 -> standard 'space'
      w.writeUint16(258) // glyph2 -> first custom name
      w.writeUint8(4) // length
      w.writeUint8(0x75); w.writeUint8(0x6E); w.writeUint8(0x69); w.writeUint8(0x30) // "uni0"
      const post = parsePost(new BinaryReader(w.toArrayBuffer()))

      expect(post.glyphNames).toEqual(['.notdef', 'space', 'uni0'])
    })

    it('rejects missing numGlyphs and short glyphNameIndex arrays', () => {
      const missingNumGlyphs = buildPostHeader(0x00020000)
      expect(() => parsePost(new BinaryReader(missingNumGlyphs.toArrayBuffer()))).toThrow(
        'post version 2.0 table is missing numGlyphs',
      )

      const shortNameIndex = buildPostHeader(0x00020000)
      shortNameIndex.writeUint16(2)
      shortNameIndex.writeUint16(0)
      expect(() => parsePost(new BinaryReader(shortNameIndex.toArrayBuffer()))).toThrow(
        'post version 2.0 table length must be at least 38, got 36',
      )
    })

    it('rejects numGlyphs that differ from maxp.numGlyphs', () => {
      const w = buildPostHeader(0x00020000)
      w.writeUint16(1)
      w.writeUint16(0)

      expect(() => parsePost(new BinaryReader(w.toArrayBuffer()), {
        expectedGlyphCount: 2,
      })).toThrow(
        'post version 2.0 numGlyphs must match maxp.numGlyphs 2, got 1',
      )
    })

    it('rejects missing custom name string data', () => {
      const missingString = buildPostHeader(0x00020000)
      missingString.writeUint16(1)
      missingString.writeUint16(258)
      expect(() => parsePost(new BinaryReader(missingString.toArrayBuffer()))).toThrow(
        'post version 2.0 custom glyph name 0 is missing length byte',
      )
    })

    it('ignores trailing padding after the referenced name strings', () => {
      // Real fonts (e.g. macOS Kailasa) leave padding bytes after the last
      // referenced name; they must not cause rejection.
      const extraString = buildPostHeader(0x00020000)
      extraString.writeUint16(1)
      extraString.writeUint16(0) // standard name index → no custom strings needed
      extraString.writeUint8(1)
      extraString.writeUint8(0x41)
      const post = parsePost(new BinaryReader(extraString.toArrayBuffer()))
      expect(post.glyphNames?.[0]).toBe('.notdef')
    })

    it('rejects malformed custom name strings', () => {
      const tooLong = buildPostHeader(0x00020000)
      tooLong.writeUint16(1)
      tooLong.writeUint16(258)
      tooLong.writeUint8(64)
      for (let i = 0; i < 64; i++) tooLong.writeUint8(0x41)
      expect(() => parsePost(new BinaryReader(tooLong.toArrayBuffer()))).toThrow(
        'post version 2.0 custom glyph name 0 length must be <= 63, got 64',
      )

      const truncated = buildPostHeader(0x00020000)
      truncated.writeUint16(1)
      truncated.writeUint16(258)
      truncated.writeUint8(4)
      truncated.writeUint8(0x41)
      expect(() => parsePost(new BinaryReader(truncated.toArrayBuffer()))).toThrow(
        'post version 2.0 custom glyph name 0 exceeds table length',
      )

      // A glyph name with a non-Adobe-convention character (here a hyphen) is
      // kept as-is rather than rejected — the name is only a lookup identifier.
      const nonStandardChar = buildPostHeader(0x00020000)
      nonStandardChar.writeUint16(1)
      nonStandardChar.writeUint16(258)
      nonStandardChar.writeUint8(3)
      nonStandardChar.writeUint8(0x41)
      nonStandardChar.writeUint8(0x2D)
      nonStandardChar.writeUint8(0x42)
      expect(parsePost(new BinaryReader(nonStandardChar.toArrayBuffer())).glyphNames?.[0]).toBe('A-B')
    })
  })

  describe('unsupported versions', () => {
    it('rejects unknown versions and truncated headers', () => {
      expect(() => parsePost(new BinaryReader(buildPostHeader(0x00050000).toArrayBuffer()))).toThrow(
        'Unsupported post table version: 0x00050000',
      )
      const truncated = buildPostHeader(0x00030000).toArrayBuffer().slice(0, 31)
      expect(() => parsePost(new BinaryReader(truncated))).toThrow(
        'post table length must be at least 32, got 31',
      )
    })

    it('requires version 3.0 for CFF version 1 outlines', () => {
      const w = buildPostHeader(0x00020000)
      w.writeUint16(1)   // numGlyphs
      w.writeUint16(258) // glyphNameIndex[0] -> first custom name
      w.writeUint8(3); w.writeUint8(0x41); w.writeUint8(0x42); w.writeUint8(0x43) // "ABC"
      expect(() => parsePost(new BinaryReader(w.toArrayBuffer()), { outlineKind: 'cff1' })).toThrow(
        'CFF version 1 outlines require post table version 3.0, got 2',
      )

      expect(() => parsePost(new BinaryReader(buildPostHeader(0x00040000).toArrayBuffer()), {
        outlineKind: 'cff2',
      })).toThrow('post table version 4 requires TrueType outlines')
    })

    it('rejects invalid PostScript memory bounds', () => {
      const type42 = buildPostHeader(0x00030000).toArrayBuffer()
      const type42View = new DataView(type42)
      type42View.setUint32(16, 16)
      type42View.setUint32(20, 15)
      expect(() => parsePost(new BinaryReader(type42))).toThrow(
        'post maxMemType42 15 must be greater than or equal to minMemType42 16',
      )

      const type1 = buildPostHeader(0x00030000).toArrayBuffer()
      const type1View = new DataView(type1)
      type1View.setUint32(24, 16)
      type1View.setUint32(28, 15)
      expect(() => parsePost(new BinaryReader(type1))).toThrow(
        'post maxMemType1 15 must be greater than or equal to minMemType1 16',
      )
    })

    it('exposes all PostScript memory fields', () => {
      const buffer = buildPostHeader(0x00030000).toArrayBuffer()
      const view = new DataView(buffer)
      view.setUint32(16, 11)
      view.setUint32(20, 22)
      view.setUint32(24, 33)
      view.setUint32(28, 44)
      const post = parsePost(new BinaryReader(buffer))
      expect(post).toMatchObject({ minMemType42: 11, maxMemType42: 22, minMemType1: 33, maxMemType1: 44 })
    })
  })
})
