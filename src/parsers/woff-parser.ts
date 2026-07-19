/**
 * WOFF (Web Open Font Format 1.0) parser
 * Decompresses the WOFF container and reconstructs the SFNT data
 */
import { BinaryReader } from '../binary/reader.js'
import { BinaryWriter } from '../binary/writer.js'
import { zlibInflate } from '../compression/inflate.js'
import { zlibDeflate } from '../compression/deflate.js'
import type { SfntData, WoffMetadataDocument } from '../types/index.js'
import { parseWoffMetadata } from './woff-metadata.js'

interface WoffTableEntry {
  tag: string
  offset: number
  compLength: number
  origLength: number
  origChecksum: number
}

function align4(value: number): number {
  return (value + 3) & ~3
}

function requireZeroPadding(bytes: Uint8Array, start: number, end: number, label: string): void {
  for (let offset = start; offset < end; offset++) {
    if (bytes[offset] !== 0) throw new Error(`WOFF: ${label} padding must contain only zero bytes`)
  }
}

export interface WoffContainerResult {
  sfntBuffer: ArrayBuffer
  majorVersion: number
  minorVersion: number
  metadata: string | null
  metadataDocument: WoffMetadataDocument | null
  privateData: Uint8Array | null
}

export interface WoffWriteOptions {
  majorVersion?: number
  minorVersion?: number
  metadata?: string
  privateData?: Uint8Array
}

function tableChecksum(tag: string, data: Uint8Array): number {
  let sum = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    let word = 0
    for (let byte = 0; byte < 4; byte++) {
      const index = offset + byte
      const value = tag === 'head' && index >= 8 && index < 12 ? 0 : (data[index] ?? 0)
      word = (word << 8) | value
    }
    sum = (sum + (word >>> 0)) >>> 0
  }
  return sum
}

/**
 * Unwraps a WOFF font and returns an SFNT ArrayBuffer
 */
export function unwrapWoff(buffer: ArrayBuffer): ArrayBuffer {
  return unwrapWoffContainer(buffer).sfntBuffer
}

