import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { Font } from '../../../src/index.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseTrak } from '../../../src/parsers/tables/trak.js'

/**
  * Trak table build.
 */

function buildTrakTable(
  horizTracks: { track: number, nameIndex: number, values: number[] }[] | null,
  sizes: number[] | null,
  vertTracks: { track: number, nameIndex: number, values: number[] }[] | null = null,
  vertSizes: number[] | null = null,
): ArrayBuffer {
  // Header: version(4) + format(2) + horizOffset(2) + vertOffset(2) + reserved(2) = 12
  const headerSize = 12

  // Calculate sizes
  const nSizes = sizes?.length ?? 0
  const nVertSizes = vertSizes?.length ?? 0
  const nHorizTracks = horizTracks?.length ?? 0
  const nVertTracks = vertTracks?.length ?? 0

  // Track data header: nTracks(2) + nSizes(2) + sizeTableOffset(4) = 8
  // Per track entry: track(4=Fixed) + nameIndex(2) + valuesOffset(2) = 8
  // Size table: nSizes * 4 (Fixed)
  // Values: nTracks * nSizes * 2 (Int16)
  const trackDataHeaderSize = 8
  const trackEntrySize = 8

  let totalSize = headerSize
  let horizOffset = 0
  let vertOffset = 0

  if (nHorizTracks > 0) {
    horizOffset = totalSize
    const trackEntriesSize = nHorizTracks * trackEntrySize
    const sizeTableSize = nSizes * 4
    const valuesSize = nHorizTracks * nSizes * 2
    totalSize += trackDataHeaderSize + trackEntriesSize + sizeTableSize + valuesSize
  }

  if (nVertTracks > 0) {
    vertOffset = totalSize
    const trackEntriesSize = nVertTracks * trackEntrySize
    const sizeTableSize = nVertSizes * 4
    const valuesSize = nVertTracks * nVertSizes * 2
    totalSize += trackDataHeaderSize + trackEntriesSize + sizeTableSize + valuesSize
  }

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint32(pos, 0x00010000); pos += 4 // version 1.0
  view.setUint16(pos, 0); pos += 2 // format
  view.setUint16(pos, horizOffset); pos += 2
  view.setUint16(pos, vertOffset); pos += 2
  view.setUint16(pos, 0); pos += 2 // reserved

  // Write horizontal track data
  if (nHorizTracks > 0 && sizes) {
    const dataStart = horizOffset
    const trackEntriesStart = dataStart + trackDataHeaderSize
    const sizeTableStart = trackEntriesStart + nHorizTracks * trackEntrySize
    const valuesStart = sizeTableStart + nSizes * 4

    pos = dataStart
    view.setUint16(pos, nHorizTracks); pos += 2
    view.setUint16(pos, nSizes); pos += 2
    view.setUint32(pos, sizeTableStart); pos += 4

    // Track entries
    for (let i = 0; i < nHorizTracks; i++) {
      const t = horizTracks![i]!
      // Fixed 16.16 for track value
      view.setInt32(pos, Math.round(t.track * 65536)); pos += 4
      view.setUint16(pos, t.nameIndex); pos += 2
      view.setUint16(pos, valuesStart + i * nSizes * 2); pos += 2
    }

    // Size table (Fixed 16.16)
    pos = sizeTableStart
    for (let i = 0; i < nSizes; i++) {
      view.setInt32(pos, Math.round(sizes[i]! * 65536)); pos += 4
    }

    // Values
    pos = valuesStart
    for (let i = 0; i < nHorizTracks; i++) {
      const t = horizTracks![i]!
      for (let j = 0; j < nSizes; j++) {
        view.setInt16(pos, t.values[j]!); pos += 2
      }
    }
  }

  // Write vertical track data (similar structure)
  if (nVertTracks > 0 && vertSizes) {
    const dataStart = vertOffset
    const trackEntriesStart = dataStart + trackDataHeaderSize
    const sizeTableStart = trackEntriesStart + nVertTracks * trackEntrySize
    const valuesStart = sizeTableStart + nVertSizes * 4

    pos = dataStart
    view.setUint16(pos, nVertTracks); pos += 2
    view.setUint16(pos, nVertSizes); pos += 2
    view.setUint32(pos, sizeTableStart); pos += 4

    for (let i = 0; i < nVertTracks; i++) {
      const t = vertTracks![i]!
      view.setInt32(pos, Math.round(t.track * 65536)); pos += 4
      view.setUint16(pos, t.nameIndex); pos += 2
      view.setUint16(pos, valuesStart + i * nVertSizes * 2); pos += 2
    }

    pos = sizeTableStart
    for (let i = 0; i < nVertSizes; i++) {
      view.setInt32(pos, Math.round(vertSizes[i]! * 65536)); pos += 4
    }

    pos = valuesStart
    for (let i = 0; i < nVertTracks; i++) {
      const t = vertTracks![i]!
      for (let j = 0; j < nVertSizes; j++) {
        view.setInt16(pos, t.values[j]!); pos += 2
      }
    }
  }

  return buf
}

