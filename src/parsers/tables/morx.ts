import { BinaryReader } from '../../binary/reader.js'
import {
  parseExtendedStateTable,
  parseAatLookupTable,
  applyAatRearrangement,
  runAatInsertionStateTable,
  runAatStateTable,
  type AatProcessContext,
  type AatStateBoundary,
} from './aat-common.js'

const MORX_HEADER_SIZE = 8
const MORX_CHAIN_HEADER_SIZE = 16
const MORX_FEATURE_ENTRY_SIZE = 12
const MORX_SUBTABLE_HEADER_SIZE = 12
const MORX_COVERAGE_RESERVED_MASK = 0x0FFFFF00
const MORX_COVERAGE_TYPE_MASK = 0x000000FF

/**
 * morx table: Extended Glyph Metamorphosis (Apple AAT)
 * AAT counterpart of GSUB. 5 subtable types:
 * Type 0: Rearrangement, Type 1: Contextual, Type 2: Ligature
 * Type 4: Noncontextual, Type 5: Insertion
 */

export interface MorxChain {
  defaultFlags: number
  features: { featureType: number, featureSetting: number, enableFlags: number, disableFlags: number }[]
  subtables: MorxSubtable[]
}

/**
 * A glyph run carried through the morx pipeline together with a parallel
 * cluster array. clusters[i] is the source-cluster index the output glyph i
 * belongs to (ligatures merge to the minimum component cluster, insertions
 * inherit an adjacent cluster, rearrangement reorders alongside the glyphs),
 * so downstream positioning (GPOS/AAT/fallback) can find each glyph's base.
 */
export interface MorxRun {
  glyphs: number[]
  /** CoreText-style source association for each glyph. */
  clusters: number[]
  /** Opaque per-glyph properties carried through every AAT action. */
  flags?: number[]
  /** HarfBuzz-style merged cluster used to prohibit breaks inside an AAT action. */
  breakClusters?: number[]
  /**
   * Marker-preserved view of `glyphs`: identical, but glyphs deleted by ligature
   * substitution are kept in place as 0xFFFF markers (with their clusters in
   * `clustersWithDeletions`). Only populated on the final applySubstitutionsTracked
   * result. AAT 'kern'/'kerx' state machines position marks over this buffer —
   * the deleted-glyph markers break spurious state transitions exactly as
   * HarfBuzz does (it removes deleted glyphs only after positioning).
   */
  glyphsWithDeletions?: number[]
  clustersWithDeletions?: number[]
}

export interface MorxSubtable {
  type: number
  subFeatureFlags: number
  /** Coverage: subtable applies only to vertical text (0x80000000). */
  vertical: boolean
  /** Coverage: state machine processes the run last-to-first (0x40000000). */
  descending: boolean
  /** Coverage: applies regardless of text direction (0x20000000). */
  allDirections: boolean
  /** Coverage: process in logical (input) order, ignoring text direction (0x10000000). */
  logical: boolean
  /** morx v3 run-level subtable filter; null means no coverage bitfield. */
  glyphCoverage: Uint8Array | null
  readonly subsetData: MorxSubsetSubtableData
  apply(run: MorxRun, boundary: AatStateBoundary): MorxRun
}

export interface MorxTable {
  readonly version: number
  readonly chains: MorxChain[]
  /** Glyphs stored as substitution, ligature, or insertion results. */
  readonly referencedGlyphIds: readonly number[]
  applySubstitutions(glyphIds: number[], features?: readonly MorxFeatureSelector[], rightToLeft?: boolean, context?: AatProcessContext): number[]
  /** Like applySubstitutions but tracks source clusters through the pipeline. */
  applySubstitutionsTracked(run: MorxRun, features?: readonly MorxFeatureSelector[], rightToLeft?: boolean, context?: AatProcessContext): MorxRun
}

