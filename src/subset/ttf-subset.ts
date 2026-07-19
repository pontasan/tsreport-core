/**
 * TTF font subsetter
 * Generates a minimal font containing only the specified glyph IDs
 *
 * Tables subject to subsetting:
 * - glyf: specified glyphs only (glyphs referenced by composite glyphs are added automatically)
 * - loca: offsets for the new glyf
 * - cmap: mappings to the specified glyphs only
 * - hmtx: metrics for the specified glyphs only
 * - maxp: numGlyphs updated
 * - head, hhea, name, OS/2: copied as is
 * - post: rewritten as version 3.0 with original header metrics
 */
import { BinaryReader } from '../binary/reader.js'
import { BinaryWriter } from '../binary/writer.js'
import type { CmapTable, PostTable, SfntData } from '../types/index.js'
import type { SubsetResult } from './index.js'
import { getTableReader } from '../parsers/sfnt-parser.js'
import { SfntTableManager } from '../parsers/ttf-parser.js'
import { composeGlyphPoints, parseSimpleGlyphPoints } from '../parsers/tables/glyf.js'
import type { RawSimpleGlyph } from '../parsers/tables/glyf.js'
import { buildGraphiteSubsetTables, collectGraphiteGlyphReferences } from './graphite-subset.js'
import { buildDirectAatSubsetTables, collectAatGlyphReferences } from './aat-subset.js'
import { POST_STANDARD_NAMES } from '../parsers/tables/post.js'
import { buildBitmapSubsetTables } from './bitmap-subset.js'
import { buildSvgSubsetTable, collectSvgPaletteIndices } from './svg-subset.js'
import { collectColrGlyphReferences, collectColrPaletteIndices, subsetColrTable } from './colr-subset.js'
import { buildCpalSubsetTable } from './cpal-subset.js'
import {
  buildStandardSubsetTables,
  bakeMvarMetrics,
  collectBaseGlyphReferences,
  collectJstfGlyphReferences,
  collectMathGlyphReferences,
} from './standard-subset.js'
import { buildCompactGsubTable } from '../parsers/tables/gsub.js'
import { buildCompactGposTable } from '../parsers/tables/gpos.js'
import { buildCompactGdefTable } from '../parsers/tables/gdef.js'

// Composite glyph flags
const ARG_1_AND_2_ARE_WORDS = 0x0001
const ARGS_ARE_XY_VALUES = 0x0002
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const WE_HAVE_A_TWO_BY_TWO = 0x0080

/**
 * Recursively collect glyph IDs referenced by composite glyphs
 */
export function collectCompositeReferences(
  glyfReader: BinaryReader,
  loca: { getOffset(id: number): number; getLength(id: number): number },
  glyphId: number,
  result: Set<number>,
): void {
  const offset = loca.getOffset(glyphId)
  const length = loca.getLength(glyphId)
  if (length === 0) return

  const reader = glyfReader.subReader(offset, length)
  const numberOfContours = reader.readInt16()

  if (numberOfContours >= 0) return // simple glyph

  reader.skip(8) // bounding box

  let flags: number
  do {
    flags = reader.readUint16()
    const componentGlyphId = reader.readUint16()

    if (!result.has(componentGlyphId)) {
      result.add(componentGlyphId)
      collectCompositeReferences(glyfReader, loca, componentGlyphId, result)
    }

    // Skip arguments
    if (flags & ARG_1_AND_2_ARE_WORDS) {
      reader.skip(4)
    } else {
      reader.skip(2)
    }

    if (flags & WE_HAVE_A_SCALE) {
      reader.skip(2)
    } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
      reader.skip(4)
    } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
      reader.skip(8)
    }
  } while (flags & MORE_COMPONENTS)
}

/**
 * Rewrite component glyph IDs of a composite glyph
 */
function remapCompositeGlyph(
  glyfData: Uint8Array,
  oldToNew: Map<number, number>,
): Uint8Array {
  const result = new Uint8Array(glyfData.length)
  result.set(glyfData)
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength)

  const numberOfContours = view.getInt16(0, false)
  if (numberOfContours >= 0) return result // simple glyph

  let offset = 10 // skip header (2 + 4*2)
  let flags: number

  do {
    flags = view.getUint16(offset, false)
    const oldGlyphId = view.getUint16(offset + 2, false)
    const newGlyphId = oldToNew.get(oldGlyphId)
    if (newGlyphId !== undefined) {
      view.setUint16(offset + 2, newGlyphId, false)
    }
    offset += 4

    if (flags & ARG_1_AND_2_ARE_WORDS) {
      offset += 4
    } else {
      offset += 2
    }

    if (flags & WE_HAVE_A_SCALE) {
      offset += 2
    } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
      offset += 4
    } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
      offset += 8
    }
  } while (flags & MORE_COMPONENTS)

  return result
}

/**
 * Count the number of components in a composite glyph
 */
function countCompositeComponents(glyfData: Uint8Array): number {
  const view = new DataView(glyfData.buffer, glyfData.byteOffset, glyfData.byteLength)
  const numberOfContours = view.getInt16(0, false)
  if (numberOfContours >= 0) return 0

  let offset = 10
  let count = 0
  let flags: number

  do {
    flags = view.getUint16(offset, false)
    count++
    offset += 4

    if (flags & ARG_1_AND_2_ARE_WORDS) {
      offset += 4
    } else {
      offset += 2
    }

    if (flags & WE_HAVE_A_SCALE) {
      offset += 2
    } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
      offset += 4
    } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
      offset += 8
    }
  } while (flags & MORE_COMPONENTS)

  return count
}

/**
 * Apply gvar deltas to a composite glyph (adjust component offsets)
 * gvar deltas correspond to each component's xy offset + 4 phantom points
 */
