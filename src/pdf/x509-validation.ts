import {
  hashByName,
  parseCertificate,
  verifySignatureValue,
  type CmsSignatureAlgorithm,
  type ParsedCertificate,
  type RsaPssParams,
} from './pdf-signature.js'

interface DerValue {
  tag: number
  content: Uint8Array
  raw: Uint8Array
}

export interface X509CertificateChainValidation {
  valid: boolean
  chain: Uint8Array[]
  validationTime: Date
  revocation: Array<'good' | 'revoked' | 'unknown'>
}

export interface X509CertificateChainOptions {
  certificate: Uint8Array
  intermediates?: readonly Uint8Array[]
  trustAnchors: readonly Uint8Array[]
  validationTime: Date
  crls?: readonly Uint8Array[]
  ocspResponses?: readonly Uint8Array[]
}

export interface ParsedX509Crl {
  issuer: Uint8Array
  thisUpdate: Date
  nextUpdate: Date | null
  revokedSerialNumbers: Uint8Array[]
  encoded: Uint8Array
}

export interface VerifiedOcspResponse {
  status: 'good' | 'revoked' | 'unknown'
  producedAt: Date
  thisUpdate: Date
  nextUpdate: Date | null
  responderCertificate: Uint8Array
  encoded: Uint8Array
}

/** Builds and cryptographically verifies an RFC 5280 certificate path and CRL status. */
export function verifyX509CertificateChain(options: X509CertificateChainOptions): X509CertificateChainValidation {
  if (!Number.isFinite(options.validationTime.getTime())) throw new Error('X.509 validation: invalid validation time')
  if (options.trustAnchors.length === 0) throw new Error('X.509 validation: at least one trust anchor is required')
  const leaf = parseCertificate(options.certificate)
  const intermediates = (options.intermediates ?? []).map(parseCertificate)
  const anchors = options.trustAnchors.map(parseCertificate)
  const chain = buildChain(leaf, intermediates, anchors, new Set())
  if (chain === null) return { valid: false, chain: [], validationTime: options.validationTime, revocation: [] }
  const revocation: Array<'good' | 'revoked' | 'unknown'> = []
  let valid = true
  for (let i = 0; i < chain.length; i++) {
    const certificate = chain[i]!
    if (options.validationTime < certificate.notBefore || options.validationTime > certificate.notAfter) valid = false
    if (i + 1 < chain.length) {
      const issuer = chain[i + 1]!
      if (!issuer.isCertificateAuthority || !verifyCertificateSignature(certificate, issuer)) valid = false
      const status = statusFromRevocationEvidence(
        certificate, issuer, options.ocspResponses ?? [], options.crls ?? [], options.validationTime,
      )
      revocation.push(status)
      if (status !== 'good') valid = false
    }
  }
  return { valid, chain: chain.map(function (value) { return value.raw }), validationTime: options.validationTime, revocation }
}

/** Parses and verifies an RFC 5280 CertificateList against its issuer certificate. */
export function parseAndVerifyX509Crl(crl: Uint8Array, issuerCertificate: Uint8Array): ParsedX509Crl {
  const issuer = parseCertificate(issuerCertificate)
  const root = readSingle(crl, 'CRL')
  if (root.tag !== 0x30) throw new Error('X.509 validation: CRL must be a SEQUENCE')
  const fields = children(root)
  if (fields.length !== 3 || fields[0]!.tag !== 0x30 || fields[1]!.tag !== 0x30
      || fields[2]!.tag !== 0x03 || fields[2]!.content[0] !== 0) throw new Error('X.509 validation: malformed CRL')
  const tbs = children(fields[0]!)
  let index = tbs[0]!.tag === 0x02 ? 1 : 0
  const innerAlgorithm = parseSignatureAlgorithm(tbs[index++]!)
  const issuerName = tbs[index++]!
  const thisUpdate = parseTime(tbs[index++]!)
  let nextUpdate: Date | null = null
  if (index < tbs.length && (tbs[index]!.tag === 0x17 || tbs[index]!.tag === 0x18)) nextUpdate = parseTime(tbs[index++]!)
  const revokedSerialNumbers: Uint8Array[] = []
  if (index < tbs.length && tbs[index]!.tag === 0x30) {
    const revoked = children(tbs[index++]!)
    for (let i = 0; i < revoked.length; i++) {
      const entry = children(revoked[i]!)
      if (entry.length < 2 || entry[0]!.tag !== 0x02) throw new Error('X.509 validation: malformed revoked certificate entry')
      parseTime(entry[1]!)
      revokedSerialNumbers.push(normalizeInteger(entry[0]!.content))
    }
  }
  if (index < tbs.length && tbs[index]!.tag !== 0xA0) throw new Error('X.509 validation: malformed CRL extensions')
  if (index + (index < tbs.length ? 1 : 0) !== tbs.length) throw new Error('X.509 validation: unexpected CRL field')
  if (!equalBytes(issuerName.raw, issuer.subjectRaw)) throw new Error('X.509 validation: CRL issuer does not match certificate subject')
  const outerAlgorithm = parseSignatureAlgorithm(fields[1]!)
  if (!sameAlgorithm(innerAlgorithm, outerAlgorithm)) throw new Error('X.509 validation: CRL signature algorithms differ')
  const digest = hashByName(outerAlgorithm.digest, fields[0]!.raw)
  if (!verifySignatureValue(
    issuer.publicKey, fields[2]!.content.subarray(1), outerAlgorithm.digest, digest,
    outerAlgorithm.algorithm, outerAlgorithm.pss, fields[0]!.raw,
  )) throw new Error('X.509 validation: CRL signature is invalid')
  return { issuer: issuerName.raw, thisUpdate, nextUpdate, revokedSerialNumbers, encoded: crl }
}

