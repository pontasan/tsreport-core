/** ISO 32000-2 CMap parser and character-code execution model. */

export interface PdfDecodedCode {
  code: number
  length: number
  start: number
  end: number
}

interface CodeSpaceRange {
  start: number
  end: number
  length: number
}

interface CidRange extends CodeSpaceRange {
  cidStart: number
}

interface UnicodeRange extends CodeSpaceRange {
  destinationStart?: Uint8Array
  destinations?: Uint8Array[]
}

interface PdfCMapData {
  codeSpaces: CodeSpaceRange[]
  cidChars: Map<string, number>
  cidRanges: CidRange[]
  notdefChars: Map<string, number>
  notdefRanges: CidRange[]
  unicodeChars: Map<string, string>
  unicodeRanges: UnicodeRange[]
  identityCid: boolean
}

interface CMapToken {
  kind: 'number' | 'name' | 'word' | 'hex' | 'arrayStart' | 'arrayEnd'
  number?: number
  text?: string
  bytes?: Uint8Array
}

export class PdfCMap {
  readonly wMode: 0 | 1
  private readonly codeSpaces: CodeSpaceRange[]
  private readonly cidChars: Map<string, number>
  private readonly cidRanges: CidRange[]
  private readonly notdefChars: Map<string, number>
  private readonly notdefRanges: CidRange[]
  private readonly unicodeChars: Map<string, string>
  private readonly unicodeRanges: UnicodeRange[]
  private readonly identityCid: boolean

  constructor(options: {
    wMode?: 0 | 1
    codeSpaces?: CodeSpaceRange[]
    cidChars?: Map<string, number>
    cidRanges?: CidRange[]
    notdefChars?: Map<string, number>
    notdefRanges?: CidRange[]
    unicodeChars?: Map<string, string>
    unicodeRanges?: UnicodeRange[]
    identityCid?: boolean
  } = {}) {
    this.wMode = options.wMode ?? 0
    this.codeSpaces = options.codeSpaces ?? []
    this.cidChars = options.cidChars ?? new Map()
    this.cidRanges = options.cidRanges ?? []
    this.notdefChars = options.notdefChars ?? new Map()
    this.notdefRanges = options.notdefRanges ?? []
    this.unicodeChars = options.unicodeChars ?? new Map()
    this.unicodeRanges = options.unicodeRanges ?? []
    this.identityCid = options.identityCid === true
    validateCodeSpaces(this.codeSpaces)
  }

  decode(bytes: Uint8Array): PdfDecodedCode[] {
    const result: PdfDecodedCode[] = []
    let offset = 0
    while (offset < bytes.length) {
      let match: PdfDecodedCode | null = null
      for (let i = 0; i < this.codeSpaces.length; i++) {
        const range = this.codeSpaces[i]!
        if (offset + range.length > bytes.length) continue
        const code = readCode(bytes, offset, range.length)
        if (code < range.start || code > range.end) continue
        if (match !== null && match.length !== range.length) {
          throw new Error(`PDF CMap error: ambiguous code-space match at byte ${offset}`)
        }
        match = { code, length: range.length, start: offset, end: offset + range.length }
      }
      if (match === null) throw new Error(`PDF CMap error: byte sequence at offset ${offset} is outside every code-space range`)
      result.push(match)
      offset = match.end
    }
    return result
  }

  cid(code: PdfDecodedCode): number {
    const key = codeKey(code.code, code.length)
    const direct = this.cidChars.get(key)
    if (direct !== undefined) return direct
    const range = findRange(this.cidRanges, code.code, code.length)
    if (range !== null) return range.cidStart + code.code - range.start
    const notdef = this.notdefChars.get(key)
    if (notdef !== undefined) return notdef
    const notdefRange = findRange(this.notdefRanges, code.code, code.length)
    if (notdefRange !== null) return notdefRange.cidStart
    return this.identityCid ? code.code : 0
  }

