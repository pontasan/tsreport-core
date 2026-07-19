import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../src/binary/reader.js'

describe('BinaryReader', () => {
  function createBuffer(bytes: number[]): ArrayBuffer {
    const buf = new ArrayBuffer(bytes.length)
    const view = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) {
      view[i] = bytes[i]!
    }
    return buf
  }

  describe('basic reads', () => {
    // Verifies readUint8 returns the byte value and advances position by 1.
    it('should read Uint8', () => {
      const reader = new BinaryReader(createBuffer([0x42]))
      expect(reader.readUint8()).toBe(0x42)
      expect(reader.position).toBe(1)
    })

    // Verifies readUint16 decodes two bytes in big-endian order as required by OpenType.
    it('should read Uint16 (big-endian)', () => {
      const reader = new BinaryReader(createBuffer([0x01, 0x02]))
      expect(reader.readUint16()).toBe(0x0102)
    })

    // Verifies readUint32 decodes four bytes in big-endian order.
    it('should read Uint32 (big-endian)', () => {
      const reader = new BinaryReader(createBuffer([0x00, 0x01, 0x00, 0x00]))
      expect(reader.readUint32()).toBe(0x00010000)
    })

    // Verifies readInt16 sign-extends big-endian bytes to a negative value.
    it('should read Int16 (big-endian, negative)', () => {
      const reader = new BinaryReader(createBuffer([0xFF, 0xFE]))
      expect(reader.readInt16()).toBe(-2)
    })

    // Verifies readInt32 sign-extends big-endian bytes to a negative value.
    it('should read Int32 (big-endian)', () => {
      const reader = new BinaryReader(createBuffer([0xFF, 0xFF, 0xFF, 0xFE]))
      expect(reader.readInt32()).toBe(-2)
    })
  })

  describe('OpenType types', () => {
    // Verifies readFixed converts the 16.16 fixed-point encoding 0x00010000 to 1.0.
    it('should read Fixed (16.16)', () => {
      // 1.0 = 0x00010000
      const reader = new BinaryReader(createBuffer([0x00, 0x01, 0x00, 0x00]))
      expect(reader.readFixed()).toBeCloseTo(1.0, 5)
    })

    // Verifies readFixed handles negative 16.16 fixed-point values via signed interpretation.
    it('should read Fixed negative', () => {
      // -1.0
      const reader = new BinaryReader(createBuffer([0xFF, 0xFF, 0x00, 0x00]))
      expect(reader.readFixed()).toBeCloseTo(-1.0, 2)
    })

    // Verifies readTag decodes four bytes as an ASCII table tag string.
    it('should read Tag', () => {
      const reader = new BinaryReader(createBuffer([0x68, 0x65, 0x61, 0x64])) // 'head'
      expect(reader.readTag()).toBe('head')
    })

    // Verifies readFWord reads a signed 16-bit font-unit value (Int16 alias).
    it('should read FWord (Int16)', () => {
      const reader = new BinaryReader(createBuffer([0xFF, 0x00]))
      expect(reader.readFWord()).toBe(-256)
    })

    // Verifies readUFWord reads an unsigned 16-bit font-unit value (Uint16 alias).
    it('should read UFWord (Uint16)', () => {
      const reader = new BinaryReader(createBuffer([0x03, 0xE8]))
      expect(reader.readUFWord()).toBe(1000)
    })
  })

  describe('position and seeking', () => {
    // Verifies position advances by the size of each read (1 byte, then 2 bytes).
    it('should track position after reads', () => {
      const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03, 0x04]))
      reader.readUint8()
      expect(reader.position).toBe(1)
      reader.readUint16()
      expect(reader.position).toBe(3)
    })

    // Verifies seek repositions the cursor so the next read starts at the given offset.
    it('should seek to position', () => {
      const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03]))
      reader.seek(2)
      expect(reader.readUint8()).toBe(0x03)
    })

    // Verifies skip advances the cursor relative to the current position.
    it('should skip bytes', () => {
      const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03]))
      reader.skip(2)
      expect(reader.readUint8()).toBe(0x03)
    })

    // Verifies the remaining getter reflects unread bytes as the cursor advances.
    it('should report remaining bytes', () => {
      const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03, 0x04]))
      expect(reader.remaining).toBe(4)
      reader.readUint16()
      expect(reader.remaining).toBe(2)
    })
  })

  describe('sub-reader', () => {
    // Verifies subReader exposes a windowed view (offset + length) reading the parent's bytes without copying.
    it('should create a zero-copy sub-reader', () => {
      const buf = createBuffer([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
      const reader = new BinaryReader(buf)
      const sub = reader.subReader(2, 3)
      expect(sub.length).toBe(3)
      expect(sub.readUint8()).toBe(0x02)
      expect(sub.readUint8()).toBe(0x03)
      expect(sub.readUint8()).toBe(0x04)
    })

    // Verifies the sub-reader references the same ArrayBuffer instance instead of allocating a copy.
    it('should share underlying buffer', () => {
      const buf = createBuffer([0x01, 0x02, 0x03, 0x04])
      const reader = new BinaryReader(buf)
      const sub = reader.subReader(1, 2)
      expect(sub.buffer).toBe(buf)
    })
  })

  describe('array reads', () => {
    // Verifies readUint16Array decodes consecutive big-endian Uint16 values into a typed array.
    it('should read Uint16Array', () => {
      const reader = new BinaryReader(createBuffer([0x00, 0x01, 0x00, 0x02, 0x00, 0x03]))
      const arr = reader.readUint16Array(3)
      expect(arr).toEqual(new Uint16Array([1, 2, 3]))
    })

    // Verifies readInt16Array decodes consecutive signed big-endian Int16 values, including negatives.
    it('should read Int16Array', () => {
      const reader = new BinaryReader(createBuffer([0xFF, 0xFE, 0x00, 0x01]))
      const arr = reader.readInt16Array(2)
      expect(arr).toEqual(new Int16Array([-2, 1]))
    })

    // Verifies readBytes returns the requested raw byte span as a Uint8Array.
    it('should read bytes', () => {
      const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03]))
      const bytes = reader.readBytes(3)
      expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    })
  })

  describe('string reads', () => {
    // Verifies readAscii decodes single-byte characters into a string.
    it('should read ASCII string', () => {
      const reader = new BinaryReader(createBuffer([0x41, 0x42, 0x43])) // 'ABC'
      expect(reader.readAscii(3)).toBe('ABC')
    })

    // Verifies readUtf16Be decodes big-endian UTF-16 code units as used in OpenType name records.
    it('should read UTF-16BE string', () => {
      const reader = new BinaryReader(createBuffer([0x00, 0x41, 0x00, 0x42])) // 'AB'
      expect(reader.readUtf16Be(4)).toBe('AB')
    })
  })

  describe('at methods (non-advancing)', () => {
    // Verifies getUint8At/getUint16At read at an absolute offset while leaving position unchanged.
    it('should read at offset without advancing position', () => {
      const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03, 0x04]))
      expect(reader.getUint8At(2)).toBe(0x03)
      expect(reader.position).toBe(0)

      expect(reader.getUint16At(0)).toBe(0x0102)
      expect(reader.position).toBe(0)
    })
  })
})
