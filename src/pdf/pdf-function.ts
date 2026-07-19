import type { GradientStopDef, PdfFunctionDef } from '../types/template.js'
import { PdfDocument, PdfStream, type PdfDict, type PdfValue } from './pdf-parser.js'

type CalcValue = number | boolean | CalcToken[]
type CalcToken = number | boolean | string | CalcToken[]

export function sampleCalculatorFunctionStops(doc: PdfDocument, stream: PdfStream, count = 17): GradientStopDef[] {
  const stops: GradientStopDef[] = []
  for (let i = 0; i < count; i++) {
    const offset = count === 1 ? 0 : i / (count - 1)
    stops.push({ offset, color: colorArrayToHex(evaluateCalculatorFunction(doc, stream, offset)) })
  }
  return stops
}

export function evaluateCalculatorFunction(doc: PdfDocument, stream: PdfStream, offset: number): number[] {
  return evaluateCalculatorFunctionInputs(doc, stream, [offset])
}

export function evaluatePdfFunction(doc: PdfDocument, value: PdfValue, inputs: number[]): number[] {
  return evaluatePdfFunctionInternal(doc, value, inputs, new Set<object>())
}

/** Evaluates the serializable PDF function model without a source document. */
export function evaluatePdfFunctionDef(def: PdfFunctionDef, inputs: number[]): number[] {
  if (inputs.length * 2 !== def.domain.length) throw new Error('PDF function input dimension mismatch')
  const clipped = inputs.map(function (input, index) { return clamp(input, def.domain[index * 2]!, def.domain[index * 2 + 1]!) })
  let output: number[]
  if (def.functionType === 4) output = evaluateCalculatorSource(def.expression, clipped, def.range.length / 2)
  else if (def.functionType === 2) {
    const power = Math.pow(clipped[0]!, def.exponent)
    output = def.c0.map(function (value, index) { return value + power * (def.c1[index]! - value) })
  } else if (def.functionType === 3) {
    const input = clipped[0]!
    let index = def.functions.length - 1
    for (let i = 0; i < def.bounds.length; i++) if (input < def.bounds[i]!) { index = i; break }
    const low = index === 0 ? def.domain[0] : def.bounds[index - 1]!
    const high = index === def.functions.length - 1 ? def.domain[1] : def.bounds[index]!
    const encoded = high === low ? def.encode[index * 2]! : def.encode[index * 2]! + (input - low) / (high - low) * (def.encode[index * 2 + 1]! - def.encode[index * 2]!)
    output = evaluatePdfFunctionDef(def.functions[index]!, [encoded])
  } else {
    const positions = clipped.map(function (input, d) {
      const d0 = def.domain[d * 2]!
      const d1 = def.domain[d * 2 + 1]!
      const encoded = d1 === d0 ? def.encode[d * 2]! : def.encode[d * 2]! + (input - d0) / (d1 - d0) * (def.encode[d * 2 + 1]! - def.encode[d * 2]!)
      return clamp(encoded, 0, def.size[d]! - 1)
    })
    const cubic = def.order === 3 && def.size.every(function (size) { return size >= 4 })
    const points = cubic ? 4 : 2
    const corners = Math.pow(points, inputs.length)
    output = new Array<number>(def.range.length / 2).fill(0)
    for (let corner = 0; corner < corners; corner++) {
      const indices = new Array<number>(inputs.length)
      let weight = 1
      let selector = corner
      for (let d = 0; d < inputs.length; d++) {
        const base = Math.floor(positions[d]!)
        const fraction = positions[d]! - base
        const point = selector % points
        selector = Math.trunc(selector / points)
        indices[d] = cubic ? clamp(base + point - 1, 0, def.size[d]! - 1) : Math.min(base + point, def.size[d]! - 1)
        weight *= cubic ? cubicWeight(point, fraction) : point === 1 ? fraction : 1 - fraction
      }
      const values = sampledFunctionValuesAt(def.data, def.size, def.bitsPerSample, def.decode, def.range, indices)
      for (let o = 0; o < output.length; o++) output[o] = output[o]! + values[o]! * weight
    }
  }
  const range = def.range
  if (range === undefined) return output
  return output.map(function (value, index) { return clamp(value, range[index * 2]!, range[index * 2 + 1]!) })
}

export function evaluateTransferFunctionDef(def: { expression: string } | PdfFunctionDef, input: number): number {
  return 'expression' in def
    ? evaluateCalculatorSource(def.expression, [input], 1)[0]!
    : evaluatePdfFunctionDef(def, [input])[0]!
}

/** Converts one PDF function object into the serializable render model. */
export function readPdfFunctionDef(doc: PdfDocument, value: PdfValue): PdfFunctionDef {
  return readPdfFunctionDefInternal(doc, value, new Set<object>())
}

