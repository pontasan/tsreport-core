/**
 * DataMatrix barcode generation (ISO 16022)
 *
 * ASCII mode encoding + Reed-Solomon error correction (GF(256), poly 0x12D)
 * + Utah pattern placement + finder pattern assembly
 */

// ─── GF(256) Arithmetic (poly 0x12D = 301) ───

const DM_GF_EXP = new Uint8Array(512)
const DM_GF_LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    DM_GF_EXP[i] = x
    DM_GF_LOG[x] = i
    x = (x << 1) ^ (x & 128 ? 0x12D : 0)
    x &= 0xFF
  }
  for (let i = 255; i < 512; i++) {
    DM_GF_EXP[i] = DM_GF_EXP[i - 255]!
  }
})()

function dmGfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return DM_GF_EXP[(DM_GF_LOG[a]! + DM_GF_LOG[b]!) % 255]!
}

// ─── Symbol Size Table ───

interface DMSize {
  rows: number
  cols: number
  dataRows: number
  dataCols: number
  dataCodewords: number
  ecCodewords: number
  regionRows: number
  regionCols: number
  blocks: number
}

const DM_SIZES: DMSize[] = [
  // Square sizes
  { rows: 10, cols: 10, dataRows: 8, dataCols: 8, dataCodewords: 3, ecCodewords: 5, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 12, cols: 12, dataRows: 10, dataCols: 10, dataCodewords: 5, ecCodewords: 7, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 14, cols: 14, dataRows: 12, dataCols: 12, dataCodewords: 8, ecCodewords: 10, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 16, cols: 16, dataRows: 14, dataCols: 14, dataCodewords: 12, ecCodewords: 12, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 18, cols: 18, dataRows: 16, dataCols: 16, dataCodewords: 18, ecCodewords: 14, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 20, cols: 20, dataRows: 18, dataCols: 18, dataCodewords: 22, ecCodewords: 18, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 22, cols: 22, dataRows: 20, dataCols: 20, dataCodewords: 30, ecCodewords: 20, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 24, cols: 24, dataRows: 22, dataCols: 22, dataCodewords: 36, ecCodewords: 24, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 26, cols: 26, dataRows: 24, dataCols: 24, dataCodewords: 44, ecCodewords: 28, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 32, cols: 32, dataRows: 14, dataCols: 14, dataCodewords: 62, ecCodewords: 36, regionRows: 2, regionCols: 2, blocks: 1 },
  { rows: 36, cols: 36, dataRows: 16, dataCols: 16, dataCodewords: 86, ecCodewords: 42, regionRows: 2, regionCols: 2, blocks: 1 },
  { rows: 40, cols: 40, dataRows: 18, dataCols: 18, dataCodewords: 114, ecCodewords: 48, regionRows: 2, regionCols: 2, blocks: 1 },
  { rows: 44, cols: 44, dataRows: 20, dataCols: 20, dataCodewords: 144, ecCodewords: 56, regionRows: 2, regionCols: 2, blocks: 1 },
  { rows: 48, cols: 48, dataRows: 22, dataCols: 22, dataCodewords: 175, ecCodewords: 68, regionRows: 2, regionCols: 2, blocks: 1 },
  { rows: 52, cols: 52, dataRows: 24, dataCols: 24, dataCodewords: 204, ecCodewords: 84, regionRows: 2, regionCols: 2, blocks: 2 },
  { rows: 64, cols: 64, dataRows: 14, dataCols: 14, dataCodewords: 280, ecCodewords: 112, regionRows: 4, regionCols: 4, blocks: 2 },
  { rows: 72, cols: 72, dataRows: 16, dataCols: 16, dataCodewords: 368, ecCodewords: 144, regionRows: 4, regionCols: 4, blocks: 4 },
  { rows: 80, cols: 80, dataRows: 18, dataCols: 18, dataCodewords: 456, ecCodewords: 192, regionRows: 4, regionCols: 4, blocks: 4 },
  { rows: 88, cols: 88, dataRows: 20, dataCols: 20, dataCodewords: 576, ecCodewords: 224, regionRows: 4, regionCols: 4, blocks: 4 },
  { rows: 96, cols: 96, dataRows: 22, dataCols: 22, dataCodewords: 696, ecCodewords: 272, regionRows: 4, regionCols: 4, blocks: 4 },
  { rows: 104, cols: 104, dataRows: 24, dataCols: 24, dataCodewords: 816, ecCodewords: 336, regionRows: 4, regionCols: 4, blocks: 6 },
  { rows: 120, cols: 120, dataRows: 18, dataCols: 18, dataCodewords: 1050, ecCodewords: 408, regionRows: 6, regionCols: 6, blocks: 6 },
  { rows: 132, cols: 132, dataRows: 20, dataCols: 20, dataCodewords: 1304, ecCodewords: 496, regionRows: 6, regionCols: 6, blocks: 8 },
  { rows: 144, cols: 144, dataRows: 22, dataCols: 22, dataCodewords: 1558, ecCodewords: 620, regionRows: 6, regionCols: 6, blocks: 10 },
  // Rectangular sizes
  { rows: 8, cols: 18, dataRows: 6, dataCols: 16, dataCodewords: 5, ecCodewords: 7, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 8, cols: 32, dataRows: 6, dataCols: 14, dataCodewords: 10, ecCodewords: 11, regionRows: 1, regionCols: 2, blocks: 1 },
  { rows: 12, cols: 26, dataRows: 10, dataCols: 24, dataCodewords: 16, ecCodewords: 14, regionRows: 1, regionCols: 1, blocks: 1 },
  { rows: 12, cols: 36, dataRows: 10, dataCols: 16, dataCodewords: 22, ecCodewords: 18, regionRows: 1, regionCols: 2, blocks: 1 },
  { rows: 16, cols: 36, dataRows: 14, dataCols: 16, dataCodewords: 32, ecCodewords: 24, regionRows: 1, regionCols: 2, blocks: 1 },
  { rows: 16, cols: 48, dataRows: 14, dataCols: 22, dataCodewords: 49, ecCodewords: 28, regionRows: 1, regionCols: 2, blocks: 1 },
]

