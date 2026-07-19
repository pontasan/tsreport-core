/**
 * SHA-256 (Secure Hash Algorithm 256) — FIPS 180-4, Section 6.2
 *
 * Pure TypeScript implementation with no dependencies.
 * Pre-computed K constants as static Uint32Array.
 * Processes 512-bit (64-byte) blocks with big-endian byte order.
 */

// ─── Round Constants K[0..63] (FIPS 180-4 Section 4.2.2) ───
//
// First 32 bits of the fractional parts of the cube roots
// of the first 64 prime numbers (2..311).

const K = new Uint32Array([
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5,
  0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3,
  0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC,
  0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7,
  0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13,
  0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3,
  0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5,
  0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208,
  0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
])

// ─── Initial Hash Values H[0..7] (FIPS 180-4 Section 5.3.3) ───
//
// First 32 bits of the fractional parts of the square roots
// of the first 8 prime numbers (2, 3, 5, 7, 11, 13, 17, 19).

const H_INIT = new Uint32Array([
  0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
  0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
])

const H_INIT_224 = new Uint32Array([
  0xC1059ED8, 0x367CD507, 0x3070DD17, 0xF70E5939,
  0xFFC00B31, 0x68581511, 0x64F98FA7, 0xBEFA4FA4,
])

// ─── Message Schedule buffer (reused across blocks) ───

const W = new Uint32Array(64)

// ─── Logical Functions (FIPS 180-4 Section 4.1.2) ───

/** Ch(x, y, z) = (x AND y) XOR (NOT x AND z) */
function ch(x: number, y: number, z: number): number {
  return (x & y) ^ (~x & z)
}

/** Maj(x, y, z) = (x AND y) XOR (x AND z) XOR (y AND z) */
function maj(x: number, y: number, z: number): number {
  return (x & y) ^ (x & z) ^ (y & z)
}

/** Sigma0(x) = ROTR2(x) XOR ROTR13(x) XOR ROTR22(x) */
function sigma0(x: number): number {
  return ((x >>> 2) | (x << 30)) ^ ((x >>> 13) | (x << 19)) ^ ((x >>> 22) | (x << 10))
}

/** Sigma1(x) = ROTR6(x) XOR ROTR11(x) XOR ROTR25(x) */
function sigma1(x: number): number {
  return ((x >>> 6) | (x << 26)) ^ ((x >>> 11) | (x << 21)) ^ ((x >>> 25) | (x << 7))
}

/** sigma0(x) = ROTR7(x) XOR ROTR18(x) XOR SHR3(x) */
function lsigma0(x: number): number {
  return ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
}

/** sigma1(x) = ROTR17(x) XOR ROTR19(x) XOR SHR10(x) */
function lsigma1(x: number): number {
  return ((x >>> 17) | (x << 15)) ^ ((x >>> 19) | (x << 13)) ^ (x >>> 10)
}

// ─── Block Processing (FIPS 180-4 Section 6.2.2) ───

/**
 * Process a single 512-bit (64-byte) block.
 * Updates the hash state H in place.
 *
 * @param block - Source buffer containing the block data
 * @param offset - Byte offset into block where the 64-byte block starts
 * @param H - 8-element Uint32Array hash state (modified in place)
 */
function processBlock(block: Uint8Array, offset: number, H: Uint32Array): void {
  // Prepare message schedule W[0..63]
  // W[0..15]: from the block (big-endian 32-bit words)
  for (let t = 0; t < 16; t++) {
    const i = offset + (t << 2)
    W[t] = (block[i]! << 24) | (block[i + 1]! << 16) | (block[i + 2]! << 8) | block[i + 3]!
  }
  // W[16..63]: expanded from W[0..15]
  for (let t = 16; t < 64; t++) {
    W[t] = (lsigma1(W[t - 2]!) + W[t - 7]! + lsigma0(W[t - 15]!) + W[t - 16]!) | 0
  }

  // Initialize working variables
  let a = H[0]!
  let b = H[1]!
  let c = H[2]!
  let d = H[3]!
  let e = H[4]!
  let f = H[5]!
  let g = H[6]!
  let h = H[7]!

  // 64 rounds
  for (let t = 0; t < 64; t++) {
    const T1 = (h + sigma1(e) + ch(e, f, g) + K[t]! + W[t]!) | 0
    const T2 = (sigma0(a) + maj(a, b, c)) | 0
    h = g
    g = f
    f = e
    e = (d + T1) | 0
    d = c
    c = b
    b = a
    a = (T1 + T2) | 0
  }

  // Compute intermediate hash value
  H[0] = (H[0]! + a) | 0
  H[1] = (H[1]! + b) | 0
  H[2] = (H[2]! + c) | 0
  H[3] = (H[3]! + d) | 0
  H[4] = (H[4]! + e) | 0
  H[5] = (H[5]! + f) | 0
  H[6] = (H[6]! + g) | 0
  H[7] = (H[7]! + h) | 0
}

