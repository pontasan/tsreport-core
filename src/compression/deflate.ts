/**
 * Pure JavaScript deflate (compression) implementation
 * RFC 1951 compliant
 * Used for PNG alpha separation and future PDF stream compression
 * No external dependencies, works in both Node.js and browsers
 *
 * LZ77 hash chain approach + fixed Huffman (btype=1) / dynamic Huffman (btype=2) / stored (btype=0)
 * No closures, TypedArray based
 */

// ─── Fixed Huffman table constants ───

// Extra bits and base values for length codes
const LENGTH_EXTRA_BITS = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
])
const LENGTH_BASE = new Uint16Array([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258,
])

// Extra bits and base values for distance codes
const DIST_EXTRA_BITS = new Uint8Array([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
  13, 13,
])
const DIST_BASE = new Uint16Array([
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
])

// Code length order (RFC 1951 Section 3.2.7)
const CODE_LENGTH_ORDER = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])

// ─── Bit writer (LSB-first) ───

class BitWriter {
  buf: Uint8Array
  pos: number
  private bitBuf: number
  private bitCount: number

  constructor(initialSize: number) {
    this.buf = new Uint8Array(initialSize)
    this.pos = 0
    this.bitBuf = 0
    this.bitCount = 0
  }

  private ensureCapacity(bytes: number): void {
    const needed = this.pos + bytes
    if (needed <= this.buf.length) return
    let newSize = this.buf.length
    while (newSize < needed) newSize *= 2
    const newBuf = new Uint8Array(newSize)
    newBuf.set(this.buf)
    this.buf = newBuf
  }

  writeBits(value: number, count: number): void {
    this.bitBuf |= value << this.bitCount
    this.bitCount += count
    while (this.bitCount >= 8) {
      this.ensureCapacity(1)
      this.buf[this.pos++] = this.bitBuf & 0xFF
      this.bitBuf >>>= 8
      this.bitCount -= 8
    }
  }

  /** Write bits reversed (for Huffman codes: written in MSB-first order) */
  writeBitsReversed(code: number, length: number): void {
    let reversed = 0
    for (let i = 0; i < length; i++) {
      reversed = (reversed << 1) | (code & 1)
      code >>>= 1
    }
    this.writeBits(reversed, length)
  }

  /** Flush the bit buffer and align to a byte boundary */
  flushBits(): void {
    if (this.bitCount > 0) {
      this.ensureCapacity(1)
      this.buf[this.pos++] = this.bitBuf & 0xFF
      this.bitBuf = 0
      this.bitCount = 0
    }
  }

  writeByte(b: number): void {
    this.ensureCapacity(1)
    this.buf[this.pos++] = b
  }

  writeUint16LE(v: number): void {
    this.ensureCapacity(2)
    this.buf[this.pos++] = v & 0xFF
    this.buf[this.pos++] = (v >> 8) & 0xFF
  }

  writeBytes(data: Uint8Array, offset: number, length: number): void {
    this.ensureCapacity(length)
    this.buf.set(data.subarray(offset, offset + length), this.pos)
    this.pos += length
  }

  toUint8Array(): Uint8Array {
    this.flushBits()
    return this.buf.subarray(0, this.pos)
  }
}

// ─── LZ77 matching (hash chain approach) ───

const HASH_SIZE = 1 << 15
const HASH_MASK = HASH_SIZE - 1
const MAX_MATCH = 258
const MIN_MATCH = 3
const WINDOW_SIZE = 32768
const DEFAULT_CHAIN_LENGTH = 128  // Default maximum search chain length
const DYNAMIC_HUFFMAN_MIN_INPUT = 64 * 1024
const MAX_REUSABLE_TOKEN_COUNT = 1 << 20

// Deflate is synchronous, and findMatch already communicates through module-level
// result slots. Reuse the equally short-lived LZ77 work arrays so that documents
// containing many content streams do not allocate a hash table and token arrays
// for every stream. Very large token buffers are intentionally not retained.
const lz77HeadWorkspace = new Int32Array(HASH_SIZE)
const lz77PrevWorkspace = new Int32Array(WINDOW_SIZE)
let lz77LiteralWorkspace = new Int32Array(0)
let lz77LengthWorkspace = new Uint16Array(0)
let lz77DistanceWorkspace = new Uint16Array(0)

