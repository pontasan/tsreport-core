/**
 * Digital signature generation for PDFs: builds a CMS SignedData (RFC 5652)
 * over the /ByteRange digest and embeds it in the signature /Contents, the
 * symmetric counterpart of the verification in pdf-signature.ts. Supports
 * RSA PKCS#1 v1.5, RSA-PSS, DSA, and ECDSA signatures with the PDF 2.0 digest
 * algorithms and every PDF signature SubFilter that uses a local private key.
 */

import { sha1 } from '../encryption/sha1.js'
import { sha256 } from '../encryption/sha256.js'
import { sha384, sha512 } from '../encryption/sha512.js'
import { sha3_256, sha3_384, sha3_512, shake256 } from '../encryption/sha3.js'
import { ripemd160 } from '../encryption/ripemd160.js'
import { deriveEcPublicPoint, EC_CURVES, signEcdsa, type EcCurve } from '../encryption/ecdsa.js'
import { deriveEdDsaPublicKey, signEdDsa, type EdDsaCurveName } from '../encryption/eddsa.js'
import { decryptPkcs8PrivateKey } from '../encryption/pkcs8.js'
import { randomBytes } from '../renderer/pdf-encryption.js'
import {
  derSequence, derSet, derSetOfSorted, derInteger, derIntegerFromNumber,
  derOid, derOctetString, derNull, derUtcTime, derContext, derContextPrimitive, derRaw,
} from './der-encoder.js'
import {
  buildRfc3161TimestampRequest,
  parseRfc3161TimestampRequest,
  parseRfc3161TimestampToken,
  type Rfc3161RequestOptions,
  type Rfc3161TimestampRequestInfo,
} from './pdf-rfc3161.js'
import { PdfDocument, PdfName, PdfRef, PdfString, type PdfDict, type PdfValue } from './pdf-parser.js'
import { serializePdfValue } from './pdf-serializer.js'
import {
  buildPdfSignatureFieldLock,
  buildPdfSignatureSeedValue,
  buildPdfUsageRights,
  samePdfSignatureFieldSelection,
  type PdfSignatureFieldLock,
  type PdfSignatureFieldSelection,
  type PdfSignatureSeedValue,
  type PdfUsageRights,
} from './pdf-signature-policy.js'
import {
  certificateChainsTo,
  certificateMatchesKeyUsage,
  certificateMatchesSubjectDn,
  parseX509SeedFacts,
} from './x509-seed-policy.js'

/** RSA private key material (from a PKCS#1 or PKCS#8 parse). */
export interface RsaPrivateKey {
  modulus: bigint
  privateExponent: bigint
}

export type PdfSignatureDigestAlgorithm =
  | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | 'RIPEMD-160'
  | 'SHA3-256' | 'SHA3-384' | 'SHA3-512' | 'SHAKE256'
export type PdfSignatureAlgorithm = 'rsa-pkcs1-v1_5' | 'rsa-pss' | 'dsa' | 'ecdsa' | 'eddsa'
export type PdfLocalSignatureSubFilter =
  | 'adbe.x509.rsa_sha1'
  | 'adbe.pkcs7.sha1'
  | 'adbe.pkcs7.detached'
  | 'ETSI.CAdES.detached'

export interface PdfRsaPssOptions {
  /** MGF1 digest. Defaults to the message digest algorithm. */
  mgfDigestAlgorithm?: PdfSignatureDigestAlgorithm
  /** Salt length in bytes. Defaults to the message digest length. */
  saltLength?: number
  /** Exact salt for deterministic external-vector generation. */
  salt?: Uint8Array
}

export interface PdfSignOptions {
  pdf: Uint8Array
  privateKeyDer: Uint8Array
  /** Password for an RFC 8018 PBES2-encrypted PKCS#8 private key. */
  privateKeyPassword?: string | Uint8Array
  certDer: Uint8Array
  signingTime: Date
  reason?: string
  contactInfo?: string
  name?: string
  fieldName?: string
  /** Signature profile. CAdES adds the ESS signing-certificate-v2 attribute. */
  subFilter?: PdfLocalSignatureSubFilter
  /** CMS digest algorithm. Defaults to SHA-256. */
  digestAlgorithm?: PdfSignatureDigestAlgorithm
  /** Signature primitive. Defaults to the certificate key type. */
  signatureAlgorithm?: PdfSignatureAlgorithm
  /** CMS SignerIdentifier form. Defaults to issuerAndSerialNumber. */
  signerIdentifier?: 'issuer-and-serial' | 'subject-key-identifier'
  /** RSASSA-PSS parameters when signatureAlgorithm is rsa-pss. */
  rsaPss?: PdfRsaPssOptions
  fieldLock?: PdfSignatureFieldLock
  seedValue?: PdfSignatureSeedValue
  docMdpPermission?: 1 | 2 | 3
  fieldMdp?: PdfSignatureFieldSelection
  usageRights?: PdfUsageRights
  /** Selection made from /SV /LegalAttestation when that constraint is required. */
  legalAttestation?: string
  /** Credential source used to satisfy a non-Browser certificate seed /URL constraint. */
  credentialSourceUrl?: string
}

const DIGEST_OIDS: Record<PdfSignatureDigestAlgorithm, string> = {
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
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1'
const OID_RSASSA_PSS = '1.2.840.113549.1.1.10'
const OID_MGF1 = '1.2.840.113549.1.1.8'
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1'
const OID_DSA_PUBLIC_KEY = '1.2.840.10040.4.1'
const OID_ED25519 = '1.3.101.112'
const OID_ED448 = '1.3.101.113'
const ECDSA_OIDS: Partial<Record<PdfSignatureDigestAlgorithm, string>> = {
  'SHA-1': '1.2.840.10045.4.1',
  'SHA-256': '1.2.840.10045.4.3.2',
  'SHA-384': '1.2.840.10045.4.3.3',
  'SHA-512': '1.2.840.10045.4.3.4',
  'SHA3-256': '2.16.840.1.101.3.4.3.10',
  'SHA3-384': '2.16.840.1.101.3.4.3.11',
  'SHA3-512': '2.16.840.1.101.3.4.3.12',
}
const DSA_OIDS: Partial<Record<PdfSignatureDigestAlgorithm, string>> = {
  'SHA-1': '1.2.840.10040.4.3',
  'SHA-256': '2.16.840.1.101.3.4.3.2',
  'SHA-384': '2.16.840.1.101.3.4.3.3',
  'SHA-512': '2.16.840.1.101.3.4.3.4',
}
const OID_DATA = '1.2.840.113549.1.7.1'
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3'
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5'
const OID_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47'

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

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n
  for (let i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]!)
  return v
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let v = value
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xFFn)
    v >>= 8n
  }
  return out
}

function digestLength(algorithm: PdfSignatureDigestAlgorithm): number {
  if (algorithm === 'SHA-1') return 20
  if (algorithm === 'SHA-256') return 32
  if (algorithm === 'SHA-384') return 48
  if (algorithm === 'SHA-512' || algorithm === 'SHA3-512' || algorithm === 'SHAKE256') return 64
  if (algorithm === 'SHA3-256') return 32
  if (algorithm === 'SHA3-384') return 48
  return 20
}

function hashByName(algorithm: PdfSignatureDigestAlgorithm, data: Uint8Array): Uint8Array {
  if (algorithm === 'SHA-1') return sha1(data)
  if (algorithm === 'SHA-256') return sha256(data)
  if (algorithm === 'SHA-384') return sha384(data)
  if (algorithm === 'SHA-512') return sha512(data)
  if (algorithm === 'SHA3-256') return sha3_256(data)
  if (algorithm === 'SHA3-384') return sha3_384(data)
  if (algorithm === 'SHA3-512') return sha3_512(data)
  if (algorithm === 'SHAKE256') return shake256(data, 64)
  return ripemd160(data)
}

const ISO_32002_ECDSA_DIGESTS: Record<string, readonly PdfSignatureDigestAlgorithm[]> = {
  '1.2.840.10045.3.1.7': ['SHA-256', 'SHA3-256'],
  '1.3.132.0.34': ['SHA-384', 'SHA3-384'],
  '1.3.132.0.35': ['SHA-512', 'SHA3-512'],
  '1.3.36.3.3.2.8.1.1.7': ['SHA-256', 'SHA-384', 'SHA-512', 'SHA3-256', 'SHA3-384', 'SHA3-512'],
  '1.3.36.3.3.2.8.1.1.11': ['SHA-384', 'SHA-512', 'SHA3-384', 'SHA3-512'],
  '1.3.36.3.3.2.8.1.1.13': ['SHA-512', 'SHA3-512'],
}

function defaultDigestForKey(key: PrivateSigningKey): PdfSignatureDigestAlgorithm {
  if (key.kind === 'ed') return key.curve === 'Ed25519' ? 'SHA-512' : 'SHAKE256'
  if (key.kind !== 'ec') return 'SHA-256'
  if (key.curveOid === '1.3.132.0.34' || key.curveOid === '1.3.36.3.3.2.8.1.1.11') return 'SHA-384'
  if (key.curveOid === '1.3.132.0.35' || key.curveOid === '1.3.36.3.3.2.8.1.1.13') return 'SHA-512'
  return 'SHA-256'
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (let i = 0; i < parts.length; i++) length += parts[i]!.length
  const result = new Uint8Array(length)
  let offset = 0
  for (let i = 0; i < parts.length; i++) { result.set(parts[i]!, offset); offset += parts[i]!.length }
  return result
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
  return true
}

function hmac(algorithm: PdfSignatureDigestAlgorithm, key: Uint8Array, data: Uint8Array): Uint8Array {
  if (algorithm === 'SHAKE256') throw new Error('pdf-signer: SHAKE256 is not an HMAC algorithm')
  const blockLength = algorithm === 'SHA-384' || algorithm === 'SHA-512' ? 128
    : algorithm === 'SHA3-256' ? 136 : algorithm === 'SHA3-384' ? 104 : algorithm === 'SHA3-512' ? 72 : 64
  let normalized = key.length > blockLength ? hashByName(algorithm, key) : key
  if (normalized.length < blockLength) {
    const padded = new Uint8Array(blockLength)
    padded.set(normalized)
    normalized = padded
  }
  const innerKey = new Uint8Array(blockLength)
  const outerKey = new Uint8Array(blockLength)
  for (let i = 0; i < blockLength; i++) {
    innerKey[i] = normalized[i]! ^ 0x36
    outerKey[i] = normalized[i]! ^ 0x5c
  }
  return hashByName(algorithm, concatBytes(outerKey, hashByName(algorithm, concatBytes(innerKey, data))))
}

function mgf1(seed: Uint8Array, length: number, algorithm: PdfSignatureDigestAlgorithm): Uint8Array {
  const result = new Uint8Array(length)
  const counterInput = new Uint8Array(seed.length + 4)
  counterInput.set(seed)
  let offset = 0
  for (let counter = 0; offset < length; counter++) {
    counterInput[seed.length] = counter >>> 24
    counterInput[seed.length + 1] = counter >>> 16
    counterInput[seed.length + 2] = counter >>> 8
    counterInput[seed.length + 3] = counter
    const block = hashByName(algorithm, counterInput)
    const take = Math.min(block.length, length - offset)
    result.set(block.subarray(0, take), offset)
    offset += take
  }
  return result
}

