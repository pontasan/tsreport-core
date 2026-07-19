/**
 * WOFF2 (Web Open Font Format 2.0) parser
 * Handles Brotli compression + WOFF2 table transforms
 *
 * Brotli compression and WOFF2 table transforms are implemented in TypeScript.
 */
import { BinaryReader } from '../binary/reader.js'
import { BinaryWriter } from '../binary/writer.js'
import { brotliCompressWoff2, brotliDecompress } from '../compression/brotli.js'
import type { SfntData, WoffMetadataDocument } from '../types/index.js'
import { parseWoffMetadata } from './woff-metadata.js'
import { parseSfntDirectory } from './sfnt-parser.js'

// WOFF2 Known table tags (spec table)
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]

export interface Woff2WriteOptions {
  majorVersion?: number
  minorVersion?: number
  metadata?: string
  privateData?: Uint8Array
}

interface Woff2TableEntry {
  tag: string
  origLength: number
  transformVersion: number
  transformLength: number | null
}

interface Woff2CollectionFontEntry {
  flavor: number
  tableIndices: number[]
}

interface Woff2CollectionDirectory {
  version: number
  fonts: Woff2CollectionFontEntry[]
}

function align4(value: number): number {
  return (value + 3) & ~3
}

function validateTag(tag: string): void {
  let trailingSpace = false
  let visible = 0
  for (let i = 0; i < 4; i++) {
    const code = tag.charCodeAt(i)
    if (code < 0x20 || code > 0x7e) throw new Error('WOFF2: explicit table tag contains a non-printable byte')
    if (code === 0x20) trailingSpace = true
    else {
      if (trailingSpace) throw new Error('WOFF2: explicit table tag has a non-space character after a trailing space')
      visible++
    }
  }
  if (visible === 0) throw new Error('WOFF2: explicit table tag is empty')
}

function requireZeroPadding(bytes: Uint8Array, start: number, end: number, label: string): void {
  for (let offset = start; offset < end; offset++) {
    if (bytes[offset] !== 0) throw new Error(`WOFF2: ${label} padding must contain only zero bytes`)
  }
}

export interface Woff2ContainerResult {
  sfntBuffer: ArrayBuffer
  majorVersion: number
  minorVersion: number
  metadata: string | null
  metadataDocument: WoffMetadataDocument | null
  privateData: Uint8Array | null
}

/**
 * Reads a UIntBase128
 */
function readUIntBase128(reader: BinaryReader): number {
  let result = 0
  for (let i = 0; i < 5; i++) {
    const byte = reader.readUint8()
    if (i === 0 && byte === 0x80) {
      throw new Error('WOFF2: invalid UIntBase128')
    }
    if (result & 0xFE000000) {
      throw new Error('WOFF2: UIntBase128 overflow')
    }
    result = (result << 7) | (byte & 0x7F)
    if ((byte & 0x80) === 0) {
      return result
    }
  }
  throw new Error('WOFF2: UIntBase128 too long')
}

/**
 * Reads a 255UInt16
 */
function read255UInt16(reader: BinaryReader): number {
  const code = reader.readUint8()
  if (code === 253) {
    return reader.readUint16()
  } else if (code === 255) {
    return reader.readUint8() + 253
  } else if (code === 254) {
    return reader.readUint8() + 253 * 2 // spec: value = 506 + nextByte
  } else {
    return code
  }
}

function writeUIntBase128(writer: BinaryWriter, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('WOFF2: UIntBase128 value is out of range')
  const bytes = [value & 0x7f]
  for (let remaining = Math.floor(value / 128); remaining !== 0; remaining = Math.floor(remaining / 128)) {
    bytes.unshift((remaining & 0x7f) | 0x80)
  }
  writer.writeBytes(Uint8Array.from(bytes))
}

function write255UInt16(writer: BinaryWriter, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error('WOFF2: 255UInt16 value is out of range')
  if (value < 253) writer.writeUint8(value)
  else if (value <= 505) { writer.writeUint8(255); writer.writeUint8(value - 253) }
  else if (value <= 761) { writer.writeUint8(254); writer.writeUint8(value - 506) }
  else { writer.writeUint8(253); writer.writeUint16(value) }
}

interface Woff2EncodedTable {
  tag: string
  data: Uint8Array
  origLength: number
  transformVersion: number
  knownIndex: number
}

function tableBytes(sfnt: SfntData, tag: string): Uint8Array {
  const entry = sfnt.tableDirectory.get(tag)
  if (entry === undefined) throw new Error(`WOFF2: input font requires a ${tag} table`)
  return new Uint8Array(sfnt.buffer.slice(entry.offset, entry.offset + entry.length))
}

function readLocaOffsets(loca: Uint8Array, head: Uint8Array, numGlyphs: number): number[] {
  if (head.length < 52) throw new Error('WOFF2: input head table is truncated')
  const indexFormat = new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50, false)
  if (indexFormat !== 0 && indexFormat !== 1) throw new Error('WOFF2: input head indexToLocFormat is invalid')
  const entrySize = indexFormat === 0 ? 2 : 4
  if (loca.length !== (numGlyphs + 1) * entrySize) throw new Error('WOFF2: input loca length does not match maxp')
  const view = new DataView(loca.buffer, loca.byteOffset, loca.byteLength)
  const offsets: number[] = []
  for (let i = 0; i <= numGlyphs; i++) offsets.push(indexFormat === 0 ? view.getUint16(i * 2, false) * 2 : view.getUint32(i * 4, false))
  return offsets
}

function encodeTriplet(dx: number, dy: number, onCurve: boolean, flags: BinaryWriter, triplets: BinaryWriter): void {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  const onCurveBit = onCurve ? 0 : 128
  const xSignBit = dx < 0 ? 0 : 1
  const ySignBit = dy < 0 ? 0 : 1
  const signs = xSignBit + 2 * ySignBit
  if (dx === 0 && absY < 1280) {
    flags.writeUint8(onCurveBit + ((absY & 0xf00) >> 7) + ySignBit)
    triplets.writeUint8(absY & 0xff)
  } else if (dy === 0 && absX < 1280) {
    flags.writeUint8(onCurveBit + 10 + ((absX & 0xf00) >> 7) + xSignBit)
    triplets.writeUint8(absX & 0xff)
  } else if (absX < 65 && absY < 65) {
    flags.writeUint8(onCurveBit + 20 + ((absX - 1) & 0x30) + (((absY - 1) & 0x30) >> 2) + signs)
    triplets.writeUint8((((absX - 1) & 0xf) << 4) | ((absY - 1) & 0xf))
  } else if (absX < 769 && absY < 769) {
    flags.writeUint8(onCurveBit + 84 + 12 * (((absX - 1) & 0x300) >> 8) + (((absY - 1) & 0x300) >> 6) + signs)
    triplets.writeUint8((absX - 1) & 0xff)
    triplets.writeUint8((absY - 1) & 0xff)
  } else if (absX < 4096 && absY < 4096) {
    flags.writeUint8(onCurveBit + 120 + signs)
    triplets.writeUint8(absX >> 4)
    triplets.writeUint8(((absX & 0xf) << 4) | (absY >> 8))
    triplets.writeUint8(absY & 0xff)
  } else {
    if (absX > 0xffff || absY > 0xffff) throw new Error('WOFF2: glyph coordinate delta exceeds transform range')
    flags.writeUint8(onCurveBit + 124 + signs)
    triplets.writeUint16(absX)
    triplets.writeUint16(absY)
  }
}

