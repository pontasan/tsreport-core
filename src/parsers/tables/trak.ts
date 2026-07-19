import { BinaryReader } from '../../binary/reader.js'

/**
 * trak table: Tracking (Apple AAT)
 * Per-size letter spacing adjustment values
 */

export interface TrakEntry {
  track: number    // Fixed 16.16 tracking value
  nameIndex: number
  values: number[] // per-size tracking values (Int16)
}

export interface TrakData {
  nTracks: number
  nSizes: number
  sizeTable: number[] // Fixed 16.16 point sizes
  entries: TrakEntry[]
}

export interface TrakTable {
  readonly horizData: TrakData | null
  readonly vertData: TrakData | null
  /**
   * Get the adjustment value for the given tracking value and point size
   * @param horizontal true=horizontal, false=vertical
   * @param trackValue tracking value (Fixed 16.16)
   * @param pointSize point size
   */
  getTracking(horizontal: boolean, trackValue: number, pointSize: number): number
}

function parseTrakData(reader: BinaryReader, tableStart: number, offset: number): TrakData | null {
  if (offset === 0) return null

  const dataStart = tableStart + offset
  validateTrackDataOffset(reader, dataStart, 'trak TrackData offset')
  validateRange(reader, dataStart, 8, 'trak TrackData header')
  reader.seek(dataStart)
  const nTracks = reader.readUint16()
  const nSizes = reader.readUint16()
  const sizeTableOffset = reader.readUint32()
  if (nTracks === 0) {
    throw new Error('trak TrackData nTracks must be greater than zero')
  }
  if (nSizes === 0) {
    throw new Error('trak TrackData nSizes must be greater than zero')
  }

  const trackEntriesEnd = dataStart + 8 + nTracks * 8
  validateRange(reader, dataStart, 8 + nTracks * 8, 'trak TrackData track entries')
  const sizeTableStart = tableStart + sizeTableOffset
  if (sizeTableStart < trackEntriesEnd) {
    throw new Error('trak sizeTableOffset overlaps TrackData header or track entries')
  }
  validateRange(reader, sizeTableStart, nSizes * 4, 'trak size table')

  // Read track entries (saving valuesOffset for later)
  const trackHeaders: { track: number, nameIndex: number, valuesOffset: number }[] = []
  let previousTrack = Number.NEGATIVE_INFINITY
  for (let i = 0; i < nTracks; i++) {
    const track = reader.readFixed()
    const nameIndex = reader.readUint16()
    const valuesOffset = reader.readUint16()
    if (track <= previousTrack) {
      throw new Error(`trak track entries must be sorted by increasing track value at index ${i}`)
    }
    validateNameIndex(nameIndex, `trak track ${i} nameIndex`)
    const valuesStart = tableStart + valuesOffset
    if (valuesStart < trackEntriesEnd) {
      throw new Error(`trak track ${i} values offset overlaps TrackData header or track entries`)
    }
    validateRange(reader, valuesStart, nSizes * 2, `trak track ${i} values`)
    trackHeaders.push({ track, nameIndex, valuesOffset })
    previousTrack = track
  }

  // Read size table
  const sizeTable: number[] = []
  reader.seek(sizeTableStart)
  let previousSize = Number.NEGATIVE_INFINITY
  for (let i = 0; i < nSizes; i++) {
    const size = reader.readFixed()
    if (size <= previousSize) {
      throw new Error(`trak size table entries must be sorted by increasing point size at index ${i}`)
    }
    sizeTable.push(size)
    previousSize = size
  }

  // Read per-track values using saved offsets
  const entries: TrakEntry[] = []
  for (let i = 0; i < nTracks; i++) {
    const h = trackHeaders[i]!
    reader.seek(tableStart + h.valuesOffset)
    const values: number[] = []
    for (let j = 0; j < nSizes; j++) {
      values.push(reader.readInt16())
    }
    entries.push({ track: h.track, nameIndex: h.nameIndex, values })
  }

  return { nTracks, nSizes, sizeTable, entries }
}

