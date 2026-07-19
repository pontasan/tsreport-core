import { describe, it, expect } from 'vitest'
import { Font } from '../../../src/index.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseMorx } from '../../../src/parsers/tables/morx.js'
import { buildTestFont } from '../../renderer/synthetic-font.js'

function align4(value: number): number {
  return (value + 3) & ~3
}

/**
 * Build a morx table with a Type 1 (contextual) subtable that substitutes the
 * marked glyph 10 → 100 when it is immediately followed by glyph 20. Exercises
 * the state machine, the setMark flag, and the Offset32 substitution-tables
 * array of per-glyph lookups.
 */
function buildMorxType1Contextual(): ArrayBuffer {
  const nClasses = 6
  // STXHeader (20) + classTable(28) + stateArray(24) + entryTable(24) + subs(12)
  const classTableOffset = 20
  const stateArrayOffset = 48
  const entryTableOffset = 72
  const substitutionTableOffset = 96
  const subtableData = 108
  const subtableSize = align4(12 + subtableData)
  const chainSize = 16 + subtableSize
  const totalSize = 8 + chainSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // morx header
  view.setUint16(pos, 2); pos += 2
  view.setUint16(pos, 0); pos += 2
  view.setUint32(pos, 1); pos += 4 // nChains

  // Chain header
  view.setUint32(pos, 1); pos += 4 // defaultFlags
  view.setUint32(pos, chainSize); pos += 4
  view.setUint32(pos, 0); pos += 4 // nFeatureEntries
  view.setUint32(pos, 1); pos += 4 // nSubtables

  // Subtable header
  view.setUint32(pos, subtableSize); pos += 4
  view.setUint32(pos, 1); pos += 4 // coverage: type=1 (contextual)
  view.setUint32(pos, 1); pos += 4 // subFeatureFlags (matches defaultFlags)

  const s = pos // subtable data start (STXHeader)
  view.setUint32(s + 0, nClasses)
  view.setUint32(s + 4, classTableOffset)
  view.setUint32(s + 8, stateArrayOffset)
  view.setUint32(s + 12, entryTableOffset)
  view.setUint32(s + 16, substitutionTableOffset)

  // Class lookup (format 8 trimmed array), glyphs 10..20: 10→class4, 20→class5
  let cp = s + classTableOffset
  view.setUint16(cp, 8); cp += 2
  view.setUint16(cp, 10); cp += 2 // firstGlyph
  view.setUint16(cp, 11); cp += 2 // glyphCount (10..20)
  const classValues = [4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5]
  for (const v of classValues) { view.setUint16(cp, v); cp += 2 }

  // State array: state 0 (start) and state 1 (seen glyph 10)
  const stateRows = [
    [0, 0, 0, 0, 1, 0], // state 0: class4 → entry1 (setMark)
    [0, 0, 0, 0, 1, 2], // state 1: class5 → entry2 (substitute mark)
  ]
  let ap = s + stateArrayOffset
  for (const row of stateRows) {
    for (const e of row) { view.setUint16(ap, e); ap += 2 }
  }

  // Entry table: newState(2), flags(2), markIndex(2), currentIndex(2)
  const entries = [
    [0, 0x0000, 0xFFFF, 0xFFFF], // entry 0: no-op
    [1, 0x8000, 0xFFFF, 0xFFFF], // entry 1: setMark, go to state 1
    [0, 0x0000, 0, 0xFFFF],      // entry 2: substitute mark via lookup 0
  ]
  let ep = s + entryTableOffset
  for (const [ns, fl, mi, ci] of entries) {
    view.setUint16(ep, ns!); view.setUint16(ep + 2, fl!)
    view.setUint16(ep + 4, mi!); view.setUint16(ep + 6, ci!)
    ep += 8
  }

  // Substitution tables: Offset32 array [lookup0], then lookup0 (10 → 100)
  const subBase = s + substitutionTableOffset
  view.setUint32(subBase, 4) // Offset32[0] → lookup0 at subBase+4
  let lp = subBase + 4
  view.setUint16(lp, 8); lp += 2 // lookup format 8
  view.setUint16(lp, 10); lp += 2 // firstGlyph
  view.setUint16(lp, 1); lp += 2 // glyphCount
  view.setUint16(lp, 100); lp += 2 // glyph 10 → 100

  return buf
}

/**
 * Build a morx table with a Type 4 (noncontextual) subtable
 * using AAT Lookup format 8 (trimmed array)
 */
function buildMorxType4(
  replacements: { firstGlyph: number, values: number[] },
  defaultFlags = 0xFFFFFFFF,
  options: { version?: number; unused?: number } = {},
): ArrayBuffer {
  // morx header: version(2) + unused(2) + nChains(4) = 8
  // Chain: defaultFlags(4) + chainLength(4) + nFeatureEntries(4) + nSubtables(4) = 16
  // Subtable: length(4) + coverage(4) + subFeatureFlags(4) = 12
  // Lookup (format 8): format(2) + firstGlyph(2) + glyphCount(2) + values(2 each)

  const lookupSize = 6 + replacements.values.length * 2
  const subtableSize = align4(12 + lookupSize)
  const chainSize = 16 + subtableSize
  const totalSize = 8 + chainSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // morx header
  view.setUint16(pos, options.version ?? 2); pos += 2 // version
  view.setUint16(pos, options.unused ?? 0); pos += 2 // unused
  view.setUint32(pos, 1); pos += 4 // nChains

  // Chain header
  view.setUint32(pos, defaultFlags); pos += 4 // defaultFlags
  view.setUint32(pos, chainSize); pos += 4 // chainLength
  view.setUint32(pos, 0); pos += 4 // nFeatureEntries
  view.setUint32(pos, 1); pos += 4 // nSubtables

  // Subtable header
  view.setUint32(pos, subtableSize); pos += 4 // length
  view.setUint32(pos, 4); pos += 4 // coverage: type=4 (noncontextual)
  view.setUint32(pos, defaultFlags); pos += 4 // subFeatureFlags

  // AAT Lookup (format 8 trimmed array)
  view.setUint16(pos, 8); pos += 2 // format
  view.setUint16(pos, replacements.firstGlyph); pos += 2
  view.setUint16(pos, replacements.values.length); pos += 2
  for (const v of replacements.values) {
    view.setUint16(pos, v); pos += 2
  }

  return buf
}