export type MorxSubsetSubtableData =
  | { readonly type: 0, readonly stateTable: ReturnType<typeof parseExtendedStateTable> }
  | {
      readonly type: 1
      readonly stateTable: ReturnType<typeof parseExtendedStateTable>
      readonly lookups: ReadonlyMap<number, ReadonlyMap<number, number>>
      readonly sourceNumGlyphs: number | undefined
    }
  | {
      readonly type: 2
      readonly stateTable: ReturnType<typeof parseExtendedStateTable>
      readonly ligatureActions: Uint32Array
      readonly components: Uint16Array
      readonly ligatures: Uint16Array
      readonly sourceNumGlyphs: number | undefined
    }
  | { readonly type: 4, readonly lookup: ReadonlyMap<number, number>, readonly sourceNumGlyphs: number | undefined }
  | {
      readonly type: 5
      readonly stateTable: ReturnType<typeof parseExtendedStateTable>
      readonly insertionGlyphs: Uint16Array
      readonly insertionUsed: Uint8Array
      readonly sourceNumGlyphs: number | undefined
    }

export interface MorxFeatureSelector {
  featureType: number
  featureSetting: number
}

// Rearrangement verbs (Type 0)
const REARRANGEMENT_ACTIONS: ((a: number, b: number, c: number, d: number) => number[])[] = [
  (a, b, c, d) => [a, b, c, d], // 0: no change
  (a, b, c, d) => [d, b, c, a], // 1: Ax → xA
  (a, b, c, d) => [c, d, a, b], // 2: xD → Dx (actually: CD → DC for the marked range)
  (a, b, c, d) => [c, d, b, a], // 3: AxD → DxA
  // For multi-glyph ranges, these are more complex but the core pattern holds
]

function parseType0Rearrangement(reader: BinaryReader, subtableStart: number, numGlyphs?: number): MorxSubtable {
  const stateTable = parseExtendedStateTable(reader, subtableStart, 0, numGlyphs, entry => {
    if ((entry.flags & 0x1FF0) !== 0) throw new Error('morx rearrangement entry uses reserved flags')
  })

  return {
    type: 0,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
    logical: false,
    glyphCoverage: null,
    subsetData: { type: 0, stateTable },
    apply(run: MorxRun, boundary: AatStateBoundary): MorxRun {
      const result = run.glyphs.slice()
      const clusters = run.clusters.slice()
      const flags = run.flags?.slice()
      const breakClusters = run.breakClusters!.slice()
      let markFirst = -1
      let markLast = -1

      runAatStateTable(stateTable, result, boundary, transition => {
        const entry = transition.entry
        if (!transition.boundary && (entry.flags & 0x8000)) markFirst = transition.index
        if (!transition.boundary && (entry.flags & 0x2000)) markLast = transition.index

        const verb = entry.flags & 0x000F
        if (verb !== 0 && markFirst >= 0 && markLast >= 0) {
          applyAatRearrangement(result, markFirst, markLast, verb)
          // Reorder clusters with the identical position permutation.
          applyAatRearrangement(clusters, markFirst, markLast, verb)
          if (flags !== undefined) applyAatRearrangement(flags, markFirst, markLast, verb)
          let merged = breakClusters[markFirst]!
          for (let i = markFirst + 1; i <= markLast; i++) if (breakClusters[i]! < merged) merged = breakClusters[i]!
          for (let i = markFirst; i <= markLast; i++) breakClusters[i] = merged
        }
        return (entry.flags & 0x4000) !== 0
      })

      return { glyphs: result, clusters, flags, breakClusters }
    },
  }
}

