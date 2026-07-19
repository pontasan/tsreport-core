import { BinaryReader } from '../binary/reader.js'
import type { TableDirectoryEntry, SfntData } from '../types/index.js'

/**
 * Parses the SFNT table directory
 * Individual table contents are parsed lazily; only the directory is parsed upfront
 */
export function parseSfntDirectory(buffer: ArrayBuffer, offset = 0): SfntData {
  if (offset < 0 || offset + 12 > buffer.byteLength) {
    throw new Error('SFNT table directory extends beyond font data')
  }
  const reader = new BinaryReader(buffer, offset)

  const sfntVersion = reader.readUint32()
  // 0x00010000 = TrueType outlines, 0x4F54544F 'OTTO' = CFF outlines,
  // 0x74727565 'true' = legacy Apple TrueType (used by e.g. macOS NISC18030).
  if (sfntVersion !== 0x00010000 && sfntVersion !== 0x4F54544F && sfntVersion !== 0x74727565) {
    throw new Error(`Unsupported SFNT version: 0x${sfntVersion.toString(16).padStart(8, '0')}`)
  }
  const numTables = reader.readUint16()
  if (numTables === 0) {
    throw new Error('SFNT table directory must contain at least one table')
  }
  // searchRange / entrySelector / rangeShift are legacy binary-search
  // acceleration hints (OpenType §5.1). They are redundant with numTables and
  // conforming parsers must ignore them: real-world fonts (e.g. macOS
  // Symbol.ttf) frequently ship incorrect values, so validating them here would
  // wrongly reject valid fonts. Read past the 6 bytes and move on.
  reader.readUint16()
  reader.readUint16()
  reader.readUint16()

  const directoryLength = 12 + numTables * 16
  if (offset + directoryLength > buffer.byteLength) {
    throw new Error('SFNT table directory extends beyond font data')
  }

  const tableDirectory = new Map<string, TableDirectoryEntry>()
  let previousTag: string | null = null

  for (let i = 0; i < numTables; i++) {
    const tag = reader.readTag()
    validateTableTag(tag)
    if (previousTag !== null && tag <= previousTag) {
      throw new Error(`SFNT table records must be sorted by ascending tag: ${tag}`)
    }
    const checksum = reader.readUint32()
    const tableOffset = reader.readUint32()
    const length = reader.readUint32()
    // The spec recommends 4-byte-aligned table offsets, but real fonts (notably
    // PDF-embedded subsets from various producers) violate this. Tables are read
    // from absolute offsets, so alignment is immaterial — accept any offset, like
    // FreeType. Only the bounds check below is enforced.
    if (tableOffset + length > buffer.byteLength) {
      throw new Error(`SFNT table '${tag}' extends beyond font data`)
    }

    tableDirectory.set(tag, { tag, checksum, offset: tableOffset, length })
    previousTag = tag
  }

  // Determine the format from sfntVersion
  const format = sfntVersion === 0x4F54544F ? 'otf' : 'ttf'

  return {
    format,
    sfntVersion,
    tableDirectory,
    buffer,
    offsetInBuffer: offset,
  } as SfntData
}

/**
 * Gets a BinaryReader for the table data
 */
export function getTableReader(sfnt: SfntData, tag: string): BinaryReader | null {
  const entry = sfnt.tableDirectory.get(tag)
  if (!entry) return null
  return new BinaryReader(sfnt.buffer, entry.offset, entry.length)
}

function validateTableTag(tag: string): void {
  let seenTrailingSpace = false
  let nonSpaceCount = 0
  for (let i = 0; i < 4; i++) {
    const code = tag.charCodeAt(i)
    if (code < 0x20 || code > 0x7E) {
      throw new Error(`SFNT table tag contains a non-printable byte: ${tag}`)
    }
    if (code === 0x20) {
      seenTrailingSpace = true
    } else {
      if (seenTrailingSpace) {
        throw new Error(`SFNT table tag has non-space characters after trailing space: ${tag}`)
      }
      nonSpaceCount++
    }
  }
  if (nonSpaceCount === 0) {
    throw new Error('SFNT table tag must contain at least one non-space character')
  }
}
