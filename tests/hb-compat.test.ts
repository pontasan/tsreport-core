/**
 * HarfBuzz (hb-shape) shaping compatibility regression suite.
 *
 * Compares Font.shapeText() output against committed hb-shape oracle output
 * (tests/hb-compat/expectations/*.json, regenerated manually with
 * `node tests/hb-compat/generate-expectations.ts`; hb-shape is NOT required
 * to run this test).
 *
 * Case classification lives in tests/hb-compat/manifest.ts:
 * - ENFORCED cases must match hb-shape exactly.
 * - PENDING cases must still mismatch — when an implementation change makes a
 *   pending case match hb-shape, its test fails with a message to promote it.
 *
 * Set HB_COMPAT_REPORT=1 to print per-case match status and diffs (used when
 * reclassifying the manifest).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  Font, TextMeasurer, layoutText, renderTextToGroup,
  type RenderGroup, type RenderText, type ShapeOptions,
} from '../src/index.js'
import { CASES, type HbCompatCase } from './hb-compat/cases.ts'
import { compareCase, loadExpectation } from './hb-compat/compare.ts'
import { ENFORCED, PENDING } from './hb-compat/manifest.ts'

const FONTS_DIR = resolve(__dirname, 'fixtures/fonts')

// Font buffers are shared; Font instances are shared only across cases
// without variations (setVariation mutates the instance).
const bufferCache = new Map<string, ArrayBuffer>()
const fontCache = new Map<string, Font>()

function getBuffer(file: string): ArrayBuffer {
  let buf = bufferCache.get(file)
  if (buf === undefined) {
    buf = readFileSync(resolve(FONTS_DIR, file)).buffer as ArrayBuffer
    bufferCache.set(file, buf)
  }
  return buf
}

function getFont(c: HbCompatCase): Font {
  if (c.variations) {
    const font = Font.load(getBuffer(c.font))
    font.setVariation(c.variations)
    return font
  }
  let font = fontCache.get(c.font)
  if (font === undefined) {
    font = Font.load(getBuffer(c.font))
    fontCache.set(c.font, font)
  }
  return font
}

function shapeCase(c: HbCompatCase): string | null {
  const expected = loadExpectation(c.id)
  const options: ShapeOptions = {
    direction: c.direction === 'ttb' ? 'vertical' : 'horizontal',
    features: new Set(c.features),
  }
  if (c.script !== undefined) options.script = c.script
  if (c.language !== undefined) options.language = c.language
  const font = getFont(c)
  const shaped = font.shapeText(c.text, options)
  return compareCase(c, expected, shaped, font)
}

describe('HarfBuzz shaping compatibility', () => {
  it('manifest partitions all cases into ENFORCED/PENDING', () => {
    const enforced = new Set(ENFORCED)
    const pending = new Set(PENDING)
    expect(enforced.size).toBe(ENFORCED.length)
    expect(pending.size).toBe(PENDING.length)

    const caseIds = new Set(CASES.map((c) => c.id))
    expect(caseIds.size).toBe(CASES.length)

    for (const id of ENFORCED) {
      expect(caseIds.has(id), `ENFORCED entry "${id}" is not a known case`).toBe(true)
      expect(pending.has(id), `"${id}" appears in both ENFORCED and PENDING`).toBe(false)
    }
    for (const id of PENDING) {
      expect(caseIds.has(id), `PENDING entry "${id}" is not a known case`).toBe(true)
    }
    for (const c of CASES) {
      expect(
        enforced.has(c.id) || pending.has(c.id),
        `case "${c.id}" is missing from the manifest`,
      ).toBe(true)
    }
  })

  it('connects RTL shaping to the report layout visual run', () => {
    const c = CASES.find(testCase => testCase.id === 'ar-word')!
    const expected = loadExpectation(c.id)
    const font = getFont(c)
    const featureValues: Record<string, number> = {}
    for (let i = 0; i < c.features.length; i++) featureValues[c.features[i]!] = 1
    const line = layoutText(c.text, new TextMeasurer(font), font.metrics.unitsPerEm, {
      maxWidth: Number.POSITIVE_INFINITY,
      direction: 'rtl',
      openTypeScript: c.script,
      openTypeFeatures: featureValues,
    }).lines[0]!
    const run = line.run!
    expect(Array.from(run.glyphIds)).toEqual(expected.glyphs.map(glyph => glyph.g))
    expect(Array.from(run.advances)).toEqual(expected.glyphs.map(glyph => glyph.ax))
    expect(Array.from(run.xOffsets)).toEqual(expected.glyphs.map(glyph => glyph.dx))
    expect(Array.from(run.yOffsets)).toEqual(expected.glyphs.map(glyph => glyph.dy))
  })

  it('connects variable-font coordinates to report measurement and rendering', () => {
    const c = CASES.find(testCase => testCase.id === 'vf-wght700-hello')!
    const expected = loadExpectation(c.id)
    const font = Font.load(getBuffer(c.font))
    const featureValues: Record<string, number> = {}
    for (let i = 0; i < c.features.length; i++) featureValues[c.features[i]!] = 1
    const node = renderTextToGroup(c.text, {
      x: 0, y: 0, width: 10000, height: 2000,
      openTypeScript: c.script,
      openTypeFeatures: featureValues,
    }, {
      fontFamily: 'test', fontSize: font.metrics.unitsPerEm,
      bold: false, italic: false, underline: false, strikethrough: false,
      forecolor: '#000000', hAlign: 'left', vAlign: 'top',
      variation: c.variations,
    }, new TextMeasurer(font), false) as RenderGroup
    const text = node.children[0] as RenderText
    expect(Array.from(text.glyphRun!.glyphIds)).toEqual(expected.glyphs.map(glyph => glyph.g))
    expect(Array.from(text.glyphRun!.advances)).toEqual(expected.glyphs.map(glyph => glyph.ax))
    expect(font.variationCoordinates).toBeNull()
  })

  if (process.env['HB_COMPAT_REPORT']) {
    it('report (HB_COMPAT_REPORT)', () => {
      for (const c of CASES) {
        const diff = shapeCase(c)
        const status = diff === null ? 'MATCH   ' : 'MISMATCH'
        console.log(`${status} ${c.category.padEnd(11)} ${c.id}`)
        if (diff !== null) console.log(`         ${diff}`)
      }
    })
  }

  const enforcedSet = new Set(ENFORCED)
  for (const c of CASES) {
    if (enforcedSet.has(c.id)) {
      it(`[enforced] ${c.id}`, () => {
        const diff = shapeCase(c)
        expect(diff, `"${c.id}" no longer matches hb-shape: ${diff}`).toBeNull()
      })
    } else {
      it(`[pending] ${c.id} still mismatches hb-shape`, () => {
        const diff = shapeCase(c)
        expect(
          diff,
          `"${c.id}" now matches hb-shape — promote it from PENDING to ENFORCED in tests/hb-compat/manifest.ts`,
        ).not.toBeNull()
      })
    }
  }
})
