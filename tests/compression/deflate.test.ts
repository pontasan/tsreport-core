import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { inflateRawSync, inflateSync } from 'node:zlib'
import { deflate, zlibDeflate } from '../../src/compression/deflate.js'
import { inflate, zlibInflate } from '../../src/compression/inflate.js'
import { parsePngInfo, decompressPng } from '../../src/image/png-parser.js'

describe('deflate', () => {
  // Verifies deflate/inflate round-trips zero-length input without error.
  it('round-trip: 空データ', () => {
    const data = new Uint8Array(0)
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed.length).toBe(0)
  })

  // Verifies the minimal single-byte input round-trips through deflate/inflate.
  it('round-trip: 1バイト', () => {
    const data = new Uint8Array([42])
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed).toEqual(data)
  })

  // Verifies inputs smaller than the LZ77 window minimum round-trip correctly.
  it('round-trip: 小さいデータ (< 32 bytes)', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed).toEqual(data)
  })

  // Verifies a repeating pattern round-trips and that LZ77 matching actually shrinks the output.
  it('round-trip: 繰り返しパターン（LZ77 圧縮効果あり）', () => {
    const data = new Uint8Array(1000)
    for (let i = 0; i < 1000; i++) data[i] = i % 10
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed).toEqual(data)
    // Repeating pattern, so the compression ratio should be good
    expect(compressed.length).toBeLessThan(data.length)
  })

  // Verifies pseudo-random (incompressible) data round-trips without corruption.
  it('round-trip: ランダムデータ', () => {
    const data = new Uint8Array(500)
    let seed = 12345
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
      data[i] = seed & 0xFF
    }
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed).toEqual(data)
  })

  // Verifies all 256 byte values round-trip, exercising the full literal alphabet.
  it('round-trip: 全バイト値', () => {
    const data = new Uint8Array(256)
    for (let i = 0; i < 256; i++) data[i] = i
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed).toEqual(data)
  })

  // Verifies a 64KB input round-trips, crossing the deflate block-size boundary.
  it('round-trip: 大きいデータ (64KB)', () => {
    const data = new Uint8Array(65536)
    for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 13) & 0xFF
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed).toEqual(data)
  })

  // Verifies a run of identical bytes round-trips and compresses to a tiny output (maximum-ratio case).
  it('round-trip: 同一バイト繰り返し（最大圧縮率）', () => {
    const data = new Uint8Array(10000)
    data.fill(0xAA)
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed).toEqual(data)
    expect(compressed.length).toBeLessThan(100)
  })

  // Verifies PNG-style scanline data (filter byte + pixels) round-trips, matching the encoder's main workload.
  it('round-trip: PNG フィルター風データ（Sub フィルター）', () => {
    // Simulates PNG row data: filter byte + pixel data
    const width = 100
    const height = 50
    const bpp = 3 // RGB
    const rowSize = 1 + width * bpp
    const data = new Uint8Array(rowSize * height)
    for (let y = 0; y < height; y++) {
      data[y * rowSize] = 1 // Sub filter
      for (let x = 0; x < width * bpp; x++) {
        data[y * rowSize + 1 + x] = (x + y) & 0xFF
      }
    }
    const compressed = deflate(data)
    const decompressed = inflate(compressed)
    expect(decompressed).toEqual(data)
  })

  // Verifies our deflate output is spec-conformant by decoding >64KB incompressible data with Node's inflateRaw.
  it('Node inflateRaw と互換（64KB超の incompressible データ）', () => {
    const data = new Uint8Array(300000)
    let seed = 0x12345678
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      data[i] = seed & 0xFF
    }

    const compressed = deflate(data)
    const decompressed = inflateRawSync(Buffer.from(compressed))
    expect(Buffer.compare(decompressed, Buffer.from(data))).toBe(0)
  })
})

describe('zlibDeflate', () => {
  // Verifies the zlib wrapper (header + Adler-32 trailer) round-trips through zlibInflate.
  it('round-trip: zlib ラッパー', () => {
    const data = new Uint8Array(100)
    for (let i = 0; i < 100; i++) data[i] = i % 26 + 65
    const compressed = zlibDeflate(data)
    const decompressed = zlibInflate(compressed)
    expect(decompressed).toEqual(data)
  })

  // Verifies reusable LZ77 work arrays do not leak hash chains or tokens between streams.
  it('異なる入力を交互に圧縮しても出力が決定的で汚染されない', () => {
    const first = new Uint8Array(4096)
    const second = new Uint8Array(3073)
    for (let i = 0; i < first.length; i++) first[i] = (i * 17 + (i >>> 3)) & 0xFF
    for (let i = 0; i < second.length; i++) second[i] = (i % 31) + 64

    const firstCompressed = zlibDeflate(first)
    const secondCompressed = zlibDeflate(second)
    expect(zlibDeflate(first)).toEqual(firstCompressed)
    expect(zlibDeflate(second)).toEqual(secondCompressed)
    expect(inflateSync(Buffer.from(firstCompressed))).toEqual(Buffer.from(first))
    expect(inflateSync(Buffer.from(secondCompressed))).toEqual(Buffer.from(second))
  })

  // Verifies the emitted zlib header has CMF 0x78 and a FLG making CMF*256+FLG divisible by 31 per RFC 1950.
  it('zlib ヘッダー検証', () => {
    const data = new Uint8Array([1, 2, 3])
    const compressed = zlibDeflate(data)
    // CMF = 0x78, FLG check
    expect(compressed[0]).toBe(0x78)
    expect((compressed[0]! * 256 + compressed[1]!) % 31).toBe(0)
  })

  // Verifies zlibDeflate/zlibInflate round-trip empty input.
  it('round-trip: 空データ', () => {
    const data = new Uint8Array(0)
    const compressed = zlibDeflate(data)
    const decompressed = zlibInflate(compressed)
    expect(decompressed.length).toBe(0)
  })

  // Verifies a 100KB input round-trips through the zlib wrapper across multiple blocks.
  it('round-trip: 大きいデータ', () => {
    const data = new Uint8Array(100000)
    for (let i = 0; i < data.length; i++) data[i] = (i * 3 + i % 17) & 0xFF
    const compressed = zlibDeflate(data)
    const decompressed = zlibInflate(compressed)
    expect(decompressed).toEqual(data)
  })

  // Verifies Node's inflate can decode our zlib output for ~13MB of real RGB image data; explicit timeout so parallel-worker CPU contention cannot fail the test.
  it('Node inflate と互換（RGB 画像チャネル相当の大容量データ）', { timeout: 30000 }, () => {
    const samplePngPath = new URL('../sample/images/sample1.png', import.meta.url)
    const samplePng = new Uint8Array(readFileSync(samplePngPath))
    const info = parsePngInfo(samplePng)
    const pixels = decompressPng(info)
    expect(info.colorType).toBe(6) // RGBA

    const rgb = new Uint8Array(info.width * info.height * 3)
    for (let si = 0, di = 0; si < pixels.length; si += 4, di += 3) {
      rgb[di] = pixels[si]!
      rgb[di + 1] = pixels[si + 1]!
      rgb[di + 2] = pixels[si + 2]!
    }

    const compressed = zlibDeflate(rgb)
    expect((compressed[2]! >>> 1) & 0x03).toBe(2)
    const decompressed = inflateSync(Buffer.from(compressed))
    expect(decompressed.length).toBe(rgb.length)
    expect(Buffer.compare(decompressed, Buffer.from(rgb))).toBe(0)
  })
})
