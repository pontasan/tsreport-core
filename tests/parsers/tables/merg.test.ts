import { describe, expect, it } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseMerg } from '../../../src/parsers/tables/merg.js'

interface ClassDef1 { format: 1, startGlyph: number, classes: number[] }
interface ClassDef2 { format: 2, ranges: { start: number, end: number, classId: number }[] }

function buildMergTable(classDefs: (ClassDef1 | ClassDef2)[], mergeClassCount: number, entries: number[]): ArrayBuffer {
  const offsetsStart = 10
  let position = offsetsStart + classDefs.length * 2
  const offsets: number[] = []
  for (const classDef of classDefs) {
    offsets.push(position)
    position += classDef.format === 1 ? 6 + classDef.classes.length * 2 : 4 + classDef.ranges.length * 6
  }
  const mergeDataOffset = position
  const buffer = new ArrayBuffer(mergeDataOffset + entries.length)
  const view = new DataView(buffer)
  view.setUint16(0, 0)
  view.setUint16(2, mergeClassCount)
  view.setUint16(4, mergeDataOffset)
  view.setUint16(6, classDefs.length)
  view.setUint16(8, offsetsStart)
  for (let i = 0; i < offsets.length; i++) view.setUint16(offsetsStart + i * 2, offsets[i]!)
  for (let i = 0; i < classDefs.length; i++) {
    const classDef = classDefs[i]!
    let offset = offsets[i]!
    view.setUint16(offset, classDef.format); offset += 2
    if (classDef.format === 1) {
      view.setUint16(offset, classDef.startGlyph); offset += 2
      view.setUint16(offset, classDef.classes.length); offset += 2
      for (const classId of classDef.classes) { view.setUint16(offset, classId); offset += 2 }
    } else {
      view.setUint16(offset, classDef.ranges.length); offset += 2
      for (const range of classDef.ranges) {
        view.setUint16(offset, range.start); offset += 2
        view.setUint16(offset, range.end); offset += 2
        view.setUint16(offset, range.classId); offset += 2
      }
    }
  }
  for (let i = 0; i < entries.length; i++) view.setUint8(mergeDataOffset + i, entries[i]!)
  return buffer
}

describe('MERG table parser and processor', () => {
  it('parses ClassDef formats 1 and 2 and applies default class zero', () => {
    const table = parseMerg(new BinaryReader(buildMergTable([
      { format: 1, startGlyph: 10, classes: [1, 1] },
      { format: 2, ranges: [{ start: 20, end: 21, classId: 2 }] },
    ], 3, [0, 1, 2, 4, 0, 3, 1, 2, 0])), 30)

    expect(table.getMergeClass(9)).toBe(0)
    expect(table.getMergeClass(10)).toBe(1)
    expect(table.getMergeClass(21)).toBe(2)
    expect(table.getMergeAction(9, 10)).toBe(1)
    expect(table.getMergeAction(10, 9)).toBe(4)
    expect(table.getMergeAction(20, 10)).toBe(2)
  })

  it('executes grouping, merging, subordinate classes, and RTL flags', () => {
    const entries = new Array<number>(9).fill(0)
    entries[1 * 3 + 2] = 0x01 | 0x04
    entries[1 * 3 + 1] = 0x02
    entries[2 * 3 + 1] = 0x10 | 0x40
    const table = parseMerg(new BinaryReader(buildMergTable([
      { format: 1, startGlyph: 10, classes: [1, 2, 1] },
    ], 3, entries)))

    expect(table.getMergeGroups([10, 11, 12], 'ltr')).toEqual([
      { start: 0, end: 3, mergeRequired: true },
    ])
    expect(table.getMergeGroups([11, 10, 9], 'rtl')).toEqual([
      { start: 0, end: 2, mergeRequired: true },
      { start: 2, end: 3, mergeRequired: false },
    ])
  })

  it('rejects malformed headers, ClassDefs, ordering, ranges, flags, and bounds', () => {
    const valid = buildMergTable([{ format: 1, startGlyph: 10, classes: [1] }], 2, [0, 1, 2, 0])
    const version = valid.slice(0); new DataView(version).setUint16(0, 1)
    expect(() => parseMerg(new BinaryReader(version))).toThrow('Unsupported MERG table version')
    const zeroClasses = valid.slice(0); new DataView(zeroClasses).setUint16(2, 0)
    expect(() => parseMerg(new BinaryReader(zeroClasses))).toThrow('mergeClassCount must be greater than zero')
    const reserved = valid.slice(0); new DataView(reserved).setUint8(valid.byteLength - 3, 0x08)
    expect(() => parseMerg(new BinaryReader(reserved))).toThrow('reserved flag bits')
    expect(() => parseMerg(new BinaryReader(valid), 10)).toThrow('glyph 10 exceeds numGlyphs 10')

    const outOfOrder = buildMergTable([
      { format: 1, startGlyph: 10, classes: [1] },
      { format: 2, ranges: [{ start: 9, end: 9, classId: 1 }] },
    ], 2, [0, 0, 0, 0])
    expect(() => parseMerg(new BinaryReader(outOfOrder))).toThrow('strictly increasing')

    const badRange = buildMergTable([
      { format: 2, ranges: [{ start: 11, end: 10, classId: 1 }] },
    ], 2, [0, 0, 0, 0])
    expect(() => parseMerg(new BinaryReader(badRange))).toThrow('startGlyph greater than endGlyph')
  })
})
