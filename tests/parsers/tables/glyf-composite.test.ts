import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseSfntDirectory } from '../../../src/parsers/sfnt-parser.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'
import { Font } from '../../../src/font.js'
import {
  parseGlyph,
  composeGlyphPoints,
  composedGlyphToOutline,
  readSimpleGlyphData,
  parseCompositeComponents,
  ARG_1_AND_2_ARE_WORDS,
  ARGS_ARE_XY_VALUES,
  ROUND_XY_TO_GRID,
  WE_HAVE_A_SCALE,
  MORE_COMPONENTS,
  WE_HAVE_A_TWO_BY_TWO,
  USE_MY_METRICS,
  SCALED_COMPONENT_OFFSET,
  UNSCALED_COMPONENT_OFFSET,
} from '../../../src/parsers/tables/glyf.js'
import type { GvarTable } from '../../../src/parsers/tables/gvar.js'
import type { LocaTable } from '../../../src/types/index.js'
import { PathCommand } from '../../../src/types/glyph.js'

/**
 * Composite glyph regression tests using synthetic glyf binaries:
 * - point matching (anchor points) composition
 * - 2x2 transform orientation (scale01 / scale10)
 * - SCALED_COMPONENT_OFFSET / UNSCALED_COMPONENT_OFFSET
 * - ROUND_XY_TO_GRID
 * - USE_MY_METRICS (metrics redirection)
 * - gvar deltas on composite component offsets and phantom points
 */

// --- Synthetic glyph builders ---

/** Encodes a simple glyph with explicit int16 coordinate deltas (all points in one flag style) */
function encodeSimpleGlyph(points: [number, number][], endPts: number[]): Uint8Array {
  const w = new BinaryWriter()
  w.writeInt16(endPts.length) // numberOfContours
  w.writeInt16(0) // xMin
  w.writeInt16(0) // yMin
  w.writeInt16(0) // xMax
  w.writeInt16(0) // yMax
  for (const e of endPts) w.writeUint16(e)
  w.writeUint16(0) // instructionLength
  for (let i = 0; i < points.length; i++) w.writeUint8(0x01) // on-curve, int16 deltas
  let prevX = 0
  for (const [x] of points) { w.writeInt16(x - prevX); prevX = x }
  let prevY = 0
  for (const [, y] of points) { w.writeInt16(y - prevY); prevY = y }
  return w.toUint8Array()
}

interface CompSpec {
  glyphId: number
  flags: number // ARG_1_AND_2_ARE_WORDS and MORE_COMPONENTS are managed by the helper
  arg1: number
  arg2: number
  scales?: number[] // written as F2Dot14 in flag order
}

function encodeCompositeGlyph(components: CompSpec[]): Uint8Array {
  const w = new BinaryWriter()
  w.writeInt16(-1) // numberOfContours
  w.writeInt16(0)
  w.writeInt16(0)
  w.writeInt16(0)
  w.writeInt16(0)
  for (let i = 0; i < components.length; i++) {
    const c = components[i]!
    let flags = c.flags | ARG_1_AND_2_ARE_WORDS
    if (i < components.length - 1) flags |= MORE_COMPONENTS
    w.writeUint16(flags)
    w.writeUint16(c.glyphId)
    w.writeInt16(c.arg1)
    w.writeInt16(c.arg2)
    if (c.scales) {
      for (const s of c.scales) w.writeInt16(Math.round(s * 16384))
    }
  }
  return w.toUint8Array()
}

/** Builds a glyf buffer + LocaTable from per-glyph data (null = empty glyph) */
function makeGlyphSet(glyphs: (Uint8Array | null)[]): { glyfReader: BinaryReader; loca: LocaTable } {
  const offsets: number[] = []
  const lengths: number[] = []
  let total = 0
  for (const g of glyphs) {
    offsets.push(total)
    const len = g ? g.length : 0
    lengths.push(len)
    total += (len + 3) & ~3 // 4-byte alignment
  }
  const buf = new Uint8Array(total)
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    if (g) buf.set(g, offsets[i]!)
  }
  const loca: LocaTable = {
    numGlyphs: glyphs.length,
    getOffset: (glyphId: number) => (glyphId >= 0 && glyphId < glyphs.length) ? offsets[glyphId]! : 0,
    getLength: (glyphId: number) => (glyphId >= 0 && glyphId < glyphs.length) ? lengths[glyphId]! : 0,
  }
  return { glyfReader: new BinaryReader(buf.buffer as ArrayBuffer), loca }
}

