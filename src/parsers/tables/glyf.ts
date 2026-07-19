import { BinaryReader } from '../../binary/reader.js'
import { PathCommand } from '../../types/glyph.js'
import type { GlyphOutline } from '../../types/index.js'
import type { LocaTable } from '../../types/index.js'
import type { GvarTable } from './gvar.js'

/** Empty outline */
const EMPTY_OUTLINE: GlyphOutline = {
  commands: new Uint8Array(0),
  coords: new Float32Array(0),
}

/** Raw point coordinates for applying gvar deltas */
export interface RawSimpleGlyph {
  endPts: Uint16Array
  instructions: Uint8Array
  flags: Uint8Array
  xCoords: number[]  // number[] to avoid Int16 overflow when gvar deltas are applied
  yCoords: number[]
  numPoints: number
  numberOfContours: number
}

// Simple glyph flags
export const ON_CURVE_POINT = 0x01
const X_SHORT_VECTOR = 0x02
const Y_SHORT_VECTOR = 0x04
const REPEAT_FLAG = 0x08
const X_IS_SAME_OR_POSITIVE = 0x10
const Y_IS_SAME_OR_POSITIVE = 0x20
export const OVERLAP_SIMPLE = 0x40
const SIMPLE_RESERVED = 0x80

// Composite glyph flags (OpenType glyf table specification)
export const ARG_1_AND_2_ARE_WORDS = 0x0001
export const ARGS_ARE_XY_VALUES = 0x0002
export const ROUND_XY_TO_GRID = 0x0004
export const WE_HAVE_A_SCALE = 0x0008
export const MORE_COMPONENTS = 0x0020
export const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
export const WE_HAVE_A_TWO_BY_TWO = 0x0080
export const WE_HAVE_INSTRUCTIONS = 0x0100
export const USE_MY_METRICS = 0x0200
export const OVERLAP_COMPOUND = 0x0400
export const SCALED_COMPONENT_OFFSET = 0x0800
export const UNSCALED_COMPONENT_OFFSET = 0x1000

/** One component record of a composite glyph */
export interface CompositeComponent {
  glyphId: number
  /** Raw component flags (see the exported flag constants) */
  flags: number
  /** X offset (ARGS_ARE_XY_VALUES) or parent point number (point matching) */
  arg1: number
  /** Y offset (ARGS_ARE_XY_VALUES) or child point number (point matching) */
  arg2: number
  scaleX: number
  scale01: number
  scale10: number
  scaleY: number
}

/**
 * Composed (flattened) glyph point data.
 * Composite glyphs are recursively resolved into a single point list;
 * variation deltas (gvar) are already applied when requested.
 */
export interface ComposedGlyph {
  endPts: Uint16Array | number[]
  flags: Uint8Array | number[]
  xCoords: number[]
  yCoords: number[]
  numPoints: number
  /** Glyph whose hmtx metrics apply (redirected by USE_MY_METRICS) */
  metricsGlyphId: number
  /** Variation adjustment for advance width from phantom points (unrounded) */
  advanceWidthDelta: number
  /** Variation adjustment for left side bearing from phantom points (unrounded) */
  lsbDelta: number
  /** Variation adjustment for advance height from vertical phantom points (unrounded) */
  advanceHeightDelta: number
  /** Variation adjustment for the vertical-origin Y from the top phantom point (unrounded) */
  verticalOriginDelta: number
  /** Unhinted phantom points in glyph coordinates when horizontal/vertical metrics were supplied. */
  phantomX?: readonly number[]
  phantomY?: readonly number[]
}

export interface GlyphPhantomPointProvider {
  getAdvanceWidth(glyphId: number): number
  getLeftSideBearing(glyphId: number): number
  getAdvanceHeight(glyphId: number): number
  getTopSideBearing(glyphId: number): number
}

/**
 * Parses an individual glyph outline from the glyf table
 * Converts quadratic Beziers (TrueType) to cubic Beziers
 */