  unicode(code: PdfDecodedCode): string | null {
    const direct = this.unicodeChars.get(codeKey(code.code, code.length))
    if (direct !== undefined) return direct
    for (let i = this.unicodeRanges.length - 1; i >= 0; i--) {
      const range = this.unicodeRanges[i]!
      if (range.length !== code.length || code.code < range.start || code.code > range.end) continue
      const index = code.code - range.start
      if (range.destinations !== undefined) {
        const destination = range.destinations[index]
        return destination === undefined ? null : decodeUtf16Be(destination)
      }
      return decodeUtf16Be(addBigEndian(range.destinationStart!, index))
    }
    return null
  }

  /** Internal immutable snapshot used when applying UseCMap inheritance. */
  inheritanceData(): PdfCMapData {
    return {
      codeSpaces: [...this.codeSpaces], cidChars: new Map(this.cidChars), cidRanges: [...this.cidRanges],
      notdefChars: new Map(this.notdefChars), notdefRanges: [...this.notdefRanges],
      unicodeChars: new Map(this.unicodeChars), unicodeRanges: [...this.unicodeRanges], identityCid: this.identityCid,
    }
  }
}

export function identityPdfCMap(vertical: boolean): PdfCMap {
  return new PdfCMap({
    wMode: vertical ? 1 : 0,
    codeSpaces: [{ start: 0, end: 0xFFFF, length: 2 }],
    identityCid: true,
  })
}

export function parsePdfCMap(
  data: Uint8Array,
  parent: PdfCMap | null = null,
  resolveNamedCMap?: (name: string) => PdfCMap,
): PdfCMap {
  const tokens = tokenize(data)
  let effectiveParent = parent
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i]!.kind !== 'word' || tokens[i]!.text !== 'usecmap') continue
    const name = tokens[i - 1]
    if (name?.kind !== 'name') throw new Error('PDF CMap error: usecmap requires a CMap name')
    if (resolveNamedCMap === undefined) throw new Error(`PDF CMap error: no resolver for usecmap /${name.text}`)
    if (effectiveParent !== null) throw new Error('PDF CMap error: multiple base CMaps are not permitted')
    effectiveParent = resolveNamedCMap(name.text!)
  }
  const codeSpaces: CodeSpaceRange[] = []
  const cidChars = new Map<string, number>()
  const cidRanges: CidRange[] = []
  const notdefChars = new Map<string, number>()
  const notdefRanges: CidRange[] = []
  const unicodeChars = new Map<string, string>()
  const unicodeRanges: UnicodeRange[] = []
  let wMode: 0 | 1 = effectiveParent?.wMode ?? 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.kind === 'name' && token.text === 'WMode') {
      const value = tokens[i + 1]
      if (value?.kind !== 'number' || (value.number !== 0 && value.number !== 1)) {
        throw new Error('PDF CMap error: WMode must be 0 or 1')
      }
      wMode = value.number
      continue
    }
    if (token.kind !== 'word') continue
    if (token.text === 'begincodespacerange') {
      const count = blockCount(tokens, i)
      i = parseCodeSpaceBlock(tokens, i + 1, count, codeSpaces)
    } else if (token.text === 'beginbfchar') {
      const count = blockCount(tokens, i)
      i = parseBfCharBlock(tokens, i + 1, count, unicodeChars)
    } else if (token.text === 'beginbfrange') {
      const count = blockCount(tokens, i)
      i = parseBfRangeBlock(tokens, i + 1, count, unicodeRanges)
    } else if (token.text === 'begincidchar') {
      const count = blockCount(tokens, i)
      i = parseCidCharBlock(tokens, i + 1, count, cidChars, 'endcidchar')
    } else if (token.text === 'begincidrange') {
      const count = blockCount(tokens, i)
      i = parseCidRangeBlock(tokens, i + 1, count, cidRanges, 'endcidrange')
    } else if (token.text === 'beginnotdefchar') {
      const count = blockCount(tokens, i)
      i = parseCidCharBlock(tokens, i + 1, count, notdefChars, 'endnotdefchar')
    } else if (token.text === 'beginnotdefrange') {
      const count = blockCount(tokens, i)
      i = parseCidRangeBlock(tokens, i + 1, count, notdefRanges, 'endnotdefrange')
    }
  }

  const inherited = effectiveParent === null ? null : effectiveParent.inheritanceData()
  const effectiveCodeSpaces = codeSpaces.length > 0 ? codeSpaces : inherited?.codeSpaces ?? []
  mergeMap(inherited?.cidChars, cidChars)
  mergeMap(inherited?.notdefChars, notdefChars)
  mergeMap(inherited?.unicodeChars, unicodeChars)
  const result = new PdfCMap({
    wMode,
    codeSpaces: effectiveCodeSpaces,
    cidChars,
    cidRanges: [...(inherited?.cidRanges ?? []), ...cidRanges],
    notdefChars,
    notdefRanges: [...(inherited?.notdefRanges ?? []), ...notdefRanges],
    unicodeChars,
    unicodeRanges: [...(inherited?.unicodeRanges ?? []), ...unicodeRanges],
    identityCid: inherited?.identityCid,
  })
  validateMappedSources(result, effectiveCodeSpaces, cidChars, cidRanges, notdefChars, notdefRanges, unicodeChars, unicodeRanges)
  return result
}

