import { BinaryReader } from '../../binary/reader.js'

/**
 * fdsc table: Font Descriptors (Apple Advanced Typography)
 *
 * Header: version(Fixed) + descriptorCount(4), then descriptorCount records
 * of tag(4) + value(4). Values are Fixed for 'wght'/'wdth'/'slnt'/'opsz';
 * the 'nalf' (non-alphabetic) value is an integer code.
 */

export interface FdscDescriptor {
  readonly tag: string
  readonly value: number
}

export interface FdscTable {
  readonly version: number
  readonly descriptors: readonly FdscDescriptor[]
  getDescriptor(tag: string): number | null
}

export function parseFdsc(reader: BinaryReader): FdscTable {
  validateRange(reader, 0, 8, 'fdsc header')
  const rawVersion = reader.readUint32()
  if (rawVersion !== 0x00010000) {
    throw new Error(`Unsupported fdsc table version: 0x${rawVersion.toString(16).padStart(8, '0')}`)
  }
  const descriptorCount = reader.readUint32()
  validateRange(reader, 0, 8 + descriptorCount * 8, 'fdsc descriptor array')

  const descriptors: FdscDescriptor[] = []
  const byTag = new Map<string, number>()

  for (let i = 0; i < descriptorCount; i++) {
    const tag = reader.readTag()
    validateTag(tag, i)
    if (byTag.has(tag)) {
      throw new Error(`fdsc descriptor tag must be unique: ${tag}`)
    }
    // 'nalf' holds an integer code; the other defined tags hold Fixed values
    const raw = reader.readInt32()
    const value = tag === 'nalf' ? raw >>> 0 : raw / 65536
    if (tag === 'nalf' && value > 6) {
      throw new Error(`fdsc nalf descriptor code must be 0..6, got ${value}`)
    }
    descriptors.push({ tag, value })
    byTag.set(tag, value)
  }

  return {
    version: 1,
    descriptors,
    getDescriptor(tag: string): number | null {
      return byTag.get(tag) ?? null
    },
  }
}

function validateTag(tag: string, index: number): void {
  for (let i = 0; i < tag.length; i++) {
    const code = tag.charCodeAt(i)
    if (code < 0x20 || code > 0x7E) {
      throw new Error(`fdsc descriptor tag ${index} must contain printable ASCII characters`)
    }
  }
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds fdsc table length: need ${offset + length}, got ${reader.length}`)
  }
}
