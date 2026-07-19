import { describe, expect, it } from 'vitest'
import { BinaryWriter } from '../../src/binary/writer.js'
import { getTableReader, parseSfntDirectory } from '../../src/parsers/sfnt-parser.js'

interface TestTable {
  tag: string
  data: Uint8Array
  offset?: number
  length?: number
}

describe('sfnt parser', () => {
  it('should parse a valid sorted SFNT table directory', () => {
    const buffer = buildSfnt([
      { tag: 'cmap', data: new Uint8Array([1, 2, 3, 4]) },
      { tag: 'head', data: new Uint8Array([5, 6, 7]) },
    ])

    const sfnt = parseSfntDirectory(buffer)

    expect(sfnt.format).toBe('ttf')
    expect(sfnt.tableDirectory.size).toBe(2)
    expect(sfnt.tableDirectory.get('cmap')?.offset).toBe(44)
    expect(sfnt.tableDirectory.get('head')?.offset).toBe(48)
    expect(getTableReader(sfnt, 'head')?.length).toBe(3)
  })

  it("accepts the legacy 'true' (0x74727565) TrueType version", () => {
    const sfnt = parseSfntDirectory(buildSfnt([{ tag: 'cmap', data: new Uint8Array([0]) }], {
      sfntVersion: 0x74727565,
    }))
    expect(sfnt.tableDirectory.has('cmap')).toBe(true)
  })

  it('should reject unsupported SFNT versions', () => {
    expect(() => parseSfntDirectory(buildSfnt([{ tag: 'cmap', data: new Uint8Array([0]) }], {
      sfntVersion: 0x00020000,
    }))).toThrow('Unsupported SFNT version: 0x00020000')
  })

  it('should reject empty or truncated table directories', () => {
    const empty = new BinaryWriter()
    empty.writeUint32(0x00010000)
    empty.writeUint16(0)
    empty.writeUint16(0)
    empty.writeUint16(0)
    empty.writeUint16(0)
    expect(() => parseSfntDirectory(empty.toArrayBuffer())).toThrow(
      'SFNT table directory must contain at least one table',
    )

    const truncated = new BinaryWriter()
    truncated.writeUint32(0x00010000)
    truncated.writeUint16(1)
    truncated.writeUint16(16)
    truncated.writeUint16(0)
    truncated.writeUint16(0)
    expect(() => parseSfntDirectory(truncated.toArrayBuffer())).toThrow(
      'SFNT table directory extends beyond font data',
    )
  })

  it('ignores incorrect binary-search header fields (advisory per OpenType §5.1)', () => {
    // Real fonts (e.g. macOS Symbol.ttf) ship wrong searchRange/entrySelector/
    // rangeShift; these are redundant with numTables and must be ignored, not
    // treated as a fatal error.
    const sfnt = parseSfntDirectory(buildSfnt([{ tag: 'cmap', data: new Uint8Array([0]) }], {
      searchRange: 0,
    }))
    expect(sfnt.tableDirectory.has('cmap')).toBe(true)
  })

  it('should reject invalid table tags', () => {
    expect(() => parseSfntDirectory(buildSfnt([{ tag: '\x00map', data: new Uint8Array([0]) }]))).toThrow(
      'SFNT table tag contains a non-printable byte',
    )
    expect(() => parseSfntDirectory(buildSfnt([{ tag: 'a b ', data: new Uint8Array([0]) }]))).toThrow(
      'SFNT table tag has non-space characters after trailing space: a b ',
    )
    expect(() => parseSfntDirectory(buildSfnt([{ tag: '    ', data: new Uint8Array([0]) }]))).toThrow(
      'SFNT table tag must contain at least one non-space character',
    )
  })

  it('should reject unsorted or duplicate table records', () => {
    expect(() => parseSfntDirectory(buildSfnt([
      { tag: 'head', data: new Uint8Array([0]) },
      { tag: 'cmap', data: new Uint8Array([0]) },
    ]))).toThrow('SFNT table records must be sorted by ascending tag: cmap')

    expect(() => parseSfntDirectory(buildSfnt([
      { tag: 'cmap', data: new Uint8Array([0]) },
      { tag: 'cmap', data: new Uint8Array([0]) },
    ]))).toThrow('SFNT table records must be sorted by ascending tag: cmap')
  })

  it('accepts unaligned but rejects out-of-range table references', () => {
    // Unaligned offsets are tolerated (real PDF subsets ship them); the table is
    // read from its absolute offset regardless.
    const sfnt = parseSfntDirectory(buildSfnt([
      { tag: 'cmap', data: new Uint8Array([0]), offset: 29 },
    ]))
    expect(sfnt.tableDirectory.get('cmap')!.offset).toBe(29)

    expect(() => parseSfntDirectory(buildSfnt([
      { tag: 'cmap', data: new Uint8Array([0]), length: 1000 },
    ]))).toThrow("SFNT table 'cmap' extends beyond font data")
  })
})

function buildSfnt(
  tables: TestTable[],
  opts: {
    sfntVersion?: number
    searchRange?: number
    entrySelector?: number
    rangeShift?: number
  } = {},
): ArrayBuffer {
  const numTables = tables.length
  const headerSize = 12 + numTables * 16
  const search = computeSfntSearchFields(numTables)
  const offsets: number[] = []
  let offset = headerSize
  for (const table of tables) {
    offsets.push(table.offset ?? offset)
    offset += (table.data.length + 3) & ~3
  }

  const w = new BinaryWriter(offset + 16)
  w.writeUint32(opts.sfntVersion ?? 0x00010000)
  w.writeUint16(numTables)
  w.writeUint16(opts.searchRange ?? search.searchRange)
  w.writeUint16(opts.entrySelector ?? search.entrySelector)
  w.writeUint16(opts.rangeShift ?? search.rangeShift)

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!
    w.writeTag(table.tag)
    w.writeUint32(0)
    w.writeUint32(offsets[i]!)
    w.writeUint32(table.length ?? table.data.length)
  }
  for (let i = 0; i < tables.length; i++) {
    w.position = offsets[i]!
    w.writeBytes(tables[i]!.data)
  }

  return w.toArrayBuffer()
}

function computeSfntSearchFields(numTables: number): { searchRange: number; entrySelector: number; rangeShift: number } {
  let maxPowerOfTwo = 1
  let entrySelector = 0
  while (maxPowerOfTwo * 2 <= numTables) {
    maxPowerOfTwo *= 2
    entrySelector++
  }
  const searchRange = maxPowerOfTwo * 16
  return { searchRange, entrySelector, rangeShift: numTables * 16 - searchRange }
}
