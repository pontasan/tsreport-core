import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseCvar } from '../../../src/parsers/tables/cvar.js'
import { parseSfntDirectory } from '../../../src/parsers/sfnt-parser.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'

/**
 * cvar table (CVT Variations) regression tests.
 * Builds synthetic tuple variation stores covering:
 * - embedded peak tuples / shared (external) peak tuples
 * - shared point numbers / private point numbers / "all points" (count = 0)
 * - intermediate start/end tuples
 * - packed deltas (int8 runs, int16 word runs, zero runs)
 */

const F2DOT14 = 16384

function writeF2Dot14(w: BinaryWriter, value: number): void {
  w.writeInt16(Math.round(value * F2DOT14))
}

/** Packs point numbers as a single byte-run (all point deltas must fit in uint8) */
function packPoints(points: number[]): number[] {
  const bytes: number[] = [points.length] // count (< 128)
  bytes.push(points.length - 1) // control byte: byte-sized run
  let prev = 0
  for (const p of points) {
    bytes.push(p - prev)
    prev = p
  }
  return bytes
}

/** Packs deltas as a single int8 run (all deltas must fit in int8) */
function packDeltasInt8(deltas: number[]): number[] {
  const bytes: number[] = [deltas.length - 1] // control byte: int8 run
  for (const d of deltas) {
    bytes.push(d & 0xFF)
  }
  return bytes
}

interface CvarTuple {
  /** embedded peak (F2Dot14 values); mutually exclusive with sharedTupleIndex */
  peak?: number[]
  sharedTupleIndex?: number
  intermediate?: { start: number[], end: number[] }
  /** serialized per-tuple data (packed private points + packed deltas) */
  data: number[]
  privatePoints: boolean
}

function buildCvar(opts: {
  axisCount: number
  tuples: CvarTuple[]
  sharedPointsData?: number[]
}): ArrayBuffer {
  const { axisCount, tuples, sharedPointsData } = opts

  // Compute tuple headers size to derive dataOffset
  let headersSize = 0
  for (const t of tuples) {
    headersSize += 4 // variationDataSize + tupleIndex
    if (t.peak) headersSize += axisCount * 2
    if (t.intermediate) headersSize += axisCount * 4
  }
  const dataOffset = 8 + headersSize

  const w = new BinaryWriter()
  w.writeUint16(1) // majorVersion
  w.writeUint16(0) // minorVersion
  let tupleVariationCount = tuples.length
  if (sharedPointsData) tupleVariationCount |= 0x8000
  w.writeUint16(tupleVariationCount)
  w.writeUint16(dataOffset)

  // Tuple variation headers
  for (const t of tuples) {
    w.writeUint16(t.data.length) // variationDataSize
    let tupleIndex = 0
    if (t.peak) tupleIndex |= 0x8000
    else tupleIndex |= (t.sharedTupleIndex ?? 0) & 0x0FFF
    if (t.intermediate) tupleIndex |= 0x4000
    if (t.privatePoints) tupleIndex |= 0x2000
    w.writeUint16(tupleIndex)
    if (t.peak) {
      for (const v of t.peak) writeF2Dot14(w, v)
    }
    if (t.intermediate) {
      for (const v of t.intermediate.start) writeF2Dot14(w, v)
      for (const v of t.intermediate.end) writeF2Dot14(w, v)
    }
  }

  // Serialized data: shared points first, then each tuple's data
  if (sharedPointsData) {
    for (const b of sharedPointsData) w.writeUint8(b)
  }
  for (const t of tuples) {
    for (const b of t.data) w.writeUint8(b)
  }

  return w.toArrayBuffer()
}

