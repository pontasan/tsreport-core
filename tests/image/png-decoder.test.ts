import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { zlibDeflate } from '../../src/compression/deflate.js'
import { parsePngInfo, decodePng, decompressPng } from '../../src/image/png-parser.js'
import { decodeRasterWithExternalDecoder } from '../../src/image/external-image-decoder.js'

/* ------------------------------------------------------------------ */
/* PNG encoding helpers (spec-side reference encoder for round-trips) */
/* ------------------------------------------------------------------ */

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

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

function buildPngFile(chunks: Uint8Array[]): Uint8Array {
  let total = PNG_SIG.length
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  out.set(PNG_SIG)
  let pos = PNG_SIG.length
  for (const c of chunks) { out.set(c, pos); pos += c.length }
  return out
}

function makeIhdr(width: number, height: number, bitDepth: number, colorType: number, interlace: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  ihdr[0] = (width >> 24) & 0xFF; ihdr[1] = (width >> 16) & 0xFF; ihdr[2] = (width >> 8) & 0xFF; ihdr[3] = width & 0xFF
  ihdr[4] = (height >> 24) & 0xFF; ihdr[5] = (height >> 16) & 0xFF; ihdr[6] = (height >> 8) & 0xFF; ihdr[7] = height & 0xFF
  ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = interlace
  return ihdr
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Pack one scanline of source-depth samples into bytes (MSB-first bit packing, 16-bit big-endian) */
function packRow(samples: number[], rowOffset: number, width: number, channels: number, bitDepth: number): Uint8Array {
  const rowBytes = (width * channels * bitDepth + 7) >> 3
  const row = new Uint8Array(rowBytes)
  const count = width * channels
  if (bitDepth === 16) {
    for (let i = 0; i < count; i++) {
      const v = samples[rowOffset + i]!
      row[i * 2] = (v >> 8) & 0xFF
      row[i * 2 + 1] = v & 0xFF
    }
  } else if (bitDepth === 8) {
    for (let i = 0; i < count; i++) row[i] = samples[rowOffset + i]! & 0xFF
  } else {
    for (let i = 0; i < count; i++) {
      const bitPos = i * bitDepth
      const shift = 8 - bitDepth - (bitPos & 7)
      row[bitPos >> 3] = row[bitPos >> 3]! | ((samples[rowOffset + i]! & ((1 << bitDepth) - 1)) << shift)
    }
  }
  return row
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Apply the forward scanline filters (PNG spec 9. Filtering) and produce the
 * filtered byte stream: one filter-type byte followed by rowBytes per row.
 */
function filterScanlines(
  rows: Uint8Array[],
  bpp: number,
  filterTypes: number[],
): Uint8Array {
  const rowBytes = rows.length > 0 ? rows[0]!.length : 0
  const out = new Uint8Array(rows.length * (rowBytes + 1))
  let pos = 0
  for (let y = 0; y < rows.length; y++) {
    const f = filterTypes[y % filterTypes.length]!
    const cur = rows[y]!
    const prev = y > 0 ? rows[y - 1]! : null
    out[pos++] = f
    for (let x = 0; x < rowBytes; x++) {
      const raw = cur[x]!
      const left = x >= bpp ? cur[x - bpp]! : 0
      const up = prev ? prev[x]! : 0
      const upLeft = prev && x >= bpp ? prev[x - bpp]! : 0
      let v: number
      if (f === 0) v = raw
      else if (f === 1) v = raw - left
      else if (f === 2) v = raw - up
      else if (f === 3) v = raw - ((left + up) >> 1)
      else v = raw - paeth(left, up, upLeft)
      out[pos++] = v & 0xFF
    }
  }
  return out
}

// Adam7 interlace pass layout (PNG spec 8.2)
const ADAM7_X_ORIGIN = [0, 4, 0, 2, 0, 1, 0]
const ADAM7_Y_ORIGIN = [0, 0, 4, 0, 2, 0, 1]
const ADAM7_X_STEP = [8, 8, 4, 4, 2, 2, 1]
const ADAM7_Y_STEP = [8, 8, 8, 4, 4, 2, 2]

interface EncodeOptions {
  width: number
  height: number
  bitDepth: number
  colorType: number
  samples: number[]
  palette?: Uint8Array
  tRNS?: Uint8Array
  interlace?: number
  filterTypes?: number[]
  idatSplit?: number
}

/** Encode a PNG from source-depth channel samples (reference implementation for tests) */
function encodePng(opts: EncodeOptions): Uint8Array {
  const { width, height, bitDepth, colorType, samples } = opts
  const interlace = opts.interlace ?? 0
  const filterTypes = opts.filterTypes ?? [0]
  const channels = CHANNELS[colorType]!
  const bpp = Math.max(1, (channels * bitDepth) >> 3)

  let raw: Uint8Array
  if (interlace === 0) {
    const rows: Uint8Array[] = []
    for (let y = 0; y < height; y++) rows.push(packRow(samples, y * width * channels, width, channels, bitDepth))
    raw = filterScanlines(rows, bpp, filterTypes)
  } else {
    // Adam7: split into 7 sub-images, each filtered independently
    const parts: Uint8Array[] = []
    let total = 0
    for (let pass = 0; pass < 7; pass++) {
      const xo = ADAM7_X_ORIGIN[pass]!
      const yo = ADAM7_Y_ORIGIN[pass]!
      const xs = ADAM7_X_STEP[pass]!
      const ys = ADAM7_Y_STEP[pass]!
      const pw = Math.ceil((width - xo) / xs)
      const ph = Math.ceil((height - yo) / ys)
      if (pw <= 0 || ph <= 0) continue
      const rows: Uint8Array[] = []
      for (let py = 0; py < ph; py++) {
        const passSamples: number[] = []
        for (let px = 0; px < pw; px++) {
          const sx = xo + px * xs
          const sy = yo + py * ys
          const base = (sy * width + sx) * channels
          for (let c = 0; c < channels; c++) passSamples.push(samples[base + c]!)
        }
        rows.push(packRow(passSamples, 0, pw, channels, bitDepth))
      }
      const filtered = filterScanlines(rows, bpp, filterTypes)
      parts.push(filtered)
      total += filtered.length
    }
    raw = new Uint8Array(total)
    let pos = 0
    for (const p of parts) { raw.set(p, pos); pos += p.length }
  }

  const compressed = zlibDeflate(raw)
  const chunks: Uint8Array[] = [makeChunk('IHDR', makeIhdr(width, height, bitDepth, colorType, interlace))]
  if (opts.palette) chunks.push(makeChunk('PLTE', opts.palette))
  if (opts.tRNS) chunks.push(makeChunk('tRNS', opts.tRNS))
  const split = opts.idatSplit ?? 1
  if (split <= 1) {
    chunks.push(makeChunk('IDAT', compressed))
  } else {
    const size = Math.max(1, Math.ceil(compressed.length / split))
    for (let pos = 0; pos < compressed.length; pos += size) {
      chunks.push(makeChunk('IDAT', compressed.subarray(pos, Math.min(pos + size, compressed.length))))
    }
  }
  chunks.push(makeChunk('IEND', new Uint8Array(0)))
  return buildPngFile(chunks)
}

/** Compute the expected RGBA8 output per the PNG spec, independent of the decoder */
function expectedRgba(opts: EncodeOptions): Uint8Array {
  const { width, height, bitDepth, colorType, samples, palette, tRNS } = opts
  const channels = CHANNELS[colorType]!
  const rgba = new Uint8Array(width * height * 4)
  const maxSample = (1 << bitDepth) - 1
  let tGray = -1
  let tR = -1, tG = -1, tB = -1
  if (tRNS && colorType === 0) tGray = (tRNS[0]! << 8) | tRNS[1]!
  if (tRNS && colorType === 2) {
    tR = (tRNS[0]! << 8) | tRNS[1]!
    tG = (tRNS[2]! << 8) | tRNS[3]!
    tB = (tRNS[4]! << 8) | tRNS[5]!
  }
  const to8 = (v: number): number => bitDepth === 16 ? v >> 8 : Math.round(v * 255 / maxSample)
  for (let i = 0; i < width * height; i++) {
    const si = i * channels
    const di = i * 4
    if (colorType === 0) {
      const s = samples[si]!
      const v = to8(s)
      rgba[di] = v; rgba[di + 1] = v; rgba[di + 2] = v
      rgba[di + 3] = s === tGray ? 0 : 255
    } else if (colorType === 2) {
      const r = samples[si]!, g = samples[si + 1]!, b = samples[si + 2]!
      rgba[di] = to8(r); rgba[di + 1] = to8(g); rgba[di + 2] = to8(b)
      rgba[di + 3] = (r === tR && g === tG && b === tB) ? 0 : 255
    } else if (colorType === 3) {
      const idx = samples[si]!
      rgba[di] = palette![idx * 3]!; rgba[di + 1] = palette![idx * 3 + 1]!; rgba[di + 2] = palette![idx * 3 + 2]!
      rgba[di + 3] = tRNS && idx < tRNS.length ? tRNS[idx]! : 255
    } else if (colorType === 4) {
      const v = to8(samples[si]!)
      rgba[di] = v; rgba[di + 1] = v; rgba[di + 2] = v
      rgba[di + 3] = to8(samples[si + 1]!)
    } else {
      rgba[di] = to8(samples[si]!); rgba[di + 1] = to8(samples[si + 1]!)
      rgba[di + 2] = to8(samples[si + 2]!); rgba[di + 3] = to8(samples[si + 3]!)
    }
  }
  return rgba
}

/** Deterministic pseudo-random samples within the source bit depth range */
function makeSamples(count: number, bitDepth: number, maxValue?: number): number[] {
  const max = maxValue ?? (bitDepth === 16 ? 65535 : (1 << bitDepth) - 1)
  const out: number[] = []
  let seed = 0x2F6E2B1
  for (let i = 0; i < count; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
    out.push(seed % (max + 1))
  }
  return out
}

/** Deterministic palette with the given number of entries */
function makePalette(entries: number): Uint8Array {
  const p = new Uint8Array(entries * 3)
  for (let i = 0; i < entries; i++) {
    p[i * 3] = (i * 37 + 11) & 0xFF
    p[i * 3 + 1] = (i * 73 + 5) & 0xFF
    p[i * 3 + 2] = (i * 151 + 91) & 0xFF
  }
  return p
}

/** Find the first differing byte index between two arrays (-1 when identical) */
function firstMismatch(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return -2
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return i
  }
  return -1
}

// All valid color type x bit depth combinations (PNG spec 11.2.2)
const VALID_COMBINATIONS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 4], [0, 8], [0, 16],
  [2, 8], [2, 16],
  [3, 1], [3, 2], [3, 4], [3, 8],
  [4, 8], [4, 16],
  [6, 8], [6, 16],
]

