/**
 * AES (Advanced Encryption Standard) — FIPS 197
 *
 * T-table based implementation for performance.
 * Supports AES-128, AES-192, and AES-256.
 * CBC mode with PKCS#7 padding.
 *
 * All tables (S-box, inverse S-box, Te0-Te3, Td0-Td3, Rcon) are
 * precomputed at module initialization time as static Uint32Arrays.
 */

// ─── S-box (FIPS 197 Section 5.1.1) ───

/** Forward S-box: SubBytes substitution */
const SBOX = new Uint8Array(256)

/** Inverse S-box: InvSubBytes substitution */
const INV_SBOX = new Uint8Array(256)

// Compute S-box using GF(2^8) arithmetic
// 1. Find multiplicative inverse in GF(2^8) with irreducible polynomial x^8 + x^4 + x^3 + x + 1
// 2. Apply affine transformation
function initSbox(): void {
  // Build exp/log tables for GF(2^8) with generator 3
  const exp = new Uint8Array(256)
  const log = new Uint8Array(256)
  let x = 1
  for (let i = 0; i < 255; i++) {
    exp[i] = x
    log[x] = i
    // Multiply by 3 in GF(2^8) with polynomial 0x11B
    x ^= (x << 1) ^ ((x >> 7) * 0x1B)
    x &= 0xFF
  }
  exp[255] = exp[0]!

  // Compute S-box
  for (let i = 0; i < 256; i++) {
    // Multiplicative inverse (0 maps to 0)
    let s = i === 0 ? 0 : exp[(255 - log[i]!) % 255]!
    // Affine transformation over GF(2)
    let a = s
    for (let j = 0; j < 4; j++) {
      s = ((s << 1) | (s >> 7)) & 0xFF
      a ^= s
    }
    a ^= 0x63
    a &= 0xFF
    SBOX[i] = a
    INV_SBOX[a] = i
  }
}

initSbox()

// ─── Round Constants (FIPS 197 Section 5.2) ───

const RCON = new Uint32Array(15)

function initRcon(): void {
  let rc = 1
  for (let i = 1; i <= 14; i++) {
    RCON[i] = rc
    // xtime in GF(2^8)
    rc = ((rc << 1) ^ ((rc >> 7) * 0x1B)) & 0xFF
  }
}

initRcon()

// ─── T-tables (FIPS 197 Section 5.3.3, optimized) ───
//
// Encryption: Te0[s] = [2*s, s, s, 3*s] as columns of MixColumns matrix
//             Te1, Te2, Te3 are byte rotations of Te0
// Decryption: Td0[s] = [14*s, 9*s, 13*s, 11*s]
//             Td1, Td2, Td3 are byte rotations of Td0

const Te0 = new Uint32Array(256)
const Te1 = new Uint32Array(256)
const Te2 = new Uint32Array(256)
const Te3 = new Uint32Array(256)

const Td0 = new Uint32Array(256)
const Td1 = new Uint32Array(256)
const Td2 = new Uint32Array(256)
const Td3 = new Uint32Array(256)

/** xtime: multiply by 2 in GF(2^8) */
function xtime(a: number): number {
  return ((a << 1) ^ ((a >> 7) * 0x1B)) & 0xFF
}

/** Multiply two values in GF(2^8) using repeated doubling */
function gmul(a: number, b: number): number {
  let result = 0
  let aa = a
  let bb = b
  for (let i = 0; i < 8; i++) {
    if (bb & 1) result ^= aa
    aa = xtime(aa)
    bb >>= 1
  }
  return result
}

function initTTables(): void {
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i]!

    // Encryption T-table: column [2*s, s, s, 3*s]
    const s2 = xtime(s)
    const s3 = s2 ^ s

    Te0[i] = (s2 << 24) | (s << 16) | (s << 8) | s3
    Te1[i] = (s3 << 24) | (s2 << 16) | (s << 8) | s
    Te2[i] = (s << 24) | (s3 << 16) | (s2 << 8) | s
    Te3[i] = (s << 24) | (s << 16) | (s3 << 8) | s2

    // Decryption T-table: column [14*s, 9*s, 13*s, 11*s] using InvSbox
    const is = INV_SBOX[i]!
    const is9 = gmul(is, 9)
    const isB = gmul(is, 11)
    const isD = gmul(is, 13)
    const isE = gmul(is, 14)

    Td0[i] = (isE << 24) | (is9 << 16) | (isD << 8) | isB
    Td1[i] = (isB << 24) | (isE << 16) | (is9 << 8) | isD
    Td2[i] = (isD << 24) | (isB << 16) | (isE << 8) | is9
    Td3[i] = (is9 << 24) | (isD << 16) | (isB << 8) | isE
  }
}