function applyGvarToComposite(
  glyfData: Uint8Array,
  deltaX: number[],
  deltaY: number[],
): Uint8Array {
  const view = new DataView(glyfData.buffer, glyfData.byteOffset, glyfData.byteLength)

  const numberOfContours = view.getInt16(0, false)
  if (numberOfContours >= 0) return glyfData

  const writer = new BinaryWriter(glyfData.length + 16)
  writer.writeBytes(glyfData.subarray(0, 10))
  let offset = 10
  let compIdx = 0
  let flags: number

  do {
    flags = view.getUint16(offset, false)
    const glyphId = view.getUint16(offset + 2, false)
    offset += 4
    const words = (flags & ARG_1_AND_2_ARE_WORDS) !== 0
    const xy = (flags & ARGS_ARE_XY_VALUES) !== 0
    let arg1: number
    let arg2: number
    if (words) {
      arg1 = xy ? view.getInt16(offset, false) : view.getUint16(offset, false)
      arg2 = xy ? view.getInt16(offset + 2, false) : view.getUint16(offset + 2, false)
      offset += 4
    } else {
      arg1 = xy ? view.getInt8(offset) : view.getUint8(offset)
      arg2 = xy ? view.getInt8(offset + 1) : view.getUint8(offset + 1)
      offset += 2
    }

    if (xy) {
      arg1 += Math.round(deltaX[compIdx] ?? 0)
      arg2 += Math.round(deltaY[compIdx] ?? 0)
    }
    const needsWords = words || (xy
      ? arg1 < -128 || arg1 > 127 || arg2 < -128 || arg2 > 127
      : arg1 > 255 || arg2 > 255)
    if (xy && (arg1 < -0x8000 || arg1 > 0x7FFF || arg2 < -0x8000 || arg2 > 0x7FFF)) {
      throw new Error(`Composite glyph variation arguments ${arg1}, ${arg2} exceed FWORD range`)
    }
    const outputFlags = needsWords ? flags | ARG_1_AND_2_ARE_WORDS : flags
    writer.writeUint16(outputFlags)
    writer.writeUint16(glyphId)
    if (needsWords) {
      writer.writeUint16(arg1 & 0xFFFF)
      writer.writeUint16(arg2 & 0xFFFF)
    } else {
      writer.writeUint8(arg1 & 0xFF)
      writer.writeUint8(arg2 & 0xFF)
    }

    let transformBytes = 0
    if (flags & WE_HAVE_A_SCALE) {
      transformBytes = 2
    } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
      transformBytes = 4
    } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
      transformBytes = 8
    }
    writer.writeBytes(glyfData.subarray(offset, offset + transformBytes))
    offset += transformBytes

    compIdx++
  } while (flags & MORE_COMPONENTS)

  writer.writeBytes(glyfData.subarray(offset))
  return writer.toUint8Array()
}

interface SubsetGlyphBounds {
  readonly hasContours: boolean
  readonly xMin: number
  readonly yMin: number
  readonly xMax: number
  readonly yMax: number
}

function writeCompositeBounds(glyphData: Uint8Array, xCoords: readonly number[], yCoords: readonly number[]): void {
  let xMin = 0
  let yMin = 0
  let xMax = 0
  let yMax = 0
  if (xCoords.length > 0) {
    xMin = Math.floor(xCoords[0]!)
    yMin = Math.floor(yCoords[0]!)
    xMax = Math.ceil(xCoords[0]!)
    yMax = Math.ceil(yCoords[0]!)
    for (let i = 1; i < xCoords.length; i++) {
      const x = xCoords[i]!
      const y = yCoords[i]!
      if (x < xMin) xMin = Math.floor(x)
      if (y < yMin) yMin = Math.floor(y)
      if (x > xMax) xMax = Math.ceil(x)
      if (y > yMax) yMax = Math.ceil(y)
    }
  }
  const view = new DataView(glyphData.buffer, glyphData.byteOffset, glyphData.byteLength)
  setInt16Exact(view, 2, xMin, 'composite glyph xMin')
  setInt16Exact(view, 4, yMin, 'composite glyph yMin')
  setInt16Exact(view, 6, xMax, 'composite glyph xMax')
  setInt16Exact(view, 8, yMax, 'composite glyph yMax')
}

function readSubsetGlyphBounds(glyphData: Uint8Array): SubsetGlyphBounds | null {
  if (glyphData.length < 10) return null
  const view = new DataView(glyphData.buffer, glyphData.byteOffset, glyphData.byteLength)
  return {
    hasContours: view.getInt16(0, false) !== 0,
    xMin: view.getInt16(2, false),
    yMin: view.getInt16(4, false),
    xMax: view.getInt16(6, false),
    yMax: view.getInt16(8, false),
  }
}

function updateSubsetFontBounds(view: DataView, bounds: readonly (SubsetGlyphBounds | null)[]): void {
  let xMin = 0
  let yMin = 0
  let xMax = 0
  let yMax = 0
  let initialized = false
  for (let i = 0; i < bounds.length; i++) {
    const glyph = bounds[i]
    if (glyph == null || !glyph.hasContours) continue
    if (!initialized) {
      xMin = glyph.xMin
      yMin = glyph.yMin
      xMax = glyph.xMax
      yMax = glyph.yMax
      initialized = true
    } else {
      if (glyph.xMin < xMin) xMin = glyph.xMin
      if (glyph.yMin < yMin) yMin = glyph.yMin
      if (glyph.xMax > xMax) xMax = glyph.xMax
      if (glyph.yMax > yMax) yMax = glyph.yMax
    }
  }
  setInt16Exact(view, 36, xMin, 'head.xMin')
  setInt16Exact(view, 38, yMin, 'head.yMin')
  setInt16Exact(view, 40, xMax, 'head.xMax')
  setInt16Exact(view, 42, yMax, 'head.yMax')
}

function updateHorizontalMetricExtrema(
  view: DataView,
  bounds: readonly (SubsetGlyphBounds | null)[],
  advances: readonly number[],
  bearings: readonly number[],
): void {
  let advanceMax = 0
  let minStartBearing = 0
  let minEndBearing = 0
  let maxExtent = 0
  let initialized = false
  for (let i = 0; i < advances.length; i++) {
    const advance = advances[i]!
    if (advance > advanceMax) advanceMax = advance
    const glyph = bounds[i]
    if (glyph == null || !glyph.hasContours) continue
    const startBearing = bearings[i]!
    const extent = glyph.xMax - glyph.xMin
    const endBearing = advance - startBearing - extent
    const glyphMaxExtent = startBearing + extent
    if (!initialized) {
      minStartBearing = startBearing
      minEndBearing = endBearing
      maxExtent = glyphMaxExtent
      initialized = true
    } else {
      if (startBearing < minStartBearing) minStartBearing = startBearing
      if (endBearing < minEndBearing) minEndBearing = endBearing
      if (glyphMaxExtent > maxExtent) maxExtent = glyphMaxExtent
    }
  }
  setUint16Exact(view, 10, advanceMax, 'hhea.advanceWidthMax')
  setInt16Exact(view, 12, minStartBearing, 'hhea.minLeftSideBearing')
  setInt16Exact(view, 14, minEndBearing, 'hhea.minRightSideBearing')
  setInt16Exact(view, 16, maxExtent, 'hhea.xMaxExtent')
}

