import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Font, normalizePdfEmbeddedFont, type ImportedFontInfo } from '../../src/index.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

function fontInfo(
  bytes: Uint8Array,
  format: ImportedFontInfo['fontFileFormat'],
  familyName: string,
  bold = false,
): ImportedFontInfo {
  return {
    baseFont: 'ABCDEF+' + familyName,
    familyName,
    subtype: format === 'cff' ? 'Type1' : 'TrueType',
    flags: bold ? 0x40000 : 0,
    italic: false,
    serif: false,
    fixedPitch: false,
    bold,
    fontFile: bytes,
    fontFileFormat: format,
  }
}

function sfntTableBytes(sfnt: Uint8Array, tag: string): Uint8Array {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength)
  const numTables = view.getUint16(4, false)
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16
    const recordTag = String.fromCharCode(sfnt[record]!, sfnt[record + 1]!, sfnt[record + 2]!, sfnt[record + 3]!)
    if (recordTag !== tag) continue
    const offset = view.getUint32(record + 8, false)
    const length = view.getUint32(record + 12, false)
    return sfnt.slice(offset, offset + length)
  }
  throw new Error(`Fixture font does not contain table ${tag}`)
}

function makeUnsortedNameRecords(source: Uint8Array): Uint8Array {
  const result = source.slice()
  const view = new DataView(result.buffer)
  const numTables = view.getUint16(4, false)
  let nameOffset = -1
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16
    const tag = String.fromCharCode(result[record]!, result[record + 1]!, result[record + 2]!, result[record + 3]!)
    if (tag === 'name') nameOffset = view.getUint32(record + 8, false)
  }
  if (nameOffset < 0) throw new Error('Fixture font does not contain a name table')
  const count = view.getUint16(nameOffset + 2, false)
  if (count < 2) throw new Error('Fixture name table requires at least two records')
  const first = result.slice(nameOffset + 6, nameOffset + 18)
  const lastOffset = nameOffset + 6 + (count - 1) * 12
  result.copyWithin(nameOffset + 6, lastOffset, lastOffset + 12)
  result.set(first, lastOffset)
  return result
}

describe('PDF embedded font normalization', () => {
  it('wraps a bare simple CFF program without changing its glyph identity', () => {
    const openType = new Uint8Array(readFileSync(join(FIXTURES, 'SourceSans3-Regular.otf')))
    const bareCff = sfntTableBytes(openType, 'CFF ')
    const normalized = normalizePdfEmbeddedFont(fontInfo(bareCff, 'cff', 'SourceSans3-Regular'))

    expect(normalized).not.toBeNull()
    const original = Font.load(openType.buffer.slice(openType.byteOffset, openType.byteOffset + openType.byteLength))
    const font = Font.load(normalized!.buffer.slice(normalized!.byteOffset, normalized!.byteOffset + normalized!.byteLength))
    expect(font.familyName).toBe('SourceSans3')
    expect(font.postScriptName).toBe('SourceSans3-Regular')
    expect(font.getGlyphId(0x41)).toBe(original.getGlyphId(0x41))
    expect(font.getGlyphId(0x41)).toBeGreaterThan(0)
  })

  it('does not duplicate a style suffix already present in the PDF font name', () => {
    const openType = new Uint8Array(readFileSync(join(FIXTURES, 'SourceSans3-Regular.otf')))
    const bareCff = sfntTableBytes(openType, 'CFF ')
    const normalized = normalizePdfEmbeddedFont(fontInfo(bareCff, 'cff', 'MyriadPro-Bold', true))!
    const font = Font.load(normalized.buffer.slice(normalized.byteOffset, normalized.byteOffset + normalized.byteLength))

    expect(font.familyName).toBe('MyriadPro')
    expect(font.fullName).toBe('MyriadPro Bold')
    expect(font.postScriptName).toBe('MyriadPro-Bold')
  })

  it('replaces producer-invalid name record ordering while preserving TrueType glyph data', () => {
    const originalBytes = new Uint8Array(readFileSync(join(FIXTURES, 'Roboto-Regular.ttf')))
    const unsorted = makeUnsortedNameRecords(originalBytes)
    const invalidFont = Font.load(unsorted.buffer.slice(unsorted.byteOffset, unsorted.byteOffset + unsorted.byteLength))
    expect(function () { return invalidFont.familyName }).toThrow(/name records must be sorted/)

    const normalized = normalizePdfEmbeddedFont(fontInfo(unsorted, 'truetype', 'PDF Roboto'))!
    const font = Font.load(normalized.buffer.slice(normalized.byteOffset, normalized.byteOffset + normalized.byteLength))
    expect(font.familyName).toBe('PDF Roboto')
    expect(font.getGlyphId(0x41)).toBe(Font.load(originalBytes.buffer.slice(originalBytes.byteOffset, originalBytes.byteOffset + originalBytes.byteLength)).getGlyphId(0x41))
  })

  it('returns null when no embedded font program exists', () => {
    const info = fontInfo(new Uint8Array(), 'truetype', 'Missing')
    delete info.fontFile
    delete info.fontFileFormat
    expect(normalizePdfEmbeddedFont(info)).toBeNull()
  })
})
