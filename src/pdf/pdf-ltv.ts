import { sha1 } from '../encryption/sha1.js'
import { appendIncrementalUpdate, type IncrementalObject } from './pdf-incremental.js'
import {
  parsePdf,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  type PdfDict,
} from './pdf-parser.js'
import { serializePdfValue } from './pdf-serializer.js'
import { verifyCmsDetachedSignature, verifyPdfSignatures } from './pdf-signature.js'
import { parseRfc3161TimestampToken } from './pdf-rfc3161.js'
import { parseX509SeedFacts } from './x509-seed-policy.js'
import { verifyX509CertificateChain, type X509CertificateChainValidation } from './x509-validation.js'

export type PdfVriClaimedTime =
  | { kind: 'validation-time', value: Date }
  | { kind: 'timestamp-token', token: Uint8Array }
  | { kind: 'subsequent-document-timestamp' }

export interface PdfVriInput {
  /** Fully qualified signature field name reported by verifyPdfSignatures. */
  fieldName: string
  certificates?: readonly Uint8Array[]
  ocspResponses?: readonly Uint8Array[]
  crls?: readonly Uint8Array[]
  claimedTime: PdfVriClaimedTime
}

export interface PdfLongTermValidationInput {
  certificates?: readonly Uint8Array[]
  ocspResponses?: readonly Uint8Array[]
  crls?: readonly Uint8Array[]
  vri?: readonly PdfVriInput[]
}

export interface PdfValidationRelatedInformation {
  vriKey: string
  fieldName: string | null
  certificates: Uint8Array[]
  ocspResponses: Uint8Array[]
  crls: Uint8Array[]
  claimedTime: PdfVriClaimedTime
}

export interface PdfDocumentSecurityStore {
  certificates: Uint8Array[]
  ocspResponses: Uint8Array[]
  crls: Uint8Array[]
  vri: PdfValidationRelatedInformation[]
}

export interface PdfLongTermValidationVerification {
  fieldName: string
  vriKey: string
  signatureValid: boolean
  claimedTimeValid: boolean
  claimedTime: Date | null
  certificateChain: X509CertificateChainValidation
  valid: boolean
}

export interface PdfLongTermValidationVerificationOptions {
  trustAnchors: readonly Uint8Array[]
  validationTime?: Date
}

