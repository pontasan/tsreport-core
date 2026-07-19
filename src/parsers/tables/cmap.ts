import { BinaryReader } from '../../binary/reader.js'
import type {
  CmapTable,
  CmapEncodingRecord as PublicCmapEncodingRecord,
  CmapVariationSequence,
  CmapMapping,
  CmapFormat4Data,
  CmapFormat12Data,
  CmapFormat12Group,
} from '../../types/index.js'

/**
 * Parses the cmap table
 * Supports Format 0, 2, 4, 6, 8, 10, 12, 13, 14
 * Prefers Format 12 (covers Japanese supplementary kanji, etc.)
 */
export function parseCmap(reader: BinaryReader): CmapTable {
  const tableStart = reader.position
  const version = reader.readUint16()
  const numTables = reader.readUint16()
  const encodingRecordsEnd = tableStart + 4 + numTables * 8
  if (encodingRecordsEnd > reader.length) {
    throw new Error('cmap encoding records exceed table length')
  }

  const records: CmapEncodingRecord[] = []
  let previousRecord: CmapEncodingRecord | null = null

  for (let i = 0; i < numTables; i++) {
    const platformId = reader.readUint16()
    const encodingId = reader.readUint16()
    const offset = reader.readUint32()
    if (tableStart + offset < encodingRecordsEnd) {
      throw new Error(`cmap encoding record ${i} subtable offset overlaps the encoding records`)
    }
    if (tableStart + offset + 2 > reader.length) {
      throw new Error(`cmap encoding record ${i} subtable offset exceeds table length`)
    }

    const savedPos = reader.position
    reader.seek(tableStart + offset)
    const format = reader.readUint16()
    const language = readCmapLanguage(reader, tableStart + offset, format)
    reader.seek(savedPos)

    if (previousRecord && compareCmapEncodingRecords(platformId, encodingId, language, previousRecord) <= 0) {
      throw new Error(`cmap encoding record ${i} is not in strictly increasing platform/encoding/language order`)
    }
    previousRecord = { platformId, encodingId, offset, format, language }
    validateCmapEncodingRecord(i, platformId, encodingId, format, language)
    records.push(previousRecord)
  }

  let bestRecord: CmapEncodingRecord | null = null
  let bestRank = -1
  let uvs: UvsData | null = null
  const decodedMappings = new Map<number, CmapMapping>()
  const publicRecords = new Array<PublicCmapEncodingRecord>(records.length)
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex]!
    if (record.format === 14) {
      reader.seek(tableStart + record.offset)
      uvs = parseCmapFormat14(reader)
      publicRecords[recordIndex] = createPublicEncodingRecord(record, null)
      continue
    }
    let mapping = decodedMappings.get(record.offset)
    if (mapping === undefined) {
      reader.seek(tableStart + record.offset)
      mapping = parseBaseCmap(reader)
      decodedMappings.set(record.offset, mapping)
    }
    publicRecords[recordIndex] = createPublicEncodingRecord(record, mapping)
    const rank = cmapRecordRank(record)
    if (rank > bestRank) {
      bestRank = rank
      bestRecord = record
    }
  }

  if (bestRecord === null) {
    throw new Error('No suitable cmap subtable found')
  }

  const baseTable = decodedMappings.get(bestRecord.offset)!
  let selectedEncoding: PublicCmapEncodingRecord | null = null
  for (let i = 0; i < publicRecords.length; i++) {
    const candidate = publicRecords[i]!
    if (candidate.platformId === bestRecord.platformId &&
        candidate.encodingId === bestRecord.encodingId &&
        candidate.format === bestRecord.format &&
        candidate.language === bestRecord.language) {
      selectedEncoding = candidate
      break
    }
  }
  if (selectedEncoding === null) throw new Error('Selected cmap encoding record was not decoded')

  // Add getGlyphIdWithVariation
  return {
    encodingRecords: publicRecords,
    selectedEncoding,
    getGlyphId(codePoint: number): number {
      return baseTable.getGlyphId(codePoint)
    },
    entries(): Iterable<[number, number]> {
      return baseTable.entries()
    },
    getGlyphIdWithVariation(codePoint: number, variationSelector: number): number {
      if (uvs) {
        const gid = uvs.getVariationGlyph(codePoint, variationSelector, baseTable)
        if (gid !== -1) return gid
      }
      return baseTable.getGlyphId(codePoint)
    },
    getVariationGlyphId(codePoint: number, variationSelector: number): number | null {
      if (uvs === null) return null
      const glyphId = uvs.getVariationGlyph(codePoint, variationSelector, baseTable)
      return glyphId === -1 ? null : glyphId
    },
    variationSequences(): Iterable<CmapVariationSequence> {
      return uvs === null ? [] : uvs.variationSequences(baseTable)
    },
  }
}

/** Validates normative OpenType 1.9.1 cmap constraints across cmap and maxp. */
export function validateCmapConformance(cmap: CmapTable, numGlyphs: number, isCff: boolean): void {
  for (let recordIndex = 0; recordIndex < cmap.encodingRecords.length; recordIndex++) {
    const record = cmap.encodingRecords[recordIndex]!
    validateConformingEncoding(recordIndex, record, isCff)
    const mapping = record.mapping as InternalCmapMapping | null
    if (mapping === null) continue
    if (mapping.conformanceErrors !== undefined && mapping.conformanceErrors.length !== 0) {
      throw new Error(mapping.conformanceErrors[0]!)
    }
    for (const [characterCode, glyphId] of mapping.entries()) {
      if (glyphId >= numGlyphs) {
        throw new Error(`cmap encoding record ${recordIndex} maps character code 0x${characterCode.toString(16)} to glyph ${glyphId}, but maxp.numGlyphs is ${numGlyphs}`)
      }
    }
  }
  for (const sequence of cmap.variationSequences()) {
    if (!isUnicodeScalar(sequence.codePoint)) {
      throw new Error(`cmap format 14 base value 0x${sequence.codePoint.toString(16)} is not a Unicode scalar value`)
    }
    if (!isVariationSelector(sequence.variationSelector)) {
      throw new Error(`cmap format 14 selector 0x${sequence.variationSelector.toString(16)} is not a Unicode variation selector`)
    }
    if (sequence.glyphId >= numGlyphs) {
      throw new Error(`cmap format 14 maps U+${sequence.codePoint.toString(16)} to glyph ${sequence.glyphId}, but maxp.numGlyphs is ${numGlyphs}`)
    }
  }
}

