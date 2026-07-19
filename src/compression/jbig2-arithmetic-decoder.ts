import type { MqContext } from './mq-decoder.js'

const QE = [
  [0x5601, 1, 1, 1], [0x3401, 2, 6, 0], [0x1801, 3, 9, 0], [0x0AC1, 4, 12, 0],
  [0x0521, 5, 29, 0], [0x0221, 38, 33, 0], [0x5601, 7, 6, 1], [0x5401, 8, 14, 0],
  [0x4801, 9, 14, 0], [0x3801, 10, 14, 0], [0x3001, 11, 17, 0], [0x2401, 12, 18, 0],
  [0x1C01, 13, 20, 0], [0x1601, 29, 21, 0], [0x5601, 15, 14, 1], [0x5401, 16, 14, 0],
  [0x5101, 17, 15, 0], [0x4801, 18, 16, 0], [0x3801, 19, 17, 0], [0x3401, 20, 18, 0],
  [0x3001, 21, 19, 0], [0x2801, 22, 19, 0], [0x2401, 23, 20, 0], [0x2201, 24, 21, 0],
  [0x1C01, 25, 22, 0], [0x1801, 26, 23, 0], [0x1601, 27, 24, 0], [0x1401, 28, 25, 0],
  [0x1201, 29, 26, 0], [0x1101, 30, 27, 0], [0x0AC1, 31, 28, 0], [0x09C1, 32, 29, 0],
  [0x08A1, 33, 30, 0], [0x0521, 34, 31, 0], [0x0441, 35, 32, 0], [0x02A1, 36, 33, 0],
  [0x0221, 37, 34, 0], [0x0141, 38, 35, 0], [0x0111, 39, 36, 0], [0x0085, 40, 37, 0],
  [0x0049, 41, 38, 0], [0x0025, 42, 39, 0], [0x0015, 43, 40, 0], [0x0009, 44, 41, 0],
  [0x0005, 45, 42, 0], [0x0001, 45, 43, 0], [0x5601, 46, 46, 0],
] as const

/** ITU-T T.88 Annex E arithmetic decoder using the software convention. */
export class Jbig2ArithmeticDecoder {
  private readonly data: Uint8Array
  private readonly end: number
  private position: number
  private currentByte: number
  private c: number
  private a = 0x8000
  private ct = 0

  constructor(data: Uint8Array, start = 0, end = data.length) {
    if (start >= end) throw new Error('JBIG2 error: empty arithmetic-coded data')
    this.data = data
    this.position = start
    this.end = end
    this.currentByte = data[start]!
    this.c = ((~this.currentByte) & 0xFF) << 16
    this.byteIn()
    this.c = (this.c << 7) >>> 0
    this.ct -= 7
  }

  private byteIn(): void {
    if (this.currentByte === 0xFF) {
      const next = this.position + 1 < this.end ? this.data[this.position + 1]! : 0x90
      if (next > 0x8F) {
        this.c = (this.c + 0xFF00) >>> 0
        this.ct = 8
      } else {
        this.position++
        this.currentByte = next
        this.c = (this.c + 0xFE00 - (next << 9)) >>> 0
        this.ct = 7
      }
    } else {
      this.position++
      this.currentByte = this.position < this.end ? this.data[this.position]! : 0xFF
      this.c = (this.c + 0xFF00 - (this.currentByte << 8)) >>> 0
      this.ct = 8
    }
  }

  private renormalize(): void {
    do {
      if (this.ct === 0) this.byteIn()
      this.a = (this.a << 1) & 0xFFFF
      this.c = (this.c << 1) >>> 0
      this.ct--
    } while ((this.a & 0x8000) === 0)
  }

  decode(context: MqContext): number {
    const state = QE[context.index]
    if (state === undefined) throw new Error(`JBIG2 error: arithmetic context index ${context.index} is out of range`)
    const qe = state[0]
    this.a -= qe
    let decision: number
    if ((this.c >>> 16) < this.a) {
      if ((this.a & 0x8000) !== 0) return context.mps
      if (this.a < qe) {
        decision = 1 - context.mps
        if (state[3] !== 0) context.mps = 1 - context.mps
        context.index = state[2]
      } else {
        decision = context.mps
        context.index = state[1]
      }
      this.renormalize()
      return decision
    }
    const reducedA = this.a
    this.c = (this.c - (reducedA << 16)) >>> 0
    this.a = qe
    if (reducedA < qe) {
      decision = context.mps
      context.index = state[1]
    } else {
      decision = 1 - context.mps
      if (state[3] !== 0) context.mps = 1 - context.mps
      context.index = state[2]
    }
    this.renormalize()
    return decision
  }
}
