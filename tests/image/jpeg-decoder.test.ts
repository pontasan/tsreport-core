import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { decodeJpegSamples, decodeJpegToRgba, decodeJpegToRgbaWithSamples } from '../../src/image/jpeg-decoder.js'

const JPEGTRAN_AVAILABLE = spawnSync('jpegtran', ['-version']).status === 0
const LIBJPEG_TOOLS_AVAILABLE = spawnSync('cjpeg', ['-version']).status === 0 && spawnSync('djpeg', ['-version']).status === 0

// 64x64 solid #cc2211 baseline YCbCr JPEG
const RED_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Ag6ONygAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//Z'
// The same color as an Adobe YCCK (transform 2) CMYK JPEG
const CMYK_JPEG = '/9j/7gAOQWRvYmUAZAAAAAAC/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAFAgAQABABAERAAIRAQMRAQQRAP/EABYAAQEBAAAAAAAAAAAAAAAAAAAGCP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAWAQEBAQAAAAAAAAAAAAAAAAAABwn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADgQBAAIRAxEEAAA/AL1fWb7ZYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//Z'
// 8x8 solid #cc2211 progressive YCbCr JPEG (SOF2, multiple scans)
const PROGRESSIVE_RED_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCAAIAAgDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAABv/EABUBAQEAAAAAAAAAAAAAAAAAAAYH/9oADAMBAAIQAxAAAAEGNuX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q=='
// 8x8 black-to-white progressive grayscale JPEG with non-zero AC coefficients
const PROGRESSIVE_GRADIENT_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/wgALCAAIAAgBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAf/aAAgBAQAAAAE//8QAFRABAQAAAAAAAAAAAAAAAAAAABj/2gAIAQEAAQUCll//xAAWEAADAAAAAAAAAAAAAAAAAAAANaL/2gAIAQEABj8CXSf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IR//2gAIAQEAAAAQf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Qb//Z'

function bytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

function jpegMarker(code: number, payload: number[]): number[] {
  const length = payload.length + 2
  return [0xFF, code, length >> 8, length & 0xFF, ...payload]
}

function hierarchyHeader(width = 8, height = 8): number[] {
  return jpegMarker(0xDE, [8, height >> 8, height & 0xFF, width >> 8, width & 0xFF, 1, 1, 0x11, 0])
}

function frameHeader(marker: number, width = 8, height = 8): number[] {
  return jpegMarker(marker, [8, height >> 8, height & 0xFF, width >> 8, width & 0xFF, 1, 1, 0x11, 0])
}

function scanHeader(spectralStart: number, spectralEnd: number): number[] {
  return jpegMarker(0xDA, [1, 1, 0, spectralStart, spectralEnd, 0])
}

function losslessJpegWithComponents(componentCount: number): Uint8Array {
  const huffman = jpegMarker(0xC4, [0, 1, ...new Array<number>(15).fill(0), 0])
  const frame: number[] = [8, 0, 1, 0, 1, componentCount]
  for (let component = 1; component <= componentCount; component++) frame.push(component, 0x11, 0)
  const output = [0xFF, 0xD8, ...huffman, ...jpegMarker(0xC3, frame)]
  for (let component = 1; component <= componentCount; component++) {
    output.push(...jpegMarker(0xDA, [1, component, 0, 1, 0, 0]), 0x7F)
  }
  output.push(0xFF, 0xD9)
  return Uint8Array.from(output)
}

function oracleRgb(jpeg: Uint8Array): Uint8Array {
  const result = spawnSync('djpeg', ['-rgb', '-nosmooth'], { input: jpeg })
  if (result.status !== 0) throw new Error(result.stderr.toString())
  const ppm = new Uint8Array(result.stdout)
  const tokens: string[] = []
  let position = 0
  while (tokens.length < 4) {
    while (position < ppm.length && ppm[position]! <= 0x20) position++
    if (ppm[position] === 0x23) {
      while (position < ppm.length && ppm[position] !== 0x0A) position++
      continue
    }
    const start = position
    while (position < ppm.length && ppm[position]! > 0x20) position++
    tokens.push(String.fromCharCode(...ppm.subarray(start, position)))
  }
  if (tokens[0] !== 'P6' || tokens[3] !== '255') throw new Error('Unexpected djpeg output format')
  if (ppm[position]! > 0x20) throw new Error('Unexpected djpeg PPM separator')
  position++
  return ppm.slice(position)
}

function syntheticHierarchicalJpeg(differentialMarker: 0xC5 | 0xC6 | 0xC7): Uint8Array {
  const quantization = jpegMarker(0xDB, [0, ...new Array<number>(64).fill(1)])
  // DC symbols 0, 2 and 5 use two-bit codes 00, 01 and 10. AC EOB uses code 0.
  const huffman = jpegMarker(0xC4, [
    0x00, 0, 3, ...new Array<number>(14).fill(0), 0, 2, 5,
    0x10, 1, ...new Array<number>(15).fill(0), 0,
  ])
  const output: number[] = [0xFF, 0xD8, ...hierarchyHeader(), ...quantization, ...huffman]
  if (differentialMarker === 0xC7) {
    output.push(...frameHeader(0xC3), ...scanHeader(1, 0), ...new Array<number>(16).fill(0))
    output.push(...jpegMarker(0xDF, [0]))
    output.push(...frameHeader(0xC7), ...scanHeader(0, 0), ...new Array<number>(32).fill(0x66))
  } else {
    output.push(...frameHeader(0xC0), ...scanHeader(0, 63), 0x1F)
    output.push(...jpegMarker(0xDF, [0]))
    output.push(...frameHeader(differentialMarker))
    if (differentialMarker === 0xC6) {
      output.push(...scanHeader(0, 0), 0xA3, ...scanHeader(1, 63), 0x7F)
    } else {
      output.push(...scanHeader(0, 63), 0xA0)
    }
  }
  output.push(0xFF, 0xD9)
  return Uint8Array.from(output)
}

