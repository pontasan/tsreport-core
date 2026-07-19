import { BinaryReader } from '../binary/reader.js'
import { BinaryWriter } from '../binary/writer.js'
import { getTableReader } from '../parsers/sfnt-parser.js'
import {
  parseBitmapLocationHeader,
  type BitmapGlyphData,
  type BitmapMetrics,
  type BitmapSizeRecord,
  type SbitLineMetrics,
} from '../parsers/tables/bitmap-index.js'
import { readEmbeddedBitmapGlyph } from '../parsers/tables/embedded-bitmap-data.js'
import { parseEbsc, type EbscStrike } from '../parsers/tables/ebsc.js'
import { parseSbix, type SbixGlyphData } from '../parsers/tables/sbix.js'
import type { SfntData } from '../types/font-data.js'

interface EncodedGlyph {
  glyphId: number
  format: number
  bytes: Uint8Array
  start: number
  end: number
}

interface EncodedRun {
  format: number
  glyphs: EncodedGlyph[]
  subtableOffset: number
}

interface EncodedStrike {
  source: BitmapSizeRecord
  glyphs: EncodedGlyph[]
  runs: EncodedRun[]
  listOffset: number
  listSize: number
}

/** Rebuilds glyph-indexed bitmap tables for stable or compact GID mappings. */
export function buildBitmapSubsetTables(
  sfnt: SfntData,
  oldToNew: ReadonlyMap<number, number>,
  outputNumGlyphs: number,
): Map<string, Uint8Array | null> {
  const output = new Map<string, Uint8Array | null>()
  subsetSbix(sfnt, oldToNew, outputNumGlyphs, output)

  const retainedStrikeKeys = new Set<string>()
  subsetEmbeddedPair(sfnt, 'EBLC', 'EBDT', 2, false, oldToNew, output, retainedStrikeKeys)
  subsetEmbeddedPair(sfnt, 'CBLC', 'CBDT', 3, false, oldToNew, output, retainedStrikeKeys)
  subsetEmbeddedPair(sfnt, 'bloc', 'bdat', 2, true, oldToNew, output, retainedStrikeKeys)
  subsetEbsc(sfnt, retainedStrikeKeys, output)
  return output
}

function subsetSbix(
  sfnt: SfntData,
  oldToNew: ReadonlyMap<number, number>,
  outputNumGlyphs: number,
  output: Map<string, Uint8Array | null>,
): void {
  const reader = getTableReader(sfnt, 'sbix')
  if (reader === null) return
  const maxp = getTableReader(sfnt, 'maxp')
  if (maxp === null || maxp.length < 6) throw new Error('sbix subset requires maxp')
  const sourceNumGlyphs = maxp.getUint16At(4)
  const table = parseSbix(reader, sourceNumGlyphs)
  const sourceByNew = invertGlyphMapping(oldToNew, outputNumGlyphs)
  const strikes: { ppem: number, ppi: number, records: Array<SbixGlyphData | null> }[] = []

  for (let si = 0; si < table.availableStrikes.length; si++) {
    const strike = table.availableStrikes[si]!
    const records = new Array<SbixGlyphData | null>(outputNumGlyphs).fill(null)
    let count = 0
    for (let newGlyphId = 0; newGlyphId < sourceByNew.length; newGlyphId++) {
      const oldGlyphId = sourceByNew[newGlyphId]!
      if (oldGlyphId < 0) continue
      const glyph = resolveSbixGlyph(table, oldGlyphId, strike.ppem, strike.ppi, sourceNumGlyphs)
      if (glyph === null) continue
      records[newGlyphId] = glyph
      count++
    }
    if (count > 0) strikes.push({ ppem: strike.ppem, ppi: strike.ppi, records })
  }

  if (strikes.length === 0) {
    output.set('sbix', null)
    return
  }
  const headerSize = 8 + strikes.length * 4
  const strikeOffsets = new Uint32Array(strikes.length)
  let total = headerSize
  for (let si = 0; si < strikes.length; si++) {
    strikeOffsets[si] = total
    total += 4 + (outputNumGlyphs + 1) * 4
    const records = strikes[si]!.records
    for (let glyphId = 0; glyphId < records.length; glyphId++) {
      const record = records[glyphId]!
      if (record !== null) total += 8 + record.data.length
    }
  }

  const writer = new BinaryWriter(total)
  writer.writeUint16(1)
  writer.writeUint16(1 | (table.drawOutlines ? 2 : 0))
  writer.writeUint32(strikes.length)
  for (let si = 0; si < strikes.length; si++) writer.writeUint32(strikeOffsets[si]!)
  for (let si = 0; si < strikes.length; si++) {
    const strike = strikes[si]!
    const strikeStart = writer.position
    writer.writeUint16(strike.ppem)
    writer.writeUint16(strike.ppi)
    const offsetsPosition = writer.position
    writer.position += (outputNumGlyphs + 1) * 4
    const offsets = new Uint32Array(outputNumGlyphs + 1)
    for (let glyphId = 0; glyphId < outputNumGlyphs; glyphId++) {
      offsets[glyphId] = writer.position - strikeStart
      const record = strike.records[glyphId]!
      if (record === null) continue
      writer.writeInt16(record.originOffsetX)
      writer.writeInt16(record.originOffsetY)
      writer.writeTag(record.graphicType)
      writer.writeBytes(record.data)
    }
    offsets[outputNumGlyphs] = writer.position - strikeStart
    const end = writer.position
    writer.position = offsetsPosition
    for (let i = 0; i < offsets.length; i++) writer.writeUint32(offsets[i]!)
    writer.position = end
  }
  output.set('sbix', writer.toUint8Array())
}

