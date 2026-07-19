/**
 * PDF cross-reference stream (PDF 1.5+) tests.
 *
 * Validates binary xref streams per ISO 32000-1 §7.5.8:
 * - /Type /XRef stream structure
 * - /W field widths and binary entries
 * - startxref → xref stream object offset consistency
 * - FlateDecode compression
 * - combination with encryption
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
}): { bytes: Uint8Array; text: string; rawText: string } {
  const children: RenderNode[] = [{
    type: 'text', x: 72, y: 72, text: 'XRef Stream Test',
    fontId: 'default', fontSize: 12, color: '#000000',
  }]
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

describe('XRef Stream Structure', () => {
  // Verifies that a /Type /XRef stream object is emitted instead of a classic xref table.
  it('/Type /XRef ストリームオブジェクトが存在する', () => {
    const { text } = generatePdf()
    expect(text).toContain('/Type /XRef')
  })

  // Verifies that no legacy ASCII xref table or trailer keyword appears in the output.
  it('従来の ASCII xref テーブルが存在しない', () => {
    const { rawText } = generatePdf()
    // The "xref\n0 " pattern would indicate a legacy ASCII xref table
    expect(rawText).not.toMatch(/^xref\n/m)
    expect(rawText).not.toContain('trailer\n')
  })

  // Verifies that /W declares sane field widths: type byte, offset/objstm width 1-4, gen/index width 0-2.
  it('/W フィールド幅が [1 N M] 形式', () => {
    const { text } = generatePdf()
    // W[0]=1 (type), W[1]=offset/objstm width, W[2]=gen/index width
    // With ObjStm in use, W[2] > 0 (index width for Type 2 entries)
    const wMatch = text.match(/\/W \[1 (\d+) (\d+)\]/)
    expect(wMatch).not.toBeNull()
    const w1 = Number(wMatch![1])
    const w2 = Number(wMatch![2])
    expect(w1).toBeGreaterThanOrEqual(1)
    expect(w1).toBeLessThanOrEqual(4)
    expect(w2).toBeGreaterThanOrEqual(0)
    expect(w2).toBeLessThanOrEqual(2)
  })

  // Verifies that /Size covers at least the minimum object set (free entry, Catalog, Pages, xref stream).
  it('/Size が全オブジェクト数 + 1 以上', () => {
    const { text } = generatePdf()
    // Read /Size
    const sizeMatch = text.match(/\/Size\s+(\d+)/)
    expect(sizeMatch).not.toBeNull()
    const size = Number(sizeMatch![1])
    // At minimum: free(1) + catalog(1) + pages(1) + xref stream(1) = 4
    expect(size).toBeGreaterThanOrEqual(4)
  })

  // Verifies that the xref stream dict's /Root points at an existing Catalog object.
  it('/Root が Catalog を参照', () => {
    const { text } = generatePdf()
    expect(text).toMatch(/\/Root \d+ 0 R/)
    // The Catalog exists
    expect(text).toContain('/Type /Catalog')
  })

  // Verifies that the startxref byte offset lands exactly on the xref stream's "N 0 obj" header.
  it('startxref が xref ストリームオブジェクトを指す', () => {
    const { rawText } = generatePdf()
    const startxrefMatch = rawText.match(/startxref\n(\d+)\n/)
    expect(startxrefMatch).not.toBeNull()
    const offset = Number(startxrefMatch![1])
    // "N 0 obj" is located at that offset
    const atOffset = rawText.substring(offset, offset + 20)
    expect(atOffset).toMatch(/^\d+ 0 obj/)
  })

  // Verifies that the file ends with the %%EOF marker.
  it('%%EOF で終端する', () => {
    const { rawText } = generatePdf()
    expect(rawText.trimEnd()).toMatch(/%%EOF$/)
  })
})

describe('XRef Stream Binary Data', () => {
  /** Extracts and inflates the xref stream data */
  function extractXrefData(bytes: Uint8Array, rawText: string): {
    data: Uint8Array; w1: number; w2: number; size: number; isCompressed: boolean
  } {
    const startxrefMatch = rawText.match(/startxref\n(\d+)\n/)
    const offset = Number(startxrefMatch![1])
    const objText = rawText.substring(offset, offset + 500)
    const lengthMatch = objText.match(/\/Length\s+(\d+)/)
    const streamLength = Number(lengthMatch![1])
    const wMatch = objText.match(/\/W \[1 (\d+) (\d+)\]/)
    const w1 = Number(wMatch![1])
    const w2 = Number(wMatch![2])
    const sizeMatch = objText.match(/\/Size\s+(\d+)/)
    const size = Number(sizeMatch![1])
    const isCompressed = objText.indexOf('/Filter /FlateDecode') >= 0

    const streamStart = rawText.indexOf('stream\n', offset) + 'stream\n'.length
    const streamData = bytes.subarray(streamStart, streamStart + streamLength)

    const data = isCompressed
      ? new Uint8Array(zlibInflate(streamData))
      : streamData
    return { data, w1, w2, size, isCompressed }
  }

  // Verifies the decoded xref data is exactly Size*entrySize bytes, entry 0 is free, and all others are type 1 or 2.
  it('バイナリエントリ構造が正しい (type + offset/objstm)', () => {
    const { bytes, rawText } = generatePdf()
    const { data, w1, w2, size } = extractXrefData(bytes, rawText)
    const entrySize = 1 + w1 + w2

    expect(data.length).toBe(size * entrySize)

    // Entry 0 is free (type = 0)
    expect(data[0]).toBe(0)

    // Entries 1+ are in-use (type = 1) or compressed (type = 2)
    for (let i = 1; i < size; i++) {
      const type = data[i * entrySize]
      expect(type === 1 || type === 2).toBe(true)
    }
  })

  // Verifies that every Type 1 entry's byte offset points at an actual "N 0 obj" header.
  it('Type 1 エントリのオフセットが実際のオブジェクト位置と一致', () => {
    const { bytes, rawText } = generatePdf()
    const { data, w1, w2, size } = extractXrefData(bytes, rawText)
    const entrySize = 1 + w1 + w2

    for (let i = 1; i < size; i++) {
      const entryOff = i * entrySize
      if (data[entryOff] !== 1) continue // skip Type 2 entries

      let off = 0
      for (let j = 0; j < w1; j++) {
        off = (off << 8) | data[entryOff + 1 + j]!
      }
      const atOff = rawText.substring(off, off + 20)
      expect(atOff).toMatch(/^\d+ 0 obj/)
    }
  })

  // Verifies that each Type 2 entry references an ObjStm object that itself has a Type 1 entry.
  it('Type 2 エントリが ObjStm を参照', () => {
    const { bytes, rawText } = generatePdf()
    const { data, w1, w2, size } = extractXrefData(bytes, rawText)
    const entrySize = 1 + w1 + w2
    let type2Count = 0

    for (let i = 1; i < size; i++) {
      const entryOff = i * entrySize
      if (data[entryOff] !== 2) continue
      type2Count++

      // W[1]: ObjStm object number
      let objstmId = 0
      for (let j = 0; j < w1; j++) {
        objstmId = (objstmId << 8) | data[entryOff + 1 + j]!
      }
      // The ObjStm itself is recorded as a Type 1 entry
      const objstmEntryOff = objstmId * entrySize
      expect(data[objstmEntryOff]).toBe(1)
    }

    // Type 2 entries must exist when ObjStm is in use
    expect(type2Count).toBeGreaterThan(0)
  })

  // Verifies that all binary entries remain valid (correct offsets or ObjStm refs) for a 10-page document.
  it('複数ページでもバイナリエントリが正しい', () => {
    const { bytes, rawText } = generatePdf({ pages: 10 })
    const { data, w1, w2, size } = extractXrefData(bytes, rawText)
    const entrySize = 1 + w1 + w2
    expect(data.length).toBe(size * entrySize)
    // 10 pages produce a large number of objects
    expect(size).toBeGreaterThan(20)
    // Every entry is valid
    for (let i = 1; i < size; i++) {
      const entryOff = i * entrySize
      const type = data[entryOff]
      if (type === 1) {
        let off = 0
        for (let j = 0; j < w1; j++) {
          off = (off << 8) | data[entryOff + 1 + j]!
        }
        const atOff = rawText.substring(off, off + 20)
        expect(atOff).toMatch(/^\d+ 0 obj/)
      } else {
        expect(type).toBe(2) // ObjStm compressed
      }
    }
  })
})