function signRsaPss(
  key: RsaPrivateKey,
  digestAlgorithm: PdfSignatureDigestAlgorithm,
  digest: Uint8Array,
  mgfDigestAlgorithm: PdfSignatureDigestAlgorithm,
  salt: Uint8Array,
): Uint8Array {
  const modulusBits = key.modulus.toString(2).length
  const encodedLength = Math.ceil((modulusBits - 1) / 8)
  const hashLength = digestLength(digestAlgorithm)
  if (digest.length !== hashLength) throw new Error(`pdf-signer: ${digestAlgorithm} digest has an invalid length`)
  if (encodedLength < hashLength + salt.length + 2) throw new Error('pdf-signer: RSA key is too small for the requested PSS salt')
  const mPrime = new Uint8Array(8 + hashLength + salt.length)
  mPrime.set(digest, 8)
  mPrime.set(salt, 8 + hashLength)
  const h = hashByName(digestAlgorithm, mPrime)
  const dbLength = encodedLength - hashLength - 1
  const db = new Uint8Array(dbLength)
  db[dbLength - salt.length - 1] = 1
  db.set(salt, dbLength - salt.length)
  const mask = mgf1(h, dbLength, mgfDigestAlgorithm)
  for (let i = 0; i < dbLength; i++) db[i] = db[i]! ^ mask[i]!
  const unusedBits = encodedLength * 8 - (modulusBits - 1)
  db[0] = db[0]! & (0xff >>> unusedBits)
  const encoded = concatBytes(db, h, new Uint8Array([0xbc]))
  const signature = modPow(bytesToBigInt(encoded), key.privateExponent, key.modulus)
  return bigIntToBytes(signature, Math.ceil(modulusBits / 8))
}

function digestInteger(digest: Uint8Array, order: bigint): bigint {
  let value = bytesToBigInt(digest)
  const orderBits = order.toString(2).length
  if (digest.length * 8 > orderBits) value >>= BigInt(digest.length * 8 - orderBits)
  return value
}

function deterministicSignatureNonce(
  order: bigint,
  privateScalar: bigint,
  digest: Uint8Array,
  algorithm: PdfSignatureDigestAlgorithm,
  rejectedSignatures: number,
): bigint {
  const orderBits = order.toString(2).length
  const orderBytes = Math.ceil(orderBits / 8)
  const z = digestInteger(digest, order) % order
  const bx = concatBytes(bigIntToBytes(privateScalar, orderBytes), bigIntToBytes(z, orderBytes))
  let v: Uint8Array = new Uint8Array(digestLength(algorithm)).fill(1)
  let k: Uint8Array = new Uint8Array(digestLength(algorithm))
  k = hmac(algorithm, k, concatBytes(v, new Uint8Array([0]), bx))
  v = hmac(algorithm, k, v)
  k = hmac(algorithm, k, concatBytes(v, new Uint8Array([1]), bx))
  v = hmac(algorithm, k, v)
  while (true) {
    let t: Uint8Array = new Uint8Array(0)
    while (t.length < orderBytes) { v = hmac(algorithm, k, v); t = concatBytes(t, v) }
    let candidate = bytesToBigInt(t.subarray(0, orderBytes))
    if (orderBytes * 8 > orderBits) candidate >>= BigInt(orderBytes * 8 - orderBits)
    if (candidate > 0n && candidate < order) {
      if (rejectedSignatures === 0) return candidate
      rejectedSignatures--
    }
    k = hmac(algorithm, k, concatBytes(v, new Uint8Array([0])))
    v = hmac(algorithm, k, v)
  }
}

/**
 * RSASSA-PKCS1-v1_5 sign (RFC 8017 8.2.1): DigestInfo(SHA-256, digest) padded
 * as 0x00 0x01 0xFF..0xFF 0x00 T, then RSA private-key exponentiation.
 */
export function signRsaPkcs1Sha256(key: RsaPrivateKey, digest: Uint8Array): Uint8Array {
  if (digest.length !== 32) throw new Error('pdf-signer: SHA-256 digest must be 32 bytes')
  return signRsaPkcs1(key, 'SHA-256', digest)
}

function signRsaPkcs1(key: RsaPrivateKey, algorithm: PdfSignatureDigestAlgorithm, digest: Uint8Array): Uint8Array {
  if (digest.length !== digestLength(algorithm)) throw new Error(`pdf-signer: ${algorithm} digest has an invalid length`)
  // DigestInfo ::= SEQUENCE { digestAlgorithm SEQUENCE { OID, NULL }, digest OCTET STRING }
  const digestInfo = derSequence(
    derSequence(derOid(DIGEST_OIDS[algorithm]), derNull()),
    derOctetString(digest),
  )
  const keyBytes = Math.ceil(key.modulus.toString(16).length / 2)
  if (digestInfo.length + 11 > keyBytes) throw new Error('pdf-signer: RSA key too small for the digest')
  const em = new Uint8Array(keyBytes)
  em[0] = 0x00
  em[1] = 0x01
  const psLen = keyBytes - digestInfo.length - 3
  for (let i = 0; i < psLen; i++) em[2 + i] = 0xFF
  em[2 + psLen] = 0x00
  em.set(digestInfo, 3 + psLen)
  const signature = modPow(bytesToBigInt(em), key.privateExponent, key.modulus)
  return bigIntToBytes(signature, keyBytes)
}

/**
 * Builds a CMS SignedData (RFC 5652) for adbe.pkcs7.detached: SHA-256 content
 * digest, signed attributes (contentType, messageDigest, signingTime), an
 * RSA signature over those attributes, and the signer certificate. `certDer`
 * is the signer's X.509 certificate in DER; `signerSerial`/`issuerDer` identify
 * it via IssuerAndSerialNumber.
 */
export function buildCmsSignedData(
  key: RsaPrivateKey,
  certDer: Uint8Array,
  issuerDer: Uint8Array,
  serial: bigint,
  contentDigest: Uint8Array,
  signingTime: Date,
  cades = false,
): Uint8Array {
  return buildCmsSignedDataForKey(
    { kind: 'rsa', key }, certDer, { issuerDer, serial, subjectKeyIdentifier: null },
    contentDigest, signingTime, 'SHA-256', 'rsa-pkcs1-v1_5',
    'issuer-and-serial', cades, null, undefined,
  )
}

type PrivateSigningKey =
  | { kind: 'rsa', key: RsaPrivateKey }
  | { kind: 'dsa', p: bigint, q: bigint, g: bigint, scalar: bigint }
  | { kind: 'ec', curve: EcCurve, curveOid: string, scalar: bigint }
  | { kind: 'ed', curve: EdDsaCurveName, seed: Uint8Array }

interface CertificateSigningIdentity {
  issuerDer: Uint8Array
  serial: bigint
  subjectKeyIdentifier: Uint8Array | null
}

function buildCmsSignedDataForKey(
  key: PrivateSigningKey,
  certDer: Uint8Array,
  identity: CertificateSigningIdentity,
  contentDigest: Uint8Array,
  signingTime: Date,
  digestAlgorithm: PdfSignatureDigestAlgorithm,
  signatureAlgorithm: PdfSignatureAlgorithm,
  signerIdentifier: 'issuer-and-serial' | 'subject-key-identifier',
  cades: boolean,
  encapsulatedContent: Uint8Array | null,
  rsaPss: PdfRsaPssOptions | undefined,
): Uint8Array {
  const digestAlg = derSequence(derOid(DIGEST_OIDS[digestAlgorithm]), derNull())

  // SignedAttributes (RFC 5652 5.3), DER-sorted SET OF Attribute.
  const attrContentType = derSequence(derOid(OID_CONTENT_TYPE), derSet(derOid(OID_DATA)))
  const attrMessageDigest = derSequence(derOid(OID_MESSAGE_DIGEST), derSet(derOctetString(contentDigest)))
  const attrSigningTime = derSequence(derOid(OID_SIGNING_TIME), derSet(derUtcTime(signingTime)))
  const attributes = [attrContentType, attrMessageDigest, attrSigningTime]
  if (cades) {
    // ESS signing-certificate-v2 binds the signer certificate into the signed
    // attributes. SHA-256 is the DEFAULT hash and is therefore omitted.
    const signingCertificateV2 = derSequence(derSequence(derSequence(derOctetString(sha256(certDer)))))
    attributes.push(derSequence(derOid(OID_SIGNING_CERTIFICATE_V2), derSet(signingCertificateV2)))
  }
  const signedAttrsSet = derSetOfSorted(attributes)
  // The signature is computed over the SET OF encoding (0x31), but the
  // structure carries it as [0] IMPLICIT — same content, different tag.
  const signedAttrsForSig = signedAttrsSet
  const signedAttrsImplicit = new Uint8Array(signedAttrsSet)
  signedAttrsImplicit[0] = 0xA0

  const attrDigest = hashByName(digestAlgorithm, signedAttrsForSig)
  let signature: Uint8Array
  let signatureAlg: Uint8Array
  if (signatureAlgorithm === 'rsa-pkcs1-v1_5') {
    if (key.kind !== 'rsa') throw new Error('pdf-signer: RSA signature algorithm requires an RSA private key')
    signature = signRsaPkcs1(key.key, digestAlgorithm, attrDigest)
    signatureAlg = derSequence(derOid(OID_RSA_ENCRYPTION), derNull())
  } else if (signatureAlgorithm === 'rsa-pss') {
    if (key.kind !== 'rsa') throw new Error('pdf-signer: RSA-PSS requires an RSA private key')
    const mgfDigest = rsaPss?.mgfDigestAlgorithm ?? digestAlgorithm
    const saltLength = rsaPss?.saltLength ?? digestLength(digestAlgorithm)
    if (!Number.isInteger(saltLength) || saltLength < 0) throw new Error('pdf-signer: RSA-PSS saltLength must be a non-negative integer')
    const salt = rsaPss?.salt ?? randomBytes(saltLength)
    if (salt.length !== saltLength) throw new Error('pdf-signer: RSA-PSS salt length does not match saltLength')
    signature = signRsaPss(key.key, digestAlgorithm, attrDigest, mgfDigest, salt)
    const params = derSequence(
      derContext(0, derSequence(derOid(DIGEST_OIDS[digestAlgorithm]), derNull())),
      derContext(1, derSequence(derOid(OID_MGF1), derSequence(derOid(DIGEST_OIDS[mgfDigest]), derNull()))),
      derContext(2, derIntegerFromNumber(saltLength)),
    )
    signatureAlg = derSequence(derOid(OID_RSASSA_PSS), params)
  } else if (signatureAlgorithm === 'ecdsa') {
    if (key.kind !== 'ec') throw new Error('pdf-signer: ECDSA requires an EC private key')
    let rejectedSignatures = 0
    let value: { r: bigint, s: bigint } | null = null
    while (value === null) {
      const nonce = deterministicSignatureNonce(key.curve.n, key.scalar, attrDigest, digestAlgorithm, rejectedSignatures)
      value = signEcdsa(key.curve, key.scalar, attrDigest, nonce)
      rejectedSignatures++
    }
    signature = derSequence(derInteger(value.r), derInteger(value.s))
    const signatureOid = ECDSA_OIDS[digestAlgorithm]
    if (signatureOid === undefined) throw new Error(`pdf-signer: ECDSA does not support ${digestAlgorithm} in PDF 2.0`)
    signatureAlg = derSequence(derOid(signatureOid))
  } else if (signatureAlgorithm === 'eddsa') {
    if (key.kind !== 'ed') throw new Error('pdf-signer: EdDSA requires an Edwards-curve private key')
    const requiredDigest = key.curve === 'Ed25519' ? 'SHA-512' : 'SHAKE256'
    if (digestAlgorithm !== requiredDigest) {
      throw new Error(`pdf-signer: ${key.curve} requires ${requiredDigest} as the CMS message digest`)
    }
    signature = signEdDsa(key.curve, key.seed, signedAttrsForSig)
    signatureAlg = derSequence(derOid(key.curve === 'Ed25519' ? OID_ED25519 : OID_ED448))
  } else {
    if (key.kind !== 'dsa') throw new Error('pdf-signer: DSA requires a DSA private key')
    let rejectedSignatures = 0
    while (true) {
      const nonce = deterministicSignatureNonce(key.q, key.scalar, attrDigest, digestAlgorithm, rejectedSignatures)
      rejectedSignatures++
      const r = modPow(key.g, nonce, key.p) % key.q
      if (r === 0n) continue
      const z = digestInteger(attrDigest, key.q)
      const s = (modPow(nonce, key.q - 2n, key.q) * (z + key.scalar * r)) % key.q
      if (s === 0n) continue
      signature = derSequence(derInteger(r), derInteger(s))
      break
    }
    const signatureOid = DSA_OIDS[digestAlgorithm]
    if (signatureOid === undefined) throw new Error(`pdf-signer: DSA does not support ${digestAlgorithm} in PDF 2.0`)
    signatureAlg = derSequence(derOid(signatureOid))
  }

  let sid: Uint8Array
  let signerVersion: number
  if (signerIdentifier === 'subject-key-identifier') {
    if (identity.subjectKeyIdentifier === null) throw new Error('pdf-signer: subject-key-identifier requires an X.509 SubjectKeyIdentifier extension')
    sid = derContextPrimitive(0, identity.subjectKeyIdentifier)
    signerVersion = 3
  } else {
    sid = derSequence(derRaw(identity.issuerDer), derInteger(identity.serial))
    signerVersion = 1
  }

  const signerInfo = derSequence(
    derIntegerFromNumber(signerVersion),
    sid,
    digestAlg,
    signedAttrsImplicit, // signedAttrs [0] IMPLICIT
    signatureAlg,
    derOctetString(signature), // signature
  )

  const encapContentInfo = encapsulatedContent === null
    ? derSequence(derOid(OID_DATA))
    : derSequence(derOid(OID_DATA), derContext(0, derOctetString(encapsulatedContent)))
  const signedData = derSequence(
    derIntegerFromNumber(signerVersion === 3 ? 3 : 1),
    derSet(digestAlg),
    encapContentInfo,
    derContext(0, derRaw(certDer)), // certificates [0]
    derSet(signerInfo), // signerInfos
  )

  // ContentInfo ::= SEQUENCE { contentType OID, content [0] SignedData }
  return derSequence(derOid(OID_SIGNED_DATA), derContext(0, signedData))
}

