// Lossless image palettization on PDF output: images with at most 256 unique
// colors emit as an Indexed color space at the smallest sufficient bit depth
// (1/2/4/8); many-color images keep the direct DeviceRGB path. Round trips
// through the importer prove pixel identity.

import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter } from '../../src/index.js'
import { pdfToText } from './pdf-test-utils.js'

function renderImagePdf(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const backend = new PdfBackend({ fonts: {} })
  backend.beginDocument()
  backend.beginPage(200, 200)
  backend.drawImageData(10, 10, 100, 100, encodePng(width, height, rgba))
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}

function solidRgba(width: number, height: number, colors: [number, number, number][]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const color = colors[i % colors.length]!
    rgba[i * 4] = color[0]
    rgba[i * 4 + 1] = color[1]
    rgba[i * 4 + 2] = color[2]
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

describe('Indexed image output', () => {
  it('two colors pack to 1 bit per pixel', () => {
    const pdf = renderImagePdf(8, 8, solidRgba(8, 8, [[255, 0, 0], [0, 0, 255]]))
    const text = pdfToText(pdf)
    expect(text).toContain('/ColorSpace [/Indexed /DeviceRGB 1 <ff00000000ff>]')
    expect(text).toContain('/BitsPerComponent 1')
  })

  it('three colors pack to 2 bits per pixel', () => {
    const pdf = renderImagePdf(9, 3, solidRgba(9, 3, [[255, 0, 0], [0, 255, 0], [0, 0, 255]]))
    const text = pdfToText(pdf)
    expect(text).toContain('/Indexed /DeviceRGB 2 ')
    expect(text).toContain('/BitsPerComponent 2')
  })

  it('sixteen colors pack to 4 bits per pixel', () => {
    const colors: [number, number, number][] = []
    for (let i = 0; i < 16; i++) colors.push([i * 16, 0, 0])
    const pdf = renderImagePdf(16, 4, solidRgba(16, 4, colors))
    const text = pdfToText(pdf)
    expect(text).toContain('/Indexed /DeviceRGB 15 ')
    expect(text).toContain('/BitsPerComponent 4')
  })

  it('more than 256 colors keeps the direct DeviceRGB path', () => {
    const width = 32
    const height = 12
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = i & 0xFF
      rgba[i * 4 + 1] = (i >> 4) & 0xFF
      rgba[i * 4 + 2] = (i * 7) & 0xFF
      rgba[i * 4 + 3] = 255
    }
    const pdf = renderImagePdf(width, height, rgba)
    const text = pdfToText(pdf)
    expect(text).toContain('/ColorSpace /DeviceRGB')
    expect(text).toContain('/Predictor 15')
  })

  it('alpha survives palettization as an SMask', () => {
    const rgba = solidRgba(4, 4, [[255, 0, 0]])
    rgba[3] = 128 // first pixel semi-transparent
    const pdf = renderImagePdf(4, 4, rgba)
    const text = pdfToText(pdf)
    expect(text).toContain('/Indexed /DeviceRGB 0 ')
    expect(text).toContain('/SMask')
  })

  it('round trips pixel-identically through the importer', () => {
    const rgba = solidRgba(4, 2, [[255, 0, 0], [0, 0, 255]])
    const pdf = renderImagePdf(4, 2, rgba)
    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(function (el) { return el.type === 'image' })
    expect(image).toBeDefined()
    const source = (image as { source: string }).source
    const png = page.images[source]!
    expect(png).toBeDefined()
    // Decode the round-tripped PNG and compare each pixel
    const decoded = decodePngRgba(png)
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(2)
    for (let i = 0; i < 8; i++) {
      expect(decoded.rgba[i * 4]).toBe(rgba[i * 4])
      expect(decoded.rgba[i * 4 + 1]).toBe(rgba[i * 4 + 1])
      expect(decoded.rgba[i * 4 + 2]).toBe(rgba[i * 4 + 2])
    }
  })
})

// ─── Minimal PNG encode/decode helpers (color type 6, no interlace) ───

import { zlibDeflate } from '../../src/compression/deflate.js'
import { zlibInflate } from '../../src/compression/inflate.js'

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  const crc = crc32(body)
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(body, 4)
  new DataView(out.buffer).setUint32(8 + data.length, crc)
  return out
}

function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1)
  }
  const idat = zlibDeflate(raw)
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  let total = sig.length
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  out.set(sig)
  let pos = sig.length
  for (const c of chunks) { out.set(c, pos); pos += c.length }
  return out
}

