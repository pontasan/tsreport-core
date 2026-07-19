import { BinaryReader } from '../../binary/reader.js'
import type { HmtxTable } from '../../types/index.js'

/**
 * Parse the hmtx table
 */
export function parseHmtx(reader: BinaryReader, numberOfHMetrics: number, numGlyphs: number): HmtxTable {
  if (numGlyphs <= 0) {
    throw new Error(`hmtx numGlyphs must be greater than 0, got ${numGlyphs}`)
  }
  if (numberOfHMetrics <= 0 || numberOfHMetrics > numGlyphs) {
    throw new Error(`hmtx numberOfHMetrics must be in the range 1..${numGlyphs}, got ${numberOfHMetrics}`)
  }
  const expectedLength = numberOfHMetrics * 4 + (numGlyphs - numberOfHMetrics) * 2
  if (reader.length !== expectedLength) {
    throw new Error(`hmtx table length must be ${expectedLength}, got ${reader.length}`)
  }

  const advanceWidths = new Uint16Array(numGlyphs)
  const leftSideBearings = new Int16Array(numGlyphs)

  let lastAdvanceWidth = 0
  for (let i = 0; i < numberOfHMetrics; i++) {
    lastAdvanceWidth = reader.readUint16()
    advanceWidths[i] = lastAdvanceWidth
    leftSideBearings[i] = reader.readInt16()
  }

  for (let i = numberOfHMetrics; i < numGlyphs; i++) {
    advanceWidths[i] = lastAdvanceWidth
    leftSideBearings[i] = reader.readInt16()
  }

  return {
    numberOfHMetrics,
    numGlyphs,
    advanceWidths,
    leftSideBearings,
    getAdvanceWidth(glyphId: number): number {
      if (glyphId < 0 || glyphId >= numGlyphs) return 0
      return advanceWidths[glyphId]!
    },
    getLsb(glyphId: number): number {
      if (glyphId < 0 || glyphId >= numGlyphs) return 0
      return leftSideBearings[glyphId]!
    },
  }
}
