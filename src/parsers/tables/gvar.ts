import { BinaryReader } from '../../binary/reader.js'

const GVAR_HEADER_SIZE = 20
const TUPLE_VARIATION_HEADER_SIZE = 4
const SHARED_POINT_NUMBERS = 0x8000
const TUPLE_VARIATION_COUNT_RESERVED_MASK = 0x7000
const TUPLE_VARIATION_COUNT_MASK = 0x0FFF
const EMBEDDED_PEAK_TUPLE = 0x8000
const INTERMEDIATE_REGION = 0x4000
const PRIVATE_POINT_NUMBERS = 0x2000
const TUPLE_INDEX_RESERVED_MASK = 0x1000
const TUPLE_INDEX_MASK = 0x0FFF

/**
  * Gvar table: TrueType glyph.
  * TrueType apply.
 */


export interface GvarTable {
  readonly axisCount: number
  readonly glyphCount: number
  readonly sharedTupleCount: number
  /**
   * Returns the support scalar of a global tuple for normalized coordinates.
   * AAT variable kerning vectors use the same global tuples and scalar
   * calculation as glyph variation data.
   */
  getSharedTupleScalar(tupleIndex: number, coords: readonly number[]): number
  /** Returns all global-tuple support scalars in table order. */
  getSharedTupleScalars(coords: readonly number[]): number[]
/**
    * Glyph get.
    * @param glyphId glyphID.
    * @param coords coordinate (axisCount element, -1.0 ~ 1.0)
    * @param numPoints glyph (phantom points)
    * @param contourEndPts column (IUP for, time IUP without)
    * @param originalX original X coordinatecolumn (IUP for)
    * @param originalY original Y coordinatecolumn (IUP for)
    * @returns [deltaX[], deltaY[]] — numPoints column.
 */
  
  getGlyphDeltas(
    glyphId: number,
    coords: number[],
    numPoints: number,
    contourEndPts?: Uint16Array | number[],
    originalX?: number[],
    originalY?: number[],
  ): { deltaX: number[], deltaY: number[] } | null
}

interface TupleVariation {
  peakTuple: number[]
  intermediateTuple?: { start: number[], end: number[] }
  deltas: { x: number, y: number }[]
  pointIndices: number[] | null // null = all points
}

