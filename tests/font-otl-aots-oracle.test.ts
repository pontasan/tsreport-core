import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  Font, TextMeasurer, renderTextToGroup,
  type OpenTypeFeatureSetting, type RenderGroup, type RenderText,
} from '../src/index.js'

type OracleGlyph = readonly [
  glyphId: number,
  xOffset: number,
  yOffset: number,
  xAdvance: number,
  yAdvance: number,
]

interface OracleCase {
  id: string
  font: string
  codePoints: readonly number[]
  expected: readonly OracleGlyph[]
  features?: readonly string[]
  featureSettings?: readonly OpenTypeFeatureSetting[]
  script?: string
  variation?: Readonly<Record<string, number>>
}

const AOTS = 'hb-aots-'

// Expected values were generated with hb-shape 13.2.1 from the pinned
// HarfBuzz AOTS, in-house, and text-rendering test fonts. The test deliberately
// stores the independent results so HarfBuzz is not a test or runtime dependency.
const CASES: readonly OracleCase[] = [
  {
    id: 'GSUB 1 SingleSubst format 1', font: `${AOTS}gsub1_1_simple_f1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [23, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 1 SingleSubst format 2', font: `${AOTS}gsub1_2_simple_f1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [22, 0, 0, 1500, 0], [19, 0, 0, 1500, 0], [25, 0, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 2 MultipleSubst format 1', font: `${AOTS}gsub2_1_simple_f1.otf`,
    codePoints: [0x11, 0x12, 0x13], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 0, 0, 1500, 0], [22, 0, 0, 1500, 0], [19, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 3 AlternateSubst format 1', font: `${AOTS}gsub3_1_simple_f1.otf`,
    codePoints: [0x12], features: ['test'], expected: [[20, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 3 AlternateSubst feature values and source-cluster ranges', font: `${AOTS}gsub3_1_simple_f1.otf`,
    codePoints: [0x11, 0x12, 0x11, 0x12, 0x11, 0x12, 0x11, 0x12, 0x11, 0x12, 0x11, 0x12, 0x11],
    featureSettings: [
      { tag: 'test', value: 0, start: 1, end: 2 },
      { tag: 'test', value: 1, start: 3, end: 4 },
      { tag: 'test', value: 2, start: 5, end: 6 },
      { tag: 'test', value: 3, start: 7, end: 8 },
      { tag: 'test', value: 0, start: 9, end: 10 },
      { tag: 'test', value: 1, start: 11, end: 12 },
    ],
    expected: [
      [17, 0, 0, 1500, 0], [18, 0, 0, 1500, 0], [17, 0, 0, 1500, 0],
      [20, 0, 0, 1500, 0], [17, 0, 0, 1500, 0], [21, 0, 0, 1500, 0],
      [17, 0, 0, 1500, 0], [22, 0, 0, 1500, 0], [17, 0, 0, 1500, 0],
      [18, 0, 0, 1500, 0], [17, 0, 0, 1500, 0], [20, 0, 0, 1500, 0],
      [17, 0, 0, 1500, 0],
    ],
  },
  {
    id: 'GSUB 4 LigatureSubst format 1 preference order', font: `${AOTS}gsub4_1_multiple_ligatures_f2.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x11, 0x12, 0x13, 0x16, 0x14], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [17, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [22, 0, 0, 1500, 0], [20, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 5 ContextSubst format 1 successive records', font: `${AOTS}gsub_context1_successive_f1.otf`,
    codePoints: [0, 0x14, 0x15, 0x16, 0x17, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [61, 0, 0, 1500, 0], [63, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 5 ContextSubst format 2 successive records', font: `${AOTS}gsub_context2_successive_f1.otf`,
    codePoints: [0, 0x14, 0x15, 0x16, 0x17, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [61, 0, 0, 1500, 0], [63, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 5 ContextSubst format 3 successive records', font: `${AOTS}gsub_context3_successive_f1.otf`,
    codePoints: [0, 0x14, 0x15, 0x16, 0x17, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [61, 0, 0, 1500, 0], [63, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 6 ChainContextSubst format 1 successive records', font: `${AOTS}gsub_chaining1_successive_f1.otf`,
    codePoints: [0, 0x19, 0x14, 0x15, 0x16, 0x17, 0x18, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [25, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [61, 0, 0, 1500, 0], [63, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 6 ChainContextSubst format 2 successive records', font: `${AOTS}gsub_chaining2_successive_f1.otf`,
    codePoints: [0, 0x19, 0x14, 0x15, 0x16, 0x17, 0x18, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [25, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [61, 0, 0, 1500, 0], [63, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 6 ChainContextSubst format 3 successive records', font: `${AOTS}gsub_chaining3_successive_f1.otf`,
    codePoints: [0, 0x19, 0x14, 0x15, 0x16, 0x17, 0x18, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [25, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [61, 0, 0, 1500, 0], [63, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 7 ExtensionSubst format 1', font: `${AOTS}gsub7_font1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [23, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'GSUB 8 ReverseChainSingleSubst format 1', font: 'hb-reverse-substitution.ttf',
    codePoints: [0x41, 0x20, 0x41, 0x42],
    expected: [[4, 0, 0, 1000, 0], [1, 0, 0, 1000, 0], [4, 0, 0, 1000, 0], [3, 0, 0, 1000, 0]],
  },
  {
    id: 'GPOS 1 SinglePos format 1', font: `${AOTS}gpos1_1_simple_f1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, -200, 0, 1500, 0], [19, 0, 0, 1500, 0], [20, -200, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS feature source-cluster range', font: `${AOTS}gpos1_1_simple_f1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x15],
    featureSettings: [{ tag: 'test', value: 1, start: 1, end: 3 }],
    expected: [[17, 0, 0, 1500, 0], [18, -200, 0, 1500, 0], [19, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 1 SinglePos format 2', font: `${AOTS}gpos1_2_font1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, -200, 0, 1500, 0], [19, 0, 0, 1500, 0], [20, -300, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 2 PairPos format 1', font: `${AOTS}gpos2_1_simple_f1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x11, 0x12, 0x14], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, -200, 0, 1500, 0], [19, 0, -100, 1500, 0], [17, 0, 0, 1500, 0], [18, 0, 0, 1500, 0], [20, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 2 PairPos format 2', font: `${AOTS}gpos2_2_font1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x11, 0x12, 0x14], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, -200, 0, 1500, 0], [19, 0, -100, 1500, 0], [17, 0, 0, 1500, 0], [18, 0, 0, 1500, 0], [20, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 3 CursivePos format 1', font: `${AOTS}gpos3_font1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x11], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, 0, 0, 200, 0], [19, -101, 99, 1399, 0], [17, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 4 MarkBasePos format 1', font: `${AOTS}gpos4_simple_1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x11], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, 0, 0, 1500, 0], [19, -1600, -80, 0, 0], [17, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 5 MarkLigPos format 1', font: `${AOTS}gpos5_font1.otf`,
    codePoints: [0x11, 0x1E, 0x13, 0x1F, 0x11], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, 0, 0, 1500, 0], [19, -1600, -80, 0, 0], [17, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 6 MarkMarkPos format 1', font: `${AOTS}gpos6_font1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x11], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, 0, 0, 0, 0], [19, -100, -80, 0, 0], [17, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 7 ContextPos format 1', font: `${AOTS}gpos_context1_successive_f1.otf`,
    codePoints: [0, 0x14, 0x15, 0x16, 0x17, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 20, 0, 1500, 0], [22, 20, 0, 1500, 0], [23, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 7 ContextPos format 2', font: `${AOTS}gpos_context2_successive_f1.otf`,
    codePoints: [0, 0x14, 0x15, 0x16, 0x17, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 20, 0, 1500, 0], [22, 20, 0, 1500, 0], [23, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 7 ContextPos format 3', font: `${AOTS}gpos_context3_successive_f1.otf`,
    codePoints: [0, 0x14, 0x15, 0x16, 0x17, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 20, 0, 1500, 0], [22, 20, 0, 1500, 0], [23, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 8 ChainContextPos format 1', font: `${AOTS}gpos_chaining1_successive_f1.otf`,
    codePoints: [0, 0x19, 0x14, 0x15, 0x16, 0x17, 0x18, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [25, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 20, 0, 1500, 0], [22, 20, 0, 1500, 0], [23, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 8 ChainContextPos format 2', font: `${AOTS}gpos_chaining2_successive_f1.otf`,
    codePoints: [0, 0x19, 0x14, 0x15, 0x16, 0x17, 0x18, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [25, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 20, 0, 1500, 0], [22, 20, 0, 1500, 0], [23, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 8 ChainContextPos format 3', font: `${AOTS}gpos_chaining3_successive_f1.otf`,
    codePoints: [0, 0x19, 0x14, 0x15, 0x16, 0x17, 0x18, 0], features: ['test'],
    expected: [[0, 0, 0, 1500, 0], [25, 0, 0, 1500, 0], [20, 0, 0, 1500, 0], [21, 20, 0, 1500, 0], [22, 20, 0, 1500, 0], [23, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [0, 0, 0, 1500, 0]],
  },
  {
    id: 'GPOS 9 ExtensionPos format 1', font: `${AOTS}gpos9_font1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [18, -200, 0, 1500, 0], [19, 0, 0, 1500, 0], [20, -200, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'LookupFlag IgnoreBaseGlyphs', font: `${AOTS}lookupflag_ignore_base_f1.otf`,
    codePoints: [0x11, 0x12, 0x13, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [23, 0, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'LookupFlag IgnoreLigatures', font: `${AOTS}lookupflag_ignore_ligatures_f1.otf`,
    codePoints: [0x11, 0x12, 0x1A, 0x1B, 0x13, 0x1B, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [23, 0, 0, 1500, 0], [26, 0, 0, 1500, 0], [27, 0, 0, 1500, 0], [27, 0, 0, 1500, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'LookupFlag IgnoreMarks', font: `${AOTS}lookupflag_ignore_marks_f1.otf`,
    codePoints: [0x11, 0x12, 0x1C, 0x1D, 0x13, 0x1D, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [23, 0, 0, 1500, 0], [28, -1500, 0, 0, 0], [29, -1500, 0, 0, 0], [29, -1500, 0, 0, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'LookupFlag MarkAttachmentType', font: `${AOTS}lookupflag_ignore_attach_f1.otf`,
    codePoints: [0x0A, 0x0B, 0x15, 0x0D, 0x16, 0x17, 0x1D, 0x1A, 0x0A], features: ['test'],
    expected: [[10, 0, 0, 1500, 0], [15, 0, 0, 1500, 0], [21, -1500, 0, 0, 0], [22, -1500, 0, 0, 0], [23, -1500, 0, 0, 0], [29, -1500, 0, 0, 0], [10, 0, 0, 1500, 0]],
  },
  {
    id: 'LookupFlag combined IgnoreBaseGlyphs and MarkAttachmentType', font: `${AOTS}lookupflag_ignore_combination_f1.otf`,
    codePoints: [0x11, 0x12, 0x1A, 0x13, 0x18, 0x1E, 0x1F, 0x14, 0x15], features: ['test'],
    expected: [[17, 0, 0, 1500, 0], [23, 0, 0, 1500, 0], [26, 0, 0, 1500, 0], [24, 0, 0, 1500, 0], [30, -1500, 0, 0, 0], [31, -1500, 0, 0, 0], [21, 0, 0, 1500, 0]],
  },
  {
    id: 'LookupFlag UseMarkFilteringSet', font: 'hb-mark-filtering-set.ttf',
    codePoints: [0x0634, 0x0652, 0x0652], script: 'arab', variation: { wght: 700 },
    expected: [[5, 0, 0, 1370, 0], [12, 750, 282, 0, 0], [12, 750, 282, 0, 0]],
  },
  {
    id: 'LookupFlag RightToLeft cursive attachment', font: 'hb-cursive-right-to-left.ttf',
    codePoints: [0x0644, 0x0633, 0x0627, 0x0646], script: 'arab',
    expected: [[127, 0, 457, 635, 0], [307, 0, 0, 0, 0], [273, 0, 0, 1103, 0], [19, 0, 0, 540, 0], [22, 0, 0, 1764, 0], [6, 815, -2, 0, 0]],
  },
  {
    id: 'GSUB FeatureVariations default feature table', font: 'hb-feature-variations.otf',
    codePoints: [0x24], features: ['rvrn'], variation: { wght: 700 }, expected: [[1, 0, 0, 530, 0]],
  },
  {
    id: 'GSUB FeatureVariations alternate feature table', font: 'hb-feature-variations.otf',
    codePoints: [0x24], features: ['rvrn'], variation: { wght: 800 }, expected: [[2, 0, 0, 540, 0]],
  },
]

const fonts = new Map<string, Font>()

function loadFont(file: string): Font {
  let font = fonts.get(file)
  if (font !== undefined) return font
  const bytes = readFileSync(resolve(__dirname, 'fixtures/fonts', file))
  font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  fonts.set(file, font)
  return font
}

describe('OpenType layout AOTS real-font oracle', () => {
  it.each(CASES)('$id', testCase => {
    const font = loadFont(testCase.font)
    font.setVariation(testCase.variation ?? {})
    const shaped = font.shapeText(String.fromCodePoint(...testCase.codePoints), {
      features: testCase.features === undefined ? undefined : new Set(testCase.features),
      featureSettings: testCase.featureSettings,
      script: testCase.script,
    })
    const actual: OracleGlyph[] = shaped.map(glyph => [
      glyph.glyphId,
      glyph.xOffset,
      glyph.yOffset,
      glyph.xAdvance,
      glyph.yAdvance,
    ])
    expect(actual).toEqual(testCase.expected)
  })

  const compactCases = CASES.filter(function (testCase) {
    return testCase.variation === undefined && (testCase.id.startsWith('GSUB ') || testCase.id.startsWith('GPOS '))
      && !testCase.id.includes('feature values') && !testCase.id.includes('source-cluster range')
  })

  it.each(compactCases)('$id survives compact subset rebuilding', testCase => {
    const source = loadFont(testCase.font)
    source.setVariation({})
    const text = String.fromCodePoint(...testCase.codePoints)
    const expected = source.shapeText(text, {
      features: testCase.features === undefined ? undefined : new Set(testCase.features),
      featureSettings: testCase.featureSettings,
      script: testCase.script,
    })
    const result = source.subsetWithMapping(text)
    const subset = Font.load(result.buffer)
    const actual = subset.shapeText(text, {
      features: testCase.features === undefined ? undefined : new Set(testCase.features),
      featureSettings: testCase.featureSettings,
      script: testCase.script,
    })
    expect(actual.map(function (glyph) {
      return [glyph.glyphId, glyph.xOffset, glyph.yOffset, glyph.xAdvance, glyph.yAdvance]
    })).toEqual(expected.map(function (glyph) {
      return [result.oldToNewGlyphId.get(glyph.glyphId)!, glyph.xOffset, glyph.yOffset, glyph.xAdvance, glyph.yAdvance]
    }))
  })

  it('bakes the selected GSUB FeatureVariations feature table into a compact static font', () => {
    const source = loadFont('hb-feature-variations.otf')
    source.setVariation({ wght: 800 })
    const text = '$'
    const expected = source.shapeText(text, { features: new Set(['rvrn']) })
    const result = source.subsetWithMapping(text)
    const subset = Font.load(result.buffer)
    expect(subset.isVariable).toBe(false)
    expect(subset.shapeText(text, { features: new Set(['rvrn']) }).map(function (glyph) {
      return [glyph.glyphId, glyph.xAdvance]
    })).toEqual(expected.map(function (glyph) {
      return [result.oldToNewGlyphId.get(glyph.glyphId)!, glyph.xAdvance]
    }))
  })

  it('connects OpenType feature values to report measurement and the rendered glyph run', () => {
    const font = loadFont(`${AOTS}gsub3_1_simple_f1.otf`)
    const node = renderTextToGroup('\x12', {
      x: 0, y: 0, width: 200, height: 40,
      openTypeFeatures: { test: 2 },
    }, {
      fontFamily: 'test', fontSize: 12, bold: false, italic: false,
      underline: false, strikethrough: false, forecolor: '#000000',
      hAlign: 'left', vAlign: 'top',
    }, new TextMeasurer(font), false) as RenderGroup
    const text = node.children[0] as RenderText
    expect(Array.from(text.glyphRun!.glyphIds)).toEqual([21])
    expect(text.glyphRun!.advances[0]).toBe(12)
  })

  it('connects OpenType script and LangSys selection to the rendered glyph run', () => {
    const font = loadFont('NotoSans-Regular.ttf')
    const node = renderTextToGroup('б', {
      x: 0, y: 0, width: 200, height: 40,
      openTypeScript: 'cyrl', openTypeLanguage: 'SRB ',
    }, {
      fontFamily: 'test', fontSize: 10, bold: false, italic: false,
      underline: false, strikethrough: false, forecolor: '#000000',
      hAlign: 'left', vAlign: 'top',
    }, new TextMeasurer(font), false) as RenderGroup
    const text = node.children[0] as RenderText
    expect(Array.from(text.glyphRun!.glyphIds)).toEqual([2092])
    expect(text.glyphRun!.advances[0]).toBeCloseTo(6.04)
  })
})
