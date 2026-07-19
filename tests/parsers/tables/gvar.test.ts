import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseGvar } from '../../../src/parsers/tables/gvar.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'
import { parseSimpleGlyphPoints } from '../../../src/parsers/tables/glyf.js'

/**
 * gvar table (glyph variations) unit tests.
 * Synthetic binaries cover the tuple variation store: shared tuples, embedded
 * peak tuples, intermediate tuples, shared/private point numbers, packed
 * deltas, short/long glyph offsets, and IUP interpolation.
 * A real variable font validates the parser end to end.
 */

const VF_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-VariableFont_wdth,wght.ttf')

const F2DOT14 = 16384

function writeF2Dot14(w: BinaryWriter, value: number): void {
  w.writeInt16(Math.round(value * F2DOT14))
}

/** Packs point numbers as a single byte-run (point deltas must fit in uint8) */
function packPoints(points: number[]): number[] {
  const bytes: number[] = [points.length]
  bytes.push(points.length - 1) // control byte: byte-sized run
  let prev = 0
  for (const p of points) {
    bytes.push(p - prev)
    prev = p
  }
  return bytes
}

/** Packs deltas as a single int8 run (deltas must fit in int8) */
function packDeltasInt8(deltas: number[]): number[] {
  const bytes: number[] = [deltas.length - 1]
  for (const d of deltas) {
    bytes.push(d & 0xFF)
  }
  return bytes
}

interface GvarTuple {
  peak?: number[]
  sharedTupleIndex?: number
  intermediate?: { start: number[], end: number[] }
  privatePoints: boolean
  /** serialized per-tuple data (packed private points + packed x deltas + packed y deltas) */
  data: number[]
}

function buildGlyphVariationData(
  axisCount: number,
  tuples: GvarTuple[],
  sharedPointsData?: number[],
): Uint8Array {
  let headersSize = 0
  for (const t of tuples) {
    headersSize += 4
    if (t.peak) headersSize += axisCount * 2
    if (t.intermediate) headersSize += axisCount * 4
  }

  const w = new BinaryWriter()
  let tupleVariationCount = tuples.length
  if (sharedPointsData) tupleVariationCount |= 0x8000
  w.writeUint16(tupleVariationCount)
  w.writeUint16(4 + headersSize) // dataOffset (relative to glyph variation data start)

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

  if (sharedPointsData) {
    for (const b of sharedPointsData) w.writeUint8(b)
  }
  for (const t of tuples) {
    for (const b of t.data) w.writeUint8(b)
  }

  return w.toUint8Array().slice()
}

function buildGvar(opts: {
  axisCount: number
  sharedTuples?: number[][]
  glyphData: (Uint8Array | null)[]
  longOffsets?: boolean
}): ArrayBuffer {
  const { axisCount, sharedTuples = [], glyphData, longOffsets = false } = opts
  const glyphCount = glyphData.length

  // Pad each glyph data block to an even length (short offsets are stored / 2)
  const blocks = glyphData.map((d) => {
    if (!d) return new Uint8Array(0)
    if (d.length % 2 === 0) return d
    const padded = new Uint8Array(d.length + 1)
    padded.set(d)
    return padded
  })

  const offsetSize = longOffsets ? 4 : 2
  const sharedTuplesOffset = 20 + (glyphCount + 1) * offsetSize
  const glyphVariationDataArrayOffset = sharedTuplesOffset + sharedTuples.length * axisCount * 2

  const w = new BinaryWriter()
  w.writeUint16(1) // majorVersion
  w.writeUint16(0) // minorVersion
  w.writeUint16(axisCount)
  w.writeUint16(sharedTuples.length)
  w.writeUint32(sharedTuplesOffset)
  w.writeUint16(glyphCount)
  w.writeUint16(longOffsets ? 1 : 0) // flags
  w.writeUint32(glyphVariationDataArrayOffset)

  // Glyph variation data offsets (glyphCount + 1 entries)
  let offset = 0
  for (let i = 0; i <= glyphCount; i++) {
    if (longOffsets) w.writeUint32(offset)
    else w.writeUint16(offset / 2)
    if (i < glyphCount) offset += blocks[i]!.length
  }

  for (const tuple of sharedTuples) {
    for (const v of tuple) writeF2Dot14(w, v)
  }
  for (const block of blocks) w.writeBytes(block)

  return w.toArrayBuffer()
}