function transformGlyf(glyf: Uint8Array, loca: Uint8Array, head: Uint8Array, maxp: Uint8Array): Uint8Array {
  if (maxp.length < 6) throw new Error('WOFF2: input maxp table is truncated')
  const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4, false)
  const indexFormat = new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50, false)
  const offsets = readLocaOffsets(loca, head, numGlyphs)
  const nContours = new BinaryWriter(numGlyphs * 2)
  const nPoints = new BinaryWriter()
  const flags = new BinaryWriter()
  const glyphStream = new BinaryWriter()
  const compositeStream = new BinaryWriter()
  const bboxValues = new BinaryWriter()
  const instructions = new BinaryWriter()
  const bboxBitmap = new Uint8Array(4 * Math.floor((numGlyphs + 31) / 32))
  const overlapBitmap = new Uint8Array((numGlyphs + 7) >> 3)

  for (let glyphId = 0; glyphId < numGlyphs; glyphId++) {
    const start = offsets[glyphId]!
    const end = offsets[glyphId + 1]!
    if (start > end || end > glyf.length) throw new Error('WOFF2: input loca offset is out of range')
    if (start === end) {
      nContours.writeInt16(0)
      continue
    }
    if (end - start < 10) throw new Error('WOFF2: input glyph is truncated')
    const reader = new BinaryReader(glyf.buffer as ArrayBuffer, glyf.byteOffset + start, end - start)
    const contourCount = reader.readInt16()
    const xMin = reader.readInt16()
    const yMin = reader.readInt16()
    const xMax = reader.readInt16()
    const yMax = reader.readInt16()
    nContours.writeInt16(contourCount)
    if (contourCount === 0) {
      if (xMin !== 0 || yMin !== 0 || xMax !== 0 || yMax !== 0) throw new Error(`WOFF2: empty glyph ${glyphId} has a non-empty bounding box`)
      continue
    }
    if (contourCount > 0) {
      const endPoints: number[] = []
      let previousEnd = -1
      for (let contour = 0; contour < contourCount; contour++) {
        const endPoint = reader.readUint16()
        if (endPoint <= previousEnd) throw new Error(`WOFF2: glyph ${glyphId} has invalid contour endpoints`)
        write255UInt16(nPoints, endPoint - previousEnd)
        endPoints.push(endPoint)
        previousEnd = endPoint
      }
      const instructionLength = reader.readUint16()
      const instructionBytes = reader.readBytes(instructionLength)
      const pointCount = endPoints[endPoints.length - 1]! + 1
      const pointFlags = new Uint8Array(pointCount)
      for (let point = 0; point < pointCount;) {
        const flag = reader.readUint8()
        pointFlags[point++] = flag
        if ((flag & 0x08) !== 0) {
          const repeats = reader.readUint8()
          if (point + repeats > pointCount) throw new Error(`WOFF2: glyph ${glyphId} flag repeat exceeds its point count`)
          for (let repeat = 0; repeat < repeats; repeat++) pointFlags[point++] = flag
        }
      }
      const xCoordinates: number[] = []
      let x = 0
      for (let point = 0; point < pointCount; point++) {
        const flag = pointFlags[point]!
        if ((flag & 0x02) !== 0) x += (flag & 0x10) !== 0 ? reader.readUint8() : -reader.readUint8()
        else if ((flag & 0x10) === 0) x += reader.readInt16()
        xCoordinates.push(x)
      }
      const yCoordinates: number[] = []
      let y = 0
      for (let point = 0; point < pointCount; point++) {
        const flag = pointFlags[point]!
        if ((flag & 0x04) !== 0) y += (flag & 0x20) !== 0 ? reader.readUint8() : -reader.readUint8()
        else if ((flag & 0x20) === 0) y += reader.readInt16()
        yCoordinates.push(y)
      }
      let previousX = 0
      let previousY = 0
      for (let point = 0; point < pointCount; point++) {
        encodeTriplet(xCoordinates[point]! - previousX, yCoordinates[point]! - previousY, (pointFlags[point]! & 1) !== 0, flags, glyphStream)
        previousX = xCoordinates[point]!
        previousY = yCoordinates[point]!
      }
      write255UInt16(glyphStream, instructionLength)
      instructions.writeBytes(instructionBytes)
      if ((pointFlags[0]! & 0x40) !== 0) overlapBitmap[glyphId >> 3] = overlapBitmap[glyphId >> 3]! | (0x80 >> (glyphId & 7))
      let calculatedXMin = xCoordinates[0]!
      let calculatedYMin = yCoordinates[0]!
      let calculatedXMax = calculatedXMin
      let calculatedYMax = calculatedYMin
      for (let point = 1; point < pointCount; point++) {
        calculatedXMin = Math.min(calculatedXMin, xCoordinates[point]!)
        calculatedYMin = Math.min(calculatedYMin, yCoordinates[point]!)
        calculatedXMax = Math.max(calculatedXMax, xCoordinates[point]!)
        calculatedYMax = Math.max(calculatedYMax, yCoordinates[point]!)
      }
      if (xMin === calculatedXMin && yMin === calculatedYMin && xMax === calculatedXMax && yMax === calculatedYMax) continue
    } else if (contourCount === -1) {
      let more = true
      let hasInstructions = false
      while (more) {
        const componentFlags = reader.readUint16()
        compositeStream.writeUint16(componentFlags)
        compositeStream.writeUint16(reader.readUint16())
        const argumentLength = (componentFlags & 1) !== 0 ? 4 : 2
        compositeStream.writeBytes(reader.readBytes(argumentLength))
        if ((componentFlags & 0x0008) !== 0) compositeStream.writeBytes(reader.readBytes(2))
        else if ((componentFlags & 0x0040) !== 0) compositeStream.writeBytes(reader.readBytes(4))
        else if ((componentFlags & 0x0080) !== 0) compositeStream.writeBytes(reader.readBytes(8))
        more = (componentFlags & 0x0020) !== 0
        hasInstructions ||= (componentFlags & 0x0100) !== 0
      }
      if (hasInstructions) {
        const instructionLength = reader.readUint16()
        write255UInt16(glyphStream, instructionLength)
        instructions.writeBytes(reader.readBytes(instructionLength))
      }
    } else {
      throw new Error(`WOFF2: glyph ${glyphId} has invalid numberOfContours ${contourCount}`)
    }
    bboxBitmap[glyphId >> 3] = bboxBitmap[glyphId >> 3]! | (0x80 >> (glyphId & 7))
    bboxValues.writeInt16(xMin)
    bboxValues.writeInt16(yMin)
    bboxValues.writeInt16(xMax)
    bboxValues.writeInt16(yMax)
  }

  const hasOverlap = overlapBitmap.some(function (value) { return value !== 0 })
  const bbox = new BinaryWriter(bboxBitmap.length + bboxValues.position)
  bbox.writeBytes(bboxBitmap)
  bbox.writeBytes(bboxValues.toUint8Array())
  const streams = [nContours, nPoints, flags, glyphStream, compositeStream, bbox, instructions]
  const output = new BinaryWriter(36 + streams.reduce(function (sum, stream) { return sum + stream.position }, 0) + (hasOverlap ? overlapBitmap.length : 0))
  output.writeUint16(0)
  output.writeUint16(hasOverlap ? 1 : 0)
  output.writeUint16(numGlyphs)
  output.writeUint16(indexFormat)
  for (const stream of streams) output.writeUint32(stream.position)
  for (const stream of streams) output.writeBytes(stream.toUint8Array())
  if (hasOverlap) output.writeBytes(overlapBitmap)
  return output.toUint8Array()
}

function transformHmtx(hmtx: Uint8Array, hhea: Uint8Array, maxp: Uint8Array, glyf: Uint8Array, loca: Uint8Array, head: Uint8Array): Uint8Array | null {
  if (hhea.length < 36 || maxp.length < 6) throw new Error('WOFF2: input metrics tables are truncated')
  const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4, false)
  const numHMetrics = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).getUint16(34, false)
  const requiredLength = numHMetrics * 4 + (numGlyphs - numHMetrics) * 2
  if (numHMetrics === 0 || numHMetrics > numGlyphs || hmtx.length < requiredLength) {
    throw new Error('WOFF2: input hmtx length does not match hhea and maxp')
  }
  if (hmtx.length !== requiredLength) return null
  const offsets = readLocaOffsets(loca, head, numGlyphs)
  const hmtxView = new DataView(hmtx.buffer, hmtx.byteOffset, hmtx.byteLength)
  let proportionalMatch = true
  let monospacedMatch = true
  for (let glyphId = 0; glyphId < numGlyphs; glyphId++) {
    const xMin = offsets[glyphId] === offsets[glyphId + 1] ? 0 : new DataView(glyf.buffer, glyf.byteOffset + offsets[glyphId]!, 10).getInt16(2, false)
    const bearingOffset = glyphId < numHMetrics ? glyphId * 4 + 2 : numHMetrics * 4 + (glyphId - numHMetrics) * 2
    const matches = hmtxView.getInt16(bearingOffset, false) === xMin
    if (glyphId < numHMetrics) proportionalMatch &&= matches
    else monospacedMatch &&= matches
  }
  if (!proportionalMatch && !monospacedMatch) return null
  const output = new BinaryWriter(hmtx.length)
  output.writeUint8((proportionalMatch ? 1 : 0) | (monospacedMatch ? 2 : 0))
  for (let glyphId = 0; glyphId < numHMetrics; glyphId++) output.writeUint16(hmtxView.getUint16(glyphId * 4, false))
  if (!proportionalMatch) for (let glyphId = 0; glyphId < numHMetrics; glyphId++) output.writeInt16(hmtxView.getInt16(glyphId * 4 + 2, false))
  if (!monospacedMatch) {
    for (let glyphId = numHMetrics; glyphId < numGlyphs; glyphId++) output.writeInt16(hmtxView.getInt16(numHMetrics * 4 + (glyphId - numHMetrics) * 2, false))
  }
  return output.toUint8Array()
}

