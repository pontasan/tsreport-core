import { BinaryReader } from '../../binary/reader.js'
import { BinaryWriter } from '../../binary/writer.js'
import {
  parseCoverage,
  parseCoverageMap,
  parseClassDef,
  parseClassDefOrEmpty,
  parseLookupList,
  scriptListContainsTag,
  getFeatureLookupIndices,
  getFeatureListCount,
  parseFeatureVariations,
  getOpenTypeFeatureRecords,
  validateOpenTypeFeatureRecords,
  buildStaticFeatureList,
  buildStaticScriptList,
  resolveFeatureVariationSubstitution,
  resolveExtension,
  lookupIgnoresGlyph,
  type LookupInfo,
  type FeatureVariationsTable,
  type OpenTypeLayoutFeatureRecord,
} from './otl-common.js'
import type { GdefTable } from './gdef.js'

/**
 * GSUB table: glyph substitution.
 * Supports all lookup types 1 through 8, lookupFlag glyph filtering via GDEF,
 * every context/chain-context subtable format (1, 2 and 3), and nested lookup
 * records of any substitution type.
 */
export interface GsubTable {
  /** FeatureList records, including registered FeatureParams metadata. */
  getFeatureRecords(normalizedCoords?: number[] | null): OpenTypeLayoutFeatureRecord[]

  /** Single substitution: glyphId -> substituted glyphId, or the original ID when absent. */
  getSingleSubstitution(glyphId: number): number

  /** Ligature lookup: first glyphId plus following glyphIds -> ligature glyphId. */
  getLigature(glyphIds: number[]): { ligatureGlyphId: number, componentCount: number } | null

  /** Apply one lookup by its LookupList index. */
  applyLookup(glyphIds: number[], lookupIndex: number, gdef?: GdefTable | null): number[]

  /** Apply an explicit ordered lookup plan to a metadata-bearing shaping buffer. */
  applyLookupsToShapingBuffer(
    buffer: GsubShapingBuffer,
    lookupIndices: readonly number[],
    gdef?: GdefTable | null,
  ): void

  /** Returns the resolved lookup type at a LookupList index. */
  getLookupType(lookupIndex: number): number

  /**
   * Apply GSUB substitution with the specified feature tags.
   * @param glyphIds Input glyph ID sequence.
   * @param features Feature tags to apply; null means the default set.
   * @param script Script tag; null selects automatically.
   * @param language Language tag; null uses DefaultLangSys.
   * @param gdef GDEF table used for lookupFlag glyph filtering; null disables filtering.
   * @returns Substituted glyph ID sequence.
 */
  applySubstitutions(
    glyphIds: number[],
    features?: Set<string> | null,
    script?: string | null,
    language?: string | null,
    gdef?: GdefTable | null,
    normalizedCoords?: number[] | null,
    lookupModifications?: GsubLookupModifications | null,
    featureSettings?: readonly OpenTypeFeatureSetting[] | null,
  ): number[]

  applySubstitutionsWithMetadata(
    glyphIds: number[],
    features?: Set<string> | null,
    script?: string | null,
    language?: string | null,
    gdef?: GdefTable | null,
    normalizedCoords?: number[] | null,
    lookupModifications?: GsubLookupModifications | null,
    initialFlags?: Uint8Array | null,
    initialSourceClusters?: Uint32Array | null,
    featureSettings?: readonly OpenTypeFeatureSetting[] | null,
  ): { glyphIds: number[], clusters: Uint16Array, sourceClusters: Uint32Array, flags: Uint8Array, ligatureMarkComponents: Map<number, number> | null }

  /**
   * Apply GSUB substitution driven by per-glyph Arabic joining positions.
   * All applicable lookups run in a single pass in lookup index order; the
   * positional features (isol / fina / medi / init) are restricted to glyphs
   * whose joining position matches, while the other features apply everywhere.
   * Cluster tracking is exact: the returned clusters array holds the number of
   * source code points each output glyph covers (0 = continuation glyph of the
   * preceding cluster, e.g. a mark split off by a ccmp decomposition).
   * @param glyphIds Input glyph ID sequence (aligned 1:1 with positions).
   * @param positions Per-glyph joining position (JOIN_POS_* values).
   * @param features Feature tags for the non-positional lookups; null means the
   *                 Arabic default set: ccmp, locl, rlig, liga, calt, clig, rclt.
   * @param script Script tag; null uses the default script resolution.
   * @param language Language tag; null uses DefaultLangSys.
   * @param gdef GDEF table used for lookupFlag glyph filtering; null disables filtering.
   * @param initialClusters Initial per-glyph cluster sizes (default: all 1).
   * @returns Substituted glyph ID sequence with per-glyph source cluster sizes.
   */
  applyJoiningSubstitutions(
    glyphIds: number[],
    positions: Uint8Array,
    features?: Set<string> | null,
    script?: string | null,
    language?: string | null,
    gdef?: GdefTable | null,
    initialClusters?: Uint16Array | null,
    normalizedCoords?: number[] | null,
    lookupModifications?: GsubLookupModifications | null,
    initialFlags?: Uint8Array | null,
    initialSourceClusters?: Uint32Array | null,
    featureSettings?: readonly OpenTypeFeatureSetting[] | null,
  ): { glyphIds: number[], clusters: Uint16Array, sourceClusters: Uint32Array, flags: Uint8Array }

  /**
   * Apply one shaping stage: the lookups of all given features run in lookup
   * index order over the buffer, each lookup gated by the OR of the masks of
   * the features that reference it (a lookup applies at a glyph when
   * lookupMask & buffer.masks[i] != 0). Per-syllable features never match
   * sequences across different buffer syllable values. The buffer arrays are
   * modified in place. Complex-script shapers call this once per stage and
   * run their reordering between calls.
   */
  applyShapingFeatures(
    buffer: GsubShapingBuffer,
    features: readonly GsubShapingFeature[],
    script?: string | null,
    language?: string | null,
    gdef?: GdefTable | null,
    normalizedCoords?: number[] | null,
    lookupModifications?: GsubLookupModifications | null,
    featureSettings?: readonly OpenTypeFeatureSetting[] | null,
  ): void

  /**
   * Resolve the lookup indices of one feature tag for a script/language
   * (sorted ascending). Used by shapers to plan would-substitute tests.
   */
  getFeatureLookupIndexList(
    tag: string,
    script?: string | null,
    language?: string | null,
    normalizedCoords?: number[] | null,
  ): number[]

  /** Whether the Script List contains an exact script tag (no fallback). */
  hasScript(scriptTag: string): boolean

  /**
   * Whether any of the given lookups would substitute the exact glyph
   * sequence. Matches the sequence against SingleSubst / MultipleSubst /
   * AlternateSubst coverage (length 1), LigatureSubst components, and the
   * input sequence of (Chain)Context rules. With zeroContext, chain rules
   * with backtrack or lookahead requirements never match.
   */
  wouldSubstitute(
    lookupIndices: readonly number[],
    glyphs: readonly number[],
    zeroContext: boolean,
  ): boolean

  /**
   * Collect glyph IDs referenced by substitution destination records.
   * For subsetting, substitution destination glyphs are included as well.
   */
  getReferencedGlyphIds(): Set<number>

  /**
   * Collect sequence-dependent substitution glyphs reachable from the given input glyph set.
   */
  getReachableSubstitutionGlyphIds(glyphIds: ReadonlySet<number>): Set<number>

  /**
   * Get the component count for ligature glyphs.
   * @returns Map from ligatureGlyphId to componentCount.
 */
  getLigatureComponentCounts(): Map<number, number>
}

/** LookupList changes requested by one standalone JSTF priority. */
export interface GsubLookupModifications {
  readonly enabled: readonly number[]
  readonly disabled: readonly number[]
}

/** One OpenType feature value applied to a source-cluster range. */
export interface OpenTypeFeatureSetting {
  /** Four-character OpenType feature tag. */
  readonly tag: string
  /** Zero disables the feature; GSUB type 3 uses a one-based alternate index. */
  readonly value: number
  /** Inclusive source code-point cluster index. */
  readonly start?: number
  /** Exclusive source code-point cluster index. */
  readonly end?: number
}

/** One feature of a shaping stage (see GsubTable.applyShapingFeatures). */
export interface GsubShapingFeature {
  /** OpenType feature tag. */
  tag: string
  /** Glyph-mask bits this feature's lookups require (GSUB_MASK_GLOBAL for global features). */
  mask: number
  /** Constrain sequence matching to a single buffer syllable. */
  perSyllable: boolean
  /** Global value before explicit range settings; defaults to one. */
  defaultValue?: number
}

/**
 * Glyph-mask bit for globally applied features. Every glyph mask a shaper
 * builds must include this bit; feature-specific bits start at bit 1.
 */
export const GSUB_MASK_GLOBAL = 1

/** Default feature tags. */
const DEFAULT_FEATURES = new Set(['ccmp', 'locl', 'rlig', 'liga', 'calt', 'clig', 'rclt'])

function modifyLookupIndices(
  selected: readonly number[],
  modifications: GsubLookupModifications | null | undefined,
  includeEnabled: boolean,
): number[] {
  if (modifications === null || modifications === undefined) return [...selected]
  const indices = new Set<number>(selected)
  for (let i = 0; i < modifications.disabled.length; i++) indices.delete(modifications.disabled[i]!)
  if (includeEnabled) {
    for (let i = 0; i < modifications.enabled.length; i++) indices.add(modifications.enabled[i]!)
  }
  return [...indices].sort((a, b) => a - b)
}

/**
 * Default feature tags for Arabic joining shaping: glyph composition /
 * decomposition and localized forms run first (lookup index order), required
 * ligatures and contextual features after the positional forms.
 */
const ARABIC_DEFAULT_FEATURES = new Set(['ccmp', 'locl', 'rlig', 'liga', 'calt', 'clig', 'rclt'])

/**
 * Positional feature tags indexed by joining position code minus 1
 * (JOIN_POS_ISOL=1 .. JOIN_POS_INIT=4, see arabic-joining.ts).
 */
const POSITIONAL_FEATURES: Set<string>[] = [
  new Set(['isol']),
  new Set(['fina']),
  new Set(['medi']),
  new Set(['init']),
]

/** All positional feature tags (excluded from the unrestricted lookups). */
const POSITIONAL_TAGS = ['isol', 'fina', 'medi', 'init']

/** Position mask bits: bit c set means the lookup applies at joining position c. */
const POS_MASK_ALL = 0x1F // positions 0 (none) through 4 (init)

/** Maximum nesting depth for contextual lookup records (matches HarfBuzz). */
const MAX_NESTING_DEPTH = 64

/**
 * Parse the GSUB table.
 */

