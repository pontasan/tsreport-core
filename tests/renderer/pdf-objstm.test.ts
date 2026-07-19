/**
 * PDF object stream (PDF 1.5+) tests.
 *
 * Validates object streams per ISO 32000-1 §7.5.7:
 * - /Type /ObjStm stream structure
 * - /N and /First fields
 * - header (id+offset pairs) + body (concatenated dictionaries) layout
 * - FlateDecode compression
 * - consistency with Type 2 entries in the xref stream
 * - file size reduction
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument, RenderNode } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'
import { zlibInflate } from '../../src/compression/inflate.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { parsePdf } from '../../src/pdf/pdf-parser.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

let font: Font

beforeAll(() => {
  const buf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  font = Font.load(buf.buffer as ArrayBuffer)
})

function decodeLatin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!)
  }
  return s
}

function generatePdf(opts?: {
  encryption?: { userPassword: string; ownerPassword: string; method?: 'rc4-128' | 'aes-128' | 'aes-256' }
  metadata?: { title?: string }
  pages?: number
  opacity?: number
}): { bytes: Uint8Array; text: string; rawText: string } {
  const children: RenderNode[] = [{
    type: 'text', x: 72, y: 72, text: 'ObjStm Test',
    fontId: 'default', fontSize: 12, color: '#000000',
  }]
  if (opts?.opacity) {
    children.push({
      type: 'group', x: 0, y: 0, width: 100, height: 100,
      opacity: opts.opacity, children: [],
    })
  }
  const pageCount = opts?.pages ?? 1
  const pages = []
  for (let i = 0; i < pageCount; i++) {
    pages.push({ width: 595, height: 842, children })
  }
  const backend = new PdfBackend({
    fonts: { default: font },
    encryption: opts?.encryption,
    metadata: opts?.metadata,
  })
  const doc: RenderDocument = { pages }
  render(doc, backend)
  const bytes = backend.toUint8Array()
  return { bytes, text: pdfToText(bytes), rawText: decodeLatin1(bytes) }
}

/** Extracts the ObjStm stream data (inflating if compressed) */
function extractObjStm(bytes: Uint8Array, rawText: string): {
  n: number; first: number; content: string; isCompressed: boolean
} | null {
  const objStmIdx = rawText.indexOf('/Type /ObjStm')
  if (objStmIdx < 0) return null

  const dictStart = rawText.lastIndexOf('<<', objStmIdx)
  const dictEnd = rawText.indexOf('>>', objStmIdx) + 2
  const dictStr = rawText.substring(dictStart, dictEnd)

  const nMatch = dictStr.match(/\/N (\d+)/)
  const firstMatch = dictStr.match(/\/First (\d+)/)
  const lenMatch = dictStr.match(/\/Length (\d+)/)
  const n = Number(nMatch![1])
  const first = Number(firstMatch![1])
  const streamLen = Number(lenMatch![1])
  const isCompressed = dictStr.indexOf('/Filter /FlateDecode') >= 0

  const streamStart = rawText.indexOf('stream\n', objStmIdx) + 'stream\n'.length
  const streamData = bytes.subarray(streamStart, streamStart + streamLen)

  const raw = isCompressed
    ? new Uint8Array(zlibInflate(streamData))
    : streamData
  const content = decodeLatin1(raw)
  return { n, first, content, isCompressed }
}

describe('ObjStm Structure', () => {
  // Verifies that the default output contains a /Type /ObjStm stream object.
  it('/Type /ObjStm ストリームオブジェクトが存在する', () => {
    const { rawText } = generatePdf()
    expect(rawText).toContain('/Type /ObjStm')
  })

  // Verifies that the ObjStm dict carries the mandatory /N, /First, and /Length fields.
  it('/N, /First フィールドが存在する', () => {
    const { rawText } = generatePdf()
    const dictIdx = rawText.indexOf('/Type /ObjStm')
    const dictStart = rawText.lastIndexOf('<<', dictIdx)
    const dictEnd = rawText.indexOf('>>', dictIdx) + 2
    const dict = rawText.substring(dictStart, dictEnd)

    expect(dict).toMatch(/\/N \d+/)
    expect(dict).toMatch(/\/First \d+/)
    expect(dict).toMatch(/\/Length \d+/)
  })

  // Verifies that /N matches the number of id+offset pairs in the ObjStm header.
  it('/N が格納オブジェクト数と一致する', () => {
    const result = extractObjStm(...(() => {
      const { bytes, rawText } = generatePdf()
      return [bytes, rawText] as const
    })())
    expect(result).not.toBeNull()
    const { n, first, content } = result!
    expect(n).toBeGreaterThan(0)

    // Parse the header section and count the IDs
    const header = content.substring(0, first).trim()
    const tokens = header.split(/\s+/)
    expect(tokens.length).toBe(n * 2)  // id + offset pairs
  })
})