function readPdfFunctionDefInternal(doc: PdfDocument, value: PdfValue, active: Set<object>): PdfFunctionDef {
  const resolved = doc.resolve(value)
  if (!(resolved instanceof Map) && !(resolved instanceof PdfStream)) {
    throw new Error('PDF import error: function must be a dictionary or stream')
  }
  if (active.has(resolved)) throw new Error('PDF import error: recursive function cycle')
  active.add(resolved)
  const dict = resolved instanceof PdfStream ? resolved.dict : resolved
  const type = numberValue(doc.resolve(dict.get('FunctionType') ?? null), 'function FunctionType')
  let definition: PdfFunctionDef
  if (type === 0) {
    if (!(resolved instanceof PdfStream)) throw new Error('PDF import error: sampled function must be a stream')
    const domain = numberArray(doc, dict, 'Domain')
    const range = numberArray(doc, dict, 'Range')
    const size = numberArray(doc, dict, 'Size')
    if (domain.length !== size.length * 2) throw new Error('PDF import error: sampled function Domain must match Size')
    if (range.length < 2 || range.length % 2 !== 0) throw new Error('PDF import error: sampled function Range must contain output pairs')
    validateOrderedPairs(domain, 'sampled function Domain')
    validateOrderedPairs(range, 'sampled function Range')
    for (let i = 0; i < size.length; i++) {
      if (!Number.isInteger(size[i]) || size[i]! <= 0) throw new Error('PDF import error: sampled function Size values must be positive integers')
    }
    const bits = numberValue(doc.resolve(dict.get('BitsPerSample') ?? null), 'sampled function BitsPerSample')
    if (bits !== 1 && bits !== 2 && bits !== 4 && bits !== 8 && bits !== 12 && bits !== 16 && bits !== 24 && bits !== 32) {
      throw new Error('PDF import error: sampled function BitsPerSample is not permitted')
    }
    const orderValue = doc.resolve(dict.get('Order') ?? null)
    if (orderValue !== null && orderValue !== 1 && orderValue !== 3) throw new Error('PDF import error: sampled function Order must be 1 or 3')
    const order: 1 | 3 = orderValue === 3 ? 3 : 1
    const encode = optionalNumberArray(doc, dict, 'Encode') ?? defaultEncode(size)
    const decode = optionalNumberArray(doc, dict, 'Decode') ?? range.slice()
    if (encode.length !== domain.length) throw new Error('PDF import error: sampled function Encode must match input dimension')
    if (decode.length !== range.length) throw new Error('PDF import error: sampled function Decode must match output dimension')
    let samplePoints = 1
    for (let i = 0; i < size.length; i++) samplePoints *= size[i]!
    const data = doc.decodeStream(resolved).slice()
    const requiredBits = samplePoints * (range.length / 2) * bits
    if (!Number.isSafeInteger(requiredBits) || data.length * 8 < requiredBits) throw new Error('PDF import error: sampled function stream is truncated')
    definition = { functionType: 0, domain, range, size, bitsPerSample: bits, order, encode, decode, data }
  } else if (type === 2) {
    const domain = numberArray(doc, dict, 'Domain')
    if (domain.length !== 2 || domain[0]! > domain[1]!) throw new Error('PDF import error: exponential function Domain must be an ordered pair')
    const c0 = optionalNumberArray(doc, dict, 'C0') ?? [0]
    const c1 = optionalNumberArray(doc, dict, 'C1') ?? [1]
    if (c0.length !== c1.length) throw new Error('PDF import error: exponential function C0/C1 length mismatch')
    const exponent = numberValue(doc.resolve(dict.get('N') ?? null), 'exponential function N')
    const range = optionalNumberArray(doc, dict, 'Range')
    if (range !== null) validateOrderedPairs(range, 'exponential function Range')
    definition = {
      functionType: 2,
      domain: [domain[0]!, domain[1]!],
      ...(range === null ? {} : { range }),
      c0,
      c1,
      exponent,
    }
  } else if (type === 3) {
    const domain = numberArray(doc, dict, 'Domain')
    if (domain.length !== 2) throw new Error('PDF import error: stitching function Domain must contain one pair')
    const values = doc.resolve(dict.get('Functions') ?? null)
    if (!Array.isArray(values) || values.length === 0) throw new Error('PDF import error: stitching function requires sub-functions')
    const functions: PdfFunctionDef[] = []
    for (let i = 0; i < values.length; i++) functions.push(readPdfFunctionDefInternal(doc, values[i]!, active))
    const bounds = numberArray(doc, dict, 'Bounds')
    const encode = numberArray(doc, dict, 'Encode')
    if (bounds.length !== functions.length - 1) throw new Error('PDF import error: stitching function Bounds length must be sub-functions minus one')
    if (encode.length !== functions.length * 2) throw new Error('PDF import error: stitching function Encode must contain two numbers per sub-function')
    let previous = domain[0]!
    for (let i = 0; i < bounds.length; i++) {
      if (bounds[i]! < previous || bounds[i]! > domain[1]!) throw new Error('PDF import error: stitching function Bounds must be ordered within Domain')
      previous = bounds[i]!
    }
    const range = optionalNumberArray(doc, dict, 'Range')
    if (range !== null) validateOrderedPairs(range, 'stitching function Range')
    definition = {
      functionType: 3,
      domain: [domain[0]!, domain[1]!],
      ...(range === null ? {} : { range }),
      functions,
      bounds,
      encode,
    }
  } else if (type === 4) {
    if (!(resolved instanceof PdfStream)) throw new Error('PDF import error: calculator function must be a stream')
    const domain = numberArray(doc, dict, 'Domain')
    const range = numberArray(doc, dict, 'Range')
    const expression = ascii(doc.decodeStream(resolved)).trim()
    validateOrderedPairs(domain, 'calculator function Domain')
    validateOrderedPairs(range, 'calculator function Range')
    parseCalculatorProgram(expression)
    definition = { functionType: 4, domain, range, expression }
  } else {
    throw new Error(`PDF import error: unsupported function type ${type}`)
  }
  active.delete(resolved)
  return definition
}