function syntheticExpandedHierarchicalJpeg(): Uint8Array {
  const quantization = jpegMarker(0xDB, [0, ...new Array<number>(64).fill(1)])
  const huffman = jpegMarker(0xC4, [
    0x00, 0, 3, ...new Array<number>(14).fill(0), 0, 2, 5,
    0x10, 1, ...new Array<number>(15).fill(0), 0,
  ])
  return Uint8Array.from([
    0xFF, 0xD8, ...hierarchyHeader(16, 16), ...quantization, ...huffman,
    ...frameHeader(0xC0), ...scanHeader(0, 63), 0x1F,
    ...jpegMarker(0xDF, [0x11]),
    ...frameHeader(0xC5, 16, 16), ...scanHeader(0, 63), 0xA0, 0xA0, 0xA0, 0xA0,
    0xFF, 0xD9,
  ])
}

function syntheticArithmeticHierarchicalJpeg(progressive: boolean): Uint8Array {
  const quantization = jpegMarker(0xDB, [0, ...new Array<number>(64).fill(1)])
  const huffman = jpegMarker(0xC4, [
    0x00, 0, 3, ...new Array<number>(14).fill(0), 0, 2, 5,
    0x10, 1, ...new Array<number>(15).fill(0), 0,
  ])
  const standalone = Uint8Array.from([
    0xFF, 0xD8, ...quantization, ...huffman,
    ...frameHeader(0xC0), ...scanHeader(0, 63), 0xA0,
    0xFF, 0xD9,
  ])
  const args = progressive ? ['-arithmetic', '-progressive'] : ['-arithmetic']
  const transformed = spawnSync('jpegtran', args, { input: standalone, maxBuffer: 1024 * 1024 })
  if (transformed.status !== 0) throw new Error(new TextDecoder().decode(transformed.stderr))
  const tail = new Uint8Array(transformed.stdout.buffer, transformed.stdout.byteOffset + 2, transformed.stdout.byteLength - 4).slice()
  const sourceMarker = progressive ? 0xCA : 0xC9
  const targetMarker = progressive ? 0xCE : 0xCD
  let replaced = false
  for (let i = 0; i + 1 < tail.length; i++) {
    if (tail[i] === 0xFF && tail[i + 1] === sourceMarker) {
      tail[i + 1] = targetMarker
      replaced = true
      break
    }
  }
  if (!replaced) throw new Error('jpegtran output lacks the expected arithmetic SOF marker')
  return Uint8Array.from([
    0xFF, 0xD8, ...hierarchyHeader(), ...quantization, ...huffman,
    ...frameHeader(0xC0), ...scanHeader(0, 63), 0x1F,
    ...jpegMarker(0xDF, [0]), ...tail,
    0xFF, 0xD9,
  ])
}

