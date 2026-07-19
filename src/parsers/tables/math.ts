import { BinaryReader } from '../../binary/reader.js'
import { parseCoverageMap, parseDeviceTable, resolveDeviceDelta, type ParsedDevice } from './otl-common.js'
import type { GdefTable } from './gdef.js'

/**
 * MathValueRecord: value + device table offset
 */
export interface MathValueRecord {
  readonly value: number
  readonly deviceOffset: number
  readonly device: ParsedDevice | null
  /** Absolute source position of this MathValueRecord. */
  readonly sourceOffset: number
}

/** Runtime inputs used to resolve MATH Device and VariationIndex values. */
export interface MathValueContext {
  readonly ppem?: number
  readonly unitsPerEm: number
  readonly normalizedCoords?: number[]
  readonly gdef?: GdefTable | null
}

/**
 * MathGlyphVariantRecord
 */
export interface MathGlyphVariantRecord {
  readonly variantGlyph: number
  readonly advanceMeasurement: number
}

/**
 * GlyphPartRecord (component part of a GlyphAssembly)
 */
export interface GlyphPartRecord {
  readonly glyphId: number
  readonly startConnectorLength: number
  readonly endConnectorLength: number
  readonly fullAdvance: number
  readonly partFlags: number // 0x0001 = fExtender
}

/**
 * GlyphAssembly
 */
export interface GlyphAssembly {
  readonly italicsCorrection: MathValueRecord
  readonly partRecords: readonly GlyphPartRecord[]
}

/**
 * GlyphConstruction
 */
export interface GlyphConstruction {
  readonly assembly: GlyphAssembly | null
  readonly variants: readonly MathGlyphVariantRecord[]
}

/**
 * MathKern — staircase kerning as a sequence of (correctionHeight, kernValue) pairs
 * Returns the kern value for a given height. Used for precise placement of sub/superscripts.
 */
export interface MathKernRecord {
  readonly heights: readonly number[]   // correctionHeight values (font units, ascending)
  readonly kerns: readonly number[]     // kern values (heights.length + 1 entries)
}

interface ParsedMathKernRecord {
  readonly heights: readonly MathValueRecord[]
  readonly kerns: readonly MathValueRecord[]
}

/**
 * Per-glyph MathKern for the 4 corners
 */
export interface MathKernInfo {
  readonly topRight: MathKernRecord | null
  readonly topLeft: MathKernRecord | null
  readonly bottomRight: MathKernRecord | null
  readonly bottomLeft: MathKernRecord | null
}

/**
 * MATH table: mathematical typesetting
 */
export interface MathTable {
  /** Glyph references and source offsets required for compact table rebuilding. */
  readonly subsetData: MathSubsetData
  /** MathConstants — 56 constants */
  readonly constants: ReadonlyMap<string, number>
  /** Get a constant with Device / VariationIndex adjustment resolved. */
  getConstant(name: string, context?: MathValueContext): number
  /** Resolve an arbitrary MathValueRecord. */
  resolveValue(record: MathValueRecord, context?: MathValueContext): number
  /** Get the italic correction */
  getItalicCorrection(glyphId: number, context?: MathValueContext): number
  /** Get the top accent attachment */
  getTopAccentAttachment(glyphId: number, context?: MathValueContext): number
  /** Whether the glyph is an extended shape */
  isExtendedShape(glyphId: number): boolean
  /** Get MathKern info */
  getMathKernInfo(glyphId: number, context?: MathValueContext): MathKernInfo | null
  /** Get the list of vertical variants */
  getVerticalVariants(glyphId: number): readonly MathGlyphVariantRecord[]
  /** Get the list of horizontal variants */
  getHorizontalVariants(glyphId: number): readonly MathGlyphVariantRecord[]
  /** Get the vertical assembly */
  getVerticalAssembly(glyphId: number): GlyphAssembly | null
  /** Get the horizontal assembly */
  getHorizontalAssembly(glyphId: number): GlyphAssembly | null
  /** Minimum connector overlap (font units) */
  readonly minConnectorOverlap: number
}

export interface MathSubsetData {
  readonly referencedGlyphIds: ReadonlySet<number>
  readonly coverageOffsets: ReadonlySet<number>
  readonly explicitGlyphOffsets: readonly number[]
  readonly valueRecords: readonly MathValueRecord[]
}

