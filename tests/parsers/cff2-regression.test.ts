import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../src/binary/reader.js'
import { BinaryWriter } from '../../src/binary/writer.js'
import { parseCff2, parseCff2Glyph, parseCff2GlyphWithHints, type Cff2Data, type Cff2FDData } from '../../src/parsers/cff2-parser.js'
import { PathCommand } from '../../src/types/glyph.js'

/**
 * CFF2 charstring interpreter regression tests:
 * - width is always 0 (advance widths come from hmtx)
 * - an open path is closed even without endchar
 * - moveto implicitly closes the currently open path
 */

// Helper: build a minimal CFF2 INDEX with a single charstring entry
function buildCff2Index(charstrings: Uint8Array[]): {
  count: number
  offsets: Uint32Array
  data: BinaryReader
} {
  const count = charstrings.length
  let totalLen = 0
  for (const cs of charstrings) totalLen += cs.length

  const buffer = new ArrayBuffer(totalLen)
  const view = new Uint8Array(buffer)
  const offsets = new Uint32Array(count + 1)

  let pos = 0
  for (let i = 0; i < count; i++) {
    offsets[i] = pos + 1 // 1-based offset per CFF spec
    view.set(charstrings[i]!, pos)
    pos += charstrings[i]!.length
  }
  offsets[count] = pos + 1

  return {
    count,
    offsets,
    data: new BinaryReader(buffer),
  }
}

function makeEmptyFD(): Cff2FDData {
  return {
    localSubrs: { count: 0, offsets: new Uint32Array(0), data: new BinaryReader(new ArrayBuffer(0)) },
    localBias: 0,
    privateDictEntries: new Map(),
    defaultVsIndex: 0,
    privateDictReader: new BinaryReader(new ArrayBuffer(0)),
  }
}

function makeCff2Data(charstrings: Uint8Array[]): Cff2Data {
  return {
    charstrings: buildCff2Index(charstrings),
    globalSubrs: { count: 0, offsets: new Uint32Array(0), data: new BinaryReader(new ArrayBuffer(0)) },
    globalBias: 107,
    fdArray: [makeEmptyFD()],
    fdSelect: null,
    vstore: null,
    variationStoreReader: null,
    fontMatrix: null,
  }
}

// CFF2 number encoding: integer in range -107..107 → single byte (b0 = value + 139)
function encInt(v: number): number {
  if (v >= -107 && v <= 107) return v + 139
  throw new Error(`Use 2-byte encoding for ${v}`)
}

function writeIntOperand(writer: BinaryWriter, value: number): void {
  writer.writeUint8(29)
  writer.writeInt32(value)
}

function buildCff2ItemVariationStore(axisCount = 1, format = 1): Uint8Array {
  const w = new BinaryWriter()
  w.writeUint16(format)
  w.writeUint32(12) // variationRegionListOffset
  w.writeUint16(1) // itemVariationDataCount
  w.writeUint32(22) // itemVariationDataOffset
  w.writeUint16(axisCount)
  w.writeUint16(1) // regionCount
  for (let i = 0; i < axisCount; i++) {
    w.writeInt16(0)
    w.writeInt16(16384)
    w.writeInt16(16384)
  }
  w.writeUint16(0) // CFF2 stores deltas in blend operands, not ItemVariationData
  w.writeUint16(0) // wordDeltaCount
  w.writeUint16(1) // regionIndexCount
  w.writeUint16(0) // regionIndex
  return w.toUint8Array().slice()
}

function buildCff2Table(options: {
  axisCount?: number
  itemVariationStoreFormat?: number
  lengthDelta?: number
} = {}): ArrayBuffer {
  const ivs = buildCff2ItemVariationStore(options.axisCount ?? 1, options.itemVariationStoreFormat ?? 1)
  const charstringsOffset = 28
  const vstoreOffset = charstringsOffset + 8
  const fdArrayOffset = vstoreOffset + 2 + ivs.length
  const topDict = new BinaryWriter()
  writeIntOperand(topDict, charstringsOffset)
  topDict.writeUint8(17)
  writeIntOperand(topDict, vstoreOffset)
  topDict.writeUint8(24)
  writeIntOperand(topDict, fdArrayOffset)
  topDict.writeUint8(12)
  topDict.writeUint8(36)

  const w = new BinaryWriter()
  w.writeUint8(2) // majorVersion
  w.writeUint8(0) // minorVersion
  w.writeUint8(5) // headerSize
  w.writeUint16(topDict.position)
  w.writeBytes(topDict.toUint8Array().slice())

  w.writeUint32(0) // Global Subr INDEX count = 0

  w.writeUint32(1) // CharStrings INDEX count
  w.writeUint8(1) // offSize
  w.writeUint8(1)
  w.writeUint8(2)
  w.writeUint8(14) // endchar

  w.writeUint16(ivs.length + (options.lengthDelta ?? 0))
  w.writeBytes(ivs)

  w.writeUint32(1) // FontDICTINDEX count
  w.writeUint8(1) // offSize
  w.writeUint8(1)
  w.writeUint8(4)
  w.writeUint8(139) // empty PrivateDICT size
  w.writeUint8(139) // empty PrivateDICT offset
  w.writeUint8(18) // PrivateDICTOffset
  return w.toArrayBuffer()
}