function parseType1Contextual(
  reader: BinaryReader,
  subtableStart: number,
  references: Set<number>,
  numGlyphs?: number,
): MorxSubtable {
  const lookupIndices = new Set<number>()
  const stateTable = parseExtendedStateTable(reader, subtableStart, 2, numGlyphs, entry => {
    if ((entry.flags & 0x3FFF) !== 0) throw new Error('morx contextual entry uses reserved flags')
    if (entry.extra[0] !== 0xFFFF) lookupIndices.add(entry.extra[0]!)
    if (entry.extra[1] !== 0xFFFF) lookupIndices.add(entry.extra[1]!)
  })
  // Each entry carries two per-glyph substitution indices: extra[0] = the index
  // for the marked glyph, extra[1] = the index for the current glyph. Both index
  // into the substitution-tables array, whose 32-bit offset follows the four
  // 32-bit state-table header fields (nClasses/classTable/stateArray/entryTable).
  const substitutionTableOffset = reader.getUint32At(subtableStart + 16)
  const substitutionTablesStart = subtableStart + substitutionTableOffset
  if (substitutionTableOffset < 20 || substitutionTablesStart >= reader.length) {
    throw new Error('morx contextual substitution table offset exceeds subtable length')
  }

  // The substitution-tables array is a list of 32-bit offsets (from its own
  // start) to per-glyph lookup tables mapping glyphId to substitute glyphId.
  const lookupCache = new Map<number, Map<number, number>>()
  let maxLookupIndex = -1
  for (const index of lookupIndices) if (index > maxLookupIndex) maxLookupIndex = index
  const lookupOffsetArraySize = (maxLookupIndex + 1) * 4
  for (const index of lookupIndices) {
    const offsetAddress = substitutionTablesStart + index * 4
    if (offsetAddress < substitutionTablesStart || offsetAddress + 4 > reader.length) {
      throw new Error('morx contextual substitution lookup offset exceeds subtable length')
    }
    const lookupOffset = reader.getUint32At(offsetAddress)
    if (lookupOffset < lookupOffsetArraySize || substitutionTablesStart + lookupOffset >= reader.length) {
      throw new Error('morx contextual substitution lookup exceeds subtable length')
    }
    const lookup = parseAatLookupTable(reader, substitutionTablesStart + lookupOffset, numGlyphs)
    for (const replacement of lookup.values()) addGlyphReference(references, replacement, numGlyphs)
    lookupCache.set(index, lookup)
  }
  const resolveSubstitution = (index: number, glyphId: number): number => {
    const lookup = lookupCache.get(index)
    if (lookup === undefined) throw new Error(`morx contextual substitution lookup ${index} was not parsed`)
    const replacement = lookup.get(glyphId)
    return replacement === undefined ? glyphId : replacement
  }

  return {
    type: 1,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
    logical: false,
    glyphCoverage: null,
    subsetData: { type: 1, stateTable, lookups: lookupCache, sourceNumGlyphs: numGlyphs },
    apply(run: MorxRun, boundary: AatStateBoundary): MorxRun {
      const result = run.glyphs.slice()
      const breakClusters = run.breakClusters!.slice()
      let markIdx = -1

      runAatStateTable(stateTable, result, boundary, transition => {
        const entry = transition.entry
        if (!(transition.boundary && markIdx < 0)) {
          const markSubIndex = entry.extra[0]!
          if (markSubIndex !== 0xFFFF && markIdx >= 0 && markIdx < result.length) {
            result[markIdx] = resolveSubstitution(markSubIndex, result[markIdx]!)
          }
          const currentSubIndex = entry.extra[1]!
          const current = transition.boundary ? result.length - 1 : transition.index
          if (currentSubIndex !== 0xFFFF && current >= 0) {
            result[current] = resolveSubstitution(currentSubIndex, result[current]!)
          }
          if (!transition.boundary && (entry.flags & 0x8000)) markIdx = transition.index
        }
        return (entry.flags & 0x4000) !== 0
      })

      // Contextual substitution is 1:1, so clusters are unchanged.
      return { glyphs: result, clusters: run.clusters.slice(), flags: run.flags?.slice(), breakClusters }
    },
  }
}