/** Parses and verifies an RFC 6960 OCSPResponse for one certificate. */
export function parseAndVerifyOcspResponse(
  response: Uint8Array,
  certificateDer: Uint8Array,
  issuerDer: Uint8Array,
  validationTime: Date,
): VerifiedOcspResponse {
  const certificate = parseCertificate(certificateDer)
  const issuer = parseCertificate(issuerDer)
  const root = readSingle(response, 'OCSPResponse')
  if (root.tag !== 0x30) throw new Error('X.509 validation: OCSPResponse must be a SEQUENCE')
  const responseFields = children(root)
  if (responseFields.length !== 2 || responseFields[0]!.tag !== 0x0A
      || decodeIntegerContent(responseFields[0]!.content) !== 0n || responseFields[1]!.tag !== 0xA0) {
    throw new Error('X.509 validation: OCSP response is not successful')
  }
  const responseBytesWrapper = children(responseFields[1]!)
  if (responseBytesWrapper.length !== 1 || responseBytesWrapper[0]!.tag !== 0x30) throw new Error('X.509 validation: malformed OCSP responseBytes')
  const responseBytes = children(responseBytesWrapper[0]!)
  if (responseBytes.length !== 2 || decodeOid(responseBytes[0]!) !== '1.3.6.1.5.5.7.48.1.1' || responseBytes[1]!.tag !== 0x04) {
    throw new Error('X.509 validation: unsupported OCSP response type')
  }
  const basic = readSingle(responseBytes[1]!.content, 'BasicOCSPResponse')
  if (basic.tag !== 0x30) throw new Error('X.509 validation: BasicOCSPResponse must be a SEQUENCE')
  const basicFields = children(basic)
  if (basicFields.length < 3 || basicFields.length > 4 || basicFields[0]!.tag !== 0x30
      || basicFields[1]!.tag !== 0x30 || basicFields[2]!.tag !== 0x03 || basicFields[2]!.content[0] !== 0) {
    throw new Error('X.509 validation: malformed BasicOCSPResponse')
  }
  const embedded: ParsedCertificate[] = []
  if (basicFields.length === 4) {
    if (basicFields[3]!.tag !== 0xA0) throw new Error('X.509 validation: malformed OCSP certificates')
    const certSequence = children(basicFields[3]!)
    const encodedCertificates = certSequence.length === 1 && certSequence[0]!.tag === 0x30
      && children(certSequence[0]!).every(function (value) { return value.tag === 0x30 })
      ? children(certSequence[0]!) : certSequence
    for (let i = 0; i < encodedCertificates.length; i++) embedded.push(parseCertificate(encodedCertificates[i]!.raw))
  }
  const responseData = children(basicFields[0]!)
  let index = responseData[0]!.tag === 0xA0 ? 1 : 0
  const responderId = responseData[index++]!
  const producedAt = parseTime(responseData[index++]!)
  const singleResponses = responseData[index++]!
  if (singleResponses.tag !== 0x30) throw new Error('X.509 validation: OCSP responses must be a SEQUENCE')
  const responder = selectOcspResponder(responderId, issuer, embedded)
  if (!equalBytes(responder.raw, issuer.raw)) {
    if (!equalBytes(responder.issuerRaw, issuer.subjectRaw) || !verifyCertificateSignature(responder, issuer)
        || !responder.extendedKeyUsageOids.includes('1.3.6.1.5.5.7.3.9')) {
      throw new Error('X.509 validation: unauthorized delegated OCSP responder')
    }
  }
  const responseAlgorithm = parseSignatureAlgorithm(basicFields[1]!)
  const responseDigest = hashByName(responseAlgorithm.digest, basicFields[0]!.raw)
  if (!verifySignatureValue(
    responder.publicKey, basicFields[2]!.content.subarray(1), responseAlgorithm.digest, responseDigest,
    responseAlgorithm.algorithm, responseAlgorithm.pss, basicFields[0]!.raw,
  )) throw new Error('X.509 validation: OCSP response signature is invalid')
  const responses = children(singleResponses)
  for (let i = 0; i < responses.length; i++) {
    const single = children(responses[i]!)
    if (single.length < 3) throw new Error('X.509 validation: malformed SingleResponse')
    if (!ocspCertIdMatches(single[0]!, certificate, issuer)) continue
    const statusField = single[1]!
    const status: 'good' | 'revoked' | 'unknown' = statusField.tag === 0x80 ? 'good'
      : statusField.tag === 0xA1 ? 'revoked' : statusField.tag === 0x82 ? 'unknown'
        : (() => { throw new Error('X.509 validation: invalid OCSP certificate status') })()
    const thisUpdate = parseTime(single[2]!)
    let nextUpdate: Date | null = null
    let optional = 3
    if (optional < single.length && single[optional]!.tag === 0xA0) {
      const explicit = children(single[optional++]!)
      if (explicit.length !== 1) throw new Error('X.509 validation: malformed OCSP nextUpdate')
      nextUpdate = parseTime(explicit[0]!)
    }
    if (optional < single.length && single[optional]!.tag !== 0xA1) throw new Error('X.509 validation: malformed SingleResponse extensions')
    if (validationTime < thisUpdate || (nextUpdate !== null && validationTime > nextUpdate)) {
      throw new Error('X.509 validation: OCSP response is outside its validity interval')
    }
    return { status, producedAt, thisUpdate, nextUpdate, responderCertificate: responder.raw, encoded: response }
  }
  throw new Error('X.509 validation: OCSP response has no matching CertID')
}

