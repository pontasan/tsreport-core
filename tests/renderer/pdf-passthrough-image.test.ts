import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PdfBackend, PdfImporter } from '../../src/index.js'
import { decodePng } from '../../src/image/png-parser.js'
import { zlibDeflate } from '../../src/compression/deflate.js'
import { pdfToText } from './pdf-test-utils.js'

const JPX_DIR = join(__dirname, '..', 'fixtures', 'jpx')

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
  private b = -1
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

function encodeGenericTemplate0(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const enc = new MqEncoder()
  const cx: { index: number, mps: number }[] = []
  for (let i = 0; i < 1 << 16; i++) cx.push({ index: 0, mps: 0 })
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
  return enc.flush()
}

function buildEmbeddedJbig2(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const mqData = encodeGenericTemplate0(width, height, pixels)
  const out: number[] = []
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF) }
  pushU32(1); out.push(48, 0, 1)
  pushU32(19)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0)
  out.push(0, 0, 0)
  const at = [3, -1, -3, -1, 2, -2, -2, -2]
  pushU32(2); out.push(38, 0, 1)
  pushU32(17 + 1 + 8 + mqData.length)
  pushU32(width); pushU32(height); pushU32(0); pushU32(0)
  out.push(0)
  out.push(0)
  for (const v of at) out.push(v & 0xFF)
  for (const b of mqData) out.push(b)
  return new Uint8Array(out)
}

function lzwLiteralEncode(data: Uint8Array): Uint8Array {
  const codes = new Array<number>(data.length + 2)
  codes[0] = 256
  for (let i = 0; i < data.length; i++) codes[i + 1] = data[i]!
  codes[codes.length - 1] = 257
  const out = new Uint8Array(Math.ceil(codes.length * 9 / 8))
  let bitPos = 0
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    for (let bit = 8; bit >= 0; bit--) {
      if (((code >> bit) & 1) !== 0) out[bitPos >> 3]! |= 1 << (7 - (bitPos & 7))
      bitPos++
    }
  }
  return out
}

function asciiHexEncode(data: Uint8Array): Uint8Array {
  const hex = '0123456789ABCDEF'
  const out = new Uint8Array(data.length * 2 + 1)
  let pos = 0
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!
    out[pos++] = hex.charCodeAt(b >> 4)
    out[pos++] = hex.charCodeAt(b & 15)
  }
  out[pos] = 0x3E
  return out
}

function ascii85Encode(data: Uint8Array): Uint8Array {
  const chars: number[] = []
  let pos = 0
  while (pos < data.length) {
    const remaining = data.length - pos
    const count = remaining >= 4 ? 4 : remaining
    let value = 0
    for (let i = 0; i < 4; i++) value = value * 256 + (i < count ? data[pos + i]! : 0)
    if (count === 4 && value === 0) {
      chars.push(0x7A)
    } else {
      const group = new Array<number>(5)
      for (let i = 4; i >= 0; i--) {
        group[i] = (value % 85) + 33
        value = Math.floor(value / 85)
      }
      const emit = count === 4 ? 5 : count + 1
      for (let i = 0; i < emit; i++) chars.push(group[i]!)
    }
    pos += count
  }
  chars.push(0x7E, 0x3E)
  return new Uint8Array(chars)
}

function runLengthEncode(data: Uint8Array): Uint8Array {
  const chunks: number[] = []
  let pos = 0
  while (pos < data.length) {
    const count = Math.min(128, data.length - pos)
    chunks.push(count - 1)
    for (let i = 0; i < count; i++) chunks.push(data[pos + i]!)
    pos += count
  }
  chunks.push(128)
  return new Uint8Array(chunks)
}

function renderImageDataPdf(data: Uint8Array, mimeType?: string): Uint8Array {
  const backend = new PdfBackend({ fonts: {} })
  backend.beginDocument()
  backend.beginPage(100, 100)
  backend.drawImageData(10, 20, 64, 48, data, mimeType)
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}