function buildTestImage(colorType: number, bitDepth: number, width: number, height: number): EncodeOptions {
  const channels = CHANNELS[colorType]!
  if (colorType === 3) {
    const entries = 1 << bitDepth
    return {
      width, height, bitDepth, colorType,
      samples: makeSamples(width * height, bitDepth, entries - 1),
      palette: makePalette(entries),
    }
  }
  return { width, height, bitDepth, colorType, samples: makeSamples(width * height * channels, bitDepth) }
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe('PNG decoder: color type x bit depth matrix', () => {
  // Verifies every valid color type / bit depth combination decodes to the
  // spec-defined RGBA values (gray expansion 255/(2^d-1), 16-bit high byte).
  for (const [ct, bd] of VALID_COMBINATIONS) {
    it(`decodes color type ${ct}, bit depth ${bd}`, () => {
      // Width 5 exercises partial trailing bytes for sub-byte bit depths
      const opts = buildTestImage(ct, bd, 5, 4)
      const decoded = decodePng(encodePng(opts))
      expect(decoded.width).toBe(5)
      expect(decoded.height).toBe(4)
      expect(decoded.pixels).toEqual(expectedRgba(opts))
    })
  }

  // Verifies the exact gray expansion of each representable level for every sub-byte depth.
  it('expands grayscale levels exactly (255 / (2^d - 1))', () => {
    for (const bd of [1, 2, 4, 8]) {
      const max = (1 << bd) - 1
      const samples: number[] = []
      for (let v = 0; v <= max && samples.length < 8; v++) samples.push(v)
      while (samples.length < 8) samples.push(max)
      const opts: EncodeOptions = { width: 8, height: 1, bitDepth: bd, colorType: 0, samples }
      const decoded = decodePng(encodePng(opts))
      for (let i = 0; i < 8; i++) {
        expect(decoded.pixels[i * 4]).toBe(Math.round(samples[i]! * 255 / max))
        expect(decoded.pixels[i * 4 + 3]).toBe(255)
      }
    }
  })

  // Verifies 16-bit samples are reduced by taking the high byte.
  it('reduces 16-bit samples to the high byte', () => {
    const samples = [0x0000, 0x00FF, 0x0100, 0x7FFF, 0x8000, 0xFF00, 0xFFFE, 0xFFFF]
    const opts: EncodeOptions = { width: 8, height: 1, bitDepth: 16, colorType: 0, samples }
    const decoded = decodePng(encodePng(opts))
    for (let i = 0; i < 8; i++) {
      expect(decoded.pixels[i * 4]).toBe(samples[i]! >> 8)
    }
  })
})

describe('PNG decoder: scanline filters', () => {
  // Verifies an image mixing all five filter types across rows decodes correctly.
  it('decodes all filter types 0-4 in one image', () => {
    const opts = buildTestImage(2, 8, 4, 5)
    opts.filterTypes = [0, 1, 2, 3, 4]
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })

  // Verifies each filter type on the first scanline (no previous row: Up is
  // identity, Average and Paeth degenerate to left-only prediction).
  for (const f of [1, 2, 3, 4]) {
    it(`decodes filter type ${f} on the first scanline`, () => {
      const opts = buildTestImage(6, 8, 3, 2)
      opts.filterTypes = [f]
      const decoded = decodePng(encodePng(opts))
      expect(decoded.pixels).toEqual(expectedRgba(opts))
    })
  }

  // Verifies filters with the widest pixel stride (RGBA 16-bit, bpp = 8),
  // exercising the first-pixel (x < bpp) branches.
  it('decodes filters with 16-bit RGBA (bpp = 8)', () => {
    const opts = buildTestImage(6, 16, 3, 5)
    opts.filterTypes = [1, 2, 3, 4]
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })

  // Verifies filters operate on packed bytes for sub-byte bit depths (bpp = 1).
  it('decodes filters with 1-bit grayscale (packed rows)', () => {
    const opts = buildTestImage(0, 1, 12, 5)
    opts.filterTypes = [0, 1, 2, 3, 4]
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })

  // Verifies a single-pixel-wide image (every filter sees only x < bpp bytes).
  it('decodes filters on a 1-pixel-wide image', () => {
    const opts = buildTestImage(6, 8, 1, 5)
    opts.filterTypes = [0, 1, 2, 3, 4]
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })
})

describe('PNG decoder: Adam7 interlacing', () => {
  const SIZES: Array<[number, number]> = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 3], [7, 7], [8, 8], [9, 10], [16, 16]]

  // Verifies interlaced output equals the non-interlaced decode of the same
  // pixels across boundary sizes (empty passes, single-sample passes).
  for (const [w, h] of SIZES) {
    it(`decodes ${w}x${h} interlaced identically to non-interlaced (RGBA 8-bit)`, () => {
      const opts = buildTestImage(6, 8, w, h)
      const plain = decodePng(encodePng(opts))
      const interlaced = decodePng(encodePng({ ...opts, interlace: 1 }))
      expect(interlaced.width).toBe(w)
      expect(interlaced.height).toBe(h)
      expect(interlaced.pixels).toEqual(plain.pixels)
    })
  }

  // Verifies interlacing for every color type / bit depth combination
  // (sub-byte pass rows have their own bit packing per pass).
  for (const [ct, bd] of VALID_COMBINATIONS) {
    it(`decodes 9x10 interlaced color type ${ct}, bit depth ${bd}`, () => {
      const opts = buildTestImage(ct, bd, 9, 10)
      opts.interlace = 1
      const decoded = decodePng(encodePng(opts))
      expect(decoded.pixels).toEqual(expectedRgba(opts))
    })
  }

  // Verifies sub-byte packed passes at boundary sizes for 1-bit grayscale.
  for (const [w, h] of SIZES) {
    it(`decodes ${w}x${h} interlaced 1-bit grayscale`, () => {
      const opts = buildTestImage(0, 1, w, h)
      opts.interlace = 1
      const decoded = decodePng(encodePng(opts))
      expect(decoded.pixels).toEqual(expectedRgba(opts))
    })
  }

  // Verifies filtered scanlines inside each interlace pass are unfiltered per pass.
  it('decodes interlaced passes with mixed filter types', () => {
    const opts = buildTestImage(2, 8, 9, 10)
    opts.interlace = 1
    opts.filterTypes = [0, 1, 2, 3, 4]
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })
})

