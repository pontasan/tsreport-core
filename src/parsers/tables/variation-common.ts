import { BinaryReader } from '../../binary/reader.js'

/**
 * Variation Common: shared IVS (ItemVariationStore) parsing code
 * Used by hvar, mvar, and avar v2
 */

export interface VariationRegion {
  axes: { startCoord: number, peakCoord: number, endCoord: number }[]
}

export interface ItemVariationData {
  regionIndices: number[]
  deltaSets: number[][]  // [itemIndex][regionIndex]
}

export interface ItemVariationStore {
  axisCount?: number
  regions: VariationRegion[]
  data: ItemVariationData[]
}

export interface DeltaSetIndexMap {
  entries: { outer: number, inner: number }[]
}

const ITEM_VARIATION_STORE_HEADER_SIZE = 8
const ITEM_VARIATION_STORE_FORMAT = 1
const VARIATION_REGION_LIST_HEADER_SIZE = 4
const REGION_AXIS_COORDINATES_SIZE = 6
const ITEM_VARIATION_DATA_HEADER_SIZE = 6
const LONG_WORDS_FLAG = 0x8000
const WORD_DELTA_COUNT_MASK = 0x7FFF
const REGION_COUNT_RESERVED_BIT = 0x8000
const DELTA_SET_INDEX_MAP_FORMAT_0_HEADER_SIZE = 4
const DELTA_SET_INDEX_MAP_FORMAT_1_HEADER_SIZE = 6
const DELTA_SET_INDEX_MAP_FORMAT_0 = 0
const DELTA_SET_INDEX_MAP_FORMAT_1 = 1
const ENTRY_FORMAT_RESERVED_BITS = 0xC0
const INNER_INDEX_BIT_COUNT_MASK = 0x0F
const MAP_ENTRY_SIZE_MASK = 0x30
const NO_VARIATION_INDEX = 0xFFFF

