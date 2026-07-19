/**
 * Public-key security handler (ISO 32000-1 7.6.4/7.6.5, /Filter /Adobe.PubSec).
 *
 * Recovers the file encryption key from a recipient's private key: each
 * /Recipients entry is a CMS EnvelopedData (RFC 5652) whose enveloped content
 * is a 20-byte seed followed by 4 permission bytes. The seed is recovered by
 * RSA-decrypting the content-encryption key and decrypting the enveloped
 * content, then the file key is SHA-1 (SHA-256 for AES-256) of the seed
 * followed by every recipient's raw bytes (and 0xFFFFFFFF when metadata is not
 * encrypted). Per-object decryption then uses the standard security-handler
 * ciphers with that key.
 */

import { sha1 } from '../encryption/sha1.js'
import { sha224, sha256 } from '../encryption/sha256.js'
import { sha384, sha512 } from '../encryption/sha512.js'
import { sha3_256, sha3_384, sha3_512 } from '../encryption/sha3.js'
import { aesCbcDecryptNoPadding, aesCbcEncrypt, aesKeyUnwrap, aesKeyWrap } from '../encryption/aes.js'
import { tripleDesCbcDecrypt, tripleDesCbcEncrypt } from '../encryption/des.js'
import { deriveEcPublicPoint, EC_CURVES, ecdhSharedSecretX, type EcCurve } from '../encryption/ecdsa.js'
import { decryptPkcs8PrivateKey } from '../encryption/pkcs8.js'
import { derBitString, derContext, derContextConstructed, derContextPrimitive, derIntegerFromNumber, derNull, derOctetString, derOid, derRaw, derSequence, derSet } from './der-encoder.js'
import { computePermFlags, deriveObjectKey, deriveObjectKeyAes, randomBytes, rc4, type EncryptionContext, type PdfPermissions } from '../renderer/pdf-encryption.js'

export interface PubSecCredential {
  /** Recipient X.509 certificate, DER-encoded */
  certificate: Uint8Array
  /** Recipient private key, DER-encoded as PKCS#8, PKCS#1, or SEC1 ECPrivateKey. */
  privateKey: Uint8Array
  /** Password for an RFC 8018 PBES2-encrypted PKCS#8 private key. */
  privateKeyPassword?: string | Uint8Array
}

export type PdfEcdhKdf = 'sha-1' | 'sha-224' | 'sha-256' | 'sha-384' | 'sha-512'
export type PdfAesKeyWrap = 'aes-128' | 'aes-192' | 'aes-256'
export type PdfPubSecContentEncryption = '3des' | 'aes-128' | 'aes-192' | 'aes-256'
export type PdfRsaOaepDigest = 'sha-1' | 'sha-224' | 'sha-256' | 'sha-384' | 'sha-512' | 'sha3-256' | 'sha3-384' | 'sha3-512'

export interface PdfRsaKeyTransportOptions {
  /** Defaults to RSAES-PKCS1-v1_5 for compatibility. */
  algorithm?: 'pkcs1-v1_5' | 'oaep'
  /** RSAES-OAEP hash. Defaults to SHA-256 when OAEP is selected. */
  digest?: PdfRsaOaepDigest
  /** RSAES-OAEP MGF1 hash. Defaults to `digest`. */
  mgfDigest?: PdfRsaOaepDigest
  /** RSAES-OAEP label. Defaults to the empty string. */
  label?: Uint8Array
}

export interface PdfPubSecKeyAgreementOptions {
  /** X9.63 KDF digest. Defaults to the RFC 5753 mandatory SHA-256 scheme. */
  kdf?: PdfEcdhKdf
  /** RFC 3394 key-wrap algorithm. Defaults to the RFC 5753 mandatory AES-128 wrap. */
  keyWrap?: PdfAesKeyWrap
  /** CMS user keying material. Defaults to 16 fresh random bytes; false omits it. */
  userKeyingMaterial?: Uint8Array | false
}

export interface PdfPubSecRecipient {
  /** X.509 recipient certificate, DER encoded. RSA and named-curve EC keys are supported. */
  certificate: Uint8Array
  /** Permissions carried in this recipient's CMS envelope. */
  permissions?: PdfPermissions
  /** ECDH envelope parameters. Valid only for an EC recipient certificate. */
  keyAgreement?: PdfPubSecKeyAgreementOptions
  /** CMS recipient identifier form. Defaults to issuerAndSerialNumber. */
  recipientIdentifier?: 'issuer-and-serial' | 'subject-key-identifier'
  /** CMS EncryptedContentInfo cipher. Defaults to AES-128-CBC. */
  contentEncryption?: PdfPubSecContentEncryption
  /** RSA KeyTransRecipientInfo parameters. Valid only for an RSA certificate. */
  keyTransport?: PdfRsaKeyTransportOptions
}

export interface PdfPubSecEncryptionOptions {
  recipients: PdfPubSecRecipient[]
  method?: 'rc4' | 'aes-128' | 'aes-256'
  /** RC4 crypt-filter key length, from 40 through 128 bits in 8-bit steps. */
  rc4KeyBits?: number
  encryptMetadata?: boolean
}

// ─── Minimal DER reader ───

interface DerValue {
  tag: number
  content: Uint8Array
  raw: Uint8Array
}

class DerReader {
  private readonly data: Uint8Array
  private pos: number
  private readonly end: number

  constructor(data: Uint8Array, start = 0, end = data.length) {
    this.data = data
    this.pos = start
    this.end = end
  }

  hasMore(): boolean {
    return this.pos < this.end
  }

  read(): DerValue {
    if (this.pos + 2 > this.end) throw new Error('PDF PubSec error: truncated DER value')
    const start = this.pos
    const tag = this.data[this.pos]!
    this.pos++
    let length = this.data[this.pos]!
    this.pos++
    if (length & 0x80) {
      const n = length & 0x7F
      if (n === 0 || n > 4) throw new Error('PDF PubSec error: invalid DER length')
      length = 0
      for (let i = 0; i < n; i++) { length = length * 256 + this.data[this.pos]!; this.pos++ }
    }
    if (this.pos + length > this.end) throw new Error('PDF PubSec error: DER value exceeds container')
    const content = this.data.subarray(this.pos, this.pos + length)
    this.pos += length
    return { tag, content, raw: this.data.subarray(start, this.pos) }
  }
}

function derChildren(v: DerValue): DerValue[] {
  const r = new DerReader(v.content)
  const out: DerValue[] = []
  while (r.hasMore()) out.push(r.read())
  return out
}

function decodeOid(content: Uint8Array): string {
  const parts: number[] = [Math.trunc(content[0]! / 40), content[0]! % 40]
  let value = 0
  for (let i = 1; i < content.length; i++) {
    value = value * 128 + (content[i]! & 0x7F)
    if ((content[i]! & 0x80) === 0) { parts.push(value); value = 0 }
  }
  return parts.join('.')
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n
  for (let i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]!)
  return v
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ─── RSA private key + decryption ───

