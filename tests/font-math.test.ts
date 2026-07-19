import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'

const ROBOTO_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const NOTO_SANS_PATH = resolve(__dirname, 'fixtures/fonts/NotoSans-Regular.ttf')
const STIX_PATH = resolve(__dirname, 'fixtures/fonts/STIXTwoMath-Regular.otf')

describe('Font.math', () => {
  // Verifies the math accessor returns null for Roboto, which has no MATH table.
  it('Roboto には MATH テーブルがない → null', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.math).toBeNull()
  })

  // Verifies the math accessor returns null for NotoSans-Regular, which has no MATH table.
  it('NotoSans-Regular には MATH テーブルがない → null', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.math).toBeNull()
  })

  // Verifies the math property conforms to the MathTable | null contract, checking every interface method when non-null.
  it('math プロパティの型が MathTable | null であること', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const math = font.math
    // null is valid (font has no MATH table)
    if (math !== null) {
      // Confirm the MathTable interface methods exist
      expect(typeof math.getItalicCorrection).toBe('function')
      expect(typeof math.getTopAccentAttachment).toBe('function')
      expect(typeof math.isExtendedShape).toBe('function')
      expect(typeof math.getVerticalVariants).toBe('function')
      expect(typeof math.getHorizontalVariants).toBe('function')
      expect(typeof math.getVerticalAssembly).toBe('function')
      expect(typeof math.getHorizontalAssembly).toBe('function')
      expect(math.constants).toBeInstanceOf(Map)
    } else {
      expect(math).toBeNull()
    }
  })

  // Real-font oracle: the values below were read from STIX Two Math's actual
  // MATH table via fontTools. Matching them validates the constants, italics-
  // correction, vertical-variant and glyph-assembly parsers against the
  // reference implementation, not just synthetic byte layouts.
  describe.skipIf(!existsSync(STIX_PATH))('STIX Two Math matches fontTools', () => {
    const font = Font.load(readFileSync(STIX_PATH).buffer as ArrayBuffer)
    const math = font.math!

    it('parses MathConstants', () => {
      expect(math).not.toBeNull()
      const c = math.constants
      expect(c.get('scriptPercentScaleDown')).toBe(70)
      expect(c.get('scriptScriptPercentScaleDown')).toBe(55)
      expect(c.get('axisHeight')).toBe(258)
      expect(c.get('accentBaseHeight')).toBe(480)
      expect(c.get('fractionRuleThickness')).toBe(68)
      expect(c.get('delimitedSubFormulaMinHeight')).toBe(1325)
      expect(c.get('displayOperatorMinHeight')).toBe(1800)
      expect(c.get('radicalKernAfterDegree')).toBe(-335)
      expect(c.get('radicalDegreeBottomRaisePercent')).toBe(55)
    })

    it('parses vertical variants of a stretchy delimiter', () => {
      // gid 1060 (parenleft) has variant advances 799/1260/1890/2520/3149.
      const variants = math.getVerticalVariants(1060)
      expect(variants).not.toBeNull()
      expect(variants!.map((v) => v.advanceMeasurement)).toEqual([799, 1260, 1890, 2520, 3149])
      expect(variants!.map((v) => v.variantGlyph)).toEqual([1060, 1381, 1382, 1383, 1384])
    })

    it('parses a glyph assembly for an extensible delimiter', () => {
      // gid 1063 assembles from an extender (flags 1) and a plain part (flags 0).
      const asm = math.getVerticalAssembly(1063)
      expect(asm).not.toBeNull()
      expect(asm!.partRecords.map((p) => [p.glyphId, p.startConnectorLength, p.endConnectorLength, p.fullAdvance, p.partFlags]))
        .toEqual([[1063, 800, 800, 927, 1], [1063, 100, 100, 927, 0]])
    })
  })
})
