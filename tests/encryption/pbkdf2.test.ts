import { describe, expect, it } from 'vitest'
import { pbkdf2 } from '../../src/encryption/pbkdf2.js'

function hex(value: Uint8Array): string {
  return Array.from(value, function (byte) { return byte.toString(16).padStart(2, '0') }).join('')
}

const encoder = new TextEncoder()

describe('RFC 8018 PBKDF2', function () {
  it('matches the RFC 6070 HMAC-SHA-1 vectors', function () {
    expect(hex(pbkdf2(encoder.encode('password'), encoder.encode('salt'), 1, 20))).toBe('0c60c80f961f0e71f3a9b524af6012062fe037a6')
    expect(hex(pbkdf2(encoder.encode('password'), encoder.encode('salt'), 2, 20))).toBe('ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957')
  })

  it('matches the published HMAC-SHA-256 vector', function () {
    expect(hex(pbkdf2(encoder.encode('password'), encoder.encode('salt'), 1, 32, 'HMAC-SHA-256')))
      .toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b')
  })
})
