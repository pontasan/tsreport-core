/**
 * Barcode generation module
 *
 * Converts data in various barcode formats into vector drawing commands (RenderNode).
 * Everything is drawn as vectors (RenderRect / RenderLine / RenderText).
 */

import type { RenderNode, RenderGroup, RenderRect, RenderText } from '../types/render.js'
import { generateDataMatrix } from './barcode-datamatrix.js'
import { renderPDF417 } from './barcode-pdf417.js'

export interface BarcodeOptions {
  x: number
  y: number
  width: number
  height: number
  showText?: boolean
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
}

/**
 * Generate a RenderNode that draws a barcode
 */
export function renderBarcode(
  barcodeType: string,
  data: string,
  options: BarcodeOptions,
): RenderNode {
  const type = barcodeType.toLowerCase()
  switch (type) {
    case 'code39':
      return renderCode39(data, options)
    case 'code128':
      return renderCode128(data, options)
    case 'ean13':
    case 'ean-13':
      return renderEAN13(data, options)
    case 'ean8':
    case 'ean-8':
      return renderEAN8(data, options)
    case 'qrcode':
    case 'qr':
      return renderQRCode(data, options)
    case 'datamatrix':
    case 'data-matrix':
      return renderDataMatrix(data, options)
    case 'pdf417':
      return renderPDF417Barcode(data, options)
    case 'upca':
    case 'upc-a':
      return renderUPCA(data, options)
    case 'upce':
    case 'upc-e':
      return renderUPCE(data, options)
    case 'itf':
    case 'interleaved2of5':
      return renderITF(data, options)
    case 'codabar':
      return renderCodabar(data, options)
    case 'code93':
      return renderCode93(data, options)
    case 'msi':
      return renderMSI(data, options)
    default:
      // Unsupported types are shown as a placeholder
      return renderPlaceholder(barcodeType, data, options)
  }
}

// ─── Code 39 ───

const CODE39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*'
const CODE39_PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
  'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
  'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
  'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
  'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
  'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
}

function renderCode39(data: string, options: BarcodeOptions): RenderGroup {
  const upper = data.toUpperCase()
  const encoded = '*' + upper + '*'

  // Convert patterns into a list of bars
  const bars: boolean[] = []
  for (let i = 0; i < encoded.length; i++) {
    const pattern = CODE39_PATTERNS[encoded[i]!]
    if (!pattern) continue
    for (let j = 0; j < pattern.length; j++) {
      const isWide = pattern[j] === 'w'
      const isBar = j % 2 === 0 // even position = bar, odd position = space
      const count = isWide ? 3 : 1
      for (let k = 0; k < count; k++) {
        bars.push(isBar)
      }
    }
    // Inter-character space
    if (i < encoded.length - 1) {
      bars.push(false)
    }
  }

  return barsToRenderGroup(bars, data, options)
}

// ─── Code 128 ───

const CODE128_START_B = 104
const CODE128_STOP = 106

// Code 128 patterns (each pattern has 6 elements: bar/space widths)
const CODE128_PATTERNS: number[][] = [
  [2,1,2,2,2,2], [2,2,2,1,2,2], [2,2,2,2,2,1], [1,2,1,2,2,3], [1,2,1,3,2,2], // 0-4
  [1,3,1,2,2,2], [1,2,2,2,1,3], [1,2,2,3,1,2], [1,3,2,2,1,2], [2,2,1,2,1,3], // 5-9
  [2,2,1,3,1,2], [2,3,1,2,1,2], [1,1,2,2,3,2], [1,2,2,1,3,2], [1,2,2,2,3,1], // 10-14
  [1,1,3,2,2,2], [1,2,3,1,2,2], [1,2,3,2,2,1], [2,2,3,2,1,1], [2,2,1,1,3,2], // 15-19
  [2,2,1,2,3,1], [2,1,3,2,1,2], [2,2,3,1,1,2], [3,1,2,1,3,1], [3,1,1,2,2,2], // 20-24
  [3,2,1,1,2,2], [3,2,1,2,2,1], [3,1,2,2,1,2], [3,2,2,1,1,2], [3,2,2,2,1,1], // 25-29
  [2,1,2,1,2,3], [2,1,2,3,2,1], [2,3,2,1,2,1], [1,1,1,3,2,3], [1,3,1,1,2,3], // 30-34
  [1,3,1,3,2,1], [1,1,2,3,1,3], [1,3,2,1,1,3], [1,3,2,3,1,1], [2,1,1,3,1,3], // 35-39
  [2,3,1,1,1,3], [2,3,1,3,1,1], [1,1,2,1,3,3], [1,1,2,3,3,1], [1,3,2,1,3,1], // 40-44
  [1,1,3,1,2,3], [1,1,3,3,2,1], [1,3,3,1,2,1], [3,1,3,1,2,1], [2,1,1,3,3,1], // 45-49
  [2,3,1,1,3,1], [2,1,3,1,1,3], [2,1,3,3,1,1], [2,1,3,1,3,1], [3,1,1,1,2,3], // 50-54
  [3,1,1,3,2,1], [3,3,1,1,2,1], [3,1,2,1,1,3], [3,1,2,3,1,1], [3,3,2,1,1,1], // 55-59
  [3,1,4,1,1,1], [2,2,1,4,1,1], [4,3,1,1,1,1], [1,1,1,2,2,4], [1,1,1,4,2,2], // 60-64
  [1,2,1,1,2,4], [1,2,1,4,2,1], [1,4,1,1,2,2], [1,4,1,2,2,1], [1,1,2,2,1,4], // 65-69
  [1,1,2,4,1,2], [1,2,2,1,1,4], [1,2,2,4,1,1], [1,4,2,1,1,2], [1,4,2,2,1,1], // 70-74
  [2,4,1,2,1,1], [2,2,1,1,1,4], [4,1,3,1,1,1], [2,4,1,1,1,2], [1,3,4,1,1,1], // 75-79
  [1,1,1,2,4,2], [1,2,1,1,4,2], [1,2,1,2,4,1], [1,1,4,2,1,2], [1,2,4,1,1,2], // 80-84
  [1,2,4,2,1,1], [4,1,1,2,1,2], [4,2,1,1,1,2], [4,2,1,2,1,1], [2,1,2,1,4,1], // 85-89
  [2,1,4,1,2,1], [4,1,2,1,2,1], [1,1,1,1,4,3], [1,1,1,3,4,1], [1,3,1,1,4,1], // 90-94
  [1,1,4,1,1,3], [1,1,4,3,1,1], [4,1,1,1,1,3], [4,1,1,3,1,1], [1,1,3,1,4,1], // 95-99
  [1,1,4,1,3,1], [3,1,1,1,4,1], [4,1,1,1,3,1], [2,1,1,4,1,2], [2,1,1,2,1,4], // 100-104
  [2,1,1,2,3,2], [2,3,3,1,1,1,2],                                                // 105-106
]