describe('JPEG decoder', () => {
  it('decodes a YCbCr JPEG to the exact RGB color', () => {
    const d = decodeJpegToRgba(bytes(RED_JPEG))
    expect(d.width).toBe(64)
    expect(d.height).toBe(64)
    const p = (32 * d.width + 32) * 4
    expect([d.rgba[p], d.rgba[p + 1], d.rgba[p + 2], d.rgba[p + 3]]).toEqual([204, 34, 17, 255])
  })

  it('decodes an Adobe YCCK CMYK JPEG with viewer-consistent ink handling', () => {
    // This fixture was written by a libjpeg-based encoder, which stores
    // non-complemented YCCK. The decoder intentionally follows PDF viewer
    // semantics (complemented YCCK as written by design tools), so the
    // expected values below are what poppler renders for this same file:
    // ink = (255, 43, 21, 204) -> rgb (0, 42, 47)
    const d = decodeJpegToRgba(bytes(CMYK_JPEG))
    const p = (32 * d.width + 32) * 4
    expect(Math.abs(d.rgba[p]! - 0)).toBeLessThanOrEqual(2)
    expect(Math.abs(d.rgba[p + 1]! - 42)).toBeLessThanOrEqual(2)
    expect(Math.abs(d.rgba[p + 2]! - 47)).toBeLessThanOrEqual(2)
  })

  it('decodes a progressive YCbCr JPEG across successive scans', () => {
    const d = decodeJpegToRgba(bytes(PROGRESSIVE_RED_JPEG))
    expect(d.width).toBe(8)
    expect(d.height).toBe(8)
    const p = (4 * d.width + 4) * 4
    expect(Math.abs(d.rgba[p]! - 204)).toBeLessThanOrEqual(3)
    expect(Math.abs(d.rgba[p + 1]! - 34)).toBeLessThanOrEqual(3)
    expect(Math.abs(d.rgba[p + 2]! - 17)).toBeLessThanOrEqual(3)
    expect(d.rgba[p + 3]).toBe(255)
  })

  it('decodes progressive AC coefficients into spatial detail', () => {
    const d = decodeJpegToRgba(bytes(PROGRESSIVE_GRADIENT_JPEG))
    expect(d.width).toBe(8)
    expect(d.height).toBe(8)
    const top = d.rgba[(0 * d.width + 4) * 4]!
    const middle = d.rgba[(4 * d.width + 4) * 4]!
    const bottom = d.rgba[(7 * d.width + 4) * 4]!
    expect(top).toBeLessThan(40)
    expect(middle).toBeGreaterThan(100)
    expect(middle).toBeLessThan(170)
    expect(bottom).toBeGreaterThan(220)
  })

  it.each([1, 2, 3, 4, 5, 255])('preserves all samples for a %i-component frame', (componentCount) => {
    const decoded = decodeJpegSamples(losslessJpegWithComponents(componentCount), 0)
    expect(decoded.componentCount).toBe(componentCount)
    expect(decoded.samples).toEqual(new Uint8Array(componentCount).fill(128))
  })

  it('honors an explicit color transform when no Adobe marker overrides it', () => {
    const transformed = decodeJpegSamples(bytes(RED_JPEG), 1)
    const untransformed = decodeJpegSamples(bytes(RED_JPEG), 0)
    expect(transformed.samples).not.toEqual(untransformed.samples)
    expect(transformed.samples[0]).toBeGreaterThan(transformed.samples[1]!)
  })

  it.skipIf(!LIBJPEG_TOOLS_AVAILABLE)('matches libjpeg-turbo per sample across process, scan, restart, and subsampling combinations', () => {
    const width = 17
    const height = 13
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
    const ppm = new Uint8Array(header.length + width * height * 3)
    ppm.set(header)
    let position = header.length
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        ppm[position++] = x * 15
        ppm[position++] = y * 19
        ppm[position++] = (x * 11 + y * 7) & 255
      }
    }
    const matrix = [
      ['-quality', '90', '-sample', '1x1,1x1,1x1'],
      ['-quality', '90', '-sample', '2x2,1x1,1x1'],
      ['-quality', '90', '-progressive'],
      ['-quality', '90', '-arithmetic'],
      ['-quality', '90', '-arithmetic', '-progressive'],
      ['-quality', '90', '-restart', '1B'],
      ['-lossless', '4'],
      ['-lossless', '4', '-restart', '1'],
    ]
    for (let variant = 0; variant < matrix.length; variant++) {
      const encoded = spawnSync('cjpeg', matrix[variant]!, { input: ppm })
      expect(encoded.status, encoded.stderr.toString()).toBe(0)
      const jpeg = new Uint8Array(encoded.stdout)
      const expected = oracleRgb(jpeg)
      const actual = decodeJpegToRgba(jpeg).rgba
      expect(expected.length).toBe(width * height * 3)
      for (let sample = 0; sample < expected.length; sample++) {
        const mine = actual[Math.trunc(sample / 3) * 4 + sample % 3]!
        expect(Math.abs(mine - expected[sample]!), `variant ${variant}, sample ${sample}`).toBeLessThanOrEqual(3)
      }
    }
  })
})

describe('hierarchical differential JPEG', () => {
  // Generated by the JPEG reference implementation listed by jpeg.org.
  const SOF11_REFERENCE = '/9j/7gAOQWRvYmUAZAAAAAAA/8sACwgAEAAQAQARAP/MAAQAEP/aAAgBAAAEAAD/ALgHe/xV6rabKV2E5zW8/9k='
  const SOF15_REFERENCE = '/9j/7gAOQWRvYmUAZAAAAAAA/94ACwgAEAAQAQARAP/LAAsIAAgACAEAEQD/zAAEABD/2gAIAQAABAAA/wC5h3SORCaS3OeLIbv/3wADEf/PAAsIABAAEAEAEQD/zAAEABD/2gAIAQAAAAAA+5d2dxpQhkjysQPo4cT4tKbcUbB3T92jHC/7XHdr8+AB5ID/2Q=='
  it.each([
    [0xC5, 'sequential DCT'],
    [0xC6, 'progressive DCT'],
    [0xC7, 'lossless'],
  ] as const)('decodes SOF%s %s frames against the preceding reference', (marker) => {
    const decoded = decodeJpegToRgba(syntheticHierarchicalJpeg(marker))
    expect(decoded.width).toBe(8)
    expect(decoded.height).toBe(8)
    for (let pixel = 0; pixel < 64; pixel++) {
      const offset = pixel * 4
      expect([...decoded.rgba.subarray(offset, offset + 4)]).toEqual([130, 130, 130, 255])
    }
  })

  it('applies the DHP/EXP weighted expansion before a larger differential frame', () => {
    const decoded = decodeJpegToRgba(syntheticExpandedHierarchicalJpeg())
    expect([decoded.width, decoded.height]).toEqual([16, 16])
    for (let pixel = 0; pixel < 256; pixel++) {
      expect(decoded.rgba[pixel * 4]).toBe(130)
    }
  })

  it.skipIf(!JPEGTRAN_AVAILABLE).each([
    [false, 'SOF13 arithmetic sequential'],
    [true, 'SOF14 arithmetic progressive'],
  ] as const)('decodes %s (%s)', (progressive) => {
    const decoded = decodeJpegToRgba(syntheticArithmeticHierarchicalJpeg(progressive))
    for (let pixel = 0; pixel < 64; pixel++) expect(decoded.rgba[pixel * 4]).toBe(130)
  })

  it.each([
    [SOF11_REFERENCE, 'SOF11 arithmetic lossless'],
    [SOF15_REFERENCE, 'SOF15 arithmetic-lossless hierarchy'],
  ])('decodes an independently encoded %s (%s)', (encoded) => {
    const decoded = decodeJpegToRgba(bytes(encoded))
    expect([decoded.width, decoded.height]).toEqual([16, 16])
    for (let row = 0; row < 16; row++) {
      for (let column = 0; column < 16; column++) {
        const expected = 32 + column * 8 + row * 4
        expect(decoded.rgba[(row * 16 + column) * 4]).toBe(expected)
      }
    }
  })
})

