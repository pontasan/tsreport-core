// Adobe Symbol / ITC Zapf Dingbats built-in encodings (ISO 32000 Annex D.5/D.6).
// Anchor points are asserted portably; when the reference Adobe fonts are present
// (macOS), the full 256-entry table is validated against them as an oracle.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { symbolicBaseFontEncoding } from '../../src/pdf/symbol-encoding.js'
import { decodeSimpleFontBytes } from '../../src/pdf/pdf-encoding.js'
import { parsePdf } from '../../src/pdf/pdf-parser.js'
import { Font } from '../../src/font.js'

function pdfWithObjects(objects: string[]): Uint8Array {
  let body = '%PDF-1.7\n'
  const offsets: number[] = []
  for (const o of objects) { offsets.push(body.length); body += o }
  const xrefOff = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`
  const bytes = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xFF
  return bytes
}

describe('symbolic base-font encodings', () => {
  it('maps Symbol byte codes to the correct Unicode (anchor points)', () => {
    const sym = symbolicBaseFontEncoding('Symbol')!
    expect(sym).not.toBeNull()
    expect(sym[0x41]).toBe('Α') // Alpha
    expect(sym[0x61]).toBe('α') // alpha
    expect(sym[0x70]).toBe('π') // pi
    expect(sym[0x53]).toBe('Σ') // Sigma
    expect(sym[0x22]).toBe('∀') // universal (for all)
    expect(sym[0xA5]).toBe('∞') // infinity
    expect(sym[0xE2]).toBe('®') // registered sign (serif)
  })

  it('maps ZapfDingbats byte codes to the U+2700 block (anchor points)', () => {
    const zapf = symbolicBaseFontEncoding('ZapfDingbats')!
    expect(zapf).not.toBeNull()
    expect(zapf[0x21]).toBe('✁') // upper blade scissors
    expect(zapf[0x48]).toBe('★') // black star
    expect(zapf[0x6C]).toBe('●') // black circle
    expect(zapf[0xAC]).toBe('①') // circled digit one
  })

  it('tolerates a subset prefix and returns null for other fonts', () => {
    expect(symbolicBaseFontEncoding('ABCDEF+Symbol')![0x41]).toBe('Α')
    expect(symbolicBaseFontEncoding('Helvetica')).toBeNull()
    expect(symbolicBaseFontEncoding('Times-Roman')).toBeNull()
  })

  it('decodes bytes of a /Symbol simple font through the built-in encoding', () => {
    // A referenced (non-embedded) Type1 Symbol font with no explicit /Encoding.
    const pdf = pdfWithObjects([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>\nendobj\n',
    ])
    const doc = parsePdf(pdf)
    const font = doc.getObject(3) as Map<string, never>
    // 0x41 Alpha, 0x61 alpha, 0x70 pi, 0xA5 infinity
    expect(decodeSimpleFontBytes(doc, font, new Uint8Array([0x41, 0x61, 0x70, 0xA5]))).toBe('Ααπ∞')
  })

  it('resolves AGL suffixed and ligature glyph names in /Differences', () => {
    // The Adobe Glyph List algorithm: drop the suffix after the first period
    // ("A.sc" → A), split ligature components at underscores ("f_i" → f+i), and
    // map uniXXXX components — so subset fonts with named glyphs still extract.
    const pdf = pdfWithObjects([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /A.sc /f_i /space.frac /uni0042 /f_f_i] >> >>\nendobj\n',
    ])
    const doc = parsePdf(pdf)
    const font = doc.getObject(3) as Map<string, never>
    // 65 A.sc→A, 66 f_i→fi, 67 space.frac→space, 68 uni0042→B, 69 f_f_i→ffi
    expect(decodeSimpleFontBytes(doc, font, new Uint8Array([65, 66, 67, 68, 69]))).toBe('Afi Bffi')
  })

  it('resolves legacy afii Cyrillic glyph names to their Unicode letters', () => {
    // afii10017=А, afii10023=Ё (out of sequence), afii10066=б, afii10088=ц.
    const pdf = pdfWithObjects([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /afii10017 /afii10023 /afii10066 /afii10088] >> >>\nendobj\n',
    ])
    const doc = parsePdf(pdf)
    const font = doc.getObject(3) as Map<string, never>
    expect(decodeSimpleFontBytes(doc, font, new Uint8Array([65, 66, 67, 68]))).toBe('АЁбц')
  })

  it('resolves the full AGL: Hebrew/Arabic afii, multi-code-point and PUA entries', () => {
    // The complete Adobe Glyph List 2.0 is embedded: afii57664=א (Hebrew alef),
    // afii57409=ء (Arabic hamza), dalethatafpatah=U+05D3 U+05B2 (two code
    // points), Asmall=U+F761 (expert small-cap, Adobe PUA), dotlessj=U+F6BE
    // (AGL maps it to the Adobe PUA point, not U+0237).
    const pdf = pdfWithObjects([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /afii57664 /afii57409 /dalethatafpatah /Asmall /dotlessj] >> >>\nendobj\n',
    ])
    const doc = parsePdf(pdf)
    const font = doc.getObject(3) as Map<string, never>
    expect(decodeSimpleFontBytes(doc, font, new Uint8Array([65, 66, 67, 68, 69]))).toBe('\u05D0\u0621\u05D3\u05B2\uF761\uF6BE')
  })

  it('maps an unmappable glyph name to U+FFFD instead of failing the page', () => {
    // A font-private / unknown name has no derivable code point; text extraction
    // yields U+FFFD rather than throwing. Known names in the same Differences
    // still resolve normally.
    const pdf = pdfWithObjects([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /somefontprivateglyph /A /anotherprivate] >> >>\nendobj\n',
    ])
    const doc = parsePdf(pdf)
    const font = doc.getObject(3) as Map<string, never>
    expect(decodeSimpleFontBytes(doc, font, new Uint8Array([65, 66, 67]))).toBe('�A�')
  })

  it('resolves uniXXXXXX (supplementary) and additional standard AGL names', () => {
    // Non-conformant `uni` + 5–6 hex digits denotes a single supplementary code
    // point (uni1F600 = U+1F600). Also cover standard AGL names real fonts use
    // that are outside the basic Latin set: Gamma (U+0393), danda (U+0964).
    const pdf = pdfWithObjects([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /uni1F600 /Gamma /danda] >> >>\nendobj\n',
    ])
    const doc = parsePdf(pdf)
    const font = doc.getObject(3) as Map<string, never>
    expect(decodeSimpleFontBytes(doc, font, new Uint8Array([65, 66, 67]))).toBe('\u{1F600}Γ।')
  })

  it('applies /Differences on top of the Symbol built-in encoding', () => {
    const pdf = pdfWithObjects([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Symbol /Encoding << /Type /Encoding /Differences [65 /space] >> >>\nendobj\n',
    ])
    const doc = parsePdf(pdf)
    const font = doc.getObject(3) as Map<string, never>
    // 0x41 overridden to space; 0x61 keeps the Symbol built-in (alpha).
    expect(decodeSimpleFontBytes(doc, font, new Uint8Array([0x41, 0x61]))).toBe(' α')
  })

  // Oracle: validate the full committed table against the reference Adobe fonts.
  const cases: { path: string, base: string }[] = [
    { path: '/System/Library/Fonts/Symbol.ttf', base: 'Symbol' },
    { path: '/System/Library/Fonts/ZapfDingbats.ttf', base: 'ZapfDingbats' },
  ]
  for (const c of cases) {
    it(`matches the reference ${c.base} font when available`, () => {
      if (!existsSync(c.path)) return // reference font not present (non-macOS CI)
      const buf = readFileSync(c.path)
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      const num = dv.getUint16(4)
      let cmapOff = 0
      for (let i = 0; i < num; i++) {
        const o = 12 + i * 16
        if (String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!) === 'cmap') cmapOff = dv.getUint32(o + 8)
      }
      const nSub = dv.getUint16(cmapOff + 2)
      let macOff = 0
      for (let i = 0; i < nSub; i++) {
        const o = cmapOff + 4 + i * 8
        if (dv.getUint16(o) === 1 && dv.getUint16(o + 2) === 0) macOff = cmapOff + dv.getUint32(o + 4)
      }
      const font = Font.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
      const g2u = new Map<number, number>()
      for (let cp = 0x20; cp <= 0xFFFF; cp++) { const g = font.getGlyphId(cp); if (g !== 0 && !g2u.has(g)) g2u.set(g, cp) }
      const table = symbolicBaseFontEncoding(c.base)!
      for (let code = 0; code < 256; code++) {
        const g = buf[macOff + 6 + code]!
        const expected = g === 0 ? '' : (g2u.has(g) ? String.fromCodePoint(g2u.get(g)!) : '')
        expect(table[code], `code 0x${code.toString(16)}`).toBe(expected)
      }
    })
  }
})
