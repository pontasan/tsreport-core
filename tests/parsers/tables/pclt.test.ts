import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parsePclt } from '../../../src/parsers/tables/pclt.js'

/**
  * PCLT table build (54)
 */

function buildPcltTable(fields: {
  version?: number
  fontNumber?: number
  pitch?: number
  xHeight?: number
  style?: number
  typeFamily?: number
  capHeight?: number
  symbolSet?: number
  typeface?: string
  fileName?: string
  strokeWeight?: number
  widthType?: number
  serifStyle?: number
  reserved?: number
}): ArrayBuffer {
  const buf = new ArrayBuffer(54)
  const view = new DataView(buf)
  let pos = 0

  // version (Fixed 1.0 = 0x00010000)
  view.setUint32(pos, fields.version ?? 0x00010000); pos += 4
  // fontNumber
  view.setUint32(pos, fields.fontNumber ?? 0); pos += 4
  // pitch
  view.setUint16(pos, fields.pitch ?? 0); pos += 2
  // xHeight
  view.setUint16(pos, fields.xHeight ?? 500); pos += 2
  // style
  view.setUint16(pos, fields.style ?? 0); pos += 2
  // typeFamily
  view.setUint16(pos, fields.typeFamily ?? 0x5005); pos += 2
  // capHeight
  view.setUint16(pos, fields.capHeight ?? 700); pos += 2
  // symbolSet
  view.setUint16(pos, fields.symbolSet ?? 0); pos += 2
  // typeface (16 bytes ASCII, null-padded)
  const tf = fields.typeface ?? 'TestFont'
  for (let i = 0; i < 16; i++) {
    view.setUint8(pos++, i < tf.length ? tf.charCodeAt(i) : 0)
  }
  // characterComplement (8 bytes)
  for (let i = 0; i < 8; i++) view.setUint8(pos++, 0xFF)
  // fileName (6 bytes ASCII)
  const fn = fields.fileName ?? 'TEST'
  for (let i = 0; i < 6; i++) {
    view.setUint8(pos++, i < fn.length ? fn.charCodeAt(i) : 0)
  }
  // strokeWeight (int8)
  view.setInt8(pos++, fields.strokeWeight ?? 0)
  // widthType (int8)
  view.setInt8(pos++, fields.widthType ?? 0)
  // serifStyle (uint8)
  view.setUint8(pos++, fields.serifStyle ?? 0x42)
  // reserved (1 byte)
  view.setUint8(pos++, fields.reserved ?? 0)

  return buf
}

describe('PCLT table parser', () => {
  it('should parse synthetic PCLT table', () => {
    const buf = buildPcltTable({
      fontNumber: 12345,
      pitch: 100,
      xHeight: 500,
      style: 0x0041,
      typeFamily: 0x5005,
      capHeight: 700,
      symbolSet: 277,
      typeface: 'Courier',
      strokeWeight: -3,
      widthType: 0,
      serifStyle: 0x42,
    })
    const reader = new BinaryReader(buf)
    const pclt = parsePclt(reader)

    expect(pclt.version).toBe(0x00010000)
    expect(pclt.fontNumber).toBe(12345)
    expect(pclt.pitch).toBe(100)
    expect(pclt.xHeight).toBe(500)
    expect(pclt.style).toBe(0x0041)
    expect(pclt.typeFamily).toBe(0x5005)
    expect(pclt.capHeight).toBe(700)
    expect(pclt.symbolSet).toBe(277)
    expect(pclt.typeface).toBe('Courier')
    expect(pclt.strokeWeight).toBe(-3)
    expect(pclt.widthType).toBe(0)
    expect(pclt.serifStyle).toBe(0x42)
  })

  it('should trim null bytes from typeface and fileName', () => {
    const buf = buildPcltTable({ typeface: 'AB' })
    const reader = new BinaryReader(buf)
    const pclt = parsePclt(reader)

    expect(pclt.typeface).toBe('AB')
    expect(pclt.fileName).toBe('TEST')
  })

  it('should read characterComplement bytes', () => {
    const buf = buildPcltTable({})
    const reader = new BinaryReader(buf)
    const pclt = parsePclt(reader)

    expect(pclt.characterComplement).toBeInstanceOf(Uint8Array)
    expect(pclt.characterComplement.length).toBe(8)
  })

  it('should reject malformed table lengths', () => {
    const buf = buildPcltTable({})
    expect(() => parsePclt(new BinaryReader(buf.slice(0, 53)))).toThrow(/length/)
    const padded = new ArrayBuffer(55)
    new Uint8Array(padded).set(new Uint8Array(buf))
    expect(() => parsePclt(new BinaryReader(padded))).toThrow(/length/)
  })

  it('should reject unsupported versions and non-zero reserved byte', () => {
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ version: 0x00020000 })))).toThrow(/Unsupported PCLT/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ reserved: 1 })))).toThrow(/reserved byte/)
  })

  it('should read the known prefix of a future minor version', () => {
    const bytes = new Uint8Array(56)
    bytes.set(new Uint8Array(buildPcltTable({ version: 0x00010001, reserved: 1 })))
    expect(parsePclt(new BinaryReader(bytes.buffer)).version).toBe(0x00010001)
  })

  it('should reject malformed style fields', () => {
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ style: 0x0400 })))).toThrow(/reserved high bits/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ style: 18 << 5 })))).toThrow(/structure/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ style: 5 << 2 })))).toThrow(/width value 5/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ style: 3 })))).toThrow(/posture/)
  })

  it('should reject reserved typeFamily vendor codes', () => {
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ typeFamily: 0x0005 })))).toThrow(/vendor code/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ typeFamily: 0x8005 })))).toThrow(/vendor code/)
  })

  it('should reject invalid strokeWeight and widthType values', () => {
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ strokeWeight: -8 })))).toThrow(/strokeWeight/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ strokeWeight: 8 })))).toThrow(/strokeWeight/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ widthType: -6 })))).toThrow(/widthType/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ widthType: -1 })))).toThrow(/widthType/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ widthType: 1 })))).toThrow(/widthType/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ widthType: 4 })))).toThrow(/widthType/)
  })

  it('should reject reserved serifStyle values', () => {
    // Top bits 0 = "not specified" is valid (shipping fonts leave it 0); only
    // top bits 3 and bottom bits > 12 are reserved.
    expect(parsePclt(new BinaryReader(buildPcltTable({ serifStyle: 0x02 }))).serifStyle).toBe(0x02)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ serifStyle: 0xC2 })))).toThrow(/top bits/)
    expect(() => parsePclt(new BinaryReader(buildPcltTable({ serifStyle: 0x4D })))).toThrow(/bottom bits/)
  })

  it('should reject non-ASCII and non-padding fixed strings', () => {
    const nonAscii = buildPcltTable({ typeface: 'AB' })
    new DataView(nonAscii).setUint8(20, 0x80)

    const nonPaddingAfterNul = buildPcltTable({ typeface: 'AB' })
    new DataView(nonPaddingAfterNul).setUint8(23, 0x43)

    const nonAsciiFile = buildPcltTable({ fileName: 'TEST' })
    new DataView(nonAsciiFile).setUint8(44, 0x80)

    expect(() => parsePclt(new BinaryReader(nonAscii))).toThrow(/ASCII/)
    expect(() => parsePclt(new BinaryReader(nonPaddingAfterNul))).toThrow(/after NUL/)
    expect(() => parsePclt(new BinaryReader(nonAsciiFile))).toThrow(/ASCII/)
  })
})
