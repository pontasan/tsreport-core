import { BinaryReader } from '../../binary/reader.js'
import { parseExtendedStateTable, parseAatLookupTable, type AatStateBoundary, type AatStateTable } from './aat-common.js'

const KERX_HEADER_SIZE = 8
const KERX_SUBTABLE_HEADER_SIZE = 12
const KERX_COVERAGE_RESERVED_MASK = 0x0FFFFF00
const KERX_COVERAGE_FORMAT_MASK = 0x000000FF
const KERX_PAIR_SIZE = 6

/**
 * kerx table: Extended Kerning (Apple Advanced Typography)
 *
 * Header: version(2) + padding(2) + nTables(4)
 * Subtable header: length(4) + coverage(4) + tupleCount(4)
 * Coverage: 0x80000000 vertical, 0x40000000 crossStream, 0x20000000 variation,
 *           0x10000000 processDirection, low byte = format (0/1/2/4/6)
 */

export interface KerxSubtableInfo {
  readonly format: number
  readonly vertical: boolean
  readonly crossStream: boolean
  readonly variation: boolean
  readonly processBackwards: boolean
  readonly tupleCount: number
}

/** Attachment produced by a format 4 (control/anchor point) subtable */
export interface KerxAttachment {
  /** Index in the input glyph run of the marked glyph */
  readonly markIndex: number
  /** Index in the input glyph run of the current (attaching) glyph */
  readonly currentIndex: number
  /** 0 = control points, 1 = anchor points, 2 = coordinates */
  readonly actionType: number
  /**
   * Action values:
   * - type 0: [markControlPoint, currControlPoint]
   * - type 1: [markAnchorPoint, currAnchorPoint]
   * - type 2: [markX, markY, currX, currY]
   */
  readonly values: readonly number[]
}

export interface KerxTable {
  readonly version: number
  readonly subtables: readonly KerxSubtableInfo[]
  /** Semantic subtable payloads retained for glyph-ID-safe rebuilding. */
  readonly subsetData: readonly KerxSubsetSubtable[]
  readonly subsetGlyphCoverage: readonly (Uint8Array | null)[]
  /** Pair kerning from format 0/2/6 horizontal subtables (font units) */
  getKerning(leftGlyphId: number, rightGlyphId: number, tupleScalars?: readonly number[]): number
  /** Resolves pair kerning for the selected text direction. */
  getPairAdjustment(
    leftGlyphId: number,
    rightGlyphId: number,
    direction: 'horizontal' | 'vertical',
    tupleScalars?: readonly number[],
  ): { advance: number, crossStream: number | null }
  /**
   * Contextual kerning (format 1 state machine subtables, horizontal non-cross-stream).
   * Returns one x-advance adjustment per input glyph position (font units).
   */
  applyContextualKerning(glyphIds: number[], tupleScalars?: readonly number[], boundary?: AatStateBoundary): number[]
  /** Runs all applicable format-1 subtables for the selected text direction. */
  applyContextualPositioning(
    glyphIds: number[],
    direction: 'horizontal' | 'vertical',
    tupleScalars?: readonly number[],
    boundary?: AatStateBoundary,
  ): KerxPositioning
  /** Runs format 4 subtables over the glyph run and returns all attachment actions */
  getAttachments(glyphIds: number[], direction?: 'horizontal' | 'vertical', boundary?: AatStateBoundary): KerxAttachment[]
}

export interface KerxPositioning {
  readonly xAdvance: number[]
  readonly yAdvance: number[]
  readonly xOffset: number[]
  readonly yOffset: number[]
}

/** Entry flag: push the glyph position onto the kerning stack (format 1) */
const KERX_PUSH = 0x8000
/** Entry flag: don't advance to the next glyph */
const KERX_DONT_ADVANCE = 0x4000
/** Entry flag: reset the kerning stack (format 1) */
const KERX_RESET = 0x2000
/** Entry flag: mark the current glyph (format 4) */
const KERX_MARK = 0x8000

export interface KerxFormat1Data {
  stateTable: AatStateTable
  /** Absolute reader position of the kerning value array */
  valueTableStart: number
  tupleCount: number
  /** Subtable start (for tuple vector resolution) */
  subtableStart: number
  subtableEnd: number
  processBackwards: boolean
  vertical: boolean
  crossStream: boolean
  subtableIndex: number
  valueData: Uint8Array
}

