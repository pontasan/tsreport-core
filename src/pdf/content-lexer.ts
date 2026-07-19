import { PdfName, PdfString, type PdfDict, type PdfValue } from './pdf-parser.js'

export type PdfContentToken =
  | { type: 'object'; value: PdfValue }
  | { type: 'operator'; value: string }
  | { type: 'inlineImage'; dict: PdfDict; data: Uint8Array }
  | { type: 'eof' }

export class PdfContentLexer {
  private readonly data: Uint8Array
  private pos = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  get offset(): number {
    return this.pos
  }

  next(): PdfContentToken {
    this.skipSpace()
    if (this.pos >= this.data.length) return { type: 'eof' }
    const b = this.data[this.pos]!
    if (b === 0x2F) return { type: 'object', value: this.readName() }
    if (b === 0x28) return { type: 'object', value: this.readLiteralString() }
    if (b === 0x3C) {
      if (this.data[this.pos + 1] === 0x3C) return { type: 'object', value: this.readDict() }
      return { type: 'object', value: this.readHexString() }
    }
    if (b === 0x5B) return { type: 'object', value: this.readArray() }
    if (isNumberStart(b)) return { type: 'object', value: this.readNumber() }
    const word = this.readWord()
    if (word === 'BI') return this.readInlineImage()
    // Boolean / null literals are operands, not operators: they appear as values
    // in marked-content property lists (e.g. /Layer << /Visible
    // true ... >> BDC) and as ordinary operands.
    if (word === 'true') return { type: 'object', value: true }
    if (word === 'false') return { type: 'object', value: false }
    if (word === 'null') return { type: 'object', value: null }
    return { type: 'operator', value: word }
  }

  private readInlineImage(): PdfContentToken {
    const dict: PdfDict = new Map()
    for (;;) {
      this.skipSpace()
      if (this.data[this.pos] === 0x49 && this.data[this.pos + 1] === 0x44 && isWhite(this.data[this.pos + 2] ?? 0x20)) {
        this.pos += 2
        break
      }
      const keyToken = this.next()
      if (keyToken.type !== 'object' || !(keyToken.value instanceof PdfName)) {
        throw new Error(`PDF import error: inline image dictionary key must be a name at byte ${this.pos}`)
      }
      const value = this.next()
      if (value.type !== 'object') {
        throw new Error(`PDF import error: inline image dictionary value expected at byte ${this.pos}`)
      }
      dict.set(keyToken.value.name, value.value)
    }
    if (isWhite(this.data[this.pos] ?? 0)) this.pos++
    const start = this.pos
    for (;;) {
      const ei = indexOfInlineImageEnd(this.data, this.pos)
      if (ei < 0) {
        throw new Error('PDF import error: inline image EI marker not found')
      }
      this.pos = ei + 2
      const end = isWhite(this.data[ei - 1] ?? 0) ? ei - 1 : ei
      return { type: 'inlineImage', dict, data: this.data.subarray(start, end) }
    }
  }

  private readArray(): PdfValue[] {
    this.pos++
    const values: PdfValue[] = []
    for (;;) {
      this.skipSpace()
      if (this.pos >= this.data.length) {
        throw new Error('PDF import error: unterminated content array')
      }
      if (this.data[this.pos] === 0x5D) {
        this.pos++
        return values
      }
      const token = this.next()
      if (token.type !== 'object') {
        throw new Error(`PDF import error: array value expected at byte ${this.pos}`)
      }
      values.push(token.value)
    }
  }

  private readDict(): PdfDict {
    this.pos += 2
    const dict: PdfDict = new Map()
    for (;;) {
      this.skipSpace()
      if (this.pos + 1 < this.data.length && this.data[this.pos] === 0x3E && this.data[this.pos + 1] === 0x3E) {
        this.pos += 2
        return dict
      }
      const key = this.readName()
      const token = this.next()
      if (token.type !== 'object') {
        throw new Error(`PDF import error: dictionary value expected at byte ${this.pos}`)
      }
      dict.set(key.name, token.value)
    }
  }

  private readName(): PdfName {
    this.pos++
    let name = ''
    while (this.pos < this.data.length) {
      const b = this.data[this.pos]!
      if (!isRegular(b)) break
      if (b === 0x23) {
        const h1 = hexDigit(this.data[this.pos + 1] ?? -1)
        const h2 = hexDigit(this.data[this.pos + 2] ?? -1)
        if (h1 < 0 || h2 < 0) {
          throw new Error(`PDF import error: invalid name escape at byte ${this.pos}`)
        }
        const decoded = h1 * 16 + h2
        if (decoded === 0) throw new Error(`PDF import error: a content name must not contain null at byte ${this.pos}`)
        name += String.fromCharCode(decoded)
        this.pos += 3
      } else {
        name += String.fromCharCode(b)
        this.pos++
      }
    }
    return new PdfName(name)
  }

