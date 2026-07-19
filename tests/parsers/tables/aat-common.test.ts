import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import {
  parseExtendedStateTable,
  parseStateTable,
  parseAatLookupTable,
  applyAatRearrangement,
  runAatStateTable,
  type AatStateTable,
} from '../../../src/parsers/tables/aat-common.js'

// --- Lookup Table tests ---

describe('AAT Lookup Table parser', () => {
  it('should reject unsupported lookup formats', () => {
    const buf = new ArrayBuffer(2)
    const view = new DataView(buf)
    view.setUint16(0, 12)

    expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
      'Unsupported AAT lookup format: 12',
    )
  })

  describe('format 0 (simple array)', () => {
    // Verifies that format 0 reads exactly numGlyphs 16-bit values starting at glyph 0.
    it('should parse one value per glyph when numGlyphs is supplied', () => {
      const values = [0, 11, 22, 0]
      const buf = new ArrayBuffer(2 + values.length * 2)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 0); pos += 2
      for (const value of values) {
        view.setUint16(pos, value); pos += 2
      }

      const result = parseAatLookupTable(new BinaryReader(buf), 0, values.length)
      expect(result.get(0)).toBe(0)
      expect(result.get(1)).toBe(11)
      expect(result.get(2)).toBe(22)
      expect(result.get(3)).toBe(0)
      expect(result.get(4)).toBeUndefined()
    })

    // Verifies that format 0 cannot be parsed without the external glyph-count boundary.
    it('should reject format 0 without numGlyphs', () => {
      const buf = new ArrayBuffer(4)
      const view = new DataView(buf)
      view.setUint16(0, 0)
      view.setUint16(2, 9)

      expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
        'AAT lookup format 0 requires numGlyphs',
      )
    })
  })

  describe('format 6 (single table)', () => {
    // Verifies that format 6 binary-search pairs map each listed glyph to its value and unlisted glyphs to undefined.
    it('should parse glyph-value pairs', () => {
      // format(2) + unitSize(2) + nUnits(2) + searchRange(2) + entrySelector(2) + rangeShift(2) = 12
      // + pairs: glyph(2) + value(2) = 4 each
      // + sentinel: 0xFFFF + 0 = 4
      const nUnits = 3
      const buf = new ArrayBuffer(12 + (nUnits + 1) * 4)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 6); pos += 2 // format
      view.setUint16(pos, 4); pos += 2 // unitSize
      view.setUint16(pos, nUnits); pos += 2
      view.setUint16(pos, 0); pos += 2 // searchRange
      view.setUint16(pos, 0); pos += 2 // entrySelector
      view.setUint16(pos, 0); pos += 2 // rangeShift

      // Pairs
      view.setUint16(pos, 10); pos += 2; view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 20); pos += 2; view.setUint16(pos, 3); pos += 2
      view.setUint16(pos, 30); pos += 2; view.setUint16(pos, 4); pos += 2
      // Sentinel
      view.setUint16(pos, 0xFFFF); pos += 2; view.setUint16(pos, 0); pos += 2

      const result = parseAatLookupTable(new BinaryReader(buf), 0)
      expect(result.get(10)).toBe(2)
      expect(result.get(20)).toBe(3)
      expect(result.get(30)).toBe(4)
      expect(result.get(15)).toBeUndefined()
    })

    // Verifies that Format 6 uses unitSize - glyphSize as the variable lookup value size.
    it('should parse variable-size values', () => {
      const nUnits = 2
      const unitSize = 6
      const buf = new ArrayBuffer(12 + (nUnits + 1) * unitSize)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 6); pos += 2
      view.setUint16(pos, unitSize); pos += 2
      view.setUint16(pos, nUnits + 1); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2

      view.setUint16(pos, 10); pos += 2; view.setUint32(pos, 0x12345678); pos += 4
      view.setUint16(pos, 20); pos += 2; view.setUint32(pos, 0x23456789); pos += 4
      view.setUint16(pos, 0xFFFF); pos += 2; view.setUint32(pos, 0); pos += 4

      const result = parseAatLookupTable(new BinaryReader(buf), 0)
      expect(result.get(10)).toBe(0x12345678)
      expect(result.get(20)).toBe(0x23456789)
    })

    it('should reject unsorted glyph-value pairs', () => {
      const buf = new ArrayBuffer(12 + 2 * 4)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 6); pos += 2
      view.setUint16(pos, 4); pos += 2
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 20); pos += 2; view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 10); pos += 2; view.setUint16(pos, 2); pos += 2

      expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
        'AAT lookup format 6 glyph 10 must be greater than previous glyph 20',
      )
    })

    it('should reject invalid format 6 value sizes', () => {
      const buf = new ArrayBuffer(12)
      const view = new DataView(buf)
      view.setUint16(0, 6)
      view.setUint16(2, 5)
      view.setUint16(4, 0)

      expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
        'AAT lookup format 6 invalid value size 3',
      )
    })
  })

  describe('format 8 (trimmed array)', () => {
    // Verifies that format 8 maps consecutive glyphs starting at firstGlyph and leaves glyphs outside the trimmed range undefined.
    it('should parse trimmed array', () => {
      // format(2) + firstGlyph(2) + glyphCount(2) + values(2 each)
      const firstGlyph = 5
      const values = [10, 20, 30, 40]
      const buf = new ArrayBuffer(6 + values.length * 2)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 8); pos += 2 // format
      view.setUint16(pos, firstGlyph); pos += 2
      view.setUint16(pos, values.length); pos += 2
      for (const v of values) {
        view.setUint16(pos, v); pos += 2
      }

      const result = parseAatLookupTable(new BinaryReader(buf), 0)
      expect(result.get(5)).toBe(10)
      expect(result.get(6)).toBe(20)
      expect(result.get(7)).toBe(30)
      expect(result.get(8)).toBe(40)
      expect(result.get(4)).toBeUndefined()
      expect(result.get(9)).toBeUndefined()
    })

    it('should preserve pseudo-glyph ranges beyond numGlyphs', () => {
      const buf = new ArrayBuffer(6 + 4)
      const view = new DataView(buf)
      view.setUint16(0, 8)
      view.setUint16(2, 3)
      view.setUint16(4, 2)
      view.setUint16(6, 10)
      view.setUint16(8, 20)

      const lookup = parseAatLookupTable(new BinaryReader(buf), 0, 4)
      expect(lookup.get(3)).toBe(10)
      expect(lookup.get(4)).toBe(20)
    })
  })

  describe('format 10 (extended trimmed array)', () => {
    function buildFormat10(unitSize: number, firstGlyph: number, values: number[]): ArrayBuffer {
      const buf = new ArrayBuffer(8 + values.length * unitSize)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, unitSize); pos += 2
      view.setUint16(pos, firstGlyph); pos += 2
      view.setUint16(pos, values.length); pos += 2
      for (const value of values) {
        if (unitSize === 1) {
          view.setUint8(pos, value); pos += 1
        } else if (unitSize === 2) {
          view.setUint16(pos, value); pos += 2
        } else if (unitSize === 4) {
          view.setUint32(pos, value); pos += 4
        } else if (unitSize === 8) {
          view.setBigUint64(pos, BigInt(value)); pos += 8
        }
      }

      return buf
    }

    // Verifies Format 10 honors every allowed unitSize instead of always reading uint32 values.
    it('should parse all allowed value unit sizes', () => {
      const lookup1 = parseAatLookupTable(new BinaryReader(buildFormat10(1, 3, [7, 8])), 0)
      expect(lookup1.get(3)).toBe(7)
      expect(lookup1.get(4)).toBe(8)

      const lookup2 = parseAatLookupTable(new BinaryReader(buildFormat10(2, 5, [0x1234])), 0)
      expect(lookup2.get(5)).toBe(0x1234)

      const lookup4 = parseAatLookupTable(new BinaryReader(buildFormat10(4, 6, [0x12345678])), 0)
      expect(lookup4.get(6)).toBe(0x12345678)

      const lookup8 = parseAatLookupTable(new BinaryReader(buildFormat10(8, 7, [0x1fffffff])), 0)
      expect(lookup8.get(7)).toBe(0x1fffffff)
    })

    it('should reject invalid format 10 unit sizes', () => {
      const buf = new ArrayBuffer(8)
      const view = new DataView(buf)
      view.setUint16(0, 10)
      view.setUint16(2, 3)
      view.setUint16(4, 0)
      view.setUint16(6, 1)

      expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
        'AAT lookup format 10 invalid unitSize 3',
      )
    })

    it('should reject truncated format 10 value arrays', () => {
      const buf = new ArrayBuffer(9)
      const view = new DataView(buf)
      view.setUint16(0, 10)
      view.setUint16(2, 2)
      view.setUint16(4, 0)
      view.setUint16(6, 2)
      view.setUint8(8, 1)

      expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
        'AAT lookup format 10 values exceeds AAT lookup table length',
      )
    })
  })

  describe('format 2 (segment single)', () => {
    // Verifies that format 2 assigns one value to every glyph inside each [firstGlyph, lastGlyph] segment, excluding gaps between segments.
    it('should parse segment ranges', () => {
      // format(2) + unitSize(2) + nUnits(2) + searchRange(2) + entrySelector(2) + rangeShift(2) = 12
      // + segments: lastGlyph(2) + firstGlyph(2) + value(2) = 6 each
      // + sentinel
      const buf = new ArrayBuffer(12 + 3 * 6) // 2 segments + sentinel
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 2); pos += 2 // format
      view.setUint16(pos, 6); pos += 2 // unitSize
      view.setUint16(pos, 3); pos += 2 // nUnits (includes sentinel)
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2

      // Segment 1: glyphs 10-15 → value 5
      view.setUint16(pos, 15); pos += 2 // lastGlyph
      view.setUint16(pos, 10); pos += 2 // firstGlyph
      view.setUint16(pos, 5); pos += 2  // value

      // Segment 2: glyphs 20-25 → value 7
      view.setUint16(pos, 25); pos += 2
      view.setUint16(pos, 20); pos += 2
      view.setUint16(pos, 7); pos += 2

      // Sentinel
      view.setUint16(pos, 0xFFFF); pos += 2
      view.setUint16(pos, 0xFFFF); pos += 2
      view.setUint16(pos, 0); pos += 2

      const result = parseAatLookupTable(new BinaryReader(buf), 0)
      expect(result.get(10)).toBe(5)
      expect(result.get(12)).toBe(5)
      expect(result.get(15)).toBe(5)
      expect(result.get(20)).toBe(7)
      expect(result.get(25)).toBe(7)
      expect(result.get(16)).toBeUndefined()
    })

    // Verifies that Format 2 uses unitSize - segmentHeaderSize as the variable lookup value size.
    it('should parse variable-size segment values', () => {
      const unitSize = 8
      const buf = new ArrayBuffer(12 + 2 * unitSize)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, unitSize); pos += 2
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2

      view.setUint16(pos, 12); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint32(pos, 0x12345678); pos += 4
      view.setUint16(pos, 0xFFFF); pos += 2
      view.setUint16(pos, 0xFFFF); pos += 2
      view.setUint32(pos, 0); pos += 4

      const result = parseAatLookupTable(new BinaryReader(buf), 0)
      expect(result.get(10)).toBe(0x12345678)
      expect(result.get(11)).toBe(0x12345678)
      expect(result.get(12)).toBe(0x12345678)
      expect(result.get(13)).toBeUndefined()
    })

    it('should reject strictly-backward (overlapping) segments', () => {
      const buf = new ArrayBuffer(12 + 2 * 6)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 6); pos += 2
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 20); pos += 2 // segment 0 lastGlyph
      view.setUint16(pos, 10); pos += 2 // segment 0 firstGlyph
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 25); pos += 2 // segment 1 lastGlyph
      view.setUint16(pos, 15); pos += 2 // firstGlyph 15 < previous lastGlyph 20: real overlap
      view.setUint16(pos, 2); pos += 2

      expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
        'AAT lookup format 2 segment 1 overlaps or is not sorted after previous lastGlyph 20',
      )
    })

    it('accepts adjacent segments touching at one glyph (later segment wins)', () => {
      // Shipping AAT fonts (e.g. Mishafi) place single-glyph segments whose
      // firstGlyph equals the previous lastGlyph; this is tolerated, not rejected.
      const buf = new ArrayBuffer(12 + 2 * 6)
      const view = new DataView(buf)
      let pos = 0
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 6); pos += 2
      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 20); pos += 2 // segment 0: glyphs 10..20 -> 1
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 20); pos += 2 // segment 1: glyph 20..20 -> 2 (touches, wins)
      view.setUint16(pos, 20); pos += 2
      view.setUint16(pos, 2); pos += 2

      const result = parseAatLookupTable(new BinaryReader(buf), 0)
      expect(result.get(19)).toBe(1)
      expect(result.get(20)).toBe(2) // later segment overrides the shared glyph
    })

    it('skips segments with inverted glyph ranges (HarfBuzz-tolerant)', () => {
      const buf = new ArrayBuffer(12 + 6)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 2); pos += 2
      view.setUint16(pos, 6); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 10); pos += 2 // lastGlyph
      view.setUint16(pos, 12); pos += 2 // firstGlyph > lastGlyph: degenerate
      view.setUint16(pos, 1); pos += 2

      // A degenerate (inverted) segment maps no glyphs and is tolerated, not
      // rejected, so shipping AAT fonts that carry one still parse.
      const result = parseAatLookupTable(new BinaryReader(buf), 0)
      expect(result.size).toBe(0)
    })
  })

  describe('format 4 (segment array)', () => {
    it('should parse padded segment units using unitSize', () => {
      const unitSize = 8
      const nUnits = 3
      const valueArrayOffset1 = 12 + nUnits * unitSize
      const valueArrayOffset2 = valueArrayOffset1 + 4
      const buf = new ArrayBuffer(valueArrayOffset2 + 4)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 4); pos += 2
      view.setUint16(pos, unitSize); pos += 2
      view.setUint16(pos, nUnits); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2

      view.setUint16(pos, 11); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, valueArrayOffset1); pos += 2
      view.setUint16(pos, 0xAAAA); pos += 2

      view.setUint16(pos, 21); pos += 2
      view.setUint16(pos, 20); pos += 2
      view.setUint16(pos, valueArrayOffset2); pos += 2
      view.setUint16(pos, 0xBBBB); pos += 2

      view.setUint16(pos, 0xFFFF); pos += 2
      view.setUint16(pos, 0xFFFF); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2

      pos = valueArrayOffset1
      view.setUint16(pos, 101); pos += 2
      view.setUint16(pos, 102); pos += 2
      view.setUint16(pos, 201); pos += 2
      view.setUint16(pos, 202); pos += 2

      const result = parseAatLookupTable(new BinaryReader(buf), 0)
      expect(result.get(10)).toBe(101)
      expect(result.get(11)).toBe(102)
      expect(result.get(20)).toBe(201)
      expect(result.get(21)).toBe(202)
    })

    it('should reject segment units shorter than the format 4 segment header', () => {
      const buf = new ArrayBuffer(12)
      const view = new DataView(buf)
      view.setUint16(0, 4)
      view.setUint16(2, 5)
      view.setUint16(4, 0)

      expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
        'AAT lookup format 4 invalid unitSize 5',
      )
    })

    it('should reject value array offsets that exceed the lookup table', () => {
      const buf = new ArrayBuffer(18)
      const view = new DataView(buf)
      let pos = 0

      view.setUint16(pos, 4); pos += 2
      view.setUint16(pos, 6); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 11); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 16); pos += 2

      expect(() => parseAatLookupTable(new BinaryReader(buf), 0)).toThrow(
        'AAT lookup format 4 value array for glyph 10 exceeds AAT lookup table length',
      )
    })
  })
})

