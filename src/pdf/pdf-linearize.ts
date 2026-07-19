/**
 * PDF linearization (ISO 32000-1 Annex F): rewrites a PDF so the first page and
 * everything needed to render it appear first, followed by a primary hint
 * stream (page-offset and shared-object hint tables) that lets a viewer request
 * page 1 over a byte-serving transport without downloading the whole file.
 *
 * The object partitioning, renumbering, and hint-table computation follow the
 * same model qpdf uses; the produced files pass `qpdf --check-linearization`.
 * Operates on unencrypted PDFs (encrypted input is decrypted on read).
 */

import { parsePdf, PdfName, PdfRef, PdfStream, PdfString, type PdfValue, type PdfDict } from './pdf-parser.js'
import { serializeIndirectObject } from './pdf-serializer.js'

const ENC = new TextEncoder()

/** Deep-copy a value, remapping every indirect reference through `map`. */
function remapValue(v: PdfValue, map: Map<number, number>): PdfValue {
  if (v instanceof PdfRef) return new PdfRef(map.get(v.num) ?? v.num, v.gen)
  if (Array.isArray(v)) return v.map(x => remapValue(x, map))
  if (v instanceof PdfStream) {
    const dict = new Map<string, PdfValue>()
    for (const [k, val] of v.dict) dict.set(k, remapValue(val, map))
    return new PdfStream(dict, v.raw)
  }
  if (v instanceof Map) {
    const dict = new Map<string, PdfValue>()
    for (const [k, val] of v) dict.set(k, remapValue(val, map))
    return dict
  }
  return v
}

/** Collect the object numbers directly referenced by a value. */
function collectRefs(v: PdfValue, out: Set<number>): void {
  if (v instanceof PdfRef) { out.add(v.num); return }
  if (Array.isArray(v)) { for (const x of v) collectRefs(x, out); return }
  if (v instanceof PdfStream) { for (const [, val] of v.dict) collectRefs(val, out); return }
  if (v instanceof Map) { for (const [, val] of v) collectRefs(val, out); return }
}

const OPEN_DOCUMENT_KEYS = new Set(['ViewerPreferences', 'Threads', 'OpenAction', 'AcroForm'])

interface LiveObject {
  num: number
  value: PdfValue
}