function validateConformingEncoding(index: number, record: PublicCmapEncodingRecord, isCff: boolean): void {
  const platformId = record.platformId
  const encodingId = record.encodingId
  const format = record.format
  if (platformId === 0) {
    if (encodingId === 3 && format !== 4 && format !== 6) {
      throw new Error(`cmap Unicode BMP encoding record ${index} must use format 4 or 6`)
    }
    if (encodingId === 4 && format !== 10 && format !== 12) {
      throw new Error(`cmap Unicode full-repertoire encoding record ${index} must use format 10 or 12`)
    }
    if (encodingId === 5 && format !== 14) {
      throw new Error(`cmap Unicode variation-sequence encoding record ${index} must use format 14`)
    }
    if (encodingId === 6 && format !== 13) {
      throw new Error(`cmap Unicode many-to-one encoding record ${index} must use format 13`)
    }
    if (format === 13 && encodingId !== 6) {
      throw new Error(`cmap format 13 encoding record ${index} must use Unicode platform encoding 6`)
    }
    if (format === 14 && encodingId !== 5) {
      throw new Error(`cmap format 14 encoding record ${index} must use Unicode platform encoding 5`)
    }
    return
  }
  if (platformId === 3) {
    if (encodingId === 0 && format !== 4) {
      throw new Error(`cmap Windows symbol encoding record ${index} must use format 4`)
    }
    if (encodingId === 1 && format !== 4) {
      throw new Error(`cmap Windows Unicode BMP encoding record ${index} must use format 4`)
    }
    if (encodingId >= 7 && encodingId <= 9) {
      throw new Error(`cmap Windows encoding ${encodingId} is reserved`)
    }
    if (encodingId === 10 && format !== 12) {
      throw new Error(`cmap Windows Unicode full-repertoire encoding record ${index} must use format 12`)
    }
    return
  }
  if (platformId === 4) {
    if (!isCff) throw new Error(`cmap custom-platform encoding record ${index} requires CFF outlines`)
    if (encodingId > 255) throw new Error(`cmap custom-platform encoding record ${index} has encoding ${encodingId} outside 0 to 255`)
    if (format !== 0 && format !== 6) {
      throw new Error(`cmap custom-platform encoding record ${index} must use format 0 or 6`)
    }
  }
}

function isUnicodeScalar(value: number): boolean {
  return value >= 0 && value <= 0x10FFFF && (value < 0xD800 || value > 0xDFFF)
}

function isVariationSelector(value: number): boolean {
  return (value >= 0xFE00 && value <= 0xFE0F) ||
    (value >= 0xE0100 && value <= 0xE01EF) ||
    (value >= 0x180B && value <= 0x180D) || value === 0x180F
}

function createPublicEncodingRecord(record: CmapEncodingRecord, mapping: CmapMapping | null): PublicCmapEncodingRecord {
  return {
    platformId: record.platformId,
    encodingId: record.encodingId,
    format: record.format,
    language: record.language,
    mapping,
  }
}

function parseBaseCmap(reader: BinaryReader): InternalCmapMapping {
  const format = reader.readUint16()
  if (format === 0) return parseCmapFormat0(reader)
  if (format === 2) return parseCmapFormat2(reader)
  if (format === 4) return parseCmapFormat4(reader)
  if (format === 6) return parseCmapFormat6(reader)
  if (format === 8) return parseCmapFormat8(reader)
  if (format === 10) return parseCmapFormat10(reader)
  if (format === 12) return parseCmapFormat12(reader)
  if (format === 13) return parseCmapFormat13(reader)
  throw new Error(`Unsupported cmap format: ${format}`)
}

interface CmapEncodingRecord {
  platformId: number
  encodingId: number
  offset: number
  format: number
  language: number | null
}

interface InternalCmapMapping extends CmapMapping {
  readonly conformanceErrors?: readonly string[]
}

function readCmapLanguage(reader: BinaryReader, subtableStart: number, format: number): number | null {
  if (format === 14) return null
  if (format === 0 || format === 2 || format === 4 || format === 6) {
    reader.seek(subtableStart + 4)
    return reader.readUint16()
  }
  if (format === 8 || format === 10 || format === 12 || format === 13) {
    reader.seek(subtableStart + 8)
    return reader.readUint32()
  }
  return null
}

function compareCmapEncodingRecords(
  platformId: number,
  encodingId: number,
  language: number | null,
  previous: CmapEncodingRecord,
): number {
  if (platformId !== previous.platformId) return platformId - previous.platformId
  if (encodingId !== previous.encodingId) return encodingId - previous.encodingId
  return (language ?? -1) - (previous.language ?? -1)
}

