import { describe, expect, it } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { getDelta, getIndices, parseDeltaSetIndexMap, parseItemVariationStore } from '../../../src/parsers/tables/variation-common.js'

const F2DOT14 = 16384

interface IvdSpec {
  readonly offset?: number
  readonly regionIndices: number[]
  readonly wordDeltaCount: number
  readonly deltaSets: number[][]
}

function writeF2Dot14(writer: BinaryWriter, value: number): void {
  writer.writeInt16(Math.round(value * F2DOT14))
}

function buildIvd(spec: IvdSpec): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(spec.deltaSets.length)
  writer.writeUint16(spec.wordDeltaCount)
  writer.writeUint16(spec.regionIndices.length)
  for (const regionIndex of spec.regionIndices) writer.writeUint16(regionIndex)
  const longWords = (spec.wordDeltaCount & 0x8000) !== 0
  const wordCount = spec.wordDeltaCount & 0x7FFF
  for (const deltaSet of spec.deltaSets) {
    for (let i = 0; i < spec.regionIndices.length; i++) {
      const delta = deltaSet[i]!
      if (i < wordCount) {
        if (longWords) writer.writeInt32(delta)
        else writer.writeInt16(delta)
      } else {
        if (longWords) writer.writeInt16(delta)
        else writer.writeUint8(delta & 0xFF)
      }
    }
  }
  return writer.toUint8Array().slice()
}

function buildIvs(
  axisCount: number,
  regions: number[][][],
  ivds: IvdSpec[],
  format = 1,
  regionCountOverride?: number,
): Uint8Array {
  const headerSize = 8 + ivds.length * 4
  const regionListOffset = headerSize
  const regionListSize = 4 + regions.length * axisCount * 6
  const ivdBytes = ivds.map((ivd) => buildIvd(ivd))
  let nextIvdOffset = headerSize + regionListSize

  const writer = new BinaryWriter()
  writer.writeUint16(format)
  writer.writeUint32(regionListOffset)
  writer.writeUint16(ivds.length)
  for (let i = 0; i < ivds.length; i++) {
    const explicitOffset = ivds[i]!.offset
    if (explicitOffset !== undefined) {
      writer.writeUint32(explicitOffset)
    } else {
      writer.writeUint32(nextIvdOffset)
      nextIvdOffset += ivdBytes[i]!.length
    }
  }
  writer.writeUint16(axisCount)
  writer.writeUint16(regionCountOverride ?? regions.length)
  for (const region of regions) {
    for (const axis of region) {
      writeF2Dot14(writer, axis[0]!)
      writeF2Dot14(writer, axis[1]!)
      writeF2Dot14(writer, axis[2]!)
    }
  }
  for (let i = 0; i < ivdBytes.length; i++) {
    if (ivds[i]!.offset !== 0) writer.writeBytes(ivdBytes[i]!)
  }
  return writer.toUint8Array().slice()
}

function buildMap(format: 0 | 1, entryFormat: number, entries: { outer: number, inner: number }[]): Uint8Array {
  const innerBits = (entryFormat & 0x0F) + 1
  const entrySize = ((entryFormat & 0x30) >> 4) + 1
  const writer = new BinaryWriter()
  writer.writeUint8(format)
  writer.writeUint8(entryFormat)
  if (format === 0) writer.writeUint16(entries.length)
  else writer.writeUint32(entries.length)
  for (const entry of entries) {
    let value = entry.outer * (2 ** innerBits) + entry.inner
    const bytes = new Uint8Array(entrySize)
    for (let i = entrySize - 1; i >= 0; i--) {
      bytes[i] = value & 0xFF
      value = Math.floor(value / 256)
    }
    writer.writeBytes(bytes)
  }
  return writer.toUint8Array().slice()
}

function readIvs(bytes: Uint8Array, expectedAxisCount?: number) {
  return parseItemVariationStore(new BinaryReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), 0, expectedAxisCount)
}

function readMap(bytes: Uint8Array) {
  return parseDeltaSetIndexMap(new BinaryReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), 0)
}