export function linearizePdf(bytes: Uint8Array, password = ''): Uint8Array {
  const doc = parsePdf(bytes, { password })
  const size = doc.trailer.get('Size')
  if (typeof size !== 'number') throw new Error('linearizePdf: trailer /Size missing')
  const rootRef = doc.trailer.get('Root')
  if (!(rootRef instanceof PdfRef)) throw new Error('linearizePdf: trailer /Root missing')
  const encryptRef = doc.trailer.get('Encrypt')
  const encryptNum = encryptRef instanceof PdfRef ? encryptRef.num : -1

  // 1. Gather all live objects (expanding object/xref streams away).
  const live = new Map<number, PdfValue>()
  for (let n = 1; n < size; n++) {
    if (n === encryptNum) continue
    let v: PdfValue
    try { v = doc.getObject(n) } catch { continue }
    if (v === null || v === undefined) continue
    if (v instanceof PdfStream) {
      const t = v.dict.get('Type')
      if (t instanceof PdfName && (t.name === 'ObjStm' || t.name === 'XRef')) continue
    }
    live.set(n, v)
  }
  const refsFrom = new Map<number, Set<number>>()
  for (const [n, v] of live) {
    const s = new Set<number>()
    collectRefs(v, s)
    s.delete(n)
    refsFrom.set(n, s)
  }

  const catalog = doc.resolve(rootRef)
  if (!(catalog instanceof Map)) throw new Error('linearizePdf: catalog is not a dictionary')

  // 2. Walk the page tree in order; collect page-tree node numbers and page leaves.
  const pageTreeNodes = new Set<number>()
  const pageObjs: number[] = []
  const pagesRef = catalog.get('Pages')
  if (!(pagesRef instanceof PdfRef)) throw new Error('linearizePdf: catalog /Pages missing')
  walkPageTree(doc, pagesRef.num, pageTreeNodes, pageObjs, new Set<number>())
  if (pageObjs.length === 0) throw new Error('linearizePdf: no pages found')
  const npages = pageObjs.length
  const pageIndex = new Map<number, number>()
  for (let i = 0; i < npages; i++) pageIndex.set(pageObjs[i]!, i)
  const pageContentObjects: number[][] = []
  for (let i = 0; i < npages; i++) {
    const page = live.get(pageObjs[i]!)
    if (!(page instanceof Map)) throw new Error('linearizePdf: page object is not a dictionary')
    const contents = page.get('Contents')
    const contentObjects: number[] = []
    if (contents !== undefined) collectContentStreamObjects(contents, live, contentObjects, new Set<number>())
    pageContentObjects.push(contentObjects)
  }

  // 3. Per-page closures: objects reachable from a page, not descending into
  //    other pages, the page-tree spine, or the catalog.
  const stopAt = new Set<number>([rootRef.num, ...pageTreeNodes])
  const pageClosures: Set<number>[] = []
  for (let i = 0; i < npages; i++) {
    const closure = new Set<number>()
    const stack = [...(refsFrom.get(pageObjs[i]!) ?? [])]
    while (stack.length > 0) {
      const o = stack.pop()!
      if (closure.has(o) || stopAt.has(o) || pageIndex.has(o) || !live.has(o)) continue
      closure.add(o)
      for (const r of refsFrom.get(o) ?? []) stack.push(r)
    }
    pageClosures.push(closure)
  }

  // Open-document closure: reachable from the open-document root keys.
  const openDoc = new Set<number>()
  {
    const seed = new Set<number>()
    for (const [k, val] of catalog) {
      if (OPEN_DOCUMENT_KEYS.has(k)) collectRefs(val, seed)
    }
    const stack = [...seed]
    while (stack.length > 0) {
      const o = stack.pop()!
      if (openDoc.has(o) || o === rootRef.num || !live.has(o)) continue
      openDoc.add(o)
      for (const r of refsFrom.get(o) ?? []) stack.push(r)
    }
  }

  // 4. Classify every live object into a linearization part.
  const part4: number[] = []       // open-document (catalog + open-doc keys)
  const firstPagePrivate: number[] = []
  const firstPageShared: number[] = []
  const otherPagePrivate: number[] = []
  const otherPageShared: number[] = []
  const part9: number[] = []       // page-tree nodes, outlines, everything else

  for (const n of live.keys()) {
    if (n === rootRef.num) continue // catalog placed first in part4
    let pageCount = 0
    let inFirst = false
    for (let i = 0; i < npages; i++) {
      if (pageClosures[i]!.has(n)) { pageCount++; if (i === 0) inFirst = true }
    }
    const inOpen = openDoc.has(n)
    if (pageIndex.has(n)) {
      // A page object itself: page 0 handled via part6 assembly below; others via part7.
      continue
    }
    if (inOpen && !inFirst) {
      part4.push(n)
    } else if (inFirst && pageCount === 1) {
      firstPagePrivate.push(n)
    } else if (inFirst) {
      firstPageShared.push(n)
    } else if (pageCount === 1) {
      otherPagePrivate.push(n)
    } else if (pageCount > 1) {
      otherPageShared.push(n)
    } else {
      part9.push(n)
    }
  }
  // Page-tree nodes always live in part 9; ensure they are present exactly once.
  const part9Set = new Set(part9)
  for (const node of pageTreeNodes) if (live.has(node) && !part9Set.has(node)) { part9.push(node); part9Set.add(node) }

  // part6: first page object, then its private objects, then its shared objects.
  const part6: number[] = [pageObjs[0]!, ...sortNums(firstPagePrivate), ...sortNums(firstPageShared)]

  // part7: each remaining page followed by its private objects.
  const part7: number[] = []
  const perPageObjectCount: number[] = new Array<number>(npages)
  perPageObjectCount[0] = part6.length
  for (let i = 1; i < npages; i++) {
    part7.push(pageObjs[i]!)
    let count = 1
    const priv = sortNums(otherPagePrivate.filter(n => pageClosures[i]!.has(n)))
    for (const n of priv) { part7.push(n); count++ }
    perPageObjectCount[i] = count
  }
  const part8 = sortNums(otherPageShared)

  // 5. Renumber. Tail (part7,8,9) → 1..T; then lindict, part4, hint, part6.
  const tail = [...part7, ...part8, ...part9]
  const oldToNew = new Map<number, number>()
  let next = 1
  for (const n of tail) oldToNew.set(n, next++)
  const linDictNum = next++
  const part4New: number[] = []
  for (const n of [rootRef.num, ...sortNums(part4)]) { oldToNew.set(n, next); part4New.push(next); next++ }
  const hintNum = next++
  const part6New: number[] = []
  for (const n of part6) { oldToNew.set(n, next); part6New.push(next); next++ }
  const totalObjects = next // objects 1..next-1 exist; /Size = next

  // Head object numbers, in file-write order.
  const catalogNew = oldToNew.get(rootRef.num)!
  const firstPageNew = oldToNew.get(pageObjs[0]!)!

  // 6. Serialize each object body (with remapped refs). Object headers vary in
  //    width with the object number, so lengths must be computed on the final
  //    numbers.
  const bodyOf = new Map<number, Uint8Array>()
  for (const [oldNum, value] of live) {
    bodyOf.set(oldToNew.get(oldNum)!, serializeIndirectObject(remapValue(value, oldToNew)))
  }
  const objLen = (newNum: number): number => {
    const body = bodyOf.get(newNum)!
    return ENC.encode(`${newNum} 0 obj\n`).length + body.length + '\nendobj\n'.length
  }

  // File-order lists of object numbers (new numbering).
  const headBeforeHint = part4New            // catalog + open-doc
  const headAfterHint = part6New             // first page section
  const tailNew = tail.map(n => oldToNew.get(n)!)

  // 7. Build hint tables. Their byte length is independent of the offset values
  //    they contain (all offset fields are fixed 32-bit), so compute once with
  //    placeholder offsets, then again with real ones.
  const sharedList = [...part6New, ...part8.map(n => oldToNew.get(n)!)]
  const sharedIndexByNew = new Map<number, number>()
  for (let i = 0; i < sharedList.length; i++) sharedIndexByNew.set(sharedList[i]!, i)

  // Per-page shared identifiers (indices into sharedList) for pages 1..n-1.
  const pageSharedIds: number[][] = [[]]
  for (let i = 1; i < npages; i++) {
    const ids: number[] = []
    for (const oldN of pageClosures[i]!) {
      const idx = sharedIndexByNew.get(oldToNew.get(oldN)!)
      if (idx !== undefined) ids.push(idx)
    }
    ids.sort((a, b) => a - b)
    pageSharedIds.push(ids)
  }

  const hintArgs = {
    npages, part6New, part7, part8, otherPagePrivate, pageObjs, pageClosures, oldToNew,
    perPageObjectCount, sharedList, pageSharedIds, pageContentObjects, objLen,
  }
  // The main trailer region must be reserved before layout; a full /ID pair
  // (encrypted / PDF/A inputs) makes it exceed the 90-byte floor.
  const idPairForRegions = getIdPair(doc)
  const mainTrailerRegion = mainTrailerRegionFor(idPairForRegions)
  const firstTrailerRegion = firstTrailerRegionFor(idPairForRegions)
  const layout0 = computeLayout({ linDictNum, hintNum, headBeforeHint, headAfterHint, tailNew, totalObjects, objLen, mainTrailerRegion, firstTrailerRegion })
  const hint0 = buildHintStream({ ...hintArgs, layout: layout0 })

  // The hint object's serialized length depends only on the (fixed) hint byte
  // length, so compute it once, then lay out and regenerate with real offsets.
  const hintObjLen = hintObjectLength(hintNum, hint0.bytes.length, hint0.sOffset)
  const layout = computeLayout({ linDictNum, hintNum, headBeforeHint, headAfterHint, tailNew, totalObjects, objLen, hintObjLen, mainTrailerRegion, firstTrailerRegion })
  const hint = buildHintStream({ ...hintArgs, layout })
  if (hint.bytes.length !== hint0.bytes.length) throw new Error('linearizePdf: hint stream length not stable')

  return assembleFile({
    doc, size: totalObjects, catalogNew, firstPageNew, npages,
    linDictNum, hintNum, headBeforeHint, headAfterHint, tailNew,
    bodyOf, hint, layout,
  })
}

