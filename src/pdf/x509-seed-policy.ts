export interface X509SeedFacts {
  raw: Uint8Array
  issuerRaw: Uint8Array
  subjectRaw: Uint8Array
  subjectAttributes: ReadonlyMap<string, readonly string[]>
  keyUsage: readonly boolean[] | null
  certificatePolicyOids: readonly string[]
}

interface DerValue {
  tag: number
  content: Uint8Array
  raw: Uint8Array
}

function readDer(data: Uint8Array, start: number): { value: DerValue; next: number } {
  if (start >= data.length) throw new Error('X.509 seed policy: truncated DER value')
  const tag = data[start]!
  let offset = start + 1
  if (offset >= data.length) throw new Error('X.509 seed policy: truncated DER length')
  let length = data[offset++]!
  if ((length & 0x80) !== 0) {
    const count = length & 0x7f
    if (count === 0 || count > 4 || offset + count > data.length) throw new Error('X.509 seed policy: invalid DER length')
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + data[offset++]!
  }
  if (offset + length > data.length) throw new Error('X.509 seed policy: truncated DER content')
  return {
    value: { tag, content: data.subarray(offset, offset + length), raw: data.subarray(start, offset + length) },
    next: offset + length,
  }
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

function oid(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new Error('X.509 seed policy: empty OID')
  const result = [Math.floor(bytes[0]! / 40), bytes[0]! % 40]
  let value = 0
  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i]! & 0x7f)
    if ((bytes[i]! & 0x80) === 0) {
      result.push(value)
      value = 0
    }
  }
  if ((bytes[bytes.length - 1]! & 0x80) !== 0) throw new Error('X.509 seed policy: truncated OID')
  return result.join('.')
}

function decodeDirectoryString(value: DerValue): string {
  if (value.tag === 0x1e) {
    let result = ''
    for (let i = 0; i + 1 < value.content.length; i += 2) {
      result += String.fromCharCode((value.content[i]! << 8) | value.content[i + 1]!)
    }
    return result
  }
  if (value.tag === 0x0c) return new TextDecoder('utf-8', { fatal: true }).decode(value.content)
  let result = ''
  for (let i = 0; i < value.content.length; i++) result += String.fromCharCode(value.content[i]!)
  return result
}

function parseName(value: DerValue): ReadonlyMap<string, readonly string[]> {
  const attributes = new Map<string, string[]>()
  const rdns = children(value)
  for (let i = 0; i < rdns.length; i++) {
    const pairs = children(rdns[i]!)
    for (let j = 0; j < pairs.length; j++) {
      const pair = children(pairs[j]!)
      if (pair.length < 2 || pair[0]!.tag !== 0x06) throw new Error('X.509 seed policy: malformed distinguished name')
      const key = oid(pair[0]!.content)
      const values = attributes.get(key) ?? []
      values.push(decodeDirectoryString(pair[1]!))
      attributes.set(key, values)
    }
  }
  return attributes
}

const ATTRIBUTE_OIDS: Record<string, string> = {
  cn: '2.5.4.3',
  sn: '2.5.4.4',
  c: '2.5.4.6',
  l: '2.5.4.7',
  st: '2.5.4.8',
  street: '2.5.4.9',
  o: '2.5.4.10',
  ou: '2.5.4.11',
  title: '2.5.4.12',
  givenname: '2.5.4.42',
  initials: '2.5.4.43',
  generationqualifier: '2.5.4.44',
  dnqualifier: '2.5.4.46',
  pseudonym: '2.5.4.65',
  email: '1.2.840.113549.1.9.1',
  emailaddress: '1.2.840.113549.1.9.1',
}

export function x509AttributeOid(name: string): string {
  return ATTRIBUTE_OIDS[name.toLowerCase()] ?? name
}