export function unwrapWoffContainer(buffer: ArrayBuffer): WoffContainerResult {
  const reader = new BinaryReader(buffer)

  // WOFF Header
  const signature = reader.readUint32()
  if (signature !== 0x774F4646) {
    throw new Error('Not a WOFF file')
  }

  const flavor = reader.readUint32() // SFNT version
  const length = reader.readUint32() // total WOFF size
  const numTables = reader.readUint16()
  const reserved = reader.readUint16()
  const totalSfntSize = reader.readUint32()
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const metaOffset = reader.readUint32()
  const metaLength = reader.readUint32()
  const metaOrigLength = reader.readUint32()
  const privOffset = reader.readUint32()
  const privLength = reader.readUint32()

  if (length !== buffer.byteLength) throw new Error('WOFF: declared length does not match the file length')
  if (reserved !== 0) throw new Error('WOFF: reserved header field must be zero')
  if (numTables === 0) throw new Error('WOFF: font must contain at least one table')
  if (44 + numTables * 20 > length) throw new Error('WOFF: table directory extends past the file')
  if ((metaOffset === 0) !== (metaLength === 0 && metaOrigLength === 0)) throw new Error('WOFF: inconsistent metadata fields')
  if ((privOffset === 0) !== (privLength === 0)) throw new Error('WOFF: inconsistent private-data fields')
  if (metaOffset !== 0 && (metaOffset % 4 !== 0 || metaOffset + metaLength > length)) throw new Error('WOFF: metadata block is out of range')
  if (privOffset !== 0 && (privOffset % 4 !== 0 || privOffset + privLength > length)) throw new Error('WOFF: private-data block is out of range')

  // Table directory entries
  const entries: WoffTableEntry[] = []
  for (let i = 0; i < numTables; i++) {
    const entry = {
      tag: reader.readTag(),
      offset: reader.readUint32(),
      compLength: reader.readUint32(),
      origLength: reader.readUint32(),
      origChecksum: reader.readUint32(),
    }
    if (i > 0 && entries[i - 1]!.tag >= entry.tag) throw new Error('WOFF: table directory must be sorted by tag')
    if (entry.offset % 4 !== 0) throw new Error(`WOFF: table ${entry.tag} offset is not 4-byte aligned`)
    if (entry.compLength > entry.origLength) throw new Error(`WOFF: table ${entry.tag} compressed length exceeds original length`)
    if (entry.offset + entry.compLength > length) throw new Error(`WOFF: table ${entry.tag} extends past the file`)
    entries.push(entry)
  }


  const fileBytes = new Uint8Array(buffer)
  const physicalEntries = [...entries].sort(function (left, right) { return left.offset - right.offset })
  let expectedOffset = 44 + numTables * 20
  for (let i = 0; i < physicalEntries.length; i++) {
    const entry = physicalEntries[i]!
    if (entry.offset !== expectedOffset) throw new Error(`WOFF: extraneous or overlapping data before table ${entry.tag}`)
    const tableEnd = entry.offset + entry.compLength
    expectedOffset = align4(tableEnd)
    requireZeroPadding(fileBytes, tableEnd, expectedOffset, `table ${entry.tag}`)
  }
  if (metaOffset !== 0) {
    if (metaOffset !== expectedOffset) throw new Error('WOFF: metadata must immediately follow the font tables')
    const metadataEnd = metaOffset + metaLength
    expectedOffset = privOffset === 0 ? metadataEnd : align4(metadataEnd)
    requireZeroPadding(fileBytes, metadataEnd, expectedOffset, 'metadata')
  }
  if (privOffset !== 0) {
    if (privOffset !== expectedOffset) throw new Error('WOFF: private data must immediately follow the preceding block')
    expectedOffset = privOffset + privLength
  }
  if (expectedOffset !== length) throw new Error('WOFF: extraneous data after the final block')

  // Reconstruct the SFNT. totalSfntSize is a declared uint32 and only seeds the
  // writer's initial capacity (the writer grows as tables are written), so cap
  // the seed to a small multiple of the actual WOFF input: a malicious header
  // could otherwise claim ~4GB to force a huge up-front allocation.
  const writer = new BinaryWriter(Math.min(totalSfntSize, buffer.byteLength * 8 + 4096))

  // SFNT header
  writer.writeUint32(flavor)
  writer.writeUint16(numTables)

  // searchRange, entrySelector, rangeShift
  let searchRange = 1
  let entrySelector = 0
  while (searchRange * 2 <= numTables) {
    searchRange *= 2
    entrySelector++
  }
  searchRange *= 16
  const rangeShift = numTables * 16 - searchRange

  writer.writeUint16(searchRange)
  writer.writeUint16(entrySelector)
  writer.writeUint16(rangeShift)

  // Compute table directory and data positions
  const headerSize = 12 + numTables * 16
  let dataOffset = headerSize

  // Decompress and prepare table data
  const tableData: { tag: string; data: Uint8Array; checksum: number; sourceOffset: number; sfntOffset: number }[] = []
  for (const entry of entries) {
    const compData = new Uint8Array(buffer, entry.offset, entry.compLength)
    let data: Uint8Array

    if (entry.compLength < entry.origLength) {
      data = zlibInflate(compData)
    } else {
      // Uncompressed
      data = new Uint8Array(entry.origLength)
      data.set(compData.subarray(0, entry.origLength))
    }

    if (data.length !== entry.origLength) throw new Error(`WOFF: table ${entry.tag} decompressed length mismatch`)
    if (tableChecksum(entry.tag, data) !== entry.origChecksum) throw new Error(`WOFF: table ${entry.tag} checksum mismatch`)

    tableData.push({ tag: entry.tag, data, checksum: entry.origChecksum, sourceOffset: entry.offset, sfntOffset: 0 })
  }


  const physicalTables = [...tableData].sort(function (left, right) { return left.sourceOffset - right.sourceOffset })
  for (let i = 0; i < physicalTables.length; i++) {
    physicalTables[i]!.sfntOffset = dataOffset
    dataOffset = align4(dataOffset + physicalTables[i]!.data.length)
  }

  // Write the table directory
  for (const table of tableData) {
    writer.writeTag(table.tag)
    writer.writeUint32(table.checksum)
    writer.writeUint32(table.sfntOffset)
    writer.writeUint32(table.data.length)
  }

  // Write the table data
  for (const table of physicalTables) {
    writer.writeBytes(table.data)
    writer.pad4()
  }

  const sfntBuffer = writer.toArrayBuffer()
  if (sfntBuffer.byteLength !== totalSfntSize) throw new Error('WOFF: totalSfntSize does not match reconstructed font size')

  let metadata: string | null = null
  let metadataDocument: WoffMetadataDocument | null = null
  if (metaOffset !== 0) {
    const compressed = new Uint8Array(buffer, metaOffset, metaLength)
    const decoded = zlibInflate(compressed)
    if (decoded.length !== metaOrigLength) throw new Error('WOFF: metadata decompressed length mismatch')
    metadata = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
    metadataDocument = parseWoffMetadata(metadata)
  }
  const privateData = privOffset === 0 ? null : new Uint8Array(buffer.slice(privOffset, privOffset + privLength))
  return { sfntBuffer, majorVersion, minorVersion, metadata, metadataDocument, privateData }
}

