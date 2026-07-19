// Embedded Type1 font programs in PDF: a symbolic font with no /Encoding entry
// must decode through the font program's built-in encoding (ISO 32000 9.6.6.2).
// The built-in maps code 65 to /B — so byte 65 must extract as "B", proving the
// eexec-encrypted program was parsed rather than falling back to Standard.

import { describe, it, expect } from 'vitest'
import { importPdfPage } from '../../src/index.js'
import { zlibDeflate } from '../../src/compression/deflate.js'
import { parseType1 } from '../../src/parsers/type1-parser.js'
import { standardEncodingGlyphNames } from '../../src/pdf/pdf-encoding.js'

// ─── Minimal Type1 program builder (forward eexec/charstring encryption) ───

function encrypt(plain: Uint8Array, r: number, lead: number): Uint8Array {
  const data = new Uint8Array(lead + plain.length)
  data.set(plain, lead)
  const out = new Uint8Array(data.length)
  let key = r
  for (let i = 0; i < data.length; i++) {
    const p = data[i]!
    const c = p ^ (key >> 8)
    out[i] = c & 0xFF
    key = ((c + key) * 52845 + 22719) & 0xFFFF
  }
  return out
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

function num(v: number): number[] {
  if (v >= -107 && v <= 107) return [v + 139]
  return [255, (v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]
}

function buildType1Program(): Uint8Array {
  // Built-in encoding: code 65 → /B (deliberately not /A).
  const clear = latin1Bytes(
    '%!PS-AdobeFont-1.0: SymTest 001.001\n'
    + '/FontName /SymTest def\n'
    + '/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n'
    + '/Encoding 256 array\n0 1 255 {1 index exch /.notdef put} for\ndup 65 /B put\nreadonly def\n'
    + 'currentdict end\ncurrentfile eexec\n',
  )
  const square = new Uint8Array([
    ...num(0), ...num(500), 13, // hsbw
    ...num(10), ...num(20), 1,  // hstem
    ...num(10), ...num(20), 3,  // vstem
    ...num(0), ...num(0), 21,   // rmoveto
    ...num(100), ...num(0), 5,  // rlineto
    ...num(0), ...num(100), 5,
    ...num(-100), ...num(0), 5,
    9, 14,                       // closepath endchar
  ])
  const notdef = new Uint8Array([...num(0), ...num(250), 13, 14])
  let priv = latin1Bytes('/Private 8 dict dup begin\n/lenIV 4 def\nend\n/CharStrings 2 dict dup begin\n')
  const encB = encrypt(square, 4330, 4)
  priv = concat(priv, latin1Bytes(`/B ${encB.length} RD `), encB, latin1Bytes(' ND\n'))
  const encN = encrypt(notdef, 4330, 4)
  priv = concat(priv, latin1Bytes(`/.notdef ${encN.length} RD `), encN, latin1Bytes(' ND\n'))
  priv = concat(priv, latin1Bytes('end\nend\nmark currentfile closefile\n'))
  return concat(clear, encrypt(priv, 55665, 4))
}

function buildOperatorTestProgram(glyphs: Record<string, Uint8Array>, subrs: Uint8Array[] = []): Uint8Array {
  const clear = latin1Bytes(
    '%!PS-AdobeFont-1.0: OperatorTest 001.001\n'
    + '/FontName /OperatorTest def\n'
    + '/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n'
    + '/Encoding StandardEncoding def\n'
    + 'currentdict end\ncurrentfile eexec\n',
  )
  let priv = latin1Bytes(`/Private 8 dict dup begin\n/lenIV 4 def\nend\n/Subrs ${subrs.length} array\n`)
  for (let i = 0; i < subrs.length; i++) {
    const encrypted = encrypt(subrs[i]!, 4330, 4)
    priv = concat(priv, latin1Bytes(`dup ${i} ${encrypted.length} RD `), encrypted, latin1Bytes(' NP\n'))
  }
  const names = Object.keys(glyphs)
  priv = concat(priv, latin1Bytes(`/CharStrings ${names.length} dict dup begin\n`))
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    const encrypted = encrypt(glyphs[name]!, 4330, 4)
    priv = concat(priv, latin1Bytes(`/${name} ${encrypted.length} RD `), encrypted, latin1Bytes(' ND\n'))
  }
  priv = concat(priv, latin1Bytes('end\nend\nmark currentfile closefile\n'))
  return concat(clear, encrypt(priv, 55665, 4))
}

// ─── PDF builder ───

function buildObjectsPdf(objects: string[], binaryStreams: Map<number, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [latin1Bytes('%PDF-1.7\n')]
  const offsets: number[] = []
  let pos = parts[0]!.length
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pos)
    const objNum = i + 1
    const bin = binaryStreams.get(objNum)
    if (bin !== undefined) {
      const head = latin1Bytes(objects[i]!)
      const tail = latin1Bytes('\nendstream\nendobj\n')
      parts.push(head, bin, tail)
      pos += head.length + bin.length + tail.length
    } else {
      const bytes = latin1Bytes(objects[i]!)
      parts.push(bytes)
      pos += bytes.length
    }
  }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`
  parts.push(latin1Bytes(xref))
  return concat(...parts)
}

describe('embedded Type1 font programs', () => {
  it('decodes a symbolic font through the built-in encoding of the font program', () => {
    const program = buildType1Program()
    const compressed = zlibDeflate(program)
    const content = latin1Bytes('BT /F1 12 Tf 10 50 Td (A) Tj ET')
    const pdf = buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${Buffer.from(content).toString('latin1')}\nendstream\nendobj\n`,
      // Symbolic (flags 4), no /Encoding: the built-in encoding must apply.
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /SymTest /FontDescriptor 6 0 R /FirstChar 65 /LastChar 65 /Widths [500] >>\nendobj\n',
      '6 0 obj\n<< /Type /FontDescriptor /FontName /SymTest /Flags 4 /FontBBox [0 0 500 700] /ItalicAngle 0 /Ascent 700 /Descent 0 /CapHeight 700 /StemV 80 /FontFile 7 0 R >>\nendobj\n',
      `7 0 obj\n<< /Length ${compressed.length} /Length1 ${program.length} /Filter /FlateDecode >>\nstream\n`,
    ], new Map([[7, compressed]]))

    const page = importPdfPage(pdf, 0)
    const text = page.elements.find((e): e is Extract<typeof e, { type: 'staticText' }> => e.type === 'staticText')
    expect(text).toBeDefined()
    // Byte 65 ('A') maps to glyph /B via the program's built-in encoding.
    expect(text!.text).toBe('B')
  })

  it('grid-fits imported Type 1 outlines at the requested output resolution', () => {
    const program = buildType1Program()
    const compressed = zlibDeflate(program)
    const content = latin1Bytes('BT /F1 13 Tf 10 50 Td (A) Tj ET')
    const pdf = buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${Buffer.from(content).toString('latin1')}\nendstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /SymTest /FontDescriptor 6 0 R /FirstChar 65 /LastChar 65 /Widths [500] >>\nendobj\n',
      '6 0 obj\n<< /Type /FontDescriptor /FontName /SymTest /Flags 4 /FontBBox [0 0 500 700] /ItalicAngle 0 /Ascent 700 /Descent 0 /CapHeight 700 /StemV 80 /FontFile 7 0 R >>\nendobj\n',
      `7 0 obj\n<< /Length ${compressed.length} /Length1 ${program.length} /Filter /FlateDecode >>\nstream\n`,
    ], new Map([[7, compressed]]))

    const at72 = importPdfPage(pdf, 0, { outlineText: true, outlineDpi: 72 })
    const at144 = importPdfPage(pdf, 0, { outlineText: true, outlineDpi: 144 })
    const path72 = at72.elements.find((element): element is Extract<typeof element, { type: 'path' }> => element.type === 'path')
    const path144 = at144.elements.find((element): element is Extract<typeof element, { type: 'path' }> => element.type === 'path')
    expect(path72).toBeDefined()
    expect(path144).toBeDefined()
    expect([path72!.x, path72!.y, path72!.width, path72!.height, path72!.d]).not.toEqual([
      path144!.x, path144!.y, path144!.width, path144!.height, path144!.d,
    ])
    expect(function () { importPdfPage(pdf, 0, { outlineText: true, outlineDpi: 0 }) }).toThrow(/outlineDpi/)
  })

  it('executes the complete Type 1 charstring operator set with a shared subroutine stack', () => {
    const main = new Uint8Array([
      ...num(0), ...num(500), 13,
      ...num(10), ...num(20), 1,
      ...num(15), ...num(25), 3,
      ...num(10), ...num(20), ...num(30), ...num(20), ...num(50), ...num(20), 12, 2,
      ...num(12), ...num(22), ...num(32), ...num(22), ...num(52), ...num(22), 12, 1,
      12, 0, 12, 0,
      ...num(0), ...num(0), 21,
      ...num(5), 4,
      ...num(10), ...num(20), ...num(5), 10,
      ...num(20), 6,
      ...num(10), 7,
      ...num(5), ...num(5), ...num(5), ...num(5), ...num(5), ...num(5), 8,
      ...num(5), ...num(5), ...num(5), ...num(5), 30,
      ...num(5), ...num(5), ...num(5), ...num(5), 31,
      9,
      ...num(100), ...num(2), 12, 12, 22,
      ...num(4), ...num(1), ...num(3), 12, 16, 12, 17, 10,
      ...num(3), 22,
      ...num(30), ...num(40), ...num(2), ...num(99), 12, 16, 12, 17, 12, 17, 12, 33,
      14,
    ])
    const flex = new Uint8Array([
      ...num(0), ...num(500), 13,
      ...num(0), ...num(0), 21,
      ...num(1), 10,
      ...num(10), ...num(0), 21, ...num(2), 10,
      ...num(10), ...num(10), 21, ...num(2), 10,
      ...num(10), ...num(0), 21, ...num(2), 10,
      ...num(10), ...num(-10), 21, ...num(2), 10,
      ...num(10), ...num(0), 21, ...num(2), 10,
      ...num(10), ...num(10), 21, ...num(2), 10,
      ...num(10), ...num(0), 21, ...num(2), 10,
      ...num(50), ...num(70), ...num(10), ...num(0), 10,
      14,
    ])
    const sbw = new Uint8Array([...num(10), ...num(20), ...num(600), ...num(0), 12, 7, 14])
    const acute = new Uint8Array([
      ...num(0), ...num(200), 13,
      ...num(0), ...num(0), 21,
      ...num(20), ...num(30), 5,
      14,
    ])
    const acuteCode = standardEncodingGlyphNames().indexOf('acute')
    expect(acuteCode).toBeGreaterThanOrEqual(0)
    const composite = new Uint8Array([
      ...num(0), ...num(500), 13,
      ...num(0), ...num(10), ...num(20), ...num(65), ...num(acuteCode), 12, 6,
    ])
    const program = buildOperatorTestProgram(
      { '.notdef': new Uint8Array([...num(0), ...num(250), 13, 14]), A: main, B: flex, C: sbw, acute, D: composite },
      [
        new Uint8Array([...num(3), ...num(0), 12, 16, 12, 17, 12, 17, 12, 33, 11]),
        new Uint8Array([...num(0), ...num(1), 12, 16, 11]),
        new Uint8Array([...num(0), ...num(2), 12, 16, 11]),
        new Uint8Array([11]),
        new Uint8Array([...num(70), ...num(20), 1, 11]),
        new Uint8Array([5, 11]),
      ],
    )
    const parsed = parseType1(program, standardEncodingGlyphNames())

    expect(parsed.getAdvanceWidth('A')).toBe(500)
    expect(parsed.getAdvanceWidth('C')).toBe(600)
    expect(parsed.getOutline('A')!.commands.length).toBeGreaterThan(5)
    const hintProgram = parsed.getHintProgram('A')!
    expect(hintProgram).toMatchObject({
      hStems: [{ pos: 10, width: 20 }, { pos: 10, width: 20 }, { pos: 30, width: 20 }, { pos: 50, width: 20 }, { pos: 70, width: 20 }],
      vStems: [{ pos: 15, width: 25 }, { pos: 12, width: 22 }, { pos: 32, width: 22 }, { pos: 52, width: 22 }],
      dotSectionUsed: true,
      hintReplacementUsed: true,
    })
    expect(hintProgram.segments.at(-1)).toMatchObject({
      hStems: [{ pos: 70, width: 20 }],
      vStems: [],
      enabled: true,
    })
    expect(parsed.getHintedOutline('A', 13)!.commands).toEqual(parsed.getOutline('A')!.commands)
    expect(parsed.getHintedOutline('A', 13)!.coords).not.toEqual(parsed.getOutline('A')!.coords)
    expect([...parsed.getOutline('B')!.commands].filter(command => command === 2)).toHaveLength(2)
    expect(parsed.getOutline('D')!.commands.length).toBeGreaterThan(parsed.getOutline('acute')!.commands.length)
  })

  it('distinguishes malformed operands and encodings from unknown operators', () => {
    const program = (charstring: Uint8Array) => buildOperatorTestProgram({ A: charstring })
    expect(() => parseType1(program(new Uint8Array([13, 14])), standardEncodingGlyphNames()).getOutline('A'))
      .toThrow(/hsbw requires 2 operands/)
    expect(() => parseType1(program(new Uint8Array([...num(0), ...num(500), 13, 2])), standardEncodingGlyphNames()).getOutline('A'))
      .toThrow(/unsupported charstring operator 2/)
    expect(() => parseType1(program(new Uint8Array([...num(0), ...num(500), 13, 12, 255])), standardEncodingGlyphNames()).getOutline('A'))
      .toThrow(/unsupported escape operator 12 255/)
    expect(() => parseType1(program(new Uint8Array([...num(0), ...num(500), 13, 247])), standardEncodingGlyphNames()).getOutline('A'))
      .toThrow(/truncated positive number/)
    expect(() => parseType1(program(new Uint8Array([...num(0), ...num(500), 13])), standardEncodingGlyphNames()).getOutline('A'))
      .toThrow(/has no endchar or seac/)
    expect(() => parseType1(program(new Uint8Array([
      ...num(0), ...num(500), 13,
      ...num(0), ...num(1), 12, 16,
      14,
    ])), standardEncodingGlyphNames()).getOutline('A')).toThrow(/endchar encountered during flex/)
    expect(() => parseType1(program(new Uint8Array([
      ...num(0), ...num(500), 13,
      ...num(4), ...num(1), ...num(3), 12, 16,
      14,
    ])), standardEncodingGlyphNames()).getOutline('A')).toThrow(/hint replacement has no following callsubr/)
  })
})