export function parseGsub(reader: BinaryReader, expectedAxisCount?: number): GsubTable {
  const tableStart = reader.position

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const scriptListOffset = reader.readUint16()
  const featureListOffset = reader.readUint16()
  const lookupListOffset = reader.readUint16()
  let featureVariationsOffset = 0
  if (majorVersion !== 1) {
    throw new Error(`Unsupported GSUB version: ${majorVersion}.${minorVersion}`)
  }
  if (minorVersion >= 1) featureVariationsOffset = reader.readUint32()

  // Parse the Lookup List.

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

  // Pre-parse every lookup and build substitution data.

  const singleSubst = new Map<number, number>()
  const ligatures = new Map<number, { components: number[], ligatureGlyphId: number }[]>()
  const multipleSubst = new Map<number, number[]>()
  const alternateSubst = new Map<number, number[]>()

  // Parsed data for each Lookup.

  const parsedLookups: ParsedGsubLookup[] = []

  for (let li = 0; li < lookups.length; li++) {
    const lookup = lookups[li]!
    const parsed = parseLookup(reader, lookup, lookups.length)
    parsedLookups.push(parsed)

    // Backward compatibility: also store data in the singleSubst and ligatures maps.

    if (parsed.type === 1) {
      for (const st of parsed.subtables as SingleSubstData[]) {
        for (const [from, to] of st.mapping) {
          singleSubst.set(from, to)
        }
      }
    } else if (parsed.type === 4) {
      for (const st of parsed.subtables as LigatureSubstData[]) {
        for (const [firstGlyph, ligs] of st.ligatures) {
          const existing = ligatures.get(firstGlyph) ?? []
          existing.push(...ligs)
          ligatures.set(firstGlyph, existing)
        }
      }
    } else if (parsed.type === 2) {
      for (const st of parsed.subtables as MultipleSubstData[]) {
        for (const [from, to] of st.mapping) {
          multipleSubst.set(from, to)
        }
      }
    } else if (parsed.type === 3) {
      for (const st of parsed.subtables as AlternateSubstData[]) {
        for (const [from, alts] of st.mapping) {
          alternateSubst.set(from, alts)
        }
      }
    }
  }

  // Feature-tag -> lookup-index resolution cache for the shaper APIs
  // (complex shapers resolve the same features once per stage per run).
  const featureLookupCache = new Map<string, number[]>()

  function resolveFeatureLookups(
    tag: string,
    script: string | null,
    language: string | null,
    normalizedCoords: number[] | null,
  ): number[] {
    const coordKey = normalizedCoords === null ? '' : normalizedCoords.join(',')
    const key = `${tag}|${script ?? ''}|${language ?? ''}|${coordKey}`
    let indices = featureLookupCache.get(key)
    if (indices === undefined) {
      indices = getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        new Set([tag]), script, language, lookups.length, featureVariations, normalizedCoords,
      )
      featureLookupCache.set(key, indices)
    }
    return indices
  }

  interface FeatureValuePlan {
    defaultValue: number
    settings: readonly OpenTypeFeatureSetting[]
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
        const setting = settings[i]!
        if (setting.tag === tag) tagSettings.push(setting)
      }
      const plan: FeatureValuePlan = {
        defaultValue: featureTags.has(tag) ? 1 : 0,
        settings: tagSettings,
      }
      const indices = resolveFeatureLookups(tag, script, language, normalizedCoords)
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
      const start = setting.start ?? 0
      const end = setting.end ?? Number.POSITIVE_INFINITY
      if (cluster >= start && cluster < end) value = setting.value
    }
    return value
  }

  function applyFeatureValueLookups(
    buf: GsubBuffer,
    plans: Map<number, FeatureValuePlan[]>,
    modifications: GsubLookupModifications | null | undefined,
    gdef: GdefTable | null,
  ): void {
    if (modifications !== null && modifications !== undefined) {
      for (let i = 0; i < modifications.disabled.length; i++) plans.delete(modifications.disabled[i]!)
      for (let i = 0; i < modifications.enabled.length; i++) {
        const lookupIndex = modifications.enabled[i]!
        if (!plans.has(lookupIndex)) plans.set(lookupIndex, [{ defaultValue: 1, settings: [] }])
      }
    }
    const lookupIndices = [...plans.keys()].sort((a, b) => a - b)
    for (let p = 0; p < lookupIndices.length; p++) {
      const lookupIndex = lookupIndices[p]!
      if (lookupIndex >= parsedLookups.length) continue
      const lookupPlans = plans.get(lookupIndex)!
      const values = new Array<number>(buf.glyphs.length)
      for (let i = 0; i < values.length; i++) {
        const cluster = buf.sourceClusters?.[i] ?? i
        let value = 0
        for (let j = 0; j < lookupPlans.length; j++) {
          const candidate = featureValueAtCluster(lookupPlans[j]!, cluster)
          if (candidate > value) value = candidate
        }
        values[i] = value
      }
      buf.lookupValues = values
      applyLookupBuf(parsedLookups[lookupIndex]!, buf, POS_MASK_ALL, parsedLookups, gdef, 0, false)
    }
    buf.lookupValues = null
  }

  return {
    getFeatureRecords(normalizedCoords?: number[] | null): OpenTypeLayoutFeatureRecord[] {
      return getOpenTypeFeatureRecords(
        reader, tableStart, featureListOffset, lookups.length, featureVariations, normalizedCoords ?? null,
      )
    },

    getSingleSubstitution(glyphId: number): number {
      return singleSubst.get(glyphId) ?? glyphId
    },

    getLigature(glyphIds: number[]): { ligatureGlyphId: number, componentCount: number } | null {
      if (glyphIds.length === 0) return null
      const firstGlyph = glyphIds[0]!
      const ligSets = ligatures.get(firstGlyph)
      if (!ligSets) return null

      for (const lig of ligSets) {
        if (lig.components.length + 1 > glyphIds.length) continue
        let match = true
        for (let i = 0; i < lig.components.length; i++) {
          if (lig.components[i] !== glyphIds[i + 1]) {
            match = false
            break
          }
        }
        if (match) {
          return { ligatureGlyphId: lig.ligatureGlyphId, componentCount: lig.components.length + 1 }
        }
      }
      return null
    },

    applyLookup(glyphIds: number[], lookupIndex: number, gdef?: GdefTable | null): number[] {
      const lookup = parsedLookups[lookupIndex]
      if (lookup === undefined) throw new Error(`GSUB lookup index ${lookupIndex} is out of range`)
      const buf: GsubBuffer = {
        glyphs: [...glyphIds], masks: null, clusters: null,
        syllables: null, aux: null, flags: null,
      }
      applyLookupBuf(lookup, buf, POS_MASK_ALL, parsedLookups, gdef ?? null, 0, false)
      return buf.glyphs
    },

    applyLookupsToShapingBuffer(
      buffer: GsubShapingBuffer,
      lookupIndices: readonly number[],
      gdef?: GdefTable | null,
    ): void {
      for (let i = 0; i < lookupIndices.length; i++) {
        const lookupIndex = lookupIndices[i]!
        const lookup = parsedLookups[lookupIndex]
        if (lookup === undefined) throw new Error(`GSUB lookup index ${lookupIndex} is out of range`)
        applyLookupBuf(lookup, buffer, POS_MASK_ALL, parsedLookups, gdef ?? null, 0, false)
      }
    },

    getLookupType(lookupIndex: number): number {
      const lookup = parsedLookups[lookupIndex]
      if (lookup === undefined) throw new Error(`GSUB lookup index ${lookupIndex} is out of range`)
      return lookup.type
    },

    applySubstitutions(
      glyphIds: number[],
      features?: Set<string> | null,
      script?: string | null,
      language?: string | null,
      gdef?: GdefTable | null,
      normalizedCoords?: number[] | null,
      lookupModifications?: GsubLookupModifications | null,
      featureSettings?: readonly OpenTypeFeatureSetting[] | null,
    ): number[] {
      const featureTags = features ?? DEFAULT_FEATURES
      if (featureSettings !== null && featureSettings !== undefined && featureSettings.length > 0) {
        const buf: GsubBuffer = {
          glyphs: [...glyphIds], masks: null, clusters: null,
          sourceClusters: glyphIds.map((_glyph, index) => index),
          syllables: null, aux: null, flags: null,
        }
        const plans = resolveLookupFeatureValues(
          featureTags, featureSettings, script ?? null, language ?? null, normalizedCoords ?? null,
        )
        applyFeatureValueLookups(buf, plans, lookupModifications, gdef ?? null)
        return buf.glyphs
      }
      const lookupIndices = modifyLookupIndices(getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        featureTags, script, language, lookups.length, featureVariations, normalizedCoords ?? null,
      ), lookupModifications, true)

      const buf: GsubBuffer = {
        glyphs: [...glyphIds], masks: null, clusters: null,
        syllables: null, aux: null, flags: null,
      }
      for (const li of lookupIndices) {
        if (li >= parsedLookups.length) continue
        applyLookupBuf(parsedLookups[li]!, buf, POS_MASK_ALL, parsedLookups, gdef ?? null, 0, false)
      }
      return buf.glyphs
    },

    applySubstitutionsWithMetadata(
      glyphIds: number[],
      features?: Set<string> | null,
      script?: string | null,
      language?: string | null,
      gdef?: GdefTable | null,
      normalizedCoords?: number[] | null,
      lookupModifications?: GsubLookupModifications | null,
      initialFlags?: Uint8Array | null,
      initialSourceClusters?: Uint32Array | null,
      featureSettings?: readonly OpenTypeFeatureSetting[] | null,
    ): { glyphIds: number[], clusters: Uint16Array, sourceClusters: Uint32Array, flags: Uint8Array, ligatureMarkComponents: Map<number, number> | null } {
      const featureTags = features ?? DEFAULT_FEATURES
      const lookupIndices = modifyLookupIndices(getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        featureTags, script, language, lookups.length, featureVariations, normalizedCoords ?? null,
      ), lookupModifications, true)

      // Track per-glyph source-component counts (1 per code point to start): a
      // ligature sums them and a multiple-substitution decomposition keeps the
      // count on its first output glyph with 0 on the rest, so ToUnicode maps a
      // decomposed presentation form (e.g. U+FB01 -> f + i) back to one source.
      const clusterArr: number[] = new Array<number>(glyphIds.length).fill(1)
      const buf: GsubBuffer = {
        glyphs: [...glyphIds], masks: null, clusters: clusterArr,
        sourceClusters: initialSourceClusters == null
          ? glyphIds.map((_glyph, index) => index)
          : Array.from(initialSourceClusters),
        syllables: null, aux: null,
        flags: initialFlags === null || initialFlags === undefined ? new Array(glyphIds.length).fill(0) : Array.from(initialFlags),
        ligatureMarkComponents: new Array(glyphIds.length).fill(-1),
      }
      if (featureSettings !== null && featureSettings !== undefined && featureSettings.length > 0) {
        const plans = resolveLookupFeatureValues(
          featureTags, featureSettings, script ?? null, language ?? null, normalizedCoords ?? null,
        )
        applyFeatureValueLookups(buf, plans, lookupModifications, gdef ?? null)
      } else {
        for (const li of lookupIndices) {
          if (li >= parsedLookups.length) continue
          applyLookupBuf(parsedLookups[li]!, buf, POS_MASK_ALL, parsedLookups, gdef ?? null, 0, false)
        }
      }
      return {
        glyphIds: buf.glyphs,
        clusters: Uint16Array.from(buf.clusters!),
        sourceClusters: Uint32Array.from(buf.sourceClusters!),
        flags: Uint8Array.from(buf.flags!),
        ligatureMarkComponents: compactLigatureMarkComponents(buf.ligatureMarkComponents),
      }
    },

    applyJoiningSubstitutions(
      glyphIds: number[],
      positions: Uint8Array,
      features?: Set<string> | null,
      script?: string | null,
      language?: string | null,
      gdef?: GdefTable | null,
      initialClusters?: Uint16Array | null,
      normalizedCoords?: number[] | null,
      lookupModifications?: GsubLookupModifications | null,
      initialFlags?: Uint8Array | null,
      initialSourceClusters?: Uint32Array | null,
      featureSettings?: readonly OpenTypeFeatureSetting[] | null,
    ): { glyphIds: number[], clusters: Uint16Array, sourceClusters: Uint32Array, flags: Uint8Array } {
      const scriptTag = script ?? null

      // Build the per-lookup position mask: positional features restrict a
      // lookup to glyphs at the matching joining position; a lookup referenced
      // by several positional features accepts each of them.
      const lookupMasks = new Map<number, number>()
      for (let p = 0; p < POSITIONAL_FEATURES.length; p++) {
        const indices = getFeatureLookupIndices(
          reader, tableStart, scriptListOffset, featureListOffset,
          POSITIONAL_FEATURES[p]!, scriptTag, language, lookups.length, featureVariations, normalizedCoords ?? null,
        )
        const bit = 1 << (p + 1)
        for (const li of indices) {
          lookupMasks.set(li, (lookupMasks.get(li) ?? 0) | bit)
        }
      }
      const featureTags = new Set(features ?? ARABIC_DEFAULT_FEATURES)
      for (const tag of POSITIONAL_TAGS) featureTags.delete(tag)
      const selectedGeneralTags = new Set(featureTags)
      if (featureSettings !== null && featureSettings !== undefined) {
        for (let i = 0; i < featureSettings.length; i++) {
          const tag = featureSettings[i]!.tag
          if (!POSITIONAL_TAGS.includes(tag)) selectedGeneralTags.add(tag)
        }
      }
      const generalIndices = getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        selectedGeneralTags, scriptTag, language, lookups.length, featureVariations, normalizedCoords ?? null,
      )
      for (const li of generalIndices) {
        lookupMasks.set(li, POS_MASK_ALL)
      }
      if (lookupModifications !== null && lookupModifications !== undefined) {
        for (let i = 0; i < lookupModifications.disabled.length; i++) {
          lookupMasks.delete(lookupModifications.disabled[i]!)
        }
        for (let i = 0; i < lookupModifications.enabled.length; i++) {
          lookupMasks.set(lookupModifications.enabled[i]!, POS_MASK_ALL)
        }
      }

      // Single pass in lookup index order (decompositions run before the
      // positional forms, ligatures and contextual lookups after them).
      // Per-glyph masks hold 1 << joiningPosition; positional lookups carry
      // the bit of their position, general lookups accept all five bits.
      const sortedIndices = [...lookupMasks.keys()].sort((a, b) => a - b)
      const featurePlans = featureSettings !== null && featureSettings !== undefined && featureSettings.length > 0
        ? resolveLookupFeatureValues(
          featureTags, featureSettings, scriptTag, language ?? null, normalizedCoords ?? null,
        )
        : null
      const maskArr: number[] = new Array(glyphIds.length)
      const clusterArr: number[] = new Array(glyphIds.length)
      for (let i = 0; i < glyphIds.length; i++) {
        maskArr[i] = 1 << positions[i]!
        clusterArr[i] = initialClusters ? initialClusters[i]! : 1
      }
      const buf: GsubBuffer = {
        glyphs: [...glyphIds], masks: maskArr, clusters: clusterArr,
        sourceClusters: initialSourceClusters == null
          ? glyphIds.map((_glyph, index) => index)
          : Array.from(initialSourceClusters),
        syllables: null, aux: null,
        flags: initialFlags === null || initialFlags === undefined ? new Array(glyphIds.length).fill(0) : Array.from(initialFlags),
      }
      for (const li of sortedIndices) {
        if (li >= parsedLookups.length) continue
        if (featurePlans !== null) {
          const plans = featurePlans.get(li)
          if (plans !== undefined) {
            const values = new Array<number>(buf.glyphs.length)
            for (let i = 0; i < values.length; i++) {
              const cluster = buf.sourceClusters?.[i] ?? i
              let value = 0
              for (let j = 0; j < plans.length; j++) {
                const candidate = featureValueAtCluster(plans[j]!, cluster)
                if (candidate > value) value = candidate
              }
              values[i] = value
            }
            buf.lookupValues = values
          } else {
            buf.lookupValues = null
          }
        }
        applyLookupBuf(parsedLookups[li]!, buf, lookupMasks.get(li)!, parsedLookups, gdef ?? null, 0, false)
      }
      buf.lookupValues = null
      return {
        glyphIds: buf.glyphs,
        clusters: Uint16Array.from(buf.clusters!),
        sourceClusters: Uint32Array.from(buf.sourceClusters!),
        flags: Uint8Array.from(buf.flags!),
      }
    },

    applyShapingFeatures(
      buffer: GsubShapingBuffer,
      features: readonly GsubShapingFeature[],
      script?: string | null,
      language?: string | null,
      gdef?: GdefTable | null,
      normalizedCoords?: number[] | null,
      lookupModifications?: GsubLookupModifications | null,
      featureSettings?: readonly OpenTypeFeatureSetting[] | null,
    ): void {
      // Merge the lookups of all features in the stage: duplicate lookups OR
      // their masks, and stay per-syllable when any referencing feature is.
      const lookupMasks = new Map<number, number>()
      const lookupPerSyllable = new Map<number, boolean>()
      const lookupFeatures = new Map<number, GsubShapingFeature[]>()
      for (const feature of features) {
        const indices = resolveFeatureLookups(feature.tag, script ?? null, language ?? null, normalizedCoords ?? null)
        for (const li of indices) {
          lookupMasks.set(li, (lookupMasks.get(li) ?? 0) | feature.mask)
          lookupPerSyllable.set(li, (lookupPerSyllable.get(li) ?? false) || feature.perSyllable)
          const selectedFeatures = lookupFeatures.get(li)
          if (selectedFeatures === undefined) lookupFeatures.set(li, [feature])
          else selectedFeatures.push(feature)
        }
      }
      if (lookupModifications !== null && lookupModifications !== undefined) {
        for (let i = 0; i < lookupModifications.disabled.length; i++) {
          lookupMasks.delete(lookupModifications.disabled[i]!)
          lookupPerSyllable.delete(lookupModifications.disabled[i]!)
          lookupFeatures.delete(lookupModifications.disabled[i]!)
        }
      }
      const sortedIndices = [...lookupMasks.keys()].sort((a, b) => a - b)
      const settingsByTag = new Map<string, OpenTypeFeatureSetting[]>()
      if (featureSettings !== null && featureSettings !== undefined) {
        for (let i = 0; i < featureSettings.length; i++) {
          const setting = featureSettings[i]!
          const tagSettings = settingsByTag.get(setting.tag)
          if (tagSettings === undefined) settingsByTag.set(setting.tag, [setting])
          else tagSettings.push(setting)
        }
      }
      for (const li of sortedIndices) {
        if (li >= parsedLookups.length) continue
        const posMask = lookupMasks.get(li)!
        if (featureSettings !== null && featureSettings !== undefined && featureSettings.length > 0) {
          const selectedFeatures = lookupFeatures.get(li)!
          const values = new Array<number>(buffer.glyphs.length)
          for (let i = 0; i < values.length; i++) {
            const cluster = buffer.sourceClusters?.[i] ?? i
            let value = 0
            for (let j = 0; j < selectedFeatures.length; j++) {
              const feature = selectedFeatures[j]!
              if ((buffer.masks?.[i] ?? GSUB_MASK_GLOBAL) & feature.mask) {
                const candidate = featureValueAtCluster(
                  { defaultValue: feature.defaultValue ?? 1, settings: settingsByTag.get(feature.tag) ?? [] }, cluster,
                )
                if (candidate > value) value = candidate
              }
            }
            values[i] = value
          }
          buffer.lookupValues = values
        }
        applyLookupBuf(
          parsedLookups[li]!, buffer, posMask,
          parsedLookups, gdef ?? null, 0, lookupPerSyllable.get(li)!,
        )
      }
      buffer.lookupValues = null
    },

    getFeatureLookupIndexList(
      tag: string,
      script?: string | null,
      language?: string | null,
      normalizedCoords?: number[] | null,
    ): number[] {
      return resolveFeatureLookups(tag, script ?? null, language ?? null, normalizedCoords ?? null)
    },

    hasScript(scriptTag: string): boolean {
      return scriptListContainsTag(reader, tableStart + scriptListOffset, scriptTag)
    },

    wouldSubstitute(
      lookupIndices: readonly number[],
      glyphs: readonly number[],
      zeroContext: boolean,
    ): boolean {
      for (const li of lookupIndices) {
        if (li >= parsedLookups.length) continue
        if (wouldApplyLookup(parsedLookups[li]!, glyphs, zeroContext)) return true
      }
      return false
    },

    getReferencedGlyphIds(): Set<number> {
      const ids = new Set<number>()
      for (const [, to] of singleSubst) ids.add(to)
      for (const [, ligs] of ligatures) {
        for (const lig of ligs) ids.add(lig.ligatureGlyphId)
      }
      for (const [, seq] of multipleSubst) {
        for (const gid of seq) ids.add(gid)
      }
      for (const [, alts] of alternateSubst) {
        for (const gid of alts) ids.add(gid)
      }
      for (const lookup of parsedLookups) {
        if (lookup.type !== 8) continue
        for (const subtable of lookup.subtables) {
          if (subtable.kind !== 8) continue
          for (const gid of subtable.substituteGlyphs) ids.add(gid)
        }
      }
      return ids
    },

    getReachableSubstitutionGlyphIds(glyphIds: ReadonlySet<number>): Set<number> {
      const expanded = new Set<number>(glyphIds)
      let previousSize = -1
      while (previousSize !== expanded.size) {
        previousSize = expanded.size
        for (let i = 0; i < parsedLookups.length; i++) {
          collectReachableLookupSubstitutions(parsedLookups, i, expanded, expanded, new Set<number>())
        }
      }
      for (const glyphId of glyphIds) expanded.delete(glyphId)
      return expanded
    },

    getLigatureComponentCounts(): Map<number, number> {
      const counts = new Map<number, number>()
      for (const [, ligs] of ligatures) {
        for (const lig of ligs) {
          counts.set(lig.ligatureGlyphId, lig.components.length + 1)
        }
      }
      return counts
    },
  }
}

