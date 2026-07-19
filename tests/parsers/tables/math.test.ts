import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { buildCompactMathTable, parseMath } from '../../../src/parsers/tables/math.js'

/**
 * Build a minimal MATH table with constants and glyph info
 */
function buildMathTable(options: {
  scriptPercentScaleDown?: number
  axisHeightDevice?: 'device' | 'variation'
  italicCorrections?: { glyphId: number; value: number }[]
  topAccents?: { glyphId: number; value: number }[]
  extendedShapes?: number[]
  mathKerns?: { glyphId: number; topRight: { heights: number[]; kerns: number[] } }[]
  vertVariants?: {
    glyphId: number
    variants: { variantGlyph: number; advanceMeasurement: number }[]
    assembly?: { partFlags: number }
  }[]
}): ArrayBuffer {
  const buf = new ArrayBuffer(4096)
  const view = new DataView(buf)
  let pos = 0

  // Header: majorVersion(2) + minorVersion(2) + mathConstantsOffset(2) + mathGlyphInfoOffset(2) + mathVariantsOffset(2) = 10
  view.setUint16(pos, 1); pos += 2
  view.setUint16(pos, 0); pos += 2
  const constantsOffsetPos = pos; pos += 2
  const glyphInfoOffsetPos = pos; pos += 2
  const variantsOffsetPos = pos; pos += 2

  // MathConstants
  const constantsStart = pos
  view.setUint16(constantsOffsetPos, constantsStart)

  // scriptPercentScaleDown (int16)
  view.setInt16(pos, options.scriptPercentScaleDown ?? 80); pos += 2
  // scriptScriptPercentScaleDown (int16)
  view.setInt16(pos, 60); pos += 2
  // delimitedSubFormulaMinHeight (uint16)
  view.setUint16(pos, 0); pos += 2
  // displayOperatorMinHeight (uint16)
  view.setUint16(pos, 0); pos += 2
  // Remaining constants: MathValueRecords for indices 4..54 (51 records × 4 bytes)
  // + 1 final int16 (radicalDegreeBottomRaisePercent, index 55)
  let axisHeightDeviceOffsetPos = -1
  for (let i = 4; i < 55; i++) {
    view.setInt16(pos, 0); pos += 2
    if (i === 5) axisHeightDeviceOffsetPos = pos
    view.setUint16(pos, 0); pos += 2
  }
  // radicalDegreeBottomRaisePercent (int16)
  view.setInt16(pos, 60); pos += 2
  if (options.axisHeightDevice !== undefined) {
    const deviceStart = pos
    view.setUint16(axisHeightDeviceOffsetPos, deviceStart - constantsStart)
    if (options.axisHeightDevice === 'device') {
      view.setUint16(pos, 12); pos += 2
      view.setUint16(pos, 12); pos += 2
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0x1000); pos += 2
    } else {
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0x8000); pos += 2
    }
  }

  // MathGlyphInfo
  const glyphInfoStart = pos
  view.setUint16(glyphInfoOffsetPos, glyphInfoStart)

  const icOffsetPos = pos; pos += 2 // italicCorrectionInfo offset
  const taOffsetPos = pos; pos += 2 // topAccentAttachment offset
  const esOffsetPos = pos; pos += 2 // extendedShapeCoverage offset
  const mkOffsetPos = pos; pos += 2 // mathKernInfo offset (0 for now)
  view.setUint16(mkOffsetPos, 0)

  // ItalicCorrection Info
  if (options.italicCorrections && options.italicCorrections.length > 0) {
    const icStart = pos
    view.setUint16(icOffsetPos, icStart - glyphInfoStart)
    const icCoverageOffsetPos = pos; pos += 2
    view.setUint16(pos, options.italicCorrections.length); pos += 2
    for (const ic of options.italicCorrections) {
      view.setInt16(pos, ic.value); pos += 2
      view.setUint16(pos, 0); pos += 2 // device offset
    }
    // Coverage (format 1)
    const coverageStart = pos
    view.setUint16(icCoverageOffsetPos, coverageStart - icStart)
    view.setUint16(pos, 1); pos += 2 // format 1
    view.setUint16(pos, options.italicCorrections.length); pos += 2
    for (const ic of options.italicCorrections) {
      view.setUint16(pos, ic.glyphId); pos += 2
    }
  } else {
    view.setUint16(icOffsetPos, 0)
  }

  // TopAccent Attachment
  if (options.topAccents && options.topAccents.length > 0) {
    const taStart = pos
    view.setUint16(taOffsetPos, taStart - glyphInfoStart)
    const taCoverageOffsetPos = pos; pos += 2
    view.setUint16(pos, options.topAccents.length); pos += 2
    for (const ta of options.topAccents) {
      view.setInt16(pos, ta.value); pos += 2
      view.setUint16(pos, 0); pos += 2
    }
    const coverageStart = pos
    view.setUint16(taCoverageOffsetPos, coverageStart - taStart)
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, options.topAccents.length); pos += 2
    for (const ta of options.topAccents) {
      view.setUint16(pos, ta.glyphId); pos += 2
    }
  } else {
    view.setUint16(taOffsetPos, 0)
  }

  // Extended Shape Coverage
  if (options.extendedShapes && options.extendedShapes.length > 0) {
    const esStart = pos
    view.setUint16(esOffsetPos, esStart - glyphInfoStart)
    view.setUint16(pos, 1); pos += 2 // format 1
    view.setUint16(pos, options.extendedShapes.length); pos += 2
    for (const gid of options.extendedShapes) {
      view.setUint16(pos, gid); pos += 2
    }
  } else {
    view.setUint16(esOffsetPos, 0)
  }

  // MathKernInfo
  if (options.mathKerns && options.mathKerns.length > 0) {
    const mkStart = pos
    view.setUint16(mkOffsetPos, mkStart - glyphInfoStart)
    const mkCoverageOffsetPos = pos; pos += 2
    view.setUint16(pos, options.mathKerns.length); pos += 2
    const kernOffsetPositions: number[] = []
    for (let i = 0; i < options.mathKerns.length; i++) {
      kernOffsetPositions.push(pos)
      pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
    }
    for (let i = 0; i < options.mathKerns.length; i++) {
      const kernStart = pos
      view.setUint16(kernOffsetPositions[i]!, kernStart - mkStart)
      const kern = options.mathKerns[i]!.topRight
      view.setUint16(pos, kern.heights.length); pos += 2
      for (const height of kern.heights) {
        view.setInt16(pos, height); pos += 2
        view.setUint16(pos, 0); pos += 2
      }
      for (const value of kern.kerns) {
        view.setInt16(pos, value); pos += 2
        view.setUint16(pos, 0); pos += 2
      }
    }
    const coverageStart = pos
    view.setUint16(mkCoverageOffsetPos, coverageStart - mkStart)
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, options.mathKerns.length); pos += 2
    for (const kern of options.mathKerns) {
      view.setUint16(pos, kern.glyphId); pos += 2
    }
  } else {
    view.setUint16(mkOffsetPos, 0)
  }

  // MathVariants
  if (options.vertVariants && options.vertVariants.length > 0) {
    const variantsStart = pos
    view.setUint16(variantsOffsetPos, variantsStart)

    view.setUint16(pos, 50); pos += 2 // minConnectorOverlap
    const vertCoverageOffsetPos = pos; pos += 2
    view.setUint16(pos, 0); pos += 2 // horizGlyphCoverageOffset = 0
    view.setUint16(pos, options.vertVariants.length); pos += 2 // vertGlyphCount
    view.setUint16(pos, 0); pos += 2 // horizGlyphCount

    // Vert construction offsets placeholder
    const constructionOffsetPositions: number[] = []
    for (let i = 0; i < options.vertVariants.length; i++) {
      constructionOffsetPositions.push(pos)
      pos += 2
    }

    // Vert coverage
    const coverageStart = pos
    view.setUint16(vertCoverageOffsetPos, coverageStart - variantsStart)
    view.setUint16(pos, 1); pos += 2 // format 1
    view.setUint16(pos, options.vertVariants.length); pos += 2
    for (const vv of options.vertVariants) {
      view.setUint16(pos, vv.glyphId); pos += 2
    }

    // GlyphConstruction records
    for (let i = 0; i < options.vertVariants.length; i++) {
      const constructionStart = pos
      view.setUint16(constructionOffsetPositions[i]!, constructionStart - variantsStart)

      const assemblyOffsetPos = pos
      view.setUint16(pos, 0); pos += 2 // assembly offset
      view.setUint16(pos, options.vertVariants[i]!.variants.length); pos += 2
      for (const v of options.vertVariants[i]!.variants) {
        view.setUint16(pos, v.variantGlyph); pos += 2
        view.setUint16(pos, v.advanceMeasurement); pos += 2
      }
      if (options.vertVariants[i]!.assembly) {
        const assemblyStart = pos
        view.setUint16(assemblyOffsetPos, assemblyStart - constructionStart)
        view.setInt16(pos, 0); pos += 2
        view.setUint16(pos, 0); pos += 2
        view.setUint16(pos, 1); pos += 2
        view.setUint16(pos, 50); pos += 2
        view.setUint16(pos, 10); pos += 2
        view.setUint16(pos, 10); pos += 2
        view.setUint16(pos, 100); pos += 2
        view.setUint16(pos, options.vertVariants[i]!.assembly.partFlags); pos += 2
      }
    }
  } else {
    view.setUint16(variantsOffsetPos, 0)
  }

  return buf.slice(0, pos)
}

