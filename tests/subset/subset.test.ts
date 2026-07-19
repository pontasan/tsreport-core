import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/index.js'
import { parseFont } from '../../src/parsers/index.js'
import { getTableReader } from '../../src/parsers/sfnt-parser.js'
import { parsePost } from '../../src/parsers/tables/post.js'
import { parseCmap } from '../../src/parsers/tables/cmap.js'
import { BinaryReader } from '../../src/binary/reader.js'
import { buildCmapTable } from '../../src/subset/ttf-subset.js'
import {
  buildCmap4, buildFont, buildHead, buildHhea, buildHmtx, buildLocaGlyf,
  buildMaxp, buildName, buildOs2, buildTable,
} from '../renderer/synthetic-font.js'

const NOTO_SANS_PATH = resolve(__dirname, '../fixtures/fonts/NotoSans-Regular.ttf')
const OTF_PATH = resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf')
const JP_OTF_PATH = resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')

describe('Font subsetting', () => {
  it('rebuilds default and non-default format 14 variation sequences', () => {
    const cmap = parseCmap(new BinaryReader(buildCmapTable(
      [{ codePoint: 0x41, newGlyphId: 1 }, { codePoint: 0x42, newGlyphId: 2 }],
      [
        { codePoint: 0x42, variationSelector: 0xFE00, newGlyphId: 2, isDefault: true },
        { codePoint: 0x41, variationSelector: 0xFE00, newGlyphId: 3, isDefault: false },
      ],
    ).buffer))
    expect(cmap.getVariationGlyphId(0x41, 0xFE00)).toBe(3)
    expect(cmap.getVariationGlyphId(0x42, 0xFE00)).toBe(2)
    expect(cmap.getVariationGlyphId(0x43, 0xFE00)).toBeNull()
  })

  describe('TTF subset', () => {
    // Verifies subsetting produces a non-empty buffer smaller than the source font.
    it('should create a subset font from text', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const subsetBuffer = font.subset('ABC')
      expect(subsetBuffer.byteLength).toBeGreaterThan(0)
      expect(subsetBuffer.byteLength).toBeLessThan(buffer.byteLength)
    })

    // Verifies the subset re-loads and its glyph count actually shrank.
    it('should produce a loadable subset font', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const subsetBuffer = font.subset('Hello')
      const subsetFont = Font.load(subsetBuffer)

      expect(subsetFont.numGlyphs).toBeGreaterThan(0)
      expect(subsetFont.numGlyphs).toBeLessThan(font.numGlyphs)
    })

    // Verifies a retained glyph keeps its outline and advance width after subsetting.
    it('should preserve glyph outlines in subset', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const subsetBuffer = font.subset('A')
      const subsetFont = Font.load(subsetBuffer)

      const glyphA = subsetFont.getGlyphByCodePoint(0x0041)
      expect(glyphA.advanceWidth).toBeGreaterThan(0)
      expect(glyphA.outline.commands.length).toBeGreaterThan(0)
    })

    // Verifies font-wide vertical metrics are copied unchanged into the subset.
    it('should preserve metrics', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const subsetBuffer = font.subset('X')
      const subsetFont = Font.load(subsetBuffer)

      expect(subsetFont.metrics.unitsPerEm).toBe(font.metrics.unitsPerEm)
      expect(subsetFont.metrics.ascender).toBe(font.metrics.ascender)
      expect(subsetFont.metrics.descender).toBe(font.metrics.descender)
    })

    it('should rebuild post table glyph names in compact glyph order', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const subsetBuffer = font.subset('ABC')
      const subsetSfnt = parseFont(subsetBuffer)
      const post = parsePost(getTableReader(subsetSfnt, 'post')!)
      const sourcePost = parsePost(getTableReader(parseFont(buffer), 'post')!)
      const mapping = font.subsetWithMapping('ABC').oldToNewGlyphId
      const expectedNames = [...mapping]
        .sort(function (a, b) { return a[1] - b[1] })
        .map(function (entry) { return sourcePost.glyphNames[entry[0]]! })

      expect(post.version).toBe(2)
      expect(post.glyphNames).toEqual(expectedNames)
    })

    it('preserves Apple format 4 character codes and memory fields in compact glyph order', () => {
      const post = buildTable(w => {
        w.writeUint32(0x00040000)
        w.writeUint32(0)
        w.writeInt16(-100)
        w.writeInt16(50)
        w.writeUint32(1)
        w.writeUint32(11)
        w.writeUint32(22)
        w.writeUint32(33)
        w.writeUint32(44)
        w.writeUint16(0xFFFF)
        w.writeUint16(0x0041)
        w.writeUint16(0x0042)
      })
      const { loca, glyf } = buildLocaGlyf([null, null, null])
      const buffer = buildFont([
        ['head', buildHead()], ['maxp', buildMaxp(3)], ['hhea', buildHhea(3)],
        ['hmtx', buildHmtx([[600, 0], [600, 0], [600, 0]])],
        ['cmap', buildCmap4([[0x41, 1], [0x42, 2]])], ['OS/2', buildOs2()],
        ['post', post], ['name', buildName()], ['loca', loca], ['glyf', glyf],
      ])
      const subset = Font.load(buffer).subset('B')
      const subsetFont = Font.load(subset)
      const subsetPost = parsePost(getTableReader(parseFont(subset), 'post')!, { expectedGlyphCount: 2 })
      expect(subsetPost.version).toBe(4)
      expect(Array.from(subsetPost.glyphNameCharacterCodes!)).toEqual([0xFFFF, 0x0042])
      expect(subsetFont.getGlyphName(0)).toBeNull()
      expect(subsetFont.getGlyphName(1)).toBe('a0042')
      expect(subsetFont.postScriptMemoryUsage).toEqual({ minType42: 11, maxType42: 22, minType1: 33, maxType1: 44 })
    })

    // Verifies an empty subset still yields a loadable font containing at least .notdef.
    it('should handle empty text gracefully', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const subsetBuffer = font.subset('')
      const subsetFont = Font.load(subsetBuffer)
      // Should at least have .notdef
      expect(subsetFont.numGlyphs).toBeGreaterThanOrEqual(1)
    })
  })

  describe('CFF subset', () => {
    // Verifies CFF-based subsetting also produces a smaller, non-empty buffer.
    it('should create a subset font from OTF', () => {
      const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const subsetBuffer = font.subset('ABC')
      expect(subsetBuffer.byteLength).toBeGreaterThan(0)
      expect(subsetBuffer.byteLength).toBeLessThan(buffer.byteLength)
    })

    // Verifies the CFF subset re-loads as a CFF font with a reduced glyph set.
    it('should produce a loadable CFF subset font', () => {
      const buffer = readFileSync(OTF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const subsetBuffer = font.subset('Hello')
      const subsetFont = Font.load(subsetBuffer)

      expect(subsetFont.numGlyphs).toBeGreaterThan(0)
      expect(subsetFont.numGlyphs).toBeLessThan(font.numGlyphs)
      expect(subsetFont.isCff).toBe(true)
    })

    it('retains a used non-default Unicode variation sequence and its variant glyph', () => {
      const bytes = readFileSync(JP_OTF_PATH)
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const font = Font.load(buffer)
      const base = 0x4FAE
      const selector = 0xE0101
      const oldBaseGlyphId = font.getGlyphId(base)
      const oldVariantGlyphId = font.cmap.getVariationGlyphId(base, selector)!
      const result = font.subsetWithMapping(`${String.fromCodePoint(base)}${String.fromCodePoint(selector)}`)
      const subset = Font.load(result.buffer)

      expect(subset.getGlyphId(base)).toBe(result.oldToNewGlyphId.get(oldBaseGlyphId))
      expect(subset.cmap.getVariationGlyphId(base, selector)).toBe(result.oldToNewGlyphId.get(oldVariantGlyphId))
      expect(subset.getGlyphIdWithVariation(base, selector)).not.toBe(subset.getGlyphId(base))
      const shaped = subset.shapeText(`${String.fromCodePoint(base)}${String.fromCodePoint(selector)}`)
      expect(shaped).toHaveLength(1)
      expect(shaped[0]!.glyphId).toBe(result.oldToNewGlyphId.get(oldVariantGlyphId))
      expect(shaped[0]!.xAdvance).toBe(subset.getAdvanceWidth(shaped[0]!.glyphId))
    })
  })
})