export interface KerxFormat0Data {
  pairs: Map<number, number>
  tupleCount: number
  subtableStart: number
  subtableEnd: number
  vertical: boolean
  crossStream: boolean
  subtableIndex: number
  tupleVectors: ReadonlyMap<number, readonly number[]>
}

export interface KerxFormat2Data {
  leftClasses: Map<number, number>
  rightClasses: Map<number, number>
  /** Absolute reader position of the kerning array */
  arrayStart: number
  /** Absolute reader position just past the subtable (array bound) */
  subtableEnd: number
  tupleCount: number
  subtableStart: number
  vertical: boolean
  crossStream: boolean
  subtableIndex: number
  arrayData: Uint8Array
}

export interface KerxFormat4Data {
  stateTable: AatStateTable
  /** 0 = control points, 1 = anchor points, 2 = coordinates */
  actionType: number
  /** Absolute reader position of the control point action table */
  controlTableStart: number
  processBackwards: boolean
  vertical: boolean
  subtableIndex: number
  subtableEnd: number
  controlData: Uint8Array
}

export interface KerxFormat6Data {
  rowIndices: Map<number, number>
  columnIndices: Map<number, number>
  arrayStart: number
  valuesAreLong: boolean
  tupleCount: number
  /** Absolute reader position of the kerning vector area (tupleCount > 0) */
  vectorStart: number
  subtableEnd: number
  vertical: boolean
  crossStream: boolean
  rowCount: number
  columnCount: number
  subtableIndex: number
  arrayData: Uint8Array
  vectorData: Uint8Array
}

export type KerxSubsetSubtable = KerxFormat0Data | KerxFormat1Data | KerxFormat2Data | KerxFormat4Data | KerxFormat6Data

/** Resolves a kerning vector against gvar global-tuple support scalars. */
function resolveTupleVector(
  reader: BinaryReader,
  vectorPos: number,
  tupleCount: number,
  tupleScalars: readonly number[] | undefined,
  limit: number,
): number {
  if (tupleCount < 1) throw new Error('kerx tuple vector requires a positive tupleCount')
  if (vectorPos < 0 || vectorPos + tupleCount * 2 > limit) {
    throw new Error('kerx tuple vector exceeds subtable length')
  }
  let value = reader.getInt16At(vectorPos)
  if (tupleScalars === undefined) return value
  const deltaCount = tupleCount - 1
  if (deltaCount > tupleScalars.length) {
    throw new Error(`kerx tuple vector requires ${deltaCount} gvar global tuples, got ${tupleScalars.length}`)
  }
  for (let i = 0; i < deltaCount; i++) {
    value += reader.getInt16At(vectorPos + (i + 1) * 2) * tupleScalars[i]!
  }
  return Math.trunc(value)
}

function getFormat0SearchValues(nPairs: number): {
  searchRange: number
  entrySelector: number
  rangeShift: number
} {
  if (nPairs === 0) return { searchRange: 0, entrySelector: 0, rangeShift: 0 }
  let power = 1
  let entrySelector = 0
  while (power * 2 <= nPairs) {
    power *= 2
    entrySelector++
  }
  return {
    searchRange: power * KERX_PAIR_SIZE,
    entrySelector,
    rangeShift: (nPairs - power) * KERX_PAIR_SIZE,
  }
}

function parseKerxFormat0(
  reader: BinaryReader,
  subtableStart: number,
  subtableEnd: number,
  tupleCount: number,
  vertical: boolean,
  crossStream: boolean,
  subtableIndex: number,
  numGlyphs?: number,
): KerxFormat0Data {
  const pairs = new Map<number, number>()
  if (subtableStart + 28 > subtableEnd) throw new Error('kerx format 0 header exceeds subtable length')
  reader.seek(subtableStart + 12)
  const nPairs = reader.readUint32()
  const searchRange = reader.readUint32()
  const entrySelector = reader.readUint32()
  const rangeShift = reader.readUint32()
  const expected = getFormat0SearchValues(nPairs)
  if (searchRange !== expected.searchRange
    || entrySelector !== expected.entrySelector
    || rangeShift !== expected.rangeShift) {
    throw new Error(
      `kerx format 0 search header mismatch: expected ${expected.searchRange}/${expected.entrySelector}/${expected.rangeShift}, got ${searchRange}/${entrySelector}/${rangeShift}`,
    )
  }
  if (reader.position + nPairs * KERX_PAIR_SIZE > subtableEnd) {
    throw new Error('kerx format 0 pair array exceeds subtable length')
  }

  for (let i = 0; i < nPairs; i++) {
    const left = reader.readUint16()
    const right = reader.readUint16()
    const value = reader.readInt16()
    if (left === 0xFFFF && right === 0xFFFF) break // sentinel
    if (numGlyphs !== undefined && (left >= numGlyphs || right >= numGlyphs)) {
      throw new Error(`kerx format 0 pair ${i} glyph ID exceeds numGlyphs ${numGlyphs}`)
    }
    const key = (left << 16) | right
    pairs.set(key, value)
  }
  const tupleVectors = new Map<number, readonly number[]>()
  if (tupleCount > 0) {
    for (const [key, offset] of pairs) {
      const position = subtableStart + (offset & 0xFFFF)
      if (position < subtableStart || position + tupleCount * 2 > subtableEnd) {
        throw new Error('kerx format 0 tuple vector exceeds subtable length')
      }
      const values = new Array<number>(tupleCount)
      for (let i = 0; i < tupleCount; i++) values[i] = reader.getInt16At(position + i * 2)
      tupleVectors.set(key, values)
    }
  }
  return { pairs, tupleCount, subtableStart, subtableEnd, vertical, crossStream, subtableIndex, tupleVectors }
}