function updateVerticalMetricExtrema(
  view: DataView,
  bounds: readonly (SubsetGlyphBounds | null)[],
  advances: readonly number[],
  bearings: readonly number[],
): void {
  let advanceMax = 0
  let minStartBearing = 0
  let minEndBearing = 0
  let maxExtent = 0
  let initialized = false
  for (let i = 0; i < advances.length; i++) {
    const advance = advances[i]!
    if (advance > advanceMax) advanceMax = advance
    const glyph = bounds[i]
    if (glyph == null || !glyph.hasContours) continue
    const startBearing = bearings[i]!
    const extent = glyph.yMax - glyph.yMin
    const endBearing = advance - startBearing - extent
    const glyphMaxExtent = startBearing + extent
    if (!initialized) {
      minStartBearing = startBearing
      minEndBearing = endBearing
      maxExtent = glyphMaxExtent
      initialized = true
    } else {
      if (startBearing < minStartBearing) minStartBearing = startBearing
      if (endBearing < minEndBearing) minEndBearing = endBearing
      if (glyphMaxExtent > maxExtent) maxExtent = glyphMaxExtent
    }
  }
  setUint16Exact(view, 10, advanceMax, 'vhea.advanceHeightMax')
  setInt16Exact(view, 12, minStartBearing, 'vhea.minTopSideBearing')
  setInt16Exact(view, 14, minEndBearing, 'vhea.minBottomSideBearing')
  setInt16Exact(view, 16, maxExtent, 'vhea.yMaxExtent')
}

function setInt16Exact(view: DataView, offset: number, value: number, field: string): void {
  if (!Number.isInteger(value) || value < -0x8000 || value > 0x7FFF) {
    throw new Error(`${field} ${value} is outside FWORD range`)
  }
  view.setInt16(offset, value, false)
}

function setUint16Exact(view: DataView, offset: number, value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
    throw new Error(`${field} ${value} is outside UFWORD range`)
  }
  view.setUint16(offset, value, false)
}

// Simple glyph encoding flags
const ON_CURVE = 0x01
const X_SHORT = 0x02
const Y_SHORT = 0x04
const REPEAT = 0x08
const X_SAME_OR_POS = 0x10
const Y_SAME_OR_POS = 0x20

/**
 * Encode gvar-applied raw TrueType points into glyf binary data while retaining
 * the glyph program that grid-fits the resulting static instance.
 */
function encodeSimpleGlyph(raw: RawSimpleGlyph): Uint8Array {
  const { numberOfContours, endPts, instructions, flags: ptFlags, xCoords, yCoords, numPoints } = raw

  // Bounding box calculation
  let xMin = 0x7FFF
  let yMin = 0x7FFF
  let xMax = -0x8000
  let yMax = -0x8000
  for (let i = 0; i < numPoints; i++) {
    const x = xCoords[i]!
    const y = yCoords[i]!
    if (x < xMin) xMin = x
    if (y < yMin) yMin = y
    if (x > xMax) xMax = x
    if (y > yMax) yMax = y
  }
  if (numPoints === 0) { xMin = yMin = xMax = yMax = 0 }

  // Delta coordinate calculation
  const xDeltas: number[] = []
  const yDeltas: number[] = []
  let prevX = 0
  let prevY = 0
  for (let i = 0; i < numPoints; i++) {
    const x = Math.round(xCoords[i]!)
    const y = Math.round(yCoords[i]!)
    xDeltas.push(x - prevX)
    yDeltas.push(y - prevY)
    prevX = x
    prevY = y
  }

  // Build flags
  const rawFlags: number[] = []
  for (let i = 0; i < numPoints; i++) {
    let f = ptFlags[i]! & ON_CURVE
    const dx = xDeltas[i]!
    const dy = yDeltas[i]!

    if (dx === 0) {
      f |= X_SAME_OR_POS
    } else if (dx >= -255 && dx <= 255) {
      f |= X_SHORT
      if (dx > 0) f |= X_SAME_OR_POS
    }

    if (dy === 0) {
      f |= Y_SAME_OR_POS
    } else if (dy >= -255 && dy <= 255) {
      f |= Y_SHORT
      if (dy > 0) f |= Y_SAME_OR_POS
    }

    rawFlags.push(f)
  }

  // Repeat optimization
  const compressedFlags: number[] = []
  let fi = 0
  while (fi < rawFlags.length) {
    const f = rawFlags[fi]!
    let repeatCount = 0
    while (fi + 1 + repeatCount < rawFlags.length &&
           rawFlags[fi + 1 + repeatCount] === f &&
           repeatCount < 255) {
      repeatCount++
    }
    if (repeatCount > 0) {
      compressedFlags.push(f | REPEAT)
      compressedFlags.push(repeatCount)
      fi += 1 + repeatCount
    } else {
      compressedFlags.push(f)
      fi++
    }
  }

  // Encode X coordinates
  const xBytes: number[] = []
  for (let i = 0; i < numPoints; i++) {
    const dx = xDeltas[i]!
    const f = rawFlags[i]!
    if (f & X_SHORT) {
      xBytes.push(Math.abs(dx))
    } else if (!(f & X_SAME_OR_POS)) {
      const v = dx & 0xFFFF
      xBytes.push((v >> 8) & 0xFF)
      xBytes.push(v & 0xFF)
    }
  }

  // Encode Y coordinates
  const yBytes: number[] = []
  for (let i = 0; i < numPoints; i++) {
    const dy = yDeltas[i]!
    const f = rawFlags[i]!
    if (f & Y_SHORT) {
      yBytes.push(Math.abs(dy))
    } else if (!(f & Y_SAME_OR_POS)) {
      const v = dy & 0xFFFF
      yBytes.push((v >> 8) & 0xFF)
      yBytes.push(v & 0xFF)
    }
  }

  // Build binary data
  const headerSize = 10
  const endPtsSize = numberOfContours * 2
  const instructionSize = 2 + instructions.length
  const totalSize = headerSize + endPtsSize + instructionSize + compressedFlags.length + xBytes.length + yBytes.length

  const data = new Uint8Array(totalSize)
  const view = new DataView(data.buffer)
  let offset = 0

  view.setInt16(offset, numberOfContours, false); offset += 2
  view.setInt16(offset, Math.round(xMin), false); offset += 2
  view.setInt16(offset, Math.round(yMin), false); offset += 2
  view.setInt16(offset, Math.round(xMax), false); offset += 2
  view.setInt16(offset, Math.round(yMax), false); offset += 2

  for (let c = 0; c < numberOfContours; c++) {
    view.setUint16(offset, endPts[c]!, false); offset += 2
  }

  view.setUint16(offset, instructions.length, false); offset += 2
  data.set(instructions, offset); offset += instructions.length

  for (const f of compressedFlags) data[offset++] = f
  for (const b of xBytes) data[offset++] = b
  for (const b of yBytes) data[offset++] = b

  return data.subarray(0, offset)
}

/**
 * Subset a TTF font
 *
 * @param sfnt Original SFNT data
 * @param glyphIds Glyph IDs to include in the subset (.notdef=0 is added automatically)
 * @param codePointToGlyphId Mapping from codepoint to glyphId (for cmap rebuilding)
 * @param variationData Variation-applied data (for Variable Fonts)
 * @returns Subset result (font binary + GID mapping)
 */
