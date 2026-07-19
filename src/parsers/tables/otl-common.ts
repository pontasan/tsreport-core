import { BinaryReader } from '../../binary/reader.js'
import { BinaryWriter } from '../../binary/writer.js'
import type { GdefTable } from './gdef.js'

/**
 * OpenType Layout common infrastructure
 * Parsers for the Coverage, ClassDef, Script/Feature/Lookup, and
 * Device/VariationIndex tables shared by GSUB/GPOS
 */

// --- LookupFlag ---

/** LookupFlag bit values */
export const enum LookupFlag {
  RightToLeft = 0x0001,
  IgnoreBaseGlyphs = 0x0002,
  IgnoreLigatures = 0x0004,
  IgnoreMarks = 0x0008,
  UseMarkFilteringSet = 0x0010,
  MarkAttachmentTypeMask = 0xFF00,
}

/**
 * Whether a lookup must skip the given glyph, according to its lookupFlag,
 * markFilteringSet and the GDEF glyph classification.
 * Without GDEF glyph classes the flag bits have no effect (per spec the
 * ignore bits operate on GDEF classes).
 */
export function lookupIgnoresGlyph(
  flag: number,
  markFilteringSet: number | undefined,
  gdef: GdefTable | null,
  glyphId: number,
): boolean {
  if (gdef === null || (flag & 0xFF1E) === 0) return false
  const cls = gdef.getGlyphClass(glyphId)
  if (cls === 1) return (flag & LookupFlag.IgnoreBaseGlyphs) !== 0
  if (cls === 2) return (flag & LookupFlag.IgnoreLigatures) !== 0
  if (cls === 3) {
    if (flag & LookupFlag.IgnoreMarks) return true
    if ((flag & LookupFlag.UseMarkFilteringSet) && markFilteringSet !== undefined) {
      return !gdef.isMarkInSet(glyphId, markFilteringSet)
    }
    const attachType = flag >> 8
    if (attachType !== 0) return gdef.getMarkAttachClass(glyphId) !== attachType
  }
  return false
}

/**
 * Next glyph index at or after `from` that the lookup does not skip.
 * @returns the index, or glyphs.length when none remains
 */
export function nextNonIgnored(
  glyphs: number[],
  from: number,
  flag: number,
  markFilteringSet: number | undefined,
  gdef: GdefTable | null,
): number {
  let i = from
  while (i < glyphs.length && lookupIgnoresGlyph(flag, markFilteringSet, gdef, glyphs[i]!)) i++
  return i
}

/**
 * Previous glyph index at or before `from` that the lookup does not skip.
 * @returns the index, or -1 when none remains
 */
export function prevNonIgnored(
  glyphs: number[],
  from: number,
  flag: number,
  markFilteringSet: number | undefined,
  gdef: GdefTable | null,
): number {
  let i = from
  while (i >= 0 && lookupIgnoresGlyph(flag, markFilteringSet, gdef, glyphs[i]!)) i--
  return i
}

// --- Coverage ---

/**
 * Parse a Coverage table
 * @returns array of glyph IDs (in coverageIndex order)
 */
export function parseCoverage(reader: BinaryReader, offset: number): number[] {
  reader.seek(offset)
  const format = reader.readUint16()
  const glyphs: number[] = []

  if (format === 1) {
    const glyphCount = reader.readUint16()
    // The spec requires strictly increasing glyph IDs, but some shipping fonts
    // (Gujarati Sangam MN, NotoSansSiddham) violate this; the coverage index is
    // simply the position, so trust the data rather than reject the font.
    for (let i = 0; i < glyphCount; i++) {
      glyphs.push(reader.readUint16())
    }
  } else if (format === 2) {
    const rangeCount = reader.readUint16()
    let expectedCoverageIndex = 0
    let previousEndGlyph = -1
    for (let i = 0; i < rangeCount; i++) {
      const startGlyph = reader.readUint16()
      const endGlyph = reader.readUint16()
      const startCoverageIndex = reader.readUint16()
      if (startGlyph > endGlyph) {
        throw new Error(`Coverage format 2 range ${i} has startGlyph greater than endGlyph`)
      }
      if (startGlyph <= previousEndGlyph) {
        throw new Error(`Coverage format 2 range ${i} overlaps or is out of order`)
      }
      if (startCoverageIndex !== expectedCoverageIndex) {
        throw new Error(`Coverage format 2 range ${i} startCoverageIndex ${startCoverageIndex} does not match expected ${expectedCoverageIndex}`)
      }
      for (let g = startGlyph; g <= endGlyph; g++) {
        glyphs.push(g)
      }
      expectedCoverageIndex += endGlyph - startGlyph + 1
      previousEndGlyph = endGlyph
    }
  } else {
    throw new Error(`Unsupported Coverage table format: ${format}`)
  }

  return glyphs
}

/**
 * Build a glyph ID set from a Coverage table
 * @returns map of glyphId → coverageIndex
 */
export function parseCoverageMap(reader: BinaryReader, offset: number): Map<number, number> {
  reader.seek(offset)
  const format = reader.readUint16()
  const map = new Map<number, number>()

  if (format === 1) {
    const glyphCount = reader.readUint16()
    // Strictly-increasing order is not enforced (see parseCoverage); the
    // coverage index is the position in the list.
    for (let i = 0; i < glyphCount; i++) {
      map.set(reader.readUint16(), i)
    }
  } else if (format === 2) {
    const rangeCount = reader.readUint16()
    let expectedCoverageIndex = 0
    let previousEndGlyph = -1
    for (let i = 0; i < rangeCount; i++) {
      const startGlyph = reader.readUint16()
      const endGlyph = reader.readUint16()
      const startCoverageIndex = reader.readUint16()
      if (startGlyph > endGlyph) {
        throw new Error(`Coverage format 2 range ${i} has startGlyph greater than endGlyph`)
      }
      if (startGlyph <= previousEndGlyph) {
        throw new Error(`Coverage format 2 range ${i} overlaps or is out of order`)
      }
      if (startCoverageIndex !== expectedCoverageIndex) {
        throw new Error(`Coverage format 2 range ${i} startCoverageIndex ${startCoverageIndex} does not match expected ${expectedCoverageIndex}`)
      }
      for (let g = startGlyph; g <= endGlyph; g++) {
        map.set(g, startCoverageIndex + (g - startGlyph))
      }
      expectedCoverageIndex += endGlyph - startGlyph + 1
      previousEndGlyph = endGlyph
    }
  } else {
    throw new Error(`Unsupported Coverage table format: ${format}`)
  }

  return map
}

