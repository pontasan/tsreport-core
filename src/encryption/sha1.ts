/**
 * SHA-1 (Secure Hash Algorithm 1) — FIPS 180-4, Section 6.1
 *
 * Pure TypeScript implementation with no dependencies. Present for verifying
 * legacy PDF digital signatures (adbe.pkcs7.sha1 and older RSA/SHA-1 CMS
 * signatures); it is never used for new cryptographic output.
 */

const H_INIT = new Uint32Array([0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0])

/** SHA-1 digest (20 bytes) of the input. */
export function sha1(data: Uint8Array): Uint8Array {
  // Message padding (FIPS 180-4 Section 5.1.1): 0x80, zeros, 64-bit length
  const bitLength = data.length * 8
  const paddedLength = (((data.length + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(paddedLength)
  padded.set(data)
  padded[data.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000))
  dv.setUint32(paddedLength - 4, bitLength >>> 0)

  const h = new Uint32Array(H_INIT)
  const w = new Uint32Array(80)
  for (let block = 0; block < paddedLength; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(block + t * 4)
    for (let t = 16; t < 80; t++) {
      const x = w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!
      w[t] = (x << 1) | (x >>> 31)
    }
    let a = h[0]!
    let b = h[1]!
    let c = h[2]!
    let d = h[3]!
    let e = h[4]!
    for (let t = 0; t < 80; t++) {
      let f: number
      let k: number
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999 }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1 }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
      else { f = b ^ c ^ d; k = 0xCA62C1D6 }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]!) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = temp
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
  }
  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < 5; i++) outView.setUint32(i * 4, h[i]!)
  return out
}