describe("JPEG arithmetic entropy coding (SOF9/SOF10)", () => {
  // 16x16 RGB gradient encoded by cjpeg -quality 85 -sample 2x2, then
  // losslessly transcoded with jpegtran -arithmetic (same DCT coefficients,
  // arithmetic entropy coding) — the two must decode to identical pixels.
  const HUFFMAN_REFERENCE = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwvwx4N83b+6z+Fej6J4Lt4mRHiLPxlVXJFd34W8KtFaI6RfOxCqducGvQNB8KCEBEj2qvDMBksfQf5/lXlvNcLRwsJSinJpNt62vsktFeybbbSSXVvS+CONJOUfeP/9k="
  // jpegtran -arithmetic (SOF9 sequential)
  const ARITH_SEQUENTIAL = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/yQARCAAQABADASIAAhEBAxEB/8wACgAQEAUBEBEF/9oADAMBAAIRAxEAPwD/AMtUL1AOZ7399HGmlPuhG+zsgeLri3s0tQO9ncZI9nrjerh1rsVts6/ShikgDPiJ3a7zpJnX7TWn9cCpYv44ABOz8Y3XBMV6XndXzxGTcLlama0rVv0VsM8rd49/LuHNof1vanC8Nhhg/9k="
  // jpegtran -arithmetic -progressive (SOF10: DC first/refine, AC first/refine scans)
  const ARITH_PROGRESSIVE = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/ygARCAAQABADASIAAhEBAxEB/8wABgAQARD/2gAMAwEAAhADEAAAAf8Alpj7qzoOgP/MAAQQBf/aAAgBAQABBQIVcQYasR77Hy8YTvf/zAAEEQX/2gAIAQMBAT8BFmGihqYU/8wABBEF/9oACAECAQE/AYY/2uAKgX9A/8wABBAF/9oACAEBAAY/Al4U/8wABBAF/9oACAEBAAE/IddSYPnAT+B3j+niScQ5+cD/2gAMAwEAAgADAAAAECj/zAAEEQX/2gAIAQMBAT8QsUD/zAAEEQX/2gAIAQIBAT8QvfqOApnXGH2cuQvzifKGzU7/zAAEEAX/2gAIAQEAAT8QsYwDI2QmxTES0xGmjdjO7trouJw8ABT/2Q=="
  // jpegtran -arithmetic -restart 1 (RST markers reset the coder and statistics)
  const ARITH_RESTART = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/yQARCAAQABADASIAAhEBAxEB/8wACgAQEAUBEBEF/90ABAAB/9oADAMBAAIRAxEAPwD/AMtUL1AOZ7399HGmlPuhG+zsgeLri3s0tQO9ncZI9nrjerh1rsVts6/ShikgDPiJ3a7zpJnX7TWn9cCpYv44ABOz8Y3XBMV6XndXzxGTcLlama0rVv0VsM8rd49/LuHNof1vanC8Nhhg/9k="

  it("decodes sequential, progressive, and restart-interval arithmetic JPEGs identically to the Huffman source", () => {
    const reference = decodeJpegToRgba(bytes(HUFFMAN_REFERENCE))
    expect(reference.width).toBe(16)
    expect(reference.height).toBe(16)
    for (const b64 of [ARITH_SEQUENTIAL, ARITH_PROGRESSIVE, ARITH_RESTART]) {
      const d = decodeJpegToRgba(bytes(b64))
      expect(d.width).toBe(16)
      expect(d.height).toBe(16)
      expect(d.rgba).toEqual(reference.rgba)
    }
  })
})

