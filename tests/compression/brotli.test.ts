import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { brotliCompress, brotliDecompress } from '../../src/compression/brotli.js'
import { createBlockSplit, splitBlock } from '../../src/compression/brotli-encode/block-splitter.js'
import { createCommand, createInsertCommand } from '../../src/compression/brotli-encode/command.js'

const WOFF2_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.woff2')
const WOFF2_CONFORMANCE_PATHS = [
  ...Array.from({ length: 8 }, (_, index) =>
    resolve(__dirname, `../fixtures/woff2-w3c/Format/Tests/xhtml1/valid-${String(index + 1).padStart(3, '0')}.woff2`)),
  'roundtrip-collection-dsig-001.woff2',
  'roundtrip-collection-order-001.woff2',
  'roundtrip-hmtx-lsb-001.woff2',
  'roundtrip-offset-tables-001.woff2',
].map((path) => path.startsWith('/')
  ? path
  : resolve(__dirname, '../fixtures/woff2-w3c/Decoder/Tests/xhtml1', path))

function readUIntBase128(bytes: Uint8Array, offset: { value: number }): number {
  let result = 0
  for (let index = 0; index < 5; index++) {
    const value = bytes[offset.value++]!
    result = result * 128 + (value & 0x7f)
    if ((value & 0x80) === 0) return result
  }
  throw new Error('Invalid UIntBase128 value')
}

function read255UInt16(bytes: Uint8Array, offset: { value: number }): number {
  const code = bytes[offset.value++]!
  if (code === 253) {
    const value = (bytes[offset.value]! << 8) | bytes[offset.value + 1]!
    offset.value += 2
    return value
  }
  if (code === 255) return bytes[offset.value++]! + 253
  if (code === 254) return bytes[offset.value++]! + 506
  return code
}

function extractWoff2BrotliStream(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flavor = view.getUint32(4, false)
  const tableCount = view.getUint16(12, false)
  const compressedLength = view.getUint32(20, false)
  const offset = { value: 48 }
  for (let index = 0; index < tableCount; index++) {
    const flags = bytes[offset.value++]!
    const tagIndex = flags & 0x3f
    if (tagIndex === 63) offset.value += 4
    readUIntBase128(bytes, offset)
    const transformVersion = flags >>> 6
    const transformed = tagIndex === 10 || tagIndex === 11 ? transformVersion === 0 : transformVersion !== 0
    if (transformed) readUIntBase128(bytes, offset)
  }
  if (flavor === 0x74746366) {
    offset.value += 4
    const fontCount = read255UInt16(bytes, offset)
    for (let font = 0; font < fontCount; font++) {
      const fontTableCount = read255UInt16(bytes, offset)
      offset.value += 4
      for (let table = 0; table < fontTableCount; table++) read255UInt16(bytes, offset)
    }
  }
  return bytes.subarray(offset.value, offset.value + compressedLength)
}

describe('Brotli decompression', function () {
  it('matches the reference decoder byte-for-byte for a real WOFF2 table stream', function () {
    const compressed = extractWoff2BrotliStream(Uint8Array.from(readFileSync(WOFF2_PATH)))
    const expected = Uint8Array.from(brotliDecompressSync(compressed))
    expect(brotliDecompress(compressed)).toEqual(expected)
    expect(brotliDecompress(compressed, expected.length)).toEqual(expected)
    expect(() => brotliDecompress(compressed, expected.length - 1)).toThrow(
      'decompressed length does not match the expected output size',
    )
  })

  it.each(WOFF2_CONFORMANCE_PATHS)('matches the reference decoder byte-for-byte for %s', function (path) {
    const compressed = extractWoff2BrotliStream(Uint8Array.from(readFileSync(path)))
    expect(brotliDecompress(compressed)).toEqual(Uint8Array.from(brotliDecompressSync(compressed)))
  })

  for (const quality of [0, 1, 4, 7, 9, 11]) {
    it(`matches a quality ${quality} font-mode stream`, function () {
      const source = new TextEncoder().encode(
        'The quick brown fox jumps over the lazy dog. '.repeat(97) +
        '\u0000\u0001\u0002abcdefghijklmnopqrstuvwxyz'.repeat(41),
      )
      const compressed = Uint8Array.from(brotliCompressSync(source, {
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
          [constants.BROTLI_PARAM_QUALITY]: quality,
        },
      }))
      expect(brotliDecompress(compressed)).toEqual(source)
    })
  }
})

