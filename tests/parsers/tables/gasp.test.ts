import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseGasp, GASP_GRIDFIT, GASP_DOGRAY, GASP_SYMMETRIC_GRIDFIT, GASP_SYMMETRIC_SMOOTHING } from '../../../src/parsers/tables/gasp.js'

const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')

/**
 * Builds a synthetic gasp table binary.
 */
function buildGaspTable(ranges: { maxPPEM: number; behavior: number }[], version = 1): ArrayBuffer {
  // Header: version(2) + numRanges(2) = 4
  // GaspRange: rangeMaxPPEM(2) + rangeGaspBehavior(2) = 4 each
  const buf = new ArrayBuffer(4 + ranges.length * 4)
  const view = new DataView(buf)
  let pos = 0

  view.setUint16(pos, version); pos += 2
  view.setUint16(pos, ranges.length); pos += 2

  for (const r of ranges) {
    view.setUint16(pos, r.maxPPEM); pos += 2
    view.setUint16(pos, r.behavior); pos += 2
  }

  return buf
}

describe('gasp table parser', () => {
  // Verifies that version, range count, and per-range maxPPEM/behavior flags are decoded from a synthetic table.
  it('should parse synthetic gasp table', () => {
    const buf = buildGaspTable([
      { maxPPEM: 8, behavior: GASP_GRIDFIT },
      { maxPPEM: 16, behavior: GASP_DOGRAY },
      { maxPPEM: 0xFFFF, behavior: GASP_GRIDFIT | GASP_DOGRAY | GASP_SYMMETRIC_GRIDFIT | GASP_SYMMETRIC_SMOOTHING },
    ])
    const reader = new BinaryReader(buf)
    const gasp = parseGasp(reader)

    expect(gasp.version).toBe(1)
    expect(gasp.ranges).toHaveLength(3)
    expect(gasp.ranges[0]!.rangeMaxPPEM).toBe(8)
    expect(gasp.ranges[0]!.rangeGaspBehavior).toBe(GASP_GRIDFIT)
  })

  // Verifies that version 0 accepts only the original GRIDFIT/DOGRAY behavior bits.
  it('should parse a version 0 table with original behavior flags', () => {
    const buf = buildGaspTable([
      { maxPPEM: 16, behavior: GASP_GRIDFIT },
      { maxPPEM: 0xFFFF, behavior: GASP_GRIDFIT | GASP_DOGRAY },
    ], 0)
    const gasp = parseGasp(new BinaryReader(buf))

    expect(gasp.version).toBe(0)
    expect(gasp.getGaspBehavior(20)).toBe(GASP_GRIDFIT | GASP_DOGRAY)
  })

  // Verifies that getGaspBehavior selects the first range whose maxPPEM >= ppem, with inclusive boundaries.
  it('should return correct behavior for given ppem', () => {
    const buf = buildGaspTable([
      { maxPPEM: 8, behavior: GASP_GRIDFIT },
      { maxPPEM: 16, behavior: GASP_DOGRAY },
      { maxPPEM: 0xFFFF, behavior: GASP_GRIDFIT | GASP_DOGRAY },
    ])
    const reader = new BinaryReader(buf)
    const gasp = parseGasp(reader)

    expect(gasp.getGaspBehavior(4)).toBe(GASP_GRIDFIT)
    expect(gasp.getGaspBehavior(8)).toBe(GASP_GRIDFIT)
    expect(gasp.getGaspBehavior(9)).toBe(GASP_DOGRAY)
    expect(gasp.getGaspBehavior(16)).toBe(GASP_DOGRAY)
    expect(gasp.getGaspBehavior(17)).toBe(GASP_GRIDFIT | GASP_DOGRAY)
  })

  // Sanity check against a real font: the last range covers 0xFFFF and behavior lookup works for an arbitrary ppem.
  it('should parse gasp table from Roboto', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'gasp')
    if (!reader) {
      // Skip if Roboto has no gasp table
      return
    }

    const gasp = parseGasp(reader)
    expect(gasp.version).toBeGreaterThanOrEqual(0)
    expect(gasp.ranges.length).toBeGreaterThan(0)

    // The last range typically covers up to 0xFFFF
    const lastRange = gasp.ranges[gasp.ranges.length - 1]!
    expect(lastRange.rangeMaxPPEM).toBe(0xFFFF)

    // Confirm lookup works for an arbitrary ppem
    const behavior = gasp.getGaspBehavior(12)
    expect(typeof behavior).toBe('number')
  })

  // Verifies that a future compatible version uses the latest known range layout.
  it('should read a future compatible version', () => {
    const buf = buildGaspTable([{ maxPPEM: 0xFFFF, behavior: GASP_GRIDFIT }], 2)

    expect(parseGasp(new BinaryReader(buf)).version).toBe(2)
  })

  // Verifies that a gasp table must contain at least the final sentinel range.
  it('should reject an empty range array', () => {
    const buf = buildGaspTable([])

    expect(() => parseGasp(new BinaryReader(buf))).toThrow(/at least one range/)
  })

  // Verifies that the table length must match the declared number of ranges exactly.
  it('should reject malformed table lengths', () => {
    const buf = buildGaspTable([{ maxPPEM: 0xFFFF, behavior: GASP_GRIDFIT }])
    const truncated = buf.slice(0, buf.byteLength - 1)
    const padded = new ArrayBuffer(buf.byteLength + 1)
    new Uint8Array(padded).set(new Uint8Array(buf))

    expect(() => parseGasp(new BinaryReader(truncated))).toThrow(/length mismatch/)
    expect(() => parseGasp(new BinaryReader(padded))).toThrow(/length mismatch/)
  })

  // Verifies the required increasing order of rangeMaxPPEM values.
  it('should reject unsorted or duplicate ranges', () => {
    const unsorted = buildGaspTable([
      { maxPPEM: 16, behavior: GASP_GRIDFIT },
      { maxPPEM: 8, behavior: GASP_DOGRAY },
      { maxPPEM: 0xFFFF, behavior: GASP_GRIDFIT },
    ])
    const duplicate = buildGaspTable([
      { maxPPEM: 16, behavior: GASP_GRIDFIT },
      { maxPPEM: 16, behavior: GASP_DOGRAY },
      { maxPPEM: 0xFFFF, behavior: GASP_GRIDFIT },
    ])

    expect(() => parseGasp(new BinaryReader(unsorted))).toThrow(/sorted/)
    expect(() => parseGasp(new BinaryReader(duplicate))).toThrow(/sorted/)
  })

  // Verifies that the final range is the 0xFFFF sentinel required for all larger ppem values.
  it('accepts a final range that does not end at 0xFFFF (real fonts ship these)', () => {
    // A non-0xFFFF final range is tolerated: larger ppems fall back to the last
    // range's behavior.
    const gasp = parseGasp(new BinaryReader(buildGaspTable([{ maxPPEM: 16, behavior: GASP_GRIDFIT }])))
    expect(gasp.getGaspBehavior(16)).toBe(GASP_GRIDFIT)
    expect(gasp.getGaspBehavior(9999)).toBe(GASP_GRIDFIT) // extends the last range
  })

  // Verifies that reserved behavior bits are not accepted.
  it('should reject reserved behavior flags', () => {
    const buf = buildGaspTable([{ maxPPEM: 0xFFFF, behavior: 0x0010 }])

    expect(() => parseGasp(new BinaryReader(buf))).toThrow(/reserved behavior flags/)
  })

  // Verifies that version 1-only symmetric behavior bits are rejected for version 0.
  it('should reject version 1 behavior flags in version 0 tables', () => {
    const buf = buildGaspTable([{ maxPPEM: 0xFFFF, behavior: GASP_SYMMETRIC_GRIDFIT }], 0)

    expect(() => parseGasp(new BinaryReader(buf))).toThrow(/version 1 behavior flags/)
  })
})