// The 56 MathConstants field names (spec order)
const MATH_CONSTANT_NAMES = [
  'scriptPercentScaleDown', 'scriptScriptPercentScaleDown',
  'delimitedSubFormulaMinHeight', 'displayOperatorMinHeight',
  'mathLeading', 'axisHeight', 'accentBaseHeight', 'flattenedAccentBaseHeight',
  'subscriptShiftDown', 'subscriptTopMax', 'subscriptBaselineDropMin',
  'superscriptShiftUp', 'superscriptShiftUpCramped', 'superscriptBottomMin',
  'superscriptBaselineDropMax', 'subSuperscriptGapMin', 'superscriptBottomMaxWithSubscript',
  'spaceAfterScript', 'upperLimitGapMin', 'upperLimitBaselineRiseMin',
  'lowerLimitGapMin', 'lowerLimitBaselineDropMin', 'stackTopShiftUp',
  'stackTopDisplayStyleShiftUp', 'stackBottomShiftDown', 'stackBottomDisplayStyleShiftDown',
  'stackGapMin', 'stackDisplayStyleGapMin', 'stretchStackTopShiftUp',
  'stretchStackBottomShiftDown', 'stretchStackGapAboveMin',
  'stretchStackGapBelowMin', 'fractionNumeratorShiftUp',
  'fractionNumeratorDisplayStyleShiftUp', 'fractionDenominatorShiftDown',
  'fractionDenominatorDisplayStyleShiftDown', 'fractionNumeratorGapMin',
  'fractionNumDisplayStyleGapMin', 'fractionRuleThickness',
  'fractionDenominatorGapMin', 'fractionDenomDisplayStyleGapMin',
  'skewedFractionHorizontalGap', 'skewedFractionVerticalGap',
  'overbarVerticalGap', 'overbarRuleThickness', 'overbarExtraAscender',
  'underbarVerticalGap', 'underbarRuleThickness', 'underbarExtraDescender',
  'radicalVerticalGap', 'radicalDisplayStyleVerticalGap',
  'radicalRuleThickness', 'radicalExtraAscender',
  'radicalKernBeforeDegree', 'radicalKernAfterDegree',
  'radicalDegreeBottomRaisePercent',
]

const MATH_HEADER_SIZE = 10
const MATH_CONSTANTS_SIZE = 214

function readMathValueRecord(reader: BinaryReader, parentOffset: number, label: string): MathValueRecord {
  const sourceOffset = reader.position
  const value = reader.readInt16()
  const deviceOffset = reader.readUint16()
  let device: ParsedDevice | null = null
  if (deviceOffset !== 0) {
    ensureMathOffset(reader, parentOffset, deviceOffset, 6, `${label} deviceOffset`)
    device = parseDeviceTable(reader, parentOffset + deviceOffset)
  }
  return { value, deviceOffset, device, sourceOffset }
}

function parseMathKernTable(reader: BinaryReader, offset: number, label: string): ParsedMathKernRecord {
  ensureMathRange(reader, offset, 2, `${label} header`)
  reader.seek(offset)
  const heightCount = reader.readUint16()
  ensureMathRange(reader, offset, 2 + heightCount * 4 + (heightCount + 1) * 4, `${label} table`)
  const heights: MathValueRecord[] = []
  for (let i = 0; i < heightCount; i++) {
    const mvr = readMathValueRecord(reader, offset, `${label} correctionHeight ${i}`)
    if (i > 0 && mvr.value <= heights[i - 1]!.value) {
      throw new Error(`${label} correctionHeight ${i} is not in ascending order`)
    }
    heights.push(mvr)
  }
  // There are heightCount + 1 kern values
  const kerns: MathValueRecord[] = []
  for (let i = 0; i <= heightCount; i++) {
    const mvr = readMathValueRecord(reader, offset, `${label} kernValue ${i}`)
    kerns.push(mvr)
  }
  return { heights, kerns }
}