export function parseItemVariationStore(reader: BinaryReader, offset: number, expectedAxisCount?: number): ItemVariationStore {
  ensureRange(offset, ITEM_VARIATION_STORE_HEADER_SIZE, reader.length, 'ItemVariationStore header')
  reader.seek(offset)
  const format = reader.readUint16()
  if (format !== ITEM_VARIATION_STORE_FORMAT) {
    throw new Error(`ItemVariationStore format must be ${ITEM_VARIATION_STORE_FORMAT}, got ${format}`)
  }
  const variationRegionListOffset = reader.readUint32()
  const itemVariationDataCount = reader.readUint16()
  const headerSize = ITEM_VARIATION_STORE_HEADER_SIZE + itemVariationDataCount * 4
  ensureRange(offset, headerSize, reader.length, 'ItemVariationStore itemVariationDataOffsets')
  const itemVariationDataOffsets: number[] = []
  for (let i = 0; i < itemVariationDataCount; i++) {
    itemVariationDataOffsets.push(reader.readUint32())
  }

  // Variation Region List
  if (variationRegionListOffset < headerSize) {
    throw new Error(`ItemVariationStore variationRegionListOffset must be at least ${headerSize}, got ${variationRegionListOffset}`)
  }
  const variationRegionListStart = offset + variationRegionListOffset
  ensureRange(variationRegionListStart, VARIATION_REGION_LIST_HEADER_SIZE, reader.length, 'VariationRegionList header')
  reader.seek(variationRegionListStart)
  const axisCount = reader.readUint16()
  if (axisCount === 0) {
    throw new Error('VariationRegionList axisCount must be greater than zero')
  }
  if (expectedAxisCount !== undefined && axisCount !== expectedAxisCount) {
    throw new Error(`VariationRegionList axisCount must match fvar axis count ${expectedAxisCount}, got ${axisCount}`)
  }
  const rawRegionCount = reader.readUint16()
  if ((rawRegionCount & REGION_COUNT_RESERVED_BIT) !== 0) {
    throw new Error(`VariationRegionList regionCount reserved bit must be zero, got ${rawRegionCount}`)
  }
  const regionCount = rawRegionCount
  const variationRegionListSize = VARIATION_REGION_LIST_HEADER_SIZE + regionCount * axisCount * REGION_AXIS_COORDINATES_SIZE
  ensureRange(variationRegionListStart, variationRegionListSize, reader.length, 'VariationRegionList records')
  const regions: VariationRegion[] = []
  for (let i = 0; i < regionCount; i++) {
    const axes: { startCoord: number, peakCoord: number, endCoord: number }[] = []
    for (let a = 0; a < axisCount; a++) {
      const startCoord = reader.readF2Dot14()
      const peakCoord = reader.readF2Dot14()
      const endCoord = reader.readF2Dot14()
      validateRegionAxisCoordinates(startCoord, peakCoord, endCoord, i, a)
      axes.push({ startCoord, peakCoord, endCoord })
    }
    regions.push({ axes })
  }

  // Item Variation Data
  const data: ItemVariationData[] = []
  for (let d = 0; d < itemVariationDataCount; d++) {
    const itemVariationDataOffset = itemVariationDataOffsets[d]!
    if (itemVariationDataOffset === 0) {
      data.push({ regionIndices: [], deltaSets: [] })
      continue
    }
    if (itemVariationDataOffset < headerSize) {
      throw new Error(`ItemVariationData offset ${d} must be at least ${headerSize}, got ${itemVariationDataOffset}`)
    }
    const itemVariationDataStart = offset + itemVariationDataOffset
    ensureRange(itemVariationDataStart, ITEM_VARIATION_DATA_HEADER_SIZE, reader.length, `ItemVariationData ${d} header`)
    reader.seek(itemVariationDataStart)
    const itemCount = reader.readUint16()
    const wordDeltaCount = reader.readUint16()
    const regionIndexCount = reader.readUint16()
    const longWords = (wordDeltaCount & LONG_WORDS_FLAG) !== 0
    const wordCount = wordDeltaCount & WORD_DELTA_COUNT_MASK
    if (wordCount > regionIndexCount) {
      throw new Error(`ItemVariationData ${d} word delta count ${wordCount} exceeds regionIndexCount ${regionIndexCount}`)
    }
    const regionIndexArraySize = regionIndexCount * 2
    ensureRange(reader.position, regionIndexArraySize, reader.length, `ItemVariationData ${d} regionIndexes`)
    const regionIndices: number[] = []
    for (let i = 0; i < regionIndexCount; i++) {
      const regionIndex = reader.readUint16()
      if (regionIndex >= regionCount) {
        throw new Error(`ItemVariationData ${d} region index ${regionIndex} exceeds regionCount ${regionCount}`)
      }
      regionIndices.push(regionIndex)
    }

    const rowSize = longWords
      ? (regionIndexCount + wordCount) * 2
      : regionIndexCount + wordCount
    const deltaSetDataSize = itemCount * rowSize
    ensureRange(reader.position, deltaSetDataSize, reader.length, `ItemVariationData ${d} deltaSets`)

    const deltaSets: number[][] = []
    for (let item = 0; item < itemCount; item++) {
      const deltas: number[] = []
      for (let r = 0; r < regionIndexCount; r++) {
        if (r < wordCount) {
          deltas.push(longWords ? reader.readInt32() : reader.readInt16())
        } else {
          deltas.push(longWords ? reader.readInt16() : reader.readInt8())
        }
      }
      deltaSets.push(deltas)
    }

    data.push({ regionIndices, deltaSets })
  }

  return { axisCount, regions, data }
}

export function parseDeltaSetIndexMap(reader: BinaryReader, offset: number): DeltaSetIndexMap {
  ensureRange(offset, 2, reader.length, 'DeltaSetIndexMap header')
  reader.seek(offset)
  const format = reader.readUint8()
  const entryFormat = reader.readUint8()
  if (format !== DELTA_SET_INDEX_MAP_FORMAT_0 && format !== DELTA_SET_INDEX_MAP_FORMAT_1) {
    throw new Error(`DeltaSetIndexMap format must be 0 or 1, got ${format}`)
  }
  if ((entryFormat & ENTRY_FORMAT_RESERVED_BITS) !== 0) {
    throw new Error(`DeltaSetIndexMap entryFormat reserved bits must be zero, got ${entryFormat}`)
  }
  const headerSize = format === DELTA_SET_INDEX_MAP_FORMAT_0
    ? DELTA_SET_INDEX_MAP_FORMAT_0_HEADER_SIZE
    : DELTA_SET_INDEX_MAP_FORMAT_1_HEADER_SIZE
  ensureRange(offset, headerSize, reader.length, 'DeltaSetIndexMap mapCount')
  const mapCount = format === DELTA_SET_INDEX_MAP_FORMAT_0 ? reader.readUint16() : reader.readUint32()

  const innerBits = (entryFormat & INNER_INDEX_BIT_COUNT_MASK) + 1
  const innerModulo = 2 ** innerBits
  const entrySize = ((entryFormat & MAP_ENTRY_SIZE_MASK) >> 4) + 1
  if (innerBits > entrySize * 8) {
    throw new Error(`DeltaSetIndexMap inner index bit count ${innerBits} exceeds entry size ${entrySize}`)
  }
  ensureRange(reader.position, entrySize * mapCount, reader.length, 'DeltaSetIndexMap mapData')

  const entries: { outer: number, inner: number }[] = []
  for (let i = 0; i < mapCount; i++) {
    let entry = 0
    for (let b = 0; b < entrySize; b++) {
      entry = entry * 256 + reader.readUint8()
    }
    entries.push({
      outer: Math.floor(entry / innerModulo),
      inner: entry % innerModulo,
    })
  }

  return { entries }
}

