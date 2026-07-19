// End-to-end: sign a rendered PDF and verify it with our own verifier — the
// symmetric counterpart of pdf-signature.ts. The key/cert are a test-only
// self-signed RSA-2048 pair; the produced signature is also accepted by
// poppler's pdfsig (validated manually against the external oracle).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { Font } from '../../src/font.js'
import { rewritePdfToTraditional } from '../../src/pdf/pdf-rewrite.js'
import { signPdf } from '../../src/pdf/pdf-signer.js'
import { verifyPdfSignatures } from '../../src/pdf/pdf-signature.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { appendIncrementalUpdate } from '../../src/pdf/pdf-incremental.js'
import { hybridSigningPdf } from './signing-fixtures.js'

const FIX = resolve(__dirname, '../fixtures/signatures')
const FONT = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')

const P256_KEY = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgpWvPA2ReCdTtBci4ZllRH8sKp1iMd+8PDSMDGElkIxqhRANCAASkex3coh/vQ77nY0xwMteJEQSFRKSso6nuuW13Wmz5SAzVDn74SIdX58cSbPAQCz15tVxDEOTYTZepsp8BUV5K'
const P256_CERT = 'MIIBkzCCATmgAwIBAgIUHHEBANmfqZtm4pul5Ks7x40DPCkwCgYIKoZIzj0EAwIwHzEdMBsGA1UEAwwUVFNSZXBvcnQgUDI1NiBTaWduZXIwHhcNMjYwNzEzMTgwMDEwWhcNMzYwNzEwMTgwMDEwWjAfMR0wGwYDVQQDDBRUU1JlcG9ydCBQMjU2IFNpZ25lcjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKR7HdyiH+9DvudjTHAy14kRBIVEpKyjqe65bXdabPlIDNUOfvhIh1fnxxJs8BALPXm1XEMQ5NhNl6mynwFRXkqjUzBRMB8GA1UdIwQYMBaAFFMLEfJMhbnr+7679lDx7do+6AtrMA8GA1UdEwEB/wQFMAMBAf8wHQYDVR0OBBYEFFMLEfJMhbnr+7679lDx7do+6AtrMAoGCCqGSM49BAMCA0gAMEUCIQCHKXVnScom0bxWyLHJ8iavs5OmeB3KzdEfuD5unYXfuwIgFzjt6e3W0irSZY0kWlUTADwjRLiv3NUqMrYn+j8Of2o='
const P384_KEY = 'MIG2AgEAMBAGByqGSM49AgEGBSuBBAAiBIGeMIGbAgEBBDAjc9uex0ycmb0Zzmq1ulqsw+p+JdooeY+JdvdMXTrjMM5KmNfFX6EvEl7rYvQlMDGhZANiAAQ4hkku0rxh5GBhkdoJ0dsHBGyQ6vzhD3gYIAVxzOvkrh+4LOcMqAyLFQmGkXgbHXF2/rMYNwEdDD5Yr2yhVhDIvLPP+lYDz4RKscnzaCt5eX/zdRauZg3BGi0d/IMdR5I='
const P384_CERT = 'MIIB0DCCAVagAwIBAgIUbYYqhhD45KAh4Y24iuTto1+SCzgwCgYIKoZIzj0EAwIwHzEdMBsGA1UEAwwUVFNSZXBvcnQgUDM4NCBTaWduZXIwHhcNMjYwNzEzMTgwMDEwWhcNMzYwNzEwMTgwMDEwWjAfMR0wGwYDVQQDDBRUU1JlcG9ydCBQMzg0IFNpZ25lcjB2MBAGByqGSM49AgEGBSuBBAAiA2IABDiGSS7SvGHkYGGR2gnR2wcEbJDq/OEPeBggBXHM6+SuH7gs5wyoDIsVCYaReBsdcXb+sxg3AR0MPlivbKFWEMi8s8/6VgPPhEqxyfNoK3l5f/N1Fq5mDcEaLR38gx1HkqNTMFEwHwYDVR0jBBgwFoAUvEuwvIXudNLOHroZV0I6WjGtyzgwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUvEuwvIXudNLOHroZV0I6WjGtyzgwCgYIKoZIzj0EAwIDaAAwZQIwHRWxIDcKbCC438V8V3Aqmov4NgX5teFeo3/yYQKGRy3pnoP4s6yVwKkbwlR4ECkPAjEA5qw0MZf0b/eNwJxypr2HtMAHJV5Ut4VIFjLYGt9uhTmana+Tt8dJMJL5SJcfkzTn'
const DSA_KEY = 'MIICXAIBADCCAjUGByqGSM44BAEwggIoAoIBAQCq5bpQA1+HQU6CmRgSZVeAYW7eqm4mkuVO6vj080vyt/iCYvMbgE+FeTStkijCOAGlRXv/l1T4p+k3sPJxK+CSYyNFDpOr3BN86HNfQQu1pHK2SsJDbRshqATMsXzKx3bUkuLmRJxlSaPG20L0BsSUiYBHPgqTcgUNWNA0kPfhLVjEYbQ6fbJJzzhVuIkw4aaLsqP2Qq7X6M8Azsb4iURbzLg7jbxmO9q5iQOW6c9PmF9qRBo1rcevPgkeNbSii0Hpd6BxHB27T4Jy6jN7Mq9d8RND9Ud9X3lx/qNyZRzd2STuOrIqqxQidnwRHpxhGoucr6oEKVLj1mytQIvVGmubAh0Arauvd9UAom1twuPOHFJOc7/kJsbMr1lNyU2WUwKCAQAs6KBFVs3VvDe4sgF5pqGt+Kb2KnoGIGKXBGSDJaRV5dEhZu42dX8p04SEKa58qzhc8RVzlOSpvoIraHQTD4acsB4z3aqzjm8ZNczQ4ZVbMUZafQeH9bXzWmMqESjmGKqyX+LhA6YAEL9hOX7ZImbrv7j9x0Bv+7VMsY1TWMXolKE/F9ySnt6MYUJ25HCszN8zjUiFEQIGsUJU7vkfkWmsUinPtHdibac18amZjX6wWDxtJJkqlf00n1pLiriWh6XCj1dB+it5kC9UB+37T2BBChMdZA4IHc5s9Cqyp085X9YNskWekIYXFsY1M/lX8bLNnI7fUZIomdm5EuzbMP0yBB4CHFgWWeYAE8vliwZs6ypuEnx+kpPdSy5lRQkbyxU='
const DSA_CERT = 'MIIEdTCCBCOgAwIBAgIUZ2FQEoU0bVbGoxQmt5PNx/6KeV4wCwYJYIZIAWUDBAMCMB4xHDAaBgNVBAMME1RTUmVwb3J0IERTQSBTaWduZXIwHhcNMjYwNzEzMTgwNTE3WhcNMzYwNzEwMTgwNTE3WjAeMRwwGgYDVQQDDBNUU1JlcG9ydCBEU0EgU2lnbmVyMIIDQjCCAjUGByqGSM44BAEwggIoAoIBAQCq5bpQA1+HQU6CmRgSZVeAYW7eqm4mkuVO6vj080vyt/iCYvMbgE+FeTStkijCOAGlRXv/l1T4p+k3sPJxK+CSYyNFDpOr3BN86HNfQQu1pHK2SsJDbRshqATMsXzKx3bUkuLmRJxlSaPG20L0BsSUiYBHPgqTcgUNWNA0kPfhLVjEYbQ6fbJJzzhVuIkw4aaLsqP2Qq7X6M8Azsb4iURbzLg7jbxmO9q5iQOW6c9PmF9qRBo1rcevPgkeNbSii0Hpd6BxHB27T4Jy6jN7Mq9d8RND9Ud9X3lx/qNyZRzd2STuOrIqqxQidnwRHpxhGoucr6oEKVLj1mytQIvVGmubAh0Arauvd9UAom1twuPOHFJOc7/kJsbMr1lNyU2WUwKCAQAs6KBFVs3VvDe4sgF5pqGt+Kb2KnoGIGKXBGSDJaRV5dEhZu42dX8p04SEKa58qzhc8RVzlOSpvoIraHQTD4acsB4z3aqzjm8ZNczQ4ZVbMUZafQeH9bXzWmMqESjmGKqyX+LhA6YAEL9hOX7ZImbrv7j9x0Bv+7VMsY1TWMXolKE/F9ySnt6MYUJ25HCszN8zjUiFEQIGsUJU7vkfkWmsUinPtHdibac18amZjX6wWDxtJJkqlf00n1pLiriWh6XCj1dB+it5kC9UB+37T2BBChMdZA4IHc5s9Cqyp085X9YNskWekIYXFsY1M/lX8bLNnI7fUZIomdm5EuzbMP0yA4IBBQACggEACMLureA63AYw29q5Vn9tV3DASpmUOIe+/HN8WLyXSAut9Q9SlW3hA2teuiqGe3Tyt0jbXlUjJjBDYX0SKRh5ZbJrAmD1ZXphsWbaHwyRwI6yQF9Fh/IKh8idBVHXWNliov7vffNiov/t8j7hKcmgDGibOEfVt13g+oAZs+ZXXsF2+msWJrDBrn/JuijL1/zydLsbMwpr1U5707iIY3sZ8W6wpqVO9Dd+usICBAPn2ofsB+V2t5+pn8Xu1cNIY+rzQw8/C9a6PS4OjijH3yamtcka7v2jSVtFubfQMQzQujGu/vLjZvJ4odrWmJe1/eutxhsa02VoT8y2q91eRy0ZrqNTMFEwHwYDVR0jBBgwFoAUz2+lhsOtXGEafcJVq/920zbVW2YwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUz2+lhsOtXGEafcJVq/920zbVW2YwCwYJYIZIAWUDBAMCAz8AMDwCHHae8SHGIubnUSra3FKyhuuvxZbzXxBiKHTelagCHHoI3wMzjKRoP+2qS+ktQi66HQAd62m6segiG5w='

