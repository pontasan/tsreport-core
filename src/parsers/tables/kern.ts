import { BinaryReader } from '../../binary/reader.js'
import { parseStateTable, type AatStateBoundary, type AatStateTable } from './aat-common.js'

/**
 * kern table: kerning pair data
 */
export interface KernTable {
  /** Parsed semantic subtables retained for glyph-ID-safe rebuilding. */
  readonly subsetData: KernSubsetData
  /** Get the kerning value between two glyphs (font units) */
  getKerning(leftGlyphId: number, rightGlyphId: number, tupleScalars?: readonly number[]): number
  /** Resolves pair kerning and its cross-stream placement for a writing direction. */
  getPairAdjustment(
    leftGlyphId: number,
    rightGlyphId: number,
    direction: 'horizontal' | 'vertical',
    tupleScalars?: readonly number[],
    tracking?: number,
  ): { advance: number, crossStream: number | null, minimum: number | null }
  /**
   * Runs the AAT format-1 (state machine) subtables over a glyph run and returns
   * per-glyph position deltas. In-stream horizontal kerning adds the value to
   * both x-advance and x-offset (HarfBuzz kern/kerx behaviour); cross-stream adds
   * it to y-offset. `rightToLeft` processes the run in visual (reversed) order,
   * as the shaper reverses right-to-left runs before positioning. The run should
   * include morx deletion markers (0xFFFF) so state transitions match HarfBuzz.
   * All deltas are zero when the font has no format-1 subtable.
   */
  applyContextualKerning(glyphIds: number[], rightToLeft: boolean, boundary?: AatStateBoundary): {
    xAdvance: number[]
    yAdvance: number[]
    xOffset: number[]
    yOffset: number[]
  }
  applyContextualPositioning(
    glyphIds: number[],
    direction: 'horizontal' | 'vertical',
    rightToLeft: boolean,
    tupleScalars?: readonly number[],
    boundary?: AatStateBoundary,
  ): {
    xAdvance: number[]
    yAdvance: number[]
    xOffset: number[]
    yOffset: number[]
  }
}

export interface KernFormat1Data {
  stateTable: AatStateTable
  /** Absolute reader position the value-list byte offsets are measured from. */
  valueTableStart: number
  crossStream: boolean
  vertical: boolean
  variation: boolean
  tupleIndex: number
  subtableEnd: number
  readonly valueLists: ReadonlyMap<number, readonly number[]>
}

export interface KernPairSubtable {
  readonly pairs: Map<number, number>
  readonly vertical: boolean
  readonly crossStream: boolean
  readonly minimum: boolean
  readonly override: boolean
  readonly variation: boolean
  readonly tupleIndex: number
}

export interface KernSubsetData {
  readonly flavor: KernFlavor
  readonly pairSubtables: readonly KernPairSubtable[]
  readonly contextualSubtables: readonly KernFormat1Data[]
}

const KERN_PAIR_SIZE = 6
const MICROSOFT_TABLE_HEADER_SIZE = 4
const MICROSOFT_SUBTABLE_HEADER_SIZE = 6
const APPLE_TABLE_HEADER_SIZE = 8
const APPLE_SUBTABLE_HEADER_SIZE = 8
const FORMAT_0_HEADER_SIZE = 8
const FORMAT_2_HEADER_SIZE = 8
const FORMAT_3_HEADER_SIZE = 6
const UNBOUNDED_GLYPH_COUNT = 0x10000

export type KernFlavor = 'microsoft' | 'apple'

function requireRange(reader: BinaryReader, start: number, length: number, label: string): void {
  if (length < 0 || start < 0 || start + length > reader.length) {
    throw new Error(`${label} exceeds kern table length: need ${start + length}, got ${reader.length}`)
  }
}

function requireSubtableRange(reader: BinaryReader, start: number, length: number, minLength: number, label: string): number {
  if (length < minLength) {
    throw new Error(`${label} length must be at least ${minLength}, got ${length}`)
  }
  requireRange(reader, start, length, label)
  return start + length
}