/** Packages one sfnt font resource as a WOFF2 file. */
export function wrapWoff2(sfnt: SfntData, options: Woff2WriteOptions = {}): ArrayBuffer {
  if (options.metadata !== undefined) parseWoffMetadata(options.metadata)

  const sourceTables = [...sfnt.tableDirectory.values()].filter(function (entry) { return entry.tag !== 'DSIG' }).sort(function (left, right) {
    return left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0
  })
  if (sourceTables.length === 0) throw new Error('WOFF2: font must contain at least one table')
  const tables: Woff2EncodedTable[] = sourceTables.map(function (entry) {
    const data = new Uint8Array(sfnt.buffer.slice(entry.offset, entry.offset + entry.length))
    if (calcTableChecksum(entry.tag, data) !== entry.checksum) throw new Error(`WOFF2: input table ${entry.tag} checksum mismatch`)
    if (entry.tag === 'head') {
      if (data.length < 18) throw new Error('WOFF2: input head table is truncated')
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      view.setUint32(8, 0, false)
      view.setUint16(16, view.getUint16(16, false) | 0x0800, false)
    }
    const knownIndex = KNOWN_TAGS.indexOf(entry.tag)
    return { tag: entry.tag, data, origLength: data.length, transformVersion: entry.tag === 'glyf' || entry.tag === 'loca' ? 3 : 0, knownIndex }
  })
  const byTag = new Map<string, Woff2EncodedTable>()
  for (const table of tables) byTag.set(table.tag, table)
  const glyf = byTag.get('glyf')
  const loca = byTag.get('loca')
  if ((glyf === undefined) !== (loca === undefined)) throw new Error('WOFF2: input font has an unpaired glyf/loca table')
  if (glyf !== undefined) {
    const pairedLoca = loca!
    const originalGlyf = tableBytes(sfnt, 'glyf')
    const originalLoca = tableBytes(sfnt, 'loca')
    const originalHead = tableBytes(sfnt, 'head')
    const originalMaxp = tableBytes(sfnt, 'maxp')
    glyf.data = transformGlyf(originalGlyf, originalLoca, originalHead, originalMaxp)
    glyf.transformVersion = 0
    pairedLoca.data = new Uint8Array(0)
    pairedLoca.transformVersion = 0
    const hmtx = byTag.get('hmtx')
    if (hmtx !== undefined) {
      const transformed = transformHmtx(tableBytes(sfnt, 'hmtx'), tableBytes(sfnt, 'hhea'), originalMaxp, originalGlyf, originalLoca, originalHead)
      if (transformed !== null) {
        hmtx.data = transformed
        hmtx.transformVersion = 1
      }
    }
  }

  const directoryWriter = new BinaryWriter(tables.length * 8)
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!
    directoryWriter.writeUint8((table.transformVersion << 6) | (table.knownIndex < 0 ? 63 : table.knownIndex))
    if (table.knownIndex < 0) directoryWriter.writeTag(table.tag)
    writeUIntBase128(directoryWriter, table.origLength)
    const transformed = table.tag === 'glyf' || table.tag === 'loca' ? table.transformVersion === 0 : table.transformVersion !== 0
    if (transformed) writeUIntBase128(directoryWriter, table.data.length)
  }
  const directory = directoryWriter.toUint8Array()

  let uncompressedLength = 0
  let totalSfntSize = 12 + tables.length * 16
  for (let i = 0; i < tables.length; i++) {
    uncompressedLength += tables[i]!.data.length
    totalSfntSize += align4(tables[i]!.origLength)
  }
  const uncompressed = new Uint8Array(uncompressedLength)
  let tableOffset = 0
  for (let i = 0; i < tables.length; i++) {
    uncompressed.set(tables[i]!.data, tableOffset)
    tableOffset += tables[i]!.data.length
  }
  const compressed = brotliCompressWoff2(uncompressed)
  const metadataBytes = options.metadata === undefined ? null : new TextEncoder().encode(options.metadata)
  const compressedMetadata = metadataBytes === null ? null : brotliCompressWoff2(metadataBytes)

  const compressedOffset = 48 + directory.length
  let length = align4(compressedOffset + compressed.length)
  const metadataOffset = compressedMetadata === null ? 0 : length
  if (compressedMetadata !== null) length = metadataOffset + compressedMetadata.length
  const privateOffset = options.privateData === undefined ? 0 : align4(length)
  if (options.privateData !== undefined) length = privateOffset + options.privateData.length

  const writer = new BinaryWriter(length)
  writer.writeUint32(0x774f4632)
  writer.writeUint32(sfnt.sfntVersion)
  writer.writeUint32(length)
  writer.writeUint16(tables.length)
  writer.writeUint16(0)
  writer.writeUint32(totalSfntSize)
  writer.writeUint32(compressed.length)
  writer.writeUint16(options.majorVersion ?? 0)
  writer.writeUint16(options.minorVersion ?? 0)
  writer.writeUint32(metadataOffset)
  writer.writeUint32(compressedMetadata?.length ?? 0)
  writer.writeUint32(metadataBytes?.length ?? 0)
  writer.writeUint32(privateOffset)
  writer.writeUint32(options.privateData?.length ?? 0)
  writer.writeBytes(directory)
  writer.writeBytes(compressed)
  while (writer.position < align4(compressedOffset + compressed.length)) writer.writeUint8(0)
  if (compressedMetadata !== null) {
    while (writer.position < metadataOffset) writer.writeUint8(0)
    writer.writeBytes(compressedMetadata)
  }
  if (options.privateData !== undefined) {
    while (writer.position < privateOffset) writer.writeUint8(0)
    writer.writeBytes(options.privateData)
  }
  return writer.toArrayBuffer()
}

/** Packages a TTC/OTC collection as WOFF2 using shared null-transform tables. */
export function wrapWoff2Collection(buffer: ArrayBuffer, options: Woff2WriteOptions = {}): ArrayBuffer {
  if (options.metadata !== undefined) parseWoffMetadata(options.metadata)
  const reader = new BinaryReader(buffer)
  if (reader.readUint32() !== 0x74746366) throw new Error('WOFF2: input is not a font collection')
  const collectionVersion = reader.readUint32()
  if (collectionVersion !== 0x00010000 && collectionVersion !== 0x00020000) throw new Error('WOFF2: invalid input collection version')
  const numFonts = reader.readUint32()
  if (numFonts === 0 || numFonts > 0xffff) throw new Error('WOFF2: invalid input collection font count')
  const fontOffsets: number[] = []
  for (let i = 0; i < numFonts; i++) fontOffsets.push(reader.readUint32())
  if (collectionVersion === 0x00020000) {
    reader.readUint32()
    reader.readUint32()
    reader.readUint32()
  }

  let uniqueTables: Woff2EncodedTable[] = []
  const tableIndexByOffset = new Map<number, number>()
  const fonts: Woff2CollectionFontEntry[] = []
  for (let fontIndex = 0; fontIndex < fontOffsets.length; fontIndex++) {
    const sfnt = parseSfntDirectory(buffer, fontOffsets[fontIndex]!)
    const tableIndices: number[] = []
    for (const entry of sfnt.tableDirectory.values()) {
      if (entry.tag === 'DSIG') continue
      let index = tableIndexByOffset.get(entry.offset)
      if (index === undefined) {
        const data = new Uint8Array(buffer.slice(entry.offset, entry.offset + entry.length))
        if (calcTableChecksum(entry.tag, data) !== entry.checksum) throw new Error(`WOFF2: input table ${entry.tag} checksum mismatch`)
        if (entry.tag === 'head') {
          if (data.length < 18) throw new Error('WOFF2: input collection head table is truncated')
          const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
          view.setUint32(8, 0, false)
          view.setUint16(16, view.getUint16(16, false) | 0x0800, false)
        }
        index = uniqueTables.length
        tableIndexByOffset.set(entry.offset, index)
        uniqueTables.push({
          tag: entry.tag,
          data,
          origLength: data.length,
          transformVersion: entry.tag === 'glyf' || entry.tag === 'loca' ? 3 : 0,
          knownIndex: KNOWN_TAGS.indexOf(entry.tag),
        })
      } else if (uniqueTables[index]!.tag !== entry.tag || uniqueTables[index]!.data.length !== entry.length) {
        throw new Error('WOFF2: shared collection table offset has inconsistent records')
      }
      tableIndices.push(index)
    }
    fonts.push({ flavor: sfnt.sfntVersion, tableIndices })
  }
  if (uniqueTables.length === 0 || uniqueTables.length > 0xffff) throw new Error('WOFF2: invalid unique collection table count')

  const pairedLoca = new Map<number, number>()
  const pairedGlyf = new Map<number, number>()
  for (let fontIndex = 0; fontIndex < fonts.length; fontIndex++) {
    const font = fonts[fontIndex]!
    const glyf = font.tableIndices.find(function (index) { return uniqueTables[index]!.tag === 'glyf' }) ?? -1
    const loca = font.tableIndices.find(function (index) { return uniqueTables[index]!.tag === 'loca' }) ?? -1
    if ((glyf < 0) !== (loca < 0)) throw new Error(`WOFF2: input collection font ${fontIndex} has an unpaired glyf/loca table`)
    if (glyf < 0) continue
    if (pairedLoca.has(glyf) && pairedLoca.get(glyf) !== loca || pairedGlyf.has(loca) && pairedGlyf.get(loca) !== glyf) {
      throw new Error(`WOFF2: input collection font ${fontIndex} shares only one table of a glyf/loca pair`)
    }
    pairedLoca.set(glyf, loca)
    pairedGlyf.set(loca, glyf)
  }

  // A collection directory requires every glyf table to be immediately followed
  // by its associated loca table, including when the null transform is used.
  const oldIndices: number[] = []
  const added = new Set<number>()
  for (let index = 0; index < uniqueTables.length; index++) {
    if (added.has(index) || pairedGlyf.has(index)) continue
    oldIndices.push(index)
    added.add(index)
    const loca = pairedLoca.get(index)
    if (loca !== undefined) {
      oldIndices.push(loca)
      added.add(loca)
    }
  }
  const newIndex = new Map<number, number>()
  for (let index = 0; index < oldIndices.length; index++) newIndex.set(oldIndices[index]!, index)
  uniqueTables = oldIndices.map(function (index) { return uniqueTables[index]! })
  for (let fontIndex = 0; fontIndex < fonts.length; fontIndex++) {
    fonts[fontIndex]!.tableIndices = fonts[fontIndex]!.tableIndices.map(function (index) { return newIndex.get(index)! })
  }

  const originalTables = uniqueTables.map(function (table) { return table.data })
  const findFontTable = function (font: Woff2CollectionFontEntry, tag: string): number {
    return font.tableIndices.find(function (index) { return uniqueTables[index]!.tag === tag }) ?? -1
  }
  for (let tableIndex = 0; tableIndex < uniqueTables.length; tableIndex++) {
    const table = uniqueTables[tableIndex]!
    if (table.tag !== 'glyf') continue
    const font = fonts.find(function (candidate) { return candidate.tableIndices.includes(tableIndex) })!
    const locaIndex = findFontTable(font, 'loca')
    const headIndex = findFontTable(font, 'head')
    const maxpIndex = findFontTable(font, 'maxp')
    if (locaIndex < 0 || headIndex < 0 || maxpIndex < 0) throw new Error('WOFF2: collection glyf transform requires loca, head, and maxp')
    table.data = transformGlyf(originalTables[tableIndex]!, originalTables[locaIndex]!, originalTables[headIndex]!, originalTables[maxpIndex]!)
    table.transformVersion = 0
    uniqueTables[locaIndex]!.data = new Uint8Array(0)
    uniqueTables[locaIndex]!.transformVersion = 0
  }
  for (let tableIndex = 0; tableIndex < uniqueTables.length; tableIndex++) {
    const table = uniqueTables[tableIndex]!
    if (table.tag !== 'hmtx') continue
    const referencingFonts = fonts.filter(function (font) { return font.tableIndices.includes(tableIndex) })
    let candidate: Uint8Array | null = null
    let compatible = true
    for (let fontIndex = 0; fontIndex < referencingFonts.length; fontIndex++) {
      const font = referencingFonts[fontIndex]!
      const hheaIndex = findFontTable(font, 'hhea')
      const maxpIndex = findFontTable(font, 'maxp')
      const glyfIndex = findFontTable(font, 'glyf')
      const locaIndex = findFontTable(font, 'loca')
      const headIndex = findFontTable(font, 'head')
      if (hheaIndex < 0 || maxpIndex < 0 || glyfIndex < 0 || locaIndex < 0 || headIndex < 0) {
        compatible = false
        break
      }
      const transformed = transformHmtx(originalTables[tableIndex]!, originalTables[hheaIndex]!, originalTables[maxpIndex]!, originalTables[glyfIndex]!, originalTables[locaIndex]!, originalTables[headIndex]!)
      if (transformed === null) {
        compatible = false
        break
      }
      if (candidate === null) candidate = transformed
      else if (candidate.length !== transformed.length || candidate.some(function (value, index) { return value !== transformed[index] })) {
        compatible = false
        break
      }
    }
    if (compatible && candidate !== null) {
      table.data = candidate
      table.transformVersion = 1
    }
  }

  const directoryWriter = new BinaryWriter(uniqueTables.length * 8)
  for (let i = 0; i < uniqueTables.length; i++) {
    const table = uniqueTables[i]!
    directoryWriter.writeUint8((table.transformVersion << 6) | (table.knownIndex < 0 ? 63 : table.knownIndex))
    if (table.knownIndex < 0) directoryWriter.writeTag(table.tag)
    writeUIntBase128(directoryWriter, table.origLength)
    const transformed = table.tag === 'glyf' || table.tag === 'loca' ? table.transformVersion === 0 : table.transformVersion !== 0
    if (transformed) writeUIntBase128(directoryWriter, table.data.length)
  }
  const collectionWriter = new BinaryWriter(8 + fonts.length * 8)
  collectionWriter.writeUint32(collectionVersion)
  write255UInt16(collectionWriter, fonts.length)
  for (let fontIndex = 0; fontIndex < fonts.length; fontIndex++) {
    const font = fonts[fontIndex]!
    write255UInt16(collectionWriter, font.tableIndices.length)
    collectionWriter.writeUint32(font.flavor)
    for (let table = 0; table < font.tableIndices.length; table++) write255UInt16(collectionWriter, font.tableIndices[table]!)
  }
  const directory = directoryWriter.toUint8Array()
  const collectionDirectory = collectionWriter.toUint8Array()
  let rawLength = 0
  for (let i = 0; i < uniqueTables.length; i++) rawLength += uniqueTables[i]!.data.length
  const raw = new Uint8Array(rawLength)
  let rawOffset = 0
  for (let i = 0; i < uniqueTables.length; i++) {
    raw.set(uniqueTables[i]!.data, rawOffset)
    rawOffset += uniqueTables[i]!.data.length
  }
  const compressed = brotliCompressWoff2(raw)
  const metadataBytes = options.metadata === undefined ? null : new TextEncoder().encode(options.metadata)
  const compressedMetadata = metadataBytes === null ? null : brotliCompressWoff2(metadataBytes)
  const compressedOffset = 48 + directory.length + collectionDirectory.length
  let length = align4(compressedOffset + compressed.length)
  const metadataOffset = compressedMetadata === null ? 0 : length
  if (compressedMetadata !== null) length = metadataOffset + compressedMetadata.length
  const privateOffset = options.privateData === undefined ? 0 : align4(length)
  if (options.privateData !== undefined) length = privateOffset + options.privateData.length

  const writer = new BinaryWriter(length)
  writer.writeUint32(0x774f4632)
  writer.writeUint32(0x74746366)
  writer.writeUint32(length)
  writer.writeUint16(uniqueTables.length)
  writer.writeUint16(0)
  let totalSfntSize = align4(12 + fonts.length * 4 + fonts.reduce(function (sum, font) { return sum + 12 + font.tableIndices.length * 16 }, 0))
  for (let i = 0; i < uniqueTables.length; i++) totalSfntSize += align4(uniqueTables[i]!.origLength)
  writer.writeUint32(totalSfntSize)
  writer.writeUint32(compressed.length)
  writer.writeUint16(options.majorVersion ?? 0)
  writer.writeUint16(options.minorVersion ?? 0)
  writer.writeUint32(metadataOffset)
  writer.writeUint32(compressedMetadata?.length ?? 0)
  writer.writeUint32(metadataBytes?.length ?? 0)
  writer.writeUint32(privateOffset)
  writer.writeUint32(options.privateData?.length ?? 0)
  writer.writeBytes(directory)
  writer.writeBytes(collectionDirectory)
  writer.writeBytes(compressed)
  while (writer.position < align4(compressedOffset + compressed.length)) writer.writeUint8(0)
  if (compressedMetadata !== null) writer.writeBytes(compressedMetadata)
  if (options.privateData !== undefined) {
    while (writer.position < privateOffset) writer.writeUint8(0)
    writer.writeBytes(options.privateData)
  }
  return writer.toArrayBuffer()
}

