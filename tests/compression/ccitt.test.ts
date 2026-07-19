// CCITT Group 3 / Group 4 uncompressed mode (ITU-T T.4 §4.2.1.3, Table 5;
// referenced by T.6 as the two-dimensional extension 0000001 111). Streams are
// hand-assembled from the specification's code tables.

import { describe, it, expect } from 'vitest'
import { decodeCcittGroup4, decodeCcittOneDimensionalRow, CcittBitReader } from '../../src/compression/ccitt.js'

/** Pack a bit string (spaces ignored) into bytes, zero-padded at the end. */
function bits(s: string): Uint8Array {
  const b = s.replace(/ /g, '')
  const out = new Uint8Array(Math.ceil(b.length / 8))
  for (let i = 0; i < b.length; i++) {
    if (b[i] === '1') out[i >> 3] = out[i >> 3]! | (0x80 >> (i & 7))
  }
  return out
}

describe('CCITT uncompressed mode', () => {
  it('decodes a Group 4 row entered via the extension code, with exit tag colour', () => {
    // Row 1 (16 columns), all in uncompressed mode from position 0:
    //   0000001111  enter uncompressed (extension type 111)
    //   01          white(0) black(1)
    //   1           black(2)
    //   0001        white(3,4,5) black(6)
    //   000001      white(7..11)
    //   0000000011  exit with two white pixels (12,13), tag=1 → next run black
    //   1           V0: black run [14,16) against the all-white first reference
    // Row 2 copies row 1 with six V0 codes — this validates that the changing
    // elements recorded during uncompressed decoding (1,3,6,7,14) are exactly
    // the real pixel transitions used as the next row's reference line.
    const data = bits('0000001111 01 1 0001 000001 0000000011 1 111111')
    expect(Array.from(decodeCcittGroup4(data, 16, 2, true))).toEqual([0x62, 0x03, 0x62, 0x03])
    // BlackIs1 false (PDF default): the same stream with inverted polarity.
    expect(Array.from(decodeCcittGroup4(data, 16, 2, false))).toEqual([0x9D, 0xFC, 0x9D, 0xFC])
  })

  it('decodes a one-dimensional row entered via 000000001111', () => {
    // 8 columns: white run 4, enter uncompressed, black(4), white(5) black(6),
    // exit with zero pixels and tag=0 → next run white, white run 1.
    const reader = new CcittBitReader(bits('1011 000000001111 1 01 00000010 000111'))
    const out: number[] = [0]
    const changes = decodeCcittOneDimensionalRow(reader, out, 0, 8, true)
    expect(out[0]).toBe(0x0A)
    expect(changes).toEqual([4, 5, 6, 7, 8])
  })

  it('decodes the longest exit code (four white pixels)', () => {
    // 8 columns: enter uncompressed, white(0,1) black(2), exit code
    // 000000000010 = four white pixels (3..6) with tag=0, then V0 white [7,8).
    const data = bits('0000001111 001 000000000010 1')
    expect(Array.from(decodeCcittGroup4(data, 8, 1, true))).toEqual([0x20])
  })

  it('drops the speculative changing element when uncompressed pixels continue the run colour', () => {
    // Row 1 (8 columns): horizontal mode white 2 + black 2 (changes 2,4), then
    // uncompressed black(4) — the same colour continues across position 4, so
    // the speculative change pushed at 4 must not survive — exit tag=0, then
    // V0 white [5,8). True transitions: 2 (to black) and 5 (to white).
    // Row 2 copies row 1 with three V0 codes; a phantom change at 4 would make
    // it decode differently (and consume a fourth V0).
    const data = bits('001 0111 11 0000001111 1 00000010 1 111')
    expect(Array.from(decodeCcittGroup4(data, 8, 2, true))).toEqual([0x38, 0x38])
  })

  it('rejects a reserved extension type without PDF damaged-row recovery', () => {
    // Extension type 010 is reserved (T.4 defines only 111).
    const data = bits('0000001 010')
    expect(() => decodeCcittGroup4(data, 8, 1, true)).toThrow(/reserved CCITTFaxDecode extension type/)
  })
})
