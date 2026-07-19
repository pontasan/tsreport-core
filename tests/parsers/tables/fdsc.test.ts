import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseFdsc } from '../../../src/parsers/tables/fdsc.js'

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) {
    view.setUint8(offset + i, tag.charCodeAt(i))
  }
}

function buildFdsc(descriptors: { tag: string, raw: number }[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + descriptors.length * 8)
  const view = new DataView(buf)

  view.setUint32(0, 0x00010000)
  view.setUint32(4, descriptors.length)

  let pos = 8
  for (const d of descriptors) {
    writeTag(view, pos, d.tag)
    view.setInt32(pos + 4, d.raw)
    pos += 8
  }
  return buf
}

describe('fdsc table parser', () => {
  it('should parse Fixed descriptor values', () => {
    const buf = buildFdsc([
      { tag: 'wght', raw: 0x00018000 }, // 1.5
      { tag: 'slnt', raw: -12 * 65536 }, // -12 degrees
      { tag: 'opsz', raw: 12 * 65536 },
    ])
    const table = parseFdsc(new BinaryReader(buf))

    expect(table.version).toBe(1)
    expect(table.descriptors).toHaveLength(3)
    expect(table.getDescriptor('wght')).toBe(1.5)
    expect(table.getDescriptor('slnt')).toBe(-12)
    expect(table.getDescriptor('opsz')).toBe(12)
    expect(table.getDescriptor('wdth')).toBeNull()
  })

  it('should parse the nalf descriptor as an integer code', () => {
    const buf = buildFdsc([{ tag: 'nalf', raw: 2 }]) // pi characters
    const table = parseFdsc(new BinaryReader(buf))

    expect(table.getDescriptor('nalf')).toBe(2)
  })

  it('rejects unsupported versions', () => {
    const buf = buildFdsc([{ tag: 'wght', raw: 0x00010000 }])
    new DataView(buf).setUint32(0, 0x00020000)

    expect(() => parseFdsc(new BinaryReader(buf))).toThrow('Unsupported fdsc table version')
  })

  it('rejects truncated descriptor arrays', () => {
    const buf = buildFdsc([{ tag: 'wght', raw: 0x00010000 }]).slice(0, 12)

    expect(() => parseFdsc(new BinaryReader(buf))).toThrow('fdsc descriptor array exceeds fdsc table length')
  })

  it('rejects non-printable descriptor tags', () => {
    const buf = buildFdsc([{ tag: 'wght', raw: 0x00010000 }])
    new DataView(buf).setUint8(8, 0x1F)

    expect(() => parseFdsc(new BinaryReader(buf))).toThrow('fdsc descriptor tag 0 must contain printable ASCII characters')
  })

  it('rejects duplicate descriptor tags', () => {
    const buf = buildFdsc([
      { tag: 'wght', raw: 0x00010000 },
      { tag: 'wght', raw: 0x00018000 },
    ])

    expect(() => parseFdsc(new BinaryReader(buf))).toThrow('fdsc descriptor tag must be unique: wght')
  })

  it('rejects nalf descriptor codes outside the registered range', () => {
    const buf = buildFdsc([{ tag: 'nalf', raw: 7 }])

    expect(() => parseFdsc(new BinaryReader(buf))).toThrow('fdsc nalf descriptor code must be 0..6')
  })
})
