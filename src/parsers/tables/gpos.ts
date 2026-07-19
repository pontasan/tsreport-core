import { BinaryReader } from '../../binary/reader.js'
import { BinaryWriter } from '../../binary/writer.js'
import {
  parseCoverage,
  parseCoverageMap,
  parseClassDef,
  parseClassDefOrEmpty,
  parseLookupList,
  getFeatureLookupIndices,
  getDirectFeatureLookupIndices,
  getFeatureListCount,
  parseFeatureVariations,
  getOpenTypeFeatureRecords,
  validateOpenTypeFeatureRecords,
  resolveFeatureVariationSubstitution,
  buildStaticFeatureList,
  buildStaticScriptList,
  resolveExtension,
  readValueRecord,
  valueFormatSize,
  lookupIgnoresGlyph,
  parseDeviceTable,
  resolveDeviceDelta,
  LookupFlag,
  type ValueRecord,
  type LookupInfo,
  type ParsedDevice,
  type FeatureVariationsTable,
  type OpenTypeLayoutFeatureRecord,
} from './otl-common.js'
import type { GdefTable } from './gdef.js'
import type { OpenTypeFeatureSetting } from './gsub.js'

/**
 * GPOS table: OpenType glyph positioning
 * Supports all Lookup Types (1-9), lookupFlag glyph filtering via GDEF and
 * every context/chain-context subtable format (1, 2 and 3).
 */

/** Per-glyph position adjustment */
export interface PositionAdjustment {
  xPlacement: number
  yPlacement: number
  xAdvance: number
  yAdvance: number
}

/** Text direction for positioning (logical order processing) */
export type GposDirection = 'ltr' | 'rtl' | 'ttb'

/** Resolves a grid-fitted TrueType contour point for Anchor format 2. */
export interface GposAnchorPointResolver {
  getGposAnchorPoint(glyphId: number, pointIndex: number, ppem: number): { x: number, y: number } | null
}

export interface GposTable {
  /** FeatureList records, including registered FeatureParams metadata. */
  getFeatureRecords(normalizedCoords?: number[] | null): OpenTypeLayoutFeatureRecord[]

  /**
   * Whether the GPOS carries a 'kern' feature. HarfBuzz applies the legacy
   * 'kern'/'kerx' tables only when GPOS does NOT kern the run, so a font with
   * GPOS but no 'kern' feature (e.g. Arial Black) still uses its 'kern' table.
   */
  hasKernFeature: boolean

  /** Returns the kerning value between two glyphs (font units, x direction only) */
  getKerning(leftGlyphId: number, rightGlyphId: number): number

  /**
   * Returns the position adjustments for a glyph sequence
   * @param glyphIds glyph ID sequence
   * @param script script tag
   * @param language language tag
   * @param features feature tags
   * @param ligatureComponents component count map for ligature glyphs (glyphIndex -> componentCount)
   * @param gdef GDEF table used for lookupFlag glyph filtering; null disables filtering
   * @param direction text direction in logical order (default 'ltr')
   * @param advanceWidths per-glyph base advance widths (enables absolute cursive advances)
   * @param normalizedCoords normalized variation coordinates (VariationIndex resolution)
   * @param ppem pixels per em for ppem-based Device tables
   * @param ligatureMarkComponents map from mark glyph index to ligature component index
   * @returns array of position adjustments, one per glyph
   */
  getPositionAdjustments(
    glyphIds: number[],
    script?: string | null,
    language?: string | null,
    features?: Set<string> | null,
    ligatureComponents?: Map<number, number> | null,
    gdef?: GdefTable | null,
    direction?: GposDirection,
    advanceWidths?: number[] | null,
    normalizedCoords?: number[] | null,
    ppem?: number,
    ligatureMarkComponents?: Map<number, number> | null,
    zeroMarkAdvancesAfterPositioning?: boolean,
    featureSettings?: readonly OpenTypeFeatureSetting[] | null,
    sourceClusters?: readonly number[] | null,
    anchorPointResolver?: GposAnchorPointResolver | null,
  ): PositionAdjustment[]

  /** Resolve the actual LookupList indices selected by features and FeatureVariations. */
  getFeatureLookupIndices(
    features: Set<string>,
    script?: string | null,
    language?: string | null,
    normalizedCoords?: number[] | null,
  ): number[]

  /** Apply an explicit LookupList plan, used by JSTF lookup modifications. */
  getPositionAdjustmentsForLookups(
    glyphIds: number[],
    lookupIndices: readonly number[],
    ligatureComponents?: Map<number, number> | null,
    gdef?: GdefTable | null,
    direction?: GposDirection,
    advanceWidths?: number[] | null,
    normalizedCoords?: number[] | null,
    ppem?: number,
    ligatureMarkComponents?: Map<number, number> | null,
    zeroMarkAdvancesAfterPositioning?: boolean,
    anchorPointResolver?: GposAnchorPointResolver | null,
  ): PositionAdjustment[]
}

/** Executable GPOS lookups embedded in a JSTF JstfMax table. */
export interface JstfMaxTable {
  getPositionAdjustments(
    glyphIds: number[],
    gdef?: GdefTable | null,
    direction?: GposDirection,
    advanceWidths?: number[] | null,
    normalizedCoords?: number[] | null,
    ppem?: number,
    anchorPointResolver?: GposAnchorPointResolver | null,
  ): PositionAdjustment[]
}

/**
 * Parses the GPOS table
 */
export function parseGpos(reader: BinaryReader, expectedAxisCount?: number): GposTable {
  const tableStart = reader.position
  const pairs = new Map<number, number>()

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const scriptListOffset = reader.readUint16()
  const featureListOffset = reader.readUint16()
  const lookupListOffset = reader.readUint16()
  let featureVariationsOffset = 0
  if (majorVersion !== 1) {
    throw new Error(`Unsupported GPOS version: ${majorVersion}.${minorVersion}`)
  }
  if (minorVersion >= 1) featureVariationsOffset = reader.readUint32()

  // Parse the Lookup List
  const lookups = parseLookupList(reader, tableStart, lookupListOffset)
  let featureVariations: FeatureVariationsTable | null = null
  if (featureVariationsOffset !== 0) {
    const featureCount = getFeatureListCount(reader, tableStart, featureListOffset)
    featureVariations = parseFeatureVariations(
      reader, tableStart + featureVariationsOffset, featureCount, lookups.length, expectedAxisCount,
    )
  }
  validateOpenTypeFeatureRecords(
    reader, tableStart, featureListOffset, lookups.length, featureVariations,
  )

  // Pre-parse all lookups
  const parsedLookups: ParsedGposLookup[] = []
  for (let li = 0; li < lookups.length; li++) {
    const lookup = lookups[li]!
    parsedLookups.push(parseLookup(reader, lookup, lookups.length))
  }

  // Backward compatibility: build the pairs map from the kern feature's PairPos
  const kernLookupIndices = getDirectFeatureLookupIndices(
    reader, tableStart, featureListOffset, 'kern', lookups.length,
  )
  const targetLookups = kernLookupIndices.length > 0
    ? kernLookupIndices
    : Array.from({ length: lookups.length }, (_, i) => i)

  // Collect Format 2 class-based subtables for runtime lookup in getKerning
  const kernClassSubtables: PairPosData[] = []

  for (const li of targetLookups) {
    if (li >= parsedLookups.length) continue
    const parsed = parsedLookups[li]!
    if (parsed.type !== 2) continue

    for (const st of parsed.subtables as PairPosData[]) {
      for (const [key, entry] of st.pairs) {
        // Store zero-value pairs too: an explicit Format 1 pair is a lookup
        // match (it stops subtable iteration per OpenType), so a 0 here
        // deliberately overrides any class kern in a later subtable. The
        // first subtable defining a pair wins; later ones must not overwrite.
        if (!pairs.has(key)) pairs.set(key, entry.v1.xAdvance)
      }
      if (st.classData) kernClassSubtables.push(st)
    }
  }

  interface FeatureValuePlan {
    defaultValue: number
    settings: OpenTypeFeatureSetting[]
  }

  function resolveLookupFeatureValues(
    featureTags: Set<string>,
    settings: readonly OpenTypeFeatureSetting[],
    script: string | null,
    language: string | null,
    normalizedCoords: number[] | null,
  ): Map<number, FeatureValuePlan[]> {
    const tags = new Set(featureTags)
    for (let i = 0; i < settings.length; i++) tags.add(settings[i]!.tag)
    const plans = new Map<number, FeatureValuePlan[]>()
    for (const tag of tags) {
      const tagSettings: OpenTypeFeatureSetting[] = []
      for (let i = 0; i < settings.length; i++) {
        if (settings[i]!.tag === tag) tagSettings.push(settings[i]!)
      }
      const indices = getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        new Set([tag]), script, language, lookups.length, featureVariations, normalizedCoords,
      )
      const plan = { defaultValue: featureTags.has(tag) ? 1 : 0, settings: tagSettings }
      for (let i = 0; i < indices.length; i++) {
        const lookupIndex = indices[i]!
        const lookupPlans = plans.get(lookupIndex)
        if (lookupPlans === undefined) plans.set(lookupIndex, [plan])
        else lookupPlans.push(plan)
      }
    }
    return plans
  }

  function featureValueAtCluster(plan: FeatureValuePlan, cluster: number): number {
    let value = plan.defaultValue
    for (let i = 0; i < plan.settings.length; i++) {
      const setting = plan.settings[i]!
      if (cluster >= (setting.start ?? 0) && cluster < (setting.end ?? Number.POSITIVE_INFINITY)) {
        value = setting.value
      }
    }
    return value
  }

  return {
    getFeatureRecords(normalizedCoords?: number[] | null): OpenTypeLayoutFeatureRecord[] {
      return getOpenTypeFeatureRecords(
        reader, tableStart, featureListOffset, lookups.length, featureVariations, normalizedCoords ?? null,
      )
    },

    hasKernFeature: kernLookupIndices.length > 0,

    getKerning(leftGlyphId: number, rightGlyphId: number): number {
      const pairVal = pairs.get((leftGlyphId << 16) | rightGlyphId)
      if (pairVal !== undefined) return pairVal
      // Fallback to Format 2 class-based lookup
      for (const st of kernClassSubtables) {
        const cd = st.classData!
        if (!cd.coverageMap.has(leftGlyphId)) continue
        const c1 = cd.classDef1.get(leftGlyphId) ?? 0
        const c2 = cd.classDef2.get(rightGlyphId) ?? 0
        if (c1 >= cd.class1Count || c2 >= cd.class2Count) continue
        const val = cd.matrix[c1]![c2]!.v1.xAdvance
        if (val !== 0) return val
      }
      return 0
    },

    getPositionAdjustments(
      glyphIds: number[],
      script?: string | null,
      language?: string | null,
      features?: Set<string> | null,
      ligatureComponents?: Map<number, number> | null,
      gdef?: GdefTable | null,
      direction?: GposDirection,
      advanceWidths?: number[] | null,
      normalizedCoords?: number[] | null,
      ppem?: number,
      ligatureMarkComponents?: Map<number, number> | null,
      zeroMarkAdvancesAfterPositioning?: boolean,
      featureSettings?: readonly OpenTypeFeatureSetting[] | null,
      sourceClusters?: readonly number[] | null,
      anchorPointResolver?: GposAnchorPointResolver | null,
    ): PositionAdjustment[] {
      const adjustments: PositionAdjustment[] = glyphIds.map(() => ({
        xPlacement: 0, yPlacement: 0, xAdvance: 0, yAdvance: 0,
      }))

      const featureTags = features ?? new Set(['kern', 'mark', 'mkmk', 'curs', 'dist', 'abvm', 'blwm'])
      const lookupIndices = getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        featureTags, script, language, lookups.length, featureVariations, normalizedCoords ?? null,
      )

      const attachTargets = new Int32Array(glyphIds.length)
      attachTargets.fill(-1)
      const ctx: GposContext = {
        glyphIds,
        adjustments,
        allLookups: parsedLookups,
        ligatureComponents: ligatureComponents ?? null,
        gdef: gdef ?? null,
        direction: direction ?? 'ltr',
        advanceWidths: advanceWidths ?? null,
        coords: normalizedCoords ?? null,
        ppem,
        ligatureMarkComponents: ligatureMarkComponents ?? null,
        zeroMarkAdvancesAfterPositioning: zeroMarkAdvancesAfterPositioning ?? false,
        attachTargets,
        activeValues: null,
        anchorPointResolver: anchorPointResolver ?? null,
      }

      if (featureSettings !== null && featureSettings !== undefined && featureSettings.length > 0) {
        const plans = resolveLookupFeatureValues(
          featureTags, featureSettings, script ?? null, language ?? null, normalizedCoords ?? null,
        )
        const plannedLookups = [...plans.keys()].sort((a, b) => a - b)
        for (let p = 0; p < plannedLookups.length; p++) {
          const lookupIndex = plannedLookups[p]!
          if (lookupIndex >= parsedLookups.length) continue
          const lookupPlans = plans.get(lookupIndex)!
          const values = new Uint32Array(glyphIds.length)
          for (let i = 0; i < values.length; i++) {
            const cluster = sourceClusters?.[i] ?? i
            let value = 0
            for (let j = 0; j < lookupPlans.length; j++) {
              const candidate = featureValueAtCluster(lookupPlans[j]!, cluster)
              if (candidate > value) value = candidate
            }
            values[i] = value
          }
          ctx.activeValues = values
          applyLookup(parsedLookups[lookupIndex]!, ctx, undefined, 0)
        }
        ctx.activeValues = null
      } else {
        for (const li of lookupIndices) {
          if (li >= parsedLookups.length) continue
          applyLookup(parsedLookups[li]!, ctx, undefined, 0)
        }
      }

      resolveAttachments(ctx)

      return adjustments
    },

    getFeatureLookupIndices(
      features: Set<string>,
      script?: string | null,
      language?: string | null,
      normalizedCoords?: number[] | null,
    ): number[] {
      return getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        features, script, language, lookups.length, featureVariations, normalizedCoords ?? null,
      )
    },

    getPositionAdjustmentsForLookups(
      glyphIds: number[],
      lookupIndices: readonly number[],
      ligatureComponents?: Map<number, number> | null,
      gdef?: GdefTable | null,
      direction?: GposDirection,
      advanceWidths?: number[] | null,
      normalizedCoords?: number[] | null,
      ppem?: number,
      ligatureMarkComponents?: Map<number, number> | null,
      zeroMarkAdvancesAfterPositioning?: boolean,
      anchorPointResolver?: GposAnchorPointResolver | null,
    ): PositionAdjustment[] {
      const adjustments: PositionAdjustment[] = glyphIds.map(() => ({
        xPlacement: 0, yPlacement: 0, xAdvance: 0, yAdvance: 0,
      }))
      const attachTargets = new Int32Array(glyphIds.length)
      attachTargets.fill(-1)
      const ctx: GposContext = {
        glyphIds,
        adjustments,
        allLookups: parsedLookups,
        ligatureComponents: ligatureComponents ?? null,
        gdef: gdef ?? null,
        direction: direction ?? 'ltr',
        advanceWidths: advanceWidths ?? null,
        coords: normalizedCoords ?? null,
        ppem,
        ligatureMarkComponents: ligatureMarkComponents ?? null,
        zeroMarkAdvancesAfterPositioning: zeroMarkAdvancesAfterPositioning ?? false,
        attachTargets,
        activeValues: null,
        anchorPointResolver: anchorPointResolver ?? null,
      }
      for (let i = 0; i < lookupIndices.length; i++) {
        const lookupIndex = lookupIndices[i]!
        const lookup = parsedLookups[lookupIndex]
        if (lookup === undefined) throw new Error(`GPOS lookup index ${lookupIndex} is out of range`)
        applyLookup(lookup, ctx, undefined, 0)
      }
      resolveAttachments(ctx)
      return adjustments
    },
  }
}