function interpolateTracking(data: TrakData, trackValue: number, pointSize: number): number {
  if (data.nTracks === 0) return 0

  // Find bracketing tracks
  let trackIdx0 = -1
  let trackIdx1 = -1

  for (let i = 0; i < data.nTracks - 1; i++) {
    if (data.entries[i]!.track <= trackValue && data.entries[i + 1]!.track >= trackValue) {
      trackIdx0 = i
      trackIdx1 = i + 1
      break
    }
  }

  // Clamp to range
  if (trackIdx0 === -1) {
    if (trackValue <= data.entries[0]!.track) {
      trackIdx0 = trackIdx1 = 0
    } else {
      trackIdx0 = trackIdx1 = data.nTracks - 1
    }
  }

  // Interpolate within size table
  const val0 = interpolateSize(data, trackIdx0, pointSize)
  if (trackIdx0 === trackIdx1) return val0

  const val1 = interpolateSize(data, trackIdx1, pointSize)
  const t0 = data.entries[trackIdx0]!.track
  const t1 = data.entries[trackIdx1]!.track
  if (t0 === t1) return val0
  const t = (trackValue - t0) / (t1 - t0)
  return Math.round(val0 + t * (val1 - val0))
}

function interpolateSize(data: TrakData, trackIdx: number, pointSize: number): number {
  const entry = data.entries[trackIdx]!
  if (data.nSizes === 0) return 0
  if (data.nSizes === 1) return entry.values[0]!

  // Find bracketing sizes
  for (let i = 0; i < data.nSizes - 1; i++) {
    const s0 = data.sizeTable[i]!
    const s1 = data.sizeTable[i + 1]!
    if (pointSize >= s0 && pointSize <= s1) {
      if (s0 === s1) return entry.values[i]!
      const t = (pointSize - s0) / (s1 - s0)
      return Math.round(entry.values[i]! + t * (entry.values[i + 1]! - entry.values[i]!))
    }
  }

  // Clamp
  if (pointSize <= data.sizeTable[0]!) return entry.values[0]!
  return entry.values[data.nSizes - 1]!
}

export function parseTrak(reader: BinaryReader): TrakTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, 12, 'trak header')
  const version = reader.readUint32()
  if (version !== 0x00010000) {
    throw new Error(`Unsupported trak table version: 0x${version.toString(16).padStart(8, '0')}`)
  }
  const format = reader.readUint16()
  if (format !== 0) {
    throw new Error(`trak format must be 0, got ${format}`)
  }
  const horizOffset = reader.readUint16()
  const vertOffset = reader.readUint16()
  const reserved = reader.readUint16()
  if (reserved !== 0) {
    throw new Error(`trak reserved field must be zero, got ${reserved}`)
  }
  if (horizOffset === 0 && vertOffset === 0) {
    throw new Error('trak table must contain horizontal or vertical TrackData')
  }

  const horizData = parseTrakData(reader, tableStart, horizOffset)
  const vertData = parseTrakData(reader, tableStart, vertOffset)

  return {
    horizData,
    vertData,
    getTracking(horizontal: boolean, trackValue: number, pointSize: number): number {
      const data = horizontal ? horizData : vertData
      if (!data) return 0
      return interpolateTracking(data, trackValue, pointSize)
    },
  }
}

function validateTrackDataOffset(reader: BinaryReader, offset: number, label: string): void {
  if (offset < 12) {
    throw new Error(`${label} overlaps trak header`)
  }
  if ((offset & 3) !== 0) {
    throw new Error(`${label} must be longword aligned`)
  }
  if (offset >= reader.length) {
    throw new Error(`${label} exceeds trak table length: ${offset}`)
  }
}

function validateNameIndex(nameIndex: number, label: string): void {
  if (nameIndex <= 255 || nameIndex >= 32768) {
    throw new Error(`${label} must be greater than 255 and less than 32768, got ${nameIndex}`)
  }
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds trak table length: need ${offset + length}, got ${reader.length}`)
  }
}
