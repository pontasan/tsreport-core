/**
 * Rewrites a PDF with all objects expressed as traditional indirect objects and
 * a classic cross-reference table (ISO 32000 §7.5.4). Object streams (§7.5.7)
 * and cross-reference streams (§7.5.8) from the input are expanded, producing a
 * PDF that legacy consumers without object-stream support can read. Object
 * numbers and content are preserved. Operates on unencrypted PDFs.
 */

import { parsePdf, PdfName, PdfRef, PdfStream, PdfString, type PdfValue } from './pdf-parser.js'
import { serializeIndirectObject } from './pdf-serializer.js'

function hexString(bytes: Uint8Array): string {
  let s = '<'
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0')
  return s + '>'
}

const ENC = new TextEncoder()

export function rewritePdfToTraditional(bytes: Uint8Array, password = ''): Uint8Array {
  const doc = parsePdf(bytes, { password })
  // Encrypted input is decrypted on read (parsePdf applies the standard security
  // handler), so the rewrite emits plaintext objects. The encryption dictionary
  // is dropped: its object is skipped below and the trailer never copies
  // /Encrypt, producing an unencrypted traditional PDF.
  const encrypt = doc.trailer.get('Encrypt')
  const encryptNum = encrypt instanceof PdfRef ? encrypt.num : -1
  const size = doc.trailer.get('Size')
  if (typeof size !== 'number') throw new Error('rewritePdfToTraditional: trailer /Size missing')
  const root = doc.trailer.get('Root')
  if (!(root instanceof PdfRef)) throw new Error('rewritePdfToTraditional: trailer /Root missing')
  const info = doc.trailer.get('Info')

  const objects: { num: number, gen: number, body: Uint8Array }[] = []
  for (let n = 1; n < size; n++) {
    if (n === encryptNum) continue // drop the encryption dictionary
    const v: PdfValue = doc.getObject(n)
    if (v === null || v === undefined) continue
    // Object streams and cross-reference streams are the compressed encoding
    // being expanded away; their payload objects are re-emitted individually.
    if (v instanceof PdfStream) {
      const t = v.dict.get('Type')
      if (t instanceof PdfName && (t.name === 'ObjStm' || t.name === 'XRef')) continue
    }
    objects.push({ num: n, gen: doc.getObjectGeneration(n)!, body: serializeIndirectObject(v) })
  }

  const parts: Uint8Array[] = []
  let offset = 0
  const push = (b: Uint8Array): void => { parts.push(b); offset += b.length }

  push(ENC.encode('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'))
  const offsets = new Map<number, number>()
  const generations = new Map<number, number>()
  for (const o of objects) {
    offsets.set(o.num, offset)
    generations.set(o.num, o.gen)
    push(ENC.encode(`${o.num} ${o.gen} obj\n`))
    push(o.body)
    push(ENC.encode('\nendobj\n'))
  }

  const xrefOffset = offset
  const freeGenerations = new Map<number, number>()
  for (let n = 1; n < size; n++) {
    if (offsets.has(n)) continue
    const sourceGeneration = doc.getObjectGeneration(n)
    const generation = doc.isObjectFree(n)
      ? (sourceGeneration ?? 0)
      : Math.min(0xFFFF, (sourceGeneration ?? -1) + 1)
    freeGenerations.set(n, generation)
  }
  const reusableFree = Array.from(freeGenerations)
    .filter(([, generation]) => generation < 0xFFFF)
    .map(([num]) => num)
    .sort((a, b) => a - b)
  const nextFree = new Map<number, number>()
  for (let i = 0; i < reusableFree.length; i++) nextFree.set(reusableFree[i]!, reusableFree[i + 1] ?? 0)

  let xref = `xref\n0 ${size}\n${String(reusableFree[0] ?? 0).padStart(10, '0')} 65535 f \n`
  for (let n = 1; n < size; n++) {
    const off = offsets.get(n)
    if (off !== undefined) {
      xref += `${String(off).padStart(10, '0')} ${String(generations.get(n)!).padStart(5, '0')} n \n`
    } else {
      const generation = freeGenerations.get(n)!
      xref += `${String(nextFree.get(n) ?? 0).padStart(10, '0')} ${String(generation).padStart(5, '0')} f \n`
    }
  }
  let trailer = `trailer\n<< /Size ${size} /Root ${root.num} ${root.gen} R`
  if (info instanceof PdfRef) trailer += ` /Info ${info.num} ${info.gen} R`
  const id = doc.trailer.get('ID')
  if (Array.isArray(id) && id.length === 2 && id[0] instanceof PdfString && id[1] instanceof PdfString) {
    // Preserve the file identifier when present.
    trailer += ` /ID [${hexString(id[0].bytes)} ${hexString(id[1].bytes)}]`
  }
  trailer += ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  push(ENC.encode(xref))
  push(ENC.encode(trailer))

  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of parts) { out.set(p, pos); pos += p.length }
  return out
}