function validateCmapEncodingRecord(
  index: number,
  platformId: number,
  encodingId: number,
  format: number,
  language: number | null,
): void {
  if (language !== null && platformId !== 1 && language !== 0) {
    throw new Error(`cmap encoding record ${index} non-Macintosh language field must be 0`)
  }
  if (format === 14 && (platformId !== 0 || encodingId !== 5)) {
    throw new Error(`cmap format 14 must use platform 0 encoding 5, got platform ${platformId} encoding ${encodingId}`)
  }
  if (platformId === 0 && encodingId === 5 && format !== 14) {
    throw new Error(`cmap platform 0 encoding 5 must use format 14, got format ${format}`)
  }
  const isFullUnicode = (platformId === 0 && encodingId === 4) || (platformId === 3 && encodingId === 10)
  // Format 13 (many-to-one) is conventionally (0,6) but real fonts (macOS
  // LastResort) place it in a full-Unicode record; accept it there too.
  if (format === 13 && !(platformId === 0 && encodingId === 6) && !isFullUnicode) {
    throw new Error(`cmap format 13 must use platform 0 encoding 6 or a full-Unicode record, got platform ${platformId} encoding ${encodingId}`)
  }
  if (platformId === 0 && encodingId === 6 && format !== 13) {
    throw new Error(`cmap platform 0 encoding 6 must use format 13, got format ${format}`)
  }
  if (isFullUnicode) {
    // Conventionally format 10/12, but format 4/6 (BMP subset) and 13 (many-to-
    // one, e.g. NISC18030 / LastResort) also appear and are valid supersets.
    if (format !== 4 && format !== 6 && format !== 10 && format !== 12 && format !== 13) {
      throw new Error(`cmap full Unicode encoding must use format 4, 6, 10, 12, or 13, got format ${format}`)
    }
  }
  if ((platformId === 0 && encodingId === 3) || (platformId === 3 && encodingId === 1)) {
    // Format 4/6 are the conventional BMP formats, but real fonts (e.g. macOS
    // Geneva) place a segmented format 10/12 subtable here; it is a valid
    // superset and must be accepted rather than rejected.
    if (format !== 4 && format !== 6 && format !== 10 && format !== 12) {
      throw new Error(`cmap BMP Unicode encoding must use format 4, 6, 10, or 12, got format ${format}`)
    }
  }
}

function cmapRecordRank(record: CmapEncodingRecord): number {
  if (record.platformId === 3 && record.encodingId === 10 && (record.format === 12 || record.format === 10)) return 70
  if (record.platformId === 0 && record.encodingId === 4 && (record.format === 12 || record.format === 10)) return 60
  if (record.platformId === 0 && record.encodingId === 6 && record.format === 13) return 50
  // Full-Unicode records carrying a BMP-style (4/6) or many-to-one (13) subtable
  // — less ideal than 10/12 but usable (macOS NISC18030 / LastResort).
  if (record.platformId === 3 && record.encodingId === 10 && (record.format === 4 || record.format === 6 || record.format === 13)) return 45
  if (record.platformId === 0 && record.encodingId === 4 && (record.format === 4 || record.format === 6 || record.format === 13)) return 44
  if (record.platformId === 3 && record.encodingId === 1 && (record.format === 12 || record.format === 10)) return 41
  if (record.platformId === 3 && record.encodingId === 1 && (record.format === 4 || record.format === 6)) return 40
  if (record.platformId === 0 && record.encodingId === 3 && (record.format === 12 || record.format === 10)) return 36
  if (record.platformId === 0 && record.encodingId === 3 && (record.format === 4 || record.format === 6)) return 35
  if (record.platformId === 0 && record.encodingId <= 2 && isSupportedBaseCmapFormat(record.format)) return 20
  if (record.platformId === 3 && record.encodingId === 0 && (record.format === 4 || record.format === 6)) return 15
  if (record.platformId === 1 && isSupportedBaseCmapFormat(record.format)) return 10
  return -1
}

function isSupportedBaseCmapFormat(format: number): boolean {
  return format === 0 || format === 2 || format === 4 || format === 6 ||
    format === 8 || format === 10 || format === 12 || format === 13
}

// --- Format 14 (UVS) ---

interface UvsData {
  getVariationGlyph(codePoint: number, varSelector: number, baseCmap: CmapMapping): number
  variationSequences(baseCmap: CmapMapping): Iterable<CmapVariationSequence>
}

interface VarSelectorRecord {
  varSelector: number
  defaultUVSOffset: number
  nonDefaultUVSOffset: number
}

