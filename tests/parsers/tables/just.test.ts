import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseJust } from '../../../src/parsers/tables/just.js'

const FIXED = 65536

/**
 * Build a just table with a horizontal direction containing:
 * - a width delta cluster for `glyphId`
 * - a postcompensation record for `glyphId` with all five action types
 */
function buildJust(glyphId: number): ArrayBuffer {
  //   0: version(4) + format(2) + horizOffset(2) + vertOffset(2) = 10
  //  10: justification header: justClassTableOffset(2) + wdcTableOffset(2) + pcTableOffset(2)
  //  16: WDC lookup (format 6, 1 unit) = 16 bytes
  //  32: WDC table: cluster = count(4) + 1 pair (24) = 28 bytes
  //  60: postcompensation table:
  //  60:   pc lookup (format 6, 1 unit) = 16 bytes
  //  76:   action record: actionCount(4) + subrecords
  //        type 0 (decomposition, 2 glyphs): 8 + 12 + 4 = 24
  //        type 1 (unconditional add): 8 + 2 + 2 pad = 12
  //        type 2 (conditional add): 8 + 8 = 16
  //        type 3 (stretch): 8
  //        type 4 (ductile): 8 + 16 = 24
  //        type 5 (repeated add): 8 + 4 = 12
  const wdcStart = 32
  const pcStart = 60
  const actionsStart = 76
  const total = actionsStart + 4 + 24 + 12 + 16 + 8 + 24 + 12

  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)

  view.setUint32(0, 0x00010000)
  view.setUint16(4, 0) // format
  view.setUint16(6, 10) // horizOffset
  view.setUint16(8, 0) // vertOffset

  // Justification header (offsets from the start of the just table)
  view.setUint16(10, 0) // justClassTableOffset (none)
  view.setUint16(12, wdcStart)
  view.setUint16(14, pcStart)

  // WDC lookup: glyph -> offset 0 from the start of the WDC table
  view.setUint16(16, 6)
  view.setUint16(18, 4)
  view.setUint16(20, 1)
  view.setUint16(28, glyphId)
  view.setUint16(30, 0)

  // WidthDeltaCluster
  view.setUint32(wdcStart, 1) // count
  view.setUint32(wdcStart + 4, 0) // justClass
  view.setInt32(wdcStart + 8, 1.0 * FIXED) // beforeGrowLimit
  view.setInt32(wdcStart + 12, -1.0 * FIXED) // beforeShrinkLimit
  view.setInt32(wdcStart + 16, 2.0 * FIXED) // afterGrowLimit
  view.setInt32(wdcStart + 20, -0.5 * FIXED) // afterShrinkLimit
  view.setUint16(wdcStart + 24, 0x1001) // growFlags: unlimited + priority 1
  view.setUint16(wdcStart + 26, 0x0002) // shrinkFlags: priority 2

  // Postcompensation lookup: glyph -> offset 16 from the start of the pc table
  view.setUint16(pcStart, 6)
  view.setUint16(pcStart + 2, 4)
  view.setUint16(pcStart + 4, 1)
  view.setUint16(pcStart + 12, glyphId)
  view.setUint16(pcStart + 14, actionsStart - pcStart)

  let pos = actionsStart
  view.setUint32(pos, 6); pos += 4 // actionCount

  // Type 0: decomposition
  view.setUint16(pos, 1); view.setUint16(pos + 2, 0); view.setUint32(pos + 4, 24)
  view.setInt32(pos + 8, 0.5 * FIXED) // lowerLimit
  view.setInt32(pos + 12, 1.5 * FIXED) // upperLimit
  view.setUint16(pos + 16, 3) // order
  view.setUint16(pos + 18, 2) // decomposedCount
  view.setUint16(pos + 20, 70)
  view.setUint16(pos + 22, 71)
  pos += 24

  // Type 1: unconditional add glyph (2 padding bytes for longword alignment)
  view.setUint16(pos, 1); view.setUint16(pos + 2, 1); view.setUint32(pos + 4, 12)
  view.setUint16(pos + 8, 99) // addGlyph
  pos += 12

  // Type 2: conditional add glyph
  view.setUint16(pos, 1); view.setUint16(pos + 2, 2); view.setUint32(pos + 4, 16)
  view.setInt32(pos + 8, 1.25 * FIXED) // substThreshold
  view.setUint16(pos + 12, 88) // addGlyph
  view.setUint16(pos + 14, 89) // substGlyph
  pos += 16

  // Type 3: stretch (no action data)
  view.setUint16(pos, 2); view.setUint16(pos + 2, 3); view.setUint32(pos + 4, 8)
  pos += 8

  // Type 4: ductile
  view.setUint16(pos, 1); view.setUint16(pos + 2, 4); view.setUint32(pos + 4, 24)
  view.setUint8(pos + 8, 0x64); view.setUint8(pos + 9, 0x75) // 'du'
  view.setUint8(pos + 10, 0x63); view.setUint8(pos + 11, 0x74) // 'ct'
  view.setInt32(pos + 12, 1.0 * FIXED) // minimumLimit
  view.setInt32(pos + 16, 1.0 * FIXED) // noStretchValue
  view.setInt32(pos + 20, 2.0 * FIXED) // maximumLimit
  pos += 24

  // Type 5: repeated add glyph
  view.setUint16(pos, 1); view.setUint16(pos + 2, 5); view.setUint32(pos + 4, 12)
  view.setUint16(pos + 8, 0) // flags
  view.setUint16(pos + 10, 77) // glyph
  pos += 12

  return buf
}

