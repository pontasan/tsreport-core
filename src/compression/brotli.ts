import { brotliDecode } from './brotli-decode.js'
import { brotliEncode } from './brotli-encode/encode.js'
import { EncoderMode } from './brotli-encode/enc-constants.js'

export interface BrotliCompressionOptions {
  quality?: number
  windowBits?: number
  mode?: 'generic' | 'text' | 'font'
  sizeHint?: number
}

const MODE_VALUES = {
  generic: EncoderMode.GENERIC,
  text: EncoderMode.TEXT,
  font: EncoderMode.FONT,
} as const

/** Compresses bytes as an RFC 7932 Brotli stream. */
export function brotliCompress(data: Uint8Array, options: BrotliCompressionOptions = {}): Uint8Array {
  return brotliEncode(data, {
    quality: options.quality,
    lgwin: options.windowBits,
    mode: options.mode === undefined ? undefined : MODE_VALUES[options.mode],
    sizeHint: options.sizeHint ?? data.length,
  })
}

/** Decompresses an RFC 7932 Brotli stream. */
export function brotliDecompress(data: Uint8Array, expectedOutputSize?: number): Uint8Array {
  const input = new Int8Array(data.buffer, data.byteOffset, data.byteLength)
  const output = brotliDecode(input, expectedOutputSize === undefined
    ? undefined
    : { customDictionary: null, expectedOutputSize })
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
}

/** Compresses the transformed table stream used by a WOFF2 container. */
export function brotliCompressWoff2(data: Uint8Array): Uint8Array {
  return brotliCompress(data, { quality: 11, mode: 'font', sizeHint: data.length })
}
