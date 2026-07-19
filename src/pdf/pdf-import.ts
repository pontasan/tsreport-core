/**
 * External PDF page import + merge
 *
 * Reads a set of existing PDF files and concatenates all pages into a single PDF.
 * Intended for appending existing PDFs (terms and conditions, attachments, etc.)
 * after an engine-generated report PDF.
 *
 * - Walks each PDF's Pages tree to collect all Page objects
 * - Sets inheritable attributes (Resources / MediaBox / CropBox / Rotate) explicitly on each page
 * - Recursively copies referenced objects such as Contents / Resources / Annots
 *   (renumbering object numbers)
 * - Output is PDF 1.7 with a single classic xref table
 */

import {
  PdfDocument, parsePdf, PdfName, PdfRef, PdfStream, PdfString,
  type PdfDict, type PdfValue,
} from './pdf-parser.js'

// ─── Public API ───

/** Info for one page collected from the Pages tree */
export interface CollectedPage {
  /** Indirect reference to the Page object */
  ref: PdfRef
  /** Page dictionary */
  dict: PdfDict
  /** Inheritance-resolved /Resources (the page's own or an ancestor's) */
  resources: PdfValue
  /** Inheritance-resolved /MediaBox */
  mediaBox: PdfValue
  /** Inheritance-resolved /CropBox */
  cropBox: PdfValue
  /** Inheritance-resolved /Rotate */
  rotate: PdfValue
}

export interface PdfMergeOptions {
  password?: string
  passwords?: string[]
}

/**
 * Walk the Pages tree and collect all pages in document order.
 * Inheritable attributes (§7.7.3.4) are resolved from ancestor nodes onto each page.
 */
export function collectPdfPages(doc: PdfDocument): CollectedPage[] {
  const catalog = doc.getCatalog()
  const pagesRef = catalog.get('Pages')
  if (!(pagesRef instanceof PdfRef)) {
    throw new Error('PDF import error: /Pages in catalog must be an indirect reference')
  }
  const pages: CollectedPage[] = []
  const visited = new Set<number>()
  collectPagesFromNode(doc, pagesRef, null, null, null, null, null, pages, visited)
  return pages
}

/**
 * Return a single PDF concatenating multiple PDF files in order.
 *
 * Supported input: classic xref / cross-reference streams / object streams /
 * FlateDecode (including PNG and TIFF predictors) / incremental updates.
 * Standard Security Handler encrypted inputs require the matching password.
 */
export function mergePdfFiles(pdfs: Uint8Array[], options: PdfMergeOptions = {}): Uint8Array {
  if (pdfs.length === 0) {
    throw new Error('PDF merge error: no input PDF files')
  }

  const writer = new PdfOutputWriter()
  const catalogId = writer.alloc()
  const pagesId = writer.alloc()
  const pageIds: number[] = []

  for (let i = 0; i < pdfs.length; i++) {
    const password = options.passwords?.[i] ?? options.password
    const doc = parsePdf(pdfs[i]!, password === undefined ? {} : { password })
    const pages = collectPdfPages(doc)
    if (pages.length === 0) {
      throw new Error(`PDF merge error: input PDF #${i + 1} has no pages`)
    }

    const copier = new PdfObjectCopier(doc, writer)
    // Pre-register object numbers for all pages:
    // resolves references to other pages from annotations (/Dest, /P, etc.) without pulling in the old tree
    const newIds: number[] = []
    for (let pi = 0; pi < pages.length; pi++) {
      const newId = writer.alloc()
      copier.preRegister(pages[pi]!.ref.num, newId)
      newIds.push(newId)
    }
    for (let pi = 0; pi < pages.length; pi++) {
      copier.copyPage(pages[pi]!, newIds[pi]!, pagesId)
      pageIds.push(newIds[pi]!)
    }
  }

  // Pages node
  const kids: PdfValue[] = []
  for (let i = 0; i < pageIds.length; i++) {
    kids.push(new PdfRef(pageIds[i]!, 0))
  }
  const pagesDict: PdfDict = new Map()
  pagesDict.set('Type', new PdfName('Pages'))
  pagesDict.set('Kids', kids)
  pagesDict.set('Count', pageIds.length)
  writer.setObject(pagesId, pagesDict)

  // Catalog
  const catalogDict: PdfDict = new Map()
  catalogDict.set('Type', new PdfName('Catalog'))
  catalogDict.set('Pages', new PdfRef(pagesId, 0))
  writer.setObject(catalogId, catalogDict)

  return writer.serialize(catalogId)
}

