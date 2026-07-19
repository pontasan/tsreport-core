import { BinaryReader } from '../../binary/reader.js'

/** Palette is suitable for a light background. */
export const CPAL_USABLE_WITH_LIGHT_BACKGROUND = 0x0001
/** Palette is suitable for a dark background. */
export const CPAL_USABLE_WITH_DARK_BACKGROUND = 0x0002

export interface CpalColor {
  blue: number
  green: number
  red: number
  alpha: number
}

export interface CpalTable {
  readonly version: number
  readonly numPalettes: number
  readonly numPaletteEntries: number
  readonly paletteTypes: readonly number[] | null
  readonly paletteLabelNameIds: readonly number[] | null
  readonly paletteEntryLabelNameIds: readonly number[] | null
  getColor(paletteIndex: number, colorIndex: number): CpalColor
  getDefaultColor(colorIndex: number): CpalColor
}

/** Parses CPAL and reads the latest known prefix of compatible future versions. */
export function parseCpal(reader: BinaryReader): CpalTable {
  if (reader.length < 12) throw new Error('CPAL header is truncated')
  const version = reader.readUint16()
  const numPaletteEntries = reader.readUint16()
  const numPalettes = reader.readUint16()
  const numColorRecords = reader.readUint16()
  const colorRecordsArrayOffset = reader.readUint32()
  if (numPaletteEntries === 0 || numPalettes === 0 || numColorRecords === 0) {
    throw new Error('CPAL requires at least one palette, palette entry, and color record')
  }
  const headerLength = 12 + numPalettes * 2 + (version >= 1 ? 12 : 0)
  ensureRange(reader.length, 0, headerLength, 'CPAL header')

  const paletteFirstColorIndices: number[] = new Array(numPalettes)
  let maximumRequiredColorRecord = 0
  for (let i = 0; i < numPalettes; i++) {
    const first = reader.readUint16()
    paletteFirstColorIndices[i] = first
    maximumRequiredColorRecord = Math.max(maximumRequiredColorRecord, first + numPaletteEntries)
  }
  if (maximumRequiredColorRecord > numColorRecords) {
    throw new Error('CPAL palette color-record range exceeds numColorRecords')
  }

  let paletteTypesOffset = 0
  let paletteLabelsOffset = 0
  let paletteEntryLabelsOffset = 0
  if (version >= 1) {
    paletteTypesOffset = reader.readUint32()
    paletteLabelsOffset = reader.readUint32()
    paletteEntryLabelsOffset = reader.readUint32()
  }

  ensureRange(reader.length, colorRecordsArrayOffset, numColorRecords * 4, 'CPAL color records')
  const colors: CpalColor[] = new Array(numColorRecords)
  reader.seek(colorRecordsArrayOffset)
  for (let i = 0; i < numColorRecords; i++) {
    colors[i] = {
      blue: reader.readUint8(),
      green: reader.readUint8(),
      red: reader.readUint8(),
      alpha: reader.readUint8(),
    }
  }

  const paletteTypes = paletteTypesOffset === 0
    ? null
    : readUint32Array(reader, paletteTypesOffset, numPalettes, 'CPAL palette types')
  if (paletteTypes !== null && version <= 1) {
    for (let i = 0; i < paletteTypes.length; i++) {
      if ((paletteTypes[i]! & 0xFFFFFFFC) !== 0) throw new Error('CPAL palette type reserved bits must be zero')
    }
  }
  const paletteLabelNameIds = paletteLabelsOffset === 0
    ? null
    : readUint16Array(reader, paletteLabelsOffset, numPalettes, 'CPAL palette labels')
  const paletteEntryLabelNameIds = paletteEntryLabelsOffset === 0
    ? null
    : readUint16Array(reader, paletteEntryLabelsOffset, numPaletteEntries, 'CPAL palette entry labels')

  return {
    version,
    numPalettes,
    numPaletteEntries,
    paletteTypes,
    paletteLabelNameIds,
    paletteEntryLabelNameIds,
    getColor(paletteIndex: number, colorIndex: number): CpalColor {
      if (paletteIndex < 0 || paletteIndex >= numPalettes || colorIndex < 0 || colorIndex >= numPaletteEntries) {
        throw new Error(`CPAL color index ${paletteIndex}:${colorIndex} is out of range`)
      }
      return colors[paletteFirstColorIndices[paletteIndex]! + colorIndex]!
    },
    getDefaultColor(colorIndex: number): CpalColor {
      return this.getColor(0, colorIndex)
    },
  }
}

function readUint16Array(reader: BinaryReader, offset: number, count: number, label: string): number[] {
  ensureRange(reader.length, offset, count * 2, label)
  const values: number[] = new Array(count)
  for (let i = 0; i < count; i++) values[i] = reader.getUint16At(offset + i * 2)
  return values
}

function readUint32Array(reader: BinaryReader, offset: number, count: number, label: string): number[] {
  ensureRange(reader.length, offset, count * 4, label)
  const values: number[] = new Array(count)
  for (let i = 0; i < count; i++) values[i] = reader.getUint32At(offset + i * 4)
  return values
}

function ensureRange(length: number, offset: number, size: number, label: string): void {
  if (offset < 0 || size < 0 || offset > length || size > length - offset) {
    throw new Error(`${label} exceeds table length`)
  }
}