// ─── ASCII Mode Encoding ───

function encodeDMData(data: string): number[] {
  const codewords: number[] = []
  let i = 0
  while (i < data.length) {
    const c = data.charCodeAt(i)
    // Digit pair optimization: two digits -> single codeword 130-229
    if (c >= 48 && c <= 57 && i + 1 < data.length) {
      const c2 = data.charCodeAt(i + 1)
      if (c2 >= 48 && c2 <= 57) {
        codewords.push((c - 48) * 10 + (c2 - 48) + 130)
        i += 2
        continue
      }
    }
    // ASCII 0-127 -> codeword c+1
    if (c <= 127) {
      codewords.push(c + 1)
    } else {
      // Extended ASCII: Upper Shift (235) + c-128+1
      codewords.push(235, c - 128 + 1)
    }
    i++
  }
  return codewords
}

// ─── Size Selection & Padding ───

function selectSize(dataLen: number): DMSize {
  for (let i = 0; i < DM_SIZES.length; i++) {
    if (DM_SIZES[i]!.dataCodewords >= dataLen) return DM_SIZES[i]!
  }
  return DM_SIZES[DM_SIZES.length - 1]!
}

function padCodewords(codewords: number[], capacity: number): number[] {
  const padded: number[] = new Array(capacity)
  for (let i = 0; i < codewords.length; i++) {
    padded[i] = codewords[i]!
  }
  if (codewords.length < capacity) {
    padded[codewords.length] = 129 // pad codeword
    for (let i = codewords.length + 1; i < capacity; i++) {
      // Randomization for pad positions 2+
      let v = ((149 * (i + 1)) % 253 + 1 + 129) % 254
      if (v === 0) v = 254
      padded[i] = v
    }
  }
  return padded
}

// ─── Reed-Solomon Error Correction ───

