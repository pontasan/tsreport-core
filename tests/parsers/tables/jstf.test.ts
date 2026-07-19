import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { buildCompactJstfTable, parseJstf } from '../../../src/parsers/tables/jstf.js'

/**
 * Helper: write an ExtenderGlyph table at an offset in the buffer
 * Returns the number of bytes written
 */
function writeExtenderGlyphs(view: DataView, offset: number, glyphIds: number[]): number {
  let pos = offset
  view.setUint16(pos, glyphIds.length); pos += 2
  for (const gid of glyphIds) {
    view.setUint16(pos, gid); pos += 2
  }
  return pos - offset
}

/**
 * Helper: write a JstfModList at an offset
 */
function writeModList(view: DataView, offset: number, indices: number[]): number {
  let pos = offset
  view.setUint16(pos, indices.length); pos += 2
  for (const idx of indices) {
    view.setUint16(pos, idx); pos += 2
  }
  return pos - offset
}

/**
 * Build a minimal JSTF table with one script, default lang, one priority
 */
function buildJstfTable(options: {
  scriptTag: string
  extenderGlyphs?: number[]
  gsubShrinkEnable?: number[]
  gposExtendEnable?: number[]
}): ArrayBuffer {
  // Allocate a generous buffer
  const buf = new ArrayBuffer(512)
  const view = new DataView(buf)
  let pos = 0

  // JSTF Header: version(4) + jstfScriptCount(2) = 6
  view.setUint32(pos, 0x00010000); pos += 4 // version 1.0
  view.setUint16(pos, 1); pos += 2 // 1 script

  // JstfScriptRecord: tag(4) + offset(2) = 6
  const scriptTag = options.scriptTag
  for (let c = 0; c < 4; c++) {
    view.setUint8(pos++, scriptTag.charCodeAt(c))
  }
  const scriptOffsetPos = pos
  pos += 2 // placeholder for script offset

  // JstfScript starts here
  const scriptStart = pos
  view.setUint16(scriptOffsetPos, scriptStart)

  // JstfScript: extenderGlyphOffset(2) + dfltLangSysOffset(2) + jstfLangSysCount(2) = 6
  const extGlyphOffsetPos = pos; pos += 2
  const dfltLangSysOffsetPos = pos; pos += 2
  view.setUint16(pos, 0); pos += 2 // 0 additional lang systems

  // ExtenderGlyph (Coverage table)
  if (options.extenderGlyphs && options.extenderGlyphs.length > 0) {
    const extStart = pos
    view.setUint16(extGlyphOffsetPos, extStart - scriptStart)
    pos += writeExtenderGlyphs(view, pos, options.extenderGlyphs)
  } else {
    view.setUint16(extGlyphOffsetPos, 0)
  }

  // DfltLangSys: jstfPriorityCount(2) + priorityOffsets(2 each)
  const dfltStart = pos
  view.setUint16(dfltLangSysOffsetPos, dfltStart - scriptStart)
  view.setUint16(pos, 1); pos += 2 // 1 priority
  const priorityOffsetPos = pos; pos += 2 // placeholder

  // JstfPriority: 10 offsets (each 2 bytes) = 20 bytes
  const priorityStart = pos
  view.setUint16(priorityOffsetPos, priorityStart - dfltStart)

  // Priority fields (10 offsets from priority start)
  const gsubShrinkEnablePos = pos; pos += 2 // gsubShrinkageEnable
  pos += 2 // gsubShrinkageDisable = 0
  pos += 2 // gposShrinkageEnable = 0
  pos += 2 // gposShrinkageDisable = 0
  pos += 2 // shrinkJstfMax = 0
  const gsubExtendEnablePos = pos - 2 // Actually let me recalculate
  // Let me redo this more carefully
  pos = priorityStart

  // 10 offsets, all relative to priorityStart
  const offFields = new Array(10).fill(0)
  const gsubShrinkEnableFieldPos = pos; pos += 20 // reserve 10 * 2 bytes

  // Write GSUB shrinkage enable mod list
  if (options.gsubShrinkEnable && options.gsubShrinkEnable.length > 0) {
    const modListStart = pos
    const relOffset = modListStart - priorityStart
    view.setUint16(gsubShrinkEnableFieldPos, relOffset)
    pos += writeModList(view, pos, options.gsubShrinkEnable)
  }

  // Write GPOS extension enable mod list (field index 7)
  if (options.gposExtendEnable && options.gposExtendEnable.length > 0) {
    const modListStart = pos
    const relOffset = modListStart - priorityStart
    view.setUint16(gsubShrinkEnableFieldPos + 14, relOffset) // offset field 7 (0-indexed)
    pos += writeModList(view, pos, options.gposExtendEnable)
  }

  return buf
}

