/**
 * JBIG2 (ITU-T T.88) decoder for the PDF /JBIG2Decode filter.
 *
 * Scope: the arithmetic-coded profile PDF producers emit — embedded segment
 * streams (optionally with a JBIG2Globals stream), generic regions
 * (templates 0-3, TPGDON), symbol dictionaries and text regions
 * (arithmetic), refinement regions (templates 0-1), page composition,
 * MMR-coded generic regions (T.6 two-dimensional coding), and pattern
 * dictionaries with halftone regions (both arithmetic and MMR grayscale).
 * Huffman-coded symbol dictionaries and text regions are also supported.
 */

import { newMqContext, type MqContext } from './mq-decoder.js'
import { Jbig2ArithmeticDecoder } from './jbig2-arithmetic-decoder.js'
import { decodeCcittGroup4, decodeCcittGroup4Plane, CcittBitReader } from './ccitt.js'

export interface Jbig2Image {
  pageAssociation: number
  width: number
  height: number
  /** 1 byte per pixel: 1 = black */
  pixels: Uint8Array
  profiles: readonly number[]
  comments: readonly Jbig2Comment[]
}

export interface Jbig2Comment {
  readonly pageAssociation: number
  readonly segmentNumber: number
  readonly values: Readonly<Record<string, string>>
}

// ─── Huffman coding (T.88 Annex B) ───

/** MSB-first bit reader over a byte range, with byte alignment (§B / §7.4.3). */
export class Jbig2Reader {
  position: number
  end: number
  private shift = -1
  private currentByte = 0
  constructor(private readonly data: Uint8Array, start: number, end: number) {
    this.position = start
    this.end = end
  }
  readBit(): number {
    if (this.shift < 0) {
      if (this.position >= this.end) throw new Error('JBIG2 error: end of data while reading a Huffman bit')
      this.currentByte = this.data[this.position++]!
      this.shift = 7
    }
    const bit = (this.currentByte >> this.shift) & 1
    this.shift--
    return bit
  }
  readBits(numBits: number): number {
    let result = 0
    for (let i = numBits - 1; i >= 0; i--) result |= this.readBit() << i
    return result
  }
  byteAlign(): void { this.shift = -1 }
  getData(): Uint8Array { return this.data }
}

/**
 * One line of a JBIG2 Huffman table (§B.1). A normal line covers
 * [rangeLow, rangeLow + 2^rangeLength) via `rangeLength` trailing bits; a
 * lower-range line subtracts the trailing value; an OOB line signals
 * out-of-band. `prefixCode` is filled by canonical assignment when absent.
 */
class HuffmanLine {
  readonly isOOB: boolean
  readonly rangeLow: number
  prefixLength: number
  readonly rangeLength: number
  prefixCode: number
  readonly isLowerRange: boolean
  constructor(lineData: number[] | [number, number]) {
    if (lineData.length === 2) {
      this.isOOB = true
      this.rangeLow = 0
      this.prefixLength = lineData[0]!
      this.rangeLength = 0
      this.prefixCode = lineData[1]!
      this.isLowerRange = false
    } else {
      this.isOOB = false
      this.rangeLow = lineData[0]!
      this.prefixLength = lineData[1]!
      this.rangeLength = lineData[2]!
      this.prefixCode = lineData[3]!
      this.isLowerRange = (lineData as unknown[])[4] === 'lower'
    }
  }
}

class HuffmanTreeNode {
  private readonly children: (HuffmanTreeNode | undefined)[] = []
  private readonly isLeaf: boolean
  private readonly rangeLength: number = 0
  private readonly rangeLow: number = 0
  private readonly isLowerRange: boolean = false
  private readonly isOOB: boolean = false
  constructor(line: HuffmanLine | null) {
    if (line) {
      this.isLeaf = true
      this.rangeLength = line.rangeLength
      this.rangeLow = line.rangeLow
      this.isLowerRange = line.isLowerRange
      this.isOOB = line.isOOB
    } else {
      this.isLeaf = false
    }
  }
  buildTree(line: HuffmanLine, shift: number): void {
    const bit = (line.prefixCode >> shift) & 1
    if (shift <= 0) {
      this.children[bit] = new HuffmanTreeNode(line)
    } else {
      let node = this.children[bit]
      if (!node) { node = new HuffmanTreeNode(null); this.children[bit] = node }
      node.buildTree(line, shift - 1)
    }
  }
  /** @returns the decoded value, or null for an OOB line. */
  decodeNode(reader: Jbig2Reader): number | null {
    if (this.isLeaf) {
      if (this.isOOB) return null
      const htOffset = reader.readBits(this.rangeLength)
      return this.rangeLow + (this.isLowerRange ? -htOffset : htOffset)
    }
    const node = this.children[reader.readBit()]
    if (!node) throw new Error('JBIG2 error: invalid Huffman data')
    return node.decodeNode(reader)
  }
}

export class HuffmanTable {
  private readonly rootNode: HuffmanTreeNode
  constructor(lines: HuffmanLine[], prefixCodesDone: boolean) {
    if (!prefixCodesDone) assignPrefixCodes(lines)
    this.rootNode = new HuffmanTreeNode(null)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.prefixLength > 0) this.rootNode.buildTree(line, line.prefixLength - 1)
    }
  }
  decode(reader: Jbig2Reader): number | null {
    return this.rootNode.decodeNode(reader)
  }
}

/** Canonical prefix-code assignment (§B.3). */
function assignPrefixCodes(lines: HuffmanLine[]): void {
  let prefixLengthMax = 0
  for (const line of lines) prefixLengthMax = Math.max(prefixLengthMax, line.prefixLength)
  const histogram = new Uint32Array(prefixLengthMax + 1)
  for (const line of lines) histogram[line.prefixLength]!++
  let currentLength = 1
  let firstCode = 0
  histogram[0] = 0
  while (currentLength <= prefixLengthMax) {
    firstCode = (firstCode + histogram[currentLength - 1]!) << 1
    let currentCode = firstCode
    for (const line of lines) {
      if (line.prefixLength === currentLength) { line.prefixCode = currentCode; currentCode++ }
    }
    currentLength++
  }
}

// Standard Huffman tables B.1-B.15 (§B.5). Each entry is a HuffmanLine tuple
// [rangeLow, prefixLength, rangeLength, prefixCode(, 'lower')] or an OOB pair
// [prefixLength, prefixCode]; prefix codes are pre-computed.
const STANDARD_TABLE_DATA: Record<number, Array<number[]>> = {
  1: [[0, 1, 4, 0x0], [16, 2, 8, 0x2], [272, 3, 16, 0x6], [65808, 3, 32, 0x7]],
  2: [[0, 1, 0, 0x0], [1, 2, 0, 0x2], [2, 3, 0, 0x6], [3, 4, 3, 0xe], [11, 5, 6, 0x1e], [75, 6, 32, 0x3e], [6, 0x3f]],
  3: [[-256, 8, 8, 0xfe], [0, 1, 0, 0x0], [1, 2, 0, 0x2], [2, 3, 0, 0x6], [3, 4, 3, 0xe], [11, 5, 6, 0x1e], [-257, 8, 32, 0xff, 'lower' as unknown as number], [75, 7, 32, 0x7e], [6, 0x3e]],
  4: [[1, 1, 0, 0x0], [2, 2, 0, 0x2], [3, 3, 0, 0x6], [4, 4, 3, 0xe], [12, 5, 6, 0x1e], [76, 5, 32, 0x1f]],
  5: [[-255, 7, 8, 0x7e], [1, 1, 0, 0x0], [2, 2, 0, 0x2], [3, 3, 0, 0x6], [4, 4, 3, 0xe], [12, 5, 6, 0x1e], [-256, 7, 32, 0x7f, 'lower' as unknown as number], [76, 6, 32, 0x3e]],
  6: [[-2048, 5, 10, 0x1c], [-1024, 4, 9, 0x8], [-512, 4, 8, 0x9], [-256, 4, 7, 0xa], [-128, 5, 6, 0x1d], [-64, 5, 5, 0x1e], [-32, 4, 5, 0xb], [0, 2, 7, 0x0], [128, 3, 7, 0x2], [256, 3, 8, 0x3], [512, 4, 9, 0xc], [1024, 4, 10, 0xd], [-2049, 6, 32, 0x3e, 'lower' as unknown as number], [2048, 6, 32, 0x3f]],
  7: [[-1024, 4, 9, 0x8], [-512, 3, 8, 0x0], [-256, 4, 7, 0x9], [-128, 5, 6, 0x1a], [-64, 5, 5, 0x1b], [-32, 4, 5, 0xa], [0, 4, 5, 0xb], [32, 5, 5, 0x1c], [64, 5, 6, 0x1d], [128, 4, 7, 0xc], [256, 3, 8, 0x1], [512, 3, 9, 0x2], [1024, 3, 10, 0x3], [-1025, 5, 32, 0x1e, 'lower' as unknown as number], [2048, 5, 32, 0x1f]],
  8: [[-15, 8, 3, 0xfc], [-7, 9, 1, 0x1fc], [-5, 8, 1, 0xfd], [-3, 9, 0, 0x1fd], [-2, 7, 0, 0x7c], [-1, 4, 0, 0xa], [0, 2, 1, 0x0], [2, 5, 0, 0x1a], [3, 6, 0, 0x3a], [4, 3, 4, 0x4], [20, 6, 1, 0x3b], [22, 4, 4, 0xb], [38, 4, 5, 0xc], [70, 5, 6, 0x1b], [134, 5, 7, 0x1c], [262, 6, 7, 0x3c], [390, 7, 8, 0x7d], [646, 6, 10, 0x3d], [-16, 9, 32, 0x1fe, 'lower' as unknown as number], [1670, 9, 32, 0x1ff], [2, 0x1]],
  9: [[-31, 8, 4, 0xfc], [-15, 9, 2, 0x1fc], [-11, 8, 2, 0xfd], [-7, 9, 1, 0x1fd], [-5, 7, 1, 0x7c], [-3, 4, 1, 0xa], [-1, 3, 1, 0x2], [1, 3, 1, 0x3], [3, 5, 1, 0x1a], [5, 6, 1, 0x3a], [7, 3, 5, 0x4], [39, 6, 2, 0x3b], [43, 4, 5, 0xb], [75, 4, 6, 0xc], [139, 5, 7, 0x1b], [267, 5, 8, 0x1c], [523, 6, 8, 0x3c], [779, 7, 9, 0x7d], [1291, 6, 11, 0x3d], [-32, 9, 32, 0x1fe, 'lower' as unknown as number], [3339, 9, 32, 0x1ff], [2, 0x0]],
  10: [[-21, 7, 4, 0x7a], [-5, 8, 0, 0xfc], [-4, 7, 0, 0x7b], [-3, 5, 0, 0x18], [-2, 2, 2, 0x0], [2, 5, 0, 0x19], [3, 6, 0, 0x36], [4, 7, 0, 0x7c], [5, 8, 0, 0xfd], [6, 2, 6, 0x1], [70, 5, 5, 0x1a], [102, 6, 5, 0x37], [134, 6, 6, 0x38], [198, 6, 7, 0x39], [326, 6, 8, 0x3a], [582, 6, 9, 0x3b], [1094, 6, 10, 0x3c], [2118, 7, 11, 0x7d], [-22, 8, 32, 0xfe, 'lower' as unknown as number], [4166, 8, 32, 0xff], [2, 0x2]],
  11: [[1, 1, 0, 0x0], [2, 2, 1, 0x2], [4, 4, 0, 0xc], [5, 4, 1, 0xd], [7, 5, 1, 0x1c], [9, 5, 2, 0x1d], [13, 6, 2, 0x3c], [17, 7, 2, 0x7a], [21, 7, 3, 0x7b], [29, 7, 4, 0x7c], [45, 7, 5, 0x7d], [77, 7, 6, 0x7e], [141, 7, 32, 0x7f]],
  12: [[1, 1, 0, 0x0], [2, 2, 0, 0x2], [3, 3, 1, 0x6], [5, 5, 0, 0x1c], [6, 5, 1, 0x1d], [8, 6, 1, 0x3c], [10, 7, 0, 0x7a], [11, 7, 1, 0x7b], [13, 7, 2, 0x7c], [17, 7, 3, 0x7d], [25, 7, 4, 0x7e], [41, 8, 5, 0xfe], [73, 8, 32, 0xff]],
  13: [[1, 1, 0, 0x0], [2, 3, 0, 0x4], [3, 4, 0, 0xc], [4, 5, 0, 0x1c], [5, 4, 1, 0xd], [7, 3, 3, 0x5], [15, 6, 1, 0x3a], [17, 6, 2, 0x3b], [21, 6, 3, 0x3c], [29, 6, 4, 0x3d], [45, 6, 5, 0x3e], [77, 7, 6, 0x7e], [141, 7, 32, 0x7f]],
  14: [[-2, 3, 0, 0x4], [-1, 3, 0, 0x5], [0, 1, 0, 0x0], [1, 3, 0, 0x6], [2, 3, 0, 0x7]],
  15: [[-24, 7, 4, 0x7c], [-8, 6, 2, 0x3c], [-4, 5, 1, 0x1c], [-2, 4, 0, 0xc], [-1, 3, 0, 0x4], [0, 1, 0, 0x0], [1, 3, 0, 0x5], [2, 4, 0, 0xd], [3, 5, 1, 0x1d], [5, 6, 2, 0x3d], [9, 7, 4, 0x7d], [-25, 7, 32, 0x7e, 'lower' as unknown as number], [25, 7, 32, 0x7f]],
}

