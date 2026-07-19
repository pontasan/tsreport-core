/**
 * CCITT Group 3 / Group 4 (ITU-T T.4 / T.6) facsimile decoding.
 *
 * Produces packed 1-bit-per-pixel rows (MSB first, `ceil(columns / 8)` bytes
 * per row). Used both by the PDF /CCITTFaxDecode filter and by JBIG2 MMR-coded
 * regions (JBIG2 MMR is exactly T.6 two-dimensional coding).
 */

export interface CcittCode {
  run: number
  terminal: boolean
}

export interface CcittFaxDecodeOptions {
  k: number
  columns: number
  rows: number
  endOfLine: boolean
  encodedByteAlign: boolean
  endOfBlock: boolean
  blackIs1: boolean
  damagedRowsBeforeError: number
}

/** Decode a PDF CCITTFaxDecode stream with the complete PDF parameter model. */
export function decodeCcittFaxData(data: Uint8Array, options: CcittFaxDecodeOptions): Uint8Array {
  const rowBytes = Math.ceil(options.columns / 8)
  const reader = new CcittBitReader(data)
  const out: number[] = []
  let referenceChanges: number[] = [options.columns]
  let previousRow: number[] | null = null
  let previousRowDamaged = false
  let damagedRows = 0
  let eolAlreadyConsumed = false
  let row = 0

  while (options.endOfBlock || options.rows === 0 || row < options.rows) {
    if (reader.onlyBytePaddingRemains()) break
    if (options.endOfBlock && reader.tryConsumeEndOfBlock(options.k)) {
      reader.alignByte()
      break
    }

    if (options.encodedByteAlign && !eolAlreadyConsumed) reader.alignByte()
    let gotEol = eolAlreadyConsumed
    eolAlreadyConsumed = false
    if (options.k >= 0 && !gotEol) gotEol = reader.tryConsumeEol()
    if (options.k >= 0 && options.endOfLine && !gotEol) {
      throw new Error('PDF parse error: missing required CCITTFaxDecode EOL')
    }

    let oneDimensional = options.k === 0
    if (options.k > 0) {
      const tag = reader.readBit()
      if (tag < 0) throw new Error('PDF parse error: missing CCITTFaxDecode EOL tag')
      oneDimensional = tag === 1
    }

    const rowOut = new Array<number>(rowBytes).fill(0)
    try {
      const changes = oneDimensional
        ? decodeCcittOneDimensionalRow(reader, rowOut, 0, options.columns, options.blackIs1)
        : decodeCcittTwoDimensionalRow(reader, rowOut, 0, options.columns, options.blackIs1, referenceChanges)
      for (let i = 0; i < rowBytes; i++) out.push(rowOut[i]!)
      referenceChanges = changes
      previousRow = rowOut
      previousRowDamaged = false
    } catch (error) {
      if (options.k < 0 || !options.endOfLine || damagedRows >= options.damagedRowsBeforeError) throw error
      if (!reader.findNextEol()) throw error
      damagedRows++
      eolAlreadyConsumed = true
      const replacement: number[] = previousRow !== null && !previousRowDamaged
        ? previousRow.slice()
        : Array.from(createCcittWhiteRow(rowBytes, options.columns, options.blackIs1))
      for (let i = 0; i < rowBytes; i++) out.push(replacement[i]!)
      referenceChanges = previousRow !== null && !previousRowDamaged ? referenceChanges : [options.columns]
      previousRow = replacement
      previousRowDamaged = true
    }
    row++
  }
  return new Uint8Array(out)
}

function createCcittWhiteRow(rowBytes: number, columns: number, blackIs1: boolean): Uint8Array {
  const row = new Uint8Array(rowBytes)
  if (blackIs1) return row
  row.fill(0xFF)
  const remainder = columns & 7
  if (remainder !== 0) row[rowBytes - 1] = 0xFF << (8 - remainder)
  return row
}

/** Decode a Group 4 (T.6, pure two-dimensional) stream. */
/**
 * Signals a damaged row: a reserved extension type (T.4 §4.2.1.3 defines only
 * type 111 = uncompressed mode), an invalid run code, or an invalid 2D mode.
 * The PDF filter catches this only when DamagedRowsBeforeError authorizes the
 * EOL-based recovery procedure.
 */
class CcittExtensionMode extends Error {}

