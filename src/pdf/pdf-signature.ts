/**
 * PDF digital signature verification (ISO 32000-1 12.8).
 *
 * Verifies approval signatures found in the document's AcroForm signature
 * fields: the /ByteRange digest, the CMS (PKCS#7, RFC 5652) signature over
 * the signed attributes, and the binding between the two, using the signer
 * certificate embedded in the CMS structure. Supported /SubFilter values are
 * adbe.pkcs7.detached, ETSI.CAdES.detached, ETSI.RFC3161, and
 * adbe.pkcs7.sha1; supported
 * signature algorithms are RSA PKCS#1 v1.5, RSA-PSS, DSA, and ECDSA
 * (P-256/P-384), with the PDF 2.0 SHA and RIPEMD-160 digest set.
 *
 * Trust-chain validation against a certificate store is a policy decision the
 * caller makes (viewers require configured trust anchors); this module reports
 * the cryptographic facts of each signature.
 */

import { parsePdf, PdfDocument, PdfName, PdfRef, PdfString, type PdfDict } from './pdf-parser.js'
import { pdfStringToText } from './pdf-page-importer.js'
import {
  parsePdfSignatureFieldLock,
  parsePdfSignatureSeedValue,
  parsePdfUsageRights,
  samePdfSignatureFieldSelection,
  type PdfSignatureFieldLock,
  type PdfSignatureSeedValue,
  type PdfUsageRights,
} from './pdf-signature-policy.js'
import {
  certificateChainsTo,
  certificateMatchesKeyUsage,
  certificateMatchesSubjectDn,
  parseX509SeedFacts,
} from './x509-seed-policy.js'
import { sha1 } from '../encryption/sha1.js'
import { sha256 } from '../encryption/sha256.js'
import { sha384, sha512 } from '../encryption/sha512.js'
import { sha3_256, sha3_384, sha3_512, shake256 } from '../encryption/sha3.js'
import { ripemd160 } from '../encryption/ripemd160.js'
import { EC_CURVES, verifyEcdsa, type EcCurve } from '../encryption/ecdsa.js'
import { verifyEdDsa, type EdDsaCurveName } from '../encryption/eddsa.js'
import { parseRfc3161TimestampToken } from './pdf-rfc3161.js'

export interface PdfSignatureVerification {
  /** Fully qualified signature field name, or null for a document-level dict */
  fieldName: string | null
  subFilter: string
  /** /ByteRange pairs as stored (offset, length, ...) */
  byteRange: number[]
  /** End offset of the PDF revision protected by this signature. */
  signedRevisionLength: number
  /** Uppercase SHA-1 key used by the document security store /VRI dictionary. */
  vriKey: string
  /**
   * True when the byte ranges cover the entire file except the /Contents
   * hex string gap — i.e. the signature covers the whole revision.
   */
  coversWholeDocument: boolean
  /** Digest algorithm used over the byte ranges (e.g. "SHA-256") */
  digestAlgorithm: string
  /** Cryptographic signature primitive declared by CMS. */
  signatureAlgorithm: 'RSA-PKCS1-v1_5' | 'RSA-PSS' | 'DSA' | 'ECDSA' | 'EdDSA'
  /** CMS SignerIdentifier representation. */
  signerIdentifier: 'issuer-and-serial' | 'subject-key-identifier'
  /** Effective RSASSA-PSS parameters, including RFC 4055 defaults. */
  rsaPssParameters: { hashAlgorithm: string, mgfDigestAlgorithm: string, saltLength: number } | null
  /** True when the byte-range digest matches the signed message digest */
  digestValid: boolean
  /** True when the CMS/RSA signature verifies against the signer certificate */
  signatureValid: boolean
  /** Subject common name of the signer certificate */
  signerCommonName: string | null
  /** DER signer certificate selected by the CMS SignerIdentifier. */
  signerCertificate: Uint8Array
  /** Signing time from the signed attributes, or the /M dictionary entry */
  signingTime: Date | null
  /**
   * DocMDP certification permission when this is a certification signature
   * (ISO 32000-1 12.8.2.2): 1 = no changes, 2 = form fill-in and signing,
   * 3 = additionally annotations. Null for plain approval signatures.
   */
  docMdpPermission: number | null
  /** FieldMDP transform (ISO 32000-1 12.8.2.4), when present */
  fieldMdp: { action: 'All' | 'Include' | 'Exclude', fields: string[] } | null
  /** Signature field lock policy imported from the indirect /Lock dictionary. */
  fieldLock: PdfSignatureFieldLock | null
  /** Signature field seed constraints imported from the indirect /SV dictionary. */
  seedValue: PdfSignatureSeedValue | null
  /** Whether the actual signature satisfies every required seed constraint. */
  seedConstraintsValid: boolean | null
  /** Usage-rights transform parameters when this signature carries a UR transform. */
  usageRights: PdfUsageRights | null
  /** Whether DocMDP/UR transforms are bound to this dictionary through catalog /Perms. */
  permissionsValid: boolean
  /**
   * True when bytes follow the signed revision — an incremental update was
   * appended after signing (its own legitimacy is governed by DocMDP).
   */
  modifiedAfterSigning: boolean
}

export interface CmsDetachedSignatureVerification {
  readonly digestAlgorithm: string
  readonly signatureAlgorithm: 'RSA-PKCS1-v1_5' | 'RSA-PSS' | 'DSA' | 'ECDSA' | 'EdDSA'
  readonly signerIdentifier: 'issuer-and-serial' | 'subject-key-identifier'
  readonly rsaPssParameters: { hashAlgorithm: string, mgfDigestAlgorithm: string, saltLength: number } | null
  readonly digestValid: boolean
  readonly signatureValid: boolean
  readonly signerCommonName: string | null
  readonly signerCertificate: Uint8Array
  readonly signingTime: Date | null
}

/** Verifies a detached CMS SignedData packet against the exact signed content. */
export function verifyCmsDetachedSignature(cmsBytes: Uint8Array, content: Uint8Array): CmsDetachedSignatureVerification {
  const cms = parseCmsSignedData(cmsBytes)
  const digestAlgorithm = cms.signer.digestAlgorithm
  const contentDigest = hashByName(digestAlgorithm, content)
  let digestValid = true
  let signedDigest = contentDigest
  let signedMessage = content
  if (cms.signer.signedAttrsRaw !== null) {
    if (cms.signer.messageDigest === null) throw new Error('CMS signature error: signed attributes lack messageDigest')
    digestValid = bytesEqual(cms.signer.messageDigest, contentDigest)
    signedDigest = hashByName(digestAlgorithm, cms.signer.signedAttrsRaw)
    signedMessage = cms.signer.signedAttrsRaw
  }
  const cert = findSignerCertificate(cms)
  return {
    digestAlgorithm,
    signatureAlgorithm: publicSignatureAlgorithm(cms.signer.signatureAlgorithm),
    signerIdentifier: cms.signer.sidSubjectKeyId === null ? 'issuer-and-serial' : 'subject-key-identifier',
    rsaPssParameters: publicPssParameters(cms.signer.pss),
    digestValid,
    signatureValid: verifySignatureValue(
      cert.publicKey, cms.signer.signature, digestAlgorithm, signedDigest,
      cms.signer.signatureAlgorithm, cms.signer.pss, signedMessage,
    ),
    signerCommonName: cert.subjectCommonName,
    signerCertificate: cert.raw,
    signingTime: cms.signer.signingTime,
  }
}

/**
 * Verify every signature field of the document. `bytes` must be the exact
 * file bytes: byte-range digests are computed over them.
 */
export function verifyPdfSignatures(bytes: Uint8Array): PdfSignatureVerification[] {
  const doc = parsePdf(bytes)
  const results: PdfSignatureVerification[] = []
  const catalog = doc.getCatalog()
  const acroForm = doc.resolve(catalog.get('AcroForm') ?? null)
  if (!(acroForm instanceof Map)) return results
  const fields = doc.resolve(acroForm.get('Fields') ?? null)
  if (!Array.isArray(fields)) return results
  collectSignatureFields(doc, fields, '', bytes, results, catalog)
  return results
}

function collectSignatureFields(
  doc: PdfDocument,
  fields: unknown[],
  prefix: string,
  bytes: Uint8Array,
  results: PdfSignatureVerification[],
  catalog: PdfDict,
): void {
  for (let i = 0; i < fields.length; i++) {
    const field = doc.resolve(fields[i] as never)
    if (!(field instanceof Map)) continue
    const partial = doc.resolve(field.get('T') ?? null)
    const partialName = partial instanceof PdfString ? pdfStringToText(partial) : null
    const name = partialName !== null ? (prefix === '' ? partialName : `${prefix}.${partialName}`) : prefix
    const kids = doc.resolve(field.get('Kids') ?? null)
    if (Array.isArray(kids)) collectSignatureFields(doc, kids, name, bytes, results, catalog)
    const ft = doc.resolve(field.get('FT') ?? null)
    if (!(ft instanceof PdfName) || ft.name !== 'Sig') continue
    const sig = doc.resolve(field.get('V') ?? null)
    if (!(sig instanceof Map)) continue
    results.push(verifySignatureDict(doc, sig, field, name === '' ? null : name, bytes, catalog))
  }
}

