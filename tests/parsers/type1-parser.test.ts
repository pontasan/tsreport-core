// Adobe Type 1 font program parser: eexec decryption, charstring
// interpretation (hsbw, moves/lines/curves, closepath, subrs, flex via
// OtherSubrs, seac, div), /Encoding forms, and PFB segment stripping.
// The fixtures are built by hand with forward eexec/charstring encryption.

import { describe, it, expect } from 'vitest'
import { parseType1 } from '../../src/parsers/type1-parser.js'
import { standardEncodingGlyphNames } from '../../src/pdf/pdf-encoding.js'
import { PathCommand } from '../../src/types/glyph.js'

const STD = standardEncodingGlyphNames()

// ─── Forward encryption (inverse of the parser's decrypt) ───

function encrypt(plain: Uint8Array, r: number, lead: number): Uint8Array {
  const data = new Uint8Array(lead + plain.length)
  data.set(plain, lead) // lead random bytes: zeros are fine
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

// ─── Charstring builder ───

/** Encodes a Type1 charstring number (-107..107 single byte form is enough plus the 255 form). */
function num(v: number): number[] {
  if (v >= -107 && v <= 107) return [v + 139]
  return [255, (v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]
}

function cs(...parts: (number | number[])[]): Uint8Array {
  const bytes: number[] = []
  for (const p of parts) {
    if (typeof p === 'number') bytes.push(p)
    else bytes.push(...p)
  }
  return new Uint8Array(bytes)
}

const HSBW = 13, CLOSEPATH = 9, RMOVETO = 21, RLINETO = 5, RRCURVETO = 8, ENDCHAR = 14
const CALLSUBR = 10, RETURN = 11
const ESC = 12, SEAC = 6, DIV = 12, CALLOTHER = 16, POP = 17, SETCURRENTPOINT = 33

/** Builds a complete Type1 program with the given charstrings and subrs. */
function buildType1(options: {
  charstrings: Record<string, Uint8Array>
  subrs?: Uint8Array[]
  encodingLines?: string
  pfb?: boolean
  lenIV?: number
}): Uint8Array {
  const clear = latin1Bytes(
    '%!PS-AdobeFont-1.0: TestFont 001.001\n'
    + '/FontName /TestFont def\n'
    + '/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n'
    + (options.encodingLines ?? '/Encoding 256 array\n0 1 255 {1 index exch /.notdef put} for\ndup 65 /A put\ndup 66 /B put\nreadonly def\n')
    + 'currentdict end\ncurrentfile eexec\n',
  )
  const lenIV = options.lenIV ?? 4
  let privText = `/Private 8 dict dup begin\n/lenIV ${lenIV} def\n`
  const subrs = options.subrs ?? []
  if (subrs.length > 0) {
    privText += `/Subrs ${subrs.length} array\n`
  }
  let priv = latin1Bytes(privText)
  for (let i = 0; i < subrs.length; i++) {
    const enc = lenIV === -1 ? subrs[i]! : encrypt(subrs[i]!, 4330, lenIV)
    priv = concat(priv, latin1Bytes(`dup ${i} ${enc.length} RD `), enc, latin1Bytes(' NP\n'))
  }
  const names = Object.keys(options.charstrings)
  priv = concat(priv, latin1Bytes(`end\n/CharStrings ${names.length} dict dup begin\n`))
  for (const name of names) {
    const enc = lenIV === -1 ? options.charstrings[name]! : encrypt(options.charstrings[name]!, 4330, lenIV)
    priv = concat(priv, latin1Bytes(`/${name} ${enc.length} RD `), enc, latin1Bytes(' ND\n'))
  }
  priv = concat(priv, latin1Bytes('end\nend\nmark currentfile closefile\n'))
  const encrypted = encrypt(priv, 55665, 4)
  const program = concat(clear, encrypted)
  if (!options.pfb) return program
  // Wrap as PFB: ascii segment + binary segment + EOF.
  const seg = (kind: number, body: Uint8Array): Uint8Array => concat(
    new Uint8Array([0x80, kind, body.length & 0xFF, (body.length >> 8) & 0xFF, (body.length >> 16) & 0xFF, (body.length >> 24) & 0xFF]),
    body,
  )
  return concat(seg(1, clear), seg(2, encrypted), new Uint8Array([0x80, 0x03]))
}

/** A 100x100 square with hsbw 20 500: M(20,0) L(120,0) L(120,100) L(20,100) Z */
function squareCharstring(): Uint8Array {
  return cs(
    num(20), num(500), HSBW,
    num(0), num(0), RMOVETO,
    num(100), num(0), RLINETO,
    num(0), num(100), RLINETO,
    num(-100), num(0), RLINETO,
    CLOSEPATH, ENDCHAR,
  )
}

describe('Type1 font program parser', () => {
  it('decrypts eexec and interprets moves, lines, and closepath', () => {
    const font = parseType1(buildType1({ charstrings: { A: squareCharstring(), '.notdef': cs(num(0), num(250), HSBW, ENDCHAR) } }), STD)
    expect(font.glyphNames).toContain('A')
    expect(font.fontMatrix).toEqual([0.001, 0, 0, 0.001, 0, 0])
    expect(font.getAdvanceWidth('A')).toBe(500)
    const outline = font.getOutline('A')!
    expect([...outline.commands]).toEqual([PathCommand.MoveTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.Close])
    expect([...outline.coords]).toEqual([20, 0, 120, 0, 120, 100, 20, 100])
  })

  it('reads the built-in /Encoding differences', () => {
    const font = parseType1(buildType1({ charstrings: { A: squareCharstring(), B: squareCharstring(), '.notdef': cs(num(0), num(250), HSBW, ENDCHAR) } }), STD)
    expect(font.encoding[65]).toBe('A')
    expect(font.encoding[66]).toBe('B')
    expect(font.encoding[67]).toBe('.notdef')
  })

  it('interprets rrcurveto into cubic segments', () => {
    const glyph = cs(
      num(0), num(300), HSBW,
      num(0), num(0), RMOVETO,
      num(10), num(0), num(20), num(30), num(0), num(40), RRCURVETO,
      CLOSEPATH, ENDCHAR,
    )
    const font = parseType1(buildType1({ charstrings: { A: glyph, '.notdef': cs(num(0), num(0), HSBW, ENDCHAR) } }), STD)
    const outline = font.getOutline('A')!
    expect([...outline.commands]).toEqual([PathCommand.MoveTo, PathCommand.CubicTo, PathCommand.Close])
    // From (0,0): c1=(10,0), c2=(30,30), end=(30,70)
    expect([...outline.coords]).toEqual([0, 0, 10, 0, 30, 30, 30, 70])
  })

  it('executes subroutines via callsubr', () => {
    const subr = cs(num(100), num(0), RLINETO, RETURN)
    const glyph = cs(
      num(0), num(500), HSBW,
      num(0), num(0), RMOVETO,
      num(0), CALLSUBR,
      CLOSEPATH, ENDCHAR,
    )
    const font = parseType1(buildType1({ charstrings: { A: glyph, '.notdef': cs(num(0), num(0), HSBW, ENDCHAR) }, subrs: [subr] }), STD)
    const outline = font.getOutline('A')!
    expect([...outline.commands]).toEqual([PathCommand.MoveTo, PathCommand.LineTo, PathCommand.Close])
    expect([...outline.coords]).toEqual([0, 0, 100, 0])
  })

  it('applies div and seac accent composition', () => {
    // seac: base 'A' (code 65) + accent 'B' (code 66) shifted by adx.
    const accented = cs(
      num(20), num(500), HSBW,
      num(20), num(50), num(0), num(65), num(66), ESC, SEAC,
    )
    const base = cs(
      num(20), num(500), HSBW,
      num(10), num(20), 1,
      num(0), num(0), RMOVETO,
      num(100), num(0), RLINETO,
      num(0), num(100), RLINETO,
      num(-100), num(0), RLINETO,
      CLOSEPATH, ENDCHAR,
    )
    const accent = cs(
      num(10), num(300), HSBW,
      num(5), num(10), 3,
      num(0), num(0), RMOVETO,
      num(10), num(0), RLINETO,
      CLOSEPATH, ENDCHAR,
    )
    const font = parseType1(buildType1({ charstrings: { A: base, B: accent, Aacute: accented, '.notdef': cs(num(0), num(0), HSBW, ENDCHAR) } }), STD)
    const outline = font.getOutline('Aacute')!
    // Base square followed by the accent line shifted by sbx - asb + adx = 20 - 20 + 50 = 50.
    expect([...outline.commands]).toEqual([
      PathCommand.MoveTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.Close,
      PathCommand.MoveTo, PathCommand.LineTo, PathCommand.Close,
    ])
    const coords = [...outline.coords]
    expect(coords.slice(0, 8)).toEqual([20, 0, 120, 0, 120, 100, 20, 100])
    // Accent starts at (10,0)+50 = (60,0) then line to (70,0).
    expect(coords.slice(8)).toEqual([60, 0, 70, 0])
    expect(font.getHintProgram('Aacute')).toMatchObject({
      hStems: [{ pos: 10, width: 20 }],
      vStems: [{ pos: 55, width: 10 }],
    })
  })

  it('resolves flex through OtherSubrs 0-2', () => {
    const subrs = [
      cs(num(3), num(0), ESC, CALLOTHER, ESC, POP, ESC, POP, ESC, SETCURRENTPOINT, RETURN),
      cs(num(0), num(1), ESC, CALLOTHER, RETURN),
      cs(num(0), num(2), ESC, CALLOTHER, RETURN),
    ]
    const glyph = cs(
      num(0), num(500), HSBW,
      num(0), num(0), RMOVETO,
      num(1), CALLSUBR,
      num(5), num(0), RMOVETO, num(2), CALLSUBR,
      num(5), num(10), RMOVETO, num(2), CALLSUBR,
      num(10), num(0), RMOVETO, num(2), CALLSUBR,
      num(10), num(-10), RMOVETO, num(2), CALLSUBR,
      num(10), num(-10), RMOVETO, num(2), CALLSUBR,
      num(10), num(0), RMOVETO, num(2), CALLSUBR,
      num(10), num(10), RMOVETO, num(2), CALLSUBR,
      num(50), num(60), num(0), num(0), CALLSUBR,
      CLOSEPATH, ENDCHAR,
    )
    const font = parseType1(buildType1({ charstrings: { A: glyph, '.notdef': cs(num(0), num(0), HSBW, ENDCHAR) }, subrs }), STD)
    const outline = font.getOutline('A')!
    expect([...outline.commands]).toEqual([PathCommand.MoveTo, PathCommand.CubicTo, PathCommand.CubicTo, PathCommand.Close])
    // Collected absolute points: ref (5,0); c: (10,10),(20,10),(30,0),(40,-10),(50,-10),(60,0)
    expect([...outline.coords]).toEqual([0, 0, 10, 10, 20, 10, 30, 0, 40, -10, 50, -10, 60, 0])
  })

  it('strips PFB segment headers', () => {
    const font = parseType1(buildType1({ charstrings: { A: squareCharstring(), '.notdef': cs(num(0), num(0), HSBW, ENDCHAR) }, pfb: true }), STD)
    expect(font.getAdvanceWidth('A')).toBe(500)
    expect(font.getOutline('A')).not.toBeNull()
  })

  it('executes unencrypted charstrings when lenIV is -1', () => {
    const font = parseType1(buildType1({
      charstrings: { A: squareCharstring(), '.notdef': cs(num(0), num(0), HSBW, ENDCHAR) },
      lenIV: -1,
    }), STD)
    expect([...font.getOutline('A')!.commands]).toEqual([
      PathCommand.MoveTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.Close,
    ])
  })

  it('supports /Encoding StandardEncoding def', () => {
    const font = parseType1(buildType1({
      charstrings: { A: squareCharstring(), '.notdef': cs(num(0), num(0), HSBW, ENDCHAR) },
      encodingLines: '/Encoding StandardEncoding def\n',
    }), STD)
    expect(font.encoding[65]).toBe('A')
    expect(font.encoding[97]).toBe('a')
  })

  it('rejects programs without eexec or CharStrings', () => {
    expect(() => parseType1(latin1Bytes('%!PS no font here'), STD)).toThrow('eexec section not found')
  })
})