function parseGlyphConstruction(
  reader: BinaryReader,
  offset: number,
  label: string,
  referencedGlyphIds: Set<number>,
  explicitGlyphOffsets: number[],
): GlyphConstruction {
  ensureMathRange(reader, offset, 4, `${label} header`)
  reader.seek(offset)
  const assemblyOffset = reader.readUint16()
  const variantCount = reader.readUint16()
  const variantsEnd = 4 + variantCount * 4
  ensureMathRange(reader, offset + 4, variantCount * 4, `${label} variant records`)

  const variants: MathGlyphVariantRecord[] = []
  for (let i = 0; i < variantCount; i++) {
    explicitGlyphOffsets.push(reader.position)
    const variantGlyph = reader.readUint16()
    referencedGlyphIds.add(variantGlyph)
    const advanceMeasurement = reader.readUint16()
    variants.push({ variantGlyph, advanceMeasurement })
  }

  let assembly: GlyphAssembly | null = null
  if (assemblyOffset !== 0) {
    ensureMathSubtableOffset(reader, offset, assemblyOffset, variantsEnd, 6, `${label} glyphAssemblyOffset`)
    const assemblyStart = offset + assemblyOffset
    reader.seek(assemblyStart)
    const italicsCorrection = readMathValueRecord(reader, assemblyStart, `${label} GlyphAssembly italicsCorrection`)
    const partCount = reader.readUint16()
    ensureMathRange(reader, assemblyStart + 6, partCount * 10, `${label} GlyphAssembly part records`)
    const partRecords: GlyphPartRecord[] = []
    for (let i = 0; i < partCount; i++) {
      explicitGlyphOffsets.push(reader.position)
      const glyphId = reader.readUint16()
      referencedGlyphIds.add(glyphId)
      const startConnectorLength = reader.readUint16()
      const endConnectorLength = reader.readUint16()
      const fullAdvance = reader.readUint16()
      const partFlags = reader.readUint16()
      const reservedFlags = partFlags & 0xFFFE
      if (reservedFlags !== 0) {
        throw new Error(`${label} GlyphPart ${i} partFlags contain reserved bits: 0x${reservedFlags.toString(16).padStart(4, '0')}`)
      }
      partRecords.push({ glyphId, startConnectorLength, endConnectorLength, fullAdvance, partFlags })
    }
    assembly = { italicsCorrection, partRecords }
  }

  return { assembly, variants }
}

/**
 * Parse the MATH table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/math
 */
