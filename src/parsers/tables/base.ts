import { BinaryReader } from '../../binary/reader.js'
import { getDelta, parseItemVariationStore, type ItemVariationStore } from './variation-common.js'
import { parseDeviceTable, resolveDeviceDelta, type ParsedDevice } from './otl-common.js'

const BASE_HEADER_V1_SIZE = 8
const BASE_HEADER_V1_1_SIZE = 12
const BASE_MAJOR_VERSION = 1
const BASE_MINOR_VERSION_0 = 0
const BASE_MINOR_VERSION_1 = 1
const BASE_AXIS_HEADER_SIZE = 4
const BASE_TAG_LIST_HEADER_SIZE = 2
const BASE_SCRIPT_LIST_HEADER_SIZE = 2
const BASE_SCRIPT_HEADER_SIZE = 6
const BASE_VALUES_HEADER_SIZE = 4
const BASE_COORD_FORMAT_1_SIZE = 4
const BASE_COORD_FORMAT_2_SIZE = 8
const BASE_COORD_FORMAT_3_SIZE = 6
const BASE_COORD_FORMAT_1 = 1
const BASE_COORD_FORMAT_2 = 2
const BASE_COORD_FORMAT_3 = 3
const VARIATION_INDEX_FORMAT = 0x8000

/**
 * BaseCoord value
 */
export interface BaseCoordValue {
  /** Baseline coordinate value (design units) */
  readonly coordinate: number
  /** Format (1=simple, 2=with control point, 3=with device or VariationIndex) */
  readonly format: number
  /** Delta-set outer index when format 3 references a VariationIndex table */
  readonly deltaSetOuterIndex?: number
  /** Delta-set inner index when format 3 references a VariationIndex table */
  readonly deltaSetInnerIndex?: number
  readonly referenceGlyph?: number
  readonly referencePoint?: number
  readonly device?: ParsedDevice
}

export interface BaseResolutionContext {
  readonly ppem?: number
  readonly unitsPerEm: number
  readonly controlPointResolver?: {
    getGlyphControlPoint(glyphId: number, pointIndex: number): { x: number, y: number }
  }
}

/**
 * Baseline value
 */
export interface BaselineValue {
  /** Baseline tag */
  readonly tag: string
  /** Coordinate value */
  readonly coordinate: number
}

/**
 * MinMax record
 */
export interface MinMaxValue {
  readonly min: number
  readonly max: number
}

/**
 * BASE table: baseline adjustment
 * Baseline alignment across different scripts
 */
export interface BaseTable {
  /** Format-2 reference glyphs and source offsets used for compact rebuilding. */
  readonly subsetData: BaseSubsetData
  /** Returns the baseline values for the given script */
  getBaselines(script: string, lang?: string, direction?: 'horizontal' | 'vertical', coords?: number[], context?: BaseResolutionContext): readonly BaselineValue[]
  /** Returns the default baseline value for the given script */
  getDefaultBaseline(script: string, lang?: string, direction?: 'horizontal' | 'vertical', coords?: number[], context?: BaseResolutionContext): BaselineValue | null
  /** Returns the MinMax values for the given script */
  getMinMax(script: string, lang?: string, direction?: 'horizontal' | 'vertical', coords?: number[], context?: BaseResolutionContext): MinMaxValue | null
  /** Returns feature-specific MinMax values from FeatMinMaxRecords. */
  getFeatureMinMax(
    script: string,
    featureTag: string,
    lang?: string,
    direction?: 'horizontal' | 'vertical',
    coords?: number[],
    context?: BaseResolutionContext,
  ): MinMaxValue | null
}

export interface BaseSubsetData {
  readonly referencedGlyphIds: ReadonlySet<number>
  readonly explicitGlyphOffsets: readonly number[]
  readonly variationCoordOffsets: readonly number[]
  readonly itemVariationStore: ItemVariationStore | null
}

