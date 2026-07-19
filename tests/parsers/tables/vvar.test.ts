import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseVvar } from '../../../src/parsers/tables/vvar.js'

/**
 * VVAR table regression tests.
 * Builds a synthetic ItemVariationStore + DeltaSetIndexMaps and verifies:
 * - advance height deltas with and without an advanceHeightMapping
 * - TSB deltas (mapping present/absent)
 * - BSB and vertical origin deltas (mapping present/absent)
 */

const F2DOT14 = 16384

interface IvdSpec {
  regionIndices: number[]
  wordDeltaCount: number
  deltaSets: number[][]
}

/** Builds an ItemVariationStore. Regions: [region][axis] = [start, peak, end]. */
function buildIvs(axisCount: number, regions: number[][][], ivds: IvdSpec[]): Uint8Array {
  const headerSize = 8 + 4 * ivds.length
  const regionListSize = 4 + regions.length * axisCount * 6

  const ivdBytes: Uint8Array[] = []
  for (const ivd of ivds) {
    const w = new BinaryWriter()
    w.writeUint16(ivd.deltaSets.length)
    w.writeUint16(ivd.wordDeltaCount)
    w.writeUint16(ivd.regionIndices.length)
    for (const ri of ivd.regionIndices) w.writeUint16(ri)
    const wordCount = ivd.wordDeltaCount & 0x7FFF
    for (const deltas of ivd.deltaSets) {
      for (let r = 0; r < ivd.regionIndices.length; r++) {
        if (r < wordCount) w.writeInt16(deltas[r]!)
        else w.writeUint8(deltas[r]! & 0xFF) // int8
      }
    }
    ivdBytes.push(w.toUint8Array().slice())
  }

  const w = new BinaryWriter()
  w.writeUint16(1) // format
  w.writeUint32(headerSize) // variationRegionListOffset
  w.writeUint16(ivds.length)
  let ivdOffset = headerSize + regionListSize
  for (const bytes of ivdBytes) {
    w.writeUint32(ivdOffset)
    ivdOffset += bytes.length
  }

  w.writeUint16(axisCount)
  w.writeUint16(regions.length)
  for (const region of regions) {
    for (const axis of region) {
      w.writeInt16(Math.round(axis[0]! * F2DOT14))
      w.writeInt16(Math.round(axis[1]! * F2DOT14))
      w.writeInt16(Math.round(axis[2]! * F2DOT14))
    }
  }

  for (const bytes of ivdBytes) w.writeBytes(bytes)
  return w.toUint8Array().slice()
}

/** Builds a format 0 DeltaSetIndexMap with entryFormat 0x17 (2-byte entries, 8 inner bits) */
function buildIndexMap(entries: { outer: number, inner: number }[]): Uint8Array {
  const w = new BinaryWriter()
  w.writeUint8(0) // format
  w.writeUint8(0x17) // entryFormat: innerBits = 8, entrySize = 2
  w.writeUint16(entries.length)
  for (const e of entries) {
    w.writeUint16((e.outer << 8) | e.inner)
  }
  return w.toUint8Array().slice()
}

function buildVvar(
  ivs: Uint8Array,
  maps: {
    advHeight?: Uint8Array
    tsb?: Uint8Array
    bsb?: Uint8Array
    vOrg?: Uint8Array
  },
  version: { major: number, minor: number } = { major: 1, minor: 0 },
): ArrayBuffer {
  const headerSize = 24
  let offset = headerSize
  const ivsOffset = offset
  offset += ivs.length
  const offsets: number[] = []
  const blocks: Uint8Array[] = []
  for (const map of [maps.advHeight, maps.tsb, maps.bsb, maps.vOrg]) {
    if (map) {
      offsets.push(offset)
      blocks.push(map)
      offset += map.length
    } else {
      offsets.push(0)
    }
  }

  const w = new BinaryWriter()
  w.writeUint16(version.major)
  w.writeUint16(version.minor)
  w.writeUint32(ivsOffset)
  w.writeUint32(offsets[0]!) // advanceHeightMappingOffset
  w.writeUint32(offsets[1]!) // tsbMappingOffset
  w.writeUint32(offsets[2]!) // bsbMappingOffset
  w.writeUint32(offsets[3]!) // vOrgMappingOffset
  w.writeBytes(ivs)
  for (const block of blocks) w.writeBytes(block)
  return w.toArrayBuffer()
}

// One axis, one region [0, 1.0, 1.0].
// IVD 0: advance height deltas, IVD 1: TSB deltas, IVD 2: BSB/vOrg deltas.
const IVS = buildIvs(1, [[[0, 1.0, 1.0]]], [
  { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[200], [-80]] },
  { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[15], [-3]] },
  { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[7], [-9]] },
])

