import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../src/binary/reader.js'
import { BinaryWriter } from '../../src/binary/writer.js'
import { parseCff, parseCffGlyph, parseCffGlyphWithHints } from '../../src/parsers/cff-parser.js'
import { PathCommand } from '../../src/types/glyph.js'

/**
 * CFF seac (accent composition) regression tests.
 * Type 2 charstring spec Appendix C: a 4-argument endchar
 * (adx ady bchar achar) composes a base glyph and an accent glyph selected
 * through the Standard Encoding, with the accent translated by (adx, ady).
 */

/**
 * Builds a minimal CFF table:
 * - header, Name INDEX ("test"), Top DICT (charset + CharStrings offsets),
 *   empty String INDEX, empty Global Subr INDEX, CharStrings INDEX, charset (format 0)
 * - no Private DICT (defaultWidthX = nominalWidthX = 0)
 */
function buildCff(charstrings: number[][], charsetSids: number[]): ArrayBuffer {
  const numGlyphs = charstrings.length
  // fixed-size prefix: header(4) + Name INDEX(9) + Top DICT INDEX(17)
  //                    + String INDEX(2) + Global Subr INDEX(2)
  const charstringsOffset = 34
  let charstringsDataLen = 0
  for (const cs of charstrings) charstringsDataLen += cs.length
  const charstringsIndexLen = 2 + 1 + (numGlyphs + 1) + charstringsDataLen
  const charsetOffset = charstringsOffset + charstringsIndexLen

  const w = new BinaryWriter()
  // header
  w.writeUint8(1); w.writeUint8(0); w.writeUint8(4); w.writeUint8(4)
  // Name INDEX: 1 entry "test"
  w.writeUint16(1)
  w.writeUint8(1) // offSize
  w.writeUint8(1); w.writeUint8(5) // offsets (1-based)
  w.writeUint8(0x74); w.writeUint8(0x65); w.writeUint8(0x73); w.writeUint8(0x74) // "test"
  // Top DICT INDEX: 1 entry, 12 bytes (two int32 operands + operators)
  w.writeUint16(1)
  w.writeUint8(1) // offSize
  w.writeUint8(1); w.writeUint8(13)
  w.writeUint8(29); w.writeInt32(charsetOffset); w.writeUint8(15) // charset
  w.writeUint8(29); w.writeInt32(charstringsOffset); w.writeUint8(17) // CharStrings
  // String INDEX (empty)
  w.writeUint16(0)
  // Global Subr INDEX (empty)
  w.writeUint16(0)
  // CharStrings INDEX
  w.writeUint16(numGlyphs)
  w.writeUint8(1) // offSize
  let off = 1
  w.writeUint8(off)
  for (const cs of charstrings) {
    off += cs.length
    w.writeUint8(off)
  }
  for (const cs of charstrings) {
    for (const b of cs) w.writeUint8(b)
  }
  // charset format 0 (SIDs for GID 1..numGlyphs-1)
  w.writeUint8(0)
  for (let i = 1; i < numGlyphs; i++) {
    w.writeUint16(charsetSids[i]!)
  }
  return w.toArrayBuffer()
}

// Type 2 operand encoding helpers
function enc(value: number): number[] {
  if (value >= -107 && value <= 107) return [value + 139]
  if (value >= 108 && value <= 1131) {
    const v = value - 108
    return [247 + (v >> 8), v & 0xFF]
  }
  if (value >= -1131 && value <= -108) {
    const v = -value - 108
    return [251 + (v >> 8), v & 0xFF]
  }
  return [28, (value >> 8) & 0xFF, value & 0xFF]
}

// base glyph (GID 1, Standard Encoding code 65 'A' -> SID 34):
// square (0,0)-(100,100)
const CS_BASE = [
  ...enc(0), ...enc(0), 21, // rmoveto
  ...enc(100), 6, // hlineto
  ...enc(100), 7, // vlineto
  ...enc(-100), 6, // hlineto
  14, // endchar
]

