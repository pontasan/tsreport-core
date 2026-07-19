import { BinaryReader } from '../../binary/reader.js'

/**
 * cvt (Control Value Table): array of FWord (int16)
 * Control values referenced by hinting programs
 */
export interface CvtTable {
  readonly values: Int16Array
  get(index: number): number
  set(index: number, value: number): void
  readonly length: number
}

export function parseCvt(reader: BinaryReader): CvtTable {
  const count = reader.length >> 1 // Int16 = 2 bytes each
  const values = new Int16Array(count)
  for (let i = 0; i < count; i++) {
    values[i] = reader.readInt16()
  }

  return {
    values,
    get length() { return count },
    get(index: number): number {
      return index >= 0 && index < count ? values[index]! : 0
    },
    set(index: number, value: number): void {
      if (index >= 0 && index < count) {
        values[index] = value
      }
    },
  }
}