function buildChain(
  certificate: ParsedCertificate,
  intermediates: ParsedCertificate[],
  anchors: ParsedCertificate[],
  visited: Set<string>,
): ParsedCertificate[] | null {
  const identity = hex(certificate.raw)
  if (visited.has(identity)) return null
  const nextVisited = new Set(visited)
  nextVisited.add(identity)
  for (let i = 0; i < anchors.length; i++) {
    if (equalBytes(certificate.raw, anchors[i]!.raw)) return [certificate]
  }
  const candidates = [...intermediates, ...anchors]
  for (let i = 0; i < candidates.length; i++) {
    const issuer = candidates[i]!
    if (!equalBytes(certificate.issuerRaw, issuer.subjectRaw) || !verifyCertificateSignature(certificate, issuer)) continue
    const suffix = buildChain(issuer, intermediates, anchors, nextVisited)
    if (suffix !== null) return [certificate, ...suffix]
  }
  return null
}

function verifyCertificateSignature(certificate: ParsedCertificate, issuer: ParsedCertificate): boolean {
  const digest = hashByName(certificate.signatureDigestAlgorithm, certificate.tbsRaw)
  return verifySignatureValue(
    issuer.publicKey, certificate.signature, certificate.signatureDigestAlgorithm, digest,
    certificate.signatureAlgorithm, certificate.signaturePss, certificate.tbsRaw,
  )
}

function selectOcspResponder(
  responderId: DerValue,
  issuer: ParsedCertificate,
  embedded: ParsedCertificate[],
): ParsedCertificate {
  const candidates = [issuer, ...embedded]
  if (responderId.tag === 0xA1) {
    const name = children(responderId)
    if (name.length !== 1) throw new Error('X.509 validation: malformed OCSP responder byName')
    const match = candidates.find(function (value) { return equalBytes(value.subjectRaw, name[0]!.raw) })
    if (match !== undefined) return match
  } else if (responderId.tag === 0xA2) {
    const wrapped = children(responderId)
    const keyHash = wrapped.length === 1 && wrapped[0]!.tag === 0x04 ? wrapped[0]!.content : responderId.content
    const match = candidates.find(function (value) { return equalBytes(hashByName('SHA-1', value.subjectPublicKey), keyHash) })
    if (match !== undefined) return match
  } else {
    throw new Error('X.509 validation: invalid OCSP responderID')
  }
  throw new Error('X.509 validation: OCSP responder certificate was not found')
}

