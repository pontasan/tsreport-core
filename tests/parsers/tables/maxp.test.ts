import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseFont } from '../../../src/parsers/index.js'
import { parseMaxp } from '../../../src/parsers/tables/maxp.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'
import { Font } from '../../../src/index.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
const SOURCE_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/SourceSans3-Regular.otf')

describe('maxp table parser', () => {
  function buildMaxp05(opts?: { rawVersion?: number, numGlyphs?: number, extraBytes?: number }): ArrayBuffer {
    const w = new BinaryWriter()
    w.writeUint32(opts?.rawVersion ?? 0x00005000)
    w.writeUint16(opts?.numGlyphs ?? 7)
    for (let i = 0; i < (opts?.extraBytes ?? 0); i++) w.writeUint8(0)
    return w.toArrayBuffer()
  }

  function buildMaxp10(opts?: {
    rawVersion?: number
    numGlyphs?: number
    maxZones?: number
    truncateBytes?: number
  }): ArrayBuffer {
    const w = new BinaryWriter()
    w.writeUint32(opts?.rawVersion ?? 0x00010000)
    w.writeUint16(opts?.numGlyphs ?? 7)
    w.writeUint16(10)
    w.writeUint16(2)
    w.writeUint16(20)
    w.writeUint16(4)
    w.writeUint16(opts?.maxZones ?? 2)
    w.writeUint16(8)
    w.writeUint16(16)
    w.writeUint16(1)
    w.writeUint16(0)
    w.writeUint16(64)
    w.writeUint16(128)
    w.writeUint16(3)
    w.writeUint16(2)
    const buffer = w.toArrayBuffer()
    return opts?.truncateBytes === undefined ? buffer : buffer.slice(0, opts.truncateBytes)
  }

  describe('synthetic validation', () => {
    it('should parse and expose every maxp version 1.0 field', () => {
      const maxp = parseMaxp(new BinaryReader(buildMaxp10()))

      expect(maxp).toMatchObject({
        version: 1.0,
        numGlyphs: 7,
        maxPoints: 10,
        maxContours: 2,
        maxCompositePoints: 20,
        maxCompositeContours: 4,
        maxZones: 2,
        maxTwilightPoints: 8,
        maxStorage: 16,
        maxFunctionDefs: 1,
        maxInstructionDefs: 0,
        maxStackElements: 64,
        maxSizeOfInstructions: 128,
        maxComponentElements: 3,
        maxComponentDepth: 2,
      })
    })

    it('should parse maxp version 0.5 as the specification version number', () => {
      const maxp = parseMaxp(new BinaryReader(buildMaxp05()))

      expect(maxp.version).toBe(0.5)
      expect(maxp.numGlyphs).toBe(7)
      expect(maxp.maxPoints).toBeUndefined()
    })

    it('should reject unsupported maxp versions', () => {
      expect(() => parseMaxp(new BinaryReader(buildMaxp05({ rawVersion: 0x00020000 })))).toThrow(
        'Unsupported maxp version: 0x00020000',
      )
    })

    it('should reject malformed maxp version 0.5 lengths', () => {
      expect(() => parseMaxp(new BinaryReader(buildMaxp05({ extraBytes: 2 })))).toThrow(
        'maxp version 0.5 table length must be 6, got 8',
      )
    })

    it('should reject malformed maxp version 1.0 lengths', () => {
      expect(() => parseMaxp(new BinaryReader(buildMaxp10({ truncateBytes: 30 })))).toThrow(
        'maxp version 1.0 table length must be 32, got 30',
      )
    })

    it('should reject zero glyph counts', () => {
      expect(() => parseMaxp(new BinaryReader(buildMaxp05({ numGlyphs: 0 })))).toThrow(
        'maxp numGlyphs must be greater than 0',
      )
    })

    it('preserves maxZones for contextual OpenType conformance validation', () => {
      expect(parseMaxp(new BinaryReader(buildMaxp10({ maxZones: 0 }))).maxZones).toBe(0)
      expect(parseMaxp(new BinaryReader(buildMaxp10({ maxZones: 3 }))).maxZones).toBe(3)
    })
  })

  describe('NotoSans-Regular (TrueType)', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const maxp = parseMaxp(getTableReader(sfnt, 'maxp')!)

    // Verifies that a TrueType font reports maxp version 1.0.
    it('should have version 1.0 for TrueType font', () => {
      expect(maxp.version).toBe(1.0)
    })

    // Verifies that numGlyphs is parsed as a positive count.
    it('should have numGlyphs > 0', () => {
      expect(maxp.numGlyphs).toBeGreaterThan(0)
    })

    // Verifies that the version 1.0-only maxPoints field is present and positive.
    it('should have maxPoints defined for TTF version 1.0', () => {
      expect(maxp.maxPoints).toBeDefined()
      expect(maxp.maxPoints).toBeGreaterThan(0)
    })

    // Verifies that the version 1.0-only maxContours field is present and positive.
    it('should have maxContours defined for TTF version 1.0', () => {
      expect(maxp.maxContours).toBeDefined()
      expect(maxp.maxContours).toBeGreaterThan(0)
    })

    // Verifies that the version 1.0-only maxCompositePoints field is present and non-negative.
    it('should have maxCompositePoints defined for TTF version 1.0', () => {
      expect(maxp.maxCompositePoints).toBeDefined()
      expect(maxp.maxCompositePoints).toBeGreaterThanOrEqual(0)
    })

    // Verifies that the version 1.0-only maxCompositeContours field is present and non-negative.
    it('should have maxCompositeContours defined for TTF version 1.0', () => {
      expect(maxp.maxCompositeContours).toBeDefined()
      expect(maxp.maxCompositeContours).toBeGreaterThanOrEqual(0)
    })

    // Verifies that the full version 1.0 field set is preserved.
    it('should expose all version 1.0 memory profile fields', () => {
      expect(maxp.maxZones).toBeGreaterThanOrEqual(1)
      expect(maxp.maxTwilightPoints).toBeGreaterThanOrEqual(0)
      expect(maxp.maxStorage).toBeGreaterThanOrEqual(0)
      expect(maxp.maxFunctionDefs).toBeGreaterThanOrEqual(0)
      expect(maxp.maxInstructionDefs).toBeGreaterThanOrEqual(0)
      expect(maxp.maxStackElements).toBeGreaterThanOrEqual(0)
      expect(maxp.maxSizeOfInstructions).toBeGreaterThanOrEqual(0)
      expect(maxp.maxComponentElements).toBeGreaterThanOrEqual(0)
      expect(maxp.maxComponentDepth).toBeGreaterThanOrEqual(0)
    })

    // Verifies that the high-level Font API exposes the same glyph count as raw maxp parsing.
    it('should match Font.numGlyphs', () => {
      const font = Font.load(buffer)
      expect(maxp.numGlyphs).toBe(font.numGlyphs)
    })
  })

  describe('Roboto-Regular (TrueType)', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const maxp = parseMaxp(getTableReader(sfnt, 'maxp')!)

    // Verifies maxp version 1.0 on a second TrueType font.
    it('should have version 1.0 for TrueType font', () => {
      expect(maxp.version).toBe(1.0)
    })

    // Verifies that numGlyphs is positive for Roboto.
    it('should have numGlyphs > 0', () => {
      expect(maxp.numGlyphs).toBeGreaterThan(0)
    })

    // Verifies that maxPoints is present and positive for Roboto.
    it('should have maxPoints defined', () => {
      expect(maxp.maxPoints).toBeDefined()
      expect(maxp.maxPoints).toBeGreaterThan(0)
    })

    // Verifies that maxContours is present and positive for Roboto.
    it('should have maxContours defined', () => {
      expect(maxp.maxContours).toBeDefined()
      expect(maxp.maxContours).toBeGreaterThan(0)
    })
  })

  describe('SourceSans3-Regular (OTF/CFF)', () => {
    const buffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseFont(buffer)
    const maxp = parseMaxp(getTableReader(sfnt, 'maxp')!)

    // Verifies that a CFF-flavored font uses the reduced maxp version 0.5 header.
    it('should have version 0.5 for CFF font (no TrueType outline data)', () => {
      expect(maxp.version).toBe(0.5)
    })

    // Verifies that numGlyphs is still parsed from a version 0.5 maxp.
    it('should have numGlyphs > 0', () => {
      expect(maxp.numGlyphs).toBeGreaterThan(0)
    })

    // Verifies that the parser does not fabricate maxPoints for a version 0.5 table.
    it('should NOT have maxPoints for CFF version 0.5', () => {
      expect(maxp.maxPoints).toBeUndefined()
    })

    // Verifies that maxContours is undefined for a version 0.5 table.
    it('should NOT have maxContours for CFF version 0.5', () => {
      expect(maxp.maxContours).toBeUndefined()
    })

    // Verifies that maxCompositePoints is undefined for a version 0.5 table.
    it('should NOT have maxCompositePoints for CFF version 0.5', () => {
      expect(maxp.maxCompositePoints).toBeUndefined()
    })

    // Verifies that maxCompositeContours is undefined for a version 0.5 table.
    it('should NOT have maxCompositeContours for CFF version 0.5', () => {
      expect(maxp.maxCompositeContours).toBeUndefined()
    })
  })

  describe('cross-font comparison', () => {
    // Verifies that the parser reads distinct per-font glyph counts (sanity check against reader state leaks).
    it('Noto Sans and Roboto should have different numGlyphs', () => {
      const notoBuffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const robotoBuffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const notoMaxp = parseMaxp(getTableReader(parseSfntDirectory(notoBuffer), 'maxp')!)
      const robotoMaxp = parseMaxp(getTableReader(parseSfntDirectory(robotoBuffer), 'maxp')!)

      // Both should have reasonable glyph counts but they should differ
      expect(notoMaxp.numGlyphs).toBeGreaterThan(100)
      expect(robotoMaxp.numGlyphs).toBeGreaterThan(100)
      expect(notoMaxp.numGlyphs).not.toBe(robotoMaxp.numGlyphs)
    })

    // Verifies that TTF and CFF fonts are distinguished by their maxp version (1.0 vs 0.5).
    it('TTF and CFF should have different maxp versions', () => {
      const notoBuffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sourceBuffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
      const notoMaxp = parseMaxp(getTableReader(parseSfntDirectory(notoBuffer), 'maxp')!)
      const sourceMaxp = parseMaxp(getTableReader(parseFont(sourceBuffer), 'maxp')!)

      expect(notoMaxp.version).toBe(1.0)
      // CFF fonts have maxp version < 1.0 (no TrueType-specific fields)
      expect(sourceMaxp.version).toBeLessThan(1.0)
    })
  })

  describe('SfntTableManager lazy access', () => {
    // Verifies that SfntTableManager lazily parses and exposes maxp.
    it('should provide maxp via manager', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      expect(manager.maxp.numGlyphs).toBeGreaterThan(0)
      expect(manager.maxp.version).toBe(1.0)
    })
  })
})
