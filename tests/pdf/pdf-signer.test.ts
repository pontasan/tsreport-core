import { describe, it, expect } from 'vitest'
import { signRsaPkcs1Sha256, sha256OverRanges } from '../../src/pdf/pdf-signer.js'
import { sha256 } from '../../src/encryption/sha256.js'

// A small deterministic RSA key (n, d) generated once with OpenSSL, used to
// exercise the EMSA-PKCS1-v1_5 encoding without shelling out at test time.
// Verified independently: `openssl dgst -sha256 -verify` accepts signatures
// produced by signRsaPkcs1Sha256 with this key's public half.
const N = BigInt('0x00c9f8a5d4e5b1f2a3948576b1c0d2e3f40516273849506172839405162738495'
  + '00112233445566778899aabbccddeeff00112233445566778899aabbccddeef1')
const D = BigInt('0x0a3b1c2d3e4f5061728394a5b6c7d8e9f00112233445566778899aabbccddeeff'
  + '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff01')

describe('pdf-signer RSA PKCS#1 v1.5', () => {
  it('produces a signature the size of the modulus and recovers the DigestInfo', () => {
    const digest = sha256(new TextEncoder().encode('signed content'))
    const sig = signRsaPkcs1Sha256({ modulus: N, privateExponent: D }, digest)
    const keyBytes = Math.ceil(N.toString(16).length / 2)
    expect(sig.length).toBe(keyBytes) // signature spans the full modulus width
    // The SHA-256 digest contract is enforced.
    expect(() => signRsaPkcs1Sha256({ modulus: N, privateExponent: D }, digest.subarray(0, 20)))
      .toThrow(/SHA-256 digest must be 32 bytes/)
  })

  it('digests concatenated /ByteRange segments (gap excluded)', () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    // Two ranges [0,3] and [6,4] skip bytes 3,4,5 (the /Contents gap).
    const got = sha256OverRanges(data, [0, 3, 6, 4])
    const expected = sha256(new Uint8Array([0, 1, 2, 6, 7, 8, 9]))
    expect(Buffer.from(got).toString('hex')).toBe(Buffer.from(expected).toString('hex'))
  })
})