function parseCmapFormat14(reader: BinaryReader): UvsData {
  const format = reader.readUint16() // should be 14
  if (format !== 14) {
    throw new Error(`Unsupported cmap format 14 subtable format: ${format}`)
  }
  const length = reader.readUint32()
  const numVarSelectorRecords = reader.readUint32()

  // Position of the subtable start (2 bytes back, since format has been read)
  const subtableStart = reader.position - 10
  if (length < 10 + numVarSelectorRecords * 11 || subtableStart + length > reader.length) {
    throw new Error('cmap format 14 length is invalid')
  }

  const records: VarSelectorRecord[] = []
  const selectorRecordsEnd = 10 + numVarSelectorRecords * 11
  let previousVarSelector = -1
  for (let i = 0; i < numVarSelectorRecords; i++) {
    const varSelector = readUint24(reader)
    const defaultUVSOffset = reader.readUint32()
    const nonDefaultUVSOffset = reader.readUint32()
    if (varSelector <= previousVarSelector) {
      throw new Error(`cmap format 14 variation selector record ${i} is not in strictly increasing order`)
    }
    if (defaultUVSOffset !== 0 && defaultUVSOffset < selectorRecordsEnd) {
      throw new Error(`cmap format 14 default UVS offset for selector ${varSelector.toString(16)} overlaps selector records`)
    }
    if (defaultUVSOffset !== 0 && defaultUVSOffset + 4 > length) {
      throw new Error(`cmap format 14 default UVS offset for selector ${varSelector.toString(16)} exceeds subtable length`)
    }
    if (nonDefaultUVSOffset !== 0 && nonDefaultUVSOffset < selectorRecordsEnd) {
      throw new Error(`cmap format 14 non-default UVS offset for selector ${varSelector.toString(16)} overlaps selector records`)
    }
    if (nonDefaultUVSOffset !== 0 && nonDefaultUVSOffset + 4 > length) {
      throw new Error(`cmap format 14 non-default UVS offset for selector ${varSelector.toString(16)} exceeds subtable length`)
    }
    records.push({ varSelector, defaultUVSOffset, nonDefaultUVSOffset })
    previousVarSelector = varSelector
  }

  // defaultUVS: Unicode ranges where the default glyph is used
  // nonDefaultUVS: explicit (codePoint → glyphId) mappings

  // Pre-parse all records
  const defaultRanges = new Map<number, { startUnicode: number, additionalCount: number }[]>()
  const nonDefaultMappings = new Map<number, Map<number, number>>()

  for (const rec of records) {
    // Default UVS
    if (rec.defaultUVSOffset !== 0) {
      reader.seek(subtableStart + rec.defaultUVSOffset)
      const numRanges = reader.readUint32()
      if (rec.defaultUVSOffset + 4 + numRanges * 4 > length) {
        throw new Error(`cmap format 14 default UVS table for selector ${rec.varSelector.toString(16)} exceeds subtable length`)
      }
      const ranges: { startUnicode: number, additionalCount: number }[] = []
      let previousEnd = -1
      for (let i = 0; i < numRanges; i++) {
        const startUnicode = readUint24(reader)
        const additionalCount = reader.readUint8()
        const endUnicode = startUnicode + additionalCount
        if (endUnicode > 0xFFFFFF) {
          throw new Error(`cmap format 14 default UVS range ${i} exceeds 24-bit Unicode value range`)
        }
        if (startUnicode <= previousEnd) {
          throw new Error(`cmap format 14 default UVS range ${i} is overlapping or out of order`)
        }
        ranges.push({ startUnicode, additionalCount })
        previousEnd = endUnicode
      }
      defaultRanges.set(rec.varSelector, ranges)
    }

    // Non-default UVS
    if (rec.nonDefaultUVSOffset !== 0) {
      reader.seek(subtableStart + rec.nonDefaultUVSOffset)
      const numMappings = reader.readUint32()
      if (rec.nonDefaultUVSOffset + 4 + numMappings * 5 > length) {
        throw new Error(`cmap format 14 non-default UVS table for selector ${rec.varSelector.toString(16)} exceeds subtable length`)
      }
      const mappings = new Map<number, number>()
      let previousUnicodeValue = -1
      for (let i = 0; i < numMappings; i++) {
        const unicodeValue = readUint24(reader)
        const glyphId = reader.readUint16()
        if (unicodeValue <= previousUnicodeValue) {
          throw new Error(`cmap format 14 non-default UVS mapping ${i} is not in strictly increasing order`)
        }
        const ranges = defaultRanges.get(rec.varSelector)
        if (ranges !== undefined && isInUvsRanges(unicodeValue, ranges)) {
          throw new Error(`cmap format 14 U+${unicodeValue.toString(16)} is both a default and non-default sequence for selector ${rec.varSelector.toString(16)}`)
        }
        mappings.set(unicodeValue, glyphId)
        previousUnicodeValue = unicodeValue
      }
      nonDefaultMappings.set(rec.varSelector, mappings)
    }
  }

  return {
    getVariationGlyph(codePoint: number, varSelector: number, baseCmap: CmapMapping): number {
      // Check non-default mappings first
      const ndMap = nonDefaultMappings.get(varSelector)
      if (ndMap) {
        const gid = ndMap.get(codePoint)
        if (gid !== undefined) return gid
      }

      // Check default ranges
      const ranges = defaultRanges.get(varSelector)
      if (ranges) {
        for (const range of ranges) {
          if (codePoint >= range.startUnicode &&
              codePoint <= range.startUnicode + range.additionalCount) {
            // Use default glyph
            return baseCmap.getGlyphId(codePoint)
          }
        }
      }

      return -1 // not found
    },
    *variationSequences(baseCmap: CmapMapping): Iterable<CmapVariationSequence> {
      for (const rec of records) {
        const ranges = defaultRanges.get(rec.varSelector)
        if (ranges !== undefined) {
          for (const range of ranges) {
            const end = range.startUnicode + range.additionalCount
            for (let codePoint = range.startUnicode; codePoint <= end; codePoint++) {
              yield {
                codePoint,
                variationSelector: rec.varSelector,
                glyphId: baseCmap.getGlyphId(codePoint),
                isDefault: true,
              }
            }
          }
        }
        const mappings = nonDefaultMappings.get(rec.varSelector)
        if (mappings !== undefined) {
          for (const [codePoint, glyphId] of mappings) {
            yield {
              codePoint,
              variationSelector: rec.varSelector,
              glyphId,
              isDefault: false,
            }
          }
        }
      }
    },
  }
}

function isInUvsRanges(codePoint: number, ranges: readonly { startUnicode: number, additionalCount: number }[]): boolean {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const range = ranges[middle]!
    if (codePoint < range.startUnicode) high = middle - 1
    else if (codePoint > range.startUnicode + range.additionalCount) low = middle + 1
    else return true
  }
  return false
}

function readUint24(reader: BinaryReader): number {
  const b1 = reader.readUint8()
  const b2 = reader.readUint8()
  const b3 = reader.readUint8()
  return (b1 << 16) | (b2 << 8) | b3
}

// --- Format 0 ---

function parseCmapFormat0(reader: BinaryReader): CmapMapping {
  const subtableStart = reader.position - 2
  const length = reader.readUint16()
  if (length !== 262 || subtableStart + length > reader.length) {
    throw new Error(`cmap format 0 length must be 262, got ${length}`)
  }
  reader.skip(2) // language
  const glyphIdArray = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    glyphIdArray[i] = reader.readUint8()
  }

  return {
    getGlyphId(codePoint: number): number {
      if (codePoint < 0 || codePoint > 255) return 0
      return glyphIdArray[codePoint]!
    },

    getGlyphIdWithVariation(codePoint: number, _vs: number): number {
      return this.getGlyphId(codePoint)
    },

    *entries(): Iterable<[number, number]> {
      for (let i = 0; i < 256; i++) {
        if (glyphIdArray[i]! !== 0) {
          yield [i, glyphIdArray[i]!]
        }
      }
    },
  }
}

// --- Format 2 (High-byte mapping through table) ---