describe('AAT state-table execution', () => {
  const stateTable: AatStateTable = {
    nClasses: 5,
    getClass(): number { return 4 },
    getEntry(state, glyphClass) {
      return { newState: state, flags: state * 10 + glyphClass, extra: [] }
    },
  }

  it('selects the start/end classes for text and line boundaries', () => {
    const textTransitions: number[] = []
    runAatStateTable(stateTable, [10], 'text', transition => {
      textTransitions.push(transition.entry.flags)
      return false
    })
    expect(textTransitions).toEqual([4, 0])

    const lineTransitions: number[] = []
    runAatStateTable(stateTable, [10], 'line', transition => {
      lineTransitions.push(transition.entry.flags)
      return false
    })
    expect(lineTransitions).toEqual([14, 13])
  })

  it('rejects a deterministic non-advancing state cycle', () => {
    expect(() => runAatStateTable(stateTable, [10], 'text', () => true)).toThrow(/non-advancing cycle/)
  })
})

describe('AAT rearrangement actions', () => {
  it('implements all sixteen verbs without duplicating the middle range', () => {
    const expected = [
      [1, 2, 3, 4, 5], [2, 3, 4, 5, 1], [5, 1, 2, 3, 4], [5, 2, 3, 4, 1],
      [3, 4, 5, 1, 2], [3, 4, 5, 2, 1], [4, 5, 1, 2, 3], [5, 4, 1, 2, 3],
      [4, 5, 2, 3, 1], [5, 4, 2, 3, 1], [5, 3, 4, 1, 2], [5, 3, 4, 2, 1],
      [4, 5, 3, 1, 2], [4, 5, 3, 2, 1], [5, 4, 3, 1, 2], [5, 4, 3, 2, 1],
    ]
    for (let verb = 0; verb < 16; verb++) {
      const values = [1, 2, 3, 4, 5]
      applyAatRearrangement(values, 0, 4, verb)
      expect(values).toEqual(expected[verb])
    }
  })

  it('leaves a range unchanged when it cannot contain the verb endpoints', () => {
    const values = [1, 2]
    applyAatRearrangement(values, 0, 1, 8)
    expect(values).toEqual([1, 2])
  })
})

