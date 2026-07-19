import {
  derContextConstructed,
  derInteger,
  derIntegerFromNumber,
  derNull,
  derOctetString,
  derOid,
  derRaw,
  derSequence,
} from './der-encoder.js'

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4'

export type Rfc3161DigestAlgorithm =
  | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | 'RIPEMD-160'
  | 'SHA3-256' | 'SHA3-384' | 'SHA3-512' | 'SHAKE256'

const DIGEST_OIDS: Record<Rfc3161DigestAlgorithm, string> = {
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

const DIGEST_LENGTHS: Record<Rfc3161DigestAlgorithm, number> = {
  'SHA-1': 20,
  'SHA-256': 32,
  'SHA-384': 48,
  'SHA-512': 64,
  'SHA3-256': 32,
  'SHA3-384': 48,
  'SHA3-512': 64,
  'SHAKE256': 64,
  'RIPEMD-160': 20,
}

const DIGEST_BY_OID: Record<string, Rfc3161DigestAlgorithm> = Object.fromEntries(
  Object.entries(DIGEST_OIDS).map(function (entry) { return [entry[1], entry[0]] }),
) as Record<string, Rfc3161DigestAlgorithm>

interface DerValue {
  tag: number
  content: Uint8Array
  raw: Uint8Array
}

export interface Rfc3161Extension {
  oid: string
  critical: boolean
  /** Contents of the Extension extnValue OCTET STRING. */
  value: Uint8Array
}

export interface Rfc3161RequestOptions {
  digestAlgorithm?: Rfc3161DigestAlgorithm
  policy?: string
  nonce?: bigint
  /** Defaults to true because a self-contained PDF timestamp needs the TSA certificate. */
  certReq?: boolean
  extensions?: readonly Rfc3161Extension[]
}

export interface Rfc3161TimestampRequestInfo {
  digestAlgorithm: Rfc3161DigestAlgorithm
  messageImprint: Uint8Array
  policy: string | null
  nonce: bigint | null
  certReq: boolean
  extensions: Rfc3161Extension[]
}

export interface Rfc3161Accuracy {
  seconds: bigint
  millis: number
  micros: number
}

export interface Rfc3161GeneralName {
  /** ASN.1 GeneralName context-specific tag number. */
  tag: number
  /** Complete DER encoding of the GeneralName choice. */
  encoded: Uint8Array
}

export interface Rfc3161TimestampInfo {
  digestAlgorithm: Rfc3161DigestAlgorithm
  messageImprint: Uint8Array
  policy: string
  serialNumber: bigint
  generationTime: Date
  /** Exact DER GeneralizedTime text, preserving precision beyond milliseconds. */
  generationTimeText: string
  /** Fractional-second digits, or null when genTime has second precision. */
  generationTimeFraction: string | null
  accuracy: Rfc3161Accuracy | null
  ordering: boolean
  nonce: bigint | null
  tsa: Rfc3161GeneralName | null
  extensions: Rfc3161Extension[]
  certificatesIncluded: boolean
  encodedTstInfo: Uint8Array
}

/** Builds a DER TimeStampReq for every PDF 2.0 MessageImprint digest. */
export function buildRfc3161TimestampRequest(
  messageImprint: Uint8Array,
  options: Rfc3161RequestOptions = {},
): Uint8Array {
  const digestAlgorithm = options.digestAlgorithm ?? 'SHA-256'
  validateMessageImprintLength(digestAlgorithm, messageImprint)
  if (options.nonce !== undefined && options.nonce < 0n) throw new Error('RFC 3161: nonce must be non-negative')
  const fields: Uint8Array[] = [
    derIntegerFromNumber(1),
    encodeMessageImprint(digestAlgorithm, messageImprint),
  ]
  if (options.policy !== undefined) fields.push(derOid(options.policy))
  if (options.nonce !== undefined) fields.push(derInteger(options.nonce))
  if (options.certReq ?? true) fields.push(derRaw(new Uint8Array([0x01, 0x01, 0xFF])))
  if (options.extensions !== undefined) {
    if (options.extensions.length === 0) throw new Error('RFC 3161: extensions must not be empty')
    fields.push(derContextConstructed(0, ...encodeExtensions(options.extensions)))
  }
  return derSequence(...fields)
}

/** Parses and validates every TimeStampReq field used to correlate a TSA response. */
export function parseRfc3161TimestampRequest(request: Uint8Array): Rfc3161TimestampRequestInfo {
  const sequence = readSingleDer(request)
  if (sequence.tag !== 0x30) throw new Error('RFC 3161: TimeStampReq must be a SEQUENCE')
  const fields = children(sequence)
  if (fields.length < 2) throw new Error('RFC 3161: incomplete TimeStampReq')
  if (decodeNonNegativeInteger(fields[0]!, 'request version') !== 1n) {
    throw new Error('RFC 3161: TimeStampReq version must be 1')
  }
  const imprint = parseMessageImprint(fields[1]!)
  let policy: string | null = null
  let nonce: bigint | null = null
  let certReq = false
  let extensions: Rfc3161Extension[] = []
  let stage = 0
  for (let i = 2; i < fields.length; i++) {
    const field = fields[i]!
    if (field.tag === 0x06 && stage < 1) {
      policy = decodeOidValue(field)
      stage = 1
    } else if (field.tag === 0x02 && stage < 2) {
      nonce = decodeNonNegativeInteger(field, 'nonce')
      stage = 2
    } else if (field.tag === 0x01 && stage < 3) {
      certReq = decodeDerBoolean(field)
      if (!certReq) throw new Error('RFC 3161: DER certReq=false must be omitted')
      stage = 3
    } else if (field.tag === 0xA0 && stage < 4) {
      extensions = parseExtensions(field)
      stage = 4
    } else {
      throw new Error('RFC 3161: invalid or out-of-order TimeStampReq field')
    }
  }
  return { ...imprint, policy, nonce, certReq, extensions }
}

/** Extracts and validates the complete TSTInfo from a TimeStampToken. */
export function parseRfc3161TimestampToken(token: Uint8Array): Rfc3161TimestampInfo {
  const contentInfo = readPdfContentsDer(token)
  if (contentInfo.tag !== 0x30) throw new Error('RFC 3161: TimeStampToken ContentInfo must be a SEQUENCE')
  const contentInfoChildren = children(contentInfo)
  if (contentInfoChildren.length !== 2 || decodeOidValue(contentInfoChildren[0]!) !== OID_SIGNED_DATA) {
    throw new Error('RFC 3161: TimeStampToken content type must be SignedData')
  }
  if (contentInfoChildren[1]!.tag !== 0xA0) throw new Error('RFC 3161: invalid SignedData wrapper')
  const signedDataWrapper = children(contentInfoChildren[1]!)
  if (signedDataWrapper.length !== 1 || signedDataWrapper[0]!.tag !== 0x30) {
    throw new Error('RFC 3161: invalid SignedData wrapper')
  }
  const signedData = children(signedDataWrapper[0]!)
  if (signedData.length < 4) throw new Error('RFC 3161: incomplete SignedData')
  const encapContentInfo = children(signedData[2]!)
  if (encapContentInfo.length !== 2 || decodeOidValue(encapContentInfo[0]!) !== OID_TST_INFO) {
    throw new Error('RFC 3161: SignedData content type must be id-ct-TSTInfo')
  }
  if (encapContentInfo[1]!.tag !== 0xA0) throw new Error('RFC 3161: invalid TSTInfo wrapper')
  const explicitContent = children(encapContentInfo[1]!)
  if (explicitContent.length !== 1 || explicitContent[0]!.tag !== 0x04) {
    throw new Error('RFC 3161: TSTInfo must be wrapped in an OCTET STRING')
  }
  const encodedTstInfo = explicitContent[0]!.content
  const tstInfo = readSingleDer(encodedTstInfo)
  if (tstInfo.tag !== 0x30) throw new Error('RFC 3161: TSTInfo must be a SEQUENCE')
  const tstFields = children(tstInfo)
  if (tstFields.length < 5) throw new Error('RFC 3161: incomplete TSTInfo')
  if (decodeNonNegativeInteger(tstFields[0]!, 'TSTInfo version') !== 1n) {
    throw new Error('RFC 3161: TSTInfo version must be 1')
  }
  const policy = decodeOidValue(tstFields[1]!)
  const imprint = parseMessageImprint(tstFields[2]!)
  const serialNumber = decodeNonNegativeInteger(tstFields[3]!, 'serialNumber')
  const generalizedTime = parseGeneralizedTime(tstFields[4]!)
  let accuracy: Rfc3161Accuracy | null = null
  let ordering = false
  let nonce: bigint | null = null
  let tsa: Rfc3161GeneralName | null = null
  let extensions: Rfc3161Extension[] = []
  let stage = 0
  for (let i = 5; i < tstFields.length; i++) {
    const field = tstFields[i]!
    if (field.tag === 0x30 && stage < 1) {
      accuracy = parseAccuracy(field)
      stage = 1
    } else if (field.tag === 0x01 && stage < 2) {
      ordering = decodeDerBoolean(field)
      if (!ordering) throw new Error('RFC 3161: DER ordering=false must be omitted')
      stage = 2
    } else if (field.tag === 0x02 && stage < 3) {
      nonce = decodeNonNegativeInteger(field, 'nonce')
      stage = 3
    } else if (field.tag === 0xA0 && stage < 4) {
      tsa = parseTsaName(field)
      stage = 4
    } else if (field.tag === 0xA1 && stage < 5) {
      extensions = parseExtensions(field)
      stage = 5
    } else {
      throw new Error('RFC 3161: invalid or out-of-order TSTInfo field')
    }
  }
  const certificatesIncluded = signedData.slice(3).some(function (field) { return field.tag === 0xA0 })
  return {
    ...imprint,
    policy,
    serialNumber,
    generationTime: generalizedTime.date,
    generationTimeText: generalizedTime.text,
    generationTimeFraction: generalizedTime.fraction,
    accuracy,
    ordering,
    nonce,
    tsa,
    extensions,
    certificatesIncluded,
    encodedTstInfo,
  }
}

function encodeMessageImprint(algorithm: Rfc3161DigestAlgorithm, value: Uint8Array): Uint8Array {
  return derSequence(
    derSequence(derOid(DIGEST_OIDS[algorithm]), derNull()),
    derOctetString(value),
  )
}

function parseMessageImprint(value: DerValue): Pick<Rfc3161TimestampRequestInfo, 'digestAlgorithm' | 'messageImprint'> {
  if (value.tag !== 0x30) throw new Error('RFC 3161: MessageImprint must be a SEQUENCE')
  const fields = children(value)
  if (fields.length !== 2 || fields[1]!.tag !== 0x04) throw new Error('RFC 3161: invalid MessageImprint')
  const algorithmIdentifier = children(fields[0]!)
  if (fields[0]!.tag !== 0x30 || algorithmIdentifier.length < 1 || algorithmIdentifier.length > 2) {
    throw new Error('RFC 3161: invalid MessageImprint digest AlgorithmIdentifier')
  }
  if (algorithmIdentifier.length === 2
    && (algorithmIdentifier[1]!.tag !== 0x05 || algorithmIdentifier[1]!.content.length !== 0)) {
    throw new Error('RFC 3161: MessageImprint digest parameters must be NULL or absent')
  }
  const oid = decodeOidValue(algorithmIdentifier[0]!)
  const digestAlgorithm = DIGEST_BY_OID[oid]
  if (digestAlgorithm === undefined) throw new Error(`RFC 3161: unsupported MessageImprint digest algorithm ${oid}`)
  validateMessageImprintLength(digestAlgorithm, fields[1]!.content)
  return { digestAlgorithm, messageImprint: fields[1]!.content }
}

function validateMessageImprintLength(algorithm: Rfc3161DigestAlgorithm, value: Uint8Array): void {
  const expected = DIGEST_LENGTHS[algorithm]
  if (value.length !== expected) throw new Error(`RFC 3161: ${algorithm} message imprint must be ${expected} bytes`)
}

function encodeExtensions(extensions: readonly Rfc3161Extension[]): Uint8Array[] {
  const seen = new Set<string>()
  return extensions.map(function (extension) {
    if (seen.has(extension.oid)) throw new Error(`RFC 3161: duplicate extension ${extension.oid}`)
    seen.add(extension.oid)
    return derSequence(
      derOid(extension.oid),
      ...(extension.critical ? [derRaw(new Uint8Array([0x01, 0x01, 0xFF]))] : []),
      derOctetString(extension.value),
    )
  })
}

function parseExtensions(wrapper: DerValue): Rfc3161Extension[] {
  const encodedExtensions = children(wrapper)
  if (encodedExtensions.length === 0) throw new Error('RFC 3161: extensions must not be empty')
  const result: Rfc3161Extension[] = []
  const seen = new Set<string>()
  for (let i = 0; i < encodedExtensions.length; i++) {
    const extension = encodedExtensions[i]!
    if (extension.tag !== 0x30) throw new Error('RFC 3161: Extension must be a SEQUENCE')
    const fields = children(extension)
    if (fields.length < 2 || fields.length > 3) throw new Error('RFC 3161: invalid Extension')
    const oid = decodeOidValue(fields[0]!)
    if (seen.has(oid)) throw new Error(`RFC 3161: duplicate extension ${oid}`)
    seen.add(oid)
    let critical = false
    let valueIndex = 1
    if (fields[1]!.tag === 0x01) {
      critical = decodeDerBoolean(fields[1]!)
      if (!critical) throw new Error('RFC 3161: DER critical=false must be omitted')
      valueIndex = 2
    }
    if (fields.length !== valueIndex + 1 || fields[valueIndex]!.tag !== 0x04) {
      throw new Error('RFC 3161: Extension extnValue must be an OCTET STRING')
    }
    result.push({ oid, critical, value: fields[valueIndex]!.content })
  }
  return result
}

function parseAccuracy(value: DerValue): Rfc3161Accuracy {
  const fields = children(value)
  let seconds = 0n
  let millis = 0
  let micros = 0
  let stage = 0
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (field.tag === 0x02 && stage < 1) {
      seconds = decodeNonNegativeInteger(field, 'accuracy seconds')
      stage = 1
    } else if (field.tag === 0x80 && stage < 2) {
      millis = decodeBoundedImplicitInteger(field, 'accuracy millis')
      stage = 2
    } else if (field.tag === 0x81 && stage < 3) {
      micros = decodeBoundedImplicitInteger(field, 'accuracy micros')
      stage = 3
    } else {
      throw new Error('RFC 3161: invalid or out-of-order Accuracy field')
    }
  }
  return { seconds, millis, micros }
}

