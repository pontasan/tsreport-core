import { BinaryReader } from '../../binary/reader.js'
import { BinaryWriter } from '../../binary/writer.js'
import { parseClassDef, parseCoverage, parseDeviceTable, resolveDeviceDelta, type ParsedDevice } from './otl-common.js'
import {
  parseItemVariationStore,
  getDelta,
  type ItemVariationData,
  type ItemVariationStore,
} from './variation-common.js'

const GDEF_MAJOR_VERSION = 1
const GDEF_MINOR_VERSION_0 = 0
const GDEF_MINOR_VERSION_2 = 2
const GDEF_MINOR_VERSION_3 = 3
const GDEF_HEADER_V1_SIZE = 12
const GDEF_HEADER_V1_2_SIZE = 14
const GDEF_HEADER_V1_3_SIZE = 18
const MARK_GLYPH_SETS_FORMAT = 1
const MARK_GLYPH_SETS_HEADER_SIZE = 4

/**
 * GDEF table: glyph definitions
 * GlyphClassDef, AttachList, LigCaretList, MarkAttachClassDef, MarkGlyphSets
 * and the Item Variation Store (v1.3) used by VariationIndex device tables.
 */

/** GDEF Glyph Class values */
export const enum GlyphClass {
  Base = 1,
  Ligature = 2,
  Mark = 3,
  Component = 4,
}

export interface GdefCaretValue {
  readonly format: 1 | 2 | 3
  readonly coordinate: number
  readonly pointIndex: number | null
  readonly deviceDelta: number
}

export interface ParsedGdefCaretValue {
  readonly format: 1 | 2 | 3
  readonly coordinate: number
  readonly pointIndex: number | null
  readonly device: ParsedDevice | null
}

export interface GdefTable {
  /** Returns the glyph classification (0=unclassified, 1=Base, 2=Ligature, 3=Mark, 4=Component) */
  getGlyphClass(glyphId: number): number

  /** Returns the MarkAttachmentClass (0=unclassified) */
  getMarkAttachClass(glyphId: number): number

  /** MarkGlyphSets: whether the glyph is in the given set */
  isMarkInSet(glyphId: number, setIndex: number): boolean

  /** Number of MarkGlyphSets, preserving lookup filtering-set indices. */
  readonly markGlyphSetCount: number

  /** Contour point indices used by GPOS attachments for a glyph. */
  getAttachmentPointIndices(glyphId: number): readonly number[]

  /** Resolved ligature caret values; format 2 retains its contour point index. */
  getLigatureCaretValues(glyphId: number, ppem?: number, coords?: number[]): readonly GdefCaretValue[] | null

  /**
   * Item Variation Store delta for a VariationIndex device table (v1.3).
   * Returns 0 when the store is absent.
   */
  getVarDelta(outerIndex: number, innerIndex: number, coords: number[]): number

  /** Parsed caret records used when rebuilding a compact GDEF table. */
  getLigatureCaretRecords(glyphId: number): readonly ParsedGdefCaretValue[] | null

  /** Parsed ItemVariationStore used when rebuilding a compact GDEF table. */
  readonly itemVariationStore: ItemVariationStore | null

  /** GDEF version */
  readonly majorVersion: number
  readonly minorVersion: number
}

/**
 * Parses the GDEF table
 */