// glyph 1: on-curve square (0,0)-(200,200)
const SQUARE_200: [number, number][] = [[0, 0], [200, 0], [200, 200], [0, 200]]

describe('composite glyph composition (synthetic glyf)', () => {
  // Verifies point matching: arg1/arg2 as anchor point numbers align the child onto the parent point.
  it('point matching positions the child so the two anchor points coincide', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES, arg1: 0, arg2: 0 },
      // anchor: parent point 2 = (200,200), child point 0 = (0,0)
      { glyphId: 1, flags: 0, arg1: 2, arg2: 0 },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])

    const outline = parseGlyph(glyfReader, loca, 2)
    // each contour: MoveTo + 4 LineTo (the last returns to the start) + Close
    expect(Array.from(outline.commands)).toEqual([
      PathCommand.MoveTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.Close,
      PathCommand.MoveTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.Close,
    ])
    expect(Array.from(outline.coords)).toEqual([
      0, 0, 200, 0, 200, 200, 0, 200, 0, 0,
      200, 200, 400, 200, 400, 400, 200, 400, 200, 200,
    ])
  })

  // Verifies point matching against a scaled child: the offset must be computed from the transformed child point.
  it('point matching uses the transformed child point', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES, arg1: 0, arg2: 0 },
      // child scaled by 0.5; child point 1 = (200,0) -> transformed (100,0)
      // parent point 1 = (200,0) -> offset (100,0)
      { glyphId: 1, flags: WE_HAVE_A_SCALE, arg1: 1, arg2: 1, scales: [0.5] },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])

    const outline = parseGlyph(glyfReader, loca, 2)
    // second contour: 0.5-scaled square translated by (100, 0)
    expect(Array.from(outline.coords).slice(10)).toEqual([
      100, 0, 200, 0, 200, 100, 100, 100, 100, 0,
    ])
  })

  it('point matching can align parent and child phantom points', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES, arg1: 0, arg2: 0 },
      // The final parent has 8 contour points, so point 9 is parent PP2.
      // Child point 4 is PP1 (four contour points followed by phantoms).
      { glyphId: 1, flags: 0, arg1: 9, arg2: 4 },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])
    const provider = {
      getAdvanceWidth: (glyphId: number) => glyphId === 2 ? 800 : 600,
      getLeftSideBearing: (glyphId: number) => glyphId === 2 ? 8 : 5,
      getAdvanceHeight: () => 1000,
      getTopSideBearing: () => 0,
    }

    const composed = composeGlyphPoints(glyfReader, loca, 2, null, null, provider)
    // Parent PP2 = 0 - 8 + 800 = 792; child PP1 = 0 - 5 = -5.
    // Translation is therefore 797 design units.
    expect(composed.xCoords[4]).toBe(797)
    expect(composed.yCoords[4]).toBe(0)
  })

  // Verifies the spec transform orientation: x' = xscale*x + scale10*y, y' = scale01*x + yscale*y.
  it('2x2 transform applies scale10 to the x row and scale01 to the y row', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES | WE_HAVE_A_TWO_BY_TWO, arg1: 0, arg2: 0, scales: [1, 0, 0.5, 1] },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])

    const outline = parseGlyph(glyfReader, loca, 2)
    // x' = x + 0.5*y (scale10 = 0.5), y' = y
    expect(Array.from(outline.coords)).toEqual([
      0, 0, 200, 0, 300, 200, 100, 200, 0, 0,
    ])
  })

  // Verifies SCALED_COMPONENT_OFFSET: the offset is transformed by the component matrix.
  it('SCALED_COMPONENT_OFFSET scales the offset by the component matrix', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      {
        glyphId: 1,
        flags: ARGS_ARE_XY_VALUES | WE_HAVE_A_SCALE | SCALED_COMPONENT_OFFSET,
        arg1: 100, arg2: 40, scales: [0.5],
      },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])

    const outline = parseGlyph(glyfReader, loca, 2)
    // points scaled by 0.5, offset (100,40) scaled to (50,20)
    expect(outline.coords[0]).toBe(50)
    expect(outline.coords[1]).toBe(20)
  })

  // Verifies UNSCALED_COMPONENT_OFFSET keeps the offset in the composite coordinate space.
  it('UNSCALED_COMPONENT_OFFSET keeps the offset unscaled', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      {
        glyphId: 1,
        flags: ARGS_ARE_XY_VALUES | WE_HAVE_A_SCALE | UNSCALED_COMPONENT_OFFSET,
        arg1: 100, arg2: 40, scales: [0.5],
      },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])

    const outline = parseGlyph(glyfReader, loca, 2)
    expect(outline.coords[0]).toBe(100)
    expect(outline.coords[1]).toBe(40)
  })

  // Verifies that without either offset-scaling flag the default is the unscaled (Microsoft) behavior.
  it('offset defaults to unscaled when neither SCALED nor UNSCALED flag is set', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES | WE_HAVE_A_SCALE, arg1: 100, arg2: 40, scales: [0.5] },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])

    const outline = parseGlyph(glyfReader, loca, 2)
    expect(outline.coords[0]).toBe(100)
    expect(outline.coords[1]).toBe(40)
  })

  // Verifies ROUND_XY_TO_GRID: fractional offsets (from scaled offsets) are rounded to integers.
  it('ROUND_XY_TO_GRID rounds the (scaled) offset', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      {
        glyphId: 1,
        flags: ARGS_ARE_XY_VALUES | WE_HAVE_A_SCALE | SCALED_COMPONENT_OFFSET | ROUND_XY_TO_GRID,
        arg1: 101, arg2: 41, scales: [0.5],
      },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])

    const outline = parseGlyph(glyfReader, loca, 2)
    // scaled offset (50.5, 20.5) -> rounded (51, 21)
    expect(outline.coords[0]).toBe(51)
    expect(outline.coords[1]).toBe(21)
  })

  // Verifies that a point-matching reference to a nonexistent point is rejected (malformed font).
  it('point matching with an out-of-range parent point throws', () => {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g2 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES, arg1: 0, arg2: 0 },
      { glyphId: 1, flags: 0, arg1: 99, arg2: 0 },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, g1, g2])

    expect(() => parseGlyph(glyfReader, loca, 2)).toThrow(/point-matching parent point/)
  })

  it('rejects reserved, conflicting transform, and conflicting offset flags', () => {
    function component(flags: number): BinaryReader {
      const w = new BinaryWriter()
      w.writeUint16(flags | ARG_1_AND_2_ARE_WORDS | ARGS_ARE_XY_VALUES)
      w.writeUint16(1)
      w.writeInt16(0)
      w.writeInt16(0)
      if ((flags & WE_HAVE_A_SCALE) !== 0) w.writeInt16(16384)
      if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) {
        w.writeInt16(16384); w.writeInt16(0); w.writeInt16(0); w.writeInt16(16384)
      }
      return new BinaryReader(w.toArrayBuffer())
    }

    expect(parseCompositeComponents(component(0x0010))).toHaveLength(1)
    expect(() => parseCompositeComponents(component(WE_HAVE_A_SCALE | WE_HAVE_A_TWO_BY_TWO))).toThrow(/mutually exclusive/)
    expect(() => parseCompositeComponents(component(SCALED_COMPONENT_OFFSET | UNSCALED_COMPONENT_OFFSET))).toThrow(/both scaled and unscaled/)
  })

  it('rejects a cyclic composite graph instead of returning an empty outline', () => {
    const cyclic = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES, arg1: 0, arg2: 0 },
    ])
    const { glyfReader, loca } = makeGlyphSet([null, cyclic])
    expect(() => parseGlyph(glyfReader, loca, 1)).toThrow('Composite glyph cycle detected: 1 -> 1')
  })
})

