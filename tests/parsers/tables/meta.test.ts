import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseMeta } from '../../../src/parsers/tables/meta.js'

/**
  * Meta table build.
 */

function buildMetaTable(
  entries: { tag: string; value: string | Uint8Array }[],
  options: { version?: number; flags?: number; reserved?: number } = {},
): ArrayBuffer {
  const encoder = new TextEncoder()
  const encodedValues = entries.map(e => typeof e.value === 'string' ? encoder.encode(e.value) : e.value)

  // Header: version(4) + flags(4) + reserved(4) + dataMapsCount(4) = 16
  // DataMap entries: tag(4) + dataOffset(4) + dataLength(4) = 12 each
  const headerSize = 16
  const mapSize = 12 * entries.length
  const dataStart = headerSize + mapSize

  let totalDataSize = 0
  for (const v of encodedValues) totalDataSize += v.length

  const buf = new ArrayBuffer(dataStart + totalDataSize)
  const view = new DataView(buf)
  let pos = 0

  // version
  view.setUint32(pos, options.version ?? 1); pos += 4
  // flags
  view.setUint32(pos, options.flags ?? 0); pos += 4
  // reserved
  view.setUint32(pos, options.reserved ?? 0); pos += 4
  // dataMapsCount
  view.setUint32(pos, entries.length); pos += 4

  // DataMap records
  let dataOffset = dataStart
  for (let i = 0; i < entries.length; i++) {
    const tag = entries[i]!.tag
    for (let c = 0; c < 4; c++) {
      view.setUint8(pos++, tag.charCodeAt(c))
    }
    view.setUint32(pos, dataOffset); pos += 4
    view.setUint32(pos, encodedValues[i]!.length); pos += 4
    dataOffset += encodedValues[i]!.length
  }

  // Data values
  let writePos = dataStart
  for (const v of encodedValues) {
    new Uint8Array(buf).set(v, writePos)
    writePos += v.length
  }

  return buf
}

describe('meta table parser', () => {
  it('should parse a single entry', () => {
    const buf = buildMetaTable([{ tag: 'dlng', value: 'Latn' }])
    const reader = new BinaryReader(buf)
    const meta = parseMeta(reader)

    expect(meta.entries.size).toBe(1)
    expect(meta.getValue('dlng')).toBe('Latn')
    expect(new TextDecoder().decode(meta.getData('dlng')!)).toBe('Latn')
  })

  it('should parse multiple entries', () => {
    const buf = buildMetaTable([
      { tag: 'dlng', value: 'Latn, Cyrl' },
      { tag: 'slng', value: 'Latn, Cyrl, Grek' },
    ])
    const reader = new BinaryReader(buf)
    const meta = parseMeta(reader)

    expect(meta.entries.size).toBe(2)
    expect(meta.getValue('dlng')).toBe('Latn, Cyrl')
    expect(meta.getValue('slng')).toBe('Latn, Cyrl, Grek')
  })

  it('should return null for unknown tag', () => {
    const buf = buildMetaTable([{ tag: 'dlng', value: 'Latn' }])
    const reader = new BinaryReader(buf)
    const meta = parseMeta(reader)

    expect(meta.getValue('xxxx')).toBeNull()
  })

  it('should handle empty table', () => {
    const buf = buildMetaTable([])
    const reader = new BinaryReader(buf)
    const meta = parseMeta(reader)

    expect(meta.entries.size).toBe(0)
    expect(meta.getValue('dlng')).toBeNull()
  })

  it('should preserve binary metadata as raw bytes', () => {
    const bytes = new Uint8Array([0x00, 0x80, 0xFF])
    const buf = buildMetaTable([{ tag: 'appl', value: bytes }])
    const reader = new BinaryReader(buf)
    const meta = parseMeta(reader)

    expect(meta.getValue('appl')).toBeNull()
    expect([...meta.getData('appl')!]).toEqual([0x00, 0x80, 0xFF])
  })

  it('should keep the first value for duplicate tags', () => {
    const buf = buildMetaTable([
      { tag: 'dlng', value: 'Latn' },
      { tag: 'dlng', value: 'Cyrl' },
    ])
    const meta = parseMeta(new BinaryReader(buf))

    expect(meta.getValue('dlng')).toBe('Latn')
  })

  it('should reject malformed headers', () => {
    expect(parseMeta(new BinaryReader(buildMetaTable([], { version: 2 }))).entries.size).toBe(0)
    expect(() => parseMeta(new BinaryReader(buildMetaTable([], { flags: 1 })))).toThrow(/flags/)
    expect(() => parseMeta(new BinaryReader(new ArrayBuffer(15)))).toThrow(/length/)
  })

  it('accepts a non-zero third header word (Apple data-section offset)', () => {
    // Real Apple system fonts store the data offset in the nominally-reserved
    // third header word, so a non-zero value must not be rejected.
    const buf = buildMetaTable([{ tag: 'dlng', value: 'Latn' }], { reserved: 64 })
    expect(parseMeta(new BinaryReader(buf)).getValue('dlng')).toBe('Latn')
  })

  it('should reject data map arrays outside the table', () => {
    const buf = buildMetaTable([])
    new DataView(buf).setUint32(12, 1)

    expect(() => parseMeta(new BinaryReader(buf))).toThrow(/data maps exceed/)
  })

  it('should reject malformed metadata tags', () => {
    const notLetter = buildMetaTable([{ tag: '1abc', value: 'x' }])
    const nonTrailingSpace = buildMetaTable([{ tag: 'a b1', value: 'x' }])
    const invalidCharacter = buildMetaTable([{ tag: 'ab-c', value: 'x' }])

    expect(() => parseMeta(new BinaryReader(notLetter))).toThrow(/begin with a letter/)
    expect(() => parseMeta(new BinaryReader(nonTrailingSpace))).toThrow(/non-trailing space/)
    expect(() => parseMeta(new BinaryReader(invalidCharacter))).toThrow(/invalid character/)
  })

  it('should reject metadata value ranges outside the table', () => {
    const buf = buildMetaTable([{ tag: 'dlng', value: 'Latn' }])
    const view = new DataView(buf)
    view.setUint32(20, buf.byteLength)
    view.setUint32(24, 1)

    expect(() => parseMeta(new BinaryReader(buf))).toThrow(/data range/)
  })

  it('should reject non-Basic-Latin dlng and slng values', () => {
    const dlng = buildMetaTable([{ tag: 'dlng', value: 'Hani, 日本語' }])
    const slng = buildMetaTable([{ tag: 'slng', value: new Uint8Array([0x4C, 0x80]) }])

    expect(() => parseMeta(new BinaryReader(dlng))).toThrow(/Basic Latin/)
    expect(() => parseMeta(new BinaryReader(slng))).toThrow(/Basic Latin/)
  })
})