function decodeBoundedImplicitInteger(value: DerValue, label: string): number {
  const integer = decodeNonNegativeIntegerContent(value.content, label)
  if (integer < 1n || integer > 999n) throw new Error(`RFC 3161: ${label} must be between 1 and 999`)
  return Number(integer)
}

function parseTsaName(value: DerValue): Rfc3161GeneralName {
  const names = children(value)
  if (names.length !== 1) throw new Error('RFC 3161: tsa must contain one GeneralName')
  const name = names[0]!
  const tag = name.tag & 0x1F
  if ((name.tag & 0xC0) !== 0x80 || tag > 8) throw new Error('RFC 3161: invalid tsa GeneralName')
  return { tag, encoded: name.raw }
}

function readSingleDer(data: Uint8Array): DerValue {
  const parsed = readDer(data, 0)
  if (parsed.next !== data.length) throw new Error('RFC 3161: trailing data after DER value')
  return parsed.value
}

function readPdfContentsDer(data: Uint8Array): DerValue {
  const parsed = readDer(data, 0)
  for (let i = parsed.next; i < data.length; i++) {
    if (data[i] !== 0) throw new Error('RFC 3161: trailing data after DER value')
  }
  return parsed.value
}

function readDer(data: Uint8Array, offset: number): { value: DerValue, next: number } {
  if (offset + 2 > data.length) throw new Error('RFC 3161: truncated DER value')
  const tag = data[offset]!
  let position = offset + 1
  let length = data[position]!
  position++
  if ((length & 0x80) !== 0) {
    const count = length & 0x7F
    if (count === 0 || count > 4 || position + count > data.length) throw new Error('RFC 3161: invalid DER length')
    if (data[position] === 0) throw new Error('RFC 3161: non-minimal DER length')
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + data[position + i]!
    position += count
    if (length < 0x80) throw new Error('RFC 3161: non-minimal DER length')
  }
  const end = position + length
  if (end > data.length) throw new Error('RFC 3161: DER value exceeds input')
  return {
    value: { tag, content: data.subarray(position, end), raw: data.subarray(offset, end) },
    next: end,
  }
}