describe('simple glyph structural validation', () => {
  function simpleData(write: (w: BinaryWriter) => void): BinaryReader {
    const w = new BinaryWriter()
    write(w)
    return new BinaryReader(w.toArrayBuffer())
  }

  it('preserves instructions for a zero-contour glyph so they can address phantom points', () => {
    const raw = readSimpleGlyphData(simpleData(w => {
      w.writeUint16(3)
      w.writeBytes(new Uint8Array([0x01, 0xB0, 0x01]))
    }), 0)
    expect(raw.numPoints).toBe(0)
    expect(Array.from(raw.instructions)).toEqual([0x01, 0xB0, 0x01])
  })

  it('rejects non-increasing contour ends and malformed point flags', () => {
    expect(() => readSimpleGlyphData(simpleData(w => {
      w.writeUint16(0); w.writeUint16(0)
    }), 2)).toThrow(/strictly increasing/)

    expect(() => readSimpleGlyphData(simpleData(w => {
      w.writeUint16(0)
      w.writeUint16(0)
      w.writeUint8(0x80)
    }), 1)).toThrow(/reserved bit 7/)

    expect(() => readSimpleGlyphData(simpleData(w => {
      w.writeUint16(1)
      w.writeUint16(0)
      w.writeUint8(0x31)
      w.writeUint8(0x71)
    }), 1)).toThrow(/OVERLAP_SIMPLE/)

    expect(() => readSimpleGlyphData(simpleData(w => {
      w.writeUint16(0)
      w.writeUint16(0)
      w.writeUint8(0x39)
      w.writeUint8(1)
    }), 1)).toThrow(/exceeds point count/)
  })
})

