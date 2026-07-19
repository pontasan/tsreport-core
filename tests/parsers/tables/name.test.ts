import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseFont } from '../../../src/parsers/index.js'
import { decodeMacNameFromCmap, parseName } from '../../../src/parsers/tables/name.js'
import { decodeMacCjkName } from '../../../src/parsers/tables/mac-cjk-encodings.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'
import { Font } from '../../../src/index.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
const SOURCE_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/SourceSans3-Regular.otf')

describe('name table parser', () => {
  describe('NotoSans-Regular', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const name = parseName(getTableReader(sfnt, 'name')!)

    it('should have non-empty records array', () => {
      expect(name.records).toBeInstanceOf(Array)
      expect(name.records.length).toBeGreaterThan(0)
    })

    it('getName(1) should return family name containing "Noto Sans"', () => {
      const familyName = name.getName(1)
      expect(familyName).toBeDefined()
      expect(familyName).toContain('Noto Sans')
    })

    it('getName(2) should return "Regular" subfamily', () => {
      const subfamilyName = name.getName(2)
      expect(subfamilyName).toBeDefined()
      expect(subfamilyName).toBe('Regular')
    })

    it('getName(4) should return full name', () => {
      const fullName = name.getName(4)
      expect(fullName).toBeDefined()
      expect(fullName!.length).toBeGreaterThan(0)
      expect(fullName).toContain('Noto Sans')
    })

    it('getName(6) should return PostScript name (no spaces)', () => {
      const psName = name.getName(6)
      expect(psName).toBeDefined()
      expect(psName!.length).toBeGreaterThan(0)
      // PostScript names should not contain spaces
      expect(psName).not.toContain(' ')
    })

    it('should have Windows English records (platformId=3, languageId=0x0409)', () => {
      const windowsEnRecords = name.records.filter(
        r => r.platformId === 3 && r.languageId === 0x0409
      )
      expect(windowsEnRecords.length).toBeGreaterThan(0)
    })

    it('getName should prefer Windows English (platformId=3, languageId=0x0409)', () => {
      // Find the Windows English family name
      const windowsEn = name.records.find(
        r => r.nameId === 1 && r.platformId === 3 && r.languageId === 0x0409
      )
      const result = name.getName(1)

      if (windowsEn) {
        expect(result).toBe(windowsEn.value)
      }
    })

    it('should return undefined for non-existent nameId', () => {
      // nameId 999 should not exist
      const result = name.getName(999)
      expect(result).toBeUndefined()
    })

    it('getName(0) should return copyright notice', () => {
      const copyright = name.getName(0)
      // Copyright notice may or may not exist, but if it does it should be a string
      if (copyright !== undefined) {
        expect(typeof copyright).toBe('string')
        expect(copyright.length).toBeGreaterThan(0)
      }
    })

    it('records should have valid structure', () => {
      for (const record of name.records) {
        expect(record.platformId).toBeGreaterThanOrEqual(0)
        expect(record.platformId).toBeLessThanOrEqual(4)
        expect(record.encodingId).toBeGreaterThanOrEqual(0)
        expect(record.nameId).toBeGreaterThanOrEqual(0)
        expect(typeof record.value).toBe('string')
      }
    })
  })

  describe('Roboto-Regular', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const name = parseName(getTableReader(sfnt, 'name')!)

    it('getName(1) should return family name containing "Roboto"', () => {
      const familyName = name.getName(1)
      expect(familyName).toBeDefined()
      expect(familyName).toContain('Roboto')
    })

    it('getName(2) should return "Regular" subfamily', () => {
      const subfamilyName = name.getName(2)
      expect(subfamilyName).toBeDefined()
      expect(subfamilyName).toBe('Regular')
    })

    it('getName(4) should return full name', () => {
      const fullName = name.getName(4)
      expect(fullName).toBeDefined()
      expect(fullName).toContain('Roboto')
    })

    it('getName(6) should return PostScript name', () => {
      const psName = name.getName(6)
      expect(psName).toBeDefined()
      expect(psName!.length).toBeGreaterThan(0)
    })
  })

  describe('SourceSans3-Regular (OTF/CFF)', () => {
    const buffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseFont(buffer)
    const name = parseName(getTableReader(sfnt, 'name')!)

    it('getName(1) should return family name', () => {
      const familyName = name.getName(1)
      expect(familyName).toBeDefined()
      expect(familyName!.length).toBeGreaterThan(0)
    })

    it('getName(2) should return "Regular" subfamily', () => {
      const subfamilyName = name.getName(2)
      expect(subfamilyName).toBeDefined()
      expect(subfamilyName).toBe('Regular')
    })

    it('getName(6) should return PostScript name', () => {
      const psName = name.getName(6)
      expect(psName).toBeDefined()
      expect(psName!.length).toBeGreaterThan(0)
    })

    it('should have non-empty records', () => {
      expect(name.records.length).toBeGreaterThan(0)
    })
  })

  describe('Font class integration', () => {
    it('Font.familyName should match getName(1)', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const sfnt = parseSfntDirectory(buffer)
      const name = parseName(getTableReader(sfnt, 'name')!)

      expect(font.familyName).toBe(name.getName(1))
    })

    it('Font.postScriptName should match getName(6)', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const sfnt = parseSfntDirectory(buffer)
      const name = parseName(getTableReader(sfnt, 'name')!)

      expect(font.postScriptName).toBe(name.getName(6))
    })

    it('Font.subfamilyName should match getName(2)', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      expect(font.subfamilyName).toBe('Regular')
    })
  })

  describe('SfntTableManager lazy access', () => {
    it('should provide name via manager', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      expect(manager.name.getName(1)).toContain('Noto Sans')
      expect(manager.postScriptName.length).toBeGreaterThan(0)
    })
  })

  describe('synthetic validation', () => {
    it('parses sorted format 0 records and prefers Windows English names', () => {
      const table = buildNameTable(0, [
        { platformId: 1, encodingId: 0, languageId: 0, nameId: 1, bytes: asciiBytes('MacFamily') },
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, bytes: utf16BeBytes('WinFamily') },
      ])

      const name = parseName(new BinaryReader(table))

      expect(name.records.map(r => r.value)).toEqual(['MacFamily', 'WinFamily'])
      expect(name.getName(1)).toBe('WinFamily')
    })

    it('decodes Macintosh Roman name strings', () => {
      const table = buildNameTable(0, [
        { platformId: 1, encodingId: 0, languageId: 0, nameId: 1, bytes: macRomanBytes([0x43, 0x61, 0x66, 0x8E, 0xAA]) },
      ])

      const name = parseName(new BinaryReader(table))

      expect(name.records[0]!.value).toBe('Café™')
      expect(name.getName(1)).toBe('Café™')
    })

    it('decodes legacy Macintosh script encodings from their published mappings', () => {
      const table = buildNameTable(0, [
        { platformId: 1, encodingId: 4, languageId: 12, nameId: 1, bytes: bytes([0xC7]) },
        { platformId: 1, encodingId: 5, languageId: 10, nameId: 1, bytes: bytes([0xE0]) },
        { platformId: 1, encodingId: 6, languageId: 14, nameId: 1, bytes: bytes([0xB0]) },
        { platformId: 1, encodingId: 7, languageId: 32, nameId: 1, bytes: bytes([0x80]) },
        { platformId: 1, encodingId: 8, languageId: 0, nameId: 1, bytes: bytes([0xA5]) },
        { platformId: 1, encodingId: 9, languageId: 21, nameId: 1, bytes: bytes([0xA1, 0xE9]) },
        { platformId: 1, encodingId: 10, languageId: 70, nameId: 1, bytes: bytes([0xE8, 0xE8]) },
        { platformId: 1, encodingId: 11, languageId: 69, nameId: 1, bytes: bytes([0xA1, 0xE9]) },
        { platformId: 1, encodingId: 21, languageId: 22, nameId: 1, bytes: bytes([0xA1]) },
        { platformId: 1, encodingId: 23, languageId: 52, nameId: 1, bytes: bytes([0x80, 0xE0]) },
        { platformId: 1, encodingId: 24, languageId: 51, nameId: 1, bytes: bytes([0x80, 0xE0]) },
      ])

      expect(parseName(new BinaryReader(table)).records.map(record => record.value)).toEqual([
        'ا', 'א', 'Α', 'А', '∞', 'ॐ', '੍‌', 'ૐ', 'ก', 'Ⴀა', 'Աա',
      ])
    })

    it('decodes Windows legacy CJK code-page name strings', () => {
      const table = buildNameTable(0, [
        { platformId: 3, encodingId: 2, languageId: 0x0411, nameId: 1, bytes: bytes([0x93, 0xFA, 0x96, 0x7B]) },
        { platformId: 3, encodingId: 3, languageId: 0x0804, nameId: 1, bytes: bytes([0xD6, 0xD0, 0xCE, 0xC4]) },
        { platformId: 3, encodingId: 4, languageId: 0x0404, nameId: 1, bytes: bytes([0xA4, 0xA4, 0xA4, 0xE5]) },
        { platformId: 3, encodingId: 5, languageId: 0x0412, nameId: 1, bytes: bytes([0xC7, 0xD1, 0xB1, 0xDB]) },
        { platformId: 3, encodingId: 6, languageId: 0x0412, nameId: 1, bytes: bytes([0xD0, 0x65, 0x8B, 0x69]) },
      ])

      const name = parseName(new BinaryReader(table))

      expect(name.records.map(r => r.value)).toEqual(['日本', '中文', '中文', '한글', '한글'])
    })

    it('preserves Macintosh uninterpreted name strings without inventing a character mapping', () => {
      const raw = bytes([0x00, 0x7F, 0x80, 0xFF])
      const name = parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 1, encodingId: 32, languageId: 0, nameId: 1, bytes: raw },
      ])))

      expect(name.records[0]!.value).toBeUndefined()
      expect(name.records[0]!.rawValue).toEqual(raw)
      expect(name.getName(1)).toBeUndefined()
    })

    it('parses format 1 language-tag records', () => {
      const table = buildNameTable(1, [
        { platformId: 3, encodingId: 1, languageId: 0x8000, nameId: 1, bytes: utf16BeBytes('TaggedName') },
      ], [
        utf16BeBytes('en'),
      ])

      const name = parseName(new BinaryReader(table))

      expect(name.records[0]!.value).toBe('TaggedName')
      expect(name.records[0]!.langTag).toBe('en')
    })

    it('selects names by exact numeric language ID or BCP 47 language tag', () => {
      const table = buildNameTable(1, [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, bytes: utf16BeBytes('English') },
        { platformId: 3, encodingId: 1, languageId: 0x8000, nameId: 1, bytes: utf16BeBytes('Français') },
        { platformId: 3, encodingId: 1, languageId: 0x8001, nameId: 1, bytes: utf16BeBytes('繁體中文') },
      ], [
        utf16BeBytes('fr-CA'),
        utf16BeBytes('zh-Hant-HK'),
      ])

      const name = parseName(new BinaryReader(table))

      expect(name.getName(1, 0x0409)).toBe('English')
      expect(name.getName(1, 'FR-ca')).toBe('Français')
      expect(name.getName(1, 'zh-Hant-HK')).toBe('繁體中文')
      expect(name.getName(1, 'fr')).toBeUndefined()
    })

    it('accepts supplementary characters and well-formed extended BCP 47 tags', () => {
      const name = parseName(new BinaryReader(buildNameTable(1, [
        { platformId: 3, encodingId: 10, languageId: 0x8000, nameId: 1, bytes: utf16BeBytes('Plane 1: 𐐀') },
        { platformId: 3, encodingId: 10, languageId: 0x8001, nameId: 1, bytes: utf16BeBytes('Private') },
      ], [
        utf16BeBytes('sl-rozaj-biske-1994'),
        utf16BeBytes('en-Latn-US-u-ca-gregory-x-font'),
      ])))

      expect(name.getName(1, 'sl-rozaj-biske-1994')).toBe('Plane 1: 𐐀')
      expect(name.getName(1, 'en-latn-us-u-ca-gregory-x-font')).toBe('Private')
    })

    it('rejects unpaired UTF-16 surrogates in names and language tags', () => {
      expect(() => parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, bytes: bytes([0xD8, 0x00]) },
      ])))).toThrow('name UTF-16BE string has an unpaired high surrogate at byte 0')

      expect(() => parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, bytes: bytes([0xDC, 0x00]) },
      ])))).toThrow('name UTF-16BE string has an unpaired low surrogate at byte 0')

      expect(() => parseName(new BinaryReader(buildNameTable(1, [
        { platformId: 3, encodingId: 1, languageId: 0x8000, nameId: 1, bytes: utf16BeBytes('Name') },
      ], [
        bytes([0x00, 0x65, 0xD8, 0x00]),
      ])))).toThrow('name UTF-16BE string has an unpaired high surrogate at byte 2')
    })

    it('rejects malformed and duplicate BCP 47 subtags', () => {
      for (const tag of ['en_', 'en--US', 'en-a', 'en-1901-1901', 'en-u-ca-u-nu-latn', 'x']) {
        expect(() => parseName(new BinaryReader(buildNameTable(1, [
          { platformId: 3, encodingId: 1, languageId: 0x8000, nameId: 1, bytes: utf16BeBytes('Name') },
        ], [
          utf16BeBytes(tag),
        ])))).toThrow('is not a well-formed BCP 47 tag')
      }
    })

    it('rejects unsupported formats and truncated record arrays', () => {
      const unsupported = new BinaryWriter()
      unsupported.writeUint16(2)
      unsupported.writeUint16(0)
      unsupported.writeUint16(6)
      expect(() => parseName(new BinaryReader(unsupported.toArrayBuffer()))).toThrow(
        'Unsupported name table format: 2',
      )

      const truncated = new BinaryWriter()
      truncated.writeUint16(0)
      truncated.writeUint16(1)
      truncated.writeUint16(18)
      expect(() => parseName(new BinaryReader(truncated.toArrayBuffer()))).toThrow(
        'name table records exceed table length: need 18, got 6',
      )
    })

    it('rejects unsorted name records and invalid string storage offsets', () => {
      expect(() => parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, bytes: utf16BeBytes('B') },
        { platformId: 1, encodingId: 0, languageId: 0, nameId: 1, bytes: asciiBytes('A') },
      ])))).toThrow(
        'name records must be sorted by platform, encoding, language, and name ID at index 1',
      )

      const invalidStringOffset = buildNameTable(0, [
        { platformId: 1, encodingId: 0, languageId: 0, nameId: 1, bytes: asciiBytes('A') },
      ])
      new DataView(invalidStringOffset).setUint16(4, 6)
      expect(() => parseName(new BinaryReader(invalidStringOffset))).toThrow(
        'name format 0 stringOffset must be in 18..19, got 6',
      )
    })

    it('rejects out-of-range and odd UTF-16 string references', () => {
      expect(() => parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, bytes: new Uint8Array([0x00]) },
      ])))).toThrow('name record 0 UTF-16BE string length must be even, got 1')

      const w = new BinaryWriter()
      w.writeUint16(0)
      w.writeUint16(1)
      w.writeUint16(18)
      w.writeUint16(1)
      w.writeUint16(0)
      w.writeUint16(0)
      w.writeUint16(1)
      w.writeUint16(2)
      w.writeUint16(1)
      w.writeUint8(0x41)
      expect(() => parseName(new BinaryReader(w.toArrayBuffer()))).toThrow(
        'name record 0 string range exceeds name table length',
      )
    })

    it('rejects invalid language-tag references', () => {
      expect(() => parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 3, encodingId: 1, languageId: 0x8000, nameId: 1, bytes: utf16BeBytes('Name') },
      ])))).toThrow('name format 0 record 0 cannot use language-tag languageID 32768')

      expect(() => parseName(new BinaryReader(buildNameTable(1, [
        { platformId: 3, encodingId: 1, languageId: 0x8001, nameId: 1, bytes: utf16BeBytes('Name') },
      ], [
        utf16BeBytes('en'),
      ])))).toThrow(
        'name format 1 record 0 languageID 32769 has no language-tag record',
      )

      expect(() => parseName(new BinaryReader(buildNameTable(1, [
        { platformId: 3, encodingId: 1, languageId: 0x8000, nameId: 1, bytes: utf16BeBytes('Name') },
      ], [
        new Uint8Array([0x00]),
      ])))).toThrow(
        'name langTagRecord 0 UTF-16BE string length must be even, got 1',
      )
    })

    it('decodes Mac CJK and ISO records and rejects invalid encodings', () => {
      // Mac Japanese (encodingID 1) decodes as Shift-JIS (ASCII is a subset).
      const macJp = parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 1, encodingId: 1, languageId: 0, nameId: 1, bytes: asciiBytes('Name') },
      ])))
      expect(macJp.records).toHaveLength(1)
      expect(macJp.records[0]!.value).toBe('Name')

      expect(() => parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 3, encodingId: 7, languageId: 0x0409, nameId: 1, bytes: asciiBytes('Name') },
      ])))).toThrow('name record 0 has unsupported platform/encoding 3/7')
      expect(() => parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 3, encodingId: 3, languageId: 0x0804, nameId: 1, bytes: bytes([0x81]) },
      ])))).toThrow('name record 0 Windows encodingID 3 string is not valid gbk')
      expect(() => parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 3, encodingId: 6, languageId: 0x0412, nameId: 1, bytes: bytes([0x84]) },
      ])))).toThrow('name record 0 Windows encodingID 6 string is not valid Johab')
      const iso = parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 2, encodingId: 0, languageId: 0, nameId: 1, bytes: asciiBytes('Name') },
      ])))
      expect(iso.records[0]!.value).toBe('Name')
    })

    it('decodes the one-byte additions in the Apple CJK mappings', () => {
      expect(decodeMacCjkName(bytes([0x80, 0xA0, 0xFD, 0xFE, 0xFF]), 1)).toBe('\\\u00A0©™…\uF87F')
      expect(decodeMacCjkName(bytes([0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0xFF]), 3)).toBe('\u00A0₩–\uF87F©＿\uF87F\u0085…\uF87F')
      expect(decodeMacCjkName(bytes([0x80, 0x81, 0x82, 0x83, 0xA0, 0xFD, 0xFE, 0xFF]), 2)).toBe('\\\uF87F\uF880\uF881\u0083\u00A0©™…')
      expect(decodeMacCjkName(bytes([0x80, 0x81, 0x82, 0x83, 0xA0, 0xFD, 0xFE, 0xFF]), 25)).toBe('ü\uF87F\uF880\uF881\u0083\u00A0©™…')
    })

    it('accepts the legacy language-independent Macintosh CID name record', () => {
      const table = buildNameTable(0, [
        { platformId: 1, encodingId: 1, languageId: 0xFFFF, nameId: 20, bytes: asciiBytes('CIDFont-EUC-H') },
      ])

      expect(parseName(new BinaryReader(table)).records[0]!.value).toBe('CIDFont-EUC-H')
    })

    it('recognizes every registered Macintosh script ID and preserves bytes when no exact cmap bridge exists', () => {
      const table = parseName(new BinaryReader(buildNameTable(0, [
        { platformId: 1, encodingId: 14, languageId: 74, nameId: 1, bytes: bytes([0x80]) },
      ])))
      expect(table.records[0]!.value).toBeUndefined()
      expect(table.records[0]!.rawValue).toEqual(bytes([0x80]))
    })

    it('decodes an unpublished Macintosh script encoding through paired cmap glyph identities', () => {
      const unicodeEntries = new Map([[0x0B95, 7]])
      const macEntries = new Map([[0x80, 7]])
      function mapping(entries: Map<number, number>) {
        return {
          getGlyphId(codePoint: number) { return entries.get(codePoint) ?? 0 },
          getGlyphIdWithVariation(codePoint: number) { return entries.get(codePoint) ?? 0 },
          entries() { return entries.entries() },
        }
      }
      const unicodeMapping = mapping(unicodeEntries)
      const macMapping = mapping(macEntries)
      const cmap = {
        encodingRecords: [
          { platformId: 0, encodingId: 4, format: 12, language: 0, mapping: unicodeMapping },
          { platformId: 1, encodingId: 14, format: 0, language: 0, mapping: macMapping },
        ],
        selectedEncoding: { platformId: 0, encodingId: 4, format: 12, language: 0, mapping: unicodeMapping },
        getGlyphId(codePoint: number) { return unicodeEntries.get(codePoint) ?? 0 },
        getGlyphIdWithVariation(codePoint: number) { return unicodeEntries.get(codePoint) ?? 0 },
        getVariationGlyphId() { return null },
        *variationSequences() {},
        entries() { return unicodeEntries.entries() },
      }
      expect(decodeMacNameFromCmap(bytes([0x80]), 14, cmap)).toBe('க')
    })

    it('uses paired cmap glyph identities for Mac CJK bytes outside the published codec mapping', () => {
      const unicodeEntries = new Map([[0xA9, 7]])
      const macEntries = new Map([[0xA141, 7]])
      function mapping(entries: Map<number, number>) {
        return {
          getGlyphId(codePoint: number) { return entries.get(codePoint) ?? 0 },
          getGlyphIdWithVariation(codePoint: number) { return entries.get(codePoint) ?? 0 },
          entries() { return entries.entries() },
        }
      }
      const unicodeMapping = mapping(unicodeEntries)
      const macMapping = mapping(macEntries)
      const cmap = {
        encodingRecords: [
          { platformId: 0, encodingId: 4, format: 12, language: 0, mapping: unicodeMapping },
          { platformId: 1, encodingId: 3, format: 2, language: 0, mapping: macMapping },
        ],
        selectedEncoding: { platformId: 0, encodingId: 4, format: 12, language: 0, mapping: unicodeMapping },
        getGlyphId(codePoint: number) { return unicodeEntries.get(codePoint) ?? 0 },
        getGlyphIdWithVariation(codePoint: number) { return unicodeEntries.get(codePoint) ?? 0 },
        getVariationGlyphId() { return null },
        *variationSequences() {},
        entries() { return unicodeEntries.entries() },
      }
      const table = buildNameTable(0, [
        { platformId: 1, encodingId: 3, languageId: 23, nameId: 0, bytes: bytes([0xA1, 0x41]) },
      ])

      expect(parseName(new BinaryReader(table), cmap).records[0]!.value).toBe('©')
    })
  })
})