function renderCode128(data: string, options: BarcodeOptions): RenderGroup {
  // Code 128B encoding
  const values: number[] = [CODE128_START_B]
  let checksum = CODE128_START_B

  let pos = 0
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i) - 32
    if (code < 0 || code > 95) continue
    pos++
    values.push(code)
    checksum += code * pos
  }
  values.push(checksum % 103)
  values.push(CODE128_STOP)

  // Convert patterns into a list of bars
  const bars: boolean[] = []
  for (const val of values) {
    const pattern = CODE128_PATTERNS[val]
    if (!pattern) continue
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern[i]!
      const isBar = i % 2 === 0
      for (let w = 0; w < width; w++) {
        bars.push(isBar)
      }
    }
  }

  return barsToRenderGroup(bars, data, options)
}

// ─── EAN-13 ───

const EAN_L_PATTERNS = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]
const EAN_G_PATTERNS = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
]
const EAN_R_PATTERNS = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
]
const EAN13_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
]

function renderEAN13(data: string, options: BarcodeOptions): RenderGroup {
  const digits = data.replace(/\D/g, '').padEnd(13, '0').slice(0, 13)

  // Generate bar pattern
  const bars: boolean[] = []

  // Start guard: 101
  bars.push(true, false, true)

  // Left 6 digits
  const parity = EAN13_PARITY[parseInt(digits[0]!)]!
  for (let i = 1; i <= 6; i++) {
    const d = parseInt(digits[i]!)
    const pattern = parity[i - 1] === 'L' ? EAN_L_PATTERNS[d]! : EAN_G_PATTERNS[d]!
    for (const ch of pattern) bars.push(ch === '1')
  }

  // Center guard: 01010
  bars.push(false, true, false, true, false)

  // Right 6 digits
  for (let i = 7; i <= 12; i++) {
    const d = parseInt(digits[i]!)
    const pattern = EAN_R_PATTERNS[d]!
    for (const ch of pattern) bars.push(ch === '1')
  }

  // End guard: 101
  bars.push(true, false, true)

  return barsToRenderGroup(bars, digits, options)
}

// ─── EAN-8 ───

function renderEAN8(data: string, options: BarcodeOptions): RenderGroup {
  const digits = data.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)

  const bars: boolean[] = []

  // Start guard: 101
  bars.push(true, false, true)

  // Left 4 digits (L encoding)
  for (let i = 0; i < 4; i++) {
    const d = parseInt(digits[i]!)
    const pattern = EAN_L_PATTERNS[d]!
    for (const ch of pattern) bars.push(ch === '1')
  }

  // Center guard: 01010
  bars.push(false, true, false, true, false)

  // Right 4 digits (R encoding)
  for (let i = 4; i < 8; i++) {
    const d = parseInt(digits[i]!)
    const pattern = EAN_R_PATTERNS[d]!
    for (const ch of pattern) bars.push(ch === '1')
  }

  // End guard: 101
  bars.push(true, false, true)

  return barsToRenderGroup(bars, digits, options)
}

// ─── QR Code ───

function renderQRCode(data: string, options: BarcodeOptions): RenderGroup {
  const ecLevel = options.errorCorrectionLevel ?? 'M'
  const matrix = generateQRMatrix(data, ecLevel)
  return matrixToRenderGroup(matrix, options)
}

/**
 * Generate the QR code matrix
 * Simplified implementation: versions 1-4, byte mode
 */
function generateQRMatrix(data: string, ecLevel: string): boolean[][] {
  const bytes = encodeUTF8(data)
  const version = selectVersion(bytes.length, ecLevel)
  const size = version * 4 + 17

  // Data encoding
  const codewords = encodeQRData(bytes, version, ecLevel)

  // Matrix initialization
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))

  // Place function patterns
  placeFinderPatterns(matrix, reserved, size)
  placeAlignmentPatterns(matrix, reserved, version, size)
  placeTimingPatterns(matrix, reserved, size)
  placeDarkModule(matrix, reserved, version)
  reserveFormatArea(reserved, size)

  // Place data
  placeData(matrix, reserved, codewords, size)

  // Select the optimal mask pattern (evaluate all 8 patterns)
  const bestMask = selectBestMask(matrix, reserved, size, ecLevel)

  return matrix
}

function encodeUTF8(str: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
    } else {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
    }
  }
  return bytes
}

// QR code data capacity by version (byte mode)
const QR_CAPACITY: Record<string, number[]> = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
}

function selectVersion(dataLength: number, ecLevel: string): number {
  const capacities = QR_CAPACITY[ecLevel] ?? QR_CAPACITY['M']!
  for (let v = 0; v < capacities.length; v++) {
    if (dataLength <= capacities[v]!) return v + 1
  }
  return 10 // Maximum version (up to 10 in this implementation)
}

// EC codeword count and block structure by version
interface ECInfo {
  totalCodewords: number
  ecPerBlock: number
  blocks: { count: number; dataCodewords: number }[]
}