function parseBaseCoord(
  reader: BinaryReader,
  offset: number,
  itemVarStore: ItemVariationStore | null,
  coords?: number[],
  context?: BaseResolutionContext,
  direction: 'horizontal' | 'vertical' = 'horizontal',
): BaseCoordValue {
  ensureRange(offset, 2, reader.length, 'BaseCoord format')
  reader.seek(offset)
  const format = reader.readUint16()
  const size = getBaseCoordSize(format)
  ensureRange(offset, size, reader.length, 'BaseCoord table')
  const coordinate = reader.readInt16()
  if (format === BASE_COORD_FORMAT_1) {
    return { format, coordinate }
  }
  if (format === BASE_COORD_FORMAT_2) {
    const referenceGlyph = reader.readUint16()
    const referencePoint = reader.readUint16()
    const point = context?.controlPointResolver?.getGlyphControlPoint(referenceGlyph, referencePoint)
    const resolved = point === undefined ? coordinate : direction === 'horizontal' ? point.y : point.x
    return { format, coordinate: resolved, referenceGlyph, referencePoint }
  }
  const deviceOffset = reader.readUint16()
  if (deviceOffset === 0) {
    return { format, coordinate }
  }
  ensureRange(offset + deviceOffset, 6, reader.length, 'BaseCoord format 3 Device or VariationIndex table')
  reader.seek(offset + deviceOffset)
  const first = reader.readUint16()
  const second = reader.readUint16()
  const deltaFormat = reader.readUint16()
  if (itemVarStore === null) {
    validateDeviceDeltaFormat(deltaFormat)
    const device = parseDeviceTable(reader, offset + deviceOffset)
    const deviceDelta = context?.ppem === undefined
      ? 0
      : resolveDeviceDelta(device, context.ppem) * context.unitsPerEm / context.ppem
    return { format, coordinate: coordinate + deviceDelta, device }
  }
  if (deltaFormat !== VARIATION_INDEX_FORMAT) {
    throw new Error(`BASE VariationIndex deltaFormat must be 0x8000, got ${deltaFormat}`)
  }
  const delta = coords ? getDelta(itemVarStore, first, second, coords) : 0
  return {
    format,
    coordinate: coordinate + delta,
    deltaSetOuterIndex: first,
    deltaSetInnerIndex: second,
  }
}

function parseBaseValues(
  reader: BinaryReader,
  offset: number,
  baseTagList: string[],
  itemVarStore: ItemVariationStore | null,
  coords?: number[],
  context?: BaseResolutionContext,
  direction: 'horizontal' | 'vertical' = 'horizontal',
): { values: BaselineValue[]; defaultIndex: number } {
  if (offset === 0) return { values: [], defaultIndex: -1 }
  ensureRange(offset, BASE_VALUES_HEADER_SIZE, reader.length, 'BaseValues header')
  reader.seek(offset)
  const defaultBaselineIndex = reader.readUint16()
  const baseCoordCount = reader.readUint16()
  if (baseTagList.length > 0 && baseCoordCount !== baseTagList.length) {
    throw new Error(`BASE BaseValues baseCoordCount must equal BaseTagList count ${baseTagList.length}, got ${baseCoordCount}`)
  }
  if (baseCoordCount > 0 && defaultBaselineIndex >= baseCoordCount) {
    throw new Error(`BASE defaultBaselineIndex ${defaultBaselineIndex} exceeds baseCoordCount ${baseCoordCount}`)
  }
  ensureRange(reader.position, baseCoordCount * 2, reader.length, 'BaseValues baseCoordOffsets')
  const baseCoordOffsets: number[] = []
  for (let i = 0; i < baseCoordCount; i++) {
    baseCoordOffsets.push(reader.readUint16())
  }

  const values: BaselineValue[] = []
  for (let i = 0; i < baseCoordCount; i++) {
    const coordOffset = baseCoordOffsets[i]!
    if (coordOffset === 0) continue
    if (coordOffset < BASE_VALUES_HEADER_SIZE + baseCoordCount * 2) {
      throw new Error(`BASE BaseCoord offset ${coordOffset} overlaps BaseValues header`)
    }
    const coord = parseBaseCoord(reader, offset + coordOffset, itemVarStore, coords, context, direction)
    const tag = baseTagList[i] ?? `bas${i}`
    values.push({ tag, coordinate: coord.coordinate })
  }
  return { values, defaultIndex: defaultBaselineIndex }
}