// --- ClassDef ---

/**
 * Parses a ClassDef referenced by a relative offset from `base`. A zero offset
 * means the ClassDef is absent (every glyph is class 0), which is common for
 * the backtrack/lookahead ClassDefs of context/chain-context lookups; return an
 * empty map rather than misreading the containing table's header.
 */
export function parseClassDefOrEmpty(reader: BinaryReader, base: number, relativeOffset: number): Map<number, number> {
  if (relativeOffset === 0) return new Map<number, number>()
  return parseClassDef(reader, base + relativeOffset)
}

/**
 * Parse a ClassDef table
 * @returns map of glyphId → classValue (class 0 is not included)
 */
export function parseClassDef(reader: BinaryReader, offset: number): Map<number, number> {
  reader.seek(offset)
  const format = reader.readUint16()
  const classDef = new Map<number, number>()

  if (format === 1) {
    const startGlyph = reader.readUint16()
    const glyphCount = reader.readUint16()
    for (let i = 0; i < glyphCount; i++) {
      const cls = reader.readUint16()
      if (cls !== 0) classDef.set(startGlyph + i, cls)
    }
  } else if (format === 2) {
    const classRangeCount = reader.readUint16()
    for (let i = 0; i < classRangeCount; i++) {
      const startGlyph = reader.readUint16()
      const endGlyph = reader.readUint16()
      const cls = reader.readUint16()
      // Degenerate ranges (start > end) cover no glyphs; real fonts (e.g.
      // NotoNastaliq, NotoSansMyanmar) include them, so skip rather than reject.
      if (startGlyph > endGlyph) continue
      // The spec requires ascending non-overlapping ranges, but many shipping
      // fonts violate this harmlessly; trust the data (later ranges win) rather
      // than reject the font.
      for (let g = startGlyph; g <= endGlyph; g++) {
        classDef.set(g, cls)
      }
    }
  } else {
    throw new Error(`Unsupported ClassDef table format: ${format}`)
  }

  return classDef
}

// --- Device / VariationIndex ---

/**
 * A Device or VariationIndex table parsed eagerly so it can be resolved at
 * application time without the source reader.
 */
export interface ParsedDevice {
  /** true = VariationIndex (deltaFormat 0x8000), false = ppem-based Device */
  isVariation: boolean
  /** VariationIndex: outer index / Device: startSize */
  first: number
  /** VariationIndex: inner index / Device: endSize */
  second: number
  /** Device only: 1=2-bit, 2=4-bit, 3=8-bit signed deltas */
  deltaFormat: number
  /** Device only: packed delta words */
  words: Uint16Array | null
}

/** Parse a Device or VariationIndex table at an absolute offset. */
export function parseDeviceTable(reader: BinaryReader, offset: number): ParsedDevice {
  const saved = reader.position
  reader.seek(offset)
  const first = reader.readUint16()
  const second = reader.readUint16()
  const deltaFormat = reader.readUint16()

  if (deltaFormat === 0x8000) {
    reader.seek(saved)
    return { isVariation: true, first, second, deltaFormat, words: null }
  }
  if (deltaFormat < 1 || deltaFormat > 3) {
    throw new Error(`Unsupported Device table deltaFormat: ${deltaFormat}`)
  }
  if (second < first) {
    throw new Error(`Device table endSize ${second} precedes startSize ${first}`)
  }

  // deltaFormat 1=2bit, 2=4bit, 3=8bit → values per uint16 word: 8 / 4 / 2
  const count = second - first + 1
  const perWord = 1 << (4 - deltaFormat)
  const wordCount = count > 0 ? Math.ceil(count / perWord) : 0
  const words = new Uint16Array(wordCount)
  for (let i = 0; i < wordCount; i++) {
    words[i] = reader.readUint16()
  }
  reader.seek(saved)
  return { isVariation: false, first, second, deltaFormat, words }
}

/**
 * Resolve a ppem-based Device delta from a parsed table.
 * Returns 0 outside the size range or when no ppem is given.
 */
export function resolveDeviceDelta(dev: ParsedDevice, ppem: number | undefined): number {
  if (dev.isVariation || dev.words === null || ppem === undefined) return 0
  if (ppem < dev.first || ppem > dev.second) return 0
  const idx = ppem - dev.first
  if (dev.deltaFormat === 1) {
    const word = dev.words[idx >> 3]!
    const shift = 14 - (idx & 7) * 2
    return ((word >> shift) & 3) << 30 >> 30 // sign-extend 2-bit
  } else if (dev.deltaFormat === 2) {
    const word = dev.words[idx >> 2]!
    const shift = 12 - (idx & 3) * 4
    return ((word >> shift) & 0xF) << 28 >> 28 // sign-extend 4-bit
  } else if (dev.deltaFormat === 3) {
    const word = dev.words[idx >> 1]!
    const shift = 8 - (idx & 1) * 8
    return ((word >> shift) & 0xFF) << 24 >> 24 // sign-extend 8-bit
  }
  return 0
}

// --- ValueRecord ---

/** ValueRecord fields */
export interface ValueRecord {
  xPlacement: number
  yPlacement: number
  xAdvance: number
  yAdvance: number
  /** Device / VariationIndex tables (parsed eagerly; null when absent) */
  xPlaDevice?: ParsedDevice | null
  yPlaDevice?: ParsedDevice | null
  xAdvDevice?: ParsedDevice | null
  yAdvDevice?: ParsedDevice | null
}

/** Compute the byte size from a ValueFormat */
export function valueFormatSize(format: number): number {
  validateValueFormat(format)
  let size = 0
  for (let i = 0; i < 8; i++) {
    if (format & (1 << i)) size += 2
  }
  return size
}