export function parseMath(reader: BinaryReader): MathTable {
  const tableStart = reader.position
  const referencedGlyphIds = new Set<number>()
  const coverageOffsets = new Set<number>()
  const explicitGlyphOffsets: number[] = []
  ensureMathRange(reader, tableStart, MATH_HEADER_SIZE, 'MATH header')
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    throw new Error(`Unsupported MATH table version: ${majorVersion}.${minorVersion}`)
  }
  const mathConstantsOffset = reader.readUint16()
  const mathGlyphInfoOffset = reader.readUint16()
  const mathVariantsOffset = reader.readUint16()

  // --- MathConstants ---
  const constants = new Map<string, number>()
  const constantRecords = new Map<string, MathValueRecord>()
  if (mathConstantsOffset !== 0) {
    ensureMathSubtableOffset(reader, tableStart, mathConstantsOffset, MATH_HEADER_SIZE, MATH_CONSTANTS_SIZE, 'MATH mathConstantsOffset')
    const constantsStart = tableStart + mathConstantsOffset
    reader.seek(constantsStart)
    // First 2 are int16 (percent values), rest are MathValueRecord
    constants.set(MATH_CONSTANT_NAMES[0]!, reader.readInt16()) // scriptPercentScaleDown
    constants.set(MATH_CONSTANT_NAMES[1]!, reader.readInt16()) // scriptScriptPercentScaleDown
    constants.set(MATH_CONSTANT_NAMES[2]!, reader.readUint16()) // delimitedSubFormulaMinHeight
    constants.set(MATH_CONSTANT_NAMES[3]!, reader.readUint16()) // displayOperatorMinHeight

    // Remaining 56 - 4 = 52 are MathValueRecords (except last which is int16)
    for (let i = 4; i < MATH_CONSTANT_NAMES.length - 1; i++) {
      const mvr = readMathValueRecord(reader, constantsStart, `MATH MathConstants ${MATH_CONSTANT_NAMES[i]!}`)
      constants.set(MATH_CONSTANT_NAMES[i]!, mvr.value)
      constantRecords.set(MATH_CONSTANT_NAMES[i]!, mvr)
    }
    // radicalDegreeBottomRaisePercent is int16
    constants.set(MATH_CONSTANT_NAMES[MATH_CONSTANT_NAMES.length - 1]!, reader.readInt16())
  }

  // --- MathGlyphInfo ---
  let italicCorrectionMap: Map<number, MathValueRecord> | null = null
  let topAccentMap: Map<number, MathValueRecord> | null = null
  let extendedShapeSet: Set<number> | null = null
  let mathKernInfoMap: Map<number, {
    readonly topRight: ParsedMathKernRecord | null
    readonly topLeft: ParsedMathKernRecord | null
    readonly bottomRight: ParsedMathKernRecord | null
    readonly bottomLeft: ParsedMathKernRecord | null
  }> | null = null

  if (mathGlyphInfoOffset !== 0) {
    ensureMathSubtableOffset(reader, tableStart, mathGlyphInfoOffset, MATH_HEADER_SIZE, 8, 'MATH mathGlyphInfoOffset')
    const glyphInfoStart = tableStart + mathGlyphInfoOffset
    reader.seek(glyphInfoStart)
    const italicCorrectionInfoOffset = reader.readUint16()
    const topAccentAttachmentOffset = reader.readUint16()
    const extendedShapeCoverageOffset = reader.readUint16()
    const mathKernInfoOffset = reader.readUint16()

    // Italic Correction Info
    if (italicCorrectionInfoOffset !== 0) {
      ensureMathSubtableOffset(reader, glyphInfoStart, italicCorrectionInfoOffset, 8, 4, 'MATH MathGlyphInfo italicCorrectionInfoOffset')
      const absOffset = glyphInfoStart + italicCorrectionInfoOffset
      reader.seek(absOffset)
      const icCoverageOffset = reader.readUint16()
      const icCount = reader.readUint16()
      const icValuesEnd = 4 + icCount * 4
      ensureMathRange(reader, absOffset + 4, icCount * 4, 'MATH MathItalicsCorrectionInfo values')
      ensureMathSubtableOffset(reader, absOffset, icCoverageOffset, icValuesEnd, 4, 'MATH MathItalicsCorrectionInfo coverageOffset')
      const icValues: MathValueRecord[] = []
      for (let i = 0; i < icCount; i++) {
        const mvr = readMathValueRecord(reader, absOffset, `MATH MathItalicsCorrectionInfo value ${i}`)
        icValues.push(mvr)
      }
      const coverageStart = absOffset + icCoverageOffset
      coverageOffsets.add(coverageStart - tableStart)
      const coverageMap = parseCoverageMap(reader, coverageStart)
      for (const glyphId of coverageMap.keys()) referencedGlyphIds.add(glyphId)
      if (coverageMap.size !== icCount) {
        throw new Error(`MATH MathItalicsCorrectionInfo count ${icCount} must match coverage glyph count ${coverageMap.size}`)
      }
      italicCorrectionMap = new Map()
      for (const [gid, idx] of coverageMap) {
        italicCorrectionMap.set(gid, icValues[idx]!)
      }
    }

    // Top Accent Attachment
    if (topAccentAttachmentOffset !== 0) {
      ensureMathSubtableOffset(reader, glyphInfoStart, topAccentAttachmentOffset, 8, 4, 'MATH MathGlyphInfo topAccentAttachmentOffset')
      const absOffset = glyphInfoStart + topAccentAttachmentOffset
      reader.seek(absOffset)
      const taCoverageOffset = reader.readUint16()
      const taCount = reader.readUint16()
      const taValuesEnd = 4 + taCount * 4
      ensureMathRange(reader, absOffset + 4, taCount * 4, 'MATH MathTopAccentAttachment values')
      ensureMathSubtableOffset(reader, absOffset, taCoverageOffset, taValuesEnd, 4, 'MATH MathTopAccentAttachment coverageOffset')
      const taValues: MathValueRecord[] = []
      for (let i = 0; i < taCount; i++) {
        const mvr = readMathValueRecord(reader, absOffset, `MATH MathTopAccentAttachment value ${i}`)
        taValues.push(mvr)
      }
      const coverageStart = absOffset + taCoverageOffset
      coverageOffsets.add(coverageStart - tableStart)
      const coverageMap = parseCoverageMap(reader, coverageStart)
      for (const glyphId of coverageMap.keys()) referencedGlyphIds.add(glyphId)
      if (coverageMap.size !== taCount) {
        throw new Error(`MATH MathTopAccentAttachment count ${taCount} must match coverage glyph count ${coverageMap.size}`)
      }
      topAccentMap = new Map()
      for (const [gid, idx] of coverageMap) {
        topAccentMap.set(gid, taValues[idx]!)
      }
    }

    // Extended Shape Coverage
    if (extendedShapeCoverageOffset !== 0) {
      ensureMathSubtableOffset(reader, glyphInfoStart, extendedShapeCoverageOffset, 8, 4, 'MATH MathGlyphInfo extendedShapeCoverageOffset')
      const coverageStart = glyphInfoStart + extendedShapeCoverageOffset
      coverageOffsets.add(coverageStart - tableStart)
      const coverageMap = parseCoverageMap(reader, coverageStart)
      for (const glyphId of coverageMap.keys()) referencedGlyphIds.add(glyphId)
      extendedShapeSet = new Set(coverageMap.keys())
    }

    // MathKernInfo
    if (mathKernInfoOffset !== 0) {
      ensureMathSubtableOffset(reader, glyphInfoStart, mathKernInfoOffset, 8, 4, 'MATH MathGlyphInfo mathKernInfoOffset')
      const absOffset = glyphInfoStart + mathKernInfoOffset
      reader.seek(absOffset)
      const mkCoverageOffset = reader.readUint16()
      const mkCount = reader.readUint16()
      const kernOffsetsEnd = 4 + mkCount * 8
      ensureMathRange(reader, absOffset + 4, mkCount * 8, 'MATH MathKernInfo offset records')
      ensureMathSubtableOffset(reader, absOffset, mkCoverageOffset, kernOffsetsEnd, 4, 'MATH MathKernInfo coverageOffset')
      // 4 offsets per glyph (topRight, topLeft, bottomRight, bottomLeft)
      const kernOffsets: number[][] = []
      for (let i = 0; i < mkCount; i++) {
        kernOffsets.push([
          reader.readUint16(), reader.readUint16(),
          reader.readUint16(), reader.readUint16(),
        ])
      }
      const coverageStart = absOffset + mkCoverageOffset
      coverageOffsets.add(coverageStart - tableStart)
      const coverageMap = parseCoverageMap(reader, coverageStart)
      for (const glyphId of coverageMap.keys()) referencedGlyphIds.add(glyphId)
      if (coverageMap.size !== mkCount) {
        throw new Error(`MATH MathKernInfo count ${mkCount} must match coverage glyph count ${coverageMap.size}`)
      }
      mathKernInfoMap = new Map()
      for (const [gid, idx] of coverageMap) {
        const offsets = kernOffsets[idx]!
        const info = {
          topRight: offsets[0] !== 0 ? parseMathKernSubtable(reader, absOffset, offsets[0]!, kernOffsetsEnd, `MATH MathKernInfo glyph ${idx} topRight`) : null,
          topLeft: offsets[1] !== 0 ? parseMathKernSubtable(reader, absOffset, offsets[1]!, kernOffsetsEnd, `MATH MathKernInfo glyph ${idx} topLeft`) : null,
          bottomRight: offsets[2] !== 0 ? parseMathKernSubtable(reader, absOffset, offsets[2]!, kernOffsetsEnd, `MATH MathKernInfo glyph ${idx} bottomRight`) : null,
          bottomLeft: offsets[3] !== 0 ? parseMathKernSubtable(reader, absOffset, offsets[3]!, kernOffsetsEnd, `MATH MathKernInfo glyph ${idx} bottomLeft`) : null,
        }
        mathKernInfoMap.set(gid, info)
      }
    }
  }

  // --- MathVariants ---
  let minConnectorOverlap = 0
  let vertConstructionMap: Map<number, GlyphConstruction> | null = null
  let horizConstructionMap: Map<number, GlyphConstruction> | null = null

  if (mathVariantsOffset !== 0) {
    ensureMathSubtableOffset(reader, tableStart, mathVariantsOffset, MATH_HEADER_SIZE, 10, 'MATH mathVariantsOffset')
    const variantsBase = tableStart + mathVariantsOffset
    reader.seek(variantsBase)
    minConnectorOverlap = reader.readUint16()
    const vertGlyphCoverageOffset = reader.readUint16()
    const horizGlyphCoverageOffset = reader.readUint16()
    const vertGlyphCount = reader.readUint16()
    const horizGlyphCount = reader.readUint16()
    const constructionOffsetsEnd = 10 + (vertGlyphCount + horizGlyphCount) * 2
    ensureMathRange(reader, variantsBase + 10, (vertGlyphCount + horizGlyphCount) * 2, 'MATH MathVariants construction offsets')

    // Construction offsets (from mathVariantsOffset)
    const vertConstructionOffsets: number[] = []
    const horizConstructionOffsets: number[] = []
    for (let i = 0; i < vertGlyphCount; i++) {
      vertConstructionOffsets.push(reader.readUint16())
    }
    for (let i = 0; i < horizGlyphCount; i++) {
      horizConstructionOffsets.push(reader.readUint16())
    }

    if (vertGlyphCount === 0 && vertGlyphCoverageOffset !== 0) {
      throw new Error(`MATH MathVariants vertGlyphCoverageOffset must be 0 when vertGlyphCount is 0, got ${vertGlyphCoverageOffset}`)
    }
    if (vertGlyphCount > 0 && vertGlyphCoverageOffset === 0) {
      throw new Error('MATH MathVariants vertGlyphCoverageOffset must be non-zero when vertGlyphCount is greater than 0')
    }
    if (horizGlyphCount === 0 && horizGlyphCoverageOffset !== 0) {
      throw new Error(`MATH MathVariants horizGlyphCoverageOffset must be 0 when horizGlyphCount is 0, got ${horizGlyphCoverageOffset}`)
    }
    if (horizGlyphCount > 0 && horizGlyphCoverageOffset === 0) {
      throw new Error('MATH MathVariants horizGlyphCoverageOffset must be non-zero when horizGlyphCount is greater than 0')
    }

    if (vertGlyphCoverageOffset !== 0) {
      ensureMathSubtableOffset(reader, variantsBase, vertGlyphCoverageOffset, constructionOffsetsEnd, 4, 'MATH MathVariants vertGlyphCoverageOffset')
      const coverageStart = variantsBase + vertGlyphCoverageOffset
      coverageOffsets.add(coverageStart - tableStart)
      const vertGlyphMap = parseCoverageMap(reader, coverageStart)
      for (const glyphId of vertGlyphMap.keys()) referencedGlyphIds.add(glyphId)
      if (vertGlyphMap.size !== vertGlyphCount) {
        throw new Error(`MATH MathVariants vertGlyphCount ${vertGlyphCount} must match coverage glyph count ${vertGlyphMap.size}`)
      }
      vertConstructionMap = parseMathVariantConstructions(
        reader, variantsBase, constructionOffsetsEnd, vertGlyphMap, vertConstructionOffsets,
        'MATH MathVariants vertical', referencedGlyphIds, explicitGlyphOffsets,
      )
    }
    if (horizGlyphCoverageOffset !== 0) {
      ensureMathSubtableOffset(reader, variantsBase, horizGlyphCoverageOffset, constructionOffsetsEnd, 4, 'MATH MathVariants horizGlyphCoverageOffset')
      const coverageStart = variantsBase + horizGlyphCoverageOffset
      coverageOffsets.add(coverageStart - tableStart)
      const horizGlyphMap = parseCoverageMap(reader, coverageStart)
      for (const glyphId of horizGlyphMap.keys()) referencedGlyphIds.add(glyphId)
      if (horizGlyphMap.size !== horizGlyphCount) {
        throw new Error(`MATH MathVariants horizGlyphCount ${horizGlyphCount} must match coverage glyph count ${horizGlyphMap.size}`)
      }
      horizConstructionMap = parseMathVariantConstructions(
        reader, variantsBase, constructionOffsetsEnd, horizGlyphMap, horizConstructionOffsets,
        'MATH MathVariants horizontal', referencedGlyphIds, explicitGlyphOffsets,
      )
    }
  }

  const valueRecords: MathValueRecord[] = []
  const seenValueOffsets = new Set<number>()
  for (const record of constantRecords.values()) addMathValueRecord(record, valueRecords, seenValueOffsets)
  if (italicCorrectionMap !== null) for (const record of italicCorrectionMap.values()) addMathValueRecord(record, valueRecords, seenValueOffsets)
  if (topAccentMap !== null) for (const record of topAccentMap.values()) addMathValueRecord(record, valueRecords, seenValueOffsets)
  if (mathKernInfoMap !== null) for (const info of mathKernInfoMap.values()) {
    addMathKernValueRecords(info.topRight, valueRecords, seenValueOffsets)
    addMathKernValueRecords(info.topLeft, valueRecords, seenValueOffsets)
    addMathKernValueRecords(info.bottomRight, valueRecords, seenValueOffsets)
    addMathKernValueRecords(info.bottomLeft, valueRecords, seenValueOffsets)
  }
  collectConstructionValueRecords(vertConstructionMap, valueRecords, seenValueOffsets)
  collectConstructionValueRecords(horizConstructionMap, valueRecords, seenValueOffsets)

  return {
    subsetData: { referencedGlyphIds, coverageOffsets, explicitGlyphOffsets, valueRecords },
    constants,

    getConstant(name: string, context?: MathValueContext): number {
      const record = constantRecords.get(name)
      return record === undefined ? constants.get(name) ?? 0 : resolveMathValue(record, context)
    },

    resolveValue(record: MathValueRecord, context?: MathValueContext): number {
      return resolveMathValue(record, context)
    },

    getItalicCorrection(glyphId: number, context?: MathValueContext): number {
      const record = italicCorrectionMap?.get(glyphId)
      return record === undefined ? 0 : resolveMathValue(record, context)
    },

    getTopAccentAttachment(glyphId: number, context?: MathValueContext): number {
      const record = topAccentMap?.get(glyphId)
      return record === undefined ? 0 : resolveMathValue(record, context)
    },

    isExtendedShape(glyphId: number): boolean {
      return extendedShapeSet?.has(glyphId) ?? false
    },

    getMathKernInfo(glyphId: number, context?: MathValueContext): MathKernInfo | null {
      const info = mathKernInfoMap?.get(glyphId)
      if (info === undefined) return null
      return {
        topRight: resolveMathKernRecord(info.topRight, context),
        topLeft: resolveMathKernRecord(info.topLeft, context),
        bottomRight: resolveMathKernRecord(info.bottomRight, context),
        bottomLeft: resolveMathKernRecord(info.bottomLeft, context),
      }
    },

    getVerticalVariants(glyphId: number): readonly MathGlyphVariantRecord[] {
      return vertConstructionMap?.get(glyphId)?.variants ?? []
    },

    getHorizontalVariants(glyphId: number): readonly MathGlyphVariantRecord[] {
      return horizConstructionMap?.get(glyphId)?.variants ?? []
    },

    getVerticalAssembly(glyphId: number): GlyphAssembly | null {
      return vertConstructionMap?.get(glyphId)?.assembly ?? null
    },

    getHorizontalAssembly(glyphId: number): GlyphAssembly | null {
      return horizConstructionMap?.get(glyphId)?.assembly ?? null
    },

    minConnectorOverlap,
  }
}