function parseMinMaxRecord(
  reader: BinaryReader,
  offset: number,
  itemVarStore: ItemVariationStore | null,
  coords?: number[],
  context?: BaseResolutionContext,
  direction: 'horizontal' | 'vertical' = 'horizontal',
): { value: MinMaxValue, features: ReadonlyMap<string, MinMaxValue> } | null {
  if (offset === 0) return null
  ensureRange(offset, 6, reader.length, 'BASE MinMax header')
  reader.seek(offset)
  const minCoordOffset = reader.readUint16()
  const maxCoordOffset = reader.readUint16()
  const featMinMaxCount = reader.readUint16()
  ensureRange(reader.position, featMinMaxCount * 8, reader.length, 'BASE FeatMinMaxRecords')
  let previousFeatureTag = ''
  const featureRecords: { tag: string, minOffset: number, maxOffset: number }[] = []
  for (let i = 0; i < featMinMaxCount; i++) {
    const featureTag = reader.readTag()
    if (previousFeatureTag !== '' && previousFeatureTag >= featureTag) {
      throw new Error(`BASE FeatMinMax records must be in alphabetical order: ${previousFeatureTag} before ${featureTag}`)
    }
    previousFeatureTag = featureTag
    featureRecords.push({ tag: featureTag, minOffset: reader.readUint16(), maxOffset: reader.readUint16() })
  }

  let min = 0
  let max = 0
  if (minCoordOffset !== 0) {
    min = parseBaseCoord(reader, offset + minCoordOffset, itemVarStore, coords, context, direction).coordinate
  }
  if (maxCoordOffset !== 0) {
    max = parseBaseCoord(reader, offset + maxCoordOffset, itemVarStore, coords, context, direction).coordinate
  }
  const features = new Map<string, MinMaxValue>()
  for (let i = 0; i < featureRecords.length; i++) {
    const record = featureRecords[i]!
    const featureMin = record.minOffset === 0 ? 0
      : parseBaseCoord(reader, offset + record.minOffset, itemVarStore, coords, context, direction).coordinate
    const featureMax = record.maxOffset === 0 ? 0
      : parseBaseCoord(reader, offset + record.maxOffset, itemVarStore, coords, context, direction).coordinate
    features.set(record.tag, { min: featureMin, max: featureMax })
  }
  return { value: { min, max }, features }
}

interface AxisData {
  baseTagList: string[]
  scriptBaselines: Map<string, { baseValuesOffset: number; defaultMinMaxOffset: number; langMinMax: Map<string, number> }>
  axisOffset: number
}