function decodePngRgba(png: Uint8Array): { width: number, height: number, rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const colorType = png[25]!
  // Collect IDAT
  let pos = 8
  const idatParts: Uint8Array[] = []
  while (pos < png.length) {
    const length = view.getUint32(pos)
    const type = String.fromCharCode(png[pos + 4]!, png[pos + 5]!, png[pos + 6]!, png[pos + 7]!)
    if (type === 'IDAT') idatParts.push(png.subarray(pos + 8, pos + 8 + length))
    pos += 12 + length
  }
  let total = 0
  for (const part of idatParts) total += part.length
  const idat = new Uint8Array(total)
  let at = 0
  for (const part of idatParts) { idat.set(part, at); at += part.length }
  const raw = zlibInflate(idat)
  const channels = colorType === 6 ? 4 : 3
  const rowLen = 1 + width * channels
  const rgba = new Uint8Array(width * height * 4)
  const prior = new Uint8Array(width * channels)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * rowLen]!
    const row = raw.subarray(y * rowLen + 1, y * rowLen + 1 + width * channels)
    const line = new Uint8Array(width * channels)
    for (let i = 0; i < row.length; i++) {
      const left = i >= channels ? line[i - channels]! : 0
      const up = prior[i]!
      const upLeft = i >= channels ? prior[i - channels]! : 0
      let value = row[i]!
      if (filter === 1) value = (value + left) & 0xFF
      else if (filter === 2) value = (value + up) & 0xFF
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xFF
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xFF
      }
      line[i] = value
    }
    prior.set(line)
    for (let x = 0; x < width; x++) {
      rgba[(y * width + x) * 4] = line[x * channels]!
      rgba[(y * width + x) * 4 + 1] = line[x * channels + 1]!
      rgba[(y * width + x) * 4 + 2] = line[x * channels + 2]!
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3]! : 255
    }
  }
  return { width, height, rgba }
}

describe('ImageMask (stencil) output', () => {
  it('single color + binary alpha emits as /ImageMask true with the fill color', async () => {
    const { pdfToText } = await import('./pdf-test-utils.js')
    // 4x2: red where opaque, transparent elsewhere (checker)
    const rgba = new Uint8Array(4 * 2 * 4)
    for (let i = 0; i < 8; i++) {
      rgba[i * 4] = 255
      rgba[i * 4 + 3] = i % 2 === 0 ? 255 : 0
    }
    const pdf = renderImagePdf(4, 2, rgba)
    const text = pdfToText(pdf)
    expect(text).toContain('/ImageMask true')
    expect(text).toContain('/BitsPerComponent 1')
    expect(text).not.toContain('/SMask')
    // Fill color set before Do (red)
    expect(text).toMatch(/1 0 0 rg\n[^\n]*cm\n\/Im0 Do/)
  })

  it('stencil round trips through the importer with the paint color', () => {
    const rgba = new Uint8Array(4 * 2 * 4)
    for (let i = 0; i < 8; i++) {
      rgba[i * 4 + 2] = 255 // blue
      rgba[i * 4 + 3] = i < 4 ? 255 : 0
    }
    const pdf = renderImagePdf(4, 2, rgba)
    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(function (el) { return el.type === 'image' })
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    const decoded = decodePngRgba(png)
    // Opaque row painted blue, transparent row alpha 0
    expect(decoded.rgba[2]).toBe(255)
    expect(decoded.rgba[3]).toBe(255)
    expect(decoded.rgba[4 * 4 + 3]).toBe(0)
  })

  it('multi-color binary alpha emits an explicit /Mask Image XObject', () => {
    const rgba = solidRgba(4, 2, [[255, 0, 0], [0, 0, 255]])
    for (let i = 0; i < 8; i++) rgba[i * 4 + 3] = i % 3 === 0 ? 0 : 255
    const pdf = renderImagePdf(4, 2, rgba)
    const text = pdfToText(pdf)

    expect(text).toContain('/ColorSpace [/Indexed /DeviceRGB')
    expect(text).toMatch(/\/Mask \d+ 0 R/)
    expect(text).toContain('/ImageMask true')
    expect(text).toContain('/Decode [0 1]')
    expect(text).not.toContain('/SMask')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(function (el) { return el.type === 'image' })
    expect(image).toBeDefined()
    const decoded = decodePngRgba(page.images[(image as { source: string }).source]!)
    expect(decoded.rgba[3]).toBe(0)
    expect(decoded.rgba[7]).toBe(255)
  })

  it('direct DeviceRGB binary alpha emits an explicit /Mask Image XObject', () => {
    const width = 17
    const height = 17
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = i & 0xFF
      rgba[i * 4 + 1] = (i >> 8) & 0xFF
      rgba[i * 4 + 2] = (i >> 16) & 0xFF
      rgba[i * 4 + 3] = i % 5 === 0 ? 0 : 255
    }
    const pdf = renderImagePdf(width, height, rgba)
    const text = pdfToText(pdf)

    expect(text).toContain('/ColorSpace /DeviceRGB')
    expect(text).toMatch(/\/Mask \d+ 0 R/)
    expect(text).toContain('/ImageMask true')
    expect(text).not.toContain('/SMask')

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(function (el) { return el.type === 'image' })
    expect(image).toBeDefined()
    const decoded = decodePngRgba(page.images[(image as { source: string }).source]!)
    expect(decoded.rgba[3]).toBe(0)
    expect(decoded.rgba[7]).toBe(255)
  })

  it('two opaque colors do not stencil (palettize instead)', async () => {
    const { pdfToText } = await import('./pdf-test-utils.js')
    const rgba = solidRgba(4, 2, [[255, 0, 0], [0, 0, 255]])
    const text = pdfToText(renderImagePdf(4, 2, rgba))
    expect(text).not.toContain('/ImageMask')
    expect(text).toContain('/Indexed /DeviceRGB')
  })
})
