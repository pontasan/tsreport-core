import { BinaryReader } from '../../binary/reader.js'

const LTSH_HEADER_SIZE = 4

/**
 * LTSH table: Linear Threshold
 * Indicates, for each glyph, the PPEM at which linear scaling becomes possible
 */
export interface LtshTable {
  /** Get the linear threshold (PPEM) for a glyph ID */
  getLinearThreshold(glyphId: number): number
}

/**
 * Parse the LTSH table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/ltsh
 */
export function parseLtsh(reader: BinaryReader, expectedNumGlyphs?: number): LtshTable {
  if (reader.length < LTSH_HEADER_SIZE) {
    throw new Error(`LTSH table length must be at least ${LTSH_HEADER_SIZE}, got ${reader.length}`)
  }

  const version = reader.readUint16()
  const numGlyphs = reader.readUint16()
  if (expectedNumGlyphs !== undefined && numGlyphs !== expectedNumGlyphs) {
    throw new Error(`LTSH numGlyphs mismatch: expected ${expectedNumGlyphs}, got ${numGlyphs}`)
  }
  const expectedLength = LTSH_HEADER_SIZE + numGlyphs
  if (reader.length < expectedLength || (version === 0 && reader.length !== expectedLength)) {
    throw new Error(`LTSH table length mismatch: expected ${version === 0 ? '' : 'at least '}${expectedLength}, got ${reader.length}`)
  }

  const yPels = reader.readBytes(numGlyphs)

  return {
    getLinearThreshold(glyphId: number): number {
      if (glyphId < 0 || glyphId >= numGlyphs) return 0
      return yPels[glyphId]!
    },
  }
}