export function parseGvar(reader: BinaryReader, expectedAxisCount?: number, expectedGlyphCount?: number): GvarTable {
  const tableStart = reader.position
  if (reader.length - tableStart < GVAR_HEADER_SIZE) {
    throw new Error(`gvar table length must be at least ${GVAR_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    throw new Error(`Unsupported gvar version: ${majorVersion}.${minorVersion}`)
  }
  const axisCount = reader.readUint16()
  if (expectedAxisCount !== undefined && axisCount !== expectedAxisCount) {
    throw new Error(`gvar axisCount must match fvar axisCount ${expectedAxisCount}, got ${axisCount}`)
  }
  const sharedTupleCount = reader.readUint16()
  const sharedTuplesOffset = reader.readUint32()
  const glyphCount = reader.readUint16()
  if (expectedGlyphCount !== undefined && glyphCount !== expectedGlyphCount) {
    throw new Error(`gvar glyphCount must match maxp.numGlyphs ${expectedGlyphCount}, got ${glyphCount}`)
  }
  const flags = reader.readUint16()
  if (minorVersion === 0 && (flags & 0xFFFE) !== 0) {
    throw new Error(`Unsupported gvar flags reserved bits: 0x${(flags & 0xFFFE).toString(16).padStart(4, '0')}`)
  }
  const glyphVariationDataArrayOffset = reader.readUint32()

  // Glyph variation data offsets
  const offsetsAreLong = (flags & 1) !== 0
  const offsetEntrySize = offsetsAreLong ? 4 : 2
  const offsetsArrayLength = (glyphCount + 1) * offsetEntrySize
  const offsetsArrayEnd = tableStart + GVAR_HEADER_SIZE + offsetsArrayLength
  if (offsetsArrayEnd > reader.length) {
    throw new Error('gvar glyph variation data offsets array exceeds table length')
  }
  const sharedTuplesLength = sharedTupleCount * axisCount * 2
  if (sharedTupleCount > 0) {
    if (sharedTuplesOffset < GVAR_HEADER_SIZE + offsetsArrayLength) {
      throw new Error('gvar sharedTuplesOffset must follow the glyph variation data offsets array')
    }
    if (tableStart + sharedTuplesOffset + sharedTuplesLength > reader.length) {
      throw new Error('gvar shared tuples array exceeds table length')
    }
  }
  const minimumGlyphDataArrayOffset = sharedTupleCount > 0
    ? sharedTuplesOffset + sharedTuplesLength
    : GVAR_HEADER_SIZE + offsetsArrayLength
  if (glyphVariationDataArrayOffset < minimumGlyphDataArrayOffset) {
    throw new Error('gvar glyphVariationDataArrayOffset must follow the header, offsets array, and shared tuples')
  }
  if (tableStart + glyphVariationDataArrayOffset > reader.length) {
    throw new Error('gvar glyphVariationDataArrayOffset exceeds table length')
  }

  const glyphOffsets: number[] = []
  for (let i = 0; i <= glyphCount; i++) {
    if (offsetsAreLong) {
      glyphOffsets.push(reader.readUint32())
    } else {
      glyphOffsets.push(reader.readUint16() * 2) // short offsets are stored divided by 2
    }
    if (i > 0 && glyphOffsets[i]! < glyphOffsets[i - 1]!) {
      throw new Error(`gvar glyph variation data offset ${i} is before the previous offset`)
    }
    if (tableStart + glyphVariationDataArrayOffset + glyphOffsets[i]! > reader.length) {
      throw new Error(`gvar glyph variation data offset ${i} exceeds table length`)
    }
  }

  // Shared Tuples
  const sharedTuples: number[][] = []
  if (sharedTupleCount > 0) {
    reader.seek(tableStart + sharedTuplesOffset)
    for (let i = 0; i < sharedTupleCount; i++) {
      const tuple: number[] = []
      for (let a = 0; a < axisCount; a++) {
        tuple.push(reader.readF2Dot14())
      }
      sharedTuples.push(tuple)
    }
  }

  return {
    axisCount,
    glyphCount,
    sharedTupleCount,

    getSharedTupleScalar(tupleIndex: number, coords: readonly number[]): number {
      if (tupleIndex < 0 || tupleIndex >= sharedTuples.length) {
        throw new Error(`gvar shared tuple index ${tupleIndex} out of range ${sharedTuples.length}`)
      }
      return calculateTupleScalar(sharedTuples[tupleIndex]!, coords)
    },

    getSharedTupleScalars(coords: readonly number[]): number[] {
      const scalars = new Array<number>(sharedTuples.length)
      for (let i = 0; i < sharedTuples.length; i++) {
        scalars[i] = calculateTupleScalar(sharedTuples[i]!, coords)
      }
      return scalars
    },

    getGlyphDeltas(
      glyphId: number,
      coords: number[],
      numPoints: number,
      contourEndPts?: Uint16Array | number[],
      originalX?: number[],
      originalY?: number[],
    ): { deltaX: number[], deltaY: number[] } | null {
      // IUP forpossibledetect (informationoriginalcoordinaterequired)
      
      const hasIup = contourEndPts && contourEndPts.length > 0 && originalX && originalY
      const numGlyphPoints = hasIup ? contourEndPts[contourEndPts.length - 1]! + 1 : 0
      if (glyphId >= glyphCount) return null
      const dataOffset = glyphOffsets[glyphId]!
      const dataEnd = glyphOffsets[glyphId + 1]!
      if (dataOffset === dataEnd) return null // no variation data

      const dataStart = tableStart + glyphVariationDataArrayOffset + dataOffset
      const glyphDataEnd = tableStart + glyphVariationDataArrayOffset + dataEnd
      if (glyphDataEnd - dataStart < 4) {
        throw new Error(`gvar glyph ${glyphId} variation data length must be at least 4 bytes`)
      }
      reader.seek(dataStart)

      const tupleVariationCount = reader.readUint16()
      if ((tupleVariationCount & TUPLE_VARIATION_COUNT_RESERVED_MASK) !== 0) {
        throw new Error(`Unsupported gvar tupleVariationCount reserved bits: 0x${(tupleVariationCount & TUPLE_VARIATION_COUNT_RESERVED_MASK).toString(16).padStart(4, '0')}`)
      }
      const dataOff = reader.readUint16()

      const count = tupleVariationCount & TUPLE_VARIATION_COUNT_MASK
      if (count === 0) {
        throw new Error(`gvar glyph ${glyphId} variation data requires at least one tuple variation header`)
      }
      if (dataOff < 4 || dataStart + dataOff > glyphDataEnd) {
        throw new Error(`gvar glyph ${glyphId} dataOffset exceeds glyph variation data length`)
      }
      const sharedPointNumbers = (tupleVariationCount & SHARED_POINT_NUMBERS) !== 0
      const serializedDataStart = dataStart + dataOff

      // Read tuple variation headers (position is at dataStart + 4, right after the 2 header fields)
      const tupleHeaders: {
        variationDataSize: number
        tupleIndex: number
        peakTuple: number[]
        intermediateStart?: number[]
        intermediateEnd?: number[]
      }[] = []

      for (let t = 0; t < count; t++) {
        ensureGvarBytes(reader, serializedDataStart, TUPLE_VARIATION_HEADER_SIZE, `gvar glyph ${glyphId} tuple variation header ${t}`)
        const variationDataSize = reader.readUint16()
        const tupleIndex = reader.readUint16()
        if ((tupleIndex & TUPLE_INDEX_RESERVED_MASK) !== 0) {
          throw new Error(`Unsupported gvar tupleIndex reserved bit: 0x${tupleIndex.toString(16).padStart(4, '0')}`)
        }

        let peakTuple: number[]
        if (tupleIndex & EMBEDDED_PEAK_TUPLE) {
          // Embedded peak tuple
          ensureGvarBytes(reader, serializedDataStart, axisCount * 2, `gvar glyph ${glyphId} tuple variation header ${t} peak tuple`)
          peakTuple = []
          for (let a = 0; a < axisCount; a++) {
            peakTuple.push(reader.readF2Dot14())
          }
        } else {
          const sharedIdx = tupleIndex & TUPLE_INDEX_MASK
          if (sharedIdx >= sharedTuples.length) {
            throw new Error(`gvar shared tuple index ${sharedIdx} out of range ${sharedTuples.length}`)
          }
          peakTuple = sharedTuples[sharedIdx]!
        }

        let intermediateStart: number[] | undefined
        let intermediateEnd: number[] | undefined
        if (tupleIndex & INTERMEDIATE_REGION) {
          ensureGvarBytes(reader, serializedDataStart, axisCount * 4, `gvar glyph ${glyphId} tuple variation header ${t} intermediate tuples`)
          intermediateStart = []
          intermediateEnd = []
          for (let a = 0; a < axisCount; a++) {
            intermediateStart.push(reader.readF2Dot14())
          }
          for (let a = 0; a < axisCount; a++) {
            intermediateEnd.push(reader.readF2Dot14())
          }
        }

        tupleHeaders.push({ variationDataSize, tupleIndex, peakTuple, intermediateStart, intermediateEnd })
      }
      if (reader.position > serializedDataStart) {
        throw new Error(`gvar glyph ${glyphId} tuple variation headers exceed dataOffset`)
      }

      // Shared point numbers (read after tuple headers to preserve reader position)
      let sharedPoints: number[] | null = null
      let serializedOffset = serializedDataStart
      if (sharedPointNumbers) {
        reader.seek(serializedDataStart)
        sharedPoints = readPackedPoints(reader, glyphDataEnd)
        serializedOffset = reader.position
      }

      // Apply tuple variations
      const deltaX = new Array(numPoints).fill(0) as number[]
      const deltaY = new Array(numPoints).fill(0) as number[]

      for (const header of tupleHeaders) {
        const tupleDataStart = serializedOffset
        const tupleDataEnd = tupleDataStart + header.variationDataSize
        if (tupleDataEnd > glyphDataEnd) {
          throw new Error(`gvar glyph ${glyphId} tuple variation serialized data exceeds glyph variation data length`)
        }

        // Calculate scalar
        const scalar = calculateTupleScalar(
          header.peakTuple,
          coords,
          header.intermediateStart,
          header.intermediateEnd,
        )

        if (scalar === 0) {
          serializedOffset = tupleDataEnd
          continue
        }

        // Read serialized data
        reader.seek(tupleDataStart)

        let points: number[] | null
        const hasPrivatePoints = (header.tupleIndex & PRIVATE_POINT_NUMBERS) !== 0
        if (hasPrivatePoints) {
          points = readPackedPoints(reader, tupleDataEnd)
        } else {
          points = sharedPoints
        }
        validatePointIndices(points, numPoints)

        const numDeltas = points ? points.length : numPoints
        const deltasX = readPackedDeltas(reader, numDeltas, tupleDataEnd)
        const deltasY = readPackedDeltas(reader, numDeltas, tupleDataEnd)

        serializedOffset = tupleDataEnd

        // Apply deltas
        if (points) {
          if (hasIup) {
            // Per-tuple delta arrays for IUP
            const tupleDx = new Array(numGlyphPoints).fill(0) as number[]
            const tupleDy = new Array(numGlyphPoints).fill(0) as number[]
            const touched = new Array(numGlyphPoints).fill(false) as boolean[]

            for (let i = 0; i < points.length; i++) {
              const pi = points[i]!
              if (pi < numGlyphPoints) {
                tupleDx[pi] = tupleDx[pi]! + deltasX[i]!
                tupleDy[pi] = tupleDy[pi]! + deltasY[i]!
                touched[pi] = true
              } else if (pi < numPoints) {
                // Phantom points — no IUP, apply directly
                deltaX[pi] = deltaX[pi]! + deltasX[i]! * scalar
                deltaY[pi] = deltaY[pi]! + deltasY[i]! * scalar
              }
            }

            // IUP: interpolate untouched points within each contour
            iupInterpolateDeltas(contourEndPts, originalX, originalY, tupleDx, tupleDy, touched)

            // Add scaled per-tuple deltas to cumulative result
            for (let i = 0; i < numGlyphPoints; i++) {
              deltaX[i] = deltaX[i]! + tupleDx[i]! * scalar
              deltaY[i] = deltaY[i]! + tupleDy[i]! * scalar
            }
          } else {
            // Without simple-glyph contour data, only explicit deltas can be applied.
            for (let i = 0; i < points.length; i++) {
              const pi = points[i]!
              if (pi < numPoints) {
                deltaX[pi] = deltaX[pi]! + deltasX[i]! * scalar
                deltaY[pi] = deltaY[pi]! + deltasY[i]! * scalar
              }
            }
          }
        } else {
          for (let i = 0; i < numPoints && i < numDeltas; i++) {
            deltaX[i] = deltaX[i]! + deltasX[i]! * scalar
            deltaY[i] = deltaY[i]! + deltasY[i]! * scalar
          }
        }
      }

      return { deltaX, deltaY }
    },
  }
}

/**
 * Calculates an OpenType tuple support scalar. This is shared by glyph
 * variation data and AAT variable kerning, which references gvar global tuples.
 */
export function calculateTupleScalar(
  peakTuple: readonly number[],
  coords: readonly number[],
  intermediateStart?: readonly number[],
  intermediateEnd?: readonly number[],
): number {
  let scalar = 1
  for (let a = 0; a < peakTuple.length; a++) {
    const peak = peakTuple[a]!
    if (peak === 0) continue

    const coord = coords[a] ?? 0
    if (intermediateStart !== undefined && intermediateEnd !== undefined) {
      const start = intermediateStart[a]!
      const end = intermediateEnd[a]!
      if (coord < start || coord > end) return 0
      if (coord < peak) {
        scalar *= peak === start ? 1 : (coord - start) / (peak - start)
      } else if (coord > peak) {
        scalar *= peak === end ? 1 : (end - coord) / (end - peak)
      }
    } else {
      if ((coord < 0 && peak > 0) || (coord > 0 && peak < 0) || coord === 0) return 0
      if (Math.abs(coord) < Math.abs(peak)) scalar *= coord / peak
    }
  }
  return scalar
}

function ensureGvarBytes(reader: BinaryReader, limit: number, byteLength: number, label: string): void {
  if (reader.position + byteLength > limit) {
    throw new Error(`${label} exceeds glyph variation data length`)
  }
}

function readPackedPoints(reader: BinaryReader, limit: number): number[] | null {
  ensureGvarBytes(reader, limit, 1, 'gvar packed point count')
  const count = reader.readUint8()
  if (count === 0) return null // all points

  let totalCount = count
  if (count >= 128) {
    ensureGvarBytes(reader, limit, 1, 'gvar packed point count')
    totalCount = ((count & 0x7F) << 8) | reader.readUint8()
  }

  const points: number[] = []
  let pointIndex = 0
  let previousPointIndex = -1
  while (points.length < totalCount) {
    ensureGvarBytes(reader, limit, 1, 'gvar packed point run')
    const controlByte = reader.readUint8()
    const runCount = (controlByte & 0x7F) + 1
    if (points.length + runCount > totalCount) {
      throw new Error('gvar packed point run exceeds declared point count')
    }
    const isWord = (controlByte & 0x80) !== 0

    for (let i = 0; i < runCount; i++) {
      if (isWord) {
        ensureGvarBytes(reader, limit, 2, 'gvar packed point run')
        pointIndex += reader.readUint16()
      } else {
        ensureGvarBytes(reader, limit, 1, 'gvar packed point run')
        pointIndex += reader.readUint8()
      }
      if (pointIndex < previousPointIndex) {
        throw new Error('gvar packed point numbers must be in non-decreasing order')
      }
      points.push(pointIndex)
      previousPointIndex = pointIndex
    }
  }

  return points
}

function validatePointIndices(points: number[] | null, numPoints: number): void {
  if (points === null) return
  for (const point of points) {
    if (point >= numPoints) {
      throw new Error(`gvar point index ${point} out of range ${numPoints}`)
    }
  }
}

/**
  * Each with, set.
  * Set from.
 */

function iupInterpolateDeltas(
  contourEndPts: Uint16Array | number[],
  originalX: number[],
  originalY: number[],
  deltaX: number[],
  deltaY: number[],
  touched: boolean[],
): void {
  let contourStart = 0
  for (let c = 0; c < contourEndPts.length; c++) {
    const contourEnd = contourEndPts[c]!

    // Touched collect.
    
    const touchedIndices: number[] = []
    for (let i = contourStart; i <= contourEnd; i++) {
      if (touched[i]) touchedIndices.push(i)
    }

    if (touchedIndices.length > 0 && touchedIndices.length < contourEnd - contourStart + 1) {
      // Case IUP row.
      
      for (let ti = 0; ti < touchedIndices.length; ti++) {
        const tA = touchedIndices[ti]!
        const tB = touchedIndices[(ti + 1) % touchedIndices.length]!

        // TA -> tB ()
        
        let p = tA
        while (true) {
          p++
          if (p > contourEnd) p = contourStart
          if (p === tB) break

          deltaX[p] = iupDelta(
            originalX[p]!, originalX[tA]!, deltaX[tA]!, originalX[tB]!, deltaX[tB]!,
          )
          deltaY[p] = iupDelta(
            originalY[p]!, originalY[tA]!, deltaY[tA]!, originalY[tB]!, deltaY[tB]!,
          )
        }
      }
    }

    contourStart = contourEnd + 1
  }
}

/**
  * IUP 1nextoriginal.
  * Coordinate2 case,.
  * Rangecase for.
 */

function iupDelta(
  origP: number, origA: number, deltaA: number, origB: number, deltaB: number,
): number {
  if (origA === origB) {
    return deltaA === deltaB ? deltaA : 0
  }

  let lo: number, hi: number, dLo: number, dHi: number
  if (origA < origB) {
    lo = origA; hi = origB; dLo = deltaA; dHi = deltaB
  } else {
    lo = origB; hi = origA; dLo = deltaB; dHi = deltaA
  }

  if (origP <= lo) return dLo
  if (origP >= hi) return dHi

  // Interpolate between the two surrounding variation region deltas.
  return dLo + (dHi - dLo) * (origP - lo) / (hi - lo)
}

function readPackedDeltas(reader: BinaryReader, count: number, limit: number): number[] {
  const deltas: number[] = []
  while (deltas.length < count) {
    ensureGvarBytes(reader, limit, 1, 'gvar packed delta run')
    const controlByte = reader.readUint8()
    const runCount = (controlByte & 0x3F) + 1
    if (deltas.length + runCount > count) {
      throw new Error('gvar packed delta run exceeds expected delta count')
    }

    if (controlByte & 0x80) {
      // Zeros
      for (let i = 0; i < runCount; i++) {
        deltas.push(0)
      }
    } else if (controlByte & 0x40) {
      // Words (Int16)
      ensureGvarBytes(reader, limit, runCount * 2, 'gvar packed delta word run')
      for (let i = 0; i < runCount; i++) {
        deltas.push(reader.readInt16())
      }
    } else {
      // Bytes (Int8)
      ensureGvarBytes(reader, limit, runCount, 'gvar packed delta byte run')
      for (let i = 0; i < runCount; i++) {
        deltas.push(reader.readInt8())
      }
    }
  }

  return deltas
}