/**
 * Read a ValueRecord.
 * When `subtableStart` is given, Device / VariationIndex offsets are resolved
 * against it and parsed eagerly; otherwise the offsets are skipped.
 */
export function readValueRecord(reader: BinaryReader, valueFormat: number, subtableStart?: number): ValueRecord {
  validateValueFormat(valueFormat)
  let xPlacement = 0, yPlacement = 0, xAdvance = 0, yAdvance = 0
  if (valueFormat & 0x0001) xPlacement = reader.readInt16()
  if (valueFormat & 0x0002) yPlacement = reader.readInt16()
  if (valueFormat & 0x0004) xAdvance = reader.readInt16()
  if (valueFormat & 0x0008) yAdvance = reader.readInt16()

  if ((valueFormat & 0x00F0) === 0) {
    return { xPlacement, yPlacement, xAdvance, yAdvance }
  }

  let xPlaDevice: ParsedDevice | null = null
  let yPlaDevice: ParsedDevice | null = null
  let xAdvDevice: ParsedDevice | null = null
  let yAdvDevice: ParsedDevice | null = null
  if (valueFormat & 0x0010) {
    const off = reader.readUint16()
    if (off !== 0 && subtableStart !== undefined) xPlaDevice = parseDeviceTable(reader, subtableStart + off)
  }
  if (valueFormat & 0x0020) {
    const off = reader.readUint16()
    if (off !== 0 && subtableStart !== undefined) yPlaDevice = parseDeviceTable(reader, subtableStart + off)
  }
  if (valueFormat & 0x0040) {
    const off = reader.readUint16()
    if (off !== 0 && subtableStart !== undefined) xAdvDevice = parseDeviceTable(reader, subtableStart + off)
  }
  if (valueFormat & 0x0080) {
    const off = reader.readUint16()
    if (off !== 0 && subtableStart !== undefined) yAdvDevice = parseDeviceTable(reader, subtableStart + off)
  }
  return { xPlacement, yPlacement, xAdvance, yAdvance, xPlaDevice, yPlaDevice, xAdvDevice, yAdvDevice }
}

function validateValueFormat(format: number): void {
  if ((format & 0xFF00) !== 0) {
    throw new Error(`Unsupported ValueFormat reserved bits: 0x${(format & 0xFF00).toString(16).padStart(4, '0')}`)
  }
}

/** Skip a ValueRecord */
export function skipValueRecord(reader: BinaryReader, size: number): void {
  reader.skip(size)
}

// --- Script/Feature/Lookup traversal ---

/** Lookup info */
export interface LookupInfo {
  type: number
  flag: number
  subtableOffsets: number[] // absolute offset of each subtable
  markFilteringSet?: number
}

export interface FeatureVariationsTable {
  records: FeatureVariationRecord[]
}

export interface FeatureVariationRecord {
  conditionSet: FeatureVariationConditionSet | null
  substitution: FeatureTableSubstitution | null
}

export interface FeatureVariationConditionSet {
  conditions: FeatureVariationCondition[]
}

export interface FeatureVariationCondition {
  axisIndex: number
  minValue: number
  maxValue: number
}

export interface FeatureTableSubstitution {
  substitutions: FeatureTableSubstitutionRecord[]
}

export interface FeatureTableSubstitutionRecord {
  featureIndex: number
  alternateFeatureOffset: number
}

/** Parameters of the registered optical-size feature. Values are in decipoints. */
export interface DesignSizeFeatureParams {
  kind: 'size'
  designSize: number
  subfamilyId: number
  subfamilyNameId: number
  rangeStart: number
  rangeEnd: number
}

/** Parameters of a registered stylistic-set feature (ss01 through ss20). */
export interface StylisticSetFeatureParams {
  kind: 'stylistic-set'
  version: 0
  uiNameId: number
}

/** Parameters of a registered character-variant feature (cv01 through cv99). */
export interface CharacterVariantFeatureParams {
  kind: 'character-variant'
  format: 0
  uiLabelNameId: number
  tooltipNameId: number
  sampleTextNameId: number
  namedParameterCount: number
  firstParameterUiLabelNameId: number
  characters: number[]
}

export type OpenTypeFeatureParams =
  | DesignSizeFeatureParams
  | StylisticSetFeatureParams
  | CharacterVariantFeatureParams

/** One FeatureList record after FeatureVariations selection. */
export interface OpenTypeLayoutFeatureRecord {
  featureIndex: number
  tag: string
  lookupIndices: number[]
  params: OpenTypeFeatureParams | null
}

/**
 * Parses all FeatureList records and resolves the first matching
 * FeatureVariations substitution for the supplied normalized coordinates.
 */
export function getOpenTypeFeatureRecords(
  reader: BinaryReader,
  tableStart: number,
  featureListOffset: number,
  lookupCount?: number,
  featureVariations?: FeatureVariationsTable | null,
  normalizedCoords?: number[] | null,
): OpenTypeLayoutFeatureRecord[] {
  const savedPos = reader.position
  if (featureListOffset === 0) return []
  const featureListBase = tableStart + featureListOffset
  reader.seek(featureListBase)
  const featureCount = reader.readUint16()
  const records = new Array<{ tag: string, offset: number }>(featureCount)
  for (let i = 0; i < featureCount; i++) {
    records[i] = { tag: reader.readTag(), offset: reader.readUint16() }
  }
  const substitution = resolveFeatureVariationSubstitution(
    featureVariations ?? null,
    normalizedCoords ?? null,
  )
  const result = new Array<OpenTypeLayoutFeatureRecord>(featureCount)
  for (let i = 0; i < featureCount; i++) {
    const record = records[i]!
    const featureOffset = substitution?.get(i) ?? featureListBase + record.offset
    result[i] = readOpenTypeFeatureRecord(reader, featureOffset, i, record.tag, lookupCount)
  }
  reader.seek(savedPos)
  return result
}