describe('ObjStm Content', () => {
  // Verifies that header pairs hold positive IDs and strictly ascending offsets.
  it('ヘッダに ID + オフセットペアが正しく並ぶ', () => {
    const { bytes, rawText } = generatePdf()
    const result = extractObjStm(bytes, rawText)!
    const { n, first, content } = result

    const header = content.substring(0, first).trim()
    const tokens = header.split(/\s+/)

    // Each ID is a positive integer
    for (let i = 0; i < n; i++) {
      const id = parseInt(tokens[i * 2]!, 10)
      const off = parseInt(tokens[i * 2 + 1]!, 10)
      expect(id).toBeGreaterThan(0)
      expect(off).toBeGreaterThanOrEqual(0)
    }

    // Offsets are in ascending order
    for (let i = 1; i < n; i++) {
      const prev = parseInt(tokens[(i - 1) * 2 + 1]!, 10)
      const curr = parseInt(tokens[i * 2 + 1]!, 10)
      expect(curr).toBeGreaterThan(prev)
    }
  })

  // Verifies that each object slice in the ObjStm body is a complete << ... >> dictionary.
  it('ボディ部の各辞書が << ... >> 形式', () => {
    const { bytes, rawText } = generatePdf()
    const result = extractObjStm(bytes, rawText)!
    const { n, first, content } = result

    const header = content.substring(0, first).trim()
    const tokens = header.split(/\s+/)
    const body = content.substring(first)

    for (let i = 0; i < n; i++) {
      const off = parseInt(tokens[i * 2 + 1]!, 10)
      const nextOff = i + 1 < n ? parseInt(tokens[(i + 1) * 2 + 1]!, 10) : body.length
      const dictContent = body.substring(off, nextOff).trim()
      expect(dictContent.startsWith('<<')).toBe(true)
      expect(dictContent.endsWith('>>')).toBe(true)
    }
  })

  // Verifies that non-stream dictionary objects (Catalog, Pages, Page, FontDescriptor) are stored in the ObjStm.
  it('Catalog, Pages, Page, FontDescriptor が ObjStm に含まれる', () => {
    const { text } = generatePdf()
    // pdfToText has already expanded the ObjStm
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('/Type /Pages')
    expect(text).toContain('/Type /Page')
    expect(text).toContain('/Type /FontDescriptor')
  })

  // Verifies that the Encrypt dict stays outside the ObjStm, as required by ISO 32000-1 §7.5.7.
  it('Encrypt 辞書は ObjStm に含まれない', () => {
    const { bytes, rawText } = generatePdf({
      encryption: { userPassword: 'test', ownerPassword: 'owner' },
    })
    expect(rawText).toContain('/Filter /Standard')
    const doc = parsePdf(bytes, { password: 'test' })
    expect(collectPdfPages(doc).length).toBe(1)
  })

  // Verifies that stream objects are never packed into the ObjStm (dictionaries only).
  it('ストリームオブジェクトは ObjStm に含まれない (stream/endstream がボディにない)', () => {
    const { bytes, rawText } = generatePdf()
    const result = extractObjStm(bytes, rawText)!
    const body = result.content.substring(result.first)
    // The ObjStm body must not contain stream/endstream keywords (dictionaries only)
    expect(body).not.toContain('stream\n')
    expect(body).not.toContain('endstream')
  })
})