describe('OpenType variation common table formats', () => {
  it('parses ItemVariationStore data and null item data offsets', () => {
    const bytes = buildIvs(1, [[[0, 1, 1]]], [
      { offset: 0, regionIndices: [], wordDeltaCount: 0, deltaSets: [] },
      { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[120], [-40]] },
    ])
    const ivs = readIvs(bytes, 1)
    expect(ivs.data).toHaveLength(2)
    expect(getDelta(ivs, 0, 0, [1])).toBe(0)
    expect(getDelta(ivs, 1, 0, [0.5])).toBe(60)
    expect(getDelta(ivs, 1, 1, [1])).toBe(-40)
  })

  it('parses DeltaSetIndexMap format 1 entries without signed bitwise truncation', () => {
    const map = readMap(buildMap(1, 0x3F, [{ outer: 65535, inner: 65535 }]))
    expect(map.entries[0]).toEqual({ outer: 65535, inner: 65535 })
    expect(getIndices(10, map)).toEqual({ outer: 65535, inner: 65535 })
  })

  it('rejects malformed ItemVariationStore headers and offsets', () => {
    expect(() => readIvs(buildIvs(1, [[[0, 1, 1]]], [], 2))).toThrow(/format/)

    const badRegionOffset = buildIvs(1, [[[0, 1, 1]]], [])
    badRegionOffset[2] = 0
    badRegionOffset[3] = 0
    badRegionOffset[4] = 0
    badRegionOffset[5] = 7
    expect(() => readIvs(badRegionOffset)).toThrow(/variationRegionListOffset/)

    const badIvdOffset = buildIvs(1, [[[0, 1, 1]]], [
      { offset: 4, regionIndices: [0], wordDeltaCount: 1, deltaSets: [[1]] },
    ])
    expect(() => readIvs(badIvdOffset)).toThrow(/ItemVariationData offset/)
  })

  it('rejects malformed VariationRegionList records', () => {
    expect(() => readIvs(buildIvs(1, [[[0, 1, 1]]], []), 2)).toThrow(/axisCount/)
    expect(() => readIvs(buildIvs(0, [], []))).toThrow(/axisCount/)
    expect(() => readIvs(buildIvs(1, [[[0, 1, 1]]], [], 1, 0x8001))).toThrow(/reserved bit/)
    expect(() => readIvs(buildIvs(1, [[[0.5, 0.25, 1]]], []))).toThrow(/start <= peak <= end/)
    expect(() => readIvs(buildIvs(1, [[[-0.5, 0.25, 1]]], []))).toThrow(/cross zero/)
    expect(() => readIvs(buildIvs(1, [[[0, 1.25, 1.25]]], []))).toThrow(/within -1.0..1.0/)
  })

  it('rejects malformed ItemVariationData subtables', () => {
    expect(() => readIvs(buildIvs(1, [[[0, 1, 1]]], [
      { regionIndices: [0], wordDeltaCount: 2, deltaSets: [[1]] },
    ]))).toThrow(/word delta count/)

    expect(() => readIvs(buildIvs(1, [[[0, 1, 1]]], [
      { regionIndices: [1], wordDeltaCount: 1, deltaSets: [[1]] },
    ]))).toThrow(/region index/)

    const truncated = buildIvs(1, [[[0, 1, 1]]], [
      { regionIndices: [0], wordDeltaCount: 1, deltaSets: [[1]] },
    ]).slice(0, -1)
    expect(() => readIvs(truncated)).toThrow(/deltaSets/)
  })

  it('rejects malformed DeltaSetIndexMap tables', () => {
    expect(() => readMap(new Uint8Array([2, 0, 0, 0]))).toThrow(/format/)
    expect(() => readMap(new Uint8Array([0, 0x80, 0, 0]))).toThrow(/reserved bits/)
    expect(() => readMap(new Uint8Array([0, 0x0F, 0, 0]))).toThrow(/exceeds entry size/)
    expect(() => readMap(new Uint8Array([0, 0, 0, 2, 0]))).toThrow(/mapData/)
  })
})