/** Serializes the ScriptList without retaining unrelated source-table bytes. */
export function buildStaticScriptList(
  reader: BinaryReader,
  scriptListOffset: number,
  featureCount: number,
): Uint8Array | null {
  if (scriptListOffset === 0) return null
  const savedPos = reader.position
  reader.seek(scriptListOffset)
  const scriptCount = reader.readUint16()
  const scriptRecords = new Array<{ tag: string, offset: number }>(scriptCount)
  for (let i = 0; i < scriptCount; i++) {
    scriptRecords[i] = { tag: reader.readTag(), offset: reader.readUint16() }
  }
  const scripts = new Array<{
    defaultLanguage: StaticLanguageSystem | null
    languages: Array<{ tag: string, system: StaticLanguageSystem }>
  }>(scriptCount)
  for (let scriptIndex = 0; scriptIndex < scriptCount; scriptIndex++) {
    const scriptBase = scriptListOffset + scriptRecords[scriptIndex]!.offset
    reader.seek(scriptBase)
    const defaultLanguageOffset = reader.readUint16()
    const languageCount = reader.readUint16()
    const languageRecords = new Array<{ tag: string, offset: number }>(languageCount)
    for (let languageIndex = 0; languageIndex < languageCount; languageIndex++) {
      languageRecords[languageIndex] = { tag: reader.readTag(), offset: reader.readUint16() }
    }
    scripts[scriptIndex] = {
      defaultLanguage: defaultLanguageOffset === 0
        ? null
        : readStaticLanguageSystem(reader, scriptBase + defaultLanguageOffset, featureCount),
      languages: languageRecords.map(function (record) {
        return { tag: record.tag, system: readStaticLanguageSystem(reader, scriptBase + record.offset, featureCount) }
      }),
    }
  }

  const writer = new BinaryWriter()
  writer.writeUint16(scriptCount)
  const scriptOffsetPositions = new Array<number>(scriptCount)
  for (let i = 0; i < scriptCount; i++) {
    writer.writeTag(scriptRecords[i]!.tag)
    scriptOffsetPositions[i] = writer.position
    writer.writeUint16(0)
  }
  for (let scriptIndex = 0; scriptIndex < scripts.length; scriptIndex++) {
    const scriptStart = writer.position
    patchWriterUint16(writer, scriptOffsetPositions[scriptIndex]!, scriptStart)
    const script = scripts[scriptIndex]!
    const defaultOffsetPosition = writer.position
    writer.writeUint16(0)
    writer.writeUint16(script.languages.length)
    const languageOffsetPositions = new Array<number>(script.languages.length)
    for (let languageIndex = 0; languageIndex < script.languages.length; languageIndex++) {
      writer.writeTag(script.languages[languageIndex]!.tag)
      languageOffsetPositions[languageIndex] = writer.position
      writer.writeUint16(0)
    }
    if (script.defaultLanguage !== null) {
      patchWriterUint16(writer, defaultOffsetPosition, writer.position - scriptStart)
      writeStaticLanguageSystem(writer, script.defaultLanguage)
    }
    for (let languageIndex = 0; languageIndex < script.languages.length; languageIndex++) {
      patchWriterUint16(writer, languageOffsetPositions[languageIndex]!, writer.position - scriptStart)
      writeStaticLanguageSystem(writer, script.languages[languageIndex]!.system)
    }
  }
  reader.seek(savedPos)
  return writer.toUint8Array()
}

interface StaticLanguageSystem {
  requiredFeatureIndex: number
  featureIndices: number[]
}

function readStaticLanguageSystem(
  reader: BinaryReader,
  offset: number,
  featureCount: number,
): StaticLanguageSystem {
  reader.seek(offset)
  const lookupOrderOffset = reader.readUint16()
  if (lookupOrderOffset !== 0) throw new Error(`LangSys lookupOrderOffset must be 0, got ${lookupOrderOffset}`)
  const requiredFeatureIndex = reader.readUint16()
  if (requiredFeatureIndex !== 0xFFFF && requiredFeatureIndex >= featureCount) {
    throw new Error(`LangSys requiredFeatureIndex ${requiredFeatureIndex} out of FeatureList range ${featureCount}`)
  }
  const featureIndexCount = reader.readUint16()
  const featureIndices = new Array<number>(featureIndexCount)
  for (let i = 0; i < featureIndexCount; i++) {
    const featureIndex = reader.readUint16()
    if (featureIndex >= featureCount) {
      throw new Error(`LangSys feature index ${featureIndex} out of FeatureList range ${featureCount}`)
    }
    featureIndices[i] = featureIndex
  }
  return { requiredFeatureIndex, featureIndices }
}

function writeStaticLanguageSystem(writer: BinaryWriter, language: StaticLanguageSystem): void {
  writer.writeUint16(0)
  writer.writeUint16(language.requiredFeatureIndex)
  writer.writeUint16(language.featureIndices.length)
  for (let i = 0; i < language.featureIndices.length; i++) writer.writeUint16(language.featureIndices[i]!)
}

/** Validates the default FeatureList and every alternate Feature table. */
export function validateOpenTypeFeatureRecords(
  reader: BinaryReader,
  tableStart: number,
  featureListOffset: number,
  lookupCount?: number,
  featureVariations?: FeatureVariationsTable | null,
): void {
  const records = getOpenTypeFeatureRecords(
    reader, tableStart, featureListOffset, lookupCount, null, null,
  )
  if (featureVariations === null || featureVariations === undefined) return
  for (let recordIndex = 0; recordIndex < featureVariations.records.length; recordIndex++) {
    const substitution = featureVariations.records[recordIndex]!.substitution
    if (substitution === null) continue
    for (let substitutionIndex = 0; substitutionIndex < substitution.substitutions.length; substitutionIndex++) {
      const alternate = substitution.substitutions[substitutionIndex]!
      const source = records[alternate.featureIndex]
      if (source === undefined) {
        throw new Error(`FeatureTableSubstitution feature index ${alternate.featureIndex} is outside FeatureList`)
      }
      readOpenTypeFeatureRecord(
        reader,
        alternate.alternateFeatureOffset,
        alternate.featureIndex,
        source.tag,
        lookupCount,
      )
    }
  }
}