function resolveMathValue(record: MathValueRecord, context?: MathValueContext): number {
  if (record.device === null || context === undefined) return record.value
  if (record.device.isVariation) {
    const coords = context.normalizedCoords
    const gdef = context.gdef
    return coords === undefined || gdef === undefined || gdef === null
      ? record.value
      : record.value + gdef.getVarDelta(record.device.first, record.device.second, coords)
  }
  if (context.ppem === undefined) return record.value
  return record.value + resolveDeviceDelta(record.device, context.ppem) * context.unitsPerEm / context.ppem
}

function resolveMathKernRecord(
  record: ParsedMathKernRecord | null,
  context?: MathValueContext,
): MathKernRecord | null {
  if (record === null) return null
  const heights = new Array<number>(record.heights.length)
  const kerns = new Array<number>(record.kerns.length)
  for (let i = 0; i < heights.length; i++) heights[i] = resolveMathValue(record.heights[i]!, context)
  for (let i = 0; i < kerns.length; i++) kerns[i] = resolveMathValue(record.kerns[i]!, context)
  return { heights, kerns }
}

function parseMathKernSubtable(
  reader: BinaryReader,
  parentOffset: number,
  offset: number,
  minimumOffset: number,
  label: string,
): ParsedMathKernRecord {
  ensureMathSubtableOffset(reader, parentOffset, offset, minimumOffset, 2, `${label} offset`)
  return parseMathKernTable(reader, parentOffset + offset, label)
}