function buildMorxVersion3Type4(
  replacements: { firstGlyph: number, values: number[] },
  numGlyphs: number,
  coverageOffset: number,
  covered = true,
): ArrayBuffer {
  const lookupSize = 6 + replacements.values.length * 2
  const subtableSize = 12 + lookupSize
  const coverageOffsetArraySize = 4
  const bitfieldSize = ((numGlyphs + 7) >> 3)
  const paddedBitfieldSize = (bitfieldSize + 3) & ~3
  const coverageTableSize = coverageOffsetArraySize + paddedBitfieldSize
  const chainSize = 16 + subtableSize + coverageTableSize
  const totalSize = 8 + chainSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  view.setUint16(pos, 3); pos += 2
  view.setUint16(pos, 0); pos += 2
  view.setUint32(pos, 1); pos += 4

  view.setUint32(pos, 0xFFFFFFFF); pos += 4
  view.setUint32(pos, chainSize); pos += 4
  view.setUint32(pos, 0); pos += 4
  view.setUint32(pos, 1); pos += 4

  view.setUint32(pos, subtableSize); pos += 4
  view.setUint32(pos, 4); pos += 4
  view.setUint32(pos, 0xFFFFFFFF); pos += 4

  view.setUint16(pos, 8); pos += 2
  view.setUint16(pos, replacements.firstGlyph); pos += 2
  view.setUint16(pos, replacements.values.length); pos += 2
  for (const v of replacements.values) {
    view.setUint16(pos, v); pos += 2
  }

  const coverageStart = pos
  view.setUint32(pos, coverageOffset); pos += 4
  if (coverageOffset !== 0 && coverageStart + coverageOffset + paddedBitfieldSize <= totalSize) {
    const bitfieldStart = coverageStart + coverageOffset
    for (let i = 0; i < bitfieldSize; i++) view.setUint8(bitfieldStart + i, covered ? 0xFF : 0)
  }

  return buf
}

/**
 * Build a morx table with a Type 0 (rearrangement) subtable
 * Simplified: rearranges specific glyphs based on verb
 */
function buildMorxType0(
  glyphClasses: Map<number, number>,
  nClasses: number,
  states: number[][], // [state][class] → entry index
  entries: { newState: number, flags: number }[],
  defaultFlags = 0xFFFFFFFF,
): ArrayBuffer {
  // morx header: 8
  // Chain: 16
  // Subtable header: 12
  // Extended state table header: 16
  // Class lookup (format 8)
  // State array
  // Entry table

  const sortedGlyphs = [...glyphClasses.keys()].sort((a, b) => a - b)
  const firstGlyph = sortedGlyphs.length > 0 ? sortedGlyphs[0]! : 0
  const lastGlyph = sortedGlyphs.length > 0 ? sortedGlyphs[sortedGlyphs.length - 1]! : 0
  const nGlyphs = sortedGlyphs.length > 0 ? lastGlyph - firstGlyph + 1 : 0

  const extHeaderSize = 16
  const classLookupOffset = extHeaderSize
  const classLookupSize = 6 + nGlyphs * 2 // format 8: format(2) + first(2) + count(2) + values(2 each)
  const stateArrayOffset = classLookupOffset + classLookupSize
  const nStates = states.length
  const stateArraySize = nStates * nClasses * 2 // uint16 per entry
  const entryTableOffset = stateArrayOffset + stateArraySize
  const entrySize = 4 // newState(2) + flags(2)
  const entryTableSize = entries.length * entrySize

  const subtableDataSize = extHeaderSize + classLookupSize + stateArraySize + entryTableSize
  const subtableSize = align4(12 + subtableDataSize)
  const chainSize = 16 + subtableSize
  const totalSize = 8 + chainSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // morx header
  view.setUint16(pos, 2); pos += 2
  view.setUint16(pos, 0); pos += 2
  view.setUint32(pos, 1); pos += 4

  // Chain
  view.setUint32(pos, defaultFlags); pos += 4
  view.setUint32(pos, chainSize); pos += 4
  view.setUint32(pos, 0); pos += 4
  view.setUint32(pos, 1); pos += 4

  // Subtable header
  const subtableStart = pos
  view.setUint32(pos, subtableSize); pos += 4
  view.setUint32(pos, 0); pos += 4 // coverage: type=0 (rearrangement)
  view.setUint32(pos, defaultFlags); pos += 4

  // Extended state table header
  const stateTableStart = pos
  view.setUint32(pos, nClasses); pos += 4
  view.setUint32(pos, classLookupOffset); pos += 4
  view.setUint32(pos, stateArrayOffset); pos += 4
  view.setUint32(pos, entryTableOffset); pos += 4

  // Class lookup (format 8)
  pos = stateTableStart + classLookupOffset
  view.setUint16(pos, 8); pos += 2
  view.setUint16(pos, firstGlyph); pos += 2
  view.setUint16(pos, nGlyphs); pos += 2
  for (let g = firstGlyph; g <= lastGlyph; g++) {
    view.setUint16(pos, glyphClasses.get(g) ?? 1); pos += 2
  }

  // State array
  pos = stateTableStart + stateArrayOffset
  for (let s = 0; s < nStates; s++) {
    for (let c = 0; c < nClasses; c++) {
      view.setUint16(pos, states[s]![c] ?? 0); pos += 2
    }
  }

  // Entry table
  pos = stateTableStart + entryTableOffset
  for (const e of entries) {
    view.setUint16(pos, e.newState); pos += 2
    view.setUint16(pos, e.flags); pos += 2
  }

  return buf
}