const standardTablesCache = new Map<number, HuffmanTable>()

/** Standard Huffman table B.`number` (§B.5). */
export function getStandardTable(num: number): HuffmanTable {
  const cached = standardTablesCache.get(num)
  if (cached) return cached
  const data = STANDARD_TABLE_DATA[num]
  if (!data) throw new Error(`JBIG2 error: standard table B.${num} does not exist`)
  const lines = data.map(d => new HuffmanLine(d as number[]))
  const table = new HuffmanTable(lines, true)
  standardTablesCache.set(num, table)
  return table
}

/** Decode a custom Huffman table (code table segment, type 53, §B.2 / §7.4.13). */
export function decodeTablesSegment(data: Uint8Array, start: number, end: number): HuffmanTable {
  const flags = data[start]!
  const lowestValue = readU32be(data, start + 1) | 0
  const highestValue = readU32be(data, start + 5) | 0
  const reader = new Jbig2Reader(data, start + 9, end)
  const prefixSizeBits = ((flags >> 1) & 7) + 1
  const rangeSizeBits = ((flags >> 4) & 7) + 1
  const lines: HuffmanLine[] = []
  let currentRangeLow = lowestValue
  do {
    const prefixLength = reader.readBits(prefixSizeBits)
    const rangeLength = reader.readBits(rangeSizeBits)
    lines.push(new HuffmanLine([currentRangeLow, prefixLength, rangeLength, 0]))
    currentRangeLow += 1 << rangeLength
  } while (currentRangeLow < highestValue)
  lines.push(new HuffmanLine([lowestValue - 1, reader.readBits(prefixSizeBits), 32, 0, 'lower' as unknown as number]))
  lines.push(new HuffmanLine([highestValue, reader.readBits(prefixSizeBits), 32, 0]))
  if (flags & 1) lines.push(new HuffmanLine([reader.readBits(prefixSizeBits), 0]))
  return new HuffmanTable(lines, false)
}

// ─── Arithmetic integer decoding (T.88 Annex A) ───

class ArithIntContext {
  contexts: MqContext[] = []
  constructor() {
    for (let i = 0; i < 512; i++) this.contexts.push(newMqContext())
  }
}

/** Decode one integer (A.2). Returns null for OOB. */
function decodeInt(mq: Jbig2ArithmeticDecoder, cx: ArithIntContext): number | null {
  let prev = 1
  const bit = (): number => {
    const b = mq.decode(cx.contexts[prev]!)
    prev = prev < 256 ? (prev << 1) | b : ((((prev << 1) | b) & 511) | 256)
    return b
  }
  const s = bit()
  let v: number
  if (bit() === 0) {
    v = readBitsInt(2)
  } else if (bit() === 0) {
    v = readBitsInt(4) + 4
  } else if (bit() === 0) {
    v = readBitsInt(6) + 20
  } else if (bit() === 0) {
    v = readBitsInt(8) + 84
  } else if (bit() === 0) {
    v = readBitsInt(12) + 340
  } else {
    v = readBitsInt(32) + 4436
  }
  function readBitsInt(n: number): number {
    let value = 0
    for (let i = 0; i < n; i++) value = (value << 1) | bit()
    return value
  }
  if (s === 1 && v === 0) return null // OOB
  return s === 1 ? -v : v
}

/** Decode a symbol ID (A.3). */
function decodeIaid(mq: Jbig2ArithmeticDecoder, contexts: MqContext[], codeLength: number): number {
  let prev = 1
  for (let i = 0; i < codeLength; i++) {
    prev = (prev << 1) | mq.decode(contexts[prev]!)
  }
  return prev - (1 << codeLength)
}

// ─── Bitmaps ───

class Bitmap {
  width: number
  height: number
  data: Uint8Array
  fill: number
  constructor(width: number, height: number, fill = 0) {
    this.width = width
    this.height = height
    this.fill = fill
    this.data = new Uint8Array(width * height)
    if (fill) this.data.fill(1)
  }
  get(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0
    return this.data[y * this.width + x]!
  }
  set(x: number, y: number, v: number): void {
    this.data[y * this.width + x] = v
  }
  /** Grow the bitmap to at least `height` rows, filling new rows with the
   *  page default pixel value (used for striped pages of unknown height). */
  ensureHeight(height: number): void {
    if (height <= this.height) return
    const grown = new Uint8Array(this.width * height)
    if (this.fill) grown.fill(1)
    grown.set(this.data)
    this.data = grown
    this.height = height
  }
}

/**
 * Decode an MMR (T.6) coded region into a JBIG2 bitmap. JBIG2 MMR coding is
 * exactly CCITT Group 4 two-dimensional coding with foreground pixels as 1
 * (T.88 §6.2.6), so the shared T.6 decoder produces the packed rows, which are
 * unpacked into the one-byte-per-pixel bitmap.
 */
function decodeMmrBitmap(data: Uint8Array, start: number, end: number, width: number, height: number): Bitmap {
  const packed = decodeCcittGroup4(data.subarray(start, end), width, height, true)
  const bitmap = new Bitmap(width, height)
  const rowBytes = Math.ceil(width / 8)
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes
    for (let x = 0; x < width; x++) {
      const byte = packed[rowStart + (x >> 3)] ?? 0
      bitmap.set(x, y, (byte >> (7 - (x & 7))) & 1)
    }
  }
  return bitmap
}

// ─── Generic region decoding (6.2) ───

interface GenericParams {
  template: number
  tpgdon: boolean
  at: { x: number, y: number }[]
}

function decodeGenericRegion(
  mq: Jbig2ArithmeticDecoder, cx: MqContext[], width: number, height: number, params: GenericParams,
  skip: Bitmap | null = null,
): Bitmap {
  const bitmap = new Bitmap(width, height)
  const at = params.at
  let ltp = 0
  for (let y = 0; y < height; y++) {
    if (params.tpgdon) {
      // Typical prediction: context per template (6.2.5.7)
      const tpCx = params.template === 0 ? 0x9B25
        : params.template === 1 ? 0x0795
        : params.template === 2 ? 0x00E5
        : 0x0195
      if (mq.decode(cx[tpCx]!) === 1) ltp ^= 1
      if (ltp === 1) {
        // Copy the row above
        if (y > 0) bitmap.data.copyWithin(y * width, (y - 1) * width, y * width)
        continue
      }
    }
    for (let x = 0; x < width; x++) {
      if (skip !== null && skip.get(x, y) === 1) {
        bitmap.set(x, y, 0)
        continue
      }
      let context: number
      if (params.template === 0) {
        context =
          (bitmap.get(x - 1, y) << 0) | (bitmap.get(x - 2, y) << 1) | (bitmap.get(x - 3, y) << 2) | (bitmap.get(x - 4, y) << 3) |
          (bitmap.get(x + at[0]!.x, y + at[0]!.y) << 4) |
          (bitmap.get(x + 2, y - 1) << 5) | (bitmap.get(x + 1, y - 1) << 6) | (bitmap.get(x, y - 1) << 7) |
          (bitmap.get(x - 1, y - 1) << 8) | (bitmap.get(x - 2, y - 1) << 9) |
          (bitmap.get(x + at[1]!.x, y + at[1]!.y) << 10) |
          (bitmap.get(x + at[2]!.x, y + at[2]!.y) << 11) |
          (bitmap.get(x + 1, y - 2) << 12) | (bitmap.get(x, y - 2) << 13) | (bitmap.get(x - 1, y - 2) << 14) |
          (bitmap.get(x + at[3]!.x, y + at[3]!.y) << 15)
      } else if (params.template === 1) {
        context =
          (bitmap.get(x - 1, y) << 0) | (bitmap.get(x - 2, y) << 1) | (bitmap.get(x - 3, y) << 2) |
          (bitmap.get(x + at[0]!.x, y + at[0]!.y) << 3) |
          (bitmap.get(x + 2, y - 1) << 4) | (bitmap.get(x + 1, y - 1) << 5) | (bitmap.get(x, y - 1) << 6) |
          (bitmap.get(x - 1, y - 1) << 7) | (bitmap.get(x - 2, y - 1) << 8) |
          (bitmap.get(x + 2, y - 2) << 9) | (bitmap.get(x + 1, y - 2) << 10) | (bitmap.get(x, y - 2) << 11) |
          (bitmap.get(x - 1, y - 2) << 12)
      } else if (params.template === 2) {
        context =
          (bitmap.get(x - 1, y) << 0) | (bitmap.get(x - 2, y) << 1) |
          (bitmap.get(x + at[0]!.x, y + at[0]!.y) << 2) |
          (bitmap.get(x + 1, y - 1) << 3) | (bitmap.get(x, y - 1) << 4) |
          (bitmap.get(x - 1, y - 1) << 5) | (bitmap.get(x - 2, y - 1) << 6) |
          (bitmap.get(x + 1, y - 2) << 7) | (bitmap.get(x, y - 2) << 8) | (bitmap.get(x - 1, y - 2) << 9)
      } else {
        context =
          (bitmap.get(x - 1, y) << 0) | (bitmap.get(x - 2, y) << 1) | (bitmap.get(x - 3, y) << 2) | (bitmap.get(x - 4, y) << 3) |
          (bitmap.get(x + at[0]!.x, y + at[0]!.y) << 4) |
          (bitmap.get(x + 1, y - 1) << 5) | (bitmap.get(x, y - 1) << 6) | (bitmap.get(x - 1, y - 1) << 7) |
          (bitmap.get(x - 2, y - 1) << 8) | (bitmap.get(x - 3, y - 1) << 9)
      }
      bitmap.set(x, y, mq.decode(cx[context]!))
    }
  }
  return bitmap
}