export function parseGlyph(
  glyfReader: BinaryReader,
  loca: LocaTable,
  glyphId: number,
  recursionDepth = 0
): GlyphOutline {
  const composed = composeGlyphPoints(glyfReader, loca, glyphId, null, null, null, recursionDepth)
  return composedGlyphToOutline(composed)
}

/** Returns raw point coordinates (for applying gvar deltas) */
export function parseSimpleGlyphPoints(
  glyfReader: BinaryReader, loca: LocaTable, glyphId: number,
): RawSimpleGlyph | null {
  const offset = loca.getOffset(glyphId)
  const length = loca.getLength(glyphId)
  if (length === 0) return null

  const reader = glyfReader.subReader(offset, length)
  const numberOfContours = reader.readInt16()
  reader.skip(8) // bounding box

  if (numberOfContours < 0) return null // composite

  return readSimpleGlyphData(reader, numberOfContours)
}

/** Parses the component records of a composite glyph (reader positioned after the glyph header) */
export function parseCompositeComponents(reader: BinaryReader): CompositeComponent[] {
  const components: CompositeComponent[] = []
  let flags: number
  let usesMetrics = false

  do {
    flags = reader.readUint16()
    // Bit 4 was defined in early TrueType revisions and is obsolete. The
    // OpenType compatibility rules require readers to ignore reserved bits;
    // shipping fonts still set this bit, so only bits with no historical
    // component meaning are rejected here.
    if ((flags & 0xE000) !== 0) {
      throw new Error(`Composite glyph flags contain reserved bits: 0x${flags.toString(16).padStart(4, '0')}`)
    }
    const transformFlags = flags & (WE_HAVE_A_SCALE | WE_HAVE_AN_X_AND_Y_SCALE | WE_HAVE_A_TWO_BY_TWO)
    if (transformFlags !== 0 && (transformFlags & (transformFlags - 1)) !== 0) {
      throw new Error(`Composite glyph transform flags are mutually exclusive: 0x${flags.toString(16).padStart(4, '0')}`)
    }
    if ((flags & SCALED_COMPONENT_OFFSET) !== 0 && (flags & UNSCALED_COMPONENT_OFFSET) !== 0) {
      throw new Error('Composite glyph cannot set both scaled and unscaled component-offset flags')
    }
    if ((flags & USE_MY_METRICS) !== 0) {
      if (usesMetrics) throw new Error('Composite glyph cannot set USE_MY_METRICS on more than one component')
      usesMetrics = true
    }
    if (components.length === 0 && (flags & ARGS_ARE_XY_VALUES) === 0) {
      throw new Error('Composite glyph first component must use explicit XY arguments')
    }
    if (components.length > 0 && (flags & OVERLAP_COMPOUND) !== 0) {
      throw new Error('Composite glyph OVERLAP_COMPOUND may only be set on the first component')
    }
    const glyphId = reader.readUint16()

    let arg1: number
    let arg2: number

    if (flags & ARG_1_AND_2_ARE_WORDS) {
      if (flags & ARGS_ARE_XY_VALUES) {
        arg1 = reader.readInt16()
        arg2 = reader.readInt16()
      } else {
        // Point numbers are unsigned
        arg1 = reader.readUint16()
        arg2 = reader.readUint16()
      }
    } else {
      if (flags & ARGS_ARE_XY_VALUES) {
        arg1 = reader.readInt8()
        arg2 = reader.readInt8()
      } else {
        arg1 = reader.readUint8()
        arg2 = reader.readUint8()
      }
    }

    let scaleX = 1
    let scale01 = 0
    let scale10 = 0
    let scaleY = 1

    if (flags & WE_HAVE_A_SCALE) {
      scaleX = scaleY = reader.readF2Dot14()
    } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
      scaleX = reader.readF2Dot14()
      scaleY = reader.readF2Dot14()
    } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
      scaleX = reader.readF2Dot14()
      scale01 = reader.readF2Dot14()
      scale10 = reader.readF2Dot14()
      scaleY = reader.readF2Dot14()
    }

    components.push({ glyphId, flags, arg1, arg2, scaleX, scale01, scale10, scaleY })
  } while (flags & MORE_COMPONENTS)

  return components
}

