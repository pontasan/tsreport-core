import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseHvar } from '../../../src/parsers/tables/hvar.js'

/**
 * HVAR table regression tests.
 * Builds a synthetic ItemVariationStore + DeltaSetIndexMap and verifies:
 * - delta lookup with and without an advanceWidthMapping (implicit glyphId -> inner)
 * - LSB mapping presence/absence
 * - region scalar interpolation
 * - word/long-word delta encodings and multi-region accumulation
 */

const F2DOT14 = 16384

interface IvdSpec {
  regionIndices: number[]
  /** wordDeltaCount field (bit 15 = LONG_WORDS) */
  wordDeltaCount: number
  deltaSets: number[][]
}

/** Builds an ItemVariationStore. Regions: [region][axis] = [start, peak, end]. */
function buildIvs(axisCount: number, regions: number[][][], ivds: IvdSpec[]): Uint8Array {
  const headerSize = 8 + 4 * ivds.length
  const regionListSize = 4 + regions.length * axisCount * 6

  // Serialize each ItemVariationData
  const ivdBytes: Uint8Array[] = []
  for (const ivd of ivds) {
    const w = new BinaryWriter()
    w.writeUint16(ivd.deltaSets.length) // itemCount
    w.writeUint16(ivd.wordDeltaCount)
    w.writeUint16(ivd.regionIndices.length) // regionIndexCount
    for (const ri of ivd.regionIndices) w.writeUint16(ri)
    const longWords = (ivd.wordDeltaCount & 0x8000) !== 0
    const wordCount = ivd.wordDeltaCount & 0x7FFF
    for (const deltas of ivd.deltaSets) {
      for (let r = 0; r < ivd.regionIndices.length; r++) {
        if (r < wordCount) {
          if (longWords) w.writeInt32(deltas[r]!)
          else w.writeInt16(deltas[r]!)
        } else {
          if (longWords) w.writeInt16(deltas[r]!)
          else w.writeUint8(deltas[r]! & 0xFF) // int8
        }
      }
    }
    ivdBytes.push(w.toUint8Array().slice())
  }

  const w = new BinaryWriter()
  w.writeUint16(1) // format
  w.writeUint32(headerSize) // variationRegionListOffset
  w.writeUint16(ivds.length) // itemVariationDataCount
  let ivdOffset = headerSize + regionListSize
  for (const bytes of ivdBytes) {
    w.writeUint32(ivdOffset)
    ivdOffset += bytes.length
  }

  // VariationRegionList
  w.writeUint16(axisCount)
  w.writeUint16(regions.length)
  for (const region of regions) {
    for (const axis of region) {
      w.writeInt16(Math.round(axis[0]! * F2DOT14)) // startCoord
      w.writeInt16(Math.round(axis[1]! * F2DOT14)) // peakCoord
      w.writeInt16(Math.round(axis[2]! * F2DOT14)) // endCoord
    }
  }

  for (const bytes of ivdBytes) w.writeBytes(bytes)
  return w.toUint8Array().slice()
}

/** Builds a DeltaSetIndexMap (format 0 = uint16 mapCount, format 1 = uint32 mapCount) */
function buildIndexMap(
  format: 0 | 1,
  entryFormat: number,
  entries: { outer: number, inner: number }[],
): Uint8Array {
  const innerBits = (entryFormat & 0x0F) + 1
  const entrySize = ((entryFormat >> 4) & 0x03) + 1
  const w = new BinaryWriter()
  w.writeUint8(format)
  w.writeUint8(entryFormat)
  if (format === 0) w.writeUint16(entries.length)
  else w.writeUint32(entries.length)
  for (const e of entries) {
    const value = (e.outer << innerBits) | e.inner
    for (let b = entrySize - 1; b >= 0; b--) {
      w.writeUint8((value >> (b * 8)) & 0xFF)
    }
  }
  return w.toUint8Array().slice()
}

function buildHvar(
  ivs: Uint8Array,
  advWidthMap: Uint8Array | null,
  lsbMap: Uint8Array | null,
  rsbMap: Uint8Array | null = null,
  version: { major: number, minor: number } = { major: 1, minor: 0 },
): ArrayBuffer {
  const headerSize = 20
  let offset = headerSize
  const ivsOffset = offset
  offset += ivs.length
  const advOffset = advWidthMap ? offset : 0
  if (advWidthMap) offset += advWidthMap.length
  const lsbOffset = lsbMap ? offset : 0
  if (lsbMap) offset += lsbMap.length
  const rsbOffset = rsbMap ? offset : 0

  const w = new BinaryWriter()
  w.writeUint16(version.major)
  w.writeUint16(version.minor)
  w.writeUint32(ivsOffset)
  w.writeUint32(advOffset)
  w.writeUint32(lsbOffset)
  w.writeUint32(rsbOffset)
  w.writeBytes(ivs)
  if (advWidthMap) w.writeBytes(advWidthMap)
  if (lsbMap) w.writeBytes(lsbMap)
  if (rsbMap) w.writeBytes(rsbMap)
  return w.toArrayBuffer()
}

