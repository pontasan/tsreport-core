/**
 * Baseline TIFF decoder for sbix 'tiff' glyph graphics.
 *
 * Supports the baseline subset that appears in font bitmap data:
 * both byte orders, 8-bit samples, grayscale (1 sample), RGB (3 samples)
 * and RGBA (4 samples), with no compression or PackBits compression,
 * strip-based storage. Output is straight (non-premultiplied) RGBA.
 */

export interface DecodedTiffImage {
  width: number
  height: number
  /** RGBA pixels (4 bytes per pixel) */
  data: Uint8Array
}

// IFD tag ids (TIFF 6.0 baseline)
const TAG_IMAGE_WIDTH = 256
const TAG_IMAGE_LENGTH = 257
const TAG_BITS_PER_SAMPLE = 258
const TAG_COMPRESSION = 259
const TAG_PHOTOMETRIC = 262
const TAG_STRIP_OFFSETS = 273
const TAG_SAMPLES_PER_PIXEL = 277
const TAG_ROWS_PER_STRIP = 278
const TAG_STRIP_BYTE_COUNTS = 279

const COMPRESSION_NONE = 1
const COMPRESSION_PACKBITS = 32773

interface TiffField {
  type: number
  count: number
  /** Values resolved to numbers (offsets followed when needed) */
  values: number[]
}

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 7: 1, 8: 2, 9: 4 }

function readUint(view: DataView, offset: number, size: number, littleEndian: boolean): number {
  if (size === 1) return view.getUint8(offset)
  if (size === 2) return view.getUint16(offset, littleEndian)
  return view.getUint32(offset, littleEndian)
}

/** Decodes a baseline TIFF image into RGBA pixels */
export function decodeTiffToRgba(data: Uint8Array): DecodedTiffImage {
  if (data.length < 8) throw new Error('TIFF: file too small')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const byteOrder = (data[0]! << 8) | data[1]!
  let littleEndian: boolean
  if (byteOrder === 0x4949) littleEndian = true
  else if (byteOrder === 0x4D4D) littleEndian = false
  else throw new Error('TIFF: invalid byte order mark')

  if (view.getUint16(2, littleEndian) !== 42) throw new Error('TIFF: invalid magic number')

  const ifdOffset = view.getUint32(4, littleEndian)
  if (ifdOffset + 2 > data.length) throw new Error('TIFF: IFD offset out of range')

  // Read the first IFD
  const numEntries = view.getUint16(ifdOffset, littleEndian)
  const fields = new Map<number, TiffField>()
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    const tag = view.getUint16(entryOffset, littleEndian)
    const type = view.getUint16(entryOffset + 2, littleEndian)
    const count = view.getUint32(entryOffset + 4, littleEndian)
    const typeSize = TYPE_SIZES[type] ?? 0
    if (typeSize === 0) continue
    const totalSize = typeSize * count
    const valueOffset = totalSize <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, littleEndian)
    const values: number[] = []
    for (let v = 0; v < count; v++) {
      values.push(readUint(view, valueOffset + v * typeSize, typeSize, littleEndian))
    }
    fields.set(tag, { type, count, values })
  }

  const width = fields.get(TAG_IMAGE_WIDTH)?.values[0] ?? 0
  const height = fields.get(TAG_IMAGE_LENGTH)?.values[0] ?? 0
  if (width <= 0 || height <= 0) throw new Error('TIFF: missing image dimensions')

  const samplesPerPixel = fields.get(TAG_SAMPLES_PER_PIXEL)?.values[0] ?? 1
  const bitsPerSample = fields.get(TAG_BITS_PER_SAMPLE)?.values ?? [1]
  for (let i = 0; i < bitsPerSample.length; i++) {
    if (bitsPerSample[i] !== 8) {
      throw new Error(`TIFF: unsupported bits per sample ${bitsPerSample[i]}`)
    }
  }
  if (samplesPerPixel !== 1 && samplesPerPixel !== 3 && samplesPerPixel !== 4) {
    throw new Error(`TIFF: unsupported samples per pixel ${samplesPerPixel}`)
  }

  const compression = fields.get(TAG_COMPRESSION)?.values[0] ?? COMPRESSION_NONE
  if (compression !== COMPRESSION_NONE && compression !== COMPRESSION_PACKBITS) {
    throw new Error(`TIFF: unsupported compression ${compression}`)
  }

  const photometric = fields.get(TAG_PHOTOMETRIC)?.values[0] ?? 1

  const stripOffsets = fields.get(TAG_STRIP_OFFSETS)?.values
  const stripByteCounts = fields.get(TAG_STRIP_BYTE_COUNTS)?.values
  if (!stripOffsets || !stripByteCounts) throw new Error('TIFF: missing strip data')

  // Concatenate decoded strips into one sample buffer
  const rowBytes = width * samplesPerPixel
  const samples = new Uint8Array(rowBytes * height)
  let samplePos = 0
  for (let s = 0; s < stripOffsets.length; s++) {
    const offset = stripOffsets[s]!
    const count = stripByteCounts[s]!
    if (compression === COMPRESSION_NONE) {
      const end = Math.min(offset + count, data.length)
      for (let i = offset; i < end && samplePos < samples.length; i++) {
        samples[samplePos++] = data[i]!
      }
    } else {
      samplePos = unpackBits(data, offset, count, samples, samplePos)
    }
  }

  // Convert samples to RGBA
  const out = new Uint8Array(width * height * 4)
  const pixelCount = width * height
  if (samplesPerPixel === 1) {
    // Grayscale: photometric 0 = white-is-zero (inverted), 1 = black-is-zero
    const invert = photometric === 0
    for (let p = 0; p < pixelCount; p++) {
      const v = invert ? 255 - samples[p]! : samples[p]!
      const o = p * 4
      out[o] = v
      out[o + 1] = v
      out[o + 2] = v
      out[o + 3] = 255
    }
  } else if (samplesPerPixel === 3) {
    for (let p = 0; p < pixelCount; p++) {
      const i = p * 3
      const o = p * 4
      out[o] = samples[i]!
      out[o + 1] = samples[i + 1]!
      out[o + 2] = samples[i + 2]!
      out[o + 3] = 255
    }
  } else {
    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4
      out[i] = samples[i]!
      out[i + 1] = samples[i + 1]!
      out[i + 2] = samples[i + 2]!
      out[i + 3] = samples[i + 3]!
    }
  }

  return { width, height, data: out }
}

/** PackBits decompression (TIFF 6.0 section 9) */
function unpackBits(
  src: Uint8Array, offset: number, count: number,
  dst: Uint8Array, dstPos: number,
): number {
  let i = offset
  const end = Math.min(offset + count, src.length)
  while (i < end && dstPos < dst.length) {
    const n = src[i]! > 127 ? src[i]! - 256 : src[i]!
    i++
    if (n >= 0) {
      // Copy n+1 literal bytes
      for (let c = 0; c <= n && i < end && dstPos < dst.length; c++) {
        dst[dstPos++] = src[i++]!
      }
    } else if (n !== -128) {
      // Repeat the next byte -n+1 times
      if (i >= end) break
      const b = src[i++]!
      for (let c = 0; c < 1 - n && dstPos < dst.length; c++) {
        dst[dstPos++] = b
      }
    }
  }
  return dstPos
}