/**
 * Resolves a glyph (simple or composite) into a flat point list.
 * When gvar and normalized coords are given, variation deltas are applied:
 * simple glyphs get per-point deltas (with IUP), composite glyphs get one
 * delta per component offset plus the 4 phantom points (no IUP, per spec).
 */
export function composeGlyphPoints(
  glyfReader: BinaryReader,
  loca: LocaTable,
  glyphId: number,
  gvar: GvarTable | null,
  coords: number[] | null,
  phantomProvider: GlyphPhantomPointProvider | null = null,
  recursionDepth = 0,
  glyphStack: readonly number[] = [],
): ComposedGlyph {
  if (!Number.isInteger(glyphId) || glyphId < 0 || glyphId >= loca.numGlyphs) {
    throw new Error(`Glyph ID ${glyphId} is outside loca glyph range 0..${loca.numGlyphs - 1}`)
  }
  if (glyphStack.includes(glyphId)) {
    throw new Error(`Composite glyph cycle detected: ${[...glyphStack, glyphId].join(' -> ')}`)
  }

  const offset = loca.getOffset(glyphId)
  const length = loca.getLength(glyphId)

  if (length === 0) {
    return emptyComposedGlyph(glyphId, gvar, coords, phantomProvider)
  }

  const reader = glyfReader.subReader(offset, length)
  const numberOfContours = reader.readInt16()
  const glyphXMin = reader.readInt16()
  reader.readInt16() // yMin
  reader.readInt16() // xMax
  const glyphYMax = reader.readInt16()

  if (numberOfContours >= 0) {
    const raw = readSimpleGlyphData(reader, numberOfContours)

    let advanceWidthDelta = 0
    let lsbDelta = 0
    let advanceHeightDelta = 0
    let verticalOriginDelta = 0
    const phantomDeltaX = [0, 0, 0, 0]
    const phantomDeltaY = [0, 0, 0, 0]
    if (gvar && coords) {
      // phantom points (4, appended after the outline points):
      //   PP1 (numPoints+0): origin point — its x coordinate affects lsb
      //   PP2 (numPoints+1): advance width point — its x coordinate affects advanceWidth
      //   PP3 (numPoints+2): top origin
      //   PP4 (numPoints+3): advance height point
      const numPoints = raw.numPoints + 4
      const deltas = gvar.getGlyphDeltas(
        glyphId, coords, numPoints,
        raw.endPts, raw.xCoords, raw.yCoords,
      )
      if (deltas) {
        for (let i = 0; i < raw.numPoints; i++) {
          // Unhinted variation outlines retain fractional design-unit deltas.
          // Grid rounding belongs to the hinting/rasterization stage.
          raw.xCoords[i] = raw.xCoords[i]! + deltas.deltaX[i]!
          raw.yCoords[i] = raw.yCoords[i]! + deltas.deltaY[i]!
        }
        // advanceWidth = PP2.x - PP1.x, so apply the delta difference
        const pp1DeltaX = deltas.deltaX[raw.numPoints]!
        const pp2DeltaX = deltas.deltaX[raw.numPoints + 1]!
        const pp3DeltaY = deltas.deltaY[raw.numPoints + 2]!
        const pp4DeltaY = deltas.deltaY[raw.numPoints + 3]!
        for (let p = 0; p < 4; p++) {
          phantomDeltaX[p] = deltas.deltaX[raw.numPoints + p]!
          phantomDeltaY[p] = deltas.deltaY[raw.numPoints + p]!
        }
        advanceWidthDelta = pp2DeltaX - pp1DeltaX
        lsbDelta = -pp1DeltaX // when the origin moves, lsb shifts in the opposite direction
        advanceHeightDelta = pp3DeltaY - pp4DeltaY
        verticalOriginDelta = pp3DeltaY
      }
    }

    const phantoms = buildPhantomPoints(glyphId, glyphXMin, glyphYMax, phantomProvider, phantomDeltaX, phantomDeltaY)
    return {
      endPts: raw.endPts,
      flags: raw.flags,
      xCoords: raw.xCoords,
      yCoords: raw.yCoords,
      numPoints: raw.numPoints,
      metricsGlyphId: glyphId,
      advanceWidthDelta,
      lsbDelta,
      advanceHeightDelta,
      verticalOriginDelta,
      ...phantoms,
    }
  }

  return composeCompositeGlyph(
    reader, glyfReader, loca, glyphId, glyphXMin, glyphYMax,
    gvar, coords, phantomProvider, recursionDepth, [...glyphStack, glyphId],
  )
}