function assertGlyphId(glyphId: number, numGlyphs: number, label: string): void {
  if (numGlyphs !== UNBOUNDED_GLYPH_COUNT && glyphId >= numGlyphs) {
    throw new Error(`${label} glyph ID ${glyphId} exceeds numGlyphs ${numGlyphs}`)
  }
}

function addKernPair(pairs: Map<number, number>, left: number, right: number, value: number, isOverride: boolean): void {
  const key = (left << 16) | right
  if (isOverride) {
    pairs.set(key, value)
  } else {
    pairs.set(key, (pairs.get(key) ?? 0) + value)
  }
}

function getFormat0SearchValues(nPairs: number): { searchRange: number, entrySelector: number, rangeShift: number } {
  if (nPairs === 0) {
    return { searchRange: 0, entrySelector: 0, rangeShift: 0 }
  }

  let powerOfTwo = 1
  let entrySelector = 0
  while ((powerOfTwo << 1) <= nPairs) {
    powerOfTwo <<= 1
    entrySelector++
  }

  return {
    searchRange: powerOfTwo * KERN_PAIR_SIZE,
    entrySelector,
    rangeShift: (nPairs - powerOfTwo) * KERN_PAIR_SIZE,
  }
}

function parseKernFormat0(
  reader: BinaryReader,
  subtableEnd: number,
  isOverride: boolean,
  pairs: Map<number, number>,
  numGlyphs: number,
): void {
  requireRange(reader, reader.position, FORMAT_0_HEADER_SIZE, 'kern format 0 header')

  const nPairs = reader.readUint16()
  const searchRange = reader.readUint16()
  const entrySelector = reader.readUint16()
  const rangeShift = reader.readUint16()

  const expected = getFormat0SearchValues(nPairs)
  if (
    searchRange !== expected.searchRange
    || entrySelector !== expected.entrySelector
    || rangeShift !== expected.rangeShift
  ) {
    throw new Error(
      `kern format 0 search header mismatch: expected ${expected.searchRange}/${expected.entrySelector}/${expected.rangeShift}, got ${searchRange}/${entrySelector}/${rangeShift}`,
    )
  }

  const pairDataLength = nPairs * KERN_PAIR_SIZE
  requireRange(reader, reader.position, pairDataLength, 'kern format 0 pair array')
  if (reader.position + pairDataLength > subtableEnd) {
    throw new Error(`kern format 0 pair array exceeds subtable length: need ${reader.position + pairDataLength}, got ${subtableEnd}`)
  }

  // The spec requires pairs sorted by (left,right); real fonts (e.g. macOS
  // Hoefler Text, Trebuchet MS) ship unsorted pairs. Kerning is looked up via a
  // map, so order does not matter — trust the data rather than reject the font.
  for (let i = 0; i < nPairs; i++) {
    const left = reader.readUint16()
    const right = reader.readUint16()
    const value = reader.readInt16()
    assertGlyphId(left, numGlyphs, `kern format 0 pair ${i} left`)
    assertGlyphId(right, numGlyphs, `kern format 0 pair ${i} right`)
    addKernPair(pairs, left, right, value, isOverride)
  }

  reader.seek(subtableEnd)
}

function validateMicrosoftCoverage(coverage: number): void {
  if ((coverage & 0x00F0) !== 0) {
    throw new Error(`kern Microsoft coverage reserved bits must be zero: 0x${coverage.toString(16)}`)
  }
}

function validateAppleCoverage(coverage: number): void {
  if ((coverage & 0x1F00) !== 0) {
    throw new Error(`kern Apple coverage unused bits must be zero: 0x${coverage.toString(16)}`)
  }
}

const KERN1_PUSH = 0x8000
const KERN1_DONT_ADVANCE = 0x4000
const KERN1_VALUE_OFFSET_MASK = 0x3FFF
const KERN1_CROSS_STREAM_RESET = -0x8000