export function parseGdef(reader: BinaryReader, expectedAxisCount?: number): GdefTable {
  const tableStart = reader.position
  if (reader.length - tableStart < GDEF_HEADER_V1_SIZE) {
    throw new Error(`GDEF table length must be at least ${GDEF_HEADER_V1_SIZE}, got ${reader.length - tableStart}`)
  }

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== GDEF_MAJOR_VERSION) {
    throw new Error(`Unsupported GDEF table version: ${majorVersion}.${minorVersion}`)
  }
  const headerSize = getGdefHeaderSize(minorVersion)
  if (reader.length - tableStart < headerSize) {
    throw new Error(`GDEF table length must be at least ${headerSize}, got ${reader.length - tableStart}`)
  }
  const glyphClassDefOffset = reader.readUint16()
  const attachListOffset = reader.readUint16()
  const ligCaretListOffset = reader.readUint16()
  const markAttachClassDefOffset = reader.readUint16()

  // v1.2+: MarkGlyphSetsDefOffset
  let markGlyphSetsDefOffset = 0
  if (majorVersion === 1 && minorVersion >= 2) {
    markGlyphSetsDefOffset = reader.readUint16()
  }

  // v1.3+: ItemVarStoreOffset (Offset32)
  let itemVarStoreOffset = 0
  if (majorVersion === 1 && minorVersion >= 3) {
    itemVarStoreOffset = reader.readUint32()
  }
  validateGdefOffset(tableStart, glyphClassDefOffset, headerSize, reader.length, 'glyphClassDefOffset', true)
  validateGdefOffset(tableStart, attachListOffset, headerSize, reader.length, 'attachListOffset', true)
  validateGdefOffset(tableStart, ligCaretListOffset, headerSize, reader.length, 'ligCaretListOffset', true)
  validateGdefOffset(tableStart, markAttachClassDefOffset, headerSize, reader.length, 'markAttachClassDefOffset', true)
  validateGdefOffset(tableStart, markGlyphSetsDefOffset, headerSize, reader.length, 'markGlyphSetsDefOffset', true)
  validateGdefOffset(tableStart, itemVarStoreOffset, headerSize, reader.length, 'itemVarStoreOffset', true)
  if (itemVarStoreOffset !== 0 && expectedAxisCount === undefined) {
    throw new Error("GDEF ItemVariationStore requires table 'fvar'")
  }

  // GlyphClassDef
  let glyphClassDef: Map<number, number> | null = null
  if (glyphClassDefOffset !== 0) {
    glyphClassDef = parseClassDef(reader, tableStart + glyphClassDefOffset)
  }

  // MarkAttachClassDef
  let markAttachClassDef: Map<number, number> | null = null
  if (markAttachClassDefOffset !== 0) {
    markAttachClassDef = parseClassDef(reader, tableStart + markAttachClassDefOffset)
  }

  // MarkGlyphSets
  let markGlyphSets: Set<number>[] | null = null
  if (markGlyphSetsDefOffset !== 0) {
    markGlyphSets = parseMarkGlyphSets(reader, tableStart + markGlyphSetsDefOffset)
  }

  const attachmentPoints = attachListOffset === 0
    ? new Map<number, readonly number[]>()
    : parseAttachmentList(reader, tableStart + attachListOffset)
  const ligatureCarets = ligCaretListOffset === 0
    ? new Map<number, readonly ParsedGdefCaretValue[]>()
    : parseLigatureCaretList(reader, tableStart + ligCaretListOffset)

  // Item Variation Store
  let itemVarStore: ItemVariationStore | null = null
  if (itemVarStoreOffset !== 0) {
    itemVarStore = parseItemVariationStore(reader, tableStart + itemVarStoreOffset, expectedAxisCount)
  }

  return {
    majorVersion,
    minorVersion,
    markGlyphSetCount: markGlyphSets?.length ?? 0,
    itemVariationStore: itemVarStore,

    getGlyphClass(glyphId: number): number {
      return glyphClassDef?.get(glyphId) ?? 0
    },

    getMarkAttachClass(glyphId: number): number {
      return markAttachClassDef?.get(glyphId) ?? 0
    },

    isMarkInSet(glyphId: number, setIndex: number): boolean {
      if (!markGlyphSets || setIndex >= markGlyphSets.length) return false
      return markGlyphSets[setIndex]!.has(glyphId)
    },

    getAttachmentPointIndices(glyphId: number): readonly number[] {
      return attachmentPoints.get(glyphId) ?? []
    },

    getLigatureCaretValues(glyphId: number, ppem?: number, coords?: number[]): readonly GdefCaretValue[] | null {
      const values = ligatureCarets.get(glyphId)
      if (values === undefined) return null
      const resolved = new Array<GdefCaretValue>(values.length)
      for (let i = 0; i < values.length; i++) {
        const value = values[i]!
        let coordinate = value.coordinate
        let deviceDelta = 0
        if (value.device !== null) {
          if (value.device.isVariation) {
            if (coords !== undefined && itemVarStore !== null) {
              coordinate += Math.round(getDelta(itemVarStore, value.device.first, value.device.second, coords))
            }
          } else {
            deviceDelta = resolveDeviceDelta(value.device, ppem)
          }
        }
        resolved[i] = { format: value.format, coordinate, pointIndex: value.pointIndex, deviceDelta }
      }
      return resolved
    },

    getLigatureCaretRecords(glyphId: number): readonly ParsedGdefCaretValue[] | null {
      return ligatureCarets.get(glyphId) ?? null
    },

    getVarDelta(outerIndex: number, innerIndex: number, coords: number[]): number {
      if (itemVarStore === null) return 0
      return getDelta(itemVarStore, outerIndex, innerIndex, coords)
    },
  }
}