// One axis, one region spanning [0, 1.0, 1.0]
const SIMPLE_IVS = buildIvs(1, [[[0, 1.0, 1.0]]], [
  { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[100], [-50]] },
])

describe('HVAR table parser', () => {
  describe('with advanceWidthMapping', () => {
    // entryFormat 0x00: innerBits = 1, entrySize = 1; glyph 0 -> (0,0), 1 -> (0,1), 2 -> (0,0)
    const advMap = buildIndexMap(0, 0x00, [
      { outer: 0, inner: 0 },
      { outer: 0, inner: 1 },
      { outer: 0, inner: 0 },
    ])
    const buffer = buildHvar(SIMPLE_IVS, advMap, null)

    // Verifies the DeltaSetIndexMap routes each glyph to the correct delta set row.
    it('maps glyphs through the index map', () => {
      const hvar = parseHvar(new BinaryReader(buffer))
      expect(hvar.getAdvanceWidthDelta(0, [1.0])).toBe(100)
      expect(hvar.getAdvanceWidthDelta(1, [1.0])).toBe(-50)
      expect(hvar.getAdvanceWidthDelta(2, [1.0])).toBe(100)
    })

    // Verifies glyph IDs beyond mapCount reuse the last map entry (spec behavior).
    it('uses the last entry for glyphs beyond the map', () => {
      const hvar = parseHvar(new BinaryReader(buffer))
      expect(hvar.getAdvanceWidthDelta(99, [1.0])).toBe(100)
    })

    // Verifies the region scalar interpolates linearly and the result is rounded.
    it('interpolates the region scalar', () => {
      const hvar = parseHvar(new BinaryReader(buffer))
      expect(hvar.getAdvanceWidthDelta(0, [0.5])).toBe(50)
      expect(hvar.getAdvanceWidthDelta(0, [0])).toBe(0)
    })

    // Verifies LSB deltas are 0 when no lsbMapping is present.
    it('returns 0 LSB delta without lsbMapping', () => {
      const hvar = parseHvar(new BinaryReader(buffer))
      expect(hvar.getLsbDelta(0, [1.0])).toBe(0)
    })
  })

  describe('without advanceWidthMapping', () => {
    const buffer = buildHvar(SIMPLE_IVS, null, null)

    // Verifies the implicit mapping (outer 0, inner = glyphId) when the offset is 0.
    it('uses glyphId as the inner index', () => {
      const hvar = parseHvar(new BinaryReader(buffer))
      expect(hvar.getAdvanceWidthDelta(0, [1.0])).toBe(100)
      expect(hvar.getAdvanceWidthDelta(1, [1.0])).toBe(-50)
    })

    // Verifies out-of-range inner indices yield 0 instead of crashing.
    it('returns 0 for glyphs beyond the delta sets', () => {
      const hvar = parseHvar(new BinaryReader(buffer))
      expect(hvar.getAdvanceWidthDelta(10, [1.0])).toBe(0)
    })

    it('rejects implicit mappings that exceed the expected glyph count', () => {
      expect(() => parseHvar(new BinaryReader(buffer), 1, 3)).toThrow(/implicit advanceWidthMapping/)
    })
  })

  describe('with lsbMapping', () => {
    // Second IVD (outer index 1) holds LSB deltas; entryFormat 0x17: innerBits = 8, entrySize = 2
    const ivs = buildIvs(1, [[[0, 1.0, 1.0]]], [
      { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[100]] },
      { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[7]] },
      { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[9]] },
    ])
    const advMap = buildIndexMap(0, 0x17, [{ outer: 0, inner: 0 }])
    const lsbMap = buildIndexMap(0, 0x17, [{ outer: 1, inner: 0 }])
    const rsbMap = buildIndexMap(0, 0x17, [{ outer: 2, inner: 0 }])
    const buffer = buildHvar(ivs, advMap, lsbMap, rsbMap)

    // Verifies a multi-byte entry format resolves the outer index into a second IVD.
    it('resolves LSB deltas through a separate outer index', () => {
      const hvar = parseHvar(new BinaryReader(buffer))
      expect(hvar.getAdvanceWidthDelta(0, [1.0])).toBe(100)
      expect(hvar.getLsbDelta(0, [1.0])).toBe(7)
      expect(hvar.getRsbDelta(0, [1.0])).toBe(9)
    })
  })

  describe('delta encodings and multi-region accumulation', () => {
    // Verifies LONG_WORDS encoding: first delta int32, remaining deltas int16.
    it('decodes long-word (int32) deltas', () => {
      const ivs = buildIvs(1, [[[0, 1.0, 1.0]], [[-1.0, -1.0, 0]]], [
        { regionIndices: [0, 1], wordDeltaCount: 0x8000 | 1, deltaSets: [[70000, -20]] },
      ])
      const hvar = parseHvar(new BinaryReader(buildHvar(ivs, null, null)))
      expect(hvar.getAdvanceWidthDelta(0, [1.0])).toBe(70000)
      expect(hvar.getAdvanceWidthDelta(0, [-1.0])).toBe(-20)
    })

    // Verifies mixed word/int8 deltas (wordCount 1 of 2 regions) accumulate across regions.
    it('accumulates scaled deltas from overlapping regions', () => {
      // Region 0 peaks at 1.0, region 1 peaks at 0.5: at coord 0.5 both apply
      const ivs = buildIvs(1, [[[0, 1.0, 1.0]], [[0, 0.5, 1.0]]], [
        { regionIndices: [0, 1], wordDeltaCount: 1, deltaSets: [[100, 10]] },
      ])
      const hvar = parseHvar(new BinaryReader(buildHvar(ivs, null, null)))
      // 100 * 0.5 + 10 * 1.0 = 60
      expect(hvar.getAdvanceWidthDelta(0, [0.5])).toBe(60)
    })

    // Verifies a format 1 (uint32 count) DeltaSetIndexMap parses correctly.
    it('parses a format 1 index map', () => {
      const advMap = buildIndexMap(1, 0x00, [
        { outer: 0, inner: 1 },
        { outer: 0, inner: 0 },
      ])
      const hvar = parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, advMap, null)))
      expect(hvar.getAdvanceWidthDelta(0, [1.0])).toBe(-50)
      expect(hvar.getAdvanceWidthDelta(1, [1.0])).toBe(100)
    })

    it('accepts the no-variation index in DeltaSetIndexMap entries', () => {
      const advMap = buildIndexMap(1, 0x3F, [{ outer: 0xFFFF, inner: 0xFFFF }])
      const hvar = parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, advMap, null)))

      expect(hvar.getAdvanceWidthDelta(0, [1.0])).toBe(0)
    })
  })

  describe('header validation', () => {
    it('accepts compatible minor extensions and rejects unknown major versions', () => {
      expect(() => parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, null, null, null, { major: 1, minor: 1 })))).not.toThrow()
      expect(() => parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, null, null, null, { major: 2, minor: 0 })))).toThrow(/Unsupported HVAR/)
    })

    it('rejects missing item variation store offsets', () => {
      const bytes = new Uint8Array(buildHvar(SIMPLE_IVS, null, null))
      bytes[4] = 0
      bytes[5] = 0
      bytes[6] = 0
      bytes[7] = 0
      expect(() => parseHvar(new BinaryReader(bytes.buffer))).toThrow(/itemVariationStoreOffset/)
    })

    it('rejects side-bearing maps unless both LSB and RSB maps are present', () => {
      const lsbMap = buildIndexMap(0, 0x17, [{ outer: 0, inner: 0 }])
      expect(() => parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, null, lsbMap)))).toThrow(/lsbMappingOffset and rsbMappingOffset/)
    })

    it('rejects empty and out-of-range DeltaSetIndexMap entries', () => {
      expect(() => parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, buildIndexMap(0, 0x00, []), null))))
        .toThrow(/at least one DeltaSetIndexMap entry/)
      expect(() => parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, buildIndexMap(0, 0x17, [{ outer: 1, inner: 0 }]), null))))
        .toThrow(/deltaSetOuterIndex/)
      expect(() => parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, buildIndexMap(0, 0x17, [{ outer: 0, inner: 2 }]), null))))
        .toThrow(/deltaSetInnerIndex/)
      expect(() => parseHvar(new BinaryReader(buildHvar(SIMPLE_IVS, buildIndexMap(0, 0x17, [{ outer: 0xFFFF, inner: 0 }]), null))))
        .toThrow(/deltaSetOuterIndex/)
    })
  })
})
