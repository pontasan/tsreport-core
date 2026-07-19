import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { rewritePdfToTraditional } from '../../src/pdf/pdf-rewrite.js'
import { preparePdfDocumentTimestamp, signPdf } from '../../src/pdf/pdf-signer.js'
import {
  buildRfc3161TimestampRequest,
  parseRfc3161TimestampRequest,
  parseRfc3161TimestampToken,
  type Rfc3161DigestAlgorithm,
} from '../../src/pdf/pdf-rfc3161.js'
import { verifyPdfSignatures } from '../../src/pdf/pdf-signature.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import {
  derContext,
  derContextConstructed,
  derContextPrimitive,
  derInteger,
  derIntegerFromNumber,
  derNull,
  derOctetString,
  derOid,
  derRaw,
  derSequence,
  derSet,
} from '../../src/pdf/der-encoder.js'
import { hybridSigningPdf } from './signing-fixtures.js'

const OPENSSL_AVAILABLE = spawnSync('openssl', ['version']).status === 0
const PDFSIG_AVAILABLE = spawnSync('pdfsig', ['-v']).status === 0
const CERTUTIL_AVAILABLE = spawnSync('certutil', ['-H']).status === 0
const FONT_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')
const SIGNATURE_FIXTURES = resolve(__dirname, '../fixtures/signatures')