/** Rebuilds every glyph-indexed GDEF structure for a compact glyph-ID mapping. */
export function buildCompactGdefTable(
  reader: BinaryReader,
  oldToNew: ReadonlyMap<number, number>,
  expectedAxisCount?: number,
  bakeCoords?: readonly number[],
): Uint8Array {
  const gdef = parseGdef(reader, expectedAxisCount)
  const glyphClasses = new Map<number, number>()
  const markAttachClasses = new Map<number, number>()
  const attachmentPoints = new Map<number, readonly number[]>()
  const ligatureCarets = new Map<number, readonly ParsedGdefCaretValue[]>()
  for (const [oldGlyphId, newGlyphId] of oldToNew) {
    const glyphClass = gdef.getGlyphClass(oldGlyphId)
    if (glyphClass !== 0) glyphClasses.set(newGlyphId, glyphClass)
    const markAttachClass = gdef.getMarkAttachClass(oldGlyphId)
    if (markAttachClass !== 0) markAttachClasses.set(newGlyphId, markAttachClass)
    const points = gdef.getAttachmentPointIndices(oldGlyphId)
    if (points.length !== 0) attachmentPoints.set(newGlyphId, points)
    const carets = gdef.getLigatureCaretRecords(oldGlyphId)
    if (carets !== null) ligatureCarets.set(
      newGlyphId,
      bakeCoords === undefined ? carets : bakeGdefCaretValues(carets, gdef.itemVariationStore, bakeCoords),
    )
  }

  const markGlyphSets = new Array<number[]>(gdef.markGlyphSetCount)
  for (let setIndex = 0; setIndex < markGlyphSets.length; setIndex++) {
    const glyphs: number[] = []
    for (const [oldGlyphId, newGlyphId] of oldToNew) {
      if (gdef.isMarkInSet(oldGlyphId, setIndex)) glyphs.push(newGlyphId)
    }
    glyphs.sort(compareNumbers)
    markGlyphSets[setIndex] = glyphs
  }

  const glyphClassData = glyphClasses.size === 0 ? null : serializeGdefClassDef(glyphClasses)
  const attachListData = attachmentPoints.size === 0 ? null : serializeGdefAttachList(attachmentPoints)
  const ligCaretListData = ligatureCarets.size === 0 ? null : serializeGdefLigCaretList(ligatureCarets)
  const markAttachData = markAttachClasses.size === 0 ? null : serializeGdefClassDef(markAttachClasses)
  const markGlyphSetsData = markGlyphSets.length === 0 ? null : serializeGdefMarkGlyphSets(markGlyphSets)
  const itemVariationStoreData = gdef.itemVariationStore === null || bakeCoords !== undefined
    ? null
    : serializeItemVariationStore(gdef.itemVariationStore)

  const headerSize = getGdefHeaderSize(gdef.minorVersion)
  const writer = new BinaryWriter(headerSize + 256)
  writer.writeUint16(gdef.majorVersion)
  writer.writeUint16(gdef.minorVersion)
  const glyphClassOffsetPosition = writer.position
  writer.writeUint16(0)
  const attachListOffsetPosition = writer.position
  writer.writeUint16(0)
  const ligCaretListOffsetPosition = writer.position
  writer.writeUint16(0)
  const markAttachOffsetPosition = writer.position
  writer.writeUint16(0)
  let markGlyphSetsOffsetPosition = -1
  if (gdef.minorVersion >= GDEF_MINOR_VERSION_2) {
    markGlyphSetsOffsetPosition = writer.position
    writer.writeUint16(0)
  }
  let itemVariationStoreOffsetPosition = -1
  if (gdef.minorVersion >= GDEF_MINOR_VERSION_3) {
    itemVariationStoreOffsetPosition = writer.position
    writer.writeUint32(0)
  }
  appendGdefOffset16(writer, glyphClassOffsetPosition, glyphClassData, 'GlyphClassDef')
  appendGdefOffset16(writer, attachListOffsetPosition, attachListData, 'AttachList')
  appendGdefOffset16(writer, ligCaretListOffsetPosition, ligCaretListData, 'LigCaretList')
  appendGdefOffset16(writer, markAttachOffsetPosition, markAttachData, 'MarkAttachClassDef')
  if (markGlyphSetsOffsetPosition >= 0) {
    appendGdefOffset16(writer, markGlyphSetsOffsetPosition, markGlyphSetsData, 'MarkGlyphSetsDef')
  }
  if (itemVariationStoreOffsetPosition >= 0 && itemVariationStoreData !== null) {
    const offset = writer.position
    patchUint32(writer, itemVariationStoreOffsetPosition, offset)
    writer.writeBytes(itemVariationStoreData)
  }
  return writer.toUint8Array()
}

