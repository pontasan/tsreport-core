/**
 * DES and Triple DES (DES-EDE3) in CBC mode — FIPS 46-3.
 *
 * Used for the CMS content-encryption layer of public-key-encrypted PDFs whose
 * recipient envelopes select des-ede3-cbc.
 */

// Initial permutation (IP)
const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
]
// Final permutation (IP^-1)
const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
]
// Expansion (E)
const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
]
// Permutation (P)
const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
]
// Permuted choice 1 (PC-1)
const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27,
  19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
]
// Permuted choice 2 (PC-2)
const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
]
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]

// S-boxes
const S = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
]

/** Permute `bits` (array of 0/1) according to `table` (1-based indices). */
function permute(bits: number[], table: number[]): number[] {
  const out = new Array<number>(table.length)
  for (let i = 0; i < table.length; i++) out[i] = bits[table[i]! - 1]!
  return out
}

function bytesToBits(bytes: Uint8Array, offset: number, len: number): number[] {
  const bits = new Array<number>(len * 8)
  for (let i = 0; i < len; i++) {
    const b = bytes[offset + i]!
    for (let j = 0; j < 8; j++) bits[i * 8 + j] = (b >> (7 - j)) & 1
  }
  return bits
}

function bitsToBytes(bits: number[]): Uint8Array {
  const out = new Uint8Array(bits.length / 8)
  for (let i = 0; i < out.length; i++) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]!
    out[i] = b
  }
  return out
}

/** Expand an 8-byte key into 16 48-bit subkeys. */
function keySchedule(key: Uint8Array, offset: number): number[][] {
  const keyBits = permute(bytesToBits(key, offset, 8), PC1)
  let c = keyBits.slice(0, 28)
  let d = keyBits.slice(28, 56)
  const subkeys: number[][] = []
  for (let round = 0; round < 16; round++) {
    const s = SHIFTS[round]!
    c = c.slice(s).concat(c.slice(0, s))
    d = d.slice(s).concat(d.slice(0, s))
    subkeys.push(permute(c.concat(d), PC2))
  }
  return subkeys
}

/** DES block operation (8 bytes) with the given subkeys; decrypt reverses them. */
function desBlock(block: number[], subkeys: number[][], decrypt: boolean): number[] {
  const permuted = permute(block, IP)
  let l = permuted.slice(0, 32)
  let r = permuted.slice(32, 64)
  for (let round = 0; round < 16; round++) {
    const sk = subkeys[decrypt ? 15 - round : round]!
    const expanded = permute(r, E)
    const xored = new Array<number>(48)
    for (let i = 0; i < 48; i++) xored[i] = expanded[i]! ^ sk[i]!
    const sboxOut = new Array<number>(32)
    for (let box = 0; box < 8; box++) {
      const base = box * 6
      const row = (xored[base]! << 1) | xored[base + 5]!
      const col = (xored[base + 1]! << 3) | (xored[base + 2]! << 2) | (xored[base + 3]! << 1) | xored[base + 4]!
      const val = S[box]![row * 16 + col]!
      for (let j = 0; j < 4; j++) sboxOut[box * 4 + j] = (val >> (3 - j)) & 1
    }
    const f = permute(sboxOut, P)
    const newR = new Array<number>(32)
    for (let i = 0; i < 32; i++) newR[i] = l[i]! ^ f[i]!
    l = r
    r = newR
  }
  return permute(r.concat(l), FP)
}

/**
 * Decrypt with DES-EDE3-CBC (24-byte key: K1|K2|K3). Applies D(K3)·E(K2)·D(K1)
 * per block, chained through the IV. PKCS#7 padding is not stripped here.
 */
export function tripleDesCbcDecrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  if (key.length !== 24) throw new Error('DES-EDE3 error: key must be 24 bytes')
  if (data.length % 8 !== 0) throw new Error('DES-EDE3 error: ciphertext must be a multiple of 8 bytes')
  const sk1 = keySchedule(key, 0)
  const sk2 = keySchedule(key, 8)
  const sk3 = keySchedule(key, 16)
  const out = new Uint8Array(data.length)
  let prev = bytesToBits(iv, 0, 8)
  for (let off = 0; off < data.length; off += 8) {
    const cipherBits = bytesToBits(data, off, 8)
    // EDE decryption: D_K1(E_K2(D_K3(C)))
    const step1 = desBlock(cipherBits, sk3, true)
    const step2 = desBlock(step1, sk2, false)
    const step3 = desBlock(step2, sk1, true)
    const plainBits = new Array<number>(64)
    for (let i = 0; i < 64; i++) plainBits[i] = step3[i]! ^ prev[i]!
    out.set(bitsToBytes(plainBits), off)
    prev = cipherBits
  }
  return out
}

/** Encrypt with DES-EDE3-CBC and append PKCS#7 padding. */
export function tripleDesCbcEncrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  if (key.length !== 24) throw new Error('DES-EDE3 error: key must be 24 bytes')
  if (iv.length !== 8) throw new Error('DES-EDE3 error: IV must be 8 bytes')
  const paddingLength = 8 - (data.length % 8)
  const padded = new Uint8Array(data.length + paddingLength)
  padded.set(data)
  padded.fill(paddingLength, data.length)
  const sk1 = keySchedule(key, 0)
  const sk2 = keySchedule(key, 8)
  const sk3 = keySchedule(key, 16)
  const out = new Uint8Array(padded.length)
  let previous = bytesToBits(iv, 0, 8)
  for (let offset = 0; offset < padded.length; offset += 8) {
    const plain = bytesToBits(padded, offset, 8)
    for (let bit = 0; bit < 64; bit++) plain[bit] = plain[bit]! ^ previous[bit]!
    const step1 = desBlock(plain, sk1, false)
    const step2 = desBlock(step1, sk2, true)
    const cipher = desBlock(step2, sk3, false)
    out.set(bitsToBytes(cipher), offset)
    previous = cipher
  }
  return out
}
