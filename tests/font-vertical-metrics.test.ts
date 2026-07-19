import { describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'
import { buildTable, buildTestFont, encodeSimpleGlyph } from './renderer/synthetic-font.js'

const SQUARE: [number, number][] = [[100, 100], [300, 100], [300, 300], [100, 300]]

function vhea(): Uint8Array {
  return buildTable(function build(w) {
    w.writeUint16(1); w.writeUint16(0)
    w.writeInt16(500); w.writeInt16(-500); w.writeInt16(0)
    w.writeUint16(1000)
    w.writeInt16(50); w.writeInt16(50); w.writeInt16(900)
    w.writeInt16(0); w.writeInt16(1); w.writeInt16(0)
    for (let i = 0; i < 4; i++) w.writeInt16(0)
    w.writeInt16(0); w.writeUint16(2)
  })
}

function vmtx(): Uint8Array {
  return buildTable(function build(w) {
    w.writeUint16(1000); w.writeInt16(0)
    w.writeUint16(1000); w.writeInt16(50)
  })
}

function loadVerticalFont(): Font {
  const tables: [string, Uint8Array][] = [['vhea', vhea()], ['vmtx', vmtx()]]
  return Font.load(buildTestFont(
    [null, encodeSimpleGlyph(SQUARE, [3])],
    [[0x41, 1]],
    tables,
  ))
}

function installVvar(font: Font): void {
  const manager = (font as unknown as { tableManager: object }).tableManager
  Object.defineProperty(manager, 'normalizedCoords', { value: [1], configurable: true })
  Object.defineProperty(manager, 'vvar', {
    value: {
      hasTsbMapping: true,
      hasBsbMapping: true,
      hasVOrgMapping: true,
      getAdvanceHeightDelta(): number { return 100 },
      getTsbDelta(): number { return 20 },
      getBsbDelta(): number { return 30 },
      getVOrgDelta(): number { return 40 },
    },
    configurable: true,
  })
}

describe('connected vertical metrics', () => {
  it('derives vertical advance and bearings from TrueType gvar phantom points when VVAR is absent', () => {
    const font = loadVerticalFont()
    const manager = (font as unknown as { tableManager: object }).tableManager
    Object.defineProperty(manager, 'normalizedCoords', { value: [1], configurable: true })
    Object.defineProperty(manager, 'vvar', { value: null, configurable: true })
    Object.defineProperty(manager, 'gvar', {
      value: {
        getGlyphDeltas(_glyphId: number, _coords: number[], pointCount: number) {
          const deltaX = new Array<number>(pointCount).fill(0)
          const deltaY = new Array<number>(pointCount).fill(0)
          deltaY[pointCount - 2] = 40
          deltaY[pointCount - 1] = -60
          return { deltaX, deltaY }
        },
      },
      configurable: true,
    })

    expect(font.getAdvanceHeight(1)).toBe(1100)
    expect(font.getTopSideBearing(1)).toBe(90)
    expect(font.getBottomSideBearing(1)).toBe(810)
    expect(font.getVerticalOrigin(1)).toBe(390)
  })

  it('applies every VVAR mapping to vmtx-derived metrics and origin', () => {
    const font = loadVerticalFont()
    installVvar(font)
    expect(font.getAdvanceHeight(1)).toBe(1100)
    expect(font.getTopSideBearing(1)).toBe(70)
    // Synthetic glyph header bbox is zero-height: base BSB = 1000 - 50.
    expect(font.getBottomSideBearing(1)).toBe(980)
    expect(font.getVerticalOrigin(1)).toBe(370)
  })

  it('ignores VORG and its VVAR origin mapping for TrueType outlines', () => {
    const font = loadVerticalFont()
    installVvar(font)
    const manager = (font as unknown as { tableManager: object }).tableManager
    Object.defineProperty(manager, 'vorg', {
      value: { getVertOriginY(): number { return 850 } },
      configurable: true,
    })
    expect(font.getVerticalOrigin(1)).toBe(370)
  })

  it('applies the VVAR vertical-origin mapping to CFF2 VORG values', () => {
    const font = loadVerticalFont()
    installVvar(font)
    const manager = (font as unknown as { tableManager: object }).tableManager
    Object.defineProperty(manager, 'cff2', { value: {}, configurable: true })
    Object.defineProperty(manager, 'vorg', {
      value: { getVertOriginY(): number { return 850 } },
      configurable: true,
    })
    expect(font.getVerticalOrigin(1)).toBe(890)
  })
})
