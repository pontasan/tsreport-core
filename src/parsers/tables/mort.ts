import { BinaryReader } from '../../binary/reader.js'
import {
  parseStateTable,
  parseAatLookupTable,
  applyAatRearrangement,
  runAatInsertionStateTable,
  runAatStateTable,
  type AatProcessContext,
  type AatStateBoundary,
} from './aat-common.js'
import type { MorxFeatureSelector, MorxRun } from './morx.js'

const MORT_HEADER_SIZE = 8
const MORT_CHAIN_HEADER_SIZE = 12
const MORT_FEATURE_ENTRY_SIZE = 12
const MORT_SUBTABLE_HEADER_SIZE = 8
const MORT_VERSION = 0x00010000
const MORT_COVERAGE_RESERVED_MASK = 0x1FF8
const MORT_COVERAGE_TYPE_MASK = 0x0007

/**
 * mort table: Glyph Metamorphosis (Legacy Apple AAT)
 * Older version of morx. Uses 16-bit state tables
 * Same 5 subtable types (0: Rearrangement, 1: Contextual, 2: Ligature, 4: Noncontextual, 5: Insertion)
 */

export interface MortChain {
  defaultFlags: number
  features: { featureType: number, featureSetting: number, enableFlags: number, disableFlags: number }[]
  subtables: MortSubtable[]
}

export interface MortSubtable {
  type: number
  subFeatureFlags: number
  vertical: boolean
  descending: boolean
  allDirections: boolean
  readonly subsetData: MortSubsetSubtableData
  apply(run: MorxRun, boundary: AatStateBoundary): MorxRun
}

export interface MortTable {
  readonly version: number
  readonly chains: MortChain[]
  /** Glyphs stored as substitution, ligature, or insertion results. */
  readonly referencedGlyphIds: readonly number[]
  applySubstitutions(glyphIds: number[], features?: readonly MortFeatureSelector[], context?: AatProcessContext): number[]
  applySubstitutionsTracked(run: MorxRun, features?: readonly MortFeatureSelector[], context?: AatProcessContext): MorxRun
}

export type MortSubsetSubtableData =
  | { readonly type: 0, readonly stateTable: ReturnType<typeof parseStateTable> }
  | { readonly type: 1, readonly stateTable: ReturnType<typeof parseStateTable>, readonly substitutions: ReadonlyMap<number, ReadonlyMap<number, number>> }
  | {
      readonly type: 2
      readonly stateTable: ReturnType<typeof parseStateTable>
      readonly ligatureActions: Uint32Array
      readonly components: Uint16Array
      readonly ligatures: Uint16Array
      readonly componentOffset: number
      readonly ligatureOffset: number
    }
  | { readonly type: 4, readonly lookup: ReadonlyMap<number, number> }
  | { readonly type: 5, readonly stateTable: ReturnType<typeof parseStateTable>, readonly insertionLists: ReadonlyMap<number, readonly number[]> }

export type MortFeatureSelector = MorxFeatureSelector

function parseMortType0(reader: BinaryReader, subtableStart: number): MortSubtable {
  const stateTable = parseStateTable(reader, subtableStart, 0, entry => {
    if ((entry.flags & 0x1FF0) !== 0) throw new Error('mort rearrangement entry uses reserved flags')
  })

  return {
    type: 0,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
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
          applyAatRearrangement(clusters, markFirst, markLast, verb)
          if (flags !== undefined) applyAatRearrangement(flags, markFirst, markLast, verb)
          mergeClusterRange(breakClusters, markFirst, markLast)
        }
        return (entry.flags & 0x4000) !== 0
      })

      return { glyphs: result, clusters, flags, breakClusters }
    },
  }
}