function hintObjectLength(num: number, hintLen: number, sOffset: number): number {
  return ENC.encode(`${num} 0 obj\n<< /Length ${hintLen} /S ${sOffset} >>\nstream\n`).length
    + hintLen + '\nendstream\nendobj\n'.length
}

function sortNums(a: number[]): number[] {
  return [...a].sort((x, y) => x - y)
}

function walkPageTree(doc: ReturnType<typeof parsePdf>, num: number, nodes: Set<number>, leaves: number[], seen: Set<number>): void {
  if (seen.has(num)) return
  seen.add(num)
  const node = doc.getObject(num)
  if (!(node instanceof Map)) return
  const type = node.get('Type')
  if (type instanceof PdfName && type.name === 'Page') { leaves.push(num); return }
  nodes.add(num)
  const kids = doc.resolve(node.get('Kids') ?? null)
  if (!Array.isArray(kids)) return
  for (const kid of kids) {
    if (kid instanceof PdfRef) walkPageTree(doc, kid.num, nodes, leaves, seen)
  }
}

function collectContentStreamObjects(
  value: PdfValue,
  live: Map<number, PdfValue>,
  result: number[],
  seen: Set<number>,
): void {
  if (value instanceof PdfRef) {
    if (seen.has(value.num)) return
    seen.add(value.num)
    const resolved = live.get(value.num)
    if (resolved instanceof PdfStream) {
      result.push(value.num)
      return
    }
    if (resolved !== undefined) collectContentStreamObjects(resolved, live, result, seen)
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) collectContentStreamObjects(value[i]!, live, result, seen)
  }
}