function parseType2Ligature(
  reader: BinaryReader,
  subtableStart: number,
  references: Set<number>,
  numGlyphs?: number,
): MorxSubtable {
  // Read extended state table header manually to get ligature-specific offsets
  reader.seek(subtableStart)
  reader.skip(16)
  const ligActionsOffset = reader.readUint32()
  const componentOffset = reader.readUint32()
  const ligListOffset = reader.readUint32()
  if (ligActionsOffset < 28 || componentOffset < 28 || ligListOffset < 28
    || subtableStart + ligActionsOffset >= reader.length
    || subtableStart + componentOffset >= reader.length
    || subtableStart + ligListOffset >= reader.length) {
    throw new Error('morx ligature table offset exceeds subtable length')
  }

  // Now parse the state table (with 1 extra uint16 per entry: ligActionIndex)
  const stateTable = parseExtendedStateTable(reader, subtableStart, 1, numGlyphs, entry => {
    if ((entry.flags & 0x1FFF) !== 0) throw new Error('morx ligature entry uses reserved flags')
  })
  if (ligActionsOffset > componentOffset || componentOffset > ligListOffset) {
    throw new Error('morx ligature action/component/ligature offsets must be ordered')
  }
  const ligatureActions = new Uint32Array((componentOffset - ligActionsOffset) >>> 2)
  for (let i = 0; i < ligatureActions.length; i++) ligatureActions[i] = reader.getUint32At(subtableStart + ligActionsOffset + i * 4)
  const components = new Uint16Array((ligListOffset - componentOffset) >>> 1)
  for (let i = 0; i < components.length; i++) components[i] = reader.getUint16At(subtableStart + componentOffset + i * 2)
  const ligatures = new Uint16Array((reader.length - (subtableStart + ligListOffset)) >>> 1)
  for (let i = 0; i < ligatures.length; i++) ligatures[i] = reader.getUint16At(subtableStart + ligListOffset + i * 2)
  for (let offset = subtableStart + ligListOffset; offset + 2 <= reader.length; offset += 2) {
    addGlyphReference(references, reader.getUint16At(offset), numGlyphs)
  }

  return {
    type: 2,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
    logical: false,
    glyphCoverage: null,
    subsetData: { type: 2, stateTable, ligatureActions, components, ligatures, sourceNumGlyphs: numGlyphs },
    apply(run: MorxRun, boundary: AatStateBoundary): MorxRun {
      const result = run.glyphs.slice()
      const clusters = run.clusters.slice()
      const flags = run.flags?.slice()
      const breakClusters = run.breakClusters!.slice()
      const componentStack: number[] = []

      runAatStateTable(stateTable, result, boundary, transition => {
        const entry = transition.entry

        // Flag 0x8000 = setComponent (push the current glyph position).
        if (!transition.boundary && (entry.flags & 0x8000)) {
          if (componentStack[componentStack.length - 1] !== transition.index) componentStack.push(transition.index)
        }

        // Flag 0x2000 = performAction: walk the ligature action list, popping one
        // component per action from the top of the stack. Each action's component
        // table value is accumulated into the ligature-list index; on the storing
        // (or last) action the ligature glyph replaces the current component and
        // the components consumed earlier in this run are deleted. The formed
        // ligature's position is kept on the stack so a following action can
        // ligate it further (incremental stacking, e.g. Tibetan sa+ga+ra+u).
        if (entry.flags & 0x2000) {
          let actionIdx = entry.extra[0]!
          let ligatureIndex = 0
          const pendingDeletions: number[] = []
          let ligaturePos = -1
          let done = false
          while (!done && componentStack.length > 0) {
            const pos = componentStack.pop()!
            const actionAddress = subtableStart + ligActionsOffset + actionIdx * 4
            if (actionAddress < subtableStart || actionAddress + 4 > reader.length) {
              throw new Error('morx ligature action exceeds subtable length')
            }
            reader.seek(actionAddress)
            const action = reader.readUint32()
            actionIdx++
            const last = (action & 0x80000000) !== 0
            const store = (action & 0x40000000) !== 0
            let componentAddend = action & 0x3FFFFFFF
            if (componentAddend & 0x20000000) componentAddend |= ~0x3FFFFFFF // sign extend

            if (pos < result.length && result[pos] !== 0xFFFF) {
              const compIdx = result[pos]! + componentAddend
              const compAddr = subtableStart + componentOffset + compIdx * 2
              if (compAddr < subtableStart || compAddr + 2 > reader.length) {
                throw new Error('morx ligature component index exceeds subtable length')
              }
              ligatureIndex += reader.getUint16At(compAddr)
            }

            if (store || last) {
              const ligAddr = subtableStart + ligListOffset + ligatureIndex * 2
              if (pos < result.length) {
                if (ligAddr < subtableStart || ligAddr + 2 > reader.length) {
                  throw new Error('morx ligature glyph index exceeds subtable length')
                }
                result[pos] = reader.getUint16At(ligAddr)
                // The ligature inherits the minimum cluster of its components.
                for (let d = 0; d < pendingDeletions.length; d++) {
                  const dp = pendingDeletions[d]!
                if (clusters[dp]! < clusters[pos]!) clusters[pos] = clusters[dp]!
                  if (breakClusters[dp]! < breakClusters[pos]!) breakClusters[pos] = breakClusters[dp]!
                  result[dp] = 0xFFFF
                }
                ligaturePos = pos
              }
              pendingDeletions.length = 0
              ligatureIndex = 0
            } else if (pos < result.length) {
              pendingDeletions.push(pos)
            }

            if (last) done = true
          }
          if (!done) throw new Error('morx ligature action exhausted the component stack before Last')
          // Keep the formed ligature available as a component for a following
          // action so multi-part stacks ligate incrementally.
          if (ligaturePos >= 0) componentStack.push(ligaturePos)
        }

        return (entry.flags & 0x4000) !== 0
      })

      // Keep deleted glyphs in place as 0xFFFF markers; they flow through the
      // rest of the metamorphosis pipeline (treated as out-of-bounds by every
      // state machine, so they pass through untouched) and are only removed once
      // positioning is done. HarfBuzz keeps them for the same reason: the marker
      // preserves the glyph sequence a following 'kern'/'kerx' state machine
      // matches against. applySubstitutionsTracked strips them at the end.
      return { glyphs: result, clusters, flags, breakClusters }
    },
  }
}