/**
 * kern Format 1: state machine based kerning (Apple AAT). Parsed into a runtime
 * state machine (not flattened to pairs) so the kerning-value stack is evaluated
 * over the actual glyph run at shaping time.
 */
function parseKernFormat1(
  reader: BinaryReader,
  subtableStart: number,
  vertical: boolean,
  crossStream: boolean,
  variation: boolean,
  tupleIndex: number,
  subtableEnd: number,
): KernFormat1Data {
  // State entries are 4 bytes: newState(2) + flags(2). The kerning-value-list
  // offset is embedded in the low 14 bits of flags (0x3FFF), a byte offset from
  // the state-table start; there is no separate value field.
  const stateTable = parseStateTable(reader, subtableStart, 0)
  const valueLists = new Map<number, readonly number[]>()
  const states = stateTable.stateIndices!
  for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
    for (let classIndex = 0; classIndex < stateTable.nClasses; classIndex++) {
      const valueOffset = stateTable.getEntry(states[stateIndex]!, classIndex).flags & KERN1_VALUE_OFFSET_MASK
      if (valueOffset === 0 || valueLists.has(valueOffset)) continue
      const values: number[] = []
      let position = subtableStart + valueOffset
      let last = false
      while (!last) {
        if (position + 2 > subtableEnd) throw new Error('kern format 1 value list exceeds subtable length')
        const value = reader.getInt16At(position)
        values.push(value)
        last = (value & 1) !== 0
        position += 2
      }
      valueLists.set(valueOffset, values)
    }
  }
  return { stateTable, valueTableStart: subtableStart, crossStream, vertical, variation, tupleIndex, subtableEnd, valueLists }
}

/**
 * Runs one format-1 subtable's state machine over the run, applying kerning
 * values from the value stack. Each value's low bit is the end-of-list flag and
 * is masked off before use (Apple 'kern' semantics). In-stream horizontal
 * kerning adds the value to both x-advance and x-offset; cross-stream adds it to
 * y-offset, with the -0x8000 sentinel resetting the accumulated cross-stream
 * offset.
 */
function runKernFormat1(
  reader: BinaryReader,
  data: KernFormat1Data,
  glyphIds: number[],
  xAdvance: number[],
  yAdvance: number[],
  xOffset: number[],
  yOffset: number[],
  tupleScalar: number,
  boundary: AatStateBoundary,
): void {
  const st = data.stateTable
  const len = glyphIds.length
  const stack: number[] = []
  let crossStreamAccum = 0
  let state = boundary === 'line' ? 1 : 0
  let i = 0
  const visited = new Set<string>()
  while (i <= len) {
    const glyphId = i < len ? glyphIds[i]! : -1
    const cls = i < len ? st.getClass(glyphId) : (boundary === 'line' ? 3 : 0)
    const cycleKey = `${state}:${cls}:${glyphId}`
    if (visited.has(cycleKey)) throw new Error('kern format 1 state machine does not advance')
    visited.add(cycleKey)
    const entry = st.getEntry(state, cls)

    if ((entry.flags & KERN1_PUSH) !== 0 && i < len) {
      if (stack.length >= 8) throw new Error('kern format 1 kerning stack exceeds eight glyphs')
      stack.push(i)
    }

    const valueOffset = entry.flags & KERN1_VALUE_OFFSET_MASK
    if (valueOffset !== 0 && stack.length > 0) {
      let pos = data.valueTableStart + valueOffset
      let last = false
      while (!last && stack.length > 0) {
        if (pos + 2 > data.subtableEnd) throw new Error('kern format 1 value list exceeds subtable length')
        const raw = reader.getInt16At(pos)
        pos += 2
        last = (raw & 1) !== 0
        // AAT tuple arithmetic uses fixed-point truncation to design units.
        const v = Math.trunc((raw & ~1) * tupleScalar) // low bit is the end-of-list flag, not a value bit
        const idx = stack.pop()!
        if (data.crossStream) {
          // Cross-stream kerning shifts the cross-axis (baseline) position and
          // the shift PERSISTS for every following glyph until reset — a
          // cascading baseline (e.g. Nastaliq Arabic). Accumulate here; the
          // running offset is committed to each glyph as the machine advances.
          if ((raw & ~1) === KERN1_CROSS_STREAM_RESET) crossStreamAccum = 0
          else crossStreamAccum += v
        } else if (data.vertical) {
          yAdvance[idx]! += v
          yOffset[idx]! += v
        } else {
          xAdvance[idx]! += v
          xOffset[idx]! += v
        }
      }
    }

    state = entry.newState
    if ((entry.flags & KERN1_DONT_ADVANCE) === 0) {
      // Commit the running cross-stream offset to the glyph leaving the machine.
      if (data.crossStream && i < len) {
        if (data.vertical) xOffset[i]! += crossStreamAccum
        else yOffset[i]! += crossStreamAccum
      }
      i++
      visited.clear()
    }
  }
}