// --- layout (offsets) ------------------------------------------------------

interface LayoutInput {
  linDictNum: number
  hintNum: number
  headBeforeHint: number[]
  headAfterHint: number[]
  tailNew: number[]
  totalObjects: number
  objLen: (n: number) => number
  hintObjLen?: number
  mainTrailerRegion: number
  firstTrailerRegion: number
}

interface Layout {
  headerLen: number
  linDictRegionLen: number
  firstPageXrefOffset: number
  firstPageXrefLen: number
  afterFirstXref: number
  offsetOf: Map<number, number>
  hintOffset: number
  hintObjLen: number
  firstPageEnd: number
  mainXrefOffset: number
  mainXrefTOffset: number
  fileLength: number
  headCount: number
  tailCount: number
}

const HEADER = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'

function headerForVersion(version: string): string {
  return `%PDF-${version}\n%\xE2\xE3\xCF\xD3\n`
}
// Reserved fixed size for the linearization-dictionary object (padded so the
// first-page xref begins at a constant offset regardless of number widths).
const LINDICT_REGION = 200

function xrefSubsectionLen(start: number, count: number): number {
  return `xref\n${start} ${count}\n`.length + count * 20
}

function computeLayout(input: LayoutInput): Layout {
  const { linDictNum, hintNum, headBeforeHint, headAfterHint, tailNew, totalObjects, objLen } = input
  const headerLen = ENC.encode(HEADER).length
  const linDictRegionLen = LINDICT_REGION

  // First-page xref covers the head objects: lindict + part4 + hint + part6.
  const headNums = [linDictNum, ...headBeforeHint, hintNum, ...headAfterHint]
  const headCount = headNums.length
  const tailCount = tailNew.length
  const firstPageXrefOffset = headerLen + linDictRegionLen
  // First-page xref: subsection header + entries + trailer. The trailer width
  // is padded to a reserved size that grows with the /ID length (a long /ID
  // pair overflows the 160-byte floor).
  const firstPageXrefLen = xrefSubsectionLen(linDictNum, headCount) + input.firstTrailerRegion
  const afterFirstXref = firstPageXrefOffset + firstPageXrefLen

  const offsetOf = new Map<number, number>()
  offsetOf.set(linDictNum, headerLen)
  let pos = afterFirstXref
  // part4 (catalog + open-doc), each an object.
  for (const n of headBeforeHint) { offsetOf.set(n, pos); pos += objLen(n) }
  // hint stream object
  const hintOffset = pos
  offsetOf.set(hintNum, hintOffset)
  const hintObjLen = input.hintObjLen ?? 0
  pos += hintObjLen
  // part6 (first page section)
  for (const n of headAfterHint) { offsetOf.set(n, pos); pos += objLen(n) }
  const firstPageEnd = pos
  // tail objects
  for (const n of tailNew) { offsetOf.set(n, pos); pos += objLen(n) }
  const mainXrefOffset = pos
  const mainXrefHeader = `xref\n0 ${tailCount + 1}\n`
  const mainXrefTOffset = mainXrefOffset + 'xref\n'.length + `0 ${tailCount + 1}\n`.length - 1
  const mainXrefLen = mainXrefHeader.length + (tailCount + 1) * 20 + input.mainTrailerRegion
  const fileLength = mainXrefOffset + mainXrefLen

  return {
    headerLen, linDictRegionLen, firstPageXrefOffset, firstPageXrefLen, afterFirstXref,
    offsetOf, hintOffset, hintObjLen, firstPageEnd, mainXrefOffset, mainXrefTOffset,
    fileLength, headCount, tailCount,
  }
}