describe("JPEG lossless (SOF3)", () => {
  // 16x16 RGB with pixel (x,y) = (x*16, y*16, (x*y*4) % 256), encoded by
  // cjpeg -lossless — decoding must reproduce the source exactly.
  const LOSSLESS_PSV4 = "/9j/7gAOQWRvYmUAZAAAAAAA/8MAEQgAEAAQA1IRAEcRAEIRAP/EABgAAQEBAQEAAAAAAAAAAAAAAAADBQgJ/9oADANSAEcAQgAEAADn/n/n/QNA0DQNA0DQNA0DQNA0DQNA0BoChQoUKFChQoUKFChQo0BQoUKFChQoUKFChQoUaAoUKFChQoUKFChQoUKNAUKFChQoUKFChQoUKFGgKFChQoUKFChQoUOAyhRoChQoUKFChQoUOAyh6CFCjQFChQoUKFChQ4DPQQoUKFGgKFChQoUKHAZQ9BChQoUKNAUKFChQoUKFChQoUKHAbQFChQoUKHAZ6CFChQocBlD0EaAoUKFChwGeghQoUKHAZ6CFCjQFChQoUKFChQocBnoIUKFGgKFChQ4DPQQoUKHAZ6CFChQ4DaAoUKFChQoUKFChQocBnoI0BQoUKFChQocBnoIUKHAZ6CFP/9k="
  // cjpeg -lossless 5 -restart 2 (prediction restarts at RST markers)
  const LOSSLESS_RESTART = "/9j/7gAOQWRvYmUAZAAAAAAA/8MAEQgAEAAQA1IRAEcRAEIRAP/EABoAAAMBAQEBAAAAAAAAAAAAAAAEBQYIAwf/3QAEACD/2gAMA1IARwBCAAUAAOf+f+f6AUAoBQCgFAKAUAoBQCgFAKAUAoAUBg9GD0YPRg9GD0YPRg9GD0YPRg9GD0YPRg9GD0YPT//Q5/8Aj/P9AYoDFAYoDFAYoDFAYoDFAYoDFAYoDFAYoDFAYKAwMMDDAwwMMDDAwwMMDDAwwMMDDAwwMMDDAx//0ef/AJ/z/QKFAoUChQKFAoUChQKFAoUChQKFAoUChQKFAoUCgUBgcYHGBxgcYHGBxgcYHGBxgcYHGBxg4LYHGBz/0uf8/wA/0CxQLFAsUCxQLFAsUCxQLFAsUCxQOF6BYoFigWKBYKAwUGCgwUGCgwUGCgwUGCgwUGDg9g6QYKDBQYKDBQ//0+fzn+gaCgaCgaCgaCgaCgaCgaCgcP0DQUDQUDQUDQUDQUDQUDQFAYKjBUYKjBUYKjBUYKjB8TYKjBUYKjBUYKjBUYOE/wD/1Of9Bz/QNRQNRQNRQNRQNRQNRQOJ6BqKBqKBqKBqKBqKBxPQNRQNQUBgsMFhgsMFhgsMHC7B0wwWGCwwWGCwwcLsHTDBYYLH/9Xn/wCgc/0DYUDYUDYUDYUDYUDi+gbCgbCgbCgbCgcX0DYUDYUDYUDYFAYLjBcYLjBcYOG2DpxguMFxguMHDbB04wXGC4wXGDhv/9bn/wCwc/0DcUDcUDcUDcUDjegbigbigbigbigcb0DcUDcUDcUDjegbgoDBoGDQMGgYNAwfH2DQMGgYNAwcPsHUDBoGDQMHD7B1AwaD/9k="
  // cjpeg -lossless 7,2 (predictor 7 with point transform Pt=2): decoded
  // samples are (source >> 2) << 2, matching djpeg.
  const LOSSLESS_PT2 = "/9j/7gAOQWRvYmUAZAAAAAAA/8MAEQgAEAAQA1IRAEcRAEIRAP/EABoAAQEBAQEBAQAAAAAAAAAAAAIEAwAGBQH/2gAMA1IARwBCAAcAAvP+f8/p3ad2ndp3ad2ndp3ad2ndp3ad2ndp3ad2nd2nJfqSSSTSaWiWiWqWqWyWyW6W6VCVHackkkk0mlololqlqlslslululQlQlT2nJJJpNLRLRLVLVLZLZLdLdKhKhKlKntOSaTS0S0S1S1S2S2S3S3SoSoSpSpSq7TkmlololqlqlslslululQlQlSl4hL5KXye05LRLRLVLVLZLZLdLdKhKhLxCXyEqkqkq+05LRLVLVLZLZLdLdKhKhLxCVKVSVSVaVfaclqlqlslslululQl4dL5CVKVSVSVaVaVnaclqlslslululQlQl8hKlKpKpKtKtKxLxfaclslslululQlQl4hKlKpKpKtKtLxaXy0re05LZLdLdKhKhLxCVKVSVSVaVaXi0rErUre05LdLdKhKhKlL5CVSVSVaVaXi0rErUrUru05LdKhKhKlLxCVSVSVaVaXi0rErUrUrkvG9pyVCVCVKVKXyUqkq0q0rEvlpWpWpXJeNSv7TkqEqUqUqkvkpVpVpWJeLStStSuS8alelf8A/9k="
  // 12-bit precision (source sample v*4095/255, top 8 bits == v)
  const LOSSLESS_12BIT = "/9j/7gAOQWRvYmUAZAAAAAAA/8MAEQwAEAAQA1IRAEcRAEIRAP/EABkAAQEBAQEBAAAAAAAAAAAAAAAHCQwNBv/aAAwDUgBHAEIABAAA5/8A5/8A5/8A0ANATQE0BNATQE0BNATQE0BNATQE0BNATQEaACgFAKAUAoJQCgFAKCUAoBQCglAKA0BFAKAUEoBQCgFBKAUAoBQSgFAKAUFoCKAUEoBQCgFBPvyglAKCfflBKAUAoDQEUAoBQCglAKAUEoBQCgFBKAUAoJQGgIoJQCgFAKAUEoBQCgFAKAUE4DAoBQGgIoBQCglAKCfflAKCUAoJwGB9+egoFAKC0BFAKCfflBKAUAoJQCgHAYHoKBQCgFBPv2gIoBQCglAKAUEoBwGBQD0E8oBQSgFAKC0BFBKAUAoBQCgFAKAUIoBQCgFAKAcBg0BFAKAUEoBQCgnAYHoJ5QCgFAKCcBgUA9BQaAigFBPvyglAOAwPQUCgFAKAUE4C89BQKCfftARQCgFBKAUE+/KAUEoBQTgLz0FAoBQCgtARQSgFAKAcBgegoFAKAUA4DA9BQKAUAoBwGDQEUAoBQCglAKAUEoBQCgFBKAUA4DA9BQaAigFBKAUAoBQT78oJwGB6CgfflBOAwPQUD7//2Q=="

  function expected(x: number, y: number): [number, number, number] {
    return [(x * 16) % 256, (y * 16) % 256, (x * y * 4) % 256]
  }

  it("reproduces the source exactly for a plain lossless scan and with restart markers", () => {
    for (const b of [LOSSLESS_PSV4, LOSSLESS_RESTART]) {
      const d = decodeJpegToRgba(bytes(b))
      expect(d.width).toBe(16)
      expect(d.height).toBe(16)
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const [r, g, bl] = expected(x, y)
          const p = (y * 16 + x) * 4
          expect([d.rgba[p], d.rgba[p + 1], d.rgba[p + 2]], `(${x},${y})`).toEqual([r, g, bl])
        }
      }
    }
  })

  it('rejects a restart marker whose sequence number is incorrect', () => {
    const malformed = bytes(LOSSLESS_RESTART)
    let marker = -1
    for (let i = 0; i + 1 < malformed.length; i++) {
      if (malformed[i] === 0xFF && malformed[i + 1] === 0xD0) {
        marker = i + 1
        break
      }
    }
    expect(marker).toBeGreaterThan(0)
    malformed[marker] = 0xD1
    expect(() => decodeJpegToRgba(malformed)).toThrow(/restart markers are out of sequence/)
  })

  it("applies the point transform on output", () => {
    const d = decodeJpegToRgba(bytes(LOSSLESS_PT2))
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const [r, g, bl] = expected(x, y)
        const p = (y * 16 + x) * 4
        expect([d.rgba[p], d.rgba[p + 1], d.rgba[p + 2]], `(${x},${y})`).toEqual([(r >> 2) << 2, (g >> 2) << 2, (bl >> 2) << 2])
      }
    }
  })

  it("decodes 12-bit precision, scaling to the 8-bit output surface", () => {
    const d = decodeJpegToRgba(bytes(LOSSLESS_12BIT))
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const [r, g, bl] = expected(x, y)
        const p = (y * 16 + x) * 4
        expect([d.rgba[p], d.rgba[p + 1], d.rgba[p + 2]], `(${x},${y})`).toEqual([r, g, bl])
      }
    }
  })
})

