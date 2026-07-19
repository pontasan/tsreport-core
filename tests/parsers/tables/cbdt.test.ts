import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseCbdt } from '../../../src/parsers/tables/cbdt.js'

/**
 * Build synthetic CBLC + CBDT tables for testing
 * Format 17 (smallMetrics + PNG data) with IndexSubTable Format 1
 */
function buildCblcCbdtTables(
  ppem: number,
  glyphs: { glyphId: number; pngData: Uint8Array; width: number; height: number }[],
): { cblc: ArrayBuffer; cbdt: ArrayBuffer } {
  if (glyphs.length === 0) {
    // Empty tables
    const cblcBuf = new ArrayBuffer(8)
    const cblcView = new DataView(cblcBuf)
    cblcView.setUint16(0, 3) // major
    cblcView.setUint16(2, 0) // minor
    cblcView.setUint32(4, 0) // numSizes = 0

    const cbdtBuf = new ArrayBuffer(4)
    const cbdtView = new DataView(cbdtBuf)
    cbdtView.setUint16(0, 3) // major
    cbdtView.setUint16(2, 0) // minor

    return { cblc: cblcBuf, cbdt: cbdtBuf }
  }

  // Sort glyphs by ID
  const sorted = [...glyphs].sort((a, b) => a.glyphId - b.glyphId)
  const firstGlyph = sorted[0]!.glyphId
  const lastGlyph = sorted[sorted.length - 1]!.glyphId

  // Build CBDT: header(4) + for each glyph: smallMetrics(5) + dataLen(4) + pngData
  const cbdtBuf = new ArrayBuffer(8192)
  const cbdtView = new DataView(cbdtBuf)
  let cbdtPos = 0
  cbdtView.setUint16(cbdtPos, 3); cbdtPos += 2 // major
  cbdtView.setUint16(cbdtPos, 0); cbdtPos += 2 // minor

  // glyphId → offset in CBDT
  const glyphOffsets = new Map<number, { offset: number; size: number }>()
  for (const g of sorted) {
    const start = cbdtPos
    // smallMetrics: height(1) + width(1) + bearingX(1) + bearingY(1) + advance(1) = 5
    cbdtView.setUint8(cbdtPos++, g.height)
    cbdtView.setUint8(cbdtPos++, g.width)
    cbdtView.setInt8(cbdtPos++, 0) // bearingX
    cbdtView.setInt8(cbdtPos++, g.height) // bearingY
    cbdtView.setUint8(cbdtPos++, g.width) // advance
    // dataLen(4) + data
    cbdtView.setUint32(cbdtPos, g.pngData.length); cbdtPos += 4
    new Uint8Array(cbdtBuf).set(g.pngData, cbdtPos)
    cbdtPos += g.pngData.length
    glyphOffsets.set(g.glyphId, { offset: start, size: cbdtPos - start })
  }

  // Build CBLC
  const cblcBuf = new ArrayBuffer(8192)
  const cblcView = new DataView(cblcBuf)
  let cblcPos = 0

  // Header: version(4) + numSizes(4) = 8
  cblcView.setUint16(cblcPos, 3); cblcPos += 2
  cblcView.setUint16(cblcPos, 0); cblcPos += 2
  cblcView.setUint32(cblcPos, 1); cblcPos += 4

  // BitmapSize record: 48 bytes
  const bitmapSizeStart = cblcPos
  const indexSubTableArrayOffsetPos = cblcPos
  cblcPos += 4 // indexSubTableArrayOffset
  cblcPos += 4 // indexTablesSize
  cblcView.setUint32(cblcPos, 1); cblcPos += 4 // numberOfIndexSubTables
  cblcPos += 4 // colorRef
  // sbitLineMetrics hori (12 bytes)
  for (let i = 0; i < 12; i++) cblcView.setUint8(cblcPos++, 0)
  // sbitLineMetrics vert (12 bytes)
  for (let i = 0; i < 12; i++) cblcView.setUint8(cblcPos++, 0)
  cblcView.setUint16(cblcPos, firstGlyph); cblcPos += 2 // startGlyphIndex
  cblcView.setUint16(cblcPos, lastGlyph); cblcPos += 2 // endGlyphIndex
  cblcView.setUint8(cblcPos++, ppem) // ppemX
  cblcView.setUint8(cblcPos++, ppem) // ppemY
  cblcView.setUint8(cblcPos++, 32) // bitDepth
  cblcView.setInt8(cblcPos++, 1) // flags

  // IndexSubTableArray
  const indexSubTableArrayStart = cblcPos
  cblcView.setUint32(indexSubTableArrayOffsetPos, indexSubTableArrayStart)

  // IndexSubTable header: firstGlyph(2) + lastGlyph(2) + additionalOffset(4) = 8
  cblcView.setUint16(cblcPos, firstGlyph); cblcPos += 2
  cblcView.setUint16(cblcPos, lastGlyph); cblcPos += 2
  const additionalOffsetPos = cblcPos; cblcPos += 4

  // IndexSubTable (format 1): indexFormat(2) + imageFormat(2) + imageDataOffset(4)
  const subtableStart = cblcPos
  cblcView.setUint32(additionalOffsetPos, subtableStart - indexSubTableArrayStart)
  cblcView.setUint16(cblcPos, 1); cblcPos += 2 // indexFormat = 1
  cblcView.setUint16(cblcPos, 17); cblcPos += 2 // imageFormat = 17
  cblcView.setUint32(cblcPos, 0); cblcPos += 4 // imageDataOffset base = 0

  // Format 1: uint32 offsets for each glyph in range, plus one sentinel
  const numGlyphsInRange = lastGlyph - firstGlyph + 1
  for (let g = firstGlyph; g <= lastGlyph + 1; g++) {
    const info = glyphOffsets.get(g)
    if (info) {
      cblcView.setUint32(cblcPos, info.offset)
    } else if (g === lastGlyph + 1) {
      // Sentinel: end of last glyph
      const lastInfo = glyphOffsets.get(lastGlyph)
      cblcView.setUint32(cblcPos, lastInfo ? lastInfo.offset + lastInfo.size : 0)
    } else {
      // Empty glyph
      const prevGlyph = g - 1
      const prevInfo = glyphOffsets.get(prevGlyph)
      cblcView.setUint32(cblcPos, prevInfo ? prevInfo.offset + prevInfo.size : 0)
    }
    cblcPos += 4
  }

  // Set indexTablesSize
  cblcView.setUint32(indexSubTableArrayOffsetPos + 4, cblcPos - indexSubTableArrayStart)

  return {
    cblc: cblcBuf.slice(0, cblcPos),
    cbdt: cbdtBuf.slice(0, cbdtPos),
  }
}

