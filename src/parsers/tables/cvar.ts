import { BinaryReader } from '../../binary/reader.js'

const CVAR_HEADER_SIZE = 8
const TUPLE_VARIATION_HEADER_SIZE = 4
const SHARED_POINT_NUMBERS = 0x8000
const TUPLE_VARIATION_COUNT_RESERVED_MASK = 0x7000
const TUPLE_VARIATION_COUNT_MASK = 0x0FFF
const EMBEDDED_PEAK_TUPLE = 0x8000
const INTERMEDIATE_REGION = 0x4000
const PRIVATE_POINT_NUMBERS = 0x2000
const TUPLE_INDEX_RESERVED_MASK = 0x1000

/**
 * cvar table: CVT Variations
 * Applies variation deltas to CVT table values
 */

export interface CvarTable {
  /**
   * Returns the deltas for CVT values
   * @param coords normalized axis coordinates
   * @param numCvtEntries number of entries in the CVT table
   * @returns array of deltas, one per CVT entry
   */
  getCvtDeltas(coords: number[], numCvtEntries: number): number[]
}

export function parseCvar(reader: BinaryReader, axisCount: number): CvarTable {
  const tableStart = reader.position
  if (axisCount <= 0) {
    throw new Error(`cvar axisCount must be greater than 0, got ${axisCount}`)
  }
  if (reader.length - tableStart < CVAR_HEADER_SIZE) {
    throw new Error(`cvar table length must be at least ${CVAR_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    throw new Error(`Unsupported cvar table version: ${majorVersion}.${minorVersion}`)
  }
  const tupleVariationCount = reader.readUint16()
  if (minorVersion === 0 && (tupleVariationCount & TUPLE_VARIATION_COUNT_RESERVED_MASK) !== 0) {
    throw new Error(`Unsupported cvar tupleVariationCount reserved bits: 0x${(tupleVariationCount & TUPLE_VARIATION_COUNT_RESERVED_MASK).toString(16).padStart(4, '0')}`)
  }
  const dataOffset = reader.readUint16()

  const count = tupleVariationCount & TUPLE_VARIATION_COUNT_MASK
  if (count === 0) {
    throw new Error('cvar table requires at least one tuple variation header')
  }
  if (tableStart + dataOffset > reader.length) {
    throw new Error('cvar dataOffset exceeds table length')
  }
  if (dataOffset < CVAR_HEADER_SIZE) {
    throw new Error(`cvar dataOffset must be at least ${CVAR_HEADER_SIZE}, got ${dataOffset}`)
  }
  const sharedPointNumbers = (tupleVariationCount & SHARED_POINT_NUMBERS) !== 0

  const serializedDataStart = tableStart + dataOffset
  const tableEnd = reader.length

  // Shared point numbers
  let sharedPoints: number[] | null = null
  if (sharedPointNumbers) {
    reader.seek(serializedDataStart)
    sharedPoints = readPackedPoints(reader, tableEnd)
  }

  // Tuple variation headers
  reader.seek(tableStart + 8) // after header
  const tupleHeaders: {
    variationDataSize: number
    tupleIndex: number
    peakTuple: number[]
    intermediateStart?: number[]
    intermediateEnd?: number[]
  }[] = []

  for (let t = 0; t < count; t++) {
    ensureCvarBytes(reader, serializedDataStart, TUPLE_VARIATION_HEADER_SIZE, `cvar tuple variation header ${t}`)
    const variationDataSize = reader.readUint16()
    const tupleIndex = reader.readUint16()
    if (minorVersion === 0 && (tupleIndex & TUPLE_INDEX_RESERVED_MASK) !== 0) {
      throw new Error(`Unsupported cvar tupleIndex reserved bit: 0x${tupleIndex.toString(16).padStart(4, '0')}`)
    }
    if ((tupleIndex & EMBEDDED_PEAK_TUPLE) === 0) {
      throw new Error(`cvar tuple variation header ${t} must include an embedded peak tuple`)
    }

    ensureCvarBytes(reader, serializedDataStart, axisCount * 2, `cvar tuple variation header ${t} peak tuple`)
    const peakTuple: number[] = []
    for (let a = 0; a < axisCount; a++) {
      peakTuple.push(reader.readF2Dot14())
    }

    let intermediateStart: number[] | undefined
    let intermediateEnd: number[] | undefined
    if (tupleIndex & INTERMEDIATE_REGION) {
      ensureCvarBytes(reader, serializedDataStart, axisCount * 4, `cvar tuple variation header ${t} intermediate tuples`)
      intermediateStart = []
      intermediateEnd = []
      for (let a = 0; a < axisCount; a++) intermediateStart.push(reader.readF2Dot14())
      for (let a = 0; a < axisCount; a++) intermediateEnd.push(reader.readF2Dot14())
    }

    tupleHeaders.push({ variationDataSize, tupleIndex, peakTuple, intermediateStart, intermediateEnd })
  }
  if (reader.position > serializedDataStart) {
    throw new Error('cvar tuple variation headers exceed dataOffset')
  }

  return {
    getCvtDeltas(coords: number[], numCvtEntries: number): number[] {
      const deltas = new Array(numCvtEntries).fill(0) as number[]

      let serializedOffset = serializedDataStart
      if (sharedPointNumbers) {
        reader.seek(serializedDataStart)
        readPackedPoints(reader, tableEnd) // skip shared points
        serializedOffset = reader.position
      }

      for (const header of tupleHeaders) {
        const tupleDataStart = serializedOffset
        const tupleDataEnd = tupleDataStart + header.variationDataSize
        if (tupleDataEnd > tableEnd) {
          throw new Error('cvar tuple variation serialized data exceeds table length')
        }

        let scalar = 1.0
        for (let a = 0; a < axisCount; a++) {
          const peak = header.peakTuple[a]!
          if (peak === 0) continue
          const coord = coords[a] ?? 0
          if (header.intermediateStart && header.intermediateEnd) {
            const start = header.intermediateStart[a]!
            const end = header.intermediateEnd[a]!
            if (coord < start || coord > end) { scalar = 0; break }
            if (coord < peak) scalar *= (peak === start) ? 1 : (coord - start) / (peak - start)
            else if (coord > peak) scalar *= (peak === end) ? 1 : (end - coord) / (end - peak)
          } else {
            if ((coord < 0 && peak > 0) || (coord > 0 && peak < 0)) { scalar = 0; break }
            if (coord === 0) { scalar = 0; break }
            if (Math.abs(coord) < Math.abs(peak)) scalar *= coord / peak
          }
        }

        if (scalar === 0) {
          serializedOffset = tupleDataEnd
          continue
        }

        reader.seek(tupleDataStart)
        const hasPrivatePoints = (header.tupleIndex & PRIVATE_POINT_NUMBERS) !== 0
        const points = hasPrivatePoints ? readPackedPoints(reader, tupleDataEnd) : sharedPoints
        validateCvarPointIndices(points, numCvtEntries)
        const numDeltas = points ? points.length : numCvtEntries
        const deltasArr = readPackedDeltas(reader, numDeltas, tupleDataEnd)

        serializedOffset = tupleDataEnd

        if (points) {
          for (let i = 0; i < points.length; i++) {
            const pi = points[i]!
            deltas[pi] = deltas[pi]! + deltasArr[i]! * scalar
          }
        } else {
          for (let i = 0; i < numCvtEntries && i < numDeltas; i++) {
            deltas[i] = deltas[i]! + deltasArr[i]! * scalar
          }
        }
      }

      return deltas
    },
  }
}

function ensureCvarBytes(reader: BinaryReader, limit: number, byteLength: number, label: string): void {
  if (reader.position + byteLength > limit) {
    throw new Error(`${label} exceeds cvar table length`)
  }
}

function readPackedPoints(reader: BinaryReader, limit: number): number[] | null {
  ensureCvarBytes(reader, limit, 1, 'cvar packed point count')
  const count = reader.readUint8()
  if (count === 0) return null
  let totalCount = count
  if (count >= 128) {
    ensureCvarBytes(reader, limit, 1, 'cvar packed point count')
    totalCount = ((count & 0x7F) << 8) | reader.readUint8()
  }

  const points: number[] = []
  let pointIndex = 0
  let previousPointIndex = -1
  while (points.length < totalCount) {
    ensureCvarBytes(reader, limit, 1, 'cvar packed point run')
    const controlByte = reader.readUint8()
    const runCount = (controlByte & 0x7F) + 1
    if (points.length + runCount > totalCount) {
      throw new Error('cvar packed point run exceeds declared point count')
    }
    const isWord = (controlByte & 0x80) !== 0
    for (let i = 0; i < runCount; i++) {
      if (isWord) {
        ensureCvarBytes(reader, limit, 2, 'cvar packed point run')
        pointIndex += reader.readUint16()
      } else {
        ensureCvarBytes(reader, limit, 1, 'cvar packed point run')
        pointIndex += reader.readUint8()
      }
      if (pointIndex < previousPointIndex) {
        throw new Error('cvar packed point numbers must be in non-decreasing order')
      }
      points.push(pointIndex)
      previousPointIndex = pointIndex
    }
  }
  return points
}

function validateCvarPointIndices(points: number[] | null, numCvtEntries: number): void {
  if (points === null) return
  for (const point of points) {
    if (point >= numCvtEntries) {
      throw new Error(`cvar CVT index ${point} out of range ${numCvtEntries}`)
    }
  }
}

function readPackedDeltas(reader: BinaryReader, count: number, limit: number): number[] {
  const deltas: number[] = []
  while (deltas.length < count) {
    ensureCvarBytes(reader, limit, 1, 'cvar packed delta run')
    const controlByte = reader.readUint8()
    const runCount = (controlByte & 0x3F) + 1
    if (deltas.length + runCount > count) {
      throw new Error('cvar packed delta run exceeds expected delta count')
    }
    if (controlByte & 0x80) {
      for (let i = 0; i < runCount; i++) deltas.push(0)
    } else if (controlByte & 0x40) {
      ensureCvarBytes(reader, limit, runCount * 2, 'cvar packed delta word run')
      for (let i = 0; i < runCount; i++) deltas.push(reader.readInt16())
    } else {
      ensureCvarBytes(reader, limit, runCount, 'cvar packed delta byte run')
      for (let i = 0; i < runCount; i++) deltas.push(reader.readInt8())
    }
  }
  return deltas
}