export function subsetTtf(
  sfnt: SfntData,
  glyphIds: Set<number>,
  codePointToGlyphId?: Map<number, number>,
  normalizedCoordsArg?: number[] | null,
): SubsetResult {
  const manager = new SfntTableManager(sfnt)
  if (normalizedCoordsArg !== undefined && normalizedCoordsArg !== null) {
    manager.setNormalizedCoords(normalizedCoordsArg)
  } else if (manager.fvar !== null) {
    manager.setNormalizedCoords(new Array<number>(manager.fvar.axes.length).fill(0))
  }

  // Always include .notdef
  const allGlyphIds = new Set<number>([0, ...glyphIds])
  // Collect glyphs referenced by composite glyphs
  const glyfReader = getTableReader(sfnt, 'glyf')

  let previousClosureSize = -1
  while (previousClosureSize !== allGlyphIds.size) {
    previousClosureSize = allGlyphIds.size
    collectGraphiteGlyphReferences(manager, allGlyphIds)
    collectAatGlyphReferences(manager, allGlyphIds)
    collectColrGlyphReferences(manager.colr, allGlyphIds)
    collectMathGlyphReferences(manager.math, allGlyphIds)
    collectBaseGlyphReferences(manager.base, allGlyphIds)
    collectJstfGlyphReferences(manager.jstf, allGlyphIds)
    if (glyfReader !== null) {
      for (const gid of [...allGlyphIds]) {
        collectCompositeReferences(glyfReader, manager.loca, gid, allGlyphIds)
      }
    }
  }

  // Sort glyph IDs and map them to new IDs
  const sortedGlyphIds = [...allGlyphIds].sort((a, b) => a - b)
  const oldToNew = new Map<number, number>()
  const newToOld = new Map<number, number>()
  for (let i = 0; i < sortedGlyphIds.length; i++) {
    oldToNew.set(sortedGlyphIds[i]!, i)
    newToOld.set(i, sortedGlyphIds[i]!)
  }

  const numNewGlyphs = sortedGlyphIds.length

  // --- Rebuild glyf table ---
  const glyfChunks: Uint8Array[] = []
  const glyphBounds = new Array<SubsetGlyphBounds | null>(numNewGlyphs).fill(null)
  const newOffsets: number[] = [0]
  let glyfTotalSize = 0
  // Prepare to obtain gvar-applied data
  const normalizedCoords = manager.normalizedCoords
  const gvar = normalizedCoords ? manager.gvar : null

  if (glyfReader !== null) for (let newId = 0; newId < numNewGlyphs; newId++) {
    const oldId = newToOld.get(newId)!
    const offset = manager.loca.getOffset(oldId)
    const length = manager.loca.getLength(oldId)

    if (length === 0) {
      newOffsets.push(glyfTotalSize)
      glyfChunks.push(new Uint8Array(0))
      continue
    }

    let glyphData: Uint8Array

    // Variable Font: generate glyph data with gvar deltas applied
    if (gvar && normalizedCoords) {
      const raw = parseSimpleGlyphPoints(glyfReader, manager.loca, oldId)
      if (raw) {
        const numPoints = raw.numPoints + 4
        const deltas = gvar.getGlyphDeltas(
          oldId, normalizedCoords, numPoints,
          raw.endPts, raw.xCoords, raw.yCoords,
        )
        if (deltas) {
          for (let i = 0; i < raw.numPoints; i++) {
            raw.xCoords[i] = raw.xCoords[i]! + Math.round(deltas.deltaX[i]!)
            raw.yCoords[i] = raw.yCoords[i]! + Math.round(deltas.deltaY[i]!)
          }
        }
        glyphData = encodeSimpleGlyph(raw)
      } else {
        // composite glyph: raw byte copy + remap + gvar delta application
        const srcData = new Uint8Array(sfnt.buffer, glyfReader.absoluteOffset + offset, length)
        glyphData = remapCompositeGlyph(srcData as Uint8Array<ArrayBuffer>, oldToNew)
        // Apply gvar deltas to component offsets
        const numComponents = countCompositeComponents(glyphData)
        const numCompositePoints = numComponents + 4 // components + phantom points
        const compDeltas = gvar.getGlyphDeltas(oldId, normalizedCoords, numCompositePoints)
        if (compDeltas) {
          glyphData = applyGvarToComposite(glyphData, compDeltas.deltaX, compDeltas.deltaY)
        }
        const composed = composeGlyphPoints(
          glyfReader,
          manager.loca,
          oldId,
          gvar,
          normalizedCoords,
          manager.glyphPhantomPointProvider,
        )
        writeCompositeBounds(glyphData, composed.xCoords, composed.yCoords)
      }
    } else {
      const srcData = new Uint8Array(sfnt.buffer, glyfReader.absoluteOffset + offset, length)
      glyphData = remapCompositeGlyph(srcData as Uint8Array<ArrayBuffer>, oldToNew)
    }

    // 4-byte alignment
    const dataLen = glyphData.length
    const padded = (dataLen + 3) & ~3
    const paddedData = new Uint8Array(padded)
    paddedData.set(glyphData)

    glyfChunks.push(paddedData)
    glyphBounds[newId] = readSubsetGlyphBounds(glyphData)
    glyfTotalSize += padded
    newOffsets.push(glyfTotalSize)
  }

  // --- Rebuild loca table ---
  // Use long format (indexToLocFormat=1)
  const locaWriter = new BinaryWriter((numNewGlyphs + 1) * 4)
  if (glyfReader !== null) for (const off of newOffsets) locaWriter.writeUint32(off)

  // --- Rebuild hmtx table ---
  const hmtxWriter = new BinaryWriter(numNewGlyphs * 4)
  const subsetAdvanceWidths = new Array<number>(numNewGlyphs)
  const subsetLeftSideBearings = new Array<number>(numNewGlyphs)
  const hvar = normalizedCoords ? manager.hvar : null
  for (let newId = 0; newId < numNewGlyphs; newId++) {
    const oldId = newToOld.get(newId)!
    let aw = manager.hmtx.getAdvanceWidth(oldId)
    if (hvar && normalizedCoords) {
      aw += Math.round(hvar.getAdvanceWidthDelta(oldId, normalizedCoords))
    } else if (gvar && normalizedCoords) {
      aw = manager.getGlyphOutline(oldId).advanceWidth
    }
    const outputAdvanceWidth = Math.max(0, Math.min(0xFFFF, Math.round(aw)))
    hmtxWriter.writeUint16(outputAdvanceWidth)
    const lsb = gvar && normalizedCoords
      ? manager.getGlyphOutline(oldId).lsb
      : manager.hmtx.getLsb(oldId)
    hmtxWriter.writeInt16(lsb)
    subsetAdvanceWidths[newId] = outputAdvanceWidth
    subsetLeftSideBearings[newId] = lsb
  }

  // --- Rebuild vertical metrics when present ---
  const sourceVhea = manager.vhea
  const sourceVmtx = manager.vmtx
  let vheaData: Uint8Array | null = null
  let vmtxData: Uint8Array | null = null
  let subsetAdvanceHeights: number[] | null = null
  let subsetTopSideBearings: number[] | null = null
  if (sourceVhea !== null && sourceVmtx !== null) {
    const vmtxWriter = new BinaryWriter(numNewGlyphs * 4)
    const vvar = normalizedCoords ? manager.vvar : null
    subsetAdvanceHeights = new Array<number>(numNewGlyphs)
    subsetTopSideBearings = new Array<number>(numNewGlyphs)
    for (let newId = 0; newId < numNewGlyphs; newId++) {
      const oldId = newToOld.get(newId)!
      let advanceHeight = sourceVmtx.getAdvanceHeight(oldId)
      let topSideBearing = sourceVmtx.getTopSideBearing(oldId)
      if (vvar !== null && normalizedCoords !== null) {
        advanceHeight += Math.round(vvar.getAdvanceHeightDelta(oldId, normalizedCoords))
        topSideBearing += Math.round(vvar.getTsbDelta(oldId, normalizedCoords))
      }
      const outputAdvanceHeight = Math.max(0, Math.min(0xFFFF, advanceHeight))
      vmtxWriter.writeUint16(outputAdvanceHeight)
      vmtxWriter.writeInt16(topSideBearing)
      subsetAdvanceHeights[newId] = outputAdvanceHeight
      subsetTopSideBearings[newId] = topSideBearing
    }
    vmtxData = vmtxWriter.toUint8Array()
    const vheaReader = getTableReader(sfnt, 'vhea')!
    vheaData = new Uint8Array(vheaReader.length)
    for (let i = 0; i < vheaReader.length; i++) vheaData[i] = vheaReader.getUint8At(i)
    new DataView(vheaData.buffer, vheaData.byteOffset, vheaData.byteLength).setUint16(34, numNewGlyphs, false)
  }

  // --- Rebuild cmap table (Format 4) ---
  const cmapEntries: { codePoint: number; newGlyphId: number }[] = []
  if (codePointToGlyphId) {
    for (const [cp, oldGid] of codePointToGlyphId) {
      const newGid = oldToNew.get(oldGid)
      if (newGid !== undefined) {
        cmapEntries.push({ codePoint: cp, newGlyphId: newGid })
      }
    }
  } else {
    // Rebuild the mapping from the original cmap
    for (const [cp, oldGid] of manager.cmap.entries()) {
      const newGid = oldToNew.get(oldGid)
      if (newGid !== undefined) {
        cmapEntries.push({ codePoint: cp, newGlyphId: newGid })
      }
    }
  }
  cmapEntries.sort((a, b) => a.codePoint - b.codePoint)

  const cmapData = buildCmapTable(
    cmapEntries,
    collectSubsetCmapVariationSequences(manager.cmap, cmapEntries, oldToNew),
  )

  // --- Update maxp table ---
  const maxpReader = getTableReader(sfnt, 'maxp')!
  const maxpData = new Uint8Array(maxpReader.length)
  const maxpSub = maxpReader.subReader(0, maxpReader.length)
  for (let i = 0; i < maxpReader.length; i++) {
    maxpData[i] = maxpSub.readUint8()
  }
  // Overwrite numGlyphs (offset 4, Uint16)
  const maxpView = new DataView(maxpData.buffer, maxpData.byteOffset, maxpData.byteLength)
  maxpView.setUint16(4, numNewGlyphs, false)

  // --- Update head table ---
  const headReader = getTableReader(sfnt, 'head')!
  const headData = new Uint8Array(headReader.length)
  const headSub = headReader.subReader(0, headReader.length)
  for (let i = 0; i < headReader.length; i++) {
    headData[i] = headSub.readUint8()
  }
  // Set indexToLocFormat = 1 (long)
  const headView = new DataView(headData.buffer, headData.byteOffset, headData.byteLength)
  if (glyfReader !== null) headView.setInt16(50, 1, false)
  updateSubsetFontBounds(headView, glyphBounds)
  // Reset checksumAdjustment to 0
  headView.setUint32(8, 0, false)

  // --- Update hhea table ---
  const hheaReader = getTableReader(sfnt, 'hhea')!
  const hheaData = new Uint8Array(hheaReader.length)
  const hheaSub = hheaReader.subReader(0, hheaReader.length)
  for (let i = 0; i < hheaReader.length; i++) {
    hheaData[i] = hheaSub.readUint8()
  }
  // Update numberOfHMetrics
  const hheaView = new DataView(hheaData.buffer, hheaData.byteOffset, hheaData.byteLength)
  hheaView.setUint16(34, numNewGlyphs, false)
  updateHorizontalMetricExtrema(hheaView, glyphBounds, subsetAdvanceWidths, subsetLeftSideBearings)
  bakeMvarMetrics('hhea', hheaData, manager)

  // --- Rebuild post table ---
  const postReader = getTableReader(sfnt, 'post')
  const postData = postReader ? buildPostSubsetTable(postReader, manager.post, newToOld) : null
  if (postData !== null) bakeMvarMetrics('post', postData, manager)

  // --- Copy remaining tables ---
  const copyTables = ['name', 'OS/2', 'fpgm', 'prep']
  const tablesToInclude: { tag: string; data: Uint8Array }[] = [
    { tag: 'head', data: headData },
    { tag: 'hhea', data: hheaData },
    { tag: 'maxp', data: maxpData },
    { tag: 'hmtx', data: new Uint8Array(hmtxWriter.toArrayBuffer()) },
    { tag: 'cmap', data: cmapData },
  ]
  if (glyfReader !== null) tablesToInclude.push({ tag: 'loca', data: new Uint8Array(locaWriter.toArrayBuffer()) })
  if (postData) tablesToInclude.push({ tag: 'post', data: postData })
  const cvt = manager.cvt
  if (cvt !== null) {
    const cvtWriter = new BinaryWriter(cvt.length * 2)
    const cvarDeltas = normalizedCoords !== null && manager.cvar !== null
      ? manager.cvar.getCvtDeltas(normalizedCoords, cvt.length)
      : null
    for (let index = 0; index < cvt.length; index++) {
      cvtWriter.writeInt16(Math.round(cvt.get(index) + (cvarDeltas?.[index] ?? 0)))
    }
    tablesToInclude.push({ tag: 'cvt ', data: cvtWriter.toUint8Array() })
  }
  if (vheaData !== null && vmtxData !== null) {
    updateVerticalMetricExtrema(
      new DataView(vheaData.buffer, vheaData.byteOffset, vheaData.byteLength),
      glyphBounds,
      subsetAdvanceHeights!,
      subsetTopSideBearings!,
    )
    bakeMvarMetrics('vhea', vheaData, manager)
    tablesToInclude.push({ tag: 'vhea', data: vheaData })
    tablesToInclude.push({ tag: 'vmtx', data: vmtxData })
  }

  // Concatenate glyf data
  if (glyfReader !== null) {
    let totalGlyfSize = 0
    for (const chunk of glyfChunks) totalGlyfSize += chunk.length
    const glyfData = new Uint8Array(totalGlyfSize)
    let pos = 0
    for (const chunk of glyfChunks) {
      glyfData.set(chunk, pos)
      pos += chunk.length
    }
    tablesToInclude.push({ tag: 'glyf', data: glyfData })
  }

  for (const tag of copyTables) {
    const reader = getTableReader(sfnt, tag)
    if (reader) {
      const data = new Uint8Array(reader.length)
      const sub = reader.subReader(0, reader.length)
      for (let i = 0; i < reader.length; i++) {
        data[i] = sub.readUint8()
      }
      bakeMvarMetrics(tag, data, manager)
      tablesToInclude.push({ tag, data })
    }
  }

  const graphite = buildGraphiteSubsetTables(manager, oldToNew)
  if (graphite !== null) {
    tablesToInclude.push({ tag: 'Glat', data: graphite.Glat })
    tablesToInclude.push({ tag: 'Gloc', data: graphite.Gloc })
    tablesToInclude.push({ tag: 'Silf', data: graphite.Silf })
    for (const tag of ['Feat', 'Sill']) {
      const reader = getTableReader(sfnt, tag)
      if (reader !== null) {
        const data = new Uint8Array(reader.length)
        for (let i = 0; i < reader.length; i++) data[i] = reader.getUint8At(i)
        tablesToInclude.push({ tag, data })
      }
    }
  }

  const aatTables = buildDirectAatSubsetTables(manager, oldToNew)
  for (const [tag, data] of aatTables) tablesToInclude.push({ tag, data })
  const standardTables = buildStandardSubsetTables(sfnt, manager, oldToNew)
  for (const [tag, data] of standardTables) tablesToInclude.push({ tag, data })
  const gsubReader = getTableReader(sfnt, 'GSUB')
  if (gsubReader !== null) tablesToInclude.push({
    tag: 'GSUB',
    data: buildCompactGsubTable(
      gsubReader,
      oldToNew,
      normalizedCoords ?? undefined,
      manager.fvar?.axes.length,
    ),
  })
  const gposReader = getTableReader(sfnt, 'GPOS')
  if (gposReader !== null) tablesToInclude.push({
    tag: 'GPOS',
    data: buildCompactGposTable(
      gposReader,
      oldToNew,
      normalizedCoords !== null
        ? { coords: normalizedCoords, gdef: manager.gdef }
        : undefined,
      manager.fvar?.axes.length,
    ),
  })
  const gdefReader = getTableReader(sfnt, 'GDEF')
  if (gdefReader !== null) {
    tablesToInclude.push({
      tag: 'GDEF',
      data: buildCompactGdefTable(
        gdefReader,
        oldToNew,
        manager.fvar?.axes.length,
        normalizedCoords ?? undefined,
      ),
    })
  }
  const bitmapTables = buildBitmapSubsetTables(sfnt, oldToNew, numNewGlyphs)
  for (const [tag, data] of bitmapTables) if (data !== null) tablesToInclude.push({ tag, data })
  let svgTable = buildSvgSubsetTable(sfnt, oldToNew)
  const usedPaletteEntries = new Set<number>()
  collectColrPaletteIndices(manager.colr, allGlyphIds, usedPaletteEntries)
  collectSvgPaletteIndices(svgTable, usedPaletteEntries)
  const cpalSubset = buildCpalSubsetTable(manager.cpal, usedPaletteEntries)
  if (manager.cpal !== null && svgTable !== null) {
    svgTable = buildSvgSubsetTable(sfnt, oldToNew, cpalSubset.oldToNewPaletteEntry)
  }
  if (svgTable !== null) tablesToInclude.push({ tag: 'SVG ', data: svgTable })
  const colrReader = getTableReader(sfnt, 'COLR')
  if (colrReader !== null && manager.colr !== null) {
    tablesToInclude.push({ tag: 'COLR', data: subsetColrTable(
      colrReader, manager.colr, allGlyphIds, oldToNew,
      manager.cpal === null ? undefined : cpalSubset.oldToNewPaletteEntry,
      normalizedCoords ?? undefined,
    ) })
  }
  if (cpalSubset.table !== null) tablesToInclude.push({ tag: 'CPAL', data: cpalSubset.table })
  for (const tag of ['feat', 'fdsc', 'ltag', 'trak']) {
    const reader = getTableReader(sfnt, tag)
    if (reader !== null) {
      const data = new Uint8Array(reader.length)
      for (let i = 0; i < reader.length; i++) data[i] = reader.getUint8At(i)
      tablesToInclude.push({ tag, data })
    }
  }

  // Sort by tag (SFNT spec)
  tablesToInclude.sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)

  return {
    buffer: buildSfntFromTables(0x00010000, tablesToInclude),
    oldToNewGlyphId: oldToNew,
  }
}

