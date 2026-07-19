import { BinaryReader } from '../../binary/reader.js'
import type { HheaTable } from '../../types/index.js'

/**
 * Parse the hhea table
 */
export function parseHhea(reader: BinaryReader): HheaTable {
  if (reader.length < 36) {
    throw new Error(`hhea table length must be at least 36, got ${reader.length}`)
  }
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    throw new Error(`Unsupported hhea version: ${majorVersion}.${minorVersion}`)
  }
  if (minorVersion === 0 && reader.length !== 36) {
    throw new Error(`hhea table version 1.0 length must be 36, got ${reader.length}`)
  }
  const ascender = reader.readInt16()
  const descender = reader.readInt16()
  const lineGap = reader.readInt16()
  const advanceWidthMax = reader.readUint16()
  const minLeftSideBearing = reader.readInt16()
  const minRightSideBearing = reader.readInt16()
  const xMaxExtent = reader.readInt16()
  const caretSlopeRise = reader.readInt16()
  const caretSlopeRun = reader.readInt16()
  const caretOffset = reader.readInt16()
  for (let i = 0; i < 4; i++) {
    const reserved = reader.readInt16()
    if (minorVersion === 0 && reserved !== 0) {
      throw new Error(`hhea reserved field ${i} must be 0, got ${reserved}`)
    }
  }
  const metricDataFormat = reader.readInt16()
  if (minorVersion === 0 && metricDataFormat !== 0) {
    throw new Error(`hhea metricDataFormat must be 0, got ${metricDataFormat}`)
  }
  const numberOfHMetrics = reader.readUint16()
  if (numberOfHMetrics === 0) {
    throw new Error('hhea numberOfHMetrics must be greater than 0')
  }

  return {
    majorVersion,
    minorVersion,
    ascender,
    descender,
    lineGap,
    advanceWidthMax,
    minLeftSideBearing,
    minRightSideBearing,
    xMaxExtent,
    caretSlopeRise,
    caretSlopeRun,
    caretOffset,
    metricDataFormat,
    numberOfHMetrics,
  }
}