/**
 * Unwraps a WOFF2 font and returns an SFNT ArrayBuffer
 * @param buffer WOFF2 data
 */
export function unwrapWoff2(buffer: ArrayBuffer): ArrayBuffer {
  return unwrapWoff2Container(buffer).sfntBuffer
}

export function unwrapWoff2Container(buffer: ArrayBuffer): Woff2ContainerResult {
  const reader = new BinaryReader(buffer)

  // WOFF2 Header
  const signature = reader.readUint32()
  if (signature !== 0x774F4632) {
    throw new Error('Not a WOFF2 file')
  }

  const flavor = reader.readUint32()
  const length = reader.readUint32()
  const numTables = reader.readUint16()
  const reserved = reader.readUint16()
  const totalSfntSize = reader.readUint32()
  const totalCompressedSize = reader.readUint32()
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const metaOffset = reader.readUint32()
  const metaLength = reader.readUint32()
  const metaOrigLength = reader.readUint32()
  const privOffset = reader.readUint32()
  const privLength = reader.readUint32()

  if (length !== buffer.byteLength) throw new Error('WOFF2: declared length does not match the file length')
  if (numTables === 0) throw new Error('WOFF2: font must contain at least one table')
  if (reserved !== 0) throw new Error('WOFF2: reserved header field must be zero')
  if ((metaOffset === 0) !== (metaLength === 0 && metaOrigLength === 0)) throw new Error('WOFF2: inconsistent metadata fields')
  if ((privOffset === 0) !== (privLength === 0)) throw new Error('WOFF2: inconsistent private-data fields')
  if (metaOffset !== 0 && (metaOffset % 4 !== 0 || metaOffset + metaLength > length)) throw new Error('WOFF2: metadata block is out of range')
  if (privOffset !== 0 && (privOffset % 4 !== 0 || privOffset + privLength > length)) throw new Error('WOFF2: private-data block is out of range')

  // Table directory
  const entries: Woff2TableEntry[] = []
  for (let i = 0; i < numTables; i++) {
    const flags = reader.readUint8()
    const tagIndex = flags & 0x3F

    let tag: string
    if (tagIndex === 63) {
      tag = reader.readTag()
      validateTag(tag)
    } else {
      tag = KNOWN_TAGS[tagIndex]!
    }

    const transformVersion = (flags >> 6) & 0x03
    const origLength = readUIntBase128(reader)

    const outlineTransform = tag === 'glyf' || tag === 'loca'
    if (outlineTransform) {
      if (transformVersion !== 0 && transformVersion !== 3) throw new Error(`WOFF2: invalid ${tag} transform version ${transformVersion}`)
    } else if (tag === 'hmtx') {
      if (transformVersion !== 0 && transformVersion !== 1) throw new Error(`WOFF2: invalid hmtx transform version ${transformVersion}`)
    } else if (transformVersion !== 0) {
      throw new Error(`WOFF2: table ${tag} uses an undefined transform version`)
    }

    let transformLength: number | null = null
    const hasTransformLength = outlineTransform ? transformVersion === 0 : transformVersion !== 0

    if (hasTransformLength) {
      transformLength = readUIntBase128(reader)
    }

    entries.push({ tag, origLength, transformVersion, transformLength })
  }

  if (flavor !== 0x74746366) {
    const tags = new Set<string>()
    for (let i = 0; i < entries.length; i++) {
      if (tags.has(entries[i]!.tag)) throw new Error(`WOFF2: duplicate table ${entries[i]!.tag}`)
      tags.add(entries[i]!.tag)
    }
    const hasTrueTypeOutlines = tags.has('glyf') && tags.has('loca')
    const hasCffOutlines = tags.has('CFF ') || tags.has('CFF2')
    if (flavor === 0x00010000 && (!hasTrueTypeOutlines || hasCffOutlines)) {
      throw new Error('WOFF2: TrueType flavor does not match the outline tables')
    }
    if (flavor === 0x4f54544f && (!hasCffOutlines || hasTrueTypeOutlines)) {
      throw new Error('WOFF2: CFF flavor does not match the outline tables')
    }
  }
  let glyfIndex = -1
  let locaIndex = -1
  if (flavor !== 0x74746366) {
    glyfIndex = entries.findIndex(function (entry) { return entry.tag === 'glyf' && entry.transformVersion === 0 })
    locaIndex = entries.findIndex(function (entry) { return entry.tag === 'loca' && entry.transformVersion === 0 })
    if ((glyfIndex < 0) !== (locaIndex < 0)) throw new Error('WOFF2: transformed glyf and loca tables must be paired')
    if (locaIndex >= 0 && entries[locaIndex]!.transformLength !== 0) throw new Error('WOFF2: transformed loca length must be zero')
  }

  let collection: Woff2CollectionDirectory | null = null
  if (flavor === 0x74746366) {
    const version = reader.readUint32()
    if (version !== 0x00010000 && version !== 0x00020000) throw new Error('WOFF2: invalid collection version')
    const numFonts = read255UInt16(reader)
    if (numFonts === 0) throw new Error('WOFF2: collection must contain at least one font')
    const fonts: Woff2CollectionFontEntry[] = []
    for (let fontIndex = 0; fontIndex < numFonts; fontIndex++) {
      const numFontTables = read255UInt16(reader)
      if (numFontTables === 0) throw new Error(`WOFF2: collection font ${fontIndex} has no tables`)
      const fontFlavor = reader.readUint32()
      if (fontFlavor !== 0x00010000 && fontFlavor !== 0x4f54544f && fontFlavor !== 0x74727565) {
        throw new Error(`WOFF2: collection font ${fontIndex} has an invalid flavor`)
      }
      const tableIndices: number[] = []
      const fontTableIndices = new Set<number>()
      for (let table = 0; table < numFontTables; table++) {
        const index = read255UInt16(reader)
        if (index >= entries.length) throw new Error(`WOFF2: collection font ${fontIndex} table index is out of range`)
        if (fontTableIndices.has(index)) throw new Error(`WOFF2: collection font ${fontIndex} repeats a table index`)
        fontTableIndices.add(index)
        tableIndices.push(index)
      }
      fonts.push({ flavor: fontFlavor, tableIndices })
    }
    collection = { version, fonts }
    const referencedEntries = new Set<number>()
    const locaForGlyf = new Map<number, number>()
    const glyfForLoca = new Map<number, number>()
    for (let fontIndex = 0; fontIndex < fonts.length; fontIndex++) {
      const font = fonts[fontIndex]!
      for (let table = 0; table < font.tableIndices.length; table++) referencedEntries.add(font.tableIndices[table]!)
      const transformedGlyf = font.tableIndices.find(function (index) {
        const entry = entries[index]!
        return entry.tag === 'glyf' && entry.transformVersion === 0
      }) ?? -1
      const transformedLoca = font.tableIndices.find(function (index) {
        const entry = entries[index]!
        return entry.tag === 'loca' && entry.transformVersion === 0
      }) ?? -1
      if ((transformedGlyf < 0) !== (transformedLoca < 0) || transformedGlyf >= 0 && transformedLoca !== transformedGlyf + 1) {
        throw new Error(`WOFF2: collection font ${fontIndex} transformed glyf and loca tables must be paired in order`)
      }
      if (transformedLoca >= 0 && entries[transformedLoca]!.transformLength !== 0) {
        throw new Error(`WOFF2: collection font ${fontIndex} transformed loca length must be zero`)
      }
      if (transformedGlyf >= 0) {
        const pairedLoca = locaForGlyf.get(transformedGlyf)
        const pairedGlyf = glyfForLoca.get(transformedLoca)
        if (pairedLoca !== undefined && pairedLoca !== transformedLoca || pairedGlyf !== undefined && pairedGlyf !== transformedGlyf) {
          throw new Error(`WOFF2: collection font ${fontIndex} shares only one table of a glyf/loca pair`)
        }
        locaForGlyf.set(transformedGlyf, transformedLoca)
        glyfForLoca.set(transformedLoca, transformedGlyf)
      }
    }
    if (referencedEntries.size !== entries.length) throw new Error('WOFF2: collection table directory contains an unreferenced entry')
  }

  // Position of the compressed data
  const compressedDataOffset = reader.position
  // The declared compressed block must fit within the file.
  if (totalCompressedSize < 0 || compressedDataOffset + totalCompressedSize > buffer.byteLength) {
    throw new Error('WOFF2: compressed data extends past the file')
  }
  const fileBytes = new Uint8Array(buffer)
  const compressedEnd = compressedDataOffset + totalCompressedSize
  let expectedOffset = align4(compressedEnd)
  requireZeroPadding(fileBytes, compressedEnd, expectedOffset, 'compressed font data')
  if (metaOffset !== 0) {
    if (metaOffset !== expectedOffset) throw new Error('WOFF2: metadata must immediately follow the compressed font data')
    const metadataEnd = metaOffset + metaLength
    expectedOffset = privOffset === 0 ? metadataEnd : align4(metadataEnd)
    requireZeroPadding(fileBytes, metadataEnd, expectedOffset, 'metadata')
  }
  if (privOffset !== 0) {
    if (privOffset !== expectedOffset) throw new Error('WOFF2: private data must immediately follow the preceding block')
    expectedOffset = privOffset + privLength
  }
  if (expectedOffset !== length) throw new Error('WOFF2: extraneous data after the final block')
  const compressedData = new Uint8Array(buffer, compressedDataOffset, totalCompressedSize)

  // Brotli decompression
  let expectedDecompressedSize = 0
  for (let i = 0; i < entries.length; i++) {
    expectedDecompressedSize += entries[i]!.transformLength ?? entries[i]!.origLength
  }
  const decompressedData = brotliDecompress(compressedData, expectedDecompressedSize)
  const decompReader = new BinaryReader(decompressedData.buffer as ArrayBuffer, decompressedData.byteOffset, decompressedData.byteLength)

  // Slice out each table's data
  const tableDataMap = new Map<string, Uint8Array>()
  const tableDataByIndex: (Uint8Array | null)[] = new Array(entries.length).fill(null)
  let offset = 0

  // For the glyf transform: temporarily hold the transformed glyf data
  const glyfTransformData = new Map<number, Uint8Array>()
  // For the hmtx transform
  const hmtxTransformData = new Map<number, Uint8Array>()

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex]!
    const dataLength = entry.transformLength ?? entry.origLength
    // Every table slice must lie within the decompressed data; a declared
    // length/offset past the end is malformed input, rejected explicitly.
    if (dataLength < 0 || offset + dataLength > decompressedData.byteLength) {
      throw new Error('WOFF2: table data extends past the decompressed stream')
    }
    const tableBytes = new Uint8Array(decompressedData.buffer, decompressedData.byteOffset + offset, dataLength)

    if (entry.transformVersion === 0 && entry.tag === 'glyf') {
      glyfTransformData.set(entryIndex, tableBytes)
    } else if (entry.transformVersion === 0 && entry.tag === 'loca') {
      // loca is generated from the glyf transform, so skip it (dataLength=0)
    } else if (entry.transformVersion === 1 && entry.tag === 'hmtx') {
      hmtxTransformData.set(entryIndex, tableBytes)
    } else {
      tableDataMap.set(entry.tag, tableBytes)
      tableDataByIndex[entryIndex] = tableBytes
    }

    offset += dataLength
  }
  if (offset !== decompressedData.byteLength) throw new Error('WOFF2: decompressed stream contains extraneous data')

  // Invert the glyf/loca transform
  if (collection === null && glyfTransformData.has(glyfIndex)) {
    const maxpData = tableDataMap.get('maxp')
    const headData = tableDataMap.get('head')
    if (maxpData === undefined || maxpData.length < 6) throw new Error('WOFF2: transformed glyf requires a complete maxp table')
    if (headData === undefined || headData.length < 52) throw new Error('WOFF2: transformed glyf requires a complete head table')
    const expectedNumGlyphs = new DataView(maxpData.buffer, maxpData.byteOffset, maxpData.byteLength).getUint16(4, false)
    const expectedIndexFormat = new DataView(headData.buffer, headData.byteOffset, headData.byteLength).getInt16(50, false)
    const locaEntry = entries[locaIndex]!
    const { glyfData, locaData } = inverseTransformGlyf(glyfTransformData.get(glyfIndex)!, expectedNumGlyphs, expectedIndexFormat, locaEntry.origLength)
    tableDataMap.set('glyf', glyfData)
    tableDataMap.set('loca', locaData)
  }

  // Invert the hmtx transform
  if (collection === null && hmtxTransformData.size === 1) {
    const [hmtxEntryIndex, transformedHmtx] = hmtxTransformData.entries().next().value as [number, Uint8Array]
    const glyfData = tableDataMap.get('glyf')
    const locaData = tableDataMap.get('loca')
    const hmtxData = inverseTransformHmtx(
      transformedHmtx, entries[hmtxEntryIndex]!.origLength,
      glyfData ?? null, locaData ?? null,
      tableDataMap.get('hhea') ?? null,
      tableDataMap.get('maxp') ?? null,
    )
    tableDataMap.set('hmtx', hmtxData)
  }

  if (collection !== null) {
    reconstructCollectionTransforms(collection, entries, tableDataByIndex, glyfTransformData, hmtxTransformData)
  }

  // Reconstruct the SFNT
  const sfntBuffer = collection === null
    ? buildSfnt(flavor, entries, tableDataMap)
    : buildTtc(collection, entries, tableDataByIndex)
  let metadata: string | null = null
  let metadataDocument: WoffMetadataDocument | null = null
  if (metaOffset !== 0) {
    const decoded = brotliDecompress(new Uint8Array(buffer, metaOffset, metaLength), metaOrigLength)
    metadata = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
    metadataDocument = parseWoffMetadata(metadata)
  }
  const privateData = privOffset === 0 ? null : new Uint8Array(buffer.slice(privOffset, privOffset + privLength))
  return { sfntBuffer, majorVersion, minorVersion, metadata, metadataDocument, privateData }
}