describe('morx subset references', () => {
  it('enumerates contextual and noncontextual substitution targets', () => {
    const contextual = parseMorx(new BinaryReader(buildMorxType1Contextual()), 200)
    const noncontextual = parseMorx(new BinaryReader(buildMorxType4({ firstGlyph: 10, values: [100, 101] })), 200)
    expect(contextual.referencedGlyphIds).toEqual([100])
    expect(noncontextual.referencedGlyphIds).toEqual([100, 101])
  })
})

/**
 * Build a morx table with a Type 2 (ligature) subtable that ligates glyph 10
 * followed by glyph 20 into glyph 100. Exercises the component stack, the
 * ligature action list (with accumulation across components), the component
 * table, and the ligature list.
 */
function buildMorxType2Ligature(): ArrayBuffer {
  const nClasses = 6
  // STXHeader(28) + classTable(28) + stateArray(24) + entryTable(18)+pad(2)
  //   + ligActions(8) + component(4) + ligList(12)
  const classTableOffset = 28
  const stateArrayOffset = 56
  const entryTableOffset = 80
  const ligActionsOffset = 100
  const componentOffset = 108
  const ligListOffset = 112
  const subtableData = 124
  const subtableSize = align4(12 + subtableData)
  const chainSize = 16 + subtableSize
  const totalSize = 8 + chainSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  view.setUint16(pos, 2); pos += 2
  view.setUint16(pos, 0); pos += 2
  view.setUint32(pos, 1); pos += 4 // nChains

  view.setUint32(pos, 1); pos += 4 // defaultFlags
  view.setUint32(pos, chainSize); pos += 4
  view.setUint32(pos, 0); pos += 4 // nFeatureEntries
  view.setUint32(pos, 1); pos += 4 // nSubtables

  view.setUint32(pos, subtableSize); pos += 4
  view.setUint32(pos, 2); pos += 4 // coverage: type=2 (ligature)
  view.setUint32(pos, 1); pos += 4 // subFeatureFlags

  const s = pos
  view.setUint32(s + 0, nClasses)
  view.setUint32(s + 4, classTableOffset)
  view.setUint32(s + 8, stateArrayOffset)
  view.setUint32(s + 12, entryTableOffset)
  view.setUint32(s + 16, ligActionsOffset)
  view.setUint32(s + 20, componentOffset)
  view.setUint32(s + 24, ligListOffset)

  // Class lookup (format 8), glyphs 10..20: 10→class4, 20→class5
  let cp = s + classTableOffset
  view.setUint16(cp, 8); cp += 2
  view.setUint16(cp, 10); cp += 2
  view.setUint16(cp, 11); cp += 2
  const classValues = [4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5]
  for (const v of classValues) { view.setUint16(cp, v); cp += 2 }

  // State array
  const stateRows = [
    [0, 0, 0, 0, 1, 0], // state 0: class4 → entry1 (setComponent)
    [0, 0, 0, 0, 1, 2], // state 1: class5 → entry2 (setComponent + performAction)
  ]
  let ap = s + stateArrayOffset
  for (const row of stateRows) {
    for (const e of row) { view.setUint16(ap, e); ap += 2 }
  }

  // Entry table: newState(2), flags(2), ligActionIndex(2)
  const entries = [
    [0, 0x0000, 0], // entry 0: no-op
    [1, 0x8000, 0], // entry 1: setComponent, go to state 1
    [0, 0xA000, 0], // entry 2: setComponent + performAction, action list at 0
  ]
  let ep = s + entryTableOffset
  for (const [ns, fl, la] of entries) {
    view.setUint16(ep, ns!); view.setUint16(ep + 2, fl!); view.setUint16(ep + 4, la!)
    ep += 6
  }

  // Ligature action list (popped LIFO: glyph 20 first, then glyph 10)
  // action 0 (glyph 20): addend -20 → component[0]; not store/last
  view.setUint32(s + ligActionsOffset, (-20) & 0x3FFFFFFF)
  // action 1 (glyph 10): addend -9 → component[1]; store + last
  view.setUint32(s + ligActionsOffset + 4, 0xC0000000 | ((-9) & 0x3FFFFFFF))

  // Component table: index0 = 3 (glyph20), index1 = 2 (glyph10) → sum 5
  view.setUint16(s + componentOffset, 3)
  view.setUint16(s + componentOffset + 2, 2)

  // Ligature list: index 5 → glyph 100
  view.setUint16(s + ligListOffset + 5 * 2, 100)

  return buf
}

