import { BinaryWriter } from '../binary/writer.js'
import { parseSfntDirectory } from '../parsers/sfnt-parser.js'

export interface FontCollectionBuildOptions {
  readonly majorVersion?: 1 | 2
}

interface CollectionTable {
  readonly tag: string
  readonly data: Uint8Array
  readonly checksum: number
  offset: number
}

interface CollectionFace {
  readonly sfntVersion: number
  readonly tableIndices: number[]
  offset: number
}

/**
 * Builds a TTC/OTC resource from standalone sfnt fonts. Byte-identical tables
 * are stored once and referenced by every face that uses them. Digital
 * signatures are omitted because rebuilding or subsetting invalidates them.
 */
export function buildFontCollection(
  fontBuffers: readonly ArrayBuffer[],
  options: FontCollectionBuildOptions = {},
): ArrayBuffer {
  if (fontBuffers.length === 0) throw new Error('Font collection requires at least one font')

  const tables: CollectionTable[] = []
  const faces: CollectionFace[] = new Array(fontBuffers.length)
  for (let fontIndex = 0; fontIndex < fontBuffers.length; fontIndex++) {
    const sfnt = parseSfntDirectory(fontBuffers[fontIndex]!)
    const tableIndices: number[] = []
    for (const entry of sfnt.tableDirectory.values()) {
      if (entry.tag === 'DSIG') continue
      const data = new Uint8Array(entry.length)
      data.set(new Uint8Array(sfnt.buffer, entry.offset, entry.length))
      if (entry.tag === 'head') {
        if (data.length < 12) throw new Error('Font collection head table is truncated')
        new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(8, 0, false)
      }
      const checksum = calculateTableChecksum(data)
      let tableIndex = -1
      for (let candidate = 0; candidate < tables.length; candidate++) {
        const table = tables[candidate]!
        if (table.tag === entry.tag && table.checksum === checksum && equalBytes(table.data, data)) {
          tableIndex = candidate
          break
        }
      }
      if (tableIndex < 0) {
        tableIndex = tables.length
        tables.push({ tag: entry.tag, data, checksum, offset: 0 })
      }
      tableIndices.push(tableIndex)
    }
    faces[fontIndex] = { sfntVersion: sfnt.sfntVersion, tableIndices, offset: 0 }
  }

  const majorVersion = options.majorVersion ?? 1
  const headerLength = 12 + faces.length * 4 + (majorVersion === 2 ? 12 : 0)
  let offset = headerLength
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]!
    face.offset = offset
    offset += 12 + face.tableIndices.length * 16
  }
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const table = tables[tableIndex]!
    table.offset = offset
    offset += align4(table.data.length)
  }

  const writer = new BinaryWriter(offset)
  writer.writeUint32(0x74746366)
  writer.writeUint16(majorVersion)
  writer.writeUint16(0)
  writer.writeUint32(faces.length)
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) writer.writeUint32(faces[faceIndex]!.offset)
  if (majorVersion === 2) {
    writer.writeUint32(0)
    writer.writeUint32(0)
    writer.writeUint32(0)
  }

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]!
    writer.writeUint32(face.sfntVersion)
    writeOffsetTableFields(writer, face.tableIndices.length)
    for (let recordIndex = 0; recordIndex < face.tableIndices.length; recordIndex++) {
      const table = tables[face.tableIndices[recordIndex]!]!
      writer.writeTag(table.tag)
      writer.writeUint32(table.checksum)
      writer.writeUint32(table.offset)
      writer.writeUint32(table.data.length)
    }
  }
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const table = tables[tableIndex]!
    writer.writeBytes(table.data)
    while ((writer.position & 3) !== 0) writer.writeUint8(0)
  }
  return writer.toArrayBuffer()
}

function writeOffsetTableFields(writer: BinaryWriter, numTables: number): void {
  writer.writeUint16(numTables)
  let power = 1
  let selector = 0
  while (power * 2 <= numTables) {
    power *= 2
    selector++
  }
  const searchRange = power * 16
  writer.writeUint16(searchRange)
  writer.writeUint16(selector)
  writer.writeUint16(numTables * 16 - searchRange)
}

function calculateTableChecksum(data: Uint8Array): number {
  let checksum = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const word = ((data[offset] ?? 0) << 24) |
      ((data[offset + 1] ?? 0) << 16) |
      ((data[offset + 2] ?? 0) << 8) |
      (data[offset + 3] ?? 0)
    checksum = (checksum + (word >>> 0)) >>> 0
  }
  return checksum
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
  return true
}

function align4(value: number): number {
  return (value + 3) & ~3
}
