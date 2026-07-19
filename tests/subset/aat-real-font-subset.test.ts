import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Font, type ShapeOptions } from '../../src/font.js'

interface AatSubsetCase {
  path: string
  text: string
  options?: ShapeOptions
  malformedHdmx?: boolean
}

const CASES: readonly AatSubsetCase[] = [
  { path: '/System/Library/Fonts/Supplemental/Telugu MN.ttc', text: 'కై' },
  { path: '/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc', text: 'कृ' },
  { path: '/System/Library/Fonts/Supplemental/Hoefler Text.ttc', text: 'AVATAR' },
  { path: '/System/Library/Fonts/Supplemental/Apple Chancery.ttf', text: 'office' },
  { path: '/System/Library/Fonts/Supplemental/Mishafi.ttf', text: 'مشق', malformedHdmx: true },
  { path: '/System/Library/Fonts/Supplemental/Bangla MN.ttc', text: 'কি' },
  { path: '/System/Library/Fonts/Supplemental/Skia.ttf', text: 'AV' },
  { path: '/System/Library/Fonts/Supplemental/Zapfino.ttf', text: 'office' },
  { path: '/System/Library/Fonts/Supplemental/Raanana.ttc', text: 'שלום', options: { script: 'hebr' } },
  {
    path: '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
    text: '「、。漢',
    options: { direction: 'vertical', script: 'hani' },
  },
]

function load(path: string): ArrayBuffer {
  const bytes = readFileSync(path)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('real AAT compact subset rebuilding', () => {
  for (const testCase of CASES) {
    it.runIf(existsSync(testCase.path))(`rebuilds and reloads ${testCase.path.split('/').pop()}`, () => {
      const source = load(testCase.path)
      const original = Font.load(source)
      const shaped = original.shapeText(testCase.text, testCase.options)
      const glyphIds = new Set<number>(shaped.map(function (glyph) { return glyph.glyphId }))
      if (testCase.malformedHdmx) {
        expect(() => original.subsetWithMapping(testCase.text)).toThrow('hdmx device record size')
        return
      }
      const subset = original.subsetWithMapping(testCase.text)
      expect(subset.buffer.byteLength).toBeLessThan(source.byteLength)
      const reloaded = Font.load(subset.buffer)
      for (const oldGlyph of glyphIds) {
        const newGlyph = subset.oldToNewGlyphId.get(oldGlyph)
        expect(newGlyph, `mapping for glyph ${oldGlyph}`).toBeDefined()
        expect(reloaded.getGlyph(newGlyph!).outline.commands.length, `outline for glyph ${oldGlyph}`).toBe(
          original.getGlyph(oldGlyph).outline.commands.length,
        )
      }
      expect(reloaded.shapeText(testCase.text, testCase.options).map(function (glyph) {
        return {
          glyphId: glyph.glyphId,
          xAdvance: glyph.xAdvance,
          yAdvance: glyph.yAdvance,
          xOffset: glyph.xOffset,
          yOffset: glyph.yOffset,
        }
      })).toEqual(shaped.map(function (glyph) {
        return {
          glyphId: subset.oldToNewGlyphId.get(glyph.glyphId),
          xAdvance: glyph.xAdvance,
          yAdvance: glyph.yAdvance,
          xOffset: glyph.xOffset,
          yOffset: glyph.yOffset,
        }
      }))
    })
  }

  const skiaPath = '/System/Library/Fonts/Supplemental/Skia.ttf'
  it.runIf(existsSync(skiaPath))('bakes a Skia variation instance while rebuilding AAT tables', () => {
    const source = load(skiaPath)
    const original = Font.load(source)
    const coordinates: Record<string, number> = {}
    for (const axis of original.variationAxes) {
      coordinates[axis.tag] = axis.defaultValue + (axis.maxValue - axis.defaultValue) * 0.6
    }
    original.setVariation(coordinates)

    const text = 'AVATAR'
    const shaped = original.shapeText(text)
    const subset = original.subsetWithMapping(text)
    const reloaded = Font.load(subset.buffer)

    expect(subset.buffer.byteLength).toBeLessThan(source.byteLength)
    expect(reloaded.variationAxes).toEqual([])
    expect(reloaded.shapeText(text).map(function (glyph) {
      return {
        glyphId: glyph.glyphId,
        xAdvance: glyph.xAdvance,
        yAdvance: glyph.yAdvance,
        xOffset: glyph.xOffset,
        yOffset: glyph.yOffset,
      }
    })).toEqual(shaped.map(function (glyph) {
      return {
        glyphId: subset.oldToNewGlyphId.get(glyph.glyphId),
        xAdvance: glyph.xAdvance,
        yAdvance: glyph.yAdvance,
        xOffset: glyph.xOffset,
        yOffset: glyph.yOffset,
      }
    }))
    for (const glyph of shaped) {
      const newGlyphId = subset.oldToNewGlyphId.get(glyph.glyphId)!
      const actual = Array.from(reloaded.getGlyph(newGlyphId).outline.coords)
      const expected = Array.from(original.getGlyph(glyph.glyphId).outline.coords)
      expect(actual).toHaveLength(expected.length)
      for (let coordinate = 0; coordinate < actual.length; coordinate++) {
        // Static TrueType outlines store integer design coordinates, so baking a
        // fractional variation instance is exact to the nearest half unit.
        expect(Math.abs(actual[coordinate]! - expected[coordinate]!)).toBeLessThanOrEqual(0.5)
      }
    }
  })
})