interface RsaPrivateKey {
  modulus: bigint
  privateExponent: bigint
}

type PrivateKey =
  | { kind: 'rsa', rsa: RsaPrivateKey }
  | { kind: 'ec', curveOid: string, curve: EcCurve, scalar: bigint }

const OID_RSA_ENCRYPTION_KEY = '1.2.840.113549.1.1.1'
const OID_RSAES_OAEP = '1.2.840.113549.1.1.7'
const OID_MGF1 = '1.2.840.113549.1.1.8'
const OID_P_SPECIFIED = '1.2.840.113549.1.1.9'
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1'

function parsePrivateKey(der: Uint8Array): PrivateKey {
  const top = new DerReader(der).read()
  const children = derChildren(top)
  // Traditional PKCS#1 RSAPrivateKey: version, n, e, d, ...
  if (children.length >= 4 && children[1]!.tag === 0x02 && children[2]!.tag === 0x02 && children[3]!.tag === 0x02) {
    return { kind: 'rsa', rsa: { modulus: bytesToBigInt(children[1]!.content), privateExponent: bytesToBigInt(children[3]!.content) } }
  }
  // PKCS#8 PrivateKeyInfo: version, algorithm { oid, params }, privateKey OCTET STRING.
  const algParts = derChildren(children[1]!)
  const algOid = decodeOid(algParts[0]!.content)
  const keyOctet = children[2]!.content
  if (algOid === OID_RSA_ENCRYPTION_KEY) {
    const rsa = derChildren(new DerReader(keyOctet).read())
    return { kind: 'rsa', rsa: { modulus: bytesToBigInt(rsa[1]!.content), privateExponent: bytesToBigInt(rsa[3]!.content) } }
  }
  if (algOid === OID_EC_PUBLIC_KEY) {
    // Named curve is in the algorithm parameters.
    const curveOid = algParts.length > 1 && algParts[1]!.tag === 0x06 ? decodeOid(algParts[1]!.content) : ''
    const curve = EC_CURVES[curveOid]
    if (curve === undefined) throw new Error(`PDF PubSec error: unsupported EC curve ${curveOid}`)
    // ECPrivateKey ::= { version, privateKey OCTET STRING, [0] params, [1] publicKey }
    const ec = derChildren(new DerReader(keyOctet).read())
    return { kind: 'ec', curveOid, curve, scalar: bytesToBigInt(ec[1]!.content) }
  }
  throw new Error(`PDF PubSec error: unsupported private key algorithm ${algOid}`)
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

/** RSA decrypt with PKCS#1 v1.5 type-2 unpadding (RFC 8017 7.2.2). */
function rsaDecryptPkcs1(key: RsaPrivateKey, ciphertext: Uint8Array): Uint8Array {
  const k = Math.ceil(key.modulus.toString(16).length / 2)
  const m = modPow(bytesToBigInt(ciphertext), key.privateExponent, key.modulus)
  const em = new Uint8Array(k)
  let value = m
  for (let i = k - 1; i >= 0; i--) { em[i] = Number(value & 0xFFn); value >>= 8n }
  // EM = 0x00 0x02 PS(nonzero, >= 8 bytes) 0x00 M
  if (em[0] !== 0x00 || em[1] !== 0x02) throw new Error('PDF PubSec error: RSA decryption padding invalid')
  let p = 2
  while (p < em.length && em[p] !== 0x00) p++
  if (p < 10 || p >= em.length) throw new Error('PDF PubSec error: RSA decryption padding invalid')
  return em.subarray(p + 1)
}

const OAEP_DIGEST_OIDS: Record<string, PdfRsaOaepDigest> = {
  '1.3.14.3.2.26': 'sha-1',
  '2.16.840.1.101.3.4.2.4': 'sha-224',
  '2.16.840.1.101.3.4.2.1': 'sha-256',
  '2.16.840.1.101.3.4.2.2': 'sha-384',
  '2.16.840.1.101.3.4.2.3': 'sha-512',
  '2.16.840.1.101.3.4.2.8': 'sha3-256',
  '2.16.840.1.101.3.4.2.9': 'sha3-384',
  '2.16.840.1.101.3.4.2.10': 'sha3-512',
}

const OAEP_OIDS_BY_DIGEST: Record<PdfRsaOaepDigest, string> = Object.fromEntries(
  Object.entries(OAEP_DIGEST_OIDS).map(function (entry) { return [entry[1], entry[0]] }),
) as Record<PdfRsaOaepDigest, string>

function oaepHash(algorithm: PdfRsaOaepDigest, value: Uint8Array): Uint8Array {
  if (algorithm === 'sha-1') return sha1(value)
  if (algorithm === 'sha-224') return sha224(value)
  if (algorithm === 'sha-256') return sha256(value)
  if (algorithm === 'sha-384') return sha384(value)
  if (algorithm === 'sha-512') return sha512(value)
  if (algorithm === 'sha3-256') return sha3_256(value)
  if (algorithm === 'sha3-384') return sha3_384(value)
  return sha3_512(value)
}

function oaepMgf1(seed: Uint8Array, length: number, algorithm: PdfRsaOaepDigest): Uint8Array {
  const result = new Uint8Array(length)
  const input = new Uint8Array(seed.length + 4)
  input.set(seed)
  let offset = 0
  for (let counter = 0; offset < length; counter++) {
    input[seed.length] = counter >>> 24
    input[seed.length + 1] = counter >>> 16
    input[seed.length + 2] = counter >>> 8
    input[seed.length + 3] = counter
    const block = oaepHash(algorithm, input)
    const take = Math.min(block.length, length - offset)
    result.set(block.subarray(0, take), offset)
    offset += take
  }
  return result
}

function parseOaepDigestAlgorithm(value: DerValue): PdfRsaOaepDigest {
  const fields = derChildren(value)
  if (value.tag !== 0x30 || fields.length < 1 || fields.length > 2 || fields[0]!.tag !== 0x06) {
    throw new Error('PDF PubSec error: malformed RSAES-OAEP digest AlgorithmIdentifier')
  }
  if (fields.length === 2 && (fields[1]!.tag !== 0x05 || fields[1]!.content.length !== 0)) {
    throw new Error('PDF PubSec error: RSAES-OAEP digest parameters must be NULL or absent')
  }
  const digest = OAEP_DIGEST_OIDS[decodeOid(fields[0]!.content)]
  if (digest === undefined) throw new Error('PDF PubSec error: unsupported RSAES-OAEP digest')
  return digest
}

function parseOaepParameters(value: DerValue | undefined): Required<Pick<PdfRsaKeyTransportOptions, 'digest' | 'mgfDigest' | 'label'>> {
  let digest: PdfRsaOaepDigest = 'sha-1'
  let mgfDigest: PdfRsaOaepDigest = 'sha-1'
  let label: Uint8Array = new Uint8Array(0)
  if (value === undefined) return { digest, mgfDigest, label }
  if (value.tag !== 0x30) throw new Error('PDF PubSec error: RSAES-OAEP parameters must be a SEQUENCE')
  const fields = derChildren(value)
  let previous = -1
  for (let i = 0; i < fields.length; i++) {
    const tag = fields[i]!.tag - 0xA0
    if (tag < 0 || tag > 2 || tag <= previous) throw new Error('PDF PubSec error: invalid RSAES-OAEP parameter order')
    previous = tag
    const explicit = derChildren(fields[i]!)
    if (explicit.length !== 1) throw new Error('PDF PubSec error: malformed RSAES-OAEP parameter')
    if (tag === 0) {
      digest = parseOaepDigestAlgorithm(explicit[0]!)
    } else if (tag === 1) {
      const mgf = derChildren(explicit[0]!)
      if (explicit[0]!.tag !== 0x30 || mgf.length !== 2 || decodeOid(mgf[0]!.content) !== OID_MGF1) {
        throw new Error('PDF PubSec error: RSAES-OAEP mask generation algorithm must be MGF1')
      }
      mgfDigest = parseOaepDigestAlgorithm(mgf[1]!)
    } else {
      const source = derChildren(explicit[0]!)
      if (explicit[0]!.tag !== 0x30 || source.length !== 2 || decodeOid(source[0]!.content) !== OID_P_SPECIFIED || source[1]!.tag !== 0x04) {
        throw new Error('PDF PubSec error: RSAES-OAEP pSource must be pSpecified')
      }
      label = source[1]!.content
    }
  }
  return { digest, mgfDigest, label }
}

function rsaDecryptOaep(
  key: RsaPrivateKey,
  ciphertext: Uint8Array,
  parameters: Required<Pick<PdfRsaKeyTransportOptions, 'digest' | 'mgfDigest' | 'label'>>,
): Uint8Array {
  const size = Math.ceil(key.modulus.toString(16).length / 2)
  if (ciphertext.length !== size) throw new Error('PDF PubSec error: RSAES-OAEP ciphertext length is invalid')
  let encodedValue = modPow(bytesToBigInt(ciphertext), key.privateExponent, key.modulus)
  const encoded = new Uint8Array(size)
  for (let i = size - 1; i >= 0; i--) { encoded[i] = Number(encodedValue & 0xffn); encodedValue >>= 8n }
  const hashLength = oaepHash(parameters.digest, new Uint8Array(0)).length
  if (size < hashLength * 2 + 2 || encoded[0] !== 0) throw new Error('PDF PubSec error: RSAES-OAEP decoding failed')
  const maskedSeed = encoded.subarray(1, 1 + hashLength)
  const maskedDb = encoded.subarray(1 + hashLength)
  const seedMask = oaepMgf1(maskedDb, hashLength, parameters.mgfDigest)
  const seed = new Uint8Array(hashLength)
  for (let i = 0; i < hashLength; i++) seed[i] = maskedSeed[i]! ^ seedMask[i]!
  const dbMask = oaepMgf1(seed, maskedDb.length, parameters.mgfDigest)
  const db = new Uint8Array(maskedDb.length)
  for (let i = 0; i < db.length; i++) db[i] = maskedDb[i]! ^ dbMask[i]!
  const expectedLabelHash = oaepHash(parameters.digest, parameters.label)
  if (!bytesEqual(db.subarray(0, hashLength), expectedLabelHash)) throw new Error('PDF PubSec error: RSAES-OAEP label hash mismatch')
  let delimiter = hashLength
  while (delimiter < db.length && db[delimiter] === 0) delimiter++
  if (delimiter >= db.length || db[delimiter] !== 1) throw new Error('PDF PubSec error: RSAES-OAEP decoding failed')
  return db.subarray(delimiter + 1)
}

// ─── CMS EnvelopedData ───

const OID_ENVELOPED_DATA = '1.2.840.113549.1.7.1' // placeholder overwritten below
const OID_PKCS7_ENVELOPED = '1.2.840.113549.1.7.3'
const OID_AES128_CBC = '2.16.840.1.101.3.4.1.2'
const OID_AES192_CBC = '2.16.840.1.101.3.4.1.22'
const OID_AES256_CBC = '2.16.840.1.101.3.4.1.42'
const OID_DES_EDE3_CBC = '1.2.840.113549.3.7'
void OID_ENVELOPED_DATA

const OID_AES128_WRAP = '2.16.840.1.101.3.4.1.5'
const OID_AES192_WRAP = '2.16.840.1.101.3.4.1.25'
const OID_AES256_WRAP = '2.16.840.1.101.3.4.1.45'
// dhSinglePass-stdDH-*kdf-scheme: X9.63 KDF hash selectors.
const OID_ECDH_SHA1 = '1.3.133.16.840.63.0.2'
const OID_ECDH_SHA224 = '1.3.132.1.11.0'
const OID_ECDH_SHA256 = '1.3.132.1.11.1'
const OID_ECDH_SHA384 = '1.3.132.1.11.2'
const OID_ECDH_SHA512 = '1.3.132.1.11.3'

/** RSA (KeyTransRecipientInfo) recipient: RSA-decrypt the content key. */
function tryKeyTransRecipient(
  ri: DerValue,
  key: RsaPrivateKey,
  issuerRaw: Uint8Array,
  serial: Uint8Array,
  subjectKeyIdentifier: Uint8Array | undefined,
): Uint8Array | null {
  const parts = derChildren(ri)
  let p = 1 // skip version
  const rid = parts[p]!
  p++
  if (rid.tag === 0x30) {
    const ridParts = derChildren(rid)
    if (!bytesEqual(ridParts[0]!.raw, issuerRaw) || !bytesEqual(ridParts[1]!.content, serial)) return null
  } else if (rid.tag === 0x80) {
    if (subjectKeyIdentifier === undefined || !bytesEqual(rid.content, subjectKeyIdentifier)) return null
  } else {
    return null
  }
  const keyEncryptionAlgorithm = derChildren(parts[p]!)
  p++
  if (keyEncryptionAlgorithm.length === 0 || keyEncryptionAlgorithm[0]!.tag !== 0x06) {
    throw new Error('PDF PubSec error: malformed RSA key-encryption algorithm')
  }
  const oid = decodeOid(keyEncryptionAlgorithm[0]!.content)
  if (oid === OID_RSA_ENCRYPTION_KEY) {
    if (keyEncryptionAlgorithm.length > 2 || (keyEncryptionAlgorithm.length === 2
        && (keyEncryptionAlgorithm[1]!.tag !== 0x05 || keyEncryptionAlgorithm[1]!.content.length !== 0))) {
      throw new Error('PDF PubSec error: rsaEncryption parameters must be NULL or absent')
    }
    return rsaDecryptPkcs1(key, parts[p]!.content)
  }
  if (oid === OID_RSAES_OAEP) {
    if (keyEncryptionAlgorithm.length > 2) throw new Error('PDF PubSec error: malformed RSAES-OAEP AlgorithmIdentifier')
    return rsaDecryptOaep(key, parts[p]!.content, parseOaepParameters(keyEncryptionAlgorithm[1]))
  }
  throw new Error(`PDF PubSec error: unsupported RSA key-encryption algorithm ${oid}`)
}

/**
 * ECDH (KeyAgreeRecipientInfo, RFC 5753) recipient: derive the key-encryption
 * key by ECDH with the ephemeral originator key and the X9.63 KDF, then
 * AES-unwrap the content key.
 */
function tryKeyAgreeRecipient(
  ri: DerValue,
  key: Extract<PrivateKey, { kind: 'ec' }>,
  issuerRaw: Uint8Array,
  serial: Uint8Array,
  subjectKeyIdentifier: Uint8Array | undefined,
): Uint8Array | null {
  const parts = derChildren(ri)
  let p = 1 // skip version (3)
  // originator [0]: OriginatorIdentifierOrKey → [1] OriginatorPublicKey
  const originator = parts[p]!
  p++
  const opk = derChildren(originator)[0]! // [1] OriginatorPublicKey
  const opkParts = derChildren(opk)
  const originatorAlgorithm = derChildren(opkParts[0]!)
  if (decodeOid(originatorAlgorithm[0]!.content) !== OID_EC_PUBLIC_KEY) {
    throw new Error('PDF PubSec error: ECDH originator key algorithm is not id-ecPublicKey')
  }
  if (originatorAlgorithm.length > 1 && originatorAlgorithm[1]!.tag === 0x06 && decodeOid(originatorAlgorithm[1]!.content) !== key.curveOid) {
    throw new Error('PDF PubSec error: ECDH originator and recipient curves differ')
  }
  const pubBits = opkParts[1]! // BIT STRING: 0x00 || 0x04 || X || Y
  const point = pubBits.content.subarray(1)
  if (point[0] !== 0x04 || point.length !== 1 + key.curve.size * 2) {
    throw new Error('PDF PubSec error: ECDH originator key is not an uncompressed point')
  }
  const peerX = bytesToBigInt(point.subarray(1, 1 + key.curve.size))
  const peerY = bytesToBigInt(point.subarray(1 + key.curve.size))

  // Optional ukm [1] EXPLICIT OCTET STRING.
  let userKeyingMaterial: Uint8Array | undefined
  if (parts[p]!.tag === 0xA1) {
    const ukmParts = derChildren(parts[p]!)
    if (ukmParts.length !== 1 || ukmParts[0]!.tag !== 0x04) throw new Error('PDF PubSec error: invalid ECDH user keying material')
    userKeyingMaterial = ukmParts[0]!.content
    p++
  }
  // keyEncryptionAlgorithm: KDF scheme OID + KeyWrapAlgorithm
  const keaParts = derChildren(parts[p]!)
  p++
  const kdfOid = decodeOid(keaParts[0]!.content)
  const wrapAlgRaw = keaParts[1]!.raw // AlgorithmIdentifier of the key-wrap algorithm
  const wrapOid = decodeOid(derChildren(keaParts[1]!)[0]!.content)
  const kekLength = wrapOid === OID_AES128_WRAP ? 16 : wrapOid === OID_AES192_WRAP ? 24 : wrapOid === OID_AES256_WRAP ? 32 : 0
  if (kekLength === 0) throw new Error(`PDF PubSec error: unsupported ECDH key wrap ${wrapOid}`)

  // recipientEncryptedKeys: SEQUENCE OF RecipientEncryptedKey { rid, encryptedKey }
  const reks = derChildren(parts[p]!)
  let wrapped: Uint8Array | null = null
  for (const rek of reks) {
    const rekParts = derChildren(rek)
    const rid = rekParts[0]!
    if (rid.tag === 0x30) {
      const ridParts = derChildren(rid)
      if (!bytesEqual(ridParts[0]!.raw, issuerRaw) || !bytesEqual(ridParts[1]!.content, serial)) continue
    } else if (rid.tag === 0xA0) {
      const recipientKeyIdentifier = derChildren(rid)
      if (recipientKeyIdentifier.length === 0 || recipientKeyIdentifier[0]!.tag !== 0x04) {
        throw new Error('PDF PubSec error: invalid RecipientKeyIdentifier')
      }
      if (subjectKeyIdentifier === undefined || !bytesEqual(recipientKeyIdentifier[0]!.content, subjectKeyIdentifier)) continue
    } else {
      continue
    }
    wrapped = rekParts[1]!.content
    break
  }
  if (wrapped === null) return null

  const z = ecdhSharedSecretX(key.curve, key.scalar, peerX, peerY)
  const sharedInfo = buildEccCmsSharedInfo(wrapAlgRaw, kekLength, userKeyingMaterial)
  const kek = x963Kdf(z, sharedInfo, kekLength, kdfOid)
  return aesKeyUnwrap(kek, wrapped)
}

/** ECC-CMS-SharedInfo (RFC 5753): SEQUENCE { keyInfo, [2] suppPubInfo(keyBits) }. */
function buildEccCmsSharedInfo(wrapAlgRaw: Uint8Array, kekLength: number, userKeyingMaterial?: Uint8Array): Uint8Array {
  const bits = kekLength * 8
  const bitLength = new Uint8Array([(bits >>> 24) & 0xFF, (bits >>> 16) & 0xFF, (bits >>> 8) & 0xFF, bits & 0xFF])
  return derSequence(
    derRaw(wrapAlgRaw),
    ...(userKeyingMaterial === undefined ? [] : [derContext(0, derOctetString(userKeyingMaterial))]),
    derContext(2, derOctetString(bitLength)),
  )
}

/** ANSI-X9.63 KDF: hash(Z || counter(4 BE) || sharedInfo), concatenated. */
function x963Kdf(z: Uint8Array, sharedInfo: Uint8Array, length: number, kdfOid: string): Uint8Array {
  const hash = kdfOid === OID_ECDH_SHA1 ? sha1
    : kdfOid === OID_ECDH_SHA224 ? sha224
    : kdfOid === OID_ECDH_SHA256 ? sha256
    : kdfOid === OID_ECDH_SHA384 ? sha384
    : kdfOid === OID_ECDH_SHA512 ? sha512
    : null
  if (hash === null) {
    throw new Error(`PDF PubSec error: unsupported ECDH KDF ${kdfOid}`)
  }
  const out = new Uint8Array(length)
  let pos = 0
  let counter = 1
  while (pos < length) {
    const input = new Uint8Array(z.length + 4 + sharedInfo.length)
    input.set(z, 0)
    input[z.length] = (counter >>> 24) & 0xFF
    input[z.length + 1] = (counter >>> 16) & 0xFF
    input[z.length + 2] = (counter >>> 8) & 0xFF
    input[z.length + 3] = counter & 0xFF
    input.set(sharedInfo, z.length + 4)
    const block = hash(input)
    const take = Math.min(block.length, length - pos)
    out.set(block.subarray(0, take), pos)
    pos += take
    counter++
  }
  return out
}

/**
 * Decrypt one CMS EnvelopedData with the recipient key, returning the enveloped
 * content (seed || permissions). Returns null when no RecipientInfo matches
 * this certificate's issuer and serial number.
 */
function decryptEnvelopedData(
  cms: Uint8Array,
  key: PrivateKey,
  issuerRaw: Uint8Array,
  serial: Uint8Array,
  subjectKeyIdentifier: Uint8Array | undefined,
): Uint8Array | null {
  const contentInfo = new DerReader(cms).read()
  const ciChildren = derChildren(contentInfo)
  if (ciChildren.length < 2 || decodeOid(ciChildren[0]!.content) !== OID_PKCS7_ENVELOPED) {
    throw new Error('PDF PubSec error: recipient is not CMS EnvelopedData')
  }
  const enveloped = derChildren(ciChildren[1]!)[0]!
  const ed = derChildren(enveloped)
  let idx = 0
  idx++ // version
  // Optional originatorInfo [0] is absent for ktri; recipientInfos is the next SET.
  if (ed[idx]!.tag === 0xA0) idx++
  const recipientInfos = derChildren(ed[idx]!)
  idx++
  const encryptedContentInfo = derChildren(ed[idx]!)

  // Find a matching RecipientInfo: KeyTransRecipientInfo (SEQUENCE, RSA) or
  // KeyAgreeRecipientInfo ([1], ECDH).
  let cek: Uint8Array | null = null
  for (const ri of recipientInfos) {
    if (ri.tag === 0x30 && key.kind === 'rsa') {
      cek = tryKeyTransRecipient(ri, key.rsa, issuerRaw, serial, subjectKeyIdentifier)
    } else if (ri.tag === 0xA1 && key.kind === 'ec') {
      cek = tryKeyAgreeRecipient(ri, key, issuerRaw, serial, subjectKeyIdentifier)
    }
    if (cek !== null) break
  }
  if (cek === null) return null

  // EncryptedContentInfo: contentType, contentEncryptionAlgorithm, [0] encryptedContent
  let ep = 0
  ep++ // contentType
  const algSeq = derChildren(encryptedContentInfo[ep]!)
  ep++
  const algOid = decodeOid(algSeq[0]!.content)
  const iv = algSeq[1]!.content
  const encryptedContent = encryptedContentInfo[ep]!.content

  let plain: Uint8Array
  let blockSize: number
  if (algOid === OID_DES_EDE3_CBC) {
    plain = tripleDesCbcDecrypt(encryptedContent, cek, iv)
    blockSize = 8
  } else if (algOid === OID_AES128_CBC || algOid === OID_AES192_CBC || algOid === OID_AES256_CBC) {
    plain = aesCbcDecryptNoPadding(encryptedContent, cek, iv)
    blockSize = 16
  } else {
    throw new Error(`PDF PubSec error: unsupported content encryption algorithm ${algOid}`)
  }
  // Strip PKCS#7 padding.
  const pad = plain[plain.length - 1]!
  if (pad === 0 || pad > blockSize || pad > plain.length) throw new Error('PDF PubSec error: invalid CMS content padding')
  for (let i = plain.length - pad; i < plain.length; i++) {
    if (plain[i] !== pad) throw new Error('PDF PubSec error: invalid CMS content padding')
  }
  return plain.subarray(0, plain.length - pad)
}

// ─── Certificate issuer + serial ───

function certificateIdentity(der: Uint8Array): { issuerRaw: Uint8Array, serial: Uint8Array, subjectKeyIdentifier?: Uint8Array } {
  const cert = new DerReader(der).read()
  const tbs = derChildren(cert)[0]!
  const tbsChildren = derChildren(tbs)
  let idx = 0
  if (tbsChildren[0]!.tag === 0xA0) idx++ // version [0]
  const serial = tbsChildren[idx]!.content
  idx++ // serialNumber
  idx++ // signature algorithm
  const issuerRaw = tbsChildren[idx]!.raw
  return { issuerRaw, serial, subjectKeyIdentifier: findSubjectKeyIdentifier(tbsChildren) }
}

function findSubjectKeyIdentifier(tbsChildren: DerValue[]): Uint8Array | undefined {
  for (let i = 0; i < tbsChildren.length; i++) {
    const value = tbsChildren[i]!
    if (value.tag !== 0xA3) continue
    const wrapper = derChildren(value)
    if (wrapper.length !== 1 || wrapper[0]!.tag !== 0x30) throw new Error('PDF PubSec error: invalid X.509 Extensions field')
    const extensions = derChildren(wrapper[0]!)
    for (let extensionIndex = 0; extensionIndex < extensions.length; extensionIndex++) {
      const fields = derChildren(extensions[extensionIndex]!)
      if (fields.length < 2 || fields[0]!.tag !== 0x06) throw new Error('PDF PubSec error: invalid X.509 Extension')
      if (decodeOid(fields[0]!.content) !== '2.5.29.14') continue
      const extensionValue = fields[fields.length - 1]!
      if (extensionValue.tag !== 0x04) throw new Error('PDF PubSec error: invalid SubjectKeyIdentifier extension')
      const identifier = new DerReader(extensionValue.content).read()
      if (identifier.tag !== 0x04) throw new Error('PDF PubSec error: invalid SubjectKeyIdentifier value')
      return identifier.content.slice()
    }
  }
  return undefined
}

// ─── File key derivation (ISO 32000-1 7.6.5) ───

/**
 * Recover the file encryption key from the /Recipients array and the
 * recipient's credential. `keyLengthBytes` is the file key length (16 for
 * AES-128, 32 for AES-256), `useSha256` selects SHA-256 (AES-256/V5) over the
 * default SHA-1.
 */
export function recoverPubSecFileKey(
  recipients: Uint8Array[],
  credential: PubSecCredential,
  keyLengthBytes: number,
  useSha256: boolean,
  encryptMetadata: boolean,
): Uint8Array {
  const privateKey = credential.privateKeyPassword === undefined
    ? credential.privateKey
    : decryptPkcs8PrivateKey(credential.privateKey, credential.privateKeyPassword)
  const key = parsePrivateKey(privateKey)
  const { issuerRaw, serial, subjectKeyIdentifier } = certificateIdentity(credential.certificate)

  let seed: Uint8Array | null = null
  for (const recip of recipients) {
    const content = decryptEnvelopedData(recip, key, issuerRaw, serial, subjectKeyIdentifier)
    if (content !== null) { seed = content.subarray(0, 20); break }
  }
  if (seed === null) throw new Error('PDF PubSec error: no recipient matches the supplied certificate')

  // SHA-1/256 of seed || each recipient's bytes || (0xFFFFFFFF when metadata is not encrypted).
  const chunks: Uint8Array[] = [seed, ...recipients]
  if (!encryptMetadata) chunks.push(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]))
  let total = 0
  for (const c of chunks) total += c.length
  const buf = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { buf.set(c, off); off += c.length }
  const digest = useSha256 ? sha256(buf) : sha1(buf)
  return digest.subarray(0, keyLengthBytes)
}