export function decodeCcittGroup4(data: Uint8Array, columns: number, rows: number, blackIs1: boolean): Uint8Array {
  return decodeCcittFaxData(data, {
    k: -1,
    columns,
    rows,
    endOfLine: false,
    encodedByteAlign: false,
    endOfBlock: false,
    blackIs1,
    damagedRowsBeforeError: 0,
  })
}

/**
 * Decode one Group 4 (T.6) bitplane of `rows` rows from a shared bit reader,
 * consume the terminating EOFB, then advance to the next byte boundary.
 * JBIG2 forces each Annex C.5 MMR bitplane to consume an integral number of
 * bytes after the two T.6 EOL code words.
 */
export function decodeCcittGroup4Plane(reader: CcittBitReader, columns: number, rows: number, blackIs1: boolean): Uint8Array {
  const rowBytes = Math.ceil(columns / 8)
  const out: number[] = []
  let referenceChanges: number[] = [columns]
  for (let row = 0; row < rows; row++) {
    const rowStart = out.length
    for (let i = 0; i < rowBytes; i++) out.push(0)
    referenceChanges = decodeCcittTwoDimensionalRow(reader, out, rowStart, columns, blackIs1, referenceChanges)
  }
  reader.skipEol()
  reader.skipEol()
  reader.alignByte()
  return new Uint8Array(out)
}

/** Decode a Group 3 two-dimensional (T.4, K > 0) stream. */
export function decodeCcittGroup3TwoDimensional(
  data: Uint8Array,
  columns: number,
  rows: number,
  k: number,
  encodedByteAlign: boolean,
  endOfLine: boolean,
  blackIs1: boolean,
): Uint8Array {
  return decodeCcittFaxData(data, {
    k,
    columns,
    rows,
    endOfLine,
    encodedByteAlign,
    endOfBlock: false,
    blackIs1,
    damagedRowsBeforeError: 0,
  })
}

export function decodeCcittOneDimensionalRow(
  reader: CcittBitReader,
  out: number[],
  rowStart: number,
  columns: number,
  blackIs1: boolean,
): number[] {
  const changes: number[] = []
  let x = 0
  let white = true
  while (x < columns) {
    const run = readCcittRun(reader, white)
    if (run < 0) {
      // Uncompressed-mode entry (T.4 §4.2.1.3.1 code 000000001111). Drop the
      // speculative changing element pushed at the previous run's end: the
      // literal pixels decide whether a transition really occurs at x.
      if (changes.length > 0 && changes[changes.length - 1] === x) changes.pop()
      const end = decodeCcittUncompressedSegment(reader, out, rowStart, x, columns, blackIs1, changes)
      x = end.pos
      white = !end.nextBlack
      continue
    }
    const x1 = x + run
    if (x1 > columns) throw new Error('PDF parse error: CCITTFaxDecode run exceeds row width')
    writeCcittSegment(out, rowStart, x, x1, !white, blackIs1)
    if (x1 < columns) changes.push(x1)
    x = x1
    white = !white
  }
  changes.push(columns)
  return changes
}

