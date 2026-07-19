import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Font, type MorxFeatureSelector } from '../src/font.js'
import { graphemeClusters } from '../src/layout/grapheme-break.js'

interface HarfBuzzGlyph {
  g: number
  cl: number
  dx: number
  dy: number
  ax: number
  ay: number
}

interface OracleCase {
  name: string
  path: string
  text: string
  script: string
  language: string
  rightToLeft: boolean
  fontIndex?: number
  aatFeatures?: readonly MorxFeatureSelector[]
  hbFeatures?: string
  variations?: Readonly<Record<string, number>>
}

const hbShape = process.env.HB_SHAPE ?? '/opt/homebrew/bin/hb-shape'
const cases: OracleCase[] = [
  {
    name: 'Tamil type-5 insertion',
    path: '/System/Library/Fonts/Supplemental/Tamil MN.ttc',
    text: 'கொ',
    script: 'taml',
    language: 'ta',
    rightToLeft: false,
    fontIndex: 0,
  },
  {
    name: 'Thai ligature substitution',
    path: '/System/Library/Fonts/Supplemental/Thonburi.ttc',
    text: 'กำ',
    script: 'thai',
    language: 'th',
    rightToLeft: false,
    fontIndex: 0,
  },
  {
    name: 'Arabic contextual direction',
    path: '/System/Library/Fonts/Supplemental/Diwan Thuluth.ttf',
    text: 'ثلث',
    script: 'arab',
    language: 'ar',
    rightToLeft: true,
  },
  {
    name: 'Latin morx ligatures',
    path: '/System/Library/Fonts/Supplemental/ChalkboardSE.ttc',
    text: 'ffi fflaffe',
    script: 'latn',
    language: 'en',
    rightToLeft: false,
    fontIndex: 0,
  },
  {
    name: 'Skia explicit AAT character alternative',
    path: '/System/Library/Fonts/Supplemental/Skia.ttf',
    text: 'rtt',
    script: 'latn',
    language: 'en',
    rightToLeft: false,
    aatFeatures: [{ featureType: 17, featureSetting: 1 }],
    hbFeatures: 'aalt=1',
  },
  {
    name: 'Baskerville Serbian language feature',
    path: '/System/Library/Fonts/Supplemental/Baskerville.ttc',
    text: 'бгдпт',
    script: 'cyrl',
    language: 'sr',
    rightToLeft: false,
    fontIndex: 2,
  },
  {
    name: 'Skia non-default variation metrics',
    path: '/System/Library/Fonts/Supplemental/Skia.ttf',
    text: 'A',
    script: 'latn',
    language: 'en',
    rightToLeft: false,
    variations: { wght: 3, wdth: 1 },
  },
]

function shapeWithHarfBuzz(testCase: OracleCase): HarfBuzzGlyph[] {
  const args = [
    '--output-format=json',
    '--no-glyph-names',
    `--direction=${testCase.rightToLeft ? 'rtl' : 'ltr'}`,
    `--script=${testCase.script}`,
    `--language=${testCase.language}`,
  ]
  if (testCase.fontIndex !== undefined) args.push(`--face-index=${testCase.fontIndex}`)
  if (testCase.hbFeatures !== undefined) args.push(`--features=${testCase.hbFeatures}`)
  if (testCase.variations !== undefined) {
    args.push(`--variations=${Object.entries(testCase.variations).map(([tag, value]) => `${tag}=${value}`).join(',')}`)
  }
  args.push(testCase.path, testCase.text)
  return JSON.parse(execFileSync(hbShape, args, { encoding: 'utf8' })) as HarfBuzzGlyph[]
}

