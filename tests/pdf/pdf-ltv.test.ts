import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { render } from '../../src/renderer/renderer.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { rewritePdfToTraditional } from '../../src/pdf/pdf-rewrite.js'
import { preparePdfDocumentTimestamp, signPdf } from '../../src/pdf/pdf-signer.js'
import { verifyPdfSignatures } from '../../src/pdf/pdf-signature.js'
import {
  appendPdfLongTermValidation,
  pdfVriKey,
  readPdfDocumentSecurityStore,
  verifyPdfLongTermValidation,
} from '../../src/pdf/pdf-ltv.js'

const FONT_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')
const SIGNATURE_FIXTURES = resolve(__dirname, '../fixtures/signatures')
const QPDF_AVAILABLE = spawnSync('qpdf', ['--version']).status === 0
const OPENSSL_AVAILABLE = spawnSync('openssl', ['version']).status === 0

function bytes(path: string): Uint8Array {
  const value = readFileSync(path)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function signedPdf(): Uint8Array {
  const font = Font.load(bytes(FONT_PATH).buffer as ArrayBuffer)
  const backend = new PdfBackend({ fonts: { default: font } })
  render({ pages: [{ width: 200, height: 100, children: [
    { type: 'text', x: 10, y: 30, text: 'Long-term validation', fontId: 'default', fontSize: 14, color: '#000000' },
  ] }] }, backend)
  return signPdf({
    pdf: rewritePdfToTraditional(backend.toUint8Array()),
    privateKeyDer: bytes(join(SIGNATURE_FIXTURES, 'signer-key.der')),
    certDer: bytes(join(SIGNATURE_FIXTURES, 'signer-cert.der')),
    signingTime: new Date(Date.UTC(2026, 6, 14, 3, 0, 0)),
    subFilter: 'ETSI.CAdES.detached',
    fieldName: 'Approval',
  })
}

describe('PDF Document Security Store and VRI', () => {
  it('appends, reads, and merges validation data without changing the signed revision', () => {
    const signed = signedPdf()
    const cert = bytes(join(SIGNATURE_FIXTURES, 'signer-cert.der'))
    const before = verifyPdfSignatures(signed)[0]!
    const ltv = appendPdfLongTermValidation(signed, {
      vri: [{
        fieldName: 'Approval',
        certificates: [cert],
        claimedTime: { kind: 'validation-time', value: new Date(Date.UTC(2026, 6, 14, 3, 30, 0)) },
      }],
    })
    expect(ltv.subarray(0, signed.length)).toEqual(signed)
    const after = verifyPdfSignatures(ltv)[0]!
    expect(after.digestValid).toBe(true)
    expect(after.signatureValid).toBe(true)
    expect(after.modifiedAfterSigning).toBe(true)
    expect(after.signedRevisionLength).toBe(before.signedRevisionLength)
    expect(after.vriKey).toBe(before.vriKey)
    const store = readPdfDocumentSecurityStore(ltv)!
    expect(store.certificates).toEqual([cert])
    expect(store.vri).toHaveLength(1)
    expect(store.vri[0]!.vriKey).toBe(before.vriKey)
    expect(store.vri[0]!.fieldName).toBe('Approval')
    expect(store.vri[0]!.certificates).toEqual([cert])
    expect(store.vri[0]!.claimedTime).toEqual({
      kind: 'validation-time', value: new Date(Date.UTC(2026, 6, 14, 3, 30, 0)),
    })
    const validation = verifyPdfLongTermValidation(ltv, { trustAnchors: [cert] })
    expect(validation).toHaveLength(1)
    expect(validation[0]!.valid).toBe(true)
    expect(validation[0]!.certificateChain.chain).toEqual([cert])

    const merged = appendPdfLongTermValidation(ltv, { certificates: [cert] })
    const mergedStore = readPdfDocumentSecurityStore(merged)!
    expect(mergedStore.certificates).toHaveLength(1)
    expect(mergedStore.vri).toHaveLength(1)
  })

  it('computes the VRI key from the exact lexical /Contents gap', () => {
    const pdf = signedPdf()
    const signature = verifyPdfSignatures(pdf)[0]!
    expect(signature.vriKey).toBe(pdfVriKey(pdf.subarray(signature.byteRange[1]!, signature.byteRange[2]!)))
    expect(signature.vriKey).toMatch(/^[0-9A-F]{40}$/)
  })

  it('rejects validation information for a missing or invalid signature', () => {
    const pdf = signedPdf()
    expect(function () {
      appendPdfLongTermValidation(pdf, {
        vri: [{ fieldName: 'Missing', claimedTime: { kind: 'subsequent-document-timestamp' } }],
      })
    }).toThrow(/was not found/)
    const corrupted = new Uint8Array(pdf)
    corrupted[20] ^= 1
    expect(function () {
      appendPdfLongTermValidation(corrupted, {
        vri: [{ fieldName: 'Approval', claimedTime: { kind: 'subsequent-document-timestamp' } }],
      })
    }).toThrow(/invalid signature/)
  })

  it.skipIf(!QPDF_AVAILABLE)('produces a structurally valid incremental DSS update', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-ltv-'))
    try {
      const cert = bytes(join(SIGNATURE_FIXTURES, 'signer-cert.der'))
      const output = appendPdfLongTermValidation(signedPdf(), {
        certificates: [cert],
        vri: [{ fieldName: 'Approval', certificates: [cert], claimedTime: { kind: 'subsequent-document-timestamp' } }],
      })
      const path = join(directory, 'ltv.pdf')
      writeFileSync(path, output)
      expect(function () { execFileSync('qpdf', ['--check', path], { stdio: 'pipe' }) }).not.toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.skipIf(!OPENSSL_AVAILABLE)('validates repeated DSS and document timestamp renewal chains', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-ltv-chain-'))
    try {
      const tsaKey = join(directory, 'tsa.key')
      const tsaPem = join(directory, 'tsa.pem')
      const tsaDerPath = join(directory, 'tsa.der')
      const serial = join(directory, 'serial')
      const config = join(directory, 'tsa.cnf')
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', tsaKey, '-out', tsaPem, '-days', '2', '-subj', '/CN=LTV Timestamp Authority',
        '-addext', 'keyUsage=critical,digitalSignature',
        '-addext', 'extendedKeyUsage=critical,timeStamping'], { stdio: 'ignore' })
      execFileSync('openssl', ['x509', '-in', tsaPem, '-outform', 'DER', '-out', tsaDerPath])
      writeFileSync(serial, '01\n')
      writeFileSync(config, [
        '[tsa]', 'default_tsa = local_tsa', '[local_tsa]', `serial = ${serial}`,
        `signer_cert = ${tsaPem}`, `signer_key = ${tsaKey}`, 'signer_digest = sha256',
        'default_policy = 1.2.3.4.1', 'digests = sha256',
      ].join('\n'))
      let sequence = 0
      const timestamp = function (pdf: Uint8Array, fieldName: string): Uint8Array {
        const prepared = preparePdfDocumentTimestamp(pdf, { fieldName })
        const request = join(directory, `request-${sequence}.tsq`)
        const token = join(directory, `token-${sequence}.tsr`)
        sequence++
        writeFileSync(request, prepared.request)
        execFileSync('openssl', ['ts', '-reply', '-config', config, '-section', 'local_tsa',
          '-queryfile', request, '-out', token, '-token_out'], { stdio: 'ignore' })
        return prepared.finish(bytes(token))
      }

      const signerCert = bytes(join(SIGNATURE_FIXTURES, 'signer-cert.der'))
      const tsaCert = bytes(tsaDerPath)
      const firstDss = appendPdfLongTermValidation(signedPdf(), {
        vri: [{ fieldName: 'Approval', certificates: [signerCert], claimedTime: { kind: 'subsequent-document-timestamp' } }],
      })
      const firstTimestamp = timestamp(firstDss, 'DocumentTimestamp1')
      const secondDss = appendPdfLongTermValidation(firstTimestamp, {
        vri: [{ fieldName: 'DocumentTimestamp1', certificates: [tsaCert], claimedTime: { kind: 'subsequent-document-timestamp' } }],
      })
      const renewed = timestamp(secondDss, 'DocumentTimestamp2')
      const signatures = verifyPdfSignatures(renewed)
      expect(signatures.map(function (value) { return value.fieldName }).sort()).toEqual([
        'Approval', 'DocumentTimestamp1', 'DocumentTimestamp2',
      ].sort())
      expect(signatures.every(function (value) { return value.digestValid && value.signatureValid })).toBe(true)
      const store = readPdfDocumentSecurityStore(renewed)!
      expect(store.certificates).toHaveLength(2)
      expect(store.vri).toHaveLength(2)
      const validation = verifyPdfLongTermValidation(renewed, { trustAnchors: [signerCert, tsaCert] })
      expect(validation).toHaveLength(2)
      expect(validation.every(function (value) { return value.valid })).toBe(true)
      expect(validation[0]!.claimedTime!.getTime()).toBeLessThanOrEqual(validation[1]!.claimedTime!.getTime())
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
