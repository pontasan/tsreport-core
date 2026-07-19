/**
 * Incremental update writer (ISO 32000 §7.5.6). Appends changed/new objects,
 * a cross-reference section chained to the previous one via /Prev, and a new
 * trailer to an existing PDF without rewriting the original bytes. Readers use
 * the newest xref and fall back through /Prev for untouched objects.
 */

import { parsePdf, readStartXref, PdfRef, PdfString } from './pdf-parser.js'

/** One object to write in the incremental section. */
export interface IncrementalObject {
  /** Object number (reuse an existing number to replace that object). */
  num: number
  /** Generation number (default 0). */
  gen?: number
  /** Object body between "obj" and "endobj": a dictionary/value or stream bytes. */
  body: string | Uint8Array
}

export interface IncrementalUpdateOptions {
  /** Cross-reference representation for the new revision. Defaults to a classic table. */
  xrefFormat?: 'table' | 'stream'
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF
  return out
}

function hexString(bytes: Uint8Array): string {
  let s = '<'
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0')
  return s + '>'
}

/**
 * Appends an incremental update to a PDF. `objects` are written verbatim (reuse
 * an existing object number to replace it); `trailerExtra` adds/overrides
 * trailer entries (already-serialized PDF, e.g. `{ Root: '5 0 R' }`).
 */