initTTables()

// ─── Key Expansion (FIPS 197 Section 5.2) ───

/**
 * AES key expansion.
 *
 * @param key - 16, 24, or 32 bytes for AES-128, AES-192, or AES-256
 * @returns Expanded round keys as Uint32Array.
 *          AES-128: 44 words (11 round keys x 4 words)
 *          AES-256: 60 words (15 round keys x 4 words)
 */
export function aesKeyExpansion(key: Uint8Array): Uint32Array {
  const keyLen = key.length
  if (keyLen !== 16 && keyLen !== 24 && keyLen !== 32) throw new Error('AES key must contain 16, 24, or 32 bytes')
  const Nk = keyLen >> 2
  const Nr = Nk + 6
  const totalWords = (Nr + 1) * 4

  const W = new Uint32Array(totalWords)

  // Copy key into first Nk words (big-endian word order)
  for (let i = 0; i < Nk; i++) {
    const j = i << 2
    W[i] = (key[j]! << 24) | (key[j + 1]! << 16) | (key[j + 2]! << 8) | key[j + 3]!
  }

  for (let i = Nk; i < totalWords; i++) {
    let temp = W[i - 1]!
    if (i % Nk === 0) {
      // RotWord + SubWord + Rcon
      temp = ((temp << 8) | (temp >>> 24)) >>> 0
      temp = (SBOX[(temp >>> 24) & 0xFF]! << 24) |
             (SBOX[(temp >>> 16) & 0xFF]! << 16) |
             (SBOX[(temp >>> 8) & 0xFF]! << 8) |
              SBOX[temp & 0xFF]!
      temp = (temp ^ (RCON[i / Nk]! << 24)) >>> 0
    } else if (Nk > 6 && i % Nk === 4) {
      // AES-256: extra SubWord
      temp = (SBOX[(temp >>> 24) & 0xFF]! << 24) |
             (SBOX[(temp >>> 16) & 0xFF]! << 16) |
             (SBOX[(temp >>> 8) & 0xFF]! << 8) |
              SBOX[temp & 0xFF]!
    }
    W[i] = (W[i - Nk]! ^ temp) >>> 0
  }

  return W
}

// ─── AES ECB Block Encrypt (FIPS 197 Section 5.1) ───

/**
 * Encrypt a single 16-byte block using AES ECB.
 * Writes result into `out` at `outOff`.
 *
 * @param block - Input block (16 bytes) at offset `blockOff`
 * @param blockOff - Offset into block array
 * @param roundKeys - Expanded round keys from aesKeyExpansion
 * @param Nr - Number of rounds (10 or 14)
 * @param out - Output buffer
 * @param outOff - Offset into output buffer
 */