function evaluatePdfFunctionInternal(doc: PdfDocument, value: PdfValue, inputs: number[], active: Set<object>): number[] {
  const resolved = doc.resolve(value)
  if (Array.isArray(resolved)) {
    const output: number[] = []
    for (let i = 0; i < resolved.length; i++) output.push(...evaluatePdfFunctionInternal(doc, resolved[i]!, inputs, active))
    return output
  }
  if (!(resolved instanceof Map) && !(resolved instanceof PdfStream)) {
    throw new Error('PDF import error: function must be a dictionary or stream')
  }
  if (active.has(resolved)) throw new Error('PDF import error: recursive function cycle')
  active.add(resolved)
  const dict = resolved instanceof PdfStream ? resolved.dict : resolved
  const type = numberValue(doc.resolve(dict.get('FunctionType') ?? null), 'function FunctionType')
  let output: number[]
  if (type === 0) {
    if (!(resolved instanceof PdfStream)) throw new Error('PDF import error: sampled function must be a stream')
    output = evaluateSampledFunction(doc, resolved, inputs)
  } else if (type === 2) {
    output = evaluateExponentialFunction(doc, dict, inputs)
  } else if (type === 3) {
    output = evaluateStitchingFunction(doc, dict, inputs, active)
  } else if (type === 4) {
    if (!(resolved instanceof PdfStream)) throw new Error('PDF import error: calculator function must be a stream')
    output = evaluateCalculatorFunctionInputs(doc, resolved, inputs)
  } else {
    throw new Error(`PDF import error: unsupported function type ${type}`)
  }
  active.delete(resolved)
  return output
}

function evaluateExponentialFunction(doc: PdfDocument, dict: PdfDict, inputs: number[]): number[] {
  if (inputs.length !== 1) throw new Error('PDF import error: exponential function requires one input')
  const domain = numberArray(doc, dict, 'Domain')
  if (domain.length !== 2 || domain[0]! > domain[1]!) throw new Error('PDF import error: exponential function Domain must be an ordered pair')
  const c0 = optionalNumberArray(doc, dict, 'C0') ?? [0]
  const c1 = optionalNumberArray(doc, dict, 'C1') ?? [1]
  if (c0.length !== c1.length) throw new Error('PDF import error: exponential function C0/C1 length mismatch')
  const exponent = numberValue(doc.resolve(dict.get('N') ?? null), 'exponential function N')
  const input = clamp(inputs[0]!, domain[0]!, domain[1]!)
  const power = Math.pow(input, exponent)
  const output = new Array<number>(c0.length)
  for (let i = 0; i < output.length; i++) output[i] = c0[i]! + power * (c1[i]! - c0[i]!)
  return clipFunctionRange(doc, dict, output)
}