function buildTwoScriptJstf(firstTag: string, secondTag: string): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1); w.writeUint16(0)
  w.writeUint16(2)
  w.writeTag(firstTag); w.writeUint16(18)
  w.writeTag(secondTag); w.writeUint16(24)
  w.writeUint16(0); w.writeUint16(0); w.writeUint16(0)
  w.writeUint16(0); w.writeUint16(0); w.writeUint16(0)
  return w.toArrayBuffer()
}

function buildLangRecordJstf(firstLangTag: string, secondLangTag: string): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1); w.writeUint16(0)
  w.writeUint16(1)
  w.writeTag('arab'); w.writeUint16(12)
  w.writeUint16(0); w.writeUint16(0); w.writeUint16(2)
  w.writeTag(firstLangTag); w.writeUint16(18)
  w.writeTag(secondLangTag); w.writeUint16(20)
  w.writeUint16(0)
  w.writeUint16(0)
  return w.toArrayBuffer()
}

function buildJstfMaxTable(lookupType: number): ArrayBuffer {
  const w = new BinaryWriter()
  w.writeUint16(1); w.writeUint16(0)
  w.writeUint16(1)
  w.writeTag('latn'); w.writeUint16(12)
  w.writeUint16(0); w.writeUint16(6); w.writeUint16(0)
  w.writeUint16(1); w.writeUint16(4)
  w.writeUint16(0); w.writeUint16(0); w.writeUint16(0); w.writeUint16(0); w.writeUint16(20)
  w.writeUint16(0); w.writeUint16(0); w.writeUint16(0); w.writeUint16(0); w.writeUint16(0)
  w.writeUint16(1); w.writeUint16(4)
  w.writeUint16(lookupType); w.writeUint16(0); w.writeUint16(1); w.writeUint16(8)
  w.writeUint16(1); w.writeUint16(8); w.writeUint16(0x0004); w.writeInt16(15)
  w.writeUint16(1); w.writeUint16(1); w.writeUint16(2)
  return w.toArrayBuffer()
}

