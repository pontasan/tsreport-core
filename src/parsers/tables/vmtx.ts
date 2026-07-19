import { BinaryReader } from '../../binary/reader.js'

/**
 * vmtx table: vertical metrics data
 * Same structure as hmtx (advanceHeight, topSideBearing)
 */
export interface VmtxTable {
  getAdvanceHeight(glyphId: number): number
  getTopSideBearing(glyphId: number): number
}

export function parseVmtx(reader: BinaryReader, numberOfVMetrics: number, numGlyphs: number): VmtxTable {
  if (numGlyphs <= 0) {
    throw new Error(`vmtx numGlyphs must be greater than 0, got ${numGlyphs}`)
  }
  if (numberOfVMetrics <= 0 || numberOfVMetrics > numGlyphs) {
    throw new Error(`vmtx numberOfVMetrics must be in the range 1..${numGlyphs}, got ${numberOfVMetrics}`)
  }
  const expectedLength = numberOfVMetrics * 4 + (numGlyphs - numberOfVMetrics) * 2
  if (reader.length !== expectedLength) {
    throw new Error(`vmtx table length must be ${expectedLength}, got ${reader.length}`)
  }
  const advanceHeights = new Uint16Array(numGlyphs)
  const topSideBearings = new Int16Array(numGlyphs)

  let lastAdvanceHeight = 0
  for (let i = 0; i < numberOfVMetrics; i++) {
    lastAdvanceHeight = reader.readUint16()
    advanceHeights[i] = lastAdvanceHeight
    topSideBearings[i] = reader.readInt16()
  }

  for (let i = numberOfVMetrics; i < numGlyphs; i++) {
    advanceHeights[i] = lastAdvanceHeight
    topSideBearings[i] = reader.readInt16()
  }

  return {
    getAdvanceHeight(glyphId: number): number {
      if (glyphId < 0 || glyphId >= numGlyphs) return 0
      return advanceHeights[glyphId]!
    },
    getTopSideBearing(glyphId: number): number {
      if (glyphId < 0 || glyphId >= numGlyphs) return 0
      return topSideBearings[glyphId]!
    },
  }
}
