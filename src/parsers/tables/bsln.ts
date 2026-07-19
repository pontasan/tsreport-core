import { BinaryReader } from '../../binary/reader.js'
import { parseAatLookupTable } from './aat-common.js'

const BSLN_VERSION_1 = 0x00010000
const BSLN_HEADER_SIZE = 8
const BSLN_BASELINE_COUNT = 32
const BSLN_DISTANCE_PART_SIZE = BSLN_BASELINE_COUNT * 2
const BSLN_CONTROL_POINT_PART_SIZE = 2 + BSLN_BASELINE_COUNT * 2
const BSLN_FORMAT_1_LOOKUP_OFFSET = BSLN_HEADER_SIZE + BSLN_DISTANCE_PART_SIZE
const BSLN_FORMAT_3_LOOKUP_OFFSET = BSLN_HEADER_SIZE + BSLN_CONTROL_POINT_PART_SIZE

/**
 * bsln table: Baseline (Apple Advanced Typography)
 *
 * Header: version(Fixed) + format(2) + defaultBaseline(2)
 * Format 0: deltas[32] (int16), no per-glyph mapping
 * Format 1: deltas[32] + lookup table (glyph -> baseline class)
 * Format 2: stdGlyph(2) + ctlPoints[32] (uint16), no per-glyph mapping
 * Format 3: stdGlyph(2) + ctlPoints[32] + lookup table
 *
 * Baseline classes: 0=Roman, 1=Ideographic centered, 2=Ideographic low,
 * 3=Hanging, 4=Math (5-31 reserved).
 */

export interface BslnTable {
  readonly version: number
  readonly format: number
  readonly defaultBaseline: number
  /** Baseline deltas in font units (formats 0 and 1), indexed by baseline class */
  readonly deltas: Int16Array | null
  /** Standard glyph whose control points define the baselines (formats 2 and 3) */
  readonly stdGlyph: number | null
  /** Control point numbers per baseline class, 0xFFFF = none (formats 2 and 3) */
  readonly ctlPoints: Uint16Array | null
  /** Baseline class of the glyph (per-glyph mapping or the default baseline) */
  getBaselineClass(glyphId: number): number
}

export function parseBsln(reader: BinaryReader, numGlyphs?: number): BslnTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, BSLN_HEADER_SIZE, 'bsln header')

  const rawVersion = reader.readUint32()
  const version = rawVersion / 65536
  if (rawVersion !== BSLN_VERSION_1) {
    throw new Error(`Unsupported bsln table version: 0x${rawVersion.toString(16).padStart(8, '0')}`)
  }

  const format = reader.readUint16()
  const defaultBaseline = reader.readUint16()
  validateBaselineValue(defaultBaseline, 'bsln defaultBaseline')

  let deltas: Int16Array | null = null
  let stdGlyph: number | null = null
  let ctlPoints: Uint16Array | null = null
  let mapping: Map<number, number> | null = null

  if (format === 0 || format === 1) {
    validateRange(reader, tableStart + BSLN_HEADER_SIZE, BSLN_DISTANCE_PART_SIZE, 'bsln distance baseline deltas')
    deltas = reader.readInt16Array(BSLN_BASELINE_COUNT)
    if (format === 1) {
      mapping = parseAatLookupTable(reader, tableStart + BSLN_FORMAT_1_LOOKUP_OFFSET, numGlyphs)
      validateMapping(mapping)
    }
  } else if (format === 2 || format === 3) {
    validateRange(reader, tableStart + BSLN_HEADER_SIZE, BSLN_CONTROL_POINT_PART_SIZE, 'bsln control point data')
    stdGlyph = reader.readUint16()
    if (numGlyphs !== undefined && stdGlyph >= numGlyphs) {
      throw new Error(`bsln stdGlyph ${stdGlyph} exceeds numGlyphs ${numGlyphs}`)
    }
    ctlPoints = reader.readUint16Array(BSLN_BASELINE_COUNT)
    if (format === 3) {
      mapping = parseAatLookupTable(reader, tableStart + BSLN_FORMAT_3_LOOKUP_OFFSET, numGlyphs)
      validateMapping(mapping)
    }
  } else {
    throw new Error(`Unsupported bsln format: ${format}`)
  }

  return {
    version,
    format,
    defaultBaseline,
    deltas,
    stdGlyph,
    ctlPoints,
    getBaselineClass(glyphId: number): number {
      if (mapping === null) return defaultBaseline
      return mapping.get(glyphId) ?? defaultBaseline
    },
  }
}

function validateMapping(mapping: Map<number, number>): void {
  for (const [glyphId, baseline] of mapping) {
    validateBaselineValue(baseline, `bsln glyph ${glyphId} baseline value`)
  }
}

function validateBaselineValue(value: number, label: string): void {
  if (value > 31) {
    throw new Error(`${label} must be in the range 0..31, got ${value}`)
  }
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || offset + length > reader.length) {
    throw new Error(`${label} exceeds bsln table length`)
  }
}