describe('MATH table parser', () => {
  // Verifies that MathConstants (scale-down percents through radicalDegreeBottomRaisePercent) are read by name.
  it('should parse MathConstants', () => {
    const buf = buildMathTable({ scriptPercentScaleDown: 75 })
    const math = parseMath(new BinaryReader(buf))

    expect(math.constants.get('scriptPercentScaleDown')).toBe(75)
    expect(math.constants.get('scriptScriptPercentScaleDown')).toBe(60)
    expect(math.constants.get('radicalDegreeBottomRaisePercent')).toBe(60)
  })

  it('resolves MathValueRecord Device deltas into design units', () => {
    const math = parseMath(new BinaryReader(buildMathTable({ axisHeightDevice: 'device' })))

    expect(math.getConstant('axisHeight', { ppem: 12, unitsPerEm: 1200 })).toBe(100)
    expect(math.getConstant('axisHeight', { ppem: 13, unitsPerEm: 1200 })).toBe(0)
  })

  it('resolves MathValueRecord VariationIndex through GDEF', () => {
    const math = parseMath(new BinaryReader(buildMathTable({ axisHeightDevice: 'variation' })))
    const getVarDelta = (outer: number, inner: number, coords: number[]): number => {
      expect([outer, inner]).toEqual([0, 0])
      return coords[0]! * 20
    }

    expect(math.getConstant('axisHeight', {
      unitsPerEm: 1000,
      normalizedCoords: [0.5],
      gdef: { getVarDelta } as never,
    })).toBe(10)
  })

  it('materializes MATH VariationIndex values in compact static tables', () => {
    const rebuilt = buildCompactMathTable(
      new BinaryReader(buildMathTable({ axisHeightDevice: 'variation' })),
      new Map(),
      { coords: [0.5], gdef: { getVarDelta() { return 10 } } as never },
    )
    const math = parseMath(new BinaryReader(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength))
    expect(math.getConstant('axisHeight')).toBe(10)
  })

  // Verifies that MathItalicsCorrectionInfo maps covered glyphs to their values and uncovered glyphs to 0.
  it('should parse italic corrections', () => {
    const buf = buildMathTable({
      italicCorrections: [
        { glyphId: 10, value: 50 },
        { glyphId: 20, value: 100 },
      ],
    })
    const math = parseMath(new BinaryReader(buf))

    expect(math.getItalicCorrection(10)).toBe(50)
    expect(math.getItalicCorrection(20)).toBe(100)
    expect(math.getItalicCorrection(99)).toBe(0)
  })

  // Verifies that MathTopAccentAttachment returns the attachment point for covered glyphs and 0 otherwise.
  it('should parse top accent attachments', () => {
    const buf = buildMathTable({
      topAccents: [{ glyphId: 15, value: 250 }],
    })
    const math = parseMath(new BinaryReader(buf))

    expect(math.getTopAccentAttachment(15)).toBe(250)
    expect(math.getTopAccentAttachment(99)).toBe(0)
  })

  // Verifies that ExtendedShapeCoverage membership is reported per glyph.
  it('should identify extended shapes', () => {
    const buf = buildMathTable({
      extendedShapes: [30, 31, 32],
    })
    const math = parseMath(new BinaryReader(buf))

    expect(math.isExtendedShape(30)).toBe(true)
    expect(math.isExtendedShape(31)).toBe(true)
    expect(math.isExtendedShape(99)).toBe(false)
  })

  // Verifies that MathVariants vertical GlyphConstruction records yield variant glyphs with advance measurements.
  it('should parse vertical variants', () => {
    const buf = buildMathTable({
      vertVariants: [{
        glyphId: 40,
        variants: [
          { variantGlyph: 41, advanceMeasurement: 1000 },
          { variantGlyph: 42, advanceMeasurement: 2000 },
        ],
      }],
    })
    const math = parseMath(new BinaryReader(buf))

    const variants = math.getVerticalVariants(40)
    expect(variants).toHaveLength(2)
    expect(variants[0]!.variantGlyph).toBe(41)
    expect(variants[0]!.advanceMeasurement).toBe(1000)
    expect(variants[1]!.variantGlyph).toBe(42)
  })

  it('should parse MathKernInfo and GlyphAssembly records', () => {
    const buf = buildMathTable({
      mathKerns: [{
        glyphId: 35,
        topRight: { heights: [100, 200], kerns: [10, 20, 30] },
      }],
      vertVariants: [{
        glyphId: 40,
        variants: [{ variantGlyph: 41, advanceMeasurement: 1000 }],
        assembly: { partFlags: 1 },
      }],
    })
    const math = parseMath(new BinaryReader(buf))

    const kernInfo = math.getMathKernInfo(35)
    expect(kernInfo?.topRight?.heights).toEqual([100, 200])
    expect(kernInfo?.topRight?.kerns).toEqual([10, 20, 30])

    const assembly = math.getVerticalAssembly(40)
    expect(assembly?.partRecords).toHaveLength(1)
    expect(assembly?.partRecords[0]!.partFlags).toBe(1)
  })

  // Verifies that variant/assembly queries return empty arrays or null when MathVariants is absent.
  it('should return empty for glyphs without variants', () => {
    const buf = buildMathTable({})
    const math = parseMath(new BinaryReader(buf))

    expect(math.getVerticalVariants(99)).toEqual([])
    expect(math.getHorizontalVariants(99)).toEqual([])
    expect(math.getVerticalAssembly(99)).toBeNull()
    expect(math.getHorizontalAssembly(99)).toBeNull()
  })

  it('accepts compatible minor extensions and rejects unknown major versions', () => {
    const buf = buildMathTable({})
    new DataView(buf).setUint16(2, 1)
    expect(() => parseMath(new BinaryReader(buf))).not.toThrow()
    new DataView(buf).setUint16(0, 2)
    expect(() => parseMath(new BinaryReader(buf))).toThrow('Unsupported MATH table version: 2.1')
  })

  it('should reject MathItalicsCorrectionInfo count mismatches', () => {
    const buf = buildMathTable({
      italicCorrections: [
        { glyphId: 10, value: 50 },
        { glyphId: 20, value: 100 },
      ],
    })
    const view = new DataView(buf)
    const mathGlyphInfoOffset = view.getUint16(6)
    const italicCorrectionInfoOffset = view.getUint16(mathGlyphInfoOffset)
    view.setUint16(mathGlyphInfoOffset + italicCorrectionInfoOffset + 2, 1)

    expect(() => parseMath(new BinaryReader(buf))).toThrow(
      'MATH MathItalicsCorrectionInfo count 1 must match coverage glyph count 2',
    )
  })

  it('should reject MathTopAccentAttachment count mismatches', () => {
    const buf = buildMathTable({
      topAccents: [
        { glyphId: 15, value: 250 },
        { glyphId: 16, value: 300 },
      ],
    })
    const view = new DataView(buf)
    const mathGlyphInfoOffset = view.getUint16(6)
    const topAccentAttachmentOffset = view.getUint16(mathGlyphInfoOffset + 2)
    view.setUint16(mathGlyphInfoOffset + topAccentAttachmentOffset + 2, 1)

    expect(() => parseMath(new BinaryReader(buf))).toThrow(
      'MATH MathTopAccentAttachment count 1 must match coverage glyph count 2',
    )
  })

  it('should reject MathVariants coverage count mismatches', () => {
    const buf = buildMathTable({
      vertVariants: [{
        glyphId: 40,
        variants: [{ variantGlyph: 41, advanceMeasurement: 1000 }],
      }],
    })
    const view = new DataView(buf)
    const mathVariantsOffset = view.getUint16(8)
    const vertGlyphCoverageOffset = view.getUint16(mathVariantsOffset + 2)
    view.setUint16(mathVariantsOffset + vertGlyphCoverageOffset + 2, 0)

    expect(() => parseMath(new BinaryReader(buf))).toThrow(
      'MATH MathVariants vertGlyphCount 1 must match coverage glyph count 0',
    )
  })

  it('should reject MathKern correction heights that are not ascending', () => {
    const buf = buildMathTable({
      mathKerns: [{
        glyphId: 35,
        topRight: { heights: [200, 100], kerns: [10, 20, 30] },
      }],
    })

    expect(() => parseMath(new BinaryReader(buf))).toThrow(
      'MATH MathKernInfo glyph 0 topRight correctionHeight 1 is not in ascending order',
    )
  })

  it('should reject reserved GlyphPart flags', () => {
    const buf = buildMathTable({
      vertVariants: [{
        glyphId: 40,
        variants: [{ variantGlyph: 41, advanceMeasurement: 1000 }],
        assembly: { partFlags: 2 },
      }],
    })

    expect(() => parseMath(new BinaryReader(buf))).toThrow(
      'MATH MathVariants vertical construction 0 GlyphPart 0 partFlags contain reserved bits: 0x0002',
    )
  })
})
