import { BinaryWriter } from '../binary/writer.js'
import type { CpalColor, CpalTable } from '../parsers/tables/cpal.js'

export interface CpalSubsetResult {
  table: Uint8Array | null
  oldToNewPaletteEntry: ReadonlyMap<number, number>
}

/** Rebuilds CPAL around the entries still referenced by retained color glyph programs. */
export function buildCpalSubsetTable(cpal: CpalTable | null, usedEntries: ReadonlySet<number>): CpalSubsetResult {
  const oldIndices: number[] = []
  if (cpal !== null) {
    for (const index of usedEntries) {
      if (!Number.isInteger(index) || index < 0 || index >= cpal.numPaletteEntries) {
        throw new Error(`Color glyph references CPAL entry ${index}, outside the palette entry range`)
      }
      oldIndices.push(index)
    }
  }
  oldIndices.sort(function (a, b) { return a - b })
  const oldToNew = new Map<number, number>()
  for (let i = 0; i < oldIndices.length; i++) oldToNew.set(oldIndices[i]!, i)
  if (cpal === null || oldIndices.length === 0) return { table: null, oldToNewPaletteEntry: oldToNew }

  const uniqueRows: CpalColor[][] = []
  const uniqueRowIndex = new Map<string, number>()
  const firstColorIndices: number[] = new Array(cpal.numPalettes)
  for (let palette = 0; palette < cpal.numPalettes; palette++) {
    const row: CpalColor[] = new Array(oldIndices.length)
    let key = ''
    for (let entry = 0; entry < oldIndices.length; entry++) {
      const color = cpal.getColor(palette, oldIndices[entry]!)
      row[entry] = color
      key += `${color.blue},${color.green},${color.red},${color.alpha};`
    }
    let rowIndex = uniqueRowIndex.get(key)
    if (rowIndex === undefined) {
      rowIndex = uniqueRows.length
      uniqueRowIndex.set(key, rowIndex)
      uniqueRows.push(row)
    }
    firstColorIndices[palette] = rowIndex * oldIndices.length
  }

  const numColorRecords = uniqueRows.length * oldIndices.length
  if (numColorRecords > 0xFFFF) throw new Error('CPAL subset color record count exceeds uint16 range')
  const headerLength = 12 + cpal.numPalettes * 2 + (cpal.version === 1 ? 12 : 0)
  const paletteTypesOffset = cpal.version === 1 && cpal.paletteTypes !== null
    ? headerLength + numColorRecords * 4
    : 0
  const paletteLabelsOffset = cpal.version === 1 && cpal.paletteLabelNameIds !== null
    ? headerLength + numColorRecords * 4 + (cpal.paletteTypes !== null ? cpal.numPalettes * 4 : 0)
    : 0
  const paletteEntryLabelsOffset = cpal.version === 1 && cpal.paletteEntryLabelNameIds !== null
    ? headerLength + numColorRecords * 4
      + (cpal.paletteTypes !== null ? cpal.numPalettes * 4 : 0)
      + (cpal.paletteLabelNameIds !== null ? cpal.numPalettes * 2 : 0)
    : 0

  const writer = new BinaryWriter(headerLength + numColorRecords * 4 + 64)
  writer.writeUint16(cpal.version)
  writer.writeUint16(oldIndices.length)
  writer.writeUint16(cpal.numPalettes)
  writer.writeUint16(numColorRecords)
  writer.writeUint32(headerLength)
  for (let i = 0; i < firstColorIndices.length; i++) writer.writeUint16(firstColorIndices[i]!)
  if (cpal.version === 1) {
    writer.writeUint32(paletteTypesOffset)
    writer.writeUint32(paletteLabelsOffset)
    writer.writeUint32(paletteEntryLabelsOffset)
  }
  for (let row = 0; row < uniqueRows.length; row++) {
    for (let entry = 0; entry < uniqueRows[row]!.length; entry++) {
      const color = uniqueRows[row]![entry]!
      writer.writeUint8(color.blue); writer.writeUint8(color.green); writer.writeUint8(color.red); writer.writeUint8(color.alpha)
    }
  }
  if (cpal.version === 1 && cpal.paletteTypes !== null) {
    for (let i = 0; i < cpal.paletteTypes.length; i++) writer.writeUint32(cpal.paletteTypes[i]!)
  }
  if (cpal.version === 1 && cpal.paletteLabelNameIds !== null) {
    for (let i = 0; i < cpal.paletteLabelNameIds.length; i++) writer.writeUint16(cpal.paletteLabelNameIds[i]!)
  }
  if (cpal.version === 1 && cpal.paletteEntryLabelNameIds !== null) {
    for (let i = 0; i < oldIndices.length; i++) writer.writeUint16(cpal.paletteEntryLabelNameIds[oldIndices[i]!]!)
  }
  return { table: writer.toUint8Array(), oldToNewPaletteEntry: oldToNew }
}
