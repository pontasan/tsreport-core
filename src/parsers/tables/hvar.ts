import { BinaryReader } from '../../binary/reader.js'
import {
  parseItemVariationStore,
  parseDeltaSetIndexMap,
  getIndices,
  getDelta,
  validateDeltaSetIndex,
  type ItemVariationStore,
  type DeltaSetIndexMap,
} from './variation-common.js'

/**
 * HVAR table: Horizontal Metrics Variations
 * Variation deltas for hmtx
 */

export interface HvarTable {
  readonly hasLsbMapping: boolean
  readonly hasRsbMapping: boolean
  /** Delta for advanceWidth */
  getAdvanceWidthDelta(glyphId: number, coords: number[]): number
  /** Delta for LSB */
  getLsbDelta(glyphId: number, coords: number[]): number
  /** Delta for RSB */
  getRsbDelta(glyphId: number, coords: number[]): number
}

const HVAR_HEADER_SIZE = 20
const HVAR_MAJOR_VERSION = 1
const HVAR_MINOR_VERSION = 0

export function parseHvar(reader: BinaryReader, expectedAxisCount?: number, expectedGlyphCount?: number): HvarTable {
  const tableStart = reader.position
  if (reader.length - tableStart < HVAR_HEADER_SIZE) {
    throw new Error(`HVAR table length must be at least ${HVAR_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== HVAR_MAJOR_VERSION) {
    throw new Error(`Unsupported HVAR table version: ${majorVersion}.${minorVersion}`)
  }
  const itemVariationStoreOffset = reader.readUint32()
  const advanceWidthMappingOffset = reader.readUint32()
  const lsbMappingOffset = reader.readUint32()
  const rsbMappingOffset = reader.readUint32()
  validateHvarOffset(itemVariationStoreOffset, tableStart, reader.length, 'itemVariationStoreOffset', false)
  validateHvarOffset(advanceWidthMappingOffset, tableStart, reader.length, 'advanceWidthMappingOffset', true)
  validateHvarOffset(lsbMappingOffset, tableStart, reader.length, 'lsbMappingOffset', true)
  validateHvarOffset(rsbMappingOffset, tableStart, reader.length, 'rsbMappingOffset', true)
  if ((lsbMappingOffset === 0) !== (rsbMappingOffset === 0)) {
    throw new Error('HVAR lsbMappingOffset and rsbMappingOffset must both be present when side-bearing variations are provided')
  }

  // Parse ItemVariationStore
  const ivs = parseItemVariationStore(reader, tableStart + itemVariationStoreOffset, expectedAxisCount)

  // Parse DeltaSetIndexMap for advanceWidth
  let advWidthMap: DeltaSetIndexMap | null = null
  if (advanceWidthMappingOffset !== 0) {
    advWidthMap = parseDeltaSetIndexMap(reader, tableStart + advanceWidthMappingOffset)
    validateHvarIndexMap(ivs, advWidthMap, 'HVAR advanceWidthMapping')
  } else if (expectedGlyphCount !== undefined && expectedGlyphCount > 0) {
    validateDeltaSetIndex(ivs, 0, expectedGlyphCount - 1, 'HVAR implicit advanceWidthMapping')
  }

  // Parse DeltaSetIndexMap for LSB
  let lsbMap: DeltaSetIndexMap | null = null
  if (lsbMappingOffset !== 0) {
    lsbMap = parseDeltaSetIndexMap(reader, tableStart + lsbMappingOffset)
    validateHvarIndexMap(ivs, lsbMap, 'HVAR lsbMapping')
  }

  let rsbMap: DeltaSetIndexMap | null = null
  if (rsbMappingOffset !== 0) {
    rsbMap = parseDeltaSetIndexMap(reader, tableStart + rsbMappingOffset)
    validateHvarIndexMap(ivs, rsbMap, 'HVAR rsbMapping')
  }

  return {
    hasLsbMapping: lsbMap !== null,
    hasRsbMapping: rsbMap !== null,
    getAdvanceWidthDelta(glyphId: number, coords: number[]): number {
      const { outer, inner } = getIndices(glyphId, advWidthMap)
      return getDelta(ivs, outer, inner, coords)
    },

    getLsbDelta(glyphId: number, coords: number[]): number {
      if (!lsbMap) return 0
      const { outer, inner } = getIndices(glyphId, lsbMap)
      return getDelta(ivs, outer, inner, coords)
    },

    getRsbDelta(glyphId: number, coords: number[]): number {
      if (!rsbMap) return 0
      const { outer, inner } = getIndices(glyphId, rsbMap)
      return getDelta(ivs, outer, inner, coords)
    },
  }
}

function validateHvarOffset(offset: number, tableStart: number, tableLength: number, label: string, nullable: boolean): void {
  if (offset === 0) {
    if (nullable) return
    throw new Error(`HVAR ${label} must be non-zero`)
  }
  if (offset < HVAR_HEADER_SIZE || tableStart + offset >= tableLength) {
    throw new Error(`HVAR ${label} exceeds table length: ${offset}`)
  }
}

function validateHvarIndexMap(ivs: ItemVariationStore, map: DeltaSetIndexMap, label: string): void {
  if (map.entries.length === 0) {
    throw new Error(`${label} must contain at least one DeltaSetIndexMap entry`)
  }
  for (let i = 0; i < map.entries.length; i++) {
    const entry = map.entries[i]!
    validateDeltaSetIndex(ivs, entry.outer, entry.inner, `${label} entry ${i}`)
  }
}