function parseMathVariantConstructions(
  reader: BinaryReader,
  variantsBase: number,
  minimumOffset: number,
  coverageMap: Map<number, number>,
  constructionOffsets: number[],
  label: string,
  referencedGlyphIds: Set<number>,
  explicitGlyphOffsets: number[],
): Map<number, GlyphConstruction> {
  const constructions = new Map<number, GlyphConstruction>()
  for (const [glyphId, idx] of coverageMap) {
    const offset = constructionOffsets[idx]!
    ensureMathSubtableOffset(reader, variantsBase, offset, minimumOffset, 4, `${label} constructionOffset ${idx}`)
    constructions.set(glyphId, parseGlyphConstruction(
      reader,
      variantsBase + offset,
      `${label} construction ${idx}`,
      referencedGlyphIds,
      explicitGlyphOffsets,
    ))
  }
  return constructions
}

/** Rebuilds all MATH glyph references for a compact, monotonic glyph mapping. */
export function buildCompactMathTable(
  reader: BinaryReader,
  oldToNew: ReadonlyMap<number, number>,
  variation?: { readonly coords: number[], readonly gdef: GdefTable },
): Uint8Array {
  const tableStart = reader.position
  const math = parseMath(reader)
  const data = new Uint8Array(reader.length - tableStart)
  for (let i = 0; i < data.length; i++) data[i] = reader.getUint8At(tableStart + i)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (const coverageOffset of math.subsetData.coverageOffsets) {
    remapMathCoverage(reader, tableStart + coverageOffset, view, coverageOffset, oldToNew)
  }
  for (let i = 0; i < math.subsetData.explicitGlyphOffsets.length; i++) {
    const sourceOffset = math.subsetData.explicitGlyphOffsets[i]!
    const oldGlyphId = reader.getUint16At(sourceOffset)
    const newGlyphId = oldToNew.get(oldGlyphId)
    if (newGlyphId === undefined) throw new Error(`MATH compact subset lost referenced glyph ${oldGlyphId}`)
    view.setUint16(sourceOffset - tableStart, newGlyphId, false)
  }
  if (variation !== undefined) {
    for (let i = 0; i < math.subsetData.valueRecords.length; i++) {
      const record = math.subsetData.valueRecords[i]!
      if (record.device?.isVariation !== true) continue
      const targetOffset = record.sourceOffset - tableStart
      const value = record.value + variation.gdef.getVarDelta(
        record.device.first, record.device.second, variation.coords,
      )
      view.setInt16(targetOffset, Math.round(value), false)
      view.setUint16(targetOffset + 2, 0, false)
    }
  }
  return data
}