// ─── Pattern dictionary (6.7) & halftone region (6.6) ───

/** Extract a HDPW×HDPH sub-bitmap from a collective bitmap at column offset. */
function extractPattern(collective: Bitmap, colOffset: number, w: number, h: number): Bitmap {
  const pat = new Bitmap(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) pat.set(x, y, collective.get(colOffset + x, y))
  }
  return pat
}

/**
 * Decode a pattern dictionary segment (T.88 §6.7): a collective bitmap coded as
 * a generic region, sliced into (GRAYMAX+1) patterns of HDPW×HDPH.
 */
function decodePatternDictionary(data: Uint8Array, start: number, end: number): Bitmap[] {
  let p = start
  const flags = data[p]!; p += 1
  const hdmmr = (flags & 1) !== 0
  const hdtemplate = (flags >> 1) & 3
  const hdpw = data[p]!; p += 1
  const hdph = data[p]!; p += 1
  const grayMax = readU32be(data, p); p += 4
  const collWidth = (grayMax + 1) * hdpw
  let collective: Bitmap
  if (hdmmr) {
    collective = decodeMmrBitmap(data, p, end, collWidth, hdph)
  } else {
    // Fixed adaptive-template pixels for pattern dictionaries (§6.7.5).
    const at: { x: number, y: number }[] = [
      { x: -hdpw, y: 0 }, { x: -3, y: -1 }, { x: 2, y: -2 }, { x: -2, y: -2 },
    ]
    const mq = new Jbig2ArithmeticDecoder(data, p, end)
    const cx: MqContext[] = []
    for (let i = 0; i < 1 << 16; i++) cx.push(newMqContext())
    collective = decodeGenericRegion(mq, cx, collWidth, hdph, { template: hdtemplate, tpgdon: false, at })
  }
  const patterns: Bitmap[] = []
  for (let m = 0; m <= grayMax; m++) patterns.push(extractPattern(collective, m * hdpw, hdpw, hdph))
  return patterns
}

/** Unpack CCITT-packed rows (MSB-first, ceil(width/8) bytes per row) into a
 *  one-byte-per-pixel bitmap. */
function unpackMmrPlane(packed: Uint8Array, width: number, height: number): Bitmap {
  const bitmap = new Bitmap(width, height)
  const rowBytes = Math.ceil(width / 8)
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes
    for (let x = 0; x < width; x++) {
      const byte = packed[rowStart + (x >> 3)] ?? 0
      bitmap.set(x, y, (byte >> (7 - (x & 7))) & 1)
    }
  }
  return bitmap
}

/**
 * Decode the grayscale image of a halftone region (T.88 Annex C.5): `bpp`
 * bitplanes are decoded MSB-first from a shared arithmetic coder (or MMR) and
 * combined via Gray-code into a per-pixel value.
 */
function decodeGrayscaleImage(
  data: Uint8Array, start: number, end: number, gw: number, gh: number,
  bpp: number, template: number, skip: Bitmap | null, mmr: boolean,
): number[] {
  // Decode planes MSB (bpp-1) down to 0. Arithmetic uses one shared coder; MMR
  // uses one shared bit reader, each plane a T.6 block terminated by an EOFB.
  const planes: Bitmap[] = new Array(bpp)
  if (mmr) {
    const reader = new CcittBitReader(data.subarray(start, end))
    for (let j = bpp - 1; j >= 0; j--) {
      try {
        planes[j] = unpackMmrPlane(decodeCcittGroup4Plane(reader, gw, gh, true), gw, gh)
      } catch (error) {
        throw new Error(`JBIG2 error: invalid MMR grayscale bitplane ${j} at bit ${reader.position}: ${(error as Error).message}`)
      }
    }
  } else {
    const at: { x: number, y: number }[] = [
      { x: template <= 1 ? 3 : 2, y: -1 }, { x: -3, y: -1 }, { x: 2, y: -2 }, { x: -2, y: -2 },
    ]
    const mq = new Jbig2ArithmeticDecoder(data, start, end)
    const cx: MqContext[] = []
    for (let i = 0; i < 1 << 16; i++) cx.push(newMqContext())
    for (let j = bpp - 1; j >= 0; j--) {
      planes[j] = decodeGenericRegion(mq, cx, gw, gh, { template, tpgdon: false, at }, skip)
    }
  }
  // Gray-code decode (higher plane XORs into the next lower).
  for (let j = bpp - 2; j >= 0; j--) {
    const hi = planes[j + 1]!, lo = planes[j]!
    for (let i = 0; i < gw * gh; i++) lo.data[i] = lo.data[i]! ^ hi.data[i]!
  }
  const gray: number[] = new Array(gw * gh).fill(0)
  for (let j = 0; j < bpp; j++) {
    const plane = planes[j]!
    for (let i = 0; i < gw * gh; i++) gray[i] = gray[i]! | (plane.data[i]! << j)
  }
  return gray
}

/**
 * Decode a halftone region segment (T.88 §6.6) using its referenced pattern
 * dictionary: the grayscale image selects a pattern per grid cell, composited
 * onto the region bitmap at grid-vector positions.
 */
function decodeHalftoneRegion(
  data: Uint8Array, start: number, end: number, patterns: Bitmap[],
): { region: Bitmap, x: number, y: number, combOp: number } {
  const info = parseRegionInfo(data, start)
  let p = start + 17
  const flags = data[p]!; p += 1
  const hmmr = (flags & 1) !== 0
  const htemplate = (flags >> 1) & 3
  const henableskip = (flags & 8) !== 0
  const hcombop = (flags >> 4) & 7
  const hdefpixel = (flags >> 7) & 1
  const hgw = readU32be(data, p); p += 4
  const hgh = readU32be(data, p); p += 4
  const hgx = readU32be(data, p) | 0; p += 4
  const hgy = readU32be(data, p) | 0; p += 4
  const hrx = readU16be(data, p); p += 2
  const hry = readU16be(data, p); p += 2

  const region = new Bitmap(info.width, info.height, hdefpixel)

  // Skip bitmap (§6.6.5.1): grid cells whose pattern lands entirely outside the
  // region are not coded.
  const hpw = patterns[0]!.width
  const hph = patterns[0]!.height
  let skip: Bitmap | null = null
  if (henableskip) {
    skip = new Bitmap(hgw, hgh)
    for (let m = 0; m < hgh; m++) {
      for (let n = 0; n < hgw; n++) {
        const x = (hgx + m * hry + n * hrx) >> 8
        const y = (hgy + m * hrx - n * hry) >> 8
        if (x + hpw <= 0 || x >= info.width || y + hph <= 0 || y >= info.height) skip.set(n, m, 1)
      }
    }
  }

  const bpp = Math.max(1, Math.ceil(Math.log2(patterns.length)))
  const gray = decodeGrayscaleImage(data, p, end, hgw, hgh, bpp, htemplate, skip, hmmr)

  for (let m = 0; m < hgh; m++) {
    for (let n = 0; n < hgw; n++) {
      if (skip !== null && skip.get(n, m) === 1) continue
      const gi = Math.min(gray[m * hgw + n]!, patterns.length - 1)
      const pattern = patterns[gi]!
      const x = (hgx + m * hry + n * hrx) >> 8
      const y = (hgy + m * hrx - n * hry) >> 8
      compositeBitmap(region, pattern, x, y, hcombop)
    }
  }
  return { region, x: info.x, y: info.y, combOp: info.combOp }
}

/** Composite `src` onto `dst` at (x, y) with a JBIG2 combination operator. */
function compositeBitmap(dst: Bitmap, src: Bitmap, x: number, y: number, combOp: number): void {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy
    if (dy < 0 || dy >= dst.height) continue
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx
      if (dx < 0 || dx >= dst.width) continue
      const v = src.get(sx, sy)
      const e = dst.get(dx, dy)
      const c = combOp === 0 ? (e | v) : combOp === 1 ? (e & v)
        : combOp === 2 ? (e ^ v) : combOp === 3 ? 1 - (e ^ v) : v
      dst.set(dx, dy, c)
    }
  }
}

// ─── Refinement region decoding (6.3) ───

function decodeRefinement(
  mq: Jbig2ArithmeticDecoder, cx: MqContext[], width: number, height: number,
  template: number, reference: Bitmap, dx: number, dy: number,
  at: { x: number, y: number }[], tpgron: boolean,
): Bitmap {
  const bitmap = new Bitmap(width, height)
  const ref = (x: number, y: number): number => reference.get(x - dx, y - dy)
  let ltp = 0
  for (let y = 0; y < height; y++) {
    if (tpgron) {
      const tpCx = template === 0 ? 0x0100 : 0x0080
      if (mq.decode(cx[tpCx]!) === 1) ltp ^= 1
    }
    for (let x = 0; x < width; x++) {
      if (ltp === 1) {
        // Typical prediction: check the 3x3 reference neighborhood
        const sum = ref(x - 1, y - 1) + ref(x, y - 1) + ref(x + 1, y - 1)
          + ref(x - 1, y) + ref(x, y) + ref(x + 1, y)
          + ref(x - 1, y + 1) + ref(x, y + 1) + ref(x + 1, y + 1)
        if (sum === 0) { bitmap.set(x, y, 0); continue }
        if (sum === 9) { bitmap.set(x, y, 1); continue }
      }
      let context: number
      if (template === 0) {
        context =
          (bitmap.get(x - 1, y) << 0) |
          (bitmap.get(x + 1, y - 1) << 1) | (bitmap.get(x, y - 1) << 2) |
          (bitmap.get(x + at[0]!.x, y + at[0]!.y) << 3) |
          (ref(x + 1, y + 1) << 4) | (ref(x, y + 1) << 5) | (ref(x - 1, y + 1) << 6) |
          (ref(x + 1, y) << 7) | (ref(x, y) << 8) | (ref(x - 1, y) << 9) |
          (ref(x + 1, y - 1) << 10) | (ref(x, y - 1) << 11) |
          (ref(x + at[1]!.x, y + at[1]!.y) << 12)
      } else {
        context =
          (bitmap.get(x - 1, y) << 0) |
          (bitmap.get(x + 1, y - 1) << 1) | (bitmap.get(x, y - 1) << 2) | (bitmap.get(x - 1, y - 1) << 3) |
          (ref(x + 1, y + 1) << 4) | (ref(x, y + 1) << 5) |
          (ref(x + 1, y) << 6) | (ref(x, y) << 7) | (ref(x - 1, y) << 8) |
          (ref(x, y - 1) << 9)
      }
      bitmap.set(x, y, mq.decode(cx[context]!))
    }
  }
  return bitmap
}

