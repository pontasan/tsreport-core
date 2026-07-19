import { describe, expect, it } from 'vitest'
import type { TrueTypeHintingState } from '../../src/hinting/tt-glyph-hinter.js'
import { rasterizeTrueTypeHintingState, usesTrueTypeDropoutControl } from '../../src/hinting/tt-rasterizer.js'

function narrowRectangle(scanType: number): TrueTypeHintingState {
  return {
    x: [70, 90, 90, 70],
    y: [0, 0, 192, 192],
    onCurve: [true, true, true, true],
    contourEnds: [3],
    phantomX: [0, 0, 0, 0],
    phantomY: [0, 0, 0, 0],
    advance: 0,
    scanControl: 0x01FF,
    scanType,
    instructed: true,
  }
}

function expandedNarrowRectangle(scanType: number): TrueTypeHintingState {
  const state = narrowRectangle(scanType)
  return {
    ...state,
    x: [...state.x, -64, 192, 192, -64],
    y: [...state.y, 640, 640, 704, 704],
    onCurve: [...state.onCurve, true, true, true, true],
    contourEnds: [3, 7],
  }
}

function pixelAt(bitmap: ReturnType<typeof rasterizeTrueTypeHintingState>, x: number, y: number): number {
  const column = x - bitmap.xMin
  const row = y - bitmap.yMin
  if (column < 0 || column >= bitmap.width || row < 0 || row >= bitmap.height) return 0
  return bitmap.pixels[row * bitmap.width + column]!
}

describe('TrueType monochrome scan conversion', function () {
  it('evaluates every SCANCTRL enable and blocking condition', function () {
    expect(usesTrueTypeDropoutControl(0x01FF, 200)).toBe(true)
    expect(usesTrueTypeDropoutControl(0x0108, 8)).toBe(true)
    expect(usesTrueTypeDropoutControl(0x0108, 9)).toBe(false)
    expect(usesTrueTypeDropoutControl(0x0200, 20, { rotated: true })).toBe(true)
    expect(usesTrueTypeDropoutControl(0x0400, 20, { stretched: true })).toBe(true)
    expect(usesTrueTypeDropoutControl(0x0A08, 9, { rotated: true })).toBe(false)
    expect(usesTrueTypeDropoutControl(0x0A08, 8, { rotated: true })).toBe(true)
  })

  it('turns on a subpixel-width vertical stroke in simple dropout mode', function () {
    const fast = rasterizeTrueTypeHintingState(narrowRectangle(2), 16)
    const simple = rasterizeTrueTypeHintingState(narrowRectangle(0), 16)
    expect(fast.pixels.reduce(function sum(total, value) { return total + value }, 0)).toBe(0)
    expect(simple.pixels.reduce(function sum(total, value) { return total + value }, 0)).toBe(3)
    for (let y = 0; y < 3; y++) expect(pixelAt(simple, 1, y)).toBe(1)
  })

  it('distinguishes simple left-most and smart midpoint pixel selection', function () {
    const simple = rasterizeTrueTypeHintingState(expandedNarrowRectangle(0), 16)
    const smart = rasterizeTrueTypeHintingState(expandedNarrowRectangle(4), 16)
    expect(pixelAt(simple, 0, 1)).toBe(1)
    expect(pixelAt(smart, 1, 1)).toBe(1)
  })
})