export function decodeCcittTwoDimensionalRow(
  reader: CcittBitReader,
  out: number[],
  rowStart: number,
  columns: number,
  blackIs1: boolean,
  referenceChanges: number[],
): number[] {
  const currentChanges: number[] = []
  let a0 = 0
  let black = false
  while (a0 < columns) {
    const mode = readCcitt2dMode(reader)
    if (mode.kind === 'pass') {
      const b1 = ccittB1(referenceChanges, a0, black)
      const b2 = ccittB2(referenceChanges, b1, columns)
      writeCcittSegment(out, rowStart, a0, b2, black, blackIs1)
      a0 = b2
    } else if (mode.kind === 'horizontal') {
      const run1 = readCcittRun(reader, !black)
      if (run1 < 0) throw new CcittExtensionMode('invalid CCITTFaxDecode code')
      const a1 = a0 + run1
      if (a1 > columns) throw new CcittExtensionMode('CCITTFaxDecode run exceeds row width')
      writeCcittSegment(out, rowStart, a0, a1, black, blackIs1)
      if (a1 < columns) currentChanges.push(a1)
      const run2 = readCcittRun(reader, black)
      if (run2 < 0) throw new CcittExtensionMode('invalid CCITTFaxDecode code')
      const a2 = a1 + run2
      if (a2 > columns) throw new CcittExtensionMode('CCITTFaxDecode run exceeds row width')
      writeCcittSegment(out, rowStart, a1, a2, !black, blackIs1)
      if (a2 < columns) currentChanges.push(a2)
      a0 = a2
    } else if (mode.kind === 'uncompressed') {
      // Uncompressed-mode extension (T.6 §2.2.4 / T.4 §4.2.1.3 code
      // 0000001 111). Drop the speculative changing element pushed at the
      // previous run's end: the literal pixels decide whether a transition
      // really occurs at a0.
      if (currentChanges.length > 0 && currentChanges[currentChanges.length - 1] === a0) currentChanges.pop()
      const end = decodeCcittUncompressedSegment(reader, out, rowStart, a0, columns, blackIs1, currentChanges)
      a0 = end.pos
      black = end.nextBlack
    } else {
      const b1 = ccittB1(referenceChanges, a0, black)
      const a1 = b1 + mode.delta
      if (a1 < a0 || a1 > columns) throw new CcittExtensionMode('invalid CCITTFaxDecode vertical offset')
      writeCcittSegment(out, rowStart, a0, a1, black, blackIs1)
      if (a1 < columns) currentChanges.push(a1)
      a0 = a1
      black = !black
    }
  }
  currentChanges.push(columns)
  return currentChanges
}

type Ccitt2dMode =
  | { kind: 'pass' }
  | { kind: 'horizontal' }
  | { kind: 'uncompressed' }
  | { kind: 'vertical'; delta: -3 | -2 | -1 | 0 | 1 | 2 | 3 }

function readCcitt2dMode(reader: CcittBitReader): Ccitt2dMode {
  let code = 0
  for (let len = 1; len <= 7; len++) {
    const bit = reader.readBit()
    if (bit < 0) throw new Error('PDF parse error: truncated CCITTFaxDecode data')
    code = (code << 1) | bit
    if (len === 1 && code === 0b1) return { kind: 'vertical', delta: 0 }
    if (len === 3) {
      if (code === 0b011) return { kind: 'vertical', delta: 1 }
      if (code === 0b010) return { kind: 'vertical', delta: -1 }
      if (code === 0b001) return { kind: 'horizontal' }
    } else if (len === 4 && code === 0b0001) {
      return { kind: 'pass' }
    } else if (len === 6) {
      if (code === 0b000011) return { kind: 'vertical', delta: 2 }
      if (code === 0b000010) return { kind: 'vertical', delta: -2 }
    } else if (len === 7) {
      if (code === 0b0000011) return { kind: 'vertical', delta: 3 }
      if (code === 0b0000010) return { kind: 'vertical', delta: -3 }
      if (code === 0b0000001) {
        // Extension code: three type bits follow. Type 111 selects
        // uncompressed mode (T.4 §4.2.1.3); the other types are reserved.
        let type = 0
        for (let i = 0; i < 3; i++) {
          const b = reader.readBit()
          if (b < 0) throw new Error('PDF parse error: truncated CCITTFaxDecode data')
          type = (type << 1) | b
        }
        if (type === 0b111) return { kind: 'uncompressed' }
        throw new CcittExtensionMode('reserved CCITTFaxDecode extension type')
      }
    }
  }
  throw new CcittExtensionMode('invalid CCITTFaxDecode two-dimensional mode')
}

interface CcittUncompressedEnd { pos: number; nextBlack: boolean }

/**
 * Decode an uncompressed-mode segment (T.4 §4.2.1.3.2). Image bits follow
 * literally (0 = white, 1 = black) packed with the uncompressed code table:
 * n zeros + 1 (n ≤ 4) codes n white pixels and a black one, 000001 codes five
 * white pixels, and an exit code (six to ten zeros, a one, then the colour
 * bit t) codes zero to four white pixels and gives the colour of the next
 * run so normal coding can resume. Colour transitions are appended to
 * `changes` so the changing-element list stays consistent with the actual
 * pixels for the next row's reference line. Pixels a malformed segment pushes
 * past the row width are clamped, matching the other run clamps above.
 */
