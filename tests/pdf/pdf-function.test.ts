// PostScript calculator (PDF FunctionType 4) operator coverage — the complete
// §7.10.5 operator set drives shadings, transfer/BG/UCR functions and tint
// transforms, so every operator must evaluate to the spec-defined result.

import { describe, it, expect } from 'vitest'
import { evaluateCalculatorSource, evaluatePdfFunction, evaluatePdfFunctionDef, readPdfFunctionDef } from '../../src/pdf/pdf-function.js'
import { parsePdf, type PdfValue } from '../../src/pdf/pdf-parser.js'

function functionPdf(functionObject: string): ReturnType<typeof parsePdf> {
  const objects = [
    '1 0 obj\n<< /Type /Catalog >>\nendobj\n',
    `2 0 obj\n${functionObject}\nendobj\n`,
  ]
  const header = '%PDF-2.0\n'
  const offsets = [0]
  let body = ''
  let offset = header.length
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    body += objects[i]!
    offset += objects[i]!.length
  }
  const xrefOffset = offset
  const xref = `xref\n0 3\n0000000000 65535 f \n${String(offsets[1]).padStart(10, '0')} 00000 n \n${String(offsets[2]).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return parsePdf(new TextEncoder().encode(header + body + xref + trailer))
}

function evaluateObject(functionObject: string, inputs: number[]): number[] {
  const doc = functionPdf(functionObject)
  return evaluatePdfFunction(doc, doc.getObject(2) as PdfValue, inputs)
}

function evalOne(src: string, inputs: number[] = []): number {
  const out = evaluateCalculatorSource(src, inputs, 1)
  return out[0]!
}

describe('PDF FunctionType 4 calculator operators (§7.10.5)', () => {
  it('arithmetic operators', () => {
    expect(evalOne('{ abs }', [-3.5])).toBeCloseTo(3.5, 6)
    expect(evalOne('{ 2 3 add }')).toBe(5)
    expect(evalOne('{ 10 4 sub }')).toBe(6)
    expect(evalOne('{ 6 7 mul }')).toBe(42)
    expect(evalOne('{ 9 2 div }')).toBeCloseTo(4.5, 6)
    expect(evalOne('{ 7 3 idiv }')).toBe(2)
    expect(evalOne('{ 7 3 mod }')).toBe(1)
    expect(evalOne('{ neg }', [4])).toBe(-4)
    expect(evalOne('{ 2 sqrt }')).toBeCloseTo(Math.SQRT2, 6)
    expect(evalOne('{ 2 10 exp }')).toBe(1024)
    expect(evalOne('{ ln }', [Math.E])).toBeCloseTo(1, 6)
    expect(evalOne('{ 1000 log }')).toBeCloseTo(3, 6)
    expect(evalOne('{ 0 sin }')).toBeCloseTo(0, 6)
    expect(evalOne('{ 0 cos }')).toBeCloseTo(1, 6)
    expect(evalOne('{ 1 1 atan }')).toBeCloseTo(45, 6)
    expect(evalOne('{ 0 -1 atan }')).toBeCloseTo(180, 6)
    expect(evalOne('{ ceiling }', [2.1])).toBe(3)
    expect(evalOne('{ floor }', [2.9])).toBe(2)
    expect(evalOne('{ round }', [2.5])).toBe(3)
    expect(evalOne('{ round }', [-2.5])).toBe(-3)
    expect(evalOne('{ truncate }', [-2.7])).toBe(-2)
    expect(evalOne('{ cvi }', [3.99])).toBe(3)
    expect(evalOne('{ 5 cvr 2 div }')).toBeCloseTo(2.5, 6)
  })

  it('stack operators', () => {
    expect(evalOne('{ dup mul }', [3])).toBe(9)
    expect(evalOne('{ exch sub }', [3, 10])).toBe(7)
    expect(evalOne('{ pop }', [5, 9])).toBe(5)
    expect(evalOne('{ 2 index }', [7, 8, 9])).toBe(7)
    expect(evalOne('{ 3 1 roll }', [10, 20, 30])).toBe(20) // → [30,10,20], top is 20
    expect(evalOne('{ 2 copy add add add }', [4, 5])).toBe(18) // [4,5,4,5]→4+5+4+5
  })

  it('boolean / relational operators via conditionals', () => {
    expect(evalOne('{ 3 3 eq { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ 3 4 ne { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ 5 2 gt { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ 2 2 ge { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ 1 2 lt { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ 2 2 le { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ true false and { 1 } { 0 } ifelse }')).toBe(0)
    expect(evalOne('{ true false or { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ false not { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ true false xor { 1 } { 0 } ifelse }')).toBe(1)
    expect(evalOne('{ 12 10 and }')).toBe(8)  // bitwise AND of integers
    expect(evalOne('{ 12 3 or }')).toBe(15)   // bitwise OR of integers
    expect(evalOne('{ 4 1 bitshift }')).toBe(8)
    expect(evalOne('{ 8 -1 bitshift }')).toBe(4)
    expect(evalOne('{ 5 0 gt { } if }', [5])).toBe(5) // `if` executes the block, leaving input
  })

  it('a realistic transfer curve (gamma) evaluates continuously', () => {
    // y = x^(1/2.2), a common display gamma inverse.
    const src = '{ 0.454545 exp }'
    expect(evalOne(src, [0])).toBeCloseTo(0, 6)
    expect(evalOne(src, [1])).toBeCloseTo(1, 6)
    expect(evalOne(src, [0.5])).toBeCloseTo(Math.pow(0.5, 0.454545), 5)
  })

  it('enforces calculator numeric domains and integer-only operators', () => {
    expect(() => evalOne('{ 1 0 div }')).toThrow(/division by zero/)
    expect(() => evalOne('{ -1 sqrt }')).toThrow(/non-negative/)
    expect(() => evalOne('{ 0 ln }')).toThrow(/positive/)
    expect(() => evalOne('{ 4.5 2 idiv }')).toThrow(/requires an integer/)
    expect(() => evalOne('{ 1.5 1 bitshift }')).toThrow(/requires an integer/)
    expect(evalOne('{ -8 -40 bitshift }')).toBe(-1)
    expect(evalOne('{ 8 40 bitshift }')).toBe(0)
  })
})

describe('PDF Function Type 0/2/3 common evaluation', () => {
  it('clips Type 2 inputs and outputs through Domain and Range', () => {
    const fn = '<< /FunctionType 2 /Domain [0 1] /Range [0 0.75] /C0 [0] /C1 [2] /N 2 >>'
    expect(evaluateObject(fn, [-1])).toEqual([0])
    expect(evaluateObject(fn, [0.5])[0]).toBeCloseTo(0.5, 8)
    expect(evaluateObject(fn, [2])).toEqual([0.75])
  })

  it('recursively evaluates nested Type 3 functions and mapped sub-domains', () => {
    const low = '<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [0.5] /N 1 >>'
    const high0 = '<< /FunctionType 2 /Domain [0 1] /C0 [0.5] /C1 [0.75] /N 1 >>'
    const high1 = '<< /FunctionType 2 /Domain [0 1] /C0 [0.75] /C1 [1] /N 1 >>'
    const high = `<< /FunctionType 3 /Domain [0 1] /Functions [${high0} ${high1}] /Bounds [0.5] /Encode [0 1 0 1] >>`
    const outer = `<< /FunctionType 3 /Domain [0 1] /Functions [${low} ${high}] /Bounds [0.5] /Encode [0 1 0 1] /Range [0 1] >>`
    expect(evaluateObject(outer, [0.25])[0]).toBeCloseTo(0.25, 8)
    expect(evaluateObject(outer, [0.625])[0]).toBeCloseTo(0.625, 8)
    expect(evaluateObject(outer, [0.875])[0]).toBeCloseTo(0.875, 8)
  })

  it('evaluates a Type 0 Order 3 sampled function at native sample precision', () => {
    const fn = '<< /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [4] /BitsPerSample 8 /Order 3 /Encode [0 3] /Decode [0 1] /Filter /ASCIIHexDecode /Length 9 >>\nstream\n0055AAFF>\nendstream'
    expect(evaluateObject(fn, [0])[0]).toBeCloseTo(0, 8)
    expect(evaluateObject(fn, [0.5])[0]).toBeCloseTo(0.5, 8)
    expect(evaluateObject(fn, [1])[0]).toBeCloseTo(1, 8)
  })

  it('evaluates the retained Type 0 model identically to the source object', () => {
    const fn = '<< /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [4] /BitsPerSample 8 /Order 3 /Encode [0 3] /Decode [0 1] /Filter /ASCIIHexDecode /Length 9 >>\nstream\n0055AAFF>\nendstream'
    const doc = functionPdf(fn)
    const value = doc.getObject(2) as PdfValue
    const retained = readPdfFunctionDef(doc, value)
    for (const input of [0, 0.125, 0.5, 0.875, 1]) {
      expect(evaluatePdfFunctionDef(retained, [input])[0]).toBeCloseTo(evaluatePdfFunction(doc, value, [input])[0]!, 8)
    }
  })

  it.each([3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 31])('rejects forbidden Type 0 BitsPerSample %i', (bits) => {
    const fn = `<< /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [1] /BitsPerSample ${bits} /Length 1 >>\nstream\n0\nendstream`
    expect(() => evaluateObject(fn, [0])).toThrow(/BitsPerSample is not permitted/)
  })

  it.each([1, 2, 4, 8, 12, 16, 24, 32])('decodes permitted Type 0 BitsPerSample %i', (bits) => {
    const hex = 'F'.repeat(Math.ceil(bits / 4))
    const fn = `<< /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [1] /BitsPerSample ${bits} /Order 3 /Filter /ASCIIHexDecode /Length ${hex.length + 1} >>\nstream\n${hex}>\nendstream`
    expect(evaluateObject(fn, [0])).toEqual([1])
  })
})
