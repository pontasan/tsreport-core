/**
 * CFF hinting
 *
 * Applies CFF (Type 1 / Type 2) stem hints and alignment zones to
 * optimize glyph outlines for a specific ppem (pixels per em).
 *
 * Implementation scope:
 * - Blue zone snapping: snap y coordinates to BlueValues/OtherBlues alignment zones
 * - Stem alignment: round hstem/vstem widths to integer pixel widths
 * - hintmask/cntrmask: selection of active hints
 */

import type { GlyphOutline } from '../types/index.js'
import { PathCommand } from '../types/glyph.js'

// --- CFF Private DICT hint parameters ---

/** CFF hinting parameters extracted from the Private DICT */
export interface CffHintParams {
  /** Array of blue zone pairs (bottom, top) — positive alignment zones */
  blueValues: number[]
  /** Array of other blues pairs (bottom, top) — negative alignment zones */
  otherBlues: number[]
  /** Family blues (family version of blueValues) */
  familyBlues: number[]
  /** Family other blues (family version of otherBlues) */
  familyOtherBlues: number[]
  /** Scale factor for blue zone snapping (default: 0.039625) */
  blueScale: number
  /** Blue zone shift value (default: 7) */
  blueShift: number
  /** Blue zone fuzz value (default: 1) */
  blueFuzz: number
  /** Standard horizontal stem width */
  stdHW: number
  /** Standard vertical stem width */
  stdVW: number
  /** List of horizontal stem snap values */
  stemSnapH: number[]
  /** List of vertical stem snap values */
  stemSnapV: number[]
  /** Force bold flag */
  forceBold: boolean
  /** Language group (0 or 1) */
  languageGroup: number
}

// Private DICT operator keys
const OP_BLUE_VALUES = 6
const OP_OTHER_BLUES = 7
const OP_FAMILY_BLUES = 8
const OP_FAMILY_OTHER_BLUES = 9
const OP_BLUE_SCALE = 1209    // 12 09
const OP_BLUE_SHIFT = 1210    // 12 10
const OP_BLUE_FUZZ = 1211     // 12 11
const OP_STD_HW = 10
const OP_STD_VW = 11
const OP_STEM_SNAP_H = 1212   // 12 12
const OP_STEM_SNAP_V = 1213   // 12 13
const OP_FORCE_BOLD = 1214    // 12 14
const OP_LANGUAGE_GROUP = 1217 // 12 17

/**
 * Extract hinting parameters from Private DICT entries
 */
export function extractCffHintParams(privateDictEntries: Map<number, number[]>): CffHintParams {
  // BlueValues/OtherBlues are delta-encoded arrays
  // e.g. [−15 0 486 498 ...] → actual values are cumulative sums
  function decodeDeltaArray(key: number): number[] {
    const deltas = privateDictEntries.get(key) ?? []
    const result: number[] = []
    let acc = 0
    for (const d of deltas) {
      acc += d
      result.push(acc)
    }
    return result
  }

  return {
    blueValues: decodeDeltaArray(OP_BLUE_VALUES),
    otherBlues: decodeDeltaArray(OP_OTHER_BLUES),
    familyBlues: decodeDeltaArray(OP_FAMILY_BLUES),
    familyOtherBlues: decodeDeltaArray(OP_FAMILY_OTHER_BLUES),
    blueScale: (privateDictEntries.get(OP_BLUE_SCALE)?.[0]) ?? 0.039625,
    blueShift: (privateDictEntries.get(OP_BLUE_SHIFT)?.[0]) ?? 7,
    blueFuzz: (privateDictEntries.get(OP_BLUE_FUZZ)?.[0]) ?? 1,
    stdHW: (privateDictEntries.get(OP_STD_HW)?.[0]) ?? 0,
    stdVW: (privateDictEntries.get(OP_STD_VW)?.[0]) ?? 0,
    stemSnapH: decodeDeltaArray(OP_STEM_SNAP_H),
    stemSnapV: decodeDeltaArray(OP_STEM_SNAP_V),
    forceBold: ((privateDictEntries.get(OP_FORCE_BOLD)?.[0]) ?? 0) !== 0,
    languageGroup: (privateDictEntries.get(OP_LANGUAGE_GROUP)?.[0]) ?? 0,
  }
}

