import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { applyAatJustification } from '../../src/layout/aat-justification.js'
import type {
  JustDirectionData,
  JustPostcompAction,
  JustWidthDeltaPair,
} from '../../src/parsers/tables/just.js'
import type { RenderGlyphRun } from '../../src/types/render.js'

const __dirname = new URL('.', import.meta.url).pathname
const FONT_SIZE = 10

let font: Font
let variableFont: Font
let aGlyph: number
let vGlyph: number
let hyphenGlyph: number

beforeAll(() => {
  font = Font.load(readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer)
  variableFont = Font.load(readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-VariableFont.ttf')).buffer as ArrayBuffer)
  aGlyph = font.getGlyphId(0x41)
  vGlyph = font.getGlyphId(0x56)
  hyphenGlyph = font.getGlyphId(0x2D)
})

function makeRun(activeFont: Font, glyphIds: number[]): RenderGlyphRun {
  const scale = FONT_SIZE / activeFont.metrics.unitsPerEm
  return {
    glyphIds: Uint16Array.from(glyphIds),
    advances: Float64Array.from(glyphIds, glyphId => activeFont.getAdvanceWidth(glyphId) * scale),
    xOffsets: new Float64Array(glyphIds.length),
    yOffsets: new Float64Array(glyphIds.length),
    clusters: Uint16Array.from(glyphIds, () => 1),
  }
}

function makePair(overrides: Partial<JustWidthDeltaPair> = {}): JustWidthDeltaPair {
  return {
    justClass: 0,
    beforeGrowLimit: 0,
    beforeShrinkLimit: 0,
    afterGrowLimit: 1,
    afterShrinkLimit: -1,
    growFlags: 0x1000,
    shrinkFlags: 0x1000,
    ...overrides,
  }
}

function makeDirection(
  pairs: Map<number, readonly JustWidthDeltaPair[]>,
  actions: Map<number, readonly JustPostcompAction[]> = new Map(),
  categories?: readonly number[],
): JustDirectionData {
  return {
    classTable: null,
    getCategories(glyphIds: readonly number[]): Uint8Array {
      if (categories === undefined) return new Uint8Array(glyphIds.length)
      return Uint8Array.from(categories.slice(0, glyphIds.length))
    },
    getWidthDeltaPairs(glyphId: number): readonly JustWidthDeltaPair[] | null {
      return pairs.get(glyphId) ?? null
    },
    getPostcompActions(glyphId: number): readonly JustPostcompAction[] | null {
      return actions.get(glyphId) ?? null
    },
  }
}

describe('AAT just execution', () => {
  it('processes finite limits by priority before an unlimited later priority', () => {
    const run = makeRun(font, [aGlyph, vGlyph])
    const original = Array.from(run.advances)
    const direction = makeDirection(new Map([
      [aGlyph, [makePair({ afterGrowLimit: 0.5, growFlags: 0 })]],
      [vGlyph, [makePair({ afterGrowLimit: 1, growFlags: 0x1001 })]],
    ]))

    const result = applyAatJustification(run, font, direction, 30, FONT_SIZE, 1)

    expect(run.advances[0]).toBeCloseTo(original[0]! + 5)
    expect(run.advances[1]).toBeCloseTo(original[1]! + 25)
    expect(result.remainingDelta).toBeCloseTo(0)
  })

  it('applies negative shrink limits and before-side placement', () => {
    const run = makeRun(font, [aGlyph])
    const originalAdvance = run.advances[0]!
    const direction = makeDirection(new Map([
      [aGlyph, [makePair({ beforeShrinkLimit: -0.4, afterShrinkLimit: -0.6 })]],
    ]))

    const result = applyAatJustification(run, font, direction, -8, FONT_SIZE, 1)

    expect(run.advances[0]).toBeCloseTo(originalAdvance - 8)
    expect(run.xOffsets[0]).toBeCloseTo(-3.2)
    expect(result.remainingDelta).toBeCloseTo(0)
  })

  it('runs decomposition actions in response to the assigned distance factor', () => {
    const run = makeRun(font, [aGlyph])
    const direction = makeDirection(
      new Map([[aGlyph, [makePair()]]]),
      new Map([[aGlyph, [{
        actionClass: 0, actionType: 0, lowerLimit: -1, upperLimit: 0.5,
        order: 1, glyphs: [vGlyph, hyphenGlyph],
      }]]]),
    )

    applyAatJustification(run, font, direction, 10, FONT_SIZE, 1)

    expect(Array.from(run.glyphIds)).toEqual([vGlyph, hyphenGlyph])
    expect(Array.from(run.clusters)).toEqual([1, 0])
  })

  it('executes unconditional and conditional add actions and recalculates the run', () => {
    const unconditionalRun = makeRun(font, [aGlyph])
    applyAatJustification(
      unconditionalRun,
      font,
      makeDirection(
        new Map([[aGlyph, [makePair()]]]),
        new Map([[aGlyph, [{ actionClass: 0, actionType: 1, addGlyph: hyphenGlyph }]]]),
      ),
      20,
      FONT_SIZE,
      1,
    )
    expect(Array.from(unconditionalRun.glyphIds)).toEqual([aGlyph, hyphenGlyph])

    const conditionalRun = makeRun(font, [aGlyph])
    applyAatJustification(
      conditionalRun,
      font,
      makeDirection(
        new Map([[aGlyph, [makePair()]]]),
        new Map([[aGlyph, [{
          actionClass: 0, actionType: 2, substThreshold: 0.5,
          addGlyph: 0xFFFF, substGlyph: vGlyph,
        }]]]),
      ),
      10,
      FONT_SIZE,
      1,
    )
    expect(Array.from(conditionalRun.glyphIds)).toEqual([vGlyph])
  })

  it('replicates repeated-add glyphs to consume the assigned gap', () => {
    const run = makeRun(font, [aGlyph])
    const addedAdvance = font.getAdvanceWidth(hyphenGlyph) * FONT_SIZE / font.metrics.unitsPerEm
    applyAatJustification(
      run,
      font,
      makeDirection(
        new Map([[aGlyph, [makePair()]]]),
        new Map([[aGlyph, [{ actionClass: 0, actionType: 5, flags: 0, glyph: hyphenGlyph }]]]),
      ),
      addedAdvance * 3.2,
      FONT_SIZE,
      1,
    )

    expect(Array.from(run.glyphIds)).toEqual([aGlyph, hyphenGlyph, hyphenGlyph, hyphenGlyph, hyphenGlyph])
    expect(run.advances.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      font.getAdvanceWidth(aGlyph) * FONT_SIZE / font.metrics.unitsPerEm + addedAdvance * 3.2,
    )
  })

  it('records per-glyph scaling for stretch actions', () => {
    const run = makeRun(font, [aGlyph])
    const originalAdvance = run.advances[0]!
    applyAatJustification(
      run,
      font,
      makeDirection(
        new Map([[aGlyph, [makePair()]]]),
        new Map([[aGlyph, [{ actionClass: 0, actionType: 3 }]]]),
      ),
      5,
      FONT_SIZE,
      1,
    )

    expect(run.xScales?.[0]).toBeCloseTo((originalAdvance + 5) / originalAdvance)
    expect(run.xOffsets[0]).toBe(0)
  })

  it('records vertical outline scaling for vertical stretch actions', () => {
    const run = makeRun(font, [aGlyph])
    run.advances[0] = font.getAdvanceHeight(aGlyph) * FONT_SIZE / font.metrics.unitsPerEm
    const originalAdvance = run.advances[0]!
    applyAatJustification(
      run,
      font,
      makeDirection(
        new Map([[aGlyph, [makePair()]]]),
        new Map([[aGlyph, [{ actionClass: 0, actionType: 3 }]]]),
      ),
      5,
      FONT_SIZE,
      1,
      true,
    )

    expect(run.yScales?.[0]).toBeCloseTo((originalAdvance + 5) / originalAdvance)
    expect(run.xScales).toBeUndefined()
  })

  it('captures a ductile-axis outline and restores the active font instance', () => {
    const glyphId = variableFont.getGlyphId(0x41)
    const run = makeRun(variableFont, [glyphId])
    variableFont.setVariation({ wght: 700 })
    const previousCoordinates = { ...variableFont.variationCoordinates }
    const direction = makeDirection(
      new Map([[glyphId, [makePair()]]]),
      new Map([[glyphId, [{
        actionClass: 0,
        actionType: 4,
        variationAxis: 'wght',
        minimumLimit: 100,
        noStretchValue: 400,
        maximumLimit: 900,
      }]]]),
    )

    applyAatJustification(run, variableFont, direction, 5, FONT_SIZE, 1)

    expect(run.outlineOverrides?.[0]).not.toBeNull()
    expect(variableFont.variationCoordinates).toEqual(previousCoordinates)
  })
})
