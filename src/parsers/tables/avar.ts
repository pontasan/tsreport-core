import { BinaryReader } from '../../binary/reader.js'
import { parseItemVariationStore, parseDeltaSetIndexMap, getDelta, type ItemVariationStore, type DeltaSetIndexMap } from './variation-common.js'

const AVAR_HEADER_SIZE = 8
const AVAR_VERSION_MAJOR = 1
const AVAR_VERSION_MINOR_V1 = 0
const AVAR_VERSION_MINOR_V2 = 2
const AVAR_AXIS_VALUE_MAP_SIZE = 4
const AVAR_V2_EXTENSION_SIZE = 8

/**
 * avar table: Axis Variations
 * Non-linear segment mapping of axis values
 * v1: segment maps
 * v2: + ItemVariationStore + DeltaSetIndexMap
 */

export interface AvarSegment {
  fromCoordinate: number  // F2Dot14
  toCoordinate: number    // F2Dot14
}

export interface AvarTable {
  readonly axisSegmentMaps: AvarSegment[][]
  /** Maps an axis value to a normalized coordinate (v1 only) */
  mapAxisValue(axisIndex: number, normalizedValue: number): number
  /** Maps an axis value to a normalized coordinate (applies v2 deltas when coords is given) */
  mapAxisValueV2(axisIndex: number, normalizedValue: number, coords: number[]): number
  /** Whether avar v2 data is present */
  readonly hasV2: boolean
}