// --- Stem hints ---

/** Stem hint (position + width) */
export interface StemHint {
  pos: number
  width: number
}

/** Hint data captured from the charstring */
export interface CffHintData {
  hStems: StemHint[]
  vStems: StemHint[]
  hintMasks: Uint8Array[]
  counterMasks: Uint8Array[]
}

// --- Blue zone ---

interface BlueZone {
  bottom: number
  top: number
  isBottom: boolean  // whether to snap the bottom edge or the top edge
}

/** Build blue zones from BlueValues/OtherBlues */
function buildBlueZones(params: CffHintParams): BlueZone[] {
  const zones: BlueZone[] = []

  // BlueValues: positive zones as (bottom, top) pairs
  // The first pair is the baseline zone (isBottom = true)
  // The rest are top edge zones (isBottom = false)
  for (let i = 0; i < params.blueValues.length - 1; i += 2) {
    zones.push({
      bottom: params.blueValues[i]!,
      top: params.blueValues[i + 1]!,
      isBottom: i === 0, // only the first pair is the baseline zone
    })
  }

  // OtherBlues: negative zones as (bottom, top) pairs (descenders, etc.)
  // All are bottom edge zones
  for (let i = 0; i < params.otherBlues.length - 1; i += 2) {
    zones.push({
      bottom: params.otherBlues[i]!,
      top: params.otherBlues[i + 1]!,
      isBottom: true,
    })
  }

  return zones
}

/**
 * Blue zone snapping: if the y coordinate is inside an alignment zone,
 * snap it to an integer pixel boundary
 */
function snapToBlueZone(
  y: number,
  zones: BlueZone[],
  pixelSize: number,  // 1 pixel in font units
  fuzz: number,
): number {
  for (const zone of zones) {
    const bottom = zone.bottom - fuzz
    const top = zone.top + fuzz

    if (y >= bottom && y <= top) {
      // Inside the zone → subject to snapping
      const edge = zone.isBottom ? zone.bottom : zone.top
      // Round to a pixel boundary
      const snapped = Math.round(edge / pixelSize) * pixelSize
      // Apply the difference to the original y
      return y + (snapped - edge)
    }
  }
  return y  // Outside all zones → unchanged
}

/**
 * Round a stem width to an integer pixel width
 */
function alignStemWidth(width: number, pixelSize: number, stdWidth: number): number {
  if (width === 0) return 0
  const absWidth = Math.abs(width)
  const sign = width > 0 ? 1 : -1

  // Convert to pixel units
  const widthPx = absWidth / pixelSize

  // Use the standard width when close to it
  if (stdWidth > 0) {
    const stdPx = stdWidth / pixelSize
    if (Math.abs(widthPx - stdPx) < 0.5) {
      return sign * Math.round(stdPx) * pixelSize
    }
  }

  // Round to an integer pixel width (minimum 1 pixel)
  const rounded = Math.max(1, Math.round(widthPx))
  return sign * rounded * pixelSize
}

/**
 * Apply CFF hinting to an outline
 *
 * @param outline Original glyph outline
 * @param hints Hint data captured from the charstring
 * @param params Hinting parameters from the Private DICT
 * @param ppem Pixel size (pixels per em)
 * @param unitsPerEm The font's unitsPerEm
 * @returns Outline after hinting is applied
 */