/** Verifies signature, time evidence, certificate path, and embedded revocation data for each VRI. */
export function verifyPdfLongTermValidation(
  pdf: Uint8Array,
  options: PdfLongTermValidationVerificationOptions,
): PdfLongTermValidationVerification[] {
  const store = readPdfDocumentSecurityStore(pdf)
  if (store === null) return []
  const signatures = verifyPdfSignatures(pdf)
  const signatureByVri = new Map(signatures.map(function (value) { return [value.vriKey, value] }))
  const documentTimestamps = signatures.filter(function (value) {
    return value.subFilter === 'ETSI.RFC3161' && value.digestValid && value.signatureValid && value.signingTime !== null
  })
  return store.vri.map(function (vri) {
    const signature = signatureByVri.get(vri.vriKey)
    if (signature === undefined || signature.fieldName === null) throw new Error(`PDF LTV: VRI /${vri.vriKey} has no matching signature`)
    let claimedTime: Date | null = null
    let claimedTimeValid = false
    if (vri.claimedTime.kind === 'validation-time') {
      claimedTime = vri.claimedTime.value
      claimedTimeValid = true
    } else if (vri.claimedTime.kind === 'timestamp-token') {
      const timestamp = parseRfc3161TimestampToken(vri.claimedTime.token)
      const cms = verifyCmsDetachedSignature(vri.claimedTime.token, timestamp.encodedTstInfo)
      claimedTime = timestamp.generationTime
      const timestampIntermediates = store.certificates.filter(function (value) {
        return !equalBytes(value, cms.signerCertificate)
      })
      const timestampChain = verifyX509CertificateChain({
        certificate: cms.signerCertificate,
        intermediates: timestampIntermediates,
        trustAnchors: options.trustAnchors,
        validationTime: claimedTime,
        crls: store.crls,
        ocspResponses: store.ocspResponses,
      })
      claimedTimeValid = cms.digestValid && cms.signatureValid && timestampChain.valid
    } else {
      const timestamp = documentTimestamps.find(function (candidate) {
        return candidate.signedRevisionLength > signature.signedRevisionLength
      })
      if (timestamp !== undefined) {
        claimedTime = timestamp.signingTime
        const timestampIntermediates = store.certificates.filter(function (value) {
          return !equalBytes(value, timestamp.signerCertificate)
        })
        claimedTimeValid = verifyX509CertificateChain({
          certificate: timestamp.signerCertificate,
          intermediates: timestampIntermediates,
          trustAnchors: options.trustAnchors,
          validationTime: claimedTime!,
          crls: store.crls,
          ocspResponses: store.ocspResponses,
        }).valid
      }
    }
    const validationTime = claimedTime ?? options.validationTime
    if (validationTime === undefined) throw new Error(`PDF LTV: VRI /${vri.vriKey} has no validation time`)
    const allCertificates = mergeUnique(store.certificates, vri.certificates)
    const intermediates = allCertificates.filter(function (value) { return !equalBytes(value, signature.signerCertificate) })
    const certificateChain = verifyX509CertificateChain({
      certificate: signature.signerCertificate,
      intermediates,
      trustAnchors: options.trustAnchors,
      validationTime,
      crls: mergeUnique(store.crls, vri.crls),
      ocspResponses: mergeUnique(store.ocspResponses, vri.ocspResponses),
    })
    const signatureValid = signature.digestValid && signature.signatureValid
    return {
      fieldName: signature.fieldName!,
      vriKey: vri.vriKey,
      signatureValid,
      claimedTimeValid,
      claimedTime,
      certificateChain,
      valid: signatureValid && claimedTimeValid && certificateChain.valid,
    }
  })
}

/** Reads and validates a PDF 2.0 Document Security Store and its VRI dictionaries. */
export function readPdfDocumentSecurityStore(pdf: Uint8Array): PdfDocumentSecurityStore | null {
  const doc = parsePdf(pdf)
  const dssValue = doc.resolve(doc.getCatalog().get('DSS') ?? null)
  if (dssValue === null) return null
  if (!(dssValue instanceof Map)) throw new Error('PDF LTV: catalog /DSS must be a dictionary')
  validateOptionalType(doc, dssValue, 'DSS', 'DSS')
  const certificates = readValidationStreams(doc, dssValue, 'Certs')
  const ocspResponses = readValidationStreams(doc, dssValue, 'OCSPs')
  const crls = readValidationStreams(doc, dssValue, 'CRLs')
  for (let i = 0; i < certificates.values.length; i++) parseX509SeedFacts(certificates.values[i]!)

  const signatures = verifyPdfSignatures(pdf)
  const signatureByVri = new Map(signatures.map(function (value) { return [value.vriKey, value] }))
  const vriDictionary = doc.resolve(dssValue.get('VRI') ?? null)
  const vri: PdfValidationRelatedInformation[] = []
  if (vriDictionary !== null) {
    if (!(vriDictionary instanceof Map)) throw new Error('PDF LTV: DSS /VRI must be a dictionary')
    for (const [key, rawValue] of vriDictionary) {
      if (!/^[0-9A-F]{40}$/.test(key)) throw new Error('PDF LTV: VRI key must be an uppercase SHA-1 hexadecimal digest')
      const value = doc.resolve(rawValue)
      if (!(value instanceof Map)) throw new Error(`PDF LTV: VRI /${key} must be a dictionary`)
      validateOptionalType(doc, value, 'VRI', `VRI /${key}`)
      const cert = readVriMembers(doc, value, 'Cert', certificates, key)
      const ocsp = readVriMembers(doc, value, 'OCSP', ocspResponses, key)
      const crl = readVriMembers(doc, value, 'CRL', crls, key)
      const tu = doc.resolve(value.get('TU') ?? null)
      const ts = doc.resolve(value.get('TS') ?? null)
      if (tu !== null && ts !== null) throw new Error(`PDF LTV: VRI /${key} cannot contain both /TU and /TS`)
      let claimedTime: PdfVriClaimedTime
      if (tu !== null) {
        if (!(tu instanceof PdfString)) throw new Error(`PDF LTV: VRI /${key} /TU must be a date string`)
        claimedTime = { kind: 'validation-time', value: parsePdfDate(tu) }
      } else if (ts !== null) {
        if (!(ts instanceof PdfStream)) throw new Error(`PDF LTV: VRI /${key} /TS must be a stream`)
        const token = doc.decodeStream(ts)
        parseRfc3161TimestampToken(token)
        claimedTime = { kind: 'timestamp-token', token }
      } else {
        claimedTime = { kind: 'subsequent-document-timestamp' }
      }
      vri.push({
        vriKey: key,
        fieldName: signatureByVri.get(key)?.fieldName ?? null,
        certificates: cert,
        ocspResponses: ocsp,
        crls: crl,
        claimedTime,
      })
    }
  }
  return {
    certificates: certificates.values,
    ocspResponses: ocspResponses.values,
    crls: crls.values,
    vri,
  }
}