function readOpenTypeFeatureRecord(
  reader: BinaryReader,
  offset: number,
  featureIndex: number,
  tag: string,
  lookupCount?: number,
): OpenTypeLayoutFeatureRecord {
  reader.seek(offset)
  const featureParamsOffset = reader.readUint16()
  const lookupIndexCount = reader.readUint16()
  const lookupIndices = new Array<number>(lookupIndexCount)
  for (let i = 0; i < lookupIndexCount; i++) {
    const lookupIndex = reader.readUint16()
    validateLookupIndex(lookupIndex, lookupCount)
    lookupIndices[i] = lookupIndex
  }
  const params = featureParamsOffset === 0
    ? null
    : parseOpenTypeFeatureParams(reader, offset + featureParamsOffset, tag)
  return { featureIndex, tag, lookupIndices, params }
}

function parseOpenTypeFeatureParams(
  reader: BinaryReader,
  offset: number,
  tag: string,
): OpenTypeFeatureParams {
  reader.seek(offset)
  if (tag === 'size') {
    const designSize = reader.readUint16()
    const subfamilyId = reader.readUint16()
    const subfamilyNameId = reader.readUint16()
    const rangeStart = reader.readUint16()
    const rangeEnd = reader.readUint16()
    return { kind: 'size', designSize, subfamilyId, subfamilyNameId, rangeStart, rangeEnd }
  }
  if (/^ss(?:0[1-9]|1[0-9]|20)$/.test(tag)) {
    const version = reader.readUint16()
    if (version !== 0) throw new Error(`${tag} FeatureParams version must be 0, got ${version}`)
    const uiNameId = reader.readUint16()
    return { kind: 'stylistic-set', version: 0, uiNameId }
  }
  if (/^cv(?:0[1-9]|[1-9][0-9])$/.test(tag)) {
    const format = reader.readUint16()
    if (format !== 0) throw new Error(`${tag} FeatureParams format must be 0, got ${format}`)
    const uiLabelNameId = reader.readUint16()
    const tooltipNameId = reader.readUint16()
    const sampleTextNameId = reader.readUint16()
    const namedParameterCount = reader.readUint16()
    const firstParameterUiLabelNameId = reader.readUint16()
    const characterCount = reader.readUint16()
    const characters = new Array<number>(characterCount)
    for (let i = 0; i < characterCount; i++) {
      characters[i] = reader.readUint8() * 0x10000 + reader.readUint16()
    }
    return {
      kind: 'character-variant',
      format: 0,
      uiLabelNameId,
      tooltipNameId,
      sampleTextNameId,
      namedParameterCount,
      firstParameterUiLabelNameId,
      characters,
    }
  }
  throw new Error(`FeatureParams are not defined for OpenType feature ${tag}`)
}

/** Serializes a static FeatureList after FeatureVariations selection. */
export function buildStaticFeatureList(
  reader: BinaryReader,
  featureListOffset: number,
  substitutions: ReadonlyMap<number, number> | null,
  lookupCount?: number,
): Uint8Array {
  if (featureListOffset === 0) return new Uint8Array(0)
  reader.seek(featureListOffset)
  const featureCount = reader.readUint16()
  const records = new Array<{ tag: string, offset: number }>(featureCount)
  for (let i = 0; i < featureCount; i++) {
    records[i] = { tag: reader.readTag(), offset: reader.readUint16() }
  }
  const features = new Array<OpenTypeLayoutFeatureRecord>(featureCount)
  for (let i = 0; i < featureCount; i++) {
    const record = records[i]!
    features[i] = readOpenTypeFeatureRecord(
      reader,
      substitutions?.get(i) ?? featureListOffset + record.offset,
      i,
      record.tag,
      lookupCount,
    )
  }
  const writer = new BinaryWriter()
  writer.writeUint16(featureCount)
  const offsetPositions = new Array<number>(featureCount)
  for (let i = 0; i < featureCount; i++) {
    writer.writeTag(features[i]!.tag)
    offsetPositions[i] = writer.position
    writer.writeUint16(0)
  }
  for (let i = 0; i < featureCount; i++) {
    patchWriterUint16(writer, offsetPositions[i]!, writer.position)
    writeStaticFeatureTable(writer, features[i]!)
  }
  return writer.toUint8Array()
}

function writeStaticFeatureTable(writer: BinaryWriter, feature: OpenTypeLayoutFeatureRecord): void {
  const paramsOffset = feature.params === null ? 0 : 4 + feature.lookupIndices.length * 2
  writer.writeUint16(paramsOffset)
  writer.writeUint16(feature.lookupIndices.length)
  for (let i = 0; i < feature.lookupIndices.length; i++) writer.writeUint16(feature.lookupIndices[i]!)
  const params = feature.params
  if (params === null) return
  if (params.kind === 'size') {
    writer.writeUint16(params.designSize)
    writer.writeUint16(params.subfamilyId)
    writer.writeUint16(params.subfamilyNameId)
    writer.writeUint16(params.rangeStart)
    writer.writeUint16(params.rangeEnd)
  } else if (params.kind === 'stylistic-set') {
    writer.writeUint16(params.version)
    writer.writeUint16(params.uiNameId)
  } else {
    writer.writeUint16(params.format)
    writer.writeUint16(params.uiLabelNameId)
    writer.writeUint16(params.tooltipNameId)
    writer.writeUint16(params.sampleTextNameId)
    writer.writeUint16(params.namedParameterCount)
    writer.writeUint16(params.firstParameterUiLabelNameId)
    writer.writeUint16(params.characters.length)
    for (let i = 0; i < params.characters.length; i++) {
      const value = params.characters[i]!
      writer.writeUint8(value >>> 16)
      writer.writeUint16(value & 0xFFFF)
    }
  }
}

function patchWriterUint16(writer: BinaryWriter, offset: number, value: number): void {
  if (value > 0xFFFF) throw new Error(`FeatureList offset ${value} exceeds Offset16 range`)
  const end = writer.position
  writer.position = offset
  writer.writeUint16(value)
  writer.position = end
}

/**
 * Walk the Script List + Feature List and return the Lookup indices
 * corresponding to the given feature tags
 *
 * @param reader Reader over the whole table
 * @param tableStart start position of the table
 * @param scriptListOffset ScriptList offset (relative to table start)
 * @param featureListOffset FeatureList offset (relative to table start)
 * @param featureTags feature tags to collect (null = all features)
 * @param script script tag (null = DFLT → latn → first)
 * @param language language tag (null = DefaultLangSys)
 * @returns array of Lookup indices (deduplicated, sorted)
 */