function aesEncryptBlock(
  block: Uint8Array,
  blockOff: number,
  roundKeys: Uint32Array,
  Nr: number,
  out: Uint8Array,
  outOff: number,
): void {
  // Initial AddRoundKey
  let s0 = ((block[blockOff]! << 24) | (block[blockOff + 1]! << 16) |
             (block[blockOff + 2]! << 8) | block[blockOff + 3]!) ^ roundKeys[0]!
  let s1 = ((block[blockOff + 4]! << 24) | (block[blockOff + 5]! << 16) |
             (block[blockOff + 6]! << 8) | block[blockOff + 7]!) ^ roundKeys[1]!
  let s2 = ((block[blockOff + 8]! << 24) | (block[blockOff + 9]! << 16) |
             (block[blockOff + 10]! << 8) | block[blockOff + 11]!) ^ roundKeys[2]!
  let s3 = ((block[blockOff + 12]! << 24) | (block[blockOff + 13]! << 16) |
             (block[blockOff + 14]! << 8) | block[blockOff + 15]!) ^ roundKeys[3]!

  let t0: number, t1: number, t2: number, t3: number
  let ki = 4

  // Rounds 1 to Nr-1: SubBytes + ShiftRows + MixColumns + AddRoundKey via T-tables
  for (let r = 1; r < Nr; r++) {
    t0 = (Te0[(s0 >>> 24) & 0xFF]! ^ Te1[(s1 >>> 16) & 0xFF]! ^
          Te2[(s2 >>> 8) & 0xFF]! ^ Te3[s3 & 0xFF]! ^ roundKeys[ki]!) >>> 0
    t1 = (Te0[(s1 >>> 24) & 0xFF]! ^ Te1[(s2 >>> 16) & 0xFF]! ^
          Te2[(s3 >>> 8) & 0xFF]! ^ Te3[s0 & 0xFF]! ^ roundKeys[ki + 1]!) >>> 0
    t2 = (Te0[(s2 >>> 24) & 0xFF]! ^ Te1[(s3 >>> 16) & 0xFF]! ^
          Te2[(s0 >>> 8) & 0xFF]! ^ Te3[s1 & 0xFF]! ^ roundKeys[ki + 2]!) >>> 0
    t3 = (Te0[(s3 >>> 24) & 0xFF]! ^ Te1[(s0 >>> 16) & 0xFF]! ^
          Te2[(s1 >>> 8) & 0xFF]! ^ Te3[s2 & 0xFF]! ^ roundKeys[ki + 3]!) >>> 0
    s0 = t0; s1 = t1; s2 = t2; s3 = t3
    ki += 4
  }

  // Final round: SubBytes + ShiftRows + AddRoundKey (no MixColumns)
  t0 = ((SBOX[(s0 >>> 24) & 0xFF]! << 24) | (SBOX[(s1 >>> 16) & 0xFF]! << 16) |
        (SBOX[(s2 >>> 8) & 0xFF]! << 8) | SBOX[s3 & 0xFF]!) ^ roundKeys[ki]!
  t1 = ((SBOX[(s1 >>> 24) & 0xFF]! << 24) | (SBOX[(s2 >>> 16) & 0xFF]! << 16) |
        (SBOX[(s3 >>> 8) & 0xFF]! << 8) | SBOX[s0 & 0xFF]!) ^ roundKeys[ki + 1]!
  t2 = ((SBOX[(s2 >>> 24) & 0xFF]! << 24) | (SBOX[(s3 >>> 16) & 0xFF]! << 16) |
        (SBOX[(s0 >>> 8) & 0xFF]! << 8) | SBOX[s1 & 0xFF]!) ^ roundKeys[ki + 2]!
  t3 = ((SBOX[(s3 >>> 24) & 0xFF]! << 24) | (SBOX[(s0 >>> 16) & 0xFF]! << 16) |
        (SBOX[(s1 >>> 8) & 0xFF]! << 8) | SBOX[s2 & 0xFF]!) ^ roundKeys[ki + 3]!

  // Write output (big-endian)
  out[outOff] = (t0 >>> 24) & 0xFF
  out[outOff + 1] = (t0 >>> 16) & 0xFF
  out[outOff + 2] = (t0 >>> 8) & 0xFF
  out[outOff + 3] = t0 & 0xFF
  out[outOff + 4] = (t1 >>> 24) & 0xFF
  out[outOff + 5] = (t1 >>> 16) & 0xFF
  out[outOff + 6] = (t1 >>> 8) & 0xFF
  out[outOff + 7] = t1 & 0xFF
  out[outOff + 8] = (t2 >>> 24) & 0xFF
  out[outOff + 9] = (t2 >>> 16) & 0xFF
  out[outOff + 10] = (t2 >>> 8) & 0xFF
  out[outOff + 11] = t2 & 0xFF
  out[outOff + 12] = (t3 >>> 24) & 0xFF
  out[outOff + 13] = (t3 >>> 16) & 0xFF
  out[outOff + 14] = (t3 >>> 8) & 0xFF
  out[outOff + 15] = t3 & 0xFF
}

// ─── AES ECB Block Decrypt (FIPS 197 Section 5.3) ───

/**
 * Compute decryption round keys from encryption round keys.
 * Applies InvMixColumns to all round keys except the first and last.
 */
