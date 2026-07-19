import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseEbdt } from '../../../src/parsers/tables/ebdt.js'

/**
 * Build synthetic EBLC + EBDT tables for testing
 * Format 1 (smallMetrics + byte-aligned bitmap) with IndexSubTable Format 1
 */
function buildEblcEbdtTables(
  ppem: number,
  glyphs: { glyphId: number; bitmapData: Uint8Array; width: number; height: number }[],
): { eblc: ArrayBuffer; ebdt: ArrayBuffer } {
  if (glyphs.length === 0) {
    const eblcBuf = new ArrayBuffer(8)
    const eblcView = new DataView(eblcBuf)
    eblcView.setUint16(0, 2); eblcView.setUint16(2, 0)
    eblcView.setUint32(4, 0)

    const ebdtBuf = new ArrayBuffer(4)
    const ebdtView = new DataView(ebdtBuf)
    ebdtView.setUint16(0, 2); ebdtView.setUint16(2, 0)

    return { eblc: eblcBuf, ebdt: ebdtBuf }
  }

  const sorted = [...glyphs].sort((a, b) => a.glyphId - b.glyphId)
  const firstGlyph = sorted[0]!.glyphId
  const lastGlyph = sorted[sorted.length - 1]!.glyphId

  // Build EBDT
  const ebdtBuf = new ArrayBuffer(8192)
  const ebdtView = new DataView(ebdtBuf)
  let ebdtPos = 0
  ebdtView.setUint16(ebdtPos, 2); ebdtPos += 2
  ebdtView.setUint16(ebdtPos, 0); ebdtPos += 2

  const glyphOffsets = new Map<number, { offset: number; size: number }>()
  for (const g of sorted) {
    const start = ebdtPos
    // smallMetrics(5) + bitmap data
    ebdtView.setUint8(ebdtPos++, g.height)
    ebdtView.setUint8(ebdtPos++, g.width)
    ebdtView.setInt8(ebdtPos++, 0) // bearingX
    ebdtView.setInt8(ebdtPos++, g.height) // bearingY
    ebdtView.setUint8(ebdtPos++, g.width) // advance
    new Uint8Array(ebdtBuf).set(g.bitmapData, ebdtPos)
    ebdtPos += g.bitmapData.length
    glyphOffsets.set(g.glyphId, { offset: start, size: ebdtPos - start })
  }

  // Build EBLC (same structure as CBLC)
  const eblcBuf = new ArrayBuffer(8192)
  const eblcView = new DataView(eblcBuf)
  let eblcPos = 0

  eblcView.setUint16(eblcPos, 2); eblcPos += 2
  eblcView.setUint16(eblcPos, 0); eblcPos += 2
  eblcView.setUint32(eblcPos, 1); eblcPos += 4

  const bitmapSizeStart = eblcPos
  const idxOffsetPos = eblcPos; eblcPos += 4
  eblcPos += 4 // indexTablesSize
  eblcView.setUint32(eblcPos, 1); eblcPos += 4
  eblcPos += 4 // colorRef
  for (let i = 0; i < 24; i++) eblcView.setUint8(eblcPos++, 0)
  eblcView.setUint16(eblcPos, firstGlyph); eblcPos += 2
  eblcView.setUint16(eblcPos, lastGlyph); eblcPos += 2
  eblcView.setUint8(eblcPos++, ppem)
  eblcView.setUint8(eblcPos++, ppem)
  eblcView.setUint8(eblcPos++, 1) // bitDepth = mono
  eblcView.setInt8(eblcPos++, 1) // flags

  const idxArrayStart = eblcPos
  eblcView.setUint32(idxOffsetPos, idxArrayStart)

  // IndexSubTable header
  eblcView.setUint16(eblcPos, firstGlyph); eblcPos += 2
  eblcView.setUint16(eblcPos, lastGlyph); eblcPos += 2
  const addlOffsetPos = eblcPos; eblcPos += 4

  const subtableStart = eblcPos
  eblcView.setUint32(addlOffsetPos, subtableStart - idxArrayStart)
  eblcView.setUint16(eblcPos, 1); eblcPos += 2 // indexFormat = 1
  eblcView.setUint16(eblcPos, 1); eblcPos += 2 // imageFormat = 1
  eblcView.setUint32(eblcPos, 0); eblcPos += 4 // imageDataOffset = 0

  for (let g = firstGlyph; g <= lastGlyph + 1; g++) {
    const info = glyphOffsets.get(g)
    if (info) {
      eblcView.setUint32(eblcPos, info.offset)
    } else if (g === lastGlyph + 1) {
      const lastInfo = glyphOffsets.get(lastGlyph)
      eblcView.setUint32(eblcPos, lastInfo ? lastInfo.offset + lastInfo.size : 0)
    } else {
      const prevInfo = glyphOffsets.get(g - 1)
      eblcView.setUint32(eblcPos, prevInfo ? prevInfo.offset + prevInfo.size : 0)
    }
    eblcPos += 4
  }

  eblcView.setUint32(idxOffsetPos + 4, eblcPos - idxArrayStart)

  return {
    eblc: eblcBuf.slice(0, eblcPos),
    ebdt: ebdtBuf.slice(0, ebdtPos),
  }
}