export function getIndices(glyphId: number, map: DeltaSetIndexMap | null): { outer: number, inner: number } {
  if (!map) {
    return { outer: 0, inner: glyphId }
  }
  if (glyphId >= map.entries.length) {
    if (map.entries.length === 0) return { outer: 0, inner: 0 }
    return map.entries[map.entries.length - 1]!
  }
  return map.entries[glyphId]!
}

export function getDelta(ivs: ItemVariationStore, outer: number, inner: number, coords: number[]): number {
  if (outer === NO_VARIATION_INDEX && inner === NO_VARIATION_INDEX) return 0
  if (outer >= ivs.data.length) return 0
  const d = ivs.data[outer]!
  if (inner >= d.deltaSets.length) return 0
  const deltas = d.deltaSets[inner]!

  let delta = 0
  for (let r = 0; r < d.regionIndices.length; r++) {
    const regionIdx = d.regionIndices[r]!
    const region = ivs.regions[regionIdx]
    if (!region) continue

    let scalar = 1.0
    for (let a = 0; a < region.axes.length; a++) {
      const { startCoord, peakCoord, endCoord } = region.axes[a]!
      const coord = coords[a] ?? 0

      if (peakCoord === 0) continue
      if (coord < startCoord || coord > endCoord) { scalar = 0; break }
      if (coord === peakCoord) continue
      if (coord < peakCoord) {
        scalar *= (peakCoord === startCoord) ? 1 : (coord - startCoord) / (peakCoord - startCoord)
      } else {
        scalar *= (peakCoord === endCoord) ? 1 : (endCoord - coord) / (endCoord - peakCoord)
      }
    }

    if (scalar !== 0) {
      delta += deltas[r]! * scalar
    }
  }

  return Math.round(delta)
}

export function validateDeltaSetIndex(ivs: ItemVariationStore, outer: number, inner: number, label: string): void {
  if (outer === NO_VARIATION_INDEX && inner === NO_VARIATION_INDEX) return
  if (outer >= ivs.data.length) {
    throw new Error(`${label} deltaSetOuterIndex ${outer} exceeds ItemVariationData count ${ivs.data.length}`)
  }
  const itemVariationData = ivs.data[outer]!
  if (itemVariationData.regionIndices.length === 0 && itemVariationData.deltaSets.length === 0) return
  if (inner >= itemVariationData.deltaSets.length) {
    throw new Error(`${label} deltaSetInnerIndex ${inner} exceeds ItemVariationData ${outer} itemCount ${itemVariationData.deltaSets.length}`)
  }
}

function ensureRange(offset: number, length: number, tableLength: number, label: string): void {
  if (offset < 0 || length < 0 || offset > tableLength || length > tableLength - offset) {
    throw new Error(`${label} exceeds table length`)
  }
}

function validateRegionAxisCoordinates(
  startCoord: number,
  peakCoord: number,
  endCoord: number,
  regionIndex: number,
  axisIndex: number,
): void {
  if (!isNormalizedF2Dot14(startCoord) || !isNormalizedF2Dot14(peakCoord) || !isNormalizedF2Dot14(endCoord)) {
    throw new Error(`VariationRegion ${regionIndex} axis ${axisIndex} coordinates must be within -1.0..1.0`)
  }
  if (startCoord > peakCoord || peakCoord > endCoord) {
    throw new Error(`VariationRegion ${regionIndex} axis ${axisIndex} coordinates must satisfy start <= peak <= end`)
  }
  if (peakCoord === 0) {
    if (startCoord > 0 || endCoord < 0) {
      throw new Error(`VariationRegion ${regionIndex} axis ${axisIndex} zero peak must span non-positive start to non-negative end`)
    }
    return
  }
  if (!((startCoord <= 0 && peakCoord <= 0 && endCoord <= 0) || (startCoord >= 0 && peakCoord >= 0 && endCoord >= 0))) {
    throw new Error(`VariationRegion ${regionIndex} axis ${axisIndex} coordinates must not cross zero unless peak is zero`)
  }
}

function isNormalizedF2Dot14(value: number): boolean {
  return value >= -1 && value <= 1
}