describe('composite glyph gvar deltas (composeGlyphPoints)', () => {
  // glyph set:
  // 1 = simple square, 8 = composite of 1 (offset 10,20), 9 = composite of 8 (offset 5,5)
  // 11 = composite of 1 with USE_MY_METRICS, 12 = empty glyph
  function makeVarSet() {
    const g1 = encodeSimpleGlyph(SQUARE_200, [3])
    const g8 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES, arg1: 10, arg2: 20 },
    ])
    const g9 = encodeCompositeGlyph([
      { glyphId: 8, flags: ARGS_ARE_XY_VALUES, arg1: 5, arg2: 5 },
    ])
    const g10 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES, arg1: 0, arg2: 0 },
      { glyphId: 1, flags: 0, arg1: 2, arg2: 0 }, // anchor component
    ])
    const g11 = encodeCompositeGlyph([
      { glyphId: 1, flags: ARGS_ARE_XY_VALUES | USE_MY_METRICS, arg1: 0, arg2: 0 },
    ])
    return makeGlyphSet([null, g1, null, null, null, null, null, null, g8, g9, g10, g11, null])
  }

  const MOCK_DELTAS = new Map<number, { x: number[]; y: number[] }>([
    // composite g8: 1 component + 4 phantoms
    [8, { x: [50, 10, 30, 0, 0], y: [-25, 0, 0, 40, -60] }],
    // composite g9: 1 component + 4 phantoms
    [9, { x: [7, 0, 0, 0, 0], y: [0, 0, 0, 0, 0] }],
    // composite g10: 2 components + 4 phantoms (anchor component must ignore its delta)
    [10, { x: [0, 100, 0, 0, 0, 0], y: [0, 100, 0, 0, 0, 0] }],
    // composite g11: 1 component + 4 phantoms
    [11, { x: [0, 5, 9, 0, 0], y: [0, 0, 0, 0, 0] }],
    // empty glyph g12: only the 4 phantom points
    [12, { x: [3, 9, 0, 0], y: [0, 0, 40, -60] }],
  ])

  const mockGvar: GvarTable = {
    axisCount: 1,
    glyphCount: 13,
    getGlyphDeltas(glyphId: number, _coords: number[], numPoints: number) {
      const entry = MOCK_DELTAS.get(glyphId)
      if (!entry) return null
      expect(entry.x.length).toBe(numPoints) // the point count must match component+phantom count
      return { deltaX: entry.x.slice(), deltaY: entry.y.slice() }
    },
  }

  // Verifies that gvar deltas move a composite component via its offset "point" and adjust phantom metrics.
  it('applies component offset deltas and phantom point metrics deltas', () => {
    const { glyfReader, loca } = makeVarSet()
    const composed = composeGlyphPoints(glyfReader, loca, 8, mockGvar, [1.0])

    // component offset (10,20) + delta (50,-25) = (60,-5)
    expect(composed.xCoords[0]).toBe(60)
    expect(composed.yCoords[0]).toBe(-5)
    // phantom points: PP1 delta = 10, PP2 delta = 30
    expect(composed.advanceWidthDelta).toBe(20)
    expect(composed.lsbDelta).toBe(-10)
    expect(composed.advanceHeightDelta).toBe(100)
    expect(composed.verticalOriginDelta).toBe(40)
    expect(composed.metricsGlyphId).toBe(8)
  })

  // Verifies recursion: a composite of a composite applies deltas at each nesting level.
  it('applies deltas recursively for nested composites', () => {
    const { glyfReader, loca } = makeVarSet()
    const composed = composeGlyphPoints(glyfReader, loca, 9, mockGvar, [1.0])

    // inner g8 shift (60,-5), outer offset (5,5) + delta (7,0) = (12,5)
    expect(composed.xCoords[0]).toBe(72)
    expect(composed.yCoords[0]).toBe(0)
  })

  // Verifies that anchor-positioned (point matching) components ignore offset deltas per spec.
  it('does not apply deltas to point-matched components', () => {
    const { glyfReader, loca } = makeVarSet()
    const composed = composeGlyphPoints(glyfReader, loca, 10, mockGvar, [1.0])

    // second component anchored to parent point 2 = (200,200); the delta (100,100)
    // assigned to that component must be ignored
    expect(composed.xCoords[4]).toBe(200)
    expect(composed.yCoords[4]).toBe(200)
  })

  // Verifies USE_MY_METRICS: metrics (and their variation deltas) come from the component glyph.
  it('USE_MY_METRICS redirects metrics to the component glyph', () => {
    const { glyfReader, loca } = makeVarSet()
    const composed = composeGlyphPoints(glyfReader, loca, 11, mockGvar, [1.0])

    expect(composed.metricsGlyphId).toBe(1)
    // glyph 1 has no gvar data, so the composite's own phantom deltas do not apply
    expect(composed.advanceWidthDelta).toBe(0)
    expect(composed.lsbDelta).toBe(0)
  })

  // Verifies that an empty glyph still varies its metrics via the 4 phantom points.
  it('empty glyphs get phantom point metrics deltas', () => {
    const { glyfReader, loca } = makeVarSet()
    const composed = composeGlyphPoints(glyfReader, loca, 12, mockGvar, [1.0])

    expect(composed.numPoints).toBe(0)
    expect(composed.advanceWidthDelta).toBe(6) // PP2 - PP1 = 9 - 3
    expect(composed.lsbDelta).toBe(-3)
    expect(composed.advanceHeightDelta).toBe(100)
    expect(composed.verticalOriginDelta).toBe(40)
    expect(composedGlyphToOutline(composed).commands.length).toBe(0)
  })
})