function children(value: DerValue): DerValue[] {
  const result: DerValue[] = []
  let offset = 0
  while (offset < value.content.length) {
    const parsed = readDer(value.content, offset)
    result.push(parsed.value)
    offset = parsed.next
  }
  return result
}

function decodeOidValue(value: DerValue): string {
  if (value.tag !== 0x06 || value.content.length === 0) throw new Error('RFC 3161: expected an object identifier')
  const subidentifiers: number[] = []
  let current = 0
  let firstByte = true
  for (let i = 0; i < value.content.length; i++) {
    const byte = value.content[i]!
    if (firstByte && byte === 0x80) throw new Error('RFC 3161: non-minimal object identifier')
    current = current * 128 + (byte & 0x7F)
    if (!Number.isSafeInteger(current)) throw new Error('RFC 3161: object identifier component is too large')
    if ((byte & 0x80) === 0) {
      subidentifiers.push(current)
      current = 0
      firstByte = true
    } else {
      firstByte = false
    }
  }
  if (!firstByte) throw new Error('RFC 3161: truncated object identifier')
  const first = subidentifiers.shift()!
  const firstArc = first < 40 ? 0 : first < 80 ? 1 : 2
  return [firstArc, first - firstArc * 40, ...subidentifiers].join('.')
}

function decodeNonNegativeInteger(value: DerValue, label: string): bigint {
  if (value.tag !== 0x02) throw new Error(`RFC 3161: ${label} must be an INTEGER`)
  return decodeNonNegativeIntegerContent(value.content, label)
}