/** Compute a hash from 3 bytes */
function hashBytes(d: Uint8Array, i: number): number {
  return ((d[i]! << 5) ^ (d[i + 1]! << 3) ^ d[i + 2]!) & HASH_MASK
}

// Module-level variables holding findMatch results (avoids object allocation)
let _matchLength = 0
let _matchDistance = 0

/** Search for an LZ77 match (results stored in _matchLength, _matchDistance) */
function findMatch(
  data: Uint8Array, pos: number, dataLen: number,
  head: Int32Array, prev: Int32Array, maxChain: number,
): void {
  const maxLen = Math.min(MAX_MATCH, dataLen - pos)
  if (maxLen < MIN_MATCH) { _matchLength = 0; _matchDistance = 0; return }

  const hash = hashBytes(data, pos)
  let chainIdx = head[hash]!
  let bestLen = MIN_MATCH - 1
  let bestDist = 0
  let chainCount = maxChain
  const minPos = pos > WINDOW_SIZE ? pos - WINDOW_SIZE : 0

  while (chainIdx >= minPos && chainCount-- > 0) {
    // Compare the tail byte first for early termination
    if (data[chainIdx + bestLen] === data[pos + bestLen]) {
      let len = 0
      while (len < maxLen && data[chainIdx + len] === data[pos + len]) len++
      if (len > bestLen) {
        bestLen = len
        bestDist = pos - chainIdx
        if (len === maxLen) break
      }
    }
    chainIdx = prev[chainIdx & (WINDOW_SIZE - 1)]!
  }

  if (bestLen >= MIN_MATCH) { _matchLength = bestLen; _matchDistance = bestDist }
  else { _matchLength = 0; _matchDistance = 0 }
}

// ─── LZ77 tokens (struct-of-arrays, TypedArray based) ───

interface LZ77Tokens {
  literals: Int32Array    // >= 0: literal byte, -1: length/distance pair
  lengths: Uint16Array
  distances: Uint16Array
  count: number
}

function nextTokenWorkspaceSize(required: number): number {
  let size = 32
  while (size < required) size *= 2
  return size
}

function acquireTokenArrays(dataLen: number): {
  literals: Int32Array
  lengths: Uint16Array
  distances: Uint16Array
} {
  if (dataLen > MAX_REUSABLE_TOKEN_COUNT) {
    return {
      literals: new Int32Array(dataLen),
      lengths: new Uint16Array(dataLen),
      distances: new Uint16Array(dataLen),
    }
  }
  if (lz77LiteralWorkspace.length < dataLen) {
    const size = nextTokenWorkspaceSize(dataLen)
    lz77LiteralWorkspace = new Int32Array(size)
    lz77LengthWorkspace = new Uint16Array(size)
    lz77DistanceWorkspace = new Uint16Array(size)
  }
  return {
    literals: lz77LiteralWorkspace,
    lengths: lz77LengthWorkspace,
    distances: lz77DistanceWorkspace,
  }
}

/** Generate a token sequence via LZ77 compression */
function lz77Compress(data: Uint8Array, maxChain: number = DEFAULT_CHAIN_LENGTH): LZ77Tokens {
  const dataLen = data.length
  // Worst case: every byte is a literal → dataLen tokens
  const tokenArrays = acquireTokenArrays(dataLen)
  const literals = tokenArrays.literals
  const lengths = tokenArrays.lengths
  const distances = tokenArrays.distances
  let count = 0

  if (dataLen < MIN_MATCH) {
    for (let i = 0; i < dataLen; i++) {
      literals[i] = data[i]!
    }
    return { literals, lengths, distances, count: dataLen }
  }

  const head = lz77HeadWorkspace
  const prev = lz77PrevWorkspace
  head.fill(-1)

  let pos = 0
  while (pos < dataLen) {
    if (pos + 2 >= dataLen) {
      literals[count] = data[pos]!
      count++
      pos++
      continue
    }

    findMatch(data, pos, dataLen, head, prev, maxChain)

    if (_matchLength >= MIN_MATCH) {
      literals[count] = -1
      lengths[count] = _matchLength
      distances[count] = _matchDistance
      count++
      // Update the hash chain
      for (let i = 0; i < _matchLength; i++) {
        if (pos + i + 2 < dataLen) {
          const h = hashBytes(data, pos + i)
          prev[(pos + i) & (WINDOW_SIZE - 1)] = head[h]!
          head[h] = pos + i
        }
      }
      pos += _matchLength
    } else {
      literals[count] = data[pos]!
      count++
      const h = hashBytes(data, pos)
      prev[pos & (WINDOW_SIZE - 1)] = head[h]!
      head[h] = pos
      pos++
    }
  }

  return { literals, lengths, distances, count }
}