function evaluateStitchingFunction(doc: PdfDocument, dict: PdfDict, inputs: number[], active: Set<object>): number[] {
  if (inputs.length !== 1) throw new Error('PDF import error: stitching function requires one input')
  const domain = numberArray(doc, dict, 'Domain')
  if (domain.length !== 2 || domain[0]! > domain[1]!) throw new Error('PDF import error: stitching function Domain must be an ordered pair')
  const functions = doc.resolve(dict.get('Functions') ?? null)
  if (!Array.isArray(functions) || functions.length === 0) throw new Error('PDF import error: stitching function requires sub-functions')
  const bounds = numberArray(doc, dict, 'Bounds')
  const encode = numberArray(doc, dict, 'Encode')
  if (bounds.length !== functions.length - 1) throw new Error('PDF import error: stitching function Bounds length must be sub-functions minus one')
  if (encode.length !== functions.length * 2) throw new Error('PDF import error: stitching function Encode must contain two numbers per sub-function')
  let previous = domain[0]!
  for (let i = 0; i < bounds.length; i++) {
    if (bounds[i]! < previous || bounds[i]! > domain[1]!) throw new Error('PDF import error: stitching function Bounds must be ordered within Domain')
    previous = bounds[i]!
  }
  const input = clamp(inputs[0]!, domain[0]!, domain[1]!)
  let index = functions.length - 1
  for (let i = 0; i < bounds.length; i++) {
    if (input < bounds[i]!) { index = i; break }
  }
  const low = index === 0 ? domain[0]! : bounds[index - 1]!
  const high = index === functions.length - 1 ? domain[1]! : bounds[index]!
  const encoded = high === low
    ? encode[index * 2]!
    : encode[index * 2]! + (input - low) / (high - low) * (encode[index * 2 + 1]! - encode[index * 2]!)
  return clipFunctionRange(doc, dict, evaluatePdfFunctionInternal(doc, functions[index]!, [encoded], active))
}

function clipFunctionRange(doc: PdfDocument, dict: PdfDict, output: number[]): number[] {
  const range = optionalNumberArray(doc, dict, 'Range')
  if (range === null) return output
  if (range.length !== output.length * 2) throw new Error('PDF import error: function Range must match output dimension')
  const clipped = new Array<number>(output.length)
  for (let i = 0; i < output.length; i++) {
    if (range[i * 2]! > range[i * 2 + 1]!) throw new Error('PDF import error: function Range pairs must be ordered')
    clipped[i] = clamp(output[i]!, range[i * 2]!, range[i * 2 + 1]!)
  }
  return clipped
}

export function evaluateSampledFunction(doc: PdfDocument, stream: PdfStream, inputs: number[]): number[] {
  const dict = stream.dict
  const size = numberArray(doc, dict, 'Size')
  if (size.length !== inputs.length) throw new Error('PDF import error: sampled function input dimension mismatch')
  for (let i = 0; i < size.length; i++) {
    if (!Number.isInteger(size[i]) || size[i]! <= 0) throw new Error('PDF import error: sampled function Size values must be positive integers')
  }
  const domain = numberArray(doc, dict, 'Domain')
  if (domain.length !== inputs.length * 2) throw new Error('PDF import error: sampled function Domain must match input dimension')
  const range = numberArray(doc, dict, 'Range')
  if (range.length < 2 || range.length % 2 !== 0) throw new Error('PDF import error: sampled function Range must contain output pairs')
  validateOrderedPairs(domain, 'sampled function Domain')
  validateOrderedPairs(range, 'sampled function Range')
  const bitsPerSample = numberValue(doc.resolve(dict.get('BitsPerSample') ?? null), 'sampled function BitsPerSample')
  if (![1, 2, 4, 8, 12, 16, 24, 32].includes(bitsPerSample)) {
    throw new Error('PDF import error: sampled function BitsPerSample is not permitted')
  }
  const order = doc.resolve(dict.get('Order') ?? null)
  if (order !== null && order !== 1 && order !== 3) throw new Error('PDF import error: sampled function Order must be 1 or 3')
  const encode = optionalNumberArray(doc, dict, 'Encode') ?? defaultEncode(size)
  if (encode.length !== inputs.length * 2) throw new Error('PDF import error: sampled function Encode must match input dimension')
  const decode = optionalNumberArray(doc, dict, 'Decode') ?? range
  if (decode.length !== range.length) throw new Error('PDF import error: sampled function Decode must match Range output dimension')

  const data = doc.decodeStream(stream)
  let samplePoints = 1
  for (let i = 0; i < size.length; i++) {
    samplePoints *= size[i]!
    if (!Number.isSafeInteger(samplePoints)) throw new Error('PDF import error: sampled function sample table is too large')
  }
  const requiredBits = samplePoints * (range.length / 2) * bitsPerSample
  if (!Number.isSafeInteger(requiredBits) || data.length * 8 < requiredBits) {
    throw new Error('PDF import error: sampled function stream is truncated')
  }
  const positions = new Array<number>(inputs.length)
  for (let d = 0; d < inputs.length; d++) {
    const d0 = domain[d * 2]!
    const d1 = domain[d * 2 + 1]!
    const e0 = encode[d * 2]!
    const e1 = encode[d * 2 + 1]!
    const input = clamp(inputs[d]!, Math.min(d0, d1), Math.max(d0, d1))
    const span = d1 - d0
    const encoded = span === 0 ? e0 : e0 + (input - d0) / span * (e1 - e0)
    positions[d] = clamp(encoded, 0, size[d]! - 1)
  }

  const outputs = range.length / 2
  const cubic = order === 3 && size.every(function (dimension) { return dimension >= 4 })
  const pointCount = cubic ? 4 : 2
  const corners = Math.pow(pointCount, inputs.length)
  const result = new Array<number>(outputs).fill(0)
  for (let corner = 0; corner < corners; corner++) {
    const indices = new Array<number>(inputs.length)
    let weight = 1
    let selector = corner
    for (let d = 0; d < inputs.length; d++) {
      const base = Math.floor(positions[d]!)
      const fraction = positions[d]! - base
      const point = selector % pointCount
      selector = Math.trunc(selector / pointCount)
      if (cubic) {
        indices[d] = Math.max(0, Math.min(size[d]! - 1, base + point - 1))
        weight *= cubicWeight(point, fraction)
      } else {
        indices[d] = Math.min(base + point, size[d]! - 1)
        weight *= point === 1 ? fraction : 1 - fraction
      }
    }
    if (weight === 0) continue
    const values = sampledFunctionValuesAt(data, size, bitsPerSample, decode, range, indices)
    for (let o = 0; o < outputs; o++) result[o] = result[o]! + values[o]! * weight
  }
  return result
}