describe('XRef Stream with Encryption', () => {
  // Verifies that encryption adds /Encrypt and a two-part /ID to the xref stream dict.
  it('暗号化時に /Encrypt と /ID が xref ストリーム辞書に含まれる', () => {
    const { text } = generatePdf({
      encryption: { userPassword: 'test', ownerPassword: 'owner' },
    })
    expect(text).toContain('/Type /XRef')
    expect(text).toMatch(/\/Encrypt \d+ 0 R/)
    expect(text).toMatch(/\/ID \[<[0-9A-Fa-f]+> <[0-9A-Fa-f]+>\]/)
  })

  // Verifies that AES-128 encryption (/CFM /AESV2) coexists with the xref stream format.
  it('AES-128 暗号化 + xref ストリーム', () => {
    const { text } = generatePdf({
      encryption: { userPassword: 'test', ownerPassword: 'owner', method: 'aes-128' },
    })
    expect(text).toContain('/Type /XRef')
    expect(text).toContain('/CFM /AESV2')
    expect(text).toMatch(/\/Encrypt \d+ 0 R/)
  })

  // Verifies that AES-256 encryption upgrades the header to PDF 2.0 and uses /CFM /AESV3 with xref streams.
  it('AES-256 暗号化 + xref ストリーム', () => {
    const { rawText } = generatePdf({
      encryption: { userPassword: 'test', ownerPassword: 'owner', method: 'aes-256' },
    })
    expect(rawText).toContain('%PDF-2.0')
    expect(rawText).toContain('/Type /XRef')
    expect(rawText).toContain('/CFM /AESV3')
  })
})