function parseAxis(reader: BinaryReader, axisOffset: number): AxisData | null {
  if (axisOffset === 0) return null
  ensureRange(axisOffset, BASE_AXIS_HEADER_SIZE, reader.length, 'BASE Axis header')
  reader.seek(axisOffset)
  const baseTagListOffset = reader.readUint16()
  const baseScriptListOffset = reader.readUint16()
  if (baseScriptListOffset === 0) {
    throw new Error('BASE Axis baseScriptListOffset must be non-zero')
  }
  validateSubtableOffset(axisOffset, baseTagListOffset, BASE_AXIS_HEADER_SIZE, reader.length, 'BASE BaseTagList offset', true)
  validateSubtableOffset(axisOffset, baseScriptListOffset, BASE_AXIS_HEADER_SIZE, reader.length, 'BASE BaseScriptList offset', false)

  // Parse BaseTagList
  const baseTagList: string[] = []
  if (baseTagListOffset !== 0) {
    const baseTagListStart = axisOffset + baseTagListOffset
    ensureRange(baseTagListStart, BASE_TAG_LIST_HEADER_SIZE, reader.length, 'BASE BaseTagList header')
    reader.seek(baseTagListStart)
    const baseTagCount = reader.readUint16()
    ensureRange(reader.position, baseTagCount * 4, reader.length, 'BASE baselineTags')
    let previousTag = ''
    for (let i = 0; i < baseTagCount; i++) {
      const tag = reader.readTag()
      validateTag(tag, 'BASE baselineTag')
      if (previousTag !== '' && previousTag >= tag) {
        throw new Error(`BASE baselineTags must be in alphabetical order: ${previousTag} before ${tag}`)
      }
      previousTag = tag
      baseTagList.push(tag)
    }
  }

  // Parse BaseScriptList
  const scriptBaselines = new Map<string, { baseValuesOffset: number; defaultMinMaxOffset: number; langMinMax: Map<string, number> }>()

  if (baseScriptListOffset !== 0) {
    const baseScriptListStart = axisOffset + baseScriptListOffset
    ensureRange(baseScriptListStart, BASE_SCRIPT_LIST_HEADER_SIZE, reader.length, 'BASE BaseScriptList header')
    reader.seek(baseScriptListStart)
    const baseScriptCount = reader.readUint16()
    ensureRange(reader.position, baseScriptCount * 6, reader.length, 'BASE BaseScriptRecords')
    const scriptRecords: { tag: string; offset: number }[] = []
    let previousScriptTag = ''
    for (let i = 0; i < baseScriptCount; i++) {
      const tag = reader.readTag()
      validateTag(tag, 'BASE baseScriptTag')
      if (previousScriptTag !== '' && previousScriptTag >= tag) {
        throw new Error(`BASE BaseScriptRecords must be in alphabetical order: ${previousScriptTag} before ${tag}`)
      }
      previousScriptTag = tag
      const offset = reader.readUint16()
      validateSubtableOffset(baseScriptListStart, offset, BASE_SCRIPT_LIST_HEADER_SIZE + baseScriptCount * 6, reader.length, `BASE BaseScriptRecord ${tag} offset`, false)
      scriptRecords.push({ tag, offset })
    }

    for (const rec of scriptRecords) {
      const scriptOffset = baseScriptListStart + rec.offset
      ensureRange(scriptOffset, BASE_SCRIPT_HEADER_SIZE, reader.length, `BASE BaseScript ${rec.tag} header`)
      reader.seek(scriptOffset)
      const baseValuesOffset = reader.readUint16()
      const defaultMinMaxOffset = reader.readUint16()
      const baseLangSysCount = reader.readUint16()
      validateSubtableOffset(scriptOffset, baseValuesOffset, BASE_SCRIPT_HEADER_SIZE + baseLangSysCount * 6, reader.length, `BASE BaseValues offset for ${rec.tag}`, true)
      validateSubtableOffset(scriptOffset, defaultMinMaxOffset, BASE_SCRIPT_HEADER_SIZE + baseLangSysCount * 6, reader.length, `BASE DefaultMinMax offset for ${rec.tag}`, true)
      ensureRange(reader.position, baseLangSysCount * 6, reader.length, `BASE BaseLangSysRecords for ${rec.tag}`)

      const langMinMax = new Map<string, number>()
      let previousLangTag = ''
      for (let i = 0; i < baseLangSysCount; i++) {
        const langTag = reader.readTag()
        validateTag(langTag, 'BASE baseLangSysTag')
        if (previousLangTag !== '' && previousLangTag >= langTag) {
          throw new Error(`BASE BaseLangSysRecords must be in alphabetical order: ${previousLangTag} before ${langTag}`)
        }
        previousLangTag = langTag
        const minMaxOffset = reader.readUint16()
        validateSubtableOffset(scriptOffset, minMaxOffset, BASE_SCRIPT_HEADER_SIZE + baseLangSysCount * 6, reader.length, `BASE MinMax offset for ${langTag}`, true)
        langMinMax.set(langTag, minMaxOffset !== 0 ? scriptOffset + minMaxOffset : 0)
      }

      scriptBaselines.set(rec.tag, {
        baseValuesOffset: baseValuesOffset !== 0 ? scriptOffset + baseValuesOffset : 0,
        defaultMinMaxOffset: defaultMinMaxOffset !== 0 ? scriptOffset + defaultMinMaxOffset : 0,
        langMinMax,
      })
    }
  }

  return { baseTagList, scriptBaselines, axisOffset }
}

/**
 * Parses the BASE table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/base
 */
