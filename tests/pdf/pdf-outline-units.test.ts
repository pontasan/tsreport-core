// Outline-only text import must normalize embedded-font glyph outlines to the
// 1000-units/em text-space convention. A TrueType subset keeps its native
// unitsPerEm (Roboto: 2048); without normalization a 100pt 'A' imported as
// outline paths came out 2.048x too large (146pt cap height instead of 71pt).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, importPdfPage, materializePdfSourceVectorPath } from '../../src/index.js'
import { zlibDeflate } from '../../src/compression/deflate.js'

const ROBOTO = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')

function l1(s: string): Uint8Array {
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xFF
  return o
}

function cat(...parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

/** Roboto 'A' subset with its cmap disabled, embedded as a cmap-less CID font. */
function buildOutlineOnlyPdf(): Uint8Array {
  const buf = readFileSync(ROBOTO)
  const font = Font.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  const gidA = font.getGlyphId(0x41)
  const sub = font.subsetByGlyphIds(new Set([0, gidA]))
  const fontBytes = new Uint8Array(sub.buffer)
  // Rename the cmap tag so the embedded font exposes no Unicode mapping and
  // the importer takes the outline-only path.
  const dv = new DataView(fontBytes.buffer, fontBytes.byteOffset)
  const numTables = dv.getUint16(4)
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16
    if (fontBytes[off] === 0x63 && fontBytes[off + 1] === 0x6D && fontBytes[off + 2] === 0x61 && fontBytes[off + 3] === 0x70) {
      fontBytes[off + 3] = 0x71 // 'cmap' -> 'cmaq'
    }
  }
  const comp = zlibDeflate(fontBytes)
  const content = l1('BT /F1 100 Tf 10 50 Td <0001> Tj ET')
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${Buffer.from(content).toString('latin1')}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Rob /Encoding /Identity-H /DescendantFonts [6 0 R] >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Rob /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /CIDToGIDMap /Identity /DW 1000 /W [1 [652]] >>\nendobj\n',
    '7 0 obj\n<< /Type /FontDescriptor /FontName /Rob /Flags 4 /FontBBox [0 0 2048 2048] /ItalicAngle 0 /Ascent 1900 /Descent -500 /CapHeight 1456 /StemV 80 /FontFile2 8 0 R >>\nendobj\n',
    `8 0 obj\n<< /Length ${comp.length} /Length1 ${fontBytes.length} /Filter /FlateDecode >>\nstream\n`,
  ]
  const parts: Uint8Array[] = [l1('%PDF-1.7\n')]
  const offsets: number[] = []
  let pos = parts[0]!.length
  for (let i = 0; i < objs.length; i++) {
    offsets.push(pos)
    if (i === 7) {
      const head = l1(objs[i]!)
      const tail = l1('\nendstream\nendobj\n')
      parts.push(head, comp, tail)
      pos += head.length + comp.length + tail.length
    } else {
      const bytes = l1(objs[i]!)
      parts.push(bytes)
      pos += bytes.length
    }
  }
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`
  parts.push(l1(xref))
  return cat(...parts)
}

describe('outline-only import unit normalization', () => {
  it('scales a 2048-upm TrueType glyph to the 1000/em text-space convention', () => {
    const page = importPdfPage(buildOutlineOnlyPdf(), 0)
    const path = page.elements.find((e): e is Extract<typeof e, { type: 'path' }> => e.type === 'path')
    expect(path).toBeDefined()
    // Roboto 'A': 1456 units tall at 2048/em → 71.09pt at 100pt font size.
    expect(path!.height).toBeCloseTo(1456 / 2048 * 100, 0)
    // Width: the A glyph spans 1281 units → ~62.5pt.
    expect(path!.width).toBeGreaterThan(55)
    expect(path!.width).toBeLessThan(70)
    expect(path!.pdfSourceVector).toBeDefined()
    expect(path!.pdfSourceVector!.definitions).toHaveLength(1)
    expect(path!.pdfSourceVector!.instances).toHaveLength(1)
    expect(materializePdfSourceVectorPath(path!).d).toBe(path!.d)
  })
})
