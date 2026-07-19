import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseZapf } from '../../../src/parsers/tables/zapf.js'

/**
 * Build a Zapf table for glyph 5 with:
 * - flags, a 2-unit UTF-16 unicode list
 * - two identifiers (universal PostScript name + Japanese CID)
 * - a GlyphGroup with two subgroups (first one 32-bit aligned)
 * - a FeatureInfo with one AAT feature and one OpenType tag
 */
function buildZapfWithGroup(): ArrayBuffer {
  //  0: version(2) + unused(2) + extraInfo(4) = 8
  //  8: lookup format 6 with a UInt32 value (glyph 5 -> GlyphInfo at 28)
  // 28: GlyphInfo (27 bytes) + 1 pad
  // 56: extraInfo area; GlyphGroup is 20 bytes, then FeatureInfo
  const buf = new ArrayBuffer(92)
  const view = new DataView(buf)

  view.setUint16(0, 2) // version
  view.setUint32(4, 56) // extraInfo

  // Lookup format 6
  view.setUint16(8, 6)
  view.setUint16(10, 6) // unitSize = glyph(2) + UInt32 offset(4)
  view.setUint16(12, 1) // nUnits
  view.setUint16(20, 5) // glyph
  view.setUint32(22, 28) // GlyphInfo offset from table start

  // GlyphInfo
  view.setUint32(28, 0) // groupOffset (from extraInfo)
  view.setUint32(32, 20) // featOffset (from extraInfo)
  view.setUint8(36, 0x80) // flags: is canonical glyph
  view.setUint8(37, 2) // num16BitUnicodes
  view.setUint16(38, 0x0041)
  view.setUint16(40, 0x0301)
  view.setUint16(42, 2) // numIdentifiers
  // Identifier 1: kind 0 (universal PostScript name), Pascal string "Aacute"
  view.setUint8(44, 0)
  view.setUint8(45, 6)
  const name = 'Aacute'
  for (let i = 0; i < name.length; i++) view.setUint8(46 + i, name.charCodeAt(i))
  // Identifier 2: kind 64 (Japanese CID), 16-bit value
  view.setUint8(52, 64)
  view.setUint16(53, 1234)

  // GlyphGroup at extraInfo + 0
  view.setUint16(56, 0x8002) // hasFlags + 2 subgroups
  // Subgroup 1: isAligned + isSubdivided, name 7, glyphs [5]
  view.setUint16(58, 0xC000)
  view.setUint16(60, 7)
  view.setUint16(62, 1)
  view.setUint16(64, 5)
  // position 66 -> padded to 68 (isAligned)
  // Subgroup 2: no special flags, name 8, glyphs [6]
  view.setUint16(68, 0)
  view.setUint16(70, 8)
  view.setUint16(72, 1)
  view.setUint16(74, 6)

  // FeatureInfo at extraInfo + 20
  view.setUint16(76, 0x0001) // context: line-initial
  view.setUint16(78, 1) // nAATFeatures
  view.setUint16(80, 1) // featureType
  view.setUint16(82, 2) // featureSetting
  view.setUint16(84, 1) // nOTTags (uint16)
  view.setUint8(86, 0x6C); view.setUint8(87, 0x69) // 'li'
  view.setUint8(88, 0x67); view.setUint8(89, 0x61) // 'ga'

  return buf
}

/**
 * Build a Zapf table whose glyph 7 group offset points to a
 * GlyphGroupOffsetArray (bit 14 set) with one valid group.
 */