// --- WOFF2 glyf/loca transform inversion ---

function decodeTriplet(flag: number, gs: Uint8Array, gi: number): { dx: number, dy: number, bytesRead: number } {
  const bytesRead = flag < 84 ? 1 : flag < 120 ? 2 : flag < 124 ? 3 : 4
  if (gi + bytesRead > gs.length) throw new Error('WOFF2: triplet coordinate extends past the glyph stream')
  const withSign = (f: number, v: number) => (f & 1) ? v : -v

  if (flag < 10) {
    const dy = withSign(flag, ((flag & 14) << 7) + gs[gi]!)
    return { dx: 0, dy, bytesRead: 1 }
  } else if (flag < 20) {
    const dx = withSign(flag, (((flag - 10) & 14) << 7) + gs[gi]!)
    return { dx, dy: 0, bytesRead: 1 }
  } else if (flag < 84) {
    const b0 = flag - 20
    const b1 = gs[gi]!
    const dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4))
    const dy = withSign(flag >> 1, 1 + ((b0 & 0x0C) << 2) + (b1 & 0x0F))
    return { dx, dy, bytesRead: 1 }
  } else if (flag < 120) {
    const b0 = flag - 84
    const dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + gs[gi]!)
    const dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + gs[gi + 1]!)
    return { dx, dy, bytesRead: 2 }
  } else if (flag < 124) {
    const b2 = gs[gi + 1]!
    const dx = withSign(flag, (gs[gi]! << 4) + (b2 >> 4))
    const dy = withSign(flag >> 1, ((b2 & 0x0F) << 8) + gs[gi + 2]!)
    return { dx, dy, bytesRead: 3 }
  } else {
    const dx = withSign(flag, (gs[gi]! << 8) + gs[gi + 1]!)
    const dy = withSign(flag >> 1, (gs[gi + 2]! << 8) + gs[gi + 3]!)
    return { dx, dy, bytesRead: 4 }
  }
}