function compactLigatureMarkComponents(markComponents: number[] | null | undefined): Map<number, number> | null {
  if (!markComponents) return null
  const out = new Map<number, number>()
  for (let i = 0; i < markComponents.length; i++) {
    const component = markComponents[i]!
    if (component >= 0) out.set(i, component)
  }
  return out.size > 0 ? out : null
}

// --- Parsed Lookup data structures ---

interface ParsedGsubLookup {
  type: number // actual type (after Extension resolution)
  flag: number
  markFilteringSet: number | undefined
  subtables: SubtableData[]
}

type SubtableData =
  | SingleSubstData
  | MultipleSubstData
  | AlternateSubstData
  | LigatureSubstData
  | ContextSubstData
  | ChainContextSubstData
  | ReverseChainSubstData

interface SingleSubstData {
  kind: 1
  mapping: Map<number, number>
}

interface MultipleSubstData {
  kind: 2
  mapping: Map<number, number[]>
}

interface AlternateSubstData {
  kind: 3
  mapping: Map<number, number[]>
}

interface LigatureSubstData {
  kind: 4
  ligatures: Map<number, { components: number[], ligatureGlyphId: number }[]>
}

interface ContextSubstData {
  kind: 5
  format: number
  rules: ContextRule[]
}

interface ChainContextSubstData {
  kind: 6
  format: number
  rules: ChainContextRule[]
}

interface ReverseChainSubstData {
  kind: 8
  coverage: Map<number, number> // coverageMap
  backtrackCoverages: Map<number, number>[]
  lookaheadCoverages: Map<number, number>[]
  substituteGlyphs: number[]
}

interface ContextRule {
  coverageMap?: Map<number, number>  // Format 2
  classDef?: Map<number, number>     // Format 2
  rulesByClass?: Map<number, { sequence: number[], lookups: SubstLookupRecord[] }[]> // Format 2
  rulesByGlyph?: Map<number, { sequence: number[], lookups: SubstLookupRecord[] }[]> // Format 1
  coverages?: Map<number, number>[]  // Format 3
  lookups?: SubstLookupRecord[]      // Format 3
  format: number
}

interface ChainContextRule {
  format: number
  // Format 1
  rulesByGlyph?: Map<number, {
    backtrack: number[], input: number[], lookahead: number[], lookups: SubstLookupRecord[]
  }[]>
  coverageMap?: Map<number, number>
  // Format 2
  backtrackClassDef?: Map<number, number>
  inputClassDef?: Map<number, number>
  lookaheadClassDef?: Map<number, number>
  rulesByClass?: Map<number, {
    backtrack: number[], input: number[], lookahead: number[], lookups: SubstLookupRecord[]
  }[]>
  // Format 3
  backtrackCoverages?: Map<number, number>[]
  inputCoverages?: Map<number, number>[]
  lookaheadCoverages?: Map<number, number>[]
  lookups?: SubstLookupRecord[]
}

interface SubstLookupRecord {
  sequenceIndex: number
  lookupListIndex: number
}

function collectReachableReverseChainSubstitutions(
  subtable: ReverseChainSubstData,
  glyphIds: ReadonlySet<number>,
  out: Set<number>,
): void {
  for (const [gid, coverageIndex] of subtable.coverage) {
    if (!glyphIds.has(gid)) continue
    if (!allCoveragesIntersect(subtable.backtrackCoverages, glyphIds)) continue
    if (!allCoveragesIntersect(subtable.lookaheadCoverages, glyphIds)) continue
    out.add(subtable.substituteGlyphs[coverageIndex]!)
  }
}

function collectReachableLookupSubstitutions(
  lookups: readonly ParsedGsubLookup[],
  lookupIndex: number,
  glyphIds: ReadonlySet<number>,
  out: Set<number>,
  activeLookups: Set<number>,
): void {
  if (activeLookups.has(lookupIndex)) return
  activeLookups.add(lookupIndex)
  const lookup = lookups[lookupIndex]!
  for (let i = 0; i < lookup.subtables.length; i++) {
    const subtable = lookup.subtables[i]!
    if (subtable.kind === 1) {
      for (const [source, target] of subtable.mapping) {
        if (glyphIds.has(source)) out.add(target)
      }
    } else if (subtable.kind === 2 || subtable.kind === 3) {
      for (const [source, targets] of subtable.mapping) {
        if (!glyphIds.has(source)) continue
        for (let target = 0; target < targets.length; target++) out.add(targets[target]!)
      }
    } else if (subtable.kind === 4) {
      collectReachableLigatureSubstitutions(subtable, glyphIds, out)
    } else if (subtable.kind === 5) {
      collectReachableContextSubstitutions(subtable, lookups, glyphIds, out, activeLookups)
    } else if (subtable.kind === 6) {
      collectReachableChainContextSubstitutions(subtable, lookups, glyphIds, out, activeLookups)
    } else {
      collectReachableReverseChainSubstitutions(subtable, glyphIds, out)
    }
  }
  activeLookups.delete(lookupIndex)
}

function collectReachableLigatureSubstitutions(
  subtable: LigatureSubstData,
  glyphIds: ReadonlySet<number>,
  out: Set<number>,
): void {
  for (const [first, ligatures] of subtable.ligatures) {
    if (!glyphIds.has(first)) continue
    for (let i = 0; i < ligatures.length; i++) {
      const ligature = ligatures[i]!
      let reachable = true
      for (let component = 0; component < ligature.components.length; component++) {
        if (!glyphIds.has(ligature.components[component]!)) {
          reachable = false
          break
        }
      }
      if (reachable) out.add(ligature.ligatureGlyphId)
    }
  }
}

function collectReachableContextSubstitutions(
  subtable: ContextSubstData,
  lookups: readonly ParsedGsubLookup[],
  glyphIds: ReadonlySet<number>,
  out: Set<number>,
  activeLookups: Set<number>,
): void {
  for (let ruleIndex = 0; ruleIndex < subtable.rules.length; ruleIndex++) {
    const rule = subtable.rules[ruleIndex]!
    if (rule.format === 1) {
      for (const [first, records] of rule.rulesByGlyph!) {
        if (!glyphIds.has(first)) continue
        for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
          const record = records[recordIndex]!
          if (allGlyphsPresent(record.sequence, glyphIds)) {
            collectNestedLookupSubstitutions(record.lookups, lookups, glyphIds, out, activeLookups)
          }
        }
      }
    } else if (rule.format === 2) {
      const coverageMap = rule.coverageMap!
      const classDef = rule.classDef!
      for (const [firstClass, records] of rule.rulesByClass!) {
        if (!classIntersectsGlyphs(firstClass, classDef, coverageMap, glyphIds)) continue
        for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
          const record = records[recordIndex]!
          if (allClassesIntersect(record.sequence, classDef, null, glyphIds)) {
            collectNestedLookupSubstitutions(record.lookups, lookups, glyphIds, out, activeLookups)
          }
        }
      }
    } else if (allCoveragesIntersect(rule.coverages!, glyphIds)) {
      collectNestedLookupSubstitutions(rule.lookups!, lookups, glyphIds, out, activeLookups)
    }
  }
}

function collectReachableChainContextSubstitutions(
  subtable: ChainContextSubstData,
  lookups: readonly ParsedGsubLookup[],
  glyphIds: ReadonlySet<number>,
  out: Set<number>,
  activeLookups: Set<number>,
): void {
  for (let ruleIndex = 0; ruleIndex < subtable.rules.length; ruleIndex++) {
    const rule = subtable.rules[ruleIndex]!
    if (rule.format === 1) {
      for (const [first, records] of rule.rulesByGlyph!) {
        if (!glyphIds.has(first)) continue
        for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
          const record = records[recordIndex]!
          if (!allGlyphsPresent(record.backtrack, glyphIds)
            || !allGlyphsPresent(record.input, glyphIds)
            || !allGlyphsPresent(record.lookahead, glyphIds)) continue
          collectNestedLookupSubstitutions(record.lookups, lookups, glyphIds, out, activeLookups)
        }
      }
    } else if (rule.format === 2) {
      const coverageMap = rule.coverageMap!
      const inputClassDef = rule.inputClassDef!
      for (const [firstClass, records] of rule.rulesByClass!) {
        if (!classIntersectsGlyphs(firstClass, inputClassDef, coverageMap, glyphIds)) continue
        for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
          const record = records[recordIndex]!
          if (!allClassesIntersect(record.backtrack, rule.backtrackClassDef!, null, glyphIds)
            || !allClassesIntersect(record.input, inputClassDef, null, glyphIds)
            || !allClassesIntersect(record.lookahead, rule.lookaheadClassDef!, null, glyphIds)) continue
          collectNestedLookupSubstitutions(record.lookups, lookups, glyphIds, out, activeLookups)
        }
      }
    } else if (allCoveragesIntersect(rule.backtrackCoverages!, glyphIds)
      && allCoveragesIntersect(rule.inputCoverages!, glyphIds)
      && allCoveragesIntersect(rule.lookaheadCoverages!, glyphIds)) {
      collectNestedLookupSubstitutions(rule.lookups!, lookups, glyphIds, out, activeLookups)
    }
  }
}

