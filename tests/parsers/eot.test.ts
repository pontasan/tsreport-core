import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isEotFormat, unwrapEot } from '../../src/parsers/eot-parser.js'
import { parseFont } from '../../src/parsers/index.js'
import { parseSfntDirectory } from '../../src/parsers/sfnt-parser.js'

/**
 * EOT (Embedded OpenType) parser regression tests.
 * Wraps the Roboto TTF fixture in synthetic EOT headers for all three
 * versions defined by the W3C EOT submission (0x00010000 / 0x00020001 /
 * 0x00020002) and verifies isEotFormat / unwrapEot / parseFont integration.
 */

const ROBOTO_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')

const EOT_MAGIC = 0x504C
const FLAG_XOR_ENCRYPT = 0x00000008

const EOT_V1 = 0x00010000
const EOT_V21 = 0x00020001
const EOT_V22 = 0x00020002

/** Encodes a little-endian uint16 */
function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xFF, (value >> 8) & 0xFF])
}

/** Encodes a little-endian uint32 */
function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >>> 24) & 0xFF])
}

/** Encodes a sized UTF-16LE field: uint16 byte size + UTF-16LE data (no padding) */
function utf16Field(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, text.length * 2, true)
  for (let i = 0; i < text.length; i++) {
    view.setUint16(2 + i * 2, text.charCodeAt(i), true)
  }
  return bytes
}

interface EotV22Extras {
  signature?: Uint8Array
  eudcFontData?: Uint8Array
}

/**
 * Builds an EOT container around the given SFNT data.
 * Field layout per the W3C EOT submission: each padding word precedes the
 * following size field, FullName has no trailing padding in v1, and in v2.2
 * EUDCFontData sits between EUDCFontSize and FontData.
 */
function buildEot(
  fontData: Uint8Array,
  flags: number,
  version: number,
  rootString = '',
  extras: EotV22Extras = {},
): ArrayBuffer {
  const parts: Uint8Array[] = [
    utf16Field('Roboto'), // FamilyNameSize + FamilyName
    u16(0), utf16Field('Regular'), // Padding2 + StyleNameSize + StyleName
    u16(0), utf16Field('Version 1.0'), // Padding3 + VersionNameSize + VersionName
    u16(0), utf16Field('Roboto Regular'), // Padding4 + FullNameSize + FullName
  ]

  if (version >= EOT_V21) {
    parts.push(u16(0), utf16Field(rootString)) // Padding5 + RootStringSize + RootString
    if (version >= EOT_V22) {
      const signature = extras.signature ?? new Uint8Array(0)
      const eudcFontData = extras.eudcFontData ?? new Uint8Array(0)
      parts.push(u32(0x12345678)) // RootStringCheckSum (not validated by the parser)
      parts.push(u32(932)) // EUDCCodePage
      parts.push(u16(0)) // Padding6
      parts.push(u16(signature.length), signature) // SignatureSize + Signature
      parts.push(u32(0)) // EUDCFlags
      parts.push(u32(eudcFontData.length), eudcFontData) // EUDCFontSize + EUDCFontData
    }
  }

  let variableSize = 0
  for (const part of parts) variableSize += part.length

  const totalSize = 82 + variableSize + fontData.length
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // Fixed part (little-endian, 82 bytes)
  view.setUint32(0, totalSize, true) // EOTSize
  view.setUint32(4, fontData.length, true) // FontDataSize
  view.setUint32(8, version, true) // Version
  view.setUint32(12, flags, true) // Flags
  // FontPANOSE[10] at 16, Charset at 26, Italic at 27: zeros
  view.setUint32(28, 400, true) // Weight
  view.setUint16(32, 0, true) // fsType (installable embedding)
  view.setUint16(34, EOT_MAGIC, true) // MagicNumber
  // UnicodeRange1-4 (36..51), CodePageRange1-2 (52..59): zeros
  view.setUint32(60, 0, true) // CheckSumAdjustment
  // Reserved1-4 (64..79), Padding1 (80..81): zeros

  let offset = 82
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }

  bytes.set(fontData, offset)
  return buffer
}

/** Builds an EOT version 0x00010000 container around the given SFNT data */
function buildEotV1(fontData: Uint8Array, flags: number): ArrayBuffer {
  return buildEot(fontData, flags, EOT_V1)
}

const ttfBytes = new Uint8Array(readFileSync(ROBOTO_PATH))