function computeDMReedSolomon(data: number[], ecCount: number): number[] {
  // Build generator polynomial with roots a^1 to a^ecCount (ISO 16022 generatorBase=1)
  const gen = new Uint8Array(ecCount + 1)
  gen[0] = 1
  let genLen = 1
  for (let i = 0; i < ecCount; i++) {
    const root = DM_GF_EXP[i + 1]!
    // Multiply gen by (x + a^(i+1)) in GF(256)
    const newLen = genLen + 1
    for (let j = genLen; j >= 1; j--) {
      gen[j] = gen[j - 1]! ^ dmGfMul(gen[j]!, root)
    }
    gen[0] = dmGfMul(gen[0]!, root)
    genLen = newLen
  }

  // Polynomial division
  const remainder = new Uint8Array(ecCount)
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ remainder[ecCount - 1]!
    // Shift remainder
    for (let j = ecCount - 1; j >= 1; j--) {
      remainder[j] = remainder[j - 1]! ^ dmGfMul(gen[j]!, factor)
    }
    remainder[0] = dmGfMul(gen[0]!, factor)
  }

  // Return in reverse order (high to low)
  const result: number[] = new Array(ecCount)
  for (let i = 0; i < ecCount; i++) {
    result[i] = remainder[ecCount - 1 - i]!
  }
  return result
}

function computeEC(data: number[], size: DMSize): number[] {
  const numBlocks = size.blocks
  if (numBlocks === 1) {
    return computeDMReedSolomon(data, size.ecCodewords)
  }

  // Split data into interleaved blocks
  const dataPerBlock = Math.floor(size.dataCodewords / numBlocks)
  const ecPerBlock = Math.floor(size.ecCodewords / numBlocks)

  // De-interleave data into blocks
  const blocks: number[][] = new Array(numBlocks)
  for (let b = 0; b < numBlocks; b++) {
    blocks[b] = new Array(dataPerBlock)
  }
  for (let i = 0; i < data.length; i++) {
    const blockIdx = i % numBlocks
    const posInBlock = Math.floor(i / numBlocks)
    if (posInBlock < dataPerBlock) {
      blocks[blockIdx]![posInBlock] = data[i]!
    }
  }

  // Compute EC for each block
  const ecBlocks: number[][] = new Array(numBlocks)
  for (let b = 0; b < numBlocks; b++) {
    ecBlocks[b] = computeDMReedSolomon(blocks[b]!, ecPerBlock)
  }

  // Interleave EC codewords
  const result: number[] = new Array(size.ecCodewords)
  let idx = 0
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      result[idx++] = ecBlocks[b]![i]!
    }
  }
  return result
}

// ─── Data Placement (Utah Pattern) ───

function utahModule(matrix: Uint8Array, numRows: number, numCols: number, row: number, col: number, value: number, bit: number): void {
  // Wrap around: modules that go outside are wrapped
  if (row < 0) {
    row += numRows
    col += 4 - ((numRows + 4) % 8)
  }
  if (col < 0) {
    col += numCols
    row += 4 - ((numCols + 4) % 8)
  }
  // Set the bit
  if (value & (1 << (8 - bit))) {
    matrix[row * numCols + col] = 1
  }
  // Mark as visited (use bit 1 for visited flag)
  matrix[row * numCols + col] = matrix[row * numCols + col]! | 2
}

function placeUtah(matrix: Uint8Array, numRows: number, numCols: number, row: number, col: number, value: number): void {
  utahModule(matrix, numRows, numCols, row - 2, col - 2, value, 1)
  utahModule(matrix, numRows, numCols, row - 2, col - 1, value, 2)
  utahModule(matrix, numRows, numCols, row - 1, col - 2, value, 3)
  utahModule(matrix, numRows, numCols, row - 1, col - 1, value, 4)
  utahModule(matrix, numRows, numCols, row - 1, col, value, 5)
  utahModule(matrix, numRows, numCols, row, col - 2, value, 6)
  utahModule(matrix, numRows, numCols, row, col - 1, value, 7)
  utahModule(matrix, numRows, numCols, row, col, value, 8)
}

function placeCorner1(matrix: Uint8Array, numRows: number, numCols: number, value: number): void {
  utahModule(matrix, numRows, numCols, numRows - 1, 0, value, 1)
  utahModule(matrix, numRows, numCols, numRows - 1, 1, value, 2)
  utahModule(matrix, numRows, numCols, numRows - 1, 2, value, 3)
  utahModule(matrix, numRows, numCols, 0, numCols - 2, value, 4)
  utahModule(matrix, numRows, numCols, 0, numCols - 1, value, 5)
  utahModule(matrix, numRows, numCols, 1, numCols - 1, value, 6)
  utahModule(matrix, numRows, numCols, 2, numCols - 1, value, 7)
  utahModule(matrix, numRows, numCols, 3, numCols - 1, value, 8)
}

