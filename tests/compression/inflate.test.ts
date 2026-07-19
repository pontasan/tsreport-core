import { describe, it, expect } from 'vitest'
import { gzipInflate, inflate, zlibInflate } from '../../src/compression/inflate.js'
import { deflateRawSync, deflateSync, gzipSync } from 'node:zlib'

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function gzipWithOptionalHeader(payload: Uint8Array): Uint8Array {
  const baseHeader = Uint8Array.from([0x1f, 0x8b, 8, 0x1e, 0, 0, 0, 0, 0, 255])
  const optional = Uint8Array.from([3, 0, 1, 2, 3, 0x66, 0x2e, 0x74, 0x78, 0, 0x6f, 0x6b, 0])
  const headerWithoutCrc = new Uint8Array(baseHeader.length + optional.length)
  headerWithoutCrc.set(baseHeader)
  headerWithoutCrc.set(optional, baseHeader.length)
  const header = new Uint8Array(headerWithoutCrc.length + 2)
  header.set(headerWithoutCrc)
  const headerCrc = crc32(headerWithoutCrc)
  header[headerWithoutCrc.length] = headerCrc & 0xff
  header[headerWithoutCrc.length + 1] = headerCrc >>> 8 & 0xff
  const compressed = Uint8Array.from(deflateRawSync(payload))
  const trailer = new Uint8Array(8)
  const view = new DataView(trailer.buffer)
  view.setUint32(0, crc32(payload), true)
  view.setUint32(4, payload.length, true)
  const output = new Uint8Array(header.length + compressed.length + trailer.length)
  output.set(header)
  output.set(compressed, header.length)
  output.set(trailer, header.length + compressed.length)
  return output
}

describe('inflate', () => {
  // Verifies raw deflate streams (zlib header/trailer stripped) produced by Node decompress correctly.
  it('should decompress raw deflate data', () => {
    const original = new TextEncoder().encode('Hello, World! This is a test of the inflate function.')
    const compressed = deflateSync(Buffer.from(original), { level: 6 })
    // deflateSync produces zlib format, skip 2-byte header and 4-byte trailer
    const rawDeflate = new Uint8Array(compressed.buffer, compressed.byteOffset + 2, compressed.byteLength - 6)
    const result = inflate(rawDeflate, original.length)
    expect(new TextDecoder().decode(result)).toBe('Hello, World! This is a test of the inflate function.')
  })

  // Verifies zlibInflate handles the full zlib wrapper (header + Adler-32 trailer) around deflate data.
  it('should decompress zlib format data', () => {
    const original = new TextEncoder().encode('This is zlib compressed data for testing purposes.')
    const compressed = deflateSync(Buffer.from(original), { level: 6 })
    const result = zlibInflate(new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength))
    expect(new TextDecoder().decode(result)).toBe('This is zlib compressed data for testing purposes.')
  })

  // Verifies LZ77 back-references are resolved correctly on highly repetitive input.
  it('should handle repeated data (LZ77 back-references)', () => {
    const text = 'ABCDEFGH'.repeat(100)
    const original = new TextEncoder().encode(text)
    const compressed = deflateSync(Buffer.from(original), { level: 9 })
    const result = zlibInflate(new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength))
    expect(new TextDecoder().decode(result)).toBe(text)
  })

  // Verifies stored (BTYPE=00, uncompressed) deflate blocks are decoded, produced via zlib level 0.
  it('should handle uncompressed blocks', () => {
    const original = new TextEncoder().encode('Test')
    const compressed = deflateSync(Buffer.from(original), { level: 0 }) // no compression
    const result = zlibInflate(new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength))
    expect(new TextDecoder().decode(result)).toBe('Test')
  })

  // Verifies a 10KB varied-byte input decompresses byte-for-byte, exercising dynamic Huffman blocks.
  it('should handle larger data', () => {
    // Generate varied data
    const data = new Uint8Array(10000)
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 37 + 13) & 0xFF
    }
    const compressed = deflateSync(Buffer.from(data), { level: 6 })
    const result = zlibInflate(new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength))
    expect(result.length).toBe(data.length)
    expect(result).toEqual(data)
  })

  // Verifies zlibInflate throws on a malformed zlib header instead of silently decoding garbage.
  it('should reject invalid zlib headers', () => {
    expect(() => zlibInflate(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toThrow()
  })

  it('rejects an invalid Adler-32 checksum', () => {
    const compressed = Uint8Array.from(deflateSync(Buffer.from('checksum')))
    compressed[compressed.length - 1] ^= 1
    expect(() => zlibInflate(compressed)).toThrow('invalid Adler-32 checksum')
  })

  it('decodes RFC 1950 preset-dictionary streams and validates DICTID', function () {
    const dictionary = new TextEncoder().encode('shared dictionary phrase: alpha beta gamma delta')
    const original = new TextEncoder().encode('alpha beta gamma delta; alpha beta gamma delta; payload')
    const compressed = Uint8Array.from(deflateSync(original, { dictionary }))
    expect(zlibInflate(compressed, dictionary)).toEqual(original)
    expect(() => zlibInflate(compressed)).toThrow('preset dictionary data is required')
    expect(() => zlibInflate(compressed, new TextEncoder().encode('wrong dictionary'))).toThrow('preset dictionary Adler-32 mismatch')
  })

  // Regression: an over-large declared outputSize (as a malicious WOFF table's
  // origLength could supply) must not drive a huge up-front allocation, yet the
  // real content must still decompress correctly via dynamic growth.
  it('ignores an implausibly large outputSize hint but still decodes correctly', () => {
    const original = new TextEncoder().encode('small payload')
    const compressed = deflateSync(Buffer.from(original), { level: 6 })
    const rawDeflate = new Uint8Array(compressed.buffer, compressed.byteOffset + 2, compressed.byteLength - 6)
    // Claim ~2GB of output from a few compressed bytes.
    const result = inflate(rawDeflate, 2 * 1024 * 1024 * 1024)
    expect(new TextDecoder().decode(result)).toBe('small payload')
  })
})

