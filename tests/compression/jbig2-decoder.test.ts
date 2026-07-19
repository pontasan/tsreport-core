// JBIG2 decoder round trip: a spec-faithful MQ *encoder* (ISO 15444-1 C.2 /
// T.88 E.3, test-only) encodes bitmaps with the same context models the
// decoder uses; decoding must reproduce them exactly. Also verifies the
// PDF-embedded segment layer via a hand-built generic-region stream.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodeJbig2, decodeJbig2Pages } from '../../src/compression/jbig2-decoder.js'
import { MqDecoder } from '../../src/compression/mq-decoder.js'

const JBIG2DEC_AVAILABLE = spawnSync('jbig2dec', ['--version']).status === 0

// ─── Test-only MQ encoder ───

const QE = [
  [0x5601, 1, 1, 1], [0x3401, 2, 6, 0], [0x1801, 3, 9, 0], [0x0AC1, 4, 12, 0],
  [0x0521, 5, 29, 0], [0x0221, 38, 33, 0], [0x5601, 7, 6, 1], [0x5401, 8, 14, 0],
  [0x4801, 9, 14, 0], [0x3801, 10, 14, 0], [0x3001, 11, 17, 0], [0x2401, 12, 18, 0],
  [0x1C01, 13, 20, 0], [0x1601, 29, 21, 0], [0x5601, 15, 14, 1], [0x5401, 16, 14, 0],
  [0x5101, 17, 15, 0], [0x4801, 18, 16, 0], [0x3801, 19, 17, 0], [0x3401, 20, 18, 0],
  [0x3001, 21, 19, 0], [0x2801, 22, 19, 0], [0x2401, 23, 20, 0], [0x2201, 24, 21, 0],
  [0x1C01, 25, 22, 0], [0x1801, 26, 23, 0], [0x1601, 27, 24, 0], [0x1401, 28, 25, 0],
  [0x1201, 29, 26, 0], [0x1101, 30, 27, 0], [0x0AC1, 31, 28, 0], [0x09C1, 32, 29, 0],
  [0x08A1, 33, 30, 0], [0x0521, 34, 31, 0], [0x0441, 35, 32, 0], [0x02A1, 36, 33, 0],
  [0x0221, 37, 34, 0], [0x0141, 38, 35, 0], [0x0111, 39, 36, 0], [0x0085, 40, 37, 0],
  [0x0049, 41, 38, 0], [0x0025, 42, 39, 0], [0x0015, 43, 40, 0], [0x0009, 44, 41, 0],
  [0x0005, 45, 42, 0], [0x0001, 45, 43, 0], [0x5601, 46, 46, 0],
]

class MqEncoder {
  private a = 0x8000
  private c = 0
  private ct = 12
  private b = -1 // pending byte (-1: none)
  private out: number[] = []

  encode(d: number, cx: { index: number, mps: number }): void {
    const q = QE[cx.index]!
    const qe = q[0]!
    if (d === cx.mps) {
      this.a -= qe
      if ((this.a & 0x8000) === 0) {
        if (this.a < qe) this.a = qe
        else this.c += qe
        cx.index = q[1]!
        this.renorm()
      } else {
        this.c += qe
      }
    } else {
      this.a -= qe
      if (this.a < qe) this.c += qe
      else this.a = qe
      if (q[3]! === 1) cx.mps = 1 - cx.mps
      cx.index = q[2]!
      this.renorm()
    }
  }

  private renorm(): void {
    do {
      if (this.ct === 0) this.byteOut()
      this.a = (this.a << 1) & 0xFFFF
      this.c = (this.c << 1) >>> 0
      this.ct--
    } while ((this.a & 0x8000) === 0)
  }

  private byteOut(): void {
    if (this.b === 0xFF) {
      this.push(this.c >>> 20)
      this.c &= 0xFFFFF
      this.ct = 7
    } else if (this.c < 0x8000000) {
      this.push(this.c >>> 19)
      this.c &= 0x7FFFF
      this.ct = 8
    } else {
      this.b += 1
      if (this.b === 0xFF) {
        this.c &= 0x7FFFFFF
        this.push(this.c >>> 20)
        this.c &= 0xFFFFF
        this.ct = 7
      } else {
        this.push(this.c >>> 19)
        this.c &= 0x7FFFF
        this.ct = 8
      }
    }
  }

  private push(byte: number): void {
    if (this.b >= 0) this.out.push(this.b)
    this.b = byte & 0xFF
  }

  flush(): Uint8Array {
    // SETBITS (OpenJPEG opj_mqc_setbits form)
    const tempc = (this.c + this.a) >>> 0
    this.c = (this.c | 0xFFFF) >>> 0
    if (this.c >= tempc) this.c -= 0x8000
    this.c = (this.c << this.ct) >>> 0
    this.byteOut()
    this.c = (this.c << this.ct) >>> 0
    this.byteOut()
    if (this.b >= 0) this.out.push(this.b)
    this.out.push(0xFF, 0xAC)
    return new Uint8Array(this.out)
  }
}

class TestArithIntContext {
  readonly contexts: { index: number, mps: number }[] = []
  constructor() {
    for (let i = 0; i < 512; i++) this.contexts.push({ index: 0, mps: 0 })
  }
}

function encodeArithInt(enc: MqEncoder, cx: TestArithIntContext, value: number | null): void {
  let previous = 1
  const bit = (value: number): void => {
    enc.encode(value, cx.contexts[previous]!)
    previous = previous < 256 ? (previous << 1) | value : ((((previous << 1) | value) & 511) | 256)
  }
  if (value === null) {
    bit(1); bit(0); bit(0); bit(0)
    return
  }
  bit(value < 0 ? 1 : 0)
  const magnitude = Math.abs(value)
  let payload: number
  let payloadBits: number
  if (magnitude < 4) { bit(0); payload = magnitude; payloadBits = 2 }
  else if (magnitude < 20) { bit(1); bit(0); payload = magnitude - 4; payloadBits = 4 }
  else if (magnitude < 84) { bit(1); bit(1); bit(0); payload = magnitude - 20; payloadBits = 6 }
  else if (magnitude < 340) { bit(1); bit(1); bit(1); bit(0); payload = magnitude - 84; payloadBits = 8 }
  else if (magnitude < 4436) { bit(1); bit(1); bit(1); bit(1); bit(0); payload = magnitude - 340; payloadBits = 12 }
  else { bit(1); bit(1); bit(1); bit(1); bit(1); payload = magnitude - 4436; payloadBits = 32 }
  for (let shift = payloadBits - 1; shift >= 0; shift--) bit((payload >>> shift) & 1)
}

function encodeIaid(enc: MqEncoder, contexts: { index: number, mps: number }[], codeLength: number, value: number): void {
  let previous = 1
  for (let shift = codeLength - 1; shift >= 0; shift--) {
    const bit = (value >>> shift) & 1
    enc.encode(bit, contexts[previous]!)
    previous = (previous << 1) | bit
  }
}

function decodeTestArithInt(mq: MqDecoder, cx: TestArithIntContext): number | null {
  let previous = 1
  const bit = (): number => {
    const value = mq.decode(cx.contexts[previous]!)
    previous = previous < 256 ? (previous << 1) | value : ((((previous << 1) | value) & 511) | 256)
    return value
  }
  const sign = bit()
  let value: number
  if (bit() === 0) value = read(2)
  else if (bit() === 0) value = read(4) + 4
  else if (bit() === 0) value = read(6) + 20
  else if (bit() === 0) value = read(8) + 84
  else if (bit() === 0) value = read(12) + 340
  else value = read(32) + 4436
  function read(count: number): number {
    let result = 0
    for (let i = 0; i < count; i++) result = (result << 1) | bit()
    return result
  }
  if (sign === 1 && value === 0) return null
  return sign === 1 ? -value : value
}

// ─── Generic region encoder (template 0, same context model as the decoder) ───

function encodeGenericTemplate0(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const enc = new MqEncoder()
  const cx: { index: number, mps: number }[] = []
  for (let i = 0; i < 1 << 16; i++) cx.push({ index: 0, mps: 0 })
  encodeGenericTemplate0Into(enc, cx, width, height, pixels)
  return enc.flush()
}

function encodeGenericTemplate0Into(
  enc: MqEncoder, cx: { index: number, mps: number }[], width: number, height: number, pixels: Uint8Array,
): void {
  const get = (x: number, y: number): number =>
    x < 0 || x >= width || y < 0 || y >= height ? 0 : pixels[y * width + x]!
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const context =
        (get(x - 1, y) << 0) | (get(x - 2, y) << 1) | (get(x - 3, y) << 2) | (get(x - 4, y) << 3) |
        (get(x + 3, y - 1) << 4) |
        (get(x + 2, y - 1) << 5) | (get(x + 1, y - 1) << 6) | (get(x, y - 1) << 7) |
        (get(x - 1, y - 1) << 8) | (get(x - 2, y - 1) << 9) |
        (get(x - 3, y - 1) << 10) |
        (get(x + 2, y - 2) << 11) |
        (get(x + 1, y - 2) << 12) | (get(x, y - 2) << 13) | (get(x - 1, y - 2) << 14) |
        (get(x - 2, y - 2) << 15)
      enc.encode(get(x, y), cx[context]!)
    }
  }
}

function buildEmbeddedStream(width: number, height: number, mqData: Uint8Array): Uint8Array {
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  // Page information segment (type 48)
  pushU32(1); out.push(48, 0 /* referred */, 1 /* page 1 */)
  pushU32(19)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0)
  out.push(0 /* flags */, 0, 0 /* striping */)
  // Immediate generic region (type 38)
  const at = [3, -1, -3, -1, 2, -2, -2, -2]
  pushU32(2); out.push(38, 0, 1)
  pushU32(17 + 1 + 8 + mqData.length)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0)
  out.push(0 /* external comb op OR */)
  out.push(0 /* flags: arithmetic, template 0 */)
  for (const v of at) out.push(v & 0xFF)
  for (const b of mqData) out.push(b)
  return new Uint8Array(out)
}