function emptyComposedGlyph(
  glyphId: number,
  gvar: GvarTable | null,
  coords: number[] | null,
  phantomProvider: GlyphPhantomPointProvider | null,
): ComposedGlyph {
  let advanceWidthDelta = 0
  let lsbDelta = 0
  let advanceHeightDelta = 0
  let verticalOriginDelta = 0
  const phantomDeltaX = [0, 0, 0, 0]
  const phantomDeltaY = [0, 0, 0, 0]
  if (gvar && coords) {
    // An empty glyph still has its 4 phantom points whose deltas vary metrics
    const deltas = gvar.getGlyphDeltas(glyphId, coords, 4)
    if (deltas) {
      advanceWidthDelta = deltas.deltaX[1]! - deltas.deltaX[0]!
      lsbDelta = -deltas.deltaX[0]!
      advanceHeightDelta = deltas.deltaY[2]! - deltas.deltaY[3]!
      verticalOriginDelta = deltas.deltaY[2]!
      for (let p = 0; p < 4; p++) {
        phantomDeltaX[p] = deltas.deltaX[p]!
        phantomDeltaY[p] = deltas.deltaY[p]!
      }
    }
  }
  const phantoms = buildPhantomPoints(glyphId, 0, 0, phantomProvider, phantomDeltaX, phantomDeltaY)
  return {
    endPts: [],
    flags: [],
    xCoords: [],
    yCoords: [],
    numPoints: 0,
    metricsGlyphId: glyphId,
    advanceWidthDelta,
    lsbDelta,
    advanceHeightDelta,
    verticalOriginDelta,
    ...phantoms,
  }
}

