import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseKern } from '../../../src/parsers/tables/kern.js'

/**
 * Build a kern table with Format 1 (state machine) subtable — Apple AAT version 1
 * Simplified: creates a state machine that produces kern values for specific glyph pairs
 */
function buildKernFormat1Apple(
  pairs: { left: number, right: number, value: number }[],
  coverageFlags = 0,
  tupleIndex = 0,
): ArrayBuffer {
  // Apple kern header: version(2) + padding(2) + nTables(4) = 8
  // Subtable header: length(4) + coverage(2) + tupleIndex(2) = 8
  // State table header: nClasses(2) + classTableOffset(2) + stateArrayOffset(2) + entryTableOffset(2) = 8
  // Class table: firstGlyph(2) + nGlyphs(2) + classArray (1 byte per glyph)
  // State array: states × nClasses (1 byte per cell)
  // Entry table: entries × (newStateOffset(2) + flags(2)) = 4 per entry;
  //   the kern-value-list offset is embedded in the low 14 bits of flags (0x3FFF)
  // Kern values: int16 per pair

  // Assign classes after the four predefined classes (EOT/OOB/deleted/EOL).
  const glyphToClass = new Map<number, number>()
  let nextClass = 4
  const allGlyphs = new Set<number>()
  for (const p of pairs) {
    allGlyphs.add(p.left)
    allGlyphs.add(p.right)
  }
  for (const g of allGlyphs) {
    glyphToClass.set(g, nextClass++)
  }

  const nClasses = nextClass
  const sortedGlyphs = [...allGlyphs].sort((a, b) => a - b)
  const firstGlyph = sortedGlyphs.length > 0 ? sortedGlyphs[0]! : 0
  const lastGlyph = sortedGlyphs.length > 0 ? sortedGlyphs[sortedGlyphs.length - 1]! : 0
  const nGlyphs = sortedGlyphs.length > 0 ? lastGlyph - firstGlyph + 1 : 0

  // State machine layout:
  // State 0: start-of-text; state 1: start-of-line.
  // For each unique left glyph, we transition to a unique state (2..n)
  // State n (after seeing left glyph): for each right glyph, produce kern value
  const leftGlyphs = [...new Set(pairs.map(p => p.left))]
  const nStates = 2 + leftGlyphs.length // two predefined starts + one per left glyph
  const leftGlyphToState = new Map<number, number>()
  for (let i = 0; i < leftGlyphs.length; i++) {
    leftGlyphToState.set(leftGlyphs[i]!, i + 2)
  }

  // Build state table offsets
  const stateTableStart = 8 + 8 // after apple header + subtable header
  const stateHeaderSize = 8

  const classTableOffset = stateHeaderSize
  const classTableSize = 4 + nGlyphs

  const stateArrayOffset = classTableOffset + classTableSize
  const stateArraySize = nStates * nClasses

  const entryTableOffset = (stateArrayOffset + stateArraySize + 1) & ~1

  // Build entries: one default entry (0) + one per transition
  // Entry 0: no action, stay in state 0
  // Entry for left glyph in state 0: transition to left state, push
  // Entry for right glyph in left state: kern value, return to state 0
  const entries: { newStateOffset: number, flags: number, valueOffset: number }[] = []
  entries.push({ newStateOffset: stateArrayOffset, flags: 0, valueOffset: 0 }) // entry 0: no-op

  // Entry for each left glyph transition from state 0
  const leftEntryStart = entries.length
  for (let i = 0; i < leftGlyphs.length; i++) {
    entries.push({
      newStateOffset: stateArrayOffset + (i + 2) * nClasses,
      flags: 0x8000, // push
      valueOffset: 0,
    })
  }

  // Entry for each pair (right glyph in the appropriate left-glyph state)
  const kernValues: number[] = []
  const pairEntryStart = entries.length
  const pairEntryMap = new Map<string, number>() // "leftState,rightClass" → entryIndex
  for (const p of pairs) {
    const leftState = leftGlyphToState.get(p.left)!
    const rightClass = glyphToClass.get(p.right)!
    const key = `${leftState},${rightClass}`
    const kernIdx = kernValues.length
    kernValues.push(p.value)
    const entryIdx = entries.length
    entries.push({
      newStateOffset: stateArrayOffset, // return to start
      flags: 0x8000, // has kern value
      valueOffset: 0, // will be patched
    })
    pairEntryMap.set(key, entryIdx)
  }

  const entrySize = 4 // newStateOffset(2) + flags(2) (value offset embedded in flags)
  const entryTableSize = entries.length * entrySize
  const kernValuesOffset = entryTableOffset + entryTableSize
  const kernValuesSize = kernValues.length * 2

  // Patch valueOffset for pair entries (relative to stateTableStart)
  for (let i = 0; i < pairs.length; i++) {
    entries[pairEntryStart + i]!.valueOffset = kernValuesOffset + i * 2
  }

  const subtableLength = 8 + kernValuesOffset + kernValuesSize
  const totalSize = 8 + subtableLength

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Apple kern header
  view.setUint16(pos, 1); pos += 2 // version major = 1
  view.setUint16(pos, 0); pos += 2 // version minor
  view.setUint32(pos, 1); pos += 4 // nTables

  // Subtable header
  const subtableStart = pos
  view.setUint32(pos, subtableLength); pos += 4
  view.setUint16(pos, coverageFlags | 1); pos += 2 // coverage + format 1
  view.setUint16(pos, tupleIndex); pos += 2

  // State table header (at stateTableStart)
  view.setUint16(pos, nClasses); pos += 2
  view.setUint16(pos, classTableOffset); pos += 2
  view.setUint16(pos, stateArrayOffset); pos += 2
  view.setUint16(pos, entryTableOffset); pos += 2

  // Class table
  const classStart = stateTableStart + classTableOffset
  pos = classStart
  view.setUint16(pos, firstGlyph); pos += 2
  view.setUint16(pos, nGlyphs); pos += 2
  for (let g = firstGlyph; g <= lastGlyph; g++) {
    const cls = glyphToClass.get(g) ?? 1 // OOB
    view.setUint8(pos++, cls)
  }

  // State array
  pos = stateTableStart + stateArrayOffset
  for (let s = 0; s < nStates; s++) {
    for (let c = 0; c < nClasses; c++) {
      if (s === 0 || s === 1) {
        // Start state: check for left glyph transitions
        let entryIdx = 0
        for (let li = 0; li < leftGlyphs.length; li++) {
          if (glyphToClass.get(leftGlyphs[li]!) === c) {
            entryIdx = leftEntryStart + li
            break
          }
        }
        view.setUint8(pos++, entryIdx)
      } else {
        // Left-glyph state: check for right glyph kern
        const key = `${s},${c}`
        const entryIdx = pairEntryMap.get(key) ?? 0
        view.setUint8(pos++, entryIdx)
      }
    }
  }

  // Entry table (4 bytes each; value-list offset embedded in the flags low bits)
  pos = stateTableStart + entryTableOffset
  for (const e of entries) {
    view.setUint16(pos, e.newStateOffset); pos += 2
    view.setUint16(pos, e.flags | (e.valueOffset & 0x3FFF)); pos += 2
  }

  // Kern values (absolute position = stateTableStart + kernValuesOffset).
  // Each pair encodes a single-element value list, so the low (end-of-list) bit
  // is set on the value. The consumer masks it off (v & ~1), so kern values are
  // effectively even — matching real AAT 'kern' format-1 fonts.
  pos = stateTableStart + kernValuesOffset
  for (const v of kernValues) {
    view.setInt16(pos, v | 1); pos += 2
  }

  return buf
}

