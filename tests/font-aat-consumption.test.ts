import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, type BslnTable, type GdefTable, type LcarTable, type OpbdTable } from '../src/index.js'

const ROBOTO_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')

function loadRoboto(): Font {
  const bytes = readFileSync(ROBOTO_PATH)
  return Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

function setParsedFontTable(font: Font, tag: 'bsln' | 'gdef' | 'lcar' | 'opbd', value: unknown): void {
  Object.defineProperty((font as unknown as { tableManager: object }).tableManager, tag, {
    value,
    configurable: true,
  })
}

function makeControlPointOpbdTable(glyphId: number, values: { left: number, top: number, right: number, bottom: number }): OpbdTable {
  return {
    version: 1,
    format: 1,
    getOpticalBounds(requestedGlyphId: number) {
      return requestedGlyphId === glyphId ? values : null
    },
  }
}

function makeLcarTable(format: number, glyphId: number, values: readonly number[]): LcarTable {
  return {
    version: 1,
    format,
    getCaretValues(requestedGlyphId: number): readonly number[] | null {
      return requestedGlyphId === glyphId ? values : null
    },
  }
}

function makeDistanceBslnTable(glyphId: number, baselineClass: number, coordinate: number): BslnTable {
  const deltas = new Int16Array(32)
  deltas[baselineClass] = coordinate
  return {
    version: 1,
    format: 1,
    defaultBaseline: 0,
    deltas,
    stdGlyph: null,
    ctlPoints: null,
    getBaselineClass(requestedGlyphId: number): number {
      return requestedGlyphId === glyphId ? baselineClass : 0
    },
  }
}

function makeControlPointBslnTable(glyphId: number, baselineClass: number, stdGlyph: number, pointIndex: number): BslnTable {
  const ctlPoints = new Uint16Array(32)
  ctlPoints.fill(0xFFFF)
  ctlPoints[baselineClass] = pointIndex
  return {
    version: 1,
    format: 3,
    defaultBaseline: 0,
    deltas: null,
    stdGlyph,
    ctlPoints,
    getBaselineClass(requestedGlyphId: number): number {
      return requestedGlyphId === glyphId ? baselineClass : 0
    },
  }
}

describe('AAT table consumption on Font', () => {
  it('resolves GDEF attachment indices to current outline coordinates', () => {
    const font = loadRoboto()
    const glyphId = font.getGlyphId('A'.codePointAt(0)!)
    const gdef: GdefTable = {
      majorVersion: 1,
      minorVersion: 0,
      getGlyphClass: () => 0,
      getMarkAttachClass: () => 0,
      isMarkInSet: () => false,
      getAttachmentPointIndices: requestedGlyphId => requestedGlyphId === glyphId ? [0, 2] : [],
      getLigatureCaretValues: () => null,
      getVarDelta: () => 0,
    }
    setParsedFontTable(font, 'gdef', gdef)

    expect(font.getGdefAttachmentPoints(glyphId)).toEqual([
      { pointIndex: 0, ...font.getGlyphControlPoint(glyphId, 0) },
      { pointIndex: 2, ...font.getGlyphControlPoint(glyphId, 2) },
    ])
  })

  it('resolves lcar format 0 caret distances', () => {
    const font = loadRoboto()
    const glyphId = font.getGlyphId('A'.codePointAt(0)!)
    setParsedFontTable(font, 'lcar', makeLcarTable(0, glyphId, [250, 500]))

    expect(font.lcar).not.toBeNull()
    expect(font.getLigatureCaretPositions(glyphId)).toEqual([250, 500])
    expect(font.getLigatureCaretPositions(glyphId + 1)).toBeNull()
  })

  it('resolves lcar format 1 caret control points to x coordinates', () => {
    const font = loadRoboto()
    const glyphId = font.getGlyphId('A'.codePointAt(0)!)
    const point = font.getGlyphControlPoint(glyphId, 0)
    setParsedFontTable(font, 'lcar', makeLcarTable(1, glyphId, [0]))

    expect(font.getLigatureCaretPositions(glyphId)).toEqual([point.x])
    expect(font.getLigatureCaretPositions(glyphId, 'vertical')).toEqual([
      font.getVerticalOrigin(glyphId) - point.y,
    ])
  })

  it('resolves bsln distance baseline classes to coordinates', () => {
    const font = loadRoboto()
    const glyphId = font.getGlyphId('A'.codePointAt(0)!)
    setParsedFontTable(font, 'bsln', makeDistanceBslnTable(glyphId, 3, 720))

    expect(font.bsln).not.toBeNull()
    expect(font.getAatBaselineClass(glyphId)).toBe(3)
    expect(font.getAatBaselineClass(glyphId + 1)).toBe(0)
    expect(font.getAatBaselineCoordinate(glyphId)).toBe(720)
    expect(font.getAatBaselinePosition(3)).toBe(720)
    expect(() => font.getAatBaselinePosition(32)).toThrow(/0\.\.31/)
  })

  it('resolves bsln control-point baselines through the standard glyph y coordinate', () => {
    const font = loadRoboto()
    const glyphId = font.getGlyphId('A'.codePointAt(0)!)
    const point = font.getGlyphControlPoint(glyphId, 0)
    setParsedFontTable(font, 'bsln', makeControlPointBslnTable(glyphId, 4, glyphId, 0))

    expect(font.getAatBaselineClass(glyphId)).toBe(4)
    expect(font.getAatBaselineCoordinate(glyphId)).toBe(point.y)
  })

  it('applies bsln baseline classes to horizontal and vertical shaping offsets', () => {
    const font = loadRoboto()
    const aGlyph = font.getGlyphId(0x41)
    setParsedFontTable(font, 'bsln', makeDistanceBslnTable(aGlyph, 3, 720))

    const horizontal = font.shapeText('AV')
    expect(horizontal[0]!.yOffset).toBe(0)
    expect(horizontal[1]!.yOffset).toBe(720)

    const vertical = font.shapeText('AV', { direction: 'vertical' })
    expect(vertical[0]!.xOffset).toBe(0)
    expect(vertical[1]!.xOffset).toBe(720)
  })

  it('resolves opbd format 1 control points into edge movement deltas', () => {
    const font = loadRoboto()
    const glyphId = font.getGlyphId(0x41)
    const point = font.getGlyphControlPoint(glyphId, 0)
    setParsedFontTable(font, 'opbd', makeControlPointOpbdTable(glyphId, {
      left: 0,
      top: 0,
      right: 0,
      bottom: -1,
    }))

    expect(font.getOpticalBounds(glyphId)).toEqual({
      left: -point.x,
      top: font.getVerticalOrigin(glyphId) - point.y,
      right: font.getAdvanceWidth(glyphId) - point.x,
      bottom: 0,
    })
  })
})
