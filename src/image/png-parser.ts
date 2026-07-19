import { zlibInflate } from '../compression/inflate.js'

/** PNG image info */
export interface PngInfo {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
  palette: Uint8Array | null
  tRNS: Uint8Array | null
  idatData: Uint8Array
  sourceData: Uint8Array
}

export interface DecodedPngImage {
  width: number
  height: number
  pixels: Uint8Array
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

// Channel count per color type (0=gray, 2=RGB, 3=palette, 4=gray+alpha, 6=RGBA)
const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

// Allowed bit depths per color type (PNG spec 11.2.2)
const ALLOWED_BIT_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

// CRC32 lookup table (PNG spec Annex D)
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[n] = c >>> 0
}

function crc32(data: Uint8Array, start: number, end: number): number {
  let c = 0xFFFFFFFF
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xFF]! ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

function readU32BE(data: Uint8Array, offset: number): number {
  return ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0
}

/**
 * Parse PNG structure: IHDR fields, PLTE / tRNS payloads, and the
 * concatenated IDAT stream. Validates chunk CRCs and IHDR constraints.
 */
export function parsePngInfo(data: Uint8Array): PngInfo {
  if (data.length < 8 + 25) throw new Error('PNG: data too short')
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) throw new Error('PNG: invalid signature')
  }

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let sawIhdr = false
  let sawIend = false
  let palette: Uint8Array | null = null
  let tRNS: Uint8Array | null = null
  const idatChunks: Uint8Array[] = []
  let idatTotal = 0

  let offset = 8
  while (offset + 12 <= data.length) {
    const length = readU32BE(data, offset)
    if (offset + 12 + length > data.length) throw new Error('PNG: truncated chunk')
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    const expectedCrc = readU32BE(data, dataEnd)
    const actualCrc = crc32(data, typeStart, dataEnd)
    if (expectedCrc !== actualCrc) throw new Error('PNG: chunk CRC mismatch')

    const t0 = data[typeStart]!
    const t1 = data[typeStart + 1]!
    const t2 = data[typeStart + 2]!
    const t3 = data[typeStart + 3]!

    if (t0 === 0x49 && t1 === 0x48 && t2 === 0x44 && t3 === 0x52) { // IHDR
      if (sawIhdr) throw new Error('PNG: duplicate IHDR')
      if (length !== 13) throw new Error('PNG: invalid IHDR length')
      width = readU32BE(data, dataStart)
      height = readU32BE(data, dataStart + 4)
      bitDepth = data[dataStart + 8]!
      colorType = data[dataStart + 9]!
      const compression = data[dataStart + 10]!
      const filter = data[dataStart + 11]!
      interlace = data[dataStart + 12]!
      if (width === 0 || height === 0) throw new Error('PNG: invalid dimensions')
      const allowed = ALLOWED_BIT_DEPTHS[colorType]
      if (!allowed) throw new Error(`PNG: invalid color type ${colorType}`)
      if (allowed.indexOf(bitDepth) === -1) {
        throw new Error(`PNG: invalid bit depth ${bitDepth} for color type ${colorType}`)
      }
      if (compression !== 0) throw new Error(`PNG: unsupported compression method ${compression}`)
      if (filter !== 0) throw new Error(`PNG: unsupported filter method ${filter}`)
      if (interlace !== 0 && interlace !== 1) throw new Error(`PNG: unsupported interlace method ${interlace}`)
      sawIhdr = true
    } else if (t0 === 0x50 && t1 === 0x4C && t2 === 0x54 && t3 === 0x45) { // PLTE
      if (!sawIhdr) throw new Error('PNG: PLTE before IHDR')
      if (length === 0 || length % 3 !== 0 || length > 256 * 3) throw new Error('PNG: invalid PLTE length')
      palette = data.subarray(dataStart, dataEnd)
    } else if (t0 === 0x74 && t1 === 0x52 && t2 === 0x4E && t3 === 0x53) { // tRNS
      if (!sawIhdr) throw new Error('PNG: tRNS before IHDR')
      tRNS = data.subarray(dataStart, dataEnd)
    } else if (t0 === 0x49 && t1 === 0x44 && t2 === 0x41 && t3 === 0x54) { // IDAT
      if (!sawIhdr) throw new Error('PNG: IDAT before IHDR')
      idatChunks.push(data.subarray(dataStart, dataEnd))
      idatTotal += length
    } else if (t0 === 0x49 && t1 === 0x45 && t2 === 0x4E && t3 === 0x44) { // IEND
      sawIend = true
      break
    }
    // Ancillary chunks are skipped

    offset = dataEnd + 4
  }

  if (!sawIhdr) throw new Error('PNG: missing IHDR')
  if (!sawIend) throw new Error('PNG: missing IEND')
  if (idatChunks.length === 0) throw new Error('PNG: missing IDAT')
  if (colorType === 3 && !palette) throw new Error('PNG: palette image without PLTE')

  let idatData: Uint8Array
  if (idatChunks.length === 1) {
    idatData = idatChunks[0]!
  } else {
    idatData = new Uint8Array(idatTotal)
    let pos = 0
    for (let i = 0; i < idatChunks.length; i++) {
      idatData.set(idatChunks[i]!, pos)
      pos += idatChunks[i]!.length
    }
  }

  return { width, height, bitDepth, colorType, interlace, palette, tRNS, idatData, sourceData: data }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = p >= a ? p - a : a - p
  const pb = p >= b ? p - b : b - p
  const pc = p >= c ? p - c : c - p
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Reverse scanline filters in place (PNG spec 9. Filtering).
 * `raw` holds `height` scanlines, each prefixed with 1 filter-type byte.
 * Returns the number of bytes consumed from `raw`.
 */