function parseType4Noncontextual(
  reader: BinaryReader,
  subtableStart: number,
  references: Set<number>,
  numGlyphs?: number,
): MorxSubtable {
  // Simple lookup table: glyphId → replacement glyphId
  const lookupMap = parseAatLookupTable(reader, subtableStart, numGlyphs)
  for (const replacement of lookupMap.values()) addGlyphReference(references, replacement, numGlyphs)

  return {
    type: 4,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
    logical: false,
    glyphCoverage: null,
    subsetData: { type: 4, lookup: lookupMap, sourceNumGlyphs: numGlyphs },
    apply(run: MorxRun, _boundary: AatStateBoundary): MorxRun {
      const glyphIds = run.glyphs
      const result = new Array<number>(glyphIds.length)
      for (let i = 0; i < glyphIds.length; i++) {
        const replacement = lookupMap.get(glyphIds[i]!)
        result[i] = replacement !== undefined ? replacement : glyphIds[i]!
      }
      // Noncontextual substitution is 1:1, so clusters are unchanged.
      return { glyphs: result, clusters: run.clusters.slice(), flags: run.flags?.slice(), breakClusters: run.breakClusters!.slice() }
    },
  }
}

function parseType5Insertion(
  reader: BinaryReader,
  subtableStart: number,
  references: Set<number>,
  numGlyphs?: number,
): MorxSubtable {
  const insertionRanges: Array<{ index: number, count: number }> = []
  const stateTable = parseExtendedStateTable(reader, subtableStart, 2, numGlyphs, entry => {
    const currentCount = (entry.flags >>> 5) & 0x1F
    const markedCount = entry.flags & 0x1F
    if (currentCount !== 0 && entry.extra[0] !== 0xFFFF) insertionRanges.push({ index: entry.extra[0]!, count: currentCount })
    if (markedCount !== 0 && entry.extra[1] !== 0xFFFF) insertionRanges.push({ index: entry.extra[1]!, count: markedCount })
  })
  // extra[0] = currentInsertIndex, extra[1] = markedInsertIndex.
  // The insertion glyph list is a separate array; its offset is the 5th uint32
  // of the subtable header (immediately after the 4-word extended state header),
  // and the index fields count into it as uint16 glyph ids.
  const insertionActionOffset = reader.getUint32At(subtableStart + 16)
  if (insertionActionOffset < 20 || subtableStart + insertionActionOffset >= reader.length) {
    throw new Error('morx insertion action offset exceeds subtable length')
  }
  let insertionGlyphCount = 0
  for (let i = 0; i < insertionRanges.length; i++) {
    insertionGlyphCount = Math.max(insertionGlyphCount, insertionRanges[i]!.index + insertionRanges[i]!.count)
  }
  const insertionGlyphs = new Uint16Array(insertionGlyphCount)
  const insertionUsed = new Uint8Array(insertionGlyphCount)
  for (let i = 0; i < insertionGlyphCount; i++) insertionGlyphs[i] = reader.getUint16At(subtableStart + insertionActionOffset + i * 2)
  for (let rangeIndex = 0; rangeIndex < insertionRanges.length; rangeIndex++) {
    const range = insertionRanges[rangeIndex]!
    insertionUsed.fill(1, range.index, range.index + range.count)
  }
  for (let rangeIndex = 0; rangeIndex < insertionRanges.length; rangeIndex++) {
    const range = insertionRanges[rangeIndex]!
    const address = subtableStart + insertionActionOffset + range.index * 2
    if (address < subtableStart || address + range.count * 2 > reader.length) {
      throw new Error('morx insertion glyph list exceeds subtable length')
    }
    for (let i = 0; i < range.count; i++) {
      addGlyphReference(references, reader.getUint16At(address + i * 2), numGlyphs)
    }
  }

  return {
    type: 5,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
    logical: false,
    glyphCoverage: null,
    subsetData: { type: 5, stateTable, insertionGlyphs, insertionUsed, sourceNumGlyphs: numGlyphs },
    apply(run: MorxRun, boundary: AatStateBoundary): MorxRun {
      const readInsertions = (index: number, count: number): number[] => {
        const address = subtableStart + insertionActionOffset + index * 2
        if (address < subtableStart || address + count * 2 > reader.length) {
          throw new Error('morx insertion glyph list exceeds subtable length')
        }
        reader.seek(address)
        const glyphs = new Array<number>(count)
        for (let i = 0; i < count; i++) glyphs[i] = reader.readUint16()
        return glyphs
      }
      return runAatInsertionStateTable(stateTable, run, boundary, 0xFFFF, readInsertions)
    },
  }
}