function parseKerxFormat1(
  reader: BinaryReader,
  subtableStart: number,
  subtableEnd: number,
  tupleCount: number,
  processBackwards: boolean,
  vertical: boolean,
  crossStream: boolean,
  subtableIndex: number,
  numGlyphs?: number,
): KerxFormat1Data {
  // Extended state table header starts right after the 12-byte subtable header
  const stHeaderStart = subtableStart + 12
  const stateReader = reader.subReader(stHeaderStart, subtableEnd - stHeaderStart)
  const stateTable = parseExtendedStateTable(stateReader, 0, 1, numGlyphs)
  // valueTable offset (uint32) follows the 16-byte state table header,
  // relative to the state table header start
  const valueTableOffset = stateReader.getUint32At(16)
  if (valueTableOffset < 20 || stHeaderStart + valueTableOffset > subtableEnd) {
    throw new Error('kerx format 1 value table offset exceeds subtable length')
  }
  return {
    stateTable,
    valueTableStart: stHeaderStart + valueTableOffset,
    tupleCount,
    subtableStart,
    subtableEnd,
    processBackwards,
    vertical,
    crossStream,
    subtableIndex,
    valueData: copyReaderRange(reader, stHeaderStart + valueTableOffset, subtableEnd),
  }
}

function parseKerxFormat2(
  reader: BinaryReader,
  subtableStart: number,
  subtableEnd: number,
  tupleCount: number,
  vertical: boolean,
  crossStream: boolean,
  subtableIndex: number,
  numGlyphs?: number,
): KerxFormat2Data {
  const subtableReader = reader.subReader(subtableStart, subtableEnd - subtableStart)
  subtableReader.seek(12)
  const rowWidth = subtableReader.readUint32()
  const leftOffsetTable = subtableReader.readUint32()
  const rightOffsetTable = subtableReader.readUint32()
  const arrayOffset = subtableReader.readUint32()
  if (rowWidth === 0 || (rowWidth & 1) !== 0) throw new Error('kerx format 2 rowWidth must be a positive even value')
  if (leftOffsetTable < 28 || rightOffsetTable < 28 || arrayOffset < 28
    || leftOffsetTable >= subtableReader.length || rightOffsetTable >= subtableReader.length
    || arrayOffset >= subtableReader.length) {
    throw new Error('kerx format 2 offset exceeds subtable length')
  }

  // Left/right class tables are AAT lookup tables returning per-glyph class
  // values that are summed into a flat element (FWORD) index into the kerning
  // array (see getFormat2Kerning), matching HarfBuzz's kerx handling.
  const leftClasses = parseAatLookupTable(subtableReader, leftOffsetTable, numGlyphs)
  const rightClasses = parseAatLookupTable(subtableReader, rightOffsetTable, numGlyphs)

  return {
    leftClasses,
    rightClasses,
    arrayStart: subtableStart + arrayOffset,
    subtableEnd,
    tupleCount,
    subtableStart,
    vertical,
    crossStream,
    subtableIndex,
    arrayData: copyReaderRange(reader, subtableStart + arrayOffset, subtableEnd),
  }
}