describe('JSTF table parser', () => {
  it('rebuilds extender and embedded JstfMax glyph references with compact IDs', () => {
    const extenderSource = buildJstfTable({ scriptTag: 'arab', extenderGlyphs: [100, 200, 300] })
    const extenderSubset = buildCompactJstfTable(
      new BinaryReader(extenderSource),
      new Map([[100, 1], [200, 2], [300, 3]]),
    )
    expect(parseJstf(new BinaryReader(extenderSubset.buffer, extenderSubset.byteOffset, extenderSubset.byteLength))
      .getExtenderGlyphs('arab')).toEqual([1, 2, 3])

    const maxSource = buildJstfMaxTable(1)
    const maxSubset = buildCompactJstfTable(new BinaryReader(maxSource), new Map([[2, 1]]))
    const priority = parseJstf(new BinaryReader(maxSubset.buffer, maxSubset.byteOffset, maxSubset.byteLength))
      .getPriorities('latn')[0]!
    expect(priority.shrinkageJstfMax!.getPositionAdjustments([1])[0]!.xAdvance).toBe(15)
  })

  // Verifies that a minimal one-script JSTF table yields a priority with its GSUB shrinkage-enable lookup list.
  it('should parse a minimal JSTF table', () => {
    const buf = buildJstfTable({
      scriptTag: 'latn',
      gsubShrinkEnable: [0, 1, 2],
    })
    const reader = new BinaryReader(buf)
    const jstf = parseJstf(reader)

    const priorities = jstf.getPriorities('latn')
    expect(priorities.length).toBe(1)
    expect(priorities[0]!.gsubShrinkageEnableLookups).toEqual([0, 1, 2])
  })

  // Verifies that the ExtenderGlyph coverage table is parsed into the script's extender glyph list.
  it('should return extender glyphs', () => {
    const buf = buildJstfTable({
      scriptTag: 'arab',
      extenderGlyphs: [100, 200, 300],
    })
    const reader = new BinaryReader(buf)
    const jstf = parseJstf(reader)

    const extenders = jstf.getExtenderGlyphs('arab')
    expect(extenders).toEqual([100, 200, 300])
  })

  // Verifies that queries for a script tag absent from the table return empty arrays rather than failing.
  it('should return empty for unknown script', () => {
    const buf = buildJstfTable({ scriptTag: 'latn' })
    const reader = new BinaryReader(buf)
    const jstf = parseJstf(reader)

    expect(jstf.getPriorities('cyrl')).toEqual([])
    expect(jstf.getExtenderGlyphs('cyrl')).toEqual([])
  })

  // Verifies that NULL (zero) mod-list offsets in a JstfPriority produce empty lookup arrays.
  it('should return empty arrays for missing mod lists', () => {
    const buf = buildJstfTable({
      scriptTag: 'latn',
      // No mod lists specified
    })
    const reader = new BinaryReader(buf)
    const jstf = parseJstf(reader)

    const priorities = jstf.getPriorities('latn')
    expect(priorities.length).toBe(1)
    const p = priorities[0]!
    expect(p.gsubShrinkageDisableLookups).toEqual([])
    expect(p.gposShrinkageEnableLookups).toEqual([])
    expect(p.gposShrinkageDisableLookups).toEqual([])
  })

  // Verifies that the extensionEnableGPOS field (offset index 7) is parsed into gposExtensionEnableLookups.
  it('should handle GPOS extension enable lookups', () => {
    const buf = buildJstfTable({
      scriptTag: 'latn',
      gposExtendEnable: [5, 10],
    })
    const reader = new BinaryReader(buf)
    const jstf = parseJstf(reader)

    const priorities = jstf.getPriorities('latn')
    expect(priorities.length).toBe(1)
    expect(priorities[0]!.gposExtensionEnableLookups).toEqual([5, 10])
  })

  // Verifies compatible minor extensions and the unknown-major boundary.
  it('accepts compatible minor extensions and rejects unknown major versions', () => {
    const buf = buildJstfTable({ scriptTag: 'latn' })
    new DataView(buf).setUint16(2, 1)
    expect(() => parseJstf(new BinaryReader(buf))).not.toThrow()
    new DataView(buf).setUint16(0, 2)
    expect(() => parseJstf(new BinaryReader(buf))).toThrow('Unsupported JSTF table version: 2.1')
  })

  // Verifies that top-level JstfScriptRecord entries follow the required alphabetical order.
  it('rejects unsorted script records', () => {
    expect(() => parseJstf(new BinaryReader(buildTwoScriptJstf('latn', 'arab'))))
      .toThrow('JSTF script records must be in alphabetical order')
  })

  // Verifies that JstfLangSysRecord entries follow the required alphabetical order.
  it('rejects unsorted language-system records', () => {
    expect(() => parseJstf(new BinaryReader(buildLangRecordJstf('URD ', 'FAR '))))
      .toThrow('JSTF LangSys records must be in alphabetical order')
  })

  // Verifies that ExtenderGlyph glyph IDs are strictly increasing.
  it('rejects unsorted extender glyphs', () => {
    expect(() => parseJstf(new BinaryReader(buildJstfTable({
      scriptTag: 'arab',
      extenderGlyphs: [300, 200],
    })))).toThrow('JSTF ExtenderGlyph entries must be in increasing order')
  })

  // Verifies that JstfModList lookup indices are strictly increasing.
  it('rejects unsorted modification lookup indices', () => {
    expect(() => parseJstf(new BinaryReader(buildJstfTable({
      scriptTag: 'latn',
      gsubShrinkEnable: [3, 2],
    })))).toThrow('JSTF GSUB shrinkage enable list lookup indices must be in increasing order')
  })

  // Verifies that JstfMax tables parse embedded GPOS lookup data into executable positioning.
  it('parses and executes JstfMax lookups', () => {
    const jstf = parseJstf(new BinaryReader(buildJstfMaxTable(1)))
    const priorities = jstf.getPriorities('latn')

    expect(priorities[0]!.shrinkageJstfMax).not.toBeNull()
    expect(priorities[0]!.shrinkageJstfMax!.getPositionAdjustments([2, 3])).toEqual([
      { xPlacement: 0, yPlacement: 0, xAdvance: 15, yAdvance: 0 },
      { xPlacement: 0, yPlacement: 0, xAdvance: 0, yAdvance: 0 },
    ])
  })

  // Verifies that JstfMax rejects contextual GPOS lookup types, which the JSTF specification excludes.
  it('rejects contextual JstfMax GPOS lookups', () => {
    expect(() => parseJstf(new BinaryReader(buildJstfMaxTable(7))))
      .toThrow('JSTF shrinkage JstfMax lookup 0 must not use contextual GPOS lookup type 7')
  })
})