interface SyntheticNameRecord {
  platformId: number
  encodingId: number
  languageId: number
  nameId: number
  bytes: Uint8Array
}

function buildNameTable(
  format: 0 | 1,
  records: SyntheticNameRecord[],
  langTags: Uint8Array[] = [],
  stringOffsetOverride?: number,
): ArrayBuffer {
  const recordsEnd = 6 + records.length * 12
  const langTagRecordsEnd = format === 1 ? recordsEnd + 2 + langTags.length * 4 : recordsEnd
  const stringOffset = stringOffsetOverride ?? langTagRecordsEnd
  const storageParts: Uint8Array[] = records.map(r => r.bytes)
  if (format === 1) storageParts.push(...langTags)
  const storageOffsets: number[] = []
  let storageLength = 0
  for (const part of storageParts) {
    storageOffsets.push(storageLength)
    storageLength += part.length
  }

  const w = new BinaryWriter(stringOffset + storageLength)
  w.writeUint16(format)
  w.writeUint16(records.length)
  w.writeUint16(stringOffset)
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    w.writeUint16(record.platformId)
    w.writeUint16(record.encodingId)
    w.writeUint16(record.languageId)
    w.writeUint16(record.nameId)
    w.writeUint16(record.bytes.length)
    w.writeUint16(storageOffsets[i]!)
  }
  if (format === 1) {
    w.writeUint16(langTags.length)
    for (let i = 0; i < langTags.length; i++) {
      const tag = langTags[i]!
      w.writeUint16(tag.length)
      w.writeUint16(storageOffsets[records.length + i]!)
    }
  }
  w.position = stringOffset
  for (const part of storageParts) w.writeBytes(part)
  return w.toArrayBuffer()
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i)
  return bytes
}