// ─── Symbol dictionary (6.5) and text region (6.4) ───

interface SymbolDictParams {
  refinement: boolean
  template: number
  refTemplate: number
  at: { x: number, y: number }[]
  refAt: { x: number, y: number }[]
  exportedCount: number
  newCount: number
}

interface SymbolDictionaryContexts {
  readonly generic: MqContext[]
  readonly refinement: MqContext[]
  readonly template: number
  readonly refTemplate: number
  readonly huffman: boolean
  readonly refinementCoding: boolean
  readonly at: readonly { x: number, y: number }[]
  readonly refAt: readonly { x: number, y: number }[]
}

interface SymbolDictionaryResult {
  readonly symbols: Bitmap[]
  readonly contexts: SymbolDictionaryContexts
}

function createSymbolContexts(length: number, source: MqContext[] | null): MqContext[] {
  const contexts: MqContext[] = []
  for (let i = 0; i < length; i++) {
    const context = source === null ? null : source[i]!
    contexts.push(context === null ? newMqContext() : { index: context.index, mps: context.mps })
  }
  return contexts
}

function sameAtPixels(a: readonly { x: number, y: number }[], b: readonly { x: number, y: number }[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i]!.x !== b[i]!.x || a[i]!.y !== b[i]!.y) return false
  return true
}

function decodeSymbolDictionary(
  data: Uint8Array, start: number, end: number,
  params: SymbolDictParams, inputSymbols: Bitmap[], retained: SymbolDictionaryContexts | null,
): SymbolDictionaryResult {
  if (retained !== null && (retained.huffman || retained.refinementCoding !== params.refinement ||
    retained.template !== params.template || retained.refTemplate !== params.refTemplate ||
    !sameAtPixels(retained.at, params.at) || !sameAtPixels(retained.refAt, params.refAt))) {
    throw new Error('JBIG2 error: retained symbol dictionary contexts use incompatible coding parameters')
  }
  const cx = createSymbolContexts(1 << 16, retained?.generic ?? null)
  const rcx = createSymbolContexts(1 << 13, retained?.refinement ?? null)
  if (params.newCount === 0 && params.exportedCount === 0 && inputSymbols.length === 0) {
    if (start !== end) throw new Error('JBIG2 error: empty symbol dictionary has trailing arithmetic-coded data')
    return {
      symbols: [],
      contexts: {
        generic: cx, refinement: rcx, template: params.template, refTemplate: params.refTemplate,
        huffman: false, refinementCoding: params.refinement, at: params.at, refAt: params.refAt,
      },
    }
  }
  const mq = new Jbig2ArithmeticDecoder(data, start, end)
  const iadh = new ArithIntContext()
  const iadw = new ArithIntContext()
  const iaex = new ArithIntContext()
  const iaai = new ArithIntContext()
  const iardx = new ArithIntContext()
  const iardy = new ArithIntContext()
  const symbolCount = inputSymbols.length + params.newCount
  let codeLength = 0
  while ((1 << codeLength) < symbolCount) codeLength++
  const iaidCx: MqContext[] = []
  for (let i = 0; i < 1 << (codeLength + 1); i++) iaidCx.push(newMqContext())

  const newSymbols: Bitmap[] = []
  let hcHeight = 0
  while (newSymbols.length < params.newCount) {
    const dh = decodeInt(mq, iadh)
    if (dh === null) throw new Error('JBIG2 error: OOB in symbol height class')
    hcHeight += dh
    let symWidth = 0
    for (;;) {
      const dw = decodeInt(mq, iadw)
      if (dw === null) break // end of height class
      symWidth += dw
      if (newSymbols.length >= params.newCount) {
        throw new Error(`JBIG2 error: too many symbols (${newSymbols.length}/${params.newCount}, height ${hcHeight}, width ${symWidth})`)
      }
      if (!params.refinement) {
        newSymbols.push(decodeGenericRegion(mq, cx, symWidth, hcHeight, {
          template: params.template, tpgdon: false, at: params.at,
        }))
      } else {
        // Refinement/aggregate coding (6.5.8.2)
        const aggregate = decodeInt(mq, iaai)
        if (aggregate === null || aggregate < 1) throw new Error(`JBIG2 error: invalid aggregate symbol instance count ${aggregate}`)
        const all = [...inputSymbols, ...newSymbols]
        if (aggregate > 1) {
          newSymbols.push(decodeTextRegionArithmetic(mq, {
            width: symWidth, height: hcHeight, refinement: true,
            refTemplate: params.refTemplate, refAt: params.refAt,
            defaultPixel: 0, combOp: 0, transposed: false, refCorner: 1,
            dsOffset: 0, logStrips: 0, instanceCount: aggregate,
          }, all, iaidCx, codeLength))
          continue
        }
        const id = decodeIaid(mq, iaidCx, codeLength)
        const rdx = decodeInt(mq, iardx)
        const rdy = decodeInt(mq, iardy)
        if (rdx === null || rdy === null || id >= all.length) throw new Error('JBIG2 error: bad refinement reference')
        newSymbols.push(decodeRefinement(mq, rcx, symWidth, hcHeight,
          params.refTemplate, all[id]!, rdx, rdy, params.refAt, false))
      }
    }
  }

  // Export flags (6.5.10)
  const all = [...inputSymbols, ...newSymbols]
  const exported: Bitmap[] = []
  let exFlag = false
  let index = 0
  while (index < all.length && exported.length < params.exportedCount) {
    const runLength = decodeInt(mq, iaex)
    if (runLength === null) throw new Error('JBIG2 error: OOB in export run')
    if (exFlag) {
      for (let i = 0; i < runLength; i++) exported.push(all[index + i]!)
    }
    index += runLength
    exFlag = !exFlag
  }
  return {
    symbols: exported,
    contexts: {
      generic: cx, refinement: rcx, template: params.template, refTemplate: params.refTemplate,
      huffman: false, refinementCoding: params.refinement, at: params.at, refAt: params.refAt,
    },
  }
}

interface TextRegionParams {
  width: number
  height: number
  refinement: boolean
  refTemplate: number
  refAt: { x: number, y: number }[]
  defaultPixel: number
  combOp: number
  transposed: boolean
  refCorner: number
  dsOffset: number
  logStrips: number
  instanceCount: number
}

function decodeTextRegion(
  data: Uint8Array, start: number, end: number,
  params: TextRegionParams, symbols: Bitmap[],
): Bitmap {
  const mq = new Jbig2ArithmeticDecoder(data, start, end)
  return decodeTextRegionArithmetic(mq, params, symbols)
}

function decodeTextRegionArithmetic(
  mq: Jbig2ArithmeticDecoder, params: TextRegionParams, symbols: Bitmap[],
  sharedIaidCx: MqContext[] | null = null, sharedCodeLength: number | null = null,
): Bitmap {
  const iadt = new ArithIntContext()
  const iafs = new ArithIntContext()
  const iads = new ArithIntContext()
  const iait = new ArithIntContext()
  const iari = new ArithIntContext()
  const iardw = new ArithIntContext()
  const iardh = new ArithIntContext()
  const iardx = new ArithIntContext()
  const iardy = new ArithIntContext()
  let codeLength = sharedCodeLength ?? 0
  if (sharedCodeLength === null) {
    while ((1 << codeLength) < symbols.length) codeLength++
  }
  const iaidCx: MqContext[] = sharedIaidCx ?? []
  if (sharedIaidCx === null) {
    for (let i = 0; i < 1 << (codeLength + 1); i++) iaidCx.push(newMqContext())
  } else if (iaidCx.length < 1 << (codeLength + 1)) {
    throw new Error('JBIG2 error: shared symbol ID context is too small')
  }
  const rcx: MqContext[] = []
  if (params.refinement) for (let i = 0; i < 1 << 13; i++) rcx.push(newMqContext())

  const bitmap = new Bitmap(params.width, params.height, params.defaultPixel)
  const strips = 1 << params.logStrips

  let stript = decodeInt(mq, iadt)
  if (stript === null) throw new Error('JBIG2 error: OOB in STRIPT')
  stript = -stript * strips
  let firsts = 0
  let instances = 0
  while (instances < params.instanceCount) {
    const dt = decodeInt(mq, iadt)
    if (dt === null) throw new Error('JBIG2 error: OOB in DT')
    stript += dt * strips
    let curs = 0
    let first = true
    for (;;) {
      if (first) {
        const dfs = decodeInt(mq, iafs)
        if (dfs === null) throw new Error('JBIG2 error: OOB in DFS')
        firsts += dfs
        curs = firsts
        first = false
      } else {
        const ids = decodeInt(mq, iads)
        if (ids === null) break // end of strip
        curs += ids + params.dsOffset
      }
      if (instances >= params.instanceCount) {
        throw new Error('JBIG2 error: text region contains more symbol instances than declared')
      }
      const curt = strips === 1 ? 0 : (decodeInt(mq, iait) ?? 0)
      const tt = stript + curt
      const id = decodeIaid(mq, iaidCx, codeLength)
      if (id >= symbols.length) throw new Error('JBIG2 error: symbol id out of range')
      let symbol = symbols[id]!
      if (params.refinement) {
        const ri = decodeInt(mq, iari)
        if (ri !== null && ri !== 0) {
          const rdw = decodeInt(mq, iardw)
          const rdh = decodeInt(mq, iardh)
          const rdx = decodeInt(mq, iardx)
          const rdy = decodeInt(mq, iardy)
          if (rdw === null || rdh === null || rdx === null || rdy === null) {
            throw new Error('JBIG2 error: bad text refinement values')
          }
          const nw = symbol.width + rdw
          const nh = symbol.height + rdh
          symbol = decodeRefinement(mq, rcx, nw, nh, params.refTemplate, symbol,
            (rdw >> 1) + rdx, (rdh >> 1) + rdy, params.refAt, false)
        }
      }
      // Draw the symbol instance (6.4.5 step 3.c.x)
      drawSymbol(bitmap, symbol, curs, tt, params)
      curs += (params.transposed ? symbol.height : symbol.width) - 1
      instances++
    }
  }
  return bitmap
}

function drawSymbol(bitmap: Bitmap, symbol: Bitmap, s: number, t: number, params: TextRegionParams): void {
  let x0: number
  let y0: number
  if (!params.transposed) {
    // refCorner: 0=BL, 1=TL, 2=BR, 3=TR
    x0 = s
    y0 = params.refCorner === 1 || params.refCorner === 3 ? t : t - symbol.height + 1
  } else {
    y0 = s
    x0 = params.refCorner === 0 || params.refCorner === 1 ? t : t - symbol.width + 1
  }
  for (let y = 0; y < symbol.height; y++) {
    for (let x = 0; x < symbol.width; x++) {
      const v = symbol.get(x, y)
      const bx = x0 + x
      const by = y0 + y
      if (bx < 0 || bx >= bitmap.width || by < 0 || by >= bitmap.height) continue
      const existing = bitmap.get(bx, by)
      // Composition operator: 0 OR, 1 AND, 2 XOR, 3 XNOR
      const combined = params.combOp === 0 ? (existing | v)
        : params.combOp === 1 ? (existing & v)
        : params.combOp === 2 ? (existing ^ v)
        : 1 - (existing ^ v)
      bitmap.set(bx, by, combined)
    }
  }
}