// accent glyph (GID 2, Standard Encoding code 194 acute -> SID 125):
// square (0,0)-(10,10)
const CS_ACCENT = [
  ...enc(0), ...enc(0), 21,
  ...enc(10), 6,
  ...enc(10), 7,
  ...enc(-10), 6,
  14,
]

// seac composite (GID 3): adx=250 ady=300 bchar=65 achar=194 endchar
const CS_SEAC = [...enc(250), ...enc(300), ...enc(65), ...enc(194), 14]

// seac composite with a leading width operand (GID 4): width=480
const CS_SEAC_WIDTH = [...enc(480), ...enc(250), ...enc(300), ...enc(65), ...enc(194), 14]

// seac referencing a code absent from the charset (GID 5): bchar=66 'B' -> SID 35
const CS_SEAC_MISSING = [...enc(250), ...enc(300), ...enc(66), ...enc(194), 14]

const CHARSET_SIDS = [0, 34, 125, 391, 392, 393]

function makeCff() {
  const buffer = buildCff(
    [[14], CS_BASE, CS_ACCENT, CS_SEAC, CS_SEAC_WIDTH, CS_SEAC_MISSING],
    CHARSET_SIDS,
  )
  return parseCff(new BinaryReader(buffer))
}

describe('CFF seac (4-argument endchar)', () => {
  // Verifies base+accent composition: both outlines merged, the accent translated by (adx, ady).
  it('composes the base and the translated accent outlines', () => {
    const cff = makeCff()
    const { outline } = parseCffGlyph(cff, 3)

    // base square + accent square: 2x (MoveTo + 3 LineTo + Close)
    expect(Array.from(outline.commands)).toEqual([
      PathCommand.MoveTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.Close,
      PathCommand.MoveTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.Close,
    ])
    expect(Array.from(outline.coords)).toEqual([
      // base square (0,0)-(100,100)
      0, 0, 100, 0, 100, 100, 0, 100,
      // accent square translated by (250, 300)
      250, 300, 260, 300, 260, 310, 250, 310,
    ])
  })

  // Verifies the base glyph itself is unaffected (still parses standalone).
  it('base and accent glyphs still parse standalone', () => {
    const cff = makeCff()
    const base = parseCffGlyph(cff, 1)
    expect(base.outline.coords[2]).toBe(100)
    const accent = parseCffGlyph(cff, 2)
    expect(accent.outline.coords[2]).toBe(10)
  })

  // Verifies a leading width operand before the 4 seac args is consumed as the width.
  it('parses the optional width before the seac arguments', () => {
    const cff = makeCff()
    const { outline, width } = parseCffGlyph(cff, 4)

    expect(width).toBe(480) // nominalWidthX (0) + 480
    // composition identical to the no-width variant
    expect(Array.from(outline.coords).slice(8)).toEqual([
      250, 300, 260, 300, 260, 310, 250, 310,
    ])
  })

  // Verifies plain endchar glyphs are not misinterpreted (0 args, no width shift).
  it('does not treat a plain endchar as seac', () => {
    const cff = makeCff()
    const { outline } = parseCffGlyph(cff, 0)
    expect(outline.commands.length).toBe(0)
  })

  // Verifies an accent/base code missing from the charset is rejected (malformed font).
  it('throws when the referenced glyph is not in the charset', () => {
    const cff = makeCff()
    expect(() => parseCffGlyph(cff, 5)).toThrow(/seac/)
  })

  // Verifies the hint-capturing path also returns the composed outline.
  it('parseCffGlyphWithHints returns the composed outline', () => {
    const cff = makeCff()
    const { outline } = parseCffGlyphWithHints(cff, 3)

    expect(outline.commands.length).toBe(10)
    expect(Array.from(outline.coords).slice(8)).toEqual([
      250, 300, 260, 300, 260, 310, 250, 310,
    ])
  })
})