// ─── Huffman code generation ───

/** Convert a length to a code */
function lengthToCode(len: number): number {
  for (let i = 0; i < LENGTH_BASE.length; i++) {
    if (i === LENGTH_BASE.length - 1 || len < LENGTH_BASE[i + 1]!) return i + 257
  }
  return 285
}

/** Convert a distance to a code */
function distanceToCode(dist: number): number {
  for (let i = 0; i < DIST_BASE.length; i++) {
    if (i === DIST_BASE.length - 1 || dist < DIST_BASE[i + 1]!) return i
  }
  return 29
}

/** Generate canonical Huffman codes from a code length array */
function buildCodes(lengths: Uint8Array, count: number): { codes: Uint16Array, codeLengths: Uint8Array } {
  const blCount = new Uint16Array(16)
  for (let i = 0; i < count; i++) {
    if (lengths[i]!) blCount[lengths[i]!]!++
  }

  const nextCode = new Uint16Array(16)
  let code = 0
  for (let bits = 1; bits <= 15; bits++) {
    code = (code + blCount[bits - 1]!) << 1
    nextCode[bits] = code
  }

  const codes = new Uint16Array(count)
  for (let n = 0; n < count; n++) {
    const len = lengths[n]!
    if (len !== 0) {
      codes[n] = nextCode[len]!
      nextCode[len]!++
    }
  }

  return { codes, codeLengths: lengths }
}

// ─── Fixed Huffman tables ───

function getFixedLitLenCodes(): { codes: Uint16Array, codeLengths: Uint8Array } {
  const lengths = new Uint8Array(288)
  for (let i = 0; i <= 143; i++) lengths[i] = 8
  for (let i = 144; i <= 255; i++) lengths[i] = 9
  for (let i = 256; i <= 279; i++) lengths[i] = 7
  for (let i = 280; i <= 287; i++) lengths[i] = 8
  return buildCodes(lengths, 288)
}

function getFixedDistCodes(): { codes: Uint16Array, codeLengths: Uint8Array } {
  const lengths = new Uint8Array(32)
  for (let i = 0; i < 32; i++) lengths[i] = 5
  return buildCodes(lengths, 32)
}

const FIXED_LIT_LEN = getFixedLitLenCodes()
const FIXED_DIST = getFixedDistCodes()

// ─── Dynamic Huffman table generation ───