// ─── Huffman-coded symbol dictionary & text region (6.5 / 6.4 SBHUFF) ───

/** The N-th custom Huffman table among a segment's referred-to code tables. */
function getCustomHuffmanTable(index: number, referred: number[], customTables: Map<number, HuffmanTable>): HuffmanTable {
  let currentIndex = 0
  for (const ref of referred) {
    const table = customTables.get(ref)
    if (table) {
      if (index === currentIndex) return table
      currentIndex++
    }
  }
  throw new Error('JBIG2 error: referenced custom Huffman table not found')
}

interface SymbolDictHuffmanTables {
  deltaHeight: HuffmanTable
  deltaWidth: HuffmanTable
  bitmapSize: HuffmanTable
  aggregateInstances: HuffmanTable
}

/** Select the symbol-dictionary Huffman tables from the flag selectors (§7.4.3.1.1). */
function getSymbolDictionaryHuffmanTables(flags: number, referred: number[], customTables: Map<number, HuffmanTable>): SymbolDictHuffmanTables {
  const dhSel = (flags >> 2) & 3
  const dwSel = (flags >> 4) & 3
  const bmSizeSel = (flags >> 6) & 1
  const aggSel = (flags >> 7) & 1
  let ci = 0
  const deltaHeight = dhSel === 3 ? getCustomHuffmanTable(ci++, referred, customTables) : getStandardTable(dhSel + 4)
  const deltaWidth = dwSel === 3 ? getCustomHuffmanTable(ci++, referred, customTables) : getStandardTable(dwSel + 2)
  const bitmapSize = bmSizeSel ? getCustomHuffmanTable(ci++, referred, customTables) : getStandardTable(1)
  const aggregateInstances = aggSel ? getCustomHuffmanTable(ci++, referred, customTables) : getStandardTable(1)
  return { deltaHeight, deltaWidth, bitmapSize, aggregateInstances }
}

/** Read an uncompressed (byte-aligned per row) bitmap from a Huffman stream. */
function readUncompressedBitmap(reader: Jbig2Reader, width: number, height: number): Bitmap {
  const bitmap = new Bitmap(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) bitmap.set(x, y, reader.readBit())
    reader.byteAlign()
  }
  return bitmap
}

/** Copy a sub-column [xMin, xMax) of a bitmap into a new symbol bitmap. */
function sliceColumns(src: Bitmap, xMin: number, width: number, height: number): Bitmap {
  const out = new Bitmap(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out.set(x, y, src.get(xMin + x, y))
  }
  return out
}

/**
 * Decode a Huffman-coded symbol dictionary (§6.5, SDHUFF=1): height classes
 * (deltaHeight), per-symbol widths (deltaWidth), then a byte-aligned collective
 * bitmap (uncompressed or MMR) sliced into the class's symbols.
 */
function decodeHuffmanSymbolDictionary(
  reader: Jbig2Reader, tables: SymbolDictHuffmanTables, exportRunTable: HuffmanTable,
  inputSymbols: Bitmap[], newCount: number, refinement: boolean,
  refTemplate: number, refAt: { x: number, y: number }[], retained: SymbolDictionaryContexts | null,
): SymbolDictionaryResult {
  if (retained !== null && (!retained.huffman || retained.refinementCoding !== refinement ||
    retained.template !== 0 || retained.refTemplate !== refTemplate || retained.at.length !== 0 ||
    !sameAtPixels(retained.refAt, refAt))) {
    throw new Error('JBIG2 error: retained Huffman symbol dictionary contexts use incompatible coding parameters')
  }
  const genericContexts = createSymbolContexts(1 << 16, retained?.generic ?? null)
  const refinementContexts = createSymbolContexts(1 << 13, retained?.refinement ?? null)
  const newSymbols: Bitmap[] = []
  const symbolWidths: number[] = []
  let codeLength = 0
  while ((1 << codeLength) < inputSymbols.length + newCount) codeLength++
  let currentHeight = 0
  while (newSymbols.length < newCount) {
    const dh = tables.deltaHeight.decode(reader)
    if (dh === null) throw new Error('JBIG2 error: OOB in Huffman symbol height class')
    currentHeight += dh
    let currentWidth = 0
    let totalWidth = 0
    const firstSymbol = symbolWidths.length
    for (;;) {
      const dw = tables.deltaWidth.decode(reader)
      if (dw === null) break // end of height class
      currentWidth += dw
      totalWidth += currentWidth
      if ((refinement ? newSymbols.length : symbolWidths.length) >= newCount) throw new Error('JBIG2 error: too many Huffman symbols')
      if (refinement) {
        const aggregate = tables.aggregateInstances.decode(reader)
        if (aggregate === null || aggregate < 1) throw new Error('JBIG2 error: invalid Huffman aggregate symbol instance count')
        const available = [...inputSymbols, ...newSymbols]
        if (aggregate === 1) {
          const id = reader.readBits(codeLength)
          const rdx = getStandardTable(15).decode(reader)
          const rdy = getStandardTable(15).decode(reader)
          const size = getStandardTable(1).decode(reader)
          if (id >= available.length || rdx === null || rdy === null || size === null || size < 0) {
            throw new Error('JBIG2 error: invalid Huffman singleton refinement values')
          }
          reader.byteAlign()
          const start = reader.position
          if (start + size > reader.end) throw new Error('JBIG2 error: Huffman symbol refinement data exceeds segment')
          const mq = new Jbig2ArithmeticDecoder(reader.getData(), start, start + size)
          newSymbols.push(decodeRefinement(mq, refinementContexts, currentWidth, currentHeight,
            refTemplate, available[id]!, rdx, rdy, refAt, false))
          reader.position = start + size
          reader.byteAlign()
        } else {
          const lines: HuffmanLine[] = []
          for (let i = 0; i < inputSymbols.length + newCount; i++) lines.push(new HuffmanLine([i, codeLength, 0, i]))
          const aggregateTables: TextRegionHuffmanTables = {
            symbolID: new HuffmanTable(lines, true),
            firstS: getStandardTable(6), deltaS: getStandardTable(8), deltaT: getStandardTable(11),
            refineDeltaWidth: getStandardTable(15), refineDeltaHeight: getStandardTable(15),
            refineX: getStandardTable(15), refineY: getStandardTable(15), refineSize: getStandardTable(1),
          }
          newSymbols.push(decodeHuffmanTextRegion(reader, {
            width: currentWidth, height: currentHeight, refinement: true,
            refTemplate, refAt, defaultPixel: 0, combOp: 0, transposed: false,
            refCorner: 1, dsOffset: 0, logStrips: 0, instanceCount: aggregate,
          }, aggregateTables, available, refinementContexts))
        }
      } else {
        symbolWidths.push(currentWidth)
      }
    }
    if (refinement) continue
    const bitmapSize = tables.bitmapSize.decode(reader)
    if (bitmapSize === null) throw new Error('JBIG2 error: OOB in Huffman bitmap size')
    reader.byteAlign()
    let collective: Bitmap
    if (bitmapSize === 0) {
      collective = readUncompressedBitmap(reader, totalWidth, currentHeight)
    } else {
      const start = reader.position
      collective = decodeMmrBitmap(reader.getData(), start, start + bitmapSize, totalWidth, currentHeight)
      reader.position = start + bitmapSize
      reader.byteAlign()
    }
    const classCount = symbolWidths.length
    if (firstSymbol === classCount - 1) {
      newSymbols.push(collective)
    } else {
      let xMin = 0
      for (let i = firstSymbol; i < classCount; i++) {
        const w = symbolWidths[i]!
        newSymbols.push(sliceColumns(collective, xMin, w, currentHeight))
        xMin += w
      }
    }
  }
  // Export flags: alternating runs (starting excluded) via the standard B.1 table.
  const total = inputSymbols.length + newCount
  const flags: boolean[] = []
  let currentFlag = false
  while (flags.length < total) {
    const runLength = exportRunTable.decode(reader)
    if (runLength === null) throw new Error('JBIG2 error: OOB in Huffman export run')
    for (let i = 0; i < runLength; i++) flags.push(currentFlag)
    currentFlag = !currentFlag
  }
  const all = [...inputSymbols, ...newSymbols]
  const exported: Bitmap[] = []
  for (let i = 0; i < all.length; i++) if (flags[i]) exported.push(all[i]!)
  return {
    symbols: exported,
    contexts: {
      generic: genericContexts, refinement: refinementContexts, template: 0, refTemplate,
      huffman: true, refinementCoding: refinement, at: [], refAt,
    },
  }
}

interface TextRegionHuffmanTables {
  symbolID: HuffmanTable
  firstS: HuffmanTable
  deltaS: HuffmanTable
  deltaT: HuffmanTable
  refineDeltaWidth: HuffmanTable
  refineDeltaHeight: HuffmanTable
  refineX: HuffmanTable
  refineY: HuffmanTable
  refineSize: HuffmanTable
}

/** Build the runcode-based symbol ID Huffman table and select FS/DS/DT tables (§7.4.4.1.4). */
function getTextRegionHuffmanTables(
  huffFlags: number, referred: number[], customTables: Map<number, HuffmanTable>,
  numberOfSymbols: number, reader: Jbig2Reader, refinement: boolean,
): TextRegionHuffmanTables {
  // Runcode table: 35 four-bit code lengths.
  const runCodes: HuffmanLine[] = []
  for (let i = 0; i <= 34; i++) runCodes.push(new HuffmanLine([i, reader.readBits(4), 0, 0]))
  const runCodesTable = new HuffmanTable(runCodes, false)
  const codes: HuffmanLine[] = []
  for (let i = 0; i < numberOfSymbols;) {
    const codeLength = runCodesTable.decode(reader)
    if (codeLength === null) throw new Error('JBIG2 error: OOB in symbol ID runcode')
    if (codeLength >= 32) {
      let repeats: number
      let repeatedLength: number
      if (codeLength === 32) {
        if (i === 0) throw new Error('JBIG2 error: no previous value in symbol ID table')
        repeats = reader.readBits(2) + 3
        repeatedLength = codes[i - 1]!.prefixLength
      } else if (codeLength === 33) {
        repeats = reader.readBits(3) + 3
        repeatedLength = 0
      } else {
        repeats = reader.readBits(7) + 11
        repeatedLength = 0
      }
      for (let j = 0; j < repeats; j++) { codes.push(new HuffmanLine([i, repeatedLength, 0, 0])); i++ }
    } else {
      codes.push(new HuffmanLine([i, codeLength, 0, 0])); i++
    }
  }
  reader.byteAlign()
  const symbolID = new HuffmanTable(codes, false)
  const fsSel = huffFlags & 3
  const dsSel = (huffFlags >> 2) & 3
  const dtSel = (huffFlags >> 4) & 3
  if (fsSel === 2) throw new Error('JBIG2 error: reserved Huffman FS table selection')
  if ((huffFlags & 0x8000) !== 0) throw new Error('JBIG2 error: reserved text-region Huffman flag must be zero')
  if (!refinement && (huffFlags & 0x7FC0) !== 0) {
    throw new Error('JBIG2 error: non-refinement text region has refinement Huffman selections')
  }
  let ci = 0
  const firstS = fsSel === 3 ? getCustomHuffmanTable(ci++, referred, customTables) : getStandardTable(fsSel + 6)
  const deltaS = dsSel === 3 ? getCustomHuffmanTable(ci++, referred, customTables) : getStandardTable(dsSel + 8)
  const deltaT = dtSel === 3 ? getCustomHuffmanTable(ci++, referred, customTables) : getStandardTable(dtSel + 11)
  const refinementTable = (shift: number): HuffmanTable => {
    const selection = (huffFlags >> shift) & 3
    if (selection === 2) throw new Error('JBIG2 error: reserved Huffman refinement table selection')
    return selection === 3 ? getCustomHuffmanTable(ci++, referred, customTables) : getStandardTable(selection + 14)
  }
  const refineDeltaWidth = refinement ? refinementTable(6) : getStandardTable(14)
  const refineDeltaHeight = refinement ? refinementTable(8) : getStandardTable(14)
  const refineX = refinement ? refinementTable(10) : getStandardTable(14)
  const refineY = refinement ? refinementTable(12) : getStandardTable(14)
  const refineSize = refinement && (huffFlags & 0x4000) !== 0
    ? getCustomHuffmanTable(ci++, referred, customTables)
    : getStandardTable(1)
  return { symbolID, firstS, deltaS, deltaT, refineDeltaWidth, refineDeltaHeight, refineX, refineY, refineSize }
}