function base64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

function replaceLastAscii(bytesValue: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error('test replacement must preserve length')
  const text = Buffer.from(bytesValue).toString('latin1')
  const index = text.lastIndexOf(from)
  if (index < 0) throw new Error(`test pattern not found: ${from}`)
  const result = Uint8Array.from(bytesValue)
  for (let i = 0; i < to.length; i++) result[index + i] = to.charCodeAt(i)
  return result
}

function bytes(path: string): Uint8Array {
  const b = readFileSync(path)
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}

function generatedReferencePdf(catalogEntries = ''): Uint8Array {
  const objects = [
    { number: 1, generation: 2, body: `<< /Type /Catalog /Pages 2 0 R ${catalogEntries} >>` },
    { number: 2, generation: 0, body: '<< /Type /Pages /Kids [3 4 R] /Count 1 >>' },
    { number: 3, generation: 4, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>' },
    { number: 4, generation: 0, body: '<< /Length 0 >>\nstream\n\nendstream' },
  ]
  let text = '%PDF-1.7\n%\x80\x81\x82\x83\n'
  const offsets = new Map<number, number>()
  for (const object of objects) {
    offsets.set(object.number, text.length)
    text += `${object.number} ${object.generation} obj\n${object.body}\nendobj\n`
  }
  const xref = text.length
  text += 'xref\n0 5\n0000000000 65535 f \n'
  for (const object of objects) {
    text += `${String(offsets.get(object.number)).padStart(10, '0')} ${String(object.generation).padStart(5, '0')} n \n`
  }
  text += `trailer\n<< /Size 5 /Root 1 2 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Uint8Array.from(text, function (character) { return character.charCodeAt(0) & 0xff })
}

function indirectPermissionsPdf(): Uint8Array {
  const objects = [
    { number: 1, generation: 0, body: '<< /Type /Catalog /Pages 2 0 R /Perms 5 4 R >>' },
    { number: 2, generation: 0, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { number: 3, generation: 0, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>' },
    { number: 4, generation: 0, body: '<< /Length 0 >>\nstream\n\nendstream' },
    { number: 5, generation: 4, body: '<< /CustomPermission true >>' },
  ]
  let text = '%PDF-1.7\n%\x80\x81\x82\x83\n'
  const offsets = new Map<number, number>()
  for (const object of objects) {
    offsets.set(object.number, text.length)
    text += `${object.number} ${object.generation} obj\n${object.body}\nendobj\n`
  }
  const xref = text.length
  text += 'xref\n0 6\n0000000000 65535 f \n'
  for (const object of objects) {
    text += `${String(offsets.get(object.number)).padStart(10, '0')} ${String(object.generation).padStart(5, '0')} n \n`
  }
  text += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Uint8Array.from(text, function (character) { return character.charCodeAt(0) & 0xff })
}

function indirectFieldsPdf(): Uint8Array {
  const objects = [
    { number: 1, generation: 0, body: '<< /Type /Catalog /Pages 2 0 R /AcroForm 5 2 R >>' },
    { number: 2, generation: 0, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { number: 3, generation: 0, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> /Annots 8 5 R >>' },
    { number: 4, generation: 0, body: '<< /Length 0 >>\nstream\n\nendstream' },
    { number: 5, generation: 2, body: '<< /Fields 6 3 R /SigFlags 1 /DR << /Font << /Helv 9 0 R >> >> /DA (/Helv 10 Tf 0 g) /CO [7 0 R] /NeedAppearances true >>' },
    { number: 6, generation: 3, body: '[7 0 R]' },
    { number: 7, generation: 0, body: '<< /FT /Tx /Type /Annot /Subtype /Widget /T (existing) /V (value) /Rect [0 0 10 10] /P 3 0 R >>' },
    { number: 8, generation: 5, body: '[7 0 R]' },
    { number: 9, generation: 0, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]
  let text = '%PDF-1.7\n%\x80\x81\x82\x83\n'
  const offsets = new Map<number, number>()
  for (const object of objects) {
    offsets.set(object.number, text.length)
    text += `${object.number} ${object.generation} obj\n${object.body}\nendobj\n`
  }
  const xref = text.length
  text += 'xref\n0 10\n0000000000 65535 f \n'
  for (const object of objects) {
    text += `${String(offsets.get(object.number)).padStart(10, '0')} ${String(object.generation).padStart(5, '0')} n \n`
  }
  text += `trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Uint8Array.from(text, function (character) { return character.charCodeAt(0) & 0xff })
}

describe('PDF signature generation', () => {
  it('signs a rendered PDF that round-trips through our own verifier', () => {
    const font = Font.load(bytes(FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 200, height: 100, children: [
      { type: 'text', x: 10, y: 30, text: 'Signed Document', fontId: 'd', fontSize: 14, color: '#000000' },
    ] }] }, backend)
    // The signer needs a classic /Root /Size trailer; expand object streams.
    const unsigned = rewritePdfToTraditional(backend.toUint8Array())

    const signed = signPdf({
      pdf: unsigned,
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
      reason: 'Approval',
      name: 'TSReport Signer',
    })

    const results = verifyPdfSignatures(signed)
    expect(results).toHaveLength(1)
    expect(results[0]!.subFilter).toBe('adbe.pkcs7.detached')
    expect(results[0]!.digestAlgorithm).toBe('SHA-256')
    expect(results[0]!.digestValid).toBe(true)
    expect(results[0]!.signatureValid).toBe(true)
    expect(results[0]!.coversWholeDocument).toBe(true)
    expect(results[0]!.signerCommonName).toBe('TSReport Signer')
  })

  it('generates a CAdES detached signature with signing-certificate-v2', () => {
    const font = Font.load(bytes(FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 200, height: 100, children: [
      { type: 'text', x: 10, y: 30, text: 'PAdES', fontId: 'd', fontSize: 14, color: '#000000' },
    ] }] }, backend)
    const signed = signPdf({
      pdf: rewritePdfToTraditional(backend.toUint8Array()),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
      subFilter: 'ETSI.CAdES.detached',
    })
    const result = verifyPdfSignatures(signed)[0]!
    expect(result.subFilter).toBe('ETSI.CAdES.detached')
    expect(result.digestValid).toBe(true)
    expect(result.signatureValid).toBe(true)
    expect(Buffer.from(signed).toString('latin1')).toContain('/SubFilter /ETSI.CAdES.detached')
  })

  it.each(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'RIPEMD-160'] as const)(
    'generates RSA PKCS#1 v1.5 CMS with %s',
    (digestAlgorithm) => {
      const signed = signPdf({
        pdf: generatedReferencePdf(),
        privateKeyDer: bytes(`${FIX}/signer-key.der`),
        certDer: bytes(`${FIX}/signer-cert.der`),
        signingTime: new Date(Date.UTC(2026, 6, 14, 3, 0, 0)),
        digestAlgorithm,
      })
      const result = verifyPdfSignatures(signed)[0]!
      expect(result.digestAlgorithm).toBe(digestAlgorithm)
      expect(result.digestValid).toBe(true)
      expect(result.signatureValid).toBe(true)
    },
  )

  it('generates CMS SubjectKeyIdentifier and explicit RSA-PSS parameters', () => {
    const signed = signPdf({
      pdf: generatedReferencePdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 14, 3, 1, 0)),
      digestAlgorithm: 'SHA-384',
      signatureAlgorithm: 'rsa-pss',
      signerIdentifier: 'subject-key-identifier',
      rsaPss: {
        mgfDigestAlgorithm: 'SHA-512',
        saltLength: 24,
        salt: new Uint8Array(24).fill(0x5a),
      },
    })
    const result = verifyPdfSignatures(signed)[0]!
    expect(result.digestAlgorithm).toBe('SHA-384')
    expect(result.signatureAlgorithm).toBe('RSA-PSS')
    expect(result.signerIdentifier).toBe('subject-key-identifier')
    expect(result.rsaPssParameters).toEqual({
      hashAlgorithm: 'SHA-384',
      mgfDigestAlgorithm: 'SHA-512',
      saltLength: 24,
    })
    expect(result.digestValid).toBe(true)
    expect(result.signatureValid).toBe(true)
  })

  it('generates RSA-PSS with RIPEMD-160 and an independent MGF1 digest', () => {
    const signed = signPdf({
      pdf: generatedReferencePdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 14, 3, 1, 30)),
      digestAlgorithm: 'RIPEMD-160',
      signatureAlgorithm: 'rsa-pss',
      rsaPss: {
        mgfDigestAlgorithm: 'SHA-256',
        saltLength: 20,
        salt: new Uint8Array(20).fill(0xa5),
      },
    })
    const result = verifyPdfSignatures(signed)[0]!
    expect(result.digestAlgorithm).toBe('RIPEMD-160')
    expect(result.signatureAlgorithm).toBe('RSA-PSS')
    expect(result.rsaPssParameters).toEqual({
      hashAlgorithm: 'RIPEMD-160',
      mgfDigestAlgorithm: 'SHA-256',
      saltLength: 20,
    })
    expect(result.digestValid).toBe(true)
    expect(result.signatureValid).toBe(true)
  })

  it.each([
    ['adbe.pkcs7.sha1', 'SHA-512'],
    ['adbe.x509.rsa_sha1', 'SHA-1'],
    ['adbe.x509.rsa_sha1', 'SHA-512'],
    ['adbe.x509.rsa_sha1', 'RIPEMD-160'],
  ] as const)('generates the legacy %s signature container', (subFilter, digestAlgorithm) => {
    const signed = signPdf({
      pdf: generatedReferencePdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 14, 3, 2, 0)),
      subFilter,
      digestAlgorithm,
    })
    const result = verifyPdfSignatures(signed)[0]!
    expect(result.subFilter).toBe(subFilter)
    expect(result.digestAlgorithm).toBe(digestAlgorithm)
    expect(result.digestValid).toBe(true)
    expect(result.signatureValid).toBe(true)
  })

  it.each(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const)('generates deterministic DSA with %s', (digestAlgorithm) => {
    const options = {
      pdf: generatedReferencePdf(),
      privateKeyDer: base64(DSA_KEY),
      certDer: base64(DSA_CERT),
      signingTime: new Date(Date.UTC(2026, 6, 14, 3, 6, 0)),
      digestAlgorithm,
      signatureAlgorithm: 'dsa' as const,
      signerIdentifier: 'subject-key-identifier' as const,
    }
    const first = signPdf(options)
    expect(first).toEqual(signPdf(options))
    const result = verifyPdfSignatures(first)[0]!
    expect(result.digestAlgorithm).toBe(digestAlgorithm)
    expect(result.signatureAlgorithm).toBe('DSA')
    expect(result.signerIdentifier).toBe('subject-key-identifier')
    expect(result.digestValid).toBe(true)
    expect(result.signatureValid).toBe(true)
  })

  it('rejects an ECDSA AlgorithmIdentifier whose digest disagrees with SignerInfo', () => {
    const signed = signPdf({
      pdf: generatedReferencePdf(),
      privateKeyDer: base64(P256_KEY),
      certDer: base64(P256_CERT),
      signingTime: new Date(Date.UTC(2026, 6, 14, 3, 4, 0)),
      digestAlgorithm: 'SHA-256',
      signatureAlgorithm: 'ecdsa',
    })
    const inconsistent = replaceLastAscii(signed, '06082A8648CE3D040302', '06082A8648CE3D040303')
    expect(() => verifyPdfSignatures(inconsistent)).toThrow(/signature algorithm differs from the message digest algorithm/)
  })

  it('rejects invalid RSA-PSS trailer and duplicate parameter tags', () => {
    const signed = signPdf({
      pdf: generatedReferencePdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 14, 3, 5, 0)),
      signatureAlgorithm: 'rsa-pss',
      rsaPss: { saltLength: 24, salt: new Uint8Array(24).fill(0x5a) },
    })
    const badTrailer = replaceLastAscii(signed, 'A203020118', 'A303020118')
    expect(() => verifyPdfSignatures(badTrailer)).toThrow(/trailerField must be 1/)
    const duplicateMgf = replaceLastAscii(signed, 'A203020118', 'A103020118')
    expect(() => verifyPdfSignatures(duplicateMgf)).toThrow(/duplicate or out-of-order/)
  })

  it.each([
    ['P-256', P256_KEY, P256_CERT, 'SHA-256'],
    ['P-384', P384_KEY, P384_CERT, 'SHA-384'],
  ] as const)('generates deterministic ECDSA on %s', (_curve, privateKey, certificate, digestAlgorithm) => {
    const options = {
      pdf: generatedReferencePdf(),
      privateKeyDer: base64(privateKey),
      certDer: base64(certificate),
      signingTime: new Date(Date.UTC(2026, 6, 14, 3, 3, 0)),
      digestAlgorithm,
      signatureAlgorithm: 'ecdsa' as const,
      signerIdentifier: 'subject-key-identifier' as const,
    }
    const first = signPdf(options)
    const second = signPdf(options)
    expect(first).toEqual(second)
    const result = verifyPdfSignatures(first)[0]!
    expect(result.digestAlgorithm).toBe(digestAlgorithm)
    expect(result.signatureAlgorithm).toBe('ECDSA')
    expect(result.signerIdentifier).toBe('subject-key-identifier')
    expect(result.digestValid).toBe(true)
    expect(result.signatureValid).toBe(true)
  })

  it('preserves other catalog entries and places the widget on its page', () => {
    // Signing must not orphan catalog-referenced trees (/Names, /StructTreeRoot,
    // /DPartRoot). The signature widget must also appear in the page /Annots.
    const font = Font.load(bytes(FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({
      fonts: { d: font },
      documentParts: [{ startPage: 0, endPage: 0, metadata: { Recipient: 'Alice' } }],
      embeddedFiles: [{ name: 'data.csv', data: new Uint8Array([1, 2, 3]), mimeType: 'text/csv', relationship: 'Source' }],
    })
    render({ tagged: true, structureNamespaces: ['http://iso.org/pdf2/ssn'], pages: [
      { width: 200, height: 100, children: [
        { type: 'text', x: 10, y: 30, text: 'Chapter', fontId: 'd', fontSize: 14, color: '#000000', tag: { role: 'H1', namespaceIndex: 0 } },
      ] },
    ] } as any, backend)
    const unsigned = rewritePdfToTraditional(backend.toUint8Array())
    const signed = signPdf({
      pdf: unsigned,
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
    })

    const results = verifyPdfSignatures(signed)
    expect(results[0]!.signatureValid).toBe(true)
    expect(results[0]!.coversWholeDocument).toBe(true)
    // The embedded file remains reachable through the preserved catalog /Names.
    expect(PdfImporter.open(signed).importEmbeddedFiles()).toHaveLength(1)
    const s = Buffer.from(signed).toString('latin1')
    expect(s.includes('/DPartRoot')).toBe(true)
    expect(s.includes('/StructTreeRoot')).toBe(true)
    // The rewritten catalog keeps its original entries and gains /AcroForm.
    expect(/\/Type\s*\/Catalog[\s\S]*?\/AcroForm/.test(s)).toBe(true)
    // The signature widget must be referenced from the page's /Annots.
    expect(/\/Type\s*\/Page\b[\s\S]*?\/Annots\s*\[[^\]]*\d+\s+0\s+R/.test(s)).toBe(true)
  })

  it('merges the widget into an existing page /Annots without dropping annotations', () => {
    // A page that already has a link annotation exercises injectAnnot's
    // append-to-existing-array path; the link must survive signing.
    const font = Font.load(bytes(FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 200, height: 100, children: [
      { type: 'text', x: 10, y: 30, text: 'Visit', fontId: 'd', fontSize: 14, color: '#000000',
        link: { type: 'uri', target: 'https://example.com' } },
    ] }] } as any, backend)
    const unsigned = rewritePdfToTraditional(backend.toUint8Array())
    const signed = signPdf({
      pdf: unsigned,
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
    })
    expect(verifyPdfSignatures(signed)[0]!.signatureValid).toBe(true)
    // The page /Annots now holds two refs (link + widget) and the link imports.
    const s = Buffer.from(signed).toString('latin1')
    expect(/\/Type\s*\/Page\b[\s\S]*?\/Annots\s*\[\s*\d+\s+0\s+R\s+\d+\s+0\s+R/.test(s)).toBe(true)
    const links = PdfImporter.open(signed).importPage(0).elements
      .map((e: any) => e.hyperlink).filter(Boolean)
    expect(links).toHaveLength(1)
    expect((links[0]!.target as string).includes('https://example.com')).toBe(true)
  })

  it('merges a signature into an existing direct AcroForm dictionary', () => {
    const font = Font.load(bytes(FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 200, height: 100, children: [
      { type: 'formField', x: 10, y: 10, width: 100, height: 20,
        fieldType: 'text', name: 'customer', value: 'Alice', fontId: 'd', fontSize: 10, color: '#000000' },
    ] }] } as any, backend)
    const unsigned = rewritePdfToTraditional(backend.toUint8Array())
    expect(PdfImporter.open(unsigned).importFormFields().map(function (field) { return field.name })).toContain('customer')

    const signed = signPdf({
      pdf: unsigned,
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
    })

    expect(verifyPdfSignatures(signed)[0]!.signatureValid).toBe(true)
    const fields = PdfImporter.open(signed).importFormFields()
    expect(fields.map(function (field) { return field.name })).toContain('customer')
    expect(fields.some(function (field) { return field.type === 'Sig' })).toBe(true)
    const catalogRevisions = Buffer.from(signed).toString('latin1').match(/\/Type\s*\/Catalog/g) ?? []
    expect(catalogRevisions.length).toBeGreaterThanOrEqual(2)
  })

  it('appends a signature directly to xref-stream and object-stream input', () => {
    const font = Font.load(bytes(FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 200, height: 100, children: [
      { type: 'text', x: 10, y: 30, text: 'XRef stream', fontId: 'd', fontSize: 14, color: '#000000' },
    ] }] }, backend)
    const unsigned = backend.toUint8Array()
    expect(Buffer.from(unsigned).toString('latin1')).toContain('/Type /XRef')

    const signed = signPdf({
      pdf: unsigned,
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
    })
    const result = verifyPdfSignatures(signed)[0]!
    expect(result.digestValid).toBe(true)
    expect(result.signatureValid).toBe(true)
    expect(PdfImporter.open(signed).importPage(0).elements.length).toBeGreaterThan(0)
  })

  it('signs hybrid-reference and already incrementally-updated inputs without rewriting prior revisions', () => {
    const incremental = appendIncrementalUpdate(generatedReferencePdf(), [{
      num: 3,
      gen: 4,
      body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] /Contents 4 0 R /Resources << >> >>',
    }])
    for (const input of [hybridSigningPdf(), incremental]) {
      const before = new Uint8Array(input)
      const signed = signPdf({
        pdf: input,
        privateKeyDer: bytes(`${FIX}/signer-key.der`),
        certDer: bytes(`${FIX}/signer-cert.der`),
        signingTime: new Date(Date.UTC(2026, 6, 13, 2, 0, 0)),
      })
      expect(signed.subarray(0, before.length)).toEqual(before)
      expect(verifyPdfSignatures(signed)[0]!.signatureValid).toBe(true)
      expect(PdfImporter.open(signed).importPage(0).width).toBeGreaterThanOrEqual(100)
    }
    const hybridText = Buffer.from(hybridSigningPdf()).toString('latin1')
    const hybridSigned = signPdf({
      pdf: hybridSigningPdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 13, 2, 0, 0)),
    })
    expect(hybridText).toContain('/XRefStm')
    expect(Buffer.from(hybridSigned).toString('latin1')).toContain('/Preserved true')
  })

  it('preserves non-zero catalog and page generations in an incremental signature', () => {
    const signed = signPdf({
      pdf: generatedReferencePdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
    })
    expect(verifyPdfSignatures(signed)[0]!.signatureValid).toBe(true)
    const text = Buffer.from(signed).toString('latin1')
    expect(text).toContain('/Root 1 2 R')
    expect(text).toMatch(/3 4 obj\n<<[^]*\/Annots/)
    expect(text).toMatch(/\d{10} 00004 n/)
  })

  it('updates an indirect AcroForm Fields array without flattening the field tree', () => {
    const unsigned = indirectFieldsPdf()
    expect(PdfImporter.open(unsigned).importFormFields()[0]?.name).toBe('existing')
    expect(PdfImporter.open(unsigned).importFormFields()[0]?.calculationOrderIndex).toBe(0)
    const signed = signPdf({
      pdf: unsigned,
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
    })
    expect(verifyPdfSignatures(signed)[0]!.signatureValid).toBe(true)
    const fields = PdfImporter.open(signed).importFormFields()
    expect(fields.map(function (field) { return field.name })).toContain('existing')
    expect(fields.some(function (field) { return field.type === 'Sig' })).toBe(true)
    expect(fields.find(function (field) { return field.name === 'existing' })?.calculationOrderIndex).toBe(0)
    const text = Buffer.from(signed).toString('latin1')
    expect(text).toMatch(/6 3 obj\n\[11 0 R 7 0 R\]/)
    expect(text).toMatch(/8 5 obj\n\[11 0 R 7 0 R\]/)
    expect(text).toMatch(/\d{10} 00003 n/)
    expect(text).toMatch(/\d{10} 00005 n/)
    expect(text).toMatch(/5 2 obj\n<<[^]*\/DR << \/Font << \/Helv 9 0 R >> >>[^]*\/DA <2f48656c7620313020546620302067>[^]*\/CO \[7 0 R\][^]*\/NeedAppearances true/)
  })

  it('generates, imports, and verifies Lock, seed, DocMDP, FieldMDP, UR3, and catalog permissions', () => {
    const certificate = bytes(`${FIX}/signer-cert.der`)
    const signed = signPdf({
      pdf: indirectFieldsPdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: certificate,
      signingTime: new Date(Date.UTC(2026, 6, 13, 1, 0, 0)),
      fieldName: 'approval',
      reason: 'Approved',
      fieldLock: { action: 'Include', fields: ['existing'], permission: 2 },
      seedValue: {
        required: ['Filter', 'SubFilter', 'V', 'Reasons', 'DigestMethod'],
        filter: 'Adobe.PPKLite',
        subFilters: ['ETSI.CAdES.detached', 'adbe.pkcs7.detached'],
        digestMethods: ['SHA256', 'SHA512'],
        version: 3,
        reasons: ['Approved', 'Rejected'],
        mdpPermission: 2,
        certificate: {
          required: ['Subject', 'Issuer', 'SubjectDN', 'URL'],
          subjectCertificates: [certificate],
          issuerCertificates: [certificate],
          subjectDN: [{ cn: 'TSReport Signer' }],
          keyUsage: ['1XXXXXXXX'],
          policyOids: ['2.5.29.32.0'],
          url: 'https://example.com/enroll',
          urlType: 'Browser',
          signaturePolicyCommitmentTypes: ['proof-of-approval'],
        },
      },
      docMdpPermission: 2,
      usageRights: {
        document: ['FullSave'],
        annotations: ['Create', 'Modify'],
        form: ['FillIn', 'Import'],
        signature: ['Modify'],
        embeddedFiles: ['Import'],
        restrictOtherHandlers: true,
        message: 'Enabled workflow rights',
      },
    })

    const result = verifyPdfSignatures(signed)[0]!
    expect(result.signatureValid).toBe(true)
    expect(result.digestValid).toBe(true)
    expect(result.docMdpPermission).toBe(2)
    expect(result.fieldMdp).toEqual({ action: 'Include', fields: ['existing'] })
    expect(result.fieldLock).toEqual({ action: 'Include', fields: ['existing'], permission: 2 })
    expect(result.seedValue?.version).toBe(3)
    expect(result.seedValue?.certificate?.subjectDN).toEqual([{ cn: 'TSReport Signer' }])
    expect(result.seedValue?.certificate?.signaturePolicyCommitmentTypes).toEqual(['proof-of-approval'])
    expect(result.seedConstraintsValid).toBe(true)
    expect(result.usageRights).toMatchObject({
      document: ['FullSave'],
      annotations: ['Create', 'Modify'],
      form: ['FillIn', 'Import'],
      signature: ['Modify'],
      embeddedFiles: ['Import'],
      restrictOtherHandlers: true,
      message: 'Enabled workflow rights',
    })
    expect(result.permissionsValid).toBe(true)

    const imported = PdfImporter.open(signed).importFormFields().find(function (field) { return field.name === 'approval' })!
    expect(imported.signatureLock).toEqual({ action: 'Include', fields: ['existing'], permission: 2 })
    expect(imported.signatureSeedValue?.required).toEqual(['Filter', 'SubFilter', 'V', 'Reasons', 'DigestMethod'])
    expect(imported.signatureSeedValue?.certificate?.keyUsage).toEqual(['1XXXXXXXX'])

    const text = Buffer.from(signed).toString('latin1')
    const signatureObject = /\/V (\d+) 0 R \/F 132/.exec(text)?.[1]
    expect(signatureObject).toBeDefined()
    expect(text).toMatch(/\/Lock \d+ 0 R \/SV \d+ 0 R/)
    expect(text).toContain('/Type /SigFieldLock')
    expect(text).toContain('/Type /SV')
    expect(text).toContain('/Type /SVCert')
    expect(text).toMatch(new RegExp(`/Perms << \/DocMDP ${signatureObject} 0 R \/UR3 ${signatureObject} 0 R >>`))
  })

  it('rejects signing options that violate required seed and FieldMDP constraints', () => {
    const common = {
      pdf: generatedReferencePdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 13, 1, 0, 0)),
    }
    expect(function () {
      signPdf({
        ...common,
        fieldLock: { action: 'Include', fields: ['one'] },
        fieldMdp: { action: 'Exclude', fields: ['one'] },
      })
    }).toThrow(/same fields/)
    expect(function () {
      signPdf({
        ...common,
        subFilter: 'adbe.pkcs7.detached',
        seedValue: {
          required: ['SubFilter'],
          subFilters: ['ETSI.CAdES.detached', 'adbe.pkcs7.detached'],
        },
      })
    }).toThrow(/first supported required seed/)
    expect(function () {
      signPdf({
        ...common,
        seedValue: {
          required: ['Reasons'],
          reasons: ['Approved'],
        },
        reason: 'Rejected',
      })
    }).toThrow(/does not satisfy/)
    expect(function () {
      signPdf({
        ...common,
        seedValue: {
          certificate: {
            required: ['SubjectDN'],
            subjectDN: [{ cn: 'Different Signer' }],
          },
        },
      })
    }).toThrow(/SubjectDN/)
  })

  it('preserves custom entries in direct and indirect permissions dictionaries', () => {
    const inputs = [
      generatedReferencePdf('/Perms << /CustomPermission true >>'),
      indirectPermissionsPdf(),
    ]
    for (const pdf of inputs) {
      const signed = signPdf({
        pdf,
        privateKeyDer: bytes(`${FIX}/signer-key.der`),
        certDer: bytes(`${FIX}/signer-cert.der`),
        signingTime: new Date(Date.UTC(2026, 6, 13, 1, 0, 0)),
        docMdpPermission: 1,
        usageRights: { document: ['FullSave'] },
      })
      const result = verifyPdfSignatures(signed)[0]!
      expect(result.signatureValid).toBe(true)
      expect(result.permissionsValid).toBe(true)
      expect(Buffer.from(signed).toString('latin1')).toContain('/CustomPermission true')
    }
    expect(Buffer.from(signPdf({
      pdf: indirectPermissionsPdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 13, 1, 0, 0)),
      docMdpPermission: 1,
    })).toString('latin1')).toMatch(/5 4 obj\n<< \/CustomPermission true \/DocMDP 6 0 R >>/)
  })

  it('reports a DocMDP transform whose catalog permission points at another object', () => {
    const signed = signPdf({
      pdf: generatedReferencePdf(),
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 13, 1, 0, 0)),
      docMdpPermission: 1,
    })
    const text = Buffer.from(signed).toString('latin1')
    const match = /\/Perms << \/DocMDP (\d+) 0 R >>/.exec(text)!
    const original = match[1]!
    const replacement = String(Number(original) + 1)
    expect(replacement.length).toBe(original.length)
    const numberOffset = match.index + match[0].indexOf(original)
    for (let i = 0; i < replacement.length; i++) signed[numberOffset + i] = replacement.charCodeAt(i)
    const result = verifyPdfSignatures(signed)[0]!
    expect(result.permissionsValid).toBe(false)
    expect(result.digestValid).toBe(false)
  })

  it('tampering after signing invalidates the byte-range digest', () => {
    const font = Font.load(bytes(FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 200, height: 100, children: [
      { type: 'text', x: 10, y: 30, text: 'Tamper test', fontId: 'd', fontSize: 14, color: '#000000' },
    ] }] }, backend)
    const unsigned = rewritePdfToTraditional(backend.toUint8Array())
    const signed = signPdf({
      pdf: unsigned,
      privateKeyDer: bytes(`${FIX}/signer-key.der`),
      certDer: bytes(`${FIX}/signer-cert.der`),
      signingTime: new Date(Date.UTC(2026, 6, 11, 2, 0, 0)),
    })
    // Flip a byte inside the first signed range (the page content, before the gap).
    signed[20] = signed[20]! ^ 0xFF
    const results = verifyPdfSignatures(signed)
    expect(results[0]!.digestValid).toBe(false)
  })
})