function bakeGdefCaretValues(
  carets: readonly ParsedGdefCaretValue[],
  store: ItemVariationStore | null,
  coords: readonly number[],
): ParsedGdefCaretValue[] {
  const baked = new Array<ParsedGdefCaretValue>(carets.length)
  const normalizedCoords = [...coords]
  for (let i = 0; i < carets.length; i++) {
    const caret = carets[i]!
    if (caret.format === 3 && caret.device?.isVariation === true) {
      const delta = store === null ? 0 : getDelta(store, caret.device.first, caret.device.second, normalizedCoords)
      baked[i] = { format: 3, coordinate: caret.coordinate + delta, pointIndex: null, device: null }
    } else {
      baked[i] = caret
    }
  }
  return baked
}

function appendGdefOffset16(
  writer: BinaryWriter,
  offsetPosition: number,
  data: Uint8Array | null,
  label: string,
): void {
  if (data === null) return
  const offset = writer.position
  if (offset > 0xFFFF) throw new Error(`GDEF ${label} offset exceeds Offset16 range: ${offset}`)
  patchUint16(writer, offsetPosition, offset)
  writer.writeBytes(data)
}

function patchUint16(writer: BinaryWriter, position: number, value: number): void {
  const end = writer.position
  writer.position = position
  writer.writeUint16(value)
  writer.position = end
}

function patchUint32(writer: BinaryWriter, position: number, value: number): void {
  const end = writer.position
  writer.position = position
  writer.writeUint32(value)
  writer.position = end
}

function serializeGdefClassDef(classes: ReadonlyMap<number, number>): Uint8Array {
  const entries = [...classes].sort(compareGlyphEntries)
  const ranges: Array<{ start: number, end: number, glyphClass: number }> = []
  for (let i = 0; i < entries.length; i++) {
    const [glyphId, glyphClass] = entries[i]!
    const previous = ranges[ranges.length - 1]
    if (previous !== undefined && previous.end + 1 === glyphId && previous.glyphClass === glyphClass) {
      previous.end = glyphId
    } else {
      ranges.push({ start: glyphId, end: glyphId, glyphClass })
    }
  }
  const writer = new BinaryWriter(4 + ranges.length * 6)
  writer.writeUint16(2)
  writer.writeUint16(ranges.length)
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!
    writer.writeUint16(range.start)
    writer.writeUint16(range.end)
    writer.writeUint16(range.glyphClass)
  }
  return writer.toUint8Array()
}