/**
 * Decode a Huffman-coded text region (§6.4, SBHUFF=1). Mirrors the arithmetic
 * text region but decodes strip positions and symbol IDs from Huffman tables;
 * symbol placement reuses drawSymbol.
 */
function decodeHuffmanTextRegion(
  reader: Jbig2Reader, params: TextRegionParams, tables: TextRegionHuffmanTables, symbols: Bitmap[],
  retainedRefinementContexts: MqContext[] | null = null,
): Bitmap {
  const bitmap = new Bitmap(params.width, params.height, params.defaultPixel)
  const refinementContexts = params.refinement
    ? (retainedRefinementContexts ?? createSymbolContexts(1 << 13, null))
    : []
  const strips = 1 << params.logStrips
  let stripT = -tables.deltaT.decode(reader)!
  let firsts = 0
  let instances = 0
  while (instances < params.instanceCount) {
    const dt = tables.deltaT.decode(reader)
    if (dt === null) throw new Error('JBIG2 error: OOB in Huffman DT')
    stripT += dt
    const dfs = tables.firstS.decode(reader)
    if (dfs === null) throw new Error('JBIG2 error: OOB in Huffman FS')
    firsts += dfs
    let curs = firsts
    let firstInStrip = true
    for (;;) {
      if (!firstInStrip) {
        const ids = tables.deltaS.decode(reader)
        if (ids === null) break // end of strip
        curs += ids + params.dsOffset
      }
      firstInStrip = false
      if (instances >= params.instanceCount) break
      const curt = strips === 1 ? 0 : reader.readBits(params.logStrips)
      const tt = strips * stripT + curt
      const id = tables.symbolID.decode(reader)
      if (id === null || id >= symbols.length) throw new Error('JBIG2 error: Huffman symbol id out of range')
      let symbol = symbols[id]!
      if (params.refinement && reader.readBit() !== 0) {
        const rdw = tables.refineDeltaWidth.decode(reader)
        const rdh = tables.refineDeltaHeight.decode(reader)
        const rdx = tables.refineX.decode(reader)
        const rdy = tables.refineY.decode(reader)
        const size = tables.refineSize.decode(reader)
        if (rdw === null || rdh === null || rdx === null || rdy === null || size === null || size < 0) {
          throw new Error('JBIG2 error: invalid Huffman text refinement values')
        }
        reader.byteAlign()
        const start = reader.position
        if (start + size > reader.end) throw new Error('JBIG2 error: Huffman text refinement data exceeds segment')
        const mq = new Jbig2ArithmeticDecoder(reader.getData(), start, start + size)
        symbol = decodeRefinement(mq, refinementContexts, symbol.width + rdw, symbol.height + rdh,
          params.refTemplate, symbol, (rdw >> 1) + rdx, (rdh >> 1) + rdy, params.refAt, false)
        reader.position = start + size
        reader.byteAlign()
      }
      drawSymbol(bitmap, symbol, curs, tt, params)
      curs += (params.transposed ? symbol.height : symbol.width) - 1
      instances++
    }
  }
  return bitmap
}

// ─── Segment parsing (7.2) and page assembly ───

interface Segment {
  number: number
  type: number
  referred: number[]
  pageAssociation: number
  data: Uint8Array
  start: number
  end: number
  retainCurrent: boolean
  referredRetain: boolean[]
  deferredNonRetain: boolean
}

interface SegmentHeader {
  number: number
  type: number
  referred: number[]
  pageAssociation: number
  length: number
  next: number
  retainCurrent: boolean
  referredRetain: boolean[]
  deferredNonRetain: boolean
}

function parseSegmentHeader(data: Uint8Array, start: number): SegmentHeader {
  if (start + 6 > data.length) throw new Error('JBIG2 error: truncated segment header')
  const number = readU32be(data, start)
  const flags = data[start + 4]!
  const type = flags & 0x3F
  const pageAssocSize = (flags & 0x40) !== 0 ? 4 : 1
  let pos = start + 5
  const firstRetention = data[pos]!
  const countCode = firstRetention >> 5
  let referredCount: number
  let retentionBytes: Uint8Array
  if (countCode === 7) {
    if (pos + 4 > data.length) throw new Error('JBIG2 error: truncated long referred-to count')
    referredCount = readU32be(data, pos) & 0x1FFFFFFF
    pos += 4
    const byteCount = Math.ceil((referredCount + 1) / 8)
    if (pos + byteCount > data.length) throw new Error('JBIG2 error: truncated long retention flags')
    retentionBytes = data.subarray(pos, pos + byteCount)
    pos += byteCount
  } else {
    if (countCode > 4) throw new Error(`JBIG2 error: reserved referred-to count code ${countCode}`)
    referredCount = countCode
    const usedMask = (1 << (referredCount + 1)) - 1
    if ((firstRetention & 0x1F & ~usedMask) !== 0) throw new Error('JBIG2 error: non-zero unused short retention flags')
    retentionBytes = data.subarray(pos, pos + 1)
    pos++
  }
  const retention = (index: number): boolean => (retentionBytes[index >> 3]! & (1 << (index & 7))) !== 0
  const retainCurrent = retention(0)
  const referredRetain: boolean[] = []
  for (let i = 0; i < referredCount; i++) referredRetain.push(retention(i + 1))
  const refSize = number <= 256 ? 1 : number <= 65536 ? 2 : 4
  if (pos + referredCount * refSize + pageAssocSize + 4 > data.length) throw new Error('JBIG2 error: truncated segment header fields')
  const referred: number[] = []
  for (let i = 0; i < referredCount; i++) {
    const ref = refSize === 1 ? data[pos]! : refSize === 2 ? readU16be(data, pos) : readU32be(data, pos)
    if (ref >= number) throw new Error(`JBIG2 error: segment ${number} refers to non-earlier segment ${ref}`)
    referred.push(ref)
    pos += refSize
  }
  const pageAssociation = pageAssocSize === 1 ? data[pos]! : readU32be(data, pos)
  pos += pageAssocSize
  const length = readU32be(data, pos)
  pos += 4
  return {
    number, type, referred, pageAssociation, length, next: pos,
    retainCurrent, referredRetain, deferredNonRetain: (flags & 0x80) !== 0,
  }
}

function parseSegments(data: Uint8Array, organization: 'embedded' | 'sequential', start = 0): Segment[] {
  const segments: Segment[] = []
  let pos = start
  while (pos < data.length) {
    const header = parseSegmentHeader(data, pos)
    pos = header.next
    let length = header.length
    if (length === 0xFFFFFFFF) length = resolveUnknownSegmentLength(data, pos, header.type)
    if (pos + length > data.length) throw new Error(`JBIG2 error: segment ${header.number} data exceeds stream length`)
    segments.push({ ...header, data, start: pos, end: pos + length })
    pos += length
    if (organization === 'sequential' && header.type === 51) {
      if (pos !== data.length) throw new Error('JBIG2 error: data follows end-of-file segment')
      break
    }
  }
  return segments
}

function parseRandomAccessSegments(data: Uint8Array, start: number): Segment[] {
  const headers: SegmentHeader[] = []
  let pos = start
  for (;;) {
    const header = parseSegmentHeader(data, pos)
    if (header.length === 0xFFFFFFFF) throw new Error('JBIG2 error: unknown segment length is not allowed in random-access organization')
    headers.push(header)
    pos = header.next
    if (header.type === 51) break
  }
  const segments: Segment[] = []
  let dataPos = pos
  for (const header of headers) {
    if (dataPos + header.length > data.length) throw new Error(`JBIG2 error: segment ${header.number} data exceeds stream length`)
    segments.push({ ...header, data, start: dataPos, end: dataPos + header.length })
    dataPos += header.length
  }
  if (dataPos !== data.length) throw new Error('JBIG2 error: trailing data after random-access segments')
  return segments
}

function validateSegmentRetention(segments: readonly Segment[]): void {
  const forbidden = new Set<number>()
  const deferred = new Set<number>()
  for (const segment of segments) {
    const attachedExtension = segment.type === 62 && segment.referred.length === 1 && deferred.has(segment.referred[0]!)
    if (!attachedExtension) deferred.clear()
    for (const ref of segment.referred) {
      if (forbidden.has(ref) && !(attachedExtension && segment.referred[0] === ref)) {
        throw new Error(`JBIG2 error: segment ${segment.number} refers to non-retained segment ${ref}`)
      }
    }
    for (let i = 0; i < segment.referred.length; i++) {
      if (!segment.referredRetain[i]) {
        forbidden.add(segment.referred[i]!)
        deferred.delete(segment.referred[i]!)
      }
    }
    if (!segment.retainCurrent) {
      forbidden.add(segment.number)
      if (segment.deferredNonRetain) deferred.add(segment.number)
    }
  }
}

/**
 * Resolves a segment whose data length field is the unknown-length sentinel
 * 0xFFFFFFFF (T.88 7.2.7). This is only permitted for an immediate (lossless)
 * generic region, whose bitmap data is self-terminating: after the region
 * segment information field and the generic region flags come the coded rows,
 * followed by a two-byte end marker (0x00 0x00 for MMR, 0xFF 0xAC for
 * arithmetic) and the four-byte row count, which equals the region height.
 * The actual segment length is found by scanning for that six-byte terminator.
 */