function resolveSbixGlyph(
  table: ReturnType<typeof parseSbix>,
  glyphId: number,
  ppem: number,
  ppi: number,
  numGlyphs: number,
): SbixGlyphData | null {
  let result = table.getGlyphBitmap(glyphId, ppem, ppi)
  if (result === null || result.graphicType !== 'dupe') return result
  const visited = new Set<number>()
  visited.add(glyphId)
  while (result.graphicType === 'dupe') {
    const referenced = (result.data[0]! << 8) | result.data[1]!
    if (referenced >= numGlyphs) throw new Error(`sbix dupe glyph ID is out of range: ${referenced}`)
    if (visited.has(referenced)) throw new Error(`sbix dupe cycle detected at glyph ${referenced}`)
    visited.add(referenced)
    result = table.getGlyphBitmap(referenced, ppem, ppi)
    if (result === null) return null
  }
  return result
}

function subsetEmbeddedPair(
  sfnt: SfntData,
  locationTag: 'EBLC' | 'CBLC' | 'bloc',
  dataTag: 'EBDT' | 'CBDT' | 'bdat',
  majorVersion: 2 | 3,
  legacyApple: boolean,
  oldToNew: ReadonlyMap<number, number>,
  output: Map<string, Uint8Array | null>,
  retainedStrikeKeys: Set<string>,
): void {
  const locationReader = getTableReader(sfnt, locationTag)
  const dataReader = getTableReader(sfnt, dataTag)
  if (locationReader === null && dataReader === null) return
  if (locationReader === null || dataReader === null) throw new Error(`${locationTag}/${dataTag} subset requires both tables`)
  const sourceStrikes = parseBitmapLocationHeader(locationReader, majorVersion, legacyApple)
  const mapping = [...oldToNew].sort(function (a, b) { return a[1] - b[1] })
  const dataWriter = new BinaryWriter()
  dataWriter.writeUint16(majorVersion)
  dataWriter.writeUint16(0)
  const strikes: EncodedStrike[] = []

  for (let si = 0; si < sourceStrikes.length; si++) {
    const source = sourceStrikes[si]!
    const glyphs: EncodedGlyph[] = []
    for (let mi = 0; mi < mapping.length; mi++) {
      const [oldGlyphId, newGlyphId] = mapping[mi]!
      const glyph = readEmbeddedBitmapGlyph(locationReader, dataReader, source, oldGlyphId, majorVersion === 3)
      if (glyph === null) continue
      const encoded = encodeEmbeddedGlyph(glyph, source)
      dataWriter.pad4()
      const start = dataWriter.position
      dataWriter.writeBytes(encoded.bytes)
      dataWriter.pad4()
      glyphs.push({ glyphId: newGlyphId, format: encoded.format, bytes: encoded.bytes, start, end: dataWriter.position })
    }
    if (glyphs.length === 0) continue
    const runs = buildRuns(glyphs)
    strikes.push({ source, glyphs, runs, listOffset: 0, listSize: 0 })
    retainedStrikeKeys.add(`${source.ppemX}:${source.ppemY}`)
  }

  if (strikes.length === 0) {
    output.set(locationTag, null)
    output.set(dataTag, null)
    return
  }
  let listOffset = 8 + strikes.length * 48
  for (let si = 0; si < strikes.length; si++) {
    const strike = strikes[si]!
    let subtableOffset = strike.runs.length * 8
    for (let ri = 0; ri < strike.runs.length; ri++) {
      const run = strike.runs[ri]!
      run.subtableOffset = subtableOffset
      subtableOffset += 8 + (run.glyphs.length + 1) * 4
    }
    strike.listOffset = listOffset
    strike.listSize = subtableOffset
    listOffset += subtableOffset
  }

  const locationWriter = new BinaryWriter(listOffset)
  locationWriter.writeUint16(majorVersion)
  locationWriter.writeUint16(0)
  locationWriter.writeUint32(strikes.length)
  for (let si = 0; si < strikes.length; si++) writeBitmapSize(locationWriter, strikes[si]!)
  for (let si = 0; si < strikes.length; si++) writeIndexSubtableList(locationWriter, strikes[si]!)
  output.set(locationTag, locationWriter.toUint8Array())
  output.set(dataTag, dataWriter.toUint8Array())
}