// --- Extended State Table tests ---

describe('Extended State Table parser', () => {
  function buildExtendedStateTableHeader(
    nClasses: number,
    classLookupOffset: number,
    stateArrayOffset: number,
    entryTableOffset: number,
  ): ArrayBuffer {
    const buf = new ArrayBuffer(Math.max(16, entryTableOffset))
    const view = new DataView(buf)
    view.setUint32(0, nClasses)
    view.setUint32(4, classLookupOffset)
    view.setUint32(8, stateArrayOffset)
    view.setUint32(12, entryTableOffset)
    return buf
  }

  function buildExtendedStateTableWithNewState(newState: number): ArrayBuffer {
    const nClasses = 4
    const headerSize = 16
    const classLookupOffset = headerSize
    const classLookupSize = 6
    const stateArrayOffset = classLookupOffset + classLookupSize
    const stateArraySize = 2 * nClasses * 2
    const entryTableOffset = stateArrayOffset + stateArraySize
    const entryTableSize = 4
    const buf = new ArrayBuffer(entryTableOffset + entryTableSize)
    const view = new DataView(buf)

    view.setUint32(0, nClasses)
    view.setUint32(4, classLookupOffset)
    view.setUint32(8, stateArrayOffset)
    view.setUint32(12, entryTableOffset)
    view.setUint16(classLookupOffset, 8)
    view.setUint16(classLookupOffset + 2, 0)
    view.setUint16(classLookupOffset + 4, 0)
    for (let i = 0; i < 2 * nClasses; i++) view.setUint16(stateArrayOffset + i * 2, 0)
    view.setUint16(entryTableOffset, newState)
    view.setUint16(entryTableOffset + 2, 0)

    return buf
  }

  // Verifies header/class-lookup/state-array/entry-table wiring: glyph classes resolve via the lookup (unknown → OOB) and getEntry returns the correct newState/flags per (state, class).
  it('should parse and traverse a simple extended state table', () => {
    // Build a minimal extended state table:
    // 5 classes (four predefined classes + one letter class)
    // 2 states (0=start, 1=after-letter)
    // Class lookup: format 8 trimmed array: glyph 5 → class 2
    // State array: 2 states × 3 classes = 6 uint16 entries
    // Entry table: 2 entries

    const nClasses = 5
    const headerSize = 16 // 4 uint32s

    // Class lookup table (format 8 trimmed array)
    const classLookupOffset = headerSize
    const classLookupSize = 6 + 1 * 2 // format(2) + firstGlyph(2) + count(2) + 1 value(2)

    // State array
    const stateArrayOffset = classLookupOffset + classLookupSize
    const stateArraySize = 2 * nClasses * 2 // 2 states × 3 classes × uint16

    // Entry table
    const entryTableOffset = stateArrayOffset + stateArraySize
    const entrySize = 4 // newState(2) + flags(2), 0 extra
    const entryCount = 2
    const entryTableSize = entryCount * entrySize

    const totalSize = entryTableOffset + entryTableSize
    const buf = new ArrayBuffer(totalSize)
    const view = new DataView(buf)

    // Header
    view.setUint32(0, nClasses) // nClasses
    view.setUint32(4, classLookupOffset) // classTableOffset
    view.setUint32(8, stateArrayOffset) // stateArrayOffset
    view.setUint32(12, entryTableOffset) // entryTableOffset

    // Class lookup (format 8)
    let pos = classLookupOffset
    view.setUint16(pos, 8); pos += 2 // format 8
    view.setUint16(pos, 5); pos += 2 // firstGlyph = 5
    view.setUint16(pos, 1); pos += 2 // count = 1
    view.setUint16(pos, 4); pos += 2 // glyph 5 → letter class 4

    // State array (2 states × 5 classes)
    pos = stateArrayOffset
    // State 0: [class0→entry0, class1→entry0, class2→entry1]
    view.setUint16(pos, 0); pos += 2 // EOT → entry 0
    view.setUint16(pos, 0); pos += 2 // OOB → entry 0
    view.setUint16(pos, 0); pos += 2 // deleted → entry 0
    view.setUint16(pos, 0); pos += 2 // EOL → entry 0
    view.setUint16(pos, 1); pos += 2 // letter → entry 1
    // State 1: [class0→entry0, class1→entry0, class2→entry1]
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 1); pos += 2

    // Entry table
    pos = entryTableOffset
    // Entry 0: stay in state 0, no flags
    view.setUint16(pos, 0); pos += 2 // newState
    view.setUint16(pos, 0); pos += 2 // flags
    // Entry 1: go to state 1, set mark flag (0x8000)
    view.setUint16(pos, 1); pos += 2 // newState
    view.setUint16(pos, 0x8000); pos += 2 // flags

    const st = parseExtendedStateTable(new BinaryReader(buf), 0, 0)
    expect(st.nClasses).toBe(5)

    // Test class lookup
    expect(st.getClass(5)).toBe(4) // glyph 5 → letter class
    expect(st.getClass(99)).toBe(1) // unknown → OOB (class 1)
    expect(st.getClass(0xFFFF)).toBe(2) // deleted glyph

    // Test state transitions
    const entry0 = st.getEntry(0, 0)
    expect(entry0.newState).toBe(0)
    expect(entry0.flags).toBe(0)

    const entry1 = st.getEntry(0, 4) // state 0, letter class
    expect(entry1.newState).toBe(1)
    expect(entry1.flags).toBe(0x8000)
    expect(() => st.getEntry(0, 5)).toThrow(
      'AAT extended state table class index out of range: 5',
    )
    expect(() => st.getEntry(2, 0)).toThrow(
      'AAT extended state table state index out of range: 2',
    )
  })

  // Verifies that extraEntryFields=1 makes the parser read the additional uint16 into entry.extra (needed by e.g. morx contextual/ligature subtables).
  it('should handle extra fields per entry', () => {
    // Four predefined classes, two predefined states, one entry with one extra uint16
    const nClasses = 4
    const headerSize = 16
    const classLookupOffset = headerSize
    const classLookupSize = 6 // format 8, 0 glyphs
    const stateArrayOffset = classLookupOffset + classLookupSize
    const stateArraySize = 2 * nClasses * 2
    const entryTableOffset = stateArrayOffset + stateArraySize
    const entrySize = 6 // newState(2) + flags(2) + extra(2)

    const totalSize = entryTableOffset + entrySize
    const buf = new ArrayBuffer(totalSize)
    const view = new DataView(buf)

    view.setUint32(0, nClasses)
    view.setUint32(4, classLookupOffset)
    view.setUint32(8, stateArrayOffset)
    view.setUint32(12, entryTableOffset)

    let pos = classLookupOffset
    view.setUint16(pos, 8); pos += 2 // format 8
    view.setUint16(pos, 0); pos += 2 // firstGlyph
    view.setUint16(pos, 0); pos += 2 // count 0

    pos = stateArrayOffset
    view.setUint16(pos, 0); pos += 2 // class 0 → entry 0
    view.setUint16(pos, 0); pos += 2 // class 1 → entry 0
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 0); pos += 2

    pos = entryTableOffset
    view.setUint16(pos, 0); pos += 2 // newState
    view.setUint16(pos, 0x4000); pos += 2 // flags
    view.setUint16(pos, 42); pos += 2 // extra[0]

    const st = parseExtendedStateTable(new BinaryReader(buf), 0, 1)
    const entry = st.getEntry(0, 0)
    expect(entry.flags).toBe(0x4000)
    expect(entry.extra).toHaveLength(1)
    expect(entry.extra[0]).toBe(42)
  })

  it('should follow state references when the entry table precedes the state array', () => {
    const nClasses = 4
    const classOffset = 16
    const entryOffset = 22
    const stateOffset = 26
    const buffer = new ArrayBuffer(stateOffset + 2 * nClasses * 2)
    const view = new DataView(buffer)
    view.setUint32(0, nClasses)
    view.setUint32(4, classOffset)
    view.setUint32(8, stateOffset)
    view.setUint32(12, entryOffset)
    view.setUint16(classOffset, 8)
    view.setUint16(classOffset + 2, 0)
    view.setUint16(classOffset + 4, 0)
    view.setUint16(entryOffset, 0)
    view.setUint16(entryOffset + 2, 0x1234)

    const state = parseExtendedStateTable(new BinaryReader(buffer), 0, 0)
    expect(state.getEntry(0, 0)).toEqual({ newState: 0, flags: 0x1234, extra: [] })
    expect(state.getEntry(1, 3)).toEqual({ newState: 0, flags: 0x1234, extra: [] })
  })

  it('should reject zero class count', () => {
    const buf = buildExtendedStateTableHeader(0, 16, 22, 24)

    expect(() => parseExtendedStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      'AAT extended state table requires the four predefined classes',
    )
  })

  it('rejects a state array too small for even one class row', () => {
    // 2 uint16 entries but 3 classes: cannot form a single state row.
    const buf = buildExtendedStateTableHeader(4, 16, 22, 26)

    expect(() => parseExtendedStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      'AAT extended state table offset exceeds table length',
    )
  })

  it('should reject empty state arrays', () => {
    const buf = buildExtendedStateTableHeader(4, 16, 22, 22)

    expect(() => parseExtendedStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      'AAT extended state table offset exceeds table length',
    )
  })

  it('should reject out-of-range newState indices', () => {
    const buf = buildExtendedStateTableWithNewState(2)

    expect(() => parseExtendedStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      'AAT extended state 2 exceeds AAT lookup table length',
    )
  })

  it.each([0, 2, 3])('rejects explicitly mapped predefined class %i', classCode => {
    const buf = buildExtendedStateTableWithNewState(0)
    const view = new DataView(buf)
    view.setUint16(20, 1) // format 8 glyphCount
    view.setUint16(22, classCode)

    expect(() => parseExtendedStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      `AAT extended state table glyph 0 must not explicitly use predefined class ${classCode}`,
    )
  })
})