/**
 * kern Format 2: class-based kerning
 * leftClassTable and rightClassTable map glyph → class
 * The class pair indexes into a 2D matrix of kern values
 */
function parseKernFormat2(
  reader: BinaryReader,
  subtableStart: number,
  subtableEnd: number,
  isOverride: boolean,
  pairs: Map<number, number>,
  numGlyphs: number,
  flavor: KernFlavor,
): void {
  requireRange(reader, reader.position, FORMAT_2_HEADER_SIZE, 'kern format 2 header')
  const rowWidth = reader.readUint16()
  const leftClassTableOffset = reader.readUint16()
  const rightClassTableOffset = reader.readUint16()
  const arrayOffset = reader.readUint16()

  // Parse left class table
  requireRange(reader, subtableStart + leftClassTableOffset, 4, 'kern format 2 left class table')
  reader.seek(subtableStart + leftClassTableOffset)
  const leftFirstGlyph = reader.readUint16()
  const leftGlyphCount = reader.readUint16()
  assertGlyphId(leftFirstGlyph + leftGlyphCount, numGlyphs + 1, 'kern format 2 left class table end')
  requireRange(reader, reader.position, leftGlyphCount * 2, 'kern format 2 left class values')
  const leftClassValues = new Uint16Array(leftGlyphCount)
  for (let i = 0; i < leftGlyphCount; i++) {
    leftClassValues[i] = reader.readUint16()
  }

  // Parse right class table
  requireRange(reader, subtableStart + rightClassTableOffset, 4, 'kern format 2 right class table')
  reader.seek(subtableStart + rightClassTableOffset)
  const rightFirstGlyph = reader.readUint16()
  const rightGlyphCount = reader.readUint16()
  assertGlyphId(rightFirstGlyph + rightGlyphCount, numGlyphs + 1, 'kern format 2 right class table end')
  requireRange(reader, reader.position, rightGlyphCount * 2, 'kern format 2 right class values')
  const rightClassValues = new Uint16Array(rightGlyphCount)
  for (let i = 0; i < rightGlyphCount; i++) {
    rightClassValues[i] = reader.readUint16()
  }

  // For each (leftGlyph, rightGlyph) pair, compute kern value from matrix
  for (let li = 0; li < leftGlyphCount; li++) {
    const leftGlyph = leftFirstGlyph + li
    const leftOffset = leftClassValues[li]!

    for (let ri = 0; ri < rightGlyphCount; ri++) {
      const rightGlyph = rightFirstGlyph + ri
      const rightOffset = rightClassValues[ri]!

      // Read kern value from array: array base + leftOffset + rightOffset
      const valueOffset = flavor === 'microsoft'
        ? subtableStart + arrayOffset + leftOffset + rightOffset
        : subtableStart + leftOffset + rightOffset
      if (valueOffset < subtableStart || valueOffset + 2 > subtableEnd) {
        throw new Error(`kern format 2 value offset out of range: ${valueOffset - subtableStart}`)
      }
      reader.seek(valueOffset)
      const value = reader.readInt16()

      if (value !== 0) {
        addKernPair(pairs, leftGlyph, rightGlyph, value, isOverride)
      }
    }
  }
  reader.seek(subtableEnd)
}