// ---------------------------------------------------------------------------
// Minimal DER reader for private-key and certificate identity extraction.
// ---------------------------------------------------------------------------

interface DerTLV { tag: number, content: Uint8Array, raw: Uint8Array }

function readDer(data: Uint8Array, start: number): { value: DerTLV, next: number } {
  const tag = data[start]!
  let p = start + 1
  let len = data[p]!
  p++
  if (len & 0x80) {
    const nBytes = len & 0x7F
    len = 0
    for (let i = 0; i < nBytes; i++) { len = len * 256 + data[p]!; p++ }
  }
  return { value: { tag, content: data.subarray(p, p + len), raw: data.subarray(start, p + len) }, next: p + len }
}

function derSeqChildren(content: Uint8Array): DerTLV[] {
  const out: DerTLV[] = []
  let p = 0
  while (p < content.length) {
    const { value, next } = readDer(content, p)
    out.push(value)
    p = next
  }
  return out
}

function decodeOid(content: Uint8Array): string {
  const parts = [Math.trunc(content[0]! / 40), content[0]! % 40]
  let value = 0
  for (let i = 1; i < content.length; i++) {
    value = value * 128 + (content[i]! & 0x7f)
    if ((content[i]! & 0x80) === 0) { parts.push(value); value = 0 }
  }
  return parts.join('.')
}

function parsePrivateSigningKey(der: Uint8Array): PrivateSigningKey {
  const topValue = readDer(der, 0).value
  if (topValue.tag !== 0x30) throw new Error('pdf-signer: private key must be a DER SEQUENCE')
  const top = derSeqChildren(topValue.content)
  // Traditional PKCS#1 RSAPrivateKey.
  if (top.length >= 4 && top[1]!.tag === 0x02 && top[2]!.tag === 0x02 && top[3]!.tag === 0x02) {
    // Traditional DSA form has version,p,q,g,y,x; RSA has more fields and its
    // public exponent occupies the third INTEGER.
    if (top.length === 6) {
      return {
        kind: 'dsa', p: bytesToBigInt(top[1]!.content), q: bytesToBigInt(top[2]!.content),
        g: bytesToBigInt(top[3]!.content), scalar: bytesToBigInt(top[5]!.content),
      }
    }
    return { kind: 'rsa', key: { modulus: bytesToBigInt(top[1]!.content), privateExponent: bytesToBigInt(top[3]!.content) } }
  }
  // Traditional SEC1 ECPrivateKey.
  if (top.length >= 2 && top[0]!.tag === 0x02 && top[1]!.tag === 0x04) {
    const parameters = top.find(function (value) { return value.tag === 0xa0 })
    if (parameters === undefined) throw new Error('pdf-signer: SEC1 EC private key lacks named-curve parameters')
    const curveOid = decodeOid(derSeqChildren(parameters.content)[0]!.content)
    const curve = EC_CURVES[curveOid]
    if (curve === undefined) throw new Error(`pdf-signer: unsupported EC curve ${curveOid}`)
    return { kind: 'ec', curve, curveOid, scalar: bytesToBigInt(top[1]!.content) }
  }
  // PKCS#8 PrivateKeyInfo.
  if (top.length < 3 || top[1]!.tag !== 0x30 || top[2]!.tag !== 0x04) {
    throw new Error('pdf-signer: unrecognized private key structure')
  }
  const algorithm = derSeqChildren(top[1]!.content)
  const algorithmOid = decodeOid(algorithm[0]!.content)
  if (algorithmOid === OID_RSA_ENCRYPTION) {
    const inner = derSeqChildren(readDer(top[2]!.content, 0).value.content)
    if (inner.length < 4) throw new Error('pdf-signer: malformed PKCS#8 RSA private key')
    return { kind: 'rsa', key: { modulus: bytesToBigInt(inner[1]!.content), privateExponent: bytesToBigInt(inner[3]!.content) } }
  }
  if (algorithmOid === OID_EC_PUBLIC_KEY) {
    const inner = derSeqChildren(readDer(top[2]!.content, 0).value.content)
    if (algorithm.length < 2 || algorithm[1]!.tag !== 0x06) throw new Error('pdf-signer: EC private key lacks named-curve parameters')
    const curveOid = decodeOid(algorithm[1]!.content)
    const curve = EC_CURVES[curveOid]
    if (curve === undefined) throw new Error(`pdf-signer: unsupported EC curve ${curveOid}`)
    if (inner.length < 2 || inner[1]!.tag !== 0x04) throw new Error('pdf-signer: malformed PKCS#8 EC private key')
    return { kind: 'ec', curve, curveOid, scalar: bytesToBigInt(inner[1]!.content) }
  }
  if (algorithmOid === OID_DSA_PUBLIC_KEY) {
    if (algorithm.length !== 2 || algorithm[1]!.tag !== 0x30) throw new Error('pdf-signer: DSA private key lacks parameters')
    const parameters = derSeqChildren(algorithm[1]!.content)
    if (parameters.length !== 3) throw new Error('pdf-signer: malformed DSA parameters')
    const scalarValue = readDer(top[2]!.content, 0).value
    if (scalarValue.tag !== 0x02) throw new Error('pdf-signer: malformed PKCS#8 DSA private key')
    return {
      kind: 'dsa', p: bytesToBigInt(parameters[0]!.content), q: bytesToBigInt(parameters[1]!.content),
      g: bytesToBigInt(parameters[2]!.content), scalar: bytesToBigInt(scalarValue.content),
    }
  }
  if (algorithmOid === OID_ED25519 || algorithmOid === OID_ED448) {
    if (algorithm.length !== 1) throw new Error('pdf-signer: EdDSA private-key parameters must be absent')
    const seedValue = readDer(top[2]!.content, 0).value
    if (seedValue.tag !== 0x04 || seedValue.raw.length !== top[2]!.content.length) {
      throw new Error('pdf-signer: malformed RFC 8410 EdDSA private key')
    }
    const curve: EdDsaCurveName = algorithmOid === OID_ED25519 ? 'Ed25519' : 'Ed448'
    const expectedLength = curve === 'Ed25519' ? 32 : 57
    if (seedValue.content.length !== expectedLength) throw new Error(`pdf-signer: ${curve} private seed must be ${expectedLength} bytes`)
    return { kind: 'ed', curve, seed: seedValue.content }
  }
  throw new Error(`pdf-signer: unsupported private key algorithm ${algorithmOid}`)
}

/**
 * Parses a PKCS#8 (PrivateKeyInfo) or PKCS#1 (RSAPrivateKey) DER private key
 * and returns the RSA modulus and private exponent.
 */
export function parseRsaPrivateKey(der: Uint8Array): RsaPrivateKey {
  const key = parsePrivateSigningKey(der)
  if (key.kind !== 'rsa') throw new Error('pdf-signer: private key is not RSA')
  return key.key
}

/** Extracts the issuer DER and serial-number bigint from an X.509 certificate. */
export function extractCertIdentity(certDer: Uint8Array): { issuerDer: Uint8Array, serial: bigint } {
  const identity = extractCertificateSigningIdentity(certDer)
  return { issuerDer: identity.issuerDer, serial: identity.serial }
}

type CertificateSigningKey =
  | { kind: 'rsa', modulus: bigint }
  | { kind: 'dsa', p: bigint, q: bigint, g: bigint, y: bigint }
  | { kind: 'ec', curveOid: string, x: bigint, y: bigint }
  | { kind: 'ed', curve: EdDsaCurveName, publicKey: Uint8Array }