describe('kern format 1 (state machine)', () => {
  // The format-1 state machine is a runtime positioner (not flattened to pairs):
  // applyContextualKerning drives it over the glyph run. In-stream horizontal
  // kerning adds the value to both x-advance and x-offset; the value lands on the
  // right glyph of the pair (the last one pushed before the value action).
  it('should produce kern deltas for defined glyph pairs from the state machine', () => {
    const buf = buildKernFormat1Apple([
      { left: 10, right: 20, value: -50 },
      { left: 10, right: 30, value: -24 },
    ])

    const kern = parseKern(new BinaryReader(buf), 100)

    const a = kern.applyContextualKerning([10, 20], false)
    expect(a.xAdvance[1]).toBe(-50)
    expect(a.xOffset[1]).toBe(-50)

    const b = kern.applyContextualKerning([10, 30], false)
    expect(b.xAdvance[1]).toBe(-24)
  })

  it('should use the predefined start-of-line state for line shaping', () => {
    const kern = parseKern(new BinaryReader(buildKernFormat1Apple([
      { left: 10, right: 20, value: -50 },
    ])), 100)

    expect(kern.applyContextualKerning([10, 20], false, 'line').xAdvance[1]).toBe(-50)
  })

  // Verifies that glyph pairs without a state-machine transition kern to 0.
  it('should return 0 deltas for pairs not in the state machine', () => {
    const buf = buildKernFormat1Apple([
      { left: 10, right: 20, value: -50 },
    ])

    const kern = parseKern(new BinaryReader(buf), 100)
    const r = kern.applyContextualKerning([10, 99, 20], false)
    expect(r.xAdvance).toEqual([0, 0, 0])
  })

  // Verifies that positive (expanding) kern values survive the int16 read in the state machine.
  it('should handle positive kern values', () => {
    const buf = buildKernFormat1Apple([
      { left: 5, right: 6, value: 30 },
    ])

    const kern = parseKern(new BinaryReader(buf), 100)
    const r = kern.applyContextualKerning([5, 6], false)
    expect(r.xAdvance[1]).toBe(30)
  })

  // Verifies the minimal case of a state machine encoding exactly one kern pair.
  it('should handle single pair', () => {
    const buf = buildKernFormat1Apple([
      { left: 1, right: 2, value: -10 },
    ])

    const kern = parseKern(new BinaryReader(buf), 100)
    const r = kern.applyContextualKerning([1, 2], false)
    expect(r.xAdvance[1]).toBe(-10)
  })

  // Verifies that distinct left glyphs map to separate states with independent kern values.
  it('should handle multiple left glyphs', () => {
    const buf = buildKernFormat1Apple([
      { left: 10, right: 20, value: -50 },
      { left: 30, right: 20, value: -30 },
    ])

    const kern = parseKern(new BinaryReader(buf), 100)
    expect(kern.applyContextualKerning([10, 20], false).xAdvance[1]).toBe(-50)
    expect(kern.applyContextualKerning([30, 20], false).xAdvance[1]).toBe(-30)
  })

  it('should route vertical and cross-stream state-machine values to their axes', () => {
    const vertical = parseKern(new BinaryReader(buildKernFormat1Apple(
      [{ left: 10, right: 20, value: -50 }], 0x8000,
    )), 100)
    const cross = parseKern(new BinaryReader(buildKernFormat1Apple(
      [{ left: 10, right: 20, value: 30 }], 0x4000,
    )), 100)

    const v = vertical.applyContextualPositioning([10, 20], 'vertical', false)
    expect(v.yAdvance).toEqual([0, -50])
    expect(v.yOffset).toEqual([0, -50])
    expect(v.xAdvance).toEqual([0, 0])

    const c = cross.applyContextualPositioning([10, 20], 'horizontal', false)
    expect(c.yOffset).toEqual([0, 30])
    expect(c.xAdvance).toEqual([0, 0])
  })

  it('should scale Apple variation state-machine values by tupleIndex', () => {
    const kern = parseKern(new BinaryReader(buildKernFormat1Apple(
      [{ left: 10, right: 20, value: -40 }], 0x2000, 1,
    )), 100)

    expect(kern.applyContextualPositioning([10, 20], 'horizontal', false).xAdvance).toEqual([0, 0])
    expect(kern.applyContextualPositioning([10, 20], 'horizontal', false, [0, 0.5]).xAdvance)
      .toEqual([0, -20])
    expect(() => kern.applyContextualPositioning([10, 20], 'horizontal', false, [1]))
      .toThrow(/tuple index 1 out of range/)
  })
})