function buildMultiFdCff2Table(format: 0 | 3 | 4): ArrayBuffer {
  const charstringsOffset = 29
  const fdArrayOffset = charstringsOffset + 10
  const fdSelectOffset = fdArrayOffset + 14
  const topDict = new BinaryWriter()
  writeIntOperand(topDict, charstringsOffset)
  topDict.writeUint8(17)
  writeIntOperand(topDict, fdArrayOffset)
  topDict.writeUint8(12)
  topDict.writeUint8(36)
  writeIntOperand(topDict, fdSelectOffset)
  topDict.writeUint8(12)
  topDict.writeUint8(37)

  const w = new BinaryWriter()
  w.writeUint8(2)
  w.writeUint8(0)
  w.writeUint8(5)
  w.writeUint16(topDict.position)
  w.writeBytes(topDict.toUint8Array().slice())
  w.writeUint32(0)
  w.writeUint32(2)
  w.writeUint8(1)
  w.writeUint8(1)
  w.writeUint8(2)
  w.writeUint8(3)
  w.writeUint8(14)
  w.writeUint8(14)
  w.writeUint32(2)
  w.writeUint8(1)
  w.writeUint8(1)
  w.writeUint8(4)
  w.writeUint8(7)
  for (let i = 0; i < 2; i++) {
    w.writeUint8(139)
    w.writeUint8(139)
    w.writeUint8(18)
  }
  w.writeUint8(format)
  if (format === 0) {
    w.writeUint8(0)
    w.writeUint8(1)
  } else if (format === 3) {
    w.writeUint16(2)
    w.writeUint16(0)
    w.writeUint8(0)
    w.writeUint16(1)
    w.writeUint8(1)
    w.writeUint16(2)
  } else {
    w.writeUint32(2)
    w.writeUint32(0)
    w.writeUint16(0)
    w.writeUint32(1)
    w.writeUint16(1)
    w.writeUint32(2)
  }
  return w.toArrayBuffer()
}

