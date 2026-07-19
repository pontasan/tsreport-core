import { BinaryReader } from '../../binary/reader.js'

const PCLT_TABLE_LENGTH = 54
const PCLT_VERSION = 0x00010000
const PCLT_TYPEFACE_LENGTH = 16
const PCLT_CHARACTER_COMPLEMENT_LENGTH = 8
const PCLT_FILENAME_LENGTH = 6

/**
 * PCLT table: PCL 5 compatibility data
 * Font information for HP PCL 5 compatible printers
 */
export interface PcltTable {
  readonly version: number
  readonly fontNumber: number
  readonly pitch: number
  readonly xHeight: number
  readonly style: number
  readonly typeFamily: number
  readonly capHeight: number
  readonly symbolSet: number
  readonly typeface: string
  readonly characterComplement: Uint8Array
  readonly fileName: string
  readonly strokeWeight: number
  readonly widthType: number
  readonly serifStyle: number
}

/**
 * Parse the PCLT table (fixed 54 bytes)
 * https://learn.microsoft.com/en-us/typography/opentype/spec/pclt
 */
export function parsePclt(reader: BinaryReader): PcltTable {
  if (reader.length < PCLT_TABLE_LENGTH) throw new Error(`PCLT table length must be at least ${PCLT_TABLE_LENGTH}, got ${reader.length}`)

  const version = reader.readUint32()   // Fixed 1.0
  const majorVersion = version >>> 16
  const minorVersion = version & 0xFFFF
  if (majorVersion !== 1) {
    throw new Error(`Unsupported PCLT table version: 0x${version.toString(16).padStart(8, '0')}`)
  }
  if (minorVersion === 0 && reader.length !== PCLT_TABLE_LENGTH) {
    throw new Error(`PCLT version 1.0 table length must be ${PCLT_TABLE_LENGTH}, got ${reader.length}`)
  }

  const fontNumber = reader.readUint32()
  const pitch = reader.readUint16()
  const xHeight = reader.readUint16()
  const style = reader.readUint16()
  const typeFamily = reader.readUint16()
  const capHeight = reader.readUint16()
  const symbolSet = reader.readUint16()
  validateStyle(style)
  validateTypeFamily(typeFamily)
  const typeface = readPcltAscii(reader, PCLT_TYPEFACE_LENGTH, 'typeface')
  const characterComplement = reader.readBytes(PCLT_CHARACTER_COMPLEMENT_LENGTH)
  const fileName = readPcltAscii(reader, PCLT_FILENAME_LENGTH, 'fileName')
  const strokeWeight = reader.readInt8()
  const widthType = reader.readInt8()
  const serifStyle = reader.readUint8()
  const reserved = reader.readUint8()
  validateStrokeWeight(strokeWeight)
  validateWidthType(widthType)
  validateSerifStyle(serifStyle)
  if (minorVersion === 0 && reserved !== 0) {
    throw new Error(`PCLT reserved byte must be zero, got ${reserved}`)
  }

  return {
    version,
    fontNumber,
    pitch,
    xHeight,
    style,
    typeFamily,
    capHeight,
    symbolSet,
    typeface,
    characterComplement,
    fileName,
    strokeWeight,
    widthType,
    serifStyle,
  }
}

function readPcltAscii(reader: BinaryReader, length: number, label: string): string {
  let result = ''
  let seenPadding = false
  for (let i = 0; i < length; i++) {
    const value = reader.readUint8()
    if (value === 0) {
      seenPadding = true
    } else {
      if (seenPadding) {
        throw new Error(`PCLT ${label} contains non-padding byte after NUL at index ${i}`)
      }
      if (value > 0x7F) {
        throw new Error(`PCLT ${label} must contain ASCII bytes, got 0x${value.toString(16)} at index ${i}`)
      }
      result += String.fromCharCode(value)
    }
  }
  return result
}

function validateStyle(style: number): void {
  if ((style & 0xFC00) !== 0) {
    throw new Error(`PCLT style reserved high bits must be zero: 0x${style.toString(16)}`)
  }
  const structure = (style >> 5) & 0x1F
  if (structure >= 18) {
    throw new Error(`PCLT style structure value is reserved: ${structure}`)
  }
  const width = (style >> 2) & 0x07
  if (width === 5) {
    throw new Error('PCLT style width value 5 is reserved')
  }
  const posture = style & 0x03
  if (posture === 3) {
    throw new Error('PCLT style posture value 3 is reserved')
  }
}

function validateTypeFamily(typeFamily: number): void {
  const vendor = typeFamily >> 12
  if (vendor === 0 || vendor >= 8) {
    throw new Error(`PCLT typeFamily vendor code is reserved: ${vendor}`)
  }
}

function validateStrokeWeight(strokeWeight: number): void {
  if (strokeWeight < -7 || strokeWeight > 7) {
    throw new Error(`PCLT strokeWeight must be in -7..7, got ${strokeWeight}`)
  }
}

function validateWidthType(widthType: number): void {
  if (widthType < -5 || widthType > 5 || widthType === -1 || widthType === 1 || widthType === 4 || widthType === 5) {
    throw new Error(`PCLT widthType is reserved or out of range: ${widthType}`)
  }
}

function validateSerifStyle(serifStyle: number): void {
  const base = serifStyle & 0x3F
  const top = serifStyle >> 6
  if (base > 12) {
    throw new Error(`PCLT serifStyle bottom bits are reserved: ${base}`)
  }
  // Top bits 0 = "serif style not specified"; shipping fonts commonly leave the
  // whole byte 0, so only the genuinely-reserved value 3 is rejected.
  if (top === 3) {
    throw new Error(`PCLT serifStyle top bits are reserved: ${top}`)
  }
}
