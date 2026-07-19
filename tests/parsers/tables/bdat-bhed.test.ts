import { describe, it, expect } from 'vitest'
import { parseSfntDirectory } from '../../../src/parsers/sfnt-parser.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'

/**
 * Build a minimal SFNT binary containing the given tables
 */
function buildSfnt(tables: { tag: string, data: ArrayBuffer }[]): ArrayBuffer {
  const sortedTables = [...tables].sort((a, b) => compareSfntTags(a.tag, b.tag))
  const headerSize = 12 + sortedTables.length * 16
  let dataSize = 0
  for (const t of sortedTables) dataSize += (t.data.byteLength + 3) & ~3

  const buf = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  const search = computeSfntSearchFields(sortedTables.length)

  view.setUint32(0, 0x00010000) // sfntVersion (TrueType)
  view.setUint16(4, sortedTables.length)
  view.setUint16(6, search.searchRange)
  view.setUint16(8, search.entrySelector)
  view.setUint16(10, search.rangeShift)

  let dirPos = 12
  let dataPos = headerSize
  for (const t of sortedTables) {
    for (let i = 0; i < 4; i++) view.setUint8(dirPos + i, t.tag.charCodeAt(i))
    view.setUint32(dirPos + 4, 0) // checksum
    view.setUint32(dirPos + 8, dataPos)
    view.setUint32(dirPos + 12, t.data.byteLength)
    dirPos += 16

    bytes.set(new Uint8Array(t.data), dataPos)
    dataPos += (t.data.byteLength + 3) & ~3
  }
  return buf
}