function resolveUnknownSegmentLength(data: Uint8Array, pos: number, type: number): number {
  if (type !== 38 && type !== 39) {
    throw new Error('JBIG2 error: unknown segment length is only permitted for an immediate generic region')
  }
  const height = readU32be(data, pos + 4)
  const mmr = (data[pos + 17]! & 1) !== 0
  const pattern = new Uint8Array(6)
  if (!mmr) { pattern[0] = 0xFF; pattern[1] = 0xAC }
  pattern[2] = (height >>> 24) & 0xFF
  pattern[3] = (height >>> 16) & 0xFF
  pattern[4] = (height >>> 8) & 0xFF
  pattern[5] = height & 0xFF
  for (let i = pos; i + 6 <= data.length; i++) {
    let j = 0
    while (j < 6 && data[i + j] === pattern[j]) j++
    if (j === 6) return i + 6 - pos
  }
  throw new Error('JBIG2 error: unknown-length generic region terminator not found')
}

function readU16be(b: Uint8Array, p: number): number {
  return (b[p]! << 8) | b[p + 1]!
}
function readU32be(b: Uint8Array, p: number): number {
  return ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0
}

function decodeJbig2CommentString(data: Uint8Array, start: number, end: number, wide: boolean): { value: string, next: number } {
  let value = ''
  let pos = start
  if (wide) {
    while (pos + 1 < end) {
      const code = readU16be(data, pos)
      pos += 2
      if (code === 0) return { value, next: pos }
      value += String.fromCharCode(code)
    }
  } else {
    while (pos < end) {
      const code = data[pos++]!
      if (code === 0) return { value, next: pos }
      value += String.fromCharCode(code)
    }
  }
  throw new Error('JBIG2 error: unterminated extension comment string')
}

function decodeJbig2Comment(segment: Segment, wide: boolean): Jbig2Comment {
  let pos = segment.start + 4
  const values: Record<string, string> = {}
  while (pos < segment.end) {
    const name = decodeJbig2CommentString(segment.data, pos, segment.end, wide)
    pos = name.next
    if (name.value.length === 0) {
      if (pos !== segment.end) throw new Error('JBIG2 error: data follows extension comment terminator')
      return { pageAssociation: segment.pageAssociation, segmentNumber: segment.number, values }
    }
    const value = decodeJbig2CommentString(segment.data, pos, segment.end, wide)
    pos = value.next
    values[name.value] = value.value
  }
  throw new Error('JBIG2 error: extension comment is missing its final terminator')
}

function parseRegionInfo(data: Uint8Array, pos: number): { x: number, y: number, width: number, height: number, combOp: number } {
  return {
    width: readU32be(data, pos),
    height: readU32be(data, pos + 4),
    x: readU32be(data, pos + 8),
    y: readU32be(data, pos + 12),
    combOp: data[pos + 16]! & 7,
  }
}

function readAtPixels(data: Uint8Array, pos: number, count: number): { x: number, y: number }[] {
  const at: { x: number, y: number }[] = []
  for (let i = 0; i < count; i++) {
    at.push({ x: (data[pos + i * 2]! << 24) >> 24, y: (data[pos + i * 2 + 1]! << 24) >> 24 })
  }
  return at
}

/**
 * Decodes a PDF-embedded JBIG2 stream (optionally with a globals stream)
 * into a 1-byte-per-pixel page image (1 = black).
 */