function decodeNonNegativeIntegerContent(content: Uint8Array, label: string): bigint {
  if (content.length === 0 || (content[0]! & 0x80) !== 0) throw new Error(`RFC 3161: ${label} must be non-negative`)
  if (content.length > 1 && content[0] === 0 && (content[1]! & 0x80) === 0) {
    throw new Error(`RFC 3161: ${label} has a non-minimal INTEGER encoding`)
  }
  let result = 0n
  for (let i = 0; i < content.length; i++) result = (result << 8n) | BigInt(content[i]!)
  return result
}

function decodeDerBoolean(value: DerValue): boolean {
  if (value.tag !== 0x01 || value.content.length !== 1 || (value.content[0] !== 0 && value.content[0] !== 0xFF)) {
    throw new Error('RFC 3161: invalid DER BOOLEAN')
  }
  return value.content[0] === 0xFF
}

function parseGeneralizedTime(value: DerValue): { date: Date, text: string, fraction: string | null } {
  if (value.tag !== 0x18) throw new Error('RFC 3161: genTime must be GeneralizedTime')
  let text = ''
  for (let i = 0; i < value.content.length; i++) {
    const byte = value.content[i]!
    if (byte > 0x7F) throw new Error('RFC 3161: invalid genTime character')
    text += String.fromCharCode(byte)
  }
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d*[1-9]))?Z$/.exec(text)
  if (match === null) throw new Error('RFC 3161: invalid DER genTime encoding')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new Error('RFC 3161: invalid genTime calendar value')
  }
  const fraction = match[7] ?? null
  const milliseconds = fraction === null ? 0 : Number((fraction + '000').slice(0, 3))
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, milliseconds))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    throw new Error('RFC 3161: invalid genTime calendar value')
  }
  return { date, text, fraction }
}