export function parseBase(reader: BinaryReader, expectedAxisCount?: number): BaseTable {
  const tableStart = reader.position
  if (reader.length - tableStart < BASE_HEADER_V1_SIZE) {
    throw new Error(`BASE table length must be at least ${BASE_HEADER_V1_SIZE}, got ${reader.length - tableStart}`)
  }
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== BASE_MAJOR_VERSION) {
    throw new Error(`Unsupported BASE table version: ${majorVersion}.${minorVersion}`)
  }
  const headerSize = minorVersion >= BASE_MINOR_VERSION_1 ? BASE_HEADER_V1_1_SIZE : BASE_HEADER_V1_SIZE
  if (reader.length - tableStart < headerSize) {
    throw new Error(`BASE table length must be at least ${headerSize}, got ${reader.length - tableStart}`)
  }
  const horizAxisOffset = reader.readUint16()
  const vertAxisOffset = reader.readUint16()
  if (horizAxisOffset === 0 && vertAxisOffset === 0) {
    throw new Error('BASE table must define at least one Axis table')
  }
  let itemVarStoreOffset = 0
  if (minorVersion >= BASE_MINOR_VERSION_1) {
    itemVarStoreOffset = reader.readUint32()
  }
  validateTableOffset(tableStart, horizAxisOffset, headerSize, reader.length, 'BASE horizAxisOffset', true)
  validateTableOffset(tableStart, vertAxisOffset, headerSize, reader.length, 'BASE vertAxisOffset', true)
  validateTableOffset(tableStart, itemVarStoreOffset, headerSize, reader.length, 'BASE itemVarStoreOffset', true)
  if (itemVarStoreOffset !== 0 && expectedAxisCount === undefined) {
    throw new Error("BASE ItemVariationStore requires table 'fvar'")
  }

  const itemVarStore = itemVarStoreOffset !== 0
    ? parseItemVariationStore(reader, tableStart + itemVarStoreOffset, expectedAxisCount)
    : null

  const horizAxis = parseAxis(reader, horizAxisOffset !== 0 ? tableStart + horizAxisOffset : 0)
  const vertAxis = vertAxisOffset !== 0 ? parseAxis(reader, tableStart + vertAxisOffset) : null
  const referencedGlyphIds = new Set<number>()
  const explicitGlyphOffsets: number[] = []
  const variationCoordOffsets: number[] = []
  collectAxisReferenceGlyphs(reader, horizAxis, tableStart, referencedGlyphIds, explicitGlyphOffsets, variationCoordOffsets)
  collectAxisReferenceGlyphs(reader, vertAxis, tableStart, referencedGlyphIds, explicitGlyphOffsets, variationCoordOffsets)

  return {
    subsetData: { referencedGlyphIds, explicitGlyphOffsets, variationCoordOffsets, itemVariationStore: itemVarStore },
    getBaselines(script: string, lang?: string, direction?: 'horizontal' | 'vertical', coords?: number[], context?: BaseResolutionContext): readonly BaselineValue[] {
      const axis = direction === 'vertical' ? vertAxis : horizAxis
      if (!axis) return []
      const scriptData = axis.scriptBaselines.get(script)
      if (!scriptData) return []
      return parseBaseValues(reader, scriptData.baseValuesOffset, axis.baseTagList, itemVarStore, coords, context, direction).values
    },

    getDefaultBaseline(script: string, lang?: string, direction?: 'horizontal' | 'vertical', coords?: number[], context?: BaseResolutionContext): BaselineValue | null {
      const axis = direction === 'vertical' ? vertAxis : horizAxis
      if (!axis) return null
      const scriptData = axis.scriptBaselines.get(script)
      if (!scriptData) return null
      const parsed = parseBaseValues(reader, scriptData.baseValuesOffset, axis.baseTagList, itemVarStore, coords, context, direction)
      if (parsed.defaultIndex < 0) return null
      return parsed.values[parsed.defaultIndex] ?? null
    },

    getMinMax(script: string, lang?: string, direction?: 'horizontal' | 'vertical', coords?: number[], context?: BaseResolutionContext): MinMaxValue | null {
      const axis = direction === 'vertical' ? vertAxis : horizAxis
      if (!axis) return null
      const scriptData = axis.scriptBaselines.get(script)
      if (!scriptData) return null

      if (lang) {
        const langOffset = scriptData.langMinMax.get(lang)
        if (langOffset) {
          return parseMinMaxRecord(reader, langOffset, itemVarStore, coords, context, direction)?.value ?? null
        }
      }
      return parseMinMaxRecord(reader, scriptData.defaultMinMaxOffset, itemVarStore, coords, context, direction)?.value ?? null
    },

    getFeatureMinMax(
      script: string,
      featureTag: string,
      lang?: string,
      direction?: 'horizontal' | 'vertical',
      coords?: number[],
      context?: BaseResolutionContext,
    ): MinMaxValue | null {
      const axis = direction === 'vertical' ? vertAxis : horizAxis
      if (!axis) return null
      const scriptData = axis.scriptBaselines.get(script)
      if (!scriptData) return null
      let minMaxOffset = scriptData.defaultMinMaxOffset
      if (lang) {
        const languageOffset = scriptData.langMinMax.get(lang)
        if (languageOffset !== undefined && languageOffset !== 0) minMaxOffset = languageOffset
      }
      return parseMinMaxRecord(reader, minMaxOffset, itemVarStore, coords, context, direction)?.features.get(featureTag) ?? null
    },
  }
}