  private readLiteralString(): PdfString {
    this.pos++
    const out: number[] = []
    let depth = 1
    while (this.pos < this.data.length) {
      const b = this.data[this.pos]!
      this.pos++
      if (b === 0x5C) {
        const e = this.data[this.pos]
        this.pos++
        if (e === 0x6E) out.push(0x0A)
        else if (e === 0x72) out.push(0x0D)
        else if (e === 0x74) out.push(0x09)
        else if (e === 0x62) out.push(0x08)
        else if (e === 0x66) out.push(0x0C)
        else if (e === 0x28 || e === 0x29 || e === 0x5C) out.push(e)
        else if (e === 0x0D) { if (this.data[this.pos] === 0x0A) this.pos++ }
        else if (e === 0x0A) {}
        else if (e !== undefined && e >= 0x30 && e <= 0x37) {
          // Octal escape \d, \dd, or \ddd (PDF 7.3.4.2)
          let code = e - 0x30
          for (let i = 0; i < 2; i++) {
            const d = this.data[this.pos]
            if (d === undefined || d < 0x30 || d > 0x37) break
            code = code * 8 + (d - 0x30)
            this.pos++
          }
          out.push(code & 0xFF)
        }
        else if (e !== undefined) out.push(e)
      } else if (b === 0x28) {
        depth++
        out.push(b)
      } else if (b === 0x29) {
        depth--
        if (depth === 0) return new PdfString(new Uint8Array(out))
        out.push(b)
      } else {
        out.push(b)
      }
    }
    throw new Error('PDF import error: unterminated literal string')
  }

  private readHexString(): PdfString {
    this.pos++
    const out: number[] = []
    let high = -1
    while (this.pos < this.data.length) {
      const b = this.data[this.pos]!
      this.pos++
      if (b === 0x3E) break
      if (isWhite(b)) continue
      const h = hexDigit(b)
      if (h < 0) throw new Error(`PDF import error: invalid hex string byte at ${this.pos - 1}`)
      if (high < 0) high = h
      else {
        out.push(high * 16 + h)
        high = -1
      }
    }
    if (high >= 0) out.push(high * 16)
    return new PdfString(new Uint8Array(out))
  }

  private readNumber(): number {
    const start = this.pos
    while (this.pos < this.data.length) {
      const b = this.data[this.pos]!
      if (!((b >= 0x30 && b <= 0x39) || b === 0x2B || b === 0x2D || b === 0x2E)) break
      this.pos++
    }
    return Number(ascii(this.data, start, this.pos))
  }

  private readWord(): string {
    const start = this.pos
    while (this.pos < this.data.length && isRegular(this.data[this.pos]!)) this.pos++
    return ascii(this.data, start, this.pos)
  }

  private skipSpace(): void {
    while (this.pos < this.data.length) {
      const b = this.data[this.pos]!
      if (isWhite(b)) this.pos++
      else if (b === 0x25) {
        this.pos++
        while (this.pos < this.data.length && this.data[this.pos] !== 0x0A && this.data[this.pos] !== 0x0D) this.pos++
      } else break
    }
  }
}

function indexOfInlineImageEnd(data: Uint8Array, start: number): number {
  for (let i = start; i + 1 < data.length; i++) {
    if (data[i] === 0x45 && data[i + 1] === 0x49) {
      const before = i === 0 ? 0x20 : data[i - 1]!
      const after = data[i + 2] ?? 0x20
      if (isWhite(before) && (isWhite(after) || after === 0x25)) return i
    }
  }
  return -1
}

function isWhite(b: number): boolean {
  return b === 0x20 || b === 0x0A || b === 0x0D || b === 0x09 || b === 0x0C || b === 0x00
}

function isDelimiter(b: number): boolean {
  return b === 0x28 || b === 0x29 || b === 0x3C || b === 0x3E || b === 0x5B || b === 0x5D
    || b === 0x7B || b === 0x7D || b === 0x2F || b === 0x25
}

function isRegular(b: number): boolean {
  return !isWhite(b) && !isDelimiter(b)
}

function isNumberStart(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || b === 0x2B || b === 0x2D || b === 0x2E
}

function hexDigit(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10
  return -1
}

function ascii(data: Uint8Array, start: number, end: number): string {
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(data[i]!)
  return s
}
