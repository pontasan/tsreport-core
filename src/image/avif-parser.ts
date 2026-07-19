import { decodeRasterWithExternalDecoder } from './external-image-decoder.js'
import type { DecodedImage } from './webp-parser.js'

export interface AvifCicpInfo {
  colorPrimaries?: number
  transferCharacteristics?: number
  matrixCoefficients?: number
  colorRange?: number
}

export interface AvifContentLightLevelInfo {
  maxContentLightLevel: number
  maxPicAverageLightLevel: number
}

export interface AvifMasteringDisplayColorVolumeInfo {
  displayPrimariesX: [number, number, number]
  displayPrimariesY: [number, number, number]
  whitePointX: number
  whitePointY: number
  maxDisplayMasteringLuminance: number
  minDisplayMasteringLuminance: number
}

export interface AvifInfo {
  width: number
  height: number
  hasAlpha: boolean
  bitDepth?: number
  cicp?: AvifCicpInfo
  iccProfile?: Uint8Array
  exif?: Uint8Array
  xmp?: Uint8Array
  clli?: AvifContentLightLevelInfo
  mdcv?: AvifMasteringDisplayColorVolumeInfo
  hasGainMap?: boolean
  isAnimated?: boolean
  frameCount?: number
  durationInTimescale?: number
  durationTimescale?: number
  durationSeconds?: number
}

export interface AvifDecodeOptions {
  frameIndex?: number
  gainMapHdrHeadroom?: number
  applyTransferCharacteristics?: boolean
  outputTransferCharacteristics?: number
}

export interface DecodedAvifImage extends DecodedImage {
  cicp?: AvifCicpInfo
  iccProfile?: Uint8Array
  exif?: Uint8Array
  xmp?: Uint8Array
  clli?: AvifContentLightLevelInfo
  mdcv?: AvifMasteringDisplayColorVolumeInfo
  hasGainMap?: boolean
}

function readU32BE(data: Uint8Array, offset: number): number {
  return ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0
}

/**
 * Find a box by four-character type inside [start, end).
 * Returns payload bounds, or null when absent.
 */
function findBox(data: Uint8Array, start: number, end: number, type: string): { start: number, end: number } | null {
  const t0 = type.charCodeAt(0)
  const t1 = type.charCodeAt(1)
  const t2 = type.charCodeAt(2)
  const t3 = type.charCodeAt(3)
  let offset = start
  while (offset + 8 <= end) {
    let size = readU32BE(data, offset)
    let headerSize = 8
    if (size === 1) {
      // 64-bit largesize: high 32 bits must be zero for in-memory data
      if (offset + 16 > end || readU32BE(data, offset + 8) !== 0) return null
      size = readU32BE(data, offset + 12)
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerSize || offset + size > end) return null
    if (data[offset + 4] === t0 && data[offset + 5] === t1 && data[offset + 6] === t2 && data[offset + 7] === t3) {
      return { start: offset + headerSize, end: offset + size }
    }
    offset += size
  }
  return null
}

/**
 * Parse AVIF (ISOBMFF) structure metadata: dimensions from the ispe
 * property, bit depth from av1C, alpha presence from auxC, and CICP
 * from the colr(nclx) property. Pure TypeScript.
 */
export function parseAvifInfo(data: Uint8Array): AvifInfo {
  const ftyp = findBox(data, 0, data.length, 'ftyp')
  if (!ftyp) throw new Error('AVIF: missing ftyp box')

  const meta = findBox(data, 0, data.length, 'meta')
  if (!meta) throw new Error('AVIF: missing meta box')
  const metaPayload = meta.start + 4 // FullBox: version(1) + flags(3)

  const iprp = findBox(data, metaPayload, meta.end, 'iprp')
  if (!iprp) throw new Error('AVIF: missing iprp box')
  const ipco = findBox(data, iprp.start, iprp.end, 'ipco')
  if (!ipco) throw new Error('AVIF: missing ipco box')

  const ispe = findBox(data, ipco.start, ipco.end, 'ispe')
  if (!ispe || ispe.end - ispe.start < 12) throw new Error('AVIF: missing ispe box')
  const width = readU32BE(data, ispe.start + 4)
  const height = readU32BE(data, ispe.start + 8)
  if (width === 0 || height === 0) throw new Error('AVIF: invalid dimensions')

  const info: AvifInfo = { width, height, hasAlpha: false }

  // Alpha auxiliary image: auxC property with an "...:alpha" aux_type URN
  const auxC = findBox(data, ipco.start, ipco.end, 'auxC')
  if (auxC) {
    let text = ''
    for (let i = auxC.start + 4; i < auxC.end && data[i] !== 0; i++) text += String.fromCharCode(data[i]!)
    info.hasAlpha = text.indexOf('alpha') !== -1
  }

  // Bit depth from the AV1 codec configuration
  const av1C = findBox(data, ipco.start, ipco.end, 'av1C')
  if (av1C && av1C.end - av1C.start >= 3) {
    const byte2 = data[av1C.start + 2]!
    const highBitdepth = (byte2 & 0x40) !== 0
    const twelveBit = (byte2 & 0x20) !== 0
    info.bitDepth = highBitdepth ? (twelveBit ? 12 : 10) : 8
  }

  // CICP from colr box with colour_type 'nclx'
  const colr = findBox(data, ipco.start, ipco.end, 'colr')
  if (colr && colr.end - colr.start >= 11 &&
      data[colr.start] === 0x6E && data[colr.start + 1] === 0x63 &&
      data[colr.start + 2] === 0x6C && data[colr.start + 3] === 0x78) {
    info.cicp = {
      colorPrimaries: (data[colr.start + 4]! << 8) | data[colr.start + 5]!,
      transferCharacteristics: (data[colr.start + 6]! << 8) | data[colr.start + 7]!,
      matrixCoefficients: (data[colr.start + 8]! << 8) | data[colr.start + 9]!,
      colorRange: (data[colr.start + 10]! & 0x80) !== 0 ? 1 : 0,
    }
  }

  // Animated AVIF: 'avis' in the ftyp brands
  for (let off = ftyp.start; off + 4 <= ftyp.end; off += 4) {
    if (data[off] === 0x61 && data[off + 1] === 0x76 && data[off + 2] === 0x69 && data[off + 3] === 0x73) {
      info.isAnimated = true
      break
    }
  }

  return info
}

/**
 * Legacy API compatibility: extracting the primary AV1 payload from an AVIF container is not provided in tsreport
 */
export function extractPrimaryAv1Payload(_data: Uint8Array): Uint8Array {
  throw new Error('AVIF: extractPrimaryAv1Payload is not available in tsreport (moved to tsdecoder)')
}

/**
 * Decode an AVIF as RGBA 8-bit
 */
export function decodeAvif(data: Uint8Array, options: AvifDecodeOptions = {}): DecodedAvifImage {
  if (options.frameIndex !== undefined && options.frameIndex !== 0) {
    throw new Error(`AVIF: frame index out of range (${options.frameIndex})`)
  }
  if (options.gainMapHdrHeadroom !== undefined) {
    throw new Error('AVIF: gain map tone mapping is not available in tsreport (moved to tsdecoder)')
  }
  if (options.applyTransferCharacteristics || options.outputTransferCharacteristics !== undefined) {
    throw new Error('AVIF: transfer characteristics controls are not available in tsreport (moved to tsdecoder)')
  }

  const decoded = decodeRasterWithExternalDecoder(data, 'avif')
  return {
    width: decoded.width,
    height: decoded.height,
    pixels: decoded.pixels,
  }
}
