import { BinaryReader } from '../../binary/reader.js'
import { decodeMacCjkName, hasMacCjkEncoding } from './mac-cjk-encodings.js'
import { decodeJohabName } from './johab-encoding.js'
import { decodeMacLegacyName, hasMacLegacyEncoding } from './mac-legacy-encodings.js'
import { decodeMacScriptName, hasMacScriptEncoding } from './mac-script-encodings.js'
import type { CmapTable, NameTable, NameRecord } from '../../types/index.js'

/**
 * Parse the name table
 */
export function parseName(reader: BinaryReader, cmap?: CmapTable): NameTable {
  if (reader.length < 6) {
    throw new Error(`name table length must be at least 6, got ${reader.length}`)
  }
  const format = reader.readUint16()
  if (format !== 0 && format !== 1) {
    throw new Error(`Unsupported name table format: ${format}`)
  }
  const count = reader.readUint16()
  const stringOffset = reader.readUint16()
  const recordsEnd = 6 + count * 12
  if (recordsEnd > reader.length) {
    throw new Error(`name table records exceed table length: need ${recordsEnd}, got ${reader.length}`)
  }

  interface RawNameRecord {
    platformId: number
    encodingId: number
    languageId: number
    nameId: number
    length: number
    offset: number
  }

  interface RawLangTagRecord {
    length: number
    offset: number
  }

  const rawRecords: RawNameRecord[] = []

  for (let i = 0; i < count; i++) {
    const platformId = reader.readUint16()
    const encodingId = reader.readUint16()
    const languageId = reader.readUint16()
    const nameId = reader.readUint16()
    const length = reader.readUint16()
    const offset = reader.readUint16()
    const record = { platformId, encodingId, languageId, nameId, length, offset }
    const previous = rawRecords[rawRecords.length - 1]
    if (previous && compareNameRecords(previous, record) > 0) {
      throw new Error(`name records must be sorted by platform, encoding, language, and name ID at index ${i}`)
    }
    validateNameStringRange(reader.length, stringOffset, offset, length, `name record ${i}`)
    validateNameEncoding(platformId, encodingId, i)
    if (isUtf16NameRecord(platformId, encodingId) && (length % 2) !== 0) {
      throw new Error(`name record ${i} UTF-16BE string length must be even, got ${length}`)
    }
    rawRecords.push(record)
  }

  const rawLangTags: RawLangTagRecord[] = []
  if (format === 0) {
    if (stringOffset < recordsEnd || stringOffset > reader.length) {
      throw new Error(`name format 0 stringOffset must be in ${recordsEnd}..${reader.length}, got ${stringOffset}`)
    }
  } else {
    if (reader.remaining < 2) {
      throw new Error('name format 1 table is missing langTagCount')
    }
    const langTagCount = reader.readUint16()
    const langTagRecordsEnd = recordsEnd + 2 + langTagCount * 4
    if (langTagRecordsEnd > reader.length) {
      throw new Error(`name format 1 langTagRecords exceed table length: need ${langTagRecordsEnd}, got ${reader.length}`)
    }
    if (stringOffset < langTagRecordsEnd || stringOffset > reader.length) {
      throw new Error(`name format 1 stringOffset must be in ${langTagRecordsEnd}..${reader.length}, got ${stringOffset}`)
    }
    for (let i = 0; i < langTagCount; i++) {
      const length = reader.readUint16()
      const offset = reader.readUint16()
      validateNameStringRange(reader.length, stringOffset, offset, length, `name langTagRecord ${i}`)
      if ((length % 2) !== 0) {
        throw new Error(`name langTagRecord ${i} UTF-16BE string length must be even, got ${length}`)
      }
      rawLangTags.push({ length, offset })
    }
  }

  const records: NameRecord[] = []

  for (let i = 0; i < rawRecords.length; i++) {
    const raw = rawRecords[i]!
    const isLegacyMacCidName = raw.platformId === 1 && raw.languageId === 0xFFFF && raw.nameId === 20
    if (format === 0 && raw.languageId >= 0x8000 && raw.platformId !== 4 && !isLegacyMacCidName) {
      throw new Error(`name format 0 record ${i} cannot use language-tag languageID ${raw.languageId}`)
    }
    if (format === 1 && raw.languageId >= 0x8000 && raw.languageId - 0x8000 >= rawLangTags.length) {
      throw new Error(`name format 1 record ${i} languageID ${raw.languageId} has no language-tag record`)
    }
    let value: string | undefined
    let rawValue: Uint8Array | undefined
    if (raw.platformId === 4 || (raw.platformId === 1 && raw.encodingId === 32)) {
      rawValue = readNameBytes(reader, stringOffset + raw.offset, raw.length)
    } else if (isUtf16NameRecord(raw.platformId, raw.encodingId)) {
      value = readNameUtf16(reader, stringOffset + raw.offset, raw.length)
    } else if (raw.platformId === 3) {
      value = readNameWindowsCodePage(reader, stringOffset + raw.offset, raw.length, raw.encodingId, `name record ${i}`)
    } else if (raw.platformId === 2) {
      value = readNameIso(reader, stringOffset + raw.offset, raw.length, raw.encodingId, `name record ${i}`)
    } else {
      const bytes = readNameBytes(reader, stringOffset + raw.offset, raw.length)
      if (hasMacNameDecoder(raw.encodingId)) {
        value = decodeKnownMacNameRecord(bytes, raw.encodingId, cmap)
      } else if (cmap !== undefined) {
        value = decodeMacNameFromCmap(bytes, raw.encodingId, cmap)
        if (value === undefined) rawValue = bytes
      } else {
        rawValue = bytes
      }
    }

    let langTag: string | undefined
    if (format === 1 && raw.languageId >= 0x8000) {
      const tagRecord = rawLangTags[raw.languageId - 0x8000]!
      langTag = readNameUtf16(reader, stringOffset + tagRecord.offset, tagRecord.length)
      if (!isWellFormedBcp47(langTag)) {
        throw new Error(`name language-tag record ${raw.languageId - 0x8000} is not a well-formed BCP 47 tag: ${langTag}`)
      }
    }

    records.push({
      platformId: raw.platformId,
      encodingId: raw.encodingId,
      languageId: raw.languageId,
      nameId: raw.nameId,
      ...(value !== undefined ? { value } : {}),
      ...(rawValue !== undefined ? { rawValue } : {}),
      ...(langTag !== undefined ? { langTag } : {}),
    })
  }

  return { records, getName: createNameLookup(records) }
}