const FIRST_TRAILER_REGION_MIN = 160
const MAIN_TRAILER_REGION_MIN = 90

/**
 * Reserved byte region for the first-page trailer. It must hold
 * `trailer\n<< /Size N /Root R 0 R /Prev OFF [/ID [id id]] >>\n` plus the
 * `startxref\n0\n%%EOF\n` line. A full /ID pair (encrypted / PDF/A inputs, and
 * arbitrary-length /IDs from imported files) overflows the 160-byte floor, so
 * size it from the actual /ID length plus a fixed allowance for the largest
 * /Size, /Root and /Prev values (10 digits each).
 */
function firstTrailerRegionFor(idPair: string): number {
  const fixed = 'trailer\n<< /Size '.length + 10 + ' /Root '.length + 10 + ' 0 R'.length
    + ' /Prev '.length + 10 + ' >>\n'.length + 'startxref\n0\n%%EOF\n'.length
  const idPart = idPair ? ' /ID ['.length + idPair.length + ']'.length : 0
  return Math.max(FIRST_TRAILER_REGION_MIN, fixed + idPart)
}

/**
 * Reserved byte region for the main (final) trailer. It must hold
 * `trailer\n<< /Size N [/ID [id]] >>\nstartxref\nOFFSET\n%%EOF\n`; a full /ID
 * pair (present in every encrypted PDF and required by PDF/A) makes this exceed
 * the 90-byte floor, so size it from the actual /ID length plus a fixed
 * allowance for the largest /Size and startxref offsets (10 digits each).
 */
function mainTrailerRegionFor(idPair: string): number {
  const fixed = 'trailer\n<< /Size '.length + 10 + ' >>\nstartxref\n'.length + 10 + '\n%%EOF\n'.length
  const idPart = idPair ? ' /ID ['.length + idPair.length + ']'.length : 0
  return Math.max(MAIN_TRAILER_REGION_MIN, fixed + idPart)
}

// --- hint stream -----------------------------------------------------------

class BitWriter {
  private bytes: number[] = []
  private cur = 0
  private nbits = 0
  writeBits(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >>> i) & 1)
      this.nbits++
      if (this.nbits === 8) { this.bytes.push(this.cur); this.cur = 0; this.nbits = 0 }
    }
  }
  /** Pad to a byte boundary (each hint table row starts on a byte boundary). */
  flush(): void {
    if (this.nbits > 0) { this.cur <<= (8 - this.nbits); this.bytes.push(this.cur); this.cur = 0; this.nbits = 0 }
  }
  count(): number { return this.bytes.length + (this.nbits > 0 ? 1 : 0) }
  toBytes(): Uint8Array { this.flush(); return Uint8Array.from(this.bytes) }
}

function nbits(value: number): number {
  let n = 0
  let v = value
  while (v > 0) { n++; v = Math.floor(v / 2) }
  return n
}

/** Subtract the hint stream length from offsets at or beyond the hint stream. */
function hintAdjust(offset: number, layout: Layout): number {
  return offset >= layout.hintOffset ? offset - layout.hintObjLen : offset
}

interface HintInput {
  npages: number
  part6New: number[]
  part7: number[]
  part8: number[]
  otherPagePrivate: number[]
  pageObjs: number[]
  pageClosures: Set<number>[]
  oldToNew: Map<number, number>
  perPageObjectCount: number[]
  sharedList: number[]
  pageSharedIds: number[][]
  pageContentObjects: number[][]
  objLen: (n: number) => number
  layout: Layout
}

