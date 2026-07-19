import { BinaryReader } from '../../binary/reader.js'

const VORG_HEADER_SIZE = 8
const VORG_METRIC_SIZE = 4
const VORG_MAJOR_VERSION = 1
const VORG_MINOR_VERSION = 0

/**
 * VORG table: Vertical Origin (for CFF fonts)
 * Provides the vertical origin y coordinate for CFF fonts
 */
export interface VorgTable {
  readonly defaultVertOriginY: number
  getVertOriginY(glyphId: number): number
}

export function parseVorg(reader: BinaryReader, numGlyphs?: number): VorgTable {
  if (reader.length < VORG_HEADER_SIZE) {
    throw new Error(`VORG table length must be at least ${VORG_HEADER_SIZE}, got ${reader.length}`)
  }
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== VORG_MAJOR_VERSION) {
    throw new Error(`Unsupported VORG version: ${majorVersion}.${minorVersion}`)
  }
  const defaultVertOriginY = reader.readInt16()
  const numVertOriginYMetrics = reader.readUint16()
  if (numGlyphs !== undefined && (numGlyphs <= 0 || numGlyphs > 0xFFFF + 1)) {
    throw new Error(`VORG numGlyphs must be in the range 1..65536, got ${numGlyphs}`)
  }
  const expectedLength = VORG_HEADER_SIZE + numVertOriginYMetrics * VORG_METRIC_SIZE
  if (reader.length !== expectedLength) {
    throw new Error(`VORG table length must be ${expectedLength}, got ${reader.length}`)
  }

  const vertOrigins = new Map<number, number>()
  let previousGlyphIndex = -1
  for (let i = 0; i < numVertOriginYMetrics; i++) {
    const glyphIndex = reader.readUint16()
    const vertOriginY = reader.readInt16()
    if (numGlyphs !== undefined && glyphIndex >= numGlyphs) {
      throw new Error(`VORG glyphIndex ${glyphIndex} exceeds numGlyphs ${numGlyphs}`)
    }
    if (glyphIndex <= previousGlyphIndex) {
      throw new Error(`VORG glyphIndex values must be strictly increasing, got ${glyphIndex} after ${previousGlyphIndex}`)
    }
    previousGlyphIndex = glyphIndex
    vertOrigins.set(glyphIndex, vertOriginY)
  }

  return {
    defaultVertOriginY,
    getVertOriginY(glyphId: number): number {
      return vertOrigins.get(glyphId) ?? defaultVertOriginY
    },
  }
}