function composeCompositeGlyph(
  reader: BinaryReader,
  glyfReader: BinaryReader,
  loca: LocaTable,
  glyphId: number,
  glyphXMin: number,
  glyphYMax: number,
  gvar: GvarTable | null,
  coords: number[] | null,
  phantomProvider: GlyphPhantomPointProvider | null,
  recursionDepth: number,
  glyphStack: readonly number[],
): ComposedGlyph {
  const components = parseCompositeComponents(reader)
  const numComponents = components.length

  // gvar treats a composite glyph as having one "point" per component
  // (its x,y offset) followed by the 4 phantom points. IUP interpolation
  // does not apply; components without deltas do not move.
  let compDeltaX: number[] | null = null
  let compDeltaY: number[] | null = null
  let advanceWidthDelta = 0
  let lsbDelta = 0
  let advanceHeightDelta = 0
  let verticalOriginDelta = 0
  const phantomDeltaX = [0, 0, 0, 0]
  const phantomDeltaY = [0, 0, 0, 0]
  if (gvar && coords) {
    const deltas = gvar.getGlyphDeltas(glyphId, coords, numComponents + 4)
    if (deltas) {
      compDeltaX = deltas.deltaX
      compDeltaY = deltas.deltaY
      const pp1DeltaX = deltas.deltaX[numComponents]!
      const pp2DeltaX = deltas.deltaX[numComponents + 1]!
      const pp3DeltaY = deltas.deltaY[numComponents + 2]!
      const pp4DeltaY = deltas.deltaY[numComponents + 3]!
      advanceWidthDelta = pp2DeltaX - pp1DeltaX
      lsbDelta = -pp1DeltaX
      advanceHeightDelta = pp3DeltaY - pp4DeltaY
      verticalOriginDelta = pp3DeltaY
      for (let p = 0; p < 4; p++) {
        phantomDeltaX[p] = deltas.deltaX[numComponents + p]!
        phantomDeltaY[p] = deltas.deltaY[numComponents + p]!
      }
    }
  }

  const children = new Array<ComposedGlyph>(numComponents)
  let totalPointCount = 0
  for (let ci = 0; ci < numComponents; ci++) {
    children[ci] = composeGlyphPoints(
      glyfReader, loca, components[ci]!.glyphId, gvar, coords,
      phantomProvider, recursionDepth + 1, glyphStack,
    )
    totalPointCount += children[ci]!.numPoints
  }

  const endPts: number[] = []
  const flags: number[] = []
  const xCoords: number[] = []
  const yCoords: number[] = []
  let metricsGlyphId = glyphId
  let parentPhantoms = buildPhantomPoints(
    glyphId, glyphXMin, glyphYMax, phantomProvider, phantomDeltaX, phantomDeltaY,
  )

  for (let ci = 0; ci < numComponents; ci++) {
    const comp = components[ci]!
    const child = children[ci]!

    if (comp.flags & USE_MY_METRICS) {
      // The composite takes its advance/lsb from this component's glyph
      metricsGlyphId = child.metricsGlyphId
      advanceWidthDelta = child.advanceWidthDelta
      lsbDelta = child.lsbDelta
      advanceHeightDelta = child.advanceHeightDelta
      verticalOriginDelta = child.verticalOriginDelta
    }

    // Transform child points by the component matrix (offset applied below).
    // Spec formula: x' = xscale*x + scale10*y, y' = scale01*x + yscale*y
    const n = child.numPoints
    const tx: number[] = new Array(n)
    const ty: number[] = new Array(n)
    const cx = child.xCoords
    const cy = child.yCoords
    for (let i = 0; i < n; i++) {
      tx[i] = comp.scaleX * cx[i]! + comp.scale10 * cy[i]!
      ty[i] = comp.scale01 * cx[i]! + comp.scaleY * cy[i]!
    }

    let dx: number
    let dy: number

    if (comp.flags & ARGS_ARE_XY_VALUES) {
      dx = comp.arg1
      dy = comp.arg2
      // Variation deltas apply to explicit x,y offsets only; point-matched
      // components derive their position from already-varied points
      if (compDeltaX && compDeltaY) {
        dx += compDeltaX[ci]!
        dy += compDeltaY[ci]!
      }
      if ((comp.flags & SCALED_COMPONENT_OFFSET)
        && !(comp.flags & UNSCALED_COMPONENT_OFFSET)
        && (comp.flags & (WE_HAVE_A_SCALE | WE_HAVE_AN_X_AND_Y_SCALE | WE_HAVE_A_TWO_BY_TWO))) {
        // Apple-style scaled offset: the offset is expressed in the child
        // coordinate space, so transform it by the component matrix.
        // Default (neither flag) is the unscaled Microsoft behavior.
        const sdx = comp.scaleX * dx + comp.scale10 * dy
        const sdy = comp.scale01 * dx + comp.scaleY * dy
        dx = sdx
        dy = sdy
      }
      if (comp.flags & ROUND_XY_TO_GRID) {
        dx = Math.round(dx)
        dy = Math.round(dy)
      }
    } else {
      // Point matching: arg1 = point number in the composite composed so far,
      // arg2 = point number in the (transformed) child; the offset makes the
      // two points coincide
      const parentIdx = comp.arg1
      const childIdx = comp.arg2
      const parentPoint = resolveCompositePoint(
        parentIdx, xCoords, yCoords, totalPointCount,
        parentPhantoms.phantomX, parentPhantoms.phantomY,
        `Composite glyph ${glyphId}: point-matching parent point`,
      )
      const childPoint = resolveTransformedChildPoint(
        childIdx, tx, ty, child, comp,
        `Composite glyph ${glyphId}: point-matching child point`,
      )
      dx = parentPoint.x - childPoint.x
      dy = parentPoint.y - childPoint.y
    }

    const base = xCoords.length
    const childFlags = child.flags
    for (let i = 0; i < n; i++) {
      xCoords.push(tx[i]! + dx)
      yCoords.push(ty[i]! + dy)
      flags.push(childFlags[i]!)
    }
    const childEndPts = child.endPts
    for (let c = 0; c < childEndPts.length; c++) {
      endPts.push(base + childEndPts[c]!)
    }
    if ((comp.flags & USE_MY_METRICS) !== 0 && child.phantomX !== undefined && child.phantomY !== undefined) {
      const px = new Array<number>(4)
      const py = new Array<number>(4)
      for (let p = 0; p < 4; p++) {
        px[p] = comp.scaleX * child.phantomX[p]! + comp.scale10 * child.phantomY[p]! + dx
        py[p] = comp.scale01 * child.phantomX[p]! + comp.scaleY * child.phantomY[p]! + dy
      }
      parentPhantoms = { phantomX: px, phantomY: py }
    }
  }

  return {
    endPts,
    flags,
    xCoords,
    yCoords,
    numPoints: xCoords.length,
    metricsGlyphId,
    advanceWidthDelta,
    lsbDelta,
    advanceHeightDelta,
    verticalOriginDelta,
    ...parentPhantoms,
  }
}