// Builds a stream whose generic region declares the unknown-length sentinel
// (0xFFFFFFFF) and self-terminates with the arithmetic end marker 0xFF 0xAC
// followed by the row count (region height), per T.88 7.2.7.
function buildUnknownLengthStream(width: number, height: number, mqData: Uint8Array): Uint8Array {
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  pushU32(1); out.push(48, 0, 1); pushU32(19)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0, 0, 0)
  const at = [3, -1, -3, -1, 2, -2, -2, -2]
  pushU32(2); out.push(38, 0, 1)
  out.push(0xFF, 0xFF, 0xFF, 0xFF) // unknown data length sentinel
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0)
  out.push(0 /* flags: arithmetic, template 0 */)
  for (const v of at) out.push(v & 0xFF)
  for (const b of mqData) out.push(b)
  out.push(0xFF, 0xAC) // arithmetic end marker
  pushU32(height)      // row count = region height
  return new Uint8Array(out)
}

// Builds a striped page (unknown height sentinel 0xFFFFFFFF) composed of two
// generic-region stripes stacked vertically, terminated by an end-of-stripe
// segment (type 50) whose row number fixes the final page height (T.88 7.4.9).
function buildStripedStream(width: number, h1: number, h2: number, top: Uint8Array, bottom: Uint8Array): Uint8Array {
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  const at = [3, -1, -3, -1, 2, -2, -2, -2]
  const region = (segNum: number, y: number, h: number, mq: Uint8Array): void => {
    pushU32(segNum); out.push(38, 0, 1)
    pushU32(17 + 1 + 8 + mq.length)
    pushU32(width); pushU32(h); pushU32(0); pushU32(y); out.push(0)
    out.push(0 /* flags: arithmetic, template 0 */)
    for (const v of at) out.push(v & 0xFF)
    for (const b of mq) out.push(b)
  }
  // Page information (type 48) with unknown height.
  pushU32(1); out.push(48, 0, 1); pushU32(19)
  const maxStripeSize = Math.max(h1, h2)
  pushU32(width); pushU32(0xFFFFFFFF); pushU32(0); pushU32(0)
  out.push(0, 0x80 | ((maxStripeSize >> 8) & 0x7F), maxStripeSize & 0xFF)
  region(2, 0, h1, encodeGenericTemplate0(width, h1, top))
  region(3, h1, h2, encodeGenericTemplate0(width, h2, bottom))
  // End of stripe (type 50): row number = last row of the page.
  pushU32(4); out.push(50, 0, 1); pushU32(4); pushU32(h1 + h2 - 1)
  return new Uint8Array(out)
}