function buildJustWithCategoryState(glyphId: number): ArrayBuffer {
  const wdcStart = 32
  const classStart = 60
  const classLength = 40
  const buf = new ArrayBuffer(classStart + classLength)
  const view = new DataView(buf)

  view.setUint32(0, 0x00010000)
  view.setUint16(4, 0)
  view.setUint16(6, 10)
  view.setUint16(8, 0)
  view.setUint16(10, classStart)
  view.setUint16(12, wdcStart)
  view.setUint16(14, 0)

  view.setUint16(16, 6)
  view.setUint16(18, 4)
  view.setUint16(20, 1)
  view.setUint16(28, glyphId)
  view.setUint16(30, 0)
  view.setUint32(wdcStart, 1)
  view.setUint32(wdcStart + 4, 0)

  view.setUint16(classStart, classLength)
  view.setUint16(classStart + 2, 0)
  view.setUint32(classStart + 4, 0)

  const state = classStart + 8
  view.setUint16(state, 5)
  view.setUint16(state + 2, 8)
  view.setUint16(state + 4, 14)
  view.setUint16(state + 6, 24)
  view.setUint16(state + 8, glyphId)
  view.setUint16(state + 10, 1)
  view.setUint8(state + 12, 4)
  view.setUint8(state + 13, 0)
  for (let row = 0; row < 2; row++) {
    for (let cls = 0; cls < 5; cls++) view.setUint8(state + 14 + row * 5 + cls, cls === 4 ? 1 : 0)
  }
  view.setUint16(state + 24, 14)
  view.setUint16(state + 26, 0)
  view.setUint16(state + 28, 14)
  view.setUint16(state + 30, 3)
  return buf
}

describe('just table parser', () => {
  it('should parse the header and direction presence', () => {
    const table = parseJust(new BinaryReader(buildJust(12)))

    expect(table.version).toBe(1)
    expect(table.format).toBe(0)
    expect(table.horizontal).not.toBeNull()
    expect(table.vertical).toBeNull()
    expect(table.horizontal!.classTable).toBeNull()
  })

  it('should parse width delta clusters', () => {
    const table = parseJust(new BinaryReader(buildJust(12)))

    const pairs = table.horizontal!.getWidthDeltaPairs(12)
    expect(pairs).toEqual([{
      justClass: 0,
      beforeGrowLimit: 1.0,
      beforeShrinkLimit: -1.0,
      afterGrowLimit: 2.0,
      afterShrinkLimit: -0.5,
      growFlags: 0x1001,
      shrinkFlags: 0x0002,
    }])
    expect(table.horizontal!.getWidthDeltaPairs(13)).toBeNull()
  })

  it('should parse all postcompensation action types', () => {
    const table = parseJust(new BinaryReader(buildJust(12)))

    const actions = table.horizontal!.getPostcompActions(12)!
    expect(actions).toHaveLength(6)

    expect(actions[0]).toEqual({
      actionClass: 1, actionType: 0,
      lowerLimit: 0.5, upperLimit: 1.5, order: 3, glyphs: [70, 71],
    })
    expect(actions[1]).toEqual({ actionClass: 1, actionType: 1, addGlyph: 99 })
    expect(actions[2]).toEqual({
      actionClass: 1, actionType: 2,
      substThreshold: 1.25, addGlyph: 88, substGlyph: 89,
    })
    expect(actions[3]).toEqual({ actionClass: 2, actionType: 3 })
    expect(actions[4]).toEqual({
      actionClass: 1, actionType: 4,
      variationAxis: 'duct', minimumLimit: 1.0, noStretchValue: 1.0, maximumLimit: 2.0,
    })
    expect(actions[5]).toEqual({ actionClass: 1, actionType: 5, flags: 0, glyph: 77 })

    expect(table.horizontal!.getPostcompActions(13)).toBeNull()
  })

  it('executes the contextual category state table', () => {
    const table = parseJust(new BinaryReader(buildJustWithCategoryState(12)))

    expect(Array.from(table.horizontal!.getCategories([12], 'line'))).toEqual([3])
    expect(Array.from(table.horizontal!.getCategories([13], 'line'))).toEqual([0])
  })

  it('rejects reserved width flags and malformed postcompensation records', () => {
    const reservedFlags = buildJust(12)
    new DataView(reservedFlags).setUint16(32 + 24, 0x2000)
    expect(() => parseJust(new BinaryReader(reservedFlags))).toThrow(/reserved bits/)

    const unalignedAction = buildJust(12)
    new DataView(unalignedAction).setUint32(76 + 4 + 4, 10)
    expect(() => parseJust(new BinaryReader(unalignedAction))).toThrow(/decomposition action is truncated/)

    const repeatedFlags = buildJust(12)
    new DataView(repeatedFlags).setUint16(172, 1)
    expect(() => parseJust(new BinaryReader(repeatedFlags))).toThrow(/flags must be zero/)
  })

  it('rejects unknown table versions and formats', () => {
    const version = buildJust(12)
    new DataView(version).setUint32(0, 0x00020000)
    expect(() => parseJust(new BinaryReader(version))).toThrow(/version/)

    const format = buildJust(12)
    new DataView(format).setUint16(4, 1)
    expect(() => parseJust(new BinaryReader(format))).toThrow(/format/)
  })
})
