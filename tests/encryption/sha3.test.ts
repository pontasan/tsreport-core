import { describe, expect, it } from 'vitest'
import { sha3_256, sha3_384, sha3_512, shake256 } from '../../src/encryption/sha3.js'

function hex(value: Uint8Array): string {
  return Array.from(value, function (byte) { return byte.toString(16).padStart(2, '0') }).join('')
}

describe('FIPS 202 SHA-3', function () {
  const empty = new Uint8Array(0)

  it('matches the published empty-message SHA-3 vectors', function () {
    expect(hex(sha3_256(empty))).toBe('a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a')
    expect(hex(sha3_384(empty))).toBe('0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004')
    expect(hex(sha3_512(empty))).toBe('a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26')
  })

  it('matches the published 512-bit SHAKE256 empty-message vector', function () {
    expect(hex(shake256(empty, 64))).toBe('46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762fd75dc4ddd8c0f200cb05019d67b592f6fc821c49479ab48640292eacb3b7c4be')
  })
})