/**
 * Appends DSS/VRI validation data as an incremental update. Existing DSS data
 * is merged by DER value so an LTV renewal never discards earlier evidence.
 */
export function appendPdfLongTermValidation(
  pdf: Uint8Array,
  input: PdfLongTermValidationInput,
): Uint8Array {
  const previous = readPdfDocumentSecurityStore(pdf) ?? {
    certificates: [], ocspResponses: [], crls: [], vri: [],
  }
  const certificates = mergeUnique(previous.certificates, input.certificates ?? [])
  const ocspResponses = mergeUnique(previous.ocspResponses, input.ocspResponses ?? [])
  const crls = mergeUnique(previous.crls, input.crls ?? [])
  const signatures = verifyPdfSignatures(pdf)
  const signatureByField = new Map<string, (typeof signatures)[number]>()
  for (let i = 0; i < signatures.length; i++) {
    if (signatures[i]!.fieldName !== null) signatureByField.set(signatures[i]!.fieldName!, signatures[i]!)
  }
  const vriByKey = new Map(previous.vri.map(function (value) { return [value.vriKey, value] }))
  for (let i = 0; i < (input.vri?.length ?? 0); i++) {
    const requested = input.vri![i]!
    const signature = signatureByField.get(requested.fieldName)
    if (signature === undefined) throw new Error(`PDF LTV: signature field ${requested.fieldName} was not found`)
    if (!signature.digestValid || !signature.signatureValid) {
      throw new Error(`PDF LTV: validation data cannot be recorded for invalid signature ${requested.fieldName}`)
    }
    if (vriByKey.has(signature.vriKey)) throw new Error(`PDF LTV: duplicate VRI for signature ${requested.fieldName}`)
    validateClaimedTime(requested.claimedTime)
    const cert = mergeUnique([], requested.certificates ?? [])
    const ocsp = mergeUnique([], requested.ocspResponses ?? [])
    const crl = mergeUnique([], requested.crls ?? [])
    for (let item = 0; item < cert.length; item++) parseX509SeedFacts(cert[item]!)
    appendMissing(certificates, cert)
    appendMissing(ocspResponses, ocsp)
    appendMissing(crls, crl)
    vriByKey.set(signature.vriKey, {
      vriKey: signature.vriKey,
      fieldName: requested.fieldName,
      certificates: cert,
      ocspResponses: ocsp,
      crls: crl,
      claimedTime: requested.claimedTime,
    })
  }
  appendMissing(certificates, input.certificates ?? [])
  appendMissing(ocspResponses, input.ocspResponses ?? [])
  appendMissing(crls, input.crls ?? [])
  for (let i = 0; i < certificates.length; i++) parseX509SeedFacts(certificates[i]!)
  if (certificates.length + ocspResponses.length + crls.length + vriByKey.size === 0) {
    throw new Error('PDF LTV: the Document Security Store must not be empty')
  }

  const doc = parsePdf(pdf)
  const root = doc.trailer.get('Root')
  const size = doc.trailer.get('Size')
  if (!(root instanceof PdfRef) || typeof size !== 'number') throw new Error('PDF LTV: invalid document trailer')
  let nextObject = size
  const objects: IncrementalObject[] = []
  const certRefs = writeStreams(certificates, objects, function () { return nextObject++ })
  const ocspRefs = writeStreams(ocspResponses, objects, function () { return nextObject++ })
  const crlRefs = writeStreams(crls, objects, function () { return nextObject++ })
  const vriEntries: string[] = []
  for (const value of vriByKey.values()) {
    const vriNumber = nextObject++
    const fields = ['/Type /VRI']
    addReferenceArray(fields, 'Cert', refsForValues(value.certificates, certificates, certRefs))
    addReferenceArray(fields, 'OCSP', refsForValues(value.ocspResponses, ocspResponses, ocspRefs))
    addReferenceArray(fields, 'CRL', refsForValues(value.crls, crls, crlRefs))
    if (value.claimedTime.kind === 'validation-time') {
      fields.push(`/TU ${serializePdfValue(new PdfString(ascii(pdfDate(value.claimedTime.value))))}`)
    } else if (value.claimedTime.kind === 'timestamp-token') {
      const tsNumber = nextObject++
      objects.push({ num: tsNumber, body: streamBody(value.claimedTime.token) })
      fields.push(`/TS ${tsNumber} 0 R`)
    }
    objects.push({ num: vriNumber, body: `<< ${fields.join(' ')} >>` })
    vriEntries.push(`/${value.vriKey} ${vriNumber} 0 R`)
  }
  const dssNumber = nextObject++
  const dssFields = ['/Type /DSS']
  if (vriEntries.length > 0) dssFields.push(`/VRI << ${vriEntries.join(' ')} >>`)
  addReferenceArray(dssFields, 'Certs', certRefs)
  addReferenceArray(dssFields, 'OCSPs', ocspRefs)
  addReferenceArray(dssFields, 'CRLs', crlRefs)
  objects.push({ num: dssNumber, body: `<< ${dssFields.join(' ')} >>` })
  const catalog = new Map(doc.getCatalog()) as PdfDict
  catalog.set('DSS', new PdfRef(dssNumber, 0))
  objects.push({ num: root.num, gen: root.gen, body: serializePdfValue(catalog) })
  return appendIncrementalUpdate(pdf, objects)
}

