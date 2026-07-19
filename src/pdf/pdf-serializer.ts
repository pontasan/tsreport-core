/**
 * Serializes parsed PDF values back to bytes. Used by the linearizer to
 * re-emit objects (extracted from any input, including object streams) as
 * independently addressable indirect objects.
 */

import { PdfName, PdfString, PdfRef, PdfStream, type PdfValue, type PdfDict } from './pdf-parser.js'

/** Formats a number without exponential notation (invalid in PDF). */
export function formatPdfNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  let s = n.toFixed(6)
  // Trim trailing zeros and a trailing dot.
  s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

function escapeNameBody(name: string): string {
  let out = ''
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    // Regular chars pass through; delimiters/whitespace/# are #-escaped.
    if (c < 0x21 || c > 0x7e || c === 0x23 /*#*/ || c === 0x2f || c === 0x28 || c === 0x29 ||
        c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x25) {
      out += '#' + c.toString(16).padStart(2, '0').toUpperCase()
    } else {
      out += name[i]
    }
  }
  return out
}

function hexString(bytes: Uint8Array): string {
  let s = '<'
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0')
  return s + '>'
}

/** Serializes a PDF value to its textual representation (strings as hex). */
export function serializePdfValue(v: PdfValue): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return formatPdfNumber(v)
  if (v instanceof PdfName) return '/' + escapeNameBody(v.name)
  if (v instanceof PdfString) return hexString(v.bytes)
  if (v instanceof PdfRef) return `${v.num} ${v.gen} R`
  if (Array.isArray(v)) return '[' + v.map(serializePdfValue).join(' ') + ']'
  if (v instanceof PdfStream) return serializePdfDict(v.dict)
  if (v instanceof Map) return serializePdfDict(v)
  throw new Error('cannot serialize PDF value')
}

function serializePdfDict(dict: PdfDict): string {
  let s = '<<'
  for (const [k, val] of dict) s += ' /' + escapeNameBody(k) + ' ' + serializePdfValue(val)
  return s + ' >>'
}

const ENC = new TextEncoder()

/**
 * Serializes one indirect object body (the part between "N G obj" and "endobj").
 * For streams the /Length entry is normalized to the raw byte length and the
 * raw (still-filtered) bytes are emitted verbatim.
 */
export function serializeIndirectObject(value: PdfValue): Uint8Array {
  if (value instanceof PdfStream) {
    const dict: PdfDict = new Map(value.dict)
    dict.set('Length', value.raw.length)
    const head = ENC.encode(serializePdfDict(dict) + '\nstream\n')
    const tail = ENC.encode('\nendstream')
    const out = new Uint8Array(head.length + value.raw.length + tail.length)
    out.set(head, 0)
    out.set(value.raw, head.length)
    out.set(tail, head.length + value.raw.length)
    return out
  }
  return ENC.encode(serializePdfValue(value))
}