function extractCertificateSigningIdentity(certDer: Uint8Array): CertificateSigningIdentity & { publicKey: CertificateSigningKey } {
  const cert = derSeqChildren(readDer(certDer, 0).value.content)
  const tbs = derSeqChildren(cert[0]!.content)
  let i = 0
  if (tbs[0]!.tag === 0xA0) i++ // version [0]
  const serial = bytesToBigInt(tbs[i]!.content)
  i++ // serialNumber
  i++ // signature algorithm
  const issuerDer = tbs[i]!.raw // issuer Name (full SEQUENCE, DER)
  i++ // issuer
  i++ // validity
  i++ // subject
  const spki = derSeqChildren(tbs[i]!.content)
  const publicAlgorithm = derSeqChildren(spki[0]!.content)
  const publicAlgorithmOid = decodeOid(publicAlgorithm[0]!.content)
  const bitString = spki[1]!
  if (bitString.tag !== 0x03 || bitString.content[0] !== 0) throw new Error('pdf-signer: malformed certificate public key')
  let publicKey: CertificateSigningKey
  if (publicAlgorithmOid === OID_RSA_ENCRYPTION) {
    const rsa = derSeqChildren(readDer(bitString.content, 1).value.content)
    publicKey = { kind: 'rsa', modulus: bytesToBigInt(rsa[0]!.content) }
  } else if (publicAlgorithmOid === OID_EC_PUBLIC_KEY) {
    if (publicAlgorithm.length < 2 || publicAlgorithm[1]!.tag !== 0x06) throw new Error('pdf-signer: certificate EC key lacks a named curve')
    const curveOid = decodeOid(publicAlgorithm[1]!.content)
    const curve = EC_CURVES[curveOid]
    if (curve === undefined) throw new Error(`pdf-signer: unsupported certificate EC curve ${curveOid}`)
    const point = bitString.content.subarray(1)
    if (point[0] !== 4 || point.length !== 1 + curve.size * 2) throw new Error('pdf-signer: certificate EC point must be uncompressed')
    publicKey = {
      kind: 'ec', curveOid,
      x: bytesToBigInt(point.subarray(1, 1 + curve.size)),
      y: bytesToBigInt(point.subarray(1 + curve.size)),
    }
  } else if (publicAlgorithmOid === OID_DSA_PUBLIC_KEY) {
    if (publicAlgorithm.length !== 2 || publicAlgorithm[1]!.tag !== 0x30) throw new Error('pdf-signer: certificate DSA key lacks parameters')
    const parameters = derSeqChildren(publicAlgorithm[1]!.content)
    const publicValue = readDer(bitString.content, 1).value
    if (parameters.length !== 3 || publicValue.tag !== 0x02) throw new Error('pdf-signer: malformed certificate DSA key')
    publicKey = {
      kind: 'dsa', p: bytesToBigInt(parameters[0]!.content), q: bytesToBigInt(parameters[1]!.content),
      g: bytesToBigInt(parameters[2]!.content), y: bytesToBigInt(publicValue.content),
    }
  } else if (publicAlgorithmOid === OID_ED25519 || publicAlgorithmOid === OID_ED448) {
    if (publicAlgorithm.length !== 1) throw new Error('pdf-signer: EdDSA certificate-key parameters must be absent')
    const curve: EdDsaCurveName = publicAlgorithmOid === OID_ED25519 ? 'Ed25519' : 'Ed448'
    const publicKeyBytes = bitString.content.subarray(1)
    const expectedLength = curve === 'Ed25519' ? 32 : 57
    if (publicKeyBytes.length !== expectedLength) throw new Error(`pdf-signer: malformed ${curve} certificate public key`)
    publicKey = { kind: 'ed', curve, publicKey: publicKeyBytes }
  } else {
    throw new Error(`pdf-signer: unsupported certificate public key algorithm ${publicAlgorithmOid}`)
  }
  let subjectKeyIdentifier: Uint8Array | null = null
  i++
  for (; i < tbs.length; i++) {
    if (tbs[i]!.tag !== 0xa3) continue
    const extensions = derSeqChildren(derSeqChildren(tbs[i]!.content)[0]!.content)
    for (let j = 0; j < extensions.length; j++) {
      const extension = derSeqChildren(extensions[j]!.content)
      if (decodeOid(extension[0]!.content) !== '2.5.29.14') continue
      const outerOctets = extension[extension.length - 1]!
      const innerOctets = readDer(outerOctets.content, 0).value
      if (innerOctets.tag !== 0x04) throw new Error('pdf-signer: malformed SubjectKeyIdentifier extension')
      subjectKeyIdentifier = innerOctets.content
    }
  }
  return { issuerDer, serial, subjectKeyIdentifier, publicKey }
}

/**
 * Signs an existing PDF via an incremental update (ISO 32000 12.8): appends an
 * approval signature field whose /Contents holds a CMS SignedData over the whole
 * file except the /Contents hex gap. Returns the signed PDF bytes. The input
 * must be a non-linearized, unencrypted PDF whose trailer exposes /Root and
 * /Size. `signingTime` is required (Date.now is unavailable here by design).
 */
