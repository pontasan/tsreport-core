/**
 * MQ arithmetic decoder (ISO/IEC 15444-1 Annex C; shared with ITU-T T.88).
 * Used by the JPEG 2000 EBCOT Tier-1 coder and the JBIG2 decoder.
 */

/** Qe table: [Qe, NMPS, NLPS, SWITCH] (ISO 15444-1 Table C.2). */
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
]

/** One adaptive context: index into the Qe table plus the MPS sense. */
export interface MqContext {
  index: number
  mps: number
}

export function newMqContext(index = 0): MqContext {
  return { index, mps: 0 }
}

export class MqDecoder {
  private data: Uint8Array
  private bp: number
  private end: number
  private c = 0
  private a = 0
  private ct = 0
  private syntheticFillUsed = false

  constructor(data: Uint8Array, start = 0, end = data.length) {
    this.data = data
    this.bp = start
    this.end = end
    // INITDEC
    const b0 = this.byteIn0()
    this.c = b0 << 16
    this.byteIn()
    this.c <<= 7
    this.ct -= 7
    this.a = 0x8000
  }

  private byteIn0(): number {
    if (this.bp < this.end) return this.data[this.bp]!
    this.syntheticFillUsed = true
    return 0xFF
  }

  private byteIn(): void {
    const b = this.bp < this.end ? this.data[this.bp]! : 0xFF
    if (b === 0xFF) {
      let b1: number
      if (this.bp + 1 < this.end) b1 = this.data[this.bp + 1]!
      else { b1 = 0xFF; this.syntheticFillUsed = true }
      if (b1 > 0x8F) {
        this.c += 0xFF00
        this.ct = 8
      } else {
        this.bp++
        this.c += b1 << 9
        this.ct = 7
      }
    } else {
      this.bp++
      let next: number
      if (this.bp < this.end) next = this.data[this.bp]!
      else { next = 0xFF; this.syntheticFillUsed = true }
      this.c += next << 8
      this.ct = 8
    }
  }

  /** Decode one binary decision in the given context. */
  decode(cx: MqContext): number {
    const q = QE[cx.index]!
    const qe = q[0]!
    this.a -= qe
    let d: number
    if (((this.c >>> 16) & 0xFFFF) < qe) {
      // LPS exchange or MPS exchange on the lower interval
      if (this.a < qe) {
        d = cx.mps
        cx.index = q[1]!
      } else {
        d = 1 - cx.mps
        if (q[3]! === 1) cx.mps = 1 - cx.mps
        cx.index = q[2]!
      }
      this.a = qe
      // RENORMD
      do {
        if (this.ct === 0) this.byteIn()
        this.a <<= 1
        this.c = (this.c << 1) & 0xFFFFFFFF
        this.ct--
      } while (this.a < 0x8000)
      this.a &= 0xFFFF
    } else {
      this.c = (this.c - (qe << 16)) & 0xFFFFFFFF
      if ((this.a & 0x8000) === 0) {
        if (this.a < qe) {
          d = 1 - cx.mps
          if (q[3]! === 1) cx.mps = 1 - cx.mps
          cx.index = q[2]!
        } else {
          d = cx.mps
          cx.index = q[1]!
        }
        do {
          if (this.ct === 0) this.byteIn()
          this.a <<= 1
          this.c = (this.c << 1) & 0xFFFFFFFF
          this.ct--
        } while (this.a < 0x8000)
        this.a &= 0xFFFF
      } else {
        d = cx.mps
      }
    }
    return d
  }

  /** Validates the decoder terminal state for JPEG 2000 predictable termination. */
  predictableTerminationSatisfied(): boolean {
    // This decoder eagerly peeks one byte during renormalization. Reaching the
    // exact declared end is therefore valid even when that peek synthesized
    // the Annex C end fill; stopping before the end still requires a 0xFF
    // marker prefix and no earlier synthetic fill.
    if (this.bp === this.end) return true
    return !this.syntheticFillUsed && this.end > 0 && this.bp + 1 === this.end && this.data[this.bp] === 0xff
  }
}