function verifySignatureDict(
  doc: PdfDocument,
  sig: PdfDict,
  field: PdfDict,
  fieldName: string | null,
  bytes: Uint8Array,
  catalog: PdfDict,
): PdfSignatureVerification {
  const subFilterValue = doc.resolve(sig.get('SubFilter') ?? null)
  const subFilter = subFilterValue instanceof PdfName ? subFilterValue.name : ''
  const byteRangeValue = doc.resolve(sig.get('ByteRange') ?? null)
  if (!Array.isArray(byteRangeValue) || byteRangeValue.length % 2 !== 0 || byteRangeValue.length === 0) {
    throw new Error('PDF signature error: /ByteRange must be an array of offset,length pairs')
  }
  const byteRange: number[] = []
  for (let i = 0; i < byteRangeValue.length; i++) {
    const v = doc.resolve(byteRangeValue[i]!)
    if (typeof v !== 'number') throw new Error('PDF signature error: /ByteRange must contain numbers')
    byteRange.push(v)
  }
  const contents = doc.resolve(sig.get('Contents') ?? null)
  if (!(contents instanceof PdfString)) throw new Error('PDF signature error: /Contents must be a string')
  const signedRevisionLength = byteRange.reduce(function (end, value, index) {
    return index % 2 === 0 ? Math.max(end, value + byteRange[index + 1]!) : end
  }, 0)
  const vriKey = uppercaseHex(sha1(bytes.subarray(byteRange[1]!, byteRange[2]!)))

  // Concatenate the signed byte ranges
  let total = 0
  for (let i = 0; i < byteRange.length; i += 2) total += byteRange[i + 1]!
  const signedBytes = new Uint8Array(total)
  let out = 0
  for (let i = 0; i < byteRange.length; i += 2) {
    const start = byteRange[i]!
    const length = byteRange[i + 1]!
    if (start < 0 || length < 0 || start + length > bytes.length) throw new Error('PDF signature error: /ByteRange outside the file')
    signedBytes.set(bytes.subarray(start, start + length), out)
    out += length
  }
  // Whole-document coverage: two ranges, starting at 0, ending at EOF, with
  // only the /Contents hex string between them.
  const coversWholeDocument = byteRange.length === 4
    && byteRange[0] === 0
    && byteRange[2]! + byteRange[3]! === bytes.length
    && byteRange[2]! > byteRange[1]!

  const m = doc.resolve(sig.get('M') ?? null)
  const dictSigningTime = m instanceof PdfString ? parsePdfDate(pdfStringToText(m)) : null
  const modifiedAfterSigning = byteRange.length === 4 && byteRange[0] === 0 && byteRange[2]! > byteRange[1]!
    && byteRange[2]! + byteRange[3]! < bytes.length
  const mdp = parseSignatureReferences(doc, sig)
  const policy = parseSignatureFieldPolicy(doc, field)
  if (policy.fieldLock !== null && mdp.fieldMdp !== null
      && !samePdfSignatureFieldSelection(policy.fieldLock, mdp.fieldMdp)) {
    throw new Error('PDF signature error: FieldMDP transform does not match the signature field /Lock dictionary')
  }
  const permissionsValid = validateSignaturePermissionBinding(doc, catalog, sig, mdp, byteRange.length > 0)

  if (subFilter === 'adbe.x509.rsa_sha1') {
    return verifyX509RsaSha1(
      doc, sig, fieldName, subFilter, byteRange, signedRevisionLength, vriKey, coversWholeDocument, signedBytes,
      contents.bytes, dictSigningTime, mdp, policy, permissionsValid, modifiedAfterSigning,
    )
  }
  if (subFilter !== 'adbe.pkcs7.detached' && subFilter !== 'ETSI.CAdES.detached'
      && subFilter !== 'adbe.pkcs7.sha1' && subFilter !== 'ETSI.RFC3161') {
    throw new Error(`PDF signature error: unsupported /SubFilter ${subFilter}`)
  }

  const cms = parseCmsSignedData(contents.bytes)
  let digestAlgorithm = cms.signer.digestAlgorithm
  let timestampTime: Date | null = null

  // The signed content: detached CMS signs the byte ranges directly;
  // adbe.pkcs7.sha1 signs an encapsulated SHA-1 digest of the byte ranges.
  let content: Uint8Array
  let digestValid: boolean
  if (subFilter === 'ETSI.RFC3161') {
    if (cms.encapContent === null) throw new Error('PDF signature error: RFC 3161 token lacks TSTInfo content')
    const timestamp = parseRfc3161TimestampToken(contents.bytes)
    digestAlgorithm = timestamp.digestAlgorithm
    timestampTime = timestamp.generationTime
    content = cms.encapContent
    digestValid = bytesEqual(timestamp.messageImprint, hashByName(timestamp.digestAlgorithm, signedBytes))
  } else if (subFilter === 'adbe.pkcs7.sha1') {
    const rangeDigest = sha1(signedBytes)
    content = cms.encapContent ?? new Uint8Array(0)
    digestValid = cms.encapContent !== null && bytesEqual(cms.encapContent, rangeDigest)
  } else {
    content = signedBytes
    digestValid = true
  }

  const signerDigestAlgorithm = cms.signer.digestAlgorithm
  const contentDigest = hashByName(signerDigestAlgorithm, content)
  let signedData: Uint8Array
  let signedMessage: Uint8Array
  if (cms.signer.signedAttrsRaw !== null) {
    // messageDigest attribute must match the content digest; the signature is
    // over the DER SET OF re-encoding of the signed attributes (RFC 5652 5.4)
    if (cms.signer.messageDigest === null) throw new Error('PDF signature error: signed attributes lack messageDigest')
    digestValid = digestValid && bytesEqual(cms.signer.messageDigest, contentDigest)
    signedData = hashByName(signerDigestAlgorithm, cms.signer.signedAttrsRaw)
    signedMessage = cms.signer.signedAttrsRaw
  } else {
    signedData = contentDigest
    signedMessage = content
  }

  const cert = findSignerCertificate(cms)
  const signatureValid = verifySignatureValue(
    cert.publicKey, cms.signer.signature, signerDigestAlgorithm, signedData,
    cms.signer.signatureAlgorithm, cms.signer.pss, signedMessage,
  )

  return {
    fieldName,
    subFilter,
    byteRange,
    signedRevisionLength,
    vriKey,
    coversWholeDocument,
    digestAlgorithm,
    signatureAlgorithm: publicSignatureAlgorithm(cms.signer.signatureAlgorithm),
    signerIdentifier: cms.signer.sidSubjectKeyId === null ? 'issuer-and-serial' : 'subject-key-identifier',
    rsaPssParameters: publicPssParameters(cms.signer.pss),
    digestValid,
    signatureValid,
    signerCommonName: cert.subjectCommonName,
    signerCertificate: cert.raw,
    signingTime: timestampTime ?? cms.signer.signingTime ?? dictSigningTime,
    docMdpPermission: mdp.docMdpPermission,
    fieldMdp: mdp.fieldMdp,
    fieldLock: policy.fieldLock,
    seedValue: policy.seedValue,
    seedConstraintsValid: policy.seedValue === null ? null : validateSeedConstraints(
      doc, sig, policy.seedValue, subFilter, digestAlgorithm, mdp.docMdpPermission, cert,
      cms.certificates, cms.signer.hasSignatureTimestamp, cms.signer.hasRevocationInfo,
    ),
    usageRights: mdp.usageRights,
    permissionsValid,
    modifiedAfterSigning,
  }
}

interface SignatureMdp {
  docMdpPermission: number | null
  fieldMdp: { action: 'All' | 'Include' | 'Exclude', fields: string[] } | null
  usageRights: PdfUsageRights | null
  docMdpReferenceCount: number
  usageRightsReferenceCount: number
}

/**
 * Parse the signature reference dictionaries (ISO 32000-1 12.8.1 /Reference):
 * DocMDP transform parameters carry the certification permission /P (default
 * 2), FieldMDP the locked-field selection (/Action with /Fields).
 */
