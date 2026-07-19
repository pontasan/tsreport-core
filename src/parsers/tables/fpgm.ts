import { BinaryReader } from '../../binary/reader.js'

/**
 * fpgm (Font Program): font program bytecode
 * Initialization program executed once at font load time
 * Contains function definitions (FDEF/ENDF)
 */
export interface FpgmTable {
  readonly bytecode: Uint8Array
}

export function parseFpgm(reader: BinaryReader): FpgmTable {
  const bytecode = reader.readBytes(reader.length)
  return { bytecode }
}