describe('JBIG2 decoder', () => {
  it('grows a striped page of unknown height across stripes (7.4.9)', () => {
    const width = 20, h1 = 7, h2 = 9
    const top = new Uint8Array(width * h1)
    const bottom = new Uint8Array(width * h2)
    for (let y = 0; y < h1; y++) for (let x = 0; x < width; x++) if ((x + y) % 3 === 0) top[y * width + x] = 1
    for (let y = 0; y < h2; y++) for (let x = 0; x < width; x++) if ((x * 2 + y) % 4 === 0) bottom[y * width + x] = 1
    const img = decodeJbig2(buildStripedStream(width, h1, h2, top, bottom))
    expect(img.width).toBe(width)
    expect(img.height).toBe(h1 + h2)
    const expected = new Uint8Array(width * (h1 + h2))
    expected.set(top, 0)
    expected.set(bottom, width * h1)
    expect(Array.from(img.pixels)).toEqual(Array.from(expected))
  })

  it('matches jbig2dec pixels for a striped page of initially unknown height', () => {
    const base64 = readFileSync(resolve(__dirname, '../fixtures/jbig2/striped-jbig2dec-oracle.jb2.base64'), 'utf8').trim()
    const page = decodeJbig2(new Uint8Array(Buffer.from(base64, 'base64')))
    const packed = new Uint8Array(3 * page.height)
    for (let y = 0; y < page.height; y++) for (let x = 0; x < page.width; x++) {
      packed[y * 3 + (x >> 3)]! |= page.pixels[y * page.width + x]! << (7 - (x & 7))
    }
    expect([page.width, page.height]).toEqual([20, 16])
    expect(Buffer.from(packed).toString('hex')).toBe(
      '924920249240492490924920249240492490924920aaaaa0000000555550000000aaaaa0000000555550000000aaaaa0',
    )
  })

  it('matches jbig2dec pixels when a text region selects a custom Huffman table', () => {
    const base64 = readFileSync(resolve(__dirname, '../fixtures/jbig2/custom-huffman-jbig2dec-oracle.jb2.base64'), 'utf8').trim()
    const page = decodeJbig2(new Uint8Array(Buffer.from(base64, 'base64')))
    const packed = new Uint8Array(page.height)
    for (let y = 0; y < page.height; y++) for (let x = 0; x < page.width; x++) {
      packed[y] |= page.pixels[y * page.width + x]! << (7 - x)
    }
    expect([page.width, page.height]).toEqual([6, 3])
    expect(Buffer.from(packed).toString('hex')).toBe('9c403c')
  })

  it('round trips a generic region through the spec MQ encoder', () => {
    const width = 37
    const height = 23
    const pixels = new Uint8Array(width * height)
    // Structured content: diagonal lines and a filled box
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((x + y) % 7 === 0 || (x >= 10 && x < 20 && y >= 8 && y < 14)) pixels[y * width + x] = 1
      }
    }
    const mq = encodeGenericTemplate0(width, height, pixels)
    const stream = buildEmbeddedStream(width, height, mq)
    const img = decodeJbig2(stream)
    expect(img.width).toBe(width)
    expect(img.height).toBe(height)
    expect(Array.from(img.pixels)).toEqual(Array.from(pixels))
  })

  it('decodes standalone sequential and random-access file organizations', () => {
    const width = 5, height = 3
    const pixels = new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1])
    const mq = encodeGenericTemplate0(width, height, pixels)
    const u32bytes = (value: number): number[] => [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF]
    const pageBody = [...u32bytes(width), ...u32bytes(height), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const genericBody = [
      ...u32bytes(width), ...u32bytes(height), 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 3, 0xFF, 0xFD, 0xFF, 2, 0xFE, 0xFE, 0xFE, ...mq,
    ]
    const header = (number: number, type: number, page: number, length: number): number[] => [
      ...u32bytes(number), type, 0, page, ...u32bytes(length),
    ]
    const signature = [0x97, 0x4A, 0x42, 0x32, 0x0D, 0x0A, 0x1A, 0x0A]
    const sequential = new Uint8Array([
      ...signature, 1, ...u32bytes(1),
      ...header(1, 48, 1, pageBody.length), ...pageBody,
      ...header(2, 38, 1, genericBody.length), ...genericBody,
      ...header(3, 51, 0, 0),
    ])
    const random = new Uint8Array([
      ...signature, 0, ...u32bytes(1),
      ...header(1, 48, 1, pageBody.length),
      ...header(2, 38, 1, genericBody.length),
      ...header(3, 51, 0, 0),
      ...pageBody, ...genericBody,
    ])

    expect(Array.from(decodeJbig2(sequential).pixels)).toEqual(Array.from(pixels))
    expect(Array.from(decodeJbig2(random).pixels)).toEqual(Array.from(pixels))
  })

  it('returns every standalone page through the multi-page API', () => {
    const u32 = (value: number): number[] => [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF]
    const page = (number: number, association: number, width: number): number[] => [
      ...u32(number), 48, 0, association, ...u32(19),
      ...u32(width), ...u32(1), ...u32(0), ...u32(0), 0, 0, 0,
    ]
    const stream = new Uint8Array([
      0x97, 0x4A, 0x42, 0x32, 0x0D, 0x0A, 0x1A, 0x0A, 1, ...u32(2),
      ...page(1, 1, 2), ...page(2, 2, 3), ...u32(3), 51, 0, 0, ...u32(0),
    ])
    const pages = decodeJbig2Pages(stream)
    expect(pages.map(pageImage => [pageImage.pageAssociation, pageImage.width, pageImage.height])).toEqual([[1, 2, 1], [2, 3, 1]])
    expect(() => decodeJbig2(stream)).toThrow(/single-page decoder received 2 pages/)
  })

  it('matches a jbig2enc/jbig2dec independent pixel oracle', () => {
    const base64 = readFileSync(resolve(__dirname, '../fixtures/jbig2/jbig2enc-symbol.jb2.base64'), 'utf8').trim()
    const page = decodeJbig2Pages(new Uint8Array(Buffer.from(base64, 'base64')))[0]!
    const packed: number[] = []
    for (let y = 0; y < page.height; y++) {
      for (let x = 0; x < page.width; x += 8) {
        let byte = 0
        for (let bit = 0; bit < 8; bit++) byte |= (page.pixels[y * page.width + x + bit] ?? 0) << (7 - bit)
        packed.push(byte)
      }
    }
    expect(page.width).toBe(24)
    expect(page.height).toBe(4)
    expect(Buffer.from(packed).toString('hex')).toBe('fff0fffff0fffff0fffff0ff')
  })

  it('matches the independent oracle for a generated multi-page file', () => {
    const base64 = readFileSync(resolve(__dirname, '../fixtures/jbig2/jbig2enc-multipage.jb2.base64'), 'utf8').trim()
    const pages = decodeJbig2Pages(new Uint8Array(Buffer.from(base64, 'base64')))
    const packedHex = pages.map(page => {
      const packed: number[] = []
      for (let y = 0; y < page.height; y++) for (let x = 0; x < page.width; x += 8) {
        let byte = 0
        for (let bit = 0; bit < 8; bit++) byte |= (page.pixels[y * page.width + x + bit] ?? 0) << (7 - bit)
        packed.push(byte)
      }
      return Buffer.from(packed).toString('hex')
    })
    expect(pages.map(page => [page.pageAssociation, page.width, page.height])).toEqual([[1, 24, 4], [2, 24, 4]])
    expect(packedHex).toEqual(['fff0fffff0fffff0fffff0ff', '0f0f0f0f0f0f0f0f0f0f0f0f'])
  })

  it.skipIf(!JBIG2DEC_AVAILABLE)('matches jbig2dec at runtime for every page of the fixed multi-page fixture', () => {
    const base64 = readFileSync(resolve(__dirname, '../fixtures/jbig2/jbig2enc-multipage.jb2.base64'), 'utf8').trim()
    const encoded = new Uint8Array(Buffer.from(base64, 'base64'))
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-jbig2dec-oracle-'))
    try {
      const input = join(directory, 'input.jb2')
      const output = join(directory, 'output.pbm')
      writeFileSync(input, encoded)
      execFileSync('jbig2dec', ['-o', output, input], { stdio: 'pipe' })
      const oracle = parseConcatenatedPbm(readFileSync(output))
      const actual = decodeJbig2Pages(encoded).map(function (page) {
        const rowBytes = Math.ceil(page.width / 8)
        const packed = new Uint8Array(rowBytes * page.height)
        for (let y = 0; y < page.height; y++) for (let x = 0; x < page.width; x++) {
          packed[y * rowBytes + (x >> 3)]! |= page.pixels[y * page.width + x]! << (7 - (x & 7))
        }
        return { width: page.width, height: page.height, data: packed }
      })
      expect(actual).toEqual(oracle)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('matches the normative T.88 Annex H multi-page example', () => {
    const base64 = readFileSync(resolve(__dirname, '../fixtures/jbig2/t88-annex-h.jb2.base64'), 'utf8').trim()
    const pages = decodeJbig2Pages(new Uint8Array(Buffer.from(base64, 'base64')))
    const hashes = pages.map(page => {
      const rowBytes = Math.ceil(page.width / 8)
      const packed = new Uint8Array(rowBytes * page.height)
      for (let y = 0; y < page.height; y++) for (let x = 0; x < page.width; x++) {
        packed[y * rowBytes + (x >> 3)]! |= page.pixels[y * page.width + x]! << (7 - (x & 7))
      }
      return createHash('sha256').update(packed).digest('hex')
    })
    expect(pages.map(page => [page.pageAssociation, page.width, page.height])).toEqual([
      [1, 64, 56], [2, 64, 56], [3, 37, 8],
    ])
    expect(hashes).toEqual([
      '975e63be32f6dd9c4367dd25ae268cd5701b888717656236c98c31ee8bb35db4',
      '975e63be32f6dd9c4367dd25ae268cd5701b888717656236c98c31ee8bb35db4',
      'b4808b8cad01a10e426a955fd02d4d3da6525fb2951681911a4ed91e37131276',
    ])
  })

  it('matches jbig2dec pixels when a page uses a separate JBIG2Globals stream', () => {
    const globalsBase64 = readFileSync(resolve(__dirname, '../fixtures/jbig2/jbig2enc-globals.sym.base64'), 'utf8').trim()
    const pageBase64 = readFileSync(resolve(__dirname, '../fixtures/jbig2/jbig2enc-globals-page.jb2.base64'), 'utf8').trim()
    const page = decodeJbig2(
      new Uint8Array(Buffer.from(pageBase64, 'base64')),
      new Uint8Array(Buffer.from(globalsBase64, 'base64')),
    )
    const packed = new Uint8Array(3 * page.height)
    for (let y = 0; y < page.height; y++) for (let x = 0; x < page.width; x++) {
      packed[y * 3 + (x >> 3)]! |= page.pixels[y * page.width + x]! << (7 - (x & 7))
    }
    expect([page.width, page.height]).toEqual([24, 8])
    expect(Buffer.from(packed).toString('hex')).toBe('000000000000f0f0f0909090909090f0f0f00f0f0f090909')
  })

  it('parses profiles and defined extension comments and rejects unknown necessary extensions', () => {
    const out: number[] = []
    const pushU32 = (value: number): void => out.push((value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF)
    pushU32(0); out.push(52, 0, 0); pushU32(8); pushU32(1); pushU32(0x00000001)
    pushU32(1); out.push(48, 0, 1); pushU32(19)
    pushU32(2); pushU32(2); pushU32(0); pushU32(0); out.push(0, 0, 0)
    const comment = [0x20, 0, 0, 0, ...Array.from('Title', char => char.charCodeAt(0)), 0, ...Array.from('Test', char => char.charCodeAt(0)), 0, 0]
    pushU32(2); out.push(62, 0, 1); pushU32(comment.length); out.push(...comment)
    const image = decodeJbig2(new Uint8Array(out))
    expect(image.profiles).toEqual([1])
    expect(image.comments).toEqual([{ pageAssociation: 1, segmentNumber: 2, values: { Title: 'Test' } }])

    const necessary = out.slice(0, out.length - comment.length)
    necessary.splice(necessary.length - 4, 4, 0, 0, 0, 4)
    necessary.push(0xA0, 0, 0, 1)
    expect(() => decodeJbig2(new Uint8Array(necessary))).toThrow(/unknown necessary extension type/)
  })

  it('honors deferred non-retain only for an attached extension chain', () => {
    const build = (deferred: boolean): Uint8Array => {
      const out: number[] = []
      const pushU32 = (value: number): void => out.push((value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF)
      pushU32(0); out.push(48, 0, 1); pushU32(19)
      pushU32(1); pushU32(1); pushU32(0); pushU32(0); out.push(0, 0, 0)
      pushU32(1); out.push(deferred ? 0x80 : 0, 0, 0); pushU32(10)
      out.push(0, 1); pushU32(0); pushU32(0)
      pushU32(2); out.push(62, 0x20, 1, 0); pushU32(5)
      out.push(0x20, 0, 0, 0, 0)
      return new Uint8Array(out)
    }

    expect(decodeJbig2(build(true)).comments).toHaveLength(1)
    expect(() => decodeJbig2(build(false))).toThrow(/refers to non-retained segment 1/)
  })

  it('round trips random noise (stresses every context path)', () => {
    const width = 32
    const height = 16
    const pixels = new Uint8Array(width * height)
    let seed = 12345
    for (let i = 0; i < pixels.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
      pixels[i] = (seed >> 16) & 1
    }
    const mq = encodeGenericTemplate0(width, height, pixels)
    const img = decodeJbig2(buildEmbeddedStream(width, height, mq))
    expect(Array.from(img.pixels)).toEqual(Array.from(pixels))
  })

  it('round trips an MMR (T.6) coded generic region', () => {
    const width = 24
    const height = 10
    const pixels = new Uint8Array(width * height)
    // A pattern with varied run lengths per row (all runs < 64 → terminating codes).
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (((x >> 2) + y) % 3 === 0 || (x >= 6 && x < 18 && y >= 3 && y < 7)) pixels[y * width + x] = 1
      }
    }
    const t6 = encodeT6(width, height, pixels)
    const img = decodeJbig2(buildMmrStream(width, height, t6))
    expect(img.width).toBe(width)
    expect(img.height).toBe(height)
    expect(Array.from(img.pixels)).toEqual(Array.from(pixels))
  })

  it('round trips an all-black and an all-white MMR region', () => {
    for (const fill of [0, 1]) {
      const width = 16, height = 5
      const pixels = new Uint8Array(width * height).fill(fill)
      const img = decodeJbig2(buildMmrStream(width, height, encodeT6(width, height, pixels)))
      expect(Array.from(img.pixels)).toEqual(Array.from(pixels))
    }
  })

  it('resolves an immediate generic region with unknown segment length (7.2.7)', () => {
    const width = 30
    const height = 18
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((x * 3 + y) % 5 === 0 || (x >= 8 && x < 22 && y >= 6 && y < 12)) pixels[y * width + x] = 1
      }
    }
    const mq = encodeGenericTemplate0(width, height, pixels)
    const img = decodeJbig2(buildUnknownLengthStream(width, height, mq))
    expect(img.width).toBe(width)
    expect(img.height).toBe(height)
    expect(Array.from(img.pixels)).toEqual(Array.from(pixels))
  })

  it('rejects unknown segment length on a non-generic-region segment', () => {
    const out: number[] = []
    const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
    pushU32(1); out.push(48, 0, 1); pushU32(19)
    pushU32(8); pushU32(8); pushU32(0); pushU32(0); out.push(0, 0, 0)
    // Symbol dictionary (type 0) with the unknown-length sentinel: not permitted.
    pushU32(2); out.push(0, 0, 1)
    out.push(0xFF, 0xFF, 0xFF, 0xFF)
    expect(() => decodeJbig2(new Uint8Array(out))).toThrow(/only permitted for an immediate generic region/)
  })

  it('rejects an unknown-length generic region with no terminator', () => {
    const width = 8, height = 4
    const mq = encodeGenericTemplate0(width, height, new Uint8Array(width * height))
    const out: number[] = []
    const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
    pushU32(1); out.push(48, 0, 1); pushU32(19)
    pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0, 0, 0)
    pushU32(2); out.push(38, 0, 1)
    out.push(0xFF, 0xFF, 0xFF, 0xFF)
    pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0)
    out.push(0)
    for (const v of [3, -1, -3, -1, 2, -2, -2, -2]) out.push(v & 0xFF)
    for (const b of mq) out.push(b) // no terminator appended
    expect(() => decodeJbig2(new Uint8Array(out))).toThrow(/terminator not found/)
  })

  it('accepts an empty Huffman symbol dictionary combined with refinement', () => {
    const out: number[] = []
    const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
    pushU32(1); out.push(48, 0, 1); pushU32(19)
    pushU32(8); pushU32(8); pushU32(0); pushU32(0); out.push(0, 0, 0)
    // Symbol dictionary with SDHUFF + SDREFAGG (refinement).
    pushU32(2); out.push(0, 0, 1); pushU32(2 + 4 + 8)
    out.push(0, 3)          // flags: SDHUFF (bit0) + refinement (bit1)
    out.push(0, 0, 0, 0)    // refinement AT pixels (refTemplate 0)
    pushU32(0); pushU32(0)  // exported / new counts
    const image = decodeJbig2(new Uint8Array(out))
    expect(image.width).toBe(8)
    expect(image.height).toBe(8)
  })

  it('retains and reuses arithmetic bitmap coding contexts between symbol dictionaries', () => {
    const out: number[] = []
    const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
    const pushDictionaryData = (flags: number): void => {
      out.push((flags >>> 8) & 0xFF, flags & 0xFF)
      out.push(0, 0, 0, 0, 0, 0, 0, 0) // template-0 adaptive pixels
      pushU32(0); pushU32(0) // exported / new symbols
    }

    pushU32(1); out.push(48, 0, 1); pushU32(19)
    pushU32(8); pushU32(8); pushU32(0); pushU32(0); out.push(0, 0, 0)
    pushU32(2); out.push(0, 1, 1); pushU32(18)
    pushDictionaryData(0x0200) // SDCTXRETAINED
    pushU32(3); out.push(0, 0x20, 2, 1); pushU32(18)
    pushDictionaryData(0x0100) // SDCTXUSED, referring to segment 2

    const image = decodeJbig2(new Uint8Array(out))
    expect(image.width).toBe(8)
    expect(image.height).toBe(8)
    expect(image.pixels.every(pixel => pixel === 0)).toBe(true)
  })

  it('applies retained generic bitmap contexts while decoding the next dictionary', () => {
    const genericContexts: { index: number, mps: number }[] = []
    for (let i = 0; i < 1 << 16; i++) genericContexts.push({ index: 0, mps: 0 })
    const encodeDictionary = (pixels: Uint8Array, hasInput: boolean): Uint8Array => {
      const encoder = new MqEncoder()
      const height = new TestArithIntContext()
      const width = new TestArithIntContext()
      const exported = new TestArithIntContext()
      encodeArithInt(encoder, height, 2)
      encodeArithInt(encoder, width, 2)
      encodeGenericTemplate0Into(encoder, genericContexts, 2, 2, pixels)
      encodeArithInt(encoder, width, null)
      encodeArithInt(encoder, exported, hasInput ? 1 : 0)
      encodeArithInt(encoder, exported, 1)
      return encoder.flush()
    }
    const first = encodeDictionary(new Uint8Array([1, 1, 0, 1]), false)
    const secondPixels = new Uint8Array([0, 1, 1, 0])
    const second = encodeDictionary(secondPixels, true)

    const textEncoder = new MqEncoder()
    const textDt = new TestArithIntContext()
    encodeArithInt(textEncoder, textDt, 0)
    encodeArithInt(textEncoder, textDt, 0)
    encodeArithInt(textEncoder, new TestArithIntContext(), 0)
    encodeArithInt(textEncoder, new TestArithIntContext(), null)
    const text = textEncoder.flush()

    const out: number[] = []
    const pushU32 = (value: number): void => out.push((value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF)
    const appendDictionaryBody = (flags: number, encoded: Uint8Array): void => {
      out.push((flags >>> 8) & 0xFF, flags & 0xFF)
      out.push(3, 0xFF, 0xFD, 0xFF, 2, 0xFE, 0xFE, 0xFE)
      pushU32(1); pushU32(1)
      for (const byte of encoded) out.push(byte)
    }
    pushU32(1); out.push(48, 0, 1); pushU32(19)
    pushU32(2); pushU32(2); pushU32(0); pushU32(0); out.push(0, 0, 0)
    pushU32(2); out.push(0, 1, 1); pushU32(18 + first.length)
    appendDictionaryBody(0x0200, first)
    pushU32(3); out.push(0, 0x21, 2, 1); pushU32(18 + second.length)
    appendDictionaryBody(0x0100, second)
    pushU32(4); out.push(6, 0x20, 3, 1); pushU32(23 + text.length)
    pushU32(2); pushU32(2); pushU32(0); pushU32(0); out.push(0)
    out.push(0, 0x10); pushU32(1)
    for (const byte of text) out.push(byte)

    expect(Array.from(decodeJbig2(new Uint8Array(out)).pixels)).toEqual(Array.from(secondPixels))
  })

  it('rejects SDCTXUSED without a referred retained context', () => {
    const out: number[] = []
    const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
    pushU32(1); out.push(48, 0, 1); pushU32(19)
    pushU32(8); pushU32(8); pushU32(0); pushU32(0); out.push(0, 0, 0)
    pushU32(2); out.push(0, 0, 1); pushU32(18)
    out.push(1, 0) // SDCTXUSED
    out.push(0, 0, 0, 0, 0, 0, 0, 0)
    pushU32(0); pushU32(0)

    expect(() => decodeJbig2(new Uint8Array(out))).toThrow(/SDCTXUSED without a retained context on the last referred symbol dictionary/)
  })

  it('decodes a refinement aggregate containing multiple symbol instances', () => {
    const genericContexts: { index: number, mps: number }[] = []
    for (let i = 0; i < 1 << 16; i++) genericContexts.push({ index: 0, mps: 0 })
    const baseEncoder = new MqEncoder()
    const baseHeight = new TestArithIntContext()
    const baseWidth = new TestArithIntContext()
    const baseExport = new TestArithIntContext()
    encodeArithInt(baseEncoder, baseHeight, 2)
    encodeArithInt(baseEncoder, baseWidth, 2)
    encodeGenericTemplate0Into(baseEncoder, genericContexts, 2, 2, new Uint8Array([1, 0, 0, 1]))
    encodeArithInt(baseEncoder, baseWidth, null)
    encodeArithInt(baseEncoder, baseExport, 0)
    encodeArithInt(baseEncoder, baseExport, 1)
    const baseDictionaryData = baseEncoder.flush()

    const iaidContexts: { index: number, mps: number }[] = []
    for (let i = 0; i < 4; i++) iaidContexts.push({ index: 0, mps: 0 })
    const dictionaryEncoder = new MqEncoder()
    const iadh = new TestArithIntContext()
    const iadw = new TestArithIntContext()
    const iaai = new TestArithIntContext()
    const iaex = new TestArithIntContext()
    encodeArithInt(dictionaryEncoder, iadh, 2)
    encodeArithInt(dictionaryEncoder, iadw, 4)
    encodeArithInt(dictionaryEncoder, iaai, 2)
    const iadt = new TestArithIntContext()
    const iafs = new TestArithIntContext()
    const iads = new TestArithIntContext()
    const iari = new TestArithIntContext()
    encodeArithInt(dictionaryEncoder, iadt, 0)
    encodeArithInt(dictionaryEncoder, iadt, 0)
    encodeArithInt(dictionaryEncoder, iafs, 0)
    encodeIaid(dictionaryEncoder, iaidContexts, 1, 0)
    encodeArithInt(dictionaryEncoder, iari, 0)
    encodeArithInt(dictionaryEncoder, iads, 1)
    encodeIaid(dictionaryEncoder, iaidContexts, 1, 0)
    encodeArithInt(dictionaryEncoder, iari, 0)
    encodeArithInt(dictionaryEncoder, iads, null)
    encodeArithInt(dictionaryEncoder, iadw, null)
    encodeArithInt(dictionaryEncoder, iaex, 1)
    encodeArithInt(dictionaryEncoder, iaex, 1)
    const dictionaryData = dictionaryEncoder.flush()
    const integerProbe = new MqDecoder(dictionaryData, 0, dictionaryData.length)
    expect(decodeTestArithInt(integerProbe, new TestArithIntContext())).toBe(2)
    expect(decodeTestArithInt(integerProbe, new TestArithIntContext())).toBe(4)
    expect(decodeTestArithInt(integerProbe, new TestArithIntContext())).toBe(2)

    const textEncoder = new MqEncoder()
    const textIadt = new TestArithIntContext()
    encodeArithInt(textEncoder, textIadt, 0)
    encodeArithInt(textEncoder, textIadt, 0)
    encodeArithInt(textEncoder, new TestArithIntContext(), 0)
    encodeArithInt(textEncoder, new TestArithIntContext(), null)
    const textData = textEncoder.flush()

    const out: number[] = []
    const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
    pushU32(1); out.push(48, 0, 1); pushU32(19)
    pushU32(4); pushU32(2); pushU32(0); pushU32(0); out.push(0, 0, 0)
    pushU32(2); out.push(0, 1, 1); pushU32(2 + 8 + 4 + 4 + baseDictionaryData.length)
    out.push(0, 0)
    out.push(3, 0xFF, 0xFD, 0xFF, 2, 0xFE, 0xFE, 0xFE)
    pushU32(1); pushU32(1)
    for (const byte of baseDictionaryData) out.push(byte)
    pushU32(3); out.push(0, 0x21, 2, 1); pushU32(2 + 8 + 4 + 4 + dictionaryData.length)
    out.push(0x10, 0x02) // SDREFAGG, SDRTEMPLATE=1, arithmetic template 0
    out.push(3, 0xFF, 0xFD, 0xFF, 2, 0xFE, 0xFE, 0xFE)
    pushU32(1); pushU32(1)
    for (const byte of dictionaryData) out.push(byte)
    pushU32(4); out.push(6, 0x20, 3, 1)
    pushU32(17 + 2 + 4 + textData.length)
    pushU32(4); pushU32(2); pushU32(0); pushU32(0); out.push(0)
    out.push(0, 0x10) // arithmetic, no refinement, top-left reference corner
    pushU32(1)
    for (const byte of textData) out.push(byte)

    expect(Array.from(decodeJbig2(new Uint8Array(out)).pixels)).toEqual([1, 0, 1, 0, 0, 1, 0, 1])
  })
})