describe('PNG decoder: tRNS transparency', () => {
  // Verifies palette alpha entries and the implicit 255 for indices beyond the tRNS array.
  it('applies tRNS alpha to palette images (color type 3)', () => {
    const palette = makePalette(4)
    const tRNS = new Uint8Array([0, 128, 255])
    const opts: EncodeOptions = {
      width: 4, height: 1, bitDepth: 8, colorType: 3,
      samples: [0, 1, 2, 3], palette, tRNS,
    }
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels[3]).toBe(0)
    expect(decoded.pixels[7]).toBe(128)
    expect(decoded.pixels[11]).toBe(255)
    expect(decoded.pixels[15]).toBe(255) // index 3 is beyond tRNS: opaque
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })

  // Verifies palette tRNS with a sub-byte bit depth.
  it('applies tRNS alpha to 2-bit palette images', () => {
    const opts: EncodeOptions = {
      width: 5, height: 2, bitDepth: 2, colorType: 3,
      samples: [0, 1, 2, 3, 0, 3, 2, 1, 0, 2],
      palette: makePalette(4),
      tRNS: new Uint8Array([10, 20, 30, 40]),
    }
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })

  // Verifies the transparent gray value for every grayscale bit depth.
  for (const bd of [1, 2, 4, 8, 16]) {
    it(`makes the tRNS gray value transparent (color type 0, bit depth ${bd})`, () => {
      const max = bd === 16 ? 65535 : (1 << bd) - 1
      const transparent = bd === 16 ? 0x1234 : Math.min(1, max)
      const opaque = 0
      const tRNS = new Uint8Array([(transparent >> 8) & 0xFF, transparent & 0xFF])
      const opts: EncodeOptions = {
        width: 2, height: 1, bitDepth: bd, colorType: 0,
        samples: [transparent, opaque], tRNS,
      }
      const decoded = decodePng(encodePng(opts))
      expect(decoded.pixels[3]).toBe(0)
      expect(decoded.pixels[7]).toBe(255)
      expect(decoded.pixels).toEqual(expectedRgba(opts))
    })
  }

  // Verifies the 16-bit gray comparison uses full precision: a pixel sharing
  // only the high byte with the tRNS value must stay opaque.
  it('compares 16-bit gray tRNS at full precision', () => {
    const opts: EncodeOptions = {
      width: 2, height: 1, bitDepth: 16, colorType: 0,
      samples: [0x1234, 0x1256], tRNS: new Uint8Array([0x12, 0x34]),
    }
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels[0]).toBe(0x12)
    expect(decoded.pixels[3]).toBe(0)
    expect(decoded.pixels[4]).toBe(0x12)
    expect(decoded.pixels[7]).toBe(255)
  })

  // Verifies the transparent RGB triple for 8-bit truecolor: all three
  // channels must match; a one-channel difference stays opaque.
  it('makes the tRNS RGB value transparent (color type 2, bit depth 8)', () => {
    const tRNS = new Uint8Array([0, 10, 0, 20, 0, 30])
    const opts: EncodeOptions = {
      width: 3, height: 1, bitDepth: 8, colorType: 2,
      samples: [10, 20, 30, 10, 20, 31, 11, 20, 30], tRNS,
    }
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels[3]).toBe(0)
    expect(decoded.pixels[7]).toBe(255)
    expect(decoded.pixels[11]).toBe(255)
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })

  // Verifies the 16-bit RGB comparison uses full precision per channel.
  it('makes the tRNS RGB value transparent (color type 2, bit depth 16)', () => {
    const tRNS = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC])
    const opts: EncodeOptions = {
      width: 3, height: 1, bitDepth: 16, colorType: 2,
      samples: [
        0x1234, 0x5678, 0x9ABC, // exact match: transparent
        0x1234, 0x5678, 0x9ABD, // low byte differs: opaque
        0x1235, 0x5678, 0x9ABC, // red differs: opaque
      ],
      tRNS,
    }
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels[3]).toBe(0)
    expect(decoded.pixels[7]).toBe(255)
    expect(decoded.pixels[11]).toBe(255)
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })

  // Verifies tRNS is honored in interlaced images as well.
  it('applies tRNS in Adam7 interlaced images', () => {
    const opts: EncodeOptions = {
      width: 9, height: 10, bitDepth: 8, colorType: 0,
      samples: makeSamples(90, 8).map(v => v % 4), // small range to guarantee hits
      tRNS: new Uint8Array([0, 2]),
      interlace: 1,
    }
    const decoded = decodePng(encodePng(opts))
    expect(decoded.pixels).toEqual(expectedRgba(opts))
  })
})