// ─── Pages tree traversal ───

function collectPagesFromNode(
  doc: PdfDocument,
  nodeRef: PdfRef,
  expectedParent: PdfRef | null,
  resources: PdfValue,
  mediaBox: PdfValue,
  cropBox: PdfValue,
  rotate: PdfValue,
  out: CollectedPage[],
  visited: Set<number>,
): number {
  if (visited.has(nodeRef.num)) {
    throw new Error('PDF import error: circular reference in Pages tree')
  }
  visited.add(nodeRef.num)

  const node = doc.getObject(nodeRef.num)
  if (!(node instanceof Map)) {
    throw new Error(`PDF import error: Pages tree node ${nodeRef.num} is not a dictionary`)
  }

  // Update inheritable attributes (§7.7.3.4)
  const ownResources = node.get('Resources')
  const ownMediaBox = node.get('MediaBox')
  const ownCropBox = node.get('CropBox')
  const ownRotate = node.get('Rotate')
  if (ownResources !== undefined) resources = ownResources
  if (ownMediaBox !== undefined) mediaBox = ownMediaBox
  if (ownCropBox !== undefined) cropBox = ownCropBox
  if (ownRotate !== undefined) rotate = ownRotate

  const typeName = doc.resolve(node.get('Type') ?? null)
  const kids = node.get('Kids')
  const isPages = typeName instanceof PdfName && typeName.name === 'Pages'

  const parent = node.get('Parent')
  if (expectedParent === null) {
    if (!isPages) throw new Error('PDF import error: page tree root Type must be /Pages')
    if (parent !== undefined) throw new Error('PDF import error: page tree root must not have Parent')
  } else if (!(parent instanceof PdfRef) || parent.num !== expectedParent.num || parent.gen !== expectedParent.gen) {
    throw new Error(`PDF import error: page tree node ${nodeRef.num} has an invalid Parent`)
  }

  if (isPages) {
    if (kids === undefined) throw new Error(`PDF import error: /Kids missing from Pages node ${nodeRef.num}`)
    const kidsArr = doc.resolve(kids ?? null)
    if (!Array.isArray(kidsArr)) {
      throw new Error(`PDF import error: /Kids of Pages node ${nodeRef.num} is not an array`)
    }
    let descendantCount = 0
    for (let i = 0; i < kidsArr.length; i++) {
      const kid = kidsArr[i]!
      if (!(kid instanceof PdfRef)) {
        throw new Error(`PDF import error: /Kids entry of Pages node ${nodeRef.num} must be an indirect reference`)
      }
      descendantCount += collectPagesFromNode(doc, kid, nodeRef, resources, mediaBox, cropBox, rotate, out, visited)
    }
    const declaredCount = doc.resolve(node.get('Count') ?? null)
    if (typeof declaredCount !== 'number' || !Number.isInteger(declaredCount) || declaredCount < 0) {
      throw new Error(`PDF import error: /Count of Pages node ${nodeRef.num} must be a non-negative integer`)
    }
    if (declaredCount !== descendantCount) {
      throw new Error(`PDF import error: /Count of Pages node ${nodeRef.num} is ${declaredCount}, expected ${descendantCount}`)
    }
    return descendantCount
  }

  if (!(typeName instanceof PdfName) || typeName.name !== 'Page') {
    throw new Error(`PDF import error: page tree leaf ${nodeRef.num} Type must be /Page`)
  }
  if (kids !== undefined) throw new Error(`PDF import error: Page object ${nodeRef.num} must not have Kids`)

  if (mediaBox === undefined || mediaBox === null) {
    throw new Error(`PDF import error: page ${nodeRef.num} has no /MediaBox (own or inherited)`)
  }
  const resolvedResources = doc.resolve(resources ?? null)
  if (!(resolvedResources instanceof Map)) {
    throw new Error(`PDF import error: page ${nodeRef.num} has no valid /Resources (own or inherited)`)
  }

  out.push({
    ref: nodeRef,
    dict: node,
    resources: resources ?? null,
    mediaBox,
    cropBox: cropBox ?? null,
    rotate: rotate ?? null,
  })
  return 1
}