function bytes(path: string): Uint8Array {
  const value = readFileSync(path)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

const DIGEST_OIDS: Record<Rfc3161DigestAlgorithm, string> = {
  'SHA-1': '1.3.14.3.2.26',
  'SHA-256': '2.16.840.1.101.3.4.2.1',
  'SHA-384': '2.16.840.1.101.3.4.2.2',
  'SHA-512': '2.16.840.1.101.3.4.2.3',
  'SHA3-256': '2.16.840.1.101.3.4.2.8',
  'SHA3-384': '2.16.840.1.101.3.4.2.9',
  'SHA3-512': '2.16.840.1.101.3.4.2.10',
  'SHAKE256': '2.16.840.1.101.3.4.2.12',
  'RIPEMD-160': '1.3.36.3.2.1',
}

function rawTlv(tag: number, content: Uint8Array): Uint8Array {
  if (content.length >= 128) throw new Error('test DER helper only supports short values')
  return new Uint8Array([tag, content.length, ...content])
}

function asciiTlv(tag: number, text: string): Uint8Array {
  return rawTlv(tag, new TextEncoder().encode(text))
}

interface SyntheticTimestampOptions {
  digestAlgorithm?: Rfc3161DigestAlgorithm
  imprint?: Uint8Array
  policy?: string
  genTime?: string
  accuracy?: Uint8Array
  ordering?: boolean
  nonce?: bigint
  tsa?: Uint8Array
  extensions?: Uint8Array[]
  certificatesIncluded?: boolean
}

function syntheticTimestampToken(options: SyntheticTimestampOptions = {}): Uint8Array {
  const digestAlgorithm = options.digestAlgorithm ?? 'SHA-256'
  const imprint = options.imprint ?? new Uint8Array(
    digestAlgorithm === 'SHA-384' || digestAlgorithm === 'SHA3-384' ? 48
      : digestAlgorithm === 'SHA-512' || digestAlgorithm === 'SHA3-512' || digestAlgorithm === 'SHAKE256' ? 64
        : digestAlgorithm === 'SHA-256' || digestAlgorithm === 'SHA3-256' ? 32 : 20,
  )
  const tstFields: Uint8Array[] = [
    derIntegerFromNumber(1),
    derOid(options.policy ?? '1.2.3.4.1'),
    derSequence(derSequence(derOid(DIGEST_OIDS[digestAlgorithm]), derNull()), derOctetString(imprint)),
    derInteger(42n),
    asciiTlv(0x18, options.genTime ?? '20260714032100Z'),
  ]
  if (options.accuracy !== undefined) tstFields.push(options.accuracy)
  if (options.ordering) tstFields.push(new Uint8Array([0x01, 0x01, 0xFF]))
  if (options.nonce !== undefined) tstFields.push(derInteger(options.nonce))
  if (options.tsa !== undefined) tstFields.push(derContext(0, options.tsa))
  if (options.extensions !== undefined) tstFields.push(derContextConstructed(1, ...options.extensions))
  const encodedTstInfo = derSequence(...tstFields)
  const signedDataFields: Uint8Array[] = [
    derIntegerFromNumber(3),
    derSet(derSequence(derOid(DIGEST_OIDS[digestAlgorithm]), derNull())),
    derSequence(derOid('1.2.840.113549.1.9.16.1.4'), derContext(0, derOctetString(encodedTstInfo))),
  ]
  if (options.certificatesIncluded) signedDataFields.push(derContextConstructed(0, derSequence()))
  signedDataFields.push(derSet())
  return derSequence(
    derOid('1.2.840.113549.1.7.2'),
    derContext(0, derSequence(...signedDataFields)),
  )
}

describe('RFC 3161 ASN.1 fields', () => {
  it('round-trips every PDF MessageImprint algorithm and every request option', () => {
    const lengths: Record<Rfc3161DigestAlgorithm, number> = {
      'SHA-1': 20, 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64, 'RIPEMD-160': 20,
      'SHA3-256': 32, 'SHA3-384': 48, 'SHA3-512': 64, 'SHAKE256': 64,
    }
    for (const digestAlgorithm of Object.keys(lengths) as Rfc3161DigestAlgorithm[]) {
      const imprint = new Uint8Array(lengths[digestAlgorithm]).fill(0xA5)
      const request = buildRfc3161TimestampRequest(imprint, {
        digestAlgorithm,
        policy: '2.999.3.4',
        nonce: 0xFEDCBA9876543210n,
        certReq: true,
        extensions: [{ oid: '2.999.7.1', critical: true, value: new Uint8Array([0x05, 0x00]) }],
      })
      expect(parseRfc3161TimestampRequest(request)).toEqual({
        digestAlgorithm,
        messageImprint: imprint,
        policy: '2.999.3.4',
        nonce: 0xFEDCBA9876543210n,
        certReq: true,
        extensions: [{ oid: '2.999.7.1', critical: true, value: new Uint8Array([0x05, 0x00]) }],
      })
    }
    const noCertificate = parseRfc3161TimestampRequest(buildRfc3161TimestampRequest(new Uint8Array(32), { certReq: false }))
    expect(noCertificate.certReq).toBe(false)
  })

  it('parses fractional genTime, accuracy, ordering, nonce, tsa, extensions, and certificate presence', () => {
    const extension = derSequence(derOid('2.999.7.1'), new Uint8Array([0x01, 0x01, 0xFF]), derOctetString(new Uint8Array([1, 2, 3])))
    const token = syntheticTimestampToken({
      genTime: '20260714032100.123456789Z',
      accuracy: derSequence(derInteger(2n), derContextPrimitive(0, new Uint8Array([0x01, 0xF4])), derContextPrimitive(1, new Uint8Array([25]))),
      ordering: true,
      nonce: 123456789n,
      tsa: rawTlv(0x82, new TextEncoder().encode('tsa.example.test')),
      extensions: [extension],
      certificatesIncluded: true,
    })
    const info = parseRfc3161TimestampToken(token)
    expect(info.generationTimeText).toBe('20260714032100.123456789Z')
    expect(info.generationTimeFraction).toBe('123456789')
    expect(info.generationTime.toISOString()).toBe('2026-07-14T03:21:00.123Z')
    expect(info.accuracy).toEqual({ seconds: 2n, millis: 500, micros: 25 })
    expect(info.ordering).toBe(true)
    expect(info.nonce).toBe(123456789n)
    expect(info.tsa?.tag).toBe(2)
    expect(info.extensions).toEqual([{ oid: '2.999.7.1', critical: true, value: new Uint8Array([1, 2, 3]) }])
    expect(info.certificatesIncluded).toBe(true)
  })

  it('rejects non-DER time forms, invalid calendar values, and invalid Accuracy ranges', () => {
    for (const genTime of [
      '202607140321Z',
      '20260714032100+0000',
      '20260714032100,1Z',
      '20260714032100.120Z',
      '20260230032100Z',
    ]) {
      expect(function () { parseRfc3161TimestampToken(syntheticTimestampToken({ genTime })) }).toThrow(/genTime/)
    }
    expect(function () {
      parseRfc3161TimestampToken(syntheticTimestampToken({
        accuracy: derSequence(derContextPrimitive(0, new Uint8Array([0]))),
      }))
    }).toThrow(/between 1 and 999/)
    expect(function () {
      buildRfc3161TimestampRequest(new Uint8Array(31), { digestAlgorithm: 'SHA-256' })
    }).toThrow(/must be 32 bytes/)
  })
})

describe('RFC 3161 PDF document timestamps', () => {
  it.each(['SHA3-256', 'SHA3-384', 'SHA3-512', 'SHAKE256'] as const)(
    'connects %s MessageImprint and the ISO/TS 32001 extension to document timestamps',
    function (digestAlgorithm) {
      const backend = new PdfBackend({ fonts: {} })
      render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
      const prepared = preparePdfDocumentTimestamp(backend.toUint8Array(), { digestAlgorithm, certReq: false })
      const output = prepared.finish(syntheticTimestampToken({
        digestAlgorithm,
        imprint: prepared.messageImprint,
      }))
      const iso = PdfImporter.open(output).importCatalogModel().extensions?.ISO_
      const levels = (Array.isArray(iso) ? iso : [iso]).map(function (value) { return value?.extensionLevel })
      expect(levels).toContain(32001)
    },
  )

  it('enforces policy, nonce, and certReq while embedding a returned token', () => {
    const font = Font.load(bytes(FONT_PATH).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { default: font } })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    const input = backend.toUint8Array()
    const prepared = preparePdfDocumentTimestamp(input, {
      policy: '1.2.3.4.1', nonce: 987654321n, certReq: false,
    })
    const matching = syntheticTimestampToken({
      imprint: prepared.messageImprint, policy: '1.2.3.4.1', nonce: 987654321n,
    })
    expect(prepared.finish(matching).subarray(0, input.length)).toEqual(input)
    expect(function () {
      prepared.finish(syntheticTimestampToken({
        imprint: prepared.messageImprint, policy: '1.2.3.4.2', nonce: 987654321n,
      }))
    }).toThrow(/policy does not match/)
    expect(function () {
      prepared.finish(syntheticTimestampToken({
        imprint: prepared.messageImprint, policy: '1.2.3.4.1', nonce: 987654322n,
      }))
    }).toThrow(/nonce does not match/)
    expect(function () {
      prepared.finish(syntheticTimestampToken({
        imprint: prepared.messageImprint, policy: '1.2.3.4.1', nonce: 987654321n, certificatesIncluded: true,
      }))
    }).toThrow(/certificates do not match/)
  })

  it.skipIf(!OPENSSL_AVAILABLE)('appends timestamps to xref/object-stream, hybrid-reference, and incremental inputs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-rfc3161-structures-'))
    try {
      const font = Font.load(bytes(FONT_PATH).buffer as ArrayBuffer)
      const backend = new PdfBackend({ fonts: { default: font } })
      render({ pages: [{ width: 200, height: 100, children: [
        { type: 'text', x: 10, y: 30, text: 'Structure matrix', fontId: 'default', fontSize: 14, color: '#000000' },
      ] }] }, backend)
      const xrefAndObjectStreams = backend.toUint8Array()
      const incrementallySigned = signPdf({
        pdf: xrefAndObjectStreams,
        privateKeyDer: bytes(join(SIGNATURE_FIXTURES, 'signer-key.der')),
        certDer: bytes(join(SIGNATURE_FIXTURES, 'signer-cert.der')),
        signingTime: new Date(Date.UTC(2026, 6, 13, 2, 0, 0)),
      })
      const inputs = [xrefAndObjectStreams, hybridSigningPdf(), incrementallySigned]

      const keyPath = join(directory, 'tsa-key.pem')
      const certPath = join(directory, 'tsa-cert.pem')
      const serialPath = join(directory, 'serial')
      const configPath = join(directory, 'tsa.cnf')
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyPath, '-out', certPath, '-days', '1',
        '-subj', '/CN=TSReport Structure Timestamp Authority',
        '-addext', 'keyUsage=critical,digitalSignature',
        '-addext', 'extendedKeyUsage=critical,timeStamping',
      ], { stdio: 'ignore' })
      writeFileSync(serialPath, '01\n')
      writeFileSync(configPath, [
        '[tsa]', 'default_tsa = tsa_config', '[tsa_config]', `serial = ${serialPath}`,
        `signer_cert = ${certPath}`, `signer_key = ${keyPath}`, 'signer_digest = sha256',
        'default_policy = 1.2.3.4.1', 'digests = sha256',
      ].join('\n'))

      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i]!
        const prepared = preparePdfDocumentTimestamp(input)
        const requestPath = join(directory, `request-${i}.tsq`)
        const tokenPath = join(directory, `token-${i}.tsr`)
        writeFileSync(requestPath, prepared.request)
        execFileSync('openssl', [
          'ts', '-reply', '-config', configPath, '-section', 'tsa_config',
          '-queryfile', requestPath, '-out', tokenPath, '-token_out',
        ], { stdio: 'ignore' })
        const timestamped = prepared.finish(bytes(tokenPath))
        expect(timestamped.subarray(0, input.length)).toEqual(input)
        const timestamp = verifyPdfSignatures(timestamped).find(function (value) { return value.subFilter === 'ETSI.RFC3161' })!
        expect(timestamp.digestValid).toBe(true)
        expect(timestamp.signatureValid).toBe(true)
        expect(timestamp.coversWholeDocument).toBe(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.skipIf(!OPENSSL_AVAILABLE)('round-trips a token issued by an independent local timestamp authority', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-rfc3161-'))
    try {
      const font = Font.load(bytes(FONT_PATH).buffer as ArrayBuffer)
      const backend = new PdfBackend({ fonts: { default: font } })
      render({ pages: [{ width: 200, height: 100, children: [
        { type: 'text', x: 10, y: 30, text: 'Timestamped', fontId: 'default', fontSize: 14, color: '#000000' },
      ] }] }, backend)
      const unsigned = rewritePdfToTraditional(backend.toUint8Array())
      const cadesSigned = signPdf({
        pdf: unsigned,
        privateKeyDer: bytes(join(SIGNATURE_FIXTURES, 'signer-key.der')),
        certDer: bytes(join(SIGNATURE_FIXTURES, 'signer-cert.der')),
        signingTime: new Date(Date.UTC(2026, 6, 11, 0, 0, 0)),
        subFilter: 'ETSI.CAdES.detached',
      })
      const prepared = preparePdfDocumentTimestamp(cadesSigned, {
        digestAlgorithm: 'SHA-512',
        policy: '1.2.3.4.1',
        nonce: 0x123456789ABCDEFn,
      })

      const keyPath = join(directory, 'tsa-key.pem')
      const certPath = join(directory, 'tsa-cert.pem')
      const requestPath = join(directory, 'request.tsq')
      const tokenPath = join(directory, 'token.tsr')
      const serialPath = join(directory, 'serial')
      const configPath = join(directory, 'tsa.cnf')
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyPath, '-out', certPath, '-days', '1',
        '-subj', '/CN=TSReport Local Timestamp Authority',
        '-addext', 'keyUsage=critical,digitalSignature',
        '-addext', 'extendedKeyUsage=critical,timeStamping',
      ], { stdio: 'ignore' })
      writeFileSync(requestPath, prepared.request)
      writeFileSync(serialPath, '01\n')
      writeFileSync(configPath, [
        '[tsa]',
        'default_tsa = tsa_config',
        '[tsa_config]',
        `serial = ${serialPath}`,
        `signer_cert = ${certPath}`,
        `signer_key = ${keyPath}`,
        'signer_digest = sha256',
        'default_policy = 1.2.3.4.1',
        'digests = sha512',
        'accuracy = secs:1',
        'ordering = yes',
        'tsa_name = yes',
        'ess_cert_id_chain = no',
      ].join('\n'))
      execFileSync('openssl', [
        'ts', '-reply', '-config', configPath, '-section', 'tsa_config',
        '-queryfile', requestPath, '-out', tokenPath, '-token_out',
      ], { stdio: 'ignore' })

      const token = bytes(tokenPath)
      const timestamp = parseRfc3161TimestampToken(token)
      expect(timestamp.digestAlgorithm).toBe('SHA-512')
      expect(timestamp.messageImprint).toEqual(prepared.messageImprint)
      expect(timestamp.policy).toBe('1.2.3.4.1')
      expect(timestamp.nonce).toBe(0x123456789ABCDEFn)
      expect(timestamp.accuracy).toEqual({ seconds: 1n, millis: 0, micros: 0 })
      expect(timestamp.ordering).toBe(true)
      expect(timestamp.tsa?.tag).toBe(4)
      expect(timestamp.certificatesIncluded).toBe(true)
      const timestamped = prepared.finish(token)
      const results = verifyPdfSignatures(timestamped)
      expect(results).toHaveLength(2)
      const cadesResult = results.find(function (result) { return result.subFilter === 'ETSI.CAdES.detached' })!
      expect(cadesResult.signatureValid).toBe(true)
      expect(cadesResult.modifiedAfterSigning).toBe(true)
      const result = results.find(function (entry) { return entry.subFilter === 'ETSI.RFC3161' })!
      expect(result.subFilter).toBe('ETSI.RFC3161')
      expect(result.fieldName).toBe('DocumentTimestamp1')
      expect(result.digestValid).toBe(true)
      expect(result.signatureValid).toBe(true)
      expect(result.coversWholeDocument).toBe(true)
      expect(result.signingTime).toEqual(timestamp.generationTime)

      if (PDFSIG_AVAILABLE && CERTUTIL_AVAILABLE) {
        const pdfPath = join(directory, 'timestamped.pdf')
        const nssPath = join(directory, 'nss')
        mkdirSync(nssPath)
        execFileSync('certutil', ['-N', '-d', `sql:${nssPath}`, '--empty-password'], { stdio: 'ignore' })
        writeFileSync(pdfPath, timestamped)
        const output = execFileSync('pdfsig', ['-nssdir', `sql:${nssPath}`, '-nocert', pdfPath], { encoding: 'utf8' })
        expect(output).toContain('Signature is Valid')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.skipIf(!OPENSSL_AVAILABLE)('rejects a token issued for a different prepared PDF', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-rfc3161-mismatch-'))
    try {
      const font = Font.load(bytes(FONT_PATH).buffer as ArrayBuffer)
      const renderPrepared = function (text: string) {
        const backend = new PdfBackend({ fonts: { default: font } })
        render({ pages: [{ width: 200, height: 100, children: [
          { type: 'text', x: 10, y: 30, text, fontId: 'default', fontSize: 14, color: '#000000' },
        ] }] }, backend)
        return preparePdfDocumentTimestamp(rewritePdfToTraditional(backend.toUint8Array()))
      }
      const first = renderPrepared('First')
      const second = renderPrepared('Second')
      const keyPath = join(directory, 'key.pem')
      const certPath = join(directory, 'cert.pem')
      const requestPath = join(directory, 'request.tsq')
      const tokenPath = join(directory, 'token.tsr')
      const serialPath = join(directory, 'serial')
      const configPath = join(directory, 'tsa.cnf')
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
        '-days', '1', '-subj', '/CN=Mismatch TSA',
        '-addext', 'keyUsage=critical,digitalSignature',
        '-addext', 'extendedKeyUsage=critical,timeStamping',
      ], { stdio: 'ignore' })
      writeFileSync(requestPath, first.request)
      writeFileSync(serialPath, '01\n')
      writeFileSync(configPath, [
        '[tsa]', 'default_tsa = tsa_config', '[tsa_config]', `serial = ${serialPath}`,
        `signer_cert = ${certPath}`, `signer_key = ${keyPath}`, 'signer_digest = sha256',
        'default_policy = 1.2.3.4.1', 'digests = sha256',
      ].join('\n'))
      execFileSync('openssl', [
        'ts', '-reply', '-config', configPath, '-section', 'tsa_config',
        '-queryfile', requestPath, '-out', tokenPath, '-token_out',
      ], { stdio: 'ignore' })
      expect(function () { second.finish(bytes(tokenPath)) }).toThrow(/MessageImprint does not match/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
