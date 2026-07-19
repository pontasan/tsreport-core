import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseFont } from '../../../src/parsers/index.js'
import { parsePost } from '../../../src/parsers/tables/post.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'
import { Font } from '../../../src/font.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
const SOURCE_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/SourceSans3-Regular.otf')

describe('post table parser', () => {
  describe('NotoSans-Regular (TrueType)', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const post = parsePost(getTableReader(sfnt, 'post')!)

    it('should have a valid version (1.0, 2.0, or 3.0)', () => {
      expect([1.0, 2.0, 3.0]).toContain(post.version)
    })

    it('should have italicAngle 0 for Regular (upright) font', () => {
      expect(post.italicAngle).toBe(0)
    })

    it('should have negative underlinePosition (below baseline)', () => {
      expect(post.underlinePosition).toBeLessThan(0)
    })

    it('should have positive underlineThickness', () => {
      expect(post.underlineThickness).toBeGreaterThan(0)
    })

    it('should have isFixedPitch 0 for proportional font', () => {
      expect(post.isFixedPitch).toBe(0)
    })

    it('exposes PostScript memory fields through the public Font API', () => {
      const font = Font.load(buffer)
      expect(font.postScriptMemoryUsage).toEqual({
        minType42: post.minMemType42,
        maxType42: post.maxMemType42,
        minType1: post.minMemType1,
        maxType1: post.maxMemType1,
      })
    })
  })

  describe('Roboto-Regular (TrueType)', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const post = parsePost(getTableReader(sfnt, 'post')!)

    it('should have a valid version', () => {
      expect([1.0, 2.0, 3.0]).toContain(post.version)
    })

    it('should have italicAngle 0 for Regular font', () => {
      expect(post.italicAngle).toBe(0)
    })

    it('should have negative underlinePosition', () => {
      expect(post.underlinePosition).toBeLessThan(0)
    })

    it('should have positive underlineThickness', () => {
      expect(post.underlineThickness).toBeGreaterThan(0)
    })

    it('should have isFixedPitch 0 for proportional font', () => {
      expect(post.isFixedPitch).toBe(0)
    })
  })

  describe('SourceSans3-Regular (OTF/CFF)', () => {
    const buffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseFont(buffer)
    const post = parsePost(getTableReader(sfnt, 'post')!)

    it('should have a valid version', () => {
      expect([1.0, 2.0, 3.0]).toContain(post.version)
    })

    it('should have italicAngle 0 for Regular font', () => {
      expect(post.italicAngle).toBe(0)
    })

    it('should have negative underlinePosition', () => {
      expect(post.underlinePosition).toBeLessThan(0)
    })

    it('should have positive underlineThickness', () => {
      expect(post.underlineThickness).toBeGreaterThan(0)
    })

    it('should have isFixedPitch 0 for proportional font', () => {
      expect(post.isFixedPitch).toBe(0)
    })
  })

  describe('cross-font consistency', () => {
    it('all Regular fonts should have italicAngle 0', () => {
      const fonts = [NOTO_SANS_PATH, ROBOTO_PATH, SOURCE_SANS_PATH]
      for (const fontPath of fonts) {
        const buffer = readFileSync(fontPath).buffer as ArrayBuffer
        const sfnt = fontPath.endsWith('.otf') ? parseFont(buffer) : parseSfntDirectory(buffer)
        const post = parsePost(getTableReader(sfnt, 'post')!)
        expect(post.italicAngle).toBe(0)
      }
    })

    it('all fonts should have negative underlinePosition', () => {
      const fonts = [NOTO_SANS_PATH, ROBOTO_PATH, SOURCE_SANS_PATH]
      for (const fontPath of fonts) {
        const buffer = readFileSync(fontPath).buffer as ArrayBuffer
        const sfnt = fontPath.endsWith('.otf') ? parseFont(buffer) : parseSfntDirectory(buffer)
        const post = parsePost(getTableReader(sfnt, 'post')!)
        expect(post.underlinePosition).toBeLessThan(0)
      }
    })

    it('all fonts should have positive underlineThickness', () => {
      const fonts = [NOTO_SANS_PATH, ROBOTO_PATH, SOURCE_SANS_PATH]
      for (const fontPath of fonts) {
        const buffer = readFileSync(fontPath).buffer as ArrayBuffer
        const sfnt = fontPath.endsWith('.otf') ? parseFont(buffer) : parseSfntDirectory(buffer)
        const post = parsePost(getTableReader(sfnt, 'post')!)
        expect(post.underlineThickness).toBeGreaterThan(0)
      }
    })
  })

  describe('SfntTableManager lazy access', () => {
    it('should provide post via manager', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      const post = manager.post
      expect(post.italicAngle).toBe(0)
      expect(post.isFixedPitch).toBe(0)
    })
  })

  // Real-font oracle: underline metrics read from fontTools.
  describe('underline metrics match fontTools', () => {
    it('Roboto-Regular', () => {
      const post = parsePost(getTableReader(parseSfntDirectory(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer), 'post')!)
      expect(post.italicAngle).toBe(0)
      expect(post.underlinePosition).toBe(-150)
      expect(post.underlineThickness).toBe(100)
    })

    it('SourceSans3-Regular', () => {
      const post = parsePost(getTableReader(parseSfntDirectory(readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer), 'post')!)
      expect(post.italicAngle).toBe(0)
      expect(post.underlinePosition).toBe(-50)
      expect(post.underlineThickness).toBe(50)
    })
  })
})
