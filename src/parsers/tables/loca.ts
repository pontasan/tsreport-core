import { BinaryReader } from '../../binary/reader.js'
import type { LocaTable } from '../../types/index.js'

/**
 * Parse the loca table
 * indexToLocFormat: 0 = short (Uint16, offset/2), 1 = long (Uint32)
 */
export function parseLoca(reader: BinaryReader, numGlyphs: number, indexToLocFormat: number): LocaTable {
  if (numGlyphs <= 0) {
    throw new Error(`loca numGlyphs must be greater than 0, got ${numGlyphs}`)
  }
  if (indexToLocFormat !== 0 && indexToLocFormat !== 1) {
    throw new Error(`loca indexToLocFormat must be 0 or 1, got ${indexToLocFormat}`)
  }
  // The loca table has numGlyphs+1 entries
  const count = numGlyphs + 1
  const expectedLength = count * (indexToLocFormat === 0 ? 2 : 4)
  if (reader.length !== expectedLength) {
    throw new Error(`loca table length must be ${expectedLength}, got ${reader.length}`)
  }
  let offsets: Uint32Array

  if (indexToLocFormat === 0) {
    // Short format: Uint16; the actual offset is the value * 2
    offsets = new Uint32Array(count)
    for (let i = 0; i < count; i++) {
      offsets[i] = reader.readUint16() * 2
    }
  } else {
    // Long format: Uint32
    offsets = reader.readUint32Array(count)
  }
  for (let i = 1; i < count; i++) {
    if (offsets[i]! < offsets[i - 1]!) {
      throw new Error(`loca offset ${i} is smaller than the previous offset`)
    }
  }

  return {
    numGlyphs,
    getOffset(glyphId: number): number {
      if (glyphId < 0 || glyphId > numGlyphs) return 0
      return offsets[glyphId]!
    },
    getLength(glyphId: number): number {
      if (glyphId < 0 || glyphId >= numGlyphs) return 0
      return offsets[glyphId + 1]! - offsets[glyphId]!
    },
  }
}