function placeCorner2(matrix: Uint8Array, numRows: number, numCols: number, value: number): void {
  utahModule(matrix, numRows, numCols, numRows - 3, 0, value, 1)
  utahModule(matrix, numRows, numCols, numRows - 2, 0, value, 2)
  utahModule(matrix, numRows, numCols, numRows - 1, 0, value, 3)
  utahModule(matrix, numRows, numCols, 0, numCols - 4, value, 4)
  utahModule(matrix, numRows, numCols, 0, numCols - 3, value, 5)
  utahModule(matrix, numRows, numCols, 0, numCols - 2, value, 6)
  utahModule(matrix, numRows, numCols, 0, numCols - 1, value, 7)
  utahModule(matrix, numRows, numCols, 1, numCols - 1, value, 8)
}

function placeCorner3(matrix: Uint8Array, numRows: number, numCols: number, value: number): void {
  utahModule(matrix, numRows, numCols, numRows - 3, 0, value, 1)
  utahModule(matrix, numRows, numCols, numRows - 2, 0, value, 2)
  utahModule(matrix, numRows, numCols, numRows - 1, 0, value, 3)
  utahModule(matrix, numRows, numCols, 0, numCols - 2, value, 4)
  utahModule(matrix, numRows, numCols, 0, numCols - 1, value, 5)
  utahModule(matrix, numRows, numCols, 1, numCols - 1, value, 6)
  utahModule(matrix, numRows, numCols, 2, numCols - 1, value, 7)
  utahModule(matrix, numRows, numCols, 3, numCols - 1, value, 8)
}

function placeCorner4(matrix: Uint8Array, numRows: number, numCols: number, value: number): void {
  utahModule(matrix, numRows, numCols, numRows - 1, 0, value, 1)
  utahModule(matrix, numRows, numCols, numRows - 1, numCols - 1, value, 2)
  utahModule(matrix, numRows, numCols, 0, numCols - 3, value, 3)
  utahModule(matrix, numRows, numCols, 0, numCols - 2, value, 4)
  utahModule(matrix, numRows, numCols, 0, numCols - 1, value, 5)
  utahModule(matrix, numRows, numCols, 1, numCols - 3, value, 6)
  utahModule(matrix, numRows, numCols, 1, numCols - 2, value, 7)
  utahModule(matrix, numRows, numCols, 1, numCols - 1, value, 8)
}

function placeModules(matrix: Uint8Array, numRows: number, numCols: number, codewords: number[]): void {
  let cwIdx = 0
  let row = 4
  let col = 0

  // Place corner cases
  // Corner case 1: numRows and numCols both divisible by 8
  // But we place them in sequence as encountered during the walk

  // Walk through the matrix in diagonal pattern
  while (true) {
    // Check corner cases
    if (row === numRows && col === 0) {
      placeCorner1(matrix, numRows, numCols, codewords[cwIdx]!)
      cwIdx++
    }
    if (row === numRows - 2 && col === 0 && numCols % 4 !== 0) {
      placeCorner2(matrix, numRows, numCols, codewords[cwIdx]!)
      cwIdx++
    }
    if (row === numRows - 2 && col === 0 && numCols % 8 === 4) {
      placeCorner3(matrix, numRows, numCols, codewords[cwIdx]!)
      cwIdx++
    }
    if (row === numRows + 4 && col === 2 && numCols % 8 === 0) {
      placeCorner4(matrix, numRows, numCols, codewords[cwIdx]!)
      cwIdx++
    }

    // Sweep upward-right
    while (true) {
      if (row < numRows && col >= 0 && !(matrix[row * numCols + col]! & 2)) {
        if (cwIdx < codewords.length) {
          placeUtah(matrix, numRows, numCols, row, col, codewords[cwIdx]!)
          cwIdx++
        }
      }
      row -= 2
      col += 2
      if (row < 0 || col >= numCols) break
    }
    row += 1
    col += 3

    // Sweep downward-left
    while (true) {
      if (row >= 0 && col < numCols && !(matrix[row * numCols + col]! & 2)) {
        if (cwIdx < codewords.length) {
          placeUtah(matrix, numRows, numCols, row, col, codewords[cwIdx]!)
          cwIdx++
        }
      }
      row += 2
      col -= 2
      if (row >= numRows || col < 0) break
    }
    row += 3
    col += 1

    if (row >= numRows && col >= numCols) break
  }

  // Fill unused modules with 0 (mark as visited)
  if (!(matrix[(numRows - 1) * numCols + numCols - 1]! & 2)) {
    matrix[(numRows - 1) * numCols + numCols - 1] = 1 | 2
    matrix[(numRows - 1) * numCols + numCols - 2] = 0 | 2
    matrix[(numRows - 2) * numCols + numCols - 1] = 0 | 2
    matrix[(numRows - 2) * numCols + numCols - 2] = 1 | 2
  }
}

