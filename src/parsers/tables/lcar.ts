import { BinaryReader } from '../../binary/reader.js'
import { parseAatLookupTable } from './aat-common.js'

const LCAR_VERSION_1 = 0x00010000
const LCAR_HEADER_SIZE = 6
const LCAR_CARET_COUNT_SIZE = 2
const LCAR_CARET_VALUE_SIZE = 2

/**
 * lcar table: Ligature Caret (Apple Advanced Typography)
 *
 * Header: version(Fixed) + format(2), followed by a lookup table whose values
 * are 16-bit offsets from the start of the lcar table to LcarCaretClassEntry
 * records: count(2) + partials[count] (int16).
 *
 * Format 0: partials are FUnit distances along the baseline.
 * Format 1: partials are control point numbers in the glyph outline.
 */

export interface LcarTable {
  readonly version: number
  /** 0 = distance values, 1 = control point numbers */
  readonly format: number
  /** Caret division values for a ligature glyph */
  getCaretValues(glyphId: number): readonly number[] | null
}

export function parseLcar(reader: BinaryReader, numGlyphs?: number): LcarTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, LCAR_HEADER_SIZE, 'lcar header')

  const rawVersion = reader.readUint32()
  const version = rawVersion / 65536
  if (rawVersion !== LCAR_VERSION_1) {
    throw new Error(`Unsupported lcar table version: 0x${rawVersion.toString(16).padStart(8, '0')}`)
  }

  const format = reader.readUint16()
  if (format !== 0 && format !== 1) {
    throw new Error(`Unsupported lcar format: ${format}`)
  }

  // Lookup table immediately follows the header; values are offsets
  // from the start of the lcar table
  const lookup = parseAatLookupTable(reader, tableStart + LCAR_HEADER_SIZE, numGlyphs)

  const carets = new Map<number, number[]>()
  for (const [glyphId, offset] of lookup) {
    validateEntryOffset(reader, tableStart, offset, 'lcar caret entry')
    const entryStart = tableStart + offset
    reader.seek(entryStart)
    const count = reader.readUint16()
    validateRange(
      reader,
      entryStart + LCAR_CARET_COUNT_SIZE,
      count * LCAR_CARET_VALUE_SIZE,
      `lcar glyph ${glyphId} caret values`,
    )
    const partials: number[] = []
    for (let i = 0; i < count; i++) {
      partials.push(reader.readInt16())
    }
    carets.set(glyphId, partials)
  }

  return {
    version,
    format,
    getCaretValues(glyphId: number): readonly number[] | null {
      return carets.get(glyphId) ?? null
    },
  }
}

function validateEntryOffset(reader: BinaryReader, tableStart: number, offset: number, label: string): void {
  if (offset < LCAR_HEADER_SIZE) {
    throw new Error(`${label} offset overlaps lcar header: ${offset}`)
  }
  validateRange(reader, tableStart + offset, LCAR_CARET_COUNT_SIZE, label)
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || offset + length > reader.length) {
    throw new Error(`${label} exceeds lcar table length`)
  }
}