function parseConcatenatedPbm(bytes: Uint8Array): Array<{ width: number, height: number, data: Uint8Array }> {
  const images: Array<{ width: number, height: number, data: Uint8Array }> = []
  let position = 0
  while (position < bytes.length) {
    if (bytes[position] !== 0x50 || bytes[position + 1] !== 0x34 || bytes[position + 2] !== 0x0A) {
      throw new Error('jbig2dec oracle produced an invalid binary PBM header')
    }
    position += 3
    const lineEnd = bytes.indexOf(0x0A, position)
    if (lineEnd < 0) throw new Error('jbig2dec oracle produced a truncated PBM size')
    const dimensions = new TextDecoder().decode(bytes.subarray(position, lineEnd)).split(' ').map(Number)
    if (dimensions.length !== 2 || !Number.isInteger(dimensions[0]) || !Number.isInteger(dimensions[1])) {
      throw new Error('jbig2dec oracle produced invalid PBM dimensions')
    }
    const width = dimensions[0]!
    const height = dimensions[1]!
    position = lineEnd + 1
    const length = Math.ceil(width / 8) * height
    if (position + length > bytes.length) throw new Error('jbig2dec oracle produced truncated PBM pixels')
    images.push({ width, height, data: Uint8Array.from(bytes.subarray(position, position + length)) })
    position += length
  }
  return images
}