function read255UInt16FromArray(data: Uint8Array, pos: { offset: number }): number {
  if (pos.offset >= data.length) throw new Error('WOFF2: truncated 255UInt16')
  const code = data[pos.offset++]!
  if (code === 253) {
    if (pos.offset + 2 > data.length) throw new Error('WOFF2: truncated 255UInt16')
    const hi = data[pos.offset++]!
    const lo = data[pos.offset++]!
    return (hi << 8) | lo
  } else if (code === 255) {
    if (pos.offset >= data.length) throw new Error('WOFF2: truncated 255UInt16')
    return data[pos.offset++]! + 253
  } else if (code === 254) {
    if (pos.offset >= data.length) throw new Error('WOFF2: truncated 255UInt16')
    return data[pos.offset++]! + 253 * 2 // spec: value = 506 + nextByte
  }
  return code
}

function inverseTransformGlyf(
  transformedData: Uint8Array,
  expectedNumGlyphs: number,
  expectedIndexFormat: number,
  expectedLocaLength: number,
): { glyfData: Uint8Array, locaData: Uint8Array } {
  if (transformedData.length < 36) throw new Error('WOFF2: transformed glyf header is truncated')
  const r = new BinaryReader(transformedData.buffer as ArrayBuffer, transformedData.byteOffset, transformedData.byteLength)

  // Header (36 bytes)
  const reserved = r.readUint16()
  const optionFlags = r.readUint16()
  const numGlyphs = r.readUint16()
  const indexFormat = r.readUint16()
  const nContourStreamSize = r.readUint32()
  const nPointsStreamSize = r.readUint32()
  const flagStreamSize = r.readUint32()
  const glyphStreamSize = r.readUint32()
  const compositeStreamSize = r.readUint32()
  const bboxStreamSize = r.readUint32()
  const instructionStreamSize = r.readUint32()
  if (reserved !== 0) throw new Error('WOFF2: transformed glyf reserved field must be zero')
  if ((optionFlags & 0xfffe) !== 0) throw new Error('WOFF2: transformed glyf optionFlags contains reserved bits')
  if (numGlyphs !== expectedNumGlyphs) throw new Error('WOFF2: transformed glyf numGlyphs does not match maxp')
  if (indexFormat !== 0 && indexFormat !== 1) throw new Error('WOFF2: transformed glyf indexFormat is invalid')
  if (indexFormat !== expectedIndexFormat) throw new Error('WOFF2: transformed glyf indexFormat does not match head')
  const requiredLocaLength = (numGlyphs + 1) * (indexFormat === 0 ? 2 : 4)
  if (expectedLocaLength !== requiredLocaLength) throw new Error('WOFF2: transformed loca origLength is invalid')
  if (nContourStreamSize !== numGlyphs * 2) throw new Error('WOFF2: transformed glyf nContour stream length is invalid')

  // Stream offsets (36 = header size)
  let off = 36
  const nContourOff = off; off += nContourStreamSize
  const nPointsOff = off; off += nPointsStreamSize
  const flagOff = off; off += flagStreamSize
  const glyphOff = off; off += glyphStreamSize
  const compositeOff = off; off += compositeStreamSize
  const bboxOff = off; off += bboxStreamSize
  const instrOff = off; off += instructionStreamSize
  const overlapBitmapSize = (numGlyphs + 7) >> 3
  const overlapOff = off
  if ((optionFlags & 1) !== 0) off += overlapBitmapSize
  if (off !== transformedData.length) throw new Error('WOFF2: transformed glyf stream sizes do not match the table length')

  // Stream pointers
  const nContourStream = new BinaryReader(transformedData.buffer as ArrayBuffer, transformedData.byteOffset + nContourOff, nContourStreamSize)
  const nPointsPos = { offset: nPointsOff }
  let flagIdx = flagOff
  let glyphIdx = glyphOff
  let compositeIdx = compositeOff
  const bboxBitmapSize = 4 * Math.floor((numGlyphs + 31) / 32)
  if (bboxStreamSize < bboxBitmapSize || (bboxStreamSize - bboxBitmapSize) % 8 !== 0) {
    throw new Error('WOFF2: transformed glyf bbox stream length is invalid')
  }
  const bboxBitmap = transformedData.slice(bboxOff, bboxOff + bboxBitmapSize)
  let bboxValueIdx = bboxOff + bboxBitmapSize
  let instrIdx = instrOff

  const glyfWriter = new BinaryWriter(numGlyphs * 32) // rough estimate
  const offsets: number[] = [0]

  for (let g = 0; g < numGlyphs; g++) {
    const numberOfContours = nContourStream.readInt16()
    const hasBbox = (bboxBitmap[g >> 3]! >> (7 - (g & 7))) & 1

    if (numberOfContours === 0) {
      // Empty glyph
      if (hasBbox) throw new Error('WOFF2: empty glyph must not have an explicit bounding box')
      offsets.push(glyfWriter.position)
      continue
    }

    if (numberOfContours > 0) {
      // Simple glyph
      // Read contour point counts
      const endPtsOfContours: number[] = []
      let totalPoints = 0
      for (let c = 0; c < numberOfContours; c++) {
        const nPoints = read255UInt16FromArray(transformedData, nPointsPos)
        if (nPoints === 0) throw new Error('WOFF2: simple glyph contour must contain a point')
        totalPoints += nPoints
        endPtsOfContours.push(totalPoints - 1)
      }

      // Read flags
      const flags: number[] = []
      const onCurve: boolean[] = []
      for (let p = 0; p < totalPoints; p++) {
        if (flagIdx >= flagOff + flagStreamSize) throw new Error('WOFF2: transformed glyf flag stream is truncated')
        const f = transformedData[flagIdx++]!
        onCurve.push(!(f >> 7))
        flags.push(f & 0x7F)
      }

      // Decode triplet coordinates
      const xCoords: number[] = []
      const yCoords: number[] = []
      let x = 0, y = 0
      for (let p = 0; p < totalPoints; p++) {
        const { dx, dy, bytesRead } = decodeTriplet(flags[p]!, transformedData, glyphIdx)
        glyphIdx += bytesRead
        x += dx
        y += dy
        xCoords.push(x)
        yCoords.push(y)
      }

      // Read instructions
      const instrLenPos = { offset: glyphIdx }
      const instrLength = read255UInt16FromArray(transformedData, instrLenPos)
      glyphIdx = instrLenPos.offset

      const instrBytes = transformedData.slice(instrIdx, instrIdx + instrLength)
      if (instrIdx + instrLength > instrOff + instructionStreamSize) throw new Error('WOFF2: transformed glyf instruction stream is truncated')
      instrIdx += instrLength

      // BBox
      let xMin: number, yMin: number, xMax: number, yMax: number
      if (hasBbox) {
        const bv = new BinaryReader(transformedData.buffer as ArrayBuffer, transformedData.byteOffset + bboxValueIdx, 8)
        xMin = bv.readInt16()
        yMin = bv.readInt16()
        xMax = bv.readInt16()
        yMax = bv.readInt16()
        bboxValueIdx += 8
      } else {
        xMin = xMax = xCoords[0]!
        yMin = yMax = yCoords[0]!
        for (let p = 1; p < totalPoints; p++) {
          xMin = Math.min(xMin, xCoords[p]!)
          yMin = Math.min(yMin, yCoords[p]!)
          xMax = Math.max(xMax, xCoords[p]!)
          yMax = Math.max(yMax, yCoords[p]!)
        }
      }

      // Serialize standard glyf simple glyph
      glyfWriter.writeInt16(numberOfContours)
      glyfWriter.writeInt16(xMin)
      glyfWriter.writeInt16(yMin)
      glyfWriter.writeInt16(xMax)
      glyfWriter.writeInt16(yMax)

      for (const ep of endPtsOfContours) glyfWriter.writeUint16(ep)
      glyfWriter.writeUint16(instrLength)
      if (instrLength > 0) glyfWriter.writeBytes(instrBytes)

      // Encode flags and coordinates in TrueType format
      const encodedFlags: number[] = []
      const xDeltas: number[] = []
      const yDeltas: number[] = []
      let prevX = 0, prevY = 0

      for (let p = 0; p < totalPoints; p++) {
        const dx = xCoords[p]! - prevX
        const dy = yCoords[p]! - prevY
        prevX = xCoords[p]!
        prevY = yCoords[p]!

        let flag = onCurve[p]! ? 0x01 : 0x00

        if (dx === 0) {
          flag |= 0x10 // same x
        } else if (dx >= -255 && dx <= 255) {
          flag |= 0x02 // short x
          if (dx > 0) flag |= 0x10 // positive
        }

        if (dy === 0) {
          flag |= 0x20 // same y
        } else if (dy >= -255 && dy <= 255) {
          flag |= 0x04 // short y
          if (dy > 0) flag |= 0x20 // positive
        }

        encodedFlags.push(flag)
        xDeltas.push(dx)
        yDeltas.push(dy)
      }

      // Write flags (no repeat optimization for simplicity)
      if ((optionFlags & 1) !== 0 && ((transformedData[overlapOff + (g >> 3)]! >> (7 - (g & 7))) & 1) !== 0) {
        encodedFlags[0] = encodedFlags[0]! | 0x40
      }
      for (const f of encodedFlags) glyfWriter.writeUint8(f)

      // Write x coordinates
      for (let p = 0; p < totalPoints; p++) {
        const dx = xDeltas[p]!
        const flag = encodedFlags[p]!
        if (flag & 0x02) {
          glyfWriter.writeUint8(Math.abs(dx))
        } else if (!(flag & 0x10)) {
          glyfWriter.writeInt16(dx)
        }
      }

      // Write y coordinates
      for (let p = 0; p < totalPoints; p++) {
        const dy = yDeltas[p]!
        const flag = encodedFlags[p]!
        if (flag & 0x04) {
          glyfWriter.writeUint8(Math.abs(dy))
        } else if (!(flag & 0x20)) {
          glyfWriter.writeInt16(dy)
        }
      }

      glyfWriter.pad4()
      offsets.push(glyfWriter.position)
    } else if (numberOfContours === -1) {
      // Composite glyph (numberOfContours < 0, i.e., -1)
      if (!hasBbox) throw new Error('WOFF2: composite glyph requires an explicit bounding box')
      let cXMin = 0, cYMin = 0, cXMax = 0, cYMax = 0
      if (hasBbox) {
        const bv = new BinaryReader(transformedData.buffer as ArrayBuffer, transformedData.byteOffset + bboxValueIdx, 8)
        cXMin = bv.readInt16()
        cYMin = bv.readInt16()
        cXMax = bv.readInt16()
        cYMax = bv.readInt16()
        bboxValueIdx += 8
      }

      glyfWriter.writeInt16(-1)
      glyfWriter.writeInt16(cXMin)
      glyfWriter.writeInt16(cYMin)
      glyfWriter.writeInt16(cXMax)
      glyfWriter.writeInt16(cYMax)

      // Copy composite data from compositeStream
      let hasMoreComponents = true
      let hasInstructions = false
      while (hasMoreComponents) {
        const flagHi = transformedData[compositeIdx]!
        const flagLo = transformedData[compositeIdx + 1]!
        const compFlag = (flagHi << 8) | flagLo
        glyfWriter.writeUint8(flagHi)
        glyfWriter.writeUint8(flagLo)
        compositeIdx += 2

        // glyphIndex
        glyfWriter.writeUint8(transformedData[compositeIdx]!)
        glyfWriter.writeUint8(transformedData[compositeIdx + 1]!)
        compositeIdx += 2

        // argument bytes
        let argSize = 2 // default: ARG_1_AND_2_ARE_WORDS=0 → 2 bytes
        if (compFlag & 0x0001) argSize = 4 // ARG_1_AND_2_ARE_WORDS
        for (let j = 0; j < argSize; j++) {
          glyfWriter.writeUint8(transformedData[compositeIdx++]!)
        }

        // transform data
        if (compFlag & 0x0008) { // WE_HAVE_A_SCALE
          glyfWriter.writeUint8(transformedData[compositeIdx]!)
          glyfWriter.writeUint8(transformedData[compositeIdx + 1]!)
          compositeIdx += 2
        } else if (compFlag & 0x0040) { // WE_HAVE_AN_X_AND_Y_SCALE
          for (let j = 0; j < 4; j++) glyfWriter.writeUint8(transformedData[compositeIdx++]!)
        } else if (compFlag & 0x0080) { // WE_HAVE_A_TWO_BY_TWO
          for (let j = 0; j < 8; j++) glyfWriter.writeUint8(transformedData[compositeIdx++]!)
        }

        hasMoreComponents = !!(compFlag & 0x0020) // MORE_COMPONENTS
        if (compFlag & 0x0100) hasInstructions = true // WE_HAVE_INSTRUCTIONS
      }

      if (hasInstructions) {
        const instrLenPos2 = { offset: glyphIdx }
        const instrLength2 = read255UInt16FromArray(transformedData, instrLenPos2)
        glyphIdx = instrLenPos2.offset

        glyfWriter.writeUint16(instrLength2)
        for (let j = 0; j < instrLength2; j++) {
          glyfWriter.writeUint8(transformedData[instrIdx++]!)
        }
      }

      glyfWriter.pad4()
      offsets.push(glyfWriter.position)
    } else {
      throw new Error('WOFF2: invalid transformed glyph contour count')
    }
  }

  if (nContourStream.position !== nContourStreamSize
    || nPointsPos.offset !== nPointsOff + nPointsStreamSize
    || flagIdx !== flagOff + flagStreamSize
    || glyphIdx !== glyphOff + glyphStreamSize
    || compositeIdx !== compositeOff + compositeStreamSize
    || bboxValueIdx !== bboxOff + bboxStreamSize
    || instrIdx !== instrOff + instructionStreamSize) {
    throw new Error('WOFF2: transformed glyf substream was not consumed exactly')
  }

  const glyfData = new Uint8Array(glyfWriter.toArrayBuffer())

  // Build loca table
  const locaWriter = new BinaryWriter(indexFormat === 0 ? (numGlyphs + 1) * 2 : (numGlyphs + 1) * 4)
  for (const off of offsets) {
    if (indexFormat === 0) {
      if ((off & 1) !== 0 || off > 0x1fffe) throw new Error('WOFF2: reconstructed glyf offset does not fit short loca')
      locaWriter.writeUint16(off >> 1)
    } else {
      locaWriter.writeUint32(off)
    }
  }
  const locaData = new Uint8Array(locaWriter.toArrayBuffer())

  return { glyfData, locaData }
}

