import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseAvar } from '../../../src/parsers/tables/avar.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'

/**
 * Builds a synthetic avar v1 table.
 */
function buildAvarV1(
  axisSegmentMaps: { from: number, to: number }[][],
  options: { majorVersion?: number; minorVersion?: number; reserved?: number; axisCount?: number } = {},
): ArrayBuffer {
  // Header: majorVersion(2) + minorVersion(2) + reserved(2) + axisCount(2) = 8
  // Per axis: positionMapCount(2) + entries(4 each)
  let totalSize = 8
  for (const segments of axisSegmentMaps) {
    totalSize += 2 + segments.length * 4
  }

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  view.setUint16(pos, options.majorVersion ?? 1); pos += 2 // majorVersion
  view.setUint16(pos, options.minorVersion ?? 0); pos += 2 // minorVersion = 0 (v1)
  view.setUint16(pos, options.reserved ?? 0); pos += 2 // reserved
  view.setUint16(pos, options.axisCount ?? axisSegmentMaps.length); pos += 2

  for (const segments of axisSegmentMaps) {
    view.setUint16(pos, segments.length); pos += 2
    for (const seg of segments) {
      // F2Dot14 encoding
      view.setInt16(pos, Math.round(seg.from * 16384)); pos += 2
      view.setInt16(pos, Math.round(seg.to * 16384)); pos += 2
    }
  }

  return buf
}

/**
 * Builds a synthetic avar v2 table (segment maps + DeltaSetIndexMap + ItemVariationStore).
 */
function buildAvarV2(
  axisSegmentMaps: { from: number, to: number }[][],
  axisIdxMap: { outer: number, inner: number }[] | null,
  ivsDeltas: number[][],
  ivsRegions: { start: number, peak: number, end: number }[][],
): ArrayBuffer {
  // Header: majorVersion(2) + minorVersion(2) + reserved(2) + axisCount(2) = 8
  // Segment maps: variable
  // v2 extensions: axisIdxMapOffset(4) + ivsOffset(4) = 8
  // DeltaSetIndexMap: format(1) + entryFormat(1) + mapCount(2) + entries(1 each)
  // ItemVariationStore: format(2) + regionListOffset(4) + dataCount(2) + dataOffsets(4 each)
  //   VariationRegionList: axisCount(2) + regionCount(2) + regions(6 per axis per region)
  //   ItemVariationData: itemCount(2) + wordDeltaCount(2) + regionIndexCount(2) + regionIndices(2 each) + deltas(2 each)

  let segmentMapsSize = 0
  for (const segments of axisSegmentMaps) {
    segmentMapsSize += 2 + segments.length * 4
  }

  const headerSize = 8
  const v2ExtensionSize = 8
  const axisCount = ivsRegions.length > 0 ? ivsRegions[0]!.length : axisSegmentMaps.length
  const regionCount = ivsRegions.length
  const dataCount = 1 // one ItemVariationData subtable
  const itemCount = ivsDeltas.length
  const regionIndexCount = regionCount

  // Calculate offsets
  const axisIdxMapOffset = headerSize + segmentMapsSize + v2ExtensionSize
  const axisIdxMapSize = axisIdxMap ? (4 + axisIdxMap.length) : 0 // format(1) + entryFormat(1) + count(2) + entries

  const ivsOffset = axisIdxMapOffset + axisIdxMapSize

  // IVS layout
  const ivsHeaderSize = 2 + 4 + 2 + 4 // format + regionListOffset + dataCount + dataOffset
  const regionListOffset = ivsHeaderSize
  const regionListSize = 4 + regionCount * axisCount * 6 // axisCount(2) + regionCount(2) + data
  const dataOffset = regionListOffset + regionListSize
  const dataSize = 6 + regionIndexCount * 2 + itemCount * regionIndexCount * 2

  const totalSize = ivsOffset + ivsHeaderSize + regionListSize + dataSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint16(pos, 1); pos += 2 // majorVersion
  view.setUint16(pos, 2); pos += 2 // minorVersion = 2 (v2!)
  view.setUint16(pos, 0); pos += 2 // reserved
  view.setUint16(pos, axisSegmentMaps.length); pos += 2

  // Segment maps
  for (const segments of axisSegmentMaps) {
    view.setUint16(pos, segments.length); pos += 2
    for (const seg of segments) {
      view.setInt16(pos, Math.round(seg.from * 16384)); pos += 2
      view.setInt16(pos, Math.round(seg.to * 16384)); pos += 2
    }
  }

  // v2 extensions
  view.setUint32(pos, axisIdxMap ? axisIdxMapOffset : 0); pos += 4 // axisIdxMapOffset
  view.setUint32(pos, ivsOffset); pos += 4 // ivsOffset

  // DeltaSetIndexMap (if present)
  if (axisIdxMap) {
    pos = axisIdxMapOffset
    view.setUint8(pos++, 0) // format 0
    view.setUint8(pos++, 0) // entryFormat: innerBits=1, entrySize=1
    view.setUint16(pos, axisIdxMap.length); pos += 2
    for (const entry of axisIdxMap) {
      // With entryFormat 0: innerBits=1, entrySize=1
      view.setUint8(pos++, (entry.outer << 1) | entry.inner)
    }
  }

  // ItemVariationStore
  pos = ivsOffset
  view.setUint16(pos, 1); pos += 2 // format
  view.setUint32(pos, regionListOffset); pos += 4 // regionListOffset
  view.setUint16(pos, dataCount); pos += 2 // dataCount
  view.setUint32(pos, dataOffset); pos += 4 // dataOffset[0]

  // VariationRegionList
  pos = ivsOffset + regionListOffset
  view.setUint16(pos, axisCount); pos += 2
  view.setUint16(pos, regionCount); pos += 2
  for (const region of ivsRegions) {
    for (const axis of region) {
      view.setInt16(pos, Math.round(axis.start * 16384)); pos += 2
      view.setInt16(pos, Math.round(axis.peak * 16384)); pos += 2
      view.setInt16(pos, Math.round(axis.end * 16384)); pos += 2
    }
  }

  // ItemVariationData
  pos = ivsOffset + dataOffset
  view.setUint16(pos, itemCount); pos += 2
  view.setUint16(pos, regionIndexCount); pos += 2 // wordDeltaCount (all word)
  view.setUint16(pos, regionIndexCount); pos += 2
  for (let i = 0; i < regionIndexCount; i++) {
    view.setUint16(pos, i); pos += 2 // regionIndices
  }
  for (let item = 0; item < itemCount; item++) {
    for (let r = 0; r < regionIndexCount; r++) {
      view.setInt16(pos, ivsDeltas[item]![r]!); pos += 2
    }
  }

  return buf
}

