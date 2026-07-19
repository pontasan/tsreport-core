import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { signPdf, type PdfSignatureDigestAlgorithm } from '../../src/pdf/pdf-signer.js'
import { verifyPdfSignatures } from '../../src/pdf/pdf-signature.js'

interface SignatureCase {
  curve: string
  digests: readonly PdfSignatureDigestAlgorithm[]
  eddsa?: true
}

const CASES: readonly SignatureCase[] = [
  { curve: 'prime256v1', digests: ['SHA-256', 'SHA3-256'] },
  { curve: 'secp384r1', digests: ['SHA-384', 'SHA3-384'] },
  { curve: 'secp521r1', digests: ['SHA-512', 'SHA3-512'] },
  { curve: 'brainpoolP256r1', digests: ['SHA-256', 'SHA-384', 'SHA-512', 'SHA3-256', 'SHA3-384', 'SHA3-512'] },
  { curve: 'brainpoolP384r1', digests: ['SHA-384', 'SHA-512', 'SHA3-384', 'SHA3-512'] },
  { curve: 'brainpoolP512r1', digests: ['SHA-512', 'SHA3-512'] },
  { curve: 'ED25519', digests: ['SHA-512'], eddsa: true },
  { curve: 'ED448', digests: ['SHAKE256'], eddsa: true },
]

function bytes(path: string): Uint8Array {
  const value = readFileSync(path)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function unsignedPdf(): Uint8Array {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let value = '%PDF-1.7\n%\x80\x81\x82\x83\n'
  const offsets: number[] = []
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(value.length)
    value += `${i + 1} 0 obj\n${bodies[i]}\nendobj\n`
  }
  const xref = value.length
  value += 'xref\n0 5\n0000000000 65535 f \n'
  for (let i = 0; i < offsets.length; i++) value += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  value += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Uint8Array.from(value, function (character) { return character.charCodeAt(0) & 0xff })
}

function extractCmsAndContent(pdf: Uint8Array): { cms: Uint8Array, content: Uint8Array } {
  const text = Buffer.from(pdf).toString('latin1')
  const range = /\/ByteRange\s*\[0\s+(\d+)\s+(\d+)\s+(\d+)\]/.exec(text)
  const contents = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(text)
  if (range === null || contents === null) throw new Error('signed PDF lacks ByteRange or Contents')
  const firstEnd = Number(range[1])
  const secondStart = Number(range[2])
  const secondLength = Number(range[3])
  const paddedCms = Uint8Array.from(Buffer.from(contents[1]!, 'hex'))
  let headerLength = 2
  let contentLength = paddedCms[1]!
  if ((contentLength & 0x80) !== 0) {
    const count = contentLength & 0x7f
    contentLength = 0
    for (let i = 0; i < count; i++) contentLength = contentLength * 256 + paddedCms[2 + i]!
    headerLength += count
  }
  const content = new Uint8Array(firstEnd + secondLength)
  content.set(pdf.subarray(0, firstEnd))
  content.set(pdf.subarray(secondStart, secondStart + secondLength), firstEnd)
  return { cms: paddedCms.subarray(0, headerLength + contentLength), content }
}

function generateCredential(directory: string, current: SignatureCase): { key: Uint8Array, cert: Uint8Array, keyPem: string } {
  const keyPem = join(directory, `${current.curve}-key.pem`)
  const certPem = join(directory, `${current.curve}-cert.pem`)
  const keyDer = join(directory, `${current.curve}-key.der`)
  const certDer = join(directory, `${current.curve}-cert.der`)
  const keyArguments = current.eddsa === true
    ? ['-newkey', current.curve]
    : ['-newkey', 'ec', '-pkeyopt', `ec_paramgen_curve:${current.curve}`]
  execFileSync('openssl', [
    'req', '-x509', ...keyArguments, '-nodes', '-days', '1', '-subj', `/CN=${current.curve}`,
    '-keyout', keyPem, '-out', certPem,
  ], { stdio: 'ignore' })
  execFileSync('openssl', ['pkey', '-in', keyPem, '-outform', 'DER', '-out', keyDer])
  execFileSync('openssl', ['x509', '-in', certPem, '-outform', 'DER', '-out', certDer])
  return { key: bytes(keyDer), cert: bytes(certDer), keyPem }
}

describe('ISO/TS 32001 and ISO/TS 32002 signature matrix', function () {
  it('generates and verifies every permitted curve/digest pair with an independent CMS verifier', function () {
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-signature-extensions-'))
    try {
      for (let caseIndex = 0; caseIndex < CASES.length; caseIndex++) {
        const current = CASES[caseIndex]!
        const credential = generateCredential(directory, current)
        for (let digestIndex = 0; digestIndex < current.digests.length; digestIndex++) {
          const digestAlgorithm = current.digests[digestIndex]!
          const signed = signPdf({
            pdf: unsignedPdf(),
            privateKeyDer: credential.key,
            certDer: credential.cert,
            signingTime: new Date(Date.UTC(2026, 6, 14, 0, 0, caseIndex * 10 + digestIndex)),
            digestAlgorithm,
            signatureAlgorithm: current.eddsa === true ? 'eddsa' : 'ecdsa',
          })
          const result = verifyPdfSignatures(signed)[0]!
          expect(result.digestValid, `${current.curve}/${digestAlgorithm} digest`).toBe(true)
          expect(result.signatureValid, `${current.curve}/${digestAlgorithm} signature`).toBe(true)
          const extensions = PdfImporter.open(signed).importCatalogModel().extensions
          const iso = extensions?.ISO_
          const levels = (Array.isArray(iso) ? iso : [iso]).map(function (entry) { return entry?.extensionLevel })
          expect(levels).toContain(32002)
          if (digestAlgorithm.startsWith('SHA3-') || digestAlgorithm === 'SHAKE256') expect(levels).toContain(32001)

          const extracted = extractCmsAndContent(signed)
          const cmsPath = join(directory, 'signature.der')
          const contentPath = join(directory, 'content.bin')
          writeFileSync(cmsPath, extracted.cms)
          writeFileSync(contentPath, extracted.content)
          execFileSync('openssl', [
            'cms', '-verify', '-binary', '-inform', 'DER', '-in', cmsPath,
            '-content', contentPath, '-noverify', '-out', join(directory, 'verified.bin'),
          ], { stdio: 'ignore' })

          if (caseIndex === 0 && digestIndex === 0) {
            const encryptedKeyPath = join(directory, 'encrypted-signing-key.der')
            execFileSync('openssl', [
              'pkcs8', '-topk8', '-in', credential.keyPem, '-outform', 'DER', '-out', encryptedKeyPath,
              '-v2', 'aes-256-cbc', '-v2prf', 'hmacWithSHA512', '-iter', '23', '-passout', 'pass:signing-password',
            ], { stdio: 'ignore' })
            const encryptedSigned = signPdf({
              pdf: unsignedPdf(),
              privateKeyDer: bytes(encryptedKeyPath),
              privateKeyPassword: 'signing-password',
              certDer: credential.cert,
              signingTime: new Date(Date.UTC(2026, 6, 14, 1, 0, 0)),
              digestAlgorithm,
              signatureAlgorithm: 'ecdsa',
            })
            expect(verifyPdfSignatures(encryptedSigned)[0]?.signatureValid).toBe(true)
          }
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