function collectNestedLookupSubstitutions(
  records: readonly SubstLookupRecord[],
  lookups: readonly ParsedGsubLookup[],
  glyphIds: ReadonlySet<number>,
  out: Set<number>,
  activeLookups: Set<number>,
): void {
  for (let i = 0; i < records.length; i++) {
    collectReachableLookupSubstitutions(
      lookups,
      records[i]!.lookupListIndex,
      glyphIds,
      out,
      activeLookups,
    )
  }
}

function allGlyphsPresent(glyphs: readonly number[], glyphIds: ReadonlySet<number>): boolean {
  for (let i = 0; i < glyphs.length; i++) {
    if (!glyphIds.has(glyphs[i]!)) return false
  }
  return true
}

function allClassesIntersect(
  classes: readonly number[],
  classDef: ReadonlyMap<number, number>,
  coverage: ReadonlyMap<number, number> | null,
  glyphIds: ReadonlySet<number>,
): boolean {
  for (let i = 0; i < classes.length; i++) {
    if (!classIntersectsGlyphs(classes[i]!, classDef, coverage, glyphIds)) return false
  }
  return true
}

function classIntersectsGlyphs(
  glyphClass: number,
  classDef: ReadonlyMap<number, number>,
  coverage: ReadonlyMap<number, number> | null,
  glyphIds: ReadonlySet<number>,
): boolean {
  for (const glyphId of glyphIds) {
    if ((coverage === null || coverage.has(glyphId)) && (classDef.get(glyphId) ?? 0) === glyphClass) return true
  }
  return false
}

function allCoveragesIntersect(coverages: Map<number, number>[], glyphIds: ReadonlySet<number>): boolean {
  for (const coverage of coverages) {
    let matched = false
    for (const gid of coverage.keys()) {
      if (glyphIds.has(gid)) {
        matched = true
        break
      }
    }
    if (!matched) return false
  }
  return true
}

// --- Lookup parsing ---

function parseLookup(reader: BinaryReader, lookup: LookupInfo, lookupCount: number): ParsedGsubLookup {
  const subtables: SubtableData[] = []
  let extensionLookupType = -1

  for (const stOffset of lookup.subtableOffsets) {
    const { actualType, actualStart } = resolveExtension(reader, stOffset, lookup.type, 7)
    if (lookup.type === 7) {
      if (extensionLookupType < 0) {
        extensionLookupType = actualType
      } else if (extensionLookupType !== actualType) {
        throw new Error(`GSUB ExtensionSubst subtables must use the same extensionLookupType: ${extensionLookupType} != ${actualType}`)
      }
    }

    reader.seek(actualStart)
    const subtable = parseSubtable(reader, actualType, actualStart, lookupCount)
    if (subtable) subtables.push(subtable)
  }

  // Determine actual type from first subtable or lookup type
  const resolvedType = subtables.length > 0
    ? (lookup.type === 7 ? subtables[0]!.kind : lookup.type)
    : lookup.type

  return { type: resolvedType, flag: lookup.flag, markFilteringSet: lookup.markFilteringSet, subtables }
}

function parseSubtable(
  reader: BinaryReader,
  type: number,
  subtableStart: number,
  lookupCount: number,
): SubtableData | null {
  switch (type) {
    case 1: return parseSingleSubst(reader, subtableStart)
    case 2: return parseMultipleSubst(reader, subtableStart)
    case 3: return parseAlternateSubst(reader, subtableStart)
    case 4: return parseLigatureSubst(reader, subtableStart)
    case 5: return parseContextSubst(reader, subtableStart, lookupCount)
    case 6: return parseChainContextSubst(reader, subtableStart, lookupCount)
    case 8: return parseReverseChainSubst(reader, subtableStart)
    default: throw new Error(`Unsupported GSUB lookup type: ${type}`)
  }
}

// --- Type 1: SingleSubst ---

function parseSingleSubst(reader: BinaryReader, subtableStart: number): SingleSubstData {
  const substFormat = reader.readUint16()
  if (substFormat !== 1 && substFormat !== 2) {
    throw new Error(`Unsupported SingleSubst format: ${substFormat}`)
  }
  const coverageOffset = reader.readUint16()
  const mapping = new Map<number, number>()

  if (substFormat === 1) {
    const deltaGlyphId = reader.readInt16()
    const coverageGlyphs = parseCoverage(reader, subtableStart + coverageOffset)
    for (const gid of coverageGlyphs) {
      mapping.set(gid, (gid + deltaGlyphId) & 0xFFFF)
    }
  } else if (substFormat === 2) {
    const glyphCount = reader.readUint16()
    const substituteGlyphs: number[] = []
    for (let i = 0; i < glyphCount; i++) {
      substituteGlyphs.push(reader.readUint16())
    }
    const coverageGlyphs = parseCoverage(reader, subtableStart + coverageOffset)
    for (let i = 0; i < coverageGlyphs.length && i < substituteGlyphs.length; i++) {
      mapping.set(coverageGlyphs[i]!, substituteGlyphs[i]!)
    }
  }

  return { kind: 1, mapping }
}

// --- Type 2: MultipleSubst ---

function parseMultipleSubst(reader: BinaryReader, subtableStart: number): MultipleSubstData {
  const substFormat = reader.readUint16()
  if (substFormat !== 1) {
    throw new Error(`Unsupported MultipleSubst format: ${substFormat}`)
  }
  const coverageOffset = reader.readUint16()
  const mapping = new Map<number, number[]>()

  const sequenceCount = reader.readUint16()
  const sequenceOffsets: number[] = []
  for (let i = 0; i < sequenceCount; i++) {
    sequenceOffsets.push(reader.readUint16())
  }

  const coverageGlyphs = parseCoverage(reader, subtableStart + coverageOffset)

  for (let i = 0; i < sequenceCount && i < coverageGlyphs.length; i++) {
    reader.seek(subtableStart + sequenceOffsets[i]!)
    const glyphCount = reader.readUint16()
    const substituteGlyphs: number[] = []
    for (let j = 0; j < glyphCount; j++) {
      substituteGlyphs.push(reader.readUint16())
    }
    mapping.set(coverageGlyphs[i]!, substituteGlyphs)
  }

  return { kind: 2, mapping }
}

// --- Type 3: AlternateSubst ---

function parseAlternateSubst(reader: BinaryReader, subtableStart: number): AlternateSubstData {
  const substFormat = reader.readUint16()
  if (substFormat !== 1) {
    throw new Error(`Unsupported AlternateSubst format: ${substFormat}`)
  }
  const coverageOffset = reader.readUint16()
  const mapping = new Map<number, number[]>()

  const alternateSetCount = reader.readUint16()
  const alternateSetOffsets: number[] = []
  for (let i = 0; i < alternateSetCount; i++) {
    alternateSetOffsets.push(reader.readUint16())
  }

  const coverageGlyphs = parseCoverage(reader, subtableStart + coverageOffset)

  for (let i = 0; i < alternateSetCount && i < coverageGlyphs.length; i++) {
    reader.seek(subtableStart + alternateSetOffsets[i]!)
    const glyphCount = reader.readUint16()
    const alternateGlyphs: number[] = []
    for (let j = 0; j < glyphCount; j++) {
      alternateGlyphs.push(reader.readUint16())
    }
    mapping.set(coverageGlyphs[i]!, alternateGlyphs)
  }

  return { kind: 3, mapping }
}

// --- Type 4: LigatureSubst ---

function parseLigatureSubst(reader: BinaryReader, subtableStart: number): LigatureSubstData {
  const substFormat = reader.readUint16()
  if (substFormat !== 1) {
    throw new Error(`Unsupported LigatureSubst format: ${substFormat}`)
  }
  const ligatures = new Map<number, { components: number[], ligatureGlyphId: number }[]>()

  const coverageOffset = reader.readUint16()
  const ligatureSetCount = reader.readUint16()
  const ligatureSetOffsets: number[] = []
  for (let i = 0; i < ligatureSetCount; i++) {
    ligatureSetOffsets.push(reader.readUint16())
  }

  const coverageGlyphs = parseCoverage(reader, subtableStart + coverageOffset)

  for (let i = 0; i < ligatureSetCount; i++) {
    if (i >= coverageGlyphs.length) break
    const firstGlyph = coverageGlyphs[i]!
    const setOffset = subtableStart + ligatureSetOffsets[i]!
    reader.seek(setOffset)

    const ligatureCount = reader.readUint16()
    const ligOffsets: number[] = []
    for (let j = 0; j < ligatureCount; j++) {
      ligOffsets.push(reader.readUint16())
    }

    const ligList: { components: number[], ligatureGlyphId: number }[] = []

    for (const ligOff of ligOffsets) {
      reader.seek(setOffset + ligOff)
      const ligatureGlyphId = reader.readUint16()
      const componentCount = reader.readUint16()
      const components: number[] = []
      for (let c = 1; c < componentCount; c++) {
        components.push(reader.readUint16())
      }
      ligList.push({ ligatureGlyphId, components })
    }

    const existing = ligatures.get(firstGlyph) ?? []
    existing.push(...ligList)
    ligatures.set(firstGlyph, existing)
  }

  return { kind: 4, ligatures }
}

// --- Type 5: ContextSubst ---