function buildPhantomPoints(
  glyphId: number,
  xMin: number,
  yMax: number,
  provider: GlyphPhantomPointProvider | null,
  deltaX: readonly number[],
  deltaY: readonly number[],
): { phantomX?: readonly number[], phantomY?: readonly number[] } {
  if (provider === null) return {}
  const pp1 = xMin - provider.getLeftSideBearing(glyphId)
  const pp3 = yMax + provider.getTopSideBearing(glyphId)
  return {
    phantomX: [
      pp1 + deltaX[0]!,
      pp1 + provider.getAdvanceWidth(glyphId) + deltaX[1]!,
      deltaX[2]!,
      deltaX[3]!,
    ],
    phantomY: [
      deltaY[0]!,
      deltaY[1]!,
      pp3 + deltaY[2]!,
      pp3 - provider.getAdvanceHeight(glyphId) + deltaY[3]!,
    ],
  }
}

function resolveCompositePoint(
  index: number,
  x: readonly number[],
  y: readonly number[],
  finalPointCount: number,
  phantomX: readonly number[] | undefined,
  phantomY: readonly number[] | undefined,
  label: string,
): { x: number, y: number } {
  if (index < x.length) return { x: x[index]!, y: y[index]! }
  const phantomIndex = index - finalPointCount
  if (phantomIndex >= 0 && phantomIndex < 4 && phantomX !== undefined && phantomY !== undefined) {
    return { x: phantomX[phantomIndex]!, y: phantomY[phantomIndex]! }
  }
  throw new Error(`${label} ${index} out of range (${x.length} incorporated points, ${finalPointCount} final points)`)
}

function resolveTransformedChildPoint(
  index: number,
  x: readonly number[],
  y: readonly number[],
  child: ComposedGlyph,
  transform: CompositeComponent,
  label: string,
): { x: number, y: number } {
  if (index < x.length) return { x: x[index]!, y: y[index]! }
  const phantomIndex = index - child.numPoints
  if (phantomIndex >= 0 && phantomIndex < 4 && child.phantomX !== undefined && child.phantomY !== undefined) {
    const px = child.phantomX[phantomIndex]!
    const py = child.phantomY[phantomIndex]!
    return {
      x: transform.scaleX * px + transform.scale10 * py,
      y: transform.scale01 * px + transform.scaleY * py,
    }
  }
  throw new Error(`${label} ${index} out of range (${child.numPoints} contour points)`)
}