describe('trak table parser', () => {
  it('should parse horizontal tracking data', () => {
    const buf = buildTrakTable(
      [
        { track: 0, nameIndex: 256, values: [0, 0, 0] },
        { track: 1, nameIndex: 257, values: [10, 20, 30] },
      ],
      [9, 12, 24],
    )

    const table = parseTrak(new BinaryReader(buf))
    expect(table.horizData).not.toBeNull()
    expect(table.horizData!.nTracks).toBe(2)
    expect(table.horizData!.nSizes).toBe(3)
    expect(table.vertData).toBeNull()
  })

  it('should return 0 tracking for track value 0', () => {
    const buf = buildTrakTable(
      [
        { track: 0, nameIndex: 256, values: [0, 0, 0] },
        { track: 1, nameIndex: 257, values: [10, 20, 30] },
      ],
      [9, 12, 24],
    )

    const table = parseTrak(new BinaryReader(buf))
    expect(table.getTracking(true, 0, 12)).toBe(0)
  })

  it('should return exact tracking value at known size', () => {
    const buf = buildTrakTable(
      [
        { track: -1, nameIndex: 256, values: [-20, -10, -5] },
        { track: 0, nameIndex: 257, values: [0, 0, 0] },
        { track: 1, nameIndex: 258, values: [10, 20, 30] },
      ],
      [9, 12, 24],
    )

    const table = parseTrak(new BinaryReader(buf))
    // track=1 at size=12 → 20
    expect(table.getTracking(true, 1, 12)).toBe(20)
    // track=-1 at size=24 → -5
    expect(table.getTracking(true, -1, 24)).toBe(-5)
  })

  it('should interpolate between sizes', () => {
    const buf = buildTrakTable(
      [{ track: 1, nameIndex: 256, values: [10, 30] }],
      [10, 20],
    )

    const table = parseTrak(new BinaryReader(buf))
    // Midpoint: (10 + 30) / 2 = 20
    expect(table.getTracking(true, 1, 15)).toBe(20)
  })

  it('should clamp to first/last size', () => {
    const buf = buildTrakTable(
      [{ track: 1, nameIndex: 256, values: [10, 30] }],
      [10, 20],
    )

    const table = parseTrak(new BinaryReader(buf))
    // Below min size → first value
    expect(table.getTracking(true, 1, 5)).toBe(10)
    // Above max size → last value
    expect(table.getTracking(true, 1, 30)).toBe(30)
  })

  it('should return 0 when no horizontal data but vertical data exists', () => {
    const buf = buildTrakTable(
      null,
      null,
      [{ track: 1, nameIndex: 256, values: [15] }],
      [12],
    )

    const table = parseTrak(new BinaryReader(buf))
    expect(table.getTracking(true, 1, 12)).toBe(0)
    expect(table.getTracking(false, 1, 12)).toBe(15)
  })

  it('should clamp to first/last track value', () => {
    const buf = buildTrakTable(
      [
        { track: -1, nameIndex: 256, values: [-50] },
        { track: 1, nameIndex: 257, values: [50] },
      ],
      [12],
    )

    const table = parseTrak(new BinaryReader(buf))
    // Below min track → first track value
    expect(table.getTracking(true, -2, 12)).toBe(-50)
    // Above max track → last track value
    expect(table.getTracking(true, 2, 12)).toBe(50)
  })

  it('should interpolate between track values', () => {
    const buf = buildTrakTable(
      [
        { track: -1, nameIndex: 256, values: [-40] },
        { track: 1, nameIndex: 257, values: [40] },
      ],
      [12],
    )

    const table = parseTrak(new BinaryReader(buf))
    // Midpoint: (-40 + 40) / 2 = 0
    expect(table.getTracking(true, 0, 12)).toBe(0)
  })

  it('rejects unsupported versions', () => {
    const buf = buildTrakTable([{ track: 0, nameIndex: 256, values: [0] }], [12])
    new DataView(buf).setUint32(0, 0x00020000)

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('Unsupported trak table version')
  })

  it('rejects unsupported formats', () => {
    const buf = buildTrakTable([{ track: 0, nameIndex: 256, values: [0] }], [12])
    new DataView(buf).setUint16(4, 1)

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('trak format must be 0')
  })

  it('rejects non-zero reserved header fields', () => {
    const buf = buildTrakTable([{ track: 0, nameIndex: 256, values: [0] }], [12])
    new DataView(buf).setUint16(10, 1)

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('trak reserved field must be zero')
  })

  it('rejects tables with no TrackData', () => {
    const buf = new ArrayBuffer(12)
    const view = new DataView(buf)
    view.setUint32(0, 0x00010000)

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('trak table must contain horizontal or vertical TrackData')
  })

  it('rejects non-longword-aligned TrackData offsets', () => {
    const buf = buildTrakTable([{ track: 0, nameIndex: 256, values: [0] }], [12])
    new DataView(buf).setUint16(6, 14)

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('trak TrackData offset must be longword aligned')
  })

  it('rejects out-of-range track name indexes', () => {
    const buf = buildTrakTable([{ track: 0, nameIndex: 255, values: [0] }], [12])

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('nameIndex must be greater than 255 and less than 32768')
  })

  it('rejects unsorted track entries', () => {
    const buf = buildTrakTable([
      { track: 1, nameIndex: 256, values: [10] },
      { track: 0, nameIndex: 257, values: [0] },
    ], [12])

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('trak track entries must be sorted by increasing track value')
  })

  it('rejects unsorted size table entries', () => {
    const buf = buildTrakTable([{ track: 0, nameIndex: 256, values: [0, 0] }], [24, 12])

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('trak size table entries must be sorted by increasing point size')
  })

  it('rejects size tables that overlap track entries', () => {
    const buf = buildTrakTable([{ track: 0, nameIndex: 256, values: [0] }], [12])
    new DataView(buf).setUint32(16, 16)

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('trak sizeTableOffset overlaps TrackData header or track entries')
  })

  it('rejects value arrays that overlap track entries', () => {
    const buf = buildTrakTable([{ track: 0, nameIndex: 256, values: [0] }], [12])
    new DataView(buf).setUint16(26, 16)

    expect(() => parseTrak(new BinaryReader(buf))).toThrow('trak track 0 values offset overlaps TrackData header or track entries')
  })
})

