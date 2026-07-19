import { BinaryReader } from '../../binary/reader.js'

/**
 * Shared by EBLC/CBLC: BitmapSize record
 */
export interface BitmapSizeRecord {
  readonly indexSubTableArrayOffset: number
  readonly indexTablesSize: number
  readonly numberOfIndexSubTables: number
  readonly colorRef: number
  readonly hori: SbitLineMetrics
  readonly vert: SbitLineMetrics
  readonly ppemX: number
  readonly ppemY: number
  readonly bitDepth: number
  readonly startGlyphIndex: number
  readonly endGlyphIndex: number
  readonly flags: 1 | 2 | 3
}

export interface SbitLineMetrics {
  readonly ascender: number
  readonly descender: number
  readonly widthMax: number
  readonly caretSlopeNumerator: number
  readonly caretSlopeDenominator: number
  readonly caretOffset: number
  readonly minOriginSB: number
  readonly minAdvanceSB: number
  readonly maxBeforeBL: number
  readonly minAfterBL: number
}

export interface BitmapGlyphLocation {
  readonly indexFormat: number
  readonly imageFormat: number
  readonly imageDataOffset: number
  readonly imageDataSize: number
  readonly metrics: BitmapMetrics | null
}

/**
 * IndexSubTable header
 */
export interface IndexSubTableHeader {
  readonly firstGlyphIndex: number
  readonly lastGlyphIndex: number
  readonly additionalOffsetToIndexSubtable: number
}

/**
 * Bitmap metrics
 */
export interface BitmapMetrics {
  readonly height: number
  readonly width: number
  readonly horiBearingX: number
  readonly horiBearingY: number
  readonly horiAdvance: number
  readonly vertBearingX: number
  readonly vertBearingY: number
  readonly vertAdvance: number
}

/**
 * Bitmap glyph data
 */
export interface BitmapGlyphData {
  /** Bitmap data (PNG for CBDT, raw bitmap for EBDT) */
  readonly data: Uint8Array
  /** Image format number */
  readonly format: number
  /** Metrics */
  readonly metrics: BitmapMetrics
}

/**
 * Parses the EBLC/CBLC header and returns the array of BitmapSize records
 */
export function parseBitmapLocationHeader(
  reader: BinaryReader,
  expectedMajorVersion?: 2 | 3,
  allowCombinedMetrics = false,
): BitmapSizeRecord[] {
  if (reader.length < 8) throw new Error('bitmap location table header is truncated')
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 2 && majorVersion !== 3) {
    throw new Error(`Unsupported bitmap location table version ${majorVersion}.${minorVersion}`)
  }
  if (expectedMajorVersion !== undefined && majorVersion !== expectedMajorVersion) {
    throw new Error(`Bitmap location table major version must be ${expectedMajorVersion}, got ${majorVersion}.${minorVersion}`)
  }
  const numSizes = reader.readUint32()
  if (numSizes > Math.floor((reader.length - 8) / 48)) throw new Error('bitmapSize records exceed table length')

  const sizes: BitmapSizeRecord[] = []
  for (let i = 0; i < numSizes; i++) {
    const indexSubTableArrayOffset = reader.readUint32()
    const indexTablesSize = reader.readUint32()
    const numberOfIndexSubTables = reader.readUint32()
    const colorRef = reader.readUint32()
    const hori = readSbitLineMetrics(reader)
    const vert = readSbitLineMetrics(reader)

    const startGlyphIndex = reader.readUint16()
    const endGlyphIndex = reader.readUint16()
    const ppemX = reader.readUint8()
    const ppemY = reader.readUint8()
    const bitDepth = reader.readUint8()
    const flags = reader.readInt8()
    if (startGlyphIndex > endGlyphIndex) throw new Error('bitmapSize glyph range is reversed')
    if (ppemX === 0 || ppemY === 0) throw new Error('bitmapSize ppem values must be non-zero')
    const validDepth = bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8
      || (majorVersion === 3 && bitDepth === 32)
    if (!validDepth) throw new Error(`bitmapSize bitDepth ${bitDepth} is invalid for version ${majorVersion}.0`)
    if (flags !== 1 && flags !== 2 && !(allowCombinedMetrics && flags === 3)) {
      throw new Error(`bitmapSize flags ${flags} are invalid`)
    }
    if (colorRef !== 0) throw new Error(`bitmapSize colorRef must be zero, got ${colorRef}`)
    if ((indexSubTableArrayOffset & 3) !== 0) throw new Error('bitmapSize index subtable list must be 4-byte aligned')
    if (indexTablesSize < numberOfIndexSubTables * 8) throw new Error('bitmapSize index subtable list is truncated')
    if (indexSubTableArrayOffset > reader.length || indexTablesSize > reader.length - indexSubTableArrayOffset) {
      throw new Error('bitmapSize index tables exceed table length')
    }

    sizes.push({
      indexSubTableArrayOffset,
      indexTablesSize,
      numberOfIndexSubTables,
      colorRef,
      hori,
      vert,
      ppemX,
      ppemY,
      bitDepth,
      startGlyphIndex,
      endGlyphIndex,
      flags,
    })
  }

  return sizes
}