describe('EBDT/EBLC table parser', () => {
  // Verifies that a format-1 glyph (small metrics + byte-aligned mono bitmap) is located via EBLC and returns its raw rows and metrics.
  it('should parse monochrome bitmap glyph', () => {
    const bitmapData = new Uint8Array([0xFF, 0x81, 0x81, 0xFF]) // 4 rows of 8px
    const { eblc, ebdt } = buildEblcEbdtTables(12, [
      { glyphId: 3, bitmapData, width: 8, height: 4 },
    ])

    const table = parseEbdt(new BinaryReader(eblc), new BinaryReader(ebdt))
    expect(table.availableStrikes).toMatchObject([{ ppemX: 12, ppemY: 12 }])

    const glyph = table.getGlyphBitmap(3, 12)
    expect(glyph).not.toBeNull()
    expect(glyph!.format).toBe(1)
    expect(glyph!.data).toEqual(bitmapData)
    expect(glyph!.metrics.height).toBe(4)
    expect(glyph!.metrics.width).toBe(8)
  })

  // Verifies that getGlyphBitmap returns null for a glyph ID outside the strike's glyph range.
  it('should return null for missing glyph', () => {
    const { eblc, ebdt } = buildEblcEbdtTables(12, [
      { glyphId: 3, bitmapData: new Uint8Array([1]), width: 1, height: 1 },
    ])

    const table = parseEbdt(new BinaryReader(eblc), new BinaryReader(ebdt))
    expect(table.getGlyphBitmap(99, 12)).toBeNull()
  })

  // Verifies that an EBLC with numSizes=0 produces no strikes and lookups return null instead of failing.
  it('should handle empty table', () => {
    const { eblc, ebdt } = buildEblcEbdtTables(12, [])
    const table = parseEbdt(new BinaryReader(eblc), new BinaryReader(ebdt))

    expect(table.availableStrikes).toEqual([])
    expect(table.getGlyphBitmap(0)).toBeNull()
  })
})