function parseMortType1(
  reader: BinaryReader,
  subtableStart: number,
  references: Set<number>,
  numGlyphs?: number,
): MortSubtable {
  const substitutionOffsets = new Set<number>()
  const stateTable = parseStateTable(reader, subtableStart, 2, entry => {
    if ((entry.flags & 0x3FFF) !== 0) throw new Error('mort contextual entry uses reserved flags')
    if (entry.extra[0] !== 0xFFFF) substitutionOffsets.add(entry.extra[0]!)
    if (entry.extra[1] !== 0xFFFF) substitutionOffsets.add(entry.extra[1]!)
  })
  const substitutionTableOffset = reader.getUint16At(subtableStart + 8)
  if (substitutionTableOffset < 10 || substitutionTableOffset >= reader.length) {
    throw new Error('mort contextual substitution table offset exceeds subtable length')
  }
  for (let offset = subtableStart + substitutionTableOffset; offset + 2 <= reader.length; offset += 2) {
    addGlyphReference(references, reader.getUint16At(offset), numGlyphs)
  }
  const substitutions = new Map<number, ReadonlyMap<number, number>>()
  for (const offset of substitutionOffsets) {
    const signedOffset = offset >= 0x8000 ? offset - 0x10000 : offset
    const values = new Map<number, number>()
    const glyphCount = numGlyphs ?? 0x10000
    for (let glyphId = 0; glyphId < glyphCount; glyphId++) {
      const address = subtableStart + (signedOffset + glyphId) * 2
      if (address < subtableStart + substitutionTableOffset || address + 2 > reader.length) continue
      const replacement = reader.getUint16At(address)
      if (replacement !== 0) values.set(glyphId, replacement)
    }
    substitutions.set(offset, values)
  }

  const substitute = (offset: number, glyphId: number): number => {
    if (offset === 0xFFFF) return glyphId
    const signedOffset = offset >= 0x8000 ? offset - 0x10000 : offset
    const address = subtableStart + (signedOffset + glyphId) * 2
    if (address < subtableStart + substitutionTableOffset || address + 2 > reader.length) {
      throw new Error('mort contextual per-glyph substitution exceeds subtable length')
    }
    const replacement = reader.getUint16At(address)
    return replacement === 0 ? glyphId : replacement
  }

  return {
    type: 1,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
    subsetData: { type: 1, stateTable, substitutions },
    apply(run: MorxRun, boundary: AatStateBoundary): MorxRun {
      const result = run.glyphs.slice()
      const breakClusters = run.breakClusters!.slice()
      let marked = -1

      runAatStateTable(stateTable, result, boundary, transition => {
        const entry = transition.entry
        if (!(transition.boundary && marked < 0)) {
          if (marked >= 0 && entry.extra[0] !== 0xFFFF) {
            result[marked] = substitute(entry.extra[0]!, result[marked]!)
          }
          const current = transition.boundary ? result.length - 1 : transition.index
          if (current >= 0 && entry.extra[1] !== 0xFFFF) {
            result[current] = substitute(entry.extra[1]!, result[current]!)
          }
          if (!transition.boundary && (entry.flags & 0x8000)) marked = transition.index
        }
        return (entry.flags & 0x4000) !== 0
      })

      return { glyphs: result, clusters: run.clusters.slice(), flags: run.flags?.slice(), breakClusters }
    },
  }
}