export function signPdf(input: PdfSignOptions): Uint8Array {
  const privateKeyDer = input.privateKeyPassword === undefined
    ? input.privateKeyDer
    : decryptPkcs8PrivateKey(input.privateKeyDer, input.privateKeyPassword)
  const key = parsePrivateSigningKey(privateKeyDer)
  const identity = extractCertificateSigningIdentity(input.certDer)
  if (key.kind !== identity.publicKey.kind) throw new Error('pdf-signer: private key type does not match the certificate')
  if (key.kind === 'rsa' && identity.publicKey.kind === 'rsa' && key.key.modulus !== identity.publicKey.modulus) {
    throw new Error('pdf-signer: RSA private key does not match the certificate')
  }
  if (key.kind === 'ec' && identity.publicKey.kind === 'ec') {
    const point = deriveEcPublicPoint(key.curve, key.scalar)
    if (key.curveOid !== identity.publicKey.curveOid || point.x !== identity.publicKey.x || point.y !== identity.publicKey.y) {
      throw new Error(`pdf-signer: EC private key does not match the certificate for curve ${key.curveOid}`)
    }
  }
  if (key.kind === 'dsa' && identity.publicKey.kind === 'dsa') {
    if (key.p !== identity.publicKey.p || key.q !== identity.publicKey.q || key.g !== identity.publicKey.g
        || modPow(key.g, key.scalar, key.p) !== identity.publicKey.y) {
      throw new Error('pdf-signer: DSA private key does not match the certificate')
    }
  }
  if (key.kind === 'ed' && identity.publicKey.kind === 'ed') {
    const publicKey = deriveEdDsaPublicKey(key.curve, key.seed)
    if (key.curve !== identity.publicKey.curve || !bytesEqual(publicKey, identity.publicKey.publicKey)) {
      throw new Error('pdf-signer: EdDSA private key does not match the certificate')
    }
  }

  const enc = new TextEncoder()
  const src = input.pdf
  // Locate the previous startxref and the trailer /Root and /Size.
  const text = latin1(src)
  const prevStartxref = readLastStartxref(text)
  const structure = readSigningStructure(src)
  const { rootNum, rootGen, size } = structure
  const catalogObjNum = rootNum
  const catalogValue = structure.objectValue(catalogObjNum)
  if (!(catalogValue instanceof Map)) throw new Error('pdf-signer: catalog is not a dictionary')
  let catalogBody = structure.objectBody(catalogObjNum)
  let indirectAcroForm = /\/AcroForm\s+(\d+)\s+(\d+)\s+R/.exec(catalogBody)
  let directAcroForm = indirectAcroForm === null ? findDirectDictionaryEntry(catalogBody, 'AcroForm') : null

  const subFilter = selectSignatureSubFilter(input)
  const digestAlgorithm = input.digestAlgorithm ?? (subFilter === 'adbe.x509.rsa_sha1' ? 'SHA-1' : defaultDigestForKey(key))
  const signatureAlgorithm = input.signatureAlgorithm ?? (key.kind === 'rsa' ? 'rsa-pkcs1-v1_5' : key.kind === 'dsa' ? 'dsa' : key.kind === 'ec' ? 'ecdsa' : 'eddsa')
  const signerIdentifier = input.signerIdentifier ?? 'issuer-and-serial'
  if (subFilter === 'adbe.x509.rsa_sha1') {
    if (key.kind !== 'rsa' || signatureAlgorithm !== 'rsa-pkcs1-v1_5') {
      throw new Error('pdf-signer: adbe.x509.rsa_sha1 requires RSA PKCS#1 v1.5')
    }
    if (input.signerIdentifier !== undefined || input.rsaPss !== undefined) {
      throw new Error('pdf-signer: adbe.x509.rsa_sha1 does not use CMS signer parameters')
    }
  } else if (input.rsaPss !== undefined && signatureAlgorithm !== 'rsa-pss') {
    throw new Error('pdf-signer: rsaPss parameters require the rsa-pss signature algorithm')
  }
  if (signatureAlgorithm === 'ecdsa' && key.kind === 'ec') {
    const permitted = ISO_32002_ECDSA_DIGESTS[key.curveOid]
    if (permitted === undefined || !permitted.includes(digestAlgorithm)) {
      throw new Error(`pdf-signer: ${digestAlgorithm} is not permitted for ECDSA curve ${key.curveOid}`)
    }
  }
  const extensionCatalog = catalogWithSignatureExtensions(
    structure, catalogValue, digestAlgorithm, signatureAlgorithm,
  )
  const catalogExtended = extensionCatalog !== catalogValue
  catalogBody = dictionaryBody(extensionCatalog)
  indirectAcroForm = /\/AcroForm\s+(\d+)\s+(\d+)\s+R/.exec(catalogBody)
  directAcroForm = indirectAcroForm === null ? findDirectDictionaryEntry(catalogBody, 'AcroForm') : null
  validateSignatureSeedForSigning(input, subFilter, digestAlgorithm)
  validateUsageRightsForSigning(input.usageRights)
  const effectiveFieldMdp = input.fieldLock === undefined
    ? input.fieldMdp
    : input.fieldMdp === undefined
      ? fieldSelection(input.fieldLock)
      : samePdfSignatureFieldSelection(input.fieldLock, input.fieldMdp)
        ? input.fieldMdp
        : (() => { throw new Error('pdf-signer: fieldLock and fieldMdp must select the same fields') })()

  // /Contents placeholder: reserve a fixed hex gap large enough for the CMS.
  // A 2048-bit RSA signature CMS with one cert is ~2–3 KB; reserve 16 KB.
  const CONTENTS_HEX_LEN = 16384
  const placeholderHex = '0'.repeat(CONTENTS_HEX_LEN)

  // New object numbers (appended after the existing ones).
  let nextObjectNumber = size
  const sigObjNum = nextObjectNumber++
  const fieldObjNum = nextObjectNumber++
  const lockObjNum = input.fieldLock === undefined ? null : nextObjectNumber++
  const seedObjNum = input.seedValue === undefined ? null : nextObjectNumber++
  const acroFormObjNum = indirectAcroForm === null && directAcroForm === null
    ? nextObjectNumber++
    : indirectAcroForm === null ? -1 : parseInt(indirectAcroForm[1]!, 10)
  const acroFormObjGen = indirectAcroForm === null ? 0 : parseInt(indirectAcroForm[2]!, 10)

  // Assemble the appended body. We build the signature dict first with the
  // placeholder, then compute exact byte offsets to patch /ByteRange and
  // /Contents.
  let out = ''
  // Ensure the appended body starts on a fresh line boundary.
  const needsNewline = !text.endsWith('\n')
  const baseLen = src.length + (needsNewline ? 1 : 0)
  if (needsNewline) out += '\n'

  const signatureReferences = buildSignatureReferences(input.docMdpPermission, effectiveFieldMdp, input.usageRights)
  const sigDictHead = `${sigObjNum} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /${subFilter} `
    + (input.name !== undefined ? `/Name ${serializePdfValue(pdfTextString(input.name))} ` : '')
    + (input.reason !== undefined ? `/Reason ${serializePdfValue(pdfTextString(input.reason))} ` : '')
    + (input.contactInfo !== undefined ? `/ContactInfo ${serializePdfValue(pdfTextString(input.contactInfo))} ` : '')
    + (subFilter === 'adbe.x509.rsa_sha1' ? `/Cert <${toHex(input.certDer)}> ` : '')
    + (signatureReferences === '' ? '' : `/V 1 /Reference ${signatureReferences} `)
    + `/M ${pdfDateString(input.signingTime)} /ByteRange `
  // Reserve a fixed-width /ByteRange placeholder: [0 aaaaaaaaaa bbbbbbbbbb cccccccccc]
  const byteRangePlaceholder = '[0 0000000000 0000000000 0000000000]'
  const sigDictBeforeContents = sigDictHead + byteRangePlaceholder + ' /Contents <'
  const sigDictAfterContents = `>\n>>\nendobj\n`

  const sigObjStart = baseLen + out.length
  out += sigDictBeforeContents
  const contentsStart = baseLen + out.length // position of the first hex digit
  out += placeholderHex
  const contentsEnd = baseLen + out.length // position just after the last hex digit
  out += sigDictAfterContents

  const firstPageNum = structure.firstPageNum
  const fieldObj = `${fieldObjNum} 0 obj\n<< /FT /Sig /Type /Annot /Subtype /Widget /T ${serializePdfValue(pdfTextString(input.fieldName ?? 'Signature1'))} `
    + `/Rect [0 0 0 0] /V ${sigObjNum} 0 R /F 132 /P ${firstPageNum} ${structure.firstPageGen} R `
    + (lockObjNum === null ? '' : `/Lock ${lockObjNum} 0 R `)
    + (seedObjNum === null ? '' : `/SV ${seedObjNum} 0 R `)
    + `>>\nendobj\n`
  const fieldObjStart = baseLen + out.length
  out += fieldObj

  let lockObjStart: number | null = null
  if (lockObjNum !== null && input.fieldLock !== undefined) {
    lockObjStart = baseLen + out.length
    out += `${lockObjNum} 0 obj\n${serializePdfValue(buildPdfSignatureFieldLock(input.fieldLock))}\nendobj\n`
  }
  let seedObjStart: number | null = null
  if (seedObjNum !== null && input.seedValue !== undefined) {
    seedObjStart = baseLen + out.length
    out += `${seedObjNum} 0 obj\n${serializePdfValue(buildPdfSignatureSeedValue(input.seedValue))}\nendobj\n`
  }

  // Rewrite the first page object so the widget appears in its /Annots array
  // (a widget annotation must be referenced from a page's /Annots).
  const pageMerge = mergePageAnnotation(structure, structure.objectBody(firstPageNum), fieldObjNum)
  const pageObj = `${firstPageNum} ${structure.firstPageGen} obj\n<< ${pageMerge.body} >>\nendobj\n`
  const pageObjStart = baseLen + out.length
  out += pageObj
  let annotsArrayObjStart: number | null = null
  if (pageMerge.annotsArrayRevision !== null) {
    annotsArrayObjStart = baseLen + out.length
    const revision = pageMerge.annotsArrayRevision
    out += `${revision.objectNumber} ${revision.generation} obj\n${revision.body}\nendobj\n`
  }

  // Rewritten catalog: preserve every existing entry and add the field and
  // signature permission bindings without flattening indirect dictionaries.
  let catalogObjStart: number | null = null
  let acroFormObjStart: number | null = null
  let fieldsArrayRevision: AcroFormMerge['fieldsArrayRevision'] = null
  let fieldsArrayObjStart: number | null = null
  let updatedCatalogBody = catalogBody
  let catalogChanged = catalogExtended
  if (directAcroForm !== null) {
    const merged = mergeAcroFormField(structure, directAcroForm.body, fieldObjNum)
    fieldsArrayRevision = merged.fieldsArrayRevision
    updatedCatalogBody = `${catalogBody.slice(0, directAcroForm.bodyStart)}${merged.body}${catalogBody.slice(directAcroForm.bodyEnd)}`
    catalogChanged = true
  } else {
    if (indirectAcroForm === null) {
      updatedCatalogBody += ` /AcroForm ${acroFormObjNum} ${acroFormObjGen} R`
      catalogChanged = true
    }
    const merged = indirectAcroForm === null
      ? { body: `/Fields [${fieldObjNum} 0 R] /SigFlags 3`, fieldsArrayRevision: null }
      : mergeAcroFormField(structure, structure.objectBody(acroFormObjNum), fieldObjNum)
    fieldsArrayRevision = merged.fieldsArrayRevision
    const acroFormBody = merged.body
    const acroFormObj = `${acroFormObjNum} ${acroFormObjGen} obj\n<< ${acroFormBody} >>\nendobj\n`
    acroFormObjStart = baseLen + out.length
    out += acroFormObj
  }

  const permissionMerge = mergeSignaturePermissions(
    structure,
    catalogValue,
    updatedCatalogBody,
    sigObjNum,
    input.docMdpPermission !== undefined,
    input.usageRights !== undefined,
  )
  updatedCatalogBody = permissionMerge.catalogBody
  catalogChanged = catalogChanged || permissionMerge.catalogChanged
  let permissionsObjStart: number | null = null
  if (permissionMerge.revision !== null) {
    permissionsObjStart = baseLen + out.length
    out += `${permissionMerge.revision.objectNumber} ${permissionMerge.revision.generation} obj\n${permissionMerge.revision.body}\nendobj\n`
  }
  if (catalogChanged) {
    catalogObjStart = baseLen + out.length
    out += `${catalogObjNum} ${rootGen} obj\n<< ${updatedCatalogBody} >>\nendobj\n`
  }
  if (fieldsArrayRevision !== null) {
    fieldsArrayObjStart = baseLen + out.length
    out += `${fieldsArrayRevision.objectNumber} ${fieldsArrayRevision.generation} obj\n${fieldsArrayRevision.body}\nendobj\n`
  }

  // Cross-reference stream would be cleaner, but a classic xref section keeps
  // the update legible; use a subsection per updated object.
  const xrefStart = baseLen + out.length
  const entries: Array<{ num: number, gen: number, off: number }> = [
    { num: sigObjNum, gen: 0, off: sigObjStart },
    { num: fieldObjNum, gen: 0, off: fieldObjStart },
    { num: firstPageNum, gen: structure.firstPageGen, off: pageObjStart },
  ].sort((a, b) => a.num - b.num)
  if (lockObjNum !== null && lockObjStart !== null) entries.push({ num: lockObjNum, gen: 0, off: lockObjStart })
  if (seedObjNum !== null && seedObjStart !== null) entries.push({ num: seedObjNum, gen: 0, off: seedObjStart })
  if (acroFormObjStart !== null) entries.push({ num: acroFormObjNum, gen: acroFormObjGen, off: acroFormObjStart })
  if (catalogObjStart !== null) entries.push({ num: catalogObjNum, gen: rootGen, off: catalogObjStart })
  if (permissionMerge.revision !== null && permissionsObjStart !== null) {
    entries.push({
      num: permissionMerge.revision.objectNumber,
      gen: permissionMerge.revision.generation,
      off: permissionsObjStart,
    })
  }
  if (fieldsArrayRevision !== null && fieldsArrayObjStart !== null) {
    entries.push({ num: fieldsArrayRevision.objectNumber, gen: fieldsArrayRevision.generation, off: fieldsArrayObjStart })
  }
  if (pageMerge.annotsArrayRevision !== null && annotsArrayObjStart !== null) {
    entries.push({
      num: pageMerge.annotsArrayRevision.objectNumber,
      gen: pageMerge.annotsArrayRevision.generation,
      off: annotsArrayObjStart,
    })
  }
  entries.sort((a, b) => a.num - b.num)
  let xref = 'xref\n'
  // Emit contiguous subsections.
  let idx = 0
  while (idx < entries.length) {
    let end = idx
    while (end + 1 < entries.length && entries[end + 1]!.num === entries[end]!.num + 1) end++
    xref += `${entries[idx]!.num} ${end - idx + 1}\n`
    for (let k = idx; k <= end; k++) {
      xref += `${String(entries[k]!.off).padStart(10, '0')} ${String(entries[k]!.gen).padStart(5, '0')} n \n`
    }
    idx = end + 1
  }
  const newSize = nextObjectNumber
  xref += `trailer\n<< /Size ${newSize} /Root ${rootNum} ${rootGen} R /Prev ${prevStartxref} >>\nstartxref\n${xrefStart}\n%%EOF\n`
  out += xref

  // Materialize the appended bytes. `out` already begins with the optional
  // leading newline, so src + encoded(out) is the whole updated file.
  const outBytes = enc.encode(out)
  const combined = new Uint8Array(src.length + outBytes.length)
  combined.set(src, 0)
  combined.set(outBytes, src.length)

  // /ByteRange = [0, contentsStart, contentsEnd, len - contentsEnd].
  const rangeAfter = combined.length - contentsEnd
  const byteRange = [0, contentsStart, contentsEnd, rangeAfter]
  patchAscii(combined, sigObjStart + sigDictHead.length, byteRangePlaceholder.length, padByteRange(byteRange, byteRangePlaceholder.length))

  // Digest over the two ranges (excludes the hex gap), then build the exact
  // signature container selected by the SubFilter.
  const signedBytes = bytesOverRanges(combined, byteRange)
  let signatureContainer: Uint8Array
  if (subFilter === 'adbe.x509.rsa_sha1') {
    if (key.kind !== 'rsa') throw new Error('pdf-signer: adbe.x509.rsa_sha1 requires an RSA key')
    signatureContainer = derOctetString(signRsaPkcs1(key.key, digestAlgorithm, hashByName(digestAlgorithm, signedBytes)))
  } else {
    const encapsulatedContent = subFilter === 'adbe.pkcs7.sha1' ? sha1(signedBytes) : null
    const signedContent = encapsulatedContent ?? signedBytes
    const contentDigest = hashByName(digestAlgorithm, signedContent)
    signatureContainer = buildCmsSignedDataForKey(
      key, input.certDer, identity, contentDigest, input.signingTime,
      digestAlgorithm, signatureAlgorithm, signerIdentifier,
      subFilter === 'ETSI.CAdES.detached', encapsulatedContent, input.rsaPss,
    )
  }
  const signatureHex = toHex(signatureContainer)
  if (signatureHex.length > CONTENTS_HEX_LEN) throw new Error('pdf-signer: signature exceeds the reserved /Contents placeholder')
  for (let i = 0; i < signatureHex.length; i++) combined[contentsStart + i] = signatureHex.charCodeAt(i)

  return combined
}

export interface PdfDocumentTimestampPreparation {
  /** DER TimeStampReq to send to an RFC 3161 timestamp authority. */
  request: Uint8Array
  /** Parsed request fields used to correlate the returned token. */
  requestInfo: Rfc3161TimestampRequestInfo
  /** Digest placed in the request MessageImprint. */
  messageImprint: Uint8Array
  /** Embeds and validates the returned TimeStampToken. */
  finish(timestampToken: Uint8Array): Uint8Array
}

export interface PdfDocumentTimestampOptions extends Rfc3161RequestOptions {
  /** Signature field name. Use a distinct name for each timestamp renewal. */
  fieldName?: string
}

/**
 * Prepares a PDF document timestamp as a two-step operation. The returned DER
 * request is sent by the caller to a timestamp authority; `finish` validates
 * the token MessageImprint and embeds it as an ETSI.RFC3161 /DocTimeStamp.
 */
