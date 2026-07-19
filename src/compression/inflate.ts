/**
 * Pure JavaScript inflate (deflate decompression) implementation
 * RFC 1951 compliant
 * Used for decompressing WOFF tables
 * No external dependencies, works in both Node.js and browsers
 */

// Code lengths for the fixed Huffman table
const FIXED_LIT_LEN_LENGTHS = new Uint8Array(288)
// 0-143: 8bit, 144-255: 9bit, 256-279: 7bit, 280-287: 8bit
for (let i = 0; i <= 143; i++) FIXED_LIT_LEN_LENGTHS[i] = 8
for (let i = 144; i <= 255; i++) FIXED_LIT_LEN_LENGTHS[i] = 9
for (let i = 256; i <= 279; i++) FIXED_LIT_LEN_LENGTHS[i] = 7
for (let i = 280; i <= 287; i++) FIXED_LIT_LEN_LENGTHS[i] = 8

const FIXED_DIST_LENGTHS = new Uint8Array(32)
for (let i = 0; i < 32; i++) FIXED_DIST_LENGTHS[i] = 5

// Extra bits and base values for length codes
const LENGTH_EXTRA_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258,
]

// Extra bits and base values for distance codes
const DIST_EXTRA_BITS = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
  13, 13,
]
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
]

// Code length order (RFC 1951 Section 3.2.7)
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

/**
 * Huffman table
 */
interface HuffmanTable {
  /** Number of symbols per code length */
  counts: Uint16Array
  /** Sorted symbol array */
  symbols: Uint16Array
}

/**
 * Bit reader (LSB-first)
 */
class BitReader {
  private readonly data: Uint8Array
  private pos: number
  private bitBuf: number
  private bitCount: number

  constructor(data: Uint8Array, offset: number) {
    this.data = data
    this.pos = offset
    this.bitBuf = 0
    this.bitCount = 0
  }

  /** Current byte position */
  get bytePosition(): number {
    return this.pos - (this.bitCount >> 3)
  }

  /** Align the bit buffer to a byte boundary */
  alignToByte(): void {
    const discard = this.bitCount & 7
    this.bitBuf >>>= discard
    this.bitCount -= discard
  }

  /** Read n bits (safe up to 25 bits) */
  readBits(n: number): number {
    while (this.bitCount < n) {
      if (this.pos >= this.data.length) {
        throw new Error('Inflate: unexpected end of data')
      }
      this.bitBuf |= this.data[this.pos]! << this.bitCount
      this.pos++
      this.bitCount += 8
    }
    const val = this.bitBuf & ((1 << n) - 1)
    this.bitBuf >>>= n
    this.bitCount -= n
    return val
  }

  /** Read a Uint16 in little-endian (after byte alignment) */
  readUint16LE(): number {
    this.alignToByte()
    const lo = this.readBits(8)
    const hi = this.readBits(8)
    return lo | (hi << 8)
  }

  /** Copy the specified number of bytes */
  copyBytes(dest: Uint8Array, destOffset: number, count: number): void {
    this.alignToByte()
    // Consume the bytes remaining in the bit buffer first
    const bytePos = this.pos - (this.bitCount >> 3)
    this.pos = bytePos
    this.bitBuf = 0
    this.bitCount = 0
    dest.set(this.data.subarray(this.pos, this.pos + count), destOffset)
    this.pos += count
  }

  /** Decode a symbol using a Huffman table */
  decodeSymbol(table: HuffmanTable): number {
    let code = 0
    let first = 0
    let index = 0

    for (let len = 1; len <= 15; len++) {
      code |= this.readBits(1)
      const count = table.counts[len]!
      if (code < first + count) {
        return table.symbols[index + (code - first)]!
      }
      index += count
      first = (first + count) << 1
      code <<= 1
    }

    throw new Error('Inflate: invalid huffman code')
  }
}

/**
 * Build a Huffman table from a code length array
 */
