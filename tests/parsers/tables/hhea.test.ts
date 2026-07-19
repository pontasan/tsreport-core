import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseFont } from '../../../src/parsers/index.js'
import { parseHhea } from '../../../src/parsers/tables/hhea.js'
import { parseMaxp } from '../../../src/parsers/tables/maxp.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
const SOURCE_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/SourceSans3-Regular.otf')

describe('hhea table parser', () => {
  function buildHheaTable(opts?: {
    majorVersion?: number
    minorVersion?: number
    reservedIndex?: number
    reservedValue?: number
    metricDataFormat?: number
    numberOfHMetrics?: number
  }): ArrayBuffer {
    const w = new BinaryWriter()
    w.writeUint16(opts?.majorVersion ?? 1)
    w.writeUint16(opts?.minorVersion ?? 0)
    w.writeInt16(800)
    w.writeInt16(-200)
    w.writeInt16(0)
    w.writeUint16(1000)
    w.writeInt16(10)
    w.writeInt16(-20)
    w.writeInt16(900)
    w.writeInt16(1)
    w.writeInt16(0)
    w.writeInt16(0)
    for (let i = 0; i < 4; i++) {
      w.writeInt16(opts?.reservedIndex === i ? (opts.reservedValue ?? 1) : 0)
    }
    w.writeInt16(opts?.metricDataFormat ?? 0)
    w.writeUint16(opts?.numberOfHMetrics ?? 5)
    return w.toArrayBuffer()
  }

  describe('synthetic validation', () => {
    it('accepts compatible minor extensions and rejects unknown major versions', () => {
      expect(parseHhea(new BinaryReader(buildHheaTable({ minorVersion: 1 }))).minorVersion).toBe(1)
      expect(() => parseHhea(new BinaryReader(buildHheaTable({ majorVersion: 2 })))).toThrow(
        'Unsupported hhea version: 2.0',
      )
    })

    it('should reject non-zero hhea reserved fields', () => {
      expect(() => parseHhea(new BinaryReader(buildHheaTable({ reservedIndex: 2, reservedValue: -1 })))).toThrow(
        'hhea reserved field 2 must be 0, got -1',
      )
    })

    it('should reject non-zero hhea metricDataFormat', () => {
      expect(() => parseHhea(new BinaryReader(buildHheaTable({ metricDataFormat: 1 })))).toThrow(
        'hhea metricDataFormat must be 0, got 1',
      )
    })

    it('should reject zero hhea metric counts', () => {
      expect(() => parseHhea(new BinaryReader(buildHheaTable({ numberOfHMetrics: 0 })))).toThrow(
        'hhea numberOfHMetrics must be greater than 0',
      )
    })
  })

  describe('NotoSans-Regular (TrueType)', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const hhea = parseHhea(getTableReader(sfnt, 'hhea')!)
    const maxp = parseMaxp(getTableReader(sfnt, 'maxp')!)

    // Verifies that the hhea table version fields read as 1.0.
    it('should have version 1.0', () => {
      expect(hhea.majorVersion).toBe(1)
      expect(hhea.minorVersion).toBe(0)
    })

    // Verifies that the ascender matches NotoSans's known value of 1069 font units.
    it('should have positive ascender', () => {
      expect(hhea.ascender).toBeGreaterThan(0)
      expect(hhea.ascender).toBe(1069)
    })

    // Verifies that the descender is negative and matches NotoSans's known value of -293.
    it('should have negative descender', () => {
      expect(hhea.descender).toBeLessThan(0)
      expect(hhea.descender).toBe(-293)
    })

    // Verifies that lineGap is read as a non-negative value for this font.
    it('should have non-negative lineGap', () => {
      expect(hhea.lineGap).toBeGreaterThanOrEqual(0)
    })

    // Verifies that advanceWidthMax (a UFWORD) is read as a positive width.
    it('should have positive advanceWidthMax', () => {
      expect(hhea.advanceWidthMax).toBeGreaterThan(0)
    })

    // Verifies the spec invariant that numberOfHMetrics never exceeds maxp.numGlyphs.
    it('should have numberOfHMetrics > 0 and <= numGlyphs', () => {
      expect(hhea.numberOfHMetrics).toBeGreaterThan(0)
      expect(hhea.numberOfHMetrics).toBeLessThanOrEqual(maxp.numGlyphs)
    })

    // Verifies that metricDataFormat is 0, the only value defined by the OpenType spec.
    it('should have metricDataFormat 0', () => {
      expect(hhea.metricDataFormat).toBe(0)
    })

    // Verifies that an upright font has a vertical caret (rise > 0, run == 0).
    it('should have valid caret slope for upright font', () => {
      // For an upright font, caretSlopeRise should be > 0 (often 1 or unitsPerEm)
      // and caretSlopeRun should be 0 (no horizontal slant)
      expect(hhea.caretSlopeRise).toBeGreaterThan(0)
      expect(hhea.caretSlopeRun).toBe(0)
    })
  })

  describe('Roboto-Regular (TrueType)', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const hhea = parseHhea(getTableReader(sfnt, 'hhea')!)

    // Verifies that the hhea table version fields read as 1.0.
    it('should have version 1.0', () => {
      expect(hhea.majorVersion).toBe(1)
      expect(hhea.minorVersion).toBe(0)
    })

    // Verifies that the ascender is parsed as a positive value for a second TrueType font.
    it('should have positive ascender', () => {
      expect(hhea.ascender).toBeGreaterThan(0)
    })

    // Verifies that the descender is parsed as a negative signed value (FWORD sign handling).
    it('should have negative descender', () => {
      expect(hhea.descender).toBeLessThan(0)
    })

    // Verifies that advanceWidthMax is read as a positive width.
    it('should have positive advanceWidthMax', () => {
      expect(hhea.advanceWidthMax).toBeGreaterThan(0)
    })
  })

  describe('SourceSans3-Regular (OTF/CFF)', () => {
    const buffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseFont(buffer)
    const hhea = parseHhea(getTableReader(sfnt, 'hhea')!)

    // Verifies that hhea parsing also works for a CFF-flavored (OTF) font.
    it('should have version 1.0', () => {
      expect(hhea.majorVersion).toBe(1)
      expect(hhea.minorVersion).toBe(0)
    })

    // Verifies that the ascender is parsed as positive in a CFF-flavored font.
    it('should have positive ascender', () => {
      expect(hhea.ascender).toBeGreaterThan(0)
    })

    // Verifies that the descender is parsed as negative in a CFF-flavored font.
    it('should have negative descender', () => {
      expect(hhea.descender).toBeLessThan(0)
    })

    // Verifies that numberOfHMetrics is a positive count in a CFF-flavored font.
    it('should have valid numberOfHMetrics', () => {
      expect(hhea.numberOfHMetrics).toBeGreaterThan(0)
    })
  })

  describe('SfntTableManager lazy access', () => {
    // Verifies that SfntTableManager lazily parses hhea and returns the same known metrics.
    it('should provide hhea via manager', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      const hhea = manager.hhea
      expect(hhea.majorVersion).toBe(1)
      expect(hhea.ascender).toBe(1069)
      expect(hhea.descender).toBe(-293)
    })
  })
})
