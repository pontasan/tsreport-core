import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'
import { shapeGlyphRun } from '../src/measure/glyph-run.js'
import { applyAatJustification } from '../src/layout/aat-justification.js'
import { TextMeasurer } from '../src/measure/text-measurer.js'
import { layoutText } from '../src/layout/text-layout.js'
import { PathCommand } from '../src/types/glyph.js'

interface CoreTextGlyph {
  g: number
  cl: number
  x: number
  y: number
  ax: number
  ay: number
}

interface OracleCase {
  name: string
  path: string
  text: string
  fontIndex: number
  rightToLeft: boolean
  script: string
  language: string
}

const swift = '/usr/bin/swift'
const helper = resolve(import.meta.dirname, 'helpers/coretext-shape.swift')
const metricsHelper = resolve(import.meta.dirname, 'helpers/coretext-font-metrics.swift')
const glyphPathHelper = resolve(import.meta.dirname, 'helpers/coretext-glyph-path.swift')
const baskerville = '/System/Library/Fonts/Supplemental/Baskerville.ttc'
const appleChancery = '/System/Library/Fonts/Supplemental/Apple Chancery.ttf'
const skia = '/System/Library/Fonts/Supplemental/Skia.ttf'
const stHeiti = '/System/Library/Fonts/STHeiti Medium.ttc'
const cases: OracleCase[] = [
  {
    name: 'Tamil insertion and rearrangement',
    path: '/System/Library/Fonts/Supplemental/Tamil MN.ttc',
    text: 'கொ',
    fontIndex: 0,
    rightToLeft: false,
    script: 'taml',
    language: 'ta',
  },
  {
    name: 'Thonburi Thai ligature',
    path: '/System/Library/Fonts/Supplemental/Thonburi.ttc',
    text: 'กำ',
    fontIndex: 0,
    rightToLeft: false,
    script: 'thai',
    language: 'th',
  },
  {
    name: 'Zapfino Latin ligatures',
    path: '/System/Library/Fonts/Supplemental/Zapfino.ttf',
    text: 'ffi fflaffe',
    fontIndex: 0,
    rightToLeft: false,
    script: 'latn',
    language: 'en',
  },
  {
    name: 'Diwan Arabic contextual shaping',
    path: '/System/Library/Fonts/Supplemental/Diwan Thuluth.ttf',
    text: 'ثلث',
    fontIndex: 0,
    rightToLeft: true,
    script: 'arab',
    language: 'ar',
  },
  {
    name: 'Mishafi contextual mark positioning',
    path: '/System/Library/Fonts/Supplemental/Mishafi.ttf',
    text: 'بِسْمِ',
    fontIndex: 0,
    rightToLeft: true,
    script: 'arab',
    language: 'ar',
  },
  {
    name: 'Farisi cross-stream positioning',
    path: '/System/Library/Fonts/Supplemental/Farisi.ttf',
    text: 'سلام',
    fontIndex: 0,
    rightToLeft: true,
    script: 'arab',
    language: 'fa',
  },
]

function coreTextGlyphs(testCase: OracleCase): CoreTextGlyph[] {
  return JSON.parse(execFileSync(swift, [helper, testCase.path, String(testCase.fontIndex), testCase.text], {
    encoding: 'utf8',
  })) as CoreTextGlyph[]
}

function coreTextLanguageGlyphs(path: string, fontIndex: number, text: string, language: string): CoreTextGlyph[] {
  return JSON.parse(execFileSync(swift, [helper, path, String(fontIndex), text, `--language=${language}`], {
    encoding: 'utf8',
  })) as CoreTextGlyph[]
}

function coreTextJustifiedGlyphs(path: string, text: string, targetWidth: number): CoreTextGlyph[] {
  return JSON.parse(execFileSync(swift, [helper, path, '0', text, String(targetWidth)], {
    encoding: 'utf8',
  })) as CoreTextGlyph[]
}

function coreTextVariationGlyphs(path: string, text: string, variations: Readonly<Record<string, number>>): CoreTextGlyph[] {
  const args = [helper, path, '0', text]
  for (const [tag, value] of Object.entries(variations)) args.push(`--variation=${tag}:${value}`)
  return JSON.parse(execFileSync(swift, args, { encoding: 'utf8' })) as CoreTextGlyph[]
}

interface CoreTextPath {
  commands: number[]
  coords: number[]
  advance: number
}

function coreTextVariationPath(path: string, glyphId: number, variations: Readonly<Record<string, number>>): CoreTextPath {
  const args = [glyphPathHelper, path, '0', String(glyphId)]
  for (const [tag, value] of Object.entries(variations)) args.push(`--variation=${tag}:${value}`)
  return JSON.parse(execFileSync(swift, args, { encoding: 'utf8' })) as CoreTextPath
}

