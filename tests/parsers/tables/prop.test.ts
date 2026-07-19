import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import {
  parseProp,
  getComplementOffset,
  PROP_FLOATER,
  PROP_HANG_OFF_LEFT_TOP,
  PROP_USE_COMPLEMENTARY_BRACKET,
  PROP_DIRECTIONALITY_MASK,
} from '../../../src/parsers/tables/prop.js'

function buildPropFormat0(defaultProperties: number, version = 0x00030000, extraBytes = 0): ArrayBuffer {
  const buf = new ArrayBuffer(8 + extraBytes)
  const view = new DataView(buf)
  view.setUint32(0, version)
  view.setUint16(4, 0)
  view.setUint16(6, defaultProperties)
  return buf
}

function buildPropFormat1(
  defaultProperties: number,
  firstGlyph: number,
  values: number[],
  version = 0x00030000,
): ArrayBuffer {
  // header(8) + lookup format 8: format(2) + firstGlyph(2) + glyphCount(2) + values
  const buf = new ArrayBuffer(8 + 6 + values.length * 2)
  const view = new DataView(buf)
  view.setUint32(0, version)
  view.setUint16(4, 1)
  view.setUint16(6, defaultProperties)
  view.setUint16(8, 8) // lookup format 8
  view.setUint16(10, firstGlyph)
  view.setUint16(12, values.length)
  for (let i = 0; i < values.length; i++) {
    view.setUint16(14 + i * 2, values[i]!)
  }
  return buf
}

function buildPropFormat1Lookup0(defaultProperties: number, values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + 2 + values.length * 2)
  const view = new DataView(buf)
  view.setUint32(0, 0x00030000)
  view.setUint16(4, 1)
  view.setUint16(6, defaultProperties)
  view.setUint16(8, 0)
  for (let i = 0; i < values.length; i++) {
    view.setUint16(10 + i * 2, values[i]!)
  }
  return buf
}

function buildPropFormat1Lookup10(defaultProperties: number, unitSize: number, firstGlyph: number, values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + 8 + values.length * unitSize)
  const view = new DataView(buf)
  let pos = 0

  view.setUint32(pos, 0x00030000); pos += 4
  view.setUint16(pos, 1); pos += 2
  view.setUint16(pos, defaultProperties); pos += 2
  view.setUint16(pos, 10); pos += 2
  view.setUint16(pos, unitSize); pos += 2
  view.setUint16(pos, firstGlyph); pos += 2
  view.setUint16(pos, values.length); pos += 2
  for (const value of values) {
    if (unitSize === 1) {
      view.setUint8(pos, value); pos += 1
    } else if (unitSize === 2) {
      view.setUint16(pos, value); pos += 2
    } else if (unitSize === 4) {
      view.setUint32(pos, value); pos += 4
    } else if (unitSize === 8) {
      view.setBigUint64(pos, BigInt(value)); pos += 8
    }
  }
  return buf
}

describe('prop table parser', () => {
  it('should use the default properties for format 0', () => {
    const table = parseProp(new BinaryReader(buildPropFormat0(0x000B)))

    expect(table.format).toBe(0)
    expect(table.defaultProperties).toBe(0x000B)
    expect(table.getProperties(0)).toBe(0x000B)
    expect(table.getProperties(1234)).toBe(0x000B)
  })

  it('should return per-glyph properties for format 1', () => {
    // Glyph 11 = '(' style bracket: swap + complement offset +1 + class 11
    // Glyph 12 = floater + hang-off-left
    const table = parseProp(new BinaryReader(buildPropFormat1(0, 11, [0x110B, 0xC000])))

    expect(table.format).toBe(1)
    expect(table.getProperties(11)).toBe(0x110B)
    expect(table.getProperties(12)).toBe(0xC000)
    expect(table.getProperties(13)).toBe(0) // default

    const props11 = table.getProperties(11)
    expect(props11 & PROP_USE_COMPLEMENTARY_BRACKET).toBeTruthy()
    expect(props11 & PROP_DIRECTIONALITY_MASK).toBe(11)
    expect(getComplementOffset(props11)).toBe(1)

    const props12 = table.getProperties(12)
    expect(props12 & PROP_FLOATER).toBeTruthy()
    expect(props12 & PROP_HANG_OFF_LEFT_TOP).toBeTruthy()
  })

  it('should read format 1 properties from lookup format 0', () => {
    const table = parseProp(new BinaryReader(buildPropFormat1Lookup0(0x000B, [0, 0x110B, 0xC000])), 3)

    expect(table.getProperties(0)).toBe(0)
    expect(table.getProperties(1)).toBe(0x110B)
    expect(table.getProperties(2)).toBe(0xC000)
    expect(table.getProperties(3)).toBe(0x000B)
  })

  it('should reject lookup formats outside the prop specification', () => {
    const buf = buildPropFormat1Lookup10(0x000B, 1, 4, [0x01, 0x02])

    expect(() => parseProp(new BinaryReader(buf))).toThrow('Unsupported prop lookup format: 10')
  })

  it('should sign-extend the complement offset', () => {
    // Nibble 0xF = -1, nibble 0x1 = +1
    expect(getComplementOffset(0x1F00)).toBe(-1)
    expect(getComplementOffset(0x1100)).toBe(1)
    expect(getComplementOffset(0x1E00)).toBe(-2)
    expect(getComplementOffset(0x0000)).toBe(0)
  })

  it('should reject unsupported versions', () => {
    expect(() => parseProp(new BinaryReader(buildPropFormat0(0, 0x00040000)))).toThrow(
      'Unsupported prop table version: 0x00040000',
    )
  })

  it('should reject unsupported prop formats', () => {
    const buf = buildPropFormat0(0)
    new DataView(buf).setUint16(4, 2)

    expect(() => parseProp(new BinaryReader(buf))).toThrow('Unsupported prop format: 2')
  })

  it('should reject format 0 tables with lookup data', () => {
    expect(() => parseProp(new BinaryReader(buildPropFormat0(0, 0x00030000, 2)))).toThrow(
      'prop format 0 must not contain lookup data',
    )
  })

  it('should reject reserved property bits', () => {
    expect(() => parseProp(new BinaryReader(buildPropFormat0(0x0020)))).toThrow(
      'prop defaultProperties reserved bits 0x0060 must be zero',
    )

    expect(() => parseProp(new BinaryReader(buildPropFormat1(0, 4, [0x0060])))).toThrow(
      'prop glyph 4 properties reserved bits 0x0060 must be zero',
    )
  })

  it('should reject attaches-on-right in version 1.0 tables', () => {
    expect(() => parseProp(new BinaryReader(buildPropFormat0(0x0080, 0x00010000)))).toThrow(
      'prop defaultProperties attaches-on-right bit is invalid in prop version 1.0',
    )
  })

  it('should require version 3.0 for directionality classes above 11', () => {
    expect(() => parseProp(new BinaryReader(buildPropFormat0(12, 0x00020000)))).toThrow(
      'prop defaultProperties directionality class 12 requires prop version 3.0',
    )

    const table = parseProp(new BinaryReader(buildPropFormat0(12, 0x00030000)))
    expect(table.getProperties(0)).toBe(12)
  })

  it('should reject complementary glyph offsets outside numGlyphs', () => {
    expect(() => parseProp(new BinaryReader(buildPropFormat1(0, 0, [0x1F0B])), 1)).toThrow(
      'prop glyph 0 properties complementary glyph -1 exceeds numGlyphs 1',
    )
  })
})