function decodeJbig2All(data: Uint8Array, globals: Uint8Array | null = null): Jbig2Image[] {
  const segments: Segment[] = []
  if (globals !== null) segments.push(...parseSegments(globals, 'embedded'))
  const signature = [0x97, 0x4A, 0x42, 0x32, 0x0D, 0x0A, 0x1A, 0x0A]
  let standalone = data.length >= signature.length
  for (let i = 0; standalone && i < signature.length; i++) if (data[i] !== signature[i]) standalone = false
  if (standalone) {
    if (globals !== null) throw new Error('JBIG2 error: standalone files cannot use a separate globals stream')
    if (data.length < 9) throw new Error('JBIG2 error: truncated file header')
    const flags = data[8]!
    if ((flags & 0xFC) !== 0) throw new Error('JBIG2 error: reserved file header flags must be zero')
    const unknownPageCount = (flags & 2) !== 0
    const start = unknownPageCount ? 9 : 13
    if (start > data.length) throw new Error('JBIG2 error: truncated file page count')
    const fileSegments = (flags & 1) !== 0
      ? parseSegments(data, 'sequential', start)
      : parseRandomAccessSegments(data, start)
    if (!unknownPageCount) {
      const declared = readU32be(data, 9)
      let actual = 0
      for (const segment of fileSegments) if (segment.type === 48) actual++
      if (declared !== actual) throw new Error(`JBIG2 error: declared page count ${declared} differs from ${actual}`)
    }
    segments.push(...fileSegments)
  } else {
    segments.push(...parseSegments(data, 'embedded'))
  }
  validateSegmentRetention(segments)

  let page: Bitmap | null = null
  let pageHeightUnknown = false
  const pages = new Map<number, Bitmap>()
  const pageHeightUnknownState = new Map<number, boolean>()
  const symbolDicts = new Map<number, Bitmap[]>()
  const patternDicts = new Map<number, Bitmap[]>()
  const customTables = new Map<number, HuffmanTable>()
  const retainedSymbolContexts = new Map<number, SymbolDictionaryContexts>()
  const profiles: number[] = []
  let hasGlobalProfiles = false
  const profilePages = new Set<number>()
  const profilesByPage = new Map<number, number[]>()
  const comments: Jbig2Comment[] = []
  const deferredResources = new Set<number>()
  // Intermediate regions (§7.4.7.5): stored, not composited onto the page, so
  // that a later refinement region can name one as its refinement reference.
  const intermediateRegions = new Map<number, Bitmap>()

  const discardSegment = (number: number): void => {
    symbolDicts.delete(number)
    patternDicts.delete(number)
    customTables.delete(number)
    retainedSymbolContexts.delete(number)
    intermediateRegions.delete(number)
  }

  const composite = (region: Bitmap, x: number, y: number, combOp: number): void => {
    if (page === null) throw new Error('JBIG2 error: region before page information')
    // A page of unknown height (T.88 7.4.8.5) grows to hold each stripe as its
    // regions are composited; new rows take the page default pixel value.
    if (pageHeightUnknown) page.ensureHeight(y + region.height)
    for (let ry = 0; ry < region.height; ry++) {
      const py = y + ry
      if (py < 0 || py >= page.height) continue
      for (let rx = 0; rx < region.width; rx++) {
        const px = x + rx
        if (px < 0 || px >= page.width) continue
        const v = region.get(rx, ry)
        const existing = page.get(px, py)
        const combined = combOp === 0 ? (existing | v)
          : combOp === 1 ? (existing & v)
          : combOp === 2 ? (existing ^ v)
          : combOp === 3 ? 1 - (existing ^ v)
          : v
        page.set(px, py, combined)
      }
    }
  }

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const seg = segments[segmentIndex]!
    if (seg.pageAssociation !== 0 && seg.type !== 48) {
      page = pages.get(seg.pageAssociation) ?? null
      pageHeightUnknown = pageHeightUnknownState.get(seg.pageAssociation) ?? false
    }
    const attachedDeferredExtension = seg.type === 62 && seg.referred.length === 1 && deferredResources.has(seg.referred[0]!)
    if (!attachedDeferredExtension) {
      for (const number of deferredResources) discardSegment(number)
      deferredResources.clear()
    }
    const d = seg.data
    if (seg.type === 48) {
      // Page information
      const width = readU32be(d, seg.start)
      let height = readU32be(d, seg.start + 4)
      const flags = d[seg.start + 16]!
      // A height of 0xFFFFFFFF marks a striped page whose final height is not
      // yet known (T.88 7.4.8.5); it starts empty and grows as stripes arrive.
      pageHeightUnknown = height === 0xFFFFFFFF
      if (pageHeightUnknown) height = 0
      page = new Bitmap(width, height, (flags >> 2) & 1)
      if (seg.pageAssociation === 0) throw new Error('JBIG2 error: page information must have a non-zero page association')
      if (pages.has(seg.pageAssociation)) throw new Error(`JBIG2 error: duplicate page information for page ${seg.pageAssociation}`)
      pages.set(seg.pageAssociation, page)
      pageHeightUnknownState.set(seg.pageAssociation, pageHeightUnknown)
    } else if (seg.type === 0) {
      // Symbol dictionary
      let p = seg.start
      const flags = readU16be(d, p)
      p += 2
      const huffman = (flags & 1) !== 0
      const refinement = (flags & 2) !== 0
      const contextUsed = (flags & 0x0100) !== 0
      const contextRetained = (flags & 0x0200) !== 0
      const template = (flags >> 10) & 3
      const refTemplate = (flags >> 12) & 1
      if ((flags & 0xE000) !== 0) throw new Error('JBIG2 error: reserved symbol dictionary flag bits must be zero')
      if (!huffman && (flags & 0x00FC) !== 0) throw new Error('JBIG2 error: arithmetic symbol dictionary cannot select Huffman tables')
      if (huffman && (((flags >> 2) & 3) === 2 || ((flags >> 4) & 3) === 2)) {
        throw new Error('JBIG2 error: reserved symbol dictionary Huffman table selection')
      }
      if (huffman && template !== 0) throw new Error('JBIG2 error: Huffman symbol dictionary SDTEMPLATE must be zero')
      if (!refinement && ((flags & 0x0080) !== 0 || refTemplate !== 0)) {
        throw new Error('JBIG2 error: non-refinement symbol dictionary has refinement-only flags')
      }
      // Adaptive-template pixels are present only for arithmetic generic coding.
      let at: { x: number, y: number }[] = []
      if (!huffman) {
        at = readAtPixels(d, p, template === 0 ? 4 : 1)
        p += (template === 0 ? 4 : 1) * 2
      }
      let refAt: { x: number, y: number }[] = []
      if (refinement && refTemplate === 0) {
        refAt = readAtPixels(d, p, 2)
        p += 4
      }
      const exportedCount = readU32be(d, p)
      const newCount = readU32be(d, p + 4)
      p += 8
      const inputSymbols: Bitmap[] = []
      for (const ref of seg.referred) {
        const dict = symbolDicts.get(ref)
        if (dict !== undefined) inputSymbols.push(...dict)
      }
      let retained: SymbolDictionaryContexts | null = null
      if (contextUsed) {
        let lastDictionaryRef: number | null = null
        for (const ref of seg.referred) if (symbolDicts.has(ref)) lastDictionaryRef = ref
        if (lastDictionaryRef !== null) retained = retainedSymbolContexts.get(lastDictionaryRef) ?? null
        if (retained === null) throw new Error('JBIG2 error: SDCTXUSED without a retained context on the last referred symbol dictionary')
      }
      if (huffman) {
        if (!refinement && (contextUsed || contextRetained)) throw new Error('JBIG2 error: direct Huffman symbol dictionary cannot use arithmetic coding contexts')
        const huffTables = getSymbolDictionaryHuffmanTables(flags, seg.referred, customTables)
        const reader = new Jbig2Reader(d, p, seg.end)
        const result = decodeHuffmanSymbolDictionary(
          reader, huffTables, getStandardTable(1), inputSymbols, newCount, refinement, refTemplate, refAt, retained,
        )
        symbolDicts.set(seg.number, result.symbols)
        if (contextRetained) retainedSymbolContexts.set(seg.number, result.contexts)
      } else {
        const result = decodeSymbolDictionary(d, p, seg.end, {
          refinement, template, refTemplate, at, refAt, exportedCount, newCount,
        }, inputSymbols, retained)
        symbolDicts.set(seg.number, result.symbols)
        if (contextRetained) retainedSymbolContexts.set(seg.number, result.contexts)
      }
    } else if (seg.type === 4 || seg.type === 6 || seg.type === 7) {
      // Text region
      const info = parseRegionInfo(d, seg.start)
      let p = seg.start + 17
      const flags = readU16be(d, p)
      p += 2
      const huffman = (flags & 1) !== 0
      const refinement = (flags & 2) !== 0
      const logStrips = (flags >> 2) & 3
      const refCorner = (flags >> 4) & 3
      const transposed = (flags & 0x40) !== 0
      const combOp = (flags >> 7) & 3
      const defaultPixel = (flags >> 9) & 1
      let dsOffset = (flags >> 10) & 0x1F
      if (dsOffset > 15) dsOffset -= 32
      const refTemplate = (flags >> 15) & 1
      // The Huffman-flags field selects FS/DS/DT tables; present only when SBHUFF.
      let huffFlags = 0
      if (huffman) { huffFlags = readU16be(d, p); p += 2 }
      let refAt: { x: number, y: number }[] = []
      if (refinement && refTemplate === 0) {
        refAt = readAtPixels(d, p, 2)
        p += 4
      }
      const instanceCount = readU32be(d, p)
      p += 4
      const symbols: Bitmap[] = []
      for (const ref of seg.referred) {
        const dict = symbolDicts.get(ref)
        if (dict !== undefined) symbols.push(...dict)
      }
      const textParams: TextRegionParams = {
        width: info.width, height: info.height, refinement, refTemplate, refAt,
        defaultPixel, combOp, transposed, refCorner, dsOffset, logStrips, instanceCount,
      }
      let region: Bitmap
      if (huffman) {
        const reader = new Jbig2Reader(d, p, seg.end)
        const huffTables = getTextRegionHuffmanTables(huffFlags, seg.referred, customTables, symbols.length, reader, refinement)
        region = decodeHuffmanTextRegion(reader, textParams, huffTables, symbols)
      } else {
        region = decodeTextRegion(d, p, seg.end, textParams, symbols)
      }
      if (seg.type === 4) intermediateRegions.set(seg.number, region)
      else composite(region, info.x, info.y, info.combOp)
    } else if (seg.type === 36 || seg.type === 38 || seg.type === 39) {
      // Generic region
      const info = parseRegionInfo(d, seg.start)
      let p = seg.start + 17
      const flags = d[p]!
      p += 1
      const mmr = (flags & 1) !== 0
      const template = (flags >> 1) & 3
      const tpgdon = (flags & 8) !== 0
      let region: Bitmap
      if (mmr) {
        // MMR-coded: no adaptive-template pixels, no arithmetic decoder; the
        // remaining segment bytes are the T.6 stream.
        region = decodeMmrBitmap(d, p, seg.end, info.width, info.height)
      } else {
        const at = readAtPixels(d, p, template === 0 ? 4 : 1)
        p += (template === 0 ? 4 : 1) * 2
        const mq = new Jbig2ArithmeticDecoder(d, p, seg.end)
        const cx: MqContext[] = []
        for (let i = 0; i < 1 << 16; i++) cx.push(newMqContext())
        region = decodeGenericRegion(mq, cx, info.width, info.height, { template, tpgdon, at })
      }
      // Type 36 is an intermediate generic region: store it for a later
      // refinement to reference. Types 38/39 are immediate: composite now.
      if (seg.type === 36) intermediateRegions.set(seg.number, region)
      else composite(region, info.x, info.y, info.combOp)
    } else if (seg.type === 50) {
      // End of stripe (§7.4.9): its row number is the Y coordinate of the last
      // row of the stripe, which fixes the height of a striped page.
      if (page === null) throw new Error('JBIG2 error: end of stripe before page information')
      if (pageHeightUnknown) page.ensureHeight(readU32be(d, seg.start) + 1)
    } else if (seg.type === 49 || seg.type === 51) {
      if (seg.start !== seg.end) throw new Error('JBIG2 error: end marker segment data length must be zero')
    } else if (seg.type === 52) {
      if (seg.end - seg.start < 4) throw new Error('JBIG2 error: truncated profiles segment')
      const count = readU32be(d, seg.start)
      if (count > (seg.end - seg.start - 4) / 4 || seg.start + 4 + count * 4 !== seg.end) {
        throw new Error('JBIG2 error: profiles segment length does not match its profile count')
      }
      if (!hasGlobalProfiles) {
        if (segmentIndex !== 0 || seg.pageAssociation !== 0) throw new Error('JBIG2 error: first profiles segment must be the global first segment')
        hasGlobalProfiles = true
        for (let i = 0; i < count; i++) profiles.push(readU32be(d, seg.start + 4 + i * 4))
      } else {
        if (seg.pageAssociation === 0 || profilePages.has(seg.pageAssociation)) {
          throw new Error('JBIG2 error: each page may have at most one page profiles segment')
        }
        profilePages.add(seg.pageAssociation)
        const pageProfiles = new Set<number>()
        const pageProfileList: number[] = []
        for (let i = 0; i < count; i++) {
          const profile = readU32be(d, seg.start + 4 + i * 4)
          pageProfiles.add(profile)
          pageProfileList.push(profile)
        }
        for (const profile of profiles) if (!pageProfiles.has(profile)) throw new Error('JBIG2 error: page profiles are less restrictive than global profiles')
        profilesByPage.set(seg.pageAssociation, pageProfileList)
      }
    } else if (seg.type === 62) {
      if (seg.end - seg.start < 4) throw new Error('JBIG2 error: truncated extension segment')
      const extensionType = readU32be(d, seg.start)
      const necessary = (extensionType & 0x80000000) !== 0
      const reserved = (extensionType & 0x20000000) !== 0
      if (necessary && !reserved) throw new Error('JBIG2 error: necessary extension must set the reserved extension bit')
      if (extensionType === 0x20000000) comments.push(decodeJbig2Comment(seg, false))
      else if (extensionType === 0x20000002) comments.push(decodeJbig2Comment(seg, true))
      else if (necessary) throw new Error(`JBIG2 error: unknown necessary extension type 0x${extensionType.toString(16)}`)
    } else if (seg.type === 16) {
      // Pattern dictionary
      patternDicts.set(seg.number, decodePatternDictionary(d, seg.start, seg.end))
    } else if (seg.type === 20 || seg.type === 22 || seg.type === 23) {
      // Halftone region
      let patterns: Bitmap[] | null = null
      for (const ref of seg.referred) {
        const pd = patternDicts.get(ref)
        if (pd) patterns = pd
      }
      if (patterns === null) throw new Error('JBIG2 error: halftone region without a pattern dictionary')
      const ht = decodeHalftoneRegion(d, seg.start, seg.end, patterns)
      if (seg.type === 20) intermediateRegions.set(seg.number, ht.region)
      else composite(ht.region, ht.x, ht.y, ht.combOp)
    } else if (seg.type === 40 || seg.type === 42 || seg.type === 43) {
      // Generic refinement region (§7.4.7). The reference is a stored
      // intermediate region if this segment names one, otherwise the current
      // page content at the region's position (dx=dy=0).
      if (page === null) throw new Error('JBIG2 error: refinement region before page information')
      const info = parseRegionInfo(d, seg.start)
      let p = seg.start + 17
      const rflags = d[p]!; p += 1
      const grTemplate = rflags & 1
      const tpgron = (rflags & 2) !== 0
      let refAt: { x: number, y: number }[] = []
      if (grTemplate === 0) { refAt = readAtPixels(d, p, 2); p += 4 }
      let referencedRegion: Bitmap | null = null
      for (const r of seg.referred) {
        const stored = intermediateRegions.get(r)
        if (stored !== undefined) referencedRegion = stored
      }
      const reference = new Bitmap(info.width, info.height)
      if (referencedRegion !== null) {
        if (referencedRegion.width !== info.width || referencedRegion.height !== info.height) {
          throw new Error('JBIG2 error: refinement reference size differs from the region')
        }
        reference.data.set(referencedRegion.data)
      } else {
        for (let ry = 0; ry < info.height; ry++) {
          for (let rx = 0; rx < info.width; rx++) reference.set(rx, ry, page.get(info.x + rx, info.y + ry))
        }
      }
      const mq = new Jbig2ArithmeticDecoder(d, p, seg.end)
      const cx: MqContext[] = []
      for (let i = 0; i < 1 << 13; i++) cx.push(newMqContext())
      const refined = decodeRefinement(mq, cx, info.width, info.height, grTemplate, reference, 0, 0, refAt, tpgron)
      if (seg.type === 40) {
        // Intermediate refinement: store for a later reference, do not composite.
        intermediateRegions.set(seg.number, refined)
      } else {
        // Immediate refinement replaces the page region at its position.
        for (let ry = 0; ry < info.height; ry++) {
          for (let rx = 0; rx < info.width; rx++) page.set(info.x + rx, info.y + ry, refined.get(rx, ry))
        }
      }
    } else if (seg.type === 53) {
      // Custom Huffman code table (§7.4.13): parsed and retained for the
      // Huffman-coded symbol dictionaries / text regions that reference it.
      customTables.set(seg.number, decodeTablesSegment(d, seg.start, seg.end))
    } else {
      throw new Error(`JBIG2 error: unsupported segment type ${seg.type}`)
    }
    for (let i = 0; i < seg.referred.length; i++) {
      if (!seg.referredRetain[i]) {
        discardSegment(seg.referred[i]!)
        deferredResources.delete(seg.referred[i]!)
      }
    }
    if (!seg.retainCurrent) {
      if (seg.deferredNonRetain) deferredResources.add(seg.number)
      else discardSegment(seg.number)
    }
  }
  if (pages.size === 0) throw new Error('JBIG2 error: no page information segment')
  const result: Jbig2Image[] = []
  const pageNumbers = [...pages.keys()].sort((a, b) => a - b)
  for (const pageNumber of pageNumbers) {
    const bitmap = pages.get(pageNumber)!
    const pageProfiles = profilesByPage.get(pageNumber) ?? profiles
    const pageComments: Jbig2Comment[] = []
    for (const comment of comments) if (comment.pageAssociation === 0 || comment.pageAssociation === pageNumber) pageComments.push(comment)
    result.push({
      pageAssociation: pageNumber, width: bitmap.width, height: bitmap.height,
      pixels: bitmap.data, profiles: pageProfiles, comments: pageComments,
    })
  }
  return result
}

/** Decode every page in a standalone or embedded JBIG2 stream. */
export function decodeJbig2Pages(data: Uint8Array, globals: Uint8Array | null = null): Jbig2Image[] {
  return decodeJbig2All(data, globals)
}

/** Decode a PDF-style single-page JBIG2 stream. */
export function decodeJbig2(data: Uint8Array, globals: Uint8Array | null = null): Jbig2Image {
  const pages = decodeJbig2All(data, globals)
  if (pages.length !== 1) throw new Error(`JBIG2 error: single-page decoder received ${pages.length} pages`)
  return pages[0]!
}