export function parseX509SeedFacts(der: Uint8Array): X509SeedFacts {
  const certificate = readDer(der, 0)
  if (certificate.next !== der.length || certificate.value.tag !== 0x30) throw new Error('X.509 seed policy: certificate must be one DER SEQUENCE')
  const certificateParts = children(certificate.value)
  if (certificateParts.length < 1 || certificateParts[0]!.tag !== 0x30) throw new Error('X.509 seed policy: certificate lacks TBSCertificate')
  const tbs = children(certificateParts[0]!)
  let index = tbs[0]!.tag === 0xa0 ? 1 : 0
  index += 2
  const issuer = tbs[index++]!
  index++
  const subject = tbs[index++]!
  index++
  let keyUsage: boolean[] | null = null
  const certificatePolicyOids: string[] = []
  for (; index < tbs.length; index++) {
    if (tbs[index]!.tag !== 0xa3) continue
    const extensionWrapper = children(tbs[index]!)[0]
    if (extensionWrapper === undefined || extensionWrapper.tag !== 0x30) throw new Error('X.509 seed policy: malformed extensions')
    const extensions = children(extensionWrapper)
    for (let i = 0; i < extensions.length; i++) {
      const parts = children(extensions[i]!)
      if (parts.length < 2 || parts[0]!.tag !== 0x06 || parts[parts.length - 1]!.tag !== 0x04) {
        throw new Error('X.509 seed policy: malformed extension')
      }
      const extensionOid = oid(parts[0]!.content)
      const wrapped = readDer(parts[parts.length - 1]!.content, 0).value
      if (extensionOid === '2.5.29.15') {
        if (wrapped.tag !== 0x03 || wrapped.content.length === 0) throw new Error('X.509 seed policy: malformed KeyUsage extension')
        keyUsage = []
        for (let bit = 0; bit < 9; bit++) {
          const byte = wrapped.content[1 + (bit >>> 3)] ?? 0
          keyUsage.push((byte & (0x80 >>> (bit & 7))) !== 0)
        }
      } else if (extensionOid === '2.5.29.32') {
        if (wrapped.tag !== 0x30) throw new Error('X.509 seed policy: malformed CertificatePolicies extension')
        const policies = children(wrapped)
        for (let j = 0; j < policies.length; j++) {
          const fields = children(policies[j]!)
          if (fields.length === 0 || fields[0]!.tag !== 0x06) throw new Error('X.509 seed policy: malformed PolicyInformation')
          certificatePolicyOids.push(oid(fields[0]!.content))
        }
      }
    }
  }
  return {
    raw: der,
    issuerRaw: issuer.raw,
    subjectRaw: subject.raw,
    subjectAttributes: parseName(subject),
    keyUsage,
    certificatePolicyOids,
  }
}

export function certificateMatchesSubjectDn(facts: X509SeedFacts, alternatives: ReadonlyArray<Record<string, string>>): boolean {
  for (let i = 0; i < alternatives.length; i++) {
    let matches = true
    for (const [name, value] of Object.entries(alternatives[i]!)) {
      const actual = facts.subjectAttributes.get(x509AttributeOid(name))
      if (actual === undefined || !actual.includes(value)) { matches = false; break }
    }
    if (matches) return true
  }
  return false
}

export function certificateMatchesKeyUsage(facts: X509SeedFacts, alternatives: readonly string[]): boolean {
  if (facts.keyUsage === null) return false
  for (let i = 0; i < alternatives.length; i++) {
    const pattern = alternatives[i]!
    let matches = true
    for (let bit = 0; bit < Math.min(pattern.length, 9); bit++) {
      if (pattern[bit] === '1' && facts.keyUsage[bit] !== true) { matches = false; break }
      if (pattern[bit] === '0' && facts.keyUsage[bit] !== false) { matches = false; break }
    }
    if (matches) return true
  }
  return false
}

export function certificateChainsTo(
  signer: X509SeedFacts,
  available: readonly X509SeedFacts[],
  acceptableIssuerDer: readonly Uint8Array[],
): boolean {
  const acceptable = acceptableIssuerDer.map(parseX509SeedFacts)
  const queue: X509SeedFacts[] = [signer]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()!
    const identity = hex(current.subjectRaw)
    if (visited.has(identity)) continue
    visited.add(identity)
    for (let i = 0; i < acceptable.length; i++) if (equalBytes(current.raw, acceptable[i]!.raw)) return true
    for (let i = 0; i < available.length; i++) {
      if (equalBytes(current.issuerRaw, available[i]!.subjectRaw)) queue.push(available[i]!)
    }
  }
  return false
}

function hex(value: Uint8Array): string {
  let result = ''
  for (let i = 0; i < value.length; i++) result += value[i]!.toString(16).padStart(2, '0')
  return result
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