function unfilterScanlines(raw: Uint8Array, offset: number, rowBytes: number, height: number, bpp: number): number {
  let pos = offset
  let prevRow = -1
  for (let y = 0; y < height; y++) {
    const filterType = raw[pos]!
    const row = pos + 1
    if (filterType === 1) { // Sub
      for (let x = bpp; x < rowBytes; x++) {
        raw[row + x] = (raw[row + x]! + raw[row + x - bpp]!) & 0xFF
      }
    } else if (filterType === 2) { // Up
      if (prevRow >= 0) {
        for (let x = 0; x < rowBytes; x++) {
          raw[row + x] = (raw[row + x]! + raw[prevRow + x]!) & 0xFF
        }
      }
    } else if (filterType === 3) { // Average
      if (prevRow >= 0) {
        for (let x = 0; x < bpp; x++) {
          raw[row + x] = (raw[row + x]! + (raw[prevRow + x]! >> 1)) & 0xFF
        }
        for (let x = bpp; x < rowBytes; x++) {
          raw[row + x] = (raw[row + x]! + ((raw[row + x - bpp]! + raw[prevRow + x]!) >> 1)) & 0xFF
        }
      } else {
        for (let x = bpp; x < rowBytes; x++) {
          raw[row + x] = (raw[row + x]! + (raw[row + x - bpp]! >> 1)) & 0xFF
        }
      }
    } else if (filterType === 4) { // Paeth
      if (prevRow >= 0) {
        for (let x = 0; x < bpp; x++) {
          raw[row + x] = (raw[row + x]! + raw[prevRow + x]!) & 0xFF
        }
        for (let x = bpp; x < rowBytes; x++) {
          raw[row + x] = (raw[row + x]! + paethPredictor(raw[row + x - bpp]!, raw[prevRow + x]!, raw[prevRow + x - bpp]!)) & 0xFF
        }
      } else {
        for (let x = bpp; x < rowBytes; x++) {
          raw[row + x] = (raw[row + x]! + raw[row + x - bpp]!) & 0xFF
        }
      }
    } else if (filterType !== 0) {
      throw new Error(`PNG: invalid filter type ${filterType}`)
    }
    prevRow = row
    pos = row + rowBytes
  }
  return pos - offset
}

/**
 * Read one sample (bit-packed, MSB first) from an unfiltered scanline.
 */
function readSample(row: Uint8Array, rowStart: number, index: number, bitDepth: number): number {
  if (bitDepth === 8) return row[rowStart + index]!
  if (bitDepth === 16) return row[rowStart + index * 2]! // scale 16-bit by taking the high byte
  const bitPos = index * bitDepth
  const byte = row[rowStart + (bitPos >> 3)]!
  const shift = 8 - bitDepth - (bitPos & 7)
  return (byte >> shift) & ((1 << bitDepth) - 1)
}