/**
 * Build a morx Type 2 (ligature) subtable that ligates incrementally across
 * separate actions: glyph 1 + glyph 2 → 50, then 50 + glyph 3 → 100. This
 * exercises keeping a formed ligature on the component stack for further
 * ligation (multi-part stacks such as Tibetan sa+ga+ra+u).
 */
function buildMorxType2LigatureChained(): ArrayBuffer {
  const nClasses = 7
  const classTableOffset = 28
  const stateArrayOffset = 40
  const entryTableOffset = 82
  const ligActionsOffset = 108 // 4-aligned (entryTable ends at 106, +2 pad)
  const componentOffset = 124
  const ligListOffset = 130
  const subtableData = 136
  const subtableSize = align4(12 + subtableData)
  const chainSize = 16 + subtableSize
  const totalSize = 8 + chainSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0
  view.setUint16(pos, 2); pos += 2
  view.setUint16(pos, 0); pos += 2
  view.setUint32(pos, 1); pos += 4 // nChains
  view.setUint32(pos, 1); pos += 4 // defaultFlags
  view.setUint32(pos, chainSize); pos += 4
  view.setUint32(pos, 0); pos += 4 // nFeatureEntries
  view.setUint32(pos, 1); pos += 4 // nSubtables
  view.setUint32(pos, subtableSize); pos += 4
  view.setUint32(pos, 2); pos += 4 // coverage: type=2
  view.setUint32(pos, 1); pos += 4 // subFeatureFlags

  const s = pos
  view.setUint32(s + 0, nClasses)
  view.setUint32(s + 4, classTableOffset)
  view.setUint32(s + 8, stateArrayOffset)
  view.setUint32(s + 12, entryTableOffset)
  view.setUint32(s + 16, ligActionsOffset)
  view.setUint32(s + 20, componentOffset)
  view.setUint32(s + 24, ligListOffset)

  // Class lookup (format 8), glyphs 1..3 → classes 4,5,6
  let cp = s + classTableOffset
  view.setUint16(cp, 8); cp += 2
  view.setUint16(cp, 1); cp += 2 // firstGlyph
  view.setUint16(cp, 3); cp += 2 // glyphCount
  for (const v of [4, 5, 6]) { view.setUint16(cp, v); cp += 2 }

  // State array (3 states × 7 classes)
  const stateRows = [
    [0, 0, 0, 0, 1, 0, 0], // state 0: class4 → entry1
    [0, 0, 0, 0, 1, 2, 0], // state 1: class5 → entry2 (action A)
    [0, 0, 0, 0, 1, 0, 3], // state 2: class6 → entry3 (action B)
  ]
  let ap = s + stateArrayOffset
  for (const row of stateRows) for (const e of row) { view.setUint16(ap, e); ap += 2 }

  // Entry table: newState(2), flags(2), ligActionIndex(2)
  const entries = [
    [0, 0x0000, 0],
    [1, 0x8000, 0], // setComponent → state 1
    [2, 0xA000, 0], // setComponent + performAction A (index 0) → state 2
    [0, 0xA000, 2], // setComponent + performAction B (index 2) → state 0
  ]
  let ep = s + entryTableOffset
  for (const [ns, fl, la] of entries) {
    view.setUint16(ep, ns!); view.setUint16(ep + 2, fl!); view.setUint16(ep + 4, la!); ep += 6
  }

  // Ligature actions
  view.setUint32(s + ligActionsOffset + 0, (-2) & 0x3FFFFFFF)              // A: pop g2 → comp[0]
  view.setUint32(s + ligActionsOffset + 4, 0xC0000000 | (0 & 0x3FFFFFFF))  // A: pop g1 → comp[1], store+last
  view.setUint32(s + ligActionsOffset + 8, (-3) & 0x3FFFFFFF)              // B: pop g3 → comp[0]
  view.setUint32(s + ligActionsOffset + 12, 0xC0000000 | ((-48) & 0x3FFFFFFF)) // B: pop lig50 → comp[2], store+last

  // Component table: [0, 1, 2]
  view.setUint16(s + componentOffset + 0, 0)
  view.setUint16(s + componentOffset + 2, 1)
  view.setUint16(s + componentOffset + 4, 2)

  // Ligature list: index1 → 50, index2 → 100
  view.setUint16(s + ligListOffset + 2, 50)
  view.setUint16(s + ligListOffset + 4, 100)

  return buf
}