function makeDecryptKeys(encKeys: Uint32Array, Nr: number): Uint32Array {
  const totalWords = (Nr + 1) * 4
  const dk = new Uint32Array(totalWords)

  // First round key: same as last encryption round key
  dk[0] = encKeys[Nr * 4]!
  dk[1] = encKeys[Nr * 4 + 1]!
  dk[2] = encKeys[Nr * 4 + 2]!
  dk[3] = encKeys[Nr * 4 + 3]!

  // Middle round keys: InvMixColumns applied via Td tables on S-box output
  for (let r = 1; r < Nr; r++) {
    const ei = (Nr - r) * 4
    for (let c = 0; c < 4; c++) {
      const w = encKeys[ei + c]!
      dk[r * 4 + c] = Td0[SBOX[(w >>> 24) & 0xFF]!]! ^
                       Td1[SBOX[(w >>> 16) & 0xFF]!]! ^
                       Td2[SBOX[(w >>> 8) & 0xFF]!]! ^
                       Td3[SBOX[w & 0xFF]!]!
    }
  }

  // Last round key: same as first encryption round key
  dk[Nr * 4] = encKeys[0]!
  dk[Nr * 4 + 1] = encKeys[1]!
  dk[Nr * 4 + 2] = encKeys[2]!
  dk[Nr * 4 + 3] = encKeys[3]!

  return dk
}

/**
 * Decrypt a single 16-byte block using AES ECB.
 * Writes result into `out` at `outOff`.
 */
function aesDecryptBlock(
  block: Uint8Array,
  blockOff: number,
  decKeys: Uint32Array,
  Nr: number,
  out: Uint8Array,
  outOff: number,
): void {
  // Initial AddRoundKey
  let s0 = ((block[blockOff]! << 24) | (block[blockOff + 1]! << 16) |
             (block[blockOff + 2]! << 8) | block[blockOff + 3]!) ^ decKeys[0]!
  let s1 = ((block[blockOff + 4]! << 24) | (block[blockOff + 5]! << 16) |
             (block[blockOff + 6]! << 8) | block[blockOff + 7]!) ^ decKeys[1]!
  let s2 = ((block[blockOff + 8]! << 24) | (block[blockOff + 9]! << 16) |
             (block[blockOff + 10]! << 8) | block[blockOff + 11]!) ^ decKeys[2]!
  let s3 = ((block[blockOff + 12]! << 24) | (block[blockOff + 13]! << 16) |
             (block[blockOff + 14]! << 8) | block[blockOff + 15]!) ^ decKeys[3]!

  let t0: number, t1: number, t2: number, t3: number
  let ki = 4

  // Rounds 1 to Nr-1: InvSubBytes + InvShiftRows + InvMixColumns + AddRoundKey via Td-tables
  for (let r = 1; r < Nr; r++) {
    t0 = (Td0[(s0 >>> 24) & 0xFF]! ^ Td1[(s3 >>> 16) & 0xFF]! ^
          Td2[(s2 >>> 8) & 0xFF]! ^ Td3[s1 & 0xFF]! ^ decKeys[ki]!) >>> 0
    t1 = (Td0[(s1 >>> 24) & 0xFF]! ^ Td1[(s0 >>> 16) & 0xFF]! ^
          Td2[(s3 >>> 8) & 0xFF]! ^ Td3[s2 & 0xFF]! ^ decKeys[ki + 1]!) >>> 0
    t2 = (Td0[(s2 >>> 24) & 0xFF]! ^ Td1[(s1 >>> 16) & 0xFF]! ^
          Td2[(s0 >>> 8) & 0xFF]! ^ Td3[s3 & 0xFF]! ^ decKeys[ki + 2]!) >>> 0
    t3 = (Td0[(s3 >>> 24) & 0xFF]! ^ Td1[(s2 >>> 16) & 0xFF]! ^
          Td2[(s1 >>> 8) & 0xFF]! ^ Td3[s0 & 0xFF]! ^ decKeys[ki + 3]!) >>> 0
    s0 = t0; s1 = t1; s2 = t2; s3 = t3
    ki += 4
  }

  // Final round: InvSubBytes + InvShiftRows + AddRoundKey (no InvMixColumns)
  t0 = ((INV_SBOX[(s0 >>> 24) & 0xFF]! << 24) | (INV_SBOX[(s3 >>> 16) & 0xFF]! << 16) |
        (INV_SBOX[(s2 >>> 8) & 0xFF]! << 8) | INV_SBOX[s1 & 0xFF]!) ^ decKeys[ki]!
  t1 = ((INV_SBOX[(s1 >>> 24) & 0xFF]! << 24) | (INV_SBOX[(s0 >>> 16) & 0xFF]! << 16) |
        (INV_SBOX[(s3 >>> 8) & 0xFF]! << 8) | INV_SBOX[s2 & 0xFF]!) ^ decKeys[ki + 1]!
  t2 = ((INV_SBOX[(s2 >>> 24) & 0xFF]! << 24) | (INV_SBOX[(s1 >>> 16) & 0xFF]! << 16) |
        (INV_SBOX[(s0 >>> 8) & 0xFF]! << 8) | INV_SBOX[s3 & 0xFF]!) ^ decKeys[ki + 2]!
  t3 = ((INV_SBOX[(s3 >>> 24) & 0xFF]! << 24) | (INV_SBOX[(s2 >>> 16) & 0xFF]! << 16) |
        (INV_SBOX[(s1 >>> 8) & 0xFF]! << 8) | INV_SBOX[s0 & 0xFF]!) ^ decKeys[ki + 3]!

  // Write output (big-endian)
  out[outOff] = (t0 >>> 24) & 0xFF
  out[outOff + 1] = (t0 >>> 16) & 0xFF
  out[outOff + 2] = (t0 >>> 8) & 0xFF
  out[outOff + 3] = t0 & 0xFF
  out[outOff + 4] = (t1 >>> 24) & 0xFF
  out[outOff + 5] = (t1 >>> 16) & 0xFF
  out[outOff + 6] = (t1 >>> 8) & 0xFF
  out[outOff + 7] = t1 & 0xFF
  out[outOff + 8] = (t2 >>> 24) & 0xFF
  out[outOff + 9] = (t2 >>> 16) & 0xFF
  out[outOff + 10] = (t2 >>> 8) & 0xFF
  out[outOff + 11] = t2 & 0xFF
  out[outOff + 12] = (t3 >>> 24) & 0xFF
  out[outOff + 13] = (t3 >>> 16) & 0xFF
  out[outOff + 14] = (t3 >>> 8) & 0xFF
  out[outOff + 15] = t3 & 0xFF
}