function serializeGdefAttachList(pointsByGlyph: ReadonlyMap<number, readonly number[]>): Uint8Array {
  const entries = [...pointsByGlyph].sort(compareGlyphEntries)
  const writer = new BinaryWriter()
  writer.writeUint16(0)
  writer.writeUint16(entries.length)
  const offsetsPosition = writer.position
  for (let i = 0; i < entries.length; i++) writer.writeUint16(0)
  for (let i = 0; i < entries.length; i++) {
    const offset = writer.position
    if (offset > 0xFFFF) throw new Error(`GDEF AttachPoint offset exceeds Offset16 range: ${offset}`)
    patchUint16(writer, offsetsPosition + i * 2, offset)
    const points = entries[i]![1]
    writer.writeUint16(points.length)
    for (let point = 0; point < points.length; point++) writer.writeUint16(points[point]!)
  }
  const coverageOffset = writer.position
  if (coverageOffset > 0xFFFF) throw new Error(`GDEF AttachList coverage offset exceeds Offset16 range: ${coverageOffset}`)
  patchUint16(writer, 0, coverageOffset)
  writer.writeBytes(serializeGdefCoverage(entries.map(glyphEntryId)))
  return writer.toUint8Array()
}

function serializeGdefLigCaretList(
  caretsByGlyph: ReadonlyMap<number, readonly ParsedGdefCaretValue[]>,
): Uint8Array {
  const entries = [...caretsByGlyph].sort(compareGlyphEntries)
  const writer = new BinaryWriter()
  writer.writeUint16(0)
  writer.writeUint16(entries.length)
  const offsetsPosition = writer.position
  for (let i = 0; i < entries.length; i++) writer.writeUint16(0)
  for (let i = 0; i < entries.length; i++) {
    const ligGlyphOffset = writer.position
    if (ligGlyphOffset > 0xFFFF) throw new Error(`GDEF LigGlyph offset exceeds Offset16 range: ${ligGlyphOffset}`)
    patchUint16(writer, offsetsPosition + i * 2, ligGlyphOffset)
    const carets = entries[i]![1]
    writer.writeUint16(carets.length)
    const caretOffsetsPosition = writer.position
    for (let caret = 0; caret < carets.length; caret++) writer.writeUint16(0)
    for (let caret = 0; caret < carets.length; caret++) {
      const caretOffset = writer.position - ligGlyphOffset
      if (caretOffset > 0xFFFF) throw new Error(`GDEF CaretValue offset exceeds Offset16 range: ${caretOffset}`)
      patchUint16(writer, caretOffsetsPosition + caret * 2, caretOffset)
      writer.writeBytes(serializeGdefCaretValue(carets[caret]!))
    }
  }
  const coverageOffset = writer.position
  if (coverageOffset > 0xFFFF) throw new Error(`GDEF LigCaretList coverage offset exceeds Offset16 range: ${coverageOffset}`)
  patchUint16(writer, 0, coverageOffset)
  writer.writeBytes(serializeGdefCoverage(entries.map(glyphEntryId)))
  return writer.toUint8Array()
}

function serializeGdefCaretValue(caret: ParsedGdefCaretValue): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(caret.format)
  if (caret.format === 1) {
    writer.writeInt16(caret.coordinate)
  } else if (caret.format === 2) {
    writer.writeUint16(caret.pointIndex!)
  } else {
    writer.writeInt16(caret.coordinate)
    if (caret.device === null) {
      writer.writeUint16(0)
    } else {
      writer.writeUint16(6)
      writer.writeBytes(serializeGdefDevice(caret.device))
    }
  }
  return writer.toUint8Array()
}

function serializeGdefDevice(device: ParsedDevice): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(device.first)
  writer.writeUint16(device.second)
  writer.writeUint16(device.deltaFormat)
  if (device.words !== null) {
    for (let i = 0; i < device.words.length; i++) writer.writeUint16(device.words[i]!)
  }
  return writer.toUint8Array()
}

function serializeGdefMarkGlyphSets(markGlyphSets: readonly number[][]): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(MARK_GLYPH_SETS_FORMAT)
  writer.writeUint16(markGlyphSets.length)
  const offsetsPosition = writer.position
  for (let i = 0; i < markGlyphSets.length; i++) writer.writeUint32(0)
  for (let i = 0; i < markGlyphSets.length; i++) {
    patchUint32(writer, offsetsPosition + i * 4, writer.position)
    writer.writeBytes(serializeGdefCoverage(markGlyphSets[i]!))
  }
  return writer.toUint8Array()
}