function buildHuffmanTable(lengths: Uint8Array, count: number): HuffmanTable {
  const counts = new Uint16Array(16)
  const symbols = new Uint16Array(count)

  // Count the number of codes for each length
  for (let i = 0; i < count; i++) {
    if (lengths[i]!) {
      counts[lengths[i]!]!++
    }
  }

  // Sort symbols (by length, then by symbol value within the same length)
  const offsets = new Uint16Array(16)
  for (let len = 1; len < 16; len++) {
    offsets[len] = offsets[len - 1]! + counts[len - 1]!
  }

  for (let sym = 0; sym < count; sym++) {
    if (lengths[sym]!) {
      symbols[offsets[lengths[sym]!]!] = sym
      offsets[lengths[sym]!]!++
    }
  }

  return { counts, symbols }
}

/**
 * Decode dynamic Huffman tables
 */
function decodeDynamicTables(bits: BitReader): { litLen: HuffmanTable; dist: HuffmanTable } {
  const hlit = bits.readBits(5) + 257
  const hdist = bits.readBits(5) + 1
  const hclen = bits.readBits(4) + 4

  // Read the code lengths for the code length table
  const codeLenLengths = new Uint8Array(19)
  for (let i = 0; i < hclen; i++) {
    codeLenLengths[CODE_LENGTH_ORDER[i]!] = bits.readBits(3)
  }

  const codeLenTable = buildHuffmanTable(codeLenLengths, 19)

  // Decode the literal/length + distance code lengths
  const totalCodes = hlit + hdist
  const allLengths = new Uint8Array(totalCodes)
  let i = 0

  while (i < totalCodes) {
    const sym = bits.decodeSymbol(codeLenTable)
    if (sym < 16) {
      allLengths[i++] = sym
    } else if (sym === 16) {
      // Repeat the previous value 3-6 times
      const repeat = bits.readBits(2) + 3
      const prev = i > 0 ? allLengths[i - 1]! : 0
      for (let j = 0; j < repeat && i < totalCodes; j++) {
        allLengths[i++] = prev
      }
    } else if (sym === 17) {
      // Repeat 0 for 3-10 times
      const repeat = bits.readBits(3) + 3
      i += repeat
      if (i > totalCodes) i = totalCodes
    } else if (sym === 18) {
      // Repeat 0 for 11-138 times
      const repeat = bits.readBits(7) + 11
      i += repeat
      if (i > totalCodes) i = totalCodes
    }
  }

  const litLenLengths = allLengths.subarray(0, hlit)
  const distLengths = allLengths.subarray(hlit, hlit + hdist)

  return {
    litLen: buildHuffmanTable(litLenLengths as Uint8Array, hlit),
    dist: buildHuffmanTable(distLengths as Uint8Array, hdist),
  }
}

/** Object wrapping the output buffer (for reference sharing) */
interface OutputBuffer {
  buf: Uint8Array
  /** Output length decoded up to the current symbol, for partial recovery of a
   *  truncated final block. */
  decodedPos: number
}

const TRUNCATED_MSG = 'Inflate: unexpected end of data'

/**
 * Ensure the output buffer has enough capacity
 */
function ensureCapacity(out: OutputBuffer, needed: number): void {
  if (needed <= out.buf.length) return
  let newSize = out.buf.length
  while (newSize < needed) newSize *= 2
  const newBuf = new Uint8Array(newSize)
  newBuf.set(out.buf)
  out.buf = newBuf
}

/**
 * Decode a compressed block
 */
function decodeBlock(
  bits: BitReader,
  litLenTable: HuffmanTable,
  distTable: HuffmanTable,
  out: OutputBuffer,
  outPos: number,
  windowSize: number,
): number {
  for (;;) {
    // Record the output length reached before this (possibly truncated) symbol,
    // so a cut mid-symbol can still return everything decoded so far.
    out.decodedPos = outPos
    const sym = bits.decodeSymbol(litLenTable)

    if (sym < 256) {
      // Literal byte
      ensureCapacity(out, outPos + 1)
      out.buf[outPos++] = sym
    } else if (sym === 256) {
      // End of block
      return outPos
    } else {
      // Length + distance pair (LZ77)
      const lenIdx = sym - 257
      let length = LENGTH_BASE[lenIdx]!
      if (LENGTH_EXTRA_BITS[lenIdx]!) {
        length += bits.readBits(LENGTH_EXTRA_BITS[lenIdx]!)
      }

      const distSym = bits.decodeSymbol(distTable)
      let distance = DIST_BASE[distSym]!
      if (DIST_EXTRA_BITS[distSym]!) {
        distance += bits.readBits(DIST_EXTRA_BITS[distSym]!)
      }
      if (distance > windowSize) throw new Error('Inflate: back-reference distance exceeds the declared window')

      // Copy the back-reference (accounting for overlap). A distance pointing
      // before the start of the output is an invalid deflate stream; reject it
      // rather than reading out of bounds and emitting zero bytes.
      let srcPos = outPos - distance
      if (srcPos < 0) {
        throw new Error('Inflate: back-reference distance exceeds output')
      }
      ensureCapacity(out, outPos + length)
      for (let i = 0; i < length; i++) {
        out.buf[outPos++] = out.buf[srcPos++]!
      }
    }
  }
}