function getECInfo(version: number, ecLevel: string): ECInfo {
  // Simplified table (versions 1-10)
  const table: Record<string, ECInfo[]> = {
    L: [
      { totalCodewords: 26, ecPerBlock: 7, blocks: [{ count: 1, dataCodewords: 19 }] },
      { totalCodewords: 44, ecPerBlock: 10, blocks: [{ count: 1, dataCodewords: 34 }] },
      { totalCodewords: 70, ecPerBlock: 15, blocks: [{ count: 1, dataCodewords: 55 }] },
      { totalCodewords: 100, ecPerBlock: 20, blocks: [{ count: 1, dataCodewords: 80 }] },
      { totalCodewords: 134, ecPerBlock: 26, blocks: [{ count: 1, dataCodewords: 108 }] },
      { totalCodewords: 172, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 68 }] },
      { totalCodewords: 196, ecPerBlock: 20, blocks: [{ count: 2, dataCodewords: 78 }] },
      { totalCodewords: 242, ecPerBlock: 24, blocks: [{ count: 2, dataCodewords: 97 }] },
      { totalCodewords: 292, ecPerBlock: 30, blocks: [{ count: 2, dataCodewords: 116 }] },
      { totalCodewords: 346, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 68 }, { count: 2, dataCodewords: 69 }] },
    ],
    M: [
      { totalCodewords: 26, ecPerBlock: 10, blocks: [{ count: 1, dataCodewords: 16 }] },
      { totalCodewords: 44, ecPerBlock: 16, blocks: [{ count: 1, dataCodewords: 28 }] },
      { totalCodewords: 70, ecPerBlock: 26, blocks: [{ count: 1, dataCodewords: 44 }] },
      { totalCodewords: 100, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 32 }] },
      { totalCodewords: 134, ecPerBlock: 24, blocks: [{ count: 2, dataCodewords: 43 }] },
      { totalCodewords: 172, ecPerBlock: 16, blocks: [{ count: 4, dataCodewords: 27 }] },
      { totalCodewords: 196, ecPerBlock: 18, blocks: [{ count: 4, dataCodewords: 31 }] },
      { totalCodewords: 242, ecPerBlock: 22, blocks: [{ count: 2, dataCodewords: 38 }, { count: 2, dataCodewords: 39 }] },
      { totalCodewords: 292, ecPerBlock: 22, blocks: [{ count: 3, dataCodewords: 36 }, { count: 2, dataCodewords: 37 }] },
      { totalCodewords: 346, ecPerBlock: 28, blocks: [{ count: 4, dataCodewords: 43 }, { count: 1, dataCodewords: 44 }] },
    ],
    Q: [
      { totalCodewords: 26, ecPerBlock: 13, blocks: [{ count: 1, dataCodewords: 13 }] },
      { totalCodewords: 44, ecPerBlock: 22, blocks: [{ count: 1, dataCodewords: 22 }] },
      { totalCodewords: 70, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 17 }] },
      { totalCodewords: 100, ecPerBlock: 26, blocks: [{ count: 2, dataCodewords: 24 }] },
      { totalCodewords: 134, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 15 }, { count: 2, dataCodewords: 16 }] },
      { totalCodewords: 172, ecPerBlock: 24, blocks: [{ count: 2, dataCodewords: 19 }, { count: 2, dataCodewords: 20 }] },
      { totalCodewords: 196, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 14 }, { count: 4, dataCodewords: 15 }] },
      { totalCodewords: 242, ecPerBlock: 22, blocks: [{ count: 4, dataCodewords: 18 }, { count: 2, dataCodewords: 19 }] },
      { totalCodewords: 292, ecPerBlock: 20, blocks: [{ count: 4, dataCodewords: 16 }, { count: 4, dataCodewords: 17 }] },
      { totalCodewords: 346, ecPerBlock: 24, blocks: [{ count: 6, dataCodewords: 19 }, { count: 2, dataCodewords: 20 }] },
    ],
    H: [
      { totalCodewords: 26, ecPerBlock: 17, blocks: [{ count: 1, dataCodewords: 9 }] },
      { totalCodewords: 44, ecPerBlock: 28, blocks: [{ count: 1, dataCodewords: 16 }] },
      { totalCodewords: 70, ecPerBlock: 22, blocks: [{ count: 2, dataCodewords: 13 }] },
      { totalCodewords: 100, ecPerBlock: 16, blocks: [{ count: 4, dataCodewords: 9 }] },
      { totalCodewords: 134, ecPerBlock: 22, blocks: [{ count: 2, dataCodewords: 11 }, { count: 2, dataCodewords: 12 }] },
      { totalCodewords: 172, ecPerBlock: 28, blocks: [{ count: 4, dataCodewords: 15 }] },
      { totalCodewords: 196, ecPerBlock: 26, blocks: [{ count: 4, dataCodewords: 13 }, { count: 1, dataCodewords: 14 }] },
      { totalCodewords: 242, ecPerBlock: 26, blocks: [{ count: 4, dataCodewords: 14 }, { count: 2, dataCodewords: 15 }] },
      { totalCodewords: 292, ecPerBlock: 24, blocks: [{ count: 4, dataCodewords: 12 }, { count: 4, dataCodewords: 13 }] },
      { totalCodewords: 346, ecPerBlock: 28, blocks: [{ count: 6, dataCodewords: 15 }, { count: 2, dataCodewords: 16 }] },
    ],
  }
  const list = table[ecLevel] ?? table['M']!
  return list[Math.min(version, list.length) - 1]!
}

