import { describe, expect, it } from 'vitest'
import { isPrintColor, toDisplayColor } from '../../src/renderer/color.js'

describe('rendering performance invariants', () => {
  it('does not enter regular-expression parsing for ordinary display colors', () => {
    const originalTest = RegExp.prototype.test
    let regularExpressionCalls = 0
    let resultsPreserved = true
    RegExp.prototype.test = function (value: string): boolean {
      regularExpressionCalls++
      return originalTest.call(this, value)
    }
    try {
      const colors = ['#123456', '#fff', 'rgb(1,2,3)', 'transparent', 'darkred', 'silver']
      for (let repeat = 0; repeat < 100; repeat++) {
        for (let i = 0; i < colors.length; i++) {
          resultsPreserved = resultsPreserved
            && isPrintColor(colors[i]!) === false
            && toDisplayColor(colors[i]!) === colors[i]
        }
      }
    } finally {
      RegExp.prototype.test = originalTest
    }
    expect(resultsPreserved).toBe(true)
    expect(regularExpressionCalls).toBe(0)
  })

  it('retains strict parsing for native print-color candidates', () => {
    expect(isPrintColor('cmyk(0,0,0,100)')).toBe(true)
    expect(isPrintColor('cmyk(invalid)')).toBe(false)
    expect(isPrintColor('spot(Ink,0,0,0,100)')).toBe(true)
    expect(isPrintColor('spot(invalid)')).toBe(false)
    expect(isPrintColor('devicen(Ink;100;0,0,0,100)')).toBe(true)
    expect(isPrintColor('devicen(invalid)')).toBe(false)
  })
})