export function readSimpleGlyphData(reader: BinaryReader, numberOfContours: number): RawSimpleGlyph {
  if (numberOfContours < 0) throw new Error(`Simple glyph contour count cannot be negative: ${numberOfContours}`)

  // endPtsOfContours
  const endPts = new Uint16Array(numberOfContours)
  for (let i = 0; i < numberOfContours; i++) {
    endPts[i] = reader.readUint16()
    if (i > 0 && endPts[i]! <= endPts[i - 1]!) {
      throw new Error(`Simple glyph contour end points must be strictly increasing at contour ${i}`)
    }
  }

  const numPoints = numberOfContours === 0 ? 0 : endPts[numberOfContours - 1]! + 1

  // A zero-contour glyph may consist only of the ten-byte glyph header. If
  // additional data is present, it starts with the normal instruction length
  // and can operate on the four phantom points.
  if (numberOfContours === 0 && reader.remaining === 0) {
    return {
      endPts,
      instructions: new Uint8Array(0),
      flags: new Uint8Array(0),
      xCoords: [],
      yCoords: [],
      numPoints: 0,
      numberOfContours: 0,
    }
  }

  const instructionLength = reader.readUint16()
  const instructions = reader.readBytes(instructionLength)

  // flags
  const flags = new Uint8Array(numPoints)
  for (let i = 0; i < numPoints; ) {
    const flag = reader.readUint8()
    if ((flag & SIMPLE_RESERVED) !== 0) {
      throw new Error(`Simple glyph flag reserved bit 7 must be zero at point ${i}`)
    }
    if ((flag & OVERLAP_SIMPLE) !== 0 && i !== 0) {
      throw new Error(`Simple glyph OVERLAP_SIMPLE may only be set on the first flag, got point ${i}`)
    }
    flags[i] = flag
    i++
    if (flag & REPEAT_FLAG) {
      const repeatCount = reader.readUint8()
      if (repeatCount > numPoints - i) {
        throw new Error(`Simple glyph repeated flag exceeds point count by ${repeatCount - (numPoints - i)}`)
      }
      for (let j = 0; j < repeatCount; j++, i++) {
        flags[i] = flag
      }
    }
  }

  // x coordinates
  const xCoords: number[] = new Array(numPoints)
  let x = 0
  for (let i = 0; i < numPoints; i++) {
    const flag = flags[i]!
    if (flag & X_SHORT_VECTOR) {
      const dx = reader.readUint8()
      x += (flag & X_IS_SAME_OR_POSITIVE) ? dx : -dx
    } else if (!(flag & X_IS_SAME_OR_POSITIVE)) {
      x += reader.readInt16()
    }
    xCoords[i] = x
  }

  // y coordinates
  const yCoords: number[] = new Array(numPoints)
  let y = 0
  for (let i = 0; i < numPoints; i++) {
    const flag = flags[i]!
    if (flag & Y_SHORT_VECTOR) {
      const dy = reader.readUint8()
      y += (flag & Y_IS_SAME_OR_POSITIVE) ? dy : -dy
    } else if (!(flag & Y_IS_SAME_OR_POSITIVE)) {
      y += reader.readInt16()
    }
    yCoords[i] = y
  }

  return { endPts, instructions, flags, xCoords, yCoords, numPoints, numberOfContours }
}

/** Converts raw points to a cubic Bezier outline */
export function rawPointsToOutline(raw: RawSimpleGlyph): GlyphOutline {
  return convertToOutline(raw.endPts, raw.flags, raw.xCoords, raw.yCoords, raw.numPoints, raw.numberOfContours)
}

/** Converts composed glyph points to a cubic Bezier outline */
export function composedGlyphToOutline(composed: ComposedGlyph): GlyphOutline {
  if (composed.numPoints === 0) return EMPTY_OUTLINE
  return convertToOutline(
    composed.endPts, composed.flags, composed.xCoords, composed.yCoords,
    composed.numPoints, composed.endPts.length,
  )
}

