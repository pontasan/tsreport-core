import { BinaryReader } from '../../binary/reader.js'

const META_HEADER_SIZE = 16
const META_DATA_MAP_SIZE = 12
const META_VERSION = 1

/**
 * meta table: font metadata
 * Stores metadata such as design languages and supported languages
 */
export interface MetaTable {
  /** Map of metadata entries (tag → UTF-8 value) */
  readonly entries: Map<string, string>
  /** Map of metadata entries (tag → raw bytes) */
  readonly data: Map<string, Uint8Array>
  /** Get a metadata value by tag */
  getValue(tag: string): string | null
  /** Get raw metadata bytes by tag */
  getData(tag: string): Uint8Array | null
}

/**
 * Parse the meta table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/meta
 */
export function parseMeta(reader: BinaryReader): MetaTable {
  if (reader.length < META_HEADER_SIZE) {
    throw new Error(`meta table length must be at least ${META_HEADER_SIZE}, got ${reader.length}`)
  }

  const version = reader.readUint32()
  const flags = reader.readUint32()
  // The third header word is nominally reserved (should be 0), but the table's
  // Apple-originated form stores the offset to the data section here, so real
  // shipping fonts carry a non-zero value; the per-map data offsets are
  // absolute regardless, so this word is simply ignored.
  reader.readUint32()
  const dataMapsCount = reader.readUint32()
  if (version < META_VERSION) {
    throw new Error(`Unsupported meta table version: ${version}`)
  }
  if (version === META_VERSION && flags !== 0) {
    throw new Error(`meta table flags must be zero, got ${flags}`)
  }

  const dataMapsEnd = META_HEADER_SIZE + dataMapsCount * META_DATA_MAP_SIZE
  if (dataMapsEnd > reader.length) {
    throw new Error(`meta data maps exceed table length: need ${dataMapsEnd}, got ${reader.length}`)
  }

  const entries = new Map<string, string>()
  const data = new Map<string, Uint8Array>()
  const decoder = new TextDecoder('utf-8', { fatal: true })

  for (let i = 0; i < dataMapsCount; i++) {
    const tag = reader.readTag()
    const dataOffset = reader.readUint32()
    const dataLength = reader.readUint32()
    validateMetaTag(tag, i)
    if (dataOffset < dataMapsEnd || dataOffset + dataLength > reader.length) {
      throw new Error(`meta data map ${i} data range exceeds table length`)
    }

    const savedPos = reader.position
    reader.seek(dataOffset)
    const bytes = reader.readBytes(dataLength)
    reader.seek(savedPos)

    if (!data.has(tag)) {
      data.set(tag, bytes)
      if (isTextMetaTag(tag)) {
        validateTextMetaValue(tag, bytes)
        entries.set(tag, decoder.decode(bytes))
      }
    }
  }

  return {
    entries,
    data,
    getValue(tag: string): string | null {
      return entries.get(tag) ?? null
    },
    getData(tag: string): Uint8Array | null {
      return data.get(tag) ?? null
    },
  }
}

function validateMetaTag(tag: string, index: number): void {
  const first = tag.charCodeAt(0)
  if (!isAsciiLetter(first)) {
    throw new Error(`meta data map ${index} tag must begin with a letter: ${tag}`)
  }

  let seenSpace = false
  for (let i = 0; i < tag.length; i++) {
    const code = tag.charCodeAt(i)
    if (code === 0x20) {
      seenSpace = true
    } else {
      if (seenSpace) {
        throw new Error(`meta data map ${index} tag has non-trailing space: ${tag}`)
      }
      if (!isAsciiLetter(code) && !isAsciiDigit(code)) {
        throw new Error(`meta data map ${index} tag contains invalid character: ${tag}`)
      }
    }
  }
}

function isTextMetaTag(tag: string): boolean {
  return tag === 'dlng' || tag === 'slng'
}

function validateTextMetaValue(tag: string, bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i]!
    if (value > 0x7F) {
      throw new Error(`meta ${tag} value must use Basic Latin bytes, got 0x${value.toString(16)} at index ${i}`)
    }
  }
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}