interface RsaPublicCertificate {
  kind: 'rsa'
  issuerRaw: Uint8Array
  serialRaw: Uint8Array
  subjectKeyIdentifier?: Uint8Array
  modulus: bigint
  exponent: bigint
}

interface EcPublicCertificate {
  kind: 'ec'
  issuerRaw: Uint8Array
  serialRaw: Uint8Array
  subjectKeyIdentifier?: Uint8Array
  curveOid: string
  curve: EcCurve
  publicX: bigint
  publicY: bigint
}

type PublicCertificate = RsaPublicCertificate | EcPublicCertificate

/** Creates an Adobe.PubSec encryption context for PDF output. */
export function createPubSecEncryptionContext(options: PdfPubSecEncryptionOptions): EncryptionContext {
  if (options.recipients.length === 0) throw new Error('PDF PubSec output requires at least one recipient')
  const method = options.method ?? 'aes-256'
  const encryptMetadata = options.encryptMetadata !== false
  const rc4KeyBits = options.rc4KeyBits ?? 128
  if (method === 'rc4' && (!Number.isInteger(rc4KeyBits) || rc4KeyBits < 40 || rc4KeyBits > 128 || rc4KeyBits % 8 !== 0)) {
    throw new Error('PDF PubSec RC4 key length must be 40-128 bits in multiples of 8')
  }
  if (method !== 'rc4' && options.rc4KeyBits !== undefined) throw new Error('PDF PubSec rc4KeyBits requires method rc4')
  const seed = randomBytes(20)
  const recipients: Uint8Array[] = []
  for (let i = 0; i < options.recipients.length; i++) {
    const recipient = options.recipients[i]!
    const cert = parsePublicCertificate(recipient.certificate)
    const permissions = computePermFlags(recipient.permissions ?? {})
    const envelopeContent = new Uint8Array(24)
    envelopeContent.set(seed)
    envelopeContent[20] = permissions & 0xFF
    envelopeContent[21] = (permissions >>> 8) & 0xFF
    envelopeContent[22] = (permissions >>> 16) & 0xFF
    envelopeContent[23] = (permissions >>> 24) & 0xFF
    if (cert.kind === 'rsa') {
      if (recipient.keyAgreement !== undefined) throw new Error('PDF PubSec keyAgreement options require an EC recipient certificate')
      recipients.push(createRsaCmsEnvelope(
        cert, envelopeContent, recipient.recipientIdentifier, recipient.contentEncryption, recipient.keyTransport,
      ))
    } else {
      if (recipient.keyTransport !== undefined) throw new Error('PDF PubSec keyTransport options require an RSA recipient certificate')
      recipients.push(createEcCmsEnvelope(cert, envelopeContent, recipient.keyAgreement, recipient.recipientIdentifier, recipient.contentEncryption))
    }
  }
  const keyLength = method === 'aes-256' ? 32 : method === 'aes-128' ? 16 : rc4KeyBits / 8
  const chunks = [seed, ...recipients]
  if (!encryptMetadata) chunks.push(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]))
  const digestInput = concatByteArrays(chunks)
  const fileKey = (method === 'aes-256' ? sha256(digestInput) : sha1(digestInput)).subarray(0, keyLength)
  const recipientsArray = `[${recipients.map(function (r) { return `<${bytesToHexString(r)}>` }).join(' ')}]`
  const cryptName = 'DefaultCryptFilter'
  const cfm = method === 'aes-256' ? 'AESV3' : method === 'aes-128' ? 'AESV2' : 'V2'
  const version = method === 'aes-256' ? 5 : 4
  const encryptDict = [
    '/Type /Encrypt',
    '/Filter /Adobe.PubSec',
    `/V ${version}`,
    `/Length ${keyLength * 8}`,
    `/Recipients ${recipientsArray}`,
    `/CF << /${cryptName} << /CFM /${cfm} /AuthEvent /DocOpen /Length ${keyLength} /Recipients ${recipientsArray} >> >>`,
    `/StmF /${cryptName}`,
    `/StrF /${cryptName}`,
    `/EFF /${cryptName}`,
    ...(encryptMetadata ? [] : ['/EncryptMetadata false']),
  ]
  const fileId = bytesToHexString(randomBytes(16))
  return {
    encryptDict,
    fileId,
    pdfVersion: method === 'aes-256' ? '2.0' : '1.7',
    encryptMetadata,
    encryptStream(objNum: number, genNum: number, data: Uint8Array): Uint8Array {
      return encryptPubSecObject(method, fileKey, objNum, genNum, data)
    },
    encryptString(objNum: number, genNum: number, value: string): Uint8Array {
      const data = new Uint8Array(value.length)
      for (let i = 0; i < value.length; i++) data[i] = value.charCodeAt(i) & 0xFF
      return encryptPubSecObject(method, fileKey, objNum, genNum, data)
    },
  }
}

