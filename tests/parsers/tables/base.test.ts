import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { buildCompactBaseTable, parseBase } from '../../../src/parsers/tables/base.js'

const F2DOT14 = 16384

/**
 * Build a minimal BASE table with one horizontal axis, one script, base values
 */
function buildBaseTable(options: {
  scriptTag: string
  baselineTags: string[]
  baseCoordinates: number[]
  defaultBaselineIndex?: number
}): ArrayBuffer {
  const buf = new ArrayBuffer(512)
  const view = new DataView(buf)
  let pos = 0

  // Header: majorVersion(2) + minorVersion(2) + horizAxisOffset(2) + vertAxisOffset(2) = 8
  view.setUint16(pos, 1); pos += 2 // majorVersion
  view.setUint16(pos, 0); pos += 2 // minorVersion
  const horizAxisOffsetPos = pos; pos += 2 // horizAxisOffset
  view.setUint16(pos, 0); pos += 2 // vertAxisOffset (none)

  // Horizontal Axis
  const axisStart = pos
  view.setUint16(horizAxisOffsetPos, axisStart)

  const baseTagListOffsetPos = pos; pos += 2
  const baseScriptListOffsetPos = pos; pos += 2

  // BaseTagList
  const baseTagListStart = pos
  view.setUint16(baseTagListOffsetPos, baseTagListStart - axisStart)
  view.setUint16(pos, options.baselineTags.length); pos += 2
  for (const tag of options.baselineTags) {
    for (let c = 0; c < 4; c++) view.setUint8(pos++, tag.charCodeAt(c))
  }

  // BaseScriptList
  const baseScriptListStart = pos
  view.setUint16(baseScriptListOffsetPos, baseScriptListStart - axisStart)
  view.setUint16(pos, 1); pos += 2 // 1 script

  // BaseScriptRecord
  for (let c = 0; c < 4; c++) view.setUint8(pos++, options.scriptTag.charCodeAt(c))
  const scriptOffsetPos = pos; pos += 2

  // BaseScript
  const scriptStart = pos
  view.setUint16(scriptOffsetPos, scriptStart - baseScriptListStart)
  const baseValuesOffsetPos = pos; pos += 2
  view.setUint16(pos, 0); pos += 2 // defaultMinMax = 0
  view.setUint16(pos, 0); pos += 2 // baseLangSysCount = 0

  // BaseValues
  const baseValuesStart = pos
  view.setUint16(baseValuesOffsetPos, baseValuesStart - scriptStart)
  view.setUint16(pos, options.defaultBaselineIndex ?? 0); pos += 2 // defaultBaselineIndex
  view.setUint16(pos, options.baseCoordinates.length); pos += 2 // baseCoordCount

  // BaseCoord offsets (from baseValuesStart)
  const coordStartOffset = 4 + options.baseCoordinates.length * 2
  for (let i = 0; i < options.baseCoordinates.length; i++) {
    view.setUint16(pos, coordStartOffset + i * 4); pos += 2
  }

  // BaseCoord records (format 1: format(2) + coordinate(2) = 4 each)
  for (const coord of options.baseCoordinates) {
    view.setUint16(pos, 1); pos += 2 // format 1
    view.setInt16(pos, coord); pos += 2
  }

  return buf.slice(0, pos)
}

function buildItemVariationStore(delta: number): Uint8Array {
  const w = new BinaryWriter()
  w.writeUint16(1) // format
  w.writeUint32(12) // variationRegionListOffset
  w.writeUint16(1) // itemVariationDataCount
  w.writeUint32(22) // itemVariationDataOffset
  w.writeUint16(1) // axisCount
  w.writeUint16(1) // regionCount
  w.writeInt16(0)
  w.writeInt16(F2DOT14)
  w.writeInt16(F2DOT14)
  w.writeUint16(1) // itemCount
  w.writeUint16(1) // wordDeltaCount
  w.writeUint16(1) // regionIndexCount
  w.writeUint16(0) // regionIndex
  w.writeInt16(delta)
  return w.toUint8Array().slice()
}

