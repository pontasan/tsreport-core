import { describe, it, expect } from 'vitest'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { zlibDeflate } from '../../src/compression/deflate.js'
import type { RenderDocument } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'

/* Minimum JPEG data generate. */

function createMinimalJpeg(width: number, height: number, components: number): Uint8Array {
  const data: number[] = []
  data.push(0xFF, 0xD8)
  const sofLen = 8 + components * 3
  data.push(0xFF, 0xC0)
  data.push((sofLen >> 8) & 0xFF, sofLen & 0xFF)
  data.push(8)
  data.push((height >> 8) & 0xFF, height & 0xFF)
  data.push((width >> 8) & 0xFF, width & 0xFF)
  data.push(components)
  for (let i = 0; i < components; i++) data.push(i + 1, 0x11, 0)
  data.push(0xFF, 0xDA)
  data.push(0x00, 0x02 + components * 2 + 1)
  data.push(components)
  for (let i = 0; i < components; i++) data.push(i + 1, 0x00)
  data.push(0x00, 0x3F, 0x00)
  data.push(0xFF, 0xD9)
  return new Uint8Array(data)
}

/** Minimal 4-component (CMYK) JPEG, optionally carrying an Adobe APP14 marker
 *  (transform 0) so parseJpegInfo reports isAdobeCMYK. */
function createMinimalCmykJpeg(adobe: boolean): Uint8Array {
  const data: number[] = []
  data.push(0xFF, 0xD8)
  if (adobe) {
    // APP14: FFEE, len=14, "Adobe", version, flags0, flags1, transform=0
    data.push(0xFF, 0xEE, 0x00, 0x0E, 0x41, 0x64, 0x6F, 0x62, 0x65,
      0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00)
  }
  const components = 4
  const sofLen = 8 + components * 3
  data.push(0xFF, 0xC0, (sofLen >> 8) & 0xFF, sofLen & 0xFF, 8, 0, 4, 0, 4, components)
  for (let i = 0; i < components; i++) data.push(i + 1, 0x11, 0)
  data.push(0xFF, 0xDA, 0x00, 0x02 + components * 2 + 1, components)
  for (let i = 0; i < components; i++) data.push(i + 1, 0x00)
  data.push(0x00, 0x3F, 0x00, 0xFF, 0xD9)
  return new Uint8Array(data)
}

/** CRC32 */
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