function validateOrderedPairs(values: number[], label: string): void {
  for (let i = 0; i < values.length; i += 2) {
    if (values[i]! > values[i + 1]!) throw new Error(`PDF import error: ${label} pairs must be ordered`)
  }
}

function cubicWeight(point: number, fraction: number): number {
  const square = fraction * fraction
  const cube = square * fraction
  if (point === 0) return -0.5 * fraction + square - 0.5 * cube
  if (point === 1) return 1 - 2.5 * square + 1.5 * cube
  if (point === 2) return 0.5 * fraction + 2 * square - 1.5 * cube
  return -0.5 * square + 0.5 * cube
}

const calculatorProgramCache = new Map<string, CalcToken[]>()

/**
 * Evaluates a PostScript calculator program (PDF FunctionType 4 body) from
 * its source text — no document context needed. Inputs are pushed in order;
 * the last `outputs` stack values are returned.
 */
export function evaluateCalculatorSource(source: string, inputs: number[], outputs: number): number[] {
  let program = calculatorProgramCache.get(source)
  if (program === undefined) {
    program = parseCalculatorProgram(source)
    calculatorProgramCache.set(source, program)
  }
  const stack: CalcValue[] = []
  for (let i = 0; i < inputs.length; i++) stack.push(inputs[i]!)
  executeTokens(program, stack)
  if (stack.length < outputs) throw new Error('PDF import error: calculator function produced too few outputs')
  const values = stack.splice(stack.length - outputs, outputs)
  const out: number[] = []
  for (let i = 0; i < outputs; i++) {
    const value = values[i]
    if (typeof value !== 'number') throw new Error('PDF import error: calculator function output must be numeric')
    out.push(value)
  }
  return out
}

export function evaluateCalculatorFunctionInputs(doc: PdfDocument, stream: PdfStream, inputs: number[]): number[] {
  const domain = numberArray(doc, stream.dict, 'Domain')
  const range = numberArray(doc, stream.dict, 'Range')
  if (domain.length !== inputs.length * 2) throw new Error('PDF import error: calculator function Domain must match input dimension')
  if (range.length < 2 || range.length % 2 !== 0) throw new Error('PDF import error: calculator function Range must contain output pairs')
  const program = parseCalculatorProgram(ascii(doc.decodeStream(stream)))
  const stack: CalcValue[] = []
  for (let i = 0; i < inputs.length; i++) {
    const d0 = domain[i * 2]!
    const d1 = domain[i * 2 + 1]!
    const input = Math.max(Math.min(inputs[i]!, Math.max(d0, d1)), Math.min(d0, d1))
    stack.push(input)
  }
  executeTokens(program, stack)
  const outputs = range.length / 2
  if (stack.length < outputs) throw new Error('PDF import error: calculator function produced too few outputs')
  const values = stack.splice(stack.length - outputs, outputs)
  const out: number[] = []
  for (let i = 0; i < outputs; i++) {
    const value = values[i]
    if (typeof value !== 'number') throw new Error('PDF import error: calculator function output must be numeric')
    const r0 = range[i * 2]!
    const r1 = range[i * 2 + 1]!
    out.push(Math.max(Math.min(value, Math.max(r0, r1)), Math.min(r0, r1)))
  }
  return out
}

function sampledFunctionValuesAt(data: Uint8Array, size: number[], bitsPerSample: number, decode: number[], range: number[], indices: number[]): number[] {
  let flat = 0
  let stride = 1
  for (let d = 0; d < indices.length; d++) {
    flat += indices[d]! * stride
    stride *= size[d]!
  }
  const outputs = range.length / 2
  const maxSample = bitsPerSample >= 32 ? 0xffffffff : (1 << bitsPerSample) - 1
  const bitOffset = flat * outputs * bitsPerSample
  const values: number[] = []
  for (let o = 0; o < outputs; o++) {
    const raw = readBits(data, bitOffset + o * bitsPerSample, bitsPerSample)
    const d0 = decode[o * 2]!
    const d1 = decode[o * 2 + 1]!
    const r0 = range[o * 2]!
    const r1 = range[o * 2 + 1]!
    values.push(clamp(d0 + raw / maxSample * (d1 - d0), Math.min(r0, r1), Math.max(r0, r1)))
  }
  return values
}