export function appendIncrementalUpdate(
  original: Uint8Array,
  objects: IncrementalObject[],
  trailerExtra?: Record<string, string>,
  options: IncrementalUpdateOptions = {},
): Uint8Array {
  if (objects.length === 0) throw new Error('incremental update requires at least one object')
  const prevStartxref = readStartXref(original)
  const doc = parsePdf(original)
  const root = doc.trailer.get('Root')
  if (!(root instanceof PdfRef)) throw new Error('incremental update: original trailer /Root must be an indirect reference')
  const prevSize = doc.trailer.get('Size')
  if (typeof prevSize !== 'number') throw new Error('incremental update: original trailer /Size must be a number')

  // Serialize the appended object bodies, recording each byte offset (the file
  // begins with the untouched original bytes, so offsets are absolute).
  const sorted = objects.slice().sort((a, b) => a.num - b.num)
  for (let i = 0; i < sorted.length; i++) {
    const object = sorted[i]!
    const generation = object.gen ?? 0
    if (!Number.isSafeInteger(object.num) || object.num <= 0) throw new Error(`incremental update: invalid object number ${object.num}`)
    if (!Number.isInteger(generation) || generation < 0 || generation > 0xFFFF) {
      throw new Error(`incremental update: invalid generation ${generation} for object ${object.num}`)
    }
    const activeGeneration = doc.getObjectGeneration(object.num)
    if (activeGeneration === null) {
      if (generation !== 0) throw new Error(`incremental update: new object ${object.num} must use generation 0`)
    } else {
      if (doc.isObjectFree(object.num) && activeGeneration === 0xFFFF) {
        throw new Error(`incremental update: permanently free object ${object.num} cannot be reused`)
      }
      if (generation !== activeGeneration) {
        throw new Error(`incremental update: object ${object.num} must use active generation ${activeGeneration}`)
      }
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.num === sorted[i - 1]!.num) throw new Error(`incremental update: duplicate object number ${sorted[i]!.num}`)
  }
  const parts: Uint8Array[] = []
  let offset = original.length
  parts.push(original)
  // A leading newline separates the appended section from the original %%EOF.
  const lead = asciiBytes('\n')
  parts.push(lead)
  offset += lead.length

  const offsets = new Map<number, number>()
  let maxNum = 0
  for (let i = 0; i < sorted.length; i++) {
    const obj = sorted[i]!
    const gen = obj.gen ?? 0
    offsets.set(obj.num, offset)
    if (obj.num > maxNum) maxNum = obj.num
    const header = asciiBytes(`${obj.num} ${gen} obj\n`)
    const body = typeof obj.body === 'string' ? asciiBytes(obj.body) : obj.body
    const footer = asciiBytes('\nendobj\n')
    parts.push(header, body, footer)
    offset += header.length + body.length + footer.length
  }

  // Cross-reference section: group consecutive object numbers into subsections.
  const xrefOffset = offset
  const size = Math.max(prevSize, maxNum + 1)
  const reusedFree = new Set<number>()
  for (let object = 0; object < sorted.length; object++) {
    if (doc.isObjectFree(sorted[object]!.num)) reusedFree.add(sorted[object]!.num)
  }
  const xrefEntries: Array<{ num: number, free: boolean, field1: number, generation: number }> = []
  for (let object = 0; object < sorted.length; object++) {
    const value = sorted[object]!
    xrefEntries.push({
      num: value.num,
      free: false,
      field1: offsets.get(value.num)!,
      generation: value.gen ?? 0,
    })
  }
  if (reusedFree.size > 0) {
    const remainingFree: number[] = []
    for (let num = 1; num < prevSize; num++) {
      if (doc.isObjectFree(num) && !reusedFree.has(num)) remainingFree.push(num)
    }
    const reusable = remainingFree.filter(num => doc.getObjectGeneration(num)! < 0xFFFF)
    xrefEntries.push({ num: 0, free: true, field1: reusable[0] ?? 0, generation: 0xFFFF })
    for (let free = 0; free < remainingFree.length; free++) {
      const num = remainingFree[free]!
      const reusableIndex = reusable.indexOf(num)
      xrefEntries.push({
        num,
        free: true,
        field1: reusableIndex >= 0 ? (reusable[reusableIndex + 1] ?? 0) : 0,
        generation: doc.getObjectGeneration(num)!,
      })
    }
  }
  xrefEntries.sort((a, b) => a.num - b.num)

  if (options.xrefFormat === 'stream') {
    const xrefObjectNumber = size
    const streamSize = size + 1
    xrefEntries.push({ num: xrefObjectNumber, free: false, field1: xrefOffset, generation: 0 })
    xrefEntries.sort((a, b) => a.num - b.num)
    const indexValues: number[] = []
    let entry = 0
    while (entry < xrefEntries.length) {
      const start = xrefEntries[entry]!.num
      let count = 1
      while (entry + count < xrefEntries.length && xrefEntries[entry + count]!.num === start + count) count++
      indexValues.push(start, count)
      entry += count
    }
    const width = [1, 8, 2] as const
    const stream = new Uint8Array(xrefEntries.length * 11)
    let streamOffset = 0
    for (let value = 0; value < xrefEntries.length; value++) {
      const xrefEntry = xrefEntries[value]!
      stream[streamOffset++] = xrefEntry.free ? 0 : 1
      let field1 = BigInt(xrefEntry.field1)
      for (let byte = 7; byte >= 0; byte--) {
        stream[streamOffset + byte] = Number(field1 & 0xFFn)
        field1 >>= 8n
      }
      streamOffset += 8
      stream[streamOffset++] = (xrefEntry.generation >>> 8) & 0xFF
      stream[streamOffset++] = xrefEntry.generation & 0xFF
    }
    const dictionary = [
      '/Type /XRef', `/Size ${streamSize}`, `/W [${width.join(' ')}]`, `/Index [${indexValues.join(' ')}]`,
      `/Root ${root.num} ${root.gen} R`, `/Prev ${prevStartxref}`, `/Length ${stream.length}`,
    ]
    const overrides = trailerExtra ?? {}
    const info = doc.trailer.get('Info')
    if (info instanceof PdfRef && !('Info' in overrides)) dictionary.push(`/Info ${info.num} ${info.gen} R`)
    const id = doc.trailer.get('ID')
    if (Array.isArray(id) && id.length === 2 && id[0] instanceof PdfString && id[1] instanceof PdfString && !('ID' in overrides)) {
      dictionary.push(`/ID [${hexString(id[0].bytes)} ${hexString(id[1].bytes)}]`)
    }
    for (const key in overrides) dictionary.push(`/${key} ${overrides[key]}`)
    const header = asciiBytes(`${xrefObjectNumber} 0 obj\n<< ${dictionary.join(' ')} >>\nstream\n`)
    const footer = asciiBytes(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`)
    parts.push(header, stream, footer)
    let total = 0
    for (let part = 0; part < parts.length; part++) total += parts[part]!.length
    const result = new Uint8Array(total)
    let position = 0
    for (let part = 0; part < parts.length; part++) { result.set(parts[part]!, position); position += parts[part]!.length }
    return result
  }

  let xref = 'xref\n'
  let i = 0
  while (i < xrefEntries.length) {
    const start = xrefEntries[i]!.num
    let count = 1
    while (i + count < xrefEntries.length && xrefEntries[i + count]!.num === start + count) count++
    xref += `${start} ${count}\n`
    for (let k = 0; k < count; k++) {
      const entry = xrefEntries[i + k]!
      xref += `${String(entry.field1).padStart(10, '0')} ${String(entry.generation).padStart(5, '0')} ${entry.free ? 'f' : 'n'} \n`
    }
    i += count
  }

  const trailerEntries = [`/Size ${size}`, `/Root ${root.num} ${root.gen} R`, `/Prev ${prevStartxref}`]
  const overrides = trailerExtra ?? {}
  // Carry forward /Info and /ID from the previous trailer (readers use the
  // newest trailer, so these must be repeated) unless explicitly overridden.
  const info = doc.trailer.get('Info')
  if (info instanceof PdfRef && !('Info' in overrides)) trailerEntries.push(`/Info ${info.num} ${info.gen} R`)
  const id = doc.trailer.get('ID')
  if (Array.isArray(id) && id.length === 2 && id[0] instanceof PdfString && id[1] instanceof PdfString && !('ID' in overrides)) {
    trailerEntries.push(`/ID [${hexString(id[0].bytes)} ${hexString(id[1].bytes)}]`)
  }
  for (const key in overrides) trailerEntries.push(`/${key} ${overrides[key]}`)
  const tail = asciiBytes(`${xref}trailer\n<< ${trailerEntries.join(' ')} >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  parts.push(tail)

  let total = 0
  for (let p = 0; p < parts.length; p++) total += parts[p]!.length
  const result = new Uint8Array(total)
  let pos = 0
  for (let p = 0; p < parts.length; p++) { result.set(parts[p]!, pos); pos += parts[p]!.length }
  return result
}