export function buildPostSubsetTable(
  source: BinaryReader,
  post: PostTable,
  newToOld: ReadonlyMap<number, number>,
): Uint8Array {
  const glyphCount = newToOld.size
  const isFormat4 = post.glyphNameCharacterCodes !== undefined
  const hasNames = post.glyphNames !== undefined
  const writer = new BinaryWriter(32 + glyphCount * 4)
  writer.writeUint32(isFormat4 ? 0x00040000 : hasNames ? 0x00020000 : 0x00030000)
  for (let i = 4; i < 32; i++) {
    writer.writeUint8(source.getUint8At(i))
  }
  if (isFormat4) {
    for (let newGlyphId = 0; newGlyphId < glyphCount; newGlyphId++) {
      const oldGlyphId = newToOld.get(newGlyphId)!
      writer.writeUint16(post.glyphNameCharacterCodes![oldGlyphId]!)
    }
    return writer.toUint8Array()
  }
  if (!hasNames) return writer.toUint8Array()

  const standardIndices = new Map<string, number>()
  for (let i = 0; i < POST_STANDARD_NAMES.length; i++) standardIndices.set(POST_STANDARD_NAMES[i]!, i)
  const customIndices = new Map<string, number>()
  const customNames: string[] = []
  const nameIndices = new Uint16Array(glyphCount)
  for (let newGlyphId = 0; newGlyphId < glyphCount; newGlyphId++) {
    const oldGlyphId = newToOld.get(newGlyphId)!
    const name = post.glyphNames![oldGlyphId] ?? '.notdef'
    const standardIndex = standardIndices.get(name)
    if (standardIndex !== undefined) {
      nameIndices[newGlyphId] = standardIndex
      continue
    }
    let customIndex = customIndices.get(name)
    if (customIndex === undefined) {
      customIndex = customNames.length
      customIndices.set(name, customIndex)
      customNames.push(name)
    }
    nameIndices[newGlyphId] = 258 + customIndex
  }
  writer.writeUint16(glyphCount)
  for (let i = 0; i < nameIndices.length; i++) writer.writeUint16(nameIndices[i]!)
  for (let i = 0; i < customNames.length; i++) {
    const name = customNames[i]!
    writer.writeUint8(name.length)
    for (let j = 0; j < name.length; j++) writer.writeUint8(name.charCodeAt(j))
  }
  return writer.toUint8Array()
}