describe('gvar table parser', () => {
  describe('table structure and serialized data validation', () => {
    const glyph0 = buildGlyphVariationData(1, [{
      peak: [1.0],
      privatePoints: true,
      data: [
        ...packPoints([0]),
        ...packDeltasInt8([7]),
        ...packDeltasInt8([-7]),
      ],
    }])

    it('rejects malformed table headers and cross-table count mismatches', () => {
      const buffer = buildGvar({ axisCount: 1, glyphData: [glyph0] })
      const truncatedOffsets = buffer.slice(0, 22)
      const sharedTupleBeforeOffsets = buildGvar({ axisCount: 1, sharedTuples: [[1.0]], glyphData: [null] })
      new DataView(sharedTupleBeforeOffsets).setUint32(8, 20)

      const glyphDataBeforeSharedTuples = buildGvar({ axisCount: 1, sharedTuples: [[1.0]], glyphData: [null] })
      new DataView(glyphDataBeforeSharedTuples).setUint32(16, 24)

      expect(() => parseGvar(new BinaryReader(new ArrayBuffer(19)))).toThrow(/length/)
      expect(() => parseGvar(new BinaryReader(truncatedOffsets))).toThrow(/offsets array/)
      expect(() => parseGvar(new BinaryReader(sharedTupleBeforeOffsets))).toThrow(/sharedTuplesOffset/)
      expect(() => parseGvar(new BinaryReader(glyphDataBeforeSharedTuples))).toThrow(/glyphVariationDataArrayOffset/)
      expect(() => parseGvar(new BinaryReader(buffer), 2)).toThrow(/axisCount/)
      expect(() => parseGvar(new BinaryReader(buffer), undefined, 2)).toThrow(/glyphCount/)
    })

    it('rejects malformed glyph variation data headers and serialized tuple data', () => {
      const emptyTupleStore = buildGvar({ axisCount: 1, glyphData: [buildGlyphVariationData(1, [])] })

      const dataOffsetBeforeHeaders = buildGvar({ axisCount: 1, glyphData: [glyph0] })
      new DataView(dataOffsetBeforeHeaders).setUint16(26, 4)

      const serializedOverflow = buildGvar({ axisCount: 1, glyphData: [glyph0] })
      new DataView(serializedOverflow).setUint16(28, 1000)

      const pointRunOverflowGlyph = buildGlyphVariationData(1, [{
        peak: [1.0],
        privatePoints: true,
        data: [
          2, 2, 0, 1, // declared 2 points, run encodes 3
          ...packDeltasInt8([1, 1]),
          ...packDeltasInt8([1, 1]),
        ],
      }])
      const pointRunOverflow = buildGvar({ axisCount: 1, glyphData: [pointRunOverflowGlyph] })

      const deltaRunOverflowGlyph = buildGlyphVariationData(1, [{
        peak: [1.0],
        privatePoints: true,
        data: [
          ...packPoints([0]),
          1, 1, // x delta run encodes 2 values but only 1 is expected
          ...packDeltasInt8([1]),
        ],
      }])
      const deltaRunOverflow = buildGvar({ axisCount: 1, glyphData: [deltaRunOverflowGlyph] })

      expect(() => parseGvar(new BinaryReader(emptyTupleStore)).getGlyphDeltas(0, [1.0], 1)).toThrow(/at least one tuple/)
      expect(() => parseGvar(new BinaryReader(dataOffsetBeforeHeaders)).getGlyphDeltas(0, [1.0], 1)).toThrow(/tuple variation header/)
      expect(() => parseGvar(new BinaryReader(serializedOverflow)).getGlyphDeltas(0, [1.0], 1)).toThrow(/serialized data/)
      expect(() => parseGvar(new BinaryReader(pointRunOverflow)).getGlyphDeltas(0, [1.0], 2)).toThrow(/point run/)
      expect(() => parseGvar(new BinaryReader(deltaRunOverflow)).getGlyphDeltas(0, [1.0], 1)).toThrow(/delta run/)
    })
  })

  describe('embedded peak tuple with private point numbers', () => {
    const glyph0 = buildGlyphVariationData(1, [{
      peak: [1.0],
      privatePoints: true,
      data: [
        ...packPoints([0, 1]),
        ...packDeltasInt8([10, 20]), // x deltas
        ...packDeltasInt8([-10, 5]), // y deltas
      ],
    }])
    const buffer = buildGvar({ axisCount: 1, glyphData: [glyph0, null] })

    // Verifies header fields and full delta application at the peak.
    it('applies x/y deltas at peak coordinates', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      expect(gvar.axisCount).toBe(1)
      expect(gvar.glyphCount).toBe(2)
      const deltas = gvar.getGlyphDeltas(0, [1.0], 2)!
      expect(deltas.deltaX).toEqual([10, 20])
      expect(deltas.deltaY).toEqual([-10, 5])
    })

    // Verifies linear scaling between default and peak.
    it('scales deltas at half coordinates', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [0.5], 2)!
      expect(deltas.deltaX).toEqual([5, 10])
      expect(deltas.deltaY).toEqual([-5, 2.5])
    })

    // Verifies a glyph with an empty data range returns null.
    it('returns null for a glyph without variation data', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      expect(gvar.getGlyphDeltas(1, [1.0], 2)).toBeNull()
    })

    // Verifies glyph IDs beyond glyphCount return null.
    it('returns null for out-of-range glyph IDs', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      expect(gvar.getGlyphDeltas(99, [1.0], 2)).toBeNull()
    })

    it('accepts compatible minor extensions and rejects unknown major versions', () => {
      const invalid = buffer.slice(0)
      new DataView(invalid).setUint16(0, 2)

      expect(() => parseGvar(new BinaryReader(invalid))).toThrow(
        'Unsupported gvar version: 2.0',
      )
      const compatible = buffer.slice(0)
      new DataView(compatible).setUint16(2, 1)
      expect(() => parseGvar(new BinaryReader(compatible))).not.toThrow()
    })

    it('rejects reserved gvar header flag bits', () => {
      const invalid = buffer.slice(0)
      new DataView(invalid).setUint16(14, 0x0002)

      expect(() => parseGvar(new BinaryReader(invalid))).toThrow(
        'Unsupported gvar flags reserved bits: 0x0002',
      )
    })

    it('applies repeated point numbers cumulatively', () => {
      const repeatedPointGlyph = buildGlyphVariationData(1, [{
        peak: [1.0],
        privatePoints: true,
        data: [
          2, 1, 1, 0, // point 1 followed by point 1 again
          ...packDeltasInt8([3, 4]),
          ...packDeltasInt8([5, 6]),
        ],
      }])
      const gvar = parseGvar(new BinaryReader(buildGvar({ axisCount: 1, glyphData: [repeatedPointGlyph] })))

      const deltas = gvar.getGlyphDeltas(0, [1.0], 2)!
      expect(deltas.deltaX).toEqual([0, 7])
      expect(deltas.deltaY).toEqual([0, 11])
    })
  })

  describe('shared tuples and shared point numbers', () => {
    it('exposes global-tuple support scalars for AAT variation consumers', () => {
      const gvar = parseGvar(new BinaryReader(buildGvar({
        axisCount: 2,
        sharedTuples: [[1, 0], [0, -1], [1, -1]],
        glyphData: [null],
      })))

      expect(gvar.sharedTupleCount).toBe(3)
      expect(gvar.getSharedTupleScalars([0.5, -0.25])).toEqual([0.5, 0.25, 0.125])
      expect(gvar.getSharedTupleScalar(2, [0.5, -0.25])).toBe(0.125)
      expect(() => gvar.getSharedTupleScalar(3, [0, 0])).toThrow(/out of range/)
    })

    // Two tuples referencing shared peak tuples [1.0] and [-1.0],
    // both using the shared point numbers [0].
    const glyph0 = buildGlyphVariationData(1, [
      { sharedTupleIndex: 0, privatePoints: false, data: [...packDeltasInt8([7]), ...packDeltasInt8([-7])] },
      { sharedTupleIndex: 1, privatePoints: false, data: [...packDeltasInt8([3]), ...packDeltasInt8([-3])] },
    ], packPoints([0]))
    const buffer = buildGvar({
      axisCount: 1,
      sharedTuples: [[1.0], [-1.0]],
      glyphData: [glyph0],
    })

    // Verifies the peak comes from the shared tuple array and shared points route the deltas.
    it('applies the max-side tuple at coord 1.0', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [1.0], 2)!
      expect(deltas.deltaX).toEqual([7, 0])
      expect(deltas.deltaY).toEqual([-7, 0])
    })

    // Verifies variationDataSize-based skipping keeps the serialized offset aligned.
    it('applies the min-side tuple at coord -1.0', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [-1.0], 2)!
      expect(deltas.deltaX).toEqual([3, 0])
      expect(deltas.deltaY).toEqual([-3, 0])
    })

    it('rejects shared tuple indices outside the shared tuple array', () => {
      const glyph0 = buildGlyphVariationData(1, [{
        sharedTupleIndex: 1,
        privatePoints: true,
        data: [
          ...packPoints([0]),
          ...packDeltasInt8([7]),
          ...packDeltasInt8([-7]),
        ],
      }])
      const gvar = parseGvar(new BinaryReader(buildGvar({ axisCount: 1, sharedTuples: [[1.0]], glyphData: [glyph0] })))

      expect(() => gvar.getGlyphDeltas(0, [1.0], 1)).toThrow(
        'gvar shared tuple index 1 out of range 1',
      )
    })
  })

  describe('intermediate tuples', () => {
    // Peak 0.5 with intermediate range [0.0, 1.0]; "all points" deltas (count byte 0)
    const glyph0 = buildGlyphVariationData(1, [{
      peak: [0.5],
      intermediate: { start: [0.0], end: [1.0] },
      privatePoints: true,
      data: [
        0, // all points
        ...packDeltasInt8([4, 8]), // x deltas
        ...packDeltasInt8([2, 6]), // y deltas
      ],
    }])
    const buffer = buildGvar({ axisCount: 1, glyphData: [glyph0] })

    // Verifies full application exactly at the peak.
    it('applies fully at the peak', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [0.5], 2)!
      expect(deltas.deltaX).toEqual([4, 8])
      expect(deltas.deltaY).toEqual([2, 6])
    })

    // Verifies start-side interpolation: (0.25 - 0) / (0.5 - 0) = 0.5.
    it('interpolates between start and peak', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [0.25], 2)!
      expect(deltas.deltaX).toEqual([2, 4])
      expect(deltas.deltaY).toEqual([1, 3])
    })

    // Verifies end-side interpolation: (1.0 - 0.75) / (1.0 - 0.5) = 0.5.
    it('interpolates between peak and end', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [0.75], 2)!
      expect(deltas.deltaX).toEqual([2, 4])
      expect(deltas.deltaY).toEqual([1, 3])
    })

    // Verifies coordinates outside [start, end] give zero deltas.
    it('returns zeros outside the intermediate range', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [-0.25], 2)!
      expect(deltas.deltaX).toEqual([0, 0])
      expect(deltas.deltaY).toEqual([0, 0])
    })
  })

  describe('IUP interpolation', () => {
    // Square contour (0,0) (100,0) (100,100) (0,100); only points 0 and 2 are
    // referenced, with deltas (0,0) and (10,10). The untouched points 1 and 3
    // must be interpolated per coordinate axis.
    const glyph0 = buildGlyphVariationData(1, [{
      peak: [1.0],
      privatePoints: true,
      data: [
        ...packPoints([0, 2]),
        ...packDeltasInt8([0, 10]), // x deltas
        ...packDeltasInt8([0, 10]), // y deltas
      ],
    }])
    const buffer = buildGvar({ axisCount: 1, glyphData: [glyph0] })
    const contourEndPts = [3]
    const originalX = [0, 100, 100, 0]
    const originalY = [0, 0, 100, 100]

    // Verifies untouched points receive IUP-interpolated deltas and phantom points stay 0.
    it('interpolates untouched points within the contour', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      // numPoints = 4 outline points + 4 phantom points
      const deltas = gvar.getGlyphDeltas(0, [1.0], 8, contourEndPts, originalX, originalY)!
      // Point 1 (100,0): x follows point 2 (orig x 100 -> +10), y follows point 0 (orig y 0 -> +0)
      // Point 3 (0,100): x follows point 0 (orig x 0 -> +0), y follows point 2 (orig y 100 -> +10)
      expect(deltas.deltaX.slice(0, 4)).toEqual([0, 10, 10, 0])
      expect(deltas.deltaY.slice(0, 4)).toEqual([0, 0, 10, 10])
      expect(deltas.deltaX.slice(4)).toEqual([0, 0, 0, 0])
      expect(deltas.deltaY.slice(4)).toEqual([0, 0, 0, 0])
    })

    // Verifies the explicit-delta path (no contour info) leaves untouched points at 0.
    it('applies deltas without IUP when contour info is absent', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [1.0], 8)!
      expect(deltas.deltaX.slice(0, 4)).toEqual([0, 0, 10, 0])
      expect(deltas.deltaY.slice(0, 4)).toEqual([0, 0, 10, 0])
    })

    it('uses zero for inferred deltas when adjacent coordinates match but deltas differ', () => {
      const glyph0 = buildGlyphVariationData(1, [{
        peak: [1.0],
        privatePoints: true,
        data: [
          ...packPoints([0, 2]),
          ...packDeltasInt8([10, 20]),
          ...packDeltasInt8([0, 0]),
        ],
      }])
      const gvar = parseGvar(new BinaryReader(buildGvar({ axisCount: 1, glyphData: [glyph0] })))
      const deltas = gvar.getGlyphDeltas(0, [1.0], 7, [2], [0, 0, 0], [0, 1, 2])!

      expect(deltas.deltaX.slice(0, 3)).toEqual([10, 0, 20])
      expect(deltas.deltaY.slice(0, 3)).toEqual([0, 0, 0])
    })

    it('rejects reserved tupleIndex bits', () => {
      const invalidGlyph = glyph0.slice()
      new DataView(invalidGlyph.buffer, invalidGlyph.byteOffset, invalidGlyph.byteLength).setUint16(6, 0xB000)
      const gvar = parseGvar(new BinaryReader(buildGvar({ axisCount: 1, glyphData: [invalidGlyph] })))

      expect(() => gvar.getGlyphDeltas(0, [1.0], 8, contourEndPts, originalX, originalY)).toThrow(
        'Unsupported gvar tupleIndex reserved bit: 0xb000',
      )
    })

    it('rejects point numbers outside the glyph point range', () => {
      const invalidGlyph = buildGlyphVariationData(1, [{
        peak: [1.0],
        privatePoints: true,
        data: [
          ...packPoints([8]),
          ...packDeltasInt8([1]),
          ...packDeltasInt8([1]),
        ],
      }])
      const gvar = parseGvar(new BinaryReader(buildGvar({ axisCount: 1, glyphData: [invalidGlyph] })))

      expect(() => gvar.getGlyphDeltas(0, [1.0], 8, contourEndPts, originalX, originalY)).toThrow(
        'gvar point index 8 out of range 8',
      )
    })
  })

  describe('long glyph offsets (flags bit 0)', () => {
    const glyph0 = buildGlyphVariationData(1, [{
      peak: [1.0],
      privatePoints: true,
      data: [
        ...packPoints([0]),
        ...packDeltasInt8([42]),
        ...packDeltasInt8([-42]),
      ],
    }])
    const buffer = buildGvar({ axisCount: 1, glyphData: [glyph0], longOffsets: true })

    // Verifies uint32 glyph variation data offsets are honored.
    it('parses variation data through uint32 offsets', () => {
      const gvar = parseGvar(new BinaryReader(buffer))
      const deltas = gvar.getGlyphDeltas(0, [1.0], 1)!
      expect(deltas.deltaX).toEqual([42])
      expect(deltas.deltaY).toEqual([-42])
    })
  })

  describe('real variable font', () => {
    // Verifies the parser against a production tuple variation store.
    it.skipIf(!existsSync(VF_PATH))('parses NotoSans variable font gvar and yields deltas', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const reader = getTableReader(sfnt, 'gvar')
      expect(reader).not.toBeNull()
      const gvar = parseGvar(reader!)

      const manager = new SfntTableManager(sfnt)
      const fvar = manager.fvar!
      expect(gvar.axisCount).toBe(fvar.axes.length)
      expect(gvar.glyphCount).toBe(manager.maxp.numGlyphs)

      // 'A' is a simple glyph in NotoSans; move wght to its maximum
      const gid = manager.cmap.getGlyphId(0x41)
      expect(gid).toBeGreaterThan(0)
      const glyfReader = getTableReader(sfnt, 'glyf')!
      const raw = parseSimpleGlyphPoints(glyfReader, manager.loca, gid)
      expect(raw).not.toBeNull()

      const numPoints = raw!.numPoints + 4 // phantom points
      const coords = new Array(gvar.axisCount).fill(0) as number[]
      coords[fvar.getAxisIndex('wght')] = 1.0

      const deltas = gvar.getGlyphDeltas(
        gid, coords, numPoints, raw!.endPts, raw!.xCoords, raw!.yCoords,
      )
      expect(deltas).not.toBeNull()
      expect(deltas!.deltaX).toHaveLength(numPoints)
      expect(deltas!.deltaY).toHaveLength(numPoints)
      // Bold deltas must move at least one outline point
      expect(deltas!.deltaX.some((d) => d !== 0)).toBe(true)

      // At the default position every tuple scalar is 0
      const defaultDeltas = gvar.getGlyphDeltas(
        gid, new Array(gvar.axisCount).fill(0) as number[], numPoints,
        raw!.endPts, raw!.xCoords, raw!.yCoords,
      )!
      expect(defaultDeltas.deltaX.every((d) => d === 0)).toBe(true)
      expect(defaultDeltas.deltaY.every((d) => d === 0)).toBe(true)
    })
  })
})