function encodeEmbeddedGlyph(glyph: BitmapGlyphData, strike: BitmapSizeRecord): { format: number, bytes: Uint8Array } {
  const writer = new BinaryWriter()
  let format = glyph.format
  if (format === 5) format = 7
  if (format === 19) format = 18
  if (format === 1 || format === 2 || format === 17) writeSmallMetrics(writer, glyph.metrics, strike.flags)
  else writeBigMetrics(writer, glyph.metrics)
  if (format === 17 || format === 18) writer.writeUint32(glyph.data.length)
  writer.writeBytes(glyph.data)
  return { format, bytes: writer.toUint8Array() }
}

function buildRuns(glyphs: EncodedGlyph[]): EncodedRun[] {
  const runs: EncodedRun[] = []
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i]!
    const last = runs[runs.length - 1]
    const previous = last?.glyphs[last.glyphs.length - 1]
    if (last !== undefined && last.format === glyph.format && previous !== undefined && previous.glyphId + 1 === glyph.glyphId) {
      last.glyphs.push(glyph)
    } else {
      runs.push({ format: glyph.format, glyphs: [glyph], subtableOffset: 0 })
    }
  }
  return runs
}

function writeBitmapSize(writer: BinaryWriter, strike: EncodedStrike): void {
  const source = strike.source
  writer.writeUint32(strike.listOffset)
  writer.writeUint32(strike.listSize)
  writer.writeUint32(strike.runs.length)
  writer.writeUint32(0)
  writeLineMetrics(writer, source.hori)
  writeLineMetrics(writer, source.vert)
  writer.writeUint16(strike.glyphs[0]!.glyphId)
  writer.writeUint16(strike.glyphs[strike.glyphs.length - 1]!.glyphId)
  writer.writeUint8(source.ppemX)
  writer.writeUint8(source.ppemY)
  writer.writeUint8(source.bitDepth)
  writer.writeUint8(source.flags)
}

function writeIndexSubtableList(writer: BinaryWriter, strike: EncodedStrike): void {
  const listStart = writer.position
  for (let ri = 0; ri < strike.runs.length; ri++) {
    const run = strike.runs[ri]!
    writer.writeUint16(run.glyphs[0]!.glyphId)
    writer.writeUint16(run.glyphs[run.glyphs.length - 1]!.glyphId)
    writer.writeUint32(run.subtableOffset)
  }
  for (let ri = 0; ri < strike.runs.length; ri++) {
    const run = strike.runs[ri]!
    if (writer.position !== listStart + run.subtableOffset) throw new Error('Bitmap subset index layout is inconsistent')
    const base = run.glyphs[0]!.start
    writer.writeUint16(1)
    writer.writeUint16(run.format)
    writer.writeUint32(base)
    for (let gi = 0; gi < run.glyphs.length; gi++) writer.writeUint32(run.glyphs[gi]!.start - base)
    writer.writeUint32(run.glyphs[run.glyphs.length - 1]!.end - base)
  }
}

