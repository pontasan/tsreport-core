import { BinaryReader } from '../../binary/reader.js'
import {
  parseAatLookupTable,
  parseStateTable,
  runAatStateTable,
  type AatStateBoundary,
  type AatStateTable,
} from './aat-common.js'

const JUST_VERSION = 0x00010000
const JUST_FORMAT = 0
const JUST_RESERVED_FLAGS = 0xEFF0
const JUST_PRIORITY_MASK = 0x000F

/**
 * just table: Justification (Apple Advanced Typography)
 *
 * Header: version(Fixed) + format(2) + horizOffset(2) + vertOffset(2)
 * Each direction has a JustificationHeader:
 *   justClassTableOffset(2) + wdcTableOffset(2) + pcTableOffset(2) + lookupTable
 * All three offsets are measured from the start of the just table.
 * The lookup table values are offsets from the start of the width delta
 * clusters table to WidthDeltaCluster records.
 */

export interface JustWidthDeltaPair {
  /** Justification category (7 bits used) */
  readonly justClass: number
  /** Ratio the glyph can grow on the left/top side (Fixed) */
  readonly beforeGrowLimit: number
  /** Ratio the glyph can shrink on the left/top side (Fixed, negative) */
  readonly beforeShrinkLimit: number
  /** Ratio the glyph can grow on the right/bottom side (Fixed) */
  readonly afterGrowLimit: number
  /** Ratio the glyph can shrink on the right/bottom side (Fixed, negative) */
  readonly afterShrinkLimit: number
  readonly growFlags: number
  readonly shrinkFlags: number
}

/** Type 0: ligature decomposition */
export interface JustDecompositionAction {
  readonly actionClass: number
  readonly actionType: 0
  readonly lowerLimit: number
  readonly upperLimit: number
  readonly order: number
  readonly glyphs: readonly number[]
}

/** Type 1: unconditional add glyph */
export interface JustUnconditionalAddAction {
  readonly actionClass: number
  readonly actionType: 1
  readonly addGlyph: number
}

/** Type 2: conditional add glyph */
export interface JustConditionalAddAction {
  readonly actionClass: number
  readonly actionType: 2
  readonly substThreshold: number
  readonly addGlyph: number
  readonly substGlyph: number
}

/** Type 3: stretch glyph (no action data) */
export interface JustStretchAction {
  readonly actionClass: number
  readonly actionType: 3
}

/** Type 4: ductile glyph (font variation based ductility) */
export interface JustDuctileAction {
  readonly actionClass: number
  readonly actionType: 4
  /** Variation axis tag (normally 'duct') */
  readonly variationAxis: string
  readonly minimumLimit: number
  readonly noStretchValue: number
  readonly maximumLimit: number
}

/** Type 5: repeated add glyph */
export interface JustRepeatedAddAction {
  readonly actionClass: number
  readonly actionType: 5
  readonly flags: number
  readonly glyph: number
}

export type JustPostcompAction =
  | JustDecompositionAction
  | JustUnconditionalAddAction
  | JustConditionalAddAction
  | JustStretchAction
  | JustDuctileAction
  | JustRepeatedAddAction

export interface JustClassTable {
  readonly length: number
  readonly coverage: number
  readonly subFeatureFlags: number
  readonly stateTable: AatStateTable
}

export interface JustDirectionData {
  /** Justification category state table (null if the font has none) */
  readonly classTable: JustClassTable | null
  /** Resolves contextual justification categories for a complete glyph run. */
  getCategories(glyphIds: readonly number[], boundary?: AatStateBoundary): Uint8Array
  getWidthDeltaPairs(glyphId: number): readonly JustWidthDeltaPair[] | null
  getPostcompActions(glyphId: number): readonly JustPostcompAction[] | null
}

export interface JustTable {
  readonly version: number
  readonly format: number
  readonly horizontal: JustDirectionData | null
  readonly vertical: JustDirectionData | null
}

function parseWidthDeltaCluster(reader: BinaryReader, clusterStart: number): JustWidthDeltaPair[] {
  if ((clusterStart & 3) !== 0) throw new Error('just width delta cluster must be longword aligned')
  validateRange(reader, clusterStart, 4, 'just width delta cluster header')
  reader.seek(clusterStart)
  const count = reader.readUint32()
  validateRange(reader, clusterStart + 4, count * 24, 'just width delta cluster records')
  const pairs: JustWidthDeltaPair[] = []
  let previousClass = -1
  for (let i = 0; i < count; i++) {
    const justClass = reader.readUint32()
    const beforeGrowLimit = reader.readFixed()
    const beforeShrinkLimit = reader.readFixed()
    const afterGrowLimit = reader.readFixed()
    const afterShrinkLimit = reader.readFixed()
    const growFlags = reader.readUint16()
    const shrinkFlags = reader.readUint16()
    if (justClass > 0x7F) throw new Error(`just width delta class ${justClass} exceeds 7 bits`)
    if (justClass <= previousClass) throw new Error('just width delta classes must be strictly ascending')
    if (i === 0 && justClass !== 0) throw new Error('just width delta cluster must begin with class 0')
    validateWidthDeltaFlags(growFlags, 'grow')
    validateWidthDeltaFlags(shrinkFlags, 'shrink')
    previousClass = justClass
    pairs.push({
      justClass,
      beforeGrowLimit,
      beforeShrinkLimit,
      afterGrowLimit,
      afterShrinkLimit,
      growFlags,
      shrinkFlags,
    })
  }
  return pairs
}

