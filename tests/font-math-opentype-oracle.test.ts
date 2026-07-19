import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'

const FONT_PATH = resolve(__dirname, 'fixtures/fonts/FiraMath-Regular.otf')

interface MathOracle {
  constants: Record<string, number>
  italics: Record<string, number>
  accents: Record<string, number>
  extended: number[]
  vertical: Record<string, { variants: [number, number][], assembly: null | { italic: number, parts: number[][] } }>
  horizontal: Record<string, { variants: [number, number][], assembly: null | { italic: number, parts: number[][] } }>
}

const SCRIPT = `
import json, sys
from fontTools.ttLib import TTFont
font = TTFont(sys.argv[1])
math = font['MATH'].table
def value(v): return v.Value if hasattr(v, 'Value') else v
constants = {name[0].lower() + name[1:]: value(v) for name, v in math.MathConstants.__dict__.items()}
info = math.MathGlyphInfo
def covered_values(table, coverage_field, field):
    if table is None: return {}
    return {str(font.getGlyphID(g)): value(v) for g, v in zip(getattr(table, coverage_field).glyphs, getattr(table, field))}
italics = covered_values(info.MathItalicsCorrectionInfo, 'Coverage', 'ItalicsCorrection')
accents = covered_values(info.MathTopAccentAttachment, 'TopAccentCoverage', 'TopAccentAttachment')
extended = [] if info.ExtendedShapeCoverage is None else [font.getGlyphID(g) for g in info.ExtendedShapeCoverage.glyphs]
def constructions(coverage, records):
    if coverage is None: return {}
    result = {}
    for glyph, construction in zip(coverage.glyphs, records):
        variants = [[font.getGlyphID(v.VariantGlyph), v.AdvanceMeasurement] for v in construction.MathGlyphVariantRecord]
        assembly = construction.GlyphAssembly
        if assembly is not None:
            parts = [[font.getGlyphID(p.glyph), p.StartConnectorLength, p.EndConnectorLength, p.FullAdvance, p.PartFlags] for p in assembly.PartRecords]
            assembly = {'italic': value(assembly.ItalicsCorrection), 'parts': parts}
        result[str(font.getGlyphID(glyph))] = {'variants': variants, 'assembly': assembly}
    return result
variants = math.MathVariants
print(json.dumps({
  'constants': constants, 'italics': italics, 'accents': accents, 'extended': extended,
  'vertical': constructions(variants.VertGlyphCoverage, variants.VertGlyphConstruction),
  'horizontal': constructions(variants.HorizGlyphCoverage, variants.HorizGlyphConstruction),
}))
`

describe.skipIf(!existsSync(FONT_PATH))('OpenType MATH fontTools oracle', () => {
  it('preserves mapped variants and assemblies through compact subsetting', () => {
    const bytes = readFileSync(FONT_PATH)
    const source = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const sourceGlyph = source.getGlyphId('('.codePointAt(0)!)
    const result = source.subsetWithMapping('(')
    const subset = Font.load(result.buffer)
    const mappedSource = result.oldToNewGlyphId.get(sourceGlyph)!
    const expectedVariants = source.math!.getVerticalVariants(sourceGlyph)
    const actualVariants = subset.math!.getVerticalVariants(mappedSource)
    expect(actualVariants.map(function (variant) { return [variant.variantGlyph, variant.advanceMeasurement] }))
      .toEqual(expectedVariants.map(function (variant) {
        return [result.oldToNewGlyphId.get(variant.variantGlyph)!, variant.advanceMeasurement]
      }))
    const expectedAssembly = source.math!.getVerticalAssembly(sourceGlyph)
    const actualAssembly = subset.math!.getVerticalAssembly(mappedSource)
    expect(actualAssembly?.partRecords.map(function (part) { return part.glyphId }))
      .toEqual(expectedAssembly?.partRecords.map(function (part) {
        return result.oldToNewGlyphId.get(part.glyphId)!
      }))
  })

  it('matches every constant, glyph-info value, variant, and assembly record', () => {
    const expected = JSON.parse(execFileSync('python3', ['-c', SCRIPT, FONT_PATH], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })) as MathOracle
    const bytes = readFileSync(FONT_PATH)
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const math = font.math!

    for (const [name, value] of Object.entries(expected.constants)) {
      expect(math.constants.get(name), name).toBe(value)
    }
    for (const [glyphId, value] of Object.entries(expected.italics)) {
      expect(math.getItalicCorrection(Number(glyphId)), `italic gid ${glyphId}`).toBe(value)
    }
    for (const [glyphId, value] of Object.entries(expected.accents)) {
      expect(math.getTopAccentAttachment(Number(glyphId)), `accent gid ${glyphId}`).toBe(value)
    }
    for (const glyphId of expected.extended) expect(math.isExtendedShape(glyphId)).toBe(true)
    compareConstructions(math, expected.vertical, true)
    compareConstructions(math, expected.horizontal, false)
  })
})

function compareConstructions(
  math: NonNullable<Font['math']>,
  expected: MathOracle['vertical'],
  vertical: boolean,
): void {
  for (const [glyphIdText, construction] of Object.entries(expected)) {
    const glyphId = Number(glyphIdText)
    const variants = vertical ? math.getVerticalVariants(glyphId) : math.getHorizontalVariants(glyphId)
    expect(variants.map(v => [v.variantGlyph, v.advanceMeasurement]), `variants gid ${glyphId}`).toEqual(construction.variants)
    const assembly = vertical ? math.getVerticalAssembly(glyphId) : math.getHorizontalAssembly(glyphId)
    if (construction.assembly === null) {
      expect(assembly).toBeNull()
    } else {
      expect(assembly).not.toBeNull()
      expect(assembly!.italicsCorrection.value).toBe(construction.assembly.italic)
      expect(assembly!.partRecords.map(p => [
        p.glyphId, p.startConnectorLength, p.endConnectorLength, p.fullAdvance, p.partFlags,
      ])).toEqual(construction.assembly.parts)
    }
  }
}
