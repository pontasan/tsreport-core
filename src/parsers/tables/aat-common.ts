import { BinaryReader } from '../../binary/reader.js'

/**
 * AAT Common: shared infrastructure for Apple Advanced Typography
 * - State machine parsers (16-bit / 32-bit extended)
 * - AAT Lookup Table parser (Format 0/2/4/6/8/10)
 */

// --- State Machine ---

export interface AatStateEntry {
  newState: number
  flags: number
  extra: number[]  // subtable type dependent extra data
}

export interface AatStateTable {
  nClasses: number
  /** Reachable state numbers in ascending order, used by semantic rebuilding. */
  readonly stateIndices?: readonly number[]
  getClass(glyphId: number): number
  getEntry(stateIndex: number, classIndex: number): AatStateEntry
}

const AAT_REARRANGEMENT_LEFT = Uint8Array.of(0, 1, 0, 1, 2, 3, 0, 0, 1, 1, 2, 3, 2, 3, 2, 3)
const AAT_REARRANGEMENT_RIGHT = Uint8Array.of(0, 0, 1, 1, 0, 0, 2, 3, 2, 3, 1, 1, 2, 2, 3, 3)

/** Applies one of the sixteen AAT rearrangement verbs to an inclusive range. */
export function applyAatRearrangement(values: number[], first: number, last: number, verb: number): void {
  if (!Number.isInteger(verb) || verb < 0 || verb > 15) throw new Error(`AAT rearrangement verb ${verb} is invalid`)
  if (verb === 0 || first > last || first < 0 || last >= values.length) return
  const length = last - first + 1
  const leftCount = AAT_REARRANGEMENT_LEFT[verb]!
  const rightCount = AAT_REARRANGEMENT_RIGHT[verb]!
  const takeLeft = leftCount === 3 ? 2 : leftCount
  const takeRight = rightCount === 3 ? 2 : rightCount
  if (takeLeft + takeRight > length) return
  if (takeLeft + takeRight === 0) return

  const left0 = values[first]!
  const left1 = takeLeft === 2 ? values[first + 1]! : 0
  const right0 = takeRight === 2 ? values[last - 1]! : values[last]!
  const right1 = takeRight === 2 ? values[last]! : 0
  const middleStart = first + takeLeft
  const middleEnd = last - takeRight + 1
  const middleLength = middleEnd - middleStart

  if (takeRight > takeLeft) {
    for (let i = middleLength - 1; i >= 0; i--) values[first + takeRight + i] = values[middleStart + i]!
  } else if (takeLeft > takeRight) {
    for (let i = 0; i < middleLength; i++) values[first + takeRight + i] = values[middleStart + i]!
  }

  if (takeRight === 1) {
    values[first] = right0
  } else if (takeRight === 2) {
    const reverse = rightCount === 3
    values[first] = reverse ? right1 : right0
    values[first + 1] = reverse ? right0 : right1
  }
  const leftDestination = first + takeRight + middleLength
  if (takeLeft === 1) {
    values[leftDestination] = left0
  } else if (takeLeft === 2) {
    const reverse = leftCount === 3
    values[leftDestination] = reverse ? left1 : left0
    values[leftDestination + 1] = reverse ? left0 : left1
  }
}

export type AatStateBoundary = 'text' | 'line'

export interface AatProcessContext {
  boundary?: AatStateBoundary
  vertical?: boolean
  rightToLeft?: boolean
}

export interface AatStateTransition {
  index: number
  boundary: boolean
  entry: AatStateEntry
}

/**
 * Executes a classic or extended AAT state table in ascending buffer order.
 * Subtable coverage direction is handled by the caller by orienting the buffer.
 * The callback returns true for a table-specific `dontAdvance` action.
 */