// --- Full synthetic TTF for SfntTableManager-level tests ---

function buildTable(fn: (w: BinaryWriter) => void): Uint8Array {
  const w = new BinaryWriter()
  fn(w)
  return w.toUint8Array()
}

function buildFont(tables: [string, Uint8Array][]): ArrayBuffer {
  const sortedTables = [...tables].sort(([a], [b]) => compareSfntTags(a, b))
  const numTables = sortedTables.length
  const headerSize = 12 + numTables * 16
  const w = new BinaryWriter()
  const search = computeSfntSearchFields(numTables)
  w.writeUint32(0x00010000) // sfntVersion (TrueType)
  w.writeUint16(numTables)
  w.writeUint16(search.searchRange)
  w.writeUint16(search.entrySelector)
  w.writeUint16(search.rangeShift)

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
  for (let i = 0; i < numTables; i++) {
    const data = sortedTables[i]![1]
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

function buildHead(): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1) // majorVersion
    w.writeUint16(0) // minorVersion
    w.writeUint32(0x00010000) // fontRevision
    w.writeUint32(0) // checksumAdjustment
    w.writeUint32(0x5F0F3CF5) // magicNumber
    w.writeUint16(0) // flags
    w.writeUint16(1000) // unitsPerEm
    w.writeUint32(0); w.writeUint32(0) // created
    w.writeUint32(0); w.writeUint32(0) // modified
    w.writeInt16(0) // xMin
    w.writeInt16(0) // yMin
    w.writeInt16(400) // xMax
    w.writeInt16(400) // yMax
    w.writeUint16(0) // macStyle
    w.writeUint16(8) // lowestRecPPEM
    w.writeInt16(2) // fontDirectionHint
    w.writeInt16(1) // indexToLocFormat (long)
    w.writeInt16(0) // glyphDataFormat
  })
}