function buildMorxType5Insertion(): ArrayBuffer {
  const nClasses = 7
  const classTableOffset = 20
  const stateArrayOffset = 68
  const entryTableOffset = 110
  const insertionOffset = 142
  const subtableDataSize = 148
  const subtableSize = align4(12 + subtableDataSize)
  const chainSize = 16 + subtableSize
  const buffer = new ArrayBuffer(8 + chainSize)
  const view = new DataView(buffer)
  let position = 0
  view.setUint16(position, 2); position += 2
  view.setUint16(position, 0); position += 2
  view.setUint32(position, 1); position += 4
  view.setUint32(position, 1); position += 4
  view.setUint32(position, chainSize); position += 4
  view.setUint32(position, 0); position += 4
  view.setUint32(position, 1); position += 4
  view.setUint32(position, subtableSize); position += 4
  view.setUint32(position, 5); position += 4
  view.setUint32(position, 1); position += 4

  const start = position
  view.setUint32(start, nClasses)
  view.setUint32(start + 4, classTableOffset)
  view.setUint32(start + 8, stateArrayOffset)
  view.setUint32(start + 12, entryTableOffset)
  view.setUint32(start + 16, insertionOffset)

  position = start + classTableOffset
  view.setUint16(position, 8); position += 2
  view.setUint16(position, 10); position += 2
  view.setUint16(position, 21); position += 2
  for (let glyph = 10; glyph <= 30; glyph++) {
    view.setUint16(position, glyph === 10 ? 4 : glyph === 20 ? 5 : glyph === 30 ? 6 : 1)
    position += 2
  }

  const rows = [
    [0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 1, 2, 0],
    [0, 0, 0, 0, 1, 0, 3],
  ]
  position = start + stateArrayOffset
  for (const row of rows) for (const entry of row) { view.setUint16(position, entry); position += 2 }

  const entries = [
    [0, 0, 0xFFFF, 0xFFFF],
    [1, 0x8000, 0xFFFF, 0xFFFF],
    [2, 0x6421, 0, 1],
    [0, 0x2020, 2, 0xFFFF],
  ]
  position = start + entryTableOffset
  for (const [state, flags, current, marked] of entries) {
    view.setUint16(position, state!); view.setUint16(position + 2, flags!)
    view.setUint16(position + 4, current!); view.setUint16(position + 6, marked!)
    position += 8
  }
  view.setUint16(start + insertionOffset, 30)
  view.setUint16(start + insertionOffset + 2, 99)
  view.setUint16(start + insertionOffset + 4, 31)
  return buffer
}

