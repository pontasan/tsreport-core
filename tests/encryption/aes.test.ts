import { describe, it, expect } from 'vitest'
import { aesKeyExpansion, aesCbcEncrypt, aesCbcDecrypt, aesKeyUnwrap, aesKeyWrap } from '../../src/encryption/aes'

// ─── Hex Helpers ───

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

// ─── Key Expansion ───

describe('aesKeyExpansion', () => {
  // Verifies a 128-bit key expands to the FIPS 197 schedule size of 44 round-key words.
  it('AES-128 key expansion produces 44 words', () => {
    const key = hexToBytes('2b7e151628aed2a6abf7158809cf4f3c')
    const expanded = aesKeyExpansion(key)
    expect(expanded.length).toBe(44)
  })

  // Verifies a 256-bit key expands to the FIPS 197 schedule size of 60 round-key words.
  it('AES-256 key expansion produces 60 words', () => {
    const key = hexToBytes('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4')
    const expanded = aesKeyExpansion(key)
    expect(expanded.length).toBe(60)
  })
})

// ─── NIST Known-Answer Test (AES-128 ECB via CBC with zero IV) ───

describe('AES-128 ECB via CBC with zero IV', () => {
  // Verifies the cipher core against the NIST FIPS 197 known-answer vector, using zero-IV CBC as an ECB equivalent.
  it('NIST FIPS 197 Appendix B test vector', () => {
    // NIST AES-128 ECB test vector:
    //   Key:        2b7e151628aed2a6abf7158809cf4f3c
    //   Plaintext:  6bc1bee22e409f96e93d7e117393172a
    //   Ciphertext: 3ad77bb40d7a3660a89ecaf32466ef97
    //
    // CBC with a zero IV on a single 16-byte block is equivalent to ECB.
    // aesCbcEncrypt applies PKCS#7 padding, so the output is 32 bytes
    // (16 bytes ciphertext + 16 bytes encrypted padding block).
    // We verify only the first 16 bytes.
    const key = hexToBytes('2b7e151628aed2a6abf7158809cf4f3c')
    const iv = new Uint8Array(16) // zero IV
    const plaintext = hexToBytes('6bc1bee22e409f96e93d7e117393172a')

    const ciphertext = aesCbcEncrypt(plaintext, key, iv)
    // Output is 32 bytes due to PKCS#7 padding (16-byte aligned input gets a full padding block)
    expect(ciphertext.length).toBe(32)
    // First block matches NIST ECB expected ciphertext
    expect(bytesToHex(ciphertext.subarray(0, 16))).toBe('3ad77bb40d7a3660a89ecaf32466ef97')
  })
})

// ─── AES-128 CBC Encrypt/Decrypt Round-Trip ───

describe('AES-128 CBC encrypt/decrypt round-trip', () => {
  // Verifies 4-block AES-128 CBC encryption round-trips with the NIST SP 800-38A key and IV.
  it('NIST SP 800-38A F.2.1/F.2.2 key and IV', () => {
    // Using NIST SP 800-38A test key and IV for AES-128 CBC
    const key = hexToBytes('2b7e151628aed2a6abf7158809cf4f3c')
    const iv = hexToBytes('000102030405060708090a0b0c0d0e0f')
    const plaintext = hexToBytes(
      '6bc1bee22e409f96e93d7e117393172a' +
      'ae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52ef' +
      'f69f2445df4f9b17ad2b417be66c3710',
    )

    const ciphertext = aesCbcEncrypt(plaintext, key, iv)
    const decrypted = aesCbcDecrypt(ciphertext, key, iv)
    expect(bytesToHex(decrypted)).toBe(bytesToHex(plaintext))
  })
})

// ─── AES-256 CBC Encrypt/Decrypt Round-Trip ───

describe('AES-256 CBC encrypt/decrypt round-trip', () => {
  // Verifies 4-block AES-256 CBC encryption round-trips with the NIST SP 800-38A key and IV.
  it('NIST SP 800-38A F.2.5/F.2.6 key and IV', () => {
    // Using NIST SP 800-38A test key and IV for AES-256 CBC
    const key = hexToBytes('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4')
    const iv = hexToBytes('000102030405060708090a0b0c0d0e0f')
    const plaintext = hexToBytes(
      '6bc1bee22e409f96e93d7e117393172a' +
      'ae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52ef' +
      'f69f2445df4f9b17ad2b417be66c3710',
    )

    const ciphertext = aesCbcEncrypt(plaintext, key, iv)
    const decrypted = aesCbcDecrypt(ciphertext, key, iv)
    expect(bytesToHex(decrypted)).toBe(bytesToHex(plaintext))
  })
})

// ─── Arbitrary Data Round-Trip ───

describe('arbitrary data round-trip', () => {
  // Verifies non-vector data of arbitrary length (100 bytes) survives an encrypt/decrypt cycle intact.
  it('encrypt then decrypt returns original data', () => {
    const key = hexToBytes('0123456789abcdef0123456789abcdef')
    const iv = hexToBytes('fedcba9876543210fedcba9876543210')
    const plaintext = new Uint8Array(100)
    for (let i = 0; i < 100; i++) {
      plaintext[i] = i & 0xFF
    }

    const ciphertext = aesCbcEncrypt(plaintext, key, iv)
    const decrypted = aesCbcDecrypt(ciphertext, key, iv)
    expect(bytesToHex(decrypted)).toBe(bytesToHex(plaintext))
  })
})