function parsePublicCertificate(certificate: Uint8Array): PublicCertificate {
  const cert = new DerReader(certificate).read()
  const tbs = derChildren(cert)[0]!
  const parts = derChildren(tbs)
  let index = parts[0]!.tag === 0xA0 ? 1 : 0
  const serialRaw = parts[index]!.raw
  index += 2 // serial and signature
  const issuerRaw = parts[index]!.raw
  index += 3 // issuer, validity, subject
  const spki = derChildren(parts[index]!)
  const alg = derChildren(spki[0]!)
  const algorithmOid = decodeOid(alg[0]!.content)
  const bitString = spki[1]!.content
  if (bitString[0] !== 0) throw new Error('PDF PubSec error: invalid certificate public-key BIT STRING')
  if (algorithmOid === OID_RSA_ENCRYPTION_KEY) {
    const rsa = derChildren(new DerReader(bitString.subarray(1)).read())
    return {
      kind: 'rsa',
      issuerRaw,
      serialRaw,
      subjectKeyIdentifier: findSubjectKeyIdentifier(parts),
      modulus: bytesToBigInt(rsa[0]!.content),
      exponent: bytesToBigInt(rsa[1]!.content),
    }
  }
  if (algorithmOid !== OID_EC_PUBLIC_KEY) throw new Error(`PDF PubSec output does not support recipient key algorithm ${algorithmOid}`)
  if (alg.length !== 2 || alg[1]!.tag !== 0x06) throw new Error('PDF PubSec output requires a named-curve EC recipient certificate')
  const curveOid = decodeOid(alg[1]!.content)
  const curve = EC_CURVES[curveOid]
  if (curve === undefined) throw new Error(`PDF PubSec output does not support EC curve ${curveOid}`)
  const point = bitString.subarray(1)
  if (point[0] !== 0x04 || point.length !== 1 + curve.size * 2) throw new Error('PDF PubSec error: EC recipient key is not an uncompressed point')
  return {
    kind: 'ec',
    issuerRaw,
    serialRaw,
    subjectKeyIdentifier: findSubjectKeyIdentifier(parts),
    curveOid,
    curve,
    publicX: bytesToBigInt(point.subarray(1, 1 + curve.size)),
    publicY: bytesToBigInt(point.subarray(1 + curve.size)),
  }
}

