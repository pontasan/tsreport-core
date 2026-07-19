import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareBrowserPdfImageResources } from '../../src/browser.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'
import type { RenderDocument, RenderImage } from '../../src/types/render.js'

const PNG_RGBA = Uint8Array.from([10, 127, 240, 31, 200, 33, 99, 128])
const PNG_BYTES = encodePngRgba(2, 1, PNG_RGBA)
const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
])
const RGBA = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80])

function makeDocument(
  images: Record<string, string | Uint8Array> | undefined,
  imageId?: string,
): RenderDocument {
  return {
    images,
    pages: [{
      width: 100,
      height: 100,
      children: imageId === undefined ? [] : [{ type: 'image', x: 0, y: 0, width: 10, height: 10, imageId }],
    }],
  }
}

class TestOffscreenCanvas {
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext(): OffscreenCanvasRenderingContext2D {
    return {
      drawImage: vi.fn(),
      getImageData: vi.fn(function (): ImageData {
        return { width: 2, height: 1, data: RGBA, colorSpace: 'srgb' }
      }),
    } as unknown as OffscreenCanvasRenderingContext2D
  }
}

afterEach(function (): void {
  vi.unstubAllGlobals()
})

describe('browser raster image decoder', function (): void {
  it('decodes PNG with the pure TypeScript path without premultiplying alpha', async function (): Promise<void> {
    const createImageBitmapMock = vi.fn()
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)

    const result = await prepareBrowserPdfImageResources(makeDocument({ logo: PNG_BYTES }, 'logo'))
    const prepared = result.images.logo as Uint8Array
    const decoded = result.rasterImageDecoder.decodeRgba(prepared, 'png')

    expect(prepared).toBe(PNG_BYTES)
    expect(createImageBitmapMock).not.toHaveBeenCalled()
    expect(decoded).toEqual({ width: 2, height: 1, pixels: PNG_RGBA })
  })

  it('pre-decodes WebP resources and serves the cached RGBA synchronously', async function (): Promise<void> {
    const close = vi.fn()
    const createImageBitmapMock = vi.fn(async function (): Promise<ImageBitmap> {
      return { width: 2, height: 1, close } as ImageBitmap
    })
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)

    const result = await prepareBrowserPdfImageResources(makeDocument({ logo: WEBP_BYTES }, 'logo'))
    const prepared = result.images.logo as Uint8Array
    const decoded = result.rasterImageDecoder.decodeRgba(prepared, 'webp')

    expect(prepared).toBe(WEBP_BYTES)
    expect(createImageBitmapMock).toHaveBeenCalledOnce()
    expect((createImageBitmapMock.mock.calls[0]![0] as Blob).type).toBe('image/webp')
    expect(decoded).toEqual({
      width: 2,
      height: 1,
      pixels: new Uint8Array(RGBA.buffer, RGBA.byteOffset, RGBA.length),
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('pre-decodes a WebP resource referenced only as an alternate image', async function (): Promise<void> {
    const createImageBitmapMock = vi.fn(async function (): Promise<ImageBitmap> {
      return { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap
    })
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const document = makeDocument({ main: PNG_BYTES, alternate: WEBP_BYTES }, 'main')
    const image = document.pages[0]!.children[0] as RenderImage
    image.alternates = [{ imageId: 'alternate' }]

    await prepareBrowserPdfImageResources(document)
    expect(createImageBitmapMock).toHaveBeenCalledOnce()
  })

  it('pre-decodes a WebP resource referenced only from soft-mask content', async function (): Promise<void> {
    const createImageBitmapMock = vi.fn(async function (): Promise<ImageBitmap> {
      return { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap
    })
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const document = makeDocument({ mask: WEBP_BYTES })
    document.pages[0]!.children = [{
      type: 'group',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      children: [],
      softMask: {
        type: 'alpha',
        content: [{ type: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'mask' }],
      },
    }]

    await prepareBrowserPdfImageResources(document)
    expect(createImageBitmapMock).toHaveBeenCalledOnce()
  })

  it('pre-decodes a WebP resource referenced from a nested tiling-pattern soft mask', async function (): Promise<void> {
    const createImageBitmapMock = vi.fn(async function (): Promise<ImageBitmap> {
      return { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap
    })
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const document = makeDocument({ tile: WEBP_BYTES })
    document.pages[0]!.children = [{
      type: 'path', commands: new Uint8Array(), coords: new Float32Array(),
      fill: {
        type: 'tiling-pattern', bbox: [0, 0, 10, 10], xStep: 10, yStep: 10,
        matrix: [1, 0, 0, 1, 0, 0],
        graphics: [{ kind: 'group', x: 0, y: 0, width: 10, height: 10, graphics: [], softMask: {
          type: 'alpha', graphics: [{ kind: 'image', x: 0, y: 0, width: 10, height: 10, imageId: 'tile' }],
        } }],
      },
    }]
    await prepareBrowserPdfImageResources(document)
    expect(createImageBitmapMock).toHaveBeenCalledOnce()
  })

  it('pre-decodes WebP resources referenced only by PDF options', async function (): Promise<void> {
    const createImageBitmapMock = vi.fn(async function (): Promise<ImageBitmap> {
      return { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap
    })
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    await prepareBrowserPdfImageResources(makeDocument(undefined), {
      images: {
        spider: Uint8Array.from(WEBP_BYTES),
        folder: Uint8Array.from(WEBP_BYTES),
        page: Uint8Array.from(WEBP_BYTES),
      },
      catalog: {
        spiderInfo: { version: 1, contentSets: [{ identifier: new Uint8Array(), objects: [{ kind: 'image', imageId: 'spider' }], sources: [] }] },
      },
      collection: { view: 'D', folders: { id: 0, name: 'root', thumbnailImageId: 'folder' } },
      pageOptions: [{ thumbnailImageId: 'page' }],
    })
    expect(createImageBitmapMock).toHaveBeenCalledTimes(3)
  })

  it('preserves external image URLs without scheduling a pixel decode', async function (): Promise<void> {
    const createImageBitmapMock = vi.fn()
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)

    const source = 'https://example.test/image.webp'
    const result = await prepareBrowserPdfImageResources(makeDocument({ remote: source }, 'remote'))

    expect(result.images.remote).toBe(source)
    expect(createImageBitmapMock).not.toHaveBeenCalled()
  })

  it('rejects byte arrays that were not part of the prepared resource set', async function (): Promise<void> {
    const result = await prepareBrowserPdfImageResources(makeDocument(undefined))
    expect(function (): void {
      result.rasterImageDecoder.decodeRgba(WEBP_BYTES, 'webp')
    }).toThrow('Raster image (webp) was not prepared by the browser decoder')
  })

  it('does not decode an unreferenced malformed AVIF resource', async function (): Promise<void> {
    const createImageBitmapMock = vi.fn()
    vi.stubGlobal('createImageBitmap', createImageBitmapMock)
    const malformedAvif = Uint8Array.from([
      0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70,
      0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0,
    ])
    const result = await prepareBrowserPdfImageResources(makeDocument({ logo: PNG_BYTES, unused: malformedAvif }, 'logo'))
    expect(result.images.unused).toBe(malformedAvif)
    expect(createImageBitmapMock).not.toHaveBeenCalled()
  })

  it('preserves an unreferenced encoded string without normalizing it', async function (): Promise<void> {
    const encoded = 'data:image/avif;base64,AAAA'
    const result = await prepareBrowserPdfImageResources(makeDocument({ unused: encoded }))
    expect(result.images.unused).toBe(encoded)
  })
})
