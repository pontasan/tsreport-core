import { PdfDocument, PdfName, PdfString, type PdfDict, type PdfValue } from './pdf-parser.js'

export type PdfSignatureFieldSelection =
  | { action: 'All' }
  | { action: 'Include' | 'Exclude'; fields: string[] }

export type PdfSignatureFieldLock = PdfSignatureFieldSelection & {
  /** Lock dictionary permission introduced by PDF 2.0. */
  permission?: 1 | 2 | 3
}

export type PdfSignatureSeedConstraint =
  | 'Filter'
  | 'SubFilter'
  | 'V'
  | 'Reasons'
  | 'LegalAttestation'
  | 'AddRevInfo'
  | 'DigestMethod'

export type PdfCertificateSeedConstraint =
  | 'Subject'
  | 'Issuer'
  | 'OID'
  | 'SubjectDN'
  | 'KeyUsage'
  | 'URL'

export interface PdfCertificateSeedValue {
  required?: PdfCertificateSeedConstraint[]
  subjectCertificates?: Uint8Array[]
  subjectDN?: Array<Record<string, string>>
  keyUsage?: string[]
  issuerCertificates?: Uint8Array[]
  policyOids?: string[]
  url?: string
  urlType?: string
  /** PDF 2.0 signature-policy commitment type identifiers. */
  signaturePolicyCommitmentTypes?: string[]
}

export interface PdfSignatureSeedValue {
  required?: PdfSignatureSeedConstraint[]
  filter?: string
  subFilters?: string[]
  digestMethods?: Array<'SHA1' | 'SHA256' | 'SHA384' | 'SHA512' | 'RIPEMD160' | 'SHA3-256' | 'SHA3-384' | 'SHA3-512' | 'SHAKE256'>
  /** 1/2 are defined by PDF 1.5/1.7; 3 denotes PDF 2.0 capability. */
  version?: 1 | 2 | 3
  certificate?: PdfCertificateSeedValue
  reasons?: string[]
  mdpPermission?: 0 | 1 | 2 | 3
  timestamp?: { url: string; required?: boolean }
  legalAttestations?: string[]
  addRevInfo?: boolean
}

export interface PdfUsageRights {
  document?: Array<'FullSave'>
  message?: string
  annotations?: Array<'Create' | 'Delete' | 'Modify' | 'Copy' | 'Import' | 'Export' | 'Online' | 'SummaryView'>
  form?: Array<'FillIn' | 'Import' | 'Export' | 'SubmitStandalone' | 'SpawnTemplate' | 'BarcodePlaintext' | 'Online'>
  formEx?: Array<'BarcodePlaintext'>
  signature?: Array<'Modify'>
  embeddedFiles?: Array<'Create' | 'Delete' | 'Modify' | 'Import'>
  restrictOtherHandlers?: boolean
}

const SEED_FLAG: Record<PdfSignatureSeedConstraint, number> = {
  Filter: 1 << 0,
  SubFilter: 1 << 1,
  V: 1 << 2,
  Reasons: 1 << 3,
  LegalAttestation: 1 << 4,
  AddRevInfo: 1 << 5,
  DigestMethod: 1 << 6,
}

const CERTIFICATE_FLAG: Record<PdfCertificateSeedConstraint, number> = {
  Subject: 1 << 0,
  Issuer: 1 << 1,
  OID: 1 << 2,
  SubjectDN: 1 << 3,
  KeyUsage: 1 << 5,
  URL: 1 << 6,
}

function flags<T extends string>(values: readonly T[] | undefined, bits: Record<T, number>): number {
  let result = 0
  if (values === undefined) return result
  for (let i = 0; i < values.length; i++) result |= bits[values[i]!]!
  return result
}

function requiredFromFlags<T extends string>(value: number, ordered: readonly T[], bits: Record<T, number>): T[] {
  const result: T[] = []
  for (let i = 0; i < ordered.length; i++) if ((value & bits[ordered[i]!]!) !== 0) result.push(ordered[i]!)
  return result
}