describe('EBDT composite bitmaps (formats 8/9)', () => {
  /** Builder with one IndexSubTable per contiguous same-format glyph run. */
  function buildComposite(
    ppem: number,
    glyphs: { glyphId: number; format: number; payload: Uint8Array }[],
    bitDepth = 1,
  ): { eblc: ArrayBuffer; ebdt: ArrayBuffer } {
    const sorted = [...glyphs].sort((a, b) => a.glyphId - b.glyphId)
    // EBDT
    const ebdtBuf = new ArrayBuffer(8192)
    const ebdtView = new DataView(ebdtBuf)
    let ebdtPos = 4
    ebdtView.setUint16(0, 2)
    const offsets = new Map<number, { offset: number; size: number }>()
    for (const g of sorted) {
      new Uint8Array(ebdtBuf).set(g.payload, ebdtPos)
      offsets.set(g.glyphId, { offset: ebdtPos, size: g.payload.length })
      ebdtPos += g.payload.length
    }
    // Group into runs of equal format with contiguous glyph ids
    const runs: { first: number; last: number; format: number }[] = []
    for (const g of sorted) {
      const last = runs[runs.length - 1]
      if (last && last.format === g.format && g.glyphId === last.last + 1) last.last = g.glyphId
      else runs.push({ first: g.glyphId, last: g.glyphId, format: g.format })
    }
    // EBLC
    const eblcBuf = new ArrayBuffer(8192)
    const v = new DataView(eblcBuf)
    let pos = 0
    v.setUint16(pos, 2); pos += 2
    v.setUint16(pos, 0); pos += 2
    v.setUint32(pos, 1); pos += 4
    const idxOffsetPos = pos; pos += 4
    pos += 4
    v.setUint32(pos, runs.length); pos += 4
    pos += 4
    for (let i = 0; i < 24; i++) v.setUint8(pos++, 0)
    v.setUint16(pos, sorted[0]!.glyphId); pos += 2
    v.setUint16(pos, sorted[sorted.length - 1]!.glyphId); pos += 2
    v.setUint8(pos++, ppem)
    v.setUint8(pos++, ppem)
    v.setUint8(pos++, bitDepth)
    v.setInt8(pos++, 1)
    const idxArrayStart = pos
    v.setUint32(idxOffsetPos, idxArrayStart)
    pos += runs.length * 8
    const headerFor: number[] = []
    for (const run of runs) {
      headerFor.push(pos)
      v.setUint16(pos, 1); pos += 2 // indexFormat 1
      v.setUint16(pos, run.format); pos += 2
      v.setUint32(pos, 0); pos += 4
      for (let g = run.first; g <= run.last + 1; g++) {
        const info = offsets.get(Math.min(g, run.last))!
        v.setUint32(pos, g <= run.last ? info.offset : info.offset + info.size)
        pos += 4
      }
    }
    let arrayPos = idxArrayStart
    for (let i = 0; i < runs.length; i++) {
      v.setUint16(arrayPos, runs[i]!.first); arrayPos += 2
      v.setUint16(arrayPos, runs[i]!.last); arrayPos += 2
      v.setUint32(arrayPos, headerFor[i]! - idxArrayStart); arrayPos += 4
    }
    v.setUint32(idxOffsetPos + 4, pos - idxArrayStart)
    return { eblc: eblcBuf.slice(0, pos), ebdt: ebdtBuf.slice(0, ebdtPos) }
  }

  function smallGlyph(width: number, height: number, rows: number[]): Uint8Array {
    // small metrics: height, width, bearingX 0, bearingY = height, advance
    return new Uint8Array([height, width, 0, height, width, ...rows])
  }

  it('composes a format 8 glyph from two format 1 components', () => {
    // Component 10: 8x2 solid rows; component 11: 8x2 alternating
    const comp10 = smallGlyph(8, 2, [0xFF, 0xFF])
    const comp11 = smallGlyph(8, 2, [0xAA, 0x55])
    // Composite offsets are top-left positions within the parent bitmap.
    const composite = new Uint8Array([
      4, 8, 0, 4, 8, // small metrics: h=4 w=8 bearingY=4
      0,             // pad
      0, 2,          // numComponents
      0, 10, 0, 2,   // glyph 10 at rows 2-3
      0, 11, 0, 0,   // glyph 11 at rows 0-1
    ])
    const { eblc, ebdt } = buildComposite(12, [
      { glyphId: 10, format: 1, payload: comp10 },
      { glyphId: 11, format: 1, payload: comp11 },
      { glyphId: 12, format: 8, payload: composite },
    ])
    const table = parseEbdt(new BinaryReader(eblc), new BinaryReader(ebdt))
    const result = table.getGlyphBitmap(12, 12)
    expect(result).not.toBeNull()
    expect(result!.format).toBe(1) // composed to byte-aligned
    expect(result!.metrics.width).toBe(8)
    expect(result!.metrics.height).toBe(4)
    expect(Array.from(result!.data)).toEqual([0xAA, 0x55, 0xFF, 0xFF])
  })

  it('rejects a self-referencing composite explicitly', () => {
    const selfRef = new Uint8Array([
      2, 8, 0, 2, 8, 0,
      0, 1,
      0, 12, 0, 0,
    ])
    const { eblc, ebdt } = buildComposite(12, [
      { glyphId: 12, format: 8, payload: selfRef },
    ])
    const table = parseEbdt(new BinaryReader(eblc), new BinaryReader(ebdt))
    expect(() => table.getGlyphBitmap(12, 12)).toThrow(/composite cycle/)
  })

  it('composes 2-bit grayscale components at top-left offsets', () => {
    const component = smallGlyph(4, 1, [0xE4]) // pixels 3,2,1,0
    const composite = new Uint8Array([
      2, 4, 0, 2, 4,
      0,
      0, 1,
      0, 10, 0, 1,
    ])
    const { eblc, ebdt } = buildComposite(12, [
      { glyphId: 10, format: 1, payload: component },
      { glyphId: 12, format: 8, payload: composite },
    ], 2)
    const table = parseEbdt(new BinaryReader(eblc), new BinaryReader(ebdt))
    expect(Array.from(table.getGlyphBitmap(12, 12)!.data)).toEqual([0x00, 0xE4])
  })

  it('rejects indirect composite cycles', () => {
    const ref13 = new Uint8Array([1, 1, 0, 1, 1, 0, 0, 1, 0, 13, 0, 0])
    const ref12 = new Uint8Array([1, 1, 0, 1, 1, 0, 0, 1, 0, 12, 0, 0])
    const { eblc, ebdt } = buildComposite(12, [
      { glyphId: 12, format: 8, payload: ref13 },
      { glyphId: 13, format: 8, payload: ref12 },
    ])
    const table = parseEbdt(new BinaryReader(eblc), new BinaryReader(ebdt))
    expect(() => table.getGlyphBitmap(12, 12)).toThrow(/composite cycle/)
  })
})