function buildHintStream(h: HintInput): { bytes: Uint8Array, sOffset: number } {
  const { npages, part6New, sharedList, perPageObjectCount, pageSharedIds, objLen, layout } = h

  // Per-page object runs (in new numbering, contiguous in the file).
  const pageRuns: number[][] = []
  pageRuns.push(part6New) // page 0 = part6
  // pages 1..n-1: [pageNew, ...privateNew] contiguous in part7
  {
    let idx = 0
    for (let i = 1; i < npages; i++) {
      const count = perPageObjectCount[i]!
      const run: number[] = []
      for (let k = 0; k < count; k++) run.push(h.oldToNew.get(h.part7[idx++]!)!)
      pageRuns.push(run)
    }
  }

  const pageLengths = pageRuns.map(run => run.reduce((s, n) => s + objLen(n), 0))
  const nobjects = perPageObjectCount
  const minNobjects = Math.min(...nobjects)
  const maxNobjects = Math.max(...nobjects)
  const minLength = Math.min(...pageLengths)
  const maxLength = Math.max(...pageLengths)
  const maxShared = Math.max(0, ...pageSharedIds.map(a => a.length))
  const contentOffsets: number[] = []
  const contentLengths: number[] = []
  for (let page = 0; page < npages; page++) {
    const pageStart = layout.offsetOf.get(pageRuns[page]![0]!)!
    const contentNumbers = h.pageContentObjects[page]!
      .map(n => h.oldToNew.get(n)!)
      .sort((a, b) => layout.offsetOf.get(a)! - layout.offsetOf.get(b)!)
    if (contentNumbers.length === 0) {
      contentOffsets.push(0)
      contentLengths.push(0)
      continue
    }
    const firstContent = layout.offsetOf.get(contentNumbers[0]!)!
    const lastContent = contentNumbers[contentNumbers.length - 1]!
    const contentEnd = layout.offsetOf.get(lastContent)! + objLen(lastContent)
    contentOffsets.push(firstContent - pageStart)
    contentLengths.push(contentEnd - firstContent)
  }
  const minContentOffset = Math.min(...contentOffsets)
  const maxContentOffset = Math.max(...contentOffsets)
  const minContentLength = Math.min(...contentLengths)
  const maxContentLength = Math.max(...contentLengths)

  const w = new BitWriter()
  // ── Page offset hint table header (ISO 32000-1 F.3.4) ──
  const nbitsDeltaNobjects = nbits(maxNobjects - minNobjects)
  const nbitsDeltaPageLength = nbits(maxLength - minLength)
  const nbitsNshared = nbits(maxShared)
  const nbitsSharedId = nbits(Math.max(0, sharedList.length - 1))
  // Hint-table offsets disregard the hint stream itself: an object at or after
  // the hint stream is stored with H_length subtracted, and the reader adds it
  // back (ISO 32000-1 F.3.1; qpdf adjusted_offset).
  const firstPageOffset = hintAdjust(layout.offsetOf.get(part6New[0]!) ?? 0, layout)
  w.writeBits(minNobjects, 32)                 // 1
  w.writeBits(firstPageOffset >>> 0, 32)       // 2
  w.writeBits(nbitsDeltaNobjects, 16)          // 3
  w.writeBits(minLength, 32)                   // 4
  w.writeBits(nbitsDeltaPageLength, 16)        // 5
  const nbitsDeltaContentOffset = nbits(maxContentOffset - minContentOffset)
  const nbitsDeltaContentLength = nbits(maxContentLength - minContentLength)
  w.writeBits(minContentOffset, 32)             // 6 min content offset
  w.writeBits(nbitsDeltaContentOffset, 16)      // 7
  w.writeBits(minContentLength, 32)             // 8 min content length
  w.writeBits(nbitsDeltaContentLength, 16)      // 9
  w.writeBits(nbitsNshared, 16)                // 10
  w.writeBits(nbitsSharedId, 16)               // 11
  w.writeBits(0, 16)                           // 12 nbits shared numerator
  w.writeBits(4, 16)                           // 13 shared denominator (unused)
  // Per-page rows (each vector flushes to a byte boundary).
  writeVector(w, nobjects.map(n => n - minNobjects), nbitsDeltaNobjects)
  writeVector(w, pageLengths.map(l => l - minLength), nbitsDeltaPageLength)
  writeVector(w, pageSharedIds.map(a => a.length), nbitsNshared)
  writeVectorVector(w, pageSharedIds, nbitsSharedId)
  writeVectorVector(w, pageSharedIds.map(a => a.map(() => 0)), 0) // shared numerators
  writeVector(w, contentOffsets.map(o => o - minContentOffset), nbitsDeltaContentOffset)
  writeVector(w, contentLengths.map(l => l - minContentLength), nbitsDeltaContentLength)

  const sByteOffset = w.count()

  // ── Shared object hint table (ISO 32000-1 F.3.5) ──
  const sharedLengths = sharedList.map(n => objLen(n))
  const minShared = sharedLengths.length > 0 ? Math.min(...sharedLengths) : 0
  const maxSharedLen = sharedLengths.length > 0 ? Math.max(...sharedLengths) : 0
  const nsharedFirstPage = part6New.length
  const nsharedTotal = sharedList.length
  const nbitsDeltaGroup = nbits(maxSharedLen - minShared)
  const firstSharedNew = nsharedTotal > nsharedFirstPage ? sharedList[nsharedFirstPage]! : 0
  const firstSharedOffset = firstSharedNew !== 0 ? hintAdjust(layout.offsetOf.get(firstSharedNew) ?? 0, layout) : 0
  w.writeBits(firstSharedNew >>> 0, 32)        // 1 first shared object number
  w.writeBits(firstSharedOffset >>> 0, 32)     // 2 first shared object offset
  w.writeBits(nsharedFirstPage, 32)            // 3
  w.writeBits(nsharedTotal, 32)                // 4
  w.writeBits(0, 16)                           // 5 nbits nobjects (Adobe uses 0)
  w.writeBits(minShared, 32)                   // 6 min group length
  w.writeBits(nbitsDeltaGroup, 16)             // 7
  writeVector(w, sharedLengths.map(l => l - minShared), nbitsDeltaGroup) // delta group length
  writeVector(w, sharedList.map(() => 0), 1)   // signature present (all 0)
  writeVector(w, sharedList.map(() => 0), 0)   // nobjects - 1 (0 bits → nothing)

  return { bytes: w.toBytes(), sOffset: sByteOffset }
}

