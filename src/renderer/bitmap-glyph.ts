/**
 * Bitmap glyph preparation shared by the Canvas / PDF / SVG backends.
 *
 * Converts a Font bitmap glyph (sbix / CBDT / EBDT) into an image payload
 * every backend can draw through drawImageData, together with the draw
 * rectangle relative to the glyph origin. Raw EBDT/CBDT bitmaps ("mask")
 * are colorized with the text foreground color and re-encoded as PNG;
 * TIFF sbix graphics are decoded and re-encoded as PNG.
 */

import type { Font, BitmapGlyphRenderData } from '../font.js'
import { parsePngInfo } from '../image/png-parser.js'
import { parseJpegInfo } from '../image/jpeg-parser.js'
import { encodePngRgba } from '../image/png-encoder.js'
import { decodeTiffToRgba } from './tiff-decoder.js'
import { parseForegroundColor } from './colr-v1-renderer.js'

/** Prepared bitmap glyph in strike pixel space (cached per font) */
interface PreparedBitmapGlyph {
  data: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
  ppemX: number
  ppemY: number
  /** Pixel offset from the origin to the bitmap's left edge */
  leftPx: number
  /** Pixel offset from the baseline to the bitmap's top edge (y-up) */
  topPx: number
  widthPx: number
  heightPx: number
  drawOutlines: boolean
}

/** Drawable bitmap glyph scaled to pt, relative to the glyph origin (y-down) */
export interface DrawableBitmapGlyph {
  data: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
  /** Left edge offset from the glyph origin (pt) */
  left: number
  /** Top edge offset from the baseline (pt, y-down: negative above the baseline) */
  top: number
  width: number
  height: number
  /** Whether the font requests its scalable outline over the bitmap. */
  drawOutlines: boolean
}

// Prepared bitmaps cached per font (keyed by glyphId|ppem|color)
const preparedCache = new WeakMap<Font, Map<string, PreparedBitmapGlyph | null>>()

/**
 * Prepares a bitmap glyph for drawing.
 * @param font Font instance
 * @param glyphId Glyph ID
 * @param fontSize Font size in pt (determines the final draw rectangle)
 * @param ppem Requested pixel size for strike selection
 * @param color Text foreground color (applied to mask bitmaps)
 * @returns Drawable payload or null when the font has no bitmap for this glyph
 */
export function prepareBitmapGlyph(
  font: Font,
  glyphId: number,
  fontSize: number,
  ppem: number,
  color: string,
  xPpem = ppem,
  horizontalScale = 1,
  vertical = false,
): DrawableBitmapGlyph | null {
  let cache = preparedCache.get(font)
  if (!cache) {
    cache = new Map()
    preparedCache.set(font, cache)
  }
  const key = `${glyphId}|${xPpem}|${ppem}|${color}|${vertical ? 1 : 0}`
  let prepared = cache.get(key)
  if (prepared === undefined) {
    prepared = buildPreparedBitmapGlyph(font, glyphId, ppem, xPpem, color, vertical)
    cache.set(key, prepared)
  }
  if (!prepared) return null

  const ux = fontSize * horizontalScale / prepared.ppemX
  const uy = fontSize / prepared.ppemY
  return {
    data: prepared.data,
    mimeType: prepared.mimeType,
    left: prepared.leftPx * ux,
    top: -prepared.topPx * uy,
    width: prepared.widthPx * ux,
    height: prepared.heightPx * uy,
    drawOutlines: prepared.drawOutlines,
  }
}