function serializeGdefCoverage(glyphs: readonly number[]): Uint8Array {
  const writer = new BinaryWriter(4 + glyphs.length * 2)
  writer.writeUint16(1)
  writer.writeUint16(glyphs.length)
  for (let i = 0; i < glyphs.length; i++) writer.writeUint16(glyphs[i]!)
  return writer.toUint8Array()
}

function serializeItemVariationStore(store: ItemVariationStore): Uint8Array {
  const dataTables = new Array<Uint8Array | null>(store.data.length)
  for (let i = 0; i < store.data.length; i++) {
    const data = store.data[i]!
    dataTables[i] = data.regionIndices.length === 0 && data.deltaSets.length === 0
      ? null
      : serializeItemVariationData(data)
  }
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const regionListOffsetPosition = writer.position
  writer.writeUint32(0)
  writer.writeUint16(dataTables.length)
  const dataOffsetsPosition = writer.position
  for (let i = 0; i < dataTables.length; i++) writer.writeUint32(0)
  patchUint32(writer, regionListOffsetPosition, writer.position)
  writer.writeBytes(serializeVariationRegionList(store))
  for (let i = 0; i < dataTables.length; i++) {
    const data = dataTables[i]
    if (data === null || data === undefined) continue
    patchUint32(writer, dataOffsetsPosition + i * 4, writer.position)
    writer.writeBytes(data)
  }
  return writer.toUint8Array()
}

function serializeVariationRegionList(store: ItemVariationStore): Uint8Array {
  const axisCount = store.axisCount ?? store.regions[0]?.axes.length ?? 0
  const writer = new BinaryWriter()
  writer.writeUint16(axisCount)
  writer.writeUint16(store.regions.length)
  for (let region = 0; region < store.regions.length; region++) {
    const axes = store.regions[region]!.axes
    for (let axis = 0; axis < axes.length; axis++) {
      const coordinates = axes[axis]!
      writer.writeInt16(Math.round(coordinates.startCoord * 16384))
      writer.writeInt16(Math.round(coordinates.peakCoord * 16384))
      writer.writeInt16(Math.round(coordinates.endCoord * 16384))
    }
  }
  return writer.toUint8Array()
}

function serializeItemVariationData(data: ItemVariationData): Uint8Array {
  const columnCount = data.regionIndices.length
  let longWords = false
  for (let row = 0; row < data.deltaSets.length && !longWords; row++) {
    const deltas = data.deltaSets[row]!
    for (let column = 0; column < columnCount; column++) {
      const delta = deltas[column]!
      if (delta < -32768 || delta > 32767) {
        longWords = true
        break
      }
    }
  }
  const wideColumns: number[] = []
  const narrowColumns: number[] = []
  for (let column = 0; column < columnCount; column++) {
    let wide = false
    for (let row = 0; row < data.deltaSets.length; row++) {
      const delta = data.deltaSets[row]![column]!
      if (longWords ? delta < -32768 || delta > 32767 : delta < -128 || delta > 127) {
        wide = true
        break
      }
    }
    if (wide) wideColumns.push(column)
    else narrowColumns.push(column)
  }
  const columns = wideColumns.concat(narrowColumns)
  const writer = new BinaryWriter()
  writer.writeUint16(data.deltaSets.length)
  writer.writeUint16((longWords ? 0x8000 : 0) | wideColumns.length)
  writer.writeUint16(columnCount)
  for (let i = 0; i < columns.length; i++) writer.writeUint16(data.regionIndices[columns[i]!]!)
  for (let row = 0; row < data.deltaSets.length; row++) {
    const deltas = data.deltaSets[row]!
    for (let orderedColumn = 0; orderedColumn < columns.length; orderedColumn++) {
      const delta = deltas[columns[orderedColumn]!]!
      if (orderedColumn < wideColumns.length) {
        if (longWords) writer.writeInt32(delta)
        else writer.writeInt16(delta)
      } else if (longWords) {
        writer.writeInt16(delta)
      } else {
        writer.writeUint8(delta & 0xFF)
      }
    }
  }
  return writer.toUint8Array()
}

function compareNumbers(a: number, b: number): number {
  return a - b
}

function compareGlyphEntries(a: readonly [number, unknown], b: readonly [number, unknown]): number {
  return a[0] - b[0]
}