/** Generate optimal code lengths from frequencies (depth-limited Huffman, zlib approach) */
function buildOptimalLengths(freqs: Uint32Array, count: number, maxBits: number): Uint8Array {
  const lengths = new Uint8Array(count)

  // Collect symbol-frequency pairs
  const symbols: number[] = []
  for (let i = 0; i < count; i++) {
    if (freqs[i]! > 0) symbols.push(i)
  }

  if (symbols.length === 0) return lengths
  if (symbols.length === 1) {
    lengths[symbols[0]!] = 1
    return lengths
  }

  // Sort by frequency (ascending)
  symbols.sort((a, b) => freqs[a]! - freqs[b]!)

  // Build the Huffman tree (two-queue approach, O(n))
  const n = symbols.length
  const freqArr = new Uint32Array(2 * n)
  const parentArr = new Int32Array(2 * n)
  for (let i = 0; i < 2 * n; i++) parentArr[i] = -1

  for (let i = 0; i < n; i++) {
    freqArr[i] = freqs[symbols[i]!]!
  }

  let q1Head = 0
  let q2Head = n
  let q2Tail = n

  for (let i = 0; i < n - 1; i++) {
    // dequeue 2 smallest
    let a: number, b: number
    if (q2Head >= q2Tail || (q1Head < n && freqArr[q1Head]! <= freqArr[q2Head]!)) {
      a = q1Head++
    } else {
      a = q2Head++
    }
    if (q2Head >= q2Tail || (q1Head < n && freqArr[q1Head]! <= freqArr[q2Head]!)) {
      b = q1Head++
    } else {
      b = q2Head++
    }
    const internalIdx = n + i
    freqArr[internalIdx] = freqArr[a]! + freqArr[b]!
    parentArr[a] = internalIdx
    parentArr[b] = internalIdx
    q2Tail = internalIdx + 1
  }

  // Compute depths (top-down from the root)
  const depthArr = new Uint8Array(2 * n)
  depthArr[2 * n - 2] = 0
  for (let i = 2 * n - 3; i >= 0; i--) {
    if (parentArr[i]! >= 0) {
      depthArr[i] = depthArr[parentArr[i]!]! + 1
    }
  }

  // Get leaf depths and clamp them to the DEFLATE limit.
  const blCount = new Uint16Array(maxBits + 1)
  for (let i = 0; i < n; i++) {
    let d = depthArr[i]!
    if (d > maxBits) d = maxBits
    blCount[d]!++
  }
  let slotBalance = 1 << maxBits
  for (let bits = 1; bits <= maxBits; bits++) slotBalance -= blCount[bits]! * (1 << (maxBits - bits))

  // Each adjustment frees exactly one max-depth slot. Counting slots directly
  // handles odd overflow populations as well as the even case used by zlib's
  // tree builder.
  while (slotBalance < 0) {
    let bits = maxBits - 1
    while (blCount[bits]! === 0) bits--
    blCount[bits]!--       // remove one code at depth bits
    blCount[bits + 1]! += 2 // add two at depth bits+1 (split)
    blCount[maxBits]!--     // free one slot at the maximum depth
    slotBalance++
  }

  // Reconstruct lengths from blCount
  // symbols is sorted by ascending frequency → assign longer codes (lower frequency) first
  let si = 0
  for (let bits = maxBits; bits >= 1; bits--) {
    for (let c = 0; c < blCount[bits]!; c++) {
      if (si < n) {
        lengths[symbols[si]!] = bits
        si++
      }
    }
  }

  let slots = 1 << maxBits
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!
    if (length !== 0) slots -= 1 << (maxBits - length)
  }
  if (slots !== 0) throw new Error(`Deflate Huffman construction left ${slots} unassigned code slots`)

  return lengths
}

/** Write a token sequence using fixed Huffman codes */
function writeFixedBlock(writer: BitWriter, tokens: LZ77Tokens, isFinal: boolean): void {
  writer.writeBits(isFinal ? 1 : 0, 1)
  writer.writeBits(1, 2)  // btype = 1 (fixed Huffman)

  const { literals, lengths, distances, count } = tokens
  for (let i = 0; i < count; i++) {
    const lit = literals[i]!
    if (lit >= 0) {
      // Literal
      writer.writeBitsReversed(FIXED_LIT_LEN.codes[lit]!, FIXED_LIT_LEN.codeLengths[lit]!)
    } else {
      // Length/distance pair
      const length = lengths[i]!
      const distance = distances[i]!
      const lenCode = lengthToCode(length)
      writer.writeBitsReversed(FIXED_LIT_LEN.codes[lenCode]!, FIXED_LIT_LEN.codeLengths[lenCode]!)
      const lenIdx = lenCode - 257
      if (LENGTH_EXTRA_BITS[lenIdx]!) {
        writer.writeBits(length - LENGTH_BASE[lenIdx]!, LENGTH_EXTRA_BITS[lenIdx]!)
      }
      const distCode = distanceToCode(distance)
      writer.writeBitsReversed(FIXED_DIST.codes[distCode]!, FIXED_DIST.codeLengths[distCode]!)
      if (DIST_EXTRA_BITS[distCode]!) {
        writer.writeBits(distance - DIST_BASE[distCode]!, DIST_EXTRA_BITS[distCode]!)
      }
    }
  }

  // End of block
  writer.writeBitsReversed(FIXED_LIT_LEN.codes[256]!, FIXED_LIT_LEN.codeLengths[256]!)
}