function mergeMap<K, V>(parent: Map<K, V> | undefined, child: Map<K, V>): void {
  if (parent === undefined) return
  const entries = [...child]
  child.clear()
  for (const [key, value] of parent) child.set(key, value)
  for (const [key, value] of entries) child.set(key, value)
}

function tokenize(data: Uint8Array): CMapToken[] {
  const tokens: CMapToken[] = []
  let i = 0
  while (i < data.length) {
    const byte = data[i]!
    if (isWhite(byte)) { i++; continue }
    if (byte === 0x25) {
      while (i < data.length && data[i] !== 0x0A && data[i] !== 0x0D) i++
      continue
    }
    if (byte === 0x5B) { tokens.push({ kind: 'arrayStart' }); i++; continue }
    if (byte === 0x5D) { tokens.push({ kind: 'arrayEnd' }); i++; continue }
    if (byte === 0x3C && data[i + 1] !== 0x3C) {
      const start = ++i
      while (i < data.length && data[i] !== 0x3E) i++
      if (i >= data.length) throw new Error('PDF CMap error: unterminated hexadecimal string')
      tokens.push({ kind: 'hex', bytes: decodeHex(data.subarray(start, i)) })
      i++
      continue
    }
    if (byte === 0x2F) {
      const start = ++i
      while (i < data.length && !isDelimiter(data[i]!)) i++
      tokens.push({ kind: 'name', text: ascii(data, start, i) })
      continue
    }
    if (isNumberStart(byte)) {
      const start = i++
      while (i < data.length && !isDelimiter(data[i]!)) i++
      const value = Number(ascii(data, start, i))
      if (!Number.isFinite(value)) throw new Error('PDF CMap error: invalid number')
      tokens.push({ kind: 'number', number: value })
      continue
    }
    if (byte === 0x3C && data[i + 1] === 0x3C) { i += 2; continue }
    if (byte === 0x3E && data[i + 1] === 0x3E) { i += 2; continue }
    if (byte === 0x7B || byte === 0x7D) { i++; continue }
    const start = i++
    while (i < data.length && !isDelimiter(data[i]!)) i++
    tokens.push({ kind: 'word', text: ascii(data, start, i) })
  }
  return tokens
}

function blockCount(tokens: CMapToken[], beginIndex: number): number {
  const token = tokens[beginIndex - 1]
  if (token?.kind !== 'number' || !Number.isInteger(token.number) || token.number! < 0) {
    throw new Error(`PDF CMap error: ${tokens[beginIndex]!.text} requires a non-negative entry count`)
  }
  return token.number!
}

function parseCodeSpaceBlock(tokens: CMapToken[], index: number, count: number, out: CodeSpaceRange[]): number {
  for (let n = 0; n < count; n++) {
    const start = hexToken(tokens[index++], 'codespace start')
    const end = hexToken(tokens[index++], 'codespace end')
    const length = sourceLength(start, end)
    const a = bytesToCode(start), b = bytesToCode(end)
    if (a > b) throw new Error('PDF CMap error: reversed code-space range')
    out.push({ start: a, end: b, length })
  }
  return expectEnd(tokens, index, 'endcodespacerange')
}