export function runAatStateTable(
  stateTable: AatStateTable,
  glyphIds: number[],
  boundary: AatStateBoundary,
  transition: (value: AatStateTransition) => boolean,
): void {
  let state = boundary === 'line' ? 1 : 0
  let index = 0
  const visited = new Set<string>()

  while (index <= glyphIds.length) {
    const atBoundary = index === glyphIds.length
    const glyphId = atBoundary ? -1 : glyphIds[index]!
    const glyphClass = atBoundary
      ? (boundary === 'line' ? 3 : 0)
      : stateTable.getClass(glyphId)
    const cycleKey = `${state}:${glyphClass}:${glyphId}`
    if (visited.has(cycleKey)) {
      throw new Error(`AAT state machine has a non-advancing cycle at glyph ${index}`)
    }
    visited.add(cycleKey)

    const entry = stateTable.getEntry(state, glyphClass)
    const dontAdvance = transition({ index, boundary: atBoundary, entry })
    state = entry.newState
    if (!dontAdvance) {
      if (atBoundary) return
      index++
      visited.clear()
    }
  }
}

export interface AatInsertionRun {
  glyphs: number[]
  clusters: number[]
  breakClusters?: number[]
  flags?: number[]
}

/** Executes the insertion-state semantics shared by mort type 5 and morx type 5. */
export function runAatInsertionStateTable(
  stateTable: AatStateTable,
  run: AatInsertionRun,
  boundary: AatStateBoundary,
  noListValue: number,
  readList: (value: number, count: number) => number[],
): AatInsertionRun {
  interface Slot {
    glyph: number
    cluster: number
    breakCluster: number
    flag: number
    ancestry: ReadonlySet<string>
  }

  const output = new Array<Slot>(run.glyphs.length)
  for (let i = 0; i < run.glyphs.length; i++) {
    output[i] = {
      glyph: run.glyphs[i]!,
      cluster: run.clusters[i]!,
      breakCluster: run.breakClusters?.[i] ?? run.clusters[i]!,
      flag: run.flags?.[i] ?? 0,
      ancestry: EMPTY_AAT_ANCESTRY,
    }
  }

  let state = boundary === 'line' ? 1 : 0
  let cursor = 0
  let marked: Slot | null = null
  let lastSlot: Slot | null = null
  const visited = new Set<string>()

  while (cursor <= output.length) {
    const atBoundary = cursor === output.length
    const current = atBoundary ? null : output[cursor]!
    const glyphClass = atBoundary
      ? (boundary === 'line' ? 3 : 0)
      : stateTable.getClass(current!.glyph)
    const key = `${state}:${glyphClass}:${current?.glyph ?? -1}`
    if (visited.has(key)) {
      throw new Error(`AAT insertion state machine has a non-advancing cycle at glyph ${cursor}`)
    }
    visited.add(key)

    const entry = stateTable.getEntry(state, glyphClass)
    const currentCount = (entry.flags >>> 5) & 0x1F
    const markedCount = entry.flags & 0x001F
    const dontAdvance = (entry.flags & 0x4000) !== 0

    if (currentCount !== 0 && entry.extra[0] === noListValue) {
      throw new Error('AAT current insertion count requires an insertion list')
    }
    if (markedCount !== 0 && entry.extra[1] === noListValue) {
      throw new Error('AAT marked insertion count requires an insertion list')
    }
    if (markedCount !== 0 && marked === null) {
      throw new Error('AAT marked insertion has no marked glyph')
    }
    if (current !== null && current.ancestry.has(key) && currentCount !== 0 && dontAdvance) {
      throw new Error(`AAT insertion state machine recursively inserts glyph ${current.glyph}`)
    }

    let mergedBreakCluster: number | null = null
    if (marked !== null && current !== null && (markedCount !== 0 || currentCount !== 0)) {
      const markedIndex = output.indexOf(marked)
      const currentIndex = output.indexOf(current)
      const start = Math.min(markedIndex, currentIndex)
      const end = Math.max(markedIndex, currentIndex)
      mergedBreakCluster = output[start]!.breakCluster
      for (let i = start + 1; i <= end; i++) {
        if (output[i]!.breakCluster < mergedBreakCluster) mergedBreakCluster = output[i]!.breakCluster
      }
      for (let i = start; i <= end; i++) output[i]!.breakCluster = mergedBreakCluster
    }

    if (markedCount !== 0) {
      const currentCluster = current?.cluster ?? lastSlot?.cluster ?? marked!.cluster
      const cluster = (entry.flags & 0x1000) !== 0 ? marked!.cluster : currentCluster
      insertAatSlots(output, marked!, (entry.flags & 0x0400) !== 0,
        readList(entry.extra[1]!, markedCount), cluster,
        mergedBreakCluster ?? marked!.breakCluster, marked!.flag, marked!.ancestry, key)
    }

    if (current !== null && (entry.flags & 0x8000) !== 0) marked = current

    let nextCursor: number
    if (currentCount !== 0) {
      const glyphs = readList(entry.extra[0]!, currentCount)
      const before = (entry.flags & 0x0800) !== 0
      const currentCluster = current?.cluster ?? lastSlot?.cluster ?? marked?.cluster ?? 0
      const cluster = (entry.flags & 0x2000) !== 0 || marked === null
        ? currentCluster
        : marked.cluster
      const targetIndex = current === null ? output.length : output.indexOf(current)
      if (targetIndex < 0) throw new Error('AAT current insertion target is no longer in the glyph buffer')
      const ancestry = current?.ancestry ?? EMPTY_AAT_ANCESTRY
      const slots = createAatSlots(glyphs, cluster, current?.flag ?? lastSlot?.flag ?? marked?.flag ?? 0, ancestry, key)
      for (let i = 0; i < slots.length; i++) {
        slots[i]!.breakCluster = mergedBreakCluster ?? current?.breakCluster ?? lastSlot?.breakCluster ?? cluster
      }
      const insertionIndex = targetIndex + (before ? 0 : 1)
      output.splice(insertionIndex, 0, ...slots)
      if (current === null) {
        nextCursor = dontAdvance ? insertionIndex : output.length
      } else if (before) {
        nextCursor = targetIndex + glyphs.length + (dontAdvance ? 0 : 1)
      } else {
        nextCursor = targetIndex + 1 + (dontAdvance ? 0 : glyphs.length)
      }
    } else if (current === null) {
      if (!dontAdvance) return aatSlotsToRun(output)
      nextCursor = output.length
    } else {
      const currentIndex = output.indexOf(current)
      if (currentIndex < 0) throw new Error('AAT current glyph is no longer in the glyph buffer')
      nextCursor = currentIndex + (dontAdvance ? 0 : 1)
    }

    state = entry.newState
    if (!(atBoundary && nextCursor === output.length)
      && (nextCursor !== cursor || current !== output[nextCursor])) visited.clear()
    if (current !== null) lastSlot = current
    cursor = nextCursor
  }

  return aatSlotsToRun(output)
}