/**
 * kern Format 3: compact format (Apple AAT)
 * Fixed-size class mappings and index array
 */
function parseKernFormat3(
  reader: BinaryReader,
  subtableEnd: number,
  isOverride: boolean,
  pairs: Map<number, number>,
  numGlyphs: number,
): void {
  requireRange(reader, reader.position, FORMAT_3_HEADER_SIZE, 'kern format 3 header')
  const glyphCount = reader.readUint16()
  const kernValueCount = reader.readUint8()
  const leftClassCount = reader.readUint8()
  const rightClassCount = reader.readUint8()
  const flags = reader.readUint8()
  if (flags !== 0) {
    throw new Error(`kern format 3 flags must be zero, got ${flags}`)
  }
  assertGlyphId(glyphCount, numGlyphs + 1, 'kern format 3 glyphCount')

  // kern values (int16)
  requireRange(reader, reader.position, kernValueCount * 2, 'kern format 3 kern values')
  const kernValues = new Int16Array(kernValueCount)
  for (let i = 0; i < kernValueCount; i++) {
    kernValues[i] = reader.readInt16()
  }

  // left class for each glyph (uint8)
  requireRange(reader, reader.position, glyphCount, 'kern format 3 left class array')
  const leftClass = reader.readBytes(glyphCount)

  // right class for each glyph (uint8)
  requireRange(reader, reader.position, glyphCount, 'kern format 3 right class array')
  const rightClass = reader.readBytes(glyphCount)

  // kern index array: leftClassCount × rightClassCount of uint8
  requireRange(reader, reader.position, leftClassCount * rightClassCount, 'kern format 3 kern index array')
  const kernIndex = reader.readBytes(leftClassCount * rightClassCount)

  // Enumerate all pairs
  for (let left = 0; left < glyphCount; left++) {
    const lc = leftClass[left]!
    if (lc >= leftClassCount) {
      throw new Error(`kern format 3 left class out of range for glyph ${left}: ${lc}`)
    }

    for (let right = 0; right < glyphCount; right++) {
      const rc = rightClass[right]!
      if (rc >= rightClassCount) {
        throw new Error(`kern format 3 right class out of range for glyph ${right}: ${rc}`)
      }

      const idx = kernIndex[lc * rightClassCount + rc]!
      if (idx >= kernValueCount) {
        throw new Error(`kern format 3 kern value index out of range: ${idx}`)
      }

      const value = kernValues[idx]!
      if (value !== 0) {
        addKernPair(pairs, left, right, value, isOverride)
      }
    }
  }
  reader.seek(subtableEnd)
}

/**
 * Parse the kern table
 * Supports Format 0 (ordered pair list), Format 1 (state machine), Format 2 (class-based), and Format 3 (compact)
 * Supports both Microsoft and Apple header formats
 */