function parseBfCharBlock(tokens: CMapToken[], index: number, count: number, out: Map<string, string>): number {
  for (let n = 0; n < count; n++) {
    const source = sourceHex(tokens[index++], 'bfchar source')
    const destination = hexToken(tokens[index++], 'bfchar destination')
    out.set(codeKey(bytesToCode(source), source.length), decodeUtf16Be(destination))
  }
  return expectEnd(tokens, index, 'endbfchar')
}

function parseBfRangeBlock(tokens: CMapToken[], index: number, count: number, out: UnicodeRange[]): number {
  for (let n = 0; n < count; n++) {
    const startBytes = sourceHex(tokens[index++], 'bfrange start')
    const endBytes = sourceHex(tokens[index++], 'bfrange end')
    const length = sourceLength(startBytes, endBytes)
    const start = bytesToCode(startBytes), end = bytesToCode(endBytes)
    if (start > end) throw new Error('PDF CMap error: reversed bfrange')
    const destination = tokens[index++]
    if (destination?.kind === 'hex') {
      decodeUtf16Be(destination.bytes!)
      out.push({ start, end, length, destinationStart: destination.bytes! })
    } else if (destination?.kind === 'arrayStart') {
      const values: Uint8Array[] = []
      while (tokens[index]?.kind !== 'arrayEnd') {
        const value = hexToken(tokens[index++], 'bfrange array destination')
        decodeUtf16Be(value)
        values.push(value)
      }
      index++
      if (values.length !== end - start + 1) throw new Error('PDF CMap error: bfrange destination array length mismatch')
      out.push({ start, end, length, destinations: values })
    } else {
      throw new Error('PDF CMap error: bfrange destination must be a hex string or array')
    }
  }
  return expectEnd(tokens, index, 'endbfrange')
}

function parseCidCharBlock(tokens: CMapToken[], index: number, count: number, out: Map<string, number>, endWord: string): number {
  for (let n = 0; n < count; n++) {
    const source = sourceHex(tokens[index++], `${endWord} source`)
    const cid = cidToken(tokens[index++])
    out.set(codeKey(bytesToCode(source), source.length), cid)
  }
  return expectEnd(tokens, index, endWord)
}

function parseCidRangeBlock(tokens: CMapToken[], index: number, count: number, out: CidRange[], endWord: string): number {
  for (let n = 0; n < count; n++) {
    const startBytes = sourceHex(tokens[index++], `${endWord} start`)
    const endBytes = sourceHex(tokens[index++], `${endWord} end`)
    const length = sourceLength(startBytes, endBytes)
    const start = bytesToCode(startBytes), end = bytesToCode(endBytes)
    if (start > end) throw new Error(`PDF CMap error: reversed ${endWord} range`)
    out.push({ start, end, length, cidStart: cidToken(tokens[index++]) })
  }
  return expectEnd(tokens, index, endWord)
}

function expectEnd(tokens: CMapToken[], index: number, word: string): number {
  const token = tokens[index]
  if (token?.kind !== 'word' || token.text !== word) throw new Error(`PDF CMap error: expected ${word}`)
  return index
}

function sourceHex(token: CMapToken | undefined, label: string): Uint8Array {
  const bytes = hexToken(token, label)
  if (bytes.length < 1 || bytes.length > 4) throw new Error(`PDF CMap error: ${label} must contain 1 to 4 bytes`)
  return bytes
}

function hexToken(token: CMapToken | undefined, label: string): Uint8Array {
  if (token?.kind !== 'hex') throw new Error(`PDF CMap error: ${label} must be a hexadecimal string`)
  return token.bytes!
}

function cidToken(token: CMapToken | undefined): number {
  if (token?.kind !== 'number' || !Number.isInteger(token.number) || token.number! < 0 || token.number! > 0xFFFFFFFF) {
    throw new Error('PDF CMap error: CID must be an unsigned integer')
  }
  return token.number!
}

function sourceLength(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error('PDF CMap error: source range endpoints must have equal length')
  if (a.length < 1 || a.length > 4) throw new Error('PDF CMap error: source codes must contain 1 to 4 bytes')
  return a.length
}

