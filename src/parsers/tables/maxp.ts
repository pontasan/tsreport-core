import { BinaryReader } from '../../binary/reader.js'
import type { MaxpTable } from '../../types/index.js'

/**
 * Parse the maxp table
 */
export function parseMaxp(reader: BinaryReader): MaxpTable {
  if (reader.length < 6) throw new Error(`maxp table length must be at least 6, got ${reader.length}`)
  const rawVersion = reader.readUint32()
  const majorVersion = rawVersion >>> 16
  const minorVersion = rawVersion & 0xFFFF
  let version: number
  if (majorVersion === 0 && minorVersion >= 0x5000) {
    version = 0.5
    if (minorVersion === 0x5000 && reader.length !== 6) {
      throw new Error(`maxp version 0.5 table length must be 6, got ${reader.length}`)
    }
  } else if (majorVersion === 1) {
    version = 1.0
    if (reader.length < 32 || (minorVersion === 0 && reader.length !== 32)) {
      throw new Error(`maxp version 1.0 table length must be 32, got ${reader.length}`)
    }
  } else {
    throw new Error(`Unsupported maxp version: 0x${rawVersion.toString(16).padStart(8, '0')}`)
  }
  const numGlyphs = reader.readUint16()
  if (numGlyphs === 0) {
    throw new Error('maxp numGlyphs must be greater than 0')
  }

  if (version === 1.0) {
    const maxPoints = reader.readUint16()
    const maxContours = reader.readUint16()
    const maxCompositePoints = reader.readUint16()
    const maxCompositeContours = reader.readUint16()
    const maxZones = reader.readUint16()
    const maxTwilightPoints = reader.readUint16()
    const maxStorage = reader.readUint16()
    const maxFunctionDefs = reader.readUint16()
    const maxInstructionDefs = reader.readUint16()
    const maxStackElements = reader.readUint16()
    const maxSizeOfInstructions = reader.readUint16()
    const maxComponentElements = reader.readUint16()
    const maxComponentDepth = reader.readUint16()

    return {
      version,
      numGlyphs,
      maxPoints,
      maxContours,
      maxCompositePoints,
      maxCompositeContours,
      maxZones,
      maxTwilightPoints,
      maxStorage,
      maxFunctionDefs,
      maxInstructionDefs,
      maxStackElements,
      maxSizeOfInstructions,
      maxComponentElements,
      maxComponentDepth,
    }
  }

  return { version, numGlyphs }
}