describe('PDF passthrough image output', () => {
  it('writes JPEG 2000 as a JPXDecode image XObject and imports it back', () => {
    const jpx = new Uint8Array(readFileSync(join(JPX_DIR, 'rgb16-lossless.jp2')))
    const pdf = renderImageDataPdf(jpx, 'image/jp2')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/Filter /JPXDecode')
    expect(pdfStr).toContain('/Width 16')
    expect(pdfStr).toContain('/Height 12')
    expect(pdfStr).toContain('/ColorSpace /DeviceRGB')
    expect(pdfStr).toContain('/BitsPerComponent 8')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(16)
    expect(decoded.height).toBe(12)
  })

  it('writes embedded JBIG2 data as a JBIG2Decode image XObject and imports it back', () => {
    const width = 24
    const height = 16
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x % 5 === 0 || y === 8) pixels[y * width + x] = 1
      }
    }
    const jbig2 = buildEmbeddedJbig2(width, height, pixels)
    const pdf = renderImageDataPdf(jbig2, 'image/jbig2')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/Filter /JBIG2Decode')
    expect(pdfStr).toContain('/Width 24')
    expect(pdfStr).toContain('/Height 16')
    expect(pdfStr).toContain('/ColorSpace /DeviceGray')
    expect(pdfStr).toContain('/BitsPerComponent 1')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(decoded.pixels[0]).toBe(0)
    expect(decoded.pixels[4]).toBe(255)
    expect(decoded.pixels[(8 * width + 3) * 4]).toBe(0)
  })

  it('writes raw CCITT Group 4 data as a CCITTFaxDecode image XObject and imports it back', () => {
    const ccitt = new Uint8Array([0x9D, 0x9A, 0x8A])
    const pdf = renderImageDataPdf(ccitt, 'image/ccitt;columns=72;rows=2;k=-1')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/Filter /CCITTFaxDecode')
    expect(pdfStr).toContain('/Width 72')
    expect(pdfStr).toContain('/Height 2')
    expect(pdfStr).toContain('/ColorSpace /DeviceGray')
    expect(pdfStr).toContain('/BitsPerComponent 1')
    expect(pdfStr).toContain('/DecodeParms << /K -1 /Columns 72 /Rows 2 >>')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(72)
    expect(decoded.height).toBe(2)
    expect([...decoded.pixels.slice(0, 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(71 * 4, 71 * 4 + 4)]).toEqual([255, 255, 255, 255])
    const row2 = 72 * 4
    expect([...decoded.pixels.slice(row2 + 64 * 4, row2 + 64 * 4 + 4)]).toEqual([0, 0, 0, 255])
    expect([...decoded.pixels.slice(row2 + 71 * 4, row2 + 71 * 4 + 4)]).toEqual([0, 0, 0, 255])
  })

  it('writes raw LZW image data as an LZWDecode image XObject and imports it back', () => {
    const rgb = new Uint8Array([
      255, 0, 0,
      0, 255, 0,
    ])
    const lzw = lzwLiteralEncode(rgb)
    const pdf = renderImageDataPdf(lzw, 'image/lzw;columns=2;rows=1;colorspace=DeviceRGB;bitspercomponent=8;earlychange=1')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/Filter /LZWDecode')
    expect(pdfStr).toContain('/Width 2')
    expect(pdfStr).toContain('/Height 1')
    expect(pdfStr).toContain('/ColorSpace /DeviceRGB')
    expect(pdfStr).toContain('/BitsPerComponent 8')
    expect(pdfStr).toContain('/DecodeParms << /EarlyChange 1 >>')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect([...decoded.pixels.slice(0, 8)]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ])
  })

  it.each([
    ['ASCIIHexDecode', 'image/asciihex', asciiHexEncode],
    ['ASCII85Decode', 'image/ascii85', ascii85Encode],
    ['RunLengthDecode', 'image/runlength', runLengthEncode],
  ] as const)('writes raw %s image data as an image XObject and imports it back', (filter, mime, encode) => {
    const rgb = new Uint8Array([
      255, 0, 0,
      0, 255, 0,
    ])
    const encoded = encode(rgb)
    const pdf = renderImageDataPdf(encoded, `${mime};columns=2;rows=1;colorspace=DeviceRGB;bitspercomponent=8`)
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain(`/Filter /${filter}`)
    expect(pdfStr).toContain('/Width 2')
    expect(pdfStr).toContain('/Height 1')
    expect(pdfStr).toContain('/ColorSpace /DeviceRGB')
    expect(pdfStr).toContain('/BitsPerComponent 8')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect([...decoded.pixels.slice(0, 8)]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ])
  })

  it('writes color-key Mask ranges on raw encoded image XObjects and imports transparency back', () => {
    const rgb = new Uint8Array([
      255, 0, 0,
      0, 255, 0,
    ])
    const encoded = runLengthEncode(rgb)
    const pdf = renderImageDataPdf(encoded, 'image/runlength;columns=2;rows=1;colorspace=DeviceRGB;bitspercomponent=8;mask=0,5,250,255,0,5')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/Filter /RunLengthDecode')
    expect(pdfStr).toContain('/Mask [0 5 250 255 0 5]')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect([...decoded.pixels.slice(0, 8)]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 0,
    ])
  })

  it('writes raw 16-bit Flate image data as a FlateDecode image XObject and imports it back', () => {
    const gray16 = new Uint8Array([
      0x00, 0x00,
      0xFF, 0xFF,
    ])
    const flate = zlibDeflate(gray16)
    const pdf = renderImageDataPdf(flate, 'image/flate;columns=2;rows=1;colorspace=DeviceGray;bitspercomponent=16')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/Filter /FlateDecode')
    expect(pdfStr).toContain('/Width 2')
    expect(pdfStr).toContain('/Height 1')
    expect(pdfStr).toContain('/ColorSpace /DeviceGray')
    expect(pdfStr).toContain('/BitsPerComponent 16')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect([...decoded.pixels.slice(0, 8)]).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ])
  })

  it('writes raw Flate image data as an inline image and imports it back', () => {
    const rgb = new Uint8Array([
      255, 0, 0,
      0, 255, 0,
    ])
    const flate = zlibDeflate(rgb)
    const pdf = renderImageDataPdf(flate, 'image/flate;columns=2;rows=1;colorspace=DeviceRGB;bitspercomponent=8;inline=true')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('BI')
    expect(pdfStr).toContain('/Filter [/ASCIIHexDecode /FlateDecode]')
    expect(pdfStr).toContain('ID')
    expect(pdfStr).toContain('EI')
    expect(pdfStr).not.toContain('/Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect([...decoded.pixels.slice(0, 8)]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ])
  })

  it('writes Decode arrays on raw encoded image XObjects and imports remapped samples back', () => {
    const gray = new Uint8Array([0, 255])
    const flate = zlibDeflate(gray)
    const pdf = renderImageDataPdf(flate, 'image/flate;columns=2;rows=1;colorspace=DeviceGray;bitspercomponent=8;decode=1,0')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/Filter /FlateDecode')
    expect(pdfStr).toContain('/Decode [1 0]')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePng(png)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect([...decoded.pixels.slice(0, 8)]).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
    ])
  })

  it('writes image rendering intent and interpolation flags on raw encoded image XObjects', () => {
    const gray = new Uint8Array([0, 255])
    const flate = zlibDeflate(gray)
    const pdf = renderImageDataPdf(flate, 'image/flate;columns=2;rows=1;colorspace=DeviceGray;bitspercomponent=8;intent=RelativeColorimetric;interpolate=true')
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/Filter /FlateDecode')
    expect(pdfStr).toContain('/Intent /RelativeColorimetric')
    expect(pdfStr).toContain('/Interpolate true')
  })
})