function decodeKnownMacNameRecord(bytes: Uint8Array, encodingId: number, cmap: CmapTable | undefined): string {
  try {
    return decodeKnownMacName(bytes, encodingId)
  } catch (error) {
    // Some Macintosh CJK encodings include font-specific single-byte entries
    // outside the published reference codec. The paired Mac and Unicode cmap
    // records provide the font's exact byte-to-Unicode identity for those entries.
    if (cmap !== undefined) {
      const value = decodeMacNameFromCmap(bytes, encodingId, cmap)
      if (value !== undefined) return value
    }
    throw error
  }
}

function createNameLookup(records: readonly NameRecord[]): (nameId: number, language?: number | string) => string | undefined {
  return function getName(nameId: number, language?: number | string): string | undefined {
    if (typeof language === 'number') {
      for (let i = 0; i < records.length; i++) {
        const record = records[i]!
        if (record.nameId === nameId && record.languageId === language && record.value !== undefined) return record.value
      }
      return undefined
    }
    if (language !== undefined) {
      for (let i = 0; i < records.length; i++) {
        const record = records[i]!
        if (record.nameId === nameId && record.langTag !== undefined && record.value !== undefined && equalAsciiCaseInsensitive(record.langTag, language)) {
          return record.value
        }
      }
      return undefined
    }

    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      if (record.nameId === nameId && record.platformId === 3 && record.languageId === 0x0409 && record.value !== undefined) return record.value
    }
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      if (record.nameId === nameId && record.platformId === 0 && record.value !== undefined) return record.value
    }
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      if (record.nameId === nameId && record.platformId === 1 && record.languageId === 0 && record.value !== undefined) return record.value
    }
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      if (record.nameId === nameId && record.value !== undefined) return record.value
    }
    return undefined
  }
}