function subsetEbsc(
  sfnt: SfntData,
  retainedStrikeKeys: ReadonlySet<string>,
  output: Map<string, Uint8Array | null>,
): void {
  const reader = getTableReader(sfnt, 'EBSC')
  if (reader === null) return
  const table = parseEbsc(reader)
  const strikes: EbscStrike[] = []
  for (let i = 0; i < table.strikes.length; i++) {
    const strike = table.strikes[i]!
    if (retainedStrikeKeys.has(`${strike.substitutePpemX}:${strike.substitutePpemY}`)) strikes.push(strike)
  }
  if (strikes.length === 0) {
    output.set('EBSC', null)
    return
  }
  const writer = new BinaryWriter(8 + strikes.length * 28)
  writer.writeInt32(0x00020000)
  writer.writeUint32(strikes.length)
  for (let i = 0; i < strikes.length; i++) {
    const strike = strikes[i]!
    writeEbscLineMetrics(writer, strike.hori)
    writeEbscLineMetrics(writer, strike.vert)
    writer.writeUint8(strike.ppemX)
    writer.writeUint8(strike.ppemY)
    writer.writeUint8(strike.substitutePpemX)
    writer.writeUint8(strike.substitutePpemY)
  }
  output.set('EBSC', writer.toUint8Array())
}

function invertGlyphMapping(oldToNew: ReadonlyMap<number, number>, outputNumGlyphs: number): Int32Array {
  const sourceByNew = new Int32Array(outputNumGlyphs)
  sourceByNew.fill(-1)
  for (const [oldGlyphId, newGlyphId] of oldToNew) {
    if (newGlyphId < 0 || newGlyphId >= outputNumGlyphs) throw new Error(`Subset glyph ID ${newGlyphId} is out of range`)
    sourceByNew[newGlyphId] = oldGlyphId
  }
  return sourceByNew
}

function writeSmallMetrics(writer: BinaryWriter, metrics: BitmapMetrics, flags: 1 | 2 | 3): void {
  writer.writeUint8(metrics.height)
  writer.writeUint8(metrics.width)
  if (flags === 2) {
    writer.writeUint8(metrics.vertBearingY & 0xFF)
    writer.writeUint8(metrics.vertBearingX & 0xFF)
    writer.writeUint8(metrics.vertAdvance)
  } else {
    writer.writeUint8(metrics.horiBearingX & 0xFF)
    writer.writeUint8(metrics.horiBearingY & 0xFF)
    writer.writeUint8(metrics.horiAdvance)
  }
}

function writeBigMetrics(writer: BinaryWriter, metrics: BitmapMetrics): void {
  writer.writeUint8(metrics.height)
  writer.writeUint8(metrics.width)
  writer.writeUint8(metrics.horiBearingX & 0xFF)
  writer.writeUint8(metrics.horiBearingY & 0xFF)
  writer.writeUint8(metrics.horiAdvance)
  writer.writeUint8(metrics.vertBearingX & 0xFF)
  writer.writeUint8(metrics.vertBearingY & 0xFF)
  writer.writeUint8(metrics.vertAdvance)
}

function writeLineMetrics(writer: BinaryWriter, metrics: SbitLineMetrics): void {
  writer.writeUint8(metrics.ascender & 0xFF)
  writer.writeUint8(metrics.descender & 0xFF)
  writer.writeUint8(metrics.widthMax)
  writer.writeUint8(metrics.caretSlopeNumerator & 0xFF)
  writer.writeUint8(metrics.caretSlopeDenominator & 0xFF)
  writer.writeUint8(metrics.caretOffset & 0xFF)
  writer.writeUint8(metrics.minOriginSB & 0xFF)
  writer.writeUint8(metrics.minAdvanceSB & 0xFF)
  writer.writeUint8(metrics.maxBeforeBL & 0xFF)
  writer.writeUint8(metrics.minAfterBL & 0xFF)
  writer.writeUint16(0)
}

function writeEbscLineMetrics(writer: BinaryWriter, metrics: EbscStrike['hori']): void {
  writer.writeUint8(metrics.ascender & 0xFF)
  writer.writeUint8(metrics.descender & 0xFF)
  writer.writeUint8(metrics.widthMax)
  writer.writeUint8(metrics.caretSlopeNumerator & 0xFF)
  writer.writeUint8(metrics.caretSlopeDenominator & 0xFF)
  writer.writeUint8(metrics.caretOffset & 0xFF)
  writer.writeUint8(metrics.minOriginSB & 0xFF)
  writer.writeUint8(metrics.minAdvanceSB & 0xFF)
  writer.writeUint8(metrics.maxBeforeBL & 0xFF)
  writer.writeUint8(metrics.minAfterBL & 0xFF)
  writer.writeUint8(metrics.pad1 & 0xFF)
  writer.writeUint8(metrics.pad2 & 0xFF)
}
