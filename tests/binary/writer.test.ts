import { describe, it, expect } from 'vitest'
import { BinaryWriter } from '../../src/binary/writer.js'
import { BinaryReader } from '../../src/binary/reader.js'

describe('BinaryWriter', () => {
  // Verifies a Uint8 written by BinaryWriter round-trips through BinaryReader.
  it('should write and read back Uint8', () => {
    const writer = new BinaryWriter()
    writer.writeUint8(0x42)
    const reader = new BinaryReader(writer.toArrayBuffer())
    expect(reader.readUint8()).toBe(0x42)
  })

  // Verifies writeUint16 emits big-endian bytes that round-trip through the reader.
  it('should write and read back Uint16 (big-endian)', () => {
    const writer = new BinaryWriter()
    writer.writeUint16(0x0102)
    const reader = new BinaryReader(writer.toArrayBuffer())
    expect(reader.readUint16()).toBe(0x0102)
  })

  // Verifies writeUint32 emits big-endian bytes that round-trip through the reader.
  it('should write and read back Uint32 (big-endian)', () => {
    const writer = new BinaryWriter()
    writer.writeUint32(0x00010000)
    const reader = new BinaryReader(writer.toArrayBuffer())
    expect(reader.readUint32()).toBe(0x00010000)
  })

  // Verifies writeInt16 preserves negative values through two's-complement encoding.
  it('should write and read back Int16', () => {
    const writer = new BinaryWriter()
    writer.writeInt16(-100)
    const reader = new BinaryReader(writer.toArrayBuffer())
    expect(reader.readInt16()).toBe(-100)
  })

  // Verifies writeTag encodes a 4-character table tag as ASCII bytes.
  it('should write Tag', () => {
    const writer = new BinaryWriter()
    writer.writeTag('head')
    const reader = new BinaryReader(writer.toArrayBuffer())
    expect(reader.readTag()).toBe('head')
  })

  // Verifies writeBytes copies a raw Uint8Array into the output buffer verbatim.
  it('should write bytes', () => {
    const writer = new BinaryWriter()
    writer.writeBytes(new Uint8Array([1, 2, 3]))
    const arr = new Uint8Array(writer.toArrayBuffer())
    expect(arr).toEqual(new Uint8Array([1, 2, 3]))
  })

  // Verifies the internal buffer grows automatically when writes exceed the initial capacity.
  it('should auto-expand buffer', () => {
    const writer = new BinaryWriter(4)
    for (let i = 0; i < 100; i++) {
      writer.writeUint8(i)
    }
    expect(writer.position).toBe(100)
    const reader = new BinaryReader(writer.toArrayBuffer())
    for (let i = 0; i < 100; i++) {
      expect(reader.readUint8()).toBe(i)
    }
  })

  // Verifies pad4 advances the position to the next 4-byte boundary, as required for OpenType table alignment.
  it('should pad to 4-byte boundary', () => {
    const writer = new BinaryWriter()
    writer.writeUint8(1)
    writer.pad4()
    expect(writer.position).toBe(4)

    writer.writeUint8(2)
    writer.writeUint8(3)
    writer.pad4()
    expect(writer.position).toBe(8)
  })

  // Verifies pad4 is a no-op when the position is already 4-byte aligned.
  it('should not pad when already on boundary', () => {
    const writer = new BinaryWriter()
    writer.writeUint32(0)
    writer.pad4()
    expect(writer.position).toBe(4)
  })

  // Verifies toUint8Array returns only the written bytes as a Uint8Array.
  it('should return Uint8Array', () => {
    const writer = new BinaryWriter()
    writer.writeUint8(0x41)
    writer.writeUint8(0x42)
    const arr = writer.toUint8Array()
    expect(arr).toEqual(new Uint8Array([0x41, 0x42]))
  })
})
