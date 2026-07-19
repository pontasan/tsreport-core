import { BinaryReader } from '../../binary/reader.js'
import { parseItemVariationStore, getDelta, validateDeltaSetIndex, type ItemVariationStore } from './variation-common.js'

/**
 * MVAR table: Metrics Variations
 * Variation deltas for font-level metrics
 * (ascender, descender, lineGap, xHeight, capHeight, etc.)
 */

export interface MvarTable {
  /**
   * Get the metric variation delta for the given tag
   * @param tag metric tag (4 characters, e.g. 'hasc', 'hdsc', 'hlgp', 'xhgt', 'cpht')
   * @param coords normalized axis coordinates
   */
  getMetricDelta(tag: string, coords: number[]): number
}

const MVAR_HEADER_SIZE = 12
const MVAR_MAJOR_VERSION = 1
const MVAR_MINOR_VERSION = 0
const MVAR_VALUE_RECORD_BASE_SIZE = 8
const MVAR_REGISTERED_VALUE_TAGS = new Set([
  'cpht',
  'gsp0',
  'gsp1',
  'gsp2',
  'gsp3',
  'gsp4',
  'gsp5',
  'gsp6',
  'gsp7',
  'gsp8',
  'gsp9',
  'hasc',
  'hcla',
  'hcld',
  'hcof',
  'hcrn',
  'hcrs',
  'hdsc',
  'hlgp',
  'sbxo',
  'sbxs',
  'sbyo',
  'sbys',
  'spxo',
  'spxs',
  'spyo',
  'spys',
  'stro',
  'strs',
  'undo',
  'unds',
  'vasc',
  'vcof',
  'vcrn',
  'vcrs',
  'vdsc',
  'vlgp',
  'xhgt',
])

export function parseMvar(reader: BinaryReader, expectedAxisCount?: number): MvarTable {
  const tableStart = reader.position
  if (reader.length - tableStart < MVAR_HEADER_SIZE) {
    throw new Error(`MVAR table length must be at least ${MVAR_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== MVAR_MAJOR_VERSION) {
    throw new Error(`Unsupported MVAR table version: ${majorVersion}.${minorVersion}`)
  }
  const reserved = reader.readUint16()
  if (minorVersion <= MVAR_MINOR_VERSION && reserved !== 0) {
    throw new Error(`MVAR reserved field must be zero, got ${reserved}`)
  }
  const valueRecordSize = reader.readUint16()
  if (valueRecordSize < MVAR_VALUE_RECORD_BASE_SIZE) {
    throw new Error(`MVAR valueRecordSize must be at least ${MVAR_VALUE_RECORD_BASE_SIZE}, got ${valueRecordSize}`)
  }
  const valueRecordCount = reader.readUint16()
  const itemVariationStoreOffset = reader.readUint16()
  if (valueRecordCount === 0 && itemVariationStoreOffset !== 0) {
    throw new Error(`MVAR itemVariationStoreOffset must be zero when valueRecordCount is zero, got ${itemVariationStoreOffset}`)
  }
  if (valueRecordCount > 0 && itemVariationStoreOffset === 0) {
    throw new Error('MVAR itemVariationStoreOffset must be non-zero when valueRecordCount is greater than zero')
  }
  const valueRecordsSize = valueRecordCount * valueRecordSize
  const valueRecordsEnd = tableStart + MVAR_HEADER_SIZE + valueRecordsSize
  if (valueRecordsEnd > reader.length) {
    throw new Error('MVAR valueRecords exceed table length')
  }
  if (itemVariationStoreOffset !== 0 && (itemVariationStoreOffset < MVAR_HEADER_SIZE + valueRecordsSize || tableStart + itemVariationStoreOffset >= reader.length)) {
    throw new Error(`MVAR itemVariationStoreOffset exceeds table length: ${itemVariationStoreOffset}`)
  }

  // Value records
  const valueRecords = new Map<string, { outerIndex: number, innerIndex: number }>()
  let previousTag = ''
  for (let i = 0; i < valueRecordCount; i++) {
    reader.seek(tableStart + MVAR_HEADER_SIZE + i * valueRecordSize)
    const tag = reader.readTag()
    validateMvarTag(tag)
    if (previousTag !== '' && previousTag >= tag) {
      throw new Error(`MVAR valueTag records must be in binary order: ${previousTag} before ${tag}`)
    }
    previousTag = tag
    const outerIndex = reader.readUint16()
    const innerIndex = reader.readUint16()
    valueRecords.set(tag, { outerIndex, innerIndex })
  }

  // ItemVariationStore (offset 0 means no IVS per spec)
  const ivs: ItemVariationStore = itemVariationStoreOffset !== 0
    ? parseItemVariationStore(reader, tableStart + itemVariationStoreOffset, expectedAxisCount)
    : { regions: [], data: [] }
  for (const [tag, rec] of valueRecords) {
    validateDeltaSetIndex(ivs, rec.outerIndex, rec.innerIndex, `MVAR valueTag ${tag}`)
  }

  return {
    getMetricDelta(tag: string, coords: number[]): number {
      const rec = valueRecords.get(tag)
      if (!rec) return 0
      return getDelta(ivs, rec.outerIndex, rec.innerIndex, coords)
    },
  }
}

function validateMvarTag(tag: string): void {
  const first = tag.charCodeAt(0)
  if (isLowercaseAscii(first)) {
    for (let i = 1; i < tag.length; i++) {
      const code = tag.charCodeAt(i)
      if (!isLowercaseAscii(code) && !isAsciiDigit(code)) {
        throw new Error(`Invalid MVAR registered valueTag: ${tag}`)
      }
    }
    if (!MVAR_REGISTERED_VALUE_TAGS.has(tag)) {
      throw new Error(`Unknown MVAR registered valueTag: ${tag}`)
    }
    return
  }
  if (isUppercaseAscii(first)) {
    for (let i = 1; i < tag.length; i++) {
      const code = tag.charCodeAt(i)
      if (!isUppercaseAscii(code) && !isAsciiDigit(code)) {
        throw new Error(`Invalid MVAR private valueTag: ${tag}`)
      }
    }
    return
  }
  throw new Error(`Invalid MVAR valueTag: ${tag}`)
}

function isLowercaseAscii(code: number): boolean {
  return code >= 0x61 && code <= 0x7A
}

function isUppercaseAscii(code: number): boolean {
  return code >= 0x41 && code <= 0x5A
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}