function textString(value: string): PdfString {
  const bytes = new Uint8Array(2 + value.length * 2)
  bytes[0] = 0xfe
  bytes[1] = 0xff
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    bytes[2 + i * 2] = code >>> 8
    bytes[3 + i * 2] = code & 0xff
  }
  return new PdfString(bytes)
}

function asciiString(value: string): PdfString {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7f) throw new Error('pdf-signature-policy: ASCII string contains a non-ASCII character')
  }
  return new PdfString(new TextEncoder().encode(value))
}

function textArray(values: readonly string[]): PdfValue[] {
  return values.map(textString)
}

function nameArray(values: readonly string[]): PdfValue[] {
  return values.map(function (value) { return new PdfName(value) })
}

export function buildPdfSignatureFieldLock(value: PdfSignatureFieldLock): PdfDict {
  const dictionary: PdfDict = new Map()
  dictionary.set('Type', new PdfName('SigFieldLock'))
  dictionary.set('Action', new PdfName(value.action))
  if (value.action !== 'All') {
    if (value.fields.length === 0) throw new Error('pdf-signature-policy: Include/Exclude lock requires at least one field')
    dictionary.set('Fields', textArray(value.fields))
  }
  if (value.permission !== undefined) dictionary.set('P', value.permission)
  return dictionary
}

export function buildPdfCertificateSeedValue(value: PdfCertificateSeedValue): PdfDict {
  const dictionary: PdfDict = new Map()
  dictionary.set('Type', new PdfName('SVCert'))
  const ff = flags(value.required, CERTIFICATE_FLAG)
  if (ff !== 0) dictionary.set('Ff', ff)
  if (value.subjectCertificates !== undefined) dictionary.set('Subject', value.subjectCertificates.map(function (entry) { return new PdfString(entry) }))
  if (value.subjectDN !== undefined) {
    dictionary.set('SubjectDN', value.subjectDN.map(function (entry) {
      const dn: PdfDict = new Map()
      for (const [key, field] of Object.entries(entry)) {
        if (!/^[A-Za-z0-9.]+$/.test(key)) throw new Error(`pdf-signature-policy: invalid SubjectDN key ${key}`)
        dn.set(key, textString(field))
      }
      return dn
    }))
  }
  if (value.keyUsage !== undefined) {
    for (let i = 0; i < value.keyUsage.length; i++) {
      if (!/^[01X]{1,9}$/.test(value.keyUsage[i]!)) throw new Error('pdf-signature-policy: KeyUsage strings must contain 1-9 characters from 0, 1, and X')
    }
    dictionary.set('KeyUsage', value.keyUsage.map(asciiString))
  }
  if (value.issuerCertificates !== undefined) dictionary.set('Issuer', value.issuerCertificates.map(function (entry) { return new PdfString(entry) }))
  if (value.policyOids !== undefined) dictionary.set('OID', value.policyOids.map(asciiString))
  if (value.url !== undefined) dictionary.set('URL', asciiString(value.url))
  if (value.urlType !== undefined) dictionary.set('URLType', new PdfName(value.urlType))
  if (value.signaturePolicyCommitmentTypes !== undefined) dictionary.set('SignaturePolicyCommitmentType', value.signaturePolicyCommitmentTypes.map(asciiString))
  return dictionary
}