export function preparePdfDocumentTimestamp(
  pdf: Uint8Array,
  options: PdfDocumentTimestampOptions = {},
): PdfDocumentTimestampPreparation {
  const enc = new TextEncoder()
  const text = latin1(pdf)
  const previousXref = readLastStartxref(text)
  const structure = readSigningStructure(pdf)
  const { rootNum, rootGen, size, firstPageNum, firstPageGen } = structure
  const digestAlgorithm = options.digestAlgorithm ?? 'SHA-256'
  const contentsHexLength = 131072
  const byteRangePlaceholder = '[0 0000000000 0000000000 0000000000]'
  const signatureObjectNumber = size
  const fieldObjectNumber = size + 1
  const newAcroFormObjectNumber = size + 2

  let appended = ''
  const needsNewline = !text.endsWith('\n')
  const baseLength = pdf.length + (needsNewline ? 1 : 0)
  if (needsNewline) appended += '\n'

  const signatureHead = `${signatureObjectNumber} 0 obj\n<< /Type /DocTimeStamp /Filter /Adobe.PPKLite `
    + `/SubFilter /ETSI.RFC3161 /ByteRange `
  const beforeContents = signatureHead + byteRangePlaceholder + ' /Contents <'
  const signatureObjectOffset = baseLength + appended.length
  appended += beforeContents
  const contentsStart = baseLength + appended.length
  appended += '0'.repeat(contentsHexLength)
  const contentsEnd = baseLength + appended.length
  appended += `>\n>>\nendobj\n`

  const fieldObject = `${fieldObjectNumber} 0 obj\n<< /FT /Sig /Type /Annot /Subtype /Widget `
    + `/T ${serializePdfValue(pdfTextString(options.fieldName ?? 'DocumentTimestamp1'))} /Rect [0 0 0 0] `
    + `/V ${signatureObjectNumber} 0 R /F 132 /P ${firstPageNum} ${firstPageGen} R >>\nendobj\n`
  const fieldObjectOffset = baseLength + appended.length
  appended += fieldObject

  const pageMerge = mergePageAnnotation(structure, structure.objectBody(firstPageNum), fieldObjectNumber)
  const pageObject = `${firstPageNum} ${firstPageGen} obj\n<< ${pageMerge.body} >>\nendobj\n`
  const pageObjectOffset = baseLength + appended.length
  appended += pageObject
  let annotsArrayObjectOffset: number | null = null
  if (pageMerge.annotsArrayRevision !== null) {
    annotsArrayObjectOffset = baseLength + appended.length
    const revision = pageMerge.annotsArrayRevision
    appended += `${revision.objectNumber} ${revision.generation} obj\n${revision.body}\nendobj\n`
  }

  const originalCatalog = structure.objectValue(rootNum)
  if (!(originalCatalog instanceof Map)) throw new Error('pdf-signer: catalog is not a dictionary')
  const extendedCatalog = catalogWithSignatureExtensions(
    structure, originalCatalog, digestAlgorithm, 'rsa-pkcs1-v1_5',
  )
  const catalogHasNewExtensions = extendedCatalog !== originalCatalog
  const catalogBody = dictionaryBody(extendedCatalog)
  const indirectAcroForm = /\/AcroForm\s+(\d+)\s+(\d+)\s+R/.exec(catalogBody)
  const directAcroForm = indirectAcroForm === null ? findDirectAcroForm(catalogBody) : null
  let catalogObjectOffset: number | null = null
  let acroFormObjectOffset: number | null = null
  let fieldsArrayRevision: AcroFormMerge['fieldsArrayRevision'] = null
  let fieldsArrayObjectOffset: number | null = null
  const acroFormObjectNumber = indirectAcroForm === null ? newAcroFormObjectNumber : parseInt(indirectAcroForm[1]!, 10)
  const acroFormObjectGeneration = indirectAcroForm === null ? 0 : parseInt(indirectAcroForm[2]!, 10)
  if (directAcroForm !== null) {
    const merged = mergeAcroFormField(structure, directAcroForm.body, fieldObjectNumber)
    fieldsArrayRevision = merged.fieldsArrayRevision
    const updatedCatalogBody = `${catalogBody.slice(0, directAcroForm.bodyStart)}${merged.body}${catalogBody.slice(directAcroForm.bodyEnd)}`
    const catalogObject = `${rootNum} ${rootGen} obj\n<< ${updatedCatalogBody} >>\nendobj\n`
    catalogObjectOffset = baseLength + appended.length
    appended += catalogObject
  } else {
    if (indirectAcroForm === null || catalogHasNewExtensions) {
      const acroFormEntry = indirectAcroForm === null
        ? ` /AcroForm ${acroFormObjectNumber} ${acroFormObjectGeneration} R`
        : ''
      const catalogObject = `${rootNum} ${rootGen} obj\n<< ${catalogBody}${acroFormEntry} >>\nendobj\n`
      catalogObjectOffset = baseLength + appended.length
      appended += catalogObject
    }
    const merged = indirectAcroForm === null
      ? { body: `/Fields [${fieldObjectNumber} 0 R] /SigFlags 3`, fieldsArrayRevision: null }
      : mergeAcroFormField(structure, structure.objectBody(acroFormObjectNumber), fieldObjectNumber)
    fieldsArrayRevision = merged.fieldsArrayRevision
    const acroFormBody = merged.body
    const acroFormObject = `${acroFormObjectNumber} ${acroFormObjectGeneration} obj\n<< ${acroFormBody} >>\nendobj\n`
    acroFormObjectOffset = baseLength + appended.length
    appended += acroFormObject
  }
  if (fieldsArrayRevision !== null) {
    fieldsArrayObjectOffset = baseLength + appended.length
    appended += `${fieldsArrayRevision.objectNumber} ${fieldsArrayRevision.generation} obj\n${fieldsArrayRevision.body}\nendobj\n`
  }

  const entries: Array<{ num: number, gen: number, off: number }> = [
    { num: signatureObjectNumber, gen: 0, off: signatureObjectOffset },
    { num: fieldObjectNumber, gen: 0, off: fieldObjectOffset },
    { num: firstPageNum, gen: firstPageGen, off: pageObjectOffset },
  ]
  if (acroFormObjectOffset !== null) entries.push({ num: acroFormObjectNumber, gen: acroFormObjectGeneration, off: acroFormObjectOffset })
  if (catalogObjectOffset !== null) entries.push({ num: rootNum, gen: rootGen, off: catalogObjectOffset })
  if (fieldsArrayRevision !== null && fieldsArrayObjectOffset !== null) {
    entries.push({ num: fieldsArrayRevision.objectNumber, gen: fieldsArrayRevision.generation, off: fieldsArrayObjectOffset })
  }
  if (pageMerge.annotsArrayRevision !== null && annotsArrayObjectOffset !== null) {
    entries.push({
      num: pageMerge.annotsArrayRevision.objectNumber,
      gen: pageMerge.annotsArrayRevision.generation,
      off: annotsArrayObjectOffset,
    })
  }
  entries.sort(function (a, b) { return a.num - b.num })
  const xrefOffset = baseLength + appended.length
  let xref = 'xref\n'
  let entryIndex = 0
  while (entryIndex < entries.length) {
    let end = entryIndex
    while (end + 1 < entries.length && entries[end + 1]!.num === entries[end]!.num + 1) end++
    xref += `${entries[entryIndex]!.num} ${end - entryIndex + 1}\n`
    for (let i = entryIndex; i <= end; i++) xref += `${String(entries[i]!.off).padStart(10, '0')} ${String(entries[i]!.gen).padStart(5, '0')} n \n`
    entryIndex = end + 1
  }
  const newSize = indirectAcroForm === null && directAcroForm === null ? size + 3 : size + 2
  xref += `trailer\n<< /Size ${newSize} /Root ${rootNum} ${rootGen} R /Prev ${previousXref} >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`
  appended += xref

  const appendedBytes = enc.encode(appended)
  const preparedPdf = new Uint8Array(pdf.length + appendedBytes.length)
  preparedPdf.set(pdf)
  preparedPdf.set(appendedBytes, pdf.length)
  const byteRange = [0, contentsStart, contentsEnd, preparedPdf.length - contentsEnd]
  patchAscii(
    preparedPdf,
    signatureObjectOffset + signatureHead.length,
    byteRangePlaceholder.length,
    padByteRange(byteRange, byteRangePlaceholder.length),
  )
  const messageImprint = hashByName(digestAlgorithm, bytesOverRanges(preparedPdf, byteRange))
  const request = buildRfc3161TimestampRequest(messageImprint, options)
  const requestInfo = parseRfc3161TimestampRequest(request)

  return {
    request,
    requestInfo,
    messageImprint,
    finish(timestampToken: Uint8Array): Uint8Array {
      const info = parseRfc3161TimestampToken(timestampToken)
      if (info.digestAlgorithm !== requestInfo.digestAlgorithm || !equalBytes(info.messageImprint, messageImprint)) {
        throw new Error('pdf-signer: RFC 3161 token MessageImprint does not match the prepared PDF')
      }
      if (requestInfo.policy !== null && info.policy !== requestInfo.policy) {
        throw new Error('pdf-signer: RFC 3161 token policy does not match the request')
      }
      if (requestInfo.nonce !== null && info.nonce !== requestInfo.nonce) {
        throw new Error('pdf-signer: RFC 3161 token nonce does not match the request')
      }
      if (info.certificatesIncluded !== requestInfo.certReq) {
        throw new Error('pdf-signer: RFC 3161 token certificates do not match certReq')
      }
      const tokenHex = toHex(timestampToken)
      if (tokenHex.length > contentsHexLength) {
        throw new Error('pdf-signer: RFC 3161 token exceeds the reserved /Contents placeholder')
      }
      const output = new Uint8Array(preparedPdf)
      for (let i = 0; i < tokenHex.length; i++) output[contentsStart + i] = tokenHex.charCodeAt(i)
      return output
    },
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function padByteRange(range: number[], width: number): string {
  const inner = `[0 ${range[1]} ${range[2]} ${range[3]}]`
  if (inner.length > width) throw new Error('pdf-signer: /ByteRange exceeds reserved width')
  return inner + ' '.repeat(width - inner.length)
}

function patchAscii(buf: Uint8Array, offset: number, oldLen: number, replacement: string): void {
  if (replacement.length !== oldLen) throw new Error('pdf-signer: /ByteRange patch width mismatch')
  for (let i = 0; i < replacement.length; i++) buf[offset + i] = replacement.charCodeAt(i)
}

function toHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0')
  return s.toUpperCase()
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

function isoDeveloperExtension(level: 32001 | 32002): PdfDict {
  const standard = level === 32001 ? '45874' : '45875'
  return new Map<string, PdfValue>([
    ['Type', new PdfName('DeveloperExtensions')],
    ['BaseVersion', new PdfName('2.0')],
    ['ExtensionLevel', level],
    ['ExtensionRevision', new PdfString(new TextEncoder().encode(':2022'))],
    ['URL', new PdfString(new TextEncoder().encode(`https://www.iso.org/standard/${standard}.html`))],
  ])
}

function pdfAsciiString(value: PdfValue, label: string): string {
  if (!(value instanceof PdfString)) throw new Error(`pdf-signer: ${label} must be a text string`)
  for (let i = 0; i < value.bytes.length; i++) {
    if (value.bytes[i]! > 0x7f) throw new Error(`pdf-signer: ${label} must be ASCII`)
  }
  return new TextDecoder().decode(value.bytes)
}

function isoExtensionLevel(structure: PdfSigningStructure, value: PdfValue): number {
  const record = structure.resolve(value)
  if (!(record instanceof Map)) throw new Error('pdf-signer: catalog ISO_ extension entries must be dictionaries')
  const type = structure.resolve(record.get('Type') ?? null)
  const baseVersion = structure.resolve(record.get('BaseVersion') ?? null)
  const level = structure.resolve(record.get('ExtensionLevel') ?? null)
  if (!(type instanceof PdfName) || type.name !== 'DeveloperExtensions'
      || !(baseVersion instanceof PdfName) || baseVersion.name !== '2.0'
      || typeof level !== 'number' || !Number.isSafeInteger(level) || level <= 0) {
    throw new Error('pdf-signer: malformed catalog ISO_ developer extension')
  }
  return level
}

function validateExistingIsoExtension(
  structure: PdfSigningStructure,
  value: PdfValue,
  level: 32001 | 32002,
): void {
  const record = structure.resolve(value)
  if (!(record instanceof Map)) throw new Error('pdf-signer: catalog ISO_ extension entry must be a dictionary')
  const expected = isoDeveloperExtension(level)
  const revision = structure.resolve(record.get('ExtensionRevision') ?? null)
  const url = structure.resolve(record.get('URL') ?? null)
  if (pdfAsciiString(revision, 'ISO_ /ExtensionRevision') !== pdfAsciiString(expected.get('ExtensionRevision')!, 'ISO_ /ExtensionRevision')
      || pdfAsciiString(url, 'ISO_ /URL') !== pdfAsciiString(expected.get('URL')!, 'ISO_ /URL')) {
    throw new Error(`pdf-signer: catalog ISO_ ExtensionLevel ${level} conflicts with ISO/TS ${level}:2022`)
  }
}

function catalogWithSignatureExtensions(
  structure: PdfSigningStructure,
  catalogValue: PdfDict,
  digestAlgorithm: PdfSignatureDigestAlgorithm,
  signatureAlgorithm: PdfSignatureAlgorithm,
): PdfDict {
  const requiredLevels: Array<32001 | 32002> = []
  if (digestAlgorithm.startsWith('SHA3-') || digestAlgorithm === 'SHAKE256') requiredLevels.push(32001)
  if (signatureAlgorithm === 'ecdsa' || signatureAlgorithm === 'eddsa') requiredLevels.push(32002)
  if (requiredLevels.length === 0) return catalogValue

  const result = new Map(catalogValue)
  result.set('Version', new PdfName('2.0'))
  const existingExtensions = structure.resolve(catalogValue.get('Extensions') ?? null)
  if (existingExtensions !== null && !(existingExtensions instanceof Map)) {
    throw new Error('pdf-signer: catalog /Extensions must be a dictionary')
  }
  const extensions = existingExtensions === null
    ? new Map<string, PdfValue>()
    : new Map<string, PdfValue>(existingExtensions as PdfDict)
  const extensionType = structure.resolve(extensions.get('Type') ?? null)
  if (extensionType !== null && (!(extensionType instanceof PdfName) || extensionType.name !== 'Extensions')) {
    throw new Error('pdf-signer: catalog /Extensions /Type must be /Extensions')
  }
  extensions.set('Type', new PdfName('Extensions'))

  const existingIso = extensions.get('ISO_')
  const records: PdfValue[] = existingIso === undefined
    ? []
    : Array.isArray(structure.resolve(existingIso))
      ? [...(structure.resolve(existingIso) as PdfValue[])]
      : [existingIso]
  for (let i = 0; i < requiredLevels.length; i++) {
    const level = requiredLevels[i]!
    const existing = records.find(function (record) { return isoExtensionLevel(structure, record) === level })
    if (existing === undefined) records.push(isoDeveloperExtension(level))
    else validateExistingIsoExtension(structure, existing, level)
  }
  records.sort(function (left, right) { return isoExtensionLevel(structure, left) - isoExtensionLevel(structure, right) })
  for (let i = 1; i < records.length; i++) {
    if (isoExtensionLevel(structure, records[i - 1]!) >= isoExtensionLevel(structure, records[i]!)) {
      throw new Error('pdf-signer: catalog ISO_ extension levels must increase without duplicates')
    }
  }
  extensions.set('ISO_', records.length === 1 ? records[0]! : records)
  result.set('Extensions', extensions)
  return result
}

interface PdfSigningStructure {
  rootNum: number
  rootGen: number
  size: number
  firstPageNum: number
  firstPageGen: number
  objectBody(objectNumber: number): string
  objectValue(objectNumber: number): PdfValue
  resolve(value: PdfValue): PdfValue
}

function readSigningStructure(bytes: Uint8Array): PdfSigningStructure {
  const document = PdfDocument.parse(bytes)
  const root = document.trailer.get('Root')
  const size = document.trailer.get('Size')
  if (!(root instanceof PdfRef) || typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    throw new Error('pdf-signer: trailer /Root or /Size is invalid')
  }
  const catalog = document.getObject(root.num)
  if (!(catalog instanceof Map)) throw new Error('pdf-signer: catalog is not a dictionary')
  const pages = catalog.get('Pages')
  if (!(pages instanceof PdfRef)) throw new Error('pdf-signer: catalog /Pages must be an indirect reference')
  const firstPage = findFirstPageReference(document, pages)
  return {
    rootNum: root.num,
    rootGen: root.gen,
    size,
    firstPageNum: firstPage.num,
    firstPageGen: firstPage.gen,
    objectBody(objectNumber: number): string {
      const value = document.getObject(objectNumber)
      if (!(value instanceof Map)) throw new Error(`pdf-signer: object ${objectNumber} is not a dictionary`)
      return dictionaryBody(value)
    },
    objectValue(objectNumber: number): PdfValue {
      return document.getObject(objectNumber)
    },
    resolve(value: PdfValue): PdfValue {
      return document.resolve(value)
    },
  }
}

function findFirstPageReference(document: PdfDocument, reference: PdfRef): PdfRef {
  const value = document.getObject(reference.num)
  if (!(value instanceof Map)) throw new Error('pdf-signer: page-tree reference is not a dictionary')
  const type = document.resolve(value.get('Type') ?? null)
  if (type instanceof PdfName && type.name === 'Page') return reference
  const kids = document.resolve(value.get('Kids') ?? null)
  if (!Array.isArray(kids) || kids.length === 0) throw new Error('pdf-signer: page tree has no pages')
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]
    if (!(kid instanceof PdfRef)) throw new Error('pdf-signer: page-tree kid must be an indirect reference')
    const child = document.getObject(kid.num)
    if (!(child instanceof Map)) continue
    const childType = document.resolve(child.get('Type') ?? null)
    if (childType instanceof PdfName && (childType.name === 'Page' || childType.name === 'Pages')) {
      return findFirstPageReference(document, kid)
    }
  }
  throw new Error('pdf-signer: page tree has no page dictionary')
}