function macRomanBytes(values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function utf16BeBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    bytes[i * 2] = code >>> 8
    bytes[i * 2 + 1] = code & 0xFF
  }
  return bytes
}

describe('Mac CJK name records', () => {
  it('decodes Shift-JIS (Mac Japanese) values', async () => {
    const { decodeMacCjkName } = await import('../../../src/parsers/tables/mac-cjk-encodings.js')
    // "ゴシック" in Shift-JIS: 83 53 83 56 83 62 83 4E
    const bytes = new Uint8Array([0x83, 0x53, 0x83, 0x56, 0x83, 0x62, 0x83, 0x4E])
    expect(decodeMacCjkName(bytes, 1)).toBe('ゴシック')
    // Mixed ASCII + kanji "MS明朝": 4D 53 96 BE 92 A9
    expect(decodeMacCjkName(new Uint8Array([0x4D, 0x53, 0x96, 0xBE, 0x92, 0xA9]), 1)).toBe('MS明朝')
    // Half-width katakana single bytes
    expect(decodeMacCjkName(new Uint8Array([0xB1, 0xB2]), 1)).toBe('ｱｲ')
  })

  it('decodes Big5 / EUC-KR / GB2312 values', async () => {
    const { decodeMacCjkName } = await import('../../../src/parsers/tables/mac-cjk-encodings.js')
    // Big5 "中文": A4 A4 A4 E5
    expect(decodeMacCjkName(new Uint8Array([0xA4, 0xA4, 0xA4, 0xE5]), 2)).toBe('中文')
    // EUC-KR "한글": C7 D1 B1 DB
    expect(decodeMacCjkName(new Uint8Array([0xC7, 0xD1, 0xB1, 0xDB]), 3)).toBe('한글')
    // GB2312 "中文": D6 D0 CE C4
    expect(decodeMacCjkName(new Uint8Array([0xD6, 0xD0, 0xCE, 0xC4]), 25)).toBe('中文')
  })

  it('rejects undecodable sequences explicitly', async () => {
    const { decodeMacCjkName } = await import('../../../src/parsers/tables/mac-cjk-encodings.js')
    expect(() => decodeMacCjkName(new Uint8Array([0x81]), 1)).toThrow(/Truncated/)
    expect(() => decodeMacCjkName(new Uint8Array([0x81, 0x3F]), 1)).toThrow(/Undecodable/)
  })
})