function defaultEncode(size: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < size.length; i++) out.push(0, size[i]! - 1)
  return out
}

function parseCalculatorProgram(source: string): CalcToken[] {
  const lexer = new CalculatorLexer(source)
  const token = lexer.next()
  if (token !== '{') throw new Error('PDF import error: calculator function stream must start with a procedure')
  const program = parseProcedure(lexer)
  if (lexer.next() !== null) throw new Error('PDF import error: calculator function has trailing tokens')
  return program
}

function parseProcedure(lexer: CalculatorLexer): CalcToken[] {
  const out: CalcToken[] = []
  for (;;) {
    const token = lexer.next()
    if (token === null) throw new Error('PDF import error: unterminated calculator function procedure')
    if (token === '}') return out
    if (token === '{') out.push(parseProcedure(lexer))
    else if (token === 'true') out.push(true)
    else if (token === 'false') out.push(false)
    else if (isNumberToken(token)) out.push(Number(token))
    else out.push(token)
  }
}

class CalculatorLexer {
  private readonly source: string
  private pos = 0

  constructor(source: string) {
    this.source = source
  }

  next(): string | null {
    this.skipIgnored()
    if (this.pos >= this.source.length) return null
    const ch = this.source[this.pos]!
    if (ch === '{' || ch === '}') {
      this.pos++
      return ch
    }
    const start = this.pos
    while (this.pos < this.source.length) {
      const c = this.source[this.pos]!
      if (isWhite(c) || c === '{' || c === '}' || c === '%') break
      this.pos++
    }
    return this.source.slice(start, this.pos)
  }

  private skipIgnored(): void {
    for (;;) {
      while (this.pos < this.source.length && isWhite(this.source[this.pos]!)) this.pos++
      if (this.source[this.pos] !== '%') return
      while (this.pos < this.source.length && this.source[this.pos] !== '\n' && this.source[this.pos] !== '\r') this.pos++
    }
  }
}

function executeTokens(tokens: CalcToken[], stack: CalcValue[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (typeof token === 'number' || typeof token === 'boolean' || Array.isArray(token)) {
      stack.push(token)
    } else {
      executeOperator(token, stack)
    }
  }
}

function executeOperator(op: string, stack: CalcValue[]): void {
  switch (op) {
    case 'abs': stack.push(Math.abs(popNumber(stack, op))); return
    case 'add': binaryNumber(stack, op, function add(a, b) { return a + b }); return
    case 'atan': binaryNumber(stack, op, function atan(a, b) {
      // PostScript atan returns 0 <= angle < 360
      const degrees = Math.atan2(a, b) * 180 / Math.PI
      return degrees < 0 ? degrees + 360 : degrees
    }); return
    case 'ceiling': stack.push(Math.ceil(popNumber(stack, op))); return
    case 'cos': stack.push(Math.cos(popNumber(stack, op) * Math.PI / 180)); return
    case 'cvi': {
      const value = Math.trunc(popNumber(stack, op))
      if (value < -2147483648 || value > 2147483647) throw new Error('PDF import error: calculator cvi result is outside integer range')
      stack.push(value)
      return
    }
    case 'cvr': stack.push(popNumber(stack, op)); return
    case 'div': binaryNumber(stack, op, function div(a, b) {
      if (b === 0) throw new Error('PDF import error: calculator division by zero')
      return a / b
    }); return
    case 'exp': binaryNumber(stack, op, function exp(a, b) {
      const result = Math.pow(a, b)
      if (!Number.isFinite(result)) throw new Error('PDF import error: calculator exp result is not finite')
      return result
    }); return
    case 'floor': stack.push(Math.floor(popNumber(stack, op))); return
    case 'idiv': binaryInteger(stack, op, function idiv(a, b) {
      if (b === 0) throw new Error('PDF import error: calculator division by zero')
      return Math.trunc(a / b)
    }); return
    case 'ln': {
      const value = popNumber(stack, op)
      if (value <= 0) throw new Error('PDF import error: calculator ln operand must be positive')
      stack.push(Math.log(value))
      return
    }
    case 'log': {
      const value = popNumber(stack, op)
      if (value <= 0) throw new Error('PDF import error: calculator log operand must be positive')
      stack.push(Math.log10(value))
      return
    }
    case 'mod': binaryInteger(stack, op, function mod(a, b) {
      if (b === 0) throw new Error('PDF import error: calculator division by zero')
      return a % b
    }); return
    case 'mul': binaryNumber(stack, op, function mul(a, b) { return a * b }); return
    case 'neg': stack.push(-popNumber(stack, op)); return
    case 'round': {
      const value = popNumber(stack, op)
      stack.push(value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5))
      return
    }
    case 'sin': stack.push(Math.sin(popNumber(stack, op) * Math.PI / 180)); return
    case 'sqrt': {
      const value = popNumber(stack, op)
      if (value < 0) throw new Error('PDF import error: calculator sqrt operand must be non-negative')
      stack.push(Math.sqrt(value))
      return
    }
    case 'sub': binaryNumber(stack, op, function sub(a, b) { return a - b }); return
    case 'truncate': stack.push(Math.trunc(popNumber(stack, op))); return
    case 'and': binaryBoolOrInt(stack, op, function bool(a, b) { return a && b }, function int(a, b) { return a & b }); return
    case 'bitshift': bitshift(stack, op); return
    case 'eq': compare(stack, function eq(a, b) { return a === b }); return
    case 'false': stack.push(false); return
    case 'ge': binaryNumberBool(stack, op, function ge(a, b) { return a >= b }); return
    case 'gt': binaryNumberBool(stack, op, function gt(a, b) { return a > b }); return
    case 'le': binaryNumberBool(stack, op, function le(a, b) { return a <= b }); return
    case 'lt': binaryNumberBool(stack, op, function lt(a, b) { return a < b }); return
    case 'ne': compare(stack, function ne(a, b) { return a !== b }); return
    case 'not': not(stack, op); return
    case 'or': binaryBoolOrInt(stack, op, function bool(a, b) { return a || b }, function int(a, b) { return a | b }); return
    case 'true': stack.push(true); return
    case 'xor': binaryBoolOrInt(stack, op, function bool(a, b) { return a !== b }, function int(a, b) { return a ^ b }); return
    case 'copy': copy(stack, op); return
    case 'dup': stack.push(peek(stack, 0, op)); return
    case 'exch': exch(stack, op); return
    case 'index': index(stack, op); return
    case 'pop': pop(stack, op); return
    case 'roll': roll(stack, op); return
    case 'if': opIf(stack, op); return
    case 'ifelse': opIfElse(stack, op); return
    default: throw new Error(`PDF import error: unsupported calculator function operator ${op}`)
  }
}