function compareSfntTags(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
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

/**
 * Build a bhed table (identical structure to head)
 */
function buildBhed(unitsPerEm: number): ArrayBuffer {
  const buf = new ArrayBuffer(54)
  const view = new DataView(buf)
  view.setUint16(0, 1) // majorVersion
  view.setUint16(2, 0) // minorVersion
  view.setInt32(4, 0x00010000) // fontRevision 1.0
  view.setUint32(8, 0) // checksumAdjustment
  view.setUint32(12, 0x5F0F3CF5) // magic
  view.setUint16(16, 0) // flags
  view.setUint16(18, unitsPerEm)
  // created/modified (16 bytes of zeros)
  view.setInt16(36, -100) // xMin
  view.setInt16(38, -200) // yMin
  view.setInt16(40, 900) // xMax
  view.setInt16(42, 800) // yMax
  view.setUint16(44, 0) // macStyle
  view.setUint16(46, 8) // lowestRecPPEM
  view.setInt16(48, 2) // fontDirectionHint
  view.setInt16(50, 0) // indexToLocFormat
  view.setInt16(52, 0) // glyphDataFormat
  return buf
}

/**
 * Build bloc/bdat tables (identical structure to EBLC/EBDT)
 * with a single format-1 bitmap glyph
 */
function buildBlocBdat(
  ppem: number,
  glyphId: number,
  bitmapData: Uint8Array,
  width: number,
  height: number,
): { bloc: ArrayBuffer, bdat: ArrayBuffer } {
  // bdat: version(4) + smallMetrics(5) + bitmap
  const bdatBuf = new ArrayBuffer(4 + 5 + bitmapData.length)
  const bdatView = new DataView(bdatBuf)
  bdatView.setUint16(0, 2) // major version
  bdatView.setUint16(2, 0)
  bdatView.setUint8(4, height)
  bdatView.setUint8(5, width)
  bdatView.setInt8(6, 0) // bearingX
  bdatView.setInt8(7, height) // bearingY
  bdatView.setUint8(8, width) // advance
  new Uint8Array(bdatBuf).set(bitmapData, 9)
  const glyphOffset = 4
  const glyphSize = 5 + bitmapData.length

  // bloc: header(8) + bitmapSize(48) + indexSubTableArray(8) + indexSubTable(8 + offsets)
  const blocBuf = new ArrayBuffer(8 + 48 + 8 + 8 + 8)
  const blocView = new DataView(blocBuf)
  let pos = 0
  blocView.setUint16(pos, 2); pos += 2 // major version
  blocView.setUint16(pos, 0); pos += 2
  blocView.setUint32(pos, 1); pos += 4 // numSizes

  const idxArrayStart = 8 + 48
  blocView.setUint32(pos, idxArrayStart); pos += 4 // indexSubTableArrayOffset
  blocView.setUint32(pos, 24); pos += 4 // indexTablesSize
  blocView.setUint32(pos, 1); pos += 4 // numberOfIndexSubTables
  pos += 4 // colorRef
  pos += 24 // sbitLineMetrics hori/vert
  blocView.setUint16(pos, glyphId); pos += 2 // startGlyphIndex
  blocView.setUint16(pos, glyphId); pos += 2 // endGlyphIndex
  blocView.setUint8(pos++, ppem) // ppemX
  blocView.setUint8(pos++, ppem) // ppemY
  blocView.setUint8(pos++, 1) // bitDepth
  blocView.setInt8(pos++, 1) // flags

  // IndexSubTableArray
  blocView.setUint16(pos, glyphId); pos += 2
  blocView.setUint16(pos, glyphId); pos += 2
  blocView.setUint32(pos, 8); pos += 4 // additionalOffsetToIndexSubtable

  // IndexSubTable format 1
  blocView.setUint16(pos, 1); pos += 2 // indexFormat
  blocView.setUint16(pos, 1); pos += 2 // imageFormat
  blocView.setUint32(pos, glyphOffset); pos += 4 // imageDataOffset
  blocView.setUint32(pos, 0); pos += 4 // offset[0]
  blocView.setUint32(pos, glyphSize); pos += 4 // offset[1]

  return { bloc: blocBuf, bdat: bdatBuf }
}

describe('bdat/bloc and bhed table registration', () => {
  it('should parse bhed as a bitmap font header', () => {
    const sfnt = parseSfntDirectory(buildSfnt([{ tag: 'bhed', data: buildBhed(1000) }]))
    const manager = new SfntTableManager(sfnt)

    const bhed = manager.bhed!
    expect(bhed).not.toBeNull()
    expect(bhed.unitsPerEm).toBe(1000)
    expect(bhed.xMin).toBe(-100)
    expect(bhed.yMax).toBe(800)
    expect(bhed.lowestRecPPEM).toBe(8)
  })

  it('should parse bdat/bloc bitmaps via the EBDT/EBLC parser', () => {
    const bitmapData = new Uint8Array([0xFF, 0x81, 0x81, 0xFF])
    const { bloc, bdat } = buildBlocBdat(12, 3, bitmapData, 8, 4)
    const sfnt = parseSfntDirectory(buildSfnt([
      { tag: 'bloc', data: bloc },
      { tag: 'bdat', data: bdat },
    ]))
    const manager = new SfntTableManager(sfnt)

    const table = manager.bdat!
    expect(table).not.toBeNull()
    expect(table.availableStrikes).toHaveLength(1)
    expect(table.availableStrikes[0]).toMatchObject({ ppemX: 12, ppemY: 12 })

    const glyph = table.getGlyphBitmap(3, 12)!
    expect(glyph).not.toBeNull()
    expect(glyph.format).toBe(1)
    expect(glyph.data).toEqual(bitmapData)
    expect(glyph.metrics.width).toBe(8)
    expect(glyph.metrics.height).toBe(4)
  })

  it('should return null when the tables are absent', () => {
    const sfnt = parseSfntDirectory(buildSfnt([{ tag: 'bhed', data: buildBhed(1000) }]))
    const manager = new SfntTableManager(sfnt)

    expect(manager.bdat).toBeNull()

    const sfnt2 = parseSfntDirectory(buildSfnt([{ tag: 'ltag', data: new ArrayBuffer(12) }]))
    expect(new SfntTableManager(sfnt2).bhed).toBeNull()
  })
})
