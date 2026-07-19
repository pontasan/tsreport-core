/**
 * Minimal DER (Distinguished Encoding Rules, X.690) encoder for building CMS
 * SignedData structures when signing PDFs (see pdf-signer.ts). Only the value
 * types CMS/PKCS#7 needs are provided. The reader counterpart lives in
 * pdf-signature.ts (DerReader).
 */

/** Encodes a DER length using the shortest definite form (X.690 8.1.3). */
function derLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length])
  const bytes: number[] = []
  let value = length
  while (value > 0) {
    bytes.unshift(value & 0xFF)
    value = Math.floor(value / 256)
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

/** Wraps content in a tag-length-value triple. */
function derTLV(tag: number, content: Uint8Array): Uint8Array {
  const len = derLength(content.length)
  const out = new Uint8Array(1 + len.length + content.length)
  out[0] = tag
  out.set(len, 1)
  out.set(content, 1 + len.length)
  return out
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of parts) { out.set(p, pos); pos += p.length }
  return out
}

/** SEQUENCE (0x30) of already-encoded elements. */
export function derSequence(...elements: Uint8Array[]): Uint8Array {
  return derTLV(0x30, concatBytes(elements))
}

/** SET (0x31) of already-encoded elements. */
export function derSet(...elements: Uint8Array[]): Uint8Array {
  return derTLV(0x31, concatBytes(elements))
}

/**
 * SET OF (0x31) whose members are sorted by their full DER encoding, as CMS
 * requires for SignedAttributes (RFC 5652 5.4 / X.690 11.6).
 */
export function derSetOfSorted(elements: Uint8Array[]): Uint8Array {
  const sorted = [...elements].sort((a, b) => {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) {
      if (a[i]! !== b[i]!) return a[i]! - b[i]!
    }
    return a.length - b.length
  })
  return derTLV(0x31, concatBytes(sorted))
}

/** INTEGER (0x02) from a non-negative bigint, with the DER sign-bit rule. */
export function derInteger(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('der-encoder: negative INTEGER not supported')
  const bytes: number[] = []
  let v = value
  if (v === 0n) bytes.push(0)
  while (v > 0n) {
    bytes.unshift(Number(v & 0xFFn))
    v >>= 8n
  }
  // Prepend 0x00 when the top bit is set so the value stays positive.
  if (bytes[0]! & 0x80) bytes.unshift(0)
  return derTLV(0x02, new Uint8Array(bytes))
}

/** INTEGER (0x02) from a small non-negative number. */
export function derIntegerFromNumber(value: number): Uint8Array {
  return derInteger(BigInt(value))
}

/** OCTET STRING (0x04). */
export function derOctetString(content: Uint8Array): Uint8Array {
  return derTLV(0x04, content)
}

/** BIT STRING (0x03) with zero unused bits. */
export function derBitString(content: Uint8Array): Uint8Array {
  const value = new Uint8Array(content.length + 1)
  value.set(content, 1)
  return derTLV(0x03, value)
}

/** OBJECT IDENTIFIER (0x06) from dotted-decimal notation. */
export function derOid(oid: string): Uint8Array {
  const components = oid.split('.')
  if (components.length < 2 || components.some(function (part) { return !/^(?:0|[1-9]\d*)$/.test(part) })) {
    throw new Error(`der-encoder: invalid OID ${oid}`)
  }
  const parts = components.map(function (part) { return Number(part) })
  if (parts.some(function (part) { return !Number.isSafeInteger(part) })) throw new Error(`der-encoder: invalid OID ${oid}`)
  if (parts[0]! > 2 || (parts[0]! < 2 && parts[1]! >= 40)) throw new Error(`der-encoder: invalid OID ${oid}`)
  const values = [parts[0]! * 40 + parts[1]!, ...parts.slice(2)]
  const body: number[] = []
  for (let i = 0; i < values.length; i++) {
    let v = values[i]!
    const chunk: number[] = [v & 0x7F]
    v = Math.floor(v / 128)
    while (v > 0) {
      chunk.unshift((v & 0x7F) | 0x80)
      v = Math.floor(v / 128)
    }
    body.push(...chunk)
  }
  return derTLV(0x06, new Uint8Array(body))
}

/** NULL (0x05 0x00). */
export function derNull(): Uint8Array {
  return new Uint8Array([0x05, 0x00])
}

/** UTCTime (0x17) formatted as YYMMDDHHMMSSZ (dates 1950–2049). */
export function derUtcTime(date: Date): Uint8Array {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  const yy = date.getUTCFullYear() % 100
  const s = `${p(yy)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
    + `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return derTLV(0x17, bytes)
}

/**
 * Context-tagged constructed element [n] (0xA0 | n), used for the explicit
 * [0] wrappers in CMS (content, certificates).
 */
export function derContext(tagNumber: number, content: Uint8Array): Uint8Array {
  return derTLV(0xA0 | tagNumber, content)
}

/** Primitive context-specific value [n] (0x80 | n), used by CMS IMPLICIT OCTET STRING fields. */
export function derContextPrimitive(tagNumber: number, content: Uint8Array): Uint8Array {
  return derTLV(0x80 | tagNumber, content)
}

/** Context-specific constructed IMPLICIT value containing encoded fields. */
export function derContextConstructed(tagNumber: number, ...fields: Uint8Array[]): Uint8Array {
  return derTLV(0xA0 | tagNumber, concatBytes(fields))
}

/** Raw pre-encoded DER bytes passed through unchanged (e.g. a parsed cert). */
export function derRaw(bytes: Uint8Array): Uint8Array {
  return bytes
}