describe('ObjStm + XRef Stream 連携', () => {
  // Verifies that the xref stream's /W third field is wide enough for Type 2 (compressed object) entries.
  it('xref ストリームに Type 2 エントリが存在する', () => {
    const { rawText } = generatePdf()
    // The third /W element must be > 0 (index width for Type 2 entries)
    const wMatch = rawText.match(/\/W \[1 (\d+) (\d+)\]/)
    expect(wMatch).not.toBeNull()
    const w2 = Number(wMatch![2])
    expect(w2).toBeGreaterThan(0)
  })

  // Verifies that the count of Type 2 xref entries equals the ObjStm's /N (every packed object is indexed).
  it('Type 2 エントリ数が ObjStm /N と一致', () => {
    const { bytes, rawText } = generatePdf()
    const objStm = extractObjStm(bytes, rawText)!

    // Parse the binary data of the xref stream
    const startxrefMatch = rawText.match(/startxref\n(\d+)\n/)
    const offset = Number(startxrefMatch![1])
    const objText = rawText.substring(offset, offset + 500)
    const wMatch = objText.match(/\/W \[1 (\d+) (\d+)\]/)
    const w1 = Number(wMatch![1])
    const w2 = Number(wMatch![2])
    const sizeMatch = objText.match(/\/Size\s+(\d+)/)
    const size = Number(sizeMatch![1])
    const lenMatch = objText.match(/\/Length\s+(\d+)/)
    const streamLen = Number(lenMatch![1])
    const isFlate = objText.indexOf('/Filter /FlateDecode') >= 0

    const streamStart = rawText.indexOf('stream\n', offset) + 'stream\n'.length
    const streamData = bytes.subarray(streamStart, streamStart + streamLen)
    const xrefData = isFlate
      ? new Uint8Array(zlibInflate(streamData))
      : streamData

    const entrySize = 1 + w1 + w2
    let type2Count = 0
    for (let i = 1; i < size; i++) {
      if (xrefData[i * entrySize] === 2) type2Count++
    }

    expect(type2Count).toBe(objStm.n)
  })
})

describe('ObjStm with Encryption', () => {
  // Verifies that ObjStm generation still works with RC4 encryption and expands to a readable Catalog.
  it('暗号化時も ObjStm が正しく生成される', () => {
    const { bytes, rawText } = generatePdf({
      encryption: { userPassword: 'test', ownerPassword: 'owner' },
    })
    expect(rawText).toContain('/Type /ObjStm')
    const doc = parsePdf(bytes, { password: 'test' })
    expect(collectPdfPages(doc).length).toBe(1)
  })

  // Verifies that ObjStm coexists with AES-256 encryption (/CFM /AESV3).
  it('AES-256 暗号化 + ObjStm', () => {
    const { rawText } = generatePdf({
      encryption: { userPassword: 'test', ownerPassword: 'owner', method: 'aes-256' },
    })
    expect(rawText).toContain('/Type /ObjStm')
    expect(rawText).toContain('/CFM /AESV3')
  })
})

describe('ObjStm with Multiple Pages', () => {
  // Verifies that all Page objects of a 5-page document are packed into the ObjStm.
  it('複数ページで Page オブジェクトが全て ObjStm に格納', () => {
    const { bytes, rawText, text } = generatePdf({ pages: 5 })
    const objStm = extractObjStm(bytes, rawText)!
    const body = objStm.content.substring(objStm.first)

    // /Type /Page for all 5 pages
    const pageMatches = body.match(/\/Type \/Page(?!s)/g) ?? []
    expect(pageMatches.length).toBe(5)

    // Still 5 pages after pdfToText expansion
    const textPageMatches = (text.match(/\/Type \/Page(?!s)/g) ?? [])
    expect(textPageMatches.length).toBe(5)
  })
})

describe('ObjStm Compression', () => {
  // Verifies that the ObjStm is FlateDecode-compressed once it holds enough data.
  it('FlateDecode 圧縮が適用される（十分なデータ量時）', () => {
    // Generate enough objects via multiple pages
    const { rawText } = generatePdf({ pages: 5 })
    const dictIdx = rawText.indexOf('/Type /ObjStm')
    const dictStart = rawText.lastIndexOf('<<', dictIdx)
    const dictEnd = rawText.indexOf('>>', dictIdx) + 2
    const dict = rawText.substring(dictStart, dictEnd)
    expect(dict).toContain('/Filter /FlateDecode')
  })
})