describe('cvar table parser', () => {
  describe('table structure and serialized data validation', () => {
    const buffer = buildCvar({
      axisCount: 1,
      tuples: [{
        peak: [1.0],
        privatePoints: true,
        data: [...packPoints([0]), ...packDeltasInt8([7])],
      }],
    })

    it('rejects malformed headers', () => {
      const unsupportedVersion = buffer.slice(0)
      new DataView(unsupportedVersion).setUint16(0, 2)

      const reservedTupleVariationCount = buffer.slice(0)
      new DataView(reservedTupleVariationCount).setUint16(4, 0x1001)

      const noTuples = buildCvar({ axisCount: 1, tuples: [] })

      const dataOffsetBeforeHeader = buffer.slice(0)
      new DataView(dataOffsetBeforeHeader).setUint16(6, 6)

      const dataOffsetOverflow = buffer.slice(0)
      new DataView(dataOffsetOverflow).setUint16(6, dataOffsetOverflow.byteLength + 1)

      expect(() => parseCvar(new BinaryReader(new ArrayBuffer(7)), 1)).toThrow(/length/)
      expect(() => parseCvar(new BinaryReader(buffer), 0)).toThrow(/axisCount/)
      expect(() => parseCvar(new BinaryReader(unsupportedVersion), 1)).toThrow(/Unsupported cvar/)
      expect(() => parseCvar(new BinaryReader(reservedTupleVariationCount), 1)).toThrow(/reserved bits/)
      expect(() => parseCvar(new BinaryReader(noTuples), 1)).toThrow(/at least one tuple/)
      expect(() => parseCvar(new BinaryReader(dataOffsetBeforeHeader), 1)).toThrow(/at least 8/)
      expect(() => parseCvar(new BinaryReader(dataOffsetOverflow), 1)).toThrow(/dataOffset exceeds/)
    })

    it('rejects malformed tuple headers and serialized data', () => {
      const missingEmbeddedPeak = buildCvar({
        axisCount: 1,
        tuples: [{ sharedTupleIndex: 0, privatePoints: true, data: [0, ...packDeltasInt8([1])] }],
      })

      const reservedTupleIndex = buffer.slice(0)
      new DataView(reservedTupleIndex).setUint16(10, 0xB000)

      const headerOverflow = buffer.slice(0)
      new DataView(headerOverflow).setUint16(6, 12)

      const serializedOverflow = buffer.slice(0)
      new DataView(serializedOverflow).setUint16(8, 1000)

      const pointRunOverflow = buildCvar({
        axisCount: 1,
        tuples: [{
          peak: [1.0],
          privatePoints: true,
          data: [2, 2, 0, 1, ...packDeltasInt8([1, 1])],
        }],
      })

      const deltaRunOverflow = buildCvar({
        axisCount: 1,
        tuples: [{
          peak: [1.0],
          privatePoints: true,
          data: [...packPoints([0]), 1, 1],
        }],
      })

      expect(() => parseCvar(new BinaryReader(missingEmbeddedPeak), 1)).toThrow(/embedded peak/)
      expect(() => parseCvar(new BinaryReader(reservedTupleIndex), 1)).toThrow(/reserved bit/)
      expect(() => parseCvar(new BinaryReader(headerOverflow), 1)).toThrow(/peak tuple/)
      expect(() => parseCvar(new BinaryReader(serializedOverflow), 1).getCvtDeltas([1.0], 1)).toThrow(/serialized data/)
      expect(() => parseCvar(new BinaryReader(pointRunOverflow), 1).getCvtDeltas([1.0], 2)).toThrow(/point run/)
      expect(() => parseCvar(new BinaryReader(deltaRunOverflow), 1).getCvtDeltas([1.0], 1)).toThrow(/delta run/)
    })
  })

  describe('embedded peak tuple with private point numbers', () => {
    const buffer = buildCvar({
      axisCount: 1,
      tuples: [{
        peak: [1.0],
        privatePoints: true,
        data: [...packPoints([0, 2]), ...packDeltasInt8([10, -5])],
      }],
    })

    // Verifies deltas land on the private point numbers (CVT indices 0 and 2) at full scalar.
    it('applies deltas at peak coordinates', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([1.0], 4)).toEqual([10, 0, -5, 0])
    })

    // Verifies deltas are scaled linearly between default and peak.
    it('scales deltas at half coordinates', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([0.5], 4)).toEqual([5, 0, -2.5, 0])
    })

    // Verifies the scalar is 0 at the default position and on the opposite side of the peak.
    it('returns zeros when the tuple does not apply', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([0], 4)).toEqual([0, 0, 0, 0])
      expect(cvar.getCvtDeltas([-0.5], 4)).toEqual([0, 0, 0, 0])
    })

    // Verifies point numbers beyond the CVT length are rejected.
    it('rejects point numbers beyond numCvtEntries', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(() => cvar.getCvtDeltas([1.0], 2)).toThrow('cvar CVT index 2 out of range 2')
    })

    it('applies repeated point numbers cumulatively', () => {
      const repeatedPointBuffer = buildCvar({
        axisCount: 1,
        tuples: [{
          peak: [1.0],
          privatePoints: true,
          data: [2, 1, 1, 0, ...packDeltasInt8([3, 4])],
        }],
      })
      const cvar = parseCvar(new BinaryReader(repeatedPointBuffer), 1)

      expect(cvar.getCvtDeltas([1.0], 2)).toEqual([0, 7])
    })
  })

  describe('shared point numbers', () => {
    // Two tuples with embedded peaks at opposite axis ends, both using shared points [1]
    const buffer = buildCvar({
      axisCount: 1,
      sharedPointsData: packPoints([1]),
      tuples: [
        { peak: [1.0], privatePoints: false, data: packDeltasInt8([7]) },
        { peak: [-1.0], privatePoints: false, data: packDeltasInt8([3]) },
      ],
    })

    // Verifies the first tuple applies via shared points and the second is skipped (scalar 0).
    it('applies the max-side tuple at coord 1.0', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([1.0], 3)).toEqual([0, 7, 0])
    })

    // Verifies variationDataSize-based skipping keeps the serialized offset aligned for later tuples.
    it('applies the min-side tuple at coord -1.0', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([-1.0], 3)).toEqual([0, 3, 0])
    })
  })

  describe('shared tuple index rejection', () => {
    // cvar requires an embedded peak tuple; shared peak tuples are only used by gvar.
    const buffer = buildCvar({
      axisCount: 1,
      tuples: [{
        sharedTupleIndex: 0,
        privatePoints: true,
        data: [0 /* all points */, ...packDeltasInt8([1, 2, 3])],
      }],
    })

    it('rejects tuple headers without embedded peak tuples', () => {
      expect(() => parseCvar(new BinaryReader(buffer), 1)).toThrow(/embedded peak/)
    })
  })

  describe('intermediate tuples', () => {
    const buffer = buildCvar({
      axisCount: 1,
      tuples: [{
        peak: [0.5],
        intermediate: { start: [0.0], end: [1.0] },
        privatePoints: true,
        data: [0 /* all points */, ...packDeltasInt8([8, 4])],
      }],
    })

    // Verifies full application exactly at the peak.
    it('applies fully at the peak', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([0.5], 2)).toEqual([8, 4])
    })

    // Verifies interpolation on the start side: (0.25 - 0) / (0.5 - 0) = 0.5.
    it('interpolates between start and peak', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([0.25], 2)).toEqual([4, 2])
    })

    // Verifies interpolation on the end side: (1.0 - 0.75) / (1.0 - 0.5) = 0.5.
    it('interpolates between peak and end', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([0.75], 2)).toEqual([4, 2])
    })

    // Verifies coordinates outside [start, end] give scalar 0.
    it('returns zeros outside the intermediate range', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([-0.1], 2)).toEqual([0, 0])
    })
  })

  describe('packed delta runs', () => {
    // Zero run (0x80) followed by an int16 word run (0x40)
    const buffer = buildCvar({
      axisCount: 1,
      tuples: [{
        peak: [1.0],
        privatePoints: true,
        data: [
          0, // all points
          0x81, // zero run, count 2
          0x41, 0x01, 0x2C, 0xFE, 0xD4, // word run, count 2: 300, -300
        ],
      }],
    })

    // Verifies zero runs and word (int16) runs decode correctly.
    it('decodes zero runs and word runs', () => {
      const cvar = parseCvar(new BinaryReader(buffer), 1)
      expect(cvar.getCvtDeltas([1.0], 4)).toEqual([0, 0, 300, -300])
    })
  })
})