function createEcCmsEnvelope(
  certificate: EcPublicCertificate,
  content: Uint8Array,
  options: PdfPubSecKeyAgreementOptions | undefined,
  identifier: PdfPubSecRecipient['recipientIdentifier'],
  contentEncryption: PdfPubSecContentEncryption | undefined,
): Uint8Array {
  const kdf = options?.kdf ?? 'sha-256'
  const keyWrap = options?.keyWrap ?? 'aes-128'
  const kdfOid = ecdhKdfOid(kdf)
  const wrap = aesWrapAlgorithm(keyWrap)
  const userKeyingMaterial = options?.userKeyingMaterial === false
    ? undefined
    : options?.userKeyingMaterial?.slice() ?? randomBytes(16)
  const ephemeralScalar = randomEcScalar(certificate.curve)
  const ephemeralPublic = deriveEcPublicPoint(certificate.curve, ephemeralScalar)
  const sharedSecret = ecdhSharedSecretX(certificate.curve, ephemeralScalar, certificate.publicX, certificate.publicY)
  const wrapAlgorithm = derSequence(derOid(wrap.oid))
  const sharedInfo = buildEccCmsSharedInfo(wrapAlgorithm, wrap.length, userKeyingMaterial)
  const keyEncryptionKey = x963Kdf(sharedSecret, sharedInfo, wrap.length, kdfOid)
  const encryptedContent = encryptCmsContent(content, contentEncryption)
  const wrappedKey = aesKeyWrap(keyEncryptionKey, encryptedContent.key)
  const point = new Uint8Array(1 + certificate.curve.size * 2)
  point[0] = 0x04
  writeBigInt(ephemeralPublic.x, point, 1, certificate.curve.size)
  writeBigInt(ephemeralPublic.y, point, 1 + certificate.curve.size, certificate.curve.size)
  const originatorKey = derContextConstructed(
    1,
    derSequence(derOid(OID_EC_PUBLIC_KEY)),
    derBitString(point),
  )
  const recipientEncryptedKey = derSequence(
    keyAgreeRecipientIdentifier(certificate, identifier),
    derOctetString(wrappedKey),
  )
  const recipientInfo = derContextConstructed(
    1,
    derIntegerFromNumber(3),
    derContext(0, originatorKey),
    ...(userKeyingMaterial === undefined ? [] : [derContext(1, derOctetString(userKeyingMaterial))]),
    derSequence(derOid(kdfOid), wrapAlgorithm),
    derSequence(recipientEncryptedKey),
  )
  const encryptedContentInfo = derSequence(
    derOid('1.2.840.113549.1.7.1'),
    derSequence(derOid(encryptedContent.oid), derOctetString(encryptedContent.iv)),
    derContextPrimitive(0, encryptedContent.data),
  )
  const envelopedData = derSequence(derIntegerFromNumber(2), derSet(recipientInfo), encryptedContentInfo)
  return derSequence(derOid(OID_PKCS7_ENVELOPED), derContext(0, envelopedData))
}

