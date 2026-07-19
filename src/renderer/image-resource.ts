import { detectImageFormat, normalizeImageData } from '../image/image-utils.js'
import { isExternalImageUrl } from '../resource-reference.js'

export type RasterImageFormat = 'jpeg' | 'png' | 'webp' | 'avif'
export type DecodableRasterImageFormat = Exclude<RasterImageFormat, 'jpeg'>
export type PdfPassthroughImageFormat = 'jpx' | 'jbig2'

export interface MissingImageResource {
  kind: 'missing'
}

export interface UnsupportedImageResource {
  kind: 'unsupported'
}

export interface ExternalUrlImageResource {
  kind: 'external-url'
  url: string
}

export interface SvgImageResource {
  kind: 'svg'
  data: Uint8Array
}

export interface RasterImageResource {
  kind: 'raster'
  data: Uint8Array
  format: RasterImageFormat
}

export interface PdfPassthroughImageResource {
  kind: 'pdf-passthrough'
  data: Uint8Array
  format: PdfPassthroughImageFormat
}

export type ResolvedImageResource =
  | MissingImageResource
  | UnsupportedImageResource
  | ExternalUrlImageResource
  | SvgImageResource
  | RasterImageResource
  | PdfPassthroughImageResource

export function resolveImageResource(
  images: Record<string, string | Uint8Array>,
  imageId: string,
): ResolvedImageResource {
  const source = images[imageId]
  if (!source) return { kind: 'missing' }

  if (typeof source === 'string' && isExternalImageUrl(source)) {
    return { kind: 'external-url', url: source }
  }

  const data = normalizeImageData(source)
  const format = detectImageFormat(data)
  if (format === 'svg') return { kind: 'svg', data }
  if (format === 'jpeg' || format === 'png' || format === 'webp' || format === 'avif') {
    return { kind: 'raster', data, format }
  }
  if (format === 'jpx' || format === 'jbig2') {
    return { kind: 'pdf-passthrough', data, format }
  }
  const hinted = hintedPdfPassthroughFormat(imageId)
  if (hinted !== null) return { kind: 'pdf-passthrough', data, format: hinted }
  return { kind: 'unsupported' }
}

function hintedPdfPassthroughFormat(imageId: string): PdfPassthroughImageFormat | null {
  const lower = imageId.toLowerCase()
  if (lower.endsWith('.jp2') || lower.endsWith('.j2k') || lower.endsWith('.jpx') || lower.endsWith('_jp2') || lower.endsWith('_j2k') || lower.endsWith('_jpx')) {
    return 'jpx'
  }
  if (lower.endsWith('.jbig2') || lower.endsWith('.jb2') || lower.endsWith('_jbig2') || lower.endsWith('_jb2')) {
    return 'jbig2'
  }
  return null
}