/** Exact byte length of one final fixed-Huffman block without serializing it. */
function fixedBlockSize(tokens: LZ77Tokens): number {
  let bits = 3 + FIXED_LIT_LEN.codeLengths[256]!
  const { literals, lengths, distances, count } = tokens
  for (let i = 0; i < count; i++) {
    const literal = literals[i]!
    if (literal >= 0) {
      bits += FIXED_LIT_LEN.codeLengths[literal]!
      continue
    }
    const lengthCode = lengthToCode(lengths[i]!)
    const distanceCode = distanceToCode(distances[i]!)
    bits += FIXED_LIT_LEN.codeLengths[lengthCode]! + LENGTH_EXTRA_BITS[lengthCode - 257]!
    bits += FIXED_DIST.codeLengths[distanceCode]! + DIST_EXTRA_BITS[distanceCode]!
  }
  return Math.ceil(bits / 8)
}

/** Write a token sequence using dynamic Huffman codes */
function writeDynamicBlock(writer: BitWriter, tokens: LZ77Tokens, isFinal: boolean): void {
  // Count frequencies
  const litLenFreqs = new Uint32Array(286)
  const distFreqs = new Uint32Array(30)
  litLenFreqs[256] = 1  // end of block is mandatory

  const { literals, lengths, distances, count } = tokens
  for (let i = 0; i < count; i++) {
    const lit = literals[i]!
    if (lit >= 0) {
      litLenFreqs[lit]!++
    } else {
      const lenCode = lengthToCode(lengths[i]!)
      litLenFreqs[lenCode]!++
      const distCode = distanceToCode(distances[i]!)
      distFreqs[distCode]!++
    }
  }
  // RFC 1951 requires one distance code even when the block has no matches.
  let hasDistance = false
  for (let i = 0; i < distFreqs.length; i++) {
    if (distFreqs[i] !== 0) {
      hasDistance = true
      break
    }
  }
  if (!hasDistance) distFreqs[0] = 1

  // Generate optimal code lengths
  const litLenLengths = buildOptimalLengths(litLenFreqs, 286, 15)
  const distLengths = buildOptimalLengths(distFreqs, 30, 15)

  // HLIT, HDIST: maximum number of symbols in use
  let hlit = 286
  while (hlit > 257 && litLenLengths[hlit - 1] === 0) hlit--
  let hdist = 30
  while (hdist > 1 && distLengths[hdist - 1] === 0) hdist--

  // Run-length encode the code length sequence
  const allLengths = new Uint8Array(hlit + hdist)
  allLengths.set(litLenLengths.subarray(0, hlit))
  allLengths.set(distLengths.subarray(0, hdist), hlit)

  const clTokens: number[] = []  // code length tokens
  const clExtra: number[] = []   // extra bit values
  const clExtraBits: number[] = [] // extra bit counts

  for (let i = 0; i < allLengths.length;) {
    const val = allLengths[i]!
    if (val === 0) {
      // Count consecutive zeros
      let count = 1
      while (i + count < allLengths.length && allLengths[i + count] === 0 && count < 138) count++
      if (count >= 11) {
        clTokens.push(18)
        clExtra.push(count - 11)
        clExtraBits.push(7)
        i += count
      } else if (count >= 3) {
        clTokens.push(17)
        clExtra.push(count - 3)
        clExtraBits.push(3)
        i += count
      } else {
        clTokens.push(0)
        clExtra.push(0)
        clExtraBits.push(0)
        i++
      }
    } else {
      clTokens.push(val)
      clExtra.push(0)
      clExtraBits.push(0)
      i++
      // Repetitions of the same value
      let count = 0
      while (i + count < allLengths.length && allLengths[i + count] === val && count < 6) count++
      if (count >= 3) {
        clTokens.push(16)
        clExtra.push(count - 3)
        clExtraBits.push(2)
        i += count
      }
    }
  }

  // Frequencies of the code lengths' code lengths
  const clFreqs = new Uint32Array(19)
  for (let i = 0; i < clTokens.length; i++) {
    clFreqs[clTokens[i]!]!++
  }
  const clLengths = buildOptimalLengths(clFreqs, 19, 7)

  // HCLEN
  let hclen = 19
  while (hclen > 4 && clLengths[CODE_LENGTH_ORDER[hclen - 1]!] === 0) hclen--

  // Generate codes
  const litLenCodes = buildCodes(litLenLengths, hlit)
  const distCodes = buildCodes(distLengths, hdist)
  const clCodes = buildCodes(clLengths, 19)

  // Write the block header
  writer.writeBits(isFinal ? 1 : 0, 1)
  writer.writeBits(2, 2)  // btype = 2 (dynamic Huffman)

  writer.writeBits(hlit - 257, 5)
  writer.writeBits(hdist - 1, 5)
  writer.writeBits(hclen - 4, 4)

  // Code lengths of the code lengths
  for (let i = 0; i < hclen; i++) {
    writer.writeBits(clLengths[CODE_LENGTH_ORDER[i]!]!, 3)
  }

  // Code length sequence
  for (let i = 0; i < clTokens.length; i++) {
    const sym = clTokens[i]!
    writer.writeBitsReversed(clCodes.codes[sym]!, clCodes.codeLengths[sym]!)
    if (clExtraBits[i]!) {
      writer.writeBits(clExtra[i]!, clExtraBits[i]!)
    }
  }

  // Data
  for (let i = 0; i < count; i++) {
    const lit = literals[i]!
    if (lit >= 0) {
      writer.writeBitsReversed(litLenCodes.codes[lit]!, litLenCodes.codeLengths[lit]!)
    } else {
      const length = lengths[i]!
      const distance = distances[i]!
      const lenCode = lengthToCode(length)
      writer.writeBitsReversed(litLenCodes.codes[lenCode]!, litLenCodes.codeLengths[lenCode]!)
      const lenIdx = lenCode - 257
      if (LENGTH_EXTRA_BITS[lenIdx]!) {
        writer.writeBits(length - LENGTH_BASE[lenIdx]!, LENGTH_EXTRA_BITS[lenIdx]!)
      }
      const distCode = distanceToCode(distance)
      writer.writeBitsReversed(distCodes.codes[distCode]!, distCodes.codeLengths[distCode]!)
      if (DIST_EXTRA_BITS[distCode]!) {
        writer.writeBits(distance - DIST_BASE[distCode]!, DIST_EXTRA_BITS[distCode]!)
      }
    }
  }

  // End of block
  writer.writeBitsReversed(litLenCodes.codes[256]!, litLenCodes.codeLengths[256]!)
}