function keyAgreeRecipientIdentifier(
  certificate: PublicCertificate,
  identifier: PdfPubSecRecipient['recipientIdentifier'],
): Uint8Array {
  if (identifier !== 'subject-key-identifier') {
    return derSequence(derRaw(certificate.issuerRaw), derRaw(certificate.serialRaw))
  }
  if (certificate.subjectKeyIdentifier === undefined) {
    throw new Error('PDF PubSec subject-key-identifier recipient requires an X.509 SubjectKeyIdentifier extension')
  }
  return derContextConstructed(0, derOctetString(certificate.subjectKeyIdentifier))
}

function ecdhKdfOid(kdf: PdfEcdhKdf): string {
  if (kdf === 'sha-1') return OID_ECDH_SHA1
  if (kdf === 'sha-224') return OID_ECDH_SHA224
  if (kdf === 'sha-256') return OID_ECDH_SHA256
  if (kdf === 'sha-384') return OID_ECDH_SHA384
  return OID_ECDH_SHA512
}

function aesWrapAlgorithm(keyWrap: PdfAesKeyWrap): { oid: string, length: number } {
  if (keyWrap === 'aes-128') return { oid: OID_AES128_WRAP, length: 16 }
  if (keyWrap === 'aes-192') return { oid: OID_AES192_WRAP, length: 24 }
  return { oid: OID_AES256_WRAP, length: 32 }
}