function binaryNumber(stack: CalcValue[], op: string, fn: (a: number, b: number) => number): void {
  const b = popNumber(stack, op)
  const a = popNumber(stack, op)
  stack.push(fn(a, b))
}

function binaryNumberBool(stack: CalcValue[], op: string, fn: (a: number, b: number) => boolean): void {
  const b = popNumber(stack, op)
  const a = popNumber(stack, op)
  stack.push(fn(a, b))
}

function binaryInteger(stack: CalcValue[], op: string, fn: (a: number, b: number) => number): void {
  const b = popInteger(stack, op)
  const a = popInteger(stack, op)
  stack.push(fn(a, b))
}

function binaryBoolOrInt(
  stack: CalcValue[],
  op: string,
  boolFn: (a: boolean, b: boolean) => boolean,
  intFn: (a: number, b: number) => number,
): void {
  const b = pop(stack, op)
  const a = pop(stack, op)
  if (typeof a === 'boolean' && typeof b === 'boolean') stack.push(boolFn(a, b))
  else if (typeof a === 'number' && typeof b === 'number' && Number.isInteger(a) && Number.isInteger(b)) stack.push(intFn(a | 0, b | 0))
  else throw new Error(`PDF import error: calculator operator ${op} requires matching booleans or integers`)
}

function bitshift(stack: CalcValue[], op: string): void {
  const shift = popInteger(stack, op)
  const value = popInteger(stack, op) | 0
  if (shift > 31) stack.push(0)
  else if (shift < -31) stack.push(value < 0 ? -1 : 0)
  else stack.push(shift >= 0 ? value << shift : value >> -shift)
}

function compare(stack: CalcValue[], fn: (a: CalcValue, b: CalcValue) => boolean): void {
  const b = pop(stack, 'compare')
  const a = pop(stack, 'compare')
  stack.push(fn(a, b))
}

function not(stack: CalcValue[], op: string): void {
  const value = pop(stack, op)
  if (typeof value === 'boolean') stack.push(!value)
  else if (typeof value === 'number') stack.push(~(value | 0))
  else throw new Error('PDF import error: calculator not requires boolean or integer')
}

function copy(stack: CalcValue[], op: string): void {
  const n = popInteger(stack, op)
  if (n < 0 || n > stack.length) throw new Error('PDF import error: calculator copy count is out of range')
  const start = stack.length - n
  for (let i = 0; i < n; i++) stack.push(stack[start + i]!)
}

function exch(stack: CalcValue[], op: string): void {
  if (stack.length < 2) throw new Error(`PDF import error: calculator stack underflow for ${op}`)
  const a = stack.pop()!
  const b = stack.pop()!
  stack.push(a, b)
}

