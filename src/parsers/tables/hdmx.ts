import { BinaryReader } from '../../binary/reader.js'

const HDMX_HEADER_SIZE = 8
const HDMX_RECORD_PREFIX_SIZE = 2

/**
 * hdmx table: Horizontal Device Metrics
 * Provides the pixel width of each glyph at each PPEM
 */
export interface HdmxTable {
  /** List of available PPEM values */
  readonly availablePpems: readonly number[]
  /** Get the pixel width for the given PPEM and glyph ID; null if not found */
  getWidth(ppem: number, glyphId: number): number | null
}

/**
 * Parse the hdmx table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/hdmx
 * @param numGlyphs glyph count from the maxp table
 */
export function parseHdmx(reader: BinaryReader, numGlyphs: number): HdmxTable {
  if (numGlyphs <= 0) {
    throw new Error(`hdmx numGlyphs must be greater than zero, got ${numGlyphs}`)
  }
  if (reader.length < HDMX_HEADER_SIZE) {
    throw new Error(`hdmx table length must be at least ${HDMX_HEADER_SIZE}, got ${reader.length}`)
  }

  const version = reader.readUint16()
  const numRecords = reader.readUint16()
  const sizeDeviceRecord = reader.readUint32()
  const minRecordSize = HDMX_RECORD_PREFIX_SIZE + numGlyphs
  if (sizeDeviceRecord < minRecordSize) {
    throw new Error(`hdmx device record size must be at least ${minRecordSize}, got ${sizeDeviceRecord}`)
  }
  if ((sizeDeviceRecord & 3) !== 0) {
    throw new Error(`hdmx device record size must be 32-bit aligned, got ${sizeDeviceRecord}`)
  }
  const expectedLength = HDMX_HEADER_SIZE + numRecords * sizeDeviceRecord
  if (reader.length < expectedLength || (version === 0 && reader.length !== expectedLength)) {
    throw new Error(`hdmx table length mismatch: expected ${version === 0 ? '' : 'at least '}${expectedLength}, got ${reader.length}`)
  }

  // ppem → widths array
  const records = new Map<number, Uint8Array>()
  const availablePpems: number[] = []
  let previousPixelSize = -1

  for (let i = 0; i < numRecords; i++) {
    const recordStart = reader.position
    const pixelSize = reader.readUint8()
    const maxWidth = reader.readUint8()
    const widths = reader.readBytes(numGlyphs)
    if (pixelSize <= previousPixelSize) {
      throw new Error(`hdmx records must be sorted by increasing pixelSize at index ${i}`)
    }
    let actualMaxWidth = 0
    for (let g = 0; g < widths.length; g++) {
      if (widths[g]! > actualMaxWidth) actualMaxWidth = widths[g]!
    }
    if (maxWidth !== actualMaxWidth) {
      throw new Error(`hdmx record ${i} maxWidth mismatch: expected ${actualMaxWidth}, got ${maxWidth}`)
    }

    availablePpems.push(pixelSize)
    records.set(pixelSize, widths)
    previousPixelSize = pixelSize

    // sizeDeviceRecord may include padding
    reader.seek(recordStart + sizeDeviceRecord)
  }

  return {
    availablePpems,
    getWidth(ppem: number, glyphId: number): number | null {
      const widths = records.get(ppem)
      if (!widths || glyphId < 0 || glyphId >= numGlyphs) return null
      return widths[glyphId]!
    },
  }
}