function parseMortType2(
  reader: BinaryReader,
  subtableStart: number,
  references: Set<number>,
  numGlyphs?: number,
): MortSubtable {
  const stateTable = parseStateTable(reader, subtableStart, 0)
  const ligActionOffset = reader.getUint16At(subtableStart + 8)
  const componentOffset = reader.getUint16At(subtableStart + 10)
  const ligatureOffset = reader.getUint16At(subtableStart + 12)
  if (ligActionOffset < 14 || componentOffset < 14 || ligatureOffset < 14
    || ligActionOffset >= reader.length || componentOffset >= reader.length || ligatureOffset >= reader.length) {
    throw new Error('mort ligature table offset exceeds subtable length')
  }
  if ((ligActionOffset & 3) !== 0) throw new Error('mort ligature action table must be longword aligned')
  if (ligActionOffset > componentOffset || componentOffset > ligatureOffset) {
    throw new Error('mort ligature action/component/ligature offsets must be ordered')
  }
  const ligatureActions = new Uint32Array((componentOffset - ligActionOffset) >>> 2)
  for (let i = 0; i < ligatureActions.length; i++) ligatureActions[i] = reader.getUint32At(subtableStart + ligActionOffset + i * 4)
  const components = new Uint16Array((ligatureOffset - componentOffset) >>> 1)
  for (let i = 0; i < components.length; i++) components[i] = reader.getUint16At(subtableStart + componentOffset + i * 2)
  const ligatures = new Uint16Array((reader.length - (subtableStart + ligatureOffset)) >>> 1)
  for (let i = 0; i < ligatures.length; i++) ligatures[i] = reader.getUint16At(subtableStart + ligatureOffset + i * 2)
  for (let offset = subtableStart + ligatureOffset; offset + 2 <= reader.length; offset += 2) {
    addGlyphReference(references, reader.getUint16At(offset), numGlyphs)
  }

  return {
    type: 2,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
    subsetData: { type: 2, stateTable, ligatureActions, components, ligatures, componentOffset, ligatureOffset },
    apply(run: MorxRun, boundary: AatStateBoundary): MorxRun {
      const result = run.glyphs.slice()
      const clusters = run.clusters.slice()
      const flags = run.flags?.slice()
      const breakClusters = run.breakClusters!.slice()
      const componentStack: number[] = []

      runAatStateTable(stateTable, result, boundary, transition => {
        const entry = transition.entry
        if (!transition.boundary && (entry.flags & 0x8000)) {
          if (componentStack.length === 16) throw new Error('mort ligature component stack exceeds 16 entries')
          if (componentStack[componentStack.length - 1] !== transition.index) componentStack.push(transition.index)
        }

        const actionOffset = entry.flags & 0x3FFF
        if (actionOffset !== 0) {
          if ((actionOffset & 3) !== 0) throw new Error('mort ligature action offset must be longword aligned')
          if (actionOffset < ligActionOffset) throw new Error('mort ligature action precedes the action table')
          let address = subtableStart + actionOffset
          let accumulatedOffset = 0
          const pendingDeletions: number[] = []
          const formedLigatures: number[] = []
          let done = false
          while (!done) {
            if (componentStack.length === 0) {
              throw new Error('mort ligature action exhausted the component stack before Last')
            }
            if (address < subtableStart + ligActionOffset || address + 4 > reader.length) {
              throw new Error('mort ligature action exceeds subtable length')
            }
            const position = componentStack.pop()!
            const action = reader.getUint32At(address)
            address += 4
            const last = (action & 0x80000000) !== 0
            const store = (action & 0x40000000) !== 0
            let wordOffset = action & 0x3FFFFFFF
            if ((wordOffset & 0x20000000) !== 0) wordOffset -= 0x40000000
            const componentAddress = subtableStart + (wordOffset + result[position]!) * 2
            if (componentAddress < subtableStart + componentOffset || componentAddress + 2 > reader.length) {
              throw new Error('mort ligature component offset exceeds subtable length')
            }
            accumulatedOffset += reader.getUint16At(componentAddress)

            if (store || last) {
              const ligatureAddress = subtableStart + accumulatedOffset
              if (ligatureAddress < subtableStart + ligatureOffset || ligatureAddress + 2 > reader.length) {
                throw new Error('mort ligature glyph offset exceeds subtable length')
              }
              result[position] = reader.getUint16At(ligatureAddress)
              for (let i = 0; i < pendingDeletions.length; i++) {
                const deleted = pendingDeletions[i]!
                if (clusters[deleted]! < clusters[position]!) clusters[position] = clusters[deleted]!
                if (breakClusters[deleted]! < breakClusters[position]!) breakClusters[position] = breakClusters[deleted]!
                result[deleted] = 0xFFFF
              }
              pendingDeletions.length = 0
              accumulatedOffset = 0
              formedLigatures.push(position)
            } else {
              pendingDeletions.push(position)
            }
            done = last
          }
          for (let i = formedLigatures.length - 1; i >= 0; i--) componentStack.push(formedLigatures[i]!)
        }
        return (entry.flags & 0x4000) !== 0
      })

      return { glyphs: result, clusters, flags, breakClusters }
    },
  }
}

