import { BinaryReader } from '../../binary/reader.js'
import type { HeadTable } from '../../types/index.js'

/**
 * Parse the head table.
 *
 * @param isBitmapHeader parse a 'bhed' (bitmap font header) — structurally
 *   identical to 'head' but its magic number is not the 'head' sentinel, so the
 *   magic-number check is skipped.
 */
export function parseHead(reader: BinaryReader, isBitmapHeader = false): HeadTable {
  if (reader.length < 54) {
    throw new Error(`head table length must be at least 54, got ${reader.length}`)
  }
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    throw new Error(`Unsupported head version: ${majorVersion}.${minorVersion}`)
  }
  if (minorVersion === 0 && reader.length !== 54) {
    throw new Error(`head table version 1.0 length must be 54, got ${reader.length}`)
  }
  const fontRevision = reader.readFixed()
  const checksumAdjustment = reader.readUint32()
  const magicNumber = reader.readUint32()
  if (!isBitmapHeader && magicNumber !== 0x5F0F3CF5) {
    throw new Error(`Invalid head table magic number: 0x${magicNumber.toString(16)}`)
  }
  const flags = reader.readUint16()
  if (minorVersion === 0 && (flags & 0x8000) !== 0) {
    throw new Error('head flags reserved bit 15 must be 0')
  }
  const unitsPerEm = reader.readUint16()
  if (unitsPerEm < 16 || unitsPerEm > 16384) {
    throw new Error(`head unitsPerEm must be in the range 16..16384, got ${unitsPerEm}`)
  }
  const created = reader.readLongDateTime()
  const modified = reader.readLongDateTime()
  const xMin = reader.readInt16()
  const yMin = reader.readInt16()
  const xMax = reader.readInt16()
  const yMax = reader.readInt16()
  if (xMin > xMax || yMin > yMax) {
    throw new Error(`head bounding box is invalid: (${xMin}, ${yMin})..(${xMax}, ${yMax})`)
  }
  const macStyle = reader.readUint16()
  if (minorVersion === 0 && (macStyle & 0xFF80) !== 0) {
    throw new Error(`head macStyle reserved bits must be 0, got 0x${macStyle.toString(16).padStart(4, '0')}`)
  }
  // lowestRecPPEM is the advisory smallest readable size; shipping fonts (e.g.
  // Apple's Big Caslon) leave it 0 to mean "unspecified", so it is not rejected.
  const lowestRecPPEM = reader.readUint16()
  const fontDirectionHint = reader.readInt16()
  if (fontDirectionHint < -2 || fontDirectionHint > 2) {
    throw new Error(`head fontDirectionHint must be between -2 and 2, got ${fontDirectionHint}`)
  }
  const indexToLocFormat = reader.readInt16()
  if (indexToLocFormat !== 0 && indexToLocFormat !== 1) {
    throw new Error(`head indexToLocFormat must be 0 or 1, got ${indexToLocFormat}`)
  }
  const glyphDataFormat = reader.readInt16()
  if (minorVersion === 0 && glyphDataFormat !== 0) {
    throw new Error(`head glyphDataFormat must be 0, got ${glyphDataFormat}`)
  }

  return {
    majorVersion,
    minorVersion,
    fontRevision,
    checksumAdjustment,
    magicNumber,
    flags,
    unitsPerEm,
    created,
    modified,
    xMin,
    yMin,
    xMax,
    yMax,
    macStyle,
    lowestRecPPEM,
    fontDirectionHint,
    indexToLocFormat,
    glyphDataFormat,
  }
}
