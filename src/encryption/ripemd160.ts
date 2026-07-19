/** RIPEMD-160 as specified by ISO/IEC 10118-3. */

const LEFT_INDEX = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
]

const RIGHT_INDEX = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
]

const LEFT_SHIFT = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
]

const RIGHT_SHIFT = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
]

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function roundFunction(round: number, x: number, y: number, z: number): number {
  if (round === 0) return (x ^ y ^ z) >>> 0
  if (round === 1) return ((x & y) | (~x & z)) >>> 0
  if (round === 2) return ((x | ~y) ^ z) >>> 0
  if (round === 3) return ((x & z) | (y & ~z)) >>> 0
  return (x ^ (y | ~z)) >>> 0
}

function leftConstant(round: number): number {
  return round === 0 ? 0x00000000
    : round === 1 ? 0x5a827999
      : round === 2 ? 0x6ed9eba1
        : round === 3 ? 0x8f1bbcdc : 0xa953fd4e
}

function rightConstant(round: number): number {
  return round === 0 ? 0x50a28be6
    : round === 1 ? 0x5c4dd124
      : round === 2 ? 0x6d703ef3
        : round === 3 ? 0x7a6d76e9 : 0x00000000
}

/** Computes the 20-byte RIPEMD-160 digest. */
export function ripemd160(data: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((data.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(data)
  padded[data.length] = 0x80
  let bitLength = BigInt(data.length) * 8n
  for (let i = 0; i < 8; i++) { padded[paddedLength - 8 + i] = Number(bitLength & 0xffn); bitLength >>= 8n }

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const words = new Uint32Array(16)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4
      words[i] = (padded[p]! | (padded[p + 1]! << 8) | (padded[p + 2]! << 16) | (padded[p + 3]! << 24)) >>> 0
    }
    let al = h0; let bl = h1; let cl = h2; let dl = h3; let el = h4
    let ar = h0; let br = h1; let cr = h2; let dr = h3; let er = h4
    for (let j = 0; j < 80; j++) {
      const round = Math.trunc(j / 16)
      let t = (rotateLeft((al + roundFunction(round, bl, cl, dl) + words[LEFT_INDEX[j]!]! + leftConstant(round)) >>> 0, LEFT_SHIFT[j]!) + el) >>> 0
      al = el; el = dl; dl = rotateLeft(cl, 10); cl = bl; bl = t
      t = (rotateLeft((ar + roundFunction(4 - round, br, cr, dr) + words[RIGHT_INDEX[j]!]! + rightConstant(round)) >>> 0, RIGHT_SHIFT[j]!) + er) >>> 0
      ar = er; er = dr; dr = rotateLeft(cr, 10); cr = br; br = t
    }
    const t = (h1 + cl + dr) >>> 0
    h1 = (h2 + dl + er) >>> 0
    h2 = (h3 + el + ar) >>> 0
    h3 = (h4 + al + br) >>> 0
    h4 = (h0 + bl + cr) >>> 0
    h0 = t
  }
  const output = new Uint8Array(20)
  const state = [h0, h1, h2, h3, h4]
  for (let i = 0; i < state.length; i++) {
    const value = state[i]!
    output[i * 4] = value
    output[i * 4 + 1] = value >>> 8
    output[i * 4 + 2] = value >>> 16
    output[i * 4 + 3] = value >>> 24
  }
  return output
}