describe("JPEG 12-bit DCT precision (SOF1/SOF2/SOF9)", () => {
  // 16x16 12-bit RGB (cjpeg -precision 12 -quality 90 -sample 1x1); expected
  // pixels are djpeg 3.1 12-bit output scaled to 8 bits (>>4). IDCT
  // implementations differ, so a +/-2 tolerance applies.
  const DCT12_SEQUENTIAL = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wQARDAAQABADAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAACwz/xAApEAABAgQFBAEFAAAAAAAAAAADBAYBAgUHCAoLERMAEhQXCRUYJ0Vi/8QAGQEAAgMBAAAAAAAAAAAAAAAACgwFCAkN/8QAMREAAQMCBAYAAQ0AAAAAAAAABQIDBAEGBwgJEgAKERMUFXEWFxkhIiMkJTFBQ1Fh/9oADAMBAAIRAxEAPwCPkyLOjb/cx6+/B/l+Rwfq9999v56rTpi4B/Sm+B9z5fl7f23dd3T4/wB8TGgTzHvyJ9R+d7duz+T4f7w7xladGHwo4b3tbxh3BsPXn5con08q5lMJqDqFQpqdQOcgzqiGnCmDvLIOPDMbn7VACQFEZIE60S1GMjGhpphYvjssOawcav3Fl31rs+0LKCxzBgRBKxZUuLOMSSU4MAH7mmIzlRTxqlxVilg5NsM4IntkEs+XLUcyfiVekAQaBnG4sCnSiZEmRVttxSFJSpLaUUcdX9da030b7W5txFXKOJqjhizIU6WM5MN3x9W2uCw7G8ty3bWKSz2rUTNwa5NTVqkZDkVmGSaWEeNKkVzD3lLLz+PAgpxxJDoITRa118X9MLQ1C5rMsMfu4s36aCWVaE90dFKwRBgxHnEpJidFlymGlevABjTwqrkYtFrcVAzZMPPDuEG08xT0Gtd2BemJYoGaN9IEVusmQmjykKcbbqhCW0qTStftuuN0X0q2rtdyqHEuURXhrXKX6UagwlUlu2+t9a7162Gd49Gdz6oFJSL6446ypSRhBvUGEO7hUD7ySkNLMJQJQnLGM6QSIxijc5mtVm2NHK2D+VPKndHzeWhh52wl53mEQHL3Xd11lw7qUYb4boS6/wCuNDu/JZKFGZIq5g9zCp7jk+zQtmmzZZp95b3XxexBeAHDhPy5EvY5HjuOONsR2G3E/jJn6b219KVQitFsuMrRSiJDkhttv//Z"
  // jpegtran -arithmetic transcode: identical coefficients, must match our
  // Huffman decode EXACTLY (verifies 12-bit arithmetic entropy decoding).
  const DCT12_ARITHMETIC = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/yQARDAAQABADAREAAhEBAxEB/8wACgAQEAUBEBEF/9oADAMBAAIRAxEAPwD/AP53eI5WgECqVWidRNFfDTWaedpO8A7L732jO/7wuYWej/udJ0k07IHH2hyiQWUy781bUi/MBk6JPmqS12NYDqNFxqI7mYuItMSW97f3SOzEybX9tq1nO6nsAK1vIew37ZBnhuJ9HrdihBAcyFKkKn9QntpZDYmIRVrXIGFCA971xW4Da4T7aLokSyZ3BmivThcIVtqQ78/Fj3ApiqwZH22vKC5N1ke/ddULv6rN/LLIkgnmlKgMkgqLztSUhHFXfWGhimP0471WmyzdHNlim+RaxdKs+562SCThNJ7g7VtH3c0+ZnfkJQkpCOxz2ZA1+DadEUq/9kIPHJGgWQxFyeUaeP8AqZ81jjQvikx4qGAQ7aw90SvO2lWo7GFvHw1wH/vAwUNYd/piQxVAtgB+TNh0Umblqq5Ua1+x+JdLFrEPPKNd+/8A0qCgVDdsbBqmg4vRGFkontRL3UTvgJRQwZ4Hy4Di3sYdsq/6bEOZJtWzM4NT76jPjZSaBdqRv13R9J57eldnFHwchWiTMWo/eVp0PJbobxpk540Bi1LVATAwFRbsgv7J2e3oojsV4sf/AI3h8RTs0dGEsBCytDTe9fdfrgyw8tqtWrQ+S4SvJX3E9M6Fs9SVdEOwOZsfICWOguJ2GgpDq0USrRXeXZrOE4s8pdA7avNNDWY31sZgNjDDsRVKeS/553my98X00tSWUE9rwAKRO45FgoJr58k4w5gtsDM2+OQF3SeHX4deuXVSZZNZp07uZ1uNol6z6DFS8dOVflGEfvZ6uN8b5+mcE1n0BDnEZ/K1Bes1vIqaZT7DDX/Ni1l9dQJ/uakXoWEJPfGR162Mt55x3a6A/9k="
  // Progressive 12-bit (multiple scans, successive approximation)
  const DCT12_PROGRESSIVE = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARDAAQABADAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAACgv/xAAZAQACAwEAAAAAAAAAAAAAAAAJCwQHCAz/2gAMAwEAAhADEAAAAY+NaTHeaJZ8sWCDzFLWxuNPv//EABwQAAICAgMAAAAAAAAAAAAAAAYIBAkAAgMHFv/aAAgBAQABBQJFqbfTYrVMIoNzUKqxkjfXyl1R6CXF/8QAKREAAgEDAgQFBQAAAAAAAAAAAQIDBBESCAkABQYTFCEjQVEVJDJCcf/aAAgBAwEBPwHQJuPfRPCfe2tb9uNtTcn6l51BSVtDXLFB7SSSYqxBAIUDJj/ccbqwyyFuNBuu6DnXUtLQ1tb6ES9yQZkFlWwCgj5Zlv8AiccrMGtxtva+H6gegrq6p7sktmjjZmVI0Vh603yp9h5oyEeUjSKq/wD/xAAmEQABAwQCAQMFAAAAAAAAAAAEAgMFAQYHCBIUEwARFRYYIjFh/9oACAECAQE/AdYrB+6bwfh5fL7f39+tjMGaNaw3ePjDKw5s9diusp+IhQmzDBGCmnXWnzHCXwwB/dKG1dVZvyPiLDJSGoR9JFNLd67v1h0aCytjBvldk8aFCxD6h2imBDDG3yXDH2nXUJr1wAzVi8my2vkemkkN8NRCaZN2sjNOYw/FOKZT6eiLe4hTMyFQMuVl5UsNVKW3bdKKX1zR+biCikOCyYcmK+pT8MFDGml//8QAJhAAAQQBAwEJAAAAAAAAAAAAAQIDBBEFABIhURMVIiUxMjRBQ//aAAgBAQAGPwLH+R7t1flrHwMhgX5+SPZlcKBFDjjaVCwVE0kfXF34gao3rG5CBg7yUt5qHFcMcLS2tQJKiD0SlVevO2xV6j4/H4vu+ND2sy5zDSVvyHlJ+Ox0UObPCgpJ9oQSf//EABsQAAMAAgMAAAAAAAAAAAAAAAABIRExgZHw/9oACAEBAAE/IfQrozWKJEM2VVmIMwFK1CxbeE3ActjH6WxEugE3/9oADAMBAAIAAwAAABCTP//EABoRAQADAAMAAAAAAAAAAAAAAAEAESFhcfD/2gAIAQMBAT8Q8ss5hmDQkBAdaldRCTXZYRIGBcyrpEOdKmwFBlFwjJA//8QAGhEAAgIDAAAAAAAAAAAAAAAAASEAEFFxsf/aAAgBAgEBPxDhsybzG+XeFImcIUFYfg79QRZkoFVA+O+2pdwxkb//xAAZEAEAAwEBAAAAAAAAAAAAAAABABEhMcH/2gAIAQEAAT8Q9FV3UaCgXASKVwSYRS84UsoHTMUsJpnaW8COhApZ5//Z"
  const DJPEG_REFERENCE = [0,0,0,15,0,0,32,0,0,48,0,0,64,0,0,80,0,0,96,0,0,112,0,0,129,0,0,143,0,0,160,0,0,176,0,0,192,0,0,209,0,0,225,0,0,240,0,0,0,16,0,15,16,3,31,16,8,48,16,12,63,16,16,80,16,20,96,16,24,112,16,28,128,16,31,144,16,35,159,15,39,176,16,43,192,16,47,208,15,52,224,16,57,240,15,59,0,31,0,15,31,8,32,31,16,48,31,24,64,32,31,80,32,39,96,32,48,112,32,56,128,32,64,144,31,71,161,32,80,175,31,88,193,32,96,208,32,103,224,31,111,241,31,120,0,48,0,16,48,11,32,48,23,48,48,36,64,48,47,80,48,60,96,48,72,112,48,84,128,48,96,144,48,108,162,47,120,175,48,131,193,47,145,208,48,155,224,48,169,240,48,181,0,64,0,15,64,16,31,64,32,48,64,48,64,64,64,80,64,80,96,64,96,112,64,112,129,64,128,144,63,144,160,64,160,176,64,177,192,64,192,208,64,208,224,64,225,241,63,240,0,80,0,16,80,20,31,80,39,48,80,60,64,80,80,80,80,100,96,80,120,112,80,140,128,79,160,143,80,180,159,80,200,176,80,220,192,79,240,208,80,4,224,80,23,241,80,44,0,96,0,16,96,24,32,96,48,48,96,72,64,96,95,80,96,120,96,96,143,112,96,168,128,96,191,144,95,216,160,96,240,176,96,8,193,95,33,209,95,55,225,96,80,240,96,103,0,112,0,16,112,28,31,112,56,47,112,84,64,112,111,80,112,140,96,112,168,112,112,197,128,112,225,143,112,252,161,112,24,175,112,52,193,112,78,209,112,108,224,112,136,240,112,164,0,128,0,15,128,32,31,128,64,48,128,96,64,128,128,80,128,160,96,128,192,112,128,225,128,128,0,144,128,31,160,128,64,176,128,96,192,128,128,208,128,160,225,129,192,240,128,224,0,144,0,16,144,35,31,144,72,47,144,108,65,143,145,79,145,180,96,143,216,111,144,253,128,144,32,145,144,69,160,144,104,175,144,140,193,144,176,208,144,214,224,144,249,240,144,28,0,160,0,15,160,40,32,160,79,49,159,120,64,161,160,79,161,200,96,160,240,113,160,24,127,160,63,145,160,104,161,160,144,176,161,184,192,160,223,209,160,7,224,160,48,240,160,88,0,176,0,16,177,43,31,176,89,48,177,131,64,176,177,80,176,220,95,176,7,112,176,53,128,176,96,144,177,140,159,176,183,177,175,229,193,176,16,209,176,60,224,176,103,240,177,148,0,192,0,15,193,47,32,192,96,48,192,145,64,193,192,80,192,240,96,192,33,112,192,78,128,192,128,144,192,176,161,192,224,177,192,16,190,193,63,209,192,113,224,193,160,241,192,209,0,208,0,15,208,52,32,209,103,48,208,155,63,208,208,79,208,4,97,208,56,113,208,108,128,208,161,144,208,213,160,208,7,177,208,60,192,208,113,208,209,163,224,209,216,241,208,12,0,224,0,16,225,56,31,224,112,47,224,168,64,225,225,80,224,23,96,224,79,111,225,136,128,225,192,144,224,248,160,224,48,177,224,103,192,224,160,208,224,215,224,224,16,240,224,72,0,241,0,16,240,59,32,240,120,47,241,181,65,240,240,80,240,43,96,241,104,112,240,164,128,240,224,144,241,28,160,241,88,175,240,148,193,240,210,208,240,12,224,241,72,241,240,130]

  it("decodes 12-bit sequential DCT within IDCT tolerance of djpeg", () => {
    const d = decodeJpegToRgba(bytes(DCT12_SEQUENTIAL))
    expect(d.width).toBe(16)
    for (let i = 0; i < 16 * 16 * 3; i++) {
      const mine = d.rgba[Math.trunc(i / 3) * 4 + i % 3]!
      expect(Math.abs(mine - DJPEG_REFERENCE[i]!), `sample ${i}`).toBeLessThanOrEqual(2)
    }
  })

  it("preserves 12-bit component samples while exposing an 8-bit RGBA preview", () => {
    const decoded = decodeJpegToRgbaWithSamples(bytes(DCT12_SEQUENTIAL))
    expect(decoded.bitDepth).toBe(12)
    expect(decoded.samples).toBeInstanceOf(Uint16Array)
    expect(Math.max(...decoded.samples)).toBeGreaterThan(255)
    expect(decoded.rgba).toBeInstanceOf(Uint8Array)
  })

  it("decodes 12-bit arithmetic identically to the Huffman source", () => {
    const a = decodeJpegToRgba(bytes(DCT12_ARITHMETIC))
    const h = decodeJpegToRgba(bytes(DCT12_SEQUENTIAL))
    expect(a.rgba).toEqual(h.rgba)
  })

  it("decodes 12-bit progressive scans", () => {
    const d = decodeJpegToRgba(bytes(DCT12_PROGRESSIVE))
    for (let i = 0; i < 16 * 16 * 3; i++) {
      const mine = d.rgba[Math.trunc(i / 3) * 4 + i % 3]!
      expect(Math.abs(mine - DJPEG_REFERENCE[i]!), `sample ${i}`).toBeLessThanOrEqual(3)
    }
  })
})
