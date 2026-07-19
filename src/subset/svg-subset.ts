import type { SfntData } from '../types/index.js'
import { BinaryWriter } from '../binary/writer.js'
import { getTableReader } from '../parsers/sfnt-parser.js'
import { gzipInflate } from '../compression/inflate.js'
import { remapOpenTypeSvgGlyphIds } from '../svg/svg-parser.js'

interface SvgSubsetRecord {
  start: number
  end: number
  document: Uint8Array
}

export function buildSvgSubsetTable(
  sfnt: SfntData,
  oldToNew: ReadonlyMap<number, number>,
  paletteEntryMap?: ReadonlyMap<number, number>,
): Uint8Array | null {
  const reader = getTableReader(sfnt, 'SVG ')
  if (reader === null) return null
  const documentListOffset = reader.getUint32At(2)
  const numEntries = reader.getUint16At(documentListOffset)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const transformed = new Map<string, Uint8Array>()
  const records: SvgSubsetRecord[] = []

  for (let i = 0; i < numEntries; i++) {
    const recordOffset = documentListOffset + 2 + i * 12
    const oldStart = reader.getUint16At(recordOffset)
    const oldEnd = reader.getUint16At(recordOffset + 2)
    const dataOffset = reader.getUint32At(recordOffset + 4)
    const dataLength = reader.getUint32At(recordOffset + 8)
    const selected: Array<{ oldId: number, newId: number }> = []
    for (let oldId = oldStart; oldId <= oldEnd; oldId++) {
      const newId = oldToNew.get(oldId)
      if (newId !== undefined) selected.push({ oldId, newId })
    }
    if (selected.length === 0) continue
    selected.sort(function (a, b) { return a.newId - b.newId })

    const key = `${dataOffset}:${dataLength}`
    let document = transformed.get(key)
    if (document === undefined) {
      const encoded = new Uint8Array(dataLength)
      for (let j = 0; j < dataLength; j++) encoded[j] = reader.getUint8At(documentListOffset + dataOffset + j)
      const bytes = encoded.length >= 3 && encoded[0] === 0x1F && encoded[1] === 0x8B && encoded[2] === 8
        ? gzipInflate(encoded)
        : encoded
      document = remapOpenTypeSvgGlyphIds(decoder.decode(bytes), oldToNew, paletteEntryMap)
      transformed.set(key, document)
    }

    let start = selected[0]!.newId
    let previous = start
    for (let j = 1; j <= selected.length; j++) {
      const current = j < selected.length ? selected[j]!.newId : -1
      if (current === previous + 1) { previous = current; continue }
      records.push({ start, end: previous, document })
      if (j < selected.length) { start = current; previous = current }
    }
  }
  if (records.length === 0) return null
  records.sort(function (a, b) { return a.start - b.start })

  const listOffset = 10
  const recordBytes = 2 + records.length * 12
  const documentOffsets = new Map<Uint8Array, number>()
  let total = listOffset + recordBytes
  for (let i = 0; i < records.length; i++) {
    if (documentOffsets.has(records[i]!.document)) continue
    documentOffsets.set(records[i]!.document, total - listOffset)
    total += records[i]!.document.length
  }
  const writer = new BinaryWriter(total)
  writer.writeUint16(0)
  writer.writeUint32(listOffset)
  writer.writeUint32(0)
  writer.writeUint16(records.length)
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    writer.writeUint16(record.start)
    writer.writeUint16(record.end)
    writer.writeUint32(documentOffsets.get(record.document)!)
    writer.writeUint32(record.document.length)
  }
  for (const [document] of documentOffsets) writer.writeBytes(document)
  return writer.toUint8Array()
}

export function collectSvgPaletteIndices(table: Uint8Array | null, target: Set<number>): void {
  if (table === null) return
  const text = new TextDecoder().decode(table)
  const pattern = /--color([0-9]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) target.add(Number.parseInt(match[1]!, 10))
}