function index(stack: CalcValue[], op: string): void {
  const n = popInteger(stack, op)
  stack.push(peek(stack, n, op))
}

function roll(stack: CalcValue[], op: string): void {
  const j = popInteger(stack, op)
  const n = popInteger(stack, op)
  if (n < 0 || n > stack.length) throw new Error('PDF import error: calculator roll count is out of range')
  if (n === 0) return
  const segment = stack.splice(stack.length - n, n)
  const shift = ((j % n) + n) % n
  stack.push(...segment.slice(n - shift), ...segment.slice(0, n - shift))
}

function opIf(stack: CalcValue[], op: string): void {
  const proc = popProcedure(stack, op)
  const cond = popBoolean(stack, op)
  if (cond) executeTokens(proc, stack)
}

function opIfElse(stack: CalcValue[], op: string): void {
  const falseProc = popProcedure(stack, op)
  const trueProc = popProcedure(stack, op)
  const cond = popBoolean(stack, op)
  executeTokens(cond ? trueProc : falseProc, stack)
}

function popNumber(stack: CalcValue[], op: string): number {
  const value = pop(stack, op)
  if (typeof value !== 'number') throw new Error(`PDF import error: calculator operator ${op} requires a number`)
  return value
}

function popInteger(stack: CalcValue[], op: string): number {
  const value = popNumber(stack, op)
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error(`PDF import error: calculator operator ${op} requires an integer`)
  }
  return value
}

function popBoolean(stack: CalcValue[], op: string): boolean {
  const value = pop(stack, op)
  if (typeof value !== 'boolean') throw new Error(`PDF import error: calculator operator ${op} requires a boolean`)
  return value
}

function popProcedure(stack: CalcValue[], op: string): CalcToken[] {
  const value = pop(stack, op)
  if (!Array.isArray(value)) throw new Error(`PDF import error: calculator operator ${op} requires a procedure`)
  return value
}

function pop(stack: CalcValue[], op: string): CalcValue {
  const value = stack.pop()
  if (value === undefined) throw new Error(`PDF import error: calculator stack underflow for ${op}`)
  return value
}

function peek(stack: CalcValue[], depth: number, op: string): CalcValue {
  if (depth < 0 || depth >= stack.length) throw new Error(`PDF import error: calculator stack underflow for ${op}`)
  return stack[stack.length - 1 - depth]!
}

function numberArray(doc: PdfDocument, dict: PdfDict, key: string): number[] {
  const value = doc.resolve(dict.get(key) ?? null)
  if (!Array.isArray(value)) throw new Error(`PDF import error: calculator function /${key} must be an array`)
  const out: number[] = []
  for (let i = 0; i < value.length; i++) {
    const item = doc.resolve(value[i]!)
    if (typeof item !== 'number') throw new Error(`PDF import error: function /${key} must contain numbers`)
    out.push(item)
  }
  return out
}

function optionalNumberArray(doc: PdfDocument, dict: PdfDict, key: string): number[] | null {
  const value = doc.resolve(dict.get(key) ?? null)
  if (value === null) return null
  if (!Array.isArray(value)) throw new Error(`PDF import error: function /${key} must be an array`)
  const out: number[] = []
  for (let i = 0; i < value.length; i++) {
    const item = doc.resolve(value[i]!)
    if (typeof item !== 'number') throw new Error(`PDF import error: function /${key} must contain numbers`)
    out.push(item)
  }
  return out
}

function numberValue(value: PdfValue, label: string): number {
  if (typeof value !== 'number') throw new Error(`PDF import error: ${label} must be a number`)
  return value
}

function readBits(data: Uint8Array, bitPos: number, bits: number): number {
  let value = 0
  for (let i = 0; i < bits; i++) {
    const byte = data[(bitPos + i) >> 3]
    if (byte === undefined) throw new Error('PDF import error: sampled function stream is truncated')
    const bit = 7 - ((bitPos + i) & 7)
    value = value * 2 + ((byte >> bit) & 1)
  }
  return value
}

function clamp(value: number, min: number, max: number): number {
  if (value <= min) return min
  if (value >= max) return max
  return value
}

function colorArrayToHex(values: number[]): string {
  if (values.length === 1) return rgbColor(values[0]!, values[0]!, values[0]!)
  if (values.length < 3) throw new Error('PDF import error: calculator color requires at least three components')
  return rgbColor(values[0]!, values[1]!, values[2]!)
}

function rgbColor(r: number, g: number, b: number): string {
  return '#' + byteHex(r) + byteHex(g) + byteHex(b)
}

function byteHex(v: number): string {
  const n = Math.max(0, Math.min(255, Math.round(v * 255)))
  return n.toString(16).padStart(2, '0')
}

function ascii(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

function isNumberToken(token: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(token)
}

function isWhite(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0'
}
