import { decodeRasterWithExternalDecoder } from './external-image-decoder.js'

/** WebP image info */
export interface WebpInfo {
  width: number
  height: number
  hasAlpha: boolean
  format: 'VP8' | 'VP8L' | 'VP8X'
}

/** Decoded image */
export interface DecodedImage {
  width: number
  height: number
  pixels: Uint8Array
  iccProfile?: Uint8Array
}

/**
 * Parse WebP container / bitstream headers (pure TypeScript).
 * Supports lossy (VP8), lossless (VP8L) and extended (VP8X) layouts.
 */
export function parseWebpInfo(data: Uint8Array): WebpInfo {
  if (data.length < 30 ||
      data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46 ||
      data[8] !== 0x57 || data[9] !== 0x45 || data[10] !== 0x42 || data[11] !== 0x50) {
    throw new Error('WebP: invalid RIFF header')
  }

  const c0 = data[12]!, c1 = data[13]!, c2 = data[14]!, c3 = data[15]!

  // VP8X (extended): flags byte at offset 20, canvas size at offset 24-29
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x58) {
    const flags = data[20]!
    const width = 1 + ((data[24]!) | (data[25]! << 8) | (data[26]! << 16))
    const height = 1 + ((data[27]!) | (data[28]! << 8) | (data[29]! << 16))
    return { width, height, hasAlpha: (flags & 0x10) !== 0, format: 'VP8X' }
  }

  // VP8L (lossless): signature byte 0x2F, then 14-bit width-1, 14-bit height-1, 1-bit alpha
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x4C) {
    if (data[20] !== 0x2F) throw new Error('WebP: invalid VP8L signature')
    const bits = (data[21]!) | (data[22]! << 8) | (data[23]! << 16) | (data[24]! << 24)
    const width = (bits & 0x3FFF) + 1
    const height = ((bits >> 14) & 0x3FFF) + 1
    const hasAlpha = ((bits >> 28) & 1) !== 0
    return { width, height, hasAlpha, format: 'VP8L' }
  }

  // VP8 (lossy): key frame start code 9D 01 2A after the 3-byte frame tag
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x20) {
    if (data[23] !== 0x9D || data[24] !== 0x01 || data[25] !== 0x2A) {
      throw new Error('WebP: invalid VP8 key frame')
    }
    const width = ((data[26]!) | (data[27]! << 8)) & 0x3FFF
    const height = ((data[28]!) | (data[29]! << 8)) & 0x3FFF
    return { width, height, hasAlpha: false, format: 'VP8' }
  }

  throw new Error('WebP: unknown chunk layout')
}

/**
 * Decode a WebP image into RGBA via an external decoder
 * (Node runtime with the optional "sharp" package installed)
 */
export function decodeWebp(data: Uint8Array): DecodedImage {
  const decoded = decodeRasterWithExternalDecoder(data, 'webp')
  return {
    width: decoded.width,
    height: decoded.height,
    pixels: decoded.pixels,
  }
}