/** Packages one sfnt font resource as WOFF 1.0. */
export function wrapWoff(sfnt: SfntData, options: WoffWriteOptions = {}): ArrayBuffer {
  if (options.metadata !== undefined) parseWoffMetadata(options.metadata)
  const tables = [...sfnt.tableDirectory.values()]
  tables.sort(function (left, right) { return left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0 })
  const tableData = tables.map(function (table) {
    const data = new Uint8Array(sfnt.buffer.slice(table.offset, table.offset + table.length))
    if (tableChecksum(table.tag, data) !== table.checksum) throw new Error(`WOFF: input table ${table.tag} checksum mismatch`)
    return {
      ...table,
      data,
      sfntOffset: 0,
    }
  })
  let totalSfntSize = 12 + tables.length * 16
  for (let i = 0; i < tables.length; i++) totalSfntSize += (tables[i]!.length + 3) & ~3

  const physicalTables = [...tableData].sort(function (left, right) { return left.offset - right.offset })
  let sfntOffset = 12 + tables.length * 16
  for (let i = 0; i < physicalTables.length; i++) {
    physicalTables[i]!.sfntOffset = sfntOffset
    sfntOffset = align4(sfntOffset + physicalTables[i]!.data.length)
  }
  const head = tableData.find(function (table) { return table.tag === 'head' })
  if (head !== undefined) {
    if (head.data.length < 12) throw new Error('WOFF: input head table is truncated')
    new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength).setUint32(8, 0, false)
    const normalized = new BinaryWriter(totalSfntSize)
    normalized.writeUint32(sfnt.sfntVersion)
    normalized.writeUint16(tables.length)
    let searchRange = 1
    let entrySelector = 0
    while (searchRange * 2 <= tables.length) { searchRange *= 2; entrySelector++ }
    searchRange *= 16
    normalized.writeUint16(searchRange)
    normalized.writeUint16(entrySelector)
    normalized.writeUint16(tables.length * 16 - searchRange)
    for (let i = 0; i < tableData.length; i++) {
      const table = tableData[i]!
      normalized.writeTag(table.tag)
      normalized.writeUint32(tableChecksum(table.tag, table.data))
      normalized.writeUint32(table.sfntOffset)
      normalized.writeUint32(table.data.length)
    }
    for (let i = 0; i < physicalTables.length; i++) { normalized.writeBytes(physicalTables[i]!.data); normalized.pad4() }
    const bytes = normalized.toUint8Array()
    let sum = 0
    for (let offset = 0; offset < bytes.length; offset += 4) {
      sum = (sum + new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)) >>> 0
    }
    new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength).setUint32(8, (0xb1b0afba - sum) >>> 0, false)
  }

  const encodedTables = physicalTables.map(function (table) {
    const compressed = zlibDeflate(table.data)
    return { table, stored: compressed.length < table.data.length ? compressed : table.data }
  })
  const encodedByTag = new Map(encodedTables.map(function (entry) { return [entry.table.tag, entry] as const }))
  const metadataBytes = options.metadata === undefined ? null : new TextEncoder().encode(options.metadata)
  const compressedMetadata = metadataBytes === null ? null : zlibDeflate(metadataBytes)
  const directoryEnd = 44 + tables.length * 20
  let offset = directoryEnd
  const tableOffsets = new Map<string, number>()
  for (let i = 0; i < encodedTables.length; i++) {
    tableOffsets.set(encodedTables[i]!.table.tag, offset)
    offset += align4(encodedTables[i]!.stored.length)
  }
  const metadataOffset = compressedMetadata === null ? 0 : offset
  if (compressedMetadata !== null) offset = (offset + compressedMetadata.length + 3) & ~3
  const privateOffset = options.privateData === undefined ? 0 : offset
  if (options.privateData !== undefined) offset += options.privateData.length

  const writer = new BinaryWriter(offset)
  writer.writeUint32(0x774f4646)
  writer.writeUint32(sfnt.sfntVersion)
  writer.writeUint32(offset)
  writer.writeUint16(tables.length)
  writer.writeUint16(0)
  writer.writeUint32(totalSfntSize)
  writer.writeUint16(options.majorVersion ?? 0)
  writer.writeUint16(options.minorVersion ?? 0)
  writer.writeUint32(metadataOffset)
  writer.writeUint32(compressedMetadata?.length ?? 0)
  writer.writeUint32(metadataBytes?.length ?? 0)
  writer.writeUint32(privateOffset)
  writer.writeUint32(options.privateData?.length ?? 0)
  for (let i = 0; i < tableData.length; i++) {
    const table = tableData[i]!
    writer.writeTag(table.tag)
    writer.writeUint32(tableOffsets.get(table.tag)!)
    writer.writeUint32(encodedByTag.get(table.tag)!.stored.length)
    writer.writeUint32(table.data.length)
    writer.writeUint32(tableChecksum(table.tag, table.data))
  }
  for (let i = 0; i < encodedTables.length; i++) { writer.writeBytes(encodedTables[i]!.stored); writer.pad4() }
  if (compressedMetadata !== null) { writer.writeBytes(compressedMetadata); writer.pad4() }
  if (options.privateData !== undefined) writer.writeBytes(options.privateData)
  return writer.toArrayBuffer()
}