/**
 * Converts TrueType quadratic Bezier outlines to cubic Beziers
 *
 * In TrueType, there is an implicit on-curve point between consecutive off-curve points.
 * Quadratic Bezier (P0, P1, P2) -> cubic Bezier (P0, CP1, CP2, P2):
 *   CP1 = P0 + 2/3 * (P1 - P0)
 *   CP2 = P2 + 2/3 * (P1 - P2)
 */
function convertToOutline(
  endPts: Uint16Array | number[],
  flags: Uint8Array | number[],
  xCoords: number[] | Int16Array,
  yCoords: number[] | Int16Array,
  numPoints: number,
  numberOfContours: number,
): GlyphOutline {
  // Estimate the maximum number of commands (with headroom)
  const commands: number[] = []
  const coords: number[] = []

  let pointIdx = 0

  for (let c = 0; c < numberOfContours; c++) {
    const endPt = endPts[c]!
    const startPt = pointIdx
    const contourLength = endPt - startPt + 1

    if (contourLength < 1) {
      pointIdx = endPt + 1
      continue
    }

    // Build the point list for the contour (expanding implicit on-curve points)
    const points: { x: number; y: number; onCurve: boolean }[] = []
    for (let i = startPt; i <= endPt; i++) {
      points.push({
        x: xCoords[i]!,
        y: yCoords[i]!,
        onCurve: (flags[i]! & ON_CURVE_POINT) !== 0,
      })
    }

    if (points.length === 0) {
      pointIdx = endPt + 1
      continue
    }

    // Find the first on-curve point
    let firstOnCurveIdx = -1
    for (let i = 0; i < points.length; i++) {
      if (points[i]!.onCurve) {
        firstOnCurveIdx = i
        break
      }
    }

    let startX: number
    let startY: number

    if (firstOnCurveIdx >= 0) {
      // Start from an on-curve point
      startX = points[firstOnCurveIdx]!.x
      startY = points[firstOnCurveIdx]!.y
    } else {
      // If all points are off-curve, use the midpoint of the first and last as the start point
      const p0 = points[0]!
      const pLast = points[points.length - 1]!
      startX = (p0.x + pLast.x) / 2
      startY = (p0.y + pLast.y) / 2
      firstOnCurveIdx = -1
    }

    commands.push(PathCommand.MoveTo)
    coords.push(startX, startY)

    // Process points in order, starting after firstOnCurveIdx
    const len = points.length
    let i = 0

    while (i < len) {
      const idx = (firstOnCurveIdx + 1 + i) % len
      const pt = points[idx]!

      if (pt.onCurve) {
        // Straight line
        commands.push(PathCommand.LineTo)
        coords.push(pt.x, pt.y)
        i++
      } else {
        // Off-curve point (quadratic Bezier control point)
        const nextIdx = (firstOnCurveIdx + 1 + i + 1) % len
        const nextPt = points[nextIdx]!

        let endX: number
        let endY: number

        if (nextPt.onCurve) {
          endX = nextPt.x
          endY = nextPt.y
          i += 2
        } else {
          // Implicit on-curve point (midpoint of two off-curve points)
          endX = (pt.x + nextPt.x) / 2
          endY = (pt.y + nextPt.y) / 2
          i += 1
        }

        // Quadratic to cubic Bezier conversion
        // The start point is the previous command's end point
        const prevCoordIdx = coords.length - 2
        const p0x = coords[prevCoordIdx]!
        const p0y = coords[prevCoordIdx + 1]!

        const cp1x = p0x + (2 / 3) * (pt.x - p0x)
        const cp1y = p0y + (2 / 3) * (pt.y - p0y)
        const cp2x = endX + (2 / 3) * (pt.x - endX)
        const cp2y = endY + (2 / 3) * (pt.y - endY)

        commands.push(PathCommand.CubicTo)
        coords.push(cp1x, cp1y, cp2x, cp2y, endX, endY)
      }
    }

    commands.push(PathCommand.Close)
    pointIdx = endPt + 1
  }

  return {
    commands: new Uint8Array(commands),
    coords: new Float32Array(coords),
  }
}