function parseSignatureReferences(doc: PdfDocument, sig: PdfDict): SignatureMdp {
  const result: SignatureMdp = {
    docMdpPermission: null,
    fieldMdp: null,
    usageRights: null,
    docMdpReferenceCount: 0,
    usageRightsReferenceCount: 0,
  }
  const references = doc.resolve(sig.get('Reference') ?? null)
  if (!Array.isArray(references)) return result
  for (let i = 0; i < references.length; i++) {
    const ref = doc.resolve(references[i]!)
    if (!(ref instanceof Map)) throw new Error('PDF signature error: /Reference entries must be dictionaries')
    const type = doc.resolve(ref.get('Type') ?? null)
    if (type !== null && (!(type instanceof PdfName) || type.name !== 'SigRef')) {
      throw new Error('PDF signature error: signature reference /Type must be /SigRef')
    }
    const method = doc.resolve(ref.get('TransformMethod') ?? null)
    if (!(method instanceof PdfName)) throw new Error('PDF signature error: signature reference /TransformMethod must be a name')
    const params = doc.resolve(ref.get('TransformParams') ?? null)
    if (method.name === 'DocMDP') {
      result.docMdpReferenceCount++
      if (result.docMdpReferenceCount > 1) throw new Error('PDF signature error: multiple DocMDP references are not permitted')
      let permission = 2
      if (params instanceof Map) {
        const p = doc.resolve(params.get('P') ?? null)
        if (typeof p === 'number') {
          if (p < 1 || p > 3) throw new Error('PDF signature error: DocMDP /P must be 1, 2, or 3')
          permission = p
        }
      }
      result.docMdpPermission = permission
    } else if (method.name === 'FieldMDP') {
      if (result.fieldMdp !== null) throw new Error('PDF signature error: multiple FieldMDP references are not permitted')
      let action: 'All' | 'Include' | 'Exclude' = 'All'
      const fields: string[] = []
      if (params instanceof Map) {
        const a = doc.resolve(params.get('Action') ?? null)
        if (a instanceof PdfName) {
          if (a.name !== 'All' && a.name !== 'Include' && a.name !== 'Exclude') {
            throw new Error('PDF signature error: FieldMDP /Action must be All, Include, or Exclude')
          }
          action = a.name
        }
        const list = doc.resolve(params.get('Fields') ?? null)
        if (Array.isArray(list)) {
          for (let j = 0; j < list.length; j++) {
            const f = doc.resolve(list[j]!)
            if (f instanceof PdfString) fields.push(pdfStringToText(f))
          }
        }
      }
      if (action !== 'All' && fields.length === 0) throw new Error('PDF signature error: FieldMDP /Fields is required for Include or Exclude')
      result.fieldMdp = { action, fields }
    } else if (method.name === 'UR') {
      result.usageRightsReferenceCount++
      if (result.usageRightsReferenceCount > 1) throw new Error('PDF signature error: multiple UR references are not permitted')
      if (!(params instanceof Map)) throw new Error('PDF signature error: UR transform requires /TransformParams')
      result.usageRights = parsePdfUsageRights(doc, params, pdfStringToText)
    }
  }
  return result
}

interface SignatureFieldPolicy {
  fieldLock: PdfSignatureFieldLock | null
  seedValue: PdfSignatureSeedValue | null
}

function parseSignatureFieldPolicy(doc: PdfDocument, field: PdfDict): SignatureFieldPolicy {
  let fieldLock: PdfSignatureFieldLock | null = null
  if (field.has('Lock')) {
    const value = field.get('Lock')!
    if (!(value instanceof PdfRef)) throw new Error('PDF signature error: signature field /Lock must be an indirect reference')
    fieldLock = parsePdfSignatureFieldLock(doc, value, pdfStringToText)
  }
  let seedValue: PdfSignatureSeedValue | null = null
  if (field.has('SV')) {
    const value = field.get('SV')!
    if (!(value instanceof PdfRef)) throw new Error('PDF signature error: signature field /SV must be an indirect reference')
    seedValue = parsePdfSignatureSeedValue(doc, value, pdfStringToText)
  }
  return { fieldLock, seedValue }
}

function validateSignaturePermissionBinding(
  doc: PdfDocument,
  catalog: PdfDict,
  signature: PdfDict,
  mdp: SignatureMdp,
  hasByteRange: boolean,
): boolean {
  const permissionsValue = doc.resolve(catalog.get('Perms') ?? null)
  if (permissionsValue !== null && !(permissionsValue instanceof Map)) {
    throw new Error('PDF signature error: catalog /Perms must be a dictionary')
  }
  const permissions = permissionsValue instanceof Map ? permissionsValue : null
  const docMdp = permissions === null ? null : doc.resolve(permissions.get('DocMDP') ?? null)
  const ur = permissions === null ? null : doc.resolve(permissions.get('UR') ?? null)
  const ur3 = permissions === null ? null : doc.resolve(permissions.get('UR3') ?? null)
  const pointsFromDocMdp = docMdp === signature
  const pointsFromUr = ur === signature
  const pointsFromUr3 = ur3 === signature
  if (mdp.docMdpReferenceCount !== 0 && (!pointsFromDocMdp || mdp.docMdpReferenceCount !== 1)) return false
  if (pointsFromDocMdp && mdp.docMdpReferenceCount !== 1) return false
  if (mdp.usageRightsReferenceCount !== 0) {
    if (hasByteRange ? !pointsFromUr3 : !pointsFromUr) return false
    if (!validateUsageRightsVersion(mdp.usageRights!, hasByteRange ? 'UR3' : 'UR')) return false
  }
  if ((pointsFromUr || pointsFromUr3) && mdp.usageRightsReferenceCount !== 1) return false
  if (hasByteRange && pointsFromUr) return false
  if (!hasByteRange && pointsFromUr3) return false
  return true
}

function validateUsageRightsVersion(rights: PdfUsageRights, kind: 'UR' | 'UR3'): boolean {
  if (kind === 'UR3') return rights.formEx === undefined
  if (rights.annotations?.some(function (value) { return value === 'Online' || value === 'SummaryView' }) === true) return false
  if (rights.form?.some(function (value) { return value === 'BarcodePlaintext' || value === 'Online' }) === true) return false
  if (rights.embeddedFiles !== undefined) return false
  return true
}

function verifyX509RsaSha1(
  doc: PdfDocument,
  sig: PdfDict,
  fieldName: string | null,
  subFilter: string,
  byteRange: number[],
  signedRevisionLength: number,
  vriKey: string,
  coversWholeDocument: boolean,
  signedBytes: Uint8Array,
  contents: Uint8Array,
  signingTime: Date | null,
  mdp: SignatureMdp,
  policy: SignatureFieldPolicy,
  permissionsValid: boolean,
  modifiedAfterSigning: boolean,
): PdfSignatureVerification {
  // adbe.x509.rsa_sha1: /Contents is a DER OCTET STRING holding the PKCS#1
  // signature; the certificate chain is in /Cert.
  const certValue = doc.resolve(sig.get('Cert') ?? null)
  const certBytes = certValue instanceof PdfString
    ? certValue.bytes
    : Array.isArray(certValue) && certValue.length > 0 && doc.resolve(certValue[0]!) instanceof PdfString
      ? (doc.resolve(certValue[0]!) as PdfString).bytes
      : null
  if (certBytes === null) throw new Error('PDF signature error: adbe.x509.rsa_sha1 requires /Cert')
  const cert = parseCertificate(certBytes)
  const signatureReader = new DerReader(contents)
  const signature = signatureReader.read().tag === 0x04 ? signatureReader.lastContent() : contents
  if (cert.publicKey.kind !== 'rsa') throw new Error('PDF signature error: adbe.x509.rsa_sha1 requires an RSA certificate')
  const recovered = recoverRsaPkcs1Digest(cert.publicKey, signature)
  if (recovered === null) throw new Error('PDF signature error: malformed adbe.x509.rsa_sha1 signature')
  const signatureValid = bytesEqual(recovered.digest, hashByName(recovered.digestName, signedBytes))
  return {
    fieldName,
    subFilter,
    byteRange,
    signedRevisionLength,
    vriKey,
    coversWholeDocument,
    digestAlgorithm: recovered.digestName,
    signatureAlgorithm: 'RSA-PKCS1-v1_5',
    signerIdentifier: 'issuer-and-serial',
    rsaPssParameters: null,
    digestValid: signatureValid,
    signatureValid,
    signerCommonName: cert.subjectCommonName,
    signerCertificate: cert.raw,
    signingTime,
    docMdpPermission: mdp.docMdpPermission,
    fieldMdp: mdp.fieldMdp,
    fieldLock: policy.fieldLock,
    seedValue: policy.seedValue,
    seedConstraintsValid: policy.seedValue === null ? null : validateSeedConstraints(
      doc, sig, policy.seedValue, subFilter, recovered.digestName, mdp.docMdpPermission, cert, [cert], false, false,
    ),
    usageRights: mdp.usageRights,
    permissionsValid,
    modifiedAfterSigning,
  }
}