function glyphEntryId(entry: readonly [number, unknown]): number {
  return entry[0]
}

function parseAttachmentList(reader: BinaryReader, offset: number): Map<number, readonly number[]> {
  ensureRange(offset, 4, reader.length, 'GDEF AttachList header')
  reader.seek(offset)
  const coverageOffset = reader.readUint16()
  const glyphCount = reader.readUint16()
  ensureRange(reader.position, glyphCount * 2, reader.length, 'GDEF AttachList offsets')
  const minimumSubtableOffset = 4 + glyphCount * 2
  const offsets = new Array<number>(glyphCount)
  for (let i = 0; i < glyphCount; i++) {
    offsets[i] = reader.readUint16()
    validateGdefSubtableOffset(offset, offsets[i]!, minimumSubtableOffset, reader.length, `AttachPoint offset ${i}`)
  }
  validateGdefSubtableOffset(offset, coverageOffset, minimumSubtableOffset, reader.length, 'AttachList coverageOffset')
  const coverage = parseCoverage(reader, offset + coverageOffset)
  if (coverage.length !== glyphCount) {
    throw new Error(`GDEF AttachList glyphCount ${glyphCount} must match coverage glyph count ${coverage.length}`)
  }
  const result = new Map<number, readonly number[]>()
  for (let i = 0; i < glyphCount; i++) {
    const pointOffset = offset + offsets[i]!
    ensureRange(pointOffset, 2, reader.length, `GDEF AttachPoint ${i} header`)
    reader.seek(pointOffset)
    const pointCount = reader.readUint16()
    ensureRange(reader.position, pointCount * 2, reader.length, `GDEF AttachPoint ${i} indices`)
    const points = new Array<number>(pointCount)
    for (let point = 0; point < pointCount; point++) {
      points[point] = reader.readUint16()
    }
    result.set(coverage[i]!, points)
  }
  return result
}

function parseLigatureCaretList(reader: BinaryReader, offset: number): Map<number, readonly ParsedGdefCaretValue[]> {
  ensureRange(offset, 4, reader.length, 'GDEF LigCaretList header')
  reader.seek(offset)
  const coverageOffset = reader.readUint16()
  const ligGlyphCount = reader.readUint16()
  ensureRange(reader.position, ligGlyphCount * 2, reader.length, 'GDEF LigCaretList offsets')
  const minimumSubtableOffset = 4 + ligGlyphCount * 2
  const offsets = new Array<number>(ligGlyphCount)
  for (let i = 0; i < ligGlyphCount; i++) {
    offsets[i] = reader.readUint16()
    validateGdefSubtableOffset(offset, offsets[i]!, minimumSubtableOffset, reader.length, `LigGlyph offset ${i}`)
  }
  validateGdefSubtableOffset(offset, coverageOffset, minimumSubtableOffset, reader.length, 'LigCaretList coverageOffset')
  const coverage = parseCoverage(reader, offset + coverageOffset)
  if (coverage.length !== ligGlyphCount) {
    throw new Error(`GDEF LigCaretList ligGlyphCount ${ligGlyphCount} must match coverage glyph count ${coverage.length}`)
  }
  const result = new Map<number, readonly ParsedGdefCaretValue[]>()
  for (let i = 0; i < ligGlyphCount; i++) {
    const ligOffset = offset + offsets[i]!
    ensureRange(ligOffset, 2, reader.length, `GDEF LigGlyph ${i} header`)
    reader.seek(ligOffset)
    const caretCount = reader.readUint16()
    ensureRange(reader.position, caretCount * 2, reader.length, `GDEF LigGlyph ${i} caret offsets`)
    const caretOffsets = new Array<number>(caretCount)
    const minimumCaretOffset = 2 + caretCount * 2
    for (let caret = 0; caret < caretCount; caret++) {
      caretOffsets[caret] = reader.readUint16()
      validateGdefSubtableOffset(ligOffset, caretOffsets[caret]!, minimumCaretOffset, reader.length, `LigGlyph ${i} caret offset ${caret}`)
    }
    const values = new Array<ParsedGdefCaretValue>(caretCount)
    for (let caret = 0; caret < caretCount; caret++) {
      values[caret] = parseCaretValue(reader, ligOffset + caretOffsets[caret]!, i, caret)
    }
    result.set(coverage[i]!, values)
  }
  return result
}