const EMPTY_AAT_ANCESTRY: ReadonlySet<string> = new Set<string>()

function createAatSlots(
  glyphs: number[],
  cluster: number,
  flag: number,
  ancestry: ReadonlySet<string>,
  transitionKey: string,
): { glyph: number, cluster: number, breakCluster: number, flag: number, ancestry: ReadonlySet<string> }[] {
  const nextAncestry = new Set(ancestry)
  nextAncestry.add(transitionKey)
  const slots = new Array<{ glyph: number, cluster: number, breakCluster: number, flag: number, ancestry: ReadonlySet<string> }>(glyphs.length)
  for (let i = 0; i < glyphs.length; i++) {
    slots[i] = { glyph: glyphs[i]!, cluster, breakCluster: cluster, flag, ancestry: nextAncestry }
  }
  return slots
}

function insertAatSlots<T extends { glyph: number, cluster: number, breakCluster: number, flag: number, ancestry: ReadonlySet<string> }>(
  output: T[],
  target: T,
  before: boolean,
  glyphs: number[],
  cluster: number,
  breakCluster: number,
  flag: number,
  ancestry: ReadonlySet<string>,
  transitionKey: string,
): void {
  const index = output.indexOf(target)
  if (index < 0) throw new Error('AAT marked insertion target is no longer in the glyph buffer')
  const slots = createAatSlots(glyphs, cluster, flag, ancestry, transitionKey)
  for (let i = 0; i < slots.length; i++) slots[i]!.breakCluster = breakCluster
  output.splice(index + (before ? 0 : 1), 0, ...slots as T[])
}