function ocspCertIdMatches(value: DerValue, certificate: ParsedCertificate, issuer: ParsedCertificate): boolean {
  if (value.tag !== 0x30) throw new Error('X.509 validation: OCSP CertID must be a SEQUENCE')
  const fields = children(value)
  if (fields.length !== 4 || fields[1]!.tag !== 0x04 || fields[2]!.tag !== 0x04 || fields[3]!.tag !== 0x02) {
    throw new Error('X.509 validation: malformed OCSP CertID')
  }
  const digest = parseDigestAlgorithm(fields[0]!)
  return equalBytes(fields[1]!.content, hashByName(digest, issuer.subjectRaw))
    && equalBytes(fields[2]!.content, hashByName(digest, issuer.subjectPublicKey))
    && equalBytes(normalizeInteger(fields[3]!.content), normalizeInteger(certificate.serial))
}

function statusFromRevocationEvidence(
  certificate: ParsedCertificate,
  issuer: ParsedCertificate,
  ocspResponses: readonly Uint8Array[],
  crls: readonly Uint8Array[],
  at: Date,
): 'good' | 'revoked' | 'unknown' {
  for (let i = 0; i < ocspResponses.length; i++) {
    try {
      return parseAndVerifyOcspResponse(ocspResponses[i]!, certificate.raw, issuer.raw, at).status
    } catch (error) {
      if (error instanceof Error && error.message === 'X.509 validation: OCSP response has no matching CertID') continue
      throw error
    }
  }
  for (let i = 0; i < crls.length; i++) {
    let parsed: ParsedX509Crl
    try {
      parsed = parseAndVerifyX509Crl(crls[i]!, issuer.raw)
    } catch (error) {
      if (error instanceof Error && error.message === 'X.509 validation: CRL issuer does not match certificate subject') continue
      throw error
    }
    if (at < parsed.thisUpdate || (parsed.nextUpdate !== null && at > parsed.nextUpdate)) continue
    return parsed.revokedSerialNumbers.some(function (serial) { return equalBytes(serial, normalizeInteger(certificate.serial)) })
      ? 'revoked' : 'good'
  }
  return 'unknown'
}

interface SignatureAlgorithmValue {
  algorithm: CmsSignatureAlgorithm
  pss: RsaPssParams | null
  digest: string
}

const SIGNATURE_OIDS: Record<string, { kind: 'rsa-pkcs1-v1_5' | 'dsa' | 'ecdsa', digest: string }> = {
  '1.2.840.113549.1.1.5': { kind: 'rsa-pkcs1-v1_5', digest: 'SHA-1' },
  '1.2.840.113549.1.1.11': { kind: 'rsa-pkcs1-v1_5', digest: 'SHA-256' },
  '1.2.840.113549.1.1.12': { kind: 'rsa-pkcs1-v1_5', digest: 'SHA-384' },
  '1.2.840.113549.1.1.13': { kind: 'rsa-pkcs1-v1_5', digest: 'SHA-512' },
  '2.16.840.1.101.3.4.3.14': { kind: 'rsa-pkcs1-v1_5', digest: 'SHA3-256' },
  '2.16.840.1.101.3.4.3.15': { kind: 'rsa-pkcs1-v1_5', digest: 'SHA3-384' },
  '2.16.840.1.101.3.4.3.16': { kind: 'rsa-pkcs1-v1_5', digest: 'SHA3-512' },
  '1.2.840.10045.4.1': { kind: 'ecdsa', digest: 'SHA-1' },
  '1.2.840.10045.4.3.2': { kind: 'ecdsa', digest: 'SHA-256' },
  '1.2.840.10045.4.3.3': { kind: 'ecdsa', digest: 'SHA-384' },
  '1.2.840.10045.4.3.4': { kind: 'ecdsa', digest: 'SHA-512' },
  '2.16.840.1.101.3.4.3.10': { kind: 'ecdsa', digest: 'SHA3-256' },
  '2.16.840.1.101.3.4.3.11': { kind: 'ecdsa', digest: 'SHA3-384' },
  '2.16.840.1.101.3.4.3.12': { kind: 'ecdsa', digest: 'SHA3-512' },
  '1.2.840.10040.4.3': { kind: 'dsa', digest: 'SHA-1' },
  '2.16.840.1.101.3.4.3.2': { kind: 'dsa', digest: 'SHA-256' },
  '2.16.840.1.101.3.4.3.3': { kind: 'dsa', digest: 'SHA-384' },
  '2.16.840.1.101.3.4.3.4': { kind: 'dsa', digest: 'SHA-512' },
}