function buildBaseVariationTable(deltaFormat = 0x8000): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1) // majorVersion
  w.writeUint16(1) // minorVersion
  w.writeUint16(12) // horizAxisOffset
  w.writeUint16(0) // vertAxisOffset
  const itemVarStoreOffsetPos = w.position
  w.writeUint32(0)

  const axisStart = w.position
  w.writeUint16(4) // baseTagListOffset
  w.writeUint16(10) // baseScriptListOffset
  w.writeUint16(1) // baseTagCount
  w.writeTag('romn')
  const baseScriptListStart = w.position
  w.writeUint16(1) // baseScriptCount
  w.writeTag('latn')
  w.writeUint16(8) // BaseScript offset
  const baseScriptStart = w.position
  w.writeUint16(6) // baseValuesOffset
  w.writeUint16(0) // defaultMinMaxOffset
  w.writeUint16(0) // baseLangSysCount
  const baseValuesStart = w.position
  w.writeUint16(0) // defaultBaselineIndex
  w.writeUint16(1) // baseCoordCount
  w.writeUint16(6) // baseCoordOffset
  w.writeUint16(3) // BaseCoord format 3
  w.writeInt16(100) // coordinate
  w.writeUint16(6) // VariationIndex offset
  w.writeUint16(0) // deltaSetOuterIndex
  w.writeUint16(0) // deltaSetInnerIndex
  w.writeUint16(deltaFormat)

  const itemVarStoreOffset = w.position
  w.writeBytes(buildItemVariationStore(20))
  const end = w.position
  w.position = itemVarStoreOffsetPos
  w.writeUint32(itemVarStoreOffset)
  w.position = end

  expect(axisStart).toBe(12)
  expect(baseScriptListStart - axisStart).toBe(10)
  expect(baseScriptStart - baseScriptListStart).toBe(8)
  expect(baseValuesStart - baseScriptStart).toBe(6)
  return w.toArrayBuffer()
}

function buildBaseResolvedCoordTable(format: 2 | 3): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1); w.writeUint16(0)
  w.writeUint16(8); w.writeUint16(0)
  w.writeUint16(4); w.writeUint16(10)
  w.writeUint16(1); w.writeTag('romn')
  w.writeUint16(1); w.writeTag('latn'); w.writeUint16(8)
  w.writeUint16(6); w.writeUint16(0); w.writeUint16(0)
  w.writeUint16(0); w.writeUint16(1); w.writeUint16(6)
  w.writeUint16(format); w.writeInt16(100)
  if (format === 2) {
    w.writeUint16(5); w.writeUint16(2)
  } else {
    w.writeUint16(6)
    w.writeUint16(12); w.writeUint16(12); w.writeUint16(2); w.writeUint16(0x1000)
  }
  return w.toArrayBuffer()
}

function buildBaseFeatureMinMaxTable(): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1); w.writeUint16(0)
  w.writeUint16(8); w.writeUint16(0)
  w.writeUint16(0); w.writeUint16(4)
  w.writeUint16(1); w.writeTag('latn'); w.writeUint16(8)
  w.writeUint16(0); w.writeUint16(6); w.writeUint16(0)
  w.writeUint16(14); w.writeUint16(18); w.writeUint16(1)
  w.writeTag('kern'); w.writeUint16(22); w.writeUint16(26)
  for (const coordinate of [-50, 80, -20, 30]) {
    w.writeUint16(1); w.writeInt16(coordinate)
  }
  return w.toArrayBuffer()
}