function randomEcScalar(curve: EcCurve): bigint {
  while (true) {
    const scalar = bytesToBigInt(randomBytes(curve.size))
    if (scalar > 0n && scalar < curve.n) return scalar
  }
}

function writeBigInt(value: bigint, output: Uint8Array, offset: number, length: number): void {
  let remaining = value
  for (let i = offset + length - 1; i >= offset; i--) {
    output[i] = Number(remaining & 0xFFn)
    remaining >>= 8n
  }
  if (remaining !== 0n) throw new Error('PDF PubSec error: EC coordinate exceeds the curve field size')
}

function createRsaCmsEnvelope(
  certificate: RsaPublicCertificate,
  content: Uint8Array,
  identifier: PdfPubSecRecipient['recipientIdentifier'],
  contentEncryption: PdfPubSecContentEncryption | undefined,
  keyTransport: PdfRsaKeyTransportOptions | undefined,
): Uint8Array {
  const encryptedContent = encryptCmsContent(content, contentEncryption)
  const transportAlgorithm = keyTransport?.algorithm ?? 'pkcs1-v1_5'
  if (transportAlgorithm === 'pkcs1-v1_5' && (keyTransport?.digest !== undefined
      || keyTransport?.mgfDigest !== undefined || keyTransport?.label !== undefined)) {
    throw new Error('PDF PubSec OAEP parameters require keyTransport algorithm oaep')
  }
  const digest = keyTransport?.digest ?? 'sha-256'
  const mgfDigest = keyTransport?.mgfDigest ?? digest
  const label = keyTransport?.label ?? new Uint8Array(0)
  const encryptedKey = transportAlgorithm === 'oaep'
    ? rsaEncryptOaep(certificate.modulus, certificate.exponent, encryptedContent.key, { digest, mgfDigest, label })
    : rsaEncryptPkcs1(certificate.modulus, certificate.exponent, encryptedContent.key)
  const keyEncryptionAlgorithm = transportAlgorithm === 'oaep'
    ? derSequence(
      derOid(OID_RSAES_OAEP),
      derSequence(
        derContext(0, derSequence(derOid(OAEP_OIDS_BY_DIGEST[digest]), derNull())),
        derContext(1, derSequence(
          derOid(OID_MGF1),
          derSequence(derOid(OAEP_OIDS_BY_DIGEST[mgfDigest]), derNull()),
        )),
        derContext(2, derSequence(derOid(OID_P_SPECIFIED), derOctetString(label))),
      ),
    )
    : derSequence(derOid(OID_RSA_ENCRYPTION_KEY), derNull())
  const useSubjectKeyIdentifier = identifier === 'subject-key-identifier'
  if (useSubjectKeyIdentifier && certificate.subjectKeyIdentifier === undefined) {
    throw new Error('PDF PubSec subject-key-identifier recipient requires an X.509 SubjectKeyIdentifier extension')
  }
  const recipientInfo = derSequence(
    derIntegerFromNumber(useSubjectKeyIdentifier ? 2 : 0),
    useSubjectKeyIdentifier
      ? derContextPrimitive(0, certificate.subjectKeyIdentifier!)
      : derSequence(derRaw(certificate.issuerRaw), derRaw(certificate.serialRaw)),
    keyEncryptionAlgorithm,
    derOctetString(encryptedKey),
  )
  const encryptedContentInfo = derSequence(
    derOid('1.2.840.113549.1.7.1'),
    derSequence(derOid(encryptedContent.oid), derOctetString(encryptedContent.iv)),
    derContextPrimitive(0, encryptedContent.data),
  )
  const envelopedData = derSequence(derIntegerFromNumber(useSubjectKeyIdentifier ? 2 : 0), derSet(recipientInfo), encryptedContentInfo)
  return derSequence(derOid(OID_PKCS7_ENVELOPED), derContext(0, envelopedData))
}

