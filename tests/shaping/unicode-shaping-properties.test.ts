import { describe, expect, it } from 'vitest'
import {
  UNICODE_BLOCK_NAMES,
  UNICODE_BLOCK_RANGES,
  UNICODE_INDIC_POSITIONAL_CATEGORY_NAMES,
  UNICODE_INDIC_POSITIONAL_CATEGORY_RANGES,
  UNICODE_INDIC_SYLLABIC_CATEGORY_NAMES,
  UNICODE_INDIC_SYLLABIC_CATEGORY_RANGES,
  UNICODE_JOINING_TYPE_NAMES,
  UNICODE_JOINING_TYPE_RANGES,
  UNICODE_SCRIPT_NAMES,
  UNICODE_SCRIPT_RANGES,
  UNICODE_SHAPING_DATA_VERSION,
  UNICODE_USE_SHAPING_RANGES,
} from '../../src/shaping/unicode-shaping-data.js'
import {
  getUnicodeBlock,
  getUnicodeIndicPositionalCategory,
  getUnicodeIndicSyllabicCategory,
  getUnicodeJoiningType,
  getUnicodeScript,
  getUnicodeScriptTag,
} from '../../src/shaping/unicode-shaping-properties.js'
import {
  deriveUseScriptTag, getUseClass, isUseScriptChar,
  U_G, U_J, U_SB,
} from '../../src/shaping/use-tables.js'
import { isIndicChar } from '../../src/shaping/indic.js'
import { isKhmerChar } from '../../src/shaping/khmer.js'
import { isMyanmarChar } from '../../src/shaping/myanmar.js'

function assertGeneratedRanges(
  ranges: Uint32Array,
  expectedRanges: number,
  expectedCodePoints: number,
): void {
  expect(ranges.length).toBe(expectedRanges * 3)
  let count = 0
  let previousEnd = -1
  for (let i = 0; i < ranges.length; i += 3) {
    const start = ranges[i]!
    const end = ranges[i + 1]!
    expect(start).toBeGreaterThan(previousEnd)
    expect(end).toBeGreaterThanOrEqual(start)
    count += end - start + 1
    previousEnd = end
  }
  expect(count).toBe(expectedCodePoints)
}

describe('Unicode 17.0 shaping property generation', function () {
  it('contains every explicit UCD range and property value', function () {
    expect(UNICODE_SHAPING_DATA_VERSION).toBe('17.0.0')
    assertGeneratedRanges(UNICODE_SCRIPT_RANGES, 2287, 159866)
    assertGeneratedRanges(UNICODE_BLOCK_RANGES, 346, 303808)
    assertGeneratedRanges(UNICODE_JOINING_TYPE_RANGES, 542, 3004)
    assertGeneratedRanges(UNICODE_INDIC_SYLLABIC_CATEGORY_RANGES, 967, 4856)
    assertGeneratedRanges(UNICODE_INDIC_POSITIONAL_CATEGORY_RANGES, 653, 1299)
    assertGeneratedRanges(UNICODE_USE_SHAPING_RANGES, 1057, 15766)
    expect(UNICODE_SCRIPT_NAMES).toHaveLength(174)
    expect(UNICODE_BLOCK_NAMES).toHaveLength(346)
    expect(UNICODE_JOINING_TYPE_NAMES).toHaveLength(5)
    expect(UNICODE_INDIC_SYLLABIC_CATEGORY_NAMES).toHaveLength(36)
    expect(UNICODE_INDIC_POSITIONAL_CATEGORY_NAMES).toHaveLength(15)
  })

  it('resolves normative defaults and Unicode 17 additions', function () {
    expect(getUnicodeScript(0x16EA0)).toBe('Beria_Erfe')
    expect(getUnicodeScriptTag(0x16EA0)).toBe('Berf')
    expect(getUnicodeScript(0x1E6C0)).toBe('Tai_Yo')
    expect(getUnicodeScript(0x11DB0)).toBe('Tolong_Siki')
    expect(getUnicodeScript(0x0378)).toBe('Unknown')
    expect(getUnicodeBlock(0x10940)).toBe('Sidetic')
    expect(getUnicodeBlock(0x2FE0)).toBeNull()
  })

  it('provides complete joining and Indic property values', function () {
    expect(getUnicodeJoiningType(0x180A)).toBe('C')
    expect(getUnicodeJoiningType(0x088F)).toBe('D')
    expect(getUnicodeJoiningType(0x10D69)).toBe('T')
    expect(getUnicodeJoiningType(0x0041)).toBe('U')
    expect(getUnicodeIndicSyllabicCategory(0x0D9A)).toBe('Consonant')
    expect(getUnicodeIndicPositionalCategory(0x0DD9)).toBe('Left')
    expect(getUnicodeIndicSyllabicCategory(0x0041)).toBe('Other')
    expect(getUnicodeIndicPositionalCategory(0x0041)).toBe('Not_Applicable')
  })

  it('drives complex-shaper routing from Script instead of block ranges', function () {
    expect(isIndicChar(0x0D9A)).toBe(true)
    expect(isIndicChar(0x0D80)).toBe(false)
    expect(isKhmerChar(0x17D2)).toBe(true)
    expect(isKhmerChar(0x17E0)).toBe(true)
    expect(isMyanmarChar(0x116D0)).toBe(true)
    expect(isUseScriptChar(0x16EA0)).toBe(true)
    expect(deriveUseScriptTag(0x16EA0)).toBe('berf')
    expect(isUseScriptChar(0x16EA9)).toBe(true)
  })

  it('generates current USE categories including hieroglyph controls', function () {
    expect(getUseClass(0x13000)).toBe(U_G)
    expect(getUseClass(0x13430)).toBe(U_J)
    expect(getUseClass(0x13437)).toBe(U_SB)
  })
})