function parseSignatureAlgorithm(value: DerValue): SignatureAlgorithmValue {
  const fields = children(value)
  if (fields.length === 0 || fields[0]!.tag !== 0x06) throw new Error('X.509 validation: signature algorithm lacks an OID')
  const oid = decodeOid(fields[0]!)
  if (oid === '1.2.840.113549.1.1.10') {
    if (fields.length !== 2 || fields[1]!.tag !== 0x30) throw new Error('X.509 validation: RSA-PSS parameters are required')
    const pss = parseRsaPssParameters(fields[1]!)
    return { algorithm: { kind: 'rsa-pss' }, pss, digest: pss.hash }
  }
  if (oid === '1.3.101.112' || oid === '1.3.101.113') {
    if (fields.length !== 1) throw new Error('X.509 validation: EdDSA signature parameters must be absent')
    const curve = oid === '1.3.101.112' ? 'Ed25519' : 'Ed448'
    return {
      algorithm: { kind: 'eddsa', curve },
      pss: null,
      digest: curve === 'Ed25519' ? 'SHA-512' : 'SHAKE256',
    }
  }
  const known = SIGNATURE_OIDS[oid]
  if (known === undefined) throw new Error(`X.509 validation: unsupported signature algorithm ${oid}`)
  if (known.kind === 'rsa-pkcs1-v1_5') {
    if (fields.length > 2 || (fields.length === 2 && (fields[1]!.tag !== 0x05 || fields[1]!.content.length !== 0))) {
      throw new Error('X.509 validation: invalid RSA signature parameters')
    }
    return { algorithm: { kind: known.kind, digest: known.digest }, pss: null, digest: known.digest }
  }
  if (fields.length !== 1) throw new Error('X.509 validation: DSA/ECDSA signature parameters must be absent')
  return { algorithm: { kind: known.kind, digest: known.digest }, pss: null, digest: known.digest }
}

function parseRsaPssParameters(value: DerValue): RsaPssParams {
  let hash = 'SHA-1'
  let mgfHash = 'SHA-1'
  let saltLength = 20
  const fields = children(value)
  let previous = -1
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    const tag = field.tag - 0xA0
    if (tag < 0 || tag > 3 || tag <= previous) throw new Error('X.509 validation: invalid RSA-PSS parameter order')
    previous = tag
    const explicit = children(field)
    if (explicit.length !== 1) throw new Error('X.509 validation: malformed RSA-PSS parameter')
    if (tag === 0) {
      hash = parseDigestAlgorithm(explicit[0]!)
    } else if (tag === 1) {
      const mgf = children(explicit[0]!)
      if (mgf.length !== 2 || decodeOid(mgf[0]!) !== '1.2.840.113549.1.1.8') {
        throw new Error('X.509 validation: unsupported RSA-PSS mask generation algorithm')
      }
      mgfHash = parseDigestAlgorithm(mgf[1]!)
    } else if (tag === 2) {
      saltLength = Number(decodeInteger(explicit[0]!))
      if (!Number.isSafeInteger(saltLength)) throw new Error('X.509 validation: RSA-PSS salt length is too large')
    } else if (decodeInteger(explicit[0]!) !== 1n) {
      throw new Error('X.509 validation: RSA-PSS trailerField must be 1')
    }
  }
  return { hash, mgfHash, saltLength }
}

