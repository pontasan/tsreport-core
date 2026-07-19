import { BinaryReader } from '../../binary/reader.js'

/**
 * vhea table: Vertical Header metrics
 * Same structure as hhea (vertical direction)
 */
export interface VheaTable {
  readonly majorVersion: number
  readonly minorVersion: number
  readonly ascender: number
  readonly descender: number
  readonly lineGap: number
  readonly advanceHeightMax: number
  readonly minTopSideBearing: number
  readonly minBottomSideBearing: number
  readonly yMaxExtent: number
  readonly caretSlopeRise: number
  readonly caretSlopeRun: number
  readonly caretOffset: number
  readonly metricDataFormat: number
  readonly numberOfVMetrics: number
}

export function parseVhea(reader: BinaryReader): VheaTable {
  if (reader.length < 36) throw new Error(`vhea table length must be at least 36, got ${reader.length}`)
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  // Version 1.1 has the same layout as 1.0 (only a field-name clarification) and
  // shipping fonts encode its minor part as either 0x1000 (Fixed 1.1) or 0x0001
  // (e.g. AppleGothic), so any 1.x version is accepted.
  if (majorVersion !== 1) {
    throw new Error(`Unsupported vhea version: ${majorVersion}.${minorVersion}`)
  }
  if ((minorVersion === 0 || minorVersion === 1 || minorVersion === 0x1000) && reader.length !== 36) {
    throw new Error(`vhea table length must be 36 for a known version, got ${reader.length}`)
  }
  const ascender = reader.readInt16()
  const descender = reader.readInt16()
  const lineGap = reader.readInt16()
  const advanceHeightMax = reader.readUint16()
  const minTopSideBearing = reader.readInt16()
  const minBottomSideBearing = reader.readInt16()
  const yMaxExtent = reader.readInt16()
  const caretSlopeRise = reader.readInt16()
  const caretSlopeRun = reader.readInt16()
  const caretOffset = reader.readInt16()
  for (let i = 0; i < 4; i++) {
    const reserved = reader.readInt16()
    if ((minorVersion === 0 || minorVersion === 1 || minorVersion === 0x1000) && reserved !== 0) {
      throw new Error(`vhea reserved field ${i} must be 0, got ${reserved}`)
    }
  }
  const metricDataFormat = reader.readInt16()
  if ((minorVersion === 0 || minorVersion === 1 || minorVersion === 0x1000) && metricDataFormat !== 0) {
    throw new Error(`vhea metricDataFormat must be 0, got ${metricDataFormat}`)
  }
  const numberOfVMetrics = reader.readUint16()
  if (numberOfVMetrics === 0) {
    throw new Error('vhea numberOfVMetrics must be greater than 0')
  }

  return {
    majorVersion, minorVersion,
    ascender, descender, lineGap,
    advanceHeightMax,
    minTopSideBearing, minBottomSideBearing,
    yMaxExtent,
    caretSlopeRise, caretSlopeRun, caretOffset,
    metricDataFormat, numberOfVMetrics,
  }
}