function decodeCcittUncompressedSegment(
  reader: CcittBitReader,
  out: number[],
  rowStart: number,
  start: number,
  columns: number,
  blackIs1: boolean,
  changes: number[],
): CcittUncompressedEnd {
  let pos = start
  let lastBlack = start > 0 ? readCcittPixelIsBlack(out, rowStart, start - 1, blackIs1) : false
  for (;;) {
    let zeros = 0
    let bit = reader.readBit()
    while (bit === 0) {
      zeros++
      if (zeros > 10) throw new CcittExtensionMode('invalid CCITTFaxDecode uncompressed code')
      bit = reader.readBit()
    }
    if (bit < 0) throw new Error('PDF parse error: truncated CCITTFaxDecode data')
    const whites = zeros >= 6 ? zeros - 6 : Math.min(zeros, 5)
    for (let i = 0; i < whites; i++) {
      if (pos < columns) {
        if (lastBlack) { changes.push(pos); lastBlack = false }
        writeCcittSegment(out, rowStart, pos, pos + 1, false, blackIs1)
      }
      pos++
    }
    if (zeros >= 6) {
      const t = reader.readBit()
      if (t < 0) throw new Error('PDF parse error: truncated CCITTFaxDecode data')
      const nextBlack = t === 1
      if (pos < columns && nextBlack !== lastBlack) changes.push(pos)
      return { pos, nextBlack }
    }
    if (zeros <= 4) {
      if (pos < columns) {
        if (!lastBlack) { changes.push(pos); lastBlack = true }
        writeCcittSegment(out, rowStart, pos, pos + 1, true, blackIs1)
      }
      pos++
    }
  }
}

function readCcittPixelIsBlack(out: number[], rowStart: number, x: number, blackIs1: boolean): boolean {
  const bit = (out[rowStart + (x >> 3)]! >> (7 - (x & 7))) & 1
  return blackIs1 ? bit === 1 : bit === 0
}

function ccittB1(referenceChanges: number[], a0: number, black: boolean): number {
  let color: boolean = false
  for (let i = 0; i < referenceChanges.length; i++) {
    const pos = referenceChanges[i]!
    const after: boolean = !color
    if ((pos > a0 || (a0 === 0 && pos === 0)) && after === !black) return pos
    color = after
  }
  return referenceChanges[referenceChanges.length - 1]!
}

function ccittB2(referenceChanges: number[], b1: number, columns: number): number {
  for (let i = 0; i < referenceChanges.length; i++) {
    const pos = referenceChanges[i]!
    if (pos > b1) return pos
  }
  return columns
}

function writeCcittSegment(out: number[], rowStart: number, x0: number, x1: number, black: boolean, blackIs1: boolean): void {
  const bit = black ? (blackIs1 ? 1 : 0) : (blackIs1 ? 0 : 1)
  for (let x = x0; x < x1; x++) writeCcittPixel(out, rowStart, x, bit)
}

/**
 * Read one run length, or -1 for the uncompressed-mode entry code word
 * 000000001111 (T.4 §4.2.1.3.1) when it appears in place of a run code.
 */
function readCcittRun(reader: CcittBitReader, white: boolean): number {
  let run = 0
  const table = white ? CCITT_WHITE_CODES : CCITT_BLACK_CODES
  for (;;) {
    let code = 0
    let matchedMakeup = false
    for (let len = 1; len <= CCITT_MAX_CODE_BITS; len++) {
      const bit = reader.readBit()
      if (bit < 0) throw new Error('PDF parse error: truncated CCITTFaxDecode data')
      code = (code << 1) | bit
      const entry = table.get(ccittKey(len, code))
      if (entry === undefined) continue
      if (entry.run < 0) {
        // Uncompressed-mode entry replaces a complete code word; after a
        // make-up code a terminating code must follow instead.
        if (run !== 0) throw new CcittExtensionMode('invalid CCITTFaxDecode code')
        return -1
      }
      run += entry.run
      if (entry.terminal) return run
      matchedMakeup = true
      break
    }
    if (!matchedMakeup) throw new CcittExtensionMode('invalid CCITTFaxDecode code')
  }
}

function writeCcittPixel(out: number[], rowStart: number, x: number, bit: number): void {
  if (bit === 0) return
  out[rowStart + (x >> 3)] = out[rowStart + (x >> 3)]! | (0x80 >> (x & 7))
}

function ccittKey(len: number, code: number): number {
  return (len << 16) | code
}