// Real-font oracle: tracking values read from the macOS system font SF Pro's
// actual trak table via fontTools. Validates exact per-size values, size
// interpolation between entries, and track interpolation between curves.
describe('SF Pro trak matches fontTools', () => {
  const SFNS = '/System/Library/Fonts/SFNS.ttf'
  it.skipIf(!existsSync(SFNS))('resolves exact, size-interpolated, and track-interpolated values', () => {
    const font = Font.load(readFileSync(SFNS).buffer as ArrayBuffer)
    // Track 0 exact sizes: {6: 82, 12: 0, 24: 6, 28: 28, 100: 0, 138: 0}.
    expect(font.getTracking(0, 6)).toBe(82)
    expect(font.getTracking(0, 12)).toBe(0)
    expect(font.getTracking(0, 24)).toBe(6)
    expect(font.getTracking(0, 28)).toBe(28)
    expect(font.getTracking(0, 138)).toBe(0)
    // Size interpolation: 7.5 sits between 6 (82) and 9 (38) → 60.
    expect(font.getTracking(0, 7.5)).toBe(60)
    // Track interpolation at size 12: track -1 → -28, 1 → 28, 0.5 → 14.
    expect(font.getTracking(-1, 12)).toBe(-28)
    expect(font.getTracking(1, 12)).toBe(28)
    expect(font.getTracking(0.5, 12)).toBe(14)
  })
})