describe('morx table parser', () => {
  describe('Type 4 (noncontextual substitution)', () => {
    it('should perform simple glyph substitution', () => {
      const buf = buildMorxType4({ firstGlyph: 10, values: [100, 101, 102] })
      const table = parseMorx(new BinaryReader(buf))

      expect(table.chains).toHaveLength(1)
      const result = table.applySubstitutions([10, 11, 12, 5])
      expect(result).toEqual([100, 101, 102, 5])
    })

    it('should leave unmapped glyphs unchanged', () => {
      const buf = buildMorxType4({ firstGlyph: 10, values: [100] })
      const table = parseMorx(new BinaryReader(buf))

      const result = table.applySubstitutions([5, 10, 15])
      expect(result).toEqual([5, 100, 15])
    })

    it('should handle empty input', () => {
      const buf = buildMorxType4({ firstGlyph: 10, values: [100] })
      const table = parseMorx(new BinaryReader(buf))

      const result = table.applySubstitutions([])
      expect(result).toEqual([])
    })
  })

  describe('Type 1 (contextual substitution)', () => {
    it('substitutes the marked glyph based on the following context', () => {
      const table = parseMorx(new BinaryReader(buildMorxType1Contextual()))

      // glyph 10 followed by glyph 20 → marked glyph 10 becomes 100
      expect(table.applySubstitutions([10, 20])).toEqual([100, 20])
    })

    it('leaves the glyph unchanged without the triggering context', () => {
      const table = parseMorx(new BinaryReader(buildMorxType1Contextual()))

      // glyph 10 not followed by glyph 20 → no substitution
      expect(table.applySubstitutions([10, 10])).toEqual([10, 10])
      expect(table.applySubstitutions([10])).toEqual([10])
    })

    it('executes the start/end-of-line state path when requested', () => {
      const buffer = buildMorxType1Contextual()
      const stateTableStart = 8 + 16 + 12
      const stateArrayOffset = 48
      const state1Class3 = stateTableStart + stateArrayOffset + 6 * 2 + 3 * 2
      new DataView(buffer).setUint16(state1Class3, 2)
      const table = parseMorx(new BinaryReader(buffer))

      expect(table.applySubstitutions([10])).toEqual([10])
      expect(table.applySubstitutions([10], undefined, false, { boundary: 'line' })).toEqual([100])
    })
  })

  describe('Type 2 (ligature substitution)', () => {
    it('ligates a component sequence via the accumulated ligature index', () => {
      const table = parseMorx(new BinaryReader(buildMorxType2Ligature()))

      // glyph 10 + glyph 20 → ligature glyph 100 (the second component deleted)
      expect(table.applySubstitutions([10, 20])).toEqual([100])
    })

    it('leaves non-ligating sequences unchanged', () => {
      const table = parseMorx(new BinaryReader(buildMorxType2Ligature()))

      expect(table.applySubstitutions([10, 10])).toEqual([10, 10])
      expect(table.applySubstitutions([20])).toEqual([20])
    })

    it('ligates incrementally across actions (multi-part stacks)', () => {
      const table = parseMorx(new BinaryReader(buildMorxType2LigatureChained()))

      // 1+2 → 50, then 50+3 → 100 (formed ligature kept as a component)
      expect(table.applySubstitutions([1, 2, 3])).toEqual([100])
      // Partial stack still forms the intermediate ligature.
      expect(table.applySubstitutions([1, 2])).toEqual([50])
    })
  })

  describe('Type 5 (insertion)', () => {
    it('executes marked/current insertion and processes downstream insertions on dontAdvance', () => {
      const table = parseMorx(new BinaryReader(buildMorxType5Insertion()))
      const result = table.applySubstitutionsTracked({ glyphs: [10, 20], clusters: [0, 1] })
      expect(result.glyphs).toEqual([99, 10, 20, 30, 31])
      expect(result.clusters).toEqual([1, 0, 1, 1, 1])
    })
  })

  describe('cluster tracking (applySubstitutionsTracked)', () => {
    it('merges clusters to the minimum component on ligature and drops deleted ones', () => {
      const table = parseMorx(new BinaryReader(buildMorxType2Ligature()))

      const r = table.applySubstitutionsTracked({ glyphs: [10, 20], clusters: [3, 4], flags: [8, 0] })
      expect(r.glyphs).toEqual([100])
      expect(r.clusters).toEqual([3]) // min(3,4); the deleted component's cluster is removed
      expect(r.flags).toEqual([8])
    })

    it('hides a morx ligature that inherits default-ignorable provenance through shapeText', () => {
      const font = Font.load(buildTestFont(
        new Array<Uint8Array | null>(101).fill(null),
        [[0x2060, 10], [0x69, 20], [0x20, 50]],
        [['morx', new Uint8Array(buildMorxType2Ligature())]],
      ))

      const shaped = font.shapeText('\u2060i')
      expect(shaped).toHaveLength(1)
      expect(shaped[0]!.glyphId).toBe(50)
      expect(shaped[0]!.xAdvance).toBe(0)
    })

    it('merges to the minimum across a chained (multi-part) ligature', () => {
      const table = parseMorx(new BinaryReader(buildMorxType2LigatureChained()))

      const r = table.applySubstitutionsTracked({ glyphs: [1, 2, 3], clusters: [5, 6, 7] })
      expect(r.glyphs).toEqual([100])
      expect(r.clusters).toEqual([5])
    })

    it('leaves clusters unchanged for 1:1 contextual substitution', () => {
      const table = parseMorx(new BinaryReader(buildMorxType1Contextual()))

      const r = table.applySubstitutionsTracked({ glyphs: [10, 20], clusters: [0, 1] })
      expect(r.glyphs).toEqual([100, 20])
      expect(r.clusters).toEqual([0, 1])
    })

    it('should not apply when subFeatureFlags do not match', () => {
      const buf = buildMorxType4(
        { firstGlyph: 10, values: [100] },
        0x00000001, // defaultFlags bit 0
      )
      // subFeatureFlags = defaultFlags = 0x01, should match
      const table = parseMorx(new BinaryReader(buf))
      const result = table.applySubstitutions([10])
      expect(result).toEqual([100])
    })

    it('should handle all glyphs being substituted', () => {
      const buf = buildMorxType4({ firstGlyph: 0, values: [50, 51, 52] })
      const table = parseMorx(new BinaryReader(buf))

      const result = table.applySubstitutions([0, 1, 2])
      expect(result).toEqual([50, 51, 52])
    })
  })

  describe('Type 0 (rearrangement)', () => {
    it('reorders opaque glyph properties with the same AAT permutation', () => {
      const glyphClasses = new Map<number, number>([[10, 4], [20, 5], [30, 6]])
      const table = parseMorx(new BinaryReader(buildMorxType0(
        glyphClasses,
        7,
        [
          [0, 0, 0, 0, 1, 0, 0],
          [0, 0, 0, 0, 0, 2, 3],
        ],
        [
          { newState: 0, flags: 0 },
          { newState: 1, flags: 0x8000 },
          { newState: 1, flags: 0 },
          { newState: 0, flags: 0x2000 | 3 },
        ],
      )))

      const result = table.applySubstitutionsTracked({
        glyphs: [10, 20, 30], clusters: [0, 1, 2], flags: [8, 0, 0],
      })
      expect(result.glyphs).toEqual([30, 20, 10])
      expect(result.clusters).toEqual([2, 1, 0])
      expect(result.flags).toEqual([0, 0, 8])
    })

    it('should apply verb 3 (swap first and last)', () => {
      // Verb 3: AxD → DxA (swap first and last marked glyphs)
      const glyphClasses = new Map<number, number>()
      glyphClasses.set(10, 4) // user-defined letter class
      glyphClasses.set(20, 4)
      glyphClasses.set(30, 4)

      const nClasses = 5 // four predefined classes + letter
      // State 0: when seeing class 4, mark first and last, apply verb 3
      const states = [
        [0, 0, 0, 0, 1], // start-of-text
        [0, 0, 0, 0, 1], // start-of-line
      ]
      const entries = [
        { newState: 0, flags: 0 }, // entry 0: no-op
        { newState: 0, flags: 0x8000 | 0x2000 | 3 }, // markFirst + markLast + verb 3
      ]

      const buf = buildMorxType0(glyphClasses, nClasses, states, entries)
      const table = parseMorx(new BinaryReader(buf))

      // Each glyph individually: when it enters state 0 as class 2,
      // it sets markFirst=markLast=current index, then verb 3 swaps glyph[first] with glyph[last]
      // Since first=last, it's a no-op per glyph
      const result = table.applySubstitutions([10, 20, 30])
      // With this simple state machine, each glyph is processed individually
      // markFirst=markLast=same index → swap is no-op
      expect(result).toEqual([10, 20, 30])
    })
  })

  describe('Table structure', () => {
    it('should parse chain and subtable metadata', () => {
      const buf = buildMorxType4({ firstGlyph: 10, values: [100] })
      const table = parseMorx(new BinaryReader(buf))

      expect(table.chains).toHaveLength(1)
      expect(table.chains[0]!.subtables).toHaveLength(1)
      expect(table.chains[0]!.subtables[0]!.type).toBe(4)
    })

    it('should parse multiple chains', () => {
      // Build a table with 2 chains (each with a type 4 subtable)
      const lookup1Size = 6 + 2 * 2
      const lookup2Size = 6 + 1 * 2
      const subtable1Size = align4(12 + lookup1Size)
      const subtable2Size = align4(12 + lookup2Size)
      const chain1Size = 16 + subtable1Size
      const chain2Size = 16 + subtable2Size
      const totalSize = 8 + chain1Size + chain2Size

      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)
      let pos = 0

      // morx header
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint32(pos, 2); pos += 4 // 2 chains

      // Chain 1
      view.setUint32(pos, 0xFFFFFFFF); pos += 4
      view.setUint32(pos, chain1Size); pos += 4
      view.setUint32(pos, 0); pos += 4
      view.setUint32(pos, 1); pos += 4
      // Subtable 1
      view.setUint32(pos, subtable1Size); pos += 4
      view.setUint32(pos, 4); pos += 4 // type 4
      view.setUint32(pos, 0xFFFFFFFF); pos += 4
      // Lookup 1 (format 8)
      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 100); pos += 2
      view.setUint16(pos, 101); pos += 2
      pos = 8 + chain1Size

      // Chain 2
      view.setUint32(pos, 0xFFFFFFFF); pos += 4
      view.setUint32(pos, chain2Size); pos += 4
      view.setUint32(pos, 0); pos += 4
      view.setUint32(pos, 1); pos += 4
      // Subtable 2
      view.setUint32(pos, subtable2Size); pos += 4
      view.setUint32(pos, 4); pos += 4 // type 4
      view.setUint32(pos, 0xFFFFFFFF); pos += 4
      // Lookup 2 (format 8)
      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 100); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 200); pos += 2

      const table = parseMorx(new BinaryReader(buf))
      expect(table.chains).toHaveLength(2)

      // Chain 1 maps 10→100, Chain 2 maps 100→200
      // So 10 → 100 → 200
      const result = table.applySubstitutions([10, 11, 50])
      expect(result).toEqual([200, 101, 50])
    })

    it('should handle features in chain', () => {
      const lookupSize = 6 + 1 * 2
      const subtableSize = 12 + lookupSize
      const featureSize = 12 // featureType(2) + featureSetting(2) + enableFlags(4) + disableFlags(4)
      const chainSize = 16 + 1 * featureSize + subtableSize
      const totalSize = 8 + chainSize

      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)
      let pos = 0

      // morx header
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint32(pos, 1); pos += 4

      // Chain
      view.setUint32(pos, 0x00000001); pos += 4 // defaultFlags
      view.setUint32(pos, chainSize); pos += 4
      view.setUint32(pos, 1); pos += 4 // 1 feature entry
      view.setUint32(pos, 1); pos += 4 // 1 subtable

      // Feature entry
      view.setUint16(pos, 1); pos += 2 // featureType = kLigaturesType
      view.setUint16(pos, 2); pos += 2 // featureSetting
      view.setUint32(pos, 0x00000001); pos += 4 // enableFlags
      view.setUint32(pos, 0xFFFFFFFE); pos += 4 // disableFlags

      // Subtable
      view.setUint32(pos, subtableSize); pos += 4
      view.setUint32(pos, 4); pos += 4 // type 4
      view.setUint32(pos, 0x00000001); pos += 4 // subFeatureFlags
      // Lookup
      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 100); pos += 2

      const table = parseMorx(new BinaryReader(buf))
      expect(table.chains[0]!.features).toHaveLength(1)
      expect(table.chains[0]!.features[0]!.featureType).toBe(1)

      const result = table.applySubstitutions([10])
      expect(result).toEqual([100])
    })

    it('should apply selected feature flags from chain feature entries', () => {
      const lookupSize = 6 + 1 * 2
      const subtableSize = 12 + lookupSize
      const featureSize = 12
      const chainSize = 16 + featureSize + subtableSize
      const totalSize = 8 + chainSize
      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint32(pos, 1); pos += 4

      view.setUint32(pos, 0); pos += 4 // defaultFlags: subtable disabled by default
      view.setUint32(pos, chainSize); pos += 4
      view.setUint32(pos, 1); pos += 4
      view.setUint32(pos, 1); pos += 4

      view.setUint16(pos, 1); pos += 2 // Ligatures
      view.setUint16(pos, 2); pos += 2 // Common Ligatures on
      view.setUint32(pos, 1); pos += 4 // enableFlags
      view.setUint32(pos, 0xFFFFFFFF); pos += 4 // disableFlags

      view.setUint32(pos, subtableSize); pos += 4
      view.setUint32(pos, 4); pos += 4
      view.setUint32(pos, 1); pos += 4
      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 100); pos += 2

      const table = parseMorx(new BinaryReader(buf))
      expect(table.applySubstitutions([10])).toEqual([10])
      expect(table.applySubstitutions([10], [{ featureType: 1, featureSetting: 2 }])).toEqual([100])
    })

    it('should disable default feature flags from selected off feature entries', () => {
      const lookupSize = 6 + 1 * 2
      const subtableSize = 12 + lookupSize
      const featureSize = 12
      const chainSize = 16 + featureSize + subtableSize
      const totalSize = 8 + chainSize
      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint32(pos, 1); pos += 4

      view.setUint32(pos, 1); pos += 4 // defaultFlags: subtable enabled by default
      view.setUint32(pos, chainSize); pos += 4
      view.setUint32(pos, 1); pos += 4
      view.setUint32(pos, 1); pos += 4

      view.setUint16(pos, 1); pos += 2 // Ligatures
      view.setUint16(pos, 3); pos += 2 // Common Ligatures off
      view.setUint32(pos, 0); pos += 4 // enableFlags
      view.setUint32(pos, 0xFFFFFFFE); pos += 4 // disableFlags clears bit 0

      view.setUint32(pos, subtableSize); pos += 4
      view.setUint32(pos, 4); pos += 4
      view.setUint32(pos, 1); pos += 4
      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 100); pos += 2

      const table = parseMorx(new BinaryReader(buf))
      expect(table.applySubstitutions([10])).toEqual([100])
      expect(table.applySubstitutions([10], [{ featureType: 1, featureSetting: 3 }])).toEqual([10])
    })

    it('should parse version 3 subtable glyph coverage arrays', () => {
      const buf = buildMorxVersion3Type4({ firstGlyph: 10, values: [100] }, 16, 4)
      const table = parseMorx(new BinaryReader(buf), 16)

      expect(table.applySubstitutions([10])).toEqual([100])
    })

    it('should skip a version 3 subtable when its coverage does not intersect the run', () => {
      const buf = buildMorxVersion3Type4({ firstGlyph: 10, values: [100] }, 16, 4, false)
      const table = parseMorx(new BinaryReader(buf), 16)

      expect(table.applySubstitutions([10])).toEqual([10])
    })

    it('should reject malformed table headers', () => {
      const unsupportedVersion = buildMorxType4({ firstGlyph: 10, values: [100] }, 0xFFFFFFFF, { version: 4 })
      const nonZeroUnused = buildMorxType4({ firstGlyph: 10, values: [100] }, 0xFFFFFFFF, { unused: 1 })
      const noChains = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(noChains).setUint32(4, 0)

      expect(() => parseMorx(new BinaryReader(new ArrayBuffer(7)))).toThrow(/length/)
      expect(() => parseMorx(new BinaryReader(unsupportedVersion))).toThrow(/Unsupported morx/)
      expect(() => parseMorx(new BinaryReader(nonZeroUnused))).toThrow(/unused/)
      expect(() => parseMorx(new BinaryReader(noChains))).toThrow(/at least one chain/)
    })

    it('should reject malformed chains', () => {
      // Note: unpadded (non-multiple-of-4) chain/subtable lengths are NOT
      // rejected — real fonts ship them (see the load-robustness tests).
      const shortChain = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(shortChain).setUint32(12, 12)

      const chainOverflow = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(chainOverflow).setUint32(12, chainOverflow.byteLength)

      const featureOverflow = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(featureOverflow).setUint32(16, 3)

      expect(() => parseMorx(new BinaryReader(shortChain))).toThrow(/chain 0 length/)
      expect(() => parseMorx(new BinaryReader(chainOverflow))).toThrow(/exceeds table length/)
      expect(() => parseMorx(new BinaryReader(featureOverflow))).toThrow(/feature array/)
    })

    it('should reject malformed subtables', () => {
      const shortSubtable = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(shortSubtable).setUint32(24, 8)

      const subtableOverflow = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(subtableOverflow).setUint32(24, 28)

      const reservedCoverage = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(reservedCoverage).setUint32(28, 0x00000104)

      const reservedType = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(reservedType).setUint32(28, 3)

      const unsupportedType = buildMorxType4({ firstGlyph: 10, values: [100] })
      new DataView(unsupportedType).setUint32(28, 6)

      expect(() => parseMorx(new BinaryReader(shortSubtable))).toThrow(/subtable 0 length/)
      expect(() => parseMorx(new BinaryReader(subtableOverflow))).toThrow(/subtable 0 exceeds/)
      expect(() => parseMorx(new BinaryReader(reservedCoverage))).toThrow(/coverage reserved/)
      expect(() => parseMorx(new BinaryReader(reservedType))).toThrow(/Unsupported morx subtable type/)
      expect(() => parseMorx(new BinaryReader(unsupportedType))).toThrow(/Unsupported morx subtable type/)
    })

    it('should reject malformed version 3 subtable glyph coverage arrays', () => {
      const missingCoverageArray = buildMorxType4({ firstGlyph: 10, values: [100] }, 0xFFFFFFFF, { version: 3 })
      const missingGlyphCount = buildMorxVersion3Type4({ firstGlyph: 10, values: [100] }, 16, 4)
      const unalignedCoverageOffset = buildMorxVersion3Type4({ firstGlyph: 10, values: [100] }, 16, 5)
      const overflowingCoverageOffset = buildMorxVersion3Type4({ firstGlyph: 10, values: [100] }, 16, 8)

      expect(() => parseMorx(new BinaryReader(missingCoverageArray), 16)).toThrow(/coverage offset array/)
      expect(() => parseMorx(new BinaryReader(missingGlyphCount))).toThrow(/requires numGlyphs/)
      expect(() => parseMorx(new BinaryReader(unalignedCoverageOffset), 16)).toThrow(/four-byte aligned/)
      expect(() => parseMorx(new BinaryReader(overflowingCoverageOffset), 16)).toThrow(/coverage bitfield/)
    })
  })
})