export function getFeatureLookupIndices(
  reader: BinaryReader,
  tableStart: number,
  scriptListOffset: number,
  featureListOffset: number,
  featureTags: Set<string> | null,
  script?: string | null,
  language?: string | null,
  lookupCount?: number,
  featureVariations?: FeatureVariationsTable | null,
  normalizedCoords?: number[] | null,
): number[] {
  // 1. Get the LangSys from the Script List
  const featureIndices = getFeatureIndicesFromScript(
    reader, tableStart + scriptListOffset, script ?? null, language ?? null,
  )

  // 2. Get the lookup indices of the target features from the Feature List
  const featureListBase = tableStart + featureListOffset
  reader.seek(featureListBase)
  const featureCount = reader.readUint16()

  const lookupIndices = new Set<number>()
  const featureRecords: { tag: string, offset: number }[] = []
  for (let i = 0; i < featureCount; i++) {
    const tag = reader.readTag()
    const offset = reader.readUint16()
    featureRecords.push({ tag, offset })
  }

  const selectedSubstitution = resolveFeatureVariationSubstitution(featureVariations ?? null, normalizedCoords ?? null)
  for (const fi of featureIndices) {
    if (fi >= featureCount) {
      throw new Error(`LangSys feature index ${fi} out of FeatureList range ${featureCount}`)
    }
    const rec = featureRecords[fi]!

    // Filter by feature tag
    if (featureTags !== null && !featureTags.has(rec.tag)) continue

    const alternateFeatureOffset = selectedSubstitution?.get(fi)
    const featureOffset = alternateFeatureOffset ?? (featureListBase + rec.offset)
    const indices = readFeatureLookupIndices(reader, featureOffset, lookupCount)
    for (const lookupIndex of indices) lookupIndices.add(lookupIndex)
  }

  return [...lookupIndices].sort((a, b) => a - b)
}

export function getFeatureListCount(
  reader: BinaryReader,
  tableStart: number,
  featureListOffset: number,
): number {
  const savedPos = reader.position
  reader.seek(tableStart + featureListOffset)
  const featureCount = reader.readUint16()
  reader.seek(savedPos)
  return featureCount
}

export function parseFeatureVariations(
  reader: BinaryReader,
  offset: number,
  featureCount: number,
  lookupCount?: number,
  expectedAxisCount?: number,
): FeatureVariationsTable {
  const savedPos = reader.position
  ensureOtlRange(reader, offset, 8, 'FeatureVariations header')
  reader.seek(offset)
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    reader.seek(savedPos)
    throw new Error(`Unsupported FeatureVariations version: ${majorVersion}.${minorVersion}`)
  }
  const recordCount = reader.readUint32()
  const recordArrayBytes = recordCount * 8
  ensureOtlRange(reader, offset + 8, recordArrayBytes, 'FeatureVariations record array')
  const recordArrayEnd = 8 + recordArrayBytes
  const recordOffsets: { conditionSet: number, substitution: number }[] = []
  for (let i = 0; i < recordCount; i++) {
    const conditionSet = reader.readUint32()
    const substitution = reader.readUint32()
    if (conditionSet !== 0) {
      ensureOtlOffsetAfterHeader(conditionSet, recordArrayEnd, `FeatureVariationRecord ${i} conditionSetOffset`)
      ensureOtlRange(reader, offset + conditionSet, 2, `FeatureVariationRecord ${i} ConditionSet`)
    }
    if (substitution !== 0) {
      ensureOtlOffsetAfterHeader(substitution, recordArrayEnd, `FeatureVariationRecord ${i} featureTableSubstitutionOffset`)
      ensureOtlRange(reader, offset + substitution, 6, `FeatureVariationRecord ${i} FeatureTableSubstitution`)
    }
    recordOffsets.push({ conditionSet, substitution })
  }

  const records: FeatureVariationRecord[] = []
  for (let i = 0; i < recordOffsets.length; i++) {
    const record = recordOffsets[i]!
    const conditionSet = record.conditionSet === 0
      ? null
      : parseFeatureVariationConditionSet(reader, offset + record.conditionSet, expectedAxisCount)
    const substitution = record.substitution === 0
      ? null
      : parseFeatureTableSubstitution(reader, offset + record.substitution, featureCount, lookupCount)
    records.push({ conditionSet, substitution })
  }
  reader.seek(savedPos)
  return { records }
}

function parseFeatureVariationConditionSet(
  reader: BinaryReader,
  offset: number,
  expectedAxisCount?: number,
): FeatureVariationConditionSet {
  const savedPos = reader.position
  ensureOtlRange(reader, offset, 2, 'FeatureVariation ConditionSet header')
  reader.seek(offset)
  const conditionCount = reader.readUint16()
  const conditionOffsetArrayBytes = conditionCount * 4
  ensureOtlRange(reader, offset + 2, conditionOffsetArrayBytes, 'FeatureVariation ConditionSet offset array')
  const conditionOffsetArrayEnd = 2 + conditionOffsetArrayBytes
  const conditionOffsets: number[] = []
  for (let i = 0; i < conditionCount; i++) {
    const conditionOffset = reader.readUint32()
    ensureOtlOffsetAfterHeader(conditionOffset, conditionOffsetArrayEnd, `FeatureVariation ConditionSet conditionOffset ${i}`)
    ensureOtlRange(reader, offset + conditionOffset, 8, `FeatureVariation Condition ${i}`)
    conditionOffsets.push(conditionOffset)
  }

  const conditions: FeatureVariationCondition[] = []
  for (let i = 0; i < conditionOffsets.length; i++) {
    reader.seek(offset + conditionOffsets[i]!)
    const format = reader.readUint16()
    if (format !== 1) {
      reader.seek(savedPos)
      throw new Error(`Unsupported FeatureVariation Condition format: ${format}`)
    }
    const axisIndex = reader.readUint16()
    const minValue = reader.readF2Dot14()
    const maxValue = reader.readF2Dot14()
    if (expectedAxisCount === undefined) {
      reader.seek(savedPos)
      throw new Error(`FeatureVariation Condition ${i} requires table 'fvar'`)
    }
    if (axisIndex >= expectedAxisCount) {
      reader.seek(savedPos)
      throw new Error(`FeatureVariation Condition ${i} axisIndex ${axisIndex} out of fvar axis range ${expectedAxisCount}`)
    }
    if (minValue < -1 || minValue > 1 || maxValue < -1 || maxValue > 1) {
      reader.seek(savedPos)
      throw new Error(`FeatureVariation Condition ${i} range ${minValue}..${maxValue} is outside normalized coordinate bounds`)
    }
    if (minValue > maxValue) {
      reader.seek(savedPos)
      throw new Error(`FeatureVariation Condition ${i} has minValue greater than maxValue`)
    }
    conditions.push({ axisIndex, minValue, maxValue })
  }
  reader.seek(savedPos)
  return { conditions }
}