function parseKerxFormat4(
  reader: BinaryReader,
  subtableStart: number,
  subtableEnd: number,
  processBackwards: boolean,
  vertical: boolean,
  subtableIndex: number,
  numGlyphs?: number,
): KerxFormat4Data {
  const stHeaderStart = subtableStart + 12
  const stateReader = reader.subReader(stHeaderStart, subtableEnd - stHeaderStart)
  const stateTable = parseExtendedStateTable(stateReader, 0, 1, numGlyphs)
  // flags (uint32) follows the 16-byte state table header
  const flags = stateReader.getUint32At(16)
  if ((flags & 0x3F000000) !== 0) {
    throw new Error('kerx format 4 flags reserved bits must be zero')
  }
  const actionType = (flags >>> 30) & 0x03
  if (actionType === 3) throw new Error('kerx format 4 action type 3 is reserved')
  const controlPointOffset = flags & 0x00FFFFFF
  const controlTableStart = stHeaderStart + controlPointOffset
  if (controlTableStart < stHeaderStart + 20 || controlTableStart > subtableEnd) {
    throw new Error('kerx format 4 control point table offset exceeds subtable length')
  }
  return {
    stateTable,
    actionType,
    controlTableStart,
    processBackwards,
    vertical,
    subtableIndex,
    subtableEnd,
    controlData: copyReaderRange(reader, controlTableStart, subtableEnd),
  }
}

function parseKerxFormat6(
  reader: BinaryReader,
  subtableStart: number,
  tupleCount: number,
  subtableEnd: number,
  vertical: boolean,
  crossStream: boolean,
  subtableIndex: number,
  numGlyphs?: number,
): KerxFormat6Data {
  const subtableReader = reader.subReader(subtableStart, subtableEnd - subtableStart)
  subtableReader.seek(12)
  const flags = subtableReader.readUint32()
  if ((flags & 0xFFFFFFFE) !== 0) throw new Error('kerx format 6 flags reserved bits must be zero')
  const rowCount = subtableReader.readUint16()
  const columnCount = subtableReader.readUint16()
  if (rowCount === 0 || columnCount === 0) throw new Error('kerx format 6 rowCount and columnCount must be positive')
  const rowIndexTableOffset = subtableReader.readUint32()
  const columnIndexTableOffset = subtableReader.readUint32()
  const kerningArrayOffset = subtableReader.readUint32()
  const kerningVectorOffset = tupleCount > 0 ? subtableReader.readUint32() : 0
  const valuesAreLong = (flags & 0x00000001) !== 0

  const indexSize = valuesAreLong ? 4 : 2
  const headerLength = tupleCount > 0 ? 36 : 32
  if (rowIndexTableOffset < headerLength || columnIndexTableOffset < headerLength
    || kerningArrayOffset < headerLength
    || rowIndexTableOffset >= subtableReader.length || columnIndexTableOffset >= subtableReader.length) {
    throw new Error('kerx format 6 offset exceeds subtable length')
  }
  const arrayLength = rowCount * columnCount * indexSize
  if (kerningArrayOffset + arrayLength > subtableReader.length) {
    throw new Error('kerx format 6 kerning array exceeds subtable length')
  }
  if (tupleCount > 0 && (kerningVectorOffset < headerLength || kerningVectorOffset >= subtableReader.length)) {
    throw new Error('kerx format 6 kerning vector offset exceeds subtable length')
  }
  const rowIndices = parseAatLookupTable(subtableReader, rowIndexTableOffset, numGlyphs, indexSize)
  const columnIndices = parseAatLookupTable(subtableReader, columnIndexTableOffset, numGlyphs, indexSize)

  const arrayStart = subtableStart + kerningArrayOffset
  const vectorStart = tupleCount > 0 ? subtableStart + kerningVectorOffset : subtableEnd
  return {
    rowIndices,
    columnIndices,
    arrayStart,
    valuesAreLong,
    tupleCount,
    vectorStart: subtableStart + kerningVectorOffset,
    subtableEnd,
    vertical,
    crossStream,
    rowCount,
    columnCount,
    subtableIndex,
    arrayData: copyReaderRange(reader, arrayStart, arrayStart + arrayLength),
    vectorData: copyReaderRange(reader, vectorStart, subtableEnd),
  }
}

function copyReaderRange(reader: BinaryReader, start: number, end: number): Uint8Array {
  const data = new Uint8Array(end - start)
  for (let i = 0; i < data.length; i++) data[i] = reader.getUint8At(start + i)
  return data
}