// ─── Test-only T.6 (CCITT Group 4) encoder ───
// Encodes with horizontal modes only (self-contained, no reference-line
// dependency): every row is a sequence of (white-run, black-run) pairs. Runs
// must be < 64 so only terminating codes are needed.

const T6_WHITE = ['00110101', '000111', '0111', '1000', '1011', '1100', '1110', '1111', '10011', '10100', '00111', '01000', '001000', '000011', '110100', '110101', '101010', '101011', '0100111', '0001100', '0001000', '0010111', '0000011', '0000100', '0101000', '0101011', '0010011', '0100100', '0011000', '00000010', '00000011', '00011010', '00011011', '00010010', '00010011', '00010100', '00010101', '00010110', '00010111', '00101000', '00101001', '00101010', '00101011', '00101100', '00101101', '00000100', '00000101', '00001010', '00001011', '01010010', '01010011', '01010100', '01010101', '00100100', '00100101', '01011000', '01011001', '01011010', '01011011', '01001010', '01001011', '00110010', '00110011', '00110100']
const T6_BLACK = ['0000110111', '010', '11', '10', '011', '0011', '0010', '00011', '000101', '000100', '0000100', '0000101', '0000111', '00000100', '00000111', '000011000', '0000010111', '0000011000', '0000001000', '00001100111', '00001101000', '00001101100', '00000110111', '00000101000', '00000010111', '00000011000', '000011001010', '000011001011', '000011001100', '000011001101', '000001101000', '000001101001', '000001101010', '000001101011', '000011010010', '000011010011', '000011010100', '000011010101', '000011010110', '000011010111', '000001101100', '000001101101', '000011011010', '000011011011', '000001010100', '000001010101', '000001010110', '000001010111', '000001100100', '000001100101', '000001010010', '000001010011', '000000100100', '000000110111', '000000111000', '000000100111', '000000101000', '000001011000', '000001011001', '000000101011', '000000101100', '000001011010', '000001100110', '000001100111']

function encodeT6(width: number, height: number, pixels: Uint8Array): Uint8Array {
  let bits = ''
  for (let y = 0; y < height; y++) {
    // Collect runs starting with white (a leading black pixel → white run 0).
    const runs: number[] = []
    let color = 0, count = 0
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x]!
      if (v === color) { count++ } else { runs.push(count); color = v; count = 1 }
    }
    runs.push(count)
    // runs[0] is a white run; pad to an even number of runs (last black run 0).
    if (runs.length % 2 === 1) runs.push(0)
    for (let i = 0; i < runs.length; i += 2) {
      const w = runs[i]!, b = runs[i + 1]!
      if (w >= 64 || b >= 64) throw new Error('test T.6 encoder: run >= 64')
      bits += '001' + T6_WHITE[w]! + T6_BLACK[b]!  // horizontal mode
    }
  }
  while (bits.length % 8 !== 0) bits += '0'
  const bytes = new Uint8Array(bits.length / 8)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.substr(i * 8, 8), 2)
  return bytes
}

function buildMmrStream(width: number, height: number, t6: Uint8Array): Uint8Array {
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  // Page information segment (type 48)
  pushU32(1); out.push(48, 0, 1); pushU32(19)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0, 0, 0)
  // Immediate generic region (type 38), MMR-coded (flags bit 0 = 1, no AT pixels)
  pushU32(2); out.push(38, 0, 1)
  pushU32(17 + 1 + t6.length)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0 /* comb op */)
  out.push(1 /* flags: MMR */)
  for (const b of t6) out.push(b)
  return new Uint8Array(out)
}

describe('PDF /JBIG2Decode integration', () => {
  it('imports a JBIG2 image XObject through the page importer', async () => {
    const { PdfImporter } = await import('../../src/index.js')
    const { decodePng } = await import('../../src/image/png-parser.js')
    const width = 24
    const height = 16
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x % 5 === 0 || y === 8) pixels[y * width + x] = 1
      }
    }
    const stream = buildEmbeddedStream(width, height, encodeGenericTemplate0(width, height, pixels))
    const binary = Array.from(stream, b => String.fromCharCode(b)).join('')
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
      '4 0 obj\n<< /Length 30 >>\nstream\nq 48 0 0 32 10 10 cm /Im0 Do Q\nendstream\nendobj\n',
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /JBIG2Decode /Length ${binary.length} >>\nstream\n${binary}\nendstream\nendobj\n`,
    ]
    let offset = '%PDF-1.7\n'.length
    const offsets: number[] = [0]
    let body = ''
    for (const object of objects) {
      offsets.push(offset)
      body += object
      offset += object.length
    }
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
    const pdfText = `%PDF-1.7\n${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
    const pdf = new Uint8Array(pdfText.length)
    for (let i = 0; i < pdfText.length; i++) pdf[i] = pdfText.charCodeAt(i) & 0xFF

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    // Black where the JBIG2 pixel is 1
    expect(decoded.pixels[0]).toBe(0)          // (0,0) on the x%5 line
    expect(decoded.pixels[4 * 1]).toBe(255)    // (1,0) white
    expect(decoded.pixels[(8 * width + 3) * 4]).toBe(0) // y==8 line
  }, 20000)
})

// ─── Pattern dictionary + halftone region round trip ───

// Generic-region encoder (template 0) with parameterized AT pixels, sharing one
// MQ coder + context array across a sequence of planes — matching the decoder's
// grayscale bitplane decoding, which reuses the coder state across planes.
function encodeGenericPlanes(
  width: number, height: number, planes: Uint8Array[], at: Array<{ x: number, y: number }>,
): Uint8Array {
  const enc = new MqEncoder()
  const cx: { index: number, mps: number }[] = []
  for (let i = 0; i < 1 << 16; i++) cx.push({ index: 0, mps: 0 })
  for (const pixels of planes) {
    const get = (x: number, y: number): number =>
      x < 0 || x >= width || y < 0 || y >= height ? 0 : pixels[y * width + x]!
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const context =
          (get(x - 1, y) << 0) | (get(x - 2, y) << 1) | (get(x - 3, y) << 2) | (get(x - 4, y) << 3) |
          (get(x + at[0]!.x, y + at[0]!.y) << 4) |
          (get(x + 2, y - 1) << 5) | (get(x + 1, y - 1) << 6) | (get(x, y - 1) << 7) |
          (get(x - 1, y - 1) << 8) | (get(x - 2, y - 1) << 9) |
          (get(x + at[1]!.x, y + at[1]!.y) << 10) |
          (get(x + at[2]!.x, y + at[2]!.y) << 11) |
          (get(x + 1, y - 2) << 12) | (get(x, y - 2) << 13) | (get(x - 1, y - 2) << 14) |
          (get(x + at[3]!.x, y + at[3]!.y) << 15)
        enc.encode(get(x, y), cx[context]!)
      }
    }
  }
  return enc.flush()
}