export interface SubsetCmapVariationSequence {
  readonly codePoint: number
  readonly variationSelector: number
  readonly newGlyphId: number
  readonly isDefault: boolean
}

export function collectSubsetCmapVariationSequences(
  cmap: CmapTable,
  entries: readonly { codePoint: number; newGlyphId: number }[],
  oldToNewGlyphId: ReadonlyMap<number, number>,
): SubsetCmapVariationSequence[] {
  const retainedCodePoints = new Set<number>()
  for (let i = 0; i < entries.length; i++) retainedCodePoints.add(entries[i]!.codePoint)
  const result: SubsetCmapVariationSequence[] = []
  for (const sequence of cmap.variationSequences()) {
    if (!retainedCodePoints.has(sequence.codePoint)) continue
    const newGlyphId = oldToNewGlyphId.get(sequence.glyphId)
    if (newGlyphId === undefined) continue
    result.push({
      codePoint: sequence.codePoint,
      variationSelector: sequence.variationSelector,
      newGlyphId,
      isDefault: sequence.isDefault,
    })
  }
  return result
}

export function buildCmapTable(
  entries: { codePoint: number; newGlyphId: number }[],
  variationSequences: readonly SubsetCmapVariationSequence[] = [],
): Uint8Array {
  const bmpEntries = entries.filter(e => e.codePoint <= 0xFFFF)
  const hasNonBmp = entries.some(e => e.codePoint > 0xFFFF)
  const format14 = buildCmapFormat14(variationSequences)
  const numSubtables = (hasNonBmp ? 2 : 1) + (format14 === null ? 0 : 1)

  interface Segment { start: number; end: number; delta: number }
  const segments: Segment[] = []

  if (bmpEntries.length > 0) {
    let segStart = bmpEntries[0]!.codePoint
    let segDelta = bmpEntries[0]!.newGlyphId - bmpEntries[0]!.codePoint

    for (let i = 1; i < bmpEntries.length; i++) {
      const entry = bmpEntries[i]!
      const prevEntry = bmpEntries[i - 1]!
      const delta = entry.newGlyphId - entry.codePoint

      if (entry.codePoint === prevEntry.codePoint + 1 && delta === segDelta) continue

      segments.push({ start: segStart, end: prevEntry.codePoint, delta: segDelta })
      segStart = entry.codePoint
      segDelta = delta
    }
    segments.push({ start: segStart, end: bmpEntries[bmpEntries.length - 1]!.codePoint, delta: segDelta })
  }
  segments.push({ start: 0xFFFF, end: 0xFFFF, delta: 1 })

  const segCount = segments.length
  const fmt4Length = 16 + segCount * 8 // 14 header + 2 reservedPad + segCount * 8 + 2 // +2 for reservedPad

  // Format 12 groups (all entries, only when non-BMP is present)
  interface Group12 { startCharCode: number; endCharCode: number; startGlyphId: number }
  const groups12: Group12[] = []
  if (hasNonBmp && entries.length > 0) {
    let gStart = entries[0]!.codePoint
    let gGlyphStart = entries[0]!.newGlyphId
    let gEnd = gStart

    for (let i = 1; i < entries.length; i++) {
      const e = entries[i]!
      if (e.codePoint === gEnd + 1 && e.newGlyphId === gGlyphStart + (e.codePoint - gStart)) {
        gEnd = e.codePoint
      } else {
        groups12.push({ startCharCode: gStart, endCharCode: gEnd, startGlyphId: gGlyphStart })
        gStart = e.codePoint
        gGlyphStart = e.newGlyphId
        gEnd = gStart
      }
    }
    groups12.push({ startCharCode: gStart, endCharCode: gEnd, startGlyphId: gGlyphStart })
  }

  const fmt12Length = 16 + groups12.length * 12
  const headerSize = 4 + numSubtables * 8
  const fmt14Offset = format14 === null ? 0 : headerSize
  const fmt4Offset = headerSize + (format14?.length ?? 0)
  const fmt12Offset = hasNonBmp ? fmt4Offset + fmt4Length : 0
  const totalLength = headerSize + (format14?.length ?? 0) + fmt4Length + (hasNonBmp ? fmt12Length : 0)

  const writer = new BinaryWriter(totalLength)

  // cmap header
  writer.writeUint16(0) // version
  writer.writeUint16(numSubtables)

  if (format14 !== null) {
    writer.writeUint16(0)
    writer.writeUint16(5)
    writer.writeUint32(fmt14Offset)
  }

  // encoding record: platform 3, encoding 1 (BMP)
  writer.writeUint16(3)
  writer.writeUint16(1)
  writer.writeUint32(fmt4Offset)

  if (hasNonBmp) {
    // encoding record: platform 3, encoding 10 (Full Unicode)
    writer.writeUint16(3)
    writer.writeUint16(10)
    writer.writeUint32(fmt12Offset)
  }

  if (format14 !== null) writer.writeBytes(format14)

  // Format 4 subtable
  writer.writeUint16(4)
  writer.writeUint16(fmt4Length)
  writer.writeUint16(0) // language
  writer.writeUint16(segCount * 2)

  let sRange = 1
  let eSel = 0
  while (sRange * 2 <= segCount) { sRange *= 2; eSel++ }
  sRange *= 2

  writer.writeUint16(sRange)
  writer.writeUint16(eSel)
  writer.writeUint16(segCount * 2 - sRange)

  for (const seg of segments) writer.writeUint16(seg.end)
  writer.writeUint16(0)
  for (const seg of segments) writer.writeUint16(seg.start)
  for (const seg of segments) writer.writeInt16(seg.delta & 0xFFFF)
  for (let i = 0; i < segCount; i++) writer.writeUint16(0)

  // Format 12 subtable
  if (hasNonBmp) {
    writer.writeUint16(12)
    writer.writeUint16(0) // reserved
    writer.writeUint32(fmt12Length)
    writer.writeUint32(0) // language
    writer.writeUint32(groups12.length)
    for (const g of groups12) {
      writer.writeUint32(g.startCharCode)
      writer.writeUint32(g.endCharCode)
      writer.writeUint32(g.startGlyphId)
    }
  }

  return new Uint8Array(writer.toArrayBuffer())
}