function removeRedundantClosingLines(commands: Uint8Array, coords: Float32Array): CoreTextPath {
  const resultCommands: number[] = []
  const resultCoords: number[] = []
  let coordinateIndex = 0
  let contourStartX = 0
  let contourStartY = 0
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i]!
    const coordinateCount = command === PathCommand.CubicTo ? 6 : command === PathCommand.Close ? 0 : 2
    if (command === PathCommand.MoveTo) {
      contourStartX = coords[coordinateIndex]!
      contourStartY = coords[coordinateIndex + 1]!
    }
    const closesContour = command === PathCommand.LineTo
      && commands[i + 1] === PathCommand.Close
      && coords[coordinateIndex] === contourStartX
      && coords[coordinateIndex + 1] === contourStartY
    if (!closesContour) {
      resultCommands.push(command)
      for (let j = 0; j < coordinateCount; j++) resultCoords.push(coords[coordinateIndex + j]!)
    }
    coordinateIndex += coordinateCount
  }
  return { commands: resultCommands, coords: resultCoords, advance: 0 }
}

function aatClusters(font: Font, testCase: OracleCase): number[] {
  const glyphs: number[] = []
  const clusters: number[] = []
  let stringIndex = 0
  for (const character of testCase.text) {
    glyphs.push(font.getGlyphId(character.codePointAt(0)!))
    clusters.push(stringIndex)
    stringIndex += character.length
  }
  const morx = (font as unknown as { tableManager: { morx: {
    applySubstitutionsTracked(
      run: { glyphs: number[], clusters: number[] },
      features?: unknown,
      rightToLeft?: boolean,
    ): { clusters: number[] }
  } | null } }).tableManager.morx
  if (morx === null) throw new Error('CoreText AAT oracle requires a morx table')
  const result = morx.applySubstitutionsTracked({ glyphs, clusters }, undefined, testCase.rightToLeft).clusters
  return testCase.rightToLeft ? result.reverse() : result
}