function getFormat0Kerning(
  reader: BinaryReader,
  data: KerxFormat0Data,
  left: number,
  right: number,
  tupleScalars?: readonly number[],
): number {
  const raw = data.pairs.get((left << 16) | right)
  if (raw === undefined) return 0
  if (data.tupleCount === 0) return raw
  return resolveTupleVector(
    reader,
    data.subtableStart + (raw & 0xFFFF),
    data.tupleCount,
    tupleScalars,
    data.subtableEnd,
  )
}

function getFormat2Kerning(
  reader: BinaryReader,
  data: KerxFormat2Data,
  left: number,
  right: number,
  tupleScalars?: readonly number[],
): number {
  const l = data.leftClasses.get(left) ?? 0
  const r = data.rightClasses.get(right) ?? 0
  // Class values sum to a flat element index into the two-byte kerning array.
  const valuePos = data.arrayStart + (l + r) * 2
  if (valuePos < data.arrayStart || valuePos + 2 > data.subtableEnd) {
    return 0
  }
  if (data.tupleCount === 0) {
    return reader.getInt16At(valuePos)
  }
  // Cell contains an offset from subtable start to a tuple vector
  const vectorOffset = reader.getUint16At(valuePos)
  return resolveTupleVector(
    reader,
    data.subtableStart + vectorOffset,
    data.tupleCount,
    tupleScalars,
    data.subtableEnd,
  )
}

function getFormat6Kerning(
  reader: BinaryReader,
  data: KerxFormat6Data,
  left: number,
  right: number,
  tupleScalars?: readonly number[],
): number {
  const l = data.rowIndices.get(left) ?? 0
  const r = data.columnIndices.get(right) ?? 0
  if (l % data.columnCount !== 0 || l / data.columnCount >= data.rowCount) {
    throw new Error(`kerx format 6 row index ${l} is outside ${data.rowCount}x${data.columnCount} array`)
  }
  if (r >= data.columnCount) {
    throw new Error(`kerx format 6 column index ${r} is outside ${data.rowCount}x${data.columnCount} array`)
  }
  const elemSize = data.valuesAreLong ? 4 : 2
  const valuePos = data.arrayStart + (l + r) * elemSize
  if (data.tupleCount === 0) {
    return data.valuesAreLong ? reader.getInt32At(valuePos) : reader.getInt16At(valuePos)
  }
  // Cell contains an offset into the kerning vector area
  const vectorOffset = data.valuesAreLong ? reader.getUint32At(valuePos) : reader.getUint16At(valuePos)
  return resolveTupleVector(
    reader,
    data.vectorStart + vectorOffset,
    data.tupleCount,
    tupleScalars,
    data.subtableEnd,
  )
}

/**
 * Runs a format 1 state machine over a glyph run and accumulates
 * per-position kerning adjustments into `adjustments`.
 */
function runFormat1(
  reader: BinaryReader,
  data: KerxFormat1Data,
  glyphIds: number[],
  positioning: KerxPositioning,
  tupleScalars?: readonly number[],
  glyphCoverage?: Uint8Array | null,
  boundary: AatStateBoundary = 'text',
): void {
  if (glyphCoverage !== undefined && glyphCoverage !== null && !runIntersectsCoverage(glyphIds, glyphCoverage)) return
  const st = data.stateTable
  const len = glyphIds.length
  const stack: number[] = []
  let state = boundary === 'line' ? 1 : 0
  let i = data.processBackwards ? len - 1 : 0
  const visited = new Set<string>()

  while (data.processBackwards ? i >= -1 : i <= len) {
    const atEnd = data.processBackwards ? i < 0 : i === len
    const glyphId = atEnd ? -1 : glyphIds[i]!
    const cls = atEnd ? (boundary === 'line' ? 3 : 0) : st.getClass(glyphId)
    const cycleKey = `${state}:${cls}:${glyphId}`
    if (visited.has(cycleKey)) throw new Error('kerx format 1 state machine does not advance')
    visited.add(cycleKey)
    const entry = st.getEntry(state, cls)

    if (entry.flags & KERX_RESET) stack.length = 0
    if ((entry.flags & KERX_PUSH) && !atEnd) {
      if (stack.length >= 8) throw new Error('kerx format 1 kerning stack exceeds eight glyphs')
      stack.push(i)
    }

    const valueIndex = entry.extra[0]!
    if (valueIndex !== 0xFFFF && stack.length > 0) {
      let pos = data.valueTableStart + valueIndex * 2
      while (stack.length > 0) {
        if (pos + 2 > data.subtableEnd) throw new Error('kerx format 1 value list exceeds subtable length')
        const value = reader.getInt16At(pos)
        if (value === -1) { // 0xFFFF terminator
          stack.length = 0
          break
        }
        const glyphPos = stack.pop()!
        const adjustment = data.tupleCount === 0
          ? value
          : resolveTupleVector(
            reader,
            pos,
            data.tupleCount,
            tupleScalars,
            data.subtableEnd,
          )
        pos += data.tupleCount === 0 ? 2 : data.tupleCount * 2
        if (data.vertical) {
          if (data.crossStream) positioning.xOffset[glyphPos]! += adjustment
          else {
            positioning.yAdvance[glyphPos]! += adjustment
            positioning.yOffset[glyphPos]! += adjustment
          }
        } else if (data.crossStream) {
          positioning.yOffset[glyphPos]! += adjustment
        } else {
          positioning.xAdvance[glyphPos]! += adjustment
          positioning.xOffset[glyphPos]! += adjustment
        }
      }
    }

    state = entry.newState
    if (entry.flags & KERX_DONT_ADVANCE) {
      continue
    }
    i += data.processBackwards ? -1 : 1
    visited.clear()
  }
}