function buildCmapFormat14(sequences: readonly SubsetCmapVariationSequence[]): Uint8Array | null {
  if (sequences.length === 0) return null
  const sorted = [...sequences].sort(function (left, right) {
    return left.variationSelector - right.variationSelector || left.codePoint - right.codePoint
  })
  const selectors: Array<{
    variationSelector: number
    defaults: number[]
    nonDefaults: Array<{ codePoint: number, glyphId: number }>
  }> = []
  for (let i = 0; i < sorted.length; i++) {
    const sequence = sorted[i]!
    let selector = selectors[selectors.length - 1]
    if (selector === undefined || selector.variationSelector !== sequence.variationSelector) {
      selector = { variationSelector: sequence.variationSelector, defaults: [], nonDefaults: [] }
      selectors.push(selector)
    }
    if (sequence.isDefault) selector.defaults.push(sequence.codePoint)
    else selector.nonDefaults.push({ codePoint: sequence.codePoint, glyphId: sequence.newGlyphId })
  }

  const payloads: Array<{ defaultData: Uint8Array | null, nonDefaultData: Uint8Array | null }> = []
  let length = 10 + selectors.length * 11
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i]!
    const defaultData = buildDefaultUvsTable(selector.defaults)
    const nonDefaultData = buildNonDefaultUvsTable(selector.nonDefaults)
    payloads.push({ defaultData, nonDefaultData })
    length += (defaultData?.length ?? 0) + (nonDefaultData?.length ?? 0)
  }

  const writer = new BinaryWriter(length)
  writer.writeUint16(14)
  writer.writeUint32(length)
  writer.writeUint32(selectors.length)
  let payloadOffset = 10 + selectors.length * 11
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i]!
    const payload = payloads[i]!
    writeUint24(writer, selector.variationSelector)
    writer.writeUint32(payload.defaultData === null ? 0 : payloadOffset)
    payloadOffset += payload.defaultData?.length ?? 0
    writer.writeUint32(payload.nonDefaultData === null ? 0 : payloadOffset)
    payloadOffset += payload.nonDefaultData?.length ?? 0
  }
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i]!
    if (payload.defaultData !== null) writer.writeBytes(payload.defaultData)
    if (payload.nonDefaultData !== null) writer.writeBytes(payload.nonDefaultData)
  }
  return writer.toUint8Array()
}