/**
 * Parses the IndexSubTableArray and returns the data offset and size for the given glyph ID
 */
export function findGlyphBitmapOffset(
  reader: BinaryReader,
  size: BitmapSizeRecord,
  glyphId: number,
): BitmapGlyphLocation | null {
  if (glyphId < size.startGlyphIndex || glyphId > size.endGlyphIndex) return null
  const arrayOffset = size.indexSubTableArrayOffset
  const listEnd = arrayOffset + size.indexTablesSize
  reader.seek(arrayOffset)

  // Read IndexSubTable headers
  const headers: IndexSubTableHeader[] = []
  let previousLast = -1
  for (let i = 0; i < size.numberOfIndexSubTables; i++) {
    const firstGlyphIndex = reader.readUint16()
    const lastGlyphIndex = reader.readUint16()
    const additionalOffsetToIndexSubtable = reader.readUint32()
    if (firstGlyphIndex > lastGlyphIndex) throw new Error('bitmap index subtable glyph range is reversed')
    if (firstGlyphIndex < size.startGlyphIndex || lastGlyphIndex > size.endGlyphIndex) {
      throw new Error('bitmap index subtable glyph range exceeds its strike')
    }
    if (firstGlyphIndex <= previousLast) throw new Error('bitmap index subtable ranges must be sorted and non-overlapping')
    if ((additionalOffsetToIndexSubtable & 3) !== 0) throw new Error('bitmap index subtable must be 4-byte aligned')
    if (additionalOffsetToIndexSubtable < size.numberOfIndexSubTables * 8
      || additionalOffsetToIndexSubtable > size.indexTablesSize - 8) {
      throw new Error('bitmap index subtable offset exceeds its list')
    }
    headers.push({ firstGlyphIndex, lastGlyphIndex, additionalOffsetToIndexSubtable })
    previousLast = lastGlyphIndex
  }

  // Find the subtable covering this glyphId
  for (const header of headers) {
    if (glyphId < header.firstGlyphIndex || glyphId > header.lastGlyphIndex) continue

    const subtableOffset = arrayOffset + header.additionalOffsetToIndexSubtable
    reader.seek(subtableOffset)
    const indexFormat = reader.readUint16()
    const imageFormat = reader.readUint16()
    const imageDataOffset = reader.readUint32()

    const glyphIndex = glyphId - header.firstGlyphIndex
    const glyphCount = header.lastGlyphIndex - header.firstGlyphIndex + 1

    if (indexFormat === 1) {
      // Format 1: variable-size, array of uint32 offsets
      if (subtableOffset + 8 + (glyphCount + 1) * 4 > listEnd) throw new Error('bitmap index format 1 offsets are truncated')
      reader.seek(subtableOffset + 8 + glyphIndex * 4)
      const offset1 = reader.readUint32()
      const offset2 = reader.readUint32()
      if (offset2 < offset1) throw new Error('bitmap index format 1 offsets are decreasing')
      return {
        indexFormat,
        imageFormat,
        imageDataOffset: imageDataOffset + offset1,
        imageDataSize: offset2 - offset1,
        metrics: null,
      }
    } else if (indexFormat === 2) {
      // Format 2: all images same size
      if (subtableOffset + 20 > listEnd) throw new Error('bitmap index format 2 is truncated')
      const imageSize = reader.readUint32()
      const metrics = readBigGlyphMetrics(reader)
      return {
        indexFormat,
        imageFormat,
        imageDataOffset: imageDataOffset + glyphIndex * imageSize,
        imageDataSize: imageSize,
        metrics,
      }
    } else if (indexFormat === 3) {
      // Format 3: variable-size, array of uint16 offsets
      if (subtableOffset + 8 + (glyphCount + 1) * 2 > listEnd) throw new Error('bitmap index format 3 offsets are truncated')
      reader.seek(subtableOffset + 8 + glyphIndex * 2)
      const offset1 = reader.readUint16()
      const offset2 = reader.readUint16()
      if (offset2 < offset1) throw new Error('bitmap index format 3 offsets are decreasing')
      return {
        indexFormat,
        imageFormat,
        imageDataOffset: imageDataOffset + offset1,
        imageDataSize: offset2 - offset1,
        metrics: null,
      }
    } else if (indexFormat === 4) {
      // Format 4: sparse, numGlyphs pairs of (glyphId, offset)
      if (subtableOffset + 12 > listEnd) throw new Error('bitmap index format 4 is truncated')
      const numGlyphs = reader.readUint32()
      if (numGlyphs > Math.floor((listEnd - reader.position) / 4) - 1) throw new Error('bitmap index format 4 glyph array is truncated')
      let previousGlyph = -1
      let previousOffset = -1
      let foundOffset = -1
      let foundEnd = -1
      for (let i = 0; i < numGlyphs + 1; i++) {
        const gid = reader.readUint16()
        const sbitOffset = reader.readUint16()
        if (i < numGlyphs && (gid <= previousGlyph || gid < header.firstGlyphIndex || gid > header.lastGlyphIndex)) {
          throw new Error('bitmap index format 4 glyph IDs must be sorted within the subtable range')
        }
        if (sbitOffset < previousOffset) throw new Error('bitmap index format 4 offsets are decreasing')
        if (foundOffset >= 0 && foundEnd < 0) foundEnd = sbitOffset
        if (i < numGlyphs && gid === glyphId) foundOffset = sbitOffset
        previousGlyph = gid
        previousOffset = sbitOffset
      }
      if (foundOffset >= 0) return {
        indexFormat,
        imageFormat,
        imageDataOffset: imageDataOffset + foundOffset,
        imageDataSize: foundEnd - foundOffset,
        metrics: null,
      }
      return null
    } else if (indexFormat === 5) {
      // Format 5: constant size, sparse
      if (subtableOffset + 24 > listEnd) throw new Error('bitmap index format 5 is truncated')
      const imageSize = reader.readUint32()
      const metrics = readBigGlyphMetrics(reader)
      const numGlyphs = reader.readUint32()
      if (numGlyphs > Math.floor((listEnd - reader.position) / 2)) throw new Error('bitmap index format 5 glyph array is truncated')
      let previousGlyph = -1
      for (let i = 0; i < numGlyphs; i++) {
        const gid = reader.readUint16()
        if (gid <= previousGlyph || gid < header.firstGlyphIndex || gid > header.lastGlyphIndex) {
          throw new Error('bitmap index format 5 glyph IDs must be sorted within the subtable range')
        }
        previousGlyph = gid
        if (gid === glyphId) {
          return {
            indexFormat,
            imageFormat,
            imageDataOffset: imageDataOffset + i * imageSize,
            imageDataSize: imageSize,
            metrics,
          }
        }
      }
      return null
    } else {
      throw new Error(`Unsupported bitmap index subtable format ${indexFormat}`)
    }
  }

  return null
}