export function buildPdfSignatureSeedValue(value: PdfSignatureSeedValue): PdfDict {
  const dictionary: PdfDict = new Map()
  dictionary.set('Type', new PdfName('SV'))
  const ff = flags(value.required, SEED_FLAG)
  if (ff !== 0) dictionary.set('Ff', ff)
  if (value.filter !== undefined) dictionary.set('Filter', new PdfName(value.filter))
  if (value.subFilters !== undefined) dictionary.set('SubFilter', nameArray(value.subFilters))
  if (value.digestMethods !== undefined) dictionary.set('DigestMethod', nameArray(value.digestMethods))
  if (value.version !== undefined) dictionary.set('V', value.version)
  if (value.certificate !== undefined) dictionary.set('Cert', buildPdfCertificateSeedValue(value.certificate))
  if (value.reasons !== undefined) dictionary.set('Reasons', textArray(value.reasons))
  if (value.mdpPermission !== undefined) dictionary.set('MDP', new Map<string, PdfValue>([['P', value.mdpPermission]]))
  if (value.timestamp !== undefined) {
    dictionary.set('TimeStamp', new Map<string, PdfValue>([
      ['URL', asciiString(value.timestamp.url)],
      ['Ff', value.timestamp.required === true ? 1 : 0],
    ]))
  }
  if (value.legalAttestations !== undefined) dictionary.set('LegalAttestation', textArray(value.legalAttestations))
  if (value.addRevInfo !== undefined) dictionary.set('AddRevInfo', value.addRevInfo)
  return dictionary
}

export function buildPdfUsageRights(value: PdfUsageRights): PdfDict {
  const dictionary: PdfDict = new Map()
  dictionary.set('Type', new PdfName('TransformParams'))
  dictionary.set('V', new PdfName('2.2'))
  if (value.document !== undefined) dictionary.set('Document', nameArray(value.document))
  if (value.message !== undefined) dictionary.set('Msg', textString(value.message))
  if (value.annotations !== undefined) dictionary.set('Annots', nameArray(value.annotations))
  if (value.form !== undefined) dictionary.set('Form', nameArray(value.form))
  if (value.formEx !== undefined) dictionary.set('FormEx', nameArray(value.formEx))
  if (value.signature !== undefined) dictionary.set('Signature', nameArray(value.signature))
  if (value.embeddedFiles !== undefined) dictionary.set('EF', nameArray(value.embeddedFiles))
  if (value.restrictOtherHandlers !== undefined) dictionary.set('P', value.restrictOtherHandlers)
  return dictionary
}

type StringDecoder = (value: PdfString) => string

function optionalType(doc: PdfDocument, dictionary: PdfDict, expected: string, label: string): void {
  const type = doc.resolve(dictionary.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== expected)) {
    throw new Error(`${label} /Type must be /${expected}`)
  }
}

function dictionaryValue(doc: PdfDocument, value: PdfValue, label: string): PdfDict {
  const resolved = doc.resolve(value)
  if (!(resolved instanceof Map)) throw new Error(`${label} must be a dictionary`)
  return resolved
}

