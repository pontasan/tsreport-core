import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseHead } from '../../../src/parsers/tables/head.js'

const FONT_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')

describe('head table parser', () => {
  function writeLongDateTime(w: BinaryWriter, value: bigint): void {
    w.writeUint32(Number((value >> 32n) & 0xFFFFFFFFn))
    w.writeUint32(Number(value & 0xFFFFFFFFn))
  }

  function buildHeadTable(opts?: {
    majorVersion?: number
    minorVersion?: number
    magicNumber?: number
    flags?: number
    unitsPerEm?: number
    xMin?: number
    yMin?: number
    xMax?: number
    yMax?: number
    macStyle?: number
    lowestRecPPEM?: number
    fontDirectionHint?: number
    indexToLocFormat?: number
    glyphDataFormat?: number
    truncateBytes?: number
  }): ArrayBuffer {
    const w = new BinaryWriter()
    w.writeUint16(opts?.majorVersion ?? 1)
    w.writeUint16(opts?.minorVersion ?? 0)
    w.writeInt32(0x00010000)
    w.writeUint32(0)
    w.writeUint32(opts?.magicNumber ?? 0x5F0F3CF5)
    w.writeUint16(opts?.flags ?? 0)
    w.writeUint16(opts?.unitsPerEm ?? 1000)
    writeLongDateTime(w, 0n)
    writeLongDateTime(w, 0n)
    w.writeInt16(opts?.xMin ?? -10)
    w.writeInt16(opts?.yMin ?? -20)
    w.writeInt16(opts?.xMax ?? 1000)
    w.writeInt16(opts?.yMax ?? 900)
    w.writeUint16(opts?.macStyle ?? 0)
    w.writeUint16(opts?.lowestRecPPEM ?? 8)
    w.writeInt16(opts?.fontDirectionHint ?? 2)
    w.writeInt16(opts?.indexToLocFormat ?? 1)
    w.writeInt16(opts?.glyphDataFormat ?? 0)
    const buffer = w.toArrayBuffer()
    return opts?.truncateBytes === undefined ? buffer : buffer.slice(0, opts.truncateBytes)
  }

  describe('synthetic validation', () => {
    it('should reject invalid head table lengths', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ truncateBytes: 52 })))).toThrow(
        'head table length must be at least 54, got 52',
      )
    })

    it('accepts compatible minor extensions and rejects unknown major versions', () => {
      expect(parseHead(new BinaryReader(buildHeadTable({ minorVersion: 1 }))).minorVersion).toBe(1)
      expect(() => parseHead(new BinaryReader(buildHeadTable({ majorVersion: 2 })))).toThrow(
        'Unsupported head version: 2.0',
      )
    })

    it('rejects a bad magic number for head', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ magicNumber: 0xFF })))).toThrow(
        'Invalid head table magic number',
      )
    })

    it('accepts a non-standard magic number when parsing a bitmap header (bhed)', () => {
      // Bitmap-only fonts (macOS NISC18030) carry a 'bhed' whose magic number is
      // not the 'head' sentinel; it must parse when isBitmapHeader is set.
      const head = parseHead(new BinaryReader(buildHeadTable({ magicNumber: 0xFF })), true)
      expect(head.unitsPerEm).toBeGreaterThan(0)
    })

    it('should reject reserved head flags', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ flags: 0x8000 })))).toThrow(
        'head flags reserved bit 15 must be 0',
      )
    })

    it('should reject unitsPerEm outside the OpenType range', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ unitsPerEm: 15 })))).toThrow(
        'head unitsPerEm must be in the range 16..16384, got 15',
      )
    })

    it('should reject invalid bounding boxes', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ xMin: 20, xMax: 10 })))).toThrow(
        'head bounding box is invalid: (20, -20)..(10, 900)',
      )
    })

    it('should reject reserved macStyle bits', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ macStyle: 0x0080 })))).toThrow(
        'head macStyle reserved bits must be 0, got 0x0080',
      )
    })

    it('accepts a zero lowestRecPPEM (advisory "unspecified", e.g. Big Caslon)', () => {
      expect(parseHead(new BinaryReader(buildHeadTable({ lowestRecPPEM: 0 }))).lowestRecPPEM).toBe(0)
    })

    it('should reject invalid fontDirectionHint values', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ fontDirectionHint: 3 })))).toThrow(
        'head fontDirectionHint must be between -2 and 2, got 3',
      )
    })

    it('should reject invalid indexToLocFormat values', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ indexToLocFormat: 2 })))).toThrow(
        'head indexToLocFormat must be 0 or 1, got 2',
      )
    })

    it('should reject non-zero glyphDataFormat values', () => {
      expect(() => parseHead(new BinaryReader(buildHeadTable({ glyphDataFormat: 1 })))).toThrow(
        'head glyphDataFormat must be 0, got 1',
      )
    })
  })

  // Verifies that a real font's head table yields version 1.0 and spec-valid unitsPerEm / indexToLocFormat ranges.
  it('should parse head table from NotoSans', () => {
    const buffer = readFileSync(FONT_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'head')!
    expect(reader).not.toBeNull()

    const head = parseHead(reader)
    expect(head.majorVersion).toBe(1)
    expect(head.minorVersion).toBe(0)
    expect(head.unitsPerEm).toBeGreaterThan(0)
    expect(head.unitsPerEm).toBeLessThanOrEqual(16384)
    expect(head.indexToLocFormat).toBeGreaterThanOrEqual(0)
    expect(head.indexToLocFormat).toBeLessThanOrEqual(1)
  })
})
