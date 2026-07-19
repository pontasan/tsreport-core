import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseAcnt } from '../../../src/parsers/tables/acnt.js'

/**
 * Build an acnt table for glyphs 100..101:
 * - glyph 100: format 0 description (single accent via secondary index 0)
 * - glyph 101: format 1 description (two accents via the extension subtable)
 */
function buildAcnt(): ArrayBuffer {
  //  0: header (20 bytes)
  // 20: descriptions (2 glyphs x 4 bytes)
  // 28: extension subtable (2 entries x 2 bytes)
  // 32: secondary subtable (2 entries x 3 bytes)
  const buf = new ArrayBuffer(38)
  const view = new DataView(buf)

  view.setUint32(0, 0x00010000)
  view.setUint16(4, 100) // firstAccentGlyphIndex
  view.setUint16(6, 101) // lastAccentGlyphIndex
  view.setUint32(8, 20) // descriptionOffset
  view.setUint32(12, 28) // extensionOffset
  view.setUint32(16, 32) // secondaryOffset

  // Glyph 100: format 0 — primary glyph 60, attachment point 5, secondary index 0
  view.setUint32(20, (60 << 16) | (5 << 8) | 0)
  // Glyph 101: format 1 — primary glyph 61, extension offset 0
  view.setUint32(24, (0x80000000 | (61 << 16) | 0) >>> 0)

  // Extension entries for glyph 101:
  // entry 1: not last, secondary index 1, attachment point 7
  view.setUint16(28, (1 << 8) | 7)
  // entry 2: last, secondary index 0, attachment point 9
  view.setUint16(30, 0x8000 | (0 << 8) | 9)

  // Secondary entries: (glyph, attachment point)
  view.setUint16(32, 80); view.setUint8(34, 3) // index 0
  view.setUint16(35, 81); view.setUint8(37, 4) // index 1

  return buf
}

describe('acnt table parser', () => {
  it('should parse format 0 descriptions (single accent)', () => {
    const table = parseAcnt(new BinaryReader(buildAcnt()))

    expect(table.firstAccentGlyphIndex).toBe(100)
    expect(table.lastAccentGlyphIndex).toBe(101)

    const attachment = table.getAttachment(100)!
    expect(attachment.primaryGlyphIndex).toBe(60)
    expect(attachment.components).toEqual([{
      primaryAttachmentPoint: 5,
      secondaryGlyphIndex: 80,
      secondaryGlyphAttachmentNumber: 3,
    }])
  })

  it('should parse format 1 descriptions (multiple accents)', () => {
    const table = parseAcnt(new BinaryReader(buildAcnt()))

    const attachment = table.getAttachment(101)!
    expect(attachment.primaryGlyphIndex).toBe(61)
    expect(attachment.components).toEqual([
      { primaryAttachmentPoint: 7, secondaryGlyphIndex: 81, secondaryGlyphAttachmentNumber: 4 },
      { primaryAttachmentPoint: 9, secondaryGlyphIndex: 80, secondaryGlyphAttachmentNumber: 3 },
    ])
  })

  it('should return null outside the accented glyph range', () => {
    const table = parseAcnt(new BinaryReader(buildAcnt()))

    expect(table.getAttachment(99)).toBeNull()
    expect(table.getAttachment(102)).toBeNull()
  })

  it('rejects unsupported versions', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint32(0, 0x00020000)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('Unsupported acnt table version')
  })

  it('rejects inverted accented glyph ranges', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint16(4, 102)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('firstAccentGlyphIndex must be <= lastAccentGlyphIndex')
  })

  it('rejects truncated description data', () => {
    const buf = buildAcnt().slice(0, 27)
    const view = new DataView(buf)
    view.setUint32(12, 0)
    view.setUint32(16, 24)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('acnt description data exceeds acnt table length')
  })

  it('rejects secondary data that overlaps descriptions', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint32(16, 24)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('acnt secondaryOffset overlaps description data')
  })

  it('rejects extension data that overlaps descriptions', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint32(12, 24)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('acnt extensionOffset overlaps description data')
  })

  it('rejects extension data after secondary data', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint32(12, 36)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('acnt extensionOffset must precede secondaryOffset')
  })

  it('rejects format 1 descriptions without extension data', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint32(12, 0)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('uses extension data but extensionOffset is zero')
  })

  it('rejects primary components inside the accented glyph range', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint32(20, (100 << 16) | (5 << 8) | 0)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('primaryGlyphIndex 100 must be outside the accented glyph range')
  })

  it('rejects secondary glyphs inside the accented glyph range', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint16(32, 100)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('secondaryGlyphIndex 100 must be outside the accented glyph range')
  })

  it('rejects secondary indices outside the secondary data table', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint32(20, (60 << 16) | (5 << 8) | 2)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('secondaryInfoIndex 2 exceeds secondary entry count 2')
  })

  it('rejects extension offsets that point into secondary data', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint32(24, (0x80000000 | (61 << 16) | 4) >>> 0)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('extension offset exceeds extension data')
  })

  it('rejects unterminated extension component lists', () => {
    const buf = buildAcnt()
    new DataView(buf).setUint16(30, (0 << 8) | 9)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('extension data is missing a terminating last component flag')
  })

  it('rejects secondary data with more than 255 entries', () => {
    const buf = new ArrayBuffer(20 + 4 + 256 * 3)
    const view = new DataView(buf)
    view.setUint32(0, 0x00010000)
    view.setUint16(4, 100)
    view.setUint16(6, 100)
    view.setUint32(8, 20)
    view.setUint32(12, 0)
    view.setUint32(16, 24)
    view.setUint32(20, (60 << 16) | (5 << 8) | 0)

    expect(() => parseAcnt(new BinaryReader(buf))).toThrow('acnt secondary data must contain at most 255 entries')
  })
})