export function parseAvar(reader: BinaryReader, expectedAxisCount?: number): AvarTable {
  const tableStart = reader.position
  if (reader.length - tableStart < AVAR_HEADER_SIZE) {
    throw new Error(`avar table length must be at least ${AVAR_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== AVAR_VERSION_MAJOR) {
    throw new Error(`Unsupported avar table version: ${majorVersion}.${minorVersion}`)
  }
  const reserved = reader.readUint16()
  if (reserved !== 0) {
    throw new Error(`avar reserved field must be zero, got ${reserved}`)
  }
  const axisCount = reader.readUint16()
  if (expectedAxisCount !== undefined && axisCount !== expectedAxisCount) {
    throw new Error(`avar axisCount must match fvar axis count ${expectedAxisCount}, got ${axisCount}`)
  }

  const axisSegmentMaps: AvarSegment[][] = []
  for (let i = 0; i < axisCount; i++) {
    if (reader.remaining < 2) {
      throw new Error(`avar axis ${i} segment map header exceeds table length`)
    }
    const positionMapCount = reader.readUint16()
    const needed = positionMapCount * AVAR_AXIS_VALUE_MAP_SIZE
    if (reader.remaining < needed) {
      throw new Error(`avar axis ${i} segment map exceeds table length: need ${needed}, got ${reader.remaining}`)
    }
    const segments: AvarSegment[] = []
    for (let j = 0; j < positionMapCount; j++) {
      const fromCoordinate = reader.readF2Dot14()
      const toCoordinate = reader.readF2Dot14()
      segments.push({ fromCoordinate, toCoordinate })
    }
    validateAxisSegments(segments, i)
    axisSegmentMaps.push(segments)
  }

  // avar v2 extensions
  let ivs: ItemVariationStore | null = null
  let axisIdxMap: DeltaSetIndexMap | null = null
  const hasV2 = minorVersion >= 2

  if (hasV2) {
    if (reader.remaining < AVAR_V2_EXTENSION_SIZE) {
      throw new Error(`avar v2 extension offsets exceed table length: need ${AVAR_V2_EXTENSION_SIZE}, got ${reader.remaining}`)
    }
    const axisIdxMapOffset = reader.readUint32()
    const ivsOffset = reader.readUint32()
    if (axisIdxMapOffset !== 0 && tableStart + axisIdxMapOffset >= reader.length) {
      throw new Error(`avar v2 axis index map offset exceeds table length: ${axisIdxMapOffset}`)
    }
    if (ivsOffset !== 0 && tableStart + ivsOffset >= reader.length) {
      throw new Error(`avar v2 item variation store offset exceeds table length: ${ivsOffset}`)
    }

    if (ivsOffset !== 0) {
      ivs = parseItemVariationStore(reader, tableStart + ivsOffset, axisCount)
    }
    if (axisIdxMapOffset !== 0) {
      axisIdxMap = parseDeltaSetIndexMap(reader, tableStart + axisIdxMapOffset)
    }
  }

  return {
    axisSegmentMaps,
    hasV2,
    mapAxisValue(axisIndex: number, normalizedValue: number): number {
      if (axisIndex < 0 || axisIndex >= axisSegmentMaps.length) return normalizedValue
      const segments = axisSegmentMaps[axisIndex]!
      if (segments.length === 0) return normalizedValue

      // Piecewise linear interpolation
      if (normalizedValue <= segments[0]!.fromCoordinate) {
        return segments[0]!.toCoordinate
      }
      if (normalizedValue >= segments[segments.length - 1]!.fromCoordinate) {
        return segments[segments.length - 1]!.toCoordinate
      }

      for (let i = 0; i < segments.length - 1; i++) {
        const s0 = segments[i]!, s1 = segments[i + 1]!
        if (normalizedValue >= s0.fromCoordinate && normalizedValue <= s1.fromCoordinate) {
          const t = (normalizedValue - s0.fromCoordinate) / (s1.fromCoordinate - s0.fromCoordinate)
          return s0.toCoordinate + t * (s1.toCoordinate - s0.toCoordinate)
        }
      }

      return normalizedValue
    },

    mapAxisValueV2(axisIndex: number, normalizedValue: number, coords: number[]): number {
      // First apply v1 mapping
      let result = this.mapAxisValue(axisIndex, normalizedValue)

      // Then add v2 delta
      if (ivs && hasV2) {
        let outer: number
        let inner: number
        if (axisIdxMap) {
          if (axisIndex >= axisIdxMap.entries.length) {
            if (axisIdxMap.entries.length === 0) {
              outer = 0; inner = 0
            } else {
              const last = axisIdxMap.entries[axisIdxMap.entries.length - 1]!
              outer = last.outer; inner = last.inner
            }
          } else {
            const entry = axisIdxMap.entries[axisIndex]!
            outer = entry.outer; inner = entry.inner
          }
        } else {
          outer = 0; inner = axisIndex
        }
        const delta = getDelta(ivs, outer, inner, coords)
        // Delta is in F2Dot14 scale (divide by 16384)
        result += delta / 16384
      }

      return result
    },
  }
}

function validateAxisSegments(segments: AvarSegment[], axisIndex: number): void {
  if (segments.length === 0) return
  if (segments.length < 3) {
    throw new Error(`avar axis ${axisIndex} segment map must contain at least three value maps`)
  }
  let hasMinusOne = false
  let hasZero = false
  let hasOne = false
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    if (i > 0) {
      const previous = segments[i - 1]!
      if (segment.fromCoordinate <= previous.fromCoordinate) {
        throw new Error(`avar axis ${axisIndex} fromCoordinate values must be strictly increasing`)
      }
      if (segment.toCoordinate < previous.toCoordinate) {
        throw new Error(`avar axis ${axisIndex} toCoordinate values must be non-decreasing`)
      }
    }
    if (segment.fromCoordinate === -1 && segment.toCoordinate === -1) hasMinusOne = true
    if (segment.fromCoordinate === 0 && segment.toCoordinate === 0) hasZero = true
    if (segment.fromCoordinate === 1 && segment.toCoordinate === 1) hasOne = true
  }
  if (!hasMinusOne || !hasZero || !hasOne) {
    throw new Error(`avar axis ${axisIndex} segment map must include -1=>-1, 0=>0, and 1=>1 mappings`)
  }
}