/**
 * Runs a format 4 state machine over a glyph run and collects attachment actions.
 */
function runFormat4(
  reader: BinaryReader,
  data: KerxFormat4Data,
  glyphIds: number[],
  out: KerxAttachment[],
  glyphCoverage?: Uint8Array | null,
  boundary: AatStateBoundary = 'text',
): void {
  if (glyphCoverage !== undefined && glyphCoverage !== null && !runIntersectsCoverage(glyphIds, glyphCoverage)) return
  const st = data.stateTable
  const len = glyphIds.length
  let state = boundary === 'line' ? 1 : 0
  let mark = -1
  let i = data.processBackwards ? len - 1 : 0
  const visited = new Set<string>()

  while (data.processBackwards ? i >= -1 : i <= len) {
    const atEnd = data.processBackwards ? i < 0 : i === len
    const glyphId = atEnd ? -1 : glyphIds[i]!
    const cls = atEnd ? (boundary === 'line' ? 3 : 0) : st.getClass(glyphId)
    const cycleKey = `${state}:${cls}:${glyphId}`
    if (visited.has(cycleKey)) throw new Error('kerx format 4 state machine does not advance')
    visited.add(cycleKey)
    const entry = st.getEntry(state, cls)

    const actionIndex = entry.extra[0]!
    if (actionIndex !== 0xFFFF && mark >= 0 && !atEnd) {
      // The action index counts whole actions, each holding a fixed number of
      // 16-bit fields: 2 for control/anchor points, 4 for coordinates. The byte
      // offset is therefore actionIndex × fields × 2 (HarfBuzz doubles the index
      // for the 2-field case and quadruples it for the 4-field case).
      let values: number[]
      if (data.actionType === 2) {
        // Coordinates: markX, markY, currX, currY (FWord)
        const pos = data.controlTableStart + actionIndex * 8
        if (pos + 8 > data.subtableEnd) throw new Error('kerx format 4 coordinate action exceeds subtable length')
        values = [
          reader.getInt16At(pos),
          reader.getInt16At(pos + 2),
          reader.getInt16At(pos + 4),
          reader.getInt16At(pos + 6),
        ]
      } else {
        // Control points / anchor points: mark point, current point
        const pos = data.controlTableStart + actionIndex * 4
        if (pos + 4 > data.subtableEnd) throw new Error('kerx format 4 point action exceeds subtable length')
        values = [reader.getUint16At(pos), reader.getUint16At(pos + 2)]
      }
      out.push({ markIndex: mark, currentIndex: i, actionType: data.actionType, values })
    }

    if ((entry.flags & KERX_MARK) && !atEnd) mark = i

    state = entry.newState
    if (entry.flags & KERX_DONT_ADVANCE) {
      continue
    }
    i += data.processBackwards ? -1 : 1
    visited.clear()
  }
}

function runIntersectsCoverage(glyphIds: readonly number[], coverage: Uint8Array): boolean {
  for (let i = 0; i < glyphIds.length; i++) {
    const glyphId = glyphIds[i]!
    if (glyphId >= 0 && glyphId >>> 3 < coverage.length
      && (coverage[glyphId >>> 3]! & (1 << (glyphId & 7))) !== 0) return true
  }
  return false
}