function dictionaryBody(dictionary: PdfDict): string {
  const serialized = serializePdfValue(dictionary)
  if (!serialized.startsWith('<<') || !serialized.endsWith('>>')) throw new Error('pdf-signer: dictionary serialization failed')
  return serialized.slice(2, -2).trim()
}

function readLastStartxref(text: string): number {
  const i = text.lastIndexOf('startxref')
  if (i < 0) throw new Error('pdf-signer: input PDF has no startxref')
  const m = /startxref\s+(\d+)/.exec(text.substring(i))
  if (m === null) throw new Error('pdf-signer: malformed startxref')
  return parseInt(m[1]!, 10)
}

function injectAnnot(pageBody: string, widgetRef: string): string {
  // Append the widget reference to the page's /Annots array, or add /Annots.
  const annotsM = /\/Annots\s*\[/.exec(pageBody)
  if (annotsM === null) return `${pageBody} /Annots [${widgetRef}]`
  const insertAt = annotsM.index + annotsM[0].length
  return `${pageBody.slice(0, insertAt)}${widgetRef} ${pageBody.slice(insertAt)}`
}

interface PageAnnotationMerge {
  body: string
  annotsArrayRevision: { objectNumber: number; generation: number; body: string } | null
}

function mergePageAnnotation(structure: PdfSigningStructure, pageBody: string, widgetObjectNumber: number): PageAnnotationMerge {
  const widgetRef = `${widgetObjectNumber} 0 R`
  if (/\/Annots\s*\[/.test(pageBody) || !/\/Annots\b/.test(pageBody)) {
    return { body: injectAnnot(pageBody, widgetRef), annotsArrayRevision: null }
  }
  const indirect = /\/Annots\s+(\d+)\s+(\d+)\s+R/.exec(pageBody)
  if (indirect === null) throw new Error('pdf-signer: page /Annots must be an array or indirect array reference')
  const objectNumber = parseInt(indirect[1]!, 10)
  const generation = parseInt(indirect[2]!, 10)
  const value = structure.objectValue(objectNumber)
  if (!Array.isArray(value)) throw new Error('pdf-signer: indirect page /Annots object is not an array')
  return {
    body: pageBody,
    annotsArrayRevision: {
      objectNumber,
      generation,
      body: serializePdfValue([new PdfRef(widgetObjectNumber, 0), ...value]),
    },
  }
}

function injectAcroFormField(acroFormBody: string, fieldRef: string): string {
  const fields = /\/Fields\s*\[/.exec(acroFormBody)
  if (fields === null) throw new Error('pdf-signer: existing /AcroForm has no direct /Fields array')
  const insertAt = fields.index + fields[0].length
  return setAcroFormSignatureFlags(`${acroFormBody.slice(0, insertAt)}${fieldRef} ${acroFormBody.slice(insertAt)}`)
}

function setAcroFormSignatureFlags(acroFormBody: string): string {
  let result = acroFormBody
  const flags = /\/SigFlags\s+(\d+)/.exec(result)
  if (flags === null) return `${result} /SigFlags 3`
  const value = parseInt(flags[1]!, 10) | 3
  result = `${result.slice(0, flags.index)}${flags[0]!.replace(flags[1]!, String(value))}${result.slice(flags.index + flags[0]!.length)}`
  return result
}

interface AcroFormMerge {
  body: string
  fieldsArrayRevision: { objectNumber: number; generation: number; body: string } | null
}

function mergeAcroFormField(structure: PdfSigningStructure, acroFormBody: string, fieldObjectNumber: number): AcroFormMerge {
  const fieldRef = `${fieldObjectNumber} 0 R`
  if (/\/Fields\s*\[/.test(acroFormBody)) {
    return { body: injectAcroFormField(acroFormBody, fieldRef), fieldsArrayRevision: null }
  }
  const indirect = /\/Fields\s+(\d+)\s+(\d+)\s+R/.exec(acroFormBody)
  if (indirect === null) throw new Error('pdf-signer: existing /AcroForm has no /Fields array')
  const objectNumber = parseInt(indirect[1]!, 10)
  const generation = parseInt(indirect[2]!, 10)
  const value = structure.objectValue(objectNumber)
  if (!Array.isArray(value)) throw new Error('pdf-signer: indirect /AcroForm /Fields object is not an array')
  const body = serializePdfValue([new PdfRef(fieldObjectNumber, 0), ...value])
  return {
    body: setAcroFormSignatureFlags(acroFormBody),
    fieldsArrayRevision: { objectNumber, generation, body },
  }
}

function fieldSelection(value: PdfSignatureFieldLock): PdfSignatureFieldSelection {
  return value.action === 'All'
    ? { action: 'All' }
    : { action: value.action, fields: value.fields.slice() }
}

function isLocalSignatureSubFilter(value: string): value is PdfLocalSignatureSubFilter {
  return value === 'adbe.x509.rsa_sha1' || value === 'adbe.pkcs7.sha1'
    || value === 'adbe.pkcs7.detached' || value === 'ETSI.CAdES.detached'
}

function selectSignatureSubFilter(input: PdfSignOptions): PdfLocalSignatureSubFilter {
  if (input.subFilter !== undefined) return input.subFilter
  const requested = input.seedValue?.subFilters
  if (requested !== undefined) {
    for (let i = 0; i < requested.length; i++) {
      const value = requested[i]
      if (value !== undefined && isLocalSignatureSubFilter(value)) return value
    }
  }
  return 'adbe.pkcs7.detached'
}

function validateSignatureSeedForSigning(
  input: PdfSignOptions,
  subFilter: PdfLocalSignatureSubFilter,
  digestAlgorithm: PdfSignatureDigestAlgorithm,
): void {
  const seed = input.seedValue
  if (seed === undefined) return
  const required = new Set(seed.required ?? [])
  if (required.has('Filter') && seed.filter !== 'Adobe.PPKLite') {
    throw new Error('pdf-signer: required seed /Filter must be /Adobe.PPKLite')
  }
  if (required.has('SubFilter')) {
    if (seed.subFilters === undefined) throw new Error('pdf-signer: required seed /SubFilter is missing')
    const firstSupported = seed.subFilters.find(function (value) {
      return isLocalSignatureSubFilter(value)
    })
    if (firstSupported === undefined || firstSupported !== subFilter) {
      throw new Error('pdf-signer: signature does not use the first supported required seed /SubFilter')
    }
  }
  if (required.has('V') && seed.version === undefined) throw new Error('pdf-signer: required seed /V is missing')
  const seedDigestName: 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512' | 'RIPEMD160' | 'SHA3-256' | 'SHA3-384' | 'SHA3-512' | 'SHAKE256' = digestAlgorithm === 'SHA-1'
    ? 'SHA1'
    : digestAlgorithm === 'SHA-256' ? 'SHA256'
      : digestAlgorithm === 'SHA-384' ? 'SHA384'
        : digestAlgorithm === 'SHA-512' ? 'SHA512'
          : digestAlgorithm === 'SHA3-256' ? 'SHA3-256'
            : digestAlgorithm === 'SHA3-384' ? 'SHA3-384'
              : digestAlgorithm === 'SHA3-512' ? 'SHA3-512'
                : digestAlgorithm === 'SHAKE256' ? 'SHAKE256' : 'RIPEMD160'
  if (required.has('DigestMethod') && (seed.digestMethods === undefined || !seed.digestMethods.includes(seedDigestName))) {
    throw new Error(`pdf-signer: required seed /DigestMethod does not permit ${seedDigestName}`)
  }
  if (required.has('Reasons')) {
    if (seed.reasons === undefined || (seed.reasons.length === 1 && seed.reasons[0] === '')) {
      if (input.reason !== undefined) throw new Error('pdf-signer: required empty seed /Reasons requires omission of /Reason')
    } else if (input.reason === undefined || !seed.reasons.includes(input.reason)) {
      throw new Error('pdf-signer: /Reason does not satisfy the required seed /Reasons')
    }
  }
  if (seed.mdpPermission !== undefined) {
    const actual = input.docMdpPermission ?? 0
    if (seed.mdpPermission !== actual) throw new Error('pdf-signer: DocMDP permission does not satisfy seed /MDP')
  }
  if (required.has('LegalAttestation')) {
    if (seed.legalAttestations === undefined || input.legalAttestation === undefined
        || !seed.legalAttestations.includes(input.legalAttestation)) {
      throw new Error('pdf-signer: legal attestation does not satisfy the required seed constraint')
    }
  }
  if (seed.timestamp?.required === true) {
    throw new Error('pdf-signer: a required seed timestamp must be supplied through the timestamp signing workflow')
  }
  if (required.has('AddRevInfo') && seed.addRevInfo === true) {
    throw new Error('pdf-signer: required seed revocation information is not present')
  }
  const certificate = seed.certificate
  if (certificate !== undefined) {
    const certificateRequired = new Set(certificate.required ?? [])
    const facts = parseX509SeedFacts(input.certDer)
    if (certificateRequired.has('Subject')) {
      const subjects = certificate.subjectCertificates
      if (subjects === undefined || !subjects.some(function (value) { return equalBytes(value, input.certDer) })) {
        throw new Error('pdf-signer: signing certificate does not satisfy required certificate seed /Subject')
      }
    }
    if (certificateRequired.has('SubjectDN')
        && (certificate.subjectDN === undefined || !certificateMatchesSubjectDn(facts, certificate.subjectDN))) {
      throw new Error('pdf-signer: signing certificate does not satisfy required certificate seed /SubjectDN')
    }
    if (certificateRequired.has('KeyUsage')
        && (certificate.keyUsage === undefined || !certificateMatchesKeyUsage(facts, certificate.keyUsage))) {
      throw new Error('pdf-signer: signing certificate does not satisfy required certificate seed /KeyUsage')
    }
    if (certificateRequired.has('Issuer')
        && (certificate.issuerCertificates === undefined
          || !certificateChainsTo(facts, [facts], certificate.issuerCertificates))) {
      throw new Error('pdf-signer: signing certificate does not satisfy required certificate seed /Issuer')
    }
    if (certificateRequired.has('OID')
        && (certificate.policyOids === undefined
          || !certificate.policyOids.every(function (value) { return facts.certificatePolicyOids.includes(value) }))) {
      throw new Error('pdf-signer: signing certificate does not satisfy required certificate seed /OID')
    }
    if (certificateRequired.has('URL') && certificate.urlType !== undefined && certificate.urlType !== 'Browser'
        && input.credentialSourceUrl !== certificate.url) {
      throw new Error('pdf-signer: credential source does not satisfy required certificate seed /URL')
    }
  }
}

function validateUsageRightsForSigning(value: PdfUsageRights | undefined): void {
  if (value?.formEx !== undefined) throw new Error('pdf-signer: /FormEx is valid only for legacy /UR permissions without /ByteRange')
}

function signatureReference(method: 'DocMDP' | 'FieldMDP' | 'UR', parameters: PdfDict): PdfDict {
  return new Map<string, PdfValue>([
    ['Type', new PdfName('SigRef')],
    ['TransformMethod', new PdfName(method)],
    ['DigestMethod', new PdfName('SHA256')],
    ['TransformParams', parameters],
  ])
}

function buildSignatureReferences(
  docMdpPermission: 1 | 2 | 3 | undefined,
  fieldMdp: PdfSignatureFieldSelection | undefined,
  usageRights: PdfUsageRights | undefined,
): string {
  const references: PdfValue[] = []
  if (docMdpPermission !== undefined) {
    references.push(signatureReference('DocMDP', new Map<string, PdfValue>([
      ['Type', new PdfName('TransformParams')],
      ['P', docMdpPermission],
      ['V', new PdfName('1.2')],
    ])))
  }
  if (fieldMdp !== undefined) {
    const parameters: PdfDict = new Map([
      ['Type', new PdfName('TransformParams')],
      ['Action', new PdfName(fieldMdp.action)],
      ['V', new PdfName('1.2')],
    ])
    if (fieldMdp.action !== 'All') {
      parameters.set('Fields', fieldMdp.fields.map(function (field) { return pdfTextString(field) }))
    }
    references.push(signatureReference('FieldMDP', parameters))
  }
  if (usageRights !== undefined) references.push(signatureReference('UR', buildPdfUsageRights(usageRights)))
  return references.length === 0 ? '' : serializePdfValue(references)
}

interface PermissionMerge {
  catalogBody: string
  catalogChanged: boolean
  revision: { objectNumber: number; generation: number; body: string } | null
}

function mergeSignaturePermissions(
  structure: PdfSigningStructure,
  catalog: PdfDict,
  catalogBody: string,
  signatureObjectNumber: number,
  docMdp: boolean,
  usageRights: boolean,
): PermissionMerge {
  if (!docMdp && !usageRights) return { catalogBody, catalogChanged: false, revision: null }
  const signatureReference = new PdfRef(signatureObjectNumber, 0)
  const original = catalog.get('Perms')
  if (original instanceof PdfRef) {
    const resolved = structure.objectValue(original.num)
    if (!(resolved instanceof Map)) throw new Error('pdf-signer: catalog /Perms reference is not a dictionary')
    const permissions: PdfDict = new Map(resolved)
    if (docMdp) permissions.set('DocMDP', signatureReference)
    if (usageRights) permissions.set('UR3', signatureReference)
    return {
      catalogBody,
      catalogChanged: false,
      revision: { objectNumber: original.num, generation: original.gen, body: serializePdfValue(permissions) },
    }
  }
  if (original !== undefined && !(original instanceof Map)) throw new Error('pdf-signer: catalog /Perms must be a dictionary')
  const permissions: PdfDict = original instanceof Map ? new Map(original) : new Map()
  if (docMdp) permissions.set('DocMDP', signatureReference)
  if (usageRights) permissions.set('UR3', signatureReference)
  const serialized = serializePdfValue(permissions)
  if (original === undefined) {
    return { catalogBody: `${catalogBody} /Perms ${serialized}`, catalogChanged: true, revision: null }
  }
  const direct = findDirectDictionaryEntry(catalogBody, 'Perms')
  if (direct === null) throw new Error('pdf-signer: direct catalog /Perms dictionary could not be located')
  return {
    catalogBody: `${catalogBody.slice(0, direct.bodyStart - 2)}${serialized}${catalogBody.slice(direct.bodyEnd + 2)}`,
    catalogChanged: true,
    revision: null,
  }
}

function findDirectDictionaryEntry(catalogBody: string, key: string): { body: string; bodyStart: number; bodyEnd: number } | null {
  const match = new RegExp(`/${key}\\s*<<`).exec(catalogBody)
  if (match === null) return null
  const dictionaryStart = match.index + match[0].lastIndexOf('<<')
  let depth = 1
  let offset = dictionaryStart + 2
  while (offset < catalogBody.length && depth > 0) {
    if (catalogBody[offset] === '(') {
      offset++
      let stringDepth = 1
      while (offset < catalogBody.length && stringDepth > 0) {
        if (catalogBody[offset] === '\\') offset += 2
        else {
          if (catalogBody[offset] === '(') stringDepth++
          else if (catalogBody[offset] === ')') stringDepth--
          offset++
        }
      }
      if (stringDepth !== 0) throw new Error(`pdf-signer: unterminated string in direct /${key}`)
      continue
    }
    if (catalogBody.startsWith('<<', offset)) { depth++; offset += 2; continue }
    if (catalogBody.startsWith('>>', offset)) { depth--; offset += 2; continue }
    offset++
  }
  if (depth !== 0) throw new Error(`pdf-signer: unterminated direct /${key} dictionary`)
  return {
    body: catalogBody.slice(dictionaryStart + 2, offset - 2),
    bodyStart: dictionaryStart + 2,
    bodyEnd: offset - 2,
  }
}

function findDirectAcroForm(catalogBody: string): { body: string; bodyStart: number; bodyEnd: number } | null {
  return findDirectDictionaryEntry(catalogBody, 'AcroForm')
}

function pdfTextString(value: string): PdfString {
  const bytes = new Uint8Array(2 + value.length * 2)
  bytes[0] = 0xfe
  bytes[1] = 0xff
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    bytes[i * 2 + 2] = code >>> 8
    bytes[i * 2 + 3] = code & 0xff
  }
  return new PdfString(bytes)
}

function pdfDateString(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`
}

function bytesOverRanges(bytes: Uint8Array, ranges: number[]): Uint8Array {
  const total = ranges.reduce((sum, _, i) => (i % 2 === 1 ? sum + ranges[i]! : sum), 0)
  const buf = new Uint8Array(total)
  let pos = 0
  for (let i = 0; i < ranges.length; i += 2) {
    const off = ranges[i]!
    const len = ranges[i + 1]!
    buf.set(bytes.subarray(off, off + len), pos)
    pos += len
  }
  return buf
}

/** Convenience: SHA-256 over concatenated byte-range segments. */
export function sha256OverRanges(bytes: Uint8Array, ranges: number[]): Uint8Array {
  return sha256(bytesOverRanges(bytes, ranges))
}

export { bytesToBigInt as _bytesToBigInt }
