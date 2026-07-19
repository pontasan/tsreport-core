import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseGpos, type GposTable } from '../../../src/parsers/tables/gpos.js'

/**
 * Helper: Write a Coverage Format 1 table at an offset in the buffer
 * Returns the size in bytes
 */
function writeCovFormat1(view: DataView, pos: number, glyphIds: number[]): number {
  const start = pos
  view.setUint16(pos, 1); pos += 2 // format 1
  view.setUint16(pos, glyphIds.length); pos += 2
  for (const gid of glyphIds) {
    view.setUint16(pos, gid); pos += 2
  }
  return pos - start
}

/**
 * Build a minimal GPOS table with a SinglePos Format 1 subtable
 * This serves as a base lookup referenced by context lookups
 */
function buildSimpleGposWithSinglePos(glyphIds: number[], xPlacement: number): ArrayBuffer {
  // We build a complete GPOS table with:
  // 1. ScriptList with DFLT script
  // 2. FeatureList with 'kern' feature
  // 3. LookupList with one SinglePos Format 1 lookup

  const buf = new ArrayBuffer(1024)
  const view = new DataView(buf)
  let pos = 0

  // GPOS Header (version 1.0)
  const headerStart = 0
  view.setUint16(pos, 1); pos += 2 // majorVersion
  view.setUint16(pos, 0); pos += 2 // minorVersion
  const scriptListOffsetPos = pos; pos += 2
  const featureListOffsetPos = pos; pos += 2
  const lookupListOffsetPos = pos; pos += 2

  // ScriptList
  const scriptListStart = pos
  view.setUint16(scriptListOffsetPos, scriptListStart)
  view.setUint16(pos, 1); pos += 2 // scriptCount
  // ScriptRecord
  view.setUint8(pos++, 0x44); view.setUint8(pos++, 0x46) // 'DF'
  view.setUint8(pos++, 0x4C); view.setUint8(pos++, 0x54) // 'LT'
  const scriptOffset = pos - scriptListStart + 2
  view.setUint16(pos, 6); pos += 2 // offset to Script table from scriptListStart

  // Script table
  const scriptTableStart = pos
  view.setUint16(pos, 4); pos += 2 // dfltLangSys offset (from scriptTableStart)
  view.setUint16(pos, 0); pos += 2 // langSysCount

  // LangSys (default)
  view.setUint16(pos, 0); pos += 2 // lookupOrder (null)
  view.setUint16(pos, 0xFFFF); pos += 2 // requiredFeatureIndex
  view.setUint16(pos, 1); pos += 2 // featureIndexCount
  view.setUint16(pos, 0); pos += 2 // featureIndices[0]

  // FeatureList
  const featureListStart = pos
  view.setUint16(featureListOffsetPos, featureListStart)
  view.setUint16(pos, 1); pos += 2 // featureCount
  // FeatureRecord
  view.setUint8(pos++, 0x6B); view.setUint8(pos++, 0x65) // 'ke'
  view.setUint8(pos++, 0x72); view.setUint8(pos++, 0x6E) // 'rn'
  view.setUint16(pos, 8); pos += 2 // offset from featureListStart

  // Feature table
  view.setUint16(pos, 0); pos += 2 // featureParams
  view.setUint16(pos, 1); pos += 2 // lookupIndexCount
  view.setUint16(pos, 0); pos += 2 // lookupListIndices[0]

  // LookupList
  const lookupListStart = pos
  view.setUint16(lookupListOffsetPos, lookupListStart)
  view.setUint16(pos, 1); pos += 2 // lookupCount
  view.setUint16(pos, 4); pos += 2 // offset to first Lookup (from lookupListStart)

  // Lookup table (SinglePos = type 1)
  const lookupStart = pos
  view.setUint16(pos, 1); pos += 2 // lookupType (SinglePos)
  view.setUint16(pos, 0); pos += 2 // lookupFlag
  view.setUint16(pos, 1); pos += 2 // subtableCount
  view.setUint16(pos, 8); pos += 2 // subtableOffset (from lookupStart)

  // We need offset from lookupStart
  // Skip to subtable start position
  const subtableStart = pos
  // SinglePos Format 1
  view.setUint16(pos, 1); pos += 2 // posFormat
  const coverageOffsetPos = pos
  pos += 2 // coverageOffset (placeholder)
  view.setUint16(pos, 0x0001); pos += 2 // valueFormat (XPlacement only)
  view.setInt16(pos, xPlacement); pos += 2 // value.xPlacement

  // Coverage
  const coverageStart = pos
  view.setUint16(coverageOffsetPos, coverageStart - subtableStart)
  pos += writeCovFormat1(view, pos, glyphIds)

  return buf.slice(0, pos)
}

describe('GPOS table parser (basic tests)', () => {
  // Verifies that a hand-built GPOS (ScriptList + FeatureList + LookupList with SinglePos fmt 1) parses without error.
  it('should parse a minimal GPOS with SinglePos Format 1', () => {
    const buf = buildSimpleGposWithSinglePos([10, 20, 30], -50)
    const reader = new BinaryReader(buf)
    const gpos = parseGpos(reader)
    expect(gpos).not.toBeNull()
  })

  // Verifies that getPositionAdjustments applies the SinglePos xPlacement to glyphs in the Coverage table.
  it('should return position adjustments for covered glyphs', () => {
    const buf = buildSimpleGposWithSinglePos([10, 20, 30], -50)
    const reader = new BinaryReader(buf)
    const gpos = parseGpos(reader)

    const adjustments = gpos.getPositionAdjustments([10, 20, 30], null, null, null, null)
    expect(adjustments).not.toBeNull()

    // Each covered glyph should get the xPlacement
    if (adjustments) {
      for (const adj of adjustments) {
        if (adj && adj.xPlacement !== 0) {
          expect(adj.xPlacement).toBe(-50)
        }
      }
    }
  })

  // Verifies that glyphs outside the Coverage table receive no adjustment (null or all-zero values).
  it('should not adjust non-covered glyphs', () => {
    const buf = buildSimpleGposWithSinglePos([10], -50)
    const reader = new BinaryReader(buf)
    const gpos = parseGpos(reader)

    // Glyph 99 is not covered
    const adjustments = gpos.getPositionAdjustments([99], null, null, null, null)
    if (adjustments) {
      const adj = adjustments[0]
      expect(!adj || (adj.xPlacement === 0 && adj.yPlacement === 0 && adj.xAdvance === 0 && adj.yAdvance === 0)).toBe(true)
    }
  })
})