function compareNameRecords(a: { platformId: number; encodingId: number; languageId: number; nameId: number }, b: { platformId: number; encodingId: number; languageId: number; nameId: number }): number {
  if (a.platformId !== b.platformId) return a.platformId - b.platformId
  if (a.encodingId !== b.encodingId) return a.encodingId - b.encodingId
  if (a.languageId !== b.languageId) return a.languageId - b.languageId
  return a.nameId - b.nameId
}

function isUtf16NameRecord(platformId: number, encodingId: number): boolean {
  return platformId === 0 || (platformId === 2 && encodingId === 1) ||
    (platformId === 3 && (encodingId === 0 || encodingId === 1 || encodingId === 10))
}

function validateNameEncoding(platformId: number, encodingId: number, recordIndex: number): void {
  if (platformId === 0 && encodingId <= 6) return
  if (platformId === 1 && encodingId <= 32) return
  if (platformId === 2 && encodingId <= 2) return
  if (platformId === 3 && (encodingId <= 6 || encodingId === 10)) return
  if (platformId === 4) return
  throw new Error(`name record ${recordIndex} has unsupported platform/encoding ${platformId}/${encodingId}`)
}

function validateNameStringRange(tableLength: number, stringOffset: number, offset: number, length: number, label: string): void {
  if (stringOffset > tableLength || offset > tableLength - stringOffset || length > tableLength - stringOffset - offset) {
    throw new Error(`${label} string range exceeds name table length`)
  }
}

function readNameUtf16(reader: BinaryReader, offset: number, length: number): string {
  const savedPos = reader.position
  reader.seek(offset)
  let value = ''
  const end = offset + length
  while (reader.position < end) {
    const first = reader.readUint16()
    if (first >= 0xD800 && first <= 0xDBFF) {
      if (reader.position === end) {
        const byteIndex = reader.position - offset - 2
        reader.seek(savedPos)
        throw new Error(`name UTF-16BE string has an unpaired high surrogate at byte ${byteIndex}`)
      }
      const second = reader.readUint16()
      if (second < 0xDC00 || second > 0xDFFF) {
        const byteIndex = reader.position - offset - 4
        reader.seek(savedPos)
        throw new Error(`name UTF-16BE string has an unpaired high surrogate at byte ${byteIndex}`)
      }
      value += String.fromCharCode(first, second)
    } else if (first >= 0xDC00 && first <= 0xDFFF) {
      const byteIndex = reader.position - offset - 2
      reader.seek(savedPos)
      throw new Error(`name UTF-16BE string has an unpaired low surrogate at byte ${byteIndex}`)
    } else {
      value += String.fromCharCode(first)
    }
  }
  reader.seek(savedPos)
  return value
}

function equalAsciiCaseInsensitive(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    let ac = a.charCodeAt(i)
    let bc = b.charCodeAt(i)
    if (ac >= 0x41 && ac <= 0x5A) ac += 0x20
    if (bc >= 0x41 && bc <= 0x5A) bc += 0x20
    if (ac !== bc) return false
  }
  return true
}

const GRANDFATHERED_BCP47_TAGS = new Set([
  'art-lojban', 'cel-gaulish', 'en-gb-oed', 'i-ami', 'i-bnn', 'i-default', 'i-enochian', 'i-hak',
  'i-klingon', 'i-lux', 'i-mingo', 'i-navajo', 'i-pwn', 'i-tao', 'i-tay', 'i-tsu', 'no-bok',
  'no-nyn', 'sgn-be-fr', 'sgn-be-nl', 'sgn-ch-de', 'zh-guoyu', 'zh-hakka', 'zh-min', 'zh-min-nan',
  'zh-xiang',
])