function validateSeedConstraints(
  doc: PdfDocument,
  signature: PdfDict,
  seed: PdfSignatureSeedValue,
  subFilter: string,
  digestAlgorithm: string,
  docMdpPermission: number | null,
  certificate: ParsedCertificate,
  certificateChain: readonly ParsedCertificate[],
  hasSignatureTimestamp: boolean,
  hasRevocationInfo: boolean,
): boolean {
  const required = new Set(seed.required ?? [])
  if (required.has('Filter')) {
    const filter = doc.resolve(signature.get('Filter') ?? null)
    if (!(filter instanceof PdfName) || filter.name !== seed.filter) return false
  }
  if (required.has('SubFilter')) {
    if (seed.subFilters === undefined) return false
    const firstSupported = seed.subFilters.find(function (value) {
      return value === 'adbe.pkcs7.detached' || value === 'ETSI.CAdES.detached'
        || value === 'adbe.pkcs7.sha1' || value === 'adbe.x509.rsa_sha1' || value === 'ETSI.RFC3161'
    })
    if (firstSupported !== subFilter) return false
  }
  if (required.has('V') && seed.version === undefined) return false
  if (required.has('DigestMethod')) {
    const normalized = digestAlgorithm.replace('-', '')
    if (seed.digestMethods === undefined || !seed.digestMethods.includes(normalized as never)) return false
  }
  if (required.has('Reasons')) {
    const reasonValue = doc.resolve(signature.get('Reason') ?? null)
    const reason = reasonValue instanceof PdfString ? pdfStringToText(reasonValue) : null
    if (seed.reasons === undefined || (seed.reasons.length === 1 && seed.reasons[0] === '')) {
      if (reason !== null) return false
    } else if (reason === null || !seed.reasons.includes(reason)) return false
  }
  if (seed.mdpPermission !== undefined && seed.mdpPermission !== (docMdpPermission ?? 0)) return false
  if (required.has('LegalAttestation') && (seed.legalAttestations === undefined || seed.legalAttestations.length === 0)) return false
  if (seed.timestamp?.required === true && !hasSignatureTimestamp) return false
  if (required.has('AddRevInfo') && seed.addRevInfo === true && !hasRevocationInfo) return false
  const certificateSeed = seed.certificate
  if (certificateSeed !== undefined) {
    const certificateRequired = new Set(certificateSeed.required ?? [])
    const facts = parseX509SeedFacts(certificate.raw)
    if (certificateRequired.has('Subject')) {
      if (certificateSeed.subjectCertificates === undefined
          || !certificateSeed.subjectCertificates.some(function (value) { return bytesEqual(value, certificate.raw) })) return false
    }
    if (certificateRequired.has('SubjectDN')
        && (certificateSeed.subjectDN === undefined || !certificateMatchesSubjectDn(facts, certificateSeed.subjectDN))) return false
    if (certificateRequired.has('KeyUsage')
        && (certificateSeed.keyUsage === undefined || !certificateMatchesKeyUsage(facts, certificateSeed.keyUsage))) return false
    if (certificateRequired.has('Issuer')) {
      if (certificateSeed.issuerCertificates === undefined) return false
      const available = certificateChain.map(function (value) { return parseX509SeedFacts(value.raw) })
      if (!certificateChainsTo(facts, available, certificateSeed.issuerCertificates)) return false
    }
    if (certificateRequired.has('OID')
        && (certificateSeed.policyOids === undefined
          || !certificateSeed.policyOids.every(function (value) { return facts.certificatePolicyOids.includes(value) }))) return false
    if (certificateRequired.has('URL') && certificateSeed.urlType !== undefined && certificateSeed.urlType !== 'Browser') return false
  }
  return true
}

/** PDF date string (D:YYYYMMDDHHmmSSOHH'mm) to Date, or null when malformed. */
function parsePdfDate(text: string): Date | null {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+\-Z])?(\d{2})?'?(\d{2})?/.exec(text)
  if (m === null) return null
  const year = Number(m[1])
  const month = Number(m[2] ?? '01')
  const day = Number(m[3] ?? '01')
  const hour = Number(m[4] ?? '00')
  const minute = Number(m[5] ?? '00')
  const second = Number(m[6] ?? '00')
  let offsetMinutes = 0
  if (m[7] === '+' || m[7] === '-') {
    offsetMinutes = Number(m[8] ?? '00') * 60 + Number(m[9] ?? '00')
    if (m[7] === '-') offsetMinutes = -offsetMinutes
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60000)
}

// ---------------------------------------------------------------------------
// Minimal DER (ASN.1) reader
// ---------------------------------------------------------------------------

interface DerValue {
  /** Full tag byte (class | constructed | number) */
  tag: number
  /** Content bytes */
  content: Uint8Array
  /** Raw encoding including tag and length */
  raw: Uint8Array
}

class DerReader {
  private readonly data: Uint8Array
  private pos: number
  private readonly end: number
  private last: DerValue | null = null

  constructor(data: Uint8Array, start = 0, end = data.length) {
    this.data = data
    this.pos = start
    this.end = end
  }

  hasMore(): boolean {
    return this.pos < this.end
  }

  read(): DerValue {
    if (this.pos + 2 > this.end) throw new Error('PDF signature error: truncated DER value')
    const start = this.pos
    const tag = this.data[this.pos]!
    if ((tag & 0x1F) === 0x1F) throw new Error('PDF signature error: multi-byte DER tags are not used by CMS')
    this.pos++
    let length = this.data[this.pos]!
    this.pos++
    if (length & 0x80) {
      const lengthBytes = length & 0x7F
      if (lengthBytes === 0 || lengthBytes > 4) throw new Error('PDF signature error: invalid DER length')
      length = 0
      for (let i = 0; i < lengthBytes; i++) {
        length = length * 256 + this.data[this.pos]!
        this.pos++
      }
    }
    if (this.pos + length > this.end) throw new Error('PDF signature error: DER value exceeds its container')
    const content = this.data.subarray(this.pos, this.pos + length)
    this.pos += length
    this.last = { tag, content, raw: this.data.subarray(start, this.pos) }
    return this.last
  }

  lastContent(): Uint8Array {
    return this.last!.content
  }
}

function derChildren(value: DerValue): DerValue[] {
  const reader = new DerReader(value.content)
  const out: DerValue[] = []
  while (reader.hasMore()) out.push(reader.read())
  return out
}

function decodeOid(content: Uint8Array): string {
  const parts: number[] = []
  parts.push(Math.trunc(content[0]! / 40), content[0]! % 40)
  let value = 0
  for (let i = 1; i < content.length; i++) {
    value = value * 128 + (content[i]! & 0x7F)
    if ((content[i]! & 0x80) === 0) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function uppercaseHex(value: Uint8Array): string {
  let result = ''
  for (let i = 0; i < value.length; i++) result += value[i]!.toString(16).padStart(2, '0').toUpperCase()
  return result
}

// ---------------------------------------------------------------------------
// CMS SignedData (RFC 5652) and X.509 parsing
// ---------------------------------------------------------------------------

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_DATA = '1.2.840.113549.1.7.1'
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3'
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5'
const OID_SIGNATURE_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14'
const OID_REVOCATION_INFO_ARCHIVAL = '1.2.840.113583.1.1.8'
const OID_COMMON_NAME = '2.5.4.3'
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1'
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1'
const OID_DSA_PUBLIC_KEY = '1.2.840.10040.4.1'
const OID_ED25519 = '1.3.101.112'
const OID_ED448 = '1.3.101.113'
const OID_RSASSA_PSS = '1.2.840.113549.1.1.10'
const OID_MGF1 = '1.2.840.113549.1.1.8'

const DIGEST_OIDS: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
  '2.16.840.1.101.3.4.2.8': 'SHA3-256',
  '2.16.840.1.101.3.4.2.9': 'SHA3-384',
  '2.16.840.1.101.3.4.2.10': 'SHA3-512',
  '2.16.840.1.101.3.4.2.12': 'SHAKE256',
  '1.3.36.3.2.1': 'RIPEMD-160',
}

// Supported signature algorithm OIDs (RSA PKCS#1 v1.5 and ECDSA variants)
const SIGNATURE_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.1': '',
  '1.2.840.113549.1.1.5': 'SHA-1',
  '1.2.840.113549.1.1.11': 'SHA-256',
  '1.2.840.113549.1.1.12': 'SHA-384',
  '1.2.840.113549.1.1.13': 'SHA-512',
  '2.16.840.1.101.3.4.3.14': 'SHA3-256',
  '2.16.840.1.101.3.4.3.15': 'SHA3-384',
  '2.16.840.1.101.3.4.3.16': 'SHA3-512',
  '1.2.840.10045.4.1': 'SHA-1',
  '1.2.840.10045.4.3.2': 'SHA-256',
  '1.2.840.10045.4.3.3': 'SHA-384',
  '1.2.840.10045.4.3.4': 'SHA-512',
  '2.16.840.1.101.3.4.3.10': 'SHA3-256',
  '2.16.840.1.101.3.4.3.11': 'SHA3-384',
  '2.16.840.1.101.3.4.3.12': 'SHA3-512',
  '1.2.840.10040.4.3': 'SHA-1',
  '2.16.840.1.101.3.4.3.2': 'SHA-256',
  '2.16.840.1.101.3.4.3.3': 'SHA-384',
  '2.16.840.1.101.3.4.3.4': 'SHA-512',
  '1.3.36.3.3.1.2': 'RIPEMD-160',
}

export interface RsaPssParams {
  hash: string
  mgfHash: string
  saltLength: number
}

export type CmsSignatureAlgorithm =
  | { kind: 'rsa-pkcs1-v1_5', digest: string | null }
  | { kind: 'rsa-pss' }
  | { kind: 'dsa', digest: string }
  | { kind: 'ecdsa', digest: string }
  | { kind: 'eddsa', curve: EdDsaCurveName }

function publicSignatureAlgorithm(value: CmsSignatureAlgorithm): 'RSA-PKCS1-v1_5' | 'RSA-PSS' | 'DSA' | 'ECDSA' | 'EdDSA' {
  if (value.kind === 'rsa-pkcs1-v1_5') return 'RSA-PKCS1-v1_5'
  if (value.kind === 'rsa-pss') return 'RSA-PSS'
  if (value.kind === 'dsa') return 'DSA'
  if (value.kind === 'eddsa') return 'EdDSA'
  return 'ECDSA'
}

function publicPssParameters(value: RsaPssParams | null): { hashAlgorithm: string, mgfDigestAlgorithm: string, saltLength: number } | null {
  return value === null ? null : {
    hashAlgorithm: value.hash,
    mgfDigestAlgorithm: value.mgfHash,
    saltLength: value.saltLength,
  }
}