/**
 * Inverts the hmtx transform version 1
 * The WOFF2 hmtx transform stores advanceWidth and lsb separately
 * lsb is omitted when it can be derived from the glyf xMin
 */
function inverseTransformHmtx(
  transformedData: Uint8Array,
  origLength: number,
  glyfData: Uint8Array | null,
  locaData: Uint8Array | null,
  hheaData: Uint8Array | null,
  maxpData: Uint8Array | null,
): Uint8Array {
  if (hheaData === null || hheaData.length < 36) throw new Error('WOFF2: transformed hmtx requires a complete hhea table')
  if (maxpData === null || maxpData.length < 6) throw new Error('WOFF2: transformed hmtx requires a complete maxp table')
  if (glyfData === null || locaData === null) throw new Error('WOFF2: transformed hmtx requires glyf and loca tables')
  const numHMetrics = new DataView(hheaData.buffer, hheaData.byteOffset, hheaData.byteLength).getUint16(34, false)
  const numGlyphs = new DataView(maxpData.buffer, maxpData.byteOffset, maxpData.byteLength).getUint16(4, false)
  if (numHMetrics === 0 || numHMetrics > numGlyphs) throw new Error('WOFF2: invalid numberOfHMetrics for transformed hmtx')
  const expectedOrigLength = numHMetrics * 4 + (numGlyphs - numHMetrics) * 2
  if (origLength !== expectedOrigLength) throw new Error('WOFF2: transformed hmtx origLength is invalid')
  const r = new BinaryReader(transformedData.buffer as ArrayBuffer, transformedData.byteOffset, transformedData.byteLength)
  const flags = r.readUint8()
  if ((flags & 0xfc) !== 0 || (flags & 3) === 0) throw new Error('WOFF2: invalid transformed hmtx flags')
  const lsbOmitted = (flags & 1) !== 0
  const leftSideBearingsOmitted = (flags & 2) !== 0
  const expectedTransformLength = 1 + numHMetrics * 2
    + (lsbOmitted ? 0 : numHMetrics * 2)
    + (leftSideBearingsOmitted ? 0 : (numGlyphs - numHMetrics) * 2)
  if (transformedData.length !== expectedTransformLength) throw new Error('WOFF2: transformed hmtx length is invalid')

  const longLoca = locaData.length === (numGlyphs + 1) * 4
  if (!longLoca && locaData.length !== (numGlyphs + 1) * 2) throw new Error('WOFF2: loca length does not match maxp for transformed hmtx')
  const locaView = new DataView(locaData.buffer, locaData.byteOffset, locaData.byteLength)
  function glyphXMin(glyphId: number): number {
    const start = longLoca ? locaView.getUint32(glyphId * 4, false) : locaView.getUint16(glyphId * 2, false) * 2
    const end = longLoca ? locaView.getUint32((glyphId + 1) * 4, false) : locaView.getUint16((glyphId + 1) * 2, false) * 2
    if (start > end || end > glyfData!.length) throw new Error('WOFF2: invalid loca offset for transformed hmtx')
    if (start === end) return 0
    if (start + 10 > end) throw new Error('WOFF2: truncated glyph for transformed hmtx')
    return new DataView(glyfData!.buffer, glyfData!.byteOffset + start, end - start).getInt16(2, false)
  }

  // Read advanceWidth array
  const advanceWidths = new Uint16Array(numHMetrics)
  for (let i = 0; i < numHMetrics; i++) {
    advanceWidths[i] = r.readUint16()
  }

  // Read or reconstruct lsb
  const lsbs = new Int16Array(numHMetrics)
  if (!lsbOmitted) {
    for (let i = 0; i < numHMetrics; i++) {
      lsbs[i] = r.readInt16()
    }
  } else {
    for (let i = 0; i < numHMetrics; i++) lsbs[i] = glyphXMin(i)
  }

  // Read or reconstruct leftSideBearings for remaining glyphs
  const extraLsbs = new Int16Array(Math.max(0, numGlyphs - numHMetrics))
  if (!leftSideBearingsOmitted) {
    for (let i = 0; i < extraLsbs.length; i++) {
      extraLsbs[i] = r.readInt16()
    }
  } else {
    for (let i = 0; i < extraLsbs.length; i++) {
      extraLsbs[i] = glyphXMin(numHMetrics + i)
    }
  }

  // Rebuild standard hmtx
  const hmtxWriter = new BinaryWriter(origLength)
  for (let i = 0; i < numHMetrics; i++) {
    hmtxWriter.writeUint16(advanceWidths[i]!)
    hmtxWriter.writeInt16(lsbs[i]!)
  }
  for (let i = 0; i < extraLsbs.length; i++) {
    hmtxWriter.writeInt16(extraLsbs[i]!)
  }

  return new Uint8Array(hmtxWriter.toArrayBuffer())
}