function shapeWithCore(testCase: OracleCase): Array<Omit<HarfBuzzGlyph, 'cl'>> {
  const font = Font.load(readFileSync(testCase.path).buffer as ArrayBuffer, { fontIndex: testCase.fontIndex })
  if (testCase.variations !== undefined) font.setVariation(testCase.variations)
  const shaped = font.shapeText(testCase.text, {
    script: testCase.script,
    language: testCase.language,
    direction: 'horizontal',
    aatFeatures: testCase.aatFeatures,
  }).map(glyph => ({
    g: glyph.glyphId,
    dx: glyph.xOffset,
    dy: glyph.yOffset,
    ax: glyph.xAdvance,
    ay: glyph.yAdvance,
  }))
  return testCase.rightToLeft ? shaped.reverse() : shaped
}

function clustersWithCore(testCase: OracleCase): number[] {
  const font = Font.load(readFileSync(testCase.path).buffer as ArrayBuffer, { fontIndex: testCase.fontIndex })
  if (testCase.variations !== undefined) font.setVariation(testCase.variations)
  const glyphs: number[] = []
  const clusters: number[] = []
  const breakClusters: number[] = []
  let stringIndex = 0
  for (const character of testCase.text) {
    glyphs.push(font.getGlyphId(character.codePointAt(0)!))
    clusters.push(stringIndex)
    stringIndex += character.length
  }
  let graphemeStart = 0
  for (const grapheme of graphemeClusters(testCase.text)) {
    for (const _character of grapheme) breakClusters.push(graphemeStart)
    graphemeStart += grapheme.length
  }
  const morx = (font as unknown as { tableManager: { morx: {
    applySubstitutionsTracked(
      run: { glyphs: number[], clusters: number[] },
      features?: unknown,
      rightToLeft?: boolean,
    ): { clusters: number[], breakClusters?: number[] }
  } | null } }).tableManager.morx
  if (morx === null) throw new Error('HarfBuzz AAT oracle requires a morx table')
  const tracked = morx.applySubstitutionsTracked(
    { glyphs, clusters, breakClusters },
    testCase.aatFeatures,
    testCase.rightToLeft,
  )
  const result = tracked.breakClusters ?? tracked.clusters
  return testCase.rightToLeft ? result.reverse() : result
}

describe.skipIf(!existsSync(hbShape))('AAT HarfBuzz oracle', () => {
  for (const testCase of cases) {
    it.runIf(existsSync(testCase.path))(testCase.name, () => {
      const oracle = shapeWithHarfBuzz(testCase)
      const expected = oracle.map(({ cl: _cluster, ...glyph }) => glyph)
      expect(shapeWithCore(testCase)).toEqual(expected)
      expect(clustersWithCore(testCase)).toEqual(oracle.map(glyph => glyph.cl))
    })
  }

  const appleGothic = '/System/Library/Fonts/Supplemental/AppleGothic.ttf'
  it.runIf(existsSync(appleGothic))('AppleGothic vertical glyphs, clusters, advances, and normalized origins', () => {
    const text = '「、。漢'
    const buffer = readFileSync(appleGothic)
    const font = Font.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
    const actual = font.shapeText(text, { direction: 'vertical', script: 'hani', language: 'ja' })
    const oracle = JSON.parse(execFileSync(hbShape, [
      '--output-format=json', '--no-glyph-names', '--direction=ttb', '--script=hani', '--language=ja',
      appleGothic, text,
    ], { encoding: 'utf8' })) as HarfBuzzGlyph[]

    expect(actual.map(glyph => glyph.glyphId)).toEqual(oracle.map(glyph => glyph.g))
    expect(oracle.map(glyph => glyph.cl)).toEqual([0, 1, 2, 3])
    expect(actual.map(glyph => glyph.yAdvance)).toEqual(oracle.map(glyph => -glyph.ay))
    expect(actual.map(glyph => glyph.xAdvance)).toEqual(oracle.map(glyph => glyph.ax))
    for (let i = 0; i < actual.length; i++) {
      expect(oracle[i]!.dx + font.metrics.unitsPerEm / 2).toBe(actual[i]!.xOffset)
      expect(oracle[i]!.dy + font.getVerticalOrigin(actual[i]!.glyphId)).toBe(actual[i]!.yOffset)
    }
  })
})