describe('inflate truncation rejection', () => {
  it('rejects a truncated stream', () => {
    const original = new Uint8Array(4000)
    for (let i = 0; i < original.length; i++) original[i] = (i * 31 + (i >> 3)) & 0xFF
    const compressed = deflateSync(Buffer.from(original))
    const rawDeflate = new Uint8Array(compressed.buffer, compressed.byteOffset + 2, compressed.byteLength - 6)
    // Cut the raw deflate stream well before its end.
    const truncated = rawDeflate.subarray(0, Math.floor(rawDeflate.length * 0.5))
    expect(() => inflate(truncated)).toThrow('unexpected end of data')
  })
})

describe('gzip inflate', function () {
  it('validates optional fields and concatenates RFC 1952 members', function () {
    const first = new TextEncoder().encode('first member; ')
    const second = new TextEncoder().encode('second member')
    const a = gzipWithOptionalHeader(first)
    const b = Uint8Array.from(gzipSync(second))
    const joined = new Uint8Array(a.length + b.length)
    joined.set(a)
    joined.set(b, a.length)
    expect(new TextDecoder().decode(gzipInflate(joined))).toBe('first member; second member')
  })

  it('rejects reserved flags and corrupt header/data checksums', function () {
    const valid = gzipWithOptionalHeader(new TextEncoder().encode('payload'))
    const reserved = valid.slice(); reserved[3] |= 0x20
    expect(() => gzipInflate(reserved)).toThrow('reserved flags')
    const headerCrc = valid.slice(); headerCrc[10] ^= 1
    expect(() => gzipInflate(headerCrc)).toThrow('header CRC')
    const dataCrc = valid.slice(); dataCrc[dataCrc.length - 8] ^= 1
    expect(() => gzipInflate(dataCrc)).toThrow('data CRC')
    const size = valid.slice(); size[size.length - 4] ^= 1
    expect(() => gzipInflate(size)).toThrow('uncompressed size')
  })
})
