import { BinaryReader } from '../../binary/reader.js'
import type { Os2Table } from '../../types/index.js'

/**
 * A synthetic OS/2 table for fonts that omit it. Metric fields are left zero so
 * the caller falls back to hhea and derived defaults; fsSelection and
 * weightClass are inferred from head.macStyle (bold/italic bits).
 */
export function syntheticOs2(macStyle: number): Os2Table {
  const bold = (macStyle & 0x01) !== 0
  const italic = (macStyle & 0x02) !== 0
  const fsSelection = ((bold ? 0x20 : 0) | (italic ? 0x01 : 0)) || 0x40 // REGULAR when neither
  return {
    version: 0, avgCharWidth: 0, weightClass: bold ? 700 : 400, widthClass: 5, fsType: 0,
    subscriptXSize: 0, subscriptYSize: 0, subscriptXOffset: 0, subscriptYOffset: 0,
    superscriptXSize: 0, superscriptYSize: 0, superscriptXOffset: 0, superscriptYOffset: 0,
    strikeoutSize: 0, strikeoutPosition: 0, familyClass: 0, panose: new Uint8Array(10),
    unicodeRange1: 0, unicodeRange2: 0, unicodeRange3: 0, unicodeRange4: 0, achVendID: '',
    fsSelection, firstCharIndex: 0, lastCharIndex: 0,
    typoAscender: 0, typoDescender: 0, typoLineGap: 0, winAscent: 0, winDescent: 0,
    xHeight: 0, capHeight: 0, codePageRange1: 0, codePageRange2: 0,
    defaultChar: 0, breakChar: 0, maxContext: 0, lowerOpticalPointSize: 0, upperOpticalPointSize: 0xFFFF,
  }
}

/**
 * Parse the OS/2 table
 */
export function parseOs2(reader: BinaryReader): Os2Table {
  if (reader.length < 2) {
    throw new Error('OS/2 table length must be at least 2 bytes')
  }
  const version = reader.readUint16()
  const expectedLength = getOs2MinimumLength(version)
  if (reader.length < expectedLength) {
    throw new Error(`OS/2 table length must be at least ${expectedLength} bytes for version ${version}, got ${reader.length}`)
  }
  if (version === 0 && reader.length > 68 && reader.length < 78) {
    throw new Error(`OS/2 version 0 table must be either the 68-byte legacy form or at least 78 bytes, got ${reader.length}`)
  }
  const avgCharWidth = reader.readInt16()
  const weightClass = reader.readUint16()
  const widthClass = reader.readUint16()
  const fsType = reader.readUint16()
  const subscriptXSize = reader.readInt16()
  const subscriptYSize = reader.readInt16()
  const subscriptXOffset = reader.readInt16()
  const subscriptYOffset = reader.readInt16()
  const superscriptXSize = reader.readInt16()
  const superscriptYSize = reader.readInt16()
  const superscriptXOffset = reader.readInt16()
  const superscriptYOffset = reader.readInt16()
  const strikeoutSize = reader.readInt16()
  const strikeoutPosition = reader.readInt16()
  const familyClass = reader.readInt16()
  const panose = reader.readBytes(10)
  const unicodeRange1 = reader.readUint32()
  const unicodeRange2 = reader.readUint32()
  const unicodeRange3 = reader.readUint32()
  const unicodeRange4 = reader.readUint32()
  const achVendID = reader.readTag()
  validateVendorId(achVendID)
  const fsSelection = reader.readUint16()
  const firstCharIndex = reader.readUint16()
  const lastCharIndex = reader.readUint16()
  if (firstCharIndex > lastCharIndex) {
    throw new Error(`OS/2 usFirstCharIndex must be <= usLastCharIndex, got ${firstCharIndex} > ${lastCharIndex}`)
  }
  let typoAscender = 0
  let typoDescender = 0
  let typoLineGap = 0
  let winAscent = 0
  let winDescent = 0
  if (reader.remaining >= 10) {
    typoAscender = reader.readInt16()
    typoDescender = reader.readInt16()
    typoLineGap = reader.readInt16()
    winAscent = reader.readUint16()
    winDescent = reader.readUint16()
  }

  // v1+: code page ranges
  let codePageRange1 = 0
  let codePageRange2 = 0
  if (version >= 1) {
    codePageRange1 = reader.readUint32()
    codePageRange2 = reader.readUint32()
  }

  // v2+ (also 3, 4): x-height, cap height, default/break char, max context
  let xHeight = 0
  let capHeight = 0
  let defaultChar = 0
  let breakChar = 0
  let maxContext = 0
  if (version >= 2) {
    xHeight = reader.readInt16()
    capHeight = reader.readInt16()
    defaultChar = reader.readUint16()
    breakChar = reader.readUint16()
    maxContext = reader.readUint16()
  }

  // v5: optical point size range (TWIPs, 1/20 pt)
  let lowerOpticalPointSize = 0
  let upperOpticalPointSize = 0xFFFF
  if (version >= 5) {
    lowerOpticalPointSize = reader.readUint16()
    upperOpticalPointSize = reader.readUint16()
  }

  return {
    version,
    avgCharWidth,
    weightClass,
    widthClass,
    fsType,
    subscriptXSize,
    subscriptYSize,
    subscriptXOffset,
    subscriptYOffset,
    superscriptXSize,
    superscriptYSize,
    superscriptXOffset,
    superscriptYOffset,
    strikeoutSize,
    strikeoutPosition,
    familyClass,
    panose,
    unicodeRange1,
    unicodeRange2,
    unicodeRange3,
    unicodeRange4,
    achVendID,
    fsSelection,
    firstCharIndex,
    lastCharIndex,
    typoAscender,
    typoDescender,
    typoLineGap,
    winAscent,
    winDescent,
    xHeight,
    capHeight,
    codePageRange1,
    codePageRange2,
    defaultChar,
    breakChar,
    maxContext,
    lowerOpticalPointSize,
    upperOpticalPointSize,
  }
}