function buildPreparedBitmapGlyph(
  font: Font,
  glyphId: number,
  ppemY: number,
  ppemX: number,
  color: string,
  vertical: boolean,
): PreparedBitmapGlyph | null {
  const bg = font.getBitmapGlyphRender(glyphId, ppemY, ppemX, { vertical })
  if (!bg) return null

  // Prefer scalable outlines over monochrome embedded bitmaps ('mask', e.g.
  // EBDT): those are small-size screen hints, so they are only used for
  // bitmap-only fonts. Color bitmaps (sbix/CBDT PNG/JPEG) are always used.
  if (bg.image === 'mask' && font.hasScalableOutlines) return null

  let data = bg.data
  let mimeType: 'image/png' | 'image/jpeg'
  let widthPx = bg.width
  let heightPx = bg.height

  switch (bg.image) {
    case 'png': {
      const info = parsePngInfo(data)
      if (widthPx !== 0 && (info.width !== widthPx || info.height !== heightPx)) {
        throw new Error(`CBDT PNG dimensions ${info.width}x${info.height} do not match metrics ${widthPx}x${heightPx}`)
      }
      widthPx = info.width
      heightPx = info.height
      mimeType = 'image/png'
      break
    }
    case 'jpeg': {
      const info = parseJpegInfo(data)
      widthPx = info.width
      heightPx = info.height
      mimeType = 'image/jpeg'
      break
    }
    case 'tiff': {
      const decoded = decodeTiffToRgba(data)
      widthPx = decoded.width
      heightPx = decoded.height
      data = encodePngRgba(decoded.width, decoded.height, decoded.data)
      mimeType = 'image/png'
      break
    }
    case 'mask': {
      if (widthPx <= 0 || heightPx <= 0) return null
      const rgba = maskToRgba(bg, color)
      data = encodePngRgba(widthPx, heightPx, rgba)
      mimeType = 'image/png'
      break
    }
    case 'bgra': {
      if (widthPx <= 0 || heightPx <= 0) return null
      data = encodePngRgba(widthPx, heightPx, bgraToRgba(data, widthPx, heightPx))
      mimeType = 'image/png'
      break
    }
  }

  if (widthPx <= 0 || heightPx <= 0) return null

  return {
    data,
    mimeType,
    ppemX: bg.ppemX,
    ppemY: bg.ppemY,
    leftPx: bg.bearingX,
    topPx: bg.bottom + heightPx,
    widthPx,
    heightPx,
    drawOutlines: bg.drawOutlines === true,
  }
}

function bgraToRgba(data: Uint8Array, width: number, height: number): Uint8Array {
  const pixelCount = width * height
  const required = pixelCount * 4
  if (data.length < required) throw new Error('CBDT BGRA data is shorter than its bitmap metrics require')
  const rgba = new Uint8Array(required)
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    const alpha = data[offset + 3]!
    if (alpha !== 0) {
      rgba[offset] = Math.min(255, Math.round(data[offset + 2]! * 255 / alpha))
      rgba[offset + 1] = Math.min(255, Math.round(data[offset + 1]! * 255 / alpha))
      rgba[offset + 2] = Math.min(255, Math.round(data[offset]! * 255 / alpha))
    }
    rgba[offset + 3] = alpha
  }
  return rgba
}

/**
 * Decodes an EBDT/CBDT raw bitmap into RGBA colorized with the foreground.
 * Byte-aligned rows pad each row to a byte boundary; bit-aligned rows form
 * one continuous bit stream. Pixel values scale linearly to alpha.
 */
function maskToRgba(bg: BitmapGlyphRenderData, color: string): Uint8Array {
  const width = bg.width
  const height = bg.height
  const depth = bg.bitDepth!
  const bitAligned = bg.bitAligned === true
  const src = bg.data
  const fg = parseForegroundColor(color)
  const r = Math.round(fg.r * 255)
  const g = Math.round(fg.g * 255)
  const b = Math.round(fg.b * 255)

  // Linear scale from a depth-limited value to 0-255
  const maxValue = (1 << depth) - 1
  const alphaScale = 255 / maxValue

  const out = new Uint8Array(width * height * 4)
  const rowBits = width * depth
  const rowBytes = (rowBits + 7) >> 3

  for (let y = 0; y < height; y++) {
    const rowStartBit = bitAligned ? y * rowBits : y * rowBytes * 8
    for (let x = 0; x < width; x++) {
      const bitPos = rowStartBit + x * depth
      const bytePos = bitPos >> 3
      if (bytePos >= src.length) break
      let value: number
      if (depth === 8) {
        value = src[bytePos]!
      } else {
        // Big-endian bit order within each byte
        const shift = 8 - depth - (bitPos & 7)
        value = (src[bytePos]! >> shift) & maxValue
      }
      const alpha = Math.round(value * alphaScale * fg.a)
      const o = (y * width + x) * 4
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = alpha
    }
  }
  return out
}