function integerValue(doc: PdfDocument, dictionary: PdfDict, key: string, defaultValue: number, label: string): number {
  const value = doc.resolve(dictionary.get(key) ?? defaultValue)
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${label} /${key} must be an integer`)
  return value
}

function optionalTextArray(doc: PdfDocument, dictionary: PdfDict, key: string, decode: StringDecoder, label: string): string[] | undefined {
  if (!dictionary.has(key)) return undefined
  const value = doc.resolve(dictionary.get(key)!)
  if (!Array.isArray(value)) throw new Error(`${label} /${key} must be an array`)
  return value.map(function (entry) {
    const resolved = doc.resolve(entry)
    if (!(resolved instanceof PdfString)) throw new Error(`${label} /${key} entries must be strings`)
    return decode(resolved)
  })
}

function optionalNameArray(doc: PdfDocument, dictionary: PdfDict, key: string, label: string): string[] | undefined {
  if (!dictionary.has(key)) return undefined
  const value = doc.resolve(dictionary.get(key)!)
  if (!Array.isArray(value)) throw new Error(`${label} /${key} must be an array`)
  return value.map(function (entry) {
    const resolved = doc.resolve(entry)
    if (!(resolved instanceof PdfName)) throw new Error(`${label} /${key} entries must be names`)
    return resolved.name
  })
}

function optionalByteArray(doc: PdfDocument, dictionary: PdfDict, key: string, label: string): Uint8Array[] | undefined {
  if (!dictionary.has(key)) return undefined
  const value = doc.resolve(dictionary.get(key)!)
  if (!Array.isArray(value)) throw new Error(`${label} /${key} must be an array`)
  return value.map(function (entry) {
    const resolved = doc.resolve(entry)
    if (!(resolved instanceof PdfString)) throw new Error(`${label} /${key} entries must be strings`)
    return resolved.bytes
  })
}

export function parsePdfSignatureFieldLock(doc: PdfDocument, value: PdfValue, decode: StringDecoder): PdfSignatureFieldLock {
  const dictionary = dictionaryValue(doc, value, 'PDF signature field lock')
  optionalType(doc, dictionary, 'SigFieldLock', 'PDF signature field lock')
  const actionValue = doc.resolve(dictionary.get('Action') ?? null)
  if (!(actionValue instanceof PdfName) || (actionValue.name !== 'All' && actionValue.name !== 'Include' && actionValue.name !== 'Exclude')) {
    throw new Error('PDF signature field lock /Action must be /All, /Include, or /Exclude')
  }
  const permissionValue = dictionary.has('P') ? integerValue(doc, dictionary, 'P', 0, 'PDF signature field lock') : undefined
  if (permissionValue !== undefined && (permissionValue < 1 || permissionValue > 3)) throw new Error('PDF signature field lock /P must be 1, 2, or 3')
  if (actionValue.name === 'All') {
    return permissionValue === undefined ? { action: 'All' } : { action: 'All', permission: permissionValue as 1 | 2 | 3 }
  }
  const fields = optionalTextArray(doc, dictionary, 'Fields', decode, 'PDF signature field lock')
  if (fields === undefined || fields.length === 0) throw new Error('PDF signature field lock /Fields is required for /Include and /Exclude')
  return permissionValue === undefined
    ? { action: actionValue.name, fields }
    : { action: actionValue.name, fields, permission: permissionValue as 1 | 2 | 3 }
}

export function parsePdfCertificateSeedValue(doc: PdfDocument, value: PdfValue, decode: StringDecoder): PdfCertificateSeedValue {
  const dictionary = dictionaryValue(doc, value, 'PDF certificate seed value')
  optionalType(doc, dictionary, 'SVCert', 'PDF certificate seed value')
  const ff = integerValue(doc, dictionary, 'Ff', 0, 'PDF certificate seed value')
  if ((ff & ~0x6f) !== 0) throw new Error('PDF certificate seed value /Ff contains a reserved flag')
  const result: PdfCertificateSeedValue = {
    required: requiredFromFlags(ff, ['Subject', 'Issuer', 'OID', 'SubjectDN', 'KeyUsage', 'URL'], CERTIFICATE_FLAG),
  }
  result.subjectCertificates = optionalByteArray(doc, dictionary, 'Subject', 'PDF certificate seed value')
  result.issuerCertificates = optionalByteArray(doc, dictionary, 'Issuer', 'PDF certificate seed value')
  const oidBytes = optionalByteArray(doc, dictionary, 'OID', 'PDF certificate seed value')
  if (oidBytes !== undefined) result.policyOids = oidBytes.map(function (entry) { return decode(new PdfString(entry)) })
  result.keyUsage = optionalTextArray(doc, dictionary, 'KeyUsage', decode, 'PDF certificate seed value')
  if (result.keyUsage !== undefined) {
    for (let i = 0; i < result.keyUsage.length; i++) if (!/^[01X]{1,9}$/.test(result.keyUsage[i]!)) throw new Error('PDF certificate seed value /KeyUsage is invalid')
  }
  if (dictionary.has('SubjectDN')) {
    const values = doc.resolve(dictionary.get('SubjectDN')!)
    if (!Array.isArray(values)) throw new Error('PDF certificate seed value /SubjectDN must be an array')
    result.subjectDN = values.map(function (entry) {
      const dn = dictionaryValue(doc, entry, 'PDF certificate seed value /SubjectDN entry')
      const object: Record<string, string> = {}
      for (const [key, field] of dn) {
        const resolved = doc.resolve(field)
        if (!(resolved instanceof PdfString)) throw new Error('PDF certificate seed value /SubjectDN values must be strings')
        object[key] = decode(resolved)
      }
      return object
    })
  }
  if (dictionary.has('URL')) {
    const url = doc.resolve(dictionary.get('URL')!)
    if (!(url instanceof PdfString)) throw new Error('PDF certificate seed value /URL must be a string')
    result.url = decode(url)
  }
  if (dictionary.has('URLType')) {
    const urlType = doc.resolve(dictionary.get('URLType')!)
    if (!(urlType instanceof PdfName)) throw new Error('PDF certificate seed value /URLType must be a name')
    result.urlType = urlType.name
  }
  result.signaturePolicyCommitmentTypes = optionalTextArray(doc, dictionary, 'SignaturePolicyCommitmentType', decode, 'PDF certificate seed value')
  return result
}

export function parsePdfSignatureSeedValue(doc: PdfDocument, value: PdfValue, decode: StringDecoder): PdfSignatureSeedValue {
  const dictionary = dictionaryValue(doc, value, 'PDF signature seed value')
  optionalType(doc, dictionary, 'SV', 'PDF signature seed value')
  const ff = integerValue(doc, dictionary, 'Ff', 0, 'PDF signature seed value')
  if ((ff & ~0x7f) !== 0) throw new Error('PDF signature seed value /Ff contains a reserved flag')
  const result: PdfSignatureSeedValue = {
    required: requiredFromFlags(ff, ['Filter', 'SubFilter', 'V', 'Reasons', 'LegalAttestation', 'AddRevInfo', 'DigestMethod'], SEED_FLAG),
  }
  if (dictionary.has('Filter')) {
    const filter = doc.resolve(dictionary.get('Filter')!)
    if (!(filter instanceof PdfName)) throw new Error('PDF signature seed value /Filter must be a name')
    result.filter = filter.name
  }
  result.subFilters = optionalNameArray(doc, dictionary, 'SubFilter', 'PDF signature seed value')
  const digestMethods = optionalNameArray(doc, dictionary, 'DigestMethod', 'PDF signature seed value')
  if (digestMethods !== undefined) {
    for (let i = 0; i < digestMethods.length; i++) {
      if (!['SHA1', 'SHA256', 'SHA384', 'SHA512', 'RIPEMD160', 'SHA3-256', 'SHA3-384', 'SHA3-512', 'SHAKE256'].includes(digestMethods[i]!)) throw new Error('PDF signature seed value /DigestMethod contains an invalid name')
    }
    result.digestMethods = digestMethods as PdfSignatureSeedValue['digestMethods']
  }
  if (dictionary.has('V')) {
    const version = doc.resolve(dictionary.get('V')!)
    if (version !== 1 && version !== 2 && version !== 3) throw new Error('PDF signature seed value /V must be 1, 2, or 3')
    result.version = version
  }
  if (dictionary.has('Cert')) result.certificate = parsePdfCertificateSeedValue(doc, dictionary.get('Cert')!, decode)
  result.reasons = optionalTextArray(doc, dictionary, 'Reasons', decode, 'PDF signature seed value')
  if (dictionary.has('MDP')) {
    const mdp = dictionaryValue(doc, dictionary.get('MDP')!, 'PDF signature seed value /MDP')
    const permission = integerValue(doc, mdp, 'P', -1, 'PDF signature seed value /MDP')
    if (permission < 0 || permission > 3) throw new Error('PDF signature seed value /MDP /P must be 0, 1, 2, or 3')
    result.mdpPermission = permission as 0 | 1 | 2 | 3
  }
  if (dictionary.has('TimeStamp')) {
    const timestamp = dictionaryValue(doc, dictionary.get('TimeStamp')!, 'PDF signature seed value /TimeStamp')
    const url = doc.resolve(timestamp.get('URL') ?? null)
    if (!(url instanceof PdfString)) throw new Error('PDF signature seed value /TimeStamp /URL must be a string')
    const timestampFlags = integerValue(doc, timestamp, 'Ff', 0, 'PDF signature seed value /TimeStamp')
    if (timestampFlags !== 0 && timestampFlags !== 1) throw new Error('PDF signature seed value /TimeStamp /Ff must be 0 or 1')
    result.timestamp = { url: decode(url), required: timestampFlags === 1 }
  }
  result.legalAttestations = optionalTextArray(doc, dictionary, 'LegalAttestation', decode, 'PDF signature seed value')
  if (dictionary.has('AddRevInfo')) {
    const addRevInfo = doc.resolve(dictionary.get('AddRevInfo')!)
    if (typeof addRevInfo !== 'boolean') throw new Error('PDF signature seed value /AddRevInfo must be boolean')
    result.addRevInfo = addRevInfo
  }
  return result
}

export function parsePdfUsageRights(doc: PdfDocument, value: PdfValue, decode: StringDecoder): PdfUsageRights {
  const dictionary = dictionaryValue(doc, value, 'PDF usage-rights transform parameters')
  optionalType(doc, dictionary, 'TransformParams', 'PDF usage-rights transform parameters')
  const version = doc.resolve(dictionary.get('V') ?? new PdfName('2.2'))
  if (!(version instanceof PdfName) || version.name !== '2.2') throw new Error('PDF usage-rights transform parameters /V must be /2.2')
  const result: PdfUsageRights = {}
  result.document = optionalNameArray(doc, dictionary, 'Document', 'PDF usage-rights transform parameters') as PdfUsageRights['document']
  if (dictionary.has('Msg')) {
    const message = doc.resolve(dictionary.get('Msg')!)
    if (!(message instanceof PdfString)) throw new Error('PDF usage-rights transform parameters /Msg must be a string')
    result.message = decode(message)
  }
  result.annotations = optionalNameArray(doc, dictionary, 'Annots', 'PDF usage-rights transform parameters') as PdfUsageRights['annotations']
  result.form = optionalNameArray(doc, dictionary, 'Form', 'PDF usage-rights transform parameters') as PdfUsageRights['form']
  result.formEx = optionalNameArray(doc, dictionary, 'FormEx', 'PDF usage-rights transform parameters') as PdfUsageRights['formEx']
  result.signature = optionalNameArray(doc, dictionary, 'Signature', 'PDF usage-rights transform parameters') as PdfUsageRights['signature']
  result.embeddedFiles = optionalNameArray(doc, dictionary, 'EF', 'PDF usage-rights transform parameters') as PdfUsageRights['embeddedFiles']
  if (dictionary.has('P')) {
    const restrict = doc.resolve(dictionary.get('P')!)
    if (typeof restrict !== 'boolean') throw new Error('PDF usage-rights transform parameters /P must be boolean')
    result.restrictOtherHandlers = restrict
  }
  validateNames(result.document, ['FullSave'], 'Document')
  validateNames(result.annotations, ['Create', 'Delete', 'Modify', 'Copy', 'Import', 'Export', 'Online', 'SummaryView'], 'Annots')
  validateNames(result.form, ['FillIn', 'Import', 'Export', 'SubmitStandalone', 'SpawnTemplate', 'BarcodePlaintext', 'Online'], 'Form')
  validateNames(result.formEx, ['BarcodePlaintext'], 'FormEx')
  validateNames(result.signature, ['Modify'], 'Signature')
  validateNames(result.embeddedFiles, ['Create', 'Delete', 'Modify', 'Import'], 'EF')
  return result
}

function validateNames(values: readonly string[] | undefined, allowed: readonly string[], key: string): void {
  if (values === undefined) return
  for (let i = 0; i < values.length; i++) {
    if (!allowed.includes(values[i]!)) throw new Error(`PDF usage-rights transform parameters /${key} contains invalid name /${values[i]}`)
  }
}

export function samePdfSignatureFieldSelection(a: PdfSignatureFieldSelection, b: PdfSignatureFieldSelection): boolean {
  if (a.action !== b.action) return false
  if (a.action === 'All' || b.action === 'All') return true
  if (a.fields.length !== b.fields.length) return false
  for (let i = 0; i < a.fields.length; i++) if (a.fields[i] !== b.fields[i]) return false
  return true
}