describe.skipIf(!existsSync(swift))('AAT CoreText oracle', () => {
  it.runIf(existsSync(stHeiti))('matches vertical AAT substitution and advances', () => {
    const text = '「、。漢」'
    const font = Font.load(readFileSync(stHeiti).buffer as ArrayBuffer, { fontIndex: 0 })
    const actual = font.shapeText(text, { direction: 'vertical', script: 'hani', language: 'zh' })
    const expected = JSON.parse(execFileSync(swift, [helper, stHeiti, '0', text, '--vertical'], {
      encoding: 'utf8',
    })) as CoreTextGlyph[]
    expect(actual.map(glyph => glyph.glyphId)).toEqual(expected.map(glyph => glyph.g))
    expect(expected.map(glyph => glyph.cl)).toEqual([0, 1, 2, 3, 4])
    expect(actual.map(glyph => glyph.yAdvance)).toEqual(expected.map(glyph => glyph.ax))
    let pen = 0
    for (let i = 0; i < actual.length; i++) {
      expect(expected[i]!.x + font.metrics.unitsPerEm / 2).toBe(actual[i]!.xOffset)
      expect(expected[i]!.y + pen + font.getVerticalOrigin(actual[i]!.glyphId)).toBe(actual[i]!.yOffset)
      pen += actual[i]!.yAdvance
    }
  })

  it.runIf(existsSync(skia))('matches an explicitly selected AAT feat setting', () => {
    const text = 'rtt'
    const font = Font.load(readFileSync(skia).buffer as ArrayBuffer)
    font.setVariation({ wght: 1, wdth: 1 })
    const shaped = font.shapeText(text, {
      aatFeatures: [{ featureType: 17, featureSetting: 1 }],
    })
    const expected = JSON.parse(execFileSync(swift, [
      helper, skia, '0', text,
      '--variation=wght:1', '--variation=wdth:1', '--aat=17:1',
    ], { encoding: 'utf8' })) as CoreTextGlyph[]
    let pen = 0
    const actual = shaped.map((glyph, cluster) => {
      const value = { g: glyph.glyphId, cl: cluster, x: pen + glyph.xOffset, y: glyph.yOffset }
      pen += glyph.xAdvance
      return value
    })
    expect(actual).toEqual(expected.map(glyph => ({ g: glyph.g, cl: glyph.cl, x: glyph.x, y: glyph.y })))
    expect(pen).toBe(expected.reduce((sum, glyph) => sum + glyph.ax, 0))
  })

  it.runIf(existsSync(skia))('matches Skia AAT and OpenType variation metrics, outlines, and positioning', () => {
    const font = Font.load(readFileSync(skia).buffer as ArrayBuffer)
    const text = 'AVATAR'
    const instances = [
      { wght: 0.4799957275390625, wdth: 0.6199798583984375 },
      { wght: 1, wdth: 1 },
      { wght: 3, wdth: 1 },
      { wght: 1, wdth: 1.2 },
    ]
    for (const instance of instances) {
      font.setVariation(instance)
      const shaped = font.shapeText(text, { script: 'latn', language: 'en' })
      let actualPen = 0
      const actual = shaped.map(glyph => {
        const positioned = { g: glyph.glyphId, x: actualPen + glyph.xOffset, y: glyph.yOffset }
        actualPen += glyph.xAdvance
        return positioned
      })
      const expected = coreTextVariationGlyphs(skia, text, instance)
      expect(actual.map(glyph => glyph.g)).toEqual(expected.map(glyph => glyph.g))
      expect(expected.map(glyph => glyph.cl)).toEqual([0, 1, 2, 3, 4, 5])
      for (let i = 0; i < actual.length; i++) {
        expect(actual[i]!.x).toBe(expected[i]!.x)
        expect(actual[i]!.y).toBe(expected[i]!.y)
      }
      expect(actualPen).toBe(expected.reduce((sum, glyph) => sum + glyph.ax, 0))
    }

    const outlineInstance = { wght: 3, wdth: 1 }
    font.setVariation(outlineInstance)
    const glyphId = font.getGlyphId(0x41)
    const glyph = font.getGlyph(glyphId)
    const actualPath = removeRedundantClosingLines(glyph.outline.commands, glyph.outline.coords)
    const expectedPath = coreTextVariationPath(skia, glyphId, outlineInstance)
    expect(actualPath.commands).toEqual(expectedPath.commands)
    expect(actualPath.coords).toHaveLength(expectedPath.coords.length)
    for (let i = 0; i < actualPath.coords.length; i++) {
      expect(actualPath.coords[i]).toBeCloseTo(expectedPath.coords[i]!, 1)
    }
    expect(font.getAdvanceWidth(glyphId)).toBe(expectedPath.advance)
  }, 15000)

  it.runIf(existsSync(appleChancery))('applies fmtx point metrics, matching CoreText', () => {
    const font = Font.load(readFileSync(appleChancery).buffer as ArrayBuffer)
    const coreText = JSON.parse(execFileSync(swift, [metricsHelper, appleChancery, '0'], {
      encoding: 'utf8',
    })) as { unitsPerEm: number, ascent: number, descent: number, leading: number }

    expect(font.metrics.unitsPerEm).toBe(coreText.unitsPerEm)
    expect(font.metrics.ascender).toBe(coreText.ascent)
    expect(font.metrics.descender).toBe(-coreText.descent)
    expect(font.metrics.lineGap).toBe(coreText.leading)
  })

  it.runIf(existsSync(baskerville))('selects feat type 39 from ltag language, matching CoreText', () => {
    const text = 'бгдпт'
    const fontIndex = 2
    const font = Font.load(readFileSync(baskerville).buffer as ArrayBuffer, { fontIndex })
    const shaped = font.shapeText(text, { script: 'cyrl', language: 'sr', direction: 'horizontal' })
    const coreText = coreTextLanguageGlyphs(baskerville, fontIndex, text, 'sr')

    expect(shaped.map(glyph => ({ g: glyph.glyphId, ax: glyph.xAdvance, ay: glyph.yAdvance })))
      .toEqual(coreText.map(glyph => ({ g: glyph.g, ax: glyph.ax, ay: glyph.ay })))
    let pen = 0
    expect(shaped.map((glyph, cluster) => {
      const positioned = { cl: cluster, x: pen + glyph.xOffset, y: glyph.yOffset }
      pen += glyph.xAdvance
      return positioned
    })).toEqual(coreText.map(glyph => ({ cl: glyph.cl, x: glyph.x, y: glyph.y })))
    expect(font.ltag?.tags).toEqual(['sr'])
    expect(font.getAatFeatureDescriptions().find(feature => feature.featureType === 39)).toMatchObject({
      exclusive: true,
      defaultSelector: 0,
      settings: [{ selector: 0, languageTag: null }, { selector: 1, languageTag: 'sr' }],
    })
  })

  for (const testCase of cases) {
    it.runIf(existsSync(testCase.path))(testCase.name, () => {
      const font = Font.load(readFileSync(testCase.path).buffer as ArrayBuffer, { fontIndex: testCase.fontIndex })
      const shaped = font.shapeText(testCase.text, {
        direction: 'horizontal',
        script: testCase.script,
        language: testCase.language,
      })
      if (testCase.rightToLeft) shaped.reverse()
      let actualPen = 0
      const actual = shaped.map(glyph => {
        const value = { g: glyph.glyphId, x: actualPen + glyph.xOffset, y: glyph.yOffset }
        actualPen += glyph.xAdvance
        return value
      })
      const coreText = coreTextGlyphs(testCase)
      const expected = coreText.map(glyph => ({ g: glyph.g, x: glyph.x, y: glyph.y }))
      expect({ glyphs: actual, advance: actualPen }).toEqual({
        glyphs: expected,
        advance: coreText.reduce((sum, glyph) => sum + glyph.ax, 0),
      })
      expect(aatClusters(font, testCase)).toEqual(coreText.map(glyph => glyph.cl))
    })
  }

  it.runIf(existsSync('/System/Library/Fonts/Geneva.ttf'))('Geneva just width and glyph positions', () => {
    const path = '/System/Library/Fonts/Geneva.ttf'
    const text = 'A A'
    const font = Font.load(readFileSync(path).buffer as ArrayBuffer)
    const direction = font.just?.horizontal
    if (direction === null || direction === undefined) throw new Error('Geneva justification oracle requires a horizontal just table')
    const fontSize = font.metrics.unitsPerEm
    for (const targetWidth of [3000, 5000]) {
      const run = shapeGlyphRun(font, text, fontSize, 0, 0, false)
      let width = 0
      for (let i = 0; i < run.advances.length; i++) width += run.advances[i]!
      applyAatJustification(run, font, direction, targetWidth - width, fontSize, 1)

      let pen = 0
      const actual = new Array<{ g: number, x: number, ax: number }>(run.glyphIds.length)
      for (let i = 0; i < run.glyphIds.length; i++) {
        actual[i] = { g: run.glyphIds[i]!, x: pen + run.xOffsets[i]!, ax: run.advances[i]! }
        pen += run.advances[i]!
      }
      const expected = coreTextJustifiedGlyphs(path, text, targetWidth).map(glyph => ({
        g: glyph.g, x: glyph.x, ax: glyph.ax,
      }))
      expect(actual.map(glyph => glyph.g)).toEqual(expected.map(glyph => glyph.g))
      for (let i = 0; i < actual.length; i++) {
        expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 9)
        expect(actual[i]!.ax).toBeCloseTo(expected[i]!.ax, 9)
      }
    }
  })

  it.runIf(existsSync('/System/Library/Fonts/GeezaPro.ttc'))('Geeza repeated-add justification in RTL visual order', () => {
    const path = '/System/Library/Fonts/GeezaPro.ttc'
    const text = 'سلام'
    const font = Font.load(readFileSync(path).buffer as ArrayBuffer)
    const fontSize = font.metrics.unitsPerEm
    const direction = font.just?.horizontal
    if (direction === null || direction === undefined) throw new Error('Geeza justification oracle requires a horizontal just table')
    let hasRepeatedAdd = false
    for (let glyphId = 0; glyphId < font.numGlyphs && !hasRepeatedAdd; glyphId++) {
      const actions = direction.getPostcompActions(glyphId)
      if (actions !== null) hasRepeatedAdd = actions.some(action => action.actionType === 5)
    }
    expect(hasRepeatedAdd).toBe(true)
    for (const targetWidth of [5000, 8000]) {
      const layout = layoutText(`${text}\nx`, new TextMeasurer(font), fontSize, {
        maxWidth: targetWidth,
        hAlign: 'justify',
        direction: 'rtl',
        stretchWithOverflow: true,
      })
      const run = layout.lines[0]!.run!
      let pen = 0
      const actual = new Array<{ g: number, x: number, ax: number }>(run.glyphIds.length)
      for (let i = 0; i < run.glyphIds.length; i++) {
        actual[i] = { g: run.glyphIds[i]!, x: pen + run.xOffsets[i]!, ax: run.advances[i]! }
        pen += run.advances[i]!
      }
      const expected = coreTextJustifiedGlyphs(path, text, targetWidth).map(glyph => ({
        g: glyph.g, x: glyph.x, ax: glyph.ax,
      }))
      expect(actual.map(glyph => glyph.g)).toEqual(expected.map(glyph => glyph.g))
      for (let i = 0; i < actual.length; i++) {
        expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 9)
        expect(actual[i]!.ax).toBeCloseTo(expected[i]!.ax, 9)
      }
    }
  })
})