function parseContextSubst(reader: BinaryReader, subtableStart: number, lookupCount: number): ContextSubstData {
  const format = reader.readUint16()
  const rules: ContextRule[] = []

  if (format === 1) {
    const coverageOffset = reader.readUint16()
    const ruleSetCount = reader.readUint16()
    const ruleSetOffsets: number[] = []
    for (let i = 0; i < ruleSetCount; i++) {
      ruleSetOffsets.push(reader.readUint16())
    }

    const coverageGlyphs = parseCoverage(reader, subtableStart + coverageOffset)
    const rulesByGlyph = new Map<number, { sequence: number[], lookups: SubstLookupRecord[] }[]>()

    for (let i = 0; i < ruleSetCount && i < coverageGlyphs.length; i++) {
      if (ruleSetOffsets[i] === 0) continue
      const ruleSetBase = subtableStart + ruleSetOffsets[i]!
      reader.seek(ruleSetBase)
      const ruleCount = reader.readUint16()
      const ruleOffsets: number[] = []
      for (let j = 0; j < ruleCount; j++) {
        ruleOffsets.push(reader.readUint16())
      }

      const ruleList: { sequence: number[], lookups: SubstLookupRecord[] }[] = []
      for (const rOff of ruleOffsets) {
        reader.seek(ruleSetBase + rOff)
        const glyphCount = reader.readUint16()
        const substCount = reader.readUint16()
        const sequence: number[] = []
        for (let g = 1; g < glyphCount; g++) sequence.push(reader.readUint16())
        const lookups = readSubstLookupRecords(reader, substCount, lookupCount)
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
    const rulesByClass = new Map<number, { sequence: number[], lookups: SubstLookupRecord[] }[]>()

    for (let ci = 0; ci < classSetCount; ci++) {
      if (classSetOffsets[ci] === 0) continue
      const classSetBase = subtableStart + classSetOffsets[ci]!
      reader.seek(classSetBase)
      const ruleCount = reader.readUint16()
      const ruleOffsets: number[] = []
      for (let j = 0; j < ruleCount; j++) {
        ruleOffsets.push(reader.readUint16())
      }

      const ruleList: { sequence: number[], lookups: SubstLookupRecord[] }[] = []
      for (const rOff of ruleOffsets) {
        reader.seek(classSetBase + rOff)
        const glyphCount = reader.readUint16()
        const substCount = reader.readUint16()
        const sequence: number[] = []
        for (let g = 1; g < glyphCount; g++) sequence.push(reader.readUint16())
        const lookups = readSubstLookupRecords(reader, substCount, lookupCount)
        ruleList.push({ sequence, lookups })
      }
      rulesByClass.set(ci, ruleList)
    }

    rules.push({ format: 2, coverageMap, classDef, rulesByClass })

  } else if (format === 3) {
    const glyphCount = reader.readUint16()
    const substCount = reader.readUint16()
    const coverageOffsets: number[] = []
    for (let i = 0; i < glyphCount; i++) {
      coverageOffsets.push(reader.readUint16())
    }
    const lookups = readSubstLookupRecords(reader, substCount, lookupCount)
    const coverages = coverageOffsets.map(off => parseCoverageMap(reader, subtableStart + off))
    rules.push({ format: 3, coverages, lookups })
  } else {
    throw new Error(`Unsupported ContextSubst format: ${format}`)
  }

  return { kind: 5, format, rules }
}

// --- Type 6: ChainContextSubst ---

function parseChainContextSubst(reader: BinaryReader, subtableStart: number, lookupCount: number): ChainContextSubstData {
  const format = reader.readUint16()
  const rules: ChainContextRule[] = []

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
      backtrack: number[], input: number[], lookahead: number[], lookups: SubstLookupRecord[]
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
        backtrack: number[], input: number[], lookahead: number[], lookups: SubstLookupRecord[]
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

        const substCount = reader.readUint16()
        const lookups = readSubstLookupRecords(reader, substCount, lookupCount)
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
      backtrack: number[], input: number[], lookahead: number[], lookups: SubstLookupRecord[]
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
        backtrack: number[], input: number[], lookahead: number[], lookups: SubstLookupRecord[]
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

        const substCount = reader.readUint16()
        const lookups = readSubstLookupRecords(reader, substCount, lookupCount)
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

    const substCount = reader.readUint16()
    const lookups = readSubstLookupRecords(reader, substCount, lookupCount)

    const backtrackCoverages = backtrackOffsets.map(off => parseCoverageMap(reader, subtableStart + off))
    const inputCoverages = inputOffsets.map(off => parseCoverageMap(reader, subtableStart + off))
    const lookaheadCoverages = lookaheadOffsets.map(off => parseCoverageMap(reader, subtableStart + off))

    rules.push({ format: 3, backtrackCoverages, inputCoverages, lookaheadCoverages, lookups })
  } else {
    throw new Error(`Unsupported ChainContextSubst format: ${format}`)
  }

  return { kind: 6, format, rules }
}

// --- Type 8: ReverseChainContextSingleSubst ---

function parseReverseChainSubst(reader: BinaryReader, subtableStart: number): ReverseChainSubstData {
  const format = reader.readUint16() // always 1
  if (format !== 1) {
    throw new Error(`Unsupported ReverseChainSubst format: ${format}`)
  }
  const coverageOffset = reader.readUint16()

  const backtrackCount = reader.readUint16()
  const backtrackOffsets: number[] = []
  for (let i = 0; i < backtrackCount; i++) backtrackOffsets.push(reader.readUint16())

  const lookaheadCount = reader.readUint16()
  const lookaheadOffsets: number[] = []
  for (let i = 0; i < lookaheadCount; i++) lookaheadOffsets.push(reader.readUint16())

  const glyphCount = reader.readUint16()
  const substituteGlyphs: number[] = []
  for (let i = 0; i < glyphCount; i++) {
    substituteGlyphs.push(reader.readUint16())
  }

  const coverage = parseCoverageMap(reader, subtableStart + coverageOffset)
  const backtrackCoverages = backtrackOffsets.map(off => parseCoverageMap(reader, subtableStart + off))
  const lookaheadCoverages = lookaheadOffsets.map(off => parseCoverageMap(reader, subtableStart + off))

  return { kind: 8, coverage, backtrackCoverages, lookaheadCoverages, substituteGlyphs }
}

// --- Substitution Lookup Record ---

function readSubstLookupRecords(reader: BinaryReader, count: number, lookupCount: number): SubstLookupRecord[] {
  const records: SubstLookupRecord[] = []
  for (let i = 0; i < count; i++) {
    const sequenceIndex = reader.readUint16()
    const lookupListIndex = reader.readUint16()
    if (lookupListIndex >= lookupCount) {
      throw new Error(`GSUB contextual lookup index ${lookupListIndex} out of LookupList range ${lookupCount}`)
    }
    records.push({ sequenceIndex, lookupListIndex })
  }
  return records
}

interface SerializedGsubSubtable { type: number, data: Uint8Array }

/** Rebuilds GSUB for a compact glyph-ID mapping while preserving feature and lookup indices. */
export function buildCompactGsubTable(
  reader: BinaryReader,
  oldToNew: ReadonlyMap<number, number>,
  bakeCoords?: number[],
  expectedAxisCount?: number,
): Uint8Array {
  reader.seek(0)
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const scriptListOffset = reader.readUint16()
  const featureListOffset = reader.readUint16()
  const lookupListOffset = reader.readUint16()
  const featureVariationsOffset = minorVersion >= 1 ? reader.readUint32() : 0
  if (majorVersion !== 1) throw new Error(`Unsupported GSUB version: ${majorVersion}.${minorVersion}`)
  const lookups = parseLookupList(reader, 0, lookupListOffset)
  const parsedLookups = new Array<ParsedGsubLookup>(lookups.length)
  for (let i = 0; i < lookups.length; i++) parsedLookups[i] = parseLookup(reader, lookups[i]!, lookups.length)
  const lookupData = serializeGsubLookupList(parsedLookups, oldToNew)
  const featureCount = featureListOffset === 0 ? 0 : getFeatureListCount(reader, 0, featureListOffset)
  let substitutions: ReadonlyMap<number, number> | null = null
  if (bakeCoords !== undefined && featureVariationsOffset !== 0) {
    const variations = parseFeatureVariations(
      reader,
      featureVariationsOffset,
      featureCount,
      lookups.length,
      expectedAxisCount,
    )
    substitutions = resolveFeatureVariationSubstitution(variations, bakeCoords)
  }
  const scriptData = buildStaticScriptList(reader, scriptListOffset, featureCount)
  const featureData = buildStaticFeatureList(reader, featureListOffset, substitutions, lookups.length)
  const headerSize = 10
  const scriptOutputOffset = scriptData === null ? 0 : headerSize
  const featureOutputOffset = featureListOffset === 0 ? 0 : headerSize + (scriptData?.length ?? 0)
  const lookupOutputOffset = headerSize + (scriptData?.length ?? 0) + featureData.length
  assertOffset16(scriptOutputOffset, 'GSUB ScriptList')
  assertOffset16(featureOutputOffset, 'GSUB FeatureList')
  assertOffset16(lookupOutputOffset, 'GSUB LookupList')
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

function serializeGsubLookupList(
  lookups: readonly ParsedGsubLookup[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const serialized = new Array<SerializedGsubSubtable[]>(lookups.length)
  for (let lookupIndex = 0; lookupIndex < lookups.length; lookupIndex++) {
    const lookup = lookups[lookupIndex]!
    const subtables: SerializedGsubSubtable[] = []
    for (let i = 0; i < lookup.subtables.length; i++) {
      const built = serializeGsubSubtable(lookup.subtables[i]!, oldToNew)
      for (let j = 0; j < built.length; j++) subtables.push({ type: lookup.subtables[i]!.kind, data: built[j]! })
    }
    if (subtables.length === 0) subtables.push({ type: 1, data: serializeSingleSubst(new Map(), oldToNew) })
    serialized[lookupIndex] = subtables
  }

  const writer = new BinaryWriter()
  writer.writeUint16(lookups.length)
  const lookupOffsetPositions = new Array<number>(lookups.length)
  for (let i = 0; i < lookups.length; i++) { lookupOffsetPositions[i] = writer.position; writer.writeUint16(0) }
  const extensionRecords: Array<{ offsetPosition: number, extensionStart: number, data: Uint8Array }> = []
  for (let lookupIndex = 0; lookupIndex < lookups.length; lookupIndex++) {
    const lookupStart = writer.position
    assertOffset16(lookupStart, `GSUB Lookup ${lookupIndex}`)
    patchUint16(writer, lookupOffsetPositions[lookupIndex]!, lookupStart)
    const lookup = lookups[lookupIndex]!
    const subtables = serialized[lookupIndex]!
    writer.writeUint16(7)
    writer.writeUint16(lookup.flag)
    writer.writeUint16(subtables.length)
    const subtableOffsetPositions = new Array<number>(subtables.length)
    for (let i = 0; i < subtables.length; i++) { subtableOffsetPositions[i] = writer.position; writer.writeUint16(0) }
    if ((lookup.flag & 0x0010) !== 0) writer.writeUint16(lookup.markFilteringSet!)
    for (let i = 0; i < subtables.length; i++) {
      const extensionStart = writer.position
      assertOffset16(extensionStart - lookupStart, `GSUB Lookup ${lookupIndex} extension ${i}`)
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
    const payloadStart = writer.position
    patchUint32(writer, record.offsetPosition, payloadStart - record.extensionStart)
    writer.writeBytes(record.data)
  }
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeGsubSubtable(
  subtable: SubtableData,
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array[] {
  switch (subtable.kind) {
    case 1: return [serializeSingleSubst(subtable.mapping, oldToNew)]
    case 2: return [serializeMultipleOrAlternateSubst(subtable.mapping, oldToNew, false)]
    case 3: return [serializeMultipleOrAlternateSubst(subtable.mapping, oldToNew, true)]
    case 4: return [serializeLigatureSubst(subtable.ligatures, oldToNew)]
    case 5: return serializeContextSubst(subtable, oldToNew)
    case 6: return serializeChainContextSubst(subtable, oldToNew)
    case 8: return [serializeReverseChainSubst(subtable, oldToNew)]
  }
}

function serializeSingleSubst(mapping: ReadonlyMap<number, number>, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const entries: Array<{ source: number, target: number }> = []
  for (const [source, target] of mapping) {
    const newSource = oldToNew.get(source)
    const newTarget = oldToNew.get(target)
    if (newSource !== undefined && newTarget !== undefined) entries.push({ source: newSource, target: newTarget })
  }
  entries.sort(function (left, right) { return left.source - right.source })
  const writer = new BinaryWriter()
  writer.writeUint16(2)
  const coverageOffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(entries.length)
  for (let i = 0; i < entries.length; i++) writer.writeUint16(entries[i]!.target)
  patchUint16(writer, coverageOffsetPosition, writer.position)
  writeCoverage(writer, entries.map(function (entry) { return entry.source }))
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeMultipleOrAlternateSubst(
  mapping: ReadonlyMap<number, number[]>,
  oldToNew: ReadonlyMap<number, number>,
  alternate: boolean,
): Uint8Array {
  const entries: Array<{ source: number, targets: number[] }> = []
  for (const [source, targets] of mapping) {
    const newSource = oldToNew.get(source)
    if (newSource === undefined) continue
    const remapped: number[] = []
    for (let i = 0; i < targets.length; i++) {
      const target = oldToNew.get(targets[i]!)
      if (target !== undefined) remapped.push(target)
    }
    if (alternate ? remapped.length > 0 : remapped.length === targets.length) entries.push({ source: newSource, targets: remapped })
  }
  entries.sort(function (left, right) { return left.source - right.source })
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const coverageOffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(entries.length)
  const sequenceOffsetPositions = new Array<number>(entries.length)
  for (let i = 0; i < entries.length; i++) { sequenceOffsetPositions[i] = writer.position; writer.writeUint16(0) }
  for (let i = 0; i < entries.length; i++) {
    patchUint16(writer, sequenceOffsetPositions[i]!, writer.position)
    writer.writeUint16(entries[i]!.targets.length)
    for (let j = 0; j < entries[i]!.targets.length; j++) writer.writeUint16(entries[i]!.targets[j]!)
  }
  patchUint16(writer, coverageOffsetPosition, writer.position)
  writeCoverage(writer, entries.map(function (entry) { return entry.source }))
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeLigatureSubst(
  ligatures: ReadonlyMap<number, { components: number[], ligatureGlyphId: number }[]>,
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const entries: Array<{ source: number, ligatures: Array<{ components: number[], glyph: number }> }> = []
  for (const [source, sourceLigatures] of ligatures) {
    const newSource = oldToNew.get(source)
    if (newSource === undefined) continue
    const retained: Array<{ components: number[], glyph: number }> = []
    for (let i = 0; i < sourceLigatures.length; i++) {
      const ligature = sourceLigatures[i]!
      const glyph = oldToNew.get(ligature.ligatureGlyphId)
      if (glyph === undefined) continue
      const components: number[] = []
      let complete = true
      for (let j = 0; j < ligature.components.length; j++) {
        const component = oldToNew.get(ligature.components[j]!)
        if (component === undefined) { complete = false; break }
        components.push(component)
      }
      if (complete) retained.push({ components, glyph })
    }
    if (retained.length > 0) entries.push({ source: newSource, ligatures: retained })
  }
  entries.sort(function (left, right) { return left.source - right.source })
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const coverageOffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(entries.length)
  const setOffsetPositions = new Array<number>(entries.length)
  for (let i = 0; i < entries.length; i++) { setOffsetPositions[i] = writer.position; writer.writeUint16(0) }
  for (let i = 0; i < entries.length; i++) {
    const setStart = writer.position
    patchUint16(writer, setOffsetPositions[i]!, setStart)
    const set = entries[i]!.ligatures
    writer.writeUint16(set.length)
    const ligatureOffsetPositions = new Array<number>(set.length)
    for (let j = 0; j < set.length; j++) { ligatureOffsetPositions[j] = writer.position; writer.writeUint16(0) }
    for (let j = 0; j < set.length; j++) {
      patchUint16(writer, ligatureOffsetPositions[j]!, writer.position - setStart)
      writer.writeUint16(set[j]!.glyph)
      writer.writeUint16(set[j]!.components.length + 1)
      for (let k = 0; k < set[j]!.components.length; k++) writer.writeUint16(set[j]!.components[k]!)
    }
  }
  patchUint16(writer, coverageOffsetPosition, writer.position)
  writeCoverage(writer, entries.map(function (entry) { return entry.source }))
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeContextSubst(subtable: ContextSubstData, oldToNew: ReadonlyMap<number, number>): Uint8Array[] {
  const result: Uint8Array[] = []
  const rule = subtable.rules[0]!
  if (rule.format === 1) {
    for (const [first, rules] of rule.rulesByGlyph!) {
      const firstGlyph = oldToNew.get(first)
      if (firstGlyph === undefined) continue
      for (let i = 0; i < rules.length; i++) {
        const current = rules[i]!
        const coverages: number[][] = [[firstGlyph]]
        let complete = true
        for (let j = 0; j < current.sequence.length; j++) {
          const glyph = oldToNew.get(current.sequence[j]!)
          if (glyph === undefined) { complete = false; break }
          coverages.push([glyph])
        }
        if (complete) result.push(writeContextFormat3(coverages, current.lookups))
      }
    }
  } else if (rule.format === 2) {
    for (const [firstClass, rules] of rule.rulesByClass!) {
      const firstCoverage = remapCoverageForClass(rule.coverageMap!, rule.classDef!, firstClass, oldToNew)
      if (firstCoverage.length === 0) continue
      for (let i = 0; i < rules.length; i++) {
        const current = rules[i]!
        const coverages: number[][] = [firstCoverage]
        let complete = true
        for (let j = 0; j < current.sequence.length; j++) {
          const coverage = remapClass(rule.classDef!, current.sequence[j]!, oldToNew)
          if (coverage.length === 0) { complete = false; break }
          coverages.push(coverage)
        }
        if (complete) result.push(writeContextFormat3(coverages, current.lookups))
      }
    }
  } else {
    const coverages = remapCoverages(rule.coverages!, oldToNew)
    if (allCoveragesNonempty(coverages)) result.push(writeContextFormat3(coverages, rule.lookups!))
  }
  return result
}

function writeContextFormat3(coverages: readonly number[][], lookups: readonly SubstLookupRecord[]): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(3)
  writer.writeUint16(coverages.length)
  writer.writeUint16(lookups.length)
  const offsetPositions = new Array<number>(coverages.length)
  for (let i = 0; i < coverages.length; i++) { offsetPositions[i] = writer.position; writer.writeUint16(0) }
  writeSubstLookupRecords(writer, lookups)
  for (let i = 0; i < coverages.length; i++) {
    patchUint16(writer, offsetPositions[i]!, writer.position)
    writeCoverage(writer, coverages[i]!)
  }
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeChainContextSubst(
  subtable: ChainContextSubstData,
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array[] {
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
        if (backtrack === null || input === null || lookahead === null) continue
        result.push(writeChainContextFormat3(backtrack, [[firstGlyph], ...input], lookahead, current.lookups))
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
        if (backtrack === null || input === null || lookahead === null) continue
        result.push(writeChainContextFormat3(backtrack, [firstCoverage, ...input], lookahead, current.lookups))
      }
    }
  } else {
    const backtrack = remapCoverages(rule.backtrackCoverages!, oldToNew)
    const input = remapCoverages(rule.inputCoverages!, oldToNew)
    const lookahead = remapCoverages(rule.lookaheadCoverages!, oldToNew)
    if (allCoveragesNonempty(backtrack) && allCoveragesNonempty(input) && allCoveragesNonempty(lookahead)) {
      result.push(writeChainContextFormat3(backtrack, input, lookahead, rule.lookups!))
    }
  }
  return result
}

function writeChainContextFormat3(
  backtrack: readonly number[][],
  input: readonly number[][],
  lookahead: readonly number[][],
  lookups: readonly SubstLookupRecord[],
): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(3)
  writer.writeUint16(backtrack.length)
  const backtrackOffsets = reserveUint16(writer, backtrack.length)
  writer.writeUint16(input.length)
  const inputOffsets = reserveUint16(writer, input.length)
  writer.writeUint16(lookahead.length)
  const lookaheadOffsets = reserveUint16(writer, lookahead.length)
  writer.writeUint16(lookups.length)
  writeSubstLookupRecords(writer, lookups)
  writeCoverageArray(writer, backtrack, backtrackOffsets)
  writeCoverageArray(writer, input, inputOffsets)
  writeCoverageArray(writer, lookahead, lookaheadOffsets)
  return new Uint8Array(writer.toArrayBuffer())
}

function serializeReverseChainSubst(
  subtable: ReverseChainSubstData,
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const sourceEntries = [...subtable.coverage.entries()].sort(function (left, right) { return left[1] - right[1] })
  const sources: number[] = []
  const substitutes: number[] = []
  for (let i = 0; i < sourceEntries.length; i++) {
    const source = oldToNew.get(sourceEntries[i]![0])
    const substitute = oldToNew.get(subtable.substituteGlyphs[sourceEntries[i]![1]]!)
    if (source !== undefined && substitute !== undefined) {
      sources.push(source)
      substitutes.push(substitute)
    }
  }
  const backtrack = remapCoverages(subtable.backtrackCoverages, oldToNew)
  const lookahead = remapCoverages(subtable.lookaheadCoverages, oldToNew)
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  const coverageOffsetPosition = writer.position; writer.writeUint16(0)
  writer.writeUint16(backtrack.length)
  const backtrackOffsets = reserveUint16(writer, backtrack.length)
  writer.writeUint16(lookahead.length)
  const lookaheadOffsets = reserveUint16(writer, lookahead.length)
  writer.writeUint16(sources.length)
  for (let i = 0; i < substitutes.length; i++) writer.writeUint16(substitutes[i]!)
  patchUint16(writer, coverageOffsetPosition, writer.position)
  writeCoverage(writer, sources)
  writeCoverageArray(writer, backtrack, backtrackOffsets)
  writeCoverageArray(writer, lookahead, lookaheadOffsets)
  return new Uint8Array(writer.toArrayBuffer())
}

function remapGlyphSequenceAsCoverages(
  glyphs: readonly number[],
  oldToNew: ReadonlyMap<number, number>,
): number[][] | null {
  const result: number[][] = []
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = oldToNew.get(glyphs[i]!)
    if (glyph === undefined) return null
    result.push([glyph])
  }
  return result
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
    const glyphs: number[] = []
    for (const oldGlyph of coverages[i]!.keys()) {
      const newGlyph = oldToNew.get(oldGlyph)
      if (newGlyph !== undefined) glyphs.push(newGlyph)
    }
    glyphs.sort(function (left, right) { return left - right })
    result[i] = glyphs
  }
  return result
}

function allCoveragesNonempty(coverages: readonly number[][]): boolean {
  for (let i = 0; i < coverages.length; i++) if (coverages[i]!.length === 0) return false
  return true
}

function writeSubstLookupRecords(writer: BinaryWriter, records: readonly SubstLookupRecord[]): void {
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
  writer.writeUint16(1)
  writer.writeUint16(glyphs.length)
  for (let i = 0; i < glyphs.length; i++) writer.writeUint16(glyphs[i]!)
}

function assertOffset16(value: number, label: string): void {
  if (value < 0 || value > 0xFFFF) throw new Error(`${label} offset ${value} exceeds Offset16`)
}

function patchUint16(writer: BinaryWriter, offset: number, value: number): void {
  assertOffset16(value, 'OpenType')
  const end = writer.position
  writer.position = offset
  writer.writeUint16(value)
  writer.position = end
}

function patchUint32(writer: BinaryWriter, offset: number, value: number): void {
  const end = writer.position
  writer.position = offset
  writer.writeUint32(value)
  writer.position = end
}

// --- Lookup application ---

/**
 * Working buffer for substitution: the glyph sequence plus optional parallel
 * arrays kept aligned with it. All optional arrays are null on the plain
 * (non-shaper) path.
 *
 * - masks: per-glyph feature mask; a lookup applies at a glyph only when
 *   (lookupMask & masks[i]) != 0. The Arabic joining path stores
 *   1 << joiningPosition; shapers store a global bit plus feature bits.
 * - clusters: source code points covered by each glyph (0 = continuation).
 * - syllables: syllable serial; per-syllable lookups never match across
 *   glyphs with different syllable values.
 * - aux: shaper-defined per-glyph value (category/position packing), carried
 *   through substitutions like masks (ligatures keep the first glyph's value,
 *   expanded glyphs inherit the source value).
 * - flags: GLYPH_FLAG_* substitution-result flags maintained by the engine.
 */
export interface GsubShapingBuffer {
  glyphs: number[]
  masks: number[] | null
  /** Active OpenType feature value for the lookup currently being applied. */
  lookupValues?: number[] | null
  clusters: number[] | null
  sourceClusters?: number[] | null
  syllables: number[] | null
  aux: number[] | null
  flags: number[] | null
  ligatureMarkComponents?: number[] | null
}

type GsubBuffer = GsubShapingBuffer

/** Glyph was replaced by any substitution. */
export const GLYPH_FLAG_SUBSTITUTED = 1
/** Glyph is the result of a ligature substitution. */
export const GLYPH_FLAG_LIGATED = 2
/** Glyph is the result of a one-to-many (multiple) substitution. */
export const GLYPH_FLAG_MULTIPLIED = 4
/** Glyph originates from a Unicode Default_Ignorable_Code_Point. */
export const GLYPH_FLAG_DEFAULT_IGNORABLE = 8

/** Lookup mask matching every glyph mask (all bits set). */
const MASK_ALL = -1

/** Whether the lookup may act at buffer index i (glyph mask + lookupFlag). */
function isLookupTarget(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  i: number,
  posMask: number,
  gdef: GdefTable | null,
): boolean {
  if (buf.lookupValues != null && buf.lookupValues[i] === 0) return false
  if (buf.masks !== null && (posMask & buf.masks[i]!) === 0) return false
  return !lookupIgnoresGlyph(lookup.flag, lookup.markFilteringSet, gdef, buf.glyphs[i]!)
}

/** Whether the lookup skips buffer index i during sequence matching. */
function isSkipped(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  i: number,
  gdef: GdefTable | null,
): boolean {
  return lookupIgnoresGlyph(lookup.flag, lookup.markFilteringSet, gdef, buf.glyphs[i]!)
}

/**
 * Whether buffer index i is acceptable as a matched (non-skipped) sequence
 * glyph under the mask and syllable constraints. Backtrack/lookahead context
 * matching passes MASK_ALL (context glyphs ignore the lookup mask but still
 * respect the syllable constraint).
 */
function matchesConstraints(buf: GsubBuffer, i: number, posMask: number, syllable: number): boolean {
  if (posMask !== MASK_ALL && buf.lookupValues != null && buf.lookupValues[i] === 0) return false
  if (posMask !== MASK_ALL && buf.masks !== null && (posMask & buf.masks[i]!) === 0) return false
  if (syllable !== 0 && buf.syllables !== null && buf.syllables[i] !== syllable) return false
  return true
}

/** Delete one glyph from the buffer (keeps arrays aligned). */
function bufferDelete(buf: GsubBuffer, at: number): void {
  buf.glyphs.splice(at, 1)
  if (buf.masks !== null) buf.masks.splice(at, 1)
  if (buf.lookupValues != null) buf.lookupValues.splice(at, 1)
  if (buf.clusters !== null) buf.clusters.splice(at, 1)
  if (buf.sourceClusters != null) buf.sourceClusters.splice(at, 1)
  if (buf.syllables !== null) buf.syllables.splice(at, 1)
  if (buf.aux !== null) buf.aux.splice(at, 1)
  if (buf.flags !== null) buf.flags.splice(at, 1)
  if (buf.ligatureMarkComponents) buf.ligatureMarkComponents.splice(at, 1)
}

/**
 * Expand one glyph into a sequence (MultipleSubst). Expanded glyphs inherit
 * the mask, syllable and aux value of the source glyph; the first glyph keeps
 * the source cluster size, the rest are continuation glyphs (cluster size 0).
 * An empty sequence deletes the glyph.
 * @returns length delta
 */
function bufferExpand(buf: GsubBuffer, at: number, seq: number[]): number {
  if (seq.length === 0) {
    bufferDelete(buf, at)
    return -1
  }
  buf.glyphs.splice(at, 1, ...seq)
  if (buf.masks !== null) {
    const p = buf.masks[at]!
    const maskSeq: number[] = new Array(seq.length)
    maskSeq.fill(p)
    buf.masks.splice(at, 1, ...maskSeq)
  }
  if (buf.lookupValues != null) {
    const value = buf.lookupValues[at]!
    const values = new Array<number>(seq.length)
    values.fill(value)
    buf.lookupValues.splice(at, 1, ...values)
  }
  if (buf.clusters !== null) {
    const c = buf.clusters[at]!
    const clSeq: number[] = new Array(seq.length)
    clSeq.fill(0)
    clSeq[0] = c
    buf.clusters.splice(at, 1, ...clSeq)
  }
  if (buf.sourceClusters != null) {
    const source = buf.sourceClusters[at]!
    const sourceSeq: number[] = new Array(seq.length)
    sourceSeq.fill(source)
    buf.sourceClusters.splice(at, 1, ...sourceSeq)
  }
  if (buf.syllables !== null) {
    const s = buf.syllables[at]!
    const sySeq: number[] = new Array(seq.length)
    sySeq.fill(s)
    buf.syllables.splice(at, 1, ...sySeq)
  }
  if (buf.aux !== null) {
    const a = buf.aux[at]!
    const auxSeq: number[] = new Array(seq.length)
    auxSeq.fill(a)
    buf.aux.splice(at, 1, ...auxSeq)
  }
  if (buf.flags !== null) {
    const f = buf.flags[at]! | GLYPH_FLAG_SUBSTITUTED | GLYPH_FLAG_MULTIPLIED
    const flSeq: number[] = new Array(seq.length)
    flSeq.fill(f)
    buf.flags.splice(at, 1, ...flSeq)
  }
  if (buf.ligatureMarkComponents) {
    const compSeq: number[] = new Array(seq.length)
    compSeq.fill(-1)
    buf.ligatureMarkComponents.splice(at, 1, ...compSeq)
  }
  return seq.length - 1
}

/**
 * Form a ligature: matchedPositions[0] receives the ligature glyph and the
 * remaining matched positions are removed (skipped glyphs in between stay in
 * place, per the OpenType processing model). The ligature covers the source
 * clusters of every matched component and keeps the first component's mask,
 * syllable and aux values.
 */
function bufferLigate(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  matchedPositions: number[],
  ligatureGlyphId: number,
  gdef: GdefTable | null,
): void {
  const first = matchedPositions[0]!
  buf.glyphs[first] = ligatureGlyphId
  if (buf.ligatureMarkComponents) {
    buf.ligatureMarkComponents[first] = -1
    for (let c = 0; c + 1 < matchedPositions.length; c++) {
      for (let j = matchedPositions[c]! + 1; j < matchedPositions[c + 1]!; j++) {
        if (isSkipped(lookup, buf, j, gdef)) buf.ligatureMarkComponents[j] = c
      }
    }
    const lastComponent = matchedPositions.length - 1
    let j = matchedPositions[lastComponent]! + 1
    while (j < buf.glyphs.length && isSkipped(lookup, buf, j, gdef)) {
      buf.ligatureMarkComponents[j] = lastComponent
      j++
    }
  }
  if (buf.clusters !== null) {
    let clusterSum = 0
    for (let k = 0; k < matchedPositions.length; k++) {
      clusterSum += buf.clusters[matchedPositions[k]!]!
    }
    buf.clusters[first] = clusterSum
  }
  if (buf.sourceClusters != null) {
    let source = buf.sourceClusters[matchedPositions[0]!]!
    for (let i = 1; i < matchedPositions.length; i++) {
      const componentSource = buf.sourceClusters[matchedPositions[i]!]!
      if (componentSource < source) source = componentSource
    }
    buf.sourceClusters[first] = source
  }
  if (buf.flags !== null) {
    buf.flags[first] = buf.flags[first]! | GLYPH_FLAG_SUBSTITUTED | GLYPH_FLAG_LIGATED
  }
  // Remove the consumed components from the end so earlier indices stay valid.
  for (let k = matchedPositions.length - 1; k >= 1; k--) {
    bufferDelete(buf, matchedPositions[k]!)
  }
}

/**
 * Apply one lookup over the whole buffer.
 * @param perSyllable When true, sequence matching is constrained to the
 *                    syllable of the glyph the lookup triggers on.
 */
function applyLookupBuf(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  posMask: number,
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  perSyllable: boolean,
): void {
  switch (lookup.type) {
    case 1: applySingleSubstBuf(lookup, buf, posMask, gdef); break
    case 2: applyMultipleSubstBuf(lookup, buf, posMask, gdef); break
    case 3: applyAlternateSubstBuf(lookup, buf, posMask, gdef); break
    case 4: applyLigatureSubstBuf(lookup, buf, posMask, gdef, perSyllable); break
    case 5: applyContextSubstBuf(lookup, buf, posMask, allLookups, gdef, depth, perSyllable); break
    case 6: applyChainContextSubstBuf(lookup, buf, posMask, allLookups, gdef, depth, perSyllable); break
    case 8: applyReverseChainSubstBuf(lookup, buf, posMask, gdef); break
  }
}

/** Syllable constraint value for a lookup triggering at buffer index i. */
function syllableAt(buf: GsubBuffer, i: number, perSyllable: boolean): number {
  return perSyllable && buf.syllables !== null ? buf.syllables[i]! : 0
}

function applySingleSubstBuf(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  posMask: number,
  gdef: GdefTable | null,
): void {
  const glyphs = buf.glyphs
  for (let i = 0; i < glyphs.length; i++) {
    if (!isLookupTarget(lookup, buf, i, posMask, gdef)) continue
    for (const st of lookup.subtables as SingleSubstData[]) {
      const mapped = st.mapping.get(glyphs[i]!)
      if (mapped !== undefined) {
        glyphs[i] = mapped
        if (buf.flags !== null) buf.flags[i] = buf.flags[i]! | GLYPH_FLAG_SUBSTITUTED
        break
      }
    }
  }
}

function applyMultipleSubstBuf(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  posMask: number,
  gdef: GdefTable | null,
): void {
  for (let i = 0; i < buf.glyphs.length; i++) {
    if (!isLookupTarget(lookup, buf, i, posMask, gdef)) continue
    for (const st of lookup.subtables as MultipleSubstData[]) {
      const mapped = st.mapping.get(buf.glyphs[i]!)
      if (mapped !== undefined) {
        const delta = bufferExpand(buf, i, mapped)
        i += delta >= 0 ? mapped.length - 1 : -1
        break
      }
    }
  }
}

function applyAlternateSubstBuf(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  posMask: number,
  gdef: GdefTable | null,
): void {
  const glyphs = buf.glyphs
  for (let i = 0; i < glyphs.length; i++) {
    if (!isLookupTarget(lookup, buf, i, posMask, gdef)) continue
    for (const st of lookup.subtables as AlternateSubstData[]) {
      const alts = st.mapping.get(glyphs[i]!)
      const alternateIndex = (buf.lookupValues?.[i] ?? 1) - 1
      if (alts && alternateIndex >= 0 && alternateIndex < alts.length) {
        glyphs[i] = alts[alternateIndex]!
        if (buf.flags !== null) buf.flags[i] = buf.flags[i]! | GLYPH_FLAG_SUBSTITUTED
        break
      }
    }
  }
}

/**
 * Match a ligature starting at buffer index `start` (which must hold the first
 * component). Components may be separated by glyphs the lookup skips; matched
 * components must satisfy the lookup mask and syllable constraints.
 * @returns matched buffer positions (start included) or null
 */
function matchLigatureAt(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  start: number,
  components: number[],
  gdef: GdefTable | null,
  posMask: number,
  syllable: number,
): number[] | null {
  const glyphs = buf.glyphs
  const positions: number[] = [start]
  let cur = start
  for (let c = 0; c < components.length; c++) {
    let j = cur + 1
    while (j < glyphs.length && isSkipped(lookup, buf, j, gdef)) j++
    if (j >= glyphs.length || glyphs[j] !== components[c]) return null
    if (!matchesConstraints(buf, j, posMask, syllable)) return null
    positions.push(j)
    cur = j
  }
  return positions
}

function applyLigatureSubstBuf(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  posMask: number,
  gdef: GdefTable | null,
  perSyllable: boolean,
): void {
  for (let i = 0; i < buf.glyphs.length; i++) {
    if (!isLookupTarget(lookup, buf, i, posMask, gdef)) continue
    const syllable = syllableAt(buf, i, perSyllable)
    let matched = false
    for (const st of lookup.subtables as LigatureSubstData[]) {
      const ligs = st.ligatures.get(buf.glyphs[i]!)
      if (!ligs) continue
      for (const lig of ligs) {
        const positions = matchLigatureAt(lookup, buf, i, lig.components, gdef, posMask, syllable)
        if (positions !== null) {
          bufferLigate(lookup, buf, positions, lig.ligatureGlyphId, gdef)
          matched = true
          break
        }
      }
      if (matched) break
    }
  }
}

/**
 * Collect `count` input positions after `start`, skipping ignored glyphs.
 * Matched positions must satisfy the mask and syllable constraints (context
 * lookahead matching passes MASK_ALL to bypass the mask check).
 * @returns buffer positions (start excluded) or null when matching fails
 */
function collectInputPositions(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  start: number,
  count: number,
  gdef: GdefTable | null,
  posMask: number,
  syllable: number,
): number[] | null {
  const glyphs = buf.glyphs
  const positions: number[] = []
  let cur = start
  for (let c = 0; c < count; c++) {
    let j = cur + 1
    while (j < glyphs.length && isSkipped(lookup, buf, j, gdef)) j++
    if (j >= glyphs.length) return null
    if (!matchesConstraints(buf, j, posMask, syllable)) return null
    positions.push(j)
    cur = j
  }
  return positions
}

/**
 * Match `count` backtrack glyphs before `start` (in reverse logical order),
 * skipping ignored glyphs. Backtrack glyphs ignore the lookup mask but still
 * respect the syllable constraint.
 * @returns buffer positions (closest first) or null
 */
function collectBacktrackPositions(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  start: number,
  count: number,
  gdef: GdefTable | null,
  syllable: number,
): number[] | null {
  const positions: number[] = []
  let cur = start
  for (let c = 0; c < count; c++) {
    let j = cur - 1
    while (j >= 0 && isSkipped(lookup, buf, j, gdef)) j--
    if (j < 0) return null
    if (!matchesConstraints(buf, j, MASK_ALL, syllable)) return null
    positions.push(j)
    cur = j
  }
  return positions
}

/**
 * Apply the substitution lookup records of a matched context rule.
 * Records apply in record order; matchedPositions maps each input sequence
 * index to its buffer position and is length-adjusted after each nested
 * substitution so later records stay aligned.
 * @returns buffer position just after the last matched input glyph
 */
function applyContextRecords(
  buf: GsubBuffer,
  matchedPositions: number[],
  records: SubstLookupRecord[],
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  posMask: number,
  syllable: number,
): number {
  // Position just after the last matched input glyph; the driver resumes here.
  let end = matchedPositions[matchedPositions.length - 1]! + 1
  for (const rec of records) {
    if (rec.sequenceIndex >= matchedPositions.length) continue
    const nested = allLookups[rec.lookupListIndex]
    if (!nested) continue
    const at = matchedPositions[rec.sequenceIndex]!
    let delta = applyLookupAt(nested, buf, at, allLookups, gdef, depth + 1, posMask, syllable)
    if (delta === 0) continue
    // A recursed lookup changed the buffer length: `delta` glyphs were
    // inserted/removed right after `at`. Extend the matched region so the
    // driver advances past the substituted glyphs (mirrors HarfBuzz
    // apply_lookup's `end += delta`); without this, glyphs inserted at the
    // last matched position get re-matched, expanding without bound. Clamp so
    // a large deletion never rewinds `end` before the current position.
    end += delta
    if (end < at) {
      delta += at - end
      end = at
    }
    const next = rec.sequenceIndex + 1
    if (delta > 0) {
      const inserted = new Array<number>(delta)
      for (let k = 0; k < delta; k++) inserted[k] = at + k + 1
      matchedPositions.splice(next, 0, ...inserted)
      for (let k = next + delta; k < matchedPositions.length; k++) {
        matchedPositions[k] = matchedPositions[k]! + delta
      }
    } else {
      // A shrinking nested lookup consumes the following matched entries.
      // Remove them from the sequence-position map, then shift every surviving
      // position after the deletion. This preserves the meaning of subsequent
      // SequenceIndex values after ligature or empty multiple substitution.
      const removable = matchedPositions.length - next
      const removeCount = Math.min(-delta, removable)
      matchedPositions.splice(next, removeCount)
      for (let k = next; k < matchedPositions.length; k++) {
        matchedPositions[k] = matchedPositions[k]! - removeCount
      }
    }
  }
  return end
}

/**
 * Apply a lookup at exactly one buffer position (contextual nesting).
 * Nested lookups keep the outer lookup's mask and syllable constraints.
 * @returns buffer length delta
 */
function applyLookupAt(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  at: number,
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  posMask: number,
  syllable: number,
): number {
  if (depth > MAX_NESTING_DEPTH || at >= buf.glyphs.length) return 0

  switch (lookup.type) {
    case 1: {
      for (const st of lookup.subtables as SingleSubstData[]) {
        const mapped = st.mapping.get(buf.glyphs[at]!)
        if (mapped !== undefined) {
          buf.glyphs[at] = mapped
          if (buf.flags !== null) buf.flags[at] = buf.flags[at]! | GLYPH_FLAG_SUBSTITUTED
          return 0
        }
      }
      return 0
    }
    case 2: {
      for (const st of lookup.subtables as MultipleSubstData[]) {
        const mapped = st.mapping.get(buf.glyphs[at]!)
        if (mapped !== undefined) {
          return bufferExpand(buf, at, mapped)
        }
      }
      return 0
    }
    case 3: {
      for (const st of lookup.subtables as AlternateSubstData[]) {
        const alts = st.mapping.get(buf.glyphs[at]!)
        if (alts && alts.length > 0) {
          buf.glyphs[at] = alts[0]!
          if (buf.flags !== null) buf.flags[at] = buf.flags[at]! | GLYPH_FLAG_SUBSTITUTED
          return 0
        }
      }
      return 0
    }
    case 4: {
      for (const st of lookup.subtables as LigatureSubstData[]) {
        const ligs = st.ligatures.get(buf.glyphs[at]!)
        if (!ligs) continue
        for (const lig of ligs) {
          const positions = matchLigatureAt(lookup, buf, at, lig.components, gdef, posMask, syllable)
          if (positions !== null) {
            bufferLigate(lookup, buf, positions, lig.ligatureGlyphId, gdef)
            return -(positions.length - 1)
          }
        }
      }
      return 0
    }
    case 5: {
      const before = buf.glyphs.length
      applyContextSubstAt(lookup, buf, at, allLookups, gdef, depth, posMask, syllable)
      return buf.glyphs.length - before
    }
    case 6: {
      const before = buf.glyphs.length
      applyChainContextSubstAt(lookup, buf, at, allLookups, gdef, depth, posMask, syllable)
      return buf.glyphs.length - before
    }
    default:
      return 0
  }
}

/**
 * Try to match and apply a ContextSubst subtable at buffer position i.
 * @returns buffer position just after the matched input, or -1 when no match
 */
function matchContextSubstAt(
  lookup: ParsedGsubLookup,
  st: ContextSubstData,
  buf: GsubBuffer,
  i: number,
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  posMask: number,
  syllable: number,
): number {
  const glyphs = buf.glyphs
  for (const rule of st.rules) {
    if (rule.format === 1 && rule.rulesByGlyph) {
      const ruleList = rule.rulesByGlyph.get(glyphs[i]!)
      if (!ruleList) continue
      for (const r of ruleList) {
        const rest = collectInputPositions(lookup, buf, i, r.sequence.length, gdef, posMask, syllable)
        if (rest === null) continue
        let match = true
        for (let s = 0; s < r.sequence.length; s++) {
          if (glyphs[rest[s]!] !== r.sequence[s]) { match = false; break }
        }
        if (!match) continue
        const matchedPositions = [i, ...rest]
        return applyContextRecords(buf, matchedPositions, r.lookups, allLookups, gdef, depth, posMask, syllable)
      }
    } else if (rule.format === 2 && rule.coverageMap && rule.classDef && rule.rulesByClass) {
      if (!rule.coverageMap.has(glyphs[i]!)) continue
      const cls = rule.classDef.get(glyphs[i]!) ?? 0
      const ruleList = rule.rulesByClass.get(cls)
      if (!ruleList) continue
      for (const r of ruleList) {
        const rest = collectInputPositions(lookup, buf, i, r.sequence.length, gdef, posMask, syllable)
        if (rest === null) continue
        let match = true
        for (let s = 0; s < r.sequence.length; s++) {
          if ((rule.classDef.get(glyphs[rest[s]!]!) ?? 0) !== r.sequence[s]) { match = false; break }
        }
        if (!match) continue
        const matchedPositions = [i, ...rest]
        return applyContextRecords(buf, matchedPositions, r.lookups, allLookups, gdef, depth, posMask, syllable)
      }
    } else if (rule.format === 3 && rule.coverages && rule.lookups) {
      if (rule.coverages.length === 0 || !rule.coverages[0]!.has(glyphs[i]!)) continue
      const rest = collectInputPositions(lookup, buf, i, rule.coverages.length - 1, gdef, posMask, syllable)
      if (rest === null) continue
      let match = true
      for (let c = 1; c < rule.coverages.length; c++) {
        if (!rule.coverages[c]!.has(glyphs[rest[c - 1]!]!)) { match = false; break }
      }
      if (!match) continue
      const matchedPositions = [i, ...rest]
      return applyContextRecords(buf, matchedPositions, rule.lookups, allLookups, gdef, depth, posMask, syllable)
    }
  }
  return -1
}

/** Apply a ContextSubst subtable at one position only (nested use). */
function applyContextSubstAt(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  at: number,
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  posMask: number,
  syllable: number,
): void {
  for (const st of lookup.subtables as ContextSubstData[]) {
    if (matchContextSubstAt(lookup, st, buf, at, allLookups, gdef, depth, posMask, syllable) >= 0) return
  }
}

function applyContextSubstBuf(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  posMask: number,
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  perSyllable: boolean,
): void {
  for (let i = 0; i < buf.glyphs.length; i++) {
    if (!isLookupTarget(lookup, buf, i, posMask, gdef)) continue
    const syllable = syllableAt(buf, i, perSyllable)
    for (const st of lookup.subtables as ContextSubstData[]) {
      const next = matchContextSubstAt(lookup, st, buf, i, allLookups, gdef, depth, posMask, syllable)
      if (next >= 0) {
        i = next - 1
        break
      }
    }
  }
}

/**
 * Try to match and apply a ChainContextSubst subtable at buffer position i.
 * @returns buffer position just after the matched input, or -1 when no match
 */
function matchChainContextSubstAt(
  lookup: ParsedGsubLookup,
  st: ChainContextSubstData,
  buf: GsubBuffer,
  i: number,
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  posMask: number,
  syllable: number,
): number {
  const glyphs = buf.glyphs
  for (const rule of st.rules) {
    if (rule.format === 1 && rule.rulesByGlyph) {
      const ruleList = rule.rulesByGlyph.get(glyphs[i]!)
      if (!ruleList) continue
      for (const r of ruleList) {
        const back = collectBacktrackPositions(lookup, buf, i, r.backtrack.length, gdef, syllable)
        if (back === null) continue
        let match = true
        for (let b = 0; b < r.backtrack.length; b++) {
          if (glyphs[back[b]!] !== r.backtrack[b]) { match = false; break }
        }
        if (!match) continue
        const rest = collectInputPositions(lookup, buf, i, r.input.length, gdef, posMask, syllable)
        if (rest === null) continue
        for (let s = 0; s < r.input.length; s++) {
          if (glyphs[rest[s]!] !== r.input[s]) { match = false; break }
        }
        if (!match) continue
        const lastInput = rest.length > 0 ? rest[rest.length - 1]! : i
        const ahead = collectInputPositions(lookup, buf, lastInput, r.lookahead.length, gdef, MASK_ALL, syllable)
        if (ahead === null) continue
        for (let l = 0; l < r.lookahead.length; l++) {
          if (glyphs[ahead[l]!] !== r.lookahead[l]) { match = false; break }
        }
        if (!match) continue
        const matchedPositions = [i, ...rest]
        return applyContextRecords(buf, matchedPositions, r.lookups, allLookups, gdef, depth, posMask, syllable)
      }
    } else if (rule.format === 2 && rule.coverageMap && rule.inputClassDef && rule.rulesByClass) {
      if (!rule.coverageMap.has(glyphs[i]!)) continue
      const cls = rule.inputClassDef.get(glyphs[i]!) ?? 0
      const ruleList = rule.rulesByClass.get(cls)
      if (!ruleList) continue
      for (const r of ruleList) {
        const back = collectBacktrackPositions(lookup, buf, i, r.backtrack.length, gdef, syllable)
        if (back === null) continue
        let match = true
        for (let b = 0; b < r.backtrack.length; b++) {
          if ((rule.backtrackClassDef!.get(glyphs[back[b]!]!) ?? 0) !== r.backtrack[b]) { match = false; break }
        }
        if (!match) continue
        const rest = collectInputPositions(lookup, buf, i, r.input.length, gdef, posMask, syllable)
        if (rest === null) continue
        for (let s = 0; s < r.input.length; s++) {
          if ((rule.inputClassDef.get(glyphs[rest[s]!]!) ?? 0) !== r.input[s]) { match = false; break }
        }
        if (!match) continue
        const lastInput = rest.length > 0 ? rest[rest.length - 1]! : i
        const ahead = collectInputPositions(lookup, buf, lastInput, r.lookahead.length, gdef, MASK_ALL, syllable)
        if (ahead === null) continue
        for (let l = 0; l < r.lookahead.length; l++) {
          if ((rule.lookaheadClassDef!.get(glyphs[ahead[l]!]!) ?? 0) !== r.lookahead[l]) { match = false; break }
        }
        if (!match) continue
        const matchedPositions = [i, ...rest]
        return applyContextRecords(buf, matchedPositions, r.lookups, allLookups, gdef, depth, posMask, syllable)
      }
    } else if (rule.format === 3 && rule.inputCoverages && rule.lookups) {
      if (rule.inputCoverages.length === 0 || !rule.inputCoverages[0]!.has(glyphs[i]!)) continue
      const backLen = rule.backtrackCoverages?.length ?? 0
      const back = collectBacktrackPositions(lookup, buf, i, backLen, gdef, syllable)
      if (back === null) continue
      let match = true
      for (let b = 0; b < backLen; b++) {
        if (!rule.backtrackCoverages![b]!.has(glyphs[back[b]!]!)) { match = false; break }
      }
      if (!match) continue
      const rest = collectInputPositions(lookup, buf, i, rule.inputCoverages.length - 1, gdef, posMask, syllable)
      if (rest === null) continue
      for (let c = 1; c < rule.inputCoverages.length; c++) {
        if (!rule.inputCoverages[c]!.has(glyphs[rest[c - 1]!]!)) { match = false; break }
      }
      if (!match) continue
      const lastInput = rest.length > 0 ? rest[rest.length - 1]! : i
      const lookLen = rule.lookaheadCoverages?.length ?? 0
      const ahead = collectInputPositions(lookup, buf, lastInput, lookLen, gdef, MASK_ALL, syllable)
      if (ahead === null) continue
      for (let l = 0; l < lookLen; l++) {
        if (!rule.lookaheadCoverages![l]!.has(glyphs[ahead[l]!]!)) { match = false; break }
      }
      if (!match) continue
      const matchedPositions = [i, ...rest]
      return applyContextRecords(buf, matchedPositions, rule.lookups, allLookups, gdef, depth, posMask, syllable)
    }
  }
  return -1
}

/** Apply a ChainContextSubst subtable at one position only (nested use). */
function applyChainContextSubstAt(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  at: number,
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  posMask: number,
  syllable: number,
): void {
  for (const st of lookup.subtables as ChainContextSubstData[]) {
    if (matchChainContextSubstAt(lookup, st, buf, at, allLookups, gdef, depth, posMask, syllable) >= 0) return
  }
}

function applyChainContextSubstBuf(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  posMask: number,
  allLookups: ParsedGsubLookup[],
  gdef: GdefTable | null,
  depth: number,
  perSyllable: boolean,
): void {
  for (let i = 0; i < buf.glyphs.length; i++) {
    if (!isLookupTarget(lookup, buf, i, posMask, gdef)) continue
    const syllable = syllableAt(buf, i, perSyllable)
    for (const st of lookup.subtables as ChainContextSubstData[]) {
      const next = matchChainContextSubstAt(lookup, st, buf, i, allLookups, gdef, depth, posMask, syllable)
      if (next >= 0) {
        i = next - 1
        break
      }
    }
  }
}

function applyReverseChainSubstBuf(
  lookup: ParsedGsubLookup,
  buf: GsubBuffer,
  posMask: number,
  gdef: GdefTable | null,
): void {
  const glyphs = buf.glyphs
  for (const st of lookup.subtables as ReverseChainSubstData[]) {
    // Process in reverse logical order (the defining property of type 8)
    for (let i = glyphs.length - 1; i >= 0; i--) {
      if (!isLookupTarget(lookup, buf, i, posMask, gdef)) continue
      const covIdx = st.coverage.get(glyphs[i]!)
      if (covIdx === undefined) continue

      const back = collectBacktrackPositions(lookup, buf, i, st.backtrackCoverages.length, gdef, 0)
      if (back === null) continue
      let match = true
      for (let b = 0; b < st.backtrackCoverages.length; b++) {
        if (!st.backtrackCoverages[b]!.has(glyphs[back[b]!]!)) { match = false; break }
      }
      if (!match) continue

      const ahead = collectInputPositions(lookup, buf, i, st.lookaheadCoverages.length, gdef, MASK_ALL, 0)
      if (ahead === null) continue
      for (let l = 0; l < st.lookaheadCoverages.length; l++) {
        if (!st.lookaheadCoverages[l]!.has(glyphs[ahead[l]!]!)) { match = false; break }
      }
      if (!match) continue

      if (covIdx < st.substituteGlyphs.length) {
        glyphs[i] = st.substituteGlyphs[covIdx]!
        if (buf.flags !== null) buf.flags[i] = buf.flags[i]! | GLYPH_FLAG_SUBSTITUTED
      }
    }
  }
}

// --- Would-substitute (shaper planning queries) ---

/**
 * Whether one lookup would substitute the exact glyph sequence (no skipping,
 * no buffer context). Sequence matching mirrors the apply paths: coverage for
 * length-1 lookups, component equality for ligatures, and the input sequence
 * of contextual rules (chain rules with context requirements only match when
 * zeroContext is false).
 */
function wouldApplyLookup(
  lookup: ParsedGsubLookup,
  glyphs: readonly number[],
  zeroContext: boolean,
): boolean {
  const first = glyphs[0]!
  switch (lookup.type) {
    case 1:
      if (glyphs.length !== 1) return false
      for (const st of lookup.subtables as SingleSubstData[]) {
        if (st.mapping.has(first)) return true
      }
      return false
    case 2:
      if (glyphs.length !== 1) return false
      for (const st of lookup.subtables as MultipleSubstData[]) {
        if (st.mapping.has(first)) return true
      }
      return false
    case 3:
      if (glyphs.length !== 1) return false
      for (const st of lookup.subtables as AlternateSubstData[]) {
        if (st.mapping.has(first)) return true
      }
      return false
    case 4:
      for (const st of lookup.subtables as LigatureSubstData[]) {
        const ligs = st.ligatures.get(first)
        if (!ligs) continue
        for (const lig of ligs) {
          if (lig.components.length !== glyphs.length - 1) continue
          let match = true
          for (let i = 0; i < lig.components.length; i++) {
            if (lig.components[i] !== glyphs[i + 1]) { match = false; break }
          }
          if (match) return true
        }
      }
      return false
    case 5:
      for (const st of lookup.subtables as ContextSubstData[]) {
        for (const rule of st.rules) {
          if (rule.format === 1 && rule.rulesByGlyph) {
            const ruleList = rule.rulesByGlyph.get(first)
            if (!ruleList) continue
            for (const r of ruleList) {
              if (r.sequence.length !== glyphs.length - 1) continue
              let match = true
              for (let i = 0; i < r.sequence.length; i++) {
                if (r.sequence[i] !== glyphs[i + 1]) { match = false; break }
              }
              if (match) return true
            }
          } else if (rule.format === 2 && rule.classDef && rule.rulesByClass) {
            const ruleList = rule.rulesByClass.get(rule.classDef.get(first) ?? 0)
            if (!ruleList) continue
            for (const r of ruleList) {
              if (r.sequence.length !== glyphs.length - 1) continue
              let match = true
              for (let i = 0; i < r.sequence.length; i++) {
                if ((rule.classDef.get(glyphs[i + 1]!) ?? 0) !== r.sequence[i]) { match = false; break }
              }
              if (match) return true
            }
          } else if (rule.format === 3 && rule.coverages) {
            if (rule.coverages.length !== glyphs.length) continue
            let match = true
            for (let i = 0; i < rule.coverages.length; i++) {
              if (!rule.coverages[i]!.has(glyphs[i]!)) { match = false; break }
            }
            if (match) return true
          }
        }
      }
      return false
    case 6:
      for (const st of lookup.subtables as ChainContextSubstData[]) {
        for (const rule of st.rules) {
          if (rule.format === 1 && rule.rulesByGlyph) {
            const ruleList = rule.rulesByGlyph.get(first)
            if (!ruleList) continue
            for (const r of ruleList) {
              if (zeroContext && (r.backtrack.length > 0 || r.lookahead.length > 0)) continue
              if (r.input.length !== glyphs.length - 1) continue
              let match = true
              for (let i = 0; i < r.input.length; i++) {
                if (r.input[i] !== glyphs[i + 1]) { match = false; break }
              }
              if (match) return true
            }
          } else if (rule.format === 2 && rule.inputClassDef && rule.rulesByClass) {
            const ruleList = rule.rulesByClass.get(rule.inputClassDef.get(first) ?? 0)
            if (!ruleList) continue
            for (const r of ruleList) {
              if (zeroContext && (r.backtrack.length > 0 || r.lookahead.length > 0)) continue
              if (r.input.length !== glyphs.length - 1) continue
              let match = true
              for (let i = 0; i < r.input.length; i++) {
                if ((rule.inputClassDef.get(glyphs[i + 1]!) ?? 0) !== r.input[i]) { match = false; break }
              }
              if (match) return true
            }
          } else if (rule.format === 3 && rule.inputCoverages) {
            if (zeroContext &&
              ((rule.backtrackCoverages?.length ?? 0) > 0 || (rule.lookaheadCoverages?.length ?? 0) > 0)) continue
            if (rule.inputCoverages.length !== glyphs.length) continue
            let match = true
            for (let i = 0; i < rule.inputCoverages.length; i++) {
              if (!rule.inputCoverages[i]!.has(glyphs[i]!)) { match = false; break }
            }
            if (match) return true
          }
        }
      }
      return false
    default:
      return false
  }
}