describe('XRef Stream with Metadata', () => {
  // Verifies that metadata adds an /Info reference to the xref stream dict alongside the Info entries.
  it('メタデータ指定時に /Info が xref ストリーム辞書に含まれる', () => {
    const { text } = generatePdf({
      metadata: { title: 'XRef Test Report' },
    })
    expect(text).toContain('/Type /XRef')
    expect(text).toMatch(/\/Info \d+ 0 R/)
    expect(text).toContain('/Title (XRef Test Report)')
  })

  // Verifies that /Encrypt and /Info coexist in the xref stream dict when both features are enabled.
  it('暗号化 + メタデータ併用', () => {
    const { text } = generatePdf({
      encryption: { userPassword: 'test', ownerPassword: 'owner' },
      metadata: { title: 'Encrypted XRef' },
    })
    expect(text).toContain('/Type /XRef')
    expect(text).toMatch(/\/Encrypt \d+ 0 R/)
    expect(text).toMatch(/\/Info \d+ 0 R/)
  })
})

describe('XRef Stream with Multiple Pages', () => {
  // Verifies that a 5-page document still produces a valid xref stream and all Page objects.
  it('複数ページでも xref ストリームが正しく生成される', () => {
    const { text } = generatePdf({ pages: 5 })
    expect(text).toContain('/Type /XRef')
    // Page objects for all 5 pages
    const pageCount = (text.match(/\/Type \/Page(?!s)/g) ?? []).length
    expect(pageCount).toBe(5)
  })
})