function buildCcittCodeMap(terminating: Array<[number, string]>, makeup: Array<[number, string]>): Map<number, CcittCode> {
  const map = new Map<number, CcittCode>()
  for (let i = 0; i < terminating.length; i++) {
    const entry = terminating[i]!
    map.set(ccittKey(entry[1].length, parseInt(entry[1], 2)), { run: entry[0], terminal: true })
  }
  for (let i = 0; i < makeup.length; i++) {
    const entry = makeup[i]!
    map.set(ccittKey(entry[1].length, parseInt(entry[1], 2)), { run: entry[0], terminal: false })
  }
  return map
}

export class CcittBitReader {
  private readonly data: Uint8Array
  private bitPos = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  hasBits(): boolean {
    return this.bitPos < this.data.length * 8
  }

  get position(): number { return this.bitPos }

  onlyBytePaddingRemains(): boolean {
    const remaining = this.data.length * 8 - this.bitPos
    if (remaining === 0) return true
    if (remaining > 7) return false
    for (let pos = this.bitPos; pos < this.data.length * 8; pos++) {
      if (((this.data[pos >> 3]! >> (7 - (pos & 7))) & 1) !== 0) return false
    }
    return true
  }

  readBit(): number {
    if (!this.hasBits()) return -1
    const byte = this.data[this.bitPos >> 3]!
    const bit = (byte >> (7 - (this.bitPos & 7))) & 1
    this.bitPos++
    return bit
  }

  alignByte(): void {
    const rem = this.bitPos & 7
    if (rem !== 0) this.bitPos += 8 - rem
  }

  tryConsumeEol(): boolean {
    const start = this.bitPos
    let zeros = 0
    for (;;) {
      const bit = this.readBit()
      if (bit < 0) {
        this.bitPos = start
        return false
      }
      if (bit === 0) {
        zeros++
      } else if (zeros >= 11) {
        return true
      } else {
        this.bitPos = start
        return false
      }
    }
  }

  findNextEol(): boolean {
    let zeros = 0
    while (this.hasBits()) {
      const bit = this.readBit()
      if (bit === 0) {
        zeros++
      } else {
        if (zeros >= 11) return true
        zeros = 0
      }
    }
    return false
  }

  tryConsumeEndOfBlock(k: number): boolean {
    const start = this.bitPos
    const count = k < 0 ? 2 : 6
    for (let i = 0; i < count; i++) {
      if (!this.tryConsumeEol()) {
        this.bitPos = start
        return false
      }
      if (k > 0) {
        const tag = this.readBit()
        if (tag !== 1) {
          this.bitPos = start
          return false
        }
      }
    }
    return true
  }

  skipEol(): void {
    let zeros = 0
    for (;;) {
      const bit = this.readBit()
      if (bit < 0) throw new Error('PDF parse error: missing CCITTFaxDecode EOL')
      if (bit === 0) {
        zeros++
      } else if (zeros >= 11) {
        return
      } else {
        throw new Error('PDF parse error: invalid CCITTFaxDecode EOL')
      }
    }
  }
}

const CCITT_MAX_CODE_BITS = 13

// Uncompressed-mode entry in one-dimensional coding (T.4 §4.2.1.3.1). The
// code word is colour-independent and prefix-free against both run tables;
// the -1 sentinel run is returned as-is by readCcittRun.
const CCITT_UNCOMPRESSED_ENTRY: Array<[number, string]> = [[-1, '000000001111']]

const CCITT_ADDITIONAL_MAKEUP: Array<[number, string]> = [
  [1792, '00000001000'], [1856, '00000001100'], [1920, '00000001101'], [1984, '000000010010'],
  [2048, '000000010011'], [2112, '000000010100'], [2176, '000000010101'], [2240, '000000010110'],
  [2304, '000000010111'], [2368, '000000011100'], [2432, '000000011101'], [2496, '000000011110'],
  [2560, '000000011111'],
]

