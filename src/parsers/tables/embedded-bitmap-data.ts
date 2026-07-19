import { BinaryReader } from '../../binary/reader.js'
import {
  findGlyphBitmapOffset,
  readBigGlyphMetrics,
  readSmallGlyphMetrics,
  type BitmapGlyphData,
  type BitmapMetrics,
  type BitmapSizeRecord,
} from './bitmap-index.js'

/** Reads one EBDT/CBDT glyph, including nested composite glyphs. */
export function readEmbeddedBitmapGlyph(
  locationReader: BinaryReader,
  dataReader: BinaryReader,
  strike: BitmapSizeRecord,
  glyphId: number,
  allowPng: boolean,
): BitmapGlyphData | null {
  return readGlyph(locationReader, dataReader, strike, glyphId, allowPng, [])
}

function readGlyph(
  locationReader: BinaryReader,
  dataReader: BinaryReader,
  strike: BitmapSizeRecord,
  glyphId: number,
  allowPng: boolean,
  compositeStack: number[],
): BitmapGlyphData | null {
  const loc = findGlyphBitmapOffset(locationReader, strike, glyphId)
  if (loc === null || loc.imageDataSize === 0) return null
  if (loc.imageDataOffset > dataReader.length || loc.imageDataSize > dataReader.length - loc.imageDataOffset) {
    throw new Error(`Embedded bitmap glyph ${glyphId} data exceeds its table`)
  }
  dataReader.seek(loc.imageDataOffset)

  switch (loc.imageFormat) {
    case 1:
    case 2: {
      requireSize(loc.imageDataSize, 5, loc.imageFormat)
      const metrics = readSmallMetrics(dataReader, strike.flags)
      const data = dataReader.readBytes(loc.imageDataSize - 5)
      validatePackedBitmapSize(data.length, metrics, strike.bitDepth, loc.imageFormat === 2, loc.imageFormat)
      return { data, format: loc.imageFormat, metrics }
    }
    case 5: {
      if (loc.indexFormat !== 2 && loc.indexFormat !== 5) {
        throw new Error('Embedded bitmap format 5 requires index subtable format 2 or 5')
      }
      if (loc.metrics === null) throw new Error('Embedded bitmap format 5 requires location-table metrics')
      const data = dataReader.readBytes(loc.imageDataSize)
      validatePackedBitmapSize(data.length, loc.metrics, strike.bitDepth, true, 5)
      return { data, format: 5, metrics: loc.metrics }
    }
    case 6:
    case 7: {
      requireSize(loc.imageDataSize, 8, loc.imageFormat)
      const metrics = readBigGlyphMetrics(dataReader)
      const data = dataReader.readBytes(loc.imageDataSize - 8)
      validatePackedBitmapSize(data.length, metrics, strike.bitDepth, loc.imageFormat === 7, loc.imageFormat)
      return { data, format: loc.imageFormat, metrics }
    }
    case 8:
    case 9:
      return readComposite(locationReader, dataReader, strike, glyphId, allowPng, compositeStack, loc.imageFormat, loc.imageDataSize)
    case 17: {
      if (!allowPng) throw new Error('EBDT does not support image format 17')
      requireSize(loc.imageDataSize, 9, 17)
      const metrics = readSmallMetrics(dataReader, strike.flags)
      const data = readPngPayload(dataReader, loc.imageDataSize - 5, 17)
      return { data, format: 17, metrics }
    }
    case 18: {
      if (!allowPng) throw new Error('EBDT does not support image format 18')
      requireSize(loc.imageDataSize, 12, 18)
      const metrics = readBigGlyphMetrics(dataReader)
      const data = readPngPayload(dataReader, loc.imageDataSize - 8, 18)
      return { data, format: 18, metrics }
    }
    case 19: {
      if (!allowPng) throw new Error('EBDT does not support image format 19')
      if (loc.indexFormat !== 2 && loc.indexFormat !== 5) {
        throw new Error('CBDT format 19 requires index subtable format 2 or 5')
      }
      if (loc.metrics === null) throw new Error('CBDT format 19 requires location-table metrics')
      requireSize(loc.imageDataSize, 4, 19)
      const data = readPngPayload(dataReader, loc.imageDataSize, 19)
      return { data, format: 19, metrics: loc.metrics }
    }
    default:
      throw new Error(`Unsupported embedded bitmap image format ${loc.imageFormat}`)
  }
}

