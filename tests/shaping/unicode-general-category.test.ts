import { describe, expect, it } from 'vitest'
import { isUnicodeDecimalNumber } from '../../src/shaping/unicode-general-category.js'

describe('Unicode 17.0 Decimal_Number data', function () {
  it.each([
    0x0030, 0x0665, 0x096f, 0x0e50, 0xff19, 0x104a0, 0x116d9,
    0x1d7ff, 0x1e5f1, 0x1fbf9,
  ])('includes U+%s', function (codePoint) {
    expect(isUnicodeDecimalNumber(codePoint)).toBe(true)
  })

  it.each([0x002f, 0x003a, 0x065f, 0x2160, 0x1d7cd, 0x1e5fb, 0x10ffff])(
    'excludes U+%s',
    function (codePoint) {
      expect(isUnicodeDecimalNumber(codePoint)).toBe(false)
    },
  )
})