interface CmsSignerInfo {
  digestAlgorithm: string
  signatureAlgorithm: CmsSignatureAlgorithm
  /** RSASSA-PSS parameters when the signature algorithm is id-RSASSA-PSS */
  pss: RsaPssParams | null
  /** Issuer DER + serial content for certificate matching (or SKI content) */
  sidIssuer: Uint8Array | null
  sidSerial: Uint8Array | null
  sidSubjectKeyId: Uint8Array | null
  /** Raw signedAttrs re-encoded with the SET OF tag for digesting */
  signedAttrsRaw: Uint8Array | null
  contentType: string | null
  messageDigest: Uint8Array | null
  signingTime: Date | null
  hasSignatureTimestamp: boolean
  hasRevocationInfo: boolean
  signature: Uint8Array
}

export type CertificatePublicKey =
  | { kind: 'rsa', modulus: bigint, exponent: bigint }
  | { kind: 'dsa', p: bigint, q: bigint, g: bigint, y: bigint }
  | { kind: 'ec', curveOid: string, curve: EcCurve, x: bigint, y: bigint }
  | { kind: 'ed', curve: EdDsaCurveName, encoded: Uint8Array }

export interface ParsedCertificate {
  raw: Uint8Array
  tbsRaw: Uint8Array
  issuerRaw: Uint8Array
  subjectRaw: Uint8Array
  serial: Uint8Array
  subjectKeyId: Uint8Array | null
  subjectPublicKey: Uint8Array
  subjectCommonName: string | null
  notBefore: Date
  notAfter: Date
  isCertificateAuthority: boolean
  extendedKeyUsageOids: string[]
  signatureAlgorithm: CmsSignatureAlgorithm
  signaturePss: RsaPssParams | null
  signatureDigestAlgorithm: string
  signature: Uint8Array
  publicKey: CertificatePublicKey
}

interface CmsSignedData {
  encapContent: Uint8Array | null
  certificates: ParsedCertificate[]
  signer: CmsSignerInfo
}

function derIntegerNumber(value: DerValue, label: string): number {
  if (value.tag !== 0x02 || value.content.length === 0 || (value.content[0]! & 0x80) !== 0) {
    throw new Error(`PDF signature error: ${label} must be a non-negative INTEGER`)
  }
  let result = 0
  for (let i = 0; i < value.content.length; i++) result = result * 256 + value.content[i]!
  if (!Number.isSafeInteger(result)) throw new Error(`PDF signature error: ${label} exceeds the supported integer range`)
  return result
}

function validateNullOrAbsentParameters(parts: DerValue[], label: string): void {
  if (parts.length > 2 || (parts.length === 2 && (parts[1]!.tag !== 0x05 || parts[1]!.content.length !== 0))) {
    throw new Error(`PDF signature error: ${label} AlgorithmIdentifier parameters must be NULL or absent`)
  }
}

function parseDigestAlgorithmIdentifier(value: DerValue): string {
  if (value.tag !== 0x30) throw new Error('PDF signature error: digest AlgorithmIdentifier must be a SEQUENCE')
  const parts = derChildren(value)
  if (parts.length === 0 || parts[0]!.tag !== 0x06) throw new Error('PDF signature error: digest AlgorithmIdentifier lacks an OID')
  validateNullOrAbsentParameters(parts, 'digest')
  const oid = decodeOid(parts[0]!.content)
  const name = DIGEST_OIDS[oid]
  if (name === undefined) throw new Error(`PDF signature error: unsupported digest algorithm ${oid}`)
  return name
}

function parseCmsSignedData(der: Uint8Array): CmsSignedData {
  const contentInfo = new DerReader(der).read()
  if (contentInfo.tag !== 0x30) throw new Error('PDF signature error: CMS ContentInfo must be a SEQUENCE')
  const ciChildren = derChildren(contentInfo)
  if (ciChildren.length < 2 || ciChildren[0]!.tag !== 0x06 || decodeOid(ciChildren[0]!.content) !== OID_SIGNED_DATA) {
    throw new Error('PDF signature error: CMS content is not SignedData')
  }
  const signedData = derChildren(ciChildren[1]!)[0]!
  const children = derChildren(signedData)
  let index = 0
  const signedDataVersion = derIntegerNumber(children[index]!, 'SignedData version')
  index++
  const digestAlgorithms = derChildren(children[index]!).map(parseDigestAlgorithmIdentifier)
  index++
  // encapContentInfo
  const encap = derChildren(children[index]!)
  if (encap.length === 0 || encap[0]!.tag !== 0x06) throw new Error('PDF signature error: EncapsulatedContentInfo lacks a content type')
  const encapContentType = decodeOid(encap[0]!.content)
  index++
  let encapContent: Uint8Array | null = null
  if (encap.length > 1 && encap[1]!.tag === 0xA0) {
    const inner = derChildren(encap[1]!)[0]!
    encapContent = inner.tag === 0x04 ? inner.content : inner.raw
  }
  const certificates: ParsedCertificate[] = []
  while (index < children.length && (children[index]!.tag === 0xA0 || children[index]!.tag === 0xA1)) {
    if (children[index]!.tag === 0xA0) {
      const certValues = derChildren(children[index]!)
      for (let i = 0; i < certValues.length; i++) {
        if (certValues[i]!.tag === 0x30) certificates.push(parseCertificate(certValues[i]!.raw))
      }
    }
    index++ // certificates [0] / crls [1]
  }
  const signerInfos = derChildren(children[index]!)
  if (signerInfos.length === 0) throw new Error('PDF signature error: CMS has no SignerInfo')
  if (signerInfos.length !== 1) throw new Error('PDF signature error: a PDF signature CMS must contain exactly one SignerInfo')
  const signer = parseSignerInfo(signerInfos[0]!)
  if (!digestAlgorithms.includes(signer.digestAlgorithm)) {
    throw new Error('PDF signature error: SignerInfo digest algorithm is absent from SignedData.digestAlgorithms')
  }
  const requiredSignedDataVersion = signer.sidSubjectKeyId === null && encapContentType === OID_DATA ? 1 : 3
  if (signedDataVersion !== requiredSignedDataVersion) {
    throw new Error(`PDF signature error: SignedData version must be ${requiredSignedDataVersion} for the selected SignerIdentifier`)
  }
  if (signer.signedAttrsRaw !== null && signer.contentType !== encapContentType) {
    throw new Error('PDF signature error: signed contentType does not match EncapsulatedContentInfo')
  }
  return { encapContent, certificates, signer }
}