function readComposite(
  locationReader: BinaryReader,
  dataReader: BinaryReader,
  strike: BitmapSizeRecord,
  glyphId: number,
  allowPng: boolean,
  compositeStack: number[],
  format: 8 | 9,
  imageDataSize: number,
): BitmapGlyphData {
  for (let i = 0; i < compositeStack.length; i++) {
    if (compositeStack[i] === glyphId) throw new Error(`Embedded bitmap composite cycle at glyph ${glyphId}`)
  }
  compositeStack.push(glyphId)

  const headerSize = format === 8 ? 8 : 10
  requireSize(imageDataSize, headerSize, format)
  let metrics: BitmapMetrics
  if (format === 8) {
    metrics = readSmallMetrics(dataReader, strike.flags)
    if (dataReader.readUint8() !== 0) throw new Error('Embedded bitmap format 8 pad byte must be zero')
  } else {
    metrics = readBigGlyphMetrics(dataReader)
  }
  const numComponents = dataReader.readUint16()
  if (imageDataSize !== headerSize + numComponents * 4) {
    throw new Error(`Embedded bitmap format ${format} component array length is invalid`)
  }

  const componentGlyphs = new Uint16Array(numComponents)
  const componentX = new Int8Array(numComponents)
  const componentY = new Int8Array(numComponents)
  for (let i = 0; i < numComponents; i++) {
    componentGlyphs[i] = dataReader.readUint16()
    componentX[i] = dataReader.readInt8()
    componentY[i] = dataReader.readInt8()
  }

  const rowBytes = Math.ceil(metrics.width * strike.bitDepth / 8)
  const canvas = new Uint8Array(rowBytes * metrics.height)
  for (let i = 0; i < numComponents; i++) {
    const componentGlyph = componentGlyphs[i]!
    const sub = readGlyph(locationReader, dataReader, strike, componentGlyph, allowPng, compositeStack)
    if (sub === null) throw new Error(`Embedded bitmap composite component glyph ${componentGlyph} has no bitmap`)
    if (sub.format === 17 || sub.format === 18 || sub.format === 19) {
      throw new Error('Embedded bitmap PNG glyphs cannot be composite components')
    }
    drawComponent(canvas, rowBytes, metrics, sub, componentX[i]!, componentY[i]!, strike.bitDepth)
  }
  compositeStack.pop()
  return { data: canvas, format: format === 8 ? 1 : 6, metrics }
}

function readSmallMetrics(reader: BinaryReader, flags: 1 | 2 | 3): BitmapMetrics {
  const metrics = readSmallGlyphMetrics(reader)
  if (flags !== 2) return metrics
  return {
    height: metrics.height,
    width: metrics.width,
    horiBearingX: 0,
    horiBearingY: 0,
    horiAdvance: 0,
    vertBearingX: metrics.horiBearingY,
    vertBearingY: metrics.horiBearingX,
    vertAdvance: metrics.horiAdvance,
  }
}

function readPngPayload(reader: BinaryReader, remainingSize: number, format: number): Uint8Array {
  const dataLength = reader.readUint32()
  if (dataLength > remainingSize - 4) {
    throw new Error(`CBDT format ${format} PNG length does not match the location table`)
  }
  const data = reader.readBytes(dataLength)
  const paddingLength = remainingSize - 4 - dataLength
  for (let i = 0; i < paddingLength; i++) {
    if (reader.readUint8() !== 0) throw new Error(`CBDT format ${format} padding must be zero`)
  }
  return data
}

function requireSize(actual: number, minimum: number, format: number): void {
  if (actual < minimum) throw new Error(`Embedded bitmap format ${format} data is truncated`)
}