describe('JBIG2 pattern dictionary + halftone region', () => {
  it('round trips a halftone region using an arithmetic pattern dictionary', () => {
    const hpw = 4, hph = 4, grayMax = 3
    // Four 4x4 patterns: blank, checker, stripes, solid.
    const patterns: Uint8Array[] = [
      new Uint8Array(16),
      Uint8Array.from({ length: 16 }, (_, i) => ((i + (i >> 2)) & 1)),
      Uint8Array.from({ length: 16 }, (_, i) => ((i >> 2) & 1)),
      new Uint8Array(16).fill(1),
    ]
    // Collective bitmap: patterns concatenated horizontally → (grayMax+1)*hpw wide.
    const cw = (grayMax + 1) * hpw
    const collective = new Uint8Array(cw * hph)
    for (let m = 0; m <= grayMax; m++) {
      for (let y = 0; y < hph; y++) for (let x = 0; x < hpw; x++) collective[y * cw + (m * hpw + x)] = patterns[m]![y * hpw + x]!
    }
    const patternAt = [{ x: -hpw, y: 0 }, { x: -3, y: -1 }, { x: 2, y: -2 }, { x: -2, y: -2 }]
    const collectiveData = encodeGenericPlanes(cw, hph, [collective], patternAt)

    // Grayscale image: 3 columns × 2 rows selecting pattern indices.
    const hgw = 3, hgh = 2, bpp = 2
    const grid = [0, 1, 2, 3, 2, 1] // row-major (m*hgw + n)
    // Encode as Gray-coded raw planes (MSB first): rawP[bpp-1]=bit; rawP[j]=bit^bitHigher.
    const rawPlanes: Uint8Array[] = []
    for (let j = bpp - 1; j >= 0; j--) {
      const plane = new Uint8Array(hgw * hgh)
      for (let i = 0; i < hgw * hgh; i++) {
        const trueBit = (grid[i]! >> j) & 1
        const higher = j === bpp - 1 ? 0 : (grid[i]! >> (j + 1)) & 1
        plane[i] = trueBit ^ higher
      }
      rawPlanes.push(plane)
    }
    const halftoneAt = [{ x: 3, y: -1 }, { x: -3, y: -1 }, { x: 2, y: -2 }, { x: -2, y: -2 }]
    const grayData = encodeGenericPlanes(hgw, hgh, rawPlanes, halftoneAt)

    const pageW = hgw * hpw, pageH = hgh * hph
    const stream = buildHalftoneStream(pageW, pageH, hpw, hph, grayMax, collectiveData, hgw, hgh, grayData)
    const img = decodeJbig2(stream)

    // Expected: place each selected pattern at (n*hpw, m*hph), OR-composited.
    const expected = new Uint8Array(pageW * pageH)
    for (let m = 0; m < hgh; m++) {
      for (let n = 0; n < hgw; n++) {
        const pat = patterns[grid[m * hgw + n]!]!
        for (let y = 0; y < hph; y++) for (let x = 0; x < hpw; x++) {
          expected[(m * hph + y) * pageW + (n * hpw + x)] |= pat[y * hpw + x]!
        }
      }
    }
    expect(img.width).toBe(pageW)
    expect(img.height).toBe(pageH)
    expect(Array.from(img.pixels)).toEqual(Array.from(expected))
  })

  it('round trips a halftone region with an MMR-coded grayscale image (Annex C.5)', () => {
    const hpw = 4, hph = 4, grayMax = 3
    const patterns: Uint8Array[] = [
      new Uint8Array(16),
      Uint8Array.from({ length: 16 }, (_, i) => ((i + (i >> 2)) & 1)),
      Uint8Array.from({ length: 16 }, (_, i) => ((i >> 2) & 1)),
      new Uint8Array(16).fill(1),
    ]
    const cw = (grayMax + 1) * hpw
    const collective = new Uint8Array(cw * hph)
    for (let m = 0; m <= grayMax; m++) {
      for (let y = 0; y < hph; y++) for (let x = 0; x < hpw; x++) collective[y * cw + (m * hpw + x)] = patterns[m]![y * hpw + x]!
    }
    // Pattern dictionary is MMR-coded (single T.6 block).
    const collectiveData = encodeT6(cw, hph, collective)

    const hgw = 3, hgh = 2, bpp = 2
    const grid = [1, 3, 0, 2, 3, 1]
    // Gray-coded raw bitplanes, MSB first (same convention as the arithmetic case).
    const rawPlanes: Uint8Array[] = []
    for (let j = bpp - 1; j >= 0; j--) {
      const plane = new Uint8Array(hgw * hgh)
      for (let i = 0; i < hgw * hgh; i++) {
        const trueBit = (grid[i]! >> j) & 1
        const higher = j === bpp - 1 ? 0 : (grid[i]! >> (j + 1)) & 1
        plane[i] = trueBit ^ higher
      }
      rawPlanes.push(plane)
    }
    const grayData = encodeMmrGrayscalePlanes(hgw, hgh, rawPlanes)

    const pageW = hgw * hpw, pageH = hgh * hph
    const stream = buildMmrHalftoneStream(pageW, pageH, hpw, hph, grayMax, collectiveData, hgw, hgh, grayData)
    const img = decodeJbig2(stream)

    const expected = new Uint8Array(pageW * pageH)
    for (let m = 0; m < hgh; m++) {
      for (let n = 0; n < hgw; n++) {
        const pat = patterns[grid[m * hgw + n]!]!
        for (let y = 0; y < hph; y++) for (let x = 0; x < hpw; x++) {
          expected[(m * hph + y) * pageW + (n * hpw + x)] |= pat[y * hpw + x]!
        }
      }
    }
    expect(img.width).toBe(pageW)
    expect(img.height).toBe(pageH)
    expect(Array.from(img.pixels)).toEqual(Array.from(expected))
  })
})

// MMR grayscale plane encoder (T.88 Annex C.5): each bitplane is a T.6 block of
// horizontal-mode rows terminated by EOFB and padded to a byte boundary.
function encodeMmrGrayscalePlanes(width: number, height: number, planes: Uint8Array[]): Uint8Array {
  const EOL = '000000000001'
  let bits = ''
  for (const pixels of planes) {
    for (let y = 0; y < height; y++) {
      const runs: number[] = []
      let color = 0, count = 0
      for (let x = 0; x < width; x++) {
        const v = pixels[y * width + x]!
        if (v === color) { count++ } else { runs.push(count); color = v; count = 1 }
      }
      runs.push(count)
      if (runs.length % 2 === 1) runs.push(0)
      for (let i = 0; i < runs.length; i += 2) {
        const w = runs[i]!, b = runs[i + 1]!
        if (w >= 64 || b >= 64) throw new Error('test MMR encoder: run >= 64')
        bits += '001' + T6_WHITE[w]! + T6_BLACK[b]!
      }
    }
    bits += EOL + EOL
    while (bits.length % 8 !== 0) bits += '0'
  }
  while (bits.length % 8 !== 0) bits += '0'
  const bytes = new Uint8Array(bits.length / 8)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.substr(i * 8, 8), 2)
  return bytes
}

function buildMmrHalftoneStream(
  pageW: number, pageH: number, hpw: number, hph: number, grayMax: number,
  collective: Uint8Array, hgw: number, hgh: number, gray: Uint8Array,
): Uint8Array {
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  const pushU16 = (v: number): void => { out.push((v >>> 8) & 0xFF, v & 0xFF) }
  pushU32(1); out.push(48, 0, 1); pushU32(19)
  pushU32(pageW); pushU32(pageH); pushU32(0); pushU32(0); out.push(0, 0, 0)
  // Pattern dictionary (type 16, number 2), MMR-coded (flags bit 0 = 1).
  pushU32(2); out.push(16, 1, 1)
  pushU32(1 + 1 + 1 + 4 + collective.length)
  out.push(1 /* flags: MMR */, hpw, hph); pushU32(grayMax)
  for (const b of collective) out.push(b)
  // Halftone region (type 23, number 3), MMR-coded grayscale (flags bit 0 = 1).
  pushU32(3); out.push(23, 0x20, 2, 1)
  pushU32(17 + 1 + 4 + 4 + 4 + 4 + 2 + 2 + gray.length)
  pushU32(pageW); pushU32(pageH); pushU32(0); pushU32(0); out.push(0 /* comb op */)
  out.push(1 /* flags: MMR, combOp OR, defpixel 0 */)
  pushU32(hgw); pushU32(hgh); pushU32(0); pushU32(0)
  pushU16(hpw * 256); pushU16(0)
  for (const b of gray) out.push(b)
  return new Uint8Array(out)
}

function buildHalftoneStream(
  pageW: number, pageH: number, hpw: number, hph: number, grayMax: number,
  collective: Uint8Array, hgw: number, hgh: number, gray: Uint8Array,
): Uint8Array {
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  const pushU16 = (v: number): void => { out.push((v >>> 8) & 0xFF, v & 0xFF) }
  // Page info (type 48)
  pushU32(1); out.push(48, 0, 1); pushU32(19)
  pushU32(pageW); pushU32(pageH); pushU32(0); pushU32(0); out.push(0, 0, 0)
  // Pattern dictionary (type 16, number 2)
  pushU32(2); out.push(16, 1, 1)
  pushU32(1 + 1 + 1 + 4 + collective.length)
  out.push(0 /* flags: arithmetic, template 0 */, hpw, hph); pushU32(grayMax)
  for (const b of collective) out.push(b)
  // Halftone region (type 23, number 3, refers to segment 2)
  pushU32(3); out.push(23, 0x20 /* 1 referred */, 2 /* referred seg 2 */, 1 /* page */)
  pushU32(17 + 1 + 4 + 4 + 4 + 4 + 2 + 2 + gray.length)
  pushU32(pageW); pushU32(pageH); pushU32(0); pushU32(0); out.push(0 /* comb op */)
  out.push(0 /* flags: arithmetic, template 0, no skip, combOp OR, defpixel 0 */)
  pushU32(hgw); pushU32(hgh); pushU32(0); pushU32(0) /* HGX HGY */
  pushU16(hpw * 256); pushU16(0) /* HRX HRY */
  for (const b of gray) out.push(b)
  return new Uint8Array(out)
}

// ─── Generic refinement region round trip ───

// Refinement encoder (template 1, TPGRON off) matching the decoder's context
// model: the output-so-far and the reference bitmap drive the 10-bit context.
function encodeRefinementTemplate1(width: number, height: number, target: Uint8Array, reference: Uint8Array): Uint8Array {
  const enc = new MqEncoder()
  const cx: { index: number, mps: number }[] = []
  for (let i = 0; i < 1 << 13; i++) cx.push({ index: 0, mps: 0 })
  const g = (x: number, y: number): number => x < 0 || x >= width || y < 0 || y >= height ? 0 : target[y * width + x]!
  const r = (x: number, y: number): number => x < 0 || x >= width || y < 0 || y >= height ? 0 : reference[y * width + x]!
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const context =
        (g(x - 1, y) << 0) |
        (g(x + 1, y - 1) << 1) | (g(x, y - 1) << 2) | (g(x - 1, y - 1) << 3) |
        (r(x + 1, y + 1) << 4) | (r(x, y + 1) << 5) |
        (r(x + 1, y) << 6) | (r(x, y) << 7) | (r(x - 1, y) << 8) |
        (r(x, y - 1) << 9)
      enc.encode(g(x, y), cx[context]!)
    }
  }
  return enc.flush()
}

