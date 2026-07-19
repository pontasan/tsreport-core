import { BinaryReader } from '../../binary/reader.js'

/**
 * gasp table range record
 */
export interface GaspRange {
  /** Maximum PPEM value for this range */
  readonly rangeMaxPPEM: number
  /** Bit flags: GRIDFIT(0x01), DOGRAY(0x02), SYMMETRIC_GRIDFIT(0x04), SYMMETRIC_SMOOTHING(0x08) */
  readonly rangeGaspBehavior: number
}

/** gasp flag constants */
export const GASP_GRIDFIT = 0x0001
export const GASP_DOGRAY = 0x0002
export const GASP_SYMMETRIC_GRIDFIT = 0x0004
export const GASP_SYMMETRIC_SMOOTHING = 0x0008
const GASP_DEFINED_FLAGS = GASP_GRIDFIT | GASP_DOGRAY | GASP_SYMMETRIC_GRIDFIT | GASP_SYMMETRIC_SMOOTHING
const GASP_VERSION_1_FLAGS = GASP_SYMMETRIC_GRIDFIT | GASP_SYMMETRIC_SMOOTHING
const GASP_HEADER_SIZE = 4
const GASP_RANGE_SIZE = 4

/**
 * gasp table: grid-fitting and anti-aliasing control
 */
export interface GaspTable {
  /** Version */
  readonly version: number
  /** Range records */
  readonly ranges: readonly GaspRange[]
  /** Returns the gasp behavior flags that apply to the given PPEM */
  getGaspBehavior(ppem: number): number
}

/**
 * Parses the gasp table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/gasp
 */
export function parseGasp(reader: BinaryReader): GaspTable {
  if (reader.length < GASP_HEADER_SIZE) {
    throw new Error(`gasp table length must be at least ${GASP_HEADER_SIZE}, got ${reader.length}`)
  }

  const version = reader.readUint16()
  const numRanges = reader.readUint16()
  if (numRanges === 0) {
    throw new Error('gasp table must contain at least one range')
  }

  const expectedLength = GASP_HEADER_SIZE + numRanges * GASP_RANGE_SIZE
  if (reader.length < expectedLength || (version <= 1 && reader.length !== expectedLength)) {
    throw new Error(`gasp table length mismatch: expected ${version <= 1 ? '' : 'at least '}${expectedLength}, got ${reader.length}`)
  }

  const ranges: GaspRange[] = []
  let previousMaxPPEM = -1
  for (let i = 0; i < numRanges; i++) {
    const rangeMaxPPEM = reader.readUint16()
    const rangeGaspBehavior = reader.readUint16()
    if (rangeMaxPPEM <= previousMaxPPEM) {
      throw new Error(`gasp ranges must be sorted by increasing rangeMaxPPEM at index ${i}`)
    }
    if (version <= 1 && (rangeGaspBehavior & ~GASP_DEFINED_FLAGS) !== 0) {
      throw new Error(`gasp range ${i} has reserved behavior flags: 0x${rangeGaspBehavior.toString(16)}`)
    }
    if (version === 0 && (rangeGaspBehavior & GASP_VERSION_1_FLAGS) !== 0) {
      throw new Error(`gasp version 0 range ${i} uses version 1 behavior flags: 0x${rangeGaspBehavior.toString(16)}`)
    }
    ranges.push({ rangeMaxPPEM, rangeGaspBehavior })
    previousMaxPPEM = rangeMaxPPEM
  }
  // The spec expects the final range to end at 0xFFFF, but real fonts sometimes
  // stop short; getGaspBehavior already extends the last range's behavior to any
  // larger ppem, so a non-0xFFFF final range is accepted rather than rejected.

  return {
    version,
    ranges,
    getGaspBehavior(ppem: number): number {
      for (const range of ranges) {
        if (ppem <= range.rangeMaxPPEM) {
          return range.rangeGaspBehavior
        }
      }
      // If ppem exceeds all ranges, return the last range's value
      return ranges.length > 0 ? ranges[ranges.length - 1]!.rangeGaspBehavior : 0
    },
  }
}