/**
 * Validates a standalone GPOS lookup embedded in a JSTF JstfMax table.
 */
export function validateJstfMaxGposLookup(
  reader: BinaryReader,
  lookupStart: number,
  lookupCount: number,
  label: string,
): void {
  parseJstfMaxLookup(reader, lookupStart, lookupCount, label)
}

/** Parse and expose the GPOS lookups embedded in one JSTF JstfMax table. */
export function parseJstfMaxGposLookups(
  reader: BinaryReader,
  lookupStarts: readonly number[],
  label: string,
): JstfMaxTable {
  const lookups = new Array<ParsedGposLookup>(lookupStarts.length)
  for (let i = 0; i < lookupStarts.length; i++) {
    lookups[i] = parseJstfMaxLookup(reader, lookupStarts[i]!, lookupStarts.length, `${label} lookup ${i}`)
  }
  return {
    getPositionAdjustments(
      glyphIds: number[],
      gdef?: GdefTable | null,
      direction?: GposDirection,
      advanceWidths?: number[] | null,
      normalizedCoords?: number[] | null,
      ppem?: number,
      anchorPointResolver?: GposAnchorPointResolver | null,
    ): PositionAdjustment[] {
      const adjustments = glyphIds.map(() => ({ xPlacement: 0, yPlacement: 0, xAdvance: 0, yAdvance: 0 }))
      const attachTargets = new Int32Array(glyphIds.length)
      attachTargets.fill(-1)
      const ctx: GposContext = {
        glyphIds,
        adjustments,
        allLookups: lookups,
        ligatureComponents: null,
        gdef: gdef ?? null,
        direction: direction ?? 'ltr',
        advanceWidths: advanceWidths ?? null,
        coords: normalizedCoords ?? null,
        ppem,
        ligatureMarkComponents: null,
        zeroMarkAdvancesAfterPositioning: false,
        attachTargets,
        activeValues: null,
        anchorPointResolver: anchorPointResolver ?? null,
      }
      for (let i = 0; i < lookups.length; i++) applyLookup(lookups[i]!, ctx, undefined, 0)
      resolveAttachments(ctx)
      return adjustments
    },
  }
}

/** Collects every glyph referenced by positioning lookups embedded in a JstfMax table. */
export function collectJstfMaxGposGlyphIds(
  reader: BinaryReader,
  jstfMaxOffset: number,
  out: Set<number>,
): void {
  const lookups = parseJstfMaxLookupArray(reader, jstfMaxOffset)
  for (let i = 0; i < lookups.length; i++) collectGposLookupGlyphIds(lookups[i]!, out)
}

/** Rebuilds a complete JstfMax LookupList using compact glyph IDs. */
export function buildCompactJstfMaxGposTable(
  reader: BinaryReader,
  jstfMaxOffset: number,
  oldToNew: ReadonlyMap<number, number>,
  variation?: { readonly coords: number[], readonly gdef: GdefTable },
): Uint8Array {
  const lookups = parseJstfMaxLookupArray(reader, jstfMaxOffset)
  if (variation !== undefined) bakeGposVariations(lookups, variation.coords, variation.gdef)
  return serializeGposLookupList(lookups, oldToNew)
}

function parseJstfMaxLookupArray(reader: BinaryReader, offset: number): ParsedGposLookup[] {
  reader.seek(offset)
  const lookupCount = reader.readUint16()
  const lookupStarts = new Array<number>(lookupCount)
  for (let i = 0; i < lookupCount; i++) lookupStarts[i] = offset + reader.readUint16()
  const lookups = new Array<ParsedGposLookup>(lookupCount)
  for (let i = 0; i < lookupCount; i++) {
    lookups[i] = parseJstfMaxLookup(reader, lookupStarts[i]!, lookupCount, `JSTF JstfMax lookup ${i}`)
  }
  return lookups
}

function collectGposLookupGlyphIds(lookup: ParsedGposLookup, out: Set<number>): void {
  for (let i = 0; i < lookup.subtables.length; i++) {
    const subtable = lookup.subtables[i]!
    if (subtable.kind === 1 || subtable.kind === 3) {
      addMapKeys(subtable.coverageMap, out)
    } else if (subtable.kind === 2) {
      if (subtable.classData !== undefined) {
        addMapKeys(subtable.classData.coverageMap, out)
        addMapKeys(subtable.classData.classDef1, out)
        addMapKeys(subtable.classData.classDef2, out)
      } else {
        for (const key of subtable.pairs.keys()) {
          out.add(key >>> 16)
          out.add(key & 0xFFFF)
        }
      }
    } else if (subtable.kind === 4) {
      addMapKeys(subtable.markCoverage, out)
      addMapKeys(subtable.baseCoverage, out)
    } else if (subtable.kind === 5) {
      addMapKeys(subtable.markCoverage, out)
      addMapKeys(subtable.ligatureCoverage, out)
    } else if (subtable.kind === 6) {
      addMapKeys(subtable.mark1Coverage, out)
      addMapKeys(subtable.mark2Coverage, out)
    }
  }
}

function addMapKeys(map: ReadonlyMap<number, unknown>, out: Set<number>): void {
  for (const glyphId of map.keys()) out.add(glyphId)
}

function parseJstfMaxLookup(
  reader: BinaryReader,
  lookupStart: number,
  lookupCount: number,
  label: string,
): ParsedGposLookup {
  validateJstfGposRange(reader, lookupStart, 6, `${label} header`)
  reader.seek(lookupStart)
  const type = reader.readUint16()
  const flag = reader.readUint16()
  if ((flag & 0x00E0) !== 0) {
    throw new Error(`${label} LookupFlag reserved bits must be zero: 0x${(flag & 0x00E0).toString(16).padStart(4, '0')}`)
  }
  if (type === 7 || type === 8) {
    throw new Error(`${label} must not use contextual GPOS lookup type ${type}`)
  }
  const subtableCount = reader.readUint16()
  if (subtableCount === 0) {
    throw new Error(`${label} must contain at least one subtable`)
  }
  const hasMarkFilteringSet = (flag & 0x0010) !== 0
  const headerLength = 6 + subtableCount * 2 + (hasMarkFilteringSet ? 2 : 0)
  validateJstfGposRange(reader, lookupStart, headerLength, `${label} subtable offset array`)

  const subtableOffsets: number[] = []
  for (let i = 0; i < subtableCount; i++) {
    const relativeOffset = reader.readUint16()
    if (relativeOffset < headerLength) {
      throw new Error(`${label} subtable offset ${i} overlaps lookup header`)
    }
    const absoluteOffset = lookupStart + relativeOffset
    if (absoluteOffset >= reader.length) {
      throw new Error(`${label} subtable offset ${i} exceeds JSTF table length: ${relativeOffset}`)
    }
    subtableOffsets.push(absoluteOffset)
  }

  const markFilteringSet = hasMarkFilteringSet ? reader.readUint16() : undefined

  if (type === 9) {
    for (let i = 0; i < subtableOffsets.length; i++) {
      const extension = resolveExtension(reader, subtableOffsets[i]!, type, 9)
      if (extension.actualType === 7 || extension.actualType === 8) {
        throw new Error(`${label} must not use contextual GPOS lookup type ${extension.actualType}`)
      }
    }
  }
  const lookup = parseLookup(reader, { type, flag, subtableOffsets, markFilteringSet }, lookupCount)
  if (lookup.type === 7 || lookup.type === 8) {
    throw new Error(`${label} must not use contextual GPOS lookup type ${lookup.type}`)
  }
  return lookup
}

function validateJstfGposRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds JSTF table length: need ${offset + length}, got ${reader.length}`)
  }
}

// --- Parsed Lookup data structures ---

interface ParsedGposLookup {
  type: number
  flag: number
  markFilteringSet: number | undefined
  subtables: GposSubtableData[]
}

type GposSubtableData =
  | SinglePosData
  | PairPosData
  | CursivePosData
  | MarkBasePosData
  | MarkLigPosData
  | MarkMarkPosData
  | ContextPosData
  | ChainContextPosData

interface SinglePosData {
  kind: 1
  format: number
  coverageMap: Map<number, number>
  valueFormat: number
  // Format 1: single value for all
  singleValue?: ValueRecord
  // Format 2: per-glyph values
  values?: ValueRecord[]
}

/** Full pair value: value records for the first and second glyph */
interface PairValueEntry {
  v1: ValueRecord
  v2: ValueRecord | null
}

interface PairPosData {
  kind: 2
  /** (leftGid << 16 | rightGid) → value records (Format 1) */
  pairs: Map<number, PairValueEntry>
  /** Whether valueFormat2 is non-zero (second glyph consumes the pair) */
  hasValue2: boolean
  // Format 2: class-based data for runtime lookup (handles class 0 glyphs correctly)
  classData?: {
    coverageMap: Map<number, number>
    classDef1: Map<number, number>
    classDef2: Map<number, number>
    matrix: PairValueEntry[][]  // [class1Count][class2Count]
    class1Count: number
    class2Count: number
  }
}

interface CursivePosData {
  kind: 3
  coverageMap: Map<number, number>
  entryAnchors: (Anchor | null)[]
  exitAnchors: (Anchor | null)[]
}

interface MarkBasePosData {
  kind: 4
  markCoverage: Map<number, number>
  baseCoverage: Map<number, number>
  markArray: MarkRecord[]
  baseArray: (Anchor | null)[][]  // [baseIndex][markClass]
}

interface MarkLigPosData {
  kind: 5
  markCoverage: Map<number, number>
  ligatureCoverage: Map<number, number>
  markArray: MarkRecord[]
  ligatureArray: (Anchor | null)[][][]  // [ligIndex][componentIndex][markClass]
}

interface MarkMarkPosData {
  kind: 6
  mark1Coverage: Map<number, number>
  mark2Coverage: Map<number, number>
  mark1Array: MarkRecord[]
  mark2Array: (Anchor | null)[][]  // [mark2Index][markClass]
}

interface ContextPosData {
  kind: 7
  format: number
  rules: ContextPosRule[]
}

interface ContextPosRule {
  format: number
  // Format 1: glyph-based
  rulesByGlyph?: Map<number, { sequence: number[], lookups: PosLookupRecord[] }[]>
  // Format 2: class-based
  coverageMap?: Map<number, number>
  classDef?: Map<number, number>
  rulesByClass?: Map<number, { sequence: number[], lookups: PosLookupRecord[] }[]>
  // Format 3: coverage-based
  coverages?: Map<number, number>[]
  lookups?: PosLookupRecord[]
}

interface ChainContextPosData {
  kind: 8
  format: number
  rules: ChainContextPosRule[]
}

interface ChainContextPosRule {
  format: number
  // Format 1
  rulesByGlyph?: Map<number, {
    backtrack: number[], input: number[], lookahead: number[], lookups: PosLookupRecord[]
  }[]>
  coverageMap?: Map<number, number>
  // Format 2
  backtrackClassDef?: Map<number, number>
  inputClassDef?: Map<number, number>
  lookaheadClassDef?: Map<number, number>
  rulesByClass?: Map<number, {
    backtrack: number[], input: number[], lookahead: number[], lookups: PosLookupRecord[]
  }[]>
  // Format 3
  backtrackCoverages?: Map<number, number>[]
  inputCoverages?: Map<number, number>[]
  lookaheadCoverages?: Map<number, number>[]
  lookups?: PosLookupRecord[]
}

interface Anchor {
  x: number
  y: number
  /** TrueType contour point used for grid-fitted device positioning. */
  pointIndex?: number
  /** Anchor format 3 device / VariationIndex tables */
  xDevice?: ParsedDevice | null
  yDevice?: ParsedDevice | null
}

interface MarkRecord {
  markClass: number
  anchor: Anchor
}

interface PosLookupRecord {
  sequenceIndex: number
  lookupListIndex: number
}

/** Maximum nesting depth for contextual lookup records (matches HarfBuzz). */
const MAX_NESTING_DEPTH = 64

// --- Lookup parsing ---

function parseLookup(reader: BinaryReader, lookup: LookupInfo, lookupCount: number): ParsedGposLookup {
  const subtables: GposSubtableData[] = []
  let extensionLookupType = -1

  for (const stOffset of lookup.subtableOffsets) {
    const { actualType, actualStart } = resolveExtension(reader, stOffset, lookup.type, 9)
    if (lookup.type === 9) {
      if (extensionLookupType < 0) {
        extensionLookupType = actualType
      } else if (extensionLookupType !== actualType) {
        throw new Error(`GPOS ExtensionPos subtables must use the same extensionLookupType: ${extensionLookupType} != ${actualType}`)
      }
    }

    reader.seek(actualStart)
    const subtable = parseSubtable(reader, actualType, actualStart, lookupCount)
    if (subtable) subtables.push(subtable)
  }

  const resolvedType = subtables.length > 0
    ? (lookup.type === 9 ? subtables[0]!.kind : lookup.type)
    : lookup.type

  return { type: resolvedType, flag: lookup.flag, markFilteringSet: lookup.markFilteringSet, subtables }
}

function parseSubtable(
  reader: BinaryReader,
  type: number,
  subtableStart: number,
  lookupCount: number,
): GposSubtableData | null {
  switch (type) {
    case 1: return parseSinglePos(reader, subtableStart)
    case 2: return parsePairPos(reader, subtableStart)
    case 3: return parseCursivePos(reader, subtableStart)
    case 4: return parseMarkBasePos(reader, subtableStart)
    case 5: return parseMarkLigPos(reader, subtableStart)
    case 6: return parseMarkMarkPos(reader, subtableStart)
    case 7: return parseContextPos(reader, subtableStart, lookupCount)
    case 8: return parseChainContextPos(reader, subtableStart, lookupCount)
    default: throw new Error(`Unsupported GPOS lookup type: ${type}`)
  }
}

// --- Type 1: SinglePos ---

function parseSinglePos(reader: BinaryReader, subtableStart: number): SinglePosData {
  const format = reader.readUint16()
  if (format !== 1 && format !== 2) {
    throw new Error(`Unsupported SinglePos format: ${format}`)
  }
  const coverageOffset = reader.readUint16()
  const vf = reader.readUint16()

  const coverageMap = parseCoverageMap(reader, subtableStart + coverageOffset)
  reader.seek(subtableStart + 6) // after format + coverage + valueFormat

  if (format === 1) {
    const singleValue = readValueRecord(reader, vf, subtableStart)
    return { kind: 1, format, coverageMap, valueFormat: vf, singleValue }
  } else {
    const valueCount = reader.readUint16()
    const values: ValueRecord[] = []
    for (let i = 0; i < valueCount; i++) {
      values.push(readValueRecord(reader, vf, subtableStart))
    }
    return { kind: 1, format: 2, coverageMap, valueFormat: vf, values }
  }
}

// --- Type 2: PairPos ---

const EMPTY_VALUE: ValueRecord = { xPlacement: 0, yPlacement: 0, xAdvance: 0, yAdvance: 0 }

function parsePairPos(reader: BinaryReader, subtableStart: number): PairPosData {
  const posFormat = reader.readUint16()
  if (posFormat !== 1 && posFormat !== 2) {
    throw new Error(`Unsupported PairPos format: ${posFormat}`)
  }
  const coverageOffset = reader.readUint16()
  const valueFormat1 = reader.readUint16()
  const valueFormat2 = reader.readUint16()

  const hasValue2 = valueFormat2 !== 0
  const pairs = new Map<number, PairValueEntry>()

  if (posFormat === 1) {
    // Format 1: individual pairs
    const pairSetCount = reader.readUint16()
    const pairSetOffsets: number[] = []
    for (let i = 0; i < pairSetCount; i++) {
      pairSetOffsets.push(reader.readUint16())
    }

    const coverageGlyphs = parseCoverage(reader, subtableStart + coverageOffset)

    for (let i = 0; i < pairSetCount; i++) {
      if (i >= coverageGlyphs.length) break
      const leftGlyph = coverageGlyphs[i]!

      // Device table offsets in PairSet value records are relative to the
      // PairSet table, not the PairPos subtable (OpenType GPOS spec)
      const pairSetStart = subtableStart + pairSetOffsets[i]!
      reader.seek(pairSetStart)
      const pairValueCount = reader.readUint16()

      for (let j = 0; j < pairValueCount; j++) {
        const rightGlyph = reader.readUint16()
        const v1 = readValueRecord(reader, valueFormat1, pairSetStart)
        const v2 = hasValue2 ? readValueRecord(reader, valueFormat2, pairSetStart) : null

        pairs.set((leftGlyph << 16) | rightGlyph, { v1, v2 })
      }
    }
  } else if (posFormat === 2) {
    // Format 2: class pairs
    const classDef1Offset = reader.readUint16()
    const classDef2Offset = reader.readUint16()
    const class1Count = reader.readUint16()
    const class2Count = reader.readUint16()

    const matrix: PairValueEntry[][] = []
    for (let c1 = 0; c1 < class1Count; c1++) {
      const row: PairValueEntry[] = []
      for (let c2 = 0; c2 < class2Count; c2++) {
        const v1 = valueFormat1 !== 0 ? readValueRecord(reader, valueFormat1, subtableStart) : EMPTY_VALUE
        const v2 = hasValue2 ? readValueRecord(reader, valueFormat2, subtableStart) : null
        row.push({ v1, v2 })
      }
      matrix.push(row)
    }

    const coverageMap = parseCoverageMap(reader, subtableStart + coverageOffset)
    const classDef1 = parseClassDef(reader, subtableStart + classDef1Offset)
    const classDef2 = parseClassDef(reader, subtableStart + classDef2Offset)

    // Store class-based data for runtime lookup (handles class 0 correctly)
    return {
      kind: 2,
      pairs,
      hasValue2,
      classData: { coverageMap, classDef1, classDef2, matrix, class1Count, class2Count },
    }
  }

  return { kind: 2, pairs, hasValue2 }
}

// --- Type 3: CursivePos ---

function parseCursivePos(reader: BinaryReader, subtableStart: number): CursivePosData {
  const format = reader.readUint16()
  if (format !== 1) {
    throw new Error(`Unsupported CursivePos format: ${format}`)
  }
  const coverageOffset = reader.readUint16()
  const entryExitCount = reader.readUint16()

  const entryAnchors: (Anchor | null)[] = []
  const exitAnchors: (Anchor | null)[] = []

  for (let i = 0; i < entryExitCount; i++) {
    const entryOff = reader.readUint16()
    const exitOff = reader.readUint16()
    entryAnchors.push(entryOff ? readAnchor(reader, subtableStart + entryOff) : null)
    exitAnchors.push(exitOff ? readAnchor(reader, subtableStart + exitOff) : null)
  }

  const coverageMap = parseCoverageMap(reader, subtableStart + coverageOffset)

  return { kind: 3, coverageMap, entryAnchors, exitAnchors }
}

// --- Type 4: MarkBasePos ---

function parseMarkBasePos(reader: BinaryReader, subtableStart: number): MarkBasePosData {
  const format = reader.readUint16()
  if (format !== 1) {
    throw new Error(`Unsupported MarkBasePos format: ${format}`)
  }
  const markCoverageOffset = reader.readUint16()
  const baseCoverageOffset = reader.readUint16()
  const markClassCount = reader.readUint16()
  const markArrayOffset = reader.readUint16()
  const baseArrayOffset = reader.readUint16()

  const markCoverage = parseCoverageMap(reader, subtableStart + markCoverageOffset)
  const baseCoverage = parseCoverageMap(reader, subtableStart + baseCoverageOffset)
  const markArray = parseMarkArray(reader, subtableStart + markArrayOffset)
  const baseArray = parseBaseArray(reader, subtableStart + baseArrayOffset, markClassCount)

  return { kind: 4, markCoverage, baseCoverage, markArray, baseArray }
}

// --- Type 5: MarkLigPos ---

function parseMarkLigPos(reader: BinaryReader, subtableStart: number): MarkLigPosData {
  const format = reader.readUint16()
  if (format !== 1) {
    throw new Error(`Unsupported MarkLigPos format: ${format}`)
  }
  const markCoverageOffset = reader.readUint16()
  const ligatureCoverageOffset = reader.readUint16()
  const markClassCount = reader.readUint16()
  const markArrayOffset = reader.readUint16()
  const ligatureArrayOffset = reader.readUint16()

  const markCoverage = parseCoverageMap(reader, subtableStart + markCoverageOffset)
  const ligatureCoverage = parseCoverageMap(reader, subtableStart + ligatureCoverageOffset)
  const markArray = parseMarkArray(reader, subtableStart + markArrayOffset)

  // LigatureArray
  const ligArrayBase = subtableStart + ligatureArrayOffset
  reader.seek(ligArrayBase)
  const ligatureCount = reader.readUint16()
  const ligAttachOffsets: number[] = []
  for (let i = 0; i < ligatureCount; i++) {
    ligAttachOffsets.push(reader.readUint16())
  }

  const ligatureArray: (Anchor | null)[][][] = []
  for (const laOff of ligAttachOffsets) {
    const laBase = ligArrayBase + laOff
    reader.seek(laBase)
    const componentCount = reader.readUint16()
    const components: (Anchor | null)[][] = []
    const anchorOffsets: number[] = []
    for (let c = 0; c < componentCount; c++) {
      for (let m = 0; m < markClassCount; m++) {
        anchorOffsets.push(reader.readUint16())
      }
    }

    let idx = 0
    for (let c = 0; c < componentCount; c++) {
      const row: (Anchor | null)[] = []
      for (let m = 0; m < markClassCount; m++) {
        const off = anchorOffsets[idx++]!
        row.push(off ? readAnchor(reader, laBase + off) : null)
      }
      components.push(row)
    }
    ligatureArray.push(components)
  }

  return { kind: 5, markCoverage, ligatureCoverage, markArray, ligatureArray }
}

// --- Type 6: MarkMarkPos ---

function parseMarkMarkPos(reader: BinaryReader, subtableStart: number): MarkMarkPosData {
  const format = reader.readUint16()
  if (format !== 1) {
    throw new Error(`Unsupported MarkMarkPos format: ${format}`)
  }
  const mark1CoverageOffset = reader.readUint16()
  const mark2CoverageOffset = reader.readUint16()
  const markClassCount = reader.readUint16()
  const mark1ArrayOffset = reader.readUint16()
  const mark2ArrayOffset = reader.readUint16()

  const mark1Coverage = parseCoverageMap(reader, subtableStart + mark1CoverageOffset)
  const mark2Coverage = parseCoverageMap(reader, subtableStart + mark2CoverageOffset)
  const mark1Array = parseMarkArray(reader, subtableStart + mark1ArrayOffset)
  const mark2Array = parseBaseArray(reader, subtableStart + mark2ArrayOffset, markClassCount)

  return { kind: 6, mark1Coverage, mark2Coverage, mark1Array, mark2Array }
}

// --- Type 7: ContextPos ---

function parseContextPos(reader: BinaryReader, subtableStart: number, lookupCount: number): ContextPosData {
  const format = reader.readUint16()
  const rules: ContextPosRule[] = []

  if (format === 1) {
    const coverageOffset = reader.readUint16()
    const ruleSetCount = reader.readUint16()
    const ruleSetOffsets: number[] = []
    for (let i = 0; i < ruleSetCount; i++) {
      ruleSetOffsets.push(reader.readUint16())
    }

    const coverageGlyphs = parseCoverage(reader, subtableStart + coverageOffset)
    const rulesByGlyph = new Map<number, { sequence: number[], lookups: PosLookupRecord[] }[]>()

    for (let i = 0; i < ruleSetCount && i < coverageGlyphs.length; i++) {
      if (ruleSetOffsets[i] === 0) continue
      const ruleSetBase = subtableStart + ruleSetOffsets[i]!
      reader.seek(ruleSetBase)
      const ruleCount = reader.readUint16()
      const ruleOffsets: number[] = []
      for (let j = 0; j < ruleCount; j++) {
        ruleOffsets.push(reader.readUint16())
      }

      const ruleList: { sequence: number[], lookups: PosLookupRecord[] }[] = []
      for (const rOff of ruleOffsets) {
        reader.seek(ruleSetBase + rOff)
        const glyphCount = reader.readUint16()
        const posCount = reader.readUint16()
        const sequence: number[] = []
        for (let g = 1; g < glyphCount; g++) sequence.push(reader.readUint16())
        const lookups = readPosLookupRecords(reader, posCount, lookupCount)
        ruleList.push({ sequence, lookups })
      }
      rulesByGlyph.set(coverageGlyphs[i]!, ruleList)
    }

    rules.push({ format: 1, rulesByGlyph })

  } else if (format === 2) {
    const coverageOffset = reader.readUint16()
    const classDefOffset = reader.readUint16()
    const classSetCount = reader.readUint16()
    const classSetOffsets: number[] = []
    for (let i = 0; i < classSetCount; i++) {
      classSetOffsets.push(reader.readUint16())
    }

    const coverageMap = parseCoverageMap(reader, subtableStart + coverageOffset)
    const classDef = parseClassDefOrEmpty(reader, subtableStart, classDefOffset)
    const rulesByClass = new Map<number, { sequence: number[], lookups: PosLookupRecord[] }[]>()

    for (let ci = 0; ci < classSetCount; ci++) {
      if (classSetOffsets[ci] === 0) continue
      const classSetBase = subtableStart + classSetOffsets[ci]!
      reader.seek(classSetBase)
      const ruleCount = reader.readUint16()
      const ruleOffsets: number[] = []
      for (let j = 0; j < ruleCount; j++) {
        ruleOffsets.push(reader.readUint16())
      }

      const ruleList: { sequence: number[], lookups: PosLookupRecord[] }[] = []
      for (const rOff of ruleOffsets) {
        reader.seek(classSetBase + rOff)
        const glyphCount = reader.readUint16()
        const posCount = reader.readUint16()
        const sequence: number[] = []
        for (let g = 1; g < glyphCount; g++) sequence.push(reader.readUint16())
        const lookups = readPosLookupRecords(reader, posCount, lookupCount)
        ruleList.push({ sequence, lookups })
      }
      rulesByClass.set(ci, ruleList)
    }

    rules.push({ format: 2, coverageMap, classDef, rulesByClass })

  } else if (format === 3) {
    const glyphCount = reader.readUint16()
    const posCount = reader.readUint16()
    const coverageOffsets: number[] = []
    for (let i = 0; i < glyphCount; i++) {
      coverageOffsets.push(reader.readUint16())
    }
    const lookups = readPosLookupRecords(reader, posCount, lookupCount)
    const coverages = coverageOffsets.map(off => parseCoverageMap(reader, subtableStart + off))
    rules.push({ format: 3, coverages, lookups })
  } else {
    throw new Error(`Unsupported ContextPos format: ${format}`)
  }

  return { kind: 7, format, rules }
}

// --- Type 8: ChainContextPos ---

function parseChainContextPos(reader: BinaryReader, subtableStart: number, lookupCount: number): ChainContextPosData {
  const format = reader.readUint16()
  const rules: ChainContextPosRule[] = []

  if (format === 1) {
    const coverageOffset = reader.readUint16()
    const chainRuleSetCount = reader.readUint16()
    const chainRuleSetOffsets: number[] = []
    for (let i = 0; i < chainRuleSetCount; i++) {
      chainRuleSetOffsets.push(reader.readUint16())
    }

    const coverageMap = parseCoverageMap(reader, subtableStart + coverageOffset)
    const coverageGlyphs = [...coverageMap.keys()]
    const rulesByGlyph = new Map<number, {
      backtrack: number[], input: number[], lookahead: number[], lookups: PosLookupRecord[]
    }[]>()

    for (let i = 0; i < chainRuleSetCount && i < coverageGlyphs.length; i++) {
      if (chainRuleSetOffsets[i] === 0) continue
      const ruleSetBase = subtableStart + chainRuleSetOffsets[i]!
      reader.seek(ruleSetBase)
      const ruleCount = reader.readUint16()
      const ruleOffsets: number[] = []
      for (let j = 0; j < ruleCount; j++) {
        ruleOffsets.push(reader.readUint16())
      }

      const ruleList: {
        backtrack: number[], input: number[], lookahead: number[], lookups: PosLookupRecord[]
      }[] = []

      for (const rOff of ruleOffsets) {
        reader.seek(ruleSetBase + rOff)
        const backtrackCount = reader.readUint16()
        const backtrack: number[] = []
        for (let b = 0; b < backtrackCount; b++) backtrack.push(reader.readUint16())

        const inputCount = reader.readUint16()
        const input: number[] = []
        for (let g = 1; g < inputCount; g++) input.push(reader.readUint16())

        const lookaheadCount = reader.readUint16()
        const lookahead: number[] = []
        for (let l = 0; l < lookaheadCount; l++) lookahead.push(reader.readUint16())

        const posCount = reader.readUint16()
        const lookups = readPosLookupRecords(reader, posCount, lookupCount)
        ruleList.push({ backtrack, input, lookahead, lookups })
      }
      rulesByGlyph.set(coverageGlyphs[i]!, ruleList)
    }

    rules.push({ format: 1, rulesByGlyph, coverageMap })

  } else if (format === 2) {
    const coverageOffset = reader.readUint16()
    const backtrackClassDefOffset = reader.readUint16()
    const inputClassDefOffset = reader.readUint16()
    const lookaheadClassDefOffset = reader.readUint16()
    const chainClassSetCount = reader.readUint16()
    const chainClassSetOffsets: number[] = []
    for (let i = 0; i < chainClassSetCount; i++) {
      chainClassSetOffsets.push(reader.readUint16())
    }

    const coverageMap = parseCoverageMap(reader, subtableStart + coverageOffset)
    const backtrackClassDef = parseClassDefOrEmpty(reader, subtableStart, backtrackClassDefOffset)
    const inputClassDef = parseClassDefOrEmpty(reader, subtableStart, inputClassDefOffset)
    const lookaheadClassDef = parseClassDefOrEmpty(reader, subtableStart, lookaheadClassDefOffset)

    const rulesByClass = new Map<number, {
      backtrack: number[], input: number[], lookahead: number[], lookups: PosLookupRecord[]
    }[]>()

    for (let ci = 0; ci < chainClassSetCount; ci++) {
      if (chainClassSetOffsets[ci] === 0) continue
      const classSetBase = subtableStart + chainClassSetOffsets[ci]!
      reader.seek(classSetBase)
      const ruleCount = reader.readUint16()
      const ruleOffsets: number[] = []
      for (let j = 0; j < ruleCount; j++) {
        ruleOffsets.push(reader.readUint16())
      }

      const ruleList: {
        backtrack: number[], input: number[], lookahead: number[], lookups: PosLookupRecord[]
      }[] = []

      for (const rOff of ruleOffsets) {
        reader.seek(classSetBase + rOff)
        const backtrackCount = reader.readUint16()
        const backtrack: number[] = []
        for (let b = 0; b < backtrackCount; b++) backtrack.push(reader.readUint16())

        const inputCount = reader.readUint16()
        const input: number[] = []
        for (let g = 1; g < inputCount; g++) input.push(reader.readUint16())

        const lookaheadCount = reader.readUint16()
        const lookahead: number[] = []
        for (let l = 0; l < lookaheadCount; l++) lookahead.push(reader.readUint16())

        const posCount = reader.readUint16()
        const lookups = readPosLookupRecords(reader, posCount, lookupCount)
        ruleList.push({ backtrack, input, lookahead, lookups })
      }
      rulesByClass.set(ci, ruleList)
    }

    rules.push({
      format: 2, coverageMap, backtrackClassDef, inputClassDef, lookaheadClassDef, rulesByClass,
    })

  } else if (format === 3) {
    const backtrackCount = reader.readUint16()
    const backtrackOffsets: number[] = []
    for (let i = 0; i < backtrackCount; i++) backtrackOffsets.push(reader.readUint16())

    const inputCount = reader.readUint16()
    const inputOffsets: number[] = []
    for (let i = 0; i < inputCount; i++) inputOffsets.push(reader.readUint16())

    const lookaheadCount = reader.readUint16()
    const lookaheadOffsets: number[] = []
    for (let i = 0; i < lookaheadCount; i++) lookaheadOffsets.push(reader.readUint16())

    const posCount = reader.readUint16()
    const lookups = readPosLookupRecords(reader, posCount, lookupCount)

    const backtrackCoverages = backtrackOffsets.map(off => parseCoverageMap(reader, subtableStart + off))
    const inputCoverages = inputOffsets.map(off => parseCoverageMap(reader, subtableStart + off))
    const lookaheadCoverages = lookaheadOffsets.map(off => parseCoverageMap(reader, subtableStart + off))

    rules.push({ format: 3, backtrackCoverages, inputCoverages, lookaheadCoverages, lookups })
  } else {
    throw new Error(`Unsupported ChainContextPos format: ${format}`)
  }

  return { kind: 8, format, rules }
}

// --- Helper functions ---

function readPosLookupRecords(reader: BinaryReader, count: number, lookupCount: number): PosLookupRecord[] {
  const records: PosLookupRecord[] = []
  for (let i = 0; i < count; i++) {
    const sequenceIndex = reader.readUint16()
    const lookupListIndex = reader.readUint16()
    if (lookupListIndex >= lookupCount) {
      throw new Error(`GPOS contextual lookup index ${lookupListIndex} out of LookupList range ${lookupCount}`)
    }
    records.push({ sequenceIndex, lookupListIndex })
  }
  return records
}

interface SerializedGposSubtable { type: number, data: Uint8Array }

/** Rebuilds GPOS for a compact glyph-ID mapping while preserving feature and lookup indices. */
export function buildCompactGposTable(
  reader: BinaryReader,
  oldToNew: ReadonlyMap<number, number>,
  variation?: { readonly coords: number[], readonly gdef: GdefTable | null },
  expectedAxisCount?: number,
): Uint8Array {
  reader.seek(0)
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const scriptListOffset = reader.readUint16()
  const featureListOffset = reader.readUint16()
  const lookupListOffset = reader.readUint16()
  const featureVariationsOffset = minorVersion >= 1 ? reader.readUint32() : 0
  if (majorVersion !== 1) throw new Error(`Unsupported GPOS version: ${majorVersion}.${minorVersion}`)
  const lookups = parseLookupList(reader, 0, lookupListOffset)
  const parsedLookups = new Array<ParsedGposLookup>(lookups.length)
  for (let i = 0; i < lookups.length; i++) parsedLookups[i] = parseLookup(reader, lookups[i]!, lookups.length)
  if (variation !== undefined && variation.gdef !== null) {
    bakeGposVariations(parsedLookups, variation.coords, variation.gdef)
  }
  const lookupData = serializeGposLookupList(parsedLookups, oldToNew)
  const featureCount = featureListOffset === 0 ? 0 : getFeatureListCount(reader, 0, featureListOffset)
  let substitutions: ReadonlyMap<number, number> | null = null
  if (variation !== undefined && featureVariationsOffset !== 0) {
    const variations = parseFeatureVariations(
      reader,
      featureVariationsOffset,
      featureCount,
      lookups.length,
      expectedAxisCount,
    )
    substitutions = resolveFeatureVariationSubstitution(variations, variation.coords)
  }
  const scriptData = buildStaticScriptList(reader, scriptListOffset, featureCount)
  const featureData = buildStaticFeatureList(reader, featureListOffset, substitutions, lookups.length)
  const headerSize = 10
  const scriptOutputOffset = scriptData === null ? 0 : headerSize
  const featureOutputOffset = featureListOffset === 0 ? 0 : headerSize + (scriptData?.length ?? 0)
  const lookupOutputOffset = headerSize + (scriptData?.length ?? 0) + featureData.length
  assertOffset16(scriptOutputOffset, 'GPOS ScriptList')
  assertOffset16(featureOutputOffset, 'GPOS FeatureList')
  assertOffset16(lookupOutputOffset, 'GPOS LookupList')
  const writer = new BinaryWriter(lookupOutputOffset + lookupData.length)
  writer.writeUint16(majorVersion)
  writer.writeUint16(0)
  writer.writeUint16(scriptOutputOffset)
  writer.writeUint16(featureOutputOffset)
  writer.writeUint16(lookupOutputOffset)
  if (scriptData !== null) writer.writeBytes(scriptData)
  writer.writeBytes(featureData)
  writer.writeBytes(lookupData)
  return writer.toUint8Array()
}

function bakeGposVariations(
  lookups: readonly ParsedGposLookup[],
  coords: number[],
  gdef: GdefTable,
): void {
  const values = new Set<ValueRecord>()
  const anchors = new Set<Anchor>()
  for (let lookupIndex = 0; lookupIndex < lookups.length; lookupIndex++) {
    const lookup = lookups[lookupIndex]!
    for (let subtableIndex = 0; subtableIndex < lookup.subtables.length; subtableIndex++) {
      const subtable = lookup.subtables[subtableIndex]!
      if (subtable.kind === 1) {
        if (subtable.singleValue !== undefined) values.add(subtable.singleValue)
        if (subtable.values !== undefined) for (let i = 0; i < subtable.values.length; i++) values.add(subtable.values[i]!)
      } else if (subtable.kind === 2) {
        for (const pair of subtable.pairs.values()) {
          values.add(pair.v1)
          if (pair.v2 !== null) values.add(pair.v2)
        }
        if (subtable.classData !== undefined) {
          for (let row = 0; row < subtable.classData.matrix.length; row++) {
            const cells = subtable.classData.matrix[row]!
            for (let column = 0; column < cells.length; column++) {
              values.add(cells[column]!.v1)
              if (cells[column]!.v2 !== null) values.add(cells[column]!.v2!)
            }
          }
        }
      } else if (subtable.kind === 3) {
        addAnchors(subtable.entryAnchors, anchors)
        addAnchors(subtable.exitAnchors, anchors)
      } else if (subtable.kind === 4) {
        addMarkAnchors(subtable.markArray, anchors)
        addAnchorRows(subtable.baseArray, anchors)
      } else if (subtable.kind === 5) {
        addMarkAnchors(subtable.markArray, anchors)
        for (let ligature = 0; ligature < subtable.ligatureArray.length; ligature++) {
          addAnchorRows(subtable.ligatureArray[ligature]!, anchors)
        }
      } else if (subtable.kind === 6) {
        addMarkAnchors(subtable.mark1Array, anchors)
        addAnchorRows(subtable.mark2Array, anchors)
      }
    }
  }
  for (const value of values) bakeGposValue(value, coords, gdef)
  for (const anchor of anchors) bakeGposAnchor(anchor, coords, gdef)
}

function addAnchors(source: readonly (Anchor | null)[], out: Set<Anchor>): void {
  for (let i = 0; i < source.length; i++) if (source[i] !== null) out.add(source[i]!)
}

function addAnchorRows(source: readonly (readonly (Anchor | null)[])[], out: Set<Anchor>): void {
  for (let row = 0; row < source.length; row++) addAnchors(source[row]!, out)
}

function addMarkAnchors(source: readonly MarkRecord[], out: Set<Anchor>): void {
  for (let i = 0; i < source.length; i++) out.add(source[i]!.anchor)
}

function bakeGposValue(value: ValueRecord, coords: number[], gdef: GdefTable): void {
  if (value.xPlaDevice?.isVariation === true) {
    value.xPlacement += gdef.getVarDelta(value.xPlaDevice.first, value.xPlaDevice.second, coords)
    value.xPlaDevice = null
  }
  if (value.yPlaDevice?.isVariation === true) {
    value.yPlacement += gdef.getVarDelta(value.yPlaDevice.first, value.yPlaDevice.second, coords)
    value.yPlaDevice = null
  }
  if (value.xAdvDevice?.isVariation === true) {
    value.xAdvance += gdef.getVarDelta(value.xAdvDevice.first, value.xAdvDevice.second, coords)
    value.xAdvDevice = null
  }
  if (value.yAdvDevice?.isVariation === true) {
    value.yAdvance += gdef.getVarDelta(value.yAdvDevice.first, value.yAdvDevice.second, coords)
    value.yAdvDevice = null
  }
}

function bakeGposAnchor(anchor: Anchor, coords: number[], gdef: GdefTable): void {
  if (anchor.xDevice?.isVariation === true) {
    anchor.x += gdef.getVarDelta(anchor.xDevice.first, anchor.xDevice.second, coords)
    anchor.xDevice = null
  }
  if (anchor.yDevice?.isVariation === true) {
    anchor.y += gdef.getVarDelta(anchor.yDevice.first, anchor.yDevice.second, coords)
    anchor.yDevice = null
  }
}

function serializeGposLookupList(
  lookups: readonly ParsedGposLookup[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const serialized = new Array<SerializedGposSubtable[]>(lookups.length)
  for (let lookupIndex = 0; lookupIndex < lookups.length; lookupIndex++) {
    const lookup = lookups[lookupIndex]!
    const subtables: SerializedGposSubtable[] = []
    for (let i = 0; i < lookup.subtables.length; i++) {
      const built = serializeGposSubtable(lookup.subtables[i]!, oldToNew)
      for (let j = 0; j < built.length; j++) subtables.push({ type: lookup.subtables[i]!.kind, data: built[j]! })
    }
    if (subtables.length === 0) subtables.push({ type: 1, data: serializeSinglePosEmpty() })
    serialized[lookupIndex] = subtables
  }
  const writer = new BinaryWriter()
  writer.writeUint16(lookups.length)
  const lookupOffsetPositions = reserveUint16(writer, lookups.length)
  const extensionRecords: Array<{ offsetPosition: number, extensionStart: number, data: Uint8Array }> = []
  for (let lookupIndex = 0; lookupIndex < lookups.length; lookupIndex++) {
    const lookupStart = writer.position
    assertOffset16(lookupStart, `GPOS Lookup ${lookupIndex}`)
    patchUint16(writer, lookupOffsetPositions[lookupIndex]!, lookupStart)
    const lookup = lookups[lookupIndex]!
    const subtables = serialized[lookupIndex]!
    writer.writeUint16(9)
    writer.writeUint16(lookup.flag)
    writer.writeUint16(subtables.length)
    const subtableOffsetPositions = reserveUint16(writer, subtables.length)
    if ((lookup.flag & 0x0010) !== 0) writer.writeUint16(lookup.markFilteringSet!)
    for (let i = 0; i < subtables.length; i++) {
      const extensionStart = writer.position
      patchUint16(writer, subtableOffsetPositions[i]!, extensionStart - lookupStart)
      writer.writeUint16(1)
      writer.writeUint16(subtables[i]!.type)
      const offsetPosition = writer.position
      writer.writeUint32(0)
      extensionRecords.push({ offsetPosition, extensionStart, data: subtables[i]!.data })
    }
  }
  for (let i = 0; i < extensionRecords.length; i++) {
    const record = extensionRecords[i]!
    patchUint32(writer, record.offsetPosition, writer.position - record.extensionStart)
    writer.writeBytes(record.data)
  }
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeGposSubtable(subtable: GposSubtableData, oldToNew: ReadonlyMap<number, number>): Uint8Array[] {
  switch (subtable.kind) {
    case 1: return [serializeSinglePos(subtable, oldToNew)]
    case 2: return [serializePairPos(subtable, oldToNew)]
    case 3: return [serializeCursivePos(subtable, oldToNew)]
    case 4: return [serializeMarkBasePos(subtable, oldToNew)]
    case 5: return [serializeMarkLigPos(subtable, oldToNew)]
    case 6: return [serializeMarkMarkPos(subtable, oldToNew)]
    case 7: return serializeContextPos(subtable, oldToNew)
    case 8: return serializeChainContextPos(subtable, oldToNew)
  }
}

function serializeSinglePosEmpty(): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(2); writer.writeUint16(8); writer.writeUint16(0); writer.writeUint16(0)
  writeCoverage(writer, [])
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeSinglePos(subtable: SinglePosData, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const remapped = remapCoverageEntries(subtable.coverageMap, oldToNew)
  // Some variable-font FeatureVariation branches encode an empty Format 2
  // ValueRecord array while retaining the branch's original Coverage. The
  // lookup has no positioning effect because there is no record at those
  // coverage indices. A static instance must therefore emit an empty coverage
  // rather than inventing an adjustment or indexing past the value array.
  const entries = subtable.format === 1
    ? remapped
    : remapped.filter(function (entry) { return entry.coverageIndex < subtable.values!.length })
  const values = new Array<ValueRecord>(entries.length)
  for (let i = 0; i < entries.length; i++) {
    values[i] = subtable.format === 1 ? subtable.singleValue! : subtable.values![entries[i]!.coverageIndex]!
  }
  let valueFormat = 0
  for (let i = 0; i < values.length; i++) valueFormat |= inferValueFormat(values[i]!)
  const writer = new BinaryWriter()
  writer.writeUint16(2)
  const coverageOffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(valueFormat)
  writer.writeUint16(values.length)
  const devices: DeferredDevice[] = []
  for (let i = 0; i < values.length; i++) writeValueRecord(writer, values[i]!, valueFormat, 0, devices)
  patchUint16(writer, coverageOffsetPosition, writer.position)
  writeCoverage(writer, entries.map(function (entry) { return entry.glyph }))
  writeDeferredDevices(writer, devices)
  return new Uint8Array(writer.toArrayBuffer())
}

function serializePairPos(subtable: PairPosData, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  if (subtable.classData !== undefined) return serializeClassPairPos(subtable.classData, oldToNew)
  const leftSet = new Set<number>()
  let valueFormat1 = 0, valueFormat2 = 0
  for (const [key, value] of subtable.pairs) {
    const left = oldToNew.get(key >>> 16)
    const right = oldToNew.get(key & 0xFFFF)
    if (left === undefined || right === undefined) continue
    leftSet.add(left)
    valueFormat1 |= inferValueFormat(value.v1)
    if (value.v2 !== null) valueFormat2 |= inferValueFormat(value.v2)
  }
  const leftGlyphs = [...leftSet].sort(function (left, right) { return left - right })
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const coverageOffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(valueFormat1); writer.writeUint16(valueFormat2)
  writer.writeUint16(leftGlyphs.length)
  const setOffsets = reserveUint16(writer, leftGlyphs.length)
  for (let i = 0; i < leftGlyphs.length; i++) {
    const setStart = writer.position
    patchUint16(writer, setOffsets[i]!, setStart)
    const originalPairs: Array<{ right: number, value: PairValueEntry }> = []
    for (const [key, value] of subtable.pairs) {
      if (oldToNew.get(key >>> 16) !== leftGlyphs[i]) continue
      const right = oldToNew.get(key & 0xFFFF)
      if (right !== undefined) originalPairs.push({ right, value })
    }
    originalPairs.sort(function (left, right) { return left.right - right.right })
    writer.writeUint16(originalPairs.length)
    const devices: DeferredDevice[] = []
    for (let j = 0; j < originalPairs.length; j++) {
      writer.writeUint16(originalPairs[j]!.right)
      writeValueRecord(writer, originalPairs[j]!.value.v1, valueFormat1, setStart, devices)
      if (valueFormat2 !== 0) writeValueRecord(writer, originalPairs[j]!.value.v2 ?? EMPTY_VALUE, valueFormat2, setStart, devices)
    }
    writeDeferredDevices(writer, devices)
  }
  patchUint16(writer, coverageOffsetPosition, writer.position)
  writeCoverage(writer, leftGlyphs)
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeClassPairPos(
  data: NonNullable<PairPosData['classData']>,
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  let valueFormat1 = 0, valueFormat2 = 0
  for (let class1 = 0; class1 < data.matrix.length; class1++) {
    for (let class2 = 0; class2 < data.matrix[class1]!.length; class2++) {
      const pair = data.matrix[class1]![class2]!
      valueFormat1 |= inferValueFormat(pair.v1)
      if (pair.v2 !== null) valueFormat2 |= inferValueFormat(pair.v2)
    }
  }
  const writer = new BinaryWriter()
  writer.writeUint16(2)
  const coverageOffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(valueFormat1); writer.writeUint16(valueFormat2)
  const classDef1OffsetPosition = writer.position; writer.writeUint16(0)
  const classDef2OffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(data.class1Count); writer.writeUint16(data.class2Count)
  const devices: DeferredDevice[] = []
  for (let class1 = 0; class1 < data.class1Count; class1++) {
    for (let class2 = 0; class2 < data.class2Count; class2++) {
      const pair = data.matrix[class1]![class2]!
      writeValueRecord(writer, pair.v1, valueFormat1, 0, devices)
      if (valueFormat2 !== 0) writeValueRecord(writer, pair.v2 ?? EMPTY_VALUE, valueFormat2, 0, devices)
    }
  }
  patchUint16(writer, coverageOffsetPosition, writer.position)
  writeCoverage(writer, remapCoverageEntries(data.coverageMap, oldToNew).map(function (entry) { return entry.glyph }))
  patchUint16(writer, classDef1OffsetPosition, writer.position)
  writeClassDef(writer, data.classDef1, oldToNew)
  patchUint16(writer, classDef2OffsetPosition, writer.position)
  writeClassDef(writer, data.classDef2, oldToNew)
  writeDeferredDevices(writer, devices)
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeCursivePos(subtable: CursivePosData, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const entries = remapCoverageEntries(subtable.coverageMap, oldToNew)
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const coverageOffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(entries.length)
  const entryOffsets = new Array<number>(entries.length)
  const exitOffsets = new Array<number>(entries.length)
  for (let i = 0; i < entries.length; i++) {
    entryOffsets[i] = writer.position; writer.writeUint16(0)
    exitOffsets[i] = writer.position; writer.writeUint16(0)
  }
  patchUint16(writer, coverageOffsetPosition, writer.position)
  writeCoverage(writer, entries.map(function (entry) { return entry.glyph }))
  for (let i = 0; i < entries.length; i++) {
    const sourceIndex = entries[i]!.coverageIndex
    const entry = subtable.entryAnchors[sourceIndex]
    const exit = subtable.exitAnchors[sourceIndex]
    if (entry != null) { patchUint16(writer, entryOffsets[i]!, writer.position); writeAnchor(writer, entry) }
    if (exit != null) { patchUint16(writer, exitOffsets[i]!, writer.position); writeAnchor(writer, exit) }
  }
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeMarkBasePos(subtable: MarkBasePosData, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const marks = remapCoverageEntries(subtable.markCoverage, oldToNew)
  const bases = remapCoverageEntries(subtable.baseCoverage, oldToNew)
  const markRecords = marks.map(function (entry) { return subtable.markArray[entry.coverageIndex]! })
  const baseRows = bases.map(function (entry) { return subtable.baseArray[entry.coverageIndex]! })
  const markClassCount = getMarkClassCount(markRecords, baseRows)
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const markCoverageOffset = writer.position; writer.writeUint16(0)
  const baseCoverageOffset = writer.position; writer.writeUint16(0)
  writer.writeUint16(markClassCount)
  const markArrayOffset = writer.position; writer.writeUint16(0)
  const baseArrayOffset = writer.position; writer.writeUint16(0)
  patchUint16(writer, markCoverageOffset, writer.position); writeCoverage(writer, marks.map(function (entry) { return entry.glyph }))
  patchUint16(writer, baseCoverageOffset, writer.position); writeCoverage(writer, bases.map(function (entry) { return entry.glyph }))
  patchUint16(writer, markArrayOffset, writer.position); writeMarkArray(writer, markRecords)
  patchUint16(writer, baseArrayOffset, writer.position); writeBaseArray(writer, baseRows, markClassCount)
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeMarkLigPos(subtable: MarkLigPosData, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const marks = remapCoverageEntries(subtable.markCoverage, oldToNew)
  const ligatures = remapCoverageEntries(subtable.ligatureCoverage, oldToNew)
  const markRecords = marks.map(function (entry) { return subtable.markArray[entry.coverageIndex]! })
  const ligatureRows = ligatures.map(function (entry) { return subtable.ligatureArray[entry.coverageIndex]! })
  const markClassCount = getLigatureMarkClassCount(markRecords, ligatureRows)
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const markCoverageOffset = writer.position; writer.writeUint16(0)
  const ligatureCoverageOffset = writer.position; writer.writeUint16(0)
  writer.writeUint16(markClassCount)
  const markArrayOffset = writer.position; writer.writeUint16(0)
  const ligatureArrayOffset = writer.position; writer.writeUint16(0)
  patchUint16(writer, markCoverageOffset, writer.position); writeCoverage(writer, marks.map(function (entry) { return entry.glyph }))
  patchUint16(writer, ligatureCoverageOffset, writer.position); writeCoverage(writer, ligatures.map(function (entry) { return entry.glyph }))
  patchUint16(writer, markArrayOffset, writer.position); writeMarkArray(writer, markRecords)
  patchUint16(writer, ligatureArrayOffset, writer.position); writeLigatureArray(writer, ligatureRows, markClassCount)
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeMarkMarkPos(subtable: MarkMarkPosData, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const mark1 = remapCoverageEntries(subtable.mark1Coverage, oldToNew)
  const mark2 = remapCoverageEntries(subtable.mark2Coverage, oldToNew)
  const markRecords = mark1.map(function (entry) { return subtable.mark1Array[entry.coverageIndex]! })
  const mark2Rows = mark2.map(function (entry) { return subtable.mark2Array[entry.coverageIndex]! })
  const markClassCount = getMarkClassCount(markRecords, mark2Rows)
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const mark1CoverageOffset = writer.position; writer.writeUint16(0)
  const mark2CoverageOffset = writer.position; writer.writeUint16(0)
  writer.writeUint16(markClassCount)
  const mark1ArrayOffset = writer.position; writer.writeUint16(0)
  const mark2ArrayOffset = writer.position; writer.writeUint16(0)
  patchUint16(writer, mark1CoverageOffset, writer.position); writeCoverage(writer, mark1.map(function (entry) { return entry.glyph }))
  patchUint16(writer, mark2CoverageOffset, writer.position); writeCoverage(writer, mark2.map(function (entry) { return entry.glyph }))
  patchUint16(writer, mark1ArrayOffset, writer.position); writeMarkArray(writer, markRecords)
  patchUint16(writer, mark2ArrayOffset, writer.position); writeBaseArray(writer, mark2Rows, markClassCount)
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeContextPos(subtable: ContextPosData, oldToNew: ReadonlyMap<number, number>): Uint8Array[] {
  const result: Uint8Array[] = []
  const rule = subtable.rules[0]!
  if (rule.format === 1) {
    for (const [first, rules] of rule.rulesByGlyph!) {
      const firstGlyph = oldToNew.get(first)
      if (firstGlyph === undefined) continue
      for (let i = 0; i < rules.length; i++) {
        const current = rules[i]!
        const coverages = remapExplicitSequence([[first], current.sequence], oldToNew)
        if (coverages !== null) result.push(writeContextPosFormat3(coverages, current.lookups))
      }
    }
  } else if (rule.format === 2) {
    for (const [firstClass, rules] of rule.rulesByClass!) {
      const firstCoverage = remapCoverageForClass(rule.coverageMap!, rule.classDef!, firstClass, oldToNew)
      if (firstCoverage.length === 0) continue
      for (let i = 0; i < rules.length; i++) {
        const input = remapClassSequence(rules[i]!.sequence, rule.classDef!, oldToNew)
        if (input !== null) result.push(writeContextPosFormat3([firstCoverage, ...input], rules[i]!.lookups))
      }
    }
  } else {
    const coverages = remapCoverages(rule.coverages!, oldToNew)
    if (allCoveragesNonempty(coverages)) result.push(writeContextPosFormat3(coverages, rule.lookups!))
  }
  return result
}

function writeContextPosFormat3(coverages: readonly number[][], lookups: readonly PosLookupRecord[]): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(3); writer.writeUint16(coverages.length); writer.writeUint16(lookups.length)
  const coverageOffsets = reserveUint16(writer, coverages.length)
  writePosLookupRecords(writer, lookups)
  writeCoverageArray(writer, coverages, coverageOffsets)
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeChainContextPos(subtable: ChainContextPosData, oldToNew: ReadonlyMap<number, number>): Uint8Array[] {
  const result: Uint8Array[] = []
  const rule = subtable.rules[0]!
  if (rule.format === 1) {
    for (const [first, rules] of rule.rulesByGlyph!) {
      const firstGlyph = oldToNew.get(first)
      if (firstGlyph === undefined) continue
      for (let i = 0; i < rules.length; i++) {
        const current = rules[i]!
        const backtrack = remapGlyphSequenceAsCoverages(current.backtrack, oldToNew)
        const input = remapGlyphSequenceAsCoverages(current.input, oldToNew)
        const lookahead = remapGlyphSequenceAsCoverages(current.lookahead, oldToNew)
        if (backtrack !== null && input !== null && lookahead !== null) {
          result.push(writeChainContextPosFormat3(backtrack, [[firstGlyph], ...input], lookahead, current.lookups))
        }
      }
    }
  } else if (rule.format === 2) {
    for (const [firstClass, rules] of rule.rulesByClass!) {
      const firstCoverage = remapCoverageForClass(rule.coverageMap!, rule.inputClassDef!, firstClass, oldToNew)
      if (firstCoverage.length === 0) continue
      for (let i = 0; i < rules.length; i++) {
        const current = rules[i]!
        const backtrack = remapClassSequence(current.backtrack, rule.backtrackClassDef!, oldToNew)
        const input = remapClassSequence(current.input, rule.inputClassDef!, oldToNew)
        const lookahead = remapClassSequence(current.lookahead, rule.lookaheadClassDef!, oldToNew)
        if (backtrack !== null && input !== null && lookahead !== null) {
          result.push(writeChainContextPosFormat3(backtrack, [firstCoverage, ...input], lookahead, current.lookups))
        }
      }
    }
  } else {
    const backtrack = remapCoverages(rule.backtrackCoverages!, oldToNew)
    const input = remapCoverages(rule.inputCoverages!, oldToNew)
    const lookahead = remapCoverages(rule.lookaheadCoverages!, oldToNew)
    if (allCoveragesNonempty(backtrack) && allCoveragesNonempty(input) && allCoveragesNonempty(lookahead)) {
      result.push(writeChainContextPosFormat3(backtrack, input, lookahead, rule.lookups!))
    }
  }
  return result
}

function writeChainContextPosFormat3(
  backtrack: readonly number[][],
  input: readonly number[][],
  lookahead: readonly number[][],
  lookups: readonly PosLookupRecord[],
): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(3)
  writer.writeUint16(backtrack.length); const backtrackOffsets = reserveUint16(writer, backtrack.length)
  writer.writeUint16(input.length); const inputOffsets = reserveUint16(writer, input.length)
  writer.writeUint16(lookahead.length); const lookaheadOffsets = reserveUint16(writer, lookahead.length)
  writer.writeUint16(lookups.length); writePosLookupRecords(writer, lookups)
  writeCoverageArray(writer, backtrack, backtrackOffsets)
  writeCoverageArray(writer, input, inputOffsets)
  writeCoverageArray(writer, lookahead, lookaheadOffsets)
  return new Uint8Array(writer.toArrayBuffer())
}

interface RemappedCoverageEntry { glyph: number, coverageIndex: number }
interface DeferredDevice { offsetPosition: number, base: number, device: ParsedDevice }

function remapCoverageEntries(
  coverage: ReadonlyMap<number, number>,
  oldToNew: ReadonlyMap<number, number>,
): RemappedCoverageEntry[] {
  const result: RemappedCoverageEntry[] = []
  for (const [oldGlyph, coverageIndex] of coverage) {
    const glyph = oldToNew.get(oldGlyph)
    if (glyph !== undefined) result.push({ glyph, coverageIndex })
  }
  result.sort(function (left, right) { return left.glyph - right.glyph })
  return result
}

function inferValueFormat(value: ValueRecord): number {
  let format = 0
  if (value.xPlacement !== 0) format |= 0x0001
  if (value.yPlacement !== 0) format |= 0x0002
  if (value.xAdvance !== 0) format |= 0x0004
  if (value.yAdvance !== 0) format |= 0x0008
  if (value.xPlaDevice != null) format |= 0x0010
  if (value.yPlaDevice != null) format |= 0x0020
  if (value.xAdvDevice != null) format |= 0x0040
  if (value.yAdvDevice != null) format |= 0x0080
  return format
}

function writeValueRecord(
  writer: BinaryWriter,
  value: ValueRecord,
  format: number,
  base: number,
  devices: DeferredDevice[],
): void {
  if (format & 0x0001) writer.writeInt16(value.xPlacement)
  if (format & 0x0002) writer.writeInt16(value.yPlacement)
  if (format & 0x0004) writer.writeInt16(value.xAdvance)
  if (format & 0x0008) writer.writeInt16(value.yAdvance)
  reserveDevice(writer, base, value.xPlaDevice, format & 0x0010, devices)
  reserveDevice(writer, base, value.yPlaDevice, format & 0x0020, devices)
  reserveDevice(writer, base, value.xAdvDevice, format & 0x0040, devices)
  reserveDevice(writer, base, value.yAdvDevice, format & 0x0080, devices)
}

function reserveDevice(
  writer: BinaryWriter,
  base: number,
  device: ParsedDevice | null | undefined,
  present: number,
  devices: DeferredDevice[],
): void {
  if (present === 0) return
  const offsetPosition = writer.position
  writer.writeUint16(0)
  if (device != null) devices.push({ offsetPosition, base, device })
}

function writeDeferredDevices(writer: BinaryWriter, devices: readonly DeferredDevice[]): void {
  for (let i = 0; i < devices.length; i++) {
    const item = devices[i]!
    patchUint16(writer, item.offsetPosition, writer.position - item.base)
    writeDevice(writer, item.device)
  }
}

function writeDevice(writer: BinaryWriter, device: ParsedDevice): void {
  writer.writeUint16(device.first); writer.writeUint16(device.second); writer.writeUint16(device.deltaFormat)
  if (device.words !== null) for (let i = 0; i < device.words.length; i++) writer.writeUint16(device.words[i]!)
}

function writeAnchor(writer: BinaryWriter, anchor: Anchor): void {
  const start = writer.position
  const hasDevices = anchor.xDevice != null || anchor.yDevice != null
  writer.writeUint16(hasDevices ? 3 : anchor.pointIndex === undefined ? 1 : 2)
  writer.writeInt16(anchor.x); writer.writeInt16(anchor.y)
  if (!hasDevices && anchor.pointIndex !== undefined) {
    writer.writeUint16(anchor.pointIndex)
    return
  }
  if (!hasDevices) return
  const xOffset = writer.position; writer.writeUint16(0)
  const yOffset = writer.position; writer.writeUint16(0)
  if (anchor.xDevice != null) { patchUint16(writer, xOffset, writer.position - start); writeDevice(writer, anchor.xDevice) }
  if (anchor.yDevice != null) { patchUint16(writer, yOffset, writer.position - start); writeDevice(writer, anchor.yDevice) }
}

function getMarkClassCount(records: readonly MarkRecord[], rows: readonly (Anchor | null)[][]): number {
  let count = rows.length === 0 ? 0 : rows[0]!.length
  for (let i = 0; i < records.length; i++) if (records[i]!.markClass >= count) count = records[i]!.markClass + 1
  return count
}

function getLigatureMarkClassCount(records: readonly MarkRecord[], rows: readonly (Anchor | null)[][][]): number {
  let count = rows.length === 0 || rows[0]!.length === 0 ? 0 : rows[0]![0]!.length
  for (let i = 0; i < records.length; i++) if (records[i]!.markClass >= count) count = records[i]!.markClass + 1
  return count
}

function writeMarkArray(writer: BinaryWriter, records: readonly MarkRecord[]): void {
  const start = writer.position
  writer.writeUint16(records.length)
  const anchorOffsets = new Array<number>(records.length)
  for (let i = 0; i < records.length; i++) {
    writer.writeUint16(records[i]!.markClass)
    anchorOffsets[i] = writer.position; writer.writeUint16(0)
  }
  for (let i = 0; i < records.length; i++) {
    patchUint16(writer, anchorOffsets[i]!, writer.position - start)
    writeAnchor(writer, records[i]!.anchor)
  }
}

function writeBaseArray(writer: BinaryWriter, rows: readonly (Anchor | null)[][], classCount: number): void {
  const start = writer.position
  writer.writeUint16(rows.length)
  const offsets: Array<{ position: number, anchor: Anchor }> = []
  for (let row = 0; row < rows.length; row++) {
    for (let markClass = 0; markClass < classCount; markClass++) {
      const anchor = rows[row]![markClass] ?? null
      const position = writer.position; writer.writeUint16(0)
      if (anchor !== null) offsets.push({ position, anchor })
    }
  }
  for (let i = 0; i < offsets.length; i++) {
    patchUint16(writer, offsets[i]!.position, writer.position - start)
    writeAnchor(writer, offsets[i]!.anchor)
  }
}

function writeLigatureArray(writer: BinaryWriter, rows: readonly (Anchor | null)[][][], classCount: number): void {
  const start = writer.position
  writer.writeUint16(rows.length)
  const ligatureOffsets = reserveUint16(writer, rows.length)
  for (let ligature = 0; ligature < rows.length; ligature++) {
    const ligatureStart = writer.position
    patchUint16(writer, ligatureOffsets[ligature]!, ligatureStart - start)
    writer.writeUint16(rows[ligature]!.length)
    const anchors: Array<{ position: number, anchor: Anchor }> = []
    for (let component = 0; component < rows[ligature]!.length; component++) {
      for (let markClass = 0; markClass < classCount; markClass++) {
        const anchor = rows[ligature]![component]![markClass] ?? null
        const position = writer.position; writer.writeUint16(0)
        if (anchor !== null) anchors.push({ position, anchor })
      }
    }
    for (let i = 0; i < anchors.length; i++) {
      patchUint16(writer, anchors[i]!.position, writer.position - ligatureStart)
      writeAnchor(writer, anchors[i]!.anchor)
    }
  }
}

function remapExplicitSequence(
  sequences: readonly (readonly number[])[],
  oldToNew: ReadonlyMap<number, number>,
): number[][] | null {
  const flattened: number[][] = []
  for (let sequenceIndex = 0; sequenceIndex < sequences.length; sequenceIndex++) {
    const sequence = sequences[sequenceIndex]!
    for (let i = 0; i < sequence.length; i++) {
      const glyph = oldToNew.get(sequence[i]!)
      if (glyph === undefined) return null
      flattened.push([glyph])
    }
  }
  return flattened
}

function remapGlyphSequenceAsCoverages(
  glyphs: readonly number[],
  oldToNew: ReadonlyMap<number, number>,
): number[][] | null {
  return remapExplicitSequence([glyphs], oldToNew)
}

function remapClassSequence(
  classes: readonly number[],
  classDef: ReadonlyMap<number, number>,
  oldToNew: ReadonlyMap<number, number>,
): number[][] | null {
  const result: number[][] = []
  for (let i = 0; i < classes.length; i++) {
    const coverage = remapClass(classDef, classes[i]!, oldToNew)
    if (coverage.length === 0) return null
    result.push(coverage)
  }
  return result
}

function remapClass(
  classDef: ReadonlyMap<number, number>,
  classId: number,
  oldToNew: ReadonlyMap<number, number>,
): number[] {
  const result: number[] = []
  for (const [oldGlyph, newGlyph] of oldToNew) {
    if ((classDef.get(oldGlyph) ?? 0) === classId) result.push(newGlyph)
  }
  result.sort(function (left, right) { return left - right })
  return result
}

function remapCoverageForClass(
  coverage: ReadonlyMap<number, number>,
  classDef: ReadonlyMap<number, number>,
  classId: number,
  oldToNew: ReadonlyMap<number, number>,
): number[] {
  const result: number[] = []
  for (const oldGlyph of coverage.keys()) {
    if ((classDef.get(oldGlyph) ?? 0) !== classId) continue
    const newGlyph = oldToNew.get(oldGlyph)
    if (newGlyph !== undefined) result.push(newGlyph)
  }
  result.sort(function (left, right) { return left - right })
  return result
}

function remapCoverages(
  coverages: readonly ReadonlyMap<number, number>[],
  oldToNew: ReadonlyMap<number, number>,
): number[][] {
  const result = new Array<number[]>(coverages.length)
  for (let i = 0; i < coverages.length; i++) {
    result[i] = remapCoverageEntries(coverages[i]!, oldToNew).map(function (entry) { return entry.glyph })
  }
  return result
}

function allCoveragesNonempty(coverages: readonly number[][]): boolean {
  for (let i = 0; i < coverages.length; i++) if (coverages[i]!.length === 0) return false
  return true
}

function writePosLookupRecords(writer: BinaryWriter, records: readonly PosLookupRecord[]): void {
  for (let i = 0; i < records.length; i++) {
    writer.writeUint16(records[i]!.sequenceIndex)
    writer.writeUint16(records[i]!.lookupListIndex)
  }
}

function reserveUint16(writer: BinaryWriter, count: number): number[] {
  const positions = new Array<number>(count)
  for (let i = 0; i < count; i++) { positions[i] = writer.position; writer.writeUint16(0) }
  return positions
}

function writeCoverageArray(writer: BinaryWriter, coverages: readonly number[][], positions: readonly number[]): void {
  for (let i = 0; i < coverages.length; i++) {
    patchUint16(writer, positions[i]!, writer.position)
    writeCoverage(writer, coverages[i]!)
  }
}

function writeCoverage(writer: BinaryWriter, glyphs: readonly number[]): void {
  writer.writeUint16(1); writer.writeUint16(glyphs.length)
  for (let i = 0; i < glyphs.length; i++) writer.writeUint16(glyphs[i]!)
}

function writeClassDef(
  writer: BinaryWriter,
  classDef: ReadonlyMap<number, number>,
  oldToNew: ReadonlyMap<number, number>,
): void {
  const entries: Array<{ glyph: number, classId: number }> = []
  for (const [oldGlyph, classId] of classDef) {
    const glyph = oldToNew.get(oldGlyph)
    if (glyph !== undefined && classId !== 0) entries.push({ glyph, classId })
  }
  entries.sort(function (left, right) { return left.glyph - right.glyph })
  writer.writeUint16(2)
  const ranges: Array<{ start: number, end: number, classId: number }> = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const previous = ranges[ranges.length - 1]
    if (previous !== undefined && previous.end + 1 === entry.glyph && previous.classId === entry.classId) previous.end = entry.glyph
    else ranges.push({ start: entry.glyph, end: entry.glyph, classId: entry.classId })
  }
  writer.writeUint16(ranges.length)
  for (let i = 0; i < ranges.length; i++) {
    writer.writeUint16(ranges[i]!.start); writer.writeUint16(ranges[i]!.end); writer.writeUint16(ranges[i]!.classId)
  }
}

function assertOffset16(value: number, label: string): void {
  if (value < 0 || value > 0xFFFF) throw new Error(`${label} offset ${value} exceeds Offset16`)
}

function patchUint16(writer: BinaryWriter, offset: number, value: number): void {
  assertOffset16(value, 'OpenType')
  const end = writer.position; writer.position = offset; writer.writeUint16(value); writer.position = end
}

function patchUint32(writer: BinaryWriter, offset: number, value: number): void {
  const end = writer.position; writer.position = offset; writer.writeUint32(value); writer.position = end
}

function readAnchor(reader: BinaryReader, offset: number): Anchor {
  const saved = reader.position
  reader.seek(offset)
  const format = reader.readUint16()
  if (format < 1 || format > 3) {
    throw new Error(`Unsupported Anchor format: ${format}`)
  }
  const x = reader.readInt16()
  const y = reader.readInt16()

  if (format === 2) {
    const pointIndex = reader.readUint16()
    reader.seek(saved)
    return { x, y, pointIndex }
  }
  if (format === 3) {
    const xDevOff = reader.readUint16()
    const yDevOff = reader.readUint16()
    const xDevice = xDevOff !== 0 ? parseDeviceTable(reader, offset + xDevOff) : null
    const yDevice = yDevOff !== 0 ? parseDeviceTable(reader, offset + yDevOff) : null
    reader.seek(saved)
    return { x, y, xDevice, yDevice }
  }

  reader.seek(saved)
  return { x, y }
}

function parseMarkArray(reader: BinaryReader, offset: number): MarkRecord[] {
  reader.seek(offset)
  const markCount = reader.readUint16()
  const records: { markClass: number, anchorOffset: number }[] = []
  for (let i = 0; i < markCount; i++) {
    records.push({
      markClass: reader.readUint16(),
      anchorOffset: reader.readUint16(),
    })
  }

  return records.map(rec => ({
    markClass: rec.markClass,
    anchor: rec.anchorOffset ? readAnchor(reader, offset + rec.anchorOffset) : { x: 0, y: 0 },
  }))
}

function parseBaseArray(reader: BinaryReader, offset: number, markClassCount: number): (Anchor | null)[][] {
  reader.seek(offset)
  const baseCount = reader.readUint16()
  const anchorOffsets: number[] = []
  for (let i = 0; i < baseCount * markClassCount; i++) {
    anchorOffsets.push(reader.readUint16())
  }

  const baseArray: (Anchor | null)[][] = []
  let idx = 0
  for (let b = 0; b < baseCount; b++) {
    const row: (Anchor | null)[] = []
    for (let m = 0; m < markClassCount; m++) {
      const off = anchorOffsets[idx++]!
      row.push(off ? readAnchor(reader, offset + off) : null)
    }
    baseArray.push(row)
  }

  return baseArray
}

// --- Lookup application ---

/** Shared positioning state threaded through the lookup application. */
interface GposContext {
  glyphIds: number[]
  adjustments: PositionAdjustment[]
  allLookups: ParsedGposLookup[]
  ligatureComponents: Map<number, number> | null
  ligatureMarkComponents: Map<number, number> | null
  gdef: GdefTable | null
  direction: GposDirection
  advanceWidths: number[] | null
  /** Whether the active shaper zeroes complete GDEF-mark advances after GPOS. */
  zeroMarkAdvancesAfterPositioning: boolean
  /** Normalized variation coordinates (VariationIndex device resolution) */
  coords: number[] | null
  /** Pixels per em for ppem-based Device tables (undefined = design units) */
  ppem: number | undefined
  /** Mark attachment target per glyph (-1 = not attached) */
  attachTargets: Int32Array
  /** Non-zero where the OpenType feature driving the active lookup applies. */
  activeValues: Uint32Array | null
  anchorPointResolver: GposAnchorPointResolver | null
}

/** Resolve the delta of a Device / VariationIndex table in this context. */
function deviceDelta(dev: ParsedDevice | null | undefined, ctx: GposContext): number {
  if (dev === null || dev === undefined) return 0
  if (dev.isVariation) {
    if (ctx.gdef === null || ctx.coords === null) return 0
    return Math.round(ctx.gdef.getVarDelta(dev.first, dev.second, ctx.coords))
  }
  return resolveDeviceDelta(dev, ctx.ppem)
}

/** Anchor x with device / variation adjustment. */
function anchorX(anchor: Anchor, ctx: GposContext, glyphIndex: number): number {
  return anchorPointCoordinate(anchor, ctx, glyphIndex, true)
}

/** Anchor y with device / variation adjustment. */
function anchorY(anchor: Anchor, ctx: GposContext, glyphIndex: number): number {
  return anchorPointCoordinate(anchor, ctx, glyphIndex, false)
}

function anchorPointCoordinate(anchor: Anchor, ctx: GposContext, glyphIndex: number, horizontal: boolean): number {
  if (anchor.pointIndex !== undefined && ctx.ppem !== undefined && ctx.anchorPointResolver !== null) {
    const point = ctx.anchorPointResolver.getGposAnchorPoint(
      ctx.glyphIds[glyphIndex]!, anchor.pointIndex, ctx.ppem,
    )
    if (point !== null) return horizontal ? point.x : point.y
  }
  return (horizontal ? anchor.x : anchor.y) + deviceDelta(horizontal ? anchor.xDevice : anchor.yDevice, ctx)
}

/** Whether the lookup skips index i during matching. */
function gposSkips(lookup: ParsedGposLookup, ctx: GposContext, i: number): boolean {
  if (ctx.activeValues !== null && ctx.activeValues[i] === 0) return true
  return lookupIgnoresGlyph(lookup.flag, lookup.markFilteringSet, ctx.gdef, ctx.glyphIds[i]!)
}

/** Next index after `from` the lookup does not skip, or glyphIds.length. */
function gposNext(lookup: ParsedGposLookup, ctx: GposContext, from: number): number {
  let i = from + 1
  while (i < ctx.glyphIds.length && gposSkips(lookup, ctx, i)) i++
  return i
}

/** Previous index before `from` the lookup does not skip, or -1. */
function gposPrev(lookup: ParsedGposLookup, ctx: GposContext, from: number): number {
  let i = from - 1
  while (i >= 0 && gposSkips(lookup, ctx, i)) i--
  return i
}

function applyValueRecord(val: ValueRecord, adj: PositionAdjustment, ctx: GposContext): void {
  adj.xPlacement += val.xPlacement + deviceDelta(val.xPlaDevice, ctx)
  adj.yPlacement += val.yPlacement + deviceDelta(val.yPlaDevice, ctx)
  adj.xAdvance += val.xAdvance + deviceDelta(val.xAdvDevice, ctx)
  adj.yAdvance += val.yAdvance + deviceDelta(val.yAdvDevice, ctx)
}

function applyLookup(
  lookup: ParsedGposLookup,
  ctx: GposContext,
  onlyAt: number | undefined,
  depth: number,
): void {
  if (depth > MAX_NESTING_DEPTH) return
  switch (lookup.type) {
    case 1: applySinglePos(lookup, ctx, onlyAt); break
    case 2: applyPairPos(lookup, ctx, onlyAt); break
    case 3: applyCursivePos(lookup, ctx, onlyAt); break
    case 4: applyMarkBasePos(lookup, ctx, onlyAt); break
    case 5: applyMarkLigPos(lookup, ctx, onlyAt); break
    case 6: applyMarkMarkPos(lookup, ctx, onlyAt); break
    case 7: applyContextPos(lookup, ctx, onlyAt, depth); break
    case 8: applyChainContextPos(lookup, ctx, onlyAt, depth); break
  }
}

function applySinglePos(lookup: ParsedGposLookup, ctx: GposContext, onlyAt?: number): void {
  const glyphIds = ctx.glyphIds
  const start = onlyAt ?? 0
  const end = onlyAt !== undefined ? onlyAt + 1 : glyphIds.length
  for (let i = start; i < end; i++) {
    if (gposSkips(lookup, ctx, i)) continue
    for (const st of lookup.subtables as SinglePosData[]) {
      const covIdx = st.coverageMap.get(glyphIds[i]!)
      if (covIdx === undefined) continue

      const val = st.format === 1 ? st.singleValue! : st.values?.[covIdx]
      if (val) applyValueRecord(val, ctx.adjustments[i]!, ctx)
      break
    }
  }
}

/**
 * Look up the pair value for (left, right) in a PairPos subtable.
 * @returns entry or null
 */
function findPairEntry(st: PairPosData, left: number, right: number): PairValueEntry | null {
  const entry = st.pairs.get((left << 16) | right)
  if (entry !== undefined) return entry
  if (st.classData) {
    if (!st.classData.coverageMap.has(left)) return null
    const c1 = st.classData.classDef1.get(left) ?? 0
    const c2 = st.classData.classDef2.get(right) ?? 0
    if (c1 >= st.classData.class1Count || c2 >= st.classData.class2Count) return null
    return st.classData.matrix[c1]![c2]!
  }
  return null
}

function applyPairPos(lookup: ParsedGposLookup, ctx: GposContext, onlyAt?: number): void {
  const glyphIds = ctx.glyphIds
  let i = onlyAt ?? 0
  if (onlyAt === undefined) {
    while (i < glyphIds.length && gposSkips(lookup, ctx, i)) i++
  }
  const end = onlyAt !== undefined ? onlyAt + 1 : glyphIds.length
  while (i < end) {
    if (gposSkips(lookup, ctx, i)) { i++; continue }
    const j = gposNext(lookup, ctx, i)
    if (j >= glyphIds.length) break
    let consumedSecond = false
    for (const st of lookup.subtables as PairPosData[]) {
      const entry = findPairEntry(st, glyphIds[i]!, glyphIds[j]!)
      if (entry === null) continue
      applyValueRecord(entry.v1, ctx.adjustments[i]!, ctx)
      if (entry.v2 !== null) {
        applyValueRecord(entry.v2, ctx.adjustments[j]!, ctx)
        consumedSecond = st.hasValue2
      }
      break
    }
    // When value2 was applied the second glyph is consumed; otherwise it may
    // start the next pair.
    i = consumedSecond ? gposNext(lookup, ctx, j) : j
    if (onlyAt !== undefined) break
  }
}

function applyCursivePos(lookup: ParsedGposLookup, ctx: GposContext, onlyAt?: number): void {
  const glyphIds = ctx.glyphIds
  const adj = ctx.adjustments
  const rtl = ctx.direction === 'rtl'
  const vertical = ctx.direction === 'ttb'
  const start = onlyAt ?? 0
  const end = onlyAt !== undefined ? onlyAt + 1 : glyphIds.length
  for (let i = start; i < end; i++) {
    if (gposSkips(lookup, ctx, i)) continue
    const j = gposNext(lookup, ctx, i)
    if (j >= glyphIds.length) continue
    for (const st of lookup.subtables as CursivePosData[]) {
      const exitIdx = st.coverageMap.get(glyphIds[i]!)
      const entryIdx = st.coverageMap.get(glyphIds[j]!)
      if (exitIdx === undefined || entryIdx === undefined) continue

      const exitAnchor = st.exitAnchors[exitIdx]
      const entryAnchor = st.entryAnchors[entryIdx]
      if (!exitAnchor || !entryAnchor) continue

      const exitX = anchorX(exitAnchor, ctx, i)
      const exitY = anchorY(exitAnchor, ctx, i)
      const entryX = anchorX(entryAnchor, ctx, j)
      const entryY = anchorY(entryAnchor, ctx, j)

      if (vertical) {
        // Vertical flow: align along the y axis
        if (ctx.advanceWidths !== null) {
          adj[i]!.yAdvance += (exitY + adj[i]!.yPlacement) - (ctx.advanceWidths[i]! + adj[i]!.yAdvance)
        }
        const d = entryY + adj[j]!.yPlacement
        adj[j]!.yAdvance -= d
        adj[j]!.yPlacement -= d
      } else if (rtl) {
        // RTL (logical order): the second glyph flows leftward from the first
        const d = exitX + adj[i]!.xPlacement
        adj[i]!.xAdvance -= d
        adj[i]!.xPlacement -= d
        if (ctx.advanceWidths !== null) {
          adj[j]!.xAdvance += (entryX + adj[j]!.xPlacement) - (ctx.advanceWidths[j]! + adj[j]!.xAdvance)
        }
      } else {
        // LTR: the first glyph's advance ends at its exit anchor and the
        // second glyph shifts so its entry anchor meets that point
        if (ctx.advanceWidths !== null) {
          adj[i]!.xAdvance += (exitX + adj[i]!.xPlacement) - (ctx.advanceWidths[i]! + adj[i]!.xAdvance)
        }
        const d = entryX + adj[j]!.xPlacement
        adj[j]!.xAdvance -= d
        adj[j]!.xPlacement -= d
      }

      // Cross-stream alignment: the RIGHT_TO_LEFT flag selects which glyph is
      // the child that inherits the offset from the connection
      if (vertical) {
        if (lookup.flag & LookupFlag.RightToLeft) {
          adj[i]!.xPlacement += entryX - exitX
        } else {
          adj[j]!.xPlacement += exitX - entryX
        }
      } else {
        if (lookup.flag & LookupFlag.RightToLeft) {
          adj[i]!.yPlacement += entryY - exitY
        } else {
          adj[j]!.yPlacement += exitY - entryY
        }
      }
      break
    }
  }
}

/**
 * Record an exclusive mark attachment: the mark's placement is SET to the
 * anchor difference (a later mark lookup overwrites an earlier one, matching
 * the reference attachment model) and the target index is remembered so
 * resolveAttachments() can chain offsets through the attachment tree.
 */
function setMarkAttachment(ctx: GposContext, mark: number, target: number, dx: number, dy: number): void {
  ctx.adjustments[mark]!.xPlacement = dx
  ctx.adjustments[mark]!.yPlacement = dy
  ctx.attachTargets[mark] = target
}

/**
 * Resolve the mark attachment tree after all lookups have run: each attached
 * glyph inherits its target's final placement, and in horizontal LTR flow the
 * pen advances from the target through the glyph before the mark are
 * subtracted (the mark is drawn after those advances). In the RTL
 * logical-order rendering model the mark shares its target's pen origin after
 * visual reversal, so only the advances of the glyphs between them apply
 * (marks carry zero advance, so this is usually nothing). Targets always
 * precede their marks, so one ascending pass resolves chains.
 */
function resolveAttachments(ctx: GposContext): void {
  const targets = ctx.attachTargets
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!
    if (t < 0) continue
    const adjI = ctx.adjustments[i]!
    const adjT = ctx.adjustments[t]!
    adjI.xPlacement += adjT.xPlacement
    adjI.yPlacement += adjT.yPlacement
    if (ctx.advanceWidths !== null) {
      if (ctx.direction === 'ltr') {
        let sum = 0
        for (let k = t; k < i; k++) {
          if (!isLateZeroedMark(ctx, k)) sum += ctx.advanceWidths[k]! + ctx.adjustments[k]!.xAdvance
        }
        adjI.xPlacement -= sum
      } else if (ctx.direction === 'rtl') {
        let sum = 0
        for (let k = t + 1; k <= i; k++) {
          if (!isLateZeroedMark(ctx, k)) sum += ctx.advanceWidths[k]! + ctx.adjustments[k]!.xAdvance
        }
        adjI.xPlacement += sum
      } else {
        let sum = 0
        for (let k = t; k < i; k++) {
          if (!isLateZeroedMark(ctx, k)) sum += ctx.advanceWidths[k]! + ctx.adjustments[k]!.yAdvance
        }
        adjI.yPlacement -= sum
      }
    }
  }
}

function isLateZeroedMark(ctx: GposContext, index: number): boolean {
  return ctx.zeroMarkAdvancesAfterPositioning
    && ctx.gdef !== null
    && ctx.gdef.getGlyphClass(ctx.glyphIds[index]!) === 3
}

/**
 * Scan backward from mark index i for the attachment target (base/ligature/
 * second mark). Glyphs skipped by the lookup flags are passed over; when GDEF
 * classifies glyphs, marks are passed over as well (unless `stopAtMark`),
 * mirroring the standard mark-attachment processing model.
 */
function findAttachmentTarget(
  lookup: ParsedGposLookup,
  ctx: GposContext,
  i: number,
  markCoverage: Map<number, number>,
  stopAtMark: boolean,
): number {
  let b = i - 1
  while (b >= 0) {
    if (gposSkips(lookup, ctx, b)) { b--; continue }
    if (!stopAtMark) {
      // Pass over marks: GDEF class 3 when available, otherwise glyphs in the
      // subtable's own mark coverage
      if (ctx.gdef !== null) {
        if (ctx.gdef.getGlyphClass(ctx.glyphIds[b]!) === 3) { b--; continue }
      } else if (markCoverage.has(ctx.glyphIds[b]!)) {
        b--
        continue
      }
    }
    return b
  }
  return -1
}

function applyMarkBasePos(lookup: ParsedGposLookup, ctx: GposContext, onlyAt?: number): void {
  const glyphIds = ctx.glyphIds
  const start = onlyAt !== undefined ? Math.max(1, onlyAt) : 1
  const end = onlyAt !== undefined ? onlyAt + 1 : glyphIds.length
  for (let i = start; i < end; i++) {
    if (gposSkips(lookup, ctx, i)) continue
    for (const st of lookup.subtables as MarkBasePosData[]) {
      const markIdx = st.markCoverage.get(glyphIds[i]!)
      if (markIdx === undefined) continue

      const baseGlyphIdx = findAttachmentTarget(lookup, ctx, i, st.markCoverage, false)
      if (baseGlyphIdx < 0) continue

      const baseCovIdx = st.baseCoverage.get(glyphIds[baseGlyphIdx]!)
      if (baseCovIdx === undefined) continue
      const markRecord = st.markArray[markIdx]
      if (!markRecord) continue

      const baseAnchors = st.baseArray[baseCovIdx]
      if (!baseAnchors) continue
      const baseAnchor = baseAnchors[markRecord.markClass]
      if (!baseAnchor) continue

      setMarkAttachment(
        ctx, i, baseGlyphIdx,
        anchorX(baseAnchor, ctx, baseGlyphIdx) - anchorX(markRecord.anchor, ctx, i),
        anchorY(baseAnchor, ctx, baseGlyphIdx) - anchorY(markRecord.anchor, ctx, i),
      )
      break
    }
  }
}

function applyMarkLigPos(lookup: ParsedGposLookup, ctx: GposContext, onlyAt?: number): void {
  const glyphIds = ctx.glyphIds
  const start = onlyAt !== undefined ? Math.max(1, onlyAt) : 1
  const end = onlyAt !== undefined ? onlyAt + 1 : glyphIds.length
  for (let i = start; i < end; i++) {
    if (gposSkips(lookup, ctx, i)) continue
    for (const st of lookup.subtables as MarkLigPosData[]) {
      const markIdx = st.markCoverage.get(glyphIds[i]!)
      if (markIdx === undefined) continue

      const ligGlyphIdx = findAttachmentTarget(lookup, ctx, i, st.markCoverage, false)
      if (ligGlyphIdx < 0) continue

      const ligCovIdx = st.ligatureCoverage.get(glyphIds[ligGlyphIdx]!)
      if (ligCovIdx === undefined) continue
      const markRecord = st.markArray[markIdx]
      if (!markRecord) continue

      const ligAttach = st.ligatureArray[ligCovIdx]
      if (!ligAttach || ligAttach.length === 0) continue

      let componentIndex = ctx.ligatureMarkComponents?.get(i) ?? -1
      if (componentIndex < 0 && ctx.ligatureComponents) {
        const numComponents = ctx.ligatureComponents.get(ligGlyphIdx) ?? 1
        let marksBefore = 0
        for (let b = ligGlyphIdx + 1; b < i; b++) {
          if (st.markCoverage.has(glyphIds[b]!)) marksBefore++
        }
        componentIndex = Math.min(marksBefore, numComponents - 1)
      }
      if (componentIndex < 0) componentIndex = 0
      if (componentIndex >= ligAttach.length) componentIndex = ligAttach.length - 1

      const componentAnchors = ligAttach[componentIndex]!
      const anchor = componentAnchors[markRecord.markClass]
      if (!anchor) continue

      setMarkAttachment(
        ctx, i, ligGlyphIdx,
        anchorX(anchor, ctx, ligGlyphIdx) - anchorX(markRecord.anchor, ctx, i),
        anchorY(anchor, ctx, ligGlyphIdx) - anchorY(markRecord.anchor, ctx, i),
      )
      break
    }
  }
}

function applyMarkMarkPos(lookup: ParsedGposLookup, ctx: GposContext, onlyAt?: number): void {
  const glyphIds = ctx.glyphIds
  const start = onlyAt !== undefined ? Math.max(1, onlyAt) : 1
  const end = onlyAt !== undefined ? onlyAt + 1 : glyphIds.length
  for (let i = start; i < end; i++) {
    if (gposSkips(lookup, ctx, i)) continue
    for (const st of lookup.subtables as MarkMarkPosData[]) {
      const mark1Idx = st.mark1Coverage.get(glyphIds[i]!)
      if (mark1Idx === undefined) continue

      // The second mark is the closest preceding glyph the lookup does not
      // skip (MarkAttachmentType / markFilteringSet select relevant marks)
      const prev = gposPrev(lookup, ctx, i)
      if (prev < 0) continue
      const mark2Idx = st.mark2Coverage.get(glyphIds[prev]!)
      if (mark2Idx === undefined) continue

      const mark1Record = st.mark1Array[mark1Idx]
      if (!mark1Record) continue

      const mark2Anchors = st.mark2Array[mark2Idx]
      if (!mark2Anchors) continue
      const mark2Anchor = mark2Anchors[mark1Record.markClass]
      if (!mark2Anchor) continue

      setMarkAttachment(
        ctx, i, prev,
        anchorX(mark2Anchor, ctx, prev) - anchorX(mark1Record.anchor, ctx, i),
        anchorY(mark2Anchor, ctx, prev) - anchorY(mark1Record.anchor, ctx, i),
      )
      break
    }
  }
}

/**
 * Collect `count` input positions after `start`, skipping ignored glyphs.
 * @returns positions (start excluded) or null when the sequence ends
 */
function gposCollectInput(
  lookup: ParsedGposLookup,
  ctx: GposContext,
  start: number,
  count: number,
): number[] | null {
  const positions: number[] = []
  let cur = start
  for (let c = 0; c < count; c++) {
    const j = gposNext(lookup, ctx, cur)
    if (j >= ctx.glyphIds.length) return null
    positions.push(j)
    cur = j
  }
  return positions
}

/**
 * Collect `count` backtrack positions before `start` (closest first),
 * skipping ignored glyphs.
 */
function gposCollectBacktrack(
  lookup: ParsedGposLookup,
  ctx: GposContext,
  start: number,
  count: number,
): number[] | null {
  const positions: number[] = []
  let cur = start
  for (let c = 0; c < count; c++) {
    const j = gposPrev(lookup, ctx, cur)
    if (j < 0) return null
    positions.push(j)
    cur = j
  }
  return positions
}

/** Apply the positioning lookup records of a matched context rule. */
function applyPosRecords(
  ctx: GposContext,
  matchedPositions: number[],
  records: PosLookupRecord[],
  depth: number,
): number {
  for (const rec of records) {
    if (rec.sequenceIndex >= matchedPositions.length) continue
    const nested = ctx.allLookups[rec.lookupListIndex]
    if (!nested) continue
    applyLookup(nested, ctx, matchedPositions[rec.sequenceIndex]!, depth + 1)
  }
  return matchedPositions[matchedPositions.length - 1]! + 1
}

/**
 * Try to match and apply a ContextPos subtable at position i.
 * @returns position just after the matched input, or -1 when no match
 */
function matchContextPosAt(
  lookup: ParsedGposLookup,
  st: ContextPosData,
  ctx: GposContext,
  i: number,
  depth: number,
): number {
  const glyphIds = ctx.glyphIds
  for (const rule of st.rules) {
    if (rule.format === 1 && rule.rulesByGlyph) {
      const ruleList = rule.rulesByGlyph.get(glyphIds[i]!)
      if (!ruleList) continue
      for (const r of ruleList) {
        const rest = gposCollectInput(lookup, ctx, i, r.sequence.length)
        if (rest === null) continue
        let match = true
        for (let s = 0; s < r.sequence.length; s++) {
          if (glyphIds[rest[s]!] !== r.sequence[s]) { match = false; break }
        }
        if (!match) continue
        return applyPosRecords(ctx, [i, ...rest], r.lookups, depth)
      }
    } else if (rule.format === 2 && rule.coverageMap && rule.classDef && rule.rulesByClass) {
      if (!rule.coverageMap.has(glyphIds[i]!)) continue
      const cls = rule.classDef.get(glyphIds[i]!) ?? 0
      const ruleList = rule.rulesByClass.get(cls)
      if (!ruleList) continue
      for (const r of ruleList) {
        const rest = gposCollectInput(lookup, ctx, i, r.sequence.length)
        if (rest === null) continue
        let match = true
        for (let s = 0; s < r.sequence.length; s++) {
          if ((rule.classDef.get(glyphIds[rest[s]!]!) ?? 0) !== r.sequence[s]) { match = false; break }
        }
        if (!match) continue
        return applyPosRecords(ctx, [i, ...rest], r.lookups, depth)
      }
    } else if (rule.format === 3 && rule.coverages && rule.lookups) {
      if (rule.coverages.length === 0 || !rule.coverages[0]!.has(glyphIds[i]!)) continue
      const rest = gposCollectInput(lookup, ctx, i, rule.coverages.length - 1)
      if (rest === null) continue
      let match = true
      for (let c = 1; c < rule.coverages.length; c++) {
        if (!rule.coverages[c]!.has(glyphIds[rest[c - 1]!]!)) { match = false; break }
      }
      if (!match) continue
      return applyPosRecords(ctx, [i, ...rest], rule.lookups, depth)
    }
  }
  return -1
}

function applyContextPos(
  lookup: ParsedGposLookup,
  ctx: GposContext,
  onlyAt: number | undefined,
  depth: number,
): void {
  const start = onlyAt ?? 0
  const end = onlyAt !== undefined ? onlyAt + 1 : ctx.glyphIds.length
  for (let i = start; i < end; i++) {
    if (gposSkips(lookup, ctx, i)) continue
    for (const st of lookup.subtables as ContextPosData[]) {
      const next = matchContextPosAt(lookup, st, ctx, i, depth)
      if (next >= 0) {
        if (onlyAt === undefined) i = next - 1
        break
      }
    }
  }
}

/**
 * Try to match and apply a ChainContextPos subtable at position i.
 * @returns position just after the matched input, or -1 when no match
 */
function matchChainContextPosAt(
  lookup: ParsedGposLookup,
  st: ChainContextPosData,
  ctx: GposContext,
  i: number,
  depth: number,
): number {
  const glyphIds = ctx.glyphIds
  for (const rule of st.rules) {
    if (rule.format === 1 && rule.rulesByGlyph) {
      const ruleList = rule.rulesByGlyph.get(glyphIds[i]!)
      if (!ruleList) continue
      for (const r of ruleList) {
        const back = gposCollectBacktrack(lookup, ctx, i, r.backtrack.length)
        if (back === null) continue
        let match = true
        for (let b = 0; b < r.backtrack.length; b++) {
          if (glyphIds[back[b]!] !== r.backtrack[b]) { match = false; break }
        }
        if (!match) continue
        const rest = gposCollectInput(lookup, ctx, i, r.input.length)
        if (rest === null) continue
        for (let s = 0; s < r.input.length; s++) {
          if (glyphIds[rest[s]!] !== r.input[s]) { match = false; break }
        }
        if (!match) continue
        const lastInput = rest.length > 0 ? rest[rest.length - 1]! : i
        const ahead = gposCollectInput(lookup, ctx, lastInput, r.lookahead.length)
        if (ahead === null) continue
        for (let l = 0; l < r.lookahead.length; l++) {
          if (glyphIds[ahead[l]!] !== r.lookahead[l]) { match = false; break }
        }
        if (!match) continue
        return applyPosRecords(ctx, [i, ...rest], r.lookups, depth)
      }
    } else if (rule.format === 2 && rule.coverageMap && rule.inputClassDef && rule.rulesByClass) {
      if (!rule.coverageMap.has(glyphIds[i]!)) continue
      const cls = rule.inputClassDef.get(glyphIds[i]!) ?? 0
      const ruleList = rule.rulesByClass.get(cls)
      if (!ruleList) continue
      for (const r of ruleList) {
        const back = gposCollectBacktrack(lookup, ctx, i, r.backtrack.length)
        if (back === null) continue
        let match = true
        for (let b = 0; b < r.backtrack.length; b++) {
          if ((rule.backtrackClassDef!.get(glyphIds[back[b]!]!) ?? 0) !== r.backtrack[b]) { match = false; break }
        }
        if (!match) continue
        const rest = gposCollectInput(lookup, ctx, i, r.input.length)
        if (rest === null) continue
        for (let s = 0; s < r.input.length; s++) {
          if ((rule.inputClassDef.get(glyphIds[rest[s]!]!) ?? 0) !== r.input[s]) { match = false; break }
        }
        if (!match) continue
        const lastInput = rest.length > 0 ? rest[rest.length - 1]! : i
        const ahead = gposCollectInput(lookup, ctx, lastInput, r.lookahead.length)
        if (ahead === null) continue
        for (let l = 0; l < r.lookahead.length; l++) {
          if ((rule.lookaheadClassDef!.get(glyphIds[ahead[l]!]!) ?? 0) !== r.lookahead[l]) { match = false; break }
        }
        if (!match) continue
        return applyPosRecords(ctx, [i, ...rest], r.lookups, depth)
      }
    } else if (rule.format === 3 && rule.inputCoverages && rule.lookups) {
      if (rule.inputCoverages.length === 0 || !rule.inputCoverages[0]!.has(glyphIds[i]!)) continue
      const backLen = rule.backtrackCoverages?.length ?? 0
      const back = gposCollectBacktrack(lookup, ctx, i, backLen)
      if (back === null) continue
      let match = true
      for (let b = 0; b < backLen; b++) {
        if (!rule.backtrackCoverages![b]!.has(glyphIds[back[b]!]!)) { match = false; break }
      }
      if (!match) continue
      const rest = gposCollectInput(lookup, ctx, i, rule.inputCoverages.length - 1)
      if (rest === null) continue
      for (let c = 1; c < rule.inputCoverages.length; c++) {
        if (!rule.inputCoverages[c]!.has(glyphIds[rest[c - 1]!]!)) { match = false; break }
      }
      if (!match) continue
      const lastInput = rest.length > 0 ? rest[rest.length - 1]! : i
      const lookLen = rule.lookaheadCoverages?.length ?? 0
      const ahead = gposCollectInput(lookup, ctx, lastInput, lookLen)
      if (ahead === null) continue
      for (let l = 0; l < lookLen; l++) {
        if (!rule.lookaheadCoverages![l]!.has(glyphIds[ahead[l]!]!)) { match = false; break }
      }
      if (!match) continue
      return applyPosRecords(ctx, [i, ...rest], rule.lookups, depth)
    }
  }
  return -1
}

function applyChainContextPos(
  lookup: ParsedGposLookup,
  ctx: GposContext,
  onlyAt: number | undefined,
  depth: number,
): void {
  const start = onlyAt ?? 0
  const end = onlyAt !== undefined ? onlyAt + 1 : ctx.glyphIds.length
  for (let i = start; i < end; i++) {
    if (gposSkips(lookup, ctx, i)) continue
    for (const st of lookup.subtables as ChainContextPosData[]) {
      const next = matchChainContextPosAt(lookup, st, ctx, i, depth)
      if (next >= 0) {
        if (onlyAt === undefined) i = next - 1
        break
      }
    }
  }
}
