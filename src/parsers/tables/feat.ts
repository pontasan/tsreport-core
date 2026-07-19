import { BinaryReader } from '../../binary/reader.js'

/**
 * feat table: Feature Names (Apple AAT)
 * Mapping from featureType + selectors to name table entries
 */

export interface FeatSelector {
  selectorValue: number
  nameIndex: number  // name ID in the name table
}

export interface FeatFeature {
  featureType: number
  nSettings: number
  settingTableOffset: number
  featureFlags: number
  nameIndex: number  // name ID in the name table
  selectors: FeatSelector[]
}

export interface FeatTable {
  readonly features: FeatFeature[]
  getFeature(featureType: number): FeatFeature | null
}

export function parseFeat(reader: BinaryReader): FeatTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, 12, 'feat header')
  const version = reader.readUint32()
  if (version !== 0x00010000) {
    throw new Error(`Unsupported feat table version: 0x${version.toString(16).padStart(8, '0')}`)
  }
  const featureNameCount = reader.readUint16()
  const reserved1 = reader.readUint16()
  const reserved2 = reader.readUint32()
  if (reserved1 !== 0) {
    throw new Error(`feat reserved field 1 must be zero, got ${reserved1}`)
  }
  if (reserved2 !== 0) {
    throw new Error(`feat reserved field 2 must be zero, got ${reserved2}`)
  }

  const featureArrayEnd = tableStart + 12 + featureNameCount * 12
  validateRange(reader, tableStart, 12 + featureNameCount * 12, 'feat feature name array')

  const features: FeatFeature[] = []
  const featureHeaders: { featureType: number, nSettings: number, settingTableOffset: number, featureFlags: number, nameIndex: number }[] = []

  let previousFeatureType = -1
  for (let i = 0; i < featureNameCount; i++) {
    const featureType = reader.readUint16()
    const nSettings = reader.readUint16()
    const settingTableOffset = reader.readUint32()
    const featureFlags = reader.readUint16()
    const nameIndex = reader.readUint16()
    if (featureType <= previousFeatureType) {
      throw new Error(`feat feature records must be sorted by feature type at index ${i}`)
    }
    validateNameIndex(nameIndex, `feat feature ${featureType} nameIndex`)
    validateFeatureFlags(featureType, featureFlags, nSettings)
    validateSettingTableRange(reader, tableStart, featureArrayEnd, settingTableOffset, nSettings, featureType)
    featureHeaders.push({ featureType, nSettings, settingTableOffset, featureFlags, nameIndex })
    previousFeatureType = featureType
  }

  for (let i = 0; i < featureHeaders.length; i++) {
    const h = featureHeaders[i]!
    const selectors: FeatSelector[] = []

    reader.seek(tableStart + h.settingTableOffset)
    let previousSelector = -1
    for (let j = 0; j < h.nSettings; j++) {
      const selectorValue = reader.readUint16()
      const nameIndex = reader.readUint16()
      if (selectorValue <= previousSelector) {
        throw new Error(`feat feature ${h.featureType} settings must be sorted by selector value at index ${j}`)
      }
      // A non-exclusive feature lists its settings as on/off pairs (even = on,
      // odd = off), so odd selectors are valid and shipping fonts (e.g. Bangla
      // MN) rely on them; do not reject them.
      validateNameIndex(nameIndex, `feat feature ${h.featureType} setting ${selectorValue} nameIndex`)
      selectors.push({ selectorValue, nameIndex })
      previousSelector = selectorValue
    }

    features.push({
      featureType: h.featureType,
      nSettings: h.nSettings,
      settingTableOffset: h.settingTableOffset,
      featureFlags: h.featureFlags,
      nameIndex: h.nameIndex,
      selectors,
    })
  }

  // Build lookup map
  const featureMap = new Map<number, number>()
  for (let i = 0; i < features.length; i++) {
    featureMap.set(features[i]!.featureType, i)
  }

  return {
    features,
    getFeature(featureType: number): FeatFeature | null {
      const idx = featureMap.get(featureType)
      return idx !== undefined ? features[idx]! : null
    },
  }
}

function validateFeatureFlags(featureType: number, featureFlags: number, nSettings: number): void {
  if ((featureFlags & 0x3F00) !== 0) {
    throw new Error(`feat feature ${featureType} reserved featureFlags bits must be zero: 0x${featureFlags.toString(16).padStart(4, '0')}`)
  }
  const exclusive = (featureFlags & 0x8000) !== 0
  const hasExplicitDefault = (featureFlags & 0x4000) !== 0
  if (featureType === 39 && !exclusive) {
    throw new Error('feat language-specific feature type 39 must be exclusive')
  }
  if (hasExplicitDefault && !exclusive) {
    throw new Error(`feat feature ${featureType} explicit default index requires exclusive featureFlags`)
  }
  if (hasExplicitDefault) {
    const defaultIndex = featureFlags & 0x00FF
    if (defaultIndex >= nSettings) {
      throw new Error(`feat feature ${featureType} default setting index ${defaultIndex} exceeds setting count ${nSettings}`)
    }
  }
}

function validateNameIndex(nameIndex: number, label: string): void {
  if (nameIndex <= 255 || nameIndex >= 32768) {
    throw new Error(`${label} must be greater than 255 and less than 32768, got ${nameIndex}`)
  }
}

function validateSettingTableRange(
  reader: BinaryReader,
  tableStart: number,
  featureArrayEnd: number,
  settingTableOffset: number,
  nSettings: number,
  featureType: number,
): void {
  const settingTableStart = tableStart + settingTableOffset
  if (settingTableStart < featureArrayEnd) {
    throw new Error(`feat feature ${featureType} settingTable overlaps feature name array`)
  }
  validateRange(reader, settingTableStart, nSettings * 4, `feat feature ${featureType} setting name array`)
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds feat table length: need ${offset + length}, got ${reader.length}`)
  }
}
