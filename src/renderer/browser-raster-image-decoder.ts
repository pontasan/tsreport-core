import { detectImageFormat, normalizeImageData } from '../image/image-utils.js'
import { isExternalImageUrl } from '../resource-reference.js'
import {
  createPureRasterImageDecoder,
  isRasterDecodableFormat,
  isPureRasterImageFormat,
  type DecodedRgbaImage,
  type RasterDecodableFormat,
  type RasterImageDecoder,
} from './raster-image-decoder.js'
import type { RenderDocument } from '../types/render.js'
import {
  forEachRenderDocumentImageReference,
  type RenderImageReference,
} from '../render-image-reference.js'
import { copyImageResourceMap, mergeImageResourceMaps } from '../image-resource-map.js'
import type { PdfBackendOptions } from './pdf-backend.js'
import { collectPdfOptionImageReferences } from '../pdf-option-image-reference.js'

export interface BrowserPdfImageResources {
  images: Record<string, string | Uint8Array>
  rasterImageDecoder: RasterImageDecoder
}

export type BrowserPdfImagePreparationOptions = Pick<PdfBackendOptions, 'images' | 'catalog' | 'collection' | 'pageOptions'>

function toImageBlob(bytes: Uint8Array, format: RasterDecodableFormat): Blob {
  return new Blob([bytes as BlobPart], { type: `image/${format}` })
}

async function decodeRgbaWithBrowserCodec(
  bytes: Uint8Array,
  format: RasterDecodableFormat,
): Promise<DecodedRgbaImage> {
  const bitmap = await createImageBitmap(toImageBlob(bytes, format))
  const canvas = typeof document === 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  return {
    width: imageData.width,
    height: imageData.height,
    pixels: new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.length),
  }
}

class PreDecodedBrowserRasterImageDecoder implements RasterImageDecoder {
  private readonly pureDecoder = createPureRasterImageDecoder()

  constructor(private readonly decoded: Map<Uint8Array, DecodedRgbaImage>) {}

  decodeRgba(data: Uint8Array, format: RasterDecodableFormat): DecodedRgbaImage {
    if (isPureRasterImageFormat(format)) return this.pureDecoder.decodeRgba(data, format)
    const image = this.decoded.get(data)
    if (image === undefined) throw new Error(`Raster image (${format}) was not prepared by the browser decoder`)
    return image
  }
}

/**
 * Decodes referenced WebP and AVIF resources with browser codecs before synchronous PDF rendering.
 * PNG uses the same pure TypeScript decoder as every other runtime.
 * The returned image map preserves the exact byte-array identities used as decoder cache keys.
 */
export async function prepareBrowserPdfImageResources(
  document: RenderDocument,
  options?: BrowserPdfImagePreparationOptions,
): Promise<BrowserPdfImageResources> {
  const images = document.images === undefined
    ? options?.images === undefined ? undefined : copyImageResourceMap(options.images)
    : mergeImageResourceMaps(document.images, options?.images)
  const prepared: Record<string, string | Uint8Array> = {}
  const decoded = new Map<Uint8Array, DecodedRgbaImage>()
  const scheduled = new Set<Uint8Array>()
  const referenced = collectImageIds(document, options)
  const tasks: Promise<void>[] = []

  if (images !== undefined) {
    const keys = Object.keys(images)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!
      const source = images[key]!
      if (!referenced.has(key)) {
        prepared[key] = source
        continue
      }
      if (typeof source === 'string' && isExternalImageUrl(source)) {
        prepared[key] = source
        continue
      }
      const bytes = typeof source === 'string' ? normalizeImageData(source) : source
      prepared[key] = bytes
      const format = detectImageFormat(bytes)
      if (isRasterDecodableFormat(format) && !isPureRasterImageFormat(format) && !scheduled.has(bytes)) {
        scheduled.add(bytes)
        tasks.push(decodeRgbaWithBrowserCodec(bytes, format).then(function (image): void {
          decoded.set(bytes, image)
        }))
      }
    }
  }

  await Promise.all(tasks)
  return { images: prepared, rasterImageDecoder: new PreDecodedBrowserRasterImageDecoder(decoded) }
}

function collectImageIds(
  document: RenderDocument,
  options: BrowserPdfImagePreparationOptions | undefined,
): Set<string> {
  const imageIds = new Set<string>()
  forEachRenderDocumentImageReference(document, addRenderImageReference, imageIds)
  if (options !== undefined) {
    const references = collectPdfOptionImageReferences(options)
    for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex++) {
      imageIds.add(references[referenceIndex]!.imageId)
    }
  }
  return imageIds
}

function addRenderImageReference(reference: RenderImageReference, imageIds: Set<string>): void {
  imageIds.add(reference.imageId)
}