describe('BASE table parser', () => {
  it('rebuilds BaseCoord format 2 reference glyph IDs for compact subsets', () => {
    const source = buildBaseResolvedCoordTable(2)
    const rebuilt = buildCompactBaseTable(new BinaryReader(source), new Map([[5, 1]]))
    const base = parseBase(new BinaryReader(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength))
    const baseline = base.getBaselines('latn', undefined, 'horizontal', undefined, {
      unitsPerEm: 1000,
      controlPointResolver: {
        getGlyphControlPoint(glyphId, pointIndex) {
          expect(glyphId).toBe(1)
          expect(pointIndex).toBe(2)
          return { x: 10, y: 240 }
        },
      },
    })
    expect(baseline[0]!.coordinate).toBe(240)
  })

  // Verifies that getBaselines pairs each BaseTagList tag with its BaseCoord format-1 coordinate for the matching script.
  it('should parse baselines for a script', () => {
    const buf = buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['hang', 'ideo', 'romn'],
      baseCoordinates: [800, 0, 120],
    })
    const base = parseBase(new BinaryReader(buf))
    const baselines = base.getBaselines('latn')

    expect(baselines).toHaveLength(3)
    expect(baselines[0]!.tag).toBe('hang')
    expect(baselines[0]!.coordinate).toBe(800)
    expect(baselines[1]!.tag).toBe('ideo')
    expect(baselines[1]!.coordinate).toBe(0)
    expect(baselines[2]!.tag).toBe('romn')
    expect(baselines[2]!.coordinate).toBe(120)
  })

  it('should return the default baseline for a script', () => {
    const buf = buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['hang', 'ideo', 'romn'],
      baseCoordinates: [800, 0, 120],
      defaultBaselineIndex: 2,
    })
    const base = parseBase(new BinaryReader(buf))

    expect(base.getDefaultBaseline('latn')).toEqual({ tag: 'romn', coordinate: 120 })
    expect(base.getDefaultBaseline('cyrl')).toBeNull()
  })

  // Verifies that a script tag absent from the BaseScriptList yields an empty baseline array rather than an error.
  it('should return empty for unknown script', () => {
    const buf = buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['romn'],
      baseCoordinates: [120],
    })
    const base = parseBase(new BinaryReader(buf))

    expect(base.getBaselines('cyrl')).toEqual([])
  })

  // Verifies that getMinMax returns null when the BaseScript has a zero DefaultMinMax offset.
  it('should return null MinMax when not defined', () => {
    const buf = buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['romn'],
      baseCoordinates: [120],
    })
    const base = parseBase(new BinaryReader(buf))

    expect(base.getMinMax('latn')).toBeNull()
  })

  // Verifies that BaseCoord coordinates are read as signed int16 (e.g. ideographic baseline below zero).
  it('should handle negative baseline coordinates', () => {
    const buf = buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['ideo'],
      baseCoordinates: [-120],
    })
    const base = parseBase(new BinaryReader(buf))
    const baselines = base.getBaselines('latn')

    expect(baselines[0]!.coordinate).toBe(-120)
  })

  it('applies BASE v1.1 VariationIndex deltas to BaseCoord format 3', () => {
    const base = parseBase(new BinaryReader(buildBaseVariationTable()), 1)

    expect(base.getBaselines('latn')).toEqual([{ tag: 'romn', coordinate: 100 }])
    expect(base.getBaselines('latn', undefined, 'horizontal', [0.5])).toEqual([{ tag: 'romn', coordinate: 110 }])
    expect(base.getBaselines('latn', undefined, 'horizontal', [1])).toEqual([{ tag: 'romn', coordinate: 120 }])
  })

  it('materializes BASE VariationIndex coordinates in compact static tables', () => {
    const rebuilt = buildCompactBaseTable(
      new BinaryReader(buildBaseVariationTable()), new Map(), 1, [1],
    )
    const base = parseBase(new BinaryReader(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength))
    expect(base.getBaselines('latn')).toEqual([{ tag: 'romn', coordinate: 120 }])
  })

  it('resolves BaseCoord format 2 from the referenced outline point', () => {
    const base = parseBase(new BinaryReader(buildBaseResolvedCoordTable(2)))
    const controlPointResolver = {
      getGlyphControlPoint(glyphId: number, pointIndex: number) {
        expect([glyphId, pointIndex]).toEqual([5, 2])
        return { x: 40, y: 250 }
      },
    }

    expect(base.getBaselines('latn', undefined, 'horizontal', undefined, {
      unitsPerEm: 1000, controlPointResolver,
    })[0]!.coordinate).toBe(250)
  })

  it('resolves BaseCoord format 3 Device deltas', () => {
    const base = parseBase(new BinaryReader(buildBaseResolvedCoordTable(3)))

    expect(base.getBaselines('latn', undefined, 'horizontal', undefined, {
      ppem: 12, unitsPerEm: 1200,
    })[0]!.coordinate).toBe(200)
  })

  it('exposes FeatMinMax records through baseline processing', () => {
    const base = parseBase(new BinaryReader(buildBaseFeatureMinMaxTable()))

    expect(base.getMinMax('latn')).toEqual({ min: -50, max: 80 })
    expect(base.getFeatureMinMax('latn', 'kern')).toEqual({ min: -20, max: 30 })
  })

  it('rejects malformed BASE headers and records', () => {
    const unsupported = new Uint8Array(buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['romn'],
      baseCoordinates: [120],
    }))
    new DataView(unsupported.buffer).setUint16(0, 2)
    expect(() => parseBase(new BinaryReader(unsupported.buffer))).toThrow(/Unsupported BASE/)

    const noAxis = new Uint8Array(buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['romn'],
      baseCoordinates: [120],
    }))
    noAxis[4] = 0
    noAxis[5] = 0
    expect(() => parseBase(new BinaryReader(noAxis.buffer))).toThrow(/at least one Axis/)

    const unsortedTags = new Uint8Array(buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['romn', 'ideo'],
      baseCoordinates: [120, 0],
    }))
    expect(() => parseBase(new BinaryReader(unsortedTags.buffer)).getBaselines('latn')).toThrow(/baselineTags/)

    const mismatchCount = new Uint8Array(buildBaseTable({
      scriptTag: 'latn',
      baselineTags: ['romn'],
      baseCoordinates: [120],
    }))
    const baseCoordCountOffset = 8 + 4 + 2 + 4 + 2 + 6 + 6 + 2
    mismatchCount[baseCoordCountOffset + 1] = 2
    expect(() => parseBase(new BinaryReader(mismatchCount.buffer)).getBaselines('latn')).toThrow(/baseCoordCount/)
  })

  it('rejects malformed BASE v1.1 variation data', () => {
    expect(() => parseBase(new BinaryReader(buildBaseVariationTable()))).toThrow(/requires table 'fvar'/)
    expect(() => parseBase(new BinaryReader(buildBaseVariationTable(3)), 1).getBaselines('latn', undefined, 'horizontal', [1])).toThrow(/VariationIndex deltaFormat/)
  })
})
