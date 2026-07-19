import { BinaryReader } from '../../binary/reader.js'
import { parseAatLookupTable } from './aat-common.js'

const ANKR_HEADER_SIZE = 12
const ANKR_VERSION = 0
const ANKR_FLAGS = 0
const ANKR_ANCHOR_COUNT_SIZE = 4
const ANKR_ANCHOR_POINT_SIZE = 4

/**
 * ankr table: Anchor Points (Apple Advanced Typography)
 *
 * Header: version(2) + flags(2) + lookupTableOffset(4) + glyphDataTableOffset(4)
 * The lookup table maps glyph IDs to 16-bit offsets from the start of the
 * glyph data table. Each glyph data entry: numPoints(4) + numPoints * (x(2) + y(2)).
 */

export interface AnkrAnchorPoint {
  readonly x: number
  readonly y: number
}

export interface AnkrTable {
  readonly version: number
  readonly flags: number
  getAnchorPoints(glyphId: number): readonly AnkrAnchorPoint[] | null
}

export function parseAnkr(reader: BinaryReader, numGlyphs?: number): AnkrTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, ANKR_HEADER_SIZE, 'ankr header')

  const version = reader.readUint16()
  if (version !== ANKR_VERSION) {
    throw new Error(`Unsupported ankr table version: ${version}`)
  }

  const flags = reader.readUint16()
  if (flags !== ANKR_FLAGS) {
    throw new Error(`ankr flags must be zero, got ${flags}`)
  }

  const lookupTableOffset = reader.readUint32()
  const glyphDataTableOffset = reader.readUint32()
  if (lookupTableOffset !== ANKR_HEADER_SIZE) {
    throw new Error(`ankr lookupTableOffset must be ${ANKR_HEADER_SIZE}, got ${lookupTableOffset}`)
  }
  validateRange(reader, tableStart + lookupTableOffset, 2, 'ankr lookup table')
  validateRange(reader, tableStart + glyphDataTableOffset, 0, 'ankr glyph data table')
  if (glyphDataTableOffset <= lookupTableOffset) {
    throw new Error('ankr glyphDataTableOffset must follow lookupTableOffset')
  }

  const lookupFormat = reader.getUint16At(tableStart + lookupTableOffset)
  if (!isSupportedAnkrLookupFormat(lookupFormat)) {
    throw new Error(`Unsupported ankr lookup format: ${lookupFormat}`)
  }

  const lookup = parseAatLookupTable(reader, tableStart + lookupTableOffset, numGlyphs)
  const glyphDataStart = tableStart + glyphDataTableOffset

  const anchors = new Map<number, AnkrAnchorPoint[]>()
  for (const [glyphId, offset] of lookup) {
    const entryStart = glyphDataStart + offset
    validateRange(reader, entryStart, ANKR_ANCHOR_COUNT_SIZE, `ankr glyph ${glyphId} anchor entry`)
    reader.seek(entryStart)
    const numPoints = reader.readUint32()
    if (numPoints === 0) {
      throw new Error(`ankr glyph ${glyphId} must not be included with zero anchor points`)
    }
    validateRange(
      reader,
      entryStart + ANKR_ANCHOR_COUNT_SIZE,
      numPoints * ANKR_ANCHOR_POINT_SIZE,
      `ankr glyph ${glyphId} anchor points`,
    )
    const points: AnkrAnchorPoint[] = []
    for (let i = 0; i < numPoints; i++) {
      const x = reader.readInt16()
      const y = reader.readInt16()
      points.push({ x, y })
    }
    anchors.set(glyphId, points)
  }

  return {
    version,
    flags,
    getAnchorPoints(glyphId: number): readonly AnkrAnchorPoint[] | null {
      return anchors.get(glyphId) ?? null
    },
  }
}

function isSupportedAnkrLookupFormat(format: number): boolean {
  return format === 0 || format === 2 || format === 4 || format === 6 || format === 8
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || offset + length > reader.length) {
    throw new Error(`${label} exceeds ankr table length`)
  }
}