function readSbitLineMetrics(reader: BinaryReader): SbitLineMetrics {
  const ascender = reader.readInt8()
  const descender = reader.readInt8()
  const widthMax = reader.readUint8()
  const caretSlopeNumerator = reader.readInt8()
  const caretSlopeDenominator = reader.readInt8()
  const caretOffset = reader.readInt8()
  const minOriginSB = reader.readInt8()
  const minAdvanceSB = reader.readInt8()
  const maxBeforeBL = reader.readInt8()
  const minAfterBL = reader.readInt8()
  reader.skip(2)
  return {
    ascender,
    descender,
    widthMax,
    caretSlopeNumerator,
    caretSlopeDenominator,
    caretOffset,
    minOriginSB,
    minAdvanceSB,
    maxBeforeBL,
    minAfterBL,
  }
}

/**
 * SmallGlyphMetrics (5 bytes)
 */
export function readSmallGlyphMetrics(reader: BinaryReader): BitmapMetrics {
  const height = reader.readUint8()
  const width = reader.readUint8()
  const horiBearingX = reader.readInt8()
  const horiBearingY = reader.readInt8()
  const horiAdvance = reader.readUint8()
  return {
    height, width,
    horiBearingX, horiBearingY, horiAdvance,
    vertBearingX: 0, vertBearingY: 0, vertAdvance: 0,
  }
}

/**
 * BigGlyphMetrics (8 bytes)
 */
export function readBigGlyphMetrics(reader: BinaryReader): BitmapMetrics {
  const height = reader.readUint8()
  const width = reader.readUint8()
  const horiBearingX = reader.readInt8()
  const horiBearingY = reader.readInt8()
  const horiAdvance = reader.readUint8()
  const vertBearingX = reader.readInt8()
  const vertBearingY = reader.readInt8()
  const vertAdvance = reader.readUint8()
  return { height, width, horiBearingX, horiBearingY, horiAdvance, vertBearingX, vertBearingY, vertAdvance }
}