function buildMaxp(numGlyphs: number): Uint8Array {
  return buildTable(w => {
    w.writeUint32(0x00005000) // version 0.5
    w.writeUint16(numGlyphs)
  })
}

function buildHhea(numberOfHMetrics: number): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1); w.writeUint16(0) // version
    w.writeInt16(800) // ascender
    w.writeInt16(-200) // descender
    w.writeInt16(0) // lineGap
    w.writeUint16(1000) // advanceWidthMax
    w.writeInt16(0) // minLeftSideBearing
    w.writeInt16(0) // minRightSideBearing
    w.writeInt16(0) // xMaxExtent
    w.writeInt16(1) // caretSlopeRise
    w.writeInt16(0) // caretSlopeRun
    w.writeInt16(0) // caretOffset
    w.writeInt16(0); w.writeInt16(0); w.writeInt16(0); w.writeInt16(0) // reserved
    w.writeInt16(0) // metricDataFormat
    w.writeUint16(numberOfHMetrics)
  })
}

function buildHmtx(metrics: [number, number][]): Uint8Array {
  return buildTable(w => {
    for (const [aw, lsb] of metrics) {
      w.writeUint16(aw)
      w.writeInt16(lsb)
    }
  })
}

function buildFvar(): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1); w.writeUint16(0) // version
    w.writeUint16(16) // axesArrayOffset
    w.writeUint16(2) // reserved
    w.writeUint16(1) // axisCount
    w.writeUint16(20) // axisSize
    w.writeUint16(0) // instanceCount
    w.writeUint16(8) // instanceSize
    // wght axis
    w.writeTag('wght')
    w.writeUint32(100 * 65536) // minValue
    w.writeUint32(400 * 65536) // defaultValue
    w.writeUint32(900 * 65536) // maxValue
    w.writeUint16(0) // flags
    w.writeUint16(256) // axisNameId
  })
}

/**
 * gvar with variation data for glyph 3 only (composite: 1 component + 4 phantoms):
 * peak wght=1.0, deltaX=[50,10,30,0,0], deltaY=[-25,0,0,0,0]
 */
function buildGvar(glyphCount: number): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1); w.writeUint16(0) // version
    w.writeUint16(1) // axisCount
    w.writeUint16(0) // sharedTupleCount
    w.writeUint32(20) // sharedTuplesOffset (empty)
    w.writeUint16(glyphCount)
    w.writeUint16(0) // flags (short offsets)
    w.writeUint32(20 + (glyphCount + 1) * 2) // glyphVariationDataArrayOffset
    // offsets (short: value = byteOffset / 2); data only for the last glyph (id 3)
    for (let i = 0; i <= glyphCount; i++) {
      w.writeUint16(i === glyphCount ? 11 : 0) // 22 bytes / 2
    }
    // GlyphVariationData for glyph 3
    w.writeUint16(1) // tupleVariationCount
    w.writeUint16(10) // dataOffset (4 header + 6 tuple header)
    w.writeUint16(12) // variationDataSize
    w.writeUint16(0x8000) // tupleIndex: embedded peak tuple
    w.writeInt16(16384) // peak = 1.0 (F2Dot14)
    // serialized data: packed deltas X then Y (5 points, no point numbers)
    w.writeUint8(0x04) // 5 byte-sized deltas
    w.writeUint8(50); w.writeUint8(10); w.writeUint8(30); w.writeUint8(0); w.writeUint8(0)
    w.writeUint8(0x04)
    w.writeUint8(256 - 25); w.writeUint8(0); w.writeUint8(0); w.writeUint8(0); w.writeUint8(0)
  })
}

