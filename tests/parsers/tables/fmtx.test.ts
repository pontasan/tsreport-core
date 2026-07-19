import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseFmtx } from '../../../src/parsers/tables/fmtx.js'

describe('fmtx table parser', () => {
  function buildFmtx(version = 0x00020000, length = 16): ArrayBuffer {
    const buf = new ArrayBuffer(16)
    const view = new DataView(buf)
    view.setUint32(0, version)
    view.setUint32(4, 512) // glyphIndex
    view.setUint8(8, 0) // horizontalBefore
    view.setUint8(9, 1) // horizontalAfter
    view.setUint8(10, 2) // horizontalCaretHead
    view.setUint8(11, 3) // horizontalCaretBase
    view.setUint8(12, 4) // verticalBefore
    view.setUint8(13, 5) // verticalAfter
    view.setUint8(14, 6) // verticalCaretHead
    view.setUint8(15, 7) // verticalCaretBase
    return length === 16 ? buf : buf.slice(0, length)
  }

  it('should parse all metric point numbers', () => {
    const table = parseFmtx(new BinaryReader(buildFmtx()))
    expect(table.version).toBe(2)
    expect(table.glyphIndex).toBe(512)
    expect(table.horizontalBefore).toBe(0)
    expect(table.horizontalAfter).toBe(1)
    expect(table.horizontalCaretHead).toBe(2)
    expect(table.horizontalCaretBase).toBe(3)
    expect(table.verticalBefore).toBe(4)
    expect(table.verticalAfter).toBe(5)
    expect(table.verticalCaretHead).toBe(6)
    expect(table.verticalCaretBase).toBe(7)
  })

  it('rejects unsupported versions', () => {
    expect(() => parseFmtx(new BinaryReader(buildFmtx(0x00010000))))
      .toThrow('Unsupported fmtx table version')
  })

  it('rejects truncated tables', () => {
    expect(() => parseFmtx(new BinaryReader(buildFmtx(0x00020000, 15))))
      .toThrow('fmtx table length must be exactly 16 bytes')
  })

  it('rejects tables with trailing data', () => {
    const full = new Uint8Array(17)
    full.set(new Uint8Array(buildFmtx()))

    expect(() => parseFmtx(new BinaryReader(full.buffer as ArrayBuffer)))
      .toThrow('fmtx table length must be exactly 16 bytes')
  })

  it('rejects a metric glyph outside maxp numGlyphs', () => {
    expect(() => parseFmtx(new BinaryReader(buildFmtx()), 512))
      .toThrow('fmtx glyphIndex 512 exceeds numGlyphs 512')
  })
})