describe('JBIG2 generic refinement region', () => {
  it('refines the page content in place (immediate refinement region)', () => {
    const width = 20, height = 12
    // Initial page content (the refinement reference).
    const reference = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if ((x + y) % 4 === 0 || (x >= 5 && x < 12 && y >= 3 && y < 8)) reference[y * width + x] = 1
    }
    // Refined target: flip a handful of pixels relative to the reference.
    const target = reference.slice()
    for (const [x, y] of [[2, 2], [7, 5], [15, 9], [0, 0], [11, 7]] as const) {
      target[y * width + x] = 1 - target[y * width + x]!
    }

    const genData = encodeGenericTemplate0(width, height, reference)
    const refData = encodeRefinementTemplate1(width, height, target, reference)
    const img = decodeJbig2(buildRefinementStream(width, height, genData, refData))
    expect(Array.from(img.pixels)).toEqual(Array.from(target))
  })

  it('refines a stored intermediate region referenced by a refinement region', () => {
    const width = 18, height = 10
    const reference = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if ((x + 2 * y) % 5 === 0 || (x >= 4 && x < 13 && y >= 2 && y < 7)) reference[y * width + x] = 1
    }
    const target = reference.slice()
    for (const [x, y] of [[1, 1], [8, 4], [16, 8], [0, 9], [12, 6]] as const) {
      target[y * width + x] = 1 - target[y * width + x]!
    }
    const genData = encodeGenericTemplate0(width, height, reference)
    const refData = encodeRefinementTemplate1(width, height, target, reference)
    const img = decodeJbig2(buildIntermediateRefinementStream(width, height, genData, refData))
    expect(Array.from(img.pixels)).toEqual(Array.from(target))
  })
})

// An intermediate generic region (type 36) is stored, not painted; a later
// immediate refinement region (type 43) that refers to it uses it as the
// refinement reference and paints the refined result onto the page.
function buildIntermediateRefinementStream(width: number, height: number, gen: Uint8Array, ref: Uint8Array): Uint8Array {
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  pushU32(1); out.push(48, 0, 1); pushU32(19)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0, 0, 0)
  // Intermediate generic region (type 36, number 2) — stored as the reference.
  const at = [3, -1, -3, -1, 2, -2, -2, -2]
  pushU32(2); out.push(36, 1, 1); pushU32(17 + 1 + 8 + gen.length)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0)
  out.push(0 /* flags: arithmetic template 0 */)
  for (const v of at) out.push(v & 0xFF)
  for (const b of gen) out.push(b)
  // Immediate generic refinement region (type 43, number 3) referring to seg 2.
  pushU32(3); out.push(43, 0x20 /* 1 referred */, 2 /* referred seg 2 */, 1 /* page */)
  pushU32(17 + 1 + ref.length)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0)
  out.push(1 /* flags: GRTEMPLATE=1, TPGRON=0 */)
  for (const b of ref) out.push(b)
  return new Uint8Array(out)
}

function buildRefinementStream(width: number, height: number, gen: Uint8Array, ref: Uint8Array): Uint8Array {
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  // Page info (type 48)
  pushU32(1); out.push(48, 0, 1); pushU32(19)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0, 0, 0)
  // Immediate generic region (type 38, number 2) — the initial page content.
  const at = [3, -1, -3, -1, 2, -2, -2, -2]
  pushU32(2); out.push(38, 0, 1); pushU32(17 + 1 + 8 + gen.length)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0)
  out.push(0 /* flags: arithmetic template 0 */)
  for (const v of at) out.push(v & 0xFF)
  for (const b of gen) out.push(b)
  // Immediate generic refinement region (type 43, number 3), template 1, TPGRON off.
  pushU32(3); out.push(43, 0, 1); pushU32(17 + 1 + ref.length)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0); out.push(0)
  out.push(1 /* flags: GRTEMPLATE=1, TPGRON=0 */)
  for (const b of ref) out.push(b)
  return new Uint8Array(out)
}

// ─── Huffman table infrastructure (Annex B) ───

import { getStandardTable, decodeTablesSegment, Jbig2Reader } from '../../src/compression/jbig2-decoder.js'

function bitsToBytes(bits: string): Uint8Array {
  const padded = bits + '0'.repeat((8 - (bits.length % 8)) % 8)
  const bytes = new Uint8Array(padded.length / 8)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(padded.substr(i * 8, 8), 2)
  return bytes
}
function bin(v: number, n: number): string { return n === 0 ? '' : (v >>> 0).toString(2).padStart(n, '0') }

describe('JBIG2 Huffman tables (Annex B)', () => {
  it('decodes values through standard table B.1', () => {
    // B.1: "0"+4bits → [0,15]; "10"+8bits → [16,271]; "110"+16bits → [272,65807].
    const bits = '0' + bin(5, 4) + '10' + bin(200 - 16, 8) + '110' + bin(300 - 272, 16)
    const table = getStandardTable(1)
    const reader = new Jbig2Reader(bitsToBytes(bits), 0, bitsToBytes(bits).length)
    expect(table.decode(reader)).toBe(5)
    expect(table.decode(reader)).toBe(200)
    expect(table.decode(reader)).toBe(300)
  })

  it('decodes the OOB line of standard table B.2', () => {
    // B.2 line "10"+0bits → value 1; OOB is the 6-bit code 0x3f = "111111".
    const bits = '10' + '111111'
    const table = getStandardTable(2)
    const data = bitsToBytes(bits)
    const reader = new Jbig2Reader(data, 0, data.length)
    expect(table.decode(reader)).toBe(1)
    expect(table.decode(reader)).toBeNull() // OOB
  })

  it('all standard tables B.1-B.15 build without error', () => {
    for (let n = 1; n <= 15; n++) expect(() => getStandardTable(n)).not.toThrow()
    expect(() => getStandardTable(16)).toThrow(/does not exist/)
  })

  it('parses and decodes a custom Huffman code table (segment type 53)', () => {
    // flags: OOB=0, prefixSizeBits=3 (bits1-3=2), rangeSizeBits=3 (bits4-6=2).
    const flags = (2 << 1) | (2 << 4)
    // lowest=0, highest=8 (u32 BE), then line prefix/range length pairs.
    const readerBits =
      bin(1, 3) + bin(2, 3) + // line [0,1,2]  → currentRangeLow 4
      bin(2, 3) + bin(2, 3) + // line [4,2,2]  → currentRangeLow 8 (stop)
      bin(3, 3) +             // lower-range prefix length
      bin(3, 3)               // upper-range prefix length
    const body = new Uint8Array([flags, 0, 0, 0, 0, 0, 0, 0, 8, ...bitsToBytes(readerBits)])
    const table = decodeTablesSegment(body, 0, body.length)
    // Canonical codes: "0"+2bits → [0,3]; "10"+2bits → [4,7].
    const valBits = '0' + bin(2, 2) + '10' + bin(5 - 4, 2)
    const data = bitsToBytes(valBits)
    const reader = new Jbig2Reader(data, 0, data.length)
    expect(table.decode(reader)).toBe(2)
    expect(table.decode(reader)).toBe(5)
  })
})

// ─── Huffman symbol dictionary + text region round trip ───

// Minimal generic Huffman encoder driven by the standard-table line data
// (same as the decoder's STANDARD_TABLE_DATA): find the line covering a value
// and emit its prefix code + range bits. OOB is the two-element line.
type HLine = number[]
const HB1: HLine[] = [[0, 1, 4, 0x0], [16, 2, 8, 0x2], [272, 3, 16, 0x6], [65808, 3, 32, 0x7]]
const HB2: HLine[] = [[0, 1, 0, 0x0], [1, 2, 0, 0x2], [2, 3, 0, 0x6], [3, 4, 3, 0xe], [11, 5, 6, 0x1e], [75, 6, 32, 0x3e], [6, 0x3f]]
const HB4: HLine[] = [[1, 1, 0, 0x0], [2, 2, 0, 0x2], [3, 3, 0, 0x6], [4, 4, 3, 0xe], [12, 5, 6, 0x1e], [76, 5, 32, 0x1f]]
const HB6: HLine[] = [[-2048, 5, 10, 0x1c], [-1024, 4, 9, 0x8], [-512, 4, 8, 0x9], [-256, 4, 7, 0xa], [-128, 5, 6, 0x1d], [-64, 5, 5, 0x1e], [-32, 4, 5, 0xb], [0, 2, 7, 0x0], [128, 3, 7, 0x2], [256, 3, 8, 0x3], [512, 4, 9, 0xc], [1024, 4, 10, 0xd], [-2049, 6, 32, 0x3e], [2048, 6, 32, 0x3f]]
const HB8: HLine[] = [[-15, 8, 3, 0xfc], [-7, 9, 1, 0x1fc], [-5, 8, 1, 0xfd], [-3, 9, 0, 0x1fd], [-2, 7, 0, 0x7c], [-1, 4, 0, 0xa], [0, 2, 1, 0x0], [2, 5, 0, 0x1a], [3, 6, 0, 0x3a], [4, 3, 4, 0x4], [20, 6, 1, 0x3b], [22, 4, 4, 0xb], [38, 4, 5, 0xc], [70, 5, 6, 0x1b], [134, 5, 7, 0x1c], [262, 6, 7, 0x3c], [390, 7, 8, 0x7d], [646, 6, 10, 0x3d], [-16, 9, 32, 0x1fe], [1670, 9, 32, 0x1ff], [2, 0x1]]
const HB11: HLine[] = [[1, 1, 0, 0x0], [2, 2, 1, 0x2], [4, 4, 0, 0xc], [5, 4, 1, 0xd], [7, 5, 1, 0x1c], [9, 5, 2, 0x1d], [13, 6, 2, 0x3c], [17, 7, 2, 0x7a], [21, 7, 3, 0x7b], [29, 7, 4, 0x7c], [45, 7, 5, 0x7d], [77, 7, 6, 0x7e], [141, 7, 32, 0x7f]]
const HB14: HLine[] = [[-2, 3, 0, 0x4], [-1, 3, 0, 0x5], [0, 1, 0, 0x0], [1, 3, 0, 0x6], [2, 3, 0, 0x7]]
const HB15: HLine[] = [[-24, 7, 4, 0x7c], [-8, 6, 2, 0x3c], [-4, 5, 1, 0x1c], [-2, 4, 0, 0xc], [-1, 3, 0, 0x4], [0, 1, 0, 0x0], [1, 3, 0, 0x5], [2, 4, 0, 0xd], [3, 5, 1, 0x1d], [5, 6, 2, 0x3d], [9, 7, 4, 0x7d], [-25, 7, 32, 0x7e], [25, 7, 32, 0x7f]]