function parseMortType4(
  reader: BinaryReader,
  subtableStart: number,
  references: Set<number>,
  numGlyphs?: number,
): MortSubtable {
  const lookupMap = parseAatLookupTable(reader, subtableStart, numGlyphs)
  for (const replacement of lookupMap.values()) addGlyphReference(references, replacement, numGlyphs)

  return {
    type: 4,
    subFeatureFlags: 0,
    vertical: false,
    descending: false,
    allDirections: false,
    subsetData: { type: 4, lookup: lookupMap },
    apply(run: MorxRun, _boundary: AatStateBoundary): MorxRun {
      const result = new Array<number>(run.glyphs.length)
      for (let i = 0; i < run.glyphs.length; i++) {
        const replacement = lookupMap.get(run.glyphs[i]!)
        result[i] = replacement !== undefined ? replacement : run.glyphs[i]!
      }
      return { glyphs: result, clusters: run.clusters.slice(), flags: run.flags?.slice(), breakClusters: run.breakClusters!.slice() }
    },
  }
}

function parseMortType5(
  reader: BinaryReader,
  subtableStart: number,
  references: Set<number>,
  numGlyphs?: number,
): MortSubtable {
  const ranges: Array<{ offset: number, count: number }> = []
  const stateTable = parseStateTable(reader, subtableStart, 2, entry => {
    const currentCount = (entry.flags >>> 5) & 0x1F
    const markedCount = entry.flags & 0x1F
    if (currentCount !== 0 && entry.extra[0] !== 0) ranges.push({ offset: entry.extra[0]!, count: currentCount })
    if (markedCount !== 0 && entry.extra[1] !== 0) ranges.push({ offset: entry.extra[1]!, count: markedCount })
  })
  const insertionLists = new Map<number, readonly number[]>()
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex++) {
    const range = ranges[rangeIndex]!
    const existing = insertionLists.get(range.offset)
    if (existing !== undefined && existing.length >= range.count) continue
    const address = subtableStart + range.offset
    if (address < subtableStart || address + range.count * 2 > reader.length) throw new Error('mort insertion glyph list exceeds subtable length')
    const values = new Array<number>(range.count)
    for (let i = 0; i < range.count; i++) values[i] = reader.getUint16At(address + i * 2)
    insertionLists.set(range.offset, values)
  }
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex++) {
    const range = ranges[rangeIndex]!
    const address = subtableStart + range.offset
    if (address < subtableStart || address + range.count * 2 > reader.length) {
      throw new Error('mort insertion glyph list exceeds subtable length')
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
    subsetData: { type: 5, stateTable, insertionLists },
    apply(run: MorxRun, boundary: AatStateBoundary): MorxRun {
      const readInsertions = (offset: number, count: number): number[] => {
        const address = subtableStart + offset
        if (address < subtableStart || address + count * 2 > reader.length) {
          throw new Error('mort insertion glyph list exceeds subtable length')
        }
        reader.seek(address)
        const glyphs = new Array<number>(count)
        for (let i = 0; i < count; i++) glyphs[i] = reader.readUint16()
        return glyphs
      }
      return runAatInsertionStateTable(stateTable, run, boundary, 0, readInsertions)
    },
  }
}