function parsePostcompActions(reader: BinaryReader, recordStart: number): JustPostcompAction[] {
  validateRange(reader, recordStart, 4, 'just postcompensation record header')
  reader.seek(recordStart)
  const actionCount = reader.readUint32()
  const actions: JustPostcompAction[] = []

  for (let i = 0; i < actionCount; i++) {
    const subrecordStart = reader.position
    const actionClass = reader.readUint16()
    const actionType = reader.readUint16()
    const actionLength = reader.readUint32()
    if (actionClass > 0x7F) throw new Error(`just postcompensation class ${actionClass} exceeds 7 bits`)
    if (actionLength < 8) throw new Error(`just postcompensation action length ${actionLength} is shorter than its header`)
    validateRange(reader, subrecordStart, actionLength, 'just postcompensation action')

    if (actionType === 0) {
      if (actionLength < 20) throw new Error('just decomposition action is truncated')
      const lowerLimit = reader.readFixed()
      const upperLimit = reader.readFixed()
      const order = reader.readUint16()
      const decomposedCount = reader.readUint16()
      if (actionLength < 20 + decomposedCount * 2) throw new Error('just decomposition glyph array is truncated')
      const glyphs: number[] = []
      for (let g = 0; g < decomposedCount; g++) {
        glyphs.push(reader.readUint16())
      }
      actions.push({ actionClass, actionType: 0, lowerLimit, upperLimit, order, glyphs })
    } else if (actionType === 1) {
      if (actionLength < 12) throw new Error('just unconditional-add action is truncated')
      const addGlyph = reader.readUint16()
      actions.push({ actionClass, actionType: 1, addGlyph })
    } else if (actionType === 2) {
      if (actionLength < 16) throw new Error('just conditional-add action is truncated')
      const substThreshold = reader.readFixed()
      const addGlyph = reader.readUint16()
      const substGlyph = reader.readUint16()
      actions.push({ actionClass, actionType: 2, substThreshold, addGlyph, substGlyph })
    } else if (actionType === 3) {
      if (actionLength !== 8) throw new Error('just stretch action must not contain action data')
      actions.push({ actionClass, actionType: 3 })
    } else if (actionType === 4) {
      if (actionLength < 24) throw new Error('just ductile action is truncated')
      const variationAxis = reader.readTag()
      const minimumLimit = reader.readFixed()
      const noStretchValue = reader.readFixed()
      const maximumLimit = reader.readFixed()
      if (minimumLimit > noStretchValue || noStretchValue > maximumLimit) {
        throw new Error('just ductile limits must contain the no-stretch value')
      }
      actions.push({ actionClass, actionType: 4, variationAxis, minimumLimit, noStretchValue, maximumLimit })
    } else if (actionType === 5) {
      if (actionLength < 12) throw new Error('just repeated-add action is truncated')
      const flags = reader.readUint16()
      const glyph = reader.readUint16()
      if (flags !== 0) throw new Error('just repeated-add action flags must be zero')
      actions.push({ actionClass, actionType: 5, flags, glyph })
    } else {
      throw new Error(`Unsupported just postcompensation action type: ${actionType}`)
    }

    // actionLength covers the whole subrecord including header and padding
    reader.seek(subrecordStart + actionLength)
  }

  return actions
}