function addMathValueRecord(record: MathValueRecord, target: MathValueRecord[], seen: Set<number>): void {
  if (seen.has(record.sourceOffset)) return
  seen.add(record.sourceOffset)
  target.push(record)
}

function addMathKernValueRecords(
  record: ParsedMathKernRecord | null,
  target: MathValueRecord[],
  seen: Set<number>,
): void {
  if (record === null) return
  for (let i = 0; i < record.heights.length; i++) addMathValueRecord(record.heights[i]!, target, seen)
  for (let i = 0; i < record.kerns.length; i++) addMathValueRecord(record.kerns[i]!, target, seen)
}

function collectConstructionValueRecords(
  constructions: Map<number, GlyphConstruction> | null,
  target: MathValueRecord[],
  seen: Set<number>,
): void {
  if (constructions === null) return
  for (const construction of constructions.values()) {
    if (construction.assembly !== null) addMathValueRecord(construction.assembly.italicsCorrection, target, seen)
  }
}

function remapMathCoverage(
  reader: BinaryReader,
  sourceOffset: number,
  target: DataView,
  targetOffset: number,
  oldToNew: ReadonlyMap<number, number>,
): void {
  const format = reader.getUint16At(sourceOffset)
  const count = reader.getUint16At(sourceOffset + 2)
  if (format === 1) {
    for (let i = 0; i < count; i++) {
      const oldGlyphId = reader.getUint16At(sourceOffset + 4 + i * 2)
      const newGlyphId = oldToNew.get(oldGlyphId)
      if (newGlyphId === undefined) throw new Error(`MATH compact subset lost coverage glyph ${oldGlyphId}`)
      target.setUint16(targetOffset + 4 + i * 2, newGlyphId, false)
    }
    return
  }
  if (format !== 2) throw new Error(`Unsupported MATH Coverage format: ${format}`)
  for (let i = 0; i < count; i++) {
    const recordOffset = sourceOffset + 4 + i * 6
    const oldStart = reader.getUint16At(recordOffset)
    const oldEnd = reader.getUint16At(recordOffset + 2)
    const newStart = oldToNew.get(oldStart)
    const newEnd = oldToNew.get(oldEnd)
    if (newStart === undefined || newEnd === undefined) {
      throw new Error(`MATH compact subset lost coverage range ${oldStart}-${oldEnd}`)
    }
    target.setUint16(targetOffset + 4 + i * 6, newStart, false)
    target.setUint16(targetOffset + 6 + i * 6, newEnd, false)
  }
}

function ensureMathSubtableOffset(
  reader: BinaryReader,
  parentOffset: number,
  offset: number,
  minimumOffset: number,
  minimumLength: number,
  label: string,
): void {
  if (offset < minimumOffset) {
    throw new Error(`${label} must be at least ${minimumOffset}, got ${offset}`)
  }
  ensureMathRange(reader, parentOffset + offset, minimumLength, label)
}

function ensureMathOffset(
  reader: BinaryReader,
  parentOffset: number,
  offset: number,
  minimumLength: number,
  label: string,
): void {
  ensureMathRange(reader, parentOffset + offset, minimumLength, label)
}

function ensureMathRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds table length: need ${offset + length}, got ${reader.length}`)
  }
}