// Adam7 interlace pass layout (PNG spec 8.2)
const ADAM7_X_ORIGIN = [0, 4, 0, 2, 0, 1, 0]
const ADAM7_Y_ORIGIN = [0, 0, 4, 0, 2, 0, 1]
const ADAM7_X_STEP = [8, 8, 4, 4, 2, 2, 1]
const ADAM7_Y_STEP = [8, 8, 8, 4, 4, 2, 2]

/**
 * Convert unfiltered scanline samples of one (sub)image into RGBA8 output.
 * Writes pixel (xOrigin + x * xStep, yOrigin + y * yStep) for each sample.
 */
function emitPixels(
  raw: Uint8Array,
  rawOffset: number,
  passWidth: number,
  passHeight: number,
  rowBytes: number,
  info: PngInfo,
  rgba: Uint8Array,
  fullWidth: number,
  xOrigin: number,
  yOrigin: number,
  xStep: number,
  yStep: number,
): void {
  const bitDepth = info.bitDepth
  const colorType = info.colorType
  const palette = info.palette
  const tRNS = info.tRNS
  const maxSample = bitDepth === 16 ? 255 : (1 << bitDepth) - 1
  // Gray sample expansion factor to 8-bit (255 / maxSample is exact for 1/2/4/8)
  const grayScale = bitDepth === 16 ? 1 : 255 / maxSample

  // tRNS transparent color at full sample precision (source bit depth, or 16-bit)
  let transparentGray = -1
  let transparentR = -1
  let transparentG = -1
  let transparentB = -1
  if (tRNS && colorType === 0 && tRNS.length >= 2) {
    transparentGray = (tRNS[0]! << 8) | tRNS[1]!
  } else if (tRNS && colorType === 2 && tRNS.length >= 6) {
    transparentR = (tRNS[0]! << 8) | tRNS[1]!
    transparentG = (tRNS[2]! << 8) | tRNS[3]!
    transparentB = (tRNS[4]! << 8) | tRNS[5]!
  }

  for (let y = 0; y < passHeight; y++) {
    const rowStart = rawOffset + y * (rowBytes + 1) + 1
    let di = ((yOrigin + y * yStep) * fullWidth + xOrigin) * 4
    const diStep = xStep * 4

    if (colorType === 0) { // grayscale
      for (let x = 0; x < passWidth; x++) {
        let full: number
        let v: number
        if (bitDepth === 16) {
          const si = rowStart + x * 2
          full = (raw[si]! << 8) | raw[si + 1]!
          v = raw[si]!
        } else {
          full = readSample(raw, rowStart, x, bitDepth)
          v = (full * grayScale) & 0xFF
        }
        rgba[di] = v
        rgba[di + 1] = v
        rgba[di + 2] = v
        rgba[di + 3] = full === transparentGray ? 0 : 255
        di += diStep
      }
    } else if (colorType === 2) { // RGB
      const stride = bitDepth === 16 ? 6 : 3
      for (let x = 0; x < passWidth; x++) {
        const si = rowStart + x * stride
        if (bitDepth === 16) {
          const fr = (raw[si]! << 8) | raw[si + 1]!
          const fg = (raw[si + 2]! << 8) | raw[si + 3]!
          const fb = (raw[si + 4]! << 8) | raw[si + 5]!
          rgba[di] = raw[si]!
          rgba[di + 1] = raw[si + 2]!
          rgba[di + 2] = raw[si + 4]!
          rgba[di + 3] = (fr === transparentR && fg === transparentG && fb === transparentB) ? 0 : 255
        } else {
          const r = raw[si]!
          const g = raw[si + 1]!
          const b = raw[si + 2]!
          rgba[di] = r
          rgba[di + 1] = g
          rgba[di + 2] = b
          rgba[di + 3] = (r === transparentR && g === transparentG && b === transparentB) ? 0 : 255
        }
        di += diStep
      }
    } else if (colorType === 3) { // palette
      for (let x = 0; x < passWidth; x++) {
        const idx = readSample(raw, rowStart, x, bitDepth)
        const pi = idx * 3
        if (pi + 2 >= palette!.length) throw new Error(`PNG: palette index ${idx} out of range`)
        rgba[di] = palette![pi]!
        rgba[di + 1] = palette![pi + 1]!
        rgba[di + 2] = palette![pi + 2]!
        rgba[di + 3] = tRNS && idx < tRNS.length ? tRNS[idx]! : 255
        di += diStep
      }
    } else if (colorType === 4) { // grayscale + alpha
      const stride = bitDepth === 16 ? 4 : 2
      for (let x = 0; x < passWidth; x++) {
        const si = rowStart + x * stride
        const v = raw[si]!
        const a = bitDepth === 16 ? raw[si + 2]! : raw[si + 1]!
        rgba[di] = v
        rgba[di + 1] = v
        rgba[di + 2] = v
        rgba[di + 3] = a
        di += diStep
      }
    } else { // color type 6: RGBA
      const stride = bitDepth === 16 ? 8 : 4
      for (let x = 0; x < passWidth; x++) {
        const si = rowStart + x * stride
        if (bitDepth === 16) {
          rgba[di] = raw[si]!
          rgba[di + 1] = raw[si + 2]!
          rgba[di + 2] = raw[si + 4]!
          rgba[di + 3] = raw[si + 6]!
        } else {
          rgba[di] = raw[si]!
          rgba[di + 1] = raw[si + 1]!
          rgba[di + 2] = raw[si + 2]!
          rgba[di + 3] = raw[si + 3]!
        }
        di += diStep
      }
    }
  }
}