function encryptCmsContent(
  content: Uint8Array,
  algorithm: PdfPubSecContentEncryption | undefined,
): { oid: string, key: Uint8Array, iv: Uint8Array, data: Uint8Array } {
  const selected = algorithm ?? 'aes-128'
  if (selected === '3des') {
    const key = randomBytes(24)
    const iv = randomBytes(8)
    return { oid: OID_DES_EDE3_CBC, key, iv, data: tripleDesCbcEncrypt(content, key, iv) }
  }
  const keyLength = selected === 'aes-128' ? 16 : selected === 'aes-192' ? 24 : 32
  const key = randomBytes(keyLength)
  const iv = randomBytes(16)
  const oid = selected === 'aes-128' ? OID_AES128_CBC : selected === 'aes-192' ? OID_AES192_CBC : OID_AES256_CBC
  return { oid, key, iv, data: aesCbcEncrypt(content, key, iv) }
}

function rsaEncryptPkcs1(modulus: bigint, exponent: bigint, message: Uint8Array): Uint8Array {
  const size = Math.ceil(modulus.toString(16).length / 2)
  if (message.length > size - 11) throw new Error('PDF PubSec error: RSA recipient key is too short')
  const encoded = new Uint8Array(size)
  encoded[1] = 2
  const padding = randomBytes(size - message.length - 3)
  for (let i = 0; i < padding.length; i++) {
    while (padding[i] === 0) padding[i] = randomBytes(1)[0]!
  }
  encoded.set(padding, 2)
  encoded[size - message.length - 1] = 0
  encoded.set(message, size - message.length)
  let value = modPow(bytesToBigInt(encoded), exponent, modulus)
  const out = new Uint8Array(size)
  for (let i = size - 1; i >= 0; i--) { out[i] = Number(value & 0xFFn); value >>= 8n }
  return out
}

function rsaEncryptOaep(
  modulus: bigint,
  exponent: bigint,
  message: Uint8Array,
  parameters: Required<Pick<PdfRsaKeyTransportOptions, 'digest' | 'mgfDigest' | 'label'>>,
): Uint8Array {
  const size = Math.ceil(modulus.toString(16).length / 2)
  const labelHash = oaepHash(parameters.digest, parameters.label)
  const hashLength = labelHash.length
  if (message.length > size - hashLength * 2 - 2) throw new Error('PDF PubSec error: RSA recipient key is too short for OAEP')
  const db = new Uint8Array(size - hashLength - 1)
  db.set(labelHash)
  db[db.length - message.length - 1] = 1
  db.set(message, db.length - message.length)
  const seed = randomBytes(hashLength)
  const dbMask = oaepMgf1(seed, db.length, parameters.mgfDigest)
  const maskedDb = new Uint8Array(db.length)
  for (let i = 0; i < db.length; i++) maskedDb[i] = db[i]! ^ dbMask[i]!
  const seedMask = oaepMgf1(maskedDb, hashLength, parameters.mgfDigest)
  const encoded = new Uint8Array(size)
  for (let i = 0; i < hashLength; i++) encoded[1 + i] = seed[i]! ^ seedMask[i]!
  encoded.set(maskedDb, 1 + hashLength)
  let encrypted = modPow(bytesToBigInt(encoded), exponent, modulus)
  const result = new Uint8Array(size)
  for (let i = size - 1; i >= 0; i--) { result[i] = Number(encrypted & 0xffn); encrypted >>= 8n }
  return result
}

function encryptPubSecObject(method: 'rc4' | 'aes-128' | 'aes-256', fileKey: Uint8Array, objNum: number, genNum: number, data: Uint8Array): Uint8Array {
  if (method === 'rc4') return rc4(deriveObjectKey(fileKey, objNum, genNum), data)
  let key = fileKey
  if (method === 'aes-128') {
    key = deriveObjectKeyAes(fileKey, objNum, genNum)
  }
  const iv = randomBytes(16)
  const cipher = aesCbcEncrypt(data, key, iv)
  const out = new Uint8Array(16 + cipher.length)
  out.set(iv)
  out.set(cipher, 16)
  return out
}

function concatByteArrays(parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (let i = 0; i < parts.length; i++) length += parts[i]!.length
  const out = new Uint8Array(length)
  let offset = 0
  for (let i = 0; i < parts.length; i++) { out.set(parts[i]!, offset); offset += parts[i]!.length }
  return out
}

function bytesToHexString(bytes: Uint8Array): string {
  let value = ''
  for (let i = 0; i < bytes.length; i++) value += bytes[i]!.toString(16).padStart(2, '0')
  return value
}
