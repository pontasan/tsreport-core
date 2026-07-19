import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseCvt } from '../../../src/parsers/tables/cvt.js'
import { parseFpgm } from '../../../src/parsers/tables/fpgm.js'
import { parsePrep } from '../../../src/parsers/tables/prep.js'

describe('cvt table parser', () => {
  // Verifies that cvt is read as a raw FWORD (int16) array, preserving negative values.
  it('should parse Int16 array', () => {
    const buf = new ArrayBuffer(6)
    const view = new DataView(buf)
    view.setInt16(0, 100)
    view.setInt16(2, -50)
    view.setInt16(4, 0)

    const cvt = parseCvt(new BinaryReader(buf))
    expect(cvt.length).toBe(3)
    expect(cvt.get(0)).toBe(100)
    expect(cvt.get(1)).toBe(-50)
    expect(cvt.get(2)).toBe(0)
  })

  // Verifies that get() with an index outside the table (or negative) returns 0 as the hinting interpreter expects.
  it('should return 0 for out-of-range index', () => {
    const buf = new ArrayBuffer(4)
    const view = new DataView(buf)
    view.setInt16(0, 42)
    view.setInt16(2, 84)

    const cvt = parseCvt(new BinaryReader(buf))
    expect(cvt.get(99)).toBe(0)
    expect(cvt.get(-1)).toBe(0)
  })

  // Verifies that set() overwrites a single CVT entry (used by WCVTP-style instructions) without touching neighbors.
  it('should support set()', () => {
    const buf = new ArrayBuffer(4)
    const view = new DataView(buf)
    view.setInt16(0, 100)
    view.setInt16(2, 200)

    const cvt = parseCvt(new BinaryReader(buf))
    cvt.set(0, 999)
    expect(cvt.get(0)).toBe(999)
    expect(cvt.get(1)).toBe(200) // unchanged
  })

  // Verifies that a zero-length cvt table parses to an empty array.
  it('should handle empty table', () => {
    const buf = new ArrayBuffer(0)
    const cvt = parseCvt(new BinaryReader(buf))
    expect(cvt.length).toBe(0)
  })
})

describe('fpgm table parser', () => {
  // Verifies that fpgm exposes the whole table verbatim as TrueType function-definition bytecode.
  it('should read bytecode', () => {
    const data = new Uint8Array([0xB0, 0x00, 0x2C, 0xB0, 0x63, 0x2D])
    const buf = data.buffer as ArrayBuffer
    const fpgm = parseFpgm(new BinaryReader(buf))
    expect(fpgm.bytecode).toEqual(data)
  })

  // Verifies that an empty fpgm table yields zero-length bytecode.
  it('should handle empty table', () => {
    const buf = new ArrayBuffer(0)
    const fpgm = parseFpgm(new BinaryReader(buf))
    expect(fpgm.bytecode.length).toBe(0)
  })
})

describe('prep table parser', () => {
  // Verifies that prep exposes the whole table verbatim as the CVT program bytecode.
  it('should read bytecode', () => {
    const data = new Uint8Array([0xB0, 0x20, 0x1A])
    const buf = data.buffer as ArrayBuffer
    const prep = parsePrep(new BinaryReader(buf))
    expect(prep.bytecode).toEqual(data)
  })

  // Verifies that an empty prep table yields zero-length bytecode.
  it('should handle empty table', () => {
    const buf = new ArrayBuffer(0)
    const prep = parsePrep(new BinaryReader(buf))
    expect(prep.bytecode.length).toBe(0)
  })
})