function writeVector(w: BitWriter, values: number[], bits: number): void {
  for (const v of values) w.writeBits(v, bits)
  w.flush()
}

function writeVectorVector(w: BitWriter, rows: number[][], bits: number): void {
  for (const row of rows) for (const v of row) w.writeBits(v, bits)
  w.flush()
}

// --- file assembly ---------------------------------------------------------

interface AssembleInput {
  doc: ReturnType<typeof parsePdf>
  size: number
  catalogNew: number
  firstPageNew: number
  npages: number
  linDictNum: number
  hintNum: number
  headBeforeHint: number[]
  headAfterHint: number[]
  tailNew: number[]
  bodyOf: Map<number, Uint8Array>
  hint: { bytes: Uint8Array, sOffset: number }
  layout: Layout
}

function assembleFile(a: AssembleInput): Uint8Array {
  const { doc, size, catalogNew, firstPageNew, linDictNum, hintNum, layout } = a
  const parts: Uint8Array[] = []
  const push = (b: Uint8Array): void => { parts.push(b) }

  push(ENC.encode(headerForVersion(doc.headerVersion)))

  const idPair = getIdPair(doc)

  // Linearization parameter dictionary, padded to the reserved region.
  const linDict = `${linDictNum} 0 obj\n`
    + `<< /Linearized 1 /L ${layout.fileLength} /H [ ${layout.hintOffset} ${layout.hintObjLen} ] `
    + `/O ${firstPageNew} /E ${layout.firstPageEnd} /N ${a.npages} /T ${layout.mainXrefTOffset} >>\nendobj\n`
  push(padTo(linDict, layout.linDictRegionLen))

  // First-page cross-reference table + trailer.
  const headNums = [linDictNum, ...a.headBeforeHint, hintNum, ...a.headAfterHint]
  push(buildXref(linDictNum, headNums, layout))
  push(buildFirstTrailer(size, catalogNew, layout.mainXrefOffset, idPair))

  // part4 (catalog + open-doc objects).
  for (const n of a.headBeforeHint) push(objectBytes(n, a.bodyOf.get(n)!))
  // hint stream object.
  push(buildHintObject(hintNum, a.hint.bytes, a.hint.sOffset))
  // part6 (first page section).
  for (const n of a.headAfterHint) push(objectBytes(n, a.bodyOf.get(n)!))
  // tail objects.
  for (const n of a.tailNew) push(objectBytes(n, a.bodyOf.get(n)!))

  // Main cross-reference table + trailer.
  push(buildMainXref(a.tailNew, layout))
  push(buildMainTrailer(a.tailNew.length + 1, idPair, layout.firstPageXrefOffset))

  return concat(parts)
}