describe('CBDT/CBLC table parser', () => {
  // Verifies that a format-17 glyph is located via the CBLC strike/IndexSubTable (format 1) and returns its PNG bytes and small metrics.
  it('should parse a single glyph bitmap', () => {
    const pngData = new Uint8Array([0x89, 0x50, 0x4E, 0x47])
    const { cblc, cbdt } = buildCblcCbdtTables(20, [
      { glyphId: 5, pngData, width: 16, height: 16 },
    ])

    const table = parseCbdt(new BinaryReader(cblc), new BinaryReader(cbdt))
    expect(table.availableStrikes).toMatchObject([{ ppemX: 20, ppemY: 20 }])

    const glyph = table.getGlyphBitmap(5, 20)
    expect(glyph).not.toBeNull()
    expect(glyph!.format).toBe(17)
    expect(glyph!.data).toEqual(pngData)
    expect(glyph!.metrics.height).toBe(16)
    expect(glyph!.metrics.width).toBe(16)
  })

  // Verifies that getGlyphBitmap returns null for a glyph ID outside the strike's glyph range.
  it('should return null for missing glyph', () => {
    const { cblc, cbdt } = buildCblcCbdtTables(20, [
      { glyphId: 5, pngData: new Uint8Array([1, 2, 3]), width: 8, height: 8 },
    ])

    const table = parseCbdt(new BinaryReader(cblc), new BinaryReader(cbdt))
    expect(table.getGlyphBitmap(99, 20)).toBeNull()
  })

  // Verifies that a CBLC with numSizes=0 produces no strikes and lookups return null instead of failing.
  it('should handle empty table', () => {
    const { cblc, cbdt } = buildCblcCbdtTables(20, [])
    const table = parseCbdt(new BinaryReader(cblc), new BinaryReader(cbdt))

    expect(table.availableStrikes).toEqual([])
    expect(table.getGlyphBitmap(0)).toBeNull()
  })
})
