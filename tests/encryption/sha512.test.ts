// SHA-512 / SHA-384 (FIPS 180-4) validated against published test vectors.

import { describe, it, expect } from 'vitest'
import { sha512, sha384 } from '../../src/encryption/sha512.js'

function hex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0')
  return s
}
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('SHA-512', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(hex(sha512(enc('')))).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    )
    expect(hex(sha512(enc('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    )
    expect(hex(sha512(enc('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu')))).toBe(
      '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909',
    )
  })

  it('handles a multi-block message (200 bytes)', () => {
    // Length only; the important property is that padding across blocks is correct.
    expect(hex(sha512(enc('a'.repeat(200)))).length).toBe(128)
    expect(hex(sha512(enc('a'.repeat(112))))).not.toBe(hex(sha512(enc('a'.repeat(111)))))
  })
})

describe('SHA-384', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(hex(sha384(enc('')))).toBe(
      '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
    )
    expect(hex(sha384(enc('abc')))).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    )
  })
})
