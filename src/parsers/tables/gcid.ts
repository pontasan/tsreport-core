import { BinaryReader } from '../../binary/reader.js'

const GCID_HEADER_SIZE = 144

/**
 * gcid table: Glyph to CID Mapping (Apple Advanced Typography)
 *
 * Layout: version(2) + format(2) + size(4) + registry(2) + registryName(64)
 *         + order(2) + orderName(64) + supplementVersion(2) + count(2)
 *         + CIDs[count] (uint16, 0xFFFF = no CID).
 */

export interface GcidTable {
  readonly version: number
  readonly format: number
  readonly registry: number
  readonly registryName: string
  readonly order: number
  readonly orderName: string
  readonly supplementVersion: number
  readonly count: number
  /** CID for the glyph, or null when the glyph has no CID */
  getCid(glyphId: number): number | null
}

/** Reads a fixed-size NUL-padded ASCII field */
function readPaddedAscii(reader: BinaryReader, length: number, label: string): string {
  let value = ''
  let terminated = false
  for (let i = 0; i < length; i++) {
    const byte = reader.readUint8()
    if (byte === 0) {
      terminated = true
    } else if (terminated) {
      throw new Error(`gcid ${label} has non-zero data after NUL padding`)
    } else if (byte < 0x20 || byte > 0x7E) {
      throw new Error(`gcid ${label} must contain printable ASCII bytes`)
    } else {
      value += String.fromCharCode(byte)
    }
  }
  return value
}

export function parseGcid(reader: BinaryReader, numGlyphs?: number): GcidTable {
  const tableStart = reader.position
  if (reader.length - tableStart < GCID_HEADER_SIZE) {
    throw new Error(`gcid table length must be at least ${GCID_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }
  const version = reader.readUint16()
  if (version !== 0) throw new Error(`Unsupported gcid table version: ${version}`)
  const format = reader.readUint16()
  if (format !== 0) throw new Error(`Unsupported gcid table format: ${format}`)
  const size = reader.readUint32()
  if (size !== reader.length - tableStart) {
    throw new Error(`gcid size ${size} does not match table length ${reader.length - tableStart}`)
  }
  const registry = reader.readUint16()
  const registryName = readPaddedAscii(reader, 64, 'registryName')
  const order = reader.readUint16()
  const orderName = readPaddedAscii(reader, 64, 'orderName')
  const supplementVersion = reader.readUint16()
  const count = reader.readUint16()
  if (numGlyphs !== undefined && count > numGlyphs) {
    throw new Error(`gcid count ${count} exceeds numGlyphs ${numGlyphs}`)
  }
  if (GCID_HEADER_SIZE + count * 2 !== size) {
    throw new Error(`gcid count ${count} does not consume table size ${size}`)
  }
  const cids = reader.readUint16Array(count)

  return {
    version,
    format,
    registry,
    registryName,
    order,
    orderName,
    supplementVersion,
    count,
    getCid(glyphId: number): number | null {
      if (glyphId < 0 || glyphId >= count) return null
      const cid = cids[glyphId]!
      return cid === 0xFFFF ? null : cid
    },
  }
}