/**
 * Decode a PNG into RGBA 8-bit pixels.
 * Full spec coverage: bit depths 1/2/4/8/16, color types 0/2/3/4/6,
 * tRNS transparency, and Adam7 interlacing.
 */
export function decodePng(data: Uint8Array): DecodedPngImage {
  const info = parsePngInfo(data)
  const raw = zlibInflate(info.idatData)
  const width = info.width
  const height = info.height
  const channels = CHANNELS_BY_COLOR_TYPE[info.colorType]!
  const bitsPerPixel = channels * info.bitDepth
  const bpp = bitsPerPixel < 8 ? 1 : bitsPerPixel >> 3
  // A valid PNG's decompressed data holds at least width*height*bitsPerPixel/8
  // pixel bytes, so declared dimensions that cannot be backed by the actual
  // decompressed data are malformed. Reject them before allocating the RGBA
  // buffer, which would otherwise be a tiny file's path to a multi-GB alloc.
  if (width * height > raw.length * 8) {
    throw new Error('PNG: dimensions inconsistent with image data')
  }
  const rgba = new Uint8Array(width * height * 4)

  if (info.interlace === 0) {
    const rowBytes = (width * bitsPerPixel + 7) >> 3
    const expected = height * (rowBytes + 1)
    if (raw.length !== expected) throw new Error('PNG: invalid decompressed data length')
    unfilterScanlines(raw, 0, rowBytes, height, bpp)
    emitPixels(raw, 0, width, height, rowBytes, info, rgba, width, 0, 0, 1, 1)
    return { width, height, pixels: rgba }
  }

  // Adam7 interlacing: 7 sub-images, each filtered independently
  let offset = 0
  for (let pass = 0; pass < 7; pass++) {
    const xOrigin = ADAM7_X_ORIGIN[pass]!
    const yOrigin = ADAM7_Y_ORIGIN[pass]!
    const xStep = ADAM7_X_STEP[pass]!
    const yStep = ADAM7_Y_STEP[pass]!
    const passWidth = Math.ceil((width - xOrigin) / xStep)
    const passHeight = Math.ceil((height - yOrigin) / yStep)
    if (passWidth <= 0 || passHeight <= 0) continue
    const rowBytes = (passWidth * bitsPerPixel + 7) >> 3
    const passBytes = passHeight * (rowBytes + 1)
    if (offset + passBytes > raw.length) throw new Error('PNG: invalid decompressed data length')
    unfilterScanlines(raw, offset, rowBytes, passHeight, bpp)
    emitPixels(raw, offset, passWidth, passHeight, rowBytes, info, rgba, width, xOrigin, yOrigin, xStep, yStep)
    offset += passBytes
  }
  if (offset !== raw.length) throw new Error('PNG: invalid decompressed data length')

  return { width, height, pixels: rgba }
}

/**
 * Legacy API compatibility: decode the result of parsePngInfo into RGBA 8-bit
 */
export function decompressPng(info: PngInfo): Uint8Array {
  return decodePng(info.sourceData).pixels
}
