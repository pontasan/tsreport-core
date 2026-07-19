// DES / Triple DES (FIPS 46-3). Single-DES known-answer vectors validate the
// core block operation; the 3DES-CBC path (used to decrypt legacy public-key
// PDF recipient envelopes) is cross-checked against OpenSSL in the PubSec test.

import { describe, it, expect } from 'vitest'
import { tripleDesCbcDecrypt, tripleDesCbcEncrypt } from '../../src/encryption/des.js'

function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

describe('Triple DES CBC', () => {
  it('decrypts a single-block 3DES-CBC vector (K1=K2=K3 reduces to single DES)', () => {
    // FIPS single-DES known answer: key 0x0101010101010101, plaintext
    // 0x95F8A5E5DD31D900 -> ciphertext 0x8000000000000000. With K1=K2=K3 the
    // EDE cipher is plain DES, so decrypting the ciphertext (IV=0) returns the
    // plaintext.
    const key = hex('010101010101010101010101010101010101010101010101')
    const iv = hex('0000000000000000')
    const ct = hex('8000000000000000')
    const pt = tripleDesCbcDecrypt(ct, key, iv)
    expect(Array.from(pt)).toEqual(Array.from(hex('95f8a5e5dd31d900')))
  })

  it('rejects a wrong key length or non-block-aligned ciphertext', () => {
    expect(() => tripleDesCbcDecrypt(hex('0000000000000000'), hex('0011'), hex('0000000000000000'))).toThrow(/24 bytes/)
    expect(() => tripleDesCbcDecrypt(hex('00000000'), hex('0123456789abcdef23456789abcdef01456789abcdef0123'), hex('0000000000000000'))).toThrow(/multiple of 8/)
  })

  it('encrypts and decrypts PKCS#7-padded content', () => {
    const key = hex('0123456789abcdeffedcba98765432100011223344556677')
    const iv = hex('1234567890abcdef')
    const plain = new TextEncoder().encode('PubSec 3DES content')
    const encrypted = tripleDesCbcEncrypt(plain, key, iv)
    const padded = tripleDesCbcDecrypt(encrypted, key, iv)
    const paddingLength = padded[padded.length - 1]!
    expect(new TextDecoder().decode(padded.subarray(0, padded.length - paddingLength))).toBe('PubSec 3DES content')
  })
})
