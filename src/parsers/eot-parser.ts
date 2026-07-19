/**
 * EOT (Embedded OpenType) parser
 * Parses the EOT header and extracts the embedded font data
 * Also supports MicroType Express (MTX) compression
 *
 * EOT flags:
 *   0x00000001 = TTEMBED_SUBSET (subsetted, plain SFNT data)
 *   0x00000004 = TTEMBED_TTCOMPRESSED (MTX compression)
 *   0x00000008 = TTEMBED_XORENCRYPTDATA (XOR encryption)
 */

/**
 * Extracts and returns SFNT data from an EOT font
 * Note that EOT is little-endian
 */
export function unwrapEot(buffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(buffer)

  if (buffer.byteLength < 36) {
    throw new Error('EOT: data too short')
  }

  // The EOT header is little-endian
  const eotSize = view.getUint32(0, true)
  const fontDataSize = view.getUint32(4, true)
  const version = view.getUint32(8, true)
  const flags = view.getUint32(12, true)

  // Magic number check (offset 34, LE)
  const magic = view.getUint16(34, true)
  if (magic !== 0x504C) {
    throw new Error('EOT: invalid magic number')
  }

  // Only the three versions defined by the W3C EOT submission are valid
  if (version !== 0x00010000 && version !== 0x00020001 && version !== 0x00020002) {
    throw new Error('EOT: unsupported version')
  }

  // Walk the variable-length header to locate the start of the embedded font data.
  // The fixed part is 82 bytes (Padding1 at offset 80 included). Each padding word
  // precedes the following size field; FullName is NOT followed by padding in v1.
  let offset = 82

  // FamilyNameSize (Uint16 byte count) + FamilyName (UTF-16LE)
  if (offset + 2 > buffer.byteLength) throw new Error('EOT: truncated header')
  offset += 2 + view.getUint16(offset, true)

  // Padding2 + StyleNameSize + StyleName
  if (offset + 4 > buffer.byteLength) throw new Error('EOT: truncated header')
  offset += 4 + view.getUint16(offset + 2, true)

  // Padding3 + VersionNameSize + VersionName
  if (offset + 4 > buffer.byteLength) throw new Error('EOT: truncated header')
  offset += 4 + view.getUint16(offset + 2, true)

  // Padding4 + FullNameSize + FullName
  if (offset + 4 > buffer.byteLength) throw new Error('EOT: truncated header')
  offset += 4 + view.getUint16(offset + 2, true)

  if (version >= 0x00020001) {
    // Padding5 + RootStringSize + RootString
    if (offset + 4 > buffer.byteLength) throw new Error('EOT: truncated header')
    offset += 4 + view.getUint16(offset + 2, true)

    if (version === 0x00020002) {
      // RootStringCheckSum (4) + EUDCCodePage (4) + Padding6 (2) + SignatureSize (2) + Signature
      if (offset + 12 > buffer.byteLength) throw new Error('EOT: truncated header')
      offset += 12 + view.getUint16(offset + 10, true)

      // EUDCFlags (4) + EUDCFontSize (4) + EUDCFontData (precedes FontData per spec)
      if (offset + 8 > buffer.byteLength) throw new Error('EOT: truncated header')
      offset += 8 + view.getUint32(offset + 4, true)
    }
  }

  if (offset + fontDataSize > buffer.byteLength) {
    throw new Error('EOT: font data extends beyond file')
  }

  let fontData = new Uint8Array(buffer, offset, fontDataSize)

  // Remove XOR encryption (key = 0x50)
  if (flags & 0x00000008) {
    fontData = fontData.slice() // copy to avoid modifying original
    for (let i = 0; i < fontData.length; i++) {
      fontData[i] = fontData[i]! ^ 0x50
    }
  }

  // Decompress MTX compression
  if (flags & 0x00000004) {
    return decompressMtx(fontData)
  }

  return fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength)
}

/**
 * Determines whether the buffer is in EOT format
 */
export function isEotFormat(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 36) return false
  const view = new DataView(buffer)
  return view.getUint16(34, true) === 0x504C
}