function parseSignerInfo(si: DerValue): CmsSignerInfo {
  const children = derChildren(si)
  let index = 0
  const signerVersion = derIntegerNumber(children[index]!, 'SignerInfo version')
  index++
  const sid = children[index]!
  index++
  let sidIssuer: Uint8Array | null = null
  let sidSerial: Uint8Array | null = null
  let sidSubjectKeyId: Uint8Array | null = null
  if (sid.tag === 0x30) {
    const parts = derChildren(sid)
    if (parts.length !== 2 || parts[0]!.tag !== 0x30 || parts[1]!.tag !== 0x02) {
      throw new Error('PDF signature error: malformed issuerAndSerialNumber SignerIdentifier')
    }
    sidIssuer = parts[0]!.raw
    sidSerial = parts[1]!.content
  } else if (sid.tag === 0x80) {
    if (sid.content.length === 0) throw new Error('PDF signature error: SubjectKeyIdentifier SignerIdentifier is empty')
    sidSubjectKeyId = sid.content
  } else {
    throw new Error('PDF signature error: unsupported SignerIdentifier')
  }
  const expectedVersion = sidSubjectKeyId === null ? 1 : 3
  if (signerVersion !== expectedVersion) {
    throw new Error(`PDF signature error: SignerInfo version must be ${expectedVersion} for the selected SignerIdentifier`)
  }
  const digestAlgorithm = parseDigestAlgorithmIdentifier(children[index]!)
  index++

  let signedAttrsRaw: Uint8Array | null = null
  let contentType: string | null = null
  let messageDigest: Uint8Array | null = null
  let signingTime: Date | null = null
  let signingTimeSeen = false
  let hasRevocationInfo = false
  if (children[index]!.tag === 0xA0) {
    const attrs = children[index]!
    // The signature covers the attributes re-encoded as SET OF (0x31)
    signedAttrsRaw = new Uint8Array(attrs.raw)
    signedAttrsRaw[0] = 0x31
    const attrValues = derChildren(attrs)
    for (let i = 0; i < attrValues.length; i++) {
      const attr = derChildren(attrValues[i]!)
      if (attr.length !== 2 || attr[0]!.tag !== 0x06 || attr[1]!.tag !== 0x31) {
        throw new Error('PDF signature error: malformed signed attribute')
      }
      const oid = decodeOid(attr[0]!.content)
      const values = derChildren(attr[1]!)
      if (oid === OID_CONTENT_TYPE) {
        if (contentType !== null || values.length !== 1 || values[0]!.tag !== 0x06) {
          throw new Error('PDF signature error: signed attributes contain an invalid contentType')
        }
        contentType = decodeOid(values[0]!.content)
      } else if (oid === OID_MESSAGE_DIGEST) {
        if (messageDigest !== null || values.length !== 1 || values[0]!.tag !== 0x04) {
          throw new Error('PDF signature error: signed attributes contain an invalid messageDigest')
        }
        messageDigest = values[0]!.content
      } else if (oid === OID_SIGNING_TIME) {
        if (signingTimeSeen || values.length !== 1) throw new Error('PDF signature error: signed attributes contain an invalid signingTime')
        signingTimeSeen = true
        signingTime = parseAsn1Time(values[0]!)
        if (signingTime === null) throw new Error('PDF signature error: signed attributes contain an invalid signingTime')
      } else if (oid === OID_REVOCATION_INFO_ARCHIVAL) {
        hasRevocationInfo = true
      }
    }
    if (contentType === null || messageDigest === null) {
      throw new Error('PDF signature error: signed attributes require contentType and messageDigest')
    }
    index++
  }
  const sigAlgParts = derChildren(children[index]!)
  const sigAlgOid = decodeOid(sigAlgParts[0]!.content)
  index++
  let pss: RsaPssParams | null = null
  let signatureAlgorithm: CmsSignatureAlgorithm
  if (sigAlgOid === OID_RSASSA_PSS) {
    if (sigAlgParts.length !== 2) throw new Error('PDF signature error: RSASSA-PSS parameters are required')
    pss = parseRsaPssParams(sigAlgParts[1]!)
    signatureAlgorithm = { kind: 'rsa-pss' }
  } else if (sigAlgOid === OID_ED25519 || sigAlgOid === OID_ED448) {
    if (sigAlgParts.length !== 1) throw new Error('PDF signature error: EdDSA AlgorithmIdentifier parameters must be absent')
    const curve: EdDsaCurveName = sigAlgOid === OID_ED25519 ? 'Ed25519' : 'Ed448'
    const requiredDigest = curve === 'Ed25519' ? 'SHA-512' : 'SHAKE256'
    if (digestAlgorithm !== requiredDigest) throw new Error(`PDF signature error: ${curve} requires ${requiredDigest}`)
    signatureAlgorithm = { kind: 'eddsa', curve }
  } else if (SIGNATURE_OIDS[sigAlgOid] === undefined) {
    throw new Error(`PDF signature error: unsupported signature algorithm ${sigAlgOid}`)
  } else {
    const declaredDigest = SIGNATURE_OIDS[sigAlgOid]!
    const ecdsa = sigAlgOid.startsWith('1.2.840.10045.4.')
      || sigAlgOid === '2.16.840.1.101.3.4.3.10'
      || sigAlgOid === '2.16.840.1.101.3.4.3.11'
      || sigAlgOid === '2.16.840.1.101.3.4.3.12'
    const dsa = sigAlgOid === '1.2.840.10040.4.3' || sigAlgOid.startsWith('2.16.840.1.101.3.4.3.')
    if (ecdsa) {
      if (sigAlgParts.length !== 1) throw new Error('PDF signature error: ECDSA AlgorithmIdentifier parameters must be absent')
      if (declaredDigest !== digestAlgorithm) throw new Error('PDF signature error: ECDSA signature algorithm differs from the message digest algorithm')
      signatureAlgorithm = { kind: 'ecdsa', digest: declaredDigest }
    } else if (dsa) {
      if (sigAlgParts.length !== 1) throw new Error('PDF signature error: DSA AlgorithmIdentifier parameters must be absent')
      if (declaredDigest !== digestAlgorithm) throw new Error('PDF signature error: DSA signature algorithm differs from the message digest algorithm')
      signatureAlgorithm = { kind: 'dsa', digest: declaredDigest }
    } else {
      validateNullOrAbsentParameters(sigAlgParts, 'RSA signature')
      if (declaredDigest !== '' && declaredDigest !== digestAlgorithm) {
        throw new Error('PDF signature error: RSA signature algorithm differs from the message digest algorithm')
      }
      signatureAlgorithm = { kind: 'rsa-pkcs1-v1_5', digest: declaredDigest === '' ? null : declaredDigest }
    }
  }
  const signature = children[index]!.content
  index++
  let hasSignatureTimestamp = false
  if (index < children.length && children[index]!.tag === 0xa1) {
    const unsignedAttributes = derChildren(children[index]!)
    for (let i = 0; i < unsignedAttributes.length; i++) {
      const attribute = derChildren(unsignedAttributes[i]!)
      if (attribute.length > 0 && attribute[0]!.tag === 0x06
          && decodeOid(attribute[0]!.content) === OID_SIGNATURE_TIMESTAMP_TOKEN) hasSignatureTimestamp = true
    }
  }
  return {
    digestAlgorithm, signatureAlgorithm, pss, sidIssuer, sidSerial, sidSubjectKeyId, signedAttrsRaw, contentType,
    messageDigest, signingTime, hasSignatureTimestamp, hasRevocationInfo, signature,
  }
}

/**
 * RSASSA-PSS-params (RFC 4055): hashAlgorithm [0], maskGenAlgorithm [1]
 * (MGF1 with its own hash), saltLength [2] — each DEFAULTs to SHA-1/MGF1-SHA1/20.
 */
function parseRsaPssParams(params: DerValue): RsaPssParams {
  let hash = 'SHA-1'
  let mgfHash = 'SHA-1'
  let saltLength = 20
  if (params.tag !== 0x30) throw new Error('PDF signature error: RSASSA-PSS parameters must be a SEQUENCE')
  const fields = derChildren(params)
  let previousTag = 0x9f
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (field.tag < 0xa0 || field.tag > 0xa3) throw new Error('PDF signature error: unknown RSASSA-PSS parameter')
    if (field.tag <= previousTag) throw new Error('PDF signature error: duplicate or out-of-order RSASSA-PSS parameter')
    previousTag = field.tag
    const explicit = derChildren(field)
    if (explicit.length !== 1) throw new Error('PDF signature error: malformed RSASSA-PSS parameter')
    if (field.tag === 0xA0) {
      hash = parseDigestAlgorithmIdentifier(explicit[0]!)
    } else if (field.tag === 0xA1) {
      if (explicit[0]!.tag !== 0x30) throw new Error('PDF signature error: PSS mask generation algorithm must be a SEQUENCE')
      const mgf = derChildren(explicit[0]!)
      if (mgf.length !== 2 || mgf[0]!.tag !== 0x06 || decodeOid(mgf[0]!.content) !== OID_MGF1) {
        throw new Error('PDF signature error: unsupported PSS mask generation function')
      }
      mgfHash = parseDigestAlgorithmIdentifier(mgf[1]!)
    } else if (field.tag === 0xA2) {
      saltLength = derIntegerNumber(explicit[0]!, 'PSS saltLength')
    } else if (derIntegerNumber(explicit[0]!, 'PSS trailerField') !== 1) {
      throw new Error('PDF signature error: PSS trailerField must be 1')
    }
  }
  return { hash, mgfHash, saltLength }
}

function parseAsn1Time(value: DerValue): Date | null {
  const text = new TextDecoder().decode(value.content)
  if (value.tag === 0x17) {
    // UTCTime YYMMDDHHMMSSZ
    const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?$/.exec(text)
    if (m === null) return null
    const year = Number(m[1]) >= 50 ? 1900 + Number(m[1]) : 2000 + Number(m[1])
    return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? '0')))
  }
  if (value.tag === 0x18) {
    // GeneralizedTime YYYYMMDDHHMMSSZ
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/.exec(text)
    if (m === null) return null
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? '0')))
  }
  return null
}