function parseCmapFormat2(reader: BinaryReader): CmapMapping {
  const subtableStart = reader.position - 2
  const length = reader.readUint16()
  if (length < 518 || subtableStart + length > reader.length) {
    throw new Error('cmap format 2 length is invalid')
  }
  reader.skip(2) // language

  // 256 subHeader keys (each is a byte offset into subHeaders array, divided by 8)
  const subHeaderKeys = new Uint16Array(256)
  for (let i = 0; i < 256; i++) {
    const subHeaderKey = reader.readUint16()
    if ((subHeaderKey & 7) !== 0) {
      throw new Error(`cmap format 2 subHeaderKey ${i} must be a multiple of 8, got ${subHeaderKey}`)
    }
    subHeaderKeys[i] = subHeaderKey
  }

  // Determine number of subHeaders
  let maxKey = 0
  for (let i = 0; i < 256; i++) {
    if (subHeaderKeys[i]! > maxKey) maxKey = subHeaderKeys[i]!
  }
  const numSubHeaders = (maxKey / 8) + 1

  const subHeadersStart = reader.position
  if (subHeadersStart + numSubHeaders * 8 > subtableStart + length) {
    throw new Error('cmap format 2 subHeaders exceed subtable length')
  }
  const subHeaders: { firstCode: number, entryCount: number, idDelta: number, idRangeOffset: number }[] = []

  for (let i = 0; i < numSubHeaders; i++) {
    const firstCode = reader.readUint16()
    const entryCount = reader.readUint16()
    const idDelta = reader.readInt16()
    const idRangeOffset = reader.readUint16()
    if (entryCount > 0 && firstCode + entryCount - 1 > 0xFF) {
      throw new Error(`cmap format 2 subHeader ${i} character range exceeds one byte`)
    }
    if ((idRangeOffset & 1) !== 0) {
      throw new Error(`cmap format 2 subHeader ${i} idRangeOffset must be even, got ${idRangeOffset}`)
    }
    subHeaders.push({ firstCode, entryCount, idDelta, idRangeOffset })
  }

  // Remaining data is glyphIdArray
  const glyphIdArrayStart = reader.position
  const glyphIdArrayStartFromSubHeaders = glyphIdArrayStart - subHeadersStart
  const glyphIdCount = Math.max(0, (subtableStart + length - glyphIdArrayStart) >> 1)
  const glyphIdArray = reader.readUint16Array(glyphIdCount)
  for (let i = 0; i < subHeaders.length; i++) {
    const sh = subHeaders[i]!
    if (sh.entryCount === 0) continue
    const firstIndex = ((i * 8 + 6 + sh.idRangeOffset - glyphIdArrayStartFromSubHeaders) >> 1)
    const lastIndex = firstIndex + sh.entryCount - 1
    if (firstIndex < 0 || lastIndex >= glyphIdArray.length) {
      throw new Error(`cmap format 2 subHeader ${i} idRangeOffset references outside glyphIdArray`)
    }
  }

  return {
    getGlyphId(codePoint: number): number {
      if (codePoint < 0) return 0
      const highByte = (codePoint >> 8) & 0xFF
      const lowByte = codePoint & 0xFF

      const subHeaderIdx = subHeaderKeys[highByte]! / 8
      if (subHeaderIdx >= subHeaders.length) return 0

      const sh = subHeaders[subHeaderIdx]!

      if (subHeaderIdx === 0) {
        // Single-byte character
        if (highByte !== 0) return 0
        const idx = lowByte - sh.firstCode
        if (idx < 0 || idx >= sh.entryCount) return 0
        const glyphIdx = ((subHeaderIdx * 8 + 6 + sh.idRangeOffset - glyphIdArrayStartFromSubHeaders) >> 1) + idx
        if (glyphIdx < 0 || glyphIdx >= glyphIdArray.length) return 0
        const gid = glyphIdArray[glyphIdx]!
        if (gid === 0) return 0
        return (gid + sh.idDelta) & 0xFFFF
      } else {
        // Two-byte character
        const idx = lowByte - sh.firstCode
        if (idx < 0 || idx >= sh.entryCount) return 0
        const glyphIdx = ((subHeaderIdx * 8 + 6 + sh.idRangeOffset - glyphIdArrayStartFromSubHeaders) >> 1) + idx
        if (glyphIdx < 0 || glyphIdx >= glyphIdArray.length) return 0
        const gid = glyphIdArray[glyphIdx]!
        if (gid === 0) return 0
        return (gid + sh.idDelta) & 0xFFFF
      }
    },

    getGlyphIdWithVariation(codePoint: number, _vs: number): number {
      return this.getGlyphId(codePoint)
    },

    *entries(): Iterable<[number, number]> {
      for (let highByte = 0; highByte < 256; highByte++) {
        const subHeaderIdx = subHeaderKeys[highByte]! / 8
        if (subHeaderIdx >= subHeaders.length) continue
        if (highByte !== 0 && subHeaderIdx === 0) continue

        const sh = subHeaders[subHeaderIdx]!
        for (let i = 0; i < sh.entryCount; i++) {
          const lowByte = sh.firstCode + i
          if (lowByte > 0xFF) continue
          const cp = highByte === 0 ? lowByte : ((highByte << 8) | lowByte)
          const gid = this.getGlyphId(cp)
          if (gid !== 0) yield [cp, gid]
        }
      }
    },
  }
}

// --- Format 4 ---

