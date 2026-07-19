import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/font.js'
import { buildTable, buildTestFont } from './renderer/synthetic-font.js'

function loadNotoSans(): Font {
  const bytes = readFileSync(resolve(import.meta.dirname, 'fixtures/fonts/NotoSans-Regular.ttf'))
  return Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

describe('OpenType core-table public consumers', () => {
  it('connects head, hhea, hmtx, maxp, name, OS/2, and post fields to public APIs', () => {
    const font = loadNotoSans()
    const glyphId = font.getGlyphId(0x41)
    const glyph = font.getGlyph(glyphId)

    expect(font.fontHeader.unitsPerEm).toBe(font.metrics.unitsPerEm)
    expect(font.fontHeader.xMin).toBeLessThanOrEqual(glyph.xMin)
    expect(font.horizontalHeader.ascender).toBe(font.metrics.ascender)
    expect(font.horizontalHeader.numberOfHMetrics).toBeGreaterThan(0)
    expect(font.maximumProfile.numGlyphs).toBe(font.numGlyphs)
    expect(font.maximumProfile.maxPoints).toBeGreaterThan(0)
    expect(font.getAdvanceWidth(glyphId)).toBe(glyph.advanceWidth)
    expect(font.getLeftSideBearing(glyphId)).toBe(glyph.lsb)
    expect(font.familyName).toBe(font.getName(1))
    expect(font.nameRecords.some(record => record.nameId === 5 && record.value !== undefined)).toBe(true)
    expect(font.os2Metadata.weightClass).toBe(font.metrics.weightClass)
    expect(font.postMetadata.italicAngle).toBe(font.metrics.italicAngle)
    expect(font.postMetadata.underlineThickness).toBe(font.metrics.underlineThickness)
  })

  it('returns defensive copies for mutable table payloads', () => {
    const font = loadNotoSans()
    const panose = font.os2Metadata.panose
    const originalPanose = font.os2Metadata.panose[0]
    panose[0] ^= 0xFF
    expect(font.os2Metadata.panose[0]).toBe(originalPanose)

    const rawRecord = font.nameRecords.find(record => record.rawValue !== undefined)
    if (rawRecord?.rawValue !== undefined && rawRecord.rawValue.length > 0) {
      const original = font.nameRecords.find(record => record.rawValue !== undefined)!.rawValue![0]
      rawRecord.rawValue[0] ^= 0xFF
      expect(font.nameRecords.find(record => record.rawValue !== undefined)!.rawValue![0]).toBe(original)
    }
  })

  it('exposes PCL printer metrics and classification data from the font resource', () => {
    const pclt = buildTable(function (writer) {
      writer.writeUint32(0x00010000)
      writer.writeUint32(12345)
      writer.writeUint16(600)
      writer.writeUint16(500)
      writer.writeUint16(0x0041)
      writer.writeUint16(0x5005)
      writer.writeUint16(700)
      writer.writeUint16(277)
      writer.writeBytes(Uint8Array.from([...new TextEncoder().encode('Report Mono'), ...new Uint8Array(5)]))
      writer.writeBytes(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))
      writer.writeBytes(Uint8Array.from([...new TextEncoder().encode('RPT'), 0, 0, 0]))
      writer.writeUint8(0xfd)
      writer.writeUint8(0)
      writer.writeUint8(0x42)
      writer.writeUint8(0)
    })
    const meta = buildTable(function (writer) {
      writer.writeUint32(1)
      writer.writeUint32(0)
      writer.writeUint32(0)
      writer.writeUint32(1)
      writer.writeTag('dlng')
      writer.writeUint32(28)
      writer.writeUint32(4)
      writer.writeBytes(new TextEncoder().encode('Latn'))
    })
    const font = Font.load(buildTestFont([null], [], [['PCLT', pclt], ['meta', meta]]))

    expect(font.pclt).toMatchObject({
      fontNumber: 12345,
      pitch: 600,
      xHeight: 500,
      capHeight: 700,
      symbolSet: 277,
      typeface: 'Report Mono',
      fileName: 'RPT',
      strokeWeight: -3,
    })
    expect(font.meta?.getValue('dlng')).toBe('Latn')

    const subset = Font.load(font.subsetWithMapping('').buffer)
    expect(subset.pclt).toMatchObject({ fontNumber: 12345, typeface: 'Report Mono' })
    expect(subset.meta?.getValue('dlng')).toBe('Latn')
  })
})