function encodeQRData(bytes: number[], version: number, ecLevel: string): number[] {
  const ecInfo = getECInfo(version, ecLevel)

  // Total data capacity
  let totalDataCodewords = 0
  for (const block of ecInfo.blocks) {
    totalDataCodewords += block.count * block.dataCodewords
  }

  // Build the bit stream
  const bits: number[] = []

  // Mode indicator (byte mode = 0100)
  bits.push(0, 1, 0, 0)

  // Character count indicator (8 bits for versions 1-9, 16 bits for 10+)
  const countBits = version <= 9 ? 8 : 16
  for (let i = countBits - 1; i >= 0; i--) {
    bits.push((bytes.length >> i) & 1)
  }

  // Data
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1)
    }
  }

  // Terminator pattern
  const totalBits = totalDataCodewords * 8
  for (let i = 0; i < 4 && bits.length < totalBits; i++) {
    bits.push(0)
  }

  // Pad to an 8-bit boundary
  while (bits.length % 8 !== 0) {
    bits.push(0)
  }

  // Padding bytes (alternating 0xEC, 0x11)
  const padBytes = [0xEC, 0x11]
  let padIdx = 0
  while (bits.length < totalBits) {
    const pad = padBytes[padIdx % 2]!
    for (let i = 7; i >= 0; i--) {
      bits.push((pad >> i) & 1)
    }
    padIdx++
  }

  // Bit → byte conversion
  const dataCodewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i + j] ?? 0)
    }
    dataCodewords.push(byte)
  }

  // Block splitting and EC computation
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  let offset = 0

  for (const blockDef of ecInfo.blocks) {
    for (let b = 0; b < blockDef.count; b++) {
      const blockData = dataCodewords.slice(offset, offset + blockDef.dataCodewords)
      dataBlocks.push(blockData)
      ecBlocks.push(computeReedSolomon(blockData, ecInfo.ecPerBlock))
      offset += blockDef.dataCodewords
    }
  }

  // Interleaving
  const result: number[] = []

  // Interleave data
  const maxDataLen = Math.max(...dataBlocks.map(b => b.length))
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]!)
    }
  }

  // Interleave EC
  const maxECLen = Math.max(...ecBlocks.map(b => b.length))
  for (let i = 0; i < maxECLen; i++) {
    for (const block of ecBlocks) {
      if (i < block.length) result.push(block[i]!)
    }
  }

  return result
}

// ─── Reed-Solomon error correction ───

// GF(256) log/exp tables (generator polynomial x^8 + x^4 + x^3 + x^2 + 1 = 0x11D)
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x = (x << 1) ^ (x & 128 ? 0x11D : 0)
    x &= 0xFF
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]!
  }
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[(GF_LOG[a]! + GF_LOG[b]!) % 255]!
}

function computeReedSolomon(data: number[], ecCount: number): number[] {
  // Compute the coefficients of the generator polynomial
  const gen = [1]
  for (let i = 0; i < ecCount; i++) {
    const newGen = new Array(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      newGen[j] ^= gen[j]!
      newGen[j + 1] ^= gfMul(gen[j]!, GF_EXP[i]!)
    }
    gen.length = newGen.length
    for (let j = 0; j < newGen.length; j++) gen[j] = newGen[j]!
  }

  // Polynomial division
  const remainder = new Array(ecCount).fill(0)
  for (const byte of data) {
    const factor = byte ^ remainder[0]!
    remainder.shift()
    remainder.push(0)
    for (let i = 0; i < ecCount; i++) {
      remainder[i]! ^= gfMul(gen[i + 1]!, factor)
    }
  }

  return remainder
}

// ─── QR matrix construction ───

function placeFinderPatterns(matrix: boolean[][], reserved: boolean[][], size: number): void {
  const positions = [[0, 0], [0, size - 7], [size - 7, 0]]
  for (const [r, c] of positions) {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const isOuter = dr === 0 || dr === 6 || dc === 0 || dc === 6
        const isInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
        matrix[r! + dr]![c! + dc] = isOuter || isInner
        reserved[r! + dr]![c! + dc] = true
      }
    }
    // Separator
    for (let i = -1; i <= 7; i++) {
      for (const [dr, dc] of [[i, -1], [i, 7], [-1, i], [7, i]] as [number, number][]) {
        const row = r! + dr, col = c! + dc
        if (row >= 0 && row < size && col >= 0 && col < size) {
          reserved[row]![col] = true
        }
      }
    }
  }
}

const ALIGNMENT_POSITIONS: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
]

function placeAlignmentPatterns(matrix: boolean[][], reserved: boolean[][], version: number, size: number): void {
  if (version < 2) return
  const positions = ALIGNMENT_POSITIONS[version] ?? []
  for (const r of positions) {
    for (const c of positions) {
      // Skip if it overlaps a finder pattern
      if (reserved[r]![c]) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isOuter = Math.abs(dr) === 2 || Math.abs(dc) === 2
          const isCenter = dr === 0 && dc === 0
          matrix[r + dr]![c + dc] = isOuter || isCenter
          reserved[r + dr]![c + dc] = true
        }
      }
    }
  }
}

function placeTimingPatterns(matrix: boolean[][], reserved: boolean[][], size: number): void {
  for (let i = 8; i < size - 8; i++) {
    matrix[6]![i] = i % 2 === 0
    reserved[6]![i] = true
    matrix[i]![6] = i % 2 === 0
    reserved[i]![6] = true
  }
}

function placeDarkModule(matrix: boolean[][], reserved: boolean[][], version: number): void {
  const row = 4 * version + 9
  matrix[row]![8] = true
  reserved[row]![8] = true
}

function reserveFormatArea(reserved: boolean[][], size: number): void {
  // Top-left
  for (let i = 0; i <= 8; i++) {
    reserved[8]![i] = true
    reserved[i]![8] = true
  }
  // Top-right
  for (let i = 0; i <= 7; i++) {
    reserved[8]![size - 1 - i] = true
  }
  // Bottom-left
  for (let i = 0; i <= 7; i++) {
    reserved[size - 1 - i]![8] = true
  }
}