describe('PNG decoder: IDAT handling', () => {
  // Verifies the zlib stream split across many IDAT chunks decodes identically.
  it('decodes IDAT data split across multiple chunks', () => {
    const opts = buildTestImage(6, 8, 8, 8)
    const single = decodePng(encodePng(opts))
    for (const split of [2, 3, 7, 1000]) {
      const multi = decodePng(encodePng({ ...opts, idatSplit: split }))
      expect(multi.pixels).toEqual(single.pixels)
    }
  })

  // Verifies parsePngInfo concatenates split IDAT payloads into one stream.
  it('parsePngInfo concatenates multiple IDAT chunks', () => {
    const opts = buildTestImage(2, 8, 4, 4)
    const singleInfo = parsePngInfo(encodePng(opts))
    const multiInfo = parsePngInfo(encodePng({ ...opts, idatSplit: 5 }))
    expect(multiInfo.idatData).toEqual(singleInfo.idatData)
  })
})

describe('PNG decoder: error handling', () => {
  const validOpts = buildTestImage(2, 8, 4, 4)

  // Verifies the 8-byte signature is enforced.
  it('rejects an invalid signature', () => {
    const png = encodePng(validOpts)
    const bad = png.slice()
    bad[0] = 0x88
    expect(() => parsePngInfo(bad)).toThrow('PNG: invalid signature')
  })

  // Verifies input shorter than signature + IHDR chunk is rejected.
  it('rejects data that is too short', () => {
    expect(() => parsePngInfo(new Uint8Array(10))).toThrow('PNG: data too short')
  })

  // Verifies chunk CRC validation (corrupted payload byte).
  it('rejects a chunk CRC mismatch', () => {
    const png = encodePng(validOpts)
    const bad = png.slice()
    bad[8 + 8 + 4] = bad[8 + 8 + 4]! ^ 0xFF // flip a byte inside the IHDR payload
    expect(() => parsePngInfo(bad)).toThrow('PNG: chunk CRC mismatch')
  })

  // Verifies a chunk whose declared length exceeds the file is rejected.
  it('rejects a truncated chunk', () => {
    const ihdr = makeChunk('IHDR', makeIhdr(1, 1, 8, 0, 0))
    // Chunk header declaring 100 payload bytes with only 4 bytes following
    const truncated = new Uint8Array([0, 0, 0, 100, 0x49, 0x44, 0x41, 0x54, 1, 2, 3, 4])
    const png = new Uint8Array(PNG_SIG.length + ihdr.length + truncated.length)
    png.set(PNG_SIG)
    png.set(ihdr, PNG_SIG.length)
    png.set(truncated, PNG_SIG.length + ihdr.length)
    expect(() => parsePngInfo(png)).toThrow('PNG: truncated chunk')
  })

  // Verifies missing IHDR is reported (ancillary chunk + IEND only).
  it('rejects a PNG without IHDR', () => {
    const png = buildPngFile([makeChunk('tEXt', new Uint8Array(16)), makeChunk('IEND', new Uint8Array(0))])
    expect(() => parsePngInfo(png)).toThrow('PNG: missing IHDR')
  })

  // Verifies chunk ordering: IDAT must come after IHDR.
  it('rejects IDAT before IHDR', () => {
    const png = buildPngFile([
      makeChunk('IDAT', new Uint8Array(16)),
      makeChunk('IHDR', makeIhdr(1, 1, 8, 0, 0)),
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => parsePngInfo(png)).toThrow('PNG: IDAT before IHDR')
  })

  // Verifies chunk ordering: PLTE must come after IHDR.
  it('rejects PLTE before IHDR', () => {
    const png = buildPngFile([
      makeChunk('PLTE', makePalette(2)),
      makeChunk('IHDR', makeIhdr(1, 1, 8, 3, 0)),
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => parsePngInfo(png)).toThrow('PNG: PLTE before IHDR')
  })

  // Verifies chunk ordering: tRNS must come after IHDR.
  it('rejects tRNS before IHDR', () => {
    const png = buildPngFile([
      makeChunk('tRNS', new Uint8Array([0, 0])),
      makeChunk('IHDR', makeIhdr(1, 1, 8, 0, 0)),
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => parsePngInfo(png)).toThrow('PNG: tRNS before IHDR')
  })

  // Verifies a second IHDR chunk is rejected.
  it('rejects a duplicate IHDR', () => {
    const ihdr = makeChunk('IHDR', makeIhdr(1, 1, 8, 0, 0))
    const idat = makeChunk('IDAT', zlibDeflate(new Uint8Array([0, 0])))
    const png = buildPngFile([ihdr, ihdr, idat, makeChunk('IEND', new Uint8Array(0))])
    expect(() => parsePngInfo(png)).toThrow('PNG: duplicate IHDR')
  })

  // Verifies missing IDAT is reported.
  it('rejects a PNG without IDAT', () => {
    const png = buildPngFile([
      makeChunk('IHDR', makeIhdr(4, 4, 8, 0, 0)),
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => parsePngInfo(png)).toThrow('PNG: missing IDAT')
  })

  // Verifies missing IEND is reported.
  it('rejects a PNG without IEND', () => {
    const png = buildPngFile([
      makeChunk('IHDR', makeIhdr(1, 1, 8, 0, 0)),
      makeChunk('IDAT', zlibDeflate(new Uint8Array([0, 0]))),
    ])
    expect(() => parsePngInfo(png)).toThrow('PNG: missing IEND')
  })

  // Verifies a palette image without PLTE is rejected.
  it('rejects a palette image without PLTE', () => {
    const png = buildPngFile([
      makeChunk('IHDR', makeIhdr(1, 1, 8, 3, 0)),
      makeChunk('IDAT', zlibDeflate(new Uint8Array([0, 0]))),
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => parsePngInfo(png)).toThrow('PNG: palette image without PLTE')
  })

  // Verifies zero dimensions are rejected.
  it('rejects zero width or height', () => {
    for (const [w, h] of [[0, 1], [1, 0]] as Array<[number, number]>) {
      const png = buildPngFile([
        makeChunk('IHDR', makeIhdr(w, h, 8, 0, 0)),
        makeChunk('IDAT', zlibDeflate(new Uint8Array([0, 0]))),
        makeChunk('IEND', new Uint8Array(0)),
      ])
      expect(() => parsePngInfo(png)).toThrow('PNG: invalid dimensions')
    }
  })

  // Verifies every invalid color type / bit depth combination is rejected.
  it('rejects invalid color type / bit depth combinations', () => {
    expect(() => parsePngInfo(buildPngFile([
      makeChunk('IHDR', makeIhdr(1, 1, 8, 1, 0)),
      makeChunk('IDAT', zlibDeflate(new Uint8Array([0, 0]))),
      makeChunk('IEND', new Uint8Array(0)),
    ]))).toThrow('PNG: invalid color type 1')

    const invalidDepths: Array<[number, number]> = [
      [0, 3], [0, 32],
      [2, 1], [2, 2], [2, 4],
      [3, 16],
      [4, 1], [4, 2], [4, 4],
      [6, 1], [6, 2], [6, 4],
    ]
    for (const [ct, bd] of invalidDepths) {
      const png = buildPngFile([
        makeChunk('IHDR', makeIhdr(1, 1, bd, ct, 0)),
        makeChunk('IDAT', zlibDeflate(new Uint8Array([0, 0]))),
        makeChunk('IEND', new Uint8Array(0)),
      ])
      expect(() => parsePngInfo(png)).toThrow(`PNG: invalid bit depth ${bd} for color type ${ct}`)
    }
  })

  // Verifies unsupported IHDR compression / filter / interlace methods are rejected.
  it('rejects unsupported IHDR methods', () => {
    const build = (compression: number, filter: number, interlace: number): Uint8Array => {
      const ihdr = makeIhdr(1, 1, 8, 0, interlace)
      ihdr[10] = compression
      ihdr[11] = filter
      return buildPngFile([
        makeChunk('IHDR', ihdr),
        makeChunk('IDAT', zlibDeflate(new Uint8Array([0, 0]))),
        makeChunk('IEND', new Uint8Array(0)),
      ])
    }
    expect(() => parsePngInfo(build(1, 0, 0))).toThrow('PNG: unsupported compression method 1')
    expect(() => parsePngInfo(build(0, 1, 0))).toThrow('PNG: unsupported filter method 1')
    expect(() => parsePngInfo(build(0, 0, 2))).toThrow('PNG: unsupported interlace method 2')
  })

  // Verifies IHDR length validation.
  it('rejects an IHDR with an invalid length', () => {
    const png = buildPngFile([
      makeChunk('IHDR', new Uint8Array(12)),
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => parsePngInfo(png)).toThrow('PNG: invalid IHDR length')
  })

  // Verifies PLTE length validation (empty, not a multiple of 3, over 256 entries).
  it('rejects an invalid PLTE length', () => {
    for (const len of [0, 4, 257 * 3]) {
      const png = buildPngFile([
        makeChunk('IHDR', makeIhdr(1, 1, 8, 3, 0)),
        makeChunk('PLTE', new Uint8Array(len)),
        makeChunk('IDAT', zlibDeflate(new Uint8Array([0, 0]))),
        makeChunk('IEND', new Uint8Array(0)),
      ])
      expect(() => parsePngInfo(png)).toThrow('PNG: invalid PLTE length')
    }
  })

  // Verifies an invalid scanline filter type byte throws at decode time.
  it('rejects an invalid filter type', () => {
    const raw = new Uint8Array([5, 0]) // filter 5, one gray pixel
    const png = buildPngFile([
      makeChunk('IHDR', makeIhdr(1, 1, 8, 0, 0)),
      makeChunk('IDAT', zlibDeflate(raw)),
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => decodePng(png)).toThrow('PNG: invalid filter type 5')
  })

  // Verifies decompressed stream size validation for both too-short and too-long data.
  it('rejects a decompressed size mismatch', () => {
    for (const raw of [new Uint8Array(1), new Uint8Array(3)]) { // expected 2 bytes for 1x1 gray
      const png = buildPngFile([
        makeChunk('IHDR', makeIhdr(1, 1, 8, 0, 0)),
        makeChunk('IDAT', zlibDeflate(raw)),
        makeChunk('IEND', new Uint8Array(0)),
      ])
      expect(() => decodePng(png)).toThrow('PNG: invalid decompressed data length')
    }
  })

  // Verifies decompressed size validation for interlaced images.
  it('rejects a decompressed size mismatch in interlaced images', () => {
    const png = buildPngFile([
      makeChunk('IHDR', makeIhdr(2, 2, 8, 0, 1)),
      makeChunk('IDAT', zlibDeflate(new Uint8Array(3))), // Adam7 2x2 gray needs 2+2+3 bytes
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => decodePng(png)).toThrow('PNG: invalid decompressed data length')
  })

  // Verifies a palette index beyond the PLTE entry count throws at decode time.
  it('rejects a palette index out of range', () => {
    const raw = new Uint8Array([0, 3]) // filter 0, index 3 with a 2-entry palette
    const png = buildPngFile([
      makeChunk('IHDR', makeIhdr(1, 1, 8, 3, 0)),
      makeChunk('PLTE', makePalette(2)),
      makeChunk('IDAT', zlibDeflate(raw)),
      makeChunk('IEND', new Uint8Array(0)),
    ])
    expect(() => decodePng(png)).toThrow('PNG: palette index 3 out of range')
  })
})

describe('PNG decoder: parsePngInfo fields', () => {
  // Verifies every parsed field for a palette image with tRNS and interlacing.
  it('reports IHDR fields, palette, and tRNS', () => {
    const palette = makePalette(16)
    const tRNS = new Uint8Array([0, 64, 128])
    const png = encodePng({
      width: 9, height: 10, bitDepth: 4, colorType: 3,
      samples: makeSamples(90, 4, 15),
      palette, tRNS, interlace: 1,
    })
    const info = parsePngInfo(png)
    expect(info.width).toBe(9)
    expect(info.height).toBe(10)
    expect(info.bitDepth).toBe(4)
    expect(info.colorType).toBe(3)
    expect(info.interlace).toBe(1)
    expect(info.palette).toEqual(palette)
    expect(info.tRNS).toEqual(tRNS)
    expect(info.sourceData).toBe(png)
    expect(info.idatData.length).toBeGreaterThan(0)
  })

  // Verifies palette and tRNS are null when absent.
  it('reports null palette and tRNS when absent', () => {
    const info = parsePngInfo(encodePng(buildTestImage(2, 8, 3, 3)))
    expect(info.palette).toBeNull()
    expect(info.tRNS).toBeNull()
    expect(info.interlace).toBe(0)
  })

  // Verifies the legacy decompressPng API matches decodePng output.
  it('decompressPng matches decodePng', () => {
    const png = encodePng(buildTestImage(6, 8, 5, 4))
    const info = parsePngInfo(png)
    expect(decompressPng(info)).toEqual(decodePng(png).pixels)
  })
})

describe('PNG decoder: real files vs external decoder (ground truth)', () => {
  // Verifies the pure decoder produces byte-identical RGBA output to the
  // external (sharp-based) decoder for real-world sample files.
  for (const file of ['sample1.png', 'format_check.png']) {
    it(`decodes ${file} identically to the external decoder`, () => {
      const data = new Uint8Array(readFileSync(new URL(`../sample/images/${file}`, import.meta.url)))
      const pure = decodePng(data)
      const external = decodeRasterWithExternalDecoder(data, 'png')
      expect(pure.width).toBe(external.width)
      expect(pure.height).toBe(external.height)
      expect(firstMismatch(pure.pixels, external.pixels)).toBe(-1)
    })
  }
})
