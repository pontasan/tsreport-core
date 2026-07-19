// Public-key security handler (ISO 32000-1 7.6.4/7.6.5, /Filter /Adobe.PubSec).
// Fixtures are real certificate-encrypted PDFs produced by pyHanko (an
// independent PDF-crypto implementation) with an OpenSSL RSA-2048 recipient;
// the CMS envelope carrying the seed was independently confirmed decryptable
// by `openssl cms -decrypt` during development, so every layer of the recovery
// (CMS/RSA envelope, seed→file-key derivation, per-object AES) is oracle-backed.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { parsePdf, PdfStream } from '../../src/pdf/pdf-parser.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { createPubSecEncryptionContext, type PdfAesKeyWrap, type PdfEcdhKdf, type PdfPubSecContentEncryption, type PdfPubSecRecipient, type PdfRsaOaepDigest } from '../../src/pdf/pdf-pubsec.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { computePermFlags } from '../../src/renderer/pdf-encryption.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'

const FIX = resolve(__dirname, '../fixtures/pubsec')
const CERT = new Uint8Array(readFileSync(resolve(FIX, 'pub-cert.der')))
const KEY = new Uint8Array(readFileSync(resolve(FIX, 'pub-key.der')))
const EC_CERT = new Uint8Array(readFileSync(resolve(FIX, 'ec-cert.der')))
const EC_KEY = new Uint8Array(readFileSync(resolve(FIX, 'ec-key.der')))

function pageText(file: string, recipient?: { certificate: Uint8Array, privateKey: Uint8Array }): string[] {
  const bytes = new Uint8Array(readFileSync(resolve(FIX, file)))
  const doc = parsePdf(bytes, recipient ? { recipient } : {})
  const texts: string[] = []
  for (let n = 1; n < 20; n++) {
    let o: unknown
    try { o = doc.getObject(n) } catch { continue }
    if (o instanceof PdfStream) {
      try {
        const s = new TextDecoder('latin1').decode(doc.decodeStream(o))
        const m = /\(([^)]*)\)\s*Tj/.exec(s)
        if (m) texts.push(m[1]!)
      } catch { /* not a content stream */ }
    }
  }
  return texts
}