function placeData(matrix: boolean[][], reserved: boolean[][], codewords: number[], size: number): void {
  let bitIdx = 0
  const totalBits = codewords.length * 8
  let upward = true

  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5 // Skip the timing pattern column

    const rowRange = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i)

    for (const row of rowRange) {
      for (const dc of [0, -1]) {
        const c = col + dc
        if (c < 0 || reserved[row]![c]) continue
        if (bitIdx < totalBits) {
          const byteIdx = Math.floor(bitIdx / 8)
          const bitPos = 7 - (bitIdx % 8)
          matrix[row]![c] = ((codewords[byteIdx]! >> bitPos) & 1) === 1
          bitIdx++
        }
      }
    }
    upward = !upward
  }
}

function applyMask(matrix: boolean[][], reserved: boolean[][], size: number, maskPattern: number): void {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r]![c]) continue
      let mask = false
      switch (maskPattern) {
        case 0: mask = (r + c) % 2 === 0; break
        case 1: mask = r % 2 === 0; break
        case 2: mask = c % 3 === 0; break
        case 3: mask = (r + c) % 3 === 0; break
        case 4: mask = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break
        case 5: mask = (r * c) % 2 + (r * c) % 3 === 0; break
        case 6: mask = ((r * c) % 2 + (r * c) % 3) % 2 === 0; break
        case 7: mask = ((r + c) % 2 + (r * c) % 3) % 2 === 0; break
      }
      if (mask) matrix[r]![c] = !matrix[r]![c]
    }
  }
}

/**
 * Evaluate all 8 mask patterns, select and apply the one with the lowest penalty score.
 * Evaluates the 4 penalty rules of ISO 18004 §8.8.
 */
function selectBestMask(
  matrix: boolean[][], reserved: boolean[][], size: number, ecLevel: string,
): number {
  let bestMask = 0
  let bestPenalty = Infinity

  for (let mask = 0; mask < 8; mask++) {
    // Copy the matrix for evaluation
    const testMatrix = matrix.map(row => [...row])
    applyMask(testMatrix, reserved, size, mask)
    placeFormatInfo(testMatrix, size, ecLevel, mask)

    const penalty = evaluatePenalty(testMatrix, size)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMask = mask
    }
  }

  // Apply the optimal mask
  applyMask(matrix, reserved, size, bestMask)
  placeFormatInfo(matrix, size, ecLevel, bestMask)
  return bestMask
}

/**
 * Compute the QR code penalty score (ISO 18004 §8.8.2)
 */
function evaluatePenalty(matrix: boolean[][], size: number): number {
  let penalty = 0

  // Rule 1: runs of 5+ same-color modules in a row/column (N1 = 3, +1 per extra)
  for (let r = 0; r < size; r++) {
    let count = 1
    for (let c = 1; c < size; c++) {
      if (matrix[r]![c] === matrix[r]![c - 1]) {
        count++
      } else {
        if (count >= 5) penalty += count - 2
        count = 1
      }
    }
    if (count >= 5) penalty += count - 2
  }
  for (let c = 0; c < size; c++) {
    let count = 1
    for (let r = 1; r < size; r++) {
      if (matrix[r]![c] === matrix[r - 1]![c]) {
        count++
      } else {
        if (count >= 5) penalty += count - 2
        count = 1
      }
    }
    if (count >= 5) penalty += count - 2
  }

  // Rule 2: 2×2 same-color blocks (N2 = 3)
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r]![c]
      if (v === matrix[r]![c + 1] && v === matrix[r + 1]![c] && v === matrix[r + 1]![c + 1]) {
        penalty += 3
      }
    }
  }

  // Rule 3: 1:1:3:1:1 pattern (10111010000 or 00001011101) (N3 = 40)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      if (matchFinderLikePattern(matrix[r]!, c)) penalty += 40
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      const col = Array.from({ length: 11 }, (_, i) => matrix[r + i]![c]!)
      if (matchFinderLikePatternArr(col)) penalty += 40
    }
  }

  // Rule 4: penalty grows as the dark module ratio deviates from 50% (N4 = 10)
  let darkCount = 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r]![c]) darkCount++
    }
  }
  const total = size * size
  const pct = (darkCount / total) * 100
  const deviation = Math.abs(pct - 50)
  penalty += Math.floor(deviation / 5) * 10

  return penalty
}

function matchFinderLikePattern(row: boolean[], start: number): boolean {
  // 10111010000 or 00001011101
  const p1 = [true, false, true, true, true, false, true, false, false, false, false]
  const p2 = [false, false, false, false, true, false, true, true, true, false, true]
  let m1 = true, m2 = true
  for (let i = 0; i < 11; i++) {
    if (row[start + i] !== p1[i]) m1 = false
    if (row[start + i] !== p2[i]) m2 = false
    if (!m1 && !m2) return false
  }
  return m1 || m2
}

function matchFinderLikePatternArr(arr: boolean[]): boolean {
  const p1 = [true, false, true, true, true, false, true, false, false, false, false]
  const p2 = [false, false, false, false, true, false, true, true, true, false, true]
  let m1 = true, m2 = true
  for (let i = 0; i < 11; i++) {
    if (arr[i] !== p1[i]) m1 = false
    if (arr[i] !== p2[i]) m2 = false
    if (!m1 && !m2) return false
  }
  return m1 || m2
}

// Format information (EC level + mask pattern → 15-bit BCH code)
const FORMAT_INFO_STRINGS: Record<string, string[]> = {
  L: [
    '111011111000100', '111001011110011', '111110110101010', '111100010011101',
    '110011000101111', '110001100011000', '110110001000001', '110100101110110',
  ],
  M: [
    '101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000',
  ],
  Q: [
    '011010101011111', '011000001101000', '011111100110001', '011101000000110',
    '010010010110100', '010000110000011', '010111011011010', '010101111101101',
  ],
  H: [
    '001011010001001', '001001110111110', '001110011100111', '001100111010000',
    '000011101100010', '000001001010101', '000110100001100', '000100000111011',
  ],
}