interface ValidationStreams {
  refs: PdfRef[]
  values: Uint8Array[]
  indexByRef: Map<string, number>
}

function readValidationStreams(doc: ReturnType<typeof parsePdf>, dss: PdfDict, key: string): ValidationStreams {
  const raw = doc.resolve(dss.get(key) ?? null)
  if (raw === null) return { refs: [], values: [], indexByRef: new Map() }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`PDF LTV: DSS /${key} must be a non-empty array`)
  const refs: PdfRef[] = []
  const values: Uint8Array[] = []
  const indexByRef = new Map<string, number>()
  for (let i = 0; i < raw.length; i++) {
    const reference = raw[i]
    if (!(reference instanceof PdfRef)) throw new Error(`PDF LTV: DSS /${key} entries must be indirect references`)
    const stream = doc.resolve(reference)
    if (!(stream instanceof PdfStream)) throw new Error(`PDF LTV: DSS /${key} entries must reference streams`)
    refs.push(reference)
    values.push(doc.decodeStream(stream))
    indexByRef.set(refKey(reference), i)
  }
  return { refs, values, indexByRef }
}

function readVriMembers(
  doc: ReturnType<typeof parsePdf>,
  vri: PdfDict,
  key: string,
  global: ValidationStreams,
  vriKey: string,
): Uint8Array[] {
  const raw = doc.resolve(vri.get(key) ?? null)
  if (raw === null) return []
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`PDF LTV: VRI /${vriKey} /${key} must be a non-empty array`)
  const values: Uint8Array[] = []
  for (let i = 0; i < raw.length; i++) {
    const reference = raw[i]
    if (!(reference instanceof PdfRef)) throw new Error(`PDF LTV: VRI /${vriKey} /${key} entries must be indirect references`)
    const index = global.indexByRef.get(refKey(reference))
    if (index === undefined) throw new Error(`PDF LTV: VRI /${vriKey} /${key} entry is absent from the DSS array`)
    values.push(global.values[index]!)
  }
  return values
}