export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const cert = new DerReader(der).read()
  const certificateParts = derChildren(cert)
  if (certificateParts.length !== 3 || certificateParts[0]!.tag !== 0x30
      || certificateParts[1]!.tag !== 0x30 || certificateParts[2]!.tag !== 0x03
      || certificateParts[2]!.content[0] !== 0) throw new Error('PDF signature error: malformed X.509 certificate')
  const tbs = certificateParts[0]!
  const tbsChildren = derChildren(tbs!)
  let index = 0
  if (tbsChildren[0]!.tag === 0xA0) index++ // version [0]
  const serial = tbsChildren[index]!.content
  index++ // serialNumber
  index++ // signature algorithm
  const issuerRaw = tbsChildren[index]!.raw
  index++ // issuer
  const validity = derChildren(tbsChildren[index]!)
  if (validity.length !== 2) throw new Error('PDF signature error: malformed certificate validity')
  const notBefore = parseAsn1Time(validity[0]!)
  const notAfter = parseAsn1Time(validity[1]!)
  if (notBefore === null || notAfter === null) throw new Error('PDF signature error: malformed certificate validity time')
  index++ // validity
  const subject = tbsChildren[index]!
  index++ // subject
  const spki = tbsChildren[index]!
  index++
  let subjectKeyId: Uint8Array | null = null
  let isCertificateAuthority = false
  const extendedKeyUsageOids: string[] = []
  for (; index < tbsChildren.length; index++) {
    if (tbsChildren[index]!.tag !== 0xA3) continue
    const extensions = derChildren(derChildren(tbsChildren[index]!)[0]!)
    for (let i = 0; i < extensions.length; i++) {
      const ext = derChildren(extensions[i]!)
      if (decodeOid(ext[0]!.content) === '2.5.29.14') {
        // SubjectKeyIdentifier: OCTET STRING wrapping an OCTET STRING
        const inner = new DerReader(ext[ext.length - 1]!.content).read()
        if (inner.tag === 0x04) subjectKeyId = inner.content
      } else if (decodeOid(ext[0]!.content) === '2.5.29.19') {
        const inner = new DerReader(ext[ext.length - 1]!.content).read()
        if (inner.tag !== 0x30) throw new Error('PDF signature error: malformed BasicConstraints extension')
        const constraints = derChildren(inner)
        if (constraints.length > 0 && constraints[0]!.tag === 0x01) {
          if (constraints[0]!.content.length !== 1) throw new Error('PDF signature error: malformed BasicConstraints cA')
          isCertificateAuthority = constraints[0]!.content[0] !== 0
        }
      } else if (decodeOid(ext[0]!.content) === '2.5.29.37') {
        const inner = new DerReader(ext[ext.length - 1]!.content).read()
        if (inner.tag !== 0x30) throw new Error('PDF signature error: malformed ExtendedKeyUsage extension')
        const purposes = derChildren(inner)
        for (let purpose = 0; purpose < purposes.length; purpose++) {
          if (purposes[purpose]!.tag !== 0x06) throw new Error('PDF signature error: malformed ExtendedKeyUsage purpose')
          extendedKeyUsageOids.push(decodeOid(purposes[purpose]!.content))
        }
      }
    }
  }

  // Subject common name
  let subjectCommonName: string | null = null
  const rdns = derChildren(subject!)
  for (let i = 0; i < rdns.length; i++) {
    const attrs = derChildren(rdns[i]!)
    for (let j = 0; j < attrs.length; j++) {
      const pair = derChildren(attrs[j]!)
      if (pair.length >= 2 && decodeOid(pair[0]!.content) === OID_COMMON_NAME) {
        subjectCommonName = new TextDecoder().decode(pair[1]!.content)
      }
    }
  }

  // SubjectPublicKeyInfo: algorithm identifier + BIT STRING key material
  const spkiChildren = derChildren(spki!)
  const algParts = derChildren(spkiChildren[0]!)
  const keyAlgOid = decodeOid(algParts[0]!.content)
  const bitString = spkiChildren[1]!
  if (bitString.tag !== 0x03 || bitString.content[0] !== 0) throw new Error('PDF signature error: malformed public key')
  let publicKey: CertificatePublicKey
  if (keyAlgOid === OID_RSA_ENCRYPTION) {
    const rsaKey = new DerReader(bitString.content, 1).read()
    const keyParts = derChildren(rsaKey)
    publicKey = { kind: 'rsa', modulus: bytesToBigInt(keyParts[0]!.content), exponent: bytesToBigInt(keyParts[1]!.content) }
  } else if (keyAlgOid === OID_EC_PUBLIC_KEY) {
    if (algParts.length < 2 || algParts[1]!.tag !== 0x06) throw new Error('PDF signature error: EC key without a named curve')
    const curveOid = decodeOid(algParts[1]!.content)
    const curve = EC_CURVES[curveOid]
    if (curve === undefined) throw new Error(`PDF signature error: unsupported EC curve ${curveOid}`)
    const point = bitString.content.subarray(1)
    if (point[0] !== 0x04 || point.length !== 1 + curve.size * 2) throw new Error('PDF signature error: EC public key must be an uncompressed point')
    publicKey = {
      kind: 'ec',
      curveOid,
      curve,
      x: bytesToBigInt(point.subarray(1, 1 + curve.size)),
      y: bytesToBigInt(point.subarray(1 + curve.size)),
    }
  } else if (keyAlgOid === OID_DSA_PUBLIC_KEY) {
    if (algParts.length !== 2 || algParts[1]!.tag !== 0x30) throw new Error('PDF signature error: DSA key without parameters')
    const parameters = derChildren(algParts[1]!)
    const publicValue = new DerReader(bitString.content, 1).read()
    if (parameters.length !== 3 || publicValue.tag !== 0x02) throw new Error('PDF signature error: malformed DSA public key')
    publicKey = {
      kind: 'dsa', p: bytesToBigInt(parameters[0]!.content), q: bytesToBigInt(parameters[1]!.content),
      g: bytesToBigInt(parameters[2]!.content), y: bytesToBigInt(publicValue.content),
    }
  } else if (keyAlgOid === OID_ED25519 || keyAlgOid === OID_ED448) {
    if (algParts.length !== 1) throw new Error('PDF signature error: EdDSA public-key parameters must be absent')
    const curve: EdDsaCurveName = keyAlgOid === OID_ED25519 ? 'Ed25519' : 'Ed448'
    const encoded = bitString.content.subarray(1)
    const expectedLength = curve === 'Ed25519' ? 32 : 57
    if (encoded.length !== expectedLength) throw new Error(`PDF signature error: malformed ${curve} public key`)
    publicKey = { kind: 'ed', curve, encoded }
  } else {
    throw new Error(`PDF signature error: unsupported public key algorithm ${keyAlgOid}`)
  }
  const certificateSignature = parseCertificateSignatureAlgorithm(certificateParts[1]!)
  return {
    raw: der,
    tbsRaw: tbs.raw,
    issuerRaw,
    subjectRaw: subject.raw,
    serial,
    subjectKeyId,
    subjectPublicKey: bitString.content.subarray(1),
    subjectCommonName,
    notBefore,
    notAfter,
    isCertificateAuthority,
    extendedKeyUsageOids,
    signatureAlgorithm: certificateSignature.algorithm,
    signaturePss: certificateSignature.pss,
    signatureDigestAlgorithm: certificateSignature.digest,
    signature: certificateParts[2]!.content.subarray(1),
    publicKey,
  }
}

function parseCertificateSignatureAlgorithm(value: DerValue): {
  algorithm: CmsSignatureAlgorithm
  pss: RsaPssParams | null
  digest: string
} {
  const parts = derChildren(value)
  if (parts.length === 0 || parts[0]!.tag !== 0x06) throw new Error('PDF signature error: certificate signature algorithm lacks an OID')
  const oid = decodeOid(parts[0]!.content)
  if (oid === OID_RSASSA_PSS) {
    if (parts.length !== 2) throw new Error('PDF signature error: certificate RSA-PSS parameters are required')
    const pss = parseRsaPssParams(parts[1]!)
    return { algorithm: { kind: 'rsa-pss' }, pss, digest: pss.hash }
  }
  if (oid === OID_ED25519 || oid === OID_ED448) {
    if (parts.length !== 1) throw new Error('PDF signature error: certificate EdDSA parameters must be absent')
    const curve: EdDsaCurveName = oid === OID_ED25519 ? 'Ed25519' : 'Ed448'
    return {
      algorithm: { kind: 'eddsa', curve },
      pss: null,
      digest: curve === 'Ed25519' ? 'SHA-512' : 'SHAKE256',
    }
  }
  const digest = SIGNATURE_OIDS[oid]
  if (digest === undefined || digest === '') throw new Error(`PDF signature error: unsupported certificate signature algorithm ${oid}`)
  if (oid.startsWith('1.2.840.10045.4.')
      || oid === '2.16.840.1.101.3.4.3.10'
      || oid === '2.16.840.1.101.3.4.3.11'
      || oid === '2.16.840.1.101.3.4.3.12') {
    if (parts.length !== 1) throw new Error('PDF signature error: certificate ECDSA parameters must be absent')
    return { algorithm: { kind: 'ecdsa', digest }, pss: null, digest }
  }
  if (oid === '1.2.840.10040.4.3' || oid.startsWith('2.16.840.1.101.3.4.3.')) {
    if (parts.length !== 1) throw new Error('PDF signature error: certificate DSA parameters must be absent')
    return { algorithm: { kind: 'dsa', digest }, pss: null, digest }
  }
  validateNullOrAbsentParameters(parts, 'certificate RSA signature')
  return { algorithm: { kind: 'rsa-pkcs1-v1_5', digest }, pss: null, digest }
}

function findSignerCertificate(cms: CmsSignedData): ParsedCertificate {
  const signer = cms.signer
  for (let i = 0; i < cms.certificates.length; i++) {
    const cert = cms.certificates[i]!
    if (signer.sidSubjectKeyId !== null) {
      if (cert.subjectKeyId !== null && bytesEqual(cert.subjectKeyId, signer.sidSubjectKeyId)) return cert
    } else if (signer.sidIssuer !== null && signer.sidSerial !== null) {
      if (bytesEqual(cert.issuerRaw, signer.sidIssuer) && bytesEqual(cert.serial, signer.sidSerial)) return cert
    }
  }
  throw new Error('PDF signature error: signer certificate not found in the CMS structure')
}

// ---------------------------------------------------------------------------
// RSA PKCS#1 v1.5 signature verification
// ---------------------------------------------------------------------------

const DIGEST_INFO_OIDS: Record<string, string> = {
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

export function hashByName(name: string, data: Uint8Array): Uint8Array {
  if (name === 'SHA-1') return sha1(data)
  if (name === 'SHA-256') return sha256(data)
  if (name === 'SHA-384') return sha384(data)
  if (name === 'SHA-512') return sha512(data)
  if (name === 'SHA3-256') return sha3_256(data)
  if (name === 'SHA3-384') return sha3_384(data)
  if (name === 'SHA3-512') return sha3_512(data)
  if (name === 'SHAKE256') return shake256(data, 64)
  if (name === 'RIPEMD-160') return ripemd160(data)
  throw new Error(`PDF signature error: unsupported digest algorithm ${name}`)
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (let i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes[i]!)
  return value
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let b = base % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus
    b = (b * b) % modulus
    e >>= 1n
  }
  return result
}

/**
 * Verify an RSASSA-PKCS1-v1_5 signature (RFC 8017 8.2.2): recover the
 * encoded message and compare the padding, the DigestInfo algorithm, and the
 * digest itself.
 */