/** Rewrites BASE format-2 reference glyph IDs for a compact glyph mapping. */
export function buildCompactBaseTable(
  reader: BinaryReader,
  oldToNew: ReadonlyMap<number, number>,
  expectedAxisCount?: number,
  bakeCoords?: number[],
): Uint8Array {
  const tableStart = reader.position
  const base = parseBase(reader, expectedAxisCount)
  const data = new Uint8Array(reader.length - tableStart)
  for (let i = 0; i < data.length; i++) data[i] = reader.getUint8At(tableStart + i)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = 0; i < base.subsetData.explicitGlyphOffsets.length; i++) {
    const targetOffset = base.subsetData.explicitGlyphOffsets[i]!
    const sourceOffset = tableStart + targetOffset
    const oldGlyphId = reader.getUint16At(sourceOffset)
    const newGlyphId = oldToNew.get(oldGlyphId)
    if (newGlyphId === undefined) throw new Error(`BASE compact subset lost reference glyph ${oldGlyphId}`)
    view.setUint16(targetOffset, newGlyphId, false)
  }
  if (bakeCoords !== undefined && base.subsetData.itemVariationStore !== null) {
    for (let i = 0; i < base.subsetData.variationCoordOffsets.length; i++) {
      const targetOffset = base.subsetData.variationCoordOffsets[i]!
      const sourceOffset = tableStart + targetOffset
      const deviceOffset = reader.getUint16At(sourceOffset + 4)
      const variationIndexOffset = sourceOffset + deviceOffset
      const outer = reader.getUint16At(variationIndexOffset)
      const inner = reader.getUint16At(variationIndexOffset + 2)
      const deltaFormat = reader.getUint16At(variationIndexOffset + 4)
      if (deltaFormat !== VARIATION_INDEX_FORMAT) {
        throw new Error(`BASE VariationIndex deltaFormat must be 0x8000, got ${deltaFormat}`)
      }
      const coordinate = reader.getInt16At(sourceOffset + 2)
        + getDelta(base.subsetData.itemVariationStore, outer, inner, bakeCoords)
      view.setUint16(targetOffset, BASE_COORD_FORMAT_1, false)
      view.setInt16(targetOffset + 2, Math.round(coordinate), false)
    }
    view.setUint32(8, 0, false)
  }
  return data
}

function collectAxisReferenceGlyphs(
  reader: BinaryReader,
  axis: AxisData | null,
  tableStart: number,
  referencedGlyphIds: Set<number>,
  explicitGlyphOffsets: number[],
  variationCoordOffsets: number[],
): void {
  if (axis === null) return
  const visitedValues = new Set<number>()
  const visitedMinMax = new Set<number>()
  const visitedCoords = new Set<number>()
  for (const script of axis.scriptBaselines.values()) {
    collectBaseValuesReferenceGlyphs(
      reader, script.baseValuesOffset, tableStart, visitedValues, visitedCoords,
      referencedGlyphIds, explicitGlyphOffsets,
      variationCoordOffsets,
    )
    collectMinMaxReferenceGlyphs(
      reader, script.defaultMinMaxOffset, tableStart, visitedMinMax, visitedCoords,
      referencedGlyphIds, explicitGlyphOffsets,
      variationCoordOffsets,
    )
    for (const offset of script.langMinMax.values()) {
      collectMinMaxReferenceGlyphs(
        reader, offset, tableStart, visitedMinMax, visitedCoords,
        referencedGlyphIds, explicitGlyphOffsets,
        variationCoordOffsets,
      )
    }
  }
}

function collectBaseValuesReferenceGlyphs(
  reader: BinaryReader,
  offset: number,
  tableStart: number,
  visitedValues: Set<number>,
  visitedCoords: Set<number>,
  referencedGlyphIds: Set<number>,
  explicitGlyphOffsets: number[],
  variationCoordOffsets: number[],
): void {
  if (offset === 0 || visitedValues.has(offset)) return
  visitedValues.add(offset)
  reader.seek(offset + 2)
  const count = reader.readUint16()
  const coordinateOffsets = new Array<number>(count)
  for (let i = 0; i < count; i++) coordinateOffsets[i] = reader.readUint16()
  for (let i = 0; i < coordinateOffsets.length; i++) {
    if (coordinateOffsets[i] !== 0) collectBaseCoordReferenceGlyph(
      reader, offset + coordinateOffsets[i]!, tableStart, visitedCoords, referencedGlyphIds, explicitGlyphOffsets,
      variationCoordOffsets,
    )
  }
}