// ─── PKCS#7 Padding Verification ───

describe('PKCS#7 padding', () => {
  // Verifies PKCS#7 padding makes every ciphertext 16-byte aligned and strictly longer than the input.
  it('ciphertext length is always a multiple of 16', () => {
    const key = hexToBytes('00112233445566778899aabbccddeeff')
    const iv = new Uint8Array(16)

    // Test various plaintext lengths
    const lengths = [0, 1, 15, 16, 17, 31, 32, 33, 63, 64, 100, 255]
    for (let k = 0; k < lengths.length; k++) {
      const plaintext = new Uint8Array(lengths[k]!)
      const ciphertext = aesCbcEncrypt(plaintext, key, iv)
      expect(ciphertext.length % 16).toBe(0)
      // PKCS#7 always adds at least 1 byte of padding, so output > input
      expect(ciphertext.length).toBeGreaterThan(plaintext.length)
    }
  })
})

// ─── Empty Data ───

describe('empty data', () => {
  // Verifies empty input encrypts to a single full padding block and decrypts back to zero bytes.
  it('encrypt/decrypt round-trip for empty input', () => {
    const key = hexToBytes('00112233445566778899aabbccddeeff')
    const iv = new Uint8Array(16)
    const plaintext = new Uint8Array(0)

    const ciphertext = aesCbcEncrypt(plaintext, key, iv)
    // Empty data + PKCS#7 padding = one 16-byte block of padding (all 0x10)
    expect(ciphertext.length).toBe(16)

    const decrypted = aesCbcDecrypt(ciphertext, key, iv)
    expect(decrypted.length).toBe(0)
  })
})

// ─── Block-Aligned Data (16 bytes) ───

describe('block-aligned data (16 bytes)', () => {
  // Verifies exactly block-aligned input gets an extra full padding block and round-trips correctly.
  it('encrypt/decrypt round-trip for exactly 16 bytes', () => {
    const key = hexToBytes('00112233445566778899aabbccddeeff')
    const iv = hexToBytes('aabbccddeeff00112233445566778899')
    const plaintext = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])

    const ciphertext = aesCbcEncrypt(plaintext, key, iv)
    // 16 bytes input + 16 bytes PKCS#7 padding = 32 bytes
    expect(ciphertext.length).toBe(32)

    const decrypted = aesCbcDecrypt(ciphertext, key, iv)
    expect(bytesToHex(decrypted)).toBe(bytesToHex(plaintext))
  })
})

// ─── Non-Aligned Data (31 bytes) ───

describe('non-aligned data (31 bytes)', () => {
  // Verifies a 31-byte input pads with a single byte to 32 bytes and round-trips correctly.
  it('encrypt/decrypt round-trip for 31 bytes', () => {
    const key = hexToBytes('00112233445566778899aabbccddeeff')
    const iv = hexToBytes('aabbccddeeff00112233445566778899')
    const plaintext = new Uint8Array(31)
    for (let i = 0; i < 31; i++) {
      plaintext[i] = (i * 7 + 3) & 0xFF
    }

    const ciphertext = aesCbcEncrypt(plaintext, key, iv)
    // 31 bytes input + 1 byte PKCS#7 padding = 32 bytes
    expect(ciphertext.length).toBe(32)

    const decrypted = aesCbcDecrypt(ciphertext, key, iv)
    expect(bytesToHex(decrypted)).toBe(bytesToHex(plaintext))
  })
})

describe('AES key unwrap (RFC 3394)', () => {
  function hex(s: string): Uint8Array {
    const out = new Uint8Array(s.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
    return out
  }

  it('unwraps the RFC 3394 §4.1 128-bit-key/128-bit-data test vector', () => {
    const kek = hex('000102030405060708090A0B0C0D0E0F')
    const wrapped = hex('1FA68B0A8112B447AEF34BD8FB5A7B829D3E862371D2CFE5')
    const expected = hex('00112233445566778899AABBCCDDEEFF')
    expect(Array.from(aesKeyUnwrap(kek, wrapped))).toEqual(Array.from(expected))
    expect(Array.from(aesKeyWrap(kek, expected))).toEqual(Array.from(wrapped))
  })

  it('unwraps the RFC 3394 §4.6 256-bit-key/256-bit-data test vector', () => {
    const kek = hex('000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F')
    const wrapped = hex('28C9F404C4B810F4CBCCB35CFB87F8263F5786E2D80ED326CBC7F0E71A99F43BFB988B9B7A02DD21')
    const expected = hex('00112233445566778899AABBCCDDEEFF000102030405060708090A0B0C0D0E0F')
    expect(Array.from(aesKeyUnwrap(kek, wrapped))).toEqual(Array.from(expected))
    expect(Array.from(aesKeyWrap(kek, expected))).toEqual(Array.from(wrapped))
  })

  it('throws when the integrity check fails', () => {
    const kek = hex('000102030405060708090A0B0C0D0E0F')
    const corrupted = hex('1FA68B0A8112B447AEF34BD8FB5A7B829D3E862371D2CFE4')
    expect(() => aesKeyUnwrap(kek, corrupted)).toThrow(/integrity check/)
  })
})