function createMinimalPng(width: number, height: number, colorType: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  ihdr[0] = (width >> 24) & 0xFF; ihdr[1] = (width >> 16) & 0xFF; ihdr[2] = (width >> 8) & 0xFF; ihdr[3] = width & 0xFF
  ihdr[4] = (height >> 24) & 0xFF; ihdr[5] = (height >> 16) & 0xFF; ihdr[6] = (height >> 8) & 0xFF; ihdr[7] = height & 0xFF
  ihdr[8] = 8; ihdr[9] = colorType
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1
  const rowBytes = width * channels
  const raw = new Uint8Array(height * (rowBytes + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0  // filter None
    for (let x = 0; x < rowBytes; x++) raw[y * (rowBytes + 1) + 1 + x] = (x + y * 17) & 0xFF
  }
  const compressed = zlibDeflate(raw)
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const chunks = [makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', new Uint8Array(0))]
  let total = sig.length
  for (const c of chunks) total += c.length
  const result = new Uint8Array(total)
  result.set(sig)
  let pos = sig.length
  for (const c of chunks) { result.set(c, pos); pos += c.length }
  return result
}

describe('PDF Image embedding', () => {
  it('owns image maps and restores constructor images at each document boundary', () => {
    const suppliedImages = { supplied: createMinimalPng(1, 1, 6) }
    const documentImages = { document: createMinimalPng(1, 1, 6) }
    const backend = new PdfBackend({ fonts: {}, images: suppliedImages })
    const internals = backend as unknown as { images: Record<string, string | Uint8Array> }

    backend.beginDocument()
    backend.setImages(documentImages)
    backend.beginPage(10, 10)
    backend.drawImageData(0, 0, 1, 1, createMinimalPng(1, 1, 6), 'image/png')
    expect(Object.keys(suppliedImages)).toEqual(['supplied'])
    expect(Object.keys(documentImages)).toEqual(['document'])
    expect(Object.keys(internals.images)).toContain('document')
    expect(() => backend.setImages(documentImages)).toThrow(
      'Image resources must be set before the first page begins',
    )

    backend.beginDocument()
    expect(Object.keys(internals.images)).toEqual(['supplied'])
  })

  it('omits an unavailable alternate instead of failing the PDF', () => {
    const png = createMinimalPng(1, 1, 6)
    const doc: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{
        type: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'main',
        alternates: [{ imageId: 'missing' }],
      }] }],
      images: { main: png },
    }
    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = pdfToText(backend.toUint8Array())
    expect(pdf).not.toContain('/Alternates')
  })

  it('rejects a supplied alternate that is not a raster image', () => {
    const png = createMinimalPng(1, 1, 6)
    const doc: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{
        type: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'main',
        alternates: [{ imageId: 'alternate', defaultForPrinting: true }],
      }] }],
      images: {
        main: png,
        alternate: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      },
    }
    const backend = new PdfBackend({ fonts: {} })
    expect(() => render(doc, backend)).toThrow('PDF alternate image must contain embedded raster data: alternate')
  })

  it('keeps constructor-supplied images authoritative through primitive render', () => {
    const png = createMinimalPng(1, 1, 6)
    const doc: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{
        type: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'main',
        alternates: [{ imageId: 'alternate' }],
      }] }],
      images: { main: new Uint8Array([1, 2, 3]) },
    }
    const backend = new PdfBackend({ fonts: {}, images: { main: png, alternate: png } })
    render(doc, backend)
    const pdf = pdfToText(backend.toUint8Array())
    expect(pdf).toContain('/Alternates')
    expect(pdf).toContain('/Subtype /Image')
  })

  it('rebuilds alternate image registrations when a backend renders another document', () => {
    const png = createMinimalPng(1, 1, 6)
    const alternates = [{ imageId: 'alternate' }]
    const doc: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{
        type: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'main', alternates,
      }] }],
    }
    const backend = new PdfBackend({ fonts: {}, images: { main: png, alternate: png } })
    render(doc, backend)
    expect(pdfToText(backend.toUint8Array())).toContain('/Alternates')
    render(doc, backend)
    expect(pdfToText(backend.toUint8Array())).toContain('/Alternates')
  })

  it('keeps a registered alternate when another node with the same image has no available alternate', () => {
    const png = createMinimalPng(1, 1, 6)
    const validNode = {
      type: 'image' as const, x: 0, y: 0, width: 10, height: 10, imageId: 'main',
      alternates: [{ imageId: 'alternate' }],
    }
    const missingNode = {
      type: 'image' as const, x: 20, y: 0, width: 10, height: 10, imageId: 'main',
      alternates: [{ imageId: 'missing' }],
    }
    const images = { main: png, alternate: png }
    const firstBackend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [validNode, missingNode] }], images }, firstBackend)
    expect(pdfToText(firstBackend.toUint8Array())).toContain('/Alternates')

    const secondBackend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [missingNode, validNode] }], images }, secondBackend)
    expect(pdfToText(secondBackend.toUint8Array())).toContain('/Alternates')
  })

  it('rejects conflicting alternate definitions for a shared image XObject', () => {
    const png = createMinimalPng(1, 1, 6)
    const doc: RenderDocument = {
      pages: [{ width: 100, height: 100, children: [{
        type: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'main',
        alternates: [{ imageId: 'alternate-a' }],
      }, {
        type: 'image', x: 20, y: 0, width: 10, height: 10, imageId: 'main',
        alternates: [{ imageId: 'alternate-b' }],
      }] }],
      images: { main: png, 'alternate-a': png, 'alternate-b': png },
    }
    const backend = new PdfBackend({ fonts: {} })
    expect(() => render(doc, backend)).toThrow('PDF image main has conflicting alternate definitions')
  })

  it('JPEG image produces valid PDF with DCTDecode XObject', () => {
    const jpeg = createMinimalJpeg(10, 10, 3)
    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 50, y: 100, width: 200, height: 150, imageId: 'test-jpeg',
        }],
      }],
      images: { 'test-jpeg': jpeg },
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = backend.toUint8Array()

    // PDF headercheck.
    
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('%PDF-1.7')
    // DCTDecode filter
    expect(pdfStr).toContain('/DCTDecode')
    // Image XObject
    expect(pdfStr).toContain('/Subtype /Image')
    expect(pdfStr).toContain('/ColorSpace /DeviceRGB')
    // Do operator
    expect(pdfStr).toContain('/Im0 Do')
    // XObject in resources
    expect(pdfStr).toContain('/XObject')
  })

  it('Adobe CMYK JPEG (APP14) gets an inverting /Decode array', () => {
    // Adobe CMYK JPEGs store inverted ink; the inverting Decode restores it.
    const jpeg = createMinimalCmykJpeg(true)
    const backend = new PdfBackend({ fonts: {}, images: { c: jpeg } })
    backend.beginDocument(); backend.beginPage(100, 100)
    backend.drawImage(0, 0, 100, 100, 'c')
    backend.endPage(); backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('/ColorSpace /DeviceCMYK')
    expect(pdfStr).toContain('/Decode [1 0 1 0 1 0 1 0]')
  })

  it('plain (non-Adobe) CMYK JPEG must NOT be inverted', () => {
    // Without the Adobe marker the ink values are direct; an inverting Decode
    // would double-invert and corrupt the colors.
    const jpeg = createMinimalCmykJpeg(false)
    const backend = new PdfBackend({ fonts: {}, images: { c: jpeg } })
    backend.beginDocument(); backend.beginPage(100, 100)
    backend.drawImage(0, 0, 100, 100, 'c')
    backend.endPage(); backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('/ColorSpace /DeviceCMYK')
    expect(pdfStr).not.toContain('/Decode [1 0 1 0 1 0 1 0]')
  })

  it('PNG RGB image with few colors palettizes to an Indexed XObject', () => {
    const png = createMinimalPng(8, 8, 2)
    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 50, y: 100, width: 200, height: 150, imageId: 'test-png',
        }],
      }],
      images: { 'test-png': png },
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/FlateDecode')
    expect(pdfStr).toContain('/ColorSpace [/Indexed /DeviceRGB')
    expect(pdfStr).toContain('/Im0 Do')
  })

  it('PNG RGBA image produces PDF with SMask', () => {
    const png = createMinimalPng(4, 4, 6)
    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 10, y: 10, width: 100, height: 100, imageId: 'rgba',
        }],
      }],
      images: { 'rgba': png },
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/SMask')
    expect(pdfStr).toContain('/DeviceGray')  // SMask is grayscale
    expect(pdfStr.match(/\/Interpolate true/g)).toHaveLength(2)
  })

  it('applies an explicit interpolation mode to both an RGBA image and its soft mask', () => {
    const png = createMinimalPng(4, 4, 6)
    const doc: RenderDocument = {
      pages: [{
        width: 100, height: 100,
        children: [{
          type: 'image', x: 0, y: 0, width: 100, height: 100, imageId: 'rgba', interpolate: false,
        }],
      }],
      images: { rgba: png },
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdfStr = pdfToText(backend.toUint8Array())

    expect(pdfStr.match(/\/Interpolate false/g)).toHaveLength(2)
    expect(pdfStr).not.toContain('/Interpolate true')
  })

  it('missing image shows placeholder (no crash)', () => {
    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 10, y: 10, width: 100, height: 100, imageId: 'nonexistent',
        }],
      }],
      images: {},
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = backend.toUint8Array()
    expect(pdf.length).toBeGreaterThan(0)
  })

  it('images passed via constructor options', () => {
    const jpeg = createMinimalJpeg(5, 5, 1)
    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 0, y: 0, width: 50, height: 50, imageId: 'gray',
        }],
      }],
    }

    const backend = new PdfBackend({ fonts: {}, images: { 'gray': jpeg } })
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)

    expect(pdfStr).toContain('/DeviceGray')
    expect(pdfStr).toContain('/DCTDecode')
  })

  it('base64 encoded image', () => {
    const jpeg = createMinimalJpeg(5, 5, 3)
    // Convert to base64
    let binary = ''
    for (let i = 0; i < jpeg.length; i++) binary += String.fromCharCode(jpeg[i]!)
    const base64 = btoa(binary)
    const dataUri = `data:image/jpeg;base64,${base64}`

    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 0, y: 0, width: 50, height: 50, imageId: 'b64',
        }],
      }],
      images: { 'b64': dataUri },
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('/DCTDecode')
  })

  it('SVG image renders as vector paths', () => {
    const svgStr = '<svg viewBox="0 0 100 100" width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/></svg>'
    const svgData = new TextEncoder().encode(svgStr)

    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 50, y: 100, width: 200, height: 150, imageId: 'test-svg',
        }],
      }],
      images: { 'test-svg': svgData },
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)

    // SVG draw with Image XObject with.
    
    expect(pdfStr).not.toContain('/DCTDecode')
    expect(pdfStr).not.toContain('/Im0 Do')
    // red fill path
    expect(pdfStr).toContain('1 0 0 rg')
  })

  it('SVG image can be drawn multiple times with the same imageId', () => {
    const svgStr = '<svg viewBox="0 0 100 100" width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/></svg>'
    const svgData = new TextEncoder().encode(svgStr)

    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [
          { type: 'image', x: 50, y: 100, width: 120, height: 120, imageId: 'test-svg' },
          { type: 'image', x: 220, y: 100, width: 60, height: 60, imageId: 'test-svg' },
        ],
      }],
      images: { 'test-svg': svgData },
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)

    // Draw with Image XObject for with, pathmultiple.
    
    const fillOps = (pdfStr.match(/1 0 0 rg/g) ?? []).length
    expect(fillOps).toBeGreaterThanOrEqual(2)
    expect(pdfStr).not.toContain('/Im0 Do')
  })
})