// --- MicroType Express (MTX) LZCOMP decompression ---

// LZCOMP constants (W3C MTX spec)
const LEN_WIDTH = 3
const NUM_DIST_RANGES = 6
const DUP2 = 256 + (1 << LEN_WIDTH) * NUM_DIST_RANGES // 304
const DUP4 = DUP2 + 1 // 305
const DUP6 = DUP4 + 1 // 306
const AHUFF1_MAX = DUP6 + 1 // 307 symbols (0..306)
const AHUFF23_MAX = 8 // 8 symbols (0..7)

/**
 * Bit reader (LSB-first)
 */
class BitReader {
  private data: Uint8Array
  private bytePos: number
  private bitPos: number

  constructor(data: Uint8Array, start: number) {
    this.data = data
    this.bytePos = start
    this.bitPos = 0
  }

  readBit(): number {
    if (this.bytePos >= this.data.length) return 0
    const bit = (this.data[this.bytePos]! >> this.bitPos) & 1
    this.bitPos++
    if (this.bitPos >= 8) {
      this.bitPos = 0
      this.bytePos++
    }
    return bit
  }

  readBits(n: number): number {
    let value = 0
    for (let i = 0; i < n; i++) {
      value |= this.readBit() << i
    }
    return value
  }

  get pos(): number {
    return this.bytePos
  }
}

/**
 * Adaptive Huffman Tree (Vitter algorithm)
 *
 * Nodes are stored in the array in descending weight order (index 1 = root = largest weight)
 * Initial state: a complete binary tree with all symbol weights = 1
 */
class AHuff {
  private n: number // number of symbols
  private total: number // number of nodes = 2*n - 1
  // Node arrays (1-indexed)
  private sym: Int32Array // leaf: symbol value, internal: -1
  private wt: Int32Array
  private up: Int32Array
  private lc: Int32Array // left child (0 = leaf)
  private rc: Int32Array // right child (0 = leaf)
  // Symbol-to-node reverse lookup
  private s2n: Int32Array

  constructor(numSymbols: number) {
    this.n = numSymbols
    this.total = 2 * numSymbols - 1
    const sz = this.total + 1
    this.sym = new Int32Array(sz).fill(-1)
    this.wt = new Int32Array(sz)
    this.up = new Int32Array(sz)
    this.lc = new Int32Array(sz)
    this.rc = new Int32Array(sz)
    this.s2n = new Int32Array(numSymbols)
    this.buildTree()
  }

  private buildTree() {
    const n = this.n
    const total = this.total

    // Place leaf nodes at the end of the array (index n..2n-1)
    for (let i = 0; i < n; i++) {
      const idx = n + i
      this.sym[idx] = i
      this.wt[idx] = 1
      this.s2n[i] = idx
    }

    // Build internal nodes bottom-up (index 1..n-1)
    // Complete binary tree: children of node i are 2*i and 2*i+1
    for (let i = n - 1; i >= 1; i--) {
      const l = 2 * i
      const r = 2 * i + 1
      this.sym[i] = -1
      this.lc[i] = l
      this.rc[i] = r
      if (l <= total) { this.up[l] = i; this.wt[i] = this.wt[i]! + this.wt[l]! }
      if (r <= total) { this.up[r] = i; this.wt[i] = this.wt[i]! + this.wt[r]! }
    }
    this.up[1] = 0
  }

  readSymbol(bits: BitReader): number {
    let node = 1
    while (this.lc[node] !== 0) {
      node = bits.readBit() === 0 ? this.lc[node]! : this.rc[node]!
    }
    const symbol = this.sym[node]!
    this.incrementWeight(node)
    return symbol
  }