/** Write a stored (uncompressed) block */
function writeStoredBlock(writer: BitWriter, data: Uint8Array, offset: number, length: number, isFinal: boolean): void {
  writer.writeBits(isFinal ? 1 : 0, 1)
  writer.writeBits(0, 2)  // btype = 0 (stored)
  writer.flushBits()
  writer.writeUint16LE(length)
  writer.writeUint16LE(length ^ 0xFFFF)
  writer.writeBytes(data, offset, length)
}

/** Write stored (uncompressed) blocks, split into 64KB chunks */
function writeStoredBlocks(writer: BitWriter, data: Uint8Array): void {
  if (data.length === 0) {
    writeStoredBlock(writer, data, 0, 0, true)
    return
  }

  let offset = 0
  while (offset < data.length) {
    const chunkLen = Math.min(0xFFFF, data.length - offset)
    const isFinal = offset + chunkLen >= data.length
    writeStoredBlock(writer, data, offset, chunkLen, isFinal)
    offset += chunkLen
  }
}

// ─── Public API ───

/**
 * Raw deflate compression
 * @param data Input data
 * @param maxChain LZ77 hash chain search length (default 128; 4 recommended for image data)
 * @returns Compressed data
 */
export function deflate(data: Uint8Array, maxChain: number = DEFAULT_CHAIN_LENGTH): Uint8Array {
  if (data.length === 0) {
    // Empty data: final block + fixed Huffman + end of block
    const writer = new BitWriter(16)
    writer.writeBits(1, 1)   // bfinal
    writer.writeBits(1, 2)   // btype=1
    writer.writeBitsReversed(FIXED_LIT_LEN.codes[256]!, FIXED_LIT_LEN.codeLengths[256]!)
    return writer.toUint8Array()
  }

  // Very small data (< 32 bytes) may be more efficient uncompressed
  if (data.length < 32) {
    const writer = new BitWriter(data.length + 16)
    writeStoredBlocks(writer, data)
    return writer.toUint8Array()
  }

  // LZ77 compression
  const tokens = lz77Compress(data, maxChain)

  const fixedSize = fixedBlockSize(tokens)
  let huffmanResult: Uint8Array
  if (data.length < DYNAMIC_HUFFMAN_MIN_INPUT) {
    const fixedWriter = new BitWriter(fixedSize)
    writeFixedBlock(fixedWriter, tokens, true)
    huffmanResult = fixedWriter.toUint8Array()
  } else {
    const dynamicWriter = new BitWriter(data.length)
    writeDynamicBlock(dynamicWriter, tokens, true)
    const dynamicResult = dynamicWriter.toUint8Array()
    if (dynamicResult.length < fixedSize) {
      huffmanResult = dynamicResult
    } else {
      const fixedWriter = new BitWriter(fixedSize)
      writeFixedBlock(fixedWriter, tokens, true)
      huffmanResult = fixedWriter.toUint8Array()
    }
  }

  // Also compare against stored output (stored blocks are split into 64KB chunks)
  const storedBlocks = Math.ceil(data.length / 0xFFFF)
  const storedSize = data.length + storedBlocks * 5

  if (storedSize <= huffmanResult.length) {
    const writer = new BitWriter(storedSize + 8)
    writeStoredBlocks(writer, data)
    return writer.toUint8Array()
  }

  return huffmanResult
}

