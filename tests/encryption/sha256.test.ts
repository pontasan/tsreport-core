import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { sha224, sha256 } from '../../src/encryption/sha256'

// ─── Hex Helpers ───

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

function stringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i)
  }
  return bytes
}

// ─── NIST FIPS 180-4 Test Vectors ───

describe('sha256 NIST test vectors', () => {
  // Verifies the digest of empty input matches the FIPS 180-4 known-answer value.
  it('empty string', () => {
    const hash = sha256(new Uint8Array(0))
    expect(bytesToHex(hash)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  // Verifies the canonical single-block "abc" FIPS 180-4 test vector.
  it('"abc"', () => {
    const hash = sha256(stringToBytes('abc'))
    expect(bytesToHex(hash)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  // Verifies the 448-bit FIPS 180-4 vector whose padding spills into a second block.
  it('"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" (448 bits)', () => {
    const hash = sha256(stringToBytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
    expect(bytesToHex(hash)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })
})

// ─── Output Properties ───

describe('sha256 output properties', () => {
  // Verifies the digest is 32 bytes for a range of input lengths spanning block/padding boundaries.
  it('hash output is always 32 bytes', () => {
    const lengths = [0, 1, 15, 16, 55, 56, 63, 64, 100, 256, 1024]
    for (let i = 0; i < lengths.length; i++) {
      const data = new Uint8Array(lengths[i]!)
      const hash = sha256(data)
      expect(hash.length).toBe(32)
    }
  })

  // Verifies hashing is deterministic: the same input always yields the same digest.
  it('repeated hashing produces the same result (deterministic)', () => {
    const data = stringToBytes('deterministic test input')
    const hash1 = sha256(data)
    const hash2 = sha256(data)
    const hash3 = sha256(data)
    expect(bytesToHex(hash1)).toBe(bytesToHex(hash2))
    expect(bytesToHex(hash2)).toBe(bytesToHex(hash3))
  })
})

// ─── Large Input ───

describe('sha256 large input', () => {
  // Verifies a 16-block (1024-byte) input hashes to the known digest, exercising multi-block chaining.
  it('1024 bytes of zeros', () => {
    const data = new Uint8Array(1024)
    const hash = sha256(data)
    // SHA-256 of 1024 zero bytes:
    // 5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef
    expect(bytesToHex(hash)).toBe('5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef')
    expect(hash.length).toBe(32)
  })
})

describe('sha224 FIPS and independent implementation vectors', () => {
  it('matches the FIPS empty and abc known-answer values', () => {
    expect(bytesToHex(sha224(new Uint8Array()))).toBe('d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f')
    expect(bytesToHex(sha224(stringToBytes('abc')))).toBe('23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7')
  })

  it('matches the platform cryptographic implementation across padding boundaries', () => {
    for (const length of [1, 55, 56, 63, 64, 65, 1024]) {
      const input = Uint8Array.from({ length }, function (_value, index) { return index & 0xff })
      const expected = createHash('sha224').update(input).digest('hex')
      expect(bytesToHex(sha224(input))).toBe(expected)
    }
  })
})