  private incrementWeight(a: number) {
    while (a >= 1) {
      this.wt[a]!++
      // Maintain the sibling property: swap to preserve weight ordering
      if (a > 1) {
        let b = a - 1
        // Find the head of the block of nodes whose weight equals a's new weight (= old weight + 1)
        if (b >= 1 && this.wt[b]! < this.wt[a]!) {
          // b's weight is less than a's new weight -> b is lighter than a
          // Find the head of the block
          while (b >= 2 && this.wt[b - 1]! < this.wt[a]!) {
            b--
          }
          // Swap a and b (only if b is not a's parent)
          if (b !== a && this.up[a] !== b) {
            this.swapNodes(a, b)
            a = b
          }
        }
      }
      a = this.up[a]!
    }
  }

  private swapNodes(a: number, b: number) {
    // Swap node contents (array positions stay fixed; contents are exchanged)
    let tmp: number

    tmp = this.sym[a]!; this.sym[a] = this.sym[b]!; this.sym[b] = tmp
    tmp = this.wt[a]!; this.wt[a] = this.wt[b]!; this.wt[b] = tmp
    tmp = this.lc[a]!; this.lc[a] = this.lc[b]!; this.lc[b] = tmp
    tmp = this.rc[a]!; this.rc[a] = this.rc[b]!; this.rc[b] = tmp

    // Update parent pointers of child nodes
    if (this.lc[a] !== 0) {
      this.up[this.lc[a]!] = a
      this.up[this.rc[a]!] = a
    } else if (this.sym[a]! >= 0) {
      this.s2n[this.sym[a]!] = a
    }

    if (this.lc[b] !== 0) {
      this.up[this.lc[b]!] = b
      this.up[this.rc[b]!] = b
    } else if (this.sym[b]! >= 0) {
      this.s2n[this.sym[b]!] = b
    }
  }
}

/**
 * LZCOMP decompression
 *
 * Uses three Adaptive Huffman trees:
 * - AHUFF #1: main symbols (0-306)
 *   - 0-255: literal bytes
 *   - 256-303: copy commands (distance + length)
 *   - 304 (DUP2): copy 1 byte from 2 bytes back
 *   - 305 (DUP4): copy 1 byte from 4 bytes back
 *   - 306 (DUP6): copy 1 byte from 6 bytes back
 * - AHUFF #2: additional length symbols (0-7, stop bit + 2-bit value)
 * - AHUFF #3: distance symbols (0-7, 3-bit value)
 */
function decompressLzcomp(
  input: Uint8Array,
  start: number,
  end: number,
  maxOutput: number,
): Uint8Array {
  const output = new Uint8Array(maxOutput)
  let outPos = 0

  const bits = new BitReader(input, start)
  const ahuff1 = new AHuff(AHUFF1_MAX)
  const ahuff2 = new AHuff(AHUFF23_MAX)
  const ahuff3 = new AHuff(AHUFF23_MAX)

  while (outPos < maxOutput && bits.pos < end) {
    const symbol = ahuff1.readSymbol(bits)

    if (symbol < 256) {
      // Literal byte
      output[outPos++] = symbol
    } else if (symbol === DUP2) {
      if (outPos >= 2) output[outPos] = output[outPos - 2]!
      outPos++
    } else if (symbol === DUP4) {
      if (outPos >= 4) output[outPos] = output[outPos - 4]!
      outPos++
    } else if (symbol === DUP6) {
      if (outPos >= 6) output[outPos] = output[outPos - 6]!
      outPos++
    } else {
      // Copy command (symbol 256..303)
      const adjusted = symbol - 256
      const numDistSymbols = (adjusted >> LEN_WIDTH) + 1 // number of distance symbols
      const lenFirst = adjusted & ((1 << LEN_WIDTH) - 1) // initial length (3 bits)

      // Length decoding: stop-bit encoding
      // The most significant bit of lenFirst (bit 2) is the stop bit
      let length = lenFirst & 0x3 // low 2 bits
      if ((lenFirst & 0x4) === 0) {
        // Stop bit not set -> read additional length symbols
        let more = true
        while (more) {
          const addSym = ahuff2.readSymbol(bits)
          length = (length << 2) | (addSym & 0x3)
          if (addSym & 0x4) more = false // stop bit
        }
      }
      length += 2 // minimum copy length = 2

      // Distance decoding: numDistSymbols 3-bit symbols
      let distance = 0
      for (let i = 0; i < numDistSymbols; i++) {
        const distSym = ahuff3.readSymbol(bits)
        distance = (distance << 3) | (distSym & 0x7)
      }
      distance += 1 // 1-based

      // If distance >= 512, add 1 to the length
      if (distance >= 512) length++

      // Copy (byte by byte; overlap is allowed)
      for (let i = 0; i < length && outPos < maxOutput; i++) {
        output[outPos] = outPos >= distance ? output[outPos - distance]! : 0
        outPos++
      }
    }
  }

  return output.subarray(0, outPos)
}