export function applyCffHints(
  outline: GlyphOutline,
  hints: CffHintData,
  params: CffHintParams,
  ppem: number,
  unitsPerEm: number,
): GlyphOutline {
  if (ppem <= 0 || unitsPerEm <= 0) return outline
  if (outline.commands.length === 0) return outline

  const pixelSize = unitsPerEm / ppem  // 1 pixel in font units

  // Blue zones
  const zones = buildBlueZones(params)

  // Build the snap map for y coordinates
  // hStems → y coordinate alignment
  const hAdjustments = new Map<number, number>()
  for (const stem of hints.hStems) {
    const newWidth = alignStemWidth(stem.width, pixelSize, params.stdHW)
    const center = stem.pos + stem.width / 2
    const newPos = center - newWidth / 2

    // Snap the edges of the original y range to blue zones
    const bottomSnapped = snapToBlueZone(stem.pos, zones, pixelSize, params.blueFuzz)
    const topSnapped = snapToBlueZone(stem.pos + stem.width, zones, pixelSize, params.blueFuzz)

    // Adjustment amount for the bottom edge
    const bottomAdj = bottomSnapped !== stem.pos
      ? bottomSnapped - stem.pos
      : newPos - stem.pos
    // Adjustment amount for the top edge
    const topAdj = topSnapped !== (stem.pos + stem.width)
      ? topSnapped - (stem.pos + stem.width)
      : (newPos + newWidth) - (stem.pos + stem.width)

    hAdjustments.set(stem.pos, bottomAdj)
    hAdjustments.set(stem.pos + stem.width, topAdj)
  }

  // vStems → x coordinate alignment
  const vAdjustments = new Map<number, number>()
  for (const stem of hints.vStems) {
    const newWidth = alignStemWidth(stem.width, pixelSize, params.stdVW)
    const center = stem.pos + stem.width / 2
    const newPos = center - newWidth / 2

    vAdjustments.set(stem.pos, newPos - stem.pos)
    vAdjustments.set(stem.pos + stem.width, (newPos + newWidth) - (stem.pos + stem.width))
  }

  // Coordinate transform functions: snap to the nearest stem edge
  function adjustX(x: number): number {
    let bestDist = Infinity
    let bestAdj = 0
    for (const [edge, adj] of vAdjustments) {
      const dist = Math.abs(x - edge)
      if (dist < bestDist) {
        bestDist = dist
        bestAdj = adj
      }
    }
    // Apply the adjustment only when sufficiently close to a stem edge
    if (bestDist < pixelSize * 2) {
      return x + bestAdj
    }
    return x
  }

  function adjustY(y: number): number {
    // Check blue zones first
    const snapped = snapToBlueZone(y, zones, pixelSize, params.blueFuzz)
    if (snapped !== y) return snapped

    // Then stem adjustment
    let bestDist = Infinity
    let bestAdj = 0
    for (const [edge, adj] of hAdjustments) {
      const dist = Math.abs(y - edge)
      if (dist < bestDist) {
        bestDist = dist
        bestAdj = adj
      }
    }
    if (bestDist < pixelSize * 2) {
      return y + bestAdj
    }
    return y
  }

  // Build the new coordinate array
  const newCoords = new Float32Array(outline.coords.length)
  let ci = 0
  for (let i = 0; i < outline.commands.length; i++) {
    switch (outline.commands[i]) {
      case PathCommand.MoveTo:
      case PathCommand.LineTo:
        newCoords[ci] = adjustX(outline.coords[ci]!)
        newCoords[ci + 1] = adjustY(outline.coords[ci + 1]!)
        ci += 2
        break
      case PathCommand.CubicTo:
        newCoords[ci] = adjustX(outline.coords[ci]!)
        newCoords[ci + 1] = adjustY(outline.coords[ci + 1]!)
        newCoords[ci + 2] = adjustX(outline.coords[ci + 2]!)
        newCoords[ci + 3] = adjustY(outline.coords[ci + 3]!)
        newCoords[ci + 4] = adjustX(outline.coords[ci + 4]!)
        newCoords[ci + 5] = adjustY(outline.coords[ci + 5]!)
        ci += 6
        break
      case PathCommand.Close:
        // no coordinates
        break
    }
  }

  return {
    commands: outline.commands,
    coords: newCoords,
  }
}
