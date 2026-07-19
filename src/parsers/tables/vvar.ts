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
 * VVAR table: Vertical Metrics Variations
 * Variation deltas for vmtx
 *
 * Structure is identical to HVAR (ItemVariationStore + DeltaSetIndexMap)
 */

export interface VvarTable {
  readonly hasTsbMapping: boolean
  readonly hasBsbMapping: boolean
  readonly hasVOrgMapping: boolean
  getAdvanceHeightDelta(glyphId: number, coords: number[]): number
  getTsbDelta(glyphId: number, coords: number[]): number
  getBsbDelta(glyphId: number, coords: number[]): number
  getVOrgDelta(glyphId: number, coords: number[]): number
}

const VVAR_HEADER_SIZE = 24
const VVAR_MAJOR_VERSION = 1
const VVAR_MINOR_VERSION = 0

export function parseVvar(reader: BinaryReader, expectedAxisCount?: number, expectedGlyphCount?: number): VvarTable {
  const tableStart = reader.position
  if (reader.length - tableStart < VVAR_HEADER_SIZE) {
    throw new Error(`VVAR table length must be at least ${VVAR_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== VVAR_MAJOR_VERSION) {
    throw new Error(`Unsupported VVAR table version: ${majorVersion}.${minorVersion}`)
  }
  const itemVariationStoreOffset = reader.readUint32()
  const advanceHeightMappingOffset = reader.readUint32()
  const tsbMappingOffset = reader.readUint32()
  const bsbMappingOffset = reader.readUint32()
  const vOrgMappingOffset = reader.readUint32()
  validateVvarOffset(itemVariationStoreOffset, tableStart, reader.length, 'itemVariationStoreOffset', false)
  validateVvarOffset(advanceHeightMappingOffset, tableStart, reader.length, 'advanceHeightMappingOffset', true)
  validateVvarOffset(tsbMappingOffset, tableStart, reader.length, 'tsbMappingOffset', true)
  validateVvarOffset(bsbMappingOffset, tableStart, reader.length, 'bsbMappingOffset', true)
  validateVvarOffset(vOrgMappingOffset, tableStart, reader.length, 'vOrgMappingOffset', true)
  if ((tsbMappingOffset === 0) !== (bsbMappingOffset === 0)) {
    throw new Error('VVAR tsbMappingOffset and bsbMappingOffset must both be present when side-bearing variations are provided')
  }

  const ivs = parseItemVariationStore(reader, tableStart + itemVariationStoreOffset, expectedAxisCount)

  let advHeightMap: DeltaSetIndexMap | null = null
  if (advanceHeightMappingOffset !== 0) {
    advHeightMap = parseDeltaSetIndexMap(reader, tableStart + advanceHeightMappingOffset)
    validateVvarIndexMap(ivs, advHeightMap, 'VVAR advanceHeightMapping')
  } else if (expectedGlyphCount !== undefined && expectedGlyphCount > 0) {
    validateDeltaSetIndex(ivs, 0, expectedGlyphCount - 1, 'VVAR implicit advanceHeightMapping')
  }

  let tsbMap: DeltaSetIndexMap | null = null
  if (tsbMappingOffset !== 0) {
    tsbMap = parseDeltaSetIndexMap(reader, tableStart + tsbMappingOffset)
    validateVvarIndexMap(ivs, tsbMap, 'VVAR tsbMapping')
  }

  let bsbMap: DeltaSetIndexMap | null = null
  if (bsbMappingOffset !== 0) {
    bsbMap = parseDeltaSetIndexMap(reader, tableStart + bsbMappingOffset)
    validateVvarIndexMap(ivs, bsbMap, 'VVAR bsbMapping')
  }

  let vOrgMap: DeltaSetIndexMap | null = null
  if (vOrgMappingOffset !== 0) {
    vOrgMap = parseDeltaSetIndexMap(reader, tableStart + vOrgMappingOffset)
    validateVvarIndexMap(ivs, vOrgMap, 'VVAR vOrgMapping')
  }

  return {
    hasTsbMapping: tsbMap !== null,
    hasBsbMapping: bsbMap !== null,
    hasVOrgMapping: vOrgMap !== null,
    getAdvanceHeightDelta(glyphId: number, coords: number[]): number {
      const { outer, inner } = getIndices(glyphId, advHeightMap)
      return getDelta(ivs, outer, inner, coords)
    },

    getTsbDelta(glyphId: number, coords: number[]): number {
      if (!tsbMap) return 0
      const { outer, inner } = getIndices(glyphId, tsbMap)
      return getDelta(ivs, outer, inner, coords)
    },

    getBsbDelta(glyphId: number, coords: number[]): number {
      if (!bsbMap) return 0
      const { outer, inner } = getIndices(glyphId, bsbMap)
      return getDelta(ivs, outer, inner, coords)
    },

    getVOrgDelta(glyphId: number, coords: number[]): number {
      if (!vOrgMap) return 0
      const { outer, inner } = getIndices(glyphId, vOrgMap)
      return getDelta(ivs, outer, inner, coords)
    },
  }
}

function validateVvarOffset(offset: number, tableStart: number, tableLength: number, label: string, nullable: boolean): void {
  if (offset === 0) {
    if (nullable) return
    throw new Error(`VVAR ${label} must be non-zero`)
  }
  if (offset < VVAR_HEADER_SIZE || tableStart + offset >= tableLength) {
    throw new Error(`VVAR ${label} exceeds table length: ${offset}`)
  }
}

function validateVvarIndexMap(ivs: ItemVariationStore, map: DeltaSetIndexMap, label: string): void {
  if (map.entries.length === 0) {
    throw new Error(`${label} must contain at least one DeltaSetIndexMap entry`)
  }
  for (let i = 0; i < map.entries.length; i++) {
    const entry = map.entries[i]!
    validateDeltaSetIndex(ivs, entry.outer, entry.inner, `${label} entry ${i}`)
  }
}
