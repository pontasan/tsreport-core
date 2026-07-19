import { describe, expect, it } from 'vitest'
import { compositePdfTransparencyObject, extractPdfTransparencyGroup } from '../../src/renderer/pdf-compositor.js'
import type { BlendMode } from '../../src/types/render.js'

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]

describe('PDF transparency compositor', () => {
  it('extracts a non-isolated group without painting its backdrop twice', () => {
    const backdrop = new Uint8ClampedArray([255, 255, 255, 255])
    const accumulated = backdrop.slice()
    const alpha = new Uint8ClampedArray(1)
    const groupShape = new Uint8ClampedArray(1)
    compositePdfTransparencyObject(
      accumulated, backdrop,
      new Uint8ClampedArray([255, 0, 0, 128]),
      alpha, groupShape, new Uint8ClampedArray([255]), false, 'normal',
    )
    expect(Array.from(accumulated)).toEqual([255, 127, 127, 255])
    extractPdfTransparencyGroup(accumulated, backdrop, alpha, false)
    expect(Array.from(accumulated)).toEqual([255, 0, 0, 128])
  })

  it('uses the initial backdrop and object shape for knockout children', () => {
    const backdrop = new Uint8ClampedArray([0, 0, 0, 0])
    const accumulated = backdrop.slice()
    const alpha = new Uint8ClampedArray(1)
    const groupShape = new Uint8ClampedArray(1)
    compositePdfTransparencyObject(accumulated, backdrop, new Uint8ClampedArray([255, 0, 0, 128]), alpha, groupShape, new Uint8ClampedArray([255]), true, 'normal')
    compositePdfTransparencyObject(accumulated, backdrop, new Uint8ClampedArray([0, 0, 255, 128]), alpha, groupShape, new Uint8ClampedArray([255]), true, 'normal')
    expect(Array.from(accumulated)).toEqual([0, 0, 255, 128])
    expect(alpha[0]).toBe(128)
  })

  it('implements every separable and nonseparable PDF blend mode', () => {
    for (let i = 0; i < BLEND_MODES.length; i++) {
      const backdrop = new Uint8ClampedArray([64, 160, 224, 255])
      const accumulated = backdrop.slice()
      const alpha = new Uint8ClampedArray(1)
      const groupShape = new Uint8ClampedArray(1)
      compositePdfTransparencyObject(
        accumulated, backdrop,
        new Uint8ClampedArray([224, 96, 32, 192]),
        alpha, groupShape, new Uint8ClampedArray([255]), false, BLEND_MODES[i]!,
      )
      expect(Array.from(accumulated).every(function (component) { return component >= 0 && component <= 255 }), BLEND_MODES[i]).toBe(true)
      expect(alpha[0], BLEND_MODES[i]).toBe(192)
    }
  })

  it('rejects mismatched buffer geometry', () => {
    expect(() => compositePdfTransparencyObject(
      new Uint8ClampedArray(4), new Uint8ClampedArray(8), new Uint8ClampedArray(4),
      new Uint8ClampedArray(1), new Uint8ClampedArray(1), new Uint8ClampedArray(1), false, 'normal',
    )).toThrow(/identical/)
    expect(() => extractPdfTransparencyGroup(
      new Uint8ClampedArray(4), new Uint8ClampedArray(4), new Uint8ClampedArray(2), false,
    )).toThrow(/incompatible/)
  })
})