// ─── Object copying (renumbering) ───

/** Sentinel indicating already copied (resolved to null) */
const NULL_OBJECT_ID = -1

class PdfObjectCopier {
  private readonly src: PdfDocument
  private readonly writer: PdfOutputWriter
  /** Old object number → new object number (NULL_OBJECT_ID = resolved to null) */
  private readonly map = new Map<number, number>()

  constructor(src: PdfDocument, writer: PdfOutputWriter) {
    this.src = src
    this.writer = writer
  }

  /** Pre-register a page object's number (the content is written by copyPage) */
  preRegister(oldNum: number, newId: number): void {
    this.map.set(oldNum, newId)
  }

  /**
   * Copy a page to the output.
   * - /Parent is repointed to the new Pages node
   * - /StructParents and /B are removed because document-level structures (structure tree / article threads) are not copied
   * - Inheritable attributes are set explicitly
   */
  copyPage(page: CollectedPage, newId: number, newPagesId: number): void {
    const sanitized: PdfDict = new Map()
    for (const [key, value] of page.dict) {
      if (key === 'Parent' || key === 'StructParents' || key === 'B') continue
      sanitized.set(key, value)
    }
    // Make inheritable attributes explicit (§7.7.3.4)
    if (!sanitized.has('Resources') && page.resources !== null) {
      sanitized.set('Resources', page.resources)
    }
    if (!sanitized.has('MediaBox')) {
      sanitized.set('MediaBox', page.mediaBox)
    }
    if (!sanitized.has('CropBox') && page.cropBox !== null) {
      sanitized.set('CropBox', page.cropBox)
    }
    if (!sanitized.has('Rotate') && page.rotate !== null) {
      sanitized.set('Rotate', page.rotate)
    }

    const translated = this.translateValue(sanitized)
    if (!(translated instanceof Map)) {
      throw new Error('PDF import error: page dictionary translation failed')
    }
    // Set after translateValue so it is not translated twice (newPagesId is an output-side ID)
    translated.set('Parent', new PdfRef(newPagesId, 0))
    this.writer.setObject(newId, translated)
  }

  /** Recursively copy a value, repointing indirect references to new object numbers */
  private translateValue(value: PdfValue): PdfValue {
    if (value instanceof PdfRef) {
      return this.translateRef(value)
    }
    if (value instanceof PdfStream) {
      const dict: PdfDict = new Map()
      for (const [key, v] of value.dict) {
        // /Length is recomputed from the raw data length at serialization time
        // (also prevents dragging in a copy of an indirect-reference Length)
        if (key === 'Length') continue
        dict.set(key, this.translateValue(v))
      }
      return new PdfStream(dict, value.raw)
    }
    if (Array.isArray(value)) {
      const arr: PdfValue[] = []
      for (let i = 0; i < value.length; i++) {
        arr.push(this.translateValue(value[i]!))
      }
      return arr
    }
    if (value instanceof Map) {
      const dict: PdfDict = new Map()
      for (const [key, v] of value) {
        dict.set(key, this.translateValue(v))
      }
      return dict
    }
    // null / boolean / number / PdfName / PdfString can be shared as-is (immutable)
    return value
  }

  private translateRef(ref: PdfRef): PdfValue {
    const mapped = this.map.get(ref.num)
    if (mapped !== undefined) {
      return mapped === NULL_OBJECT_ID ? null : new PdfRef(mapped, 0)
    }

    const obj = this.src.getObject(ref.num)
    if (obj === null) {
      // References to free objects are null (§7.3.10)
      this.map.set(ref.num, NULL_OBJECT_ID)
      return null
    }

    // Circular reference protection: fix the number before translating the content
    const newId = this.writer.alloc()
    this.map.set(ref.num, newId)
    this.writer.setObject(newId, this.translateValue(obj))
    return new PdfRef(newId, 0)
  }
}

// ─── PDF output ───

class PdfOutputWriter {
  private nextId = 0
  private readonly objects = new Map<number, PdfValue>()

  alloc(): number {
    return ++this.nextId
  }

  setObject(id: number, value: PdfValue): void {
    this.objects.set(id, value)
  }