export function parseMorx(reader: BinaryReader, numGlyphs?: number): MorxTable {
  const tableStart = reader.position
  if (reader.length - tableStart < MORX_HEADER_SIZE) {
    throw new Error(`morx table length must be at least ${MORX_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const version = reader.readUint16() // 2 or 3
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported morx table version: ${version}`)
  }
  const unused = reader.readUint16()
  if (unused !== 0) {
    throw new Error(`morx unused header field must be zero, got ${unused}`)
  }
  const nChains = reader.readUint32()
  if (nChains === 0) {
    throw new Error('morx table requires at least one chain')
  }

  const chains: MorxChain[] = []
  const references = new Set<number>()

  for (let c = 0; c < nChains; c++) {
    const chainStart = reader.position
    if (((chainStart - tableStart) & 3) !== 0) {
      throw new Error(`morx chain ${c} must start on a longword boundary`)
    }
    if (reader.length - chainStart < MORX_CHAIN_HEADER_SIZE) {
      throw new Error(`morx chain ${c} header exceeds table length`)
    }
    const defaultFlags = reader.readUint32()
    const chainLength = reader.readUint32()
    const nFeatureEntries = reader.readUint32()
    const nSubtables = reader.readUint32()
    if (chainLength < MORX_CHAIN_HEADER_SIZE) {
      throw new Error(`morx chain ${c} length must be at least ${MORX_CHAIN_HEADER_SIZE}, got ${chainLength}`)
    }
    // The spec recommends 4-byte-padded lengths, but many shipping fonts
    // (Helvetica, Times, Geneva, …) use unpadded lengths; trust the field.
    const chainEnd = chainStart + chainLength
    if (chainEnd > reader.length) {
      throw new Error(`morx chain ${c} exceeds table length`)
    }
    const featureArrayEnd = reader.position + nFeatureEntries * MORX_FEATURE_ENTRY_SIZE
    if (featureArrayEnd > chainEnd) {
      throw new Error(`morx chain ${c} feature array exceeds chain length`)
    }

    const features: MorxChain['features'] = []
    for (let f = 0; f < nFeatureEntries; f++) {
      features.push({
        featureType: reader.readUint16(),
        featureSetting: reader.readUint16(),
        enableFlags: reader.readUint32(),
        disableFlags: reader.readUint32(),
      })
    }

    const subtables: MorxSubtable[] = []
    for (let s = 0; s < nSubtables; s++) {
      const subtableStart = reader.position
      if (chainEnd - subtableStart < MORX_SUBTABLE_HEADER_SIZE) {
        throw new Error(`morx chain ${c} subtable ${s} header exceeds chain length`)
      }
      const length = reader.readUint32()
      const coverage = reader.readUint32()
      const subFeatureFlags = reader.readUint32()
      const type = coverage & MORX_COVERAGE_TYPE_MASK
      if (length < MORX_SUBTABLE_HEADER_SIZE) {
        throw new Error(`morx chain ${c} subtable ${s} length must be at least ${MORX_SUBTABLE_HEADER_SIZE}, got ${length}`)
      }
      // Unpadded subtable lengths occur in real fonts; use the field as-is.
      const subtableEnd = subtableStart + length
      if (subtableEnd > chainEnd) {
        throw new Error(`morx chain ${c} subtable ${s} exceeds chain length`)
      }
      if ((coverage & MORX_COVERAGE_RESERVED_MASK) !== 0) {
        throw new Error(`morx chain ${c} subtable ${s} coverage reserved bits must be zero`)
      }

      const dataStart = reader.position
      const subReader = reader.subReader(dataStart, subtableEnd - dataStart)

      let subtable: MorxSubtable
      switch (type) {
        case 0:
          subtable = parseType0Rearrangement(subReader, 0, numGlyphs)
          break
        case 1:
          subtable = parseType1Contextual(subReader, 0, references, numGlyphs)
          break
        case 2:
          subtable = parseType2Ligature(subReader, 0, references, numGlyphs)
          break
        case 4:
          subtable = parseType4Noncontextual(subReader, 0, references, numGlyphs)
          break
        case 5:
          subtable = parseType5Insertion(subReader, 0, references, numGlyphs)
          break
        default:
          throw new Error(`Unsupported morx subtable type: ${type}`)
      }
      subtable.subFeatureFlags = subFeatureFlags
      subtable.vertical = (coverage & 0x80000000) !== 0
      subtable.descending = (coverage & 0x40000000) !== 0
      subtable.allDirections = (coverage & 0x20000000) !== 0
      subtable.logical = (coverage & 0x10000000) !== 0
      subtables.push(subtable)

      reader.seek(subtableEnd)
    }
    if (version >= 3) {
      const coverage = parseMorxSubtableCoverageArray(reader, reader.position, chainEnd, nSubtables, numGlyphs, c)
      for (let i = 0; i < subtables.length; i++) subtables[i]!.glyphCoverage = coverage[i]!
    }
    reader.seek(chainEnd)

    chains.push({ defaultFlags, features, subtables })
  }

  return {
    version,
    chains,
    referencedGlyphIds: [...references].sort(function (left, right) { return left - right }),
    applySubstitutions(glyphIds: number[], selectedFeatures?: readonly MorxFeatureSelector[], rightToLeft = false, context?: AatProcessContext): number[] {
      const identity = new Array<number>(glyphIds.length)
      for (let i = 0; i < glyphIds.length; i++) identity[i] = i
      return this.applySubstitutionsTracked({ glyphs: glyphIds, clusters: identity }, selectedFeatures, rightToLeft, context).glyphs
    },
    applySubstitutionsTracked(run: MorxRun, selectedFeatures?: readonly MorxFeatureSelector[], rightToLeft = false, context?: AatProcessContext): MorxRun {
      let result: MorxRun = {
        glyphs: run.glyphs,
        clusters: run.clusters,
        flags: run.flags,
        breakClusters: run.breakClusters?.slice() ?? run.clusters.slice(),
      }
      // AAT processes each subtable in a direction derived from its coverage
      // flags and the run direction (HarfBuzz hb-aat-layout.cc): a subtable runs
      // last-to-first when `logical ? descending : descending XOR rightToLeft`.
      // Rather than reverse per subtable, track the current orientation and flip
      // only when it changes. Vertical-only subtables are skipped for horizontal
      // runs (this engine positions horizontally).
      let reversed = false
      for (let c = 0; c < chains.length; c++) {
        const chain = chains[c]!
        const chainFlags = resolveChainFlags(chain, selectedFeatures)
        for (let s = 0; s < chain.subtables.length; s++) {
          const sub = chain.subtables[s]!
          if ((sub.subFeatureFlags & chainFlags) === 0) continue
          if (sub.glyphCoverage !== null && !morxRunIntersectsCoverage(result.glyphs, sub.glyphCoverage)) continue
          const vertical = context?.vertical === true
          if (!sub.allDirections && sub.vertical !== vertical) continue
          const needReverse = sub.logical ? sub.descending : (sub.descending !== rightToLeft)
          if (needReverse !== reversed) {
            result = {
              glyphs: result.glyphs.slice().reverse(),
              clusters: result.clusters.slice().reverse(),
              flags: result.flags?.slice().reverse(),
              breakClusters: result.breakClusters!.slice().reverse(),
            }
            reversed = needReverse
          }
          result = sub.apply(result, context?.boundary ?? 'text')
        }
      }
      if (reversed) {
        result = {
          glyphs: result.glyphs.slice().reverse(),
          clusters: result.clusters.slice().reverse(),
          flags: result.flags?.slice().reverse(),
          breakClusters: result.breakClusters!.slice().reverse(),
        }
      }
      // `result` may carry 0xFFFF deletion markers from ligature substitution.
      // Expose the marker-preserved buffer (for AAT kern/kerx mark positioning)
      // and return the visible run with markers removed.
      const withDeletions = result.glyphs
      let hasDeletions = false
      for (let i = 0; i < withDeletions.length; i++) {
        if (withDeletions[i] === 0xFFFF) { hasDeletions = true; break }
      }
      if (!hasDeletions) return result
      const glyphs: number[] = []
      const clusters: number[] = []
      const breakClusters: number[] = []
      const flags: number[] | undefined = result.flags === undefined ? undefined : []
      for (let i = 0; i < withDeletions.length; i++) {
        if (withDeletions[i] !== 0xFFFF) {
          glyphs.push(withDeletions[i]!)
          clusters.push(result.clusters[i]!)
          breakClusters.push(result.breakClusters![i]!)
          flags?.push(result.flags![i]!)
        }
      }
      return { glyphs, clusters, flags, breakClusters, glyphsWithDeletions: withDeletions, clustersWithDeletions: result.clusters }
    },
  }
}