function aatSlotsToRun(output: readonly { glyph: number, cluster: number, breakCluster: number, flag: number }[]): AatInsertionRun {
  const glyphs = new Array<number>(output.length)
  const clusters = new Array<number>(output.length)
  const breakClusters = new Array<number>(output.length)
  const flags = new Array<number>(output.length)
  for (let i = 0; i < output.length; i++) {
    glyphs[i] = output[i]!.glyph
    clusters[i] = output[i]!.cluster
    breakClusters[i] = output[i]!.breakCluster
    flags[i] = output[i]!.flag
  }
  return { glyphs, clusters, breakClusters, flags }
}

/**
 * Extended State Table (32-bit, used by morx)
 * Header: nClasses(4) + classTableOffset(4) + stateArrayOffset(4) + entryTableOffset(4)
 * @param reader BinaryReader
 * @param subtableStart start position of the subtable
 * @param extraPerEntry number of extra Uint16 values per entry
 */
export function parseExtendedStateTable(
  reader: BinaryReader,
  subtableStart: number,
  extraPerEntry: number,
  numGlyphs?: number,
  validateEntry?: (entry: AatStateEntry, index: number) => void,
): AatStateTable {
  if (extraPerEntry < 0 || !Number.isInteger(extraPerEntry)) {
    throw new Error(`AAT extended state table invalid extra field count: ${extraPerEntry}`)
  }
  validateAatLookupRange(reader, subtableStart, 16, 'AAT extended state table header')
  reader.seek(subtableStart)
  const nClasses = reader.readUint32()
  const classTableOffset = reader.readUint32()
  const stateArrayOffset = reader.readUint32()
  const entryTableOffset = reader.readUint32()

  if (nClasses < 4) {
    throw new Error('AAT extended state table requires the four predefined classes')
  }
  const stateArrayStart = subtableStart + stateArrayOffset
  const entryTableStart = subtableStart + entryTableOffset
  const classTableStart = subtableStart + classTableOffset
  if (classTableOffset < 16 || stateArrayOffset < 16 || entryTableOffset < 16
    || classTableStart >= reader.length || stateArrayStart >= reader.length || entryTableStart >= reader.length) {
    throw new Error('AAT extended state table offset exceeds table length')
  }
  if ((stateArrayOffset & 1) !== 0 || (entryTableOffset & 1) !== 0) {
    throw new Error('AAT extended state and entry tables must be word aligned')
  }
  if (nClasses > Math.floor((reader.length - stateArrayStart) / 2)) {
    throw new Error('AAT extended state table state row exceeds table length')
  }

  const classLookup = parseAatLookupTable(reader, classTableStart, numGlyphs)
  for (const [glyphId, cls] of classLookup) {
    if (cls >= nClasses) {
      throw new Error(`AAT extended state table class ${cls} for glyph ${glyphId} exceeds nClasses ${nClasses}`)
    }
    validateExplicitAatStateClass(cls, glyphId, 'AAT extended state table')
  }

  const entrySize = 4 + extraPerEntry * 2
  const stateRows = new Map<number, Uint16Array>()
  const entries = new Map<number, AatStateEntry>()
  const pendingStates = [0, 1]
  let pendingIndex = 0
  while (pendingIndex < pendingStates.length) {
    const state = pendingStates[pendingIndex++]!
    if (stateRows.has(state)) continue
    const rowStart = stateArrayStart + state * nClasses * 2
    validateAatLookupRange(reader, rowStart, nClasses * 2, `AAT extended state ${state}`)
    reader.seek(rowStart)
    const row = new Uint16Array(nClasses)
    for (let cls = 0; cls < nClasses; cls++) row[cls] = reader.readUint16()
    stateRows.set(state, row)

    for (let cls = 0; cls < nClasses; cls++) {
      const entryIndex = row[cls]!
      if (entries.has(entryIndex)) continue
      const entryStart = entryTableStart + entryIndex * entrySize
      validateAatLookupRange(reader, entryStart, entrySize, `AAT extended state entry ${entryIndex}`)
      reader.seek(entryStart)
      const newState = reader.readUint16()
      const flags = reader.readUint16()
      const extra: number[] = []
      for (let e = 0; e < extraPerEntry; e++) extra.push(reader.readUint16())
      const entry = { newState, flags, extra }
      validateEntry?.(entry, entryIndex)
      entries.set(entryIndex, entry)
      if (!stateRows.has(newState)) pendingStates.push(newState)
    }
  }

  return {
    nClasses,
    stateIndices: [...stateRows.keys()].sort(function (left, right) { return left - right }),
    getClass(glyphId: number): number {
      if (glyphId === 0xFFFF) return 2
      const cls = classLookup.get(glyphId)
      return cls !== undefined ? cls : 1
    },
    getEntry(stateIndex: number, classIndex: number): AatStateEntry {
      if (classIndex < 0 || classIndex >= nClasses) {
        throw new Error(`AAT extended state table class index out of range: ${classIndex}`)
      }
      const row = stateRows.get(stateIndex)
      if (row === undefined) {
        throw new Error(`AAT extended state table state index out of range: ${stateIndex}`)
      }
      const entry = entries.get(row[classIndex]!)
      if (entry === undefined) {
        throw new Error(`AAT extended state table entry index out of range: ${row[classIndex]}`)
      }
      return entry
    },
  }
}