const CCITT_WHITE_CODES = buildCcittCodeMap([
  [0, '00110101'], [1, '000111'], [2, '0111'], [3, '1000'], [4, '1011'], [5, '1100'], [6, '1110'], [7, '1111'],
  [8, '10011'], [9, '10100'], [10, '00111'], [11, '01000'], [12, '001000'], [13, '000011'], [14, '110100'], [15, '110101'],
  [16, '101010'], [17, '101011'], [18, '0100111'], [19, '0001100'], [20, '0001000'], [21, '0010111'], [22, '0000011'], [23, '0000100'],
  [24, '0101000'], [25, '0101011'], [26, '0010011'], [27, '0100100'], [28, '0011000'], [29, '00000010'], [30, '00000011'], [31, '00011010'],
  [32, '00011011'], [33, '00010010'], [34, '00010011'], [35, '00010100'], [36, '00010101'], [37, '00010110'], [38, '00010111'], [39, '00101000'],
  [40, '00101001'], [41, '00101010'], [42, '00101011'], [43, '00101100'], [44, '00101101'], [45, '00000100'], [46, '00000101'], [47, '00001010'],
  [48, '00001011'], [49, '01010010'], [50, '01010011'], [51, '01010100'], [52, '01010101'], [53, '00100100'], [54, '00100101'], [55, '01011000'],
  [56, '01011001'], [57, '01011010'], [58, '01011011'], [59, '01001010'], [60, '01001011'], [61, '00110010'], [62, '00110011'], [63, '00110100'],
  ...CCITT_UNCOMPRESSED_ENTRY,
], [
  [64, '11011'], [128, '10010'], [192, '010111'], [256, '0110111'], [320, '00110110'], [384, '00110111'], [448, '01100100'], [512, '01100101'],
  [576, '01101000'], [640, '01100111'], [704, '011001100'], [768, '011001101'], [832, '011010010'], [896, '011010011'], [960, '011010100'], [1024, '011010101'],
  [1088, '011010110'], [1152, '011010111'], [1216, '011011000'], [1280, '011011001'], [1344, '011011010'], [1408, '011011011'], [1472, '010011000'], [1536, '010011001'],
  [1600, '010011010'], [1664, '011000'], [1728, '010011011'], ...CCITT_ADDITIONAL_MAKEUP,
])

const CCITT_BLACK_CODES = buildCcittCodeMap([
  [0, '0000110111'], [1, '010'], [2, '11'], [3, '10'], [4, '011'], [5, '0011'], [6, '0010'], [7, '00011'],
  [8, '000101'], [9, '000100'], [10, '0000100'], [11, '0000101'], [12, '0000111'], [13, '00000100'], [14, '00000111'], [15, '000011000'],
  [16, '0000010111'], [17, '0000011000'], [18, '0000001000'], [19, '00001100111'], [20, '00001101000'], [21, '00001101100'], [22, '00000110111'], [23, '00000101000'],
  [24, '00000010111'], [25, '00000011000'], [26, '000011001010'], [27, '000011001011'], [28, '000011001100'], [29, '000011001101'], [30, '000001101000'], [31, '000001101001'],
  [32, '000001101010'], [33, '000001101011'], [34, '000011010010'], [35, '000011010011'], [36, '000011010100'], [37, '000011010101'], [38, '000011010110'], [39, '000011010111'],
  [40, '000001101100'], [41, '000001101101'], [42, '000011011010'], [43, '000011011011'], [44, '000001010100'], [45, '000001010101'], [46, '000001010110'], [47, '000001010111'],
  [48, '000001100100'], [49, '000001100101'], [50, '000001010010'], [51, '000001010011'], [52, '000000100100'], [53, '000000110111'], [54, '000000111000'], [55, '000000100111'],
  [56, '000000101000'], [57, '000001011000'], [58, '000001011001'], [59, '000000101011'], [60, '000000101100'], [61, '000001011010'], [62, '000001100110'], [63, '000001100111'],
  ...CCITT_UNCOMPRESSED_ENTRY,
], [
  [64, '0000001111'], [128, '000011001000'], [192, '000011001001'], [256, '000001011011'], [320, '000000110011'], [384, '000000110100'], [448, '000000110101'], [512, '0000001101100'],
  [576, '0000001101101'], [640, '0000001001010'], [704, '0000001001011'], [768, '0000001001100'], [832, '0000001001101'], [896, '0000001110010'], [960, '0000001110011'], [1024, '0000001110100'],
  [1088, '0000001110101'], [1152, '0000001110110'], [1216, '0000001110111'], [1280, '0000001010010'], [1344, '0000001010011'], [1408, '0000001010100'], [1472, '0000001010101'], [1536, '0000001011010'],
  [1600, '0000001011011'], [1664, '0000001100100'], [1728, '0000001100101'], ...CCITT_ADDITIONAL_MAKEUP,
])