// --- SfntTableManager registration ---

function buildFont(tables: [string, Uint8Array][]): ArrayBuffer {
  const sortedTables = [...tables].sort(([a], [b]) => compareSfntTags(a, b))
  const numTables = sortedTables.length
  const headerSize = 12 + numTables * 16
  const w = new BinaryWriter()
  const search = computeSfntSearchFields(numTables)
  w.writeUint32(0x00010000) // sfntVersion (TrueType)
  w.writeUint16(numTables)
  w.writeUint16(search.searchRange); w.writeUint16(search.entrySelector); w.writeUint16(search.rangeShift)

  let offset = headerSize
  const offsets: number[] = []
  for (const [, data] of sortedTables) {
    offsets.push(offset)
    offset += (data.length + 3) & ~3
  }
  for (let i = 0; i < numTables; i++) {
    w.writeTag(sortedTables[i]![0])
    w.writeUint32(0) // checksum
    w.writeUint32(offsets[i]!)
    w.writeUint32(sortedTables[i]![1].length)
  }
  for (const [, data] of sortedTables) {
    const padded = new Uint8Array((data.length + 3) & ~3)
    padded.set(data)
    w.writeBytes(padded)
  }
  return w.toArrayBuffer()
}

function compareSfntTags(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function computeSfntSearchFields(numTables: number): { searchRange: number; entrySelector: number; rangeShift: number } {
  let maxPowerOfTwo = 1
  let entrySelector = 0
  while (maxPowerOfTwo * 2 <= numTables) {
    maxPowerOfTwo *= 2
    entrySelector++
  }
  const searchRange = maxPowerOfTwo * 16
  return { searchRange, entrySelector, rangeShift: numTables * 16 - searchRange }
}

function buildFvar(): Uint8Array {
  const w = new BinaryWriter()
  w.writeUint16(1); w.writeUint16(0) // version
  w.writeUint16(16) // axesArrayOffset
  w.writeUint16(2) // reserved
  w.writeUint16(1) // axisCount
  w.writeUint16(20) // axisSize
  w.writeUint16(0) // instanceCount
  w.writeUint16(8) // instanceSize
  w.writeTag('wght')
  w.writeUint32(100 * 65536) // minValue
  w.writeUint32(400 * 65536) // defaultValue
  w.writeUint32(900 * 65536) // maxValue
  w.writeUint16(0) // flags
  w.writeUint16(256) // axisNameId
  return w.toUint8Array()
}

describe('SfntTableManager cvar registration', () => {
  const cvarData = new Uint8Array(buildCvar({
    axisCount: 1,
    tuples: [{
      peak: [1.0],
      privatePoints: true,
      data: [...packPoints([0, 2]), ...packDeltasInt8([10, -5])],
    }],
  }))

  // Verifies the lazy cvar getter parses the table using the fvar axis count.
  it('provides cvar via the manager when fvar and cvar are present', () => {
    const font = buildFont([['fvar', buildFvar()], ['cvar', cvarData]])
    const manager = new SfntTableManager(parseSfntDirectory(font))

    const cvar = manager.cvar
    expect(cvar).not.toBeNull()
    expect(cvar!.getCvtDeltas([1.0], 4)).toEqual([10, 0, -5, 0])
    // the lazy getter caches the parsed table
    expect(manager.cvar).toBe(cvar)
  })

  // Verifies that fonts without a cvar table return null.
  it('returns null when the cvar table is absent', () => {
    const font = buildFont([['fvar', buildFvar()]])
    const manager = new SfntTableManager(parseSfntDirectory(font))
    expect(manager.cvar).toBeNull()
  })

  // Verifies that cvar without fvar is invalid because there are no axes to interpret tuples.
  it('rejects cvar when the fvar table is absent', () => {
    const font = buildFont([['cvar', cvarData]])
    const manager = new SfntTableManager(parseSfntDirectory(font))
    expect(() => manager.cvar).toThrow("Optional table 'cvar' requires table 'fvar'")
  })
})