/**
 * 16-bit State Table (used by mort and kern format 1)
 * Header: nClasses(2) + classTableOffset(2) + stateArrayOffset(2) + entryTableOffset(2)
 * @param reader BinaryReader
 * @param subtableStart start position of the subtable
 * @param extraPerEntry number of extra bytes per entry (each a Uint16)
 */
export function parseStateTable(
  reader: BinaryReader,
  subtableStart: number,
  extraPerEntry: number,
  validateEntry?: (entry: AatStateEntry, index: number) => void,
): AatStateTable {
  if (extraPerEntry < 0 || !Number.isInteger(extraPerEntry)) {
    throw new Error(`AAT state table invalid extra field count: ${extraPerEntry}`)
  }
  validateAatLookupRange(reader, subtableStart, 8, 'AAT state table header')
  reader.seek(subtableStart)
  const nClasses = reader.readUint16()
  const classTableOffset = reader.readUint16()
  const stateArrayOffset = reader.readUint16()
  const entryTableOffset = reader.readUint16()

  if (nClasses < 4) {
    throw new Error('AAT state table requires the four predefined classes')
  }
  if (nClasses > 0xFF) {
    throw new Error(`AAT state table stateSize must fit in 8 bits, got ${nClasses}`)
  }

  const classTableStart = subtableStart + classTableOffset
  const stateArrayStart = subtableStart + stateArrayOffset
  const entryTableStart = subtableStart + entryTableOffset
  if (classTableOffset < 8 || stateArrayOffset < 8 || entryTableOffset < 8
    || classTableStart >= reader.length || stateArrayStart >= reader.length || entryTableStart >= reader.length) {
    throw new Error('AAT state table offset exceeds table length')
  }
  if ((classTableOffset & 1) !== 0 || (entryTableOffset & 1) !== 0) {
    throw new Error('AAT state class and entry tables must be word aligned')
  }

  validateAatLookupRange(reader, classTableStart, 4, 'AAT state class table header')
  reader.seek(classTableStart)
  const firstGlyph = reader.readUint16()
  const nGlyphs = reader.readUint16()
  if (firstGlyph + nGlyphs > 0x10000) throw new Error('AAT state class table glyph range exceeds 16-bit glyph IDs')
  validateAatLookupRange(reader, reader.position, nGlyphs, 'AAT state class array')
  const classArray = reader.readBytes(nGlyphs)
  for (let i = 0; i < classArray.length; i++) {
    if (classArray[i]! >= nClasses) {
      throw new Error(`AAT state table class ${classArray[i]} for glyph ${firstGlyph + i} exceeds nClasses ${nClasses}`)
    }
    validateExplicitAatStateClass(classArray[i]!, firstGlyph + i, 'AAT state table')
  }

  const entrySize = 4 + extraPerEntry * 2
  const stateRows = new Map<number, Uint8Array>()
  const entries = new Map<number, AatStateEntry>()
  const pendingStates = [0, 1]
  let pendingIndex = 0
  while (pendingIndex < pendingStates.length) {
    const state = pendingStates[pendingIndex++]!
    if (stateRows.has(state)) continue
    const rowStart = stateArrayStart + state * nClasses
    validateAatLookupRange(reader, rowStart, nClasses, `AAT state ${state}`)
    reader.seek(rowStart)
    const row = reader.readBytes(nClasses)
    stateRows.set(state, row)

    for (let cls = 0; cls < nClasses; cls++) {
      const entryIndex = row[cls]!
      if (entries.has(entryIndex)) continue
      const entryStart = entryTableStart + entryIndex * entrySize
      validateAatLookupRange(reader, entryStart, entrySize, `AAT state entry ${entryIndex}`)
      reader.seek(entryStart)
      const newStateOffset = reader.readUint16()
      const flags = reader.readUint16()
      const extra: number[] = []
      for (let e = 0; e < extraPerEntry; e++) extra.push(reader.readUint16())
      const stateDelta = newStateOffset - stateArrayOffset
      if (stateDelta % nClasses !== 0) {
        throw new Error(`AAT state table newState offset is not state-aligned: ${newStateOffset}`)
      }
      const newState = stateDelta / nClasses
      const newRowStart = stateArrayStart + newState * nClasses
      validateAatLookupRange(reader, newRowStart, nClasses, `AAT state ${newState}`)
      const entry = { newState, flags, extra }
      validateEntry?.(entry, entryIndex)
      entries.set(entryIndex, entry)
      if (!stateRows.has(newState)) pendingStates.push(newState)
    }
  }

  return {
    nClasses,
    stateIndices: [...stateRows.keys()].sort(function (left, right) { return left - right }),
    getClass(glyphId: number): number {
      if (glyphId === 0xFFFF) return 2
      if (glyphId >= firstGlyph && glyphId < firstGlyph + nGlyphs) {
        return classArray[glyphId - firstGlyph]!
      }
      return 1 // out of bounds
    },
    getEntry(stateIndex: number, classIndex: number): AatStateEntry {
      if (classIndex < 0 || classIndex >= nClasses) {
        throw new Error(`AAT state table class index out of range: ${classIndex}`)
      }
      const row = stateRows.get(stateIndex)
      if (row === undefined) {
        throw new Error(`AAT state table state index out of range: ${stateIndex}`)
      }
      const entry = entries.get(row[classIndex]!)
      if (entry === undefined) {
        throw new Error(`AAT state table entry index out of range: ${row[classIndex]}`)
      }
      return entry
    },
  }
}