/**
 * Parses the kerx (extended kerning) table.
 * Supports subtable formats 0 (ordered pairs), 1 (contextual state machine),
 * 2 (simple n x m array), 4 (control/anchor point attachment), 6 (index-based n x m).
 */
export function parseKerx(reader: BinaryReader, numGlyphs?: number): KerxTable {
  const tableStart = reader.position
  if (reader.length - tableStart < KERX_HEADER_SIZE) {
    throw new Error(`kerx table length must be at least ${KERX_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }
  const version = reader.readUint16()
  if (version !== 2 && version !== 3 && version !== 4) {
    throw new Error(`Unsupported kerx table version: ${version}`)
  }
  const padding = reader.readUint16()
  if (padding !== 0) {
    throw new Error(`kerx padding must be zero, got ${padding}`)
  }
  const nTables = reader.readUint32()
  if (nTables === 0) {
    throw new Error('kerx table requires at least one subtable')
  }

  const subtables: KerxSubtableInfo[] = []
  const format0Data: KerxFormat0Data[] = []
  const format1Data: KerxFormat1Data[] = []
  const format2Data: KerxFormat2Data[] = []
  const format4Data: KerxFormat4Data[] = []
  const format6Data: KerxFormat6Data[] = []

  for (let t = 0; t < nTables; t++) {
    const subtableStart = reader.position
    if (reader.length - subtableStart < KERX_SUBTABLE_HEADER_SIZE) {
      throw new Error(`kerx subtable ${t} header exceeds table length`)
    }
    const length = reader.readUint32()
    const coverage = reader.readUint32()
    const tupleCount = reader.readUint32()
    if (length < KERX_SUBTABLE_HEADER_SIZE) {
      throw new Error(`kerx subtable ${t} length must be at least ${KERX_SUBTABLE_HEADER_SIZE}, got ${length}`)
    }
    const subtableEnd = subtableStart + length
    if (subtableEnd > reader.length) {
      throw new Error(`kerx subtable ${t} exceeds table length`)
    }
    if ((coverage & KERX_COVERAGE_RESERVED_MASK) !== 0) {
      throw new Error(`kerx subtable ${t} coverage reserved bits must be zero`)
    }

    const format = coverage & KERX_COVERAGE_FORMAT_MASK
    validateKerxFormat(format)
    const vertical = (coverage & 0x80000000) !== 0
    const crossStream = (coverage & 0x40000000) !== 0
    const variation = (coverage & 0x20000000) !== 0
    const processBackwards = (coverage & 0x10000000) !== 0
    const effectiveTupleCount = version >= 4 ? tupleCount : 0

    subtables.push({ format, vertical, crossStream, variation, processBackwards, tupleCount })

    if (format === 0) {
      format0Data.push(parseKerxFormat0(
        reader, subtableStart, subtableEnd, effectiveTupleCount, vertical, crossStream, t, numGlyphs,
      ))
    } else if (format === 1) {
      format1Data.push(parseKerxFormat1(
        reader, subtableStart, subtableEnd, effectiveTupleCount, processBackwards,
        vertical, crossStream, t, numGlyphs,
      ))
    } else if (format === 2) {
      format2Data.push(parseKerxFormat2(
        reader, subtableStart, subtableEnd, effectiveTupleCount, vertical, crossStream, t, numGlyphs,
      ))
    } else if (format === 4) {
      format4Data.push(parseKerxFormat4(
        reader, subtableStart, subtableEnd, processBackwards, vertical, t, numGlyphs,
      ))
    } else if (format === 6) {
      format6Data.push(parseKerxFormat6(
        reader, subtableStart, effectiveTupleCount, subtableEnd, vertical, crossStream, t, numGlyphs,
      ))
    }

    reader.seek(subtableEnd)
  }

  const glyphCoverage = new Array<Uint8Array | null>(nTables).fill(null)
  if (version >= 3) {
    const coverageStart = reader.position
    const offsetArrayLength = nTables * 4
    if (coverageStart + offsetArrayLength > reader.length) {
      throw new Error('kerx subtable glyph coverage offset array exceeds table length')
    }
    const offsets = new Array<number>(nTables)
    for (let i = 0; i < nTables; i++) offsets[i] = reader.readUint32()
    for (let i = 0; i < nTables; i++) {
      const offset = offsets[i]!
      if (offset === 0xFFFFFFFF) continue
      if (numGlyphs === undefined) {
        throw new Error('kerx subtable glyph coverage requires maxp.numGlyphs')
      }
      if (offset < offsetArrayLength) {
        throw new Error(`kerx subtable ${i} glyph coverage offset overlaps the offset array`)
      }
      const byteLength = (numGlyphs + 7) >>> 3
      const paddedLength = (byteLength + 3) & ~3
      const start = coverageStart + offset
      if (start + paddedLength > reader.length) {
        throw new Error(`kerx subtable ${i} glyph coverage bitfield exceeds table length`)
      }
      const bitfieldReader = reader.subReader(start, byteLength)
      glyphCoverage[i] = bitfieldReader.readBytes(byteLength)
    }
  }

  return {
    version,
    subtables,
    subsetData: [...format0Data, ...format1Data, ...format2Data, ...format4Data, ...format6Data]
      .sort(function (left, right) { return left.subtableIndex - right.subtableIndex }),
    subsetGlyphCoverage: glyphCoverage,

    getKerning(leftGlyphId: number, rightGlyphId: number, tupleScalars?: readonly number[]): number {
      return this.getPairAdjustment(leftGlyphId, rightGlyphId, 'horizontal', tupleScalars).advance
    },

    getPairAdjustment(
      leftGlyphId: number,
      rightGlyphId: number,
      direction: 'horizontal' | 'vertical',
      tupleScalars?: readonly number[],
    ): { advance: number, crossStream: number | null } {
      const vertical = direction === 'vertical'
      let advance = 0
      let crossStream: number | null = null
      for (let i = 0; i < format0Data.length; i++) {
        const data = format0Data[i]!
        if (data.vertical !== vertical) continue
        const value = getFormat0Kerning(reader, data, leftGlyphId, rightGlyphId, tupleScalars)
        if (data.crossStream) {
          if (value !== 0) crossStream = value
        } else {
          advance += value
        }
      }
      for (let i = 0; i < format2Data.length; i++) {
        const data = format2Data[i]!
        if (data.vertical !== vertical) continue
        const value = getFormat2Kerning(reader, data, leftGlyphId, rightGlyphId, tupleScalars)
        if (data.crossStream) {
          if (value !== 0) crossStream = value
        } else {
          advance += value
        }
      }
      for (let i = 0; i < format6Data.length; i++) {
        const data = format6Data[i]!
        if (data.vertical !== vertical) continue
        const value = getFormat6Kerning(reader, data, leftGlyphId, rightGlyphId, tupleScalars)
        if (data.crossStream) {
          if (value !== 0) crossStream = value
        } else {
          advance += value
        }
      }
      return { advance, crossStream }
    },

    applyContextualKerning(glyphIds: number[], tupleScalars?: readonly number[], boundary: AatStateBoundary = 'text'): number[] {
      return this.applyContextualPositioning(glyphIds, 'horizontal', tupleScalars, boundary).xAdvance
    },

    applyContextualPositioning(
      glyphIds: number[],
      direction: 'horizontal' | 'vertical',
      tupleScalars?: readonly number[],
      boundary: AatStateBoundary = 'text',
    ): KerxPositioning {
      const n = glyphIds.length
      const positioning: KerxPositioning = {
        xAdvance: new Array<number>(n).fill(0),
        yAdvance: new Array<number>(n).fill(0),
        xOffset: new Array<number>(n).fill(0),
        yOffset: new Array<number>(n).fill(0),
      }
      const vertical = direction === 'vertical'
      for (let i = 0; i < format1Data.length; i++) {
        const data = format1Data[i]!
        if (data.vertical === vertical) {
          runFormat1(reader, data, glyphIds, positioning, tupleScalars, glyphCoverage[data.subtableIndex], boundary)
        }
      }
      return positioning
    },

    getAttachments(glyphIds: number[], direction: 'horizontal' | 'vertical' = 'horizontal', boundary: AatStateBoundary = 'text'): KerxAttachment[] {
      const out: KerxAttachment[] = []
      const vertical = direction === 'vertical'
      for (let i = 0; i < format4Data.length; i++) {
        const data = format4Data[i]!
        if (data.vertical === vertical) {
          runFormat4(reader, data, glyphIds, out, glyphCoverage[data.subtableIndex], boundary)
        }
      }
      return out
    },
  }
}

function validateKerxFormat(format: number): void {
  if (format !== 0 && format !== 1 && format !== 2 && format !== 4 && format !== 6) {
    throw new Error(`Unsupported kerx subtable format: ${format}`)
  }
}