describe('public-key security handler', () => {
  it('decrypts a V4/AES-128 certificate-encrypted PDF with the recipient key', () => {
    // The seed is recovered from the CMS envelope, the file key is
    // SHA-1(seed || recipients)[:16], and the content stream decrypts to the
    // original text.
    expect(pageText('fx-v4.pdf', { certificate: CERT, privateKey: KEY })).toEqual(['Solo'])
  })

  it('decrypts a V5/AES-256 certificate-encrypted PDF (SHA-256 file key)', () => {
    expect(pageText('fx-v5.pdf', { certificate: CERT, privateKey: KEY })).toEqual(['Solo'])
  })

  it('connects RFC 8018 encrypted PKCS#8 credentials to PubSec decryption', function () {
    const directory = mkdtempSync(resolve(tmpdir(), 'tsreport-pubsec-pkcs8-'))
    try {
      const keyDer = resolve(directory, 'key.der')
      const keyPem = resolve(directory, 'key.pem')
      const encryptedDer = resolve(directory, 'key-encrypted.der')
      writeFileSync(keyDer, KEY)
      execFileSync('openssl', ['pkey', '-inform', 'DER', '-in', keyDer, '-out', keyPem])
      execFileSync('openssl', [
        'pkcs8', '-topk8', '-in', keyPem, '-outform', 'DER', '-out', encryptedDer,
        '-v2', 'aes-256-cbc', '-v2prf', 'hmacWithSHA512', '-iter', '19', '-passout', 'pass:pubsec-password',
      ])
      const encrypted = new Uint8Array(readFileSync(encryptedDer))
      const pdf = new Uint8Array(readFileSync(resolve(FIX, 'fx-v5.pdf')))
      const document = parsePdf(pdf, {
        recipient: { certificate: CERT, privateKey: encrypted, privateKeyPassword: 'pubsec-password' },
      })
      const page = collectPdfPages(document)[0]!
      const stream = document.resolve(page.dict.get('Contents') as never)
      if (!(stream instanceof PdfStream)) throw new Error('expected a page content stream')
      expect(new TextDecoder('latin1').decode(document.decodeStream(stream))).toContain('(Solo)')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a public-key-encrypted PDF without a recipient credential', () => {
    expect(() => pageText('fx-v4.pdf')).toThrow(/requires a recipient credential/)
  })

  it('fails to recover the key with an unrelated certificate/key pair', () => {
    // A different recipient's issuer+serial matches no RecipientInfo in the
    // envelope, so no seed can be recovered.
    const otherCert = new Uint8Array(readFileSync(resolve(FIX, 'other-cert.der')))
    const otherKey = new Uint8Array(readFileSync(resolve(FIX, 'other-key.der')))
    expect(() => pageText('fx-v4.pdf', { certificate: otherCert, privateKey: otherKey }))
      .toThrow(/no recipient matches/)
  })
})

describe('public-key security handler output', () => {
  function generatedContent(method: 'aes-128' | 'aes-256', recipients: PdfPubSecRecipient[] = [{ certificate: CERT }]): string {
    const backend = new PdfBackend({ fonts: {}, publicKeyEncryption: { method, recipients } })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const raw = new TextDecoder('latin1').decode(bytes)
    expect(raw).toContain('/Filter /Adobe.PubSec')
    const doc = parsePdf(bytes, { recipient: { certificate: CERT, privateKey: KEY } })
    const page = collectPdfPages(doc)[0]!
    const stream = doc.resolve(page.dict.get('Contents') as never)
    if (!(stream instanceof PdfStream)) throw new Error('expected a page content stream')
    return new TextDecoder('latin1').decode(doc.decodeStream(stream))
  }

  it('writes and reads an AES-128 PubSec PDF', () => {
    expect(generatedContent('aes-128')).toContain(' re')
  })

  it('writes and reads an AES-256 PubSec PDF', () => {
    expect(generatedContent('aes-256')).toContain(' re')
  })

  it('writes multiple recipients with independent permissions', () => {
    const otherCert = new Uint8Array(readFileSync(resolve(FIX, 'other-cert.der')))
    const content = generatedContent('aes-128', [
      { certificate: CERT, permissions: { print: true, copy: false } },
      { certificate: otherCert, permissions: { print: false, copy: true } },
    ])
    expect(content).toContain(' re')
  })

  it.each([
    'sha-1', 'sha-224', 'sha-256', 'sha-384', 'sha-512', 'sha3-256', 'sha3-384', 'sha3-512',
  ] as const)('writes and reads RSAES-OAEP KeyTransRecipientInfo with %s', function (digest: PdfRsaOaepDigest) {
    expect(generatedContent('aes-256', [{
      certificate: CERT,
      keyTransport: { algorithm: 'oaep', digest, mgfDigest: digest, label: new TextEncoder().encode('PDF recipient') },
    }])).toContain(' re')
  })

  it('produces an RSAES-OAEP CMS envelope accepted by an independent CMS implementation', function () {
    const context = createPubSecEncryptionContext({
      recipients: [{ certificate: CERT, keyTransport: { algorithm: 'oaep', digest: 'sha-256', mgfDigest: 'sha-384' } }],
      method: 'aes-256',
    })
    const recipient = /\/Recipients \[<([0-9a-f]+)>/.exec(context.encryptDict)
    if (recipient === null) throw new Error('expected a PubSec recipient envelope')
    const directory = mkdtempSync(resolve(tmpdir(), 'tsreport-pubsec-oaep-'))
    try {
      const cmsPath = resolve(directory, 'recipient.der')
      const certDerPath = resolve(directory, 'recipient-cert.der')
      const certPemPath = resolve(directory, 'recipient-cert.pem')
      const keyDerPath = resolve(directory, 'recipient-key.der')
      const keyPemPath = resolve(directory, 'recipient-key.pem')
      const contentPath = resolve(directory, 'content.bin')
      writeFileSync(cmsPath, hexBytes(recipient[1]!))
      writeFileSync(certDerPath, CERT)
      writeFileSync(keyDerPath, KEY)
      execFileSync('openssl', ['x509', '-inform', 'DER', '-in', certDerPath, '-out', certPemPath])
      execFileSync('openssl', ['pkey', '-inform', 'DER', '-in', keyDerPath, '-out', keyPemPath])
      execFileSync('openssl', [
        'cms', '-decrypt', '-inform', 'DER', '-in', cmsPath, '-recip', certPemPath,
        '-inkey', keyPemPath, '-out', contentPath,
      ])
      expect(readFileSync(contentPath)).toHaveLength(24)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('writes an RFC 5753 KeyAgreeRecipientInfo for an EC recipient', () => {
    const backend = new PdfBackend({
      fonts: {},
      publicKeyEncryption: { method: 'aes-256', recipients: [{ certificate: EC_CERT }] },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, { fill: '#00ff00' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const raw = new TextDecoder('latin1').decode(bytes)
    const recipientMatch = /\/Recipients \[<([0-9a-f]+)>/.exec(raw)
    if (recipientMatch === null) throw new Error('expected a PubSec recipient envelope')
    const cms = hexBytes(recipientMatch[1]!)
    const directory = mkdtempSync(resolve(tmpdir(), 'tsreport-pubsec-'))
    try {
      const cmsPath = resolve(directory, 'recipient.der')
      const certificateDerPath = resolve(directory, 'recipient-cert.der')
      const certificatePemPath = resolve(directory, 'recipient-cert.pem')
      const keyDerPath = resolve(directory, 'recipient-key.der')
      const keyPemPath = resolve(directory, 'recipient-key.pem')
      const contentPath = resolve(directory, 'content.bin')
      writeFileSync(cmsPath, cms)
      writeFileSync(certificateDerPath, EC_CERT)
      writeFileSync(keyDerPath, EC_KEY)
      execFileSync('openssl', ['x509', '-inform', 'DER', '-in', certificateDerPath, '-out', certificatePemPath])
      execFileSync('openssl', ['pkey', '-inform', 'DER', '-in', keyDerPath, '-out', keyPemPath])
      execFileSync('openssl', ['cms', '-decrypt', '-inform', 'DER', '-in', cmsPath, '-recip', certificatePemPath, '-inkey', keyPemPath, '-out', contentPath])
      expect(readFileSync(contentPath).length).toBe(24)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
    const doc = parsePdf(bytes, { recipient: { certificate: EC_CERT, privateKey: EC_KEY } })
    const page = collectPdfPages(doc)[0]!
    const stream = doc.resolve(page.dict.get('Contents') as never)
    if (!(stream instanceof PdfStream)) throw new Error('expected a page content stream')
    expect(new TextDecoder('latin1').decode(doc.decodeStream(stream))).toContain(' re')
  })

  it('writes every RFC 5753 standard-ECDH digest and AES-wrap combination', () => {
    const kdfs: PdfEcdhKdf[] = ['sha-1', 'sha-224', 'sha-256', 'sha-384', 'sha-512']
    const wraps: PdfAesKeyWrap[] = ['aes-128', 'aes-192', 'aes-256']
    const directory = mkdtempSync(resolve(tmpdir(), 'tsreport-pubsec-matrix-'))
    try {
      const certificateDerPath = resolve(directory, 'recipient-cert.der')
      const certificatePemPath = resolve(directory, 'recipient-cert.pem')
      const keyDerPath = resolve(directory, 'recipient-key.der')
      const keyPemPath = resolve(directory, 'recipient-key.pem')
      writeFileSync(certificateDerPath, EC_CERT)
      writeFileSync(keyDerPath, EC_KEY)
      execFileSync('openssl', ['x509', '-inform', 'DER', '-in', certificateDerPath, '-out', certificatePemPath])
      execFileSync('openssl', ['pkey', '-inform', 'DER', '-in', keyDerPath, '-out', keyPemPath])
      for (let kdfIndex = 0; kdfIndex < kdfs.length; kdfIndex++) {
        for (let wrapIndex = 0; wrapIndex < wraps.length; wrapIndex++) {
          const kdf = kdfs[kdfIndex]!
          const keyWrap = wraps[wrapIndex]!
          const context = createPubSecEncryptionContext({
            recipients: [{ certificate: EC_CERT, keyAgreement: { kdf, keyWrap } }],
          })
          const recipientMatch = /\/Recipients \[<([0-9a-f]+)>/.exec(context.encryptDict.join(' '))
          if (recipientMatch === null) throw new Error('expected a PubSec recipient envelope')
          const cmsPath = resolve(directory, `${kdf}-${keyWrap}.der`)
          const contentPath = resolve(directory, `${kdf}-${keyWrap}.bin`)
          writeFileSync(cmsPath, hexBytes(recipientMatch[1]!))
          execFileSync('openssl', ['cms', '-decrypt', '-inform', 'DER', '-in', cmsPath, '-recip', certificatePemPath, '-inkey', keyPemPath, '-out', contentPath])
          expect(readFileSync(contentPath).length, `${kdf}/${keyWrap}`).toBe(24)
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('writes and reads a P-384 recipient envelope', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'tsreport-pubsec-p384-'))
    try {
      const certificatePemPath = resolve(directory, 'recipient-cert.pem')
      const certificateDerPath = resolve(directory, 'recipient-cert.der')
      const keyPemPath = resolve(directory, 'recipient-key.pem')
      const keyDerPath = resolve(directory, 'recipient-key.der')
      execFileSync('openssl', [
        'req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp384r1',
        '-nodes', '-days', '1', '-subj', '/CN=PubSec P-384 Oracle', '-keyout', keyPemPath, '-out', certificatePemPath,
      ])
      execFileSync('openssl', ['x509', '-in', certificatePemPath, '-outform', 'DER', '-out', certificateDerPath])
      execFileSync('openssl', ['pkey', '-in', keyPemPath, '-outform', 'DER', '-out', keyDerPath])
      const certificate = new Uint8Array(readFileSync(certificateDerPath))
      const privateKey = new Uint8Array(readFileSync(keyDerPath))
      const backend = new PdfBackend({
        fonts: {},
        publicKeyEncryption: { recipients: [{ certificate, keyAgreement: { kdf: 'sha-384', keyWrap: 'aes-256' } }] },
      })
      backend.beginDocument()
      backend.beginPage(100, 100)
      backend.drawRect(10, 10, 30, 20, { fill: '#0000ff' })
      backend.endPage()
      backend.endDocument()
      const document = parsePdf(backend.toUint8Array(), { recipient: { certificate, privateKey } })
      const page = collectPdfPages(document)[0]!
      const stream = document.resolve(page.dict.get('Contents') as never)
      if (!(stream instanceof PdfStream)) throw new Error('expected a page content stream')
      expect(new TextDecoder('latin1').decode(document.decodeStream(stream))).toContain(' re')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('writes and reads subjectKeyIdentifier recipients for KeyTrans and KeyAgree', () => {
    const cases = [
      { label: 'rsa', certificate: CERT, privateKey: KEY },
      { label: 'ec', certificate: EC_CERT, privateKey: EC_KEY },
    ]
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
      const current = cases[caseIndex]!
      const backend = new PdfBackend({
        fonts: {},
        publicKeyEncryption: {
          recipients: [{ certificate: current.certificate, recipientIdentifier: 'subject-key-identifier' }],
        },
      })
      backend.beginDocument()
      backend.beginPage(100, 100)
      backend.drawRect(10, 10, 30, 20, { fill: '#ff00ff' })
      backend.endPage()
      backend.endDocument()
      const bytes = backend.toUint8Array()
      const raw = new TextDecoder('latin1').decode(bytes)
      const recipientMatch = /\/Recipients \[<([0-9a-f]+)>/.exec(raw)
      if (recipientMatch === null) throw new Error('expected a PubSec recipient envelope')
      const directory = mkdtempSync(resolve(tmpdir(), `tsreport-pubsec-${current.label}-ski-`))
      try {
        const cmsPath = resolve(directory, 'recipient.der')
        const certificateDerPath = resolve(directory, 'recipient-cert.der')
        const certificatePemPath = resolve(directory, 'recipient-cert.pem')
        const keyDerPath = resolve(directory, 'recipient-key.der')
        const keyPemPath = resolve(directory, 'recipient-key.pem')
        const contentPath = resolve(directory, 'content.bin')
        writeFileSync(cmsPath, hexBytes(recipientMatch[1]!))
        writeFileSync(certificateDerPath, current.certificate)
        writeFileSync(keyDerPath, current.privateKey)
        execFileSync('openssl', ['x509', '-inform', 'DER', '-in', certificateDerPath, '-out', certificatePemPath])
        execFileSync('openssl', ['pkey', '-inform', 'DER', '-in', keyDerPath, '-out', keyPemPath])
        execFileSync('openssl', ['cms', '-decrypt', '-inform', 'DER', '-in', cmsPath, '-recip', certificatePemPath, '-inkey', keyPemPath, '-out', contentPath])
        expect(readFileSync(contentPath).length, current.label).toBe(24)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
      const document = parsePdf(bytes, { recipient: { certificate: current.certificate, privateKey: current.privateKey } })
      const page = collectPdfPages(document)[0]!
      const stream = document.resolve(page.dict.get('Contents') as never)
      if (!(stream instanceof PdfStream)) throw new Error('expected a page content stream')
      expect(new TextDecoder('latin1').decode(document.decodeStream(stream))).toContain(' re')
    }
  })

  it('writes every CMS content-encryption algorithm for RSA and EC recipients', () => {
    const algorithms: PdfPubSecContentEncryption[] = ['3des', 'aes-128', 'aes-192', 'aes-256']
    const cases = [
      { label: 'rsa', certificate: CERT, privateKey: KEY },
      { label: 'ec', certificate: EC_CERT, privateKey: EC_KEY },
    ]
    const directory = mkdtempSync(resolve(tmpdir(), 'tsreport-pubsec-content-matrix-'))
    try {
      for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
        const current = cases[caseIndex]!
        const certificateDerPath = resolve(directory, `${current.label}-cert.der`)
        const certificatePemPath = resolve(directory, `${current.label}-cert.pem`)
        const keyDerPath = resolve(directory, `${current.label}-key.der`)
        const keyPemPath = resolve(directory, `${current.label}-key.pem`)
        writeFileSync(certificateDerPath, current.certificate)
        writeFileSync(keyDerPath, current.privateKey)
        execFileSync('openssl', ['x509', '-inform', 'DER', '-in', certificateDerPath, '-out', certificatePemPath])
        execFileSync('openssl', ['pkey', '-inform', 'DER', '-in', keyDerPath, '-out', keyPemPath])
        for (let algorithmIndex = 0; algorithmIndex < algorithms.length; algorithmIndex++) {
          const contentEncryption = algorithms[algorithmIndex]!
          const context = createPubSecEncryptionContext({
            recipients: [{ certificate: current.certificate, contentEncryption }],
          })
          const recipientMatch = /\/Recipients \[<([0-9a-f]+)>/.exec(context.encryptDict.join(' '))
          if (recipientMatch === null) throw new Error('expected a PubSec recipient envelope')
          const cmsPath = resolve(directory, `${current.label}-${contentEncryption}.der`)
          const contentPath = resolve(directory, `${current.label}-${contentEncryption}.bin`)
          writeFileSync(cmsPath, hexBytes(recipientMatch[1]!))
          execFileSync('openssl', ['cms', '-decrypt', '-inform', 'DER', '-in', cmsPath, '-recip', certificatePemPath, '-inkey', keyPemPath, '-out', contentPath])
          expect(readFileSync(contentPath).length, `${current.label}/${contentEncryption}`).toBe(24)
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('writes the V2 RC4 crypt filter at every boundary key length', () => {
    for (const rc4KeyBits of [40, 128]) {
      const backend = new PdfBackend({
        fonts: {},
        publicKeyEncryption: { method: 'rc4', rc4KeyBits, recipients: [{ certificate: CERT }] },
      })
      backend.beginDocument()
      backend.beginPage(100, 100)
      backend.drawRect(10, 10, 30, 20, { fill: '#00ffff' })
      backend.endPage()
      backend.endDocument()
      const bytes = backend.toUint8Array()
      const raw = new TextDecoder('latin1').decode(bytes)
      expect(raw).toContain(`/CFM /V2 /AuthEvent /DocOpen /Length ${rc4KeyBits / 8}`)
      const document = parsePdf(bytes, { recipient: { certificate: CERT, privateKey: KEY } })
      const page = collectPdfPages(document)[0]!
      const stream = document.resolve(page.dict.get('Contents') as never)
      if (!(stream instanceof PdfStream)) throw new Error('expected a page content stream')
      expect(new TextDecoder('latin1').decode(document.decodeStream(stream))).toContain(' re')
    }
  })

  it('routes selected PubSec streams through the Identity crypt filter', () => {
    const backend = new PdfBackend({
      fonts: {},
      publicKeyEncryption: { method: 'aes-128', recipients: [{ certificate: CERT }] },
      identityCryptFilter: { metadata: true, embeddedFiles: ['public.txt'] },
      metadata: { title: 'PUBLIC PUBSEC METADATA' },
      embeddedFiles: [{ name: 'public.txt', data: new TextEncoder().encode('PUBLIC ATTACHMENT') }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, { fill: '#000000' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    const raw = new TextDecoder('latin1').decode(bytes)
    expect(raw).toContain('/Filter /Crypt /DecodeParms << /Name /Identity >>')
    expect(raw).toContain('PUBLIC PUBSEC METADATA')
    const importer = PdfImporter.open(bytes, { recipient: { certificate: CERT, privateKey: KEY } })
    expect(new TextDecoder().decode(importer.importEmbeddedFiles()[0]!.data)).toBe('PUBLIC ATTACHMENT')
  })

  it('preserves each permission payload across mixed RSA and EC recipients', () => {
    const rsaPermissions = { print: true, copy: false, modify: false }
    const ecPermissions = { print: false, copy: true, modify: true }
    const recipients = [
      { certificate: CERT, permissions: rsaPermissions, recipientIdentifier: 'subject-key-identifier' as const, contentEncryption: 'aes-256' as const },
      { certificate: EC_CERT, permissions: ecPermissions, recipientIdentifier: 'issuer-and-serial' as const, contentEncryption: '3des' as const },
    ]
    const backend = new PdfBackend({ fonts: {}, publicKeyEncryption: { recipients } })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, { fill: '#ffff00' })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    for (const credential of [{ certificate: CERT, privateKey: KEY }, { certificate: EC_CERT, privateKey: EC_KEY }]) {
      const document = parsePdf(bytes, { recipient: credential })
      const page = collectPdfPages(document)[0]!
      const stream = document.resolve(page.dict.get('Contents') as never)
      if (!(stream instanceof PdfStream)) throw new Error('expected a page content stream')
      expect(new TextDecoder('latin1').decode(document.decodeStream(stream))).toContain(' re')
    }
    const envelopeHex = Array.from(new TextDecoder('latin1').decode(bytes).matchAll(/<([0-9a-f]+)>/g))
      .map(function (match) { return match[1]! })
      .filter(function (value) { return hexBytes(value)[0] === 0x30 })
    const uniqueEnvelopes = Array.from(new Set(envelopeHex))
    expect(uniqueEnvelopes.length).toBeGreaterThanOrEqual(2)
    const directory = mkdtempSync(resolve(tmpdir(), 'tsreport-pubsec-permissions-'))
    try {
      const cases = [
        { label: 'rsa', envelope: hexBytes(uniqueEnvelopes[0]!), certificate: CERT, privateKey: KEY, permissions: rsaPermissions },
        { label: 'ec', envelope: hexBytes(uniqueEnvelopes[1]!), certificate: EC_CERT, privateKey: EC_KEY, permissions: ecPermissions },
      ]
      for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
        const current = cases[caseIndex]!
        const cmsPath = resolve(directory, `${current.label}.der`)
        const certDerPath = resolve(directory, `${current.label}-cert.der`)
        const certPemPath = resolve(directory, `${current.label}-cert.pem`)
        const keyDerPath = resolve(directory, `${current.label}-key.der`)
        const keyPemPath = resolve(directory, `${current.label}-key.pem`)
        const contentPath = resolve(directory, `${current.label}.bin`)
        writeFileSync(cmsPath, current.envelope)
        writeFileSync(certDerPath, current.certificate)
        writeFileSync(keyDerPath, current.privateKey)
        execFileSync('openssl', ['x509', '-inform', 'DER', '-in', certDerPath, '-out', certPemPath])
        execFileSync('openssl', ['pkey', '-inform', 'DER', '-in', keyDerPath, '-out', keyPemPath])
        execFileSync('openssl', ['cms', '-decrypt', '-inform', 'DER', '-in', cmsPath, '-recip', certPemPath, '-inkey', keyPemPath, '-out', contentPath])
        const content = readFileSync(contentPath)
        expect(content.length).toBe(24)
        expect(content.readInt32LE(20)).toBe(computePermFlags(current.permissions))
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('PubSec CMS content ciphers', () => {
  it('recovers the seed from a 3DES (des-ede3-cbc) enveloped recipient', async () => {
    // cms3des.der is an OpenSSL-produced CMS EnvelopedData (content cipher
    // des-ede3-cbc) enveloping the 24-byte seed24.bin for the same recipient.
    // OpenSSL cms -decrypt recovers seed24.bin, so our recovery of the same
    // file key validates the 3DES content-decryption path against that oracle.
    const { recoverPubSecFileKey } = await import('../../src/pdf/pdf-pubsec.js')
    const { createHash } = await import('node:crypto')
    const recip = new Uint8Array(readFileSync(resolve(FIX, 'cms3des.der')))
    const seed24 = new Uint8Array(readFileSync(resolve(FIX, 'seed24.bin')))
    const md = createHash('sha1'); md.update(seed24.subarray(0, 20)); md.update(recip)
    const expected = new Uint8Array(md.digest().subarray(0, 16))
    const got = recoverPubSecFileKey([recip], { certificate: CERT, privateKey: KEY }, 16, false, true)
    expect(Array.from(got)).toEqual(Array.from(expected))
  })
})

describe('PubSec ECDH (KeyAgreeRecipientInfo) recipients', () => {
  it('recovers the seed from an EC recipient via ECDH + X9.63 KDF + AES key unwrap', async () => {
    // cms-ecdh.der is an OpenSSL-produced CMS EnvelopedData with a
    // KeyAgreeRecipientInfo (prime256v1 recipient, dhSinglePass-stdDH-sha1kdf +
    // id-aes128-wrap) enveloping seed24.bin. OpenSSL cms -decrypt recovers the
    // same seed, so matching its file key validates the whole ECDH path
    // (ECDH shared secret, X9.63 KDF, RFC 3394 key unwrap, content decrypt).
    const { recoverPubSecFileKey } = await import('../../src/pdf/pdf-pubsec.js')
    const { createHash } = await import('node:crypto')
    const cert = new Uint8Array(readFileSync(resolve(FIX, 'ec-cert.der')))
    const key = new Uint8Array(readFileSync(resolve(FIX, 'ec-key.der')))
    const recip = new Uint8Array(readFileSync(resolve(FIX, 'cms-ecdh.der')))
    const seed24 = new Uint8Array(readFileSync(resolve(FIX, 'seed24.bin')))
    const md = createHash('sha1'); md.update(seed24.subarray(0, 20)); md.update(recip)
    const expected = new Uint8Array(md.digest().subarray(0, 16))
    const got = recoverPubSecFileKey([recip], { certificate: cert, privateKey: key }, 16, false, true)
    expect(Array.from(got)).toEqual(Array.from(expected))
  })
})

function hexBytes(value: string): Uint8Array {
  const result = new Uint8Array(value.length / 2)
  for (let i = 0; i < result.length; i++) result[i] = parseInt(value.substring(i * 2, i * 2 + 2), 16)
  return result
}