function parseCmapFormat4(reader: BinaryReader): CmapMapping {
  const subtableStart = reader.position - 2
  const length = reader.readUint16()
  if (length < 24 || subtableStart + length > reader.length) {
    throw new Error('cmap format 4 length is invalid')
  }
  reader.skip(2) // language
  const segCountX2 = reader.readUint16()
  if (segCountX2 === 0 || (segCountX2 & 1) !== 0) {
    throw new Error(`cmap format 4 segCountX2 must be a positive even value, got ${segCountX2}`)
  }
  const segCount = segCountX2 >> 1
  // These fields are not trusted for lookup. Explicit conformance validation
  // still reports incorrect values, while ordinary loading remains compatible
  // with legacy fonts that shipped incorrect search hints.
  const searchRange = reader.readUint16()
  const entrySelector = reader.readUint16()
  const rangeShift = reader.readUint16()
  const expectedEntrySelector = Math.floor(Math.log2(segCount))
  const expectedSearchRange = 2 * (1 << expectedEntrySelector)
  const expectedRangeShift = segCount * 2 - expectedSearchRange
  const conformanceErrors: string[] = []
  if (searchRange !== expectedSearchRange || entrySelector !== expectedEntrySelector || rangeShift !== expectedRangeShift) {
    conformanceErrors.push(
      `cmap format 4 search fields must be ${expectedSearchRange}/${expectedEntrySelector}/${expectedRangeShift}, got ${searchRange}/${entrySelector}/${rangeShift}`,
    )
  }
  const minimumLength = 16 + segCount * 8
  if (length < minimumLength) {
    throw new Error(`cmap format 4 length ${length} is shorter than required ${minimumLength}`)
  }

  const endCodes = reader.readUint16Array(segCount)
  let previousEndCode = -1
  for (let i = 0; i < segCount; i++) {
    const endCode = endCodes[i]!
    if (endCode <= previousEndCode) {
      throw new Error(`cmap format 4 endCode segment ${i} is not in strictly increasing order`)
    }
    previousEndCode = endCode
  }
  if (endCodes[segCount - 1] !== 0xFFFF) {
    throw new Error('cmap format 4 final endCode must be 0xFFFF')
  }
  const reservedPad = reader.readUint16()
  if (reservedPad !== 0) {
    throw new Error(`cmap format 4 reservedPad must be 0, got ${reservedPad}`)
  }
  const startCodes = reader.readUint16Array(segCount)
  if (startCodes[segCount - 1] !== 0xFFFF) {
    throw new Error('cmap format 4 final startCode must be 0xFFFF')
  }
  for (let i = 0; i < segCount; i++) {
    if (startCodes[i]! > endCodes[i]!) {
      throw new Error(`cmap format 4 segment ${i} has startCode greater than endCode`)
    }
    if (i > 0 && startCodes[i]! <= endCodes[i - 1]!) {
      throw new Error(`cmap format 4 segment ${i} overlaps the previous segment`)
    }
  }
  const idDeltas = reader.readInt16Array(segCount)

  const idRangeOffsets = reader.readUint16Array(segCount)

  // Remaining glyphIdArray. Some real fonts (macOS Diwan Thuluth) declare a
  // subtable /length that does not cover the full glyphIdArray, so a segment's
  // idRangeOffset can reference past the (truncated) array. Rather than reject
  // the font, rely on the per-lookup bounds check in getGlyphId (out-of-range
  // resolves to glyph 0), matching the graceful behaviour of other readers.
  const glyphIdCount = Math.max(0, (subtableStart + length - reader.position) >> 1)
  const glyphIdArray = reader.readUint16Array(glyphIdCount)

  for (let seg = 0; seg < segCount; seg++) {
    const rangeOffset = idRangeOffsets[seg]!
    if (rangeOffset === 0) continue
    const firstIndex = (rangeOffset >> 1) - (segCount - seg)
    const lastIndex = firstIndex + endCodes[seg]! - startCodes[seg]!
    if (firstIndex < 0 || lastIndex >= glyphIdArray.length) {
      conformanceErrors.push(`cmap format 4 segment ${seg} idRangeOffset references outside glyphIdArray`)
      break
    }
  }

  const data: CmapFormat4Data = {
    format: 4,
    segCount,
    endCodes,
    startCodes,
    idDeltas,
    idRangeOffsets,
    glyphIdArray,
  }

  return createCmapFormat4(data, conformanceErrors)
}

function createCmapFormat4(data: CmapFormat4Data, conformanceErrors: readonly string[]): InternalCmapMapping {
  return {
    conformanceErrors,
    getGlyphId(codePoint: number): number {
      if (codePoint > 0xFFFF) return 0

      // Locate the segment via binary search
      let lo = 0
      let hi = data.segCount - 1
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        if (data.endCodes[mid]! < codePoint) {
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }

      const seg = lo
      if (seg >= data.segCount) return 0
      if (data.startCodes[seg]! > codePoint) return 0

      if (data.idRangeOffsets[seg] === 0) {
        return (codePoint + data.idDeltas[seg]!) & 0xFFFF
      }

      // Case where idRangeOffset is used
      const rangeOffset = data.idRangeOffsets[seg]!
      const glyphIdIndex = (rangeOffset >> 1) - (data.segCount - seg) + (codePoint - data.startCodes[seg]!)
      if (glyphIdIndex < 0 || glyphIdIndex >= data.glyphIdArray.length) return 0

      const glyphId = data.glyphIdArray[glyphIdIndex]!
      if (glyphId === 0) return 0
      return (glyphId + data.idDeltas[seg]!) & 0xFFFF
    },

    getGlyphIdWithVariation(codePoint: number, _vs: number): number {
      return this.getGlyphId(codePoint)
    },

    *entries(): Iterable<[number, number]> {
      for (let seg = 0; seg < data.segCount; seg++) {
        const start = data.startCodes[seg]!
        const end = data.endCodes[seg]!
        if (start === 0xFFFF) continue

        for (let cp = start; cp <= end; cp++) {
          let glyphId: number
          if (data.idRangeOffsets[seg] === 0) {
            glyphId = (cp + data.idDeltas[seg]!) & 0xFFFF
          } else {
            const rangeOffset = data.idRangeOffsets[seg]!
            const glyphIdIndex = (rangeOffset >> 1) - (data.segCount - seg) + (cp - start)
            if (glyphIdIndex < 0 || glyphIdIndex >= data.glyphIdArray.length) continue
            glyphId = data.glyphIdArray[glyphIdIndex]!
            if (glyphId !== 0) {
              glyphId = (glyphId + data.idDeltas[seg]!) & 0xFFFF
            }
          }
          if (glyphId !== 0) {
            yield [cp, glyphId]
          }
        }
      }
    },
  }
}