function validateExplicitAatStateClass(classCode: number, glyphId: number, label: string): void {
  if (classCode === 0 || classCode === 2 || classCode === 3) {
    throw new Error(`${label} glyph ${glyphId} must not explicitly use predefined class ${classCode}`)
  }
}

// --- AAT Lookup Table ---

/**
 * AAT Lookup Table parser
 * Format 0: Simple array
 * Format 2: Segment single
 * Format 4: Segment array
 * Format 6: Single table (sorted glyph → value pairs)
 * Format 8: Trimmed array
 * Format 10: Extended trimmed array (1/2/4/8-byte values)
 */
export function parseAatLookupTable(
  reader: BinaryReader,
  offset: number,
  numGlyphs?: number,
  implicitValueSize = 2,
): Map<number, number> {
  if (!isSupportedAatLookupValueSize(implicitValueSize)) {
    throw new Error(`AAT lookup implicit value size ${implicitValueSize} is invalid`)
  }
  validateAatLookupRange(reader, offset, 2, 'AAT lookup header')
  reader.seek(offset)
  const format = reader.readUint16()
  const result = new Map<number, number>()

  if (format === 0) {
    if (numGlyphs === undefined) {
      throw new Error('AAT lookup format 0 requires numGlyphs')
    }
    validateAatLookupRange(reader, offset + 2, numGlyphs * implicitValueSize, 'AAT lookup format 0 values')
    for (let glyph = 0; glyph < numGlyphs; glyph++) {
      result.set(glyph, readAatLookupValue(reader, implicitValueSize))
    }
  } else if (format === 2) {
    // Segment single: BinSrchHeader + segments
    validateAatLookupRange(reader, offset + 2, 10, 'AAT lookup format 2 binary search header')
    const unitSize = reader.readUint16()
    const nUnits = reader.readUint16()
    reader.skip(6) // searchRange, entrySelector, rangeShift
    if (unitSize < 6) {
      throw new Error(`AAT lookup format 2 invalid unitSize ${unitSize}`)
    }
    const valueSize = unitSize - 4
    if (!isSupportedAatLookupValueSize(valueSize)) {
      throw new Error(`AAT lookup format 2 invalid value size ${valueSize}`)
    }
    validateAatLookupRange(reader, offset + 12, nUnits * unitSize, 'AAT lookup format 2 segments')
    let previousLastGlyph = -1
    for (let i = 0; i < nUnits; i++) {
      const lastGlyph = reader.readUint16()
      const firstGlyph = reader.readUint16()
      const value = readAatLookupValue(reader, valueSize)
      if (lastGlyph === 0xFFFF) break // sentinel
      // A degenerate segment (firstGlyph > lastGlyph) maps no glyphs; HarfBuzz
      // tolerates it, so skip it rather than rejecting the whole table.
      if (firstGlyph > lastGlyph) continue
      validateSegmentOrder(firstGlyph, lastGlyph, previousLastGlyph, `AAT lookup format 2 segment ${i}`)
      previousLastGlyph = lastGlyph
      for (let g = firstGlyph; g <= lastGlyph; g++) {
        result.set(g, value)
      }
    }
  } else if (format === 4) {
    // Segment array: BinSrchHeader + segments with value arrays
    validateAatLookupRange(reader, offset + 2, 10, 'AAT lookup format 4 binary search header')
    const unitSize = reader.readUint16()
    const nUnits = reader.readUint16()
    reader.skip(6)
    if (unitSize < 6) {
      throw new Error(`AAT lookup format 4 invalid unitSize ${unitSize}`)
    }
    validateAatLookupRange(reader, offset + 12, nUnits * unitSize, 'AAT lookup format 4 segments')
    const extraUnitBytes = unitSize - 6
    const segments: { lastGlyph: number, firstGlyph: number, valueArrayOffset: number }[] = []
    let previousLastGlyph = -1
    for (let i = 0; i < nUnits; i++) {
      const lastGlyph = reader.readUint16()
      const firstGlyph = reader.readUint16()
      const valueArrayOffset = reader.readUint16()
      reader.skip(extraUnitBytes)
      if (lastGlyph === 0xFFFF) break
      if (firstGlyph > lastGlyph) continue // degenerate empty segment (HarfBuzz-tolerant)
      validateSegmentOrder(firstGlyph, lastGlyph, previousLastGlyph, `AAT lookup format 4 segment ${i}`)
      previousLastGlyph = lastGlyph
      segments.push({ lastGlyph, firstGlyph, valueArrayOffset })
    }
    for (const seg of segments) {
      validateAatLookupRange(
        reader,
        offset + seg.valueArrayOffset,
        (seg.lastGlyph - seg.firstGlyph + 1) * implicitValueSize,
        `AAT lookup format 4 value array for glyph ${seg.firstGlyph}`,
      )
      reader.seek(offset + seg.valueArrayOffset)
      for (let g = seg.firstGlyph; g <= seg.lastGlyph; g++) {
        result.set(g, readAatLookupValue(reader, implicitValueSize))
      }
    }
  } else if (format === 6) {
    // Single table: BinSrchHeader + sorted (glyph, value) pairs
    validateAatLookupRange(reader, offset + 2, 10, 'AAT lookup format 6 binary search header')
    const unitSize = reader.readUint16()
    const nUnits = reader.readUint16()
    reader.skip(6)
    if (unitSize < 4) {
      throw new Error(`AAT lookup format 6 invalid unitSize ${unitSize}`)
    }
    const valueSize = unitSize - 2
    if (!isSupportedAatLookupValueSize(valueSize)) {
      throw new Error(`AAT lookup format 6 invalid value size ${valueSize}`)
    }
    validateAatLookupRange(reader, offset + 12, nUnits * unitSize, 'AAT lookup format 6 entries')
    let previousGlyph = -1
    for (let i = 0; i < nUnits; i++) {
      const glyph = reader.readUint16()
      const value = readAatLookupValue(reader, valueSize)
      if (glyph === 0xFFFF) break
      if (glyph <= previousGlyph) {
        throw new Error(`AAT lookup format 6 glyph ${glyph} must be greater than previous glyph ${previousGlyph}`)
      }
      previousGlyph = glyph
      result.set(glyph, value)
    }
  } else if (format === 8) {
    // Trimmed array: firstGlyph(2) + glyphCount(2) + implicit-size values
    validateAatLookupRange(reader, offset + 2, 4, 'AAT lookup format 8 header')
    const firstGlyph = reader.readUint16()
    const glyphCount = reader.readUint16()
    validateTrimmedGlyphRange(firstGlyph, glyphCount, 'AAT lookup format 8')
    validateAatLookupRange(reader, offset + 6, glyphCount * implicitValueSize, 'AAT lookup format 8 values')
    for (let i = 0; i < glyphCount; i++) {
      result.set(firstGlyph + i, readAatLookupValue(reader, implicitValueSize))
    }
  } else if (format === 10) {
    // Extended trimmed array: unitSize(2) + firstGlyph(2) + glyphCount(2) + variable-size values
    validateAatLookupRange(reader, offset + 2, 6, 'AAT lookup format 10 header')
    const unitSize = reader.readUint16()
    const firstGlyph = reader.readUint16()
    const glyphCount = reader.readUint16()
    if (!isSupportedAatLookupValueSize(unitSize)) {
      throw new Error(`AAT lookup format 10 invalid unitSize ${unitSize}`)
    }
    validateTrimmedGlyphRange(firstGlyph, glyphCount, 'AAT lookup format 10')
    validateAatLookupRange(reader, offset + 8, glyphCount * unitSize, 'AAT lookup format 10 values')
    for (let i = 0; i < glyphCount; i++) {
      result.set(firstGlyph + i, readAatLookupValue(reader, unitSize))
    }
  } else {
    throw new Error(`Unsupported AAT lookup format: ${format}`)
  }

  return result
}