// --- 16-bit State Table tests ---

describe('16-bit State Table parser', () => {
  function buildStateTableHeader(
    nClasses: number,
    classTableOffset: number,
    stateArrayOffset: number,
    entryTableOffset: number,
  ): ArrayBuffer {
    const buf = new ArrayBuffer(Math.max(8, entryTableOffset))
    const view = new DataView(buf)
    view.setUint16(0, nClasses)
    view.setUint16(2, classTableOffset)
    view.setUint16(4, stateArrayOffset)
    view.setUint16(6, entryTableOffset)
    return buf
  }

  function buildStateTableWithNewStateOffset(newStateOffset: number): ArrayBuffer {
    const nClasses = 4
    const headerSize = 8
    const classTableOffset = headerSize
    const classTableSize = 4
    const stateArrayOffset = classTableOffset + classTableSize
    const stateArraySize = 2 * nClasses
    const entryTableOffset = stateArrayOffset + stateArraySize
    const entrySize = 4
    const buf = new ArrayBuffer(entryTableOffset + entrySize)
    const view = new DataView(buf)

    view.setUint16(0, nClasses)
    view.setUint16(2, classTableOffset)
    view.setUint16(4, stateArrayOffset)
    view.setUint16(6, entryTableOffset)
    view.setUint16(classTableOffset, 100)
    view.setUint16(classTableOffset + 2, 0)
    for (let i = 0; i < 2 * nClasses; i++) {
      view.setUint8(stateArrayOffset + i, 0)
    }
    view.setUint16(entryTableOffset, newStateOffset)
    view.setUint16(entryTableOffset + 2, 0)

    return buf
  }

  // Verifies the legacy 16-bit header (uint16 offsets, byte class array) parses and that entry newState offsets are converted back to state indices.
  it('should parse a simple state table with class array', () => {
    // Build 16-bit state table:
    // nClasses=5, class table maps glyph 10 → user class 4
    // 2 predefined states, 1 entry

    const nClasses = 5
    const headerSize = 8 // 4 × uint16

    // Class table: firstGlyph(2) + nGlyphs(2) + classArray[nGlyphs](1 each)
    const classTableOffset = headerSize
    const firstGlyph = 10
    const nGlyphs = 1
    const classTableSize = 4 + nGlyphs + 1 // class array + alignment padding

    // State array: 2 predefined states
    const stateArrayOffset = classTableOffset + classTableSize
    const stateArraySize = 2 * nClasses

    // Entry table: 1 entry: newStateOffset(2) + flags(2) = 4
    const entryTableOffset = stateArrayOffset + stateArraySize
    const entrySize = 4
    const totalSize = entryTableOffset + entrySize

    const buf = new ArrayBuffer(totalSize)
    const view = new DataView(buf)

    // Header
    let pos = 0
    view.setUint16(pos, nClasses); pos += 2
    view.setUint16(pos, classTableOffset); pos += 2
    view.setUint16(pos, stateArrayOffset); pos += 2
    view.setUint16(pos, entryTableOffset); pos += 2

    // Class table
    pos = classTableOffset
    view.setUint16(pos, firstGlyph); pos += 2
    view.setUint16(pos, nGlyphs); pos += 2
    view.setUint8(pos++, 4) // glyph 10 → user class 4

    // State array
    pos = stateArrayOffset
    view.setUint8(pos++, 0) // class 0 → entry 0
    view.setUint8(pos++, 0) // class 1 → entry 0
    view.setUint8(pos++, 0) // class 2 → entry 0
    view.setUint8(pos++, 0) // class 3 → entry 0
    view.setUint8(pos++, 0) // class 4 → entry 0
    for (let i = 0; i < nClasses; i++) view.setUint8(pos++, 0)

    // Entry table
    pos = entryTableOffset
    // newState offset = stateArrayOffset (stay in state 0)
    view.setUint16(pos, stateArrayOffset); pos += 2
    view.setUint16(pos, 0x8000); pos += 2 // flags

    const st = parseStateTable(new BinaryReader(buf), 0, 0)
    expect(st.nClasses).toBe(5)
    expect(st.getClass(10)).toBe(4)
    expect(st.getClass(0)).toBe(1) // not in range → OOB
    expect(st.getClass(0xFFFF)).toBe(2) // deleted glyph

    const entry = st.getEntry(0, 4)
    expect(entry.newState).toBe(0)
    expect(entry.flags).toBe(0x8000)
    expect(() => st.getEntry(0, 5)).toThrow(
      'AAT state table class index out of range: 5',
    )
    expect(() => st.getEntry(2, 0)).toThrow(
      'AAT state table state index out of range: 2',
    )
  })

  // Verifies that with an empty class range every glyph ID falls back to the out-of-bounds class (1).
  it('should handle out-of-range glyph IDs', () => {
    const nClasses = 4
    const headerSize = 8
    const classTableOffset = headerSize
    const classTableSize = 4 // firstGlyph + nGlyphs + 0 entries
    const stateArrayOffset = classTableOffset + classTableSize
    const stateArraySize = 2 * nClasses
    const entryTableOffset = stateArrayOffset + stateArraySize
    const entrySize = 4

    const buf = new ArrayBuffer(entryTableOffset + entrySize)
    const view = new DataView(buf)

    view.setUint16(0, nClasses)
    view.setUint16(2, classTableOffset)
    view.setUint16(4, stateArrayOffset)
    view.setUint16(6, entryTableOffset)

    let pos = classTableOffset
    view.setUint16(pos, 100); pos += 2 // firstGlyph = 100
    view.setUint16(pos, 0); pos += 2 // nGlyphs = 0

    pos = stateArrayOffset
    for (let i = 0; i < 2 * nClasses; i++) view.setUint8(pos++, 0)

    pos = entryTableOffset
    view.setUint16(pos, stateArrayOffset); pos += 2
    view.setUint16(pos, 0); pos += 2

    const st = parseStateTable(new BinaryReader(buf), 0, 0)
    // All glyphs should be OOB (class 1)
    expect(st.getClass(0)).toBe(1)
    expect(st.getClass(50)).toBe(1)
    expect(st.getClass(200)).toBe(1)
  })

  it('should follow negative classic-state offsets', () => {
    const nClasses = 4
    const classOffset = 8
    const stateOffset = 20
    const entryOffset = 28
    const buffer = new ArrayBuffer(36)
    const view = new DataView(buffer)
    view.setUint16(0, nClasses)
    view.setUint16(2, classOffset)
    view.setUint16(4, stateOffset)
    view.setUint16(6, entryOffset)
    view.setUint16(classOffset, 0)
    view.setUint16(classOffset + 2, 0)
    // State -1 at byte offset 16 uses entry 1; states 0 and 1 use entry 0.
    for (let i = 0; i < nClasses; i++) view.setUint8(16 + i, 1)
    for (let i = 0; i < 2 * nClasses; i++) view.setUint8(stateOffset + i, 0)
    view.setUint16(entryOffset, 16)
    view.setUint16(entryOffset + 2, 0x1000)
    view.setUint16(entryOffset + 4, stateOffset)
    view.setUint16(entryOffset + 6, 0x2000)

    const state = parseStateTable(new BinaryReader(buffer), 0, 0)
    expect(state.getEntry(0, 0)).toEqual({ newState: -1, flags: 0x1000, extra: [] })
    expect(state.getEntry(-1, 0)).toEqual({ newState: 0, flags: 0x2000, extra: [] })
  })

  it('should reject out-of-range newState offsets', () => {
    expect(() => parseStateTable(new BinaryReader(buildStateTableWithNewStateOffset(24)), 0, 0)).toThrow(
      'AAT state 3 exceeds AAT lookup table length',
    )
  })

  it('should reject unaligned newState offsets', () => {
    expect(() => parseStateTable(new BinaryReader(buildStateTableWithNewStateOffset(13)), 0, 0)).toThrow(
      'AAT state table newState offset is not state-aligned: 13',
    )
  })

  it('should reject zero class count', () => {
    const buf = buildStateTableHeader(0, 8, 12, 14)

    expect(() => parseStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      'AAT state table requires the four predefined classes',
    )
  })

  it('rejects stateSize values that do not fit the byte state-array entries', () => {
    const buf = buildStateTableHeader(256, 8, 12, 268)

    expect(() => parseStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      'AAT state table stateSize must fit in 8 bits, got 256',
    )
  })

  it.each([0, 2, 3])('rejects explicitly mapped predefined class %i', classCode => {
    const buf = buildStateTableWithNewStateOffset(12)
    const view = new DataView(buf)
    view.setUint16(10, 1) // class table nGlyphs
    view.setUint8(12, classCode)

    expect(() => parseStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      `AAT state table glyph 100 must not explicitly use predefined class ${classCode}`,
    )
  })

  it('rejects a state array too small for even one class row', () => {
    // 2 bytes but 3 classes: cannot form a single state row.
    const buf = buildStateTableHeader(4, 8, 12, 14)

    expect(() => parseStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      'AAT state table offset exceeds table length',
    )
  })

  it('should reject empty state arrays', () => {
    const buf = buildStateTableHeader(4, 8, 12, 12)

    expect(() => parseStateTable(new BinaryReader(buf), 0, 0)).toThrow(
      'AAT state table offset exceeds table length',
    )
  })
})