function parseDigestAlgorithm(value: DerValue): string {
  if (value.tag !== 0x30) throw new Error('X.509 validation: digest algorithm must be a SEQUENCE')
  const fields = children(value)
  if (fields.length < 1 || fields.length > 2) throw new Error('X.509 validation: invalid digest algorithm')
  if (fields.length === 2 && (fields[1]!.tag !== 0x05 || fields[1]!.content.length !== 0)) {
    throw new Error('X.509 validation: digest parameters must be NULL or absent')
  }
  const algorithms: Record<string, string> = {
    '1.3.14.3.2.26': 'SHA-1',
    '2.16.840.1.101.3.4.2.1': 'SHA-256',
    '2.16.840.1.101.3.4.2.2': 'SHA-384',
    '2.16.840.1.101.3.4.2.3': 'SHA-512',
    '2.16.840.1.101.3.4.2.8': 'SHA3-256',
    '2.16.840.1.101.3.4.2.9': 'SHA3-384',
    '2.16.840.1.101.3.4.2.10': 'SHA3-512',
    '2.16.840.1.101.3.4.2.12': 'SHAKE256',
  }
  const result = algorithms[decodeOid(fields[0]!)]
  if (result === undefined) throw new Error('X.509 validation: unsupported digest algorithm')
  return result
}

function decodeInteger(value: DerValue): bigint {
  if (value.tag !== 0x02 || value.content.length === 0 || (value.content[0]! & 0x80) !== 0) {
    throw new Error('X.509 validation: expected non-negative INTEGER')
  }
  let result = 0n
  for (let i = 0; i < value.content.length; i++) result = (result << 8n) | BigInt(value.content[i]!)
  return result
}

function decodeIntegerContent(content: Uint8Array): bigint {
  if (content.length === 0 || (content[0]! & 0x80) !== 0) throw new Error('X.509 validation: expected non-negative integer content')
  let result = 0n
  for (let i = 0; i < content.length; i++) result = (result << 8n) | BigInt(content[i]!)
  return result
}

function sameAlgorithm(a: SignatureAlgorithmValue, b: SignatureAlgorithmValue): boolean {
  return a.algorithm.kind === b.algorithm.kind && a.digest === b.digest
}

function readSingle(data: Uint8Array, label: string): DerValue {
  const value = readDer(data, 0)
  if (value.next !== data.length) throw new Error(`X.509 validation: trailing data after ${label}`)
  return value.value
}

function readDer(data: Uint8Array, start: number): { value: DerValue, next: number } {
  if (start + 2 > data.length) throw new Error('X.509 validation: truncated DER')
  const tag = data[start]!
  let offset = start + 1
  let length = data[offset++]!
  if ((length & 0x80) !== 0) {
    const count = length & 0x7F
    if (count === 0 || count > 4 || offset + count > data.length || data[offset] === 0) throw new Error('X.509 validation: invalid DER length')
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + data[offset++]!
    if (length < 128) throw new Error('X.509 validation: non-minimal DER length')
  }
  const end = offset + length
  if (end > data.length) throw new Error('X.509 validation: truncated DER content')
  return { value: { tag, content: data.subarray(offset, end), raw: data.subarray(start, end) }, next: end }
}

function children(value: DerValue): DerValue[] {
  const result: DerValue[] = []
  let offset = 0
  while (offset < value.content.length) {
    const child = readDer(value.content, offset)
    result.push(child.value)
    offset = child.next
  }
  return result
}

function decodeOid(value: DerValue): string {
  if (value.tag !== 0x06 || value.content.length === 0) throw new Error('X.509 validation: expected OID')
  const values: number[] = []
  let current = 0
  for (let i = 0; i < value.content.length; i++) {
    current = current * 128 + (value.content[i]! & 0x7F)
    if ((value.content[i]! & 0x80) === 0) { values.push(current); current = 0 }
  }
  if ((value.content[value.content.length - 1]! & 0x80) !== 0) throw new Error('X.509 validation: truncated OID')
  const first = values.shift()!
  const firstArc = first < 40 ? 0 : first < 80 ? 1 : 2
  return [firstArc, first - firstArc * 40, ...values].join('.')
}

function parseTime(value: DerValue): Date {
  let text = ''
  for (let i = 0; i < value.content.length; i++) text += String.fromCharCode(value.content[i]!)
  const match = value.tag === 0x17
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
    : value.tag === 0x18 ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text) : null
  if (match === null) throw new Error('X.509 validation: invalid time')
  const year = value.tag === 0x17 ? (Number(match[1]) >= 50 ? 1900 : 2000) + Number(match[1]) : Number(match[1])
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new Error('X.509 validation: invalid calendar time')
  }
  return date
}

function normalizeInteger(value: Uint8Array): Uint8Array {
  let start = 0
  while (start + 1 < value.length && value[start] === 0) start++
  return value.subarray(start)
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function hex(value: Uint8Array): string {
  let result = ''
  for (let i = 0; i < value.length; i++) result += value[i]!.toString(16).padStart(2, '0')
  return result
}