function validatePackedBitmapSize(
  actual: number,
  metrics: BitmapMetrics,
  bitDepth: number,
  bitAligned: boolean,
  format: number,
): void {
  const expected = bitAligned
    ? Math.ceil(metrics.width * metrics.height * bitDepth / 8)
    : Math.ceil(metrics.width * bitDepth / 8) * metrics.height
  if (actual < expected) {
    throw new Error(`Embedded bitmap format ${format} data length ${actual} is shorter than its metrics require (${expected})`)
  }
}

function drawComponent(
  canvas: Uint8Array,
  rowBytes: number,
  parent: BitmapMetrics,
  sub: BitmapGlyphData,
  dx: number,
  dy: number,
  bitDepth: number,
): void {
  const bitAligned = sub.format === 2 || sub.format === 5 || sub.format === 7
  if (bitDepth === 32) {
    drawBgraComponent(canvas, rowBytes, parent, sub, dx, dy, bitAligned)
    return
  }
  const maxValue = (1 << bitDepth) - 1
  for (let y = 0; y < sub.metrics.height; y++) {
    const py = dy + y
    if (py < 0 || py >= parent.height) continue
    for (let x = 0; x < sub.metrics.width; x++) {
      const px = dx + x
      if (px < 0 || px >= parent.width) continue
      const source = readPackedPixel(sub.data, sub.metrics.width, bitDepth, bitAligned, x, y)
      if (source === 0) continue
      const target = readPackedPixel(canvas, parent.width, bitDepth, false, px, py)
      const composed = source + Math.round(target * (maxValue - source) / maxValue)
      writePackedPixel(canvas, parent.width, bitDepth, px, py, composed)
    }
  }
}

function drawBgraComponent(
  canvas: Uint8Array,
  rowBytes: number,
  parent: BitmapMetrics,
  sub: BitmapGlyphData,
  dx: number,
  dy: number,
  bitAligned: boolean,
): void {
  const subRowBytes = bitAligned ? sub.metrics.width * 4 : Math.ceil(sub.metrics.width * 32 / 8)
  for (let y = 0; y < sub.metrics.height; y++) {
    const py = dy + y
    if (py < 0 || py >= parent.height) continue
    for (let x = 0; x < sub.metrics.width; x++) {
      const px = dx + x
      if (px < 0 || px >= parent.width) continue
      const sourceOffset = y * subRowBytes + x * 4
      const targetOffset = py * rowBytes + px * 4
      const alpha = sub.data[sourceOffset + 3]!
      const inverse = 255 - alpha
      canvas[targetOffset] = sub.data[sourceOffset]! + Math.round(canvas[targetOffset]! * inverse / 255)
      canvas[targetOffset + 1] = sub.data[sourceOffset + 1]! + Math.round(canvas[targetOffset + 1]! * inverse / 255)
      canvas[targetOffset + 2] = sub.data[sourceOffset + 2]! + Math.round(canvas[targetOffset + 2]! * inverse / 255)
      canvas[targetOffset + 3] = alpha + Math.round(canvas[targetOffset + 3]! * inverse / 255)
    }
  }
}

function readPackedPixel(
  data: Uint8Array,
  width: number,
  bitDepth: number,
  bitAligned: boolean,
  x: number,
  y: number,
): number {
  const rowBits = width * bitDepth
  const bit = bitAligned ? y * rowBits + x * bitDepth : y * Math.ceil(rowBits / 8) * 8 + x * bitDepth
  return (data[bit >> 3]! >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1)
}

function writePackedPixel(data: Uint8Array, width: number, bitDepth: number, x: number, y: number, value: number): void {
  const rowBits = width * bitDepth
  const bit = y * Math.ceil(rowBits / 8) * 8 + x * bitDepth
  const shift = 8 - bitDepth - (bit & 7)
  const mask = ((1 << bitDepth) - 1) << shift
  data[bit >> 3] = (data[bit >> 3]! & ~mask) | ((value << shift) & mask)
}