export function parseMort(reader: BinaryReader, numGlyphs?: number): MortTable {
  const tableStart = reader.position
  if (reader.length - tableStart < MORT_HEADER_SIZE) {
    throw new Error(`mort table length must be at least ${MORT_HEADER_SIZE}, got ${reader.length - tableStart}`)
  }

  const version = reader.readUint32()
  if (version !== MORT_VERSION) {
    throw new Error(`Unsupported mort table version: 0x${version.toString(16).padStart(8, '0')}`)
  }
  const nChains = reader.readUint32()
  if (nChains === 0) {
    throw new Error('mort table requires at least one chain')
  }

  const chains: MortChain[] = []
  const references = new Set<number>()

  for (let c = 0; c < nChains; c++) {
    const chainStart = reader.position
    if (((chainStart - tableStart) & 3) !== 0) {
      throw new Error(`mort chain ${c} must start on a longword boundary`)
    }
    if (reader.length - chainStart < MORT_CHAIN_HEADER_SIZE) {
      throw new Error(`mort chain ${c} header exceeds table length`)
    }
    const defaultFlags = reader.readUint32()
    const chainLength = reader.readUint32()
    const nFeatureEntries = reader.readUint16()
    const nSubtables = reader.readUint16()
    if (chainLength < MORT_CHAIN_HEADER_SIZE) {
      throw new Error(`mort chain ${c} length must be at least ${MORT_CHAIN_HEADER_SIZE}, got ${chainLength}`)
    }
    if ((chainLength & 3) !== 0) {
      throw new Error(`mort chain ${c} length must be a multiple of 4, got ${chainLength}`)
    }
    const chainEnd = chainStart + chainLength
    if (chainEnd > reader.length) {
      throw new Error(`mort chain ${c} exceeds table length`)
    }
    const featureArrayEnd = reader.position + nFeatureEntries * MORT_FEATURE_ENTRY_SIZE
    if (featureArrayEnd > chainEnd) {
      throw new Error(`mort chain ${c} feature array exceeds chain length`)
    }

    const features: MortChain['features'] = []
    for (let f = 0; f < nFeatureEntries; f++) {
      features.push({
        featureType: reader.readUint16(),
        featureSetting: reader.readUint16(),
        enableFlags: reader.readUint32(),
        disableFlags: reader.readUint32(),
      })
    }

    const subtables: MortSubtable[] = []
    for (let s = 0; s < nSubtables; s++) {
      const subtableStart = reader.position
      if (chainEnd - subtableStart < MORT_SUBTABLE_HEADER_SIZE) {
        throw new Error(`mort chain ${c} subtable ${s} header exceeds chain length`)
      }
      const length = reader.readUint16()
      const coverage = reader.readUint16()
      const subFeatureFlags = reader.readUint32()
      const type = coverage & MORT_COVERAGE_TYPE_MASK
      if (length < MORT_SUBTABLE_HEADER_SIZE) {
        throw new Error(`mort chain ${c} subtable ${s} length must be at least ${MORT_SUBTABLE_HEADER_SIZE}, got ${length}`)
      }
      if ((length & 3) !== 0) {
        throw new Error(`mort chain ${c} subtable ${s} length must be a multiple of 4, got ${length}`)
      }
      const subtableEnd = subtableStart + length
      if (subtableEnd > chainEnd) {
        throw new Error(`mort chain ${c} subtable ${s} exceeds chain length`)
      }
      if ((coverage & MORT_COVERAGE_RESERVED_MASK) !== 0) {
        throw new Error(`mort chain ${c} subtable ${s} coverage reserved bits must be zero`)
      }

      const dataStart = reader.position
      const subReader = reader.subReader(dataStart, subtableEnd - dataStart)

      let subtable: MortSubtable
      switch (type) {
        case 0:
          subtable = parseMortType0(subReader, 0)
          break
        case 1:
          subtable = parseMortType1(subReader, 0, references, numGlyphs)
          break
        case 2:
          subtable = parseMortType2(subReader, 0, references, numGlyphs)
          break
        case 4:
          subtable = parseMortType4(subReader, 0, references, numGlyphs)
          break
        case 5:
          subtable = parseMortType5(subReader, 0, references, numGlyphs)
          break
        default:
          throw new Error(`Unsupported mort subtable type: ${type}`)
      }
      subtable.subFeatureFlags = subFeatureFlags
      subtable.vertical = (coverage & 0x8000) !== 0
      subtable.descending = (coverage & 0x4000) !== 0
      subtable.allDirections = (coverage & 0x2000) !== 0
      subtables.push(subtable)

      reader.seek(subtableEnd)
    }
    reader.seek(chainEnd)

    chains.push({ defaultFlags, features, subtables })
  }

  return {
    version: 1,
    chains,
    referencedGlyphIds: [...references].sort(function (left, right) { return left - right }),
    applySubstitutions(glyphIds: number[], selectedFeatures?: readonly MortFeatureSelector[], context?: AatProcessContext): number[] {
      const clusters = new Array<number>(glyphIds.length)
      for (let i = 0; i < clusters.length; i++) clusters[i] = i
      return this.applySubstitutionsTracked({ glyphs: glyphIds, clusters }, selectedFeatures, context).glyphs
    },
    applySubstitutionsTracked(run: MorxRun, selectedFeatures?: readonly MortFeatureSelector[], context?: AatProcessContext): MorxRun {
      let result: MorxRun = {
        glyphs: run.glyphs,
        clusters: run.clusters,
        flags: run.flags,
        breakClusters: run.breakClusters?.slice() ?? run.clusters.slice(),
      }
      let reversed = false
      for (let c = 0; c < chains.length; c++) {
        const chain = chains[c]!
        const chainFlags = resolveChainFlags(chain, selectedFeatures)
        for (let s = 0; s < chain.subtables.length; s++) {
          const sub = chain.subtables[s]!
          if ((sub.subFeatureFlags & chainFlags) === 0) continue
          if (!sub.allDirections && sub.vertical !== (context?.vertical === true)) continue
          const needReverse = sub.descending !== (context?.rightToLeft === true)
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

      const glyphsWithDeletions = result.glyphs
      let hasDeletions = false
      for (let i = 0; i < glyphsWithDeletions.length; i++) {
        if (glyphsWithDeletions[i] === 0xFFFF) { hasDeletions = true; break }
      }
      if (!hasDeletions) return result
      const glyphs: number[] = []
      const clusters: number[] = []
      const breakClusters: number[] = []
      const flags: number[] | undefined = result.flags === undefined ? undefined : []
      for (let i = 0; i < glyphsWithDeletions.length; i++) {
        if (glyphsWithDeletions[i] !== 0xFFFF) {
          glyphs.push(glyphsWithDeletions[i]!)
          clusters.push(result.clusters[i]!)
          breakClusters.push(result.breakClusters![i]!)
          flags?.push(result.flags![i]!)
        }
      }
      return {
        glyphs,
        clusters,
        flags,
        breakClusters,
        glyphsWithDeletions,
        clustersWithDeletions: result.clusters,
      }
    },
  }
}

function addGlyphReference(references: Set<number>, glyphId: number, numGlyphs: number | undefined): void {
  if (glyphId !== 0 && glyphId !== 0xFFFF && (numGlyphs === undefined || glyphId < numGlyphs)) references.add(glyphId)
}

function mergeClusterRange(clusters: number[], first: number, last: number): void {
  const start = Math.min(first, last)
  const end = Math.max(first, last)
  let merged = clusters[start]!
  for (let i = start + 1; i <= end; i++) if (clusters[i]! < merged) merged = clusters[i]!
  for (let i = start; i <= end; i++) clusters[i] = merged
}

function resolveChainFlags(chain: MortChain, selectedFeatures: readonly MortFeatureSelector[] | undefined): number {
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