function objectBytes(num: number, body: Uint8Array): Uint8Array {
  const head = ENC.encode(`${num} 0 obj\n`)
  const tail = ENC.encode('\nendobj\n')
  const out = new Uint8Array(head.length + body.length + tail.length)
  out.set(head, 0); out.set(body, head.length); out.set(tail, head.length + body.length)
  return out
}

function buildHintObject(num: number, hint: Uint8Array, sOffset: number): Uint8Array {
  const head = ENC.encode(`${num} 0 obj\n<< /Length ${hint.length} /S ${sOffset} >>\nstream\n`)
  const tail = ENC.encode('\nendstream\nendobj\n')
  const out = new Uint8Array(head.length + hint.length + tail.length)
  out.set(head, 0); out.set(hint, head.length); out.set(tail, head.length + hint.length)
  return out
}

function padTo(s: string, region: number): Uint8Array {
  const bytes = ENC.encode(s)
  if (bytes.length > region) throw new Error(`linearizePdf: linearization dict ${bytes.length} exceeds reserved ${region}`)
  const out = new Uint8Array(region)
  out.set(bytes, 0)
  // Pad with spaces after endobj (before the following xref).
  out.fill(0x20, bytes.length)
  return out
}

function buildXref(start: number, nums: number[], layout: Layout): Uint8Array {
  let s = `xref\n${start} ${nums.length}\n`
  for (const n of nums) {
    s += `${String(layout.offsetOf.get(n) ?? 0).padStart(10, '0')} 00000 n \n`
  }
  return ENC.encode(s)
}

function buildFirstTrailer(size: number, root: number, prev: number, id: string): Uint8Array {
  let s = `trailer\n<< /Size ${size} /Root ${root} 0 R /Prev ${prev}`
  if (id) s += ` /ID [${id}]`
  s += ' >>\n'
  const bytes = ENC.encode(s)
  const region = firstTrailerRegionFor(id)
  if (bytes.length + 'startxref\n0\n%%EOF\n'.length > region) {
    throw new Error(`linearizePdf: first trailer too large (${bytes.length})`)
  }
  const out = new Uint8Array(region)
  const startxref = ENC.encode('startxref\n0\n%%EOF\n')
  out.set(bytes, 0)
  out.fill(0x20, bytes.length, region - startxref.length)
  out.set(startxref, region - startxref.length)
  return out
}

function buildMainXref(tailNew: number[], layout: Layout): Uint8Array {
  let s = `xref\n0 ${tailNew.length + 1}\n0000000000 65535 f \n`
  for (const n of tailNew) {
    s += `${String(layout.offsetOf.get(n) ?? 0).padStart(10, '0')} 00000 n \n`
  }
  return ENC.encode(s)
}

function buildMainTrailer(size: number, id: string, firstXrefOffset: number): Uint8Array {
  let prefix = `trailer\n<< /Size ${size}`
  if (id) prefix += ` /ID [${id}]`
  prefix += ' >>\n'
  const prefixBytes = ENC.encode(prefix)
  const suffixBytes = ENC.encode(`startxref\n${firstXrefOffset}\n%%EOF\n`)
  const region = mainTrailerRegionFor(id)
  if (prefixBytes.length + suffixBytes.length > region) {
    throw new Error(`linearizePdf: main trailer too large (${prefixBytes.length + suffixBytes.length})`)
  }
  const out = new Uint8Array(region)
  out.set(prefixBytes, 0)
  out.fill(0x20, prefixBytes.length, region - suffixBytes.length)
  out.set(suffixBytes, region - suffixBytes.length)
  return out
}

function getIdPair(doc: ReturnType<typeof parsePdf>): string {
  const id = doc.trailer.get('ID')
  if (Array.isArray(id) && id.length === 2 && id[0] instanceof PdfString && id[1] instanceof PdfString) {
    return `${hex(id[0].bytes)} ${hex(id[1].bytes)}`
  }
  return ''
}

function hex(bytes: Uint8Array): string {
  let s = '<'
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0')
  return s + '>'
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of parts) { out.set(p, pos); pos += p.length }
  return out
}