  /** Serialize all objects + classic xref table + trailer */
  serialize(rootId: number): Uint8Array {
    const chunks: Uint8Array[] = []
    let offset = 0

    const push = (bytes: Uint8Array): void => {
      chunks.push(bytes)
      offset += bytes.length
    }

    push(encodeLatin1('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'))

    const offsets = new Array<number>(this.nextId + 1).fill(0)
    for (let id = 1; id <= this.nextId; id++) {
      const obj = this.objects.get(id)
      if (obj === undefined) {
        throw new Error(`PDF merge error: object ${id} was allocated but never written`)
      }
      offsets[id] = offset
      push(encodeLatin1(`${id} 0 obj\n`))
      if (obj instanceof PdfStream) {
        push(encodeLatin1(serializeStreamDict(obj)))
        push(encodeLatin1('\nstream\n'))
        push(obj.raw)
        push(encodeLatin1('\nendstream\nendobj\n'))
      } else {
        push(encodeLatin1(serializeValue(obj)))
        push(encodeLatin1('\nendobj\n'))
      }
    }

    // Classic xref table
    const xrefOffset = offset
    const size = this.nextId + 1
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
    for (let id = 1; id <= this.nextId; id++) {
      xref += `${offsets[id]!.toString().padStart(10, '0')} 00000 n \n`
    }
    xref += `trailer\n<< /Size ${size} /Root ${rootId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    push(encodeLatin1(xref))

    const result = new Uint8Array(offset)
    let pos = 0
    for (let i = 0; i < chunks.length; i++) {
      result.set(chunks[i]!, pos)
      pos += chunks[i]!.length
    }
    return result
  }
}

// ─── Serialization helpers ───

function encodeLatin1(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    bytes[i] = s.charCodeAt(i) & 0xFF
  }
  return bytes
}

/** Serialize a stream dictionary (/Length is fixed to the raw length) */
function serializeStreamDict(stream: PdfStream): string {
  let s = `<< /Length ${stream.raw.length}`
  for (const [key, value] of stream.dict) {
    if (key === 'Length') continue
    s += ` ${serializeName(key)} ${serializeValue(value)}`
  }
  return s + ' >>'
}

function serializeValue(value: PdfValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return formatPdfNumber(value)
  if (value instanceof PdfName) return serializeName(value.name)
  if (value instanceof PdfString) return serializeString(value.bytes)
  if (value instanceof PdfRef) return `${value.num} ${value.gen} R`
  if (Array.isArray(value)) {
    let s = '['
    for (let i = 0; i < value.length; i++) {
      if (i > 0) s += ' '
      s += serializeValue(value[i]!)
    }
    return s + ']'
  }
  if (value instanceof Map) {
    let s = '<<'
    for (const [key, v] of value) {
      s += ` ${serializeName(key)} ${serializeValue(v)}`
    }
    return s + ' >>'
  }
  // PdfStream only appears as an indirect object (invalid as a direct value)
  throw new Error('PDF merge error: stream cannot be serialized as a direct value')
}

function serializeName(name: string): string {
  let s = '/'
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    // Anything other than regular characters (0x21-0x7E, excluding delimiters and #) is #XX-escaped (§7.3.5)
    if (c >= 0x21 && c <= 0x7E && c !== 0x23
      && c !== 0x28 && c !== 0x29 && c !== 0x3C && c !== 0x3E
      && c !== 0x5B && c !== 0x5D && c !== 0x7B && c !== 0x7D
      && c !== 0x2F && c !== 0x25) {
      s += name[i]!
    } else {
      s += '#' + (c & 0xFF).toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return s
}

/** Strings are output in hex notation (preserves the byte sequence without conversion) */
function serializeString(bytes: Uint8Array): string {
  let s = '<'
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).toUpperCase().padStart(2, '0')
  }
  return s + '>'
}

function formatPdfNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) <= 0x7FFFFFFFFF) {
    return n.toString()
  }
  // Real number: exponential notation is invalid in PDF, so output fixed-point and strip trailing zeros
  let s = n.toFixed(10)
  let end = s.length
  while (end > 0 && s[end - 1] === '0') end--
  if (end > 0 && s[end - 1] === '.') end--
  s = s.substring(0, end)
  return s.length === 0 || s === '-' ? '0' : s
}