describe('avar table parser', () => {
  describe('v1', () => {
    // Verifies v1 segment maps interpolate piecewise-linearly (0.5 → 0.7) while required corner points -1/0/1 stay identity.
    it('should parse and map axis values', () => {
      const buf = buildAvarV1([
        [
          { from: -1, to: -1 },
          { from: 0, to: 0 },
          { from: 0.5, to: 0.7 },
          { from: 1, to: 1 },
        ],
      ])

      const table = parseAvar(new BinaryReader(buf))
      expect(table.hasV2).toBe(false)
      expect(table.axisSegmentMaps).toHaveLength(1)

      // Identity mapping at 0
      expect(table.mapAxisValue(0, 0)).toBeCloseTo(0, 5)
      // Mapped value at 0.5
      expect(table.mapAxisValue(0, 0.5)).toBeCloseTo(0.7, 1)
      // Identity at boundaries
      expect(table.mapAxisValue(0, -1)).toBeCloseTo(-1, 5)
      expect(table.mapAxisValue(0, 1)).toBeCloseTo(1, 5)
    })

    // Verifies that mapAxisValue for an axis index with no segment map passes the value through unchanged.
    it('should return identity for out-of-range axis', () => {
      const buf = buildAvarV1([[{ from: -1, to: -1 }, { from: 0, to: 0 }, { from: 1, to: 1 }]])
      const table = parseAvar(new BinaryReader(buf))
      expect(table.mapAxisValue(5, 0.5)).toBe(0.5)
    })

    it('should reject malformed avar headers', () => {
      expect(() => parseAvar(new BinaryReader(new ArrayBuffer(7)))).toThrow(/length/)
      expect(() => parseAvar(new BinaryReader(buildAvarV1([], { majorVersion: 2 })))).toThrow(/Unsupported avar/)
      expect(parseAvar(new BinaryReader(buildAvarV1([], { minorVersion: 1 }))).hasV2).toBe(false)
      expect(() => parseAvar(new BinaryReader(buildAvarV1([], { reserved: 1 })))).toThrow(/reserved/)
    })

    it('should reject avar axis count mismatches and truncated segment maps', () => {
      const valid = buildAvarV1([[{ from: -1, to: -1 }, { from: 0, to: 0 }, { from: 1, to: 1 }]])
      expect(() => parseAvar(new BinaryReader(valid), 2)).toThrow(/axisCount/)

      const truncated = buildAvarV1([[]])
      new DataView(truncated).setUint16(8, 1)
      expect(() => parseAvar(new BinaryReader(truncated))).toThrow(/segment map exceeds/)
    })

    it('should reject invalid avar segment map anchors and ordering', () => {
      expect(() => parseAvar(new BinaryReader(buildAvarV1([[
        { from: -1, to: -1 },
        { from: 1, to: 1 },
      ]])))).toThrow(/at least three/)

      expect(() => parseAvar(new BinaryReader(buildAvarV1([[
        { from: -1, to: -1 },
        { from: 0, to: 0 },
        { from: 0.5, to: 0.5 },
      ]])))).toThrow(/must include/)

      expect(() => parseAvar(new BinaryReader(buildAvarV1([[
        { from: -1, to: -1 },
        { from: 0, to: 0 },
        { from: 0, to: 0.2 },
        { from: 1, to: 1 },
      ]])))).toThrow(/strictly increasing/)

      expect(() => parseAvar(new BinaryReader(buildAvarV1([[
        { from: -1, to: -1 },
        { from: 0, to: 0 },
        { from: 0.5, to: -0.1 },
        { from: 1, to: 1 },
      ]])))).toThrow(/non-decreasing/)
    })

    it('should reject avar through the table manager when fvar is absent', () => {
      const buffer = buildAvarV1([[{ from: -1, to: -1 }, { from: 0, to: 0 }, { from: 1, to: 1 }]])
      const manager = new SfntTableManager({
        format: 'ttf',
        sfntVersion: 0x00010000,
        tableDirectory: new Map([['avar', { tag: 'avar', checksum: 0, offset: 0, length: buffer.byteLength }]]),
        buffer,
        offsetInBuffer: 0,
      })

      expect(() => manager.avar).toThrow(/requires table 'fvar'/)
    })
  })

  describe('v2', () => {
    // Verifies that minorVersion=2 with axisIdxMap/IVS offsets sets hasV2 on the parsed table.
    it('should detect v2 table', () => {
      const buf = buildAvarV2(
        [[{ from: -1, to: -1 }, { from: 0, to: 0 }, { from: 1, to: 1 }]],
        [{ outer: 0, inner: 0 }],
        [[100]],
        [[{ start: 0, peak: 1, end: 1 }]],
      )

      const table = parseAvar(new BinaryReader(buf))
      expect(table.hasV2).toBe(true)
    })

    // Verifies mapAxisValueV2 adds the IVS delta (scaled by the region scalar at peak coords) on top of the v1 mapping: 0.5 + 1638/16384 ≈ 0.6.
    it('should apply v2 delta to v1 mapping result', () => {
      // v1 identity mapping, v2 adds a delta
      const buf = buildAvarV2(
        [[{ from: -1, to: -1 }, { from: 0, to: 0 }, { from: 1, to: 1 }]],
        [{ outer: 0, inner: 0 }], // axis 0 → data[0] item[0]
        [[1638]], // delta = 1638 (≈ 0.1 in F2Dot14 scale: 1638/16384 ≈ 0.1)
        [[{ start: 0, peak: 1, end: 1 }]], // one region
      )

      const table = parseAvar(new BinaryReader(buf))
      // v1 maps 0.5 → 0.5 (identity)
      expect(table.mapAxisValue(0, 0.5)).toBeCloseTo(0.5, 1)

      // v2 with coords=[1] (peak) should add delta: 0.5 + 1638/16384 ≈ 0.6
      const result = table.mapAxisValueV2(0, 0.5, [1])
      expect(result).toBeCloseTo(0.6, 1)
    })

    // Verifies that at coords=[0] the region scalar is 0, so even a large stored delta contributes nothing and the v1 result is returned.
    it('should return v1 result when coords are at zero', () => {
      const buf = buildAvarV2(
        [[{ from: -1, to: -1 }, { from: 0, to: 0 }, { from: 1, to: 1 }]],
        [{ outer: 0, inner: 0 }],
        [[8192]], // large delta
        [[{ start: 0, peak: 1, end: 1 }]],
      )

      const table = parseAvar(new BinaryReader(buf))
      // At coords=[0], the region scalar is 0, so no delta
      const result = table.mapAxisValueV2(0, 0.5, [0])
      expect(result).toBeCloseTo(0.5, 1)
    })
  })
})