function buildVariableTtf(): ArrayBuffer {
  // glyphs: 0 = square 100, 1 = square 200, 2 = composite USE_MY_METRICS, 3 = composite plain
  const g0 = encodeSimpleGlyph([[0, 0], [100, 0], [100, 100], [0, 100]], [3])
  const g1 = encodeSimpleGlyph(SQUARE_200, [3])
  const g2 = encodeCompositeGlyph([
    { glyphId: 1, flags: ARGS_ARE_XY_VALUES | USE_MY_METRICS, arg1: 10, arg2: 20 },
  ])
  const g3 = encodeCompositeGlyph([
    { glyphId: 1, flags: ARGS_ARE_XY_VALUES, arg1: 10, arg2: 20 },
  ])

  const glyphs = [g0, g1, g2, g3]
  const glyfW = new BinaryWriter()
  const locaW = new BinaryWriter()
  let glyfSize = 0
  for (const g of glyphs) {
    locaW.writeUint32(glyfSize)
    const padded = new Uint8Array((g.length + 3) & ~3)
    padded.set(g)
    glyfW.writeBytes(padded)
    glyfSize += padded.length
  }
  locaW.writeUint32(glyfSize)

  return buildFont([
    ['head', buildHead()],
    ['maxp', buildMaxp(4)],
    ['hhea', buildHhea(4)],
    ['hmtx', buildHmtx([[500, 0], [600, 5], [700, 7], [800, 8]])],
    ['loca', locaW.toUint8Array()],
    ['glyf', glyfW.toUint8Array()],
    ['fvar', buildFvar()],
    ['gvar', buildGvar(4)],
  ])
}

describe('SfntTableManager composite glyphs (synthetic variable TTF)', () => {
  // Verifies USE_MY_METRICS at the manager level: advance/lsb come from the component's hmtx entry.
  it('USE_MY_METRICS takes advance width and lsb from the component glyph', () => {
    const manager = new SfntTableManager(parseSfntDirectory(buildVariableTtf()))
    const glyph = manager.getGlyphOutline(2)

    expect(glyph.advanceWidth).toBe(600) // hmtx of glyph 1, not glyph 2 (700)
    expect(glyph.lsb).toBe(5)
    // outline is glyph 1 translated by (10, 20)
    expect(glyph.outline.coords[0]).toBe(10)
    expect(glyph.outline.coords[1]).toBe(20)
  })

  it('connects USE_MY_METRICS to Font layout bearings and advance width', () => {
    const font = Font.load(buildVariableTtf())
    expect(font.getAdvanceWidth(2)).toBe(600)
    expect(font.getLeftSideBearing(2)).toBe(5)
    expect(font.getRightSideBearing(2)).toBe(395)
  })

  // Verifies that without variation coords the composite is positioned by its raw offsets.
  it('composite glyph without variation coords uses the raw offsets', () => {
    const manager = new SfntTableManager(parseSfntDirectory(buildVariableTtf()))
    const glyph = manager.getGlyphOutline(3)

    expect(glyph.advanceWidth).toBe(800)
    expect(glyph.lsb).toBe(8)
    expect(glyph.outline.coords[0]).toBe(10)
    expect(glyph.outline.coords[1]).toBe(20)
  })

  // Verifies gvar delta application to a composite via a real gvar binary:
  // component offset deltas move the outline, phantom points vary advance/lsb.
  it('applies gvar deltas to composite component offsets and metrics', () => {
    const manager = new SfntTableManager(parseSfntDirectory(buildVariableTtf()))
    manager.setNormalizedCoords([1.0])
    const glyph = manager.getGlyphOutline(3)

    // offset (10,20) + delta (50,-25) = (60,-5)
    expect(glyph.outline.coords[0]).toBe(60)
    expect(glyph.outline.coords[1]).toBe(-5)
    // advance 800 + (PP2 30 - PP1 10) = 820, lsb 8 - 10 = -2
    expect(glyph.advanceWidth).toBe(820)
    expect(glyph.lsb).toBe(-2)
  })

  // Verifies scalar interpolation: at half weight the deltas are halved (rounded per point).
  it('scales composite deltas by the tuple scalar', () => {
    const manager = new SfntTableManager(parseSfntDirectory(buildVariableTtf()))
    manager.setNormalizedCoords([0.5])
    const glyph = manager.getGlyphOutline(3)

    // offset (10,20) + delta (25,-12.5) = (35, 7.5)
    expect(glyph.outline.coords[0]).toBe(35)
    expect(glyph.outline.coords[1]).toBe(7.5)
    // advance 800 + round(15 - 5) = 810, lsb 8 + round(-5) = 3
    expect(glyph.advanceWidth).toBe(810)
    expect(glyph.lsb).toBe(3)
  })
})