describe('VVAR table parser', () => {
  describe('full table with all four mappings', () => {
    const buffer = buildVvar(IVS, {
      advHeight: buildIndexMap([
        { outer: 0, inner: 0 },
        { outer: 0, inner: 1 },
        { outer: 0, inner: 0 },
      ]),
      tsb: buildIndexMap([
        { outer: 1, inner: 0 },
        { outer: 1, inner: 1 },
      ]),
      bsb: buildIndexMap([
        { outer: 2, inner: 0 },
        { outer: 2, inner: 1 },
      ]),
      vOrg: buildIndexMap([
        { outer: 2, inner: 1 },
        { outer: 2, inner: 0 },
      ]),
    })

    // Verifies advance height deltas resolve through the advanceHeightMapping.
    it('resolves advance height deltas via the index map', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getAdvanceHeightDelta(0, [1.0])).toBe(200)
      expect(vvar.getAdvanceHeightDelta(1, [1.0])).toBe(-80)
      expect(vvar.getAdvanceHeightDelta(2, [1.0])).toBe(200)
    })

    // Verifies glyphs beyond the map reuse the last entry.
    it('uses the last map entry for glyphs beyond the map', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getAdvanceHeightDelta(50, [1.0])).toBe(200)
    })

    // Verifies TSB deltas resolve through the tsbMapping into a separate outer index.
    it('resolves TSB deltas via the index map', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getTsbDelta(0, [1.0])).toBe(15)
      expect(vvar.getTsbDelta(1, [1.0])).toBe(-3)
    })

    // Verifies BSB deltas resolve through the bsbMapping into a separate outer index.
    it('resolves BSB deltas via the index map', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getBsbDelta(0, [1.0])).toBe(7)
      expect(vvar.getBsbDelta(1, [1.0])).toBe(-9)
    })

    // Verifies vertical origin deltas resolve through the vOrgMapping (reversed entries).
    it('resolves vertical origin deltas via the index map', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getVOrgDelta(0, [1.0])).toBe(-9)
      expect(vvar.getVOrgDelta(1, [1.0])).toBe(7)
    })

    // Verifies glyphs beyond the bsb/vOrg maps reuse the last entry.
    it('uses the last bsb/vOrg map entry for glyphs beyond the map', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getBsbDelta(50, [1.0])).toBe(-9)
      expect(vvar.getVOrgDelta(50, [1.0])).toBe(7)
    })

    // Verifies the region scalar interpolates linearly (deltas are rounded).
    it('interpolates the region scalar', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getAdvanceHeightDelta(0, [0.5])).toBe(100)
      expect(vvar.getTsbDelta(0, [0.5])).toBe(8) // 7.5 rounded
      expect(vvar.getBsbDelta(0, [0.5])).toBe(4) // 3.5 rounded
      expect(vvar.getVOrgDelta(0, [0.5])).toBe(-4) // -4.5 rounded toward +inf
      expect(vvar.getAdvanceHeightDelta(0, [0])).toBe(0)
    })
  })

  describe('without optional mappings', () => {
    const buffer = buildVvar(IVS, {})

    // Verifies the implicit mapping (outer 0, inner = glyphId) when advanceHeightMappingOffset is 0.
    it('uses glyphId as the inner index for advance heights', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getAdvanceHeightDelta(0, [1.0])).toBe(200)
      expect(vvar.getAdvanceHeightDelta(1, [1.0])).toBe(-80)
    })

    // Verifies out-of-range inner indices yield 0 instead of crashing.
    it('returns 0 for glyphs beyond the delta sets', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getAdvanceHeightDelta(10, [1.0])).toBe(0)
    })

    it('rejects implicit mappings that exceed the expected glyph count', () => {
      expect(() => parseVvar(new BinaryReader(buffer), 1, 3)).toThrow(/implicit advanceHeightMapping/)
    })

    // Verifies TSB deltas are 0 when tsbMappingOffset is 0.
    it('returns 0 TSB delta without tsbMapping', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getTsbDelta(0, [1.0])).toBe(0)
    })

    // Verifies BSB and vOrg deltas are 0 when their mapping offsets are 0.
    it('returns 0 BSB and vOrg deltas without their mappings', () => {
      const vvar = parseVvar(new BinaryReader(buffer))
      expect(vvar.getBsbDelta(0, [1.0])).toBe(0)
      expect(vvar.getVOrgDelta(0, [1.0])).toBe(0)
    })
  })

  describe('header validation', () => {
    it('accepts compatible minor extensions and rejects unknown major versions', () => {
      expect(() => parseVvar(new BinaryReader(buildVvar(IVS, {}, { major: 1, minor: 1 })))).not.toThrow()
      expect(() => parseVvar(new BinaryReader(buildVvar(IVS, {}, { major: 2, minor: 0 })))).toThrow(/Unsupported VVAR/)
    })

    it('rejects missing item variation store offsets', () => {
      const bytes = new Uint8Array(buildVvar(IVS, {}))
      bytes[4] = 0
      bytes[5] = 0
      bytes[6] = 0
      bytes[7] = 0
      expect(() => parseVvar(new BinaryReader(bytes.buffer))).toThrow(/itemVariationStoreOffset/)
    })

    it('rejects side-bearing maps unless both TSB and BSB maps are present', () => {
      expect(() => parseVvar(new BinaryReader(buildVvar(IVS, {
        tsb: buildIndexMap([{ outer: 1, inner: 0 }]),
      })))).toThrow(/tsbMappingOffset and bsbMappingOffset/)
    })

    it('rejects empty and out-of-range DeltaSetIndexMap entries', () => {
      expect(() => parseVvar(new BinaryReader(buildVvar(IVS, {
        advHeight: buildIndexMap([]),
      })))).toThrow(/at least one DeltaSetIndexMap entry/)

      expect(() => parseVvar(new BinaryReader(buildVvar(IVS, {
        advHeight: buildIndexMap([{ outer: 3, inner: 0 }]),
      })))).toThrow(/deltaSetOuterIndex/)

      expect(() => parseVvar(new BinaryReader(buildVvar(IVS, {
        advHeight: buildIndexMap([{ outer: 0, inner: 2 }]),
      })))).toThrow(/deltaSetInnerIndex/)
    })
  })
})
