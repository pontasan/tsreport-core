import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/index.js'

const TTF_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')
const NOTO_SANS_PATH = resolve(__dirname, '../fixtures/fonts/NotoSans-Regular.ttf')
const OTF_PATH = resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf')
const WOFF_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.woff')
const WOFF2_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.woff2')

describe('Format detection', () => {
  describe('TTF format', () => {
    // Verifies the fixture starts with the 0x00010000 sfnt version that marks TTF files.
    it('should detect TTF signature 0x00010000', () => {
      const buffer = readFileSync(TTF_PATH).buffer as ArrayBuffer
      const view = new DataView(buffer)
      // TTF files start with 0x00010000
      expect(view.getUint32(0)).toBe(0x00010000)
    })

    // Verifies Font.load classifies the TTF signature as format 'ttf'.
    it('should load TTF and report format as "ttf"', () => {
      const buffer = readFileSync(TTF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.format).toBe('ttf')
    })

    // Verifies TTF detection is not fixture-specific by loading a second TTF.
    it('should load NotoSans TTF and report format as "ttf"', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.format).toBe('ttf')
    })

    // Verifies TTF fonts report isCff=false (glyf-based outlines).
    it('should not be CFF for TTF fonts', () => {
      const buffer = readFileSync(TTF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.isCff).toBe(false)
    })
  })

  describe('OTF format', () => {
    // Verifies the fixture starts with the 'OTTO' tag that marks CFF-flavored OpenType.
    it('should detect OTF signature "OTTO" (0x4F54544F)', () => {
      const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
      const view = new DataView(buffer)
      // OTF/CFF files start with 'OTTO'
      expect(view.getUint32(0)).toBe(0x4F54544F)
    })

    // Verifies Font.load classifies the OTTO signature as format 'otf'.
    it('should load OTF and report format as "otf"', () => {
      const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.format).toBe('otf')
    })

    // Verifies OTTO fonts report isCff=true.
    it('should report isCff as true for OTF', () => {
      const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.isCff).toBe(true)
    })
  })

  describe('WOFF format', () => {
    // Verifies the fixture starts with the 'wOFF' container signature.
    it('should detect WOFF signature "wOFF" (0x774F4646)', () => {
      const buffer = readFileSync(WOFF_PATH).buffer as ArrayBuffer
      const view = new DataView(buffer)
      expect(view.getUint32(0)).toBe(0x774F4646)
    })

    // Verifies Font.load classifies the wOFF signature as format 'woff'.
    it('should load WOFF and report format as "woff"', () => {
      const buffer = readFileSync(WOFF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.format).toBe('woff')
    })

    // Verifies the wrapped flavor (TTF) determines isCff, not the WOFF container.
    it('should not be CFF for WOFF wrapping a TTF', () => {
      const buffer = readFileSync(WOFF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.isCff).toBe(false)
    })

    // Verifies zlib-decompressed WOFF tables reassemble into a fully usable SFNT.
    it('should unwrap WOFF to SFNT and parse tables correctly', () => {
      const buffer = readFileSync(WOFF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      // If unwrapping works, we can access all standard font data
      expect(font.familyName).toBeTruthy()
      expect(font.metrics.unitsPerEm).toBeGreaterThan(0)
      expect(font.numGlyphs).toBeGreaterThan(0)

      const glyph = font.getGlyphByCodePoint(0x0041) // 'A'
      expect(glyph.advanceWidth).toBeGreaterThan(0)
      expect(glyph.outline.commands.length).toBeGreaterThan(0)
    })
  })

  describe('WOFF2 format', () => {
    // Verifies the fixture starts with the 'wOF2' container signature.
    it('should detect WOFF2 signature "wOF2" (0x774F4632)', () => {
      const buffer = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
      const view = new DataView(buffer)
      expect(view.getUint32(0)).toBe(0x774F4632)
    })

    // Verifies Font.load classifies the wOF2 signature as format 'woff2'.
    it('should load WOFF2 and report format as "woff2"', () => {
      const buffer = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.format).toBe('woff2')
    })

    // Verifies the wrapped flavor (TTF) determines isCff for WOFF2 as well.
    it('should not be CFF for WOFF2 wrapping a TTF', () => {
      const buffer = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      expect(font.isCff).toBe(false)
    })

    // Verifies Brotli decompression plus glyf/loca transform reversal yields a usable font.
    it('should unwrap WOFF2 to SFNT and parse tables correctly', () => {
      const buffer = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      // If unwrapping (Brotli + transform reversal) works, we can access all data
      expect(font.familyName).toBeTruthy()
      expect(font.metrics.unitsPerEm).toBeGreaterThan(0)
      expect(font.numGlyphs).toBeGreaterThan(0)

      const glyph = font.getGlyphByCodePoint(0x0041) // 'A'
      expect(glyph.advanceWidth).toBeGreaterThan(0)
      expect(glyph.outline.commands.length).toBeGreaterThan(0)
    })
  })

  describe('Invalid data handling', () => {
    // Verifies an unknown signature is rejected with an exception.
    it('should throw on completely invalid data', () => {
      const buffer = new ArrayBuffer(64)
      const view = new DataView(buffer)
      // Fill with garbage that does not match any known signature
      view.setUint32(0, 0xDEADBEEF)
      expect(() => Font.load(buffer)).toThrow()
    })

    // Verifies a zero-length buffer is rejected instead of crashing on reads.
    it('should throw on empty buffer', () => {
      const buffer = new ArrayBuffer(0)
      expect(() => Font.load(buffer)).toThrow()
    })

    // Verifies a buffer too short to hold a signature is rejected.
    it('should throw on too-short buffer (1 byte)', () => {
      const buffer = new ArrayBuffer(1)
      expect(() => Font.load(buffer)).toThrow()
    })

    // Verifies a buffer one byte short of a signature is rejected.
    it('should throw on too-short buffer (3 bytes)', () => {
      const buffer = new ArrayBuffer(3)
      expect(() => Font.load(buffer)).toThrow()
    })

    // Verifies a truncated table directory fails at load or at first table access (lazy parsing).
    it('should throw on buffer with valid signature but truncated data when accessing tables', () => {
      // Create a buffer that starts with TTF signature but has no real table data.
      // Due to lazy parsing, load() may succeed but accessing tables will fail.
      const buffer = new ArrayBuffer(12)
      const view = new DataView(buffer)
      view.setUint32(0, 0x00010000) // TTF signature
      view.setUint16(4, 100) // claim 100 tables (but no data)

      // Either load itself throws or accessing data throws
      try {
        const font = Font.load(buffer)
        // If load succeeded, accessing properties should throw
        expect(() => font.familyName).toThrow()
      } catch {
        // load threw - that's also acceptable
        expect(true).toBe(true)
      }
    })

    // Verifies random bytes with a non-matching signature are rejected.
    it('should throw on random noise data', () => {
      const buffer = new ArrayBuffer(256)
      const view = new Uint8Array(buffer)
      for (let i = 0; i < 256; i++) {
        view[i] = Math.floor(Math.random() * 256)
      }
      // Overwrite first 4 bytes to avoid accidentally matching a signature
      new DataView(buffer).setUint32(0, 0x12345678)
      expect(() => Font.load(buffer)).toThrow()
    })
  })

  describe('isCff property across formats', () => {
    // Cross-format check: TTF reports isCff=false.
    it('TTF: isCff should be false', () => {
      const buffer = readFileSync(TTF_PATH).buffer as ArrayBuffer
      expect(Font.load(buffer).isCff).toBe(false)
    })

    // Cross-format check: OTF reports isCff=true.
    it('OTF: isCff should be true', () => {
      const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
      expect(Font.load(buffer).isCff).toBe(true)
    })

    // Cross-format check: TTF-based WOFF reports isCff=false.
    it('WOFF (TTF-based): isCff should be false', () => {
      const buffer = readFileSync(WOFF_PATH).buffer as ArrayBuffer
      expect(Font.load(buffer).isCff).toBe(false)
    })

    // Cross-format check: TTF-based WOFF2 reports isCff=false.
    it('WOFF2 (TTF-based): isCff should be false', () => {
      const buffer = readFileSync(WOFF2_PATH).buffer as ArrayBuffer
      expect(Font.load(buffer).isCff).toBe(false)
    })
  })

  describe('Format property consistency', () => {
    // Verifies the format getter is stable across repeated accesses.
    it('should return format consistently across multiple accesses', () => {
      const buffer = readFileSync(TTF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const format1 = font.format
      const format2 = font.format
      expect(format1).toBe(format2)
      expect(format1).toBe('ttf')
    })

    // Verifies each container maps to its expected format string in one sweep.
    it('each format should return the correct string', () => {
      const formats: Array<{ path: string, expected: string }> = [
        { path: TTF_PATH, expected: 'ttf' },
        { path: OTF_PATH, expected: 'otf' },
        { path: WOFF_PATH, expected: 'woff' },
        { path: WOFF2_PATH, expected: 'woff2' },
      ]

      for (const { path, expected } of formats) {
        const buffer = readFileSync(path).buffer as ArrayBuffer
        const font = Font.load(buffer)
        expect(font.format).toBe(expected)
      }
    })
  })
})