describe('EOT parser', () => {
  describe('isEotFormat', () => {
    // Verifies the magic number at offset 34 (little-endian) is detected.
    it('detects an EOT container', () => {
      const eot = buildEotV1(ttfBytes, 0)
      expect(isEotFormat(eot)).toBe(true)
    })

    // Verifies a raw TTF is not misdetected as EOT.
    it('rejects a raw TTF', () => {
      expect(isEotFormat(ttfBytes.buffer.slice(0) as ArrayBuffer)).toBe(false)
    })

    // Verifies buffers shorter than the magic number position are rejected.
    it('rejects a too-short buffer', () => {
      expect(isEotFormat(new ArrayBuffer(10))).toBe(false)
    })
  })

  describe('unwrapEot', () => {
    // Verifies the header walk over the four name blocks lands exactly on the font data.
    it('extracts byte-identical SFNT data', () => {
      const eot = buildEotV1(ttfBytes, 0)
      const sfntBuffer = unwrapEot(eot)
      expect(sfntBuffer.byteLength).toBe(ttfBytes.length)
      expect(Buffer.compare(Buffer.from(sfntBuffer), Buffer.from(ttfBytes))).toBe(0)
    })

    // Verifies XOR-encrypted font data (flag 0x08, key 0x50) is decrypted.
    it('decrypts XOR-encrypted font data', () => {
      const encrypted = new Uint8Array(ttfBytes.length)
      for (let i = 0; i < ttfBytes.length; i++) {
        encrypted[i] = ttfBytes[i]! ^ 0x50
      }
      const eot = buildEotV1(encrypted, FLAG_XOR_ENCRYPT)
      const sfntBuffer = unwrapEot(eot)
      expect(Buffer.compare(Buffer.from(sfntBuffer), Buffer.from(ttfBytes))).toBe(0)
    })

    // Verifies the v2.1 header walk (Padding5 + RootString) lands exactly on the font data.
    it('extracts byte-identical SFNT data from a v2.1 container', () => {
      const eot = buildEot(ttfBytes, 0, EOT_V21, 'https://example.com/page.html')
      const sfntBuffer = unwrapEot(eot)
      expect(sfntBuffer.byteLength).toBe(ttfBytes.length)
      expect(Buffer.compare(Buffer.from(sfntBuffer), Buffer.from(ttfBytes))).toBe(0)
    })

    // Verifies a v2.1 container with an empty RootString (size 0) is handled.
    it('extracts SFNT data from a v2.1 container with an empty RootString', () => {
      const eot = buildEot(ttfBytes, 0, EOT_V21)
      const sfntBuffer = unwrapEot(eot)
      expect(Buffer.compare(Buffer.from(sfntBuffer), Buffer.from(ttfBytes))).toBe(0)
    })

    // Verifies the v2.2 header walk (RootStringCheckSum + EUDCCodePage + Padding6
    // + Signature + EUDCFlags + EUDCFontSize + EUDCFontData) lands on the font data.
    it('extracts byte-identical SFNT data from a v2.2 container', () => {
      const eot = buildEot(ttfBytes, 0, EOT_V22, 'https://example.com/page.html')
      const sfntBuffer = unwrapEot(eot)
      expect(sfntBuffer.byteLength).toBe(ttfBytes.length)
      expect(Buffer.compare(Buffer.from(sfntBuffer), Buffer.from(ttfBytes))).toBe(0)
    })

    // Verifies non-empty Signature and EUDCFontData arrays are skipped in v2.2.
    it('skips Signature and EUDCFontData in a v2.2 container', () => {
      const eot = buildEot(ttfBytes, 0, EOT_V22, 'https://example.com/page.html', {
        signature: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x01]),
        eudcFontData: new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]),
      })
      const sfntBuffer = unwrapEot(eot)
      expect(sfntBuffer.byteLength).toBe(ttfBytes.length)
      expect(Buffer.compare(Buffer.from(sfntBuffer), Buffer.from(ttfBytes))).toBe(0)
    })

    // Verifies XOR-encrypted v2.2 font data is decrypted after the header walk.
    it('decrypts XOR-encrypted font data in a v2.2 container', () => {
      const encrypted = new Uint8Array(ttfBytes.length)
      for (let i = 0; i < ttfBytes.length; i++) {
        encrypted[i] = ttfBytes[i]! ^ 0x50
      }
      const eot = buildEot(encrypted, FLAG_XOR_ENCRYPT, EOT_V22, 'https://example.com/page.html', {
        eudcFontData: new Uint8Array([0x11, 0x22, 0x33]),
      })
      const sfntBuffer = unwrapEot(eot)
      expect(Buffer.compare(Buffer.from(sfntBuffer), Buffer.from(ttfBytes))).toBe(0)
    })

    // Verifies version numbers outside the specification are rejected.
    it('throws on an unsupported version', () => {
      const eot = buildEotV1(ttfBytes, 0)
      new DataView(eot).setUint32(8, 0x00020000, true)
      expect(() => unwrapEot(eot)).toThrow('EOT: unsupported version')
    })

    // Verifies an invalid magic number is rejected with an error.
    it('throws on an invalid magic number', () => {
      const eot = buildEotV1(ttfBytes, 0)
      new DataView(eot).setUint16(34, 0x0000, true)
      expect(() => unwrapEot(eot)).toThrow('EOT: invalid magic number')
    })

    // Verifies a FontDataSize pointing beyond the file is rejected.
    it('throws when font data extends beyond the file', () => {
      const eot = buildEotV1(ttfBytes, 0)
      new DataView(eot).setUint32(4, ttfBytes.length + 1000, true)
      expect(() => unwrapEot(eot)).toThrow('EOT: font data extends beyond file')
    })
  })

  describe('parseFont integration', () => {
    // Verifies format detection routes EOT through unwrapEot and yields the SFNT directory.
    it('parses an EOT font end to end', () => {
      const eot = buildEotV1(ttfBytes, 0)
      const sfnt = parseFont(eot)
      expect(sfnt.format).toBe('eot')

      const original = parseSfntDirectory(ttfBytes.buffer.slice(0) as ArrayBuffer)
      expect(sfnt.tableDirectory.size).toBe(original.tableDirectory.size)
      for (const tag of original.tableDirectory.keys()) {
        expect(sfnt.tableDirectory.has(tag)).toBe(true)
      }
      expect(sfnt.tableDirectory.has('glyf')).toBe(true)
      expect(sfnt.tableDirectory.has('cmap')).toBe(true)
    })
  })
})