/**
 * Decompress deflate-compressed data
 * @param data Compressed data (raw deflate, no zlib header)
 * @param outputSize Output size (if known)
 * @returns Decompressed data
 */
export function inflate(data: Uint8Array, outputSize?: number, dictionary?: Uint8Array, windowSize = 32768): Uint8Array {
  return inflateDetailed(data, outputSize, dictionary, windowSize).data
}

function inflateDetailed(data: Uint8Array, outputSize?: number, dictionary?: Uint8Array, windowSize = 32768): { data: Uint8Array, bytesConsumed: number } {
  const bits = new BitReader(data, 0)

  // Output buffer (grows dynamically via ensureCapacity as bytes are produced).
  // outputSize is only a pre-allocation hint: an untrusted caller (e.g. a WOFF
  // table's declared origLength) could claim gigabytes to force a huge up-front
  // allocation, so cap the initial buffer to a small multiple of the actual
  // compressed input. Genuine content still grows the buffer to whatever the
  // real decompressed stream needs.
  const dictionaryBytes = dictionary === undefined
    ? new Uint8Array(0)
    : dictionary.subarray(Math.max(0, dictionary.length - windowSize))
  const initialSizeWithoutDictionary = outputSize !== undefined
    ? Math.min(outputSize, data.length * 8 + 1024)
    : data.length * 4
  const initialSize = Math.max(1, dictionaryBytes.length + initialSizeWithoutDictionary)
  const out: OutputBuffer = { buf: new Uint8Array(initialSize), decodedPos: dictionaryBytes.length }
  out.buf.set(dictionaryBytes)
  const outputStart = dictionaryBytes.length
  let outPos = outputStart

  let bfinal: number
  do {
    out.decodedPos = outPos
    bfinal = bits.readBits(1)
    const btype = bits.readBits(2)

    if (btype === 0) {
        // Stored (uncompressed) block
        const len = bits.readUint16LE()
        const nlen = bits.readUint16LE()
        if ((len ^ 0xFFFF) !== nlen) {
          throw new Error('Inflate: invalid stored block length')
        }
        ensureCapacity(out, outPos + len)
        bits.copyBytes(out.buf, outPos, len)
        outPos += len
    } else if (btype === 1) {
        // Fixed Huffman
        const litLen = buildHuffmanTable(FIXED_LIT_LEN_LENGTHS, 288)
        const dist = buildHuffmanTable(FIXED_DIST_LENGTHS, 32)
        outPos = decodeBlock(bits, litLen, dist, out, outPos, windowSize)
    } else if (btype === 2) {
        // Dynamic Huffman
        const { litLen, dist } = decodeDynamicTables(bits)
        outPos = decodeBlock(bits, litLen, dist, out, outPos, windowSize)
    } else {
      throw new Error('Inflate: invalid block type')
    }
  } while (!bfinal)

  bits.alignToByte()
  return { data: out.buf.subarray(outputStart, outPos), bytesConsumed: bits.bytePosition }
}

/**
 * Decompress zlib-format (RFC 1950) data
 * Validates the RFC 1950 header and Adler-32 checksum.
 */
