import { describe, expect, it } from 'vitest'
import { getUnicodeVerticalOrientation } from '../../src/shaping/unicode-vertical-orientation.js'

describe('Unicode 17 Vertical_Orientation', function () {
  it('covers U, R, Tu, and Tr classes from the generated official data', function () {
    expect(getUnicodeVerticalOrientation(0x6F22)).toBe('U')
    expect(getUnicodeVerticalOrientation(0x41)).toBe('R')
    expect(getUnicodeVerticalOrientation(0x3001)).toBe('Tu')
    expect(getUnicodeVerticalOrientation(0x3008)).toBe('Tr')
  })

  it('uses the Unicode default R value outside explicit ranges', function () {
    expect(getUnicodeVerticalOrientation(0x10FFFF)).toBe('R')
  })
})