function placeFormatInfo(matrix: boolean[][], size: number, ecLevel: string, maskPattern: number): void {
  const formatStr = (FORMAT_INFO_STRINGS[ecLevel] ?? FORMAT_INFO_STRINGS['M']!)[maskPattern]!
  const bits = formatStr.split('').map(ch => ch === '1')

  // Around the top-left (ISO 18004 Table 9)
  // Bits 0-7: row 8 left to right (col 0→5, skip col 6=timing, col 7→8)
  // Bits 8-14: col 8 bottom to top (row 7, skip row 6=timing, row 5→0)
  const positions1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ]
  for (let i = 0; i < 15; i++) {
    const pos = positions1[i]!
    matrix[pos[0]!]![pos[1]!] = bits[i]!
  }

  // Bottom-left + top-right (ISO 18004 Table 9)
  // Bits 0-6: col 8 bottom to top (row size-1 → size-7)
  // Bits 7-14: row 8 left to right (col size-8 → size-1)
  const positions2: [number, number][] = []
  for (let i = 0; i < 7; i++) {
    positions2.push([size - 1 - i, 8])
  }
  for (let i = 0; i < 8; i++) {
    positions2.push([8, size - 8 + i])
  }
  for (let i = 0; i < 15; i++) {
    const [r, c] = positions2[i]!
    matrix[r]![c] = bits[i]!
  }
}

// ─── UPC-A ───

function renderUPCA(data: string, options: BarcodeOptions): RenderGroup {
  // UPC-A is EAN-13 with leading "0"
  const digits = data.replace(/\D/g, '').slice(0, 12)
  return renderEAN13('0' + digits, options)
}

// ─── UPC-E ───

// UPC-E parity patterns indexed by UPC-A check digit (0-9)
// Each pattern is 6 characters of 'O' (odd=L) / 'E' (even=G)
const UPCE_PARITY = [
  'EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO',
  'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE',
]

function upcaCheckDigit(digits: string): number {
  let sum = 0
  for (let i = 0; i < 11; i++) {
    const d = parseInt(digits[i]!)
    sum += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (sum % 10)) % 10
}

function renderUPCE(data: string, options: BarcodeOptions): RenderGroup {
  const raw = data.replace(/\D/g, '')
  // Accept 6, 7, or 8 digits. If 6 digits, assume number system 0.
  let digits6: string
  let checkDigit: number
  if (raw.length >= 8) {
    digits6 = raw.slice(1, 7)
    checkDigit = parseInt(raw[7]!)
  } else if (raw.length === 7) {
    digits6 = raw.slice(1, 7)
    // Need to compute check digit from expanded UPC-A
    checkDigit = upcaCheckDigit(expandUPCE(raw[0]!, raw.slice(1, 7)))
  } else {
    digits6 = raw.padEnd(6, '0').slice(0, 6)
    checkDigit = upcaCheckDigit(expandUPCE('0', digits6))
  }

  const parity = UPCE_PARITY[checkDigit]!

  const bars: boolean[] = []

  // Start guard: 101
  bars.push(true, false, true)

  // 6 data digits encoded with L/G patterns based on parity
  for (let i = 0; i < 6; i++) {
    const d = parseInt(digits6[i]!)
    const pattern = parity[i] === 'O' ? EAN_L_PATTERNS[d]! : EAN_G_PATTERNS[d]!
    for (const ch of pattern) bars.push(ch === '1')
  }

  // End guard: 010101
  bars.push(false, true, false, true, false, true)

  const displayText = '0' + digits6 + checkDigit
  return barsToRenderGroup(bars, displayText, options)
}

function expandUPCE(numberSystem: string, digits6: string): string {
  const ns = numberSystem
  const d = digits6
  let expanded: string
  const last = d[5]!
  if (last === '0' || last === '1' || last === '2') {
    expanded = ns + d[0]! + d[1]! + last + '0000' + d[2]! + d[3]! + d[4]!
  } else if (last === '3') {
    expanded = ns + d[0]! + d[1]! + d[2]! + '00000' + d[3]! + d[4]!
  } else if (last === '4') {
    expanded = ns + d[0]! + d[1]! + d[2]! + d[3]! + '00000' + d[4]!
  } else {
    expanded = ns + d[0]! + d[1]! + d[2]! + d[3]! + d[4]! + '0000' + last
  }
  return expanded
}

// ─── ITF (Interleaved 2 of 5) ───

// Each digit is encoded as 5 elements: N(narrow) or W(wide)
const ITF_PATTERNS = [
  'NNWWN', 'WNNNW', 'NWNNW', 'WWNNN', 'NNWNW',
  'WNWNN', 'NWWNN', 'NNNWW', 'WNNWN', 'NWNWN',
]

function renderITF(data: string, options: BarcodeOptions): RenderGroup {
  let digits = data.replace(/\D/g, '')
  // Pad to even length
  if (digits.length % 2 !== 0) digits = '0' + digits

  const bars: boolean[] = []
  const narrow = 1
  const wide = 3

  // Start pattern: narrow bar, narrow space, narrow bar, narrow space
  for (let i = 0; i < 4; i++) {
    const isBar = i % 2 === 0
    for (let w = 0; w < narrow; w++) bars.push(isBar)
  }

  // Encode digit pairs
  for (let i = 0; i < digits.length; i += 2) {
    const d1 = parseInt(digits[i]!)   // bars pattern
    const d2 = parseInt(digits[i + 1]!) // spaces pattern
    const p1 = ITF_PATTERNS[d1]!
    const p2 = ITF_PATTERNS[d2]!

    for (let j = 0; j < 5; j++) {
      const barWidth = p1[j] === 'W' ? wide : narrow
      const spaceWidth = p2[j] === 'W' ? wide : narrow
      for (let w = 0; w < barWidth; w++) bars.push(true)
      for (let w = 0; w < spaceWidth; w++) bars.push(false)
    }
  }

  // Stop pattern: wide bar, narrow space, narrow bar
  for (let w = 0; w < wide; w++) bars.push(true)
  for (let w = 0; w < narrow; w++) bars.push(false)
  for (let w = 0; w < narrow; w++) bars.push(true)

  return barsToRenderGroup(bars, digits, options)
}