// ─── SHA-256 Public API ───

/**
 * Compute SHA-256 hash of the input data.
 * FIPS 180-4 compliant.
 *
 * @param data - Input bytes (arbitrary length)
 * @returns 32-byte (256-bit) hash digest
 */
function hashSha2_32(data: Uint8Array, initial: Uint32Array, outputWords: number): Uint8Array {
  const len = data.length

  // Initialize hash state (copy so H_INIT remains pristine)
  const H = new Uint32Array(8)
  H[0] = initial[0]!
  H[1] = initial[1]!
  H[2] = initial[2]!
  H[3] = initial[3]!
  H[4] = initial[4]!
  H[5] = initial[5]!
  H[6] = initial[6]!
  H[7] = initial[7]!

  // Process complete 64-byte blocks from the input
  const fullBlocks = len & ~63 // len - (len % 64)
  for (let i = 0; i < fullBlocks; i += 64) {
    processBlock(data, i, H)
  }

  // ─── Padding (FIPS 180-4 Section 5.1.1) ───
  //
  // Append bit '1', then zeros, then 64-bit big-endian bit length.
  // The padded message is 1 or 2 blocks of 64 bytes.
  const remaining = len - fullBlocks
  // Need room for: remaining bytes + 1 byte (0x80) + 8 bytes (length)
  // If remaining + 9 > 64, need 2 padding blocks; otherwise 1
  const padBlocks = (remaining + 9 > 64) ? 2 : 1
  const padBuf = new Uint8Array(padBlocks << 6) // padBlocks * 64

  // Copy remaining bytes
  for (let i = 0; i < remaining; i++) {
    padBuf[i] = data[fullBlocks + i]!
  }

  // Append 0x80
  padBuf[remaining] = 0x80

  // Append message length in bits as 64-bit big-endian integer.
  // JavaScript numbers can represent integers up to 2^53 exactly,
  // so bit length = len * 8 is safe for messages up to 2^50 bytes.
  const bitLen = len * 8
  const padEnd = (padBlocks << 6) - 1
  // Write 64-bit length. For messages < 2^29 bytes (512 MB), high word is 0.
  // For larger messages, compute high word properly.
  const bitLenHi = (bitLen / 0x100000000) >>> 0
  const bitLenLo = bitLen >>> 0
  padBuf[padEnd - 7] = (bitLenHi >>> 24) & 0xFF
  padBuf[padEnd - 6] = (bitLenHi >>> 16) & 0xFF
  padBuf[padEnd - 5] = (bitLenHi >>> 8) & 0xFF
  padBuf[padEnd - 4] = bitLenHi & 0xFF
  padBuf[padEnd - 3] = (bitLenLo >>> 24) & 0xFF
  padBuf[padEnd - 2] = (bitLenLo >>> 16) & 0xFF
  padBuf[padEnd - 1] = (bitLenLo >>> 8) & 0xFF
  padBuf[padEnd] = bitLenLo & 0xFF

  // Process padding block(s)
  for (let i = 0; i < padBlocks; i++) {
    processBlock(padBuf, i << 6, H)
  }

  // ─── Produce output (big-endian) ───
  const digest = new Uint8Array(outputWords * 4)
  for (let i = 0; i < outputWords; i++) {
    const w = H[i]!
    const j = i << 2
    digest[j] = (w >>> 24) & 0xFF
    digest[j + 1] = (w >>> 16) & 0xFF
    digest[j + 2] = (w >>> 8) & 0xFF
    digest[j + 3] = w & 0xFF
  }

  return digest
}

export function sha256(data: Uint8Array): Uint8Array {
  return hashSha2_32(data, H_INIT, 8)
}

/** Compute SHA-224 as defined by FIPS 180-4 section 6.3. */
export function sha224(data: Uint8Array): Uint8Array {
  return hashSha2_32(data, H_INIT_224, 7)
}