// --- Format 6 ---

function parseCmapFormat6(reader: BinaryReader): CmapMapping {
  const subtableStart = reader.position - 2
  const length = reader.readUint16()
  if (length < 10 || subtableStart + length > reader.length) {
    throw new Error('cmap format 6 length is invalid')
  }
  reader.skip(2) // language
  const firstCode = reader.readUint16()
  const entryCount = reader.readUint16()
  const expectedLength = 10 + entryCount * 2
  if (length !== expectedLength) {
    throw new Error(`cmap format 6 length must be ${expectedLength}, got ${length}`)
  }
  if (entryCount > 0 && firstCode + entryCount - 1 > 0xFFFF) {
    throw new Error('cmap format 6 character range exceeds U+FFFF')
  }
  const glyphIdArray = reader.readUint16Array(entryCount)

  return {
    getGlyphId(codePoint: number): number {
      const idx = codePoint - firstCode
      if (idx < 0 || idx >= entryCount) return 0
      return glyphIdArray[idx]!
    },

    getGlyphIdWithVariation(codePoint: number, _vs: number): number {
      return this.getGlyphId(codePoint)
    },

    *entries(): Iterable<[number, number]> {
      for (let i = 0; i < entryCount; i++) {
        if (glyphIdArray[i]! !== 0) {
          yield [firstCode + i, glyphIdArray[i]!]
        }
      }
    },
  }
}

// --- Format 8 (Mixed 16/32-bit coverage) ---

function parseCmapFormat8(reader: BinaryReader): CmapMapping {
  const subtableStart = reader.position - 2
  const reserved = reader.readUint16()
  if (reserved !== 0) {
    throw new Error(`cmap format 8 reserved field must be 0, got ${reserved}`)
  }
  const length = reader.readUint32()
  if (length < 8208 || subtableStart + length > reader.length) {
    throw new Error('cmap format 8 length is invalid')
  }
  reader.skip(4) // language (Uint32)

  // is32 bitmap: 8192 bytes (65536 bits)
  const is32 = new Uint8Array(8192)
  for (let i = 0; i < 8192; i++) {
    is32[i] = reader.readUint8()
  }

  const numGroups = reader.readUint32()
  const expectedLength = 8208 + numGroups * 12
  if (length !== expectedLength) {
    throw new Error(`cmap format 8 length must be ${expectedLength}, got ${length}`)
  }
  const groups: { startCharCode: number, endCharCode: number, startGlyphId: number }[] = []
  let previousEndCharCode = -1
  for (let i = 0; i < numGroups; i++) {
    const startCharCode = reader.readUint32()
    const endCharCode = reader.readUint32()
    const startGlyphId = reader.readUint32()
    if (endCharCode > 0x10FFFF) {
      throw new Error(`cmap format 8 group ${i} endCharCode exceeds Unicode range`)
    }
    if (startCharCode > endCharCode) {
      throw new Error(`cmap format 8 group ${i} has startCharCode greater than endCharCode`)
    }
    if (startCharCode <= previousEndCharCode) {
      throw new Error(`cmap format 8 group ${i} overlaps or is out of order`)
    }
    validateFormat8GroupAgainstIs32(is32, i, startCharCode, endCharCode)
    groups.push({ startCharCode, endCharCode, startGlyphId })
    previousEndCharCode = endCharCode
  }

  return {
    getGlyphId(codePoint: number): number {
      if (!format8CodeMatchesIs32(is32, codePoint)) return 0
      // Binary search
      let lo = 0, hi = groups.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        const g = groups[mid]!
        if (codePoint < g.startCharCode) hi = mid - 1
        else if (codePoint > g.endCharCode) lo = mid + 1
        else return g.startGlyphId + (codePoint - g.startCharCode)
      }
      return 0
    },

    getGlyphIdWithVariation(codePoint: number, _vs: number): number {
      return this.getGlyphId(codePoint)
    },

    *entries(): Iterable<[number, number]> {
      for (const g of groups) {
        for (let cp = g.startCharCode; cp <= g.endCharCode; cp++) {
          if (format8CodeMatchesIs32(is32, cp)) yield [cp, g.startGlyphId + (cp - g.startCharCode)]
        }
      }
    },
  }
}

function validateFormat8GroupAgainstIs32(is32: Uint8Array, groupIndex: number, startCharCode: number, endCharCode: number): void {
  for (let cp = startCharCode; cp <= endCharCode; cp++) {
    if (!format8CodeMatchesIs32(is32, cp)) {
      const word = cp <= 0xFFFF ? cp : cp >>> 16
      const expected = cp > 0xFFFF
      throw new Error(`cmap format 8 group ${groupIndex} is32 bit for word 0x${word.toString(16)} must be ${expected ? 1 : 0}`)
    }
  }
}

function format8CodeMatchesIs32(is32: Uint8Array, codePoint: number): boolean {
  if (codePoint < 0 || codePoint > 0x10FFFF) return false
  if (codePoint <= 0xFFFF) return !getFormat8Is32Bit(is32, codePoint)
  return getFormat8Is32Bit(is32, codePoint >>> 16)
}

function getFormat8Is32Bit(is32: Uint8Array, word: number): boolean {
  return (is32[word >>> 3]! & (1 << (7 - (word & 7)))) !== 0
}

// --- Format 10 (Trimmed array) ---