// ─── CBC Mode (NIST SP 800-38A) ───

/**
 * AES-CBC encrypt with PKCS#7 padding.
 *
 * @param data - Plaintext (arbitrary length)
 * @param key - 16, 24, or 32 bytes for AES-128, AES-192, or AES-256
 * @param iv - 16-byte initialization vector
 * @returns Ciphertext (always a multiple of 16 bytes, includes padding)
 */
export function aesCbcEncrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const Nr = (key.length >> 2) + 6
  const roundKeys = aesKeyExpansion(key)

  // PKCS#7 padding: pad to next multiple of 16
  // If already aligned, add full 16-byte padding block
  const padLen = 16 - (data.length % 16)
  const paddedLen = data.length + padLen
  const padded = new Uint8Array(paddedLen)
  padded.set(data)
  for (let i = data.length; i < paddedLen; i++) {
    padded[i] = padLen
  }

  const out = new Uint8Array(paddedLen)
  const blockCount = paddedLen >> 4

  // XOR buffer for CBC chaining
  const xorBlock = new Uint8Array(16)

  // First block: XOR with IV
  for (let j = 0; j < 16; j++) {
    xorBlock[j] = padded[j]! ^ iv[j]!
  }
  aesEncryptBlock(xorBlock, 0, roundKeys, Nr, out, 0)

  // Subsequent blocks: XOR with previous ciphertext block
  for (let i = 1; i < blockCount; i++) {
    const inOff = i << 4
    const prevOff = (i - 1) << 4
    for (let j = 0; j < 16; j++) {
      xorBlock[j] = padded[inOff + j]! ^ out[prevOff + j]!
    }
    aesEncryptBlock(xorBlock, 0, roundKeys, Nr, out, inOff)
  }

  return out
}

/**
 * AES-CBC decrypt with PKCS#7 padding removal.
 *
 * @param data - Ciphertext (must be a multiple of 16 bytes)
 * @param key - 16, 24, or 32 bytes for AES-128, AES-192, or AES-256
 * @param iv - 16-byte initialization vector
 * @returns Decrypted plaintext with PKCS#7 padding removed
 */
export function aesCbcDecrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const out = aesCbcDecryptNoPadding(data, key, iv)

  // Remove PKCS#7 padding
  const padLen = out[out.length - 1]!
  return out.subarray(0, out.length - padLen)
}

/**
 * AES-CBC decrypt without padding removal.
 *
 * PDF Standard Security Handler uses this for AES-256 UE/OE/Perms values.
 */
