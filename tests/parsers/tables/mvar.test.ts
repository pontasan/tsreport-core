import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseMvar } from '../../../src/parsers/tables/mvar.js'

/**
 * MVAR table regression tests.
 * - offset=0 guard without IVS.
 * - Out-of-bounds IVS offsets are rejected.
 */


function buildMinimalMvar(opts: {
  valueRecords?: { tag: string, outerIndex: number, innerIndex: number }[]
  valueRecordSize?: number
  itemVariationStoreOffset?: number
  includeIVS?: boolean
  version?: { major: number, minor: number }
  reserved?: number
}): ArrayBuffer {
  const {
    valueRecords = [],
    valueRecordSize = 8,
    itemVariationStoreOffset = 0,
    includeIVS = false,
    version = { major: 1, minor: 0 },
    reserved = 0,
  } = opts

  const w = new BinaryWriter()

  // MVAR header
  w.writeUint16(version.major)
  w.writeUint16(version.minor)
  w.writeUint16(reserved)
  w.writeUint16(valueRecordSize)
  w.writeUint16(valueRecords.length)
  w.writeUint16(itemVariationStoreOffset) // itemVariationStoreOffset

  // Value records
  for (const record of valueRecords) {
    w.writeTag(record.tag)
    w.writeUint16(record.outerIndex)
    w.writeUint16(record.innerIndex)
    for (let i = 8; i < valueRecordSize; i++) w.writeUint8(0)
  }

  if (includeIVS) {
    // Minimal ItemVariationStore with one region and two zero delta-set rows.
    w.writeUint16(1) // format
    w.writeUint32(12) // variationRegionListOffset (relative to IVS start)
    w.writeUint16(1) // itemVariationDataCount
    w.writeUint32(22) // itemVariationDataOffset[0]

    // Variation region list
    w.writeUint16(1) // axisCount
    w.writeUint16(1) // regionCount
    w.writeInt16(0) // startCoord
    w.writeInt16(16384) // peakCoord
    w.writeInt16(16384) // endCoord

    // ItemVariationData
    w.writeUint16(2) // itemCount
    w.writeUint16(1) // wordDeltaCount
    w.writeUint16(1) // regionIndexCount
    w.writeUint16(0) // regionIndex[0]
    w.writeInt16(0) // deltaSet[0][0]
    w.writeInt16(0) // deltaSet[1][0]
  }

  return w.toArrayBuffer()
}

describe('MVAR テーブル リグレッション', () => {
  it('offset=0 の場合 IVS をパースせずクラッシュしない', () => {
    const buffer = buildMinimalMvar({
      itemVariationStoreOffset: 0,
    })

    const reader = new BinaryReader(buffer)
    const mvar = parseMvar(reader)

    // getMetricDelta should return 0 (no IVS)
    const delta = mvar.getMetricDelta('hasc', [0.5])
    expect(delta).toBe(0)
  })

  it('value record なしの場合は正常に処理', () => {
    const buffer = buildMinimalMvar({
      itemVariationStoreOffset: 0,
    })

    const reader = new BinaryReader(buffer)
    const mvar = parseMvar(reader)

    const delta = mvar.getMetricDelta('hasc', [0.5])
    expect(delta).toBe(0)
  })

  it('IVS オフセットが境界外の場合は拒否する', () => {
    const buffer = buildMinimalMvar({
      valueRecords: [{ tag: 'hasc', outerIndex: 0, innerIndex: 0 }],
      itemVariationStoreOffset: 9999, // beyond buffer
    })

    const reader = new BinaryReader(buffer)
    expect(() => parseMvar(reader)).toThrow(/itemVariationStoreOffset exceeds table length/)
  })

  it('存在しないタグのデルタは 0', () => {
    const buffer = buildMinimalMvar({
      itemVariationStoreOffset: 0,
    })

    const reader = new BinaryReader(buffer)
    const mvar = parseMvar(reader)

    const delta = mvar.getMetricDelta('xhgt', [0.5])
    expect(delta).toBe(0)
  })

  it('value record と IVS がある場合は正常に処理', () => {
    const buffer = buildMinimalMvar({
      valueRecords: [{ tag: 'hasc', outerIndex: 0, innerIndex: 0 }],
      itemVariationStoreOffset: 20,
      includeIVS: true,
    })

    const reader = new BinaryReader(buffer)
    const mvar = parseMvar(reader)

    expect(mvar.getMetricDelta('hasc', [0.5])).toBe(0)
  })

  it('no variation index 0xFFFF/0xFFFF は許可する', () => {
    const buffer = buildMinimalMvar({
      valueRecords: [{ tag: 'hasc', outerIndex: 0xFFFF, innerIndex: 0xFFFF }],
      itemVariationStoreOffset: 20,
      includeIVS: true,
    })

    const reader = new BinaryReader(buffer)
    const mvar = parseMvar(reader)

    expect(mvar.getMetricDelta('hasc', [1])).toBe(0)
  })

  it('私用 valueTag は大文字開始かつ大文字英数字の場合に許可する', () => {
    const buffer = buildMinimalMvar({
      valueRecords: [{ tag: 'AB12', outerIndex: 0, innerIndex: 0 }],
      itemVariationStoreOffset: 20,
      includeIVS: true,
    })

    const reader = new BinaryReader(buffer)
    const mvar = parseMvar(reader)

    expect(mvar.getMetricDelta('AB12', [0.5])).toBe(0)
  })

  it('範囲外の delta-set index を拒否する', () => {
    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      valueRecords: [{ tag: 'hasc', outerIndex: 1, innerIndex: 0 }],
      itemVariationStoreOffset: 20,
      includeIVS: true,
    })))).toThrow(/deltaSetOuterIndex/)

    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      valueRecords: [{ tag: 'hasc', outerIndex: 0, innerIndex: 2 }],
      itemVariationStoreOffset: 20,
      includeIVS: true,
    })))).toThrow(/deltaSetInnerIndex/)

    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      valueRecords: [{ tag: 'hasc', outerIndex: 0xFFFF, innerIndex: 0 }],
      itemVariationStoreOffset: 20,
      includeIVS: true,
    })))).toThrow(/deltaSetOuterIndex/)
  })

  it('不正なヘッダと value record を拒否する', () => {
    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      version: { major: 1, minor: 1 },
    })))).not.toThrow()
    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      version: { major: 2, minor: 0 },
    })))).toThrow(/Unsupported MVAR/)

    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      reserved: 1,
    })))).toThrow(/reserved/)

    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      valueRecordSize: 6,
    })))).toThrow(/valueRecordSize/)

    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      valueRecords: [{ tag: 'hasc', outerIndex: 0, innerIndex: 0 }],
      itemVariationStoreOffset: 0,
    })))).toThrow(/must be non-zero/)

    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      valueRecords: [
        { tag: 'xhgt', outerIndex: 0, innerIndex: 0 },
        { tag: 'hasc', outerIndex: 0, innerIndex: 0 },
      ],
      itemVariationStoreOffset: 28,
      includeIVS: true,
    })))).toThrow(/binary order/)

    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      valueRecords: [{ tag: 'zzzz', outerIndex: 0, innerIndex: 0 }],
      itemVariationStoreOffset: 20,
      includeIVS: true,
    })))).toThrow(/Unknown MVAR registered valueTag/)

    expect(() => parseMvar(new BinaryReader(buildMinimalMvar({
      valueRecords: [{ tag: 'HaSc', outerIndex: 0, innerIndex: 0 }],
      itemVariationStoreOffset: 20,
      includeIVS: true,
    })))).toThrow(/private valueTag/)
  })
})
