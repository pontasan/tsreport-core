// PDF digital signature verification (ISO 32000-1 12.8). Fixtures are real
// CMS signatures produced by OpenSSL 3.6 (RSA-2048 self-signed certificate,
// `openssl cms -sign`) over hand-assembled signed PDFs; OpenSSL cross-verifies
// the same structures, so both directions of the crypto are pinned to an
// external oracle.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyPdfSignatures } from '../../src/pdf/pdf-signature.js'

const FIXTURES = resolve(__dirname, '../fixtures/signatures')

function load(name: string): Uint8Array {
  return readFileSync(resolve(FIXTURES, name))
}

describe('PDF signature verification', () => {
  it.each([
    ['signed-sha256.pdf', 'adbe.pkcs7.detached', 'SHA-256'],
    ['signed-sha1.pdf', 'adbe.pkcs7.detached', 'SHA-1'],
    ['signed-sha512.pdf', 'adbe.pkcs7.detached', 'SHA-512'],
    ['signed-cades.pdf', 'ETSI.CAdES.detached', 'SHA-256'],
    ['signed-p7sha1.pdf', 'adbe.pkcs7.sha1', 'SHA-256'],
  ])('verifies %s (%s, %s)', (file, subFilter, digestAlgorithm) => {
    const results = verifyPdfSignatures(load(file))
    expect(results).toHaveLength(1)
    const s = results[0]!
    expect(s.fieldName).toBe('Signature1')
    expect(s.subFilter).toBe(subFilter)
    expect(s.digestAlgorithm).toBe(digestAlgorithm)
    expect(s.digestValid).toBe(true)
    expect(s.signatureValid).toBe(true)
    expect(s.coversWholeDocument).toBe(true)
    expect(s.signerCommonName).toBe('TSReport Test Signer')
    expect(s.signingTime).not.toBeNull()
  })


  it.each([
    ["signed-ec256.pdf", "SHA-256", "TSReport EC Signer"],
    ["signed-ec384.pdf", "SHA-384", "TSReport EC384 Signer"],
  ])("verifies ECDSA %s (%s)", (file, digestAlgorithm, cn) => {
    // ECDSA (FIPS 186-4) over P-256/P-384; signatures produced by OpenSSL 3.6
    // with EC keys (ecdsa-with-SHA256/SHA384 CMS SignerInfo).
    const results = verifyPdfSignatures(load(file))
    expect(results).toHaveLength(1)
    const s = results[0]!
    expect(s.digestAlgorithm).toBe(digestAlgorithm)
    expect(s.digestValid).toBe(true)
    expect(s.signatureValid).toBe(true)
    expect(s.signerCommonName).toBe(cn)
  })

  it("reports a broken ECDSA signature when the signature value is corrupted", () => {
    const pdf = Uint8Array.from(load("signed-ec256.pdf"))
    const idx = Buffer.from(pdf).indexOf("/Contents <") + "/Contents <".length + 857 * 2 - 20
    pdf[idx] = pdf[idx] === 0x61 ? 0x62 : 0x61
    const results = verifyPdfSignatures(pdf)
    expect(results[0]!.digestValid).toBe(true)
    expect(results[0]!.signatureValid).toBe(false)
  })


  it("verifies an RSASSA-PSS signature (RFC 8017 EMSA-PSS)", () => {
    // OpenSSL 3.6, rsa_padding_mode:pss with MGF1-SHA256 and explicit
    // RSASSA-PSS-params in the CMS SignerInfo.
    const results = verifyPdfSignatures(load("signed-pss.pdf"))
    expect(results).toHaveLength(1)
    expect(results[0]!.digestAlgorithm).toBe("SHA-256")
    expect(results[0]!.digestValid).toBe(true)
    expect(results[0]!.signatureValid).toBe(true)
  })


  it("reports the DocMDP certification permission of a certification signature", () => {
    // /Reference [<< /TransformMethod /DocMDP /TransformParams << /P 2 >> >>]
    // with the catalog /Perms /DocMDP entry (ISO 32000-1 12.8.2.2).
    const results = verifyPdfSignatures(load("signed-docmdp.pdf"))
    expect(results).toHaveLength(1)
    expect(results[0]!.docMdpPermission).toBe(2)
    expect(results[0]!.modifiedAfterSigning).toBe(false)
    expect(results[0]!.digestValid).toBe(true)
    expect(results[0]!.signatureValid).toBe(true)
  })

  it("detects an incremental update appended after a certification signature", () => {
    // The signed revision itself is intact (digest and signature stay valid),
    // but bytes follow the signed byte ranges — whether that update is
    // permitted is governed by the reported DocMDP permission.
    const results = verifyPdfSignatures(load("signed-docmdp-updated.pdf"))
    expect(results).toHaveLength(1)
    expect(results[0]!.docMdpPermission).toBe(2)
    expect(results[0]!.modifiedAfterSigning).toBe(true)
    expect(results[0]!.coversWholeDocument).toBe(false)
    expect(results[0]!.digestValid).toBe(true)
    expect(results[0]!.signatureValid).toBe(true)
  })

  it("reports no DocMDP permission for a plain approval signature", () => {
    const results = verifyPdfSignatures(load("signed-sha256.pdf"))
    expect(results[0]!.docMdpPermission).toBeNull()
    expect(results[0]!.fieldMdp).toBeNull()
    expect(results[0]!.modifiedAfterSigning).toBe(false)
  })

  it('reports an invalid digest for a document modified after signing', () => {
    // One byte inside the signed byte range was changed. The CMS signature
    // over the signed attributes still verifies (the attributes were not
    // touched), but the messageDigest no longer matches the file content.
    const results = verifyPdfSignatures(load('signed-tampered.pdf'))
    expect(results).toHaveLength(1)
    expect(results[0]!.digestValid).toBe(false)
    expect(results[0]!.signatureValid).toBe(true)
  })

  it('reports a broken signature when the CMS signature bytes are corrupted', () => {
    // Flip a byte in the RSA signature itself (inside the /Contents hex gap,
    // outside the digested ranges): the digest stays valid, the signature not.
    const pdf = load('signed-sha256.pdf')
    const text = Buffer.from(pdf).toString('latin1')
    const contentsStart = text.indexOf('/Contents <') + '/Contents <'.length
    // The RSA signature lives near the end of the DER; corrupt hex there.
    const derHexLength = 1493 * 2
    const target = contentsStart + derHexLength - 10
    const corrupted = Uint8Array.from(pdf)
    corrupted[target] = corrupted[target] === 0x30 ? 0x31 : 0x30
    const results = verifyPdfSignatures(corrupted)
    expect(results[0]!.digestValid).toBe(true)
    expect(results[0]!.signatureValid).toBe(false)
  })

  it('returns no results for a document without signature fields', () => {
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
    ]
    let body = '%PDF-1.7\n'
    const offsets: number[] = []
    for (const o of objects) { offsets.push(body.length); body += o }
    const xrefOff = body.length
    let xref = 'xref\n0 3\n0000000000 65535 f \n'
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
    body += `${xref}trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`
    expect(verifyPdfSignatures(new TextEncoder().encode(body))).toEqual([])
  })
})