function addGlyphReference(references: Set<number>, glyphId: number, numGlyphs: number | undefined): void {
  if (glyphId !== 0 && glyphId !== 0xFFFF && (numGlyphs === undefined || glyphId < numGlyphs)) references.add(glyphId)
}

function resolveChainFlags(chain: MorxChain, selectedFeatures: readonly MorxFeatureSelector[] | undefined): number {
  let flags = chain.defaultFlags
  if (selectedFeatures === undefined || selectedFeatures.length === 0) return flags
  for (let i = 0; i < chain.features.length; i++) {
    const feature = chain.features[i]!
    for (let j = 0; j < selectedFeatures.length; j++) {
      const selected = selectedFeatures[j]!
      if (feature.featureType === selected.featureType && feature.featureSetting === selected.featureSetting) {
        flags = (flags & feature.disableFlags) | feature.enableFlags
        break
      }
    }
  }
  return flags >>> 0
}

function mergeClusterRange(clusters: number[], first: number, last: number): void {
  const start = Math.min(first, last)
  const end = Math.max(first, last)
  let merged = clusters[start]!
  for (let i = start + 1; i <= end; i++) if (clusters[i]! < merged) merged = clusters[i]!
  for (let i = start; i <= end; i++) clusters[i] = merged
}

function parseMorxSubtableCoverageArray(
  reader: BinaryReader,
  coverageStart: number,
  chainEnd: number,
  nSubtables: number,
  numGlyphs: number | undefined,
  chainIndex: number,
): (Uint8Array | null)[] {
  const offsetArrayLength = nSubtables * 4
  if (coverageStart + offsetArrayLength > chainEnd) {
    throw new Error(`morx chain ${chainIndex} subtable glyph coverage offset array exceeds chain length`)
  }
  if (numGlyphs === undefined) {
    throw new Error('morx version 3 subtable glyph coverage requires numGlyphs')
  }
  const coverage = new Array<Uint8Array | null>(nSubtables).fill(null)
  const bitfieldLength = ((numGlyphs + 7) >> 3)
  const paddedBitfieldLength = (bitfieldLength + 3) & ~3
  for (let i = 0; i < nSubtables; i++) {
    const offset = reader.getUint32At(coverageStart + i * 4)
    if (offset === 0) continue
    if ((offset & 3) !== 0) {
      throw new Error(`morx chain ${chainIndex} subtable glyph coverage offset ${i} must be four-byte aligned`)
    }
    const bitfieldStart = coverageStart + offset
    if (bitfieldStart < coverageStart + offsetArrayLength || bitfieldStart + paddedBitfieldLength > chainEnd) {
      throw new Error(`morx chain ${chainIndex} subtable glyph coverage bitfield ${i} exceeds chain length`)
    }
    reader.seek(bitfieldStart)
    coverage[i] = reader.readBytes(bitfieldLength)
  }
  return coverage
}

function morxRunIntersectsCoverage(glyphs: readonly number[], coverage: Uint8Array): boolean {
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i]!
    const byteIndex = glyph >>> 3
    if (byteIndex < coverage.length && (coverage[byteIndex]! & (1 << (glyph & 7))) !== 0) return true
  }
  return false
}