function validateCodeSpaces(ranges: CodeSpaceRange[]): void {
  if (ranges.length === 0) throw new Error('PDF CMap error: at least one code-space range is required')
  for (let i = 0; i < ranges.length; i++) {
    const a = ranges[i]!
    for (let j = i + 1; j < ranges.length; j++) {
      const b = ranges[j]!
      if (a.length === b.length && a.start <= b.end && b.start <= a.end) {
        throw new Error('PDF CMap error: overlapping code-space ranges')
      }
    }
  }
}

function validateMappedSources(
  _cmap: PdfCMap,
  spaces: CodeSpaceRange[],
  ...collections: Array<Map<string, unknown> | Array<CodeSpaceRange>>
): void {
  for (const collection of collections) {
    if (collection instanceof Map) {
      for (const key of collection.keys()) {
        const [lengthText, codeText] = key.split(':')
        assertInCodeSpace(Number(codeText), Number(lengthText), spaces)
      }
    } else {
      for (const range of collection) {
        assertInCodeSpace(range.start, range.length, spaces)
        assertInCodeSpace(range.end, range.length, spaces)
      }
    }
  }
}

function assertInCodeSpace(code: number, length: number, spaces: CodeSpaceRange[]): void {
  for (let i = 0; i < spaces.length; i++) {
    const range = spaces[i]!
    if (range.length === length && code >= range.start && code <= range.end) return
  }
  throw new Error('PDF CMap error: mapping source is outside every code-space range')
}

function findRange<T extends CodeSpaceRange>(ranges: T[], code: number, length: number): T | null {
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i]!
    if (range.length === length && code >= range.start && code <= range.end) return range
  }
  return null
}

function codeKey(code: number, length: number): string {
  return `${length}:${code}`
}

function readCode(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + bytes[offset + i]!
  return value
}

function bytesToCode(bytes: Uint8Array): number {
  return readCode(bytes, 0, bytes.length)
}

function addBigEndian(bytes: Uint8Array, increment: number): Uint8Array {
  const result = bytes.slice()
  let carry = increment
  for (let i = result.length - 1; i >= 0 && carry > 0; i--) {
    const sum = result[i]! + (carry & 0xFF)
    result[i] = sum & 0xFF
    carry = Math.floor(carry / 256) + (sum > 0xFF ? 1 : 0)
  }
  if (carry !== 0) throw new Error('PDF CMap error: bfrange destination overflow')
  return result
}

function decodeUtf16Be(bytes: Uint8Array): string {
  if (bytes.length === 0 || (bytes.length & 1) !== 0) throw new Error('PDF CMap error: Unicode destination must contain complete UTF-16BE code units')
  let result = ''
  for (let i = 0; i < bytes.length; i += 2) result += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!)
  return result
}

function decodeHex(data: Uint8Array): Uint8Array {
  const digits: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (isWhite(data[i]!)) continue
    const value = hexValue(data[i]!)
    if (value < 0) throw new Error('PDF CMap error: invalid hexadecimal digit')
    digits.push(value)
  }
  if ((digits.length & 1) !== 0) digits.push(0)
  const result = new Uint8Array(digits.length / 2)
  for (let i = 0; i < result.length; i++) result[i] = (digits[i * 2]! << 4) | digits[i * 2 + 1]!
  return result
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10
  return -1
}

function ascii(data: Uint8Array, start: number, end: number): string {
  let result = ''
  for (let i = start; i < end; i++) result += String.fromCharCode(data[i]!)
  return result
}

function isWhite(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32
}

function isDelimiter(byte: number): boolean {
  return isWhite(byte) || byte === 0x28 || byte === 0x29 || byte === 0x3C || byte === 0x3E
    || byte === 0x5B || byte === 0x5D || byte === 0x7B || byte === 0x7D || byte === 0x2F || byte === 0x25
}

function isNumberStart(byte: number): boolean {
  return byte === 0x2B || byte === 0x2D || byte === 0x2E || (byte >= 0x30 && byte <= 0x39)
}
