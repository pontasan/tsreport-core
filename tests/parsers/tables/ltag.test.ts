import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseLtag } from '../../../src/parsers/tables/ltag.js'

function buildLtag(tags: string[], options: { version?: number; flags?: number } = {}): ArrayBuffer {
  const headerSize = 12 + tags.length * 4
  let stringsSize = 0
  for (const t of tags) stringsSize += t.length

  const buf = new ArrayBuffer(headerSize + stringsSize)
  const view = new DataView(buf)

  view.setUint32(0, options.version ?? 1) // version
  view.setUint32(4, options.flags ?? 0) // flags
  view.setUint32(8, tags.length)

  let rangePos = 12
  let stringPos = headerSize
  for (const t of tags) {
    view.setUint16(rangePos, stringPos); rangePos += 2
    view.setUint16(rangePos, t.length); rangePos += 2
    for (let i = 0; i < t.length; i++) {
      view.setUint8(stringPos++, t.charCodeAt(i))
    }
  }
  return buf
}

describe('ltag table parser', () => {
  it('should parse BCP 47 language tags', () => {
    const buf = buildLtag(['en', 'ja-JP', 'zh-Hant'])
    const table = parseLtag(new BinaryReader(buf))

    expect(table.version).toBe(1)
    expect(table.flags).toBe(0)
    expect(table.tags).toEqual(['en', 'ja-JP', 'zh-Hant'])
    expect(table.getTag(1)).toBe('ja-JP')
  })

  it('should parse private-use and grandfathered language tag shapes', () => {
    const buf = buildLtag(['x-a', 'x-private', 'en-x-a', 'en-a-abc', 'i-klingon', 'en-GB-oed'])
    const table = parseLtag(new BinaryReader(buf))

    expect(table.tags).toEqual(['x-a', 'x-private', 'en-x-a', 'en-a-abc', 'i-klingon', 'en-GB-oed'])
  })

  it('should return null for out-of-range indices', () => {
    const buf = buildLtag(['en'])
    const table = parseLtag(new BinaryReader(buf))

    expect(table.getTag(1)).toBeNull()
  })

  it('should handle an empty tag list', () => {
    const buf = buildLtag([])
    const table = parseLtag(new BinaryReader(buf))

    expect(table.tags).toEqual([])
  })

  it('should reject malformed headers', () => {
    expect(() => parseLtag(new BinaryReader(new ArrayBuffer(11)))).toThrow(/length/)
    expect(() => parseLtag(new BinaryReader(buildLtag([], { version: 2 })))).toThrow(/Unsupported ltag/)
    expect(() => parseLtag(new BinaryReader(buildLtag([], { flags: 1 })))).toThrow(/flags/)
  })

  it('should reject range arrays outside the table', () => {
    const buf = buildLtag([])
    new DataView(buf).setUint32(8, 1)

    expect(() => parseLtag(new BinaryReader(buf))).toThrow(/range array/)
  })

  it('should reject invalid string ranges', () => {
    const zeroLength = buildLtag(['en'])
    new DataView(zeroLength).setUint16(14, 0)

    const beforeStrings = buildLtag(['en'])
    new DataView(beforeStrings).setUint16(12, 12)

    const outOfRange = buildLtag(['en'])
    new DataView(outOfRange).setUint16(12, outOfRange.byteLength)
    new DataView(outOfRange).setUint16(14, 1)

    expect(() => parseLtag(new BinaryReader(zeroLength))).toThrow(/greater than zero/)
    expect(() => parseLtag(new BinaryReader(beforeStrings))).toThrow(/string range/)
    expect(() => parseLtag(new BinaryReader(outOfRange))).toThrow(/string range/)
  })

  it('should reject non-ASCII and malformed language tag strings', () => {
    const nonAscii = buildLtag(['en'])
    new DataView(nonAscii).setUint8(16, 0x80)

    const invalidByte = buildLtag(['en_US'])
    const leadingHyphen = buildLtag(['-en'])
    const trailingHyphen = buildLtag(['en-'])
    const doubleHyphen = buildLtag(['en--US'])

    expect(() => parseLtag(new BinaryReader(nonAscii))).toThrow(/ASCII/)
    expect(() => parseLtag(new BinaryReader(invalidByte))).toThrow(/invalid BCP 47/)
    expect(() => parseLtag(new BinaryReader(leadingHyphen))).toThrow(/hyphen/)
    expect(() => parseLtag(new BinaryReader(trailingHyphen))).toThrow(/hyphen/)
    expect(() => parseLtag(new BinaryReader(doubleHyphen))).toThrow(/hyphen/)
  })

  it('should reject invalid BCP 47 subtag structure', () => {
    const oneLetterPrimary = buildLtag(['a-US'])
    const invalidSingletonPrimary = buildLtag(['q-private'])
    const barePrivateUse = buildLtag(['x'])
    const trailingSingleton = buildLtag(['en-x'])
    const shortExtensionSubtag = buildLtag(['en-a-b'])
    const longSubtag = buildLtag(['en-abcdefghi'])

    expect(() => parseLtag(new BinaryReader(oneLetterPrimary))).toThrow(/primary language/)
    expect(() => parseLtag(new BinaryReader(invalidSingletonPrimary))).toThrow(/primary language/)
    expect(() => parseLtag(new BinaryReader(barePrivateUse))).toThrow(/singleton/)
    expect(() => parseLtag(new BinaryReader(trailingSingleton))).toThrow(/singleton/)
    expect(() => parseLtag(new BinaryReader(shortExtensionSubtag))).toThrow(/extension subtag/)
    expect(() => parseLtag(new BinaryReader(longSubtag))).toThrow(/subtag length/)
  })
})
