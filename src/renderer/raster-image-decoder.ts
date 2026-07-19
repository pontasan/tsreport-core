import { decodeRasterWithExternalDecoder } from '../image/external-image-decoder.js'
import { decodePng } from '../image/png-parser.js'
import type { DecodableRasterImageFormat } from './image-resource.js'

export type RasterDecodableFormat = DecodableRasterImageFormat

export interface DecodedRgbaImage {
  width: number
  height: number
  pixels: Uint8Array
}

/**
 * Raster decoder port used by the PDF backend.
 * Implementations are swappable, e.g. pure TypeScript / Node external / Browser native.
 */
export interface RasterImageDecoder {
  decodeRgba(data: Uint8Array, format: RasterDecodableFormat): DecodedRgbaImage
}

export function isPureRasterImageFormat(format: RasterDecodableFormat): format is 'png' {
  return format === 'png'
}

export function isRasterDecodableFormat(format: string): format is RasterDecodableFormat {
  return format === 'png' || format === 'webp' || format === 'avif'
}

/**
 * Default decoder: pure TypeScript, no runtime dependency.
 * PNG is decoded in-process. WebP/AVIF have no built-in decoder; inject one
 * via setDefaultRasterImageDecoder() or PdfBackendOptions.rasterImageDecoder
 * (e.g. createNodeExternalRasterImageDecoder() backed by the optional "sharp"
 * package, or pre-decoded RGBA supplied by browser codecs).
 */
class PureRasterImageDecoder implements RasterImageDecoder {
  decodeRgba(data: Uint8Array, format: RasterDecodableFormat): DecodedRgbaImage {
    if (format === 'png') {
      const decoded = decodePng(data)
      return { width: decoded.width, height: decoded.height, pixels: decoded.pixels }
    }
    throw new Error(
      `Image: no decoder available for ${format}. ` +
      'Inject a RasterImageDecoder (e.g. createNodeExternalRasterImageDecoder() with the optional "sharp" package installed) ' +
      'via setDefaultRasterImageDecoder() or PdfBackendOptions.rasterImageDecoder.',
    )
  }
}

/**
 * Node-only decoder that shells out to the optional "sharp" package.
 * Requires "sharp" to be installed in the consuming application.
 */
class NodeExternalRasterImageDecoder implements RasterImageDecoder {
  private readonly pureDecoder = new PureRasterImageDecoder()

  decodeRgba(data: Uint8Array, format: RasterDecodableFormat): DecodedRgbaImage {
    if (isPureRasterImageFormat(format)) return this.pureDecoder.decodeRgba(data, format)
    const decoded = decodeRasterWithExternalDecoder(data, format)
    return {
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.pixels,
    }
  }
}

let defaultDecoder: RasterImageDecoder | null = null

export function createPureRasterImageDecoder(): RasterImageDecoder {
  return new PureRasterImageDecoder()
}

export function createNodeExternalRasterImageDecoder(): RasterImageDecoder {
  return new NodeExternalRasterImageDecoder()
}

/**
 * Replace the process-wide default raster decoder used by PdfBackend
 * when PdfBackendOptions.rasterImageDecoder is not specified.
 */
export function setDefaultRasterImageDecoder(decoder: RasterImageDecoder | null): void {
  defaultDecoder = decoder
}

export function getDefaultRasterImageDecoder(): RasterImageDecoder {
  if (!defaultDecoder) defaultDecoder = new PureRasterImageDecoder()
  return defaultDecoder
}