export function parseKern(reader: BinaryReader, numGlyphs = UNBOUNDED_GLYPH_COUNT): KernTable {
  const pairSubtables: KernPairSubtable[] = []
  const format1Data: KernFormat1Data[] = []

  requireRange(reader, 0, 2, 'kern table version')
  const version = reader.readUint16()

  let flavor: KernFlavor
  if (version === 0) {
    flavor = 'microsoft'
    // Microsoft format: version(uint16) + nTables(uint16)
    requireRange(reader, 0, MICROSOFT_TABLE_HEADER_SIZE, 'kern Microsoft table header')
    const nTables = reader.readUint16()

    for (let t = 0; t < nTables; t++) {
      const subtableStart = reader.position
      requireRange(reader, subtableStart, MICROSOFT_SUBTABLE_HEADER_SIZE, `kern Microsoft subtable ${t} header`)
      const subtableVersion = reader.readUint16()
      const subtableLength = reader.readUint16()
      const coverage = reader.readUint16()
      if (subtableVersion !== 0) {
        throw new Error(`kern Microsoft subtable ${t} version must be 0, got ${subtableVersion}`)
      }
      const subtableEnd = requireSubtableRange(
        reader,
        subtableStart,
        subtableLength,
        MICROSOFT_SUBTABLE_HEADER_SIZE,
        `kern Microsoft subtable ${t}`,
      )
      validateMicrosoftCoverage(coverage)

      const format = coverage >> 8
      const isHorizontal = (coverage & 0x01) !== 0
      const isMinimum = (coverage & 0x02) !== 0
      const isCrossStream = (coverage & 0x04) !== 0
      const isOverride = (coverage & 0x08) !== 0

      const pairs = new Map<number, number>()

      if (format === 0) {
        parseKernFormat0(reader, subtableEnd, false, pairs, numGlyphs)
      } else if (format === 2) {
        parseKernFormat2(reader, subtableStart, subtableEnd, false, pairs, numGlyphs, 'microsoft')
      } else {
        throw new Error(`Unsupported Microsoft kern subtable format: ${format}`)
      }
      pairSubtables.push({
        pairs,
        vertical: !isHorizontal,
        crossStream: isCrossStream,
        minimum: isMinimum,
        override: isOverride,
        variation: false,
        tupleIndex: 0,
      })
    }
  } else if (version === 1) {
    flavor = 'apple'
    // Apple format (AAT): version is 1.0 fixed
    requireRange(reader, 0, APPLE_TABLE_HEADER_SIZE, 'kern Apple table header')
    reader.readUint16() // compatible minor version
    const nTables = reader.readUint32()

    for (let t = 0; t < nTables; t++) {
      const subtableStart = reader.position
      requireRange(reader, subtableStart, APPLE_SUBTABLE_HEADER_SIZE, `kern Apple subtable ${t} header`)
      const subtableLength = reader.readUint32()
      const coverage = reader.readUint16()
      const tupleIndex = reader.readUint16()
      const subtableEnd = requireSubtableRange(
        reader,
        subtableStart,
        subtableLength,
        APPLE_SUBTABLE_HEADER_SIZE,
        `kern Apple subtable ${t}`,
      )
      validateAppleCoverage(coverage)

      const format = coverage & 0xFF
      const isVertical = (coverage & 0x8000) !== 0
      const isCrossStream = (coverage & 0x4000) !== 0
      const isVariation = (coverage & 0x2000) !== 0

      if (format === 1) {
        format1Data.push(parseKernFormat1(
          reader, reader.position, isVertical, isCrossStream, isVariation, tupleIndex, subtableEnd,
        ))
        reader.seek(subtableEnd)
        continue
      }

      const pairs = new Map<number, number>()

      if (format === 0) {
        parseKernFormat0(reader, subtableEnd, false, pairs, numGlyphs)
      } else if (format === 2) {
        parseKernFormat2(reader, subtableStart, subtableEnd, false, pairs, numGlyphs, 'apple')
      } else if (format === 3) {
        parseKernFormat3(reader, subtableEnd, false, pairs, numGlyphs)
      } else {
        throw new Error(`Unsupported Apple kern subtable format: ${format}`)
      }
      pairSubtables.push({
        pairs,
        vertical: isVertical,
        crossStream: isCrossStream,
        minimum: false,
        override: false,
        variation: isVariation,
        tupleIndex,
      })
    }
  } else {
    throw new Error(`Unsupported kern table version: ${version}`)
  }

  return {
    subsetData: { flavor, pairSubtables, contextualSubtables: format1Data },
    getKerning(leftGlyphId: number, rightGlyphId: number, tupleScalars?: readonly number[]): number {
      return this.getPairAdjustment(leftGlyphId, rightGlyphId, 'horizontal', tupleScalars).advance
    },
    getPairAdjustment(
      leftGlyphId: number,
      rightGlyphId: number,
      direction: 'horizontal' | 'vertical',
      tupleScalars?: readonly number[],
      tracking = 0,
    ): { advance: number, crossStream: number | null, minimum: number | null } {
      const key = (leftGlyphId << 16) | rightGlyphId
      const vertical = direction === 'vertical'
      let advance = 0
      let crossStream: number | null = null
      let minimum: number | null = null
      for (let i = 0; i < pairSubtables.length; i++) {
        const subtable = pairSubtables[i]!
        if (subtable.vertical !== vertical) continue
        const raw = subtable.pairs.get(key)
        if (raw === undefined) continue
        let value = raw
        if (subtable.variation) {
          if (tupleScalars === undefined) continue
          if (subtable.tupleIndex >= tupleScalars.length) {
            throw new Error(
              `kern variation tuple index ${subtable.tupleIndex} out of range ${tupleScalars.length}`,
            )
          }
          value = Math.trunc(value * tupleScalars[subtable.tupleIndex]!)
        }
        if (subtable.minimum) {
          minimum = minimum === null ? value : Math.max(minimum, value)
        } else if (subtable.crossStream) {
          crossStream = subtable.override ? value : (crossStream ?? 0) + value
        } else {
          advance = subtable.override ? value : advance + value
        }
      }
      if (minimum !== null && advance + tracking < minimum) advance = minimum - tracking
      return { advance, crossStream, minimum }
    },
    applyContextualKerning(glyphIds: number[], rightToLeft: boolean, boundary: AatStateBoundary = 'text') {
      return this.applyContextualPositioning(glyphIds, 'horizontal', rightToLeft, undefined, boundary)
    },
    applyContextualPositioning(
      glyphIds: number[],
      direction: 'horizontal' | 'vertical',
      rightToLeft: boolean,
      tupleScalars?: readonly number[],
      boundary: AatStateBoundary = 'text',
    ) {
      const n = glyphIds.length
      const xAdvance = new Array<number>(n).fill(0)
      const yAdvance = new Array<number>(n).fill(0)
      const xOffset = new Array<number>(n).fill(0)
      const yOffset = new Array<number>(n).fill(0)
      if (format1Data.length === 0) return { xAdvance, yAdvance, xOffset, yOffset }
      // The shaper reverses a right-to-left run to visual order before
      // positioning; the state machines run over that order. Run reversed, then
      // map the deltas back to the caller's (logical) indices.
      const run = rightToLeft ? glyphIds.slice().reverse() : glyphIds
      const rxa = new Array<number>(n).fill(0)
      const rya = new Array<number>(n).fill(0)
      const rxo = new Array<number>(n).fill(0)
      const ryo = new Array<number>(n).fill(0)
      const vertical = direction === 'vertical'
      for (let s = 0; s < format1Data.length; s++) {
        const data = format1Data[s]!
        if (data.vertical !== vertical) continue
        let scalar = 1
        if (data.variation) {
          if (tupleScalars === undefined) continue
          if (data.tupleIndex >= tupleScalars.length) {
            throw new Error(`kern variation tuple index ${data.tupleIndex} out of range ${tupleScalars.length}`)
          }
          scalar = tupleScalars[data.tupleIndex]!
        }
        runKernFormat1(reader, data, run, rxa, rya, rxo, ryo, scalar, boundary)
      }
      for (let i = 0; i < n; i++) {
        const j = rightToLeft ? n - 1 - i : i
        xAdvance[j]! += rxa[i]!
        yAdvance[j]! += rya[i]!
        xOffset[j]! += rxo[i]!
        yOffset[j]! += ryo[i]!
      }
      return { xAdvance, yAdvance, xOffset, yOffset }
    },
  }
}