function validateOptionalType(doc: ReturnType<typeof parsePdf>, value: PdfDict, expected: string, label: string): void {
  const type = doc.resolve(value.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== expected)) {
    throw new Error(`PDF LTV: ${label} /Type must be /${expected}`)
  }
}

function validateClaimedTime(value: PdfVriClaimedTime): void {
  if (value.kind === 'validation-time') {
    if (!Number.isFinite(value.value.getTime())) throw new Error('PDF LTV: invalid VRI validation time')
  } else if (value.kind === 'timestamp-token') {
    parseRfc3161TimestampToken(value.token)
  }
}

function mergeUnique(first: readonly Uint8Array[], second: readonly Uint8Array[]): Uint8Array[] {
  const result: Uint8Array[] = []
  appendMissing(result, first)
  appendMissing(result, second)
  return result
}

function appendMissing(target: Uint8Array[], values: readonly Uint8Array[]): void {
  for (let i = 0; i < values.length; i++) {
    if (!target.some(function (existing) { return equalBytes(existing, values[i]!) })) target.push(values[i]!)
  }
}

function writeStreams(values: readonly Uint8Array[], objects: IncrementalObject[], allocate: () => number): PdfRef[] {
  return values.map(function (value) {
    const number = allocate()
    objects.push({ num: number, body: streamBody(value) })
    return new PdfRef(number, 0)
  })
}

function streamBody(value: Uint8Array): Uint8Array {
  const head = ascii(`<< /Length ${value.length} >>\nstream\n`)
  const tail = ascii('\nendstream')
  const result = new Uint8Array(head.length + value.length + tail.length)
  result.set(head)
  result.set(value, head.length)
  result.set(tail, head.length + value.length)
  return result
}

function refsForValues(values: readonly Uint8Array[], global: readonly Uint8Array[], refs: readonly PdfRef[]): PdfRef[] {
  return values.map(function (value) {
    const index = global.findIndex(function (candidate) { return equalBytes(candidate, value) })
    if (index < 0) throw new Error('PDF LTV: VRI value is absent from the DSS collection')
    return refs[index]!
  })
}

function addReferenceArray(fields: string[], key: string, refs: readonly PdfRef[]): void {
  if (refs.length > 0) fields.push(`/${key} [${refs.map(function (ref) { return `${ref.num} ${ref.gen} R` }).join(' ')}]`)
}

function refKey(value: PdfRef): string {
  return `${value.num}:${value.gen}`
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function ascii(value: string): Uint8Array {
  const result = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) result[i] = value.charCodeAt(i)
  return result
}

function pdfDate(value: Date): string {
  const part = function (number: number, width = 2) { return String(number).padStart(width, '0') }
  return `D:${part(value.getUTCFullYear(), 4)}${part(value.getUTCMonth() + 1)}${part(value.getUTCDate())}`
    + `${part(value.getUTCHours())}${part(value.getUTCMinutes())}${part(value.getUTCSeconds())}Z`
}

function parsePdfDate(value: PdfString): Date {
  let text = ''
  for (let i = 0; i < value.bytes.length; i++) text += String.fromCharCode(value.bytes[i]!)
  const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
  if (match === null) throw new Error('PDF LTV: /TU must be a complete UTC PDF date')
  const date = new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
  ))
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])
    || date.getUTCHours() !== Number(match[4]) || date.getUTCMinutes() !== Number(match[5])
    || date.getUTCSeconds() !== Number(match[6])) throw new Error('PDF LTV: invalid /TU calendar value')
  return date
}

/** Computes the VRI key from an exact lexical hexadecimal signature value. */
export function pdfVriKey(hexadecimalSignature: Uint8Array): string {
  const digest = sha1(hexadecimalSignature)
  let result = ''
  for (let i = 0; i < digest.length; i++) result += digest[i]!.toString(16).padStart(2, '0').toUpperCase()
  return result
}
