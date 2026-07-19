import { BinaryReader } from '../../binary/reader.js'

/**
 * prep (Control Value Program): CVT program bytecode
 * Program executed whenever the size changes
 * Performs size-dependent adjustment of CVT values
 */
export interface PrepTable {
  readonly bytecode: Uint8Array
}

export function parsePrep(reader: BinaryReader): PrepTable {
  const bytecode = reader.readBytes(reader.length)
  return { bytecode }
}
