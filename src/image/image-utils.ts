/**
 * Image utilities
 *
 * Image format detection, base64/data URI → Uint8Array conversion
 */

/** Image format */
export type ImageFormat = 'jpeg' | 'png' | 'svg' | 'webp' | 'avif' | 'jpx' | 'jbig2' | 'unknown'

/**
 * Detect the image format from the binary data's magic bytes
 */
export function detectImageFormat(data: Uint8Array): ImageFormat {
  if (data.length < 4) return 'unknown'

  // JPEG: FF D8 FF
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return 'png'

  // WebP: RIFF....WEBP
  if (data.length >= 12 &&
      data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'webp'

  // AVIF: ftyp box with avif/avis/mif1 brand
  if (isAvifData(data)) return 'avif'

  // JPEG 2000: raw codestream (SOC marker) or JP2 signature box
  if (isJpxData(data)) return 'jpx'

  // SVG: XML header or <svg
  if (isSvgData(data)) return 'svg'

  return 'unknown'
}

function isJpxData(data: Uint8Array): boolean {
  if (data.length >= 2 && data[0] === 0xFF && data[1] === 0x4F) return true
  return data.length >= 12 &&
    data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x00 && data[3] === 0x0C &&
    data[4] === 0x6A && data[5] === 0x50 && data[6] === 0x20 && data[7] === 0x20 &&
    data[8] === 0x0D && data[9] === 0x0A && data[10] === 0x87 && data[11] === 0x0A
}

/**
 * Check whether the ISOBMFF ftyp box's major_brand / compatible_brands contain an AVIF-related brand
 */
function isAvifData(data: Uint8Array): boolean {
  if (data.length < 12) return false
  // ftyp box: offset 4-7 = 'ftyp'
  if (data[4] !== 0x66 || data[5] !== 0x74 || data[6] !== 0x79 || data[7] !== 0x70) return false
  const boxSize = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!
  const end = Math.min(boxSize, data.length)
  // Scan major_brand (offset 8-11) + compatible_brands (4 bytes each from offset 16)
  for (let off = 8; off + 3 < end; off += 4) {
    if (off === 12) continue // skip minor_version
    const b0 = data[off]!
    const b1 = data[off + 1]!
    const b2 = data[off + 2]!
    const b3 = data[off + 3]!
    // 'avif' = 61 76 69 66, 'avis' = 61 76 69 73, 'mif1' = 6D 69 66 31
    if ((b0 === 0x61 && b1 === 0x76 && b2 === 0x69 && (b3 === 0x66 || b3 === 0x73)) ||
        (b0 === 0x6D && b1 === 0x69 && b2 === 0x66 && b3 === 0x31)) return true
  }
  return false
}

/**
 * Check whether the binary data is SVG
 * i.e. whether it starts with <?xml ... or <svg
 */
function isSvgData(data: Uint8Array): boolean {
  // Skip BOM
  let start = 0
  if (data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
    start = 3
  }
  // Skip whitespace
  while (start < data.length && (data[start] === 0x20 || data[start] === 0x09 || data[start] === 0x0A || data[start] === 0x0D)) {
    start++
  }
  if (start >= data.length) return false
  // <svg or <?xml
  if (data[start] === 0x3C) { // '<'
    if (start + 3 < data.length && data[start + 1] === 0x73 && data[start + 2] === 0x76 && data[start + 3] === 0x67) return true // <svg
    if (start + 4 < data.length && data[start + 1] === 0x3F && data[start + 2] === 0x78 && data[start + 3] === 0x6D && data[start + 4] === 0x6C) return true // <?xml
  }
  return false
}

// base64 decode table
const B64_DECODE = new Uint8Array(128)
for (let i = 0; i < 128; i++) B64_DECODE[i] = 0xFF
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (let i = 0; i < 64; i++) B64_DECODE[B64_CHARS.charCodeAt(i)] = i

// Maps a character code to its 6-bit base64 value, rejecting anything outside
// the base64 alphabet. Without this, an out-of-range (>= 128) code reads
// undefined and a marked-invalid (0xFF) code both silently decode as 'A' (0),
// turning corrupt input into wrong bytes instead of a clear error.
function base64Value(code: number): number {
  const v = code < 128 ? B64_DECODE[code]! : 0xFF
  if (v === 0xFF) {
    throw new Error('decodeBase64: invalid base64 character')
  }
  return v
}

/**
 * Decode a base64 string into a Uint8Array
 */
export function decodeBase64(base64: string): Uint8Array {
  // Strip padding + compute output size
  let len = base64.length
  while (len > 0 && base64.charCodeAt(len - 1) === 0x3D) len-- // '='
  const outLen = (len * 3) >>> 2
  const out = new Uint8Array(outLen)
  let outPos = 0

  for (let i = 0; i < len;) {
    const b0 = base64Value(base64.charCodeAt(i++))
    const b1 = i < len ? base64Value(base64.charCodeAt(i++)) : 0
    const b2 = i < len ? base64Value(base64.charCodeAt(i++)) : 0
    const b3 = i < len ? base64Value(base64.charCodeAt(i++)) : 0
    const triplet = (b0 << 18) | (b1 << 12) | (b2 << 6) | b3
    if (outPos < outLen) out[outPos++] = (triplet >> 16) & 0xFF
    if (outPos < outLen) out[outPos++] = (triplet >> 8) & 0xFF
    if (outPos < outLen) out[outPos++] = triplet & 0xFF
  }

  return out
}

/**
 * Fast extraction of pixel dimensions from JPEG/PNG headers.
 * Returns null for SVG and unknown formats.
 */
export function getImageDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 4) return null

  // PNG: IHDR is at a fixed offset (bytes 16-23: width 4 bytes + height 4 bytes)
  if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    const w = (data[16]! << 24) | (data[17]! << 16) | (data[18]! << 8) | data[19]!
    const h = (data[20]! << 24) | (data[21]! << 16) | (data[22]! << 8) | data[23]!
    return { width: w >>> 0, height: h >>> 0 }
  }

  // WebP: RIFF....WEBP + VP8/VP8L/VP8X
  if (data.length >= 30 &&
      data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return getWebpDimensions(data)
  }

  // AVIF: ISOBMFF ispe box
  if (isAvifData(data)) {
    return getAvifDimensions(data)
  }

  // JPEG: scan for SOF marker
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xFF) break
      const marker = data[offset + 1]!
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
        const h = (data[offset + 5]! << 8) | data[offset + 6]!
        const w = (data[offset + 7]! << 8) | data[offset + 8]!
        return { width: w, height: h }
      }
      // SOS or data — stop scanning
      if (marker === 0xDA) break
      // Skip marker segment
      const segLen = (data[offset + 2]! << 8) | data[offset + 3]!
      offset += 2 + segLen
    }
    return null
  }

  return null
}