function buildSfnt(flavor: number, entries: Woff2TableEntry[], tableDataMap: Map<string, Uint8Array>): ArrayBuffer {
  const validEntries = entries.filter(function (entry) { return tableDataMap.has(entry.tag) })
  validEntries.sort(function (left, right) { return left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0 })
  const numTables = validEntries.length

  const headEntry = validEntries.find(function (entry) { return entry.tag === 'head' })
  if (headEntry !== undefined) {
    const source = tableDataMap.get('head')!
    if (source.length < 12) throw new Error('WOFF2: reconstructed head table is truncated')
    const head = source.slice()
    new DataView(head.buffer, head.byteOffset, head.byteLength).setUint32(8, 0, false)
    tableDataMap.set('head', head)
  }

  // Compute searchRange, entrySelector, rangeShift
  let searchRange = 1
  let entrySelector = 0
  while (searchRange * 2 <= numTables) {
    searchRange *= 2
    entrySelector++
  }
  searchRange *= 16
  const rangeShift = numTables * 16 - searchRange

  const headerSize = 12 + numTables * 16

  // Compute the total size of all table data
  let totalDataSize = 0
  for (const entry of validEntries) {
    const data = tableDataMap.get(entry.tag)
    if (data) {
      totalDataSize += data.length
      totalDataSize += (4 - (data.length % 4)) % 4 // padding
    }
  }

  const writer = new BinaryWriter(headerSize + totalDataSize)

  // SFNT Header
  writer.writeUint32(flavor)
  writer.writeUint16(numTables)
  writer.writeUint16(searchRange)
  writer.writeUint16(entrySelector)
  writer.writeUint16(rangeShift)

  // Table directory
  let dataOffset = headerSize
  const tableOffsets = new Map<string, number>()
  for (const entry of validEntries) {
    const data = tableDataMap.get(entry.tag)
    if (!data) continue

    writer.writeTag(entry.tag)
    writer.writeUint32(calcChecksum(data))
    writer.writeUint32(dataOffset)
    writer.writeUint32(data.length)
    tableOffsets.set(entry.tag, dataOffset)

    dataOffset += data.length
    dataOffset += (4 - (dataOffset % 4)) % 4
  }

  // Table data
  for (const entry of validEntries) {
    const data = tableDataMap.get(entry.tag)
    if (!data) continue
    writer.writeBytes(data)
    writer.pad4()
  }

  const sfntBuffer = writer.toArrayBuffer()
  const headOffset = tableOffsets.get('head')
  if (headOffset !== undefined) {
    const bytes = new Uint8Array(sfntBuffer)
    let sum = 0
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const word = (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16)
        | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0
      sum = (sum + word) >>> 0
    }
    new DataView(sfntBuffer).setUint32(headOffset + 8, (0xb1b0afba - sum) >>> 0, false)
  }
  return sfntBuffer
}

function reconstructCollectionTransforms(
  collection: Woff2CollectionDirectory,
  entries: Woff2TableEntry[],
  tableData: (Uint8Array | null)[],
  glyfTransforms: Map<number, Uint8Array>,
  hmtxTransforms: Map<number, Uint8Array>,
): void {
  const findIndex = function (font: Woff2CollectionFontEntry, tag: string): number {
    return font.tableIndices.find(function (index) { return entries[index]!.tag === tag }) ?? -1
  }
  const requireTable = function (fontIndex: number, font: Woff2CollectionFontEntry, tag: string): { index: number, data: Uint8Array } {
    const index = findIndex(font, tag)
    if (index < 0 || tableData[index] === null) {
      throw new Error(`WOFF2: transformed collection font ${fontIndex} requires a complete ${tag} table`)
    }
    return { index, data: tableData[index]! }
  }

  for (let fontIndex = 0; fontIndex < collection.fonts.length; fontIndex++) {
    const font = collection.fonts[fontIndex]!
    const glyfIndex = findIndex(font, 'glyf')
    const transformedGlyf = glyfTransforms.get(glyfIndex)
    if (transformedGlyf !== undefined && tableData[glyfIndex] === null) {
      const locaIndex = findIndex(font, 'loca')
      if (locaIndex < 0) throw new Error(`WOFF2: transformed collection font ${fontIndex} requires a loca table`)
      const maxp = requireTable(fontIndex, font, 'maxp').data
      const head = requireTable(fontIndex, font, 'head').data
      if (maxp.length < 6) throw new Error(`WOFF2: transformed collection font ${fontIndex} maxp table is truncated`)
      if (head.length < 52) throw new Error(`WOFF2: transformed collection font ${fontIndex} head table is truncated`)
      const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4, false)
      const indexFormat = new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50, false)
      const reconstructed = inverseTransformGlyf(transformedGlyf, numGlyphs, indexFormat, entries[locaIndex]!.origLength)
      tableData[glyfIndex] = reconstructed.glyfData
      tableData[locaIndex] = reconstructed.locaData
    }
  }

  for (let fontIndex = 0; fontIndex < collection.fonts.length; fontIndex++) {
    const font = collection.fonts[fontIndex]!
    const hmtxIndex = findIndex(font, 'hmtx')
    const transformedHmtx = hmtxTransforms.get(hmtxIndex)
    if (transformedHmtx === undefined || tableData[hmtxIndex] !== null) continue
    const hhea = requireTable(fontIndex, font, 'hhea').data
    const maxp = requireTable(fontIndex, font, 'maxp').data
    const glyfIndex = findIndex(font, 'glyf')
    const locaIndex = findIndex(font, 'loca')
    tableData[hmtxIndex] = inverseTransformHmtx(
      transformedHmtx,
      entries[hmtxIndex]!.origLength,
      glyfIndex < 0 ? null : tableData[glyfIndex] ?? null,
      locaIndex < 0 ? null : tableData[locaIndex] ?? null,
      hhea,
      maxp,
    )
  }
}

function buildTtc(
  collection: Woff2CollectionDirectory,
  entries: Woff2TableEntry[],
  tableDataByIndex: (Uint8Array | null)[],
): ArrayBuffer {
  const tableData = tableDataByIndex.map(function (data, index) {
    if (data === null) throw new Error(`WOFF2: collection table ${index} has no reconstructed data`)
    if (entries[index]!.tag !== 'head') return data
    if (data.length < 18) throw new Error('WOFF2: collection head table is truncated')
    const head = data.slice()
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    view.setUint32(8, 0, false)
    view.setUint16(16, view.getUint16(16, false) | 0x0800, false)
    return head
  })
  const headerSize = 12 + collection.fonts.length * 4
  const fontOffsets: number[] = []
  let offset = headerSize
  for (let fontIndex = 0; fontIndex < collection.fonts.length; fontIndex++) {
    fontOffsets.push(offset)
    offset += 12 + collection.fonts[fontIndex]!.tableIndices.length * 16
  }
  offset = align4(offset)
  const tableOffsets: number[] = []
  for (let tableIndex = 0; tableIndex < entries.length; tableIndex++) {
    tableOffsets.push(offset)
    offset += align4(tableData[tableIndex]!.length)
  }

  const writer = new BinaryWriter(offset)
  writer.writeUint32(0x74746366)
  writer.writeUint32(collection.version === 0x00020000 ? 0x00010000 : collection.version)
  writer.writeUint32(collection.fonts.length)
  for (let i = 0; i < fontOffsets.length; i++) writer.writeUint32(fontOffsets[i]!)
  for (let fontIndex = 0; fontIndex < collection.fonts.length; fontIndex++) {
    const font = collection.fonts[fontIndex]!
    const sortedTableIndices = font.tableIndices.slice().sort(function (left, right) {
      const leftTag = entries[left]!.tag
      const rightTag = entries[right]!.tag
      return leftTag < rightTag ? -1 : leftTag > rightTag ? 1 : 0
    })
    writer.writeUint32(font.flavor)
    writer.writeUint16(sortedTableIndices.length)
    let searchRange = 1
    let entrySelector = 0
    while (searchRange * 2 <= sortedTableIndices.length) { searchRange *= 2; entrySelector++ }
    searchRange *= 16
    writer.writeUint16(searchRange)
    writer.writeUint16(entrySelector)
    writer.writeUint16(sortedTableIndices.length * 16 - searchRange)
    for (let table = 0; table < sortedTableIndices.length; table++) {
      const index = sortedTableIndices[table]!
      const entry = entries[index]!
      const data = tableData[index]!
      writer.writeTag(entry.tag)
      writer.writeUint32(calcTableChecksum(entry.tag, data))
      writer.writeUint32(tableOffsets[index]!)
      writer.writeUint32(data.length)
    }
  }
  while ((writer.position & 3) !== 0) writer.writeUint8(0)
  for (let tableIndex = 0; tableIndex < tableData.length; tableIndex++) {
    writer.writeBytes(tableData[tableIndex]!)
    writer.pad4()
  }
  return writer.toArrayBuffer()
}

function calcChecksum(data: Uint8Array): number {
  let sum = 0
  const len = data.length
  const fullWords = len & ~3

  for (let i = 0; i < fullWords; i += 4) {
    sum = (sum + ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!)) >>> 0
  }

  // Remaining bytes
  if (len > fullWords) {
    let last = 0
    for (let i = fullWords; i < len; i++) {
      last |= data[i]! << (24 - (i - fullWords) * 8)
    }
    sum = (sum + last) >>> 0
  }

  return sum
}

function calcTableChecksum(tag: string, data: Uint8Array): number {
  if (tag !== 'head') return calcChecksum(data)
  const normalized = data.slice()
  if (normalized.length >= 12) new DataView(normalized.buffer).setUint32(8, 0, false)
  return calcChecksum(normalized)
}
