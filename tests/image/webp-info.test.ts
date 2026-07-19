import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseWebpInfo } from '../../src/image/webp-parser.js'
import { getImageDimensions } from '../../src/image/image-utils.js'
import { readRasterInfoWithExternalDecoder } from '../../src/image/external-image-decoder.js'

function loadSample(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../sample/images/${name}`, import.meta.url)))
}

/** Build a minimal RIFF/WEBP container around the given chunk fourcc and payload */
function makeWebp(fourcc: string, payload: number[]): Uint8Array {
  const out = new Uint8Array(Math.max(30, 20 + payload.length))
  const riffSize = out.length - 8
  out.set([0x52, 0x49, 0x46, 0x46]) // 'RIFF'
  out[4] = riffSize & 0xFF; out[5] = (riffSize >> 8) & 0xFF
  out[6] = (riffSize >> 16) & 0xFF; out[7] = (riffSize >> 24) & 0xFF
  out.set([0x57, 0x45, 0x42, 0x50], 8) // 'WEBP'
  for (let i = 0; i < 4; i++) out[12 + i] = fourcc.charCodeAt(i)
  const chunkSize = payload.length
  out[16] = chunkSize & 0xFF; out[17] = (chunkSize >> 8) & 0xFF
  out[18] = (chunkSize >> 16) & 0xFF; out[19] = (chunkSize >> 24) & 0xFF
  out.set(payload, 20)
  return out
}

/** VP8X chunk payload: flags + 24-bit canvas width-1 / height-1 */
function makeVp8x(width: number, height: number, flags: number): Uint8Array {
  const w = width - 1
  const h = height - 1
  return makeWebp('VP8X', [
    flags, 0, 0, 0,
    w & 0xFF, (w >> 8) & 0xFF, (w >> 16) & 0xFF,
    h & 0xFF, (h >> 8) & 0xFF, (h >> 16) & 0xFF,
  ])
}

/** VP8L chunk payload: signature + 14-bit width-1 / height-1 + alpha bit */
function makeVp8l(width: number, height: number, alpha: boolean): Uint8Array {
  const bits = ((width - 1) & 0x3FFF) | (((height - 1) & 0x3FFF) << 14) | ((alpha ? 1 : 0) << 28)
  return makeWebp('VP8L', [
    0x2F,
    bits & 0xFF, (bits >> 8) & 0xFF, (bits >> 16) & 0xFF, (bits >>> 24) & 0xFF,
  ])
}

/** VP8 chunk payload: 3-byte frame tag + key frame start code + 14-bit dimensions */
function makeVp8(width: number, height: number): Uint8Array {
  return makeWebp('VP8 ', [
    0, 0, 0, // frame tag
    0x9D, 0x01, 0x2A, // key frame start code
    width & 0xFF, (width >> 8) & 0x3F,
    height & 0xFF, (height >> 8) & 0x3F,
  ])
}

// Real sample files with their expected container format
const SAMPLE_FILES: Array<[string, 'VP8' | 'VP8L' | 'VP8X']> = [
  ['format_check.webp', 'VP8X'],
  ['format_check2.webp', 'VP8X'],
  ['test_2colors.webp', 'VP8L'],
  ['test_4colors.webp', 'VP8L'],
  ['test_4x4_gradient.webp', 'VP8L'],
  ['test_4x4_red.webp', 'VP8L'],
  ['test_gradient32.webp', 'VP8L'],
  ['test_gradient64.webp', 'VP8L'],
  ['test_plasma256.webp', 'VP8L'],
]

describe('WebP info: real files', () => {
  // Verifies parseWebpInfo agrees with getImageDimensions and the external
  // (sharp-based) decoder metadata for every sample file, including the
  // container format and alpha flag.
  for (const [file, format] of SAMPLE_FILES) {
    it(`parses ${file} (${format}) consistently with getImageDimensions and the external decoder`, () => {
      const data = loadSample(file)
      const info = parseWebpInfo(data)
      expect(info.format).toBe(format)

      const dims = getImageDimensions(data)
      expect(dims).not.toBeNull()
      expect(info.width).toBe(dims!.width)
      expect(info.height).toBe(dims!.height)

      const external = readRasterInfoWithExternalDecoder(data, 'webp')
      expect(info.width).toBe(external.width)
      expect(info.height).toBe(external.height)
      expect(info.hasAlpha).toBe(external.hasAlpha)
    })
  }
})

describe('WebP info: synthetic headers', () => {
  // Verifies VP8X canvas dimensions (stored as 24-bit size-1) and the alpha flag bit (0x10).
  it('parses VP8X dimensions and alpha flag', () => {
    const withAlpha = parseWebpInfo(makeVp8x(640, 480, 0x10))
    expect(withAlpha).toEqual({ width: 640, height: 480, hasAlpha: true, format: 'VP8X' })

    const noAlpha = parseWebpInfo(makeVp8x(640, 480, 0x00))
    expect(noAlpha.hasAlpha).toBe(false)

    // Other flag bits (ICC 0x20, EXIF 0x08, XMP 0x04, animation 0x02) must not imply alpha
    const otherFlags = parseWebpInfo(makeVp8x(1, 1, 0x2E))
    expect(otherFlags).toEqual({ width: 1, height: 1, hasAlpha: false, format: 'VP8X' })
  })

  // Verifies the VP8X 24-bit dimension upper bound.
  it('parses VP8X maximum canvas dimensions', () => {
    const info = parseWebpInfo(makeVp8x(1 << 24, 1 << 24, 0))
    expect(info.width).toBe(1 << 24)
    expect(info.height).toBe(1 << 24)
  })

  // Verifies VP8L 14-bit dimensions and the alpha_is_used bit (bit 28).
  it('parses VP8L dimensions and alpha bit', () => {
    const withAlpha = parseWebpInfo(makeVp8l(1000, 2000, true))
    expect(withAlpha).toEqual({ width: 1000, height: 2000, hasAlpha: true, format: 'VP8L' })

    const noAlpha = parseWebpInfo(makeVp8l(1000, 2000, false))
    expect(noAlpha.hasAlpha).toBe(false)
  })

  // Verifies the VP8L 14-bit dimension boundaries (1 and 16384).
  it('parses VP8L boundary dimensions', () => {
    expect(parseWebpInfo(makeVp8l(1, 1, false))).toEqual({ width: 1, height: 1, hasAlpha: false, format: 'VP8L' })
    expect(parseWebpInfo(makeVp8l(16384, 16384, false))).toEqual({ width: 16384, height: 16384, hasAlpha: false, format: 'VP8L' })
  })

  // Verifies VP8 (lossy) 14-bit dimensions; the simple format never carries alpha.
  it('parses VP8 dimensions with hasAlpha false', () => {
    const info = parseWebpInfo(makeVp8(320, 240))
    expect(info).toEqual({ width: 320, height: 240, hasAlpha: false, format: 'VP8' })
  })
})

describe('WebP info: error handling', () => {
  // Verifies the RIFF fourcc is enforced.
  it('rejects an invalid RIFF header', () => {
    const bad = makeVp8l(4, 4, false)
    bad[0] = 0x00
    expect(() => parseWebpInfo(bad)).toThrow('WebP: invalid RIFF header')
  })

  // Verifies the WEBP form type is enforced.
  it('rejects a RIFF container that is not WEBP', () => {
    const bad = makeVp8l(4, 4, false)
    bad[8] = 0x41 // 'A'
    expect(() => parseWebpInfo(bad)).toThrow('WebP: invalid RIFF header')
  })

  // Verifies data shorter than the minimum header size is rejected.
  it('rejects data that is too short', () => {
    expect(() => parseWebpInfo(new Uint8Array(29))).toThrow('WebP: invalid RIFF header')
  })

  // Verifies the VP8L one-byte signature (0x2F) is enforced.
  it('rejects an invalid VP8L signature', () => {
    const bad = makeVp8l(4, 4, false)
    bad[20] = 0x2E
    expect(() => parseWebpInfo(bad)).toThrow('WebP: invalid VP8L signature')
  })

  // Verifies the VP8 key frame start code (9D 01 2A) is enforced.
  it('rejects an invalid VP8 key frame start code', () => {
    const bad = makeVp8(4, 4)
    bad[23] = 0x9C
    expect(() => parseWebpInfo(bad)).toThrow('WebP: invalid VP8 key frame')
  })

  // Verifies an unknown first chunk fourcc is rejected.
  it('rejects an unknown chunk layout', () => {
    const bad = makeWebp('ALPH', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => parseWebpInfo(bad)).toThrow('WebP: unknown chunk layout')
  })
})