function parseJustDirection(
  reader: BinaryReader,
  tableStart: number,
  headerOffset: number,
  numGlyphs?: number,
): JustDirectionData {
  reader.seek(tableStart + headerOffset)
  const justClassTableOffset = reader.readUint16()
  const wdcTableOffset = reader.readUint16()
  const pcTableOffset = reader.readUint16()

  // The width delta clusters lookup table immediately follows the header;
  // its values are offsets from the start of the WDC table
  const wdcLookup = parseAatLookupTable(reader, tableStart + headerOffset + 6, numGlyphs)
  const wdcStart = tableStart + wdcTableOffset

  const wdcMap = new Map<number, JustWidthDeltaPair[]>()
  const clusterCache = new Map<number, JustWidthDeltaPair[]>()
  for (const [glyphId, offset] of wdcLookup) {
    let cluster = clusterCache.get(offset)
    if (cluster === undefined) {
      cluster = parseWidthDeltaCluster(reader, wdcStart + offset)
      clusterCache.set(offset, cluster)
    }
    wdcMap.set(glyphId, cluster)
  }

  // Postcompensation table: a lookup table whose values are offsets from the
  // start of the postcompensation table to PostcompensationAction records
  // (a value of 0 means no action)
  const pcMap = new Map<number, JustPostcompAction[]>()
  if (pcTableOffset !== 0) {
    const pcStart = tableStart + pcTableOffset
    const pcLookup = parseAatLookupTable(reader, pcStart, numGlyphs)
    const actionCache = new Map<number, JustPostcompAction[]>()
    for (const [glyphId, offset] of pcLookup) {
      if (offset === 0) continue
      let actions = actionCache.get(offset)
      if (actions === undefined) {
        actions = parsePostcompActions(reader, pcStart + offset)
        actionCache.set(offset, actions)
      }
      pcMap.set(glyphId, actions)
    }
  }

  // Justification class state table: length(2) + coverage(2) + subFeatureFlags(4)
  // followed by a 16-bit state table header
  let classTable: JustClassTable | null = null
  if (justClassTableOffset !== 0) {
    const classStart = tableStart + justClassTableOffset
    reader.seek(classStart)
    const length = reader.readUint16()
    const coverage = reader.readUint16()
    const subFeatureFlags = reader.readUint32()
    if (length < 16) throw new Error('just class table is truncated')
    validateRange(reader, classStart, length, 'just class table')
    const classReader = reader.subReader(classStart + 8, length - 8)
    const stateTable = parseStateTable(classReader, 0, 0, (entry) => {
      const markCategory = (entry.flags & 0x3F80) >>> 7
      const currentCategory = entry.flags & 0x007F
      if (markCategory > 0x7F || currentCategory > 0x7F) {
        throw new Error('just category state entry exceeds 7 bits')
      }
    })
    classTable = { length, coverage, subFeatureFlags, stateTable }
  }

  return {
    classTable,
    getCategories(glyphIds: readonly number[], boundary: AatStateBoundary = 'line'): Uint8Array {
      const categories = new Uint8Array(glyphIds.length)
      if (classTable === null || glyphIds.length === 0) return categories
      const descending = (classTable.coverage & 0x4000) !== 0
      const oriented = descending ? Array.from(glyphIds).reverse() : Array.from(glyphIds)
      let mark = -1
      runAatStateTable(classTable.stateTable, oriented, boundary, ({ index, boundary: atBoundary, entry }) => {
        const current = descending ? glyphIds.length - 1 - index : index
        const markCategory = (entry.flags & 0x3F80) >>> 7
        const currentCategory = entry.flags & 0x007F
        if (markCategory !== 0) {
          if (mark < 0) throw new Error('just category state entry refers to an unset mark')
          categories[mark] = markCategory
        }
        if (!atBoundary && currentCategory !== 0) categories[current] = currentCategory
        if (!atBoundary && (entry.flags & 0x8000) !== 0) mark = current
        return (entry.flags & 0x4000) !== 0
      })
      return categories
    },
    getWidthDeltaPairs(glyphId: number): readonly JustWidthDeltaPair[] | null {
      return wdcMap.get(glyphId) ?? null
    },
    getPostcompActions(glyphId: number): readonly JustPostcompAction[] | null {
      return pcMap.get(glyphId) ?? null
    },
  }
}

export function parseJust(reader: BinaryReader, numGlyphs?: number): JustTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, 10, 'just header')
  const rawVersion = reader.readUint32()
  const version = rawVersion / 65536
  const format = reader.readUint16()
  const horizOffset = reader.readUint16()
  const vertOffset = reader.readUint16()

  if (rawVersion !== JUST_VERSION) throw new Error(`Unsupported just table version: ${version}`)
  if (format !== JUST_FORMAT) throw new Error(`Unsupported just table format: ${format}`)
  const horizontal = horizOffset !== 0 ? parseJustDirection(reader, tableStart, horizOffset, numGlyphs) : null
  const vertical = vertOffset !== 0 ? parseJustDirection(reader, tableStart, vertOffset, numGlyphs) : null

  return { version, format, horizontal, vertical }
}

function validateWidthDeltaFlags(flags: number, label: string): void {
  if ((flags & JUST_RESERVED_FLAGS) !== 0) {
    throw new Error(`just ${label} flags contain reserved bits`)
  }
  const priority = flags & JUST_PRIORITY_MASK
  if (priority > 3) throw new Error(`just ${label} priority ${priority} is invalid`)
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || length > reader.length - offset) {
    throw new Error(`${label} exceeds just table length`)
  }
}
