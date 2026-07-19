import { describe, expect, it } from 'vitest'
import { deriveEdDsaPublicKey, signEdDsa, verifyEdDsa } from '../../src/encryption/eddsa.js'

function bytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)!.map(function (byte) { return parseInt(byte, 16) }))
}

function hex(value: Uint8Array): string {
  return Array.from(value, function (byte) { return byte.toString(16).padStart(2, '0') }).join('')
}

describe('RFC 8032 EdDSA', function () {
  it('matches the Ed25519 empty-message test vector', function () {
    const seed = bytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60')
    const publicKey = bytes('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a')
    const signature = bytes('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
      '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b')
    expect(hex(deriveEdDsaPublicKey('Ed25519', seed))).toBe(hex(publicKey))
    expect(hex(signEdDsa('Ed25519', seed, new Uint8Array(0)))).toBe(hex(signature))
    expect(verifyEdDsa('Ed25519', publicKey, new Uint8Array(0), signature)).toBe(true)
  })

  it('matches the Ed448 empty-message test vector', function () {
    const seed = bytes('6c82a562cb808d10d632be89c8513ebf6c929f34ddfa8c9f63c9960ef6e348a3528c8a3fcc2f044e39a3fc5b94492f8f032e7549a20098f95b')
    const publicKey = bytes('5fd7449b59b461fd2ce787ec616ad46a1da1342485a70e1f8a0ea75d80e96778edf124769b46c7061bd6783df1e50f6cd1fa1abeafe8256180')
    const signature = bytes('533a37f6bbe457251f023c0d88f976ae2dfb504a843e34d2074fd823d41a591f2b233f034f628281f2fd7a22ddd47d7828c59bd0a21bfd3980' +
      'ff0d2028d4b18a9df63e006c5d1c2d345b925d8dc00b4104852db99ac5c7cdda8530a113a0f4dbb61149f05a7363268c71d95808ff2e652600')
    expect(hex(deriveEdDsaPublicKey('Ed448', seed))).toBe(hex(publicKey))
    expect(hex(signEdDsa('Ed448', seed, new Uint8Array(0)))).toBe(hex(signature))
    expect(verifyEdDsa('Ed448', publicKey, new Uint8Array(0), signature)).toBe(true)
  })
})
