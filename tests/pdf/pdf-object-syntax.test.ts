import { describe, expect, it } from 'vitest'
import { parsePdfObject, PdfName, PdfRef, PdfString } from '../../src/pdf/pdf-parser.js'

const encoder = new TextEncoder()

function parse(source: string) {
  return parsePdfObject(encoder.encode(source))
}

describe('PDF direct object syntax', () => {
  it('accepts every PDF whitespace byte and comments at token boundaries', () => {
    const bytes = new Uint8Array([
      0x00, 0x09, 0x0A, 0x0C, 0x0D, 0x20,
      0x25, 0x63, 0x6F, 0x6D, 0x6D, 0x65, 0x6E, 0x74, 0x0D, 0x0A,
      0x5B, 0x31, 0x20, 0x74, 0x72, 0x75, 0x65, 0x20, 0x6E, 0x75, 0x6C, 0x6C, 0x5D,
      0x20, 0x25, 0x65, 0x6E, 0x64,
    ])
    expect(parsePdfObject(bytes)).toEqual([1, true, null])
  })

  it('decodes name escapes without treating escaped delimiters as syntax', () => {
    expect(parse('/A#20B#23C#2FD')).toEqual(new PdfName('A B#C/D'))
    expect(parse('/')).toEqual(new PdfName(''))
  })

  it('decodes nested literal strings, escapes, octal bytes and line continuations', () => {
    const value = parse('(a(b\\)c)\\n\\r\\t\\b\\f\\053\\\ncontinued)') as PdfString
    expect(value).toBeInstanceOf(PdfString)
    expect(Array.from(value.bytes)).toEqual(Array.from(encoder.encode('a(b)c)\n\r\t\b\f+continued')))
  })

  it('normalizes CR, LF and CRLF inside literal strings to LF', () => {
    const value = parsePdfObject(new Uint8Array([
      0x28, 0x61, 0x0D, 0x62, 0x0A, 0x63, 0x0D, 0x0A, 0x64, 0x29,
    ])) as PdfString
    expect(Array.from(value.bytes)).toEqual(Array.from(encoder.encode('a\nb\nc\nd')))
  })

  it('decodes hex strings with whitespace and low-nibble padding', () => {
    expect(Array.from((parse('<41 42\nF>') as PdfString).bytes)).toEqual([0x41, 0x42, 0xF0])
    expect(Array.from((parse('<>') as PdfString).bytes)).toEqual([])
  })

  it('parses integer and real lexical forms without losing exact integers', () => {
    expect(parse('+17')).toBe(17)
    expect(parse('-0')).toBe(-0)
    expect(parse('.5')).toBe(0.5)
    expect(parse('1.')).toBe(1)
    expect(parse('-.25')).toBe(-0.25)
    expect(parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('parses nested arrays, dictionaries and indirect references', () => {
    const value = parse('<< /A [true false null 12 65535 R] /B << /N /Value >> >>') as Map<string, unknown>
    expect(value.get('A')).toEqual([true, false, null, new PdfRef(12, 65535)])
    expect((value.get('B') as Map<string, unknown>).get('N')).toEqual(new PdfName('Value'))
  })

  it('rejects malformed numbers and values outside the exact integer model', () => {
    for (const source of ['.', '+', '-', '1.2.3', '1e3', '9007199254740992']) {
      expect(() => parse(source), source).toThrow(/PDF parse error/)
    }
  })

  it('rejects invalid indirect-reference ranges', () => {
    for (const source of ['0 0 R', '-1 0 R', '1 -1 R', '1 65536 R']) {
      expect(() => parse(source), source).toThrow(/invalid indirect reference/)
    }
  })

  it('rejects unterminated containers, invalid escapes and trailing objects', () => {
    for (const source of ['(abc', '<ABC', '[1 2', '<< /A 1', '/bad#x0', 'true false']) {
      expect(() => parse(source), source).toThrow(/PDF parse error/)
    }
  })

  it('parses deeply nested direct containers without changing object meaning', () => {
    const depth = 128
    const value = parse(`${'['.repeat(depth)}0${']'.repeat(depth)}`)
    let current: unknown = value
    for (let i = 0; i < depth; i++) {
      expect(current).toBeInstanceOf(Array)
      current = (current as unknown[])[0]
    }
    expect(current).toBe(0)
  })
})