describe('CFF2 charstring リグレッション', () => {
  // Verifies CFF2 never derives width from the charstring; advances come from hmtx.
  it('width は常に 0 を返す (hmtx から取得される)', () => {
    // Simple charstring: rmoveto(10,20) + rlineto(100,0) + rlineto(0,100) + endchar
    const cs = new Uint8Array([
      encInt(10), encInt(20), 21, // rmoveto dx=10 dy=20
      encInt(100), encInt(0), 5,  // rlineto dx=100 dy=0
      encInt(0), encInt(100), 5,  // rlineto dx=0 dy=100
      14,                          // endchar
    ])

    const cff2 = makeCff2Data([cs])
    const result = parseCff2Glyph(cff2, 0)

    // CFF2 never returns width from charstring
    expect(result.width).toBe(0)
    expect(result.outline.commands.length).toBeGreaterThan(0)
  })

  // Verifies the trailing open path is closed when charstring data runs out without endchar.
  it('endchar なしでも open path が close される', () => {
    // Charstring ends without endchar (CFF2 allows this)
    const cs = new Uint8Array([
      encInt(0), encInt(0), 21,   // rmoveto 0,0
      encInt(100), encInt(0), 5,  // rlineto 100,0
      encInt(0), encInt(100), 5,  // rlineto 0,100
      // NO endchar — data just runs out
    ])

    const cff2 = makeCff2Data([cs])
    const result = parseCff2Glyph(cff2, 0)

    // Should have a Close command from the safety net
    const cmds = Array.from(result.outline.commands)
    expect(cmds.includes(PathCommand.Close)).toBe(true)
    expect(cmds[cmds.length - 1]).toBe(PathCommand.Close)
  })

  // Verifies each moveto implicitly closes the previously open subpath.
  it('moveto で既存 open path が implicit close される', () => {
    // Two subpaths: first ends with another moveto (not endchar)
    const cs = new Uint8Array([
      encInt(0), encInt(0), 21,     // rmoveto 0,0 → open path 1
      encInt(50), encInt(0), 5,     // rlineto 50,0
      encInt(100), encInt(100), 21, // rmoveto 100,100 → should close path 1, open path 2
      encInt(30), encInt(0), 5,     // rlineto 30,0
      14,                            // endchar → close path 2
    ])

    const cff2 = makeCff2Data([cs])
    const result = parseCff2Glyph(cff2, 0)

    const cmds = Array.from(result.outline.commands)
    // Should have: MoveTo, LineTo, Close, MoveTo, LineTo, Close
    const closeCount = cmds.filter(c => c === PathCommand.Close).length
    expect(closeCount).toBe(2)
    const moveToCount = cmds.filter(c => c === PathCommand.MoveTo).length
    expect(moveToCount).toBe(2)
  })

  // Verifies CFF2 stem operators never consume a leading width operand (unlike CFF).
  it('stem operators do not consume width operand in CFF2', () => {
    // hstem with even number of operands (no width)
    const cs = new Uint8Array([
      encInt(10), encInt(20), 1,   // hstem: 2 operands = 1 stem pair, no width
      encInt(0), encInt(0), 21,    // rmoveto 0,0
      encInt(50), encInt(50), 5,   // rlineto 50,50
      14,                           // endchar
    ])

    const cff2 = makeCff2Data([cs])
    const result = parseCff2Glyph(cff2, 0)

    // Should not crash and width should be 0
    expect(result.width).toBe(0)
    expect(result.outline.commands.length).toBeGreaterThan(0)
  })

  it('captures CFF2 stem and mask data for the raster hinting consumer', () => {
    const cs = new Uint8Array([
      encInt(10), encInt(20), 18,
      encInt(30), encInt(40), 23,
      19, 0xC0,
      encInt(0), encInt(0), 21,
      encInt(50), encInt(0), 5,
    ])
    const result = parseCff2GlyphWithHints(makeCff2Data([cs]), 0, [])

    expect(result.hints.hStems).toEqual([{ pos: 10, width: 20 }])
    expect(result.hints.vStems).toEqual([{ pos: 30, width: 40 }])
    expect(Array.from(result.hints.hintMasks[0]!)).toEqual([0xC0])
  })

  it('VariationStore を length 付き ItemVariationStore として検証する', () => {
    const cff2 = parseCff2(new BinaryReader(buildCff2Table()), 1)

    expect(cff2.vstore).not.toBeNull()
    expect(cff2.vstore?.regions).toHaveLength(1)
    expect(cff2.vstore?.data[0]?.regionIndices).toEqual([0])
    expect(cff2.vstore?.data[0]?.deltaSets).toEqual([])
  })

  it('VariationStore の fvar 軸数コンテキストを要求する', () => {
    expect(() => parseCff2(new BinaryReader(buildCff2Table()))).toThrow(/requires table 'fvar'/)
    expect(() => parseCff2(new BinaryReader(buildCff2Table()), 2)).toThrow(/axisCount/)
  })

  it('不正な VariationStore length と ItemVariationStore を拒否する', () => {
    expect(() => parseCff2(new BinaryReader(buildCff2Table({ lengthDelta: 100 })), 1)).toThrow(/VariationStore data exceeds table length/)
    expect(() => parseCff2(new BinaryReader(buildCff2Table({ itemVariationStoreFormat: 2 })), 1)).toThrow(/ItemVariationStore format/)
  })

  it.each([0, 3, 4] as const)('maps multiple PrivateDICTs through FontDICTSelect format %i', (format) => {
    const cff2 = parseCff2(new BinaryReader(buildMultiFdCff2Table(format)))

    expect(cff2.fdArray).toHaveLength(2)
    expect(Array.from(cff2.fdSelect!)).toEqual([0, 1])
    expect(parseCff2Glyph(cff2, 1).width).toBe(0)
  })

  it('rejects malformed CharString stack and subroutine operands', () => {
    expect(() => parseCff2Glyph(makeCff2Data([new Uint8Array([encInt(10), 21])]), 0)).toThrow(/rmoveto/)
    expect(() => parseCff2Glyph(makeCff2Data([new Uint8Array([encInt(0), 10])]), 0)).toThrow(/LocalSubrINDEX/)
    expect(() => parseCff2Glyph(makeCff2Data([new Uint8Array([11])]), 0)).toThrow(/return/)
    expect(() => parseCff2Glyph(makeCff2Data([new Uint8Array(514).fill(encInt(0))]), 0)).toThrow(/513/)
  })
})