export function verifySignatureValue(
  publicKey: CertificatePublicKey,
  signature: Uint8Array,
  digestName: string,
  digest: Uint8Array,
  signatureAlgorithm: CmsSignatureAlgorithm,
  pss: RsaPssParams | null,
  signedMessage?: Uint8Array,
): boolean {
  if (signatureAlgorithm.kind === 'rsa-pss') {
    if (publicKey.kind !== 'rsa' || pss === null) throw new Error('PDF signature error: RSA-PSS signature requires an RSA certificate key')
    if (pss.hash !== digestName) throw new Error('PDF signature error: PSS hash differs from the message digest algorithm')
    return verifyRsaPss(publicKey, signature, pss, digest)
  }
  if (signatureAlgorithm.kind === 'ecdsa') {
    if (publicKey.kind !== 'ec') throw new Error('PDF signature error: ECDSA signature requires an EC certificate key')
    const permitted = ISO_32002_ECDSA_DIGESTS[publicKey.curveOid]
    if (permitted === undefined || !permitted.includes(digestName)) {
      throw new Error(`PDF signature error: ${digestName} is not permitted for ECDSA curve ${publicKey.curveOid}`)
    }
    // ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER } (RFC 5753)
    const sig = new DerReader(signature).read()
    if (sig.tag !== 0x30) return false
    const parts = derChildren(sig)
    if (parts.length !== 2 || parts[0]!.tag !== 0x02 || parts[1]!.tag !== 0x02) return false
    return verifyEcdsa(publicKey.curve, publicKey.x, publicKey.y, bytesToBigInt(parts[0]!.content), bytesToBigInt(parts[1]!.content), digest)
  }
  if (signatureAlgorithm.kind === 'eddsa') {
    if (publicKey.kind !== 'ed' || publicKey.curve !== signatureAlgorithm.curve) {
      throw new Error('PDF signature error: EdDSA signature requires the matching Edwards-curve certificate key')
    }
    if (signedMessage === undefined) throw new Error('PDF signature error: EdDSA verification requires the signed message bytes')
    return verifyEdDsa(publicKey.curve, publicKey.encoded, signedMessage, signature)
  }
  if (signatureAlgorithm.kind === 'dsa') {
    if (publicKey.kind !== 'dsa') throw new Error('PDF signature error: DSA signature requires a DSA certificate key')
    const sig = new DerReader(signature).read()
    if (sig.tag !== 0x30) return false
    const parts = derChildren(sig)
    if (parts.length !== 2 || parts[0]!.tag !== 0x02 || parts[1]!.tag !== 0x02) return false
    return verifyDsa(publicKey, bytesToBigInt(parts[0]!.content), bytesToBigInt(parts[1]!.content), digest)
  }
  if (publicKey.kind !== 'rsa') throw new Error('PDF signature error: RSA signature requires an RSA certificate key')
  return verifyRsaPkcs1(publicKey, signature, digestName, digest)
}

const ISO_32002_ECDSA_DIGESTS: Record<string, readonly string[]> = {
  '1.2.840.10045.3.1.7': ['SHA-256', 'SHA3-256'],
  '1.3.132.0.34': ['SHA-384', 'SHA3-384'],
  '1.3.132.0.35': ['SHA-512', 'SHA3-512'],
  '1.3.36.3.3.2.8.1.1.7': ['SHA-256', 'SHA-384', 'SHA-512', 'SHA3-256', 'SHA3-384', 'SHA3-512'],
  '1.3.36.3.3.2.8.1.1.11': ['SHA-384', 'SHA-512', 'SHA3-384', 'SHA3-512'],
  '1.3.36.3.3.2.8.1.1.13': ['SHA-512', 'SHA3-512'],
}

function verifyDsa(
  publicKey: { p: bigint, q: bigint, g: bigint, y: bigint },
  r: bigint,
  s: bigint,
  digest: Uint8Array,
): boolean {
  if (r <= 0n || r >= publicKey.q || s <= 0n || s >= publicKey.q) return false
  let z = bytesToBigInt(digest)
  const orderBits = publicKey.q.toString(2).length
  if (digest.length * 8 > orderBits) z >>= BigInt(digest.length * 8 - orderBits)
  const w = modPow(s, publicKey.q - 2n, publicKey.q)
  const u1 = (z * w) % publicKey.q
  const u2 = (r * w) % publicKey.q
  const v = ((modPow(publicKey.g, u1, publicKey.p) * modPow(publicKey.y, u2, publicKey.p)) % publicKey.p) % publicKey.q
  return v === r
}

function verifyRsaPkcs1(publicKey: { modulus: bigint, exponent: bigint }, signature: Uint8Array, digestName: string, digest: Uint8Array): boolean {
  const recovered = recoverRsaPkcs1Digest(publicKey, signature)
  return recovered !== null && recovered.digestName === digestName && bytesEqual(recovered.digest, digest)
}

function recoverRsaPkcs1Digest(
  publicKey: { modulus: bigint, exponent: bigint },
  signature: Uint8Array,
): { digestName: string, digest: Uint8Array } | null {
  const keyBytes = Math.ceil(publicKey.modulus.toString(16).length / 2)
  if (signature.length !== keyBytes) return null
  const em = modPow(bytesToBigInt(signature), publicKey.exponent, publicKey.modulus)
  const emBytes = new Uint8Array(keyBytes)
  let value = em
  for (let i = keyBytes - 1; i >= 0; i--) {
    emBytes[i] = Number(value & 0xFFn)
    value >>= 8n
  }
  // 0x00 0x01 PS(0xFF...) 0x00 DigestInfo
  if (emBytes[0] !== 0x00 || emBytes[1] !== 0x01) return null
  let p = 2
  while (p < emBytes.length && emBytes[p] === 0xFF) p++
  if (p < 10 || p >= emBytes.length || emBytes[p] !== 0x00) return null
  p++
  const digestInfo = new DerReader(emBytes, p).read()
  if (digestInfo.tag !== 0x30) return null
  const parts = derChildren(digestInfo)
  if (parts.length !== 2 || parts[1]!.tag !== 0x04) return null
  const algorithm = parseDigestAlgorithmIdentifier(parts[0]!)
  if (DIGEST_INFO_OIDS[algorithm] === undefined) return null
  return { digestName: algorithm, digest: parts[1]!.content }
}

/** MGF1 mask generation (RFC 8017 B.2.1). */
function mgf1(seed: Uint8Array, length: number, hashName: string): Uint8Array {
  const out = new Uint8Array(length)
  const input = new Uint8Array(seed.length + 4)
  input.set(seed)
  let pos = 0
  for (let counter = 0; pos < length; counter++) {
    input[seed.length] = counter >>> 24
    input[seed.length + 1] = (counter >>> 16) & 0xFF
    input[seed.length + 2] = (counter >>> 8) & 0xFF
    input[seed.length + 3] = counter & 0xFF
    const block = hashByName(hashName, input)
    const take = Math.min(block.length, length - pos)
    out.set(block.subarray(0, take), pos)
    pos += take
  }
  return out
}

/** Verify an RSASSA-PSS signature (RFC 8017 8.1.2 / EMSA-PSS-VERIFY 9.1.2). */
function verifyRsaPss(publicKey: { modulus: bigint, exponent: bigint }, signature: Uint8Array, pss: RsaPssParams, mHash: Uint8Array): boolean {
  const modBits = publicKey.modulus.toString(2).length
  const emLen = Math.ceil((modBits - 1) / 8)
  const keyBytes = Math.ceil(modBits / 8)
  if (signature.length !== keyBytes) return false
  const em = modPow(bytesToBigInt(signature), publicKey.exponent, publicKey.modulus)
  const emBytes = new Uint8Array(emLen)
  let value = em
  for (let i = emLen - 1; i >= 0; i--) {
    emBytes[i] = Number(value & 0xFFn)
    value >>= 8n
  }
  if (value !== 0n) return false
  const hLen = mHash.length
  const sLen = pss.saltLength
  if (emLen < hLen + sLen + 2) return false
  if (emBytes[emLen - 1] !== 0xBC) return false
  const maskedDb = emBytes.subarray(0, emLen - hLen - 1)
  const h = emBytes.subarray(emLen - hLen - 1, emLen - 1)
  const unusedBits = 8 * emLen - (modBits - 1)
  if (unusedBits > 0 && (maskedDb[0]! >> (8 - unusedBits)) !== 0) return false
  const dbMask = mgf1(h, maskedDb.length, pss.mgfHash)
  const db = new Uint8Array(maskedDb.length)
  for (let i = 0; i < db.length; i++) db[i] = maskedDb[i]! ^ dbMask[i]!
  if (unusedBits > 0) db[0] = db[0]! & (0xFF >> unusedBits)
  for (let i = 0; i < emLen - hLen - sLen - 2; i++) {
    if (db[i] !== 0) return false
  }
  if (db[emLen - hLen - sLen - 2] !== 0x01) return false
  const salt = db.subarray(db.length - sLen)
  // M' = 0x00 x8 || mHash || salt
  const mPrime = new Uint8Array(8 + hLen + sLen)
  mPrime.set(mHash, 8)
  mPrime.set(salt, 8 + hLen)
  return bytesEqual(hashByName(pss.hash, mPrime), h)
}