function isWellFormedBcp47(tag: string): boolean {
  const lower = tag.toLowerCase()
  if (GRANDFATHERED_BCP47_TAGS.has(lower)) return true
  const parts = lower.split('-')
  if (parts.length === 0 || parts[0] === '') return false
  let index = 0
  if (parts[0] === 'x') return validatePrivateUse(parts, 1)

  const language = parts[index++]!
  if (!isAsciiAlphaString(language) || language.length < 2 || language.length > 8) return false
  if (language.length <= 3) {
    let extlangCount = 0
    while (index < parts.length && parts[index]!.length === 3 && isAsciiAlphaString(parts[index]!) && extlangCount < 3) {
      index++
      extlangCount++
    }
  }
  if (index < parts.length && parts[index]!.length === 4 && isAsciiAlphaString(parts[index]!)) index++
  if (index < parts.length) {
    const region = parts[index]!
    if ((region.length === 2 && isAsciiAlphaString(region)) || (region.length === 3 && isAsciiDigitString(region))) index++
  }

  const variants = new Set<string>()
  while (index < parts.length && isBcp47Variant(parts[index]!)) {
    const variant = parts[index++]!
    if (variants.has(variant)) return false
    variants.add(variant)
  }

  const extensions = new Set<string>()
  while (index < parts.length && isBcp47ExtensionSingleton(parts[index]!)) {
    const singleton = parts[index++]!
    if (extensions.has(singleton)) return false
    extensions.add(singleton)
    const firstSubtag = index
    while (index < parts.length && parts[index]!.length >= 2 && parts[index]!.length <= 8 && isAsciiAlnumString(parts[index]!)) index++
    if (index === firstSubtag) return false
  }

  if (index < parts.length && parts[index] === 'x') return validatePrivateUse(parts, index + 1)
  return index === parts.length
}

function validatePrivateUse(parts: readonly string[], index: number): boolean {
  if (index === parts.length) return false
  for (let i = index; i < parts.length; i++) {
    const part = parts[i]!
    if (part.length < 1 || part.length > 8 || !isAsciiAlnumString(part)) return false
  }
  return true
}

function isBcp47Variant(part: string): boolean {
  if (!isAsciiAlnumString(part)) return false
  return (part.length >= 5 && part.length <= 8) || (part.length === 4 && isAsciiDigit(part.charCodeAt(0)))
}

function isBcp47ExtensionSingleton(part: string): boolean {
  if (part.length !== 1) return false
  const code = part.charCodeAt(0)
  return code !== 0x78 && (isAsciiDigit(code) || (code >= 0x61 && code <= 0x7A))
}

function isAsciiAlphaString(value: string): boolean {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (!((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A))) return false
  }
  return true
}

function isAsciiDigitString(value: string): boolean {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i++) if (!isAsciiDigit(value.charCodeAt(i))) return false
  return true
}

function isAsciiAlnumString(value: string): boolean {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (!isAsciiDigit(code) && !((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A))) return false
  }
  return true
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}

function readNameBytes(reader: BinaryReader, offset: number, length: number): Uint8Array {
  const savedPos = reader.position
  reader.seek(offset)
  const value = reader.readBytes(length)
  reader.seek(savedPos)
  return value
}

function hasMacNameDecoder(encodingId: number): boolean {
  return encodingId === 0 || hasMacCjkEncoding(encodingId) ||
    hasMacLegacyEncoding(encodingId) || hasMacScriptEncoding(encodingId)
}

function decodeKnownMacName(bytes: Uint8Array, encodingId: number): string {
  if (encodingId === 0) return decodeMacRoman(bytes)
  if (hasMacCjkEncoding(encodingId)) return decodeMacCjkName(bytes, encodingId)
  if (hasMacScriptEncoding(encodingId)) return decodeMacScriptName(bytes, encodingId)
  return decodeMacLegacyName(bytes, encodingId)
}

function decodeMacRoman(bytes: Uint8Array): string {
  let value = ''
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i]!
    value += code < 0x80 ? String.fromCharCode(code) : MAC_ROMAN_80_FF[code - 0x80]!
  }
  return value
}

/**
 * Resolves an otherwise unpublished Macintosh script encoding through the
 * font's paired Macintosh and Unicode cmap records. This uses the font's own
 * glyph identity as the normative bridge and therefore does not guess a
 * vendor byte-to-Unicode mapping.
 */