function parseCaretValue(reader: BinaryReader, offset: number, ligatureIndex: number, caretIndex: number): ParsedGdefCaretValue {
  ensureRange(offset, 2, reader.length, `GDEF LigGlyph ${ligatureIndex} caret ${caretIndex}`)
  reader.seek(offset)
  const format = reader.readUint16()
  if (format === 1) {
    ensureRange(reader.position, 2, reader.length, `GDEF CaretValue format 1`)
    return { format, coordinate: reader.readInt16(), pointIndex: null, device: null }
  }
  if (format === 2) {
    ensureRange(reader.position, 2, reader.length, `GDEF CaretValue format 2`)
    return { format, coordinate: 0, pointIndex: reader.readUint16(), device: null }
  }
  if (format === 3) {
    ensureRange(reader.position, 4, reader.length, `GDEF CaretValue format 3`)
    const coordinate = reader.readInt16()
    const deviceOffset = reader.readUint16()
    const device = deviceOffset === 0 ? null : parseDeviceTable(reader, offset + deviceOffset)
    return { format, coordinate, pointIndex: null, device }
  }
  throw new Error(`Unsupported GDEF CaretValue format: ${format}`)
}

function validateGdefSubtableOffset(base: number, relative: number, minimum: number, tableLength: number, label: string): void {
  if (relative < minimum || base + relative >= tableLength) {
    throw new Error(`GDEF ${label} exceeds table length: ${relative}`)
  }
}

function parseMarkGlyphSets(reader: BinaryReader, offset: number): Set<number>[] {
  ensureRange(offset, MARK_GLYPH_SETS_HEADER_SIZE, reader.length, 'GDEF MarkGlyphSets header')
  reader.seek(offset)
  const format = reader.readUint16()
  if (format !== MARK_GLYPH_SETS_FORMAT) {
    throw new Error(`GDEF MarkGlyphSets format must be ${MARK_GLYPH_SETS_FORMAT}, got ${format}`)
  }
  const markGlyphSetCount = reader.readUint16()
  ensureRange(reader.position, markGlyphSetCount * 4, reader.length, 'GDEF MarkGlyphSets coverage offsets')
  const coverageArrayEnd = MARK_GLYPH_SETS_HEADER_SIZE + markGlyphSetCount * 4
  const setOffsets: number[] = []
  for (let i = 0; i < markGlyphSetCount; i++) {
    const setOffset = reader.readUint32()
    if (setOffset < coverageArrayEnd || offset + setOffset >= reader.length) {
      throw new Error(`GDEF MarkGlyphSets coverage offset ${i} exceeds table length: ${setOffset}`)
    }
    setOffsets.push(setOffset)
  }

  const sets: Set<number>[] = []
  for (const setOffset of setOffsets) {
    const glyphSet = new Set<number>()
    for (const glyph of parseCoverage(reader, offset + setOffset)) {
      glyphSet.add(glyph)
    }
    sets.push(glyphSet)
  }

  return sets
}

function getGdefHeaderSize(minorVersion: number): number {
  if (minorVersion < GDEF_MINOR_VERSION_2) return GDEF_HEADER_V1_SIZE
  if (minorVersion < GDEF_MINOR_VERSION_3) return GDEF_HEADER_V1_2_SIZE
  return GDEF_HEADER_V1_3_SIZE
}

function validateGdefOffset(tableStart: number, offset: number, headerSize: number, tableLength: number, label: string, nullable: boolean): void {
  if (offset === 0) {
    if (nullable) return
    throw new Error(`GDEF ${label} must be non-zero`)
  }
  if (offset < headerSize || tableStart + offset >= tableLength) {
    throw new Error(`GDEF ${label} exceeds table length: ${offset}`)
  }
}

function ensureRange(offset: number, length: number, tableLength: number, label: string): void {
  if (offset < 0 || length < 0 || offset > tableLength || length > tableLength - offset) {
    throw new Error(`${label} exceeds table length`)
  }
}
