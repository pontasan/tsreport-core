import { BinaryReader } from '../../binary/reader.js'

const LTAG_HEADER_SIZE = 12
const LTAG_RANGE_SIZE = 4
const LTAG_VERSION = 1

/**
 * ltag table: Language Tags (Apple Advanced Typography)
 *
 * Header: version(4) + flags(4) + numTags(4), then numTags string ranges
 * (offset(2) + length(2), offsets from the start of the ltag table).
 * Tag strings are IETF BCP 47 language tags in ASCII.
 */

export interface LtagTable {
  readonly version: number
  readonly flags: number
  /** Language tags in index order (referenced by other tables via index) */
  readonly tags: readonly string[]
  getTag(index: number): string | null
}

export function parseLtag(reader: BinaryReader): LtagTable {
  const tableStart = reader.position
  if (reader.length - tableStart < LTAG_HEADER_SIZE) {
    throw new Error(`ltag table length must be at least ${LTAG_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const version = reader.readUint32()
  const flags = reader.readUint32()
  const numTags = reader.readUint32()
  if (version !== LTAG_VERSION) {
    throw new Error(`Unsupported ltag table version: ${version}`)
  }
  if (flags !== 0) {
    throw new Error(`ltag flags must be zero, got ${flags}`)
  }
  const stringDataStart = tableStart + LTAG_HEADER_SIZE + numTags * LTAG_RANGE_SIZE
  if (stringDataStart > reader.length) {
    throw new Error(`ltag string range array exceeds table length: need ${stringDataStart}, got ${reader.length}`)
  }

  const ranges: { offset: number, length: number }[] = []
  for (let i = 0; i < numTags; i++) {
    const offset = reader.readUint16()
    const length = reader.readUint16()
    const absoluteOffset = tableStart + offset
    if (length === 0) {
      throw new Error(`ltag tag ${i} length must be greater than zero`)
    }
    if (absoluteOffset < stringDataStart || absoluteOffset + length > reader.length) {
      throw new Error(`ltag tag ${i} string range exceeds table length`)
    }
    ranges.push({ offset, length })
  }

  const tags: string[] = []
  for (let i = 0; i < numTags; i++) {
    const range = ranges[i]!
    reader.seek(tableStart + range.offset)
    tags.push(readLanguageTag(reader, range.length, i))
  }

  return {
    version,
    flags,
    tags,
    getTag(index: number): string | null {
      return tags[index] ?? null
    },
  }
}

function readLanguageTag(reader: BinaryReader, length: number, index: number): string {
  let tag = ''
  for (let i = 0; i < length; i++) {
    const value = reader.readUint8()
    if (value > 0x7F) {
      throw new Error(`ltag tag ${index} must contain ASCII bytes, got 0x${value.toString(16)} at index ${i}`)
    }
    const code = value
    const valid = isAsciiLetter(code) || isAsciiDigit(code) || code === 0x2D
    if (!valid) {
      throw new Error(`ltag tag ${index} contains invalid BCP 47 byte 0x${value.toString(16)} at index ${i}`)
    }
    tag += String.fromCharCode(value)
  }
  if (tag.charCodeAt(0) === 0x2D || tag.charCodeAt(tag.length - 1) === 0x2D || tag.includes('--')) {
    throw new Error(`ltag tag ${index} has invalid hyphen placement: ${tag}`)
  }
  validateLanguageTagStructure(tag, index)
  return tag
}

function validateLanguageTagStructure(tag: string, index: number): void {
  const subtags = tag.split('-')
  const primary = subtags[0]!
  if (primary.length === 1) {
    const primaryCode = primary.charCodeAt(0) | 0x20
    if (primaryCode !== 0x78 && primaryCode !== 0x69) {
      throw new Error(`ltag tag ${index} has invalid primary language subtag: ${tag}`)
    }
    if (subtags.length === 1) {
      throw new Error(`ltag tag ${index} singleton subtag must be followed by another subtag: ${tag}`)
    }
  } else if (primary.length < 2 || primary.length > 8 || !isAsciiAlphaString(primary)) {
    throw new Error(`ltag tag ${index} has invalid primary language subtag: ${tag}`)
  }

  let privateUse = primary.length === 1 && (primary.charCodeAt(0) | 0x20) === 0x78
  for (let i = 1; i < subtags.length; i++) {
    const subtag = subtags[i]!
    if (subtag.length > 8) {
      throw new Error(`ltag tag ${index} subtag length exceeds 8 bytes: ${tag}`)
    }
    if (!privateUse && subtag.length === 1) {
      if (i === subtags.length - 1) {
        throw new Error(`ltag tag ${index} singleton subtag must be followed by another subtag: ${tag}`)
      }
      const subtagCode = subtag.charCodeAt(0) | 0x20
      privateUse = subtagCode === 0x78
      if (!privateUse && subtags[i + 1]!.length === 1) {
        throw new Error(`ltag tag ${index} extension subtag length must be at least 2 bytes: ${tag}`)
      }
    }
  }
}

function isAsciiAlphaString(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (!isAsciiLetter(value.charCodeAt(i))) return false
  }
  return true
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}