export function zlibInflate(data: Uint8Array, dictionary?: Uint8Array): Uint8Array {
  if (data.length < 6) {
    throw new Error('Inflate: data too short for zlib format')
  }
  const cmf = data[0]!
  const flg = data[1]!

  // CMF checks
  const cm = cmf & 0x0F
  if (cm !== 8) {
    throw new Error(`Inflate: unsupported compression method ${cm}`)
  }
  if ((cmf >>> 4) > 7) throw new Error('Inflate: invalid zlib window size')

  // FLG check
  if ((cmf * 256 + flg) % 31 !== 0) {
    throw new Error('Inflate: invalid zlib header checksum')
  }

  const hasDictionary = (flg & 0x20) !== 0
  let compressedOffset = 2
  if (hasDictionary) {
    if (data.length < 10) throw new Error('Inflate: data too short for a preset dictionary stream')
    if (dictionary === undefined) throw new Error('Inflate: preset dictionary data is required')
    const expectedDictionaryId = ((data[2]! << 24) | (data[3]! << 16) | (data[4]! << 8) | data[5]!) >>> 0
    if (adler32(dictionary) !== expectedDictionaryId) throw new Error('Inflate: preset dictionary Adler-32 mismatch')
    compressedOffset = 6
  }

  const output = inflate(data.subarray(compressedOffset, data.length - 4), undefined, hasDictionary ? dictionary : undefined, 1 << ((cmf >>> 4) + 8))
  const expected = ((data[data.length - 4]! << 24) | (data[data.length - 3]! << 16)
    | (data[data.length - 2]! << 8) | data[data.length - 1]!) >>> 0
  const actual = adler32(output)
  if (actual !== expected) throw new Error('Inflate: invalid Adler-32 checksum')
  return output
}

/** Decompresses one or more RFC 1952 gzip members with full header/trailer validation. */
export function gzipInflate(data: Uint8Array): Uint8Array {
  const members: Uint8Array[] = []
  let position = 0
  let totalLength = 0
  while (position < data.length) {
    const memberStart = position
    if (position + 10 > data.length || data[position] !== 0x1f || data[position + 1] !== 0x8b) {
      throw new Error('Inflate: invalid gzip member header')
    }
    if (data[position + 2] !== 8) throw new Error(`Inflate: unsupported gzip compression method ${data[position + 2]}`)
    const flags = data[position + 3]!
    if ((flags & 0xe0) !== 0) throw new Error('Inflate: gzip reserved flags are set')
    position += 10
    if ((flags & 0x04) !== 0) {
      if (position + 2 > data.length) throw new Error('Inflate: truncated gzip extra-field length')
      const extraLength = data[position]! | data[position + 1]! << 8
      position += 2
      if (position + extraLength > data.length) throw new Error('Inflate: truncated gzip extra field')
      position += extraLength
    }
    if ((flags & 0x08) !== 0) position = skipGzipZeroTerminated(data, position, 'file name')
    if ((flags & 0x10) !== 0) position = skipGzipZeroTerminated(data, position, 'comment')
    if ((flags & 0x02) !== 0) {
      if (position + 2 > data.length) throw new Error('Inflate: truncated gzip header CRC')
      const expectedHeaderCrc = data[position]! | data[position + 1]! << 8
      const actualHeaderCrc = crc32(data.subarray(memberStart, position)) & 0xffff
      if (actualHeaderCrc !== expectedHeaderCrc) throw new Error('Inflate: invalid gzip header CRC')
      position += 2
    }
    const decoded = inflateDetailed(data.subarray(position))
    position += decoded.bytesConsumed
    if (position + 8 > data.length) throw new Error('Inflate: truncated gzip trailer')
    const expectedCrc = readUint32Le(data, position)
    const expectedSize = readUint32Le(data, position + 4)
    if (crc32(decoded.data) !== expectedCrc) throw new Error('Inflate: invalid gzip data CRC')
    if ((decoded.data.length >>> 0) !== expectedSize) throw new Error('Inflate: invalid gzip uncompressed size')
    position += 8
    members.push(decoded.data)
    totalLength += decoded.data.length
  }
  const output = new Uint8Array(totalLength)
  let outputPosition = 0
  for (const member of members) {
    output.set(member, outputPosition)
    outputPosition += member.length
  }
  return output
}

function skipGzipZeroTerminated(data: Uint8Array, position: number, label: string): number {
  while (position < data.length && data[position] !== 0) position++
  if (position >= data.length) throw new Error(`Inflate: unterminated gzip ${label}`)
  return position + 1
}

function readUint32Le(data: Uint8Array, position: number): number {
  return (data[position]! | data[position + 1]! << 8 | data[position + 2]! << 16 | data[position + 3]! << 24) >>> 0
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}