function parseCmapFormat10(reader: BinaryReader): CmapMapping {
  const subtableStart = reader.position - 2
  const reserved = reader.readUint16()
  if (reserved !== 0) {
    throw new Error(`cmap format 10 reserved field must be 0, got ${reserved}`)
  }
  const length = reader.readUint32()
  if (length < 20 || subtableStart + length > reader.length) {
    throw new Error('cmap format 10 length is invalid')
  }
  reader.skip(4) // language (Uint32)
  const startCharCode = reader.readUint32()
  const numChars = reader.readUint32()
  const expectedLength = 20 + numChars * 2
  if (length !== expectedLength) {
    throw new Error(`cmap format 10 length must be ${expectedLength}, got ${length}`)
  }
  if (numChars > 0 && startCharCode + numChars - 1 > 0x10FFFF) {
    throw new Error('cmap format 10 character range exceeds Unicode range')
  }
  const glyphIdArray = new Uint16Array(numChars)
  for (let i = 0; i < numChars; i++) {
    glyphIdArray[i] = reader.readUint16()
  }

  return {
    getGlyphId(codePoint: number): number {
      const idx = codePoint - startCharCode
      if (idx < 0 || idx >= numChars) return 0
      return glyphIdArray[idx]!
    },

    getGlyphIdWithVariation(codePoint: number, _vs: number): number {
      return this.getGlyphId(codePoint)
    },

    *entries(): Iterable<[number, number]> {
      for (let i = 0; i < numChars; i++) {
        if (glyphIdArray[i]! !== 0) {
          yield [startCharCode + i, glyphIdArray[i]!]
        }
      }
    },
  }
}

// --- Format 12 ---

function parseCmapFormat12(reader: BinaryReader): CmapMapping {
  const subtableStart = reader.position - 2
  const reserved = reader.readUint16()
  if (reserved !== 0) {
    throw new Error(`cmap format 12 reserved field must be 0, got ${reserved}`)
  }
  const length = reader.readUint32()
  if (length < 16 || subtableStart + length > reader.length) {
    throw new Error('cmap format 12 length is invalid')
  }
  reader.skip(4) // language (Uint32)
  const numGroups = reader.readUint32()
  const expectedLength = 16 + numGroups * 12
  if (length !== expectedLength) {
    throw new Error(`cmap format 12 length must be ${expectedLength}, got ${length}`)
  }

  const groups: CmapFormat12Group[] = []
  let previousEndCharCode = -1
  for (let i = 0; i < numGroups; i++) {
    const startCharCode = reader.readUint32()
    const endCharCode = reader.readUint32()
    const startGlyphId = reader.readUint32()
    if (endCharCode > 0x10FFFF) {
      throw new Error(`cmap format 12 group ${i} endCharCode exceeds Unicode range`)
    }
    if (startCharCode > endCharCode) {
      throw new Error(`cmap format 12 group ${i} has startCharCode greater than endCharCode`)
    }
    if (startCharCode <= previousEndCharCode) {
      throw new Error(`cmap format 12 group ${i} overlaps or is out of order`)
    }
    groups.push({ startCharCode, endCharCode, startGlyphId })
    previousEndCharCode = endCharCode
  }

  const data: CmapFormat12Data = { format: 12, groups }
  return createCmapFormat12(data)
}

function createCmapFormat12(data: CmapFormat12Data): CmapMapping {
  return {
    getGlyphId(codePoint: number): number {
      // Binary search
      let lo = 0
      let hi = data.groups.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        const group = data.groups[mid]!
        if (codePoint < group.startCharCode) {
          hi = mid - 1
        } else if (codePoint > group.endCharCode) {
          lo = mid + 1
        } else {
          return group.startGlyphId + (codePoint - group.startCharCode)
        }
      }
      return 0
    },

    getGlyphIdWithVariation(codePoint: number, _vs: number): number {
      return this.getGlyphId(codePoint)
    },

    *entries(): Iterable<[number, number]> {
      for (const group of data.groups) {
        for (let cp = group.startCharCode; cp <= group.endCharCode; cp++) {
          const glyphId = group.startGlyphId + (cp - group.startCharCode)
          yield [cp, glyphId]
        }
      }
    },
  }
}

// --- Format 13 ---

function parseCmapFormat13(reader: BinaryReader): CmapMapping {
  const subtableStart = reader.position - 2
  const reserved = reader.readUint16()
  if (reserved !== 0) {
    throw new Error(`cmap format 13 reserved field must be 0, got ${reserved}`)
  }
  const length = reader.readUint32()
  if (length < 16 || subtableStart + length > reader.length) {
    throw new Error('cmap format 13 length is invalid')
  }
  reader.skip(4) // language
  const numGroups = reader.readUint32()
  const expectedLength = 16 + numGroups * 12
  if (length !== expectedLength) {
    throw new Error(`cmap format 13 length must be ${expectedLength}, got ${length}`)
  }

  const groups: { startCharCode: number, endCharCode: number, glyphId: number }[] = []
  let previousEndCharCode = -1
  for (let i = 0; i < numGroups; i++) {
    const startCharCode = reader.readUint32()
    const endCharCode = reader.readUint32()
    const glyphId = reader.readUint32()
    if (endCharCode > 0x10FFFF) {
      throw new Error(`cmap format 13 group ${i} endCharCode exceeds Unicode range`)
    }
    if (startCharCode > endCharCode) {
      throw new Error(`cmap format 13 group ${i} has startCharCode greater than endCharCode`)
    }
    if (startCharCode <= previousEndCharCode) {
      throw new Error(`cmap format 13 group ${i} overlaps or is out of order`)
    }
    groups.push({ startCharCode, endCharCode, glyphId })
    previousEndCharCode = endCharCode
  }

  return {
    getGlyphId(codePoint: number): number {
      let lo = 0
      let hi = groups.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        const group = groups[mid]!
        if (codePoint < group.startCharCode) {
          hi = mid - 1
        } else if (codePoint > group.endCharCode) {
          lo = mid + 1
        } else {
          return group.glyphId
        }
      }
      return 0
    },

    getGlyphIdWithVariation(codePoint: number, _vs: number): number {
      return this.getGlyphId(codePoint)
    },

    *entries(): Iterable<[number, number]> {
      for (const group of groups) {
        for (let cp = group.startCharCode; cp <= group.endCharCode; cp++) {
          yield [cp, group.glyphId]
        }
      }
    },
  }
}