function buildZapfWithGroupOffsetArray(): ArrayBuffer {
  //  0: header = 8
  //  8: lookup format 6 with a UInt32 value (glyph 7 -> GlyphInfo at 28)
  // 28: GlyphInfo (12 bytes); 40: extraInfo; 52: GlyphGroup
  const buf = new ArrayBuffer(62)
  const view = new DataView(buf)

  view.setUint16(0, 2)
  view.setUint32(4, 40) // extraInfo

  view.setUint16(8, 6)
  view.setUint16(10, 6)
  view.setUint16(12, 1)
  view.setUint16(20, 7)
  view.setUint32(22, 28)

  // GlyphInfo
  view.setUint32(28, 0) // groupOffset
  view.setUint32(32, 0xFFFFFFFF) // featOffset: none
  view.setUint8(36, 0) // flags
  view.setUint8(37, 0) // num16BitUnicodes
  view.setUint16(38, 0) // numIdentifiers

  // GlyphGroupOffsetArray at extraInfo + 0
  view.setUint16(40, 0x4002) // bit 14 set + 2 offsets
  view.setUint16(42, 0) // padding
  view.setUint32(44, 0xFFFFFFFF) // no "alternate forms" group
  view.setUint32(48, 12) // group at extraInfo + 12

  // GlyphGroup at extraInfo + 12 (= 52): 1 subgroup, no flags
  view.setUint16(52, 0x0001)
  view.setUint16(54, 0) // nameIndex
  view.setUint16(56, 2) // numGlyphs
  view.setUint16(58, 9)
  view.setUint16(60, 10)

  return buf
}

describe('Zapf table parser', () => {
  it('should parse glyph info with unicodes and identifiers', () => {
    const table = parseZapf(new BinaryReader(buildZapfWithGroup()))

    expect(table.version).toBe(2)
    const info = table.getGlyphInfo(5)!
    expect(info.flags).toBe(0x80)
    expect(info.unicodes).toEqual([0x0041, 0x0301])
    expect(info.identifiers).toEqual([
      { kind: 0, name: 'Aacute', value: null },
      { kind: 64, name: null, value: 1234 },
    ])
  })

  it('should parse glyph groups including aligned subgroups', () => {
    const table = parseZapf(new BinaryReader(buildZapfWithGroup()))

    const info = table.getGlyphInfo(5)!
    expect(info.groups).toHaveLength(1)
    expect(info.groups[0]!.subgroups).toEqual([
      { flags: 0xC000, nameIndex: 7, glyphs: [5] },
      { flags: 0, nameIndex: 8, glyphs: [6] },
    ])
    expect(info.groupReferences).toEqual([0])
  })

  it('should parse feature info', () => {
    const table = parseZapf(new BinaryReader(buildZapfWithGroup()))

    const info = table.getGlyphInfo(5)!
    expect(info.feature).toEqual({
      context: 0x0001,
      aatFeatures: [{ featureType: 1, featureSetting: 2 }],
      otTags: ['liga'],
    })
  })

  it('should resolve group offset arrays', () => {
    const table = parseZapf(new BinaryReader(buildZapfWithGroupOffsetArray()))

    const info = table.getGlyphInfo(7)!
    expect(info.feature).toBeNull()
    expect(info.unicodes).toEqual([])
    expect(info.groups).toHaveLength(1)
    expect(info.groupReferences).toEqual([null, 12])
    expect(info.groups[0]!.subgroups).toEqual([
      { flags: null, nameIndex: 0, glyphs: [9, 10] },
    ])
  })

  it('should return null for glyphs without info', () => {
    const table = parseZapf(new BinaryReader(buildZapfWithGroup()))
    expect(table.getGlyphInfo(99)).toBeNull()
  })

  it('treats a GlyphInfo offset of 0 as the "no info" sentinel', () => {
    // Shipping fonts (Courier, Papyrus, ...) map most glyphs to offset 0, which
    // is inside the 8-byte header and can never hold a real GlyphInfo.
    const buf = new ArrayBuffer(28)
    const view = new DataView(buf)
    view.setUint16(0, 2) // version
    view.setUint32(4, 28) // extraInfo (unused here)
    view.setUint16(8, 6) // lookup format 6
    view.setUint16(10, 6) // unitSize
    view.setUint16(12, 1) // nUnits
    view.setUint16(20, 5) // glyph 5
    view.setUint32(22, 0) // GlyphInfo offset 0 = sentinel
    const table = parseZapf(new BinaryReader(buf))
    expect(table.getGlyphInfo(5)).toBeNull()
  })
})