// ─── Finder Pattern & Assembly ───

function buildFinalMatrix(placed: Uint8Array, dataRows: number, dataCols: number, size: DMSize): boolean[][] {
  const totalRows = size.rows
  const totalCols = size.cols
  const regionRows = size.regionRows
  const regionCols = size.regionCols

  const result: boolean[][] = new Array(totalRows)
  for (let r = 0; r < totalRows; r++) {
    result[r] = new Array(totalCols)
    for (let c = 0; c < totalCols; c++) {
      result[r]![c] = false
    }
  }

  // Place finder patterns (L-shape and clock track for each region)
  const regH = Math.floor(totalRows / regionRows)
  const regW = Math.floor(totalCols / regionCols)

  for (let rr = 0; rr < regionRows; rr++) {
    for (let rc = 0; rc < regionCols; rc++) {
      const baseRow = rr * regH
      const baseCol = rc * regW

      // Top clock track (alternating) — placed first so L-shape overrides corners
      for (let c = 0; c < regW; c++) {
        result[baseRow]![baseCol + c] = c % 2 === 0
      }
      // Right clock track (alternating, starting dark at bottom) — placed second so L-shape overrides corners
      for (let r = 0; r < regH; r++) {
        result[baseRow + r]![baseCol + regW - 1] = (regH - 1 - r) % 2 === 0
      }
      // Bottom solid line (L-shape bottom)
      for (let c = 0; c < regW; c++) {
        result[baseRow + regH - 1]![baseCol + c] = true
      }
      // Left solid line (L-shape left)
      for (let r = 0; r < regH; r++) {
        result[baseRow + r]![baseCol] = true
      }
    }
  }

  // Place data modules into the final matrix
  // Map from mapping matrix coordinates to final matrix coordinates
  for (let r = 0; r < dataRows * regionRows; r++) {
    for (let c = 0; c < dataCols * regionCols; c++) {
      if (placed[r * dataCols * regionCols + c]! & 1) {
        // Calculate which region this falls into
        const regionR = Math.floor(r / dataRows)
        const regionC = Math.floor(c / dataCols)
        const localR = r % dataRows
        const localC = c % dataCols

        // Final position: region offset + 1 (for finder) + local position
        const finalR = regionR * regH + 1 + localR
        const finalC = regionC * regW + 1 + localC

        result[finalR]![finalC] = true
      }
    }
  }

  return result
}

// ─── Main Export ───

export function generateDataMatrix(data: string): boolean[][] {
  const codewords = encodeDMData(data)
  const size = selectSize(codewords.length)

  // Pad codewords
  const padded = padCodewords(codewords, size.dataCodewords)

  // Compute error correction
  const ec = computeEC(padded, size)

  // Combine data + EC
  const allCodewords: number[] = new Array(padded.length + ec.length)
  for (let i = 0; i < padded.length; i++) {
    allCodewords[i] = padded[i]!
  }
  for (let i = 0; i < ec.length; i++) {
    allCodewords[padded.length + i] = ec[i]!
  }

  // Create mapping matrix
  const mappingRows = size.dataRows * size.regionRows
  const mappingCols = size.dataCols * size.regionCols
  const matrix = new Uint8Array(mappingRows * mappingCols)

  // Place modules using Utah pattern
  placeModules(matrix, mappingRows, mappingCols, allCodewords)

  // Build final matrix with finder patterns
  return buildFinalMatrix(matrix, size.dataRows, size.dataCols, size)
}

// Export internals for testing
export { encodeDMData, selectSize, DM_SIZES }
export type { DMSize }
