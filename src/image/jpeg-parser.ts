/**
 * JPEG header parser
 *
 * Extracts width/height/components from the SOF marker.
 * Does not perform decoding itself (PDF passes JPEG through via DCTDecode).
 */

/** JPEG image info */
export interface JpegInfo {
  width: number
  height: number
  components: number
  bitsPerComponent: number
  isAdobeCMYK: boolean
}

/**
 * Extract header info from JPEG data
 */
export function parseJpegInfo(data: Uint8Array): JpegInfo {
  let pos = 0
  const len = data.length

  if (len < 2 || data[0] !== 0xFF || data[1] !== 0xD8) {
    throw new Error('JPEG: invalid SOI marker')
  }
  pos = 2

  let width = 0
  let height = 0
  let components = 0
  let bitsPerComponent = 8
  let isAdobeCMYK = false
  let foundSOF = false

  while (pos < len - 1) {
    if (data[pos] !== 0xFF) {
      pos++
      continue
    }

    while (pos < len && data[pos] === 0xFF) pos++
    if (pos >= len) break

    const marker = data[pos]!
    pos++

    if (marker === 0x00 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
      continue
    }

    if (pos + 1 >= len) break
    const segLen = (data[pos]! << 8) | data[pos + 1]!
    if (segLen < 2) break

    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (!foundSOF && pos + 7 < len) {
        bitsPerComponent = data[pos + 2]!
        height = (data[pos + 3]! << 8) | data[pos + 4]!
        width = (data[pos + 5]! << 8) | data[pos + 6]!
        components = data[pos + 7]!
        foundSOF = true
      }
    }

    if (marker === 0xEE && segLen >= 14) {
      if (pos + 13 < len &&
          data[pos + 2] === 0x41 && data[pos + 3] === 0x64 &&
          data[pos + 4] === 0x6F && data[pos + 5] === 0x62 &&
          data[pos + 6] === 0x65) {
        const colorTransform = data[pos + 13]!
        if (colorTransform === 0 || colorTransform === 2) {
          isAdobeCMYK = true
        }
      }
    }

    if (marker === 0xDA) break

    pos += segLen
  }

  if (!foundSOF) {
    throw new Error('JPEG: SOF marker not found')
  }

  return { width, height, components, bitsPerComponent, isAdobeCMYK }
}