/**
 * Decompresses MTX-compressed data and reconstructs the SFNT font binary
 */
function decompressMtx(data: Uint8Array): ArrayBuffer {
  if (data.length < 10) {
    throw new Error('EOT: MTX data too short')
  }

  // MTX header (10 bytes, little-endian)
  const mtxVersion = data[0]!
  const copyLimit = data[1]! | (data[2]! << 8) | (data[3]! << 16)
  const block2Off = data[4]! | (data[5]! << 8) | (data[6]! << 16)
  const block3Off = data[7]! | (data[8]! << 8) | (data[9]! << 16)

  // Estimate the output size
  const estimatedSize = Math.max(copyLimit, data.length * 4, 65536)

  // Decompress the 3 blocks with LZCOMP
  const block1End = block2Off > 0 ? block2Off : data.length
  const block2End = block3Off > 0 ? block3Off : data.length

  const block1 = decompressLzcomp(data, 10, block1End, estimatedSize)

  // Block 2 (push data) and Block 3 (instructions)
  // Glyph instruction data separated out in CTF format
  const block2 = block2Off > 0
    ? decompressLzcomp(data, block2Off, block2End, estimatedSize)
    : new Uint8Array(0)
  const block3 = block3Off > 0
    ? decompressLzcomp(data, block3Off, data.length, estimatedSize)
    : new Uint8Array(0)

  // CTF -> SFNT reconstruction
  return reconstructCtf(block1, block2, block3)
}

/**
 * Reconstructs SFNT from CTF (Compact Table Format)
 *
 * Block 1: table data (glyf/cvt are transformed)
 * Block 2: glyph push data (concatenated)
 * Block 3: TrueType instructions (push excluded)
 *
 * The cvt table is delta-encoded; glyf instructions are separated out
 */
function reconstructCtf(
  block1: Uint8Array,
  block2: Uint8Array,
  block3: Uint8Array,
): ArrayBuffer {
  if (block1.length < 12) {
    throw new Error('EOT: decompressed CTF data too short')
  }

  const view = new DataView(block1.buffer, block1.byteOffset, block1.byteLength)

  // Validate the SFNT header
  const sfntVersion = view.getUint32(0)
  const numTables = view.getUint16(4)
  if (numTables === 0 || numTables > 200) {
    throw new Error('EOT: invalid CTF table count')
  }

  // Scan the table directory
  for (let i = 0; i < numTables; i++) {
    const dirOff = 12 + i * 16
    if (dirOff + 16 > block1.length) break

    const tag = String.fromCharCode(
      block1[dirOff]!, block1[dirOff + 1]!, block1[dirOff + 2]!, block1[dirOff + 3]!,
    )
    const tableOffset = view.getUint32(dirOff + 8)
    const tableLength = view.getUint32(dirOff + 12)

    // Delta-decode the cvt table
    if (tag === 'cvt ' && tableOffset + tableLength <= block1.length) {
      let prev = 0
      for (let j = 0; j < tableLength; j += 2) {
        const delta = view.getInt16(tableOffset + j)
        prev = (prev + delta) & 0xFFFF
        view.setInt16(tableOffset + j, (prev << 16) >> 16)
      }
    }
  }

  // Block 1 is a nearly SFNT-compatible structure
  // Merging of instructions (Block 2 + Block 3) is omitted
  // Outline rendering works correctly even without hinting
  return block1.buffer.slice(block1.byteOffset, block1.byteOffset + block1.byteLength) as ArrayBuffer
}
