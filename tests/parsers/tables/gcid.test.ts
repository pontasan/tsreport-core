import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseGcid } from '../../../src/parsers/tables/gcid.js'

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

function buildGcid(cids: number[]): ArrayBuffer {
  const size = 144 + cids.length * 2
  const buf = new ArrayBuffer(size)
  const view = new DataView(buf)

  view.setUint16(0, 0) // version
  view.setUint16(2, 0) // format
  view.setUint32(4, size)
  view.setUint16(8, 0) // registry (Adobe)
  writeAscii(view, 10, 'Adobe')
  view.setUint16(74, 1) // order
  writeAscii(view, 76, 'Japan1')
  view.setUint16(140, 6) // supplementVersion
  view.setUint16(142, cids.length)
  for (let i = 0; i < cids.length; i++) {
    view.setUint16(144 + i * 2, cids[i]!)
  }
  return buf
}

describe('gcid table parser', () => {
  it('should parse the registry/order metadata', () => {
    const table = parseGcid(new BinaryReader(buildGcid([0, 34, 0xFFFF])))

    expect(table.version).toBe(0)
    expect(table.format).toBe(0)
    expect(table.registry).toBe(0)
    expect(table.registryName).toBe('Adobe')
    expect(table.order).toBe(1)
    expect(table.orderName).toBe('Japan1')
    expect(table.supplementVersion).toBe(6)
    expect(table.count).toBe(3)
  })

  it('should map glyphs to CIDs', () => {
    const table = parseGcid(new BinaryReader(buildGcid([0, 34, 0xFFFF])))

    expect(table.getCid(0)).toBe(0)
    expect(table.getCid(1)).toBe(34)
    expect(table.getCid(2)).toBeNull() // 0xFFFF = no CID
    expect(table.getCid(3)).toBeNull() // out of range
  })

  it('rejects invalid header values, size, count, and string padding', () => {
    const version = buildGcid([0])
    new DataView(version).setUint16(0, 1)
    expect(() => parseGcid(new BinaryReader(version))).toThrow('Unsupported gcid table version')

    const format = buildGcid([0])
    new DataView(format).setUint16(2, 1)
    expect(() => parseGcid(new BinaryReader(format))).toThrow('Unsupported gcid table format')

    const size = buildGcid([0])
    new DataView(size).setUint32(4, size.byteLength - 1)
    expect(() => parseGcid(new BinaryReader(size))).toThrow('does not match table length')

    expect(() => parseGcid(new BinaryReader(buildGcid([0, 1])), 1)).toThrow('count 2 exceeds numGlyphs 1')

    const padding = buildGcid([0])
    new DataView(padding).setUint8(16, 0)
    new DataView(padding).setUint8(17, 0x41)
    expect(() => parseGcid(new BinaryReader(padding))).toThrow('non-zero data after NUL padding')
  })
})
