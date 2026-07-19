import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'
import { signOpenTypeResource } from '../src/font-signature.js'
import { parseFont } from '../src/parsers/index.js'
import { buildFontCollection } from '../src/subset/collection.js'

const FONT = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const SIGNATURE_FIXTURES = resolve(__dirname, 'fixtures/signatures')

function arrayBuffer(path: string): ArrayBuffer {
  const data = readFileSync(path)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function signingOptions(cannotBeResigned = false) {
  return {
    privateKeyDer: new Uint8Array(arrayBuffer(resolve(SIGNATURE_FIXTURES, 'signer-key.der'))),
    certDer: new Uint8Array(arrayBuffer(resolve(SIGNATURE_FIXTURES, 'signer-cert.der'))),
    signingTime: new Date(Date.UTC(2026, 6, 13, 9, 0, 0)),
    cannotBeResigned,
  }
}

describe('OpenType DSIG signing and verification', () => {
  it('signs and verifies a standalone font through the public Font API', () => {
    const signed = signOpenTypeResource(arrayBuffer(FONT), signingOptions())
    const font = Font.load(signed)

    expect(font.dsig).toMatchObject({ version: 1, flags: 0 })
    expect(font.verifySignatures()).toEqual([expect.objectContaining({
      format: 1,
      scope: 'font',
      cannotBeResigned: false,
      digestAlgorithm: 'SHA-256',
      digestValid: true,
      signatureValid: true,
      signerCommonName: 'TSReport Signer',
      signingTime: signingOptions().signingTime,
    })])
  })

  it('detects changes to signed font content independently of CMS authenticity', () => {
    const signed = signOpenTypeResource(arrayBuffer(FONT), signingOptions())
    const sfnt = parseFont(signed)
    const name = sfnt.tableDirectory.get('name')!
    const changed = signed.slice(0)
    const bytes = new Uint8Array(changed)
    bytes[name.offset + name.length - 1] ^= 1

    expect(Font.load(changed).verifySignatures()[0]).toMatchObject({
      digestValid: false,
      signatureValid: true,
    })
  })

  it('enforces the cannot-be-resigned flag and drops stale signatures on subset', () => {
    const signed = signOpenTypeResource(arrayBuffer(FONT), signingOptions(true))
    expect(() => signOpenTypeResource(signed, signingOptions())).toThrow('forbids re-signing')

    const subset = Font.load(signed).subset('Invoice 123')
    expect(parseFont(subset).tableDirectory.has('DSIG')).toBe(false)
  })

  it('signs and verifies a complete version 2 collection resource', () => {
    const source = arrayBuffer(FONT)
    const collection = buildFontCollection([source, source], { majorVersion: 2 })
    const signed = signOpenTypeResource(collection, signingOptions())
    const first = Font.load(signed, { fontIndex: 0 })
    const second = first.getCollectionFont(1)

    expect(first.collection).toMatchObject({ majorVersion: 2, numFonts: 2 })
    expect(second.verifySignatures()).toEqual([expect.objectContaining({
      scope: 'collection',
      digestValid: true,
      signatureValid: true,
      signerCommonName: 'TSReport Signer',
    })])
  })
})
