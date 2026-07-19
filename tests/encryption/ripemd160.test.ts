import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ripemd160 } from '../../src/encryption/ripemd160.js'

function hex(value: Uint8Array): string {
  return Array.from(value, function (byte) { return byte.toString(16).padStart(2, '0') }).join('')
}

describe('RIPEMD-160', () => {
  it.each([
    ['', '9c1185a5c5e9fc54612808977ee8f548b2258d31'],
    ['a', '0bdc9d2d256b3ee9daae347be6f4dc835a467ffe'],
    ['abc', '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc'],
    ['message digest', '5d0689ef49d2fae572b881b123a85ffa21595f36'],
  ])('matches the published vector for %j', (input, expected) => {
    expect(hex(ripemd160(new TextEncoder().encode(input)))).toBe(expected)
  })

  it('matches the platform oracle across block boundaries', () => {
    for (const length of [55, 56, 63, 64, 65, 1000]) {
      const input = Uint8Array.from({ length }, function (_, index) { return (index * 29 + 7) & 0xff })
      expect(hex(ripemd160(input))).toBe(createHash('ripemd160').update(input).digest('hex'))
    }
  })
})
