import { BinaryReader } from '../../binary/reader.js'
import { parseAatLookupTable } from './aat-common.js'

const OPBD_VERSION_1 = 0x00010000
const OPBD_HEADER_SIZE = 6
const OPBD_BOUNDS_SIZE = 8

/**
 * opbd table: Optical Bounds (Apple AAT)
 * Per-glyph optical margin adjustment values
 */

export interface OpbdBounds {
  left: number    // left-side delta or control point
  top: number     // top-side delta or control point
  right: number   // right-side delta or control point
  bottom: number  // bottom-side delta or control point
}

export interface OpbdTable {
  readonly version: number
  readonly format: number  // 0 = distance values, 1 = control point values
  getOpticalBounds(glyphId: number): OpbdBounds | null
}

export function parseOpbd(reader: BinaryReader, numGlyphs?: number): OpbdTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, OPBD_HEADER_SIZE, 'opbd header')

  const rawVersion = reader.readUint32()
  const version = rawVersion / 65536
  if (rawVersion !== OPBD_VERSION_1) {
    throw new Error(`Unsupported opbd table version: 0x${rawVersion.toString(16).padStart(8, '0')}`)
  }

  const format = reader.readUint16()  // 0 or 1
  if (format !== 0 && format !== 1) {
    throw new Error(`Unsupported opbd format: ${format}`)
  }

  // Lookup table immediately follows the header
  const lookupOffset = reader.position - tableStart
  const lookupMap = parseAatLookupTable(reader, tableStart + lookupOffset, numGlyphs)

  // For opbd, lookup values are offsets to the optical bounds data
  // Each entry has 4 Int16 values (8 bytes)
  const boundsCache = new Map<number, OpbdBounds>()

  for (const [glyphId, valueOffset] of lookupMap) {
    validateEntryOffset(reader, tableStart, valueOffset, `opbd glyph ${glyphId} bounds`)
    reader.seek(tableStart + valueOffset)
    const left = reader.readInt16()
    const top = reader.readInt16()
    const right = reader.readInt16()
    const bottom = reader.readInt16()
    boundsCache.set(glyphId, { left, top, right, bottom })
  }

  return {
    version,
    format,
    getOpticalBounds(glyphId: number): OpbdBounds | null {
      return boundsCache.get(glyphId) ?? null
    },
  }
}

function validateEntryOffset(reader: BinaryReader, tableStart: number, offset: number, label: string): void {
  if (offset < OPBD_HEADER_SIZE) {
    throw new Error(`${label} offset overlaps opbd header: ${offset}`)
  }
  validateRange(reader, tableStart + offset, OPBD_BOUNDS_SIZE, label)
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || offset + length > reader.length) {
    throw new Error(`${label} exceeds opbd table length`)
  }
}