// ─── Codabar ───

const CODABAR_CHARS = '0123456789-$:/.+ABCD'
// 7 elements per character: 4 bars + 3 spaces, N=narrow, W=wide
const CODABAR_PATTERNS: Record<string, string> = {
  '0': 'NNNNNWW', '1': 'NNNNWWN', '2': 'NNNWNNW', '3': 'WWNNNNN',
  '4': 'NNWNNWN', '5': 'WNNNNWN', '6': 'NWNNNNW', '7': 'NWNNWNN',
  '8': 'NWWNNNN', '9': 'WNNWNNN', '-': 'NNNWWNN', '$': 'NNWWNNN',
  ':': 'WNNNWNW', '/': 'WNWNNNW', '.': 'WNWNWNN', '+': 'NNWNWNW',
  'A': 'NNWWNWN', 'B': 'NWNWNNW', 'C': 'NNNWNWW', 'D': 'NNNWWWN',
}

function renderCodabar(data: string, options: BarcodeOptions): RenderGroup {
  const upper = data.toUpperCase()
  // Add start/stop characters if not present
  let encoded = upper
  const validStartStop = 'ABCD'
  if (!validStartStop.includes(encoded[0]!)) encoded = 'A' + encoded
  if (!validStartStop.includes(encoded[encoded.length - 1]!)) encoded = encoded + 'A'

  const bars: boolean[] = []
  const narrow = 1
  const wide = 3

  for (let i = 0; i < encoded.length; i++) {
    const pattern = CODABAR_PATTERNS[encoded[i]!]
    if (!pattern) continue
    for (let j = 0; j < 7; j++) {
      const isBar = j % 2 === 0 // even=bar, odd=space
      const w = pattern[j] === 'W' ? wide : narrow
      for (let k = 0; k < w; k++) bars.push(isBar)
    }
    // Inter-character gap (narrow space)
    if (i < encoded.length - 1) {
      bars.push(false)
    }
  }

  return barsToRenderGroup(bars, data, options)
}

// ─── Code 93 ───

const CODE93_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%'
// 9 modules per character (3 bars + 3 spaces, widths sum to 9)
// 47 entries: 43 basic characters + 4 shift characters (for check digit computation)
const CODE93_PATTERNS: number[][] = [
  [1,3,1,1,1,2], [1,1,1,2,1,3], [1,1,1,3,1,2], [1,1,1,4,1,1], [1,2,1,1,1,3], // 0-4
  [1,2,1,2,1,2], [1,2,1,3,1,1], [1,1,1,1,1,4], [1,3,1,2,1,1], [1,4,1,1,1,1], // 5-9
  [2,1,1,1,1,3], [2,1,1,2,1,2], [2,1,1,3,1,1], [2,2,1,1,1,2], [2,2,1,2,1,1], // A-E (10-14)
  [2,3,1,1,1,1], [1,1,2,1,1,3], [1,1,2,2,1,2], [1,1,2,3,1,1], [1,2,2,1,1,2], // F-J (15-19)
  [1,3,2,1,1,1], [1,1,1,1,2,3], [1,1,1,2,2,2], [1,1,1,3,2,1], [1,2,1,1,2,2], // K-O (20-24)
  [1,3,1,1,2,1], [2,1,2,1,1,2], [2,1,2,2,1,1], [2,1,1,1,2,2], [2,1,1,2,2,1], // P-T (25-29)
  [2,2,1,1,2,1], [2,2,2,1,1,1], [1,1,2,1,2,2], [1,1,2,2,2,1], [1,2,2,1,2,1], // U-Y (30-34)
  [1,2,3,1,1,1], [1,2,1,1,3,1], [3,1,1,1,1,2], [3,1,1,2,1,1], [3,2,1,1,1,1], // Z-$ (35-39)
  [1,1,2,1,3,1], [1,1,3,1,2,1], [2,1,1,1,3,1], [1,2,1,2,2,1], [3,1,2,1,1,1], // /-%,($),(%) (40-44)
  [3,1,1,1,2,1], [1,2,2,2,1,1],                                                 // (/),(+) (45-46)
]

// Start/stop pattern for Code 93: * = 1 1 1 1 4 1
const CODE93_START_STOP = [1, 1, 1, 1, 4, 1]
// Termination bar
const CODE93_TERM_BAR = 1

function code93CharIndex(ch: string): number {
  return CODE93_CHARS.indexOf(ch)
}

function renderCode93(data: string, options: BarcodeOptions): RenderGroup {
  const upper = data.toUpperCase()
  const indices: number[] = []
  for (let i = 0; i < upper.length; i++) {
    const idx = code93CharIndex(upper[i]!)
    if (idx >= 0) indices.push(idx)
  }

  // Compute check characters C and K
  // C: weight 1-20 cycling, mod 47
  let sumC = 0
  for (let i = 0; i < indices.length; i++) {
    const weight = ((indices.length - 1 - i) % 20) + 1
    sumC += indices[i]! * weight
  }
  const checkC = sumC % 47
  indices.push(checkC)

  // K: weight 1-15 cycling over data+C, mod 47
  let sumK = 0
  for (let i = 0; i < indices.length; i++) {
    const weight = ((indices.length - 1 - i) % 15) + 1
    sumK += indices[i]! * weight
  }
  const checkK = sumK % 47
  indices.push(checkK)

  const bars: boolean[] = []

  // Start: *
  const startPat = CODE93_START_STOP
  for (let i = 0; i < startPat.length; i++) {
    const w = startPat[i]!
    const isBar = i % 2 === 0
    for (let k = 0; k < w; k++) bars.push(isBar)
  }

  // Data + check characters
  for (let i = 0; i < indices.length; i++) {
    const pattern = CODE93_PATTERNS[indices[i]!]
    if (!pattern) continue
    for (let j = 0; j < pattern.length; j++) {
      const w = pattern[j]!
      const isBar = j % 2 === 0
      for (let k = 0; k < w; k++) bars.push(isBar)
    }
  }

  // Stop: * + termination bar
  for (let i = 0; i < startPat.length; i++) {
    const w = startPat[i]!
    const isBar = i % 2 === 0
    for (let k = 0; k < w; k++) bars.push(isBar)
  }
  // Termination bar
  bars.push(true)

  return barsToRenderGroup(bars, data, options)
}