export function decodeMacNameFromCmap(bytes: Uint8Array, encodingId: number, cmap: CmapTable): string | undefined {
  let macMapping = null as CmapTable['selectedEncoding']['mapping']
  for (let i = 0; i < cmap.encodingRecords.length; i++) {
    const record = cmap.encodingRecords[i]!
    if (record.platformId === 1 && record.encodingId === encodingId && record.mapping !== null) {
      macMapping = record.mapping
      break
    }
  }
  if (macMapping === null) return undefined

  const unicodeByGlyph = new Map<number, number>()
  for (const [codePoint, glyphId] of cmap.entries()) {
    if (glyphId !== 0 && !unicodeByGlyph.has(glyphId)) unicodeByGlyph.set(glyphId, codePoint)
  }
  let value = ''
  for (let byteIndex = 0; byteIndex < bytes.length;) {
    let glyphId = 0
    let consumed = 1
    if (byteIndex + 1 < bytes.length) {
      glyphId = macMapping.getGlyphId((bytes[byteIndex]! << 8) | bytes[byteIndex + 1]!)
      if (glyphId !== 0) consumed = 2
    }
    if (glyphId === 0) glyphId = macMapping.getGlyphId(bytes[byteIndex]!)
    const codePoint = unicodeByGlyph.get(glyphId)
    if (glyphId === 0 || codePoint === undefined) return undefined
    value += String.fromCodePoint(codePoint)
    byteIndex += consumed
  }
  return value
}

function readNameIso(reader: BinaryReader, offset: number, length: number, encodingId: number, label: string): string {
  const bytes = readNameBytes(reader, offset, length)
  let value = ''
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!
    if (encodingId === 0 && byte > 0x7F) throw new Error(`${label} ISO ASCII string contains byte 0x${byte.toString(16)}`)
    value += String.fromCharCode(byte)
  }
  return value
}

function readNameWindowsCodePage(reader: BinaryReader, offset: number, length: number, encodingId: number, label: string): string {
  const savedPos = reader.position
  reader.seek(offset)
  const bytes = reader.readBytes(length)
  reader.seek(savedPos)
  if (encodingId === 6) {
    try {
      return decodeJohabName(bytes)
    } catch (error) {
      throw new Error(`${label} Windows encodingID 6 string is not valid Johab: ${(error as Error).message}`)
    }
  }
  const decoderLabel = windowsCodePageDecoderLabel(encodingId)
  try {
    return new TextDecoder(decoderLabel, { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} Windows encodingID ${encodingId} string is not valid ${decoderLabel}`)
  }
}

function windowsCodePageDecoderLabel(encodingId: number): string {
  if (encodingId === 2) return 'shift_jis'
  if (encodingId === 3) return 'gbk'
  if (encodingId === 4) return 'big5'
  if (encodingId === 5) return 'euc-kr'
  throw new Error(`Unsupported Windows code-page encodingID: ${encodingId}`)
}

const MAC_ROMAN_80_FF = [
  'Ä', 'Å', 'Ç', 'É', 'Ñ', 'Ö', 'Ü', 'á', 'à', 'â', 'ä', 'ã', 'å', 'ç', 'é', 'è',
  'ê', 'ë', 'í', 'ì', 'î', 'ï', 'ñ', 'ó', 'ò', 'ô', 'ö', 'õ', 'ú', 'ù', 'û', 'ü',
  '†', '°', '¢', '£', '§', '•', '¶', 'ß', '®', '©', '™', '´', '¨', '≠', 'Æ', 'Ø',
  '∞', '±', '≤', '≥', '¥', 'µ', '∂', '∑', '∏', 'π', '∫', 'ª', 'º', 'Ω', 'æ', 'ø',
  '¿', '¡', '¬', '√', 'ƒ', '≈', '∆', '«', '»', '…', ' ', 'À', 'Ã', 'Õ', 'Œ', 'œ',
  '–', '—', '“', '”', '‘', '’', '÷', '◊', 'ÿ', 'Ÿ', '⁄', '€', '‹', '›', 'ﬁ', 'ﬂ',
  '‡', '·', '‚', '„', '‰', 'Â', 'Ê', 'Á', 'Ë', 'È', 'Í', 'Î', 'Ï', 'Ì', 'Ó', 'Ô',
  '', 'Ò', 'Ú', 'Û', 'Ù', 'ı', 'ˆ', '˜', '¯', '˘', '˙', '˚', '¸', '˝', '˛', 'ˇ',
]