function readAatLookupValue(reader: BinaryReader, unitSize: number): number {
  if (unitSize === 1) return reader.readUint8()
  if (unitSize === 2) return reader.readUint16()
  if (unitSize === 4) return reader.readUint32()
  if (unitSize === 8) {
    const value = reader.readUint64()
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('AAT lookup format 10 value exceeds safe integer range')
    }
    return Number(value)
  }
  throw new Error(`AAT lookup value invalid size ${unitSize}`)
}

function isSupportedAatLookupValueSize(unitSize: number): boolean {
  return unitSize === 1 || unitSize === 2 || unitSize === 4 || unitSize === 8
}

// Degenerate segments (firstGlyph > lastGlyph) are filtered by the callers, so
// this only enforces segment ordering. A segment whose firstGlyph equals the
// previous lastGlyph (adjacent single-glyph segments touching at one glyph) is
// a benign quirk of shipping AAT fonts that HarfBuzz tolerates — later segments
// win — so only a strictly-backward firstGlyph is rejected.
function validateSegmentOrder(firstGlyph: number, lastGlyph: number, previousLastGlyph: number, label: string): void {
  if (firstGlyph < previousLastGlyph) {
    throw new Error(`${label} overlaps or is not sorted after previous lastGlyph ${previousLastGlyph}`)
  }
}

function validateTrimmedGlyphRange(firstGlyph: number, glyphCount: number, label: string): void {
  if (glyphCount === 0) return
  const lastGlyph = firstGlyph + glyphCount - 1
  if (lastGlyph > 0xFFFF) {
    throw new Error(`${label} glyph range exceeds 16-bit glyph IDs`)
  }
}

function validateAatLookupRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || offset + length > reader.length) {
    throw new Error(`${label} exceeds AAT lookup table length`)
  }
}
