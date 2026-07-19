import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { zlibDeflate } from '../../src/compression/deflate.js'
import { decodePng } from '../../src/image/png-parser.js'
import { convertRawToRgba8 } from '../../src/image/external-image-decoder.js'
import {
  createPureRasterImageDecoder,
  createNodeExternalRasterImageDecoder,
  setDefaultRasterImageDecoder,
  getDefaultRasterImageDecoder,
  type RasterImageDecoder,
  type DecodedRgbaImage,
} from '../../src/renderer/raster-image-decoder.js'

function loadSample(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../sample/images/${name}`, import.meta.url)))
}

/** CRC32 (PNG spec Annex D) */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const tb = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)])
  const ci = new Uint8Array(4 + data.length)
  ci.set(tb); ci.set(data, 4)
  const crc = crc32(ci)
  const chunk = new Uint8Array(12 + data.length)
  chunk[0] = (data.length >> 24) & 0xFF; chunk[1] = (data.length >> 16) & 0xFF
  chunk[2] = (data.length >> 8) & 0xFF; chunk[3] = data.length & 0xFF
  chunk.set(tb, 4); chunk.set(data, 8)
  chunk[8 + data.length] = (crc >> 24) & 0xFF; chunk[8 + data.length + 1] = (crc >> 16) & 0xFF
  chunk[8 + data.length + 2] = (crc >> 8) & 0xFF; chunk[8 + data.length + 3] = crc & 0xFF
  return chunk
}

/** Minimal 2x2 RGBA PNG with deterministic pixel values */
function makeTestPng(): Uint8Array {
  const ihdr = new Uint8Array(13)
  ihdr[3] = 2; ihdr[7] = 2; ihdr[8] = 8; ihdr[9] = 6
  const raw = new Uint8Array([
    0, 255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 0, 255, 128, 10, 20, 30, 40,
  ])
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const chunks = [makeChunk('IHDR', ihdr), makeChunk('IDAT', zlibDeflate(raw)), makeChunk('IEND', new Uint8Array(0))]
  let total = sig.length
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  out.set(sig)
  let pos = sig.length
  for (const c of chunks) { out.set(c, pos); pos += c.length }
  return out
}

const TEST_PNG_PIXELS = new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 255,
  0, 0, 255, 128, 10, 20, 30, 40,
])

describe('Raster image decoder: pure decoder', () => {
  // Verifies the pure decoder decodes PNG in-process.
  it('decodes PNG', () => {
    const decoder = createPureRasterImageDecoder()
    const decoded = decoder.decodeRgba(makeTestPng(), 'png')
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.pixels).toEqual(TEST_PNG_PIXELS)
  })

  // Verifies WebP/AVIF throw with guidance on how to inject a decoder.
  it('throws for WebP and AVIF with injection guidance', () => {
    const decoder = createPureRasterImageDecoder()
    const webp = loadSample('test_4x4_red.webp')
    const avif = loadSample('format_check.avif')
    expect(() => decoder.decodeRgba(webp, 'webp')).toThrow('Image: no decoder available for webp')
    expect(() => decoder.decodeRgba(webp, 'webp')).toThrow('setDefaultRasterImageDecoder')
    expect(() => decoder.decodeRgba(avif, 'avif')).toThrow('Image: no decoder available for avif')
    expect(() => decoder.decodeRgba(avif, 'avif')).toThrow('createNodeExternalRasterImageDecoder')
  })
})

describe('Raster image decoder: Node external decoder', () => {
  it('normalizes every supported channel and sample-depth combination to RGBA8', () => {
    for (const bitDepth of [8, 16, 32, 64]) {
      const blue = bitDepth === 16 ? 192 : 191
      const expectedByChannels = [
        [64, 64, 64, 255],
        [64, 64, 64, 128],
        [64, 128, blue, 255],
        [64, 128, blue, 128],
      ]
      for (let channels = 1; channels <= 4; channels++) {
        const normalized = channels <= 2 ? [0.25, 0.5] : [0.25, 0.5, 0.75, 0.5]
        let raw: Uint8Array
        if (bitDepth === 8) {
          raw = Uint8Array.from(normalized.slice(0, channels), function (value) { return Math.round(value * 255) })
        } else if (bitDepth === 16) {
          raw = new Uint8Array(Uint16Array.from(normalized.slice(0, channels), function (value) { return Math.round(value * 65535) }).buffer)
        } else if (bitDepth === 32) {
          raw = new Uint8Array(Float32Array.from(normalized.slice(0, channels)).buffer)
        } else {
          raw = new Uint8Array(Float64Array.from(normalized.slice(0, channels)).buffer)
        }
        expect([...convertRawToRgba8(raw, 1, 1, channels, bitDepth)]).toEqual(expectedByChannels[channels - 1])
      }
    }
  })

  // Verifies PNG goes through the pure in-process path (identical to decodePng).
  it('decodes PNG via the pure path', () => {
    const decoder = createNodeExternalRasterImageDecoder()
    const png = makeTestPng()
    const decoded = decoder.decodeRgba(png, 'png')
    const pure = decodePng(png)
    expect(decoded.width).toBe(pure.width)
    expect(decoded.height).toBe(pure.height)
    expect(decoded.pixels).toEqual(pure.pixels)
  })

  // Verifies WebP decodes through the external (sharp-based) decoder;
  // the lossless sample is a solid red 4x4 image.
  it('decodes WebP via the external decoder', () => {
    const decoder = createNodeExternalRasterImageDecoder()
    const decoded = decoder.decodeRgba(loadSample('test_4x4_red.webp'), 'webp')
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(4)
    expect(decoded.pixels.length).toBe(4 * 4 * 4)
    for (let i = 0; i < 16; i++) {
      expect(decoded.pixels[i * 4]).toBe(255)
      expect(decoded.pixels[i * 4 + 1]).toBe(0)
      expect(decoded.pixels[i * 4 + 2]).toBe(0)
      expect(decoded.pixels[i * 4 + 3]).toBe(255)
    }
  })

  // Verifies AVIF decodes through the external decoder.
  it('decodes AVIF via the external decoder', () => {
    const decoder = createNodeExternalRasterImageDecoder()
    const decoded = decoder.decodeRgba(loadSample('format_check.avif'), 'avif')
    expect(decoded.width).toBe(1024)
    expect(decoded.height).toBe(1024)
    expect(decoded.pixels.length).toBe(1024 * 1024 * 4)
  })
})

describe('Raster image decoder: default decoder registry', () => {
  afterEach(() => {
    // Restore the process-wide default so other tests are unaffected
    setDefaultRasterImageDecoder(null)
  })

  // Verifies the initial default is the pure decoder (PNG works, WebP throws).
  it('defaults to the pure decoder', () => {
    const decoder = getDefaultRasterImageDecoder()
    const decoded = decoder.decodeRgba(makeTestPng(), 'png')
    expect(decoded.pixels).toEqual(TEST_PNG_PIXELS)
    expect(() => decoder.decodeRgba(loadSample('test_4x4_red.webp'), 'webp')).toThrow('Image: no decoder available for webp')
  })

  // Verifies the lazily created default instance is reused.
  it('reuses the same default instance', () => {
    expect(getDefaultRasterImageDecoder()).toBe(getDefaultRasterImageDecoder())
  })

  // Verifies setDefaultRasterImageDecoder replaces the default.
  it('replaces the default decoder', () => {
    const custom: RasterImageDecoder = {
      decodeRgba(_data: Uint8Array, _format): DecodedRgbaImage {
        return { width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 4]) }
      },
    }
    setDefaultRasterImageDecoder(custom)
    expect(getDefaultRasterImageDecoder()).toBe(custom)
    const decoded = getDefaultRasterImageDecoder().decodeRgba(new Uint8Array(0), 'webp')
    expect(decoded.pixels).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  // Verifies setting null restores pure decoder behavior.
  it('restores the pure decoder when set to null', () => {
    const custom: RasterImageDecoder = {
      decodeRgba(): DecodedRgbaImage {
        return { width: 1, height: 1, pixels: new Uint8Array(4) }
      },
    }
    setDefaultRasterImageDecoder(custom)
    setDefaultRasterImageDecoder(null)
    const decoder = getDefaultRasterImageDecoder()
    expect(decoder).not.toBe(custom)
    const decoded = decoder.decodeRgba(makeTestPng(), 'png')
    expect(decoded.pixels).toEqual(TEST_PNG_PIXELS)
    expect(() => decoder.decodeRgba(loadSample('format_check.avif'), 'avif')).toThrow('Image: no decoder available for avif')
  })
})