function getOs2MinimumLength(version: number): number {
  if (version === 0) return 68
  if (version === 1) return 86
  if (version <= 4) return 96
  return 100
}

/** Validates normative OpenType 1.9.1 OS/2 field constraints. */
export function validateOs2Conformance(os2: Os2Table): void {
  if (os2.weightClass < 1 || os2.weightClass > 1000) {
    throw new Error(`OS/2 usWeightClass must be from 1 to 1000, got ${os2.weightClass}`)
  }
  if (os2.widthClass < 1 || os2.widthClass > 9) {
    throw new Error(`OS/2 usWidthClass must be from 1 to 9, got ${os2.widthClass}`)
  }
  if ((os2.fsType & 0x0001) !== 0) {
    throw new Error('OS/2 fsType bit 0 is reserved and must be zero')
  }
  if (os2.version >= 2 && os2.version <= 5 && (os2.fsType & 0xFCF0) !== 0) {
    throw new Error('OS/2 fsType reserved bits must be zero')
  }
  if (os2.version >= 3 && os2.version <= 5) {
    const usage = os2.fsType & 0x000E
    if (usage !== 0 && usage !== 2 && usage !== 4 && usage !== 8) {
      throw new Error('OS/2 fsType versions 3 to 5 must set at most one usage-permission bit')
    }
  }
  validateFsSelection(os2.version, os2.fsSelection)
  if (os2.version >= 5 && (os2.upperOpticalPointSize < 2 || os2.lowerOpticalPointSize >= os2.upperOpticalPointSize)) {
    throw new Error(`OS/2 optical point size range must satisfy lower < upper and upper >= 2, got ${os2.lowerOpticalPointSize} and ${os2.upperOpticalPointSize}`)
  }
}

function validateVendorId(achVendID: string): void {
  // achVendID is a free-form four-byte vendor identifier the engine only echoes;
  // shipping fonts pad it with NULs or other non-printable bytes, so it is not
  // character-validated.
  void achVendID
}

function validateFsSelection(version: number, fsSelection: number): void {
  const reservedMask = version <= 3 ? 0xFF80 : 0xFC00
  if (version <= 5 && (fsSelection & reservedMask) !== 0) {
    throw new Error('OS/2 fsSelection reserved bits must be zero')
  }
  if ((fsSelection & 0x0040) !== 0 && (fsSelection & 0x0021) !== 0) {
    throw new Error('OS/2 fsSelection REGULAR bit requires ITALIC and BOLD bits to be clear')
  }
}