function encHuff(lines: HLine[], value: number): string {
  for (const line of lines) {
    if (line.length === 2) continue
    const [low, prefLen, rangeLen, code] = line as [number, number, number, number]
    if (rangeLen === 32) continue
    if (value >= low && value < low + (1 << rangeLen)) return bin(code, prefLen) + bin(value - low, rangeLen)
  }
  throw new Error('unencodable value ' + value)
}
function encOOB(lines: HLine[]): string {
  const oob = lines.find(l => l.length === 2)!
  return bin(oob[1]!, oob[0]!)
}

class BitWriter {
  bits = ''
  add(s: string): void { this.bits += s }
  align(): void { while (this.bits.length % 8 !== 0) this.bits += '0' }
  bytes(): number[] { this.align(); const out: number[] = []; for (let i = 0; i < this.bits.length; i += 8) out.push(parseInt(this.bits.substr(i, 8), 2)); return out }
}

describe('JBIG2 Huffman symbol dictionary + text region', () => {
  it('round trips a Huffman symbol dictionary and text region using a custom FS table', () => {
    // Two 3x3 symbols placed side by side (6x3 page).
    const s0 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    const s1 = [1, 1, 1, 0, 0, 0, 1, 1, 1]
    const cw = 6, ch = 3

    // Symbol dictionary (Huffman, SDHUFF=1, all standard-table selectors 0).
    const sd = new BitWriter()
    sd.add(encHuff(HB4, 3))                    // deltaHeight = 3 (height class)
    sd.add(encHuff(HB2, 3))                    // deltaWidth = 3 (symbol 0 width)
    sd.add(encHuff(HB2, 0))                    // deltaWidth = 0 (symbol 1 width 3)
    sd.add(encOOB(HB2))                        // end of height class
    sd.add(encHuff(HB1, 0))                    // bitmapSize = 0 → uncompressed
    sd.align()                                 // decoder byte-aligns before the bitmap
    for (let y = 0; y < ch; y++) {             // uncompressed collective bitmap (byte-aligned rows)
      for (let x = 0; x < cw; x++) sd.add(String(x < 3 ? s0[y * 3 + x]! : s1[y * 3 + (x - 3)]!))
      sd.align()
    }
    sd.add(encHuff(HB1, 0))                    // export run: exclude 0
    sd.add(encHuff(HB1, 2))                    // export run: include 2
    const sdBody = [0x00, 0x01, /* SDHUFF flags */ 0, 0, 0, 2, /* exported */ 0, 0, 0, 2, /* new */ ...sd.bytes()]

    // Text region (Huffman, SBHUFF=1, refCorner=TL, all selectors 0).
    const tr = new BitWriter()
    // Symbol ID table: 35 runcode lengths (only value 1 has length 1), then the
    // two symbols' code lengths (1,1 → codes "0","1").
    for (let i = 0; i <= 34; i++) tr.add(bin(i === 1 ? 1 : 0, 4))
    tr.add('0')                                // symbol 0 code length = runcode "0" → 1
    tr.add('0')                                // symbol 1 code length = runcode "0" → 1
    tr.align()                                 // symbol ID table is byte-aligned
    tr.add(encHuff(HB11, 1))                   // initial stripT delta (=1 → stripT=-1)
    tr.add(encHuff(HB11, 1))                   // deltaT (=1 → stripT=0)
    tr.add('0')                                // deltaFirstS = 0 through the custom table
    tr.add('0')                                // symbol ID 0
    tr.add(encHuff(HB8, 1))                    // deltaS = 1 (place symbol 1 at S=3)
    tr.add('1')                                // symbol ID 1
    tr.add(encOOB(HB8))                        // end of strip
    const trHeader = [
      0, 0, 0, cw, 0, 0, 0, ch, 0, 0, 0, 0, 0, 0, 0, 0, 0, // region info (w,h,x,y,combOp)
      0x00, 0x11, // text region flags: SBHUFF=1, refCorner=1 (TL)
      0x00, 0x03, // text region Huffman flags: custom FS, standard DS/DT
      0, 0, 0, 2, // SBNUMINSTANCES = 2
    ]
    const trBody = [...trHeader, ...tr.bytes()]

    // Custom FS table: value 0 has canonical code 0; lower/upper ranges use 10/11.
    const customFsBody = [0x02, 0, 0, 0, 0, 0, 0, 0, 1, 0x54]

    // Assemble the embedded stream: page info, symbol dict, custom table, and text region.
    const out: number[] = []
    const u32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
    u32(1); out.push(48, 0, 1); u32(19); u32(cw); u32(ch); u32(0); u32(0); out.push(0, 0, 0) // page info
    u32(2); out.push(0, 1, 1); u32(sdBody.length); out.push(...sdBody)                        // symbol dict
    u32(3); out.push(53, 1, 1); u32(customFsBody.length); out.push(...customFsBody)            // custom FS table
    u32(4); out.push(6, 0x47, 2, 3, 1); u32(trBody.length); out.push(...trBody)                // text region

    const img = decodeJbig2(new Uint8Array(out))
    const expected = new Uint8Array(cw * ch)
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) expected[y * cw + x] = x < 3 ? s0[y * 3 + x]! : s1[y * 3 + (x - 3)]!
    expect(img.width).toBe(cw)
    expect(img.height).toBe(ch)
    expect(Array.from(img.pixels)).toEqual(Array.from(expected))
  })

  it('decodes a Huffman text-region symbol-instance refinement', () => {
    const source = new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
    const target = new Uint8Array([1, 1, 0, 0, 1, 0, 0, 1, 1])
    const sd = new BitWriter()
    sd.add(encHuff(HB4, 3)); sd.add(encHuff(HB2, 3)); sd.add(encOOB(HB2)); sd.add(encHuff(HB1, 0)); sd.align()
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) sd.add(String(source[y * 3 + x]!))
      sd.align()
    }
    sd.add(encHuff(HB1, 0)); sd.add(encHuff(HB1, 1))
    const sdBody = [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, ...sd.bytes()]

    const refinement = encodeRefinementTemplate1(3, 3, target, source)
    const tr = new BitWriter()
    for (let i = 0; i <= 34; i++) tr.add(bin(i === 1 ? 1 : 0, 4))
    tr.add('0'); tr.align()
    tr.add(encHuff(HB11, 1)); tr.add(encHuff(HB11, 1)); tr.add(encHuff(HB6, 0))
    tr.add('0') // symbol ID
    tr.add('1') // RI
    tr.add(encHuff(HB14, 0)); tr.add(encHuff(HB14, 0)); tr.add(encHuff(HB14, 0)); tr.add(encHuff(HB14, 0))
    tr.add(encHuff(HB1, refinement.length)); tr.align()
    for (const byte of refinement) tr.add(bin(byte, 8))
    tr.add(encOOB(HB8))
    const trHeader = [
      0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x80, 0x13, // SBHUFF, SBREFINE, top-left, SBRTemplate=1
      0, 0, 0, 0, 0, 1,
    ]
    const trBody = [...trHeader, ...tr.bytes()]
    const out: number[] = []
    const u32 = (value: number): void => out.push((value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF)
    u32(1); out.push(48, 0, 1); u32(19); u32(3); u32(3); u32(0); u32(0); out.push(0, 0, 0)
    u32(2); out.push(0, 1, 1); u32(sdBody.length); out.push(...sdBody)
    u32(3); out.push(6, 0x20, 2, 1); u32(trBody.length); out.push(...trBody)

    expect(Array.from(decodeJbig2(new Uint8Array(out)).pixels)).toEqual(Array.from(target))
  })

  it('decodes a Huffman refinement-coded symbol dictionary', () => {
    const source = new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
    const target = new Uint8Array([0, 1, 0, 1, 1, 1, 0, 1, 0])
    const base = new BitWriter()
    base.add(encHuff(HB4, 3)); base.add(encHuff(HB2, 3)); base.add(encOOB(HB2)); base.add(encHuff(HB1, 0)); base.align()
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) base.add(String(source[y * 3 + x]!))
      base.align()
    }
    base.add(encHuff(HB1, 0)); base.add(encHuff(HB1, 1))
    const baseBody = [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, ...base.bytes()]

    const refinement = encodeRefinementTemplate1(3, 3, target, source)
    const refined = new BitWriter()
    refined.add(encHuff(HB4, 3)); refined.add(encHuff(HB2, 3))
    refined.add(encHuff(HB1, 1)); refined.add('0')
    refined.add(encHuff(HB15, 0)); refined.add(encHuff(HB15, 0)); refined.add(encHuff(HB1, refinement.length)); refined.align()
    for (const byte of refinement) refined.add(bin(byte, 8))
    refined.add(encOOB(HB2)); refined.add(encHuff(HB1, 1)); refined.add(encHuff(HB1, 1))
    const refinedBody = [0x10, 0x03, 0, 0, 0, 1, 0, 0, 0, 1, ...refined.bytes()]

    const tr = new BitWriter()
    for (let i = 0; i <= 34; i++) tr.add(bin(i === 1 ? 1 : 0, 4))
    tr.add('0'); tr.align(); tr.add(encHuff(HB11, 1)); tr.add(encHuff(HB11, 1)); tr.add(encHuff(HB6, 0)); tr.add('0'); tr.add(encOOB(HB8))
    const trBody = [
      0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0x11, 0, 0, 0, 0, 0, 1, ...tr.bytes(),
    ]
    const out: number[] = []
    const u32 = (value: number): void => out.push((value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF)
    u32(1); out.push(48, 0, 1); u32(19); u32(3); u32(3); u32(0); u32(0); out.push(0, 0, 0)
    u32(2); out.push(0, 1, 1); u32(baseBody.length); out.push(...baseBody)
    u32(3); out.push(0, 0x21, 2, 1); u32(refinedBody.length); out.push(...refinedBody)
    u32(4); out.push(6, 0x20, 3, 1); u32(trBody.length); out.push(...trBody)

    expect(Array.from(decodeJbig2(new Uint8Array(out)).pixels)).toEqual(Array.from(target))
  })
})