// ─── MSI (Modified Plessey) ───

function msiLuhnCheckDigit(digits: string): number {
  // Luhn mod 10 algorithm
  let sum = 0
  let doubleFlag = true
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]!)
    if (doubleFlag) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    doubleFlag = !doubleFlag
  }
  return (10 - (sum % 10)) % 10
}

function renderMSI(data: string, options: BarcodeOptions): RenderGroup {
  const digits = data.replace(/\D/g, '')
  const checkDigit = msiLuhnCheckDigit(digits)
  const fullData = digits + checkDigit

  const bars: boolean[] = []
  const narrow = 1
  const wide = 3

  // Start: binary "1" = wide bar + narrow space
  for (let w = 0; w < wide; w++) bars.push(true)
  for (let w = 0; w < narrow; w++) bars.push(false)

  // Each digit: 4-bit BCD, each bit → bar+space
  // "0" bit: narrow bar + wide space (NW)
  // "1" bit: wide bar + narrow space (WN)
  for (let i = 0; i < fullData.length; i++) {
    const d = parseInt(fullData[i]!)
    for (let bit = 3; bit >= 0; bit--) {
      const isOne = (d >> bit) & 1
      if (isOne) {
        // Wide bar, narrow space
        for (let w = 0; w < wide; w++) bars.push(true)
        for (let w = 0; w < narrow; w++) bars.push(false)
      } else {
        // Narrow bar, wide space
        for (let w = 0; w < narrow; w++) bars.push(true)
        for (let w = 0; w < wide; w++) bars.push(false)
      }
    }
  }

  // Stop: binary "0" + termination bar = narrow bar + wide space + narrow bar
  for (let w = 0; w < narrow; w++) bars.push(true)
  for (let w = 0; w < wide; w++) bars.push(false)
  for (let w = 0; w < narrow; w++) bars.push(true)

  return barsToRenderGroup(bars, digits, options)
}

// ─── Common utilities ───

/**
 * Convert an array of bars into a RenderGroup (for 1D barcodes)
 */
function barsToRenderGroup(bars: boolean[], text: string, options: BarcodeOptions): RenderGroup {
  const { x, y, width, height, showText } = options
  if (bars.length === 0) {
    return { type: 'group', x, y, width, height, children: [] }
  }
  const textHeight = showText ? 10 : 0
  const barHeight = height - textHeight
  const barWidth = width / bars.length

  const children: RenderNode[] = []

  // Draw the bars
  for (let i = 0; i < bars.length; i++) {
    if (bars[i]) {
      children.push({
        type: 'rect',
        x: i * barWidth,
        y: 0,
        width: barWidth,
        height: barHeight,
        fill: '#000000',
      })
    }
  }

  // Text display
  if (showText) {
    children.push({
      type: 'text',
      x: 0,
      y: barHeight + 1,
      text,
      fontId: 'default',
      fontSize: 8,
      color: '#000000',
      hAlign: 'center',
      width,
    })
  }

  return {
    type: 'group',
    x, y, width, height,
    clip: true,
    children,
  }
}

/**
 * Convert a 2D matrix into a RenderGroup (for QR code / DataMatrix)
 */
function matrixToRenderGroup(matrix: boolean[][], options: BarcodeOptions, quietZone = 4): RenderGroup {
  const { x, y, width, height } = options
  const rows = matrix.length
  const cols = rows > 0 ? matrix[0]!.length : 0
  const totalRows = rows + 2 * quietZone
  const totalCols = cols + 2 * quietZone
  const cellSize = Math.min(width / totalCols, height / totalRows)
  const offsetX = (width - cellSize * totalCols) / 2 + quietZone * cellSize
  const offsetY = (height - cellSize * totalRows) / 2 + quietZone * cellSize

  const children: RenderNode[] = []

  // White background
  children.push({
    type: 'rect',
    x: 0,
    y: 0,
    width,
    height,
    fill: '#FFFFFF',
  })

  // Draw the modules
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (matrix[r]![c]) {
        children.push({
          type: 'rect',
          x: offsetX + c * cellSize,
          y: offsetY + r * cellSize,
          width: cellSize,
          height: cellSize,
          fill: '#000000',
        })
      }
    }
  }

  return {
    type: 'group',
    x, y, width, height,
    clip: true,
    children,
  }
}

// ─── DataMatrix ───

function renderDataMatrix(data: string, options: BarcodeOptions): RenderGroup {
  const matrix = generateDataMatrix(data)
  return matrixToRenderGroup(matrix, options, 1)
}

// ─── PDF417 ───

function renderPDF417Barcode(data: string, options: BarcodeOptions): RenderGroup {
  return renderPDF417(data, options)
}

/**
 * Placeholder for unsupported barcodes
 */
function renderPlaceholder(barcodeType: string, data: string, options: BarcodeOptions): RenderGroup {
  return {
    type: 'group',
    x: options.x, y: options.y,
    width: options.width, height: options.height,
    children: [
      { type: 'rect', x: 0, y: 0, width: options.width, height: options.height, stroke: '#999999', strokeWidth: 0.5 },
      { type: 'text', x: 4, y: 4, text: `[${barcodeType}]`, fontId: 'default', fontSize: 8, color: '#999999' },
      { type: 'text', x: 4, y: 16, text: data, fontId: 'default', fontSize: 8, color: '#999999' },
    ],
  }
}