// ─── Adler-32 ───

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  const MOD = 65521
  const len = data.length
  // Nmax = 5552 (maximum iteration count that does not exceed MOD_ADLER)
  let i = 0
  while (i < len) {
    const end = Math.min(i + 5552, len)
    for (; i < end; i++) {
      a += data[i]!
      b += a
    }
    a %= MOD
    b %= MOD
  }
  return (b << 16) | a
}

/**
 * Compress in zlib format (RFC 1950)
 * 2-byte header + raw deflate + 4-byte Adler-32
 * @param data Input data
 * @param maxChain LZ77 hash chain search length (default 128; 4 recommended for image data)
 */
export function zlibDeflate(data: Uint8Array, maxChain: number = DEFAULT_CHAIN_LENGTH): Uint8Array {
  const compressed = deflate(data, maxChain)
  const checksum = adler32(data)

  const result = new Uint8Array(2 + compressed.length + 4)
  // zlib header: CM=8 (deflate), CINFO=7 (32K window)
  // CMF = 0x78, FLG: FCHECK + FLEVEL
  result[0] = 0x78  // CMF
  // FLG: FCHECK = (0x7800 + FLG) % 31 === 0
  // FLEVEL = 2 (default compression)
  // FLG = 0x01 → (0x7801) % 31 = 30721 % 31 = 0? → Let's compute
  // 0x78 * 256 + FLG must be % 31 === 0
  // 0x7800 = 30720, 30720 % 31 = 30720 - 991*31 = 30720 - 30721 = ... let me compute
  // 31 * 991 = 30721, so 30720 % 31 = 30. FLG needs FCHECK such that (30720 + FLG) % 31 = 0
  // FLG = 1 → 30721 % 31 = 0 ✓
  result[1] = 0x01  // FLG (FCHECK=1, FLEVEL=0)

  result.set(compressed, 2)

  // Adler-32 (big-endian)
  const off = 2 + compressed.length
  result[off] = (checksum >> 24) & 0xFF
  result[off + 1] = (checksum >> 16) & 0xFF
  result[off + 2] = (checksum >> 8) & 0xFF
  result[off + 3] = checksum & 0xFF

  return result
}