function parseFeatureTableSubstitution(
  reader: BinaryReader,
  offset: number,
  featureCount: number,
  lookupCount?: number,
): FeatureTableSubstitution {
  const savedPos = reader.position
  ensureOtlRange(reader, offset, 6, 'FeatureTableSubstitution header')
  reader.seek(offset)
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    reader.seek(savedPos)
    throw new Error(`Unsupported FeatureTableSubstitution version: ${majorVersion}.${minorVersion}`)
  }
  const substitutionCount = reader.readUint16()
  const substitutionRecordArrayBytes = substitutionCount * 6
  ensureOtlRange(reader, offset + 6, substitutionRecordArrayBytes, 'FeatureTableSubstitution record array')
  const substitutionRecordArrayEnd = 6 + substitutionRecordArrayBytes
  const substitutions: FeatureTableSubstitutionRecord[] = []
  let previousFeatureIndex = -1
  for (let i = 0; i < substitutionCount; i++) {
    const featureIndex = reader.readUint16()
    const alternateFeatureOffset = reader.readUint32()
    if (featureIndex <= previousFeatureIndex) {
      reader.seek(savedPos)
      throw new Error(`FeatureTableSubstitution record ${i} is not in strictly increasing featureIndex order`)
    }
    if (featureIndex >= featureCount) {
      reader.seek(savedPos)
      throw new Error(`FeatureTableSubstitution feature index ${featureIndex} out of FeatureList range ${featureCount}`)
    }
    ensureOtlOffsetAfterHeader(alternateFeatureOffset, substitutionRecordArrayEnd, `FeatureTableSubstitution record ${i} alternateFeatureOffset`)
    ensureOtlRange(reader, offset + alternateFeatureOffset, 4, `FeatureTableSubstitution record ${i} alternate Feature table`)
    readFeatureLookupIndices(reader, offset + alternateFeatureOffset, lookupCount)
    substitutions.push({ featureIndex, alternateFeatureOffset: offset + alternateFeatureOffset })
    previousFeatureIndex = featureIndex
  }
  reader.seek(savedPos)
  return { substitutions }
}

function ensureOtlRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds table length: need ${offset + length}, got ${reader.length}`)
  }
}

function ensureOtlOffsetAfterHeader(offset: number, minimumOffset: number, label: string): void {
  if (offset < minimumOffset) {
    throw new Error(`${label} must be at least ${minimumOffset}, got ${offset}`)
  }
}

export function resolveFeatureVariationSubstitution(
  featureVariations: FeatureVariationsTable | null,
  normalizedCoords: number[] | null,
): Map<number, number> | null {
  if (featureVariations === null) return null
  for (const record of featureVariations.records) {
    if (!matchesFeatureVariationConditionSet(record.conditionSet, normalizedCoords)) continue
    if (record.substitution === null) return null
    const substitutions = new Map<number, number>()
    for (const substitution of record.substitution.substitutions) {
      substitutions.set(substitution.featureIndex, substitution.alternateFeatureOffset)
    }
    return substitutions
  }
  return null
}

function matchesFeatureVariationConditionSet(
  conditionSet: FeatureVariationConditionSet | null,
  normalizedCoords: number[] | null,
): boolean {
  if (conditionSet === null) return true
  for (const condition of conditionSet.conditions) {
    if (normalizedCoords === null || condition.axisIndex >= normalizedCoords.length) return false
    const value = normalizedCoords[condition.axisIndex]!
    if (value < condition.minValue || value > condition.maxValue) return false
  }
  return true
}

function readFeatureLookupIndices(
  reader: BinaryReader,
  featureTableOffset: number,
  lookupCount?: number,
): number[] {
  const savedPos = reader.position
  reader.seek(featureTableOffset)
  reader.skip(2) // featureParams
  const lookupIndexCount = reader.readUint16()
  const lookupIndices: number[] = []
  for (let j = 0; j < lookupIndexCount; j++) {
    const lookupIndex = reader.readUint16()
    validateLookupIndex(lookupIndex, lookupCount)
    lookupIndices.push(lookupIndex)
  }
  reader.seek(savedPos)
  return lookupIndices
}

/**
 * Whether the Script List contains an exact script tag (no DFLT/latn fallback).
 * Used to choose OpenType new-spec vs old-spec Indic behaviour the way HarfBuzz
 * does: prefer the new-spec tag (e.g. 'knd2') when the font actually provides it.
 */
export function scriptListContainsTag(
  reader: BinaryReader,
  scriptListOffset: number,
  scriptTag: string,
): boolean {
  reader.seek(scriptListOffset)
  const scriptCount = reader.readUint16()
  for (let i = 0; i < scriptCount; i++) {
    const tag = reader.readTag()
    reader.readUint16() // offset
    if (tag === scriptTag) return true
  }
  return false
}

/**
 * Get the list of Feature indices for a specific script/language from the Script List
 */
function getFeatureIndicesFromScript(
  reader: BinaryReader,
  scriptListOffset: number,
  scriptTag: string | null,
  languageTag: string | null,
): number[] {
  reader.seek(scriptListOffset)
  const scriptCount = reader.readUint16()

  const scripts: { tag: string, offset: number }[] = []
  for (let i = 0; i < scriptCount; i++) {
    const tag = reader.readTag()
    const offset = reader.readUint16()
    scripts.push({ tag, offset })
  }

  // Script selection: specified > DFLT > latn > first
  let selectedScript: { tag: string, offset: number } | undefined
  if (scriptTag) {
    selectedScript = scripts.find(s => s.tag === scriptTag)
  }
  if (!selectedScript) {
    selectedScript = scripts.find(s => s.tag === 'DFLT') ??
                     scripts.find(s => s.tag === 'latn') ??
                     scripts[0]
  }
  if (!selectedScript) return []

  // Script Table → LangSys
  const scriptTableOffset = scriptListOffset + selectedScript.offset
  reader.seek(scriptTableOffset)
  const defaultLangSysOffset = reader.readUint16()
  const langSysCount = reader.readUint16()

  let langSysOffset: number | null = null

  if (languageTag) {
    for (let i = 0; i < langSysCount; i++) {
      const tag = reader.readTag()
      const offset = reader.readUint16()
      if (tag === languageTag) {
        langSysOffset = offset
        break
      }
    }
  }

  // Fallback: DefaultLangSys
  if (langSysOffset === null && defaultLangSysOffset !== 0) {
    langSysOffset = defaultLangSysOffset
  }

  if (langSysOffset === null) return []

  // LangSys table
  reader.seek(scriptTableOffset + langSysOffset)
  const lookupOrderOffset = reader.readUint16()
  if (lookupOrderOffset !== 0) {
    throw new Error(`LangSys lookupOrderOffset must be 0, got ${lookupOrderOffset}`)
  }
  const requiredFeatureIndex = reader.readUint16()
  const featureIndexCount = reader.readUint16()

  const featureIndices: number[] = []
  if (requiredFeatureIndex !== 0xFFFF) {
    featureIndices.push(requiredFeatureIndex)
  }
  for (let i = 0; i < featureIndexCount; i++) {
    featureIndices.push(reader.readUint16())
  }

  return featureIndices
}

/**
 * Parse the Lookup List and return an array of LookupInfo
 */
export function parseLookupList(
  reader: BinaryReader,
  tableStart: number,
  lookupListOffset: number,
): LookupInfo[] {
  // A zero offset means the (optional) Lookup List is absent — the font has no
  // lookups. Real fonts ship this (e.g. macOS NotoSansBamum, whose GSUB carries
  // only Script/Feature lists). Treating 0 as an absolute offset would misread
  // the table header as a lookup list.
  if (lookupListOffset === 0) return []
  const lookupListBase = tableStart + lookupListOffset
  reader.seek(lookupListBase)
  const lookupCount = reader.readUint16()
  const lookupOffsets: number[] = []
  for (let i = 0; i < lookupCount; i++) {
    lookupOffsets.push(reader.readUint16())
  }

  const lookups: LookupInfo[] = []
  for (let li = 0; li < lookupCount; li++) {
    const lookupOffset = lookupListBase + lookupOffsets[li]!
    reader.seek(lookupOffset)

    const type = reader.readUint16()
    const flag = reader.readUint16()
    if ((flag & 0x00E0) !== 0) {
      throw new Error(`Unsupported LookupFlag reserved bits: 0x${(flag & 0x00E0).toString(16).padStart(4, '0')}`)
    }
    const subtableCount = reader.readUint16()
    const subtableOffsets: number[] = []
    for (let i = 0; i < subtableCount; i++) {
      subtableOffsets.push(lookupOffset + reader.readUint16())
    }

    let markFilteringSet: number | undefined
    if (flag & 0x0010) {
      markFilteringSet = reader.readUint16()
    }

    lookups.push({ type, flag, subtableOffsets, markFilteringSet })
  }

  return lookups
}

/**
 * Resolve an Extension-type Lookup and return the actual type and subtableStart
 * @param extensionLookupType GSUB=7, GPOS=9
 */
export function resolveExtension(
  reader: BinaryReader,
  subtableStart: number,
  lookupType: number,
  extensionLookupType: number,
): { actualType: number, actualStart: number } {
  if (lookupType !== extensionLookupType) {
    return { actualType: lookupType, actualStart: subtableStart }
  }
  reader.seek(subtableStart)
  const format = reader.readUint16()
  const extensionName = extensionLookupType === 7 ? 'ExtensionSubst' : 'ExtensionPos'
  if (format !== 1) {
    throw new Error(`Unsupported ${extensionName} format: ${format}`)
  }
  const actualType = reader.readUint16()
  if (actualType === extensionLookupType) {
    throw new Error(`${extensionName} extensionLookupType must not be ${extensionLookupType}`)
  }
  const extensionOffset = reader.readUint32()
  return { actualType, actualStart: subtableStart + extensionOffset }
}

/**
 * Get the Lookup indices for the given tag directly from the Feature List
 * (simplified version that skips Script/Language and scans all features)
 */
export function getDirectFeatureLookupIndices(
  reader: BinaryReader,
  tableStart: number,
  featureListOffset: number,
  featureTag: string,
  lookupCount?: number,
): number[] {
  const featureListBase = tableStart + featureListOffset
  reader.seek(featureListBase)
  const featureCount = reader.readUint16()

  const lookupIndices: number[] = []
  for (let i = 0; i < featureCount; i++) {
    const tag = reader.readTag()
    const offset = reader.readUint16()

    if (tag === featureTag) {
      const savedPos = reader.position
      reader.seek(featureListBase + offset)
      reader.skip(2) // featureParams
      const lookupIndexCount = reader.readUint16()
      for (let j = 0; j < lookupIndexCount; j++) {
        const lookupIndex = reader.readUint16()
        validateLookupIndex(lookupIndex, lookupCount)
        lookupIndices.push(lookupIndex)
      }
      reader.seek(savedPos)
    }
  }

  return lookupIndices
}

function validateLookupIndex(index: number, lookupCount: number | undefined): void {
  if (lookupCount !== undefined && index >= lookupCount) {
    throw new Error(`Feature lookup index ${index} out of LookupList range ${lookupCount}`)
  }
}