function buildDefaultUvsTable(codePoints: readonly number[]): Uint8Array | null {
  if (codePoints.length === 0) return null
  const ranges: Array<{ start: number, additionalCount: number }> = []
  let start = codePoints[0]!
  let end = start
  for (let i = 1; i < codePoints.length; i++) {
    const codePoint = codePoints[i]!
    if (codePoint === end + 1 && codePoint - start <= 255) {
      end = codePoint
    } else {
      ranges.push({ start, additionalCount: end - start })
      start = codePoint
      end = codePoint
    }
  }
  ranges.push({ start, additionalCount: end - start })
  const writer = new BinaryWriter(4 + ranges.length * 4)
  writer.writeUint32(ranges.length)
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!
    writeUint24(writer, range.start)
    writer.writeUint8(range.additionalCount)
  }
  return writer.toUint8Array()
}

function buildNonDefaultUvsTable(mappings: readonly { codePoint: number, glyphId: number }[]): Uint8Array | null {
  if (mappings.length === 0) return null
  const writer = new BinaryWriter(4 + mappings.length * 5)
  writer.writeUint32(mappings.length)
  for (let i = 0; i < mappings.length; i++) {
    const mapping = mappings[i]!
    writeUint24(writer, mapping.codePoint)
    writer.writeUint16(mapping.glyphId)
  }
  return writer.toUint8Array()
}

function writeUint24(writer: BinaryWriter, value: number): void {
  writer.writeUint8((value >>> 16) & 0xFF)
  writer.writeUint8((value >>> 8) & 0xFF)
  writer.writeUint8(value & 0xFF)
}

export function buildSfntFromTables(flavor: number, tables: { tag: string; data: Uint8Array }[]): ArrayBuffer {
  const numTables = tables.length
  let searchRange = 1
  let entrySelector = 0
  while (searchRange * 2 <= numTables) {
    searchRange *= 2
    entrySelector++
  }
  searchRange *= 16
  const rangeShift = numTables * 16 - searchRange

  const headerSize = 12 + numTables * 16
  let totalSize = headerSize
  for (const t of tables) {
    totalSize += t.data.length
    totalSize += (4 - (totalSize % 4)) % 4
  }

  const writer = new BinaryWriter(totalSize)

  // SFNT header
  writer.writeUint32(flavor)
  writer.writeUint16(numTables)
  writer.writeUint16(searchRange)
  writer.writeUint16(entrySelector)
  writer.writeUint16(rangeShift)

  // Table directory
  let dataOffset = headerSize
  let headOffset = -1
  for (const t of tables) {
    writer.writeTag(t.tag)
    writer.writeUint32(calcTableChecksum(t.data))
    writer.writeUint32(dataOffset)
    writer.writeUint32(t.data.length)
    if (t.tag === 'head') headOffset = dataOffset
    dataOffset += t.data.length
    dataOffset += (4 - (dataOffset % 4)) % 4
  }

  // Table data
  for (const t of tables) {
    writer.writeBytes(t.data)
    writer.pad4()
  }

  const buffer = writer.toArrayBuffer()

  // head.checkSumAdjustment: 0xB1B0AFBA minus the checksum of the entire font,
  // computed while the field itself is 0 (OpenType 'head' table spec)
  if (headOffset >= 0) {
    const fontSum = calcTableChecksum(new Uint8Array(buffer))
    const adjustment = (0xB1B0AFBA - fontSum) >>> 0
    new DataView(buffer).setUint32(headOffset + 8, adjustment, false)
  }

  return buffer
}

function calcTableChecksum(data: Uint8Array): number {
  let sum = 0
  const len = data.length
  const fullWords = len & ~3

  for (let i = 0; i < fullWords; i += 4) {
    sum = (sum + ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!)) >>> 0
  }

  if (len > fullWords) {
    let last = 0
    for (let i = fullWords; i < len; i++) {
      last |= data[i]! << (24 - (i - fullWords) * 8)
    }
    sum = (sum + last) >>> 0
  }

  return sum
}
