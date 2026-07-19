/** RFC 8018 PBKDF2 and its standardized HMAC pseudorandom functions. */

import { sha1 } from './sha1.js'
import { sha224, sha256 } from './sha256.js'
import { sha384, sha512, sha512_224, sha512_256 } from './sha512.js'

export type Pbkdf2Prf =
  | 'HMAC-SHA-1' | 'HMAC-SHA-224' | 'HMAC-SHA-256' | 'HMAC-SHA-384'
  | 'HMAC-SHA-512' | 'HMAC-SHA-512/224' | 'HMAC-SHA-512/256'

function hash(prf: Pbkdf2Prf, value: Uint8Array): Uint8Array {
  if (prf === 'HMAC-SHA-1') return sha1(value)
  if (prf === 'HMAC-SHA-224') return sha224(value)
  if (prf === 'HMAC-SHA-256') return sha256(value)
  if (prf === 'HMAC-SHA-384') return sha384(value)
  if (prf === 'HMAC-SHA-512') return sha512(value)
  if (prf === 'HMAC-SHA-512/224') return sha512_224(value)
  return sha512_256(value)
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length)
  result.set(left)
  result.set(right, left.length)
  return result
}

export function hmac(prf: Pbkdf2Prf, key: Uint8Array, data: Uint8Array): Uint8Array {
  const blockLength = prf === 'HMAC-SHA-384' || prf.startsWith('HMAC-SHA-512') ? 128 : 64
  let normalizedKey = key.length > blockLength ? hash(prf, key) : key
  if (normalizedKey.length < blockLength) {
    const padded = new Uint8Array(blockLength)
    padded.set(normalizedKey)
    normalizedKey = padded
  }
  const inner = new Uint8Array(blockLength)
  const outer = new Uint8Array(blockLength)
  for (let i = 0; i < blockLength; i++) {
    inner[i] = normalizedKey[i]! ^ 0x36
    outer[i] = normalizedKey[i]! ^ 0x5c
  }
  return hash(prf, concat(outer, hash(prf, concat(inner, data))))
}

export function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterationCount: number,
  keyLength: number,
  prf: Pbkdf2Prf = 'HMAC-SHA-1',
): Uint8Array {
  if (!Number.isSafeInteger(iterationCount) || iterationCount <= 0) throw new Error('PBKDF2 iteration count must be a positive safe integer')
  if (!Number.isSafeInteger(keyLength) || keyLength <= 0) throw new Error('PBKDF2 key length must be a positive safe integer')
  const digestLength = hash(prf, new Uint8Array(0)).length
  const blockCount = Math.ceil(keyLength / digestLength)
  if (blockCount > 0xffffffff) throw new Error('PBKDF2 derived key is too long')
  const result = new Uint8Array(keyLength)
  const input = new Uint8Array(salt.length + 4)
  input.set(salt)
  let outputOffset = 0
  for (let block = 1; block <= blockCount; block++) {
    input[salt.length] = block >>> 24
    input[salt.length + 1] = block >>> 16
    input[salt.length + 2] = block >>> 8
    input[salt.length + 3] = block
    let u = hmac(prf, password, input)
    const t = Uint8Array.from(u)
    for (let iteration = 1; iteration < iterationCount; iteration++) {
      u = hmac(prf, password, u)
      for (let i = 0; i < t.length; i++) t[i] = t[i]! ^ u[i]!
    }
    const take = Math.min(t.length, keyLength - outputOffset)
    result.set(t.subarray(0, take), outputOffset)
    outputOffset += take
  }
  return result
}