function collectMinMaxReferenceGlyphs(
  reader: BinaryReader,
  offset: number,
  tableStart: number,
  visitedMinMax: Set<number>,
  visitedCoords: Set<number>,
  referencedGlyphIds: Set<number>,
  explicitGlyphOffsets: number[],
  variationCoordOffsets: number[],
): void {
  if (offset === 0 || visitedMinMax.has(offset)) return
  visitedMinMax.add(offset)
  reader.seek(offset)
  const coordinateOffsets: number[] = [reader.readUint16(), reader.readUint16()]
  const featureCount = reader.readUint16()
  for (let i = 0; i < featureCount; i++) {
    reader.skip(4)
    coordinateOffsets.push(reader.readUint16(), reader.readUint16())
  }
  for (let i = 0; i < coordinateOffsets.length; i++) {
    if (coordinateOffsets[i] !== 0) collectBaseCoordReferenceGlyph(
      reader, offset + coordinateOffsets[i]!, tableStart, visitedCoords, referencedGlyphIds, explicitGlyphOffsets,
      variationCoordOffsets,
    )
  }
}

function collectBaseCoordReferenceGlyph(
  reader: BinaryReader,
  offset: number,
  tableStart: number,
  visitedCoords: Set<number>,
  referencedGlyphIds: Set<number>,
  explicitGlyphOffsets: number[],
  variationCoordOffsets: number[],
): void {
  if (visitedCoords.has(offset)) return
  visitedCoords.add(offset)
  const format = reader.getUint16At(offset)
  if (format === BASE_COORD_FORMAT_3) {
    variationCoordOffsets.push(offset - tableStart)
    return
  }
  if (format !== BASE_COORD_FORMAT_2) return
  const glyphOffset = offset + 4
  referencedGlyphIds.add(reader.getUint16At(glyphOffset))
  explicitGlyphOffsets.push(glyphOffset - tableStart)
}

function getBaseCoordSize(format: number): number {
  if (format === BASE_COORD_FORMAT_1) return BASE_COORD_FORMAT_1_SIZE
  if (format === BASE_COORD_FORMAT_2) return BASE_COORD_FORMAT_2_SIZE
  if (format === BASE_COORD_FORMAT_3) return BASE_COORD_FORMAT_3_SIZE
  throw new Error(`Unsupported BASE BaseCoord format: ${format}`)
}

function validateDeviceDeltaFormat(deltaFormat: number): void {
  if (deltaFormat >= 1 && deltaFormat <= 3) return
  throw new Error(`BASE Device deltaFormat must be 1, 2, or 3 in non-variable BASE data, got ${deltaFormat}`)
}

function validateTableOffset(tableStart: number, offset: number, headerSize: number, tableLength: number, label: string, nullable: boolean): void {
  if (offset === 0) {
    if (nullable) return
    throw new Error(`${label} must be non-zero`)
  }
  if (offset < headerSize || tableStart + offset >= tableLength) {
    throw new Error(`${label} exceeds table length: ${offset}`)
  }
}

function validateSubtableOffset(parentStart: number, offset: number, minimumOffset: number, tableLength: number, label: string, nullable: boolean): void {
  if (offset === 0) {
    if (nullable) return
    throw new Error(`${label} must be non-zero`)
  }
  if (offset < minimumOffset || parentStart + offset >= tableLength) {
    throw new Error(`${label} exceeds table length: ${offset}`)
  }
}

function ensureRange(offset: number, length: number, tableLength: number, label: string): void {
  if (offset < 0 || length < 0 || offset > tableLength || length > tableLength - offset) {
    throw new Error(`${label} exceeds table length`)
  }
}

function validateTag(tag: string, label: string): void {
  for (let i = 0; i < tag.length; i++) {
    const code = tag.charCodeAt(i)
    if (code < 0x20 || code > 0x7E) {
      throw new Error(`${label} must contain printable ASCII characters: ${tag}`)
    }
  }
}