/**
 * Extract dimensions from the WebP header
 */
function getWebpDimensions(data: Uint8Array): { width: number; height: number } | null {
  // offset 12: chunk FourCC
  if (data.length < 30) return null
  const c0 = data[12]!, c1 = data[13]!, c2 = data[14]!, c3 = data[15]!

  // VP8X (extended format): canvas size at offset 24-29
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x58) { // 'VP8X'
    if (data.length < 30) return null
    const w = 1 + ((data[24]!) | (data[25]! << 8) | (data[26]! << 16))
    const h = 1 + ((data[27]!) | (data[28]! << 8) | (data[29]! << 16))
    return { width: w, height: h }
  }

  // VP8L (lossless): chunk data starts at offset 20, signature 0x2F is first byte
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x4C) { // 'VP8L'
    if (data.length < 25) return null
    if (data[20] !== 0x2F) return null
    const bits = (data[21]!) | (data[22]! << 8) | (data[23]! << 16) | (data[24]! << 24)
    const w = (bits & 0x3FFF) + 1
    const h = ((bits >> 14) & 0x3FFF) + 1
    return { width: w, height: h }
  }

  // VP8 (lossy): frame header at offset 20 (after chunk header)
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x20) { // 'VP8 '
    if (data.length < 30) return null
    // offset 20-22: frame tag (3 bytes), followed by key frame start code 9D 01 2A
    const off = 20
    // frame_tag: 3 bytes
    // Check for key frame start code at offset 23
    if (data[off + 3] !== 0x9D || data[off + 4] !== 0x01 || data[off + 5] !== 0x2A) return null
    const w = (data[off + 6]!) | (data[off + 7]! << 8)
    const h = (data[off + 8]!) | (data[off + 9]! << 8)
    return { width: w & 0x3FFF, height: h & 0x3FFF }
  }

  return null
}

/**
 * Find the ispe box in an AVIF (ISOBMFF) and extract dimensions
 */
function getAvifDimensions(data: Uint8Array): { width: number; height: number } | null {
  // Find the ispe box with a simple byte scan (nested box traversal not needed)
  // ispe = 69 73 70 65, followed by version(1) + flags(3) + width(4) + height(4)
  const len = data.length
  for (let i = 0; i + 12 <= len; i++) {
    if (data[i] === 0x69 && data[i + 1] === 0x73 && data[i + 2] === 0x70 && data[i + 3] === 0x65) {
      // ispe box: check that preceding 4 bytes give valid box size
      if (i >= 4) {
        const boxSize = (data[i - 4]! << 24) | (data[i - 3]! << 16) | (data[i - 2]! << 8) | data[i - 1]!
        if (boxSize !== 20) continue // ispe full box is always 20 bytes
      }
      // version(1) + flags(3) = 4 bytes after type
      const wOff = i + 4 + 4 // type(4) + version+flags(4)
      if (wOff + 8 > len) continue
      const w = (data[wOff]! << 24) | (data[wOff + 1]! << 16) | (data[wOff + 2]! << 8) | data[wOff + 3]!
      const h = (data[wOff + 4]! << 24) | (data[wOff + 5]! << 16) | (data[wOff + 6]! << 8) | data[wOff + 7]!
      return { width: w >>> 0, height: h >>> 0 }
    }
  }
  return null
}

/**
 * Normalize image data (string | Uint8Array) into a Uint8Array
 * - Uint8Array: returned as-is
 * - data URI ("data:image/...;base64,..."):  decode the base64 part
 * - base64 string: decode
 */
export function normalizeImageData(source: string | Uint8Array): Uint8Array {
  if (source instanceof Uint8Array) return source

  // data URI
  const commaIdx = source.indexOf(',')
  if (source.length > 5 && source.charCodeAt(0) === 0x64 /* d */ && commaIdx !== -1 && source.substring(0, 5) === 'data:') {
    return decodeBase64(source.substring(commaIdx + 1))
  }

  // raw base64
  return decodeBase64(source)
}