describe('Brotli compression', function () {
  it('excludes insert-only commands from the distance block sequence', function () {
    const literalSplit = createBlockSplit()
    const commandSplit = createBlockSplit()
    const distanceSplit = createBlockSplit()
    const commands = [
      createCommand(0, 4, 0, 16),
      createInsertCommand(1000),
    ]
    splitBlock(commands, new Uint8Array(1004), 0, 2047, 11, literalSplit, commandSplit, distanceSplit)
    let distanceCount = 0
    for (let block = 0; block < distanceSplit.numBlocks; block++) distanceCount += distanceSplit.lengths[block]!
    expect(distanceCount).toBe(1)
  })

  it.each([0, 1, 2, 4, 7, 9, 10, 11])('produces a reference-decodable quality %i stream', function (quality) {
    const source = new TextEncoder().encode(
      '多言語帳票 Brotli conformance 中文 한국어 العربية. '.repeat(113) +
      '\u0000\u0001\u0002abcdefghijklmnopqrstuvwxyz'.repeat(37),
    )
    const encoded = brotliCompress(source, { quality, mode: 'font' })
    expect(Uint8Array.from(brotliDecompressSync(encoded))).toEqual(source)
    expect(brotliDecompress(encoded)).toEqual(source)
  })

  it('preserves input beyond the selected sliding window', function () {
    const source = new Uint8Array(64 * 1024 + 257)
    let state = 0x6d2b79f5
    for (let index = 0; index < source.length; index++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      source[index] = state
    }
    const encoded = brotliCompress(source, { quality: 2, mode: 'font', windowBits: 10 })
    expect(Uint8Array.from(brotliDecompressSync(encoded))).toEqual(source)
    expect(brotliDecompress(encoded)).toEqual(source)
  })

  it('round-trips a real WOFF2 table stream with reference-comparable size', function () {
    const compressed = extractWoff2BrotliStream(Uint8Array.from(readFileSync(WOFF2_PATH)))
    const source = Uint8Array.from(brotliDecompressSync(compressed))

    const referenceEncoded = Uint8Array.from(brotliCompressSync(source, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    }))
    const encoded = brotliCompress(source, { quality: 11, mode: 'font' })

    expect(Uint8Array.from(brotliDecompressSync(encoded))).toEqual(source)
    expect(brotliDecompress(encoded)).toEqual(source)
    const maximumComparableSize = Math.max(
      Math.ceil(referenceEncoded.length * 1.02),
      referenceEncoded.length + 128,
    )
    expect(encoded.length).toBeLessThanOrEqual(maximumComparableSize)
  }, 20_000)

  it.each(WOFF2_CONFORMANCE_PATHS)('recompresses and round-trips the real WOFF2 stream in %s', function (path) {
    const compressed = extractWoff2BrotliStream(Uint8Array.from(readFileSync(path)))
    const source = Uint8Array.from(brotliDecompressSync(compressed))
    const referenceEncoded = Uint8Array.from(brotliCompressSync(source, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    }))
    const encoded = brotliCompress(source, { quality: 11, mode: 'font' })

    expect(Uint8Array.from(brotliDecompressSync(encoded))).toEqual(source)
    expect(brotliDecompress(encoded)).toEqual(source)
    const maximumComparableSize = Math.max(
      Math.ceil(referenceEncoded.length * 1.02),
      referenceEncoded.length + 128,
    )
    expect(encoded.length).toBeLessThanOrEqual(maximumComparableSize)
  })
})