export function aesCbcDecryptNoPadding(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const Nr = (key.length >> 2) + 6
  const encKeys = aesKeyExpansion(key)
  const decKeys = makeDecryptKeys(encKeys, Nr)
  const blockCount = data.length >> 4

  const out = new Uint8Array(data.length)

  // Decrypt block buffer
  const decBuf = new Uint8Array(16)

  // First block: decrypt then XOR with IV
  aesDecryptBlock(data, 0, decKeys, Nr, decBuf, 0)
  for (let j = 0; j < 16; j++) {
    out[j] = decBuf[j]! ^ iv[j]!
  }

  // Subsequent blocks: decrypt then XOR with previous ciphertext block
  for (let i = 1; i < blockCount; i++) {
    const inOff = i << 4
    const prevOff = (i - 1) << 4
    aesDecryptBlock(data, inOff, decKeys, Nr, decBuf, 0)
    for (let j = 0; j < 16; j++) {
      out[inOff + j] = decBuf[j]! ^ data[prevOff + j]!
    }
  }

  return out
}

/**
 * AES Key Unwrap (RFC 3394). Unwraps an n*8-byte wrapped key (n+1 64-bit
 * blocks) with the key-encryption key, verifying the default integrity check
 * value 0xA6A6A6A6A6A6A6A6. Used to recover the content-encryption key from an
 * ECDH (KeyAgreeRecipientInfo) recipient in a public-key-encrypted PDF.
 */
export function aesKeyUnwrap(kek: Uint8Array, wrapped: Uint8Array): Uint8Array {
  if (wrapped.length % 8 !== 0 || wrapped.length < 16) {
    throw new Error('AES key unwrap error: wrapped key must be a multiple of 8 bytes')
  }
  const Nr = (kek.length >> 2) + 6
  const decKeys = makeDecryptKeys(aesKeyExpansion(kek), Nr)
  const n = wrapped.length / 8 - 1
  const a = wrapped.slice(0, 8)
  const r = new Uint8Array(n * 8)
  r.set(wrapped.subarray(8))
  const block = new Uint8Array(16)
  const outBlock = new Uint8Array(16)
  for (let j = 5; j >= 0; j--) {
    for (let i = n; i >= 1; i--) {
      block.set(a, 0)
      block.set(r.subarray((i - 1) * 8, i * 8), 8)
      // A ^= t, where t = n*j + i, applied to the low bytes of A.
      const t = n * j + i
      block[7]! ^= t & 0xFF
      block[6]! ^= (t >>> 8) & 0xFF
      block[5]! ^= (t >>> 16) & 0xFF
      block[4]! ^= (t >>> 24) & 0xFF
      aesDecryptBlock(block, 0, decKeys, Nr, outBlock, 0)
      a.set(outBlock.subarray(0, 8))
      r.set(outBlock.subarray(8, 16), (i - 1) * 8)
    }
  }
  for (let i = 0; i < 8; i++) {
    if (a[i] !== 0xA6) throw new Error('AES key unwrap error: integrity check failed')
  }
  return r
}

/**
 * AES Key Wrap (RFC 3394). Wraps key data consisting of at least two 64-bit
 * blocks with the default integrity value 0xA6A6A6A6A6A6A6A6.
 */
export function aesKeyWrap(kek: Uint8Array, keyData: Uint8Array): Uint8Array {
  if (kek.length !== 16 && kek.length !== 24 && kek.length !== 32) {
    throw new Error('AES key wrap error: KEK must contain 16, 24, or 32 bytes')
  }
  if (keyData.length % 8 !== 0 || keyData.length < 16) {
    throw new Error('AES key wrap error: key data must contain at least two 8-byte blocks')
  }
  const roundKeys = aesKeyExpansion(kek)
  const rounds = (kek.length >> 2) + 6
  const n = keyData.length / 8
  const a = new Uint8Array(8)
  a.fill(0xA6)
  const r = keyData.slice()
  const block = new Uint8Array(16)
  const encrypted = new Uint8Array(16)
  for (let j = 0; j <= 5; j++) {
    for (let i = 1; i <= n; i++) {
      block.set(a, 0)
      block.set(r.subarray((i - 1) * 8, i * 8), 8)
      aesEncryptBlock(block, 0, roundKeys, rounds, encrypted, 0)
      a.set(encrypted.subarray(0, 8))
      const t = n * j + i
      a[7]! ^= t & 0xFF
      a[6]! ^= (t >>> 8) & 0xFF
      a[5]! ^= (t >>> 16) & 0xFF
      a[4]! ^= (t >>> 24) & 0xFF
      r.set(encrypted.subarray(8), (i - 1) * 8)
    }
  }
  const wrapped = new Uint8Array(keyData.length + 8)
  wrapped.set(a)
  wrapped.set(r, 8)
  return wrapped
}
